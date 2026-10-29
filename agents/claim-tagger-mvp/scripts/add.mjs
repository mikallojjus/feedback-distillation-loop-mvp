#!/usr/bin/env node
// Add: bring specific Geo claims into Claims, by Geo link or Geo ID, or from a selection file (decisions P35 to P38).
//
//   node agents/claim-tagger-mvp/scripts/add.mjs (--claims "<Geo links or IDs, separated by spaces or commas>" | --claims-file <selection file>) [--run-id <id>]
//
//   --claims        each item is a Geo link, <geo.browser_url>/space/<space id>/<entity id> (that site, with or without www), or a Geo ID (32 hex characters; dashes are allowed and removed).
//                   Any other item is refused as "not a Geo link or ID".
//   --claims-file   a selection file (schemas/import-selection.schema.json, the file the import workflow writes): the claims to add, each with its Geo ID and its space. A file that does not fit
//                   the schema, or that lists a Geo ID twice: exit 2 before anything is read. Give one of --claims and --claims-file, not both.
//
// There is no limit on the number of claims in one command. A stopped run is run again with the same input: it pulls first, so the claims that were added are "already in Claims".
//
// What it does. The usual frame of a loop script (a fresh pull of every table, the pause and drift checks, the columns the scripts need), then:
//   1. A Geo ID that Claims holds already is reported as "already in Claims" (not an error).
//   2. The others are read from Geo, through lib/geo-read.mjs only (queries only; the request log is runs/<run-id>/geo-requests.jsonl, and a request that is not a query stops the run
//      with exit 2). Not found (a stub), not of the Claim type, not in any of the allowed spaces (config.json geo.allowed_spaces; without it, geo.spaces), or with no name: refused, each with
//      its reason. The space of a row is the item's space (the link's, or the selection file's) when it is allowed and holds the entity, else the first allowed space (config order) that holds it.
//   3. A claim whose text (normaliseName, as the pick compares) is the same as one in Claims, or as an earlier claim of this command, is refused, and the existing claim is named.
//   4. The row is the pick's row (lib/geo-row.mjs): the nine Geo columns. Geo Space is the name of the allowed space; when the column has no option for it yet, Notion makes the option as
//      the row is written, and the read-back confirms the value. Geo Tags writes only the option names the column already has (the others are left out and listed in run.json; no Geo Tags
//      option and no column is ever made); a Geo Sources link at a protected id refuses the claim; the links of Geo Sources are written by withLinkedSources, as setup writes them.
//   5. Right before the plan is made, Claims is asked again for those Geo IDs: a row that appeared since the pull (another editor added the claim a moment ago) is dropped as
//      "already in Claims". That narrows the window in which two editors adding the same claim at the same moment could make a repeated key (which stops every loop script); it does not
//      close it, so:
//   6. The plan (script "add") only CREATES rows with the key and the Geo columns (lib/plan.mjs checks it, and applyPlan checks it again), is applied with the ledger, and every row is
//      read back (applyStep, assertApplied). It never changes an existing row, and it does not tag: the report's Next line sends the editor to /claim-tagger tag.
//   7. After the read-back, Claims is asked once more for the Geo IDs it created. A Geo ID that now has two rows is reported by this run (exit 2, the claim named, both page ids in
//      run.json): the engineer removes the later-created row by hand; no script ever removes a row.
//
// Production only (P37): a practice page refuses it, and the walkthrough runner does not list it.
//
// The report (lib/report.mjs): one sentence, one table of at most five rows, one Next line. The ids, the reasons and the existing claim of a same-text refusal are in run.json ("add").
//
// Exit codes: 0 ok (at least one claim added and read back), 1 Geo or Notion could not be read, or a write did not finish (the command is given again with the same links or file; the
// claims that were added are then "already in Claims"), 2 invalid (nothing was added; no input, or both kinds; a selection file that is not valid; a request to Geo that was not a query;
// a read-back that differs; a claim that is in Claims twice), 3 paused, 4 drift or a changed rulebook file.
//
// Exports: add, main, USAGE, parseItems, readSelection.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from './lib/exit-codes.mjs';
import { ADD_SCRIPT, CLAIMS_GEO_COLUMNS, tableEntry } from './lib/config.mjs';
import { isReviewed } from './lib/decisions.mjs';
import { cutText, listNames, plural, quoted, tableLink } from './lib/editor-words.mjs';
import { MAX_ROWS, hardRefusals } from './lib/report.mjs';
import {
  GEO_ID, GeoError, allowedSpaces, countGeoRequests, createGeoClient, entityIsStub, geoRequestLogger, validateGeoConfig,
} from './lib/geo-read.mjs';
import { geoRowOf, normaliseName } from './lib/geo-row.mjs';
import {
  LoopExit, applyStep, assertApplied, needClaimColumns, needTables, notionClient, parseCli, resumeLine, runPreflight, takePull, withRun,
} from './lib/loop.mjs';
import { decodePage } from './lib/notion-values.mjs';
import { codeFile, isMain } from './lib/paths.mjs';
import { newPlan } from './lib/plan.mjs';
import { claimOps, protectedInLinks, sourcePieces, withLinkedSources } from './lib/setup-steps.mjs';
import { validate } from './lib/validate.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/add.mjs (--claims "<Geo links or IDs, separated by spaces or commas>" | --claims-file <selection file>) [--run-id <id>]';

