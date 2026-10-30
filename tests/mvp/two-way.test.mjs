import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateConfig } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import {
  StructureError, hubDifferences, hubPlan, parseViewFilter, parseViewSort, planStructure, renderPreview, runStructure, sameTypeConfig, twoWayPairs, validateStructure, verifyStructure, viewDifferences,
  viewPlan,
} from '../../agents/claim-tagger-mvp/scripts/lib/notion-build.mjs';
import { NotionError } from '../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';
import { V2_TAG_DECISIONS_EDITOR_COLUMNS, buildV2Config, completeStructure } from '../../agents/claim-tagger-mvp/scripts/lib/v2-profile.mjs';
import { builtConfig } from './helpers/config-fixture.mjs';
import { builderClient, cleanTmp, forFake, freshStructure, newWorld, readJson, tmp } from './helpers/setup-world.mjs';

// What the v2 page asks of the builder (STRUCTURE-V2.md, P45 and P46): several sorts in a view, checkbox filters and a bracketed "or" group, two-way relations (a pair made once,
// converted in place), one hint line under each hub link, and the editor column Agent is right. Pure checks, then the builder against a small in-memory Notion that knows
// dual relations (the shared fake keeps them one-sided).

after(cleanTmp);

// ---- view sorts and filters -------------------------------------------------------------------------------------------------------------------

const TABLE = {
  columns: [
    { name: 'Claim', type: 'title', options: [] },
    { name: 'Agent status', type: 'select', options: ['Waits for you', 'Done'] },
    { name: 'Agent proposal', type: 'select', options: ['Applies', 'Does not apply', "Can't tell"] },
    { name: 'Tag outcome', type: 'select', options: ['Applies', 'Does not apply'] },
    { name: 'Agent is right', type: 'checkbox', options: [] },
    { name: 'Agent confidence', type: 'number', options: [] },
    { name: 'Your note', type: 'rich_text', options: [] },
  ],
};

test('parseViewSort reads several sorts joined by "; then ", in order; one clause and "none" behave as before', () => {
  assert.deepEqual(parseViewSort('Claim, A to Z; then Agent confidence, lowest first', TABLE), [
    { property: 'Claim', direction: 'ascending' },
    { property: 'Agent confidence', direction: 'ascending' },
  ]);
  assert.deepEqual(parseViewSort('Agent confidence, highest first; then Claim, Z to A', TABLE), [
    { property: 'Agent confidence', direction: 'descending' },
    { property: 'Claim', direction: 'descending' },
  ]);
  assert.deepEqual(parseViewSort('Agent confidence, lowest first', TABLE), [{ property: 'Agent confidence', direction: 'ascending' }]);
  assert.deepEqual(parseViewSort('none', TABLE), []);
  assert.throws(() => parseViewSort('Claim, A to Z; then Nope, lowest first', TABLE, 'view "Q"'), (e) => e instanceof StructureError && /view "Q": cannot read the sort "Nope, lowest first"/.test(e.message) && /; then /.test(e.message));
  assert.throws(() => parseViewSort('Claim, sideways', TABLE), StructureError);
});

function sortedStructure() {
  const column = (name, type, extra = {}) => ({ name, type, options: [], description: '', ...extra });
  const table = (title, columns) => ({ title, columns: [column('Claim', 'title'), ...columns] });
  return {
    tables: {
      rulebook: table('Rulebook', []), claims: table('Claims', []), rule_changes: table('Rule changes', []), agent_settings: table('Agent settings', []),
      tag_decisions: table('Tag decisions', [column('Agent confidence', 'number')]),
    },
    views: [{ name: 'Q', table: 'tag_decisions', filter: 'all rows', sort: 'Claim, A to Z; then Agent confidence, lowest first', columns: ['Claim'], wrap: false }],
    pages: [],
  };
}

test('a view with two sorts: the plan sends both in order, and the comparison of a view finds a swapped, a missing or an extra sort and nothing else', () => {
  const s = sortedStructure();
  validateStructure(s);
  const plan = viewPlan(s, s.views[0]);
  assert.deepEqual(plan.body.sorts, [{ property: 'Claim', direction: 'ascending' }, { property: 'Agent confidence', direction: 'ascending' }]);
  const dataSource = { properties: { Claim: { id: 'title' }, 'Agent confidence': { id: 'abc' } } };
  const found = (sorts) => ({ filter: null, sorts, configuration: { wrap_cells: false, properties: [{ property_id: 'title', visible: true }, { property_id: 'abc', visible: false }] } });
  // Notion answers with property ids; the comparison turns them into names
  assert.deepEqual(viewDifferences(plan, found([{ property: 'title', direction: 'ascending' }, { property: 'abc', direction: 'ascending' }]), dataSource), []);
  assert.deepEqual(viewDifferences(plan, found([{ property: 'abc', direction: 'ascending' }, { property: 'title', direction: 'ascending' }]), dataSource), ['sorts']);
  assert.deepEqual(viewDifferences(plan, found([{ property: 'title', direction: 'ascending' }]), dataSource), ['sorts']);
  assert.deepEqual(viewDifferences(plan, found([{ property: 'title', direction: 'ascending' }, { property: 'abc', direction: 'descending' }]), dataSource), ['sorts']);
  assert.deepEqual(viewDifferences(plan, found(null), dataSource), ['sorts']);
});

test('parseViewFilter reads "<Column> is ticked" and "<Column> is not ticked" on a checkbox, and refuses the words on any other column', () => {
  assert.deepEqual(parseViewFilter('Agent is right is ticked', TABLE), { property: 'Agent is right', checkbox: { equals: true } });
  assert.deepEqual(parseViewFilter('Agent is right is not ticked', TABLE), { property: 'Agent is right', checkbox: { equals: false } });
  assert.deepEqual(parseViewFilter('Agent status is Done, and Agent is right is ticked', TABLE), {
    and: [{ property: 'Agent status', select: { equals: 'Done' } }, { property: 'Agent is right', checkbox: { equals: true } }],
  });
  assert.throws(() => parseViewFilter('Tag outcome is ticked', TABLE, 'view "Q"'), (e) => e instanceof StructureError && /"ticked" needs a checkbox column, and "Tag outcome" is a select/.test(e.message));
  assert.throws(() => parseViewFilter('Your note is not ticked', TABLE), /needs a checkbox column/);
  assert.throws(() => parseViewFilter('Agent is right is Applies', TABLE), (e) => /checkbox/.test(e.message) && /is ticked/.test(e.message));
  assert.throws(() => parseViewFilter('Nothing at all', TABLE), (e) => /"<column> is ticked", "<column> is not ticked"/.test(e.message));
});

