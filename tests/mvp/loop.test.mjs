import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeClaim } from '../../agents/claim-tagger-mvp/scripts/judge.mjs';
import { needClaimColumns, LoopExit } from '../../agents/claim-tagger-mvp/scripts/lib/loop.mjs';
import { readJson, readJsonl } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { resumeFor } from '../../agents/claim-tagger-mvp/scripts/lib/resume.mjs';
import { latestPullId, loadPull } from '../../agents/claim-tagger-mvp/scripts/pull.mjs';
import { AUDIT, PICK, makeWorld, taxonomyCanaries } from './helpers/loop-world.mjs';
import { TABLE_SPECS } from './helpers/tables.mjs';

// The loop scripts are loaded one at a time by the tests that run them (a script that is not ported to v2 yet fails its own tests, not the whole file).
const script = async (name) => import(`../../agents/claim-tagger-mvp/scripts/${name}.mjs`);
const propose = async (...args) => (await script('propose')).propose(...args);
const distill = async (...args) => (await script('distill')).distill(...args);
const promote = async (...args) => (await script('promote')).promote(...args);
const followup = async (...args) => (await script('followup')).followup(...args);
const rollback = async (...args) => (await script('rollback')).rollback(...args);
const restore = async (...args) => (await script('restore')).restore(...args);
const status = async (...args) => (await script('status')).status(...args);

// The whole loop on the fakes, as production has it: thirteen rulebook rows, the fifty claims of fixtures/claims-pick.50.json, the ten audit decisions as decided
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
// the editor's columns: no write names one (Claims has none on v2; Tag decisions has Agent is right, Tag outcome and Your note)
const forbiddenColumns = ['Agent is right', 'Tag outcome', 'Your note', 'Verified tags', 'Claim quality tags — verified', 'Agent notes', 'Review status', 'Challenged tags notes', 'Editor wording', 'Paused'];
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
  // the eight audit disagreements are read once by the model (decision 73); the fake reads them the way the audit decided: Agent slip
  w.readings(Object.fromEntries(AUDIT.decisions.map((d) => [`${d.geo_id}::Context-dependent`, { reading: 'Agent slip', rule: null, note: 'The audit found that the agent slipped.' }])));
  w.setEnv('FAKE_LOOP_DEFAULT', JSON.stringify(no));
  w.overrides([{ when: MARK, table: { [U1]: no, [U2]: no, ...(flipExample ? { [EXAMPLE_1]: no } : {}) } }]);
  w.distillReply({ patterns: [{ lesson: TITLE, kind: 'Clarify wording', proposed_text: NEW_TEXT, keys: 'all' }] });
  return w;
}

/** The editor decides two rows in Your queue: Does not apply, with a note that names rule 4 (the agent works the reason out; no reason word, P45). */
function decideTwo(w) {
  for (const text of [U1, U2]) w.decideRow(keyOf(text), { outcome: 'Does not apply', note: 'Rule 4 should let general references pass.' });
}

