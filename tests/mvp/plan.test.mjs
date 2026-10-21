import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT } from '../../agents/claim-tagger-mvp/scripts/lib/exit-codes.mjs';
import { editorColumns as editorColumnsOf } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import { createClient } from '../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';
import {
  AUDIT_PREFIX, MAX_CONSECUTIVE_FAILURES, PlanError, applyPlan, checkPlan, compareWritten, newPlan, readLedger, readPlan,
} from '../../agents/claim-tagger-mvp/scripts/lib/plan.mjs';
import { createFakeNotion } from './fixtures/fake-notion.mjs';
import { builtConfig } from './helpers/config-fixture.mjs';
import { TABLE_SPECS, restProps } from './helpers/tables.mjs';

// The tests use the shared in-memory Notion (fixtures/fake-notion.mjs) behind the real REST client, so the client's own rules run too:
// a create whose answer is lost is never sent twice, and every request is on the log.

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-plan-'));
  dirs.push(d);
  return d;
};

const DB = {
  rulebook: 'b1000000000000000000000000000001',
  claims_copy: 'b1000000000000000000000000000002',
  tag_decisions: 'b1000000000000000000000000000003',
  rule_changes: 'b1000000000000000000000000000004',
  agent_settings: 'b1000000000000000000000000000005',
};
const PROTECTED_DB = '7219756338b2416f8fa8af83d75ec47d'; // the real claims table, first protected source
const PROTECTED_PAGE = '3da273e214eb80c180d5fd0894bc2db8';
const EDITION = '2026-10-16.1';
const NOW = () => new Date('2026-10-15T10:00:00.000Z');

// a client over the fake: the real REST client, paced at 1000 a second, with no waiting between retries
const clientOver = (notion, fetchImpl = notion.fetchImpl) => createClient({ token: notion.token, fetchImpl, requestsPerSecond: 1000, sleep: async () => {} });

/** A config whose five tables have ids, a state folder, a Notion with the five tables, a client and the schemas the client reads. */
async function world({ rows = true } = {}) {
  const config = builtConfig();
  config.notion.requests_per_second = 1000;
  const set = (entry, table, n) => {
    entry.database_id = DB[table];
    entry.data_source_id = `c100000000000000000000000000000${n}`;
  };
  set(config.notion.rulebook, 'rulebook', 1);
  set(config.notion.claims[0], 'claims_copy', 2);
  set(config.notion.databases.tag_decisions, 'tag_decisions', 3);
  set(config.notion.databases.rule_changes, 'rule_changes', 4);
  set(config.notion.databases.agent_settings, 'agent_settings', 5);
  const notion = createFakeNotion();
  for (const [table, spec] of Object.entries(TABLE_SPECS)) {
    notion.addDatabase({ id: DB[table], title: table, properties: restProps(spec, table === 'rulebook' ? null : notion.dataSource(DB.rulebook).id) });
  }
  const client = clientOver(notion);
  const schemas = {};
  for (const table of Object.keys(TABLE_SPECS)) schemas[table] = await client.retrieveDatabase(DB[table]);
  const ids = {};
  if (rows) {
    ids.claimA = notion.addRow(DB.claims_copy, { 'Geo Name': 'Claim A', 'Geo ID': 'geo-a', 'Geo Is factual': false });
    ids.claimB = notion.addRow(DB.claims_copy, { 'Geo Name': 'Claim B', 'Geo ID': 'geo-b', 'Geo Is factual': false });
    ids.decision = notion.addRow(DB.tag_decisions, { Claim: 'Claim A', Key: 'geo-a::Context-dependent', Tag: 'Context-dependent', 'Agent proposal': 'Can\'t tell', 'Agent confidence': 0.5 });
  }
  const root = tmp();
  return { config, notion, client, schemas, ids, root, dir: join(tmp(), 'run-1') };
}

/** What pull.mjs hands to applyPlan: pulled[table][key] = the plain row by Notion column names, plus page_id. */
function pullFrom(w, tables = Object.keys(TABLE_SPECS)) {
  const keyOf = { rulebook: 'Name', claims_copy: 'Geo ID', tag_decisions: 'Key', rule_changes: 'Lesson', agent_settings: 'Name' };
  const out = {};
  for (const table of tables) out[table] = Object.fromEntries(w.notion.plainRows(DB[table]).map((row) => [row[keyOf[table]], row]));
  return out;
}

const apply = (w, plan, extra = {}) => applyPlan({ plan, dir: w.dir, client: w.client, config: w.config, schemas: w.schemas, pulled: {}, root: w.root, now: NOW, ...extra });
const problemsOf = (plan, w, opts = {}) => checkPlan(plan, w.config, { root: w.root, ...opts }).problems;
const mentions = (problems, re) => problems.some((p) => re.test(p));

const newP = (w, extra = {}) => newPlan({ runId: 'run-1', script: 'test', rubricEdition: EDITION, config: w.config, now: NOW, ...extra });
const decision = (plan, geo, props = {}) => plan.create('tag_decisions', `${geo}::Context-dependent`, {
  Claim: `Claim ${geo}`, Tag: 'Context-dependent', 'Agent proposal': 'Applies', 'Agent confidence': 0.83, 'Agent reason': 'A pronoun has no antecedent', 'Claim link': `https://example.com/${geo}`, 'Rulebook edition': EDITION, ...props,
});
const jsonl = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ---- the builder and the plan file --------------------------------------------------------------------------------------------------

test('newPlan collects ops, adds the key column of a create, and writes the header line then one op per line', async () => {
  const w = await world();
  const plan = newP(w);
  decision(plan, 'geo-9');
  plan.update('claims_copy', 'geo-a', w.ids.claimA, { 'Agent edition': 'Context-dependent', 'Agent remarks': 'one line\nsecond line' }, { expect: { 'Agent edition': '' } });
  plan.create('rule_changes', 'Hedged claims are not context-dependent', { Tag: 'Context-dependent', Status: 'Proposed' }, { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }] });
  assert.equal(plan.ops.length, 3);
  assert.equal(plan.ops[0].properties.Key, 'geo-9::Context-dependent', 'the builder put the key column in');
  assert.equal(plan.ops[2].properties.Lesson, 'Hedged claims are not context-dependent');
  assert.equal('page_id' in plan.ops[0], false, 'a create has no page_id');
  assert.deepEqual(plan.header().plan.counts, { creates: 2, updates: 1 });

  const file = plan.write(w.dir);
  assert.equal(file, join(w.dir, 'plan.jsonl'));
  const lines = jsonl(file);
  assert.equal(lines.length, 4);
  assert.deepEqual(Object.keys(lines[0]), ['plan']);
  assert.deepEqual(lines[0].plan, { run_id: 'run-1', script: 'test', created_at: '2026-10-15T10:00:00.000Z', rubric_edition: EDITION, counts: { creates: 2, updates: 1 } });
  assert.equal(lines[2].op, 'update');
  assert.equal(lines[2].page_id, w.ids.claimA);
  assert.deepEqual(lines[2].expect, { 'Agent edition': '' });
  assert.equal(lines[3].children.length, 1);

  const read = readPlan(w.dir);
  assert.deepEqual(read.ops, plan.ops, 'the plan on disk is the plan in memory');
  assert.deepEqual(read.header, plan.header());
  assert.equal(checkPlan(read, w.config, { root: w.root }).ok, true);
  assert.equal(plan.readPlan, readPlan);
});

