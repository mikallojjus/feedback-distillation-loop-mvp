import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARCHIVE_TITLE, ARCHIVE_WARNING, ArchiveError, HUB_TITLE, applyArchive, archiveConfigChange, archiveFirst, archivedIds, checkArchivePlan, knownObjects, linksBack, planArchive, snapshotRoot, walkArchiveTree,
} from '../../agents/claim-tagger-mvp/scripts/lib/archive.mjs';
import { isProtected, loadConfig } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import { planStructure, runStructure } from '../../agents/claim-tagger-mvp/scripts/lib/notion-build.mjs';
import { API_BASE, countRequests } from '../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';
import { normId } from '../../agents/claim-tagger-mvp/scripts/lib/notion-values.mjs';
import { USAGE, main, openBuilder } from '../../agents/claim-tagger-mvp/scripts/setup.mjs';
import { createPagesFake } from './fixtures/fake-notion-pages.mjs';
import { placeholderConfig } from './helpers/config-fixture.mjs';
import { NOW, builderClient, cleanTmp, forFake, newWorld, noSleep, readJson, readLines, restClient, revisedStructure, testConfig, tmp, writeInputs } from './helpers/setup-world.mjs';

// The archive step (decision P9): the first build is moved into a page under the hub, the hub is renamed, and everything archived is protected. Every test runs
// against the pages fake (child pages and tables are blocks of their page, a move takes the block to the new parent). The world is the hub page "Feedback
// Distillation MVP" as the first build left it: the three sub-pages (Demos with two practice pages, Demo tests with one, each with five inline tables), the five old tables, a
// stray paragraph and an unknown child page.

after(cleanTmp);

const KEYS = ['proposal', 'demos', 'demo_tests', 'rulebook', 'claims', 'tag_decisions', 'rule_changes', 'agent_settings'];
const TITLES = {
  proposal: 'Structure proposal', demos: 'Demos', demo_tests: 'Demo tests', rulebook: 'Rulebook copy', claims: 'Claims copy', tag_decisions: 'Tag decisions',
  rule_changes: 'Rule changes', agent_settings: 'Agent settings',
};
const TABLE_KEYS = KEYS.slice(3);
const STRAY = 'Stray paragraph: a note somebody typed on the hub page';
const UNKNOWN_PAGE = "Somebody's notes";
const COLUMNS = { Name: { type: 'title', title: {} } };
const SESSION_REASON = 'test';

const paragraph = (content) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } });
const titleOf = (page) => page.properties.title.title.map((x) => x.plain_text).join('');
const runDirs = (root, step) => readdirSync(join(root, 'runs')).filter((d) => d.endsWith(`-setup-${step}`) || new RegExp(`-setup-${step}-\\d+$`).test(d)).sort().map((d) => join(root, 'runs', d));
const lastRun = (root, step) => runDirs(root, step).at(-1);

/** The hub as the first build left it, in a state folder with a config that names it, and a way to run setup.mjs against both. */
async function world({ session = true } = {}) {
  const root = tmp('archive');
  const probe = placeholderConfig();
  const fake = createPagesFake({ protected: [...probe.notion.protected_database_ids, ...probe.notion.protected_page_ids] });
  const hub = fake.addPage({ title: 'Feedback Distillation MVP' });
  const client = builderClient(fake);
  const page = async (parent, title) => (await client.createPageUnderPage({ parentPageId: parent, title, children: [paragraph(`${title} text`)] })).id;
  const table = async (parent, title) => {
    const db = await client.createDatabase({ parentPageId: parent, title, isInline: true, properties: COLUMNS });
    return { database_id: db.id, data_source_id: db.data_sources[0].id };
  };
  const ids = {};
  for (const key of KEYS.slice(0, 3)) ids[key] = await page(hub, TITLES[key]);
  const practice = [];
  for (const [under, title] of [['demos', 'Practice page 1'], ['demos', 'Practice page 2'], ['demo_tests', 'Test run 1']]) {
    const id = await page(ids[under], title);
    const tables = [];
    for (const t of TABLE_KEYS.map((k) => TITLES[k])) tables.push({ title: t, ...(await table(id, t)) });
    practice.push({ id, title, under, tables });
  }
  const tables = {};
  for (const key of TABLE_KEYS) tables[key] = await table(hub, TITLES[key]);
  await client.appendBlocks(hub, [paragraph(STRAY)]);
  const unknownPage = await page(hub, UNKNOWN_PAGE);

  const config = testConfig({ parent: hub });
  config.notion.pages = { proposal: normId(ids.proposal), demos: normId(ids.demos), demo_tests: normId(ids.demo_tests), onboarding: '<setup>', archive: '<setup>' };
  const put = (entry, t) => {
    entry.database_id = normId(t.database_id);
    entry.data_source_id = normId(t.data_source_id);
  };
  put(config.notion.rulebook, tables.rulebook);
  put(config.notion.claims, tables.claims);
  for (const k of ['tag_decisions', 'rule_changes', 'agent_settings']) put(config.notion.databases[k], tables[k]);
  config.notion.views = {
    your_queue: { id: '400273e214eb815cb56e000c9983235e', url: `https://www.notion.so/${normId(tables.claims.database_id)}?v=400273e214eb815cb56e000c9983235e` },
    rulebook: { id: '3fa273e214eb81c5af0e000c3f4d2664', url: `https://www.notion.so/${normId(tables.rulebook.database_id)}?v=3fa273e214eb81c5af0e000c3f4d2664` },
  };
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  if (session) assert.equal(openBuilder({ root, reason: SESSION_REASON }).ok, true);

  const env = { root, fetchImpl: fake.fetchImpl, token: fake.token, sleep: noSleep, now: NOW, repoRoot: root };
  const w ={ root, fake, hub, client, config, ids, tables, practice, unknownPage, env };
  w.id = { ...Object.fromEntries(KEYS.slice(0, 3).map((k) => [k, normId(ids[k])])), ...Object.fromEntries(TABLE_KEYS.map((k) => [k, normId(tables[k].database_id)])) };
  w.run = async (argv, extra = {}) => {
    const out = [];
    const err = [];
    const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s) }, { ...env, ...extra });
    return { code, out, err, text: [...out, ...err].join('\n') };
  };
  w.parentId = (id) => normId(fake.parentOf(id).page_id);
  w.archiveRecord = () => readJson(join(root, 'setup', 'archive.json'));
  return w;
}

// the requests of the fake since a point in the log, with their bodies
const since = (w, n) => w.fake.requests.slice(n);
const isMove = (q) => (q.method === 'POST' && /^\/pages\/[^/]+\/move$/.test(q.path)) || (q.method === 'PATCH' && /^\/databases\/[^/]+$/.test(q.path));

// ---- --plan-only --------------------------------------------------------------------------------------------------------------------------

