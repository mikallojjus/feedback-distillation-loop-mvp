import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CAPABILITIES, CLAIMS_COPY_COLUMNS, READING_DEFAULTS, RULE_CHANGES_AGENT_STATUS, RULEBOOK_COLUMNS, TABLES,
  capabilityOf, editorColumns, groupOf, isDemo, isProtected, loadConfig, readingSettings, tableEntry, validateConfig, writableProperties,
} from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import { codeRoot } from '../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';
import { builtConfig, fillIds, placeholderConfig } from './helpers/config-fixture.mjs';

const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-config-'));
  roots.push(dir);
  return dir;
}
/**
 * A fresh copy of the config as it was before setup (fixtures/config.placeholder.json), ready to be changed by one test. Not the live config.json:
 * setup fills its ids in, and the tests below that need placeholders must not depend on how far setup has got.
 */
const shipped = () => placeholderConfig();
const problems = (config) => validateConfig(config).errors;
const mentions = (config, text) => problems(config).some((p) => p.includes(text));

// ---- the file in the repository -------------------------------------------------------------------------------------------------

// The only tests that read the live agents/claim-tagger-mvp/config.json: each accepts a placeholder and a real id wherever setup fills one in.
const PLACEHOLDER_OR_ID = /^(<.*>|[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})$/i;

test('the config.json in the agent folder is valid, before and after setup has filled in its ids', () => {
  const config = loadConfig(codeRoot());
  assert.equal(config.agent, 'claim-tagger-mvp');
  assert.equal(config.demo, false);
  assert.equal(isDemo(config), false);
  assert.match(config.notion.rulebook.database_id, /^(<|[0-9a-f]{8}-?[0-9a-f]{4})/, 'a placeholder until setup has run, then a Notion id');
  assert.equal(config.notion.rulebook.key, 'Name');
  assert.equal(config.notion.claims[0].name, 'claims_copy');
  assert.equal(groupOf(config, 'Context-dependent'), 'G1', 'only Context-dependent has rules and is judged');
  assert.deepEqual(validateConfig(config), { ok: true, errors: [] });
  for (const table of TABLES) {
    const entry = tableEntry(config, table);
    assert.match(entry.database_id, PLACEHOLDER_OR_ID, `${table}: database_id`);
    assert.match(entry.data_source_id, PLACEHOLDER_OR_ID, `${table}: data_source_id`);
  }
  for (const page of ['demos', 'demo_tests']) assert.match(config.notion.pages[page], PLACEHOLDER_OR_ID, `pages.${page}`);
  for (const [name, view] of Object.entries(config.notion.views ?? {})) {
    assert.match(String(view?.id ?? view), PLACEHOLDER_OR_ID, `views.${name}: the id of a view that setup made`);
  }
});

test('the fixture the tests start from is the config before setup: valid, every id that setup fills still a placeholder, no views, a new copy every time', () => {
  const config = placeholderConfig();
  assert.deepEqual(validateConfig(config), { ok: true, errors: [] });
  for (const table of TABLES) {
    const entry = tableEntry(config, table);
    assert.match(entry.database_id, /^</, `${table}: database_id`);
    assert.match(entry.data_source_id, /^</, `${table}: data_source_id`);
  }
  assert.match(config.notion.pages.demos, /^</);
  assert.match(config.notion.pages.demo_tests, /^</);
  assert.equal(config.notion.views, undefined, 'setup adds the views');
  assert.equal(config.demo, false);
  config.notion.rulebook.key = 'changed by a test';
  config.notion.protected_database_ids.length = 0;
  assert.equal(placeholderConfig().notion.rulebook.key, 'Name', 'what a test does to its copy never reaches the next copy');
  assert.ok(placeholderConfig().notion.protected_database_ids.length > 0);

  const built = builtConfig();
  assert.deepEqual(validateConfig(built), { ok: true, errors: [] });
  const ids = TABLES.flatMap((table) => [tableEntry(built, table).database_id, tableEntry(built, table).data_source_id]).concat(built.notion.pages.demos, built.notion.pages.demo_tests);
  assert.equal(new Set(ids).size, ids.length, 'every id setup fills is different');
  assert.ok(ids.every((id) => PLACEHOLDER_OR_ID.test(id) && !id.startsWith('<')), 'and a real one');
  assert.equal(built.notion.pages.proposal, config.notion.pages.proposal, 'an id that was already known is kept');
});

