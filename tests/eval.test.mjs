import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CARD_MD_LIMIT, InputError, canaryItemId, config16Of, evaluate, judgmentFileName, main, majorityVerdict, renderCardMd, selectCanaries, selectCases, sha8, summaryLine, writeCard,
} from '../agents/claim-tagger/scripts/eval.mjs';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { h16 } from '../agents/claim-tagger/scripts/lib/hash.mjs';
import { readJson } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { agentRoot } from '../agents/claim-tagger/scripts/lib/paths.mjs';
import { applyLesson, buildRubric, checkHashes, normaliseText } from '../agents/claim-tagger/scripts/lib/rubric-build.mjs';
import { pairedBootstrapDelta } from '../agents/claim-tagger/scripts/lib/stats.mjs';
import { validate } from '../agents/claim-tagger/scripts/lib/validate.mjs';

const SCRIPT = fileURLToPath(new URL('../agents/claim-tagger/scripts/eval.mjs', import.meta.url));
const FIX = fileURLToPath(new URL('./fixtures/eval/', import.meta.url));
const REAL = (...p) => join(agentRoot(), ...p);
const config = readJson(REAL('config.json'));
const cardSchema = readJson(REAL('schemas', 'card.schema.json'));
const judgmentSchema = readJson(REAL('schemas', 'judgment.schema.json'));

const BASE = 'aaaaaaaaaaaaaaaa'; // two config16 ids; the fixtures write three runs under each
const CAND = 'bbbbbbbbbbbbbbbb';
const RUNS = 3;
const NEW_RULE = 'Fires on an unconditional forecast marker: will, is expected to, is projected to. Hedged tendencies (is likely to, is on track to) are not Predictive.';
const OPPOSITE = { apply: 'do_not_apply', do_not_apply: 'apply' };

const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-eval-'));
  roots.push(dir);
  return dir;
}
const rows = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const fixtureRows = (name) => rows(join(FIX, name));
const toJsonl = (list) => `${list.map((r) => JSON.stringify(r)).join('\n')}\n`;

// ---- the synthetic world: rubrics, items and judgment files ----

function fixtureRubrics() {
  const baseline = buildRubric(readJson(join(FIX, 'rubric-rows.json')), { version: '2026-10-13.1' });
  const candidate = applyLesson(baseline, { tag: 'Predictive', kind: 'Change the rule', ruleN: 1, newText: NEW_RULE, lessonId: 'L-1' }, { version: '2026-10-13.2' });
  return { baseline, candidate };
}

const entry = (name, decision, basis = 'model') => ({
  name,
  decision,
  p: decision === 'apply' ? 0.9 : decision === 'do_not_apply' ? 0.1 : null,
  rule_ref: `${name} rule 1`,
  rule_hash: null,
  trigger: null,
  reason: 'synthetic',
  basis,
});

/** One judgable item per geo_id or canary text, with the labelled rows (cases and canaries) that depend on it. */
function buildItems(caseRows, canaryRows, lesson) {
  const sel = selectCases(caseRows, { lesson, sourceReadingTags: config.scope.source_reading_tags });
  const items = new Map();
  const put = (item, text, row) => {
    if (!items.has(item)) items.set(item, { id: item, text, rows: [] });
    items.get(item).rows.push(row);
  };
  for (const c of [...sel.gating, ...sel.lessonCases]) put(c.item, c.text, { id: c.case_id, tag: c.tag, expected: c.expected });
  for (const c of selectCanaries(canaryRows)) put(c.item, c.text, { id: c.canary_id, tag: c.tag, expected: c.expected });
  return items;
}

/**
 * Writes the judgment files of one configuration, runs 1..runs. Every judged tag of the rubric gets a decision: the expected
 * one for the tag a row labels, else do_not_apply.
 *   wrong: row ids judged the opposite way in every run;   perRun: row id -> one decision per run
 *   extra: item id -> more tag entries in every run;       skip / errors: "<item>#<run>" files left out / written with status error
 */
function writeSide({ dir, config16, rubric, items, runs = RUNS, wrong = [], perRun = {}, extra = {}, skip = [], errors = [] }) {
  const judged = rubric.tags.filter((t) => t.judged).map((t) => t.name);
  for (const item of items.values()) {
    for (let run = 1; run <= runs; run++) {
      const key = `${item.id}#${run}`;
      if (skip.includes(key)) continue;
      const failed = errors.includes(key);
      const tags = judged.map((name) => {
        const row = item.rows.find((r) => r.tag === name);
        if (!row) return entry(name, 'do_not_apply');
        let decision = wrong.includes(row.id) ? OPPOSITE[row.expected] : row.expected;
        if (perRun[row.id]) decision = perRun[row.id][run - 1] ?? decision;
        return entry(name, decision);
      });
      for (const e of extra[item.id] ?? []) tags.push(entry(e.name, e.decision, e.basis));
      const doc = {
        id: item.id,
        run,
        text_hash: h16(normaliseText(item.text)),
        status: failed ? 'error' : 'ok',
        ...(failed ? { error: 'synthetic error' } : {}),
        tags: failed ? [] : tags,
        config: {
          driver: 'fake', model: 'fake-model', effort: null, rubric_version: rubric.rubric_version, rubric_hash: rubric.rubric_hash,
          scope_hash: rubric.scope_hash, prompt_version: 'sha256:0000000000000000', cli_version: null, config_id: `sha256:${config16}`,
        },
      };
      const file = join(dir, 'judgments', config16, `run-${run}`, judgmentFileName(item.id, item.text));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(doc));
    }
  }
}

const PASS_BASE = { wrong: ['p-les-1', 'p-les-2', 'p-les-3', 'p-act-1'] }; // the baseline misses the lesson's cases and one slip

/** Fabricates the folder layout for BASE and CAND (three runs each) and returns the options to evaluate it. */
function scenario(spec = {}) {
  const {
    caseRows = fixtureRows('cases.jsonl'), canaryRows = fixtureRows('canaries.jsonl'), lesson = 'L-1', base = PASS_BASE, cand = {},
    baselineRubric, candidateRubric, casesOnDisk = caseRows, ids = [BASE, CAND], ...extraOpts
  } = spec;
  const dir = tmp();
  const rubrics = fixtureRubrics();
  const bR = baselineRubric ?? rubrics.baseline;
  const cR = candidateRubric ?? rubrics.candidate;
  const items = buildItems(caseRows, canaryRows, lesson);
  writeSide({ dir, config16: ids[0], rubric: bR, items, ...base });
  writeSide({ dir, config16: ids[1], rubric: cR, items, ...cand });
  const paths = {
    dir,
    cases: join(dir, 'cases.jsonl'),
    canaries: join(dir, 'canaries.jsonl'),
    baselineRubric: join(dir, 'baseline.rubric.json'),
    candidateRubric: join(dir, 'candidate.rubric.json'),
    judgments: join(dir, 'judgments'),
  };
  writeFileSync(paths.cases, toJsonl(casesOnDisk));
  writeFileSync(paths.canaries, toJsonl(canaryRows));
  writeFileSync(paths.baselineRubric, JSON.stringify(bR));
  writeFileSync(paths.candidateRubric, JSON.stringify(cR));
  const opts = {
    baseline: ids[0], candidate: ids[1], baselineRubric: bR, candidateRubric: cR, cases: paths.cases, canaries: paths.canaries,
    judgments: paths.judgments, lesson, target: 'Predictive', cardId: 'test-card', ...extraOpts,
  };
  return { dir, items, paths, opts, run: (more = {}) => evaluate({ ...opts, ...more }) };
}

const cond = (result) => result.card.conditions.map((c) => c.status);
const tagRow = (result, tag) => result.card.per_tag.find((t) => t.tag === tag);
function assertCardSound(result) {
  assert.deepEqual(validate(cardSchema, result.card), { ok: true, errors: [] });
  assert.ok(result.md.length <= CARD_MD_LIMIT, `card.md has ${result.md.length} characters`);
  assert.deepEqual(result.card.conditions.map((c) => c.n), [1, 2, 3, 4, 5]);
}

// ---- contracts: names, fixtures, config ----

test('the fixtures assume the gate numbers of config.json (a change there must be a decision, not an accident)', () => {
  assert.equal(config.gate.min_positives, 5);
  assert.equal(config.gate.tolerance, 0.05);
  assert.equal(config.gate.bootstrap, 1000);
  assert.deepEqual(config.gate.ci, [0.025, 0.975]);
  assert.equal(config.gate.ungated_flips_hold, 1);
  assert.equal(config.gate.ungated_flips_fail, 3);
  assert.equal(config.gate.reconfirm_runs, 5);
  assert.deepEqual(config.scope.source_reading_tags, ['Improperly sourced', 'Source inaccessible']);
  assert.deepEqual(config.scope.human_only_tags, ['Editor verified']);
});

test('item ids and file names: the first 8 hex digits of sha256 of the normalised text', () => {
  const text = 'He  said\r\nit works.  ';
  const expected = createHash('sha256').update(normaliseText(text)).digest('hex').slice(0, 8);
  assert.equal(sha8(text), expected);
  assert.match(sha8(text), /^[0-9a-f]{8}$/);
  assert.equal(canaryItemId(text), `canary-${expected}`);
  assert.equal(judgmentFileName('g-1', text), `g-1.${expected}.json`);
  assert.equal(sha8('Same text'), sha8('Same text \n'), 'normalisation ignores trailing white space');
  assert.notEqual(sha8('Same text'), sha8('Same texts'));
  const canaries = selectCanaries(fixtureRows('canaries.jsonl'));
  const byId = Object.fromEntries(canaries.map((c) => [c.canary_id, c.item]));
  assert.equal(byId['can-hyp-1'], byId['can-hyp-1-not-pred'], 'a tag and its counterpart share one judgment');
  assert.notEqual(byId['can-hyp-1'], byId['can-pred-1']);
  assert.match(byId['can-ctx-1'], /^canary-[0-9a-f]{8}$/);
});

test('config16Of accepts the bare digits or the sha256: form and refuses anything that is not a safe folder name', () => {
  assert.equal(config16Of('0123456789abcdef'), '0123456789abcdef');
  assert.equal(config16Of('sha256:0123456789abcdef'), '0123456789abcdef');
  for (const bad of ['', '..', 'a/b', 'a\\b', 'a:b', '../x', 'a b', undefined]) assert.throws(() => config16Of(bad), InputError, String(bad));
});

test('the fixture rubrics are consistent and the hashes written into the fixture cases are the baseline rubric hashes', () => {
  const { baseline, candidate } = fixtureRubrics();
  assert.deepEqual(checkHashes(baseline), { ok: true, mismatches: [] });
  assert.deepEqual(checkHashes(candidate), { ok: true, mismatches: [] });
  assert.deepEqual(baseline.scope, ['Context-dependent', 'Hypothetical', 'Predictive', 'Source inaccessible']);
  const changed = baseline.tags.filter((t, i) => t.tag_hash !== candidate.tags[i].tag_hash).map((t) => t.name);
  assert.deepEqual(changed, ['Predictive'], 'the lesson changes exactly one tag');
  const cases = Object.fromEntries(fixtureRows('cases.jsonl').map((c) => [c.case_id, c]));
  assert.equal(cases['p-act-1'].rule_hash, baseline.tags.find((t) => t.name === 'Predictive').when_to_use.rules[0].rule_hash);
  assert.equal(cases['p-act-1'].tag_hash, baseline.tags.find((t) => t.name === 'Predictive').tag_hash);
  assert.equal(cases['c-act-1'].tag_hash, baseline.tags.find((t) => t.name === 'Context-dependent').tag_hash);
});

test('the example judgment is valid under judgment.schema.json and its file name is item.text8.json', () => {
  const doc = readJson(join(FIX, 'judgment.example.json'));
  const text = 'Synthetic claim P1: sales will double next year.';
  assert.deepEqual(validate(judgmentSchema, doc), { ok: true, errors: [] });
  assert.equal(doc.text_hash, h16(normaliseText(text)), 'text_hash is h16 of the normalised text');
  assert.equal(judgmentFileName(doc.id, text), `g-pred-1.${doc.text_hash.replace('sha256:', '').slice(0, 8)}.json`, 'text8 is the first 8 digits of text_hash');
  const { baseline } = fixtureRubrics();
  assert.equal(doc.config.rubric_hash, baseline.rubric_hash);
  assert.equal(doc.config.scope_hash, baseline.scope_hash);
  assert.equal(doc.tags.find((t) => t.name === 'Predictive').rule_hash, baseline.tags.find((t) => t.name === 'Predictive').when_to_use.rules[0].rule_hash);
});

