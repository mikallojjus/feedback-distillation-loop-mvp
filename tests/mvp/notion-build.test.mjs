import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TABLES, loadConfig } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import { EXIT } from '../../agents/claim-tagger-mvp/scripts/lib/exit-codes.mjs';
import {
  OPTION_COLORS, PAGE_TEXT, StructureError, completeViewBody, countStructure, loadStructure, parseViewFilter, parseViewSort, planStructure, renderPreview,
  runStructure, saveStructure, structureFromProposal, validateStructure, verifyStructure, viewKey, viewUrl,
} from '../../agents/claim-tagger-mvp/scripts/lib/notion-build.mjs';
import { normId } from '../../agents/claim-tagger-mvp/scripts/lib/notion-values.mjs';
import { createFakeNotion } from './fixtures/fake-notion.mjs';
import {
  FAKE_HAS_USER_COLUMNS, STRUCTURE_MD, TAG_NAMES, builderClient, cleanTmp, forFake, newWorld, readJson, realStructure, testConfig, tmp,
} from './helpers/setup-world.mjs';

// The structure builder: the proposal read into a structure, the REST plan made from it, the plan run against the shared in-memory Notion
// (resumably) and read back. The real client runs over the fake, so its own rules (a create is never sent twice) are in play.

after(cleanTmp);

const proposal = () => readFileSync(STRUCTURE_MD, 'utf8');
const column = (structure, table, name) => structure.tables[table].columns.find((c) => c.name === name);
const posts = (fake, path) => fake.requests.filter((r) => r.method === 'POST' && r.path === path);

/** A world with the plan made: a config over the fake, the structure as the fake can build it, a builder client. */
function build({ protectedIds } = {}) {
  const w = newWorld({ protectedIds });
  const structure = forFake(realStructure());
  const plan = planStructure(structure, w.config);
  return { ...w, structure, plan, client: builderClient(w.fake) };
}

// ---- reading the proposal -------------------------------------------------------------------------------------------------------------------

test('structureFromProposal reads the five tables of the real proposal with 17, 15, 12, 10 and 4 columns', () => {
  const s = realStructure();
  assert.deepEqual(Object.keys(s.tables), [...TABLES]);
  assert.deepEqual(Object.values(s.tables).map((t) => t.title), ['Rulebook copy', 'Claims copy', 'Tag decisions', 'Rule changes', 'Agent settings']);
  assert.deepEqual(Object.values(s.tables).map((t) => t.columns.length), [17, 15, 12, 10, 4]);
  assert.deepEqual(countStructure(s), { tables: 5, columns: 58, views: 4, pages: 2 });
  assert.deepEqual(s.pages, ['Demos', 'Demo tests']);
  for (const t of Object.values(s.tables)) {
    for (const c of t.columns) assert.deepEqual(Object.keys(c), ['name', 'type', 'options', 'description'], `${t.title}.${c.name}`);
  }
});

test('the type words map to REST types: text is rich_text, link is url, and the four automatic columns keep their own types', () => {
  const s = realStructure();
  const types = (table) => Object.fromEntries(s.tables[table].columns.map((c) => [c.name, c.type]));
  assert.deepEqual(types('rulebook'), {
    Name: 'title', Category: 'select', Counterpart: 'rich_text', Description: 'rich_text', Evidence: 'url', 'Example Claims': 'rich_text', 'Geo Status': 'select', 'Geo Tag ID': 'rich_text',
    Polarity: 'select', Status: 'select', 'Verified on': 'date', 'When to use': 'rich_text', 'Work tags': 'multi_select', Created: 'created_time', 'Created by': 'created_by',
    'Last edited': 'last_edited_time', 'Last edited by': 'last_edited_by',
  });
  assert.equal(column(s, 'claims_copy', 'Geo Score').type, 'number');
  assert.equal(column(s, 'claims_copy', 'Geo Is factual').type, 'checkbox');
  assert.equal(column(s, 'claims_copy', 'Geo URL').type, 'url');
  assert.equal(column(s, 'claims_copy', 'Geo Tags').type, 'multi_select');
  assert.equal(column(s, 'tag_decisions', 'Agent confidence').type, 'number');
  assert.equal(column(s, 'tag_decisions', 'Claim link').type, 'url');
  assert.equal(column(s, 'agent_settings', 'Paused').type, 'checkbox');
  for (const t of Object.values(s.tables)) assert.equal(t.columns.filter((c) => c.type === 'title').length, 1, t.title);
});

test('the option lists come from "Values:" in Meaning, and "the 13 tag names" are the names in the Rulebook copy section', () => {
  const s = realStructure();
  const opts = (table, name) => column(s, table, name).options;
  assert.deepEqual(opts('rulebook', 'Category'), ['Nature', 'Form', 'Quality', 'Style', 'Tone', 'Format', 'Meaning', 'Usage', 'Check']);
  assert.deepEqual(opts('rulebook', 'Geo Status'), ['Existing in Geo', 'To be created', 'Implemented differently']);
  assert.deepEqual(opts('rulebook', 'Polarity'), ['Classification', 'Positive', 'Issue']);
  assert.deepEqual(opts('rulebook', 'Status'), ['Verified', 'Proposed']);
  assert.deepEqual(opts('rulebook', 'Work tags'), ['Pipeline benchmark check', 'Issue']);
  assert.deepEqual(opts('claims_copy', 'Geo Tags'), ['Debate', 'Democracy & Media', 'Economy', 'Featured', 'Immigration', 'Main claim', 'Politics', 'debate claim']);
  assert.deepEqual(opts('claims_copy', 'Geo Name source'), ['This space', 'Other space (fallback)']);
  assert.deepEqual(opts('tag_decisions', 'Tag'), TAG_NAMES);
  assert.deepEqual(opts('rule_changes', 'Tag'), TAG_NAMES);
  assert.deepEqual(opts('tag_decisions', 'Agent proposal'), ['Applies', 'Does not apply', "Can't tell"]);
  assert.deepEqual(opts('tag_decisions', 'Follow-up'), ['Fixed', 'Still wrong']);
  assert.deepEqual(opts('tag_decisions', 'Tag outcome'), ['Applies', 'Does not apply']);
  assert.deepEqual(opts('tag_decisions', 'Why wrong'), ['Agent slip', 'Rule unclear', 'Rule should change']);
  assert.deepEqual(opts('rule_changes', 'Kind'), ['Clarify wording', 'Change the rule', 'Initial rules']);
  assert.deepEqual(opts('rule_changes', 'Status'), ['Proposed', 'Approved', 'Rejected', 'Live', 'Rolled back']);
  for (const t of Object.values(s.tables)) for (const c of t.columns) if (c.type !== 'select' && c.type !== 'multi_select') assert.deepEqual(c.options, [], `${t.title}.${c.name}`);
});

