import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { resumeFor } from '../../agents/claim-tagger-mvp/scripts/lib/resume.mjs';
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
// the editor's columns: no write names one (Why wrong is the editor's on a claim and the agent's copy on the ledger, so a write to a claim is checked apart)
const forbiddenColumns = ['Claim quality tags — verified', 'Review status', 'Challenged tags notes', 'Editor wording', 'Paused'];
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

/** The editor decides two claims in Your queue: no tag, Rule unclear, with a note that names rule 4. */
function decideTwo(w) {
  for (const text of [U1, U2]) w.review(idOf(text), { tags: [], why: 'Rule unclear', notes: 'Rule 4 should let general references pass.' });
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
  assert.equal(w.rows('claims_copy').length, 50);
  assert.equal(w.rows('tag_decisions').length, 10, 'the audit decisions are seeded as decided ledger rows');
  assert.equal(w.rows('claims_copy').filter((c) => c['Review status'] === 'Reviewed').length, 10, 'and carried over to their claims');
  assert.equal(w.rows('agent_settings').length, 1);
  const auditBefore = w.rows('tag_decisions').map((r) => JSON.stringify(r)).sort();

  // tag: judge, then propose
  assert.equal((await w.judge()).exit, 0);
  const h1 = w.hooks();
  const tagged = await propose(h1);
  assert.equal(tagged.exit, 0, h1.io.errs.join('\n'));
  assert.equal(tagged.report.sentence, 'Tag: the agent read 50 claims for Context-dependent; 4 wait for you.');
  assert.equal(w.rows('tag_decisions').length, 50, 'a ledger row for every claim the agent judged');
  assert.deepEqual(w.rows('tag_decisions').filter((r) => !r['Tag outcome'] && r['Agent proposal'] === "Can't tell").map((r) => r.Key).sort(), [U1, U2, U3, U4].map(keyOf).sort(), 'every unsure cell waits in Your queue');
  assert.equal(w.rows('tag_decisions').filter((r) => r['Tag outcome']).length, 10, 'only the audit rows hold a decision');
  assert.deepEqual(w.rows('tag_decisions').filter((r) => r['Tag outcome']).map((r) => JSON.stringify(r)).sort(), auditBefore, 'the decided rows are untouched');
  assert.equal(w.row('claims_copy', idOf(A1))['Agent tags'], 'Context-dependent');
  assert.equal(w.row('claims_copy', idOf(U1))['Agent tags'], '');
  assert.match(w.row('claims_copy', idOf(U1))['Agent notes'], /^no tags\n1 waits for an editor · not checked: /);
  for (const c of w.rows('claims_copy')) assert.ok(c['Agent notes'].split('\n').length <= 2);
  const queueBefore = w.rows('tag_decisions').filter((r) => r['Tag outcome']).map((r) => JSON.stringify(r));
  assert.equal(w.row('claims_copy', idOf(U1))['Agent confidence'], 0.5);
  assert.equal(w.row('claims_copy', idOf(U1))['Agent reasons'], `Context-dependent: ${w.row('tag_decisions', keyOf(U1))['Agent reason']}`, 'the claim shows the reason the ledger holds');
  assert.match(w.row('claims_copy', idOf(U1))['Agent reasons'], /^Context-dependent: Two readings\. · 2 of 2 runs agree$/);
  assert.equal(w.row('claims_copy', idOf(A1))['Agent confidence'], 0.9);
  assert.equal(w.row('agent_settings', 'Claim tagger')['Last run summary'].startsWith('Tag · '), true);

  // the editor decides two claims in Your queue: Rule unclear, naming rule 4
  decideTwo(w);
  assert.equal(w.row('tag_decisions', keyOf(U1))['Tag outcome'], null, 'the ledger has no copy of the decision yet');

  // distill: copies the two decisions to the ledger, then drafts one lesson
  const h2 = w.hooks();
  const drafted = await distill(h2);
  assert.equal(drafted.exit, 0, h2.io.errs.join('\n'));
  assert.equal(drafted.report.sentence, 'Distill: one rule change drafted from your 2 notes.');
  for (const text of [U1, U2]) {
    const row = w.row('tag_decisions', keyOf(text));
    assert.deepEqual([row['Tag outcome'], row['Why wrong'], row['Your reasoning'], row['Decided under']], ['Does not apply', 'Rule unclear', 'Rule 4 should let general references pass.', '2026-10-16.1']);
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
    ['Your 2 rows', '2 of 2 now right, marked Fixed', ''],
  ]);
  assert.equal(passed.report.next, `Next: decide your two claims in Your queue (https://www.notion.so/${w.DB.claims_copy}?v=e3000000000000000000000000000001).`);
  assert.equal(w.row('rule_changes', TITLE).Status, 'Live');
  assert.equal(w.row('rule_changes', TITLE)['Safety check result'], 'PASS: examples 11/11, earlier 9/9, yours 2/2');
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'].split('\n')[3], `4. ${NEW_TEXT}`);
  assert.equal(w.rubric().edition, '2026-10-16.2');
  for (const text of [U1, U2]) assert.equal(w.row('tag_decisions', keyOf(text))['Follow-up'], 'Fixed');
  assert.deepEqual(w.rows('tag_decisions').filter((r) => r['Tag outcome'] && !/^From the audit/.test(r['Your reasoning'])).length, 2);
  for (const text of [U1, U2]) assert.match(w.row('claims_copy', idOf(text))['Agent notes'], /^no tags\nnothing waits for an editor · not checked/, 'the follow-up wrote the notes of the claim with the editor\'s set');
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
    if (req.method === 'PATCH' && claimPages.has(req.path.split('/').at(-1).replace(/-/g, ''))) assert.ok(!props.includes('Why wrong'), 'Why wrong on a claim is the editor\'s');
    if (req.method === 'POST') {
      assert.equal(req.path, '/pages');
      assert.ok(own.has(req.body.parent.database_id.replace(/-/g, '')), 'a row is created only in one of the five tables');
    }
    if (props.includes('Status')) assert.ok(['Proposed', 'Live', 'Rolled back'].includes(req.body.properties.Status.select.name), 'only the Status values the agent may write');
    // the claims table takes the three write columns and nothing else
    if (props.includes('Agent tags') || props.includes('Agent notes') || props.includes('Agent confidence') || props.includes('Agent reasons')) {
      if (claimPages.has(req.path.split('/').at(-1).replace(/-/g, ''))) assert.ok(props.every((p) => ['Agent tags', 'Agent notes', 'Agent confidence', 'Agent reasons'].includes(p)), props.join(','));
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

test('a run on a practice page records the line that continues it through the walkthrough runner, naming the page; a production run keeps the bare line', async () => {
  const id = '20261021-1237-c23118';
  const demo = await makeWorld({ claims: 4, demoId: id });
  const prod = await makeWorld({ claims: 4 });
  assert.ok(demo.root.endsWith(join('runs', 'demos', id)));
  const bare = 'node agents/claim-tagger-mvp/scripts';
  const runner = `${bare}/walkthrough.mjs run --demo ${id}`;
  const recorded = (r) => readJson(join(r.runDir, 'run.json')).resume;
  const cases = [
    ['status', (w) => status(w.hooks()), ''],
    ['propose', (w) => propose(w.hooks()), ' --driver fake'], // the world's scripts run on the fake CLI, and the line keeps the flag
    ['distill', (w) => distill(w.hooks()), ' --driver fake'],
    ['promote', (w) => promote(w.hooks({ lesson: 'A title with spaces' })), ' --lesson "A title with spaces" --driver fake'],
    ['followup', (w) => followup(w.hooks({ lesson: 'A title with spaces' })), ' --lesson "A title with spaces" --driver fake'],
  ];
  for (const [script, call, parts] of cases) {
    assert.equal(recorded(await call(demo)), `${runner} ${script}${parts}`, `${script} on a practice page`);
    assert.equal(recorded(await call(prod)), `${bare}/${script}.mjs${parts}`, `${script} in production`);
  }
  // the judge writes its own run.json: its line continues that run through the runner as well
  const judged = await demo.judge();
  assert.equal(readJson(join(judged.runDir, 'run.json')).resume, `${runner} judge --resume ${judged.runId}`);
  const judgedProd = await prod.judge();
  assert.equal(readJson(join(judgedProd.runDir, 'run.json')).resume, `${bare}/judge.mjs --resume ${judgedProd.runId}`);
});

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
