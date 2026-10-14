#!/usr/bin/env node
// promote: put an Approved lesson through the gate and, only on PASS, into the rulebook. Two phases, because the rule text must change in
// Notion (an applied plan, verified) before it changes on disk.
//
//   node agents/claim-tagger/scripts/promote.mjs --lesson <lesson key or LS-n> [--smoke] [--resume] [--run-id <id>] [--driver cli|fake] [--model <id>] [--mark-rolled-back]
//   node agents/claim-tagger/scripts/promote.mjs --finalize <run-id>
//   node agents/claim-tagger/scripts/promote.mjs --abort <run-id>
//   node agents/claim-tagger/scripts/promote.mjs --rollback <lesson key or LS-n> --confirm
//
// --lesson (phase 1; exit 0 PASS, 10 HOLD, 11 FAIL):
//   1. Preconditions (exit 2): the lesson is in the pull with Status Approved; its Current text still equals the live rubric's composed text for the
//      target (otherwise it is stale); the effective text (Editor wording if filled, else Proposed text) is at most 1,900 characters; the Kind is not
//      "New or promoted tag"; no runs/PROMOTING.json belongs to another run. The pull must be fresh enough to show no Paused, no drift (exit 3, 4).
//      Then runs/PROMOTE.lock ({ run_id, lesson, started_at }) is created exclusively, before anything of this run is written or judged, and removed
//      when promote() ends on every path (PASS, HOLD, FAIL, an error, exit 75; a smoke run takes it too). A second promote that finds it held by
//      another run exits 2 with "run <id> holds the promote lock since <time>; resume it with --resume --run-id <id>, or if it is dead remove
//      runs/PROMOTE.lock". Only a killed process leaves it behind; --resume --run-id <same id> takes over its own lock, --abort <id> removes it.
//   2. The candidate: rubric-build.applyLesson on the live rubric (the rule named in the Rule column, "<Tag> rule <n>", or the tag's whole When to use
//      for "<Tag> when to use"), the next free version, a changelog entry naming the lesson; runs/<run-id>/candidate/rubric.json with its hashes checked.
//   3. The items: the claims behind every gate case (active, or contested for THIS lesson) plus the active canaries, runs/<run-id>/items.jsonl. judge.mjs
//      judges them twice with the same model: the live rubric (normally a cache hit) and the candidate, config.judge.runs runs each (1 with --smoke).
//   4. eval.mjs decides; the card goes to runs/<run-id>/card.json and card.md.
//      Reconfirmation (config.gate.reconfirm_runs, 5; 0 switches it off; not for --smoke): a case that flipped between the rubrics, for the worse (passed
//      under the baseline, fails under the candidate: a newly failing active case or a broken item of the target tag) or for the better (a fixed item of the
//      target tag, a lesson case that now passes), on a tag both rubrics judge, is often a borderline claim that goes 2:1 one way under one rubric and 2:1
//      the other way under the other. Harm and improvement are held to the same standard, so both are judged again (at most config.gate.reconfirm_max, 16;
//      canaries are not among them): their claims go to runs/<run-id>/reconfirm-items.jsonl, judge.mjs runs both rubrics on them up to config.judge.runs +
//      reconfirm_runs runs (it skips the runs that exist), and eval.mjs decides again with every run it finds. That second verdict is the one that counts
//      (the run log says so); the card lists each reconfirmed case with its flip (broken or fixed), what each rubric decided over how many runs, and
//      whether the flip stayed ("confirmed") or went away ("noise").
//   5. PASS: a plan with the Rulebook row (When to use, Rule version, Tag hash, Changed by) under ctx { promote, gate: "PASS" }, the lesson Live with its
//      Gate result, a Runs row "Gate <version> · <lesson>" carrying the card (its Per-tag summary starts with the candidate's rubric version and
//      hash: a candidate that was never promoted gives its version label to the next one), In regression suite on the supporting rows, and the Agent
//      settings "Rubric in force". runs/PROMOTING.json is written, after it has been read again right before the plan: if another run has written it
//      meanwhile, this run exits 2 without a plan. Then: plan.mjs check, apply.mjs, and --finalize.
//      HOLD or FAIL: a plan with only the Runs row and the lesson's Gate result (and Status "Rolled back" on a FAIL of a demo lesson or with
//      --mark-rolled-back; otherwise the lesson stays Approved). The Rulebook is untouched and the candidate folder is marked rolled_back in run.json.
//      --smoke (one run): the same card, never a Rulebook change, never PROMOTING, never finalized. Its Runs row (Kind Smoke) has Verdict n/a: only
//      a Gate row carries PASS, HOLD or FAIL.
// --finalize <run-id> (phase 2): needs verify.json clean (the plan was applied and read back), the Rulebook row and the lesson in Notion as the plan wrote
//   them; copies the candidate to rubric/rubric.json, rubric/history/<version>.json, rubric.lock and CHANGELOG.md, activates the lesson's contested cases
//   and re-stamps their hashes (cases-sync), removes PROMOTING.json. Committing is the skill's job.
// --abort <run-id>: removes PROMOTING.json; if the plan had been applied and Notion's Rulebook text differs from the live rubric, writes a restore plan.
//   A run that was killed while it judged (it holds runs/PROMOTE.lock, PROMOTING.json was never written) is aborted too: the lock goes, the run is marked
//   aborted, nothing in Notion needs restoring.
// --rollback <lesson> --confirm: THE ONE PATH THAT IS NOT A GATE. Only for the most recent Live lesson: restores the previous rubric from
//   rubric/history/ byte for byte (its rubric_hash must equal the history file's), updates lock and changelog, and writes a restore plan (Rulebook text,
//   Rule version and Tag hash back, Changed by cleared, the lesson Rolled back, a Runs row, Rubric in force). The plan's ctx is the engineer-only
//   restore form (see status.mjs buildRestorePlan). Without --confirm nothing happens.
//
// Exit codes: 0 PASS (or done), 1 error, 2 invalid or incomplete (preconditions, no complete judgments), 3 paused, 4 drift / model mismatch,
// 10 HOLD, 11 FAIL, 75 the usage window ran out (promote.mjs --lesson ... --resume --run-id <id> continues).