test('archive --plan-only sends GET requests only, writes the plan and the snapshot to the run folder, and changes nothing', async () => {
  const w = await world();
  const before = w.fake.requests.length;
  const outlineBefore = w.fake.outline(w.hub);
  const r = await w.run(['archive', '--plan-only']);
  assert.equal(r.code, 0, r.text);
  const sent = since(w, before);
  assert.ok(sent.length >= 10, `the plan needs its reads (${sent.length})`);
  assert.ok(sent.every((q) => q.method === 'GET'), 'every request is a GET');
  const dir = lastRun(w.root, 'archive');
  assert.deepEqual(countRequests(join(dir, 'requests.jsonl')), { total: sent.length, byMethod: { GET: sent.length, POST: 0, PATCH: 0 }, writes: 0 });
  const plan = readJson(join(dir, 'plan.json'));
  assert.deepEqual(plan.ops.map((o) => o.op), ['rename_root', 'create_archive_page', ...Array(8).fill('move')]);
  assert.deepEqual(plan.ops.filter((o) => o.op === 'move').map((o) => o.key), KEYS);
  assert.deepEqual(plan.leftovers.map((l) => [l.type, l.text]), [['paragraph', STRAY], ['child_page', UNKNOWN_PAGE]]);
  assert.ok(existsSync(join(dir, 'snapshot.json')));
  assert.equal(existsSync(join(w.root, 'setup', 'archive.json')), false, 'plan-only leaves no archive.json');
  assert.equal(existsSync(join(dir, 'archive-ledger.jsonl')), false, 'and no ledger');
  assert.deepEqual(w.fake.outline(w.hub), outlineBefore);
  assert.equal(titleOf(await w.client.retrievePage(w.hub)), 'Feedback Distillation MVP');
  assert.match(r.text, /plan only/);
  assert.match(r.text, new RegExp(UNKNOWN_PAGE));
  assert.match(r.text, /0 writes/);
  assert.equal(readJson(join(w.root, 'config.json')).notion.pages.demos, w.id.demos, 'config.json is as it was');
});

// ---- a real run ---------------------------------------------------------------------------------------------------------------------------

test('archive: one rename, one create, eight moves, every new parent read back; two leftovers listed and untouched; archive.json, config.json and the registry', async () => {
  const w = await world();
  mkdirSync(join(w.root, 'runs', 'builder'), { recursive: true });
  for (const name of ['pages', 'databases', 'state']) writeFileSync(join(w.root, 'runs', 'builder', `${name}.json`), '{}\n'); // no verify.json: only those that exist are set aside
  const oldConfig = readJson(join(w.root, 'config.json'));
  const leftovers = w.fake.entries(w.hub).filter((e) => e.text === STRAY || e.text === UNKNOWN_PAGE);
  const before = w.fake.requests.length;

  const r = await w.run(['archive']);
  assert.equal(r.code, 0, r.text);

  // the ledger: 1 rename, 1 create, 8 moves, all done and read back
  const dir = lastRun(w.root, 'archive');
  const ledger = readLines(join(dir, 'archive-ledger.jsonl'));
  assert.deepEqual(ledger.map((l) => l.op), ['rename_root', 'create_archive_page', ...Array(8).fill('move')]);
  assert.ok(ledger.every((l) => l.status === 'done' && l.read_back === 'ok'), JSON.stringify(ledger));
  assert.ok(existsSync(join(dir, 'plan.json')));
  assert.equal(readJson(join(dir, 'run.json')).exit_code, 0);

  // Notion
  const archive = w.archiveRecord();
  const archiveId = archive.archive_page;
  assert.equal(titleOf(await w.client.retrievePage(w.hub)), HUB_TITLE);
  const archivePage = await w.client.retrievePage(archiveId);
  assert.equal(titleOf(archivePage), ARCHIVE_TITLE);
  assert.equal(normId(archivePage.parent.page_id), normId(w.hub));
  for (const key of KEYS) assert.equal(w.parentId(w.id[key]), archiveId, `${key} sits under the Archive page`);
  assert.deepEqual(w.fake.outline(w.hub), [`paragraph|${STRAY}`, `child_page|${UNKNOWN_PAGE}`, `child_page|${ARCHIVE_TITLE}`], 'what is left on the hub page, and the Archive page');
  const held = w.fake.outline(archiveId);
  assert.match(held[0], /^paragraph\|Archived on 27 Oct 2026\. The live tables are on the hub: Claim tagger\.$/);
  assert.match(held[1], /^paragraph\|This page holds the first build/);
  assert.equal(held[2], `paragraph|${ARCHIVE_WARNING}`);
  assert.deepEqual(held.slice(3), [
    'child_page|Structure proposal', 'child_page|Demos', 'child_page|Demo tests',
    'database|Rulebook copy', 'database|Claims copy', 'database|Tag decisions', 'database|Rule changes', 'database|Agent settings',
  ], 'the eight, in the order they were moved');
  const link = (await w.client.retrieveBlockChildren(archiveId))[0].paragraph.rich_text.find((x) => x.plain_text === HUB_TITLE);
  assert.equal(link.href, `https://www.notion.so/${normId(w.hub)}`, 'Claim tagger links to the hub page');
  assert.equal(w.fake.outline(w.ids.demos).length, 3, 'Demos took its paragraph and its two practice pages with it');
  assert.equal(w.parentId(w.practice[0].id), w.id.demos, 'a practice page is still under Demos');

  // the requests: exact bodies, no removal anywhere
  const sent = since(w, before);
  const writes = sent.filter((q) => q.method !== 'GET');
  assert.equal(writes.length, 10, 'one rename, one create, eight moves');
  const rename = writes.find((q) => q.method === 'PATCH' && q.path === `/pages/${normId(w.hub)}`);
  assert.deepEqual(rename.body, { properties: { title: { title: [{ type: 'text', text: { content: 'Claim tagger' } }] } } });
  const parentBody = { parent: { type: 'page_id', page_id: archiveId } };
  for (const key of KEYS.slice(0, 3)) {
    const q = writes.find((x) => x.path === `/pages/${w.id[key]}/move`);
    assert.equal(q.method, 'POST');
    assert.deepEqual(q.body, parentBody, `the exact body of the move of ${key}`);
    assert.equal(q.version, '2026-03-11');
  }
  for (const key of TABLE_KEYS) {
    const q = writes.find((x) => x.path === `/databases/${w.id[key]}`);
    assert.equal(q.method, 'PATCH');
    assert.deepEqual(q.body, parentBody, `the exact body of the move of ${key}`);
    assert.equal(q.version, '2026-03-11');
  }
  assert.ok(writes.every((q) => !/in_trash|archived|is_inline/.test(JSON.stringify(q.body))), 'no trash, archive or inline field in any body');
  assert.ok(sent.every((q) => ['GET', 'POST', 'PATCH'].includes(q.method)));
  assert.ok(sent.every((q) => q.status !== null && q.status < 300), 'every request succeeded');

  // the leftovers: listed in the report and in archive.json, never moved or changed
  assert.deepEqual(archive.leftovers.map((l) => [l.id, l.type, l.text]), leftovers.map((e) => [normId(e.id), e.type, e.text]));
  assert.match(r.text, /remove these by hand from the hub page/);
  assert.match(r.text, new RegExp(UNKNOWN_PAGE));
  assert.ok(writes.every((q) => leftovers.every((e) => !q.path.includes(normId(e.id)))), 'no write names a leftover');

  // archive.json
  assert.equal(archive.state, 'done');
  assert.equal(archive.archived_at, NOW().toISOString());
  assert.equal(archive.root, normId(w.hub));
  assert.deepEqual(archive.moved.map((m) => [m.key, m.status, m.read_back, m.to_parent]), KEYS.map((k) => [k, 'moved', 'ok', archiveId]));
  assert.deepEqual(archive.practice_pages.map((p) => [p.title, p.under, p.tables.length]), [['Practice page 1', 'demos', 5], ['Practice page 2', 'demos', 5], ['Test run 1', 'demo_tests', 5]]);
  assert.ok(archive.practice_pages.flatMap((p) => p.tables).every((t) => /^[0-9a-f]{32}$/.test(t.id) && /^[0-9a-f]{32}$/.test(t.data_source_id)));
  assert.deepEqual(archive.tables.map((t) => [t.key, t.database_id, t.data_source_id]), TABLE_KEYS.map((k) => [k, normId(w.tables[k].database_id), normId(w.tables[k].data_source_id)]));
  assert.deepEqual(archive.views.map((v) => v.key), ['your_queue', 'rulebook']);
  assert.deepEqual(archive.walk_errors, []);

  // config.json: loadable, the old ids out, every archived id protected
  const config = loadConfig(w.root);
  assert.equal(config.notion.pages.archive, archiveId);
  assert.equal(config.notion.pages.onboarding, '<setup>');
  for (const k of ['rulebook', 'claims']) assert.deepEqual([config.notion[k].database_id, config.notion[k].data_source_id], ['<setup>', '<setup>']);
  for (const k of ['tag_decisions', 'rule_changes', 'agent_settings']) assert.deepEqual([config.notion.databases[k].database_id, config.notion.databases[k].data_source_id], ['<setup>', '<setup>']);
  assert.deepEqual(config.notion.views, {});
  const archivedPages = [archiveId, w.id.proposal, w.id.demos, w.id.demo_tests, ...w.practice.map((p) => p.id)];
  const archivedDatabases = [...archive.tables.flatMap((t) => [t.database_id, t.data_source_id]), ...w.practice.flatMap((p) => p.tables.flatMap((t) => [t.database_id, t.data_source_id]))];
  for (const id of [...archivedPages, ...archivedDatabases]) assert.equal(isProtected(config, id), true, `${id} is protected`);
  assert.equal(config.notion.protected_page_ids.length, oldConfig.notion.protected_page_ids.length + 7);
  assert.equal(config.notion.protected_database_ids.length, oldConfig.notion.protected_database_ids.length + 10 + 30);
  assert.deepEqual(config.notion.protected_database_ids.slice(0, oldConfig.notion.protected_database_ids.length), oldConfig.notion.protected_database_ids, 'the old entries are first and unchanged');
  const expected = structuredClone(oldConfig);
  Object.assign(expected.notion, {
    pages: config.notion.pages, views: {}, protected_page_ids: config.notion.protected_page_ids, protected_database_ids: config.notion.protected_database_ids,
  });
  for (const entry of [expected.notion.rulebook, expected.notion.claims, ...Object.values(expected.notion.databases)]) Object.assign(entry, { database_id: '<setup>', data_source_id: '<setup>' });
  assert.deepEqual(readJson(join(w.root, 'config.json')), expected, 'nothing else in config.json changed');
  assert.equal(archivedIds(w.root).has(normId(w.practice[0].tables[0].database_id)), true, 'archivedIds lists the practice tables');
  assert.equal(archivedIds(w.root).has(archiveId), true);

  // the builder registry is set aside
  const aside = join(w.root, 'runs', 'builder', 'before-archive');
  assert.deepEqual(readdirSync(aside).sort(), ['databases.json', 'pages.json', 'state.json']);
  for (const name of ['pages', 'databases', 'state', 'verify']) assert.equal(existsSync(join(w.root, 'runs', 'builder', `${name}.json`)), false, `${name}.json is no longer in runs/builder`);

  // the report
  assert.match(r.text, /moved into it/);
  assert.match(r.text, /Next: node agents\/claim-tagger-mvp\/scripts\/setup\.mjs build/);
  assert.match(r.text, /read back/);
});

