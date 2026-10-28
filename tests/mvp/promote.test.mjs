import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { candidateTextOf, evaluate, main, promote } from '../../agents/claim-tagger-mvp/scripts/promote.mjs';
import { runClaude } from '../../agents/claim-tagger-mvp/scripts/lib/claude.mjs';
import { readJson, readJsonl } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { stampOf } from '../../agents/claim-tagger-mvp/scripts/lib/editor-words.mjs';
import { validate } from '../../agents/claim-tagger-mvp/scripts/lib/validate.mjs';
import { codeRoot } from '../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';
import { NOW, claimText, taxonomyCanaries } from './helpers/loop-world.mjs';
import { MARK, NEW_TEXT, RULE4, TITLE, callsHolding, keyOf, promoteWorld, readingCells } from './helpers/promote-scenario.mjs';

const cardSchema = readJson(join(codeRoot(), 'schemas', 'card.schema.json'));
const EXAMPLE_1 = taxonomyCanaries()[0].claim; // an example that applies

function assertReport(h, r) {
  assert.ok(r.markdown, 'a report was written');
  assert.deepEqual(lintReport(r.markdown), [], r.markdown);
  assert.equal(h.io.outs.join('\n').trimEnd(), r.markdown.trimEnd(), 'the script prints the report and nothing else on stdout');
  assert.ok(!/\bcalls?\b|token|duration|\$|\.mjs|--[a-z]|runs\//i.test(r.markdown), r.markdown);
  if ('extra' in r.report) assert.equal(r.exit, 11, 'only the FAIL of promote (exit 11) has the suggestion part; no other report has it');
  return r.report;
}
const lockFile = (w) => join(w.root, 'runs', 'PROMOTING.json');
const forbidden = ['Tag outcome', 'Why wrong', 'Your reasoning', 'Editor wording', 'Paused'];
const storeDirs = (w) => {
  const base = join(w.root, 'runs', 'judgments');
  return readdirSync(base).filter((d) => /^[0-9a-f]{16}$/.test(d)).map((d) => join(base, d));
};
const flipExample = { [EXAMPLE_1]: { decision: 'do_not_apply', p: 0.1 } };
const SENTENCE = 'A reference to one particular thing that the claim does not name, such as a title alone, still fails the test.'; // the fake wording call's stock reply
const WHY = 'The claim points at one particular thing without saying which. The new wording let that go; the added sentence keeps it under the rule.'; // and its stock reason
/** The suggestion of a FAIL report as it must read: the sentence, the reason, and the rule to copy (`lines`: the tested rule one sentence per line, then the sentence). */
const suggestion = (label, sentence, why, lines) => [
  `Suggested sentence for ${label}:`, `> ${sentence}`, '', `Why: ${why}`, '', `${label[0].toUpperCase()}${label.slice(1)} with the sentence, to copy into Editor wording:`, '```', ...lines, '```',
].join('\n');
const renderedTable = (rows) => ['| Check | Result |', '|---|---|', ...rows.map((row) => `| ${row[0]} | ${row[1]} |`)].join('\n');
const nextAfterFail = (w, label = 'rule 4', command = '/claim-tagger promote') => `Next: in Lessons waiting (${lessonsLink(w)}), paste the block above into Editor wording in place of what is there, or write all of ${label} as you want it; then type ${command} again.`;
const wordingCalls = (w) => w.calls().filter((c) => /prompts[\\/]wording\.md$/.test(c.systemPromptFile));
const lessonsLink = (w) => `https://www.notion.so/${w.DB.rule_changes}?v=e3000000000000000000000000000003`;
const young = (w, body) => {
  mkdirSync(join(w.root, 'runs'), { recursive: true });
  writeFileSync(lockFile(w), `${JSON.stringify(body)}\n`);
};

// ---- the verdict over the answers ------------------------------------------------------------------------------------------------------

const ans = (pairs) => new Map(Object.entries(pairs).map(([id, decision]) => [id, { decision }]));
const item = (id, expected, extra = {}) => ({ id, claim: `claim ${id}`, expected, ...extra });

test('evaluate: PASS when every example is right, no earlier decision that was right broke, and every supporting row is right', () => {
  const r = evaluate({
    canaries: [item('canary-1', 'apply'), item('canary-2', 'do_not_apply')],
    earlier: [item('case-a', 'apply', { key: 'a::T' }), item('case-b', 'do_not_apply', { key: 'b::T' })],
    yours: [item('case-y', 'do_not_apply', { key: 'y::T' })],
    base: ans({ 'canary-1': 'apply', 'canary-2': 'do_not_apply', 'case-a': 'apply', 'case-b': 'apply', 'case-y': 'ask_editor' }),
    cand: ans({ 'canary-1': 'apply', 'canary-2': 'do_not_apply', 'case-a': 'apply', 'case-b': 'apply', 'case-y': 'do_not_apply' }),
  });
  assert.equal(r.verdict, 'PASS');
  assert.deepEqual([r.checks.canaries.passed, r.checks.canaries.total, r.checks.cases.passed, r.checks.cases.total, r.checks.supporting.passed, r.checks.supporting.total], [2, 2, 1, 1, 1, 1],
    'case-b was wrong before and is wrong now: it is not an earlier decision that could break, so it is not counted');
  assert.equal(r.first, null);
});

test('evaluate: FAIL names the first failure: an example first, then an earlier decision that broke, then a row of the lesson', () => {
  const base = ans({ e1: 'apply', c1: 'apply', y1: 'ask_editor' });
  const cand = ans({ e1: 'do_not_apply', c1: 'do_not_apply', y1: 'ask_editor' });
  const canaries = [item('e1', 'apply')];
  const earlier = [item('c1', 'apply', { key: 'k1::T' })];
  const yours = [item('y1', 'do_not_apply', { key: 'k2::T' })];
  const all = evaluate({ canaries, earlier, yours, base, cand });
  assert.equal(all.verdict, 'FAIL');
  assert.deepEqual([all.first.id, all.first.got, all.first.was], ['e1', 'do_not_apply', 'apply']);
  assert.deepEqual([all.checks.canaries.failures.length, all.checks.cases.newly_failing.length, all.checks.supporting.failures.length], [1, 1, 1]);
  const noExample = evaluate({ canaries: [], earlier, yours, base, cand });
  assert.equal(noExample.first.id, 'k1::T', 'the key of the row names an earlier decision');
  const onlyYours = evaluate({ canaries: [], earlier: [], yours, base, cand });
  assert.deepEqual([onlyYours.first.id, onlyYours.first.got, onlyYours.checks.supporting.passed], ['k2::T', 'ask_editor', 0]);
  assert.equal(evaluate({ canaries: [item('e', 'apply')], earlier: [], yours: [], base: ans({ e: 'apply' }), cand: new Map() }).verdict, 'FAIL', 'an answer that is missing is wrong');
});

test('evaluate (P33): the examples are counted like the earlier decisions, the ones the rulebook in force gets right; one it gets wrong is no failure whatever the candidate says: already_wrong when the candidate gets it wrong too, fixed_by_change when it puts it right', () => {
  const canaries = [item('e1', 'apply'), item('e2', 'do_not_apply'), item('e3', 'apply'), item('e4', 'apply')];
  const base = ans({ e1: 'apply', e2: 'apply', e3: 'ask_editor', e4: 'do_not_apply' }); // e2, e3 and e4 are wrong before
  const cand = ans({ e1: 'apply', e2: 'apply', e3: 'apply', e4: 'ask_editor' }); // e2 stays wrong, e3 is put right, e4 is wrong in another way
  const r = evaluate({ canaries, earlier: [], yours: [], base, cand });
  assert.equal(r.verdict, 'PASS');
  assert.equal(r.first, null);
  assert.deepEqual(r.checks.canaries.failures, [], 'nothing was right before and wrong after');
  assert.deepEqual(r.checks.canaries.already_wrong, [
    { id: 'e2', claim: 'claim e2', expected: 'do_not_apply', got: 'apply' },
    { id: 'e4', claim: 'claim e4', expected: 'apply', got: 'ask_editor' },
  ], 'wrong under both rulebooks: exactly id, claim, expected and the candidate\'s answer');
  assert.deepEqual(r.checks.canaries.fixed_by_change, [{ id: 'e3', claim: 'claim e3', expected: 'apply', got: 'apply' }], 'wrong before, right now: listed apart');
  assert.deepEqual([r.checks.canaries.passed, r.checks.canaries.total], [1, 1], 'the count is of the examples the rulebook in force gets right, as for the earlier decisions: e1');
  const clean = evaluate({ canaries: [item('e1', 'apply')], earlier: [], yours: [], base: ans({ e1: 'apply' }), cand: ans({ e1: 'apply' }) });
  assert.deepEqual([clean.checks.canaries.already_wrong, clean.checks.canaries.fixed_by_change, clean.checks.canaries.passed, clean.checks.canaries.total], [[], [], 1, 1], 'an example that is right is in no list');
  assert.deepEqual(evaluate({ canaries: [item('e1', 'apply')], earlier: [], yours: [], base: new Map(), cand: ans({ e1: 'apply' }) }).checks.canaries.fixed_by_change.map((m) => m.id), ['e1'], 'no answer under the rulebook in force is not right');
});

test('evaluate (P33): an example that is right under the rulebook in force and wrong under the candidate is a FAIL, and `first` is never an example that was wrong before, even when it comes first', () => {
  const canaries = [item('old', 'apply'), item('new', 'do_not_apply')];
  const r = evaluate({ canaries, earlier: [], yours: [], base: ans({ old: 'do_not_apply', new: 'do_not_apply' }), cand: ans({ old: 'do_not_apply', new: 'apply' }) });
  assert.equal(r.verdict, 'FAIL');
  assert.deepEqual([r.first.id, r.first.expected, r.first.got, r.first.was], ['new', 'do_not_apply', 'apply', 'do_not_apply']);
  assert.deepEqual(r.checks.canaries.failures.map((m) => m.id), ['new']);
  assert.deepEqual(r.checks.canaries.already_wrong.map((m) => m.id), ['old']);
  assert.deepEqual([r.checks.canaries.passed, r.checks.canaries.total], [0, 1], 'one example counted: the one the rulebook in force gets right');
  // an old miss alone, with nothing broken, never blocks: the live case of 28 October (rule 3, an example that came out Applies under both rulebooks)
  const alone = evaluate({ canaries, earlier: [], yours: [], base: ans({ old: 'do_not_apply', new: 'do_not_apply' }), cand: ans({ old: 'do_not_apply', new: 'do_not_apply' }) });
  assert.equal(alone.verdict, 'PASS');
  // the earlier decisions are counted as before: only those that were right before can break, and an old miss among them is not in any list
  const earlier = [item('c1', 'apply', { key: 'k1::T' }), item('c2', 'apply', { key: 'k2::T' })];
  const both = evaluate({ canaries: [], earlier, yours: [], base: ans({ c1: 'apply', c2: 'do_not_apply' }), cand: ans({ c1: 'do_not_apply', c2: 'do_not_apply' }) });
  assert.equal(both.verdict, 'FAIL');
  assert.deepEqual([both.first.id, both.checks.cases.passed, both.checks.cases.total, both.checks.cases.newly_failing.length], ['k1::T', 0, 1, 1]);
  assert.deepEqual(both.checks.canaries.already_wrong, [], 'no examples, none listed');
});

test('candidateTextOf: the Editor wording wins when there is one, as one line without numbering', () => {
  assert.deepEqual(candidateTextOf({ 'Proposed text': ' 4. The proposed text. ', 'Editor wording': '' }), { text: 'The proposed text.', fromEditor: false });
  assert.deepEqual(candidateTextOf({ 'Proposed text': 'The proposed text.', 'Editor wording': '  Mine\nover two lines. ' }), { text: 'Mine over two lines.', fromEditor: true });
  assert.deepEqual(candidateTextOf({}), { text: '', fromEditor: false });
});

// ---- PASS ----------------------------------------------------------------------------------------------------------------------------------

test('promote PASS: the new text goes live in the Rulebook copy and in a new edition, the lesson is Live with its figures, and the follow-up marks both rows Fixed', async () => {
  const w = await promoteWorld({ open: 1 });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));

  // Notion: only rule 4 of Context-dependent changed, the lesson is Live, the settings follow
  const copy = w.row('rulebook', 'Context-dependent')['When to use'].split('\n');
  assert.equal(copy.find((l) => l.startsWith('4.')), `4. ${NEW_TEXT}`);
  assert.equal(copy.length, 5);
  assert.ok(copy.find((l) => l.startsWith('1.')).startsWith('1. A pronoun with no antecedent'), 'the other rules are as they were');
  const lesson = w.row('rule_changes', TITLE);
  assert.deepEqual([lesson.Status, lesson['Safety check result'], lesson['Editor wording']], ['Live', 'PASS: examples 11/11, earlier 2/2, yours 2/2', '']);
  const settings = w.row('agent_settings', 'Claim tagger');
  assert.equal(settings['Rulebook edition'], '2026-10-16.2');
  assert.equal(settings['Last run summary'], `Promote · ${stampOf(NOW)} · PASS`);

  // the rulebook files: a new edition, its history, its changelog line, a lock that agrees with Notion
  const rubric = readJson(join(w.root, 'rubric', 'rubric.json'));
  assert.equal(rubric.edition, '2026-10-16.2');
  assert.equal(rubric.tags.find((t) => t.name === 'Context-dependent').rules[3].text, NEW_TEXT);
  assert.equal(readJson(join(w.root, 'rubric', 'history', '2026-10-16.1.json')).tags.find((t) => t.name === 'Context-dependent').rules[3].text, RULE4, 'the earlier edition is kept');
  assert.equal(readJson(join(w.root, 'rubric', 'history', '2026-10-16.2.json')).rubric_hash, rubric.rubric_hash);
  assert.equal(readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8').trim().split('\n').at(-1), `- 2026-10-16 · edition 2026-10-16.2 · lesson ${TITLE} PASS`);
  assert.equal(readJson(join(w.root, 'rubric', 'rubric.lock')).text['Context-dependent'], w.row('rulebook', 'Context-dependent')['When to use']);
  const drift = readJson(join(w.root, 'runs', 'pull', (await w.pull()).pullId, 'drift.json'));
  assert.deepEqual([drift.judged.length, drift.adopted.length, drift.missing.length], [0, 0, 0], 'the next pull sees no drift');

  // the follow-up: both rows Fixed, nothing else on decided rows
  for (const i of [1, 2]) assert.equal(w.row('tag_decisions', keyOf(i))['Follow-up'], 'Fixed');
  for (const i of [3, 4]) assert.equal(w.row('tag_decisions', keyOf(i))['Follow-up'], null);
  assert.equal(w.claim('c01')['Agent edition'], '2026-10-16.2');
  assert.deepEqual(w.claim('c01')['Agent tags'], [], 'the editor decided Does not apply');
  assert.deepEqual([w.claim('c03')['Agent tags'], w.claim('c03')['Agent edition']], [[], ''], 'claim 3 is not part of the lesson, so its columns were not touched');

  // the report
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Promote: PASS, rule 4 now uses the new wording (edition 2026-10-16.2), and the follow-up marked both of your rows Fixed.');
  assert.deepEqual(report.rows, [['Example claims', '11 of 11 right', ''], ['Earlier decisions', '2 of 2 still right', ''], ['Your 2 rows', '2 of 2 now right, marked Fixed', '']]);
  assert.equal(report.next, `Next: decide your claim in Your queue (https://www.notion.so/${w.DB.claims}?v=e3000000000000000000000000000001).`);

  // the card
  const card = readJson(join(r.runDir, 'card.json'));
  assert.deepEqual(validate(cardSchema, card).errors, []);
  assert.deepEqual([card.verdict, card.lesson, card.tag, card.editions], ['PASS', TITLE, 'Context-dependent', { baseline: '2026-10-16.1', candidate: '2026-10-16.2' }]);
  assert.deepEqual(card.flips.map((f) => [f.id, f.from, f.to]), [[keyOf(1), 'ask_editor', 'do_not_apply'], [keyOf(2), 'ask_editor', 'do_not_apply']]);
  const md = readFileSync(join(r.runDir, 'card.md'), 'utf8');
  assert.match(md, /Verdict: PASS/);
  assert.ok(!/canar|gate/i.test(md), 'examples are called examples');

  // the lock is gone, the writes name no editor column, the follow-up has its own folder
  assert.equal(existsSync(lockFile(w)), false);
  for (const req of w.writes()) for (const col of forbidden) assert.ok(!Object.keys(req.body?.properties ?? {}).includes(col), col);
  const record = readJson(join(r.runDir, 'run.json'));
  assert.deepEqual([record.exit_code, record.rubric_edition, record.lesson, record.verdict], [0, '2026-10-16.2', TITLE, 'PASS']);
  const child = readJson(join(`${r.runDir}-followup`, 'run.json'));
  assert.deepEqual([child.script, child.exit_code], ['followup', 0]);
  const plan = readJsonl(join(r.runDir, 'plan.jsonl')).rows.slice(1);
  assert.deepEqual(plan.map((op) => op.table), ['rulebook'], 'the Rulebook copy is written first and alone, and read back before the bookkeeping');
  const bookkeeping = readJsonl(join(`${r.runDir}-record`, 'plan.jsonl')).rows.slice(1);
  assert.deepEqual(bookkeeping.map((op) => op.table), ['rule_changes', 'agent_settings'], 'then the rule change and the settings, in a run of their own');
  assert.deepEqual(readJson(join(`${r.runDir}-record`, 'run.json')).exit_code, 0);
  assert.deepEqual(plan[0].expect, { 'When to use': copy.join('\n').replace(`4. ${NEW_TEXT}`, `4. ${RULE4}`) }, 'the plan expects the text the check was made against');
});