test('parseViewFilter reads a group in brackets, "(<clause>, or <clause>)": the filter of Your queue (a ticked Can\'t tell row stays)', () => {
  const text = "Agent status is Waits for you, and Tag outcome is empty, and (Agent is right is not ticked, or Agent proposal is Can't tell)";
  assert.deepEqual(parseViewFilter(text, TABLE), {
    and: [
      { property: 'Agent status', select: { equals: 'Waits for you' } },
      { property: 'Tag outcome', select: { is_empty: true } },
      { or: [{ property: 'Agent is right', checkbox: { equals: false } }, { property: 'Agent proposal', select: { equals: "Can't tell" } }] },
    ],
  });
  // a group alone, a group first, a group of one clause
  assert.deepEqual(parseViewFilter('(Agent is right is ticked, or Tag outcome is empty)', TABLE), { or: [{ property: 'Agent is right', checkbox: { equals: true } }, { property: 'Tag outcome', select: { is_empty: true } }] });
  assert.deepEqual(parseViewFilter('(Agent is right is ticked, or Tag outcome is empty), and Agent status is Done', TABLE).and[1], { property: 'Agent status', select: { equals: 'Done' } });
  assert.deepEqual(parseViewFilter('Agent status is Done, and (Agent is right is ticked)', TABLE).and[1], { property: 'Agent is right', checkbox: { equals: true } });
});

test('a group in brackets is refused when it would nest deeper than Notion allows: an "is not <A>" or an "<A> or <B>" inside it is an "or" itself, and so is a group inside a group', () => {
  const where = 'view "Q"';
  assert.throws(() => parseViewFilter('Agent status is Done, and (Agent is right is ticked, or Tag outcome is not Applies)', TABLE, where), (e) => e instanceof StructureError && /"Tag outcome is not Applies" cannot stand inside a group/.test(e.message) && /two levels/.test(e.message));
  assert.throws(() => parseViewFilter('(Agent is right is ticked, or Agent proposal is Applies or Does not apply)', TABLE, where), /cannot stand inside a group/);
  assert.throws(() => parseViewFilter('(Agent is right is ticked, or (Tag outcome is empty, or Your note contains x))', TABLE, where), /cannot hold another group/);
  assert.throws(() => parseViewFilter('(Agent is right is ticked, or Tag outcome is empty', TABLE, where), /not closed with a bracket/);
  // the same words outside a group are fine: the "or" is the one level under the view's "and"
  assert.deepEqual(parseViewFilter('Agent status is Done, and Tag outcome is not Applies', TABLE).and[1].or.length, 2);
});

// ---- the structure of two-way relations --------------------------------------------------------------------------------------------------------------

function miniStructure({ twoWay = true, renamed = true } = {}) {
  const table = (title, extra = []) => ({ title, columns: [{ name: 'Name', type: 'title', options: [], description: '' }, ...extra] });
  const rel = (name, to, extra = {}) => ({ name, type: 'relation', options: [], description: `${name}.`, relation_to: to, ...extra });
  return {
    tables: {
      rulebook: table('Rulebook'),
      claims: table('Claims', [rel('Tag decisions', 'tag_decisions', twoWay ? { two_way: 'Open claim' } : {})]),
      tag_decisions: table('Tag decisions', [rel('Open claim', 'claims', { ...(renamed ? { renamed_from: 'Claim page' } : {}), ...(twoWay ? { two_way: 'Tag decisions' } : {}) })]),
      rule_changes: table('Rule changes'),
      agent_settings: table('Agent settings'),
    },
    views: [],
    pages: [],
  };
}

const badStructure = (change, re) => {
  const s = miniStructure();
  change(s);
  assert.throws(() => validateStructure(s), (e) => e instanceof StructureError && re.test(e.message), re.source);
};

test('validateStructure: a two-way pair has both sides, both relations, each pointing at the other table and each naming the other', () => {
  assert.equal(validateStructure(miniStructure()).tables.claims.columns[1].two_way, 'Open claim');
  badStructure((s) => { s.tables.claims.columns[1].two_way = 'Nowhere'; }, /table "Claims", column "Tag decisions": two_way names "Nowhere", which the table "Tag decisions" does not have/);
  badStructure((s) => { s.tables.claims.columns[1].two_way = 'Name'; }, /two_way names "Name" of "Tag decisions", which is a title, not a relation/);
  badStructure((s) => { s.tables.claims.columns[1].two_way = ''; }, /two_way must be the name of the column on the other table/);
  badStructure((s) => { s.tables.claims.columns[1].two_way = 7; }, /two_way must be the name of the column/);
  badStructure((s) => { s.tables.tag_decisions.columns[1].two_way = 'Other'; }, /does not name "Tag decisions" in two_way|which the table "Claims" does not have/);
  badStructure((s) => { delete s.tables.tag_decisions.columns[1].two_way; }, /its other side "Open claim" of "Tag decisions" does not name "Tag decisions" in two_way; both sides of a pair name each other/);
  badStructure((s) => { s.tables.tag_decisions.columns[1].relation_to = 'rulebook'; }, /points at Rulebook, not back at "Claims"|two_way names "Tag decisions", which the table "Rulebook" does not have/);
  badStructure((s) => { s.tables.claims.columns[1].renamed_from = 'Old'; }, /both sides of the pair have renamed_from/);
  badStructure((s) => { s.tables.claims.columns[1].retired = true; }, /a retired column cannot be one side of a two-way relation/);
  badStructure((s) => { s.tables.claims.columns[0].two_way = 'x'; }, /only a relation has two_way/);
  // two columns cannot claim the same partner: the pair is one relation
  badStructure((s) => { s.tables.claims.columns.push({ name: 'Second', type: 'relation', options: [], description: '', relation_to: 'tag_decisions', two_way: 'Open claim' }); }, /does not name "Second" in two_way/);
});

test('twoWayPairs: one entry per pair; the side with renamed_from makes it, else the side on the table first in TABLES', () => {
  assert.deepEqual(twoWayPairs(miniStructure()), [{ builder: { table: 'tag_decisions', column: 'Open claim' }, partner: { table: 'claims', column: 'Tag decisions' } }]);
  // neither side renamed: Claims comes before Tag decisions in TABLES
  assert.deepEqual(twoWayPairs(miniStructure({ renamed: false })), [{ builder: { table: 'claims', column: 'Tag decisions' }, partner: { table: 'tag_decisions', column: 'Open claim' } }]);
  // the earlier table's side renamed: it builds
  const other = miniStructure({ renamed: false });
  other.tables.claims.columns[1].renamed_from = 'Old rows';
  assert.equal(twoWayPairs(other)[0].builder.table, 'claims');
  assert.deepEqual(twoWayPairs(miniStructure({ twoWay: false })), []);
});