test('the builder rejects what cannot be a plan at all: no run id, no key, properties that are not an object, a number that is not finite', async () => {
  const w = await world({ rows: false });
  assert.throws(() => newPlan({ script: 'x' }), /runId/);
  assert.throws(() => newPlan({ runId: 'r' }), /script/);
  const plan = newP(w);
  assert.throws(() => plan.create('tag_decisions', '', {}), /key/);
  assert.throws(() => plan.create('tag_decisions', 'k', null), /object/);
  assert.throws(() => plan.create('tag_decisions', 'k', { 'Agent confidence': Number.NaN }), /finite/);
  assert.throws(() => plan.update('tag_decisions', 'k', 'p', 'x'), /object/);
  assert.equal(plan.ops.length, 0);
});

test('write refuses a line that fails the schema and writes nothing; readPlan refuses a missing, torn or invalid file', async () => {
  const w = await world({ rows: false });
  const plan = newP(w);
  plan.create('bogus_table', 'k', { Key: 'k' });
  assert.throws(() => plan.write(w.dir), (e) => e instanceof PlanError && e.problems.some((p) => /op 1/.test(p)));
  assert.equal(existsSync(join(w.dir, 'plan.jsonl')), false);

  assert.throws(() => readPlan(w.dir), /plan\.jsonl is missing/);
  mkdirSync(w.dir, { recursive: true });
  writeFileSync(join(w.dir, 'plan.jsonl'), '');
  assert.throws(() => readPlan(w.dir), /empty/);

  const good = newP(w);
  decision(good, 'geo-1');
  good.write(w.dir);
  appendFileSync(join(w.dir, 'plan.jsonl'), '{"op": "create", "tab');
  assert.throws(() => readPlan(w.dir), /half-written/);

  const bad = join(tmp(), 'bad');
  mkdirSync(bad);
  writeFileSync(join(bad, 'plan.jsonl'), `${JSON.stringify(good.header())}\n${JSON.stringify({ op: 'update', table: 'tag_decisions', key: 'k', properties: {} })}\n`);
  assert.throws(() => readPlan(bad), (e) => e instanceof PlanError && /not valid/.test(e.message) && e.problems.some((p) => /page_id/.test(p)));
});

test('write will not put a different list of ops next to an existing ledger, and accepts the same ops again', async () => {
  const w = await world();
  const first = newP(w);
  decision(first, 'geo-1');
  await apply(w, first);
  assert.ok(existsSync(join(w.dir, 'ledger.jsonl')));
  const again = newP(w, { now: () => new Date('2026-10-16T10:00:00.000Z') });
  decision(again, 'geo-1');
  assert.doesNotThrow(() => again.write(w.dir), 'the same ops, a later header');
  const other = newP(w);
  decision(other, 'geo-2');
  assert.throws(() => other.write(w.dir), (e) => e instanceof PlanError && /ledger/.test(e.message));
});

// ---- checkPlan: one failing case per rule ---------------------------------------------------------------------------------------------

test('checkPlan accepts a plan made of agent columns only', async () => {
  const w = await world();
  const plan = newP(w);
  decision(plan, 'geo-1');
  plan.update('tag_decisions', 'geo-a::Context-dependent', w.ids.decision, {
    'Agent proposal': 'Applies', 'Agent confidence': 0.9, 'Follow-up': 'Fixed', 'Tag outcome': 'Applies', 'Why wrong': 'Rule unclear', 'Your reasoning': 'Rule 3 says too little.', 'Decided under': EDITION,
  });
  plan.update('claims_copy', 'geo-b', w.ids.claimB, { 'Agent edition': '', 'Agent remarks': 'no tags\nnothing waits for an editor' });
  plan.create('rule_changes', 'A lesson', { Tag: 'Context-dependent', Rule: 'Context-dependent rule 2', Kind: 'Change the rule', 'Current text': 'old', 'Proposed text': 'new', 'Safety check result': 'PASS', 'Supporting rows': 'x · k', Status: 'Proposed' });
  plan.update('agent_settings', 'claim-tagger-mvp', 'a-page-id', { 'Rulebook edition': EDITION, 'Last run summary': 'Tag · 15 Oct 11:20' });
  plan.update('rulebook', 'Context-dependent', 'another-page-id', { 'When to use': '1. A pronoun with no antecedent.' });
  // the agent's three columns on the claims, and the ledger's copies of a decision (Tag outcome, Why wrong, Your reasoning, Decided under): none of them is an editor column now
  plan.update('claims_copy', 'geo-a', w.ids.claimA, { 'Agent edition': 'Context-dependent', 'Agent remarks': 'Context-dependent\nnothing waits for an editor · edition 2026-10-16.1', 'Agent confidence': 0.83 });
  decision(plan, 'geo-2', { 'Tag outcome': 'Does not apply', 'Why wrong': 'Agent slip', 'Your reasoning': 'It reads on its own.', 'Decided under': EDITION });
  const checked = checkPlan(plan, w.config, { root: w.root });
  assert.deepEqual(checked, { ok: true, problems: [], counts: { creates: 3, updates: 5 } });
});