// ---- verdict by majority ----

test('majorityVerdict: more than half of the runs, else undecided; any error run, a tie or no runs is undecided', () => {
  assert.equal(majorityVerdict(['apply', 'apply', 'apply']), 'apply');
  assert.equal(majorityVerdict(['apply', 'do_not_apply', 'apply']), 'apply');
  assert.equal(majorityVerdict(['do_not_apply', 'apply', 'do_not_apply']), 'do_not_apply');
  assert.equal(majorityVerdict(['cannot_tell', 'cannot_tell', 'apply']), 'cannot_tell');
  assert.equal(majorityVerdict(['ask_editor', 'ask_editor', 'do_not_apply']), 'ask_editor');
  assert.equal(majorityVerdict(['apply', 'do_not_apply', 'cannot_tell']), 'undecided', '1/1/1 has no majority');
  assert.equal(majorityVerdict(['apply', 'do_not_apply']), 'undecided', 'a tie of two runs');
  assert.equal(majorityVerdict(['apply', 'apply', 'do_not_apply', 'do_not_apply']), 'undecided', 'a tie of four runs');
  assert.equal(majorityVerdict(['apply', 'apply', 'do_not_apply', 'cannot_tell']), 'undecided', 'a plurality is not a majority');
  assert.equal(majorityVerdict(['apply', 'error', 'apply']), 'undecided', 'one run that errored spoils the item');
  assert.equal(majorityVerdict(['apply']), 'apply', 'a smoke run has one run');
  assert.equal(majorityVerdict([]), 'undecided');
});

// ---- selecting what the gate looks at ----

test('selectCases: gate suite, active and not contested; lesson cases only for the named lesson; source-reading tags are not run', () => {
  const all = fixtureRows('cases.jsonl');
  const sourceReadingTags = config.scope.source_reading_tags;
  const none = selectCases(all, { sourceReadingTags });
  assert.deepEqual(none.gating.map((c) => c.case_id), ['p-act-1', 'p-act-2', 'p-act-3', 'p-act-4', 'p-act-5', 'h-act-1', 'h-act-2', 'h-act-3', 'h-act-4', 'h-act-5', 'h-act-6', 'c-act-1', 'c-act-2', 'c-act-3', 'c-act-4']);
  assert.deepEqual(none.lessonCases, []);
  assert.deepEqual(none.notRun.map((c) => c.case_id), ['s-act-1', 's-act-2']);
  assert.match(none.notRun[0].reason, /source/);

  const l1 = selectCases(all, { lesson: 'L-1', sourceReadingTags });
  assert.deepEqual(l1.gating.map((c) => c.case_id), none.gating.map((c) => c.case_id), 'the lesson does not change the active set');
  assert.deepEqual(l1.lessonCases.map((c) => c.case_id), ['p-les-1', 'p-les-2', 'p-les-3', 'h-les-1', 'h-les-2', 'c-les-1', 'c-les-2', 'c-les-3']);
  assert.ok(l1.lessonCases.every((c) => c.lesson === true));
  assert.deepEqual(l1.notRun.map((c) => c.case_id), ['s-act-1', 's-act-2', 's-les-1']);

  const l9 = selectCases(all, { lesson: 'L-9', sourceReadingTags });
  assert.deepEqual(l9.lessonCases.map((c) => c.case_id), ['p-other-lesson-1']);
  // never selected: inactive, the mirror-freshness suite, contested cases of another lesson
  const everything = [...l1.gating, ...l1.lessonCases].map((c) => c.case_id);
  for (const id of ['p-inactive-1', 'p-mirror-1', 'p-other-lesson-1']) assert.ok(!everything.includes(id), id);
});

test('selectCases and selectCanaries refuse rows they cannot use', () => {
  const ok = fixtureRows('cases.jsonl')[0];
  assert.throws(() => selectCases([{ ...ok, expected: 'maybe' }]), InputError);
  assert.throws(() => selectCases([{ ...ok, claim: '' }]), InputError);
  assert.throws(() => selectCases([{ ...ok, geo_id: '../x' }]), /safe name/);
  assert.throws(() => selectCases([{ ...ok, geo_id: 'a:b' }]), /safe name/);
  assert.throws(() => selectCases([ok, ok]), /appears twice/);
  const canary = fixtureRows('canaries.jsonl')[0];
  assert.throws(() => selectCanaries([{ ...canary, expected: undefined }]), InputError);
  assert.throws(() => selectCanaries([canary, canary]), /appears twice/);
  assert.equal(selectCanaries([{ ...canary, active: false }]).length, 0);
  assert.equal(selectCanaries([{ ...canary, contested: true }]).length, 0);
});

// ---- the verdict matrix ----

test('PASS: the target gains 4 fixed and 0 broken on 8 labelled claims, every canary passes', () => {
  const result = scenario().run();
  assertCardSound(result);
  const { card } = result;
  assert.equal(card.verdict, 'PASS');
  assert.equal(result.exitCode, EXIT.OK);
  assert.deepEqual(cond(result), ['pass', 'pass', 'pass', 'pass', 'pass']);
  assert.deepEqual(card.reasons, []);
  assert.deepEqual(card.holds, []);
  assert.equal(card.small_sample, true);
  assert.equal(card.smoke, false);
  assert.equal(card.kind, 'gate');
  assert.equal(card.target, 'Predictive');
  assert.equal(card.lesson, 'L-1');
  assert.equal(card.cost, null);

  const target = tagRow(result, 'Predictive');
  assert.equal(target.n, 8);
  assert.equal(target.positives, 5);
  assert.equal(target.gated, true);
  assert.equal(target.acc_base, 0.5);
  assert.equal(target.acc_cand, 1);
  assert.equal(target.delta, 0.5);
  assert.deepEqual(target.fixed, ['p-act-1', 'p-les-1', 'p-les-2', 'p-les-3']);
  assert.deepEqual(target.broken, []);
  assert.equal(target.mcnemar_p, 0.125);
  assert.ok(target.ci[0] > 0 && target.ci[1] >= target.ci[0], `ci ${target.ci}`);
  assert.equal(target.lesson_cases, 3);

  assert.deepEqual(card.canaries.candidate, { active: 6, passed: 6, failing: [] });
  assert.deepEqual(card.canaries.baseline, { active: 6, passed: 6, failing: [] });
  assert.equal(card.cases.gating.length, 15);
  assert.deepEqual(card.cases.gating.slice(0, 2), ['p-act-1', 'p-act-2']);
  assert.deepEqual(card.cases.newly_failing, []);
  assert.deepEqual(card.cases.newly_passing, ['p-act-1']);
  assert.deepEqual(card.cases.lesson, { key: 'L-1', cases: ['p-les-1', 'p-les-2', 'p-les-3', 'h-les-1', 'h-les-2', 'c-les-1', 'c-les-2', 'c-les-3'], fixed: ['p-les-1', 'p-les-2', 'p-les-3'], broken: [] });
  assert.deepEqual(card.rollback, { command: '/claim-tagger promote --rollback L-1' });
  assert.equal(card.configs.baseline.config16, BASE);
  assert.equal(card.configs.baseline.rubric_version, '2026-10-13.1');
  assert.match(card.configs.baseline.rubric_hash, /^sha256:[0-9a-f]{16}$/);
  assert.equal(card.configs.candidate.config16, CAND);
  assert.equal(card.configs.candidate.rubric_version, '2026-10-13.2');
  assert.notEqual(card.configs.baseline.rubric_hash, card.configs.candidate.rubric_hash);
  const { baseline: b, candidate: c } = fixtureRubrics();
  assert.equal(card.configs.baseline.rubric_hash, b.rubric_hash);
  assert.equal(card.configs.candidate.rubric_hash, c.rubric_hash);
  assert.deepEqual([card.stats.B, card.stats.min_positives, card.stats.tolerance, card.stats.runs], [1000, 5, 0.05, 3]);
  assert.match(card.stats.method, /bootstrap/);
});

test('PASS card.md: verdict with the small-sample label, canaries, cases, target, gated tags, rollback, at most 1,900 characters', () => {
  const { md } = scenario().run();
  const lines = md.trimEnd().split('\n');
  assert.equal(lines[0], 'For editors: the change is live; the rows behind it are re-checked and marked Fixed or Still wrong.', 'the plain-words opener for editors comes first');
  assert.match(lines[1], /^Verdict: PASS - .*small sample/);
  assert.ok(lines.some((l) => l.startsWith('Canaries: 6/6 pass under the candidate; baseline 6/6')));
  assert.ok(lines.some((l) => l.startsWith('Cases newly failing: 0 of 15 active; newly passing 1')));
  const target = lines.find((l) => l.startsWith('Target Predictive:'));
  assert.match(target, /\+50\.0 points \(95% CI \+\d+\.\d to \+\d+\.\d\), fixed 4, broken 0, n 8, 5 positives/);
  assert.ok(lines.some((l) => l.startsWith('Hypothetical: 100.0% -> 100.0% (0.0 points, CI 0.0 to 0.0), fixed 0, broken 0, n 8')));
  assert.ok(lines.some((l) => l.startsWith('Not gated (under 5 positives): Context-dependent (3 positives of 7)')));
  assert.ok(lines.some((l) => l.startsWith('Not run: 3 cases on source-reading tags (Source inaccessible)')));
  assert.equal(lines.at(-1), 'Rollback: /claim-tagger promote --rollback L-1');
  assert.ok(md.length <= CARD_MD_LIMIT);
  assert.match(md, /^[\x09\x0a\x20-\x7e]*$/, 'plain ASCII');
});

test('HOLD: the target interval touches zero (2 fixed, 0 broken on 8 labelled claims)', () => {
  const result = scenario({ base: { wrong: ['p-les-1', 'p-les-2'] } }).run();
  assertCardSound(result);
  assert.equal(result.card.verdict, 'HOLD');
  assert.equal(result.exitCode, EXIT.HOLD);
  assert.deepEqual(cond(result), ['pass', 'pass', 'pass', 'hold', 'pass']);
  const target = tagRow(result, 'Predictive');
  assert.equal(target.fixed.length, 2);
  assert.equal(target.ci[0], 0);
  assert.ok(target.ci[1] > 0);
  assert.equal(result.card.holds.length, 1);
  assert.match(result.card.holds[0], /^Predictive: interval straddles zero/);
  assert.deepEqual(result.card.reasons, []);
});

test('HOLD: 2 fixed and 1 broken on 60 labelled claims straddles zero without breaching the tolerance', () => {
  const cases = [];
  for (let i = 1; i <= 57; i++) cases.push({ case_id: `bp-${i}`, geo_id: `g-bp-${i}`, claim: `Synthetic bulk claim ${i}: the figure will rise.`, tag: 'Predictive', expected: 'apply', contested: false, suite: 'gate', active: true });
  for (let i = 1; i <= 3; i++) cases.push({ case_id: `bl-${i}`, geo_id: `g-bl-${i}`, claim: `Synthetic bulk lesson claim ${i}: the figure is likely to rise.`, tag: 'Predictive', expected: 'do_not_apply', contested: true, contested_lesson: 'L-1', suite: 'gate', active: false });
  const result = scenario({ caseRows: cases, base: { wrong: ['bl-1', 'bl-2'] }, cand: { wrong: ['bl-3'] } }).run();
  assertCardSound(result);
  const target = tagRow(result, 'Predictive');
  assert.equal(target.n, 60);
  assert.deepEqual(target.fixed, ['bl-1', 'bl-2']);
  assert.deepEqual(target.broken, ['bl-3']);
  assert.ok(target.ci[0] >= -0.05 && target.ci[0] <= 0 && target.ci[1] > 0, `ci ${target.ci}`);
  assert.equal(result.card.verdict, 'HOLD');
  assert.deepEqual(cond(result), ['pass', 'pass', 'pass', 'hold', 'pass']);
  assert.equal(target.mcnemar_p, 1);
});

