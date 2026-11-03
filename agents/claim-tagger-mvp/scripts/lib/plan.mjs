// Plans: the only thing that may become a Notion write (CONTRACTS section 8, hard rule 1).
//
//   newPlan({ runId, script, rubricEdition, config?, now? })    -> a builder: create(), update(), trash() (P51), ops, header(), write(dir), readPlan
//   readPlan(dir)                                                -> { header, ops, dir, file } read from <dir>/plan.jsonl, every line validated
//   checkPlan(plan, config, { setup, root })                     -> { ok, problems, counts } before any request is made
//   applyPlan({ plan, dir, client, config, schemas, pulled,      -> { code, done, failed, skipped, mismatches, uncertain, unchecked,
//              log, setup, root, now, interrupt })                   created, created_by_table, trashed_by_table, already_done, stopped, ledger, lists }
//   firstPageIds(root)                                           -> Set of the normalised table ids in setup/first-page.json (the ids no trash op may name)
//   isDemoRoot(root)                                             -> true for a state folder directly under .../runs/demos/ (a practice page)
//   readLedger(dir)                                              -> Map of op_index -> the last ledger line of that op
//   compareWritten(planned, props, schema)                       -> the columns whose value read back differs from what was written
//
// A plan is runs/<run-id>/plan.jsonl: a header line { "plan": { run_id, script, created_at, rubric_edition, counts } } and then one
// op per line { op, table, key, page_id (update only), properties, expect, children } (schemas/plan.schema.json). Values are plain:
// strings, numbers, booleans, null, lists of strings. The tables are rulebook, claims, tag_decisions, rule_changes and
// agent_settings, and a create carries its key column in its properties (the builder adds it when it is given the config).
//
// Trash (decision P51). A third op, { op: "trash", table, key, page_id }, moves one row to Notion's trash. checkPlan allows it only in a plan whose header names the script "remove",
// only on a v2 config, only on the tables claims and tag_decisions, and never on a protected id, an id of setup/first-page.json or the id of a table or page of the agent. A trash op carries
// no properties. applyPlan trashes a page only when the pull it was given holds that page under that key (or the page is in the trash already, which counts as done), looks at a row of Tag
// decisions first (a person who filled Tag outcome, Your note or Agent is right since the plan was made stops the run: stopped.reason "person_set"), reads every page back with
// retrievePage (in the trash by in_trash or archived), and writes the same ledger line as for a create or an update, so a stopped run goes on without sending a done step again.
// A Claims row is trashed second: only when every Tag decisions trash op of its claim (the Key's Geo ID) is done and read back as trashed in the ledger, and when its page's relation "Tag decisions"
// (CLAIMS_TD_RELATION) lists no page that is not in the trash. A claim that fails this is left alone and its op is a failed one that names the row (exit 1 in remove.mjs); the next run finishes it.
// `interrupt` (a function that returns a reason, or null) is asked before each op that is not done; a reason ends the run there as stopped.reason (remove.mjs: runs/PAUSED).
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
  ADD_SCRIPT, CLAIMS_TD_RELATION, COPY_LIVE_SCRIPT, JUDGED_COLUMN, REMOVE_SCRIPT, RULE_CHANGES_AGENT_STATUS, SEED_JUDGED_SCRIPT, TABLES, TD_EDITOR, TRASHABLE_TABLES, addableProperties, copyLiveProperties,
  editorColumns, isProtected, isV2, seedJudgedProperties, tableEntry, writableProperties,
} from './config.mjs';
import { EXIT } from './exit-codes.mjs';
import { appendJsonl, readJson, readJsonl, writeTextAtomic } from './jsonl.mjs';
import { isInTrash } from './notion-rest.mjs';
import { decodePage, encodeProperties, normId, sameValue } from './notion-values.mjs';
import { agentRoot, codeFile } from './paths.mjs';
import { validate } from './validate.mjs';

/** The start of Your note on a row that the first page's audit of 9 October gave a decision (pull.mjs tells such a case from the others; the copy carries it). No plan writes it any more except the copy. */
export const AUDIT_PREFIX = 'From the audit of 9 October';
/** Consecutive failed ops after which applyPlan stops (a resumed run goes on from there). */
export const MAX_CONSECUTIVE_FAILURES = 3;

