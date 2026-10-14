import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATABASES, OPTIONAL_PROPERTIES } from '../agents/claim-tagger/scripts/allowlist.mjs';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { h16 } from '../agents/claim-tagger/scripts/lib/hash.mjs';
import { readJsonl } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { NotionError } from '../agents/claim-tagger/scripts/lib/notion-rest.mjs';
import { openPlan } from '../agents/claim-tagger/scripts/plan.mjs';
import { normaliseText } from '../agents/claim-tagger/scripts/lib/notion-values.mjs';
import { findSchema, isDecided, latestPullId, loadPull, main, pull, schemaProblems, schemaWarnings } from '../agents/claim-tagger/scripts/pull.mjs';
import { createFakeNotion } from './fixtures/notion/fake-notion.mjs';
import { USER, buildWorld, captureIo, cleanupRoots, clockAt, makeRoot } from './fixtures/notion/helpers.mjs';

after(cleanupRoots);

function setup() {
  const fake = createFakeNotion();
  const ids = buildWorld(fake);
  const r = makeRoot();
  const cap = captureIo();
  const run = async (args, extra = {}) => {
    cap.out.length = 0;
    cap.err.length = 0;
    const code = await main(args, cap.io, { root: r.root, repoRoot: r.repo, client: fake.client, now: clockAt('2026-10-13T12:00:00.000Z'), ...extra });
    return code;
  };
  return { fake, ids, ...r, cap, run };
}

const readNorm = (s, pullId, name) => (name.endsWith('.jsonl') ? readJsonl(join(s.root, 'runs', 'pull', pullId, 'norm', name)).rows : JSON.parse(readFileSync(join(s.root, 'runs', 'pull', pullId, 'norm', name), 'utf8')));
/** The version of the rubric.json the test root holds (a copy of the agent's): what the Rulebook rows and the Agent settings are seeded with. */
const rubricVersion = (s) => JSON.parse(readFileSync(join(s.root, 'rubric', 'rubric.json'), 'utf8')).rubric_version;

test('--all writes schema, raw and norm files, id-map, snapshot, manifest and LATEST; prints one summary line', async () => {
  const s = setup();
  assert.equal(await s.run(['--all', '--pull-id', 'p1']), EXIT.OK);
  assert.equal(s.cap.out.length, 1, 'one summary line');
  assert.match(s.cap.out[0], /^pull p1: rulebook 14, claims 3, tag_decisions 4, rule_changes 1, runs 1, agent_settings 1; drift 0; duplicates 0; paused no$/);
  assert.deepEqual(s.cap.err, []);
  const dir = join(s.root, 'runs', 'pull', 'p1');
  for (const db of DATABASES) {
    assert.ok(existsSync(join(dir, 'schema', `${db}.json`)), `schema/${db}.json`);
    assert.ok(existsSync(join(dir, 'raw', `${db}.json`)), `raw/${db}.json`);
  }
  for (const f of ['claims.jsonl', 'rulebook.json', 'queue.jsonl', 'decisions.jsonl', 'lessons.jsonl', 'runs.jsonl', 'settings.json']) assert.ok(existsSync(join(dir, 'norm', f)), `norm/${f}`);
  for (const f of ['id-map.json', 'snapshot.json', 'pull.json']) assert.ok(existsSync(join(dir, f)), f);
  assert.equal(readFileSync(join(s.root, 'runs', 'pull', 'LATEST'), 'utf8'), 'p1');
  assert.equal(latestPullId(s.root), 'p1');
  assert.equal(JSON.parse(readFileSync(join(dir, 'raw', 'claims.json'), 'utf8')).length, 3);
  const info = JSON.parse(readFileSync(join(dir, 'pull.json'), 'utf8'));
  assert.equal(info.taken_at, '2026-10-13T12:00:00.000Z');
  assert.deepEqual(info.dbs, DATABASES);
});

test('claims.jsonl: tag names resolved through the Rulebook, text hash, source lines, numbers', async () => {
  const s = setup();
  await s.run(['--all', '--pull-id', 'p1']);
  const rows = readNorm(s, 'p1', 'claims.jsonl');
  assert.deepEqual(rows.map((r) => r.geo_id), ['g1', 'g2', 'g3'], 'sorted by Geo ID');
  const g1 = rows[0];
  assert.equal(g1.page_id, s.ids.claims.g1);
  assert.equal(g1.claim, 'Texas is on track to become a competitive swing state');
  assert.equal(g1.text_hash, h16(normaliseText(g1.claim)));
  assert.deepEqual(g1.agent_tags.sort(), ['Debate', 'Opinion']);
  assert.deepEqual(g1.agent_tag_ids.sort(), [s.ids.rulebook.Debate, s.ids.rulebook.Opinion].sort());
  assert.deepEqual(g1.source_urls, ['https://geo.test/s1-g1', 'https://geo.test/s2-g1']);
  assert.equal(g1.sources_count, 2);
  assert.equal(g1.table, 'U.S. Politics');
  assert.equal(g1.sample, 'Forecast');
  assert.equal(g1.readiness, 'Needs editor');
  assert.equal(g1.tag_confidence, null);
  assert.equal(g1.last_judged, null);
  assert.deepEqual(rows[2].agent_tags, []);
});

