import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRESH_MS, apply, main, markdownToBlocks } from '../agents/claim-tagger/scripts/apply.mjs';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { readJsonl } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { NotionError } from '../agents/claim-tagger/scripts/lib/notion-rest.mjs';
import { armedState, check, openPlan } from '../agents/claim-tagger/scripts/plan.mjs';
import { USER, captureIo, cleanupRoots, makeWorld } from './fixtures/notion/helpers.mjs';

after(cleanupRoots);

/** Build, write and check a plan on a freshly pulled world. */
async function armed(build, { runId = 'run-1', ctx, w = makeWorld() } = {}) {
  await w.pull('p1');
  const p = openPlan({ runId, root: w.root, ctx, now: w.clock.now });
  build(p, w);
  p.write();
  const c = check({ root: w.root, runId, now: w.clock.now });
  assert.equal(c.code, EXIT.OK, (c.problems ?? []).join('; '));
  return w;
}
async function run(w, args = ['--run', 'run-1'], extra = {}) {
  const cap = captureIo();
  const code = await main(args, cap.io, w.env(extra));
  return { code, out: cap.out, err: cap.err };
}
const ledger = (w, runId = 'run-1') => readJsonl(join(w.root, 'runs', runId, 'applied.jsonl')).rows;
const readJsonFile = (w, ...parts) => JSON.parse(readFileSync(join(w.root, ...parts), 'utf8'));
const standard = (p) => {
  p.update('claims', 'g1', null, { Readiness: 'Ready', 'Tag confidence': 'Debate: apply (0.9)\nOpinion: apply (0.8)', 'Last judged': '2026-10-13.1' });
  p.create('runs', 'Tag R1', { Kind: 'Tag', 'Claims judged': 3, Verdict: 'n/a', 'Rubric version': '2026-10-13.1', Started: '2026-10-13T12:00:00.000Z', 'Cost USD': 0.42 });
  p.create('rule_changes', 'Lesson two', { Kind: 'Clarify wording', Status: 'Proposed', Tag: [{ rulebook: 'Debate' }], 'Proposed text': 'x' });
  p.update('agent_settings', 'claim-tagger', null, { 'Rubric in force': '2026-10-13.1', 'Last run at': '2026-10-13T12:00:00.000Z', 'Last run summary': 'ok' });
};

// ---- the happy path ----

test('applies creates and updates in seq order, records every result, verifies, disarms, prints one line', async () => {
  const w = await armed(standard);
  const result = await run(w);
  assert.equal(result.code, EXIT.OK, result.err.join('\n'));
  assert.equal(result.out.length, 1, 'one summary line');
  assert.match(result.out[0], /^apply: run run-1: created 2, updated 2, skipped 0, failed 0; verify clean \(pre p1, post run-1-post\)$/);
  const writes = w.fake.writes();
  assert.deepEqual(writes.map((x) => `${x.method}:${x.db}`), ['updatePage:claims', 'createPage:runs', 'createPage:rule_changes', 'updatePage:agent_settings']);
  // what landed
  const claim = w.fake.find('claims', 'g1').props;
  assert.equal(claim.Readiness, 'Ready');
  assert.equal(claim['Tag confidence'], 'Debate: apply (0.9)\nOpinion: apply (0.8)');
  const run1 = w.fake.find('runs', 'Tag R1').props;
  assert.equal(run1.Kind, 'Tag');
  assert.equal(run1['Cost USD'], 0.42);
  assert.equal(run1.Started, '2026-10-13T12:00:00.000Z');
  const lesson = w.fake.find('rule_changes', 'Lesson two').props;
  assert.equal(lesson.Status, 'Proposed');
  assert.deepEqual(lesson.Tag, [w.ids.rulebook.Debate]);
  assert.match(lesson['Lesson ID'], /^LS-\d+$/);
  // the ledger
  const rows = ledger(w);
  assert.deepEqual(rows.map((r) => [r.seq, r.kind, r.status, r.error]), [[1, 'update', 'ok', null], [2, 'create', 'ok', null], [3, 'create', 'ok', null], [4, 'update', 'ok', null]]);
  assert.equal(rows[0].page_id, w.ids.claims.g1);
  assert.equal(rows[1].page_id, w.fake.find('runs', 'Tag R1').page_id);
  // state files
  const state = readJsonFile(w, 'runs', 'run-1', 'apply.json');
  assert.equal(state.pre_pull, 'p1', 'the fresh source pull was the snapshot');
  assert.equal(state.post_pull, 'run-1-post');
  assert.equal(readJsonFile(w, 'runs', 'run-1', 'verify.json').result, 'clean');
  assert.equal(armedState(w.root), null, 'a clean run disarms');
  assert.equal(existsSync(join(w.root, 'runs', 'run-1', 'plan.retry.jsonl')), false);
  assert.equal(existsSync(join(w.root, 'runs', 'PAUSED')), false);
});