// ---- a second run ---------------------------------------------------------------------------------------------------------------------------

test('a run after state "done" says "done already", exits 0 and sends nothing at all; so does --plan-only', async () => {
  const w = await world();
  assert.equal((await w.run(['archive'])).code, 0);
  const count = w.fake.requests.length;
  const again = await w.run(['archive']);
  assert.equal(again.code, 0, again.text);
  assert.match(again.text, /done already/);
  assert.equal(w.fake.requests.length, count, 'not one request');
  const planOnly = await w.run(['archive', '--plan-only']);
  assert.equal(planOnly.code, 0);
  assert.match(planOnly.text, /done already/);
  assert.equal(w.fake.requests.length, count);
});

test('archive.json says done but config.json still has the old ids (the run stopped between the two): a rerun finishes the local part without a request', async () => {
  const w = await world();
  const oldConfigText = readFileSync(join(w.root, 'config.json'), 'utf8');
  assert.equal((await w.run(['archive'])).code, 0);
  writeFileSync(join(w.root, 'config.json'), oldConfigText);
  mkdirSync(join(w.root, 'runs', 'builder'), { recursive: true });
  writeFileSync(join(w.root, 'runs', 'builder', 'pages.json'), '{}\n');
  const count = w.fake.requests.length;
  const r = await w.run(['archive']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /finished now/);
  assert.equal(w.fake.requests.length, count);
  assert.equal(loadConfig(w.root).notion.pages.archive, w.archiveRecord().archive_page);
  assert.equal(existsSync(join(w.root, 'runs', 'builder', 'pages.json')), false);
  assert.equal((await w.run(['archive'])).text.includes('done already'), true);
});

// ---- stops and resumes ----------------------------------------------------------------------------------------------------------------------

test('a 500 on the third move (every retry too) gives exit 1 with the resume command; the rerun completes and nothing is moved twice', async () => {
  const w = await world();
  w.fake.failNext('POST', new RegExp(`^/pages/${w.id.demo_tests}/move$`), 500, 4);
  const before = w.fake.requests.length;
  const first = await w.run(['archive']);
  assert.equal(first.code, 1, first.text);
  assert.match(first.err.join('\n'), /Demo tests/);
  assert.match(first.err.join('\n'), /run the same command again: node agents\/claim-tagger-mvp\/scripts\/setup\.mjs archive/);
  assert.equal(w.archiveRecord().state, 'moving');
  assert.ok(w.archiveRecord().archive_page, 'the Archive page id is recorded at once');
  assert.deepEqual(w.fake.moves().map((m) => normId(m.id)), [w.id.proposal, w.id.demos], 'two moved before the failure');
  assert.equal(since(w, before).filter((q) => q.path === `/pages/${w.id.demo_tests}/move` && q.status === 500).length, 4, 'one attempt and three retries');
  assert.equal(readJson(join(lastRun(w.root, 'archive'), 'run.json')).exit_code, 1);

  // the build waits while the archive is half done
  const build = await w.run(['build']);
  assert.equal(build.code, 2);
  assert.match(build.err.join('\n'), /the archive stopped halfway/);

  const second = await w.run(['archive']);
  assert.equal(second.code, 0, second.text);
  const moves = w.fake.moves().map((m) => normId(m.id));
  assert.equal(moves.length, 8);
  assert.equal(new Set(moves).size, 8, 'each object moved once');
  const done = since(w, before).filter((q) => isMove(q) && q.status === 200);
  assert.equal(done.length, 8, 'eight successful move requests in all');
  assert.equal(new Set(done.map((q) => q.path)).size, 8);
  const rerun = readLines(join(lastRun(w.root, 'archive'), 'archive-ledger.jsonl'));
  assert.deepEqual(rerun.map((l) => l.op), Array(6).fill('move'), 'the rerun had no rename, no create, and only the six that were left');
  assert.equal(w.archiveRecord().state, 'done');
  assert.ok(w.archiveRecord().moved.every((m) => m.read_back === 'ok'));
  assert.deepEqual(w.archiveRecord().moved.map((m) => m.status), ['already', 'already', 'moved', 'moved', 'moved', 'moved', 'moved', 'moved']);
});