test('planStructure: a two-way column carries its partner and role and is planned as dual_property; a relation without two_way is single_property and its entry has no extra key (production is unchanged)', () => {
  const plan = planStructure(miniStructure(), { notion: { parent_page_id: '5e7a0000-0000-4000-8000-0000000000aa' } });
  const open = plan.columns.find((c) => c.name === 'Open claim');
  const rows = plan.columns.find((c) => c.name === 'Tag decisions');
  assert.deepEqual([open.two_way, open.two_way_role, rows.two_way, rows.two_way_role], ['Tag decisions', 'builder', 'Open claim', 'partner']);
  assert.deepEqual(open.body.relation, { dual_property: {} });
  const one = planStructure(miniStructure({ twoWay: false }), { notion: { parent_page_id: '5e7a0000-0000-4000-8000-0000000000aa' } });
  for (const c of one.columns.filter((x) => x.type === 'relation')) {
    assert.deepEqual(c.body.relation, { single_property: {} });
    assert.equal(Object.hasOwn(c, 'two_way'), false);
    assert.equal(Object.hasOwn(c, 'two_way_role'), false);
  }
  // the structure the live page is built from has no two_way anywhere
  const live = planStructure(forFake(freshStructure()), { notion: { parent_page_id: '5e7a0000-0000-4000-8000-0000000000aa' } });
  const relations = live.columns.filter((c) => c.type === 'relation');
  assert.ok(relations.length >= 3);
  for (const c of relations) assert.deepEqual(c.body.relation, { single_property: {} }, c.name);
  assert.ok(live.columns.every((c) => !Object.hasOwn(c, 'two_way_role')));
});

// ---- a small in-memory Notion that knows dual relations ---------------------------------------------------------------------------------------------------

const DS = { rulebook: '11111111111111111111111111111111', claims: '22222222222222222222222222222222', tag_decisions: '33333333333333333333333333333333', rule_changes: '44444444444444444444444444444444', agent_settings: '55555555555555555555555555555555' };
const DB = { rulebook: '66666666666666666666666666666666', claims: '77777777777777777777777777777777', tag_decisions: '88888888888888888888888888888888', rule_changes: '99999999999999999999999999999999', agent_settings: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };

/** Data sources with columns, and the two calls the column step makes. `refuseConvert`: Notion answers 400 to single -> dual. `ignoreConvert`: it answers 200 and changes nothing. */
function miniNotion({ refuseConvert = false, ignoreConvert = false } = {}) {
  const sources = new Map();
  const databaseTexts = new Map(); // database id -> description text
  const requests = [];
  let n = 0;
  const nextId = () => `p${(n += 1)}`;
  const get = (id) => {
    const ds = sources.get(id);
    if (!ds) throw new NotionError(`data source ${id} not found`, { status: 404, code: 'object_not_found' });
    return ds;
  };
  const makeDual = (ds, def) => {
    const target = get(def.relation.data_source_id);
    const name = `Related to ${ds.name} (${def.name})`;
    const synced = { id: nextId(), name, type: 'relation', relation: { data_source_id: ds.id, type: 'dual_property', dual_property: { synced_property_name: def.name, synced_property_id: def.id } } };
    target.properties[name] = synced;
    def.relation = { data_source_id: def.relation.data_source_id, type: 'dual_property', dual_property: { synced_property_name: name, synced_property_id: synced.id } };
  };
  const addSource = (table, name, columns = {}) => {
    sources.set(DS[table], { id: DS[table], name, properties: { Name: { id: 'title', name: 'Name', type: 'title' } } });
    for (const [col, def] of Object.entries(columns)) sources.get(DS[table]).properties[col] = { id: nextId(), name: col, ...def };
  };
  const client = {
    createDatabase: async () => { throw new Error('the tables exist already'); },
    retrieveDataSource: async (id) => structuredClone(get(id)),
    updateDataSource: async (id, { properties }) => {
      requests.push({ method: 'PATCH', id, body: structuredClone({ properties }) });
      const ds = get(id);
      for (const [key, config] of Object.entries(properties)) {
        const existing = Object.values(ds.properties).find((d) => d.name === key || d.id === key);
        if (existing) {
          if (config.name && config.name !== existing.name) {
            if (ds.properties[config.name]) throw new NotionError(`a property named ${config.name} exists already`, { status: 400, code: 'validation_error' });
            for (const other of sources.values()) {
              for (const d of Object.values(other.properties)) if (d.relation?.dual_property?.synced_property_id === existing.id) d.relation.dual_property.synced_property_name = config.name;
            }
            delete ds.properties[existing.name];
            existing.name = config.name;
            ds.properties[config.name] = existing;
          }
          if (typeof config.description === 'string') existing.description = config.description;
          if (config.relation && 'dual_property' in config.relation && existing.relation.type === 'single_property') {
            if (refuseConvert) throw new NotionError('Cannot change a one-way relation to a two-way relation here.', { status: 400, code: 'validation_error' });
            if (!ignoreConvert) makeDual(ds, existing);
          }
        } else {
          const def = { id: nextId(), name: key, type: config.type ?? 'rich_text', ...(config.description ? { description: config.description } : {}) };
          if (config.relation) def.relation = { data_source_id: config.relation.data_source_id, type: 'dual_property' in config.relation ? 'dual_property' : 'single_property', ...('single_property' in config.relation ? { single_property: {} } : {}) };
          ds.properties[key] = def;
          if (config.relation && 'dual_property' in config.relation) makeDual(ds, def);
        }
      }
      return structuredClone(ds);
    },
    retrieveDatabase: async (id) => ({ id, description: [{ plain_text: databaseTexts.get(id) ?? '' }] }),
    updateDatabase: async (id, { description }) => {
      requests.push({ method: 'PATCH', database: id, body: { description } });
      databaseTexts.set(id, description);
      return { id };
    },
  };
  return { sources, requests, client, addSource, makeDual, get, databaseTexts, writes: () => requests.filter((r) => r.method === 'PATCH') };
}

function pairWorld({ oldClaimPage = false, structure = miniStructure(), notionOptions = {}, extraTd = {} } = {}) {
  const notion = miniNotion(notionOptions);
  notion.addSource('rulebook', 'Rulebook');
  notion.addSource('claims', 'Claims');
  notion.addSource('tag_decisions', 'Tag decisions', extraTd);
  notion.addSource('rule_changes', 'Rule changes');
  notion.addSource('agent_settings', 'Agent settings');
  if (oldClaimPage) notion.get(DS.tag_decisions).properties['Claim page'] = { id: 'oldid', name: 'Claim page', type: 'relation', relation: { data_source_id: DS.claims, type: 'single_property', single_property: {} } };
  const config = {
    notion: {
      parent_page_id: '5e7a0000-0000-4000-8000-0000000000aa', protected_database_ids: [], protected_page_ids: [],
      rulebook: { database_id: DB.rulebook, data_source_id: DS.rulebook }, claims: { database_id: DB.claims, data_source_id: DS.claims },
      databases: Object.fromEntries(['tag_decisions', 'rule_changes', 'agent_settings'].map((k) => [k, { database_id: DB[k], data_source_id: DS[k] }])),
    },
  };
  const plan = planStructure(structure, config);
  const root = tmp('twoway');
  const run = () => runStructure({ plan, client: notion.client, root, config, parts: ['databases'] });
  const verify = () => verifyStructure({ client: notion.client, config, structure });
  return { notion, config, plan, structure, run, verify };
}

const col = (w, table, name) => w.notion.get(DS[table]).properties[name];

