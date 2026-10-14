#!/usr/bin/env node
// Plans: the only thing that may become a Notion write.
//
//   Library:  openPlan({ runId, sourcePull, ctx }) -> builder with create(), update(), write()
//   CLI:      node agents/claim-tagger/scripts/plan.mjs check --run <id> [--pull <id>]     re-validate, write batches, arm
//             node agents/claim-tagger/scripts/plan.mjs disarm
//
// A plan is runs/<run-id>/plan.jsonl: a header line and one create or update op per line (schemas/plan-op.schema.json), values in
// plain form (strings, numbers, booleans, ISO dates, arrays of page ids). Every op passes the allowlist when it is built, again
// in `check`, and again in apply. Relation values may be written as { rulebook: "Predictive" } / { claims: "<geo id>" } /
// { tag_decisions: "<key>" } / { rule_changes: "<lesson title>" } / { runs: "<run title>" } and are resolved through the source pull's
// id map; a reference that does not resolve throws. (References to rows created in the same plan are not supported: apply the
// creating plan, pull, then build the plan that links to them.)
//
// op.expect  { [property]: plain value, $last_edited_time?: string }  the pulled row must still look like this, else the op is skipped
// op.guard   { undecided: true }                                      skip the op when the Tag decisions row has been decided meanwhile
//
// `check` also: turns creates whose key already exists into updates, skips ops whose expectation fails, whose row was decided since,
// or that would change nothing, writes runs/<id>/batches/NNN-create-<db>.json (at most 100 pages, connector shape) and
// NNN-update-<db>.jsonl for the no-token fallback, writes check.json, and arms runs/APPLYING.json { run_id, plan_sha, armed_at }.
// The header's ctx is only a claim: after the allowlist, `check` proves a Rulebook text change, a lesson set Live, a restore and a seed from
// other files (lib/gate-evidence.mjs: PROMOTING.json and a PASS card, the live rubric, runs/SETUP) and arms nothing without that proof.
// Exit codes: 0 ok, 2 invalid (allowlist refusal, gate evidence missing, hand-edited or malformed plan, pull does not cover the plan, another run armed).

import { existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  DATABASES, FOLLOW_UP_FIELDS, PROPERTY_TYPES, allowlistSha, assertOpWritable, controlPaths,
} from './allowlist.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { checkGateEvidence } from './lib/gate-evidence.mjs';
import { fileSha256 } from './lib/hash.mjs';
import { readJson, readJsonl, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { agentRoot, codeRoot, isMain } from './lib/paths.mjs';
import { encodeProperties, normId, sameValue } from './lib/notion-values.mjs';
import { validate } from './lib/validate.mjs';
import { findSchema, isDecided, keyProperty, latestPullId, loadConfig, loadPull } from './pull.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/plan.mjs check --run <id> [--pull <id>] | disarm';
export const MAX_BATCH = 100;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RESERVED_RUNS = new Set(['pull', 'judgments']);
const GUARD_KEYS = new Set(['undecided']);

export class PlanError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.name = 'PlanError';
    this.code = 'PLAN';
    this.problems = problems;
  }
}

export const planSchema = () => readJson(join(codeRoot(), 'schemas', 'plan-op.schema.json'));

/** runs/<run-id> for a run id (which must already be a safe folder name and not a reserved one). */
export function runDirOf(root, runId) {
  if (typeof runId !== 'string' || !RUN_ID.test(runId) || RESERVED_RUNS.has(runId)) throw new PlanError(`"${runId}" is not a usable run id (letters, digits, dot, dash, underscore; not "pull")`);
  return join(controlPaths(root).runs, runId);
}

// ---- the builder -------------------------------------------------------------------------------------------------

const isRef = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && DATABASES.includes(Object.keys(v)[0]);

/**
 * Start a plan. Returns { create(db, key, properties, opts), update(db, key, pageId, properties, opts), write(), ops, runId }.
 * ctx: { seed, promote, gate } passed to the allowlist (and recorded in the header so check and apply judge the plan the same way).
 * opts: { expect, guard, note, content_md (create only) }.
 */
