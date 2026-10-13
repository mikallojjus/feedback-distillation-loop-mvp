import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main as applyMain } from '../agents/claim-tagger/scripts/apply.mjs';
import { main as judgeMain } from '../agents/claim-tagger/scripts/judge.mjs';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { readJson, readJsonl } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { composeWhenToUse } from '../agents/claim-tagger/scripts/lib/rubric-build.mjs';
import { check as planCheck, openPlan, readPlan } from '../agents/claim-tagger/scripts/plan.mjs';
import {
  STAGES, checkVerdict, inspect, lockState, main, preflight, restorableDrift, runProgress, tagRuleVersion,
} from '../agents/claim-tagger/scripts/status.mjs';
import { makeJudgeStub } from './fixtures/loop/judge-stub.mjs';
import { cleanupLoop, makeLoopWorld, makeMiniWorld, captureIo, liveRubric } from './fixtures/loop/world.mjs';

after(() => cleanupLoop());

const run = (w, argv, extra = {}) => {
  const c = captureIo();
  const code = main(argv, c.io, { root: w.root, now: w.clock.now, ...extra });
  return { code, out: c.out, err: c.err };
};
const rootFile = (w, ...parts) => join(w.root, ...parts);
const writeRunJson = (w, id, meta) => {
  mkdirSync(rootFile(w, 'runs', id), { recursive: true });
  writeFileSync(rootFile(w, 'runs', id, 'run.json'), JSON.stringify(meta, null, 2));
};

// ---- --check ---------------------------------------------------------------------------------------------------------------------------

test('check: a clean seeded world passes with one line and exit 0', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  const r = run(w, ['--check']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^status: ok - rubric 2026-10-13\.1 \(lock ok\), not paused, no promote in flight, pull p1 is /);
  assert.deepEqual(r.err, []);
});

test('check: without a pull the local checks run and the missing ones are reported, not skipped', () => {
  const w = makeLoopWorld({ seed: false });
  const r = run(w, ['--check']);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out[0], /no pull: Paused in Notion and drift not checked/);
});

test('check: the PAUSED file gives exit 3 and names the changed field with its before and after values', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  const change = { page_id: 'pg-1', db: 'tag_decisions', key: 'abc::Predictive', field: 'Tag outcome', before: null, after: 'Applies' };
  writeFileSync(rootFile(w, 'runs', 'PAUSED'), JSON.stringify({ run_id: 'r7', page_id: 'pg-1', field: 'Tag outcome', before: null, after: 'Applies', detected_at: '2026-10-13T12:00:00.000Z', changes: [change] }));
  const r = run(w, ['--check']);
  assert.equal(r.code, EXIT.PAUSED);
  assert.match(r.out[0], /^status: PAUSED - runs\/PAUSED exists: tag_decisions "abc::Predictive" Tag outcome: before null, after "Applies" during run r7/);
  assert.match(r.err.join('\n'), /agent is paused/);
  const report = run(w, []);
  assert.equal(report.code, EXIT.OK, 'the report itself is not a check');
  assert.match(report.out[0], /PAUSED: runs\/PAUSED exists: tag_decisions "abc::Predictive" Tag outcome/);
});

test('check: a PAUSED file that is not JSON (a person wrote it) still pauses', () => {
  const w = makeLoopWorld({ seed: false });
  writeFileSync(rootFile(w, 'runs', 'PAUSED'), 'stop: looking at the Predictive rows\n');
  const r = run(w, ['--check']);
  assert.equal(r.code, EXIT.PAUSED);
  assert.match(r.out[0], /stop: looking at the Predictive rows/);
});

test('check: Paused ticked in Agent settings gives exit 3 with the reason', async () => {
  const w = makeLoopWorld();
  w.fake.editorSet(w.ids.settings, { Paused: true, Reason: 'trust drill' });
  await w.pull('p1');
  const r = run(w, ['--check']);
  assert.equal(r.code, EXIT.PAUSED);
  assert.match(r.out[0], /Paused is ticked in Agent settings \(trust drill\)/);
});

