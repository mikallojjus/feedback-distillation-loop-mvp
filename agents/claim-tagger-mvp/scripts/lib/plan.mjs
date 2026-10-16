// Plans: the only thing that may become a Notion write (CONTRACTS section 8, hard rule 1).
//
//   newPlan({ runId, script, rubricEdition, config?, now? })    -> a builder: create(), update(), ops, header(), write(dir), readPlan
//   readPlan(dir)                                                -> { header, ops, dir, file } read from <dir>/plan.jsonl, every line validated
//   checkPlan(plan, config, { setup, root, demoEditor })         -> { ok, problems, counts } before any request is made
//   applyPlan({ plan, dir, client, config, schemas, pulled,      -> { code, done, failed, skipped, mismatches, uncertain, unchecked,
//              log, setup, root, now, demoEditor })                  created, created_by_table, already_done, stopped, ledger, lists }
//   isDemoRoot(root)                                             -> true for a state folder directly under .../runs/demos/ (a practice page)
//   readLedger(dir)                                              -> Map of op_index -> the last ledger line of that op
//   compareWritten(planned, props, schema)                       -> the columns whose value read back differs from what was written
//
// A plan is runs/<run-id>/plan.jsonl: a header line { "plan": { run_id, script, created_at, rubric_edition, counts } } and then one
// op per line { op, table, key, page_id (update only), properties, expect, children } (schemas/plan.schema.json). Values are plain:
// strings, numbers, booleans, null, lists of strings. The tables are rulebook, claims_copy, tag_decisions, rule_changes and
// agent_settings, and a create carries its key column in its properties (the builder adds it when it is given the config).
//
// applyPlan is the only code that turns a plan into requests. It checks the plan again, makes sure the plan file on disk is the plan
// it is about to send, encodes every value with the table's schema before the first request, then sends the ops in order through the
// REST client, appends one ledger line per op ({ op_index, key, page_id, status, read_back, error, at } plus table, op and sent) and
// reads every written page back. It never sends a second create for a key that exists: a key found in `pulled` is skipped, and a
// create whose earlier answer was lost (create_uncertain) is resolved by that key on the next run.
//
// Ledger statuses: done (read_back ok, mismatch or unchecked), failed, skipped (error says "skipped: expect" or "skipped: exists"),
// uncertain. A resumed run sends nothing again for a done op; one whose read-back was not ok is read back again (never written again).

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  RULE_CHANGES_AGENT_STATUS, TABLES, editorColumns, tableEntry, writableProperties,
} from './config.mjs';
import { EXIT } from './exit-codes.mjs';
import { appendJsonl, readJson, readJsonl, writeTextAtomic } from './jsonl.mjs';
import { decodePage, encodeProperties, normId, sameValue } from './notion-values.mjs';
import { agentRoot, codeFile } from './paths.mjs';
import { validate } from './validate.mjs';

/** The start of "Challenged tags notes" on a claim that the setup seeds from the audit: the one way a setup plan writes the editor's four claims columns. */
export const AUDIT_PREFIX = 'From the audit of 9 October';
/** Consecutive failed ops after which applyPlan stops (a resumed run goes on from there). */
export const MAX_CONSECUTIVE_FAILURES = 3;

const DEFAULT_KEYS = Object.freeze({
  rulebook: 'Name', claims_copy: 'Geo ID', tag_decisions: 'Key', rule_changes: 'Lesson', agent_settings: 'Name',
});

/** The tables whose rows an agent acting as the editor on a practice page may update (decision D31): the claims (the four editor columns) and the rule changes. */
export const DEMO_EDITOR_TABLES = Object.freeze(['claims_copy', 'rule_changes']);

/** True when `root` is the state folder of a practice page: a folder directly under .../runs/demos/ (letter case is ignored, as on Windows). */
export function isDemoRoot(root) {
  if (typeof root !== 'string' || root.trim() === '') return false;
  const parts = resolve(root).split(/[\\/]+/).filter(Boolean).map((p) => p.toLowerCase());
  const at = parts.length - 2;
  return at >= 1 && parts[at] === 'demos' && parts[at - 1] === 'runs';
}