test('the live config.json still has every key of the fixture (setup adds ids and views and removes nothing): a renamed or removed key means the fixture is stale', () => {
  const paths = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (
    value !== null && typeof value === 'object' && !Array.isArray(value) ? [`${prefix}${key}`, ...paths(value, `${prefix}${key}.`)] : [`${prefix}${key}`]
  ));
  const live = new Set(paths(JSON.parse(readFileSync(join(codeRoot(), 'config.json'), 'utf8'))));
  const lost = paths(placeholderConfig()).filter((p) => !live.has(p));
  assert.deepEqual(lost, [], 'tests/mvp/fixtures/config.placeholder.json holds keys that agents/claim-tagger-mvp/config.json no longer has: update the fixture');
});

test('the editor columns of the shipped config are never in any writable set, setup or not (the live file, whatever setup has filled in, and the config before setup)', () => {
  for (const config of [loadConfig(codeRoot()), shipped()]) {
    for (const table of TABLES) {
      for (const setup of [false, true]) {
        const writable = writableProperties(config, table, { setup });
        for (const column of editorColumns(config, table)) assert.ok(!writable.has(column), `${table} (setup ${setup}): ${column} is writable`);
      }
    }
    assert.deepEqual(config.editor_columns.rule_changes_status_editor_values.filter((v) => RULE_CHANGES_AGENT_STATUS.includes(v)), [], 'Approved and Rejected are not values a script writes');
  }
});

// ---- loadConfig ----------------------------------------------------------------------------------------------------------------

test('loadConfig reads config.json from the given state root', () => {
  const root = tmp();
  const config = shipped();
  config.models.judge = 'a-test-model';
  writeFileSync(join(root, 'config.json'), JSON.stringify(config));
  assert.equal(loadConfig(root).models.judge, 'a-test-model');
});

test('loadConfig names the file when it is missing or is not JSON', () => {
  const root = tmp();
  assert.throws(() => loadConfig(root), (e) => e.message.includes(join(root, 'config.json')) && /no config\.json/.test(e.message));
  writeFileSync(join(root, 'config.json'), '{ not json');
  assert.throws(() => loadConfig(root), (e) => e.message.includes('config.json') && /invalid JSON/.test(e.message));
});

test('loadConfig lists every problem of a config of the wrong shape, not only the first', () => {
  const root = tmp();
  const config = shipped();
  delete config.notion.rulebook.key;
  config.notion.page_size = 500;
  config.judge.effort = 'turbo';
  writeFileSync(join(root, 'config.json'), JSON.stringify(config));
  assert.throws(() => loadConfig(root), (e) => {
    assert.match(e.message, /notion\.rulebook\.key: expected a non-empty string/);
    assert.match(e.message, /notion\.page_size: expected a whole number from 1 to 100/);
    assert.match(e.message, /judge\.effort: expected one of low, medium, high, xhigh, max/);
    return true;
  });
});

// ---- validateConfig ------------------------------------------------------------------------------------------------------------

test('validateConfig refuses what is not an object', () => {
  for (const bad of [null, [], 'text', 7]) assert.equal(validateConfig(bad).ok, false);
  assert.deepEqual(problems(null), ['config: expected an object']);
});

