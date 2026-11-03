import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { EXIT } from '../../agents/claim-tagger-mvp/scripts/lib/exit-codes.mjs';
import { applyStep } from '../../agents/claim-tagger-mvp/scripts/lib/loop.mjs';
import { createClient } from '../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';
import { codeRoot } from '../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';
import {
  MAX_CONSECUTIVE_FAILURES, PlanError, applyPlan, checkPlan, firstPageIds, newPlan, readLedger, readPlan,
} from '../../agents/claim-tagger-mvp/scripts/lib/plan.mjs';
import { createFakeNotion } from './fixtures/fake-notion.mjs';
import { builtConfig } from './helpers/config-fixture.mjs';
import { TABLE_SPECS, restProps } from './helpers/tables.mjs';

// The plan op "trash" (decision P51): where it is allowed, where it is refused (by checkPlan and again by applyPlan, before any request), and what applyPlan does with it: the pull must hold the
// page, a row of Tag decisions that a person decided is not trashed, every page is read back as trashed, and every step is in the ledger so that a stopped run goes on without sending a done step again.
// The tests run on the in-memory Notion (fixtures/fake-notion.mjs, allowTrash) behind the real REST client.

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-trash-'));
  dirs.push(d);
  return d;
};

const DB = {
  rulebook: 'b1000000000000000000000000000001',
  claims: 'b1000000000000000000000000000002',
  tag_decisions: 'b1000000000000000000000000000003',
  rule_changes: 'b1000000000000000000000000000004',
  agent_settings: 'b1000000000000000000000000000005',
};
const PROTECTED_DB = '7219756338b2416f8fa8af83d75ec47d'; // the real claims table, first protected source
const PROTECTED_PAGE = '3da273e214eb80c180d5fd0894bc2db8';
const EDITION = '2026-10-16.1';
const NOW = () => new Date('2026-10-15T10:00:00.000Z');
const FIRST_PAGE = JSON.parse(readFileSync(join(codeRoot(), 'setup', 'first-page.json'), 'utf8'));
const GEO = ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa02', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa03'];

const clientOver = (notion, fetchImpl = notion.fetchImpl) => createClient({ token: notion.token, fetchImpl, requestsPerSecond: 1000, sleep: async () => {} });

/** A config whose five tables have ids, a Notion with the five tables (allowTrash), three claims with a Tag decisions row each, a client and the schemas the client reads. */
async function world({ relation = false } = {}) {
  const config = builtConfig();
  config.notion.requests_per_second = 1000;
  const set = (entry, table, n) => {
    entry.database_id = DB[table];
    entry.data_source_id = `c100000000000000000000000000000${n}`;
  };
  set(config.notion.rulebook, 'rulebook', 1);
  set(config.notion.claims, 'claims', 2);
  set(config.notion.databases.tag_decisions, 'tag_decisions', 3);
  set(config.notion.databases.rule_changes, 'rule_changes', 4);
  set(config.notion.databases.agent_settings, 'agent_settings', 5);
  const notion = createFakeNotion({ allowTrash: true });
  // with `relation` the Claims table has the column "Tag decisions", which lists the rows of the claim (STRUCTURE-V2.md); it points at the Rulebook here, as the other relations of these tables do
  const specs = relation ? { ...TABLE_SPECS, claims: { ...TABLE_SPECS.claims, 'Tag decisions': { type: 'relation' } } } : TABLE_SPECS;
  for (const [table, spec] of Object.entries(specs)) {
    notion.addDatabase({ id: DB[table], title: table, properties: restProps(spec, table === 'rulebook' ? null : notion.dataSource(DB.rulebook).id) });
  }
  const client = clientOver(notion);
  const schemas = {};
  for (const table of Object.keys(TABLE_SPECS)) schemas[table] = await client.retrieveDatabase(DB[table]);
  const ids = { claim: {}, decision: {} };
  for (const [i, geo] of GEO.entries()) {
    ids.claim[geo] = notion.addRow(DB.claims, { 'Geo Name': `Claim ${i + 1}`, 'Geo ID': geo, 'Geo Is factual': false });
    ids.decision[geo] = notion.addRow(DB.tag_decisions, { Claim: `Claim ${i + 1}`, Key: `${geo}::Context-dependent`, Tag: 'Context-dependent', 'Agent proposal': 'Applies' });
    if (relation) notion.editRow(ids.claim[geo], { 'Tag decisions': [ids.decision[geo]] });
  }
  const root = tmp();
  return { config, notion, client, schemas, ids, root, dir: join(tmp(), 'run-1') };
}

/** What pull.mjs hands to applyPlan: pulled[table][key] = the plain row by Notion column names, plus page_id. */
function pullFrom(w, tables = ['claims', 'tag_decisions']) {
  const keyOf = { claims: 'Geo ID', tag_decisions: 'Key' };
  return Object.fromEntries(tables.map((table) => [table, Object.fromEntries(w.notion.plainRows(DB[table]).map((row) => [row[keyOf[table]], row]))]));
}