test('only the touched databases (plus Agent settings, for the Paused switch) are read after the writes', async () => {
  const w = await armed(standard);
  const before = w.fake.requests.length;
  await run(w);
  const reads = w.fake.requests.slice(before).filter((r) => r.method === 'queryAll').map((r) => r.db).sort();
  assert.deepEqual(reads, ['agent_settings', 'claims', 'rule_changes', 'runs']);
});

test('a source pull older than ten minutes is not reused: a new pre-snapshot is taken', async () => {
  const w = await armed(standard);
  w.clock.advance(FRESH_MS + 1000);
  const result = await run(w);
  assert.equal(result.code, EXIT.OK, result.err.join('\n'));
  assert.equal(readJsonFile(w, 'runs', 'run-1', 'apply.json').pre_pull, 'run-1-pre');
  assert.ok(existsSync(join(w.root, 'runs', 'pull', 'run-1-pre', 'snapshot.json')));
  assert.match(result.out[0], /pre run-1-pre, post run-1-post/);
});

test('a create may carry page content: the blocks go in the create request, never as a second step', async () => {
  const w = await armed((p) => p.create('runs', 'Gate R2', { Kind: 'Gate', Verdict: 'PASS' }, { content_md: '# Card\n\nResult: PASS (small sample)\n\n- canaries 83 of 83\n- 0 newly failing\n\n```json\n{ "ok": true }\n```' }));
  assert.equal((await run(w)).code, EXIT.OK);
  const create = w.fake.writes()[0];
  assert.equal(create.method, 'createPage');
  assert.deepEqual(create.children.map((b) => b.type), ['heading_1', 'paragraph', 'bulleted_list_item', 'bulleted_list_item', 'code']);
  assert.equal(w.fake.writes().length, 1, 'no appendBlocks call for a short page');
  assert.equal(w.fake.blocks.get(w.fake.find('runs', 'Gate R2').page_id).length, 5);
});

// ---- idempotence, resume, create -> update ----

test('a failed op is recorded, the rest goes through, verify asks for a retry (exit 1); running again finishes only what is left', async () => {
  const w = await armed((p) => {
    p.update('claims', 'g1', null, { Readiness: 'Ready' });
    p.update('claims', 'g2', null, { Readiness: 'Fix needed' });
    p.update('claims', 'g3', null, { Readiness: 'Not checkable' });
  });
  w.fake.failNext('updatePage', new NotionError('Notion PATCH -> 503: down', { status: 503, code: 'service_unavailable', retryable: true }), { match: (i) => i.pageId === w.ids.claims.g2 });
  const first = await run(w);
  assert.equal(first.code, EXIT.ERROR);
  assert.match(first.err.join('\n'), /op 2 \(claims "g2"\) failed: Notion PATCH -> 503: down/);
  assert.match(first.out[0], /created 0, updated 2, skipped 0, failed 1; verify: run run-1: 1 of 3 op\(s\) did not land/);
  assert.deepEqual(ledger(w).map((r) => [r.seq, r.status]), [[1, 'ok'], [2, 'failed'], [3, 'ok']]);
  assert.equal(ledger(w)[1].retryable, true);
  const retry = readJsonl(join(w.root, 'runs', 'run-1', 'plan.retry.jsonl')).rows;
  assert.deepEqual(retry.map((r) => r.op === 'header' ? 'header' : r.seq), ['header', 2]);
  assert.equal(retry[0].retry_of, 'run-1');
  assert.ok(armedState(w.root), 'a run that did not finish stays armed');
  assert.equal(w.fake.find('claims', 'g2').props.Readiness, 'Needs editor');

  const sent = w.fake.writes().length;
  const second = await run(w);
  assert.equal(second.code, EXIT.OK, second.err.join('\n'));
  assert.equal(w.fake.writes().length, sent + 1, 'only the failed op was sent again');
  assert.match(second.out[0], /updated 1, skipped 0, failed 0, already done 2; verify clean/);
  assert.equal(w.fake.find('claims', 'g2').props.Readiness, 'Fix needed');
  assert.equal(readJsonFile(w, 'runs', 'run-1', 'apply.json').pre_pull, 'p1', 'the baseline of the first start is kept');
  assert.equal(readJsonFile(w, 'runs', 'run-1', 'apply.json').invocations, 2);
  assert.equal(existsSync(join(w.root, 'runs', 'run-1', 'plan.retry.jsonl')), false, 'a clean verify removes the retry file');
  assert.equal(armedState(w.root), null);
});