test('promote PASS: the baseline of a check that changes no answer comes from the cache, so only the candidate side asks the model', async () => {
  const w = await promoteWorld({ base: { [claimText(1)]: { decision: 'do_not_apply', p: 0.1 }, [claimText(2)]: { decision: 'do_not_apply', p: 0.1 } } });
  assert.equal((await w.judge({ items: 'eval', tags: ['Context-dependent'] })).exit, 0, 'the baseline is judged once, as an earlier run would have done');
  const before = w.calls().length;
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const fresh = w.calls().slice(before);
  const candidateCalls = fresh.filter((c) => callsHolding(w, MARK).includes(c));
  assert.ok(candidateCalls.length > 0, 'the candidate rulebook is judged');
  assert.equal(fresh.length, candidateCalls.length, 'every call of the check was for the candidate: the baseline cost no call');
  assert.deepEqual(readJson(join(r.runDir, 'card.json')).flips, [], 'nothing changed its answer, so nothing was read again');
});

test('promote PASS: an item whose answer flips is read twice more on each side, and a chance flip that the extra reads reverse does not FAIL', async () => {
  const sure = { decision: 'apply', p: 0.9 };
  // reads of the example in order: baseline run 1, candidate run 1 (the chance flip), baseline run 2, run 3, candidate run 2, run 3
  const w = await promoteWorld({ overrides: { [EXAMPLE_1]: [sure, { decision: 'do_not_apply', p: 0.1 }, sure, sure, sure, sure] } });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const card = readJson(join(r.runDir, 'card.json'));
  assert.equal(card.verdict, 'PASS');
  assert.equal(card.rejudged, 3, 'the example and the two supporting rows flipped on the first reads');
  assert.ok(!card.flips.some((f) => f.claim === EXAMPLE_1), 'after the extra reads both sides agree on the example');
  const linesOf = (n) => storeDirs(w).flatMap((dir) => readJsonl(join(dir, `run-${n}.jsonl`)).rows).filter((l) => l.id === 'canary-1');
  assert.equal(linesOf(1).length, 2, 'one first read per side');
  assert.equal(linesOf(2).length, 2);
  assert.equal(linesOf(3).length, 2);
});

test('promote PASS: a real flip that the extra reads confirm FAILs', async () => {
  const sure = { decision: 'apply', p: 0.9 };
  const no = { decision: 'do_not_apply', p: 0.1 };
  const w = await promoteWorld({ overrides: { [EXAMPLE_1]: [sure, no, sure, sure, no, no] } }); // the candidate says no on 3 reads out of 3
  const r = await promote(w.hooks());
  assert.equal(r.exit, 11);
  assert.equal(readJson(join(r.runDir, 'card.json')).verdict, 'FAIL');
});

// ---- an example that the rulebook in force already gets wrong (P33) --------------------------------------------------------------------------

const OLD_MISS = taxonomyCanaries().find((c) => c.expected === 'do_not_apply'); // an example that must not apply
const wrongBefore = { [OLD_MISS.claim]: { decision: 'apply', p: 0.9 } }; // it comes out Applies, under the rulebook in force and under the candidate: the live case of 28 October

test('promote PASS (P33): an example that comes out wrong under both rulebooks is not counted and is shown in its own row: the live case of 28 October passes, "Example claims" counts only the ones the rulebook in force gets right, and the result says "1 more wrong before, not counted"', async () => {
  const w = await promoteWorld({ base: wrongBefore, overrides: wrongBefore, open: 1 });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  assert.deepEqual(report.rows, [
    ['Example claims', '10 of 10 right', ''],
    ['Wrong before the change', '1 more example claim, not counted', ''],
    ['Earlier decisions', '2 of 2 still right', ''],
    ['Your 2 rows', '2 of 2 now right, marked Fixed', ''],
  ], 'four rows, the most a table may have here');
  assert.ok(report.rows.length <= 5);
  assert.equal(report.sentence, 'Promote: PASS, rule 4 now uses the new wording (edition 2026-10-16.2), and the follow-up marked both of your rows Fixed.');
  assert.equal(w.row('rule_changes', TITLE).Status, 'Live');
  assert.equal(w.row('rule_changes', TITLE)['Safety check result'], 'PASS: examples 10/10 (1 more wrong before, not counted), earlier 2/2, yours 2/2');
  assert.equal(w.row('agent_settings', 'Claim tagger')['Rulebook edition'], '2026-10-16.2');

  const card = readJson(join(r.runDir, 'card.json'));
  assert.deepEqual(validate(cardSchema, card).errors, []);
  assert.equal(card.verdict, 'PASS');
  assert.deepEqual([card.checks.canaries.passed, card.checks.canaries.total], [10, 10]);
  assert.deepEqual(card.checks.canaries.failures, []);
  assert.deepEqual(card.checks.canaries.fixed_by_change, []);
  assert.deepEqual(card.checks.canaries.already_wrong, [{ id: OLD_MISS.id, claim: OLD_MISS.claim, expected: 'do_not_apply', got: 'apply' }]);
  assert.equal(card.rejudged, 3, 'the two supporting rows flipped and the example that was wrong under both was read again');
  const md = readFileSync(join(r.runDir, 'card.md'), 'utf8');
  assert.match(md, /Example claims that are wrong under both rulebooks \(not counted; the engineer may recalibrate evals\/canaries\.jsonl\):/);
  assert.ok(md.includes(`- "${OLD_MISS.claim.slice(0, 40)}`) && md.includes('expected Does not apply, with the new text Applies'), md);
  const linesOf = (n) => storeDirs(w).flatMap((dir) => readJsonl(join(dir, `run-${n}.jsonl`)).rows).filter((l) => l.id === OLD_MISS.id);
  assert.deepEqual([linesOf(1).length, linesOf(2).length, linesOf(3).length], [2, 2, 2], 'read again on both sides, as a flipped item is');
});