/** judge, propose, two claims decided by the editor, distill, approved by the editor. Returns the pages the editor touched. */
async function untilApproved(w) {
  assert.equal((await w.judge()).exit, 0);
  const tagged = await propose(w.hooks());
  assert.equal(tagged.exit, 0, tagged.markdown);
  decideTwo(w);
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
  assert.equal(w.rows('claims').length, 50);
  assert.equal(w.rows('tag_decisions').length, 10, 'the audit decisions are seeded as decided ledger rows');
  assert.equal(w.rows('tag_decisions').filter((r) => r['Open claim'].length === 1).length, 10, 'each joined to its claim');
  assert.equal(w.rows('agent_settings').length, 1);
  // what the tag step must leave as it is on a decided row: the editor's three columns and the record of the decision (the proposal columns move with the rulebook, PORT-V2 1.7)
  const decisionOf = (r) => JSON.stringify([r.Key, r['Agent is right'], r['Tag outcome'], r['Your note'], r['Decided under']]);
  const auditBefore = w.rows('tag_decisions').map(decisionOf).sort();

  // tag: judge, then propose
  assert.equal((await w.judge()).exit, 0);
  const h1 = w.hooks();
  const tagged = await propose(h1);
  assert.equal(tagged.exit, 0, h1.io.errs.join('\n'));
  assert.equal(tagged.report.sentence, 'Tag: the agent read 50 claims for Context-dependent; 4 wait for you.');
  assert.equal(w.rows('tag_decisions').length, 50, 'a ledger row for every claim the agent judged');
  assert.deepEqual(w.rows('tag_decisions').filter((r) => !r['Tag outcome'] && r['Agent proposal'] === "Can't tell").map((r) => r.Key).sort(), [U1, U2, U3, U4].map(keyOf).sort(), 'every unsure cell waits in Your queue');
  assert.equal(w.rows('tag_decisions').filter((r) => r['Tag outcome']).length, 10, 'only the audit rows hold a decision');
  assert.deepEqual(w.rows('tag_decisions').filter((r) => r['Tag outcome']).map(decisionOf).sort(), auditBefore, 'the decisions of the decided rows are untouched');
  assert.deepEqual(w.claim(idOf(A1))['Agent tags'], ['Context-dependent']);
  assert.deepEqual([w.claim(idOf(U1))['Agent tags'], w.claim(idOf(U1))['Tags waiting'], w.claim(idOf(U1))['Agent status']], [[], ['Context-dependent'], 'Waits for you']);
  assert.match(w.claim(idOf(U1))['Agent remarks'], /^not checked: /);
  for (const c of w.rows('claims')) assert.ok(!('Agent notes' in c), 'the table has no Agent notes');
  const queueBefore = w.rows('tag_decisions').filter((r) => r['Tag outcome']).map((r) => JSON.stringify(r));
  assert.equal(w.row('claims', idOf(U1))['Agent confidence'], 0.5);
  assert.equal(w.row('claims', idOf(U1))['Agent reasons'], `Context-dependent: ${w.row('tag_decisions', keyOf(U1))['Agent reason']}`, 'the claim shows the reason the ledger holds');
  assert.match(w.row('claims', idOf(U1))['Agent reasons'], /^Context-dependent: Two readings\. · 2 of 2 runs agree$/);
  assert.equal(w.row('claims', idOf(A1))['Agent confidence'], 0.9);
  assert.equal(w.row('agent_settings', 'Claim tagger')['Last run summary'].startsWith('Tag · '), true);

  // the editor decides two rows in Your queue, naming rule 4 in the note; the decision is in the editor's columns, not copied anywhere
  decideTwo(w);
  assert.equal(w.row('tag_decisions', keyOf(U1))['Decided under'], '', 'the agent has not recorded the decision yet');

  // distill: records the two decisions in Decided under, then drafts one lesson
  const h2 = w.hooks();
  const drafted = await distill(h2);
  assert.equal(drafted.exit, 0, h2.io.errs.join('\n'));
  assert.equal(drafted.report.sentence, 'Distill: read 10 of your decisions and drafted one rule change from 2 of them.', 'the eight audit disagreements and the two decisions are read once, by the model');
  assert.equal(drafted.report.rows[0][1], '10 decisions');
  assert.deepEqual(drafted.report.rows.slice(1, 4), [['Point at a rule', '2 decisions', ''], ['Agent slips', '8 decisions', ''], ['Without a note', 'none', '']], 'the audit says Agent slip for the eight, and so does the fake model: the comparison that decision 73 asks for');
  assert.equal(w.callsWith('# Reading').length, 2, 'two reading calls: the eight audit rows, and the two decisions of the editor (ten rows to a call would be one; the fake batches by the config)');
  for (const text of [U1, U2]) {
    const row = w.row('tag_decisions', keyOf(text));
    assert.deepEqual([row['Tag outcome'], row['Your note'], row['Decided under']], ['Does not apply', 'Rule 4 should let general references pass.', '2026-10-16.1'], 'the editor\'s columns are as the editor left them; the agent recorded the edition');
  }
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
    ['Your 2 rows', '2 of 2 now right, marked Fixed in After the rule change', ''],
  ]);
  assert.equal(passed.report.next, `Next: decide your two rows in Your queue (https://www.notion.so/${w.DB.tag_decisions}?v=e3000000000000000000000000000001).`);
  assert.equal(w.row('rule_changes', TITLE).Status, 'Live');
  assert.equal(w.row('rule_changes', TITLE)['Safety check result'], 'PASS: examples 11/11, earlier 9/9, yours 2/2');
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'].split('\n')[3], `4. ${NEW_TEXT}`);
  assert.equal(w.rubric().edition, '2026-10-16.2');
  for (const text of [U1, U2]) assert.equal(w.row('tag_decisions', keyOf(text))['After the rule change'], 'Fixed');
  assert.deepEqual(w.rows('tag_decisions').filter((r) => r['Tag outcome'] && !/^From the audit/.test(r['Your note'])).length, 2);
  for (const text of [U1, U2]) {
    assert.equal(w.row('tag_decisions', keyOf(text))['Agent status'], 'Done', 'the follow-up wrote the status of the row');
    const c = w.claim(idOf(text));
    assert.deepEqual([c['Agent tags'], c['Tags waiting'], c['Agent status']], [[], [], 'Done'], 'and the columns of the claim with the editor\'s decision');
    assert.match(c['Agent remarks'], /^not checked/);
  }
  // the audit rows were not touched but for the agent's own reading, made once: their proposal, their decision and their words are as the setup left them
  const readingColumns = ["Agent's view of your decision", 'Rule', 'Why the agent thinks so', 'Read under'];
  const withoutReading = (r) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !readingColumns.includes(k))));
  const auditRows = w.rows('tag_decisions').filter((r) => r['Tag outcome']).filter((r) => /^From the audit/.test(r['Your note']));
  assert.deepEqual(auditRows.map(withoutReading).sort(), queueBefore.map((s) => withoutReading(JSON.parse(s))).sort());
  assert.equal(auditRows.filter((r) => r["Agent's view of your decision"] === 'Agent slip').length, 8, 'the eight disagreements of the audit are read, once');
  assert.equal(auditRows.filter((r) => !r["Agent's view of your decision"]).length, 2, 'and the two the agent had right are not');

  // the next tag run: the claims are read under the new rulebook, the decided rows stay, the open rows follow the new answers
  assert.equal((await w.judge()).exit, 0);
  const again = await propose(w.hooks());
  assert.equal(again.exit, 0, again.markdown);
  assert.equal(again.report.sentence, 'Tag: the agent read 50 claims for Context-dependent; 2 wait for you.');
  assert.equal(w.row('tag_decisions', keyOf(U3))['Rulebook edition'], '2026-10-16.2');
  assert.equal(w.row('claims', idOf(U3))['Agent edition'], '2026-10-16.2');

  // status
  const h5 = w.hooks();
  const st = await status(h5);
  assert.equal(st.exit, 0);
  assert.equal(st.report.sentence, 'Status: nothing is paused; 2 rows wait for you.');
  assert.match(st.report.rows[0][1], /^13 tags, edition 2026-10-16\.2$/);
  // the promote changed the rules, but the eight readings belong to proposals made under the old edition and stay current until the agent proposes again (decision 66): nothing is to read
  assert.ok(!st.report.rows.some((r) => r[0] === 'Your decisions'), 'no Your decisions row after a promote alone');
  assert.deepEqual(st.report.rows[2], ['Lessons waiting', 'none', '']);
  assert.match(st.report.next, /^Next: decide your two rows in Your queue \(/, 'deciding comes before reading');

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
  assert.match(failed.report.sentence, /^Promote: FAIL, rule 4 is unchanged: the new wording turns ".*" to Does not apply; the right answer is Applies\.$/);
  const SENTENCE = 'A reference to one particular thing that the claim does not name, such as a title alone, still fails the test.';
  assert.match(failed.report.next, /^Next: in Lessons waiting \(.*\), paste the block above into Editor wording in place of what is there, or write all of rule 4 as you want it; then type \/claim-tagger promote again\.$/);
  assert.ok(failed.report.extra.startsWith(`Suggested sentence for rule 4:\n> ${SENTENCE}\n\nWhy: `), 'the suggestion: the sentence, then the reason');
  assert.ok(failed.report.extra.endsWith(`\`\`\`\n${NEW_TEXT}\n${SENTENCE}\n\`\`\``), 'the rule as it was tested, then the sentence on its own line: Editor wording is the whole rule');
  assert.ok(readFileSync(join(failed.runDir, 'card.md'), 'utf8').includes(`"${NEW_TEXT} ${SENTENCE}"`));
  for (const text of [U1, U2]) assert.equal(w.row('tag_decisions', keyOf(text))['After the rule change'], null);
  for (const req of w.writes()) assert.ok(!JSON.stringify(req.body ?? {}).includes('still fails the test'), 'the sentence is not sent to Notion');
  assert.equal(existsSync(join(w.root, 'runs', 'PROMOTING.json')), false);

  // the editor copies the block of the report into Editor wording as it stands (one sentence per line), the lesson is checked again as the one-line text and passes
  const block = /```\n([\s\S]*)\n```$/.exec(failed.report.extra)[1];
  const wording = `${NEW_TEXT} ${SENTENCE}`;
  assert.equal(block, `${NEW_TEXT}\n${SENTENCE}`);
  w.fake.editRow(w.row('rule_changes', TITLE).page_id, { 'Editor wording': block });
  w.overrides([{ when: 'still fails the test', table: { [U1]: no, [U2]: no } }]);
  const h2 = w.hooks();
  const passed = await promote(h2);
  assert.equal(passed.exit, 0, h2.io.errs.join('\n'));
  assert.equal(passed.report.sentence.startsWith('Promote: PASS, rule 4 now uses your approved wording (edition 2026-10-16.2)'), true);
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'].split('\n')[3], `4. ${wording}`);
  assert.equal(w.row('rule_changes', TITLE)['Editor wording'], block, 'the editor\'s field is as the editor left it');
  everyReportIsClean(w);
  await requestLogIsClean(w);
});

