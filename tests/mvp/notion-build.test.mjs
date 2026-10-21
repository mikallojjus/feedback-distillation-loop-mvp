import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TABLES, loadConfig } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import { EXIT } from '../../agents/claim-tagger-mvp/scripts/lib/exit-codes.mjs';
import {
  OPTION_COLORS, PAGE_TEXT, StructureError, arrangeOwnViews, completeViewBody, countStructure, loadStructure, parseViewFilter, parseViewSort, planStructure, renderPreview,
  runStructure, saveStructure, structureFromProposal, validateStructure, verifyStructure, viewKey, viewUrl,
} from '../../agents/claim-tagger-mvp/scripts/lib/notion-build.mjs';
import { normId } from '../../agents/claim-tagger-mvp/scripts/lib/notion-values.mjs';
import { createFakeNotion } from './fixtures/fake-notion.mjs';
import {
  FAKE_HAS_USER_COLUMNS, STRUCTURE_MD, TAG_NAMES, builderClient, cleanTmp, forFake, newWorld, readJson, realStructure, revisedStructure, testConfig, tmp,
} from './helpers/setup-world.mjs';

// The structure builder: the proposal read into a structure, the REST plan made from it, the plan run against the shared in-memory Notion
// (resumably) and read back. The real client runs over the fake, so its own rules (a create is never sent twice) are in play.

after(cleanTmp);

const proposal = () => readFileSync(STRUCTURE_MD, 'utf8');
const column = (structure, table, name) => structure.tables[table].columns.find((c) => c.name === name);
const posts = (fake, path) => fake.requests.filter((r) => r.method === 'POST' && r.path === path);

