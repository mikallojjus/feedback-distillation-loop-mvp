#!/usr/bin/env node
// Status: what is the agent in, right now? Local only: it reads files (the newest pull, the rubric and its lock, runs/), never Notion.
// (Refreshing the pull first is the skill's job: `pull.mjs --dbs agent_settings,tag_decisions,rule_changes,runs` and then this.)
//
//   node agents/claim-tagger/scripts/status.mjs [--check] [--run <id>] [--json] [--unpause --confirm] [--restore-rulebook --confirm]
//
//   (no flag)            the report: rubric version and hash and whether rubric.lock and the Rulebook agree, drift, PAUSED (with the trust-breaker
//                        details) and Paused in Agent settings, a promote or an apply in flight, the age of the pull, queue counts by stage and
//                        the Needs-your-note count, lessons by status, the last three run cards, unfinished judge runs with the command to resume
//                        them, and the total cost of the run folders.
//   --check              one line and an exit code, for the skill's preflight: 3 PAUSED (the file or the Agent settings box), 4 rubric.lock does
//                        not match rubric.json or the Rulebook differs from the rubric (drift), 2 a promote is in flight (runs/PROMOTING.json),
//                        else 0. Checks that need the pull (Paused in Notion, drift) are reported as "not checked" when there is no pull.
//   --run <id>           the progress of one run: its run.json, the judge ledger counts, how many judgment files are there, the plan, apply and
//                        verify files, the card.
//   --json               the same facts as one JSON object.
//   --unpause --confirm  deletes runs/PAUSED and records who and when in runs/state/unpaused.jsonl. Only a person does this: the editors' box in
//                        Agent settings (Paused) is theirs and is never touched here.
//   --restore-rulebook --confirm
//                        THE ENGINEER-ONLY PATH. Builds a plan that writes the live rubric's own When to use (plus Rule version and Tag hash) back
//                        into every Rulebook row that drifted from rubric.json. It never introduces text: the file is the truth, Notion is brought
//                        back to it. The plan carries ctx { restore: true, confirm: true }, the one non-gate way the allowlist lets "When to use"
//                        change. Drift in other columns (description, examples, polarity, ...) cannot be written by a script: it is listed.
//
// Library: inspect(), preflight(), buildRestorePlan(), tagRuleVersion(), lockState(), pausedFile() are used by distill, promote, followup, cases-sync.
// Exit codes: 0 ok, 1 error, 2 invalid use (or a promote in flight for --check), 3 paused, 4 drift or lock mismatch.

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { controlPaths } from './allowlist.mjs';
import { EXIT, describeExit } from './lib/exit-codes.mjs';
import { fileSha256 } from './lib/hash.mjs';
import { appendJsonl, readJson, readJsonl } from './lib/jsonl.mjs';
import { agentRoot, isMain, runId as makeRunId } from './lib/paths.mjs';
import { checkHashes, composeWhenToUse } from './lib/rubric-build.mjs';
import { openPlan } from './plan.mjs';
import { computeDrift, latestPullId, loadConfig, loadPull } from './pull.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/status.mjs [--check] [--run <id>] [--json] [--unpause --confirm] [--restore-rulebook --confirm]';

export const STAGES = Object.freeze(['To review', 'Waiting for evidence', 'Second opinion', 'Lesson proposed', 'Regression case', 'Decided', 'Closed']);
export const LESSON_STATUSES = Object.freeze(['Proposed', 'Approved', 'Rejected', 'Live', 'Rolled back']);
const NOTE_WHY = new Set(['Rule unclear', 'Rule should change', 'No tag fits', 'Other']); // the "Needs your note" view
const NOT_RUN_DIRS = new Set(['pull', 'judgments', 'state']);

class UsageError extends Error {}

// ---- small readers ------------------------------------------------------------------------------------------------

const safeJson = (path) => {
  try {
    return readJson(path);
  } catch {
    return undefined;
  }
};

/** runs/PAUSED as { present, ...fields }; a file that is not JSON (a person created it by hand) is present with its first characters. */
export function pausedFile(root = agentRoot()) {
  const file = controlPaths(root).paused;
  if (!existsSync(file)) return { present: false };
  const parsed = safeJson(file);
  if (parsed && typeof parsed === 'object') return { present: true, ...parsed };
  let raw = '';
  try {
    raw = readFileSync(file, 'utf8').slice(0, 200);
  } catch {
    raw = '';
  }
  return { present: true, unreadable: true, raw };
}

