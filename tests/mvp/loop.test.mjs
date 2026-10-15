import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { distill } from '../../agents/claim-tagger-mvp/scripts/distill.mjs';
import { followup } from '../../agents/claim-tagger-mvp/scripts/followup.mjs';
import { normalizeClaim } from '../../agents/claim-tagger-mvp/scripts/judge.mjs';
import { promote } from '../../agents/claim-tagger-mvp/scripts/promote.mjs';
import { propose } from '../../agents/claim-tagger-mvp/scripts/propose.mjs';
import { restore } from '../../agents/claim-tagger-mvp/scripts/restore.mjs';
import { rollback } from '../../agents/claim-tagger-mvp/scripts/rollback.mjs';
import { status } from '../../agents/claim-tagger-mvp/scripts/status.mjs';
import { readJson, readJsonl } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { AUDIT, PICK, makeWorld, taxonomyCanaries } from './helpers/loop-world.mjs';

// The whole loop on the fakes, as production has it: thirteen rulebook rows, the fifty claims of setup/claims-pick.json, the ten audit decisions as decided
// rows, one settings row, the eleven examples. The fake CLI is sure about almost everything and unsure about four claims. judge and propose fill the queue,
// an editor (fake.editRow) decides two rows, distill drafts a lesson, the editor approves it, promote checks it and makes it live, follow-up marks the rows.

const NEW_TEXT = 'Test: a reference that reads as general needs no answer; every other definite reference must point at one specific thing.';
const MARK = 'every other definite reference must point at one specific thing';
const RULE4 = 'Test: could a reader who sees only this sentence say which specific thing each definite reference points at? If any answer is no, tag Context-dependent.';
const TITLE = 'General references need no answer';
const no = { decision: 'do_not_apply', p: 0.1 };
const yes = { decision: 'apply', p: 0.9 };
const randoms = PICK.rows.slice(10);
const [U1, U2, U3, U4, A1] = randoms.slice(0, 5).map((r) => normalizeClaim(r['Geo Name']));
const idOf = (text) => PICK.rows.find((r) => normalizeClaim(r['Geo Name']) === text)['Geo ID'];
const keyOf = (text) => `${idOf(text)}::Context-dependent`;
const forbiddenColumns = ['Tag outcome', 'Why wrong', 'Your reasoning', 'Editor wording', 'Paused'];
const EXAMPLE_1 = taxonomyCanaries()[0].claim;

/** The production-shaped world with the fake CLI's answers; `flipExample` makes the candidate answer an example wrongly. */
async function productionWorld({ flipExample = false, wrongBoth = true, configure } = {}) {
  const w = await makeWorld({ claims: 'pick', audit: true, configure });
  const table = {};
  for (const c of taxonomyCanaries()) table[c.claim] = c.expected === 'apply' ? yes : no;
  for (const d of AUDIT.decisions) table[normalizeClaim(d.claim)] = d.outcome === 'Applies' ? yes : no;
  if (wrongBoth) {
    const slip = AUDIT.decisions.find((d) => d.outcome === 'Does not apply');
    table[normalizeClaim(slip.claim)] = yes; // the agent is wrong about this earlier decision both before and after the change
  }
  table[U1] = { decision: 'ask_editor', p: 0.5, rule_ref: null, reason: 'Two readings.' };
  table[U2] = { decision: 'ask_editor', p: 0.5, rule_ref: null, reason: 'Two readings.' };
  table[U3] = [{ decision: 'do_not_apply', p: 0.45 }, { decision: 'apply', p: 0.55 }, { decision: 'apply', p: 0.65 }];
  table[U4] = { decision: 'apply', p: 0.6 };
  table[A1] = yes;
  w.table(table);
  w.setEnv('FAKE_LOOP_DEFAULT', JSON.stringify(no));
  w.overrides([{ when: MARK, table: { [U1]: no, [U2]: no, ...(flipExample ? { [EXAMPLE_1]: no } : {}) } }]);
  w.distillReply({ patterns: [{ lesson: TITLE, kind: 'Clarify wording', proposed_text: NEW_TEXT, keys: 'all' }] });
  return w;
}

