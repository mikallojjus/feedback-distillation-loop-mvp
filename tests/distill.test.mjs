import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main as applyMain } from '../agents/claim-tagger/scripts/apply.mjs';
import { main as casesMain } from '../agents/claim-tagger/scripts/cases-sync.mjs';
import {
  OVERFIT_NOTE_MARK, buildInput, checkReply, groupRows, lessonTexts, main, ngramOverlap, parseRuleLabel, ruleLabel, stripRuleNumber, targetCurrentText, thresholdOf,
} from '../agents/claim-tagger/scripts/distill.mjs';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { readJson, readJsonl } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { composeWhenToUse } from '../agents/claim-tagger/scripts/lib/rubric-build.mjs';
import { validate } from '../agents/claim-tagger/scripts/lib/validate.mjs';
import { check as planCheck, readPlan } from '../agents/claim-tagger/scripts/plan.mjs';
import { RETRY_MARK } from './fixtures/loop/fake-claude.mjs';
import { AGENT, captureIo, cleanupLoop, liveRubric, makeLoopWorld, makeMiniWorld, rowKey } from './fixtures/loop/world.mjs';

after(() => cleanupLoop());

const rubric = liveRubric();
const lessonSchema = JSON.parse(readFileSync(join(AGENT, 'schemas', 'lesson.schema.json'), 'utf8'));

const distill = async (w, argv = [], extra = {}) => {
  const c = captureIo();
  const fakeState = extra.fakeState ?? { calls: 0, log: [] };
  const code = await main(['--driver', 'fake', ...argv], c.io, w.env({ fakeState, ...extra }));
  return { code, out: c.out, err: c.err, fakeState };
};
const runDir = (w, id) => join(w.root, 'runs', id);
const lessonsOf = (w, id) => readJsonl(join(runDir(w, id), 'lessons.jsonl')).rows;
const opsOf = (w, id) => readPlan(w.root, id).ops;
const casesOf = (w) => readJsonl(join(w.root, 'evals', 'cases.jsonl')).rows;

