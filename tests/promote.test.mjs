import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EDITOR_NAMES, assertOpWritable } from '../agents/claim-tagger/scripts/allowlist.mjs';
import { main as applyMain } from '../agents/claim-tagger/scripts/apply.mjs';
import { selectCanaries, selectCases } from '../agents/claim-tagger/scripts/eval.mjs';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { fileSha256 } from '../agents/claim-tagger/scripts/lib/hash.mjs';
import { readJson, readJsonl } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { checkHashes, composeWhenToUse } from '../agents/claim-tagger/scripts/lib/rubric-build.mjs';
import { validate } from '../agents/claim-tagger/scripts/lib/validate.mjs';
import { check as planCheck, readPlan } from '../agents/claim-tagger/scripts/plan.mjs';
import { canaryItemId, judgmentFileName } from '../agents/claim-tagger/scripts/eval.mjs';
import { candidateVersion, canariesText, cardMarkdown, checkLesson, effectiveText, main, perTagSummary, reconfirmCandidates, reconfirmSettings, resolveLesson } from '../agents/claim-tagger/scripts/promote.mjs';
import { loadPull } from '../agents/claim-tagger/scripts/pull.mjs';
import { main as statusMain } from '../agents/claim-tagger/scripts/status.mjs';
import { makeJudgeStub, labelMap, labelOf, normClaim, opposite } from './fixtures/loop/judge-stub.mjs';
import { AGENT, LESSON_RULE_TEXT, LESSON_TITLE, captureIo, cleanupLoop, liveRubric, makePromoteWorld } from './fixtures/loop/world.mjs';

after(() => cleanupLoop());

const LIVE = '2026-10-13.1';
const cardSchema = JSON.parse(readFileSync(join(AGENT, 'schemas', 'card.schema.json'), 'utf8'));

const casesOf = (w) => readJsonl(join(w.root, 'evals', 'cases.jsonl')).rows;
const canariesOf = (w) => readJsonl(join(w.root, 'evals', 'canaries.jsonl')).rows;
const rootFile = (w, ...parts) => join(w.root, ...parts);

/**
 * The scripted judge for a promote world. The baseline gets the four lesson claims wrong (Predictive) and everything else as labelled; the candidate
 * gets `fixed` of the lesson claims right, and breaks `breakCanaries` Context-dependent canaries (with their Self-contained twins) and `breakCases` active
 * Hypothetical cases. `noisy: { cases, wrongRuns }` makes that many more active Hypothetical cases borderline: the candidate judges them wrong in exactly
 * these runs (numbered per claim and rubric, 1 to N) and right in the others, the baseline always right. `noisyFixed: { cases, rightRuns }` makes the first
 * `cases` lesson claims only seem fixed: the candidate is right about them in exactly these runs.
 */
function scenario(w, { fixed = 4, breakCanaries = 0, breakCases = 0, noisy = null, noisyFixed = null, ...stubOptions } = {}) {
  const cases = casesOf(w);
  const canaries = canariesOf(w);
  const labels = labelMap([...cases, ...canaries]);
  const lessonCases = cases.filter((c) => c.contested && c.contested_lesson === LESSON_TITLE);
  const lessonClaims = new Set(lessonCases.map((c) => normClaim(c.claim)));
  const fixedClaims = new Set(lessonCases.slice(0, fixed).map((c) => normClaim(c.claim)));
  const brokenCanaries = new Set(canaries.filter((c) => c.tag === 'Context-dependent' && c.expected === 'apply').slice(0, breakCanaries).map((c) => normClaim(c.claim)));
  const brokenCases = new Set(cases.filter((c) => c.active && c.tag === 'Hypothetical' && c.expected === 'apply').slice(0, breakCases).map((c) => normClaim(c.claim)));
  const noisyFixedClaims = new Set(lessonCases.slice(0, noisyFixed?.cases ?? 0).map((c) => normClaim(c.claim)));
  const noisyClaims = new Set(cases.filter((c) => c.active && c.tag === 'Hypothetical' && c.expected === 'apply').slice(breakCases, breakCases + (noisy?.cases ?? 0)).map((c) => normClaim(c.claim)));
  return makeJudgeStub({
    ...stubOptions,
    decide: ({ claim, tag, version, run }) => {
      const want = labelOf(labels, claim, tag);
      if (!want) return undefined;
      const candidate = version !== LIVE;
      const c = normClaim(claim);
      if (tag === 'Predictive' && lessonClaims.has(c)) {
        if (candidate && noisyFixedClaims.has(c)) return noisyFixed.rightRuns.includes(run) ? want : opposite(want);
        return candidate && fixedClaims.has(c) ? want : opposite(want);
      }
      if (candidate && ((['Context-dependent', 'Self-contained'].includes(tag) && brokenCanaries.has(c)) || (tag === 'Hypothetical' && brokenCases.has(c)))) return opposite(want);
      if (candidate && tag === 'Hypothetical' && noisyClaims.has(c) && noisy.wrongRuns.includes(run)) return opposite(want);
      return want;
    },
  });
}

const promote = async (w, argv, stub, extra = {}) => {
  const c = captureIo();
  const code = await main(argv, c.io, w.env({ ...(stub ? { runClaude: stub } : {}), ...extra }));
  return { code, out: c.out, err: c.err, text: c.out.join('\n') };
};
const lessonArgs = (runId, ...more) => ['--lesson', LESSON_TITLE, '--driver', 'fake', '--run-id', runId, ...more];
/** A promote world whose gate asks for `runs` extra runs (0: none) for at most `max` flipped cases, whatever config.json says today. */
const reconfirmWorld = (runs = 5, max = 16) => makePromoteWorld({ config: (cfg) => { cfg.gate.reconfirm_runs = runs; cfg.gate.reconfirm_max = max; } });

async function applyPlan(w, runId, pullId) {
  const chk = planCheck({ root: w.root, runId, now: w.clock.now });
  assert.equal(chk.code, EXIT.OK, (chk.problems ?? []).join('; '));
  const cap = captureIo();
  const code = await applyMain(['--run', runId], cap.io, w.env());
  assert.equal(code, EXIT.OK, `${cap.out.join('\n')}\n${cap.err.join('\n')}`);
  await w.pull(pullId);
  return cap.out[0];
}

/** (database, property) pairs a plan writes, as { db: [sorted property names] }. */
function writtenFields(w, runId) {
  const by = {};
  for (const op of readPlan(w.root, runId).ops) by[op.database] = [...new Set([...(by[op.database] ?? []), ...Object.keys(op.properties)])].sort();
  return by;
}
const opsFor = (w, runId, db) => readPlan(w.root, runId).ops.filter((o) => o.database === db);

// ---- the helpers --------------------------------------------------------------------------------------------------------------------------------

test('resolveLesson finds a lesson by its title or its Lesson ID; checkLesson names the first thing that is wrong', async () => {
  const { w } = await makePromoteWorld();
  const pull = loadPull(w.root, 'p1');
  assert.equal(resolveLesson(pull, LESSON_TITLE).lesson_id, 'LS-1');
  assert.equal(resolveLesson(pull, 'ls-1').lesson_key, LESSON_TITLE);
  assert.throws(() => resolveLesson(pull, 'LS-9'), (e) => e.code === EXIT.INVALID && /no lesson "LS-9" in pull p1 \(known: LS-1 "Hedged trajectories are not forecasts" \(Approved\)\)/.test(e.message));
  const lesson = resolveLesson(pull, 'LS-1');
  const rubric = liveRubric();
  const ok = checkLesson({ lesson, rubric });
  assert.deepEqual(ok.target, { part: 'rule', rule_n: 1 });
  assert.equal(ok.text, LESSON_RULE_TEXT);
  assert.equal(effectiveText({ editor_wording: ' Mine. ', proposed_text: 'Theirs.' }), ' Mine. ');
  assert.equal(effectiveText({ editor_wording: '  ', proposed_text: 'Theirs.' }), 'Theirs.');
  assert.equal(effectiveText({ editor_wording: null, proposed_text: 'Theirs.' }), 'Theirs.');
  const bad = (change, pattern) => assert.throws(() => checkLesson({ lesson: { ...lesson, ...change }, rubric }), (e) => e.code === EXIT.INVALID && pattern.test(e.message), JSON.stringify(change));
  bad({ status: 'Proposed' }, /has Status Proposed, not Approved/);
  bad({ status: null }, /has Status empty, not Approved/);
  bad({ kind: 'New or promoted tag' }, /changes the rules of existing tags only/);
  bad({ tag: 'No such tag' }, /not in the live rubric/);
  bad({ rule_label: 'Predictive paragraph 3' }, /must read "Predictive rule <n>" or "Predictive when to use"/);
  bad({ rule_label: 'Predictive rule 99' }, /has no Predictive rule 99/);
  bad({ current_text: '1. An older text of the rule.' }, /is stale: its Current text is not what the live rubric \(2026-10-13\.1\) says for Predictive rule 1/);
  bad({ proposed_text: '', editor_wording: null }, /neither Editor wording nor Proposed text/);
  bad({ editor_wording: 'x'.repeat(1901) }, /the effective text is 1901 characters; the limit is 1900/);
  assert.equal(checkLesson({ lesson: { ...lesson, editor_wording: 'x'.repeat(1900) }, rubric }).text.length, 1900);
});

test('candidateVersion takes the next free version: a version that has a history file is never used again', async () => {
  const { w } = await makePromoteWorld();
  assert.equal(candidateVersion(w.root, LIVE, new Date('2026-10-13T12:00:00Z')), '2026-10-13.2');
  assert.equal(candidateVersion(w.root, LIVE, new Date('2026-10-14T12:00:00Z')), '2026-10-14.1');
  writeFileSync(rootFile(w, 'rubric', 'history', '2026-10-13.2.json'), '{}');
  writeFileSync(rootFile(w, 'rubric', 'history', '2026-10-13.3.json'), '{}');
  assert.equal(candidateVersion(w.root, LIVE, new Date('2026-10-13T12:00:00Z')), '2026-10-13.4');
});

// ---- PASS: the whole road ------------------------------------------------------------------------------------------------------------------------