/** judge, propose, two rows decided by the editor, distill, approved by the editor. Returns the pages the editor touched. */
async function untilApproved(w) {
  assert.equal((await w.judge()).exit, 0);
  const tagged = await propose(w.hooks());
  assert.equal(tagged.exit, 0, tagged.markdown);
  const decide = { 'Tag outcome': 'Does not apply', 'Why wrong': 'Rule unclear', 'Your reasoning': 'Rule 4 should let general references pass.' };
  w.fake.editRow(w.row('tag_decisions', keyOf(U1)).page_id, decide);
  w.fake.editRow(w.row('tag_decisions', keyOf(U2)).page_id, decide);
  const drafted = await distill(w.hooks());
  assert.equal(drafted.exit, 0, drafted.markdown);
  const lesson = w.row('rule_changes', TITLE);
  w.fake.editRow(lesson.page_id, { Status: 'Approved' });
  return { tagged, drafted, lessonPage: lesson.page_id };
}

const SCRIPTS = (w, edition) => [
  ['propose', () => propose(w.hooks())],
  ['distill', () => distill(w.hooks())],
  ['promote', () => promote(w.hooks({ lesson: TITLE }))],
  ['followup', () => followup(w.hooks({ lesson: TITLE }))],
  ['rollback', () => rollback(w.hooks({ lesson: TITLE, confirm: true }))],
  ['restore', () => restore(w.hooks({ edition, confirm: true }))],
  ['status', () => status(w.hooks())],
];

function everyReportIsClean(w) {
  const runs = join(w.root, 'runs');
  const reports = readdirSync(runs, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(runs, d.name, 'report.md')));
  assert.ok(reports.length > 0);
  for (const d of reports) {
    const md = readFileSync(join(runs, d.name, 'report.md'), 'utf8');
    assert.deepEqual(lintReport(md), [], `${d.name}\n${md}`);
    const json = readJson(join(runs, d.name, 'report.json'));
    assert.ok(md.trimEnd().endsWith(json.next));
  }
}