test('a create whose response was lost does not turn into a duplicate: the next run sees the row and updates it', async () => {
  const w = await armed((p) => {
    for (const t of ['A', 'B', 'C', 'D']) p.create('runs', `Run ${t}`, { Kind: 'Tag', 'Claims judged': 1 });
  });
  // creates land in Notion but the answer never arrives (three times in a row, which stops the run)
  const real = w.fake.client.createPage;
  let lost = 0;
  const flaky = { ...w.fake.client, createPage: async (a) => {
    const page = await real(a);
    if (lost++ < 3) throw new NotionError('Notion POST /pages: network failure', { code: 'network_error', retryable: true });
    return page;
  } };
  const first = await run(w, ['--run', 'run-1'], { client: flaky });
  assert.match(first.err.join('\n'), /stopped after 3 failures in a row/);
  assert.equal(w.fake.count('runs'), 1 + 3, 'three rows exist although no create was acknowledged (the world had one run)');
  assert.deepEqual(ledger(w).map((r) => r.status), ['failed', 'failed', 'failed']);
  // verify already sees A, B, C landed; only D is outstanding
  assert.equal(first.code, EXIT.ERROR);
  assert.deepEqual(readJsonl(join(w.root, 'runs', 'run-1', 'plan.retry.jsonl')).rows.filter((r) => r.op !== 'header').map((r) => r.key), ['Run D']);
  const second = await run(w, ['--run', 'run-1'], { client: w.fake.client });
  assert.equal(second.code, EXIT.OK, second.err.join('\n'));
  assert.equal(w.fake.count('runs'), 1 + 4, 'no duplicates');
  assert.match(second.out[0], /created 1, updated 0, skipped 3/);
  const rows = ledger(w);
  assert.deepEqual(rows.filter((r) => r.status === 'skipped').map((r) => r.reason), ['already up to date', 'already up to date', 'already up to date']);
  assert.equal(readJsonFile(w, 'runs', 'run-1', 'verify.json').result, 'clean');
});

test('a create whose key appeared in Notion since the plan was checked becomes an update', async () => {
  const w = await armed((p) => p.create('runs', 'Tag R1', { Kind: 'Tag', 'Claims judged': 3, Verdict: 'n/a' }));
  w.fake.add('runs', { 'Run title': 'Tag R1', Kind: 'Smoke' }); // somebody (or an earlier try) made it
  w.clock.advance(FRESH_MS + 1);
  const result = await run(w);
  assert.equal(result.code, EXIT.OK, result.err.join('\n'));
  assert.equal(w.fake.count('runs'), 2, 'one existing row in the world plus the one made above; none created');
  assert.deepEqual(w.fake.writes().map((x) => x.method), ['updatePage']);
  assert.equal(ledger(w)[0].kind, 'update');
  assert.equal(w.fake.find('runs', 'Tag R1').props.Kind, 'Tag');
  assert.match(result.out[0], /created 0, updated 1/);
});

test('--retry sends only the ops in plan.retry.jsonl, even ones the ledger calls ok', async () => {
  const w = await armed((p) => {
    p.update('claims', 'g1', null, { Readiness: 'Ready' });
    p.update('claims', 'g2', null, { Readiness: 'Fix needed' });
  });
  assert.equal((await run(w)).code, EXIT.OK);
  // something reverts g2 afterwards; verify notices and writes the retry file
  w.fake.editorSet(w.ids.claims.g2, { Readiness: 'Needs editor' });
  await w.pull('later', ['claims', 'agent_settings']);
  const { verify } = await import('../agents/claim-tagger/scripts/verify.mjs');
  const v = verify({ root: w.root, runId: 'run-1', prePullId: 'p1', postPullId: 'later', now: w.clock.now });
  assert.equal(v.code, EXIT.ERROR);
  assert.deepEqual(readJsonl(join(w.root, 'runs', 'run-1', 'plan.retry.jsonl')).rows.filter((r) => r.op !== 'header').map((r) => r.seq), [2]);
  // the run was disarmed when it finished; arm it again and retry
  assert.equal(check({ root: w.root, runId: 'run-1', pullId: 'later', now: w.clock.now }).code, EXIT.OK);
  const before = w.fake.writes().length;
  const result = await run(w, ['--run', 'run-1', '--retry']);
  assert.equal(result.code, EXIT.OK, result.err.join('\n'));
  assert.equal(w.fake.writes().length, before + 1);
  assert.equal(w.fake.find('claims', 'g2').props.Readiness, 'Fix needed');
  const none = await run(w, ['--run', 'run-1', '--retry']);
  assert.equal(none.code, EXIT.INVALID, 'a clean verify removed the retry file, and the run is disarmed');
});

