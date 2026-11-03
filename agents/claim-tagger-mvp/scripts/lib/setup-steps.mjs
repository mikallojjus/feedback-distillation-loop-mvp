// The steps of the one-time setup that are not the structure itself: the rows (Rulebook, Claims, the seeded audit decisions,
// the Agent settings row), the first rulebook edition, the canaries and the read-back of everything. scripts/setup.mjs runs them behind
// the builder session; each one is safe to run again, because it pulls the table first and sends only what is not there.
//
//   readTaxonomy(file), readPick(file), readAudit(file)     -> the input files, checked (InputError names what is wrong). readPick reads the Geo pick (setup/geo-claims-pick.json,
//                                                            scripts/geo-pick.mjs, schemas/geo-pick.schema.json, pick_version 1) and refuses the 50-row pick of the first build; each
//                                                            row's source_pieces ({ name, url } in the file) come back as { text, href } pieces whose text is the Geo Sources cell
//   rulebookOps(taxonomy, columns), claimOps(pick, columns), auditOps(audit, claimPages, { only }), settingsProperties({ edition, now })
//                                                            -> [{ key, properties }] / one properties object: what the plans create
//   buildCanaries(taxonomy)                                  -> the rows of evals/canaries.jsonl
//   richTextFromPieces(pieces), withLinkedSources(client, byGeoId)   -> Geo Sources with its links (plans carry plain text only)
//   stepRoot(ctx, { title }) -> the v2 profile only: finds or makes the v2 page under the live hub (notion.root_parent_page_id) and records it as notion.parent_page_id
//   stepStructure(ctx, parts), stepApiCheck(ctx), stepRulebook(ctx, { from }), stepClaims(ctx, { from }), stepSeedAudit(ctx, { from, claims }),
//   stepMigrateDecisions(ctx, { claims }), stepSettings(ctx), stepSeedJudged(ctx, { tags }), stepRubric(ctx, { from }), stepCanaries(ctx, { from }), stepVerify(ctx, { taxonomy, claims, audit })
//                                                            -> { code, lines, errors?, ... }; the caller prints and records the run
//   migrationOps(claims, ledger, tagPages, columns, { only })  -> the plan of migrate-decisions, pure: { claimOps, ledgerOps, summary }
//
// The claims come from the Geo pick (decision P6): 200 rows with the lean Geo columns (Geo Name, Geo ID, Geo URL, Geo Space, Geo Created, Geo Sources, Geo Is factual, Geo Tags,
// Geo Topics). Only the audit claims the pick names in audit.included are seeded and migrated; the pick records the sha256 of the audit file it was made with, and the seed refuses
// another file. A page-id file (setup/claims-pages.json, setup/rulebook-pages.json) of an earlier build is never merged: a key that is not in the input stops the step.
//
// ctx = { root, config, now, run: { id, dir, update(fields) }, log(line), warn(line), restClient(), builderClient({ logFile }) }. Every Notion write is
// a plan applied by lib/plan.mjs (hard rule 1): checked before the first request, sent in order with a ledger, read back page by page.
// The three editor columns of the Claims table (Verified tags, Review status, Challenged tags notes) are written only by migrate-decisions, through a setup plan whose
// "Challenged tags notes" starts with the audit prefix (the one-time seeding exception of hard rule 1: the audit's decisions of 9 October move from the ledger to the
// claims they are about). Neither step writes a reading (Agent reading, Rule, Reading note, Read under) or a claim's Why wrong (the column is retired): on the live copy
// distill reads the audit's disagreements later (READ-DECISIONS.md, decision 73).
// seed-audit writes the audit's decisions into the ledger (Tag decisions), whose columns are the agent's; Paused is never written (an unticked box is
// what a new row has). The ledger's Why wrong of a seeded disagreement is the audit's Agent slip (the reason word; the ledger keeps the column, decision 64).

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CLAIMS_GEO_COLUMNS, JUDGED_COLUMN, RULEBOOK_COLUMNS, SEED_JUDGED_SCRIPT, TABLES, editorColumns, isProtected, isV2, tableEntry, validateConfig } from './config.mjs';
import { EXIT } from './exit-codes.mjs';
import { fileSha256 } from './hash.mjs';
import { readJson, writeJsonAtomic, writeTextAtomic } from './jsonl.mjs';
import {
  StructureError, AUTOMATIC_TYPES, loadStructure, optionColor, planStructure, runStructure, saveStructure, verifyStructure, viewKey, viewUrl, withGeoOptions,
} from './notion-build.mjs';
import { allowedSpaces } from './geo-read.mjs';
import { splitRichText, countRequests } from './notion-rest.mjs';
import { decodePage, normId, sameValue } from './notion-values.mjs';
import { codeRoot } from './paths.mjs';
import { AUDIT_PREFIX, PlanError, applyPlan, checkPlan, firstPageIds, newPlan, readLedger } from './plan.mjs';
import { readRemoved } from './removed.mjs';
import { buildRubric, lockOf, nextEdition, parseExamples, readRubric, writeEdition } from './rubric.mjs';
import { validate } from './validate.mjs';
import { verifyArchive } from './archive.mjs';
import { builderPaths, readJsonOr, writeJsonPretty } from './builder-registry.mjs';
import { listNames, notionUrl, stampOf } from './editor-words.mjs';
import { loadPull, pull, richTextPieces } from '../pull.mjs';

/** An input file or an earlier step that is missing or wrong. Scripts answer it with exit code 2. */
export class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
    this.code = 'INPUT';
  }
}

export const TAG = 'Context-dependent';
export const SETTINGS_NAME = 'Claim tagger';
export const AUDIT_NOTE = 'seeded from the audit of 9 October';
export const NO_REASONING = 'the editor agreed with the auditor; no reasoning was recorded.';

/** "15 Oct 14:22" in local time: the way the reports and Last run summary write a moment (the same function the loop scripts use). */
export const formatWhen = stampOf;

/** The link to a row of the Claims table, the way Notion writes a page address: https://www.notion.so/<page id without dashes>. */
export const claimLink = notionUrl;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const short = (v, n = 70) => {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v ?? null);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const iso = (value, what) => {
  const d = new Date(value);
  if (value === null || value === undefined || Number.isNaN(d.getTime())) throw new InputError(`${what} is not a date or time (${short(value)})`);
  return d.toISOString();
};

// A value the file leaves empty is left unset in Notion.
const filled = (v) => (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) ? undefined : v);

// ---- the input files -----------------------------------------------------------------------------------------------------------------

function readInput(file, what) {
  if (!file || !existsSync(file)) throw new InputError(`${what} does not exist${file ? ` (${file})` : ''}`);
  try {
    return readJson(file);
  } catch (e) {
    throw new InputError(`${what} cannot be read: ${e.message}`);
  }
}

/** setup/taxonomy-issue.json: { read_at, data_source_id, rows: [13 rows], counterparts: [rows] }, checked. */
export function readTaxonomy(file) {
  const t = readInput(file, 'the taxonomy file');
  if (!isPlain(t) || !Array.isArray(t.rows) || t.rows.length === 0) throw new InputError(`the taxonomy file ${file} has no rows`);
  const names = new Set();
  for (const [i, row] of t.rows.entries()) {
    if (!isPlain(row) || typeof row.Name !== 'string' || row.Name.trim() === '') throw new InputError(`the taxonomy file: row ${i + 1} has no Name`);
    if (names.has(row.Name)) throw new InputError(`the taxonomy file: two rows are named "${row.Name}"`);
    names.add(row.Name);
    if (row['Work tags'] !== null && row['Work tags'] !== undefined && !Array.isArray(row['Work tags'])) throw new InputError(`the taxonomy file: "${row.Name}": Work tags must be a list`);
  }
  if (t.counterparts !== undefined && !Array.isArray(t.counterparts)) throw new InputError('the taxonomy file: counterparts must be a list');
  return { ...t, counterparts: t.counterparts ?? [], read_at: iso(t.read_at, 'the taxonomy file\'s read_at') };
}

/** A Geo id the way two of them are compared: dashes and case do not matter. */
const geoKey = (v) => normId(String(v ?? ''));

/** The file setup reads the claims from when it is not given another: the pick that scripts/geo-pick.mjs writes. */
export const PICK_FILE = 'geo-claims-pick.json';
const PICK_HINT = 'the claims are picked from Geo now: node agents/claim-tagger-mvp/scripts/geo-pick.mjs --seed <s> --audit <file>';

let pickSchemaCache = null;
const pickSchema = () => (pickSchemaCache ??= readJson(join(codeRoot(), 'schemas', 'geo-pick.schema.json')));

/** The pieces of a Geo Sources cell for a row of the pick: each source's name linked to its address, one source to a line. The text of the pieces is the row's Geo Sources. */
export function sourcePieces(row) {
  const pieces = [];
  for (const [i, s] of (row.source_pieces ?? []).entries()) {
    if (i > 0) pieces.push({ text: '\n', href: null });
    pieces.push({ text: s.name, href: s.url });
  }
  return pieces;
}

/**
 * setup/geo-claims-pick.json (scripts/geo-pick.mjs, schemas/geo-pick.schema.json, pick_version 1), checked: the schema, one row for each Geo ID, and every audit claim it says it
 * includes is one of its rows. The 50-row pick of the first build (no pick_version) is refused with a pointer to geo-pick.mjs. Each row's source_pieces ({ name, url } in the file)
 * come back as { text, href } pieces, the form the Geo Sources cell and its links are made from; the rest of the pick is as it was read.
 */
export function readPick(file) {
  const p = readInput(file, 'the claims pick');
  if (isPlain(p) && p.pick_version === undefined && Array.isArray(p.rows)) {
    throw new InputError(`the claims pick ${file} is the 50-row pick of the first build (it has no pick_version), which setup no longer reads; ${PICK_HINT}`);
  }
  const verdict = validate(pickSchema(), p);
  if (!verdict.ok) throw new InputError(`the claims pick ${file} is not a Geo pick (schemas/geo-pick.schema.json):\n  - ${verdict.errors.slice(0, 8).join('\n  - ')}\n${PICK_HINT}`);
  const ids = new Set();
  for (const row of p.rows) {
    if (ids.has(row['Geo ID'])) throw new InputError(`the claims pick: the Geo ID ${row['Geo ID']} appears twice`);
    ids.add(row['Geo ID']);
  }
  const stray = p.audit.included.filter((id) => !ids.has(geoKey(id)));
  if (stray.length) throw new InputError(`the claims pick says it includes ${stray.length} audit claim(s) that are not among its rows (${stray.slice(0, 3).join(', ')}${stray.length > 3 ? ', ...' : ''})`);
  return { ...p, rows: p.rows.map((row) => ({ ...row, source_pieces: sourcePieces(row) })) };
}

const OUTCOMES = ['Applies', 'Does not apply'];
const FLAGS = ['Wrong tag', 'Missing tag'];