import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { controlPaths } from './allowlist.mjs';
import { InputError, evaluate, selectCanaries, selectCases, writeCard } from './eval.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { fileSha256 } from './lib/hash.mjs';
import { readJson, readJsonl, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { normId } from './lib/notion-values.mjs';
import { agentRoot, codeFile, ensureDir, isMain, runId as makeRunId, safeName } from './lib/paths.mjs';
import { applyLesson, checkHashes, composeWhenToUse, nextVersion, normaliseText } from './lib/rubric-build.mjs';
import { validate } from './lib/validate.mjs';
import { lessonIndex, planRegression, syncCases, writeCases } from './cases-sync.mjs';
import { parseRuleLabel, stripRuleNumber, targetCurrentText } from './distill.mjs';
import { main as judgeMain } from './judge.mjs';
import { openPlan } from './plan.mjs';
import { findSchema, latestPullId, loadConfig, loadPull } from './pull.mjs';
import { buildRestorePlan, lockState, preflight, tagRuleVersion } from './status.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/promote.mjs --lesson <lesson key or LS-n> [--smoke] [--resume] [--run-id <id>] [--driver cli|fake] [--model <id>] [--mark-rolled-back] [--pull <id>] | --finalize <run-id> | --abort <run-id> | --rollback <lesson key or LS-n> --confirm';

const MAX_TEXT = 1900;
const DEMO_TITLE = /deliberately bad/i;

class UsageError extends Error {}

/** An error that ends the command with an exit code and a plain-words message. */
export class ExitError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const oneLine = (s) => normaliseText(String(s ?? '')).replace(/\s*\n\s*/g, ' ').trim();
const clip = (s, n = 400) => {
  const t = oneLine(s);
  return t.length <= n ? t : `${t.slice(0, n - 3)}...`;
};
const pct = (x) => (typeof x === 'number' ? `${(x * 100).toFixed(1)}%` : 'n/a');
const pts = (x) => {
  if (typeof x !== 'number') return 'n/a';
  const s = (x * 100).toFixed(1);
  return s === '0.0' || s === '-0.0' ? '0.0' : x > 0 ? `+${s}` : s;
};
const round6 = (x) => Math.round(x * 1e6) / 1e6;

const locations = (root) => {
  const p = controlPaths(root);
  return {
    runs: p.runs, promoting: join(p.runs, 'PROMOTING.json'), promoteLock: join(p.runs, 'PROMOTE.lock'), rubric: join(root, 'rubric', 'rubric.json'), lock: join(root, 'rubric', 'rubric.lock'),
    history: join(root, 'rubric', 'history'), changelog: join(root, 'rubric', 'CHANGELOG.md'), cases: join(root, 'evals', 'cases.jsonl'), canaries: join(root, 'evals', 'canaries.jsonl'),
  };
};

const readPromoting = (root) => {
  const file = locations(root).promoting;
  if (!existsSync(file)) return null;
  try {
    return readJson(file);
  } catch {
    return { run_id: null, unreadable: true };
  }
};

// ---- the promote lock ----------------------------------------------------------------------------------------------------------------------
// runs/PROMOTING.json only exists from a PASS on, and a promote judges for minutes before that, so two promotes could both judge, both PASS and
// both write it. runs/PROMOTE.lock closes that gap: { run_id, lesson, started_at }, created exclusively once the lesson has been validated and
// before anything is judged or written, removed when promote() ends on every path (PASS, HOLD, FAIL, an error, exit 75). It is only left behind by a
// process that was killed. Then the run itself takes it over with --resume --run-id <id>; a person removes it, or promote.mjs --abort <id> does.

/** The lock as written, null without one, { run_id: null, unreadable: true } for a file that is not JSON. */
function readPromoteLock(loc) {
  if (!existsSync(loc.promoteLock)) return null;
  try {
    const held = readJson(loc.promoteLock);
    return held && typeof held === 'object' ? held : { run_id: null, unreadable: true };
  } catch {
    return { run_id: null, unreadable: true };
  }
}

/** Take the lock for a run, or throw ExitError(2) naming the run that holds it. The run that holds it may take it over (a resume after a kill). */
function takePromoteLock(loc, { runId, lesson, now }) {
  const body = `${JSON.stringify({ run_id: runId, lesson: lesson.lesson_key, started_at: now().toISOString() }, null, 2)}\n`;
  ensureDir(loc.runs);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(loc.promoteLock, body, { flag: 'wx' }); // exclusive: fails when the file exists, so two promotes cannot both get in
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const held = readPromoteLock(loc);
    if (held === null) continue; // it was removed between the two calls: try again
    if (held.run_id === runId) {
      writeTextAtomic(loc.promoteLock, body);
      return;
    }
    if (held.unreadable || typeof held.run_id !== 'string') throw new ExitError(EXIT.INVALID, 'runs/PROMOTE.lock exists but cannot be read; if no promote is running, remove it');
    throw new ExitError(EXIT.INVALID, `run ${held.run_id} holds the promote lock since ${held.started_at ?? 'an unknown time'}; resume it with --resume --run-id ${held.run_id}, or if it is dead remove runs/PROMOTE.lock (promote.mjs --abort ${held.run_id} does that too)`);
  }
  throw new ExitError(EXIT.ERROR, 'could not take runs/PROMOTE.lock');
}

/** Remove the lock if it is still this run's. A lock that names another run (a person removed ours and another promote took it) is left alone. */
function releasePromoteLock(loc, runId) {
  try {
    if (readPromoteLock(loc)?.run_id === runId) unlinkSync(loc.promoteLock);
  } catch {
    // a lock that cannot be removed must not hide what the promote itself ended with
  }
}

// ---- versions, the lesson, its text ---------------------------------------------------------------------------------------------------

/** The next version that is later than the live one and has no file in rubric/history/ (a rolled-back version keeps its file, so its number is never reused). */
export function candidateVersion(root, current, date) {
  let v = nextVersion(current, date);
  while (existsSync(join(locations(root).history, `${safeName(v)}.json`))) {
    const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(v);
    v = `${m[1]}.${Number(m[2]) + 1}`;
  }
  return v;
}

/** The lesson of a pull by its key (Lesson title) or its Lesson ID (LS-1, case-insensitive). */
export function resolveLesson(pull, ref) {
  const index = lessonIndex(pull);
  const wanted = String(ref ?? '').trim();
  const found = index.rows.find((l) => l.lesson_key === wanted) ?? index.rows.find((l) => String(l.lesson_id ?? '').toLowerCase() === wanted.toLowerCase());
  if (!found) {
    const known = index.rows.map((l) => `${l.lesson_id ?? '?'} "${l.lesson_key}" (${l.status})`).slice(0, 8).join('; ');
    throw new ExitError(EXIT.INVALID, `no lesson "${wanted}" in pull ${pull.id}${known ? ` (known: ${known})` : ' (the pull holds no lessons: pull rule_changes)'}`);
  }
  return found;
}

/** The text a lesson would put in the rubric: the Editor wording when it is filled, else the Proposed text. */
export const effectiveText = (lesson) => (String(lesson.editor_wording ?? '').trim() ? lesson.editor_wording : lesson.proposed_text);

/** Everything promote requires of a lesson before it spends a model call. Throws ExitError(2) with the first problem. */
export function checkLesson({ lesson, rubric }) {
  if (lesson.status !== 'Approved') throw new ExitError(EXIT.INVALID, `lesson "${lesson.lesson_key}" has Status ${lesson.status ?? 'empty'}, not Approved: the rule owner approves it in Notion first`);
  if (lesson.kind === 'New or promoted tag') throw new ExitError(EXIT.INVALID, `lesson "${lesson.lesson_key}" is a "New or promoted tag": promote changes the rules of existing tags only`);
  if (!lesson.tag || !rubric.tags.some((t) => t.name === lesson.tag)) throw new ExitError(EXIT.INVALID, `lesson "${lesson.lesson_key}": the tag "${lesson.tag ?? ''}" is not in the live rubric`);
  const target = parseRuleLabel(lesson.rule_label ?? '', lesson.tag);
  if (!target) throw new ExitError(EXIT.INVALID, `lesson "${lesson.lesson_key}": the Rule column ("${lesson.rule_label ?? ''}") must read "${lesson.tag} rule <n>" or "${lesson.tag} when to use"`);
  const current = targetCurrentText(rubric, lesson.tag, target);
  if (current === null) throw new ExitError(EXIT.INVALID, `lesson "${lesson.lesson_key}": the live rubric has no ${lesson.rule_label}`);
  if (normaliseText(lesson.current_text ?? '') !== normaliseText(current)) {
    throw new ExitError(EXIT.INVALID, `lesson "${lesson.lesson_key}" is stale: its Current text is not what the live rubric (${rubric.rubric_version}) says for ${lesson.rule_label} any more. Live: "${clip(current, 160)}". Lesson: "${clip(lesson.current_text, 160)}". Propose it again`);
  }
  // a rule is one line; the whole When to use keeps its lines (one per rule), which is how splitRules reads it back
  const text = target.part === 'rule' ? oneLine(effectiveText(lesson)) : normaliseText(effectiveText(lesson)).trim();
  if (!text) throw new ExitError(EXIT.INVALID, `lesson "${lesson.lesson_key}" has neither Editor wording nor Proposed text`);
  if (text.length > MAX_TEXT) throw new ExitError(EXIT.INVALID, `lesson "${lesson.lesson_key}": the effective text is ${text.length} characters; the limit is ${MAX_TEXT}`);
  return { target, text };
}

/** The candidate rubric for a lesson (a deep copy; hashes recomputed; the changelog names the lesson). */
export function buildCandidate({ rubric, lesson, target, text, version }) {
  const note = `${lesson.rule_label} replaced by lesson ${lesson.lesson_id ? `${lesson.lesson_id} ` : ''}"${lesson.lesson_key}"`;
  const base = { tag: lesson.tag, kind: lesson.kind ?? null, ...(lesson.lesson_id ? { lesson_id: lesson.lesson_id } : {}), note };
  const candidate = target.part === 'rule'
    ? applyLesson(rubric, { ...base, ruleN: target.rule_n, newText: stripRuleNumber(text) }, { version })
    : applyLesson(rubric, { ...base, newWhenToUse: text }, { version });
  candidate.changelog[candidate.changelog.length - 1].lesson_key = lesson.lesson_key;
  return candidate;
}

// ---- the card as Notion text --------------------------------------------------------------------------------------------------------------

export function perTagSummary(card) {
  const lines = card.per_tag.filter((t) => t.n > 0).map((t) => `${t.tag}: ${pct(t.acc_base)} -> ${pct(t.acc_cand)} (${pts(t.delta)} points), fixed ${t.fixed.length}, broken ${t.broken.length}, n ${t.n}, ${t.positives} positives${t.gated ? '' : ', not gated'}`);
  let text = lines.join('\n');
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT - 4)}...`;
  return text || 'no tag had labelled items';
}

/** The Runs row's Per-tag summary: a first line naming the candidate rubric by version and hash, then perTagSummary(card), all within the 1,900 characters of a Notion text. */
export function perTagSummaryWithHash(card, candidate) {
  const text = `Candidate rubric ${candidate.rubric_version} (${candidate.rubric_hash})\n${perTagSummary(card)}`;
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 4)}...`;
}