test('a call Notion rejects (4xx) is not retried: exit 2, the retry file names the op, the run stays armed', async () => {
  const w = await armed((p) => {
    p.update('claims', 'g1', null, { Readiness: 'Ready' });
    p.update('claims', 'g2', null, { Readiness: 'Fix needed' });
  });
  w.fake.failNext('updatePage', new NotionError('Notion PATCH -> 400 validation_error: nope', { status: 400, code: 'validation_error' }), { match: (i) => i.pageId === w.ids.claims.g1 });
  const result = await run(w);
  assert.equal(result.code, EXIT.INVALID);
  assert.deepEqual(ledger(w).map((r) => [r.seq, r.status, r.retryable]), [[1, 'failed', false], [2, 'ok', undefined]]);
  assert.ok(existsSync(join(w.root, 'runs', 'run-1', 'plan.retry.jsonl')));
  assert.ok(armedState(w.root));
});

test('three failures in a row stop the run; the rest is left for the next start', async () => {
  const w = await armed((p) => { for (let i = 1; i <= 3; i++) p.update('claims', `g${i}`, null, { Readiness: 'Ready' }); p.update('agent_settings', 'claim-tagger', null, { 'Last run summary': 'x' }); });
  w.fake.failNext('updatePage', new NotionError('down', { status: 503, code: 'service_unavailable', retryable: true }), { times: 99 });
  const result = await run(w);
  assert.equal(result.code, EXIT.ERROR);
  assert.equal(w.fake.writes().length, 3, 'the fourth op was never tried');
  assert.deepEqual(ledger(w).map((r) => r.status), ['failed', 'failed', 'failed']);
  const retry = readJsonl(join(w.root, 'runs', 'run-1', 'plan.retry.jsonl')).rows.filter((r) => r.op !== 'header');
  assert.deepEqual(retry.map((r) => r.seq), [1, 2, 3, 4]);
});

test('a refused token (401) stops at once: exit 2, nothing else is sent, no read-back is attempted', async () => {
  const w = await armed((p) => { p.update('claims', 'g1', null, { Readiness: 'Ready' }); p.update('claims', 'g2', null, { Readiness: 'Ready' }); });
  w.fake.failNext('updatePage', new NotionError('Notion PATCH -> 401 unauthorized: API token is invalid', { status: 401, code: 'unauthorized' }), { times: 99 });
  const reads = () => w.fake.requests.filter((r) => r.method === 'queryAll').length;
  const before = reads();
  const result = await run(w);
  assert.equal(result.code, EXIT.INVALID);
  assert.match(result.err.join('\n'), /Notion refused the token/);
  assert.equal(w.fake.writes().length, 1);
  assert.equal(reads(), before, 'no post pull');
});

// ---- the allowlist at apply time ----

test('a row decided between the check and the apply is skipped, never overwritten', async () => {
  const w = await armed((p) => {
    p.update('tag_decisions', 'g1::Predictive', null, { 'Agent proposal': 'Add tag', 'Agent confidence': 0.9 });
    p.update('claims', 'g1', null, { Readiness: 'Ready' });
  });
  w.fake.editorSet(w.ids.decisions['g1::Predictive'], { 'Tag outcome': 'Does not apply', 'Decided by': [USER], 'Decided at': '2026-10-13' });
  w.clock.advance(FRESH_MS + 1);
  const result = await run(w);
  assert.equal(result.code, EXIT.OK, result.err.join('\n'));
  assert.match(result.out[0], /updated 1, skipped 1/);
  assert.match(result.err.join('\n'), /skipped op 1 \(tag_decisions "g1::Predictive"\): the row was decided since the plan was built/);
  assert.equal(w.fake.find('tag_decisions', 'g1::Predictive').props['Agent proposal'], 'Keep tag');
  assert.deepEqual(w.fake.writes().map((x) => x.db), ['claims']);
  assert.deepEqual(ledger(w).map((r) => [r.seq, r.status]), [[1, 'skipped'], [2, 'ok']]);
  assert.equal(readJsonFile(w, 'runs', 'run-1', 'verify.json').skipped.length, 1);
});