test('the whole loop: judge and propose fill the queue, an editor decides two rows, distill drafts a lesson, the editor approves it, promote makes it live and marks both rows Fixed', async () => {
  const w = await productionWorld();
  assert.equal(w.rows('rulebook').length, 13);
  assert.equal(w.rows('claims_copy').length, 50);
  assert.equal(w.rows('tag_decisions').length, 10, 'the audit decisions are seeded as decided rows');
  assert.equal(w.rows('agent_settings').length, 1);

  // tag: judge, then propose
  assert.equal((await w.judge()).exit, 0);
  const h1 = w.hooks();
  const tagged = await propose(h1);
  assert.equal(tagged.exit, 0, h1.io.errs.join('\n'));
  assert.equal(tagged.report.sentence, 'Tag: the agent read 50 claims for Context-dependent; 4 wait for you.');
  assert.deepEqual(w.rows('tag_decisions').filter((r) => !r['Tag outcome']).map((r) => r.Key).sort(), [U1, U2, U3, U4].map(keyOf).sort(), 'every unsure cell has a row and no confident one does');
  assert.equal(w.rows('tag_decisions').filter((r) => r['Tag outcome']).length, 10, 'the decided rows are untouched');
  assert.equal(w.row('claims_copy', idOf(A1))['Agent tags'], 'Context-dependent');
  assert.equal(w.row('claims_copy', idOf(U1))['Agent tags'], '');
  assert.match(w.row('claims_copy', idOf(U1))['Agent notes'], /^no tags\n1 waits for an editor · not checked: /);
  for (const c of w.rows('claims_copy')) assert.ok(c['Agent notes'].split('\n').length <= 2);
  const queueBefore = w.rows('tag_decisions').filter((r) => r['Tag outcome']).map((r) => JSON.stringify(r));
  assert.equal(w.row('agent_settings', 'Claim tagger')['Last run summary'].startsWith('Tag · '), true);

  // the editor decides two rows: Rule unclear, naming rule 4
  const decide = { 'Tag outcome': 'Does not apply', 'Why wrong': 'Rule unclear', 'Your reasoning': 'Rule 4 should let general references pass.' };
  w.fake.editRow(w.row('tag_decisions', keyOf(U1)).page_id, decide);
  w.fake.editRow(w.row('tag_decisions', keyOf(U2)).page_id, decide);

  // distill: one lesson
  const h2 = w.hooks();
  const drafted = await distill(h2);
  assert.equal(drafted.exit, 0, h2.io.errs.join('\n'));
  assert.equal(drafted.report.sentence, 'Distill: one rule change drafted from your 2 notes.');
  const lesson = w.row('rule_changes', TITLE);
  assert.deepEqual([lesson.Status, lesson.Rule, lesson['Current text'], lesson['Proposed text']], ['Proposed', 'Context-dependent rule 4', RULE4, NEW_TEXT]);
  assert.equal(lesson['Supporting rows'].split('\n').length, 2);
  assert.equal(w.row('agent_settings', 'Claim tagger')['Last run summary'].startsWith('Distill · '), true);

  // the editor approves it; promote checks it and makes it live; follow-up runs inside
  w.fake.editRow(lesson.page_id, { Status: 'Approved' });
  const h3 = w.hooks();
  const passed = await promote(h3);
  assert.equal(passed.exit, 0, h3.io.errs.join('\n'));
  assert.equal(passed.report.sentence, 'Promote: PASS, rule 4 now uses the new wording (edition 2026-10-16.2), and the follow-up marked both of your rows Fixed.');
  assert.deepEqual(passed.report.rows, [
    ['Example claims', '11 of 11 right', ''],
    ['Earlier decisions', '9 of 9 still right', ''],
    ['Your 2 rows', '2 of 2 now right, marked Fixed', ''],
  ]);
  assert.equal(passed.report.next, `Next: decide the remaining 2 rows in Your queue (https://www.notion.so/${w.DB.tag_decisions}?v=e3000000000000000000000000000001).`);
  assert.equal(w.row('rule_changes', TITLE).Status, 'Live');
  assert.equal(w.row('rule_changes', TITLE)['Safety check result'], 'PASS: examples 11/11, earlier 9/9, yours 2/2');
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'].split('\n')[3], `4. ${NEW_TEXT}`);
  assert.equal(w.rubric().edition, '2026-10-16.2');
  for (const text of [U1, U2]) assert.equal(w.row('tag_decisions', keyOf(text))['Follow-up'], 'Fixed');
  assert.deepEqual(w.rows('tag_decisions').filter((r) => r['Tag outcome'] && !/^From the audit/.test(r['Your reasoning'])).length, 2);
  // the audit rows were not touched at all
  assert.deepEqual(w.rows('tag_decisions').filter((r) => r['Tag outcome']).filter((r) => /^From the audit/.test(r['Your reasoning'])).map((r) => JSON.stringify(r)).sort(), queueBefore.sort());

  // the next tag run: the claims are read under the new rulebook, the decided rows stay, the open rows follow the new answers
  assert.equal((await w.judge()).exit, 0);
  const again = await propose(w.hooks());
  assert.equal(again.exit, 0, again.markdown);
  assert.equal(again.report.sentence, 'Tag: the agent read 50 claims for Context-dependent; 2 wait for you.');
  assert.equal(w.row('tag_decisions', keyOf(U3))['Rulebook edition'], '2026-10-16.2');
  assert.equal(w.row('claims_copy', idOf(U3))['Agent notes'].endsWith('edition 2026-10-16.2'), true);

  // status
  const h5 = w.hooks();
  const st = await status(h5);
  assert.equal(st.exit, 0);
  assert.equal(st.report.sentence, 'Status: nothing is paused; 2 rows and 0 rule changes wait for you.'.replace('2 rows and 0 rule changes wait', '2 rows wait'));
  assert.match(st.report.rows[0][1], /^13 tags, edition 2026-10-16\.2$/);
  assert.match(st.report.rows[2][1], /^none$/);

  // rollback and restore
  const rb = await rollback(w.hooks({ lesson: TITLE, confirm: true }));
  assert.equal(rb.exit, 0);
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'].split('\n')[3], `4. ${RULE4}`);
  assert.equal(w.row('rule_changes', TITLE).Status, 'Rolled back');
  assert.equal(w.rubric().edition, '2026-10-16.3');
  const back = await restore(w.hooks({ edition: '2026-10-16.2', confirm: true }));
  assert.equal(back.exit, 0);
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'].split('\n')[3], `4. ${NEW_TEXT}`);
  assert.equal(w.rubric().edition, '2026-10-16.4');
  assert.equal(w.row('agent_settings', 'Claim tagger')['Rulebook edition'], '2026-10-16.4');
  assert.deepEqual(readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8').trim().split('\n').map((l) => l.split(' · ').slice(1).join(' · ')), [
    'edition 2026-10-16.1 · the first edition of the test world',
    `edition 2026-10-16.2 · lesson ${TITLE} PASS`,
    `edition 2026-10-16.3 · rolled back ${TITLE}`,
    'edition 2026-10-16.4 · restored from 2026-10-16.2',
  ]);

  everyReportIsClean(w);
  await requestLogIsClean(w);
});