/** The audit file: { decisions: [{ geo_id, claim, flag, outcome, reasoning }] }, checked. */
export function readAudit(file) {
  const a = readInput(file, 'the audit file');
  if (!isPlain(a) || !Array.isArray(a.decisions) || a.decisions.length === 0) throw new InputError(`the audit file ${file} has no decisions`);
  const ids = new Set();
  for (const [i, d] of a.decisions.entries()) {
    const at = `the audit file: decision ${i + 1}`;
    if (!isPlain(d) || typeof d.geo_id !== 'string' || d.geo_id === '') throw new InputError(`${at} has no geo_id`);
    if (typeof d.claim !== 'string' || d.claim.trim() === '') throw new InputError(`${at} (${d.geo_id}) has no claim text`);
    if (!FLAGS.includes(d.flag)) throw new InputError(`${at} (${d.geo_id}): flag must be one of ${FLAGS.join(', ')}`);
    if (!OUTCOMES.includes(d.outcome)) throw new InputError(`${at} (${d.geo_id}): outcome must be one of ${OUTCOMES.join(', ')}`);
    if (d.reasoning !== null && d.reasoning !== undefined && typeof d.reasoning !== 'string') throw new InputError(`${at} (${d.geo_id}): reasoning must be text or null`);
    if (ids.has(d.geo_id)) throw new InputError(`the audit file: ${d.geo_id} appears twice`);
    ids.add(d.geo_id);
  }
  return a;
}

// ---- what the plans create --------------------------------------------------------------------------------------------------------------

// The columns of a table that setup fills from a file: the structure's, less the ones Notion fills; the config's constants when there is no structure file.
export function columnsOf(root, table) {
  try {
    const structure = loadStructure(root);
    return structure.tables[table].columns.filter((c) => !AUTOMATIC_TYPES.includes(c.type) && c.retired !== true).map((c) => c.name);
  } catch (e) {
    if (!(e instanceof StructureError)) throw e;
    return table === 'rulebook' ? [...RULEBOOK_COLUMNS] : [...CLAIMS_GEO_COLUMNS];
  }
}

/** One create per taxonomy row: every column of the Rulebook that the file fills (null, '' and [] are left unset; page_id is never written). */
export function rulebookOps(taxonomy, columns) {
  return taxonomy.rows.map((row) => {
    const properties = {};
    for (const name of columns) {
      const v = filled(row[name]);
      if (v !== undefined) properties[name] = v;
    }
    properties.Name = row.Name;
    return { key: row.Name, properties };
  });
}

/**
 * One create per picked claim: the Geo columns of the structure that the row carries (a retired column is not one of them), the agent's columns left empty. A value is written the way
 * the column takes it: Geo Space a select name, Geo Created a day (the date's start), Geo Tags a list of option names, Geo Is factual a box (null leaves it unticked), Geo Sources and
 * Geo Topics text. Only a value that is there is written; the plan holds plain values, and the links of Geo Sources go in beside it (withLinkedSources).
 */
export function claimOps(pick, columns, { keyColumn = 'Geo ID', skip = [] } = {}) {
  return pick.rows.map((row) => {
    const properties = {};
    for (const name of columns) {
      if (skip.includes(name) || !Object.hasOwn(row, name)) continue;
      const v = row[name];
      if (typeof v === 'boolean') properties[name] = v;
      else if (typeof v === 'number') {
        if (Number.isFinite(v)) properties[name] = v;
      } else {
        const f = filled(v);
        if (f !== undefined) properties[name] = f;
      }
    }
    properties[keyColumn] = row[keyColumn];
    return { key: row[keyColumn], properties };
  });
}

/** The properties of one seeded decision (CONTRACTS section 8: the one case where a script writes the editor's columns). */
export function auditProperties(decision, claimPageId) {
  const proposal = decision.flag === 'Wrong tag' ? 'Applies' : 'Does not apply'; // "Wrong tag": the agent had applied the tag; "Missing tag": it had not
  const properties = {
    Claim: decision.claim,
    Key: `${decision.geo_id}::${TAG}`,
    Tag: TAG,
    'Agent proposal': proposal,
    'Claim link': claimLink(claimPageId),
    'Tag outcome': decision.outcome,
    'Your reasoning': `${AUDIT_PREFIX}: ${decision.reasoning ?? NO_REASONING}`,
  };
  if (proposal !== decision.outcome) properties['Why wrong'] = 'Agent slip';
  return properties;
}

/** The ops that seed the audit's decisions. `only` is a Set of Geo IDs (the pick's audit.included): the other decisions are not seeded (without it, all of them are). */
export function auditOps(audit, claimPages, { only = null } = {}) {
  const decisions = only ? audit.decisions.filter((d) => only.has(geoKey(d.geo_id))) : audit.decisions;
  const missing = decisions.filter((d) => !claimPages[d.geo_id]).map((d) => d.geo_id);
  if (missing.length) {
    throw new InputError(`${missing.length} audited claim(s) have no row in the Claims table yet (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''}); run "setup.mjs claims" first`);
  }
  return decisions.map((d) => ({ key: `${d.geo_id}::${TAG}`, properties: auditProperties(d, claimPages[d.geo_id]) }));
}

/**
 * Which decisions of the audit file the pick seeds: { decisions, left, included } (the pick's audit.included, in the file's order; `left` the others, each with the reason the pick
 * gives for leaving it out). Throws InputError when `file` is not the audit file the pick was made with (its sha256 is another), or when the pick includes a claim the file does not have.
 * Without `file` the bytes are not compared.
 */
export function auditForPick(audit, pick, file = null) {
  if (file) {
    const have = fileSha256(file);
    if (have !== pick.audit.sha256) {
      throw new InputError(`the audit file ${file} is not the one the pick was made with (its sha256 is ${have.slice(0, 12)}…, the pick recorded ${pick.audit.sha256.slice(0, 12)}…); give the file that geo-pick.mjs was run with (${pick.audit.file})`);
    }
  }
  const included = new Set(pick.audit.included.map(geoKey));
  const known = new Set(audit.decisions.map((d) => geoKey(d.geo_id)));
  const unknown = [...included].filter((id) => !known.has(id));
  if (unknown.length) throw new InputError(`the pick includes ${unknown.length} audit claim(s) that the audit file does not hold (${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? ', ...' : ''})`);
  const reasons = new Map(pick.audit.left_out.map((l) => [geoKey(l.geo_id), l.reason]));
  const decisions = audit.decisions.filter((d) => included.has(geoKey(d.geo_id)));
  const left = audit.decisions.filter((d) => !included.has(geoKey(d.geo_id))).map((d) => ({ geo_id: d.geo_id, claim: d.claim, reason: reasons.get(geoKey(d.geo_id)) ?? 'the pick lists it neither as included nor as left out' }));
  return { decisions, left, included };
}

// Decision 26: the row is created with these three columns only. Paused is an editor's column, and a new row has it unticked, so it is never written.
export function settingsProperties({ edition, now }) {
  return { Name: SETTINGS_NAME, 'Rulebook edition': edition, 'Last run summary': `Setup · ${formatWhen(now)} · ${TABLES.length} tables` };
}

// ---- Geo Sources with its links ------------------------------------------------------------------------------------------------------------

/**
 * Notion rich text for a Geo Sources cell from its pieces ([{ text, href }]): neighbours with the same address are one piece, every piece
 * is cut into text objects of at most 2,000 characters, and a piece with an address carries it as a link. A cell of more than 100 text
 * objects (the most Notion takes) comes back as plain text, links lost, with degraded: true.
 */
export function richTextFromPieces(pieces, { limit = 100 } = {}) {
  const merged = [];
  for (const p of pieces ?? []) {
    if (!p || !p.text) continue;
    const last = merged[merged.length - 1];
    if (last && (last.href ?? null) === (p.href ?? null)) last.text += p.text;
    else merged.push({ text: p.text, href: p.href ?? null });
  }
  const items = [];
  for (const m of merged) {
    for (const chunk of splitRichText(m.text)) items.push(m.href ? { type: 'text', text: { content: chunk.text.content, link: { url: m.href } } } : chunk);
  }
  if (items.length <= limit) return { items, degraded: false };
  return { items: splitRichText(merged.map((m) => m.text).join('')), degraded: true };
}

const joinContent = (rich) => (Array.isArray(rich) ? rich : []).map((p) => p?.text?.content ?? '').join('');

/**
 * A client whose createPage puts the links back into Geo Sources. A plan holds plain values only, so the plan says what the text is and this
 * wrapper adds where its links point (from the pick's source_pieces), when the pieces read as exactly the planned text. Everything else is
 * the client's own; the wrapper sends nothing the plan does not name.
 */
export function withLinkedSources(client, byGeoId, { column = 'Geo Sources', keyColumn = 'Geo ID', onWarning = () => {} } = {}) {
  return {
    ...client,
    async createPage(args) {
      const props = args?.properties ?? {};
      const geoId = joinContent(props[keyColumn]?.rich_text);
      const pieces = byGeoId.get(geoId);
      const planned = props[column]?.rich_text;
      if (!pieces || !planned) return client.createPage(args);
      if (joinContent(planned) !== pieces.map((p) => p.text).join('')) {
        onWarning(`${geoId}: the pieces of ${column} do not read as the planned text, so the cell is written as plain text`);
        return client.createPage(args);
      }
      const { items, degraded } = richTextFromPieces(pieces);
      if (degraded) onWarning(`${geoId}: ${column} has more than 100 pieces, so the cell is written as plain text and its links are lost`);
      return client.createPage({ ...args, properties: { ...props, [column]: { rich_text: items } } });
    },
  };
}

// Notion adds the trailing slash that a bare origin's path gets (https://ai-2027.com comes back as https://ai-2027.com/), so addresses are compared as new URL() writes them; an address it cannot parse is kept as it is.
const normalHref = (href) => { try { return new URL(href).href; } catch { return href; } };
const hrefsOf = (pieces) => [...new Set((pieces ?? []).map((p) => p?.href).filter(Boolean).map(normalHref))].sort();

/** The Geo IDs whose links mention a protected id (dashes ignored). The links go in beside the plan, so checkPlan's scan of the plan cannot see them. */
export function protectedInLinks(config, byGeoId) {
  const needles = [...(config.notion?.protected_database_ids ?? []), ...(config.notion?.protected_page_ids ?? [])].map((id) => normId(id)).filter((id) => id.length >= 8);
  const hits = [];
  for (const [geoId, pieces] of byGeoId) {
    for (const piece of pieces) {
      const flat = String(piece?.href ?? '').replace(/-/g, '').toLowerCase();
      if (flat !== '' && needles.some((n) => flat.includes(n))) hits.push(geoId);
    }
  }
  return [...new Set(hits)];
}

// ---- canaries ------------------------------------------------------------------------------------------------------------------------------

