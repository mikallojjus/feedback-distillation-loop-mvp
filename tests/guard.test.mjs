import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, hookOutput, main } from '../agents/claim-tagger/scripts/hooks/guard.mjs';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { readJsonl } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { check, openPlan } from '../agents/claim-tagger/scripts/plan.mjs';
import { captureIo, cleanupRoots, makeWorld } from './fixtures/notion/helpers.mjs';

after(cleanupRoots);

const GUARD = fileURLToPath(new URL('../agents/claim-tagger/scripts/hooks/guard.mjs', import.meta.url));
const tool = (name, tool_input) => ({ session_id: 's', cwd: '/x', hook_event_name: 'PreToolUse', tool_name: `mcp__claude_ai_notion__notion-${name}`, tool_input });

/** An armed run: a Runs create, a Claims update, an Agent settings update. Returns the world and the batch contents the skill would copy. */
async function armed({ build, ctx } = {}) {
  const w = makeWorld();
  await w.pull('p1');
  const p = openPlan({ runId: 'run-1', root: w.root, ctx, now: w.clock.now });
  (build ?? ((q) => {
    q.create('runs', 'Tag R1', { Kind: 'Tag', 'Claims judged': 3, Verdict: 'n/a', Started: '2026-10-13T12:00:00.000Z' });
    q.create('runs', 'Tag R2', { Kind: 'Tag', 'Claims judged': 4 });
    q.update('claims', 'g1', null, { Readiness: 'Ready', 'Tag confidence': 'Debate: apply (0.9)' });
    q.update('agent_settings', 'claim-tagger', null, { 'Rubric in force': '2026-10-13.1', 'Last run at': '2026-10-13T12:00:00.000Z' });
  }))(p);
  p.write();
  const c = check({ root: w.root, runId: 'run-1', now: w.clock.now });
  assert.equal(c.code, EXIT.OK, (c.problems ?? []).join('; '));
  const dir = join(w.root, 'runs', 'run-1', 'batches');
  const files = readdirSync(dir);
  const pick = (re) => files.find((f) => re.test(f));
  const create = pick(/-create-runs.json$/) ? JSON.parse(readFileSync(join(dir, pick(/-create-runs.json$/)), 'utf8')) : null;
  const claimsUpdate = pick(/-update-claims.jsonl$/) ? readJsonl(join(dir, pick(/-update-claims.jsonl$/))).rows[0] : null;
  const settingsUpdate = pick(/-update-agent_settings.jsonl$/) ? readJsonl(join(dir, pick(/-update-agent_settings.jsonl$/))).rows[0] : null;
  const createInput = (pages = create?.pages, parent = create?.parent) => tool('create-pages', { parent: { type: 'data_source_id', ...parent }, pages, allow_async: false });
  const updateInput = (line) => tool('update-page', { page_id: line.page_id, command: 'update_properties', properties: line.properties });
  return { w, create, claimsUpdate, settingsUpdate, createInput, updateInput, d: (input) => decide(input, { root: w.root }) };
}
const verdict = (x) => x.permissionDecision;

// ---- allow: exactly the armed plan ----

test('a create call equal to the batch file is allowed; the same call again is a duplicate and denied; re-arming clears the ledger', async () => {
  const a = await armed();
  const first = a.d(a.createInput());
  assert.equal(verdict(first), 'allow', first.permissionDecisionReason);
  assert.match(first.permissionDecisionReason, /2 page\(s\) match creates of the armed plan \(run run-1\)/);
  const again = a.d(a.createInput());
  assert.equal(verdict(again), 'deny');
  assert.match(again.permissionDecisionReason, /already created from this plan \(duplicate create\)/);
  // one of the two pages alone is also a duplicate; nothing new is left
  assert.equal(verdict(a.d(a.createInput([a.create.pages[1]]))), 'deny');
  assert.equal(readJsonl(join(a.w.root, 'runs', 'run-1', 'guard-ledger.jsonl')).rows.length, 2);
  assert.equal(check({ root: a.w.root, runId: 'run-1', now: a.w.clock.now }).code, EXIT.OK);
  assert.equal(existsSync(join(a.w.root, 'runs', 'run-1', 'guard-ledger.jsonl')), false, 'check clears it');
  assert.equal(verdict(a.d(a.createInput())), 'allow');
});