test('queue.jsonl has every Tag decisions row; decisions.jsonl only the decided ones, with their source', async () => {
  const s = setup();
  await s.run(['--all', '--pull-id', 'p1']);
  const queue = readNorm(s, 'p1', 'queue.jsonl');
  assert.deepEqual(queue.map((r) => r.key), ['g1::Predictive', 'g2::Predictive', 'g3::Hypothetical', 'g3::Predictive']);
  const g1 = queue.find((r) => r.key === 'g1::Predictive');
  assert.equal(g1.geo_id, 'g1');
  assert.equal(g1.tag, 'Predictive');
  assert.equal(g1.tag_page_id, s.ids.rulebook.Predictive);
  assert.equal(g1.claim_page_id, s.ids.claims.g1);
  assert.equal(g1.agent_proposal, 'Keep tag');
  assert.equal(g1.agent_confidence, 0.62);
  assert.equal(g1.priority, 'High');
  assert.equal(g1.why_in_queue, 'Low confidence');
  assert.equal(g1.effective_outcome, null);
  assert.equal(g1.stage, 'To review');
  assert.deepEqual(g1.decided_by, []);
  assert.deepEqual(g1.lesson_page_ids, []);
  const seeded = queue.find((r) => r.key === 'g2::Predictive');
  assert.equal(seeded.seeded_outcome, 'Does not apply');
  assert.equal(seeded.seeded_at, '2026-10-09');
  assert.equal(seeded.tag_outcome, null);
  assert.equal(seeded.effective_outcome, 'Does not apply');
  assert.deepEqual(seeded.lesson_page_ids, [s.ids.lesson]);
  const editor = queue.find((r) => r.key === 'g3::Hypothetical');
  assert.equal(editor.tag_outcome, 'Applies');
  assert.equal(editor.why_wrong, 'Agent slip');
  assert.equal(editor.your_reasoning, 'The rule covers it.');
  assert.deepEqual(editor.decided_by, [USER]);
  assert.equal(editor.decided_at, '2026-10-13');
  const decisions = readNorm(s, 'p1', 'decisions.jsonl');
  assert.deepEqual(decisions.map((r) => [r.key, r.outcome_source]), [['g2::Predictive', 'seeded'], ['g3::Hypothetical', 'editor']]);
  assert.equal(decisions.some((r) => r.key === 'g3::Predictive'), false, 'Needs evidence is an editor mark but not a decision');
  assert.equal(decisions.some((r) => r.key === 'g1::Predictive'), false, 'an open row is not a decision');
});

test('lessons.jsonl, runs.jsonl and settings.json', async () => {
  const s = setup();
  await s.run(['--all', '--pull-id', 'p1']);
  const [lesson] = readNorm(s, 'p1', 'lessons.jsonl');
  assert.equal(lesson.lesson_key, 'Hedged trajectories are not forecasts');
  assert.equal(lesson.title, lesson.lesson_key);
  assert.equal(lesson.lesson_id, 'LS-1');
  assert.equal(lesson.tag, 'Predictive');
  assert.equal(lesson.tag_page_id, s.ids.rulebook.Predictive);
  assert.equal(lesson.rule_label, 'Predictive rule 1');
  assert.equal(lesson.kind, 'Change the rule');
  assert.equal(lesson.status, 'Approved');
  assert.deepEqual(lesson.approved_by, [USER]);
  assert.equal(lesson.editor_wording, null);
  assert.deepEqual(lesson.supporting_page_ids, [s.ids.decisions['g2::Predictive']]);
  assert.deepEqual(lesson.result_card_page_ids, []);
  assert.match(lesson.created, /^2026-10-13T12:00:00/);
  const [run] = readNorm(s, 'p1', 'runs.jsonl');
  assert.equal(run.title, 'Smoke R1');
  assert.equal(run.kind, 'Smoke');
  assert.equal(run.claims_judged, 3);
  assert.equal(run.cost_usd, 0.12);
  assert.equal(run.verdict, 'n/a');
  const settings = readNorm(s, 'p1', 'settings.json');
  assert.deepEqual(settings, {
    page_id: s.ids.settings, name: 'claim-tagger', paused: false, paused_by: [], reason: null, weekly_cap: 40, owner: [], rubric_in_force: rubricVersion(s), last_run_at: null, last_run_summary: null,
  });
});

test('rulebook.json: 14 rows with the fields the contract names; no drift when Notion matches rubric.json', async () => {
  const s = setup();
  await s.run(['--all', '--pull-id', 'p1']);
  const rb = readNorm(s, 'p1', 'rulebook.json');
  assert.equal(rb.pull_id, 'p1');
  assert.equal(rb.rows.length, 14);
  assert.deepEqual(rb.drift, []);
  assert.equal(rb.drift_checked, true);
  const predictive = rb.rows.find((r) => r.name === 'Predictive');
  assert.equal(predictive.page_id, s.ids.rulebook.Predictive);
  assert.equal(predictive.status, 'Verified');
  assert.equal(predictive.category, 'Meaning');
  assert.equal(predictive.polarity, 'Issue');
  assert.equal(predictive.counterpart, null);
  assert.equal(predictive.judged, true);
  assert.equal(predictive.human_only, false);
  assert.equal(predictive.rule_version, rubricVersion(s));
  assert.match(predictive.tag_hash, /^sha256:[0-9a-f]{16}$/);
  assert.deepEqual(predictive.changed_by, []);
  assert.match(predictive.when_to_use, /^.*\n?1\./s);
  assert.equal(rb.rows.find((r) => r.name === 'Debate').counterpart, 'Simple');
  assert.equal(rb.rows.find((r) => r.name === 'Editor verified').human_only, true);
  assert.equal(rb.rows.find((r) => r.name === 'Editor verified').judged, false);
});