test('validateConfig: the agent name, API versions and real ids are checked', () => {
  const a = shipped();
  a.agent = 'claim-tagger';
  assert.ok(mentions(a, 'agent: expected "claim-tagger-mvp"'));
  const b = shipped();
  b.notion.api_version = 'latest';
  b.notion.builder_api_version = '2026-3-11';
  assert.ok(mentions(b, 'notion.api_version'));
  assert.ok(mentions(b, 'notion.builder_api_version'));
  const c = shipped();
  c.notion.parent_page_id = '<setup>';
  c.notion.protected_page_ids.push('not-an-id');
  c.notion.setup_page_parents = [];
  assert.ok(mentions(c, 'notion.parent_page_id: expected a Notion id (32 hex'), 'a placeholder is not allowed where the id is already known');
  assert.ok(mentions(c, 'notion.protected_page_ids[3]'));
  assert.ok(mentions(c, 'notion.setup_page_parents: expected at least 1 item'));
});

test('validateConfig: placeholders that start with "<" are accepted only where setup fills the id', () => {
  const ok = shipped();
  ok.notion.pages.proposal = '<set by setup>';
  ok.notion.databases.rule_changes.data_source_id = '<setup>';
  assert.equal(validateConfig(ok).ok, true);
  const bad = shipped();
  bad.notion.rulebook.database_id = 'setup';
  assert.ok(mentions(bad, 'notion.rulebook.database_id: expected a Notion id or a placeholder that starts with "<"'));
  const noSource = shipped();
  noSource.notion.sources.real_claims.database_id = '<setup>';
  assert.ok(mentions(noSource, 'notion.sources.real_claims.database_id'));
});

test('validateConfig: the config after setup, with every placeholder replaced by a real id, is valid', () => {
  const config = shipped();
  const n = fillIds(config.notion);
  assert.ok(n >= 12, `filled ${n} placeholders`);
  assert.deepEqual(problems(config), []);
  assert.equal(tableEntry(config, 'rulebook').database_id.startsWith('5e7a0000'), true);
});

test('validateConfig: a real id with dashes, without dashes, or in capitals is fine', () => {
  const config = shipped();
  config.notion.rulebook.database_id = '3FA273E2-14EB-8051-99F3-D19DB453AAAA';
  config.notion.rulebook.data_source_id = '3fa273e214eb805199f3d12ef01db453';
  assert.equal(validateConfig(config).ok, true);
});

test('validateConfig: the sources must be read only and protected, and the own tables must not be protected', () => {
  const a = shipped();
  a.notion.sources.taxonomy.read_only = false;
  assert.ok(mentions(a, 'notion.sources.taxonomy.read_only: must be true'));
  const b = shipped();
  b.notion.protected_database_ids = b.notion.protected_database_ids.filter((x) => !x.startsWith('d1307596'));
  assert.ok(mentions(b, 'notion.sources.real_claims.data_source_id: must also be listed in protected_database_ids'));
  const c = shipped();
  c.notion.rulebook.database_id = c.notion.protected_database_ids[0];
  c.notion.databases.tag_decisions.data_source_id = c.notion.protected_database_ids[1].toUpperCase();
  assert.ok(mentions(c, 'notion.rulebook.database_id: is in the protected lists'));
  assert.ok(mentions(c, 'notion.databases.tag_decisions.data_source_id: is in the protected lists'));
});

test('validateConfig: the claims copy entries need one enabled entry, unique names and their column maps', () => {
  const none = shipped();
  none.notion.claims[0].enabled = false;
  assert.ok(mentions(none, 'notion.claims: no entry is enabled'));
  const twice = shipped();
  twice.notion.claims.push({ ...structuredClone(twice.notion.claims[0]), enabled: false });
  assert.ok(mentions(twice, 'notion.claims: two entries have the same name'));
  const cols = shipped();
  delete cols.notion.claims[0].columns.link;
  cols.notion.claims[0].write_columns.tags = '';
  assert.ok(mentions(cols, 'notion.claims[0].columns.link'));
  assert.ok(mentions(cols, 'notion.claims[0].write_columns.tags'));
  const empty = shipped();
  empty.notion.claims = [];
  assert.ok(mentions(empty, 'notion.claims: expected at least 1 item'));
});