test('a description is the Meaning without its "Values:" list, at most 280 characters', () => {
  const s = realStructure();
  assert.equal(column(s, 'rulebook', 'Category').description, "The tag's group.");
  assert.equal(column(s, 'rulebook', 'Name').description, "The tag's name; one row per tag.");
  assert.equal(column(s, 'tag_decisions', 'Tag').description, 'The tag the row is about.');
  assert.equal(column(s, 'rule_changes', 'Status').description, 'The editor sets Approved and Rejected; the agent sets Proposed, Live and Rolled back.');
  for (const t of Object.values(s.tables)) for (const c of t.columns) {
    assert.ok(c.description.length > 0 && [...c.description].length <= 280, `${t.title}.${c.name}`);
    assert.ok(!c.description.includes('Values:'), `${t.title}.${c.name}`);
  }
  const long = proposal().replace('| Name | title | setup, then the team | The tag\'s name; one row per tag. |', `| Name | title | setup | ${'long words '.repeat(60)}|`);
  const cut = structureFromProposal(long).tables.rulebook.columns[0].description;
  assert.equal([...cut].length, 280);
  assert.ok(cut.endsWith('…'));
});

test('the four views: tables, plain filters and sorts, columns shown in order, wrap flags', () => {
  const s = realStructure();
  assert.deepEqual(s.views.map((v) => [v.name, v.table, v.wrap]), [['Your queue', 'tag_decisions', false], ['Needs your note', 'tag_decisions', false], ['Lessons waiting', 'rule_changes', true], ['Rulebook', 'rulebook', true]]);
  assert.deepEqual(s.views.map((v) => v.filter), ['Tag outcome is empty', 'Why wrong is Rule unclear or Rule should change, and Your reasoning is empty', 'Status is Proposed or Approved', 'all rows']);
  assert.deepEqual(s.views.map((v) => v.sort), ['Agent confidence, lowest first', 'Agent confidence, lowest first', 'none', 'none']);
  assert.deepEqual(s.views[0].columns, ['Claim', 'Agent proposal', 'Agent reason', 'Tag outcome', 'Why wrong', 'Your reasoning']);
  assert.deepEqual(s.views[1].columns, ['Claim', 'Tag outcome', 'Why wrong', 'Your reasoning']);
  assert.deepEqual(s.views[2].columns, ['Lesson', 'Current text', 'Proposed text', 'Status']);
  assert.deepEqual(s.views[3].columns, ['Name', 'Category', 'Status', 'When to use', 'Example Claims']);
});

test('a proposal saved with Windows line endings or a byte-order mark reads the same', () => {
  const same = realStructure();
  assert.deepEqual(structureFromProposal(proposal().replace(/\r?\n/g, '\r\n')), same);
  assert.deepEqual(structureFromProposal(`﻿${proposal()}`), same);
});

test('the structure the builder reads is the one in the repository file, in the shape the next steps validate', () => {
  const s = realStructure();
  assert.equal(validateStructure(s), s);
  const root = tmp('structure-file');
  const file = saveStructure(root, s);
  assert.equal(file, join(root, 'setup', 'structure.json'));
  assert.deepEqual(loadStructure(root), s);
  assert.throws(() => loadStructure(tmp('empty')), (e) => e instanceof StructureError && /structure --from-proposal/.test(e.message));
});

// ---- the proposal that cannot be read ---------------------------------------------------------------------------------------------------------

test('an unknown type word fails loudly, naming the table and the column', () => {
  const bad = proposal().replace('| Evidence | link |', '| Evidence | hyperlink |');
  assert.throws(() => structureFromProposal(bad), (e) => e instanceof StructureError && e.code === 'STRUCTURE'
    && /table "Rulebook copy"/.test(e.message) && /column "Evidence"/.test(e.message) && /unknown type word "hyperlink"/.test(e.message));
  const second = proposal().replace('| Paused | checkbox |', '| Paused | tick box |');
  assert.throws(() => structureFromProposal(second), /table "Agent settings", column "Paused": unknown type word "tick box"/);
});

test('a missing table section fails loudly, naming the table', () => {
  const bad = proposal().replace('## Rule changes', '## Lesson proposals');
  assert.throws(() => structureFromProposal(bad), (e) => e instanceof StructureError && /table "Rule changes"/.test(e.message) && /no "## Rule changes" section/.test(e.message));
  assert.throws(() => structureFromProposal(''), StructureError);
  assert.throws(() => structureFromProposal('# Nothing here'), /table "Rulebook copy"/);
});

test('a select without its values, "Values:" on a plain column, and an unresolvable tag list each fail loudly', () => {
  const noValues = proposal().replace('The tag\'s group. Values: Nature, Form, Quality, Style, Tone, Format, Meaning, Usage, Check', 'The tag\'s group.');
  assert.throws(() => structureFromProposal(noValues), /table "Rulebook copy", column "Category": a select needs "Values: a, b, c"/);
  const onText = proposal().replace('| Geo Topics | text | setup | The claim\'s topics in Geo. |', '| Geo Topics | text | setup | The claim\'s topics in Geo. Values: a, b |');
  assert.throws(() => structureFromProposal(onText), /table "Claims copy", column "Geo Topics": "Values:" belongs to a select/);
  const wrongCount = proposal().replace('Values: the 13 tag names of the Rulebook copy', 'Values: the 14 tag names of the Rulebook copy');
  assert.throws(() => structureFromProposal(wrongCount), /column "Tag": "the 14 tag names of the Rulebook copy" cannot be resolved/);
  const twice = proposal().replace('| Agent settings | ', '| Agent settings | ').replace('| Paused | checkbox |', '| Name | checkbox |');
  assert.throws(() => structureFromProposal(twice), /table "Agent settings": the column "Name" is listed twice/);
});

test('a view that cannot be read fails loudly, naming the view', () => {
  assert.throws(() => structureFromProposal(proposal().replace('| Your queue | Tag decisions |', '| Your queue | Tag dispositions |')), /view "Your queue": the table "Tag dispositions"/);
  assert.throws(() => structureFromProposal(proposal().replace('Tag outcome is empty', 'Tag outcome looks empty')), /view "Your queue": cannot read the filter/);
  assert.throws(() => structureFromProposal(proposal().replace('Status is Proposed or Approved', 'Status is Proposed or Maybe')), /view "Lessons waiting": "Maybe" is not a value of "Status"/);
  assert.throws(() => structureFromProposal(proposal().replace('Agent confidence, lowest first | Claim, Tag outcome', 'Agent confidence, shuffled | Claim, Tag outcome')), /view "Needs your note": cannot read the sort/);
  assert.throws(() => structureFromProposal(proposal().replace('Claim, Agent proposal, Agent reason, Tag outcome', 'Claim, Agent mood, Agent reason, Tag outcome')), /view "Your queue": the table "Tag decisions" has no column "Agent mood"/);
});

test('validateStructure refuses a hand-edited structure with a bad shape', () => {
  const s = () => realStructure();
  const bad = (change, re) => {
    const x = s();
    change(x);
    assert.throws(() => validateStructure(x), (e) => e instanceof StructureError && re.test(e.message));
  };
  bad((x) => { delete x.tables.rule_changes; }, /Rule changes/);
  bad((x) => { x.tables.rulebook.columns[1].type = 'dropdown'; }, /unknown type "dropdown"/);
  bad((x) => { x.tables.rulebook.columns[1].options = []; }, /a select needs its values/);
  bad((x) => { x.tables.rulebook.columns[0].options = ['x']; }, /only a select has options/);
  bad((x) => { x.tables.rulebook.columns[2].description = 'x'.repeat(281); }, /at most 280 characters/);
  bad((x) => { x.views[0].columns.push('Nonexistent'); }, /no column "Nonexistent"/);
  bad((x) => { x.views[0].table = 'elsewhere'; }, /not one of/);
  bad((x) => { x.pages = 'Demos'; }, /pages must be a list/);
});