test('check: a rubric.json that does not match rubric.lock gives exit 4', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  const rubric = readJson(rootFile(w, 'rubric', 'rubric.json'));
  // the same content, written differently: the hashes agree, the file does not match the lock any more
  writeFileSync(rootFile(w, 'rubric', 'rubric.json'), JSON.stringify(rubric));
  let r = run(w, ['--check']);
  assert.equal(r.code, EXIT.DRIFT);
  assert.match(r.out[0], /^status: DRIFT - the rubric does not match its lock: rubric\.json was changed after it was locked/);
  // an edited rule without new hashes
  rubric.tags[0].when_to_use.rules[0].text = 'Edited by hand.';
  writeFileSync(rootFile(w, 'rubric', 'rubric.json'), JSON.stringify(rubric, null, 2));
  r = run(w, ['--check']);
  assert.equal(r.code, EXIT.DRIFT);
  assert.match(r.out[0], /stored hashes do not match its content/);
  const lock = lockState(w.root);
  assert.equal(lock.ok, false);
  assert.ok(lock.mismatches.length >= 2);
});

test('check: a missing rubric.lock is a mismatch too', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  writeFileSync(rootFile(w, 'rubric', 'rubric.lock'), 'not json');
  assert.equal(run(w, ['--check']).code, EXIT.DRIFT);
  assert.deepEqual(lockState(w.root).mismatches.filter((m) => /rubric\.lock/.test(m)), ['rubric.lock is not valid JSON']);
});

test('check: the Rulebook edited in Notion is drift (exit 4) and the report lists the differing rule', async () => {
  const w = makeLoopWorld();
  w.fake.editorSet(w.ids.rulebook.Predictive, { 'When to use': '1. Edited in Notion by somebody.' });
  await w.pull('p1');
  const r = run(w, ['--check']);
  assert.equal(r.code, EXIT.DRIFT);
  assert.match(r.out[0], /^status: DRIFT - the Rulebook in Notion differs from rubric\.json in \d+ place\(s\), first: Predictive /);
  const report = run(w, []).out[0];
  assert.match(report, /Rulebook drift: \d+ difference\(s\)/);
  assert.match(report, /- Predictive rule 1/);
});

test('check: a promote in flight gives exit 2, and the more serious states win: paused over drift over promoting', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  writeFileSync(rootFile(w, 'runs', 'PROMOTING.json'), JSON.stringify({ run_id: 'pr9', lesson: 'x', version: '2026-10-13.2' }));
  let r = run(w, ['--check']);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.out[0], /^status: PROMOTING - run pr9 is waiting for apply\.mjs and promote\.mjs --finalize/);
  writeFileSync(rootFile(w, 'rubric', 'rubric.lock'), '{}');
  assert.equal(run(w, ['--check']).code, EXIT.DRIFT);
  writeFileSync(rootFile(w, 'runs', 'PAUSED'), '{}');
  assert.equal(run(w, ['--check']).code, EXIT.PAUSED);
});

test('preflight and checkVerdict: ignore lists leave single checks out', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  writeFileSync(rootFile(w, 'runs', 'PROMOTING.json'), JSON.stringify({ run_id: 'pr9' }));
  assert.equal(preflight({ root: w.root, now: w.clock.now }).code, EXIT.INVALID);
  const ok = preflight({ root: w.root, now: w.clock.now, ignore: ['promoting'] });
  assert.equal(ok.code, EXIT.OK);
  assert.equal(ok.message, '');
  const state = inspect({ root: w.root, now: w.clock.now });
  assert.equal(checkVerdict(state, { ignore: ['promoting'] }).code, EXIT.OK);
  assert.equal(checkVerdict({ ...state, rubric: { ...state.rubric, ok: false, mismatches: ['x'] } }, { ignore: ['promoting'] }).code, EXIT.DRIFT);
  assert.equal(checkVerdict({ ...state, rubric: { ...state.rubric, ok: false, mismatches: ['x'] } }, { ignore: ['promoting', 'lock'] }).code, EXIT.OK);
});

