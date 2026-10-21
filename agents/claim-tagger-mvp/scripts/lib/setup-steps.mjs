// The steps of the one-time setup that are not the structure itself: the rows (Rulebook copy, Claims copy, the seeded audit decisions,
// the Agent settings row), the first rulebook edition, the canaries and the read-back of everything. scripts/setup.mjs runs them behind
// the builder session; each one is safe to run again, because it pulls the table first and sends only what is not there.
//
//   readTaxonomy(file), readPick(file), readAudit(file)     -> the input files, checked (InputError names what is wrong)
//   rulebookOps(taxonomy, columns), claimOps(pick, columns), auditOps(audit, claimPages), settingsProperties({ edition, now })
//                                                            -> [{ key, properties }] / one properties object: what the plans create
//   buildCanaries(taxonomy)                                  -> the rows of evals/canaries.jsonl
//   richTextFromPieces(pieces), withLinkedSources(client, byGeoId)   -> Geo Sources with its links (plans carry plain text only)
//   stepStructure(ctx, parts), stepApiCheck(ctx), stepRulebook(ctx, { from }), stepClaims(ctx, { from }), stepSeedAudit(ctx, { from }),
//   stepMigrateDecisions(ctx), stepSettings(ctx), stepRubric(ctx, { from }), stepCanaries(ctx, { from }), stepVerify(ctx, { taxonomy, claims, audit })
//                                                            -> { code, lines, errors?, ... }; the caller prints and records the run
//   migrationOps(claims, ledger, tagPages, columns)           -> the plan of migrate-decisions, pure: { claimOps, ledgerOps, summary }
//
// ctx = { root, config, now, run: { id, dir, update(fields) }, log(line), warn(line), restClient(), builderClient({ logFile }) }. Every Notion write is
// a plan applied by lib/plan.mjs (hard rule 1): checked before the first request, sent in order with a ledger, read back page by page.
// The four editor columns of the Claims copy are written only by migrate-decisions, through a setup plan whose "Challenged tags notes" starts with the
// audit prefix (the one-time seeding exception of hard rule 1: the audit's decisions of 9 October move from the ledger to the claims they are about).
// seed-audit writes the audit's decisions into the ledger (Tag decisions), whose columns are the agent's; Paused is never written (an unticked box is
// what a new row has).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAIMS_COPY_COLUMNS, RULEBOOK_COLUMNS, TABLES, editorColumns, tableEntry } from './config.mjs';
import { EXIT } from './exit-codes.mjs';
import { readJson, writeJsonAtomic, writeTextAtomic } from './jsonl.mjs';
import { StructureError, AUTOMATIC_TYPES, loadStructure, planStructure, runStructure, verifyStructure, viewKey, viewUrl } from './notion-build.mjs';
import { splitRichText, countRequests } from './notion-rest.mjs';
import { decodePage, normId, sameValue } from './notion-values.mjs';
import { AUDIT_PREFIX, PlanError, applyPlan, checkPlan, newPlan } from './plan.mjs';
import { buildRubric, nextEdition, parseExamples, readRubric, writeEdition } from './rubric.mjs';
import { builderPaths, readJsonOr, writeJsonPretty } from './builder-registry.mjs';
import { notionUrl, stampOf } from './editor-words.mjs';
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

/** The link to a row of the Claims copy, the way Notion writes a page address: https://www.notion.so/<page id without dashes>. */
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

/** setup/claims-pick.json: { seed, rows: [claims with every real column, page_id, url, source_pieces ...] }, checked. */
export function readPick(file) {
  const p = readInput(file, 'the claims pick');
  if (!isPlain(p) || !Array.isArray(p.rows) || p.rows.length === 0) throw new InputError(`the claims pick ${file} has no rows`);
  const ids = new Set();
  for (const [i, row] of p.rows.entries()) {
    if (!isPlain(row) || typeof row['Geo ID'] !== 'string' || row['Geo ID'].trim() === '') throw new InputError(`the claims pick: row ${i + 1} has no Geo ID`);
    if (typeof row['Geo Name'] !== 'string' || row['Geo Name'].trim() === '') throw new InputError(`the claims pick: "${row['Geo ID']}" has no Geo Name`);
    if (ids.has(row['Geo ID'])) throw new InputError(`the claims pick: the Geo ID ${row['Geo ID']} appears twice`);
    ids.add(row['Geo ID']);
  }
  return p;
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
    return table === 'rulebook' ? [...RULEBOOK_COLUMNS] : [...CLAIMS_COPY_COLUMNS];
  }
}