test('PASS: candidate, items, two judge runs, the card, a plan with exactly the allowed fields, PROMOTING; then apply, finalize and the rubric on disk', async () => {
  const { w, lessonPage, supporting } = await reconfirmWorld(0);
  const stub = scenario(w);
  const rubric = liveRubric();
  const r = await promote(w, lessonArgs('pr1'), stub);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.text, /Verdict: PASS - small sample/);
  assert.match(r.text, /Target Predictive: \+40\.0 points .*fixed 4, broken 0, n 10, 6 positives/);
  assert.match(r.text, /Canaries: 29\/29 pass under the candidate; baseline 29\/29/);
  assert.match(r.text, /promote: PASS \(small sample\): LS-1 -> rubric 2026-10-13\.2; \$0\.3600; plan /);
  assert.match(r.text, /promote: next: node agents\/claim-tagger\/scripts\/plan\.mjs check --run pr1; node agents\/claim-tagger\/scripts\/apply\.mjs --run pr1; node agents\/claim-tagger\/scripts\/promote\.mjs --finalize pr1/);

  // the candidate
  const candidate = readJson(rootFile(w, 'runs', 'pr1', 'candidate', 'rubric.json'));
  assert.equal(checkHashes(candidate).ok, true);
  assert.equal(candidate.rubric_version, '2026-10-13.2');
  assert.notEqual(candidate.rubric_hash, rubric.rubric_hash);
  assert.equal(candidate.scope_hash, rubric.scope_hash, 'the judged scope did not change');
  const changedTags = candidate.tags.filter((t, i) => t.tag_hash !== rubric.tags[i].tag_hash).map((t) => t.name);
  assert.deepEqual(changedTags, ['Predictive'], 'exactly one tag hash changes');
  const rule1 = candidate.tags.find((t) => t.name === 'Predictive').when_to_use.rules[0];
  assert.equal(rule1.text, LESSON_RULE_TEXT);
  assert.equal(rule1.rule_hash, candidate.tags.find((t) => t.name === 'Predictive').when_to_use.rules[0].rule_hash);
  const entry = candidate.changelog.at(-1);
  assert.equal(entry.version, '2026-10-13.2');
  assert.equal(entry.previous_version, LIVE);
  assert.equal(entry.lesson_id, 'LS-1');
  assert.equal(entry.lesson_key, LESSON_TITLE);
  assert.equal(entry.tag, 'Predictive');
  assert.equal(entry.ruleN, 1);
  assert.match(entry.note, /Predictive rule 1 replaced by lesson LS-1 "Hedged trajectories are not forecasts"/);
  assert.equal(readJson(rootFile(w, 'rubric', 'rubric.json')).rubric_version, LIVE, 'the live rubric is untouched until finalize');
  assert.deepEqual(validate(JSON.parse(readFileSync(rootFile(w, 'schemas', 'rubric.schema.json'), 'utf8')), candidate).errors, []);

  // the items: every gate case that will be evaluated, the lesson's cases, the canaries, once each
  const items = readJsonl(rootFile(w, 'runs', 'pr1', 'items.jsonl')).rows;
  const cases = casesOf(w);
  const sel = selectCases(cases, { lesson: LESSON_TITLE, sourceReadingTags: ['Improperly sourced', 'Source inaccessible'] });
  const canaries = selectCanaries(canariesOf(w));
  assert.equal(sel.lessonCases.length, 4);
  const ids = new Set(items.map((i) => i.id));
  assert.equal(ids.size, items.length, 'one item per id');
  for (const c of [...sel.gating, ...sel.lessonCases]) assert.ok(ids.has(c.item), `case ${c.case_id}`);
  for (const c of canaries) assert.ok(ids.has(canaryItemId(c.text)), `canary ${c.canary_id}`);
  assert.equal(items.length, new Set([...sel.gating.map((c) => c.item), ...sel.lessonCases.map((c) => c.item), ...canaries.map((c) => c.item)]).size);
  assert.ok(items.every((i) => i.sources_count === null));
  const lessonClaim = cases.find((c) => c.contested_lesson === LESSON_TITLE).claim;
  assert.ok(items.some((i) => i.claim === lessonClaim), 'the lesson\'s own claim is judged');
  assert.ok(!items.some((i) => cases.some((c) => c.suite === 'not_run' && c.claim === i.claim && !sel.gating.some((g) => g.text === c.claim))), 'nothing from a not_run case');

  // the two judge runs: the live rubric, then the candidate, three runs each, one model
  const base = readJson(rootFile(w, 'runs', 'pr1-baseline', 'run.json'));
  const cand = readJson(rootFile(w, 'runs', 'pr1-candidate', 'run.json'));
  assert.equal(base.rubric_version, LIVE);
  assert.equal(cand.rubric_version, '2026-10-13.2');
  assert.equal(base.runs, 3);
  assert.equal(cand.runs, 3);
  assert.equal(base.model, cand.model);
  assert.equal(base.model, 'claude-sonnet-5-5');
  assert.notEqual(base.config16, cand.config16);
  assert.equal(cand.rubric_path, rootFile(w, 'runs', 'pr1', 'candidate', 'rubric.json'));
  assert.deepEqual(new Set(stub.calls.map((c) => c.version)), new Set([LIVE, '2026-10-13.2']));

  // the card
  const card = readJson(rootFile(w, 'runs', 'pr1', 'card.json'));
  assert.deepEqual(validate(cardSchema, card).errors, []);
  assert.equal(card.verdict, 'PASS');
  assert.equal(card.lesson, LESSON_TITLE);
  assert.equal(card.target, 'Predictive');
  assert.equal(card.smoke, false);
  assert.equal(card.small_sample, true);
  assert.equal(card.cost.usd, 0.36);
  assert.equal(card.cost.model, 'claude-sonnet-5-5');
  const md = readFileSync(rootFile(w, 'runs', 'pr1', 'card.md'), 'utf8');
  assert.ok(md.length <= 1900);
  assert.equal(r.out.find((l) => l.startsWith('Verdict:')) !== undefined, true);

  // the plan: exactly the allowed fields, under the PASS context
  const { header, ops } = readPlan(w.root, 'pr1');
  assert.deepEqual(header.ctx, { seed: false, promote: true, gate: 'PASS' });
  assert.deepEqual(writtenFields(w, 'pr1'), {
    agent_settings: ['Last run at', 'Last run summary', 'Rubric in force'],
    rule_changes: ['Gate result', 'Rubric version', 'Status'],
    rulebook: ['Changed by', 'Rule version', 'Tag hash', 'When to use'],
    runs: ['Canaries', 'Claims judged', 'Cost USD', 'Kind', 'Lesson', 'Model', 'Newly failing', 'Per-tag summary', 'Rubric version', 'Run title', 'Started', 'Summary', 'Verdict'],
    tag_decisions: ['In regression suite'],
  });
  for (const op of ops) for (const name of Object.keys(op.properties)) assert.equal(EDITOR_NAMES.has(name), false, `${op.database}.${name} is editor-owned`);
  const [rulebook] = opsFor(w, 'pr1', 'rulebook');
  assert.equal(rulebook.key, 'Predictive');
  assert.equal(rulebook.properties['When to use'], composeWhenToUse(candidate.tags.find((t) => t.name === 'Predictive').when_to_use));
  assert.equal(rulebook.properties['Rule version'], '2026-10-13.2');
  assert.equal(rulebook.properties['Tag hash'], candidate.tags.find((t) => t.name === 'Predictive').tag_hash);
  assert.deepEqual(rulebook.properties['Changed by'], [lessonPage]);
  assert.deepEqual(rulebook.expect, { 'When to use': composeWhenToUse(rubric.tags.find((t) => t.name === 'Predictive').when_to_use) });
  const [lessonOp] = opsFor(w, 'pr1', 'rule_changes');
  assert.equal(lessonOp.properties.Status, 'Live');
  assert.equal(lessonOp.properties['Rubric version'], '2026-10-13.2');
  assert.equal(lessonOp.properties['Gate result'], md.slice(0, 1900));
  assert.deepEqual(lessonOp.expect, { Status: 'Approved' });
  const [runOp] = opsFor(w, 'pr1', 'runs');
  assert.equal(runOp.key, 'Gate 2026-10-13.2 · LS-1');
  assert.equal(runOp.properties.Kind, 'Gate');
  assert.equal(runOp.properties.Verdict, 'PASS');
  assert.equal(runOp.properties['Rubric version'], '2026-10-13.1 → 2026-10-13.2');
  assert.equal(runOp.properties['Claims judged'], items.length);
  assert.equal(runOp.properties.Canaries, '29 of 29');
  assert.equal(runOp.properties['Newly failing'], 0);
  assert.equal(runOp.properties.Summary, lessonOp.properties['Gate result']);
  assert.equal(runOp.properties.Model, 'claude-sonnet-5-5');
  assert.equal(runOp.properties['Cost USD'], 0.36);
  assert.deepEqual(runOp.properties.Lesson, [lessonPage]);
  assert.match(runOp.properties['Per-tag summary'], /^Hypothetical: 100\.0% -> 100\.0%/m);
  assert.match(runOp.properties['Per-tag summary'], /Predictive: 60\.0% -> 100\.0% \(\+40\.0 points\), fixed 4, broken 0, n 10, 6 positives/);
  assert.match(runOp.content_md, /^## Verdict: PASS - small sample/);
  assert.match(runOp.content_md, /## The five conditions\n1\. PASS: every active canary passes/);
  const rows = opsFor(w, 'pr1', 'tag_decisions');
  assert.deepEqual(rows.map((o) => o.key).sort(), [...supporting].sort());
  assert.ok(rows.every((o) => o.properties['In regression suite'] === '2026-10-13'));
  const [settings] = opsFor(w, 'pr1', 'agent_settings');
  assert.equal(settings.properties['Rubric in force'], '2026-10-13.2');
  for (const op of ops) assert.doesNotThrow(() => assertOpWritable(op, { schema: w.fake.schemas[op.database], ctx: header.ctx }));

  const promoting = readJson(rootFile(w, 'runs', 'PROMOTING.json'));
  assert.equal(promoting.run_id, 'pr1');
  assert.equal(promoting.lesson, LESSON_TITLE);
  assert.equal(promoting.version, '2026-10-13.2');
  assert.equal(promoting.previous_version, LIVE);
  const record = readJson(rootFile(w, 'runs', 'pr1', 'run.json'));
  assert.equal(record.status, 'planned');
  assert.equal(record.verdict, 'PASS');
  assert.equal(record.rolled_back, false);
  assert.equal(statusMain(['--check'], captureIo().io, { root: w.root, now: w.clock.now }), EXIT.INVALID, 'status --check says a promote is in flight');

  // apply: the plan lands, verify is clean, editor fields untouched
  const line = await applyPlan(w, 'pr1', 'p2');
  assert.match(line, /^apply: run pr1: created 1, updated 7, skipped 0, failed 0; verify clean/);
  assert.equal(readJson(rootFile(w, 'runs', 'pr1', 'verify.json')).editor_changes.length, 0);
  assert.equal(w.fake.find('rulebook', 'Predictive').props['Rule version'], '2026-10-13.2');
  assert.equal(w.fake.find('rulebook', 'Debate').props['Rule version'], LIVE, 'the other 13 rows keep the old version');
  assert.deepEqual(w.fake.find('rulebook', 'Predictive').props['Changed by'], [lessonPage]);
  const live = w.fake.find('rule_changes', LESSON_TITLE).props;
  assert.equal(live.Status, 'Live');
  assert.equal(live['Rubric version'], '2026-10-13.2');
  assert.equal(live['Gate result'], md.slice(0, 1900));
  assert.deepEqual(live['Result card'], [w.fake.find('runs', 'Gate 2026-10-13.2 · LS-1').page_id]);
  assert.equal(w.fake.find('agent_settings', 'claim-tagger').props['Rubric in force'], '2026-10-13.2');
  for (const key of supporting) assert.equal(w.fake.find('tag_decisions', key).props['In regression suite'], '2026-10-13');
  assert.equal(readJson(rootFile(w, 'rubric', 'rubric.json')).rubric_version, LIVE, 'still the old file: finalize is the last step');

  // finalize
  const f = await promote(w, ['--finalize', 'pr1'], stub);
  assert.equal(f.code, EXIT.OK, f.err.join('\n'));
  assert.match(f.out[0], /^promote: finalized run pr1: rubric 2026-10-13\.2 sha256:[0-9a-f]{16} is live \(lock ok\); cases: 31 active, 0 contested, 10 hash\(es\) re-stamped/);
  assert.match(f.out[1], /^promote: commit: git add agents\/claim-tagger\/rubric agents\/claim-tagger\/evals && git commit -m "rubric 2026-10-13\.2: LS-1 \(gate PASS, pr1\)"$/);
  const liveRubricNow = readJson(rootFile(w, 'rubric', 'rubric.json'));
  assert.equal(liveRubricNow.rubric_hash, candidate.rubric_hash);
  assert.equal(readFileSync(rootFile(w, 'rubric', 'rubric.json'), 'utf8'), readFileSync(rootFile(w, 'runs', 'pr1', 'candidate', 'rubric.json'), 'utf8'));
  assert.equal(readFileSync(rootFile(w, 'rubric', 'history', '2026-10-13.2.json'), 'utf8'), readFileSync(rootFile(w, 'rubric', 'rubric.json'), 'utf8'));
  assert.ok(existsSync(rootFile(w, 'rubric', 'history', '2026-10-13.1.json')), 'the old version stays in history');
  const lock = readJson(rootFile(w, 'rubric', 'rubric.lock'));
  assert.deepEqual([lock.rubric_version, lock.rubric_hash, lock.scope_hash], ['2026-10-13.2', candidate.rubric_hash, candidate.scope_hash]);
  assert.equal(lock.file_sha256, fileSha256(rootFile(w, 'rubric', 'rubric.json')));
  assert.equal(lock.locked_at, '2026-10-13T12:00:00.000Z', 'the injected clock');
  const changelog = readFileSync(rootFile(w, 'rubric', 'CHANGELOG.md'), 'utf8').trimEnd().split('\n');
  assert.equal(changelog.length, 6);
  assert.match(changelog.at(-1), /^- 2026-10-13\.2 \(2026-10-13\), promote: Predictive rule 1 replaced by lesson LS-1 "Hedged trajectories are not forecasts" \(gate PASS, card pr1\)\. rubric_hash sha256:[0-9a-f]{16}, scope_hash sha256:5cf30ca98835c948\.$/);
  assert.equal(existsSync(rootFile(w, 'runs', 'PROMOTING.json')), false);
  assert.equal(readJson(rootFile(w, 'runs', 'pr1', 'run.json')).status, 'finalized');
  assert.equal(statusMain(['--check'], captureIo().io, { root: w.root, now: w.clock.now }), EXIT.OK, 'no promote in flight, lock ok, Rulebook equals the new rubric');

  // the cases: the lesson is live, so its contested cases are active, every hash is stamped against the new rubric
  const after = casesOf(w);
  assert.equal(after.filter((c) => c.contested).length, 0);
  const lessonCase = after.find((c) => c.contested_lesson === LESSON_TITLE);
  assert.equal(lessonCase.active, true);
  assert.equal(lessonCase.tag_hash, candidate.tags.find((t) => t.name === 'Predictive').tag_hash);
  assert.equal(after.find((c) => c.tag === 'Hypothetical').tag_hash, rubric.tags.find((t) => t.name === 'Hypothetical').tag_hash, 'other tags keep their hash');
  assert.ok(existsSync(rootFile(w, 'runs', 'pr1-cases', 'plan.jsonl')), 'a plan for the rows whose case is a test now (the date was set on the supporting rows already)');

  // and the judgments of the new live rubric are the candidate's: a follow-up is a cache hit
  const followStub = scenario(w);
  const cfg = readJson(rootFile(w, 'runs', 'pr1-candidate', 'run.json')).config16;
  assert.ok(existsSync(rootFile(w, 'runs', 'judgments', cfg, 'run-1')));
  assert.equal(followStub.calls.length, 0);
});

test('Editor wording is tested instead of Proposed text, and a rule number the owner typed is dropped', async () => {
  const { w } = await makePromoteWorld({ lessonOptions: { editorWording: '1. Fires only on a flat marker: will, is expected to, is set to. Hedges ("likely to") never fire it.' } });
  const stub = scenario(w);
  const r = await promote(w, lessonArgs('pr1'), stub);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const candidate = readJson(rootFile(w, 'runs', 'pr1', 'candidate', 'rubric.json'));
  assert.equal(candidate.tags.find((t) => t.name === 'Predictive').when_to_use.rules[0].text, 'Fires only on a flat marker: will, is expected to, is set to. Hedges ("likely to") never fire it.');
  assert.equal(readJson(rootFile(w, 'runs', 'pr1', 'candidate', 'rubric.json')).changelog.at(-1).ruleN, 1);
});

test('a lesson on the whole When to use replaces all of it', async () => {
  const rubric = liveRubric();
  const pred = rubric.tags.find((t) => t.name === 'Predictive');
  const whole = `${pred.when_to_use.preamble}\n1. Fires only on a flat marker.\n2. A hedged tendency never fires.\nNote: Edited as a whole.`;
  const { w } = await makePromoteWorld({ lessonOptions: { rule: 'Predictive when to use', current: composeWhenToUse(pred.when_to_use), proposed: whole } });
  const r = await promote(w, lessonArgs('pr1'), scenario(w));
  assert.ok([EXIT.OK, EXIT.HOLD, EXIT.FAIL].includes(r.code), r.err.join('\n'));
  const candidate = readJson(rootFile(w, 'runs', 'pr1', 'candidate', 'rubric.json'));
  const tag = candidate.tags.find((t) => t.name === 'Predictive');
  assert.equal(tag.when_to_use.rules.length, 2);
  assert.equal(tag.when_to_use.note, 'Edited as a whole.');
  assert.equal(candidate.changelog.at(-1).ruleN, null);
});

// ---- HOLD, FAIL, smoke --------------------------------------------------------------------------------------------------------------------------------

test('HOLD: only the Runs row and the lesson\'s Gate result are written; the lesson stays Approved; the candidate is marked rolled back; no PROMOTING', async () => {
  const { w } = await makePromoteWorld();
  const r = await promote(w, lessonArgs('pr1'), scenario(w, { fixed: 2 }));
  assert.equal(r.code, EXIT.HOLD, r.err.join('\n'));
  assert.match(r.text, /Verdict: HOLD/);
  assert.match(r.text, /HOLD: Predictive: interval straddles zero/);
  assert.match(r.text, /promote: HOLD \(small sample\): LS-1 stays Approved; the Rulebook is untouched; /);
  assert.match(r.text, /\(only the card and the Gate result are written\)/);
  const { header } = readPlan(w.root, 'pr1');
  assert.deepEqual(header.ctx, { seed: false, promote: false, gate: null }, 'no promote context: the allowlist would refuse the Rulebook');
  assert.deepEqual(writtenFields(w, 'pr1'), {
    rule_changes: ['Gate result'],
    runs: ['Canaries', 'Claims judged', 'Cost USD', 'Kind', 'Lesson', 'Model', 'Newly failing', 'Per-tag summary', 'Rubric version', 'Run title', 'Started', 'Summary', 'Verdict'],
  });
  assert.equal(existsSync(rootFile(w, 'runs', 'PROMOTING.json')), false);
  assert.equal(readJson(rootFile(w, 'runs', 'pr1', 'run.json')).rolled_back, true);
  assert.equal(readJson(rootFile(w, 'runs', 'pr1', 'candidate', 'run.json')).rolled_back, true);
  assert.equal(readJson(rootFile(w, 'runs', 'pr1', 'run.json')).lesson_status_set, 'Approved');
  await applyPlan(w, 'pr1', 'p2');
  const lesson = w.fake.find('rule_changes', LESSON_TITLE).props;
  assert.equal(lesson.Status, 'Approved');
  assert.match(lesson['Gate result'], /^Verdict: HOLD/);
  const run = w.fake.find('runs', 'Gate 2026-10-13.2 · LS-1').props;
  assert.equal(run.Verdict, 'HOLD');
  assert.match(run.Summary, /^Verdict: HOLD/);
  assert.equal(w.fake.find('rulebook', 'Predictive').props['Rule version'], LIVE);
  assert.deepEqual(w.fake.find('rulebook', 'Predictive').props['Changed by'], []);
  assert.equal(readJson(rootFile(w, 'rubric', 'rubric.json')).rubric_version, LIVE);
  // finalize refuses a run that was not a PASS
  const f = await promote(w, ['--finalize', 'pr1']);
  assert.equal(f.code, EXIT.INVALID);
  assert.match(f.err.join('\n'), /runs\/PROMOTING\.json does not exist/);
});

test('FAIL on canaries: exit 11, the lesson stays Approved, Rolled back only with --mark-rolled-back or when it is the planted demo lesson', async () => {
  const { w } = await makePromoteWorld();
  const r = await promote(w, lessonArgs('pr1'), scenario(w, { breakCanaries: 2 }));
  assert.equal(r.code, EXIT.FAIL, r.err.join('\n'));
  assert.match(r.text, /Verdict: FAIL/);
  assert.match(r.text, /Canaries: 25\/29 pass under the candidate \(failing: /);
  assert.match(r.text, /FAIL: 4 canaries fail/);
  assert.equal(readPlan(w.root, 'pr1').ops.find((o) => o.database === 'rule_changes').properties.Status, undefined);
  assert.match(r.text, /LS-1 stays Approved/);
  const card = readJson(rootFile(w, 'runs', 'pr1', 'card.json'));
  assert.equal(card.canaries.candidate.failing.length, 4, 'two Context-dependent canaries and their two Self-contained twins');
  assert.deepEqual(writtenFields(w, 'pr1').rule_changes, ['Gate result']);
  assert.equal(readPlan(w.root, 'pr1').header.ctx.promote, false);

  await applyPlan(w, 'pr1', 'p2');
  assert.equal(w.fake.find('rule_changes', LESSON_TITLE).props.Status, 'Approved');
  assert.equal(w.fake.find('runs', 'Gate 2026-10-13.2 · LS-1').props.Verdict, 'FAIL');

  const marked = await promote(w, lessonArgs('pr2', '--mark-rolled-back'), scenario(w, { breakCanaries: 2 }));
  assert.equal(marked.code, EXIT.FAIL);
  const op = opsFor(w, 'pr2', 'rule_changes')[0];
  assert.equal(op.properties.Status, 'Rolled back');
  assert.deepEqual(op.expect, { Status: 'Approved' });
  assert.match(marked.text, /LS-1 stays Rolled back/);
  assert.equal(opsFor(w, 'pr2', 'runs')[0].key, 'Gate 2026-10-13.2 · LS-1 (2)', 'the second card of the same candidate version has its own row');
  await applyPlan(w, 'pr2', 'p3');
  assert.equal(w.fake.find('rule_changes', LESSON_TITLE).props.Status, 'Rolled back');
  assert.equal(w.fake.find('rulebook', 'Predictive').props['Rule version'], LIVE);
  assert.equal(w.fake.find('runs', 'Gate 2026-10-13.2 · LS-1 (2)').props.Verdict, 'FAIL');
});

test('FAIL on a case that passed under the baseline: a newly failing case', async () => {
  const { w } = await makePromoteWorld();
  const r = await promote(w, lessonArgs('pr1'), scenario(w, { breakCases: 1 }));
  assert.equal(r.code, EXIT.FAIL, r.err.join('\n'));
  assert.match(r.text, /Cases newly failing: 1 \(ctr-[0-9a-f]+-hypoth\) of 26 active/);
  assert.match(r.text, /FAIL: 1 regression cases newly failing/);
  assert.equal(opsFor(w, 'pr1', 'runs')[0].properties['Newly failing'], 1);
});

test('the planted demo lesson is marked Rolled back when it fails the gate (its title says deliberately bad); a real lesson that fails stays Approved', async () => {
  const title = 'Gate test (deliberately bad): only pronouns count';
  const { w } = await makePromoteWorld({ lessonOptions: { title } });
  // the candidate breaks two Context-dependent canaries (and their Self-contained twins): a FAIL
  const r = await promote(w, ['--lesson', title, '--driver', 'fake', '--run-id', 'pr1'], scenario(w, { breakCanaries: 2 }));
  assert.equal(r.code, EXIT.FAIL, r.err.join('\n'));
  assert.equal(opsFor(w, 'pr1', 'rule_changes')[0].properties.Status, 'Rolled back');
  assert.match(r.text, /stays Rolled back/);
  await applyPlan(w, 'pr1', 'p2');
  assert.equal(w.fake.find('rule_changes', title).props.Status, 'Rolled back');
  assert.equal(w.fake.find('rulebook', 'Predictive').props['Rule version'], LIVE, 'the Rulebook is untouched');
  assert.deepEqual(w.fake.find('rulebook', 'Predictive').props['Changed by'], []);
  // the same title recorded by distill as a planted lesson (lessons.jsonl of a distill run) counts too
  const { w: w2 } = await makePromoteWorld({ lessonOptions: { title: 'A harmless looking title' } });
  mkdirSync(rootFile(w2, 'runs', 'd1'), { recursive: true });
  writeFileSync(rootFile(w2, 'runs', 'd1', 'lessons.jsonl'), `${JSON.stringify({ lesson_key: 'A harmless looking title', demo: true })}\n`);
  const r2 = await promote(w2, ['--lesson', 'A harmless looking title', '--driver', 'fake', '--run-id', 'pr1'], scenario(w2, { breakCanaries: 2 }));
  assert.equal(r2.code, EXIT.FAIL, r2.err.join('\n'));
  assert.equal(opsFor(w2, 'pr1', 'rule_changes')[0].properties.Status, 'Rolled back');
});

test('--smoke judges once, writes a Smoke row, and can never go live or be finalized', async () => {
  const { w } = await reconfirmWorld(0);
  const stub = scenario(w);
  const r = await promote(w, lessonArgs('pr1', '--smoke'), stub);
  assert.ok([EXIT.OK, EXIT.HOLD].includes(r.code), r.err.join('\n'));
  assert.match(r.text, /smoke: not a gate verdict/);
  const card = readJson(rootFile(w, 'runs', 'pr1', 'card.json'));
  assert.equal(card.smoke, true);
  assert.equal(card.kind, 'smoke');
  assert.equal(card.configs.baseline.config16, readJson(rootFile(w, 'runs', 'pr1-baseline', 'run.json')).config16);
  assert.equal(readJson(rootFile(w, 'runs', 'pr1-baseline', 'run.json')).runs, 1);
  assert.equal(stub.calls.length, 2 * Math.ceil(readJsonl(rootFile(w, 'runs', 'pr1', 'items.jsonl')).rows.length / 8), 'one run per rubric, batches of 8');
  assert.equal(readJson(rootFile(w, 'runs', 'pr1-baseline', 'run.json')).model, 'claude-sonnet-5-5', 'the same model as a real run: the cells are reusable');
  assert.equal(existsSync(rootFile(w, 'runs', 'PROMOTING.json')), false);
  const [run] = opsFor(w, 'pr1', 'runs');
  assert.equal(run.properties.Kind, 'Smoke');
  assert.equal(run.key, 'Smoke 2026-10-13.2 · LS-1');
  assert.deepEqual(writtenFields(w, 'pr1').rulebook, undefined, 'no Rulebook op');
  assert.deepEqual(opsFor(w, 'pr1', 'rule_changes'), [], 'a rehearsal does not touch the lesson row');
  assert.equal(readPlan(w.root, 'pr1').header.ctx.promote, false);
  // even by hand: a PROMOTING.json for a smoke run is refused by finalize, and it blocks the next promote
  writeFileSync(rootFile(w, 'runs', 'PROMOTING.json'), JSON.stringify({ run_id: 'pr1' }));
  const f = await promote(w, ['--finalize', 'pr1']);
  assert.equal(f.code, EXIT.INVALID);
  assert.match(f.err.join('\n'), /is a smoke run: a smoke card can never be finalized/);
  const blocked = await promote(w, lessonArgs('pr2'), stub);
  assert.equal(blocked.code, EXIT.INVALID);
  assert.match(blocked.err.join('\n'), /run pr1 is still promoting/);
  unlinkSync(rootFile(w, 'runs', 'PROMOTING.json'));
  // a full run after the smoke run reuses the first run of every cell: only runs 2 and 3 are judged (two sides, 6 batches of 8 each)
  const calls = stub.calls.length;
  const full = await promote(w, lessonArgs('pr2'), stub);
  assert.equal(full.code, EXIT.OK, full.err.join('\n'));
  assert.equal(stub.calls.length - calls, 2 * 2 * 6);
});

// ---- preconditions -----------------------------------------------------------------------------------------------------------------------------------

test('preconditions: not Approved, stale, too long, the wrong kind, an unknown lesson, a promote of another run in flight', async () => {
  const check = async (setup, pattern, expectCode = EXIT.INVALID) => {
    const { w, lessonPage } = await makePromoteWorld();
    await setup(w, lessonPage);
    await w.pull('p2');
    const stub = scenario(w);
    const r = await promote(w, lessonArgs('pr1'), stub);
    assert.equal(r.code, expectCode, `${pattern}: ${r.err.join('\n')}`);
    assert.match(r.err.join('\n'), pattern);
    assert.equal(stub.calls.length, 0, 'no model call was spent');
    assert.equal(existsSync(rootFile(w, 'runs', 'pr1', 'plan.jsonl')), false);
    return w;
  };
  await check((w, id) => w.setLessonStatus(id, 'Proposed'), /has Status Proposed, not Approved/);
  await check((w, id) => w.setLessonStatus(id, 'Rejected'), /has Status Rejected, not Approved/);
  await check((w, id) => w.setLessonStatus(id, 'Live'), /has Status Live, not Approved/);
  await check((w, id) => w.fake.editorSet(id, { 'Current text': '1. An older wording of the rule.' }), /is stale/);
  await check((w, id) => w.fake.editorSet(id, { 'Editor wording': 'x'.repeat(1901) }), /the effective text is 1901 characters; the limit is 1900/);
  await check((w, id) => w.fake.editorSet(id, { Kind: 'New or promoted tag' }), /changes the rules of existing tags only/);
  await check((w, id) => w.fake.editorSet(id, { Rule: 'Predictive paragraph 3' }), /must read "Predictive rule <n>"/);
  await check((w) => writeFileSync(rootFile(w, 'runs', 'PROMOTING.json'), JSON.stringify({ run_id: 'other-run' })), /run other-run is still promoting/);

  const { w } = await makePromoteWorld();
  const r = await promote(w, ['--lesson', 'LS-42', '--driver', 'fake', '--run-id', 'pr1'], scenario(w));
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /no lesson "LS-42" in pull p1/);
});

test('promote stops first when the agent is paused or the rubric does not match its lock', async () => {
  const { w } = await makePromoteWorld();
  const stub = scenario(w);
  writeFileSync(rootFile(w, 'runs', 'PAUSED'), '{}');
  let r = await promote(w, lessonArgs('pr1'), stub);
  assert.equal(r.code, EXIT.PAUSED);
  writeFileSync(rootFile(w, 'runs', 'PAUSED'), '');
  r = await promote(w, lessonArgs('pr1'), stub);
  assert.equal(r.code, EXIT.PAUSED, 'an empty PAUSED file still pauses');
  unlinkSync(rootFile(w, 'runs', 'PAUSED'));
  writeFileSync(rootFile(w, 'rubric', 'rubric.lock'), '{}');
  r = await promote(w, lessonArgs('pr1'), stub);
  assert.equal(r.code, EXIT.DRIFT);
  assert.equal(stub.calls.length, 0);
});

test('a run id that exists is refused unless --resume; a pull without what promote needs is named', async () => {
  const { w } = await makePromoteWorld();
  const stub = scenario(w, { fixed: 2 });
  assert.equal((await promote(w, lessonArgs('pr1'), stub)).code, EXIT.HOLD);
  const again = await promote(w, lessonArgs('pr1'), stub);
  assert.equal(again.code, EXIT.INVALID);
  assert.match(again.err.join('\n'), /run id pr1 already exists; use --resume to continue it or pick another id/);
  const noResume = await promote(w, ['--lesson', LESSON_TITLE, '--driver', 'fake', '--resume'], stub);
  assert.equal(noResume.code, EXIT.INVALID, 'the only run of this lesson is finished, so there is nothing to resume');
  assert.match(noResume.err.join('\n'), /--resume found no unfinished promote run for "Hedged trajectories are not forecasts"; pass --run-id/);
  await w.pull('p2', ['rulebook', 'claims']);
  const r = await promote(w, lessonArgs('pr2'), stub);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /pull p2 does not include rule_changes: run pull\.mjs --dbs rulebook,rule_changes,tag_decisions first/);
});