export function openPlan({ runId, sourcePull, root = agentRoot(), config = loadConfig(root), ctx = {}, now = () => new Date(), pull } = {}) {
  const dir = runDirOf(root, runId);
  const source = pull ?? loadPull(root, sourcePull ?? latestPullId(root), { config });
  const planCtx = { seed: ctx.seed === true, promote: ctx.promote === true, gate: typeof ctx.gate === 'string' ? ctx.gate : null, ...(ctx.restore === true ? { restore: true, confirm: ctx.confirm === true } : {}) };
  const idMap = source.idMap ?? {};
  const schemas = new Map();
  const schemaOf = (db) => {
    if (!schemas.has(db)) schemas.set(db, source.schema(db) ?? findSchema(root, db, source.id));
    return schemas.get(db);
  };
  const decidedKeys = source.covers('tag_decisions') ? source.decidedKeys() : null;
  const ops = [];
  const seen = new Set();

  function resolveRelation(db, prop, value) {
    const list = value === null ? [] : Array.isArray(value) ? value : [value];
    const ids = [];
    for (const item of list) {
      if (typeof item === 'string') {
        ids.push(item);
      } else if (isRef(item)) {
        const [refDb, refKey] = Object.entries(item)[0];
        const id = idMap[refDb]?.[refKey];
        if (!id) throw new PlanError(`${db}.${prop}: unresolved reference ${JSON.stringify(item)}: no ${refDb} row with that key in pull ${source.id}`);
        ids.push(id);
      } else {
        throw new PlanError(`${db}.${prop}: a relation value must be page ids or { <database>: <key> } references, got ${JSON.stringify(item)}`);
      }
    }
    return [...new Map(ids.map((id) => [normId(id), id])).values()];
  }

  function prepare(kind, db, key, properties, opts) {
    if (!DATABASES.includes(db)) throw new PlanError(`unknown database "${db}"`);
    if (typeof key !== 'string' || key.trim() === '') throw new PlanError(`${db}: an op needs a key`);
    if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) throw new PlanError(`${db} "${key}": properties must be an object`);
    if (seen.has(`${db}\n${key}`)) throw new PlanError(`${db} "${key}" is already in this plan; one op per row`);
    if (db === 'tag_decisions' && !decidedKeys) throw new PlanError(`tag_decisions is not in pull ${source.id}: pull it before building a plan that touches it (the decided-row rule needs it)`);
    const schema = schemaOf(db);
    const keyProp = keyProperty(config, db);
    const out = {};
    for (const [prop, raw] of Object.entries(properties)) {
      if (raw === undefined) continue;
      const type = schema?.properties?.[prop]?.type ?? PROPERTY_TYPES[db]?.[prop];
      out[prop] = type === 'relation' ? resolveRelation(db, prop, raw) : raw;
      if (type !== 'relation' && (isRef(raw) || (Array.isArray(raw) && raw.some(isRef)))) throw new PlanError(`${db}.${prop}: references like { rulebook: "..." } are only for relation properties`);
    }
    if (kind === 'create') {
      if (Object.hasOwn(out, keyProp) && out[keyProp] !== key) throw new PlanError(`${db} "${key}": the key property ${keyProp} says ${JSON.stringify(out[keyProp])}`);
      out[keyProp] = key;
    } else if (Object.hasOwn(out, keyProp)) {
      if (out[keyProp] !== key) throw new PlanError(`${db} "${key}": an update may not rename the row (${keyProp} = ${JSON.stringify(out[keyProp])})`);
      delete out[keyProp];
    }
    const full = { op: kind, database: db, key, properties: out };
    try {
      assertOpWritable(full, { schema, ctx: { ...planCtx, decidedKeys: decidedKeys ?? new Set() } });
      if (schema) for (const [prop, value] of Object.entries(out)) encodeProperties({ [prop]: value }, schema);
    } catch (e) {
      if (e.code === 'ALLOWLIST') throw e;
      throw new PlanError(`${db} "${key}": ${e.message}`);
    }
    const { expect = null, guard = null, note = null, content_md: contentMd = null } = opts;
    if (expect !== null) {
      if (typeof expect !== 'object' || Array.isArray(expect)) throw new PlanError(`${db} "${key}": expect must be an object`);
      for (const name of Object.keys(expect)) {
        if (name !== '$last_edited_time' && schema && !schema.properties?.[name]) throw new PlanError(`${db} "${key}": expect names an unknown property "${name}"`);
      }
    }
    if (guard !== null) {
      if (typeof guard !== 'object' || Array.isArray(guard)) throw new PlanError(`${db} "${key}": guard must be an object`);
      for (const name of Object.keys(guard)) if (!GUARD_KEYS.has(name)) throw new PlanError(`${db} "${key}": unknown guard "${name}" (known: ${[...GUARD_KEYS].join(', ')})`);
    }
    if (contentMd !== null && kind !== 'create') throw new PlanError(`${db} "${key}": page content can only be written when a row is created`);
    seen.add(`${db}\n${key}`);
    return { expect, guard, note, content_md: contentMd, properties: out };
  }

  return {
    runId,
    ops,
    create(db, key, properties, opts = {}) {
      const p = prepare('create', db, key, properties, opts);
      const op = { op: 'create', seq: ops.length + 1, database: db, key, page_id: null, properties: p.properties, expect: p.expect, guard: p.guard, content_md: p.content_md, note: p.note };
      ops.push(op);
      return op;
    },
    update(db, key, pageId, properties, opts = {}) {
      const known = idMap[db]?.[key];
      const id = pageId ?? known;
      if (!id) throw new PlanError(`${db} "${key}": no page id given and none in pull ${source.id}`);
      if (known && normId(known) !== normId(id)) throw new PlanError(`${db} "${key}": page id ${id} is not the pull's row for this key (${known})`);
      const p = prepare('update', db, key, properties, opts);
      const op = { op: 'update', seq: ops.length + 1, database: db, key, page_id: id, properties: p.properties, expect: p.expect, guard: p.guard, content_md: null, note: p.note };
      ops.push(op);
      return op;
    },
    /** Write runs/<run-id>/plan.jsonl (header + ops, each checked against the plan-op schema). Returns { path, sha, header, counts }. */
    write() {
      const by = {};
      for (const o of ops) {
        by[o.database] ??= { create: 0, update: 0 };
        by[o.database][o.op] += 1;
      }
      const counts = { create: ops.filter((o) => o.op === 'create').length, update: ops.filter((o) => o.op === 'update').length, by_database: by };
      const header = {
        op: 'header', plan_id: `plan-${runId}`, run_id: runId, created_at: now().toISOString(), source_pull: source.id, counts, allowlist_sha: allowlistSha(), ctx: planCtx,
      };
      const schema = planSchema();
      const problems = [];
      for (const line of [header, ...ops]) {
        const result = validate(schema, line);
        if (!result.ok) problems.push(`${line.op === 'header' ? 'header' : `op ${line.seq}`}: ${result.errors.join('; ')}`);
      }
      if (problems.length) throw new PlanError('the plan does not match plan-op.schema.json', problems);
      if (existsSync(join(dir, 'applied.jsonl')) || existsSync(join(dir, 'apply.json'))) throw new PlanError(`run "${runId}" has already been applied (in part); build the new plan under a new run id`);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'plan.jsonl');
      writeTextAtomic(path, [header, ...ops].map((l) => JSON.stringify(l)).join('\n') + '\n');
      return { path, sha: fileSha256(path), header, counts };
    },
  };
}

