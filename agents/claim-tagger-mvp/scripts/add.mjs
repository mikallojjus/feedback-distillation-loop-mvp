#!/usr/bin/env node
// Add: bring specific Geo claims into Claims, by Geo link or Geo ID (decisions P35 to P37).
//
//   node agents/claim-tagger-mvp/scripts/add.mjs --claims "<Geo links or IDs, separated by spaces or commas>" [--run-id <id>]
//
//   --claims   each item is a Geo link, <geo.browser_url>/space/<space id>/<entity id> (that host only), or a Geo ID (32 hex characters; dashes are allowed and removed).
//              Any other item is refused as "not a Geo link or ID". More than 50 items (duplicates count once): exit 2 before anything is read.
//
// What it does. The usual frame of a loop script (a fresh pull of every table, the pause and drift checks, the columns the scripts need), then:
//   1. A Geo ID that Claims holds already is reported as "already in Claims" (not an error).
//   2. The others are read from Geo, through lib/geo-read.mjs only (queries only; the request log is runs/<run-id>/geo-requests.jsonl, and a request that is not a query stops the run
//      with exit 2). Not found (a stub), not of the Claim type, not in any of the six configured spaces, or with no name: refused, each with its reason. The space of a row is the
//      link's space when it is configured and holds the entity, else the first configured space (config order) that holds it.
//   3. A claim whose text (normaliseName, as the pick compares) is the same as one in Claims, or as an earlier claim of this command, is refused, and the existing claim is named.
//   4. The row is the pick's row (lib/geo-row.mjs): the nine Geo columns. Geo Space is an option the column has; Geo Tags writes only the option names the column already has (the
//      others are left out and listed in run.json; no option and no column is ever made); a Geo Sources link at a protected id refuses the claim; the links of Geo Sources are
//      written by withLinkedSources, as setup writes them.
//   5. Right before the plan is made, Claims is asked again for those Geo IDs: a row that appeared since the pull (another editor added the claim at the same moment) is dropped as
//      "already in Claims", so no Geo ID is ever in Claims twice (a repeated key stops every loop script).
//   6. The plan (script "add") only CREATES rows with the key and the Geo columns (lib/plan.mjs checks it, and applyPlan checks it again), is applied with the ledger, and every row is
//      read back (applyStep, assertApplied). It never changes an existing row, and it does not tag: the report's Next line sends the editor to /claim-tagger tag.
//
// Production only (P37): a practice page refuses it, and the walkthrough runner does not list it.
//
// The report (lib/report.mjs): one sentence, one table of at most five rows, one Next line. The ids, the reasons and the existing claim of a same-text refusal are in run.json ("add").
//
// Exit codes: 0 ok (at least one claim added and read back), 1 Geo or Notion could not be read, or a write did not finish (the same command continues), 2 invalid (nothing was added; more
// than 50 items; a request to Geo that was not a query; a read-back that differs), 3 paused, 4 drift or a changed rulebook file.
//
// Exports: add, main, USAGE, MAX_CLAIMS, parseItems.

import { join } from 'node:path';
import { EXIT } from './lib/exit-codes.mjs';
import { ADD_SCRIPT, CLAIMS_GEO_COLUMNS, tableEntry } from './lib/config.mjs';
import { listNames, plural, quoted } from './lib/editor-words.mjs';
import { MAX_ROWS } from './lib/report.mjs';
import {
  GEO_ID, GeoError, countGeoRequests, createGeoClient, entityIsStub, geoRequestLogger, validateGeoConfig,
} from './lib/geo-read.mjs';
import { geoRowOf, normaliseName } from './lib/geo-row.mjs';
import {
  LoopExit, applyStep, assertApplied, needClaimColumns, needTables, notionClient, parseCli, resumeLine, runPreflight, takePull, withRun,
} from './lib/loop.mjs';
import { decodePage } from './lib/notion-values.mjs';
import { isMain } from './lib/paths.mjs';
import { newPlan } from './lib/plan.mjs';
import { claimOps, protectedInLinks, sourcePieces, withLinkedSources } from './lib/setup-steps.mjs';

export const MAX_CLAIMS = 50;
export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/add.mjs --claims "<Geo links or IDs, separated by spaces or commas>" [--run-id <id>]';