// ---- filters and sorts from words ----------------------------------------------------------------------------------------------------------

test('parseViewFilter and parseViewSort turn the plain words into data-source query filters and sorts', () => {
  const s = realStructure();
  const queue = s.tables.tag_decisions;
  assert.deepEqual(parseViewFilter('Tag outcome is empty', queue), { property: 'Tag outcome', select: { is_empty: true } });
  assert.deepEqual(parseViewFilter('Why wrong is Rule unclear or Rule should change, and Your reasoning is empty', queue), {
    and: [
      { or: [{ property: 'Why wrong', select: { equals: 'Rule unclear' } }, { property: 'Why wrong', select: { equals: 'Rule should change' } }] },
      { property: 'Your reasoning', rich_text: { is_empty: true } },
    ],
  });
  assert.deepEqual(parseViewFilter('Status is Proposed or Approved', s.tables.rule_changes), {
    or: [{ property: 'Status', select: { equals: 'Proposed' } }, { property: 'Status', select: { equals: 'Approved' } }],
  });
  assert.equal(parseViewFilter('all rows', s.tables.rulebook), null);
  assert.deepEqual(parseViewFilter('Follow-up is not empty', queue), { property: 'Follow-up', select: { is_not_empty: true } });
  assert.deepEqual(parseViewFilter('Work tags is Issue', s.tables.rulebook), { property: 'Work tags', multi_select: { contains: 'Issue' } });
  assert.deepEqual(parseViewSort('Agent confidence, lowest first', queue), [{ property: 'Agent confidence', direction: 'ascending' }]);
  assert.deepEqual(parseViewSort('Agent confidence, highest first', queue), [{ property: 'Agent confidence', direction: 'descending' }]);
  assert.deepEqual(parseViewSort('none', queue), []);
  assert.throws(() => parseViewFilter('Nothing is empty', queue, 'view "x"'), /view "x": cannot read the filter/);
  assert.throws(() => parseViewSort('Agent confidence, sideways', queue), /cannot read the sort/);
});

// ---- the plan ----------------------------------------------------------------------------------------------------------------------------------

test('planStructure: a createDatabase body per table in the shape of POST /databases, inline, under the parent page', () => {
  const w = build();
  const { plan, structure, config } = w;
  assert.equal(plan.parent_page_id, config.notion.parent_page_id);
  assert.deepEqual(plan.pages, [{ key: 'demos', title: 'Demos', text: PAGE_TEXT.demos }, { key: 'demo_tests', title: 'Demo tests', text: PAGE_TEXT.demo_tests }]);
  assert.equal(PAGE_TEXT.demos, 'Practice pages made by the walkthrough; never deleted.');
  assert.equal(PAGE_TEXT.demo_tests, 'Test runs of the walkthrough skill.');
  assert.deepEqual(plan.databases.map((d) => d.table), [...TABLES]);
  for (const db of plan.databases) {
    const t = structure.tables[db.table];
    assert.deepEqual(Object.keys(db.body).sort(), ['initial_data_source', 'is_inline', 'parent', 'title']);
    assert.deepEqual(db.body.parent, { type: 'page_id', page_id: config.notion.parent_page_id });
    assert.deepEqual(db.body.title, [{ type: 'text', text: { content: t.title } }]);
    assert.equal(db.body.is_inline, true);
    assert.deepEqual(Object.keys(db.body.initial_data_source.properties), t.columns.map((c) => c.name));
    for (const c of t.columns) {
      const p = db.body.initial_data_source.properties[c.name];
      assert.equal(p.type, c.type, `${t.title}.${c.name}`);
      assert.ok(c.type in p, `${t.title}.${c.name} carries its ${c.type} config`);
      assert.equal(p.description, c.description, `${t.title}.${c.name}`);
    }
  }
  const rb = planStructure(realStructure(), config).databases[0].body.initial_data_source.properties; // the real structure, with the four automatic columns
  assert.deepEqual(rb.Name, { type: 'title', title: {}, description: "The tag's name; one row per tag." });
  assert.deepEqual(rb.Created, { type: 'created_time', created_time: {}, description: 'When the row was made.' });
  assert.deepEqual(rb['Created by'], { type: 'created_by', created_by: {}, description: 'Who made the row.' });
  assert.deepEqual(rb['Last edited by'], { type: 'last_edited_by', last_edited_by: {}, description: 'Who last changed the row.' });
  assert.deepEqual(plan.databases[2].body.initial_data_source.properties['Agent confidence'].number, { format: 'number' });
});

test('planStructure: the Rulebook copy keeps the taxonomy\'s colours, the queue and the lessons get sensible ones', () => {
  const { plan } = build();
  const colors = (table, name) => Object.fromEntries(plan.databases.find((d) => d.table === table).body.initial_data_source.properties[name].select.options.map((o) => [o.name, o.color]));
  const multi = (table, name) => Object.fromEntries(plan.databases.find((d) => d.table === table).body.initial_data_source.properties[name].multi_select.options.map((o) => [o.name, o.color]));
  assert.deepEqual(colors('rulebook', 'Category'), { Nature: 'blue', Form: 'purple', Quality: 'green', Style: 'yellow', Tone: 'orange', Format: 'pink', Meaning: 'default', Usage: 'gray', Check: 'red' });
  assert.deepEqual(colors('rulebook', 'Geo Status'), { 'Existing in Geo': 'green', 'To be created': 'yellow', 'Implemented differently': 'orange' });
  assert.deepEqual(colors('rulebook', 'Polarity'), { Classification: 'blue', Positive: 'green', Issue: 'red' });
  assert.deepEqual(colors('rulebook', 'Status'), { Verified: 'green', Proposed: 'yellow' });
  assert.deepEqual(multi('rulebook', 'Work tags'), { 'Pipeline benchmark check': 'gray', Issue: 'orange' });
  assert.deepEqual(colors('tag_decisions', 'Agent proposal'), { Applies: 'green', 'Does not apply': 'red', "Can't tell": 'yellow' });
  assert.deepEqual(colors('tag_decisions', 'Tag outcome'), { Applies: 'green', 'Does not apply': 'red' });
  assert.deepEqual(colors('tag_decisions', 'Why wrong'), { 'Agent slip': 'gray', 'Rule unclear': 'yellow', 'Rule should change': 'orange' });
  assert.deepEqual(colors('tag_decisions', 'Follow-up'), { Fixed: 'green', 'Still wrong': 'red' });
  assert.deepEqual(colors('rule_changes', 'Status'), { Proposed: 'yellow', Approved: 'blue', Rejected: 'red', Live: 'green', 'Rolled back': 'gray' });
  assert.ok(Object.values(colors('rule_changes', 'Kind')).every((c) => c !== 'default'));
  assert.ok(Object.values(multi('claims_copy', 'Geo Tags')).every((c) => c === 'default'), 'Geo Tags keep the default colour');
  assert.ok(Object.values(colors('tag_decisions', 'Tag')).every((c) => c === 'default'));
  const valid = new Set(['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']);
  for (const table of Object.values(OPTION_COLORS)) for (const column of Object.values(table)) for (const c of Object.values(column)) assert.ok(valid.has(c), c);
});