/** A plan that cannot be used: `problems` lists every reason, in words. Scripts answer it with exit code 2. */
export class PlanError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.name = 'PlanError';
    this.code = 'PLAN';
    this.problems = problems;
  }
}

// ---- small helpers -------------------------------------------------------------------------------------------------------------

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPlaceholder = (id) => typeof id !== 'string' || id.trim() === '' || id.trim().startsWith('<');
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const short = (v, n = 60) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const toPlain = (value) => JSON.parse(JSON.stringify(value)); // what a plan file will hold: no undefined, no Date, no class instance

function tableEntryOrNull(config, table) {
  try {
    return tableEntry(config, table);
  } catch {
    return null;
  }
}

function keyColumn(config, table) {
  try {
    return tableEntry(config, table).key || DEFAULT_KEYS[table];
  } catch {
    return DEFAULT_KEYS[table];
  }
}

const schemaFiles = new Map();
function planSchema() {
  const file = codeFile(agentRoot(), 'schemas', 'plan.schema.json');
  if (!schemaFiles.has(file)) schemaFiles.set(file, { definitions: readJson(file).definitions, wrappers: new Map() });
  return schemaFiles.get(file);
}

// one wrapper per definition, so a message names the branch that was meant instead of "none of the 2 allowed schemas"
function branch(ref) {
  const s = planSchema();
  if (!s.wrappers.has(ref)) s.wrappers.set(ref, { definitions: s.definitions, $ref: `#/definitions/${ref}` });
  return s.wrappers.get(ref);
}

/** Messages for the header line (line 1 of plan.jsonl). */
const headerProblems = (line) => validate(branch('headerLine'), line).errors;

/** Messages for one op line. */
function opProblems(op) {
  const ref = op?.op === 'create' ? 'createOp' : op?.op === 'update' ? 'updateOp' : 'op';
  return validate(branch(ref), op).errors;
}

function planParts(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.ops)) throw new PlanError('this is not a plan: it has no list of ops');
  const header = typeof plan.header === 'function' ? plan.header() : plan.header ?? null;
  return { header, ops: plan.ops };
}

const countOps = (ops) => ({ creates: ops.filter((o) => o?.op === 'create').length, updates: ops.filter((o) => o?.op === 'update').length });

function* stringsIn(value) {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const v of value) yield* stringsIn(v);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      yield k;
      yield* stringsIn(v);
    }
  }
}

const protectedNeedles = (config) => {
  const n = config?.notion ?? {};
  return [...new Set([...(n.protected_database_ids ?? []), ...(n.protected_page_ids ?? [])].map((id) => normId(id)).filter((id) => id.length >= 8))];
};

// ---- building ------------------------------------------------------------------------------------------------------------------

/**
 * Start a plan. Returns { create, update, ops, header, write, readPlan }.
 *   create(table, key, properties, { children, expect })        one new row; `properties` is plain values (`expect` is kept in the plan, but a create never uses it)
 *   update(table, key, pageId, properties, { expect })          one existing row; `expect` is what the pulled row must still hold
 *   header()                                                    the first line of plan.jsonl: { plan: { run_id, script, created_at, rubric_edition, counts } }
 *   write(dir)                                                  writes <dir>/plan.jsonl (every line validated) and returns its path
 * The builder only collects: checkPlan says whether the whole plan may be sent. When it is given `config`, a create without its key
 * column gets it from `key`, and an update that repeats the key column drops it.
 */
