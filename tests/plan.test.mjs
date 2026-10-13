import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { armedState, check, disarm, main, openPlan, readPlan, resolveOps, runDirOf, toConnectorProperties, writeBatches } from '../agents/claim-tagger/scripts/plan.mjs';
import { allowlistSha } from '../agents/claim-tagger/scripts/allowlist.mjs';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { fileSha256 } from '../agents/claim-tagger/scripts/lib/hash.mjs';
import { readJsonl } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { validate } from '../agents/claim-tagger/scripts/lib/validate.mjs';
import { planSchema } from '../agents/claim-tagger/scripts/plan.mjs';
import { USER, captureIo, cleanupRoots, makeWorld } from './fixtures/notion/helpers.mjs';

after(cleanupRoots);

async function ready() {
  const w = makeWorld();
  await w.pull('p1');
  return w;
}
const planOf = (w, runId = 'run-1', opts = {}) => openPlan({ runId, root: w.root, ...opts });
const readOps = (w, runId = 'run-1') => readJsonl(join(w.root, 'runs', runId, 'plan.jsonl')).rows;
const runCheck = (w, runId = 'run-1', pullId) => check({ root: w.root, runId, pullId, now: w.clock.now });

// ---- building ----

test('create and update ops are built, numbered, written with a header and validated against plan-op.schema.json', async () => {
  const w = await ready();
  const p = planOf(w);
  p.create('runs', 'Tag R1', { Kind: 'Tag', 'Claims judged': 3, Verdict: 'n/a' }, { note: 'first' });
  p.update('claims', 'g1', w.ids.claims.g1, { Readiness: 'Ready', 'Tag confidence': 'Debate: apply (0.9)' }, { note: 'second' });
  assert.throws(() => p.create('claims', 'new-geo-2', { 'Claim title': 'x' }), (e) => e.code === 'ALLOWLIST', 'a claim cannot be created without the seed flag');
  const written = p.write();
  assert.equal(written.path, join(w.root, 'runs', 'run-1', 'plan.jsonl'));
  assert.equal(written.sha, fileSha256(written.path));
  const rows = readOps(w);
  assert.equal(rows.length, 2 + 1);
  assert.deepEqual(rows[1].properties, { 'Run title': 'Tag R1', Kind: 'Tag', 'Claims judged': 3, Verdict: 'n/a' });
  const [header, ...ops] = rows;
  assert.equal(header.op, 'header');
  assert.equal(header.run_id, 'run-1');
  assert.equal(header.plan_id, 'plan-run-1');
  assert.equal(header.source_pull, 'p1');
  assert.deepEqual(header.counts, { create: 1, update: 1, by_database: { runs: { create: 1, update: 0 }, claims: { create: 0, update: 1 } } });
  assert.equal(header.allowlist_sha, allowlistSha());
  assert.deepEqual(header.ctx, { seed: false, promote: false, gate: null });
  assert.equal(ops.length, 2);
  assert.equal(ops[0].seq, 1);
  assert.equal(ops[0].op, 'create');
  assert.equal(ops[0].page_id, null);
  assert.equal(ops[0].note, 'first');
  assert.equal(ops[1].seq, 2);
  assert.equal(ops[1].op, 'update');
  assert.equal(ops[1].page_id, w.ids.claims.g1);
  assert.equal(ops[1].database, 'claims');
  assert.deepEqual(ops[1].properties, { Readiness: 'Ready', 'Tag confidence': 'Debate: apply (0.9)' });
  for (const line of rows) assert.deepEqual(validate(planSchema(), line), { ok: true, errors: [] });
  const back = readPlan(w.root, 'run-1');
  assert.equal(back.sha, written.sha);
  assert.deepEqual(back.ops, ops);
});

test('a seed plan may create claims; the key property is filled in and checked', async () => {
  const w = await ready();
  const p = planOf(w, 'seed-1', { ctx: { seed: true } });
  const op = p.create('claims', 'geo-77', { 'Claim title': 'Seed claim', Sample: 'Random' });
  assert.equal(op.properties['Geo ID'], 'geo-77', 'create fills the key property');
  assert.throws(() => p.create('claims', 'geo-78', { 'Geo ID': 'other', 'Claim title': 'x' }), /key property Geo ID says "other"/);
  p.create('claims', 'geo-79', { 'Geo ID': 'geo-79', 'Claim title': 'Same key given twice' });
  assert.equal(p.write().header.ctx.seed, true);
});