/** A plan of the remove script that trashes the Tag decisions row and the claim of each Geo ID (rows first). */
function removePlan(w, geos = GEO, extra = {}) {
  const plan = newPlan({ runId: 'run-1', script: 'remove', rubricEdition: EDITION, config: w.config, now: NOW, ...extra });
  for (const geo of geos) plan.trash('tag_decisions', `${geo}::Context-dependent`, w.ids.decision[geo]);
  for (const geo of geos) plan.trash('claims', geo, w.ids.claim[geo]);
  return plan;
}

const apply = (w, plan, extra = {}) => applyPlan({
  plan, dir: w.dir, client: w.client, config: w.config, schemas: w.schemas, pulled: pullFrom(w), root: w.root, now: NOW, ...extra,
});
const problemsOf = (plan, w, opts = {}) => checkPlan(plan, w.config, { root: w.root, ...opts }).problems;
const mentions = (problems, re) => problems.some((p) => re.test(p));
const patches = (w) => w.notion.requests.filter((r) => r.method === 'PATCH');

// ---- where a trash op is allowed ---------------------------------------------------------------------------------------------------------

test('checkPlan allows a trash op in a plan of the remove script, on claims and tag_decisions, and the header counts the trashes', async () => {
  const w = await world();
  const plan = removePlan(w);
  assert.deepEqual(plan.header().plan.counts, { creates: 0, updates: 0, trashes: 6 });
  assert.equal(plan.ops[0].op, 'trash');
  assert.deepEqual(Object.keys(plan.ops[0]).sort(), ['key', 'op', 'page_id', 'table'], 'a trash op carries no properties');
  assert.deepEqual(checkPlan(plan, w.config, { root: w.root }), { ok: true, problems: [], counts: { creates: 0, updates: 0, trashes: 6 } });
  const file = plan.write(w.dir);
  const read = readPlan(w.dir);
  assert.equal(file, join(w.dir, 'plan.jsonl'));
  assert.deepEqual(read.ops, plan.ops);
  assert.deepEqual(read.header.plan.counts.trashes, 6);
  assert.equal(checkPlan(read, w.config, { root: w.root }).ok, true);
  // a plan with no trash keeps the header it always had
  const none = newPlan({ runId: 'r', script: 'remove', config: w.config, now: NOW });
  assert.deepEqual(none.header().plan.counts, { creates: 0, updates: 0 });
});

test('checkPlan refuses a trash op from every other script, with setup or without', async () => {
  const w = await world();
  for (const script of ['test', 'add', 'copy-live', 'propose', 'distill', 'promote', 'setup', 'status', 'removes', 'Remove']) {
    const plan = removePlan(w, GEO.slice(0, 1), { script });
    for (const setup of [false, true]) {
      const problems = problemsOf(plan, w, { setup });
      assert.ok(mentions(problems, /a trash op is only allowed in a plan of the remove script/), `${script} setup ${setup}: ${problems.join(' | ')}`);
    }
  }
});