// ---- the cache, the usage window, resume --------------------------------------------------------------------------------------------------------------

test('a second promote of the same lesson judges nothing: both sides are cache hits; a changed wording judges only the candidate', async () => {
  const { w, lessonPage } = await makePromoteWorld();
  const stub = scenario(w, { fixed: 2 });
  assert.equal((await promote(w, lessonArgs('pr1'), stub)).code, EXIT.HOLD);
  const first = stub.calls.length;
  assert.ok(first > 0);
  const second = await promote(w, lessonArgs('pr2'), stub);
  assert.equal(second.code, EXIT.HOLD);
  assert.equal(stub.calls.length, first, 'the second run made no model call');
  assert.equal(readJson(rootFile(w, 'runs', 'pr2-baseline', 'run.json')).cost_usd, 0);
  assert.equal(readJson(rootFile(w, 'runs', 'pr2', 'card.json')).cost.usd, 0);

  w.fake.editorSet(lessonPage, { 'Editor wording': 'Fires only on a flat marker: will, is expected to. A hedge never fires it.' });
  await w.pull('p2');
  const third = await promote(w, lessonArgs('pr3'), stub);
  assert.equal(third.code, EXIT.HOLD);
  const added = stub.calls.slice(first);
  assert.ok(added.length > 0 && added.every((c) => c.version === '2026-10-13.2'), 'only the new candidate was judged');
  assert.equal(readJson(rootFile(w, 'runs', 'pr3-baseline', 'run.json')).cost_usd, 0, 'the baseline stayed a cache hit');
});