test('promote (P33): the row counts the examples ("2 more example claims"), and it is in the table of a FAIL as well, where a real break is still named first', async () => {
  const second = taxonomyCanaries().filter((c) => c.expected === 'do_not_apply')[1];
  const two = { ...wrongBefore, [second.claim]: { decision: 'apply', p: 0.9 } };
  const pass = await promoteWorld({ base: two, overrides: two });
  const ok = await promote(pass.hooks());
  assert.equal(ok.exit, 0);
  assert.deepEqual(ok.report.rows.slice(0, 2), [['Example claims', '9 of 9 right', ''], ['Wrong before the change', '2 more example claims, not counted', '']]);
  assert.equal(pass.row('rule_changes', TITLE)['Safety check result'], 'PASS: examples 9/9 (2 more wrong before, not counted), earlier 2/2, yours 2/2');

  const w = await promoteWorld({ base: wrongBefore, overrides: { ...wrongBefore, ...flipExample } }); // one old miss, and one example that the change breaks
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  assert.deepEqual(report.rows, [
    ['Example claims', '9 of 10 right', ''],
    ['Wrong before the change', '1 more example claim, not counted', ''],
    ['Earlier decisions', '2 of 2 still right', ''],
    ['Your 2 rows', '2 of 2 now right', ''],
  ]);
  const cut = EXAMPLE_1.length > 60 ? `${EXAMPLE_1.slice(0, 57)}...` : EXAMPLE_1;
  assert.equal(report.sentence, `Promote: FAIL, rule 4 is unchanged: the new wording turns "${cut}" to Does not apply; the right answer is Applies.`, 'the claim named is the one the change broke, not the old miss');
  assert.equal(w.row('rule_changes', TITLE)['Safety check result'], `FAIL: '${cut}' now Does not apply`);
  assert.ok(wordingCalls(w)[0].stdin.includes(`<claim answer="Applies">${EXAMPLE_1}</claim>`), 'the suggestion is asked for the broken example');
  assert.ok(!wordingCalls(w).some((c) => c.stdin.includes(OLD_MISS.claim)), 'never for an example that was wrong before');
  const card = readJson(join(r.runDir, 'card.json'));
  assert.deepEqual(validate(cardSchema, card).errors, []);
  assert.deepEqual([card.checks.canaries.failures.map((m) => m.id), card.checks.canaries.already_wrong.map((m) => m.id)], [['canary-1'], [OLD_MISS.id]]);
  assert.match(readFileSync(join(r.runDir, 'card.md'), 'utf8'), /wrong under both rulebooks/);
});

test('promote (P33): an example wrong under both rulebooks on the first read is read again on both sides, and the re-reading decides: right under the rulebook in force after all, it is a real break and FAILs', async () => {
  const yes = { decision: 'apply', p: 0.9 };
  const no = { decision: 'do_not_apply', p: 0.1 };
  // the reads of the example in order (one counter for the claim, whichever rulebook asks): baseline run 1, candidate run 1, then the extra reads: baseline runs 2 and 3, candidate runs 2 and 3.
  // It must apply. The first reads are both No (wrong under both); the extra reads say Yes under the rulebook in force and No under the candidate.
  const w = await promoteWorld({ base: { [EXAMPLE_1]: [no, no, yes, yes, yes, yes] }, overrides: { [EXAMPLE_1]: [no, no, no, no, no, no] } });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11, h.io.errs.join('\n'));
  const card = readJson(join(r.runDir, 'card.json'));
  assert.equal(card.verdict, 'FAIL');
  assert.deepEqual(card.checks.canaries.failures.map((m) => [m.id, m.expected, m.got]), [['canary-1', 'apply', 'do_not_apply']], 'a real break, found by the re-reading');
  assert.deepEqual(card.checks.canaries.already_wrong, []);
  assert.equal(card.rejudged, 3, 'the example that was wrong under both counts with the two rows that flipped');
  assert.deepEqual(card.flips.filter((f) => f.claim === EXAMPLE_1).map((f) => [f.from, f.to]), [['apply', 'do_not_apply']]);
  assert.equal(assertReport(h, r).rows[0][1], '10 of 11 right', 'after the re-reading the example is one the rulebook in force gets right: it is counted, and it is the one that failed');
});

test('promote (P33, C2): an example the rulebook in force gets wrong and the change puts right is not counted and not in the row; the card lists it as fixed by the change, and the result line is as it always was', async () => {
  const yes = { decision: 'apply', p: 0.9 };
  const no = { decision: 'do_not_apply', p: 0.1 };
  // wrong under both on the first reads; the extra reads say No under the rulebook in force (an old miss) and Yes under the candidate (the change puts it right)
  const w = await promoteWorld({ base: { [EXAMPLE_1]: [no, no, no, no, yes, yes] }, overrides: { [EXAMPLE_1]: [no, no, yes, yes, yes, yes] } });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(w.row('rule_changes', TITLE)['Safety check result'], 'PASS: examples 10/10, earlier 2/2, yours 2/2', 'no example is wrong under both, so the line has nothing more to say');
  const card = readJson(join(r.runDir, 'card.json'));
  assert.deepEqual(validate(cardSchema, card).errors, []);
  assert.deepEqual([card.checks.canaries.already_wrong, card.checks.canaries.fixed_by_change], [[], [{ id: 'canary-1', claim: EXAMPLE_1, expected: 'apply', got: 'apply' }]]);
  assert.deepEqual([card.checks.canaries.passed, card.checks.canaries.total], [10, 10]);
  assert.deepEqual(assertReport(h, r).rows.slice(0, 2), [['Example claims', '10 of 10 right', ''], ['Earlier decisions', '2 of 2 still right', '']], 'no "Wrong before the change" row');
  assert.match(readFileSync(join(r.runDir, 'card.md'), 'utf8'), /Example claims that were wrong under the rulebook in force and are fixed by the change \(not counted\):\n- "/);
});

test('promote (P33, C4): an earlier decision that comes out wrong under both rulebooks on the first read is read again on both sides like an example, and the re-reading decides', async () => {
  const yes = { decision: 'apply', p: 0.9 };
  const no = { decision: 'do_not_apply', p: 0.1 };
  // claim 3 was decided Applies. First reads: baseline No, candidate No (wrong under both); extra reads: Yes under the rulebook in force, No under the candidate. A real break that one unlucky read hid.
  const w = await promoteWorld({ base: { [claimText(3)]: [no, no, yes, yes, yes, yes] }, overrides: { [claimText(3)]: [no, no, no, no, no, no] } });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11, h.io.errs.join('\n'));
  const card = readJson(join(r.runDir, 'card.json'));
  assert.deepEqual(card.checks.cases.newly_failing.map((m) => [m.claim, m.expected, m.got]), [[claimText(3), 'apply', 'do_not_apply']]);
  assert.deepEqual([card.checks.cases.passed, card.checks.cases.total], [1, 2]);
  assert.equal(card.rejudged, 3, 'the two rows that flipped and the earlier decision that was wrong under both');
  assert.equal(assertReport(h, r).rows[1][1], '1 of 2 still right');
  // and the other way: wrong under both after the extra reads too, it is an old miss and blocks nothing
  const old = await promoteWorld({ base: { [claimText(3)]: no }, overrides: { [claimText(3)]: no } });
  const ro = await promote(old.hooks());
  assert.equal(ro.exit, 0);
  assert.deepEqual(ro.report.rows[1], ['Earlier decisions', '1 of 1 still right', '']);
  assert.equal(readJson(join(ro.runDir, 'card.json')).rejudged, 3, 'it was read again before it was called an old miss');
});

test('promote (P33, C4): the rows the change rests on are not read again for being wrong under both: only a flip is', async () => {
  // row 2 comes out Can\'t tell under both rulebooks and is decided Does not apply: wrong under both, the same answer on both sides, not a flip
  const stuck = { decision: 'ask_editor', p: 0.5, rule_ref: null };
  const w = await promoteWorld({ base: { [claimText(2)]: stuck }, overrides: { [claimText(2)]: stuck } });
  const r = await promote(w.hooks());
  assert.equal(r.exit, 11);
  assert.equal(readJson(join(r.runDir, 'card.json')).rejudged, 1, 'only row 1 flipped');
});

test('promote (P33): an example that is wrong under both rulebooks but with different answers is a flip and is read again once, not twice', async () => {
  // baseline says Can\'t tell and the candidate says Does not apply to an example that must apply: wrong under both, and the two answers differ
  const w = await promoteWorld({ base: { [EXAMPLE_1]: { decision: 'ask_editor', p: 0.5, rule_ref: null } }, overrides: flipExample });
  const r = await promote(w.hooks());
  assert.equal(r.exit, 0);
  const card = readJson(join(r.runDir, 'card.json'));
  assert.equal(card.rejudged, 3, 'two rows and the example, each once');
  assert.deepEqual(card.checks.canaries.already_wrong.map((m) => [m.id, m.got]), [['canary-1', 'do_not_apply']]);
  const reads = (n) => storeDirs(w).flatMap((dir) => readJsonl(join(dir, `run-${n}.jsonl`)).rows).filter((l) => l.id === 'canary-1');
  assert.deepEqual([reads(1).length, reads(2).length, reads(3).length], [2, 2, 2], 'two reads of each run, one per side: not read again for being both a flip and wrong under both');
});

// The extra reads that settle a flipped answer (lib/answers.mjs forceRuns) are the safety check's own. When the model leaves a claim out of the reply twice, the batch's items get error
// lines in run 3 of the candidate's store, and the check stops with "type promote again; it continues where it stopped". That has to be true: the judge that the next promote runs first
// must not count those lines (its own plan asked for no third read of them), so that the check reaches the extra reads again and makes them.
const LEFT_OUT = 'drop'; // a table entry of the fake CLI: the claim is left out of the reply
const run3Rows = (dir) => (existsSync(join(dir, 'run-3.jsonl')) ? readJsonl(join(dir, 'run-3.jsonl')).rows : []);
const storeWithErrors = (w) => storeDirs(w).find((dir) => run3Rows(dir).some((l) => l.status === 'error')); // the candidate's store: the live one had its extra reads
const extraReadWords = /2 extra read\(s\) could not be used/;