test('(a) a fresh pair: one request from the Tag decisions side with dual_property, then the column Notion made on Claims is renamed to the partner\'s name; the partner is never added as a relation of its own', async () => {
  const w = pairWorld();
  const r = await w.run();
  assert.equal(r.ok, true, JSON.stringify(r.stopped));
  const writes = w.notion.writes();
  assert.equal(writes.length, 2, 'the pair, then the synced column\'s name; nothing else');
  // 1. the builder side: the data source of Tag decisions, the column with the data source of Claims and an empty dual_property
  assert.deepEqual(writes[0], {
    method: 'PATCH', id: DS.tag_decisions,
    body: { properties: { 'Open claim': { type: 'relation', relation: { data_source_id: DS.claims, dual_property: {} }, description: 'Open claim.' } } },
  });
  // 2. Claims: the synced column, found by the id Notion reported, takes the partner's name
  const synced = Object.values(w.notion.get(DS.claims).properties).find((p) => p.type === 'relation');
  assert.equal(writes[1].id, DS.claims);
  assert.deepEqual(writes[1].body, { properties: { [synced.id]: { name: 'Tag decisions' } } });
  assert.equal(synced.name, 'Tag decisions');
  assert.equal(col(w, 'claims', 'Tag decisions').relation.type, 'dual_property');
  assert.equal(col(w, 'claims', 'Tag decisions').relation.data_source_id, DS.tag_decisions);
  assert.equal(col(w, 'tag_decisions', 'Open claim').relation.type, 'dual_property');
  assert.equal(col(w, 'tag_decisions', 'Open claim').relation.dual_property.synced_property_name, 'Tag decisions', 'Notion keeps the first column pointing at the renamed one');
  // exactly one relation column on Claims: the partner was never added as a relation of its own
  assert.equal(Object.values(w.notion.get(DS.claims).properties).filter((p) => p.type === 'relation').length, 1);
  assert.deepEqual(r.columns, { tag_decisions: ['Open claim'] });
  assert.deepEqual(r.columnsRenamed, { claims: [{ from: 'Related to Tag decisions (Open claim)', to: 'Tag decisions' }] });
  assert.deepEqual(r.twoWay, [{ table: 'tag_decisions', column: 'Open claim', partner_table: 'claims', partner: 'Tag decisions', made: true, converted: false, renamed: { from: 'Related to Tag decisions (Open claim)', to: 'Tag decisions' } }]);

  // a second run finds the pair in order and sends nothing
  const before = w.notion.writes().length;
  const again = await w.run();
  assert.equal(again.ok, true);
  assert.equal(w.notion.writes().length, before);
  assert.deepEqual(again.columns, {});
  assert.deepEqual(again.columnsRenamed, {});
  assert.equal(again.created.columns, 0);
  assert.deepEqual((await w.verify()).differences, []);
});

test('(b) the one-way Claim page of checkpoint 1 becomes Open claim, is PATCHed to dual_property in place, and the synced column is named Tag decisions; nothing is removed or made again', async () => {
  const w = pairWorld({ oldClaimPage: true });
  const oldId = col(w, 'tag_decisions', 'Claim page').id;
  const r = await w.run();
  assert.equal(r.ok, true, JSON.stringify(r.stopped));
  const writes = w.notion.writes();
  assert.equal(writes.length, 3);
  assert.deepEqual(writes[0], { method: 'PATCH', id: DS.tag_decisions, body: { properties: { 'Claim page': { name: 'Open claim' } } } });
  assert.deepEqual(writes[1], { method: 'PATCH', id: DS.tag_decisions, body: { properties: { 'Open claim': { relation: { data_source_id: DS.claims, dual_property: {} } } } } });
  assert.equal(writes[2].id, DS.claims);
  assert.deepEqual(Object.values(writes[2].body.properties), [{ name: 'Tag decisions' }]);
  // the same column, with the same id: renamed and converted, never recreated
  assert.equal(col(w, 'tag_decisions', 'Open claim').id, oldId);
  assert.equal(col(w, 'tag_decisions', 'Claim page'), undefined);
  assert.equal(col(w, 'tag_decisions', 'Open claim').relation.type, 'dual_property');
  assert.equal(col(w, 'claims', 'Tag decisions').relation.type, 'dual_property');
  assert.deepEqual(r.columnsRenamed, { tag_decisions: [{ from: 'Claim page', to: 'Open claim' }], claims: [{ from: 'Related to Tag decisions (Open claim)', to: 'Tag decisions' }] });
  assert.equal(r.created.columns, 0, 'no column was added');
  assert.deepEqual(r.twoWay.map((t) => [t.made, t.converted]), [[false, true]]);
  assert.equal(writes.every((x) => Object.values(x.body.properties).every((p) => p !== null)), true, 'no request that removes a column');
  assert.deepEqual((await w.verify()).differences, []);
});

test('(b) the same column already named Open claim as a one-way relation: only the conversion and the partner\'s name are sent', async () => {
  const w = pairWorld({ oldClaimPage: true });
  const def = col(w, 'tag_decisions', 'Claim page');
  delete w.notion.get(DS.tag_decisions).properties['Claim page'];
  def.name = 'Open claim';
  w.notion.get(DS.tag_decisions).properties['Open claim'] = def;
  const r = await w.run();
  assert.equal(r.ok, true, JSON.stringify(r.stopped));
  assert.equal(w.notion.writes().length, 2);
  assert.deepEqual(w.notion.writes()[0].body, { properties: { 'Open claim': { relation: { data_source_id: DS.claims, dual_property: {} } } } });
});

test('(c) the partner rename alone: a pair that is two-way already but whose other side still has Notion\'s name (a run that stopped between the two steps) is finished by one request', async () => {
  const w = pairWorld({ oldClaimPage: true });
  const def = col(w, 'tag_decisions', 'Claim page');
  delete w.notion.get(DS.tag_decisions).properties['Claim page'];
  def.name = 'Open claim';
  w.notion.get(DS.tag_decisions).properties['Open claim'] = def;
  w.notion.makeDual(w.notion.get(DS.tag_decisions), def);
  const syncedId = def.relation.dual_property.synced_property_id;
  const r = await w.run();
  assert.equal(r.ok, true);
  assert.deepEqual(w.notion.writes(), [{ method: 'PATCH', id: DS.claims, body: { properties: { [syncedId]: { name: 'Tag decisions' } } } }]);
  assert.deepEqual(r.twoWay.map((t) => [t.made, t.converted, t.renamed.to]), [[false, false, 'Tag decisions']]);
});