test('HOLD: one negative flip on an ungated tag whose rules changed (named with --changed-tags)', () => {
  const result = scenario({ cand: { wrong: ['c-les-1'] }, changedTags: ['Context-dependent'] }).run();
  assertCardSound(result);
  assert.equal(result.card.verdict, 'HOLD');
  assert.equal(result.exitCode, EXIT.HOLD);
  assert.deepEqual(cond(result), ['pass', 'pass', 'hold', 'pass', 'pass']);
  assert.equal(result.card.holds.length, 1);
  assert.match(result.card.holds[0], /^Context-dependent \(not gated\): negative flip c-les-1/);
  assert.deepEqual(result.card.reasons, []);
  assert.deepEqual(tagRow(result, 'Context-dependent').broken, ['c-les-1']);
  assert.equal(tagRow(result, 'Context-dependent').gated, false);
  assert.equal(result.card.cases.newly_failing.length, 0, 'a lesson case is not an active case');
});

test('HOLD: the same flip when the tag_hash differs between the rubrics (no --changed-tags needed); an unchanged tag is not guarded', () => {
  const { baseline, candidate } = fixtureRubrics();
  const candidate2 = applyLesson(candidate, { tag: 'Context-dependent', ruleN: 1, newText: 'Fires on a pronoun with no antecedent in the claim.' }, { version: '2026-10-13.3' });
  const changed = scenario({ cand: { wrong: ['c-les-1'] }, candidateRubric: candidate2 }).run();
  assert.equal(changed.card.verdict, 'HOLD');
  assert.match(changed.card.holds[0], /^Context-dependent \(not gated\)/);
  const unchanged = scenario({ cand: { wrong: ['c-les-1'] } }).run();
  assert.equal(unchanged.card.verdict, 'PASS', 'no rule of that tag changed, so the flip is only reported');
  assert.deepEqual(tagRow(unchanged, 'Context-dependent').broken, ['c-les-1']);
  assert.equal(baseline.tags.find((t) => t.name === 'Context-dependent').tag_hash === candidate.tags.find((t) => t.name === 'Context-dependent').tag_hash, true);
});

test('a tag that is newly in scope counts as changed even though its tag_hash is the same', () => {
  const { baseline, candidate } = fixtureRubrics();
  // the baseline does not judge Context-dependent (it writes nothing for it), the candidate does
  const rows2 = readJson(join(FIX, 'rubric-rows.json')).map((r) => (r.name === 'Context-dependent' ? { ...r, judged: false } : r));
  const notJudged = buildRubric(rows2, { version: '2026-10-13.1' });
  const hashOf = (rubric) => rubric.tags.find((t) => t.name === 'Context-dependent').tag_hash;
  assert.equal(hashOf(notJudged), hashOf(baseline), 'the judged flag is not part of the tag hash');
  assert.equal(hashOf(notJudged), hashOf(candidate));
  const result = scenario({ baselineRubric: notJudged, candidateRubric: candidate, cand: { wrong: ['c-les-1'] } }).run();
  assert.deepEqual(tagRow(result, 'Context-dependent').broken, ['c-les-1'], 'right by default under the baseline, wrong under the candidate');
  assert.equal(result.card.verdict, 'HOLD', 'a negative flip on a tag that is newly in scope gives HOLD');
  assert.match(result.card.holds.join(' '), /Context-dependent \(not gated\)/);
});

test('FAIL: three negative flips on an ungated changed tag; two are still only a HOLD', () => {
  const three = scenario({ cand: { wrong: ['c-les-1', 'c-les-2', 'c-les-3'] }, changedTags: ['Context-dependent'] }).run();
  assertCardSound(three);
  assert.equal(three.card.verdict, 'FAIL');
  assert.equal(three.exitCode, EXIT.FAIL);
  assert.deepEqual(cond(three), ['pass', 'pass', 'fail', 'pass', 'pass']);
  assert.match(three.card.reasons[0], /^Context-dependent \(not gated\): 3 negative flips after a rule change: c-les-1, c-les-2, c-les-3/);
  const two = scenario({ cand: { wrong: ['c-les-1', 'c-les-2'] }, changedTags: ['Context-dependent'] }).run();
  assert.equal(two.card.verdict, 'HOLD');
  assert.equal(two.exitCode, EXIT.HOLD);
});

test('FAIL: a canary that fails under the candidate', () => {
  const result = scenario({ cand: { wrong: ['can-ctx-2'] } }).run();
  assertCardSound(result);
  assert.equal(result.card.verdict, 'FAIL');
  assert.equal(result.exitCode, EXIT.FAIL);
  assert.deepEqual(cond(result), ['fail', 'pass', 'pass', 'pass', 'pass']);
  assert.deepEqual(result.card.canaries.candidate, { active: 6, passed: 5, failing: ['can-ctx-2'] });
  assert.deepEqual(result.card.canaries.baseline.failing, []);
  assert.equal(result.card.reasons[0], '1 canaries fail: can-ctx-2');
});

test('FAIL: a case that the baseline passes and the candidate fails (newly failing)', () => {
  const result = scenario({ cand: { wrong: ['c-act-1'] } }).run();
  assertCardSound(result);
  assert.equal(result.card.verdict, 'FAIL');
  assert.deepEqual(cond(result), ['pass', 'fail', 'pass', 'pass', 'pass']);
  assert.deepEqual(result.card.cases.newly_failing, ['c-act-1']);
  assert.match(result.card.reasons[0], /^1 regression cases newly failing: c-act-1/);
  assert.match(result.md, /Cases newly failing: 1 \(c-act-1\)/);
});

test('"currently passing" is defined under the baseline: a case that fails under both is not newly failing', () => {
  const result = scenario({
    base: { wrong: [...PASS_BASE.wrong, 'c-act-1', 'c-act-3'] },
    cand: { wrong: ['c-act-1', 'c-act-2'] },
  }).run();
  // c-act-1 wrong under both: not newly failing. c-act-2 right then wrong: newly failing. c-act-3 wrong then right: newly passing.
  assert.deepEqual(result.card.cases.newly_failing, ['c-act-2']);
  assert.deepEqual(result.card.cases.newly_passing, ['p-act-1', 'c-act-3']);
  assert.equal(result.card.verdict, 'FAIL');
  const items = Object.fromEntries(result.card.cases.items.map((i) => [i.case_id, i]));
  assert.equal(items['c-act-1'].baseline, 'do_not_apply');
  assert.equal(items['c-act-1'].candidate, 'do_not_apply');
  assert.equal(items['c-act-1'].expected, 'apply');
  // the same candidate with only the shared failure has nothing newly failing
  const shared = scenario({ base: { wrong: [...PASS_BASE.wrong, 'c-act-1'] }, cand: { wrong: ['c-act-1'] } }).run();
  assert.deepEqual(shared.card.cases.newly_failing, []);
  assert.equal(shared.card.verdict, 'PASS');
});

test('FAIL: a forbidden write, an apply on the human-only tag', () => {
  const cand = { extra: { 'g-pred-2': [{ name: 'Editor verified', decision: 'apply', basis: 'model' }] } };
  const result = scenario({ cand }).run();
  assertCardSound(result);
  assert.equal(result.card.verdict, 'FAIL');
  assert.equal(result.exitCode, EXIT.FAIL);
  assert.deepEqual(cond(result), ['pass', 'pass', 'pass', 'pass', 'fail']);
  assert.match(result.card.reasons[0], /^3 writes on tags the agent must never write: g-pred-2\/run-1\/Editor verified, g-pred-2\/run-2\/Editor verified/);
  // an editor-verified decision that is not an apply is no write; the baseline is not checked
  const quiet = scenario({ cand: { extra: { 'g-pred-2': [{ name: 'Editor verified', decision: 'do_not_apply' }] } }, base: { ...PASS_BASE, extra: { 'g-pred-2': [{ name: 'Editor verified', decision: 'apply' }] } } }).run();
  assert.equal(quiet.card.verdict, 'PASS');
});

test('forbidden writes: any apply on a tag the candidate does not judge, unless code decided it; human-only is forbidden whoever wrote it', () => {
  const on = (extra) => scenario({ cand: { extra: { 'g-hyp-1': extra } } }).run();
  assert.equal(on([{ name: 'Unsourced', decision: 'apply', basis: 'model' }]).card.verdict, 'FAIL', 'the model must not write the computed tag');
  assert.equal(on([{ name: 'Unsourced', decision: 'apply', basis: 'deterministic' }]).card.verdict, 'PASS', 'code may write the computed tag');
  assert.equal(on([{ name: 'Unsourced', decision: 'do_not_apply', basis: 'model' }]).card.verdict, 'PASS');
  assert.equal(on([{ name: 'Editor verified', decision: 'apply', basis: 'deterministic' }]).card.verdict, 'FAIL', 'nobody but an editor writes the human-only tag');
  assert.equal(on([{ name: 'Not in the rubric', decision: 'apply', basis: 'model' }]).card.verdict, 'FAIL');
  assert.equal(on([{ name: 'Source inaccessible', decision: 'apply', basis: 'no_source_text' }]).card.verdict, 'PASS', 'a judged tag is not forbidden');
  // the guard reads every item, canaries included, in every run
  const canaryItem = [...scenario().items.values()].find((i) => i.rows.some((r) => r.id === 'can-ctx-1')).id;
  const late = scenario({ cand: { extra: { [canaryItem]: [{ name: 'Editor verified', decision: 'apply' }] } } }).run();
  assert.equal(late.card.verdict, 'FAIL');
  assert.match(late.card.reasons[0], new RegExp(`${canaryItem}/run-1/Editor verified`));
});

test('FAIL: a gated tag whose lower bound falls below -5 points (broken lesson cases are not active cases)', () => {
  const result = scenario({ cand: { wrong: ['h-les-1', 'h-les-2'] } }).run();
  assertCardSound(result);
  assert.equal(result.card.verdict, 'FAIL');
  assert.equal(result.exitCode, EXIT.FAIL);
  assert.deepEqual(cond(result), ['pass', 'pass', 'fail', 'pass', 'pass']);
  const h = tagRow(result, 'Hypothetical');
  assert.equal(h.gated, true);
  assert.deepEqual(h.broken, ['h-les-1', 'h-les-2']);
  assert.ok(h.ci[0] < -0.05, `lower bound ${h.ci[0]}`);
  assert.match(result.card.reasons[0], /^Hypothetical: accuracy lower bound -\d+\.\d points \(tolerance -5\.0\)/);
  assert.equal(result.card.cases.newly_failing.length, 0);
  // the same breakage on active cases is caught twice
  const active = scenario({ cand: { wrong: ['h-act-1', 'h-act-2'] } }).run();
  assert.deepEqual(cond(active), ['pass', 'fail', 'fail', 'pass', 'pass']);
});

test('the tolerance is a boundary: a lower bound of exactly -5 points passes, 5.3 points below fails', () => {
  // n labelled claims of one gated tag, all expected apply; the first four (by id) are fixed, the fifth is broken, the rest are right
  // in both. The bootstrap is seeded, so these two sizes give the bounds -1/20 (= -5.0 points, equal to the tolerance) and -1/19.
  const world = (n) => {
    const cases = [];
    for (let i = 1; i <= n; i++) {
      const id = `hb-${String(i).padStart(2, '0')}`;
      const lesson = i <= 5; // the broken one must not be an active case, or condition 2 would fail first
      cases.push({ case_id: id, geo_id: `g-${id}`, claim: `Synthetic claim ${id}: a recount could flip result ${i}.`, tag: 'Hypothetical', expected: 'apply', contested: lesson, ...(lesson ? { contested_lesson: 'L-1' } : {}), suite: 'gate', active: !lesson });
    }
    return scenario({ caseRows: cases, target: null, base: { wrong: ['hb-01', 'hb-02', 'hb-03', 'hb-04'] }, cand: { wrong: ['hb-05'] } }).run();
  };
  const exact = world(20);
  const h20 = tagRow(exact, 'Hypothetical');
  assert.equal(h20.n, 20);
  assert.deepEqual(h20.fixed, ['hb-01', 'hb-02', 'hb-03', 'hb-04']);
  assert.deepEqual(h20.broken, ['hb-05']);
  assert.equal(h20.ci[0], -0.05);
  assert.equal(exact.card.conditions[2].status, 'pass', 'a lower bound equal to the tolerance is within it');
  assert.equal(exact.card.verdict, 'PASS');
  const over = world(19);
  const h19 = tagRow(over, 'Hypothetical');
  assert.equal(h19.ci[0], -1 / 19);
  assert.equal(over.card.conditions[2].status, 'fail');
  assert.equal(over.card.verdict, 'FAIL');
  assert.match(over.card.reasons[0], /^Hypothetical: accuracy lower bound -5\.3 points \(tolerance -5\.0\)/);
});