export function canariesText(card) {
  const c = card.canaries?.candidate;
  if (!c) return 'not evaluated';
  const failing = c.failing.length ? `; failing: ${c.failing.slice(0, 8).join(', ')}${c.failing.length > 8 ? ` and ${c.failing.length - 8} more` : ''}` : '';
  return `${c.passed} of ${c.active}${failing}`;
}

/** The full card as the page body of the Runs row (markdown the apply script turns into blocks). */
export function cardMarkdown(card, md, extra = {}) {
  const lines = [`## Verdict: ${card.verdict}${card.smoke ? ' (smoke: not a gate verdict)' : ''}${card.small_sample ? ' - small sample' : ''}`, '', ...md.trimEnd().split('\n').map((l) => `- ${l}`)];
  lines.push('', '## The five conditions');
  for (const c of card.conditions) lines.push(`${c.n}. ${c.status.toUpperCase()}: ${c.detail}`);
  const tags = card.per_tag.filter((t) => t.n > 0);
  if (tags.length) {
    lines.push('', '## Per tag (paired accuracy, candidate minus baseline)');
    for (const t of tags) lines.push(`- ${t.tag}: ${pct(t.acc_base)} -> ${pct(t.acc_cand)}, ${pts(t.delta)} points${t.ci ? ` (95% interval ${pts(t.ci[0])} to ${pts(t.ci[1])})` : ''}, fixed ${t.fixed.length}${t.fixed.length ? ` [${t.fixed.slice(0, 6).join(', ')}]` : ''}, broken ${t.broken.length}${t.broken.length ? ` [${t.broken.slice(0, 6).join(', ')}]` : ''}, n ${t.n}, ${t.positives} positives, ${t.gated ? 'gated' : 'not gated'}`);
  }
  if (card.reconfirmed?.length) {
    lines.push('', '## Reconfirmed with more runs (harm and improvement alike)');
    for (const r of card.reconfirmed) lines.push(`- ${r.case_id} (${r.tag}): ${r.flip ?? 'broken'} flip ${r.outcome === 'noise' ? 'was noise' : 'confirmed'}; baseline ${r.baseline.decision} over ${r.baseline.runs} runs, candidate ${r.candidate.decision} over ${r.candidate.runs} runs`);
  }
  if (card.not_run?.length) lines.push('', '## Not run', `- ${card.not_run.length} case(s) on source-reading tags: the MVP fetches no source text.`);
  if (card.noise) lines.push('', '## Noise', `- Self-flip rate over ${card.noise.cells} cell(s): baseline ${card.noise.baseline === null ? 'n/a' : pct(card.noise.baseline)}, candidate ${card.noise.candidate === null ? 'n/a' : pct(card.noise.candidate)}.`);
  lines.push('', '## Configurations', `- Baseline ${card.configs.baseline.config16}, rubric ${card.configs.baseline.rubric_version} (${card.configs.baseline.rubric_hash})`, `- Candidate ${card.configs.candidate.config16}, rubric ${card.configs.candidate.rubric_version} (${card.configs.candidate.rubric_hash})`);
  if (extra.cost !== undefined) lines.push(`- Cost: $${extra.cost.toFixed(4)}; model ${extra.model ?? 'unknown'}; ${card.stats.runs} run(s) per rubric`);
  if (card.rollback) lines.push('', '## Rollback', `- ${card.rollback.command}`);
  return lines.join('\n');
}

function uniqueRunTitle(base, pull) {
  const known = new Set(pull.covers('runs') && existsSync(join(pull.dir, 'norm', 'runs.jsonl')) ? readJsonl(join(pull.dir, 'norm', 'runs.jsonl')).rows.map((r) => r.title) : []);
  let title = base;
  let n = 2;
  while (known.has(title) || pull.idMap?.runs?.[title]) title = `${base} (${n++})`;
  return title;
}

// ---- running the judge ------------------------------------------------------------------------------------------------------------------

async function judgeSide({ side, runId, itemsFile, runs, args, root, deps, now, io, candidatePath, reconfirm = false }) {
  const id = reconfirm ? `${runId}-reconfirm-${side}` : `${runId}-${side}`;
  const label = reconfirm ? `reconfirm ${side}` : side;
  const runsDir = locations(root).runs;
  const argv = ['--items', itemsFile, '--runs', String(runs), '--run-id', id, '--parent', runId]; // --parent: status.mjs resumes a stopped side through this promote run
  if (side === 'candidate') argv.push('--rubric', candidatePath);
  if (args.driver) argv.push('--driver', args.driver);
  if (args.model) argv.push('--model', args.model);
  if (existsSync(join(runsDir, id, 'run.json'))) argv.push('--resume');
  const lines = [];
  const code = await judgeMain(argv, { out: (s) => lines.push(s), err: (s) => lines.push(s) }, {
    agentDir: root, runsDir, env: deps.processEnv ?? process.env, now, runClaude: deps.runClaude, fakeState: deps.fakeState, bin: deps.judgeBin, spawnImpl: deps.spawnImpl, cliVersion: deps.cliVersion,
  });
  for (const l of lines) io.out(`promote: ${label} judge: ${l}`);
  if (code !== EXIT.OK) {
    const resume = `node agents/claim-tagger/scripts/promote.mjs --lesson ${JSON.stringify(args.lesson)} --resume --run-id ${runId}${args.smoke ? ' --smoke' : ''}${args.driver ? ` --driver ${args.driver}` : ''}`;
    if (code === EXIT.USAGE_WINDOW) throw new ExitError(code, `the usage window ran out while judging the ${label}; the finished judgments are kept. Resume when it reopens: ${resume}`);
    if (code === EXIT.DRIFT) throw new ExitError(code, `the ${label} judge stopped: the rubric or the model did not match`);
    throw new ExitError(code === EXIT.INVALID ? EXIT.INVALID : EXIT.ERROR, `the ${label} judge failed (exit ${code}); run ${id} has the details`);
  }
  const meta = readJson(join(runsDir, id, 'run.json'));
  return { id, config16: meta.config16, cost: meta.cost_usd ?? 0, model: meta.model, meta };
}

// ---- reconfirming flipped cases ---------------------------------------------------------------------------------------------------------------

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** config.gate.reconfirm_runs (extra runs per rubric for a flipped case; 0 or absent: off) and config.gate.reconfirm_max (cases per run; 16 when absent). */
export function reconfirmSettings(config) {
  const g = config.gate ?? {};
  const runs = g.reconfirm_runs ?? 0;
  const max = g.reconfirm_max ?? 16;
  if (!Number.isInteger(runs) || runs < 0) throw new ExitError(EXIT.INVALID, 'config.gate.reconfirm_runs must be a whole number of at least 0 (0 switches the reconfirmation off)');
  if (!Number.isInteger(max) || max < 1) throw new ExitError(EXIT.INVALID, 'config.gate.reconfirm_max must be a whole number of at least 1');
  return { runs, max };
}

/**
 * Which flipped cases to judge again, read from the card of the first evaluation. Harm and improvement are held to the same standard, so both are judged
 * again: first the newly failing active cases and the broken items of the target tag, then the fixed items of the target tag and the lesson cases that
 * flipped to passing; each group in case-id order, a case listed once as { case_id, flip: 'broken' | 'fixed' }. Only a case on a tag in `judged` (judged by
 * both rubrics) can flip by chance: a tag nobody judges never changes its answer. At most `max` are taken, in that order. Canaries are not looked at.
 * Returns { picks, flipped, broken, fixed, notJudged, overCap } (flipped, broken and fixed count every flip found, picked or not).
 */
export function reconfirmCandidates(card, { target, judged, max }) {
  if (!card?.cases) return { picks: [], flipped: 0, broken: 0, fixed: 0, notJudged: [], overCap: 0 };
  const tagOf = new Map(card.cases.items.map((i) => [i.case_id, i.tag]));
  const targetRow = target ? card.per_tag.find((t) => t.tag === target) : null;
  const flips = [];
  const take = (ids, flip) => {
    for (const id of [...ids].sort(byCode)) if (!flips.some((f) => f.case_id === id)) flips.push({ case_id: id, flip });
  };
  take(card.cases.newly_failing, 'broken');
  take(targetRow?.broken ?? [], 'broken');
  take([...(targetRow?.fixed ?? []), ...(card.cases.lesson?.fixed ?? [])], 'fixed');
  const eligible = flips.filter((f) => judged.has(tagOf.get(f.case_id)));
  return {
    picks: eligible.slice(0, max),
    flipped: flips.length,
    broken: flips.filter((f) => f.flip === 'broken').length,
    fixed: flips.filter((f) => f.flip === 'fixed').length,
    notJudged: flips.filter((f) => !judged.has(tagOf.get(f.case_id))).map((f) => f.case_id),
    overCap: Math.max(0, eligible.length - max),
  };
}

