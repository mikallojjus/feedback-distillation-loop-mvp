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
import { MARK, NEW_TEXT, RULE4, TITLE, callsHolding, keyOf, promoteWorld } from './helpers/promote-scenario.mjs';

const cardSchema = readJson(join(codeRoot(), 'schemas', 'card.schema.json'));
const EXAMPLE_1 = taxonomyCanaries()[0].claim; // an example that applies

function assertReport(h, r) {
  assert.ok(r.markdown, 'a report was written');
  assert.deepEqual(lintReport(r.markdown), [], r.markdown);
  assert.equal(h.io.outs.join('\n').trimEnd(), r.markdown.trimEnd(), 'the script prints the report and nothing else on stdout');
  assert.ok(!/\bcalls?\b|token|duration|\$|\.mjs|--[a-z]|runs\//i.test(r.markdown), r.markdown);
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
  assert.equal(w.row('claims_copy', 'c01')['Agent notes'].split('\n')[1].endsWith('edition 2026-10-16.2'), true);
  assert.equal(w.row('claims_copy', 'c01')['Agent tags'], '', 'the editor decided Does not apply');
  assert.equal(w.row('claims_copy', 'c03')['Agent tags'], '', 'claim 3 is not part of the lesson, so its columns were not touched');

  // the report
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Promote: PASS, rule 4 now uses the new wording (edition 2026-10-16.2), and the follow-up marked both of your rows Fixed.');
  assert.deepEqual(report.rows, [['Example claims', '11 of 11 right', ''], ['Earlier decisions', '2 of 2 still right', ''], ['Your 2 rows', '2 of 2 now right, marked Fixed', '']]);
  assert.equal(report.next, `Next: decide your claim in Your queue (https://www.notion.so/${w.DB.claims_copy}?v=e3000000000000000000000000000001).`);

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
  assert.equal(report.sentence, `Promote: FAIL, rule 4 is unchanged: the new wording turns "${cut}" to Does not apply.`);
  assert.deepEqual(report.rows, [['Example claims', '10 of 11 right', ''], ['Earlier decisions', '2 of 2 still right', ''], ['Your 2 rows', '2 of 2 now right', '']]);
  assert.equal(report.next, `Next: in Lessons waiting (${lessonsLink(w)}), open the change and put this whole text into Editor wording: "${NEW_TEXT} ${SENTENCE}"; then type /claim-tagger promote again.`,
    'Editor wording is the whole rule: the text that was tested (the lesson\'s proposed text), a space, the proposed sentence');

  // the card and the wording call
  const card = readJson(join(r.runDir, 'card.json'));
  assert.deepEqual(validate(cardSchema, card).errors, []);
  assert.equal(card.verdict, 'FAIL');
  assert.deepEqual(card.checks.canaries.failures.map((m) => [m.id, m.expected, m.got]), [['canary-1', 'apply', 'do_not_apply']]);
  const md = readFileSync(join(r.runDir, 'card.md'), 'utf8');
  assert.match(md, /Suggested sentence for Editor wording: "A reference to one particular thing/);
  assert.ok(md.includes(`Whole text for Editor wording (the rule as it was tested, a space, the sentence): "${NEW_TEXT} ${SENTENCE}"`), md);
  const wording = wordingCalls(w);
  assert.equal(wording.length, 1);
  assert.equal(wording[0].args[wording[0].args.indexOf('--model') + 1], 'claude-opus-5-5');
  assert.ok(wording[0].stdin.includes(`<claim answer="Applies">${EXAMPLE_1.replace(/&/g, '&amp;')}</claim>`), 'the failing claim goes in as data, with the answer it must keep');
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
  assert.match(report.sentence, /; a suggested sentence could not be written\.$/);
  assert.match(report.next, new RegExp(`^Next: in Lessons waiting \\(.*\\), open the change and write all of rule 4 in Editor wording so that "${EXAMPLE_1.slice(0, 20)}.*" keeps its answer; then type /claim-tagger promote again\\.$`));
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
  assert.ok(ok.report.next.includes(`Editor wording: "${NEW_TEXT} word0 word1 `), ok.report.next);
  assert.match(ok.report.next, /word28 word29"; then type \/claim-tagger promote again\.$/, 'quotes the model put around the sentence are taken off');
});

test('promote FAIL: the whole text is the Editor wording that was tested when there is one (numbering dropped), else the proposed text; double quotes inside it become single ones in the report, and stay as they are in the card', async () => {
  const wording = '4. Test: a general reference such as "the market" needs no answer; every other definite reference must point at one specific thing.';
  const w = await promoteWorld({ wording, mark: 'needs no answer; every other definite reference', overrides: flipExample });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  const tested = 'Test: a general reference such as "the market" needs no answer; every other definite reference must point at one specific thing.';
  assert.equal(report.next, `Next: in Lessons waiting (${lessonsLink(w)}), open the change and put this whole text into Editor wording: "${tested.replace(/"/g, "'")} ${SENTENCE}"; then type /claim-tagger promote again.`);
  assert.ok(readFileSync(join(r.runDir, 'card.md'), 'utf8').includes(`: "${tested} ${SENTENCE}"`));
  assert.ok(wordingCalls(w)[0].stdin.includes(`<proposed_text>${tested}</proposed_text>`), 'the wording call got the text that was tested');
  assert.equal(w.row('rule_changes', TITLE)['Editor wording'], wording, 'the editor\'s field is untouched');
});

test('promote FAIL: the wording call runs for an earlier decision that broke and for one of the editor\'s own rows, and the report hands over the whole text for each', async () => {
  const wholeText = `"${NEW_TEXT} ${SENTENCE}"`;
  const earlier = await promoteWorld({ overrides: { [claimText(3)]: { decision: 'do_not_apply', p: 0.1 } } }); // claim 3 was decided Applies
  const re = await promote(earlier.hooks());
  assert.equal(re.exit, 11);
  assert.equal(wordingCalls(earlier).length, 1, 'asked for an earlier decision as for an example');
  assert.ok(wordingCalls(earlier)[0].stdin.includes(`<claim answer="Applies">${claimText(3)}</claim>`));
  assert.equal(re.report.next, `Next: in Lessons waiting (${lessonsLink(earlier)}), open the change and put this whole text into Editor wording: ${wholeText}; then type /claim-tagger promote again.`);

  const yours = await promoteWorld({ overrides: { [claimText(2)]: { decision: 'apply', p: 0.9 } } }); // row 2 was decided Does not apply
  const ry = await promote(yours.hooks());
  assert.equal(ry.exit, 11);
  assert.equal(yours.row('rule_changes', TITLE)['Safety check result'], `FAIL: '${claimText(2)}' now Applies`);
  assert.equal(wordingCalls(yours).length, 1, 'asked for one of the editor\'s own rows as well');
  assert.ok(wordingCalls(yours)[0].stdin.includes(`<claim answer="Does not apply">${claimText(2)}</claim>`));
  assert.equal(ry.report.next, `Next: in Lessons waiting (${lessonsLink(yours)}), open the change and put this whole text into Editor wording: ${wholeText}; then type /claim-tagger promote again.`);
  assert.ok(readFileSync(join(ry.runDir, 'card.md'), 'utf8').includes(`Whole text for Editor wording (the rule as it was tested, a space, the sentence): ${wholeText}`));
});

test('promote FAIL on a practice page: the command is the demo one, and the first sentence names the practice page', async () => {
  const title = 'Claim tagger demo · 15 Oct 10:42';
  const w = await promoteWorld({ overrides: flipExample, world: { demo: true, configure: (c) => { c.demo_title = title; } } });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  const cut = EXAMPLE_1.length > 60 ? `${EXAMPLE_1.slice(0, 57)}...` : EXAMPLE_1;
  assert.equal(report.sentence, `Promote: FAIL, rule 4 is unchanged: the new wording turns "${cut}" to Does not apply (practice page ${title}).`);
  assert.ok(r.markdown.startsWith('Demo · Promote: FAIL, rule 4 is unchanged'), r.markdown);
  assert.equal(report.next, `Next: in Lessons waiting (${lessonsLink(w)}), open the change and put this whole text into Editor wording: "${NEW_TEXT} ${SENTENCE}"; then type /claim-tagger demo promote again.`);
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
  assert.ok(report.sentence.endsWith(`the new wording turns "${claimText(3)}" to Does not apply.`));
});

test('promote FAIL: a row of the lesson that still comes out wrong is a FAIL too, and "leaves" says the new wording changed nothing for it', async () => {
  const w = await promoteWorld({ overrides: { [claimText(2)]: { decision: 'ask_editor', p: 0.5, rule_ref: null } } });
  const h = w.hooks();
  const r = await promote(h);
  assert.equal(r.exit, 11);
  const report = assertReport(h, r);
  assert.deepEqual(report.rows[2], ['Your 2 rows', '1 of 2 now right', '']);
  assert.ok(report.sentence.endsWith(`the new wording leaves "${claimText(2)}" at Can't tell.`), report.sentence);
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