test('if Notion refuses the one-way to two-way change the run stops with a plain message, the column is untouched and nothing is removed or made again', async () => {
  const w = pairWorld({ oldClaimPage: true, notionOptions: { refuseConvert: true } });
  const oldId = col(w, 'tag_decisions', 'Claim page').id;
  const r = await w.run();
  assert.equal(r.ok, false);
  assert.equal(r.code, 2);
  assert.equal(r.stopped.reason, 'refused');
  assert.match(r.stopped.what, /two-way relation "Open claim" of "tag_decisions"/);
  assert.match(r.stopped.message, /Cannot change a one-way relation/);
  assert.match(r.stopped.next, /could not be made two-way/);
  assert.match(r.stopped.next, /nothing was removed or made again/);
  assert.equal(col(w, 'tag_decisions', 'Open claim').id, oldId, 'the rename of the earlier step stands; the column is the same one');
  assert.equal(col(w, 'tag_decisions', 'Open claim').relation.type, 'single_property');
  assert.equal(Object.values(w.notion.get(DS.claims).properties).filter((p) => p.type === 'relation').length, 0, 'no other side was made');
  assert.equal(w.notion.writes().length, 2, 'the rename and the refused change');
});

test('if Notion answers the change but the read-back still shows one-way, the run stops and says so', async () => {
  const w = pairWorld({ oldClaimPage: true, notionOptions: { ignoreConvert: true } });
  const r = await w.run();
  assert.equal(r.ok, false);
  assert.match(r.stopped.message, /still reads as a one-way relation/);
  assert.match(r.stopped.next, /Notion still reports it as one-way/);
  assert.equal(col(w, 'tag_decisions', 'Open claim').relation.type, 'single_property');
});

test('a column of the partner\'s name that is not the other side of the relation stops the run; it is neither renamed nor removed', async () => {
  const w = pairWorld();
  w.notion.get(DS.claims).properties['Tag decisions'] = { id: 'mine', name: 'Tag decisions', type: 'rich_text' };
  const r = await w.run();
  assert.equal(r.ok, false);
  assert.match(r.stopped.message, /has a column "Tag decisions" \(a rich_text\) that is not the other side of this relation/);
  assert.equal(col(w, 'claims', 'Tag decisions').type, 'rich_text');
  assert.equal(w.notion.writes().length, 1, 'only the pair was made');
});

test('a column of the builder\'s name that is not a relation, or points at another table, stops the run', async () => {
  const text = pairWorld({ extraTd: { 'Open claim': { type: 'rich_text' } } });
  const a = await text.run();
  assert.equal(a.ok, false);
  assert.match(a.stopped.message, /is a rich_text in Notion, not a relation/);
  const wrong = pairWorld({ extraTd: { 'Open claim': { type: 'relation', relation: { data_source_id: DS.rulebook, type: 'single_property', single_property: {} } } } });
  const b = await wrong.run();
  assert.equal(b.ok, false);
  assert.match(b.stopped.message, /points at 1{32}, not at the claims table/);
});

test('relations without two_way go out as single_property, each on its own: the production path is unchanged', async () => {
  const w = pairWorld({ structure: miniStructure({ twoWay: false, renamed: false }) });
  const r = await w.run();
  assert.equal(r.ok, true);
  assert.equal(r.twoWay, undefined);
  const bodies = w.notion.writes().map((x) => x.body.properties);
  assert.deepEqual(bodies, [
    { 'Tag decisions': { type: 'relation', relation: { data_source_id: DS.tag_decisions, single_property: {} }, description: 'Tag decisions.' } },
    { 'Open claim': { type: 'relation', relation: { data_source_id: DS.claims, single_property: {} }, description: 'Open claim.' } },
  ]);
  assert.equal(col(w, 'claims', 'Tag decisions').relation.type, 'single_property');
  assert.equal(col(w, 'tag_decisions', 'Open claim').relation.type, 'single_property');
  assert.deepEqual((await w.verify()).differences, []);
});

// ---- verify ------------------------------------------------------------------------------------------------------------------------------------------

const kinds = (r) => r.differences.map((d) => `${d.table}:${d.kind}`);

test('verify expects the pair: a one-way relation where a pair is expected is a difference that says setup.mjs build converts it; the partner is not missing or extra', async () => {
  const w = pairWorld({ oldClaimPage: true });
  const def = col(w, 'tag_decisions', 'Claim page');
  delete w.notion.get(DS.tag_decisions).properties['Claim page'];
  def.name = 'Open claim';
  w.notion.get(DS.tag_decisions).properties['Open claim'] = def;
  const one = await w.verify();
  assert.deepEqual(kinds(one), ['tag_decisions:relation'], JSON.stringify(one.differences));
  assert.match(one.differences[0].detail, /"Open claim" is a one-way relation in Notion, but the structure wants it two-way with "Tag decisions" on the Claims table; setup\.mjs build converts it/);
  // two-way, but the other side has Notion's own name: one difference that says the build renames it, and no "extra column"
  w.notion.makeDual(w.notion.get(DS.tag_decisions), def);
  const misnamed = await w.verify();
  assert.deepEqual(kinds(misnamed), ['tag_decisions:relation'], JSON.stringify(misnamed.differences));
  assert.match(misnamed.differences[0].detail, /the other side of "Open claim" on the Claims table is called "Related to Tag decisions \(Open claim\)" and the structure calls it "Tag decisions"; setup\.mjs build renames it/);
  await w.run();
  assert.deepEqual((await w.verify()).differences, []);
});

test('verify: the pair before anything is built shows the builder column missing and nothing about the partner; a partner that was deleted is named', async () => {
  const w = pairWorld();
  const before = await w.verify();
  assert.deepEqual(kinds(before), ['tag_decisions:missing column']);
  await w.run();
  delete w.notion.get(DS.claims).properties['Tag decisions'];
  const lost = await w.verify();
  assert.deepEqual(kinds(lost), ['tag_decisions:relation']);
  assert.match(lost.differences[0].detail, /is two-way in Notion, but its other side cannot be found on the Claims table \(the structure calls it "Tag decisions"\)/);
});

test('verify: a partner that is a one-way relation of its own is a difference too', async () => {
  const w = pairWorld();
  await w.run();
  const partner = col(w, 'claims', 'Tag decisions');
  partner.relation = { data_source_id: DS.tag_decisions, type: 'single_property', single_property: {} };
  const diff = await w.verify();
  assert.ok(diff.differences.some((d) => d.table === 'claims' && /"Tag decisions" is a one-way relation in Notion, but the structure wants it as the other side of "Open claim"/.test(d.detail)), JSON.stringify(diff.differences));
});