test('checkPlan: the table must be one of the five', async () => {
  const w = await world();
  const plan = newP(w);
  plan.create('claims', 'k', { Key: 'k' });
  plan.create('runs', 'k', { Key: 'k' });
  const problems = problemsOf(plan, w);
  assert.ok(mentions(problems, /"claims" is not one of this agent's tables/), problems.join('\n'));
  assert.ok(mentions(problems, /"runs" is not one of/));
  assert.equal(checkPlan(plan, w.config).ok, false);
});

test('checkPlan: a column outside the table\'s writable set is refused, with the plain name in the message', async () => {
  const w = await world();
  const plan = newP(w);
  decision(plan, 'geo-1', { 'Decided by': 'someone' });
  plan.update('claims_copy', 'geo-a', w.ids.claimA, { 'Geo Name': 'A rewritten claim' });
  plan.update('claims_copy', 'geo-b', w.ids.claimB, { 'Review notes': 'x' });
  plan.update('rulebook', 'Context-dependent', 'p1', { Description: 'x' });
  plan.update('agent_settings', 'claim-tagger-mvp', 'p2', { Name: 'renamed', Reason: 'x' });
  plan.create('rule_changes', 'L', { Tag: 'Context-dependent', Foo: 'x' });
  const problems = problemsOf(plan, w);
  assert.ok(mentions(problems, /"Decided by" is not a column this plan may write to tag_decisions/), problems.join('\n'));
  assert.ok(mentions(problems, /"Geo Name" is not a column this plan may write to claims_copy/));
  assert.ok(mentions(problems, /"Review notes" is not a column this plan may write to claims_copy/));
  assert.ok(mentions(problems, /"Description" is not a column this plan may write to rulebook/));
  assert.ok(mentions(problems, /"Name" is not a column this plan may write to agent_settings/));
  assert.ok(mentions(problems, /"Reason" is not a column this plan may write to agent_settings/));
  assert.ok(mentions(problems, /"Foo" is not a column this plan may write to rule_changes/));
});

test('checkPlan: setup lets a create fill what the one-time setup fills, and only a create', async () => {
  const w = await world();
  const plan = newP(w);
  plan.create('agent_settings', 'claim-tagger-mvp', { 'Rulebook edition': EDITION });
  plan.create('rulebook', 'Context-dependent', { Category: 'Quality', Description: 'd', 'Example Claims': 'e', 'Work tags': ['Issue'], Status: 'Verified', 'Verified on': '2026-09-10', 'When to use': '1. x' });
  plan.create('claims_copy', 'geo-9', { 'Geo Name': 'A claim', 'Geo URL': 'https://example.com/x', 'Geo Sources': 'x', 'Geo Tags': ['Debate'], 'Geo Score': 3, 'Geo Is factual': true, 'Agent edition': '', 'Agent remarks': '' });
  assert.ok(mentions(problemsOf(plan, w, { setup: false }), /not a column/), 'without setup the same plan is refused');
  assert.deepEqual(problemsOf(plan, w, { setup: true }), []);
  const update = newP(w);
  update.update('rulebook', 'Context-dependent', 'p1', { Description: 'changed' });
  assert.ok(mentions(problemsOf(update, w, { setup: true }), /"Description" is not a column this plan may write to rulebook/), 'setup does not widen an update');
});

const CLAIM_EDITOR = { 'Verified tags': [], 'Review status': 'Reviewed', 'Why wrong': 'Rule unclear', 'Challenged tags notes': 'Context-dependent: rule 3 is unclear.' };

test('checkPlan: an editor column is refused on every table, in every form, without the audit seed', async () => {
  const w = await world();
  const plan = newP(w);
  plan.update('claims_copy', 'geo-a', w.ids.claimA, { 'Verified tags': [] });
  plan.update('claims_copy', 'geo-b', w.ids.claimB, { 'Review status': 'Reviewed' });
  plan.create('claims_copy', 'geo-c', { 'Why wrong': 'Rule unclear' });
  plan.create('claims_copy', 'geo-d', { 'Challenged tags notes': 'because' });
  plan.create('rule_changes', 'L', { Tag: 'Context-dependent', 'Editor wording': 'my words' });
  plan.update('agent_settings', 'claim-tagger-mvp', 'p', { Paused: true });
  const problems = problemsOf(plan, w);
  for (const name of ['Verified tags', 'Review status', 'Why wrong', 'Challenged tags notes', 'Editor wording', 'Paused']) {
    assert.ok(mentions(problems, new RegExp(`"${name}" is a column only an editor writes`)), `${name}\n${problems.join('\n')}`);
  }
  assert.equal(problems.filter((p) => /only an editor writes/.test(p)).length, 6, 'one problem per column, no more');
});

test('checkPlan: the ledger (Tag decisions) has no editor column: its copy of a decision is the agent\'s to write', async () => {
  const w = await world();
  const plan = newP(w);
  decision(plan, 'geo-1', { 'Tag outcome': 'Applies', 'Why wrong': 'Rule unclear', 'Your reasoning': 'because', 'Decided under': EDITION });
  plan.update('tag_decisions', 'geo-a::Context-dependent', w.ids.decision, { 'Tag outcome': 'Does not apply', 'Why wrong': null, 'Your reasoning': null });
  assert.deepEqual(problemsOf(plan, w), []);
  assert.deepEqual(editorColumnsOf(w.config, 'tag_decisions'), []);
});

test('checkPlan: the audit seed is the one exception, a setup create or update of a claim whose Challenged tags notes say so', async () => {
  const w = await world();
  const seeded = (notes, extra = {}) => ({ ...CLAIM_EDITOR, 'Challenged tags notes': notes, ...extra });

  const ok = newP(w);
  ok.update('claims_copy', 'geo-a', w.ids.claimA, seeded(`${AUDIT_PREFIX}: the claim reads on its own.`));
  ok.create('claims_copy', 'geo-9', seeded(`${AUDIT_PREFIX}: x`, { 'Geo Name': 'A claim' }));
  assert.deepEqual(problemsOf(ok, w, { setup: true }), [], 'setup + audit prefix: the four columns are allowed, on an update and on a create');
  assert.ok(mentions(problemsOf(ok, w, { setup: false }), /"Review status" is a column only an editor writes/), 'no setup flag: refused');

  const noPrefix = newP(w);
  noPrefix.update('claims_copy', 'geo-a', w.ids.claimA, seeded('My own reasoning'));
  assert.ok(mentions(problemsOf(noPrefix, w, { setup: true }), /"Review status" is a column only an editor writes/), 'setup but not an audit decision: refused');

  const almost = newP(w);
  almost.update('claims_copy', 'geo-a', w.ids.claimA, seeded('from the audit of 9 October'));
  assert.ok(mentions(problemsOf(almost, w, { setup: true }), /"Challenged tags notes" is a column only an editor writes/), 'the prefix is exact');

  const otherColumn = newP(w);
  otherColumn.update('claims_copy', 'geo-a', w.ids.claimA, seeded(`${AUDIT_PREFIX}: x`, { 'Review notes': 'someone' }));
  assert.ok(mentions(problemsOf(otherColumn, w, { setup: true }), /"Review notes" is not a column this plan may write to claims_copy/), 'the seed opens the four columns, nothing else');

  const wrongTable = newP(w);
  wrongTable.create('rule_changes', 'L', { Tag: 'Context-dependent', 'Editor wording': `${AUDIT_PREFIX}: x` });
  wrongTable.update('tag_decisions', 'geo-a::Context-dependent', w.ids.decision, { 'Your reasoning': `${AUDIT_PREFIX}: x` });
  const problems = problemsOf(wrongTable, w, { setup: true });
  assert.ok(mentions(problems, /"Editor wording" is a column only an editor writes/), 'the exception is for the claims');
  assert.equal(problems.length, 1, 'and the ledger needs no exception');
});

test('checkPlan: a demo profile may fill the claims\' editor columns on a create, but only while runs/SETUP exists under the root', async () => {
  const w = await world();
  w.config.demo = true;
  w.config.demo_id = 'practice-1';
  const plan = newP(w);
  plan.create('claims_copy', 'geo-9', { 'Geo Name': 'A claim', ...CLAIM_EDITOR });
  plan.create('rule_changes', 'L', { Tag: 'Context-dependent', 'Editor wording': 'my words', Status: 'Proposed' });
  assert.ok(mentions(problemsOf(plan, w, { setup: true }), /only an editor writes/), 'no SETUP marker: refused');
  mkdirSync(join(w.root, 'runs'), { recursive: true });
  writeFileSync(join(w.root, 'runs', 'SETUP'), '{}\n');
  assert.deepEqual(problemsOf(plan, w, { setup: true }), []);
  const update = newP(w);
  update.update('claims_copy', 'geo-a', w.ids.claimA, { 'Review status': 'Reviewed' });
  assert.ok(mentions(problemsOf(update, w), /only an editor writes/), 'never on an update');
  const production = structuredClone(w.config);
  production.demo = false;
  assert.ok(mentions(checkPlan(plan, production, { root: w.root, setup: true }).problems, /only an editor writes/), 'a production config ignores the marker');
});

test('checkPlan: demoEditor lets an agent act as the editor on a practice page: an update of the claims\' four columns, and of Editor wording and Approved or Rejected', async () => {
  const w = await world();
  const practiceRoot = join(tmp(), 'runs', 'demos', 'practice-1');
  mkdirSync(practiceRoot, { recursive: true });
  w.config.demo = true;
  w.config.demo_id = 'practice-1';
  const plan = newP(w);
  plan.update('claims_copy', 'geo-a', w.ids.claimA, { ...CLAIM_EDITOR });
  plan.update('rule_changes', 'A lesson', 'p1', { 'Editor wording': 'my words', Status: 'Approved' });
  plan.update('rule_changes', 'Another lesson', 'p2', { Status: 'Rejected' });
  assert.deepEqual(problemsOf(plan, w, { root: practiceRoot, demoEditor: true }), []);
  assert.ok(mentions(problemsOf(plan, w, { root: practiceRoot }), /only an editor writes/), 'without the option: refused');
  assert.ok(mentions(problemsOf(plan, w, { root: w.root, demoEditor: true }), /only an editor writes/), 'a folder that is not a practice page: refused');
  const production = structuredClone(w.config);
  production.demo = false;
  assert.ok(mentions(checkPlan(plan, production, { root: practiceRoot, demoEditor: true }).problems, /only an editor writes/), 'a production config: refused');
  const create = newP(w);
  create.create('claims_copy', 'geo-9', { 'Geo Name': 'A claim', 'Review status': 'Reviewed' });
  assert.ok(mentions(problemsOf(create, w, { root: practiceRoot, demoEditor: true }), /only an editor writes/), 'never on a create');
  const ledger = newP(w);
  ledger.update('agent_settings', 'claim-tagger-mvp', 'p', { Paused: true });
  assert.ok(mentions(problemsOf(ledger, w, { root: practiceRoot, demoEditor: true }), /"Paused" is a column only an editor writes/), 'Paused stays a person\'s');
});

test('checkPlan: Status on rule_changes is Proposed, Live or Rolled back and nothing else', async () => {
  const w = await world();
  for (const status of ['Proposed', 'Live', 'Rolled back']) {
    const plan = newP(w);
    plan.create('rule_changes', `L ${status}`, { Tag: 'Context-dependent', Status: status });
    assert.deepEqual(problemsOf(plan, w), [], status);
  }
  for (const status of ['Approved', 'Rejected', 'Done', null, '']) {
    const plan = newP(w);
    plan.create('rule_changes', 'L', { Tag: 'Context-dependent', Status: status });
    assert.ok(mentions(problemsOf(plan, w), /Status .* is not one a script may write/), String(status));
  }
  const demo = structuredClone(w.config);
  demo.demo = true;
  mkdirSync(join(w.root, 'runs'), { recursive: true });
  writeFileSync(join(w.root, 'runs', 'SETUP'), '{}\n');
  const plan = newP(w);
  plan.create('rule_changes', 'L', { Tag: 'Context-dependent', Status: 'Approved' });
  assert.ok(mentions(checkPlan(plan, demo, { root: w.root }).problems, /Status "Approved"/), 'not even a demo setup writes Approved');
});

test('checkPlan: a protected id anywhere in the plan is refused (dashes and case ignored), and so is a protected table', async () => {
  const w = await world();
  const spots = {
    'a property value': (p) => decision(p, 'geo-1', { 'Agent reason': `see https://www.notion.so/${PROTECTED_DB}` }),
    'a dashed id in a value': (p) => decision(p, 'geo-1', { 'Agent reason': '72197563-38b2-416f-8fa8-af83d75ec47d' }),
    'an upper-case id': (p) => decision(p, 'geo-1', { 'Agent reason': PROTECTED_DB.toUpperCase() }),
    'a page id': (p) => p.update('claims_copy', 'geo-a', PROTECTED_PAGE, { 'Agent edition': 'x' }),
    'a dashed page id': (p) => p.update('claims_copy', 'geo-a', '3da273e2-14eb-80c1-80d5-fd0894bc2db8', { 'Agent edition': 'x' }),
    'a key': (p) => p.create('rule_changes', `Lesson ${PROTECTED_DB}`, { Tag: 'Context-dependent' }),
    'a block of page content': (p) => p.create('rule_changes', 'L', { Tag: 'Context-dependent' }, { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'x', link: { url: `https://www.notion.so/${PROTECTED_PAGE}` } } }] } }] }),
    'an expect value': (p) => p.update('claims_copy', 'geo-a', w.ids.claimA, { 'Agent edition': 'x' }, { expect: { 'Agent remarks': PROTECTED_DB } }),
  };
  for (const [name, build] of Object.entries(spots)) {
    const plan = newP(w);
    build(plan);
    const problems = problemsOf(plan, w);
    assert.ok(mentions(problems, /mentions a protected id/), `${name}: ${problems.join('\n')}`);
  }
  const clean = newP(w);
  decision(clean, 'geo-1');
  assert.deepEqual(problemsOf(clean, w), []);

  const own = structuredClone(w.config);
  own.notion.databases.tag_decisions.database_id = PROTECTED_DB;
  assert.ok(mentions(checkPlan(clean, own, { root: w.root }).problems, /protected lists of config\.json/), 'an agent table that is protected is never written');
});