/**
 * The reconfirmation (config.gate.reconfirm_runs). A case that passed under the baseline and fails under the candidate after the usual runs is often a
 * borderline claim that goes 2:1 one way under one rubric and 2:1 the other way under the other, whatever the changed rule says; so is a case that seems to
 * be fixed. Both kinds are judged again: their claims go to runs/<run-id>/reconfirm-items.jsonl, judge.mjs runs both rubrics on them up to `runs +
 * reconfirm_runs` runs (it skips the runs that exist), and `evaluateAgain(picks)` decides again, now with every run it finds. The second verdict is the one
 * that counts; the card lists each reconfirmed case. Returns null when no flipped case qualifies, else { result, costs, record } (record goes into run.json).
 */
async function reconfirmFlips({ first, base, cand, settings, lesson, judged, selected, runDir, runId, runs, args, root, deps, now, io, candidatePath, evaluateAgain }) {
  const pick = reconfirmCandidates(first.card, { target: lesson.tag, judged, max: settings.max });
  if (!pick.picks.length) return null;
  const ids = pick.picks.map((p) => p.case_id);
  const byId = new Map([...selected.gating, ...selected.lessonCases].map((c) => [c.case_id, c]));
  const items = new Map();
  for (const id of ids) {
    const c = byId.get(id);
    items.set(c.item, { id: c.item, claim: c.text, sources_count: null });
  }
  const itemsFile = join(runDir, 'reconfirm-items.jsonl');
  writeTextAtomic(itemsFile, `${[...items.values()].map((i) => JSON.stringify(i)).join('\n')}\n`);
  const total = runs + settings.runs;
  const notes = [];
  if (pick.overCap) notes.push(`${pick.overCap} more beyond gate.reconfirm_max (${settings.max}) count as they are`);
  if (pick.notJudged.length) notes.push(`${pick.notJudged.length} on tags the rubric does not judge count as they are`);
  io.out(`promote: first pass ${first.verdict}: ${pick.flipped} flipped case(s) (${pick.broken} broken, ${pick.fixed} fixed); judging ${ids.length} of them again (${ids.join(', ')}) with ${settings.runs} more run(s) per rubric, ${total} in all${notes.length ? `; ${notes.join('; ')}` : ''}`);
  const rcBase = await judgeSide({ side: 'baseline', reconfirm: true, runId, itemsFile, runs: total, args, root, deps, now, io, candidatePath });
  const rcCand = await judgeSide({ side: 'candidate', reconfirm: true, runId, itemsFile, runs: total, args, root, deps, now, io, candidatePath });
  if (rcBase.config16 !== base.config16 || rcCand.config16 !== cand.config16) {
    throw new ExitError(EXIT.DRIFT, `the reconfirmation ran under another judge configuration than the first pass (baseline ${base.config16} -> ${rcBase.config16}, candidate ${cand.config16} -> ${rcCand.config16}): the model or the CLI changed meanwhile; start a new promote run`);
  }
  const result = evaluateAgain(pick.picks);
  const outcomes = result.card.reconfirmed ?? [];
  const noise = outcomes.filter((o) => o.outcome === 'noise').length;
  const confirmed = outcomes.length - noise;
  io.out(`promote: reconfirmation: ${noise} flip(s) were noise, ${confirmed} confirmed; the verdict after reconfirmation (${result.verdict}) is the one that counts${result.verdict === first.verdict ? ' (the first pass said the same)' : `, not the first pass (${first.verdict})`}`);
  const costs = { baseline: rcBase.cost ?? 0, candidate: rcCand.cost ?? 0 };
  return {
    result,
    costs,
    record: {
      runs: settings.runs, max: settings.max, flipped: pick.flipped, broken: pick.broken, fixed: pick.fixed, cases: ids, not_judged: pick.notJudged, over_cap: pick.overCap,
      first_verdict: first.verdict, verdict: result.verdict, noise, confirmed, cost_usd: round6(costs.baseline + costs.candidate), items: 'reconfirm-items.jsonl',
      baseline_run: rcBase.id, candidate_run: rcCand.id,
    },
  };
}

// ---- phase 1 --------------------------------------------------------------------------------------------------------------------------------

function loadPullFor({ root, config, now, pullId, need, ignore = ['promoting'] }) {
  const id = pullId ?? latestPullId(root);
  if (!id) throw new ExitError(EXIT.INVALID, 'there is no pull yet: run pull.mjs --dbs rulebook,tag_decisions,rule_changes,runs,agent_settings first');
  const pf = preflight({ root, config, now, pullId: id, ignore });
  if (pf.code !== EXIT.OK) throw new ExitError(pf.code, pf.message);
  const pull = loadPull(root, id, { config });
  for (const db of need) if (!pull.covers(db)) throw new ExitError(EXIT.INVALID, `pull ${id} does not include ${db}: run pull.mjs --dbs ${need.join(',')} first`);
  return { pull, state: pf.state };
}

function findResumable(root, lessonKey) {
  const { runs } = locations(root);
  if (!existsSync(runs)) return null;
  const names = readdirSync(runs, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(runs, d.name, 'run.json'))).map((d) => d.name).sort().reverse();
  for (const name of names) {
    try {
      const meta = readJson(join(runs, name, 'run.json'));
      if (meta.kind === 'promote' && meta.lesson_key === lessonKey && ['judging', 'evaluating'].includes(meta.status)) return name;
    } catch {
      // not a readable record
    }
  }
  return null;
}

async function promote({ args, io, root, config, deps, now }) {
  const loc = locations(root);
  const { pull } = loadPullFor({ root, config, now, pullId: args.pull, need: ['rulebook', 'rule_changes', 'tag_decisions'] });
  const rubric = readJson(loc.rubric);
  const lesson = resolveLesson(pull, args.lesson);
  const { target, text } = checkLesson({ lesson, rubric });
  const reconfirmation = reconfirmSettings(config);
  const promoting = readPromoting(root);
  let runId = args['run-id'];
  if (args.resume && !runId) runId = findResumable(root, lesson.lesson_key);
  if (args.resume && !runId) throw new ExitError(EXIT.INVALID, `--resume found no unfinished promote run for "${lesson.lesson_key}"; pass --run-id`);
  runId ??= makeRunId('promote', now());
  if (promoting && promoting.run_id !== runId) throw new ExitError(EXIT.INVALID, `run ${promoting.run_id ?? '(unreadable PROMOTING.json)'} is still promoting; finish it (apply.mjs, then promote.mjs --finalize) or promote.mjs --abort it first`);
  const runDir = join(loc.runs, runId);
  const recordFile = join(runDir, 'run.json');
  if (existsSync(recordFile) && !args.resume) throw new ExitError(EXIT.INVALID, `run id ${runId} already exists; use --resume to continue it or pick another id`);
  const previous = existsSync(recordFile) ? readJson(recordFile) : null;
  if (previous && (previous.lesson_key !== lesson.lesson_key || previous.previous_hash !== rubric.rubric_hash)) {
    throw new ExitError(EXIT.INVALID, `run ${runId} was for another lesson or another live rubric; start a new promote run`);
  }

  // The lesson is valid and the run id is free: from here nothing else may promote. The lock is taken before the first file of this run is written and
  // released when this function ends, whatever happens (a smoke run judges too, so it takes it as well).
  takePromoteLock(loc, { runId, lesson, now });
  try {
    return await gate({ args, io, root, config, deps, now, loc, pull, rubric, lesson, target, text, reconfirmation, runId, runDir, recordFile, previous });
  } finally {
    releasePromoteLock(loc, runId);
  }
}