export function newPlan({ runId, script, rubricEdition = null, config = null, now = () => new Date() } = {}) {
  if (!nonEmpty(runId)) throw new TypeError('newPlan: runId is required');
  if (!nonEmpty(script)) throw new TypeError('newPlan: script is required');
  const createdAt = now().toISOString();
  const ops = [];

  function props(table, key, properties) {
    if (!nonEmpty(table)) throw new TypeError('plan: the table must be a name');
    if (!nonEmpty(key)) throw new TypeError(`plan: ${table}: the key must be a non-empty string`);
    if (!isPlain(properties)) throw new TypeError(`plan: ${table} "${key}": properties must be an object of plain values`);
    for (const [name, value] of Object.entries(properties)) {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`plan: ${table} "${key}": "${name}" is not a finite number`);
    }
    return toPlain(properties);
  }

  function create(table, key, properties, { children, expect } = {}) {
    const p = props(table, key, properties);
    const kc = config ? keyColumn(config, table) : null;
    if (kc && !Object.hasOwn(p, kc)) p[kc] = key;
    const op = { op: 'create', table, key, properties: p };
    if (isPlain(expect)) op.expect = toPlain(expect);
    if (Array.isArray(children) && children.length) op.children = toPlain(children);
    ops.push(op);
    return op;
  }

  function update(table, key, pageId, properties, { expect } = {}) {
    const p = props(table, key, properties);
    const kc = config ? keyColumn(config, table) : null;
    if (kc && p[kc] === key) delete p[kc];
    const op = { op: 'update', table, key, ...(pageId ? { page_id: pageId } : {}), properties: p };
    if (isPlain(expect)) op.expect = toPlain(expect);
    ops.push(op);
    return op;
  }

  const header = () => ({ plan: { run_id: runId, script, created_at: createdAt, rubric_edition: rubricEdition ?? null, counts: countOps(ops) } });

  function write(dir) {
    const lines = [header(), ...ops];
    const problems = headerProblems(lines[0]).map((p) => `header: ${p}`);
    ops.forEach((op, i) => problems.push(...opProblems(op).map((p) => `op ${i + 1}: ${p}`)));
    if (problems.length) throw new PlanError('the plan is not valid and was not written', problems);
    const file = join(dir, 'plan.jsonl');
    // a ledger belongs to the ops of the plan file next to it: a different list of ops must not be put under it
    if (existsSync(join(dir, 'ledger.jsonl')) && existsSync(file) && !isDeepStrictEqual(readPlan(dir).ops, toPlain(ops))) {
      throw new PlanError('this run folder already has a ledger for a different plan; read that plan with readPlan(dir) and resume it, or use a new run id');
    }
    writeTextAtomic(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
    return file;
  }

  return { create, update, ops, header, write, readPlan };
}

/** Read <dir>/plan.jsonl: { header (the first line), ops, dir, file }. Throws PlanError when the file is missing, torn or has a line that fails the schema. */
export function readPlan(dir) {
  const file = join(dir, 'plan.jsonl');
  if (!existsSync(file)) throw new PlanError(`there is no plan in ${dir} (plan.jsonl is missing)`);
  let read;
  try {
    read = readJsonl(file);
  } catch (e) {
    throw new PlanError(`plan.jsonl cannot be read: ${e.message}`);
  }
  if (read.torn) throw new PlanError('plan.jsonl ends with a half-written line, so it cannot be trusted');
  if (read.rows.length === 0) throw new PlanError('plan.jsonl is empty');
  const [header, ...ops] = read.rows;
  const problems = headerProblems(header).map((p) => `header: ${p}`);
  ops.forEach((op, i) => problems.push(...opProblems(op).map((p) => `op ${i + 1}: ${p}`)));
  if (problems.length) throw new PlanError('plan.jsonl has lines that are not valid', problems);
  return { header, ops, dir, file };
}

// ---- checking ------------------------------------------------------------------------------------------------------------------

// The schema's messages for a missing or an extra page_id, in words an engineer can act on.
const SCHEMA_WORDS = new Map([
  ['$.page_id: missing required property', 'an update needs the page_id of the row'],
  ['$.page_id: unexpected property', 'a create must not carry a page_id'],
]);