/** The rows of evals/canaries.jsonl: the example claims of Context-dependent (expected apply), then those of its counterpart (expected do_not_apply). */
export function buildCanaries(taxonomy) {
  const row = taxonomy.rows.find((r) => r.Name === TAG);
  if (!row) throw new InputError(`the taxonomy file has no row named "${TAG}", so there are no canaries to build`);
  const counterName = text(row.Counterpart).trim();
  if (counterName === '') throw new InputError(`"${TAG}" has no Counterpart in the taxonomy file, so its do-not-apply canaries cannot be found`);
  const counter = taxonomy.counterparts.find((r) => r.Name === counterName);
  if (!counter) throw new InputError(`the taxonomy file has no counterparts entry named "${counterName}"`);
  const apply = parseExamples(row['Example Claims']);
  const notApply = parseExamples(counter['Example Claims']);
  const both = apply.filter((c) => notApply.includes(c));
  if (both.length) throw new InputError(`the claim "${both[0]}" is an example of both ${TAG} and ${counterName}, so its expected answer is not clear`);
  const rows = [];
  for (const claim of apply) rows.push({ id: `canary-${rows.length + 1}`, tag: TAG, claim, expected: 'apply', source: `example claims of ${TAG}` });
  for (const claim of notApply) rows.push({ id: `canary-${rows.length + 1}`, tag: TAG, claim, expected: 'do_not_apply', source: `example claims of ${counterName}` });
  return rows;
}

// ---- running a plan -------------------------------------------------------------------------------------------------------------------------

const stopped = (code, ...lines) => ({ stop: { code, lines } });

// Pull the tables (and Agent settings, for Paused) with the default-version client; stop on a duplicate key, a missing table or a ticked Paused.
async function readyPull(ctx, tables) {
  const { root, config } = ctx;
  const wanted = [...new Set([...tables, 'agent_settings'])];
  const r = await pull({ root, config, client: ctx.restClient(), tables: wanted, now: ctx.now });
  ctx.run.update({ pull_id: r.pullId });
  for (const w of r.warnings) if (!/^agent_settings: no row yet/.test(w)) ctx.warn(w); // expected until the settings step
  if (r.code !== EXIT.OK) {
    return stopped(r.code, ...r.problems, ...r.duplicates.map((d) => `two rows of ${d.table} have the key "${d.key}"`), 'the table must be fixed by a person before setup goes on');
  }
  for (const t of tables) {
    if (!r.tables.includes(t)) return stopped(EXIT.INVALID, `the table "${t}" is not created yet (its id in config.json is a placeholder); run "setup.mjs databases" first`);
  }
  if (r.paused) return stopped(EXIT.PAUSED, 'Paused is ticked in Agent settings, so nothing was written; a person has to clear it');
  const loaded = loadPull(root, r.pullId, { config });
  return { pullId: r.pullId, loaded, pulled: loaded.pulled(tables), schemas: Object.fromEntries(tables.map((t) => [t, loaded.schema(t)])) };
}

/** The columns of the Claims whose options are taken from the Geo pick (setup.mjs structure --options-from). */
const OPTIONS_FROM_PICK = Object.freeze(['Geo Tags', 'Geo Space']);

// Select values in the ops that are not options of the column in the structure: Notion would make them up, and an option cannot be taken away again.
export function unknownOptions(root, table, ops) {
  let structure;
  try {
    structure = loadStructure(root);
  } catch (e) {
    if (e instanceof StructureError) return []; // no structure file: nothing to compare with
    throw e;
  }
  const columns = new Map(structure.tables[table].columns.map((c) => [c.name, c]));
  const out = [];
  for (const op of ops) {
    for (const [name, value] of Object.entries(op.properties)) {
      const column = columns.get(name);
      if (!column || (column.type !== 'select' && column.type !== 'multi_select')) continue;
      for (const v of Array.isArray(value) ? value : [value]) {
        if (typeof v === 'string' && v !== '' && !column.options.includes(v)) {
          const hint = OPTIONS_FROM_PICK.includes(name) ? ` (the options of ${name} come from the Geo pick: run "setup.mjs structure --options-from <pick file>" and then build again, or take the claim out of the pick)` : '';
          out.push(`"${op.key}": ${name} is "${v}", which is not one of ${column.options.join(', ')}${hint}`);
        }
      }
    }
  }
  return out;
}

function describeFailures(result) {
  const out = [];
  const add = (label, list) => {
    for (const x of list.slice(0, 3)) out.push(`${label}: ${x.key}${x.detail ? ` - ${x.detail}` : ''}`);
    if (list.length > 3) out.push(`${label}: ... and ${list.length - 3} more (see the ledger)`);
  };
  add('failed', result.lists.failed);
  add('read-back differs', result.lists.mismatches);
  add('not read back', result.lists.unchecked);
  add('uncertain', result.lists.uncertain);
  if (result.pending > 0) out.push(`${result.pending} row(s) were not reached`);
  return out;
}

/**
 * Create the rows of one table that are not there yet: pull, drop the ops whose key is in the pull, write the plan, check it with setup: true,
 * apply it (ledger, read-back) and read the result. Returns { code, lines, pages: { key: page_id } (every row of `ops`, old and new), created, existing }.
 */
async function createRows(ctx, { table, label, ops, wrap = (c) => c, rubricEdition = null }) {
  const { root, config } = ctx;
  const unknown = unknownOptions(root, table, ops);
  if (unknown.length) {
    const shown = unknown.slice(0, 10).map((u) => `  ${u}`);
    if (unknown.length > shown.length) shown.push(`  ... and ${unknown.length - shown.length} more`);
    return { code: EXIT.INVALID, lines: [], errors: [`${label}: nothing was written, because Notion would add options that the approved structure does not have:`, ...shown], pages: {}, created: 0, existing: 0 };
  }
  const ready = await readyPull(ctx, [table]);
  if (ready.stop) return { code: ready.stop.code, lines: [], errors: ready.stop.lines, pages: {}, created: 0, existing: 0 };
  const have = ready.pulled[table] ?? {};
  const pages = {};
  for (const op of ops) if (have[op.key]?.page_id) pages[op.key] = have[op.key].page_id;
  const todo = ops.filter((op) => !have[op.key]);
  const existing = ops.length - todo.length;
  if (todo.length === 0) {
    return { code: EXIT.OK, lines: [`${label}: all ${ops.length} rows are in the table already; nothing was written`], pages, created: 0, existing };
  }
  const plan = newPlan({ runId: ctx.run.id, script: 'setup.mjs', rubricEdition, config, now: ctx.now });
  for (const op of todo) plan.create(table, op.key, op.properties);
  const checked = checkPlan(plan, config, { setup: true, root });
  if (!checked.ok) return { code: EXIT.INVALID, lines: [], errors: ['the plan was refused and nothing was sent:', ...checked.problems.map((p) => `  ${p}`)], pages, created: 0, existing };
  let result;
  try {
    const log = (line) => {
      if (!/: done \(read-back ok\)$/.test(line)) ctx.log(line); // the ledger has every row; the screen shows the ones that are not plainly done
    };
    result = await applyPlan({ plan, dir: ctx.run.dir, client: wrap(ctx.restClient()), config, schemas: ready.schemas, pulled: ready.pulled, setup: true, root, now: ctx.now, log });
  } catch (e) {
    if (e instanceof PlanError) return { code: EXIT.INVALID, lines: [], errors: [e.message, ...e.problems.map((p) => `  ${p}`)], pages, created: 0, existing };
    throw e;
  }
  Object.assign(pages, result.created_by_table[table] ?? {});
  const created = Object.keys(result.created_by_table[table] ?? {}).length;
  const lines = [];
  const errors = [];
  if (result.code === EXIT.OK) {
    lines.push(`${label}: ${created} row(s) written and read back ok${existing ? `; ${existing} were there already` : ''}`);
  } else {
    errors.push(`${label}: ${created} of ${todo.length} row(s) written; ${result.code === EXIT.INVALID ? 'a read-back differed' : 'the run stopped'}`, ...describeFailures(result).map((l) => `  ${l}`));
    errors.push('run the same command again: it pulls first and sends only what is not there');
  }
  return { code: result.code, lines, errors, pages, created, existing, result };
}

// ---- the steps -------------------------------------------------------------------------------------------------------------------------------

const defaultPath = (root, name) => join(root, 'setup', name);

/**
 * pages, databases, views, hub (or all four): the structure through the builder client. With a hub block in the structure the tables are made as full-page tables, the pages after
 * them, and the hub part puts the link lines at the top of the hub page and says in plain lines ("hub page: ...") what else on it is out of place. Those lines do not fail the step:
 * the page is put in order by a person (a drag in Notion), and verify is clean only when it is.
 */
export async function stepStructure(ctx, parts) {
  const { root, config } = ctx;
  const structure = loadStructure(root);
  const plan = planStructure(structure, config);
  writeJsonPretty(join(ctx.run.dir, 'structure-plan.json'), plan);
  if (structure.hub && parts.length === 1 && parts[0] === 'pages') {
    ctx.warn('the pages are made before the tables here, so they will stand above them on the hub page; "setup.mjs build" (or databases first) puts them in order');
  }
  const client = ctx.builderClient({ logFile: join(builderPaths(root).dir, 'requests.jsonl') });
  const result = await runStructure({ plan, client, root, config, log: ctx.log, parts });
  const lines = [];
  const errors = [];
  const there = (list) => Object.values(list).filter((x) => x.status === 'exists' || x.status === 'adopted').length;
  const viewList = Object.values(result.views).flatMap((v) => Object.values(v));
  const said = (made, already) => `${made} made${already ? `, ${already} there already` : ''}`;
  if (parts.includes('pages')) lines.push(`pages: ${said(result.created.pages, there(result.pages))}`);
  if (parts.includes('databases')) {
    lines.push(`tables: ${said(result.created.databases, there(result.databases))}`);
    lines.push(`columns: ${result.created.columns} added${Object.keys(result.columns).length ? ` (${Object.entries(result.columns).map(([t, names]) => `${t}: ${names.join(', ')}`).join('; ')})` : ''}`);
    if (result.created.columns_renamed) {
      lines.push(`columns renamed: ${result.created.columns_renamed} (${Object.entries(result.columnsRenamed).map(([t, list]) => `${t}: ${list.map((r) => `${r.from} -> ${r.to}`).join(', ')}`).join('; ')})`);
    }
  }
  if (parts.includes('views')) {
    lines.push(`views: ${said(result.created.views, there(viewList.map((v) => v)))}${result.created.renamed ? `, ${result.created.renamed} renamed` : ''}`);
    // what a view was brought to, in words: the filter, the sorts, the shown columns and their order ("column order"), whether the cells wrap
    const inWords = (what) => what.map((x) => (x === 'columns' ? 'column order' : x)).join(', ');
    const brought = Object.entries(result.updated).flatMap(([t, views]) => Object.entries(views).map(([name, what]) => `${t}: ${name} (${inWords(what)})`));
    const arranged = Object.entries(result.arranged).flatMap(([t, names]) => names.map((name) => `${t}: ${name} (the table's own view)`));
    if (brought.length || arranged.length) lines.push(`views brought to the structure: ${[...brought, ...arranged].join('; ')}`);
  }
  if (result.hub) {
    const note = result.created.hub_note ?? 0;
    const links = result.created.hub_links ?? 0;
    lines.push(`hub page: ${note + links ? `${note ? 'the warning line' : ''}${note && links ? ' and ' : ''}${links ? `${links} link line(s)` : ''} added at the top` : 'the warning line and the link lines are there already'}${result.hub.ok ? '; the body is in order' : ''}`);
    for (const d of result.hub.differences) lines.push(`hub page: ${d.detail}`);
  }
  for (const w of result.warnings) ctx.warn(w);
  let code = result.code;
  const failed = Object.entries(result.views).flatMap(([table, views]) => Object.entries(views).filter(([, v]) => v.status === 'failed').map(([name, v]) => ({ table, name, message: v.message })));
  if (result.stopped) {
    errors.push(`stopped at ${result.stopped.what}: ${result.stopped.message}`, result.stopped.next);
  }
  if (failed.length) {
    for (const f of failed) {
      errors.push(`view "${f.name}" of ${f.table} failed: ${f.message}`);
      const v = structure.views.find((x) => x.table === f.table && x.name === f.name);
      if (v) errors.push(`  to make it by hand: on "${structure.tables[v.table].title}": rows shown: ${v.filter}; sorted by: ${v.sort}; columns: ${v.columns.join(', ')}${v.wrap ? '; cells wrap' : ''}`);
    }
    errors.push('the views could not be made through REST; they can be made through the connector (notion-create-view) or by hand as written above; verify lists what is missing');
    if (code === EXIT.OK) code = EXIT.ERROR;
  }
  return { code, lines, errors, result, viewsFailed: failed, fatal: Boolean(result.stopped) };
}