test('a refused move (400) gives exit 2 and the drag message; after a simulated drag the rerun completes without moving that object', async () => {
  const w = await world();
  w.fake.failNext('PATCH', new RegExp(`^/databases/${w.id.claims}$`), 400, 1, { message: 'Cannot move this database.' });
  const before = w.fake.requests.length;
  const first = await w.run(['archive']);
  assert.equal(first.code, 2, first.text);
  const text = first.err.join('\n');
  assert.match(text, /Notion refused to move table "Claims copy"/);
  assert.match(text, /drag the table "Claims copy" into the page "Feedback Distillation MVP \(archive, to 27 Oct 2026\)" by hand in Notion/);
  assert.match(text, /run setup\.mjs archive again/);
  assert.equal(since(w, before).filter((q) => q.path === `/databases/${w.id.claims}` && q.method === 'PATCH').length, 1, 'a refusal is not retried');
  assert.equal(w.fake.moves().length, 4, 'the three pages and the Rulebook copy were moved; the Claims copy stops it');
  assert.equal(w.archiveRecord().state, 'moving');
  assert.equal(readJson(join(lastRun(w.root, 'archive'), 'run.json')).exit_code, 2);
  assert.equal((await w.run(['build'])).code, 2, 'build waits');

  // the person drags the table into the Archive page
  await w.client.moveDatabase(w.id.claims, { parentPageId: w.archiveRecord().archive_page });
  const dragged = since(w, before).length;
  const second = await w.run(['archive']);
  assert.equal(second.code, 0, second.text);
  const claimsMoves = since(w, before).slice(dragged).filter((q) => q.method !== 'GET' && q.path === `/databases/${w.id.claims}`);
  assert.equal(claimsMoves.length, 0, 'the script did not move the dragged table again');
  for (const key of KEYS) assert.equal(w.parentId(w.id[key]), w.archiveRecord().archive_page);
  assert.equal(w.archiveRecord().moved.find((m) => m.key === 'claims').status, 'already');
  assert.equal(w.archiveRecord().state, 'done');
});

test('a 403 on a page move is a refusal too, and names the page', async () => {
  const w = await world();
  w.fake.failNext('POST', new RegExp(`^/pages/${w.id.demos}/move$`), 403, 1);
  const r = await w.run(['archive']);
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /drag the page "Demos" into the page/);
});

test('an Archive page create whose answer was lost is exit 1 (the create is not sent twice in the run); the rerun looks again and finishes', async () => {
  const w = await world();
  w.fake.failNext('POST', /^\/pages$/, 503, 1);
  const before = w.fake.requests.length;
  const first = await w.run(['archive']);
  assert.equal(first.code, 1, first.text);
  assert.match(first.err.join('\n'), /Notion may have made the Archive page/);
  assert.match(first.err.join('\n'), /run the same command again/);
  assert.equal(since(w, before).filter((q) => q.method === 'POST' && q.path === '/pages').length, 1, 'one create request, no second try');
  assert.equal(w.archiveRecord().state, 'moving');
  assert.equal(w.archiveRecord().archive_page, null);
  assert.equal(w.fake.moves().length, 0, 'nothing was moved before the Archive page existed');
  assert.equal(readLines(join(lastRun(w.root, 'archive'), 'archive-ledger.jsonl')).at(-1).status, 'uncertain');
  const second = await w.run(['archive']);
  assert.equal(second.code, 0, second.text);
  assert.equal(w.fake.outline(w.hub).filter((o) => o === `child_page|${ARCHIVE_TITLE}`).length, 1);
  assert.equal(w.archiveRecord().state, 'done');
  assert.equal(w.parentId(w.id.claims), w.archiveRecord().archive_page);
});

test('an Archive page made earlier is adopted by its exact title; two pages with that title stop it with nothing written; a hub that is called Claim tagger already is not renamed', async () => {
  const w = await world();
  const made = await w.client.createPageUnderPage({ parentPageId: w.hub, title: ARCHIVE_TITLE });
  const before = w.fake.requests.length;
  const r = await w.run(['archive']);
  assert.equal(r.code, 0, r.text);
  assert.equal(w.archiveRecord().archive_page, normId(made.id), 'the existing page is the Archive page');
  assert.equal(since(w, before).filter((q) => q.method === 'POST' && q.path === '/pages').length, 0, 'no page was made');
  assert.equal(readJson(join(lastRun(w.root, 'archive'), 'plan.json')).archive.via, 'title');

  const two = await world();
  await two.client.createPageUnderPage({ parentPageId: two.hub, title: ARCHIVE_TITLE });
  await two.client.createPageUnderPage({ parentPageId: two.hub, title: ARCHIVE_TITLE });
  const mark = two.fake.requests.length;
  const stopped = await two.run(['archive']);
  assert.equal(stopped.code, 2, stopped.text);
  assert.match(stopped.err.join('\n'), /2 pages under the hub are titled/);
  assert.ok(since(two, mark).every((q) => q.method === 'GET'), 'nothing was written');
  assert.equal(existsSync(join(two.root, 'setup', 'archive.json')), false);

  const named = await world();
  await named.client.updatePage(named.hub, { properties: { title: { title: [{ type: 'text', text: { content: HUB_TITLE } }] } } });
  const point = named.fake.requests.length;
  const done = await named.run(['archive']);
  assert.equal(done.code, 0, done.text);
  assert.equal(since(named, point).filter((q) => q.method === 'PATCH' && q.path === `/pages/${normId(named.hub)}`).length, 0, 'the hub page is not renamed again');
  assert.deepEqual(readLines(join(lastRun(named.root, 'archive'), 'archive-ledger.jsonl')).map((l) => l.op), ['create_archive_page', ...Array(8).fill('move')]);
});

test('the session and the pause gate the step: no runs/SETUP is exit 2, runs/PAUSED is exit 3, and neither sends a request', async () => {
  const w = await world({ session: false });
  const none = await w.run(['archive']);
  assert.equal(none.code, 2);
  assert.match(none.err[0], /setup archive: no builder session is open/);
  assert.equal((await w.run(['archive', '--plan-only'])).code, 2);
  openBuilder({ root: w.root, reason: SESSION_REASON });
  writeFileSync(join(w.root, 'runs', 'PAUSED'), 'paused\n');
  const before = w.fake.requests.length;
  const paused = await w.run(['archive']);
  assert.equal(paused.code, 3);
  assert.match(paused.err[0], /runs\/PAUSED exists/);
  assert.equal(w.fake.requests.length, before);
});

// ---- the plan check -------------------------------------------------------------------------------------------------------------------------

