import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main as applyMain } from '../agents/claim-tagger/scripts/apply.mjs';
import {
  caseIdFor, citedRule, claimTexts, decidedAtOf, expectedOf, main, reasoningOf, ruleWhyOf, syncCases, tagSlug,
} from '../agents/claim-tagger/scripts/cases-sync.mjs';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { ruleHash } from '../agents/claim-tagger/scripts/lib/hash.mjs';
import { readJsonl } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { applyLesson } from '../agents/claim-tagger/scripts/lib/rubric-build.mjs';
import { check as planCheck, readPlan } from '../agents/claim-tagger/scripts/plan.mjs';
import { loadPull } from '../agents/claim-tagger/scripts/pull.mjs';
import { captureIo, cleanupLoop, geoId, liveRubric, makeLoopWorld, makeMiniWorld, rowKey } from './fixtures/loop/world.mjs';

after(() => cleanupLoop());

const sync = async (w, argv = [], extra = {}) => {
  const c = captureIo();
  const code = await main(argv, c.io, w.env(extra));
  return { code, out: c.out, err: c.err };
};
const casesOf = (w) => readJsonl(join(w.root, 'evals', 'cases.jsonl')).rows;
const byKey = (w) => new Map(casesOf(w).map((c) => [c.key, c]));
const planOf = (w, runId) => readPlan(w.root, runId);
const regressionKeys = (w, runId) => planOf(w, runId).ops.map((o) => o.key).sort();

// ---- the helpers ------------------------------------------------------------------------------------------------------------------------

test('case ids: "ctr-" + the last 12 hex digits of the page id + the first 6 letters of the tag', () => {
  assert.equal(tagSlug('Context-dependent'), 'contex');
  assert.equal(tagSlug('Poor wording'), 'poorwo');
  assert.equal(tagSlug('Self-contained'), 'selfco');
  assert.equal(tagSlug('Simple'), 'simple');
  assert.equal(caseIdFor('3f4273e2-14eb-813b-909f-c78bac8861c7', 'Predictive'), 'ctr-c78bac8861c7-predic');
  assert.equal(caseIdFor('3F4273E214EB813B909FC78BAC8861C7', 'Single core statement'), 'ctr-c78bac8861c7-single');
});

test('citedRule reads "<Tag> rule <n>" from the agent notes, the long note first; ruleWhyOf and reasoningOf read both kinds of decision', () => {
  assert.equal(citedRule({ agent_full_note: 'The judge relied on Predictive rule 3 here.', why_i_recommend_this: 'Predictive rule 1' }, 'Predictive'), 3);
  assert.equal(citedRule({ agent_full_note: null, why_i_recommend_this: 'Per predictive RULE 2, it fires.' }, 'Predictive'), 2);
  assert.equal(citedRule({ agent_full_note: 'Debate rule 4 applies', why_i_recommend_this: null }, 'Predictive'), null, 'a rule of another tag is not the row\'s');
  assert.equal(citedRule({ agent_full_note: 'No rule named.' }, 'Predictive'), null);

  const editor = { outcome_source: 'editor', tag_outcome: 'Applies', why_wrong: 'Rule unclear', your_reasoning: ' A sentence. ', decided_at: '2026-10-13', seeded_reasoning: 'Rule should change: old' };
  assert.deepEqual(ruleWhyOf(editor), { why: 'Rule unclear', source: 'editor' });
  assert.equal(reasoningOf(editor), 'A sentence.');
  assert.equal(decidedAtOf(editor), '2026-10-13');
  const slip = { outcome_source: 'editor', tag_outcome: 'Applies', why_wrong: 'Agent slip' };
  assert.equal(ruleWhyOf(slip), null);
  const seeded = { outcome_source: 'seeded', seeded_outcome: 'Does not apply', seeded_reasoning: 'Rule should change: I do not think this is predictive.', seeded_at: '2026-10-09', effective_outcome: 'Does not apply' };
  assert.deepEqual(ruleWhyOf(seeded), { why: 'Rule should change', source: 'seeded' });
  assert.equal(reasoningOf(seeded), 'I do not think this is predictive.');
  assert.equal(decidedAtOf(seeded), '2026-10-09');
  assert.equal(expectedOf(seeded), 'do_not_apply');
  assert.equal(ruleWhyOf({ outcome_source: 'seeded', seeded_reasoning: 'Rule unclear: hmm' }).why, 'Rule unclear');
  assert.equal(ruleWhyOf({ outcome_source: 'seeded', seeded_reasoning: 'The claim reads well.' }), null);
  assert.equal(ruleWhyOf({ tag_outcome: 'Applies', why_wrong: 'Rule should change' }).source, 'editor', 'the source is guessed from Tag outcome when the row lacks outcome_source');
});