test('drift: a changed rule in Notion shows up per rule; an unjudged tag, line-ending noise and <br> do not', async () => {
  const s = setup();
  const text = s.fake.find('rulebook', 'Predictive').props['When to use'];
  const edited = text.replace(/^(1\. .*)$/m, '$1 (edited in Notion)');
  assert.notEqual(edited, text);
  s.fake.editorSet(s.ids.rulebook.Predictive, { 'When to use': edited });
  s.fake.editorSet(s.ids.rulebook.Unsourced, { 'When to use': 'something else entirely' }); // not a judged tag
  s.fake.editorSet(s.ids.rulebook.Debate, { 'When to use': s.fake.find('rulebook', 'Debate').props['When to use'].replace(/\n/g, '\r\n') }); // CRLF is not a change
  s.fake.editorSet(s.ids.rulebook.Opinion, { Description: s.fake.find('rulebook', 'Opinion').props.Description.replace(/ /, '<br>') }); // normalised, <br> is a line break
  await s.run(['--all', '--pull-id', 'p1']);
  const rb = readNorm(s, 'p1', 'rulebook.json');
  const tags = rb.drift.map((d) => `${d.tag}:${d.part}`);
  assert.ok(tags.includes('Predictive:rule 1'), tags.join(', '));
  assert.equal(rb.drift.some((d) => d.tag === 'Unsourced'), false);
  assert.equal(rb.drift.some((d) => d.tag === 'Debate'), false, 'CRLF only');
  const d = rb.drift.find((x) => x.tag === 'Predictive');
  assert.match(d.a, /\(edited in Notion\)/, 'a is the Notion text');
  assert.doesNotMatch(d.b, /edited in Notion/, 'b is the rubric file text');
  assert.match(s.cap.out[0], /drift \d+/);
  assert.ok(Number(/drift (\d+)/.exec(s.cap.out[0])[1]) >= 1);
});

test('drift: a tag no longer Verified in Notion (diffRubric calls it added: only in rubric.json) and a flipped Judged box are reported', async () => {
  const s = setup();
  s.fake.editorSet(s.ids.rulebook.Opinion, { Judged: false });
  s.fake.editorSet(s.ids.rulebook.Simple, { Status: 'Retired' });
  await s.run(['--all', '--pull-id', 'p1']);
  const parts = readNorm(s, 'p1', 'rulebook.json').drift.map((d) => `${d.tag}:${d.part}`);
  assert.ok(parts.includes('Opinion:judged'), parts.join(', '));
  assert.ok(parts.includes('Simple:added'), parts.join(', '));
});

test('no rubric.json: drift is empty and drift_checked is false', async () => {
  const fake = createFakeNotion();
  buildWorld(fake);
  const r = makeRoot({ rubric: false });
  const cap = captureIo();
  await main(['--dbs', 'rulebook', '--pull-id', 'p1'], cap.io, { root: r.root, client: fake.client });
  const rb = JSON.parse(readFileSync(join(r.root, 'runs', 'pull', 'p1', 'norm', 'rulebook.json'), 'utf8'));
  assert.deepEqual(rb.drift, []);
  assert.equal(rb.drift_checked, false);
});

test('id-map.json: every database keyed by its key property, no duplicates', async () => {
  const s = setup();
  await s.run(['--all', '--pull-id', 'p1']);
  const map = JSON.parse(readFileSync(join(s.root, 'runs', 'pull', 'p1', 'id-map.json'), 'utf8'));
  assert.equal(map.pull_id, 'p1');
  assert.equal(Object.keys(map.rulebook).length, 14);
  assert.equal(map.rulebook.Predictive, s.ids.rulebook.Predictive);
  assert.deepEqual(map.claims, s.ids.claims);
  assert.deepEqual(map.tag_decisions, s.ids.decisions);
  assert.deepEqual(map.rule_changes, { 'Hedged trajectories are not forecasts': s.ids.lesson });
  assert.deepEqual(map.runs, { 'Smoke R1': s.ids.run });
  assert.deepEqual(map.agent_settings, { 'claim-tagger': s.ids.settings });
  assert.deepEqual(map.duplicates, []);
  assert.deepEqual(map.carried, {});
});

test('duplicate keys: files are written, the id map names the pages, exit 2', async () => {
  const s = setup();
  const twin = s.fake.add('claims', { 'Claim title': 'The same claim twice', 'Geo ID': 'g1', Table: 'U.S. Politics', Sample: 'Random' });
  assert.equal(await s.run(['--all', '--pull-id', 'p1']), EXIT.INVALID);
  const map = JSON.parse(readFileSync(join(s.root, 'runs', 'pull', 'p1', 'id-map.json'), 'utf8'));
  assert.equal(map.duplicates.length, 1);
  assert.equal(map.duplicates[0].db, 'claims');
  assert.equal(map.duplicates[0].key, 'g1');
  assert.deepEqual(map.duplicates[0].page_ids.sort(), [s.ids.claims.g1, twin].sort());
  assert.equal(map.claims.g1, s.ids.claims.g1, 'the oldest row wins the id map');
  assert.match(s.cap.out[0], /duplicates 1/);
  assert.match(s.cap.err.join('\n'), /duplicate key in claims: "g1"/);
  assert.ok(existsSync(join(s.root, 'runs', 'pull', 'p1', 'norm', 'claims.jsonl')), 'written before exiting');
  assert.equal(latestPullId(s.root), 'p1');
});