// ---- the report ------------------------------------------------------------------------------------------------------------------------

test('report: stages, Needs-your-note, lessons by status, the last three run cards, cost', async () => {
  const w = makeMiniWorld({
    rows: [
      { id: 'a1', claim: 'Open row', tag: 'Predictive' },
      { id: 'a2', claim: 'Decided row', tag: 'Hypothetical', outcome: 'Applies' },
      { id: 'a3', claim: 'Rule unclear, no note', tag: 'Predictive', outcome: 'Does not apply', why: 'Rule unclear' },
      { id: 'a4', claim: 'Other, no note', tag: 'Predictive', outcome: 'Does not apply', why: 'Other' },
      { id: 'a5', claim: 'Rule should change, with note', tag: 'Predictive', outcome: 'Does not apply', why: 'Rule should change', reasoning: 'Because.' },
      { id: 'a6', claim: 'No tag fits, no note', tag: 'Debate', outcome: 'Applies', why: 'No tag fits' },
      { id: 'a7', claim: 'Agent slip needs no note', tag: 'Debate', outcome: 'Applies', why: 'Agent slip' },
    ],
  });
  w.lesson({ title: 'Lesson one', tag: 'Predictive', status: 'Proposed' });
  w.lesson({ title: 'Lesson two', tag: 'Predictive', status: 'Live', rubricVersion: '2026-10-13.2' });
  w.lesson({ title: 'Lesson three', tag: 'Debate', status: 'Rejected' });
  const runRow = (title, started, verdict, cost) => w.fake.add('runs', { 'Run title': title, Kind: 'Gate', Started: started, Verdict: verdict, 'Cost USD': cost });
  runRow('Gate old', '2026-10-10T09:00:00.000Z', 'PASS', 1.5);
  runRow('Gate second', '2026-10-11T09:00:00.000Z', 'HOLD', 0.75);
  runRow('Gate third', '2026-10-12T09:00:00.000Z', 'FAIL', 0.25);
  runRow('Gate newest', '2026-10-13T09:00:00.000Z', 'PASS', 2);
  await w.pull('p1');
  writeRunJson(w, 'j-1', { run_id: 'j-1', kind: 'judge', status: 'done', cost_usd: 0.5 });
  writeRunJson(w, 'j-2', { run_id: 'j-2', kind: 'judge', status: 'done', cost_usd: 0.25 });
  writeRunJson(w, 'other', { run_id: 'other', kind: 'promote' }); // no cost: not counted

  const state = inspect({ root: w.root, now: w.clock.now });
  assert.deepEqual(Object.keys(state.queue.by_stage), STAGES);
  assert.equal(state.queue.total, 7);
  assert.equal(state.queue.by_stage['To review'], 1);
  assert.equal(state.queue.by_stage.Decided, 6, 'the fake Notion computes only To review and Decided');
  assert.equal(state.queue.needs_your_note, 3, 'Rule unclear, Other and No tag fits without a sentence; Agent slip and a filled note do not count');
  assert.deepEqual(state.lessons.by_status, { Proposed: 1, Approved: 0, Rejected: 1, Live: 1, 'Rolled back': 0 });
  assert.deepEqual(state.recent_runs.map((r) => [r.title, r.verdict, r.cost_usd]), [['Gate newest', 'PASS', 2], ['Gate third', 'FAIL', 0.25], ['Gate second', 'HOLD', 0.75]]);
  assert.deepEqual(state.cost, { total_usd: 0.75, runs_counted: 2 });

  const text = run(w, []).out[0];
  assert.match(text, /^claim-tagger status \(pull p1, /);
  assert.match(text, /Rubric: 2026-10-13\.1 sha256:63f085c84a038df8 \(14 tags, 12 judged\); lock ok/);
  assert.match(text, /Rulebook drift: none/);
  assert.match(text, /Paused: no/);
  assert.match(text, /Queue: 7 rows; To review 1, Waiting for evidence 0, Second opinion 0, Lesson proposed 0, Regression case 0, Decided 6, Closed 0; Needs your note 3/);
  assert.match(text, /Lessons: 3; Proposed 1, Approved 0, Rejected 1, Live 1, Rolled back 0/);
  assert.match(text, /- Gate newest \| PASS \| \$2\.00\n  - Gate third \| FAIL \| \$0\.25\n  - Gate second \| HOLD \| \$0\.75/);
  assert.match(text, /Unfinished: nothing/);
  assert.match(text, /Cost so far: \$0\.7500 over 2 recorded run\(s\)/);

  const json = JSON.parse(run(w, ['--json']).out[0]);
  assert.equal(json.queue.needs_your_note, 3);
  assert.equal(json.check.code, 0);
  assert.equal(json.rubric.version, '2026-10-13.1');
});

test('report: every stage is counted, also the ones the fake Notion does not compute', async () => {
  const w = makeMiniWorld({ rows: [{ id: 'a1', claim: 'One', tag: 'Predictive' }, { id: 'a2', claim: 'Two', tag: 'Predictive' }] });
  await w.pull('p1');
  const file = join(w.root, 'runs', 'pull', 'p1', 'norm', 'queue.jsonl');
  const rows = readJsonl(file).rows;
  const stages = ['Waiting for evidence', 'Second opinion'];
  writeFileSync(file, `${rows.map((r, i) => JSON.stringify({ ...r, stage: stages[i] })).join('\n')}\n`);
  const q = inspect({ root: w.root, now: w.clock.now }).queue;
  assert.equal(q.by_stage['Waiting for evidence'], 1);
  assert.equal(q.by_stage['Second opinion'], 1);
  assert.equal(q.by_stage['To review'], 0);
  writeFileSync(file, `${JSON.stringify({ ...rows[0], stage: 'Something new' })}\n`);
  assert.equal(inspect({ root: w.root, now: w.clock.now }).queue.other_stage, 1, 'a stage the script does not know is counted, not lost');
});

test('unfinished work and cost: stopped and crashed judge runs get their resume command, a promote in flight is listed', async () => {
  const w = makeLoopWorld({ seed: false });
  writeRunJson(w, 'j-stopped', { run_id: 'j-stopped', kind: 'judge', status: 'stopped', items_source: 'claims', cost_usd: 0.5, resume: 'node agents/claim-tagger/scripts/judge.mjs --items claims --run-id j-stopped --resume' });
  writeRunJson(w, 'j-crashed', { run_id: 'j-crashed', kind: 'judge', status: 'running', items_source: 'eval', driver: 'fake', cost_usd: 0.25 });
  writeRunJson(w, 'j-done', { run_id: 'j-done', kind: 'judge', status: 'done', cost_usd: 1 });
  writeRunJson(w, 'not-a-judge', { run_id: 'not-a-judge', kind: 'distill', status: 'running' });
  writeFileSync(rootFile(w, 'runs', 'PROMOTING.json'), JSON.stringify({ run_id: 'pr1', lesson: 'Some lesson' }));
  const state = inspect({ root: w.root, now: w.clock.now });
  assert.deepEqual(state.unfinished.map((u) => u.run_id).sort(), ['j-crashed', 'j-stopped', 'pr1']);
  assert.equal(state.unfinished.find((u) => u.run_id === 'j-stopped').resume, 'node agents/claim-tagger/scripts/judge.mjs --items claims --run-id j-stopped --resume');
  assert.equal(state.unfinished.find((u) => u.run_id === 'j-crashed').resume, 'node agents/claim-tagger/scripts/judge.mjs --items eval --driver fake --run-id j-crashed --resume');
  assert.match(state.unfinished.find((u) => u.run_id === 'pr1').resume, /promote\.mjs --finalize pr1/);
  assert.equal(state.cost.total_usd, 1.75);
  assert.equal(state.cost.runs_counted, 3);
  assert.match(run(w, []).out[0], /Unfinished:\n  - judge j-crashed \(running\): node agents/);
});

// ---- --run <id> ----------------------------------------------------------------------------------------------------------------------------

test('--run: the progress of a judge run from its ledger and judgment files', async () => {
  const w = makeLoopWorld({ seed: false });
  const items = rootFile(w, 'items.jsonl');
  writeFileSync(items, ['c1', 'c2', 'c3'].map((id) => JSON.stringify({ id, claim: `Claim ${id} says the budget will pass`, sources_count: 1 })).join('\n') + '\n');
  const out = [];
  const code = await judgeMain(['--items', items, '--runs', '2', '--run-id', 'jr', '--driver', 'fake'], { out: (s) => out.push(s), err: (s) => out.push(s) }, { agentDir: w.root, runClaude: makeJudgeStub(), now: w.clock.now });
  assert.equal(code, EXIT.OK, out.join('\n'));
  const p = runProgress(w.root, 'jr');
  assert.equal(p.judge.cells, 6);
  assert.equal(p.judge.cells_done, 6);
  assert.equal(p.judge.ledger.done, 6);
  assert.equal(p.judge.status, 'done');
  assert.equal(p.judge.resume, null);
  const text = run(w, ['--run', 'jr']).out[0];
  assert.match(text, /^run jr:\n  judge, status done/);
  assert.match(text, /judgments: 6 of 6 cells done; ledger \{"done":6\}/);
  assert.equal(JSON.parse(run(w, ['--run', 'jr', '--json']).out[0]).judge.cells_done, 6);

  // a cell that went missing shows as not done, with the command to continue
  const folder = rootFile(w, 'runs', 'judgments', p.run.config16, 'run-2');
  const first = readJson(rootFile(w, 'runs', 'jr', 'run.json')).items[0];
  writeFileSync(join(folder, `${first.id}.${first.text_hash.replace('sha256:', '').slice(0, 8)}.json`), '{ broken');
  const broken = runProgress(w.root, 'jr');
  assert.equal(broken.judge.cells_done, 5);
});

test('--run: a plan that was checked and applied shows its ops, the applied ledger and the verify result', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  const geo = Object.keys(w.ids.claims)[0];
  const plan = openPlan({ runId: 'ap1', root: w.root, now: w.clock.now });
  plan.update('claims', geo, null, { Readiness: 'Ready' });
  plan.write();
  assert.equal(planCheck({ root: w.root, runId: 'ap1', now: w.clock.now }).code, EXIT.OK);
  const cap = captureIo();
  assert.equal(await applyMain(['--run', 'ap1'], cap.io, w.env()), EXIT.OK, cap.err.join('\n'));
  const text = run(w, ['--run', 'ap1']).out[0];
  assert.match(text, /plan: 1 op\(s\) from pull p1; checked: 1 to apply \(0 create, 1 update\), 0 skipped/);
  assert.match(text, /applied: \{"ok":1\}/);
  assert.match(text, /verify: clean \(1 landed, 0 missing, 0 editor field change\(s\)\)/);
  const c = captureIo();
  assert.equal(main(['--run', 'no-such-run'], c.io, { root: w.root }), EXIT.INVALID);
  assert.match(c.err.join(''), /there is no run folder runs\/no-such-run/);
});