test('the usage window stops the run with exit 75 and the resume command; --resume finishes it', async () => {
  const { w } = await reconfirmWorld(0);
  const limited = scenario(w, { failWith: 'usage_window', failAfter: 6 });
  const r = await promote(w, lessonArgs('pr1'), limited);
  assert.equal(r.code, EXIT.USAGE_WINDOW, r.err.join('\n'));
  assert.match(r.err.join('\n'), /the usage window ran out while judging the baseline; the finished judgments are kept\. Resume when it reopens: node agents\/claim-tagger\/scripts\/promote\.mjs --lesson "Hedged trajectories are not forecasts" --resume --run-id pr1 --driver fake/);
  assert.equal(existsSync(rootFile(w, 'runs', 'pr1', 'plan.jsonl')), false);
  assert.equal(readJson(rootFile(w, 'runs', 'pr1', 'run.json')).status, 'judging');
  const healthy = scenario(w);
  const done = await promote(w, ['--lesson', LESSON_TITLE, '--driver', 'fake', '--resume'], healthy);
  assert.equal(done.code, EXIT.OK, done.err.join('\n'));
  assert.equal(readJson(rootFile(w, 'runs', 'pr1', 'run.json')).status, 'planned', '--resume found the unfinished run of this lesson without a run id');
  assert.ok(healthy.calls.length > 0 && healthy.calls.length < 2 * Math.ceil(readJsonl(rootFile(w, 'runs', 'pr1', 'items.jsonl')).rows.length / 8) * 3, 'the cells that were done were not judged again');
  assert.ok(existsSync(rootFile(w, 'runs', 'PROMOTING.json')));
});