/** Everything promote does while it holds the lock: the candidate, the items, the two judge runs, the verdict, and the plan with PROMOTING.json. */
async function gate({ args, io, root, config, deps, now, loc, pull, rubric, lesson, target, text, reconfirmation, runId, runDir, recordFile, previous }) {
  ensureDir(runDir);
  const version = previous?.version ?? candidateVersion(root, rubric.rubric_version, now());
  const candidate = buildCandidate({ rubric, lesson, target, text, version });
  const problems = [...checkHashes(candidate).mismatches.map((m) => `hash ${m.kind} ${m.where}`), ...validate(readJson(codeFile(root, 'schemas', 'rubric.schema.json')), candidate).errors];
  if (problems.length) throw new Error(`internal error: the candidate rubric is not valid: ${problems.slice(0, 3).join('; ')}`);
  const candidatePath = join(runDir, 'candidate', 'rubric.json');
  writeJsonAtomic(candidatePath, candidate);

  // the items: the claims of every gate case that will be evaluated, and the canaries
  const sourceReadingTags = config.scope?.source_reading_tags ?? [];
  let selected;
  let canaries;
  try {
    selected = selectCases(existsSync(loc.cases) ? readJsonl(loc.cases).rows : [], { lesson: lesson.lesson_key, sourceReadingTags });
    canaries = selectCanaries(existsSync(loc.canaries) ? readJsonl(loc.canaries).rows : []);
  } catch (e) {
    if (e instanceof InputError) throw new ExitError(EXIT.INVALID, e.message);
    throw e;
  }
  const items = new Map();
  for (const c of [...selected.gating, ...selected.lessonCases]) items.set(c.item, { id: c.item, claim: c.text, sources_count: null });
  for (const c of canaries) items.set(c.item, { id: c.item, claim: c.text, sources_count: null });
  if (!items.size) throw new ExitError(EXIT.INVALID, 'there is nothing to evaluate: evals/cases.jsonl has no active case and evals/canaries.jsonl no active canary');
  const itemsFile = join(runDir, 'items.jsonl');
  writeTextAtomic(itemsFile, `${[...items.values()].map((i) => JSON.stringify(i)).join('\n')}\n`);

  const smoke = Boolean(args.smoke);
  const runs = smoke ? (config.judge?.smoke_runs ?? 1) : (config.judge?.runs ?? 3);
  const record = {
    run_id: runId, kind: 'promote', status: 'judging', lesson_key: lesson.lesson_key, lesson_id: lesson.lesson_id ?? null, tag: lesson.tag, rule_label: lesson.rule_label, version, previous_version: rubric.rubric_version,
    previous_hash: rubric.rubric_hash, candidate: candidatePath, smoke, runs, items: items.size, lesson_cases: selected.lessonCases.length, gate_cases: selected.gating.length, canaries: canaries.length,
    started: previous?.started ?? now().toISOString(), rolled_back: false,
  };
  writeJsonAtomic(recordFile, record);

  io.out(`promote: ${lesson.lesson_id ?? lesson.lesson_key}: candidate ${version} (${lesson.rule_label}); judging ${items.size} item(s) (${selected.gating.length} gate case(s), ${selected.lessonCases.length} for this lesson, ${canaries.length} canaries) x ${runs} run(s) twice`);
  const base = await judgeSide({ side: 'baseline', runId, itemsFile, runs, args, root, deps, now, io, candidatePath });
  const cand = await judgeSide({ side: 'candidate', runId, itemsFile, runs, args, root, deps, now, io, candidatePath });
  writeJsonAtomic(recordFile, { ...record, status: 'evaluating', baseline_run: base.id, candidate_run: cand.id, baseline_config16: base.config16, candidate_config16: cand.config16 });

  const evaluateWith = (extra = {}) => {
    try {
      return evaluate({
        baseline: base.config16, candidate: cand.config16, baselineRubric: loc.rubric, candidateRubric: candidatePath, cases: loc.cases, canaries: loc.canaries,
        judgments: join(loc.runs, 'judgments'), config, runs, target: lesson.tag, lesson: lesson.lesson_key, changedTags: [lesson.tag], smoke, cardId: runId, ...extra,
      });
    } catch (e) {
      if (e instanceof InputError) throw new ExitError(EXIT.INVALID, e.message);
      throw e;
    }
  };
  let result = evaluateWith();
  let reconfirm = null;
  if (!smoke && reconfirmation.runs > 0 && result.exitCode !== EXIT.INVALID) { // flipped cases get more runs before the verdict; a smoke run stays a one-run rehearsal
    const judged = new Set(rubric.tags.filter((t) => t.judged === true && candidate.tags.some((c) => c.name === t.name && c.judged === true)).map((t) => t.name));
    reconfirm = await reconfirmFlips({
      first: result, base, cand, settings: reconfirmation, lesson, judged, selected, runDir, runId, runs, args, root, deps, now, io, candidatePath, evaluateAgain: (picks) => evaluateWith({ reconfirmed: picks }),
    });
    if (reconfirm) result = reconfirm.result; // the verdict after reconfirmation is the one that counts
  }
  const baseUsd = (base.cost ?? 0) + (reconfirm?.costs.baseline ?? 0);
  const candUsd = (cand.cost ?? 0) + (reconfirm?.costs.candidate ?? 0);
  const cost = round6(baseUsd + candUsd);
  const model = cand.model ?? base.model ?? config.models.judge;
  result.card.cost = { usd: cost, baseline_usd: round6(baseUsd), candidate_usd: round6(candUsd), model, ...(reconfirm ? { reconfirm_usd: round6(reconfirm.costs.baseline + reconfirm.costs.candidate) } : {}) };
  writeCard(result, runDir);

  const verdict = result.verdict;
  if (result.exitCode === EXIT.INVALID) {
    writeJsonAtomic(recordFile, { ...readJson(recordFile), status: 'incomplete', verdict, cost_note: cost });
    io.out(result.md.trimEnd());
    io.err(`promote: the judgments are incomplete, so there is no gate verdict (${result.incomplete[0]?.problems?.[0] ?? 'see card.json'}); run promote.mjs --lesson ${JSON.stringify(args.lesson)} --resume --run-id ${runId}`);
    return EXIT.INVALID;
  }

  // PROMOTING.json was checked when this run started, which was minutes ago: another promote may have written it since (the lock makes that unusual,
  // not impossible: a person can remove a lock). This run's judgments stay in the cache; its plan is not written.
  const meanwhile = readPromoting(root);
  if (meanwhile && meanwhile.run_id !== runId) {
    writeJsonAtomic(recordFile, { ...readJson(recordFile), status: 'aborted', aborted_at: now().toISOString(), rolled_back: true, rolled_back_reason: `run ${meanwhile.run_id ?? '(unreadable PROMOTING.json)'} started promoting meanwhile` });
    throw new ExitError(EXIT.INVALID, `run ${meanwhile.run_id ?? '(unreadable PROMOTING.json)'} started promoting while this run was judging, so no plan was written for ${runId}; finish it (apply.mjs, then promote.mjs --finalize) or promote.mjs --abort it, then promote this lesson again (the judgments are kept)`);
  }

  const today = now().toISOString().slice(0, 10);
  const lessonRef = lesson.lesson_id ?? lesson.lesson_key;
  const demo = DEMO_TITLE.test(lesson.lesson_key) || localDemoFlag(root, lesson.lesson_key);
  const markRolledBack = verdict === 'FAIL' && (demo || Boolean(args['mark-rolled-back']));
  const plan = openPlan({ runId, sourcePull: pull.id, root, config, pull, now, ctx: verdict === 'PASS' && !smoke ? { promote: true, gate: 'PASS' } : {} });
  const rulebookRow = readJson(join(pull.dir, 'norm', 'rulebook.json')).rows.find((r) => r.name === lesson.tag);
  const cardMd = result.md;
  const gateResult = cardMd.length > MAX_TEXT ? cardMd.slice(0, MAX_TEXT) : cardMd;
  const live = verdict === 'PASS' && !smoke;

  if (live) {
    const newTag = candidate.tags.find((t) => t.name === lesson.tag);
    plan.update('rulebook', lesson.tag, rulebookRow?.page_id ?? null, {
      'When to use': composeWhenToUse(newTag.when_to_use), 'Rule version': candidate.rubric_version, 'Tag hash': newTag.tag_hash, 'Changed by': [{ rule_changes: lesson.lesson_key }],
    }, { ...(rulebookRow ? { expect: { 'When to use': rulebookRow.when_to_use } } : {}), note: `gate PASS: ${lesson.rule_label} -> ${candidate.rubric_version}` });
  }
  const lessonProps = live
    ? { Status: 'Live', 'Rubric version': candidate.rubric_version, 'Gate result': gateResult }
    : { 'Gate result': gateResult, ...(markRolledBack ? { Status: 'Rolled back' } : {}) };
  if (!smoke) { // a smoke run is a rehearsal: it leaves a Smoke row, and the lesson row is not touched
    plan.update('rule_changes', lesson.lesson_key, lesson.page_id, lessonProps, { ...(live || markRolledBack ? { expect: { Status: 'Approved' } } : {}), note: live ? 'gate PASS: the lesson goes live' : `gate ${verdict}: the Rulebook is untouched` });
  }
  const runTitle = uniqueRunTitle(`${smoke ? 'Smoke' : 'Gate'} ${candidate.rubric_version} · ${lessonRef}`, pull);
  // Verdict PASS, HOLD or FAIL belongs to a Gate row; a smoke verdict is a rehearsal's, not the gate's, so a Smoke row says n/a (the card in Summary and in
  // the page still says what the rehearsal found). The version label of a candidate that was never promoted comes back with the next candidate, so the
  // row carries the candidate's rubric hash as well: two rows with the same label are told apart by it.
  plan.create('runs', runTitle, {
    Kind: smoke ? 'Smoke' : 'Gate', Verdict: smoke ? 'n/a' : verdict, 'Rubric version': `${rubric.rubric_version} → ${candidate.rubric_version}`, Started: now().toISOString(), 'Claims judged': items.size,
    Canaries: canariesText(result.card), 'Newly failing': result.card.cases?.newly_failing.length ?? 0, 'Per-tag summary': perTagSummaryWithHash(result.card, candidate), Summary: gateResult, Model: model,
    'Cost USD': cost, Lesson: [{ rule_changes: lesson.lesson_key }],
  }, { content_md: cardMarkdown(result.card, cardMd, { cost, model }) });
  const notes = [];
  if (live) {
    const queue = readJsonl(join(pull.dir, 'norm', 'queue.jsonl')).rows;
    const supporting = queue.filter((r) => (r.lesson_page_ids ?? []).some((id) => normId(id) === normId(lesson.page_id)) && !r.in_regression_suite);
    for (const r of supporting) plan.update('tag_decisions', r.key, r.page_id, { 'In regression suite': today }, { note: 'supporting row of a lesson that went live' });
  }
  if (live) { // only a PASS changes what is in force; HOLD, FAIL and smoke leave Agent settings alone
    if (pull.covers('agent_settings') && pull.idMap?.agent_settings?.[config.agent]) {
      plan.update('agent_settings', config.agent, null, {
        'Rubric in force': candidate.rubric_version, 'Last run at': now().toISOString(),
        'Last run summary': `Gate ${verdict}: ${lessonRef} ${rubric.rubric_version} -> ${candidate.rubric_version}`.slice(0, MAX_TEXT),
      });
    } else notes.push('Agent settings were not updated (the pull has no Agent settings): Rubric in force stays as it was');
  }
  const written = plan.write();

  const rolledBack = !live;
  writeJsonAtomic(recordFile, {
    ...readJson(recordFile), status: live ? 'planned' : 'done', verdict, card_id: result.card.card_id, plan: written.path, rolled_back: rolledBack, run_title: runTitle, judge_cost_usd: cost, ...(reconfirm ? { reconfirm: reconfirm.record } : {}),
    ...(rolledBack ? { rolled_back_reason: smoke ? 'smoke run: never finalized' : `gate ${verdict}` } : {}), lesson_status_set: markRolledBack ? 'Rolled back' : live ? 'Live' : lesson.status,
  });
  writeJsonAtomic(join(runDir, 'candidate', 'run.json'), { run_id: runId, version: candidate.rubric_version, rubric_hash: candidate.rubric_hash, verdict, rolled_back: rolledBack, lesson_key: lesson.lesson_key });
  if (live) writeJsonAtomic(loc.promoting, { run_id: runId, lesson: lesson.lesson_key, lesson_id: lesson.lesson_id ?? null, tag: lesson.tag, version: candidate.rubric_version, previous_version: rubric.rubric_version, started_at: now().toISOString(), plan: written.path, candidate: candidatePath });

  io.out(cardMd.trimEnd());
  if (live) io.out(`promote: ${verdict}${result.card.small_sample ? ' (small sample)' : ''}: ${lessonRef} -> rubric ${candidate.rubric_version}; $${cost.toFixed(4)}; plan ${written.path}\npromote: next: node agents/claim-tagger/scripts/plan.mjs check --run ${runId}; node agents/claim-tagger/scripts/apply.mjs --run ${runId}; node agents/claim-tagger/scripts/promote.mjs --finalize ${runId}`);
  else io.out(`promote: ${verdict}${smoke ? ' (smoke: not a gate verdict, nothing can go live)' : ''}${result.card.small_sample ? ' (small sample)' : ''}: ${lessonRef} stays ${markRolledBack ? 'Rolled back' : lesson.status}; the Rulebook is untouched; $${cost.toFixed(4)}; plan ${written.path}\npromote: next: node agents/claim-tagger/scripts/plan.mjs check --run ${runId}; node agents/claim-tagger/scripts/apply.mjs --run ${runId} (only the card and the Gate result are written)`);
  for (const n of notes) io.err(`promote: ${n}`);
  return result.exitCode;
}