/**
 * Everything that can be known about a plan without a request. Returns { ok, problems, counts }; problems are sentences naming the op
 * (1-based) that broke the rule:
 *   the table is one of the five; every line fits schemas/plan.schema.json; every property is in the table's writable set
 *   (config.writableProperties, and with `setup` a create may fill what the one-time setup fills); an editor column (the four of the claims
 *   copy, Editor wording, Paused; the ledger has none) is refused, except on a setup create or update of a claim whose "Challenged tags notes"
 *   starts with AUDIT_PREFIX (the seeding of the audit's decisions, hard rule 1), or on a create when config.demo is true and
 *   <root>/runs/SETUP exists (a practice page's build); Status on rule_changes is Proposed, Live or Rolled back; no string anywhere holds a protected id (dashes
 *   ignored) and no op targets a protected table; an update has a page_id and a create has none; a create carries its key column; a key
 *   appears once per table; the header counts match the ops.
 *
 * `demoEditor: true` is decision D31, the demo-only exception to hard rule 1: an agent may act as the editor on a practice page. It allows,
 * and only when config.demo is true and `root` is a folder directly under runs/demos/ (isDemoRoot), an UPDATE on claims_copy to write the
 * editor's four columns (Claim quality tags — verified, Review status, Why wrong, Challenged tags notes) and an UPDATE on rule_changes to write Editor wording and a Status that is one of
 * config.editor_columns.rule_changes_status_editor_values (Approved, Rejected). Without the option, on a production config, outside
 * runs/demos/, on a create, and on any other table or column, every editor column and those two Status values stay refused.
 */
export function checkPlan(plan, config, { setup = false, root = agentRoot(), demoEditor = false } = {}) {
  const problems = [];
  let header;
  let ops;
  try {
    ({ header, ops } = planParts(plan));
  } catch (e) {
    return { ok: false, problems: [e.message], counts: { creates: 0, updates: 0 } };
  }
  const demoOpen = config?.demo === true && existsSync(join(root, 'runs', 'SETUP'));
  const editorMayUpdate = demoEditor === true && config?.demo === true && isDemoRoot(root); // D31: an agent acting as the editor on a practice page
  const needles = protectedNeedles(config);
  const seen = new Set();
  const named = (i, op) => `op ${i + 1} (${typeof op?.table === 'string' ? op.table : 'no table'}${nonEmpty(op?.key) ? ` "${short(op.key, 40)}"` : ''})`;

  if (header === null) problems.push('header: the plan has no header line');
  else {
    problems.push(...headerProblems(header).map((p) => `header: ${p}`));
    const counts = header.plan?.counts;
    if (isPlain(counts) && Number.isInteger(counts.creates) && Number.isInteger(counts.updates) && !isDeepStrictEqual(counts, countOps(ops))) {
      const real = countOps(ops);
      problems.push(`header: the counts say ${counts.creates} creates and ${counts.updates} updates, but the ops hold ${real.creates} and ${real.updates}`);
    }
  }

  ops.forEach((op, i) => {
    const add = (msg) => problems.push(`${named(i, op)}: ${msg}`);
    if (!isPlain(op)) {
      problems.push(`op ${i + 1}: expected an object`);
      return;
    }
    if (op.op !== 'create' && op.op !== 'update') {
      add('op must be "create" or "update"');
      return;
    }
    if (!TABLES.includes(op.table)) {
      add(`"${short(op.table, 30)}" is not one of this agent's tables (${TABLES.join(', ')})`);
      return;
    }
    const shape = opProblems(op);
    if (shape.length) {
      for (const p of shape) add(SCHEMA_WORDS.get(p) ?? `not a valid op line: ${p}`);
      return;
    }

    // identity: one op per row
    const id = `${op.table}\u0000${op.key}`;
    if (seen.has(id)) add('the key appears twice in this plan (one op per row)');
    seen.add(id);
    if (op.op === 'update' && op.children !== undefined) add('page content (children) can only go with a create');

    // which columns, which values
    let writable;
    try {
      writable = writableProperties(config, op.table, { setup: setup && op.op === 'create' });
    } catch (e) {
      add(`the writable columns cannot be worked out (${e.message})`);
      return;
    }
    const editor = new Set(editorColumns(config, op.table));
    const notesColumn = tableEntryOrNull(config, 'claims_copy')?.columns?.notes ?? 'Challenged tags notes';
    const challenged = op.properties[notesColumn];
    const seeded = setup && op.table === 'claims_copy' && typeof challenged === 'string' && challenged.startsWith(AUDIT_PREFIX);
    const mayWriteEditor = seeded || (demoOpen && op.op === 'create') || (editorMayUpdate && op.op === 'update' && DEMO_EDITOR_TABLES.includes(op.table));
    for (const name of Object.keys(op.properties)) {
      const base = name.endsWith(':end') ? name.slice(0, -4) : name; // the end of a date goes with its start
      if (editor.has(base)) {
        if (!mayWriteEditor) add(`"${name}" is a column only an editor writes; no script may (the exceptions are the setup seeding the audit's decisions on the claims, and a practice page's build when it creates the row)`);
        continue;
      }
      if (!writable.has(base)) add(`"${name}" is not a column this plan may write to ${op.table}`);
    }
    if (op.table === 'rule_changes' && Object.hasOwn(op.properties, 'Status') && !RULE_CHANGES_AGENT_STATUS.includes(op.properties.Status)) {
      const editorStatus = config?.editor_columns?.rule_changes_status_editor_values ?? [];
      const asEditor = editorMayUpdate && op.op === 'update' && editorStatus.includes(op.properties.Status);
      if (!asEditor) add(`Status ${JSON.stringify(op.properties.Status)} is not one a script may write (only ${RULE_CHANGES_AGENT_STATUS.join(', ')}; Approved and Rejected are the editor's)`);
    }
    const kc = keyColumn(config, op.table);
    if (op.op === 'create' && op.properties[kc] !== op.key) add(`a create must carry its key column "${kc}" with the value of the key`);
    if (op.op === 'update' && Object.hasOwn(op.properties, kc) && op.properties[kc] !== op.key) add(`an update may not rename a row (${kc} says ${short(op.properties[kc], 30)})`);

    // the table itself must be one that may be written
    let entry = null;
    try {
      entry = tableEntry(config, op.table);
    } catch {
      entry = null;
    }
    if (entry && [entry.database_id, entry.data_source_id].some((x) => typeof x === 'string' && needles.includes(normId(x)))) {
      add('this table is in the protected lists of config.json, so it is never written');
    }
  });

  // a protected id must not appear anywhere in the plan, in any string, key or block
  if (needles.length) {
    const hit = new Set();
    for (const part of [header, ops]) {
      for (const s of stringsIn(part)) {
        const flat = s.replace(/-/g, '').toLowerCase();
        for (const needle of needles) if (flat.includes(needle)) hit.add(needle);
      }
    }
    for (const needle of hit) problems.push(`the plan mentions a protected id (starting ${needle.slice(0, 8)}); protected tables and pages are never written`);
  }

  return { ok: problems.length === 0, problems, counts: countOps(ops) };
}