test('checkArchivePlan: a clean plan passes; a foreign id, a protected target, a wrong destination and a wrong source parent are refused, and applyArchive sends nothing for them', async () => {
  const w = await world();
  const config = loadConfig(w.root);
  const snapshot = await snapshotRoot({ client: w.client, config });
  const plan = planArchive({ config, snapshot, runId: 'test', now: NOW });
  assert.deepEqual(checkArchivePlan(plan, config), { ok: true, problems: [] });
  assert.deepEqual(plan.ops.map((o) => o.op), ['rename_root', 'create_archive_page', ...Array(8).fill('move')]);
  assert.deepEqual(knownObjects(config).map((k) => k.key), KEYS);

  const tampered = (change, cfg = config) => {
    const p = structuredClone(plan);
    change(p);
    return checkArchivePlan(p, cfg);
  };
  const problems = (r) => r.problems.join('\n');
  const foreign = tampered((p) => { p.ops[2].id = 'f'.repeat(32); });
  assert.equal(foreign.ok, false);
  assert.match(problems(foreign), /is not one of the old pages or tables that config\.json names/);

  const sources = tampered((p) => { p.ops[5].id = config.notion.protected_database_ids[0]; });
  assert.match(problems(sources), /protected lists of config\.json, so it is never moved/);
  const guarded = structuredClone(config);
  guarded.notion.protected_database_ids.push(w.id.claims);
  const claimsGuarded = checkArchivePlan(plan, guarded);
  assert.equal(claimsGuarded.ok, false);
  assert.match(problems(claimsGuarded), /op 7 \(move claims\): .* is on the protected lists of config\.json, so it is never moved/);

  assert.match(problems(tampered((p) => { p.ops[3].to = w.id.demos; })), /the destination is not the Archive page/);
  assert.match(problems(tampered((p) => { p.ops[3].to_parent = w.id.demos; })), /the destination is not the Archive page/);
  assert.match(problems(tampered((p) => { p.ops[4].from_parent = w.id.demos; })), /sits under .* neither the hub page nor the Archive page/);
  assert.match(problems(tampered((p) => { p.ops[4].from_parent = null; })), /current parent is unknown/);
  assert.match(problems(tampered((p) => { p.ops[2].id = normId(w.hub); })), /hub page and the Archive page are never moved/);
  assert.match(problems(tampered((p) => { p.ops[3].id = p.ops[2].id; })), /moved twice|is the page "proposal" in config\.json/);
  assert.match(problems(tampered((p) => { p.ops[3].op = 'trash'; })), /no such operation/);
  assert.match(problems(tampered((p) => { p.ops[1].parent_id = w.id.demos; })), /not under the hub page/);
  assert.match(problems(tampered((p) => { p.ops[0].page_id = w.id.demos; })), /not the hub page/);
  assert.equal(checkArchivePlan({}, config).ok, false);

  const bad = structuredClone(plan);
  bad.ops[2].id = 'f'.repeat(32);
  const mark = w.fake.requests.length;
  await assert.rejects(applyArchive({ plan: bad, dir: tmp('archive-apply'), client: w.client, config }), (e) => e instanceof ArchiveError && e.problems.length > 0 && /refused/.test(e.message));
  assert.equal(w.fake.requests.length, mark, 'a refused plan sends nothing, not even a read');
});

test('planArchive refuses two Archive pages and an empty config; a plan over placeholders has nothing to move', async () => {
  const w = await world();
  const config = loadConfig(w.root);
  const snapshot = await snapshotRoot({ client: w.client, config });
  const doubled = structuredClone(snapshot);
  doubled.archive = { id: null, via: null, matches: ['a'.repeat(32), 'b'.repeat(32)] };
  assert.throws(() => planArchive({ config, snapshot: doubled }), (e) => e instanceof ArchiveError && /2 pages under the hub are titled/.test(e.message));
  const empty = structuredClone(snapshot);
  empty.objects = empty.objects.map((o) => ({ ...o, state: 'not_set', id: null }));
  assert.throws(() => planArchive({ config, snapshot: empty }), /nothing to move/);
});

// ---- the gate on the build --------------------------------------------------------------------------------------------------------------------

// every step of setup that builds or writes, but archive itself (the commands with `setup: true`)
const GATED_STEPS = ['pages', 'databases', 'views', 'hub', 'build', 'rulebook', 'claims', 'seed-audit', 'migrate-decisions', 'rubric', 'canaries', 'settings', 'all'];
const FIRST_BUILD_WORDS = "the first build's tables are still on the hub page; run setup.mjs archive first (P9)";

test('every step but archive refuses with exit 2 while setup/archive.json is not "done" or cannot be read; "done" lets them through to their own work', async () => {
  const w = await world();
  mkdirSync(join(w.root, 'setup'), { recursive: true });
  const file = join(w.root, 'setup', 'archive.json');
  writeFileSync(file, `${JSON.stringify({ state: 'moving' })}\n`);
  const before = w.fake.requests.length;
  for (const name of GATED_STEPS) {
    const r = await w.run([name]);
    assert.equal(r.code, 2, name);
    assert.match(r.err[0], new RegExp(`setup ${name}: the archive stopped halfway \\(setup/archive\\.json says state "moving"\\); run setup\\.mjs archive again`), name);
  }
  assert.equal(w.fake.requests.length, before, 'no request');
  writeFileSync(file, '{ not json');
  for (const name of ['build', 'claims', 'rubric']) {
    const unreadable = await w.run([name]);
    assert.equal(unreadable.code, 2, name);
    assert.match(unreadable.err[0], /cannot be read/, name);
  }
  writeFileSync(file, `${JSON.stringify({ state: 'done' })}\n`);
  for (const name of ['build', 'rulebook', 'claims']) {
    const through = await w.run([name]);
    assert.doesNotMatch(through.text, /archive stopped halfway|run setup\.mjs archive first/, `${name}: done lets the step through to its own work`);
  }
});

test('with no setup/archive.json and the first build named in config.json, every step but archive refuses with exit 2 and sends nothing; archive itself still plans; a rerun of the real archive opens the gate', async () => {
  const w = await world();
  assert.equal(existsSync(join(w.root, 'setup', 'archive.json')), false);
  const before = w.fake.requests.length;
  for (const name of GATED_STEPS) {
    const r = await w.run([name]);
    assert.equal(r.code, 2, name);
    assert.equal(r.err[0], `setup ${name}: ${FIRST_BUILD_WORDS}`, name);
  }
  assert.equal(w.fake.requests.length, before, 'no request, not even a read');
  // the same with the state file of the first build, which has no mark that a build passed the gate (the live state)
  mkdirSync(join(w.root, 'runs', 'builder'), { recursive: true });
  writeFileSync(join(w.root, 'runs', 'builder', 'state.json'), `${JSON.stringify({ pages: {}, tables: {}, updated_at: '2026-10-15T00:00:00Z' })}\n`);
  for (const name of ['build', 'all', 'claims', 'rubric']) assert.equal((await w.run([name])).err[0], `setup ${name}: ${FIRST_BUILD_WORDS}`, name);
  // the archive step is not held back by it
  const plan = await w.run(['archive', '--plan-only']);
  assert.equal(plan.code, 0, plan.text);
  const done = await w.run(['archive']);
  assert.equal(done.code, 0, done.text);
  assert.doesNotMatch((await w.run(['build'])).text, /run setup\.mjs archive first/, 'once archive.json is "done" the gate is open');
});

