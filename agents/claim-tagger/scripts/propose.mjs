#!/usr/bin/env node
// From judgments to a Notion plan: the majority verdict of the judge runs for every claim and tag, the editor's decision where there is
// one, the live columns of the Claims table (Agent tags, Readiness, Tag confidence, Last judged) and the queue rows of Tag decisions
// (Agent proposal, confidence, reason, note, Why in queue, Priority, Rubric version). Nothing is written to Notion here: the result is
// runs/<out-run>/plan.jsonl, built through scripts/plan.mjs, which checks every property against the allowlist and applies nothing.
//
//   node agents/claim-tagger/scripts/propose.mjs --run <judge-run-id> --pull <pull-id> [--out-run <id>]
//
// Reads: runs/<run>/run.json and the judgment files it points to (judge.mjs); the pull's norm/claims.jsonl, queue.jsonl, settings.json,
// rulebook.json (and the rubric, for a polarity the Rulebook export lacks). Writes: runs/<out-run>/plan.jsonl, propose.json and
// runs/state/queue-week.json (the keys of the queue rows created this ISO week, which the weekly cap counts).
//
// Rules in one place:
//  - verdict: more than half of the runs agree -> that decision; otherwise ask_editor; any run missing or failed -> error.
//    Tags the code decides (Unsourced, the source-reading tags) do not depend on the model runs, so a failed run does not make them errors.
//  - an editor's decision (Tag outcome, or the seeded one) always wins and its queue row is never touched.
//  - Agent tags: tags with final state apply; tags this run does not judge (Editor verified) stay; an error verdict changes nothing.
//  - a plan only carries values that differ from the pull, so a second run on the same inputs gives an empty plan. For that the
//    proposal wording sticks while its direction holds, and Why in queue only ever gets stronger (Rule changed > Low confidence > the rest).
//  - Rule changed needs a recorded rubric version that looks like one (YYYY-MM-DD.n): rows seeded from the audit have none.
//  - propose refuses a smoke run, a run that is not finished, and a run judged with another rubric than the one in rubric.lock.
// Exit codes: 0 ok, 1 error, 2 invalid input or a plan op the builder refused, 4 the run was judged with another rubric than the one in force.

import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { EXIT } from './lib/exit-codes.mjs';
import { readJson, readJsonl, writeJsonAtomic } from './lib/jsonl.mjs';
import { agentRoot, ensureDir, isMain, runId as makeRunId } from './lib/paths.mjs';
import { compareCodePoints } from './lib/pyjson.mjs';
import { normaliseText } from './lib/rubric-build.mjs';
import { validate } from './lib/validate.mjs';
import { ExitError, codeDecidedTag, judgmentFileName, resolvePullDir, textHash } from './judge.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/propose.mjs --run <judge-run-id> --pull <pull-id> [--out-run <id>]';

const ID_RE = /^[A-Za-z0-9._-]+$/;
const RUBRIC_VERSION_RE = /^\d{4}-\d{2}-\d{2}\.\d+$/;
const DECISION_WORDS = { apply: 'apply', do_not_apply: 'do not apply', ask_editor: 'ask editor', cannot_tell: 'cannot tell', error: 'error' };
const WHY_STRENGTH = { 'Rule changed': 3, 'Editor challenge': 3, 'Blind check': 3, 'Low confidence': 2 }; // anything else counts 1, none 0
const PRIORITY_RANK = { High: 0, Medium: 1, 'Check source': 2 };

class UsageError extends Error {}

// ---- arguments -------------------------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--run': opts.run = value(); break;
      case '--pull': opts.pull = value(); break;
      case '--out-run': opts.outRun = value(); break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new UsageError(`unknown argument ${arg}`);
    }
  }
  if (!opts.help) {
    if (!opts.run) throw new UsageError('--run is required');
    if (!opts.pull) throw new UsageError('--pull is required');
    for (const [flag, v] of [['--run', opts.run], ['--pull', opts.pull], ['--out-run', opts.outRun]]) {
      if (v !== undefined && !ID_RE.test(v)) throw new UsageError(`${flag} may only use letters, digits, '.', '_' and '-', got "${v}"`);
    }
  }
  return opts;
}

// ---- small helpers ----------------------------------------------------------------------------------------------------------