test('promote: an extra read that comes back without a claim twice stops the check with exit 2 and nothing written; the next promote makes only that read again and passes', async () => {
  const no = { decision: 'do_not_apply', p: 0.1 };
  // reads of claim 1 in order: baseline run 1, run 2 (it is unsure), candidate run 1 (sure), baseline run 3 (extra), candidate run 2 (extra), run 3 twice (left out), then the next promote's run 3
  const w = await promoteWorld({ overrides: { [claimText(1)]: [no, no, no, no, no, LEFT_OUT, LEFT_OUT, no] } });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 2, 'the candidate\'s third read of the two flipped rows could not be used');
  assert.match(h.io.errs.join('\n'), extraReadWords);
  assert.equal(r.report.sentence, 'Promote stopped: some answers could not be read again, so the check could not be finished; nothing was written to Notion.');
  assert.equal(r.report.next, 'Next: type /claim-tagger promote again; it continues where it stopped.');
  assert.deepEqual(lintReport(r.markdown), []);
  assert.deepEqual(w.writes(), [], 'nothing was written to Notion');
  assert.equal(w.row('rule_changes', TITLE).Status, 'Approved');
  const store = storeWithErrors(w);
  assert.ok(store, 'the candidate\'s store holds error lines in run 3');
  const failed = run3Rows(store);
  assert.deepEqual(failed.map((l) => [l.id, l.status]), [[`case-${keyOf(1)}`, 'error'], [`case-${keyOf(2)}`, 'error']], 'both rows of the batch got an error line in run 3 of the candidate');
  assert.match(failed[0].error, /is missing from the reply/);
  assert.equal(existsSync(lockFile(w)), false);

  // the same command again, the fake answering: the judge no longer stops on those lines, and only the missing read is asked for
  const before = w.calls().length;
  const h2 = w.hooks();
  const again = await promote(h2);
  assert.equal(again.exit, 0, h2.io.errs.join('\n'));
  assert.equal(again.report.sentence, 'Promote: PASS, rule 4 now uses the new wording (edition 2026-10-16.2), and the follow-up marked both of your rows Fixed.');
  const fresh = w.calls().slice(before);
  assert.deepEqual(fresh.map((c) => c.ids), [[`case-${keyOf(1)}`, `case-${keyOf(2)}`]], 'one call: the third read of the two rows, nothing else was judged again');
  assert.ok(callsHolding(w, MARK).includes(fresh[0]), 'and it was for the candidate');
  assert.deepEqual(run3Rows(store).map((l) => l.status), ['error', 'error', 'ok', 'ok'], 'the retry is a new line after the error: the last one wins');
  assert.deepEqual(readJson(join(again.runDir, 'card.json')).flips.map((f) => [f.id, f.from, f.to]), [[keyOf(1), 'ask_editor', 'do_not_apply'], [keyOf(2), 'ask_editor', 'do_not_apply']]);
  assert.equal(w.row('rule_changes', TITLE).Status, 'Live');
});