/** rubric.json against rubric.lock: { present, version, hash, ok, mismatches: [text] }. */
export function lockState(root = agentRoot()) {
  const rubricPath = join(root, 'rubric', 'rubric.json');
  const lockPath = join(root, 'rubric', 'rubric.lock');
  if (!existsSync(rubricPath)) return { present: false, version: null, hash: null, ok: false, mismatches: [`${rubricPath} does not exist`] };
  const rubric = safeJson(rubricPath);
  if (!rubric) return { present: true, version: null, hash: null, ok: false, mismatches: ['rubric.json is not valid JSON'] };
  const mismatches = [];
  const hashes = checkHashes(rubric);
  if (!hashes.ok) mismatches.push(`rubric.json: stored hashes do not match its content (${hashes.mismatches.length}, first: ${hashes.mismatches[0].kind} ${hashes.mismatches[0].where})`);
  const lock = existsSync(lockPath) ? safeJson(lockPath) : null;
  if (!lock) mismatches.push(existsSync(lockPath) ? 'rubric.lock is not valid JSON' : 'rubric.lock is missing');
  else {
    if (lock.rubric_version !== rubric.rubric_version) mismatches.push(`rubric.lock says version ${lock.rubric_version}, rubric.json is ${rubric.rubric_version}`);
    if (lock.rubric_hash !== rubric.rubric_hash) mismatches.push(`rubric.lock says ${lock.rubric_hash}, rubric.json is ${rubric.rubric_hash}`);
    if (lock.scope_hash !== rubric.scope_hash) mismatches.push(`rubric.lock scope_hash ${lock.scope_hash} differs from rubric.json ${rubric.scope_hash}`);
    if (lock.file_sha256 && lock.file_sha256 !== fileSha256(rubricPath)) mismatches.push('rubric.json was changed after it was locked (file_sha256 differs)');
  }
  return {
    present: true, version: rubric.rubric_version, hash: rubric.rubric_hash, scope_hash: rubric.scope_hash, tag_count: rubric.tag_count, judged_count: rubric.judged_count,
    locked_at: lock?.locked_at ?? null, ok: mismatches.length === 0, mismatches,
  };
}

/**
 * The Rulebook "Rule version" of a tag in a rubric: the version of the last changelog entry that names the tag, else the version the
 * rubric started with (the Rulebook rows are seeded with it), else the rubric's own version.
 */
export function tagRuleVersion(rubric, tagName) {
  const log = Array.isArray(rubric.changelog) ? rubric.changelog : [];
  for (let i = log.length - 1; i >= 0; i--) if (log[i]?.tag === tagName && log[i].version) return log[i].version;
  return log[0]?.version ?? rubric.rubric_version;
}

// ---- the plan builder for the engineer-only restore -----------------------------------------------------------------------

/**
 * Open a plan whose Rulebook "When to use" writes put the live rubric's text back (status --restore-rulebook, promote --rollback and --abort).
 * `build(plan)` adds the ops. The plan carries ctx { restore: true, confirm: true }, the allowlist's own path for this: openPlan() records both in
 * the plan header (and only when restore is true), so check and apply judge the plan the same way, and the header never claims a gate that did not
 * run. This only ever happens inside a command the engineer confirmed with --confirm, and the plan only carries text the live rubric already has.
 * Returns { plan, ctx }.
 */
export function buildRestorePlan({ runId, root, config, pull, now }, build) {
  const ctx = { restore: true, confirm: true };
  const plan = openPlan({ runId, root, config, pull, now, ctx });
  build(plan);
  return { plan, ctx };
}

// ---- the facts --------------------------------------------------------------------------------------------------------