test('creates may be sent in separate calls, in any order; the same page twice in one call is refused', async () => {
  const a = await armed();
  assert.equal(verdict(a.d(a.createInput([a.create.pages[1]]))), 'allow');
  assert.equal(verdict(a.d(a.createInput([a.create.pages[0]]))), 'allow');
  const b = await armed();
  const twice = b.d(b.createInput([b.create.pages[0], b.create.pages[0]]));
  assert.equal(verdict(twice), 'deny');
  assert.match(twice.permissionDecisionReason, /page 2 was already created/);
  assert.equal(readJsonl(join(b.w.root, 'runs', 'run-1', 'guard-ledger.jsonl'), 'utf8').rows.length, 0, 'a refused call leaves no ledger entry');
});

test('update calls equal to a batch line are allowed, in the flat and the data-wrapped form; they may repeat', async () => {
  const a = await armed();
  assert.equal(verdict(a.d(a.updateInput(a.claimsUpdate))), 'allow');
  assert.equal(verdict(a.d(a.updateInput(a.claimsUpdate))), 'allow', 'an update is idempotent');
  assert.equal(verdict(a.d(a.updateInput(a.settingsUpdate))), 'allow');
  const wrapped = tool('update-page', { data: { page_id: a.claimsUpdate.page_id, command: 'update_properties', properties: a.claimsUpdate.properties } });
  assert.equal(verdict(a.d(wrapped)), 'allow');
  const upper = tool('update-page', { page_id: a.claimsUpdate.page_id.toUpperCase(), command: 'update_properties', properties: a.claimsUpdate.properties });
  assert.equal(verdict(a.d(upper)), 'allow', 'page ids compare without case or dashes');
});

test('the parent may be given as data_source_id, collection:// url, or database_id; property order does not matter', async () => {
  const a = await armed();
  const id = a.create.parent.data_source_id;
  const reordered = a.create.pages.map((p) => ({ properties: Object.fromEntries(Object.entries(p.properties).reverse()) }));
  assert.equal(verdict(a.d(tool('create-pages', { parent: { data_source_id: `collection://${id}` }, pages: reordered }))), 'allow');
  const b = await armed();
  assert.equal(verdict(b.d(tool('create-pages', { parent: { database_id: b.create.parent.data_source_id }, pages: b.create.pages }))), 'allow');
});

test('page content must match too', async () => {
  const a = await armed({ build: (p) => p.create('runs', 'Gate R2', { Kind: 'Gate' }, { content_md: '# Card\n\nPASS' }) });
  const batch = JSON.parse(readFileSync(join(a.w.root, 'runs', 'run-1', 'batches', '001-create-runs.json'), 'utf8'));
  assert.equal(batch.pages[0].content, '# Card\n\nPASS');
  assert.equal(verdict(a.d(a.createInput([{ properties: batch.pages[0].properties }], batch.parent))), 'deny', 'content missing');
  assert.equal(verdict(a.d(a.createInput([{ ...batch.pages[0], content: '# Card\n\nFAIL' }], batch.parent))), 'deny', 'content changed');
  assert.equal(verdict(a.d(a.createInput(batch.pages, batch.parent))), 'allow');
});

// ---- deny: nothing armed, or not the plan ----

test('no armed plan: every page write is denied, with the reason', async () => {
  const w = makeWorld();
  const d = (input) => decide(input, { root: w.root });
  for (const input of [tool('create-pages', { parent: { data_source_id: 'x' }, pages: [{ properties: { Name: 'a' } }] }), tool('update-page', { page_id: 'p', command: 'update_properties', properties: { A: 1 } })]) {
    const r = d(input);
    assert.equal(verdict(r), 'deny');
    assert.match(r.permissionDecisionReason, /no plan is armed/);
  }
  writeFileSync(join(w.root, 'runs', 'APPLYING.json'), '{broken');
  assert.match(d(tool('update-page', { page_id: 'p', command: 'update_properties', properties: {} })).permissionDecisionReason, /APPLYING\.json is not readable/);
  writeFileSync(join(w.root, 'runs', 'APPLYING.json'), JSON.stringify({ run_id: 'x' }));
  assert.match(d(tool('update-page', { page_id: 'p', command: 'update_properties', properties: {} })).permissionDecisionReason, /no run_id and plan_sha/);
  writeFileSync(join(w.root, 'runs', 'APPLYING.json'), JSON.stringify({ run_id: 'ghost', plan_sha: 'abc' }));
  assert.match(d(tool('update-page', { page_id: 'p', command: 'update_properties', properties: {} })).permissionDecisionReason, /has no plan\.jsonl/);
});

