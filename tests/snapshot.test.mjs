import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { readJson } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { NORM_FILES, main, summarise, takeSnapshot } from '../agents/claim-tagger/scripts/snapshot.mjs';
import { loadPull } from '../agents/claim-tagger/scripts/pull.mjs';
import { captureIo, cleanupLoop, makeLoopWorld, makeMiniWorld } from './fixtures/loop/world.mjs';

const evidence = [];
after(() => {
  cleanupLoop();
  for (const d of evidence) rmSync(d, { recursive: true, force: true });
});
const evidenceDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-evidence-'));
  evidence.push(dir);
  return dir;
};

const snap = (w, argv, dir, extra = {}) => {
  const c = captureIo();
  const code = main(argv, c.io, { root: w.root, evidenceDir: dir, ...extra });
  return { code, out: c.out, err: c.err };
};

test('a snapshot copies the norm files of the latest pull and writes summary.json into <nn>-<label>', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  const dir = evidenceDir();
  const r = snap(w, ['--step', '3', '--label', 'editor decisions'], dir);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^snapshot: 03-editor-decisions: 7 file\(s\) from pull p1; queue 50 rows, stages \{"Decided":27,"To review":23\}; lessons \{\} -> /);
  const folder = join(dir, '03-editor-decisions');
  assert.deepEqual(readdirSync(folder).sort(), [...NORM_FILES, 'summary.json'].sort());
  for (const f of NORM_FILES) assert.equal(readFileSync(join(folder, f), 'utf8'), readFileSync(join(w.root, 'runs', 'pull', 'p1', 'norm', f), 'utf8'), `${f} is a byte-for-byte copy`);

  const s = readJson(join(folder, 'summary.json'));
  assert.equal(s.step, 3);
  assert.equal(s.label, 'editor decisions');
  assert.equal(s.folder, '03-editor-decisions');
  assert.equal(s.pull_id, 'p1');
  assert.equal(s.taken_at, '2026-10-13T12:00:00.000Z');
  assert.deepEqual(s.files, NORM_FILES);
  assert.deepEqual(s.counts, { rulebook: 14, claims: 60, tag_decisions: 50, rule_changes: 0, runs: 0, agent_settings: 1 });
  assert.equal(s.queue.total, 50);
  assert.deepEqual(s.queue.by_stage, { Decided: 27, 'To review': 23 });
  assert.equal(s.queue.decided, 27);
  assert.equal(s.queue.editor_decided, 0, 'the 27 are seeded: no editor field is set');
  assert.equal(s.queue.with_lesson, 0);
  assert.equal(s.queue.in_regression_suite, 0);
  assert.equal(s.queue.by_why_in_queue['Seeded decision'], 33);
  assert.equal(s.queue.by_why_in_queue['Auditor flag'], 17);
  assert.equal(s.claims.total, 60);
  assert.equal(s.claims.by_sample.Decided, 33);
  assert.deepEqual(s.lessons, { total: 0, by_status: {}, list: [] });
  assert.equal(s.runs.total, 0);
  assert.equal(s.rulebook.tags, 14);
  assert.equal(s.rulebook.drift, 0);
  assert.deepEqual(s.rulebook.changed_by, []);
  assert.equal(s.settings.paused, false);
  assert.equal(s.settings.rubric_in_force, '2026-10-13.1');
});

test('the summary counts what the editors and the agent did: stages, lessons, runs, regression rows, Changed by', async () => {
  const w = makeMiniWorld({ rows: [
    { id: 'a', claim: 'Decided by an editor', tag: 'Predictive', outcome: 'Does not apply', why: 'Rule should change', reasoning: 'x' },
    { id: 'b', claim: 'Open row', tag: 'Debate' },
    { id: 'c', claim: 'Seeded row', tag: 'Debate', outcome: 'Applies', seeded: true },
  ] });
  const [a] = w.keys;
  const lesson = w.lesson({ title: 'A lesson', tag: 'Predictive', status: 'Live', rubricVersion: '2026-10-13.2', supporting: [a] });
  w.fake.editorSet(w.ids.decisions[a], { 'In regression suite': '2026-10-13' });
  w.fake.editorSet(w.ids.rulebook.Predictive, { 'Changed by': [lesson], 'Rule version': '2026-10-13.2' });
  w.fake.add('runs', { 'Run title': 'Gate x', Kind: 'Gate', Verdict: 'PASS' });
  w.fake.add('runs', { 'Run title': 'Tag y', Kind: 'Tag', Verdict: 'n/a' });
  await w.pull('p1');
  const s = summarise(loadPull(w.root, 'p1'));
  assert.equal(s.queue.total, 3);
  assert.equal(s.queue.editor_decided, 1);
  assert.equal(s.queue.decided, 2);
  assert.equal(s.queue.with_lesson, 1);
  assert.equal(s.queue.in_regression_suite, 1);
  assert.deepEqual(s.lessons.by_status, { Live: 1 });
  assert.deepEqual(s.lessons.list, [{ id: 'LS-1', key: 'A lesson', tag: 'Predictive', status: 'Live', rubric_version: '2026-10-13.2' }]);
  assert.deepEqual(s.runs.by_kind, { Gate: 1, Tag: 1 });
  assert.deepEqual(s.runs.by_verdict, { PASS: 1, 'n/a': 1 });
  assert.deepEqual(s.rulebook.changed_by, ['Predictive']);
  assert.equal(s.rulebook.rule_versions['2026-10-13.2'], 1);
  assert.equal(s.rulebook.rule_versions['2026-10-13.1'], 13);
});

