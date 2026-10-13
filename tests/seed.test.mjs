import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main as applyMain } from '../agents/claim-tagger/scripts/apply.mjs';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { readJsonl } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { composeWhenToUse } from '../agents/claim-tagger/scripts/lib/rubric-build.mjs';
import { check } from '../agents/claim-tagger/scripts/plan.mjs';
import { main, mergeClaims, readSourcesFill, seedPhase } from '../agents/claim-tagger/scripts/seed.mjs';
import { AGENT, REPO } from './fixtures/notion/fake-notion.mjs';
import { captureIo, cleanupRoots, loadRubric, makeRoot, makeWorld, rulebookProps } from './fixtures/notion/helpers.mjs';

const SEED_DIR = join(AGENT, 'evals', 'seed');
const FIXTURE = join(REPO, 'tests', 'fixtures', 'rubric.research-example.json');
const extraDirs = [];
after(() => {
  cleanupRoots();
  for (const d of extraDirs) rmSync(d, { recursive: true, force: true });
});

const NAMES = /(?<![\p{L}\p{N}_])(Moh|Mohammed|Yaniv|Arturas)(?![\p{L}\p{N}_])/u;
const empty = async (opts = {}) => {
  const w = makeWorld({ populate: false, ...opts });
  await w.pull('p0');
  return w;
};
const seed = (w, phase, extra = {}, runId) => {
  const cap = captureIo();
  const code = main(['--phase', String(phase), ...(runId ? ['--run', runId] : [])], cap.io, { root: w.root, repoRoot: w.repo, seedDir: SEED_DIR, fixturePath: FIXTURE, now: w.clock.now, ...extra });
  return { code, out: cap.out, err: cap.err };
};
const planOps = (w, runId) => readJsonl(join(w.root, 'runs', runId, 'plan.jsonl')).rows;
const tmpSeedDir = (claims, decisions) => {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-seeddir-'));
  extraDirs.push(dir);
  if (claims) writeFileSync(join(dir, 'claims.seed.jsonl'), claims.map((r) => JSON.stringify(r)).join('\n') + '\n');
  if (decisions) writeFileSync(join(dir, 'decisions.seed.jsonl'), decisions.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return dir;
};

// ---- phase 1 ----

test('phase 1 from rubric.json: 14 Rulebook creates and the Agent settings row, with the columns the plan names', async () => {
  const w = await empty();
  const r = seed(w, 1, {}, 'seed-1');
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^seed: phase 1: plan seed-1 written: 14 rulebook, 1 agent_settings create\(s\); next: plan\.mjs check --run seed-1/);
  const [header, ...ops] = planOps(w, 'seed-1');
  assert.deepEqual(header.ctx, { seed: true, promote: false, gate: null });
  assert.equal(ops.length, 15);
  assert.equal(ops.filter((o) => o.database === 'rulebook' && o.op === 'create').length, 14);
  const rubric = loadRubric();
  const predictive = ops.find((o) => o.key === 'Predictive');
  const tag = rubric.tags.find((t) => t.name === 'Predictive');
  assert.deepEqual(predictive.properties, {
    'Tag title': 'Predictive', Status: 'Verified', Category: 'Meaning', Polarity: 'Issue', Description: tag.description, 'Example claims': tag.example_claims.join('\n'),
    'When to use': composeWhenToUse(tag.when_to_use), 'Human only': false, Judged: true, 'Rule version': rubric.rubric_version, 'Tag hash': tag.tag_hash,
  });
  assert.equal(ops.find((o) => o.key === 'Debate').properties.Counterpart, 'Simple');
  assert.equal('Counterpart' in predictive.properties, false, 'no counterpart, no property');
  assert.equal(ops.find((o) => o.key === 'Editor verified').properties['Human only'], true);
  assert.equal(ops.find((o) => o.key === 'Unsourced').properties.Judged, false);
  const settings = ops.find((o) => o.database === 'agent_settings');
  assert.deepEqual(settings.properties, { Name: 'claim-tagger', 'Weekly cap': 40, 'Rubric in force': rubric.rubric_version });
  assert.deepEqual(ops.map((o) => o.seq), Array.from({ length: 15 }, (_, i) => i + 1));
  for (const op of ops) for (const name of Object.keys(op.properties)) assert.notEqual(name, 'Tag outcome');
});