/**
 * setup.mjs structure --options-from <pick file>: the options of the Claims' two Geo select columns, from files only (no session, no Notion). Geo Tags gets the pick's tag_names
 * (sorted), Geo Space the names of config.geo.allowed_spaces in their order (else config.geo.spaces); the colours follow from the names alone (notion-build optionColor), so they are the same on every run. Writes
 * setup/structure.json when an option changed and says what; run again it says "nothing changed" and does not touch the file. `config` must hold the geo block.
 */
export function stepOptionsFrom(ctx, { pickFile } = {}) {
  const { root, config } = ctx;
  const pick = readPick(pickFile);
  const spaces = allowedSpaces(config?.geo); // geo.allowed_spaces (the six of the pick, then the others add accepts, P39), else geo.spaces
  if (!Array.isArray(spaces) || spaces.length === 0 || spaces.some((s) => typeof s?.name !== 'string' || s.name === '')) {
    throw new InputError('config.json has no geo.spaces (the six spaces of the pick), so the options of Geo Space cannot be set');
  }
  const spaceNames = spaces.map((s) => s.name);
  const known = new Set(spaceNames);
  const strayRows = pick.rows.filter((r) => !known.has(r['Geo Space']));
  if (strayRows.length) throw new InputError(`${strayRows.length} claim(s) of the pick have a Geo Space that is not one of config.json's geo.spaces (${[...new Set(strayRows.map((r) => r['Geo Space']))].slice(0, 3).join(', ')}); the pick and the config disagree`);
  const listed = new Set(pick.tag_names);
  const unlisted = [...new Set(pick.rows.flatMap((r) => r['Geo Tags']))].filter((t) => !listed.has(t));
  if (unlisted.length) throw new InputError(`the pick's tag_names does not list ${unlisted.length} tag(s) that its rows carry (${unlisted.slice(0, 3).join(', ')}); the pick file is not consistent`);
  const structure = loadStructure(root);
  const { structure: next, changes, changed } = withGeoOptions(structure, { tagNames: pick.tag_names, spaceNames });
  const colours = (column, names) => `${column} colours: ${names.map((n) => `${n} ${optionColor('claims', column, n)}`).join(', ')}`;
  const lines = [];
  for (const c of changes) {
    const was = [c.added.length ? `added ${c.added.join(', ')}` : null, c.removed.length ? `removed ${c.removed.join(', ')}` : null, c.reordered ? 'put in order' : null].filter(Boolean);
    const options = next.tables.claims.columns.find((x) => x.name === c.column).options;
    lines.push(was.length ? `structure: ${c.column}: ${was.join('; ')} (${options.length} in all)` : `structure: ${c.column}: its ${options.length} options are the pick's already`);
  }
  if (changed) {
    const file = saveStructure(root, next);
    lines.push(`structure: ${relativePath(root, file)} written`);
    lines.push('structure: a table that is built already keeps the options it has (the build adds no option to a column that is there); verify names the options it lacks. Run this before the first build');
  } else lines.push('structure: nothing changed');
  lines.push(colours('Geo Space', next.tables.claims.columns.find((x) => x.name === 'Geo Space').options));
  lines.push(colours('Geo Tags', next.tables.claims.columns.find((x) => x.name === 'Geo Tags').options));
  return { code: EXIT.OK, lines, changed, changes };
}

const relativePath = (root, file) => file.startsWith(root) ? file.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/') : file;

const placeholderId = (v) => typeof v === 'string' && v.trim().startsWith('<');

/**
 * The v2 root step: the one page the five tables of the v2 profile live on. Under notion.root_parent_page_id (the live hub, which v2 only lists and adds one page to) it
 * lists the block children, adopts the child page whose title is the hub title of the structure (loadStructure(root).hub.title; `--title` when there is no structure yet), or makes it
 * with createPageUnderPage (the call runStructure makes for a page). Then config.json is rewritten atomically: notion.parent_page_id and notion.setup_page_parents become the page, so
 * the build steps (pages, databases, views, hub) build there and nowhere else. Until then they find a placeholder and stop. Every request goes into runs/builder/requests.jsonl.
 * Refuses: a profile that is not v2; a root parent or a found/made page that is on the protected lists; two pages of that title; a parent_page_id that is already set to another
 * page (it is never overwritten). Run again it finds the page it made, changes nothing and says so.
 */
export async function stepRoot(ctx, { title: given } = {}) {
  const { root, config } = ctx;
  if (!isV2(config)) throw new InputError('root is for the v2 profile only (config.json has no "profile": "v2")');
  const parent = config.notion.root_parent_page_id;
  if (typeof parent !== 'string' || normId(parent).length !== 32) throw new InputError('config.json has no notion.root_parent_page_id');
  if (isProtected(config, parent)) throw new InputError('notion.root_parent_page_id is on the protected lists of config.json; nothing is made under it');
  let title = null;
  try {
    title = loadStructure(root).hub?.title ?? null;
  } catch (e) {
    if (!(e instanceof StructureError)) throw e; // no structure file yet: --title stands in
  }
  title = title ?? (typeof given === 'string' && given.trim() !== '' ? given.trim() : null);
  if (!title) throw new InputError('there is no hub title: the structure has no hub block (or no setup/structure.json yet); give --title "<name of the v2 page>"');

  const client = ctx.builderClient({ logFile: join(builderPaths(root).dir, 'requests.jsonl') });
  const listing = await client.retrieveBlockChildren(parent);
  const hits = listing.filter((b) => b?.type === 'child_page' && b.child_page?.title === title);
  if (hits.length > 1) throw new InputError(`more than one page titled "${title}" is under the live hub; keep one, then run root again`);
  let id;
  let status;
  if (hits.length === 1) {
    id = normId(hits[0].id);
    status = 'adopted';
  } else if (!placeholderId(config.notion.parent_page_id) && listing.some((b) => b?.type === 'child_page' && normId(b.id) === normId(config.notion.parent_page_id))) {
    // the page config.json names is under the live hub with another title: the structure's hub title changed (P49), so the page is renamed; nothing else of it changes
    id = normId(config.notion.parent_page_id);
    if (isProtected(config, id)) throw new InputError(`the page ${id} is on the protected lists of config.json; it is not renamed`);
    await client.updatePage(id, { properties: { title: { title: [{ type: 'text', text: { content: title } }] } } });
    status = 'renamed';
  } else {
    const have = config.notion.parent_page_id;
    if (!placeholderId(have)) throw new InputError(`config.json already names the v2 page (${normId(have)}) but no page titled "${title}" is under the live hub; root does not overwrite it`);
    const created = await client.createPageUnderPage({ parentPageId: parent, title });
    id = normId(created.id);
    status = 'created';
  }
  if (isProtected(config, id)) throw new InputError(`the page "${title}" (${id}) is on the protected lists of config.json; it is not used`);
  const have = config.notion.parent_page_id;
  if (!placeholderId(have) && normId(have) !== id) {
    throw new InputError(`config.json names the v2 page as ${normId(have)} but the page titled "${title}" under the live hub is ${id}; root does not overwrite it`);
  }
  const unchanged = normId(have) === id && Array.isArray(config.notion.setup_page_parents) && config.notion.setup_page_parents.length === 1 && normId(config.notion.setup_page_parents[0]) === id;
  if (!unchanged) {
    const next = structuredClone(config);
    next.notion.parent_page_id = id;
    next.notion.setup_page_parents = [id];
    const { ok, errors } = validateConfig(next);
    if (!ok) throw new InputError(`the rewritten config.json would not be valid: ${errors.join('; ')}`);
    writeJsonAtomic(join(root, 'config.json'), next);
    config.notion.parent_page_id = id;
    config.notion.setup_page_parents = [id];
  }
  ctx.run.update({ v2_page: { id, title, status } });
  return { code: EXIT.OK, lines: [`root: the page "${title}" ${status === 'created' ? 'was made' : status === 'renamed' ? 'was renamed to this title' : 'was found'} under the live hub (${id})${unchanged ? '; config.json already names it, nothing changed' : '; config.json now names it as notion.parent_page_id'}`], page: { id, title, status } };
}

/** One GET of the parent page under the builder version: proof that the token and the version work. Reads only. */
export async function stepApiCheck(ctx) {
  const { root, config } = ctx;
  const version = config.notion.builder_api_version;
  const at = ctx.now().toISOString();
  const file = join(builderPaths(root).dir, 'api-check.json');
  const client = ctx.builderClient({ optional: true });
  if (!client) {
    writeJsonPretty(file, { ok: false, version, status: null, at, message: 'there is no NOTION_TOKEN in .env' });
    return { code: EXIT.ERROR, lines: [], errors: ['api-check: there is no NOTION_TOKEN in .env, so nothing was checked'] };
  }
  try {
    await client.retrievePage(config.notion.parent_page_id);
  } catch (e) {
    writeJsonPretty(file, { ok: false, version, status: e?.status ?? null, at, message: String(e?.message ?? e) });
    return { code: EXIT.ERROR, lines: [], errors: [`api-check: the parent page could not be read under Notion-Version ${version}: ${e?.message ?? e}`] };
  }
  writeJsonPretty(file, { ok: true, version, status: 200, at });
  return { code: EXIT.OK, lines: [`api-check: the parent page reads under Notion-Version ${version} (1 GET, no writes)`] };
}