test('rows without a key are left out of the id map with a warning', async () => {
  const s = setup();
  s.fake.add('claims', { 'Claim title': 'No Geo ID', Table: 'U.S. Politics' });
  assert.equal(await s.run(['--dbs', 'claims', '--pull-id', 'p1']), EXIT.OK);
  assert.match(s.cap.err.join('\n'), /1 row\(s\) without a Geo ID/);
  const map = JSON.parse(readFileSync(join(s.root, 'runs', 'pull', 'p1', 'id-map.json'), 'utf8'));
  assert.equal(Object.keys(map.claims).length, 3);
  assert.equal(readNorm(s, 'p1', 'claims.jsonl').length, 3);
});

test('paused in Agent settings: files are written, exit 3, settings.json says so', async () => {
  const s = setup();
  s.fake.editorSet(s.ids.settings, { Paused: true, 'Paused by': [USER], Reason: 'looking at the queue' });
  assert.equal(await s.run(['--all', '--pull-id', 'p1']), EXIT.PAUSED);
  const settings = readNorm(s, 'p1', 'settings.json');
  assert.equal(settings.paused, true);
  assert.deepEqual(settings.paused_by, [USER]);
  assert.equal(settings.reason, 'looking at the queue');
  assert.match(s.cap.out[0], /paused yes/);
  assert.match(s.cap.err.join('\n'), /paused/);
  assert.ok(existsSync(join(s.root, 'runs', 'pull', 'p1', 'norm', 'queue.jsonl')));
  assert.equal(latestPullId(s.root), 'p1');
});

test('paused wins over duplicates; a pull without agent_settings cannot be paused', async () => {
  const s = setup();
  s.fake.editorSet(s.ids.settings, { Paused: true });
  s.fake.add('claims', { 'Claim title': 'twin', 'Geo ID': 'g2' });
  assert.equal(await s.run(['--all', '--pull-id', 'p1']), EXIT.PAUSED);
  assert.equal(await s.run(['--dbs', 'claims', '--pull-id', 'p2']), EXIT.INVALID, 'no settings in this pull: only the duplicate is visible');
});

test('snapshot.json: every editor-owned field of every pulled row, and nothing for databases without any', async () => {
  const s = setup();
  s.fake.editorSet(s.ids.lesson, { Status: 'Rejected' });
  await s.run(['--all', '--pull-id', 'p1']);
  const snap = JSON.parse(readFileSync(join(s.root, 'runs', 'pull', 'p1', 'snapshot.json'), 'utf8'));
  assert.equal(snap.pull_id, 'p1');
  assert.equal(snap.taken_at, '2026-10-13T12:00:00.000Z');
  const dbs = new Set(Object.values(snap.editor_fields).map((e) => e.db));
  assert.deepEqual([...dbs].sort(), ['agent_settings', 'rule_changes', 'tag_decisions']);
  assert.equal(Object.keys(snap.editor_fields).length, 4 + 1 + 1);
  const editorRow = snap.editor_fields[s.ids.decisions['g3::Hypothetical']];
  assert.equal(editorRow.db, 'tag_decisions');
  assert.equal(editorRow.key, 'g3::Hypothetical');
  assert.deepEqual(editorRow.fields, { 'Tag outcome': 'Applies', 'Why wrong': 'Agent slip', 'Your reasoning': 'The rule covers it.', 'Decided by': [USER], 'Decided at': '2026-10-13' });
  const open = snap.editor_fields[s.ids.decisions['g1::Predictive']];
  assert.deepEqual(open.fields, { 'Tag outcome': null, 'Why wrong': null, 'Your reasoning': '', 'Decided by': [], 'Decided at': null });
  assert.deepEqual(snap.editor_fields[s.ids.lesson].fields, { 'Editor wording': '', 'Approved by': [USER], Status: 'Rejected' });
  assert.deepEqual(snap.editor_fields[s.ids.settings].fields, { Paused: false, 'Paused by': [], Reason: '', 'Weekly cap': 40, Owner: [] });
  assert.equal(snap.editor_fields[s.ids.claims.g1], undefined);
});

test('snapshot.json: a lesson status the agent owns counts as no editor value', async () => {
  const s = setup();
  s.fake.editorSet(s.ids.lesson, { Status: 'Live' });
  await s.run(['--dbs', 'rule_changes', '--pull-id', 'p1']);
  const snap = JSON.parse(readFileSync(join(s.root, 'runs', 'pull', 'p1', 'snapshot.json'), 'utf8'));
  assert.equal(snap.editor_fields[s.ids.lesson].fields.Status, null);
});

