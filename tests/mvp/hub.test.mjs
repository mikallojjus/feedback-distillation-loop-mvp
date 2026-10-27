import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHIVE_TITLE, verifyArchive } from '../../agents/claim-tagger-mvp/scripts/lib/archive.mjs';
import { TABLES } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import {
  HUB_LINK_TEXT, StructureError, hubDifferences, hubPlan, planStructure, readHub, runStructure, validateStructure, verifyStructure, withGeoOptions,
} from '../../agents/claim-tagger-mvp/scripts/lib/notion-build.mjs';
import { normId } from '../../agents/claim-tagger-mvp/scripts/lib/notion-values.mjs';
import { openBuilder } from '../../agents/claim-tagger-mvp/scripts/setup.mjs';
import { builderClient, cleanTmp, forFake, freshStructure, freshStructureBeforeOptions, newWorld, readAuditFile, readJson, revisedStructure, makePick, writeInputs, SPACE_NAMES, tmp } from './helpers/setup-world.mjs';

// The hub (decisions P9 to P11): the structure's hub block, the tables built as full-page tables in the order of the hub, the pages after them, the link lines at the top of the hub page, and
// the report of what else is on the page. Everything runs against the fake that keeps child pages and tables among a page's blocks.

after(cleanTmp);

const paragraph = (content) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } });
const LINKS = ['Your queue', 'Needs your note', 'Lessons waiting'].map((name) => `${name}: ${HUB_LINK_TEXT[name.toLowerCase().replace(/ /g, '_')]}`);
const TABLE_TITLES = ['Claims', 'Rulebook', 'Rule changes', 'Tag decisions', 'Agent settings'];

/** A fresh world (the hub page called Claim tagger), the plan from the fresh structure, a builder client. */
function world() {
  const w = newWorld({ structure: 'fresh' });
  const structure = forFake(freshStructure());
  const plan = planStructure(structure, w.config);
  return { ...w, structure, plan, client: builderClient(w.fake) };
}
const run = (w, extra = {}) => runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config, ...extra });
const outline = (w) => w.fake.outline(w.parent);
const label = (q) => {
  if (q.method === 'POST' && q.path === '/databases') return `table ${q.body.title[0].text.content}`;
  if (q.method === 'POST' && q.path === '/pages') return `page ${q.body.properties.title.title[0].text.content}`;
  if (q.method === 'POST' && q.path === '/views') return 'view';
  if (q.method === 'PATCH' && q.path.startsWith('/data_sources/')) return 'columns';
  if (q.method === 'PATCH' && /^\/blocks\/[^/]+\/children$/.test(q.path)) return 'blocks';
  return null;
};
const sequence = (w) => w.fake.requests.filter((q) => q.method !== 'GET' && !/\/query$/.test(q.path)).map(label);

// ---- the structure's hub block ---------------------------------------------------------------------------------------------------------------