test('validateConfig: tags and judge groups', () => {
  const tags = shipped();
  tags.tags['Wordy'] = 'magic';
  tags.tags.default = 'nope';
  assert.ok(mentions(tags, 'tags.Wordy'));
  assert.ok(mentions(tags, 'tags.default'));
  const group = shipped();
  group.judge.groups.G2 = ['Improperly sourced'];
  assert.ok(mentions(group, 'judge.groups.G2: "Improperly sourced" is a source tag, and only text tags are judged'));
  const twice = shipped();
  twice.judge.groups.G2 = ['Context-dependent'];
  assert.ok(mentions(twice, 'judge.groups.G2: "Context-dependent" is already in group G1'));
  const emptyGroup = shipped();
  emptyGroup.judge.groups.G3 = [];
  assert.ok(mentions(emptyGroup, 'judge.groups.G3: expected at least 1 item'));
});

test('validateConfig: numbers, the re-read band and the backoff list', () => {
  const config = shipped();
  config.judge.rerun.band = [0.8, 0.2];
  config.judge.rerun.max_share = 1.5;
  config.judge.runs_max = 0;
  config.judge.transient.backoff_ms = [];
  config.queue.sitting_rows = 0;
  config.gate.default.flip_rejudge_runs = -1;
  config.notion.requests_per_second = 0;
  for (const where of ['judge.rerun.band', 'judge.rerun.max_share', 'judge.runs_max', 'judge.transient.backoff_ms', 'queue.sitting_rows', 'gate.default.flip_rejudge_runs', 'notion.requests_per_second']) {
    assert.ok(mentions(config, where), where);
  }
});

test('validateConfig: prompt paths stay inside the agent folder', () => {
  const config = shipped();
  config.judge.prompt = '../outside.md';
  config.distill.prompt = 'C:\\somewhere\\x.md';
  config.distill.wording_prompt = '/etc/x';
  assert.ok(mentions(config, 'judge.prompt: expected a path inside the agent folder'));
  assert.ok(mentions(config, 'distill.prompt: expected a path inside the agent folder'));
  assert.ok(mentions(config, 'distill.wording_prompt: expected a path inside the agent folder'));
});

test('the reading settings of distill: the shipped config names them, a missing one gets its default, a bad one is refused', () => {
  const config = shipped();
  assert.deepEqual(readingSettings(config), { reading_prompt: 'prompts/reading.md', reading_batch: 10, reading_effort: 'medium' }, 'the shipped values are the defaults');
  assert.deepEqual(READING_DEFAULTS, readingSettings(config));
  assert.deepEqual(problems(config), []);

  const bare = shipped();
  for (const key of ['reading_prompt', 'reading_batch', 'reading_effort']) delete bare.distill[key];
  assert.deepEqual(problems(bare), [], 'the three are optional');
  assert.deepEqual(readingSettings(bare), { ...READING_DEFAULTS }, 'and a config without them gets the defaults');
  assert.deepEqual(readingSettings({}), { ...READING_DEFAULTS }, 'also a config with no distill section at all');
  const own = shipped();
  Object.assign(own.distill, { reading_batch: 4, reading_effort: 'high', reading_prompt: 'prompts/other.md' });
  assert.deepEqual(readingSettings(own), { reading_prompt: 'prompts/other.md', reading_batch: 4, reading_effort: 'high' });

  const bad = shipped();
  Object.assign(bad.distill, { reading_batch: 0, reading_effort: 'whenever', reading_prompt: '../outside.md' });
  assert.ok(mentions(bad, 'distill.reading_batch: expected a whole number from 1'));
  assert.ok(mentions(bad, 'distill.reading_effort: expected one of low, medium, high, xhigh, max'));
  assert.ok(mentions(bad, 'distill.reading_prompt: expected a path inside the agent folder'));
});