test('planStructure: a createView body per view with the query filter, the sorts and a table configuration that shows the named columns first', () => {
  const { plan, structure } = build();
  const byName = Object.fromEntries(plan.views.map((v) => [v.name, v]));
  assert.deepEqual(plan.views.map((v) => v.table), ['tag_decisions', 'tag_decisions', 'rule_changes', 'rulebook']);
  const queue = byName['Your queue'];
  assert.deepEqual(queue.body.filter, { property: 'Tag outcome', select: { is_empty: true } });
  assert.deepEqual(queue.body.sorts, [{ property: 'Agent confidence', direction: 'ascending' }]);
  assert.equal(queue.body.type, 'table');
  assert.equal(queue.body.configuration.type, 'table');
  assert.equal(queue.body.configuration.wrap_cells, false);
  const props = queue.body.configuration.properties;
  assert.deepEqual(props.slice(0, 6).map((p) => [p.name, p.visible, p.wrap]), queue.columns.map((n) => [n, true, false]));
  assert.ok(props.slice(6).every((p) => p.visible === false && !('wrap' in p)));
  assert.equal(props.length, structure.tables.tag_decisions.columns.length, 'every column is either shown or hidden');
  assert.deepEqual(props.slice(6).map((p) => p.name), queue.hidden);
  assert.ok(!('filter' in byName.Rulebook.body), 'all rows: no filter');
  assert.ok(!('sorts' in byName.Rulebook.body) && !('sorts' in byName['Lessons waiting'].body), 'none: no sorts');
  assert.equal(byName.Rulebook.body.configuration.wrap_cells, true);
  assert.ok(byName.Rulebook.body.configuration.properties.slice(0, 5).every((p) => p.visible && p.wrap === true));
  assert.deepEqual(byName['Lessons waiting'].body.filter, { or: [{ property: 'Status', select: { equals: 'Proposed' } }, { property: 'Status', select: { equals: 'Approved' } }] });
  assert.equal(byName['Needs your note'].body.filter.and.length, 2);
});

test('completeViewBody puts the property ids of the created data source where the column names were, and nothing else changes', () => {
  const { plan } = build();
  const dataSource = {
    id: 'ds-1', parent: { type: 'database_id', database_id: 'db-1' },
    properties: Object.fromEntries(['Claim', 'Key', 'Tag', 'Agent proposal', 'Agent confidence', 'Agent reason', 'Claim link', 'Rulebook edition', 'Follow-up', 'Tag outcome', 'Why wrong', 'Your reasoning']
      .map((n, i) => [n, { id: n === 'Claim' ? 'title' : `%3A${i}`, name: n }])),
  };
  const view = plan.views.find((v) => v.name === 'Your queue');
  const body = completeViewBody(view, dataSource);
  assert.equal(body.database_id, 'db-1');
  assert.equal(body.data_source_id, 'ds-1');
  assert.deepEqual({ name: body.name, type: body.type, filter: body.filter, sorts: body.sorts }, { name: 'Your queue', type: 'table', filter: view.body.filter, sorts: view.body.sorts });
  assert.deepEqual(body.configuration.properties[0], { property_id: 'title', visible: true, wrap: false });
  assert.deepEqual(body.configuration.properties[1], { property_id: '%3A3', visible: true, wrap: false });
  assert.deepEqual(body.configuration.properties[6], { property_id: '%3A1', visible: false });
  assert.ok(body.configuration.properties.every((p) => !('name' in p) && !('property' in p)));
  assert.equal(completeViewBody(view, dataSource, { databaseId: 'other' }).database_id, 'other');
  assert.throws(() => completeViewBody(view, { ...dataSource, properties: { Claim: { id: 'title' } } }), /the table has no column "Key"|no column "Agent proposal"/);
  assert.throws(() => completeViewBody(view, {}), StructureError);
});

test('planStructure needs a parent page and a valid structure', () => {
  const w = build();
  const noParent = structuredClone(w.config);
  noParent.notion.parent_page_id = '<none>';
  assert.throws(() => planStructure(w.structure, noParent), /parent_page_id/);
  assert.throws(() => planStructure({ tables: {} }, w.config), StructureError);
});

// ---- running it against the fake -----------------------------------------------------------------------------------------------------------------

test('runStructure makes two pages, five tables and four views, once each, and never deletes: the requests are the planned bodies', async () => {
  const w = build();
  const result = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  assert.equal(result.ok, true);
  assert.equal(result.code, EXIT.OK);
  assert.equal(result.stopped, null);
  assert.deepEqual(result.created, { pages: 2, databases: 5, views: 4 });
  assert.equal(posts(w.fake, '/pages').length, 2);
  assert.equal(posts(w.fake, '/databases').length, 5);
  assert.equal(posts(w.fake, '/views').length, 4);
  assert.ok(w.fake.requests.every((r) => r.method === 'GET' || r.method === 'POST'), 'no PATCH and no DELETE');
  assert.ok(w.fake.requests.every((r) => r.version === '2026-03-11'), 'the builder version on every request');
  assert.deepEqual(posts(w.fake, '/databases').map((r) => r.body), w.plan.databases.map((d) => d.body), 'the bodies sent are the bodies planned');
  const pageBodies = posts(w.fake, '/pages').map((r) => r.body);
  assert.deepEqual(pageBodies.map((b) => b.parent), [{ type: 'page_id', page_id: w.parent }, { type: 'page_id', page_id: w.parent }]);
  assert.deepEqual(pageBodies.map((b) => b.properties.title.title[0].text.content), ['Demos', 'Demo tests']);
  assert.deepEqual(pageBodies.map((b) => b.children[0].paragraph.rich_text[0].text.content), [PAGE_TEXT.demos, PAGE_TEXT.demo_tests]);
  assert.deepEqual(w.fake.writes().map((r) => r.method), w.fake.writes().map(() => 'POST'));
});

test('runStructure: the fake holds the tables as planned, and every view body is the plan completed with the table\'s property ids', async () => {
  const w = build();
  await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  for (const db of w.plan.databases) {
    const entry = result0(w, db.table);
    const stored = w.fake.database(entry.database_id);
    assert.equal(stored.title[0].plain_text, db.title);
    assert.equal(stored.is_inline, true);
    assert.equal(normId(stored.parent.page_id), normId(w.parent));
    const columns = Object.values(stored.properties);
    assert.deepEqual(columns.map((c) => c.name), Object.keys(db.body.initial_data_source.properties));
    assert.ok(columns.every((c) => (c.description ?? '').length <= 280));
  }
  const viewPosts = posts(w.fake, '/views');
  for (const post of viewPosts) {
    const view = w.plan.views.find((v) => v.name === post.body.name);
    const entry = result0(w, view.table);
    const { position, ...rest } = post.body;
    assert.deepEqual(rest, completeViewBody(view, w.fake.dataSource(entry.data_source_id), { databaseId: entry.database_id }));
    assert.ok(position, 'every view is placed in the tab bar');
  }
  const stored = w.fake.views(result0(w, 'tag_decisions').database_id);
  assert.deepEqual(stored.map((v) => v.name), ['Your queue', 'Needs your note']);
  assert.deepEqual(stored[0].filter, { property: 'Tag outcome', select: { is_empty: true } });
  assert.deepEqual(stored[0].sorts, [{ property: 'Agent confidence', direction: 'ascending' }]);
  assert.equal(stored[0].configuration.properties.filter((p) => p.visible).length, 6);
});