/** One create per taxonomy row: every column of the Rulebook copy that the file fills (null, '' and [] are left unset; page_id is never written). */
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

/** One create per picked claim: the Geo columns of the structure that the row carries (a retired column is not one of them), the agent's columns left empty. */
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

export function auditOps(audit, claimPages) {
  const missing = audit.decisions.filter((d) => !claimPages[d.geo_id]).map((d) => d.geo_id);
  if (missing.length) {
    throw new InputError(`${missing.length} audited claim(s) have no row in the Claims copy yet (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''}); run "setup.mjs claims" first`);
  }
  return audit.decisions.map((d) => ({ key: `${d.geo_id}::${TAG}`, properties: auditProperties(d, claimPages[d.geo_id]) }));
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

const hrefsOf = (pieces) => [...new Set((pieces ?? []).map((p) => p?.href).filter(Boolean))].sort();

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
        if (typeof v === 'string' && v !== '' && !column.options.includes(v)) out.push(`"${op.key}": ${name} is "${v}", which is not one of ${column.options.join(', ')}`);
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
    return { code: EXIT.INVALID, lines: [], errors: [`${label}: nothing was written, because Notion would add options that the approved structure does not have:`, ...unknown.map((u) => `  ${u}`)], pages: {}, created: 0, existing: 0 };
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

/** pages, databases, views (or all three): the structure through the builder client. */
export async function stepStructure(ctx, parts) {
  const { root, config } = ctx;
  const structure = loadStructure(root);
  const plan = planStructure(structure, config);
  writeJsonPretty(join(ctx.run.dir, 'structure-plan.json'), plan);
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
    const brought = Object.entries(result.updated).flatMap(([t, views]) => Object.entries(views).map(([name, what]) => `${t}: ${name} (${what.join(', ')})`));
    const arranged = Object.entries(result.arranged).flatMap(([t, names]) => names.map((name) => `${t}: ${name} (column order)`));
    if (brought.length || arranged.length) lines.push(`views brought to the structure: ${[...brought, ...arranged].join('; ')}`);
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

/** The 13 rows of the Rulebook copy from the taxonomy file; setup/rulebook-pages.json keeps { Name: page_id } for the rubric. */
export async function stepRulebook(ctx, { from } = {}) {
  const { root } = ctx;
  const taxonomy = readTaxonomy(from ?? defaultPath(root, 'taxonomy-issue.json'));
  const ops = rulebookOps(taxonomy, columnsOf(root, 'rulebook'));
  const done = await createRows(ctx, { table: 'rulebook', label: 'rulebook', ops });
  const file = defaultPath(root, 'rulebook-pages.json');
  if (Object.keys(done.pages).length) writePagesFile(file, { ...readJsonOr(file, {}), ...done.pages });
  return done;
}

/** The picked claims in the Claims copy, Geo Sources with its links; setup/claims-pages.json keeps { geo_id: page_id } for the seeded decisions. */
export async function stepClaims(ctx, { from } = {}) {
  const { root, config } = ctx;
  const pick = readPick(from ?? defaultPath(root, 'claims-pick.json'));
  const entry = tableEntry(config, 'claims_copy');
  // the agent's columns and the editor's four stay empty: a picked row carries the real table's own Review status, notes and relation to the taxonomy, none of which is copied
  const ops = claimOps(pick, columnsOf(root, 'claims_copy'), { keyColumn: entry.key, skip: [...Object.values(entry.write_columns ?? {}), ...editorColumns(config, 'claims_copy')] });
  const sourcesColumn = entry.columns?.sources ?? 'Geo Sources';
  const byGeoId = new Map();
  for (const row of pick.rows) if (hrefsOf(row.source_pieces).length) byGeoId.set(row[entry.key], row.source_pieces);
  const inLinks = protectedInLinks(config, byGeoId);
  if (inLinks.length) throw new InputError(`the links of Geo Sources of ${inLinks.length} claim(s) (${inLinks.slice(0, 3).join(', ')}) point at a protected table or page; protected ids are never written`);
  writeJsonPretty(join(ctx.run.dir, 'rich-text.json'), Object.fromEntries([...byGeoId].map(([id, pieces]) => [id, pieces])));
  const wrap = (client) => withLinkedSources(client, byGeoId, { column: sourcesColumn, keyColumn: entry.key, onWarning: ctx.warn });
  const done = await createRows(ctx, { table: 'claims_copy', label: 'claims', ops, wrap });
  const file = defaultPath(root, 'claims-pages.json');
  if (Object.keys(done.pages).length) writePagesFile(file, { ...readJsonOr(file, {}), ...done.pages });
  return done;
}

/** The audit's decisions as decided rows of Tag decisions: the one place a script writes the editor's three columns. */
export async function stepSeedAudit(ctx, { from } = {}) {
  const { root } = ctx;
  const audit = readAudit(from);
  const claimPages = readJsonOr(defaultPath(root, 'claims-pages.json'), null);
  if (!claimPages) throw new InputError('setup/claims-pages.json does not exist: run "setup.mjs claims" first');
  const ops = auditOps(audit, claimPages);
  ctx.run.update({ note: AUDIT_NOTE });
  const done = await createRows(ctx, { table: 'tag_decisions', label: 'seed-audit', ops });
  // the file the later checks read: the decisions that were seeded
  writeJsonAtomic(defaultPath(root, 'audit-decisions.json'), audit);
  if (done.code === EXIT.OK && done.created > 0) done.lines.push(`seed-audit: ${AUDIT_NOTE}`);
  return done;
}

/**
 * What migrate-decisions writes (CLAIMS-REVIEW.md, section 3), worked out from the pull. `claims` are the rows of norm/claims.jsonl, `ledger` the rows of norm/queue.jsonl,
 * `tagPages` maps a tag name to the page id of its Rulebook copy row, `columns` is the claims entry's `columns` and `write_columns`.
 *   a claim with ledger rows that hold a decision from the audit (Your reasoning starts with the audit prefix) and no decision of its own yet gets, on the claim:
 *   Verified tags (the tags with outcome Applies), Review status Reviewed, Why wrong (the ledger's, else Agent slip) and Challenged tags notes (the rows'
 *   Your reasoning, which carries "From the audit of 9 October"); and on each of those ledger rows Decided under, the edition the row's proposal was made under (when it
 *   records one). A claim whose ledger rows have a confidence and no Agent confidence of its own gets the lowest of them (the open rows).
 *   Left alone: a claim that is Reviewed or has any editor column filled already (carried over, or an editor's own work), and a decided ledger row that is not from the
 *   audit (an editor decides on the claim, never a script).
 * Returns { claimOps: [{ key, page_id, properties, expect }], ledgerOps: [{ key, page_id, properties }], summary }.
 */
export function migrationOps(claims, ledger, tagPages, columns) {
  const byGeo = new Map();
  for (const row of ledger) {
    const at = text(row.Key).lastIndexOf('::');
    if (at < 0) continue;
    const geo = text(row.Key).slice(0, at);
    if (!byGeo.has(geo)) byGeo.set(geo, []);
    byGeo.get(geo).push(row);
  }
  const summary = { carried: 0, alreadyCarried: 0, notFromAudit: 0, noClaim: 0, decidedUnder: 0, confidence: 0 };
  const claimOps = [];
  const ledgerOps = [];
  for (const [geo, rows] of [...byGeo].sort(([a], [b]) => (a < b ? -1 : 1))) {
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
      if (missing.length) throw new InputError(`the claim ${geo} was decided Applies for ${missing.join(', ')}, which has no row in the Rulebook copy`);
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
export async function stepMigrateDecisions(ctx) {
  const { root, config } = ctx;
  const entry = tableEntry(config, 'claims_copy');
  const ready = await readyPull(ctx, ['claims_copy', 'tag_decisions', 'rulebook']);
  if (ready.stop) return { code: ready.stop.code, lines: [], errors: ready.stop.lines };
  const tagPages = {};
  const rulebookKey = tableEntry(config, 'rulebook').key;
  for (const d of ready.loaded.decoded('rulebook')) tagPages[text(d.props[rulebookKey]).trim()] = d.page_id;
  const columns = {
    verified: entry.columns.verified, review_status: entry.columns.review_status, notes: entry.columns.notes, confidence: entry.write_columns.confidence,
  };
  const { claimOps, ledgerOps, summary } = migrationOps(ready.loaded.claims() ?? [], ready.loaded.queue() ?? [], tagPages, columns);
  if (summary.carried > 0) ctx.run.update({ note: AUDIT_NOTE });
  const unknown = unknownOptions(root, 'claims_copy', claimOps);
  if (unknown.length) {
    return { code: EXIT.INVALID, lines: [], errors: ['migrate-decisions: nothing was written, because Notion would add options that the approved structure does not have:', ...unknown.map((u) => `  ${u}`)] };
  }
  const said = `${summary.carried} claim(s) carried over, ${summary.decidedUnder} ledger row(s) got Decided under, ${summary.confidence} claim(s) got Agent confidence`;
  const left = [
    summary.alreadyCarried ? `${summary.alreadyCarried} were carried over already` : null,
    summary.notFromAudit ? `${summary.notFromAudit} decided ledger row(s) are not from the audit and were left (an editor decides on the claim)` : null,
    summary.noClaim ? `${summary.noClaim} ledger row(s) have no claim in the Claims copy` : null,
  ].filter(Boolean);
  if (claimOps.length + ledgerOps.length === 0) {
    return { code: EXIT.OK, lines: [`migrate-decisions: nothing to carry over${left.length ? `; ${left.join('; ')}` : ''}`], summary };
  }

  const plan = newPlan({ runId: ctx.run.id, script: 'setup.mjs', rubricEdition: readRubric(root)?.edition ?? null, config, now: ctx.now });
  for (const op of claimOps) plan.update('claims_copy', op.key, op.page_id, op.properties, op.expect ? { expect: op.expect } : {});
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

/** The first rulebook edition, built from the taxonomy file with the page ids of the Rulebook copy's rows. Local files only. */
export function stepRubric(ctx, { from } = {}) {
  const { root, config } = ctx;
  const taxonomy = readTaxonomy(from ?? defaultPath(root, 'taxonomy-issue.json'));
  const pages = readJsonOr(defaultPath(root, 'rulebook-pages.json'), null);
  if (!pages) throw new InputError('setup/rulebook-pages.json does not exist: run "setup.mjs rulebook" first');
  const missing = taxonomy.rows.filter((r) => !pages[r.Name]).map((r) => r.Name);
  if (missing.length) throw new InputError(`${missing.length} tag(s) have no row in the Rulebook copy yet (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''}); run "setup.mjs rulebook" first`);
  const rows = taxonomy.rows.map((row) => ({ ...row, page_id: pages[row.Name] }));
  const source = {
    database_id: taxonomy.database_id ?? config.notion.sources.taxonomy.database_id,
    data_source_id: taxonomy.data_source_id ?? config.notion.sources.taxonomy.data_source_id,
    read_via: 'connector',
    read_at: taxonomy.read_at,
  };
  const existing = readRubric(root);
  const now = ctx.now();
  const rubric = buildRubric(rows, { config, edition: existing ? existing.edition : nextEdition(null, now), source, now: existing ? existing.built_at : now });
  if (existing && existing.rubric_hash !== rubric.rubric_hash) {
    throw new InputError(`edition ${existing.edition} is in force already with other rules; the rubric step only makes the first edition`);
  }
  const written = writeEdition(root, rubric, { reason: 'setup: copied from the taxonomy' });
  ctx.run.update({ rubric_edition: written.edition });
  const judged = rubric.tags.filter((t) => t.judged).map((t) => t.name);
  const verb = existing ? 'is in force already (files checked)' : 'written';
  return { code: EXIT.OK, lines: [`rubric: edition ${written.edition} ${verb}; ${rubric.tags.length} tags, ${judged.length} with rules (${judged.join(', ') || 'none'})`], edition: written.edition };
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
 * Read everything back and compare: the structure, the row counts, the Rulebook copy against the taxonomy file field by field, the claims
 * against the pick (Geo IDs, Geo columns, the links of Geo Sources), the seeded decisions, the Agent settings row. Writes runs/builder/verify.json.
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
    if (rows.length !== taxonomy.rows.length) add('rulebook', 'row count', `${rows.length} rows in the Rulebook copy, ${taxonomy.rows.length} in the taxonomy file`);
    for (const want of taxonomy.rows) {
      const got = byName.get(want.Name);
      if (!got) {
        add('rulebook', 'missing row', `"${want.Name}" is not in the Rulebook copy`);
        continue;
      }
      for (const column of columnsOf(root, 'rulebook')) {
        if (column === keyColumn || !ds.properties?.[column]) continue;
        if (!sameField(ds, column, filled(want[column]), got.props[column])) {
          add('rulebook', 'field', `"${want.Name}": ${column} differs (file ${short(want[column] ?? null)}, Notion ${short(got.props[column] ?? null)})`);
        }
      }
    }
    for (const name of byName.keys()) if (!taxonomy.rows.some((r) => r.Name === name)) add('rulebook', 'extra row', `"${name}" is in the Rulebook copy but not in the taxonomy file`);
  }

  const pick = loadChecked(add, 'claims_copy', 'the claims pick', () => readPick(claimsFile ?? defaultPath(root, 'claims-pick.json')));
  if (pick && data.claims_copy) {
    const { ds, rows } = data.claims_copy;
    const entry = tableEntry(config, 'claims_copy');
    const byId = new Map(rows.map((r) => [text(r.props[entry.key]).trim(), r]));
    const wantIds = pick.rows.map((r) => r[entry.key]);
    if (rows.length !== pick.rows.length) add('claims_copy', 'row count', `${rows.length} rows in the Claims copy, ${pick.rows.length} in the pick`);
    for (const id of wantIds) if (!byId.has(id)) add('claims_copy', 'missing row', `the claim ${id} is not in the Claims copy`);
    for (const id of byId.keys()) if (!wantIds.includes(id)) add('claims_copy', 'extra row', `the claim ${id} is in the Claims copy but not in the pick`);
    const notGeo = [...Object.values(entry.write_columns ?? {}), ...editorColumns(config, 'claims_copy')];
    const geoColumns = columnsOf(root, 'claims_copy').filter((c) => !notGeo.includes(c) && c !== entry.key);
    for (const want of pick.rows) {
      const got = byId.get(want[entry.key]);
      if (!got) continue;
      for (const column of geoColumns) {
        if (!Object.hasOwn(want, column) || !ds.properties?.[column]) continue;
        const expected = typeof want[column] === 'boolean' || typeof want[column] === 'number' ? want[column] : filled(want[column]);
        if (!sameField(ds, column, expected, got.props[column])) add('claims_copy', 'field', `${want[entry.key]}: ${column} differs (pick ${short(want[column] ?? null)}, Notion ${short(got.props[column] ?? null)})`);
      }
      const wantLinks = hrefsOf(want.source_pieces);
      const gotLinks = hrefsOf(richTextPieces(got.page.properties?.[entry.columns?.sources ?? 'Geo Sources']?.rich_text));
      if (JSON.stringify(wantLinks) !== JSON.stringify(gotLinks)) add('claims_copy', 'links', `${want[entry.key]}: Geo Sources has ${gotLinks.length} link(s) in Notion and ${wantLinks.length} in the pick`);
    }
  }

  const auditPath = auditFile ?? (existsSync(defaultPath(root, 'audit-decisions.json')) ? defaultPath(root, 'audit-decisions.json') : null);
  const audit = loadChecked(add, 'tag_decisions', 'the audit file', () => readAudit(auditPath));
  if (audit && data.tag_decisions) {
    const { ds, rows } = data.tag_decisions;
    const claimPages = readJsonOr(defaultPath(root, 'claims-pages.json'), null);
    const byKey = new Map(rows.map((r) => [text(r.props.Key).trim(), r]));
    for (const d of audit.decisions) {
      const key = `${d.geo_id}::${TAG}`;
      const got = byKey.get(key);
      if (!got) {
        add('tag_decisions', 'seeded row', `"${key}" is not in Tag decisions`);
        continue;
      }
      const want = auditProperties(d, claimPages?.[d.geo_id] ?? '0'.repeat(32));
      if (!claimPages?.[d.geo_id]) delete want['Claim link'];
      for (const column of ['Claim', 'Tag', 'Agent proposal', 'Claim link', 'Tag outcome', 'Why wrong', 'Your reasoning']) {
        if (!sameField(ds, column, want[column] ?? null, got.props[column])) add('tag_decisions', 'seeded row', `${key}: ${column} differs (expected ${short(want[column] ?? null)}, Notion ${short(got.props[column] ?? null)})`);
      }
      if (!text(got.props['Your reasoning']).startsWith(AUDIT_PREFIX)) add('tag_decisions', 'seeded row', `${key}: Your reasoning does not start with "${AUDIT_PREFIX}"`);
    }
    if (rows.length < audit.decisions.length) add('tag_decisions', 'row count', `${rows.length} rows in Tag decisions, at least ${audit.decisions.length} seeded decisions expected`);
  }

  // the audit's decisions on the claims themselves (migrate-decisions): Reviewed, the Applies tags in the relation, the audit prefix in the notes
  if (audit && data.claims_copy) {
    const entry = tableEntry(config, 'claims_copy');
    const rulebookKey = tableEntry(config, 'rulebook').key;
    const names = new Map((data.rulebook?.rows ?? []).map((r) => [normId(r.page_id), text(r.props[rulebookKey]).trim()]));
    const byId = new Map(data.claims_copy.rows.map((r) => [text(r.props[entry.key]).trim(), r]));
    for (const d of audit.decisions) {
      const got = byId.get(d.geo_id);
      if (!got) continue; // the missing claim is reported above
      const p = got.props;
      const here = `${d.geo_id}`;
      if (text(p[entry.columns.review_status]) !== 'Reviewed') {
        add('claims_copy', 'migrated decision', `${here}: Review status is ${short(p[entry.columns.review_status] ?? null)}, not "Reviewed"; run "setup.mjs migrate-decisions"`);
        continue;
      }
      const tags = (p[entry.columns.verified] ?? []).map((id) => names.get(normId(id)) ?? id).sort();
      const wantTags = d.outcome === 'Applies' ? [TAG] : [];
      if (JSON.stringify(tags) !== JSON.stringify(wantTags)) add('claims_copy', 'migrated decision', `${here}: ${entry.columns.verified} holds ${short(tags)}, the audit decided ${short(wantTags)}`);
      if (!text(p[entry.columns.notes]).startsWith(AUDIT_PREFIX)) add('claims_copy', 'migrated decision', `${here}: ${entry.columns.notes} does not start with "${AUDIT_PREFIX}"`);
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

  const report = { at: ctx.now().toISOString(), ok: differences.length === 0, differences, counts, requests: { total: requests.total, writes: requests.writes } };
  writeJsonPretty(join(builderPaths(root).dir, 'verify.json'), report);
  const lines = [`verify: rows ${TABLES.filter((k) => k in counts).map((k) => `${k} ${counts[k]}`).join(', ')}; ${requests.total} request(s), ${requests.writes} write(s)`];
  if (differences.length === 0) lines.push('verify: no differences');
  const errors = [];
  if (differences.length) {
    errors.push(`verify: ${differences.length} difference(s)`);
    for (const d of differences.slice(0, 20)) errors.push(`  ${d.table}: ${d.kind} - ${d.detail}`);
    if (differences.length > 20) errors.push(`  ... and ${differences.length - 20} more (runs/builder/verify.json)`);
  }
  return { code: differences.length === 0 ? EXIT.OK : EXIT.INVALID, lines, errors, report };
}