test('a plan edited after arming, or batches from another plan, are denied', async () => {
  const a = await armed();
  const file = join(a.w.root, 'runs', 'run-1', 'plan.jsonl');
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, original.replace('Ready', 'Fix needed'));
  const edited = a.d(a.updateInput(a.claimsUpdate));
  assert.equal(verdict(edited), 'deny');
  assert.match(edited.permissionDecisionReason, /changed after it was armed/);
  writeFileSync(file, original);
  assert.equal(verdict(a.d(a.updateInput(a.claimsUpdate))), 'allow');
  const checkFile = join(a.w.root, 'runs', 'run-1', 'check.json');
  const state = JSON.parse(readFileSync(checkFile, 'utf8'));
  writeFileSync(checkFile, JSON.stringify({ ...state, plan_sha: 'something else' }));
  assert.match(a.d(a.updateInput(a.claimsUpdate)).permissionDecisionReason, /batch files of run run-1 are not from the armed plan/);
});

test('an extra or changed property, an unknown page, extra fields and other commands are denied', async () => {
  const a = await armed();
  const create = a.create.pages[0];
  const withExtra = a.d(a.createInput([{ properties: { ...create.properties, Priority: 'High' } }, a.create.pages[1]]));
  assert.equal(verdict(withExtra), 'deny');
  assert.match(withExtra.permissionDecisionReason, /page 1 differs from the planned page in Priority|page 1 is not a create/);
  const changed = a.d(a.createInput([{ properties: { ...create.properties, 'Claims judged': 99 } }]));
  assert.equal(verdict(changed), 'deny');
  assert.match(changed.permissionDecisionReason, /page 1 differs from the planned page in Claims judged/);
  const missing = a.d(a.createInput([{ properties: Object.fromEntries(Object.entries(create.properties).filter(([k]) => k !== 'Kind')) }]));
  assert.equal(verdict(missing), 'deny');
  assert.equal(verdict(a.d(a.createInput([{ properties: { 'Run title': 'Invented' } }]))), 'deny');
  assert.equal(verdict(a.d(a.createInput(a.create.pages, { data_source_id: 'aaaaaaaa-0000-4000-8000-000000000000' }))), 'deny', 'another parent');
  assert.equal(verdict(a.d(tool('create-pages', { pages: a.create.pages }))), 'deny', 'no parent');
  assert.equal(verdict(a.d(tool('create-pages', { parent: a.create.parent, pages: [] }))), 'deny');
  assert.equal(verdict(a.d(tool('create-pages', { parent: a.create.parent, pages: a.create.pages, icon: 'x' }))), 'deny', 'extra top-level field');
  assert.equal(verdict(a.d(tool('create-pages', { parent: a.create.parent, pages: [{ ...create, icon: { emoji: 'x' } }] }))), 'deny', 'extra page field');
  assert.equal(verdict(a.d(tool('create-pages', { parent: a.create.parent, pages: ['nope'] }))), 'deny');

  const u = a.claimsUpdate;
  const upd = a.d(tool('update-page', { page_id: u.page_id, command: 'update_properties', properties: { ...u.properties, Readiness: 'Fix needed' } }));
  assert.equal(verdict(upd), 'deny');
  assert.match(upd.permissionDecisionReason, /differ from the planned update of page .*: Readiness/);
  assert.equal(verdict(a.d(tool('update-page', { page_id: u.page_id, command: 'update_properties', properties: { ...u.properties, 'Last judged': 'x' } }))), 'deny', 'one property too many');
  assert.equal(verdict(a.d(tool('update-page', { page_id: u.page_id, command: 'update_properties', properties: { Readiness: 'Ready' } }))), 'deny', 'one property too few');
  assert.match(a.d(tool('update-page', { page_id: a.w.ids.claims.g3, command: 'update_properties', properties: u.properties })).permissionDecisionReason, /is not updated by the armed plan/);
  assert.match(a.d(tool('update-page', { page_id: u.page_id, command: 'replace_content', properties: u.properties })).permissionDecisionReason, /may only run update_properties/);
  assert.match(a.d(tool('update-page', { page_id: u.page_id, command: 'update_properties', properties: u.properties, new_str: 'x' })).permissionDecisionReason, /carries new_str/);
  assert.match(a.d(tool('update-page', { page_id: u.page_id, properties: u.properties })).permissionDecisionReason, /update_properties/);
  assert.match(a.d(tool('update-page', { page_id: u.page_id, command: 'update_properties' })).permissionDecisionReason, /needs page_id and properties/);
});

