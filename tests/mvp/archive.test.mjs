import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARCHIVE_TITLE, ARCHIVE_WARNING, ArchiveError, HUB_TITLE, applyArchive, archiveConfigChange, archiveFirst, archiveRewritten, archivedIds, checkArchivePlan, knownObjects, linksBack, planArchive, snapshotRoot, walkArchiveTree,
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

// ---- a real run ---------------------------------------------------------------------------------------------------------------------------

// ---- a second run ---------------------------------------------------------------------------------------------------------------------------

// ---- stops and resumes ----------------------------------------------------------------------------------------------------------------------

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

const NOT_REWRITTEN_WORDS = 'the archive step moved everything in Notion but config.json was not rewritten; run setup.mjs archive again (it sends nothing to Notion)';

test('SH-1: a "done" record that names no Archive page, or another one than config.json names, holds the steps back too; a config that cannot be read is reported by its own message', async () => {
  const w = await world();
  mkdirSync(join(w.root, 'setup'), { recursive: true });
  const file = join(w.root, 'setup', 'archive.json');
  const config = loadConfig(w.root);
  assert.equal(archiveRewritten(config, { state: 'done' }), false, 'no Archive page in the record: nothing the config could name');
  assert.equal(archiveRewritten(config, { state: 'done', archive_page: 'not an id' }), false);
  assert.equal(archiveRewritten(config, null), false);
  assert.equal(archiveRewritten({ notion: { pages: { archive: '<setup>' } } }, { archive_page: null }), false, 'two placeholders are not a match');
  assert.equal(archiveRewritten({ notion: { pages: { archive: `${'a'.repeat(8)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(12)}` } } }, { archive_page: 'a'.repeat(32) }), true, 'dashes do not matter');
  for (const record of [{ state: 'done' }, { state: 'done', archive_page: 'b'.repeat(32) }]) {
    writeFileSync(file, `${JSON.stringify(record)}\n`);
    for (const name of ['build', 'all']) {
      const r = await w.run([name]);
      assert.equal(r.code, 2, JSON.stringify(record));
      assert.equal(r.err[0], `setup ${name}: ${NOT_REWRITTEN_WORDS}`, name);
    }
  }
  writeFileSync(join(w.root, 'config.json'), '{ not json');
  const broken = await w.run(['build']);
  assert.equal(broken.code, 2);
  assert.doesNotMatch(broken.err[0], /was not rewritten/);
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
