import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHIVE_TITLE, verifyArchive } from '../../agents/claim-tagger-mvp/scripts/lib/archive.mjs';
import { TABLES, tableEntry } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import {
  HUB_LINK_TEXT, StructureError, defaultViewPlan, hubDifferences, hubPlan, ownViewName, parseViewFilter, planStructure, readHub, runStructure, validateStructure, verifyStructure, withGeoOptions,
} from '../../agents/claim-tagger-mvp/scripts/lib/notion-build.mjs';
import { claimWaits } from '../../agents/claim-tagger-mvp/scripts/lib/decisions.mjs';
import { normId } from '../../agents/claim-tagger-mvp/scripts/lib/notion-values.mjs';
import { openBuilder } from '../../agents/claim-tagger-mvp/scripts/setup.mjs';
import { builderClient, cleanTmp, forFake, freshStructure, freshStructureBeforeOptions, newWorld, readAuditFile, readJson, revisedStructure, makePick, writeInputs, SPACE_NAMES, tmp } from './helpers/setup-world.mjs';

// The hub (decisions P9 to P11): the structure's hub block, the tables built as full-page tables in the order of the hub, the pages after them, the link lines at the top of the hub page, and
// the report of what else is on the page. Everything runs against the fake that keeps child pages and tables among a page's blocks.

after(cleanTmp);

const paragraph = (content) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } });
const LINKS = ['Your queue', 'Needs your note', 'Lessons waiting'].map((name) => `${name}: ${HUB_LINK_TEXT[name.toLowerCase().replace(/ /g, '_')]}`);
// the one warning line above the link lines (P14): the structure file's own words
const NOTE = 'Claims is the real table: every decision you make there trains the rulebook. To practise, open Onboarding.';
const TOP = [NOTE, ...LINKS].map((l) => `paragraph|${l}`); // the first four blocks of a built hub page
const TABLE_TITLES = ['Claims', 'Rulebook', 'Rule changes', 'Tag decisions', 'Agent settings'];