test('archiveFirst: true only without archive.json, with a real id among the eight old objects and no build mark in runs/builder/state.json', async () => {
  const w = await world();
  const config = loadConfig(w.root);
  assert.equal(archiveFirst(w.root, config), true, 'the first build is still on the hub');
  const placeholders = placeholderConfig();
  assert.equal(archiveFirst(w.root, placeholders), false, 'a config of placeholders has nothing to archive (the page of the proposal exists before any setup and does not count)');
  const justTables = structuredClone(placeholders);
  justTables.notion.pages.proposal = '<setup>';
  justTables.notion.claims.database_id = normId(w.id.claims);
  assert.equal(archiveFirst(w.root, justTables), true, 'one old table is enough');
  const justPages = structuredClone(config);
  justPages.notion.rulebook.database_id = justPages.notion.rulebook.data_source_id = justPages.notion.claims.database_id = justPages.notion.claims.data_source_id = '<setup>';
  for (const k of ['tag_decisions', 'rule_changes', 'agent_settings']) justPages.notion.databases[k].database_id = justPages.notion.databases[k].data_source_id = '<setup>';
  assert.equal(archiveFirst(w.root, justPages), false, 'old pages without old tables hold nothing a build would write into');
  mkdirSync(join(w.root, 'runs', 'builder'), { recursive: true });
  writeFileSync(join(w.root, 'runs', 'builder', 'state.json'), `${JSON.stringify({ archive_checked: true })}\n`);
  assert.equal(archiveFirst(w.root, config), false, 'tables recorded by a build that passed the gate are this install\'s own');
  writeFileSync(join(w.root, 'runs', 'builder', 'state.json'), '{ not json');
  assert.equal(archiveFirst(w.root, config), true, 'a state file that cannot be read gives no such proof');
  writeFileSync(join(w.root, 'runs', 'builder', 'state.json'), `${JSON.stringify({ archive_checked: true })}\n`);
  mkdirSync(join(w.root, 'setup'), { recursive: true });
  writeFileSync(join(w.root, 'setup', 'archive.json'), `${JSON.stringify({ state: 'moving' })}\n`);
  assert.equal(archiveFirst(w.root, config), false, 'with a file the state it holds decides, not this check');
});

test('a fresh install (a config of placeholders, no archive.json) builds, and its own tables do not hold back the steps after the build', async () => {
  const w = newWorld({ structure: 'fresh' });
  assert.equal(openBuilder({ root: w.root, reason: SESSION_REASON }).ok, true);
  assert.equal(archiveFirst(w.root, loadConfig(w.root)), false);
  const built = await w.run(['build']);
  assert.equal(built.code, 0, built.text);
  assert.equal(existsSync(join(w.root, 'setup', 'archive.json')), false, 'no archive was ever made');
  assert.equal(readJson(join(w.root, 'runs', 'builder', 'state.json')).archive_checked, true, 'the build records that it passed the gate');
  const inputs = writeInputs(join(w.root, 'inputs'));
  const rows = await w.run(['rulebook', '--from', inputs.taxonomy]);
  assert.equal(rows.code, 0, rows.text);
  assert.doesNotMatch(rows.text, /run setup\.mjs archive first/);
});

test('linksBack: the first line of the Archive page links to the hub by the hub page\'s id, whatever form Notion writes the address in', () => {
  const hub = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const dashed = 'A1B2C3D4-E5F6-0718-293A-4B5C6D7E8F90';
  const line = (href, content = HUB_TITLE) => ({
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: 'Archived on 27 Oct 2026. The live tables are on the hub: ' }, plain_text: 'Archived on 27 Oct 2026. The live tables are on the hub: ' }, { type: 'text', text: { content, link: href ? { url: href } : null }, plain_text: content, href }, { type: 'text', text: { content: '.' }, plain_text: '.' }] },
  });
  assert.equal(linksBack(line(`https://www.notion.so/${hub}`), hub), true, 'the address as written');
  assert.equal(linksBack(line(`/${hub}`), hub), true, 'a relative address');
  assert.equal(linksBack(line(`https://app.notion.com/p/claim-tagger-${hub}`), hub), true, 'an app.notion.com/p/<slug>-<id> address');
  assert.equal(linksBack(line(`https://www.notion.so/Claim-tagger-${dashed}`), hub), true, 'dashes and capitals do not matter');
  assert.equal(linksBack(line(`https://www.notion.so/${hub}?pvs=4`), hub), true, 'a query after the id');
  assert.equal(linksBack(line(`/${'f'.repeat(32)}`), hub), false, 'another page');
  assert.equal(linksBack(line(null), hub), false, 'no link at all');
  assert.equal(linksBack(line(`/${hub}`, 'the hub'), hub), false, 'the link is on other words than the hub\'s title');
  assert.equal(linksBack({ type: 'heading_1' }, hub), false);
  // a link written only in text.link.url (the request shape) counts too
  const requestShape = line(null);
  requestShape.paragraph.rich_text[1].text.link = { url: `/${hub}` };
  assert.equal(linksBack(requestShape, hub), true);
  const notFirst = line(`/${hub}`);
  notFirst.paragraph.rich_text[0].plain_text = 'Something else. ';
  notFirst.paragraph.rich_text[0].text.content = 'Something else. ';
  assert.equal(linksBack(notFirst, hub), false, 'the line must be the archive page\'s own first line');
});

test('the Archive page holds the link back, what it holds, and the warning that its tables share names with the live ones (ED-9)', async () => {
  const w = await world();
  const r = await w.run(['archive']);
  assert.equal(r.code, 0, r.text);
  const blocks = await w.client.retrieveBlockChildren(w.archiveRecord().archive_page);
  const text = (b) => (b[b.type]?.rich_text ?? []).map((x) => x.plain_text).join('');
  assert.match(text(blocks[0]), /^Archived on 27 Oct 2026\. The live tables are on the hub: Claim tagger\.$/);
  assert.match(text(blocks[1]), /^This page holds the first build/);
  assert.equal(text(blocks[2]), 'The tables here share names with the live ones and do nothing now; use the hub.');
  assert.equal(ARCHIVE_WARNING, text(blocks[2]));
});

// ---- build does not adopt what was archived ----------------------------------------------------------------------------------------------

// A small world for runStructure: the pages fake, a hub, the structure of the live build, and a state folder.
async function buildWorld() {
  const root = tmp('archive-build');
  const fake = createPagesFake();
  const hub = fake.addPage({ title: 'Claim tagger' });
  const client = builderClient(fake);
  const config = testConfig({ parent: hub });
  const plan = planStructure(forFake(revisedStructure()), config);
  const leave = async (title) => (await client.createDatabase({ parentPageId: hub, title, isInline: true, properties: COLUMNS }));
  return { root, fake, hub, client, config, plan, leave };
}
const writeArchiveFile = (root, content) => {
  mkdirSync(join(root, 'setup'), { recursive: true });
  writeFileSync(join(root, 'setup', 'archive.json'), `${JSON.stringify(content)}\n`);
};

test('buildDatabases does not adopt an archived "Tag decisions" left on the root: it counts as not found and a new table is made; without the file it is adopted', async () => {
  const w = await buildWorld();
  const old = await w.leave('Tag decisions');
  writeArchiveFile(w.root, { state: 'done', archive_page: 'a'.repeat(32), tables: [{ key: 'tag_decisions', database_id: normId(old.id), data_source_id: normId(old.data_sources[0].id) }], moved: [], practice_pages: [] });
  const result = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config, parts: ['databases'] });
  assert.equal(result.ok, true, JSON.stringify(result.stopped));
  assert.equal(result.databases.tag_decisions.status, 'created');
  assert.notEqual(normId(result.databases.tag_decisions.database_id), normId(old.id));
  assert.equal(w.fake.outline(w.hub).filter((o) => o === 'database|Tag decisions').length, 2, 'the archived table is still there, and a new one beside it');

  const control = await buildWorld();
  const kept = await control.leave('Tag decisions');
  const adopted = await runStructure({ plan: control.plan, client: control.client, root: control.root, config: control.config, parts: ['databases'] });
  assert.equal(adopted.ok, true, JSON.stringify(adopted.stopped));
  assert.equal(adopted.databases.tag_decisions.status, 'adopted', 'with no archive.json the same table is adopted, as before');
  assert.equal(adopted.databases.tag_decisions.database_id, normId(kept.id));
});