test('phase 1 without rubric.json builds it from the research fixture with the names replaced by roles', async () => {
  const w = makeWorld({ populate: false });
  const bare = makeRoot({ rubric: false });
  const fake = w.fake;
  const noRubric = { ...w, root: bare.root, repo: bare.repo };
  // the pull has to be in the root the seed reads
  const { pull } = await import('../agents/claim-tagger/scripts/pull.mjs');
  await pull({ root: bare.root, client: fake.client, dbs: ['rulebook', 'agent_settings', 'claims', 'tag_decisions', 'rule_changes', 'runs'], pullId: 'p0', now: w.clock.now });
  const r = seed(noRubric, 1, {}, 'seed-1');
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.err.join('\n'), /rubric 2026-10-13\.1 from the research fixture \(names replaced by roles\)/);
  const ops = planOps(noRubric, 'seed-1').slice(1);
  assert.equal(ops.filter((o) => o.database === 'rulebook').length, 14);
  assert.equal(NAMES.test(JSON.stringify(ops)), false, 'no person is named in a Rulebook row');
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  assert.equal(NAMES.test(JSON.stringify(fixture)), true, 'the fixture does name people');
  assert.equal(ops.find((o) => o.key === 'Predictive').properties['Rule version'], '2026-10-13.1');
  assert.match(ops.find((o) => o.key === 'Predictive').properties['Tag hash'], /^sha256:[0-9a-f]{16}$/);
  const missingEverything = seed(noRubric, 1, { fixturePath: join(bare.dir, 'nope.json') }, 'seed-2');
  assert.equal(missingEverything.code, EXIT.INVALID);
  assert.match(missingEverything.err.join('\n'), /no fixture at/);
});

test('phase 1 leaves out rows that already exist, and says there is nothing to do when all of them do', async () => {
  const w = makeWorld({ populate: false });
  const rubric = loadRubric();
  for (const t of rubric.tags.slice(0, 3)) w.fake.add('rulebook', rulebookProps({ name: t.name, category: t.category, polarity: t.polarity, counterpart: t.counterpart, description: t.description, example_claims: t.example_claims.join('\n'), human_only: t.human_only, judged: t.judged }, rubric));
  await w.pull('p0');
  const part = seed(w, 1, {}, 'seed-1');
  assert.match(part.out[0], /11 rulebook, 1 agent_settings create\(s\), 3 already in Notion/);
  const full = makeWorld();
  await full.pull('p0');
  const none = seed(full, 1, {}, 'seed-x');
  assert.equal(none.code, EXIT.OK);
  assert.match(none.out[0], /^seed: phase 1: nothing to do, all 15 row\(s\) are already in Notion$/);
  assert.equal(existsSync(join(full.root, 'runs', 'seed-x')), false, 'no empty plan is written');
});

// ---- phase 2 ----