/** A fresh world (the hub page called Claim tagger), the plan from the fresh structure, a builder client. */
function world(fakeOptions = {}) {
  const w = newWorld({ structure: 'fresh', fakeOptions });
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
  assert.deepEqual(s.hub, { title: 'Claim tagger', note: NOTE, view_links: ['your_queue', 'needs_your_note', 'lessons_waiting'], table_order: ['claims', 'rulebook', 'rule_changes', 'tag_decisions', 'agent_settings'], pages_after: ['onboarding', 'archive'] });
  assert.deepEqual(Object.values(s.tables).map((t) => t.title), ['Rulebook', 'Claims', 'Tag decisions', 'Rule changes', 'Agent settings']);
  for (const t of Object.values(s.tables)) for (const c of t.columns) assert.ok(c.retired === undefined && c.renamed_from === undefined && !/\(old\)/.test(c.name), `${t.title}.${c.name}`);
  for (const v of s.views) assert.ok(v.renamed_from === undefined && !v.columns.some((c) => /\(old\)/.test(c)), v.name);
  assert.deepEqual(s.views.map((v) => v.name), ['Your queue', 'Needs your note', 'Agent disagreed', 'Your queue (ledger)', 'Needs your note (ledger)', 'Lessons waiting'], 'six named views: the Rulebook has only its own view, called Rulebook');
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
  // the lean views (P15, ED-3): the columns of the decision, in the order the editor fills them, Review status last; Agent confidence stays the sort
  const view = (name) => s.views.find((v) => v.name === name);
  assert.deepEqual(view('Your queue').columns, ['Geo Name', 'Tags waiting', 'Agent reasons', 'Agent tags', 'Verified tags', 'Challenged tags notes', 'Review status']);
  assert.deepEqual(view('Needs your note').columns, ['Geo Name', 'Verified tags', 'Agent reading', 'Challenged tags notes', 'Review status']);
  assert.deepEqual(view('Agent disagreed').columns, ['Geo Name', 'Agent reasons', 'Agent reading', 'Verified tags', 'Challenged tags notes', 'Review status']);
  for (const name of ['Your queue', 'Needs your note', 'Agent disagreed']) assert.equal(view(name).sort, 'Agent confidence, lowest first', name);
  assert.equal(view('Your queue').filter, 'Agent status is Waits for you and Review status is not Reviewed', 'a claim leaves Your queue as soon as it is Reviewed (P13)');
  assert.ok(!s.views.some((v) => v.columns.includes('Geo Space')), 'no view shows a Geo column but Geo Name');
  // the table's own view, called and arranged by the structure (P15)
  assert.deepEqual(s.tables.claims.default_view, { name: 'All claims', columns: ['Geo Name', 'Geo Space', 'Agent tags', 'Agent status', 'Verified tags', 'Review status', 'Geo URL'] });
  assert.deepEqual(s.tables.rulebook.default_view, { name: 'Rulebook', columns: ['Name', 'Category', 'Status', 'When to use', 'Example Claims'] }, 'the table\'s own view is the Rulebook: no second view with the same five columns');
  assert.ok(!s.views.some((v) => v.table === 'rulebook'), 'and no named view of the Rulebook table');
  assert.equal(s.views.length, 6);
  assert.deepEqual(s.tables.rule_changes.default_view, { columns: ['Lesson', 'Tag', 'Status', 'Current text', 'Proposed text', 'Safety check result'] });
  assert.deepEqual(s.tables.tag_decisions.default_view, { columns: ['Claim', 'Tag', 'Agent proposal', 'Tag outcome', 'Agent reading'] });
  assert.deepEqual(s.tables.agent_settings.default_view, { columns: s.tables.agent_settings.columns.map((c) => c.name) }, 'Agent settings shows all its columns');
  assert.ok(Object.values(s.tables).every((t) => t.arrange_default_view === undefined), 'default_view takes the place of arrange_default_view');
  // one line under each table's name (ED-8)
  assert.deepEqual(Object.fromEntries(Object.entries(s.tables).map(([k, t]) => [k, t.description])), {
    claims: '200 Geo claims tagged Debate. Decide them through Your queue; every decision trains the rulebook.',
    rulebook: 'One row per tag; When to use holds the rules. Change rules through Lessons waiting.',
    rule_changes: 'Rule changes the agent drafted. The rule owner sets Approved or Rejected.',
    tag_decisions: "The agent's record, copied from Claims. Read only; never edit here.",
    agent_settings: 'Tick Paused to stop every command; untick to resume.',
  });
  // the words of the editor review (ED-1, P13)
  assert.equal(column('Verified tags').description, 'Every tag that applies, Agent tags included. A judged tag you leave out counts as Does not apply.');
  assert.match(column('Agent status').description, /Your queue lists Waits for you until you set Review status to Reviewed\.$/);
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
  // the warning line above the links (P14)
  bad((s) => { delete s.hub.note; }, /hub: note must be the one line of text above the link lines/);
  bad((s) => { s.hub.note = '  '; }, /hub: note must be the one line of text above the link lines/);
  bad((s) => { s.hub.note = 'two\nlines'; }, /hub: note must be the one line of text above the link lines/);
  bad((s) => { s.hub.note = 7; }, /hub: note must be the one line of text above the link lines/);
  // the table's own view and its description (P15, ED-8)
  bad((s) => { s.tables.claims.default_view = 'all'; }, /table "Claims": default_view must be an object/);
  bad((s) => { s.tables.claims.default_view = { columns: [] }; }, /table "Claims": default_view needs the list of columns it shows/);
  bad((s) => { s.tables.claims.default_view.columns.push('Geo Name'); }, /table "Claims": default_view lists a column twice/);
  bad((s) => { s.tables.claims.default_view.columns.push('Nope'); }, /table "Claims": default_view shows "Nope", which is not a column of the table/);
  bad((s) => { s.tables.claims.default_view.name = ''; }, /table "Claims": default_view name must be text/);
  bad((s) => { s.tables.claims.default_view.name = 'Your queue'; }, /table "Claims": default_view is called "Your queue", the name of one of its other views/);
  bad((s) => { s.tables.claims.default_view.colour = 'red'; }, /table "Claims": default_view has "colour", which is not part of it/);
  bad((s) => { s.tables.claims.arrange_default_view = true; }, /table "Claims": default_view says which columns the table's own view shows, so arrange_default_view is not given as well/);
  bad((s) => { s.tables.claims.description = ''; }, /table "Claims": the description must be one line of text of at most 280 characters/);
  bad((s) => { s.tables.claims.description = 'x'.repeat(281); }, /the description must be one line of text of at most 280 characters/);
  const retired = revisedStructure();
  retired.tables.claims.default_view = { columns: ['Geo Name', 'Agent tags (old)'] };
  delete retired.tables.claims.arrange_default_view;
  assert.throws(() => validateStructure(retired), /default_view shows "Agent tags \(old\)", a retired column, which every view hides/);
});