test('a relation Notion cut at 25 references is completed from the property item endpoint', async () => {
  const s = setup();
  for (let i = 0; i < 30; i++) s.fake.add('tag_decisions', { Key: `m${i}::Debate`, Tag: [s.ids.rulebook.Debate], Lesson: [s.ids.lesson] });
  const asked = [];
  const spy = { ...s.fake.client, retrievePropertyItem: async (...a) => { asked.push(a); return s.fake.client.retrievePropertyItem(...a); } };
  await s.run(['--dbs', 'rule_changes,tag_decisions', '--pull-id', 'p1'], { client: spy });
  const [lesson] = readNorm(s, 'p1', 'lessons.jsonl');
  assert.equal(lesson.supporting_page_ids.length, 31, '30 new rows plus the one from the world');
  assert.ok(asked.length >= 1, 'the endpoint was used');
  const raw = JSON.parse(readFileSync(join(s.root, 'runs', 'pull', 'p1', 'raw', 'rule_changes.json'), 'utf8'));
  assert.equal(raw[0].properties['Supporting rows'].relation.length, 31);
  assert.equal(raw[0].properties['Supporting rows'].has_more, false, 'the raw copy is complete');
});

test('databases that were not pulled keep their id-map entries from the previous pull, and names resolve through them', async () => {
  const s = setup();
  await s.run(['--all', '--pull-id', 'p1']);
  assert.equal(await s.run(['--dbs', 'agent_settings', '--pull-id', 'p2']), EXIT.OK);
  const map2 = JSON.parse(readFileSync(join(s.root, 'runs', 'pull', 'p2', 'id-map.json'), 'utf8'));
  assert.equal(map2.rulebook.Predictive, s.ids.rulebook.Predictive);
  assert.deepEqual(map2.claims, s.ids.claims);
  assert.equal(map2.carried.rulebook, 'p1');
  assert.equal(map2.carried.claims, 'p1');
  assert.equal('agent_settings' in map2.carried, false);
  assert.equal(existsSync(join(s.root, 'runs', 'pull', 'p2', 'norm', 'claims.jsonl')), false, 'no norm file for a database that was not pulled');
  assert.equal(latestPullId(s.root), 'p2');
  // a third pull of claims alone still turns tag ids into names
  assert.equal(await s.run(['--dbs', 'claims', '--pull-id', 'p3']), EXIT.OK);
  assert.deepEqual(readNorm(s, 'p3', 'claims.jsonl')[0].agent_tags.sort(), ['Debate', 'Opinion']);
  const map3 = JSON.parse(readFileSync(join(s.root, 'runs', 'pull', 'p3', 'id-map.json'), 'utf8'));
  assert.equal(map3.carried.rulebook, 'p1', 'carried entries keep pointing at the pull that really fetched them');
  assert.equal(map3.carried.agent_settings, 'p2');
});

test('a property that is missing or has another type exits 4 before anything is normalised, and LATEST is not moved', async () => {
  const s = setup();
  await s.run(['--all', '--pull-id', 'p1']);
  delete s.fake.schemas.tag_decisions.properties['Tag outcome'];
  s.fake.schemas.claims.properties['Sources count'].type = 'rich_text';
  assert.equal(await s.run(['--dbs', 'tag_decisions,claims', '--pull-id', 'p2']), EXIT.DRIFT);
  const err = s.cap.err.join('\n');
  assert.match(err, /tag_decisions: property "Tag outcome" is missing/);
  assert.match(err, /claims: property "Sources count" is rich_text, the scripts expect number/);
  assert.equal(existsSync(join(s.root, 'runs', 'pull', 'p2', 'norm', 'queue.jsonl')), false);
  assert.equal(existsSync(join(s.root, 'runs', 'pull', 'p2', 'id-map.json')), false);
  assert.equal(latestPullId(s.root), 'p1');
});

test('schemaProblems: a wrong database id and a schema without properties are reported', () => {
  const config = createFakeNotion().config;
  const schema = createFakeNotion().schemas.claims;
  assert.deepEqual(schemaProblems('claims', schema, config), []);
  assert.match(schemaProblems('rulebook', schema, config)[0], /Notion returned database/);
  assert.match(schemaProblems('claims', {}, config)[0], /no properties/);
  assert.match(schemaProblems('claims', { properties: [] }, config)[0], /no properties/);
});

test('arguments: exactly one of --dbs and --all, known database names, no token, protected databases', async () => {
  const s = setup();
  assert.equal(await s.run([]), EXIT.INVALID);
  assert.match(s.cap.err.join('\n'), /exactly one of --dbs and --all/);
  assert.equal(await s.run(['--dbs', 'claims', '--all']), EXIT.INVALID);
  assert.equal(await s.run(['--dbs', 'claims,nope']), EXIT.INVALID);
  assert.match(s.cap.err.join('\n'), /unknown database name\(s\): nope/);
  assert.equal(await s.run(['--bogus']), EXIT.INVALID);
  assert.equal(await s.run(['--help']), EXIT.OK);
  assert.match(s.cap.out[0], /^usage: /);
  assert.equal(await s.run(['--all'], { client: null }), EXIT.INVALID);
  assert.match(s.cap.err.join('\n'), /no NOTION_TOKEN/);
  const risky = makeRoot({ config: { ...s.config, notion: { ...s.config.notion, protected_database_ids: [s.config.notion.databases.claims.database_id] } } });
  const code = await main(['--dbs', 'claims'], s.cap.io, { root: risky.root, client: s.fake.client });
  assert.equal(code, EXIT.INVALID);
  assert.match(s.cap.err.join('\n'), /claims is on the protected list/);
  assert.equal(s.fake.requests.filter((r) => r.db === 'claims' && r.method === 'queryAll').length, 0, 'nothing was read from it');
});