test('promote: an extra read that fails again stops at the extra read once more, not in the judge; the third promote passes', async () => {
  const no = { decision: 'do_not_apply', p: 0.1 };
  const w = await promoteWorld({ overrides: { [claimText(1)]: [no, no, no, no, no, LEFT_OUT, LEFT_OUT, LEFT_OUT, LEFT_OUT, no] } });
  const first = await promote(w.hooks());
  assert.equal(first.exit, 2);
  const before = w.calls().length;
  const h = w.hooks();
  const second = await promote(h);
  assert.equal(second.exit, 2, 'the model left the claim out again');
  assert.match(h.io.errs.join('\n'), extraReadWords, 'it stopped at the extra read it retried, not at the judge before it');
  assert.ok(!/could not be read again \(error lines/.test(h.io.errs.join('\n')), 'the judge did not stop on the lines of the extra read');
  assert.equal(second.report.next, 'Next: type /claim-tagger promote again; it continues where it stopped.');
  assert.deepEqual(w.writes(), []);
  assert.deepEqual(w.calls().slice(before).map((c) => c.ids), Array(2).fill([`case-${keyOf(1)}`, `case-${keyOf(2)}`]), 'the missing read was asked for again (two attempts) and nothing else was');
  const third = await promote(w.hooks());
  assert.equal(third.exit, 0);
  assert.equal(readJson(join(third.runDir, 'card.json')).verdict, 'PASS');
});

test('promote PASS: an Editor wording is the text that is tested and that goes live, and the report says it is the editor\'s wording', async () => {
  const wording = '4. Test: a general reference needs no answer unless it points at one person; every other definite reference must point at one specific thing.';
  const w = await promoteWorld({ wording, mark: 'unless it points at one person' });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'].split('\n').find((l) => l.startsWith('4.')), `4. ${wording.replace(/^4\.\s+/, '')}`);
  assert.equal(w.row('rule_changes', TITLE)['Editor wording'], wording, 'the editor\'s field is as the editor left it');
  assert.equal(assertReport(h, r).sentence, 'Promote: PASS, rule 4 now uses your approved wording (edition 2026-10-16.2), and the follow-up marked both of your rows Fixed.');
  assert.equal(callsHolding(w, 'unless it points at one person').length > 0, true);
  assert.equal(callsHolding(w, MARK, 'unless it points at one person').length, 0, 'the proposed text was not tested: the editor\'s wording replaced it');
});

test('promote PASS: a second promote the same day makes edition .3, keeps the first change, and finds its baseline in the store the first one filled', async () => {
  const w = await promoteWorld();
  assert.equal((await promote(w.hooks())).exit, 0);
  const rule2 = w.rubric().tags.find((t) => t.name === 'Context-dependent').rules[1].text;
  const NEW2 = 'A definite reference that needs an outside antecedent to identify it makes the claim Context-dependent, even when other entities in the claim are named; a title alone counts.';
  const MARK2 = 'a title alone counts';
  for (const i of [3, 4]) w.fake.editRow(w.ids.queue[keyOf(i)], readingCells('Rule unclear', 2)); // the second change rests on these two rows, so they point at a rule (decision 79)
  w.fake.addRow(w.DB.rule_changes, {
    Lesson: 'A title alone counts', Tag: 'Context-dependent', Rule: 'Context-dependent rule 2', Kind: 'Change the rule', 'Current text': rule2, 'Proposed text': NEW2,
    'Supporting rows': `${claimText(3)} · ${keyOf(3)}\n${claimText(4)} · ${keyOf(4)}`, Status: 'Approved',
  });
  const no = { decision: 'do_not_apply', p: 0.1 };
  w.overrides([{ when: MARK2, table: { [claimText(1)]: no, [claimText(2)]: no } }, { when: MARK, table: { [claimText(1)]: no, [claimText(2)]: no } }]);
  const before = w.calls().length;
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(r.report.sentence, 'Promote: PASS, rule 2 now uses the new wording (edition 2026-10-16.3), and the follow-up marked both of your rows Fixed.');
  const copy = w.row('rulebook', 'Context-dependent')['When to use'].split('\n');
  assert.equal(copy.find((l) => l.startsWith('2.')), `2. ${NEW2}`);
  assert.equal(copy.find((l) => l.startsWith('4.')), `4. ${NEW_TEXT}`, 'the first change is still there');
  assert.deepEqual(readdirSync(join(w.root, 'rubric', 'history')).sort(), ['2026-10-16.1.json', '2026-10-16.2.json', '2026-10-16.3.json']);
  assert.equal(readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8').trim().split('\n').length, 3);
  const fresh = w.calls().slice(before);
  assert.ok(fresh.length > 0 && fresh.every((c) => callsHolding(w, MARK2).includes(c)), 'the baseline was the first change\'s candidate side: all its answers were cached');
});

test('promote PASS: in production the rubric folder is committed with the edition and the title; --no-commit, a practice profile and a FAIL commit nothing', async () => {
  const gitCalls = [];
  const git = (args) => {
    gitCalls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  };
  const w = await promoteWorld();
  const r = await promote(w.hooks({ git, noCommit: false }));
  assert.equal(r.exit, 0);
  assert.deepEqual(gitCalls, [['add', 'agents/claim-tagger-mvp/rubric'], ['commit', '-m', `rulebook edition 2026-10-16.2: ${TITLE}`, '--', 'agents/claim-tagger-mvp/rubric']]);

  gitCalls.length = 0;
  const w2 = await promoteWorld();
  assert.equal((await promote(w2.hooks({ git, noCommit: true }))).exit, 0);
  const w3 = await promoteWorld({ world: { demo: true } });
  assert.equal((await promote(w3.hooks({ git, noCommit: false }))).exit, 0);
  const w4 = await promoteWorld({ overrides: flipExample });
  assert.equal((await promote(w4.hooks({ git, noCommit: false }))).exit, 11);
  assert.deepEqual(gitCalls, [], 'no commit with --no-commit, in a practice profile, or after a FAIL');

  const w5 = await promoteWorld();
  const failing = (args) => (args[0] === 'commit' ? { status: 1, stdout: 'nothing to commit', stderr: '' } : { status: 0, stdout: '', stderr: '' });
  const h5 = w5.hooks({ git: failing, noCommit: false });
  const r5 = await promote(h5);
  assert.equal(r5.exit, 0, 'a commit that does not happen is a warning, not a failed run');
  assert.ok(readJson(join(r5.runDir, 'run.json')).warnings.some((x) => /was not committed/.test(x)));

  const w6 = await promoteWorld();
  assert.equal((await promote(w6.hooks({ noCommit: false }))).exit, 0, 'a test folder is never committed, with no git given');
});

test('promote PASS: in a practice profile Next points at step 7 of the practice page, the sentence starts with "Demo · " and ends with the practice page', async () => {
  const w = await promoteWorld({ world: { demo: true, configure: (c) => { c.notion.page_id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; c.demo_title = 'Claim tagger demo · 15 Oct 10:42'; } } });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.ok(r.markdown.startsWith('Demo · Promote: PASS, rule 4'), r.markdown);
  assert.equal(r.report.sentence, 'Promote: PASS, rule 4 now uses the new wording (edition 2026-10-16.2), and the follow-up marked both of your rows Fixed (practice page Claim tagger demo · 15 Oct 10:42).');
  assert.equal(r.report.next, 'Next: look at step 7 on the practice page (https://app.notion.com/p/Claim-tagger-demo-15-Oct-10-42-a1b2c3d4e5f60718293a4b5c6d7e8f90); the demo is then complete.', 'the link has the form of the one every other report shows');
  assert.deepEqual(lintReport(r.markdown), []);
});

test('promote PASS: with no row left in Your queue Next says nothing waits; with more than fit one sitting it says where to start', async () => {
  const none = await promoteWorld();
  assert.equal((await promote(none.hooks())).report.next, 'Next: nothing waits; type /claim-tagger status to see what is open.');
  const many = await promoteWorld({ open: 3, world: { configure: (c) => { c.queue.sitting_rows = 2; } } });
  assert.match((await promote(many.hooks())).report.next, /^Next: start at the top of Your queue \(https:\/\/www\.notion\.so\//);
});

// ---- FAIL ----------------------------------------------------------------------------------------------------------------------------------

test('promote FAIL: an example that flips leaves the rulebook alone, writes only the two rows, and hands the editor the whole text for Editor wording in the report and the card, never in Notion', async () => {
  const w = await promoteWorld({ overrides: flipExample });
  const copyBefore = w.row('rulebook', 'Context-dependent')['When to use'];
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11, h.io.errs.join('\n'));

  // nothing in the rulebook changed, anywhere
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'], copyBefore);
  assert.equal(w.rubric().edition, '2026-10-16.1');
  assert.equal(existsSync(join(w.root, 'rubric', 'history', '2026-10-16.2.json')), false);
  const lesson = w.row('rule_changes', TITLE);
  assert.deepEqual([lesson.Status, lesson['Editor wording']], ['Approved', '']);
  const cut = EXAMPLE_1.length > 60 ? `${EXAMPLE_1.slice(0, 57)}...` : EXAMPLE_1;
  assert.equal(lesson['Safety check result'], `FAIL: '${cut}' now Does not apply`);
  assert.equal(w.row('agent_settings', 'Claim tagger')['Last run summary'], `Promote · ${stampOf(NOW)} · FAIL`);
  assert.equal(w.row('agent_settings', 'Claim tagger')['Rulebook edition'], '2026-10-16.1');
  for (const i of [1, 2]) assert.equal(w.row('tag_decisions', keyOf(i))['Follow-up'], null, 'no follow-up after a FAIL');

  // the plan holds the two writes and nothing else; no request names an editor column or puts a sentence in Notion
  const plan = readJsonl(join(r.runDir, 'plan.jsonl')).rows.slice(1);
  assert.deepEqual(plan.map((op) => op.table), ['rule_changes', 'agent_settings']);
  assert.deepEqual(Object.keys(plan[0].properties), ['Safety check result']);
  for (const req of w.writes()) {
    const props = Object.keys(req.body?.properties ?? {});
    for (const col of forbidden) assert.ok(!props.includes(col), col);
    assert.ok(!JSON.stringify(req.body ?? {}).includes('still fails the test'), 'the sentence is not sent to Notion');
  }

  // the report: the claim, the figures, the sentence
  const report = assertReport(h, r);
  assert.equal(report.sentence, `Promote: FAIL, rule 4 is unchanged: the new wording turns "${cut}" to Does not apply; the right answer is Applies.`, 'the sentence names the answer the claim should have');
  assert.deepEqual(report.rows, [['Example claims', '10 of 11 right', ''], ['Earlier decisions', '2 of 2 still right', ''], ['Your 2 rows', '2 of 2 now right', '']]);
  assert.equal(report.extra, suggestion('rule 4', SENTENCE, WHY, [NEW_TEXT, SENTENCE]),
    'a part of its own: the sentence, the reason, and the rule as it was tested (the lesson\'s proposed text) with the sentence on its own line, in a block to copy');
  assert.equal(report.next, nextAfterFail(w), 'the Next line is short: the rule is in the block above it');
  assert.equal(r.markdown, `${report.sentence}\n\n${renderedTable(report.rows)}\n\n${report.extra}\n\n${report.next}\n`, 'sentence, table, suggestion, Next line, in that order');

  // the card and the wording call
  const card = readJson(join(r.runDir, 'card.json'));
  assert.deepEqual(validate(cardSchema, card).errors, []);
  assert.equal(card.verdict, 'FAIL');
  assert.deepEqual(card.checks.canaries.failures.map((m) => [m.id, m.expected, m.got]), [['canary-1', 'apply', 'do_not_apply']]);
  const md = readFileSync(join(r.runDir, 'card.md'), 'utf8');
  assert.match(md, /Suggested sentence for Editor wording: "A reference to one particular thing/);
  assert.ok(md.includes(`Why that sentence: ${WHY}`), md);
  assert.ok(md.includes(`Whole text for Editor wording (the rule as it was tested, a space, the sentence): "${NEW_TEXT} ${SENTENCE}"`), md);
  const wording = wordingCalls(w);
  assert.equal(wording.length, 1);
  assert.equal(wording[0].args[wording[0].args.indexOf('--model') + 1], 'claude-opus-5-5');
  assert.ok(wording[0].stdin.includes(`<claim answer="Applies">${EXAMPLE_1.replace(/&/g, '&amp;')}</claim>`), 'the failing claim goes in as data, with the answer it must keep');
  assert.ok(wording[0].stdin.includes('<case>broke</case>'), 'the example was right under the rule in force, so the change broke it');
  assert.ok(wording[0].stdin.includes(`<current_text>${RULE4}</current_text>`));
  assert.ok(wording[0].stdin.includes(`<proposed_text>${NEW_TEXT}</proposed_text>`));
  assert.equal(existsSync(lockFile(w)), false, 'the lock is removed on a FAIL too');
});

test('promote FAIL: when the sentence cannot be written the report says so and gives the quoted claim; the verdict and the two writes stand', async () => {
  const w = await promoteWorld({ overrides: flipExample });
  w.setEnv('FAKE_LOOP_WORDING', 'invalid');
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11);
  const report = assertReport(h, r);
  assert.match(report.sentence, /; the right answer is Applies; a suggested sentence could not be written\.$/);
  assert.match(report.next, new RegExp(`^Next: in Lessons waiting \\(.*\\), open the change and write all of rule 4 in Editor wording so that "${EXAMPLE_1.slice(0, 20)}.*" keeps its answer; then type /claim-tagger promote again\\.$`));
  assert.equal('extra' in report, false, 'no sentence, no fourth part: the report has its three parts as before');
  assert.equal(r.markdown.split(/\n\n/).length, 3);
  assert.equal(w.calls().filter((c) => /wording\.md$/.test(c.systemPromptFile)).length, 2, 'two attempts');
  assert.ok(!/Whole text for Editor wording/.test(readFileSync(join(r.runDir, 'card.md'), 'utf8')), 'no sentence, no whole text');
  assert.match(w.row('rule_changes', TITLE)['Safety check result'], /^FAIL: /);
  assert.ok(readJson(join(r.runDir, 'run.json')).wording_failed);
});

test('promote FAIL: a usage window in the wording call does not turn the verdict into a stop', async () => {
  const w = await promoteWorld({ overrides: flipExample });
  const h = w.hooks({ runClaude: (o) => (/wording\.md$/.test(o.systemPromptFile) ? { ok: false, errorKind: 'usage_window', message: 'usage limit reached', text: '' } : runClaude(o)) });
  const r = await promote(h);
  assert.equal(r.exit, 11);
  assert.match(r.report.sentence, /a suggested sentence could not be written\.$/);
});

test('promote FAIL: a sentence of more than 30 words is refused, one of exactly 30 is taken', async () => {
  const long = await promoteWorld({ overrides: flipExample });
  long.setEnv('FAKE_LOOP_WORDING', Array.from({ length: 31 }, (_, i) => `word${i}`).join(' '));
  assert.match((await promote(long.hooks())).report.sentence, /could not be written/);
  const exact = await promoteWorld({ overrides: flipExample });
  exact.setEnv('FAKE_LOOP_WORDING', `"${Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')}"`);
  const ok = await promote(exact.hooks());
  assert.ok(ok.report.extra.startsWith('Suggested sentence for rule 4:\n> word0 word1 '), ok.report.extra);
  assert.match(ok.report.extra, /word28 word29\n\nWhy: /, 'quotes the model put around the sentence are taken off');
  assert.ok(ok.report.extra.endsWith(`\`\`\`\n${NEW_TEXT}\nword0 word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14 word15 word16 word17 word18 word19 word20 word21 word22 word23 word24 word25 word26 word27 word28 word29\n\`\`\``));
});

// The reason for the sentence (decision P34): the model replies { sentence, why }; why is required, at most 40 words, and a reply without it or with a longer one is asked for again like a bad sentence.
const words = (n, prefix = 'why') => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');

test('promote FAIL: a reply without why is asked for again, and the second reply is used; two replies without it leave the report without a suggestion', async () => {
  const again = await promoteWorld({ overrides: flipExample });
  again.setEnv('FAKE_LOOP_WHY_SEQ', JSON.stringify([null, 'The later reply has a reason.']));
  const h = again.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11, h.io.errs.join('\n'));
  assert.equal(wordingCalls(again).length, 2, 'the first reply had no why, so the model was asked again');
  assert.equal(assertReport(h, r).extra, suggestion('rule 4', SENTENCE, 'The later reply has a reason.', [NEW_TEXT, SENTENCE]));

  const never = await promoteWorld({ overrides: flipExample });
  never.setEnv('FAKE_LOOP_WHY', 'none');
  const none = await promote(never.hooks());
  assert.equal(wordingCalls(never).length, 2, 'two attempts, as for a bad sentence');
  assert.match(none.report.sentence, /; a suggested sentence could not be written\.$/);
  assert.equal('extra' in none.report, false);
  assert.match(none.report.next, /open the change and write all of rule 4 in Editor wording so that ".*" keeps its answer; then type \/claim-tagger promote again\.$/, 'the no-sentence form of the Next line');
  assert.match(readJson(join(none.runDir, 'run.json')).wording_failed, /no reason/);

  const blank = await promoteWorld({ overrides: flipExample });
  blank.setEnv('FAKE_LOOP_WHY', '   ');
  assert.match((await promote(blank.hooks())).report.sentence, /could not be written/, 'an empty why is a missing why');
});

test('promote FAIL: a why of more than 40 words is refused, one of exactly 40 is taken; quotes round it come off and its double quotes become single ones', async () => {
  const long = await promoteWorld({ overrides: flipExample });
  long.setEnv('FAKE_LOOP_WHY', words(41));
  const refused = await promote(long.hooks());
  assert.match(refused.report.sentence, /; a suggested sentence could not be written\.$/);
  assert.equal(wordingCalls(long).length, 2);
  assert.match(readJson(join(refused.runDir, 'run.json')).wording_failed, /the reason has 41 words, more than 40/);

  const exact = await promoteWorld({ overrides: flipExample });
  exact.setEnv('FAKE_LOOP_WHY', `"${words(40)}"`);
  const ok = await promote(exact.hooks());
  assert.ok(ok.report.extra.includes(`\n\nWhy: ${words(40)}\n\n`), ok.report.extra);

  const quotes = await promoteWorld({ overrides: flipExample });
  quotes.setEnv('FAKE_LOOP_WHY', 'It reads "the market" as an abstract noun,\nso the rule skips it.');
  assert.ok((await promote(quotes.hooks())).report.extra.includes("\n\nWhy: It reads 'the market' as an abstract noun, so the rule skips it.\n\n"));

  // a pair of quotes that wraps the whole text comes off, but not the quotes of a text that starts and ends with a quoted phrase of its own
  const own = await promoteWorld({ overrides: flipExample });
  own.setEnv('FAKE_LOOP_WHY', "'The plan' could be any, as with 'the market'");
  assert.ok((await promote(own.hooks())).report.extra.includes("\n\nWhy: 'The plan' could be any, as with 'the market'\n\n"), 'both quoted phrases stay');
  const doubled = await promoteWorld({ overrides: flipExample });
  doubled.setEnv('FAKE_LOOP_WHY', '"It reads \'the market\' as an abstract noun."');
  assert.ok((await promote(doubled.hooks())).report.extra.includes("\n\nWhy: It reads 'the market' as an abstract noun.\n\n"), 'a pair of double quotes round a text with a quoted phrase in it comes off');
});

test('promote FAIL (lint fallback): when the suggestion does not pass the report lint the report is written without it, with the Next line that asks for the whole rule, and run.json says why', async () => {
  // the rule as tested names a run folder, which the block to copy may not: the sentence is fine, the part as a whole is refused
  const text = 'Test: see runs/x for the reference; every other definite reference must point at one specific thing.';
  const w = await promoteWorld({ text, overrides: flipExample });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11, h.io.errs.join('\n'));
  assert.equal('extra' in r.report, false, 'no suggestion part');
  assert.match(r.report.sentence, /; the right answer is Applies; a suggested sentence could not be written\.$/, 'and the sentence says so, like the report for a sentence that could not be written');
  assert.match(r.report.next, /^Next: in Lessons waiting \(.*\), open the change and write all of rule 4 in Editor wording so that ".*" keeps its answer; then type \/claim-tagger promote again\.$/, 'the Next line no longer points at a block that is not there');
  assert.notEqual(r.markdown.trim(), 'Promote finished.\n\nNext: ask the engineer to look at the message the script printed.', 'not the bare fallback report');
  assert.deepEqual(lintReport(r.markdown), []);
  const warnings = readJson(join(r.runDir, 'run.json')).warnings ?? [];
  assert.ok(warnings.some((x) => /the suggestion was left out of report\.md, because it did not pass the report lint: .*runs\//.test(x)), warnings.join('; '));
  assert.match(w.row('rule_changes', TITLE)['Safety check result'], /^FAIL: /, 'the verdict stands');
});

test('promote FAIL (report lint): a sentence or a reason with a word the report lint refuses is asked for again, so it never reaches report.md; a phrase in single quotes is a quoted claim and is exempt', async () => {
  const again = await promoteWorld({ overrides: flipExample });
  again.setEnv('FAKE_LOOP_WHY_SEQ', JSON.stringify(['It took 3 days and the database says so.', 'A clean reason.']));
  const h = again.hooks();
  const r = await promote(h);
  assert.equal(wordingCalls(again).length, 2, 'the first reason held a duration word and the database: asked again');
  assert.equal(assertReport(h, r).extra, suggestion('rule 4', SENTENCE, 'A clean reason.', [NEW_TEXT, SENTENCE]));

  const never = await promoteWorld({ overrides: flipExample });
  never.setEnv('FAKE_LOOP_WHY', 'It costs $5 and runs in runs/x/.');
  const none = await promote(never.hooks());
  assert.equal(wordingCalls(never).length, 2);
  assert.match(none.report.sentence, /; a suggested sentence could not be written\.$/);
  assert.match(readJson(join(none.runDir, 'run.json')).wording_failed, /the reason would not pass the report lint: .*dollar sign/);

  const sentence = await promoteWorld({ overrides: flipExample });
  sentence.setEnv('FAKE_LOOP_WORDING', 'A gate that needs {json} fails.');
  const bad = await promote(sentence.hooks());
  assert.match(readJson(join(bad.runDir, 'run.json')).wording_failed, /the sentence would not pass the report lint: .*gate/);
  assert.equal('extra' in bad.report, false);

  const quoted = await promoteWorld({ overrides: flipExample });
  quoted.setEnv('FAKE_LOOP_WHY', "It reads 'the last 3 days' as a time, not a thing, so the rule keeps it.");
  const q = await promote(quoted.hooks());
  assert.equal(wordingCalls(quoted).length, 1, 'quoted claim text may say 3 days');
  assert.ok(q.report.extra.includes("Why: It reads 'the last 3 days' as a time"));
});

test('promote FAIL: the rule to copy is the Editor wording that was tested when there is one (numbering dropped), else the proposed text; it keeps its own double quotes, and so does the card', async () => {
  const wording = '4. Test: a general reference such as "the market" needs no answer; every other definite reference must point at one specific thing.';
  const w = await promoteWorld({ wording, mark: 'needs no answer; every other definite reference', overrides: flipExample });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  const tested = 'Test: a general reference such as "the market" needs no answer; every other definite reference must point at one specific thing.';
  assert.equal(report.extra, suggestion('rule 4', SENTENCE, WHY, [tested, SENTENCE]), 'the block holds the text that was tested, as it was tested');
  assert.equal(report.next, nextAfterFail(w));
  assert.ok(readFileSync(join(r.runDir, 'card.md'), 'utf8').includes(`: "${tested} ${SENTENCE}"`));
  assert.ok(wordingCalls(w)[0].stdin.includes(`<proposed_text>${tested}</proposed_text>`), 'the wording call got the text that was tested');
  assert.equal(w.row('rule_changes', TITLE)['Editor wording'], wording, 'the editor\'s field is untouched');
});

test('promote FAIL: the wording call runs for an earlier decision that broke and for one of the editor\'s own rows, with the case that tells the model which it is, and the report hands over the suggestion for each', async () => {
  const earlier = await promoteWorld({ overrides: { [claimText(3)]: { decision: 'do_not_apply', p: 0.1 } } }); // claim 3 was decided Applies
  const re = await promote(earlier.hooks());
  assert.equal(re.exit, 11);
  assert.equal(wordingCalls(earlier).length, 1, 'asked for an earlier decision as for an example');
  assert.ok(wordingCalls(earlier)[0].stdin.includes(`<claim answer="Applies">${claimText(3)}</claim>`));
  assert.ok(wordingCalls(earlier)[0].stdin.includes('<case>broke</case>'), 'the earlier decision was right under the rule in force: the change broke it');
  assert.equal(re.report.extra, suggestion('rule 4', SENTENCE, WHY, [NEW_TEXT, SENTENCE]));
  assert.equal(re.report.next, nextAfterFail(earlier));

  const yours = await promoteWorld({ overrides: { [claimText(2)]: { decision: 'apply', p: 0.9 } } }); // row 2 was decided Does not apply
  const ry = await promote(yours.hooks());
  assert.equal(ry.exit, 11);
  assert.equal(yours.row('rule_changes', TITLE)['Safety check result'], `FAIL: '${claimText(2)}' now Applies`);
  assert.equal(wordingCalls(yours).length, 1, 'asked for one of the editor\'s own rows as well');
  assert.ok(wordingCalls(yours)[0].stdin.includes(`<claim answer="Does not apply">${claimText(2)}</claim>`));
  assert.ok(wordingCalls(yours)[0].stdin.includes('<case>still_wrong</case>'), 'the row was wrong under the rule in force (Can\'t tell) and the new text does not fix it');
  assert.equal(ry.report.extra, suggestion('rule 4', SENTENCE, WHY, [NEW_TEXT, SENTENCE]));
  assert.equal(ry.report.next, nextAfterFail(yours));
  assert.ok(ry.report.sentence.endsWith(`to Applies; the right answer is Does not apply.`), ry.report.sentence);
  assert.ok(readFileSync(join(ry.runDir, 'card.md'), 'utf8').includes(`Whole text for Editor wording (the rule as it was tested, a space, the sentence): "${NEW_TEXT} ${SENTENCE}"`));
});

test('promote FAIL on a practice page: the command is the demo one, and the first sentence names the practice page', async () => {
  const title = 'Claim tagger demo · 15 Oct 10:42';
  const w = await promoteWorld({ overrides: flipExample, world: { demo: true, configure: (c) => { c.demo_title = title; } } });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  const cut = EXAMPLE_1.length > 60 ? `${EXAMPLE_1.slice(0, 57)}...` : EXAMPLE_1;
  assert.equal(report.sentence, `Promote: FAIL, rule 4 is unchanged: the new wording turns "${cut}" to Does not apply; the right answer is Applies (practice page ${title}).`);
  assert.ok(r.markdown.startsWith('Demo · Promote: FAIL, rule 4 is unchanged'), r.markdown);
  assert.equal(report.extra, suggestion('rule 4', SENTENCE, WHY, [NEW_TEXT, SENTENCE]), 'the suggestion is the same on a practice page');
  assert.equal(report.next, nextAfterFail(w, 'rule 4', '/claim-tagger demo promote'));
  assert.equal(readJson(join(r.runDir, 'run.json')).exit_code, 11);
});

test('promote FAIL: an earlier decision that was right and breaks is named, and counts against "still right"', async () => {
  const w = await promoteWorld({ overrides: { [claimText(3)]: { decision: 'do_not_apply', p: 0.1 } } });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11);
  const report = assertReport(h, r);
  assert.deepEqual(report.rows[1], ['Earlier decisions', '1 of 2 still right', '']);
  assert.equal(w.row('rule_changes', TITLE)['Safety check result'], `FAIL: '${claimText(3)}' now Does not apply`);
  assert.ok(report.sentence.endsWith(`the new wording turns "${claimText(3)}" to Does not apply; the right answer is Applies.`));
});

test('promote FAIL: a row of the lesson that still comes out wrong is a FAIL too, and "leaves" says the new wording changed nothing for it', async () => {
  const w = await promoteWorld({ overrides: { [claimText(2)]: { decision: 'ask_editor', p: 0.5, rule_ref: null } } });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11);
  const report = assertReport(h, r);
  assert.deepEqual(report.rows[2], ['Your 2 rows', '1 of 2 now right', '']);
  assert.ok(report.sentence.endsWith(`the new wording leaves "${claimText(2)}" at Can't tell; the right answer is Does not apply.`), report.sentence);
  assert.equal(w.row('rule_changes', TITLE)['Safety check result'], `FAIL: '${claimText(2)}' now Can't tell`);
});

test('promote: an earlier decision that was already wrong before is not counted either way', async () => {
  const w = await promoteWorld({ base: { [claimText(4)]: { decision: 'apply', p: 0.9 } } }); // decided Does not apply: wrong before and after
  const r = await promote(w.hooks());
  assert.equal(r.exit, 0);
  assert.deepEqual(r.report.rows[1], ['Earlier decisions', '1 of 1 still right', '']);
});

test('promote: a decision on another tag is not part of the check', async () => {
  const other = await promoteWorld({ open: 0 });
  other.fake.addRow(other.DB.tag_decisions, {
    Claim: 'A wordy claim that goes on.', Key: 'c09::Wordy', Tag: 'Wordy', 'Tag outcome': 'Applies', 'Why wrong': 'Agent slip', 'Your reasoning': 'Too wordy.',
  });
  const r = await promote(other.hooks());
  assert.equal(r.exit, 0);
  assert.deepEqual(r.report.rows[1], ['Earlier decisions', '2 of 2 still right', ''], 'the Wordy row is not an earlier decision of Context-dependent');
  assert.equal(readJsonl(join(other.root, 'evals', 'cases.jsonl')).rows.length, 5, 'it is in the earlier decisions file all the same');
});

// ---- a write that fails -----------------------------------------------------------------------------------------------------------------

test('promote: when the Rulebook copy cannot be written nothing else is: the rule change stays Approved, the settings and the edition stay, and the same command goes on', async () => {
  const w = await promoteWorld();
  const copyBefore = w.row('rulebook', 'Context-dependent')['When to use'];
  w.fake.failNext('PATCH', new RegExp(`^/pages/${w.ids.tag['Context-dependent']}`), 400, 1);
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 1, h.io.errs.join('\n'));
  assert.equal(assertReport(h, r).sentence, 'Promote stopped before every change was written to Notion.');
  assert.equal(r.report.next, 'Next: type /claim-tagger promote again; it continues where it stopped.');
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'], copyBefore);
  assert.equal(w.row('rule_changes', TITLE).Status, 'Approved', 'the rule change is not marked Live over an old rulebook text');
  assert.equal(w.row('agent_settings', 'Claim tagger')['Rulebook edition'], '2026-10-16.1');
  assert.equal(w.rubric().edition, '2026-10-16.1');
  assert.equal(existsSync(join(`${r.runDir}-record`, 'plan.jsonl')), false, 'the bookkeeping was never planned');
  assert.equal(existsSync(lockFile(w)), false);

  const again = await promote(w.hooks());
  assert.equal(again.exit, 0, again.markdown);
  assert.equal(w.rubric().edition, '2026-10-16.2');
  assert.equal(w.row('rule_changes', TITLE).Status, 'Live');
});