function writePagesFile(file, map) {
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeJsonAtomic(file, sorted);
}

/**
 * The page-id file of an earlier build is never merged into a new one: a file that holds a key the current input does not have (a claim of the old 50-row pick, a tag the taxonomy
 * no longer lists) belongs to another set of tables, and its ids point there. The step stops (exit 2) and says to set the file aside; every key the input does have is written again from
 * the table, so none of the old ids can stay.
 */
function refuseStaleIds(file, keys, what) {
  if (!existsSync(file)) return;
  const current = new Set(keys);
  const stale = Object.keys(readJsonOr(file, {})).filter((k) => !current.has(k));
  if (stale.length === 0) return;
  throw new InputError(`${file} holds ${stale.length} ${what} that the current input does not have (${stale.slice(0, 3).join(', ')}${stale.length > 3 ? ', ...' : ''}): it is the file of an earlier build, and its ids point at tables that are archived. Set it aside (git mv it to setup/archive-2026-10/) and run the step again; ids of an old build are never merged`);
}

/** The 13 rows of the Rulebook from the taxonomy file; setup/rulebook-pages.json keeps { Name: page_id } for the rubric. */
export async function stepRulebook(ctx, { from } = {}) {
  const { root } = ctx;
  const taxonomy = readTaxonomy(from ?? defaultPath(root, 'taxonomy-issue.json'));
  const file = defaultPath(root, 'rulebook-pages.json');
  refuseStaleIds(file, taxonomy.rows.map((r) => r.Name), 'tag(s)');
  const ops = rulebookOps(taxonomy, columnsOf(root, 'rulebook'));
  const done = await createRows(ctx, { table: 'rulebook', label: 'rulebook', ops });
  if (Object.keys(done.pages).length) writePagesFile(file, done.pages); // the whole table as it is now (the rows read plus the rows made): ids of an earlier file are not kept
  return done;
}

/** The picked claims in the Claims table, Geo Sources with its links; setup/claims-pages.json keeps { geo_id: page_id } for the seeded decisions. */
export async function stepClaims(ctx, { from } = {}) {
  const { root, config } = ctx;
  const pick = readPick(from ?? defaultPath(root, PICK_FILE));
  const file = defaultPath(root, 'claims-pages.json');
  refuseStaleIds(file, pick.rows.map((r) => r['Geo ID']), 'claim(s)');
  const entry = tableEntry(config, 'claims');
  // the agent's columns (Agent reading among them) and the editor's three stay empty: a picked row carries the real table's own Review status, notes and relation to the taxonomy, none of which is copied
  const ops = claimOps(pick, columnsOf(root, 'claims'), { keyColumn: entry.key, skip: [...Object.values(entry.write_columns ?? {}), ...editorColumns(config, 'claims')] });
  const sourcesColumn = entry.columns?.sources ?? 'Geo Sources';
  const byGeoId = new Map();
  for (const row of pick.rows) if (hrefsOf(row.source_pieces).length) byGeoId.set(row[entry.key], row.source_pieces);
  const inLinks = protectedInLinks(config, byGeoId);
  if (inLinks.length) throw new InputError(`the links of Geo Sources of ${inLinks.length} claim(s) (${inLinks.slice(0, 3).join(', ')}) point at a protected table or page; protected ids are never written`);
  writeJsonPretty(join(ctx.run.dir, 'rich-text.json'), Object.fromEntries([...byGeoId].map(([id, pieces]) => [id, pieces])));
  const wrap = (client) => withLinkedSources(client, byGeoId, { column: sourcesColumn, keyColumn: entry.key, onWarning: ctx.warn });
  const done = await createRows(ctx, { table: 'claims', label: 'claims', ops, wrap });
  if (Object.keys(done.pages).length) writePagesFile(file, done.pages); // the whole table as it is now (the rows read plus the rows made): ids of an earlier file are not kept
  return done;
}

/**
 * The audit's decisions as decided rows of Tag decisions: the one place a script writes the editor's three columns. Only the claims the pick includes (audit.included) are seeded; the
 * audit file must be the one the pick was made with (the sha256 the pick recorded), and every claim of the file that the pick left out is named with its reason. A pick that includes
 * none seeds nothing and says so. `claims` is the pick (setup/geo-claims-pick.json when not given).
 */
export async function stepSeedAudit(ctx, { from, claims } = {}) {
  const { root } = ctx;
  const pick = readPick(claims ?? defaultPath(root, PICK_FILE));
  const audit = readAudit(from);
  const { decisions, left } = auditForPick(audit, pick, from);
  const leftLines = left.map((l) => `seed-audit: left out of the pick, so not seeded: ${l.geo_id} (${l.reason})`);
  // the file the later checks read: the audit file as it is, byte for byte (the sha256 the pick recorded is of these bytes)
  const copy = () => {
    const target = defaultPath(root, 'audit-decisions.json');
    if (resolve(from) !== resolve(target)) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(from, target);
    }
  };
  if (decisions.length === 0) {
    copy();
    return { code: EXIT.OK, lines: [`seed-audit: the pick includes none of the ${audit.decisions.length} audit claims, so no decision was seeded`, ...leftLines], created: 0, existing: 0, pages: {} };
  }
  const claimPages = readJsonOr(defaultPath(root, 'claims-pages.json'), null);
  if (!claimPages) throw new InputError('setup/claims-pages.json does not exist: run "setup.mjs claims" first');
  const ops = auditOps(audit, claimPages, { only: new Set(decisions.map((d) => geoKey(d.geo_id))) });
  ctx.run.update({ note: AUDIT_NOTE });
  const done = await createRows(ctx, { table: 'tag_decisions', label: 'seed-audit', ops });
  copy();
  if (done.code === EXIT.OK && done.created > 0) done.lines.push(`seed-audit: ${AUDIT_NOTE}`);
  if (done.code === EXIT.OK) done.lines.push(`seed-audit: ${decisions.length} of the ${audit.decisions.length} audit claims are in the pick${left.length ? '; the others:' : ''}`, ...leftLines);
  return done;
}

/**
 * What migrate-decisions writes (CLAIMS-REVIEW.md, section 3), worked out from the pull. `claims` are the rows of norm/claims.jsonl, `ledger` the rows of norm/queue.jsonl,
 * `tagPages` maps a tag name to the page id of its Rulebook row, `columns` is the claims entry's `columns` and `write_columns`.
 *   a claim with ledger rows that hold a decision from the audit (Your reasoning starts with the audit prefix) and no decision of its own yet gets, on the claim:
 *   Verified tags (the tags with outcome Applies), Review status Reviewed and Challenged tags notes (the rows' Your reasoning, which carries "From the audit of 9 October");
 *   and on each of those ledger rows Decided under, the edition the row's proposal was made under (when it records one). The editor fills three claim columns since the reading
 *   of 22 October (READ-DECISIONS.md): no Why wrong is written to the claim, and no reading either (decision 73: on the live copy distill reads the audit's disagreements later,
 *   after a --plan-only review). A claim whose ledger rows have a confidence and no Agent confidence of its own gets the lowest of them (the open rows).
 *   Left alone: a claim that is Reviewed or has any editor column filled already (carried over, or an editor's own work), and a decided ledger row that is not from the
 *   audit (an editor decides on the claim, never a script).
 * Returns { claimOps: [{ key, page_id, properties, expect }], ledgerOps: [{ key, page_id, properties }], summary }.
 */
export function migrationOps(claims, ledger, tagPages, columns, { only = null } = {}) {
  const byGeo = new Map();
  for (const row of ledger) {
    const at = text(row.Key).lastIndexOf('::');
    if (at < 0) continue;
    const geo = text(row.Key).slice(0, at);
    if (!byGeo.has(geo)) byGeo.set(geo, []);
    byGeo.get(geo).push(row);
  }
  const summary = { carried: 0, alreadyCarried: 0, notFromAudit: 0, noClaim: 0, decidedUnder: 0, confidence: 0, notIncluded: 0 };
  const claimOps = [];
  const ledgerOps = [];
  for (const [geo, rows] of [...byGeo].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (only && !only.has(geoKey(geo))) {
      summary.notIncluded += rows.length; // `only`: the audit claims the pick includes; a ledger row for any other claim is left alone
      continue;
    }
    const claim = claims.find((c) => c.geo_id === geo);
    if (!claim) {
      summary.noClaim += rows.length;
      continue;
    }
    const decided = rows.filter((r) => r.decided);
    const audit = decided.filter((r) => text(r['Your reasoning']).startsWith(AUDIT_PREFIX));
    summary.notFromAudit += decided.length - audit.length;
    const properties = {};
    const hasEditorWork = claim.review_status !== null || claim.verified_tags.length > 0 || text(claim.challenged_notes).trim() !== '';
    if (audit.length && hasEditorWork) summary.alreadyCarried += 1;
    if (audit.length && !hasEditorWork) {
      const applies = audit.filter((r) => r['Tag outcome'] === 'Applies').map((r) => r.Tag);
      const missing = applies.filter((t) => !tagPages[t]);
      if (missing.length) throw new InputError(`the claim ${geo} was decided Applies for ${missing.join(', ')}, which has no row in the Rulebook`);
      properties[columns.verified] = applies.map((t) => tagPages[t]);
      properties[columns.review_status] = 'Reviewed';
      properties[columns.notes] = audit.map((r) => text(r['Your reasoning'])).join('\n');
      summary.carried += 1;
      for (const r of audit) {
        const edition = text(r['Rulebook edition']).trim();
        if (edition !== '' && text(r['Decided under']).trim() === '') {
          ledgerOps.push({ key: r.Key, page_id: r.page_id, properties: { 'Decided under': edition } });
          summary.decidedUnder += 1;
        }
      }
    }
    const confidences = rows.map((r) => r['Agent confidence']).filter((v) => typeof v === 'number');
    if (confidences.length && claim.agent_confidence === null) {
      properties[columns.confidence] = Math.round(Math.min(...confidences) * 100) / 100;
      summary.confidence += 1;
    }
    if (Object.keys(properties).length) {
      const editor = Object.hasOwn(properties, columns.review_status);
      claimOps.push({ key: geo, page_id: claim.page_id, properties, ...(editor ? { expect: { [columns.review_status]: null } } : {}) });
    }
  }
  return { claimOps, ledgerOps, summary };
}

/**
 * Carry the 12 earlier rows of Tag decisions over to the claims, once (hard rule 1, the one-time seeding exception): see migrationOps. A plan of updates, checked with setup: true
 * (the editor columns are accepted only on a claim whose Challenged tags notes start with the audit prefix), applied with the ledger, read back page by page. A second run finds
 * everything done and writes nothing.
 */
