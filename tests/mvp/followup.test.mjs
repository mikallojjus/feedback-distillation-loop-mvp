import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { followup, main } from '../../agents/claim-tagger-mvp/scripts/followup.mjs';
import { promote } from '../../agents/claim-tagger-mvp/scripts/promote.mjs';
import { readJson, readJsonl } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { stampOf } from '../../agents/claim-tagger-mvp/scripts/lib/editor-words.mjs';
import { NOW, claimText } from './helpers/loop-world.mjs';
import { TITLE, keyOf, promoteWorld } from './helpers/promote-scenario.mjs';

function assertReport(h, r) {
  assert.ok(r.markdown, 'a report was written');
  assert.deepEqual(lintReport(r.markdown), [], r.markdown);
  assert.equal(h.io.outs.join('\n').trimEnd(), r.markdown.trimEnd());
  assert.ok(!/\bcalls?\b|token|duration|\$|\.mjs|--[a-z]|runs\//i.test(r.markdown), r.markdown);
  return r.report;
}
const no = { decision: 'do_not_apply', p: 0.1 };
const wrong = { decision: 'ask_editor', p: 0.5, rule_ref: null };

/** A world after a PASS: the lesson is Live, the rulebook in force is the candidate, and the answers of the check are in the store. */
async function afterPass(opts = {}) {
  const w = await promoteWorld(opts);
  const p = await promote(w.hooks());
  assert.equal(p.exit, 0);
  return w;
}

test('followup by hand after a PASS: the agent now agrees with both decisions, nothing is asked, and nothing is written but the settings line', async () => {
  const w = await afterPass();
  const before = w.calls().length;
  const writes = w.writes().length;
  const h = w.hooks();
  const r = await followup(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(w.calls().length, before, 'the answers were all in the store: 0 calls');
  const fresh = w.writes().slice(writes);
  assert.deepEqual(fresh.map((x) => `${x.method} ${x.path.startsWith('/pages/') ? 'page' : x.path}`), ['PATCH page'], 'the rows are already marked Fixed and the claims already hold their columns');
  assert.deepEqual(Object.keys(fresh[0].body.properties), ['Rulebook edition', 'Last run summary']);
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Follow-up, repeated by hand: the agent now agrees with both of your decisions.');
  assert.deepEqual(report.header, ['Your row', 'Follow-up', '']);
  assert.deepEqual(report.rows, [['"The speaker said claim number 1 about..."', 'Fixed', ''], ['"The speaker said claim number 2 about..."', 'Fixed', '']], 'the rows of the lesson, each claim cut to 40 characters');
  assert.equal(report.next, 'Next: type /claim-tagger status to see what is open.');
  assert.equal(w.row('agent_settings', 'Claim tagger')['Last run summary'], `Follow-up · ${stampOf(NOW)} · 2 Fixed, 0 Still wrong`);
  assert.equal(readJson(join(r.runDir, 'run.json')).lesson, TITLE);
});

test('followup in a practice profile ends with "nothing; the demo is complete"', async () => {
  const w = await afterPass({ world: { demo: true } });
  const r = await followup(w.hooks());
  assert.equal(r.exit, 0);
  assert.ok(r.markdown.startsWith('Demo · Follow-up, repeated by hand: the agent now agrees with both of your decisions.'), r.markdown);
  assert.equal(r.report.next, 'Next: nothing; the demo is complete.');
});

test('followup: rows that still come out wrong are marked Still wrong, the report counts them, and Next asks for a note', async () => {
  const w = await promoteWorld({ status: 'Live', base: { [claimText(1)]: no, [claimText(2)]: wrong } });
  const h = w.hooks();
  const r = await followup(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(w.row('tag_decisions', keyOf(1))['Follow-up'], 'Fixed');
  assert.equal(w.row('tag_decisions', keyOf(2))['Follow-up'], 'Still wrong');
  assert.equal(w.row('tag_decisions', keyOf(3))['Follow-up'], null, 'a row the lesson does not rest on is not marked');
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Follow-up, repeated by hand: the agent agrees with 1 of your 2 decisions; 1 still comes out wrong.');
  assert.deepEqual(report.rows.map((x) => x[1]).sort(), ['Fixed', 'Still wrong']);
  assert.equal(report.next, `Next: add a note in Challenged tags notes on the claims in Agent disagreed (https://www.notion.so/${w.DB.claims_copy}?v=e3000000000000000000000000000005).`, 'the view Agent disagreed of the Claims copy');
  assert.equal(w.row('agent_settings', 'Claim tagger')['Last run summary'], `Follow-up · ${stampOf(NOW)} · 1 Fixed, 1 Still wrong`);

  const both = await promoteWorld({ status: 'Live' }); // under the rule in force both rows are Can't tell
  const r2 = await followup(both.hooks());
  assert.equal(r2.report.sentence, 'Follow-up, repeated by hand: the agent agrees with 0 of your 2 decisions; 2 still come out wrong.');
  assert.ok(both.calls().length > 0, 'a cold store is read');
});

const WRITE_COLUMNS = ['Agent tags', 'Agent confidence', 'Agent reasons', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks'];
const REMARK = 'not checked: 4 source tags, 2 duplicate tags, 6 tags without rules';

test('followup: the claims of the rows get their agent columns again, with the editor\'s decision and the edition in force', async () => {
  const w = await promoteWorld({ status: 'Live', base: { [claimText(1)]: no, [claimText(2)]: no } });
  w.editClaim('c01', { 'Agent tags': ['Context-dependent'], 'Agent status': 'Done', 'Agent edition': '2026-10-01.1' });
  const r = await followup(w.hooks());
  assert.equal(r.exit, 0);
  const c01 = w.claim('c01');
  assert.deepEqual(c01['Agent tags'], [], 'the editor decided Does not apply, so the tag is not written');
  assert.deepEqual([c01['Tags waiting'], c01['Agent status'], c01['Agent edition'], c01['Agent remarks']], [[], 'Done', '2026-10-16.1', REMARK]);
  const plan = readJsonl(join(r.runDir, 'plan.jsonl')).rows.slice(1);
  for (const op of plan.filter((o) => o.table === 'claims_copy')) assert.ok(Object.keys(op.properties).every((k) => WRITE_COLUMNS.includes(k)), 'the agent\'s own columns of the claim and nothing the editor writes');
  for (const op of plan.filter((o) => o.table === 'tag_decisions')) assert.deepEqual(Object.keys(op.properties), ['Follow-up'], 'the only column a decided row accepts');
});

test('followup: a lesson that is not Live is refused with exit 2; without --lesson the only Live one is taken, and two are named', async () => {
  const approved = await promoteWorld();
  const h = approved.hooks({ lesson: TITLE });
  const r = await followup(h);
  assert.equal(r.exit, 2);
  const report = assertReport(h, r);
  assert.equal(report.sentence, `Follow-up: nothing was done, because "${TITLE}" is approved, not live.`);
  assert.equal(report.next, 'Next: type /claim-tagger promote to check it first.');
  assert.equal(approved.writes().length, 0);

  const none = await promoteWorld();
  const rn = await followup(none.hooks());
  assert.equal(rn.exit, 2);
  assert.equal(rn.report.sentence, 'Follow-up: nothing was done, because no rule change is live yet.');

  const live = await promoteWorld({ status: 'Live', base: { [claimText(1)]: no, [claimText(2)]: no } });
  assert.equal((await followup(live.hooks())).exit, 0, 'the only Live rule change');
  const two = await promoteWorld({ status: 'Live', lessonRows: [{ Lesson: 'Another live change', Tag: 'Context-dependent', Rule: 'Context-dependent rule 2', Kind: 'Clarify wording', 'Current text': 'x', 'Proposed text': 'y', Status: 'Live' }] });
  const r2 = await followup(two.hooks());
  assert.equal(r2.exit, 2);
  assert.equal(r2.report.sentence, `Follow-up: nothing was done, because 2 rule changes are live: "Another live change" and "${TITLE}".`);
  assert.equal((await followup(two.hooks({ lesson: 'Another live change' }))).exit, 2, 'its supporting rows are not decided: it lists none');
});

test('followup: a supporting row that is not decided any more is exit 2', async () => {
  const w = await promoteWorld({ status: 'Live', supporting: [1, 9] });
  const h = w.hooks();
  const r = await followup(h);
  assert.equal(r.exit, 2);
  assert.equal(assertReport(h, r).sentence, 'Follow-up: nothing was done, because a row this rule change rests on is not decided any more.');
});

test('followup: more than five rows show four and "and n more"', async () => {
  const supporting = [1, 2, 4, 5, 6, 7, 8];
  const w = await promoteWorld({
    status: 'Live', supporting, open: 3,
    base: Object.fromEntries(supporting.map((i) => [claimText(i), no])),
  });
  for (const i of [5, 6, 7]) w.fake.editRow(w.ids.queue[keyOf(i)], { 'Tag outcome': 'Does not apply', 'Why wrong': 'Rule unclear', 'Your reasoning': 'Rule 4.' });
  w.fake.addRow(w.DB.tag_decisions, { Claim: claimText(8), Key: keyOf(8), Tag: 'Context-dependent', 'Tag outcome': 'Does not apply', 'Why wrong': 'Rule unclear', 'Your reasoning': 'Rule 4.' });
  const h = w.hooks();
  const r = await followup(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Follow-up, repeated by hand: the agent now agrees with all 7 of your decisions.');
  assert.equal(report.rows.length, 5);
  assert.deepEqual(report.rows.at(-1), ['and 3 more', '3 Fixed', '']);
});

test('followup --plan-only writes a plan and nothing else; a paused agent stops it; a bad command line is refused', async () => {
  const w = await promoteWorld({ status: 'Live', base: { [claimText(1)]: no, [claimText(2)]: no } });
  const h = w.hooks({ planOnly: true });
  const r = await followup(h);
  assert.equal(r.exit, 0);
  assert.equal(w.writes().length, 0);
  assert.match(assertReport(h, r).sentence, /^Follow-up: the plan is ready \(2 Fixed, 0 Still wrong\) and nothing was written to Notion\.$/);

  w.setPaused(true);
  const p = await followup(w.hooks());
  assert.equal(p.exit, 3);
  assert.equal(p.report.sentence, 'Follow-up: nothing was done, because the agent is paused.');

  const io = { outs: [], errs: [], out: (s) => io.outs.push(s), err: (s) => io.errs.push(s) };
  assert.equal(await main(['--runs-max', '9'], io), 2);
  assert.equal(await main(['--nope'], io), 2);
  assert.equal(await main(['--help'], io), 0);
  assert.match(io.outs.join('\n'), /--lesson/);
});

test('followup: on a Reviewed claim Agent tags are the editor\'s set, and a row that still comes out wrong makes the status "Disagrees with your decision"', async () => {
  const w = await promoteWorld({ status: 'Live', base: { [claimText(1)]: no, [claimText(2)]: { decision: 'apply', p: 0.9 } } });
  w.review('c01', { tags: [], why: 'Rule unclear', notes: 'Rule 4 should let general references pass.' });
  w.review('c02', { tags: [], why: 'Rule unclear', notes: 'Rule 4 again: this reference is general too.' });
  w.editClaim('c02', { 'Agent tags': ['Context-dependent'], 'Agent status': 'Done', 'Agent edition': '2026-10-01.1' });
  const r = await followup(w.hooks());
  assert.equal(r.exit, 0);
  assert.equal(w.row('tag_decisions', keyOf(1))['Follow-up'], 'Fixed');
  assert.equal(w.row('tag_decisions', keyOf(2))['Follow-up'], 'Still wrong');
  const c01 = w.claim('c01');
  assert.deepEqual([c01['Agent tags'], c01['Agent status'], c01['Tags waiting'], c01['Agent edition'], c01['Agent remarks']], [[], 'Done', [], '2026-10-16.1', REMARK], 'the agent agrees with the editor');
  const c02 = w.claim('c02');
  assert.deepEqual([c02['Agent tags'], c02['Agent status'], c02['Tags waiting']], [[], 'Disagrees with your decision', []], 'the editor\'s set wins, and the status says where the agent differs');
  assert.deepEqual([c02['Review status'], c02['Why wrong'], c02['Challenged tags notes']], ['Reviewed', 'Rule unclear', 'Rule 4 again: this reference is general too.'], 'the editor\'s columns are as they were');
  const plan = readJsonl(join(r.runDir, 'plan.jsonl')).rows.slice(1);
  for (const op of plan.filter((o) => o.table === 'claims_copy')) assert.ok(Object.keys(op.properties).every((k) => WRITE_COLUMNS.includes(k)), 'only the agent\'s columns of the claim');
  for (const op of plan.filter((o) => o.table === 'tag_decisions')) assert.deepEqual(Object.keys(op.properties), ['Follow-up'], 'the only column of the ledger the follow-up writes');
});

test('followup: a claim that is not Reviewed keeps its other tags and takes the answer under the rule in force for the tag it checked again', async () => {
  const w = await promoteWorld({ status: 'Live', base: { [claimText(1)]: { decision: 'apply', p: 0.9 }, [claimText(2)]: wrong } });
  const r = await followup(w.hooks());
  assert.equal(r.exit, 0);
  assert.deepEqual([w.claim('c01')['Agent tags'], w.claim('c01')['Agent status']], [['Context-dependent'], 'Done'], 'the agent applies it now and nobody has Reviewed the claim');
  assert.deepEqual([w.claim('c02')['Agent tags'], w.claim('c02')['Tags waiting'], w.claim('c02')['Agent status']], [[], ['Context-dependent'], 'Waits for you'], 'an agent that cannot tell makes the claim wait');
});

test('followup rewrites the Agent reasons of the claims it checks again: the line of the tag under the rule now in force, in the form propose writes', async () => {
  const w = await promoteWorld({ status: 'Live', base: { [claimText(1)]: no, [claimText(2)]: no } });
  w.fake.editRow(w.ids.claim.c01, { 'Agent reasons': 'Context-dependent: An old reason. · 1 of 1 runs agree' });
  const r = await followup(w.hooks());
  assert.equal(r.exit, 0);
  const c01 = w.row('claims_copy', 'c01');
  assert.match(c01['Agent reasons'], /^Context-dependent: .+ · \d of \d runs agree$/);
  assert.doesNotMatch(c01['Agent reasons'], /An old reason/);
  assert.equal(c01['Agent reasons'].split('\n').length, 1, 'one line for the one tag');
  assert.match(w.row('claims_copy', 'c02')['Agent reasons'], /^Context-dependent: /, 'a claim that had none gets its line');
  const plan = readJsonl(join(r.runDir, 'plan.jsonl')).rows.slice(1);
  for (const op of plan.filter((o) => o.table === 'claims_copy')) assert.ok('Agent reasons' in op.properties);
  const again = await followup(w.hooks());
  assert.equal(again.exit, 0);
  assert.equal(readJsonl(join(again.runDir, 'plan.jsonl')).rows.filter((o) => o.table === 'claims_copy').length, 0, 'a second follow-up finds the columns as they should be');
});

test('followup writes Agent confidence for the claims it checks again, from the answers it has, so a claim it re-tags does not keep the confidence of its old answer', async () => {
  const w = await promoteWorld({ status: 'Live', base: { [claimText(1)]: { decision: 'apply', p: 0.85 }, [claimText(2)]: no } });
  // the tag step left these: c01 was sure of Does not apply at 0.75, c02 has no confidence
  w.editClaim('c01', { 'Agent tags': [], 'Agent status': 'Done', 'Agent edition': '2026-10-01.1', 'Agent confidence': 0.75 });
  const r = await followup(w.hooks());
  assert.equal(r.exit, 0);
  assert.equal(w.row('claims_copy', 'c01')['Agent confidence'], 0.85, 'the answer under the rule now in force is Applies at 0.85: max(p, 1 - p)');
  assert.deepEqual(w.claim('c01')['Agent tags'], ['Context-dependent'], 'and the tag it argues for');
  assert.equal(w.row('claims_copy', 'c02')['Agent confidence'], 0.9, 'a claim that had none gets it: Does not apply at p 0.1');
  const plan = readJsonl(join(r.runDir, 'plan.jsonl')).rows.slice(1).filter((o) => o.table === 'claims_copy');
  assert.equal(plan.find((o) => o.key === 'c01').properties['Agent confidence'], 0.85);
  // a second follow-up finds the columns as they should be
  const again = await followup(w.hooks());
  assert.equal(again.exit, 0);
  assert.equal(readJsonl(join(again.runDir, 'plan.jsonl')).rows.filter((o) => o.table === 'claims_copy').length, 0);
  // an answer that is not sure is a coin flip: 0.5 is written over the confidence the claim had
  const unsure = await promoteWorld({ status: 'Live', base: { [claimText(1)]: no, [claimText(2)]: wrong } });
  unsure.fake.editRow(unsure.ids.claim.c02, { 'Agent confidence': 0.9 });
  assert.equal((await followup(unsure.hooks())).exit, 0);
  assert.equal(unsure.row('claims_copy', 'c02')['Agent confidence'], 0.5);
});

test('followup: without a recorded view the Next line for rows that are still wrong links the Claims copy itself', async () => {
  const w = await promoteWorld({ status: 'Live', base: { [claimText(1)]: no, [claimText(2)]: wrong }, world: { configure: (c) => { delete c.notion.views.agent_disagreed; } } });
  const r = await followup(w.hooks());
  assert.equal(r.exit, 0);
  assert.equal(r.report.next, `Next: add a note in Challenged tags notes on the claims in Agent disagreed (https://www.notion.so/${w.DB.claims_copy}).`);
});

test('followup: on a claim marked To review the tag that was checked again waits, whatever the answer, and is not written to Agent tags', async () => {
  const w = await promoteWorld({ status: 'Live', base: { [claimText(1)]: { decision: 'apply', p: 0.9 }, [claimText(2)]: no } });
  w.editClaim('c01', { 'Review status': 'To review' });
  const r = await followup(w.hooks());
  assert.equal(r.exit, 0);
  assert.deepEqual([w.claim('c01')['Agent tags'], w.claim('c01')['Tags waiting'], w.claim('c01')['Agent status']], [[], ['Context-dependent'], 'Waits for you']);
  assert.deepEqual([w.claim('c02')['Tags waiting'], w.claim('c02')['Agent status']], [[], 'Done'], 'Review status empty and a sure answer: nothing waits');
});