test('phase 2: 60 claims, the fill merged in, Agent tags resolved to Rulebook rows by name', async () => {
  const w = await runPhase1(await empty());
  const r = seed(w, 2, {}, 'seed-2');
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /plan seed-2 written: 60 claims create\(s\)/);
  assert.match(r.err.join('\n'), /filled 30 claim\(s\) from sources-fill\.json/);
  const ops = planOps(w, 'seed-2').slice(1);
  assert.equal(ops.length, 60);
  assert.ok(ops.every((o) => o.op === 'create' && o.database === 'claims'));
  assert.ok(ops.every((o) => typeof o.properties['Sources count'] === 'number'), 'every claim has a sources count after the fill');
  const idMap = JSON.parse(readFileSync(join(w.root, 'runs', 'pull', 'p1', 'id-map.json'), 'utf8'));
  const claimsSeed = readJsonl(join(SEED_DIR, 'claims.seed.jsonl')).rows;
  let withTags = 0;
  for (const c of claimsSeed) {
    const op = ops.find((o) => o.key === c.geo_id);
    assert.ok(op, c.geo_id);
    assert.equal(op.properties['Claim title'], c.claim);
    assert.equal(op.properties['Geo ID'], c.geo_id);
    assert.equal(op.properties.Table, c.table);
    assert.equal(op.properties.Sample, c.sample);
    assert.deepEqual(op.properties['Agent tags'] ?? [], c.agent_tags.map((n) => idMap.rulebook[n]));
    if (c.agent_tags.length) withTags += 1;
    if (c.source_urls.length) assert.equal(op.properties['Source URLs'], c.source_urls.join('\n'));
  }
  assert.ok(withTags > 0, 'some claims carry agent tags');
  const withUrls = ops.filter((o) => o.properties['Source URLs']);
  assert.ok(withUrls.length >= 10);
  const filled = ops.find((o) => o.key === '01c0d1ae38864f60aa78f0629fd6a7d5');
  assert.equal(filled.properties['Sources count'], 5, 'taken from sources-fill.json');
  assert.equal(filled.properties['Source URLs'].split('\n').length, 5);
  assert.equal(filled.properties['Geo link'], 'https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/01c0d1ae38864f60aa78f0629fd6a7d5');
});

test('phase 2: unknown agent tag names are dropped and reported; the Rulebook must be seeded first', async () => {
  const w = await runPhase1(await empty());
  const dir = tmpSeedDir([
    { geo_id: 'c1', claim: 'One', geo_link: null, sources_count: 0, source_urls: [], table: 'U.S. Politics', sample: 'Random', agent_tags: ['Unsourced', 'Nonexistent tag'] },
    { geo_id: 'c2', claim: 'Two', sources_count: null, source_urls: [], table: 'U.S. Politics', sample: 'Decided', agent_tags: ['Nonexistent tag'] },
  ]);
  const r = seed(w, 2, { seedDir: dir }, 'seed-2');
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.err.join('\n'), /dropped unknown agent tag "Nonexistent tag" on 2 claim\(s\)/);
  const ops = planOps(w, 'seed-2').slice(1);
  assert.equal(ops[0].properties['Sources count'], 0, 'zero is a value');
  assert.equal(ops[0].properties['Agent tags'].length, 1);
  assert.equal('Agent tags' in ops[1].properties, false);
  assert.equal('Sources count' in ops[1].properties, false, 'null is left out');
  assert.equal('Geo link' in ops[0].properties, false);
  const bare = await empty();
  const early = seed(bare, 2, {}, 'seed-2');
  assert.equal(early.code, EXIT.INVALID);
  assert.match(early.err.join('\n'), /apply phase 1 and run pull\.mjs --all before phase 2/);
});

test('mergeClaims and readSourcesFill: the fill supplies empties only, conflicts are kept as the seed has them and reported', () => {
  const claims = [
    { geo_id: 'a', sources_count: null, source_urls: [], geo_link: null },
    { geo_id: 'b', sources_count: 2, source_urls: ['u'], geo_link: 'l' },
    { geo_id: 'c', sources_count: null, source_urls: [], geo_link: 'l' },
  ];
  const fill = new Map([['a', { sources_count: 3, source_urls: ['x', 'y', 'z'], geo_link: 'gl' }], ['b', { sources_count: 5, source_urls: ['q'], geo_link: 'zz' }]]);
  const merged = mergeClaims(claims, fill);
  assert.deepEqual(merged.claims[0], { geo_id: 'a', sources_count: 3, source_urls: ['x', 'y', 'z'], geo_link: 'gl' });
  assert.deepEqual(merged.claims[1], claims[1]);
  assert.deepEqual(merged.claims[2], claims[2]);
  assert.equal(merged.filled, 1);
  assert.deepEqual(merged.conflicts, ['b: sources_count 2 (seed) vs 5 (fill)']);
  assert.deepEqual(claims[0], { geo_id: 'a', sources_count: null, source_urls: [], geo_link: null }, 'the input is not modified');
  // the three shapes of the fill file
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-fill-'));
  extraDirs.push(dir);
  assert.equal(readSourcesFill(dir).size, 0, 'no file, no fill');
  writeFileSync(join(dir, 'sources-fill.json'), JSON.stringify({ fetched_at: 'x', rows: { g1: { sources_count: 1 } } }));
  assert.deepEqual([...readSourcesFill(dir).keys()], ['g1']);
  writeFileSync(join(dir, 'sources-fill.json'), JSON.stringify({ g2: { sources_count: 1 } }));
  assert.deepEqual([...readSourcesFill(dir).keys()], ['g2']);
  writeFileSync(join(dir, 'sources-fill.json'), JSON.stringify([{ geo_id: 'g3', sources_count: 1 }]));
  assert.deepEqual([...readSourcesFill(dir).keys()], ['g3']);
});