test('the FAIL branch: a candidate that turns an example claim the wrong way leaves the rulebook alone, gives the editor the whole text for Editor wording, and the rows are not marked', async () => {
  const w = await productionWorld({ flipExample: true });
  await untilApproved(w);
  const rulebookBefore = w.row('rulebook', 'Context-dependent')['When to use'];
  const h = w.hooks();
  const failed = await promote(h);
  assert.equal(failed.exit, 11, h.io.errs.join('\n'));
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'], rulebookBefore);
  assert.equal(w.rubric().edition, '2026-10-16.1');
  assert.equal(w.row('rule_changes', TITLE).Status, 'Approved');
  assert.match(w.row('rule_changes', TITLE)['Safety check result'], /^FAIL: '.*' now Does not apply$/);
  assert.equal(w.row('rule_changes', TITLE)['Editor wording'], '', 'the agent never writes Editor wording');
  assert.match(failed.report.sentence, /^Promote: FAIL, rule 4 is unchanged: the new wording turns ".*" to Does not apply\.$/);
  const SENTENCE = 'A reference to one particular thing that the claim does not name, such as a title alone, still fails the test.';
  assert.match(failed.report.next, /^Next: in Lessons waiting \(.*\), open the change and put this whole text into Editor wording: ".*"; then type \/claim-tagger promote again\.$/);
  assert.ok(failed.report.next.includes(`"${NEW_TEXT} ${SENTENCE}"`), 'the rule as it was tested, a space, the sentence: Editor wording is the whole rule');
  assert.ok(readFileSync(join(failed.runDir, 'card.md'), 'utf8').includes(`"${NEW_TEXT} ${SENTENCE}"`));
  for (const text of [U1, U2]) assert.equal(w.row('tag_decisions', keyOf(text))['Follow-up'], null);
  for (const req of w.writes()) assert.ok(!JSON.stringify(req.body ?? {}).includes('still fails the test'), 'the sentence is not sent to Notion');
  assert.equal(existsSync(join(w.root, 'runs', 'PROMOTING.json')), false);

  // the editor puts the whole text of the report into Editor wording, the lesson is checked again and passes
  const wording = /put this whole text into Editor wording: "(.*)"; then type/.exec(failed.report.next)[1];
  assert.equal(wording, `${NEW_TEXT} ${SENTENCE}`);
  w.fake.editRow(w.row('rule_changes', TITLE).page_id, { 'Editor wording': wording });
  w.overrides([{ when: 'still fails the test', table: { [U1]: no, [U2]: no } }]);
  const h2 = w.hooks();
  const passed = await promote(h2);
  assert.equal(passed.exit, 0, h2.io.errs.join('\n'));
  assert.equal(passed.report.sentence.startsWith('Promote: PASS, rule 4 now uses your approved wording (edition 2026-10-16.2)'), true);
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'].split('\n')[3], `4. ${wording}`);
  assert.equal(w.row('rule_changes', TITLE)['Editor wording'], wording);
  everyReportIsClean(w);
  await requestLogIsClean(w);
});

test('with runs/PAUSED on disk every script exits 3 and writes nothing', async () => {
  const w = await productionWorld();
  await untilApproved(w);
  w.write('runs/PAUSED', 'paused by hand\n');
  const writes = w.writes().length;
  for (const [name, run] of SCRIPTS(w, '2026-10-16.1')) {
    const r = await run();
    assert.equal(r.exit, 3, name);
    assert.match(r.report.sentence, /nothing was done, because the agent is paused\.$/, name);
  }
  assert.equal(w.writes().length, writes);
  everyReportIsClean(w);
});