const ageText = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} days`;
};

function readNormJsonl(pull, name) {
  const file = join(pull.dir, 'norm', name);
  return existsSync(file) ? readJsonl(file).rows : null;
}

function runFolders(root) {
  const runs = controlPaths(root).runs;
  if (!existsSync(runs)) return [];
  return readdirSync(runs, { withFileTypes: true }).filter((d) => d.isDirectory() && !NOT_RUN_DIRS.has(d.name)).map((d) => d.name).sort();
}

function resumeCommand(meta, id) {
  if (meta.resume) return meta.resume;
  const parts = ['node agents/claim-tagger/scripts/judge.mjs', '--items', meta.items_source ?? 'claims'];
  if (meta.driver && meta.driver !== 'cli') parts.push('--driver', meta.driver);
  parts.push('--run-id', id, '--resume');
  return parts.join(' ');
}

/**
 * Everything status knows, as one object. Options: root, config, now (a function), pullId (default: the newest pull).
 * Reads only files. Missing things are null, never an error: a fresh checkout has no pull and no runs.
 */
export function inspect({ root = agentRoot(), config = loadConfig(root), now = () => new Date(), pullId } = {}) {
  const paths = controlPaths(root);
  const state = { generated_at: now().toISOString(), agent: config.agent ?? 'claim-tagger' };
  state.rubric = lockState(root);
  state.paused = { file: pausedFile(root), settings: null };
  state.promoting = existsSync(join(paths.runs, 'PROMOTING.json')) ? (safeJson(join(paths.runs, 'PROMOTING.json')) ?? { unreadable: true }) : null;
  state.applying = existsSync(paths.applying) ? (safeJson(paths.applying) ?? { unreadable: true }) : null;

  const id = pullId ?? latestPullId(root);
  state.pull = null;
  state.drift = { checked: false, count: 0, items: [] };
  state.queue = null;
  state.lessons = null;
  state.recent_runs = [];
  let pull = null;
  if (id) {
    try {
      pull = loadPull(root, id, { config });
    } catch (e) {
      state.pull = { id, error: e.message };
    }
  }
  if (pull) {
    const takenAt = Date.parse(pull.info.taken_at);
    state.pull = { id: pull.id, taken_at: pull.info.taken_at, age_ms: now().getTime() - takenAt, age: ageText(now().getTime() - takenAt), dbs: pull.info.dbs, warnings: pull.info.warnings ?? [] };
    const settingsFile = join(pull.dir, 'norm', 'settings.json');
    if (existsSync(settingsFile)) {
      const s = readJson(settingsFile);
      state.paused.settings = { paused: s.paused === true, paused_by: s.paused_by ?? [], reason: s.reason ?? null, weekly_cap: s.weekly_cap ?? null, rubric_in_force: s.rubric_in_force ?? null, last_run_summary: s.last_run_summary ?? null };
    }
    const rulebookFile = join(pull.dir, 'norm', 'rulebook.json');
    if (existsSync(rulebookFile) && state.rubric.present) {
      const rows = readJson(rulebookFile).rows ?? [];
      const result = computeDrift(root, rows);
      state.drift = { checked: result.checked, count: result.drift.length, items: result.drift };
    }
    const queue = readNormJsonl(pull, 'queue.jsonl');
    if (queue) {
      const byStage = Object.fromEntries(STAGES.map((s) => [s, 0]));
      let other = 0;
      for (const row of queue) {
        if (row.stage in byStage) byStage[row.stage] += 1;
        else other += 1;
      }
      const needsNote = queue.filter((r) => NOTE_WHY.has(r.why_wrong) && !String(r.your_reasoning ?? '').trim()).length;
      state.queue = { total: queue.length, by_stage: byStage, other_stage: other, needs_your_note: needsNote };
    }
    const lessons = readNormJsonl(pull, 'lessons.jsonl');
    if (lessons) {
      const byStatus = Object.fromEntries(LESSON_STATUSES.map((s) => [s, 0]));
      for (const l of lessons) if (l.status in byStatus) byStatus[l.status] += 1;
      state.lessons = { total: lessons.length, by_status: byStatus, list: lessons.map((l) => ({ id: l.lesson_id ?? null, key: l.lesson_key, tag: l.tag ?? null, status: l.status ?? null, rubric_version: l.rubric_version ?? null })) };
    }
    const runs = readNormJsonl(pull, 'runs.jsonl');
    if (runs) {
      state.recent_runs = [...runs].sort((a, b) => String(b.started ?? '').localeCompare(String(a.started ?? '')) || String(b.title).localeCompare(String(a.title))).slice(0, 3)
        .map((r) => ({ title: r.title, kind: r.kind ?? null, verdict: r.verdict ?? null, started: r.started ?? null, cost_usd: r.cost_usd ?? null }));
    }
  }

  // the run folders: unfinished judge runs, cost, and local cards when the pull has no Runs rows
  const unfinished = [];
  let cost = 0;
  let counted = 0;
  const localCards = [];
  for (const name of runFolders(root)) {
    const dir = join(paths.runs, name);
    const meta = safeJson(join(dir, 'run.json'));
    if (meta && typeof meta === 'object') {
      if (typeof meta.cost_usd === 'number') {
        cost += meta.cost_usd;
        counted += 1;
      }
      if (meta.kind === 'judge' && meta.status !== 'done') unfinished.push({ run_id: name, kind: 'judge', status: meta.status ?? 'unknown', resume: resumeCommand(meta, name) });
    }
    const card = safeJson(join(dir, 'card.json'));
    if (card && card.verdict) localCards.push({ title: card.card_id ?? name, kind: card.kind ?? null, verdict: card.verdict, started: meta?.started ?? null, cost_usd: meta?.cost_usd ?? null });
  }
  if (state.promoting?.run_id) {
    unfinished.push({ run_id: state.promoting.run_id, kind: 'promote', status: 'waiting for apply and finalize', resume: `node agents/claim-tagger/scripts/promote.mjs --finalize ${state.promoting.run_id}  (or --abort ${state.promoting.run_id})` });
  }
  state.unfinished = unfinished;
  state.cost = { total_usd: Math.round(cost * 1e6) / 1e6, runs_counted: counted };
  if (!state.recent_runs.length) state.recent_runs = localCards.slice(-3).reverse();
  return state;
}

// ---- preflight --------------------------------------------------------------------------------------------------------

const trustText = (p) => {
  if (!p.present) return null;
  if (p.unreadable) return `runs/PAUSED exists (${p.raw ? `"${p.raw.replace(/\s+/g, ' ').trim()}"` : 'empty'})`;
  const first = p.changes?.[0];
  const detail = first ? `${first.db ?? 'a row'} "${first.key ?? first.page_id}" ${first.field}: before ${JSON.stringify(first.before)}, after ${JSON.stringify(first.after)}` : `${p.field ?? 'a field'} changed on page ${p.page_id ?? '?'}`;
  return `runs/PAUSED exists: ${detail}${p.run_id ? ` during run ${p.run_id}` : ''}${p.detected_at ? ` at ${p.detected_at}` : ''}`;
};

/**
 * The exit code and the one-line reason for the state: 3 paused, 4 lock mismatch or drift, 2 a promote in flight, else 0. `ignore` lists checks to
 * leave out ('paused', 'lock', 'drift', 'promoting'). The order is the order of severity: a paused agent stops everything first.
 */
export function checkVerdict(state, { ignore = [] } = {}) {
  const skip = new Set(ignore);
  if (!skip.has('paused')) {
    if (state.paused.file.present) return { code: EXIT.PAUSED, label: 'PAUSED', text: `${trustText(state.paused.file)}; a person has to look and then run status.mjs --unpause --confirm` };
    if (state.paused.settings?.paused) return { code: EXIT.PAUSED, label: 'PAUSED', text: `Paused is ticked in Agent settings${state.paused.settings.reason ? ` (${state.paused.settings.reason})` : ''}; a person has to untick it` };
  }
  if (!skip.has('lock') && !state.rubric.ok) return { code: EXIT.DRIFT, label: 'DRIFT', text: `the rubric does not match its lock: ${state.rubric.mismatches[0]}` };
  // While a promote is in flight Notion carries the candidate's text for the promoted tag until finalize puts the file right: that difference is expected
  const expected = state.promoting?.tag ? state.drift.items.filter((d) => d.tag === state.promoting.tag) : [];
  const unexpected = state.drift.items.filter((d) => !expected.includes(d));
  if (!skip.has('drift') && unexpected.length > 0) {
    const d = unexpected[0];
    return { code: EXIT.DRIFT, label: 'DRIFT', text: `the Rulebook in Notion differs from rubric.json in ${unexpected.length} place(s), first: ${d.tag ?? '(rubric)'} ${d.part}; status.mjs --restore-rulebook --confirm writes the file's text back` };
  }
  if (!skip.has('promoting') && state.promoting) return { code: EXIT.INVALID, label: 'PROMOTING', text: `run ${state.promoting.run_id ?? '(unreadable PROMOTING.json)'} is waiting for apply.mjs and promote.mjs --finalize (or --abort)` };
  return { code: EXIT.OK, label: 'ok', text: '' };
}

