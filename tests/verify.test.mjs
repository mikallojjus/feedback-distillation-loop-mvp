import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { readJsonl } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { check, openPlan } from '../agents/claim-tagger/scripts/plan.mjs';
import { main, verify } from '../agents/claim-tagger/scripts/verify.mjs';
import { USER, captureIo, cleanupRoots, makeWorld } from './fixtures/notion/helpers.mjs';

after(cleanupRoots);

/**
 * A plan on a pulled world ("pre"). `land(w)` then plays the part of the apply (writes through the fake), and the world is
 * pulled again ("post"). Returns the world.
 */
async function scenario(build, land, { ctx, runId = 'run-1' } = {}) {
  const w = makeWorld();
  await w.pull('pre');
  const p = openPlan({ runId, root: w.root, ctx, sourcePull: 'pre', now: w.clock.now });
  build(p, w);
  p.write();
  const c = check({ root: w.root, runId, pullId: 'pre', now: w.clock.now });
  assert.equal(c.code, EXIT.OK, (c.problems ?? []).join('; '));
  await land?.(w);
  await w.pull('post');
  return w;
}
const doVerify = (w, runId = 'run-1') => verify({ root: w.root, runId, prePullId: 'pre', postPullId: 'post', now: w.clock.now });
const runDir = (w, runId = 'run-1') => join(w.root, 'runs', runId);
const readJsonFile = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));

const buildMixed = (p) => {
  p.update('claims', 'g1', null, { Readiness: 'Ready', 'Tag confidence': 'Debate: apply (0.9)', 'Last judged': '2026-10-13.1' });
  p.create('runs', 'Tag R1', { Kind: 'Tag', 'Claims judged': 3, Verdict: 'n/a', Started: '2026-10-13T12:00:00.000Z', 'Cost USD': 0.1 + 0.2 });
  p.update('tag_decisions', 'g1::Predictive', null, { 'Agent proposal': 'Add tag', 'Agent confidence': 0.9, Lesson: [{ rule_changes: 'Hedged trajectories are not forecasts' }] });
};
const landMixed = (w) => {
  w.fake.editorSet(w.ids.claims.g1, { Readiness: 'Ready', 'Tag confidence': 'Debate: apply (0.9)', 'Last judged': '2026-10-13.1' });
  w.fake.add('runs', { 'Run title': 'Tag R1', Kind: 'Tag', 'Claims judged': 3, Verdict: 'n/a', Started: '2026-10-13T12:00:00.000+00:00', 'Cost USD': 0.30000000000000004 });
  w.fake.editorSet(w.ids.decisions['g1::Predictive'], { 'Agent proposal': 'Add tag', 'Agent confidence': 0.9, Lesson: [w.ids.lesson] });
};

test('clean: every op landed (text, numbers with tolerance, dates by instant, relations as sets), no editor field moved', async () => {
  const w = await scenario(buildMixed, landMixed);
  const v = doVerify(w);
  assert.equal(v.code, EXIT.OK, JSON.stringify(v.result));
  assert.equal(v.line, 'verify: run run-1 clean: 3 op(s) landed, 0 skipped, editor fields changed: 0');
  const file = readJsonFile(runDir(w), 'verify.json');
  assert.equal(file.result, 'clean');
  assert.equal(file.pre_pull, 'pre');
  assert.equal(file.post_pull, 'post');
  assert.equal(file.landed, 3);
  assert.deepEqual(file.missing, []);
  assert.deepEqual(file.mismatched, []);
  assert.deepEqual(file.editor_changes, []);
  assert.match(file.plan_sha, /^[0-9a-f]{64}$/);
  assert.equal(existsSync(join(runDir(w), 'plan.retry.jsonl')), false);
  assert.equal(existsSync(join(w.root, 'runs', 'PAUSED')), false);
});

test('a missing create and a wrong value are reported; plan.retry.jsonl has a header and exactly those ops (exit 1)', async () => {
  const w = await scenario(buildMixed, (x) => {
    x.fake.editorSet(x.ids.claims.g1, { Readiness: 'Fix needed', 'Tag confidence': 'Debate: apply (0.9)', 'Last judged': '2026-10-13.1' }); // other value than planned
    // the Runs row is never created; the Tag decisions update lands
    x.fake.editorSet(x.ids.decisions['g1::Predictive'], { 'Agent proposal': 'Add tag', 'Agent confidence': 0.9, Lesson: [x.ids.lesson] });
  });
  const v = doVerify(w);
  assert.equal(v.code, EXIT.ERROR);
  assert.match(v.line, /^verify: run run-1: 2 of 3 op\(s\) did not land \(1 missing, 1 with other values\); plan\.retry\.jsonl written$/);
  const file = readJsonFile(runDir(w), 'verify.json');
  assert.equal(file.result, 'retry');
  assert.deepEqual(file.missing, [{ seq: 2, database: 'runs', key: 'Tag R1' }]);
  assert.deepEqual(file.mismatched, [{ seq: 1, database: 'claims', key: 'g1', property: 'Readiness', planned: 'Ready', actual: 'Fix needed' }]);
  assert.equal(file.landed, 1);
  const rows = readJsonl(join(runDir(w), 'plan.retry.jsonl')).rows;
  assert.equal(rows[0].op, 'header');
  assert.equal(rows[0].retry_of, 'run-1');
  assert.deepEqual(rows[0].counts, { create: 1, update: 1 });
  assert.deepEqual(rows.slice(1).map((r) => [r.seq, r.op, r.key]), [[1, 'update', 'g1'], [2, 'create', 'Tag R1']]);
  assert.equal(existsSync(join(w.root, 'runs', 'PAUSED')), false, 'a missing op is not a trust problem');
});