test('the fake never sees an editor-owned property or a new select option, whatever the plan', async () => {
  const w = await armed(standard);
  await run(w);
  const editor = ['Tag outcome', 'Why wrong', 'Your reasoning', 'Decided by', 'Decided at', 'Editor wording', 'Approved by', 'Paused', 'Paused by', 'Reason', 'Weekly cap', 'Owner'];
  for (const write of w.fake.writes()) for (const name of Object.keys(write.properties ?? {})) assert.equal(editor.includes(name), false, name);
  assert.deepEqual(w.fake.createdOptions, []);
});

// ---- preconditions ----

test('runs/PAUSED stops everything before anything is sent (exit 3)', async () => {
  const w = await armed(standard);
  writeFileSync(join(w.root, 'runs', 'PAUSED'), JSON.stringify({ run_id: 'old', page_id: 'p', field: 'Tag outcome' }));
  const result = await run(w);
  assert.equal(result.code, EXIT.PAUSED);
  assert.match(result.err.join('\n'), /runs\/PAUSED exists \(Tag outcome changed on page p during run old\)/);
  assert.deepEqual(w.fake.writes(), []);
  writeFileSync(join(w.root, 'runs', 'PAUSED'), 'garbage');
  assert.match((await run(w)).err.join('\n'), /the file is not readable/);
});

test('Paused ticked in Agent settings stops the run (exit 3), also when the source pull is reused', async () => {
  const w = await armed(standard);
  w.fake.editorSet(w.ids.settings, { Paused: true, 'Paused by': [USER] });
  w.clock.advance(FRESH_MS + 1);
  const result = await run(w);
  assert.equal(result.code, EXIT.PAUSED);
  assert.deepEqual(w.fake.writes(), []);
  // a fresh source pull that says paused is refused too
  const w2 = makeWorld();
  w2.fake.editorSet(w2.ids.settings, { Paused: true });
  await w2.pull('p1');
  const p = openPlan({ runId: 'run-1', root: w2.root, now: w2.clock.now });
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.write();
  check({ root: w2.root, runId: 'run-1', now: w2.clock.now });
  assert.equal((await run(w2)).code, EXIT.PAUSED);
  assert.deepEqual(w2.fake.writes(), []);
});

test('an unarmed run, a run armed for another plan and a plan edited after arming are refused (exit 2)', async () => {
  const w = makeWorld();
  await w.pull('p1');
  const p = openPlan({ runId: 'run-1', root: w.root, now: w.clock.now });
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.write();
  const unarmed = await run(w);
  assert.equal(unarmed.code, EXIT.INVALID);
  assert.match(unarmed.err.join('\n'), /run run-1 is not armed \(nothing is armed\)/);
  assert.equal(check({ root: w.root, runId: 'run-1', now: w.clock.now }).code, EXIT.OK);
  // hand edit: change a value in the plan file after arming
  const file = join(w.root, 'runs', 'run-1', 'plan.jsonl');
  writeFileSync(file, readFileSync(file, 'utf8').replace('"Ready"', '"Fix needed"'));
  const edited = await run(w);
  assert.equal(edited.code, EXIT.INVALID);
  assert.match(edited.err.join('\n'), /changed after it was armed/);
  assert.deepEqual(w.fake.writes(), []);
  // armed for a different run
  const q = openPlan({ runId: 'run-2', root: w.root, now: w.clock.now });
  q.update('claims', 'g2', null, { Readiness: 'Ready' });
  q.write();
  const other = await run(w, ['--run', 'run-2']);
  assert.equal(other.code, EXIT.INVALID);
  assert.match(other.err.join('\n'), /APPLYING\.json is for run-1/);
  assert.deepEqual(w.fake.writes(), []);
  const missing = await run(w, ['--run', 'no-such']);
  assert.equal(missing.code, EXIT.INVALID);
});