// ---- the ledger ----------------------------------------------------------------------------------------------------------------

/** The last ledger line of every op: Map of op_index -> line. A missing ledger is an empty map. */
export function readLedger(dir) {
  const last = new Map();
  for (const row of readJsonl(join(dir, 'ledger.jsonl')).rows) if (Number.isInteger(row?.op_index)) last.set(row.op_index, row);
  return last;
}

// ---- comparing -----------------------------------------------------------------------------------------------------------------

const twoDecimals = (v) => (v === null || v === undefined || v === '' ? null : Number(v).toFixed(2));

// Is a planned plain value the same as the one in the pulled or read-back row? undefined means the row has no such column: unknown, so not the same.
function sameWritten(type, wrote, found) {
  if (found === undefined) return false;
  if (type === 'number') return twoDecimals(wrote) === twoDecimals(found);
  return sameValue(type, wrote, found);
}

/**
 * The columns whose read-back value differs from what was written: [{ column, wrote, found }]. `props` are the decoded props of the
 * page (decodePage). Text is compared after normaliseText, numbers to two decimals, selects, checkboxes and urls exactly, dates by their
 * start (the end of a date is not compared).
 */
export function compareWritten(planned, props, schema) {
  const out = [];
  for (const [column, wrote] of Object.entries(planned)) {
    if (column.endsWith(':end') && schema?.properties?.[column.slice(0, -4)]?.type === 'date') continue;
    const type = schema?.properties?.[column]?.type ?? null;
    const found = props?.[column];
    if (!sameWritten(type, wrote, found)) out.push({ column, wrote, found });
  }
  return out;
}

