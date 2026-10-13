#!/usr/bin/env node
// snapshot: save the state of the Notion databases after a demo step as evidence.
//
//   node agents/claim-tagger/scripts/snapshot.mjs --step <n> [--label <text>] [--pull <id>]
//
// Copies the norm files of the latest pull (or --pull) - claims.jsonl, rulebook.json, queue.jsonl, decisions.jsonl, lessons.jsonl, runs.jsonl,
// settings.json, whichever the pull holds - plus a summary.json (counts per stage, per lesson status, per readiness, per Direction and Why in queue,
// the rubric in force, the pull id and time) into docs/mvp-2026-10/evidence/notion/<nn>-<label>/, nn being the step number with two digits.
// The label defaults to "step"; it is cut down to letters, digits, '.', '_' and '-' so the folder name is safe on Windows.
// A folder that already exists is not overwritten (exit 2): evidence is not edited after the fact; pick a new step number or label.
// Exit codes: 0 ok, 1 error, 2 invalid (no pull, a bad step number, the folder exists).

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { EXIT } from './lib/exit-codes.mjs';
import { readJson, readJsonl, writeJsonAtomic } from './lib/jsonl.mjs';
import { agentRoot, isMain, repoRoot, safeName } from './lib/paths.mjs';
import { latestPullId, loadConfig, loadPull } from './pull.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/snapshot.mjs --step <n> [--label <text>] [--pull <id>]';

export const NORM_FILES = Object.freeze(['claims.jsonl', 'rulebook.json', 'queue.jsonl', 'decisions.jsonl', 'lessons.jsonl', 'runs.jsonl', 'settings.json']);

class UsageError extends Error {}

const tally = (rows, field) => {
  const out = {};
  for (const r of rows) {
    const k = r[field] ?? '(empty)';
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
};

/** The counts a snapshot records: per stage, Direction, Why in queue, lesson status, readiness and run verdict, from the norm files of a pull. */
export function summarise(pull) {
  const norm = (name) => (existsSync(join(pull.dir, 'norm', name)) ? name : null);
  const rows = (name) => (norm(name) ? readJsonl(join(pull.dir, 'norm', name)).rows : null);
  const queue = rows('queue.jsonl');
  const claims = rows('claims.jsonl');
  const lessons = rows('lessons.jsonl');
  const runs = rows('runs.jsonl');
  const decisions = rows('decisions.jsonl');
  const settings = norm('settings.json') ? readJson(join(pull.dir, 'norm', 'settings.json')) : null;
  const rulebook = norm('rulebook.json') ? readJson(join(pull.dir, 'norm', 'rulebook.json')) : null;
  return {
    pull_id: pull.id,
    taken_at: pull.info.taken_at,
    databases: pull.info.dbs,
    counts: pull.info.counts ?? {},
    queue: queue ? { total: queue.length, by_stage: tally(queue, 'stage'), by_direction: tally(queue, 'direction'), by_why_in_queue: tally(queue, 'why_in_queue'), by_priority: tally(queue, 'priority'), decided: decisions?.length ?? queue.filter((r) => r.effective_outcome === 'Applies' || r.effective_outcome === 'Does not apply').length, editor_decided: queue.filter((r) => r.tag_outcome).length, with_lesson: queue.filter((r) => (r.lesson_page_ids ?? []).length).length, in_regression_suite: queue.filter((r) => r.in_regression_suite).length, by_follow_up: tally(queue, 'agent_follow_up') } : null,
    claims: claims ? { total: claims.length, by_readiness: tally(claims, 'readiness'), by_sample: tally(claims, 'sample') } : null,
    lessons: lessons ? { total: lessons.length, by_status: tally(lessons, 'status'), list: lessons.map((l) => ({ id: l.lesson_id, key: l.lesson_key, tag: l.tag, status: l.status, rubric_version: l.rubric_version })) } : null,
    runs: runs ? { total: runs.length, by_kind: tally(runs, 'kind'), by_verdict: tally(runs, 'verdict') } : null,
    rulebook: rulebook ? { tags: rulebook.rows?.length ?? 0, drift: rulebook.drift?.length ?? 0, rule_versions: tally(rulebook.rows ?? [], 'rule_version'), changed_by: (rulebook.rows ?? []).filter((r) => (r.changed_by ?? []).length).map((r) => r.name) } : null,
    settings: settings ? { paused: settings.paused, rubric_in_force: settings.rubric_in_force, last_run_summary: settings.last_run_summary } : null,
  };
}

/** Copy a pull's norm files and write summary.json into the evidence folder. Returns { dir, files, summary }. */
export function takeSnapshot({ root = agentRoot(), config = loadConfig(root), pullId, step, label = 'step', evidenceDir = join(repoRoot(), 'docs', 'mvp-2026-10', 'evidence', 'notion') }) {
  const id = pullId ?? latestPullId(root);
  if (!id) throw new UsageError('there is no pull yet: run pull.mjs first');
  const pull = loadPull(root, id, { config });
  const nn = String(step).padStart(2, '0');
  const slug = safeName(String(label).trim().replace(/\s+/g, '-').toLowerCase()).replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '') || 'step';
  const name = `${nn}-${slug}`;
  const dir = join(evidenceDir, name);
  if (existsSync(dir)) throw new UsageError(`${dir} already exists: evidence is not overwritten; pick another step or label`);
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (const f of NORM_FILES) {
    const from = join(pull.dir, 'norm', f);
    if (existsSync(from)) {
      copyFileSync(from, join(dir, f));
      files.push(f);
    }
  }
  const summary = { step: Number(step), label, folder: name, files, ...summarise(pull) };
  writeJsonAtomic(join(dir, 'summary.json'), summary);
  return { dir, files, summary, name };
}

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Run the script; returns the exit code. env (tests): { root, config, evidenceDir }. */
export function main(argv, io = defaultIo, env = {}) {
  let args;
  try {
    args = parseArgs({ args: argv, options: { step: { type: 'string' }, label: { type: 'string' }, pull: { type: 'string' }, help: { type: 'boolean', short: 'h' } }, strict: true, allowPositionals: false }).values;
    if (!args.help && !/^\d{1,3}$/.test(args.step ?? '')) throw new UsageError('--step needs a whole number (0 to 999)');
  } catch (e) {
    io.err(`snapshot: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  try {
    const result = takeSnapshot({ root: env.root, config: env.config, pullId: args.pull, step: Number(args.step), label: args.label, evidenceDir: env.evidenceDir });
    const q = result.summary.queue;
    io.out(`snapshot: ${result.name}: ${result.files.length} file(s) from pull ${result.summary.pull_id}${q ? `; queue ${q.total} rows, stages ${JSON.stringify(q.by_stage)}` : ''}${result.summary.lessons ? `; lessons ${JSON.stringify(result.summary.lessons.by_status)}` : ''} -> ${result.dir}`);
    return EXIT.OK;
  } catch (e) {
    if (e instanceof UsageError || /does not exist|no pull yet/.test(e.message)) {
      io.err(`snapshot: ${e.message}`);
      return EXIT.INVALID;
    }
    io.err(`snapshot: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