test('checkPlan: an update needs a page_id, a create must not have one, and the rest of the op shape', async () => {
  const w = await world();
  const noPage = { header: newP(w).header, ops: [{ op: 'update', table: 'tag_decisions', key: 'k', properties: { Tag: 'Context-dependent' } }] };
  assert.ok(mentions(checkPlan(noPage, w.config, { root: w.root }).problems, /an update needs the page_id/));
  const emptyPage = newP(w);
  emptyPage.update('tag_decisions', 'k', '', { Tag: 'Context-dependent' });
  assert.ok(mentions(problemsOf(emptyPage, w), /an update needs the page_id/));
  const withPage = newP(w);
  withPage.ops.push({ op: 'create', table: 'tag_decisions', key: 'k', page_id: 'p', properties: { Key: 'k' } });
  assert.ok(mentions(problemsOf(withPage, w), /a create must not carry a page_id/));
  const objectValue = newP(w);
  objectValue.create('tag_decisions', 'k', { Tag: { select: { name: 'x' } } });
  assert.ok(mentions(problemsOf(objectValue, w), /not a valid op line/), 'values are plain, not REST shapes');
  const children = newP(w);
  children.ops.push({ op: 'update', table: 'tag_decisions', key: 'k', page_id: 'p', properties: { Tag: 'x' }, children: [{ type: 'paragraph' }] });
  assert.ok(mentions(problemsOf(children, w), /children\) can only go with a create/));
  const notOp = newP(w);
  notOp.ops.push({ op: 'delete', table: 'tag_decisions', key: 'k', properties: {} });
  notOp.ops.push('x');
  const problems = problemsOf(notOp, w);
  assert.ok(mentions(problems, /op must be "create" or "update"/));
  assert.ok(mentions(problems, /expected an object/));
  assert.equal(checkPlan({ ops: 'x' }, w.config).ok, false);
  assert.equal(checkPlan(null, w.config).ok, false);
});

test('checkPlan: a create carries its key column, an update may not rename, and a key appears once per table', async () => {
  const w = await world();
  const noKey = newPlan({ runId: 'r', script: 's' }); // no config: the builder does not add the key column
  noKey.create('tag_decisions', 'geo-1::Context-dependent', { Claim: 'x' });
  noKey.create('rule_changes', 'L', { Lesson: 'a different title' });
  noKey.update('tag_decisions', 'geo-a::Context-dependent', w.ids.decision, { Key: 'geo-z::Context-dependent' });
  const problems = problemsOf(noKey, w);
  assert.ok(mentions(problems, /a create must carry its key column "Key"/), problems.join('\n'));
  assert.ok(mentions(problems, /a create must carry its key column "Lesson"/));
  assert.ok(mentions(problems, /an update may not rename a row/));

  const twice = newP(w);
  decision(twice, 'geo-1');
  decision(twice, 'geo-1');
  twice.update('tag_decisions', 'geo-1::Context-dependent', 'p', { 'Agent reason': 'x' });
  const dup = problemsOf(twice, w).filter((p) => /appears twice/.test(p));
  assert.equal(dup.length, 2, 'the second and the third op repeat the key');
  const acrossTables = newP(w);
  acrossTables.create('rule_changes', 'same', { Tag: 'Context-dependent' });
  acrossTables.create('rulebook', 'same', { 'When to use': 'x' });
  assert.ok(!mentions(problemsOf(acrossTables, w, { setup: true }), /appears twice/), 'the same key in two tables is fine');
});