test('without a token: the batch files are written, exit 2 says "apply by connector", nothing is read or written in Notion', async () => {
  const w = await armed(standard);
  const before = w.fake.requests.length;
  const cap = captureIo();
  const code = await main(['--run', 'run-1'], cap.io, w.env({ client: null }));
  assert.equal(code, EXIT.INVALID);
  assert.match(cap.err.join('\n'), /apply by connector/);
  assert.match(cap.err.join('\n'), /batch file\(s\) are in/);
  assert.equal(cap.out.length, 0);
  assert.equal(w.fake.requests.length, before, 'no request at all');
  const files = readdirSync(join(w.root, 'runs', 'run-1', 'batches'));
  assert.ok(files.length >= 4, files.join(', '));
  assert.ok(files.every((f) => /^\d{3}-(create|update)-[a-z_]+\.jsonl?$/.test(f)), files.join(', '));
  assert.ok(armedState(w.root), 'still armed for the connector path');
});

test('a plan that touches a protected database is refused before anything is sent', async () => {
  const w = await armed(standard);
  const config = { ...w.config, notion: { ...w.config.notion, protected_database_ids: [w.config.notion.databases.runs.database_id] } };
  const result = await apply({ root: w.root, config, client: w.fake.client, runId: 'run-1', now: w.clock.now });
  assert.equal(result.code, EXIT.INVALID);
  assert.match(result.errors[0], /runs is not a configured trial database \(or is protected\)/);
  assert.deepEqual(w.fake.writes(), []);
});

// ---- dry run ----

test('--dry-run resolves and counts, sends and writes nothing, and works without a token', async () => {
  const w = await armed((p) => {
    standard(p);
    p.update('claims', 'g2', null, { Readiness: 'Ready' }, { expect: { Readiness: 'Fix needed' } });
  });
  const before = w.fake.requests.length;
  const cap = captureIo();
  const code = await main(['--run', 'run-1', '--dry-run'], cap.io, w.env({ client: null }));
  assert.equal(code, EXIT.OK, cap.err.join('\n'));
  assert.match(cap.out[0], /^apply: dry run for run-1 \(pull p1\): would create 2, update 2, skip 1; nothing was sent$/);
  assert.match(cap.err.join('\n'), /skipped op 5 \(claims "g2"\): expectation failed/);
  assert.equal(w.fake.requests.length, before);
  assert.equal(existsSync(join(w.root, 'runs', 'run-1', 'applied.jsonl')), false);
  assert.equal(existsSync(join(w.root, 'runs', 'run-1', 'apply.json')), false);
  assert.ok(armedState(w.root), 'still armed');
});

test('--dry-run on a plan that is not armed still previews it, with a note', async () => {
  const w = makeWorld();
  await w.pull('p1');
  const p = openPlan({ runId: 'run-1', root: w.root, now: w.clock.now });
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.write();
  const cap = captureIo();
  assert.equal(await main(['--run', 'run-1', '--dry-run'], cap.io, w.env()), EXIT.OK);
  assert.match(cap.err.join('\n'), /not armed for this plan yet/);
});

// ---- the trust breaker ----

test('an editor field changed on a touched page during the apply writes runs/PAUSED and exits 5', async () => {
  const w = await armed((p) => {
    p.update('tag_decisions', 'g1::Predictive', null, { 'Agent proposal': 'Add tag', 'Agent confidence': 0.9 });
    p.update('claims', 'g1', null, { Readiness: 'Ready' });
  });
  const target = w.ids.decisions['g1::Predictive'];
  w.fake.onWrite = ({ method, pageId }) => {
    if (method === 'updatePage' && pageId === target) { w.fake.onWrite = null; w.fake.editorSet(target, { 'Tag outcome': 'Applies', 'Decided by': [USER] }); }
  };
  const result = await run(w);
  assert.equal(result.code, EXIT.TRUST);
  assert.match(result.out[0], /TRUST BREAKER: Tag outcome changed on tag_decisions "g1::Predictive"/);
  const paused = readJsonFile(w, 'runs', 'PAUSED');
  assert.equal(paused.run_id, 'run-1');
  assert.equal(paused.page_id, target);
  assert.equal(paused.field, 'Tag outcome');
  assert.equal(paused.before, null);
  assert.equal(paused.after, 'Applies');
  assert.match(paused.detected_at, /^2026-10-13T/);
  assert.ok(paused.changes.some((c) => c.field === 'Decided by'));
  assert.ok(armedState(w.root), 'stays armed');
  assert.equal((await run(w)).code, EXIT.PAUSED, 'and the next apply refuses until a person deletes the file');
});