/** What a script runs before it does anything: checkVerdict for the current files. Returns { code, message, state }. */
export function preflight({ root = agentRoot(), config, now, pullId, ignore = [] } = {}) {
  const state = inspect({ root, config: config ?? loadConfig(root), now, pullId });
  const verdict = checkVerdict(state, { ignore });
  return { code: verdict.code, message: verdict.code === EXIT.OK ? '' : `${verdict.label}: ${verdict.text}`, state };
}

// ---- the report -------------------------------------------------------------------------------------------------------

export function renderReport(state) {
  const lines = [];
  const rb = state.rubric;
  lines.push(`claim-tagger status${state.pull?.id ? ` (pull ${state.pull.id}, ${state.pull.age} old)` : ' (no pull yet: Notion state is unknown)'}`);
  lines.push(`Rubric: ${rb.version ?? 'unknown'} ${rb.hash ?? ''} (${rb.tag_count ?? '?'} tags, ${rb.judged_count ?? '?'} judged); lock ${rb.ok ? 'ok' : `MISMATCH: ${rb.mismatches.join('; ')}`}`);
  if (!state.pull || state.pull.error) lines.push(`Rulebook drift: not checked (${state.pull?.error ?? 'no pull'})`);
  else if (!state.drift.checked) lines.push('Rulebook drift: not checked (the pull has no Rulebook or there is no rubric.json)');
  else if (state.drift.count === 0) lines.push('Rulebook drift: none');
  else {
    lines.push(`Rulebook drift: ${state.drift.count} difference(s)`);
    for (const d of state.drift.items.slice(0, 8)) lines.push(`  - ${d.tag ?? '(rubric)'} ${d.part}`);
    if (state.drift.count > 8) lines.push(`  - ... and ${state.drift.count - 8} more`);
  }
  const p = state.paused;
  if (p.file.present) lines.push(`PAUSED: ${trustText(p.file)}`);
  if (p.file.present && p.file.changes?.length > 1) for (const c of p.file.changes.slice(0, 8)) lines.push(`  - ${c.db ?? ''} "${c.key ?? c.page_id}" ${c.field}: before ${JSON.stringify(c.before)}, after ${JSON.stringify(c.after)}`);
  if (p.settings === null) lines.push(`Paused in Agent settings: ${state.pull?.id ? 'not in the pull' : 'unknown'}`);
  else lines.push(`Paused in Agent settings: ${p.settings.paused ? `YES${p.settings.reason ? ` (${p.settings.reason})` : ''}` : 'no'}${p.settings.rubric_in_force ? `; Rubric in force there: ${p.settings.rubric_in_force}` : ''}`);
  if (!p.file.present && !p.settings?.paused) lines.push('Paused: no');
  if (state.promoting) lines.push(`Promote in flight: run ${state.promoting.run_id} (lesson ${state.promoting.lesson_id ?? state.promoting.lesson ?? '?'}, version ${state.promoting.version ?? '?'})`);
  if (state.applying) lines.push(`Apply armed: run ${state.applying.run_id ?? '(unreadable)'}`);
  if (state.queue) {
    const q = state.queue;
    lines.push(`Queue: ${q.total} rows; ${STAGES.map((s) => `${s} ${q.by_stage[s]}`).join(', ')}${q.other_stage ? `, other ${q.other_stage}` : ''}; Needs your note ${q.needs_your_note}`);
  } else lines.push('Queue: not in the pull');
  if (state.lessons) lines.push(`Lessons: ${state.lessons.total}; ${LESSON_STATUSES.map((s) => `${s} ${state.lessons.by_status[s]}`).join(', ')}`);
  else lines.push('Lessons: not in the pull');
  if (state.recent_runs.length) {
    lines.push('Last run cards:');
    for (const r of state.recent_runs) lines.push(`  - ${r.title} | ${r.verdict ?? 'n/a'} | ${typeof r.cost_usd === 'number' ? `$${r.cost_usd.toFixed(2)}` : 'cost unknown'}`);
  } else lines.push('Last run cards: none');
  if (state.unfinished.length) {
    lines.push('Unfinished:');
    for (const u of state.unfinished) lines.push(`  - ${u.kind} ${u.run_id} (${u.status}): ${u.resume}`);
  } else lines.push('Unfinished: nothing');
  lines.push(`Cost so far: $${state.cost.total_usd.toFixed(4)} over ${state.cost.runs_counted} recorded run(s)`);
  return lines.join('\n');
}