// ---- deny: protected databases and editor fields, even when armed ----

test('a call that mentions a protected database id is denied, wherever the id appears, even for a matching plan', async () => {
  const a = await armed();
  const protectedId = a.w.config.notion.protected_database_ids[0];
  const sneaky = [
    tool('create-pages', { parent: { data_source_id: protectedId }, pages: a.create.pages }),
    tool('create-pages', { parent: a.create.parent, pages: [{ properties: { ...a.create.pages[0].properties, Note: `see ${protectedId.replace(/-/g, '')}` } }] }),
    tool('update-page', { page_id: protectedId.toUpperCase(), command: 'update_properties', properties: a.claimsUpdate.properties }),
    tool('update-page', { page_id: a.claimsUpdate.page_id, command: 'update_properties', properties: { [`link to collection://${protectedId}`]: 'x' } }),
    tool('create-view', { data_source_id: protectedId, name: 'v' }),
  ];
  writeFileSync(join(a.w.root, 'runs', 'SETUP'), 'setup');
  for (const input of sneaky) {
    const r = a.d(input);
    assert.equal(verdict(r), 'deny', JSON.stringify(input.tool_input).slice(0, 80));
    assert.match(r.permissionDecisionReason, /protected database/);
  }
  for (const id of a.w.config.notion.protected_database_ids) assert.equal(verdict(a.d(tool('update-data-source', { data_source_id: id }))), 'deny');
  assert.equal(verdict(a.d(a.createInput())), 'allow', 'the clean plan call is still fine');
});

test('a property that belongs to the editors is denied in a create and in an update, in any spelling', async () => {
  const a = await armed();
  const names = ['Tag outcome', 'Why wrong', 'Your reasoning', 'Decided by', 'Decided at', 'Editor wording', 'Approved by', 'Paused', 'Paused by', 'Reason', 'Weekly cap', 'Owner', 'tag outcome', ' Tag Outcome '];
  for (const name of names) {
    const u = a.d(tool('update-page', { page_id: a.claimsUpdate.page_id, command: 'update_properties', properties: { ...a.claimsUpdate.properties, [name]: 'x' } }));
    assert.equal(verdict(u), 'deny', name);
    assert.match(u.permissionDecisionReason, /belongs to the editors/, name);
    const c = a.d(tool('create-pages', { parent: a.create.parent, pages: [{ properties: { ...a.create.pages[0].properties, [name]: 'x' } }] }));
    assert.equal(verdict(c), 'deny', name);
  }
  for (const key of ['date:Decided at:start', 'date:Decided at:end', 'date:Decided at:is_datetime']) {
    assert.match(a.d(tool('update-page', { data: { page_id: a.claimsUpdate.page_id, command: 'update_properties', properties: { [key]: '2026-10-13' } } })).permissionDecisionReason, /"Decided at" belongs to the editors/, key);
  }
});

test('Status Approved and Rejected are denied; the agent values go through the plan match like anything else', async () => {
  const a = await armed({
    build: (p) => p.update('rule_changes', 'Hedged trajectories are not forecasts', null, { Status: 'Live', 'Gate result': 'PASS (small sample)' }),
    ctx: { promote: true, gate: 'PASS' },
  });
  const line = readJsonl(join(a.w.root, 'runs', 'run-1', 'batches', '001-update-rule_changes.jsonl')).rows[0];
  assert.equal(verdict(a.d(a.updateInput(line))), 'allow');
  for (const v of ['Approved', 'Rejected']) {
    const r = a.d(tool('update-page', { page_id: line.page_id, command: 'update_properties', properties: { Status: v } }));
    assert.equal(verdict(r), 'deny');
    assert.match(r.permissionDecisionReason, new RegExp(`Status ${v} is for the rule owner`));
  }
  assert.equal(verdict(a.d(tool('update-page', { page_id: line.page_id, command: 'update_properties', properties: { Status: 'Proposed' } }))), 'deny', 'not in the plan');
});

// ---- schema tools, move and duplicate ----

test('schema tools need runs/SETUP', async () => {
  const w = makeWorld({ populate: false });
  const d = (input) => decide(input, { root: w.root });
  for (const name of ['create-database', 'update-data-source', 'create-view', 'update-view']) {
    const no = d(tool(name, { statements: 'CREATE TABLE (...)' }));
    assert.equal(verdict(no), 'deny', name);
    assert.match(no.permissionDecisionReason, /runs\/SETUP/);
  }
  writeFileSync(join(w.root, 'runs', 'SETUP'), 'engineer, 13 Oct');
  for (const name of ['create-database', 'update-data-source', 'create-view', 'update-view']) {
    const yes = d(tool(name, { statements: 'CREATE TABLE ("Tag outcome" SELECT(...))' }));
    assert.equal(verdict(yes), 'allow', `${name}: a DDL may name editor columns, it creates them`);
  }
});