const ENGINEER = 'Next: ask the engineer to look at the message the script printed.';
const LATER = 'Next: type /claim-tagger add again in a while.';
const WRITE_QUERY_SIZE = 10; // Geo IDs per question in the last look at the table (one `or` filter each)

// the kinds of outcome, in the order of the table; "added" and "already" are not refusals
const KINDS = Object.freeze([
  ['added', 'Added'],
  ['already', 'Already in Claims'],
  ['not_found', 'Not found in Geo'],
  ['not_claim', 'Not a claim'],
  ['not_in_spaces', 'Not in our spaces'],
  ['same_text', 'Same text as a claim in Claims'],
  ['bad_input', 'Not a Geo link or ID'],
  ['no_name', 'No name in Geo'],
  ['source_link', 'Source link refused'],
]);
const LABEL = Object.fromEntries(KINDS);
// the phrase of a kind inside the sentence of a run that added nothing: "nothing was added to Claims: 1 not found in Geo and 2 already in Claims"
const PHRASE = Object.freeze({
  already: (n) => `${n} already in Claims`,
  not_found: (n) => `${n} not found in Geo`,
  not_claim: (n) => `${n} not ${n === 1 ? 'a claim' : 'claims'}`,
  not_in_spaces: (n) => `${n} not in our spaces`,
  same_text: (n) => `${n} with the same text as a claim in Claims`,
  bad_input: (n) => `${n} not ${n === 1 ? 'a Geo link or ID' : 'Geo links or IDs'}`,
  no_name: (n) => `${n} with no name in Geo`,
  source_link: (n) => `${n} with a source link that is refused`,
});

const flat = (v) => String(v ?? '').replace(/-/g, '').toLowerCase();

// ---- the input ----------------------------------------------------------------------------------------------------------------------

/** A hex id with dashes allowed (and removed), or null when it is not 32 hex characters. */
function hexOf(text) {
  if (!/^[0-9a-f-]+$/i.test(text)) return null;
  const id = flat(text);
  return GEO_ID.test(id) ? id : null;
}