test('promote: when the rule change cannot be marked Live after the rulebook text is written, the rule is live and says so, and the same command finishes the job without a second edition', async () => {
  const gitCalls = [];
  const git = (args) => {
    gitCalls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  };
  const w = await promoteWorld();
  w.fake.failNext('PATCH', new RegExp(`^/pages/${w.ids.lesson[TITLE]}`), 400, 1);
  const h = w.hooks({ git, noCommit: false });
  const r = await promote(h);
  assert.equal(r.exit, 1, h.io.errs.join('\n'));
  assert.equal(assertReport(h, r).sentence, `Promote stopped: rule 4 is live (edition 2026-10-16.2), but "${TITLE}" could not be marked Live in Notion.`);
  assert.equal(r.report.next, 'Next: type /claim-tagger promote again; it finishes the job.');
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'].split('\n')[3], `4. ${NEW_TEXT}`);
  assert.equal(w.rubric().edition, '2026-10-16.2');
  assert.equal(w.row('rule_changes', TITLE).Status, 'Approved');
  assert.equal(gitCalls.length, 2, 'the new edition was committed with the rulebook text, not after the bookkeeping');

  gitCalls.length = 0;
  const again = await promote(w.hooks({ git, noCommit: false }));
  assert.equal(again.exit, 0, again.markdown);
  assert.equal(w.rubric().edition, '2026-10-16.2', 'no second edition: the text was in force already');
  assert.deepEqual(gitCalls, [], 'and nothing to commit again');
  assert.equal(w.row('rule_changes', TITLE).Status, 'Live');
  assert.equal(w.row('rule_changes', TITLE)['Safety check result'], 'PASS: examples 11/11, earlier 2/2, yours 2/2');
  assert.equal(w.row('agent_settings', 'Claim tagger')['Rulebook edition'], '2026-10-16.2');
  assert.equal(again.report.sentence, 'Promote: PASS, rule 4 now uses the new wording (edition 2026-10-16.2), and the follow-up marked both of your rows Fixed.');
  for (const i of [1, 2]) assert.equal(w.row('tag_decisions', keyOf(i))['Follow-up'], 'Fixed');
  const history = readdirSync(join(w.root, 'rubric', 'history'));
  assert.deepEqual(history.sort(), ['2026-10-16.1.json', '2026-10-16.2.json']);
});