test('without --pull-id the id comes from the clock and has no colon', async () => {
  const s = setup();
  assert.equal(await s.run(['--dbs', 'agent_settings']), EXIT.OK);
  assert.equal(latestPullId(s.root), '20261013T120000Z-pull');
  assert.ok(readdirSync(join(s.root, 'runs', 'pull')).includes('20261013T120000Z-pull'));
});

test('API failures: a broken cursor and a refused token exit 2, a server error exits 1; the token is never printed', async () => {
  const s = setup();
  const failing = (error) => ({ ...s.fake.client, queryAll: async () => { throw error; } });
  const broken = Object.assign(new Error('Notion: broken cursor chain'), { code: 'BROKEN_CURSOR' });
  assert.equal(await s.run(['--dbs', 'claims', '--pull-id', 'p1'], { client: failing(broken) }), EXIT.INVALID);
  assert.equal(await s.run(['--dbs', 'claims', '--pull-id', 'p1'], { client: failing(new NotionError('Notion GET -> 401 unauthorized: API token is invalid', { status: 401, code: 'unauthorized' })) }), EXIT.INVALID);
  assert.match(s.cap.err.join('\n'), /integration is connected/);
  assert.equal(await s.run(['--dbs', 'claims', '--pull-id', 'p1'], { client: failing(new NotionError('Notion POST -> 503', { status: 503, code: 'service_unavailable', retryable: true })) }), EXIT.ERROR);
  assert.equal(await s.run(['--dbs', 'claims', '--pull-id', 'p1'], { client: failing(new Error('disk full')) }), EXIT.ERROR);
});

test('loadPull: rows, lookups, decided keys, snapshot; findSchema falls back to the latest pull, then to the newest pull that has it', async () => {
  const s = setup();
  await s.run(['--all', '--pull-id', 'p1']);
  await s.run(['--dbs', 'agent_settings', '--pull-id', 'p2']);
  const p1 = loadPull(s.root, 'p1');
  assert.equal(p1.id, 'p1');
  assert.deepEqual(p1.pulled, DATABASES);
  assert.equal(p1.rows('claims').length, 3);
  assert.equal(p1.rowByKey('claims', 'g2').props['Claim title'], 'The Supreme Court is likely to expand executive power');
  assert.equal(p1.rowByKey('claims', 'nope'), null);
  assert.equal(p1.rowByPageId('claims', s.ids.claims.g1.toUpperCase()).props['Geo ID'], 'g1');
  assert.deepEqual([...p1.decidedKeys()].sort(), ['g2::Predictive', 'g3::Hypothetical']);
  assert.equal(isDecided(p1.rowByKey('tag_decisions', 'g1::Predictive')), false);
  assert.equal(p1.snapshot().pull_id, 'p1');
  assert.equal(p1.schema('claims').properties['Geo ID'].type, 'rich_text');
  const latest = loadPull(s.root);
  assert.equal(latest.id, 'p2');
  assert.equal(latest.covers('claims'), false);
  assert.equal(latest.schema('claims'), null);
  assert.equal(latest.rows('claims').length, 0);
  assert.equal(findSchema(s.root, 'claims', 'p2').properties['Geo ID'].type, 'rich_text', 'neither p2 nor LATEST has it, p1 does');
  assert.equal(findSchema(makeRoot().root, 'claims'), null, 'no pull on disk');
  assert.equal(findSchema(s.root, 'claims', 'p1').properties['Geo ID'].type, 'rich_text');
  assert.throws(() => loadPull(s.root, 'nope'), /does not exist/);
  assert.throws(() => loadPull(makeRoot().root), /no pull yet/);
});

test('after a partial post-apply pull becomes LATEST, findSchema and a Runs plan use the newest pull that fetched the database', async () => {
  const s = setup();
  // names sort the other way round from taken_at, so the order must come from the manifests
  await s.run(['--all', '--pull-id', 'z-older'], { now: clockAt('2026-10-13T09:00:00.000Z') });
  await s.run(['--all', '--pull-id', 'a-newer'], { now: clockAt('2026-10-13T10:00:00.000Z') });
  await s.run(['--dbs', 'claims,tag_decisions,agent_settings', '--pull-id', 'run-1-propose-post'], { now: clockAt('2026-10-13T11:00:00.000Z') });
  assert.equal(latestPullId(s.root), 'run-1-propose-post');
  const older = join(s.root, 'runs', 'pull', 'z-older', 'schema', 'runs.json');
  writeFileSync(older, JSON.stringify({ ...JSON.parse(readFileSync(older, 'utf8')), marker: 'z-older' }));
  const found = findSchema(s.root, 'runs', 'run-1-propose-post');
  assert.equal(found.properties.Kind.type, 'select');
  assert.equal(found.marker, undefined, 'the newer full pull wins over the older one');
  // what run-card.mjs does right after apply.mjs: a Runs create planned against the partial LATEST
  const plan = openPlan({ runId: 'run-1-card', root: s.root });
  plan.create('runs', 'Tag R1', { Kind: 'Tag', Verdict: 'n/a' }, { note: 'run card' });
  assert.equal(plan.ops.length, 1);
});