const DEFAULT_KEYS = Object.freeze({
  rulebook: 'Name', claims: 'Geo ID', tag_decisions: 'Key', rule_changes: 'Lesson', agent_settings: 'Name',
});

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
  const ref = op?.op === 'create' ? 'createOp' : op?.op === 'update' ? 'updateOp' : op?.op === 'trash' ? 'trashOp' : 'op';
  return validate(branch(ref), op).errors;
}

function planParts(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.ops)) throw new PlanError('this is not a plan: it has no list of ops');
  const header = typeof plan.header === 'function' ? plan.header() : plan.header ?? null;
  return { header, ops: plan.ops };
}

// `trashes` is in the counts only when the plan trashes something (P51), so the header of every other plan reads as it always did
function countOps(ops) {
  const counts = { creates: ops.filter((o) => o?.op === 'create').length, updates: ops.filter((o) => o?.op === 'update').length };
  const trashes = ops.filter((o) => o?.op === 'trash').length;
  if (trashes > 0) counts.trashes = trashes;
  return counts;
}

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

  // P51: one row to Notion's trash. It carries no properties; checkPlan allows it only in a plan of the remove script, on claims and tag_decisions
  function trash(table, key, pageId) {
    if (!nonEmpty(table)) throw new TypeError('plan: the table must be a name');
    if (!nonEmpty(key)) throw new TypeError(`plan: ${table}: the key must be a non-empty string`);
    if (!nonEmpty(pageId)) throw new TypeError(`plan: ${table} "${key}": a trash op needs the page_id of the row`);
    const op = { op: 'trash', table, key, page_id: pageId };
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

  return { create, update, trash, ops, header, write, readPlan };
}

/**
 * The ids of the first page's tables (setup/first-page.json: database_id and data_source_id of its five tables), normalised: the ids no trash op may name (P51). The file is the root's own copy,
 * else the agent folder's. Throws when it cannot be read or holds no id, so that a check never passes for want of a list.
 */