/** A lesson that distill recorded as a planted test (lessons.jsonl of a distill run says demo: true). */
function localDemoFlag(root, key) {
  const { runs } = locations(root);
  if (!existsSync(runs)) return false;
  for (const d of readdirSync(runs, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const file = join(runs, d.name, 'lessons.jsonl');
    if (!existsSync(file)) continue;
    try {
      if (readJsonl(file).rows.some((l) => l.lesson_key === key && l.demo === true)) return true;
    } catch {
      // an unreadable lessons file is not evidence
    }
  }
  return false;
}

// ---- phase 2: finalize ------------------------------------------------------------------------------------------------------------------------

function appendChangelog(file, line) {
  const header = ['# Rubric changelog', '', 'One line per rubric version, oldest first: version (date), who, what changed, and the hashes of that version.', ''];
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l, i, all) => !(i === all.length - 1 && l === '')) : header;
  if (!lines.includes(line)) lines.push(line);
  writeTextAtomic(file, `${lines.join('\n')}\n`);
}

function writeLock(loc, rubric, now) {
  writeJsonAtomic(loc.lock, {
    rubric_version: rubric.rubric_version, rubric_hash: rubric.rubric_hash, scope_hash: rubric.scope_hash, file_sha256: fileSha256(loc.rubric), locked_at: now().toISOString(),
  });
}

function bestPull({ root, config, preferred, need }) {
  const tryIds = [latestPullId(root), preferred].filter(Boolean);
  for (const id of tryIds) {
    try {
      const pull = loadPull(root, id, { config });
      if (need.every((db) => pull.covers(db))) return pull;
    } catch {
      // try the next one
    }
  }
  return null;
}