test('checkPlan refuses a trash op on any other table than claims and tag_decisions', async () => {
  const w = await world();
  for (const table of ['rule_changes', 'agent_settings', 'rulebook']) {
    const plan = newPlan({ runId: 'run-1', script: 'remove', config: w.config, now: NOW });
    plan.trash(table, 'some key', '0a9e0000-0000-4000-8000-0000000000ff');
    const problems = problemsOf(plan, w);
    assert.ok(mentions(problems, /only rows of claims and tag_decisions can be trashed/), `${table}: ${problems.join(' | ')}`);
  }
  const unknown = newPlan({ runId: 'run-1', script: 'remove', config: w.config, now: NOW });
  unknown.trash('runs', 'k', '0a9e0000-0000-4000-8000-0000000000ff');
  assert.ok(mentions(problemsOf(unknown, w), /is not one of this agent's tables/));
});

test('checkPlan refuses a trash op on a protected id, an id of the first page, a table or page of the agent, and what is not a page id', async () => {
  const w = await world();
  const refused = (id, re, label) => {
    const plan = newPlan({ runId: 'run-1', script: 'remove', config: w.config, now: NOW });
    plan.trash('claims', 'geo-x', id);
    const problems = problemsOf(plan, w);
    assert.ok(mentions(problems, re), `${label}: ${problems.join(' | ')}`);
  };
  refused(PROTECTED_PAGE, /protected lists of config\.json, so it is never trashed/, 'a protected page');
  refused(PROTECTED_PAGE.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5').toUpperCase(), /protected lists/, 'a protected page with dashes and capitals');
  refused(PROTECTED_DB, /protected lists/, 'a protected table');
  for (const [table, entry] of Object.entries(FIRST_PAGE.tables)) {
    refused(entry.database_id, /belongs to the first page/, `first page ${table} database`);
    refused(entry.data_source_id, /belongs to the first page/, `first page ${table} data source`);
  }
  refused(DB.claims, /a table or a page of the agent, not a row/, 'the Claims table of the agent');
  refused(w.config.notion.claims.data_source_id, /a table or a page of the agent, not a row/, 'the Claims data source of the agent');
  refused(w.config.notion.parent_page_id, /a table or a page of the agent, not a row/, 'the parent page');
  refused('not-an-id', /page_id is not a Notion page id/, 'text');
  refused('abc', /page_id is not a Notion page id/, 'a short id');
  // the protected table of a claims entry is a protected table
  const protectedTable = structuredClone(w.config);
  protectedTable.notion.protected_database_ids.push(DB.tag_decisions);
  const plan = removePlan(w, GEO.slice(0, 1));
  assert.ok(mentions(checkPlan(plan, protectedTable, { root: w.root }).problems, /this table is in the protected lists of config\.json, so it is never written/));
  // firstPageIds is what the check reads
  const ids = firstPageIds(w.root);
  assert.equal(ids.size, 10);
  assert.ok(ids.has(FIRST_PAGE.tables.claims.database_id));
});

test('checkPlan: a plan of the remove script holds trash ops and nothing else, a trash op holds no values, and the profile must be v2', async () => {
  const w = await world();
  const mixed = newPlan({ runId: 'run-1', script: 'remove', config: w.config, now: NOW });
  mixed.update('claims', GEO[0], w.ids.claim[GEO[0]], { 'Agent edition': EDITION });
  mixed.create('tag_decisions', 'new::Context-dependent', { Tag: 'Context-dependent' });
  const mixedProblems = problemsOf(mixed, w);
  assert.equal(mixedProblems.filter((p) => /may only trash rows/.test(p)).length, 2, mixedProblems.join(' | '));

  const withValues = removePlan(w, GEO.slice(0, 1));
  withValues.ops[0].properties = { Tag: 'x' };
  withValues.ops[1].expect = { Tag: 'x' };
  const valueProblems = problemsOf(withValues, w);
  assert.ok(mentions(valueProblems, /a trash op carries no properties/), valueProblems.join(' | '));
  assert.ok(mentions(valueProblems, /a trash op carries no expect/));
  const noPage = removePlan(w, GEO.slice(0, 1));
  delete noPage.ops[0].page_id;
  assert.ok(mentions(problemsOf(noPage, w), /a trash op needs the page_id of the row/));

  const twice = removePlan(w, GEO.slice(0, 1));
  twice.trash('claims', GEO[0], w.ids.claim[GEO[0]]);
  assert.ok(mentions(problemsOf(twice, w), /the key appears twice/));

  const notV2 = structuredClone(w.config);
  delete notV2.profile;
  assert.ok(mentions(checkPlan(removePlan(w, GEO.slice(0, 1)), notV2, { root: w.root }).problems, /may only be checked against the v2 profile/));

  const wrongCounts = { header: { plan: { ...removePlan(w).header().plan, counts: { creates: 0, updates: 0 } } }, ops: removePlan(w).ops };
  assert.ok(mentions(problemsOf(wrongCounts, w), /the counts say 0 creates and 0 updates, but the ops hold 0 and 0 and 6 trashes/));
});

// ---- applyPlan refuses what checkPlan refuses ------------------------------------------------------------------------------------------------

test('applyPlan refuses a trash op from another script, on another table, on a protected id or an id of the first page, before any request', async () => {
  const w = await world();
  const before = w.notion.requests.length;
  const cases = [];
  cases.push(['another script', removePlan(w, GEO.slice(0, 1), { script: 'propose' }), /a trash op is only allowed/]);
  cases.push(['another script (add)', removePlan(w, GEO.slice(0, 1), { script: 'add' }), /a trash op is only allowed/]);
  const otherTable = newPlan({ runId: 'run-1', script: 'remove', config: w.config, now: NOW });
  otherTable.trash('rule_changes', 'L', '0a9e0000-0000-4000-8000-0000000000ff');
  cases.push(['another table', otherTable, /only rows of claims and tag_decisions/]);
  const protectedId = newPlan({ runId: 'run-1', script: 'remove', config: w.config, now: NOW });
  protectedId.trash('claims', GEO[0], PROTECTED_PAGE);
  cases.push(['a protected id', protectedId, /protected lists/]);
  const firstPage = newPlan({ runId: 'run-1', script: 'remove', config: w.config, now: NOW });
  firstPage.trash('tag_decisions', 'k', FIRST_PAGE.tables.tag_decisions.database_id);
  cases.push(['an id of the first page', firstPage, /belongs to the first page/]);
  const own = newPlan({ runId: 'run-1', script: 'remove', config: w.config, now: NOW });
  own.trash('claims', 'k', DB.claims);
  cases.push(['a table of the agent', own, /a table or a page of the agent/]);
  for (const [label, plan, re] of cases) {
    await assert.rejects(() => apply(w, plan), (e) => e instanceof PlanError && /the plan was refused and nothing was sent/.test(e.message) && mentions(e.problems, re), label);
    assert.equal(existsSync(join(w.dir, 'ledger.jsonl')), false, `${label}: no ledger`);
  }
  assert.equal(w.notion.requests.length, before, 'not one request was sent for any of them');
  assert.deepEqual(w.notion.trashed(DB.claims), []);
  assert.deepEqual(w.notion.trashed(DB.tag_decisions), []);
});

test('applyPlan wants a client that can trash, and the pull of the tables, when the plan trashes', async () => {
  const w = await world();
  const plan = removePlan(w, GEO.slice(0, 1));
  const { trashPage: _t, ...without } = w.client;
  await assert.rejects(() => apply(w, plan, { client: without }), /must have trashPage/);
  // no pull of the table: the page cannot be matched to a row, nothing is trashed, the run ends at once
  const result = await apply(w, plan, { pulled: {} });
  assert.equal(result.code, EXIT.ERROR);
  assert.equal(result.stopped.reason, 'refused');
  assert.match(result.lists.failed[0].detail, /the pull of tag_decisions was not given/);
  assert.deepEqual(w.notion.trashed(DB.tag_decisions), []);
  assert.equal(patches(w).length, 0);
});

// ---- applying ------------------------------------------------------------------------------------------------------------------------

test('applyPlan trashes every row, reads each back as trashed, ledgers each step, and sends nothing again on the next run', async () => {
  const w = await world();
  const plan = removePlan(w);
  const result = await apply(w, plan);
  assert.equal(result.code, EXIT.OK, JSON.stringify(result.lists));
  assert.equal(result.done, 6);
  assert.equal(result.mismatches, 0);
  assert.deepEqual(Object.keys(result.trashed_by_table.claims).sort(), GEO);
  assert.deepEqual(Object.keys(result.trashed_by_table.tag_decisions).sort(), GEO.map((g) => `${g}::Context-dependent`));
  assert.deepEqual(w.notion.trashed(DB.claims).sort(), GEO.map((g) => w.ids.claim[g]).sort());
  assert.deepEqual(w.notion.trashed(DB.tag_decisions).sort(), GEO.map((g) => w.ids.decision[g]).sort());
  assert.equal(w.notion.rows(DB.claims).length, 0);
  // what was sent: one PATCH of the flag for each row (the old version names it archived), and nothing else that writes
  assert.equal(patches(w).length, 6);
  for (const p of patches(w)) assert.deepEqual(p.body, { archived: true });
  assert.equal(w.notion.writes().length, 6);
  const ledger = [...readLedger(w.dir).values()];
  assert.equal(ledger.length, 6);
  for (const line of ledger) {
    assert.equal(line.op, 'trash');
    assert.equal(line.status, 'done');
    assert.equal(line.read_back, 'ok');
    assert.equal(line.sent, 'trash');
    assert.equal(line.error, null);
    assert.ok(line.page_id);
  }
  // the Tag decisions rows are trashed before the claims
  assert.deepEqual(ledger.map((l) => l.table), ['tag_decisions', 'tag_decisions', 'tag_decisions', 'claims', 'claims', 'claims']);
  // the next run: the rows are not in the pull any more and the ledger says done, so nothing is sent
  const sentBefore = w.notion.requests.length;
  const again = await apply(w, plan, { pulled: pullFrom(w) });
  assert.equal(again.code, EXIT.OK);
  assert.equal(again.already_done, 6);
  assert.equal(w.notion.requests.length, sentBefore, 'not one request');
});

test('applyPlan reads back with retrievePage: a page that does not say it is in the trash is a mismatch (exit 2), and either flag is enough', async () => {
  const w = await world();
  // a trash that does nothing: the read-back finds the row live
  const idle = { ...w.client, trashPage: async (id) => w.client.retrievePage(id) };
  const plan = removePlan(w, GEO.slice(0, 1));
  const bad = await apply(w, plan, { client: idle });
  assert.equal(bad.code, EXIT.INVALID);
  assert.equal(bad.mismatches, 1, 'the Tag decisions row does not read back as trashed');
  assert.match(bad.lists.mismatches[0].detail, /read-back mismatch: the page is not in the trash/);
  assert.deepEqual(readLedger(w.dir).get(0).read_back, 'mismatch');
  assert.equal(bad.failed, 1, 'and its claim is not even tried: a claim waits for the rows of it');
  assert.match(bad.lists.failed[0].detail, /^not trashed: the Tag decisions row .* of this claim is not in the trash yet$/);
  assert.deepEqual(w.notion.trashed(DB.claims), []);
  // the next run looks again and sends nothing for a mismatch, then trashes nothing either: the ledger says it was sent
  const sentBefore = patches(w).length;
  const looked = await apply(w, plan, { client: idle, pulled: pullFrom(w) });
  assert.equal(looked.mismatches, 1);
  assert.equal(patches(w).length, sentBefore);

  // a server that answers with only one of the two flags is read through that flag
  for (const drop of ['in_trash', 'archived']) {
    const wx = await world();
    const withoutOne = {
      ...wx.client,
      retrievePage: async (id) => {
        const page = await wx.client.retrievePage(id);
        delete page[drop];
        return page;
      },
    };
    const result = await apply(wx, removePlan(wx, GEO.slice(0, 1)), { client: withoutOne });
    assert.equal(result.code, EXIT.OK, `without ${drop}: ${JSON.stringify(result.lists)}`);
    assert.equal(wx.notion.trashed(DB.claims).length, 1);
  }
});

test('applyPlan trashes only a page that the pull holds under that key; a page that is in the trash already counts as done and is not sent again', async () => {
  const w = await world();
  const plan = removePlan(w, GEO.slice(0, 1));
  // another page for the key: refused, the run stops at once, nothing is sent
  const other = pullFrom(w);
  other.tag_decisions[`${GEO[0]}::Context-dependent`] = { ...other.tag_decisions[`${GEO[0]}::Context-dependent`], page_id: w.ids.decision[GEO[1]] };
  const refusal = await apply(w, plan, { pulled: other });
  assert.equal(refusal.code, EXIT.ERROR);
  assert.equal(refusal.stopped.reason, 'refused');
  assert.match(refusal.lists.failed[0].detail, /the pull holds a different page for this key/);
  assert.equal(patches(w).length, 0);

  // a row that is not in the pull and is live: refused
  const w2 = await world();
  const missing = pullFrom(w2);
  delete missing.tag_decisions[`${GEO[0]}::Context-dependent`];
  const live = await apply(w2, removePlan(w2, GEO.slice(0, 1)), { pulled: missing });
  assert.equal(live.stopped.reason, 'refused');
  assert.match(live.lists.failed[0].detail, /is not a row of tag_decisions in the pull, so it is not trashed/);
  assert.equal(patches(w2).length, 0);

  // a row that is not in the pull because it is in the trash already: done, nothing sent for it
  const w3 = await world();
  await w3.client.trashPage(w3.ids.decision[GEO[0]]);
  const sentBefore = patches(w3).length;
  const done = await apply(w3, removePlan(w3, GEO.slice(0, 1)), { pulled: pullFrom(w3) });
  assert.equal(done.code, EXIT.OK, JSON.stringify(done.lists));
  const first = readLedger(w3.dir).get(0);
  assert.equal(first.status, 'done');
  assert.equal(first.sent, null, 'not sent: it was in the trash already');
  assert.equal(first.read_back, 'ok');
  assert.equal(patches(w3).length - sentBefore, 1, 'only the claim was sent');
  assert.equal(done.done, 2);
});

test('applyPlan does not trash a Tag decisions row that a person decided since the pull: it is skipped, the run stops, and the claims are still live', async () => {
  // the three editor columns, one by one: each stops the run at that row
  for (const [i, change] of [{ 'Tag outcome': 'Applies' }, { 'Your note': 'a word' }, { 'Agent is right': true }].entries()) {
    const wi = await world();
    const pi = pullFrom(wi);
    wi.notion.editRow(wi.ids.decision[GEO[1]], change);
    const r = await apply(wi, removePlan(wi), { pulled: pi });
    assert.equal(r.code, EXIT.ERROR, `${Object.keys(change)[0]}`);
    assert.equal(r.stopped.reason, 'person_set');
    assert.equal(r.stopped.key, `${GEO[1]}::Context-dependent`);
    assert.equal(r.skipped, 1);
    assert.match(r.lists.skipped[0].detail, new RegExp(`skipped: a person set "${Object.keys(change)[0]}"`));
    assert.deepEqual(wi.notion.trashed(DB.tag_decisions), [wi.ids.decision[GEO[0]]], `case ${i}: only the row before it was trashed`);
    assert.deepEqual(wi.notion.trashed(DB.claims), [], 'the claims are untouched');
    assert.equal(wi.notion.plainRows(DB.tag_decisions).some((row) => row.Key === `${GEO[1]}::Context-dependent`), true, 'the decided row is live');
  }
});

test('applyPlan stops after failures in a row, and the next run sends what is left and never a done step again', async () => {
  const w = await world();
  const plan = removePlan(w);
  // three rows fail on every attempt (the client tries a PATCH four times): the run stops
  w.notion.failNext('PATCH', /\/pages\//, 500, 4 * MAX_CONSECUTIVE_FAILURES);
  const first = await apply(w, plan);
  assert.equal(first.code, EXIT.ERROR);
  assert.equal(first.stopped.reason, 'failures_in_a_row');
  assert.equal(first.failed, MAX_CONSECUTIVE_FAILURES);
  assert.equal(first.pending, 3);
  assert.equal(w.notion.pendingFailures(), 0);
  assert.deepEqual(w.notion.trashed(DB.tag_decisions), []);

  const second = await apply(w, plan, { pulled: pullFrom(w) });
  assert.equal(second.code, EXIT.OK, JSON.stringify(second.lists));
  assert.equal(second.done, 6);
  assert.equal(w.notion.trashed(DB.claims).length + w.notion.trashed(DB.tag_decisions).length, 6);
  // a successful PATCH for each row, exactly once
  const ok = patches(w).filter((p) => p.status === 200);
  assert.equal(ok.length, 6);
  assert.equal(new Set(ok.map((p) => p.path)).size, 6, 'no page was sent twice');

  // a stop in the middle: two rows done, the third fails, the rest wait; the run after sends the rest and re-sends none of the two
  const v = await world();
  const plan2 = removePlan(v);
  v.notion.failNext('PATCH', /\/pages\//, 500, 4 * MAX_CONSECUTIVE_FAILURES, { applied: false });
  const real = v.client.trashPage;
  let sent = 0;
  const counting = { ...v.client, trashPage: async (id) => { sent += 1; return real(id); } };
  const stopped = await apply(v, plan2, { client: counting });
  assert.equal(stopped.code, EXIT.ERROR);
  const doneBefore = stopped.done;
  const retry = await apply(v, plan2, { client: counting, pulled: pullFrom(v) });
  assert.equal(retry.code, EXIT.OK);
  assert.equal(sent, 3 + 6, 'three attempts failed in the first run, six rows were sent in the second');
  assert.equal(doneBefore, 0);
});

test('applyPlan: a 401 from Notion stops the run at once', async () => {
  const w = await world();
  w.notion.failNext('PATCH', /\/pages\//, 401);
  const result = await apply(w, removePlan(w));
  assert.equal(result.stopped.reason, 'notion_refused');
  assert.equal(result.failed, 1);
  assert.equal(result.pending, 5);
});

// ---- a claim goes second -----------------------------------------------------------------------------------------------------------------

test('a claim is not trashed while a row of it is live: a row whose trash fails leaves its claim untouched, the run ends with exit 1 naming the claim, and a re-run finishes both', async () => {
  const w = await world();
  const plan = removePlan(w);
  // the row of the second claim cannot be trashed the first time (the client tries a PATCH four times)
  w.notion.failNext('PATCH', new RegExp(w.ids.decision[GEO[1]]), 500, 4);
  const first = await apply(w, plan);
  assert.equal(first.code, EXIT.ERROR);
  assert.equal(first.stopped, null, 'one failure is not a stop');
  assert.equal(first.done, 4, 'two rows and the two claims whose rows are in the trash');
  assert.equal(first.failed, 2, 'the row, and the claim that waits for it');
  assert.deepEqual(w.notion.trashed(DB.claims).sort(), [w.ids.claim[GEO[0]], w.ids.claim[GEO[2]]].sort());
  assert.deepEqual(w.notion.trashed(DB.tag_decisions).sort(), [w.ids.decision[GEO[0]], w.ids.decision[GEO[2]]].sort());
  const blocked = first.lists.failed.find((f) => f.table === 'claims');
  assert.equal(blocked.key, GEO[1], 'the claim is named');
  assert.match(blocked.detail, /^not trashed: the Tag decisions row .*02::Context-dependent of this claim is not in the trash yet$/);
  assert.equal(w.notion.requests.some((r) => r.method !== 'GET' && r.path.includes(w.ids.claim[GEO[1]])), false, 'not one write went to the claim');
  assert.equal(readLedger(w.dir).get(4).sent, null, 'and the ledger says nothing was sent for it');

  const second = await apply(w, plan, { pulled: pullFrom(w) });
  assert.equal(second.code, EXIT.OK, JSON.stringify(second.lists));
  assert.equal(second.done, 6);
  assert.equal(w.notion.trashed(DB.claims).length, 3);
  assert.equal(w.notion.trashed(DB.tag_decisions).length, 3);
  const ok = patches(w).filter((p) => p.status === 200);
  assert.equal(ok.length, 6, 'six successful PATCHes: no page was sent twice');
  assert.equal(new Set(ok.map((p) => p.path)).size, 6);
});

test('a claim with a row that stays live because a person decided it is not trashed either: the run stopped at the row, so the claims were not reached', async () => {
  const w = await world();
  const pulled = pullFrom(w);
  w.notion.editRow(w.ids.decision[GEO[0]], { 'Your note': 'decided' });
  const r = await apply(w, removePlan(w), { pulled });
  assert.equal(r.stopped.reason, 'person_set');
  assert.deepEqual(w.notion.trashed(DB.claims), []);
  assert.equal(r.pending, 5);
});

test('before a claim is trashed its page is read, and its relation "Tag decisions" must list nothing that is live: a row created after the pull keeps the claim, and a re-run finishes it once the row is gone', async () => {
  const w = await world({ relation: true });
  const plan = removePlan(w);
  const before = w.notion.requests.length;
  const happy = await apply(w, plan);
  assert.equal(happy.code, EXIT.OK, JSON.stringify(happy.lists));
  assert.equal(w.notion.requests.length - before, 18, 'a row: look, PATCH, read back; a claim: look, PATCH, read back; the rows the ledger shows trashed are not read again');

  // another world: a row of the second claim appears after the pull (the plan does not list it)
  const v = await world({ relation: true });
  const pulled = pullFrom(v);
  const late = v.notion.addRow(DB.tag_decisions, { Claim: 'Late', Key: `${GEO[1]}::Other`, Tag: 'Other', 'Agent proposal': 'Applies' });
  v.notion.editRow(v.ids.claim[GEO[1]], { 'Tag decisions': [v.ids.decision[GEO[1]], late] });
  const planV = removePlan(v);
  const first = await apply(v, planV, { pulled });
  assert.equal(first.code, EXIT.ERROR);
  assert.equal(first.done, 5);
  const named = first.lists.failed.find((f) => f.table === 'claims');
  assert.equal(named.key, GEO[1]);
  assert.equal(named.detail, `not trashed: the Tag decisions row ${late} of this claim is not in the trash`);
  assert.deepEqual(v.notion.trashed(DB.claims).sort(), [v.ids.claim[GEO[0]], v.ids.claim[GEO[2]]].sort());
  assert.equal(v.notion.requests.some((r) => r.method !== 'GET' && r.path.includes(v.ids.claim[GEO[1]])), false, 'nothing was written to the claim');
  assert.equal(first.stopped, null, 'a live row is no failure of Notion: it does not count toward the stop');

  // the row is trashed (by a new plan, an editor or the owner); the same plan then finishes the claim
  await v.client.trashPage(late);
  const second = await apply(v, planV, { pulled: pullFrom(v) });
  assert.equal(second.code, EXIT.OK, JSON.stringify(second.lists));
  assert.equal(v.notion.trashed(DB.claims).length, 3);

  // a row in the relation that is in the trash already (an old one) is no reason to wait; a relation Notion cut at 25 is read whole
  const x = await world({ relation: true });
  const old = x.notion.addRow(DB.tag_decisions, { Claim: 'Old', Key: `${GEO[0]}::Old`, Tag: 'Old' });
  await x.client.trashPage(old);
  x.notion.editRow(x.ids.claim[GEO[0]], { 'Tag decisions': [x.ids.decision[GEO[0]], old] });
  const cut = { ...x.client };
  cut.retrievePage = async (id) => {
    const page = await x.client.retrievePage(id);
    if (id === x.ids.claim[GEO[0]]) page.properties['Tag decisions'] = { ...page.properties['Tag decisions'], relation: page.properties['Tag decisions'].relation.slice(0, 1), has_more: true };
    return page;
  };
  let wholeRead = 0;
  cut.retrievePropertyItem = async (...args) => {
    wholeRead += 1;
    return x.client.retrievePropertyItem(...args);
  };
  const planX = removePlan(x, GEO.slice(0, 1));
  const done = await apply(x, planX, { client: cut });
  assert.equal(done.code, EXIT.OK, JSON.stringify(done.lists));
  assert.equal(wholeRead, 1, 'the whole relation was read');
  assert.deepEqual(x.notion.trashed(DB.claims), [x.ids.claim[GEO[0]]]);
});

test('a related page that cannot be read leaves the claim alone and counts as a failure (the claim is not trashed on a guess)', async () => {
  const w = await world({ relation: true });
  const pulled = pullFrom(w);
  const late = w.notion.addRow(DB.tag_decisions, { Claim: 'Late', Key: `${GEO[0]}::Other`, Tag: 'Other' });
  w.notion.editRow(w.ids.claim[GEO[0]], { 'Tag decisions': [w.ids.decision[GEO[0]], late] });
  w.notion.failNext('GET', new RegExp(`/pages/${late}$`), 404, 1);
  const r = await apply(w, removePlan(w, GEO.slice(0, 1)), { pulled });
  assert.equal(r.code, EXIT.ERROR);
  assert.equal(r.lists.failed[0].table, 'claims');
  assert.match(r.lists.failed[0].detail, /404/);
  assert.deepEqual(w.notion.trashed(DB.claims), []);
});

// ---- stopping between two ops --------------------------------------------------------------------------------------------------------------

test('applyPlan asks interrupt() before every op that is not done, and a reason ends the run there as stopped; the next run goes on without sending a done step again', async () => {
  const w = await world();
  const plan = removePlan(w);
  let asked = 0;
  const first = await apply(w, plan, { interrupt: () => (asked++ >= 2 ? 'paused' : null) });
  assert.equal(first.code, EXIT.ERROR);
  assert.deepEqual(first.stopped, { op_index: 2, key: `${GEO[2]}::Context-dependent`, reason: 'paused' });
  assert.equal(first.done, 2);
  assert.equal(first.pending, 4);
  assert.equal(asked, 3);
  assert.equal(patches(w).length, 2);

  // done ops are not asked about again
  let askedAgain = 0;
  const second = await apply(w, plan, { pulled: pullFrom(w), interrupt: () => { askedAgain += 1; return null; } });
  assert.equal(second.code, EXIT.OK, JSON.stringify(second.lists));
  assert.equal(askedAgain, 4);
  assert.equal(patches(w).filter((p) => p.status === 200).length, 6);
  assert.equal(new Set(patches(w).map((p) => p.path)).size, 6, 'no page was sent twice');
});

// ---- a plan of the remove script belongs to remove.mjs -------------------------------------------------------------------------------------

test('loop.mjs applyStep hands a plan of the remove script to the remove script and to no other, as it does for the add script', async () => {
  const w = await world();
  const plan = removePlan(w, GEO.slice(0, 1));
  for (const script of ['propose', 'add', 'copy-live', 'distill', 'promote']) {
    await assert.rejects(
      () => applyStep({ script, label: script }, plan),
      (e) => e.name === 'LoopExit' && e.code === EXIT.INVALID && new RegExp(`a plan of the remove script was handed to the ${script} script and nothing was sent`).test(e.message),
      script,
    );
  }
  // the add script's plan is still bound to add.mjs
  const add = newPlan({ runId: 'r', script: 'add', config: w.config, now: NOW });
  await assert.rejects(() => applyStep({ script: 'remove', label: 'Remove' }, add), (e) => e.name === 'LoopExit' && /plan of the add script was handed to the remove script/.test(e.message));
  assert.equal(w.notion.writes().length, 0);
});

// ---- who may trash ---------------------------------------------------------------------------------------------------------------------

test('only remove.mjs, plan.mjs (the op) and the client call trashPage or untrashPage, and the trash flag is written in no other script', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const scripts = join(codeRoot(), 'scripts');
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.mjs')) files.push(full);
    }
  };
  walk(scripts);
  const rel = (f) => f.slice(scripts.length + 1).split(sep).join('/');
  const callers = files.filter((f) => /\b(?:untrashPage|trashPage)\b/.test(readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(callers, ['lib/notion-rest.mjs', 'lib/plan.mjs', 'remove.mjs']);
  const writers = files.filter((f) => /\bin_trash\s*:|\barchived\s*:/.test(readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(writers, ['lib/notion-rest.mjs'], 'the flag itself is written in the client and nowhere else');
  // the op is built in remove.mjs only, and the name of its script is used by the files that bind or check it: its definition, the harness that binds it, the check and the script
  const builders = files.filter((f) => /\.trash\(/.test(readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(builders, ['remove.mjs'], 'only remove.mjs builds a trash op');
  const named = files.filter((f) => /\bREMOVE_SCRIPT\b/.test(readFileSync(f, 'utf8'))).map(rel).sort();
  assert.deepEqual(named, ['lib/config.mjs', 'lib/loop.mjs', 'lib/plan.mjs', 'remove.mjs'], 'REMOVE_SCRIPT is used by its definition, the harness binding, the plan check and remove.mjs');
});

test('.claude/settings.json asks for permission every time remove.mjs is typed, and never waves it through', () => {
  const settings = JSON.parse(readFileSync(join(codeRoot(), '..', '..', '.claude', 'settings.json'), 'utf8'));
  const rule = 'Bash(node agents/claim-tagger-mvp/scripts/remove.mjs:*)';
  assert.ok(settings.permissions.ask.includes(rule), 'the ask rule is there, next to setup.mjs');
  assert.ok(settings.permissions.ask.includes('Bash(node agents/claim-tagger-mvp/scripts/setup.mjs:*)'));
  assert.equal(settings.permissions.allow.some((r) => /remove\.mjs/.test(r)), false);
  assert.equal(settings.permissions.deny.some((r) => /remove\.mjs/.test(r)), false);
  // the connector's way to the trash stays shut
  for (const tool of ['notion-delete-pages', 'notion-delete-databases', 'notion-restore-pages', 'notion-move-pages']) {
    assert.ok(settings.permissions.deny.some((r) => r.endsWith(tool)), `${tool} stays denied`);
  }
});
