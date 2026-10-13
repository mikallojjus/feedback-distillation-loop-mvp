#!/usr/bin/env node
// Verify: did every op of a run land, and did anyone change an editor-owned field under the agent while it wrote?
//
//   node agents/claim-tagger/scripts/verify.mjs --run <id> [--pre <pull-id>] [--post <pull-id>]
//
// pre and post default to the pulls apply.mjs recorded in runs/<id>/apply.json; after an apply by connector there is no such file, so pre is
// the pull the plan was built on (header.source_pull) and post is the newest pull (pull.mjs after the connector calls).
//   Landed:   every op that was not skipped is looked up by key in the post pull and each planned property is compared with the
//             pulled value (text normalised, relations and people as id sets, numbers within 1e-9, dates by start).
//   Editors:  for every page the plan touched, the editor-owned fields in the pre snapshot must equal the post snapshot (fields the
//             plan wrote itself are not compared). A difference writes runs/PAUSED { run_id, page_id, field, before, after, detected_at }.
//             Pages the plan did not touch are ignored: editors work while the agent does.
// Writes runs/<id>/verify.json, and runs/<id>/plan.retry.jsonl (header + the ops that did not land) when there are any.
// Exit codes: 0 clean, 1 ops missing or different (retry file written), 2 invalid input or duplicate keys, 5 an editor field changed.

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { controlPaths } from './allowlist.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { readJson, readJsonl, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { agentRoot, isMain } from './lib/paths.mjs';
import { sameValue } from './lib/notion-values.mjs';
import { PlanError, readPlan } from './plan.mjs';
import { latestPullId, loadConfig, loadPull } from './pull.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/verify.mjs --run <id> [--pre <pull-id>] [--post <pull-id>]';

/** The latest ledger row per seq from runs/<id>/applied.jsonl (empty map when the run was applied by connector). */
export function readLedger(dir) {
  const file = join(dir, 'applied.jsonl');
  const bySeq = new Map();
  if (!existsSync(file)) return bySeq;
  for (const row of readJsonl(file).rows) bySeq.set(row.seq, row);
  return bySeq;
}

const sorted = (list) => [...list].sort((a, b) => a.seq - b.seq);

// An op that was skipped because Notion already showed its values is still checked: that is exactly what verify compares.
const UP_TO_DATE = 'already up to date';

/**
 * Check a run. Returns { code, line, result } and writes verify.json / plan.retry.jsonl / PAUSED as described above.
 */