test('update: the page id comes from the pull when omitted, must match when given, the key may not be renamed', async () => {
  const w = await ready();
  const p = planOf(w);
  const op = p.update('claims', 'g2', null, { Readiness: 'Ready' });
  assert.equal(op.page_id, w.ids.claims.g2);
  assert.throws(() => p.update('claims', 'g1', w.ids.claims.g2, { Readiness: 'Ready' }), /not the pull's row for this key/);
  assert.throws(() => p.update('claims', 'nobody', null, { Readiness: 'Ready' }), /no page id given and none in pull p1/);
  assert.throws(() => p.update('claims', 'g3', null, { 'Geo ID': 'renamed', Readiness: 'Ready' }), /may not rename/);
  const same = p.update('claims', 'g3', null, { 'Geo ID': 'g3', Readiness: 'Ready' });
  assert.deepEqual(same.properties, { Readiness: 'Ready' }, 'the unchanged key is dropped from an update');
});

test('one op per row, known databases, keys and object properties are required', async () => {
  const w = await ready();
  const p = planOf(w);
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  assert.throws(() => p.update('claims', 'g1', null, { Readiness: 'Fix needed' }), /already in this plan/);
  assert.throws(() => p.update('nope', 'k', 'id', {}), /unknown database "nope"/);
  assert.throws(() => p.update('claims', '', 'id', {}), /needs a key/);
  assert.throws(() => p.update('claims', 'g2', null, [1]), /properties must be an object/);
  assert.throws(() => p.update('claims', 'g2', null, { Readiness: 'Maybe' }), (e) => e.code === 'ALLOWLIST' && e.reason === 'unknown-option');
  assert.throws(() => p.update('claims', 'g2', null, { 'Tag confidence': 5 }), /string or null/, 'a value the encoder would reject is caught while building');
});

test('the allowlist is applied while building: editor fields, computed fields, seed fields, decided rows, When to use, Status', async () => {
  const w = await ready();
  const p = planOf(w);
  const refused = (fn, reason) => assert.throws(fn, (e) => e.code === 'ALLOWLIST' && (reason === undefined || e.reason === reason));
  refused(() => p.update('tag_decisions', 'g1::Predictive', null, { 'Tag outcome': 'Applies' }), 'editor-owned');
  refused(() => p.update('tag_decisions', 'g1::Predictive', null, { 'Why wrong': 'Agent slip' }), 'editor-owned');
  refused(() => p.update('tag_decisions', 'g1::Predictive', null, { Stage: 'Closed' }), 'computed');
  refused(() => p.update('tag_decisions', 'g1::Predictive', null, { 'Seeded outcome': 'Applies' }), 'seed-only');
  refused(() => p.update('tag_decisions', 'g2::Predictive', null, { 'Agent proposal': 'Add tag' }), 'decided-row'); // seeded = decided
  refused(() => p.update('tag_decisions', 'g3::Hypothetical', null, { Priority: 'Medium' }), 'decided-row'); // editor-decided
  p.update('tag_decisions', 'g2::Predictive', null, { 'Agent follow-up': 'Fixed', 'Follow-up run': 'Follow-up R2' });
  p.update('tag_decisions', 'g1::Predictive', null, { 'Agent proposal': 'Add tag', 'Agent confidence': 0.9 });
  refused(() => p.update('rulebook', 'Predictive', null, { 'When to use': '1. x' }), 'promote-only');
  refused(() => p.update('rule_changes', 'Hedged trajectories are not forecasts', null, { Status: 'Approved' }), 'status-value');
  refused(() => p.update('rule_changes', 'Hedged trajectories are not forecasts', null, { Status: 'Proposed' }), 'status-value');
  refused(() => p.update('rule_changes', 'Hedged trajectories are not forecasts', null, { 'Editor wording': 'mine' }), 'editor-owned');
  refused(() => p.update('agent_settings', 'claim-tagger', null, { Paused: true }), 'editor-owned');
  refused(() => p.update('agent_settings', 'claim-tagger', null, { 'Weekly cap': 99 }), 'editor-owned');
  refused(() => p.update('claims', 'g1', null, { 'Tag decisions': [w.ids.decisions['g1::Predictive']] }), 'computed');
  p.update('agent_settings', 'claim-tagger', null, { 'Rubric in force': '2026-10-14.1', 'Last run at': '2026-10-14T09:00:00.000Z' });
  const promote = planOf(w, 'promote-1', { ctx: { promote: true, gate: 'PASS' } });
  promote.update('rulebook', 'Predictive', null, { 'When to use': '1. New text.', 'Rule version': '2026-10-14.1', 'Tag hash': 'sha256:feedfacefeedface' });
  promote.update('rule_changes', 'Hedged trajectories are not forecasts', null, { Status: 'Live', 'Gate result': 'PASS (small sample)' });
  assert.equal(promote.write().header.ctx.gate, 'PASS');
});

test('a new rule change may be created Proposed; creating it Approved is refused', async () => {
  const w = await ready();
  const p = planOf(w);
  p.create('rule_changes', 'Lesson two', { 'Lesson title': 'Lesson two', Status: 'Proposed', Kind: 'Clarify wording', Tag: [{ rulebook: 'Debate' }] });
  assert.throws(() => p.create('rule_changes', 'Lesson three', { Status: 'Approved' }), (e) => e.reason === 'status-value');
});

test('tag_decisions ops need tag_decisions in the source pull', async () => {
  const w = makeWorld();
  await w.pull('only-claims', ['claims', 'rulebook']);
  const p = planOf(w, 'run-1', { sourcePull: 'only-claims' });
  assert.throws(() => p.update('tag_decisions', 'g1::Predictive', 'x', { 'Agent proposal': 'Add tag' }), /tag_decisions is not in pull only-claims/);
  p.update('claims', 'g1', null, { Readiness: 'Ready' }); // other databases are fine
});

// ---- relations ----

test('relations are resolved from the id map: single references, lists, mixed with ids, duplicates removed', async () => {
  const w = await ready();
  const p = planOf(w, 'run-1', { ctx: { seed: true } });
  const raw = 'f0f0f0f0-0000-4000-8000-0000000000aa';
  const decision = p.create('tag_decisions', 'g1::Debate', {
    Claim: { claims: 'g1' }, Tag: { rulebook: 'Debate' }, Lesson: [{ rule_changes: 'Hedged trajectories are not forecasts' }, raw, { rule_changes: 'Hedged trajectories are not forecasts' }],
  });
  assert.deepEqual(decision.properties.Claim, [w.ids.claims.g1]);
  assert.deepEqual(decision.properties.Tag, [w.ids.rulebook.Debate]);
  assert.deepEqual(decision.properties.Lesson, [w.ids.lesson, raw]);
  const claim = p.update('claims', 'g1', null, { 'Agent tags': [{ rulebook: 'Debate' }, { rulebook: 'Opinion' }, { rulebook: 'Simple' }] });
  assert.deepEqual(claim.properties['Agent tags'], [w.ids.rulebook.Debate, w.ids.rulebook.Opinion, w.ids.rulebook.Simple]);
  const run = p.create('runs', 'Tag R1', { Lesson: { rule_changes: 'Hedged trajectories are not forecasts' } });
  assert.deepEqual(run.properties.Lesson, [w.ids.lesson]);
  const viaKey = p.update('rule_changes', 'Hedged trajectories are not forecasts', null, { Tag: { rulebook: 'Predictive' } });
  assert.deepEqual(viaKey.properties.Tag, [w.ids.rulebook.Predictive]);
  const refs = p.create('runs', 'Run two', { Lesson: { tag_decisions: 'g1::Predictive' } });
  assert.deepEqual(refs.properties.Lesson, [w.ids.decisions['g1::Predictive']], 'any database can be referenced; the relation target is Notion\'s business');
});

test('an unresolved reference, a reference outside a relation, and a malformed relation value all throw', async () => {
  const w = await ready();
  const p = planOf(w);
  assert.throws(() => p.update('claims', 'g1', null, { 'Agent tags': [{ rulebook: 'No such tag' }] }), /unresolved reference \{"rulebook":"No such tag"\}.*pull p1/);
  assert.throws(() => p.update('claims', 'g1', null, { 'Agent tags': { claims: 'zzz' } }), /unresolved reference/);
  assert.throws(() => p.update('claims', 'g1', null, { Readiness: { rulebook: 'Debate' } }), /only for relation properties/);
  assert.throws(() => p.update('claims', 'g1', null, { 'Agent tags': [42] }), /page ids or \{ <database>: <key> \} references/);
  assert.throws(() => p.update('claims', 'g1', null, { 'Agent tags': [{ rulebook: 'Debate', extra: 1 }] }), /page ids or/);
});

// ---- check: re-validation, upsert, skips, batches, arming ----

test('check: a create whose key exists becomes an update, a new key stays a create; batches and check.json are written; the plan is armed', async () => {
  const w = await ready();
  const p = planOf(w, 'run-1', { ctx: { seed: true } });
  p.create('claims', 'g1', { 'Claim title': 'Texas is on track to become a competitive swing state', Table: 'U.S. Politics', Readiness: 'Ready' });
  p.create('claims', 'fresh-1', { 'Claim title': 'A fresh claim', 'Sources count': 4, Table: 'U.S. Politics', 'Source URLs': 'u1\nu2' }, { content_md: '# Heading\n\ntext' });
  const { sha } = p.write();
  const result = runCheck(w);
  assert.equal(result.code, EXIT.OK, result.problems?.join('; '));
  assert.match(result.line, /^plan check: run run-1 \(pull p1\): 2 to apply \(1 create, 1 update, 1 converted\), 0 skipped, 2 batch file\(s\); armed [0-9a-f]{12}$/);
  const summary = JSON.parse(readFileSync(join(w.root, 'runs', 'run-1', 'check.json'), 'utf8'));
  assert.equal(summary.plan_sha, sha);
  assert.equal(summary.pull_id, 'p1');
  assert.deepEqual(summary.converted, [{ seq: 1, database: 'claims', key: 'g1' }]);
  assert.deepEqual(summary.batches.map((b) => [b.file, b.kind, b.count]), [['001-update-claims.jsonl', 'update', 1], ['002-create-claims.json', 'create', 1]]);
  const armed = JSON.parse(readFileSync(join(w.root, 'runs', 'APPLYING.json'), 'utf8'));
  assert.deepEqual(Object.keys(armed).sort(), ['armed_at', 'plan_sha', 'run_id']);
  assert.equal(armed.run_id, 'run-1');
  assert.equal(armed.plan_sha, sha);
  assert.equal(armed.armed_at, '2026-10-13T12:00:00.000Z');
  const update = readJsonl(join(w.root, 'runs', 'run-1', 'batches', '001-update-claims.jsonl')).rows;
  assert.deepEqual(update, [{ page_id: w.ids.claims.g1, properties: { 'Claim title': 'Texas is on track to become a competitive swing state', Table: 'U.S. Politics', Readiness: 'Ready' } }]);
  // the key property is not rewritten on a converted create
  const create = JSON.parse(readFileSync(join(w.root, 'runs', 'run-1', 'batches', '002-create-claims.json'), 'utf8'));
  assert.deepEqual(create.parent, { data_source_id: w.config.notion.databases.claims.data_source_id });
  assert.deepEqual(create.pages, [{ properties: { 'Claim title': 'A fresh claim', 'Sources count': 4, 'Source URLs': 'u1\nu2', Table: 'U.S. Politics', 'Geo ID': 'fresh-1' }, content: '# Heading\n\ntext' }]);
});

test('check: batches hold at most 100 pages each, grouped by kind and database, in the order the ops first appear', async () => {
  const w = await ready();
  const p = planOf(w, 'big', { ctx: { seed: true } });
  for (let i = 0; i < 250; i++) p.create('claims', `bulk-${String(i).padStart(3, '0')}`, { 'Claim title': `Bulk ${i}`, Table: 'U.S. Politics' });
  p.create('runs', 'Run X', { Kind: 'Tag' });
  for (let i = 0; i < 3; i++) p.update('claims', `g${i + 1}`, null, { Readiness: 'Ready' });
  p.write();
  const result = runCheck(w, 'big');
  assert.equal(result.code, EXIT.OK);
  const files = readdirSync(join(w.root, 'runs', 'big', 'batches'));
  assert.deepEqual(files, ['001-create-claims.json', '002-create-claims.json', '003-create-claims.json', '004-create-runs.json', '005-update-claims.jsonl']);
  const sizes = files.slice(0, 3).map((f) => JSON.parse(readFileSync(join(w.root, 'runs', 'big', 'batches', f), 'utf8')).pages.length);
  assert.deepEqual(sizes, [100, 100, 50]);
  assert.equal(readJsonl(join(w.root, 'runs', 'big', 'batches', '005-update-claims.jsonl')).rows.length, 3);
  assert.equal(Math.max(...sizes) <= 100, true);
});

test('check: an expectation that no longer holds skips the op and says why; the batches leave it out', async () => {
  const w = await ready();
  const p = planOf(w);
  p.update('claims', 'g1', null, { Readiness: 'Ready' }, { expect: { Readiness: 'Needs editor' } });
  p.update('claims', 'g2', null, { Readiness: 'Ready' }, { expect: { Readiness: 'Not checkable' } }); // it is Needs editor in Notion
  p.update('claims', 'g3', null, { Readiness: 'Ready' }, { expect: { 'Sources count': 2, Sample: 'Decided' } });
  p.write();
  const result = runCheck(w);
  assert.equal(result.code, EXIT.OK);
  assert.deepEqual(result.summary.skipped.map((s) => [s.seq, s.key]), [[2, 'g2']]);
  assert.match(result.summary.skipped[0].reason, /expectation failed: Readiness is no longer "Not checkable"/);
  const lines = readJsonl(join(w.root, 'runs', 'run-1', 'batches', '001-update-claims.jsonl')).rows;
  assert.deepEqual(lines.map((l) => l.page_id), [w.ids.claims.g1, w.ids.claims.g3]);
  assert.match(result.line, /1 skipped/);
});

test('check: expect on last_edited_time catches a row somebody touched after the pull', async () => {
  const w = await ready();
  const seen = w.fake.find('claims', 'g1').last_edited_time;
  const p = planOf(w);
  p.update('claims', 'g1', null, { Readiness: 'Ready' }, { expect: { $last_edited_time: seen } });
  p.update('claims', 'g2', null, { Readiness: 'Ready' }, { expect: { $last_edited_time: 'not the time' } });
  p.write();
  const result = runCheck(w);
  assert.deepEqual(result.summary.skipped.map((s) => s.key), ['g2']);
});

test('check: a row decided between build and check is skipped (decided rule or guard); follow-up fields on a decided row still go through', async () => {
  const w = await ready();
  w.fake.add('tag_decisions', { Key: 'g1::Hypothetical', Tag: [w.ids.rulebook.Hypothetical], Claim: [w.ids.claims.g1], 'Agent proposal': 'Do not add tag' });
  await w.pull('p1b');
  const p = planOf(w, 'run-1', { sourcePull: 'p1b' });
  p.update('tag_decisions', 'g1::Hypothetical', null, { 'Agent proposal': 'Add tag', 'Agent confidence': 0.8 }, { note: 'rewrite the proposal' });
  p.update('tag_decisions', 'g1::Predictive', null, { 'Agent follow-up': 'Fixed' }, { guard: { undecided: true } });
  p.update('tag_decisions', 'g2::Predictive', null, { 'Agent follow-up': 'Fixed', 'Follow-up run': 'Follow-up R2' }); // seeded, so decided already when built
  p.write();
  // editors decide the first two rows, then the world is pulled again
  w.fake.editorSet(w.fake.find('tag_decisions', 'g1::Hypothetical').page_id, { 'Tag outcome': 'Applies', 'Decided by': [USER] });
  w.fake.editorSet(w.ids.decisions['g1::Predictive'], { 'Tag outcome': 'Does not apply', 'Decided by': [USER] });
  await w.pull('p2');
  const result = runCheck(w, 'run-1', 'p2');
  assert.equal(result.code, EXIT.OK);
  assert.deepEqual(result.summary.skipped.map((s) => s.seq), [1, 2]);
  assert.match(result.summary.skipped[0].reason, /decided since the plan was built \(it would write Agent proposal, Agent confidence\)/);
  assert.match(result.summary.skipped[1].reason, /guard: the row has been decided/);
  assert.equal(result.summary.to_apply, 1);
  const lines = readJsonl(join(w.root, 'runs', 'run-1', 'batches', '001-update-tag_decisions.jsonl')).rows;
  assert.deepEqual(lines, [{ page_id: w.ids.decisions['g2::Predictive'], properties: { 'Agent follow-up': 'Fixed', 'Follow-up run': 'Follow-up R2' } }]);
});

test('check: an update that would change nothing is skipped as already up to date', async () => {
  const w = await ready();
  const p = planOf(w, 'run-1', { ctx: { seed: true } });
  p.update('claims', 'g1', null, { 'Sources count': 2, 'Table': 'U.S. Politics', 'Source URLs': 'https://geo.test/s1-g1\r\nhttps://geo.test/s2-g1' }); // equal after normalisation
  p.update('claims', 'g2', null, { 'Sources count': 3 });
  p.write();
  const result = runCheck(w);
  assert.deepEqual(result.summary.skipped.map((s) => [s.key, s.reason]), [['g1', 'already up to date']]);
  assert.equal(result.summary.to_apply, 1);
});

test('check: the same row twice in Notion is skipped for a person to merge', async () => {
  const w = makeWorld();
  w.fake.add('claims', { 'Claim title': 'twin', 'Geo ID': 'g1' });
  await w.pull('p1');
  const p = planOf(w);
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.update('claims', 'g2', null, { Readiness: 'Ready' });
  p.write();
  const result = runCheck(w);
  assert.deepEqual(result.summary.skipped.map((s) => [s.key, /twice in Notion/.test(s.reason)]), [['g1', true]]);
});

test('check: a row that vanished or moved is skipped; a page id that disagrees with the pull is skipped', async () => {
  const w = await ready();
  const p = planOf(w);
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.update('claims', 'g2', null, { Readiness: 'Ready' });
  p.write();
  const ops = readOps(w);
  ops[2].page_id = w.ids.claims.g3; // the plan claims a different page than the pull has for this key
  writeFileSync(join(w.root, 'runs', 'run-1', 'plan.jsonl'), ops.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const result = runCheck(w);
  assert.equal(result.code, EXIT.OK);
  assert.deepEqual(result.summary.skipped.map((s) => s.key), ['g2']);
  assert.match(result.summary.skipped[0].reason, /the plan says page/);
});

test('check: a plan edited by hand into something the allowlist refuses is rejected with exit 2 and arms nothing', async () => {
  const w = await ready();
  const p = planOf(w);
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.write();
  const ops = readOps(w);
  ops[1].properties = { 'Tag outcome': 'Applies' };
  ops[1].database = 'tag_decisions';
  ops[1].key = 'g1::Predictive';
  ops[1].page_id = w.ids.decisions['g1::Predictive'];
  writeFileSync(join(w.root, 'runs', 'run-1', 'plan.jsonl'), ops.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const result = runCheck(w);
  assert.equal(result.code, EXIT.INVALID);
  assert.match(result.problems[0], /op 1 \(tag_decisions "g1::Predictive"\).*editor/);
  assert.equal(armedState(w.root), null);
  // a seed-only field smuggled into a plan whose header says no seed is refused too
  const ops2 = readOps(w);
  ops2[1] = { ...ops2[1], database: 'claims', key: 'g1', page_id: w.ids.claims.g1, properties: { 'Geo link': 'https://evil.test' } };
  writeFileSync(join(w.root, 'runs', 'run-1', 'plan.jsonl'), ops2.map((o) => JSON.stringify(o)).join('\n') + '\n');
  assert.match(runCheck(w).problems[0], /seed/);
});

test('check: malformed plans are rejected with every problem named', async () => {
  const w = await ready();
  const p = planOf(w);
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.update('claims', 'g2', null, { Readiness: 'Ready' });
  p.write();
  const good = readOps(w);
  const put = (rows, tail = '\n') => writeFileSync(join(w.root, 'runs', 'run-1', 'plan.jsonl'), rows.map((o) => (typeof o === 'string' ? o : JSON.stringify(o))).join('\n') + tail);
  put([good[1], good[2]]); // no header
  assert.match(runCheck(w).problems.join(' | '), /the first line must be the header/);
  put([good[0], { ...good[1], seq: 5 }, good[2]]);
  assert.match(runCheck(w).problems.join(' | '), /seq 5, expected 1/);
  put([good[0], { ...good[1], op: 'delete' }, good[2]]);
  assert.equal(runCheck(w).code, EXIT.INVALID);
  put([{ ...good[0], run_id: 'other' }, good[1], good[2]]);
  assert.match(runCheck(w).problems.join(' | '), /header says run "other"/);
  put([good[0], good[1], { ...good[0] }]);
  assert.match(runCheck(w).problems.join(' | '), /a second header/);
  put([good[0], good[1], '{"op":"update","seq":2,'], '');
  assert.match(runCheck(w).problems.join(' | '), /cut off/);
  put([good[0], '{"op":"update","seq":1,', good[2]]);
  assert.match(runCheck(w).problems.join(' | '), /line 2 is not valid JSON/);
  const missing = check({ root: w.root, runId: 'no-such-run' });
  assert.equal(missing.code, EXIT.INVALID);
  assert.match(missing.problems[0], /there is no plan for run "no-such-run"/);
});

test('check: the pull must cover every database the plan touches', async () => {
  const w = await ready();
  const p = planOf(w);
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.write();
  await w.pull('p-rulebook-only', ['rulebook']);
  const result = runCheck(w, 'run-1', 'p-rulebook-only');
  assert.equal(result.code, EXIT.INVALID);
  assert.match(result.problems[0], /does not cover claims/);
  assert.equal(armedState(w.root), null);
  assert.equal(runCheck(w, 'run-1', 'no-such-pull').code, EXIT.INVALID);
});

test('arming: one run at a time; re-checking the same run re-arms; disarm clears it', async () => {
  const w = await ready();
  for (const id of ['run-a', 'run-b']) {
    const p = planOf(w, id);
    p.update('claims', 'g1', null, { Readiness: 'Ready' });
    p.write();
  }
  assert.equal(runCheck(w, 'run-a').code, EXIT.OK);
  const second = runCheck(w, 'run-b');
  assert.equal(second.code, EXIT.INVALID);
  assert.match(second.problems[0], /run run-a is still armed/);
  assert.equal(armedState(w.root).run_id, 'run-a');
  assert.equal(runCheck(w, 'run-a').code, EXIT.OK, 're-check of the armed run is fine');
  assert.equal(disarm(w.root), 'run-a');
  assert.equal(armedState(w.root), null);
  assert.equal(disarm(w.root), null);
  assert.equal(runCheck(w, 'run-b').code, EXIT.OK);
  writeFileSync(join(w.root, 'runs', 'APPLYING.json'), '{broken');
  assert.deepEqual(armedState(w.root), { unreadable: true });
  assert.match(runCheck(w, 'run-b').problems[0], /unreadable APPLYING\.json/);
});

test('check clears the guard ledger of the run it arms', async () => {
  const w = await ready();
  const p = planOf(w);
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.write();
  const ledger = join(w.root, 'runs', 'run-1', 'guard-ledger.jsonl');
  writeFileSync(ledger, '{"sha":"x"}\n');
  runCheck(w);
  assert.equal(existsSync(ledger), false);
});

// ---- connector shape ----

test('toConnectorProperties: the flat connector form of every property type', async () => {
  const w = await ready();
  const schema = (db) => w.fake.schemas[db];
  const out = toConnectorProperties({ Key: 'k', 'Agent confidence': 0.5, 'Agent proposal': 'Keep tag', Claim: ['c1', 'c2'], 'Seeded at': '2026-10-09', 'In regression suite': '2026-10-14T09:00:00.000Z', 'In regression suite:end': '2026-10-15T09:00:00.000Z', 'Decided by': ['u1'], 'Follow-up run': null }, schema('tag_decisions'));
  assert.deepEqual(out, {
    Key: 'k', 'Agent confidence': 0.5, 'Agent proposal': 'Keep tag', Claim: '["c1","c2"]', 'date:Seeded at:start': '2026-10-09', 'date:Seeded at:is_datetime': 0,
    'date:In regression suite:start': '2026-10-14T09:00:00.000Z', 'date:In regression suite:end': '2026-10-15T09:00:00.000Z', 'date:In regression suite:is_datetime': 1, 'Decided by': '["u1"]', 'Follow-up run': null,
  });
  assert.deepEqual(toConnectorProperties({ 'Human only': true, Judged: false }, schema('rulebook')), { 'Human only': '__YES__', Judged: '__NO__' });
  assert.throws(() => toConnectorProperties({ Nope: 1 }, schema('claims')), /unknown property/);
});

test('writeBatches: an empty list of ops leaves an empty batches folder, and old files are removed', async () => {
  const w = await ready();
  const p = planOf(w);
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.write();
  runCheck(w);
  const dir = join(w.root, 'runs', 'run-1');
  assert.equal(readdirSync(join(dir, 'batches')).length, 1);
  const files = writeBatches({ dir, ops: [], config: w.config, pull: { schema: () => null } });
  assert.deepEqual(files, []);
  assert.deepEqual(readdirSync(join(dir, 'batches')), []);
});

// ---- resolveOps as a library ----

test('resolveOps: pure over a plan and a pull; converted flags and kinds are explicit', async () => {
  const w = await ready();
  const p = planOf(w, 'run-1', { ctx: { seed: true } });
  p.create('claims', 'g1', { 'Claim title': 'x', Readiness: 'Ready' });
  p.create('claims', 'brand-new', { 'Claim title': 'y' });
  p.update('claims', 'g2', null, { Readiness: 'Fix needed' });
  p.write();
  const plan = readPlan(w.root, 'run-1');
  const { loadPull } = await import('../agents/claim-tagger/scripts/pull.mjs');
  const { ops, skipped, violations } = resolveOps(plan, loadPull(w.root, 'p1'), { config: w.config });
  assert.deepEqual(skipped, []);
  assert.deepEqual(violations, []);
  assert.deepEqual(ops.map((o) => [o.seq, o.kind, o.key, o.converted, o.page_id === null]), [[1, 'update', 'g1', true, false], [2, 'create', 'brand-new', false, true], [3, 'update', 'g2', false, false]]);
  assert.equal(ops[0].properties['Geo ID'], undefined, 'the key property is dropped when a create becomes an update');
});

// ---- misc ----

test('runDirOf refuses ids that are not safe folder names', () => {
  for (const bad of ['pull', 'judgments', '../x', 'a b', 'a/b', '', '.hidden', 'a:b', undefined, 5]) assert.throws(() => runDirOf('/r', bad), /not a usable run id/, String(bad));
  assert.equal(runDirOf('/r', '20261013T120000Z-tag'), join('/r', 'runs', '20261013T120000Z-tag'));
});

test('command line: check prints one line, lists skips on stderr; disarm; usage errors', async () => {
  const w = await ready();
  const p = planOf(w);
  p.update('claims', 'g1', null, { Readiness: 'Ready' }, { expect: { Readiness: 'Ready' } });
  p.update('claims', 'g2', null, { Readiness: 'Ready' });
  p.write();
  const cap = captureIo();
  assert.equal(main(['check', '--run', 'run-1'], cap.io, { root: w.root, now: w.clock.now }), EXIT.OK);
  assert.equal(cap.out.length, 1);
  assert.match(cap.out[0], /^plan check: run run-1 /);
  assert.match(cap.err.join('\n'), /skipped op 1 \(claims "g1"\): expectation failed/);
  assert.equal(main(['check', '--run', 'run-1', '--pull', 'p1'], captureIo().io, { root: w.root }), EXIT.OK);
  const cap2 = captureIo();
  assert.equal(main(['disarm'], cap2.io, { root: w.root }), EXIT.OK);
  assert.equal(cap2.out[0], 'plan disarm: run run-1 disarmed');
  const cap3 = captureIo();
  main(['disarm'], cap3.io, { root: w.root });
  assert.equal(cap3.out[0], 'plan disarm: nothing was armed');
  for (const argv of [[], ['check'], ['frobnicate'], ['check', '--run'], ['check', '--run', 'x', 'y'], ['--bogus']]) {
    const c = captureIo();
    assert.equal(main(argv, c.io, { root: w.root }), EXIT.INVALID, JSON.stringify(argv));
    assert.match(c.err.join('\n'), /usage:/);
  }
  const bad = captureIo();
  assert.equal(main(['check', '--run', 'pull'], bad.io, { root: w.root }), EXIT.INVALID);
  assert.equal(main(['--help'], captureIo().io, { root: w.root }), EXIT.OK);
});

// ---- upsert details ----

test('a create that becomes an update never applies what only a create may write (Status Proposed, the seeded Weekly cap and Name)', async () => {
  const w = await ready();
  const p = planOf(w, 'run-1', { ctx: { seed: true } });
  p.create('rule_changes', 'Hedged trajectories are not forecasts', { Status: 'Proposed', Kind: 'Clarify wording', 'Proposed text': 'new proposal' }); // exists, and an editor has Approved it
  p.create('agent_settings', 'claim-tagger', { Name: 'claim-tagger', 'Weekly cap': 99, 'Rubric in force': '2026-10-14.1' });
  p.create('rule_changes', 'Only a status', { Status: 'Proposed' }); // does not exist: stays a create
  p.write();
  const result = runCheck(w);
  assert.equal(result.code, EXIT.OK, (result.problems ?? []).join('; '));
  assert.deepEqual(result.summary.converted.map((c) => [c.key, c.dropped]), [['Hedged trajectories are not forecasts', ['Status']], ['claim-tagger', ['Weekly cap']]]);
  const lines = readJsonl(join(w.root, 'runs', 'run-1', 'batches', '001-update-rule_changes.jsonl')).rows;
  assert.deepEqual(lines[0].properties, { Kind: 'Clarify wording', 'Proposed text': 'new proposal' }, 'Status stays whatever the rule owner made it');
  const settings = readJsonl(join(w.root, 'runs', 'run-1', 'batches', '002-update-agent_settings.jsonl')).rows;
  assert.deepEqual(settings[0].properties, { 'Rubric in force': '2026-10-14.1' }, 'Name is the key and Weekly cap is the editors\' now');
});

test('a converted create with nothing left to write is skipped', async () => {
  const w = await ready();
  const p = planOf(w, 'run-1', { ctx: { seed: true } });
  p.create('rule_changes', 'Hedged trajectories are not forecasts', { Status: 'Proposed' });
  p.write();
  const result = runCheck(w);
  assert.equal(result.code, EXIT.OK);
  assert.match(result.summary.skipped[0].reason, /the row already exists; create-only properties were not applied \(Status\)/);
});

test('null clears a relation; a value that is neither ids nor a reference is still refused', async () => {
  const w = await ready();
  const p = planOf(w);
  assert.deepEqual(p.update('claims', 'g1', null, { 'Agent tags': null }).properties['Agent tags'], []);
  assert.throws(() => p.update('claims', 'g2', null, { 'Agent tags': [null] }), /page ids or/);
});

test('write refuses to replace the plan of a run that was already applied in part', async () => {
  const w = await ready();
  const p = planOf(w);
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.write();
  p.write(); // a plan that was never applied may be written again
  writeFileSync(join(w.root, 'runs', 'run-1', 'applied.jsonl'), '{"seq":1,"status":"ok"}\n');
  assert.throws(() => p.write(), /already been applied \(in part\); build the new plan under a new run id/);
});

test('a plan edited after it was armed no longer has the armed sha (what apply and the guard compare)', async () => {
  const w = await ready();
  const p = planOf(w);
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.write();
  assert.equal(runCheck(w).code, EXIT.OK);
  const file = join(w.root, 'runs', 'run-1', 'plan.jsonl');
  assert.equal(readPlan(w.root, 'run-1').sha, armedState(w.root).plan_sha);
  writeFileSync(file, readFileSync(file, 'utf8').replace('"Ready"', '"Fix needed"'));
  assert.notEqual(readPlan(w.root, 'run-1').sha, armedState(w.root).plan_sha, 'one changed value is enough');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\n`);
  assert.notEqual(readPlan(w.root, 'run-1').sha, armedState(w.root).plan_sha);
});