test('defaultViewPlan: default_view shows exactly its columns and hides the rest; arrange_default_view shows every live column; neither leaves the view alone; ownViewName picks its view', () => {
  const s = freshStructure();
  const claims = defaultViewPlan(s, 'claims');
  assert.equal(claims.name, 'All claims');
  assert.deepEqual(claims.shown, ['Geo Name', 'Geo Space', 'Agent tags', 'Agent status', 'Verified tags', 'Review status', 'Geo URL']);
  assert.deepEqual(claims.hidden, s.tables.claims.columns.map((c) => c.name).filter((n) => !claims.shown.includes(n)));
  assert.equal(claims.shown.length + claims.hidden.length, s.tables.claims.columns.length);
  assert.equal(defaultViewPlan(s, 'rulebook').name, 'Rulebook', 'the Rulebook\'s own view is called Rulebook');
  assert.equal(defaultViewPlan(s, 'rule_changes').name, null, 'a table that gives no name keeps Notion\'s');
  assert.ok(['claims', 'rulebook', 'rule_changes', 'tag_decisions', 'agent_settings'].every((t) => defaultViewPlan(s, t).first === true), 'a default_view is the first tab of its table');
  const old = revisedStructure();
  const arranged = defaultViewPlan(old, 'claims');
  assert.equal(arranged.first, undefined, 'arrange_default_view leaves the named views in front of the own view');
  assert.equal(arranged.name, null);
  assert.deepEqual(arranged.shown, old.tables.claims.columns.filter((c) => !c.retired).map((c) => c.name));
  assert.deepEqual(arranged.hidden, old.tables.claims.columns.filter((c) => c.retired).map((c) => c.name));
  assert.equal(defaultViewPlan(old, 'rulebook'), null);
  assert.equal(planStructure(forFake(freshStructure()), newWorld().config).arrange.agent_settings.shown.length, 4);
  assert.equal(ownViewName(['Table', 'My filter'], 'All claims'), 'Table');
  assert.equal(ownViewName(['My filter', 'All claims'], 'All claims'), 'All claims', 'the view that was renamed already');
  assert.equal(ownViewName(['Default'], null), 'Default', 'without a Table, the first');
  assert.equal(ownViewName([], 'x'), null);
});