function checkLine(state) {
  const v = checkVerdict(state);
  const notes = [];
  if (!state.pull || state.pull.error) notes.push('no pull: Paused in Notion and drift not checked');
  if (v.code === EXIT.OK) {
    return `status: ok - rubric ${state.rubric.version} (lock ok), not paused, no promote in flight${state.pull?.id ? `, pull ${state.pull.id} is ${state.pull.age} old` : ''}${notes.length ? ` (${notes.join('; ')})` : ''}`;
  }
  return `status: ${v.label} - ${v.text}`;
}

// ---- --run <id> ---------------------------------------------------------------------------------------------------------

/** The progress of one run folder as an object (run.json, judge ledger, judgment files, plan, apply, verify, card). */
export function runProgress(root, id) {
  const paths = controlPaths(root);
  const dir = join(paths.runs, id);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
  const out = { run_id: id, dir };
  const meta = safeJson(join(dir, 'run.json'));
  if (meta) {
    out.run = meta;
    if (meta.kind === 'judge' && meta.config16) {
      const cfgDir = join(paths.runs, 'judgments', meta.config16);
      const ledger = existsSync(join(cfgDir, 'ledger.jsonl')) ? readJsonl(join(cfgDir, 'ledger.jsonl')).rows.filter((r) => r.invocation === id) : [];
      const tally = {};
      for (const r of ledger) tally[r.status] = (tally[r.status] ?? 0) + 1;
      let valid = 0;
      for (let n = 1; n <= (meta.runs ?? 0); n++) {
        const folder = join(cfgDir, `run-${n}`);
        if (!existsSync(folder)) continue;
        const files = new Set(readdirSync(folder));
        for (const item of meta.items ?? []) {
          const name = `${item.id}.${String(item.text_hash).replace(/^sha256:/, '').slice(0, 8)}.json`;
          if (files.has(name) && safeJson(join(folder, name))?.status === 'ok') valid += 1;
        }
      }
      const cells = (meta.items?.length ?? 0) * (meta.runs ?? 0);
      out.judge = { cells, cells_done: valid, ledger: tally, counts: meta.counts ?? null, status: meta.status, cost_usd: meta.cost_usd ?? null, resume: meta.status === 'done' ? null : resumeCommand(meta, id) };
    }
  }
  const plan = existsSync(join(dir, 'plan.jsonl')) ? readJsonl(join(dir, 'plan.jsonl')).rows : null;
  if (plan) out.plan = { ops: plan.length - 1, counts: plan[0]?.counts ?? null, source_pull: plan[0]?.source_pull ?? null };
  const check = safeJson(join(dir, 'check.json'));
  if (check) out.check = { to_apply: check.to_apply, creates: check.creates, updates: check.updates, skipped: check.skipped?.length ?? 0 };
  if (existsSync(join(dir, 'applied.jsonl'))) {
    const tally = {};
    for (const r of readJsonl(join(dir, 'applied.jsonl')).rows) tally[r.status] = (tally[r.status] ?? 0) + 1;
    out.applied = tally;
  }
  const verify = safeJson(join(dir, 'verify.json'));
  if (verify) out.verify = { result: verify.result, landed: verify.landed, missing: verify.missing?.length ?? 0, editor_changes: verify.editor_changes?.length ?? 0 };
  const card = safeJson(join(dir, 'card.json'));
  if (card) out.card = { verdict: card.verdict, kind: card.kind, lesson: card.lesson ?? null, small_sample: card.small_sample };
  return out;
}