test('the wrong model answering stops the run with exit 4', async () => {
  const { w } = await makePromoteWorld();
  const wrong = async (opts) => ({ ok: false, errorKind: 'model_mismatch', message: 'asked for the pinned model but modelUsage lists another', text: '', costUsd: 0, durationMs: 1, modelUsage: null, ...opts && {} });
  const r = await promote(w, lessonArgs('pr1'), wrong);
  assert.equal(r.code, EXIT.DRIFT);
  assert.match(r.err.join('\n'), /the baseline judge stopped: the rubric or the model did not match/);
});

// ---- reconfirmation of flipped cases ------------------------------------------------------------------------------------------------------------------

/** The index-th active Hypothetical case that the scenario's `noisy` option makes borderline. */
const noisyCaseOf = (w, index = 0) => casesOf(w).filter((c) => c.active && c.tag === 'Hypothetical' && c.expected === 'apply')[index];
/** The four lesson cases (the rows behind the lesson, expected do_not_apply), which the scenario's candidate fixes. */
const lessonCasesOf = (w) => casesOf(w).filter((c) => c.contested && c.contested_lesson === LESSON_TITLE);
const cardOf = (w, runId) => readJson(rootFile(w, 'runs', runId, 'card.json'));
const ofFlip = (card, flip) => card.reconfirmed.filter((x) => x.flip === flip);
const FIXED_FOR_GOOD = { tag: 'Predictive', flip: 'fixed', baseline: { runs: 8, decision: 'apply' }, candidate: { runs: 8, decision: 'do_not_apply' }, outcome: 'confirmed' };

test('reconfirmation: a 2:1 flip that was noise goes away with five more runs while the four fixed lesson cases hold; FAIL becomes PASS and only those claims are judged again', async () => {
  const { w } = await reconfirmWorld();
  const flipped = noisyCaseOf(w);
  const lessonCases = lessonCasesOf(w);
  const r = await promote(w, lessonArgs('pr1'), scenario(w, { noisy: { cases: 1, wrongRuns: [1, 2] } }));
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const card = cardOf(w, 'pr1');
  const ids = card.reconfirmed.map((x) => x.case_id);
  assert.deepEqual(ids, [flipped.case_id, ...lessonCases.map((c) => c.case_id).sort()], 'harm first, then improvement, each in case-id order');
  assert.match(r.text, /promote: first pass FAIL: 5 flipped case\(s\) \(1 broken, 4 fixed\); judging 5 of them again/);
  assert.ok(r.text.includes(`(${ids.join(', ')}) with 5 more run(s) per rubric, 8 in all`), r.text);
  assert.match(r.text, /promote: reconfirmation: 1 flip\(s\) were noise, 4 confirmed; the verdict after reconfirmation \(PASS\) is the one that counts, not the first pass \(FAIL\)/);

  assert.equal(card.verdict, 'PASS');
  assert.deepEqual(ofFlip(card, 'broken'), [{ case_id: flipped.case_id, tag: 'Hypothetical', flip: 'broken', baseline: { runs: 8, decision: 'apply' }, candidate: { runs: 8, decision: 'apply' }, outcome: 'noise' }]);
  assert.deepEqual(ofFlip(card, 'fixed').map(({ case_id, ...rest }) => rest), Array(4).fill(FIXED_FOR_GOOD));
  assert.deepEqual(card.cases.newly_failing, []);
  const used = Object.fromEntries(card.cases.items.map((i) => [i.case_id, i.runs_used]));
  for (const id of ids) assert.deepEqual(used[id], { baseline: 8, candidate: 8 }, id);
  assert.ok(card.cases.items.filter((i) => !ids.includes(i.case_id)).every((i) => i.runs_used.baseline === 3 && i.runs_used.candidate === 3), 'every other case keeps its three runs');
  assert.deepEqual(validate(cardSchema, card), { ok: true, errors: [] });
  const md = readFileSync(rootFile(w, 'runs', 'pr1', 'card.md'), 'utf8');
  assert.match(md, /Reconfirmed .*: baseline apply over 8 runs, candidate apply over 8 runs: broken flip was noise/);
  assert.match(md, /Reconfirmed .*: baseline apply over 8 runs, candidate do_not_apply over 8 runs: fixed flip confirmed/);

  // what was judged again: those five claims, five more runs under each rubric, nothing else
  const rows = readJsonl(rootFile(w, 'runs', 'pr1', 'reconfirm-items.jsonl')).rows;
  assert.deepEqual(new Set(rows.map((i) => i.id)), new Set([flipped.geo_id, ...lessonCases.map((c) => c.geo_id)]));
  for (const side of ['baseline', 'candidate']) {
    const meta = readJson(rootFile(w, 'runs', `pr1-reconfirm-${side}`, 'run.json'));
    assert.equal(meta.runs, 8);
    assert.equal(meta.items.length, 5);
    assert.deepEqual([meta.counts.done, meta.counts.skipped, meta.counts.error], [25, 15, 0], side);
  }

  // the record, the cost, and a plan that is a PASS plan because the second verdict counts
  assert.deepEqual(readJson(rootFile(w, 'runs', 'pr1', 'run.json')).reconfirm, {
    runs: 5, max: 16, flipped: 5, broken: 1, fixed: 4, cases: ids, not_judged: [], over_cap: 0, first_verdict: 'FAIL', verdict: 'PASS', noise: 1, confirmed: 4, cost_usd: 0.1,
    items: 'reconfirm-items.jsonl', baseline_run: 'pr1-reconfirm-baseline', candidate_run: 'pr1-reconfirm-candidate',
  });
  assert.equal(card.cost.reconfirm_usd, 0.1);
  assert.ok(Math.abs(card.cost.usd - (card.cost.baseline_usd + card.cost.candidate_usd)) < 1e-9, 'the reconfirmation is part of the cost of each rubric');
  assert.deepEqual(readPlan(w.root, 'pr1').header.ctx, { seed: false, promote: true, gate: 'PASS' });
  assert.equal(opsFor(w, 'pr1', 'runs')[0].properties['Newly failing'], 0);
  assert.ok(existsSync(rootFile(w, 'runs', 'PROMOTING.json')));
});