test('checkPlan: the header must be there, valid, and agree with the ops', async () => {
  const w = await world();
  const plan = newP(w);
  decision(plan, 'geo-1');
  assert.ok(mentions(checkPlan({ ops: plan.ops }, w.config, { root: w.root }).problems, /no header line/));
  const wrongCounts = { header: { plan: { ...plan.header().plan, counts: { creates: 3, updates: 0 } } }, ops: plan.ops };
  assert.ok(mentions(checkPlan(wrongCounts, w.config, { root: w.root }).problems, /the counts say 3 creates/));
  const badDate = { header: { plan: { ...plan.header().plan, created_at: 'yesterday' } }, ops: plan.ops };
  assert.ok(mentions(checkPlan(badDate, w.config, { root: w.root }).problems, /header: .*created_at/));
});

// ---- compareWritten ---------------------------------------------------------------------------------------------------------------------

test('compareWritten: text after normaliseText, numbers to two decimals, selects, checkbox, url and the start of a date', async () => {
  const schema = {
    properties: {
      T: { type: 'title' }, R: { type: 'rich_text' }, N: { type: 'number' }, S: { type: 'select' }, M: { type: 'multi_select' }, C: { type: 'checkbox' }, U: { type: 'url' }, D: { type: 'date' },
    },
  };
  const same = compareWritten(
    { T: 'a', R: 'line one\r\nline two', N: 0.8333333, S: 'Applies', M: ['a', 'b'], C: true, U: 'https://example.com', D: '2026-10-15', 'D:end': '2026-10-16' },
    { T: 'a', R: 'line one\nline two', N: 0.83, S: 'Applies', M: ['b', 'a'], C: true, U: 'https://example.com', D: '2026-10-15' },
    schema,
  );
  assert.deepEqual(same, []);
  const empty = compareWritten({ R: '', S: null, U: null, N: null }, { R: '', S: null, U: null, N: null }, schema);
  assert.deepEqual(empty, []);
  const diff = compareWritten(
    { T: 'a', R: 'x', N: 0.83, S: 'Applies', M: ['a'], C: true, U: 'https://example.com', D: '2026-10-15', Missing: 'x' },
    { T: 'b', R: 'y', N: 0.84, S: 'Does not apply', M: ['a', 'c'], C: false, U: null, D: '2026-10-16' },
    schema,
  );
  assert.deepEqual(diff.map((d) => d.column), ['T', 'R', 'N', 'S', 'M', 'C', 'U', 'D', 'Missing']);
  assert.equal(diff[0].wrote, 'a');
  assert.equal(diff[0].found, 'b');
});

// ---- applyPlan ---------------------------------------------------------------------------------------------------------------------------

test('applyPlan sends the ops in order, ledgers each one, reads every page back, and returns the created pages by key', async () => {
  const w = await world();
  const plan = newP(w);
  decision(plan, 'geo-1', { 'Agent confidence': 0.8333333 });
  plan.update('claims_copy', 'geo-a', w.ids.claimA, { 'Agent edition': 'Context-dependent', 'Agent remarks': 'Context-dependent\n1 waits for an editor · edition 2026-10-16.1' });
  plan.create('rule_changes', 'Hedged claims are not context-dependent', { Tag: 'Context-dependent', Rule: 'Context-dependent rule 2', Kind: 'Clarify wording', 'Current text': 'old', 'Proposed text': 'new', Status: 'Proposed' }, { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'the supporting claims' } }] } }] });
  plan.update('tag_decisions', 'geo-a::Context-dependent', w.ids.decision, { 'Agent proposal': 'Applies', 'Agent confidence': 0.91 });
  const requestsBefore = w.notion.requests.length;
  const lines = [];
  const result = await apply(w, plan, { log: (l) => lines.push(l) });

  assert.equal(result.code, EXIT.OK);
  assert.equal(result.ok, true);
  assert.deepEqual([result.done, result.failed, result.skipped, result.mismatches, result.uncertain, result.pending], [4, 0, 0, 0, 0, 0]);
  assert.deepEqual(Object.keys(result.created).sort(), ['Hedged claims are not context-dependent', 'geo-1::Context-dependent']);
  assert.deepEqual(Object.keys(result.created_by_table).sort(), ['rule_changes', 'tag_decisions']);
  assert.equal(w.notion.page(result.created['geo-1::Context-dependent']).properties.Claim.title[0].plain_text, 'Claim geo-1');

  // the requests: write, read-back, write, read-back, ... in plan order
  const sent = w.notion.requests.slice(requestsBefore).map((r) => `${r.method} ${r.path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')}`);
  assert.deepEqual(sent, ['POST /pages', 'GET /pages/<id>', 'PATCH /pages/<id>', 'GET /pages/<id>', 'POST /pages', 'GET /pages/<id>', 'PATCH /pages/<id>', 'GET /pages/<id>']);
  const creates = w.notion.writes().filter((r) => r.method === 'POST');
  assert.equal(creates[0].body.parent.database_id, DB.tag_decisions);
  assert.equal(creates[1].body.parent.database_id, DB.rule_changes);
  assert.equal(creates[1].body.children.length, 1, 'the page content goes with the create');
  assert.equal(creates[0].body.properties['Agent confidence'].number, 0.8333333);

  // the ledger: one line per op, with the fields of the contract
  const ledger = jsonl(join(w.dir, 'ledger.jsonl'));
  assert.equal(ledger.length, 4);
  assert.deepEqual(ledger.map((l) => l.op_index), [0, 1, 2, 3]);
  for (const l of ledger) {
    for (const field of ['op_index', 'key', 'page_id', 'status', 'read_back', 'error', 'at']) assert.ok(field in l, field);
    assert.equal(l.status, 'done');
    assert.equal(l.read_back, 'ok');
    assert.equal(l.error, null);
    assert.equal(l.at, '2026-10-15T10:00:00.000Z');
  }
  assert.equal(ledger[0].sent, 'create');
  assert.equal(ledger[1].page_id, w.ids.claimA);
  assert.equal(ledger[1].sent, 'update');
  assert.equal(ledger[0].page_id, result.created['geo-1::Context-dependent']);
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^apply 1\/4 create tag_decisions "geo-1::Context-dependent": done \(read-back ok\)$/);
  assert.ok(existsSync(join(w.dir, 'plan.jsonl')), 'the plan file was written for the record');
  assert.equal(readLedger(w.dir).size, 4);
});