function result0(w, table) {
  const config = readJson(join(w.root, 'config.json'));
  const entry = table === 'rulebook' ? config.notion.rulebook : table === 'claims_copy' ? config.notion.claims[0] : config.notion.databases[table];
  return entry;
}

test('runStructure records every id in the registry, in config.json on disk, in the config object and in runs/builder/state.json', async () => {
  const w = build();
  const result = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  const disk = readJson(join(w.root, 'config.json'));
  assert.equal(disk.notion.pages.demos, normId(result.pages.demos.id));
  assert.equal(disk.notion.pages.demo_tests, normId(result.pages.demo_tests.id));
  assert.equal(disk.notion.pages.proposal, loadConfig(join(w.root)).notion.pages.proposal, 'the page that was there is untouched');
  assert.equal(w.config.notion.pages.demos, disk.notion.pages.demos, 'the config object in memory agrees');
  const entries = { rulebook: disk.notion.rulebook, claims_copy: disk.notion.claims[0], tag_decisions: disk.notion.databases.tag_decisions, rule_changes: disk.notion.databases.rule_changes, agent_settings: disk.notion.databases.agent_settings };
  for (const [table, entry] of Object.entries(entries)) {
    assert.equal(entry.database_id, result.databases[table].database_id, table);
    assert.match(entry.database_id, /^[0-9a-f]{32}$/);
    assert.match(entry.data_source_id, /^[0-9a-f]{32}$/);
    assert.equal(entry.data_source_id, normId(w.fake.database(entry.database_id).data_sources[0].id));
  }
  assert.equal(w.config.notion.rulebook.database_id, disk.notion.rulebook.database_id);
  assert.equal(w.config.notion.claims[0].data_source_id, disk.notion.claims[0].data_source_id);
  const registry = readJson(join(w.root, 'runs', 'builder', 'databases.json'));
  for (const table of TABLES) {
    assert.equal(registry.names[table], entries[table].database_id);
    assert.equal(registry.names[`${table}_data_source`], entries[table].data_source_id);
    assert.ok(registry.ids.includes(entries[table].database_id) && registry.ids.includes(entries[table].data_source_id));
  }
  const pages = readJson(join(w.root, 'runs', 'builder', 'pages.json'));
  assert.deepEqual(Object.keys(pages.names), ['demos', 'demo_tests']);
  const state = readJson(join(w.root, 'runs', 'builder', 'state.json'));
  assert.equal(state.tables.tag_decisions.views, 'ok');
  assert.deepEqual(Object.keys(state.tables.tag_decisions.view_ids), ['Your queue', 'Needs your note']);
  assert.equal(state.pages.demos.status, 'created');
  assert.ok(existsSync(join(w.root, 'runs', 'builder', 'log.jsonl')));
  assert.equal(loadConfig(w.root).notion.rulebook.database_id, disk.notion.rulebook.database_id, 'config.json is still a valid config');
});

test('runStructure writes every view\'s id and link into config.json notion.views, in the order of the proposal', async () => {
  const w = build();
  const result = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  const disk = readJson(join(w.root, 'config.json'));
  assert.deepEqual(Object.keys(disk.notion.views), ['your_queue', 'needs_your_note', 'lessons_waiting', 'rulebook']);
  assert.deepEqual(w.config.notion.views, disk.notion.views, 'the config object in memory agrees');
  const ids = {};
  for (const table of ['tag_decisions', 'rule_changes', 'rulebook']) for (const v of w.fake.views(result0(w, table).database_id)) ids[v.name] = { id: v.id, database: result0(w, table).database_id };
  const expected = (name) => ({ id: normId(ids[name].id), url: `https://www.notion.so/${normId(ids[name].database)}?v=${normId(ids[name].id)}` });
  assert.deepEqual(disk.notion.views.your_queue, expected('Your queue'));
  assert.deepEqual(disk.notion.views.needs_your_note, expected('Needs your note'));
  assert.deepEqual(disk.notion.views.lessons_waiting, expected('Lessons waiting'));
  assert.deepEqual(disk.notion.views.rulebook, expected('Rulebook'));
  for (const entry of Object.values(disk.notion.views)) {
    assert.deepEqual(Object.keys(entry), ['id', 'url']);
    assert.match(entry.id, /^[0-9a-f]{32}$/);
    assert.match(entry.url, /^https:\/\/www\.notion\.so\/[0-9a-f]{32}\?v=[0-9a-f]{32}$/);
  }
  assert.equal(viewKey('Your queue'), 'your_queue');
  assert.equal(viewUrl('3FA273E2-14EB-805B-8A2C-D9E1AF3B0001', '0e100000-0000-4000-8000-00000000008c'), 'https://www.notion.so/3fa273e214eb805b8a2cd9e1af3b0001?v=0e10000000004000800000000000008c');
  assert.equal(result.views.tag_decisions['Your queue'].url, disk.notion.views.your_queue.url);
  assert.equal(loadConfig(w.root).notion.views.rulebook.id, disk.notion.views.rulebook.id, 'config.json is still a valid config');
});

test('a view that exists but is not in config.json yet (a run that stopped after making it) is recorded by the next run; a view that failed has no key', async () => {
  const w = build();
  await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  const before = readJson(join(w.root, 'config.json')).notion.views;
  const lost = readJson(join(w.root, 'config.json'));
  delete lost.notion.views;
  writeFileSync(join(w.root, 'config.json'), JSON.stringify(lost, null, 2));
  const again = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: loadConfig(w.root) });
  assert.equal(again.created.views, 0, 'nothing is made again');
  assert.deepEqual(readJson(join(w.root, 'config.json')).notion.views, before, 'the same ids and links, recorded again');

  const refused = build();
  refused.fake.failNext('POST', /^\/views$/, 404, 1);
  const result = await runStructure({ plan: refused.plan, client: refused.client, root: refused.root, config: refused.config });
  assert.equal(result.views.rulebook.Rulebook.status, 'failed');
  assert.deepEqual(Object.keys(readJson(join(refused.root, 'config.json')).notion.views), ['your_queue', 'needs_your_note', 'lessons_waiting'], 'no key for the view that could not be made');
  assert.ok(!('rulebook' in refused.config.notion.views));
  await runStructure({ plan: refused.plan, client: refused.client, root: refused.root, config: loadConfig(refused.root) });
  assert.deepEqual(Object.keys(readJson(join(refused.root, 'config.json')).notion.views), ['your_queue', 'needs_your_note', 'lessons_waiting', 'rulebook'], 'the next run adds it');
});