test('the label defaults to "step" and is cut down to a safe folder name; the step is padded to two digits', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  const dir = evidenceDir();
  assert.equal(snap(w, ['--step', '7'], dir).code, EXIT.OK);
  assert.equal(snap(w, ['--step', '12', '--label', 'Tag R2: after / apply*now?'], dir).code, EXIT.OK);
  assert.equal(snap(w, ['--step', '0', '--label', '  Seeded  '], dir).code, EXIT.OK);
  assert.equal(snap(w, ['--step', '5', '--label', ':::'], dir).code, EXIT.OK);
  assert.deepEqual(readdirSync(dir).sort(), ['00-seeded', '05-step', '07-step', '12-tag-r2-after-apply-now'].sort());
  for (const name of readdirSync(dir)) assert.doesNotMatch(name, /[:*?"<>|\\/]/, 'nothing Windows would refuse in a folder name');
});

test('an existing folder is never overwritten; bad steps, no pull and an unknown pull are invalid', async () => {
  const w = makeLoopWorld();
  const dir = evidenceDir();
  let r = snap(w, ['--step', '1'], dir);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join(''), /there is no pull yet/);
  await w.pull('p1');
  assert.equal(snap(w, ['--step', '1', '--label', 'first'], dir).code, EXIT.OK);
  writeFileSync(join(dir, '01-first', 'claims.jsonl'), 'edited by hand\n');
  r = snap(w, ['--step', '1', '--label', 'first'], dir);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join(''), /already exists: evidence is not overwritten/);
  assert.equal(readFileSync(join(dir, '01-first', 'claims.jsonl'), 'utf8'), 'edited by hand\n');
  for (const argv of [[], ['--step'], ['--step', 'abc'], ['--step', '-1'], ['--step', '1000'], ['--bogus'], ['--step', '1', 'stray']]) {
    r = snap(w, argv, dir);
    assert.equal(r.code, EXIT.INVALID, JSON.stringify(argv));
    assert.match(r.err.join(''), /usage: node agents\/claim-tagger\/scripts\/snapshot\.mjs --step <n> \[--label <text>\] \[--pull <id>\]/);
  }
  r = snap(w, ['--step', '2', '--pull', 'nope'], dir);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join(''), /pull "nope" does not exist/);
  assert.equal(snap(w, ['--help'], dir).code, EXIT.OK);
});

test('--pull picks an older pull; a pull that did not hold everything gives fewer files and null parts of the summary', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  w.decide(Object.keys(w.ids.decisions)[0], { outcome: 'Applies', why: 'Agent slip', reasoning: 'x' });
  await w.pull('p2', ['rulebook', 'agent_settings']);
  const dir = evidenceDir();
  let r = snap(w, ['--step', '1', '--label', 'old', '--pull', 'p1'], dir);
  assert.equal(r.code, EXIT.OK);
  assert.equal(readJson(join(dir, '01-old', 'summary.json')).pull_id, 'p1');
  r = snap(w, ['--step', '2', '--label', 'latest'], dir);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const s = readJson(join(dir, '02-latest', 'summary.json'));
  assert.equal(s.pull_id, 'p2');
  assert.deepEqual(s.files, ['rulebook.json', 'settings.json']);
  assert.deepEqual(readdirSync(join(dir, '02-latest')).sort(), ['rulebook.json', 'settings.json', 'summary.json']);
  assert.equal(s.queue, null);
  assert.equal(s.claims, null);
  assert.equal(s.lessons, null);
  assert.equal(s.runs, null);
  assert.equal(s.rulebook.tags, 14);
  assert.equal(existsSync(join(dir, '02-latest', 'queue.jsonl')), false);
  assert.match(r.out[0], /^snapshot: 02-latest: 2 file\(s\) from pull p2 -> /);
});

test('takeSnapshot returns the folder and the summary for other scripts', async () => {
  const w = makeLoopWorld();
  await w.pull('p1');
  const dir = evidenceDir();
  const result = takeSnapshot({ root: w.root, step: 4, label: 'x', evidenceDir: dir });
  assert.equal(result.dir, join(dir, '04-x'));
  assert.equal(result.name, '04-x');
  assert.equal(result.summary.queue.total, 50);
  assert.equal(result.files.length, 7);
});