test('a PASS that rests on the reconfirmation goes through apply and finalize, and the Runs row page lists every reconfirmed case', async () => {
  const { w } = await reconfirmWorld();
  const stub = scenario(w, { noisy: { cases: 1, wrongRuns: [1, 2] } });
  const r = await promote(w, lessonArgs('pr1'), stub);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const page = opsFor(w, 'pr1', 'runs')[0].content_md;
  assert.match(page, /## Reconfirmed with more runs \(harm and improvement alike\)/);
  assert.equal(page.split('\n').filter((l) => /^- ctr-.*: (broken|fixed) flip (was noise|confirmed); baseline /.test(l)).length, 5);
  await applyPlan(w, 'pr1', 'p2');
  const f = await promote(w, ['--finalize', 'pr1'], stub);
  assert.equal(f.code, EXIT.OK, f.err.join('\n'));
  assert.equal(readJson(rootFile(w, 'rubric', 'rubric.json')).rubric_version, '2026-10-13.2');
  assert.equal(existsSync(rootFile(w, 'runs', 'PROMOTING.json')), false);
});

test('reconfirmation: a flip that stays with eight runs is confirmed; FAIL stays FAIL, the card and the Notion row say so, and the log says the first pass said the same', async () => {
  const { w } = await reconfirmWorld();
  const flipped = noisyCaseOf(w);
  const r = await promote(w, lessonArgs('pr1'), scenario(w, { noisy: { cases: 1, wrongRuns: [1, 2, 4, 5, 6, 7] } }));
  assert.equal(r.code, EXIT.FAIL, r.err.join('\n'));
  assert.match(r.text, /promote: reconfirmation: 0 flip\(s\) were noise, 5 confirmed; the verdict after reconfirmation \(FAIL\) is the one that counts \(the first pass said the same\)/);
  assert.match(r.text, /FAIL: 1 regression cases newly failing/);
  const card = cardOf(w, 'pr1');
  assert.deepEqual(ofFlip(card, 'broken'), [{ case_id: flipped.case_id, tag: 'Hypothetical', flip: 'broken', baseline: { runs: 8, decision: 'apply' }, candidate: { runs: 8, decision: 'do_not_apply' }, outcome: 'confirmed' }]);
  assert.deepEqual(card.cases.newly_failing, [flipped.case_id]);
  assert.equal(readPlan(w.root, 'pr1').header.ctx.promote, false);
  assert.equal(existsSync(rootFile(w, 'runs', 'PROMOTING.json')), false);
  await applyPlan(w, 'pr1', 'p2');
  const run = w.fake.find('runs', 'Gate 2026-10-13.2 · LS-1').props;
  assert.equal(run.Verdict, 'FAIL');
  assert.equal(run['Newly failing'], 1);
  assert.match(run.Summary, /Reconfirmed .*: baseline apply over 8 runs, candidate do_not_apply over 8 runs: broken flip confirmed/);
  assert.match(w.fake.find('rule_changes', LESSON_TITLE).props['Gate result'], /Reconfirmed /);
});

test('reconfirmation holds improvement to the same standard: lesson cases that only seemed fixed are re-rolled, and PASS becomes HOLD', async () => {
  const { w } = await reconfirmWorld();
  const [first, second] = lessonCasesOf(w);
  const r = await promote(w, lessonArgs('pr1'), scenario(w, { noisyFixed: { cases: 2, rightRuns: [1, 2] } }));
  assert.equal(r.code, EXIT.HOLD, r.err.join('\n'));
  assert.match(r.text, /promote: first pass PASS: 4 flipped case\(s\) \(0 broken, 4 fixed\); judging 4 of them again/);
  assert.match(r.text, /promote: reconfirmation: 2 flip\(s\) were noise, 2 confirmed; the verdict after reconfirmation \(HOLD\) is the one that counts, not the first pass \(PASS\)/);
  const card = cardOf(w, 'pr1');
  assert.equal(card.verdict, 'HOLD');
  for (const seemed of [first, second]) {
    assert.deepEqual(card.reconfirmed.find((x) => x.case_id === seemed.case_id), { case_id: seemed.case_id, tag: 'Predictive', flip: 'fixed', baseline: { runs: 8, decision: 'apply' }, candidate: { runs: 8, decision: 'apply' }, outcome: 'noise' });
  }
  assert.equal(card.reconfirmed.filter((x) => x.outcome === 'confirmed').length, 2);
  assert.equal(card.per_tag.find((t) => t.tag === 'Predictive').fixed.length, 2, 'the two that only seemed fixed are not counted');
  assert.match(r.text, /HOLD: Predictive: interval straddles zero/);
  assert.equal(readJson(rootFile(w, 'runs', 'pr1', 'run.json')).reconfirm.first_verdict, 'PASS');
  assert.equal(existsSync(rootFile(w, 'runs', 'PROMOTING.json')), false, 'a HOLD never goes live');
});

test('reconfirmation switched off (gate.reconfirm_runs 0): the old behaviour; the 2:1 flip fails the gate at once and nothing is judged again', async () => {
  const { w } = await reconfirmWorld(0);
  const r = await promote(w, lessonArgs('pr1'), scenario(w, { noisy: { cases: 1, wrongRuns: [1, 2] } }));
  assert.equal(r.code, EXIT.FAIL, r.err.join('\n'));
  assert.doesNotMatch(r.text, /first pass|reconfirm/i);
  const card = cardOf(w, 'pr1');
  assert.equal('reconfirmed' in card, false);
  assert.equal('reconfirm_usd' in card.cost, false);
  assert.deepEqual(card.cases.newly_failing, [noisyCaseOf(w).case_id]);
  assert.ok(card.cases.items.every((i) => i.runs_used.baseline === 3 && i.runs_used.candidate === 3));
  assert.equal(existsSync(rootFile(w, 'runs', 'pr1', 'reconfirm-items.jsonl')), false);
  assert.equal(existsSync(rootFile(w, 'runs', 'pr1-reconfirm-baseline')), false);
  assert.equal('reconfirm' in readJson(rootFile(w, 'runs', 'pr1', 'run.json')), false);
});

test('reconfirmation is capped at gate.reconfirm_max cases per run, harm first; the others count as they are, and the log says so', async () => {
  const { w } = await reconfirmWorld(5, 1);
  const [first, second] = [noisyCaseOf(w, 0).case_id, noisyCaseOf(w, 1).case_id].sort();
  const r = await promote(w, lessonArgs('pr1'), scenario(w, { noisy: { cases: 2, wrongRuns: [1, 2] } }));
  assert.equal(r.code, EXIT.FAIL, r.err.join('\n'));
  assert.match(r.text, /first pass FAIL: 6 flipped case\(s\) \(2 broken, 4 fixed\); judging 1 of them again/);
  assert.match(r.text, /5 more beyond gate\.reconfirm_max \(1\) count as they are/);
  const card = cardOf(w, 'pr1');
  assert.deepEqual(card.reconfirmed.map((x) => [x.case_id, x.flip, x.outcome]), [[first, 'broken', 'noise']], 'case-id order decides among the harmful flips, and they come before the improvements');
  assert.deepEqual(card.cases.newly_failing, [second], 'the case that was not judged again still counts');
  assert.equal(readJson(rootFile(w, 'runs', 'pr1', 'run.json')).reconfirm.over_cap, 5);
});

test('--smoke never reconfirms: it stays a one-run rehearsal', async () => {
  const { w } = await reconfirmWorld();
  const r = await promote(w, lessonArgs('pr1', '--smoke'), scenario(w, { noisy: { cases: 1, wrongRuns: [1] } }));
  assert.equal(r.code, EXIT.FAIL, r.err.join('\n'));
  assert.doesNotMatch(r.text, /first pass/);
  assert.equal(existsSync(rootFile(w, 'runs', 'pr1', 'reconfirm-items.jsonl')), false);
  const card = cardOf(w, 'pr1');
  assert.equal('reconfirmed' in card, false);
  assert.equal(card.stats.runs, 1);
});

test('the usage window can close during the reconfirmation; --resume finishes it without judging anything twice', async () => {
  const { w } = await reconfirmWorld();
  const sel = selectCases(casesOf(w), { lesson: LESSON_TITLE, sourceReadingTags: ['Improperly sourced', 'Source inaccessible'] });
  const itemIds = new Set([...sel.gating, ...sel.lessonCases, ...selectCanaries(canariesOf(w))].map((c) => c.item));
  const firstPass = 2 * 3 * Math.ceil(itemIds.size / 8); // two rubrics, three runs, batches of eight
  const stub = scenario(w, { noisy: { cases: 1, wrongRuns: [1, 2] }, failWith: 'usage_window', failAfter: firstPass });
  const stopped = await promote(w, lessonArgs('pr1'), stub);
  assert.equal(stopped.code, EXIT.USAGE_WINDOW, stopped.err.join('\n'));
  assert.match(stopped.err.join('\n'), /the usage window ran out while judging the reconfirm baseline; the finished judgments are kept\. Resume when it reopens: node agents\/claim-tagger\/scripts\/promote\.mjs --lesson .* --resume --run-id pr1/);
  const refused = stub.calls.length - firstPass; // the judge starts as many batches at once as its concurrency allows, and the window refuses each of them
  assert.ok(refused >= 1 && refused <= w.config.judge.concurrency, `the first pass was complete; ${refused} call(s) of the reconfirmation were refused`);
  assert.equal(existsSync(rootFile(w, 'runs', 'PROMOTING.json')), false);
  stub.options.failWith = null;
  const done = await promote(w, lessonArgs('pr1', '--resume'), stub);
  assert.equal(done.code, EXIT.OK, done.err.join('\n'));
  assert.equal(stub.calls.length, firstPass + refused + 10, 'five more runs under each rubric for the five claims (one batch per run), and not one call twice');
  assert.deepEqual(cardOf(w, 'pr1').reconfirmed.map((x) => x.outcome), ['noise', 'confirmed', 'confirmed', 'confirmed', 'confirmed']);
});

test('reconfirmation also covers a broken item of the target tag: a lesson case that the baseline got right and the candidate got wrong by chance', async () => {
  const { w } = await reconfirmWorld();
  const cases = casesOf(w);
  const labels = labelMap([...cases, ...canariesOf(w)]);
  const [chance, ...rest] = lessonCasesOf(w);
  const others = new Set(rest.map((c) => normClaim(c.claim)));
  const stub = makeJudgeStub({
    decide: ({ claim, tag, version, run }) => {
      const want = labelOf(labels, claim, tag);
      if (!want || tag !== 'Predictive') return want;
      const c = normClaim(claim);
      if (c === normClaim(chance.claim)) return version !== LIVE && run <= 2 ? opposite(want) : want; // right under the baseline, wrong in two of three candidate runs
      return others.has(c) && version === LIVE ? opposite(want) : want; // the other lesson claims: wrong under the baseline, right under the candidate
    },
  });
  const r = await promote(w, lessonArgs('pr1'), stub);
  assert.ok([EXIT.OK, EXIT.HOLD].includes(r.code), r.err.join('\n'));
  assert.match(r.text, /promote: first pass (HOLD|FAIL): 4 flipped case\(s\) \(1 broken, 3 fixed\); judging 4 of them again/);
  const card = cardOf(w, 'pr1');
  assert.deepEqual(card.reconfirmed.map((x) => [x.case_id, x.flip, x.outcome]), [[chance.case_id, 'broken', 'noise'], ...rest.map((c) => c.case_id).sort().map((id) => [id, 'fixed', 'confirmed'])]);
  assert.deepEqual(card.reconfirmed[0], { case_id: chance.case_id, tag: 'Predictive', flip: 'broken', baseline: { runs: 8, decision: 'do_not_apply' }, candidate: { runs: 8, decision: 'do_not_apply' }, outcome: 'noise' });
  const predictive = card.per_tag.find((t) => t.tag === 'Predictive');
  assert.deepEqual([predictive.fixed.length, predictive.broken.length], [3, 0]);
  assert.equal(readJsonl(rootFile(w, 'runs', 'pr1', 'reconfirm-items.jsonl')).rows.length, 4);
});

test('reconfirmCandidates: harm first (newly failing cases, then the broken items of the target tag), then improvement (the fixed items of the target tag and the lesson cases that now pass); each in case-id order; only judged tags; at most max', () => {
  const tags = { 'h-1': 'Hypothetical', 'h-2': 'Hypothetical', 'u-1': 'Unjudged', 'p-1': 'Predictive', 'p-2': 'Predictive', 'p-3': 'Predictive', 'p-4': 'Predictive', 'l-1': 'Predictive' };
  const card = {
    cases: { newly_failing: ['h-2', 'h-1', 'u-1'], lesson: { fixed: ['l-1', 'p-3'] }, items: Object.entries(tags).map(([case_id, tag]) => ({ case_id, tag })) },
    per_tag: [{ tag: 'Predictive', broken: ['p-2', 'p-1', 'h-1'], fixed: ['p-3', 'p-4'] }, { tag: 'Hypothetical', broken: ['h-9'], fixed: ['h-8'] }],
  };
  const judged = new Set(['Hypothetical', 'Predictive']);
  const all = reconfirmCandidates(card, { target: 'Predictive', judged, max: 16 });
  assert.deepEqual(all.picks, [
    { case_id: 'h-1', flip: 'broken' }, { case_id: 'h-2', flip: 'broken' }, { case_id: 'p-1', flip: 'broken' }, { case_id: 'p-2', flip: 'broken' },
    { case_id: 'l-1', flip: 'fixed' }, { case_id: 'p-3', flip: 'fixed' }, { case_id: 'p-4', flip: 'fixed' },
  ]);
  assert.deepEqual([all.flipped, all.broken, all.fixed, all.notJudged, all.overCap], [8, 5, 3, ['u-1'], 0]);
  const capped = reconfirmCandidates(card, { target: 'Predictive', judged, max: 5 });
  assert.deepEqual(capped.picks.map((p) => p.case_id), ['h-1', 'h-2', 'p-1', 'p-2', 'l-1'], 'the cap cuts the improvements first');
  assert.equal(capped.overCap, 2);
  const noLesson = reconfirmCandidates({ ...card, cases: { ...card.cases, lesson: null } }, { target: 'Predictive', judged, max: 16 });
  assert.deepEqual(noLesson.picks.filter((p) => p.flip === 'fixed').map((p) => p.case_id), ['p-3', 'p-4']);
  assert.deepEqual(reconfirmCandidates({ cases: null, per_tag: [] }, { target: 'Predictive', judged, max: 16 }), { picks: [], flipped: 0, broken: 0, fixed: 0, notJudged: [], overCap: 0 });
});

test('reconfirmSettings: off when absent or 0; sixteen cases by default; whole numbers only; a nonsensical value is refused before anything is judged', async () => {
  assert.deepEqual(reconfirmSettings({}), { runs: 0, max: 16 });
  assert.deepEqual(reconfirmSettings({ gate: { reconfirm_runs: 0 } }), { runs: 0, max: 16 });
  assert.deepEqual(reconfirmSettings({ gate: { reconfirm_runs: 5, reconfirm_max: 3 } }), { runs: 5, max: 3 });
  for (const gate of [{ reconfirm_runs: -1 }, { reconfirm_runs: 2.5 }, { reconfirm_runs: '5' }, { reconfirm_runs: 5, reconfirm_max: 0 }]) {
    assert.throws(() => reconfirmSettings({ gate }), (e) => e.code === EXIT.INVALID && /config\.gate\.reconfirm_(runs|max) must be a whole number of at least/.test(e.message), JSON.stringify(gate));
  }
  const { w } = await makePromoteWorld({ config: (cfg) => { cfg.gate.reconfirm_runs = -1; } });
  const stub = scenario(w);
  const r = await promote(w, lessonArgs('pr1'), stub);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /config\.gate\.reconfirm_runs must be a whole number of at least 0/);
  assert.equal(stub.calls.length, 0, 'not one judge call');
});

// ---- the real data: the items file ---------------------------------------------------------------------------------------------------------------------