/** One item of the input: { raw, ok: true, id, spaceId (of a link, else null) } or { raw, ok: false }. */
function parseItem(raw, geo) {
  const token = raw.replace(/^[<("'“‘]+/, '').replace(/[>)"'”’.;]+$/, ''); // a link pasted between quotes or angle brackets, or with a full stop after it
  const bare = hexOf(token);
  if (bare) return { raw, ok: true, id: bare, spaceId: null };
  let url;
  try {
    url = new URL(token);
  } catch {
    return { raw, ok: false };
  }
  if (url.protocol !== 'https:' || url.host !== new URL(geo.browser_url).host) return { raw, ok: false };
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'space') return { raw, ok: false };
  const spaceId = hexOf(parts[1]);
  const id = hexOf(parts[2]);
  return spaceId && id ? { raw, ok: true, id, spaceId } : { raw, ok: false };
}

/**
 * The items of the --claims text: split at white space and commas, each one a Geo link of the configured host or a Geo ID. A repeated claim counts once (the first link's space
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

// ---- Claims ---------------------------------------------------------------------------------------------------------------------------

/** The option names of a select or multi_select column of the pulled schema ([] when the column is not there). */
function optionsOf(schema, column) {
  const def = schema?.properties?.[column];
  return def ? (def[def.type]?.options ?? []).map((o) => o.name) : [];
}

/**
 * The Geo IDs among `ids` that Claims holds right now: Claims is asked again, filtered, in small groups. This is the last look before the plan is made, because the pull is older
 * than the Geo reads (and another editor may have added the same claim in the meantime). A failure to read ends the run with exit 1 and nothing written.
 */
async function geoIdsNow(ctx, entry, ids) {
  const client = notionClient(ctx);
  const schema = ctx.pull.schema('claims');
  const found = new Set();
  try {
    for (let i = 0; i < ids.length; i += WRITE_QUERY_SIZE) {
      const conditions = ids.slice(i, i + WRITE_QUERY_SIZE).map((id) => ({ property: entry.key, rich_text: { equals: id } }));
      const pages = await client.queryAll(entry.database_id, { filter: conditions.length === 1 ? conditions[0] : { or: conditions } });
      for (const page of pages) found.add(flat(String(decodePage(page, schema).props[entry.key] ?? '').trim()));
    }
  } catch (e) {
    throw new LoopExit(EXIT.ERROR, `Claims could not be read again before writing: ${e?.message ?? e}`, {
      sentence: 'Add: nothing was added, because Notion could not be read.',
      next: LATER,
    });
  }
  return found;
}

// ---- the report -------------------------------------------------------------------------------------------------------------------------

// when the kinds present would make more than five rows, the four that matter most keep their row (in the order of the table) and the others become one row, "Other reasons"
const KEEP_FIRST = Object.freeze(['added', 'already', 'same_text', 'not_found', 'not_claim', 'not_in_spaces', 'bad_input', 'no_name', 'source_link']);

function tableOf(results, sameTextRows) {
  const counts = new Map(KINDS.map(([kind]) => [kind, 0]));
  for (const r of results) counts.set(r.outcome, counts.get(r.outcome) + 1);
  const present = KINDS.filter(([kind]) => counts.get(kind) > 0);
  let shown = present;
  let others = 0;
  if (present.length > MAX_ROWS) {
    const keep = new Set(KEEP_FIRST.filter((kind) => present.some(([k]) => k === kind)).slice(0, MAX_ROWS - 1));
    shown = present.filter(([kind]) => keep.has(kind));
    others = present.filter(([kind]) => !keep.has(kind)).reduce((sum, [kind]) => sum + counts.get(kind), 0);
  }
  const rows = shown.map(([kind, label]) => {
    const n = counts.get(kind);
    if (kind !== 'same_text') return [label, String(n), ''];
    // P36: the report names the existing claim
    return [label, `${n} (${n === 1 ? 'the same' : 'the first has the same'} text as ${quoted(sameTextRows[0].same_as.claim, 40)})`, ''];
  });
  if (others > 0) rows.push(['Other reasons', String(others), '']);
  return rows;
}

// ---- the run ----------------------------------------------------------------------------------------------------------------------------

/** Add the claims. opts: claims (the text of --claims), runId and the hooks of the other loop scripts; geoFetchImpl replaces the fetch of the Geo client (tests). */
export async function add(opts = {}) {
  const claimsText = typeof opts.claims === 'string' ? opts.claims : '';
  return withRun({
    script: 'add', label: 'Add', again: '/claim-tagger add', opts,
    args: { claims: claimsText === '' ? null : claimsText },
    resume: resumeLine('add', claimsText === '' ? [] : ['--claims', claimsText]),
  }, async (ctx) => {
    // production only (P37): a practice page has no add command
    if (ctx.demo) {
      throw new LoopExit(EXIT.INVALID, 'add works on the real Claims table, not on a practice page', {
        sentence: 'Add: nothing was done, because adding claims works on the real Claims table, not on a practice page.',
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

    // 1. the input: checked before anything is read
    const { items } = parseItems(claimsText, geo);
    if (items.length === 0) {
      throw new LoopExit(EXIT.INVALID, `no Geo links or IDs were given\n${USAGE}`, {
        sentence: 'Add: nothing was done, because no Geo links or IDs were given.',
        next: 'Next: type /claim-tagger add with the Geo links or IDs of the claims.',
      });
    }
    if (items.length > MAX_CLAIMS) {
      throw new LoopExit(EXIT.INVALID, `${items.length} items were given; one command takes at most ${MAX_CLAIMS}`, {
        sentence: `Add: nothing was read or added, because ${items.length} links or IDs are more than the ${MAX_CLAIMS} that one command takes.`,
        next: `Next: type /claim-tagger add again with at most ${MAX_CLAIMS} links.`,
      });
    }

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
    const results = items.map((item) => ({ raw: item.raw, geo_id: item.ok ? item.id : null, outcome: item.ok ? null : 'bad_input' }));
    const toRead = [];
    items.forEach((item, i) => {
      if (!item.ok) return;
      if (inClaims.has(item.id)) {
        results[i].outcome = 'already';
        results[i].claim = inClaims.get(item.id).claim;
      } else toRead.push(i);
    });

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
          next: mine ? ENGINEER : LATER,
        });
      }
    }

    // 5. each claim read from Geo: what it is, which space, which row
    const spaceOrder = geo.spaces;
    const rows = new Map(); // geo id -> { row, name }
    const acceptedText = new Map(); // normalised text -> { geo_id, claim } of the claims of this command that will be added
    const unknownTags = [];
    const knownTags = new Set(optionsOf(schema, 'Geo Tags'));
    for (const i of toRead) {
      const item = items[i];
      const r = results[i];
      const entity = entities.get(item.id);
      if (entityIsStub(entity)) {
        r.outcome = 'not_found';
        continue;
      }
      if (!(entity.typeIds ?? []).map(flat).includes(geo.ids.claim_type)) {
        r.outcome = 'not_claim';
        continue;
      }
      const held = new Set((entity.spaceIds ?? []).map(flat));
      const space = (item.spaceId && spaceOrder.find((s) => s.id === item.spaceId && held.has(s.id))) || spaceOrder.find((s) => held.has(s.id));
      if (!space) {
        r.outcome = 'not_in_spaces';
        continue;
      }
      const built = geoRowOf({ entity, id: item.id, fallbackName: '', fallbackCreated: null, space, geo });
      const name = String(built.row['Geo Name'] ?? '').trim();
      const text = normaliseName(name);
      if (name === '' || text === '') {
        r.outcome = 'no_name';
        continue;
      }
      const twin = textInClaims.get(text) ?? acceptedText.get(text);
      if (twin) {
        r.outcome = 'same_text';
        r.same_as = textInClaims.has(text)
          ? { geo_id: twin.geo_id, claim: twin.claim, where: 'Claims' }
          : { geo_id: twin.geo_id, claim: twin.claim, where: 'this command' };
        continue;
      }
      const pieces = sourcePieces(built.row);
      if (protectedInLinks(ctx.config, new Map([[item.id, pieces]])).length > 0) {
        r.outcome = 'source_link';
        continue;
      }
      // Geo Tags: only the option names the column has; the others are left out and listed
      const tags = built.row['Geo Tags'].filter((t) => knownTags.has(t));
      const left = built.row['Geo Tags'].filter((t) => !knownTags.has(t));
      if (left.length) unknownTags.push({ geo_id: item.id, tags: left });
      built.row['Geo Tags'] = tags;
      acceptedText.set(text, { geo_id: item.id, claim: name });
      rows.set(item.id, { row: built.row, pieces, name, space: space.name, index: i });
      r.outcome = 'candidate';
      r.claim = name;
      r.space = space.name;
    }

    // 6. the last look at Claims, right before the plan: a row that appeared since the pull is dropped
    const candidates = [...rows.keys()];
    if (candidates.length > 0) {
      const there = await geoIdsNow(ctx, entry, candidates);
      for (const id of candidates) {
        if (!there.has(id)) continue;
        const { index } = rows.get(id);
        results[index].outcome = 'already';
        results[index].added_meanwhile = true;
        rows.delete(id);
      }
    }

    // 7. the plan: creates of the Geo columns only, Geo Space and Geo Tags with option names that exist, the links of Geo Sources written beside the text
    const columns = CLAIMS_GEO_COLUMNS.filter((c) => schema?.properties?.[c]);
    const toWrite = [...rows.entries()].map(([id, v]) => ({ id, ...v }));
    if (toWrite.length > 0) {
      const spaceOptions = new Set(optionsOf(schema, 'Geo Space'));
      const missing = [...new Set(toWrite.map((v) => v.space))].filter((name) => !spaceOptions.has(name));
      if (missing.length) {
        throw new LoopExit(EXIT.INVALID, `the Geo Space column of Claims has no option for: ${missing.join(', ')}`, {
          sentence: 'Add: nothing was added, because the Claims table does not have the space of a claim as an option.',
          next: ENGINEER,
        });
      }
      const plan = newPlan({ runId: ctx.runId, script: ADD_SCRIPT, rubricEdition: ctx.edition, config: ctx.config, now: ctx.now });
      const ops = claimOps({ rows: toWrite.map((v) => v.row) }, columns, { keyColumn: entry.key });
      for (const op of ops) plan.create('claims', op.key, op.properties);
      const byGeoId = new Map(toWrite.filter((v) => v.pieces.length > 0).map((v) => [v.id, v.pieces]));
      ctx.client = withLinkedSources(notionClient(ctx), byGeoId, {
        column: entry.columns?.sources ?? 'Geo Sources', keyColumn: entry.key, onWarning: (w) => ctx.warnings.push(w),
      });
      const applied = await applyStep(ctx, plan);
      if (!applied.result) {
        throw new LoopExit(EXIT.INVALID, 'the plan was made but not sent, so nothing can be reported as added', { sentence: 'Add: nothing was written to Notion.', next: ENGINEER });
      }
      assertApplied(ctx, applied.result);
      const made = applied.result.created_by_table?.claims ?? {};
      for (const v of toWrite) {
        results[v.index].outcome = made[v.id] ? 'added' : 'already';
        if (made[v.id]) results[v.index].page_id = made[v.id];
      }
    }

    // 8. the report
    const added = results.filter((r) => r.outcome === 'added');
    const counts = Object.fromEntries(KINDS.map(([kind]) => [kind, results.filter((r) => r.outcome === kind).length]));
    ctx.record.add = {
      items: results.length,
      added: added.map((r) => ({ geo_id: r.geo_id, claim: r.claim, space: r.space, page_id: r.page_id })),
      not_added: results.filter((r) => r.outcome !== 'added').map((r) => ({
        item: r.raw, geo_id: r.geo_id, reason: r.outcome, ...(r.same_as ? { same_as: r.same_as } : {}), ...(r.added_meanwhile ? { added_meanwhile: true } : {}), ...(r.claim && r.outcome === 'already' ? { claim: r.claim } : {}),
      })),
      ...(unknownTags.length ? { geo_tags_left_out: unknownTags } : {}),
    };
    const sameTextRows = results.filter((r) => r.outcome === 'same_text');
    const rowsOut = tableOf(results, sameTextRows);
    const header = ['What', 'Result', ''];
    const details = { results, counts };
    if (added.length === 0) {
      const kinds = KINDS.filter(([kind]) => kind !== 'added' && counts[kind] > 0);
      const sentence = kinds.length === 1 && kinds[0][0] === 'already'
        ? `Add: nothing was added, because ${results.length === 1 ? 'the claim is' : `all ${results.length} claims are`} already in Claims.`
        : `Add: nothing was added to Claims: ${listNames(kinds.map(([kind]) => PHRASE[kind](counts[kind])))}.`;
      const onlyThere = kinds.length === 1 && kinds[0][0] === 'already';
      return {
        exit: EXIT.INVALID, message: sentence, sentence, header, rows: rowsOut, next: onlyThere ? 'Next: type /claim-tagger tag to read them.' : 'Next: check the links and type /claim-tagger add again.', details, counts,
      };
    }
    const notAdded = results.length - added.length;
    const names = added.slice(0, 3).map((r) => quoted(r.claim, 40));
    const named = added.length > 3 ? `${names.join(', ')} and more` : listNames(names);
    const sentence = `Add: ${plural(added.length, 'claim')} added to Claims from Geo (${named})${notAdded > 0 ? `; ${notAdded} ${notAdded === 1 ? 'was' : 'were'} not added` : ''}.`;
    return {
      exit: EXIT.OK, sentence, header, rows: rowsOut, next: `Next: type /claim-tagger tag to read ${added.length === 1 ? 'the new claim' : `the ${added.length} new claims`}.`, details, counts,
    };
  });
}

// ---- the command line ----------------------------------------------------------------------------------------------------------------

const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Parse the command line and run; returns the exit code. deps (tests): everything add() takes besides the flags. */
export async function main(argv, io = consoleIo, deps = {}) {
  const parsed = parseCli('add', argv, { claims: { type: 'string' }, 'run-id': { type: 'string' } }, USAGE, io);
  if (parsed.exit !== undefined) return parsed.exit;
  const v = parsed.values;
  try {
    return (await add({ ...deps, io, claims: v.claims, runId: v['run-id'] })).exit;
  } catch (e) {
    io.err(`add: unexpected error: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