test('two views with the same name are refused: notion.views is keyed by the name', () => {
  const s = realStructure();
  s.views.push({ ...s.views[0], table: 'rule_changes', columns: ['Lesson'], filter: 'all rows', sort: 'none' });
  assert.throws(() => validateStructure(s), (e) => e instanceof StructureError && /view "Your queue": two views have this name/.test(e.message));
});

test('runStructure is resumable: a second run, even from a config read off the disk, makes nothing again', async () => {
  const w = build();
  await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  const before = w.fake.requests.length;
  const again = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: loadConfig(w.root) });
  assert.equal(again.ok, true);
  assert.deepEqual(again.created, { pages: 0, databases: 0, views: 0 });
  assert.deepEqual(Object.values(again.pages).map((p) => p.status), ['exists', 'exists']);
  assert.deepEqual(Object.values(again.databases).map((d) => d.status), Array(5).fill('exists'));
  assert.deepEqual(Object.values(again.views).flatMap((v) => Object.values(v).map((x) => x.status)), Array(4).fill('exists'));
  assert.equal(w.fake.writes().length, 11, 'two pages, five tables and four views, once');
  assert.ok(w.fake.requests.slice(before).every((r) => r.method === 'GET'), 'the second run only reads');
  assert.equal(readJson(join(w.root, 'runs', 'builder', 'state.json')).pages.demos.status, 'created', 'the state keeps how a thing came to be');
});

test('a run that crashes between two creates is finished by the next run: nothing is made twice', async () => {
  const w = build();
  let calls = 0;
  const crashing = {
    ...w.client,
    async createDatabase(args) {
      calls += 1;
      if (calls === 3) throw new Error('the process died');
      return w.client.createDatabase(args);
    },
  };
  const first = await runStructure({ plan: w.plan, client: crashing, root: w.root, config: w.config });
  assert.equal(first.ok, false);
  assert.equal(first.stopped.reason, 'error');
  assert.match(first.stopped.what, /Tag decisions/);
  assert.deepEqual(Object.keys(first.databases), ['rulebook', 'claims_copy']);
  assert.equal(posts(w.fake, '/databases').length, 2);
  assert.equal(readJson(join(w.root, 'config.json')).notion.databases.tag_decisions.database_id, '<setup>');

  const second = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: loadConfig(w.root) });
  assert.equal(second.ok, true);
  assert.equal(posts(w.fake, '/databases').length, 5, 'three more, none again');
  assert.equal(new Set(posts(w.fake, '/databases').map((r) => r.body.title[0].text.content)).size, 5, 'five different titles');
  assert.equal(posts(w.fake, '/pages').length, 2);
  assert.equal(posts(w.fake, '/views').length, 4);
  assert.deepEqual(second.created, { pages: 0, databases: 3, views: 4 });
});

test('a table made just before a crash, before its id was recorded, is found by its title under the parent page and adopted', async () => {
  const w = build();
  const made = [];
  const listing = () => made.map((m) => ({ object: 'block', id: m.id, type: 'child_database', child_database: { title: m.title } }));
  const flaky = {
    ...w.client,
    async createDatabase(args) {
      const res = await w.client.createDatabase(args);
      made.push({ id: res.id, title: args.title });
      if (made.length === 2) throw new Error('the process died after Notion answered');
      return res;
    },
    async retrieveBlockChildren() {
      return listing();
    },
  };
  const first = await runStructure({ plan: w.plan, client: flaky, root: w.root, config: w.config });
  assert.equal(first.ok, false);
  assert.deepEqual(Object.keys(first.databases), ['rulebook'], 'the second table was made but not recorded');
  assert.equal(posts(w.fake, '/databases').length, 2);

  const lister = { ...w.client, async retrieveBlockChildren() { return listing(); } };
  const second = await runStructure({ plan: w.plan, client: lister, root: w.root, config: loadConfig(w.root) });
  assert.equal(second.ok, true);
  assert.equal(second.databases.claims_copy.status, 'adopted');
  assert.equal(second.databases.claims_copy.database_id, normId(made[1].id));
  assert.equal(posts(w.fake, '/databases').length, 5, 'four titles made once each, the fifth is the adopted one: 5 in all');
  assert.equal(new Set(posts(w.fake, '/databases').map((r) => r.body.title[0].text.content)).size, 5, 'no title twice');
  assert.equal(readJson(join(w.root, 'config.json')).notion.claims[0].database_id, normId(made[1].id));
});