test('with the research cases and all 86 canaries the items are the gate cases of judged tags, the lesson\'s contested cases and 83 canaries', async () => {
  const { w } = await makePromoteWorld({ research: true });
  const stub = scenario(w);
  const r = await promote(w, lessonArgs('pr1'), stub);
  assert.ok([EXIT.OK, EXIT.HOLD, EXIT.FAIL].includes(r.code), r.err.join('\n'));
  const items = readJsonl(rootFile(w, 'runs', 'pr1', 'items.jsonl')).rows;
  const cases = casesOf(w);
  const canaries = canariesOf(w);
  const sel = selectCases(cases, { lesson: LESSON_TITLE, sourceReadingTags: ['Improperly sourced', 'Source inaccessible'] });
  const active = selectCanaries(canaries);
  assert.equal(active.length, 83);
  const canaryIds = new Set(active.map((c) => c.item));
  assert.equal(items.filter((i) => i.id.startsWith('canary-')).length, canaryIds.size);
  assert.ok([...canaryIds].every((id) => items.some((i) => i.id === id)));
  // a contested case of another lesson (or none) is not judged: Ukraine ceasefire and the birthright claim stay out
  for (const c of cases.filter((x) => x.contested && x.contested_lesson !== LESSON_TITLE)) assert.ok(!items.some((i) => i.id === c.geo_id), `${c.case_id} is contested for no lesson of this run`);
  // a case on a source-reading tag is not judged for its own sake
  assert.ok(sel.notRun.length >= 1);
  for (const c of sel.lessonCases) assert.ok(items.some((i) => i.id === c.item));
  assert.ok(items.length >= canaryIds.size + 4);
});

// ---- finalize ----------------------------------------------------------------------------------------------------------------------------------------

async function passAndApply(opts = {}) {
  const ctx = await makePromoteWorld(opts);
  const { w } = ctx;
  const stub = scenario(w);
  const r = await promote(w, lessonArgs('pr1'), stub);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  return { ...ctx, stub };
}