export async function stepMigrateDecisions(ctx, { claims: pickFile } = {}) {
  const { root, config } = ctx;
  const entry = tableEntry(config, 'claims');
  // only the audit claims the pick includes are carried over (the other decisions of the audit were never seeded)
  const only = new Set(readPick(pickFile ?? defaultPath(root, PICK_FILE)).audit.included.map(geoKey));
  const ready = await readyPull(ctx, ['claims', 'tag_decisions', 'rulebook']);
  if (ready.stop) return { code: ready.stop.code, lines: [], errors: ready.stop.lines };
  const tagPages = {};
  const rulebookKey = tableEntry(config, 'rulebook').key;
  for (const d of ready.loaded.decoded('rulebook')) tagPages[text(d.props[rulebookKey]).trim()] = d.page_id;
  const columns = {
    verified: entry.columns.verified, review_status: entry.columns.review_status, notes: entry.columns.notes, confidence: entry.write_columns.confidence,
  };
  const { claimOps, ledgerOps, summary } = migrationOps(ready.loaded.claims() ?? [], ready.loaded.queue() ?? [], tagPages, columns, { only });
  if (summary.carried > 0) ctx.run.update({ note: AUDIT_NOTE });
  const unknown = unknownOptions(root, 'claims', claimOps);
  if (unknown.length) {
    return { code: EXIT.INVALID, lines: [], errors: ['migrate-decisions: nothing was written, because Notion would add options that the approved structure does not have:', ...unknown.map((u) => `  ${u}`)] };
  }
  const said = `${summary.carried} claim(s) carried over, ${summary.decidedUnder} ledger row(s) got Decided under, ${summary.confidence} claim(s) got Agent confidence`;
  const left = [
    summary.alreadyCarried ? `${summary.alreadyCarried} were carried over already` : null,
    summary.notFromAudit ? `${summary.notFromAudit} decided ledger row(s) are not from the audit and were left (an editor decides on the claim)` : null,
    summary.noClaim ? `${summary.noClaim} ledger row(s) have no claim in the Claims table` : null,
    summary.notIncluded ? `${summary.notIncluded} ledger row(s) are for claims the pick does not include and were left` : null,
  ].filter(Boolean);
  if (claimOps.length + ledgerOps.length === 0) {
    return { code: EXIT.OK, lines: [`migrate-decisions: nothing to carry over${left.length ? `; ${left.join('; ')}` : ''}`], summary };
  }

  const plan = newPlan({ runId: ctx.run.id, script: 'setup.mjs', rubricEdition: readRubric(root)?.edition ?? null, config, now: ctx.now });
  for (const op of claimOps) plan.update('claims', op.key, op.page_id, op.properties, op.expect ? { expect: op.expect } : {});
  for (const op of ledgerOps) plan.update('tag_decisions', op.key, op.page_id, op.properties);
  const checked = checkPlan(plan, config, { setup: true, root });
  if (!checked.ok) return { code: EXIT.INVALID, lines: [], errors: ['the plan was refused and nothing was sent:', ...checked.problems.map((p) => `  ${p}`)] };
  let result;
  try {
    const log = (line) => {
      if (!/: done \(read-back ok\)$/.test(line)) ctx.log(line);
    };
    result = await applyPlan({ plan, dir: ctx.run.dir, client: ctx.restClient(), config, schemas: ready.schemas, pulled: ready.pulled, setup: true, root, now: ctx.now, log });
  } catch (e) {
    if (e instanceof PlanError) return { code: EXIT.INVALID, lines: [], errors: [e.message, ...e.problems.map((p) => `  ${p}`)] };
    throw e;
  }
  if (result.code === EXIT.OK) {
    return { code: EXIT.OK, lines: [`migrate-decisions: ${said}; read back ok${left.length ? `; ${left.join('; ')}` : ''}`, `migrate-decisions: ${AUDIT_NOTE}`], summary, result };
  }
  return {
    code: result.code,
    lines: [],
    errors: [`migrate-decisions: ${result.done} of ${plan.ops.length} write(s) done; ${result.code === EXIT.INVALID ? 'a read-back differed' : 'the run stopped'}`, ...describeFailures(result).map((l) => `  ${l}`), 'run the same command again: it pulls first and sends only what is not there'],
    summary,
    result,
  };
}

/** The one Agent settings row; the edition is the one the rubric step wrote. Paused is not written: a new row is unticked. */
export async function stepSettings(ctx) {
  const { root } = ctx;
  const rubric = readRubric(root);
  if (!rubric) throw new InputError('there is no rulebook edition yet: run "setup.mjs rubric" first');
  const ops = [{ key: SETTINGS_NAME, properties: settingsProperties({ edition: rubric.edition, now: ctx.now() }) }];
  return createRows(ctx, { table: 'agent_settings', label: 'settings', ops, rubricEdition: rubric.edition });
}