test('hubPlan: the warning line, the three link lines with their words, the tables and pages by their titles; Archive is not a page of the structure', () => {
  const plan = hubPlan(freshStructure());
  assert.equal(plan.note, NOTE);
  assert.deepEqual(plan.view_links.map((l) => l.text), LINKS);
  assert.deepEqual(LINKS, [
    'Your queue: the claims that wait for your decision',
    'Needs your note: claims where you overruled the agent and left no note',
    'Lessons waiting: rule changes the agent drafted, for the rule owner to approve or reject',
  ], 'the words of the editor review (ED-5, ED-7)');
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
  assert.equal(seq.filter((x) => x === 'view').length, 6);
  assert.ok(last('view') < first('blocks'), 'then the hub part');
  assert.equal(seq.filter((x) => x === 'blocks').length, 1, 'the warning line and the link lines go in one request');
  assert.equal(seq.filter((x) => x === 'blocks').length + seq.filter((x) => x === 'view').length + seq.filter((x) => x?.startsWith('table ')).length + 1 + 1, seq.length, 'nothing else was sent');
  assert.ok(w.fake.requests.every((q) => q.method === 'GET' || q.method === 'POST' || q.method === 'PATCH'), 'no delete');
  const cfg = readJson(join(w.root, 'config.json')).notion;
  const databaseIds = { rulebook: cfg.rulebook.database_id, claims: cfg.claims.database_id, ...Object.fromEntries(Object.entries(cfg.databases).map(([k, v]) => [k, v.database_id])) };
  for (const t of TABLES) assert.equal(w.fake.database(databaseIds[t]).is_inline, false, `${t} is a full-page table`);
  assert.deepEqual(outline(w), [...TOP, ...TABLE_TITLES.map((t) => `database|${t}`), 'child_page|Onboarding']);
  assert.equal(result.hub.ok, true);
  assert.deepEqual(result.hub.differences, []);
  assert.equal(result.created.hub_links, 3);
  assert.equal(result.created.hub_note, 1);
  // each table has the one line under its name that the structure gives it (ED-8)
  for (const t of TABLES) {
    const stored = w.fake.database(databaseIds[t]).description.map((x) => x.plain_text ?? x.text.content).join('');
    assert.equal(stored, w.structure.tables[t].description, `${t}: its description`);
  }
  const bodies = w.fake.requests.filter((q) => q.method === 'POST' && q.path === '/databases').map((q) => [q.body.title[0].text.content, q.body.description?.[0]?.text?.content]);
  assert.deepEqual(bodies.map(([, d]) => typeof d), Array(5).fill('string'), 'sent with the create');
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

test('the hub part puts the warning line and the three link lines at the start of the hub page once, each link linked to its view; a run again adds nothing and sends no write', async () => {
  const w = world();
  await run(w);
  const [first, ...blocks] = w.fake.children(w.parent).slice(0, 4);
  assert.equal(first.paragraph.rich_text.length, 1, 'the warning is plain text');
  assert.equal(first.paragraph.rich_text[0].plain_text, NOTE);
  assert.equal(first.paragraph.rich_text[0].href ?? null, null, 'and no link');
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
  assert.equal(again.created.hub_note, 0, 'the warning is not added twice');
  assert.deepEqual(again.hub.added, []);
  assert.equal(outline(w).filter((l) => l === `paragraph|${NOTE}`).length, 1);
});

test('the hub part adds only the lines that are missing, at the start, the warning first, and reports where the other blocks stand', async () => {
  const w = world();
  // the page already has the second line (typed by hand) and a table-less start
  await w.client.appendBlocks(w.parent, [paragraph(LINKS[1])]);
  const result = await run(w);
  assert.equal(result.created.hub_links, 2);
  assert.equal(result.created.hub_note, 1);
  assert.deepEqual(result.hub.added, [NOTE, LINKS[0], LINKS[2]]);
  assert.equal(outline(w).filter((l) => l === `paragraph|${LINKS[1]}`).length, 1, 'the line that was there is not added again');
  // the added lines are first; the line that was there stays where it was, after the tables' predecessors
  assert.deepEqual(outline(w).slice(0, 3), [`paragraph|${NOTE}`, `paragraph|${LINKS[0]}`, `paragraph|${LINKS[2]}`]);
  assert.ok(result.hub.differences.some((d) => d.kind === 'order'), 'the hand-typed line stands out of order and is reported, not moved');
});

test('the warning line (P14): a page that has it but lacks the link lines gets them right after it; a page that has the links but not the warning gets it at the very top; a second copy is a leftover', async () => {
  const withNote = world();
  await withNote.client.appendBlocks(withNote.parent, [paragraph(NOTE)]);
  await run(withNote);
  assert.deepEqual(outline(withNote).slice(0, 4), TOP, 'the note stays first and the links follow it');
  const put = withNote.fake.requests.filter((q) => q.method === 'PATCH' && /^\/blocks\/[^/]+\/children$/.test(q.path));
  assert.equal(put.length, 2, 'the note typed by hand, then the one append of the hub part');
  assert.equal(put[1].body.position.type, 'after_block', 'the links go after the note, not above it');

  const withLinks = world();
  await run(withLinks, { parts: ['pages', 'databases', 'views'] });
  const cfg = readJson(join(withLinks.root, 'config.json')).notion.views;
  await withLinks.client.appendBlocks(withLinks.parent, LINKS.map((l, i) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: l.split(': ')[0], link: { url: cfg[['your_queue', 'needs_your_note', 'lessons_waiting'][i]].url } } }, { type: 'text', text: { content: `: ${l.split(': ').slice(1).join(': ')}` } }] } })), { position: { type: 'start' } });
  const result = await run(withLinks, { parts: ['hub'] });
  assert.deepEqual(result.hub.added, [NOTE]);
  assert.equal(result.created.hub_links, 0);
  assert.deepEqual(outline(withLinks).slice(0, 4), TOP);
  assert.equal(result.hub.ok, true, JSON.stringify(result.hub.differences));

  await withLinks.client.appendBlocks(withLinks.parent, [paragraph(NOTE)]);
  const twice = await run(withLinks, { parts: ['hub'] });
  assert.ok(twice.hub.differences.some((d) => /^a second copy of the warning line is on the hub page and was left as it is/.test(d.detail)));
  assert.equal(outline(withLinks).filter((l) => l === `paragraph|${NOTE}`).length, 2, 'nothing was removed');
  assert.equal(twice.created.hub_note, 0);
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
  assert.deepEqual(outline(w), [...TOP, `child_page|${ARCHIVE_TITLE}`, ...TABLE_TITLES.map((t) => `database|${t}`), 'child_page|Onboarding'], 'the page is as it was made: nothing was moved');
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
  assert.ok(text.includes('the warning line at the top is not on the hub page'));
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

// ---- Your queue empties as you decide (P13) --------------------------------------------------------------------------------------------------------

// "Review status is not Reviewed" is sent as "is not Reviewed, or is empty": a new claim has no Review status, and Notion's documentation does not say whether a bare does_not_equal on a select keeps
// such a row. The tests run on both readings of the fake (emptySelectIsNot true and false).
const REVIEWED_OPEN = (column) => ({ or: [{ property: column, select: { does_not_equal: 'Reviewed' } }, { property: column, select: { is_empty: true } }] });