test('move-pages and duplicate-page are never allowed, armed or in setup', async () => {
  const a = await armed();
  writeFileSync(join(a.w.root, 'runs', 'SETUP'), 'x');
  for (const name of ['move-pages', 'duplicate-page']) {
    const r = a.d(tool(name, { page_or_database_ids: [a.claimsUpdate.page_id], new_parent: { page_id: 'x' } }));
    assert.equal(verdict(r), 'deny', name);
    assert.match(r.permissionDecisionReason, /never allowed/);
  }
});

// ---- input handling ----

test('malformed input is denied with a reason, never thrown', () => {
  const w = makeWorld({ populate: false });
  const d = (input) => decide(input, { root: w.root });
  for (const input of [null, undefined, 5, 'text', [], {}, { tool_name: '' }, { tool_name: 5 }]) {
    const r = d(input);
    assert.equal(verdict(r), 'deny', JSON.stringify(input));
    assert.match(r.permissionDecisionReason, /no tool_name/);
  }
  assert.match(d({ tool_name: 'mcp__x__notion-update-page' }).permissionDecisionReason, /no tool_input/);
  assert.match(d({ tool_name: 'mcp__x__notion-update-page', tool_input: 'text' }).permissionDecisionReason, /no tool_input/);
  assert.match(decide(tool('update-page', { page_id: 'p' }), { root: join(w.dir, 'no-such-root') }).permissionDecisionReason, /config\.json is not readable/);
});

test('a tool the guard does not cover gets no decision (an allow would skip the permission prompt)', () => {
  const w = makeWorld({ populate: false });
  for (const name of ['mcp__claude_ai_notion__notion-fetch', 'mcp__claude_ai_notion__notion-query-data-sources', 'Bash', 'Read', 'mcp__claude_ai_notion__notion-search']) {
    assert.deepEqual(hookOutput({ tool_name: name, tool_input: {} }, { root: w.root }), {}, name);
  }
});

test('the hook prints one JSON line in the documented shape and exits 0, also for garbage', async () => {
  const a = await armed();
  const cap = captureIo();
  assert.equal(main(JSON.stringify(a.updateInput(a.claimsUpdate)), cap.io, { root: a.w.root }), EXIT.OK);
  assert.equal(cap.out.length, 1);
  const out = JSON.parse(cap.out[0]);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.deepEqual(Object.keys(out.hookSpecificOutput), ['hookEventName', 'permissionDecision', 'permissionDecisionReason']);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
  const bad = captureIo();
  assert.equal(main('this is not json', bad.io, { root: a.w.root }), EXIT.OK);
  assert.equal(JSON.parse(bad.out[0]).hookSpecificOutput.permissionDecision, 'deny');
  assert.match(JSON.parse(bad.out[0]).hookSpecificOutput.permissionDecisionReason, /not valid JSON/);
  const none = captureIo();
  main(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }), none.io, { root: a.w.root });
  assert.equal(none.out[0], '{}');
});

test('as a real hook process: stdin in, one JSON line out, exit status 0', () => {
  const run = (stdin) => spawnSync(process.execPath, [GUARD], { input: stdin, encoding: 'utf8', timeout: 20000 });
  const denied = run(JSON.stringify(tool('create-pages', { parent: { data_source_id: 'x' }, pages: [{ properties: { Name: 'a' } }] })));
  assert.equal(denied.status, 0, denied.stderr);
  assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const garbage = run('{{{');
  assert.equal(garbage.status, 0);
  assert.equal(JSON.parse(garbage.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const empty = run('');
  assert.equal(empty.status, 0);
  assert.equal(JSON.parse(empty.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const other = run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' } }));
  assert.equal(other.status, 0);
  assert.equal(other.stdout.trim(), '{}');
  const protectedCall = run(JSON.stringify(tool('update-page', { page_id: 'd1307596-e531-420f-8688-2485f3ef28ab', command: 'update_properties', properties: { A: 1 } })));
  assert.equal(JSON.parse(protectedCall.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.match(JSON.parse(protectedCall.stdout).hookSpecificOutput.permissionDecisionReason, /protected database/);
});