test('a demo profile needs a demo_id that is safe as a folder name', () => {
  const demo = shipped();
  demo.demo = true;
  assert.ok(mentions(demo, 'demo_id'));
  demo.demo_id = '../escape';
  assert.ok(mentions(demo, 'demo_id'));
  demo.demo_id = '..';
  assert.ok(mentions(demo, 'demo_id'));
  demo.demo_id = '2026-10-15-practice';
  assert.deepEqual(problems(demo), []);
  assert.equal(isDemo(demo), true);
  const flag = shipped();
  flag.demo = 'yes';
  assert.ok(mentions(flag, 'demo: expected true or false'));
  const absent = shipped();
  delete absent.demo;
  assert.equal(validateConfig(absent).ok, true, 'a missing flag means a production config');
  assert.equal(isDemo(absent), false);
  assert.equal(isDemo(undefined), false);
});

// ---- tableEntry ----------------------------------------------------------------------------------------------------------------

test('tableEntry returns the entry of each table, the object itself', () => {
  const config = shipped();
  assert.equal(tableEntry(config, 'rulebook'), config.notion.rulebook);
  assert.equal(tableEntry(config, 'claims_copy'), config.notion.claims[0]);
  assert.equal(tableEntry(config, 'tag_decisions'), config.notion.databases.tag_decisions);
  assert.equal(tableEntry(config, 'rule_changes'), config.notion.databases.rule_changes);
  assert.equal(tableEntry(config, 'agent_settings'), config.notion.databases.agent_settings);
  assert.equal(tableEntry(config, 'claims_copy').key, 'Geo ID');
  assert.equal(tableEntry(config, 'rule_changes').key, 'Lesson');
  tableEntry(config, 'rulebook').database_id = '0123456789abcdef0123456789abcdef';
  assert.equal(config.notion.rulebook.database_id, '0123456789abcdef0123456789abcdef', 'setup can fill an id through the entry');
});

test('tableEntry takes the first enabled claims entry and fails clearly otherwise', () => {
  const config = shipped();
  const second = structuredClone(config.notion.claims[0]);
  second.name = 'claims_world';
  config.notion.claims[0].enabled = false;
  config.notion.claims.push(second);
  assert.equal(tableEntry(config, 'claims_copy').name, 'claims_world');
  second.enabled = false;
  assert.throws(() => tableEntry(config, 'claims_copy'), /no entry of notion\.claims is enabled/);
  assert.throws(() => tableEntry(config, 'taxonomy'), /unknown table "taxonomy"/);
  delete config.notion.databases.rule_changes;
  assert.throws(() => tableEntry(config, 'rule_changes'), /no entry for the table "rule_changes"/);
  assert.throws(() => tableEntry({}, 'rulebook'), /no entry for the table "rulebook"/);
});

// ---- isProtected ---------------------------------------------------------------------------------------------------------------

test('isProtected ignores dashes and case and covers databases, data sources and pages', () => {
  const config = shipped();
  assert.equal(isProtected(config, 'f05273e214eb8353b0a981544507de32'), true, 'taxonomy database');
  assert.equal(isProtected(config, 'F05273E2-14EB-8353-B0A9-81544507DE32'), true, 'the same id, dashed and in capitals');
  assert.equal(isProtected(config, '0123456789abcdef0123456789abcdef'), false, 'an id that is on no list');
  assert.equal(isProtected(config, 'b65273e2-14eb-8362-86a6-870ea8d632f4'), true, 'taxonomy data source');
  assert.equal(isProtected(config, '7219756338b2416f8fa8af83d75ec47d'), true, 'real claims database');
  assert.equal(isProtected(config, 'D1307596-E531-420F-8688-2485F3EF28AB'), true, 'real claims data source');
  assert.equal(isProtected(config, '3da273e214eb80c180d5fd0894bc2db8'), true, 'a protected page');
  assert.equal(isProtected(config, '3DA273E2-14EB-80C1-80D5-FD0894BC2DB8'), true, 'a protected page, dashed');
  assert.equal(isProtected(config, '3fa273e214eb805199f3d12ef01db453'), false, 'the parent page is where the agent builds, so it is not protected');
  assert.equal(isProtected(config, ' 3da273e214eb80c180d5fd0894bc2db8 '), true, 'surrounding spaces do not matter');
});