test('parseViewFilter reads an AND of two conditions on selects, the second with "is not": the filter of Your queue (P13); "is not X" is sent as "is not X, or is empty"', () => {
  const claims = freshStructure().tables.claims;
  const waits = { property: 'Agent status', select: { equals: 'Waits for you' } };
  const open = REVIEWED_OPEN('Review status');
  assert.deepEqual(parseViewFilter('Agent status is Waits for you and Review status is not Reviewed', claims), { and: [waits, open] });
  assert.deepEqual(parseViewFilter('Review status is not Reviewed and Agent status is Waits for you', claims), { and: [open, waits] }, 'in the other order too');
  assert.deepEqual(parseViewFilter('Review status is not Reviewed', claims), open, 'alone it is the or itself');
  assert.throws(() => parseViewFilter('Agent status is Waits for you and Review status is not Done', claims), (e) => e instanceof StructureError && /"Done" is not a value of "Review status"/.test(e.message));
  const plan = planStructure(forFake(freshStructure()), newWorld().config);
  assert.deepEqual(plan.views.find((v) => v.name === 'Your queue').body.filter, { and: [waits, open] }, 'the plan sends one AND with the or inside it: two levels, which the views API allows');
  assert.deepEqual(plan.views.find((v) => v.name === 'Needs your note').body.filter, { property: 'Agent reading', rich_text: { contains: 'without your note' } }, 'the other two views are as they were');
  // the words in structure.json, which the frozen walkthrough manifest repeats, are the same as before
  assert.equal(freshStructure().views.find((v) => v.name === 'Your queue').filter, 'Agent status is Waits for you and Review status is not Reviewed');
});

test('the filter of Your queue at work on the rows of the built table, on either reading of an empty select: a claim with no Review status that waits is listed, a Reviewed one is not; the bare filter of before would lose the new claims on the strict reading', async () => {
  for (const emptySelectIsNot of [true, false]) {
    const w = world({ emptySelectIsNot });
    assert.equal((await run(w)).ok, true);
    const entry = tableEntry(w.config, 'claims');
    const rows = [
      ['waits, to review', 'Waits for you', 'To review'],
      ['waits, no review status', 'Waits for you', null],
      ['waits, decided', 'Waits for you', 'Reviewed'],
      ['done, no review status', 'Done', null],
      ['done, decided', 'Done', 'Reviewed'],
      ['disagrees, decided', 'Disagrees with your decision', 'Reviewed'],
      ['not read yet, no review status', null, null],
    ];
    for (const [name, status, review] of rows) w.fake.addRow(entry.database_id, { 'Geo Name': name, ...(status ? { 'Agent status': status } : {}), ...(review ? { 'Review status': review } : {}) });
    const listed = async (filter) => (await w.client.queryDataSourceAll(entry.data_source_id, { filter })).map((p) => p.properties['Geo Name'].title.map((t) => t.plain_text).join('')).sort();
    const queue = w.fake.views(entry.database_id).find((v) => v.name === 'Your queue');
    assert.deepEqual(queue.filter, { and: [{ property: 'Agent status', select: { equals: 'Waits for you' } }, REVIEWED_OPEN('Review status')] }, 'the view in Notion has the new filter');
    assert.deepEqual(await listed(queue.filter), ['waits, no review status', 'waits, to review'], `emptySelectIsNot ${emptySelectIsNot}: a Waits for you claim with an empty Review status is listed, a Reviewed one is not`);
    // the same rows, as status.mjs counts them (claimWaits: Waits for you and not Reviewed, an empty Review status being not Reviewed)
    const counted = rows.filter(([, status, review]) => claimWaits({ agent_status: status, review_status: review })).map(([name]) => name).sort();
    assert.deepEqual(counted, await listed(queue.filter), 'status counts what the view lists');
    const bare = { and: [{ property: 'Agent status', select: { equals: 'Waits for you' } }, { property: 'Review status', select: { does_not_equal: 'Reviewed' } }] };
    assert.deepEqual(await listed(bare), emptySelectIsNot ? ['waits, no review status', 'waits, to review'] : ['waits, to review'], 'the old filter: on the strict reading it loses every claim that has no Review status yet');
  }
});