// ---- phase 3 ----

test('phase 3: 50 Tag decisions with resolved relations and the seeded columns, and never a Tag outcome', async () => {
  const w = await runPhase2(await runPhase1(await empty()));
  const r = seed(w, 3, {}, 'seed-3');
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /plan seed-3 written: 50 tag_decisions create\(s\)/);
  const ops = planOps(w, 'seed-3').slice(1);
  assert.equal(ops.length, 50);
  const idMap = JSON.parse(readFileSync(join(w.root, 'runs', 'pull', 'p2', 'id-map.json'), 'utf8'));
  const seeds = readJsonl(join(SEED_DIR, 'decisions.seed.jsonl')).rows;
  let withOutcome = 0;
  for (const d of seeds) {
    const op = ops.find((o) => o.key === d.key);
    assert.ok(op, d.key);
    const p = op.properties;
    assert.equal(p.Key, d.key);
    assert.deepEqual(p.Claim, [idMap.claims[d.geo_id]]);
    assert.deepEqual(p.Tag, [idMap.rulebook[d.tag]]);
    assert.equal(p['Agent proposal'], d.agent_proposal);
    assert.equal(p['Why I recommend this'], d.why_i_recommend_this);
    assert.equal(p['Agent full note'], d.agent_full_note);
    assert.equal(p['Why in queue'], d.why_in_queue);
    assert.equal(p.Priority, d.priority);
    assert.equal(p['Rubric version'], d.rubric_version);
    assert.equal(p['Seeded outcome'], d.seeded_outcome ?? undefined);
    assert.equal(p['Seeded at'], d.seeded_at ?? undefined);
    if (d.seeded_outcome) withOutcome += 1;
    if (d.seeded_reasoning) assert.equal(p['Seeded reasoning'], d.why_wrong_hint ? `${d.why_wrong_hint}: ${d.seeded_reasoning}` : d.seeded_reasoning);
    else assert.equal('Seeded reasoning' in p, false);
    for (const forbidden of ['Tag outcome', 'Why wrong', 'Your reasoning', 'Decided by', 'Decided at', 'Effective outcome', 'Stage', 'Direction']) assert.equal(forbidden in p, false, `${d.key} must not carry ${forbidden}`);
  }
  assert.equal(withOutcome, 27);
  const hinted = ops.filter((o) => /^Rule should change: /.test(o.properties['Seeded reasoning'] ?? ''));
  assert.deepEqual(hinted.map((o) => o.key).sort(), ['6aa014be141b4c6dab2c3c180f963639::Predictive', 'f376c2cc2f6f4338893cce864ec82c02::Predictive']);
});

test('phase 3 stops and lists what it cannot link instead of writing a partial plan', async () => {
  const w = await runPhase1(await empty()); // claims were never seeded
  const r = seed(w, 3, {}, 'seed-3');
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /50 decision\(s\) cannot be linked/);
  assert.match(r.err.join('\n'), /no claim .* in Notion \(apply phase 2 and pull first\)/);
  assert.equal(existsSync(join(w.root, 'runs', 'seed-3')), false);
  const dir = tmpSeedDir(null, [{ key: 'c1::Nonexistent', geo_id: 'c1', tag: 'Nonexistent', agent_proposal: 'Keep tag', why_in_queue: 'Seeded decision', priority: 'High', rubric_version: 'x' }]);
  const claims = tmpSeedDir([{ geo_id: 'c1', claim: 'One', sources_count: 0, source_urls: [], table: 'U.S. Politics', sample: 'Random', agent_tags: [] }]);
  const w2 = await runPhase1(await empty());
  const p2 = seed(w2, 2, { seedDir: claims }, 'seed-2');
  assert.equal(p2.code, EXIT.OK, p2.err.join('\n'));
  await applyPlan(w2, 'seed-2', 'p2');
  const bad = seed(w2, 3, { seedDir: dir }, 'seed-3');
  assert.equal(bad.code, EXIT.INVALID);
  assert.match(bad.err.join('\n'), /no Rulebook tag "Nonexistent"/);
});