const ENGINEER = 'Next: ask the engineer to look at the message the script printed.';
// every exit-1 Next line says to give the same input again: typed without it the command gives nothing useful
const LATER = 'Next: type /claim-tagger add again with the same links in a while.';
const PARTLY = 'Next: type /claim-tagger add again with the same links; the ones added are skipped.';
const LATER_FILE = 'Next: run the same selection file again in a while.';
const PARTLY_FILE = 'Next: run the same selection file again; the ones added are skipped.';
const QUERY_SIZE = 10; // Geo IDs per question when Claims is asked again (one `or` filter each)
const NAMED = 3; // the claims a sentence or a table cell names, then "and n more"
const CUT = 40; // the longest text of a claim in a sentence or a table cell

// the kinds of outcome, in the order of the table; "added" and "already" are not refusals
const KINDS = Object.freeze([
  ['added', 'Added'],
  ['already', 'Already in Claims'],
  ['not_found', 'Not found in Geo'],
  ['not_claim', 'Not a claim'],
  ['not_in_spaces', 'Not in the spaces of Claims'],
  ['same_text', 'Same text as a claim in Claims'],
  ['bad_input', 'Not a Geo link or ID'],
  ['no_name', 'No name in Geo'],
  ['source_link', 'A source links to a protected Notion page'],
]);
// the phrase of a kind inside a sentence: "nothing was added to Claims: 1 not found in Geo and 2 already in Claims", and the kinds of the row "Other reasons"
const PHRASE = Object.freeze({
  already: (n) => `${n} already in Claims`,
  not_found: (n) => `${n} not found in Geo`,
  not_claim: (n) => `${n} not ${n === 1 ? 'a claim' : 'claims'}`,
  not_in_spaces: (n) => `${n} not in the spaces of Claims`,
  same_text: (n) => `${n} with the same text as a claim in Claims`,
  bad_input: (n) => `${n} not ${n === 1 ? 'a Geo link or ID' : 'Geo links or IDs'}`,
  no_name: (n) => `${n} with no name in Geo`,
  source_link: (n) => `${n} with a source that links to a protected Notion page`,
});

const flat = (v) => String(v ?? '').replace(/-/g, '').toLowerCase();
const byCodePoints = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const bareHost = (host) => host.replace(/^www\./, '');
/** How a table cell or a sentence names an item that has no text of its own: the last 8 characters of its Geo ID, called a link when the editor gave a link and an ID when the editor gave the ID. */
const ending = (id, isLink) => `${isLink ? 'link' : 'ID'} ending ${String(id).slice(-8)}`;
/** The text of a claim for a sentence or a cell, cut and quoted; the link ending when there is no text. */
const nameOf = (text, id, isLink = false) => (typeof text === 'string' && text.trim() !== '' ? quoted(text, CUT) : ending(id, isLink));
/**
 * An item the editor typed that is not a Geo link or ID, echoed (cut at 40 characters, in quotes) only when the cut text passes the hard refusals of the report lint (no brace, no run folder,
 * no script file, no drive path, no run id) and holds none of [ ] { } < > " ' and the backtick. The last rule is the conservative one: the transcript check reads the relayed report too and
 * flags a JSON array or object in it, so a text that looks like one ("[true]", "[1, 2]") must not be echoed even though the report lint lets quoted text through.
 */