test('buildDatabases and buildPages skip a protected child and an archived page; two unarchived tables with the title are still "more than one"', async () => {
  const guarded = await buildWorld();
  const old = await guarded.leave('Rule changes');
  guarded.config.notion.protected_database_ids.push(normId(old.id));
  const made = await runStructure({ plan: guarded.plan, client: guarded.client, root: guarded.root, config: guarded.config, parts: ['databases'] });
  assert.equal(made.ok, true, JSON.stringify(made.stopped));
  assert.equal(made.databases.rule_changes.status, 'created', 'a protected table is not adopted');

  const pages = await buildWorld();
  const archivedDemos = (await pages.client.createPageUnderPage({ parentPageId: pages.hub, title: 'Demos' })).id;
  writeArchiveFile(pages.root, { state: 'done', archive_page: 'a'.repeat(32), moved: [{ key: 'demos', kind: 'page', id: normId(archivedDemos) }], tables: [], practice_pages: [] });
  const built = await runStructure({ plan: pages.plan, client: pages.client, root: pages.root, config: pages.config, parts: ['pages'] });
  assert.equal(built.ok, true, JSON.stringify(built.stopped));
  assert.equal(built.pages.demos.status, 'created', 'an archived page is not adopted');
  assert.notEqual(built.pages.demos.id, normId(archivedDemos));

  const twice = await buildWorld();
  await twice.leave('Tag decisions');
  await twice.leave('Tag decisions');
  const third = await twice.leave('Tag decisions');
  writeArchiveFile(twice.root, { state: 'done', archive_page: 'a'.repeat(32), tables: [{ key: 'tag_decisions', database_id: normId(third.id), data_source_id: normId(third.data_sources[0].id) }], moved: [], practice_pages: [] });
  const stopped = await runStructure({ plan: twice.plan, client: twice.client, root: twice.root, config: twice.config, parts: ['databases'] });
  assert.equal(stopped.ok, false);
  assert.match(stopped.stopped.message, /more than one table titled "Tag decisions"/);
});

// ---- the walk, the config change, the fake ------------------------------------------------------------------------------------------------

test('walkArchiveTree: GET only; the practice pages, their tables and data sources, the old tables and views; a failed read is recorded and the walk goes on', async () => {
  const w = await world();
  const config = loadConfig(w.root);
  const before = w.fake.requests.length;
  const walk = await walkArchiveTree({ client: w.client, config });
  assert.ok(since(w, before).every((q) => q.method === 'GET'));
  assert.deepEqual(walk.practice_pages.map((p) => [p.title, p.under, p.tables.length]), [['Practice page 1', 'demos', 5], ['Practice page 2', 'demos', 5], ['Test run 1', 'demo_tests', 5]]);
  assert.deepEqual(walk.practice_pages[0].tables.map((t) => t.title), TABLE_KEYS.map((k) => TITLES[k]));
  assert.ok(walk.practice_pages.flatMap((p) => p.tables).every((t, i) => t.id === normId(w.practice.flatMap((p) => p.tables)[i].database_id) && t.data_source_id === normId(w.practice.flatMap((p) => p.tables)[i].data_source_id)));
  assert.deepEqual(walk.tables.map((t) => t.key), TABLE_KEYS);
  assert.deepEqual(walk.views.map((v) => v.key), ['your_queue', 'rulebook']);
  assert.deepEqual(walk.errors, []);

  const broken = w.practice[1].tables[2];
  w.fake.failNext('GET', new RegExp(`^/databases/${broken.database_id}$`), 404, 1);
  w.fake.failNext('GET', new RegExp(`^/blocks/${w.id.demo_tests}/children`), 404, 1);
  const partial = await walkArchiveTree({ client: w.client, config });
  assert.equal(partial.errors.length, 2);
  assert.match(partial.errors[0].what, /the table "Tag decisions" on the practice page "Practice page 2"/);
  assert.match(partial.errors[1].what, /the practice pages under demo_tests/);
  assert.equal(partial.practice_pages.length, 2, 'the pages under Demos are still listed');
  assert.equal(partial.practice_pages[1].tables.find((t) => t.title === 'Tag decisions').data_source_id, null);
  assert.equal(partial.practice_pages[1].tables.length, 5);
});

test('archiveConfigChange: pages, placeholders, no views, protected lists grown without repeats; nothing else changes; the result validates and the input is untouched', async () => {
  const w = await world();
  const config = loadConfig(w.root);
  const frozen = structuredClone(config);
  const archive = {
    archive_page: 'ab'.repeat(16),
    moved: KEYS.map((key, i) => ({ key, kind: i < 3 ? 'page' : 'database', id: w.id[key], ...(i < 3 ? {} : { data_source_id: normId(w.tables[key].data_source_id) }) })),
    practice_pages: w.practice.map((p) => ({ id: normId(p.id), tables: p.tables.map((t) => ({ id: normId(t.database_id), data_source_id: normId(t.data_source_id) })) })),
    tables: TABLE_KEYS.map((key) => ({ key, database_id: w.id[key], data_source_id: normId(w.tables[key].data_source_id) })),
  };
  const next = archiveConfigChange(config, archive);
  assert.deepEqual(config, frozen, 'the config passed in is not changed');
  assert.deepEqual(next.notion.pages, { onboarding: '<setup>', archive: archive.archive_page, proposal: '<archived>', demos: '<archived>', demo_tests: '<archived>' });
  assert.deepEqual(next.notion.views, {});
  assert.equal(next.notion.rulebook.database_id, '<setup>');
  assert.equal(next.notion.databases.agent_settings.data_source_id, '<setup>');
  assert.equal(next.notion.claims.key, 'Geo ID', 'the rest of an entry is kept');
  const all = [...next.notion.protected_database_ids, ...next.notion.protected_page_ids].map(normId);
  assert.equal(new Set(all).size, all.length, 'no id twice');
  const again = archiveConfigChange(next, archive);
  assert.deepEqual(again, next, 'applying it twice changes nothing');
  assert.throws(() => archiveConfigChange(config, {}), (e) => e instanceof ArchiveError && /no Archive page/.test(e.message));
  assert.deepEqual(next.agent, config.agent);
  assert.deepEqual(next.judge, config.judge);
});