test('the fresh structure file is valid: made from the specification, Onboarding the only page, no retired column and no rename anywhere, the hub block as specified', () => {
  const s = readJson(join(import.meta.dirname, '..', '..', 'agents', 'claim-tagger-mvp', 'setup', 'structure.json'));
  assert.equal(validateStructure(s), s);
  assert.equal(s.made_from, 'docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md (P10-P12)');
  assert.deepEqual(s.pages, ['Onboarding']);
  assert.deepEqual(s.hub, { title: 'Claim tagger', view_links: ['your_queue', 'needs_your_note', 'lessons_waiting'], table_order: ['claims', 'rulebook', 'rule_changes', 'tag_decisions', 'agent_settings'], pages_after: ['onboarding', 'archive'] });
  assert.deepEqual(Object.values(s.tables).map((t) => t.title), ['Rulebook', 'Claims', 'Tag decisions', 'Rule changes', 'Agent settings']);
  for (const t of Object.values(s.tables)) for (const c of t.columns) assert.ok(c.retired === undefined && c.renamed_from === undefined && !/\(old\)/.test(c.name), `${t.title}.${c.name}`);
  for (const v of s.views) assert.ok(v.renamed_from === undefined && !v.columns.some((c) => /\(old\)/.test(c)), v.name);
  assert.deepEqual(s.views.map((v) => v.name), ['Your queue', 'Needs your note', 'Agent disagreed', 'Your queue (ledger)', 'Needs your note (ledger)', 'Lessons waiting', 'Rulebook']);
  // the Claims columns, in this order
  assert.deepEqual(s.tables.claims.columns.map((c) => c.name), [
    'Geo Name', 'Agent tags', 'Agent confidence', 'Agent reasons', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks', 'Agent reading',
    'Verified tags', 'Review status', 'Challenged tags notes', 'Geo ID', 'Geo URL', 'Geo Space', 'Geo Created', 'Geo Sources', 'Geo Is factual', 'Geo Tags', 'Geo Topics',
  ]);
  const column = (name) => s.tables.claims.columns.find((c) => c.name === name);
  assert.deepEqual([column('Geo Space').type, column('Geo Space').options], ['select', SPACE_NAMES]);
  assert.equal(column('Geo Created').type, 'date');
  assert.equal(column('Geo Is factual').type, 'checkbox');
  // Geo Tags holds the committed pick's tag names once structure --options-from has run on it, and the option Debate only before there is a pick
  const pickFile = join(import.meta.dirname, '..', '..', 'agents', 'claim-tagger-mvp', 'setup', 'geo-claims-pick.json');
  const tagNames = existsSync(pickFile) ? readJson(pickFile).tag_names : ['Debate'];
  assert.deepEqual([column('Geo Tags').type, column('Geo Tags').options], ['multi_select', tagNames], 'the structure and the committed pick agree on the Geo Tags options');
  for (const v of s.views.filter((x) => x.table === 'claims')) assert.equal(v.columns[1], 'Geo Space', `${v.name} shows Geo Space after Geo Name`);
  assert.ok(!s.views.filter((x) => x.table !== 'claims').some((v) => v.columns.includes('Geo Space')));
});

test('a structure without a hub block stays valid and builds as it did: the fixtures of the earlier builds', () => {
  for (const file of ['structure.16-oct.json', 'structure.21-oct.json', 'structure.22-oct.json']) {
    const s = readJson(join(import.meta.dirname, 'fixtures', file));
    assert.equal(s.hub, undefined, file);
    assert.equal(validateStructure(s), s, file);
    assert.equal(hubPlan(s), null, file);
  }
  assert.equal(validateStructure(revisedStructure()).made_from, undefined);
});

test('validateStructure checks the hub block and made_from', () => {
  const bad = (change, re) => {
    const s = freshStructure();
    change(s);
    assert.throws(() => validateStructure(s), (e) => e instanceof StructureError && re.test(e.message), re.source);
  };
  bad((s) => { s.hub = 'links'; }, /hub must be an object/);
  bad((s) => { s.hub.title = ''; }, /hub: title must be the name of the hub page/);
  bad((s) => { s.hub.colour = 'blue'; }, /hub: "colour" is not part of the hub block/);
  bad((s) => { s.hub.view_links = ['your_queue', 'nope']; }, /hub: view_links names "nope", which is not the key of a view/);
  bad((s) => { s.hub.view_links = []; }, /hub: view_links must be a list of names/);
  bad((s) => { s.hub.view_links = ['your_queue', 'your_queue']; }, /hub: view_links names something twice/);
  bad((s) => { s.hub.table_order = ['claims', 'rulebook']; }, /hub: table_order must name each of the five tables once/);
  bad((s) => { s.hub.table_order = ['claims', 'rulebook', 'rule_changes', 'tag_decisions', 'claims']; }, /hub: table_order names something twice|must name each of the five tables once/);
  bad((s) => { s.hub.pages_after = ['archive']; }, /hub: pages_after does not place the page "onboarding"/);
  bad((s) => { s.hub.pages_after = ['onboarding', 'ghost', 'archive']; }, /hub: pages_after names "ghost", which is neither "archive" nor one of the pages \(onboarding\)/);
  bad((s) => { s.made_from = ''; }, /made_from must be text/);
  bad((s) => { s.made_from = 3; }, /made_from must be text/);
});