test('a clean verify after a bad one removes the stale retry file', async () => {
  const w = await scenario(buildMixed, null);
  assert.equal(doVerify(w).code, EXIT.ERROR);
  assert.ok(existsSync(join(runDir(w), 'plan.retry.jsonl')));
  await landMixed(w);
  await w.pull('post');
  assert.equal(doVerify(w).code, EXIT.OK);
  assert.equal(existsSync(join(runDir(w), 'plan.retry.jsonl')), false);
});

test('an editor-owned field changed on a page the plan touched: runs/PAUSED with field, before and after, exit 5', async () => {
  const w = await scenario(buildMixed, (x) => {
    landMixed(x);
    x.fake.editorSet(x.ids.decisions['g1::Predictive'], { 'Tag outcome': 'Applies', 'Why wrong': 'Agent slip', 'Your reasoning': 'because', 'Decided by': [USER], 'Decided at': '2026-10-13' });
  });
  const v = doVerify(w);
  assert.equal(v.code, EXIT.TRUST);
  assert.match(v.line, /^verify: run run-1: TRUST BREAKER: Tag outcome changed on tag_decisions "g1::Predictive" \(page .+\) from null to "Applies" \(\+4 more\); runs\/PAUSED written$/);
  const paused = readJsonFile(w.root, 'runs', 'PAUSED');
  assert.equal(paused.run_id, 'run-1');
  assert.equal(paused.page_id, w.ids.decisions['g1::Predictive']);
  assert.equal(paused.field, 'Tag outcome');
  assert.equal(paused.before, null);
  assert.equal(paused.after, 'Applies');
  assert.match(paused.detected_at, /^2026-10-13T12:00:00/);
  assert.deepEqual(paused.changes.map((c) => c.field).sort(), ['Decided at', 'Decided by', 'Tag outcome', 'Why wrong', 'Your reasoning']);
  assert.equal(paused.changes.find((c) => c.field === 'Decided by').after[0], USER);
  assert.equal(readJsonFile(runDir(w), 'verify.json').result, 'trust_breaker');
  assert.equal(readJsonFile(runDir(w), 'verify.json').editor_changes.length, 5);
});

test('editor fields changed on pages the plan did not touch are ignored: editors work while the agent does', async () => {
  const w = await scenario(buildMixed, (x) => {
    landMixed(x);
    x.fake.editorSet(x.ids.decisions['g3::Predictive'], { 'Tag outcome': 'Applies', 'Your reasoning': 'edited meanwhile' }); // not in the plan
    x.fake.editorSet(x.ids.settings, { Paused: true });
    x.fake.editorSet(x.ids.lesson, { Status: 'Rejected', 'Editor wording': 'my words' });
  });
  const v = doVerify(w);
  assert.equal(v.code, EXIT.OK);
  assert.equal(existsSync(join(w.root, 'runs', 'PAUSED')), false);
});

test('a write the plan made itself is not a trust breaker: Status Approved -> Rolled back, but an outside change of Status is', async () => {
  const build = (p) => p.update('rule_changes', 'Hedged trajectories are not forecasts', null, { Status: 'Rolled back', 'Gate result': 'FAIL (small sample)', 'Rubric version': '2026-10-14.1' });
  const ok = await scenario(build, (x) => x.fake.editorSet(x.ids.lesson, { Status: 'Rolled back', 'Gate result': 'FAIL (small sample)', 'Rubric version': '2026-10-14.1' })); // a Live write needs gate evidence, so the self-made write here is a rollback
  const first = doVerify(ok);
  assert.equal(first.code, EXIT.OK, first.line);
  // the plan writes only the gate result; the status changes under it
  const bad = await scenario(
    (p) => p.update('rule_changes', 'Hedged trajectories are not forecasts', null, { 'Gate result': 'HOLD (small sample)' }),
    (x) => x.fake.editorSet(x.ids.lesson, { 'Gate result': 'HOLD (small sample)', Status: 'Rejected' }),
  );
  const v = doVerify(bad);
  assert.equal(v.code, EXIT.TRUST);
  assert.equal(readJsonFile(bad.root, 'runs', 'PAUSED').field, 'Status');
  assert.equal(readJsonFile(bad.root, 'runs', 'PAUSED').before, 'Approved');
  assert.equal(readJsonFile(bad.root, 'runs', 'PAUSED').after, 'Rejected');
  // Approved -> Live that the plan did not write is also a change of an editor value
  const live = await scenario(
    (p) => p.update('rule_changes', 'Hedged trajectories are not forecasts', null, { 'Gate result': 'x' }),
    (x) => x.fake.editorSet(x.ids.lesson, { 'Gate result': 'x', Status: 'Live' }),
  );
  assert.equal(doVerify(live).code, EXIT.TRUST);
});