function renderRun(p) {
  const lines = [`run ${p.run_id}:`];
  if (p.run) lines.push(`  ${p.run.kind ?? 'run'}${p.run.status ? `, status ${p.run.status}` : ''}${p.run.rubric_version ? `, rubric ${p.run.rubric_version}` : ''}${p.run.started ? `, started ${p.run.started}` : ''}`);
  if (p.judge) {
    const j = p.judge;
    lines.push(`  judgments: ${j.cells_done} of ${j.cells} cells done; ledger ${JSON.stringify(j.ledger)}; counts ${JSON.stringify(j.counts)}; cost ${typeof j.cost_usd === 'number' ? `$${j.cost_usd.toFixed(4)}` : 'unknown'}`);
    if (j.resume) lines.push(`  resume: ${j.resume}`);
  }
  if (p.plan) lines.push(`  plan: ${p.plan.ops} op(s) from pull ${p.plan.source_pull ?? '?'}${p.check ? `; checked: ${p.check.to_apply} to apply (${p.check.creates} create, ${p.check.updates} update), ${p.check.skipped} skipped` : '; not checked yet'}`);
  if (p.applied) lines.push(`  applied: ${JSON.stringify(p.applied)}`);
  if (p.verify) lines.push(`  verify: ${p.verify.result} (${p.verify.landed} landed, ${p.verify.missing} missing, ${p.verify.editor_changes} editor field change(s))`);
  if (p.card) lines.push(`  card: ${p.card.verdict}${p.card.lesson ? ` for ${p.card.lesson}` : ''}${p.card.small_sample ? ' (small sample)' : ''}`);
  if (lines.length === 1) lines.push('  (nothing recorded yet)');
  return lines.join('\n');
}