test('pull() can be called as a library: returns counts, drift, paused and a summary line', async () => {
  const s = setup();
  const result = await pull({ root: s.root, client: s.fake.client, dbs: ['claims', 'tag_decisions'], pullId: 'lib', now: clockAt('2026-10-13T09:30:00.000Z') });
  assert.equal(result.code, EXIT.OK);
  assert.deepEqual(result.counts, { claims: 3, tag_decisions: 4 });
  assert.equal(result.pullId, 'lib');
  assert.deepEqual(result.drift, []);
  assert.match(result.line, /^pull lib: claims 3, tag_decisions 4; drift 0; duplicates 0; paused no$/);
  await assert.rejects(() => pull({ root: s.root, client: s.fake.client, dbs: ['nope'] }), /unknown database/);
});

test('a pull reads only: the fake saw no write calls', async () => {
  const s = setup();
  await s.run(['--all', '--pull-id', 'p1']);
  assert.deepEqual(s.fake.writes(), []);
});

test('over HTTP through the REST client: a relation cut at 25 references is completed from the property item endpoint', async () => {
  const { createClient } = await import('../agents/claim-tagger/scripts/lib/notion-rest.mjs');
  const s = setup();
  for (let i = 0; i < 60; i++) s.fake.add('tag_decisions', { Key: `m${i}::Debate`, Tag: [s.ids.rulebook.Debate], Lesson: [s.ids.lesson] });
  const client = createClient({ token: 'ntn_FAKE_TOKEN_FOR_TESTS', fetchImpl: s.fake.fetch, requestsPerSecond: 1000 });
  const result = await pull({ root: s.root, client, dbs: ['rule_changes', 'tag_decisions'], pullId: 'http', now: clockAt('2026-10-13T12:00:00.000Z') });
  assert.equal(result.code, EXIT.OK);
  const [lesson] = readNorm(s, 'http', 'lessons.jsonl');
  assert.equal(lesson.supporting_page_ids.length, 61);
  assert.equal(new Set(lesson.supporting_page_ids).size, 61);
});

test('computed properties no script reads (allowlist.OPTIONAL_PROPERTIES) may be renamed without failing the pull', async () => {
  const s = setup();
  // The list is read from the allowlist, not copied here: the formulas read the others (Lesson status feeds Stage), so those must stay required.
  const optional = Object.entries(OPTIONAL_PROPERTIES).flatMap(([db, names]) => names.map((name) => [db, name]));
  assert.ok(optional.length >= 1, 'some computed properties are optional');
  for (const [db, name] of optional) delete s.fake.schemas[db].properties[name];
  assert.equal(await s.run(['--dbs', 'tag_decisions,claims', '--pull-id', 'p1']), EXIT.OK, s.cap.err.join('\n'));
});

// ---- the option contract (EN-13): lib/notion-contract.mjs REQUIRED_OPTIONS, checked by schemaProblems ----------------------

/** Take the option `name` out of the select `prop` of a fake schema (the fake hands out copies of this object). */
function removeOption(schemas, db, prop, name) {
  const options = schemas[db].properties[prop].select.options;
  const i = options.findIndex((o) => o.name === name);
  assert.ok(i >= 0, `${db}.${prop} has no option "${name}" to remove`);
  options.splice(i, 1);
}

const sorted = (list) => [...list].sort();

test('schemaProblems: a select that lacks a required option is reported with database, property and option name', () => {
  const { config, schemas } = createFakeNotion();
  assert.deepEqual(schemaProblems('tag_decisions', schemas.tag_decisions, config), []);
  removeOption(schemas, 'tag_decisions', 'Why wrong', 'Rule unclear');
  const problems = schemaProblems('tag_decisions', schemas.tag_decisions, config);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /tag_decisions/);
  assert.match(problems[0], /"Why wrong"/);
  assert.match(problems[0], /"Rule unclear"/);
  assert.equal(problems[0], 'tag_decisions: property "Why wrong" has no option "Rule unclear" (renamed or deleted?)');
});

test('schemaProblems: a renamed option counts as missing, and names are matched exactly (case and spaces)', () => {
  const { config, schemas } = createFakeNotion();
  schemas.tag_decisions.properties['Why wrong'].select.options.find((o) => o.name === 'Rule unclear').name = 'Rule is unclear';
  schemas.tag_decisions.properties['Agent follow-up'].select.options.find((o) => o.name === 'Fixed').name = 'Fixed ';
  schemas.runs.properties.Verdict.select.options.find((o) => o.name === 'PASS').name = 'pass';
  assert.deepEqual(sorted(schemaProblems('tag_decisions', schemas.tag_decisions, config)), sorted([
    'tag_decisions: property "Why wrong" has no option "Rule unclear" (renamed or deleted?)',
    'tag_decisions: property "Agent follow-up" has no option "Fixed" (renamed or deleted?)',
  ]));
  assert.deepEqual(schemaProblems('runs', schemas.runs, config), ['runs: property "Verdict" has no option "PASS" (renamed or deleted?)']);
});

test('schemaProblems: extra options are fine, in every select of every database', () => {
  const { config, schemas } = createFakeNotion();
  for (const [db, schema] of Object.entries(schemas)) {
    for (const def of Object.values(schema.properties)) {
      if (def.type === 'select') def.select.options.push({ id: 'extra-1', name: 'Brand new option', color: 'gray' }, { id: 'extra-2', name: 'Rollback', color: 'red' });
    }
    assert.deepEqual(schemaProblems(db, schema, config), [], db);
  }
});