// ---- --unpause --------------------------------------------------------------------------------------------------------------------------------

test('--unpause needs --confirm; with it the PAUSED file goes and who and when are recorded', () => {
  const w = makeLoopWorld({ seed: false });
  writeFileSync(rootFile(w, 'runs', 'PAUSED'), JSON.stringify({ run_id: 'r1', field: 'Tag outcome', before: null, after: 'Applies' }));
  let r = run(w, ['--unpause']);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join(''), /needs --confirm/);
  assert.ok(existsSync(rootFile(w, 'runs', 'PAUSED')), 'nothing was deleted');
  r = run(w, ['--unpause', '--confirm'], { user: 'rule.owner' });
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out[0], /runs\/PAUSED removed \(recorded in runs\/state\/unpaused\.jsonl\)/);
  assert.equal(existsSync(rootFile(w, 'runs', 'PAUSED')), false);
  const [entry] = readJsonl(rootFile(w, 'runs', 'state', 'unpaused.jsonl')).rows;
  assert.equal(entry.by, 'rule.owner');
  assert.equal(entry.at, '2026-10-13T12:00:00.000Z');
  assert.deepEqual(entry.previous, { run_id: 'r1', field: 'Tag outcome', before: null, after: 'Applies' });
  r = run(w, ['--unpause', '--confirm']);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out[0], /does not exist, nothing to clear/);
  assert.equal(readJsonl(rootFile(w, 'runs', 'state', 'unpaused.jsonl')).rows.length, 1);
  assert.equal(run(w, ['--check']).code, EXIT.OK);
});