test('isProtected is false for anything that is not an id string, and for a config without lists', () => {
  const config = shipped();
  for (const v of [undefined, null, 7, {}, [], '', '   ', '-']) assert.equal(isProtected(config, v), false, String(v));
  assert.equal(isProtected({}, 'f05273e214eb8353b0a981544507de32'), false);
  assert.equal(isProtected(undefined, 'f05273e214eb8353b0a981544507de32'), false);
});

// ---- writableProperties ---------------------------------------------------------------------------------------------------------

test('writableProperties: the sets of CONTRACTS section 8', () => {
  const config = shipped();
  assert.deepEqual([...writableProperties(config, 'tag_decisions')].sort(),
    ['Agent confidence', 'Agent proposal', 'Agent reading', 'Agent reason', 'Claim', 'Claim link', 'Decided under', 'Follow-up', 'Key', 'Read under', 'Reading note', 'Rule', 'Rulebook edition', 'Tag', 'Tag outcome', 'Why wrong', 'Your reasoning'].sort(),
    'the ledger: the proposal, the copies of a decision, and the four columns of the agent\'s reading');
  assert.deepEqual([...writableProperties(config, 'rule_changes')].sort(),
    ['Current text', 'Kind', 'Lesson', 'Proposed text', 'Rule', 'Safety check result', 'Status', 'Supporting rows', 'Tag'].sort());
  assert.deepEqual([...writableProperties(config, 'agent_settings')].sort(), ['Last run summary', 'Rulebook edition']);
  assert.deepEqual([...writableProperties(config, 'rulebook')], ['When to use']);
  assert.deepEqual([...writableProperties(config, 'claims_copy')].sort(),
    ['Agent confidence', 'Agent edition', 'Agent reading', 'Agent reasons', 'Agent remarks', 'Agent status', 'Agent tags', 'Tags waiting'], 'the agent writes eight columns; Agent notes is not one of them');
});

test('writableProperties: a setup create may fill more', () => {
  const config = shipped();
  assert.deepEqual([...writableProperties(config, 'agent_settings', { setup: true })].sort(), ['Last run summary', 'Name', 'Rulebook edition']);
  const rulebook = writableProperties(config, 'rulebook', { setup: true });
  assert.deepEqual([...rulebook].sort(), [...RULEBOOK_COLUMNS].sort());
  assert.equal(rulebook.size, 13);
  const claims = writableProperties(config, 'claims_copy', { setup: true });
  assert.deepEqual([...claims].sort(), [...CLAIMS_COPY_COLUMNS, 'Agent confidence', 'Agent edition', 'Agent reading', 'Agent reasons', 'Agent remarks', 'Agent status', 'Agent tags', 'Tags waiting'].sort());
  assert.equal(claims.size, 21, 'the three editor columns of the claims are not among them');
  assert.deepEqual([...writableProperties(config, 'tag_decisions', { setup: true })].sort(), [...writableProperties(config, 'tag_decisions')].sort(), 'tag decisions have no setup extras');
  assert.deepEqual([...writableProperties(config, 'rule_changes', { setup: true })].sort(), [...writableProperties(config, 'rule_changes')].sort());
});