export function verify({ root = agentRoot(), config = loadConfig(root), runId, prePullId, postPullId, now = () => new Date() }) {
  let plan;
  try {
    plan = readPlan(root, runId);
  } catch (e) {
    if (e instanceof PlanError) return { code: EXIT.INVALID, line: null, problems: [e.message, ...e.problems] };
    throw e;
  }
  const applyFile = join(plan.dir, 'apply.json');
  const applyState = existsSync(applyFile) ? readJson(applyFile) : {};
  // after apply.mjs: the pulls it recorded. After an apply by connector: the pull the plan was built on and the newest pull.
  const preId = prePullId ?? applyState.pre_pull ?? plan.header.source_pull;
  const postId = postPullId ?? applyState.post_pull ?? latestPullId(root);
  if (!preId || !postId) return { code: EXIT.INVALID, line: null, problems: ['verify needs a pre and a post pull: pass --pre and --post, or pull after the apply (the newest pull is the post pull, the source pull of the plan is the pre pull)'] };
  let pre;
  let post;
  try {
    pre = loadPull(root, preId, { config });
    post = loadPull(root, postId, { config });
  } catch (e) {
    return { code: EXIT.INVALID, line: null, problems: [e.message] };
  }
  const touchedDbs = [...new Set(plan.ops.map((o) => o.database))];
  const uncovered = touchedDbs.filter((db) => !post.covers(db));
  if (uncovered.length) return { code: EXIT.INVALID, line: null, problems: [`the post pull ${post.id} does not cover ${uncovered.join(', ')}`] };

  // which ops are expected to have landed
  const ledger = readLedger(plan.dir);
  const checkFile = join(plan.dir, 'check.json');
  const checkedSkips = new Map(existsSync(checkFile) ? (readJson(checkFile).skipped ?? []).map((s) => [s.seq, s.reason]) : []);
  const skipped = [];
  const expected = [];
  for (const op of plan.ops) {
    const row = ledger.get(op.seq);
    const reason = ledger.size > 0 ? (row?.status === 'skipped' ? row.reason ?? 'skipped' : null) : checkedSkips.get(op.seq) ?? null;
    if (reason !== null && reason !== UP_TO_DATE) skipped.push({ seq: op.seq, database: op.database, key: op.key, reason });
    else expected.push(op);
  }

  // every expected op: row exists, planned values match
  const missing = [];
  const mismatched = [];
  const duplicates = [];
  const touched = new Map(); // page id -> { db, key, written: Set of property names }
  const dupKeys = new Set((post.idMap?.duplicates ?? []).map((d) => `${d.db}\n${d.key}`));
  for (const op of expected) {
    if (dupKeys.has(`${op.database}\n${op.key}`)) {
      duplicates.push({ seq: op.seq, database: op.database, key: op.key, page_ids: post.idMap.duplicates.find((d) => d.db === op.database && d.key === op.key).page_ids });
      continue;
    }
    const row = post.rowByKey(op.database, op.key);
    if (!row) {
      missing.push(op);
      continue;
    }
    const schema = post.schema(op.database);
    const bad = Object.entries(op.properties).filter(([prop, planned]) => !sameValue(schema?.properties?.[prop]?.type ?? null, planned, row.props[prop] ?? null));
    for (const [prop, planned] of bad) mismatched.push({ seq: op.seq, database: op.database, key: op.key, property: prop, planned, actual: row.props[prop] ?? null, op });
    const entry = touched.get(row.page_id) ?? { db: op.database, key: op.key, written: new Set() };
    for (const prop of Object.keys(op.properties)) entry.written.add(prop.replace(/:end$/, ''));
    touched.set(row.page_id, entry);
  }

  // editor-owned fields on touched pages: pre snapshot against post snapshot
  const before = pre.snapshot()?.editor_fields ?? {};
  const after = post.snapshot()?.editor_fields ?? {};
  const editorChanges = [];
  for (const [pageId, info] of touched) {
    const was = before[pageId];
    const is = after[pageId];
    if (!was || !is) continue; // a page the pre pull never saw (just created) has no baseline
    const schema = post.schema(info.db);
    for (const field of new Set([...Object.keys(was.fields), ...Object.keys(is.fields)])) {
      if (info.written.has(field.replace(/:end$/, ''))) continue; // the plan wrote it itself (rule_changes Status: Live, Rolled back)
      const a = was.fields[field] ?? null;
      const b = is.fields[field] ?? null;
      if (!sameValue(schema?.properties?.[field]?.type ?? null, a, b)) editorChanges.push({ page_id: pageId, db: info.db, key: info.key, field, before: a, after: b });
    }
  }

  const retryOps = sorted([...new Map([...missing.map((o) => [o.seq, o]), ...mismatched.map((m) => [m.seq, m.op])]).values()]);
  const checkedAt = now().toISOString();
  const code = editorChanges.length ? EXIT.TRUST : duplicates.length ? EXIT.INVALID : retryOps.length ? EXIT.ERROR : EXIT.OK;
  const resultName = { [EXIT.TRUST]: 'trust_breaker', [EXIT.INVALID]: 'duplicates', [EXIT.ERROR]: 'retry', [EXIT.OK]: 'clean' }[code];
  const result = {
    run_id: runId, plan_sha: plan.sha, pre_pull: pre.id, post_pull: post.id, checked_at: checkedAt, result: resultName, ops_total: plan.ops.length,
    landed: expected.length - missing.length - new Set(mismatched.map((m) => m.seq)).size - duplicates.length, skipped,
    missing: missing.map((o) => ({ seq: o.seq, database: o.database, key: o.key })), mismatched: mismatched.map(({ op, ...rest }) => rest), duplicates, editor_changes: editorChanges,
  };
  writeJsonAtomic(join(plan.dir, 'verify.json'), result);

  const retryFile = join(plan.dir, 'plan.retry.jsonl');
  if (retryOps.length) {
    const header = { ...plan.header, created_at: checkedAt, retry_of: runId, counts: { create: retryOps.filter((o) => o.op === 'create').length, update: retryOps.filter((o) => o.op === 'update').length } };
    writeTextAtomic(retryFile, [header, ...retryOps].map((l) => JSON.stringify(l)).join('\n') + '\n');
  } else {
    rmSync(retryFile, { force: true });
  }

  if (editorChanges.length) {
    const pausedFile = controlPaths(root).paused;
    const first = editorChanges[0];
    const previous = existsSync(pausedFile) ? safeRead(pausedFile) : undefined;
    writeJsonAtomic(pausedFile, { run_id: runId, page_id: first.page_id, field: first.field, before: first.before, after: first.after, detected_at: checkedAt, changes: editorChanges, ...(previous === undefined ? {} : { previous }) });
  }

  let line;
  if (code === EXIT.TRUST) {
    const f = editorChanges[0];
    line = `verify: run ${runId}: TRUST BREAKER: ${f.field} changed on ${f.db} "${f.key}" (page ${f.page_id}) from ${JSON.stringify(f.before)} to ${JSON.stringify(f.after)}${editorChanges.length > 1 ? ` (+${editorChanges.length - 1} more)` : ''}; runs/PAUSED written`;
  } else if (code === EXIT.INVALID) {
    line = `verify: run ${runId}: ${duplicates.length} key(s) exist twice in Notion (${duplicates.map((d) => `${d.database} "${d.key}"`).join(', ')}); a person has to merge them`;
  } else if (code === EXIT.ERROR) {
    line = `verify: run ${runId}: ${retryOps.length} of ${expected.length} op(s) did not land (${missing.length} missing, ${new Set(mismatched.map((m) => m.seq)).size} with other values); plan.retry.jsonl written`;
  } else {
    line = `verify: run ${runId} clean: ${result.landed} op(s) landed, ${skipped.length} skipped, editor fields changed: 0`;
  }
  return { code, line, result, retry: retryOps.length };
}