/** A world with the plan made: a config over the fake, the revised structure as the fake can build it, a builder client. */
function build({ protectedIds } = {}) {
  const w = newWorld({ protectedIds });
  const structure = forFake(revisedStructure());
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
  assert.throws(() => structureFromProposal(proposal().split('Status is Proposed or Approved').join('Status is Proposed or Maybe')), /view "Lessons waiting": "Maybe" is not a value of "Status"/);
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
    // a relation column is left out of the create: the table it points at may not exist yet (it is added after the tables are made); a retired column is never made
    assert.deepEqual(Object.keys(db.body.initial_data_source.properties), t.columns.filter((c) => c.type !== 'relation' && !c.retired).map((c) => c.name));
    for (const c of t.columns.filter((x) => x.type !== 'relation' && !x.retired)) {
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

test('planStructure: columns lists every column but the title, with the table a relation points at', () => {
  const { plan, structure } = build();
  assert.deepEqual(plan.columns.map((c) => c.table).filter((t, i, all) => all.indexOf(t) === i), [...TABLES]);
  assert.equal(plan.columns.length, Object.values(structure.tables).reduce((n, t) => n + t.columns.filter((c) => c.type !== 'title').length, 0));
  assert.ok(plan.columns.every((c) => c.name !== 'Geo Name' && c.name !== 'Claim' && c.name !== 'Lesson'), 'a title column cannot be added');
  const relations = plan.columns.filter((c) => c.type === 'relation');
  assert.deepEqual(relations.map((c) => ({ table: c.table, name: c.name, relation_to: c.relation_to })), [
    { table: 'claims_copy', name: 'Agent tags', relation_to: 'rulebook' }, { table: 'claims_copy', name: 'Tags waiting', relation_to: 'rulebook' },
    { table: 'claims_copy', name: 'Verified tags', relation_to: 'rulebook' },
  ]);
  for (const relation of relations) assert.deepEqual(relation.body.relation, { single_property: {} }, 'the data source id is added when the column is, once the Rulebook copy exists');
  assert.equal(relations[2].renamed_from, 'Claim quality tags — verified', 'the column of the first build that Verified tags replaces');
  const retired = plan.columns.filter((c) => c.retired);
  assert.deepEqual(retired.map((c) => [c.name, c.renamed_from, c.type]), [['Agent tags (old)', 'Agent tags', 'rich_text'], ['Agent notes (old)', 'Agent notes', 'rich_text']], 'the two text columns of the first build are renamed, never made');
  assert.equal(plan.columns.filter((c) => c.renamed_from).length, 3);
  assert.deepEqual(plan.columns.find((c) => c.name === 'Review status').body.select.options.map((o) => [o.name, o.color]), [['To review', 'yellow'], ['Reviewed', 'green']]);
});

test('validateStructure: a relation names another table, and nothing else has relation_to; a renamed view names another name', () => {
  const bad = (change, re) => {
    const x = revisedStructure();
    change(x);
    assert.throws(() => validateStructure(x), (e) => e instanceof StructureError && re.test(e.message));
  };
  const relation = (x) => x.tables.claims_copy.columns.find((c) => c.type === 'relation');
  bad((x) => { delete relation(x).relation_to; }, /a relation names another of the five tables in relation_to/);
  bad((x) => { relation(x).relation_to = 'claims_copy'; }, /a relation names another of the five tables/);
  bad((x) => { relation(x).relation_to = 'elsewhere'; }, /a relation names another of the five tables/);
  bad((x) => { x.tables.claims_copy.columns.find((c) => c.name === 'Agent confidence').relation_to = 'rulebook'; }, /only a relation has relation_to/);
  bad((x) => { x.tables.claims_copy.columns.find((c) => c.name === 'Verified tags').renamed_from = 'Verified tags'; }, /renamed_from must be another name/);
  bad((x) => { x.tables.claims_copy.columns.find((c) => c.name === 'Verified tags').renamed_from = 'Agent tags'; }, /two columns are renamed from the same name/);
  bad((x) => { x.tables.claims_copy.columns.find((c) => c.name === 'Agent notes (old)').retired = 'yes'; }, /retired must be true or false/);
  bad((x) => { x.tables.claims_copy.columns.find((c) => c.name === 'Geo Name').retired = true; }, /the title column cannot be retired/);
  bad((x) => { x.tables.claims_copy.arrange_default_view = 'yes'; }, /arrange_default_view must be true or false/);
  bad((x) => { x.views.find((v) => v.name === 'Your queue').columns.push('Agent notes (old)'); }, /"Agent notes \(old\)" is a retired column, which every view hides/);
  bad((x) => { x.views.find((v) => v.renamed_from).renamed_from = ''; }, /renamed_from must be another name/);
  bad((x) => { const v = x.views.find((y) => y.renamed_from); v.renamed_from = v.name; }, /renamed_from must be another name/);
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
  assert.deepEqual(colors('claims_copy', 'Review status'), { 'To review': 'yellow', Reviewed: 'green' });
  assert.deepEqual(colors('claims_copy', 'Why wrong'), { 'Agent slip': 'gray', 'Rule unclear': 'yellow', 'Rule should change': 'orange' });
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
  assert.deepEqual(plan.views.map((v) => v.table), ['claims_copy', 'claims_copy', 'claims_copy', 'tag_decisions', 'tag_decisions', 'rule_changes', 'rulebook']);
  assert.deepEqual(plan.views.map((v) => v.name), ['Your queue', 'Needs your note', 'Agent disagreed', 'Your queue (ledger)', 'Needs your note (ledger)', 'Lessons waiting', 'Rulebook']);
  assert.deepEqual(plan.views.map((v) => v.renamed_from), [null, null, null, 'Your queue', 'Needs your note', null, null]);
  const queue = byName['Your queue'];
  // the revision of 21 October: Your queue lists the claims whose Agent status is Waits for you, and no longer asks about Review status
  assert.deepEqual(queue.body.filter, { property: 'Agent status', select: { equals: 'Waits for you' } });
  assert.deepEqual(queue.body.sorts, [{ property: 'Agent confidence', direction: 'ascending' }]);
  assert.equal(queue.body.type, 'table');
  assert.equal(queue.body.configuration.type, 'table');
  assert.equal(queue.body.configuration.wrap_cells, true);
  const props = queue.body.configuration.properties;
  const REVIEW = ['Geo Name', 'Agent tags', 'Agent confidence', 'Agent reasons', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks', 'Verified tags', 'Review status', 'Why wrong', 'Challenged tags notes'];
  for (const name of ['Your queue', 'Needs your note', 'Agent disagreed']) assert.deepEqual(byName[name].columns, REVIEW, `${name}: the columns of the claims table in the order of CLAIMS-REVIEW.md section 6.1`);
  assert.deepEqual(props.slice(0, 12).map((p) => [p.name, p.visible, p.wrap]), queue.columns.map((n) => [n, true, true]));
  assert.ok(props.slice(12).every((p) => p.visible === false && !('wrap' in p)));
  assert.equal(props.length, structure.tables.claims_copy.columns.length, 'every column is either shown or hidden, the two retired ones last');
  assert.deepEqual(props.slice(12).map((p) => p.name), queue.hidden);
  assert.deepEqual(props.slice(-2).map((p) => p.name), ['Agent tags (old)', 'Agent notes (old)'], 'hidden in every view');
  assert.deepEqual(queue.retired, ['Agent tags (old)', 'Agent notes (old)'], 'the plan says which hidden columns exist only where a rename made them');
  assert.deepEqual(byName['Needs your note'].body.filter, { and: [{ property: 'Why wrong', select: { is_not_empty: true } }, { property: 'Challenged tags notes', rich_text: { is_empty: true } }] });
  assert.deepEqual(byName['Agent disagreed'].body.filter, { property: 'Agent status', select: { equals: 'Disagrees with your decision' } });
  assert.deepEqual(byName['Agent disagreed'].body.sorts, [{ property: 'Agent confidence', direction: 'ascending' }]);
  assert.deepEqual(byName['Your queue (ledger)'].body.filter, { property: 'Tag outcome', select: { is_empty: true } }, 'the old view keeps its filter under its new name');
  assert.equal(byName['Your queue (ledger)'].body.configuration.wrap_cells, false);
  assert.ok(!('filter' in byName.Rulebook.body), 'all rows: no filter');
  assert.ok(!('sorts' in byName.Rulebook.body) && !('sorts' in byName['Lessons waiting'].body), 'none: no sorts');
  assert.equal(byName.Rulebook.body.configuration.wrap_cells, true);
  assert.ok(byName.Rulebook.body.configuration.properties.slice(0, 5).every((p) => p.visible && p.wrap === true));
  assert.deepEqual(byName['Lessons waiting'].body.filter, { or: [{ property: 'Status', select: { equals: 'Proposed' } }, { property: 'Status', select: { equals: 'Approved' } }] });
  assert.equal(byName['Needs your note (ledger)'].body.filter.and.length, 2);
  assert.deepEqual(plan.arrange, {
    claims_copy: { shown: [...REVIEW, ...structure.tables.claims_copy.columns.filter((c) => !c.retired).map((c) => c.name).filter((n) => !REVIEW.includes(n))], hidden: ['Agent tags (old)', 'Agent notes (old)'] },
  }, 'the table\'s own view gets the same order, every column shown but the retired ones');
});

test('completeViewBody leaves out a retired column that the table does not have (a new table never made it), and still refuses any other column that is missing', () => {
  const { plan } = build();
  const view = plan.views.find((v) => v.name === 'Your queue');
  const names = view.body.configuration.properties.map((p) => p.name);
  const props = Object.fromEntries(names.filter((n) => !view.retired.includes(n)).map((n, i) => [n, { id: n === 'Geo Name' ? 'title' : `%3A${i}`, name: n }]));
  const body = completeViewBody(view, { id: 'ds-1', parent: { database_id: 'db-1' }, properties: props });
  assert.equal(body.configuration.properties.length, names.length - 2);
  assert.ok(body.configuration.properties.every((p) => p.property_id));
  const missing = { ...props };
  delete missing['Agent edition'];
  assert.throws(() => completeViewBody(view, { id: 'ds-1', parent: { database_id: 'db-1' }, properties: missing }), /the table has no column "Agent edition"/);
  const old = { ...props, 'Agent tags (old)': { id: '%3Aold', name: 'Agent tags (old)' } };
  const withOld = completeViewBody(view, { id: 'ds-1', parent: { database_id: 'db-1' }, properties: old });
  assert.deepEqual(withOld.configuration.properties.at(-1), { property_id: '%3Aold', visible: false }, 'where the retired column exists, it is hidden');
});

test('completeViewBody puts the property ids of the created data source where the column names were, and nothing else changes', () => {
  const { plan } = build();
  const dataSource = {
    id: 'ds-1', parent: { type: 'database_id', database_id: 'db-1' },
    properties: Object.fromEntries(['Claim', 'Key', 'Tag', 'Agent proposal', 'Agent confidence', 'Agent reason', 'Claim link', 'Rulebook edition', 'Follow-up', 'Tag outcome', 'Why wrong', 'Your reasoning', 'Decided under']
      .map((n, i) => [n, { id: n === 'Claim' ? 'title' : `%3A${i}`, name: n }])),
  };
  const view = plan.views.find((v) => v.name === 'Your queue (ledger)');
  const body = completeViewBody(view, dataSource);
  assert.equal(body.database_id, 'db-1');
  assert.equal(body.data_source_id, 'ds-1');
  assert.deepEqual({ name: body.name, type: body.type, filter: body.filter, sorts: body.sorts }, { name: 'Your queue (ledger)', type: 'table', filter: view.body.filter, sorts: view.body.sorts });
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

test('runStructure makes two pages, five tables, the relation column and seven views, once each, and never deletes: the requests are the planned bodies', async () => {
  const w = build();
  const result = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  assert.equal(result.ok, true);
  assert.equal(result.code, EXIT.OK);
  assert.equal(result.stopped, null);
  assert.deepEqual(result.created, { pages: 2, databases: 5, columns: 3, views: 7, renamed: 0, columns_renamed: 0, views_updated: 0 });
  assert.deepEqual(result.columns, { claims_copy: ['Agent tags', 'Tags waiting', 'Verified tags'] }, 'the relations need the Rulebook copy, so they are added once the tables exist');
  assert.deepEqual(result.columnsRenamed, {}, 'a new table has nothing to rename, and never gets the two "(old)" columns');
  assert.equal(posts(w.fake, '/pages').length, 2);
  assert.equal(posts(w.fake, '/databases').length, 5);
  assert.equal(posts(w.fake, '/views').length, 7);
  assert.ok(w.fake.requests.every((r) => r.method === 'GET' || r.method === 'POST' || (r.method === 'PATCH' && /^\/data_sources\//.test(r.path))), 'no DELETE, and the only PATCH adds a column to a data source');
  const patches = w.fake.requests.filter((r) => r.method === 'PATCH');
  assert.equal(patches.length, 1);
  const rulebookDs = result0(w, 'rulebook').data_source_id;
  assert.deepEqual(Object.keys(patches[0].body.properties), ['Agent tags', 'Tags waiting', 'Verified tags']);
  for (const name of Object.keys(patches[0].body.properties)) assert.equal(normId(patches[0].body.properties[name].relation.data_source_id), normId(rulebookDs), name);
  assert.ok(w.fake.requests.every((r) => r.version === '2026-03-11'), 'the builder version on every request');
  assert.deepEqual(posts(w.fake, '/databases').map((r) => r.body), w.plan.databases.map((d) => d.body), 'the bodies sent are the bodies planned');
  const pageBodies = posts(w.fake, '/pages').map((r) => r.body);
  assert.deepEqual(pageBodies.map((b) => b.parent), [{ type: 'page_id', page_id: w.parent }, { type: 'page_id', page_id: w.parent }]);
  assert.deepEqual(pageBodies.map((b) => b.properties.title.title[0].text.content), ['Demos', 'Demo tests']);
  assert.deepEqual(pageBodies.map((b) => b.children[0].paragraph.rich_text[0].text.content), [PAGE_TEXT.demos, PAGE_TEXT.demo_tests]);
  assert.equal(w.fake.writes().length, 15, 'two pages, five tables, one PATCH for the columns, seven views');
  assert.deepEqual(w.fake.writes().filter((r) => r.method !== 'PATCH').map((r) => r.method), Array(14).fill('POST'));
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
    const later = w.plan.columns.filter((c) => c.table === db.table && c.relation_to).map((c) => c.name); // the relation comes after the tables
    assert.deepEqual(columns.map((c) => c.name), [...Object.keys(db.body.initial_data_source.properties), ...later]);
    assert.ok(columns.every((c) => (c.description ?? '').length <= 280));
  }
  const relation = w.fake.database(result0(w, 'claims_copy').database_id).properties['Verified tags'];
  assert.equal(relation.type, 'relation');
  assert.deepEqual(Object.keys(w.fake.database(result0(w, 'claims_copy').database_id).properties).filter((n) => /\(old\)/.test(n)), [], 'the retired columns are not made on a new table');
  assert.equal(normId(relation.relation.data_source_id), normId(result0(w, 'rulebook').data_source_id), 'it points at the Rulebook copy');
  assert.match(relation.description, /tags you confirm on the claim/);
  const viewPosts = posts(w.fake, '/views');
  for (const post of viewPosts) {
    const view = w.plan.views.find((v) => v.name === post.body.name);
    const entry = result0(w, view.table);
    const { position, ...rest } = post.body;
    assert.deepEqual(rest, completeViewBody(view, w.fake.dataSource(entry.data_source_id), { databaseId: entry.database_id }));
    assert.ok(position, 'every view is placed in the tab bar');
  }
  assert.deepEqual(w.fake.views(result0(w, 'claims_copy').database_id).map((v) => v.name), ['Your queue', 'Needs your note', 'Agent disagreed']);
  const stored = w.fake.views(result0(w, 'tag_decisions').database_id);
  assert.deepEqual(stored.map((v) => v.name), ['Your queue (ledger)', 'Needs your note (ledger)']);
  assert.deepEqual(stored[0].filter, { property: 'Tag outcome', select: { is_empty: true } });
  assert.deepEqual(stored[0].sorts, [{ property: 'Agent confidence', direction: 'ascending' }]);
  assert.equal(stored[0].configuration.properties.filter((p) => p.visible).length, 6);
  const queue = w.fake.views(result0(w, 'claims_copy').database_id)[0];
  assert.equal(queue.configuration.properties.filter((p) => p.visible).length, 12);
  assert.deepEqual(queue.filter, { property: 'Agent status', select: { equals: 'Waits for you' } });
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
  assert.deepEqual(Object.keys(state.tables.tag_decisions.view_ids), ['Your queue (ledger)', 'Needs your note (ledger)']);
  assert.deepEqual(Object.keys(state.tables.claims_copy.view_ids), ['Your queue', 'Needs your note', 'Agent disagreed']);
  assert.equal(state.pages.demos.status, 'created');
  assert.ok(existsSync(join(w.root, 'runs', 'builder', 'log.jsonl')));
  assert.equal(loadConfig(w.root).notion.rulebook.database_id, disk.notion.rulebook.database_id, 'config.json is still a valid config');
});

test('runStructure writes every view\'s id and link into config.json notion.views, in the order of the proposal', async () => {
  const w = build();
  const result = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  const disk = readJson(join(w.root, 'config.json'));
  assert.deepEqual(Object.keys(disk.notion.views), ['your_queue', 'needs_your_note', 'agent_disagreed', 'your_queue_ledger', 'needs_your_note_ledger', 'lessons_waiting', 'rulebook']);
  assert.deepEqual(w.config.notion.views, disk.notion.views, 'the config object in memory agrees');
  const ids = {};
  for (const table of ['claims_copy', 'tag_decisions', 'rule_changes', 'rulebook']) for (const v of w.fake.views(result0(w, table).database_id)) ids[v.name] = { id: v.id, database: result0(w, table).database_id };
  const expected = (name) => ({ id: normId(ids[name].id), url: `https://www.notion.so/${normId(ids[name].database)}?v=${normId(ids[name].id)}` });
  assert.deepEqual(disk.notion.views.your_queue, expected('Your queue'));
  assert.deepEqual(disk.notion.views.needs_your_note, expected('Needs your note'));
  assert.deepEqual(disk.notion.views.agent_disagreed, expected('Agent disagreed'));
  assert.deepEqual(disk.notion.views.your_queue_ledger, expected('Your queue (ledger)'));
  assert.deepEqual(disk.notion.views.needs_your_note_ledger, expected('Needs your note (ledger)'));
  assert.ok(disk.notion.views.your_queue.url.includes(normId(result0(w, 'claims_copy').database_id)), 'Your queue is a view of the Claims copy');
  assert.deepEqual(disk.notion.views.lessons_waiting, expected('Lessons waiting'));
  assert.deepEqual(disk.notion.views.rulebook, expected('Rulebook'));
  for (const entry of Object.values(disk.notion.views)) {
    assert.deepEqual(Object.keys(entry), ['id', 'url']);
    assert.match(entry.id, /^[0-9a-f]{32}$/);
    assert.match(entry.url, /^https:\/\/www\.notion\.so\/[0-9a-f]{32}\?v=[0-9a-f]{32}$/);
  }
  assert.equal(viewKey('Your queue'), 'your_queue');
  assert.equal(viewUrl('3FA273E2-14EB-805B-8A2C-D9E1AF3B0001', '0e100000-0000-4000-8000-00000000008c'), 'https://www.notion.so/3fa273e214eb805b8a2cd9e1af3b0001?v=0e10000000004000800000000000008c');
  assert.equal(result.views.claims_copy['Your queue'].url, disk.notion.views.your_queue.url);
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
  assert.deepEqual(Object.keys(readJson(join(refused.root, 'config.json')).notion.views), ['your_queue', 'needs_your_note', 'agent_disagreed', 'your_queue_ledger', 'needs_your_note_ledger', 'lessons_waiting'], 'no key for the view that could not be made');
  assert.ok(!('rulebook' in refused.config.notion.views));
  await runStructure({ plan: refused.plan, client: refused.client, root: refused.root, config: loadConfig(refused.root) });
  assert.deepEqual(Object.keys(readJson(join(refused.root, 'config.json')).notion.views), ['your_queue', 'needs_your_note', 'agent_disagreed', 'your_queue_ledger', 'needs_your_note_ledger', 'lessons_waiting', 'rulebook'], 'the next run adds it');
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
  assert.deepEqual(again.created, { pages: 0, databases: 0, columns: 0, views: 0, renamed: 0, columns_renamed: 0, views_updated: 0 });
  assert.deepEqual(again.columns, {});
  assert.deepEqual(Object.values(again.pages).map((p) => p.status), ['exists', 'exists']);
  assert.deepEqual(Object.values(again.databases).map((d) => d.status), Array(5).fill('exists'));
  assert.deepEqual(Object.values(again.views).flatMap((v) => Object.values(v).map((x) => x.status)), Array(7).fill('exists'));
  assert.equal(w.fake.writes().length, 15, 'two pages, five tables, one PATCH for the columns and seven views, once');
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
  assert.equal(posts(w.fake, '/views').length, 7);
  assert.deepEqual(second.created, { pages: 0, databases: 3, columns: 3, views: 7, renamed: 0, columns_renamed: 0, views_updated: 0 });
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
    assert.equal(result.created.views, 6, 'the other six were made');
    const state = readJson(join(w.root, 'runs', 'builder', 'state.json'));
    assert.match(state.tables.rulebook.views, /^failed: /);
    assert.match(state.tables.rulebook.view_status.Rulebook, /^failed: /);
    assert.equal(state.tables.tag_decisions.views, 'ok');
    assert.equal(posts(w.fake, '/views').length, 6 + attempts, 'six made and one refused');

    const again = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: loadConfig(w.root) });
    assert.equal(again.views.rulebook.Rulebook.status, 'created');
    assert.equal(posts(w.fake, '/views').length, 7 + attempts);
    assert.deepEqual(again.created, { pages: 0, databases: 0, columns: 0, views: 1, renamed: 0, columns_renamed: 0, views_updated: 0 });
  }
});

test('the views go first in the tab bar, in the order of the proposal; a place that Notion does not take is asked for again without it', async () => {
  const w = build();
  await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  const byName = Object.fromEntries(posts(w.fake, '/views').map((r) => [r.body.name, r.body]));
  assert.deepEqual(byName.Rulebook.position, { type: 'start' });
  assert.deepEqual(byName['Your queue'].position, { type: 'start' });
  assert.deepEqual(byName['Lessons waiting'].position, { type: 'start' });
  const claimViews = w.fake.views(result0(w, 'claims_copy').database_id);
  const idOf = (name) => claimViews.find((v) => v.name === name).id;
  assert.deepEqual(byName['Needs your note'].position, { type: 'after_view', view_id: idOf('Your queue') });
  assert.deepEqual(byName['Agent disagreed'].position, { type: 'after_view', view_id: idOf('Needs your note') });
  assert.deepEqual(byName['Your queue (ledger)'].position, { type: 'start' });

  const retry = build();
  const log = [];
  const asked = [];
  const recording = { ...retry.client, createView: (args) => { asked.push([args.name, args.position]); return retry.client.createView(args); } };
  retry.fake.failNext('POST', /^\/views$/, 400, 1, { message: 'body.position should not be present' });
  const result = await runStructure({ plan: retry.plan, client: recording, root: retry.root, config: retry.config, log: (l) => log.push(l) });
  assert.equal(result.views.rulebook.Rulebook.status, 'created', 'the second ask, without a place, was taken');
  assert.deepEqual(asked.filter(([name]) => name === 'Rulebook'), [['Rulebook', { type: 'start' }], ['Rulebook', undefined]]);
  assert.ok(log.some((l) => /did not take its place in the tab bar/.test(l)));
  assert.equal(asked.length, 8, 'seven views and one second ask');
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
  assert.deepEqual(Object.fromEntries(Object.entries(r.views).map(([table, v]) => [table, Object.keys(v)])), {
    rulebook: ['Rulebook'], claims_copy: ['Your queue', 'Needs your note', 'Agent disagreed'], tag_decisions: ['Your queue (ledger)', 'Needs your note (ledger)'], rule_changes: ['Lessons waiting'],
  }, 'the ids of the views it found');
  const reads = w.fake.requests.filter((x) => x.method !== 'GET' && !/\/query$/.test(x.path));
  assert.equal(reads.length, 15, 'verify sent nothing: only the 14 creates and the one PATCH for the columns of the build are writes');
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
  find('Your queue (ledger)').filter = 'Tag outcome is not empty';
  find('Needs your note (ledger)').sort = 'Agent confidence, highest first';
  find('Lessons waiting').columns = ['Lesson', 'Status'];
  find('Rulebook').wrap = false;
  const r = await verify(w, other);
  assert.deepEqual(kinds(r).sort(), ['missing view', 'view columns', 'view filter', 'view sort', 'view wrap']);
  assert.match(r.differences.find((d) => d.kind === 'missing view').detail, /"Brand new view"/);
  assert.match(r.differences.find((d) => d.kind === 'view filter').detail, /"Your queue \(ledger\)"/);
  assert.match(r.differences.find((d) => d.kind === 'view sort').detail, /"Needs your note \(ledger\)"/);
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
      const props = idsFor(Object.keys(w.fake.dataSource(view.data_source_id).properties).includes('Lesson') ? 'rule_changes' : Object.keys(w.fake.dataSource(view.data_source_id).properties).includes('Claim') ? 'tag_decisions' : Object.keys(w.fake.dataSource(view.data_source_id).properties).includes('Geo Name') ? 'claims_copy' : 'rulebook');
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

// ---- the filters the claims views need -------------------------------------------------------------------------------------------------

test('parseViewFilter reads "is not <value>", "contains" and "does not contain", and the clauses that follow them', () => {
  const claims = revisedStructure().tables.claims_copy;
  assert.deepEqual(parseViewFilter('Review status is not Reviewed', claims), { property: 'Review status', select: { does_not_equal: 'Reviewed' } });
  assert.deepEqual(parseViewFilter('Agent reasons contains disagrees', claims), { property: 'Agent reasons', rich_text: { contains: 'disagrees' } });
  assert.deepEqual(parseViewFilter('Agent reasons contains "waits for an editor"', claims), { property: 'Agent reasons', rich_text: { contains: 'waits for an editor' } }, 'quotes around the text are dropped');
  assert.deepEqual(parseViewFilter('Agent reasons does not contain nothing waits', claims), { property: 'Agent reasons', rich_text: { does_not_contain: 'nothing waits' } });
  assert.deepEqual(parseViewFilter('Agent status is Disagrees with your decision', claims), { property: 'Agent status', select: { equals: 'Disagrees with your decision' } }, 'a select value of several words');
  assert.deepEqual(parseViewFilter('Agent status is Waits for you or Done', claims), { or: [{ property: 'Agent status', select: { equals: 'Waits for you' } }, { property: 'Agent status', select: { equals: 'Done' } }] });
  assert.deepEqual(parseViewFilter('Why wrong is not empty, and Challenged tags notes is empty', claims), {
    and: [{ property: 'Why wrong', select: { is_not_empty: true } }, { property: 'Challenged tags notes', rich_text: { is_empty: true } }],
  });
  assert.deepEqual(parseViewFilter('Review status is not Reviewed, and Agent reasons contains for an editor, and Agent reasons does not contain nothing waits', claims).and.map((f) => Object.keys(f)[1]), ['select', 'rich_text', 'rich_text']);
  assert.deepEqual(parseViewFilter('Agent tags (old) is empty', claims), { property: 'Agent tags (old)', rich_text: { is_empty: true } }, 'a column name with brackets, and one that starts with the name of another column');
  assert.throws(() => parseViewFilter('Review status is not Done', claims, 'view "V"'), /view "V": "Done" is not a value of "Review status"/);
  assert.throws(() => parseViewFilter('Review status contains Rev', claims, 'view "V"'), /view "V": "contains" needs a text column, and "Review status" is a select/);
  assert.throws(() => parseViewFilter('Agent reasons contains ', claims, 'view "V"'), StructureError);
  assert.throws(() => parseViewFilter('Agent reasons looks like x', claims, 'view "V"'), /cannot read the filter "Agent reasons looks like x"/);
});

test('the three claims views of the revision of 21 October filter on Agent status; Your queue no longer looks at Review status or at any note', () => {
  const claims = revisedStructure().tables.claims_copy;
  const views = Object.fromEntries(revisedStructure().views.filter((v) => v.table === 'claims_copy').map((v) => [v.name, v]));
  assert.equal(views['Your queue'].filter, 'Agent status is Waits for you');
  assert.equal(views['Agent disagreed'].filter, 'Agent status is Disagrees with your decision');
  assert.equal(views['Needs your note'].filter, 'Why wrong is not empty, and Challenged tags notes is empty', 'unchanged');
  assert.deepEqual(parseViewFilter(views['Your queue'].filter, claims), { property: 'Agent status', select: { equals: 'Waits for you' } });
  assert.deepEqual(parseViewFilter(views['Agent disagreed'].filter, claims), { property: 'Agent status', select: { equals: 'Disagrees with your decision' } });
  for (const v of Object.values(views)) assert.equal(v.sort, 'Agent confidence, lowest first', v.name);
  assert.deepEqual(claims.columns.find((c) => c.name === 'Agent status').options, ['Waits for you', 'Done', 'Disagrees with your decision', 'Could not read']);
  assert.throws(() => parseViewFilter('Agent status is Waiting', claims, 'view "V"'), /"Waiting" is not a value of "Agent status"/);
});

// ---- columns a table lacks, and a view that changes its name -----------------------------------------------------------------------------

// a world as the first build left it: the approved structure of 15 October, then the revised one is run over it
async function firstBuild() {
  const w = newWorld();
  const approved = forFake(realStructure());
  const first = planStructure(approved, w.config);
  const client = builderClient(w.fake);
  await runStructure({ plan: first, client, root: w.root, config: w.config });
  return { ...w, client, approved };
}

test('runStructure over a table of the first build adds the columns it lacks and renames the two old views; nothing that is there is changed', async () => {
  const w = await firstBuild();
  const claims = w.fake.database(result0(w, 'claims_copy').database_id);
  assert.equal(Object.keys(claims.properties).length, 15, 'the first build had 15 columns on the claims');
  const oldViews = w.fake.views(result0(w, 'tag_decisions').database_id);
  assert.deepEqual(oldViews.map((v) => v.name), ['Your queue', 'Needs your note']);
  const oldIds = oldViews.map((v) => v.id);
  const row = w.fake.addRow(result0(w, 'claims_copy').database_id, { 'Geo Name': 'A claim', 'Geo ID': 'g1', 'Agent notes': 'kept' });

  const revised = forFake(revisedStructure());
  const plan = planStructure(revised, w.config);
  const log = [];
  const result = await runStructure({ plan, client: w.client, root: w.root, config: w.config, log: (l) => log.push(l) });
  assert.equal(result.ok, true, JSON.stringify(result.stopped));
  assert.deepEqual(result.created, { pages: 0, databases: 0, columns: 12, views: 3, renamed: 2, columns_renamed: 2, views_updated: 2 });
  assert.deepEqual(result.columnsRenamed, { claims_copy: [{ from: 'Agent tags', to: 'Agent tags (old)' }, { from: 'Agent notes', to: 'Agent notes (old)' }] });
  assert.deepEqual(result.columns, {
    claims_copy: ['Agent tags', 'Agent confidence', 'Agent reasons', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks', 'Verified tags', 'Review status', 'Why wrong', 'Challenged tags notes'],
    tag_decisions: ['Decided under'],
  });
  assert.deepEqual(result.updated, {
    tag_decisions: { 'Your queue (ledger)': ['columns'], 'Needs your note (ledger)': ['columns'] },
  }, 'the two renamed views did not list the column that was added to their table, so they are brought to the structure too');
  const after = w.fake.database(result0(w, 'claims_copy').database_id);
  assert.equal(Object.keys(after.properties).length, 26);
  assert.equal(after.properties['Review status'].select.options.map((o) => o.name).join(), 'To review,Reviewed');
  assert.equal(after.properties['Agent tags'].type, 'relation');
  assert.equal(after.properties['Agent tags (old)'].type, 'rich_text');
  assert.equal(normId(after.properties['Verified tags'].relation.data_source_id), normId(result0(w, 'rulebook').data_source_id));
  assert.equal(w.fake.plainRows(result0(w, 'claims_copy').database_id)[0]['Agent notes (old)'], 'kept', 'the rows are as they were: the text of Agent notes is in Agent notes (old)');
  assert.ok(row);

  // the two old views were renamed, not made again, and keep their ids
  const ledgerViews = w.fake.views(result0(w, 'tag_decisions').database_id);
  assert.deepEqual(ledgerViews.map((v) => v.name), ['Your queue (ledger)', 'Needs your note (ledger)']);
  assert.deepEqual(ledgerViews.map((v) => v.id), oldIds);
  const patches = w.fake.requests.filter((r) => r.method === 'PATCH' && /^\/views\//.test(r.path));
  assert.deepEqual(patches.map((r) => Object.keys(r.body)), [['name'], ['configuration'], ['name'], ['configuration']], 'each rename sends the name only, and the update that follows it the configuration only');
  assert.deepEqual(patches.filter((r) => 'name' in r.body).map((r) => r.body), [{ name: 'Your queue (ledger)' }, { name: 'Needs your note (ledger)' }]);
  assert.ok(log.some((l) => /view "Your queue": renamed to "Your queue \(ledger\)"/.test(l)));
  assert.deepEqual(w.fake.views(result0(w, 'claims_copy').database_id).map((v) => v.name), ['Your queue', 'Needs your note', 'Agent disagreed']);

  // config.json: the old keys now belong to the Claims copy views, and the ledger views have keys of their own
  const disk = readJson(join(w.root, 'config.json'));
  assert.ok(disk.notion.views.your_queue.url.includes(normId(result0(w, 'claims_copy').database_id)), 'Your queue is a view of the Claims copy');
  assert.equal(disk.notion.views.your_queue_ledger.id, normId(oldIds[0]));
  assert.equal(disk.notion.views.needs_your_note_ledger.id, normId(oldIds[1]));
  assert.equal(result.views.tag_decisions['Your queue (ledger)'].status, 'renamed');
  assert.equal(readJson(join(w.root, 'runs', 'builder', 'state.json')).tables.tag_decisions.view_status['Your queue (ledger)'], 'renamed');

  // and the revised structure reads back clean
  const r = await verifyStructure({ client: w.client, config: w.config, structure: revised });
  assert.deepEqual([r.ok, r.differences], [true, []]);

  // a second run finds everything and writes nothing
  const before = w.fake.writes().length;
  const again = await runStructure({ plan, client: w.client, root: w.root, config: loadConfig(w.root) });
  assert.deepEqual(again.created, { pages: 0, databases: 0, columns: 0, views: 0, renamed: 0, columns_renamed: 0, views_updated: 0 });
  assert.equal(w.fake.writes().length, before);
});

test('a view whose rename Notion refuses is recorded as failed and the run goes on; the old view is still there', async () => {
  const w = await firstBuild();
  const plan = planStructure(forFake(revisedStructure()), w.config);
  w.fake.failNext('PATCH', /^\/views\//, 400, 1);
  const result = await runStructure({ plan, client: w.client, root: w.root, config: w.config });
  assert.equal(result.ok, true);
  assert.equal(result.views.tag_decisions['Your queue (ledger)'].status, 'failed');
  assert.equal(result.views.tag_decisions['Needs your note (ledger)'].status, 'renamed');
  assert.deepEqual(w.fake.views(result0(w, 'tag_decisions').database_id).map((v) => v.name), ['Your queue', 'Needs your note (ledger)']);
  const again = await runStructure({ plan, client: w.client, root: w.root, config: loadConfig(w.root) });
  assert.equal(again.views.tag_decisions['Your queue (ledger)'].status, 'renamed', 'the next run renames it');
});

test('a relation column that points at the wrong table is a difference, and a column that is not a relation where the structure wants one is a type difference', async () => {
  const w = await built();
  const claims = result0(w, 'claims_copy');
  const rulebook = result0(w, 'rulebook');
  assert.deepEqual((await verify(w)).differences, []);
  const stored = w.fake.database(claims.database_id).properties['Verified tags'];
  assert.equal(stored.type, 'relation');
  const wrong = structuredClone(w.structure);
  wrong.tables.claims_copy.columns.find((c) => c.name === 'Verified tags').relation_to = 'rule_changes';
  const r = await verify(w, wrong);
  const d = r.differences.find((x) => x.kind === 'relation');
  assert.ok(d, JSON.stringify(r.differences));
  assert.match(d.detail, /"Verified tags" points at/);
  assert.match(d.detail, /not at the rule_changes table/);
  assert.equal(r.differences.filter((x) => x.kind === 'relation').length, 1, 'the other relations still point at the Rulebook copy');
  assert.ok(rulebook.data_source_id);
});

test('the revised structure file is valid, has the claims columns of CLAIMS-REVIEW.md section 6.1 in their order and the three claims views, and renders in the preview', () => {
  const s = revisedStructure();
  assert.equal(validateStructure(s), s);
  assert.deepEqual(countStructure(s), { tables: 5, columns: 70, views: 7, pages: 2 });
  assert.deepEqual(s.tables.claims_copy.columns.slice(0, 12).map((c) => c.name), [
    'Geo Name', 'Agent tags', 'Agent confidence', 'Agent reasons', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks', 'Verified tags', 'Review status', 'Why wrong', 'Challenged tags notes',
  ]);
  assert.deepEqual(s.tables.claims_copy.columns.slice(0, 12).map((c) => c.type), ['title', 'relation', 'number', 'rich_text', 'select', 'relation', 'rich_text', 'rich_text', 'relation', 'select', 'select', 'rich_text']);
  assert.deepEqual(s.tables.claims_copy.columns.slice(12, 24).map((c) => c.name), ['Geo ID', 'Geo URL', 'Geo Sources', 'Geo Tags', 'Geo Topics', 'Geo Score', 'Geo Supporting arguments', 'Geo Opposing arguments', 'Geo Related people', 'Geo Related projects', 'Geo Is factual', 'Geo Name source'], 'then the Geo columns');
  assert.deepEqual(s.tables.claims_copy.columns.slice(-2).map((c) => [c.name, c.renamed_from, c.retired]), [['Agent tags (old)', 'Agent tags', true], ['Agent notes (old)', 'Agent notes', true]]);
  assert.equal(s.tables.claims_copy.columns.find((c) => c.name === 'Verified tags').renamed_from, 'Claim quality tags — verified');
  assert.deepEqual(s.tables.claims_copy.columns.filter((c) => c.relation_to).map((c) => [c.name, c.relation_to]), [['Agent tags', 'rulebook'], ['Tags waiting', 'rulebook'], ['Verified tags', 'rulebook']]);
  assert.equal(s.tables.claims_copy.arrange_default_view, true);
  assert.equal(s.tables.tag_decisions.columns.at(-1).name, 'Decided under');
  assert.deepEqual(s.views.map((v) => [v.table, v.name]).slice(0, 5), [
    ['claims_copy', 'Your queue'], ['claims_copy', 'Needs your note'], ['claims_copy', 'Agent disagreed'], ['tag_decisions', 'Your queue (ledger)'], ['tag_decisions', 'Needs your note (ledger)'],
  ]);
  const md = renderPreview(s);
  assert.match(md, /\| Verified tags \| relation \| points at the Rulebook copy \|.*\(the column "Claim quality tags — verified" of an earlier build is renamed to this\)/);
  assert.match(md, /\| Agent notes \(old\) \| rich_text \|.*\(the column "Agent notes" of an earlier build is renamed to this; retired: never made on a new table, hidden in every view\)/);
  assert.match(md, /- \*\*Your queue \(ledger\)\*\* \(the view "Your queue" of an earlier build is renamed to this\): rows shown: Tag outcome is empty/);
  assert.match(md, /7 views/);
  for (const t of Object.values(s.tables)) for (const c of t.columns) assert.ok([...c.description].length <= 280, `${t.title}.${c.name}`);
});

// ---- the live step: a table as the build of 16 October left it, brought to the revision of 21 October (CLAIMS-REVIEW.md section 6.5) ------------------------------------

const REVIEW_ORDER = ['Geo Name', 'Agent tags', 'Agent confidence', 'Agent reasons', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks', 'Verified tags', 'Review status', 'Why wrong', 'Challenged tags notes'];
const GEO_ORDER = ['Geo ID', 'Geo URL', 'Geo Sources', 'Geo Tags', 'Geo Topics', 'Geo Score', 'Geo Supporting arguments', 'Geo Opposing arguments', 'Geo Related people', 'Geo Related projects', 'Geo Is factual', 'Geo Name source'];

// the structure file as the build of 16 October used it (fixtures/structure.16-oct.json), built over the fake, and a default view on the Claims copy: Notion makes one for every table, the fake does not
async function octoberBuild() {
  const w = newWorld();
  const old = forFake(JSON.parse(readFileSync(new URL('./fixtures/structure.16-oct.json', import.meta.url), 'utf8')));
  const client = builderClient(w.fake);
  const first = await runStructure({ plan: planStructure(old, w.config), client, root: w.root, config: w.config });
  assert.equal(first.ok, true, JSON.stringify(first.stopped));
  const entry = result0(w, 'claims_copy');
  const ds = w.fake.dataSource(entry.data_source_id);
  await client.createView({
    databaseId: entry.database_id, dataSourceId: entry.data_source_id, name: 'Table',
    configuration: { type: 'table', wrap_cells: false, properties: Object.values(ds.properties).map((p) => ({ property_id: p.id, visible: true, width: 150 })) }, position: { type: 'end' },
  });
  // the claims as the live table holds them: the text of the first build in Agent tags and Agent notes, and a decided claim with its relation
  const tag = w.fake.addRow(result0(w, 'rulebook').database_id, { Name: 'Context-dependent', 'Work tags': ['Issue'] });
  w.fake.addRow(entry.database_id, {
    'Geo Name': 'A claim', 'Geo ID': 'g1', 'Agent tags': 'Context-dependent', 'Agent notes': 'Context-dependent\nnothing waits for an editor · edition 2026-10-16.1', 'Agent confidence': 0.8,
    'Claim quality tags — verified': [tag], 'Review status': 'Reviewed', 'Why wrong': 'Agent slip', 'Challenged tags notes': 'Fine.',
  });
  return { ...w, client, old, tag };
}

const shownOf = (w, viewName) => {
  const entry = result0(w, 'claims_copy');
  const names = new Map(Object.values(w.fake.dataSource(entry.data_source_id).properties).map((p) => [p.id, p.name]));
  const view = w.fake.views(entry.database_id).find((v) => v.name === viewName);
  return view.configuration.properties.filter((p) => p.visible).map((p) => names.get(p.property_id));
};

test('build on a table of the build of 16 October: the two text columns and the verified relation are renamed, the five new columns added, the views set to the new order and filter, and the table\'s own view too', async () => {
  const w = await octoberBuild();
  const entry = result0(w, 'claims_copy');
  const before = w.fake.writes().length;
  const revised = forFake(revisedStructure());
  const plan = planStructure(revised, w.config);
  const log = [];
  const result = await runStructure({ plan, client: w.client, root: w.root, config: w.config, log: (l) => log.push(l) });
  assert.equal(result.ok, true, JSON.stringify(result.stopped));

  // 1. the renames, in one request, and nothing is lost by them
  assert.deepEqual(result.columnsRenamed, {
    claims_copy: [{ from: 'Claim quality tags — verified', to: 'Verified tags' }, { from: 'Agent tags', to: 'Agent tags (old)' }, { from: 'Agent notes', to: 'Agent notes (old)' }],
  });
  const patches = w.fake.requests.slice(before).filter((r) => r.method === 'PATCH' && /^\/data_sources\//.test(r.path));
  assert.equal(patches.length, 2, 'one request for the renames, one for the new columns');
  assert.deepEqual(patches[0].body.properties, { 'Claim quality tags — verified': { name: 'Verified tags' }, 'Agent tags': { name: 'Agent tags (old)' }, 'Agent notes': { name: 'Agent notes (old)' } });
  // 2. the five new columns
  assert.deepEqual(Object.keys(patches[1].body.properties), ['Agent tags', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks']);
  assert.deepEqual(result.columns, { claims_copy: ['Agent tags', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks'] });
  assert.deepEqual(patches[1].body.properties['Agent status'].select.options.map((o) => o.name), ['Waits for you', 'Done', 'Disagrees with your decision', 'Could not read']);
  for (const name of ['Agent tags', 'Tags waiting']) assert.equal(normId(patches[1].body.properties[name].relation.data_source_id), normId(result0(w, 'rulebook').data_source_id), name);
  const columns = w.fake.database(entry.database_id).properties;
  assert.deepEqual([columns['Agent tags'].type, columns['Agent tags (old)'].type, columns['Agent notes (old)'].type, columns['Verified tags'].type, columns['Tags waiting'].type, columns['Agent status'].type],
    ['relation', 'rich_text', 'rich_text', 'relation', 'relation', 'select']);
  assert.equal(columns['Claim quality tags — verified'], undefined);
  const row = w.fake.plainRows(entry.database_id)[0];
  assert.deepEqual([row['Agent tags (old)'], row['Agent notes (old)'], row['Agent confidence'], row['Verified tags'], row['Review status'], row['Agent tags'], row['Agent status']],
    ['Context-dependent', 'Context-dependent\nnothing waits for an editor · edition 2026-10-16.1', 0.8, [w.tag], 'Reviewed', [], null], 'the contents moved with their columns; the new columns are empty until the next tag run');

  // 3. the views: the filter of Your queue and Agent disagreed, the order of the columns and the hidden ones on all three, and the table's own view
  const views = w.fake.views(entry.database_id);
  const byName = Object.fromEntries(views.map((v) => [v.name, v]));
  const nameOf = (id) => Object.values(w.fake.dataSource(entry.data_source_id).properties).find((p) => p.id === id)?.name;
  assert.deepEqual(byName['Your queue'].filter, { property: 'Agent status', select: { equals: 'Waits for you' } }, 'no condition on Review status, none on a note');
  assert.deepEqual(byName['Agent disagreed'].filter, { property: 'Agent status', select: { equals: 'Disagrees with your decision' } });
  assert.deepEqual(byName['Your queue'].sorts, [{ property: 'Agent confidence', direction: 'ascending' }]);
  assert.deepEqual(result.updated, { claims_copy: { 'Your queue': ['filter', 'columns'], 'Needs your note': ['columns'], 'Agent disagreed': ['filter', 'columns'] } });
  for (const name of ['Your queue', 'Needs your note', 'Agent disagreed']) {
    assert.deepEqual(shownOf(w, name), REVIEW_ORDER, name);
    const hidden = byName[name].configuration.properties.filter((p) => !p.visible).map((p) => nameOf(p.property_id));
    assert.ok(['Agent tags (old)', 'Agent notes (old)'].every((n) => hidden.includes(n)), `${name}: the two "(old)" columns are hidden`);
    assert.deepEqual(byName[name].configuration.properties.slice(-2).map((p) => nameOf(p.property_id)), ['Agent tags (old)', 'Agent notes (old)']);
    assert.equal(byName[name].configuration.wrap_cells, true);
  }
  assert.deepEqual(shownOf(w, 'Table'), [...REVIEW_ORDER, ...GEO_ORDER], 'the table\'s own view: the review columns, then the Geo columns, the retired ones hidden');
  assert.equal(byName.Table.configuration.properties.find((p) => nameOf(p.property_id) === 'Geo Name').width, 150, 'a width the view had is kept');
  assert.equal(byName.Table.configuration.wrap_cells, false, 'so is the way it wraps');
  assert.equal(byName.Table.filter, null);
  assert.deepEqual(result.arranged, { claims_copy: ['Table'] });
  assert.deepEqual(w.fake.views(result0(w, 'rulebook').database_id).map((v) => v.name), ['Rulebook'], 'the other tables\' views are as they were');
  assert.equal(result.created.views_updated, 4);
  assert.ok(log.some((l) => /column\(s\) renamed \(Claim quality tags — verified -> Verified tags, Agent tags -> Agent tags \(old\), Agent notes -> Agent notes \(old\)\)/.test(l)), log.join('\n'));
  assert.ok(log.some((l) => /view "Your queue": updated \(filter, columns\)/.test(l)));

  // 4. the structure reads back clean, and a second run writes nothing
  const read = await verifyStructure({ client: w.client, config: w.config, structure: revised });
  assert.deepEqual([read.ok, read.differences], [true, []]);
  const writes = w.fake.writes().length;
  const again = await runStructure({ plan, client: w.client, root: w.root, config: loadConfig(w.root) });
  assert.equal(again.ok, true);
  assert.deepEqual(again.created, { pages: 0, databases: 0, columns: 0, views: 0, renamed: 0, columns_renamed: 0, views_updated: 0 });
  assert.deepEqual([again.columns, again.columnsRenamed, again.updated, again.arranged], [{}, {}, {}, {}]);
  assert.equal(w.fake.writes().length, writes, 'idempotent: not one write');
});

test('build on the table of 16 October, stopped after the renames: the next run adds the columns and finishes; nothing is renamed twice', async () => {
  const w = await octoberBuild();
  const plan = planStructure(forFake(revisedStructure()), w.config);
  w.fake.failNext('PATCH', /^\/data_sources\//, 400, 1, { applied: false });
  // the first PATCH (the renames) is refused: nothing changed
  const refused = await runStructure({ plan, client: w.client, root: w.root, config: w.config });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, EXIT.INVALID);
  assert.match(refused.stopped.what, /the renamed columns of "claims_copy"/);
  assert.ok(w.fake.database(result0(w, 'claims_copy').database_id).properties['Agent tags (old)'] === undefined, 'nothing was renamed');
  const done = await runStructure({ plan, client: w.client, root: w.root, config: loadConfig(w.root) });
  assert.equal(done.ok, true, JSON.stringify(done.stopped));
  assert.equal(done.created.columns_renamed, 3);

  // a crash between the renames and the new columns: the second run sees the renamed columns and only adds
  const v = await octoberBuild();
  const crashing = { ...v.client, updateDataSource: (id, body) => (Object.keys(body.properties ?? {}).includes('Agent status') ? Promise.reject(new Error('the process died')) : v.client.updateDataSource(id, body)) };
  const half = await runStructure({ plan: planStructure(forFake(revisedStructure()), v.config), client: crashing, root: v.root, config: v.config });
  assert.equal(half.ok, false);
  assert.equal(half.created.columns_renamed, 3, 'the renames were made');
  const rest = await runStructure({ plan: planStructure(forFake(revisedStructure()), v.config), client: v.client, root: v.root, config: loadConfig(v.root) });
  assert.equal(rest.ok, true, JSON.stringify(rest.stopped));
  assert.deepEqual([rest.created.columns_renamed, rest.created.columns], [0, 5], 'only the five new columns are added the second time');
  assert.deepEqual((await verifyStructure({ client: v.client, config: v.config, structure: forFake(revisedStructure()) })).differences, []);
});

test('a column is renamed only when the old name is there with the type of the new column and the new name is free', async () => {
  // the new name is taken: Verified tags exists already, so the old relation is left alone (verify then calls it an extra column)
  const w = await octoberBuild();
  const entry = result0(w, 'claims_copy');
  await w.client.updateDataSource(entry.data_source_id, { properties: { 'Verified tags': { type: 'relation', relation: { data_source_id: result0(w, 'rulebook').data_source_id, single_property: {} } } } });
  const taken = await runStructure({ plan: planStructure(forFake(revisedStructure()), w.config), client: w.client, root: w.root, config: w.config });
  assert.equal(taken.ok, true);
  assert.deepEqual(taken.columnsRenamed.claims_copy.map((r) => r.to), ['Agent tags (old)', 'Agent notes (old)'], 'no rename onto a name that is taken');
  assert.ok(w.fake.database(entry.database_id).properties['Claim quality tags — verified'], 'and the old column is untouched');
  assert.ok((await verifyStructure({ client: w.client, config: w.config, structure: forFake(revisedStructure()) })).differences.some((d) => d.kind === 'extra column' && /Claim quality tags — verified/.test(d.detail)));

  // the old name has another type than the new column: Agent tags is a relation already, so it is not renamed to Agent tags (old)
  const v = await octoberBuild();
  const ds = result0(v, 'claims_copy');
  await v.client.updateDataSource(ds.data_source_id, { properties: { 'Agent tags': { name: 'Gone' } } });
  await v.client.updateDataSource(ds.data_source_id, { properties: { 'Agent tags': { type: 'relation', relation: { data_source_id: result0(v, 'rulebook').data_source_id, single_property: {} } } } });
  const typed = await runStructure({ plan: planStructure(forFake(revisedStructure()), v.config), client: v.client, root: v.root, config: v.config });
  assert.equal(typed.ok, true);
  assert.ok(!typed.columnsRenamed.claims_copy.some((r) => r.from === 'Agent tags'), 'a relation is not renamed to the old text column\'s new name');
});

test('verify on the table of 16 October names what build will do: the old name still there, the type that differs, the views that are not as the structure says', async () => {
  const w = await octoberBuild();
  const r = await verifyStructure({ client: w.client, config: w.config, structure: forFake(revisedStructure()) });
  assert.equal(r.ok, false);
  const text = r.differences.map((d) => `${d.table} ${d.kind}: ${d.detail}`).join('\n');
  assert.match(text, /claims_copy missing column: "Verified tags" \(relation\) is not in the table \("Claim quality tags — verified" is there under its old name; setup\.mjs build renames it\)/);
  assert.match(text, /claims_copy type: "Agent tags" is rich_text in Notion but relation in the structure; setup\.mjs build renames it to "Agent tags \(old\)" and adds the new one/);
  assert.match(text, /claims_copy missing column: "Agent status" \(select\)/);
  assert.match(text, /claims_copy extra column: "Agent notes" \(rich_text\)/);
  assert.match(text, /claims_copy view filter: "Your queue": expected/);
  assert.match(text, /claims_copy view columns: "Your queue": expected Geo Name, Agent tags, Agent confidence/);
  assert.match(text, /claims_copy view columns: "Table" \(the table's own view\)/);
  assert.ok(!/retired|\(old\)" \(rich_text\) is not in the table/.test(text), 'a retired column that is not there yet is no difference');
  assert.equal(r.differences.filter((d) => d.table !== 'claims_copy').length, 0, 'the other tables are as they should be');
});

test('a table built fresh from the revised structure makes no "(old)" column, and its own view is set to the order as well, because the relation columns are made after the others', async () => {
  const w = build();
  const first = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config });
  assert.equal(first.ok, true);
  const entry = result0(w, 'claims_copy');
  assert.deepEqual(Object.keys(w.fake.database(entry.database_id).properties).filter((n) => /\(old\)/.test(n)), []);
  await w.client.createView({
    databaseId: entry.database_id, dataSourceId: entry.data_source_id, name: 'Table',
    configuration: { type: 'table', properties: Object.values(w.fake.dataSource(entry.data_source_id).properties).map((p) => ({ property_id: p.id, visible: true })) },
  });
  assert.notDeepEqual(shownOf(w, 'Table').slice(0, 3), ['Geo Name', 'Agent tags', 'Agent confidence'], 'in the order the columns were made, the relations come last');
  const again = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: loadConfig(w.root) });
  assert.deepEqual(again.arranged, { claims_copy: ['Table'] });
  assert.deepEqual(shownOf(w, 'Table'), [...REVIEW_ORDER, ...GEO_ORDER]);
  assert.deepEqual((await verify(w)).differences, []);
  const before = w.fake.writes().length;
  const third = await runStructure({ plan: w.plan, client: w.client, root: w.root, config: loadConfig(w.root) });
  assert.deepEqual(third.arranged, {});
  assert.equal(w.fake.writes().length, before);

  // the same arrangement is available on its own, for a builder that makes its views itself (the practice page)
  const other = build();
  await runStructure({ plan: other.plan, client: other.client, root: other.root, config: other.config });
  const e2 = result0(other, 'claims_copy');
  await other.client.createView({
    databaseId: e2.database_id, dataSourceId: e2.data_source_id, name: 'Table',
    configuration: { type: 'table', properties: Object.values(other.fake.dataSource(e2.data_source_id).properties).map((p) => ({ property_id: p.id, visible: true })) },
  });
  const changed = await arrangeOwnViews({ client: other.client, plan: other.plan, table: 'claims_copy', databaseId: e2.database_id, dataSourceId: e2.data_source_id });
  assert.deepEqual(changed, ['Table']);
  assert.deepEqual(await arrangeOwnViews({ client: other.client, plan: other.plan, table: 'claims_copy', databaseId: e2.database_id, dataSourceId: e2.data_source_id }), [], 'a second call changes nothing');
});

test('the configuration sent for a view keeps frozen_column_index only when it is a whole number of at least 0: Notion reports -1 for "no frozen column" and refuses it back', async () => {
  const w = build();
  assert.equal((await runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config })).ok, true);
  const entry = result0(w, 'claims_copy');
  await w.client.createView({
    databaseId: entry.database_id, dataSourceId: entry.data_source_id, name: 'Table',
    configuration: { type: 'table', properties: Object.values(w.fake.dataSource(entry.data_source_id).properties).map((p) => ({ property_id: p.id, visible: true })) },
  });
  const sent = async (frozen) => {
    const bodies = [];
    const client = {
      ...w.client,
      // the view as Notion reports it, with its frozen column
      async retrieveView(id) {
        const view = await w.client.retrieveView(id);
        return view.name === 'Table' ? { ...view, configuration: { ...view.configuration, ...(frozen === undefined ? {} : { frozen_column_index: frozen }) } } : view;
      },
      async updateView(id, body) {
        bodies.push(body);
        return w.client.updateView(id, body);
      },
    };
    const changed = await arrangeOwnViews({ client, plan: w.plan, table: 'claims_copy', databaseId: entry.database_id, dataSourceId: entry.data_source_id });
    return { changed, configuration: bodies[0]?.configuration };
  };
  // -1: the view has no frozen column; the key is left out, and the fake (like Notion) would have refused it
  const none = await sent(-1);
  assert.deepEqual(none.changed, ['Table']);
  assert.ok(!('frozen_column_index' in none.configuration), JSON.stringify(none.configuration).slice(0, 120));
  assert.equal(none.configuration.type, 'table');
  // a view whose frozen_column_index is 1 keeps it (the columns are put out of order again first, so that the view needs arranging)
  const entryProps = Object.values(w.fake.dataSource(entry.data_source_id).properties);
  const view = w.fake.views(entry.database_id).find((v) => v.name === 'Table');
  await w.client.updateView(view.id, { configuration: { type: 'table', properties: [...entryProps].reverse().map((p) => ({ property_id: p.id, visible: true })) } });
  const kept = await sent(1);
  assert.deepEqual(kept.changed, ['Table']);
  assert.equal(kept.configuration.frozen_column_index, 1);
  await w.client.updateView(view.id, { configuration: { type: 'table', properties: [...entryProps].reverse().map((p) => ({ property_id: p.id, visible: true })) } });
  const zero = await sent(0);
  assert.equal(zero.configuration.frozen_column_index, 0, '0 is a valid index and is kept');
  // anything else that is not a whole number of at least 0 is left out too
  for (const odd of [-2, 1.5, '1', null]) {
    await w.client.updateView(view.id, { configuration: { type: 'table', properties: [...entryProps].reverse().map((p) => ({ property_id: p.id, visible: true })) } });
    assert.ok(!('frozen_column_index' in (await sent(odd)).configuration), String(odd));
  }
});