test('a page found under the parent page is adopted too, and a protected table is never adopted', async () => {
  const w = build();
  const children = [{ object: 'block', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', type: 'child_page', child_page: { title: 'Demos' } }];
  const listing = { ...w.client, async retrieveBlockChildren() { return children; } };
  const result = await runStructure({ plan: w.plan, client: listing, root: w.root, config: w.config, parts: ['pages'] });
  assert.equal(result.pages.demos.status, 'adopted');
  assert.equal(result.pages.demos.id, 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa');
  assert.equal(result.pages.demo_tests.status, 'created');
  assert.equal(posts(w.fake, '/pages').length, 1);

  const evil = build();
  const protectedId = evil.config.notion.protected_database_ids[0];
  const trap = {
    ...evil.client,
    async retrieveBlockChildren() { return [{ object: 'block', id: protectedId, type: 'child_database', child_database: { title: 'Rulebook copy' } }]; },
    async retrieveDatabase() { return { id: protectedId, data_sources: [{ id: evil.config.notion.protected_database_ids[1] }] }; },
  };
  const refused = await runStructure({ plan: evil.plan, client: trap, root: evil.root, config: evil.config, parts: ['databases'] });
  assert.equal(refused.ok, false);
  assert.match(refused.stopped.message, /protected list/);
  assert.equal(posts(evil.fake, '/databases').length, 0);
});

test('a create whose answer was lost stops the run, says what to check, and is not sent again', async () => {
  const w = build();
  w.fake.failNext('POST', /^\/databases$/, 'network', 1, { applied: true });
  const result = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  assert.equal(result.ok, false);
  assert.equal(result.code, EXIT.ERROR);
  assert.equal(result.stopped.reason, 'create_uncertain');
  assert.match(result.stopped.what, /Rulebook copy/);
  assert.match(result.stopped.next, /Look under the parent page/);
  assert.match(result.stopped.message, /may exist in Notion already/);
  assert.equal(posts(w.fake, '/databases').length, 1, 'one POST, no second try');
  assert.deepEqual(Object.keys(result.databases), []);
  assert.equal(readJson(join(w.root, 'config.json')).notion.rulebook.database_id, '<setup>', 'nothing was recorded for the table');
  assert.equal(posts(w.fake, '/views').length, 0, 'and nothing after it was made');
  assert.equal(Object.keys(result.pages).length, 2, 'what came before is recorded');
});

test('a lost page create stops the same way; a lost view create stops the views', async () => {
  const w = build();
  w.fake.failNext('POST', /^\/pages$/, 503, 1);
  const lostPage = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  assert.equal(lostPage.stopped.reason, 'create_uncertain');
  assert.match(lostPage.stopped.what, /page "Demos"/);
  assert.equal(posts(w.fake, '/pages').length, 1);

  const v = build();
  await runStructure({ plan: v.plan, client: v.client, root: v.root, config: v.config, parts: ['pages', 'databases'] });
  v.fake.failNext('POST', /^\/views$/, 'network', 1);
  const lostView = await runStructure({ plan: v.plan, client: v.client, root: v.root, config: v.config, parts: ['views'] });
  assert.equal(lostView.stopped.reason, 'create_uncertain');
  assert.match(lostView.stopped.what, /view "Rulebook" of "rulebook"/);
  assert.equal(posts(v.fake, '/views').length, 1);
});

test('a view that Notion refuses (400 or 404) is recorded as failed and the run goes on; the next run makes it', async () => {
  for (const status of [400, 404]) {
    const w = build();
    const attempts = status === 400 ? 2 : 1; // a 400 is asked again once without the place in the tab bar; a 404 is not
    w.fake.failNext('POST', /^\/views$/, status, attempts);
    const result = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
    assert.equal(result.ok, true, `${status}: the run goes on`);
    assert.equal(result.code, EXIT.OK);
    assert.equal(result.views.rulebook.Rulebook.status, 'failed');
    assert.match(result.views.rulebook.Rulebook.message, new RegExp(String(status)));
    assert.equal(result.created.views, 3, 'the other three were made');
    const state = readJson(join(w.root, 'runs', 'builder', 'state.json'));
    assert.match(state.tables.rulebook.views, /^failed: /);
    assert.match(state.tables.rulebook.view_status.Rulebook, /^failed: /);
    assert.equal(state.tables.tag_decisions.views, 'ok');
    assert.equal(posts(w.fake, '/views').length, 3 + attempts, 'three made and one refused');

    const again = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: loadConfig(w.root) });
    assert.equal(again.views.rulebook.Rulebook.status, 'created');
    assert.equal(posts(w.fake, '/views').length, 4 + attempts);
    assert.deepEqual(again.created, { pages: 0, databases: 0, views: 1 });
  }
});

test('the views go first in the tab bar, in the order of the proposal; a place that Notion does not take is asked for again without it', async () => {
  const w = build();
  await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  const byName = Object.fromEntries(posts(w.fake, '/views').map((r) => [r.body.name, r.body]));
  assert.deepEqual(byName.Rulebook.position, { type: 'start' });
  assert.deepEqual(byName['Your queue'].position, { type: 'start' });
  assert.deepEqual(byName['Lessons waiting'].position, { type: 'start' });
  const queueId = w.fake.views(result0(w, 'tag_decisions').database_id).find((v) => v.name === 'Your queue').id;
  assert.deepEqual(byName['Needs your note'].position, { type: 'after_view', view_id: queueId });

  const retry = build();
  const log = [];
  const asked = [];
  const recording = { ...retry.client, createView: (args) => { asked.push([args.name, args.position]); return retry.client.createView(args); } };
  retry.fake.failNext('POST', /^\/views$/, 400, 1, { message: 'body.position should not be present' });
  const result = await runStructure({ plan: retry.plan, client: recording, root: retry.root, config: retry.config, log: (l) => log.push(l) });
  assert.equal(result.views.rulebook.Rulebook.status, 'created', 'the second ask, without a place, was taken');
  assert.deepEqual(asked.filter(([name]) => name === 'Rulebook'), [['Rulebook', { type: 'start' }], ['Rulebook', undefined]]);
  assert.ok(log.some((l) => /did not take its place in the tab bar/.test(l)));
  assert.equal(asked.length, 5, 'four views and one second ask');
  assert.equal(retry.fake.views(result0(retry, 'rulebook').database_id).length, 1, 'the refused ask made nothing, so the second one made no duplicate');
});

test('the views need their tables: asked for first, they stop with exit 2 and say which command comes before', async () => {
  const w = build();
  const result = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config, parts: ['views'] });
  assert.equal(result.ok, false);
  assert.equal(result.code, EXIT.INVALID);
  assert.match(result.stopped.message, /not created yet; run "setup.mjs databases" first/);
  assert.equal(w.fake.writes().length, 0);
});

test('the builder never builds under a protected page, and a refused database create is exit 2 with the reason', async () => {
  const w = build();
  const config = structuredClone(w.config);
  config.notion.protected_page_ids.push(config.notion.parent_page_id);
  await assert.rejects(runStructure({ plan: planStructure(w.structure, config), client: w.client, root: w.root, config }), (e) => e instanceof StructureError && /protected list/.test(e.message));
  assert.equal(w.fake.requests.length, 0);

  const refused = build();
  refused.fake.failNext('POST', /^\/databases$/, 400, 1, { message: 'body.initial_data_source.properties.Created by should be defined' });
  const result = await runStructure({ plan: refused.plan, client: refused.client, root: refused.root, config: refused.config });
  assert.equal(result.code, EXIT.INVALID);
  assert.equal(result.stopped.reason, 'refused');
  assert.match(result.stopped.message, /Created by/);
  assert.match(result.stopped.next, /remove those two columns from setup\/structure\.json/);
});

test('runStructure checks what it is given', async () => {
  const w = build();
  await assert.rejects(runStructure({ client: w.client, config: w.config }), TypeError);
  await assert.rejects(runStructure({ plan: w.plan, config: w.config }), TypeError);
  await assert.rejects(runStructure({ plan: w.plan, client: w.client }), TypeError);
});

// ---- reading it back ---------------------------------------------------------------------------------------------------------------------------

async function built() {
  const w = build();
  await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  return w;
}
const verify = (w, structure = w.structure) => verifyStructure({ client: w.client, config: w.config, structure });
const kinds = (r) => r.differences.map((d) => d.kind);

test('verifyStructure finds nothing wrong with what runStructure built', async () => {
  const w = await built();
  const r = await verify(w);
  assert.deepEqual([r.ok, r.differences], [true, []]);
  assert.deepEqual(Object.fromEntries(Object.entries(r.views).map(([table, v]) => [table, Object.keys(v)])), { rulebook: ['Rulebook'], tag_decisions: ['Your queue', 'Needs your note'], rule_changes: ['Lessons waiting'] }, 'the ids of the views it found');
  const reads = w.fake.requests.filter((x) => x.method !== 'GET' && !/\/query$/.test(x.path));
  assert.equal(reads.length, 11, 'verify sent nothing: only the 11 creates of the build are writes');
});