test('hubPlan: the three link lines with their words, the tables and pages by their titles; Archive is not a page of the structure', () => {
  const plan = hubPlan(freshStructure());
  assert.deepEqual(plan.view_links.map((l) => l.text), LINKS);
  assert.deepEqual(plan.view_links.map((l) => l.name), ['Your queue', 'Needs your note', 'Lessons waiting']);
  assert.deepEqual(plan.table_order, ['claims', 'rulebook', 'rule_changes', 'tag_decisions', 'agent_settings']);
  assert.deepEqual(plan.pages, { onboarding: 'Onboarding' });
  assert.equal(plan.tables.claims, 'Claims');
});

// ---- planStructure and the build order -----------------------------------------------------------------------------------------------------------

test('planStructure: production tables are full-page (is_inline false) in the order of the hub; the walkthrough\'s own plan asks for inline; a structure without a hub keeps the order of TABLES', () => {
  const w = world();
  assert.deepEqual(w.plan.databases.map((d) => d.title), TABLE_TITLES);
  assert.ok(w.plan.databases.every((d) => d.body.is_inline === false));
  assert.equal(w.plan.hub.title, 'Claim tagger');
  const inline = planStructure(w.structure, w.config, { inline: true });
  assert.ok(inline.databases.every((d) => d.body.is_inline === true));
  const old = planStructure(forFake(revisedStructure()), w.config);
  assert.deepEqual(old.databases.map((d) => d.table), [...TABLES]);
  assert.equal(old.hub, null);
  assert.ok(old.databases.every((d) => d.body.is_inline === false), 'the default is full-page for any production structure');
  assert.deepEqual(w.plan.pages, [{ key: 'onboarding', title: 'Onboarding', text: w.plan.pages[0].text }]);
});

test('runStructure with a hub block: the tables in the hub\'s order, their columns, the page Onboarding, the views, then the hub part; the tables are full-page tables', async () => {
  const w = world();
  const result = await run(w);
  assert.equal(result.ok, true, JSON.stringify(result.stopped));
  const seq = sequence(w);
  const last = (l) => seq.map((x, i) => (x === l ? i : -1)).filter((i) => i >= 0).at(-1);
  const first = (l) => seq.indexOf(l);
  const tables = TABLE_TITLES.map((t) => `table ${t}`);
  assert.deepEqual(seq.filter((x) => x?.startsWith('table ')), tables, 'the tables are made in the order of the hub');
  assert.ok(last(tables.at(-1)) < first('columns'), 'then the columns (the relations need the Rulebook)');
  assert.ok(first('columns') < first('page Onboarding'), 'then the page');
  assert.ok(first('page Onboarding') < first('view'), 'then the views');
  assert.equal(seq.filter((x) => x === 'view').length, 7);
  assert.ok(last('view') < first('blocks'), 'then the hub part');
  assert.equal(seq.filter((x) => x === 'blocks').length, 1, 'the link lines go in one request');
  assert.equal(seq.filter((x) => x === 'blocks').length + seq.filter((x) => x === 'view').length + seq.filter((x) => x?.startsWith('table ')).length + 1 + 1, seq.length, 'nothing else was sent');
  assert.ok(w.fake.requests.every((q) => q.method === 'GET' || q.method === 'POST' || q.method === 'PATCH'), 'no delete');
  const cfg = readJson(join(w.root, 'config.json')).notion;
  const databaseIds = { rulebook: cfg.rulebook.database_id, claims: cfg.claims.database_id, ...Object.fromEntries(Object.entries(cfg.databases).map(([k, v]) => [k, v.database_id])) };
  for (const t of TABLES) assert.equal(w.fake.database(databaseIds[t]).is_inline, false, `${t} is a full-page table`);
  assert.deepEqual(outline(w), [...LINKS.map((l) => `paragraph|${l}`), ...TABLE_TITLES.map((t) => `database|${t}`), 'child_page|Onboarding']);
  assert.equal(result.hub.ok, true);
  assert.deepEqual(result.hub.differences, []);
  assert.equal(result.created.hub_links, 3);
});

test('the build without a hub block is the build of before: the pages first, then the tables and the views, and nothing is added to the hub page', async () => {
  const w = newWorld({ structure: true });
  const plan = planStructure(forFake(revisedStructure()), w.config);
  const result = await runStructure({ plan, client: builderClient(w.fake), root: w.root, config: w.config });
  assert.equal(result.ok, true);
  const seq = sequence(w);
  assert.ok(seq.indexOf('page Demos') < seq.indexOf('table Rulebook copy'), 'pages, then tables');
  assert.ok(!seq.includes('blocks'), 'no hub part');
  assert.equal(result.hub, null);
  assert.equal(result.created.hub_links, undefined);
});