// the value of a column in a pulled plain row ({ "Tag outcome": ..., page_id }) or in a decoded page ({ props })
const cell = (row, name) => (row && Object.hasOwn(row, name) ? row[name] : row?.props && Object.hasOwn(row.props, name) ? row.props[name] : undefined);

// the first column of `expect` that the pulled row no longer holds, or null
function expectMismatch(expect, row, schema) {
  if (Object.keys(expect).length === 0) return null;
  if (!row) return '';
  for (const [column, want] of Object.entries(expect)) {
    if (!sameWritten(schema?.properties?.[column]?.type ?? null, want, cell(row, column))) return column;
  }
  return null;
}

// the planned properties that the existing row does not hold yet (a date's end goes with its start)
function differing(planned, row, schema) {
  const out = {};
  for (const [column, value] of Object.entries(planned)) {
    if (column.endsWith(':end') && schema?.properties?.[column.slice(0, -4)]?.type === 'date') continue;
    if (!sameWritten(schema?.properties?.[column]?.type ?? null, value, cell(row, column))) {
      out[column] = value;
      if (planned[`${column}:end`] !== undefined) out[`${column}:end`] = planned[`${column}:end`];
    }
  }
  return out;
}

const rowFor = (pulled, table, key) => {
  const t = pulled?.[table];
  if (!t) return null;
  return (t instanceof Map ? t.get(key) : t[key]) ?? null;
};
const pulledHas = (pulled, table) => pulled?.[table] !== undefined && pulled?.[table] !== null;

// ---- applying ------------------------------------------------------------------------------------------------------------------

// The plan file is the record of what is sent: write it when it is not there yet, and refuse a plan that differs from the one there.
function settlePlanFile(plan, dir) {
  const file = join(dir, 'plan.jsonl');
  if (!existsSync(file)) {
    if (typeof plan.write !== 'function') throw new PlanError(`there is no plan.jsonl in ${dir}; write the plan before applying it`);
    plan.write(dir);
    return;
  }
  if (!isDeepStrictEqual(readPlan(dir).ops, toPlain(plan.ops))) {
    throw new PlanError('the plan on disk (plan.jsonl) is not the plan being applied; read it with readPlan(dir) and apply that, or use a new run id');
  }
}

/**
 * Send a plan. See the header of this file. `schemas[table]` is the retrieveDatabase answer of the table; `pulled[table]` maps a key
 * to the pulled plain row (columns by their Notion names, plus page_id), freshly pulled by the caller before a resumed run. `setup` and
 * `demoEditor` are passed to checkPlan. The result's `code` is 0 (every op done or skipped and every read-back equal), 1 (an op failed,
 * was left uncertain, could not be read back, or was never reached: run the same command again) or 2 (a read-back differed).
 */