test('applyPlan refuses what checkPlan refuses, before any request, and an editor column never reaches the wire', async () => {
  const w = await world();
  const plan = newP(w);
  decision(plan, 'geo-1');
  plan.update('claims_copy', 'geo-a', w.ids.claimA, { 'Review status': 'Reviewed' });
  const before = w.notion.requests.length;
  await assert.rejects(() => apply(w, plan), (e) => e instanceof PlanError && /refused/.test(e.message) && e.problems.some((p) => /only an editor writes/.test(p)));
  const protectedPlan = newP(w);
  decision(protectedPlan, 'geo-3', { 'Agent reason': `see ${PROTECTED_PAGE}` });
  await assert.rejects(() => apply(w, protectedPlan), (e) => e instanceof PlanError && e.problems.some((p) => /protected id/.test(p)));
  assert.equal(w.notion.requests.length, before, 'no request of any kind was made');
  assert.equal(existsSync(join(w.dir, 'ledger.jsonl')), false);
  await assert.rejects(() => applyPlan({ plan, dir: w.dir, client: null, config: w.config, schemas: w.schemas }), /client is required/);
});

test('applyPlan encodes every value with the table\'s schema before the first request, so a bad plan sends nothing', async () => {
  const w = await world();
  const plan = newP(w);
  decision(plan, 'geo-1');
  plan.update('claims_copy', 'geo-a', w.ids.claimA, { 'Agent edition': 'x' });
  const schemas = structuredClone(w.schemas);
  delete schemas.claims_copy.properties['Agent edition']; // the column is not there (setup has not added it)
  const before = w.notion.writes().length;
  await assert.rejects(() => apply(w, plan, { schemas }), (e) => e instanceof PlanError && e.problems.some((p) => /op 2 .*unknown property "Agent edition"/.test(p)));
  assert.equal(w.notion.writes().length, before);
  const wrongType = newP(w);
  wrongType.create('tag_decisions', 'geo-5::Context-dependent', { Claim: 'x', 'Agent confidence': 'high' });
  await assert.rejects(() => apply(w, wrongType), (e) => e instanceof PlanError && e.problems.some((p) => /Agent confidence/.test(p)));
  const placeholder = structuredClone(w.config);
  placeholder.notion.databases.rule_changes.database_id = '<setup>';
  const lesson = newP(w);
  lesson.create('rule_changes', 'L', { Tag: 'Context-dependent' });
  await assert.rejects(() => apply(w, lesson, { config: placeholder }), (e) => e instanceof PlanError && e.problems.some((p) => /rule_changes: config\.json has no database id/.test(p)));
  await assert.rejects(() => apply(w, lesson, { schemas: {} }), (e) => e instanceof PlanError && e.problems.some((p) => /no schema was given/.test(p)));
});

test('the agent\'s seven columns of a claim are all writable, the two relations take page ids of the Rulebook copy, and Agent notes is no column the agent may write', async () => {
  const w = await world();
  const tag = w.notion.addRow(DB.rulebook, { Name: 'Context-dependent', 'Work tags': ['Issue'] });
  const plan = newP(w);
  plan.update('claims_copy', 'geo-a', w.ids.claimA, {
    'Agent tags': [tag], 'Agent confidence': 0.83, 'Agent reasons': 'Context-dependent: A pronoun has no antecedent.', 'Agent status': 'Waits for you', 'Tags waiting': [tag],
    'Agent edition': EDITION, 'Agent remarks': 'not checked: 5 tags without rules',
  });
  assert.deepEqual(problemsOf(plan, w), []);
  const result = await apply(w, plan);
  assert.equal(result.code, EXIT.OK, JSON.stringify(result.lists));
  const row = w.notion.plainRows(DB.claims_copy).find((r) => r['Geo ID'] === 'geo-a');
  assert.deepEqual([row['Agent tags'], row['Tags waiting'], row['Agent status'], row['Agent edition'], row['Agent remarks']], [[tag], [tag], 'Waits for you', EDITION, 'not checked: 5 tags without rules']);
  const again = newP(w);
  again.update('claims_copy', 'geo-a', w.ids.claimA, { 'Agent tags': [], 'Tags waiting': [], 'Agent status': 'Done', 'Agent remarks': '' });
  assert.equal((await apply(w, again, { dir: join(tmp(), 'run-2') })).code, EXIT.OK, 'a relation is cleared with an empty list');
  const cleared = w.notion.plainRows(DB.claims_copy).find((r) => r['Geo ID'] === 'geo-a');
  assert.deepEqual([cleared['Agent tags'], cleared['Tags waiting'], cleared['Agent status']], [[], [], 'Done']);

  const notes = newP(w);
  notes.update('claims_copy', 'geo-a', w.ids.claimA, { 'Agent notes': 'no tags' });
  assert.ok(mentions(problemsOf(notes, w), /"Agent notes" is not a column this plan may write to claims_copy/), 'retired with the revision of 21 October');
  const setup = newP(w);
  setup.create('claims_copy', 'geo-9', { 'Geo Name': 'A claim', 'Agent notes (old)': 'x' });
  assert.ok(mentions(problemsOf(setup, w, { setup: true }), /"Agent notes \(old\)" is not a column this plan may write/), 'the two "(old)" columns are never written either');
});

test('applyPlan skips an update whose expect no longer holds, and an update whose row is not in the pull; an update that holds is sent', async () => {
  const w = await world();
  const decided = w.notion.addRow(DB.tag_decisions, { Claim: 'Claim B', Key: 'geo-b::Context-dependent', Tag: 'Context-dependent', 'Tag outcome': 'Applies' });
  const open = w.ids.decision;
  const plan = newP(w);
  plan.update('tag_decisions', 'geo-b::Context-dependent', decided, { 'Agent proposal': 'Applies' }, { expect: { 'Tag outcome': null } });
  plan.update('tag_decisions', 'geo-a::Context-dependent', open, { 'Agent proposal': 'Applies' }, { expect: { 'Tag outcome': null, 'Agent proposal': 'Can\'t tell' } });
  plan.update('tag_decisions', 'geo-zzz::Context-dependent', open, { 'Agent reason': 'x' }, { expect: { 'Tag outcome': null } });
  plan.update('claims_copy', 'geo-a', w.ids.claimA, { 'Agent edition': 'x' }, { expect: {} });
  const result = await apply(w, plan, { pulled: pullFrom(w) });
  assert.deepEqual([result.done, result.skipped, result.failed], [2, 2, 0]);
  assert.equal(result.code, EXIT.OK, 'a skip is not a problem');
  const ledger = jsonl(join(w.dir, 'ledger.jsonl'));
  assert.equal(ledger[0].status, 'skipped');
  assert.match(ledger[0].error, /^skipped: expect \("Tag outcome" is no longer what the plan expected\)/);
  assert.equal(ledger[0].read_back, null);
  assert.equal(ledger[1].status, 'done');
  assert.equal(ledger[2].status, 'skipped');
  assert.match(ledger[2].error, /^skipped: expect \(the row is not in the pull\)/);
  assert.equal(ledger[3].status, 'done', 'an empty expect expects nothing');
  assert.equal(w.notion.page(decided).properties['Agent proposal'].select, null, 'the decided row was not touched');
  assert.equal(w.notion.writes().filter((r) => r.method === 'PATCH').length, 2, 'only two PATCH requests were made');
  assert.deepEqual(result.lists.skipped.map((s) => s.key), ['geo-b::Context-dependent', 'geo-zzz::Context-dependent']);
});