// ---- --unpause and --restore-rulebook ---------------------------------------------------------------------------------------

function whoAmI(env) {
  if (env.user) return env.user;
  try {
    return userInfo().username;
  } catch {
    return process.env.USERNAME ?? process.env.USER ?? 'unknown';
  }
}

function unpause({ root, now, env, io }) {
  const paths = controlPaths(root);
  const current = pausedFile(root);
  if (!current.present) {
    io.out('status: the PAUSED file does not exist, nothing to clear');
    return EXIT.OK;
  }
  const { present, ...previous } = current;
  appendJsonl(join(paths.runs, 'state', 'unpaused.jsonl'), { at: now().toISOString(), by: whoAmI(env), previous });
  unlinkSync(paths.paused);
  io.out(`status: runs/PAUSED removed (recorded in runs/state/unpaused.jsonl); if Paused is ticked in Agent settings, only a person can untick it there`);
  return EXIT.OK;
}

/** The Rulebook rows to restore: tags whose When to use differs from the rubric, and the drift in other columns that only a person can fix. */
export function restorableDrift(drift) {
  const rulePart = (part) => part === 'preamble' || part === 'note' || /^rule \d+$/.test(part);
  const tags = new Map();
  const manual = [];
  for (const d of drift) {
    if (d.tag && rulePart(d.part)) {
      if (!tags.has(d.tag)) tags.set(d.tag, []);
      tags.get(d.tag).push(d.part);
    } else manual.push(d);
  }
  return { tags, manual };
}