test('editors working on other pages during the apply are not a trust breaker', async () => {
  const w = await armed((p) => p.update('claims', 'g1', null, { Readiness: 'Ready' }));
  w.fake.onWrite = () => {
    w.fake.onWrite = null;
    w.fake.editorSet(w.ids.decisions['g1::Predictive'], { 'Tag outcome': 'Applies', 'Decided by': [USER] }); // a page the plan did not touch
  };
  const result = await run(w);
  assert.equal(result.code, EXIT.OK, result.err.join('\n'));
  assert.equal(existsSync(join(w.root, 'runs', 'PAUSED')), false);
});

// ---- the whole seed-style flow, create then link ----

test('a seed plan creates Rulebook-style rows with page ids that later plans can reference', async () => {
  const w = makeWorld({ populate: false });
  await w.pull('p0');
  const p = openPlan({ runId: 'seed-1', root: w.root, ctx: { seed: true }, now: w.clock.now });
  p.create('agent_settings', 'claim-tagger', { Name: 'claim-tagger', 'Weekly cap': 40, 'Rubric in force': '2026-10-13.1' });
  p.create('rulebook', 'Debate', { Status: 'Verified', Category: 'Usage', Polarity: 'Classification', 'When to use': 'Use when ...\n1. Rule.', 'Human only': false, Judged: true });
  p.write();
  assert.equal(check({ root: w.root, runId: 'seed-1', now: w.clock.now }).code, EXIT.OK);
  const result = await run(w, ['--run', 'seed-1']);
  assert.equal(result.code, EXIT.OK, result.err.join('\n'));
  assert.equal(w.fake.find('agent_settings', 'claim-tagger').props['Weekly cap'], 40);
  assert.equal(w.fake.find('rulebook', 'Debate').props['When to use'], 'Use when ...\n1. Rule.');
  // the next pull resolves the new rows by name
  await w.pull('p1');
  const q = openPlan({ runId: 'link-1', root: w.root, now: w.clock.now });
  const op = q.create('rule_changes', 'L', { Status: 'Proposed', Tag: { rulebook: 'Debate' } });
  assert.deepEqual(op.properties.Tag, [w.fake.find('rulebook', 'Debate').page_id]);
});

// ---- markdown ----

test('markdownToBlocks: headings, paragraphs, bullets, numbers, fenced code, long text', () => {
  const blocks = markdownToBlocks('# One\n## Two\n### Three\n#### Four\n\nA paragraph\nover two lines.\n\n- bullet a\n* bullet b\n1. first\n2. second\n\n```js\nconst x = 1;\n```\n```\nplain\n```\n\n\n');
  assert.deepEqual(blocks.map((b) => b.type), ['heading_1', 'heading_2', 'heading_3', 'heading_3', 'paragraph', 'bulleted_list_item', 'bulleted_list_item', 'numbered_list_item', 'numbered_list_item', 'code', 'code']);
  const text = (b) => b[b.type].rich_text.map((r) => r.text.content).join('');
  assert.equal(text(blocks[4]), 'A paragraph\nover two lines.');
  assert.equal(text(blocks[0]), 'One');
  assert.equal(text(blocks[3]), 'Four');
  assert.equal(blocks[9].code.language, 'javascript');
  assert.equal(text(blocks[9]), 'const x = 1;');
  assert.equal(blocks[10].code.language, 'plain text');
  assert.ok(blocks.every((b) => b.object === 'block'));
  const long = markdownToBlocks('x'.repeat(4500));
  assert.deepEqual(long[0].paragraph.rich_text.map((r) => r.text.content.length), [2000, 2000, 500]);
  assert.deepEqual(markdownToBlocks(''), []);
  assert.deepEqual(markdownToBlocks(null), []);
  assert.deepEqual(markdownToBlocks('\r\n\r\n'), []);
  assert.equal(markdownToBlocks('```\nunterminated')[0].type, 'code', 'an unterminated fence still yields its code');
});

// ---- command line ----

test('command line: usage errors, help, and a missing token message for a real run', async () => {
  const w = makeWorld();
  for (const argv of [[], ['--run'], ['--bogus'], ['x']]) {
    const c = captureIo();
    assert.equal(await main(argv, c.io, w.env()), EXIT.INVALID, JSON.stringify(argv));
    assert.match(c.err.join('\n'), /usage:/);
  }
  const help = captureIo();
  assert.equal(await main(['--help'], help.io, w.env()), EXIT.OK);
  assert.match(help.out[0], /^usage: /);
  const noToken = captureIo();
  assert.equal(await main(['--run', 'run-1'], noToken.io, { root: w.root, repoRoot: w.repo }), EXIT.INVALID, 'no client given and no .env in the temporary repo root');
});