test('writableProperties follows the configured column names and key columns', () => {
  const config = shipped();
  config.notion.claims[0].write_columns = {
    tags: 'Tags by agent', confidence: 'How sure', reasons: 'Why so', status: 'State', waiting: 'Open tags', edition: 'Edition used', remarks: 'Remarks', reading: 'What I read',
  };
  config.notion.claims[0].key = 'Claim ID';
  config.notion.claims[0].columns.claim = 'Claim text';
  config.notion.databases.agent_settings.key = 'Setting';
  assert.deepEqual([...writableProperties(config, 'claims_copy')].sort(), ['Edition used', 'How sure', 'Open tags', 'Remarks', 'State', 'Tags by agent', 'What I read', 'Why so']);
  const setup = writableProperties(config, 'claims_copy', { setup: true });
  assert.ok(setup.has('Claim ID') && setup.has('Claim text') && setup.has('Geo Name'));
  assert.ok(writableProperties(config, 'agent_settings', { setup: true }).has('Setting'));
});

test('writableProperties gives a new Set every time and refuses an unknown table', () => {
  const config = shipped();
  const a = writableProperties(config, 'tag_decisions');
  a.add('Tag outcome copy');
  assert.ok(!writableProperties(config, 'tag_decisions').has('Tag outcome copy'), 'changing one result never changes the next');
  assert.throws(() => writableProperties(config, 'runs'), /unknown table "runs"/);
  assert.throws(() => writableProperties(config, undefined), /unknown table/);
});

// ---- editorColumns, capabilityOf, groupOf -----------------------------------------------------------------------------------------

test('editorColumns lists what only an editor writes', () => {
  const config = shipped();
  assert.deepEqual(editorColumns(config, 'claims_copy'), ['Verified tags', 'Review status', 'Challenged tags notes'], 'three: Why wrong left the editor\'s work (decision P4)');
  assert.deepEqual(editorColumns(config, 'rule_changes'), ['Editor wording']);
  assert.deepEqual(editorColumns(config, 'agent_settings'), ['Paused']);
  assert.deepEqual(editorColumns(config, 'rulebook'), []);
  assert.deepEqual(editorColumns(config, 'tag_decisions'), [], 'the ledger has none: its copies of a decision belong to the agent');
  editorColumns(config, 'rule_changes').push('Status');
  assert.deepEqual(editorColumns(config, 'rule_changes'), ['Editor wording'], 'a copy, not the config array');
  assert.throws(() => editorColumns(config, 'runs'), /unknown table "runs"/);
});

test('capabilityOf: named tags, the default, and names that are not tags', () => {
  const config = shipped();
  assert.equal(capabilityOf(config, 'Context-dependent'), 'text');
  assert.equal(capabilityOf(config, 'Wordy'), 'text');
  assert.equal(capabilityOf(config, 'Unsourced'), 'deterministic');
  assert.equal(capabilityOf(config, 'Improperly sourced'), 'source');
  assert.equal(capabilityOf(config, 'Source inaccessible'), 'source');
  assert.equal(capabilityOf(config, 'Factually challenged'), 'source');
  assert.equal(capabilityOf(config, 'Exact duplicate'), 'corpus');
  assert.equal(capabilityOf(config, 'Semantically duplicated'), 'corpus');
  assert.equal(capabilityOf(config, 'default'), 'text', 'the word default is the default, not a tag');
  assert.equal(capabilityOf(config, 'constructor'), 'text', 'inherited object keys are not tags');
  assert.equal(capabilityOf(config, 'toString'), 'text');
  for (const tag of ['Context-dependent', 'Unsourced', 'Exact duplicate']) assert.ok(CAPABILITIES.includes(capabilityOf(config, tag)));
});

test('groupOf finds the judge group of a tag', () => {
  const config = shipped();
  assert.equal(groupOf(config, 'Context-dependent'), 'G1');
  assert.equal(groupOf(config, 'Wordy'), null);
  assert.equal(groupOf(config, 'Unsourced'), null);
  config.judge.groups.G2 = ['Wordy', 'Poor wording'];
  assert.equal(groupOf(config, 'Poor wording'), 'G2');
  assert.equal(groupOf({}, 'Wordy'), null);
});

// ---- the claims table's own columns (CLAIMS-REVIEW.md, section 1) -----------------------------------------------------------------