// ---- the whole seed, through check and apply against the fake ----

async function applyPlan(w, runId, nextPullId) {
  const c = check({ root: w.root, runId, now: w.clock.now });
  assert.equal(c.code, EXIT.OK, (c.problems ?? []).join('; '));
  const cap = captureIo();
  const code = await applyMain(['--run', runId], cap.io, w.env());
  assert.equal(code, EXIT.OK, `${cap.out.join('\n')}\n${cap.err.join('\n')}`);
  const pulled = await w.pull(nextPullId);
  assert.equal(pulled.code, EXIT.OK);
  return cap.out[0];
}
async function runPhase1(w) {
  const r = seed(w, 1, {}, 'seed-1');
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  await applyPlan(w, 'seed-1', 'p1');
  return w;
}
async function runPhase2(w) {
  const r = seed(w, 2, {}, 'seed-2');
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  await applyPlan(w, 'seed-2', 'p2');
  return w;
}

test('end to end: three phases, each checked, applied, verified and pulled; the final state is the plan\'s seed', async () => {
  const w = await empty();
  await runPhase1(w);
  assert.equal(w.fake.count('rulebook'), 14);
  assert.equal(w.fake.count('agent_settings'), 1);
  const settings = w.fake.find('agent_settings', 'claim-tagger').props;
  assert.equal(settings['Weekly cap'], 40);
  assert.equal(settings.Paused, false);
  assert.equal(settings['Rubric in force'], loadRubric().rubric_version);
  assert.equal(w.fake.find('rulebook', 'Predictive').props['When to use'], composeWhenToUse(loadRubric().tags.find((t) => t.name === 'Predictive').when_to_use));

  await runPhase2(w);
  assert.equal(w.fake.count('claims'), 60);
  const unsourced = w.fake.rows('claims').filter((r) => r.props['Agent tags'].includes(w.fake.find('rulebook', 'Unsourced').page_id));
  assert.ok(unsourced.length > 0);

  const r3 = seed(w, 3, {}, 'seed-3');
  assert.equal(r3.code, EXIT.OK, r3.err.join('\n'));
  const line = await applyPlan(w, 'seed-3', 'p3');
  assert.match(line, /^apply: run seed-3: created 50, updated 0, skipped 0, failed 0; verify clean/);
  assert.equal(w.fake.count('tag_decisions'), 50);
  const rows = w.fake.rows('tag_decisions');
  assert.equal(rows.filter((r) => r.props['Effective outcome']).length, 27, 'decided through the seeded outcome');
  assert.equal(rows.filter((r) => !r.props['Effective outcome']).length, 23, 'the open rows that reach My queue');
  assert.ok(rows.every((r) => r.props['Tag outcome'] === null), 'no script ever wrote Tag outcome');
  assert.ok(rows.every((r) => r.props['Decided by'].length === 0 && r.props['Decided at'] === null));
  const texas = rows.find((r) => r.props.Key === 'f376c2cc2f6f4338893cce864ec82c02::Predictive');
  assert.equal(texas.props['Seeded outcome'], 'Does not apply');
  assert.match(texas.props['Seeded reasoning'], /^Rule should change: /);
  assert.equal(texas.props['Why wrong'], null, 'the editor field stays empty');
  assert.deepEqual(w.fake.createdOptions, [], 'no select option was invented');
  // every request the fake saw was a read or an allowlisted write
  const editor = ['Tag outcome', 'Why wrong', 'Your reasoning', 'Decided by', 'Decided at', 'Editor wording', 'Approved by', 'Paused', 'Paused by', 'Reason', 'Owner'];
  for (const wr of w.fake.writes()) for (const name of Object.keys(wr.properties ?? {})) assert.equal(editor.includes(name), false, name);

  // a second run of each phase finds nothing left to do
  for (const phase of [1, 2, 3]) {
    const again = seed(w, phase, {}, `again-${phase}`);
    assert.equal(again.code, EXIT.OK);
    assert.match(again.out[0], /nothing to do/, `phase ${phase}`);
  }
});