test('the pages fake: a page move and a table re-parent take the child block to the new parent, a title update shows in the list, position places blocks, and the checks hold', async () => {
  const fake = createPagesFake();
  const hub = fake.addPage({ title: 'Hub' });
  const client = builderClient(fake);
  const a = await client.createPageUnderPage({ parentPageId: hub, title: 'A' });
  const b = await client.createPageUnderPage({ parentPageId: hub, title: 'B' });
  const t = await client.createDatabase({ parentPageId: hub, title: 'T', isInline: true, properties: COLUMNS });
  assert.deepEqual(fake.outline(hub), ['child_page|A', 'child_page|B', 'database|T']);

  const moved = await client.movePage(a.id, { parentPageId: b.id });
  assert.equal(normId(moved.parent.page_id), normId(b.id));
  assert.deepEqual(fake.outline(hub), ['child_page|B', 'database|T']);
  assert.deepEqual(fake.outline(b.id), ['child_page|A']);
  assert.equal(normId((await client.retrievePage(a.id)).parent.page_id), normId(b.id));
  const reparented = await client.moveDatabase(t.id, { parentPageId: b.id });
  assert.equal(normId(reparented.parent.page_id), normId(b.id));
  assert.deepEqual(fake.outline(b.id), ['child_page|A', 'database|T']);
  assert.equal(normId((await client.retrieveDatabase(t.id)).parent.page_id), normId(b.id));
  assert.deepEqual((await client.retrieveBlockChildren(hub)).map((x) => x.id), [b.id], 'the hub lists what is left, by id');

  // a move to the parent it has changes nothing
  await client.movePage(a.id, { parentPageId: b.id });
  assert.deepEqual(fake.outline(b.id), ['child_page|A', 'database|T']);
  assert.deepEqual(fake.moves().map((m) => m.kind), ['page', 'database'], 'and is no new move');

  // an unknown new parent or object is a 404; a page cannot go under itself or its own sub-page
  const nobody = '0a9e0000-0000-4000-8000-0000000fffff';
  await assert.rejects(client.movePage(a.id, { parentPageId: nobody }), (e) => e.status === 404 && e.code === 'object_not_found');
  await assert.rejects(client.moveDatabase(t.id, { parentPageId: nobody }), (e) => e.status === 404);
  await assert.rejects(client.movePage(nobody, { parentPageId: b.id }), (e) => e.status === 404);
  await assert.rejects(client.moveDatabase(nobody, { parentPageId: b.id }), (e) => e.status === 404);
  await assert.rejects(client.movePage(b.id, { parentPageId: a.id }), (e) => e.status === 400 && /own sub-pages/.test(e.message));
  await assert.rejects(client.movePage(b.id, { parentPageId: b.id }), (e) => e.status === 400);

  // the raw request: old version, extra keys, a bad parent
  const call = (method, path, body, version = '2026-03-11') => fake.fetchImpl(`${API_BASE}${path}`, {
    method, headers: { Authorization: `Bearer ${fake.token}`, 'Notion-Version': version, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const parent = { type: 'page_id', page_id: hub };
  assert.equal((await call('POST', `/pages/${a.id}/move`, { parent }, '2022-06-28')).status, 400);
  assert.equal((await call('PATCH', `/databases/${t.id}`, { parent }, '2022-06-28')).status, 400);
  assert.equal((await call('PATCH', `/databases/${t.id}`, { parent, in_trash: true })).status, 400);
  assert.equal((await call('PATCH', `/databases/${t.id}`, { parent, is_inline: true })).status, 400);
  assert.equal((await call('POST', `/pages/${a.id}/move`, { parent: { type: 'workspace', workspace: true } })).status, 400);
  assert.equal((await call('POST', `/pages/${a.id}/move`, { parent, archived: true })).status, 400);
  assert.equal((await fake.fetchImpl(`${API_BASE}/pages/${a.id}/move`, { method: 'POST', headers: { 'Notion-Version': '2026-03-11' }, body: '{}' })).status, 401);
  const ok = await call('POST', `/pages/${a.id}/move`, { parent });
  assert.equal(ok.status, 200);
  assert.equal(fake.requests.at(-1).status, 200, 'the request log says what happened');
  assert.deepEqual(fake.outline(hub).slice(-1), ['child_page|A']);
  await client.movePage(a.id, { parentPageId: b.id });

  // failNext works for a move: the client retries a 500 and the second attempt lands
  const mark = fake.requests.length;
  fake.failNext('POST', /\/move$/, 500, 1);
  await client.movePage(a.id, { parentPageId: hub });
  assert.deepEqual(fake.requests.slice(mark).map((q) => q.status), [500, 200]);
  assert.equal(normId(fake.parentOf(a.id).page_id), normId(hub));

  // a new title shows where the parent lists the page
  await client.updatePage(a.id, { properties: { title: { title: [{ type: 'text', text: { content: 'A renamed' } }] } } });
  assert.ok(fake.outline(hub).includes('child_page|A renamed'));
  assert.equal((await client.retrieveBlockChildren(hub)).find((x) => x.id === a.id).child_page.title, 'A renamed');

  // position on an append
  const old = restClient(fake);
  const p = (text) => paragraph(text);
  await client.appendBlocks(hub, [p('first')], { position: { type: 'start' } });
  assert.equal(fake.outline(hub)[0], 'paragraph|first');
  await client.appendBlocks(hub, [p('second')], { position: { type: 'after_block', after_block: { id: (await client.retrieveBlockChildren(hub))[0].id } } });
  assert.deepEqual(fake.outline(hub).slice(0, 2), ['paragraph|first', 'paragraph|second']);
  await client.appendBlocks(hub, [p('last')], { position: { type: 'end' } });
  assert.equal(fake.outline(hub).at(-1), 'paragraph|last');
  await old.appendBlocks(hub, [p('old style')], { position: { type: 'after_block', after_block: { id: (await client.retrieveBlockChildren(hub))[1].id } } });
  assert.deepEqual(fake.outline(hub).slice(0, 3), ['paragraph|first', 'paragraph|second', 'paragraph|old style']);
  const blockId = (await client.retrieveBlockChildren(hub))[0].id;
  assert.equal((await call('PATCH', `/blocks/${hub}/children`, { children: [p('x')], after: blockId })).status, 400, 'the flat after is refused from 2026-03-11');
  assert.equal((await call('PATCH', `/blocks/${hub}/children`, { children: [p('x')], position: { type: 'start' } }, '2022-06-28')).status, 400, 'position is refused before it');
  assert.equal((await call('PATCH', `/blocks/${hub}/children`, { children: [p('x')], position: { type: 'start' }, after: blockId })).status, 400, 'both together are refused');
  assert.equal((await call('PATCH', `/blocks/${hub}/children`, { children: [p('x')], position: { type: 'after_block', after_block: { id: nobody } } })).status, 400);
  assert.equal((await call('PATCH', `/blocks/${hub}/children`, { children: [p('x')], position: { type: 'middle' } })).status, 400);
});

// ---- the source and the usage ----------------------------------------------------------------------------------------------------------------

test('setup.mjs shows archive in its usage; the archive step reaches Notion only through the client; only archive.mjs calls the two moves; nothing deletes or trashes', async () => {
  assert.match(USAGE, /setup\.mjs archive \[--plan-only\]/);
  const w = newWorld();
  const unknown = await w.run(['frobnicate']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err.join('\n'), /setup\.mjs archive \[--plan-only\]/);
  const help = await w.run(['archive', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.out.join('\n'), /setup\.mjs archive \[--plan-only\]/);

  const scripts = join(import.meta.dirname, '..', '..', 'agents', 'claim-tagger-mvp', 'scripts');
  for (const file of ['setup.mjs', 'lib/archive.mjs']) {
    const src = readFileSync(join(scripts, file), 'utf8');
    assert.doesNotMatch(src, /\bfetch\s*\(|loadEnvFile|process\.env\.NOTION|readFileSync\([^)]*\.env\b/, `${file} reaches Notion or the token on its own`);
    assert.doesNotMatch(src, /'DELETE'|"DELETE"|in_trash|archived\s*:|is_archived/, `${file} deletes, trashes or archives through a field`);
    assert.doesNotMatch(src, /--bare|--fallback-model/, `${file} passes a flag the rules forbid`);
  }
  const callers = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.mjs') && /\.(movePage|moveDatabase)\(/.test(readFileSync(full, 'utf8'))) callers.push(full.slice(scripts.length + 1).replace(/\\/g, '/'));
    }
  };
  walk(scripts);
  assert.deepEqual(callers, ['lib/archive.mjs'], 'the two moves are called from the archive step and nowhere else');
});