/** The names of a --tags value: separated by commas, trimmed, each once, in the order given. */
export function parseTagNames(value) {
  return [...new Set(String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
}

/**
 * seed-judged (decision P53): tick the Judged box on the Rulebook rows of the tags named in `tags` (a comma-separated list), once, so that the agent judges them. The editors own the box
 * (config.editor_columns.rulebook); this step is the one exception, and only for the v2 Rulebook, through a plan of the script "seed-judged" that lib/plan.mjs checkPlan allows to update
 * Judged to true and nothing else. It refuses (exit 2, nothing written): a config that is not v2, a Rulebook that is protected or belongs to the first page, a name that is not a row of
 * the Rulebook, a table without a Judged checkbox (run `setup.mjs build` first), and a stop of the pull (Paused, a duplicate key). A row that is ticked already is left alone and said, and
 * a box is never unticked. The plan is applied and every row read back; plan.jsonl and ledger.jsonl stay in the run folder. Run again it does nothing.
 */
export async function stepSeedJudged(ctx, { tags } = {}) {
  const { root, config } = ctx;
  if (!isV2(config)) throw new InputError('seed-judged is for the v2 profile only (config.json has no "profile": "v2")');
  const names = parseTagNames(tags);
  if (names.length === 0) throw new InputError('seed-judged needs --tags "<tag names separated by commas>"');
  const entry = tableEntry(config, 'rulebook');
  if (isProtected(config, entry.database_id) || isProtected(config, entry.data_source_id)) throw new InputError('the Rulebook is on the protected lists of config.json; nothing is written to it');
  let firstIds;
  try {
    firstIds = firstPageIds(root);
  } catch (e) {
    throw new InputError(e.message);
  }
  if ([entry.database_id, entry.data_source_id].some((x) => typeof x === 'string' && firstIds.has(normId(x)))) throw new InputError('the Rulebook of config.json is a table of the first page (setup/first-page.json), which is never written');

  const ready = await readyPull(ctx, ['rulebook']);
  if (ready.stop) return { code: ready.stop.code, lines: [], errors: ready.stop.lines };
  const have = ready.pulled.rulebook ?? {};
  const unknown = names.filter((n) => !have[n]);
  if (unknown.length) {
    throw new InputError(`nothing was written: ${unknown.map((n) => `"${n}"`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not a row of the Rulebook (it has ${Object.keys(have).sort().join(', ') || 'no rows'})`);
  }
  const judgedColumn = ready.schemas.rulebook?.properties?.[JUDGED_COLUMN];
  if (judgedColumn?.type !== 'checkbox') throw new InputError(`the Rulebook has no ${JUDGED_COLUMN} checkbox yet: run "setup.mjs build" first`);

  const already = names.filter((n) => have[n][JUDGED_COLUMN] === true);
  const todo = names.filter((n) => have[n][JUDGED_COLUMN] !== true);
  if (todo.length === 0) {
    ctx.run.update({ seed_judged: { ticked: [], already } });
    return { code: EXIT.OK, lines: [`seed-judged: ${listNames(names)} ${names.length === 1 ? 'is' : 'are'} ticked already; nothing was written`], ticked: [], already };
  }
  let edition = null;
  try {
    edition = readRubric(root)?.edition ?? null;
  } catch {
    edition = null;
  }
  const plan = newPlan({ runId: ctx.run.id, script: SEED_JUDGED_SCRIPT, rubricEdition: edition, config, now: ctx.now });
  for (const name of todo) plan.update('rulebook', name, have[name].page_id, { [JUDGED_COLUMN]: true }, { expect: { [JUDGED_COLUMN]: false } });
  const checked = checkPlan(plan, config, { root });
  if (!checked.ok) return { code: EXIT.INVALID, lines: [], errors: ['the plan was refused and nothing was sent:', ...checked.problems.map((p) => `  ${p}`)] };
  let result;
  try {
    const log = (line) => {
      if (!/: done \(read-back ok\)$/.test(line)) ctx.log(line);
    };
    result = await applyPlan({ plan, dir: ctx.run.dir, client: ctx.restClient(), config, schemas: ready.schemas, pulled: ready.pulled, root, now: ctx.now, log });
  } catch (e) {
    if (e instanceof PlanError) return { code: EXIT.INVALID, lines: [], errors: [e.message, ...e.problems.map((p) => `  ${p}`)] };
    throw e;
  }
  const ledger = readLedger(ctx.run.dir);
  const ticked = todo.filter((_, i) => ledger.get(i)?.status === 'done' && ledger.get(i)?.read_back === 'ok');
  ctx.run.update({ seed_judged: { ticked, already } });
  if (result.code === EXIT.OK) {
    return {
      code: EXIT.OK,
      lines: [`seed-judged: ${JUDGED_COLUMN} ticked and read back on ${listNames(ticked)}${already.length ? `; ${listNames(already)} ${already.length === 1 ? 'was' : 'were'} ticked already` : ''}`],
      ticked,
      already,
    };
  }
  return {
    code: result.code,
    lines: [],
    errors: [`seed-judged: ${ticked.length} of ${todo.length} tag(s) ticked${ticked.length ? ` (${ticked.join(', ')})` : ''}; ${result.code === EXIT.INVALID ? 'a read-back differed' : 'the run stopped'}`, ...describeFailures(result).map((l) => `  ${l}`),
      'run the same command again: it pulls first and ticks only what is not ticked'],
    ticked,
    already,
  };
}

export const FIRST_EDITION_REASON = 'setup: copied from the taxonomy';
export const FRESH_EDITION_REASON = 'setup: fresh tables under the hub (P9), copied from the taxonomy';

/**
 * The rulebook edition, built from the taxonomy file with the page ids of the Rulebook's rows. Local files only. Three cases:
 *   no edition yet             the first one, edition <today>.1 ("setup: copied from the taxonomy")
 *   an edition in force with the same rules and the same Rulebook page ids as the rows now
 *                              "in force already": its files are checked and nothing changes (a run again says so)
 *   an edition in force with the same rules (the same rubric_hash) but other page ids
 *                              the tables are new (the hub rebuild, P9): the next edition, same rules, the new page ids ("setup: fresh tables under the hub (P9), copied from the
 *                              taxonomy"); the history keeps the old edition
 *   an edition in force with other rules
 *                              refused: a rule changes only through a gate PASS and the promote step
 */
export function stepRubric(ctx, { from } = {}) {
  const { root, config } = ctx;
  const taxonomy = readTaxonomy(from ?? defaultPath(root, 'taxonomy-issue.json'));
  const file = defaultPath(root, 'rulebook-pages.json');
  const pages = readJsonOr(file, null);
  if (!pages) throw new InputError('setup/rulebook-pages.json does not exist: run "setup.mjs rulebook" first');
  refuseStaleIds(file, taxonomy.rows.map((r) => r.Name), 'tag(s)');
  const missing = taxonomy.rows.filter((r) => !pages[r.Name]).map((r) => r.Name);
  if (missing.length) throw new InputError(`${missing.length} tag(s) have no row in the Rulebook yet (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''}); run "setup.mjs rulebook" first`);
  const rows = taxonomy.rows.map((row) => ({ ...row, page_id: pages[row.Name] }));
  const source = {
    database_id: taxonomy.database_id ?? config.notion.sources.taxonomy.database_id,
    data_source_id: taxonomy.data_source_id ?? config.notion.sources.taxonomy.data_source_id,
    read_via: 'connector',
    read_at: taxonomy.read_at,
  };
  const existing = readRubric(root);
  const now = ctx.now();
  // the taxonomy rows have no Judged box (the editors' column of the Rulebook): the ticks of the edition in force stand, so running this step again un-judges nothing
  const judgedFrom = existing ? lockOf(existing) : null;
  let rubric = buildRubric(rows, { config, edition: existing ? existing.edition : nextEdition(null, now), source, now: existing ? existing.built_at : now, judgedFrom });
  let reason = FIRST_EDITION_REASON;
  let verb = 'written';
  if (existing) {
    if (existing.rubric_hash !== rubric.rubric_hash) {
      throw new InputError(`edition ${existing.edition} is in force already with other rules; the rubric step makes the first edition, or the next one when only the Rulebook's page ids are new, and never changes a rule (a rule changes through the safety check and promote)`);
    }
    const theirs = new Map(existing.tags.map((t) => [t.name, t.page_id ? normId(t.page_id) : null]));
    const fresh = rubric.tags.some((t) => (t.page_id ? normId(t.page_id) : null) !== (theirs.get(t.name) ?? null));
    if (fresh) {
      rubric = buildRubric(rows, { config, edition: nextEdition(existing.edition, now), source, now, judgedFrom });
      reason = FRESH_EDITION_REASON;
      verb = `written (the Rulebook is a fresh table, so its page ids are new; the rules are those of edition ${existing.edition})`;
    } else verb = 'is in force already (files checked)';
  }
  const written = writeEdition(root, rubric, { reason });
  ctx.run.update({ rubric_edition: written.edition });
  const withRules = rubric.tags.filter((t) => t.rules.length > 0 && t.capability === 'text').map((t) => t.name); // the Judged boxes are the editors': this step ticks nothing
  return { code: EXIT.OK, lines: [`rubric: edition ${written.edition} ${verb}; ${rubric.tags.length} tags, ${withRules.length} with rules (${withRules.join(', ') || 'none'})`], edition: written.edition };
}

/** evals/canaries.jsonl from the taxonomy file. Frozen afterwards: a file that differs is not overwritten. */
export function stepCanaries(ctx, { from } = {}) {
  const { root } = ctx;
  const taxonomy = readTaxonomy(from ?? defaultPath(root, 'taxonomy-issue.json'));
  const rows = buildCanaries(taxonomy);
  const body = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  const file = join(root, 'evals', 'canaries.jsonl');
  if (existsSync(file)) {
    const same = readFileSync(file, 'utf8').replace(/^\uFEFF/, '') === body;
    if (!same) throw new InputError('evals/canaries.jsonl exists and differs from the taxonomy file; the canaries are frozen until a rule change, so delete the file by hand if you mean to rebuild them');
  } else writeTextAtomic(file, body);
  const apply = rows.filter((r) => r.expected === 'apply').length;
  return { code: EXIT.OK, lines: [`canaries: ${rows.length} rows (${apply} expected to apply, ${rows.length - apply} not) in evals/canaries.jsonl`], rows };
}

// ---- verify ----------------------------------------------------------------------------------------------------------------------------------

async function readRows(client, entry) {
  const ds = await client.retrieveDataSource(entry.data_source_id);
  const pages = await client.queryDataSourceAll(entry.data_source_id);
  return { ds, rows: pages.map((page) => ({ ...decodePage(page, ds), page })) };
}

function sameField(ds, column, expected, found) {
  return sameValue(ds.properties?.[column]?.type ?? null, expected ?? null, found ?? null);
}

function loadChecked(add, table, what, fn) {
  try {
    return fn();
  } catch (e) {
    add(table, 'input', `${what}: ${e.message}`);
    return null;
  }
}

/**
 * Read everything back and compare: the structure, the row counts, the Rulebook against the taxonomy file field by field and against rubric/rubric.json by page id (one per tag), the claims
 * against the pick (Geo IDs, Geo columns, the links of Geo Sources), the seeded decisions, the Agent settings row. Writes runs/builder/verify.json.
 * The Geo IDs of setup/removed-claims.json (remove.mjs, P51) are expected to be absent: a pick claim that was removed is not a missing row, the row-count expectation leaves it out, and a removed
 * claim that is still in Claims is a difference ("removed row").
 */
export async function stepVerify(ctx, { taxonomy: taxonomyFile, claims: claimsFile, audit: auditFile } = {}) {
  const { root, config } = ctx;
  const logFile = join(ctx.run.dir, 'requests.jsonl');
  const client = ctx.builderClient({ logFile });
  const structure = loadStructure(root);
  const differences = [];
  const add = (table, kind, detail) => differences.push({ table, kind, detail });

  const checked = await verifyStructure({ client, config, structure });
  differences.push(...checked.differences);
  // with a hub block (P9 to P11) the archive is read back too: the Archive page under the hub with its link back, what was moved under it, every archived id protected
  if (structure.hub) {
    const archived = await verifyArchive({ client, config, root });
    for (const d of archived.differences) add('archive', d.kind, d.detail);
  }
  // config.json notion.views: the address of every view that exists (the scripts fall back to the table's address for a view that is not there)
  const linked = config.notion?.views ?? {};
  for (const v of structure.views) {
    const found = checked.views?.[v.table]?.[v.name];
    const key = viewKey(v.name);
    const have = linked[key];
    if (found) {
      const database = tableEntry(config, v.table).database_id;
      if (!have) add(v.table, 'view link', `"${v.name}" is in Notion but config.json has no notion.views.${key}; run "setup.mjs views" to record it`);
      else if (normId(have.id) !== normId(found) || have.url !== viewUrl(database, found)) add(v.table, 'view link', `notion.views.${key} in config.json says ${short(have)}, but the view in Notion is ${normId(found)}`);
    } else if (have) add(v.table, 'view link', `notion.views.${key} in config.json links a view that Notion does not have`);
  }

  const data = {};
  const counts = {};
  let addedLater = 0; // Claims rows that are not in the pick: added after setup by /claim-tagger add
  let removedAbsent = 0; // Geo IDs of setup/removed-claims.json that are absent from Claims, as they should be (P51)
  for (const key of TABLES) {
    const entry = tableEntry(config, key);
    if (!normId(entry.data_source_id).match(/^[0-9a-f]{32}$/)) continue; // verifyStructure said "missing table"
    try {
      data[key] = await readRows(client, entry);
      counts[key] = data[key].rows.length;
    } catch (e) {
      add(key, 'row count', `the rows cannot be read (${e.message})`);
    }
  }

  const taxonomy = loadChecked(add, 'rulebook', 'the taxonomy file', () => readTaxonomy(taxonomyFile ?? defaultPath(root, 'taxonomy-issue.json')));
  if (taxonomy && data.rulebook) {
    const { ds, rows } = data.rulebook;
    const keyColumn = tableEntry(config, 'rulebook').key;
    const byName = new Map(rows.map((r) => [text(r.props[keyColumn]).trim(), r]));
    if (rows.length !== taxonomy.rows.length) add('rulebook', 'row count', `${rows.length} rows in the Rulebook, ${taxonomy.rows.length} in the taxonomy file`);
    for (const want of taxonomy.rows) {
      const got = byName.get(want.Name);
      if (!got) {
        add('rulebook', 'missing row', `"${want.Name}" is not in the Rulebook`);
        continue;
      }
      for (const column of columnsOf(root, 'rulebook')) {
        if (column === keyColumn || !ds.properties?.[column]) continue;
        if (!sameField(ds, column, filled(want[column]), got.props[column])) {
          add('rulebook', 'field', `"${want.Name}": ${column} differs (file ${short(want[column] ?? null)}, Notion ${short(got.props[column] ?? null)})`);
        }
      }
    }
    for (const name of byName.keys()) if (!taxonomy.rows.some((r) => r.Name === name)) add('rulebook', 'extra row', `"${name}" is in the Rulebook but not in the taxonomy file`);
  }

  // the edition in force names the Rulebook's rows by page id (rubric/rubric.json, one id per tag): after the fresh tables of the hub (P9) they must be the live rows' ids, else a relation
  // written from the rubric would point at a row of an archived table
  if (data.rulebook) {
    const rubric = loadChecked(add, 'rulebook', 'rubric/rubric.json', () => {
      const found = readRubric(root);
      if (!found) throw new Error('there is no rulebook edition yet (run "setup.mjs rubric"), so its page ids cannot be compared with the Rulebook');
      return found;
    });
    if (rubric) {
      const keyColumn = tableEntry(config, 'rulebook').key;
      const live = new Map(data.rulebook.rows.map((r) => [text(r.props[keyColumn]).trim(), normId(r.page_id)]));
      for (const tag of rubric.tags) {
        const have = tag.page_id ? normId(tag.page_id) : null;
        const row = live.get(tag.name);
        if (!row) add('rulebook', 'rubric page id', `"${tag.name}" is in rubric/rubric.json (edition ${rubric.edition}) but has no row in the Rulebook`);
        else if (have !== row) add('rulebook', 'rubric page id', `"${tag.name}": rubric/rubric.json (edition ${rubric.edition}) holds the page id ${have ?? 'none'}, the Rulebook row is ${row}; run "setup.mjs rubric" to write the edition that names the live rows`);
      }
      for (const name of live.keys()) if (!rubric.tags.some((t) => t.name === name)) add('rulebook', 'rubric page id', `"${name}" is a row of the Rulebook but not a tag of rubric/rubric.json (edition ${rubric.edition})`);
    }
  }

  // P51: the Geo IDs in setup/removed-claims.json (remove.mjs) are expected to be absent from Claims; one that is still there is a difference
  const removed = loadChecked(add, 'claims', 'setup/removed-claims.json', () => readRemoved(root)) ?? { ids: new Set() };
  const pick = loadChecked(add, 'claims', 'the claims pick', () => readPick(claimsFile ?? defaultPath(root, PICK_FILE)));
  if (pick && data.claims) {
    const { ds, rows } = data.claims;
    const entry = tableEntry(config, 'claims');
    const byId = new Map(rows.map((r) => [text(r.props[entry.key]).trim(), r]));
    const wantIds = pick.rows.map((r) => r[entry.key]);
    // a row whose key is a Geo ID (32 hex characters) that is not in the pick was added after setup (/claim-tagger add, P35): it is not a difference, it is counted (verify.json
    // "added_after_setup", an information line). Any other row that is not in the pick is still an extra row. The Geo columns of an added row are not checked: they were read from Geo, not picked.
    // A claim of setup/removed-claims.json is in neither group: it is expected absent (a pick claim that was removed is not a missing row and is not counted in the pick), and a removed claim
    // that is still in the table is a difference of its own, not an extra row or an added one.
    const isRemoved = (id) => removed.ids.has(geoKey(id));
    const removedPick = wantIds.filter(isRemoved);
    const stillThere = [...byId.keys()].filter(isRemoved);
    const addedAfterSetup = [...byId.keys()].filter((id) => !wantIds.includes(id) && /^[0-9a-f]{32}$/.test(id) && !isRemoved(id));
    const expectedRows = pick.rows.length - removedPick.length;
    if (rows.length - addedAfterSetup.length - stillThere.length !== expectedRows) {
      const want = removedPick.length === 0 ? `${pick.rows.length} in the pick` : `${expectedRows} expected (${pick.rows.length} in the pick, ${removedPick.length} of them removed on purpose)`;
      const have = rows.length - stillThere.length;
      add('claims', 'row count', addedAfterSetup.length === 0
        ? `${have} rows in the Claims table, ${want}`
        : `${have - addedAfterSetup.length} rows in the Claims table besides the ${addedAfterSetup.length} added after setup, ${want}`);
    }
    for (const id of stillThere) add('claims', 'removed row', `the claim ${id} was removed (setup/removed-claims.json) but is still in the Claims table`);
    for (const id of wantIds) if (!byId.has(id) && !isRemoved(id)) add('claims', 'missing row', `the claim ${id} is not in the Claims table`);
    for (const id of byId.keys()) if (!wantIds.includes(id) && !addedAfterSetup.includes(id) && !isRemoved(id)) add('claims', 'extra row', `the claim ${id} is in the Claims table but not in the pick`);
    addedLater = addedAfterSetup.length;
    removedAbsent = removed.ids.size - stillThere.length;
    const notGeo = [...Object.values(entry.write_columns ?? {}), ...editorColumns(config, 'claims')];
    const geoColumns = columnsOf(root, 'claims').filter((c) => !notGeo.includes(c) && c !== entry.key);
    for (const want of pick.rows) {
      const got = byId.get(want[entry.key]);
      if (!got) continue;
      for (const column of geoColumns) {
        if (!Object.hasOwn(want, column) || !ds.properties?.[column]) continue;
        const expected = typeof want[column] === 'boolean' || typeof want[column] === 'number' ? want[column] : filled(want[column]);
        if (!sameField(ds, column, expected, got.props[column])) add('claims', 'field', `${want[entry.key]}: ${column} differs (pick ${short(want[column] ?? null)}, Notion ${short(got.props[column] ?? null)})`);
      }
      const wantLinks = hrefsOf(want.source_pieces);
      const gotLinks = hrefsOf(richTextPieces(got.page.properties?.[entry.columns?.sources ?? 'Geo Sources']?.rich_text));
      if (JSON.stringify(wantLinks) !== JSON.stringify(gotLinks)) add('claims', 'links', `${want[entry.key]}: Geo Sources has ${gotLinks.length} link(s) in Notion and ${wantLinks.length} in the pick`);
    }
  }

  // The audit's decisions that were seeded are the pick's audit.included, from the audit file the pick was made with (its sha256). The others are named by the seed step and are not checked.
  // On v2 (P48) nothing is seeded from the audit: the copy filled the tables, and setup/audit-decisions.json lives in setup/v1/. The seeded-row check runs only when an audit file is named
  // with --audit; it then compares Claim, Tag and Tag outcome (the per-claim columns are gone). A missing audit file is not a difference.
  const v2 = isV2(config);
  const auditPath = auditFile ?? (!v2 && existsSync(defaultPath(root, 'audit-decisions.json')) ? defaultPath(root, 'audit-decisions.json') : null);
  const audit = v2 && auditPath === null ? null : loadChecked(add, 'tag_decisions', 'the audit file', () => readAudit(auditPath));
  let seeded = null;
  if (audit && pick) seeded = loadChecked(add, 'tag_decisions', 'the audit file against the pick', () => auditForPick(audit, pick, auditPath));
  else if (audit) add('tag_decisions', 'input', 'the seeded decisions are not checked: they follow the pick (audit.included), and the pick could not be read');
  const decisions = seeded?.decisions ?? [];
  if (seeded && data.tag_decisions) {
    const { ds, rows } = data.tag_decisions;
    const claimPages = readJsonOr(defaultPath(root, 'claims-pages.json'), null);
    const byKey = new Map(rows.map((r) => [text(r.props.Key).trim(), r]));
    for (const d of decisions) {
      const key = `${d.geo_id}::${TAG}`;
      const got = byKey.get(key);
      if (!got && removed.ids.has(geoKey(d.geo_id))) continue; // removed on purpose (P51)
      if (!got) {
        add('tag_decisions', 'seeded row', `"${key}" is not in Tag decisions`);
        continue;
      }
      const want = auditProperties(d, claimPages?.[d.geo_id] ?? '0'.repeat(32));
      if (!claimPages?.[d.geo_id]) delete want['Claim link'];
      for (const column of v2 ? ['Claim', 'Tag', 'Tag outcome'] : ['Claim', 'Tag', 'Agent proposal', 'Claim link', 'Tag outcome', 'Why wrong', 'Your reasoning']) {
        if (!sameField(ds, column, want[column] ?? null, got.props[column])) add('tag_decisions', 'seeded row', `${key}: ${column} differs (expected ${short(want[column] ?? null)}, Notion ${short(got.props[column] ?? null)})`);
      }
      if (!v2 && !text(got.props['Your reasoning']).startsWith(AUDIT_PREFIX)) add('tag_decisions', 'seeded row', `${key}: Your reasoning does not start with "${AUDIT_PREFIX}"`);
    }
    const expectedSeeded = decisions.filter((d) => !removed.ids.has(geoKey(d.geo_id))).length;
    if (rows.length < expectedSeeded) add('tag_decisions', 'row count', `${rows.length} rows in Tag decisions, at least ${expectedSeeded} seeded decisions expected`);
  }

  // the audit's decisions on the claims themselves (migrate-decisions): Reviewed, the Applies tags in the relation, the audit prefix in the notes
  if (seeded && data.claims && !v2) {
    const entry = tableEntry(config, 'claims');
    const rulebookKey = tableEntry(config, 'rulebook').key;
    const names = new Map((data.rulebook?.rows ?? []).map((r) => [normId(r.page_id), text(r.props[rulebookKey]).trim()]));
    const byId = new Map(data.claims.rows.map((r) => [text(r.props[entry.key]).trim(), r]));
    for (const d of decisions) {
      const got = byId.get(d.geo_id);
      if (!got) continue; // the missing claim is reported above
      const p = got.props;
      const here = `${d.geo_id}`;
      if (text(p[entry.columns.review_status]) !== 'Reviewed') {
        add('claims', 'migrated decision', `${here}: Review status is ${short(p[entry.columns.review_status] ?? null)}, not "Reviewed"; run "setup.mjs migrate-decisions"`);
        continue;
      }
      const tags = (p[entry.columns.verified] ?? []).map((id) => names.get(normId(id)) ?? id).sort();
      const wantTags = d.outcome === 'Applies' ? [TAG] : [];
      if (JSON.stringify(tags) !== JSON.stringify(wantTags)) add('claims', 'migrated decision', `${here}: ${entry.columns.verified} holds ${short(tags)}, the audit decided ${short(wantTags)}`);
      if (!text(p[entry.columns.notes]).startsWith(AUDIT_PREFIX)) add('claims', 'migrated decision', `${here}: ${entry.columns.notes} does not start with "${AUDIT_PREFIX}"`);
    }
  }

  if (data.agent_settings) {
    const rows = data.agent_settings.rows;
    const edition = readRubric(root)?.edition ?? null;
    const row = rows.find((r) => r.props.Name === SETTINGS_NAME);
    if (rows.length !== 1) add('agent_settings', 'settings', `${rows.length} rows in Agent settings, 1 expected`);
    if (!row) add('agent_settings', 'settings', `there is no row named "${SETTINGS_NAME}"`);
    else {
      if (row.props.Paused !== false) add('agent_settings', 'settings', 'Paused is ticked');
      if (edition && text(row.props['Rulebook edition']).trim() !== edition) add('agent_settings', 'settings', `Rulebook edition is ${short(row.props['Rulebook edition'])}, the edition in force is ${edition}`);
      if (!text(row.props['Last run summary']).trim()) add('agent_settings', 'settings', 'Last run summary is empty');
    }
  }

  let requests = { total: 0, writes: 0 };
  try {
    requests = countRequests(logFile);
  } catch (e) {
    add('requests', 'requests', `the request log cannot be counted (${e.message})`);
  }
  if (requests.writes !== 0) add('requests', 'requests', `verify sent ${requests.writes} write request(s); it must only read`);

  const report = {
    at: ctx.now().toISOString(), ok: differences.length === 0, differences, counts, ...(addedLater > 0 ? { added_after_setup: addedLater } : {}), ...(removedAbsent > 0 ? { removed_absent: removedAbsent } : {}), requests: { total: requests.total, writes: requests.writes },
  };
  writeJsonPretty(join(builderPaths(root).dir, 'verify.json'), report);
  const lines = [`verify: rows ${TABLES.filter((k) => k in counts).map((k) => `${k} ${counts[k]}`).join(', ')}; ${requests.total} request(s), ${requests.writes} write(s)`];
  if (addedLater > 0) lines.push(`verify: added after setup: ${addedLater}`);
  if (removedAbsent > 0) lines.push(`verify: removed on purpose and absent, as expected (setup/removed-claims.json): ${removedAbsent}`);
  if (differences.length === 0) lines.push('verify: no differences');
  const errors = [];
  if (differences.length) {
    errors.push(`verify: ${differences.length} difference(s)`);
    for (const d of differences.slice(0, 20)) errors.push(`  ${d.table}: ${d.kind} - ${d.detail}`);
    if (differences.length > 20) errors.push(`  ... and ${differences.length - 20} more (runs/builder/verify.json)`);
  }
  return { code: differences.length === 0 ? EXIT.OK : EXIT.INVALID, lines, errors, report };
}