test('renderPreview names the pair on both columns and which side makes it', () => {
  const text = renderPreview(miniStructure());
  assert.match(text, /\| Open claim \| relation \|[^\n]*two-way: the pair is made from this side, and Notion's other side on the Claims table is named "Tag decisions" \(the one-way column of the earlier build is turned into the pair in place\)/);
  assert.match(text, /\| Tag decisions \| relation \|[^\n]*two-way: the other side of "Open claim" on the Tag decisions table; Notion makes it with that column, it is never added alone/);
});

// ---- hub hint lines ---------------------------------------------------------------------------------------------------------------------------------

const HINT_YQ = 'Tick the box or set the outcome.';
const HINT_LW = 'Set Approved or Rejected.';

function hinted() {
  const s = forFake(freshStructure());
  s.hub.view_hints = { your_queue: HINT_YQ, lessons_waiting: HINT_LW };
  return s;
}

test('validateStructure checks hub.view_hints: a linked view, one line of at most 200 characters, no two alike', () => {
  const bad = (change, re) => {
    const s = hinted();
    change(s);
    assert.throws(() => validateStructure(s), (e) => e instanceof StructureError && re.test(e.message), re.source);
  };
  assert.equal(validateStructure(hinted()).hub.view_hints.your_queue, HINT_YQ);
  bad((s) => { s.hub.view_hints = ['x']; }, /view_hints must be an object/);
  bad((s) => { s.hub.view_hints.agent_disagreed = 'x'; }, /view_hints names "agent_disagreed", which is not one of view_links/);
  bad((s) => { s.hub.view_hints.your_queue = 'two\nlines'; }, /view_hints of "your_queue" must be one line of at most 200 characters/);
  bad((s) => { s.hub.view_hints.your_queue = 'x'.repeat(201); }, /at most 200 characters/);
  bad((s) => { s.hub.view_hints.your_queue = ' '; }, /at most 200 characters/);
  bad((s) => { s.hub.view_hints.lessons_waiting = HINT_YQ; }, /two views have the same hint/);
});

test('hubPlan: a hint is part of its link line\'s plan; a hub without view_hints plans exactly the lines it did', () => {
  const lines = hubPlan(hinted()).view_links;
  assert.equal(lines.find((l) => l.key === 'your_queue').hint, HINT_YQ);
  assert.equal(Object.hasOwn(lines.find((l) => l.key === 'needs_your_note'), 'hint'), false);
  for (const l of hubPlan(forFake(freshStructure())).view_links) assert.deepEqual(Object.keys(l), ['key', 'name', 'text']);
});

const CHILD = (i, text) => ({ id: `b${i}`, type: 'paragraph', paragraph: { rich_text: [{ plain_text: text }] } });

test('hubDifferences: a missing hint is "missing", a misplaced one an order difference, a second copy a leftover; a hub without hints is judged as before', () => {
  const s = hinted();
  const hub = hubPlan(s);
  const note = hub.note;
  const [yq, nn, lw] = hub.view_links.map((l) => l.text);
  const only = (diffs) => diffs.filter((d) => !/is not built yet/.test(d.detail));
  const ok = hubDifferences({ hub, config: { notion: {} }, children: [note, yq, HINT_YQ, nn, lw, HINT_LW].map((t, i) => CHILD(i, t)) });
  assert.deepEqual(only(ok.differences), []);
  const missing = hubDifferences({ hub, config: { notion: {} }, children: [note, yq, nn, lw, HINT_LW].map((t, i) => CHILD(i, t)) });
  assert.deepEqual(only(missing.differences).map((d) => [d.kind, d.detail]), [['missing', 'the hint line under "Your queue" is not on the hub page']]);
  const misplaced = hubDifferences({ hub, config: { notion: {} }, children: [note, yq, nn, HINT_YQ, lw, HINT_LW].map((t, i) => CHILD(i, t)) });
  assert.deepEqual(only(misplaced.differences).map((d) => d.kind), ['order']);
  assert.match(misplaced.differences.find((d) => d.kind === 'order').detail, /they should be .*link "Your queue", hint "Your queue", link "Needs your note"/);
  const twice = hubDifferences({ hub, config: { notion: {} }, children: [note, yq, HINT_YQ, nn, lw, HINT_LW, HINT_YQ].map((t, i) => CHILD(i, t)) });
  assert.deepEqual(only(twice.differences).map((d) => d.kind), ['leftover']);
  assert.match(twice.differences.find((d) => d.kind === 'leftover').detail, /^a second copy of a hint line is on the hub page and was left as it is/);
  // without hints in the plan, a block that reads like a hint is just a block that belongs to none of them
  const plain = hubPlan(forFake(freshStructure()));
  const none = hubDifferences({ hub: plain, config: { notion: {} }, children: [plain.note, ...plain.view_links.map((l) => l.text), HINT_YQ].map((t, i) => CHILD(i, t)) });
  assert.deepEqual(only(none.differences).map((d) => d.kind), ['leftover']);
});

function hubWorld() {
  const w = newWorld({ structure: 'fresh' });
  const structure = hinted();
  return { ...w, structure, client: builderClient(w.fake), plan: planStructure(structure, w.config) };
}
const runHub = (w, extra = {}) => runStructure({ plan: w.plan, client: w.client, root: w.root, config: w.config, ...extra });
const paragraphs = (w) => w.fake.outline(w.parent).filter((l) => l.startsWith('paragraph|')).map((l) => l.slice('paragraph|'.length));
const appends = (w) => w.fake.requests.filter((q) => q.method === 'PATCH' && /^\/blocks\/[^/]+\/children$/.test(q.path));

test('a fresh hub with hints: the warning, then each link line followed by its hint, in one append; a second run sends no write', async () => {
  const w = hubWorld();
  const r = await runHub(w);
  assert.equal(r.ok, true, JSON.stringify(r.stopped));
  const lines = hubPlan(w.structure).view_links.map((l) => l.text);
  assert.deepEqual(paragraphs(w).slice(0, 6), [w.structure.hub.note, lines[0], HINT_YQ, lines[1], lines[2], HINT_LW]);
  assert.equal(appends(w).length, 1);
  assert.deepEqual(appends(w)[0].body.position, { type: 'start' });
  assert.equal(r.created.hub_links, 3);
  assert.equal(r.created.hub_hints, 2);
  assert.equal(r.created.hub_note, 1);
  assert.equal(r.hub.ok, true, JSON.stringify(r.hub.differences));
  const writes = w.fake.writes().length;
  const again = await runHub(w);
  assert.equal(w.fake.writes().length, writes);
  assert.equal(again.created.hub_hints, 0);
  assert.deepEqual(again.hub.added, []);
});

test('hints added to a hub that has its link lines: each goes right after its link line (after_block), nothing is moved or edited, and a second run adds nothing', async () => {
  const w = hubWorld();
  const production = planStructure(forFake(freshStructure()), w.config);
  const first = await runStructure({ plan: production, client: w.client, root: w.root, config: w.config });
  assert.equal(first.ok, true);
  assert.equal(Object.hasOwn(first.created, 'hub_hints'), false, 'a hub without hints keeps its result as it was');
  const lines = hubPlan(w.structure).view_links.map((l) => l.text);
  const before = paragraphs(w).slice(0, 4);
  assert.deepEqual(before, [w.structure.hub.note, ...lines]);
  const sent = appends(w).length;
  const r = await runHub(w, { parts: ['hub'] });
  assert.equal(r.ok, true, JSON.stringify(r.stopped));
  assert.deepEqual(paragraphs(w).slice(0, 6), [w.structure.hub.note, lines[0], HINT_YQ, lines[1], lines[2], HINT_LW]);
  const mine = appends(w).slice(sent);
  assert.equal(mine.length, 2, 'one append per hint');
  assert.ok(mine.every((q) => q.body.position.type === 'after_block'));
  assert.equal(r.created.hub_hints, 2);
  assert.equal(r.created.hub_links, 0);
  assert.deepEqual(r.hub.added, [HINT_YQ, HINT_LW]);
  assert.equal(r.hub.ok, true, JSON.stringify(r.hub.differences));
  const writes = w.fake.writes().length;
  const again = await runHub(w, { parts: ['hub'] });
  assert.equal(w.fake.writes().length, writes);
  assert.equal(again.created.hub_hints, 0);
});

test('a link line that is missing is added together with its hint, in order, while a link that is there only gets its hint', async () => {
  const w = hubWorld();
  const lines = hubPlan(w.structure).view_links.map((l) => l.text);
  const production = planStructure(forFake(freshStructure()), w.config);
  await runStructure({ plan: production, client: w.client, root: w.root, config: w.config, parts: ['pages', 'databases', 'views'] });
  const views = w.config.notion.views;
  // the page has only the link line of Lessons waiting, typed by hand with its address
  await w.client.appendBlocks(w.parent, [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Lessons waiting', link: { url: views.lessons_waiting.url } } }, { type: 'text', text: { content: lines[2].slice('Lessons waiting'.length) } }] } }]);
  const r = await runHub(w, { parts: ['hub'] });
  assert.equal(r.ok, true, JSON.stringify(r.stopped));
  const text = paragraphs(w);
  assert.deepEqual(text.slice(0, 6), [w.structure.hub.note, lines[0], HINT_YQ, lines[1], lines[2], HINT_LW]);
  assert.equal(r.created.hub_links, 2);
  assert.equal(r.created.hub_hints, 2);
});

// ---- the v2 spec through completeStructure -------------------------------------------------------------------------------------------------------

const V2_SPEC = readFileSync(new URL('../../docs/mvp-2026-11/STRUCTURE-V2.md', import.meta.url), 'utf8');

test('completeStructure: insert_columns keep renamed_from and two_way; the completion\'s renamed_from sets the earlier names; the pair is valid and Open claim builds it', () => {
  const s = completeStructure(V2_SPEC);
  const open = s.tables.tag_decisions.columns.find((c) => c.name === 'Open claim');
  assert.deepEqual([open.relation_to, open.renamed_from, open.two_way], ['claims', 'Claim page', 'Tag decisions']);
  const rows = s.tables.claims.columns.find((c) => c.name === 'Tag decisions');
  assert.deepEqual([rows.type, rows.relation_to, rows.two_way, rows.renamed_from], ['relation', 'tag_decisions', 'Open claim', undefined]);
  const renamed = (table) => Object.fromEntries(s.tables[table].columns.filter((c) => c.renamed_from).map((c) => [c.name, c.renamed_from]));
  assert.deepEqual(renamed('tag_decisions'), { 'Open claim': 'Claim page', "Agent's view of your decision": 'Agent reading', 'Why the agent thinks so': 'Reading note', 'After the rule change': 'Follow-up' });
  assert.deepEqual(renamed('claims'), { "Agent's view of your decision": 'Agent reading' });
  assert.deepEqual(twoWayPairs(s), [{ builder: { table: 'tag_decisions', column: 'Open claim' }, partner: { table: 'claims', column: 'Tag decisions' } }]);
  // the new editor column and the new views
  assert.equal(s.tables.tag_decisions.columns.find((c) => c.name === 'Agent is right').type, 'checkbox');
  const queue = s.views.find((v) => v.name === 'Your queue');
  assert.equal(queue.sort, 'Claim, A to Z; then Agent confidence, lowest first');
  assert.deepEqual(viewPlan(s, queue).body.sorts.map((x) => x.property), ['Claim', 'Agent confidence']);
  for (const v of s.views.filter((x) => x.table === 'tag_decisions')) assert.equal(viewPlan(s, v).body.sorts.length, 2, v.name);
  assert.deepEqual(Object.keys(s.hub.view_hints).sort(), ['agent_disagreed', 'lessons_waiting', 'needs_your_note', 'your_queue']);
});

test('completeStructure refuses a renamed_from that names a column the table does not have, or a table the spec does not have', () => {
  assert.throws(() => completeStructure(V2_SPEC.replace('"After the rule change": "Follow-up"', '"No such column": "Follow-up"')), /says "No such column" was "Follow-up", but tag_decisions has no column "No such column"/);
  assert.throws(() => completeStructure(V2_SPEC.replace('"tag_decisions": { "Agent\'s view', '"nowhere": { "Agent\'s view')), /renames columns of the table "nowhere"/);
});

test('the renamed columns of Tag decisions keep their option colours under the v2 names', () => {
  const s = completeStructure(V2_SPEC);
  const plan = planStructure(s, { notion: { parent_page_id: '5e7a0000-0000-4000-8000-0000000000aa' } });
  const colours = (name) => plan.databases.find((d) => d.table === 'tag_decisions').body.initial_data_source.properties[name][plan.columns.find((c) => c.table === 'tag_decisions' && c.name === name).type].options.map((o) => o.color);
  assert.deepEqual(colours("Agent's view of your decision"), ['gray', 'yellow', 'orange']);
  assert.deepEqual(colours('After the rule change'), ['green', 'red']);
});

// ---- Agent is right: the editor column ---------------------------------------------------------------------------------------------------------------

test('Agent is right is an editor column of Tag decisions on v2; Tag outcome and Your note stay required and the committed v2 config validates', () => {
  assert.deepEqual([...V2_TAG_DECISIONS_EDITOR_COLUMNS], ['Agent is right', 'Tag outcome', 'Your note']);
  const production = builtConfig();
  production.notion.parent_page_id = '3fa273e2-14eb-8051-99f3-d12ef01db453';
  const c = buildV2Config(production);
  assert.deepEqual(c.editor_columns.tag_decisions, ['Agent is right', 'Tag outcome', 'Your note']);
  assert.deepEqual(validateConfig(c).errors, []);
  for (const name of ['Tag outcome', 'Your note']) {
    const d = structuredClone(c);
    d.editor_columns.tag_decisions = d.editor_columns.tag_decisions.filter((x) => x !== name);
    assert.ok(validateConfig(d).errors.some((m) => m.includes(`"${name}"`)), name);
  }
  const without = structuredClone(c);
  without.editor_columns.tag_decisions = ['Tag outcome', 'Your note'];
  assert.deepEqual(validateConfig(without).errors, [], 'the tick is not required by the validator');
  const committed = readJson(join(import.meta.dirname, '..', '..', 'agents', 'claim-tagger-mvp', 'profiles', 'v2', 'config.json'));
  assert.deepEqual(committed.editor_columns.tag_decisions, ['Agent is right', 'Tag outcome', 'Your note']);
  assert.deepEqual(validateConfig(committed).errors, []);
});

// ---- the description sync (sync_descriptions) ------------------------------------------------------------------------------------------------------

/** The pair structure with a description on a plain column and on the table, and the sync on or off. Notion has the old words on both. */
function describedWorld({ sync = true, partnerDescription = 'Tag decisions.', oldClaimPage = true } = {}) {
  const structure = miniStructure();
  structure.tables.tag_decisions.columns.push({ name: 'Your note', type: 'rich_text', options: [], description: 'Plain words.' });
  structure.tables.tag_decisions.description = 'Decide here.';
  structure.tables.claims.columns[1].description = partnerDescription;
  if (sync) structure.sync_descriptions = true;
  const w = pairWorld({ structure, oldClaimPage, extraTd: { 'Your note': { type: 'rich_text', description: 'Start with a reason word.' } } });
  if (oldClaimPage) col(w, 'tag_decisions', 'Claim page').description = 'The claim\'s page.';
  w.notion.databaseTexts.set(DB.tag_decisions, 'Old line.');
  return w;
}
// a description write carries the column's description and its type's config as Notion reported it, never `type` or `name` (those are a column being made or renamed)
const descriptionWrites = (w) => w.notion.requests.filter((r) => r.body.properties ? Object.values(r.body.properties).some((p) => 'description' in p && !('type' in p) && !('name' in p)) : r.database);

test('validateStructure takes sync_descriptions only as a boolean, and completeStructure takes it from the completion like made_from', () => {
  const s = miniStructure();
  s.sync_descriptions = 'yes';
  assert.throws(() => validateStructure(s), /sync_descriptions must be true or false/);
  s.sync_descriptions = false;
  assert.equal(validateStructure(s).sync_descriptions, false);
  assert.equal(completeStructure(V2_SPEC).sync_descriptions, true);
  assert.equal(planStructure(completeStructure(V2_SPEC), { notion: { parent_page_id: '5e7a0000-0000-4000-8000-0000000000aa' } }).sync_descriptions, true);
});

test('without sync_descriptions nothing about descriptions is written or reported: the production build and verify are as they were', async () => {
  const w = describedWorld({ sync: false });
  assert.equal(Object.hasOwn(w.plan, 'sync_descriptions'), false);
  const r = await w.run();
  assert.equal(r.ok, true, JSON.stringify(r.stopped));
  assert.deepEqual(descriptionWrites(w), []);
  assert.equal(Object.hasOwn(r.created, 'descriptions'), false);
  assert.equal(Object.hasOwn(r, 'descriptions'), false);
  assert.equal(col(w, 'tag_decisions', 'Your note').description, 'Start with a reason word.');
  assert.equal(w.notion.databaseTexts.get(DB.tag_decisions), 'Old line.');
  const v = await w.verify();
  assert.ok(!v.differences.some((d) => d.kind === 'column description'), JSON.stringify(v.differences));
  assert.match(v.differences.find((d) => d.kind === 'description').detail, /write it in Notion under the table's name \(the build writes it only when it makes the table\)/);
});

test('with sync_descriptions the build writes the columns whose description differs, one call per table, then the table\'s description with updateDatabase; a second run writes nothing', async () => {
  const w = describedWorld();
  const before = await w.verify();
  const lines = before.differences.filter((d) => d.kind === 'column description').map((d) => d.detail);
  assert.ok(lines.some((l) => /^"Your note" has the description "Start with a reason word\.", the structure says "Plain words\."; setup\.mjs build writes it$/.test(l)), lines.join('\n'));
  assert.match(before.differences.find((d) => d.kind === 'description').detail, /setup\.mjs build writes it/);
  assert.doesNotMatch(before.differences.find((d) => d.kind === 'description').detail, /write it in Notion/);

  const r = await w.run();
  assert.equal(r.ok, true, JSON.stringify(r.stopped));
  const writes = descriptionWrites(w);
  assert.deepEqual(writes, [
    { method: 'PATCH', id: DS.claims, body: { properties: { 'Tag decisions': { relation: { data_source_id: DS.tag_decisions, dual_property: {} }, description: 'Tag decisions.' } } } },
    {
      method: 'PATCH',
      id: DS.tag_decisions,
      body: { properties: { 'Open claim': { relation: { data_source_id: DS.claims, dual_property: {} }, description: 'Open claim.' }, 'Your note': { rich_text: {}, description: 'Plain words.' } } },
    },
    { method: 'PATCH', database: DB.tag_decisions, body: { description: 'Decide here.' } },
  ]);
  assert.equal(r.created.descriptions, 4);
  assert.deepEqual(r.descriptions, { claims: { columns: ['Tag decisions'] }, tag_decisions: { columns: ['Open claim', 'Your note'], table: true } });
  assert.deepEqual((await w.verify()).differences, []);
  const sent = w.notion.requests.length;
  const again = await w.run();
  assert.equal(again.created.descriptions, 0);
  assert.equal(w.notion.requests.length, sent, 'not one write on a second run');
});

test('the other side of a two-way relation keeps its description unless the structure gives it one', async () => {
  const w = describedWorld({ partnerDescription: '' });
  const r = await w.run();
  assert.equal(r.ok, true, JSON.stringify(r.stopped));
  assert.equal(col(w, 'claims', 'Tag decisions').description, undefined);
  assert.deepEqual(descriptionWrites(w).map((x) => x.id ?? x.database), [DS.tag_decisions, DB.tag_decisions]);
  assert.deepEqual((await w.verify()).differences, []);
});

test('a description sync that Notion refuses stops the run with the table named; nothing is removed', async () => {
  const w = describedWorld();
  const client = { ...w.notion.client, updateDatabase: async () => { throw new NotionError('description is not accepted', { status: 400, code: 'validation_error' }); } };
  const r = await runStructure({ plan: w.plan, client, root: tmp('twoway'), config: w.config, parts: ['databases'] });
  assert.equal(r.ok, false);
  assert.match(r.stopped.what, /the description of the table "tag_decisions"/);
  assert.match(r.stopped.message, /description is not accepted/);
});

test('sameTypeConfig sends the column type as Notion reported it, so a description update changes nothing else (Notion refuses a description alone)', () => {
  assert.deepEqual(sameTypeConfig({ type: 'select', select: { options: [{ id: 'a1', name: 'Agent slip', color: 'red', description: null }] } }), { select: { options: [{ id: 'a1', name: 'Agent slip', color: 'red' }] } });
  assert.deepEqual(sameTypeConfig({ type: 'relation', relation: { data_source_id: 'ds', type: 'single_property', single_property: {} } }), { relation: { data_source_id: 'ds', single_property: {} } });
  assert.deepEqual(sameTypeConfig({ type: 'relation', relation: { data_source_id: 'ds', type: 'dual_property', dual_property: { synced_property_id: 'x' } } }), { relation: { data_source_id: 'ds', dual_property: {} } });
  assert.deepEqual(sameTypeConfig({ type: 'number', number: { format: 'number' } }), { number: { format: 'number' } });
  assert.deepEqual(sameTypeConfig({ type: 'checkbox', checkbox: {} }), { checkbox: {} });
});
