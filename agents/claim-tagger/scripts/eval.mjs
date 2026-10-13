#!/usr/bin/env node
// The evaluation harness and the gate of the claim tagger. promote.mjs calls it (as a library or as a process);
// judge.mjs writes the judgment files it reads. Nothing here calls a model, the network or Notion.
//
//   node agents/claim-tagger/scripts/eval.mjs --baseline <config16> --candidate <config16> [--baseline-rubric <path>] \
//        --candidate-rubric <path> [--cases <path>] [--canaries <path>] [--runs 3] [--target <tag>] [--lesson <key>] \
//        [--changed-tags a,b] [--out <dir>] [--smoke]
//   (test hooks: --judgments <dir> reads judgments from another folder, --config <file> reads another config.json)
//
// THE GATE (the research text, with the MVP's numbers from config.json "gate"):
//   A candidate rubric is compared with the current one on the same labelled claims, three runs each, verdicts by
//   majority. It passes only if
//   (1) every active, non-contested canary passes under the candidate;
//   (2) no active gate case that the BASELINE passes fails under the candidate;
//   (3) every tag with at least gate.min_positives labelled positives has a lower bound of the paired change in
//       accuracy (percentile bootstrap over claims) of at least -gate.tolerance. A tag with fewer positives is
//       reported, not gated; when its rules changed (tag_hash differs, or --changed-tags) one negative flip gives
//       HOLD and gate.ungated_flips_fail or more give FAIL;
//   (4) with --target: the target's interval has its upper bound <= 0 -> FAIL, its lower bound <= 0 < upper -> HOLD,
//       lower > 0 -> pass; fewer than gate.min_positives labelled positives -> HOLD;
//   (5) no `apply` under the candidate on a tag the candidate rubric does not judge, or on a human-only tag.
//   FAIL if any condition fails, else HOLD if any holds, else PASS. Every card says "small sample" while a gated tag
//   has fewer than 30 positives. --smoke (one run) computes the same verdict but the card says it is not a gate verdict.
//
// Judgments: <judgments>/<config16>/run-<n>/<item>.<text8>.json, one per item per run (schemas/judgment.schema.json).
// item = a case's geo_id, or canary-<h8> for a canary; text8 = first 8 hex digits of sha256(normaliseText(claim text)),
// h8 is the same value, so a claim whose text was edited since it was judged has no judgment (incomplete), never a stale one.
// (judge.mjs normalises claim text with its own function; files named with its digits are found too.)
// A tag the configuration does not judge has no decision and counts as do_not_apply (it was not written).
// --runs is the number of runs every item must have under a configuration (fewer is incomplete). An item may have MORE: promote.mjs judges a flipped
// case again with extra runs (config.gate.reconfirm_runs), and then the verdict of that item rests on every run file that exists for it (run-1 to
// run-N, N above --runs). The card's per-item records say how many runs each verdict used (runs_used). An extra run that is missing, broken or an
// error is left out, never a gap; a smoke run reads exactly --runs.
//
// Choices where the research skeleton leaves room (see tests/eval.test.mjs for each one):
//   - verdict per tag = the decision more than half of the runs gave, else "undecided"; undecided, ask_editor and cannot_tell
//     are not the expected answer, so they fail a case or a canary;
//   - lesson cases (contested, contested_lesson = --lesson, inactive until the lesson is live) are labelled items for the
//     per-tag numbers, the ungated-flip rule and the target interval, but not for condition 2: that is about active cases;
//   - the target's interval decides first (upper <= 0 FAIL); with too few positives a non-failing target is a HOLD;
//   - a code-decided tag (basis deterministic, e.g. Unsourced) may be applied by code; the model may not apply it;
//   - the ungated-flip rule is part of condition 3; a tag is "changed" when its tag_hash differs, it is newly judged, or it is
//     named with --changed-tags.
//
// Exit codes: 0 PASS, 10 HOLD, 11 FAIL, 2 incomplete or invalid input (no gate verdict), 1 unexpected error.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { EXIT } from './lib/exit-codes.mjs';
import { h16 } from './lib/hash.mjs';
import { readJson, readJsonl, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { agentRoot, isMain, runId, runsDir } from './lib/paths.mjs';
import { checkHashes, normaliseText } from './lib/rubric-build.mjs';
import { exactMcNemar, pairedBootstrapDelta, selfFlipRate } from './lib/stats.mjs';
import { validate } from './lib/validate.mjs';

export const CARD_MD_LIMIT = 1900; // the Runs row's Summary property
export const LARGE_SAMPLE_POSITIVES = 30; // below this many positives on a gated tag the card says "small sample"
const EXEMPT_BASES = new Set(['deterministic']); // code-decided tags (Unsourced) are written by code, not by the model
const USAGE = 'usage: node agents/claim-tagger/scripts/eval.mjs --baseline <config16> --candidate <config16> [--baseline-rubric <path>] --candidate-rubric <path> [--cases <path>] [--canaries <path>] [--runs 3] [--target <tag>] [--lesson <key>] [--changed-tags a,b] [--out <dir>] [--smoke]';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Bad or inconsistent input (exit 2). */
export class InputError extends Error {}
class UsageError extends InputError {} // a bad command line: the usage line is printed with it

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const unique = (list) => [...new Set(list)];
const sum = (list) => list.reduce((a, b) => a + b, 0);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const pts = (x) => {
  const s = (x * 100).toFixed(1);
  return s === '0.0' || s === '-0.0' ? '0.0' : x > 0 ? `+${s}` : s;
};
const idList = (ids, max = 4) => (ids.length <= max ? ids.join(', ') : `${ids.slice(0, max).join(', ')} and ${ids.length - max} more`);
const clip = (s, max) => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - 3))}...`);

// ---- names ---------------------------------------------------------------------------------------------------------

/** First 8 hex digits of sha256 of the normalised text: the canary id suffix and the text part of a judgment file name. */
export function sha8(text) {
  return createHash('sha256').update(normaliseText(text)).digest('hex').slice(0, 8);
}

/** The item id of a canary: canary-<h8>. Canaries with the same text (a tag and its counterpart) share one item. */
export function canaryItemId(text) {
  return `canary-${sha8(text)}`;
}

/** <item>.<text8>.json, the file name of a judgment. */
export function judgmentFileName(id, text) {
  return `${id}.${sha8(text)}.json`;
}

// judge.mjs hashes the claim with its own normaliser (NFC, runs of white space as one space, trimmed). For the usual one-line
// claim both recipes give the same digits; for a text with a double space, a line break, <br> or a decomposed accent they do
// not, so a judgment file is accepted under either name rather than reported missing.
const claimNormalised = (s) => String(s ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
const hex8 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

/** The file names a judgment of this item may have, preferred first: [{ id, name }]. A canary's id carries the same digits as its text8. */
function nameVariants(id, text, canary) {
  return unique([sha8(text), hex8(claimNormalised(text))]).map((digits) => {
    const itemId = canary ? `canary-${digits}` : id;
    return { id: itemId, name: `${itemId}.${digits}.json` };
  });
}

/** The 16 hex digits of a config id; "sha256:abcd..." and "abcd..." both work. It names a folder, so it must be a safe name. */
export function config16Of(value) {
  const s = String(value ?? '').replace(/^sha256:/i, '');
  if (!SAFE_ID.test(s) || s.length > 64) throw new InputError(`"${value}" is not a config id (the 16 hex digits of a config_id)`);
  return s;
}

function safeId(kind, value) {
  if (!SAFE_ID.test(value) || value.length > 128) throw new InputError(`${kind} "${value}" is not a safe name (letters, digits, '.', '_' and '-' only)`);
  return value;
}

// ---- verdicts ------------------------------------------------------------------------------------------------------

/**
 * The verdict of one tag on one item over the runs: the decision that more than half of the runs gave, else
 * "undecided" (a tie, no majority, or any run that errored; an empty list is undecided too).
 */
export function majorityVerdict(decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0 || decisions.includes('error')) return 'undecided';
  const counts = new Map();
  for (const d of decisions) counts.set(d, (counts.get(d) ?? 0) + 1);
  let best = 'undecided';
  let most = 0;
  for (const [d, n] of counts) {
    if (n > most) {
      best = d;
      most = n;
    }
  }
  return most * 2 > decisions.length ? best : 'undecided';
}

// ---- loading -------------------------------------------------------------------------------------------------------

function readJsonFile(path, what) {
  try {
    return readJson(path);
  } catch (e) {
    throw new InputError(`${what}: cannot read ${path} (${(e.cause ?? e).message.split('\n')[0]})`);
  }
}

function loadRows(path, what) {
  if (!existsSync(path)) throw new InputError(`${what}: ${path} does not exist`);
  let result;
  try {
    result = readJsonl(path);
  } catch (e) {
    throw new InputError(`${what}: ${e.message}`);
  }
  if (result.torn) throw new InputError(`${what}: the last line of ${path} is cut short`);
  return result.rows;
}

const loadRubric = (value, what) => (value !== null && typeof value === 'object' ? value : readJsonFile(resolve(value), `${what} rubric`));

/** What the gate needs to know about a rubric: version, hashes, and per tag the judged and human-only flags and the hashes. */
function describeRubric(rubric, label) {
  try {
    if (!rubric || !Array.isArray(rubric.tags)) throw new Error('it has no tags list');
    const check = checkHashes(rubric);
    if (!check.ok) throw new Error(`stored hashes do not match the content (${check.mismatches.slice(0, 3).map((m) => `${m.kind} ${m.where}`).join('; ')})`);
    const tags = new Map();
    for (const t of rubric.tags) {
      tags.set(t.name, {
        judged: t.judged === true,
        humanOnly: t.human_only === true,
        tagHash: t.tag_hash,
        ruleHashes: new Set(t.when_to_use.rules.map((r) => r.rule_hash)),
      });
    }
    return {
      version: rubric.rubric_version,
      hash: rubric.rubric_hash,
      scopeHash: rubric.scope_hash,
      tags,
      judged: new Set([...tags].filter(([, v]) => v.judged).map(([k]) => k)),
    };
  } catch (e) {
    if (e instanceof InputError) throw e;
    throw new InputError(`${label} rubric is not usable: ${e.message}`);
  }
}

/**
 * Which cases the gate looks at. Only suite "gate" counts. gating = active and not contested. lessonCases = contested
 * cases whose contested_lesson is the lesson under test (they stay inactive until the lesson is live; they count as
 * labelled items but not for condition 2). Cases on a source-reading tag are not run at all (notRun).
 */
export function selectCases(rows, { lesson = null, sourceReadingTags = [] } = {}) {
  const sourceReading = new Set(sourceReadingTags);
  const gating = [];
  const lessonCases = [];
  const notRun = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    if ((row.suite ?? 'gate') !== 'gate') return;
    const isLesson = lesson != null && row.contested === true && row.contested_lesson === lesson;
    if (!isLesson && !(row.active === true && row.contested !== true)) return;
    const where = `cases row ${i + 1} (${row.case_id ?? 'no case_id'})`;
    for (const k of ['case_id', 'geo_id', 'tag', 'claim']) if (!isText(row[k])) throw new InputError(`${where}: ${k} is missing`);
    if (row.expected !== 'apply' && row.expected !== 'do_not_apply') throw new InputError(`${where}: expected must be apply or do_not_apply`);
    if (seen.has(row.case_id)) throw new InputError(`cases: case_id ${row.case_id} appears twice`);
    seen.add(row.case_id);
    const c = {
      case_id: row.case_id,
      item: safeId('geo_id', row.geo_id),
      tag: row.tag,
      expected: row.expected,
      text: row.claim,
      rule_ref: row.rule_ref ?? null,
      rule_hash: row.rule_hash ?? null,
      tag_hash: row.tag_hash ?? null,
      lesson: isLesson,
    };
    if (sourceReading.has(c.tag)) notRun.push({ case_id: c.case_id, tag: c.tag, reason: 'source-reading tag: the MVP fetches no source text, so the case is not run', lesson: isLesson });
    else (isLesson ? lessonCases : gating).push(c);
  });
  return { gating, lessonCases, notRun };
}

/** Active, non-contested canaries. */
export function selectCanaries(rows) {
  const out = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    if (!(row.active === true && row.contested !== true)) return;
    const where = `canaries row ${i + 1} (${row.canary_id ?? 'no canary_id'})`;
    for (const k of ['canary_id', 'tag', 'claim']) if (!isText(row[k])) throw new InputError(`${where}: ${k} is missing`);
    if (row.expected !== 'apply' && row.expected !== 'do_not_apply') throw new InputError(`${where}: expected must be apply or do_not_apply`);
    if (seen.has(row.canary_id)) throw new InputError(`canaries: canary_id ${row.canary_id} appears twice`);
    seen.add(row.canary_id);
    out.push({ canary_id: row.canary_id, item: canaryItemId(row.claim), tag: row.tag, expected: row.expected, text: row.claim });
  });
  return out;
}

/** One entry per judgable thing: { id, text, names }. Cases that share a geo_id, and canaries that share a text, share an item. */
function collectItems(cases, canaries) {
  const items = new Map();
  const add = (id, text, label, canary) => {
    const known = items.get(id);
    if (!known) {
      items.set(id, { id, text, names: nameVariants(id, text, canary) });
    } else if (sha8(known.text) !== sha8(text) && claimNormalised(known.text) !== claimNormalised(text)) {
      throw new InputError(`${label}: item ${id} appears with two different claim texts`);
    }
  };
  for (const c of cases) add(c.item, c.text, c.case_id, false);
  for (const c of canaries) add(c.item, c.text, c.canary_id, true);
  return items;
}

let schemas = null;
function loadSchemas() {
  if (!schemas) {
    schemas = {
      judgment: readJson(join(agentRoot(), 'schemas', 'judgment.schema.json')),
      card: readJson(join(agentRoot(), 'schemas', 'card.schema.json')),
    };
  }
  return schemas;
}

/** The run numbers above `runs` that have a folder under a configuration's judgments, ascending. */
function extraRunNumbers(folder, runs) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).map((f) => /^run-([0-9]+)$/.exec(f)).filter(Boolean).map((m) => Number(m[1])).filter((n) => n > runs).sort((a, b) => a - b);
}

/**
 * Reads the judgment files of one configuration: docs.get(item) is one parsed judgment (or null) per REQUIRED run (1..runs), problems.get(item)
 * says why a file is missing, unreadable, invalid or from other claim text. Nothing is guessed: a missing file is never a decision.
 * extras.get(item) are the usable judgments of the runs AFTER the required ones ({ run, doc }, ascending): promote.mjs judges a flipped case again
 * with more runs, and the verdict of that item then rests on all of its runs. Extra runs are optional evidence, never a requirement: one that is
 * missing, unreadable, invalid, made under another configuration or an error is left out. A smoke run reads none (withExtras false).
 */
function loadSide({ dir, config16, runs, items, withExtras = true }) {
  const { judgment: schema } = loadSchemas();
  const docs = new Map();
  const problems = new Map();
  const extras = new Map();
  const rubricHashes = new Set();
  const listings = new Map();
  const listing = (folder) => {
    if (!listings.has(folder)) listings.set(folder, existsSync(folder) ? new Set(readdirSync(folder)) : null);
    return listings.get(folder);
  };
  // reads and checks the file `found` of run n: { doc } or { problem }
  const readCell = (folder, found, n) => {
    let doc;
    try {
      doc = readJson(join(folder, found.name));
    } catch (e) {
      return { problem: `run-${n}: ${found.name} is unreadable (${(e.cause ?? e).message.split('\n')[0]})` };
    }
    const v = validate(schema, doc);
    if (!v.ok) return { problem: `run-${n}: ${found.name} is not a valid judgment (${v.errors[0]})` };
    if (doc.id !== found.id || doc.run !== n) return { problem: `run-${n}: ${found.name} says it is ${doc.id} run ${doc.run}` };
    if (String(doc.config.config_id).replace(/^sha256:/, '') !== config16) return { problem: `run-${n}: ${found.name} was made under configuration ${doc.config.config_id}, not ${config16}` };
    rubricHashes.add(doc.config.rubric_hash);
    return { doc };
  };
  const extraRuns = withExtras ? extraRunNumbers(join(dir, config16), runs) : [];
  for (const item of items.values()) {
    const itemDocs = [];
    const itemProblems = [];
    const preferred = item.names[0].name;
    for (let n = 1; n <= runs; n++) {
      const folder = join(dir, config16, `run-${n}`);
      const present = listing(folder);
      const found = present ? item.names.find((v) => present.has(v.name)) : null;
      let doc = null;
      if (!present) {
        itemProblems.push(`run-${n}: the folder ${config16}/run-${n} does not exist`);
      } else if (!found) {
        const stale = [...present].find((f) => item.names.some((v) => f.startsWith(`${v.id}.`)) && f.endsWith('.json'));
        itemProblems.push(stale ? `run-${n}: ${stale} was judged on other claim text (expected ${preferred})` : `run-${n}: ${preferred} is missing`);
      } else {
        const cell = readCell(folder, found, n);
        if (cell.problem) itemProblems.push(cell.problem);
        else doc = cell.doc;
      }
      itemDocs.push(doc);
    }
    const itemExtras = [];
    for (const n of extraRuns) {
      const folder = join(dir, config16, `run-${n}`);
      const present = listing(folder);
      const found = present ? item.names.find((v) => present.has(v.name)) : null;
      if (!found) continue;
      const cell = readCell(folder, found, n);
      if (cell.doc && cell.doc.status !== 'error') itemExtras.push({ run: n, doc: cell.doc });
    }
    docs.set(item.id, itemDocs);
    problems.set(item.id, itemProblems);
    extras.set(item.id, itemExtras);
  }
  return { config16, runs, docs, problems, extras, rubricHashes };
}

/**
 * The decisions of one tag on one item: { list } or { problems }. list has one entry per required run and then one per usable extra run (the runs
 * promote.mjs added for a flipped case), so list.length is the number of runs the verdict rests on. A run that errored is "error". A tag the
 * configuration does not judge and the file does not mention was not written: do_not_apply. A judged tag with no decision is a gap in a required
 * run; an extra run without one is left out.
 */
function decisionsFor(side, judged, itemId, tag) {
  const problems = [...side.problems.get(itemId)];
  if (problems.length) return { problems };
  const list = [];
  side.docs.get(itemId).forEach((doc, i) => {
    if (doc.status === 'error') {
      list.push('error');
      return;
    }
    const entry = doc.tags.find((t) => t.name === tag);
    if (entry) list.push(entry.decision);
    else if (!judged.has(tag)) list.push('do_not_apply');
    else problems.push(`run-${i + 1}: no decision for ${tag}`);
  });
  if (problems.length) return { problems };
  for (const { doc } of side.extras.get(itemId) ?? []) {
    const entry = doc.tags.find((t) => t.name === tag);
    if (entry) list.push(entry.decision);
    else if (!judged.has(tag)) list.push('do_not_apply');
  }
  return { list };
}

/** Condition 5. An apply on a human-only tag, or on a tag the candidate does not judge unless code decided it (basis deterministic). Extra runs count too. */
function forbiddenWrites(side, items, judged, humanOnly) {
  const hits = [];
  for (const item of items.values()) {
    const runsOfItem = [...side.docs.get(item.id).map((doc, i) => ({ run: i + 1, doc })), ...(side.extras.get(item.id) ?? [])];
    for (const { run, doc } of runsOfItem) {
      if (!doc || doc.status !== 'ok') continue;
      for (const t of doc.tags) {
        if (t.decision !== 'apply') continue;
        if (humanOnly.has(t.name) || (!judged.has(t.name) && !EXEMPT_BASES.has(t.basis))) hits.push(`${item.id}/run-${run}/${t.name}`);
      }
    }
  }
  return hits;
}

// ---- options -------------------------------------------------------------------------------------------------------

function resolveOptions(input) {
  const root = agentRoot();
  const config = input.config !== null && typeof input.config === 'object' ? input.config : readJsonFile(input.config ? resolve(input.config) : join(root, 'config.json'), 'config');
  const g = config.gate;
  if (!g || typeof g !== 'object') throw new InputError('config.json has no "gate" section');
  const want = (key, ok, what) => {
    if (!ok(g[key])) throw new InputError(`config.gate.${key} must be ${what}`);
    return g[key];
  };
  const posInt = (v) => Number.isInteger(v) && v >= 1;
  const gate = {
    tolerance: want('tolerance', (v) => Number.isFinite(v) && v >= 0, 'a number of at least 0'),
    minPositives: want('min_positives', posInt, 'a whole number of at least 1'),
    bootstrap: want('bootstrap', posInt, 'a whole number of at least 1'),
    ci: want('ci', (v) => Array.isArray(v) && v.length === 2 && v[0] > 0 && v[1] < 1 && v[0] < v[1], 'two numbers between 0 and 1, low then high'),
    ungatedHold: want('ungated_flips_hold', posInt, 'a whole number of at least 1'),
    ungatedFail: want('ungated_flips_fail', posInt, 'a whole number of at least 1'),
  };
  if (gate.ungatedHold > gate.ungatedFail) throw new InputError('config.gate.ungated_flips_hold may not exceed ungated_flips_fail');

  const smoke = Boolean(input.smoke);
  const asked = typeof input.runs === 'string' && /^\d+$/.test(input.runs) ? Number(input.runs) : input.runs;
  const runs = smoke ? (config.judge?.smoke_runs ?? 1) : (asked ?? config.judge?.runs ?? 3);
  if (!posInt(runs)) throw new InputError(`--runs must be a whole number of at least 1, got ${runs}`);
  if (input.baseline == null || input.candidate == null) throw new UsageError('--baseline and --candidate are required');
  if (input.candidateRubric == null) throw new UsageError('--candidate-rubric is required');
  const lesson = input.lesson ? String(input.lesson) : null;
  const target = input.target ? String(input.target) : null;
  const out = input.out ? resolve(input.out) : null;
  return {
    config,
    gate,
    smoke,
    runs,
    baseline: config16Of(input.baseline),
    candidate: config16Of(input.candidate),
    baselineRubric: loadRubric(input.baselineRubric ?? join(root, 'rubric', 'rubric.json'), 'baseline'),
    candidateRubric: loadRubric(input.candidateRubric, 'candidate'),
    cases: resolve(input.cases ?? join(root, 'evals', 'cases.jsonl')),
    canaries: resolve(input.canaries ?? join(root, 'evals', 'canaries.jsonl')),
    judgments: resolve(input.judgments ?? join(runsDir(), 'judgments')),
    target,
    lesson,
    changedTags: unique((input.changedTags ?? []).map((t) => String(t).trim()).filter(Boolean)),
    out,
    cardId: input.cardId ?? (out ? basename(out) : runId(smoke ? 'eval-smoke' : 'eval')),
  };
}

// ---- the evaluation ------------------------------------------------------------------------------------------------

const CONDITION_TEXT = {
  1: 'every active canary passes under the candidate',
  2: 'no active case that passes under the baseline fails under the candidate',
  3: 'every gated tag keeps its paired accuracy lower bound within the tolerance; ungated tags with changed rules have no negative flips',
  4: "the target tag's interval is above zero",
  5: 'no apply on a tag the candidate does not judge, or on a human-only tag',
};

function statusOf(...flags) {
  return flags.find(Boolean) ?? 'pass';
}

/**
 * Runs the whole evaluation and returns { verdict, exitCode, card, md, incomplete }. Reads files, writes nothing.
 * input: { baseline, candidate, candidateRubric, baselineRubric?, cases?, canaries?, runs?, target?, lesson?, changedTags?, out?, smoke?, judgments?, config?, cardId?, reconfirmed? }
 * (reconfirmed: the cases that were judged again with extra runs, as { case_id, flip: "broken" | "fixed" } (a plain id means broken); the card then lists them
 * in "reconfirmed" with what each configuration decided over how many runs and whether the flip stayed)
 * (rubrics may be paths or parsed objects). Throws InputError (exit 2) for bad input.
 */
export function evaluate(input = {}) {
  const o = resolveOptions(input);
  const { gate, config } = o;
  const baseInfo = describeRubric(o.baselineRubric, 'baseline');
  const candInfo = describeRubric(o.candidateRubric, 'candidate');
  if (o.target && !candInfo.tags.has(o.target)) throw new InputError(`--target ${o.target} is not a tag of the candidate rubric`);
  for (const t of o.changedTags) if (!candInfo.tags.has(t) && !baseInfo.tags.has(t)) throw new InputError(`--changed-tags: ${t} is not a tag of either rubric`);

  const sourceReadingTags = config.scope?.source_reading_tags ?? [];
  const humanOnly = new Set([...(config.scope?.human_only_tags ?? []), ...[...candInfo.tags].filter(([, v]) => v.humanOnly).map(([k]) => k)]);
  const { gating, lessonCases, notRun } = selectCases(loadRows(o.cases, 'cases'), { lesson: o.lesson, sourceReadingTags });
  const canaries = selectCanaries(loadRows(o.canaries, 'canaries'));
  const items = collectItems([...gating, ...lessonCases], canaries);

  const base = loadSide({ dir: o.judgments, config16: o.baseline, runs: o.runs, items, withExtras: !o.smoke });
  const cand = loadSide({ dir: o.judgments, config16: o.candidate, runs: o.runs, items, withExtras: !o.smoke });
  for (const [label, side, info] of [['baseline', base, baseInfo], ['candidate', cand, candInfo]]) {
    const wrong = [...side.rubricHashes].filter((h) => h !== info.hash);
    if (wrong.length) throw new InputError(`the ${label} judgments (${side.config16}) were made under rubric ${wrong[0]}, but the ${label} rubric file is ${info.hash}: wrong --${label}-rubric or --${label}?`);
  }

  // ---- per item results (an item with any gap, in either configuration, is incomplete and counts nowhere) ----
  const incomplete = [];
  const gaps = (a, b) => [...(a.problems ?? []).map((p) => `baseline ${p}`), ...(b.problems ?? []).map((p) => `candidate ${p}`)];

  const canaryResults = [];
  for (const c of canaries) {
    const b = decisionsFor(base, baseInfo.judged, c.item, c.tag);
    const k = decisionsFor(cand, candInfo.judged, c.item, c.tag);
    if (b.problems || k.problems) {
      incomplete.push({ kind: 'canary', id: c.canary_id, item: c.item, tag: c.tag, problems: gaps(b, k) });
      continue;
    }
    const vb = majorityVerdict(b.list);
    const vc = majorityVerdict(k.list);
    canaryResults.push({ id: c.canary_id, tag: c.tag, expected: c.expected, baseline: vb, candidate: vc, passBase: vb === c.expected, passCand: vc === c.expected });
  }

  const caseResults = [];
  const cells = { baseline: new Map(), candidate: new Map() };
  for (const c of [...gating, ...lessonCases]) {
    const b = decisionsFor(base, baseInfo.judged, c.item, c.tag);
    const k = decisionsFor(cand, candInfo.judged, c.item, c.tag);
    if (b.problems || k.problems) {
      incomplete.push({ kind: 'case', id: c.case_id, item: c.item, tag: c.tag, problems: gaps(b, k) });
      continue;
    }
    const vb = majorityVerdict(b.list);
    const vc = majorityVerdict(k.list);
    const candTag = candInfo.tags.get(c.tag);
    const ruleChanged = c.rule_hash ? !candTag?.ruleHashes.has(c.rule_hash) : c.tag_hash ? candTag?.tagHash !== c.tag_hash : false;
    caseResults.push({
      id: c.case_id, tag: c.tag, expected: c.expected, lesson: c.lesson, baseline: vb, candidate: vc, passBase: vb === c.expected, passCand: vc === c.expected, ruleChanged,
      runsUsed: { baseline: b.list.length, candidate: k.list.length },
    });
    cells.baseline.set(`${c.item}|${c.tag}`, b.list.slice(0, o.runs)); // the noise is measured over the required runs, so extra runs on the borderline items do not inflate it
    cells.candidate.set(`${c.item}|${c.tag}`, k.list.slice(0, o.runs));
  }

  const configs = {
    baseline: { config16: o.baseline, rubric_version: baseInfo.version, rubric_hash: baseInfo.hash, scope_hash: baseInfo.scopeHash },
    candidate: { config16: o.candidate, rubric_version: candInfo.version, rubric_hash: candInfo.hash, scope_hash: candInfo.scopeHash },
  };
  const stats = {
    method: 'paired percentile bootstrap over the labelled claims of a tag (seeded); exact two-sided McNemar test',
    B: gate.bootstrap,
    seed: 'h16(baseline + candidate + tag), the 16 hex digits of each config id',
    ci: gate.ci,
    min_positives: gate.minPositives,
    tolerance: gate.tolerance,
    runs: o.runs,
  };
  const common = {
    card_id: o.cardId,
    kind: o.smoke ? 'smoke' : 'gate',
    lesson: o.lesson,
    target: o.target,
    smoke: o.smoke,
    configs,
    not_run: notRun,
    rollback: o.lesson ? { command: `/claim-tagger promote --rollback ${o.lesson}` } : null,
    stats,
    cost: null,
  };
  const incompleteInfo = { count: incomplete.length, items: incomplete.slice(0, 100) };

  if (incomplete.length && !o.smoke) {
    const first = incomplete[0];
    const reason = `incomplete: ${incomplete.length} gating item(s) have no complete judgments, for example ${first.id} (${first.problems[0]})`;
    const card = {
      ...common,
      verdict: 'n/a',
      small_sample: true,
      conditions: [1, 2, 3, 4, 5].map((n) => ({ n, status: 'not_applicable', detail: 'not evaluated: the judgments are incomplete' })),
      holds: [],
      reasons: [reason],
      not_gated: [],
      canaries: null,
      cases: null,
      per_tag: [],
      noise: null,
      incomplete: incompleteInfo,
    };
    return finish(card, EXIT.INVALID, incomplete);
  }

  // ---- cases that promote.mjs judged again with extra runs (input.reconfirmed): what each configuration decided over how many runs, and whether the flip stayed ----
  // An entry is { case_id, flip: 'broken' | 'fixed' } (a plain id means 'broken'). A broken flip (passed under the baseline, failed under the candidate) is
  // confirmed while it still is one, a fixed flip (failed under the baseline, passes under the candidate) while it still is one; otherwise it was noise.
  let reconfirmed = null;
  if (Array.isArray(input.reconfirmed) && input.reconfirmed.length) {
    const byId = new Map(caseResults.map((r) => [r.id, r]));
    reconfirmed = [];
    for (const entry of input.reconfirmed) {
      const id = typeof entry === 'string' ? entry : entry?.case_id;
      const flip = typeof entry === 'string' ? 'broken' : (entry?.flip ?? 'broken');
      if (flip !== 'broken' && flip !== 'fixed') throw new InputError(`reconfirmed: ${id}: flip must be "broken" or "fixed", got "${flip}"`);
      const r = byId.get(id);
      if (!r) throw new InputError(`reconfirmed: ${id} is not an evaluated case`);
      if (reconfirmed.some((x) => x.case_id === id)) continue;
      const stays = flip === 'broken' ? r.passBase && !r.passCand : !r.passBase && r.passCand;
      reconfirmed.push({
        case_id: id,
        tag: r.tag,
        flip,
        baseline: { runs: r.runsUsed.baseline, decision: r.baseline },
        candidate: { runs: r.runsUsed.candidate, decision: r.candidate },
        outcome: stays ? 'confirmed' : 'noise',
      });
    }
  }

  // ---- 1. canaries ----
  const canaryOf = (passKey) => {
    const failing = canaryResults.filter((r) => !r[passKey]).map((r) => r.id);
    return { active: canaryResults.length, passed: canaryResults.length - failing.length, failing };
  };
  const canaryReport = { baseline: canaryOf('passBase'), candidate: canaryOf('passCand') };

  // ---- 2. cases (condition 2 looks at the active ones; lesson cases are labelled items, judged by the target's interval) ----
  const activeResults = caseResults.filter((r) => !r.lesson);
  const lessonResults = caseResults.filter((r) => r.lesson);
  const newlyFailing = activeResults.filter((r) => r.passBase && !r.passCand).map((r) => r.id);
  const newlyPassing = activeResults.filter((r) => !r.passBase && r.passCand).map((r) => r.id);
  const casesReport = {
    gating: activeResults.map((r) => r.id), // the cases condition 2 looks at: active, not contested, not on a source-reading tag
    passing_baseline: activeResults.filter((r) => r.passBase).length,
    passing_candidate: activeResults.filter((r) => r.passCand).length,
    newly_failing: newlyFailing,
    newly_passing: newlyPassing,
    rule_changed: caseResults.filter((r) => r.ruleChanged).map((r) => r.id),
    lesson: o.lesson
      ? {
          key: o.lesson,
          cases: lessonResults.map((r) => r.id),
          fixed: lessonResults.filter((r) => !r.passBase && r.passCand).map((r) => r.id),
          broken: lessonResults.filter((r) => r.passBase && !r.passCand).map((r) => r.id),
        }
      : null,
    items: caseResults.map((r) => ({
      case_id: r.id,
      tag: r.tag,
      expected: r.expected,
      baseline: r.baseline,
      candidate: r.candidate,
      runs_used: r.runsUsed,
      ...(r.lesson ? { lesson: true } : {}),
      ...(r.ruleChanged ? { rule_changed: true } : {}),
    })),
  };

  // ---- 3. per tag over the labelled items ----
  const byTag = new Map();
  for (const r of caseResults) {
    if (!byTag.has(r.tag)) byTag.set(r.tag, []);
    byTag.get(r.tag).push(r);
  }
  const perTag = [...byTag.keys()].sort(cmp).map((tag) => {
    const rows = byTag.get(tag).slice().sort((a, b) => cmp(a.id, b.id));
    const n = rows.length;
    const positives = rows.filter((r) => r.expected === 'apply').length;
    const seed = h16(`${o.baseline}${o.candidate}${tag}`);
    const boot = pairedBootstrapDelta(rows.map((r) => +r.passBase), rows.map((r) => +r.passCand), { B: gate.bootstrap, seed, ci: gate.ci });
    const fixed = rows.filter((r) => !r.passBase && r.passCand).map((r) => r.id);
    const broken = rows.filter((r) => r.passBase && !r.passCand).map((r) => r.id);
    return {
      tag,
      n,
      positives,
      acc_base: sum(rows.map((r) => +r.passBase)) / n,
      acc_cand: sum(rows.map((r) => +r.passCand)) / n,
      delta: boot.delta,
      ci: [boot.lo, boot.hi],
      fixed,
      broken,
      mcnemar_p: exactMcNemar(broken.length, fixed.length),
      gated: positives >= gate.minPositives,
      lesson_cases: rows.filter((r) => r.lesson).length,
      seed,
    };
  });
  if (o.target && !perTag.some((t) => t.tag === o.target)) {
    perTag.push({ tag: o.target, n: 0, positives: 0, acc_base: null, acc_cand: null, delta: null, ci: null, fixed: [], broken: [], mcnemar_p: null, gated: false, lesson_cases: 0, seed: null });
  }

  const changed = new Set(o.changedTags);
  for (const [name, c] of candInfo.tags) {
    const b = baseInfo.tags.get(name);
    if (!b || b.tagHash !== c.tagHash || (c.judged && !b.judged)) changed.add(name);
  }

  // ---- the five conditions ----
  const reasons = [];
  const holds = [];
  const conditions = [];
  const add = (n, status, detail) => conditions.push({ n, status, detail: `${CONDITION_TEXT[n]}: ${detail}` });

  // 1
  const cc = canaryReport.candidate;
  if (cc.active === 0) add(1, 'not_applicable', 'no active canary was evaluated');
  else if (cc.failing.length) {
    reasons.push(`${cc.failing.length} canaries fail: ${idList(cc.failing, 5)}`);
    add(1, 'fail', `${cc.passed} of ${cc.active} pass; failing ${idList(cc.failing, 5)}`);
  } else add(1, 'pass', `${cc.passed} of ${cc.active} pass`);

  // 2
  if (activeResults.length === 0) add(2, 'not_applicable', 'no active case was evaluated');
  else if (newlyFailing.length) {
    reasons.push(`${newlyFailing.length} regression cases newly failing: ${idList(newlyFailing, 5)}`);
    add(2, 'fail', `${newlyFailing.length} of ${activeResults.length} newly failing (${idList(newlyFailing, 5)}); ${casesReport.passing_baseline} pass under the baseline`);
  } else add(2, 'pass', `0 of ${activeResults.length} newly failing; ${casesReport.passing_baseline} pass under the baseline, ${casesReport.passing_candidate} under the candidate`);

  // 3 (gated tags, then the ungated rule)
  const gatedRows = perTag.filter((t) => t.gated);
  const below = gatedRows.filter((t) => t.ci[0] < -gate.tolerance);
  for (const t of below) reasons.push(`${t.tag}: accuracy lower bound ${pts(t.ci[0])} points (tolerance -${(gate.tolerance * 100).toFixed(1)})`);
  const ungatedChanged = perTag.filter((t) => !t.gated && t.n > 0 && changed.has(t.tag));
  let ungatedFail = false;
  let ungatedHold = false;
  for (const t of ungatedChanged) {
    const flips = t.broken.length;
    if (flips >= gate.ungatedFail) {
      ungatedFail = true;
      reasons.push(`${t.tag} (not gated): ${flips} negative flips after a rule change: ${idList(t.broken, 5)}`);
    } else if (flips >= gate.ungatedHold) {
      ungatedHold = true;
      holds.push(`${t.tag} (not gated): negative flip${flips === 1 ? '' : 's'} ${idList(t.broken, 5)} after a rule change`);
    }
  }
  if (gatedRows.length + ungatedChanged.length === 0) add(3, 'not_applicable', 'no tag has labelled items to compare');
  else {
    const status3 = statusOf(below.length > 0 || ungatedFail ? 'fail' : null, ungatedHold ? 'hold' : null);
    const lowest = gatedRows.length ? gatedRows.reduce((a, b) => (b.ci[0] < a.ci[0] ? b : a)) : null;
    add(
      3,
      status3,
      `${gatedRows.length} gated tag(s)${lowest ? `, lowest lower bound ${pts(lowest.ci[0])} points (${lowest.tag}), tolerance -${(gate.tolerance * 100).toFixed(1)}` : ''}; ${ungatedChanged.length} ungated tag(s) with changed rules, ${sum(ungatedChanged.map((t) => t.broken.length))} negative flip(s)`,
    );
  }

  // 4
  if (!o.target) add(4, 'not_applicable', 'no target tag was named');
  else {
    const targetRow = perTag.find((t) => t.tag === o.target);
    if (targetRow.n === 0) {
      holds.push(`${o.target}: too few labelled positives (0 labelled items; at least ${gate.minPositives} positives needed)`);
      add(4, 'hold', `${o.target} has no labelled items`);
    } else if (targetRow.ci[1] <= 0) {
      reasons.push(`${o.target}: no improvement (upper bound ${pts(targetRow.ci[1])} points)`);
      add(4, 'fail', `${o.target} interval ${pts(targetRow.ci[0])} to ${pts(targetRow.ci[1])} points: no improvement`);
    } else if (targetRow.positives < gate.minPositives) {
      holds.push(`${o.target}: too few labelled positives (${targetRow.positives}; at least ${gate.minPositives} needed)`);
      add(4, 'hold', `${o.target} has ${targetRow.positives} labelled positives, fewer than ${gate.minPositives}`);
    } else if (targetRow.ci[0] <= 0) {
      holds.push(`${o.target}: interval straddles zero (${pts(targetRow.ci[0])} to ${pts(targetRow.ci[1])} points); more labels needed`);
      add(4, 'hold', `${o.target} interval ${pts(targetRow.ci[0])} to ${pts(targetRow.ci[1])} points straddles zero`);
    } else add(4, 'pass', `${o.target} interval ${pts(targetRow.ci[0])} to ${pts(targetRow.ci[1])} points is above zero`);
  }

  // 5
  const forbidden = forbiddenWrites(cand, items, candInfo.judged, humanOnly);
  if (forbidden.length) {
    reasons.push(`${forbidden.length} writes on tags the agent must never write: ${idList(forbidden, 5)}`);
    add(5, 'fail', `${forbidden.length} apply decision(s): ${idList(forbidden, 5)}`);
  } else if (items.size === 0) add(5, 'not_applicable', 'no judgment was read');
  else add(5, 'pass', 'none');

  // ---- verdict ----
  if (!conditions.some((c) => c.n <= 3 && c.status !== 'not_applicable')) holds.push('nothing was evaluated: no canary, case or tag had complete judgments');
  const verdict = conditions.some((c) => c.status === 'fail') ? 'FAIL' : conditions.some((c) => c.status === 'hold') || holds.length ? 'HOLD' : 'PASS';

  // ---- noise ----
  const rate = (map) => (o.runs < 2 || map.size === 0 ? null : selfFlipRate(map));
  const noise = { cells: cells.baseline.size, runs: o.runs, baseline: rate(cells.baseline), candidate: rate(cells.candidate) };

  const smallSample = !(gatedRows.length > 0 && gatedRows.every((t) => t.positives >= LARGE_SAMPLE_POSITIVES));
  const card = {
    ...common,
    verdict,
    small_sample: smallSample,
    conditions,
    holds,
    reasons,
    not_gated: perTag.filter((t) => !t.gated && t.n > 0).map((t) => `${t.tag} (${t.positives} positives of ${t.n})`),
    canaries: canaryReport,
    cases: casesReport,
    per_tag: perTag,
    noise,
    ...(reconfirmed ? { reconfirmed } : {}),
    ...(incomplete.length ? { incomplete: incompleteInfo } : {}),
  };
  return finish(card, verdict === 'PASS' ? EXIT.OK : verdict === 'HOLD' ? EXIT.HOLD : EXIT.FAIL, incomplete);
}

function finish(card, exitCode, incomplete) {
  const checked = validate(loadSchemas().card, card);
  if (!checked.ok) throw new Error(`eval: the card does not match card.schema.json (${checked.errors.slice(0, 3).join('; ')})`);
  return { verdict: card.verdict, exitCode, card, md: renderCardMd(card), incomplete };
}

// ---- card.md -------------------------------------------------------------------------------------------------------

/**
 * The card as plain text for the Runs row (at most CARD_MD_LIMIT characters, ASCII). The lines that matter most (verdict,
 * canaries, cases, target, rollback) are kept; the rest is dropped from the bottom up when space runs out.
 */
export function renderCardMd(card) {
  const lines = [];
  const add = (text, prio = 0) => lines.push({ text: prio === 0 ? clip(text, 240) : clip(text, 200), prio });
  const small = `small sample: a gated tag has under ${LARGE_SAMPLE_POSITIVES} labelled positives, read the numbers and not only the word`;

  const incomplete = card.incomplete;
  const gaps = (n) => `${n} gating item${n === 1 ? '' : 's'}`;
  if (card.verdict === 'n/a') {
    add(`Verdict: n/a - no gate verdict${card.smoke ? ' (smoke)' : ''}: the judgments are incomplete`);
    const first = incomplete?.items?.[0];
    add(`Incomplete: ${gaps(incomplete?.count ?? 0)} without complete judgments${first ? `, for example ${first.id} (${first.problems[0]})` : ''}`);
  } else {
    // One plain-words line first, for editors (the rest of the card is for the engineer and the rule owner).
    const worse = unique([...(card.cases?.newly_failing ?? []).map((id) => (card.cases?.items ?? []).find((i) => i.case_id === id)?.tag).filter(Boolean), ...card.per_tag.filter((t) => t.broken.length).map((t) => t.tag)]);
    if (card.verdict === 'PASS') add(`For editors: the change is live; the rows behind it are re-checked and marked Fixed or Still wrong.`);
    else if (card.verdict === 'HOLD') add(`For editors: nothing changed; the gate needs more decided examples${card.target ? ` on ${card.target}` : ''} before it can tell whether the change helps.`);
    else add(`For editors: nothing changed; the change would make ${worse.length ? worse.join(' and ') : 'another tag'} worse on claims you already decided, so the rule owner can reword or reject it.`);
    add(`Verdict: ${card.verdict}${card.smoke ? ' - smoke: not a gate verdict' : ''}${card.small_sample ? ` - ${small}` : ''}`);
    const c = card.canaries.candidate;
    const b = card.canaries.baseline;
    add(`Canaries: ${c.passed}/${c.active} pass under the candidate${c.failing.length ? ` (failing: ${idList(c.failing, 3)})` : ''}; baseline ${b.passed}/${b.active}`);
    const k = card.cases;
    add(`Cases newly failing: ${k.newly_failing.length}${k.newly_failing.length ? ` (${idList(k.newly_failing, 3)})` : ''} of ${k.gating.length} active; newly passing ${k.newly_passing.length}; rule changed ${k.rule_changed.length}`);
    const target = card.target ? card.per_tag.find((t) => t.tag === card.target) : null;
    if (card.target && target && target.n > 0) {
      add(`Target ${card.target}: ${pts(target.delta)} points (95% CI ${pts(target.ci[0])} to ${pts(target.ci[1])}), fixed ${target.fixed.length}, broken ${target.broken.length}, n ${target.n}, ${target.positives} positives`);
    } else if (card.target) add(`Target ${card.target}: no labelled items`);
    for (const t of card.per_tag.filter((x) => x.gated && x.tag !== card.target)) {
      add(`${t.tag}: ${pct(t.acc_base)} -> ${pct(t.acc_cand)} (${pts(t.delta)} points, CI ${pts(t.ci[0])} to ${pts(t.ci[1])}), fixed ${t.fixed.length}, broken ${t.broken.length}, n ${t.n}`, 2);
    }
    card.reasons.forEach((r) => add(`FAIL: ${r}`, 1));
    card.holds.forEach((h) => add(`HOLD: ${h}`, 1));
    if (card.reconfirmed?.length) {
      const expectedOf = new Map((card.cases?.items ?? []).map((i) => [i.case_id, i.expected]));
      for (const r of card.reconfirmed) {
        const how = `${r.flip ?? 'broken'} flip ${r.outcome === 'noise' ? 'was noise' : 'confirmed'}`;
        add(`Reconfirmed ${r.case_id} (${r.tag}, expected ${expectedOf.get(r.case_id) ?? 'n/a'}): baseline ${r.baseline.decision} over ${r.baseline.runs} runs, candidate ${r.candidate.decision} over ${r.candidate.runs} runs: ${how}`, 1);
      }
    }
    if (card.not_gated.length) add(`Not gated (under ${card.stats.min_positives} positives): ${card.not_gated.join('; ')}`, 3);
    if (incomplete) add(`Incomplete: ${gaps(incomplete.count)} left out for missing judgments`, 3);
  }
  if (card.not_run.length) add(`Not run: ${card.not_run.length} cases on source-reading tags (${unique(card.not_run.map((r) => r.tag)).join(', ')})`, 3);
  add(`Baseline ${card.configs.baseline.config16} (rubric ${card.configs.baseline.rubric_version}) vs candidate ${card.configs.candidate.config16} (rubric ${card.configs.candidate.rubric_version}), ${card.stats.runs} run(s)`, 4);
  if (card.rollback) add(`Rollback: ${card.rollback.command}`);

  const render = (ls, omitted) => `${[...ls.map((l) => l.text), ...(omitted ? [`(${omitted} more line(s) in card.json)`] : [])].join('\n')}\n`;
  let kept = lines.slice();
  let omitted = 0;
  while (render(kept, omitted).length > CARD_MD_LIMIT) {
    const worst = Math.max(...kept.map((l) => l.prio));
    if (worst === 0) break;
    kept.splice(kept.map((l) => l.prio).lastIndexOf(worst), 1);
    omitted++;
  }
  let text = render(kept, omitted);
  if (text.length > CARD_MD_LIMIT) text = `${text.slice(0, CARD_MD_LIMIT - 4)}...\n`;
  return text;
}

// ---- output --------------------------------------------------------------------------------------------------------

/** The one line the CLI prints. */
export function summaryLine(result, cardPath) {
  const { card } = result;
  const tail = `card ${cardPath}`;
  if (card.verdict === 'n/a') {
    const first = card.incomplete.items[0];
    return `eval: INCOMPLETE ${card.incomplete.count} gating item(s) lack complete judgments, for example ${first.id}: ${first.problems[0]} | ${tail}`;
  }
  const parts = [`eval: ${card.verdict}${card.smoke ? ' (smoke: not a gate verdict)' : ''}${card.small_sample ? ' (small sample)' : ''}`];
  if (card.canaries) parts.push(`canaries ${card.canaries.candidate.passed}/${card.canaries.candidate.active}`);
  if (card.cases) parts.push(`cases newly failing ${card.cases.newly_failing.length}`);
  const t = card.target ? card.per_tag.find((x) => x.tag === card.target) : null;
  if (t && t.n > 0) parts.push(`${t.tag} ${pts(t.delta)} points (CI ${pts(t.ci[0])} to ${pts(t.ci[1])}) fixed ${t.fixed.length} broken ${t.broken.length}`);
  const why = [...card.reasons.map((r) => `FAIL ${r}`), ...card.holds.map((h) => `HOLD ${h}`)];
  if (why.length) parts.push(clip(why.join('; '), 300));
  parts.push(tail);
  return parts.join(' | ');
}

/** Writes card.json and card.md into dir (default: runs/<card_id>/); returns the paths. */
export function writeCard(result, dir) {
  const target = resolve(dir ?? join(runsDir(), result.card.card_id));
  const json = join(target, 'card.json');
  const md = join(target, 'card.md');
  writeJsonAtomic(json, result.card);
  writeTextAtomic(md, result.md);
  return { dir: target, json, md };
}

// ---- command line --------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { help: false, smoke: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--baseline': opts.baseline = value(); break;
      case '--candidate': opts.candidate = value(); break;
      case '--baseline-rubric': opts.baselineRubric = resolve(value()); break;
      case '--candidate-rubric': opts.candidateRubric = resolve(value()); break;
      case '--cases': opts.cases = resolve(value()); break;
      case '--canaries': opts.canaries = resolve(value()); break;
      case '--runs': {
        const v = value();
        if (!/^\d+$/.test(v)) throw new UsageError(`--runs needs a whole number, got "${v}"`);
        opts.runs = Number(v);
        break;
      }
      case '--target': opts.target = value(); break;
      case '--lesson': opts.lesson = value(); break;
      case '--changed-tags': opts.changedTags = value().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--out': opts.out = resolve(value()); break;
      case '--smoke': opts.smoke = true; break;
      case '--judgments': opts.judgments = resolve(value()); break;
      case '--config': opts.config = resolve(value()); break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new UsageError(`unknown argument ${arg}`);
    }
  }
  return opts;
}

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Run the script; returns the exit code. io = { out, err } (one line to out on success). */
export function main(argv, io = defaultIo) {
  try {
    const opts = parseArgs(argv);
    if (opts.help) {
      io.out(USAGE);
      return EXIT.OK;
    }
    const result = evaluate(opts);
    const paths = writeCard(result, opts.out);
    io.out(summaryLine(result, paths.json));
    return result.exitCode;
  } catch (e) {
    if (e instanceof InputError) {
      io.err(`eval: ${e.message}${e instanceof UsageError ? `\n${USAGE}` : ''}`);
      return EXIT.INVALID;
    }
    io.err(`eval: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