// ---- reading a plan back -----------------------------------------------------------------------------------------

/** Read and validate runs/<run-id>/plan.jsonl: { path, dir, header, ops, sha }. Throws PlanError with every problem found. */
export function readPlan(root, runId) {
  const dir = runDirOf(root, runId);
  const path = join(dir, 'plan.jsonl');
  if (!existsSync(path)) throw new PlanError(`there is no plan for run "${runId}" (${path})`);
  let parsed;
  try {
    parsed = readJsonl(path);
  } catch (e) {
    throw new PlanError(`the plan for run "${runId}" is not valid`, [e.message]);
  }
  const { rows, torn } = parsed;
  const problems = [];
  if (torn) problems.push('the last line of the plan is cut off');
  const schema = planSchema();
  rows.forEach((row, i) => {
    const result = validate(schema, row);
    if (!result.ok) problems.push(`line ${i + 1}: ${result.errors.join('; ')}`);
  });
  const [header, ...ops] = rows;
  if (!header || header.op !== 'header') problems.push('the first line must be the header');
  if (header && header.run_id !== runId) problems.push(`the header says run "${header.run_id}", the folder is "${runId}"`);
  ops.forEach((o, i) => {
    if (o.op === 'header') problems.push(`line ${i + 2}: a second header`);
    if (o.seq !== i + 1) problems.push(`line ${i + 2}: seq ${o.seq}, expected ${i + 1}`);
  });
  if (problems.length) throw new PlanError(`the plan for run "${runId}" is not valid`, problems);
  return { path, dir, header, ops, sha: fileSha256(path) };
}