test('the claims entry names the three editor columns and the eight agent columns, and a config that lacks one is refused with its name', () => {
  const config = shipped();
  const claims = config.notion.claims[0];
  assert.deepEqual(claims.write_columns, {
    tags: 'Agent tags', confidence: 'Agent confidence', reasons: 'Agent reasons', status: 'Agent status', waiting: 'Tags waiting', edition: 'Agent edition', remarks: 'Agent remarks', reading: 'Agent reading',
  });
  assert.deepEqual([claims.columns.verified, claims.columns.review_status, claims.columns.notes], ['Verified tags', 'Review status', 'Challenged tags notes']);
  assert.equal(claims.columns.why_wrong, undefined, 'the claims table has no Why wrong column in the config any more');
  assert.deepEqual(config.editor_columns.claims_copy, ['Verified tags', 'Review status', 'Challenged tags notes']);
  assert.equal(config.editor_columns.tag_decisions, undefined, 'the ledger has no editor column');

  for (const key of ['verified', 'review_status', 'notes']) {
    const bad = shipped();
    delete bad.notion.claims[0].columns[key];
    assert.ok(mentions(bad, `notion.claims[0].columns.${key}: expected a non-empty string`), key);
  }
  for (const key of ['tags', 'confidence', 'reasons', 'status', 'waiting', 'edition', 'remarks', 'reading']) {
    const bad = shipped();
    delete bad.notion.claims[0].write_columns[key];
    assert.ok(mentions(bad, `notion.claims[0].write_columns.${key}: expected a non-empty string`), key);
  }
  const retired = shipped();
  retired.notion.claims[0].write_columns.notes = 'Agent notes';
  assert.ok(mentions(retired, 'notion.claims[0].write_columns.notes: Agent notes is retired'), 'Agent notes is no longer a column the agent writes, so a config that names it is refused');
  const twice = shipped();
  twice.notion.claims[0].write_columns.remarks = 'Agent edition';
  assert.ok(mentions(twice, 'notion.claims[0].write_columns: two keys name the same column'));
  const noList = shipped();
  delete noList.editor_columns.claims_copy;
  assert.ok(mentions(noList, 'editor_columns.claims_copy: expected an array'));
});

test('an editor column of the claims must be listed in editor_columns, and an agent column must not be', () => {
  const unlisted = shipped();
  unlisted.editor_columns.claims_copy = unlisted.editor_columns.claims_copy.filter((c) => c !== 'Review status');
  assert.ok(mentions(unlisted, 'notion.claims[0].columns.review_status: "Review status" is not listed in editor_columns.claims_copy'));
  const writable = shipped();
  writable.editor_columns.claims_copy.push('Agent confidence');
  assert.ok(mentions(writable, 'notion.claims[0].write_columns.confidence: "Agent confidence" is an editor column'));
  const old = shipped();
  old.editor_columns.tag_decisions = ['Tag outcome'];
  assert.deepEqual(problems(old), [], 'an older config that still lists the ledger columns is only checked for its shape');
  old.editor_columns.tag_decisions = 'Tag outcome';
  assert.ok(mentions(old, 'editor_columns.tag_decisions: expected an array'));
});

test('the claims\' editor columns are never writable, with setup or without; the ledger\'s copies of a decision are', () => {
  const config = shipped();
  for (const setup of [false, true]) {
    const claims = writableProperties(config, 'claims_copy', { setup });
    for (const column of ['Verified tags', 'Claim quality tags — verified', 'Agent notes', 'Review status', 'Why wrong', 'Challenged tags notes']) assert.ok(!claims.has(column), `${column} (setup ${setup})`);
    assert.ok(claims.has('Agent reading'), `the agent's own reading column (setup ${setup})`);
    const ledger = writableProperties(config, 'tag_decisions', { setup });
    for (const column of ['Tag outcome', 'Why wrong', 'Your reasoning', 'Decided under', 'Agent reading', 'Rule', 'Reading note', 'Read under']) assert.ok(ledger.has(column), `${column} (setup ${setup})`);
  }
});