// ---- --restore-rulebook -------------------------------------------------------------------------------------------------------------------

test('--restore-rulebook --confirm writes the live rubric text back into a drifted row; the plan passes the check and the apply', async () => {
  const w = makeLoopWorld();
  const rubric = liveRubric();
  const predictive = rubric.tags.find((t) => t.name === 'Predictive');
  w.fake.editorSet(w.ids.rulebook.Predictive, { 'When to use': '1. Somebody rewrote this in Notion.\n2. And this.' });
  await w.pull('p1');
  assert.equal(run(w, ['--check']).code, EXIT.DRIFT);

  let r = run(w, ['--restore-rulebook']);
  assert.equal(r.code, EXIT.INVALID, 'without --confirm nothing happens');
  assert.equal(existsSync(rootFile(w, 'runs', 'restore-1')), false);

  r = run(w, ['--restore-rulebook', '--confirm'], { runId: 'restore-1' });
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /^status: restore plan restore-1 written: 1 Rulebook row\(s\) \(Predictive\) back to rubric 2026-10-13\.1/);
  const { ops, header } = readPlan(w.root, 'restore-1');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].database, 'rulebook');
  assert.equal(ops[0].key, 'Predictive');
  assert.deepEqual(Object.keys(ops[0].properties).sort(), ['Rule version', 'Tag hash', 'When to use']);
  assert.equal(ops[0].properties['Tag hash'], predictive.tag_hash);
  assert.equal(ops[0].properties['Rule version'], '2026-10-13.1');
  assert.equal(ops[0].properties['When to use'], composeWhenToUse(predictive.when_to_use));
  assert.deepEqual(ops[0].expect, { 'When to use': '1. Somebody rewrote this in Notion.\n2. And this.' });
  // plan.mjs openPlan drops ctx.restore and ctx.confirm (a contract gap, see status.mjs buildRestorePlan): the header then carries the form it accepts
  assert.ok(header.ctx.restore === true || (header.ctx.promote === true && header.ctx.gate === 'PASS'), JSON.stringify(header.ctx));

  assert.equal(planCheck({ root: w.root, runId: 'restore-1', now: w.clock.now }).code, EXIT.OK);
  const cap = captureIo();
  assert.equal(await applyMain(['--run', 'restore-1'], cap.io, w.env()), EXIT.OK, cap.err.join('\n'));
  assert.match(cap.out[0], /updated 1/);
  await w.pull('p2');
  assert.equal(run(w, ['--check']).code, EXIT.OK, 'the Rulebook is back to rubric.json');
  r = run(w, ['--restore-rulebook', '--confirm'], { runId: 'restore-2' });
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out[0], /the Rulebook matches rubric\.json, nothing to restore/);
});