test('applyPlan never sends a create for a key that is already in the pull', async () => {
  const w = await world();
  const plan = newP(w);
  decision(plan, 'geo-a'); // geo-a::Context-dependent exists
  decision(plan, 'geo-new');
  const result = await apply(w, plan, { pulled: pullFrom(w) });
  assert.deepEqual([result.done, result.skipped], [1, 1]);
  const ledger = jsonl(join(w.dir, 'ledger.jsonl'));
  assert.equal(ledger[0].status, 'skipped');
  assert.match(ledger[0].error, /^skipped: exists/);
  assert.equal(ledger[0].page_id, w.ids.decision);
  assert.equal(w.notion.rows(DB.tag_decisions).length, 2, 'one existing row and one new row, no duplicate');
  assert.equal(w.notion.writes().filter((r) => r.method === 'POST').length, 1);
});

test('applyPlan reports a read-back mismatch, counts it, ends with code 2, and does not write the page again on the next run', async () => {
  const w = await world();
  // Notion keeps the first 12 characters only: a stand-in for anything that changes a value after the write
  const truncating = clientOver(w.notion, async (url, init) => {
    const res = await w.notion.fetchImpl(url, init);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (res.ok && (method === 'PATCH' || (method === 'POST' && new URL(url).pathname.endsWith('/pages')))) {
      const page = await res.clone().json();
      const reason = page.properties['Agent reason']?.rich_text?.map((x) => x.plain_text).join('') ?? '';
      if (reason.length > 12) w.notion.editRow(page.id, { 'Agent reason': reason.slice(0, 12) });
    }
    return res;
  });
  const plan = newP(w);
  decision(plan, 'geo-1', { 'Agent reason': 'a reason that is long enough' });
  decision(plan, 'geo-2', { 'Agent reason': 'short' });
  const result = await apply(w, plan, { client: truncating });
  assert.equal(result.code, EXIT.INVALID);
  assert.equal(result.ok, false);
  assert.deepEqual([result.done, result.mismatches, result.failed], [2, 1, 0]);
  assert.equal(result.lists.mismatches[0].key, 'geo-1::Context-dependent');
  assert.match(result.lists.mismatches[0].detail, /^read-back mismatch: "Agent reason" wrote "a reason that is long enough", found "a reason tha"$/);
  const ledger = jsonl(join(w.dir, 'ledger.jsonl'));
  assert.deepEqual(ledger.map((l) => l.read_back), ['mismatch', 'ok']);
  assert.equal(ledger[0].status, 'done', 'the write was sent');

  const writes = w.notion.writes().length;
  const again = await apply(w, readPlan(w.dir));
  assert.equal(w.notion.writes().length, writes, 'nothing is written again');
  assert.equal(again.mismatches, 1, 'looked at again, still different');
  assert.equal(again.already_done, 1);
  assert.equal(jsonl(join(w.dir, 'ledger.jsonl')).length, 3, 'one more ledger line for the second look');
});