test('a second build sends nothing for Your queue; a view that still has the bare filter of before is brought to the new one by the update path, once, and verify finds no difference either way', async () => {
  const w = world({ emptySelectIsNot: false });
  assert.equal((await run(w)).ok, true);
  const entry = tableEntry(w.config, 'claims');
  const queue = () => w.fake.views(entry.database_id).find((v) => v.name === 'Your queue');
  const wanted = { and: [{ property: 'Agent status', select: { equals: 'Waits for you' } }, REVIEWED_OPEN('Review status')] };
  assert.deepEqual(queue().filter, wanted);
  assert.deepEqual((await structureVerify(w)).differences, [], 'the new filter reads back as the structure says (nothing flattens the or inside the and)');
  const writes = w.fake.writes().length;
  const again = await run(w);
  assert.deepEqual([again.ok, again.updated, again.created.views, again.created.views_updated], [true, {}, 0, 0]);
  assert.equal(w.fake.writes().length, writes, 'not one write');

  // a view made by the build of before: the bare filter
  const bare = { and: [{ property: 'Agent status', select: { equals: 'Waits for you' } }, { property: 'Review status', select: { does_not_equal: 'Reviewed' } }] };
  await w.client.updateView(queue().id, { filter: bare });
  assert.deepEqual(queue().filter, bare);
  const stale = await structureVerify(w);
  assert.deepEqual(stale.differences.map((d) => [d.table, d.kind]), [['claims', 'view filter']], 'verify names the old filter');
  const mark = w.fake.writes().length;
  const fixed = await run(w);
  assert.deepEqual(fixed.updated, { claims: { 'Your queue': ['filter'] } }, 'the existing update path sends the filter, and nothing else');
  assert.equal(w.fake.writes().length, mark + 1, 'one PATCH');
  assert.deepEqual(queue().filter, wanted);
  assert.deepEqual((await structureVerify(w)).differences, []);
  const last = w.fake.writes().length;
  const once = await run(w);
  assert.deepEqual([once.updated, once.created.views_updated], [{}, 0]);
  assert.equal(w.fake.writes().length, last, 'and the next run sends nothing');
});

// ---- the table's own view and the description under each table (P15, ED-8) --------------------------------------------------------------------------------------

const TABLE_KEYS = ['claims', 'rulebook', 'rule_changes', 'tag_decisions', 'agent_settings'];

/** What Notion does for every table and the shared fake does not: a view called Table that shows every column in the order they were made. */
async function giveOwnViews(w) {
  const made = {};
  for (const table of TABLE_KEYS) {
    const entry = tableEntry(w.config, table);
    const props = Object.values(w.fake.dataSource(entry.data_source_id).properties);
    made[table] = await w.client.createView({
      databaseId: entry.database_id, dataSourceId: entry.data_source_id, name: 'Table',
      configuration: { type: 'table', wrap_cells: false, properties: props.map((p) => ({ property_id: p.id, visible: true, width: 150 })) }, position: { type: 'end' },
    });
  }
  return made;
}

/** The views of a table as { name -> { shown: [column names], hidden: [column names] } }, read from the fake. */
function viewsOf(w, table) {
  const entry = tableEntry(w.config, table);
  const names = new Map(Object.values(w.fake.dataSource(entry.data_source_id).properties).map((p) => [p.id, p.name]));
  return Object.fromEntries(w.fake.views(entry.database_id).map((v) => [v.name, {
    id: v.id,
    shown: v.configuration.properties.filter((p) => p.visible !== false).map((p) => names.get(p.property_id)),
    hidden: v.configuration.properties.filter((p) => p.visible === false).map((p) => names.get(p.property_id)),
  }]));
}

test('the table\'s own view of every table shows exactly the columns of its default_view in order and hides the rest; the Claims one is called All claims; a second run writes nothing; a view somebody made is left alone', async () => {
  const w = world();
  assert.equal((await run(w, { parts: ['databases'] })).ok, true);
  await giveOwnViews(w);
  const entry = tableEntry(w.config, 'claims');
  await w.client.createView({
    databaseId: entry.database_id, dataSourceId: entry.data_source_id, name: 'My filter',
    configuration: { type: 'table', properties: Object.values(w.fake.dataSource(entry.data_source_id).properties).map((p) => ({ property_id: p.id, visible: true })) },
  });
  const mine = viewsOf(w, 'claims')['My filter'];
  const result = await run(w);
  assert.equal(result.ok, true, JSON.stringify(result.stopped));
  assert.deepEqual(result.arranged, { claims: ['Table'], rulebook: ['Table'], rule_changes: ['Table'], tag_decisions: ['Table'] }, 'by the name they had; Agent settings shows all its columns in the order it was made, so there was nothing to change');
  for (const table of TABLE_KEYS) {
    const want = w.structure.tables[table].default_view;
    const own = viewsOf(w, table)[want.name ?? 'Table'];
    assert.ok(own, `${table}: the own view${want.name ? ` is called ${want.name}` : ' keeps Notion\'s name'}`);
    assert.deepEqual(own.shown, want.columns, `${table}: shows the columns of default_view, in order`);
    assert.deepEqual([...own.shown, ...own.hidden].sort(), w.structure.tables[table].columns.map((c) => c.name).sort(), `${table}: every other column is hidden, none is gone`);
  }
  assert.deepEqual(Object.keys(viewsOf(w, 'claims')).sort(), ['Agent disagreed', 'All claims', 'My filter', 'Needs your note', 'Your queue'], 'the view named Table is now All claims');
  assert.deepEqual(viewsOf(w, 'claims')['My filter'], mine, 'a view somebody made is not touched');
  assert.equal(viewsOf(w, 'claims')['All claims'].shown.length, 7);
  assert.equal(viewsOf(w, 'agent_settings').Table.shown.length, 4, 'Agent settings has no named view and its own view is still arranged');
  assert.deepEqual(Object.keys(result.views).sort(), ['claims', 'rule_changes', 'tag_decisions'], 'a table with no named view (the Rulebook, Agent settings) has no entry among the views made');
  assert.deepEqual(Object.keys(viewsOf(w, 'rulebook')), ['Rulebook'], 'the Rulebook has the one view, its own, and it is called Rulebook');
  // verify is clean, and a second run changes nothing
  const clean = await structureVerify({ ...w, root: w.root });
  assert.deepEqual(clean.differences, []);
  const writes = w.fake.writes().length;
  const again = await run(w);
  assert.deepEqual([again.arranged, again.updated, again.created.views, again.created.views_updated], [{}, {}, 0, 0]);
  assert.equal(w.fake.writes().length, writes, 'not one write');
});