// ---- HOLD ----------------------------------------------------------------------------------------------------------------------------------

test('promote HOLD: with nothing to check the change against, exit 10, the two rows are written, and the rulebook stays', async () => {
  const w = await promoteWorld({ world: { canaries: false, queue: [] }, supporting: [] });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 10, h.io.errs.join('\n'));
  assert.equal(w.rubric().edition, '2026-10-16.1');
  assert.equal(w.row('rule_changes', TITLE).Status, 'Approved');
  assert.equal(w.row('rule_changes', TITLE)['Safety check result'], 'HOLD: there is nothing to check the change against yet');
  assert.equal(w.row('agent_settings', 'Claim tagger')['Last run summary'], `Promote · ${stampOf(NOW)} · HOLD`);
  assert.equal(w.calls().length, 0, 'nothing to ask');
  const report = assertReport(h, r);
  assert.equal(report.sentence, `Promote: HOLD, rule 4 is unchanged: there are no example claims or earlier decisions to check "${TITLE}" against yet.`);
  assert.equal(report.next, 'Next: ask the engineer to set up the example claims, then type /claim-tagger promote again.');
  const card = readJson(join(r.runDir, 'card.json'));
  assert.deepEqual(validate(cardSchema, card).errors, []);
  assert.equal(card.verdict, 'HOLD');
  assert.equal(existsSync(lockFile(w)), false);
});

// the report check of assertReport, but for the words of decision 79 ("a decision you now call the agent's slip"): assertReport keeps the word call out of a report, because for an engineer it means a model call
function assertHeldReport(h, r) {
  assert.deepEqual(lintReport(r.markdown), [], r.markdown);
  assert.equal(h.io.outs.join('\n').trimEnd(), r.markdown.trimEnd());
  assert.ok(!/token|duration|\$|\.mjs|--[a-z]|runs\//i.test(r.markdown) && !/\bcalls\b/i.test(r.markdown) && !/\bcall\b(?! the agent's slip)/i.test(r.markdown), r.markdown);
  return r.report;
}

test('promote HOLD, a rule change that rests on a decision the editor now calls the agent\'s slip: exit 10 before anything is asked or written, the report says why and asks to reject it and distill again, and the lesson stays Approved', async () => {
  const w = await promoteWorld();
  w.fake.editRow(w.ids.queue[keyOf(2)], readingCells('Agent slip')); // distill re-read the row of claim 2 as Agent slip after the editor's note
  const writes = w.writes().length;
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 10, h.io.errs.join('\n'));
  const report = assertHeldReport(h, r);
  assert.equal(report.sentence, `Promote: held: the rule change "${TITLE}" rests on a decision you now call the agent's slip, so the safety check did not run.`);
  assert.equal(report.next, `Next: reject the rule change "${TITLE}" in Lessons waiting (${lessonsLink(w)}), then type /claim-tagger distill again.`);
  assert.equal(report.rows, undefined, 'a sentence and a Next line');
  assert.equal(w.writes().length, writes, 'nothing is written: not the lesson, not Agent settings, not the rulebook');
  assert.equal(w.calls().length, 0, 'and the safety check did not run');
  assert.equal(w.row('rule_changes', TITLE).Status, 'Approved');
  assert.equal(w.row('rule_changes', TITLE)['Safety check result'], '');
  assert.equal(w.rubric().edition, '2026-10-16.1');
  assert.equal(existsSync(lockFile(w)), false, 'no lock was taken');
  const run = readJson(join(r.runDir, 'run.json'));
  assert.deepEqual([run.exit_code, run.status, run.recanted], [10, 'done', { keys: [keyOf(2)], why: 'slip' }]);

  // the demo form of the command
  const demo = await promoteWorld({ world: { demo: true } });
  demo.fake.editRow(demo.ids.queue[keyOf(2)], readingCells('Agent slip'));
  const hd = demo.hooks();
  const rd = await promote(hd);
  assert.equal(rd.exit, 10);
  assert.ok(rd.markdown.startsWith('Demo · Promote: held: '), rd.markdown);
  assert.match(assertHeldReport(hd, rd).next, /, then type \/claim-tagger demo distill again\.$/);

  // the editor rejects it, distill drafts again from the row that remains: nothing of this is promote's to do
  w.fake.editRow(w.ids.lesson[TITLE], { Status: 'Rejected' });
  assert.equal((await promote(w.hooks())).exit, 2, 'a rejected rule change is not Approved: the usual refusal');
});

test('promote HOLD, the editor\'s reason word counts before distill has written it: a note that opens with "Agent slip." holds the rule change although the ledger still holds the old reading', async () => {
  const w = await promoteWorld();
  w.review('c02', { tags: [], why: 'Agent slip', notes: 'Rule 5 settles it.' }); // the claim is Reviewed again with the reason word; the ledger row of claim 2 still reads Rule unclear
  assert.equal(w.row('tag_decisions', keyOf(2))['Agent reading'], 'Rule unclear');
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 10, h.io.errs.join('\n'));
  assert.equal(assertHeldReport(h, r).sentence, `Promote: held: the rule change "${TITLE}" rests on a decision you now call the agent's slip, so the safety check did not run.`);
  assert.equal(w.calls().length, 0);
  assert.equal(w.row('rule_changes', TITLE).Status, 'Approved');
});

test('promote HOLD, a row that is no longer a disagreement, was marked Fixed or holds only a guess without a note: "a decision that no longer points at a rule"; a Still wrong row stays checkable', async () => {
  const phrase = 'a decision that no longer points at a rule';
  const cases = {
    'no longer a disagreement': (w) => w.fake.editRow(w.ids.queue[keyOf(1)], { 'Tag outcome': "Can't tell" }),
    'marked Fixed': (w) => w.fake.editRow(w.ids.queue[keyOf(1)], { 'Follow-up': 'Fixed' }),
    'a guess without a note': (w) => w.fake.editRow(w.ids.queue[keyOf(1)], { 'Reading note': 'without your note · The rule leaves this kind of case open.' }),
    'no reading': (w) => w.fake.editRow(w.ids.queue[keyOf(1)], { 'Agent reading': null, Rule: '', 'Reading note': '' }),
  };
  for (const [name, change] of Object.entries(cases)) {
    const w = await promoteWorld();
    change(w);
    const h = w.hooks();
    const r = await promote(h);
    assert.equal(r.exit, 10, name);
    assert.equal(assertHeldReport(h, r).sentence, `Promote: held: the rule change "${TITLE}" rests on ${phrase}, so the safety check did not run.`, name);
  }
  const still = await promoteWorld();
  still.fake.editRow(still.ids.queue[keyOf(1)], { 'Follow-up': 'Still wrong' });
  assert.equal((await promote(still.hooks())).exit, 0, 'Still wrong stays open: the rule change is checked as always');
  // two recanted rows
  const both = await promoteWorld();
  for (const i of [1, 2]) both.fake.editRow(both.ids.queue[keyOf(i)], readingCells('Agent slip'));
  const rb = await promote(both.hooks());
  assert.equal(rb.exit, 10);
  assert.equal(rb.report.sentence, `Promote: held: the rule change "${TITLE}" rests on 2 decisions you now call the agent's slips, so the safety check did not run.`);
});

// ---- the lock --------------------------------------------------------------------------------------------------------------------------------

test('promote: a lock younger than two hours from another run stops the command with exit 2 and is left alone', async () => {
  const w = await promoteWorld();
  young(w, { run_id: 'someone-else', lesson: 'Another one', phase: 'judging', since: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString() });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 2);
  assert.equal(assertReport(h, r).sentence, 'Promote: nothing was checked, because a safety check is already running.');
  assert.equal(w.calls().length, 0);
  assert.equal(readJson(lockFile(w)).run_id, 'someone-else', 'the other run\'s lock is not ours to remove');
  assert.equal(w.writes().length, 0);
});

test('promote: a lock with no time in it is judged by the age of its file', async () => {
  const w = await promoteWorld();
  young(w, { run_id: 'someone-else', lesson: 'Another one', phase: 'judging' });
  const tenMinutes = new Date(NOW.getTime() - 10 * 60 * 1000);
  utimesSync(lockFile(w), tenMinutes, tenMinutes);
  assert.equal((await promote(w.hooks())).exit, 2);
  const threeHours = new Date(NOW.getTime() - 3 * 60 * 60 * 1000);
  utimesSync(lockFile(w), threeHours, threeHours);
  assert.equal((await promote(w.hooks())).exit, 0, 'an old lock is taken over');
  assert.equal(existsSync(lockFile(w)), false);
});