test('the column guard: tables that the setup build has not given the v2 columns stop every writing script with exit 2, a report that asks for the build, and no write; with the columns they run', async () => {
  const claimsWithout = (...names) => Object.fromEntries(Object.entries(TABLE_SPECS.claims).filter(([name]) => !names.includes(name)));
  const ledgerWithout = (...names) => Object.fromEntries(Object.entries(TABLE_SPECS.tag_decisions).filter(([name]) => !names.includes(name)));
  const labels = { propose: 'Tag', distill: 'Distill', promote: 'Promote', followup: 'Follow-up', status: 'Status' };
  const cases = [
    ['the Claims table lacks the view column', { claims: claimsWithout("Agent's view of your decision") }, /Claims: Agent's view of your decision \(missing\)/],
    ['Tag decisions lacks the three editor columns', { tag_decisions: ledgerWithout('Agent is right', 'Tag outcome', 'Your note') }, /Tag decisions: Agent is right \(missing\), Tag decisions: Tag outcome \(missing\), Tag decisions: Your note \(missing\)/],
    ['Tag decisions lacks Open claim and Decided under', { tag_decisions: ledgerWithout('Open claim', 'Decided under') }, /Tag decisions: Open claim \(missing\).*Tag decisions: Decided under \(missing\)/],
    ['Agent is right is text, not a checkbox: a wrong type is named', { tag_decisions: { ...TABLE_SPECS.tag_decisions, 'Agent is right': 'rich_text' } }, /Tag decisions: Agent is right \(rich_text, not checkbox\)/],
    ['Agent tags is text on the claims, not a relation', { claims: { ...TABLE_SPECS.claims, 'Agent tags': 'rich_text' } }, /Claims: Agent tags \(rich_text, not relation\)/],
  ];
  for (const [what, tableSpecs, pattern] of cases) {
    const w = await makeWorld({ claims: 6, tableSpecs });
    await w.pull();
    const ctx = { pull: loadPull(w.root, latestPullId(w.root), { config: w.config }), config: w.config, label: 'Tag' };
    let thrown = null;
    try {
      needClaimColumns(ctx);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof LoopExit, what);
    assert.equal(thrown.code, 2, what);
    assert.match(thrown.message, pattern, what);
    assert.match(thrown.message, /^the tables lack columns of the v2 layout: /, what);
    assert.equal(thrown.sentence, 'Tag: nothing was done, because the tables do not have the v2 columns yet.', what);
    assert.equal(thrown.next, 'Next: ask the engineer to run the setup build, then type the same command again.', what);
  }

  // with every column the check passes, on the world the other tests use
  const ok = await makeWorld({ claims: 3 });
  await ok.pull();
  assert.doesNotThrow(() => needClaimColumns({ pull: loadPull(ok.root, latestPullId(ok.root), { config: ok.config }), config: ok.config, label: 'Tag' }));
  // a pull that holds neither table has nothing to check
  assert.doesNotThrow(() => needClaimColumns({ pull: { schema: () => null }, config: ok.config, label: 'Tag' }));
});

test('every writing script stops on tables without the v2 columns, before any write or model call (needs the scripts ported to v2)', async () => {
  const tableSpecs = { tag_decisions: Object.fromEntries(Object.entries(TABLE_SPECS.tag_decisions).filter(([name]) => name !== 'Decided under')) };
  const labels = { propose: 'Tag', distill: 'Distill', promote: 'Promote', followup: 'Follow-up', status: 'Status' };
  const w = await makeWorld({ claims: 6, tableSpecs });
  const writes = w.writes().length;
  for (const [name, run] of Object.entries({ propose, distill, promote, followup, status })) {
    const h = w.hooks({ lesson: TITLE });
    const r = await run(h);
    assert.equal(r.exit, 2, name);
    assert.equal(r.report.sentence, `${labels[name]}: nothing was done, because the tables do not have the v2 columns yet.`, name);
    assert.match(h.io.errs.join('\n'), /Tag decisions: Decided under \(missing\)/, name);
  }
  assert.equal(w.writes().length, writes, 'nothing was written');
  assert.equal(w.calls().length, 0, 'nothing was asked');
  const ok = await makeWorld({ claims: 3 });
  assert.equal((await distill(ok.hooks())).exit, 0);
  assert.equal((await status(ok.hooks())).exit, 0);
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
  const claimPages = new Set(Object.values(w.ids.claim).map((id) => id.replace(/-/g, '')));
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
    // the claims table takes the eight write columns and nothing else
    const writeColumns = ['Agent tags', 'Agent confidence', 'Agent reasons', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks', "Agent's view of your decision"];
    if (props.some((p) => writeColumns.includes(p))) {
      if (claimPages.has(req.path.split('/').at(-1).replace(/-/g, ''))) assert.ok(props.every((p) => writeColumns.includes(p)), props.join(','));
    }
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

test('resumeFor rewrites only the bare line of one of the agent\'s scripts, and only for a folder directly under runs/demos', () => {
  const bare = 'node agents/claim-tagger-mvp/scripts/judge.mjs --resume 20261021T094229Z-judge';
  const page = join(tmpdir(), 'x', 'runs', 'demos', '20261021-1237-c23118');
  assert.equal(resumeFor(page, bare), 'node agents/claim-tagger-mvp/scripts/walkthrough.mjs run --demo 20261021-1237-c23118 judge --resume 20261021T094229Z-judge');
  assert.equal(resumeFor(`${page}/`, 'node agents/claim-tagger-mvp/scripts/status.mjs'), 'node agents/claim-tagger-mvp/scripts/walkthrough.mjs run --demo 20261021-1237-c23118 status');
  assert.equal(resumeFor(join(tmpdir(), 'x'), bare), bare, 'production');
  assert.equal(resumeFor(join(tmpdir(), 'x', 'runs', 'demos', 'a', 'b'), bare), bare, 'a folder below a practice page is not one');
  const wrapped = 'node agents/claim-tagger-mvp/scripts/walkthrough.mjs start --resume 20261021-1237-c23118';
  assert.equal(resumeFor(page, wrapped), wrapped, 'a line that already goes through the runner is left alone');
  assert.equal(resumeFor(page, 'something else'), 'something else');
  assert.equal(resumeFor(page, null), null);
});