test('verify names a table\'s own view with a column shown that the structure hides, and a Claims own view that is not called All claims', async () => {
  const w = world();
  assert.equal((await run(w, { parts: ['databases'] })).ok, true);
  await giveOwnViews(w);
  assert.equal((await run(w)).ok, true);
  const config = w.config;
  const check = () => verifyStructure({ client: w.client, config, structure: w.structure });
  assert.deepEqual((await check()).differences, []);

  const rulebook = viewsOf(w, 'rulebook');
  const entry = tableEntry(config, 'rulebook');
  const ds = w.fake.dataSource(entry.data_source_id);
  const evidence = Object.values(ds.properties).find((p) => p.name === 'Evidence');
  const view = w.fake.views(entry.database_id).find((v) => v.name === 'Rulebook');
  await w.client.updateView(view.id, { configuration: { type: 'table', properties: view.configuration.properties.map((p) => (p.property_id === evidence.id ? { ...p, visible: true } : p)) } });
  const extra = await check();
  assert.deepEqual(extra.differences.map((d) => [d.table, d.kind]), [['rulebook', 'view columns']]);
  assert.match(extra.differences[0].detail, /^"Rulebook" \(the table's own view\): expected Name, Category, Status, When to use, Example Claims; found .*Evidence/);
  assert.ok(rulebook.Rulebook);

  const all = viewsOf(w, 'claims')['All claims'];
  await w.client.updateView(all.id, { name: 'Table' });
  const renamed = (await check()).differences.filter((d) => d.table === 'claims');
  assert.deepEqual(renamed.map((d) => d.kind), ['view name']);
  assert.match(renamed[0].detail, /^the table's own view is called "Table" and the structure calls it "All claims"$/);
});

test('without the table\'s own view (Notion makes one; a person may have removed it) there is nothing to arrange and verify says nothing about it; the first named view goes to the start, as before', async () => {
  const w = world();
  const result = await run(w);
  assert.equal(result.ok, true, JSON.stringify(result.stopped));
  assert.deepEqual(result.arranged, {});
  assert.deepEqual((await structureVerify({ ...w })).differences, []);
  assert.deepEqual(tabs(w, 'claims'), ['Your queue', 'Needs your note', 'Agent disagreed']);
  const first = w.fake.requests.find((q) => q.method === 'POST' && q.path === '/views' && q.body.name === 'Your queue');
  assert.deepEqual(first.body.position, { type: 'start' }, 'nothing to stand behind');
  assert.deepEqual(result.warnings, []);
});

// ---- the table's own view is its first tab (P15, ED-6) ----------------------------------------------------------------------------------------------------

const tabs = (w, table) => w.fake.views(tableEntry(w.config, table).database_id).map((v) => v.name);
const viewPosts = (w) => Object.fromEntries(w.fake.requests.filter((q) => q.method === 'POST' && q.path === '/views').map((q) => [q.body?.name, q.body?.position]));

test('a fresh build makes each table open on its own view: All claims, Your queue, Needs your note and Agent disagreed on Claims; Rule changes and Tag decisions have their own view first; a rerun sends nothing, and verify is clean', async () => {
  for (const ownView of ['Default view', 'Table']) {
    const w = world({ ownView }); // Notion makes a view for every table made through the API; the shared fake makes none unless it is asked to
    const result = await run(w);
    assert.equal(result.ok, true, `${ownView}: ${JSON.stringify(result.stopped)}`);
    assert.deepEqual(tabs(w, 'claims'), ['All claims', 'Your queue', 'Needs your note', 'Agent disagreed'], `${ownView}: Claims opens on All claims`);
    assert.deepEqual(tabs(w, 'rulebook'), ['Rulebook'], 'the Rulebook has one tab, its own, called Rulebook');
    assert.deepEqual(tabs(w, 'rule_changes'), [ownView, 'Lessons waiting'], 'Rule changes: its own view keeps Notion\'s name and is first');
    assert.deepEqual(tabs(w, 'tag_decisions'), [ownView, 'Your queue (ledger)', 'Needs your note (ledger)']);
    assert.deepEqual(tabs(w, 'agent_settings'), [ownView]);
    // each named view was asked for right after the one before it, the first right after the table's own view
    const posted = viewPosts(w);
    const claimsViews = w.fake.views(tableEntry(w.config, 'claims').database_id);
    assert.deepEqual(posted['Your queue'], { type: 'after_view', view_id: claimsViews[0].id });
    assert.deepEqual(posted['Needs your note'], { type: 'after_view', view_id: claimsViews[1].id });
    assert.deepEqual(posted['Agent disagreed'], { type: 'after_view', view_id: claimsViews[2].id });
    assert.equal(claimsViews[0].name, 'All claims');
    assert.ok(Object.values(posted).every((p) => p.type === 'after_view'), 'no view is put at the start any more');
    assert.deepEqual(result.warnings, []);
    assert.deepEqual((await structureVerify(w)).differences, [], `${ownView}: verify`);
    const writes = w.fake.writes().length;
    const again = await run(w);
    assert.deepEqual([again.ok, again.updated, again.arranged, again.created.views, again.created.views_updated], [true, {}, {}, 0, 0], `${ownView}: a rerun`);
    assert.equal(w.fake.writes().length, writes, `${ownView}: not one write`);
    assert.deepEqual(tabs(w, 'claims'), ['All claims', 'Your queue', 'Needs your note', 'Agent disagreed']);
  }
});

test('a view that Notion will not place after the own view is made without a place, and the run says that the tab order may need a drag', async () => {
  const w = world({ ownView: 'Default view' });
  w.fake.failNext('POST', /^\/views$/, 400, 1, { message: 'body.position should not be present' });
  const log = [];
  const result = await run(w, { log: (l) => log.push(l) });
  assert.equal(result.ok, true, JSON.stringify(result.stopped));
  assert.equal(result.created.views, 6, 'every view was made, the refused one on the second ask');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /^the view "Your queue" of the table "Claims" was made without its place in the tab bar, so the tab order may need a drag: drag the tab "All claims" to the front of the table "Claims" by hand in Notion$/);
  assert.ok(log.some((l) => /did not take its place in the tab bar/.test(l)));
  assert.ok(log.some((l) => /may need a drag/.test(l)), 'and the log says so');
  assert.equal(w.fake.requests.filter((q) => q.method === 'POST' && q.path === '/views').length, 7, 'six views and one ask that was refused: with a place, then without');
});

test('a table without a default_view keeps the named views in front of its own view, as before: the practice page\'s Claims (arrange_default_view)', async () => {
  const w = world({ ownView: 'Table' });
  const structure = forFake(freshStructure());
  structure.tables.claims = { ...structure.tables.claims, arrange_default_view: true };
  delete structure.tables.claims.default_view;
  const plan = planStructure(structure, w.config);
  const result = await runStructure({ plan, client: w.client, root: w.root, config: w.config });
  assert.equal(result.ok, true, JSON.stringify(result.stopped));
  assert.deepEqual(tabs(w, 'claims'), ['Your queue', 'Needs your note', 'Agent disagreed', 'Table'], 'ours first, Notion\'s own view last');
  assert.deepEqual(viewPosts(w)['Your queue'], { type: 'start' });
  assert.deepEqual(tabs(w, 'rule_changes'), ['Table', 'Lessons waiting'], 'the tables that do have a default_view are as in the fresh build');
});


test('a table that was adopted without its description is named by verify, the description being written only when the build makes the table', async () => {
  const w = world();
  // a full-page table called Claims, made by an earlier try without the one line under its name, is adopted by its title
  await w.client.createDatabase({ parentPageId: w.parent, title: 'Claims', isInline: false, properties: { 'Geo Name': { type: 'title', title: {} } } });
  const result = await run(w);
  assert.equal(result.ok, true, JSON.stringify(result.stopped));
  assert.equal(result.databases.claims.status, 'adopted');
  const missing = (await verifyStructure({ client: w.client, config: w.config, structure: w.structure })).differences.filter((d) => d.kind === 'description');
  assert.deepEqual(missing.map((d) => d.table), ['claims'], 'the four tables the build made have theirs');
  assert.match(missing[0].detail, /^"Claims" has the description "", the structure says "200 Geo claims tagged Debate\. Decide them through Your queue; every decision trains the rulebook\."; write it in Notion under the table's name/);
});