// ---- the seeded decisions -----------------------------------------------------------------------------------------------------------------

test('the 27 seeded decisions become 27 active cases, one of them not_run; the plan sets In regression suite on all 27 and nothing else', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  const r = await sync(w, ['--run-id', 'cs1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /^cases-sync: pull p1: 27 case\(s\) \(27 from decisions, 0 kept from research\), active 27 \(1 not_run\), contested 0, inactive 0; added 27, updated 0 \(hash re-stamped 0\), withdrawn 0; In regression suite: 27 row\(s\) in plan cs1; next: node agents\/claim-tagger\/scripts\/plan\.mjs check --run cs1/);

  const cases = casesOf(w);
  assert.equal(cases.length, 27);
  assert.equal(cases.filter((c) => c.active).length, 27);
  assert.equal(cases.filter((c) => c.suite === 'not_run').length, 1);
  assert.equal(cases.filter((c) => c.contested).length, 0);
  assert.equal(new Set(cases.map((c) => c.case_id)).size, 27);
  const rubric = liveRubric();
  const queue = readJsonl(join(w.root, 'runs', 'pull', 'p1', 'norm', 'queue.jsonl')).rows;
  for (const c of cases) {
    const row = queue.find((q) => q.key === c.key);
    assert.match(c.case_id, /^ctr-[0-9a-f]{12}-[a-z]{1,6}$/);
    assert.equal(c.case_id, caseIdFor(row.page_id, c.tag));
    assert.equal(c.expected, row.effective_outcome === 'Applies' ? 'apply' : 'do_not_apply');
    assert.equal(c.tag_hash, rubric.tags.find((t) => t.name === c.tag).tag_hash, 'stamped against the live rubric');
    assert.equal(c.outcome_source, 'seeded');
    assert.equal(c.source, 'queue');
    assert.equal(c.rubric_version, '2026-10-13.1');
    assert.equal(c.geo_id, row.geo_id);
    assert.match(c.source_row, /^https:\/\/www\.notion\.so\/[0-9a-f]{32}$/);
    assert.equal(c.contested_lesson, null);
    assert.ok(c.claim.length > 10);
  }
  const iran = cases.find((c) => c.key.startsWith('4bada81d') && c.tag === 'Improperly sourced');
  assert.equal(iran.suite, 'not_run');
  assert.equal(iran.expected, 'apply');
  assert.equal(iran.active, true);
  const texas = byKey(w).get(rowKey(w, 'f376c2cc'));
  assert.equal(texas.why_wrong, 'Rule should change', 'a seeded row carries the Why wrong of its Seeded reasoning prefix');
  assert.equal(texas.active, true, 'seeded decisions are active until a lesson is linked to them');
  assert.equal(texas.reasoning.startsWith('I don\'t think this is a predictive claim'), true);

  const { ops, header } = planOf(w, 'cs1');
  assert.equal(ops.length, 27);
  assert.deepEqual(header.ctx, { seed: false, promote: false, gate: null });
  for (const op of ops) {
    assert.equal(op.database, 'tag_decisions');
    assert.deepEqual(Object.keys(op.properties), ['In regression suite']);
    assert.equal(op.properties['In regression suite'], '2026-10-13');
  }
  assert.equal(planCheck({ root: w.root, runId: 'cs1', now: w.clock.now }).code, EXIT.OK);
  const cap = captureIo();
  assert.equal(await applyMain(['--run', 'cs1'], cap.io, w.env()), EXIT.OK, cap.err.join('\n'));
  assert.match(cap.out[0], /updated 27/);

  // a second sync on the new pull finds nothing to do and leaves the file alone
  await w.pull('p2');
  const before = readFileSync(join(w.root, 'evals', 'cases.jsonl'), 'utf8');
  const again = await sync(w, ['--run-id', 'cs2']);
  assert.equal(again.code, EXIT.OK);
  assert.match(again.out[0], /In regression suite: nothing to set \(cases\.jsonl unchanged\)$/);
  assert.equal(again.out.length, 1);
  assert.equal(existsSync(join(w.root, 'runs', 'cs2', 'plan.jsonl')), false, 'no empty plan');
  assert.equal(readFileSync(join(w.root, 'evals', 'cases.jsonl'), 'utf8'), before);
});

// ---- editor decisions ----------------------------------------------------------------------------------------------------------------------

test('editor decisions: Agent slip and no Why wrong are active, Rule unclear and Rule should change are contested, No tag fits and Other make no case', async () => {
  const w = makeMiniWorld({
    rows: [
      { id: 'slip', claim: 'Claim where the agent slipped', tag: 'Predictive', outcome: 'Applies', why: 'Agent slip', reasoning: 'The rule covers it.' },
      { id: 'plain', claim: 'Claim the agent got right', tag: 'Hypothetical', outcome: 'Does not apply' },
      { id: 'unclear', claim: 'Claim where the rule is unclear', tag: 'Debate', outcome: 'Applies', why: 'Rule unclear', reasoning: 'Rule 3 does not say.' },
      { id: 'change', claim: 'Claim where the rule is wrong', tag: 'Predictive', outcome: 'Does not apply', why: 'Rule should change', reasoning: 'A hedge is not a forecast.' },
      { id: 'nofit', claim: 'Claim no tag fits', tag: 'Opinion', outcome: 'Applies', why: 'No tag fits', reasoning: 'A new tag is needed.' },
      { id: 'other', claim: 'Claim with another reason', tag: 'Opinion', outcome: 'Does not apply', why: 'Other', reasoning: 'Something else.' },
      { id: 'evidence', claim: 'Claim waiting for evidence', tag: 'Factual', outcome: 'Needs evidence' },
      { id: 'second', claim: 'Claim for a second opinion', tag: 'Factual', outcome: 'Ask another editor' },
      { id: 'open', claim: 'Claim nobody decided', tag: 'Factual' },
      { id: 'src', claim: 'Claim about a source', tag: 'Improperly sourced', outcome: 'Applies', why: 'Agent slip', reasoning: 'Checked.' },
    ],
  });
  await w.pull('p1');
  const r = await sync(w, ['--run-id', 'cs1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const cases = byKey(w);
  const [slip, plain, unclear, change, nofit, other, evidence, second, open, src] = w.keys;
  assert.deepEqual([...cases.keys()].sort(), [slip, plain, unclear, change, src].sort());
  assert.deepEqual([nofit, other, evidence, second, open].filter((k) => cases.has(k)), []);
  assert.equal(cases.get(slip).active, true);
  assert.equal(cases.get(slip).contested, false);
  assert.equal(cases.get(slip).outcome_source, 'editor');
  assert.equal(cases.get(slip).why_wrong, 'Agent slip');
  assert.equal(cases.get(slip).reasoning, 'The rule covers it.');
  assert.equal(cases.get(slip).decided_at, '2026-10-13');
  assert.equal(cases.get(plain).active, true);
  assert.equal(cases.get(plain).why_wrong, null);
  assert.equal(cases.get(plain).expected, 'do_not_apply');
  for (const k of [unclear, change]) {
    assert.equal(cases.get(k).contested, true);
    assert.equal(cases.get(k).active, false);
    assert.equal(cases.get(k).contested_lesson, null, 'no lesson linked yet');
    assert.match(cases.get(k).contested_why, /no lesson linked yet/);
  }
  assert.equal(cases.get(unclear).why_wrong, 'Rule unclear');
  assert.equal(cases.get(src).suite, 'not_run');
  assert.equal(cases.get(src).active, true);
  assert.match(r.out[0], /5 case\(s\) \(5 from decisions, 0 kept from research\), active 3 \(1 not_run\), contested 2, inactive 0; added 5/);
  // never on a contested case
  assert.deepEqual(regressionKeys(w, 'cs1'), [slip, plain, src].sort());
});

test('a case is switched off when its decision becomes No tag fits or is withdrawn, and comes back with the decision', async () => {
  const w = makeMiniWorld({ rows: [
    { id: 'a', claim: 'First claim for the withdrawn test', tag: 'Predictive', outcome: 'Applies', why: 'Agent slip', reasoning: 'x' },
    { id: 'b', claim: 'Second claim for the withdrawn test', tag: 'Debate', outcome: 'Does not apply' },
  ] });
  await w.pull('p1');
  await sync(w, ['--run-id', 'cs1']);
  const [a, b] = w.keys;
  assert.equal(casesOf(w).length, 2);
  w.fake.editorSet(w.ids.decisions[a], { 'Why wrong': 'No tag fits' });
  w.fake.editorSet(w.ids.decisions[b], { 'Tag outcome': null });
  await w.pull('p2');
  const r = await sync(w, ['--run-id', 'cs2']);
  assert.match(r.out[0], /inactive 2.*withdrawn 2/);
  const cases = byKey(w);
  assert.equal(cases.get(a).active, false);
  assert.match(cases.get(a).withdrawn, /Why wrong = No tag fits/);
  assert.equal(cases.get(b).active, false);
  assert.equal(cases.get(b).withdrawn, 'the decision was withdrawn');
  assert.equal(casesOf(w).length, 2, 'nothing is deleted');
  w.fake.editorSet(w.ids.decisions[a], { 'Why wrong': 'Agent slip' });
  w.fake.editorSet(w.ids.decisions[b], { 'Tag outcome': 'Does not apply' });
  await w.pull('p3');
  await sync(w, ['--run-id', 'cs3']);
  assert.equal(byKey(w).get(a).active, true);
  assert.equal('withdrawn' in byKey(w).get(a), false);
  assert.equal(byKey(w).get(b).active, true);
});

// ---- lessons and contested cases ------------------------------------------------------------------------------------------------------------

test('a contested case follows its lesson: its key while the lesson is open, active again when the lesson is Live', async () => {
  const w = makeMiniWorld({ rows: [
    { id: 'c1', claim: 'Hedged claim one', tag: 'Predictive', outcome: 'Does not apply', why: 'Rule should change', reasoning: 'One.' },
    { id: 'c2', claim: 'Hedged claim two', tag: 'Predictive', outcome: 'Does not apply', why: 'Rule should change', reasoning: 'Two.' },
    { id: 'c3', claim: 'Hedged claim three', tag: 'Predictive', outcome: 'Does not apply', why: 'Rule unclear', reasoning: 'Three.' },
  ] });
  const [c1, c2, c3] = w.keys;
  const lesson = w.lesson({ title: 'Hedges are not forecasts', tag: 'Predictive', rule: 'Predictive rule 1', status: 'Proposed', supporting: [c1, c2] });
  await w.pull('p1');
  await sync(w, ['--run-id', 'cs1']);
  let cases = byKey(w);
  assert.equal(cases.get(c1).contested_lesson, 'Hedges are not forecasts');
  assert.equal(cases.get(c2).contested, true);
  assert.equal(cases.get(c3).contested_lesson, null, 'a row without a link has no lesson');
  assert.match(cases.get(c1).contested_why, /lesson "Hedges are not forecasts" is Proposed/);
  assert.equal(existsSync(join(w.root, 'runs', 'cs1', 'plan.jsonl')), false, 'no plan: every case is contested, and a contested case never gets the date');

  w.setLessonStatus(lesson, 'Approved');
  await w.pull('p2');
  await sync(w, ['--run-id', 'cs2']);
  assert.match(byKey(w).get(c1).contested_why, /is Approved/);

  w.setLessonStatus(lesson, 'Live');
  await w.pull('p3');
  const r = await sync(w, ['--run-id', 'cs3']);
  cases = byKey(w);
  assert.equal(cases.get(c1).active, true, 'the lesson is Live, so the case is a test now');
  assert.equal(cases.get(c1).contested, false);
  assert.equal(cases.get(c1).contested_lesson, 'Hedges are not forecasts', 'kept as provenance');
  assert.equal(cases.get(c1).contested_why, null);
  assert.equal(cases.get(c3).contested, true, 'the unlinked row stays contested');
  assert.match(r.out[0], /active 2.*contested 1/);
  assert.deepEqual(regressionKeys(w, 'cs3'), [c1, c2].sort(), 'In regression suite for the rows whose lesson went live');

  w.setLessonStatus(lesson, 'Rolled back');
  await w.pull('p4');
  await sync(w, ['--run-id', 'cs4']);
  assert.equal(byKey(w).get(c1).contested, true, 'a rolled-back lesson contests its cases again');
  assert.equal(byKey(w).get(c1).active, false);
});

test('several linked lessons: a Live one wins, else Approved ranks above Proposed, Rolled back and Rejected', async () => {
  const w = makeMiniWorld({ rows: [{ id: 'm1', claim: 'Claim with many lessons', tag: 'Predictive', outcome: 'Does not apply', why: 'Rule should change', reasoning: 'x' }] });
  const [k] = w.keys;
  const rej = w.lesson({ title: 'Rejected one', tag: 'Predictive', status: 'Rejected', supporting: [k] });
  w.lesson({ title: 'Proposed one', tag: 'Predictive', status: 'Proposed', supporting: [k] });
  await w.pull('p1');
  await sync(w, ['--run-id', 'cs1']);
  assert.equal(byKey(w).get(k).contested_lesson, 'Proposed one');
  w.lesson({ title: 'Approved one', tag: 'Predictive', status: 'Approved', supporting: [k] });
  await w.pull('p2');
  await sync(w, ['--run-id', 'cs2']);
  assert.equal(byKey(w).get(k).contested_lesson, 'Approved one');
  w.setLessonStatus(rej, 'Live');
  await w.pull('p3');
  await sync(w, ['--run-id', 'cs3']);
  assert.equal(byKey(w).get(k).active, true);
  assert.equal(byKey(w).get(k).contested_lesson, 'Rejected one', 'the Live lesson is the one named (its title is all that is left of the earlier status)');
});

test('a seeded "Rule should change:" decision is active as seeded and turns contested only once a lesson that is not Live is linked to it', async () => {
  const w = makeMiniWorld({ rows: [
    { id: 's1', claim: 'Seeded hedge', tag: 'Predictive', outcome: 'Does not apply', seeded: true, seededReasoning: 'Rule should change: it is a tendency.' },
    { id: 's2', claim: 'Seeded plain', tag: 'Predictive', outcome: 'Does not apply', seeded: true, seededReasoning: 'It reads well.' },
    { id: 's3', claim: 'Seeded unclear', tag: 'Debate', outcome: 'Applies', seeded: true, seededReasoning: 'Rule unclear: rule 3 does not say.' },
  ] });
  const [s1, s2, s3] = w.keys;
  await w.pull('p1');
  await sync(w, ['--run-id', 'cs1']);
  let cases = byKey(w);
  for (const k of [s1, s2, s3]) assert.equal(cases.get(k).active, true, k);
  assert.equal(cases.get(s1).why_wrong, 'Rule should change');
  assert.equal(cases.get(s3).why_wrong, 'Rule unclear');
  assert.equal(cases.get(s2).why_wrong, null);
  assert.equal(regressionKeys(w, 'cs1').length, 3);

  const lesson = w.lesson({ title: 'Seeded hedges', tag: 'Predictive', status: 'Proposed', supporting: [s1, s2] });
  await w.pull('p2');
  await sync(w, ['--run-id', 'cs2']);
  cases = byKey(w);
  assert.equal(cases.get(s1).contested, true);
  assert.equal(cases.get(s1).contested_lesson, 'Seeded hedges');
  assert.equal(cases.get(s2).active, true, 'a plain seeded decision linked as evidence stays a test');
  assert.equal(cases.get(s2).contested_lesson, null);
  w.setLessonStatus(lesson, 'Live');
  await w.pull('p3');
  await sync(w, ['--run-id', 'cs3']);
  assert.equal(byKey(w).get(s1).active, true);
});

test('links that are planned but not in Notion yet (distill --link) and a status that is about to change can be given to syncCases', async () => {
  const w = makeMiniWorld({ rows: [{ id: 'o1', claim: 'Overlay hedge', tag: 'Predictive', outcome: 'Does not apply', seeded: true, seededReasoning: 'Rule should change: x' }] });
  const [k] = w.keys;
  w.lesson({ title: 'Planned lesson', tag: 'Predictive', status: 'Live', supporting: [k] });
  await w.pull('p1');
  const pull = loadPull(w.root, 'p1');
  const plain = syncCases({ root: w.root, pull, now: w.clock.now, write: false });
  assert.equal(plain.cases[0].active, true);
  const linked = syncCases({ root: w.root, pull, now: w.clock.now, write: false, links: new Map([[k, ['Planned lesson']]]) });
  assert.equal(linked.cases[0].active, true, 'the lesson is Live in the pull');
  const rolledBack = syncCases({ root: w.root, pull, now: w.clock.now, write: false, links: new Map([[k, ['Planned lesson']]]), lessonStatus: new Map([['Planned lesson', 'Rolled back']]) });
  assert.equal(rolledBack.cases[0].contested, true);
  assert.equal(rolledBack.cases[0].contested_lesson, 'Planned lesson');
  const unknown = syncCases({ root: w.root, pull, now: w.clock.now, write: false, links: new Map([[k, ['Not in Notion yet']]]) });
  assert.equal(unknown.cases[0].contested_lesson, 'Planned lesson', 'the Live lesson from the pull still wins');
  assert.equal(existsSync(join(w.root, 'evals', 'cases.jsonl')) && readFileSync(join(w.root, 'evals', 'cases.jsonl'), 'utf8'), '', 'write: false leaves the file alone');
});

// ---- the research cases -----------------------------------------------------------------------------------------------------------------------

test('with the research cases: ids are kept, stale hashes re-stamped, research-only cases kept and marked, the 62 are still 62', async () => {
  const w = makeLoopWorld({ cases: 'research' });
  const research = readJsonl(join(w.root, 'evals', 'cases.jsonl')).rows;
  assert.equal(research.length, 62);
  await w.pull('p1');
  const r = await sync(w, ['--run-id', 'cs1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /62 case\(s\) \(27 from decisions, 35 kept from research\), active 35 \(1 not_run\), contested 3, inactive 24; added 0, updated 62 \(hash re-stamped 6\)/);
  const cases = casesOf(w);
  assert.equal(cases.length, 62);
  assert.deepEqual(cases.map((c) => c.case_id), research.map((c) => c.case_id), 'same ids in the same order');
  const rubric = liveRubric();
  const live = (tag) => rubric.tags.find((t) => t.name === tag).tag_hash;

  const predictive = cases.filter((c) => c.tag === 'Predictive');
  assert.equal(predictive.length, 6);
  assert.deepEqual([...new Set(predictive.map((c) => c.tag_hash))], [live('Predictive')], 'the stale research hash is re-stamped');
  assert.deepEqual(research.filter((c) => c.tag === 'Predictive').map((c) => c.tag_hash), Array(6).fill('sha256:a95daf70f5fd95a3'));

  // decided rows: regenerated from the queue, the research fields kept
  const texas = cases.find((c) => c.case_id === 'ctr-c78bac8861c7-predic');
  assert.equal(texas.source, 'queue');
  assert.equal(texas.key, rowKey(w, 'f376c2cc'));
  assert.equal(texas.editor_decision, 'Disagree', 'the research fields survive');
  assert.equal(texas.research_source, 'Claims to review (Notion), fetched 13 Oct 2026');
  assert.equal(texas.research_source_row, 'https://app.notion.com/p/3f4273e214eb813b909fc78bac8861c7');
  assert.match(texas.source_row, /^https:\/\/www\.notion\.so\//);
  // research cases without a decided row are kept as they were, marked as research
  const kept = cases.filter((c) => c.source === 'research');
  assert.equal(kept.length, 35);
  for (const c of kept) {
    const old = research.find((x) => x.case_id === c.case_id);
    assert.equal(c.claim, old.claim);
    assert.equal(c.expected, old.expected);
    assert.equal(c.active, old.active);
    assert.equal(c.contested, old.contested);
    assert.equal(c.research_source, 'Claims to review (Notion), fetched 13 Oct 2026');
  }
  assert.equal(cases.find((c) => c.case_id === 'ctr-c9915a9655ec-source').active, true, 'Source inaccessible without a queue row stays an active research case');
  assert.equal(cases.find((c) => c.case_id === 'ctr-e05138dd8e72-hypoth').contested, true, 'Ukraine stays contested while its row is open');
  // another suite keeps its own rules
  const mirror = cases.find((c) => c.case_id === 'ctr-d7ceb2454d95-unsour');
  assert.equal(mirror.suite, 'mirror-freshness');
  assert.equal(mirror.active, false);
  assert.equal(mirror.source, 'queue');
  // the plan: every active queue-backed case (26 of the 27; the mirror-freshness one is off)
  assert.equal(planOf(w, 'cs1').ops.length, 26);
  assert.ok(!regressionKeys(w, 'cs1').includes(mirror.key));
});

test('re-stamping follows the live rubric: after a rule changes, the tag hash, the rule hash and the version of its cases follow', async () => {
  const w = makeLoopWorld({ cases: 'research' });
  await w.pull('p1');
  await sync(w, ['--run-id', 'cs1']);
  const before = byKey(w);
  const ctx = [...before.values()].find((c) => c.tag === 'Context-dependent' && c.rule_ref === 'Context-dependent rule 5');
  assert.ok(ctx, 'a Context-dependent case that cites rule 5');
  const rubric = liveRubric();
  const next = applyLesson(rubric, { tag: 'Context-dependent', kind: 'Change the rule', ruleN: 5, newText: 'Do not use for indefinites, time expressions or generics.', lesson_id: 'LS-9' }, { version: '2026-10-13.2' });
  writeFileSync(join(w.root, 'rubric', 'rubric.json'), `${JSON.stringify(next, null, 2)}\n`);
  const r = await sync(w, ['--run-id', 'cs2']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const after = casesOf(w).find((c) => c.case_id === ctx.case_id);
  const tag = next.tags.find((t) => t.name === 'Context-dependent');
  assert.notEqual(after.tag_hash, ctx.tag_hash);
  assert.equal(after.tag_hash, tag.tag_hash);
  assert.equal(after.rule_hash, ruleHash('Context-dependent', 5, 'Do not use for indefinites, time expressions or generics.'));
  assert.equal(after.rubric_version, '2026-10-13.2');
  const other = casesOf(w).find((c) => c.tag === 'Hypothetical' && c.source === 'queue');
  assert.equal(other.rubric_version, '2026-10-13.1', 'a tag whose hash did not change keeps its version');
  // research-only cases are re-stamped as well
  const researchOnly = casesOf(w).find((c) => c.source === 'research' && c.tag === 'Source inaccessible');
  assert.equal(researchOnly.tag_hash, next.tags.find((t) => t.name === 'Source inaccessible').tag_hash);
});

// ---- where the claim text comes from ------------------------------------------------------------------------------------------------------------

test('claim texts: a pull without the Claims uses an earlier pull, then the cases file, then the seed; a claim nobody knows is reported', async () => {
  const w = makeLoopWorld();
  await w.pull('p1'); // holds the Claims
  await w.pull('p2', ['tag_decisions', 'rule_changes', 'rulebook']);
  const r = await sync(w, ['--pull', 'p2', '--run-id', 'cs1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(casesOf(w).length, 27, 'the texts came from p1');
  assert.ok(casesOf(w).every((c) => c.claim.length > 10));
  const pull = loadPull(w.root, 'p2');
  const texts = claimTexts(w.root, pull, []);
  assert.equal(texts.get(Object.keys(w.ids.claims)[0]).claim.length > 10, true);

  const lone = makeMiniWorld({ rows: [{ id: 'z1', claim: 'Only the pull knows this claim', tag: 'Predictive', outcome: 'Applies' }] });
  await lone.pull('q1', ['tag_decisions', 'rule_changes', 'rulebook']);
  const l = await sync(lone, ['--pull', 'q1', '--run-id', 'cs1']);
  assert.equal(l.code, EXIT.OK);
  assert.match(l.out[0], /0 case\(s\)/);
  assert.match(l.err.join('\n'), /no claim text for .*::Predictive: pull the Claims too/);
});

// ---- the command ------------------------------------------------------------------------------------------------------------------------------

test('command line: no pull, a pull without Tag decisions, a pause, bad arguments, help', async () => {
  const w = makeLoopWorld();
  let r = await sync(w);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join(''), /there is no pull yet/);
  await w.pull('p1', ['rulebook', 'claims']);
  r = await sync(w);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join(''), /does not include Tag decisions/);
  r = await sync(w, ['--pull', 'nope']);
  assert.equal(r.code, EXIT.INVALID);
  await w.pull('p2');
  writeFileSync(join(w.root, 'runs', 'PAUSED'), '{}');
  r = await sync(w);
  assert.equal(r.code, EXIT.PAUSED);
  assert.match(r.err.join(''), /PAUSED/);
  for (const argv of [['--bogus'], ['stray'], ['--pull']]) {
    r = await sync(w, argv);
    assert.equal(r.code, EXIT.INVALID, JSON.stringify(argv));
    assert.match(r.err.join(''), /usage: node agents\/claim-tagger\/scripts\/cases-sync\.mjs/);
  }
  r = await sync(w, ['--help']);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out[0], /\[--pull <id>\] \[--run-id <id>\]/);
});

test('command line: a run id that was applied already is refused', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  assert.equal((await sync(w, ['--run-id', 'cs1'])).code, EXIT.OK);
  planCheck({ root: w.root, runId: 'cs1', now: w.clock.now });
  const cap = captureIo();
  assert.equal(await applyMain(['--run', 'cs1'], cap.io, w.env()), EXIT.OK);
  await w.pull('p2');
  w.decide(Object.keys(w.ids.decisions).find((k) => k.endsWith('::Debate')) ?? rowKey(w, '01c0d1ae'), { outcome: 'Applies', why: 'Agent slip', reasoning: 'x' });
  await w.pull('p3');
  const r = await sync(w, ['--run-id', 'cs1']);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join(''), /already been applied/);
});

test('geoId is stable and 32 hex digits (the fixtures depend on it)', () => {
  assert.match(geoId('a'), /^[0-9a-f]{32}$/);
  assert.equal(geoId('a'), geoId('a'));
  assert.notEqual(geoId('a'), geoId('b'));
});