// ---- the hub part --------------------------------------------------------------------------------------------------------------------------------------

test('the hub part puts the three link lines at the start of the hub page once, each linked to its view; a run again adds nothing and sends no write', async () => {
  const w = world();
  await run(w);
  const blocks = w.fake.children(w.parent).slice(0, 3);
  const views = readJson(join(w.root, 'config.json')).notion.views;
  for (const [i, key] of ['your_queue', 'needs_your_note', 'lessons_waiting'].entries()) {
    const rich = blocks[i].paragraph.rich_text;
    assert.equal(rich.length, 2, 'one line: the name linked, the words after it');
    assert.equal(rich[0].plain_text, ['Your queue', 'Needs your note', 'Lessons waiting'][i]);
    assert.equal(rich[0].href, views[key].url, 'the name links to the view\'s address');
    assert.equal(rich[1].href ?? null, null);
    assert.equal(rich.map((r) => r.plain_text).join(''), LINKS[i]);
  }
  const put = w.fake.requests.filter((q) => q.method === 'PATCH' && /^\/blocks\/[^/]+\/children$/.test(q.path));
  assert.equal(put.length, 1);
  assert.deepEqual(put[0].body.position, { type: 'start' });
  assert.equal(put[0].version, '2026-03-11');
  assert.equal(put[0].body.after, undefined);

  const writes = w.fake.writes().length;
  const before = outline(w);
  const again = await run(w);
  assert.equal(again.ok, true);
  assert.equal(w.fake.writes().length, writes, 'not one write');
  assert.deepEqual(outline(w), before);
  assert.equal(again.created.hub_links, 0);
  assert.deepEqual(again.hub.added, []);
});

test('the hub part adds only the lines that are missing, at the start, and reports where the other blocks stand', async () => {
  const w = world();
  // the page already has the second line (typed by hand) and a table-less start
  await w.client.appendBlocks(w.parent, [paragraph(LINKS[1])]);
  const result = await run(w);
  assert.equal(result.created.hub_links, 2);
  assert.deepEqual(result.hub.added, [LINKS[0], LINKS[2]]);
  assert.equal(outline(w).filter((l) => l === `paragraph|${LINKS[1]}`).length, 1, 'the line that was there is not added again');
  // the added lines are first; the line that was there stays where it was, after the tables' predecessors
  assert.deepEqual(outline(w).slice(0, 2), [`paragraph|${LINKS[0]}`, `paragraph|${LINKS[2]}`]);
  assert.ok(result.hub.differences.some((d) => d.kind === 'order'), 'the hand-typed line stands out of order and is reported, not moved');
});

test('the hub part reports an archive page above the tables in plain words and moves nothing: drag it to the bottom of the page in Notion', async () => {
  const w = world();
  // setup.mjs archive has made the Archive page before the tables are built: it sits above them
  const archive = await w.client.createPageUnderPage({ parentPageId: w.parent, title: ARCHIVE_TITLE, children: [paragraph('Archived on 27 Oct 2026.')] });
  w.config.notion.pages.archive = normId(archive.id);
  const result = await run(w);
  assert.equal(result.ok, true);
  assert.equal(result.hub.ok, false);
  assert.deepEqual(result.hub.differences.map((d) => d.detail), ['the archive page sits above the tables: drag it to the bottom of the page in Notion']);
  assert.deepEqual(outline(w), [...LINKS.map((l) => `paragraph|${l}`), `child_page|${ARCHIVE_TITLE}`, ...TABLE_TITLES.map((t) => `database|${t}`), 'child_page|Onboarding'], 'the page is as it was made: nothing was moved');
  assert.equal(w.fake.moves().length, 0, 'not one move request');
  assert.ok(w.fake.requests.every((q) => !/\/move$/.test(q.path)));

  // the read-back says the same, and a rerun still sends nothing
  const read = await readHub({ client: w.client, config: w.config, hub: w.plan.hub });
  assert.deepEqual(read.differences.map((d) => d.kind), ['order']);
  const writes = w.fake.writes().length;
  await run(w);
  assert.equal(w.fake.writes().length, writes);
});