test('schemaProblems: every missing option is reported once, across properties and databases', () => {
  const { config, schemas } = createFakeNotion();
  removeOption(schemas, 'rulebook', 'Status', 'Verified');
  removeOption(schemas, 'claims', 'Readiness', 'Ready');
  removeOption(schemas, 'claims', 'Readiness', 'Fix needed');
  removeOption(schemas, 'rule_changes', 'Status', 'Rolled back');
  assert.deepEqual(schemaProblems('rulebook', schemas.rulebook, config), ['rulebook: property "Status" has no option "Verified" (renamed or deleted?)']);
  assert.deepEqual(sorted(schemaProblems('claims', schemas.claims, config)), sorted([
    'claims: property "Readiness" has no option "Fix needed" (renamed or deleted?)',
    'claims: property "Readiness" has no option "Ready" (renamed or deleted?)',
  ]));
  assert.deepEqual(schemaProblems('rule_changes', schemas.rule_changes, config), ['rule_changes: property "Status" has no option "Rolled back" (renamed or deleted?)']);
});

test('schemaProblems: a select that is missing or has another type is reported once as a property, not once per option', () => {
  const { config, schemas } = createFakeNotion();
  delete schemas.tag_decisions.properties['Why wrong'];
  schemas.claims.properties.Readiness.type = 'rich_text';
  assert.deepEqual(schemaProblems('tag_decisions', schemas.tag_decisions, config), ['tag_decisions: property "Why wrong" is missing (renamed or deleted?)']);
  assert.deepEqual(schemaProblems('claims', schemas.claims, config), ['claims: property "Readiness" is rich_text, the scripts expect select']);
});

test('schemaProblems: an option that is live but optional (Runs Kind Rollback) may be absent', () => {
  const { config, schemas } = createFakeNotion();
  assert.equal(schemas.runs.properties.Kind.select.options.some((o) => o.name === 'Rollback'), false, 'the fixture has no Rollback option');
  assert.deepEqual(schemaProblems('runs', schemas.runs, config), []);
});

test('an option list the API did not return is a warning, not a schema problem (the allowlist then refuses every write to that select)', async () => {
  const s = setup();
  delete s.fake.schemas.rulebook.properties.Category.select.options;
  assert.deepEqual(schemaProblems('rulebook', s.fake.schemas.rulebook, s.fake.config), []);
  assert.deepEqual(schemaWarnings('rulebook', s.fake.schemas.rulebook), ['rulebook: property "Category" has no readable option list, so its options were not checked']);
  assert.deepEqual(schemaWarnings('claims', s.fake.schemas.claims), []);
  assert.deepEqual(schemaWarnings('claims', {}), []);
  assert.equal(await s.run(['--dbs', 'rulebook', '--pull-id', 'p1']), EXIT.OK);
  assert.match(s.cap.err.join('\n'), /pull: warning: rulebook: property "Category" has no readable option list/);
  const info = JSON.parse(readFileSync(join(s.root, 'runs', 'pull', 'p1', 'pull.json'), 'utf8'));
  assert.equal(info.warnings.length, 1, 'recorded in the manifest too');
});

test('a missing option exits 4 like a missing property: schema_problems in pull.json, nothing normalised, LATEST not moved', async () => {
  const s = setup();
  await s.run(['--all', '--pull-id', 'p1']);
  removeOption(s.fake.schemas, 'tag_decisions', 'Why wrong', 'Rule unclear');
  removeOption(s.fake.schemas, 'runs', 'Verdict', 'PASS');
  assert.equal(await s.run(['--dbs', 'tag_decisions,runs', '--pull-id', 'p2']), EXIT.DRIFT);
  const err = s.cap.err.join('\n');
  assert.match(err, /tag_decisions: property "Why wrong" has no option "Rule unclear"/);
  assert.match(err, /runs: property "Verdict" has no option "PASS"/);
  assert.match(err, /fix the property or option in Notion/);
  assert.match(s.cap.out[0], /^pull p2: 2 schema problem\(s\), nothing normalised$/);
  assert.equal(existsSync(join(s.root, 'runs', 'pull', 'p2', 'norm', 'queue.jsonl')), false);
  assert.equal(existsSync(join(s.root, 'runs', 'pull', 'p2', 'id-map.json')), false);
  assert.equal(latestPullId(s.root), 'p1');
  const info = JSON.parse(readFileSync(join(s.root, 'runs', 'pull', 'p2', 'pull.json'), 'utf8'));
  assert.equal(info.schema_problems.length, 2);
});

test('only the databases being pulled are checked for options', async () => {
  const s = setup();
  removeOption(s.fake.schemas, 'claims', 'Readiness', 'Not checkable');
  assert.equal(await s.run(['--dbs', 'agent_settings,runs', '--pull-id', 'p1']), EXIT.OK, s.cap.err.join('\n'));
  assert.equal(await s.run(['--dbs', 'claims', '--pull-id', 'p2']), EXIT.DRIFT);
  assert.match(s.cap.err.join('\n'), /claims: property "Readiness" has no option "Not checkable"/);
});