// ---- armed state -------------------------------------------------------------------------------------------------

/** runs/APPLYING.json as an object, null when nothing is armed, { unreadable: true } when the file cannot be parsed. */
export function armedState(root = agentRoot()) {
  const file = controlPaths(root).applying;
  if (!existsSync(file)) return null;
  try {
    return readJson(file);
  } catch {
    return { unreadable: true };
  }
}

/** Remove runs/APPLYING.json. Returns the run id that was armed, or null. */
export function disarm(root = agentRoot()) {
  const state = armedState(root);
  if (!state) return null;
  unlinkSync(controlPaths(root).applying);
  return state.run_id ?? 'unreadable';
}

// ---- resolving a plan against a pull ------------------------------------------------------------------------------

const valuesDiffer = (schema, prop, planned, row) => !sameValue(schema?.properties?.[prop]?.type ?? null, planned, row.props[prop] ?? null);

/**
 * Judge every op against a pull: create -> update when the key exists; skip when the row is missing, duplicated, changed
 * (expect), decided since (guard or the decided-row rule), or already up to date; refuse (violations) what the allowlist refuses.
 * Returns { ops: [{ seq, kind, database, key, page_id, properties, content_md, note, converted }], skipped: [{ seq, database, key, reason }], violations }.
 */
export function resolveOps(plan, pull, { config }) {
  const ctx = { ...(plan.header.ctx ?? {}) };
  const decided = pull.covers('tag_decisions') ? pull.decidedKeys() : new Set();
  const duplicated = new Set((pull.idMap?.duplicates ?? []).map((d) => `${d.db}\n${d.key}`));
  const resolved = [];
  const skipped = [];
  const violations = [];
  for (const op of plan.ops) {
    const { database: db, key } = op;
    const skip = (reason) => skipped.push({ seq: op.seq, database: db, key, reason });
    const schema = pull.schema(db);
    const existingId = pull.idMap?.[db]?.[key] ?? null;
    const row = existingId ? pull.rowByPageId(db, existingId) : null;
    if (duplicated.has(`${db}\n${key}`)) { skip('the key exists twice in Notion; a person has to merge the rows'); continue; }
    let kind = op.op;
    let converted = false;
    if (kind === 'create' && existingId) { kind = 'update'; converted = true; }
    if (kind === 'update') {
      if (!existingId || !row) { skip('no row with this key in the pull'); continue; }
      if (op.page_id && normId(op.page_id) !== normId(existingId)) { skip(`the plan says page ${op.page_id}, the pull has ${existingId} for this key`); continue; }
    }
    const keyProp = keyProperty(config, db);
    let properties = converted ? Object.fromEntries(Object.entries(op.properties).filter(([p]) => p !== keyProp)) : op.properties;
    const dropped = [];
    if (converted) {
      // an upsert never applies what only a create may write (Status Proposed, the seeded Weekly cap and Name): the row already exists
      const accepts = (p, v, as) => {
        try {
          assertOpWritable({ op: as, database: db, key, properties: { [p]: v } }, { schema, ctx: { ...ctx, decidedKeys: decided } });
          return true;
        } catch (e) {
          if (e.code !== 'ALLOWLIST') throw e;
          return false;
        }
      };
      const keep = {};
      for (const [p, v] of Object.entries(properties)) {
        if (accepts(p, v, 'update') || !accepts(p, v, 'create')) keep[p] = v; // refused either way: the check below reports it
        else dropped.push(p);
      }
      properties = keep;
      if (Object.keys(properties).length === 0) { skip(`the row already exists; create-only properties were not applied (${dropped.join(', ')})`); continue; }
    }
    if (db === 'tag_decisions' && row && decided.has(key)) {
      const outside = Object.keys(properties).filter((p) => !FOLLOW_UP_FIELDS.includes(p));
      if (outside.length) { skip(`the row was decided since the plan was built (it would write ${outside.join(', ')})`); continue; }
    }
    if (row && op.guard?.undecided && isDecided(row)) { skip('guard: the row has been decided'); continue; }
    if (row && op.expect) {
      const failed = Object.entries(op.expect).find(([name, want]) => (name === '$last_edited_time' ? row.last_edited_time !== want : !sameValue(schema?.properties?.[name]?.type ?? null, want, row.props[name] ?? null)));
      if (failed) { skip(`expectation failed: ${failed[0]} is no longer ${JSON.stringify(failed[1])}`); continue; }
    }
    try {
      assertOpWritable({ op: kind, database: db, key, properties }, { schema, ctx: { ...ctx, decidedKeys: decided } });
    } catch (e) {
      if (e.code !== 'ALLOWLIST') throw e;
      violations.push({ seq: op.seq, database: db, key, reason: e.reason, message: e.message });
      continue;
    }
    if (kind === 'update' && Object.entries(properties).every(([p, v]) => !valuesDiffer(schema, p, v, row))) { skip('already up to date'); continue; }
    resolved.push({ seq: op.seq, kind, database: db, key, page_id: kind === 'update' ? existingId : null, properties, content_md: kind === 'create' ? op.content_md ?? null : null, note: op.note ?? null, converted, ...(dropped.length ? { dropped } : {}) });
  }
  return { ops: resolved, skipped, violations };
}