test('a page created by the plan has no baseline: its editor fields are not compared, its planned values are', async () => {
  const w = await scenario(
    (p) => p.create('rule_changes', 'Lesson two', { Kind: 'Clarify wording', Status: 'Proposed', 'Proposed text': 'x' }),
    (x) => x.fake.add('rule_changes', { 'Lesson title': 'Lesson two', Kind: 'Clarify wording', Status: 'Proposed', 'Proposed text': 'x', 'Approved by': [USER] }),
  );
  assert.equal(doVerify(w).code, EXIT.OK);
});

test('a key that exists twice in Notion after the apply is reported for a person (exit 2)', async () => {
  const w = await scenario(buildMixed, (x) => {
    landMixed(x);
    x.fake.add('runs', { 'Run title': 'Tag R1', Kind: 'Tag' }); // a second row with the same title
  });
  const v = doVerify(w);
  assert.equal(v.code, EXIT.INVALID);
  assert.match(v.line, /1 key\(s\) exist twice in Notion \(runs "Tag R1"\)/);
  assert.equal(readJsonFile(runDir(w), 'verify.json').duplicates.length, 1);
});

test('ops skipped by the check (expectation failed) are listed as skipped, not as missing', async () => {
  const w = await scenario((p) => {
    p.update('claims', 'g1', null, { Readiness: 'Ready' });
    p.update('claims', 'g2', null, { Readiness: 'Ready' }, { expect: { Readiness: 'Not checkable' } });
  }, (x) => x.fake.editorSet(x.ids.claims.g1, { Readiness: 'Ready' }));
  const v = doVerify(w);
  assert.equal(v.code, EXIT.OK);
  assert.equal(v.result.skipped.length, 1);
  assert.equal(v.result.skipped[0].key, 'g2');
  assert.match(v.line, /1 op\(s\) landed, 1 skipped/);
});