export async function applyPlan({
  plan, dir, client, config, schemas, pulled = {}, log = null, setup = false, root = agentRoot(), now = () => new Date(), demoEditor = false,
} = {}) {
  if (!client || typeof client.createPage !== 'function' || typeof client.updatePage !== 'function' || typeof client.retrievePage !== 'function') {
    throw new TypeError('applyPlan: a Notion client is required (a script without a token must stop before this)');
  }
  if (!nonEmpty(dir)) throw new TypeError('applyPlan: dir, the run folder, is required');
  const { ops } = planParts(plan);

  // 1. the plan is checked again here: nothing the check refuses is ever sent
  const checked = checkPlan(plan, config, { setup, root, demoEditor });
  if (!checked.ok) throw new PlanError('the plan was refused and nothing was sent', checked.problems);

  // 2. everything that can be known without a request is known before the first one
  const problems = [];
  const entries = new Map();
  for (const table of new Set(ops.map((o) => o.table))) {
    let entry = null;
    try {
      entry = tableEntry(config, table);
    } catch {
      entry = null;
    }
    if (!entry || isPlaceholder(entry.database_id)) problems.push(`${table}: config.json has no database id for this table yet (setup has not made it)`);
    else entries.set(table, entry);
    if (!schemas?.[table]?.properties) problems.push(`${table}: no schema was given (the retrieveDatabase answer of the table is needed to encode the values)`);
  }
  ops.forEach((op, i) => {
    const schema = schemas?.[op.table];
    if (!schema?.properties) return;
    try {
      encodeProperties(op.properties, schema);
      for (const c of Object.keys(op.expect ?? {})) if (!schema.properties[c]) throw new Error(`expect names "${c}", which is not a column of the table`);
    } catch (e) {
      problems.push(`op ${i + 1} (${op.table} "${short(op.key, 40)}"): ${e.message}`);
    }
  });
  if (problems.length) throw new PlanError('the plan cannot be sent as it stands, and nothing was sent', problems);

  // 3. the plan file is the record: written now when it is not there yet, and it must be the plan being applied
  settlePlanFile(plan, dir);

  // 4. the ledger of an earlier start must belong to this plan, and an uncertain create needs a fresh pull of its table
  const ledgerFile = join(dir, 'ledger.jsonl');
  const last = readLedger(dir);
  for (const [i, line] of last) {
    if (!ops[i] || line.table !== ops[i].table || line.key !== ops[i].key) {
      throw new PlanError(`the ledger in ${dir} does not belong to this plan (op ${i + 1} is ${line.table} "${short(line.key, 40)}" there)`);
    }
  }
  const needPull = ops.filter((op, i) => last.get(i)?.status === 'uncertain' && !pulledHas(pulled, op.table)).map((op) => op.table);
  if (needPull.length) {
    throw new PlanError(`an earlier create was left uncertain, so Notion has to be read again first: pull ${[...new Set(needPull)].join(', ')} and pass it as pulled`);
  }

  const record = (i, fields) => {
    const line = {
      op_index: i, table: ops[i].table, op: ops[i].op, key: ops[i].key, page_id: null, status: null, read_back: null, sent: null, error: null, ...fields, at: now().toISOString(),
    };
    appendJsonl(ledgerFile, line);
    last.set(i, line);
    log?.(`apply ${i + 1}/${ops.length} ${ops[i].op} ${ops[i].table} "${short(ops[i].key, 40)}": ${line.status}${line.read_back ? ` (read-back ${line.read_back})` : ''}${line.error ? ` - ${short(line.error, 120)}` : ''}`);
  };

  // reads a page back and compares what the plan holds for it; never throws
  async function readBack(op, pageId) {
    try {
      const found = decodePage(await client.retrievePage(pageId), schemas[op.table]);
      const diffs = compareWritten(op.properties, found.props, schemas[op.table]);
      if (!diffs.length) return { read_back: 'ok', error: null };
      const show = (v) => (v === undefined ? '(no such column)' : short(JSON.stringify(v), 40));
      const detail = diffs.slice(0, 3).map((d) => `"${d.column}" wrote ${show(d.wrote)}, found ${show(d.found)}`).join('; ');
      return { read_back: 'mismatch', error: `read-back mismatch: ${detail}${diffs.length > 3 ? ` (and ${diffs.length - 3} more)` : ''}` };
    } catch (e) {
      return { read_back: 'unchecked', error: `read-back could not run: ${short(e?.message ?? String(e), 160)}` };
    }
  }

  // 5. the ops, in order
  let already = 0;
  let consecutive = 0;
  let stopped = null;
  for (let i = 0; i < ops.length && !stopped; i++) {
    const op = ops[i];
    const prev = last.get(i) ?? null;
    const schema = schemas[op.table];

    if (prev?.status === 'done') {
      if (prev.read_back === 'ok') {
        already += 1;
      } else {
        // written on an earlier start but never confirmed: look again, do not write again
        record(i, { page_id: prev.page_id, status: 'done', sent: prev.sent ?? null, ...(await readBack(op, prev.page_id)) });
      }
      continue;
    }

    let kind = op.op;
    let pageId = op.page_id ?? null;
    let sendProps = op.properties;
    const existing = rowFor(pulled, op.table, op.key);
    if (op.op === 'create') {
      if (prev?.status === 'uncertain' && existing) {
        // the lost create did land: finish it as an update of what is not there yet
        kind = 'update';
        pageId = existing.page_id ?? null;
        sendProps = differing(op.properties, existing, schema);
        if (!pageId) {
          consecutive += 1;
          record(i, { status: 'failed', error: 'the pulled row has no page_id, so the uncertain create cannot be finished' });
          continue;
        }
      } else if (existing) {
        record(i, { page_id: existing.page_id ?? null, status: 'skipped', error: 'skipped: exists (a row with this key is already in the pull; a create is never sent twice)' });
        continue;
      }
    } else if (op.expect) {
      const column = expectMismatch(op.expect, existing, schema);
      if (column !== null) {
        record(i, { page_id: pageId, status: 'skipped', error: `skipped: expect (${column === '' ? 'the row is not in the pull' : `"${column}" is no longer what the plan expected`})` });
        continue;
      }
    }

    let failure = null;
    try {
      const encoded = encodeProperties(sendProps, schema);
      if (kind === 'create') {
        const page = await client.createPage({ parentDatabaseId: entries.get(op.table).database_id, properties: encoded, children: op.children ?? [] });
        pageId = page.id;
      } else if (Object.keys(encoded).length > 0) {
        await client.updatePage(pageId, { properties: encoded });
      }
    } catch (e) {
      failure = e;
    }
    if (failure) {
      if (failure.code === 'create_uncertain') {
        record(i, { status: 'uncertain', sent: 'create', error: short(failure.message, 400) });
        stopped = { op_index: i, key: op.key, reason: 'create_uncertain' };
        break;
      }
      consecutive += 1;
      record(i, { page_id: pageId, status: 'failed', sent: kind, error: short(failure.message ?? String(failure), 400) });
      if (failure.status === 401 || failure.status === 403) stopped = { op_index: i, key: op.key, reason: 'notion_refused' };
      else if (consecutive >= MAX_CONSECUTIVE_FAILURES) stopped = { op_index: i, key: op.key, reason: 'failures_in_a_row' };
      continue;
    }
    consecutive = 0;
    const sent = kind === 'create' ? 'create' : Object.keys(sendProps).length > 0 ? 'update' : null;
    record(i, { page_id: pageId, status: 'done', sent, ...(await readBack(op, pageId)) });
  }

  // 6. the state of the plan, from the ledger
  const result = {
    code: EXIT.OK, ok: true, done: 0, failed: 0, skipped: 0, mismatches: 0, uncertain: 0, unchecked: 0, pending: 0, already_done: already,
    created: {}, created_by_table: {}, stopped, ledger: ledgerFile,
    lists: { failed: [], skipped: [], mismatches: [], unchecked: [], uncertain: [] },
  };
  ops.forEach((op, i) => {
    const line = last.get(i);
    if (!line) {
      result.pending += 1;
      return;
    }
    const brief = { op_index: i, table: op.table, key: op.key, page_id: line.page_id ?? null, detail: line.error ?? null };
    switch (line.status) {
      case 'done':
        result.done += 1;
        if (line.read_back === 'mismatch') {
          result.mismatches += 1;
          result.lists.mismatches.push(brief);
        } else if (line.read_back === 'unchecked') {
          result.unchecked += 1;
          result.lists.unchecked.push(brief);
        }
        if (op.op === 'create' && line.page_id) {
          result.created[op.key] = line.page_id;
          (result.created_by_table[op.table] ??= {})[op.key] = line.page_id;
        }
        break;
      case 'failed':
        result.failed += 1;
        result.lists.failed.push(brief);
        break;
      case 'skipped':
        result.skipped += 1;
        result.lists.skipped.push(brief);
        break;
      case 'uncertain':
        result.uncertain += 1;
        result.lists.uncertain.push(brief);
        break;
      default:
        break;
    }
  });
  if (result.mismatches > 0) result.code = EXIT.INVALID;
  else if (result.failed > 0 || result.uncertain > 0 || result.unchecked > 0 || result.pending > 0) result.code = EXIT.ERROR;
  result.ok = result.code === EXIT.OK;
  return result;
}