test('with Paused ticked in Agent settings every script exits 3, and the Next line points at the box', async () => {
  const w = await productionWorld();
  await untilApproved(w);
  w.setPaused(true);
  for (const [name, run] of SCRIPTS(w, '2026-10-16.1')) {
    const r = await run();
    assert.equal(r.exit, 3, name);
    assert.match(r.report.next, /^Next: untick Paused in Agent settings \(https:\/\/www\.notion\.so\//, name);
  }
});

test('an edited judged tag in Notion stops every script with exit 4, and restore clears it so that the next command runs', async () => {
  const w = await productionWorld();
  await untilApproved(w);
  const locked = w.row('rulebook', 'Context-dependent')['When to use'];
  w.fake.editRow(w.ids.tag['Context-dependent'], { 'When to use': locked.replace('1. A pronoun', '1. Any pronoun') });
  const writes = w.writes().length;
  for (const [name, run] of SCRIPTS(w, '2026-10-16.1').filter(([n]) => n !== 'restore')) {
    const r = await run();
    assert.equal(r.exit, 4, name);
    assert.match(r.report.sentence, /\(Context-dependent: When to use\)\.$/, name);
  }
  assert.equal(w.writes().length, writes, 'a stopped script wrote nothing');

  const fixed = await restore(w.hooks({ edition: '2026-10-16.1', confirm: true }));
  assert.equal(fixed.exit, 0, fixed.markdown);
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'], locked);
  assert.equal((await status(w.hooks())).exit, 0);
  assert.equal((await promote(w.hooks({ lesson: TITLE }))).exit, 0, 'and the lesson can be promoted after the restore');
  everyReportIsClean(w);
  await requestLogIsClean(w);
});

async function requestLogIsClean(w) {
  const protectedIds = [...w.config.notion.protected_database_ids, ...w.config.notion.protected_page_ids].map((id) => id.replace(/-/g, ''));
  const own = new Set(Object.values(w.DB));
  for (const req of w.requests()) {
    const text = JSON.stringify(req).replace(/-/g, '');
    for (const id of protectedIds) assert.ok(!text.includes(id), `a request names the protected id ${id}`);
  }
  for (const req of w.writes()) {
    assert.ok(['POST', 'PATCH'].includes(req.method), `${req.method} ${req.path}`);
    assert.ok(req.status === 200, `${req.method} ${req.path} -> ${req.status}`);
    const props = Object.keys(req.body?.properties ?? {});
    for (const col of forbiddenColumns) assert.ok(!props.includes(col), `${col} is an editor column`);
    if (req.method === 'POST') {
      assert.equal(req.path, '/pages');
      assert.ok(own.has(req.body.parent.database_id.replace(/-/g, '')), 'a row is created only in one of the five tables');
    }
    if (props.includes('Status')) assert.ok(['Proposed', 'Live', 'Rolled back'].includes(req.body.properties.Status.select.name), 'only the Status values the agent may write');
    // the claims table takes the two write columns and nothing else
    if (props.includes('Agent tags') || props.includes('Agent notes')) assert.ok(props.every((p) => p === 'Agent tags' || p === 'Agent notes'), props.join(','));
  }
  // every run folder has its run.json written first and last
  const runs = join(w.root, 'runs');
  for (const d of readdirSync(runs, { withFileTypes: true }).filter((x) => x.isDirectory() && existsSync(join(runs, x.name, 'run.json')))) {
    const run = readJson(join(runs, d.name, 'run.json'));
    assert.ok(run.started_at, d.name);
    assert.ok(run.finished_at !== null && run.exit_code !== null, `${d.name} was finished`);
  }
  // the ledgers of the plans: every write was read back
  for (const d of readdirSync(runs, { withFileTypes: true }).filter((x) => x.isDirectory() && existsSync(join(runs, x.name, 'ledger.jsonl')))) {
    for (const line of readJsonl(join(runs, d.name, 'ledger.jsonl')).rows) assert.ok(line.read_back === 'ok' || line.status === 'skipped', `${d.name}: ${JSON.stringify(line)}`);
  }
}