test('an archive page made after the tables is at the bottom already: the page is in order', async () => {
  const w = world();
  await run(w);
  const archive = await w.client.createPageUnderPage({ parentPageId: w.parent, title: ARCHIVE_TITLE, children: [paragraph('Archived on 27 Oct 2026.')] });
  w.config.notion.pages.archive = normId(archive.id);
  const read = await readHub({ client: w.client, config: w.config, hub: w.plan.hub });
  assert.deepEqual(read.differences, []);
  assert.deepEqual(outline(w).slice(-2), ['child_page|Onboarding', `child_page|${ARCHIVE_TITLE}`]);
});

test('the pages made before the tables stand above them: the order difference is named with the blocks as they are and as they should be', async () => {
  const w = world();
  await run(w, { parts: ['pages'] }); // Onboarding first
  const result = await run(w);
  assert.equal(result.hub.ok, false);
  const order = result.hub.differences.find((d) => d.kind === 'order');
  assert.match(order.detail, /^the blocks of the hub page are not in order: they should be .*Claims.*Onboarding, and they are .*Onboarding.*Claims.*; drag them into that order in Notion$/);
});

test('a leftover on the hub page is reported and never touched: a note somebody typed, a page nobody knows, a second copy of a link line', async () => {
  const w = world();
  await w.client.appendBlocks(w.parent, [paragraph('A note somebody typed on the hub page')]);
  const stray = await w.client.createPageUnderPage({ parentPageId: w.parent, title: "Somebody's notes", children: [paragraph('text')] });
  const result = await run(w);
  const leftovers = result.hub.leftovers.map((l) => [l.type, l.text]);
  assert.deepEqual(leftovers, [['paragraph', 'A note somebody typed on the hub page'], ['child_page', "Somebody's notes"]]);
  const details = result.hub.differences.filter((d) => d.kind === 'leftover').map((d) => d.detail);
  assert.equal(details.length, 2);
  assert.match(details[0], /^a block that is none of these is on the hub page and was left as it is: paragraph "A note somebody typed on the hub page" \([0-9a-f]{32}\); remove it by hand if it should not be there$/);
  assert.match(details[1], /child_page "Somebody's notes"/);
  assert.ok(outline(w).includes('paragraph|A note somebody typed on the hub page') && outline(w).includes("child_page|Somebody's notes"), 'both are still there');
  assert.equal(normId(stray.id).length, 32);

  // a second copy of a link line is a leftover too (the first one is the line)
  await w.client.appendBlocks(w.parent, [paragraph(LINKS[0])]);
  const again = await run(w);
  assert.ok(again.hub.differences.some((d) => /^a second copy of a link line is on the hub page and was left as it is/.test(d.detail)));
  assert.equal(outline(w).filter((l) => l === `paragraph|${LINKS[0]}`).length, 2, 'nothing was removed');
  assert.equal(again.created.hub_links, 0);
});