test('--restore-rulebook: drift in other columns is listed for a person, and a rubric that fails its lock is not used', async () => {
  const w = makeLoopWorld();
  w.fake.editorSet(w.ids.rulebook.Debate, { Description: 'A description somebody changed.' });
  await w.pull('p1');
  let r = run(w, ['--restore-rulebook', '--confirm'], { runId: 'restore-1' });
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /cannot be restored by script \(edit it in Notion\): Debate description/);
  assert.equal(existsSync(rootFile(w, 'runs', 'restore-1')), false);

  const parts = restorableDrift([{ tag: 'Debate', part: 'rule 2' }, { tag: 'Debate', part: 'note' }, { tag: 'Opinion', part: 'description' }, { tag: null, part: 'invalid' }, { tag: 'Simple', part: 'examples' }]);
  assert.deepEqual([...parts.tags], [['Debate', ['rule 2', 'note']]]);
  assert.deepEqual(parts.manual.map((d) => d.part), ['description', 'invalid', 'examples']);

  writeFileSync(rootFile(w, 'rubric', 'rubric.lock'), '{}');
  r = run(w, ['--restore-rulebook', '--confirm'], { runId: 'restore-2' });
  assert.equal(r.code, EXIT.DRIFT);
  assert.match(r.err.join('\n'), /refusing to restore from a rubric that does not match its lock/);
});