export function firstPageIds(root = agentRoot()) {
  const file = codeFile(root, 'setup', 'first-page.json');
  let tables;
  try {
    tables = readJson(file).tables;
  } catch (e) {
    throw new PlanError(`setup/first-page.json cannot be read (${e.message}), so the ids of the first page cannot be ruled out`);
  }
  const ids = new Set();
  for (const entry of Object.values(isPlain(tables) ? tables : {})) {
    for (const field of ['database_id', 'data_source_id']) if (nonEmpty(entry?.[field])) ids.add(normId(entry[field]));
  }
  if (ids.size === 0) throw new PlanError('setup/first-page.json holds no table id, so the ids of the first page cannot be ruled out');
  return ids;
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
const TRASH_WORDS = new Map([
  ['$.page_id: missing required property', 'a trash op needs the page_id of the row'],
  ['$.properties: unexpected property', 'a trash op carries no properties'],
  ['$.expect: unexpected property', 'a trash op carries no expect'],
  ['$.children: unexpected property', 'a trash op carries no page content (children)'],
]);

/**
 * Everything that can be known about a plan without a request. Returns { ok, problems, counts }; problems are sentences naming the op
 * (1-based) that broke the rule:
 *   the table is one of the five; every line fits schemas/plan.schema.json; every property is in the table's writable set
 *   (config.writableProperties, and with `setup` a create may fill what the one-time setup fills); an editor column (Agent is right, Tag outcome and
 *   Your note on tag_decisions, Editor wording, Paused; Claims has none) is refused in every plan, except in a plan of the copy-live script (below);
 *   Status on rule_changes is Proposed, Live or Rolled back; no string anywhere holds a protected id (dashes
 *   ignored) and no op targets a protected table; an update has a page_id and a create has none; a create carries its key column; a key
 *   appears once per table; the header counts match the ops.
 *   The add script (header script "add", decision P35) has one narrow allowance: its plan may only CREATE rows of the claims table, with the key column and the Geo columns
 *   (addableProperties) and no page content; an update, another table, an agent column or an editor column in it is refused, also with `setup: true` (the flag opens nothing more
 *   to it). No other plan creates a claims row except a setup plan.
 *   The copy-live script (header script "copy-live", decision P47, checkpoint 2 of the v2 page) has the other narrow allowance: on a config with "profile": "v2" its plan may CREATE and UPDATE rows of
 *   any of the five tables with the columns of copyLiveProperties, the editor columns Tag outcome, Your note, Editor wording and Paused included (it copies the decisions made on the first page), and
 *   Status values of any kind on rule_changes. Agent is right, any other column, page content, a protected table or id and, as for every plan, a delete or archive (a plan has no such op) stay refused.
 *   The seed-judged step (header script "seed-judged", `setup.mjs seed-judged`, decision P53) has the third narrow allowance: on a config with "profile": "v2" its plan may only UPDATE rows of the
 *   rulebook table, with the one property Judged set to true (the key column may go with it, unchanged) and no page content. Judged is an editor column of the Rulebook (config.editor_columns.rulebook), so
 *   every other plan that names it is refused, a copy-live plan and a setup plan included; the step never unticks.
 *
 * No loop plan ever writes an editor column (decision P7: no agent acts as the editor). The copy's updates are also guarded when they are sent (applyPlan): an update of a Tag decisions
 * row that holds Agent is right, Tag outcome or Your note is skipped when a person has set a different value in Notion since the plan was made (PORT-V2.md 2.4).
 */
export function checkPlan(plan, config, { setup = false, root = agentRoot() } = {}) {
  const problems = [];
  let header;
  let ops;
  try {
    ({ header, ops } = planParts(plan));
  } catch (e) {
    return { ok: false, problems: [e.message], counts: { creates: 0, updates: 0 } };
  }
  const addPlan = header?.plan?.script === ADD_SCRIPT;
  const copyPlan = header?.plan?.script === COPY_LIVE_SCRIPT;
  const removePlan = header?.plan?.script === REMOVE_SCRIPT;
  const seedPlan = header?.plan?.script === SEED_JUDGED_SCRIPT;
  const needles = protectedNeedles(config);
  const seen = new Set();
  const named = (i, op) => `op ${i + 1} (${typeof op?.table === 'string' ? op.table : 'no table'}${nonEmpty(op?.key) ? ` "${short(op.key, 40)}"` : ''})`;

  if (header === null) problems.push('header: the plan has no header line');
  else {
    problems.push(...headerProblems(header).map((p) => `header: ${p}`));
    if (copyPlan && !isV2(config)) problems.push('header: a plan of the copy-live script may only be checked against the v2 profile (config.json has no "profile": "v2")');
    if (removePlan && !isV2(config)) problems.push('header: a plan of the remove script may only be checked against the v2 profile (config.json has no "profile": "v2")');
    if (seedPlan && !isV2(config)) problems.push('header: a plan of the seed-judged script may only be checked against the v2 profile (config.json has no "profile": "v2")');
    const counts = header.plan?.counts;
    if (isPlain(counts) && Number.isInteger(counts.creates) && Number.isInteger(counts.updates) && !isDeepStrictEqual(counts, countOps(ops))) {
      const real = countOps(ops);
      const trashes = (c) => (c.trashes ? ` and ${c.trashes} trashes` : '');
      problems.push(`header: the counts say ${counts.creates} creates and ${counts.updates} updates${trashes(counts)}, but the ops hold ${real.creates} and ${real.updates}${trashes(real)}`);
    }
  }

  // What is wrong with one trash op (P51): not in a plan of the remove script, not on claims or tag_decisions, not a page id, a protected id, an id of the first page, or the id of a table or of
  // a page the tables hang under. (The ops of a plan on disk are also checked against the pull when they are sent: applyPlan trashes only a page the pull holds under that key.)
  let firstIds;
  let ownIds;
  const trashProblems = (op) => {
    const out = [];
    if (!removePlan) out.push('a trash op is only allowed in a plan of the remove script (P51)');
    if (!TRASHABLE_TABLES.includes(op.table)) out.push(`only rows of ${TRASHABLE_TABLES.join(' and ')} can be trashed, not rows of ${op.table}`);
    const flat = normId(op.page_id);
    if (!/^[0-9a-f]{32}$/.test(flat)) {
      out.push('page_id is not a Notion page id');
      return out;
    }
    if (isProtected(config, op.page_id) || needles.includes(flat)) out.push('this page is in the protected lists of config.json, so it is never trashed');
    try {
      firstIds ??= firstPageIds(root);
      if (firstIds.has(flat)) out.push('this id belongs to the first page (setup/first-page.json), which is never written');
    } catch (e) {
      out.push(e.message);
    }
    if (ownIds === undefined) {
      const n = config?.notion ?? {};
      ownIds = new Set([
        ...TABLES.flatMap((t) => {
          const e = tableEntryOrNull(config, t);
          return e ? [e.database_id, e.data_source_id] : [];
        }),
        n.parent_page_id, n.root_parent_page_id, ...(Array.isArray(n.setup_page_parents) ? n.setup_page_parents : []),
      ].filter((x) => nonEmpty(x) && !isPlaceholder(x)).map((x) => normId(x)));
    }
    if (ownIds.has(flat)) out.push('this id is a table or a page of the agent, not a row: only rows are trashed');
    const entry = tableEntryOrNull(config, op.table);
    if (entry && [entry.database_id, entry.data_source_id].some((x) => typeof x === 'string' && needles.includes(normId(x)))) {
      out.push('this table is in the protected lists of config.json, so it is never written');
    }
    return out;
  };

  ops.forEach((op, i) => {
    const add = (msg) => problems.push(`${named(i, op)}: ${msg}`);
    if (!isPlain(op)) {
      problems.push(`op ${i + 1}: expected an object`);
      return;
    }
    if (op.op !== 'create' && op.op !== 'update' && op.op !== 'trash') {
      add('op must be "create" or "update" (or "trash", in a plan of the remove script)');
      return;
    }
    if (removePlan && op.op !== 'trash') {
      add('a plan of the remove script may only trash rows of the claims and tag_decisions tables (it never creates or updates a row)');
      return;
    }
    if (!TABLES.includes(op.table)) {
      add(`"${short(op.table, 30)}" is not one of this agent's tables (${TABLES.join(', ')})`);
      return;
    }
    const shape = opProblems(op);
    if (shape.length) {
      for (const p of shape) add((op.op === 'trash' ? TRASH_WORDS : SCHEMA_WORDS).get(p) ?? `not a valid op line: ${p}`);
      return;
    }

    // identity: one op per row
    const id = `${op.table}\u0000${op.key}`;
    if (seen.has(id)) add('the key appears twice in this plan (one op per row)');
    seen.add(id);

    // the one allowance of decision P51: a plan of the remove script (the header names the script) may TRASH rows of the claims and tag_decisions tables, and nothing else
    if (op.op === 'trash') {
      for (const p of trashProblems(op)) add(p);
      return;
    }
    if (op.op === 'update' && op.children !== undefined) add('page content (children) can only go with a create');

    // the one narrow allowance of decision P35: a plan of the add script (the header names the script) may CREATE rows of the claims table with the key and the Geo columns,
    // and nothing else: no update, no other table. No other script creates a claims row (setup, in a builder session, has its own path)
    if (addPlan && !(op.op === 'create' && op.table === 'claims')) {
      add('a plan of the add script may only create rows of the claims table (it never updates a row and never writes another table)');
      return;
    }
    if (addPlan && op.children !== undefined) add('a plan of the add script writes no page content (children): a new claims row carries its Geo columns only');
    // the third narrow allowance (P53): a plan of the seed-judged script (the header names the script) may only UPDATE rows of the rulebook with Judged set to true
    if (seedPlan) {
      if (!(op.op === 'update' && op.table === 'rulebook')) {
        add('a plan of the seed-judged script may only update rows of the rulebook table (it never creates a row and never writes another table)');
        return;
      }
      if (op.children !== undefined) add('a plan of the seed-judged script writes no page content (children)');
      if (op.properties[JUDGED_COLUMN] !== true) add(`a plan of the seed-judged script ticks ${JUDGED_COLUMN} (true) and never unticks it`);
    }
    if (!addPlan && !copyPlan && !setup && op.op === 'create' && op.table === 'claims') {
      add('a row of the claims table is created only by setup or by the add script, from claims read from Geo'); // the checks below say more about the columns
    }
    if (copyPlan && op.children !== undefined) add('a plan of the copy-live script writes no page content (children)');

    // which columns, which values
    let writable;
    try {
      writable = addPlan ? addableProperties(config) : copyPlan ? copyLiveProperties(config, op.table) : seedPlan ? seedJudgedProperties(config) : writableProperties(config, op.table, { setup: setup && op.op === 'create' });
    } catch (e) {
      add(`the writable columns cannot be worked out (${e.message})`);
      return;
    }
    const editor = new Set(editorColumns(config, op.table));
    for (const name of Object.keys(op.properties)) {
      const base = name.endsWith(':end') ? name.slice(0, -4) : name; // the end of a date goes with its start
      // a copy-live plan has its own list (copyLiveProperties), which names the editor columns it may write; Agent is right is not on it
      if (!copyPlan && !(seedPlan && op.table === 'rulebook' && base === JUDGED_COLUMN) && editor.has(base)) {
        add(`"${name}" is a column only an editor writes; no script may (the copy of the first page, P47, is the one exception)`);
        continue;
      }
      if (!writable.has(base)) add(`"${name}" is not a column this plan may write to ${op.table}`);
    }
    if (!copyPlan && op.table === 'rule_changes' && Object.hasOwn(op.properties, 'Status') && !RULE_CHANGES_AGENT_STATUS.includes(op.properties.Status)) {
      add(`Status ${JSON.stringify(op.properties.Status)} is not one a script may write (only ${RULE_CHANGES_AGENT_STATUS.join(', ')}; Approved and Rejected are the editor's)`);
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
    // the seed of the Judged boxes writes the v2 Rulebook and no other: never a table of the first page
    if (seedPlan && entry) {
      try {
        firstIds ??= firstPageIds(root);
        if ([entry.database_id, entry.data_source_id].some((x) => typeof x === 'string' && firstIds.has(normId(x)))) add('this table belongs to the first page (setup/first-page.json), which is never written');
      } catch (e) {
        add(e.message);
      }
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

// A cell with something in it: a ticked checkbox, a non-blank text or select, a non-empty list.
const filled = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : v === true || (typeof v === 'number' && Number.isFinite(v)));

/**
 * The name of the first editor column of Tag decisions (TD_EDITOR) in `props` that a person has filled in Notion with a value other than the planned one, or null. One GET of the page,
 * only when `props` holds an editor column. A value the op itself names in `expect` is not a person's surprise: the plan was made knowing it and replaces it on purpose (the copy's
 * --overwrite-editor-values). A read that fails throws: the op fails and is run again, it is never sent unchecked.
 */
async function personSetColumn(client, pageId, props, schema, expect = null) {
  const columns = TD_EDITOR.filter((c) => Object.hasOwn(props, c));
  if (columns.length === 0) return null;
  const fresh = decodePage(await client.retrievePage(pageId), schema).props;
  const type = (c) => schema?.properties?.[c]?.type ?? null;
  const meant = (c) => expect !== null && Object.hasOwn(expect, c) && sameValue(type(c), expect[c], fresh[c]);
  return columns.find((c) => filled(fresh[c]) && !sameValue(type(c), props[c], fresh[c]) && !meant(c)) ?? null;
}

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
 * to the pulled plain row (columns by their Notion names, plus page_id), freshly pulled by the caller before a resumed run. `setup`
 * is passed to checkPlan. The result's `code` is 0 (every op done or skipped and every read-back equal), 1 (an op failed,
 * was left uncertain, could not be read back, or was never reached: run the same command again) or 2 (a read-back differed).
 */
export async function applyPlan({
  plan, dir, client, config, schemas, pulled = {}, log = null, setup = false, root = agentRoot(), now = () => new Date(), interrupt = null,
} = {}) {
  if (!client || typeof client.createPage !== 'function' || typeof client.updatePage !== 'function' || typeof client.retrievePage !== 'function') {
    throw new TypeError('applyPlan: a Notion client is required (a script without a token must stop before this)');
  }
  if (!nonEmpty(dir)) throw new TypeError('applyPlan: dir, the run folder, is required');
  const { ops } = planParts(plan);
  if (ops.some((o) => o?.op === 'trash') && typeof client.trashPage !== 'function') throw new TypeError('applyPlan: the plan trashes rows, so the Notion client must have trashPage');

  // 1. the plan is checked again here: nothing the check refuses is ever sent
  const checked = checkPlan(plan, config, { setup, root });
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
    if (!schema?.properties || op.op === 'trash') return; // a trash op carries no values to encode
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
      if (op.op === 'trash') {
        // P51: the page must say it is in the trash, by either flag (a version that has only one of them answers with that one)
        return isInTrash(await client.retrievePage(pageId)) ? { read_back: 'ok', error: null } : { read_back: 'mismatch', error: 'read-back mismatch: the page is not in the trash' };
      }
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

  // The Claims rows of a trash plan go second (P51): the indexes of the trash ops of each claim's Tag decisions rows, by the Geo ID in front of the "::" of their Key
  const rowsOfClaim = new Map();
  ops.forEach((o, j) => {
    if (o?.op !== 'trash' || o.table !== 'tag_decisions') return;
    const at = String(o.key).lastIndexOf('::');
    if (at < 0) return;
    const geo = normId(String(o.key).slice(0, at));
    rowsOfClaim.set(geo, [...(rowsOfClaim.get(geo) ?? []), j]);
  });
  const trashedInLedger = (j) => last.get(j)?.status === 'done' && last.get(j)?.read_back === 'ok';

  // The first Tag decisions row of a claim that is not in the trash: the Claims page's relation "Tag decisions", read at the moment before the claim is trashed. The rows of this plan that the ledger
  // shows trashed are not looked at again; any other page it lists (a row created after the pull, one the plan does not list) is read, and one that is not in the trash is returned. Null when
  // there is none, and when the Claims table has no such column (nothing to look at).
  async function liveRowOfClaim(op, fresh, schema) {
    const def = schema?.properties?.[CLAIMS_TD_RELATION];
    if (def?.type !== 'relation') return null;
    const decoded = decodePage(fresh, schema);
    let ids = decoded.props[CLAIMS_TD_RELATION] ?? [];
    if ((decoded.relation_has_more ?? []).includes(CLAIMS_TD_RELATION)) ids = (await client.retrievePropertyItem(op.page_id, def.id)).map((x) => x?.relation?.id).filter(Boolean);
    const known = new Set((rowsOfClaim.get(normId(op.key)) ?? []).filter(trashedInLedger).map((j) => normId(last.get(j).page_id ?? ops[j].page_id)));
    for (const id of ids) {
      if (known.has(normId(id))) continue;
      if (!isInTrash(await client.retrievePage(id))) return id;
    }
    return null;
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

    // the caller may stop the run between two ops (remove.mjs: runs/PAUSED); the ledger lets the next run go on from here
    const interrupted = interrupt?.() ?? null;
    if (interrupted) {
      stopped = { op_index: i, key: op.key, reason: interrupted };
      break;
    }

    if (op.op === 'trash') {
      // P51. The page is trashed only when the pull of this run holds it under this key (so it is a row of the table named in the plan, never a page of the first page or any other),
      // and a row of Tag decisions only while no person has filled one of its three editor columns. A page that is in the trash already counts as done and is not sent again.
      // A Claims row goes second: only when every Tag decisions row of the claim that the plan lists is done and read back as trashed in the ledger, and when the Claims page itself
      // shows no Tag decisions row (its relation) that is still live. A claim whose row is not in the trash is left alone, ends the run with exit 1 (a failed op, named), and the next run finishes it.
      if (op.table === 'claims') {
        const blockers = (rowsOfClaim.get(normId(op.key)) ?? []).filter((j) => !trashedInLedger(j));
        if (blockers.length) {
          record(i, {
            page_id: op.page_id, status: 'failed', sent: null,
            error: `not trashed: the Tag decisions row ${short(ops[blockers[0]].key, 60)} of this claim is not in the trash yet${blockers.length > 1 ? ` (and ${blockers.length - 1} more)` : ''}`,
          });
          continue;
        }
      }
      let failure = null;
      let refused = false;
      let blocked = false;
      let taken = null;
      let wasTrashed = false;
      let sent = null;
      try {
        const row = rowFor(pulled, op.table, op.key);
        const inPull = row !== null && normId(row.page_id) === normId(op.page_id);
        const refuse = (why) => Object.assign(new Error(`refused: ${why}`), { refused: true });
        if (!pulledHas(pulled, op.table)) throw refuse(`the pull of ${op.table} was not given, so the page cannot be matched to a row`);
        if (row !== null && !inPull) throw refuse(`the pull holds a different page for this key (${row.page_id ?? 'no page id'}), not the one in the plan`);
        if (!inPull || op.table === 'tag_decisions' || op.table === 'claims') {
          // not in the pull: it may be in the trash already; a row of Tag decisions: the last look at the editor columns; a Claims row: the last look at its Tag decisions rows
          const fresh = await client.retrievePage(op.page_id);
          if (isInTrash(fresh)) wasTrashed = true;
          else if (!inPull) throw refuse(`this page is not a row of ${op.table} in the pull, so it is not trashed`);
          else if (op.table === 'tag_decisions') taken = TD_EDITOR.find((c) => filled(decodePage(fresh, schema).props[c])) ?? null;
          else {
            const live = await liveRowOfClaim(op, fresh, schema);
            if (live) throw Object.assign(new Error(`not trashed: the Tag decisions row ${live} of this claim is not in the trash`), { blocked: true });
          }
        }
        if (!wasTrashed && !taken) {
          await client.trashPage(op.page_id);
          sent = 'trash';
        }
      } catch (e) {
        failure = e;
        refused = e?.refused === true;
        blocked = e?.blocked === true;
      }
      if (failure && blocked) {
        // a live row of the claim: the claim stays, nothing was sent, and it is no failure of Notion (it does not count toward the stop)
        record(i, { page_id: op.page_id, status: 'failed', sent: null, error: short(failure.message, 400) });
        continue;
      }
      if (failure) {
        consecutive += 1;
        record(i, { page_id: op.page_id, status: 'failed', sent: refused ? null : 'trash', error: short(failure.message ?? String(failure), 400) });
        if (refused) stopped = { op_index: i, key: op.key, reason: 'refused' };
        else if (failure.status === 401 || failure.status === 403) stopped = { op_index: i, key: op.key, reason: 'notion_refused' };
        else if (consecutive >= MAX_CONSECUTIVE_FAILURES) stopped = { op_index: i, key: op.key, reason: 'failures_in_a_row' };
        continue;
      }
      consecutive = 0;
      if (taken) {
        // a person decided this row since the plan was made: nothing more is trashed, and the plan has to be made again
        record(i, { page_id: op.page_id, status: 'skipped', error: `skipped: a person set "${taken}"` });
        stopped = { op_index: i, key: op.key, reason: 'person_set' };
        continue;
      }
      record(i, { page_id: op.page_id, status: 'done', sent, ...(await readBack(op, op.page_id)) });
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
    let taken = null;
    try {
      // the bug guard (PORT-V2.md 2.4): an update that holds an editor column of Tag decisions is sent only if no person has set a different value there since the plan was made
      if (kind === 'update' && op.table === 'tag_decisions' && pageId) taken = await personSetColumn(client, pageId, sendProps, schema, op.expect ?? null);
      const encoded = taken ? {} : encodeProperties(sendProps, schema);
      if (taken) {
        // nothing is sent for this op
      } else if (kind === 'create') {
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
    if (taken) {
      record(i, { page_id: pageId, status: 'skipped', error: `skipped: a person set "${taken}"` });
      continue;
    }
    const sent = kind === 'create' ? 'create' : Object.keys(sendProps).length > 0 ? 'update' : null;
    record(i, { page_id: pageId, status: 'done', sent, ...(await readBack(op, pageId)) });
  }

  // 6. the state of the plan, from the ledger
  const result = {
    code: EXIT.OK, ok: true, done: 0, failed: 0, skipped: 0, mismatches: 0, uncertain: 0, unchecked: 0, pending: 0, already_done: already,
    created: {}, created_by_table: {}, trashed_by_table: {}, stopped, ledger: ledgerFile,
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
        if (op.op === 'trash' && line.page_id && line.read_back === 'ok') (result.trashed_by_table[op.table] ??= {})[op.key] = line.page_id;
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