test('the hub part never moves, deletes or edits a block: its only write is one append at the start, and the other requests it makes are reads', async () => {
  const w = world();
  await run(w, { parts: ['pages', 'databases', 'views'] });
  const at = w.fake.requests.length;
  await run(w, { parts: ['hub'] });
  const sent = w.fake.requests.slice(at);
  const writes = sent.filter((q) => q.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PATCH');
  assert.match(writes[0].path, /^\/blocks\/[0-9a-f-]+\/children$/);
  assert.deepEqual(Object.keys(writes[0].body).sort(), ['children', 'position']);
  assert.ok(sent.every((q) => !/move|archive|trash/.test(JSON.stringify(q.body ?? {}) + q.path)));
  assert.ok(sent.filter((q) => q.method === 'GET').every((q) => /^\/(blocks\/[^/]+\/children|pages\/[^/]+)/.test(q.path)), 'it reads the page and its blocks');
});

test('a link line whose view has no address in config.json cannot be added: it is said with the way out, and the run goes on', async () => {
  const w = world();
  await run(w, { parts: ['pages', 'databases', 'views'] });
  delete w.config.notion.views.needs_your_note;
  const result = await run(w, { parts: ['hub'] });
  assert.equal(result.ok, true);
  assert.equal(result.created.hub_links, 2);
  assert.ok(result.hub.differences.some((d) => d.detail === 'the link line "Needs your note" cannot be added: config.json has no address for the view (notion.views.needs_your_note); run setup.mjs views'));
  assert.equal(result.hub.differences.filter((d) => /Needs your note/.test(d.detail)).length, 1, 'said once');
});

test('hubDifferences, pure: a missing table, a page not built yet, a block in the wrong place', () => {
  const w = world();
  const structureHub = w.plan.hub;
  const config = JSON.parse(JSON.stringify(w.config));
  const block = (type, id, text) => (type === 'paragraph' ? { id, type, paragraph: { rich_text: [{ plain_text: text }] } } : { id, type, [type]: { title: text } });
  config.notion.rulebook.database_id = 'b'.repeat(32);
  config.notion.claims.database_id = 'c'.repeat(32);
  const children = [block('paragraph', '1'.repeat(32), LINKS[0]), block('child_database', 'b'.repeat(32), 'Rulebook'), block('child_database', 'c'.repeat(32), 'Claims')];
  const { differences } = hubDifferences({ hub: structureHub, config, children });
  const text = differences.map((d) => d.detail);
  assert.ok(text.includes('the link line "Needs your note" is not on the hub page'));
  assert.ok(text.includes('the link line "Lessons waiting" is not on the hub page'));
  assert.ok(text.some((t) => /^the page "Onboarding" is not built yet \(config\.json has no id for it\); run setup\.mjs pages$/.test(t)));
  assert.ok(text.some((t) => /^the blocks of the hub page are not in order: they should be link "Your queue", Claims, Rulebook, and they are link "Your queue", Rulebook, Claims; drag them/.test(t)), text.join('\n'));
});

// ---- verify: the hub, the full-page tables and the archive ------------------------------------------------------------------------------------------

async function builtHub() {
  const w = newWorld({ structure: 'fresh' });
  assert.equal(openBuilder({ root: w.root, reason: 'test' }).ok, true);
  const r = await w.run(['build']);
  assert.equal(r.code, 0, r.text);
  return w;
}
const structureVerify = (w) => verifyStructure({ client: builderClient(w.fake), config: readJson(join(w.root, 'config.json')), structure: forFake(freshStructure()) });

test('verifyStructure with a hub block is clean for a page in order, and names the hub title when it is not "Claim tagger"', async () => {
  const w = await builtHub();
  const clean = await structureVerify(w);
  assert.deepEqual(clean.differences, []);
  assert.equal(clean.ok, true);
  await builderClient(w.fake).updatePage(w.parent, { properties: { title: { title: [{ type: 'text', text: { content: 'Feedback Distillation MVP' } }] } } });
  const named = await structureVerify(w);
  assert.equal(named.ok, false);
  assert.deepEqual(named.differences.map((d) => [d.table, d.kind]), [['hub', 'title']]);
  assert.match(named.differences[0].detail, /^the hub page is called "Feedback Distillation MVP" and should be called "Claim tagger"/);
});

test('verify is ok only when the hub page is in order: the archive page above the tables is a difference with its plain instruction', async () => {
  const w = await builtHub();
  const archive = await builderClient(w.fake).createPageUnderPage({ parentPageId: w.parent, title: ARCHIVE_TITLE, children: [paragraph('Archived on 27 Oct 2026.')] });
  // the archive page is made after the tables here, so it is at the bottom: in order
  const config = readJson(join(w.root, 'config.json'));
  config.notion.pages.archive = normId(archive.id);
  writeFileSync(join(w.root, 'config.json'), JSON.stringify(config, null, 2));
  assert.deepEqual((await structureVerify(w)).differences, []);
  // a block typed above the tables: a leftover, reported
  await builderClient(w.fake).appendBlocks(w.parent, [paragraph('Stray note')], { position: { type: 'start' } });
  const stray = await structureVerify(w);
  assert.deepEqual(stray.differences.map((d) => d.kind), ['leftover']);
  assert.equal(stray.ok, false);
  const r = await w.run(['verify', '--taxonomy', 'x', '--claims', 'x', '--audit', 'x']);
  assert.match(r.text, /hub: leftover - a block that is none of these is on the hub page/);
});

test('verifyStructure names a table that is inline instead of full-page', async () => {
  const w = newWorld({ structure: 'fresh' });
  assert.equal(openBuilder({ root: w.root, reason: 'test' }).ok, true);
  // a table of the right title made inline before the build is adopted by its title; verify says it should be a full-page table
  const client = builderClient(w.fake);
  await client.createDatabase({ parentPageId: w.parent, title: 'Claims', isInline: true, properties: { 'Geo Name': { type: 'title', title: {} } } });
  const r = await w.run(['build']);
  assert.equal(r.code, 0, r.text);
  const checked = await structureVerify(w);
  const inline = checked.differences.filter((d) => d.kind === 'inline');
  assert.deepEqual(inline.map((d) => d.table), ['claims']);
  assert.match(inline[0].detail, /^"Claims" is an inline table, but the structure builds full-page tables; turn it into a full-page table in Notion$/);
});

// verify's archive checks (the Archive page, what it holds, the protected ids), read from setup/archive.json
function archiveWorld() {
  const w = newWorld({ structure: 'fresh' });
  const client = builderClient(w.fake);
  return { w, client };
}

test('verifyArchive: nothing applies without setup/archive.json; with it done, the Archive page under the hub, its first line linking back, every moved object under it and every id protected are read back', async () => {
  const { w, client } = archiveWorld();
  const config = readJson(join(w.root, 'config.json'));
  assert.deepEqual(await verifyArchive({ client, config, root: w.root }), { applies: false, differences: [] });

  const rootUrl = `https://www.notion.so/${normId(w.parent)}`;
  const link = { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Archived on 27 Oct 2026. The live tables are on the hub: ' } }, { type: 'text', text: { content: 'Claim tagger', link: { url: rootUrl } } }, { type: 'text', text: { content: '.' } }] } };
  const archive = await client.createPageUnderPage({ parentPageId: w.parent, title: ARCHIVE_TITLE, children: [link] });
  const oldPage = await client.createPageUnderPage({ parentPageId: archive.id, title: 'Demos', children: [paragraph('x')] });
  const oldTable = await client.createDatabase({ parentPageId: archive.id, title: 'Claims copy', isInline: false, properties: { Name: { type: 'title', title: {} } } });
  const ids = { archive: normId(archive.id), page: normId(oldPage.id), table: normId(oldTable.id), source: normId(oldTable.data_sources[0].id) };
  mkdirSync(join(w.root, 'setup'), { recursive: true });
  const write = (extra = {}) => writeFileSync(join(w.root, 'setup', 'archive.json'), JSON.stringify({
    state: 'done', archive_page: ids.archive, moved: [
      { key: 'demos', kind: 'page', id: ids.page, title: 'Demos' }, { key: 'claims', kind: 'database', id: ids.table, data_source_id: ids.source, title: 'Claims copy' },
    ], practice_pages: [], tables: [], ...extra,
  }));
  write();
  const protect = (list) => {
    const c = structuredClone(config);
    c.notion.protected_page_ids.push(...list.filter((x) => [ids.archive, ids.page].includes(x)));
    c.notion.protected_database_ids.push(...list.filter((x) => [ids.table, ids.source].includes(x)));
    return c;
  };
  const good = await verifyArchive({ client, config: protect(Object.values(ids)), root: w.root });
  assert.deepEqual(good, { applies: true, differences: [] });

  // an id of archive.json that is not on the protected lists
  const open = await verifyArchive({ client, config: protect([ids.archive, ids.page]), root: w.root });
  assert.deepEqual(open.differences.map((d) => d.kind), ['protected']);
  assert.match(open.differences[0].detail, /^2 id\(s\) in setup\/archive\.json are not on the protected lists of config\.json/);

  // a moved object that is not under the Archive page (the page is back on the hub)
  const loose = await client.createPageUnderPage({ parentPageId: w.parent, title: 'Loose', children: [paragraph('x')] });
  write({ moved: [{ key: 'demos', kind: 'page', id: normId(loose.id), title: 'Demos' }] });
  const away = await verifyArchive({ client, config: protect(Object.values(ids)), root: w.root });
  assert.ok(away.differences.some((d) => d.kind === 'moved object' && d.detail.startsWith('the page "Demos" sits under') && /not under the Archive page/.test(d.detail)), JSON.stringify(away.differences));

  // an Archive page that is not under the hub, and a first line that does not link back
  const elsewhere = await client.createPageUnderPage({ parentPageId: archive.id, title: ARCHIVE_TITLE, children: [paragraph('Archived on 27 Oct 2026.')] });
  write({ archive_page: normId(elsewhere.id), moved: [] });
  const wrong = await verifyArchive({ client, config: protect([]), root: w.root });
  const kinds = wrong.differences.map((d) => d.kind);
  assert.ok(kinds.includes('archive page'));
  assert.ok(wrong.differences.some((d) => /sits under .*, not under the hub page/.test(d.detail)));
  assert.ok(wrong.differences.some((d) => d.detail === 'the first line of the Archive page does not link back to the hub page'));

  // unfinished or unreadable archive.json
  write({ state: 'moving' });
  assert.match((await verifyArchive({ client, config, root: w.root })).differences[0].detail, /says state "moving": the archive step has not finished/);
  writeFileSync(join(w.root, 'setup', 'archive.json'), '{ not json');
  assert.equal((await verifyArchive({ client, config, root: w.root })).differences[0].kind, 'archive file');
});

// ---- the options of the Geo columns ----------------------------------------------------------------------------------------------------------------

test('withGeoOptions: Geo Tags from the pick (sorted), Geo Space from the spaces; the structure is not changed; applying it twice changes nothing; empty or repeated lists are refused', () => {
  const s = freshStructureBeforeOptions();
  const r = withGeoOptions(s, { tagNames: ['Politics', 'Debate', 'Economy'], spaceNames: SPACE_NAMES });
  assert.equal(r.changed, true);
  assert.deepEqual(s.tables.claims.columns.find((c) => c.name === 'Geo Tags').options, ['Debate'], 'the original is not changed');
  assert.deepEqual(r.structure.tables.claims.columns.find((c) => c.name === 'Geo Tags').options, ['Debate', 'Economy', 'Politics']);
  assert.deepEqual(r.changes.find((c) => c.column === 'Geo Tags'), { column: 'Geo Tags', added: ['Economy', 'Politics'], removed: [], reordered: false });
  const again = withGeoOptions(r.structure, { tagNames: ['Politics', 'Debate', 'Economy'], spaceNames: SPACE_NAMES });
  assert.equal(again.changed, false);
  assert.deepEqual(again.structure, r.structure);
  assert.throws(() => withGeoOptions(s, { tagNames: [], spaceNames: SPACE_NAMES }), /there are no options to set for "Geo Tags"/);
  assert.throws(() => withGeoOptions(s, { tagNames: ['A', 'A'], spaceNames: SPACE_NAMES }), /name something twice/);
  assert.throws(() => withGeoOptions(revisedStructure(), { tagNames: ['A'], spaceNames: SPACE_NAMES }), /no column "Geo Space"/);
  const order = withGeoOptions(r.structure, { tagNames: ['Debate', 'Economy', 'Politics'], spaceNames: [...SPACE_NAMES].reverse() });
  assert.deepEqual(order.changes.find((c) => c.column === 'Geo Space'), { column: 'Geo Space', added: [], removed: [], reordered: true });
});

test('options set after the build: the table keeps the options it has, and verify names the ones it lacks (set the options before the first build)', async () => {
  const w = newWorld({ structure: 'fresh' });
  assert.equal(openBuilder({ root: w.root, reason: 'test' }).ok, true);
  assert.equal((await w.run(['build'])).code, 0);
  const inputs = writeInputs(join(tmp('hubpick'), 'in'), { pick: makePick({ audit: readAuditFile(), extra: 3 }) });
  const before = await structureVerify(w);
  assert.deepEqual(before.differences, []);
  assert.equal((await w.run(['structure', '--options-from', inputs.claims])).code, 0);
  const after = await w.run(['verify', '--taxonomy', 'x', '--claims', inputs.claims, '--audit', inputs.audit]);
  assert.match(after.text, /claims: options - "Geo Tags": missing "Economy"/, 'the table lacks the option: the build adds no option to a column that is there');
});