test('applyPlan: a read-back that cannot run is "unchecked", exit 1, and the next run looks again without writing', async () => {
  const w = await world();
  const plan = newP(w);
  decision(plan, 'geo-1');
  w.notion.failNext('GET', /^\/pages\//, 404, 1, { code: 'object_not_found', message: 'gone' });
  const result = await apply(w, plan);
  assert.equal(result.code, EXIT.ERROR);
  assert.deepEqual([result.done, result.unchecked, result.mismatches], [1, 1, 0]);
  assert.equal(jsonl(join(w.dir, 'ledger.jsonl'))[0].read_back, 'unchecked');
  assert.equal(Object.keys(result.created).length, 1, 'the page is known and will not be created again');
  const again = await apply(w, readPlan(w.dir));
  assert.equal(again.code, EXIT.OK);
  assert.equal(again.unchecked, 0);
  assert.equal(w.notion.writes().filter((r) => r.method === 'POST').length, 1, 'still one create');
  assert.equal(w.notion.rows(DB.tag_decisions).length, 2);
});

test('applyPlan resumes: done ops are not sent again, a failed op is sent again, the ledger grows', async () => {
  const w = await world();
  const plan = newP(w);
  decision(plan, 'geo-1');
  decision(plan, 'geo-2');
  plan.update('claims_copy', 'geo-a', w.ids.claimA, { 'Agent edition': 'Context-dependent' });
  plan.update('claims_copy', 'geo-b', w.ids.claimB, { 'Agent edition': '' });
  w.notion.failNext('PATCH', /^\/pages\//, 400, 1, { code: 'validation_error', message: 'not accepted' });
  const first = await apply(w, plan);
  assert.equal(first.code, EXIT.ERROR);
  assert.deepEqual([first.done, first.failed], [3, 1]);
  assert.equal(first.lists.failed[0].key, 'geo-a');
  assert.match(first.lists.failed[0].detail, /not accepted/);
  const writesAfterFirst = w.notion.writes().length;
  assert.equal(writesAfterFirst, 4, '2 creates, the PATCH that failed and the PATCH that worked');

  const second = await apply(w, readPlan(w.dir));
  assert.equal(second.code, EXIT.OK);
  assert.deepEqual([second.done, second.failed, second.already_done], [4, 0, 3]);
  assert.equal(w.notion.writes().length, writesAfterFirst + 1, 'only the failed op was sent again');
  assert.equal(w.notion.rows(DB.tag_decisions).length, 3, 'no create was repeated');
  assert.equal(w.notion.page(w.ids.claimA).properties['Agent edition'].rich_text[0].plain_text, 'Context-dependent');
  const ledger = jsonl(join(w.dir, 'ledger.jsonl'));
  assert.deepEqual(ledger.map((l) => `${l.op_index}:${l.status}`), ['0:done', '1:done', '2:failed', '3:done', '2:done']);
});

test('applyPlan stops at a create_uncertain with status "uncertain", and the next run finishes it by its key when the row landed', async () => {
  const w = await world({ rows: false });
  const plan = newP(w);
  decision(plan, 'geo-1');
  decision(plan, 'geo-2'); // the answer to this create is lost although the page landed
  decision(plan, 'geo-3');
  // armed once the first op is in the ledger, so that it is the second create whose answer is lost
  let armed = false;
  const first = await apply(w, plan, {
    log: (line) => {
      if (!armed && /^apply 1\/3 /.test(line)) {
        armed = true;
        w.notion.failNext('POST', /^\/pages$/, 500, 1, { applied: true });
      }
    },
  });
  assert.equal(first.code, EXIT.ERROR);
  assert.deepEqual([first.done, first.uncertain, first.pending], [1, 1, 1]);
  assert.deepEqual(first.stopped, { op_index: 1, key: 'geo-2::Context-dependent', reason: 'create_uncertain' });
  const ledger = jsonl(join(w.dir, 'ledger.jsonl'));
  assert.deepEqual(ledger.map((l) => l.status), ['done', 'uncertain']);
  assert.equal(ledger[1].page_id, null);
  assert.match(ledger[1].error, /may exist in Notion already/);
  assert.equal(w.notion.rows(DB.tag_decisions).length, 2, 'the lost create did land');
  const posts = w.notion.writes().filter((r) => r.method === 'POST').length;
  assert.equal(posts, 2, 'the client did not send the lost create a second time');

  // without a fresh pull of the table the next run refuses to guess
  await assert.rejects(() => apply(w, readPlan(w.dir)), (e) => e instanceof PlanError && /pull tag_decisions/.test(e.message));
  assert.equal(w.notion.writes().filter((r) => r.method === 'POST').length, posts);

  // with it, the row is found by its key and finished as an update; the op after it is created
  const second = await apply(w, readPlan(w.dir), { pulled: pullFrom(w) });
  assert.equal(second.code, EXIT.OK);
  assert.deepEqual([second.done, second.uncertain, second.pending], [3, 0, 0]);
  assert.equal(w.notion.rows(DB.tag_decisions).length, 3, 'three rows, no duplicate of geo-2');
  assert.equal(w.notion.writes().filter((r) => r.method === 'POST').length, posts + 1, 'only geo-3 was created');
  const final = jsonl(join(w.dir, 'ledger.jsonl')).filter((l) => l.op_index === 1).at(-1);
  assert.equal(final.status, 'done');
  assert.equal(final.read_back, 'ok');
  assert.ok(final.page_id);
  assert.equal(second.created['geo-2::Context-dependent'], final.page_id, 'the page created by the lost call is reported as created');
});

test('applyPlan: a lost create that did not land is created again on the next run, once', async () => {
  const w = await world({ rows: false });
  const plan = newP(w);
  decision(plan, 'geo-1');
  decision(plan, 'geo-2');
  w.notion.failNext('POST', /^\/pages$/, 503, 1); // refused before processing: the first create does not land
  const first = await apply(w, plan);
  assert.deepEqual([first.uncertain, first.done, first.pending], [1, 0, 1]);
  assert.equal(w.notion.rows(DB.tag_decisions).length, 0);
  const second = await apply(w, readPlan(w.dir), { pulled: pullFrom(w) });
  assert.equal(second.code, EXIT.OK);
  assert.equal(second.done, 2);
  assert.equal(w.notion.rows(DB.tag_decisions).length, 2);
  assert.deepEqual(jsonl(join(w.dir, 'ledger.jsonl')).map((l) => `${l.op_index}:${l.status}`), ['0:uncertain', '0:done', '1:done']);
});

test('applyPlan stops at once when Notion refuses the token, and after failures in a row', async () => {
  const w = await world();
  const plan = newP(w);
  decision(plan, 'geo-1');
  decision(plan, 'geo-2');
  w.notion.failNext('POST', /^\/pages$/, 401, 1, { code: 'unauthorized', message: 'API token is invalid.' });
  const refused = await apply(w, plan);
  assert.equal(refused.code, EXIT.ERROR);
  assert.deepEqual(refused.stopped, { op_index: 0, key: 'geo-1::Context-dependent', reason: 'notion_refused' });
  assert.deepEqual([refused.failed, refused.pending], [1, 1]);

  const w2 = await world();
  const many = newP(w2);
  assert.equal(MAX_CONSECUTIVE_FAILURES, 3);
  many.update('claims_copy', 'geo-a', w2.ids.claimA, { 'Agent edition': 't0' });
  many.update('claims_copy', 'geo-b', w2.ids.claimB, { 'Agent edition': 't1' });
  many.update('tag_decisions', 'geo-a::Context-dependent', w2.ids.decision, { 'Agent reason': 't2' });
  decision(many, 'geo-late');
  w2.notion.failNext('PATCH', /^\/pages\//, 400, 99, { code: 'validation_error', message: 'not accepted' });
  const stopped = await apply(w2, many);
  assert.equal(stopped.stopped.reason, 'failures_in_a_row');
  assert.deepEqual([stopped.failed, stopped.pending], [3, 1]);
  assert.equal(stopped.code, EXIT.ERROR);
});

test('applyPlan refuses a ledger that belongs to another plan and a plan file that is not the plan being applied', async () => {
  const w = await world();
  const plan = newP(w);
  decision(plan, 'geo-1');
  await apply(w, plan);
  const other = newP(w);
  decision(other, 'geo-2');
  await assert.rejects(() => apply(w, other), (e) => e instanceof PlanError && /not the plan being applied/.test(e.message));

  // a ledger from another plan under the same op indexes
  const w2 = await world();
  const p2 = newP(w2);
  decision(p2, 'geo-1');
  mkdirSync(w2.dir, { recursive: true });
  p2.write(w2.dir);
  writeFileSync(join(w2.dir, 'ledger.jsonl'), `${JSON.stringify({ op_index: 0, table: 'tag_decisions', op: 'create', key: 'someone-else::Context-dependent', page_id: 'x', status: 'done', read_back: 'ok' })}\n`);
  await assert.rejects(() => apply(w2, readPlan(w2.dir)), (e) => e instanceof PlanError && /does not belong to this plan/.test(e.message));
});

test('applyPlan with setup writes the audit seed (the four editor columns of a claim) once, and refuses the same plan without setup', async () => {
  const w = await world();
  const tag = w.notion.addRow(DB.rulebook, { Name: 'Context-dependent', 'When to use': '1. x' });
  const plan = newP(w);
  plan.update('claims_copy', 'geo-a', w.ids.claimA, {
    'Verified tags': [tag], 'Review status': 'Reviewed', 'Why wrong': 'Agent slip', 'Challenged tags notes': `${AUDIT_PREFIX}: the claim makes sense on its own.`, 'Agent confidence': 0.83,
  });
  const before = w.notion.requests.length;
  await assert.rejects(() => apply(w, plan), (e) => e instanceof PlanError && e.problems.some((p) => /only an editor writes/.test(p)));
  assert.equal(w.notion.requests.length, before, 'refused before any request');
  const result = await apply(w, plan, { setup: true });
  assert.equal(result.code, EXIT.OK, JSON.stringify(result.lists));
  const page = w.notion.page(w.ids.claimA);
  assert.equal(page.properties['Review status'].select.name, 'Reviewed');
  assert.deepEqual(page.properties['Verified tags'].relation.map((r) => r.id), [tag]);
  assert.equal(page.properties['Challenged tags notes'].rich_text[0].plain_text.startsWith(AUDIT_PREFIX), true);
  assert.equal(page.properties['Agent confidence'].number, 0.83);
});

test('applyPlan creates the setup rows of the rulebook, the claims copy and the settings through a setup plan, with every value read back', async () => {
  const w = await world({ rows: false });
  const plan = newP(w, { rubricEdition: null });
  plan.create('rulebook', 'Context-dependent', { Category: 'Quality', Polarity: 'Issue', Status: 'Verified', 'Verified on': '2026-09-10', 'Work tags': ['Pipeline benchmark check', 'Issue'], 'When to use': '1. A pronoun with no antecedent.\n2. A definite article with no referent.', Evidence: 'https://example.com/report' });
  plan.create('claims_copy', 'geo-1', { 'Geo Name': 'A claim', 'Geo URL': 'https://www.geobrowser.io/space/s/geo-1', 'Geo Sources': 'Source one\nSource two', 'Geo Tags': ['Debate', 'Politics'], 'Geo Score': 4.5, 'Geo Is factual': true, 'Agent edition': '', 'Agent remarks': '' });
  plan.create('agent_settings', 'claim-tagger-mvp', { 'Rulebook edition': EDITION, 'Last run summary': 'Setup · 15 Oct 11:20' });
  const result = await apply(w, plan, { setup: true });
  assert.equal(result.code, EXIT.OK, JSON.stringify(result.lists));
  assert.equal(result.done, 3);
  assert.equal(w.notion.page(result.created['Context-dependent']).properties['Work tags'].multi_select.length, 2);
  assert.equal(w.notion.page(result.created['geo-1']).properties['Geo Score'].number, 4.5);
});