test('verifyStructure finds a missing option, an extra option, a missing column, an extra column and a wrong type', async () => {
  const w = await built();
  const entry = result0(w, 'tag_decisions');
  await w.client.updateDataSource(entry.data_source_id, { properties: { 'Agent proposal': { select: { options: [{ name: 'Applies' }, { name: 'Does not apply' }, { name: 'Maybe' }] } } } });
  await w.client.updateDataSource(entry.data_source_id, { properties: { 'Side note': { type: 'rich_text', rich_text: {} } } });
  const r = await verify(w);
  assert.equal(r.ok, false);
  const options = r.differences.find((d) => d.kind === 'options');
  assert.equal(options.table, 'tag_decisions');
  assert.match(options.detail, /"Agent proposal": missing "Can't tell"; extra "Maybe"/);
  const extra = r.differences.find((d) => d.kind === 'extra column');
  assert.match(extra.detail, /"Side note" \(rich_text\)/);

  const other = structuredClone(w.structure);
  column(other, 'tag_decisions', 'Agent reason').type = 'select';
  column(other, 'tag_decisions', 'Agent reason').options = ['x'];
  other.tables.rule_changes.columns.push({ name: 'Brand new', type: 'checkbox', options: [], description: '' });
  const r2 = await verify(w, other);
  assert.ok(r2.differences.some((d) => d.kind === 'type' && d.table === 'tag_decisions' && /"Agent reason" is rich_text in Notion but select/.test(d.detail)));
  assert.ok(r2.differences.some((d) => d.kind === 'missing column' && d.table === 'rule_changes' && /"Brand new" \(checkbox\)/.test(d.detail)));
});

test('option comparison is by name set, order ignored; the automatic columns compare by type only', async () => {
  const w = await built();
  const shuffled = structuredClone(w.structure);
  column(shuffled, 'rulebook', 'Category').options.reverse();
  column(shuffled, 'rulebook', 'Created').description = 'a different description';
  assert.deepEqual((await verify(w, shuffled)).differences, []);
  if (FAKE_HAS_USER_COLUMNS) {
    const types = Object.fromEntries(Object.values(w.fake.database(result0(w, 'rulebook').database_id).properties).filter((p) => /created|edited/.test(p.type)).map((p) => [p.name, p.type]));
    assert.deepEqual(types, { Created: 'created_time', 'Created by': 'created_by', 'Last edited': 'last_edited_time', 'Last edited by': 'last_edited_by' });
  }
});

test('verifyStructure finds a missing view, and a view whose filter, sort, columns or wrap differ', async () => {
  const w = await built();
  const other = structuredClone(w.structure);
  other.views.push({ name: 'Brand new view', table: 'tag_decisions', filter: 'all rows', sort: 'none', columns: ['Claim'], wrap: false });
  const find = (name) => other.views.find((v) => v.name === name);
  find('Your queue').filter = 'Tag outcome is not empty';
  find('Needs your note').sort = 'Agent confidence, highest first';
  find('Lessons waiting').columns = ['Lesson', 'Status'];
  find('Rulebook').wrap = false;
  const r = await verify(w, other);
  assert.deepEqual(kinds(r).sort(), ['missing view', 'view columns', 'view filter', 'view sort', 'view wrap']);
  assert.match(r.differences.find((d) => d.kind === 'missing view').detail, /"Brand new view"/);
  assert.match(r.differences.find((d) => d.kind === 'view filter').detail, /"Your queue"/);
  assert.match(r.differences.find((d) => d.kind === 'view sort').detail, /"Needs your note"/);
  assert.match(r.differences.find((d) => d.kind === 'view columns').detail, /"Lessons waiting": expected Lesson, Status; found Lesson, Current text, Proposed text, Status/);
  assert.match(r.differences.find((d) => d.kind === 'view wrap').detail, /"Rulebook": cells should not wrap, and they do/);
});

test('a view read back with property ids instead of names, or with a lone "and" around its filter, is still the same view', async () => {
  const w = await built();
  const real = w.client;
  const idsFor = (table) => w.fake.dataSource(result0(w, table).data_source_id).properties;
  const reshaping = {
    ...real,
    async retrieveView(id) {
      const view = await real.retrieveView(id);
      const props = idsFor(Object.keys(w.fake.dataSource(view.data_source_id).properties).includes('Lesson') ? 'rule_changes' : Object.keys(w.fake.dataSource(view.data_source_id).properties).includes('Claim') ? 'tag_decisions' : 'rulebook');
      const toId = (name) => props[name]?.id ?? name;
      const swap = (f) => (f.and || f.or ? { [f.and ? 'and' : 'or']: (f.and ?? f.or).map(swap) } : { ...f, property: toId(f.property) });
      return {
        ...view,
        filter: view.filter ? { and: [swap(view.filter)] } : null,
        sorts: (view.sorts ?? []).map((s) => ({ ...s, property: toId(s.property) })),
      };
    },
  };
  const r = await verifyStructure({ client: reshaping, config: w.config, structure: w.structure });
  assert.deepEqual([r.ok, r.differences], [true, []]);
});

test('a table that is not in config.json yet, or cannot be read, or a view list that cannot be read, is reported, never skipped', async () => {
  const w = build();
  const r = await verifyStructure({ client: w.client, config: w.config, structure: w.structure });
  assert.equal(r.ok, false);
  assert.deepEqual(r.differences.map((d) => d.kind), Array(5).fill('missing table'));
  assert.equal(w.fake.requests.length, 0);

  const done = await built();
  done.fake.failNext('GET', /^\/data_sources\//, 404, 1);
  const unreadable = await verify(done);
  assert.deepEqual(unreadable.differences.map((d) => d.kind), ['missing table']);
  assert.match(unreadable.differences[0].detail, /cannot be read/);

  done.fake.failNext('GET', /^\/views\?/, 400, 3);
  const noViews = await verify(done);
  assert.equal(noViews.ok, false);
  assert.ok(noViews.differences.every((d) => d.kind === 'missing view' && /cannot be checked/.test(d.detail)));
  assert.ok(noViews.differences.length >= 3);
});

// ---- the dry run ---------------------------------------------------------------------------------------------------------------------------------

test('renderPreview lists the sub-pages, every table with its columns and options, and the views', () => {
  const md = renderPreview(realStructure());
  assert.match(md, /^# Structure preview/);
  assert.match(md, /5 tables, 58 columns, 4 views and 2 sub-pages/);
  for (const title of ['Rulebook copy', 'Claims copy', 'Tag decisions', 'Rule changes', 'Agent settings']) assert.match(md, new RegExp(`## ${title} \\(\\d+ columns\\)`));
  assert.match(md, /## Rulebook copy \(17 columns\)/);
  assert.match(md, /\| Category \| select \| Nature, Form, Quality, Style, Tone, Format, Meaning, Usage, Check \| The tag's group\. \|/);
  assert.match(md, /\| Created by \| created_by \|/);
  assert.match(md, /- \*\*Your queue\*\*: rows shown: Tag outcome is empty; sorted by: Agent confidence, lowest first; columns: Claim, Agent proposal/);
  assert.match(md, /- \*\*Rulebook\*\*: rows shown: all rows; sorted by: none; columns: Name, Category, Status, When to use, Example Claims; cells wrap/);
  assert.match(md, /- Demos: Practice pages made by the walkthrough/);
  assert.equal(md, renderPreview(realStructure()), 'the same text every time');
});

test('the structure file written from the repository proposal is the file the build reads', () => {
  const s = realStructure();
  const root = tmp('structure-roundtrip');
  saveStructure(root, s);
  writeFileSync(join(root, 'config.json'), JSON.stringify(testConfig({ parent: '0a9e0000-0000-4000-8000-000000000001' }), null, 2));
  assert.deepEqual(planStructure(loadStructure(root), loadConfig(root)).databases.map((d) => d.table), [...TABLES]);
  const fake = createFakeNotion();
  assert.ok(fake);
});