// ---- connector batches (the no-token fallback) --------------------------------------------------------------------

/**
 * Plain values in the Notion connector's flat form: text, select, url and number as they are, checkbox as __YES__ / __NO__,
 * multi-select, relation and people as JSON strings, dates as date:<name>:start / :end / :is_datetime.
 */
export function toConnectorProperties(plain, schema) {
  const out = {};
  for (const [name, value] of Object.entries(plain)) {
    const type = schema?.properties?.[name]?.type;
    if (!type) {
      if (name.endsWith(':end') && schema?.properties?.[name.slice(0, -4)]?.type === 'date') continue;
      throw new PlanError(`cannot send unknown property "${name}"`);
    }
    switch (type) {
      case 'checkbox': out[name] = value ? '__YES__' : '__NO__'; break;
      case 'multi_select': case 'relation': case 'people': out[name] = JSON.stringify(value); break;
      case 'date': {
        out[`date:${name}:start`] = value;
        if (plain[`${name}:end`]) out[`date:${name}:end`] = plain[`${name}:end`];
        out[`date:${name}:is_datetime`] = typeof value === 'string' && value.includes('T') ? 1 : 0;
        break;
      }
      default: out[name] = value ?? null;
    }
  }
  return out;
}

/** Write batches/NNN-create-<db>.json and NNN-update-<db>.jsonl for resolved ops; returns [{ file, kind, database, count }]. */
export function writeBatches({ dir, ops, config, pull }) {
  const batchDir = join(dir, 'batches');
  rmSync(batchDir, { recursive: true, force: true });
  mkdirSync(batchDir, { recursive: true });
  const groups = [];
  for (const op of ops) {
    let group = groups.find((g) => g.kind === op.kind && g.database === op.database && g.ops.length < MAX_BATCH);
    if (!group) {
      group = { kind: op.kind, database: op.database, ops: [] };
      groups.push(group);
    }
    group.ops.push(op);
  }
  const files = [];
  groups.forEach((g, i) => {
    const schema = pull.schema(g.database);
    const name = `${String(i + 1).padStart(3, '0')}-${g.kind}-${g.database}.${g.kind === 'create' ? 'json' : 'jsonl'}`;
    if (g.kind === 'create') {
      const pages = g.ops.map((o) => ({ properties: toConnectorProperties(o.properties, schema), ...(o.content_md ? { content: o.content_md } : {}) }));
      writeJsonAtomic(join(batchDir, name), { parent: { data_source_id: config.notion.databases[g.database].data_source_id }, pages });
    } else {
      writeTextAtomic(join(batchDir, name), g.ops.map((o) => JSON.stringify({ page_id: o.page_id, properties: toConnectorProperties(o.properties, schema) })).join('\n') + '\n');
    }
    files.push({ file: name, kind: g.kind, database: g.database, count: g.ops.length });
  });
  return files;
}

// ---- check --------------------------------------------------------------------------------------------------------

/**
 * Re-validate the plan of a run against a pull, write batches and check.json, arm APPLYING.json.
 * Returns { code, line, problems, ... }; nothing is armed unless code is 0.
 */