async function finalize({ args, io, root, config, now }) {
  const loc = locations(root);
  const runId = args.finalize;
  // a paused agent does not go live; the lock and the Rulebook are not checked here: between the apply and this step Notion carries the new text,
  // and a stop in the middle of an earlier finalize leaves a lock that this very step repairs
  const pf = preflight({ root, config, now, ignore: ['lock', 'drift', 'promoting'] });
  if (pf.code !== EXIT.OK) throw new ExitError(pf.code, pf.message);
  const runDir = join(loc.runs, runId);
  const promoting = readPromoting(root);
  if (!promoting || promoting.run_id !== runId) throw new ExitError(EXIT.INVALID, `runs/PROMOTING.json ${promoting ? `belongs to run ${promoting.run_id ?? '(unreadable)'}` : 'does not exist'}: there is nothing to finalize for run ${runId}`);
  const record = existsSync(join(runDir, 'run.json')) ? readJson(join(runDir, 'run.json')) : null;
  const card = existsSync(join(runDir, 'card.json')) ? readJson(join(runDir, 'card.json')) : null;
  if (!record || !card) throw new ExitError(EXIT.INVALID, `run ${runId} has no run.json and card.json`);
  if (card.smoke || record.smoke) throw new ExitError(EXIT.INVALID, `run ${runId} is a smoke run: a smoke card can never be finalized; run promote.mjs --lesson ... without --smoke`);
  if (card.verdict !== 'PASS') throw new ExitError(EXIT.INVALID, `run ${runId} has verdict ${card.verdict}, not PASS: only a PASS goes live`);
  const verifyFile = join(runDir, 'verify.json');
  if (!existsSync(verifyFile)) throw new ExitError(EXIT.INVALID, `run ${runId} has no verify.json: apply the plan first (plan.mjs check --run ${runId}; apply.mjs --run ${runId}), then finalize`);
  const verify = readJson(verifyFile);
  if (verify.result !== 'clean') throw new ExitError(EXIT.INVALID, `verify.json of run ${runId} says "${verify.result}", not clean: fix the apply (apply.mjs --run ${runId} --retry) first`);
  const live = readJson(loc.rubric);
  const candidatePath = record.candidate;
  const candidate = readJson(candidatePath);
  const already = live.rubric_hash === candidate.rubric_hash && live.rubric_version === candidate.rubric_version;
  if (!already && live.rubric_hash !== record.previous_hash) throw new ExitError(EXIT.DRIFT, `the live rubric changed since this promote started (it was ${record.previous_version} ${record.previous_hash}, it is ${live.rubric_version} ${live.rubric_hash})`);
  if (!checkHashes(candidate).ok) throw new ExitError(EXIT.INVALID, `the candidate rubric of run ${runId} does not match its own hashes`);

  // Notion must show what the plan wrote
  const post = bestPull({ root, config, preferred: verify.post_pull, need: ['rulebook', 'rule_changes'] });
  if (!post) throw new ExitError(EXIT.INVALID, `no pull holds the Rulebook and Rule changes after the apply: run pull.mjs --dbs rulebook,tag_decisions,rule_changes first`);
  const newTag = candidate.tags.find((t) => t.name === record.tag);
  const row = readJson(join(post.dir, 'norm', 'rulebook.json')).rows.find((r) => r.name === record.tag);
  if (!row || normaliseText(row.when_to_use ?? '') !== normaliseText(composeWhenToUse(newTag.when_to_use))) {
    throw new ExitError(EXIT.INVALID, `the Rulebook row ${record.tag} in pull ${post.id} does not carry the candidate's When to use: the plan did not (fully) land; apply.mjs --run ${runId} --retry, pull, and finalize again`);
  }
  const lesson = lessonIndex(post).byKey.get(record.lesson_key);
  if (!lesson || lesson.status !== 'Live') throw new ExitError(EXIT.INVALID, `the lesson "${record.lesson_key}" is ${lesson?.status ?? 'missing'} in pull ${post.id}, not Live: the plan did not (fully) land`);

  // the files: history first, then the rubric, then the lock, so a stop in between is visible as a lock mismatch and finalize can run again
  const candidateText = readFileSync(candidatePath, 'utf8');
  ensureDir(loc.history);
  writeTextAtomic(join(loc.history, `${safeName(candidate.rubric_version)}.json`), candidateText);
  if (!already) writeTextAtomic(loc.rubric, candidateText);
  writeLock(loc, candidate, now);
  const entry = candidate.changelog[candidate.changelog.length - 1];
  appendChangelog(loc.changelog, `- ${candidate.rubric_version} (${entry.date}), promote: ${entry.note ?? `${record.rule_label} replaced`} (gate PASS, card ${card.card_id}). rubric_hash ${candidate.rubric_hash}, scope_hash ${candidate.scope_hash}.`);

  // the cases: the lesson is Live now, so its contested cases become active; every hash is stamped against the new live rubric
  const sync = syncCases({ root, config, pull: post, rubric: candidate, now, write: false });
  const today = now().toISOString().slice(0, 10);
  const planned = planRegression({ root, config, pull: post, rows: sync.regression, runId: `${runId}-cases`, now, today });
  writeCases(sync);
  unlinkSync(loc.promoting);
  writeJsonAtomic(join(runDir, 'run.json'), { ...record, status: 'finalized', finalized_at: now().toISOString() });
  const lockOk = lockState(root);
  io.out(`promote: finalized run ${runId}: rubric ${candidate.rubric_version} ${candidate.rubric_hash} is live (lock ${lockOk.ok ? 'ok' : `MISMATCH: ${lockOk.mismatches[0]}`}); cases: ${sync.counts.active} active, ${sync.counts.contested} contested, ${sync.counts.restamped} hash(es) re-stamped${planned ? `; In regression suite for ${planned.ops} row(s) in plan ${planned.runId} (plan.mjs check, apply.mjs)` : ''}`);
  io.out(`promote: commit: git add agents/claim-tagger/rubric agents/claim-tagger/evals && git commit -m "rubric ${candidate.rubric_version}: ${record.lesson_id ?? record.lesson_key} (gate PASS, ${card.card_id})"`);
  return EXIT.OK;
}

// ---- restore plans (abort and rollback) -----------------------------------------------------------------------------------------------------------

/** The Kind a Runs row gets: `preferred` when the Runs database has that option (Rollback was added to it later), else `fallback`. */
function runKind(root, pull, preferred, fallback) {
  const schema = pull.schema('runs') ?? findSchema(root, 'runs', pull.id);
  const options = (schema?.properties?.Kind?.select?.options ?? []).map((o) => o.name);
  return options.includes(preferred) ? preferred : fallback;
}

function restoreOps(plan, { root, pull, rubricBack, tag, lesson, lessonStatus, gateNote, runTitle, runSummary, config, now, rulebook = true }) {
  const rulebookRow = readJson(join(pull.dir, 'norm', 'rulebook.json')).rows.find((r) => r.name === tag);
  const backTag = rubricBack.tags.find((t) => t.name === tag);
  if (rulebook) {
    plan.update('rulebook', tag, rulebookRow?.page_id ?? null, {
      'When to use': composeWhenToUse(backTag.when_to_use), 'Rule version': tagRuleVersion(rubricBack, tag), 'Tag hash': backTag.tag_hash, 'Changed by': [],
    }, { ...(rulebookRow ? { expect: { 'When to use': rulebookRow.when_to_use } } : {}), note: 'restore: the live rubric\'s own text goes back into the Rulebook' });
  }
  if (lessonStatus) {
    plan.update('rule_changes', lesson.lesson_key, lesson.page_id, { Status: lessonStatus, 'Gate result': [lesson.gate_result, gateNote].filter(Boolean).join('\n').slice(0, MAX_TEXT) }, { note: 'restore' });
  }
  if (runTitle) {
    plan.create('runs', runTitle, {
      Kind: runKind(root, pull, 'Rollback', 'Gate'), Verdict: 'n/a', 'Rubric version': rubricBack.rubric_version, Started: now().toISOString(), Summary: runSummary.slice(0, MAX_TEXT), Lesson: [{ rule_changes: lesson.lesson_key }],
    }, { content_md: `## ${runTitle}\n${runSummary}` });
  }
  if (pull.covers('agent_settings') && pull.idMap?.agent_settings?.[config.agent]) {
    plan.update('agent_settings', config.agent, null, { 'Rubric in force': rubricBack.rubric_version, 'Last run at': now().toISOString(), 'Last run summary': (runSummary || gateNote || 'restore').slice(0, MAX_TEXT) });
  }
}