// ---- small things -----------------------------------------------------------------------------------------------------------------------------

test('tagRuleVersion: the version of the last changelog entry that names the tag, else the first version', () => {
  const rubric = liveRubric();
  assert.equal(tagRuleVersion(rubric, 'Predictive'), '2026-10-13.1');
  const changed = structuredClone(rubric);
  changed.changelog.push({ version: '2026-10-13.2', date: '2026-10-13', tag: 'Predictive' }, { version: '2026-10-13.3', date: '2026-10-13', tag: 'Debate' });
  assert.equal(tagRuleVersion(changed, 'Predictive'), '2026-10-13.2');
  assert.equal(tagRuleVersion(changed, 'Debate'), '2026-10-13.3');
  assert.equal(tagRuleVersion(changed, 'Opinion'), '2026-10-13.1');
  assert.equal(tagRuleVersion({ rubric_version: '2026-10-14.1', changelog: [] }, 'X'), '2026-10-14.1');
});

test('arguments: unknown flags, two modes at once, --confirm alone and --help', () => {
  const w = makeLoopWorld({ seed: false });
  for (const argv of [['--bogus'], ['stray'], ['--check', '--run', 'x'], ['--confirm'], ['--unpause', '--restore-rulebook', '--confirm'], ['--run']]) {
    const r = run(w, argv);
    assert.equal(r.code, EXIT.INVALID, JSON.stringify(argv));
    assert.match(r.err.join('\n'), /usage: node agents\/claim-tagger\/scripts\/status\.mjs/);
  }
  const help = run(w, ['--help']);
  assert.equal(help.code, EXIT.OK);
  assert.match(help.out[0], /--restore-rulebook --confirm/);
});

test('the status report of a world with nothing in it does not crash', () => {
  const w = makeLoopWorld({ seed: false });
  const r = run(w, []);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out[0], /no pull yet: Notion state is unknown/);
  assert.match(r.out[0], /Queue: not in the pull/);
  assert.match(r.out[0], /Last run cards: none/);
  assert.equal(JSON.parse(run(w, ['--json']).out[0]).pull, null);
});

test('the lock is read from the files: version, hash and tag counts', () => {
  const w = makeLoopWorld({ seed: false });
  const lock = lockState(w.root);
  assert.equal(lock.ok, true);
  assert.equal(lock.version, '2026-10-13.1');
  assert.equal(lock.hash, 'sha256:63f085c84a038df8');
  assert.equal(lock.tag_count, 14);
  assert.equal(lock.judged_count, 12);
  assert.equal(readFileSync(rootFile(w, 'rubric', 'rubric.lock'), 'utf8').includes('file_sha256'), true);
});