// ---- arguments and failures ----

test('arguments, a used run id, and a missing pull', async () => {
  const w = await empty();
  for (const argv of [[], ['--phase', '4'], ['--phase', 'x'], ['--phase'], ['--bogus'], ['stray']]) {
    const c = captureIo();
    assert.equal(main(argv, c.io, { root: w.root }), EXIT.INVALID, JSON.stringify(argv));
    assert.match(c.err.join('\n'), /usage:/);
  }
  assert.equal(main(['--help'], captureIo().io, { root: w.root }), EXIT.OK);
  assert.equal(seed(w, 1, {}, 'dup').code, EXIT.OK);
  const again = seed(w, 1, {}, 'dup');
  assert.equal(again.code, EXIT.INVALID);
  assert.match(again.err.join('\n'), /already has a plan; pick another --run id/);
  const lone = makeRoot();
  const cap = captureIo();
  assert.equal(main(['--phase', '1'], cap.io, { root: lone.root, seedDir: SEED_DIR, fixturePath: FIXTURE }), EXIT.INVALID);
  assert.match(cap.err.join('\n'), /there is no pull yet/);
  const missingSeed = seed(w, 2, { seedDir: join(w.dir, 'no-such-dir') }, 'x');
  assert.equal(missingSeed.code, EXIT.INVALID);
  assert.throws(() => seedPhase({ root: w.root, phase: 9 }), /phase must be 1, 2 or 3/);
});

test('without runId the id is built from the clock, with no colon', async () => {
  const w = await empty();
  const r = seed(w, 1);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out[0], /plan 20261013T120000Z-seed-phase1 written/);
  assert.ok(existsSync(join(w.root, 'runs', '20261013T120000Z-seed-phase1', 'plan.jsonl')));
});

test('a fake world without the seed schemas cannot be seeded: an unreadable select refuses the whole plan', async () => {
  const w = makeWorld({ populate: false });
  delete w.fake.schemas.rulebook.properties.Category.select.options; // an unparseable select
  await w.pull('p0').catch(() => null);
  const cap = captureIo();
  const code = main(['--phase', '1', '--run', 'seed-1'], cap.io, { root: w.root, seedDir: SEED_DIR, fixturePath: FIXTURE, now: w.clock.now });
  assert.equal(code, EXIT.INVALID);
  assert.match(cap.err.join('\n'), /no readable options/);
});

test('an unreadable seed file or fill file is invalid input (exit 2), not a crash', async () => {
  const w = await runPhase1(await empty());
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-seeddir-'));
  extraDirs.push(dir);
  writeFileSync(join(dir, 'claims.seed.jsonl'), '{"geo_id":"a"}\nthis is not json\n{"geo_id":"b"}\n');
  const broken = seed(w, 2, { seedDir: dir }, 'seed-2');
  assert.equal(broken.code, EXIT.INVALID);
  assert.match(broken.err.join('\n'), /line 2 is not valid JSON/);
  writeFileSync(join(dir, 'claims.seed.jsonl'), '{"geo_id":"a","claim":"x","sources_count":0,"source_urls":[],"table":"U.S. Politics","sample":"Random","agent_tags":[]}\n');
  writeFileSync(join(dir, 'sources-fill.json'), '{ not json');
  assert.equal(seed(w, 2, { seedDir: dir }, 'seed-2').code, EXIT.INVALID);
  writeFileSync(join(dir, 'claims.seed.jsonl'), '');
  rmSync(join(dir, 'sources-fill.json'));
  const empty2 = seed(w, 2, { seedDir: dir }, 'seed-2');
  assert.equal(empty2.code, EXIT.INVALID);
  assert.match(empty2.err.join('\n'), /is empty/);
});