async function abort({ args, io, root, config, now }) {
  const loc = locations(root);
  const runId = args.abort;
  const runDir = join(loc.runs, runId);
  const promoting = readPromoting(root);
  const holdsLock = readPromoteLock(loc)?.run_id === runId;
  if (!promoting || promoting.run_id !== runId) {
    if (!holdsLock) throw new ExitError(EXIT.INVALID, `runs/PROMOTING.json ${promoting ? `belongs to run ${promoting.run_id ?? '(unreadable)'}` : 'does not exist'}: nothing to abort for run ${runId}`);
    // A promote that was killed while it judged: it still holds runs/PROMOTE.lock, but PROMOTING.json is written only after a PASS, so nothing was applied.
    const recordFile = join(runDir, 'run.json');
    unlinkSync(loc.promoteLock);
    if (existsSync(recordFile)) writeJsonAtomic(recordFile, { ...readJson(recordFile), status: 'aborted', aborted_at: now().toISOString(), rolled_back: true, rolled_back_reason: 'aborted while judging' });
    io.out(`promote: aborted run ${runId}: it still held runs/PROMOTE.lock (a promote that was killed while judging); the lock is removed. PROMOTING.json was never written, so nothing was applied and Notion was never changed`);
    return EXIT.OK;
  }
  const record = existsSync(join(runDir, 'run.json')) ? readJson(join(runDir, 'run.json')) : {};
  const live = readJson(loc.rubric);
  const applied = existsSync(join(runDir, 'applied.jsonl'));
  let restore = null;
  if (applied) {
    const pull = bestPull({ root, config, preferred: null, need: ['rulebook', 'rule_changes'] });
    const lastAt = readJsonl(join(runDir, 'applied.jsonl')).rows.at(-1)?.at;
    const stale = pull && lastAt && Date.parse(pull.info.taken_at) < Date.parse(lastAt);
    if (!pull || stale) throw new ExitError(EXIT.INVALID, `run ${runId} was (partly) applied, so Notion may carry the candidate's text: run pull.mjs --dbs rulebook,rule_changes,agent_settings first, then abort again (PROMOTING.json was kept)`);
    const row = readJson(join(pull.dir, 'norm', 'rulebook.json')).rows.find((r) => r.name === record.tag);
    const liveTag = live.tags.find((t) => t.name === record.tag);
    const lesson = lessonIndex(pull).byKey.get(record.lesson_key);
    const textDiffers = Boolean(row && liveTag && normaliseText(row.when_to_use ?? '') !== normaliseText(composeWhenToUse(liveTag.when_to_use)));
    const lessonLive = lesson?.status === 'Live';
    // the Rulebook text is the question; a lesson left Live by a half-applied plan has to go back as well
    if (textDiffers || lessonLive) restore = { pull, lesson, rulebook: textDiffers };
  }
  let planned = null;
  if (restore) {
    const planId = `${runId}-abort`;
    const { plan } = buildRestorePlan({ runId: planId, root, config, pull: restore.pull, now }, (p) => {
      restoreOps(p, {
        root,
        pull: restore.pull, rubricBack: live, tag: record.tag, lesson: restore.lesson, lessonStatus: restore.lesson?.status === 'Live' ? 'Rolled back' : null, rulebook: restore.rulebook,
        gateNote: `Aborted ${now().toISOString().slice(0, 10)}: the promote was not finalized, the Rulebook was restored to ${live.rubric_version}.`, runTitle: null, runSummary: `Promote ${runId} aborted; Rulebook restored to ${live.rubric_version}`, config, now,
      });
    });
    planned = { id: planId, path: plan.write().path };
  }
  unlinkSync(loc.promoting);
  if (holdsLock) unlinkSync(loc.promoteLock); // only after a stop between writing PROMOTING.json and letting go of the lock
  writeJsonAtomic(join(runDir, 'run.json'), { ...record, status: 'aborted', aborted_at: now().toISOString(), rolled_back: true, rolled_back_reason: 'aborted' });
  io.out(`promote: aborted run ${runId}: PROMOTING.json removed; ${planned ? `Notion's Rulebook still carried the candidate text, so a restore plan was written (${planned.id}): plan.mjs check --run ${planned.id}; apply.mjs --run ${planned.id}` : applied ? 'Notion\'s Rulebook already matches the live rubric, no restore needed' : 'the plan had not been applied, so Notion was never changed'}`);
  return EXIT.OK;
}

// ---- rollback ---------------------------------------------------------------------------------------------------------------------------------------

async function rollback({ args, io, root, config, now }) {
  const loc = locations(root);
  const { pull } = loadPullFor({ root, config, now, pullId: args.pull, need: ['rulebook', 'rule_changes'], ignore: [] }); // a promote in flight blocks it: finish or abort that first
  const lesson = resolveLesson(pull, args.rollback);
  if (lesson.status !== 'Live') throw new ExitError(EXIT.INVALID, `lesson "${lesson.lesson_key}" is ${lesson.status}, not Live: only a Live lesson can be rolled back`);
  const live = readJson(loc.rubric);
  const last = live.changelog[live.changelog.length - 1];
  const isLatest = last?.previous_version && ((last.lesson_id && last.lesson_id === lesson.lesson_id) || last.lesson_key === lesson.lesson_key || String(last.note ?? '').includes(`"${lesson.lesson_key}"`));
  if (!isLatest) throw new ExitError(EXIT.INVALID, `"${lesson.lesson_key}" is not the most recent change of the live rubric (${live.rubric_version}: ${last?.note ?? last?.change ?? 'no note'}); only the latest change can be rolled back`);
  const historyFile = join(loc.history, `${safeName(last.previous_version)}.json`);
  if (!existsSync(historyFile)) throw new ExitError(EXIT.INVALID, `rubric/history/${safeName(last.previous_version)}.json does not exist, so version ${last.previous_version} cannot be restored`);
  const back = readJson(historyFile);
  if (!checkHashes(back).ok) throw new ExitError(EXIT.INVALID, `rubric/history/${safeName(last.previous_version)}.json does not match its own hashes`);
  if (!args.confirm) {
    io.err(`promote: --rollback would restore rubric ${back.rubric_version} (${back.rubric_hash}) over ${live.rubric_version} (${live.rubric_hash}), mark "${lesson.lesson_key}" Rolled back and put the previous ${lesson.tag} text back in the Rulebook. This is the one change that does not pass the gate, so it needs --confirm.`);
    return EXIT.INVALID;
  }
  const today = now().toISOString().slice(0, 10);
  const planId = args['run-id'] ?? makeRunId('rollback', now());
  const title = uniqueRunTitle(`Rollback ${live.rubric_version}`, pull);
  const { plan } = buildRestorePlan({ runId: planId, root, config, pull, now }, (p) => {
    restoreOps(p, {
      root,
      pull, rubricBack: back, tag: lesson.tag, lesson, lessonStatus: 'Rolled back', gateNote: `Rolled back ${today}: rubric ${back.rubric_version} restored.`, runTitle: title,
      runSummary: `Rolled back ${lesson.lesson_id ?? lesson.lesson_key} (${live.rubric_version}): rubric ${back.rubric_version} (${back.rubric_hash}) restored byte for byte from rubric/history.`, config, now,
    });
  });
  const written = plan.write();
  // the files, after the plan exists: the history file goes back as rubric.json, so the hash is exactly the earlier one
  const text = readFileSync(historyFile, 'utf8');
  writeTextAtomic(loc.rubric, text);
  const restored = readJson(loc.rubric);
  if (restored.rubric_hash !== back.rubric_hash || !checkHashes(restored).ok) throw new Error(`internal error: the restored rubric hash ${restored.rubric_hash} is not the history file's ${back.rubric_hash}`);
  writeLock(loc, restored, now);
  appendChangelog(loc.changelog, `- ${back.rubric_version} (${today}), rollback: ${live.rubric_version} rolled back (${lesson.lesson_id ? `${lesson.lesson_id} ` : ''}"${lesson.lesson_key}"); rubric/history/${safeName(back.rubric_version)}.json restored. rubric_hash ${restored.rubric_hash}, scope_hash ${restored.scope_hash}.`);
  const sync = syncCases({ root, config, pull, rubric: restored, now, lessonStatus: new Map([[lesson.lesson_key, 'Rolled back']]) });
  io.out(`promote: rolled back ${lesson.lesson_id ?? lesson.lesson_key}: rubric ${restored.rubric_version} ${restored.rubric_hash} restored (equals rubric/history/${safeName(back.rubric_version)}.json); cases: ${sync.counts.contested} contested, ${sync.counts.restamped} hash(es) re-stamped; plan ${written.path}`);
  io.out(`promote: next: node agents/claim-tagger/scripts/plan.mjs check --run ${planId}; apply.mjs --run ${planId}; then git add agents/claim-tagger/rubric agents/claim-tagger/evals && git commit`);
  return EXIT.OK;
}

// ---- command line -------------------------------------------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Run the script; returns the exit code. deps (tests): root, now, config, runClaude, fakeState, judgeBin, spawnImpl, cliVersion, processEnv. */
export async function main(argv, io = defaultIo, deps = {}) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        lesson: { type: 'string' }, smoke: { type: 'boolean' }, resume: { type: 'boolean' }, 'run-id': { type: 'string' }, driver: { type: 'string' }, model: { type: 'string' }, pull: { type: 'string' },
        finalize: { type: 'string' }, abort: { type: 'string' }, rollback: { type: 'string' }, confirm: { type: 'boolean' }, 'mark-rolled-back': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }).values;
    const modes = [args.lesson, args.finalize, args.abort, args.rollback].filter((v) => v !== undefined).length;
    if (!args.help && modes !== 1) throw new UsageError('give exactly one of --lesson, --finalize, --abort and --rollback');
    if (args.driver && !['cli', 'fake'].includes(args.driver)) throw new UsageError(`--driver must be cli or fake, got "${args.driver}"`);
    if (args.confirm && args.rollback === undefined) throw new UsageError('--confirm goes with --rollback');
    if ((args.smoke || args.resume || args['mark-rolled-back']) && args.lesson === undefined) throw new UsageError('--smoke, --resume and --mark-rolled-back go with --lesson');
    for (const f of ['run-id', 'finalize', 'abort']) if (args[f] !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args[f])) throw new UsageError(`--${f} may only use letters, digits, '.', '_' and '-', got "${args[f]}"`);
  } catch (e) {
    io.err(`promote: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  try {
    const root = deps.root ?? agentRoot();
    const config = deps.config ?? loadConfig(root);
    const now = deps.now ?? (() => new Date());
    const ctx = { args, io, root, config, deps, now };
    if (args.finalize !== undefined) return await finalize(ctx);
    if (args.abort !== undefined) return await abort(ctx);
    if (args.rollback !== undefined) return await rollback(ctx);
    return await promote(ctx);
  } catch (e) {
    if (e instanceof ExitError) {
      io.err(`promote: ${e.message}`);
      return e.code;
    }
    if (e.name === 'PlanError' || e.code === 'ALLOWLIST') {
      io.err(`promote: ${e.message}${e.problems?.length ? `\n  ${e.problems.join('\n  ')}` : ''}`);
      return EXIT.INVALID;
    }
    io.err(`promote: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