test('apply.json and applied.jsonl are used when present: skipped rows are skipped, failed rows are missing', async () => {
  const w = await scenario(
    (p) => { p.update('claims', 'g1', null, { Readiness: 'Ready' }); p.update('claims', 'g2', null, { Readiness: 'Fix needed' }); p.update('claims', 'g3', null, { Readiness: 'Not checkable' }); },
    (x) => x.fake.editorSet(x.ids.claims.g1, { Readiness: 'Ready' }),
  );
  writeFileSync(join(runDir(w), 'apply.json'), JSON.stringify({ run_id: 'run-1', pre_pull: 'pre', post_pull: 'post' }));
  writeFileSync(join(runDir(w), 'applied.jsonl'), [
    { seq: 1, status: 'ok' }, { seq: 2, status: 'skipped', reason: 'the row was decided since the plan was built' }, { seq: 3, status: 'failed', error: 'boom' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const v = verify({ root: w.root, runId: 'run-1', now: w.clock.now }); // pre and post come from apply.json
  assert.equal(v.code, EXIT.ERROR);
  assert.deepEqual(v.result.skipped.map((s) => s.seq), [2]);
  assert.deepEqual(v.result.missing.length, 0);
  assert.deepEqual(v.result.mismatched.map((m) => m.seq), [3], 'the failed op did not change anything, so its value differs');
});

test('an op the check skipped as already up to date is still compared: a later change of the value is caught', async () => {
  const w = await scenario(
    (p) => p.update('claims', 'g1', null, { Readiness: 'Needs editor' }), // already the value in Notion
    (x) => x.fake.editorSet(x.ids.claims.g1, { Readiness: 'Ready' }), // somebody changes it afterwards
  );
  const v = doVerify(w);
  assert.equal(v.code, EXIT.ERROR);
  assert.equal(v.result.mismatched[0].property, 'Readiness');
});

test('inputs: no pulls named, an unknown pull, a post pull that lacks a database, no plan', async () => {
  const w = await scenario(buildMixed, landMixed);
  const defaults = verify({ root: w.root, runId: 'run-1', now: w.clock.now }); // pre: the source pull of the plan, post: the newest pull
  assert.equal(defaults.code, EXIT.OK);
  assert.equal(defaults.result.pre_pull, 'pre');
  assert.equal(defaults.result.post_pull, 'post');
  rmSync(join(w.root, 'runs', 'pull', 'LATEST'));
  const none = verify({ root: w.root, runId: 'run-1', now: w.clock.now });
  assert.equal(none.code, EXIT.INVALID);
  assert.match(none.problems[0], /needs a pre and a post pull/);
  assert.equal(verify({ root: w.root, runId: 'run-1', prePullId: 'pre', postPullId: 'ghost' }).code, EXIT.INVALID);
  await w.pull('partial', ['claims']);
  const partial = verify({ root: w.root, runId: 'run-1', prePullId: 'pre', postPullId: 'partial' });
  assert.equal(partial.code, EXIT.INVALID);
  assert.match(partial.problems[0], /post pull partial does not cover/);
  assert.equal(verify({ root: w.root, runId: 'nope', prePullId: 'pre', postPullId: 'post' }).code, EXIT.INVALID);
});

test('PAUSED written over an existing one keeps the old content under "previous"', async () => {
  const w = await scenario(buildMixed, (x) => {
    landMixed(x);
    x.fake.editorSet(x.ids.decisions['g1::Predictive'], { 'Tag outcome': 'Applies' });
  });
  writeFileSync(join(w.root, 'runs', 'PAUSED'), JSON.stringify({ run_id: 'older', field: 'Paused' }));
  assert.equal(doVerify(w).code, EXIT.TRUST);
  assert.deepEqual(readJsonFile(w.root, 'runs', 'PAUSED').previous, { run_id: 'older', field: 'Paused' });
});

test('command line: prints one line and details on stderr; usage errors', async () => {
  const w = await scenario(buildMixed, (x) => {
    x.fake.editorSet(x.ids.claims.g1, { Readiness: 'Fix needed' });
  });
  const cap = captureIo();
  assert.equal(main(['--run', 'run-1', '--pre', 'pre', '--post', 'post'], cap.io, { root: w.root, now: w.clock.now }), EXIT.ERROR);
  assert.equal(cap.out.length, 1);
  assert.match(cap.err.join('\n'), /verify: missing: op 2 \(runs "Tag R1"\)/);
  assert.match(cap.err.join('\n'), /verify: op 1 \(claims "g1"\) Readiness: planned "Ready", found "Fix needed"/);
  rmSync(join(w.root, 'runs', 'pull', 'LATEST'));
  const noPulls = captureIo();
  assert.equal(main(['--run', 'run-1'], noPulls.io, { root: w.root }), EXIT.INVALID);
  assert.match(noPulls.err.join('\n'), /needs a pre and a post pull/);
  for (const argv of [[], ['--run'], ['--bogus'], ['stray']]) {
    const c = captureIo();
    assert.equal(main(argv, c.io, { root: w.root }), EXIT.INVALID, JSON.stringify(argv));
    assert.match(c.err.join('\n'), /usage:/);
  }
  assert.equal(main(['--help'], captureIo().io, { root: w.root }), EXIT.OK);
  const trust = await scenario(buildMixed, (x) => { landMixed(x); x.fake.editorSet(x.ids.decisions['g1::Predictive'], { 'Tag outcome': 'Applies' }); }, { runId: 'run-2' });
  const tcap = captureIo();
  assert.equal(main(['--run', 'run-2', '--pre', 'pre', '--post', 'post'], tcap.io, { root: trust.root, now: trust.clock.now }), EXIT.TRUST);
  assert.match(tcap.err.join('\n'), /tag_decisions "g1::Predictive" Tag outcome: before null, after "Applies"/);
});

test('after an apply by connector there is no apply.json: pre is the source pull of the plan and post is the newest pull', async () => {
  const w = await scenario(buildMixed, null);
  assert.equal(verify({ root: w.root, runId: 'run-1', now: w.clock.now }).code, EXIT.ERROR, 'nothing was applied yet: the newest pull is still the old state');
  await landMixed(w); // the connector calls
  await w.pull('after-connector');
  const cap = captureIo();
  assert.equal(main(['--run', 'run-1'], cap.io, { root: w.root, now: w.clock.now }), EXIT.OK, cap.err.join('\n'));
  assert.match(cap.out[0], /^verify: run run-1 clean: 3 op\(s\) landed/);
  const file = JSON.parse(readFileSync(join(w.root, 'runs', 'run-1', 'verify.json'), 'utf8'));
  assert.equal(file.pre_pull, 'pre');
  assert.equal(file.post_pull, 'after-connector');
});