const text = (v) => (typeof v === 'string' ? v : '');
const first = (...values) => values.find((v) => typeof v === 'string' && v !== '') ?? null;
// A pull row's value by its snake_case name, falling back to the Notion property name (rows may carry both shapes).
const col = (row, snake, notion) => row?.[snake] ?? row?.props?.[notion] ?? row?.[notion];
const round2 = (x) => Math.round(x * 100) / 100;
const mean = (list) => {
  const ps = list.map((r) => r.p).filter((p) => typeof p === 'number');
  return ps.length ? round2(ps.reduce((a, b) => a + b, 0) / ps.length) : null;
};
const words = (s) => String(s).split(/\s+/).filter(Boolean);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** At most `max` words of a text, with an ellipsis when it was cut. */
export function capWords(s, max) {
  const w = words(s);
  if (max < 1) return '';
  return w.length <= max ? w.join(' ') : `${w.slice(0, max).join(' ')}...`;
}

/** The ISO week of a date as "2026-W42" (UTC). */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - yearStart) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

// ---- verdicts ----------------------------------------------------------------------------------------------------------------

/**
 * The verdict of one tag on one claim from its runs. runsOut has one entry per run: { run, decision, p, rule_ref, reason, trigger } or null
 * for a run that is missing or failed. More than half of the runs agreeing gives that decision; otherwise ask_editor; any run missing gives
 * "error". meanP is the mean p of the runs that gave the verdict's decision (all valid runs when there is no majority).
 * Returns { decision, k (runs that gave it), n, meanP, unanimous, split (every run different, 3 or more runs), ruleRef, reason, applyCount, runs }.
 */