function safeRead(file) {
  try {
    return readJson(file);
  } catch {
    return 'unreadable';
  }
}

// ---- command line ------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Run the script; returns the exit code. env (tests): { root, now }. */
export function main(argv, io = defaultIo, env = {}) {
  let args;
  try {
    args = parseArgs({ args: argv, options: { run: { type: 'string' }, pre: { type: 'string' }, post: { type: 'string' }, help: { type: 'boolean', short: 'h' } }, strict: true, allowPositionals: false }).values;
  } catch (e) {
    io.err(`verify: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  if (!args.run) {
    io.err(`verify: --run <id> is required\n${USAGE}`);
    return EXIT.INVALID;
  }
  try {
    const result = verify({ root: env.root ?? agentRoot(), runId: args.run, prePullId: args.pre, postPullId: args.post, now: env.now });
    if (result.line === null) {
      for (const p of result.problems) io.err(`verify: ${p}`);
      return result.code;
    }
    io.out(result.line);
    if (result.code === EXIT.TRUST) {
      for (const c of result.result.editor_changes) io.err(`verify: ${c.db} "${c.key}" ${c.field}: before ${JSON.stringify(c.before)}, after ${JSON.stringify(c.after)}`);
    } else if (result.code === EXIT.ERROR) {
      for (const m of result.result.missing) io.err(`verify: missing: op ${m.seq} (${m.database} "${m.key}")`);
      for (const m of result.result.mismatched) io.err(`verify: op ${m.seq} (${m.database} "${m.key}") ${m.property}: planned ${JSON.stringify(m.planned)}, found ${JSON.stringify(m.actual)}`);
    }
    return result.code;
  } catch (e) {
    io.err(`verify: ${e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));