test('finalize refuses until the plan is applied and verified, the run is a PASS, and Notion shows the new text', async () => {
  const { w, stub } = await passAndApply();
  writeFileSync(rootFile(w, 'runs', 'PAUSED'), '{}');
  assert.equal((await promote(w, ['--finalize', 'pr1'], stub)).code, EXIT.PAUSED, 'a paused agent does not go live');
  unlinkSync(rootFile(w, 'runs', 'PAUSED'));
  let f = await promote(w, ['--finalize', 'pr1'], stub);
  assert.equal(f.code, EXIT.INVALID);
  assert.match(f.err.join('\n'), /run pr1 has no verify\.json: apply the plan first/);
  f = await promote(w, ['--finalize', 'other'], stub);
  assert.equal(f.code, EXIT.INVALID);
  assert.match(f.err.join('\n'), /belongs to run pr1/);
  writeFileSync(rootFile(w, 'runs', 'pr1', 'verify.json'), JSON.stringify({ result: 'retry', post_pull: 'p1' }));
  f = await promote(w, ['--finalize', 'pr1'], stub);
  assert.match(f.err.join('\n'), /says "retry", not clean: fix the apply/);
  // a verify.json that says clean, but Notion was never written: finalize looks at Notion itself
  writeFileSync(rootFile(w, 'runs', 'pr1', 'verify.json'), JSON.stringify({ result: 'clean', post_pull: 'p1' }));
  f = await promote(w, ['--finalize', 'pr1'], stub);
  assert.equal(f.code, EXIT.INVALID);
  assert.match(f.err.join('\n'), /Rulebook row Predictive in pull p1 does not carry the candidate's When to use/);
  assert.equal(readJson(rootFile(w, 'rubric', 'rubric.json')).rubric_version, LIVE, 'nothing changed');
  assert.ok(existsSync(rootFile(w, 'runs', 'PROMOTING.json')));
});

test('finalize refuses when the lesson is not Live in Notion or the live rubric changed meanwhile; and it can be run again after a stop', async () => {
  const { w, stub, lessonPage } = await passAndApply();
  await applyPlan(w, 'pr1', 'p2');
  // the owner flipped the lesson back after the apply
  w.fake.editorSet(lessonPage, { Status: 'Approved' });
  await w.pull('p3');
  let f = await promote(w, ['--finalize', 'pr1'], stub);
  assert.equal(f.code, EXIT.INVALID);
  assert.match(f.err.join('\n'), /is Approved in pull p3, not Live: the plan did not \(fully\) land/);
  w.fake.editorSet(lessonPage, { Status: 'Live' });
  await w.pull('p4');
  // somebody locked another rubric in the meantime
  const rubricFile = rootFile(w, 'rubric', 'rubric.json');
  const original = readFileSync(rubricFile, 'utf8');
  const other = JSON.parse(original);
  other.tags[0].description = `${other.tags[0].description} (edited)`;
  const { rehash } = await import('../agents/claim-tagger/scripts/lib/rubric-build.mjs');
  writeFileSync(rubricFile, `${JSON.stringify(rehash(other), null, 2)}\n`);
  f = await promote(w, ['--finalize', 'pr1'], stub);
  assert.equal(f.code, EXIT.DRIFT);
  assert.match(f.err.join('\n'), /the live rubric changed since this promote started/);
  writeFileSync(rubricFile, original);

  // a stop half way (the file is already the candidate) is repaired by running finalize again
  const first = await promote(w, ['--finalize', 'pr1'], stub);
  assert.equal(first.code, EXIT.OK, first.err.join('\n'));
  writeFileSync(rootFile(w, 'runs', 'PROMOTING.json'), JSON.stringify({ run_id: 'pr1' }));
  writeFileSync(rootFile(w, 'rubric', 'rubric.lock'), '{ "stale": true }');
  const second = await promote(w, ['--finalize', 'pr1'], stub);
  assert.equal(second.code, EXIT.OK, second.err.join('\n'));
  assert.match(second.out[0], /is live \(lock ok\)/);
  const log = readFileSync(rootFile(w, 'rubric', 'CHANGELOG.md'), 'utf8');
  assert.equal(log.split('\n').filter((l) => l.startsWith('- 2026-10-13.2 ')).length, 1, 'the changelog line is not written twice');
});

// ---- abort -------------------------------------------------------------------------------------------------------------------------------------------------

test('abort before the apply: PROMOTING.json goes, nothing else, no plan', async () => {
  const { w } = await passAndApply();
  const r = await promote(w, ['--abort', 'pr1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /aborted run pr1: PROMOTING\.json removed; the plan had not been applied, so Notion was never changed/);
  assert.equal(existsSync(rootFile(w, 'runs', 'PROMOTING.json')), false);
  assert.equal(existsSync(rootFile(w, 'runs', 'pr1-abort')), false);
  const record = readJson(rootFile(w, 'runs', 'pr1', 'run.json'));
  assert.equal(record.status, 'aborted');
  assert.equal(record.rolled_back, true);
  assert.equal(readJson(rootFile(w, 'rubric', 'rubric.json')).rubric_version, LIVE);
  const again = await promote(w, ['--abort', 'pr1']);
  assert.equal(again.code, EXIT.INVALID);
  assert.match(again.err.join('\n'), /runs\/PROMOTING\.json does not exist/);
});

test('abort after the apply: a restore plan puts the old text, version and hash back and marks the lesson Rolled back; applying it ends the drift', async () => {
  const { w } = await passAndApply();
  const original = w.fake.find('rulebook', 'Predictive').props;
  await applyPlan(w, 'pr1', 'p2');
  assert.notEqual(w.fake.find('rulebook', 'Predictive').props['When to use'], original['When to use']);
  assert.equal(statusMain(['--check'], captureIo().io, { root: w.root, now: w.clock.now }), EXIT.INVALID, 'a promote is in flight; Notion carries the candidate text for the promoted tag, which is expected, not drift');
  // a pull that is older than the apply is not trusted
  appendFileSync(rootFile(w, 'runs', 'pr1', 'applied.jsonl'), `${JSON.stringify({ seq: 99, status: 'ok', at: '2027-01-01T00:00:00.000Z' })}\n`);
  let r = await promote(w, ['--abort', 'pr1']);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /was \(partly\) applied, so Notion may carry the candidate's text: run pull\.mjs/);
  assert.ok(existsSync(rootFile(w, 'runs', 'PROMOTING.json')), 'kept: the abort did not happen');
  writeFileSync(rootFile(w, 'runs', 'pr1', 'applied.jsonl'), readFileSync(rootFile(w, 'runs', 'pr1', 'applied.jsonl'), 'utf8').split('\n').filter((l) => l && !l.includes('"seq":99')).join('\n') + '\n');

  r = await promote(w, ['--abort', 'pr1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /Notion's Rulebook still carried the candidate text, so a restore plan was written \(pr1-abort\)/);
  const { header, ops } = readPlan(w.root, 'pr1-abort');
  assert.deepEqual(header.ctx, { seed: false, promote: false, gate: null, restore: true, confirm: true }, 'the restore path, not a borrowed gate PASS');
  const rulebook = ops.find((o) => o.database === 'rulebook');
  assert.equal(rulebook.properties['When to use'], original['When to use']);
  assert.equal(rulebook.properties['Rule version'], LIVE);
  assert.equal(rulebook.properties['Tag hash'], original['Tag hash']);
  assert.deepEqual(rulebook.properties['Changed by'], []);
  const lessonOp = ops.find((o) => o.database === 'rule_changes');
  assert.equal(lessonOp.properties.Status, 'Rolled back');
  assert.match(lessonOp.properties['Gate result'], /Aborted 2026-10-13: the promote was not finalized/);
  assert.equal(ops.some((o) => o.database === 'runs'), false);
  assert.equal(existsSync(rootFile(w, 'runs', 'PROMOTING.json')), false);

  await applyPlan(w, 'pr1-abort', 'p3');
  assert.equal(w.fake.find('rulebook', 'Predictive').props['When to use'], original['When to use']);
  assert.deepEqual(w.fake.find('rulebook', 'Predictive').props['Changed by'], []);
  assert.equal(w.fake.find('rule_changes', LESSON_TITLE).props.Status, 'Rolled back');
  assert.equal(w.fake.find('agent_settings', 'claim-tagger').props['Rubric in force'], LIVE);
  assert.equal(statusMain(['--check'], captureIo().io, { root: w.root, now: w.clock.now }), EXIT.OK, 'no drift, nothing in flight');
});

// ---- rollback ----------------------------------------------------------------------------------------------------------------------------------------------

async function finalized() {
  const ctx = await passAndApply();
  await applyPlan(ctx.w, 'pr1', 'p2');
  const f = await promote(ctx.w, ['--finalize', 'pr1'], ctx.stub);
  assert.equal(f.code, EXIT.OK, f.err.join('\n'));
  await ctx.w.pull('p3');
  return ctx;
}

test('rollback needs --confirm; with it the previous rubric comes back byte for byte, lock and changelog follow, and a restore plan marks the lesson Rolled back', async () => {
  const { w } = await finalized();
  const before = w.fake.find('rulebook', 'Predictive').props;
  const oldBytes = readFileSync(rootFile(w, 'rubric', 'history', '2026-10-13.1.json'), 'utf8');
  const oldRubric = JSON.parse(oldBytes);

  let r = await promote(w, ['--rollback', 'LS-1']);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /would restore rubric 2026-10-13\.1 \(sha256:63f085c84a038df8\) over 2026-10-13\.2 .* needs --confirm/);
  assert.equal(readJson(rootFile(w, 'rubric', 'rubric.json')).rubric_version, '2026-10-13.2', 'nothing happened');

  r = await promote(w, ['--rollback', 'LS-1', '--confirm', '--run-id', 'rb1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /^promote: rolled back LS-1: rubric 2026-10-13\.1 sha256:63f085c84a038df8 restored \(equals rubric\/history\/2026-10-13\.1\.json\); cases: 4 contested, \d+ hash\(es\) re-stamped; plan /);
  assert.equal(readFileSync(rootFile(w, 'rubric', 'rubric.json'), 'utf8'), oldBytes, 'byte for byte the history file');
  assert.equal(readJson(rootFile(w, 'rubric', 'rubric.json')).rubric_hash, oldRubric.rubric_hash);
  assert.equal(checkHashes(readJson(rootFile(w, 'rubric', 'rubric.json'))).ok, true);
  const lock = readJson(rootFile(w, 'rubric', 'rubric.lock'));
  assert.deepEqual([lock.rubric_version, lock.rubric_hash], ['2026-10-13.1', 'sha256:63f085c84a038df8']);
  assert.equal(lock.file_sha256, fileSha256(rootFile(w, 'rubric', 'rubric.json')));
  assert.ok(existsSync(rootFile(w, 'rubric', 'history', '2026-10-13.2.json')), 'the rolled-back version keeps its file, so its number is never used again');
  const log = readFileSync(rootFile(w, 'rubric', 'CHANGELOG.md'), 'utf8').trimEnd().split('\n');
  assert.match(log.at(-1), /^- 2026-10-13\.1 \(2026-10-13\), rollback: 2026-10-13\.2 rolled back \(LS-1 "Hedged trajectories are not forecasts"\); rubric\/history\/2026-10-13\.1\.json restored\. rubric_hash sha256:63f085c84a038df8/);

  const { ops, header } = readPlan(w.root, 'rb1');
  assert.deepEqual(header.ctx, { seed: false, promote: false, gate: null, restore: true, confirm: true }, 'the restore path, not a borrowed gate PASS');
  const rulebook = ops.find((o) => o.database === 'rulebook');
  assert.equal(rulebook.properties['When to use'], composeWhenToUse(oldRubric.tags.find((t) => t.name === 'Predictive').when_to_use));
  assert.notEqual(rulebook.properties['When to use'], before['When to use'], 'Notion carried the lesson\'s text until now');
  assert.equal(rulebook.properties['Rule version'], LIVE);
  assert.equal(rulebook.properties['Tag hash'], oldRubric.tags.find((t) => t.name === 'Predictive').tag_hash);
  assert.deepEqual(rulebook.properties['Changed by'], []);
  assert.deepEqual(ops.find((o) => o.database === 'rule_changes').properties.Status, 'Rolled back');
  const runOp = ops.find((o) => o.database === 'runs');
  assert.equal(runOp.key, 'Rollback 2026-10-13.2');
  assert.match(runOp.properties.Summary, /Rolled back LS-1 \(2026-10-13\.2\): rubric 2026-10-13\.1 \(sha256:63f085c84a038df8\) restored byte for byte/);
  assert.equal(ops.find((o) => o.database === 'agent_settings').properties['Rubric in force'], LIVE);

  // the lesson's cases are contested again and carry the old hashes
  const cases = casesOf(w);
  assert.equal(cases.filter((c) => c.contested && c.contested_lesson === LESSON_TITLE).length, 4);
  assert.equal(cases.find((c) => c.tag === 'Predictive').tag_hash, oldRubric.tags.find((t) => t.name === 'Predictive').tag_hash);

  await applyPlan(w, 'rb1', 'p4');
  assert.equal(w.fake.find('rulebook', 'Predictive').props['When to use'], composeWhenToUse(oldRubric.tags.find((t) => t.name === 'Predictive').when_to_use));
  assert.equal(w.fake.find('rule_changes', LESSON_TITLE).props.Status, 'Rolled back');
  assert.equal(statusMain(['--check'], captureIo().io, { root: w.root, now: w.clock.now }), EXIT.OK);

  // the next candidate does not reuse version .2
  assert.equal(candidateVersion(w.root, '2026-10-13.1', new Date('2026-10-13T12:00:00Z')), '2026-10-13.3');
});

test('the Runs row of a rollback has the Rollback kind when the Runs database has that option, else Gate', async () => {
  const ctx = await passAndApply();
  const { w } = ctx;
  w.fake.schemas.runs.properties.Kind.select.options.push({ id: 'opt-rollback', name: 'Rollback', color: 'gray' });
  await applyPlan(w, 'pr1', 'p2');
  assert.equal((await promote(w, ['--finalize', 'pr1'], ctx.stub)).code, EXIT.OK);
  await w.pull('p3');
  const r = await promote(w, ['--rollback', 'LS-1', '--confirm', '--run-id', 'rb1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(opsFor(w, 'rb1', 'runs')[0].properties.Kind, 'Rollback');
  await applyPlan(w, 'rb1', 'p4');
  assert.equal(w.fake.find('runs', 'Rollback 2026-10-13.2').props.Kind, 'Rollback');
  assert.deepEqual(w.fake.createdOptions, []);
});

test('rollback only for the most recent Live lesson', async () => {
  const { w } = await finalized();
  let r = await promote(w, ['--rollback', 'LS-9', '--confirm']);
  assert.equal(r.code, EXIT.INVALID);
  // a promote of another lesson in flight blocks it
  writeFileSync(rootFile(w, 'runs', 'PROMOTING.json'), JSON.stringify({ run_id: 'other' }));
  r = await promote(w, ['--rollback', 'LS-1', '--confirm']);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /PROMOTING: run other is waiting/);
  unlinkSync(rootFile(w, 'runs', 'PROMOTING.json'));
  // the lesson is not Live
  const { w: w2 } = await makePromoteWorld();
  r = await promote(w2, ['--rollback', 'LS-1', '--confirm']);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /is Approved, not Live: only a Live lesson can be rolled back/);
  // a later change on top of it
  const rubricFile = rootFile(w, 'rubric', 'rubric.json');
  const rubric = readJson(rubricFile);
  rubric.changelog.push({ version: '2026-10-13.3', previous_version: '2026-10-13.2', date: '2026-10-13', tag: 'Debate', lesson_id: 'LS-2', note: 'Debate rule 1 replaced by lesson LS-2 "Another"' });
  writeFileSync(rubricFile, `${JSON.stringify(rubric, null, 2)}\n`);
  writeFileSync(rootFile(w, 'rubric', 'rubric.lock'), JSON.stringify({ ...readJson(rootFile(w, 'rubric', 'rubric.lock')), file_sha256: fileSha256(rubricFile) }));
  r = await promote(w, ['--rollback', 'LS-1', '--confirm']);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /is not the most recent change of the live rubric/);
  // a missing history file
  rubric.changelog.pop();
  writeFileSync(rubricFile, `${JSON.stringify(rubric, null, 2)}\n`);
  writeFileSync(rootFile(w, 'rubric', 'rubric.lock'), JSON.stringify({ ...readJson(rootFile(w, 'rubric', 'rubric.lock')), file_sha256: fileSha256(rubricFile) }));
  unlinkSync(rootFile(w, 'rubric', 'history', '2026-10-13.1.json'));
  r = await promote(w, ['--rollback', 'LS-1', '--confirm']);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /history\/2026-10-13\.1\.json does not exist/);
});

// ---- the card text -------------------------------------------------------------------------------------------------------------------------------------

test('card helpers: per-tag summary, canaries text, the page body', () => {
  const card = {
    verdict: 'FAIL', smoke: false, small_sample: true, rollback: { command: '/claim-tagger promote --rollback X' }, noise: { cells: 3, baseline: 0, candidate: 0.5 }, not_run: [{ case_id: 'a' }],
    stats: { runs: 3 }, configs: { baseline: { config16: 'aaa', rubric_version: 'v1', rubric_hash: 'sha256:1' }, candidate: { config16: 'bbb', rubric_version: 'v2', rubric_hash: 'sha256:2' } },
    conditions: [{ n: 1, status: 'fail', detail: 'every active canary passes under the candidate: 80 of 83 pass' }],
    canaries: { candidate: { active: 83, passed: 80, failing: ['c1', 'c2', 'c3'] } },
    per_tag: [
      { tag: 'Predictive', n: 10, positives: 6, acc_base: 0.5, acc_cand: 0.9, delta: 0.4, ci: [0.1, 0.7], fixed: ['a', 'b'], broken: [], gated: true },
      { tag: 'Debate', n: 0, positives: 0, acc_base: null, acc_cand: null, delta: null, ci: null, fixed: [], broken: [], gated: false },
      { tag: 'Opinion', n: 2, positives: 1, acc_base: 1, acc_cand: 0.5, delta: -0.5, ci: [-1, 0], fixed: [], broken: ['x'], gated: false },
    ],
  };
  assert.equal(perTagSummary(card), 'Predictive: 50.0% -> 90.0% (+40.0 points), fixed 2, broken 0, n 10, 6 positives\nOpinion: 100.0% -> 50.0% (-50.0 points), fixed 0, broken 1, n 2, 1 positives, not gated');
  assert.equal(canariesText(card), '80 of 83; failing: c1, c2, c3');
  assert.equal(canariesText({ canaries: null }), 'not evaluated');
  assert.equal(canariesText({ canaries: { candidate: { active: 5, passed: 5, failing: [] } } }), '5 of 5');
  const md = cardMarkdown(card, 'Verdict: FAIL\nCanaries: 80/83', { cost: 1.5, model: 'm' });
  assert.match(md, /^## Verdict: FAIL - small sample\n\n- Verdict: FAIL\n- Canaries: 80\/83\n\n## The five conditions\n1\. FAIL: every active canary/);
  assert.match(md, /- Predictive: 50\.0% -> 90\.0%, \+40\.0 points \(95% interval \+10\.0 to \+70\.0\), fixed 2 \[a, b\], broken 0, n 10, 6 positives, gated/);
  assert.match(md, /## Not run\n- 1 case\(s\) on source-reading tags/);
  assert.match(md, /baseline 0\.0%, candidate 50\.0%/);
  assert.match(md, /- Cost: \$1\.5000; model m; 3 run\(s\) per rubric/);
  assert.match(md, /## Rollback\n- \/claim-tagger promote --rollback X$/);
});

// ---- arguments ------------------------------------------------------------------------------------------------------------------------------------------

test('arguments: exactly one mode, flags only with their mode, safe run ids', async () => {
  const { w } = await makePromoteWorld();
  for (const argv of [[], ['--lesson', 'x', '--finalize', 'y'], ['--bogus'], ['stray'], ['--confirm'], ['--lesson', 'LS-1', '--confirm'], ['--finalize', 'pr1', '--smoke'], ['--abort', 'a:b'], ['--lesson', 'LS-1', '--driver', 'subagent'], ['--rollback']]) {
    const r = await promote(w, argv);
    assert.equal(r.code, EXIT.INVALID, JSON.stringify(argv));
    assert.match(r.err.join('\n'), /usage: node agents\/claim-tagger\/scripts\/promote\.mjs/, JSON.stringify(argv));
  }
  const help = await promote(w, ['--help']);
  assert.equal(help.code, EXIT.OK);
  assert.match(help.out[0], /--rollback <lesson key or LS-n> --confirm/);
});

test('the judgments the gate read are the ones in runs/judgments, named like the eval expects', async () => {
  const { w } = await makePromoteWorld();
  assert.equal((await promote(w, lessonArgs('pr1'), scenario(w))).code, EXIT.OK);
  const base = readJson(rootFile(w, 'runs', 'pr1-baseline', 'run.json'));
  const item = readJsonl(rootFile(w, 'runs', 'pr1', 'items.jsonl')).rows[0];
  const folder = rootFile(w, 'runs', 'judgments', base.config16, 'run-1');
  assert.ok(readdirSync(folder).includes(judgmentFileName(item.id, item.claim)));
});