const ECHO_REFUSED = /[[\]{}<>"'`]/;
const typedItem = (raw) => {
  const shown = cutText(raw, CUT);
  return hardRefusals(shown).length === 0 && !ECHO_REFUSED.test(shown) ? quoted(raw, CUT) : 'an item that is not a link';
};
/** At most three names, then "and n more". */
const namesOf = (names) => (names.length > NAMED ? `${names.slice(0, NAMED).join(', ')} and ${names.length - NAMED} more` : listNames(names));

// ---- the input ----------------------------------------------------------------------------------------------------------------------

/** A hex id with dashes allowed (and removed), or null when it is not 32 hex characters. */
function hexOf(text) {
  if (!/^[0-9a-f-]+$/i.test(text)) return null;
  const id = flat(text);
  return GEO_ID.test(id) ? id : null;
}

/** One item of the input: { raw, ok: true, id, spaceId (of a link, else null), isLink } or { raw, ok: false }. */
function parseItem(raw, geo) {
  const token = raw.replace(/^[<(["'“‘]+/, '').replace(/[>)\]"'”’.;,!:]+$/, ''); // a link pasted between quotes, brackets or angle brackets, or with a stop after it
  const bare = hexOf(token);
  if (bare) return { raw, ok: true, id: bare, spaceId: null, isLink: false };
  let url;
  try {
    url = new URL(token);
  } catch {
    return { raw, ok: false };
  }
  // the site of geo.browser_url, with or without www (the same site)
  if (url.protocol !== 'https:' || bareHost(url.host) !== bareHost(new URL(geo.browser_url).host)) return { raw, ok: false };
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'space') return { raw, ok: false };
  const spaceId = hexOf(parts[1]);
  const id = hexOf(parts[2]);
  return spaceId && id ? { raw, ok: true, id, spaceId, isLink: true } : { raw, ok: false };
}

/**
 * The items of the --claims text: split at white space and commas, each one a Geo link of the configured site or a Geo ID. A repeated claim counts once (the first link's space
 * is kept), a repeated item that is not a link or ID counts once. Returns { items } in the order given.
 */
export function parseItems(text, geo) {
  const seen = new Set();
  const items = [];
  for (const raw of String(text ?? '').split(/[\s,]+/).filter(Boolean)) {
    const item = parseItem(raw, geo);
    const key = item.ok ? item.id : `raw:${raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return { items };
}

/**
 * The items of a selection file (--claims-file): the file is read, checked against schemas/import-selection.schema.json, and every Geo ID must appear once. Each claim becomes an item
 * { raw: its Geo ID, ok: true, id, spaceId: its space_id, isLink: false }, in the order of the file. Returns { items } or { problem: { message, sentence, next } }; nothing else is read.
 */
export function readSelection(file, root) {
  const fail = (message, sentence, next) => ({ problem: { message, sentence, next } });
  let selection;
  try {
    selection = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    return fail(`the selection file could not be read: ${e.message}`, 'Add: nothing was read or added, because the selection file could not be read.', 'Next: check the selection file and run it again.');
  }
  const schema = JSON.parse(readFileSync(codeFile(root, 'schemas', 'import-selection.schema.json'), 'utf8'));
  const verdict = validate(schema, selection);
  if (!verdict.ok) {
    return fail(
      `the selection file ${file} does not fit schemas/import-selection.schema.json:\n  - ${verdict.errors.slice(0, 8).join('\n  - ')}${verdict.errors.length > 8 ? `\n  - ... and ${verdict.errors.length - 8} more` : ''}`,
      'Add: nothing was read or added, because the selection file is not valid.', 'Next: correct the selection file and run it again.',
    );
  }
  const seen = new Set();
  const twice = [];
  for (const c of selection.claims) {
    if (seen.has(c.geo_id)) twice.push(c.geo_id);
    seen.add(c.geo_id);
  }
  if (twice.length > 0) {
    return fail(
      `the selection file lists ${twice.length} Geo ID(s) more than once: ${[...new Set(twice)].slice(0, 5).join(', ')}`,
      'Add: nothing was read or added, because the selection file lists the same claim more than once.', 'Next: correct the selection file and run it again.',
    );
  }
  return { items: selection.claims.map((c) => ({ raw: c.geo_id, ok: true, id: c.geo_id, spaceId: c.space_id, isLink: false })) };
}

// ---- Claims ---------------------------------------------------------------------------------------------------------------------------

/** The option names of a select or multi_select column of the pulled schema ([] when the column is not there). */
function optionsOf(schema, column) {
  const def = schema?.properties?.[column];
  return def ? (def[def.type]?.options ?? []).map((o) => o.name) : [];
}

/**
 * The rows Claims holds right now for these Geo IDs: a Map from Geo ID to its pages [{ page_id, created_time }]. Claims is asked, filtered, in small groups. It is used twice: right
 * before the plan is made (the pull is older than the Geo reads, and another editor may have added the same claim in the meantime) and right after the read-back (to find a claim that
 * was added from two places at once). A failure to read ends the run with exit 1 and `sentence`.
 */
async function pagesNow(ctx, entry, ids, sentence) {
  const client = notionClient(ctx);
  const schema = ctx.pull.schema('claims');
  const found = new Map();
  try {
    for (let i = 0; i < ids.length; i += QUERY_SIZE) {
      const conditions = ids.slice(i, i + QUERY_SIZE).map((id) => ({ property: entry.key, rich_text: { equals: id } }));
      const pages = await client.queryAll(entry.database_id, { filter: conditions.length === 1 ? conditions[0] : { or: conditions } });
      for (const page of pages) {
        const key = flat(String(decodePage(page, schema).props[entry.key] ?? '').trim());
        found.set(key, [...(found.get(key) ?? []), { page_id: page.id, created_time: page.created_time ?? '' }]);
      }
    }
  } catch (e) {
    throw new LoopExit(EXIT.ERROR, `Claims could not be read again: ${e?.message ?? e}`, { sentence, next: LATER });
  }
  return found;
}

// ---- the report -------------------------------------------------------------------------------------------------------------------------

// when the kinds present would make more than five rows, the four that matter most keep their row (in the order of the table) and the others become one row, "Other reasons"
const KEEP_FIRST = Object.freeze(['added', 'already', 'same_text', 'not_found', 'not_claim', 'not_in_spaces', 'bad_input', 'no_name', 'source_link']);

/** The existing claims a row of same-text refusals names (each once), and where they are: in Claims, or earlier in this command. */
function sameTextCell(list) {
  const twins = [];
  for (const r of list) if (!twins.some((t) => t.geo_id === r.same_as.geo_id)) twins.push(r.same_as);
  const here = twins.map((t) => t.where);
  const where = here.every((w) => w === 'Claims') ? 'there already' : here.every((w) => w !== 'Claims') ? 'earlier in your list' : 'there already or earlier in your list';
  return `${list.length}: ${namesOf(twins.map((t) => nameOf(t.claim, t.geo_id)))} ${twins.length === 1 ? 'is' : 'are'} ${where}`;
}

/**
 * The table: a row for each kind that is present, in the order of KINDS. "Added" is a count (the sentence names the claims); every other row names its items, at most three, then "and n
 * more": the text of the claim when Geo or Claims has it, else "link ending <the last 8 characters of the id>"; the row of the same-text refusals names the claims that are there already.
 * With more than five kinds, four keep their row and the rest are "Other reasons", which names its kinds.
 */
function tableOf(results) {
  const by = new Map(KINDS.map(([kind]) => [kind, []]));
  for (const r of results) by.get(r.outcome)?.push(r);
  const present = KINDS.filter(([kind]) => by.get(kind).length > 0);
  let shown = present;
  let others = [];
  if (present.length > MAX_ROWS) {
    const keep = new Set(KEEP_FIRST.filter((kind) => present.some(([k]) => k === kind)).slice(0, MAX_ROWS - 1));
    shown = present.filter(([kind]) => keep.has(kind));
    others = present.filter(([kind]) => !keep.has(kind)).map(([kind]) => kind);
  }
  const rows = shown.map(([kind, label]) => {
    const list = by.get(kind);
    if (kind === 'added') return [label, String(list.length), ''];
    if (kind === 'same_text') return [label, sameTextCell(list), ''];
    return [label, `${list.length}: ${namesOf(list.map((r) => r.label))}`, ''];
  });
  if (others.length > 0) rows.push(['Other reasons', `${others.reduce((sum, kind) => sum + by.get(kind).length, 0)}: ${others.map((kind) => PHRASE[kind](by.get(kind).length)).join(', ')}`, '']);
  return rows;
}

// ---- the run ----------------------------------------------------------------------------------------------------------------------------

/** Add the claims. opts: claims (the text of --claims) or claimsFile (the path of --claims-file), runId and the hooks of the other loop scripts; geoFetchImpl replaces the fetch of the Geo client (tests). */
export async function add(opts = {}) {
  const claimsText = typeof opts.claims === 'string' ? opts.claims : '';
  const claimsFile = typeof opts.claimsFile === 'string' && opts.claimsFile !== '' ? opts.claimsFile : null;
  return withRun({
    script: 'add', label: 'Add', again: '/claim-tagger add', opts,
    args: { claims: claimsText === '' ? null : claimsText, claims_file: claimsFile },
    resume: resumeLine('add', [...(claimsText === '' ? [] : ['--claims', claimsText]), ...(claimsFile === null ? [] : ['--claims-file', claimsFile])]),
  }, async (ctx) => {
    try {
      return await body(ctx, claimsText, claimsFile);
    } catch (e) {
      // a stop in the shared harness (the pull, say) says "type /claim-tagger add again in a while": typed without the links or the file the command gives nothing useful
      if (e instanceof LoopExit && e.code === EXIT.ERROR && /^Next: type \/claim-tagger add again(?: in a while|; it continues where it stopped)\.$/.test(e.next ?? '')) e.next = claimsFile === null ? LATER : LATER_FILE;
      throw e;
    }
  });
}

async function body(ctx, claimsText, claimsFile) {
  // production only (P37): a practice page has no add command
  if (ctx.demo) {
    throw new LoopExit(EXIT.INVALID, 'add works on the real Claims table, not on a practice page', {
      sentence: 'Add: nothing was done, because adding claims works only on the real Claims table; the practice page has its own claims.',
      next: 'Next: type /claim-tagger status to see where the practice page stands.',
    });
  }
  const checkedGeo = validateGeoConfig(ctx.config);
  if (!checkedGeo.ok) {
    throw new LoopExit(EXIT.INVALID, `the geo block of config.json is not valid: ${checkedGeo.errors.join('; ')}`, {
      sentence: 'Add: nothing was done, because the settings for reading Geo are not valid.',
      next: ENGINEER,
    });
  }
  const geo = checkedGeo.geo;

  // 1. the input, links or a selection file (one of the two): checked before anything is read, and there is no limit on how many claims
  if (claimsText !== '' && claimsFile !== null) {
    throw new LoopExit(EXIT.INVALID, `give either --claims or --claims-file, not both\n${USAGE}`, {
      sentence: 'Add: nothing was done, because both Geo links and a selection file were given.',
      next: 'Next: give either the links or the selection file, not both.',
    });
  }
  let items;
  if (claimsFile !== null) {
    const read = readSelection(claimsFile, ctx.root);
    if (read.problem) throw new LoopExit(EXIT.INVALID, read.problem.message, { sentence: read.problem.sentence, next: read.problem.next });
    items = read.items;
  } else {
    items = parseItems(claimsText, geo).items;
    if (items.length === 0) {
      throw new LoopExit(EXIT.INVALID, `no Geo links or IDs were given\n${USAGE}`, {
        sentence: 'Add: nothing was done, because no Geo links or IDs were given.',
        next: 'Next: type /claim-tagger add with the Geo links or IDs of the claims.',
      });
    }
  }
  const later = claimsFile === null ? LATER : LATER_FILE;
  const partly = claimsFile === null ? PARTLY : PARTLY_FILE;

  // 2. the frame every loop script has
  await takePull(ctx);
  needTables(ctx, 'claims');
  runPreflight(ctx);
  needClaimColumns(ctx);
  const entry = tableEntry(ctx.config, 'claims');
  const schema = ctx.pull.schema('claims');
  const claims = ctx.pull.claims() ?? [];
  const inClaims = new Map(claims.map((c) => [flat(c.geo_id), c]));
  const textInClaims = new Map();
  for (const c of claims) {
    const key = normaliseName(c.claim);
    if (key !== '' && !textInClaims.has(key)) textInClaims.set(key, c);
  }

  // 3. already in Claims, and the ones to read from Geo
  const results = items.map((item) => ({
    raw: item.raw, geo_id: item.ok ? item.id : null, outcome: item.ok ? null : 'bad_input', label: item.ok ? null : typedItem(item.raw),
  }));
  const toRead = [];
  items.forEach((item, i) => {
    if (!item.ok) return;
    if (inClaims.has(item.id)) {
      const held = inClaims.get(item.id);
      Object.assign(results[i], { outcome: 'already', claim: held.claim, label: nameOf(held.claim, item.id, item.isLink), unread: !isReviewed(held) && String(held.agent_status ?? '').trim() === '' });
    } else toRead.push(i);
  });
  const unknownTags = [];
  let duplicates = [];
  /** What run.json says about this run (the ids, the reasons, the existing claims); written before every stop after the items are known, and at the end. */
  const record = () => {
    ctx.record.add = {
      items: results.length,
      added: results.filter((r) => r.outcome === 'added').map((r) => ({ geo_id: r.geo_id, claim: r.claim, space: r.space, page_id: r.page_id })),
      not_added: results.filter((r) => !['added', 'candidate', 'written_unchecked', 'maybe_written', 'not_written'].includes(r.outcome)).map((r) => ({
        item: r.raw, geo_id: r.geo_id, reason: r.outcome, ...(r.same_as ? { same_as: r.same_as } : {}), ...(r.added_meanwhile ? { added_meanwhile: true } : {}), ...(r.claim && r.outcome === 'already' ? { claim: r.claim } : {}),
      })),
      // after a stop: rows that were written but could not be read back (they have a page), rows whose create answered an error and may have landed (no page known), and rows with no page
      ...(results.some((r) => r.outcome === 'written_unchecked') ? { written_unchecked: results.filter((r) => r.outcome === 'written_unchecked').map((r) => ({ geo_id: r.geo_id, claim: r.claim, page_id: r.page_id })) } : {}),
      ...(results.some((r) => r.outcome === 'maybe_written') ? { maybe_written: results.filter((r) => r.outcome === 'maybe_written').map((r) => ({ geo_id: r.geo_id, claim: r.claim })) } : {}),
      ...(results.some((r) => r.outcome === 'not_written') ? { not_written: results.filter((r) => r.outcome === 'not_written').map((r) => ({ geo_id: r.geo_id, claim: r.claim })) } : {}),
      ...(unknownTags.length ? { geo_tags_left_out: unknownTags } : {}),
      ...(duplicates.length ? { in_claims_twice: duplicates } : {}),
    };
  };

  // 4. Geo, queries only
  let entities = new Map();
  if (toRead.length > 0) {
    const logFile = join(ctx.runDir, 'geo-requests.jsonl');
    const client = createGeoClient({ geo, fetchImpl: ctx.opts.geoFetchImpl, log: geoRequestLogger(logFile, { now: ctx.now }), sleep: ctx.opts.sleep });
    let geoError = null;
    try {
      entities = await client.details(toRead.map((i) => items[i].id));
    } catch (e) {
      if (!(e instanceof GeoError)) throw e;
      geoError = e;
    }
    let requests;
    try {
      requests = countGeoRequests(logFile);
    } catch (e) {
      throw new LoopExit(EXIT.INVALID, `the Geo request log cannot be trusted: ${e.message}`, { sentence: 'Add: nothing was added, because the record of what was sent to Geo cannot be trusted.', next: ENGINEER });
    }
    ctx.record.geo_requests = requests;
    if (requests.nonQuery > 0) {
      throw new LoopExit(EXIT.INVALID, `${requests.nonQuery} request(s) to Geo were not queries`, { sentence: 'Add: nothing was added, because a request to Geo was not a plain read.', next: ENGINEER });
    }
    if (geoError) {
      const mine = geoError.kind === 'config' || geoError.kind === 'refused';
      throw new LoopExit(mine ? EXIT.INVALID : EXIT.ERROR, `Geo could not be read: ${geoError.message}`, {
        sentence: mine ? 'Add: nothing was added, because the request to Geo was refused.' : 'Add: nothing was added, because Geo could not be read.',
        next: mine ? ENGINEER : later,
      });
    }
  }

  // 5. each claim read from Geo: what it is, which space, which row
  const spaceOrder = allowedSpaces(geo); // geo.allowed_spaces, else the six spaces of the pick (P39)
  const rows = new Map(); // geo id -> { row, pieces, name, space, index }
  const acceptedText = new Map(); // normalised text -> { geo_id, claim } of the claims of this command that will be added
  const knownTags = new Set(optionsOf(schema, 'Geo Tags'));
  for (const i of toRead) {
    const item = items[i];
    const r = results[i];
    const entity = entities.get(item.id);
    if (entityIsStub(entity)) {
      Object.assign(r, { outcome: 'not_found', label: ending(item.id, item.isLink) });
      continue;
    }
    if (!(entity.typeIds ?? []).map(flat).includes(geo.ids.claim_type)) {
      Object.assign(r, { outcome: 'not_claim', label: nameOf(entity.name, item.id, item.isLink) });
      continue;
    }
    const held = new Set((entity.spaceIds ?? []).map(flat));
    const space = (item.spaceId && spaceOrder.find((s) => s.id === item.spaceId && held.has(s.id))) || spaceOrder.find((s) => held.has(s.id));
    if (!space) {
      Object.assign(r, { outcome: 'not_in_spaces', label: nameOf(entity.name, item.id, item.isLink) });
      continue;
    }
    const built = geoRowOf({ entity, id: item.id, fallbackName: '', fallbackCreated: null, space, geo });
    const name = String(built.row['Geo Name'] ?? '').trim();
    const text = normaliseName(name);
    if (name === '' || text === '') {
      Object.assign(r, { outcome: 'no_name', label: ending(item.id, item.isLink) });
      continue;
    }
    const twin = textInClaims.get(text) ?? acceptedText.get(text);
    if (twin) {
      r.outcome = 'same_text';
      r.claim = name;
      r.same_as = textInClaims.has(text)
        ? { geo_id: twin.geo_id, claim: twin.claim, where: 'Claims' }
        : { geo_id: twin.geo_id, claim: twin.claim, where: 'this command' };
      continue;
    }
    const pieces = sourcePieces(built.row);
    if (protectedInLinks(ctx.config, new Map([[item.id, pieces]])).length > 0) {
      Object.assign(r, { outcome: 'source_link', label: nameOf(name, item.id, item.isLink), claim: name });
      continue;
    }
    // Geo Tags: only the option names the column has; the others are left out and listed
    const tags = built.row['Geo Tags'].filter((t) => knownTags.has(t));
    const left = built.row['Geo Tags'].filter((t) => !knownTags.has(t));
    if (left.length) unknownTags.push({ geo_id: item.id, tags: left });
    built.row['Geo Tags'] = tags;
    acceptedText.set(text, { geo_id: item.id, claim: name });
    rows.set(item.id, { row: built.row, pieces, name, space: space.name, index: i });
    Object.assign(r, { outcome: 'candidate', claim: name, space: space.name, label: nameOf(name, item.id, item.isLink) });
  }

  // 6. the last look at Claims, right before the plan: a row that appeared since the pull is dropped
  const candidates = [...rows.keys()];
  if (candidates.length > 0) {
    const there = await pagesNow(ctx, entry, candidates, 'Add: nothing was added, because Notion could not be read.');
    for (const id of candidates) {
      if (!there.has(id)) continue;
      const { index } = rows.get(id);
      Object.assign(results[index], { outcome: 'already', added_meanwhile: true, unread: true });
      rows.delete(id);
    }
  }

  // 7. the plan: creates of the Geo columns only, Geo Tags with option names that exist, the links of Geo Sources written beside the text. Geo Space is the name of an allowed space (P39): when the
  // column has no option for it yet, Notion makes the option as the row is written, and the read-back below confirms the value
  const columns = CLAIMS_GEO_COLUMNS.filter((c) => schema?.properties?.[c]);
  const toWrite = [...rows.entries()].map(([id, v]) => ({ id, ...v }));
  if (toWrite.length > 0) {
    const plan = newPlan({ runId: ctx.runId, script: ADD_SCRIPT, rubricEdition: ctx.edition, config: ctx.config, now: ctx.now });
    const ops = claimOps({ rows: toWrite.map((v) => v.row) }, columns, { keyColumn: entry.key });
    for (const op of ops) plan.create('claims', op.key, op.properties);
    const byGeoId = new Map(toWrite.filter((v) => v.pieces.length > 0).map((v) => [v.id, v.pieces]));
    ctx.client = withLinkedSources(notionClient(ctx), byGeoId, {
      column: entry.columns?.sources ?? 'Geo Sources', keyColumn: entry.key, onWarning: (w) => ctx.warnings.push(w),
    });
    record();
    const applied = await applyStep(ctx, plan);
    const result = applied.result;
    if (!result) {
      throw new LoopExit(EXIT.INVALID, 'the plan was made but not sent, so nothing can be reported as added', { sentence: 'Add: nothing was written to Notion.', next: ENGINEER });
    }
    const made = result.created_by_table?.claims ?? {};
    if (result.code === EXIT.ERROR) {
      // a write that stopped part way: say what is true. A row counts as added only when it was written and read back. A row that was written but could not be read back, and a row whose
      // create answered an error (it may have landed), are told apart from the rows that truly have no page; the next run finds the ones that landed "already in Claims"
      const keys = (list) => new Set(list.map((x) => x.key));
      const unchecked = keys(result.lists.unchecked);
      const mismatched = keys(result.lists.mismatches);
      const uncertain = keys(result.lists.uncertain);
      let confirmed = 0;
      let may = 0;
      for (const v of toWrite) {
        const r = results[v.index];
        if (made[v.id] && !unchecked.has(v.id) && !mismatched.has(v.id)) {
          Object.assign(r, { outcome: 'added', page_id: made[v.id] });
          confirmed += 1;
        } else if (made[v.id]) {
          Object.assign(r, { outcome: 'written_unchecked', page_id: made[v.id] });
          may += 1;
        } else if (uncertain.has(v.id)) {
          r.outcome = 'maybe_written';
          may += 1;
        } else r.outcome = 'not_written';
      }
      record();
      const left = result.failed + result.uncertain + result.unchecked + result.pending;
      const total = toWrite.length;
      let sentence = 'Add: it stopped before any claim was added.';
      if (confirmed > 0 && may > 0) sentence = `Add: ${confirmed} of ${total} claims ${confirmed === 1 ? 'was' : 'were'} added and ${may} more may have been, before it stopped.`;
      else if (confirmed > 0) sentence = `Add: ${confirmed} of ${total} claims ${confirmed === 1 ? 'was' : 'were'} added before it stopped.`;
      else if (may > 0) sentence = `Add: none was confirmed and ${may} may have been added, before it stopped.`;
      throw new LoopExit(EXIT.ERROR, `${left} write(s) did not finish: ${[...result.lists.failed, ...result.lists.uncertain, ...result.lists.unchecked].slice(0, 3).map((m) => `${m.table} "${m.key}" ${m.detail ?? ''}`).join('; ') || 'not reached'}`, {
        sentence,
        next: confirmed + may > 0 ? partly : later,
      });
    }
    assertApplied(ctx, result);
    for (const v of toWrite) {
      results[v.index].outcome = made[v.id] ? 'added' : 'already';
      if (made[v.id]) results[v.index].page_id = made[v.id];
    }
    record();

    // 8. after the read-back, once more: a Geo ID with two rows now (another editor added the claim in the same moment, after the last look) is told by this run
    const madeIds = toWrite.filter((v) => made[v.id]).map((v) => v.id);
    const now = await pagesNow(ctx, entry, madeIds, 'Add: the claims were written, but Claims could not be read again to check that none is there twice.');
    duplicates = madeIds.filter((id) => (now.get(id) ?? []).length > 1).map((id) => {
      // the order of the pull (pull.mjs indexRows): created_time, then page id. Notion rounds created_time to the minute, so the row the pull keeps may be either; the one to remove is the one it treats as the extra
      const pages = [...now.get(id)].sort((a, b) => byCodePoints(a.created_time ?? '', b.created_time ?? '') || byCodePoints(a.page_id, b.page_id));
      return { geo_id: id, claim: rows.get(id).name, page_ids: pages.map((p) => p.page_id), remove: pages.slice(1).map((p) => p.page_id) };
    });
    if (duplicates.length > 0) {
      record();
      const named = namesOf(duplicates.map((d) => nameOf(d.claim, d.geo_id)));
      throw new LoopExit(EXIT.INVALID, `${duplicates.length} Geo ID(s) are in Claims twice: ${duplicates.map((d) => `${d.geo_id} (${d.page_ids.join(', ')})`).join('; ')}`, {
        sentence: duplicates.length === 1
          ? `Add: ${named} is in Claims twice now, because the same claim was added from two places at the same moment.`
          : `Add: ${duplicates.length} claims are in Claims twice now (${named}), because the same claims were added from two places at the same moment.`,
        next: duplicates.length === 1
          ? 'Next: ask the engineer to remove the row named in the run record (the two rows are identical); every command stops until then.'
          : 'Next: ask the engineer to remove the rows named in the run record (each pair is identical); every command stops until then.',
      });
    }
  }

  // 9. the report
  record();
  const added = results.filter((r) => r.outcome === 'added');
  const counts = Object.fromEntries(KINDS.map(([kind]) => [kind, results.filter((r) => r.outcome === kind).length]));
  const rowsOut = tableOf(results);
  const header = ['What', 'Result', ''];
  const details = { results, counts };
  const link = tableLink(ctx.config, 'claims'); // the table; its first view is All claims
  if (added.length === 0) {
    const kinds = KINDS.filter(([kind]) => kind !== 'added' && counts[kind] > 0);
    const onlyThere = kinds.length === 1 && kinds[0][0] === 'already';
    const n = results.length;
    let sentence;
    let next;
    if (onlyThere) {
      const names = results.length > NAMED ? `${results.slice(0, NAMED).map((r) => r.label).join(', ')} and more` : listNames(results.map((r) => r.label));
      sentence = `Add: nothing was added; ${n === 1 ? 'the claim is' : n === 2 ? 'both claims are' : `all ${n} claims are`} already in Claims (${names}).`;
      // C3: tag has something to read only when one of them has no Agent status and is not Reviewed
      next = results.some((r) => r.unread)
        ? `Next: type /claim-tagger tag to read ${n === 1 ? 'it' : 'them'}.`
        : `Next: nothing new to read; ${n === 1 ? 'it is' : 'they are'} in All claims (${link}).`;
    } else {
      sentence = `Add: nothing was added to Claims: ${listNames(kinds.map(([kind]) => PHRASE[kind](counts[kind])))}.`;
      next = claimsFile === null ? 'Next: check the links and type /claim-tagger add again.' : 'Next: check the selection and run it again.';
    }
    return { exit: EXIT.INVALID, message: sentence, sentence, header, rows: rowsOut, next, details, counts };
  }
  const notAdded = results.length - added.length;
  const names = added.slice(0, NAMED).map((r) => quoted(r.claim, CUT));
  const named = added.length > NAMED ? `${names.join(', ')} and more` : listNames(names);
  const sentence = `Add: ${plural(added.length, 'claim')} added to Claims from Geo (${named})${notAdded > 0 ? `; ${notAdded} ${notAdded === 1 ? 'was' : 'were'} not added` : ''}.`;
  return {
    exit: EXIT.OK,
    sentence,
    header,
    rows: rowsOut,
    next: `Next: type /claim-tagger tag to read ${added.length === 1 ? 'the new claim' : `the ${added.length} new claims`}; ${added.length === 1 ? 'it is' : 'they are'} in All claims (${link}).`,
    details,
    counts,
  };
}

// ---- the command line ----------------------------------------------------------------------------------------------------------------

const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Parse the command line and run; returns the exit code. deps (tests): everything add() takes besides the flags. */
export async function main(argv, io = consoleIo, deps = {}) {
  const parsed = parseCli('add', argv, { claims: { type: 'string' }, 'claims-file': { type: 'string' }, 'run-id': { type: 'string' } }, USAGE, io);
  if (parsed.exit !== undefined) return parsed.exit;
  const v = parsed.values;
  try {
    return (await add({ ...deps, io, claims: v.claims, claimsFile: v['claims-file'], runId: v['run-id'] })).exit;
  } catch (e) {
    io.err(`add: unexpected error: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