export function check({ root = agentRoot(), config = loadConfig(root), runId, pullId, now = () => new Date() }) {
  let plan;
  try {
    plan = readPlan(root, runId);
  } catch (e) {
    if (e instanceof PlanError) return { code: EXIT.INVALID, line: null, problems: [e.message, ...e.problems] };
    throw e;
  }
  const usedPull = pullId ?? latestPullId(root) ?? plan.header.source_pull;
  let pull;
  try {
    pull = loadPull(root, usedPull, { config });
  } catch (e) {
    return { code: EXIT.INVALID, line: null, problems: [e.message] };
  }
  const touched = [...new Set(plan.ops.map((o) => o.database))];
  const uncovered = touched.filter((db) => !pull.covers(db));
  if (uncovered.length) return { code: EXIT.INVALID, line: null, problems: [`pull ${pull.id} does not cover ${uncovered.join(', ')}: run pull.mjs --dbs ${touched.join(',')} first (existing rows and decided rows cannot be told otherwise)`] };
  const armed = armedState(root);
  if (armed && armed.run_id !== runId) return { code: EXIT.INVALID, line: null, problems: [`run ${armed.run_id ?? '(unreadable APPLYING.json)'} is still armed; finish it or run plan.mjs disarm first`] };

  const { ops, skipped, violations } = resolveOps(plan, pull, { config });
  if (violations.length) return { code: EXIT.INVALID, line: null, problems: violations.map((v) => `op ${v.seq} (${v.database} "${v.key}"): ${v.message}`), violations };
  // the allowlist trusts the header; the evidence does not (a forged ctx passes the allowlist and stops here)
  const gate = checkGateEvidence({ root, plan, pull, config });
  if (!gate.ok) {
    if (armed) disarm(root); // armed for this very run by an earlier check (any other run returned above): a plan that lost its proof is not armed any longer
    return { code: EXIT.INVALID, line: null, problems: gate.problems.map((p) => `gate evidence: ${p}`), gate };
  }

  const batches = writeBatches({ dir: plan.dir, ops, config, pull });
  const checkedAt = now().toISOString();
  const summary = {
    run_id: runId, plan_sha: plan.sha, checked_at: checkedAt, pull_id: pull.id, ops_total: plan.ops.length, to_apply: ops.length,
    creates: ops.filter((o) => o.kind === 'create').length, updates: ops.filter((o) => o.kind === 'update').length,
    converted: ops.filter((o) => o.converted).map((o) => ({ seq: o.seq, database: o.database, key: o.key, ...(o.dropped ? { dropped: o.dropped } : {}) })), skipped, batches, allowlist_sha: allowlistSha(),
    ...(gate.evidence.modes.length ? { gate_evidence: gate.evidence } : {}),
  };
  writeJsonAtomic(join(plan.dir, 'check.json'), summary);
  rmSync(join(plan.dir, 'guard-ledger.jsonl'), { force: true });
  writeJsonAtomic(controlPaths(root).applying, { run_id: runId, plan_sha: plan.sha, armed_at: checkedAt });
  const line = `plan check: run ${runId} (pull ${pull.id}): ${ops.length} to apply (${summary.creates} create, ${summary.updates} update, ${summary.converted.length} converted), ${skipped.length} skipped, ${batches.length} batch file(s); armed ${plan.sha.slice(0, 12)}`;
  return { code: EXIT.OK, line, problems: [], summary };
}

// ---- command line ------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Run the script; returns the exit code. env (tests): { root, now }. */
export function main(argv, io = defaultIo, env = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { run: { type: 'string' }, pull: { type: 'string' }, help: { type: 'boolean', short: 'h' } }, strict: true, allowPositionals: true });
  } catch (e) {
    io.err(`plan: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  const [command, ...extra] = parsed.positionals;
  const { run, pull, help } = parsed.values;
  if (help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  if (!['check', 'disarm'].includes(command) || extra.length) {
    io.err(`plan: expected "check" or "disarm"\n${USAGE}`);
    return EXIT.INVALID;
  }
  const root = env.root ?? agentRoot();
  try {
    if (command === 'disarm') {
      const was = disarm(root);
      io.out(was ? `plan disarm: run ${was} disarmed` : 'plan disarm: nothing was armed');
      return EXIT.OK;
    }
    if (!run) {
      io.err(`plan: check needs --run <id>\n${USAGE}`);
      return EXIT.INVALID;
    }
    const result = check({ root, runId: run, pullId: pull, now: env.now });
    if (result.code !== EXIT.OK) {
      for (const p of result.problems) io.err(`plan: ${p}`);
      return result.code;
    }
    io.out(result.line);
    for (const s of result.summary.skipped) io.err(`plan: skipped op ${s.seq} (${s.database} "${s.key}"): ${s.reason}`);
    return EXIT.OK;
  } catch (e) {
    io.err(`plan: ${e.message}`);
    return e instanceof PlanError ? EXIT.INVALID : EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));