// ---- through the real REST client, over a fake HTTP surface, with the token from .env ----

test('pull, plan, apply and verify over HTTP: the token comes from .env, goes only into the Authorization header, and appears in no file or output', async () => {
  const { createFakeNotion, realConfig } = await import('./fixtures/notion/fake-notion.mjs');
  const { buildWorld, makeRoot } = await import('./fixtures/notion/helpers.mjs');
  const { main: pullMain } = await import('../agents/claim-tagger/scripts/pull.mjs');
  const { readdirSync, readFileSync: read, statSync } = await import('node:fs');
  const TOKEN = 'ntn_FAKE_TOKEN_FOR_TESTS_0123456789abcdef';
  const config = realConfig();
  const fast = { ...config, notion: { ...config.notion, requests_per_second: 1000 } };
  const fake = createFakeNotion();
  const ids = buildWorld(fake);
  const r = makeRoot({ config: fast });
  writeFileSync(join(r.repo, '.env'), `NOTION_TOKEN=${TOKEN}\r\n`);
  const outputs = [];
  const io = { out: (s) => outputs.push(s), err: (s) => outputs.push(s) };
  const env = { root: r.root, repoRoot: r.repo, fetchImpl: fake.fetch };

  assert.equal(await pullMain(['--all', '--pull-id', 'p1'], io, env), EXIT.OK, outputs.join('\n'));
  const p = openPlan({ runId: 'run-http', root: r.root });
  p.update('claims', 'g1', null, { Readiness: 'Ready', 'Tag confidence': 'Debate: apply (0.9)' });
  p.create('runs', 'Tag R1', { Kind: 'Tag', 'Claims judged': 3, Verdict: 'n/a', Started: '2026-10-13T12:00:00.000Z' }, { content_md: '# Card\n\nPASS' });
  p.update('agent_settings', 'claim-tagger', null, { 'Last run summary': 'ok' });
  p.write();
  assert.equal(check({ root: r.root, runId: 'run-http' }).code, EXIT.OK);
  assert.equal(await main(['--run', 'run-http'], io, env), EXIT.OK, outputs.join('\n'));

  assert.equal(fake.find('claims', 'g1').props.Readiness, 'Ready');
  assert.equal(fake.find('runs', 'Tag R1').props.Kind, 'Tag');
  assert.equal(fake.blocks.get(fake.find('runs', 'Tag R1').page_id).length, 2);
  assert.equal(fake.find('agent_settings', 'claim-tagger').props['Last run summary'], 'ok');
  assert.ok(fake.seenHeaders.length > 10);
  assert.ok(fake.seenHeaders.every((h) => h.Authorization === `Bearer ${TOKEN}` && h['Notion-Version'] === '2022-06-28'));
  assert.equal(ids.settings, fake.find('agent_settings', 'claim-tagger').page_id);

  assert.equal(outputs.join('\n').includes(TOKEN), false, 'not in any printed line');
  const walk = (dir) => readdirSync(dir).flatMap((n) => { const f = join(dir, n); return statSync(f).isDirectory() ? walk(f) : [f]; });
  const leaks = walk(r.root).filter((f) => read(f, 'utf8').includes(TOKEN));
  assert.deepEqual(leaks, [], 'not in the plan, the ledger, the pulls or any other file');
});

test('over HTTP a wrong token is refused by Notion: pull exits 2 and says what to check, without printing the token', async () => {
  const { createFakeNotion, realConfig } = await import('./fixtures/notion/fake-notion.mjs');
  const { makeRoot } = await import('./fixtures/notion/helpers.mjs');
  const { main: pullMain } = await import('../agents/claim-tagger/scripts/pull.mjs');
  const config = realConfig();
  const fake = createFakeNotion();
  const r = makeRoot({ config: { ...config, notion: { ...config.notion, requests_per_second: 1000 } } });
  writeFileSync(join(r.repo, '.env'), 'NOTION_TOKEN=x\n'); // too short for the fake to accept
  const cap = captureIo();
  assert.equal(await pullMain(['--all', '--pull-id', 'p1'], cap.io, { root: r.root, repoRoot: r.repo, fetchImpl: fake.fetch }), EXIT.INVALID);
  assert.match(cap.err.join('\n'), /401 unauthorized/);
  assert.match(cap.err.join('\n'), /integration is connected/);
});