test('promote: a lock older than two hours is taken over, and the lock is removed on every way out', async () => {
  const w = await promoteWorld();
  young(w, { run_id: 'old-run', lesson: 'Old', phase: 'judging', since: new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString() });
  assert.equal((await promote(w.hooks())).exit, 0);
  assert.equal(existsSync(lockFile(w)), false);

  const stopped = await promoteWorld();
  stopped.setEnv('FAKE_CLAUDE_MODE', 'usage-window');
  assert.equal((await promote(stopped.hooks())).exit, 75);
  assert.equal(existsSync(lockFile(stopped)), false, 'also after a stop');
});

test('promote: while it runs the lock names the run and the lesson, and the phase moves from judging to planned', async () => {
  const w = await promoteWorld();
  const seen = [];
  const h = w.hooks({
    runClaude: (o) => {
      if (existsSync(lockFile(w))) seen.push(readJson(lockFile(w)));
      return runClaude(o);
    },
  });
  const r = await promote(h);
  assert.equal(r.exit, 0);
  assert.ok(seen.length > 0);
  assert.deepEqual([seen[0].run_id, seen[0].lesson, seen[0].phase], [r.runId, TITLE, 'judging']);
});

// ---- which lesson ------------------------------------------------------------------------------------------------------------------------------

test('promote: a lesson that is not Approved is refused with exit 2 and a report that says what it is', async () => {
  const proposed = await promoteWorld({ status: 'Proposed' });
  const h = proposed.hooks({ lesson: TITLE });
  const r = await promote(h);
  assert.equal(r.exit, 2);
  const report = assertReport(h, r);
  assert.equal(report.sentence, `Promote: nothing was done, because "${TITLE}" is proposed, not approved.`);
  assert.match(report.next, /^Next: approve it in Lessons waiting \(https:\/\/www\.notion\.so\/.*\) first\.$/);
  assert.equal(proposed.calls().length + proposed.writes().length, 0);

  const live = await promoteWorld({ status: 'Live' });
  assert.equal((await promote(live.hooks({ lesson: TITLE }))).report.next, 'Next: type /claim-tagger status to see what is open.');
  const unknown = await promoteWorld();
  const rr = await promote(unknown.hooks({ lesson: 'There is no such lesson' }));
  assert.equal(rr.exit, 2);
  assert.equal(rr.report.sentence, 'Promote: nothing was done, because there is no rule change called "There is no such lesson".');
});

test('promote: without --lesson the only Approved rule change is taken; none, or two or more, is exit 2 and says which', async () => {
  const one = await promoteWorld();
  assert.equal((await promote(one.hooks())).exit, 0);
  const none = await promoteWorld({ status: 'Proposed' });
  const rn = await promote(none.hooks());
  assert.equal(rn.exit, 2);
  assert.equal(rn.report.sentence, 'Promote: nothing was done, because no rule change is approved yet.');
  assert.match(rn.report.next, /^Next: approve a rule change in Lessons waiting \(/);
  const two = await promoteWorld({ lessonRows: [{ Lesson: 'A second approved change', Tag: 'Context-dependent', Rule: 'Context-dependent rule 2', Kind: 'Clarify wording', 'Current text': 'x', 'Proposed text': 'y', Status: 'Approved' }] });
  const h = two.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 2);
  assert.equal(assertReport(h, r).sentence, `Promote: nothing was done, because 2 rule changes are approved: "A second approved change" and "${TITLE}".`);
  assert.equal(r.report.next, 'Next: type /claim-tagger promote with the title of the one you mean.');
  assert.equal(two.calls().length, 0);
  const byName = await promote(two.hooks({ lesson: TITLE.toUpperCase() }));
  assert.equal(byName.exit, 0, 'a title is found whatever its case');
});

test('promote: a lesson whose rule has changed since it was drafted, or that is not about one numbered rule, is exit 2', async () => {
  const stale = await promoteWorld();
  stale.fake.editRow(stale.ids.lesson[TITLE], { 'Current text': 'The rule as it read when this was drafted, which is not what it reads now.' });
  const r = await promote(stale.hooks());
  assert.equal(r.exit, 2);
  assert.equal(r.report.sentence, `Promote: nothing was checked, because rule 4 of Context-dependent has changed since "${TITLE}" was drafted.`);
  assert.equal(r.report.next, 'Next: type /claim-tagger distill to draft the change again.');

  const initial = await promoteWorld();
  initial.fake.editRow(initial.ids.lesson[TITLE], { Kind: 'Initial rules', Rule: 'Context-dependent when to use' });
  const ri = await promote(initial.hooks());
  assert.equal(ri.exit, 2);
  assert.match(ri.report.sentence, /is not a change to one numbered rule\.$/);

  const missingRow = await promoteWorld({ supporting: [1, 9] });
  const rm = await promote(missingRow.hooks());
  assert.equal(rm.exit, 2);
  assert.match(rm.report.sentence, /because a row "General references need no answer" rests on is not decided any more\.$/);
});

// ---- stops ------------------------------------------------------------------------------------------------------------------------------------

test('promote: a paused agent (exit 3) and a drift of the rulebook text in Notion (exit 4) stop it before anything is asked or taken', async () => {
  const paused = await promoteWorld();
  paused.setPaused(true);
  const h = paused.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 3);
  assert.equal(assertReport(h, r).sentence, 'Promote: nothing was done, because the agent is paused.');
  assert.equal(existsSync(lockFile(paused)), false);
  assert.equal(paused.calls().length, 0);

  const drifted = await promoteWorld();
  drifted.fake.editRow(drifted.ids.tag['Context-dependent'], { Description: 'Somebody rewrote this.' });
  const h2 = drifted.hooks();
  const r2 = await promote(h2);
  assert.equal(r2.exit, 4);
  assert.match(assertReport(h2, r2).sentence, /^Promote: nothing was done, because the rulebook text in Notion no longer matches the saved edition \(Context-dependent: Description\)\.$/);
  assert.equal(drifted.calls().length, 0);
  assert.equal(drifted.writes().length, 0);
});

test('promote: a usage window ends the run with exit 75 and nothing is written; repeated errors are exit 1; another model than the pinned one is exit 4', async () => {
  for (const [mode, exit, sentence] of [
    ['usage-window', 75, 'Promote stopped: your Claude allowance ran out; nothing was written to Notion.'],
    ['transient-always', 1, 'Promote stopped: Claude kept answering with an error; nothing was written to Notion.'],
    ['wrong-model', 4, 'Promote stopped: a different model than the pinned one answered; nothing was written to Notion.'],
  ]) {
    const w = await promoteWorld();
    w.setEnv('FAKE_CLAUDE_MODE', mode);
    const h = w.hooks();
    const r = await promote(h);
    assert.equal(r.exit, exit, mode);
    assert.equal(assertReport(h, r).sentence, sentence, mode);
    assert.equal(w.writes().length, 0, mode);
    assert.equal(w.rubric().edition, '2026-10-16.1', mode);
    assert.equal(existsSync(lockFile(w)), false, mode);
  }
  const w = await promoteWorld();
  w.setEnv('FAKE_CLAUDE_MODE', 'usage-window');
  const r = await promote(w.hooks());
  assert.equal(r.report.next, 'Next: when your Claude allowance is back, type /claim-tagger promote again; it continues where it stopped.');
});

test('promote: a rulebook text edited in Notion while the check ran stops it with exit 4 before anything is written, and so does a lesson that was rejected meanwhile', async () => {
  const edited = await promoteWorld();
  const old = edited.row('rulebook', 'Context-dependent')['When to use'];
  let once = false;
  const h = edited.hooks({
    runClaude: (o) => {
      if (!once) {
        once = true;
        edited.fake.editRow(edited.ids.tag['Context-dependent'], { 'When to use': `${old}\n6. Somebody added this by hand.` });
      }
      return runClaude(o);
    },
  });
  const r = await promote(h);
  assert.equal(r.exit, 4);
  assert.equal(assertReport(h, r).sentence, 'Promote: nothing was changed, because the rulebook text in Notion was edited while it ran.');
  assert.equal(edited.row('rule_changes', TITLE).Status, 'Approved');
  assert.equal(edited.rubric().edition, '2026-10-16.1');
  assert.equal(edited.writes().length, 0);

  const rejected = await promoteWorld();
  let flipped = false;
  const h2 = rejected.hooks({
    runClaude: (o) => {
      if (!flipped) {
        flipped = true;
        rejected.fake.editRow(rejected.ids.lesson[TITLE], { Status: 'Rejected' });
      }
      return runClaude(o);
    },
  });
  const r2 = await promote(h2);
  assert.equal(r2.exit, 2);
  assert.equal(r2.report.sentence, `Promote: nothing was changed, because "${TITLE}" is not approved any more.`);
  assert.equal(rejected.writes().length, 0);
});

test('promote: a check that stopped at the usage window goes on where it stopped: the answers already stored are not asked for again', async () => {
  const control = await promoteWorld();
  assert.equal((await promote(control.hooks())).exit, 0);
  const uninterrupted = control.calls().length;
  assert.ok(uninterrupted > 4);

  const w = await promoteWorld();
  w.setEnv('FAKE_CLAUDE_MODE', 'usage-window');
  w.setEnv('FAKE_CLAUDE_AFTER', '3');
  const first = await promote(w.hooks());
  assert.equal(first.exit, 75);
  assert.equal(w.rubric().edition, '2026-10-16.1');
  assert.equal(w.writes().length, 0);
  const failed = w.calls().length - 3; // two batches are in flight at a time, so more than one call can meet the window
  assert.ok(failed >= 1, 'three calls were answered and the next ones hit the window');
  w.setEnv('FAKE_CLAUDE_MODE', null);
  w.setEnv('FAKE_CLAUDE_AFTER', null);
  const second = await promote(w.hooks());
  assert.equal(second.exit, 0, second.markdown);
  assert.equal(w.calls().length - failed, uninterrupted, 'the calls of both runs, but the ones that failed, are the calls of one uninterrupted run');
  assert.equal(w.rubric().edition, '2026-10-16.2');
});

test('promote: --runs-max 1 asks for one read per item, and the extra reads of a flipped item are still made', async () => {
  const w = await promoteWorld();
  const r = await promote(w.hooks({ runsMax: 1 }));
  assert.equal(r.exit, 0);
  const run2 = storeDirs(w).flatMap((dir) => readJsonl(join(dir, 'run-2.jsonl')).rows);
  assert.deepEqual([...new Set(run2.map((l) => l.id))].sort(), [`case-${keyOf(1)}`, `case-${keyOf(2)}`].sort(), 'run 2 exists only for the flipped rows');
});

// ---- the command line -----------------------------------------------------------------------------------------------------------------------------

test('promote: a bad command line is refused with the usage', async () => {
  const io = { outs: [], errs: [], out: (s) => io.outs.push(s), err: (s) => io.errs.push(s) };
  assert.equal(await main(['--bogus'], io), 2);
  assert.match(io.errs.join('\n'), /usage: node agents\/claim-tagger-mvp\/scripts\/promote\.mjs/);
  assert.equal(await main(['--runs-max', '5'], io), 2);
  assert.equal(await main(['--driver', 'real'], io), 2);
  assert.equal(await main(['--help'], io), 0);
  assert.match(io.outs.join('\n'), /--no-commit/);
});