function restoreRulebook({ root, config, now, io, runId }) {
  const id = latestPullId(root);
  if (!id) {
    io.err('status: there is no pull yet; run pull.mjs --dbs rulebook first');
    return EXIT.INVALID;
  }
  const pull = loadPull(root, id, { config });
  if (!pull.covers('rulebook')) {
    io.err(`status: pull ${id} does not include the Rulebook; run pull.mjs --dbs rulebook first`);
    return EXIT.INVALID;
  }
  const rubric = readJson(join(root, 'rubric', 'rubric.json'));
  const lock = lockState(root);
  if (!lock.ok) {
    io.err(`status: refusing to restore from a rubric that does not match its lock (${lock.mismatches[0]})`);
    return EXIT.DRIFT;
  }
  const rows = readJson(join(pull.dir, 'norm', 'rulebook.json')).rows ?? [];
  const { drift } = computeDrift(root, rows);
  const { tags, manual } = restorableDrift(drift);
  for (const d of manual) io.err(`status: cannot be restored by script (edit it in Notion): ${d.tag ?? '(rubric)'} ${d.part}`);
  if (!tags.size) {
    io.out(manual.length ? `status: nothing a script may restore; ${manual.length} difference(s) need a person` : 'status: the Rulebook matches rubric.json, nothing to restore');
    return manual.length ? EXIT.INVALID : EXIT.OK;
  }
  const rowByName = new Map(rows.map((r) => [r.name, r]));
  const { plan } = buildRestorePlan({ runId, root, config, pull, now }, (p) => {
    for (const [name] of [...tags].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const tag = rubric.tags.find((t) => t.name === name);
      const row = rowByName.get(name);
      if (!tag || !row) continue;
      p.update('rulebook', name, row.page_id, {
        'When to use': composeWhenToUse(tag.when_to_use), 'Rule version': tagRuleVersion(rubric, name), 'Tag hash': tag.tag_hash,
      }, { expect: { 'When to use': row.when_to_use }, note: `restore: ${tags.get(name).join(', ')} differed from rubric.json ${rubric.rubric_version}` });
    }
  });
  const written = plan.write();
  io.out(`status: restore plan ${runId} written: ${plan.ops.length} Rulebook row(s) (${[...tags.keys()].sort().join(', ')}) back to rubric ${rubric.rubric_version}; next: plan.mjs check --run ${runId}, then apply.mjs --run ${runId}`);
  io.out(`status: plan file ${written.path}`);
  return EXIT.OK;
}

// ---- command line -----------------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Run the script; returns the exit code. env (tests): { root, now, user, runId }. */
export function main(argv, io = defaultIo, env = {}) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        check: { type: 'boolean' }, run: { type: 'string' }, json: { type: 'boolean' }, unpause: { type: 'boolean' }, 'restore-rulebook': { type: 'boolean' },
        confirm: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (e) {
    io.err(`status: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  try {
    const root = env.root ?? agentRoot();
    const now = env.now ?? (() => new Date());
    const modes = [args.check, args.run !== undefined, args.unpause, args['restore-rulebook']].filter(Boolean).length;
    if (modes > 1) throw new UsageError('give at most one of --check, --run, --unpause and --restore-rulebook');
    if (args.confirm && !args.unpause && !args['restore-rulebook']) throw new UsageError('--confirm goes with --unpause or --restore-rulebook');

    if (args.unpause || args['restore-rulebook']) {
      const what = args.unpause ? '--unpause' : '--restore-rulebook';
      if (!args.confirm) {
        io.err(`status: ${what} changes things, so it needs --confirm (only a person decides this)\n${USAGE}`);
        return EXIT.INVALID;
      }
      if (args.unpause) return unpause({ root, now, env, io });
      const config = env.config ?? loadConfig(root);
      return restoreRulebook({ root, config, now, io, runId: env.runId ?? makeRunId('restore-rulebook', now()) });
    }

    if (args.run !== undefined) {
      const progress = runProgress(root, args.run);
      if (!progress) {
        io.err(`status: there is no run folder runs/${args.run}`);
        return EXIT.INVALID;
      }
      io.out(args.json ? JSON.stringify(progress, null, 2) : renderRun(progress));
      return EXIT.OK;
    }

    const state = inspect({ root, config: env.config, now, pullId: env.pullId });
    const verdict = checkVerdict(state);
    if (args.json) {
      io.out(JSON.stringify({ ...state, check: { code: verdict.code, label: verdict.label, text: verdict.text } }, null, 2));
      return args.check ? verdict.code : EXIT.OK;
    }
    if (args.check) {
      io.out(checkLine(state));
      if (verdict.code !== EXIT.OK) io.err(`status: ${describeExit(verdict.code)}`);
      return verdict.code;
    }
    io.out(renderReport(state));
    return EXIT.OK;
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`status: ${e.message}\n${USAGE}`);
      return EXIT.INVALID;
    }
    if (e.code === 'ALLOWLIST' || e.name === 'PlanError') {
      io.err(`status: ${e.message}`);
      return EXIT.INVALID;
    }
    io.err(`status: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