/** n editor-decided rows of one tag, all with the same Why wrong, for a mini world. */
const ruleRows = (prefix, tag, why, n, extra = {}) => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}${i + 1}`, claim: `The ${prefix} claim number ${i + 1} is about the budget bill and the court`, tag, outcome: 'Does not apply', why, reasoning: `Editor sentence ${i + 1} for ${prefix}.`, ...extra,
}));

// ---- the helpers -------------------------------------------------------------------------------------------------------------------------------

test('parseRuleLabel and ruleLabel: "<Tag> rule <n>" and "<Tag> when to use", nothing else', () => {
  assert.deepEqual(parseRuleLabel('Predictive rule 1', 'Predictive'), { part: 'rule', rule_n: 1 });
  assert.deepEqual(parseRuleLabel('  predictive   RULE 12 ', 'Predictive'), { part: 'rule', rule_n: 12 });
  assert.deepEqual(parseRuleLabel('Predictive when to use', 'Predictive'), { part: 'whole', rule_n: null });
  assert.deepEqual(parseRuleLabel('When to use', 'Predictive'), { part: 'whole', rule_n: null });
  assert.equal(parseRuleLabel('Debate rule 1', 'Predictive'), null);
  assert.equal(parseRuleLabel('Predictive rule', 'Predictive'), null);
  assert.equal(parseRuleLabel('', 'Predictive'), null);
  assert.equal(parseRuleLabel(null, 'Predictive'), null);
  assert.equal(ruleLabel('Debate', { part: 'rule', rule_n: 4 }), 'Debate rule 4');
  assert.equal(ruleLabel('Debate', { part: 'note', rule_n: null }), 'Debate when to use');
});

test('targetCurrentText is the composed text of the targeted part, straight from the rubric', () => {
  const pred = rubric.tags.find((t) => t.name === 'Predictive');
  assert.equal(targetCurrentText(rubric, 'Predictive', { part: 'rule', rule_n: 1 }), `1. ${pred.when_to_use.rules[0].text}`);
  assert.equal(targetCurrentText(rubric, 'Predictive', { part: 'whole' }), composeWhenToUse(pred.when_to_use));
  assert.equal(targetCurrentText(rubric, 'Predictive', { part: 'note' }), `Note: ${pred.when_to_use.note}`);
  assert.equal(targetCurrentText(rubric, 'Predictive', { part: 'preamble' }), pred.when_to_use.preamble);
  assert.equal(targetCurrentText(rubric, 'Predictive', { part: 'rule', rule_n: 99 }), null);
  assert.equal(targetCurrentText(rubric, 'No such tag', { part: 'whole' }), null);
  assert.equal(targetCurrentText(rubric, 'Context-dependent', { part: 'note' }), '', 'a tag without a note has no note text');
  assert.equal(stripRuleNumber('2. Only a pronoun.'), 'Only a pronoun.');
  assert.equal(stripRuleNumber('  Only a pronoun.\n'), 'Only a pronoun.');
});

test('ngramOverlap: 8 consecutive words, case and punctuation ignored; 7 are fine; a whole short claim counts', () => {
  const claim = 'The Supreme Court is likely to expand executive power further in the future';
  assert.deepEqual(ngramOverlap('x', [claim], 8), { hit: false, claim: null, ngram: null });
  const seven = 'Rule: the supreme court is likely to expand and then it stops';
  assert.equal(ngramOverlap(seven, [claim], 8).hit, false);
  const eight = 'Rule: THE SUPREME, COURT is likely to expand executive. Then it stops';
  const hit = ngramOverlap(eight, [claim], 8);
  assert.equal(hit.hit, true);
  assert.equal(hit.ngram, 'the supreme court is likely to expand executive');
  assert.equal(hit.claim, claim);
  // a claim shorter than 8 words (but at least 5) is a match when the text repeats all of it
  assert.equal(ngramOverlap('Anything like Texas is on track to win counts', ['Texas is on track to win'], 8).hit, true);
  assert.equal(ngramOverlap('Texas is on track', ['Texas is on track to win'], 8).hit, false);
  assert.equal(ngramOverlap('Short claim here', ['Short claim here'], 8).hit, false, 'under 5 words nothing can be a quotation');
  assert.equal(ngramOverlap('', [], 8).hit, false);
});

test('thresholds: 2 claims for Rule unclear, 3 for Rule should change, 2 through the owner-ruling route', () => {
  const cfg = { min_claims: 2, min_claims_rule_change: 3, owner_ruling_at: 2 };
  const group = (why, n) => ({ why, rows: Array.from({ length: n }, (_, i) => ({ geo_id: `g${i}` })) });
  assert.deepEqual(thresholdOf(group('Rule unclear', 1), cfg), { need: 2, claims: 1, ok: false, route: false });
  assert.deepEqual(thresholdOf(group('Rule unclear', 2), cfg), { need: 2, claims: 2, ok: true, route: false });
  assert.deepEqual(thresholdOf(group('Rule should change', 1), cfg), { need: 3, claims: 1, ok: false, route: false });
  assert.deepEqual(thresholdOf(group('Rule should change', 2), cfg), { need: 3, claims: 2, ok: true, route: true });
  assert.deepEqual(thresholdOf(group('Rule should change', 3), cfg), { need: 3, claims: 3, ok: true, route: false });
  const sameClaim = { why: 'Rule should change', rows: [{ geo_id: 'g1' }, { geo_id: 'g1' }, { geo_id: 'g1' }] };
  assert.equal(thresholdOf(sameClaim, cfg).claims, 1, 'three rows of one claim are one claim');
  assert.equal(thresholdOf(group('Rule should change', 2), { ...cfg, owner_ruling_at: 3 }).ok, false);
});

test('groupRows: one group per tag and reason; rows that cite no rule join the one rule the others cite, else they keep a group of their own', () => {
  const r = (key, tag, why, rule_n) => ({ key, tag, why, rule_n, geo_id: key });
  const one = groupRows([r('b', 'Predictive', 'Rule should change', null), r('a', 'Debate', 'Rule unclear', null), r('c', 'Predictive', 'Rule should change', 1), r('d', 'Predictive', 'Rule should change', null)]);
  assert.deepEqual(one.map((g) => [g.tag, g.why, g.rule_n, g.rows.map((x) => x.key)]), [
    ['Debate', 'Rule unclear', null, ['a']], ['Predictive', 'Rule should change', 1, ['b', 'c', 'd']],
  ]);
  const two = groupRows([r('x', 'Debate', 'Rule unclear', 2), r('y', 'Debate', 'Rule unclear', 3), r('z', 'Debate', 'Rule unclear', null), r('w', 'Debate', 'Rule should change', null)]);
  assert.deepEqual(two.map((g) => [g.why, g.rule_n, g.rows.map((x) => x.key)]), [
    ['Rule should change', null, ['w']], ['Rule unclear', null, ['z']], ['Rule unclear', 2, ['x']], ['Rule unclear', 3, ['y']],
  ], 'two different rules are cited: the row that cites none is its own group; another reason is another group');
});

test('checkReply: schema, a real target rule, the kind mapping, the length limit, no change at all', () => {
  const group = { tag: 'Predictive', why: 'Rule should change', rule_n: null, rows: [] };
  const good = { kind: 'Clarify wording', target: { rule_n: 1, part: 'rule' }, title: 'Hedges are not forecasts', statement: 'A tendency is not a forecast.', proposed_text: '1. Fires only on flat markers.', boundary_examples: [], counter_evidence: ['x'], confidence: 0.6 };
  const ok = checkReply(good, { rubric, group });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.reply.kind, 'Change the rule', 'Rule should change always means Change the rule');
  assert.equal(ok.reply.proposed_text, 'Fires only on flat markers.', 'a typed rule number is dropped');
  assert.deepEqual(ok.reply.target, { part: 'rule', rule_n: 1 });
  const unclear = checkReply({ ...good, kind: 'Change the rule' }, { rubric, group: { ...group, why: 'Rule unclear' } });
  assert.equal(unclear.reply.kind, 'Clarify wording', 'Rule unclear never rewrites a rule');
  assert.equal(checkReply({ ...good, kind: 'Add boundary example' }, { rubric, group: { ...group, why: 'Rule unclear' } }).reply.kind, 'Add boundary example');
  const noRule = checkReply({ ...good, target: { rule_n: null, part: 'rule' } }, { rubric, group });
  assert.match(noRule.problems[0], /name the rule number/);
  assert.equal(checkReply({ ...good, target: { rule_n: null, part: 'rule' } }, { rubric, group: { ...group, rule_n: 2 } }).reply.target.rule_n, 2, 'the cited rule fills a missing number');
  assert.match(checkReply({ ...good, target: { rule_n: 99, part: 'rule' } }, { rubric, group }).problems[0], /not a rule of Predictive/);
  assert.match(checkReply({ ...good, proposed_text: 'x'.repeat(1901) }, { rubric, group }).problems[0], /1901 characters; the limit is 1900/);
  const same = rubric.tags.find((t) => t.name === 'Predictive').when_to_use.rules[0].text;
  assert.match(checkReply({ ...good, proposed_text: `1. ${same}` }, { rubric, group }).problems[0], /same as the current rule/);
  assert.match(checkReply({ ...good, title: Array(25).fill('word').join(' ') }, { rubric, group }).problems[0], /title is too long/);
  assert.ok(checkReply({ kind: 'Nope' }, { rubric, group }).problems.length > 0);
  assert.ok(checkReply([], { rubric, group }).problems[0].includes('one JSON object'));
  assert.ok(checkReply({ ...good, confidence: 3 }, { rubric, group }).problems.length > 0);
});

test('lessonTexts: a rule gives "<n>. text" and the new text; a note or preamble makes both texts the whole When to use', () => {
  const pred = rubric.tags.find((t) => t.name === 'Predictive');
  const rule = lessonTexts(rubric, 'Predictive', { target: { part: 'rule', rule_n: 2 }, proposed_text: 'New rule two.' });
  assert.equal(rule.rule_label, 'Predictive rule 2');
  assert.equal(rule.current_text, `2. ${pred.when_to_use.rules[1].text}`);
  assert.equal(rule.proposed_text, 'New rule two.');
  const note = lessonTexts(rubric, 'Predictive', { target: { part: 'note', rule_n: null }, proposed_text: 'Note: A new note.' });
  assert.equal(note.rule_label, 'Predictive when to use');
  assert.equal(note.current_text, composeWhenToUse(pred.when_to_use));
  assert.equal(note.proposed_text, composeWhenToUse({ ...pred.when_to_use, note: 'A new note.' }));
  const pre = lessonTexts(rubric, 'Predictive', { target: { part: 'preamble', rule_n: null }, proposed_text: 'A new opening line.' });
  assert.match(pre.proposed_text, /^A new opening line\.\n1\. /);
});

// ---- grouping, thresholds, the model ------------------------------------------------------------------------------------------------------------

test('groups and thresholds: 2 Rule unclear, 3 Rule should change, 2 through the owner route, never 1; other reasons and undecided rows do not count', async () => {
  const w = makeMiniWorld({ rows: [
    ...ruleRows('dbt', 'Debate', 'Rule unclear', 2),
    ...ruleRows('opn', 'Opinion', 'Rule unclear', 1),
    ...ruleRows('prd', 'Predictive', 'Rule should change', 3),
    ...ruleRows('hyp', 'Hypothetical', 'Rule should change', 2),
    ...ruleRows('fct', 'Factual', 'Rule should change', 1),
    ...ruleRows('slip', 'Simple', 'Agent slip', 4),
    ...ruleRows('nof', 'Self-contained', 'No tag fits', 4),
    ...ruleRows('evd', 'Multiple statements', null, 3, { outcome: 'Needs evidence' }),
  ] });
  await w.pull('p1');
  const r = await distill(w, ['--run-id', 'd1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /^distill: run d1: 3 lesson\(s\) proposed \(.*\), 2 group\(s\) skipped; 3 model call\(s\), \$0\.1500; plan /);
  const lessons = lessonsOf(w, 'd1');
  assert.deepEqual(lessons.map((l) => l.tag).sort(), ['Debate', 'Hypothetical', 'Predictive']);
  const by = Object.fromEntries(lessons.map((l) => [l.tag, l]));
  assert.equal(by.Debate.kind, 'Clarify wording');
  assert.equal(by.Debate.why_wrong, 'Rule unclear');
  assert.equal(by.Debate.owner_ruling_route, false);
  assert.equal(by.Predictive.kind, 'Change the rule');
  assert.equal(by.Predictive.owner_ruling_route, false, 'three claims need no ruling');
  assert.equal(by.Hypothetical.owner_ruling_route, true, 'two claims are proposed through the owner-ruling route');
  assert.equal(by.Predictive.supporting_keys.length, 3);
  assert.equal(by.Hypothetical.supporting_keys.length, 2);
  for (const l of lessons) {
    assert.deepEqual(validate(lessonSchema, l).errors, [], l.lesson_key);
    assert.equal(l.status, 'Proposed');
    assert.equal(l.rubric_version, '2026-10-13.1');
    assert.equal(l.demo, false);
  }
  const asked = r.fakeState.log.map((l) => [l.input.tag.name, l.input.why_wrong]).sort();
  assert.deepEqual(asked, [['Debate', 'Rule unclear'], ['Hypothetical', 'Rule should change'], ['Predictive', 'Rule should change']]);
  const run = readJson(join(runDir(w, 'd1'), 'run.json'));
  assert.deepEqual(run.skipped.sort(), ['Factual · Rule should change: 1 of 3 claims', 'Opinion · Rule unclear: 1 of 2 claims']);
  assert.equal(run.calls, 3);
  assert.equal(run.cost_usd, 0.15);
  assert.equal(run.kind, 'distill');
});

test('rows that cite no rule join the one rule the others cite; with two rules cited they stay apart', async () => {
  const w = makeMiniWorld({ rows: [
    ...ruleRows('cit', 'Predictive', 'Rule should change', 2, { note: 'The agent relied on Predictive rule 2 here.' }),
    ...ruleRows('unc', 'Predictive', 'Rule should change', 1),
  ] });
  await w.pull('p1');
  const r = await distill(w, ['--run-id', 'd1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(r.fakeState.log.length, 1, 'the claim that cites nothing joins the group of the rule the others cite: one lesson');
  assert.equal(r.fakeState.log[0].input.rule_cited, 'Predictive rule 2');
  assert.equal(r.fakeState.log[0].input.rows.length, 3);
  const [lesson] = lessonsOf(w, 'd1');
  assert.equal(lesson.rule_label, 'Predictive rule 2', 'the fake distiller targets the cited rule');
  assert.equal(lesson.owner_ruling_route, false, 'three claims');
  assert.equal(lesson.supporting_keys.length, 3);

  const w2 = makeMiniWorld({ rows: [
    ...ruleRows('two', 'Predictive', 'Rule should change', 2, { note: 'Predictive rule 2 fired.' }),
    ...ruleRows('thr', 'Predictive', 'Rule should change', 2, { note: 'Predictive rule 3 fired.' }),
    ...ruleRows('non', 'Predictive', 'Rule should change', 2),
  ] });
  await w2.pull('p1');
  const r2 = await distill(w2, ['--run-id', 'd1']);
  assert.equal(r2.code, EXIT.OK, r2.err.join('\n'));
  assert.deepEqual(r2.fakeState.log.map((l) => l.input.rule_cited).sort(), ['Predictive rule 2', 'Predictive rule 3', null]);
  assert.ok(lessonsOf(w2, 'd1').every((l) => l.owner_ruling_route === true), 'three groups of two claims each');
});

test('the model gets the JSON the prompt describes and the call has the pinned model, no tools, the distill prompt', async () => {
  const w = makeMiniWorld({ rows: [
    ...ruleRows('grp', 'Predictive', 'Rule should change', 3),
    ...ruleRows('oth', 'Predictive', 'Rule unclear', 14, { outcome: 'Applies' }),
    ...ruleRows('dbt', 'Debate', 'Agent slip', 2),
  ] });
  await w.pull('p1');
  const r = await distill(w, ['--run-id', 'd1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const call = r.fakeState.log.find((l) => l.input.why_wrong === 'Rule should change');
  const input = call.input;
  const pred = rubric.tags.find((t) => t.name === 'Predictive');
  assert.deepEqual(Object.keys(input), ['tag', 'why_wrong', 'rule_cited', 'rows', 'other_rows', 'example_claims']);
  assert.equal(input.tag.name, 'Predictive');
  assert.equal(input.tag.description, pred.description);
  assert.deepEqual(input.tag.when_to_use.rules, pred.when_to_use.rules.map((x) => ({ n: x.n, text: x.text })));
  assert.deepEqual(input.example_claims, pred.example_claims);
  assert.equal(input.rule_cited, null);
  assert.equal(input.rows.length, 3);
  assert.deepEqual(Object.keys(input.rows[0]), ['claim', 'outcome', 'reasoning', 'agent_proposal', 'agent_reason']);
  assert.equal(input.rows[0].outcome, 'Does not apply');
  assert.match(input.rows[0].reasoning, /^Editor sentence \d for grp\.$/);
  assert.equal(input.rows[0].agent_proposal, 'Do not add tag');
  assert.equal(input.other_rows.length, 12, 'at most 12 other decided rows on the tag');
  assert.ok(input.other_rows.every((o) => o.why_wrong === 'Rule unclear'));
  assert.ok(input.other_rows.every((o) => !input.rows.some((g) => g.claim === o.claim)), 'none of the group\'s own rows');
  assert.equal(call.model, 'claude-opus-5-5');
  assert.ok(call.args.includes('--tools'));
  assert.equal(call.args[call.args.indexOf('--tools') + 1], '');
  assert.ok(call.args[call.args.indexOf('--system-prompt-file') + 1].endsWith(join('prompts', 'distill.md')));
  assert.equal(call.args[call.args.indexOf('--max-turns') + 1], '1');
  assert.equal(buildInput({ rubric, group: { tag: 'Debate', why: 'Rule unclear', rule_n: 3, rows: [{ claim: 'c', outcome: 'Applies', reasoning: null, agent_proposal: null, agent_reason: null }] }, otherRows: [] }).rule_cited, 'Debate rule 3');
});

test('current_text always comes from the rubric, whatever the model says; the kind follows the reason; the plan carries the lesson', async () => {
  const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule should change', 3) });
  await w.pull('p1');
  const stub = async () => ({
    ok: true, errorKind: null, message: '', costUsd: 0.02, durationMs: 1, modelUsage: { 'claude-opus-5-5': {} },
    text: `\`\`\`json\n${JSON.stringify({
      kind: 'Clarify wording', target: { rule_n: 1, part: 'rule' }, title: 'Hedged tendencies are not forecasts', statement: 'A tendency is not a forecast.', current_text: 'MADE UP BY THE MODEL',
      proposed_text: '1. Fires on an unconditional marker only; a hedged tendency does not fire this rule.', boundary_examples: [{ claim: 'Rain is likely tomorrow in the valley.', applies: false }], counter_evidence: ['The example claim about the market stays covered.'], confidence: 0.8,
    })}\n\`\`\``,
  });
  const r = await distill(w, ['--run-id', 'd1'], { runClaude: stub });
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const [lesson] = lessonsOf(w, 'd1');
  const pred = rubric.tags.find((t) => t.name === 'Predictive');
  assert.equal(lesson.current_text, `1. ${pred.when_to_use.rules[0].text}`);
  assert.equal(lesson.proposed_text, 'Fires on an unconditional marker only; a hedged tendency does not fire this rule.');
  assert.equal(lesson.kind, 'Change the rule');
  assert.equal(lesson.lesson_key, 'Hedged tendencies are not forecasts');
  assert.equal(lesson.rule_label, 'Predictive rule 1');
  assert.equal(lesson.confidence, 0.8);
  assert.deepEqual(lesson.counter_evidence, ['The example claim about the market stays covered.']);

  const { ops, header } = readPlan(w.root, 'd1');
  assert.deepEqual(header.ctx, { seed: false, promote: false, gate: null });
  const create = ops.find((o) => o.database === 'rule_changes');
  assert.equal(create.op, 'create');
  assert.equal(create.key, 'Hedged tendencies are not forecasts');
  assert.deepEqual(Object.keys(create.properties).sort(), ['Current text', 'Kind', 'Lesson title', 'Proposed text', 'Rubric version', 'Rule', 'Status', 'Tag']);
  assert.equal(create.properties.Status, 'Proposed');
  assert.equal(create.properties.Kind, 'Change the rule');
  assert.equal(create.properties.Rule, 'Predictive rule 1');
  assert.equal(create.properties['Rubric version'], '2026-10-13.1');
  assert.equal(create.properties['Current text'], lesson.current_text);
  assert.equal(create.properties['Proposed text'], lesson.proposed_text);
  assert.deepEqual(create.properties.Tag, [w.ids.rulebook.Predictive]);
  assert.match(create.content_md, /^## What the editors decided\nA tendency is not a forecast\./);
  assert.match(create.content_md, /## Supporting decisions\n- The prd claim number 1 .* - Does not apply\. Editor: "Editor sentence 1 for prd\."/);
  assert.match(create.content_md, /## Boundary examples\n- Does not apply: Rain is likely tomorrow in the valley\./);
  assert.match(create.content_md, /## Counter-evidence\n- The example claim about the market stays covered\./);
  assert.doesNotMatch(create.content_md, /## Notes/);
  const runsOp = ops.find((o) => o.database === 'runs');
  assert.equal(runsOp.key, 'Distill 2026-10-13');
  assert.equal(runsOp.properties.Kind, 'Distill');
  assert.equal(runsOp.properties.Verdict, 'n/a');
  assert.equal(runsOp.properties['Rubric version'], '2026-10-13.1');
  assert.equal(runsOp.properties.Model, 'claude-opus-5-5');
  assert.equal(runsOp.properties['Cost USD'], 0.02);
  assert.match(runsOp.properties.Summary, /^1 lesson\(s\) proposed: Hedged tendencies are not forecasts/);
  assert.equal(ops.length, 2);
  assert.equal(planCheck({ root: w.root, runId: 'd1', now: w.clock.now }).code, EXIT.OK);
});

test('a note target gives a lesson on the whole When to use', async () => {
  const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule unclear', 2) });
  await w.pull('p1');
  const stub = async () => ({
    ok: true, errorKind: null, message: '', costUsd: 0.01, durationMs: 1, modelUsage: { 'claude-opus-5-5': {} },
    text: JSON.stringify({ kind: 'Add boundary example', target: { rule_n: null, part: 'note' }, title: 'Add a boundary note', statement: 'A note helps.', proposed_text: 'A hedged tendency such as a likely outcome is not a forecast.', boundary_examples: [], counter_evidence: [], confidence: 0.5 }),
  });
  const r = await distill(w, ['--run-id', 'd1'], { runClaude: stub });
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const [lesson] = lessonsOf(w, 'd1');
  const pred = rubric.tags.find((t) => t.name === 'Predictive');
  assert.equal(lesson.rule_label, 'Predictive when to use');
  assert.equal(lesson.current_text, composeWhenToUse(pred.when_to_use));
  assert.equal(lesson.proposed_text, composeWhenToUse({ ...pred.when_to_use, note: 'A hedged tendency such as a likely outcome is not a forecast.' }));
  assert.deepEqual(lesson.target, { rule_n: null, part: 'note' });
  assert.equal(lesson.kind, 'Add boundary example');
});

// ---- the overfit check ---------------------------------------------------------------------------------------------------------------------------

test('overfit: a proposed text that repeats 8 words of a supporting claim gets one retry with a note; a clean retry is taken', async () => {
  const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule should change', 3) });
  await w.pull('p1');
  const state = { calls: 0, log: [], mode: 'overlap_once' };
  const r = await distill(w, ['--run-id', 'd1'], { fakeState: state });
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(state.log.length, 2, 'one call and one retry');
  assert.equal(state.log[0].retry, false);
  assert.equal(state.log[1].retry, true);
  assert.equal(RETRY_MARK, OVERFIT_NOTE_MARK, 'the fixture and the script use the same marker');
  const [lesson] = lessonsOf(w, 'd1');
  assert.equal('overfit_risk' in lesson, false);
  assert.doesNotMatch(lesson.proposed_text, /budget bill/);
  assert.equal(r.err.join('').includes('overfit'), false);
});

test('overfit: when the retry still repeats the claim the lesson is flagged overfit_risk, kept, and said so on the page and on stderr', async () => {
  const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule should change', 3) });
  await w.pull('p1');
  const state = { calls: 0, log: [], mode: 'overlap' };
  const r = await distill(w, ['--run-id', 'd1'], { fakeState: state });
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(state.log.length, 2, 'at most two calls per group');
  const [lesson] = lessonsOf(w, 'd1');
  assert.equal(lesson.overfit_risk, true);
  assert.match(lesson.overfit_ngram, /^the prd claim number \d is about the$/);
  assert.match(r.err.join('\n'), /warning: ".*" still repeats 8 words of a supporting claim after one retry \(overfit risk\)/);
  const page = opsOf(w, 'd1').find((o) => o.database === 'rule_changes').content_md;
  assert.match(page, /## Notes\n- Overfit risk: the proposed text still repeats a run of words/);
  assert.deepEqual(validate(lessonSchema, lesson).errors, []);
});

// ---- bad replies, the usage window ----------------------------------------------------------------------------------------------------------------

test('a reply that is not JSON gets one retry that quotes the problem; two bad replies lose the group, not the run', async () => {
  const w = makeMiniWorld({ rows: [...ruleRows('prd', 'Predictive', 'Rule should change', 3), ...ruleRows('dbt', 'Debate', 'Rule unclear', 2)] });
  await w.pull('p1');
  const prompts = [];
  const good = (tag) => JSON.stringify({ kind: 'Clarify wording', target: { rule_n: 1, part: 'rule' }, title: `Fixed ${tag}`, statement: 's', proposed_text: `Clarified ${tag} rule text`, boundary_examples: [], counter_evidence: [], confidence: 0.5 });
  const stub = async (opts) => {
    prompts.push(opts.prompt);
    const tag = JSON.parse(opts.prompt.slice(0, opts.prompt.lastIndexOf('}') + 1)).tag.name;
    const first = prompts.filter((p) => p.includes(`"name": "${tag}"`)).length === 1;
    const bad = tag === 'Debate' || first;
    return { ok: true, errorKind: null, message: '', costUsd: 0.01, durationMs: 1, modelUsage: { 'claude-opus-5-5': {} }, text: bad ? 'Sorry, I would rather not.' : good(tag) };
  };
  const r = await distill(w, ['--run-id', 'd1'], { runClaude: stub });
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.deepEqual(lessonsOf(w, 'd1').map((l) => l.tag), ['Predictive'], 'Predictive worked on the retry, Debate did not');
  assert.ok(prompts.some((p) => /Your previous reply was invalid: the reply is not valid JSON/.test(p)), 'the retry quotes the problem');
  assert.equal(prompts.length, 4);
  assert.match(r.out[0], /1 lesson\(s\) proposed.*1 group\(s\) skipped/);
  assert.match(r.err.join('\n'), /Debate · Rule unclear: no valid reply after two tries/);
  const group = readdirSync(join(runDir(w, 'd1'), 'groups'));
  assert.equal(group.length, 2);
});

test('when every group fails the command fails (exit 1), writes no plan, and keeps a record of what was asked', async () => {
  const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule should change', 3) });
  await w.pull('p1');
  for (const mode of ['garbage', 'bad_target', 'long']) {
    const r = await distill(w, ['--run-id', `d-${mode}`], { fakeState: { calls: 0, log: [], mode } });
    assert.equal(r.code, EXIT.ERROR, mode);
    assert.equal(r.fakeState.log.length, 2, `${mode}: one retry`);
    assert.equal(existsSync(join(runDir(w, `d-${mode}`), 'plan.jsonl')), false, `${mode}: no plan`);
    const record = readJson(join(runDir(w, `d-${mode}`), 'run.json'));
    assert.equal(record.status, 'nothing proposed', mode);
    assert.equal(record.calls, 2, mode);
    const [groupFile] = readdirSync(join(runDir(w, `d-${mode}`), 'groups'));
    const group = readJson(join(runDir(w, `d-${mode}`), 'groups', groupFile));
    assert.match(group.failed, /no valid reply after two tries/);
    assert.equal(group.input.why_wrong, 'Rule should change');
    assert.equal(group.attempts.length, 2);
    assert.match(r.err.join('\n'), /no valid reply after two tries/);
  }
});

test('usage window: exit 75 with the hint, nothing written; the wrong model: exit 4; a CLI that will not start: exit 1', async () => {
  const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule should change', 3) });
  await w.pull('p1');
  let r = await distill(w, ['--run-id', 'd1'], { fakeState: { calls: 0, log: [], mode: 'usage_limit' } });
  assert.equal(r.code, EXIT.USAGE_WINDOW);
  assert.match(r.err.join('\n'), /usage window ran out \(.*reset at 3am\); nothing was written/);
  assert.equal(existsSync(runDir(w, 'd1')), false);
  const failing = (errorKind) => async () => ({ ok: false, errorKind, message: errorKind === 'model_mismatch' ? 'asked for claude-opus-5-5 but modelUsage lists claude-x' : 'cannot start claude: ENOENT', text: '', costUsd: 0 });
  r = await distill(w, ['--run-id', 'd2'], { runClaude: failing('model_mismatch') });
  assert.equal(r.code, EXIT.DRIFT);
  assert.match(r.err.join('\n'), /pinned model claude-opus-5-5 did not answer/);
  r = await distill(w, ['--run-id', 'd3'], { runClaude: failing('spawn') });
  assert.equal(r.code, EXIT.ERROR);
  assert.match(r.err.join('\n'), /claude could not be started/);
});

// ---- dedupe ------------------------------------------------------------------------------------------------------------------------------------------

test('dedupe: new rows are linked to an existing Proposed, Approved or Live lesson on the tag; no second lesson is made', async () => {
  for (const status of ['Proposed', 'Approved', 'Live']) {
    const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule should change', 4) });
    const [k1, k2, k3, k4] = w.keys;
    w.lesson({ title: `Existing ${status}`, tag: 'Predictive', rule: 'Predictive rule 1', status, supporting: [k1, k2] });
    await w.pull('p1');
    const r = await distill(w, ['--run-id', 'd1']);
    assert.equal(r.code, EXIT.OK, `${status}: ${r.err.join('\n')}`);
    assert.equal(r.fakeState.log.length, 0, `${status}: no model call`);
    assert.match(r.out[0], /0 lesson\(s\) proposed, 2 row\(s\) linked to existing lessons/);
    const ops = opsOf(w, 'd1');
    assert.deepEqual(ops.filter((o) => o.database === 'rule_changes'), []);
    const updates = ops.filter((o) => o.database === 'tag_decisions');
    assert.deepEqual(updates.map((o) => o.key).sort(), [k3, k4].sort());
    for (const u of updates) assert.deepEqual(Object.keys(u.properties), ['Lesson']);
    assert.equal(planCheck({ root: w.root, runId: 'd1', now: w.clock.now }).code, EXIT.OK);
    const cap = captureIo();
    assert.equal(await applyMain(['--run', 'd1'], cap.io, w.env()), EXIT.OK, cap.err.join('\n'));
    assert.equal(w.fake.get(w.ids.decisions[k3]).props.Lesson.length, 1);
    assert.equal(w.fake.get(w.ids.decisions[k3]).props.Lesson[0], w.fake.find('rule_changes', `Existing ${status}`).page_id);
  }
});

test('dedupe: a relation the row already has is kept when the new lesson is added, and a fully covered group needs nothing', async () => {
  const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule should change', 3) });
  const [k1, k2, k3] = w.keys;
  const old = w.lesson({ title: 'Old rejected lesson', tag: 'Predictive', status: 'Rejected', supporting: [k3] });
  const live = w.lesson({ title: 'Existing live', tag: 'Predictive', status: 'Live', supporting: [k1, k2] });
  await w.pull('p1');
  let r = await distill(w, ['--run-id', 'd1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const update = opsOf(w, 'd1').find((o) => o.database === 'tag_decisions');
  assert.equal(update.key, k3);
  assert.deepEqual([...update.properties.Lesson].sort(), [old, live].sort(), 'the earlier link stays');
  w.fake.editorSet(w.ids.decisions[k3], { Lesson: [old, live] });
  await w.pull('p2');
  r = await distill(w, ['--run-id', 'd2']);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out[0], /^distill: nothing to propose: Predictive · Rule should change: already covered by "Existing live"/);
  assert.equal(existsSync(runDir(w, 'd2')), false);
});

test('dedupe: a lesson about another rule of the tag does not hide a new group', async () => {
  const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule should change', 3, { note: 'Per Predictive rule 1, it fires.' }) });
  w.lesson({ title: 'About rule 4', tag: 'Predictive', rule: 'Predictive rule 4', status: 'Proposed' });
  await w.pull('p1');
  const r = await distill(w, ['--run-id', 'd1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(r.fakeState.log.length, 1);
  assert.equal(lessonsOf(w, 'd1').length, 1);
});

test('rows that an open lesson about another rule covers are not covered for this rule', async () => {
  const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule should change', 3, { note: 'Per Predictive rule 1, it fires.' }) });
  w.lesson({ title: 'About rule 4', tag: 'Predictive', rule: 'Predictive rule 4', status: 'Proposed', supporting: w.keys.slice(0, 2) });
  await w.pull('p1');
  const r = await distill(w, ['--run-id', 'd1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const [lesson] = lessonsOf(w, 'd1');
  assert.equal(lesson.supporting_keys.length, 3, 'all three rows support the lesson about rule 1: the link to the rule 4 lesson does not cover them');
});

test('a Rejected or Rolled back lesson stands unless at least 2 rows were decided after it was created', async () => {
  for (const status of ['Rejected', 'Rolled back']) {
    const w = makeMiniWorld({ rows: [...ruleRows('old', 'Predictive', 'Rule should change', 3, { at: '2026-10-09' }), ...ruleRows('new', 'Predictive', 'Rule should change', 1, { at: '2026-10-14' })] });
    w.lesson({ title: `Closed ${status}`, tag: 'Predictive', rule: 'Predictive rule 1', status });
    await w.pull('p1');
    let r = await distill(w, ['--run-id', 'd1']);
    assert.equal(r.code, EXIT.OK);
    assert.match(r.out[0], new RegExp(`nothing to propose: Predictive · Rule should change: "Closed ${status}" is ${status} and only 1 row\\(s\\) were decided since`), status);
    assert.equal(r.fakeState.log.length, 0);

    const w2 = makeMiniWorld({ rows: [...ruleRows('old', 'Predictive', 'Rule should change', 3, { at: '2026-10-09' }), ...ruleRows('new', 'Predictive', 'Rule should change', 2, { at: '2026-10-14' })] });
    w2.lesson({ title: `Closed ${status}`, tag: 'Predictive', rule: 'Predictive rule 1', status });
    await w2.pull('p1');
    r = await distill(w2, ['--run-id', 'd1']);
    assert.equal(r.code, EXIT.OK, r.err.join('\n'));
    assert.equal(lessonsOf(w2, 'd1').length, 1, `${status}: two newer rows bring a new lesson`);
    assert.equal(lessonsOf(w2, 'd1')[0].supporting_keys.length, 5, 'all the evidence supports it');
  }
});

test('a title that is already a lesson title gets a number', async () => {
  const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule should change', 3, { at: '2026-10-14' }) });
  w.lesson({ title: 'Fake lesson: Predictive Rule should change', tag: 'Predictive', rule: 'Predictive rule 1', status: 'Rejected' });
  await w.pull('p1');
  const r = await distill(w, ['--run-id', 'd1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(lessonsOf(w, 'd1')[0].lesson_key, 'Fake lesson: Predictive Rule should change (2)');
});

// ---- seeded decisions and the demo lesson -------------------------------------------------------------------------------------------------------------------

test('seeded "Rule should change:" decisions count like editor ones: Texas and the Supreme Court make a group of two, which is an owner-ruling lesson', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  const r = await distill(w, ['--run-id', 'd1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const [lesson] = lessonsOf(w, 'd1');
  assert.equal(lesson.tag, 'Predictive');
  assert.equal(lesson.owner_ruling_route, true);
  assert.deepEqual(lesson.supporting_keys, [rowKey(w, '6aa014be'), rowKey(w, 'f376c2cc')]);
  const input = r.fakeState.log[0].input;
  assert.equal(input.rows.length, 2);
  assert.ok(input.rows.every((x) => !x.reasoning.startsWith('Rule should change:')), 'the prefix is not part of the reasoning');
  assert.ok(input.other_rows.length > 0 && input.other_rows.length <= 12);
  assert.ok(input.other_rows.every((o) => o.why_wrong === null), 'the other seeded rows say nothing about the rule');
  // add the editors' own rows: the group is three then and needs no ruling
  w.decide(rowKey(w, '6e820a8a'), { outcome: 'Does not apply', why: 'Rule should change', reasoning: 'A likely outcome is a tendency.' });
  await w.pull('p2');
  const again = await distill(w, ['--run-id', 'd2']);
  const [three] = lessonsOf(w, 'd2');
  assert.equal(three.supporting_keys.length, 3);
  assert.equal(three.owner_ruling_route, false);
  assert.equal(again.fakeState.log[0].input.rows.length, 3);
});

test('--demo-bad-lesson: no model; the lesson is read from the file, current_text from the rubric; planted and labelled', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  const file = join(w.root, 'evals', 'seed', 'demo-bad-lesson.json');
  const r = await distill(w, ['--demo-bad-lesson', file, '--run-id', 'dm1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(r.fakeState.log.length, 0, 'the model was not called');
  assert.match(r.out[0], /^distill: run dm1: 1 lesson\(s\) proposed \("Gate test \(deliberately bad\): only pronouns make a claim Context-dependent"\); 0 model call\(s\), \$0\.0000; plan /);
  const [lesson] = lessonsOf(w, 'dm1');
  const ctx = rubric.tags.find((t) => t.name === 'Context-dependent');
  assert.equal(lesson.lesson_key, 'Gate test (deliberately bad): only pronouns make a claim Context-dependent');
  assert.equal(lesson.demo, true);
  assert.equal(lesson.tag, 'Context-dependent');
  assert.equal(lesson.rule_label, 'Context-dependent rule 2');
  assert.equal(lesson.kind, 'Change the rule');
  assert.equal(lesson.current_text, `2. ${ctx.when_to_use.rules[1].text}`);
  assert.equal(lesson.proposed_text, 'Only a pronoun without an antecedent inside the claim makes it Context-dependent; a definite description never does if the sentence reads well on its own.');
  assert.deepEqual(lesson.supporting_keys, ['78dd775028795b65bb5c4945eda1c3bb::Context-dependent', '8f9c833b41e54eee9ca78e9c2f4ffb58::Context-dependent']);
  assert.match(lesson.note, /planted test.*expected to FAIL/i);
  assert.equal(lesson.status, 'Proposed');
  assert.deepEqual(validate(lessonSchema, lesson).errors, []);

  const create = opsOf(w, 'dm1').find((o) => o.database === 'rule_changes');
  assert.equal(create.properties.Status, 'Proposed');
  assert.match(create.content_md, /## Notes\n- PLANTED TEST, NOT A REAL LESSON: A planted test, not a real lesson, and expected to FAIL the gate\./);
  assert.match(create.content_md, /Georgia's gubernatorial debate/);
  assert.match(create.note, /planted test lesson/);
  const runsOp = opsOf(w, 'dm1').find((o) => o.database === 'runs');
  assert.equal(runsOp.properties.Model, 'demo lesson (no model)');
  assert.equal(planCheck({ root: w.root, runId: 'dm1', now: w.clock.now }).code, EXIT.OK);
  const cap = captureIo();
  assert.equal(await applyMain(['--run', 'dm1'], cap.io, w.env()), EXIT.OK, cap.err.join('\n'));

  // a second time the lesson is already in Notion
  await w.pull('p2');
  const again = await distill(w, ['--demo-bad-lesson', file, '--run-id', 'dm2']);
  assert.equal(again.code, EXIT.OK);
  assert.match(again.out[0], /already in Notion \(Proposed\)/);
  assert.equal(existsSync(runDir(w, 'dm2')), false);
});

test('the demo lesson file: the labelled bad lesson on Context-dependent rule 2, quoting the rule text it rewrites', () => {
  const d = readJson(join(AGENT, 'evals', 'seed', 'demo-bad-lesson.json'));
  assert.equal(d.demo, true);
  assert.equal(d.title, 'Gate test (deliberately bad): only pronouns make a claim Context-dependent');
  assert.equal(d.tag, 'Context-dependent');
  assert.equal(d.kind, 'Change the rule');
  assert.equal(d.rule_n, 2);
  assert.equal(d.proposed_text, 'Only a pronoun without an antecedent inside the claim makes it Context-dependent; a definite description never does if the sentence reads well on its own.');
  assert.equal(d.target_rule_text_at_authoring, rubric.tags.find((t) => t.name === 'Context-dependent').when_to_use.rules[1].text, 'the file quotes the live rule it targets');
  assert.deepEqual(d.supporting_keys, ['8f9c833b41e54eee9ca78e9c2f4ffb58::Context-dependent', '78dd775028795b65bb5c4945eda1c3bb::Context-dependent']);
  const seed = readJsonl(join(AGENT, 'evals', 'seed', 'decisions.seed.jsonl')).rows;
  for (const key of d.supporting_keys) {
    const row = seed.find((s) => s.key === key);
    assert.ok(row, key);
    assert.equal(row.seeded_outcome, 'Does not apply');
  }
  assert.match(seed.find((s) => s.key === d.supporting_keys[0]).claim, /^Georgia/);
  assert.match(seed.find((s) => s.key === d.supporting_keys[1]).claim, /COVID-19/);
  assert.match(d.note, /planted test/i);
  assert.match(d.note, /FAIL/);
});

test('--demo-bad-lesson refuses a bad file: missing field, unknown kind, no such rule, rows that are not decided, no file', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  const good = readJson(join(w.root, 'evals', 'seed', 'demo-bad-lesson.json'));
  const write = (name, obj) => {
    const file = join(w.root, `${name}.json`);
    writeFileSync(file, JSON.stringify(obj));
    return file;
  };
  const cases = [
    ['no-title', { ...good, title: undefined }, /"title" is missing/],
    ['bad-kind', { ...good, kind: 'Rewrite everything' }, /kind "Rewrite everything" is not one of/],
    ['bad-rule', { ...good, rule_n: 40 }, /has no Context-dependent rule 40/],
    ['no-rows', { ...good, supporting_keys: [] }, /supporting_keys must name queue rows/],
    ['open-row', { ...good, supporting_keys: [`${rowKey(w, '01c0d1ae')}`] }, /are not decided rows of pull p1/],
  ];
  for (const [name, obj, pattern] of cases) {
    const r = await distill(w, ['--demo-bad-lesson', write(name, obj), '--run-id', `d-${name}`]);
    assert.equal(r.code, EXIT.INVALID, name);
    assert.match(r.err.join('\n'), pattern, name);
    assert.equal(existsSync(runDir(w, `d-${name}`)), false);
  }
  const missing = await distill(w, ['--demo-bad-lesson', join(w.root, 'nope.json'), '--run-id', 'd-x']);
  assert.equal(missing.code, EXIT.INVALID);
  assert.match(missing.err.join('\n'), /does not exist/);
});

// ---- plan A, then --link (plan B) --------------------------------------------------------------------------------------------------------------------------

test('plan A creates the lessons; after apply and pull, --link builds plan B that links the rows and marks their cases contested', async () => {
  const w = makeLoopWorld();
  w.decide(rowKey(w, '6e820a8a'), { outcome: 'Does not apply', why: 'Rule should change', reasoning: 'A likely outcome is a tendency.' });
  w.decide(rowKey(w, '8172f325'), { outcome: 'Does not apply', why: 'Rule should change', reasoning: 'A temporary phase is a hedge.' });
  await w.pull('p1');
  const cs = captureIo();
  assert.equal(await casesMain(['--run-id', 'cs1'], cs.io, w.env()), EXIT.OK);
  assert.equal(casesOf(w).filter((c) => c.active).length, 27, 'the two seeded hedges are active, the two editor hedges contested');

  const r = await distill(w, ['--run-id', 'd1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /; next: node agents\/claim-tagger\/scripts\/plan\.mjs check --run d1; apply\.mjs --run d1; pull\.mjs --dbs tag_decisions,rule_changes; distill\.mjs --link --run d1/);
  const [lesson] = lessonsOf(w, 'd1');
  assert.equal(lesson.supporting_keys.length, 4);
  const links = readJsonl(join(runDir(w, 'd1'), 'plan-link.jsonl')).rows;
  assert.deepEqual(links, [{ op: 'link', lesson_key: lesson.lesson_key, relation: 'Lesson', row_keys: lesson.supporting_keys }]);

  // --link before plan A is applied: the lesson is not in Notion
  let l = await distill(w, ['--link', '--run', 'd1']);
  assert.equal(l.code, EXIT.INVALID);
  assert.match(l.err.join('\n'), /1 lesson\(s\) are not in Notion yet/);
  assert.equal(planCheck({ root: w.root, runId: 'd1', now: w.clock.now }).code, EXIT.OK);
  const cap = captureIo();
  assert.equal(await applyMain(['--run', 'd1'], cap.io, w.env()), EXIT.OK, cap.err.join('\n'));
  assert.equal(w.fake.find('rule_changes', lesson.lesson_key).props.Status, 'Proposed');
  assert.equal(w.fake.find('rule_changes', lesson.lesson_key).props['Lesson ID'], 'LS-1');
  assert.match(w.fake.find('runs', 'Distill 2026-10-13').props.Summary, /1 lesson\(s\) proposed/);

  // the pull after plan A knows the lesson but holds no Tag decisions: --link says what to pull
  await w.pull('p2', ['rule_changes', 'runs']);
  l = await distill(w, ['--link', '--run', 'd1']);
  assert.equal(l.code, EXIT.INVALID);
  assert.match(l.err.join('\n'), /does not include tag_decisions: run pull\.mjs --dbs tag_decisions,rule_changes first/);

  await w.pull('p3');
  l = await distill(w, ['--link', '--run', 'd1']);
  assert.equal(l.code, EXIT.OK, l.err.join('\n'));
  assert.match(l.out[0], /^distill --link: run d1: 4 row\(s\) to link in plan d1-link; cases\.jsonl: 4 contested case\(s\) \(file updated\), 4 of them for these lessons; next: node agents\/claim-tagger\/scripts\/plan\.mjs check --run d1-link; apply\.mjs --run d1-link; then cases-sync\.mjs sets In regression suite/);
  const planB = readPlan(w.root, 'd1-link');
  assert.equal(planB.ops.length, 4);
  for (const op of planB.ops) {
    assert.equal(op.database, 'tag_decisions');
    assert.deepEqual(Object.keys(op.properties), ['Lesson']);
    assert.deepEqual(op.properties.Lesson, [w.fake.find('rule_changes', lesson.lesson_key).page_id]);
  }
  assert.deepEqual(planB.ops.map((o) => o.key).sort(), lesson.supporting_keys);
  const contested = casesOf(w).filter((c) => c.contested);
  assert.equal(contested.length, 4);
  assert.ok(contested.every((c) => c.contested_lesson === lesson.lesson_key && c.active === false));
  assert.deepEqual(contested.map((c) => c.key).sort(), lesson.supporting_keys);

  // plan B lands, and the regular sync reaches the same state without changing the file
  assert.equal(planCheck({ root: w.root, runId: 'd1-link', now: w.clock.now }).code, EXIT.OK);
  assert.equal(await applyMain(['--run', 'd1-link'], captureIo().io, w.env()), EXIT.OK);
  await w.pull('p4');
  const before = readFileSync(join(w.root, 'evals', 'cases.jsonl'), 'utf8');
  const sync = await new Promise((resolve) => {
    const c = captureIo();
    casesMain(['--run-id', 'cs2'], c.io, w.env()).then((code) => resolve({ code, out: c.out }));
  });
  assert.equal(sync.code, EXIT.OK);
  assert.match(sync.out[0], /cases\.jsonl unchanged/);
  assert.equal(readFileSync(join(w.root, 'evals', 'cases.jsonl'), 'utf8'), before);

  // and --link again finds everything linked
  l = await distill(w, ['--link', '--run', 'd1', '--run-id', 'again']);
  assert.equal(l.code, EXIT.OK);
  assert.match(l.out[0], /0 row\(s\) to link in plan \(none: all linked already\), 4 already linked/);
  assert.equal(existsSync(runDir(w, 'again')), false);
});

test('--link without the files of a distill run is invalid', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  const r = await distill(w, ['--link', '--run', 'never-ran']);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /has no lessons\.jsonl and plan-link\.jsonl/);
});

// ---- guards, arguments ----------------------------------------------------------------------------------------------------------------------------------

test('distill stops when the agent is paused, the rubric drifted or a promote is in flight', async () => {
  const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule should change', 3) });
  await w.pull('p1');
  writeFileSync(join(w.root, 'runs', 'PROMOTING.json'), JSON.stringify({ run_id: 'pr1' }));
  let r = await distill(w, ['--run-id', 'd1']);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /PROMOTING: run pr1 is waiting/);
  writeFileSync(join(w.root, 'rubric', 'rubric.lock'), '{}');
  r = await distill(w, ['--run-id', 'd1']);
  assert.equal(r.code, EXIT.DRIFT);
  writeFileSync(join(w.root, 'runs', 'PAUSED'), '{}');
  r = await distill(w, ['--run-id', 'd1']);
  assert.equal(r.code, EXIT.PAUSED);
  assert.equal(r.fakeState.log.length, 0, 'no model call was made');
});

test('distill needs a pull with Tag decisions and Rule changes, and says when there is nothing to propose', async () => {
  const w = makeMiniWorld({ rows: [{ id: 'q1', claim: 'Nothing wrong here', tag: 'Debate', outcome: 'Applies', why: 'Agent slip', reasoning: 'x' }] });
  let r = await distill(w);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /there is no pull yet/);
  await w.pull('p0', ['rulebook', 'claims']);
  r = await distill(w);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /does not include tag_decisions/);
  await w.pull('p1');
  r = await distill(w);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out[0], /^distill: nothing to propose: no decided row says the rule is the problem \(1 decided row\(s\) read from pull p1\)$/);
  assert.equal(readdirSync(join(w.root, 'runs')).filter((n) => n !== 'pull').length, 0, 'nothing was written under runs/');
});

test('rows whose claim text is unknown are left out and reported', async () => {
  const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule should change', 3) });
  await w.pull('p1', ['tag_decisions', 'rule_changes', 'rulebook']);
  const r = await distill(w, ['--run-id', 'd1']);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out[0], /nothing to propose: no decided row says the rule is the problem|nothing to propose/);
  assert.match(r.err.join('\n'), /no claim text for .*::Predictive: pull the Claims too; the row was left out/);
});

test('arguments are checked', async () => {
  const w = makeLoopWorld({ seed: false });
  for (const argv of [['--bogus'], ['stray'], ['--driver', 'subagent'], ['--link'], ['--run', 'x'], ['--link', '--run', 'x', '--demo-bad-lesson', 'f'], ['--run-id', 'a:b'], ['--pull']]) {
    const c = captureIo();
    const code = await main(argv, c.io, { root: w.root });
    assert.equal(code, EXIT.INVALID, JSON.stringify(argv));
    assert.match(c.err.join('\n'), /usage: node agents\/claim-tagger\/scripts\/distill\.mjs/, JSON.stringify(argv));
  }
  const c = captureIo();
  assert.equal(await main(['--help'], c.io, { root: w.root }), EXIT.OK);
  assert.match(c.out[0], /--demo-bad-lesson <path>/);
});