test('FAIL: the target does not improve (upper bound at or below zero)', () => {
  const same = scenario({ base: {} }).run();
  assert.equal(same.card.verdict, 'FAIL');
  assert.deepEqual(cond(same), ['pass', 'pass', 'pass', 'fail', 'pass']);
  assert.match(same.card.reasons[0], /^Predictive: no improvement \(upper bound 0\.0 points\)/);
  const worse = scenario({ base: {}, cand: { wrong: ['p-les-1'] } }).run();
  assert.equal(worse.card.verdict, 'FAIL');
  assert.deepEqual(tagRow(worse, 'Predictive').broken, ['p-les-1']);
});

test('the target with fewer than min_positives labelled positives is a HOLD, "too few labelled positives"', () => {
  // without the lesson the target keeps its 5 positives; drop two of them and it has 3
  const cases = fixtureRows('cases.jsonl').filter((c) => !['p-act-4', 'p-act-5'].includes(c.case_id));
  const result = scenario({ caseRows: cases }).run();
  const target = tagRow(result, 'Predictive');
  assert.equal(target.positives, 3);
  assert.equal(target.gated, false);
  assert.ok(target.ci[0] > 0, 'the interval itself is above zero');
  assert.equal(result.card.verdict, 'HOLD');
  assert.deepEqual(cond(result), ['pass', 'pass', 'pass', 'hold', 'pass']);
  assert.match(result.card.holds[0], /^Predictive: too few labelled positives \(3; at least 5 needed\)/);
  assert.ok(result.card.not_gated.includes('Predictive (3 positives of 6)'));
  // a clear loss is still a FAIL, not a HOLD
  const loss = scenario({ caseRows: cases, base: {}, cand: { wrong: ['p-les-1'] } }).run();
  assert.equal(loss.card.verdict, 'FAIL');
  // a target with nothing labelled at all
  const empty = scenario({ target: 'Hypothetical', caseRows: fixtureRows('cases.jsonl').filter((c) => c.tag !== 'Hypothetical') }).run();
  assert.equal(empty.card.verdict, 'HOLD');
  assert.match(empty.card.holds[0], /^Hypothetical: too few labelled positives \(0 labelled items/);
  assert.equal(tagRow(empty, 'Hypothetical').n, 0);
  assert.deepEqual(validate(cardSchema, empty.card), { ok: true, errors: [] });
});

test('without --target condition 4 is not applicable and the verdict rests on the other four', () => {
  const result = scenario({ target: null, lesson: null }).run();
  assert.equal(result.card.conditions[3].status, 'not_applicable');
  assert.equal(result.card.target, null);
  assert.equal(result.card.lesson, null);
  assert.equal(result.card.rollback, null);
  assert.equal(result.card.verdict, 'PASS');
  assert.ok(!/Rollback/.test(result.md));
  assert.ok(!/Target/.test(result.md));
});

// ---- cases: lesson cases, source-reading tags, rule fingerprints ----

test('lesson cases join the target set; without --lesson only the active cases are labelled', () => {
  const withLesson = scenario().run();
  const t = tagRow(withLesson, 'Predictive');
  assert.equal(t.n, 8);
  assert.equal(t.lesson_cases, 3);
  assert.ok(t.fixed.includes('p-les-2'));
  // another lesson key selects other cases (here: none that matter), and the target is down to its active cases
  const other = scenario({ lesson: 'L-1' }).run({ lesson: 'L-2' });
  assert.equal(tagRow(other, 'Predictive').n, 5);
  assert.deepEqual(other.card.cases.lesson.cases, []);
  assert.deepEqual(other.card.cases.lesson.fixed, []);
  // judgments exist only for what the lesson needs, so asking for L-9 finds its one case without judgments
  const missing = scenario({ lesson: 'L-1' }).run({ lesson: 'L-9' });
  assert.equal(missing.exitCode, EXIT.INVALID);
  assert.equal(missing.card.incomplete.items[0].id, 'p-other-lesson-1');
});

test('cases on source-reading tags are not_run: listed, never counted, and no judgments are needed for them', () => {
  const s = scenario();
  const result = s.run();
  assert.deepEqual(result.card.not_run.map((r) => r.case_id), ['s-act-1', 's-act-2', 's-les-1']);
  assert.ok(result.card.not_run.every((r) => r.tag === 'Source inaccessible' && /source/.test(r.reason)));
  assert.ok(!s.items.has('g-src-1') && !s.items.has('g-src-2'), 'the fixture wrote no judgments for them');
  assert.equal(result.card.verdict, 'PASS');
  assert.equal(result.card.per_tag.some((t) => t.tag === 'Source inaccessible'), false);
  assert.equal(result.card.cases.items.some((i) => i.tag === 'Source inaccessible'), false);
  assert.equal(result.card.incomplete, undefined);
  assert.equal(result.card.cases.gating.length, 15);
});

test('cases whose rule fingerprint differs in the candidate are flagged rule_changed and still counted', () => {
  const result = scenario().run();
  // p-act-1 cites Predictive rule 1, which the lesson rewrote; c-act-1 cites only the Context-dependent tag hash, which is unchanged
  assert.deepEqual(result.card.cases.rule_changed, ['p-act-1']);
  const item = result.card.cases.items.find((i) => i.case_id === 'p-act-1');
  assert.equal(item.rule_changed, true);
  assert.equal(result.card.cases.items.find((i) => i.case_id === 'c-act-1').rule_changed, undefined);
  assert.ok(tagRow(result, 'Predictive').n === 8, 'still counted');
  assert.match(result.md, /rule changed 1/);
  // a tag hash that no longer matches flags the cases that cite only the tag
  const { candidate } = fixtureRubrics();
  const c2 = applyLesson(candidate, { tag: 'Context-dependent', ruleN: 1, newText: 'Fires on a pronoun with no antecedent in the claim.' }, { version: '2026-10-13.3' });
  const both = scenario({ candidateRubric: c2 }).run();
  assert.deepEqual(both.card.cases.rule_changed, ['p-act-1', 'c-act-1']);
  // identical rubrics flag nothing
  const { baseline } = fixtureRubrics();
  const none = scenario({ candidateRubric: baseline, base: {} }).run();
  assert.deepEqual(none.card.cases.rule_changed, []);
  // a rule hash that is not in the candidate at all
  const edited = fixtureRows('cases.jsonl').map((c) => (c.case_id === 'h-act-1' ? { ...c, rule_hash: 'sha256:0000000000000000' } : c));
  assert.ok(scenario({ caseRows: edited }).run().card.cases.rule_changed.includes('h-act-1'));
});

// ---- incomplete input ----

test('incomplete: a missing judgment file gives exit 2 and no verdict, and says which file', () => {
  const result = scenario({ cand: { skip: ['g-ctx-2#2'] } }).run();
  assert.equal(result.exitCode, EXIT.INVALID);
  assert.equal(result.verdict, 'n/a');
  assert.equal(result.card.verdict, 'n/a');
  assert.deepEqual(validate(cardSchema, result.card), { ok: true, errors: [] });
  assert.equal(result.card.incomplete.count, 1);
  const first = result.card.incomplete.items[0];
  assert.equal(first.id, 'c-act-2');
  assert.equal(first.kind, 'case');
  assert.match(first.problems[0], /^candidate run-2: g-ctx-2\.[0-9a-f]{8}\.json is missing$/);
  assert.ok(result.card.conditions.every((c) => c.status === 'not_applicable'));
  assert.ok(result.md.startsWith('Verdict: n/a'));
  assert.ok(result.md.length <= CARD_MD_LIMIT);
  assert.deepEqual(result.card.per_tag, []);
  assert.match(summaryLine(result, 'X/card.json'), /^eval: INCOMPLETE 1 gating item\(s\) lack complete judgments, for example c-act-2: candidate run-2: .* \| card X\/card\.json$/);
});

test('incomplete: a baseline gap counts too, a canary gap counts, and a configuration that was never judged is all gaps', () => {
  const baseGap = scenario({ base: { ...PASS_BASE, skip: ['g-hyp-3#1'] } }).run();
  assert.equal(baseGap.exitCode, EXIT.INVALID);
  assert.match(baseGap.card.incomplete.items[0].problems[0], /^baseline run-1: /);
  const canaryItem = [...scenario().items.values()].find((i) => i.rows.some((r) => r.id === 'can-ctx-2')).id;
  const canaryGap = scenario({ cand: { skip: [`${canaryItem}#3`] } }).run();
  assert.equal(canaryGap.exitCode, EXIT.INVALID);
  assert.equal(canaryGap.card.incomplete.items[0].kind, 'canary');
  assert.equal(canaryGap.card.incomplete.items[0].id, 'can-ctx-2');
  const never = scenario().run({ candidate: 'cccccccccccccccc' });
  assert.equal(never.exitCode, EXIT.INVALID);
  assert.match(never.card.incomplete.items[0].problems[0], /the folder cccccccccccccccc\/run-1 does not exist/);
  assert.equal(never.card.incomplete.count, 15 + 8 + 6, 'every gating case, lesson case and active canary');
});

test('incomplete: fewer runs than asked for is a gap, never "two of two"', () => {
  const s = scenario({ cand: { runs: 2 } });
  const result = s.run();
  assert.equal(result.exitCode, EXIT.INVALID);
  assert.match(result.card.incomplete.items[0].problems.join(' '), /candidate run-3: the folder bbbbbbbbbbbbbbbb\/run-3 does not exist/);
  // asking for two runs works with two runs
  assert.equal(s.run({ runs: 2 }).card.verdict, 'PASS');
});

test('incomplete: a judged tag without a decision, an unreadable file, an invalid file, a file for another item', () => {
  const s = scenario();
  const file = (item, run, config16 = CAND) => join(s.paths.judgments, config16, `run-${run}`, judgmentFileName(item.id, item.text));
  const item = (id) => s.items.get(id);
  const doc = readJson(file(item('g-hyp-2'), 1));
  writeFileSync(file(item('g-hyp-2'), 1), JSON.stringify({ ...doc, tags: doc.tags.filter((t) => t.name !== 'Hypothetical') }));
  writeFileSync(file(item('g-hyp-3'), 2), '{ not json');
  writeFileSync(file(item('g-hyp-4'), 3), JSON.stringify({ ...doc, id: 'g-hyp-4', run: 3, status: 'maybe' }));
  writeFileSync(file(item('g-hyp-5'), 1), JSON.stringify({ ...doc, id: 'someone-else', run: 1 }));
  const result = s.run();
  assert.equal(result.exitCode, EXIT.INVALID);
  const byId = Object.fromEntries(result.card.incomplete.items.map((i) => [i.id, i.problems.join(' ')]));
  assert.match(byId['h-act-2'], /candidate run-1: no decision for Hypothetical/);
  assert.match(byId['h-act-3'], /candidate run-2: g-hyp-3\.[0-9a-f]{8}\.json is unreadable/);
  assert.match(byId['h-act-4'], /candidate run-3: .* is not a valid judgment \(\$\.status: expected one of/);
  assert.match(byId['h-act-5'], /candidate run-1: .* says it is someone-else run 1/);
  assert.equal(result.card.incomplete.count, 4);
});

test('incomplete: judgments made on other claim text are stale, never reused', () => {
  const edited = fixtureRows('cases.jsonl').map((c) => (c.case_id === 'c-act-2' ? { ...c, claim: `${c.claim} (edited)` } : c));
  const result = scenario({ casesOnDisk: edited }).run();
  assert.equal(result.exitCode, EXIT.INVALID);
  assert.equal(result.card.incomplete.items[0].id, 'c-act-2');
  assert.match(result.card.incomplete.items[0].problems[0], /baseline run-1: g-ctx-2\.[0-9a-f]{8}\.json was judged on other claim text \(expected g-ctx-2\.[0-9a-f]{8}\.json\)/);
  // white space does not count as an edit
  const spaced = fixtureRows('cases.jsonl').map((c) => (c.case_id === 'c-act-2' ? { ...c, claim: `  ${c.claim}  \r\n` } : c));
  assert.equal(scenario({ casesOnDisk: spaced }).run().card.verdict, 'PASS');
});

test('--smoke: one run, the same verdict logic, incomplete items are listed and left out, the card says it is not a gate verdict', () => {
  const s = scenario({ cand: { skip: ['g-ctx-2#1', 'g-pred-les-3#1'] } });
  const result = s.run({ smoke: true });
  assertCardSound(result);
  assert.equal(result.card.smoke, true);
  assert.equal(result.card.kind, 'smoke');
  assert.equal(result.card.stats.runs, 1);
  assert.equal(result.card.small_sample, true);
  assert.equal(result.card.incomplete.count, 2);
  assert.deepEqual(result.card.incomplete.items.map((i) => i.id), ['c-act-2', 'p-les-3']);
  assert.equal(tagRow(result, 'Predictive').n, 7, 'the left-out claim is not counted');
  assert.equal(result.card.verdict, 'PASS');
  assert.equal(result.exitCode, EXIT.OK);
  assert.match(result.md.split('\n')[0], /^For editors: /);
  assert.match(result.md.split('\n')[1], /^Verdict: PASS - smoke: not a gate verdict - small sample/);
  assert.match(result.md, /Incomplete: 2 gating items left out for missing judgments/);
  // the same data as a gate run is incomplete
  assert.equal(s.run().exitCode, EXIT.INVALID);
  // smoke reads run 1 only, and --runs does not override it
  assert.equal(s.run({ smoke: true, runs: 3 }).card.stats.runs, 1);
  assert.equal(result.card.noise.baseline, null, 'one run cannot show noise');
  // smoke yields the other verdicts too
  const fail = scenario({ cand: { wrong: ['can-ctx-2'] } }).run({ smoke: true });
  assert.equal(fail.card.verdict, 'FAIL');
  assert.equal(fail.exitCode, EXIT.FAIL);
  assert.match(fail.md.split(String.fromCharCode(10))[0], /^For editors: a rehearsal [(]smoke[)] run; nothing changes/);
  assert.match(fail.md.split('\n')[1], /^Verdict: FAIL - smoke: not a gate verdict/);
});

test('with nothing to evaluate the verdict is HOLD, not PASS', () => {
  const none = scenario({ caseRows: [], canaryRows: [], target: null, lesson: null }).run();
  assert.equal(none.card.verdict, 'HOLD');
  assert.ok(none.card.conditions.every((c) => c.status === 'not_applicable'));
  assert.match(none.card.holds[0], /nothing was evaluated/);
});

// ---- runs, noise, errors ----

test('a run that errored makes the verdict undecided: the canary fails', () => {
  const item = [...scenario().items.values()].find((i) => i.rows.some((r) => r.id === 'can-ctx-1')).id;
  const result = scenario({ cand: { errors: [`${item}#2`] } }).run();
  assert.equal(result.card.verdict, 'FAIL');
  assert.deepEqual(result.card.canaries.candidate.failing, ['can-ctx-1']);
  assert.deepEqual(validate(cardSchema, result.card), { ok: true, errors: [] });
});

test('two of three runs decide the verdict, and the disagreement shows up as noise', () => {
  const s = scenario({ cand: { perRun: { 'p-act-2': ['apply', 'apply', 'do_not_apply'], 'h-act-6': ['apply', 'do_not_apply', 'do_not_apply'] } } });
  const result = s.run();
  assert.equal(result.card.verdict, 'PASS', 'the majority is right');
  assert.equal(result.card.noise.cells, 23);
  assert.equal(result.card.noise.runs, 3);
  assert.equal(result.card.noise.baseline, 0);
  assert.equal(result.card.noise.candidate, 2 / 23);
  // two of three wrong is wrong
  const bad = scenario({ cand: { perRun: { 'c-act-1': ['do_not_apply', 'apply', 'do_not_apply'] } } }).run();
  assert.deepEqual(bad.card.cases.newly_failing, ['c-act-1']);
  // all three different has no majority
  const split = scenario({ cand: { perRun: { 'c-act-1': ['apply', 'do_not_apply', 'cannot_tell'] } } }).run();
  assert.deepEqual(split.card.cases.newly_failing, ['c-act-1']);
  assert.equal(split.card.cases.items.find((i) => i.case_id === 'c-act-1').candidate, 'undecided');
});

// ---- extra runs: the runs promote.mjs adds for a flipped case ----

/** Judges some items again: rewrites runs 1..runs of the items behind these case ids under one configuration (the other items keep the three they have). */
function addRuns(s, side, caseIds, { runs = 8, ...more } = {}) {
  const items = new Map([...s.items].filter(([, item]) => item.rows.some((r) => caseIds.includes(r.id))));
  writeSide({ dir: s.dir, config16: side === 'baseline' ? BASE : CAND, rubric: side === 'baseline' ? s.opts.baselineRubric : s.opts.candidateRubric, items, runs, ...more });
  return items;
}
const itemOf = (s, caseId) => [...s.items.values()].find((i) => i.rows.some((r) => r.id === caseId));
const FLIP = ['do_not_apply', 'do_not_apply', 'apply']; // c-act-1 is expected to be "apply": two of three runs wrong, and right in every run added later

test('runs_used: each per-item record says how many runs its verdicts rest on; an item with extra runs uses all of them, the others keep their three', () => {
  const s = scenario();
  const plain = s.run();
  assert.ok(plain.card.cases.items.every((i) => i.runs_used.baseline === 3 && i.runs_used.candidate === 3));
  addRuns(s, 'baseline', ['c-act-1']);
  addRuns(s, 'candidate', ['c-act-1']);
  const more = s.run();
  assertCardSound(more);
  const used = Object.fromEntries(more.card.cases.items.map((i) => [i.case_id, i.runs_used]));
  assert.deepEqual(used['c-act-1'], { baseline: 8, candidate: 8 });
  assert.deepEqual(used['c-act-2'], { baseline: 3, candidate: 3 });
  assert.equal(more.card.verdict, plain.card.verdict, 'right answers in every run change nothing');
  assert.equal(more.card.stats.runs, 3, '--runs stays the number of runs every item must have');
  assert.equal('reconfirmed' in more.card, false, 'the card lists reconfirmed cases only when the caller names them');
});

test('extra runs outvote a 2:1 flip: wrong in two of three runs, right in the five added ones; the case is no longer newly failing and FAIL becomes PASS', () => {
  const s = scenario({ cand: { perRun: { 'c-act-1': FLIP } } });
  const first = s.run();
  assert.equal(first.card.verdict, 'FAIL');
  assert.deepEqual(first.card.cases.newly_failing, ['c-act-1']);
  addRuns(s, 'baseline', ['c-act-1']);
  addRuns(s, 'candidate', ['c-act-1'], { perRun: { 'c-act-1': FLIP } });
  const second = s.run({ reconfirmed: ['c-act-1'] });
  assertCardSound(second);
  assert.equal(second.card.verdict, 'PASS');
  assert.equal(second.exitCode, EXIT.OK);
  assert.deepEqual(second.card.cases.newly_failing, []);
  assert.deepEqual(second.card.reconfirmed, [{ case_id: 'c-act-1', tag: 'Context-dependent', flip: 'broken', baseline: { runs: 8, decision: 'apply' }, candidate: { runs: 8, decision: 'apply' }, outcome: 'noise' }]);
  assert.match(second.md, /^Reconfirmed c-act-1 \(Context-dependent, expected apply\): baseline apply over 8 runs, candidate apply over 8 runs: broken flip was noise$/m);
});

test('extra runs that agree with the first three confirm the flip: still newly failing, outcome confirmed, FAIL stays', () => {
  const stay = ['do_not_apply', 'do_not_apply', 'apply', 'do_not_apply', 'do_not_apply', 'do_not_apply', 'apply', 'do_not_apply']; // six of eight wrong
  const s = scenario({ cand: { perRun: { 'c-act-1': FLIP } } });
  addRuns(s, 'baseline', ['c-act-1']);
  addRuns(s, 'candidate', ['c-act-1'], { perRun: { 'c-act-1': stay } });
  const r = s.run({ reconfirmed: ['c-act-1'] });
  assertCardSound(r);
  assert.equal(r.card.verdict, 'FAIL');
  assert.equal(r.exitCode, EXIT.FAIL);
  assert.deepEqual(r.card.cases.newly_failing, ['c-act-1']);
  assert.deepEqual(r.card.reconfirmed, [{ case_id: 'c-act-1', tag: 'Context-dependent', flip: 'broken', baseline: { runs: 8, decision: 'apply' }, candidate: { runs: 8, decision: 'do_not_apply' }, outcome: 'confirmed' }]);
  assert.match(r.md, /^Reconfirmed c-act-1 .*: baseline apply over 8 runs, candidate do_not_apply over 8 runs: broken flip confirmed$/m);
});

test('a flip is noise as well when the extra runs show that the baseline did not really pass', () => {
  const s = scenario({ base: { ...PASS_BASE, perRun: { 'c-act-1': ['apply', 'apply', 'do_not_apply'] } }, cand: { perRun: { 'c-act-1': FLIP } } });
  assert.deepEqual(s.run().card.cases.newly_failing, ['c-act-1']);
  const baseRuns = ['apply', 'apply', 'do_not_apply', 'do_not_apply', 'do_not_apply', 'do_not_apply', 'do_not_apply', 'do_not_apply'];
  const candRuns = ['do_not_apply', 'do_not_apply', 'apply', 'do_not_apply', 'do_not_apply', 'do_not_apply', 'do_not_apply', 'do_not_apply'];
  addRuns(s, 'baseline', ['c-act-1'], { perRun: { 'c-act-1': baseRuns } });
  addRuns(s, 'candidate', ['c-act-1'], { perRun: { 'c-act-1': candRuns } });
  const r = s.run({ reconfirmed: ['c-act-1'] });
  assert.deepEqual(r.card.cases.newly_failing, []);
  assert.deepEqual(r.card.reconfirmed.map((x) => [x.baseline.decision, x.candidate.decision, x.outcome]), [['do_not_apply', 'do_not_apply', 'noise']]);
});

test('improvement is held to the same standard: a lesson case that seems fixed after three runs and is wrong in most of eight is noise, and no longer counts as fixed', () => {
  const seemsFixed = ['do_not_apply', 'do_not_apply', 'apply']; // p-les-1 is expected to be "do_not_apply": right in two of the first three runs
  const s = scenario({ cand: { perRun: { 'p-les-1': seemsFixed } } });
  assert.ok(tagRow(s.run(), 'Predictive').fixed.includes('p-les-1'));
  addRuns(s, 'baseline', ['p-les-1'], { wrong: ['p-les-1'] });
  addRuns(s, 'candidate', ['p-les-1'], { perRun: { 'p-les-1': [...seemsFixed, 'apply', 'apply', 'apply', 'apply', 'apply'] } });
  const r = s.run({ reconfirmed: [{ case_id: 'p-les-1', flip: 'fixed' }] });
  assertCardSound(r);
  assert.ok(!tagRow(r, 'Predictive').fixed.includes('p-les-1'));
  assert.deepEqual(r.card.reconfirmed, [{ case_id: 'p-les-1', tag: 'Predictive', flip: 'fixed', baseline: { runs: 8, decision: 'apply' }, candidate: { runs: 8, decision: 'apply' }, outcome: 'noise' }]);
  assert.match(r.md, /^Reconfirmed p-les-1 .*: baseline apply over 8 runs, candidate apply over 8 runs: fixed flip was noise$/m);
});

test('a fixed flip that holds with eight runs is confirmed; the entry says which kind of flip it is, and a plain id means a broken flip', () => {
  const s = scenario({ cand: { perRun: { 'p-les-1': ['do_not_apply', 'do_not_apply', 'apply'] } } });
  addRuns(s, 'baseline', ['p-les-1'], { wrong: ['p-les-1'] });
  addRuns(s, 'candidate', ['p-les-1'], { perRun: { 'p-les-1': ['do_not_apply', 'do_not_apply', 'apply', 'do_not_apply', 'apply', 'do_not_apply', 'do_not_apply', 'do_not_apply'] } });
  const r = s.run({ reconfirmed: [{ case_id: 'p-les-1', flip: 'fixed' }] });
  assert.ok(tagRow(r, 'Predictive').fixed.includes('p-les-1'));
  assert.deepEqual(r.card.reconfirmed, [{ case_id: 'p-les-1', tag: 'Predictive', flip: 'fixed', baseline: { runs: 8, decision: 'apply' }, candidate: { runs: 8, decision: 'do_not_apply' }, outcome: 'confirmed' }]);
  assert.match(r.md, /^Reconfirmed p-les-1 .*: baseline apply over 8 runs, candidate do_not_apply over 8 runs: fixed flip confirmed$/m);
  // the same case named as a plain id is read as a broken flip: it was never broken, so that flip is noise
  assert.deepEqual(s.run({ reconfirmed: ['p-les-1'] }).card.reconfirmed.map((x) => [x.flip, x.outcome]), [['broken', 'noise']]);
  assert.throws(() => s.run({ reconfirmed: [{ case_id: 'p-les-1', flip: 'sideways' }] }), (e) => e instanceof InputError && /flip must be "broken" or "fixed", got "sideways"/.test(e.message));
  assert.equal(s.run({ reconfirmed: [{ case_id: 'p-les-1', flip: 'fixed' }, { case_id: 'p-les-1', flip: 'fixed' }] }).card.reconfirmed.length, 1, 'a case is listed once');
});

test('--runs is still the minimum: extra runs do not stand in for a missing required run', () => {
  const s = scenario();
  const item = addRuns(s, 'candidate', ['c-act-1']).values().next().value;
  rmSync(join(s.dir, 'judgments', CAND, 'run-2', judgmentFileName(item.id, item.text)));
  const r = s.run();
  assert.equal(r.exitCode, EXIT.INVALID);
  assert.equal(r.card.verdict, 'n/a');
  assert.match(r.card.incomplete.items[0].problems.join(' '), /candidate run-2: .* is missing/);
});

test('a smoke run reads exactly one run per item, whatever extra runs exist', () => {
  const s = scenario({ cand: { perRun: { 'c-act-1': FLIP } } });
  addRuns(s, 'baseline', ['c-act-1']);
  addRuns(s, 'candidate', ['c-act-1'], { perRun: { 'c-act-1': FLIP } });
  const smoke = s.run({ smoke: true });
  assert.ok(smoke.card.cases.items.every((i) => i.runs_used.baseline === 1 && i.runs_used.candidate === 1));
  assert.deepEqual(smoke.card.cases.newly_failing, ['c-act-1'], 'the first run alone was wrong');
  assert.deepEqual(s.run().card.cases.items.find((i) => i.case_id === 'c-act-1').runs_used, { baseline: 8, candidate: 8 });
});

test('an extra run that errored or is unreadable is left out: no gap, no "error" decision; the verdict rests on the runs that are usable', () => {
  const s = scenario();
  const item = addRuns(s, 'candidate', ['c-act-1'], { errors: [`${itemOf(s, 'c-act-1').id}#5`] }).values().next().value;
  writeFileSync(join(s.dir, 'judgments', CAND, 'run-6', judgmentFileName(item.id, item.text)), '{ not json');
  const r = s.run();
  assertCardSound(r);
  assert.equal(r.card.verdict, 'PASS');
  const rec = r.card.cases.items.find((i) => i.case_id === 'c-act-1');
  assert.deepEqual(rec.runs_used, { baseline: 3, candidate: 6 }, 'runs 1 to 4, 7 and 8');
  assert.equal(rec.candidate, 'apply');
});

test('the noise figure stays measured over the required runs: extra runs on one item change its verdict, not the noise', () => {
  const s = scenario({ cand: { perRun: { 'p-act-2': ['apply', 'apply', 'do_not_apply'] } } });
  const before = s.run().card.noise;
  const eight = ['apply', 'apply', 'do_not_apply', 'do_not_apply', 'do_not_apply', 'do_not_apply', 'do_not_apply', 'do_not_apply'];
  addRuns(s, 'candidate', ['p-act-2'], { perRun: { 'p-act-2': eight } });
  const after = s.run();
  assert.deepEqual(after.card.noise, before);
  assert.deepEqual(after.card.cases.newly_failing, ['p-act-2'], 'but the verdict of that item rests on all eight runs');
});

test('condition 5 reads the extra runs too: an apply on the human-only tag in run 6 fails the gate and names the file', () => {
  const s = scenario();
  const item = addRuns(s, 'candidate', ['c-act-1']).values().next().value;
  const file = join(s.dir, 'judgments', CAND, 'run-6', judgmentFileName(item.id, item.text));
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  doc.tags.push(entry('Editor verified', 'apply'));
  writeFileSync(file, JSON.stringify(doc));
  const r = s.run();
  assert.equal(r.card.verdict, 'FAIL');
  assert.match(r.card.reasons.join(' '), new RegExp(`${item.id}/run-6/Editor verified`));
});

test('reconfirmed: an id that is not an evaluated case is refused; card.md keeps every reconfirmed line when there is room and drops the last ones first when there is not', () => {
  const s = scenario({ cand: { perRun: { 'c-act-1': FLIP } } });
  assert.throws(() => s.run({ reconfirmed: ['no-such-case'] }), (e) => e instanceof InputError && /reconfirmed: no-such-case is not an evaluated case/.test(e.message));
  const card = structuredClone(s.run({ reconfirmed: ['c-act-1'] }).card);
  const many = (n) => Array.from({ length: n }, (_, i) => ({ case_id: `case-number-${i}`, tag: 'Hypothetical', baseline: { runs: 8, decision: 'apply' }, candidate: { runs: 8, decision: 'do_not_apply' }, outcome: i % 2 ? 'noise' : 'confirmed' }));
  const reconfirmLines = (md) => md.split('\n').filter((l) => l.startsWith('Reconfirmed '));
  const roomy = { ...card, reconfirmed: many(3), reasons: ['one short reason'] };
  assert.equal(reconfirmLines(renderCardMd(roomy)).length, 3, 'one line per reconfirmed case');
  const crowded = { ...card, reconfirmed: many(10), reasons: Array.from({ length: 4 }, (_, i) => `reason ${i} ${'x'.repeat(150)}`) };
  const md = renderCardMd(crowded);
  assert.ok(md.length <= CARD_MD_LIMIT, `${md.length}`);
  assert.match(md.split('\n')[0], /^For editors: nothing changed; the change would make /);
  assert.match(md.split('\n')[1], /^Verdict: FAIL/);
  assert.doesNotMatch(md, /Rollback: /, "a FAIL card has no rollback line: nothing went live");
  assert.match(md, /FAIL: reason 3 /, 'the reasons rank above the reconfirmed lines');
  assert.ok(reconfirmLines(md).length < 10 && /more line\(s\) in card\.json/.test(md), 'what does not fit is announced, and it is the reconfirmed lines that go');
});

test('ask_editor and cannot_tell verdicts are not the expected answer, so they fail a case or a canary', () => {
  const result = scenario({ cand: { perRun: { 'can-ctx-2': ['ask_editor', 'ask_editor', 'ask_editor'], 'c-act-1': ['cannot_tell', 'cannot_tell', 'cannot_tell'] } } }).run();
  assert.deepEqual(result.card.canaries.candidate.failing, ['can-ctx-2']);
  assert.deepEqual(result.card.cases.newly_failing, ['c-act-1']);
  assert.equal(result.card.cases.items.find((i) => i.case_id === 'c-act-1').candidate, 'cannot_tell');
});

test('a tag that the configuration does not judge counts as not applied', () => {
  // the baseline rubric does not judge Context-dependent and writes nothing for it, so its apply-cases fail under the baseline
  const rows2 = readJson(join(FIX, 'rubric-rows.json')).map((r) => (r.name === 'Context-dependent' ? { ...r, judged: false } : r));
  const notJudged = buildRubric(rows2, { version: '2026-10-13.1' });
  const { candidate } = fixtureRubrics();
  const result = scenario({ baselineRubric: notJudged, candidateRubric: candidate, base: PASS_BASE }).run();
  assert.deepEqual(result.card.canaries.baseline.failing, ['can-ctx-1'], 'apply expected, nothing written');
  const cd = result.card.cases.items.filter((i) => i.tag === 'Context-dependent' && i.baseline === 'do_not_apply' && i.expected === 'apply');
  assert.ok(cd.length >= 3);
  assert.equal(result.card.cases.items.find((i) => i.case_id === 'c-act-4').baseline, 'do_not_apply');
});

// ---- statistics ----

test('the bootstrap is deterministic, seeded by h16(baseline + candidate + tag), and the card says so', () => {
  const s = scenario();
  const a = s.run();
  const b = s.run();
  assert.deepEqual(a.card, b.card, 'same inputs, same card');
  assert.equal(JSON.stringify(a.card), JSON.stringify(b.card));
  for (const t of a.card.per_tag) assert.equal(t.seed, h16(`${BASE}${CAND}${t.tag}`));
  assert.notEqual(tagRow(a, 'Predictive').seed, tagRow(a, 'Hypothetical').seed);
  // the interval is exactly what stats.pairedBootstrapDelta gives for the sorted case ids with that seed
  // (Predictive, ids sorted: p-act-1..5, p-les-1..3; the baseline misses p-act-1 and the three lesson cases)
  const ref = pairedBootstrapDelta([0, 1, 1, 1, 1, 0, 0, 0], [1, 1, 1, 1, 1, 1, 1, 1], { B: 1000, seed: h16(`${BASE}${CAND}Predictive`), ci: [0.025, 0.975] });
  assert.deepEqual(tagRow(a, 'Predictive').ci, [ref.lo, ref.hi]);
  assert.equal(tagRow(a, 'Predictive').delta, ref.delta);
  assert.equal(a.card.stats.B, 1000);
  assert.match(a.card.stats.seed, /h16\(baseline \+ candidate \+ tag\)/);
  // another pair of configurations draws from another seed
  const other = scenario({ ids: ['cccccccccccccccc', 'dddddddddddddddd'] }).run();
  assert.equal(tagRow(other, 'Predictive').seed, h16('ccccccccccccccccddddddddddddddddPredictive'));
  assert.notEqual(tagRow(other, 'Predictive').seed, tagRow(a, 'Predictive').seed);
  assert.equal(other.card.verdict, 'PASS');
  // the sha256: form of an id gives the same card
  assert.deepEqual(s.run({ baseline: `sha256:${BASE}`, candidate: `sha256:${CAND}` }).card, a.card);
});

test('per-tag numbers: accuracy, positives, fixed and broken ids, McNemar, gated flag, not_gated list', () => {
  // Predictive: 2 fixed and 1 broken among 8; Hypothetical: 1 fixed and 2 broken among 8 (lesson cases only, so condition 2 stays out of it)
  const result = scenario({
    base: { wrong: ['p-les-1', 'p-les-2', 'h-les-1'] },
    cand: { wrong: ['p-les-3', 'h-les-2', 'h-les-1'] },
  }).run();
  const p = tagRow(result, 'Predictive');
  assert.equal(p.n, 8);
  assert.deepEqual(p.fixed, ['p-les-1', 'p-les-2']);
  assert.deepEqual(p.broken, ['p-les-3']);
  assert.equal(p.acc_base, 6 / 8, 'the baseline misses p-les-1 and p-les-2');
  assert.equal(p.acc_cand, 7 / 8, 'the candidate misses p-les-3 only');
  assert.equal(p.delta, 1 / 8);
  assert.equal(p.mcnemar_p, 1);
  const h = tagRow(result, 'Hypothetical');
  assert.deepEqual(h.fixed, []);
  assert.deepEqual(h.broken, ['h-les-2']);
  assert.equal(h.positives, 7);
  assert.equal(h.gated, true);
  assert.equal(h.acc_base, 7 / 8, 'the baseline misses h-les-1');
  assert.equal(h.acc_cand, 6 / 8, 'the candidate misses h-les-1 and h-les-2');
  const c = tagRow(result, 'Context-dependent');
  assert.equal(c.gated, false);
  assert.equal(c.positives, 3);
  assert.deepEqual(result.card.not_gated, ['Context-dependent (3 positives of 7)']);
  assert.deepEqual(result.card.per_tag.map((t) => t.tag), ['Context-dependent', 'Hypothetical', 'Predictive'], 'tags in name order');
  for (const t of result.card.per_tag) {
    assert.ok(t.ci[0] <= t.delta && t.delta <= t.ci[1] + 1e-12 || t.n === 0, `${t.tag}: ${t.ci} around ${t.delta}`);
    assert.equal(t.fixed.length - t.broken.length, Math.round(t.delta * t.n));
  }
});

test('small_sample is true while any gated tag has under 30 positives, and not otherwise', () => {
  assert.equal(scenario().run().card.small_sample, true);
  const big = [];
  for (let i = 1; i <= 31; i++) big.push({ case_id: `big-${i}`, geo_id: `g-big-${i}`, claim: `Synthetic big claim ${i}: the figure will rise.`, tag: 'Predictive', expected: 'apply', contested: false, suite: 'gate', active: true });
  const result = scenario({ caseRows: big, lesson: null, target: null, base: {} }).run();
  assert.equal(tagRow(result, 'Predictive').positives, 31);
  assert.equal(result.card.small_sample, false);
  assert.ok(!/small sample/.test(result.md));
  // no gated tag at all is a small sample as well
  const few = scenario({ caseRows: fixtureRows('cases.jsonl').filter((c) => c.tag === 'Context-dependent'), lesson: null, target: null, base: {} }).run();
  assert.equal(few.card.small_sample, true);
});

// ---- input checks ----

test('judgments made under another rubric than the one given are refused', () => {
  const { baseline } = fixtureRubrics();
  const s = scenario();
  assert.throws(() => s.run({ candidateRubric: baseline }), /candidate judgments \(bbbbbbbbbbbbbbbb\) were made under rubric sha256:[0-9a-f]{16}, but the candidate rubric file is sha256:[0-9a-f]{16}/);
  assert.throws(() => s.run({ baselineRubric: s.opts.candidateRubric }), InputError);
});

test('a rubric whose stored hashes do not match its content, a missing file or an unknown target are refused', () => {
  const { candidate } = fixtureRubrics();
  const tampered = structuredClone(candidate);
  tampered.tags[0].when_to_use.rules[0].text += ' (edited by hand)';
  const s = scenario();
  assert.throws(() => s.run({ candidateRubric: tampered }), /candidate rubric is not usable: stored hashes do not match the content/);
  assert.throws(() => s.run({ candidateRubric: join(s.paths.dir, 'nope.json') }), /candidate rubric: cannot read/);
  assert.throws(() => s.run({ candidateRubric: {} }), /candidate rubric is not usable/);
  assert.throws(() => s.run({ target: 'Predicitve' }), /--target Predicitve is not a tag of the candidate rubric/);
  assert.throws(() => s.run({ changedTags: ['Nope'] }), /--changed-tags: Nope is not a tag/);
  assert.throws(() => s.run({ cases: join(s.paths.dir, 'nope.jsonl') }), /cases: .* does not exist/);
  assert.throws(() => s.run({ canaries: join(s.paths.dir, 'nope.jsonl') }), /canaries: .* does not exist/);
  assert.throws(() => s.run({ runs: 0 }), /--runs must be a whole number of at least 1/);
  assert.throws(() => s.run({ baseline: undefined }), /--baseline and --candidate are required/);
  assert.throws(() => s.run({ candidate: '../x' }), /not a config id/);
  writeFileSync(s.paths.cases, `${readFileSync(s.paths.cases, 'utf8')}{"case_id": "cut`);
  assert.throws(() => s.run(), /cases: the last line of .* is cut short/);
});

test('a gate section that is missing or nonsensical is refused instead of guessed', () => {
  const s = scenario();
  assert.throws(() => s.run({ config: { ...config, gate: undefined } }), /no "gate" section/);
  assert.throws(() => s.run({ config: { ...config, gate: { ...config.gate, min_positives: 0 } } }), /config\.gate\.min_positives/);
  assert.throws(() => s.run({ config: { ...config, gate: { ...config.gate, ci: [0.9, 0.1] } } }), /config\.gate\.ci/);
  assert.throws(() => s.run({ config: { ...config, gate: { ...config.gate, ungated_flips_hold: 4 } } }), /ungated_flips_hold may not exceed/);
});

test('config.json drives the gate: a stricter tolerance turns a PASS into a FAIL, more required positives into a HOLD', () => {
  const s = scenario({ base: { wrong: ['p-les-1', 'p-les-2', 'p-les-3', 'p-act-1'] }, cand: { wrong: ['h-les-2'] } });
  const normal = s.run();
  assert.equal(normal.card.verdict, 'FAIL', 'Hypothetical loses a lesson case: lower bound far below -5 points');
  const lenient = s.run({ config: { ...config, gate: { ...config.gate, tolerance: 0.9 } } });
  assert.equal(lenient.card.conditions[2].status, 'pass');
  assert.equal(lenient.card.verdict, 'PASS');
  const strict = scenario().run({ config: { ...config, gate: { ...config.gate, min_positives: 6 } } });
  assert.equal(strict.card.verdict, 'HOLD', 'the target now has too few positives');
  assert.deepEqual(strict.card.not_gated.map((n) => n.split(' ')[0]), ['Context-dependent', 'Predictive'], 'Hypothetical has 7 positives');
});

// ---- card output ----

test('card.md stays within 1,900 characters in the worst case and keeps verdict and canaries; a FAIL card has no rollback line', () => {
  // everything wrong under the candidate on the real data: every canary and every case fails
  const worst = realWorld({ cand: { allWrong: true }, lesson: 'L-1' });
  const result = worst.run();
  assert.equal(result.card.verdict, 'FAIL');
  assert.ok(result.card.canaries.candidate.failing.length > 20);
  assert.ok(result.md.length <= CARD_MD_LIMIT, `${result.md.length} characters`);
  const lines = result.md.trimEnd().split('\n');
  assert.match(lines[0], /^For editors: nothing changed; the change would make .* worse on claims you already decided, so the rule owner can reword or reject it\.$/);
  assert.match(lines[1], /^Verdict: FAIL/);
  assert.ok(lines.some((l) => l.startsWith('Canaries: ')));
  assert.ok(lines.some((l) => l.startsWith('Cases newly failing: ')));
  assert.match(lines.at(-1), /^Baseline /, 'the last line is the configuration line: nothing went live, so there is no rollback line');
  assert.ok(lines.some((l) => l.startsWith('FAIL: ')));
  assertCardSound(result);
  // renderCardMd copes with a card of any size
  const card = structuredClone(result.card);
  card.reasons = Array.from({ length: 40 }, (_, i) => `reason ${i} ${'x'.repeat(300)}`);
  card.holds = Array.from({ length: 40 }, (_, i) => `hold ${i} ${'y'.repeat(300)}`);
  card.per_tag = Array.from({ length: 30 }, (_, i) => ({ ...card.per_tag[0], tag: `Tag number ${i}`, gated: true }));
  const md = renderCardMd(card);
  assert.ok(md.length <= CARD_MD_LIMIT, `${md.length}`);
  assert.match(md.split('\n')[0], /^For editors: nothing changed; the change would make /);
  assert.match(md.split('\n')[1], /^Verdict: FAIL/);
  assert.doesNotMatch(md, /Rollback: /, "a FAIL card has no rollback line: nothing went live");
  assert.match(md, /more line\(s\) in card\.json/);
});

test('writeCard writes card.json (valid) and card.md (the same text the result carries) and creates the folder', () => {
  const s = scenario();
  const result = s.run();
  const out = join(s.paths.dir, 'deep', 'out');
  const paths = writeCard(result, out);
  assert.equal(paths.json, join(out, 'card.json'));
  const onDisk = readJson(paths.json);
  assert.deepEqual(onDisk, JSON.parse(JSON.stringify(result.card)));
  assert.deepEqual(validate(cardSchema, onDisk), { ok: true, errors: [] });
  assert.equal(readFileSync(paths.md, 'utf8'), result.md);
});

test('the default card id and folder name have no colon (Windows) and sort by time', () => {
  const s = scenario();
  const result = evaluate({ ...s.opts, cardId: undefined });
  assert.match(result.card.card_id, /^\d{8}T\d{6}Z-eval$/);
  assert.ok(!result.card.card_id.includes(':'));
  assert.match(evaluate({ ...s.opts, cardId: undefined, smoke: true }).card.card_id, /^\d{8}T\d{6}Z-eval-smoke$/);
  assert.equal(evaluate({ ...s.opts, cardId: undefined, out: join(s.paths.dir, 'my-run') }).card.card_id, 'my-run', 'with --out the folder name is the card id');
});

// ---- the command line ----

function cliArgs(s, more = []) {
  return [
    '--baseline', BASE, '--candidate', CAND, '--baseline-rubric', s.paths.baselineRubric, '--candidate-rubric', s.paths.candidateRubric,
    '--cases', s.paths.cases, '--canaries', s.paths.canaries, '--judgments', s.paths.judgments, '--target', 'Predictive', '--lesson', 'L-1',
    '--out', join(s.paths.dir, 'out'), ...more,
  ];
}
function cli(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('CLI exit codes: PASS 0, HOLD 10, FAIL 11, incomplete 2, one line on stdout, card.json and card.md written', () => {
  const pass = scenario();
  const a = cli(cliArgs(pass));
  assert.equal(a.code, 0, a.err);
  assert.equal(a.out.trimEnd().split('\n').length, 1, 'one line');
  assert.match(a.out, /^eval: PASS \(small sample\) \| canaries 6\/6 \| cases newly failing 0 \| Predictive \+50\.0 points \(CI \+\d+\.\d to \+\d+\.\d\) fixed 4 broken 0 \| card .*card\.json\n$/);
  const card = readJson(join(pass.paths.dir, 'out', 'card.json'));
  assert.deepEqual(validate(cardSchema, card), { ok: true, errors: [] });
  assert.equal(card.verdict, 'PASS');
  assert.equal(card.card_id, 'out');
  const md = readFileSync(join(pass.paths.dir, 'out', 'card.md'), 'utf8');
  assert.ok(md.length <= 1900);
  assert.equal(a.err, '');

  const hold = cli(cliArgs(scenario({ base: { wrong: ['p-les-1', 'p-les-2'] } })));
  assert.equal(hold.code, 10, hold.err);
  assert.match(hold.out, /^eval: HOLD /);
  assert.match(hold.out, /HOLD Predictive: interval straddles zero/);

  const fail = cli(cliArgs(scenario({ cand: { wrong: ['can-ctx-2'] } })));
  assert.equal(fail.code, 11, fail.err);
  assert.match(fail.out, /^eval: FAIL .*FAIL 1 canaries fail: can-ctx-2/);

  const gap = scenario({ cand: { skip: ['g-ctx-2#2'] } });
  const inc = cli(cliArgs(gap));
  assert.equal(inc.code, 2);
  assert.match(inc.out, /^eval: INCOMPLETE 1 gating item\(s\)/);
  assert.equal(readJson(join(gap.paths.dir, 'out', 'card.json')).verdict, 'n/a');
  const smoke = cli(cliArgs(gap, ['--smoke']));
  assert.equal(smoke.code, 0, smoke.err);
  assert.match(smoke.out, /^eval: PASS \(smoke: not a gate verdict\)/);
  assert.equal(readJson(join(gap.paths.dir, 'out', 'card.json')).smoke, true);
});

test('CLI: --changed-tags, --runs and the sha256: id form', () => {
  const s = scenario({ cand: { wrong: ['c-les-1'] } });
  const quiet = cli(cliArgs(s));
  assert.equal(quiet.code, 0, quiet.err);
  const hold = cli(cliArgs(s, ['--changed-tags', 'Context-dependent, Hypothetical']));
  assert.equal(hold.code, 10, hold.err);
  const two = cli(cliArgs(s).map((a) => (a === BASE ? `sha256:${BASE}` : a)).concat(['--runs', '2']));
  assert.equal(two.code, 0, two.err);
  assert.equal(readJson(join(s.paths.dir, 'out', 'card.json')).stats.runs, 2);
});

test('CLI: bad arguments and bad input give exit 2 and a message, never a stack trace', () => {
  const s = scenario();
  const missing = cli(['--baseline', BASE]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /^eval: --baseline and --candidate are required\nusage: node agents\/claim-tagger\/scripts\/eval\.mjs --baseline <config16> --candidate <config16>/);
  assert.equal(missing.out, '');
  assert.equal(cli(['--nope']).code, 2);
  assert.match(cli(['--nope']).err, /unknown argument --nope/);
  assert.match(cli(['--baseline']).err, /--baseline needs a value/);
  assert.match(cli(['--runs', 'x']).err, /--runs needs a whole number/);
  const wrongRubric = cli(cliArgs(s).map((a) => (a === s.paths.candidateRubric ? s.paths.baselineRubric : a)));
  assert.equal(wrongRubric.code, 2);
  assert.match(wrongRubric.err, /were made under rubric/);
  assert.ok(!/\n\s+at /.test(wrongRubric.err), 'no stack trace');
  const help = cli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /^usage: node agents\/claim-tagger\/scripts\/eval\.mjs --baseline <config16> --candidate <config16> \[--baseline-rubric <path>\] --candidate-rubric <path>/);
});

test('main() returns the exit code and prints one line through io', () => {
  const s = scenario();
  const out = [];
  const err = [];
  const code = main(cliArgs(s), { out: (x) => out.push(x), err: (x) => err.push(x) });
  assert.equal(code, EXIT.OK);
  assert.equal(out.length, 1);
  assert.deepEqual(err, []);
  assert.ok(existsSync(join(s.paths.dir, 'out', 'card.json')));
});

// ---- the real files ----

function readLines(path) {
  return rows(path);
}

/** Judgments for the real cases, canaries and rubric: a judge that is right about everything (or wrong about everything). */
function realWorld({ cand = {}, base = {}, lesson = null } = {}) {
  const rubric = readJson(REAL('rubric', 'rubric.json'));
  const caseRows = readLines(REAL('evals', 'cases.jsonl'));
  const canaryRows = readLines(REAL('evals', 'canaries.jsonl'));
  const items = buildItems(caseRows, canaryRows, lesson);
  const dir = tmp();
  const allWrong = (x) => (x.allWrong ? { wrong: [...items.values()].flatMap((i) => i.rows.map((r) => r.id)) } : x);
  writeSide({ dir, config16: BASE, rubric, items, ...allWrong(base) });
  writeSide({ dir, config16: CAND, rubric, items, ...allWrong(cand) });
  const opts = {
    baseline: BASE, candidate: CAND, baselineRubric: rubric, candidateRubric: rubric, cases: REAL('evals', 'cases.jsonl'),
    canaries: REAL('evals', 'canaries.jsonl'), judgments: join(dir, 'judgments'), lesson, cardId: 'real-card',
  };
  return { dir, items, rubric, caseRows, canaryRows, opts, run: (more = {}) => evaluate({ ...opts, ...more }) };
}

test('the real cases.jsonl, canaries.jsonl, rubric.json and config.json load, and a judge that is right about everything passes', () => {
  const w = realWorld();
  const result = w.run();
  assertCardSound(result);
  const src = new Set(config.scope.source_reading_tags);
  const gateRows = w.caseRows.filter((c) => (c.suite ?? 'gate') === 'gate' && c.active === true && c.contested !== true);
  const counted = gateRows.filter((c) => !src.has(c.tag));
  const activeCanaries = w.canaryRows.filter((c) => c.active === true && c.contested !== true);
  assert.ok(activeCanaries.length > 50 && counted.length > 10, 'the real files are not empty');
  assert.equal(result.card.canaries.candidate.active, activeCanaries.length);
  assert.equal(result.card.canaries.candidate.passed, activeCanaries.length);
  assert.equal(result.card.cases.gating.length, counted.length);
  assert.equal(result.card.not_run.length, gateRows.length - counted.length);
  assert.ok(result.card.not_run.every((r) => src.has(r.tag)));
  assert.equal(result.card.verdict, 'PASS');
  assert.deepEqual(result.card.cases.newly_failing, []);
  assert.equal(result.card.small_sample, true);
  assert.equal(result.card.conditions[3].status, 'not_applicable');
  // gated tags are those with at least min_positives expected-apply cases
  for (const t of result.card.per_tag) assert.equal(t.gated, t.positives >= config.gate.min_positives, t.tag);
  assert.ok(result.card.per_tag.some((t) => t.gated));
  assert.ok(result.card.per_tag.every((t) => t.delta === 0 && t.fixed.length === 0));
  // 41 canary texts are shared by a tag and its counterpart: one judgment each
  assert.ok(w.items.size < activeCanaries.length + counted.length);
});

test('the real files: a baseline that misses everything the candidate gets right is a clear win for the best-covered tag', () => {
  const w = realWorld({ base: { allWrong: true } });
  const probe = w.run();
  const best = probe.card.per_tag.reduce((a, b) => (b.n > a.n ? b : a));
  assert.ok(best.n >= config.gate.min_positives, 'the real cases cover at least one tag well enough to gate');
  const result = w.run({ target: best.tag });
  const t = tagRow(result, best.tag);
  assert.equal(t.fixed.length, t.n, 'the baseline was wrong about every labelled claim of the tag');
  assert.equal(result.card.canaries.baseline.passed, 0);
  assert.equal(result.card.canaries.candidate.failing.length, 0);
  assert.ok(t.ci[0] > 0);
  assert.equal(result.card.conditions[3].status, t.positives >= config.gate.min_positives ? 'pass' : 'hold');
});

// ---- the research skeleton's gate text and the code agree ----

test('the five conditions of the gate are reported in order with a plain-words detail', () => {
  const result = scenario().run();
  assert.equal(result.card.conditions.length, 5);
  assert.match(result.card.conditions[0].detail, /canar/);
  assert.match(result.card.conditions[1].detail, /baseline/);
  assert.match(result.card.conditions[2].detail, /tolerance/);
  assert.match(result.card.conditions[3].detail, /target/);
  assert.match(result.card.conditions[4].detail, /human-only/);
  for (const c of result.card.conditions) assert.ok(c.detail.length > 10);
});


// ---- the other side of the folder: judge.mjs ----

const judgeNormalised = (s) => String(s).normalize('NFC').replace(/\s+/gu, ' ').trim(); // the recipe judge.mjs hashes claims with
const judgeDigits = (s) => createHash('sha256').update(judgeNormalised(s)).digest('hex').slice(0, 8);

test('judgment files named the way judge.mjs names them are found even when its normaliser and rubric-build.normaliseText disagree', () => {
  const oddCase = 'Synthetic claim ODD:  a double space\nand a line break.';
  const oddCanary = 'Synthetic canary ODD:   three spaces\tand a tab.';
  assert.notEqual(sha8(oddCase), judgeDigits(oddCase), 'the two recipes give different digits for this text');
  assert.notEqual(sha8(oddCanary), judgeDigits(oddCanary));
  const caseRows = [...fixtureRows('cases.jsonl'), { case_id: 'h-odd', geo_id: 'g-hyp-odd', claim: oddCase, tag: 'Hypothetical', expected: 'apply', contested: false, suite: 'gate', active: true }];
  const canaryRows = [...fixtureRows('canaries.jsonl'), { canary_id: 'can-odd', tag: 'Hypothetical', expected: 'apply', claim: oddCanary, contested: false, active: true }];
  const s = scenario({ caseRows, canaryRows });
  for (const config16 of [BASE, CAND]) {
    for (let run = 1; run <= RUNS; run++) {
      const folder = join(s.paths.judgments, config16, `run-${run}`);
      renameSync(join(folder, judgmentFileName('g-hyp-odd', oddCase)), join(folder, `g-hyp-odd.${judgeDigits(oddCase)}.json`));
      const from = join(folder, judgmentFileName(canaryItemId(oddCanary), oddCanary));
      const doc = readJson(from);
      doc.id = `canary-${judgeDigits(oddCanary)}`; // judge.mjs derives the canary id with its own normaliser too
      rmSync(from);
      writeFileSync(join(folder, `${doc.id}.${judgeDigits(oddCanary)}.json`), JSON.stringify(doc));
    }
  }
  const result = s.run();
  assert.equal(result.card.incomplete, undefined, JSON.stringify(result.card.incomplete));
  assert.equal(result.card.verdict, 'PASS');
  assert.ok(result.card.cases.gating.includes('h-odd'));
  assert.equal(result.card.canaries.candidate.active, 7);
  assert.equal(result.card.canaries.candidate.passed, 7);
  assert.equal(tagRow(result, 'Hypothetical').n, 9);
});

test('a judgment file that says it was made under another configuration is not used', () => {
  const s = scenario();
  const item = s.items.get('g-ctx-2');
  const file = join(s.paths.judgments, CAND, 'run-2', judgmentFileName(item.id, item.text));
  const doc = readJson(file);
  doc.config.config_id = 'sha256:cccccccccccccccc';
  writeFileSync(file, JSON.stringify(doc));
  const result = s.run();
  assert.equal(result.exitCode, EXIT.INVALID);
  assert.match(result.card.incomplete.items[0].problems[0], /candidate run-2: g-ctx-2\.[0-9a-f]{8}\.json was made under configuration sha256:cccccccccccccccc, not bbbbbbbbbbbbbbbb/);
});

test('the incomplete card says so in plain words and has no target or FAIL lines', () => {
  const result = scenario({ cand: { skip: ['g-ctx-2#2', 'g-ctx-3#1'] } }).run();
  const lines = result.md.trimEnd().split('\n');
  assert.equal(lines[0], 'Verdict: n/a - no gate verdict: the judgments are incomplete');
  assert.match(lines[1], /^Incomplete: 2 gating items without complete judgments, for example c-act-2 \(candidate run-2: g-ctx-2\.[0-9a-f]{8}\.json is missing\)$/);
  assert.ok(!/Target|FAIL|Canaries/.test(result.md));
  assert.match(lines.at(-1), /^Baseline /, 'no rollback line on an incomplete card');
  assert.equal(scenario({ cand: { skip: ['g-ctx-2#2'] } }).run().md.split('\n')[1].slice(0, 36), 'Incomplete: 1 gating item without co');
});

test('judge.mjs (fake driver) and eval.mjs agree on item ids, file names and shapes for the real cases and canaries', async (t) => {
  let judge;
  try {
    judge = await import('../agents/claim-tagger/scripts/judge.mjs');
  } catch (e) {
    t.skip(`judge.mjs cannot be imported: ${e.message}`);
    return;
  }
  const runsDir = tmp();
  const out = [];
  const err = [];
  let code;
  try {
    code = await judge.main(['--items', 'eval', '--driver', 'fake', '--runs', '3'], { out: (x) => out.push(x), err: (x) => err.push(x) }, { agentDir: agentRoot(), runsDir });
  } catch (e) {
    t.skip(`judge.mjs threw: ${e.message}`);
    return;
  }
  if (code !== EXIT.OK) {
    t.skip(`judge.mjs exited ${code}: ${err.join(' ').slice(0, 200)}`);
    return;
  }
  const folders = readdirSync(join(runsDir, 'judgments')).filter((d) => /^[0-9a-f]{16}$/.test(d));
  assert.equal(folders.length, 1, 'one configuration folder');
  const rubric = readJson(REAL('rubric', 'rubric.json'));
  const result = evaluate({
    baseline: folders[0], candidate: folders[0], baselineRubric: rubric, candidateRubric: rubric, cases: REAL('evals', 'cases.jsonl'),
    canaries: REAL('evals', 'canaries.jsonl'), judgments: join(runsDir, 'judgments'), cardId: 'interop',
  });
  assert.equal(result.card.incomplete, undefined, `eval cannot find what judge wrote: ${JSON.stringify(result.card.incomplete?.items?.slice(0, 2))}`);
  assert.notEqual(result.card.verdict, 'n/a');
  assert.deepEqual(validate(cardSchema, result.card), { ok: true, errors: [] });
  assert.ok(result.card.canaries.candidate.active > 50);
  assert.ok(result.md.length <= CARD_MD_LIMIT);
  // the fake judge says what a hash says, so most labels differ from it and the verdict itself is not asserted
});