export function decideVerdict(runsOut, n) {
  const valid = runsOut.filter(Boolean);
  const applyCount = valid.filter((r) => r.decision === 'apply').length;
  if (n < 1 || valid.length < n) {
    return { decision: 'error', k: valid.length, n, meanP: mean(valid), unanimous: false, split: false, ruleRef: null, reason: null, applyCount, runs: runsOut };
  }
  const counts = new Map();
  for (const r of valid) counts.set(r.decision, (counts.get(r.decision) ?? 0) + 1);
  const need = Math.floor(n / 2) + 1;
  const majority = ['apply', 'do_not_apply', 'cannot_tell', 'ask_editor'].find((d) => (counts.get(d) ?? 0) >= need) ?? null;
  const decision = majority ?? 'ask_editor';
  const agreeing = majority ? valid.filter((r) => r.decision === majority) : valid;
  const refs = new Map();
  for (const r of agreeing) refs.set(r.rule_ref, (refs.get(r.rule_ref) ?? 0) + 1);
  const ruleRef = [...refs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; // sort is stable: a tie keeps the earlier run's reference
  return {
    decision,
    k: majority ? counts.get(majority) : (counts.get('ask_editor') ?? 0),
    n,
    meanP: mean(agreeing),
    unanimous: counts.size === 1,
    split: n >= 3 && counts.size === n,
    ruleRef,
    reason: agreeing.map((r) => oneLine(r.reason)).find(Boolean) ?? null,
    applyCount,
    runs: runsOut,
  };
}

/**
 * Which way an unsettled tag (ask_editor, error, cannot_tell on a text tag) leans, for the proposal. The plan says "Add tag when mean p is
 * at least 0.5", but p is the confidence in a run's own decision: a do_not_apply run with p 0.95 is a vote against the tag. So the runs
 * that took a side decide (apply counts p for the tag, do_not_apply counts 1 - p; the mean decides). Only when no run took a side
 * (all ask_editor) does the plan's rule apply: the mean p of the runs.
 */
export function leansApply(verdict) {
  const sided = (verdict.runs ?? []).filter((r) => r && (r.decision === 'apply' || r.decision === 'do_not_apply') && typeof r.p === 'number');
  if (sided.length) return sided.reduce((sum, r) => sum + (r.decision === 'apply' ? r.p : 1 - r.p), 0) / sided.length >= 0.5;
  return (verdict.meanP ?? 0) >= 0.5;
}

/** Agent proposal for a tag: Add tag / Keep tag, Do not add tag / Remove tag, or Read source first. `current` = the claim has the tag now. */
export function proposalFor(verdict, { current, sourceReading }) {
  switch (verdict.decision) {
    case 'apply': return current ? 'Keep tag' : 'Add tag';
    case 'do_not_apply': return current ? 'Remove tag' : 'Do not add tag';
    case 'cannot_tell':
      if (sourceReading) return 'Read source first';
      return leansApply(verdict) ? 'Add tag' : 'Do not add tag';
    default: return leansApply(verdict) ? 'Add tag' : 'Do not add tag'; // ask_editor and error
  }
}

/** 'apply' for Add tag / Keep tag, 'not' for Do not add tag / Remove tag, null for Read source first or nothing. */
export function directionOf(proposal) {
  if (proposal === 'Add tag' || proposal === 'Keep tag') return 'apply';
  if (proposal === 'Do not add tag' || proposal === 'Remove tag') return 'not';
  return null;
}

/** A tag goes to the queue as Low confidence when the agent could not settle it, its runs disagree, or its confidence sits in the middle band. */
export function isLowConfidence(verdict, { sourceReading, tSkip, tApply }) {
  if (verdict.decision === 'ask_editor' || verdict.decision === 'error') return true;
  if (verdict.decision === 'cannot_tell' && !sourceReading) return true; // a text-only tag the judge could not decide needs a person
  if (!verdict.unanimous) return true;
  return verdict.meanP !== null && verdict.meanP > tSkip && verdict.meanP < tApply;
}

/** The stronger of the reason a queue row already has and the one computed now (so a re-run never weakens it). */
export function mergeWhy(existing, computed) {
  if (!computed) return existing ?? null;
  if (!existing) return computed;
  return (WHY_STRENGTH[computed] ?? 1) > (WHY_STRENGTH[existing] ?? 1) ? computed : existing;
}

/** High for Rule changed, for Low confidence leaning apply on an Issue tag, and for a split of every run; Check source for source proposals; else Medium. */
export function priorityOf({ proposal, why, verdict, polarity, fixPolarities }) {
  if (proposal === 'Read source first') return 'Check source';
  if (why === 'Rule changed') return 'High';
  if (why === 'Low confidence' && directionOf(proposal) === 'apply' && fixPolarities.includes(polarity)) return 'High';
  if (verdict.split) return 'High';
  return 'Medium';
}

/** Needs editor, else Fix needed, else Not checkable, else Ready; states maps tag -> final state ('apply', 'do_not_apply', 'ask_editor', 'cannot_tell', 'error'). */
export function readinessOf(states, { polarityOf, fixPolarities, sourceReadingTags }) {
  const entries = [...states.entries()];
  if (entries.some(([tag, s]) => s === 'ask_editor' || s === 'error' || (s === 'cannot_tell' && !sourceReadingTags.has(tag)))) return 'Needs editor';
  if (entries.some(([tag, s]) => s === 'apply' && fixPolarities.includes(polarityOf(tag)))) return 'Fix needed';
  if (entries.some(([tag, s]) => s === 'cannot_tell' && sourceReadingTags.has(tag))) return 'Not checkable';
  return 'Ready';
}

/** "<tag> · <decision> · <p> · <k>/<n> runs · <rule_ref>" plus " · editor: <outcome> (kept)" on a decided tag. */
export function tagLine(tag, verdict, decidedOutcome) {
  const p = verdict.meanP === null ? '-' : verdict.meanP.toFixed(2);
  let line = `${tag} · ${DECISION_WORDS[verdict.decision]} · ${p} · ${verdict.k}/${verdict.n} runs · ${verdict.ruleRef ?? '-'}`;
  if (decidedOutcome) line += ` · editor: ${decidedOutcome} (kept)`;
  return line;
}

/** Lines joined with newlines, cut after the last line that fits (an ellipsis line when some were left out). */
export function capLines(lines, max) {
  const out = [];
  let size = 0;
  for (let i = 0; i < lines.length; i++) {
    const add = (out.length ? 1 : 0) + lines[i].length;
    if (size + add > max - (i < lines.length - 1 ? 4 : 0)) {
      out.push('...');
      break;
    }
    out.push(lines[i]);
    size += add;
  }
  return out.join('\n');
}

/** "Why I recommend this": the first reason of the agreeing runs, then "; k of n runs applied it", in at most maxWords words. */
export function recommendation(verdict, maxWords = 40) {
  if (verdict.decision === 'error') {
    return capWords(`No valid answer from ${verdict.n - verdict.k} of ${verdict.n} judge runs, so the agent has no recommendation; please decide this one by hand.`, maxWords);
  }
  const tail = `; ${verdict.applyCount} of ${verdict.n} runs applied it`;
  const reason = (verdict.reason ?? 'The runs gave no reason').replace(/[.\s]+$/, '');
  return capWords(reason, maxWords - words(tail).length) + tail;
}

/** "Agent full note": the verdict and what every run decided, with its rule and reason. */
export function fullNote(verdict, { judgeRun, version, maxText }) {
  const lines = [`Judge run ${judgeRun} · rubric ${version} · verdict ${DECISION_WORDS[verdict.decision]} (${verdict.k}/${verdict.n} runs)`];
  verdict.runs.forEach((r, i) => {
    if (!r) {
      lines.push(`Run ${i + 1}: no valid answer`);
      return;
    }
    const parts = [`Run ${i + 1}: ${DECISION_WORDS[r.decision]}`, r.p === null || r.p === undefined ? 'p -' : `p ${Number(r.p).toFixed(2)}`, r.rule_ref];
    if (r.trigger) parts.push(`trigger "${oneLine(r.trigger)}"`);
    if (oneLine(r.reason)) parts.push(oneLine(r.reason));
    lines.push(parts.join(' · '));
  });
  return capLines(lines, maxText);
}

// ---- reading the pull ---------------------------------------------------------------------------------------------------------

function polarityMap(rulebook, rubric) {
  const map = new Map();
  const rows = Array.isArray(rulebook) ? rulebook
    : Array.isArray(rulebook?.tags) ? rulebook.tags
    : Array.isArray(rulebook?.rows) ? rulebook.rows
    : rulebook && typeof rulebook === 'object'
      ? Object.entries(rulebook).map(([k, v]) => (typeof v === 'string' ? { name: k, polarity: v } : { name: k, ...v }))
      : [];
  for (const r of rows) {
    const name = first(r?.name, r?.tag, r?.title, r?.props?.['Tag title'], r?.['Tag title']);
    const polarity = first(r?.polarity, r?.Polarity, r?.props?.Polarity);
    if (name && polarity) map.set(name, polarity);
  }
  for (const t of rubric?.tags ?? []) if (!map.has(t.name) && t.polarity) map.set(t.name, t.polarity);
  return map;
}

const effectiveOutcome = (row) => first(col(row, 'effective_outcome', 'Effective outcome'), col(row, 'tag_outcome', 'Tag outcome'), col(row, 'seeded_outcome', 'Seeded outcome'));
const isDecided = (outcome) => outcome === 'Applies' || outcome === 'Does not apply';

function sameNumber(a, b) {
  const x = typeof a === 'number' ? a : null;
  const y = typeof b === 'number' ? b : null;
  return x === null || y === null ? x === y : Math.abs(x - y) <= 1e-9;
}
const sameText = (a, b) => normaliseText(text(a)) === normaliseText(text(b));
const sameSet = (a, b) => {
  const x = [...new Set(a ?? [])].sort(compareCodePoints);
  const y = [...new Set(b ?? [])].sort(compareCodePoints);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

// ---- the plan builder ----------------------------------------------------------------------------------------------------------

/**
 * Default plan builder: openPlan() of scripts/plan.mjs, imported only now so that nothing else depends on it. A plan factory takes
 * { runId, sourcePull, root, now } and returns a builder with create(db, key, properties, opts), update(db, key, pageId, properties, opts)
 * and write() (which writes <root>/runs/<runId>/plan.jsonl and returns { path, ... }). Relations are written as { <database>: <key> }
 * references, which the builder resolves to page ids through the pull's id-map. Tests pass their own factory in deps.planFactory.
 */
async function defaultPlanFactory(args) {
  let mod;
  try {
    mod = await import('./plan.mjs');
  } catch (e) {
    throw new ExitError(EXIT.ERROR, `scripts/plan.mjs cannot be loaded (${e.message}); the plan builder is needed to write plan.jsonl`);
  }
  if (typeof mod.openPlan !== 'function') throw new ExitError(EXIT.ERROR, 'scripts/plan.mjs does not export openPlan()');
  return mod.openPlan(args);
}

// ---- the judgments -----------------------------------------------------------------------------------------------------------

function loadJudgments({ cfgDir, runs, judged, schema, configId }) {
  const byClaim = new Map(); // id -> [judgment|null per run]
  for (const [id, hash] of judged) {
    const perRun = [];
    for (let run = 1; run <= runs; run++) {
      const file = join(cfgDir, `run-${run}`, judgmentFileName(id, hash));
      let doc = null;
      if (existsSync(file)) {
        try {
          const read = readJson(file);
          if (validate(schema, read).ok && read.status === 'ok' && read.id === id && read.run === run && read.text_hash === hash && read.config.config_id === configId) doc = read;
        } catch {
          doc = null;
        }
      }
      perRun.push(doc);
    }
    byClaim.set(id, perRun);
  }
  return byClaim;
}

const entryOf = (doc, tag) => {
  const t = doc?.tags.find((x) => x.name === tag);
  return t ? { decision: t.decision, p: t.p, rule_ref: t.rule_ref, reason: t.reason, trigger: t.trigger, basis: t.basis } : null;
};

// ---- main -----------------------------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Run propose; returns the exit code. deps (tests): agentDir, runsDir, now, planFactory. */
export async function main(argv, io = defaultIo, deps = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.err(`propose: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (opts.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  try {
    return await run(opts, io, deps);
  } catch (e) {
    if (e instanceof ExitError) {
      io.err(`propose: ${e.message}`);
      return e.code;
    }
    io.err(`propose: unexpected error: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

async function run(opts, io, deps) {
  const agentDir = deps.agentDir ?? agentRoot();
  const runsDir = deps.runsDir ?? join(agentDir, 'runs');
  const now = (deps.now ?? (() => new Date()))();
  const planFactory = deps.planFactory ?? defaultPlanFactory;
  const config = readJson(join(agentDir, 'config.json'));

  // --- the judge run
  const runFile = join(runsDir, opts.run, 'run.json');
  if (!existsSync(runFile)) throw new ExitError(EXIT.INVALID, `${runFile} does not exist; pass the id of a judge run`);
  const meta = readJson(runFile);
  if (meta.kind !== 'judge') throw new ExitError(EXIT.INVALID, `${runFile} is not a judge run`);
  if (meta.smoke) throw new ExitError(EXIT.INVALID, `run ${opts.run} is a smoke run (one run, the cheap model); it can never become a plan`);
  if (meta.status === 'stopped' || meta.status === 'running') {
    throw new ExitError(EXIT.INVALID, `run ${opts.run} is ${meta.status}, not finished; resume it first${meta.resume ? `: ${meta.resume}` : ''}`);
  }
  const lockFile = join(agentDir, 'rubric', 'rubric.lock');
  if (existsSync(lockFile) && meta.rubric_hash && readJson(lockFile).rubric_hash !== meta.rubric_hash) {
    throw new ExitError(EXIT.DRIFT, `run ${opts.run} was judged with rubric ${meta.rubric_version} (${meta.rubric_hash}), which is not the rubric in force (rubric.lock); judge again before proposing`);
  }
  if (meta.status === 'failed') io.err(`propose: warning: run ${opts.run} finished with too many failed item runs; claims with a missing or failed run are marked Needs editor`);
  const n = meta.runs;
  const config16 = String(meta.config_id).replace(/^sha256:/, '');
  const cfgDir = join(runsDir, 'judgments', config16);
  const version = meta.rubric_version;
  const schema = readJson(join(agentDir, 'schemas', 'judgment.schema.json'));

  // --- the pull
  const pullDir = resolvePullDir(runsDir, opts.pull);
  const normDir = join(pullDir, 'norm');
  const need = (name) => {
    const f = join(normDir, name);
    if (!existsSync(f)) throw new ExitError(EXIT.INVALID, `${f} does not exist; run the pull first`);
    return f;
  };
  const claimsRows = readJsonl(need('claims.jsonl')).rows;
  const queueRows = readJsonl(need('queue.jsonl')).rows;
  const settingsFile = join(normDir, 'settings.json');
  const settings = existsSync(settingsFile) ? readJson(settingsFile) : {};
  const rulebook = existsSync(join(normDir, 'rulebook.json')) ? readJson(join(normDir, 'rulebook.json')) : null;
  let rubric = null;
  for (const p of [meta.rubric_path, join(agentDir, 'rubric', 'rubric.json')]) {
    if (p && existsSync(p)) {
      rubric = readJson(p);
      break;
    }
  }
  const polarity = polarityMap(rulebook, rubric);
  if (!polarity.size) throw new ExitError(EXIT.INVALID, `${join(normDir, 'rulebook.json')} gives no tag polarity and the rubric could not be read, so Readiness cannot be computed`);

  const tSkip = config.thresholds?.t_skip ?? 0.25;
  const tApply = config.thresholds?.t_apply ?? 0.75;
  const fixPolarities = config.readiness?.fix_polarities ?? ['Issue'];
  const sourceReadingTags = new Set(config.scope?.source_reading_tags ?? []);
  const maxText = config.notion?.max_text ?? 1900;
  const whyMaxWords = config.queue?.why_max_words ?? 40;
  const weeklyCap = Number.isFinite(col(settings, 'weekly_cap', 'Weekly cap')) ? col(settings, 'weekly_cap', 'Weekly cap') : (config.queue?.weekly_cap_default ?? 40);

  // --- which claims were judged, on which text
  const claimById = new Map();
  for (const row of claimsRows) {
    const id = col(row, 'geo_id', 'Geo ID');
    if (typeof id === 'string' && id && !claimById.has(id)) claimById.set(id, row);
  }
  const judged = new Map(); // id -> text hash the judgments were made on
  let staleClaims = 0;
  const listed = Array.isArray(meta.items) ? meta.items : [...claimById.keys()].map((id) => ({ id, text_hash: textHash(col(claimById.get(id), 'claim', 'Claim title')) }));
  for (const it of listed) {
    const row = claimById.get(it.id);
    if (!row) continue; // a judged item that is not a claim of this pull (a canary, a claim since removed)
    if (textHash(col(row, 'claim', 'Claim title')) !== it.text_hash) {
      staleClaims++; // the claim text changed after it was judged: leave it to the next judge run
      continue;
    }
    judged.set(it.id, it.text_hash);
  }
  const judgments = loadJudgments({ cfgDir, runs: n, judged, schema, configId: meta.config_id });
  if (!Array.isArray(meta.items)) { // an older run.json without its item list: only claims that have at least one judgment
    for (const [id, perRun] of judgments) if (!perRun.some(Boolean)) judgments.delete(id);
  }
  const usable = [...judgments.values()].flat().filter(Boolean);
  if (!usable.length) throw new ExitError(EXIT.INVALID, `run ${opts.run} left no usable judgment for the claims of pull ${opts.pull}`);
  const tagNames = [...new Set(usable.flatMap((d) => d.tags.map((t) => t.name)))].sort(compareCodePoints);
  const codeTagNames = new Set(usable.flatMap((d) => d.tags.filter((t) => t.basis !== 'model').map((t) => t.name))); // decided by code, not by a model run
  // Tags that can end in cannot_tell because something is not known or not read (the source-reading tags, and Unsourced when the count is unknown):
  // that is a gap in the data, not a question for an editor, so it means Not checkable and Read source first, never Needs editor or Low confidence.
  const unreadable = new Set([...sourceReadingTags, ...codeTagNames]);

  // --- queue rows by key
  const rowsByKey = new Map();
  for (const row of queueRows) {
    const key = first(col(row, 'key', 'Key'), `${col(row, 'geo_id', 'Geo ID')}::${col(row, 'tag', 'Tag')}`);
    if (key && !rowsByKey.has(key)) rowsByKey.set(key, row);
  }

  // --- the assessment: claim by claim, tag by tag
  const claimOps = [];
  const rowUpdates = [];
  const rowCreates = [];
  const readinessCounts = { 'Needs editor': 0, 'Fix needed': 0, 'Not checkable': 0, Ready: 0 };
  const byWhy = {};
  const createdByWhy = {};
  let keptByDecision = 0;
  let claimsUnchanged = 0;
  const openRow = (why) => {
    if (why) byWhy[why] = (byWhy[why] ?? 0) + 1;
  };

  for (const [geoId, perRun] of judgments) {
    const claim = claimById.get(geoId);
    const currentTags = new Set(col(claim, 'agent_tags', 'Agent tags') ?? []);
    const states = new Map();
    const lines = [];
    const next = new Set([...currentTags].filter((t) => !tagNames.includes(t))); // tags this run does not judge stay as they are

    for (const tag of tagNames) {
      let runsOut = perRun.map((doc, i) => {
        const e = entryOf(doc, tag);
        return e ? { run: i + 1, ...e } : null;
      });
      if (codeTagNames.has(tag)) {
        // The code decides this tag from the sources count, so a model run that failed changes nothing about it.
        const count = col(claim, 'sources_count', 'Sources count');
        const known = runsOut.find(Boolean) ?? { run: 1, ...codeDecidedTag(tag, Number.isInteger(count) ? count : null, { sourceReading: sourceReadingTags }) };
        runsOut = runsOut.map((e, i) => e ?? { ...known, run: i + 1 });
      }
      const verdict = decideVerdict(runsOut, n);
      const key = `${geoId}::${tag}`;
      const row = rowsByKey.get(key) ?? null;
      const outcome = effectiveOutcome(row);
      const decided = isDecided(outcome);
      const final = decided ? (outcome === 'Applies' ? 'apply' : 'do_not_apply') : verdict.decision;
      states.set(tag, final);
      if (decided) keptByDecision++;
      lines.push(tagLine(tag, verdict, decided ? outcome : null));
      if (final === 'apply') next.add(tag);
      else if (final === 'error' && currentTags.has(tag)) next.add(tag); // nothing is known, so nothing changes

      if (decided) continue; // a decided row is never touched

      // --- the queue row of this claim and tag
      const sourceReading = unreadable.has(tag);
      const recordedProposal = row ? first(col(row, 'agent_proposal', 'Agent proposal')) : null;
      let proposal = proposalFor(verdict, { current: currentTags.has(tag), sourceReading });
      // Wording follows the claim as it was when the row was written ("Add tag" must not turn into "Keep tag" just because this plan added the
      // tag), so the proposal is only reworded when its direction changes.
      if (recordedProposal && directionOf(recordedProposal) === directionOf(proposal)) proposal = recordedProposal;
      const recorded = directionOf(recordedProposal);
      const recordedVersion = row ? text(col(row, 'rubric_version', 'Rubric version')) : '';
      const newDirection = directionOf(proposal);
      const ruleChanged = Boolean(row) && RUBRIC_VERSION_RE.test(recordedVersion) && recordedVersion !== version
        && recorded !== null && newDirection !== null && newDirection !== recorded;
      const computedWhy = ruleChanged ? 'Rule changed' : isLowConfidence(verdict, { sourceReading, tSkip, tApply }) ? 'Low confidence' : null;
      const existingWhy = row ? first(col(row, 'why_in_queue', 'Why in queue')) : null;
      const why = row ? mergeWhy(existingWhy, computedWhy) : computedWhy;
      if (!row && !why) continue; // nothing is wrong and nothing is waiting: no row
      const priority = priorityOf({ proposal, why, verdict, polarity: polarity.get(tag), fixPolarities });
      const wanted = {
        'Agent proposal': proposal,
        'Agent confidence': verdict.meanP,
        'Why I recommend this': recommendation(verdict, whyMaxWords),
        'Agent full note': fullNote(verdict, { judgeRun: opts.run, version, maxText }),
        'Why in queue': why,
        Priority: priority,
        'Rubric version': version,
      };
      openRow(why);
      if (!row) {
        createdByWhy[why] = (createdByWhy[why] ?? 0) + 1;
        rowCreates.push({ key, geoId, tag, properties: wanted, rank: PRIORITY_RANK[priority], isError: verdict.decision === 'error', p: verdict.meanP });
        continue;
      }
      const changed = {};
      if (wanted['Agent proposal'] !== col(row, 'agent_proposal', 'Agent proposal')) changed['Agent proposal'] = wanted['Agent proposal'];
      if (!sameNumber(wanted['Agent confidence'], col(row, 'agent_confidence', 'Agent confidence'))) changed['Agent confidence'] = wanted['Agent confidence'];
      if (!sameText(wanted['Why I recommend this'], col(row, 'why_i_recommend_this', 'Why I recommend this'))) changed['Why I recommend this'] = wanted['Why I recommend this'];
      if (!sameText(wanted['Agent full note'], col(row, 'agent_full_note', 'Agent full note'))) changed['Agent full note'] = wanted['Agent full note'];
      if (wanted['Why in queue'] !== null && wanted['Why in queue'] !== existingWhy) changed['Why in queue'] = wanted['Why in queue'];
      if (wanted.Priority !== col(row, 'priority', 'Priority')) changed.Priority = wanted.Priority;
      if (wanted['Rubric version'] !== recordedVersion) changed['Rubric version'] = wanted['Rubric version'];
      if (Object.keys(changed).length) rowUpdates.push({ key, pageId: col(row, 'page_id', 'page_id') ?? null, properties: changed });
    }

    const readiness = readinessOf(states, { polarityOf: (t) => polarity.get(t), fixPolarities, sourceReadingTags: unreadable });
    readinessCounts[readiness]++;
    const wantedClaim = {
      'Agent tags': [...next].sort(compareCodePoints),
      Readiness: readiness,
      'Tag confidence': capLines(lines, maxText),
      'Last judged': `${version} · ${opts.run}`,
    };
    const changedClaim = {};
    if (!sameSet(wantedClaim['Agent tags'], [...currentTags])) changedClaim['Agent tags'] = wantedClaim['Agent tags'].map((name) => ({ rulebook: name }));
    if (wantedClaim.Readiness !== col(claim, 'readiness', 'Readiness')) changedClaim.Readiness = wantedClaim.Readiness;
    if (!sameText(wantedClaim['Tag confidence'], col(claim, 'tag_confidence', 'Tag confidence'))) changedClaim['Tag confidence'] = wantedClaim['Tag confidence'];
    if (wantedClaim['Last judged'] !== text(col(claim, 'last_judged', 'Last judged'))) changedClaim['Last judged'] = wantedClaim['Last judged'];
    if (Object.keys(changedClaim).length) claimOps.push({ key: geoId, pageId: col(claim, 'page_id', 'page_id') ?? null, properties: changedClaim });
    else claimsUnchanged++;
  }

  // --- the weekly cap on new queue rows
  const week = isoWeek(now);
  const stateFile = join(runsDir, 'state', 'queue-week.json');
  let state = { week, keys: [] };
  if (existsSync(stateFile)) {
    try {
      const read = readJson(stateFile);
      if (read.week === week && Array.isArray(read.keys)) state = read;
    } catch {
      state = { week, keys: [] };
    }
  }
  const candidateKeys = new Set(rowCreates.map((c) => c.key));
  const spent = state.keys.filter((k) => !candidateKeys.has(k)).length;
  const budget = Math.max(0, weeklyCap - spent);
  rowCreates.sort((a, b) => a.rank - b.rank || Number(a.isError) - Number(b.isError) || (a.p ?? 2) - (b.p ?? 2) || compareCodePoints(a.key, b.key));
  const creates = rowCreates.slice(0, budget);
  const held = rowCreates.slice(budget);

  // --- the plan
  const outRun = opts.outRun ?? makeRunId('propose', now);
  const outDir = ensureDir(join(runsDir, outRun));
  let plan;
  try {
    plan = await planFactory({ runId: outRun, sourcePull: basename(pullDir), root: agentDir, now: () => now });
  } catch (e) {
    if (e instanceof ExitError) throw e;
    throw new ExitError(EXIT.INVALID, `the plan builder could not be opened on pull ${basename(pullDir)}: ${e.message}`);
  }
  const refused = [];
  const emit = async (database, key, call) => {
    try {
      await call();
      return true;
    } catch (e) {
      refused.push({ database, key, reason: e.message });
      return false;
    }
  };
  let claimsUpdated = 0;
  let rowsUpdated = 0;
  let rowsCreated = 0;
  const guard = { undecided: true }; // a row an editor decides between this pull and the apply is skipped, not overwritten
  for (const op of claimOps) if (await emit('claims', op.key, () => plan.update('claims', op.key, op.pageId, op.properties))) claimsUpdated++;
  for (const op of rowUpdates) if (await emit('tag_decisions', op.key, () => plan.update('tag_decisions', op.key, op.pageId, op.properties, { guard }))) rowsUpdated++;
  const createdKeys = [];
  for (const c of [...creates].sort((a, b) => compareCodePoints(a.key, b.key))) {
    const properties = { Claim: [{ claims: c.geoId }], Tag: [{ rulebook: c.tag }], ...c.properties };
    if (properties['Agent confidence'] === null) delete properties['Agent confidence'];
    const ok = await emit('tag_decisions', c.key, () => plan.create('tag_decisions', c.key, properties, { guard }));
    if (ok) {
      rowsCreated++;
      createdKeys.push(c.key);
    }
  }
  const written = await plan.write();
  const planPath = written?.path ?? join(outDir, 'plan.jsonl');

  if (createdKeys.length) writeJsonAtomic(stateFile, { week, keys: [...new Set([...state.keys, ...createdKeys])].sort(compareCodePoints), updated: now.toISOString() });

  const summary = {
    run_id: outRun,
    judge_run: opts.run,
    pull: opts.pull,
    rubric_version: version,
    runs: n,
    claims_judged: judgments.size,
    claims_updated: claimsUpdated,
    claims_unchanged: claimsUnchanged,
    rows_created: rowsCreated,
    rows_updated: rowsUpdated,
    held_by_cap: held.length,
    weekly_cap: weeklyCap,
    readiness_counts: readinessCounts,
    by_why_in_queue: byWhy,
    created_by_why: createdByWhy,
    kept_by_decision: keptByDecision,
    stale_claims: staleClaims,
    refused,
    created_at: now.toISOString(),
  };
  writeJsonAtomic(join(outDir, 'propose.json'), summary);
  io.out(`propose: claims=${judgments.size} claims_updated=${claimsUpdated} rows_created=${rowsCreated} rows_updated=${rowsUpdated} held_by_cap=${held.length} kept_by_decision=${keptByDecision} readiness=${JSON.stringify(readinessCounts)} plan=${planPath}`);
  if (staleClaims) io.err(`propose: ${staleClaims} claim(s) changed text after they were judged and were left out; judge them again`);
  if (refused.length) {
    io.err(`propose: the plan builder refused ${refused.length} op(s), for example ${refused[0].database} ${refused[0].key}: ${refused[0].reason}`);
    return EXIT.INVALID;
  }
  return EXIT.OK;
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
