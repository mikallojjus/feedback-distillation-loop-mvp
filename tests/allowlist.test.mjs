import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  DATABASES, EDITOR_NAMES, EDITOR_OWNED, FOLLOW_UP_FIELDS, NEVER, OPTIONAL_PROPERTIES, PROPERTY_TYPES, SEED_CREATE_ONLY, SEED_ONLY, STATUS_VALUES, WRITABLE,
  allowlistSha, assertOpWritable, assertWritable, controlPaths, editorValue, isProtectedDatabase,
} from '../agents/claim-tagger/scripts/allowlist.mjs';
import { WRITABLE_TYPES } from '../agents/claim-tagger/scripts/lib/notion-values.mjs';
import { schemaProblems } from '../agents/claim-tagger/scripts/pull.mjs';
import { fixtureSchemas, realConfig } from './fixtures/notion/fake-notion.mjs';

const schemas = fixtureSchemas();
const config = realConfig();

const refused = (db, prop, value, opts, reason) => {
  assert.throws(
    () => assertWritable(db, prop, value, { schema: schemas[db], ...opts }),
    (e) => e.code === 'ALLOWLIST' && (reason === undefined || e.reason === reason),
    `${db}.${prop} = ${JSON.stringify(value)} should be refused${reason ? ` (${reason})` : ''}`,
  );
};
const allowed = (db, prop, value, opts) => assert.doesNotThrow(() => assertWritable(db, prop, value, { schema: schemas[db], ...opts }), `${db}.${prop} = ${JSON.stringify(value)} should be allowed`);

// ---- the tables agree with each other and with the schema fixtures ----

test('the static tables are consistent: no property is both writable and never, every name exists, every writable type is writable', () => {
  for (const db of DATABASES) {
    for (const prop of WRITABLE[db]) {
      assert.equal(NEVER[db].includes(prop), false, `${db}.${prop} is both WRITABLE and NEVER`);
      assert.ok(PROPERTY_TYPES[db][prop], `${db}.${prop} has no type in PROPERTY_TYPES`);
      assert.ok(WRITABLE_TYPES.includes(PROPERTY_TYPES[db][prop]), `${db}.${prop} is ${PROPERTY_TYPES[db][prop]}, not a writable type`);
    }
    for (const prop of [...SEED_ONLY[db], ...SEED_CREATE_ONLY[db]]) {
      assert.ok(PROPERTY_TYPES[db][prop], `${db}.${prop} (seed) has no type`);
      assert.equal(WRITABLE[db].includes(prop), false, `${db}.${prop} is both always writable and seed-only`);
    }
    for (const prop of NEVER[db]) assert.ok(PROPERTY_TYPES[db][prop], `${db}.${prop} (never) has no type`);
    for (const prop of EDITOR_OWNED[db]) assert.ok(PROPERTY_TYPES[db][prop], `${db}.${prop} (editor) has no type`);
    // every formula, rollup, unique id, created time and synced relation is on the never list
    for (const [prop, type] of Object.entries(PROPERTY_TYPES[db])) {
      if (['formula', 'rollup', 'unique_id', 'created_time'].includes(type)) assert.ok(NEVER[db].includes(prop), `${db}.${prop} (${type}) must be NEVER`);
    }
  }
  for (const name of ['Tag outcome', 'Why wrong', 'Your reasoning', 'Decided by', 'Decided at', 'Editor wording', 'Approved by', 'Paused', 'Paused by', 'Reason', 'Weekly cap', 'Owner']) {
    assert.ok(EDITOR_NAMES.has(name), name);
  }
  assert.equal(EDITOR_NAMES.has('Status'), false, 'Status is value-restricted, not a plain editor name');
  for (const syncedSide of [['claims', 'Tag decisions'], ['rule_changes', 'Supporting rows'], ['rule_changes', 'Result card']]) {
    assert.ok(NEVER[syncedSide[0]].includes(syncedSide[1]), `${syncedSide.join('.')} is a synced relation side`);
  }
});

test('the static property table matches the hand-written schema fixtures (names and types)', () => {
  for (const db of DATABASES) {
    for (const [prop, type] of Object.entries(PROPERTY_TYPES[db])) assert.equal(schemas[db].properties[prop]?.type, type, `${db}.${prop}`);
    for (const [prop, def] of Object.entries(schemas[db].properties)) assert.equal(PROPERTY_TYPES[db][prop], def.type, `${db}.${prop} is in the fixture but not in PROPERTY_TYPES`);
  }
});

// ---- editor-owned fields ----

test('every editor-owned field is refused in every database, with and without the seed and promote flags', () => {
  for (const db of DATABASES) {
    for (const name of EDITOR_NAMES) {
      for (const ctx of [{}, { seed: true }, { seed: true, op: 'create' }, { promote: true, gate: 'PASS' }, { op: 'update', key: 'k' }]) {
        if (name === 'Weekly cap' && db === 'agent_settings' && ctx.seed && ctx.op === 'create') continue; // the one exception, tested below
        assert.throws(
          () => assertWritable(db, name, db === 'agent_settings' && name === 'Paused' ? true : 'x', { schema: schemas[db], ctx }),
          (e) => e.code === 'ALLOWLIST' && e.reason === 'editor-owned' && e.db === db && e.property === name,
          `${db}.${name} with ${JSON.stringify(ctx)}`,
        );
      }
    }
  }
});

test('the editor-owned list in each database is exactly the plan list', () => {
  assert.deepEqual([...EDITOR_NAMES].sort(), ['Approved by', 'Decided at', 'Decided by', 'Editor wording', 'Owner', 'Paused', 'Paused by', 'Reason', 'Tag outcome', 'Weekly cap', 'Why wrong', 'Your reasoning']);
  assert.deepEqual(EDITOR_OWNED.tag_decisions, ['Tag outcome', 'Why wrong', 'Your reasoning', 'Decided by', 'Decided at']);
  assert.deepEqual(EDITOR_OWNED.agent_settings, ['Paused', 'Paused by', 'Reason', 'Weekly cap', 'Owner']);
  assert.deepEqual(EDITOR_OWNED.rule_changes, ['Editor wording', 'Approved by', 'Status']);
});

test('Weekly cap and Name are writable only by the seed, only when it creates the Agent settings row', () => {
  refused('agent_settings', 'Weekly cap', 40, { ctx: {} }, 'editor-owned');
  refused('agent_settings', 'Weekly cap', 40, { ctx: { seed: true, op: 'update' } }, 'editor-owned');
  refused('agent_settings', 'Weekly cap', 40, { ctx: { seed: true } }, 'editor-owned');
  allowed('agent_settings', 'Weekly cap', 40, { ctx: { seed: true, op: 'create' } });
  refused('agent_settings', 'Name', 'claim-tagger', { ctx: {} }, 'seed-only');
  refused('agent_settings', 'Name', 'claim-tagger', { ctx: { seed: true, op: 'update' } }, 'seed-only');
  allowed('agent_settings', 'Name', 'claim-tagger', { ctx: { seed: true, op: 'create' } });
  for (const name of ['Paused', 'Paused by', 'Reason', 'Owner']) refused('agent_settings', name, name === 'Paused' ? false : 'x', { ctx: { seed: true, op: 'create' } }, 'editor-owned');
  for (const name of ['Rubric in force', 'Last run at', 'Last run summary']) allowed('agent_settings', name, name === 'Last run at' ? '2026-10-13' : 'x', {});
});

test('computed properties (formulas, rollups, unique id, created time, synced relation sides) are never written', () => {
  for (const [db, prop] of [
    ['tag_decisions', 'Effective outcome'], ['tag_decisions', 'Direction'], ['tag_decisions', 'Stage'], ['tag_decisions', 'Applied tag'], ['tag_decisions', 'Rejected tag'],
    ['tag_decisions', 'Tag name'], ['tag_decisions', 'Lesson status'], ['claims', 'Tag decisions'], ['claims', 'Decided applies'], ['claims', 'Decided does not apply'],
    ['rule_changes', 'Supporting rows'], ['rule_changes', 'Result card'], ['rule_changes', 'Lesson ID'], ['rule_changes', 'Created'],
  ]) {
    refused(db, prop, 'x', { ctx: { seed: true, op: 'create' } }, 'computed');
  }
  refused('rule_changes', 'Editor wording', 'x', { ctx: {} }, 'editor-owned');
  refused('rule_changes', 'Approved by', ['u1'], { ctx: {} }, 'editor-owned');
});

// ---- the writable lists ----

test('each database accepts exactly its writable properties (with valid values)', () => {
  const sample = (db, prop) => {
    const type = PROPERTY_TYPES[db][prop];
    if (type === 'select') return schemas[db].properties[prop].select.options[0].name;
    if (type === 'number') return 1;
    if (type === 'date') return '2026-10-13';
    if (type === 'relation') return ['a0000000-0000-4000-8000-000000000001'];
    if (type === 'checkbox') return true;
    return 'text';
  };
  const ctxFor = (db, prop) => (db === 'rule_changes' && prop === 'Status' ? { op: 'create' } : db === 'rulebook' && prop === 'When to use' ? { promote: true, gate: 'PASS' } : {});
  for (const db of DATABASES) {
    for (const prop of WRITABLE[db]) {
      const value = db === 'rule_changes' && prop === 'Status' ? 'Live' : sample(db, prop);
      allowed(db, prop, value, { ctx: ctxFor(db, prop) });
    }
  }
  refused('claims', 'Table', 'U.S. Politics', {}, 'seed-only');
  refused('rulebook', 'Description', 'x', {}, 'seed-only');
});

test('a property that is not in the schema, not in the lists, or in an unknown database is refused', () => {
  refused('claims', 'Nope', 'x', {}, 'unknown-property');
  assert.throws(() => assertWritable('claims', 'Readiness', 'Ready', { schema: { properties: {} } }), (e) => e.reason === 'unknown-property');
  assert.throws(() => assertWritable('nope', 'Readiness', 'Ready', { schema: schemas.claims }), (e) => e.code === 'ALLOWLIST' && e.reason === 'unknown-database');
  assert.throws(() => assertWritable('claims', '', 'x', { schema: schemas.claims }), (e) => e.code === 'ALLOWLIST');
  // a property that exists and has a type but is on no list
  const custom = { properties: { Extra: { type: 'rich_text', rich_text: {} } } };
  assert.throws(() => assertWritable('claims', 'Extra', 'x', { schema: custom }), (e) => e.reason === 'not-writable');
});

// ---- seed-only fields ----

test('seed-only fields are refused without ctx.seed and accepted with it', () => {
  const values = { rulebook: { 'Tag title': 'Debate', Status: 'Verified', Category: 'Usage', Polarity: 'Classification', Counterpart: 'Simple', Description: 'd', 'Example claims': 'a\nb', 'Human only': false, Judged: true }, claims: { 'Claim title': 'c', 'Geo ID': 'g', 'Geo link': 'https://x.test', 'Sources count': 2, 'Source URLs': 'u', Table: 'U.S. Politics', Sample: 'Decided' }, tag_decisions: { 'Seeded outcome': 'Applies', 'Seeded reasoning': 'r', 'Seeded at': '2026-10-09' } };
  for (const [db, props] of Object.entries(values)) {
    for (const [prop, value] of Object.entries(props)) {
      refused(db, prop, value, { ctx: {} }, 'seed-only');
      refused(db, prop, value, { ctx: { promote: true, gate: 'PASS' } }, 'seed-only');
      allowed(db, prop, value, { ctx: { seed: true, op: 'create' } });
      allowed(db, prop, value, { ctx: { seed: true, op: 'update' } });
    }
  }
  assert.deepEqual(Object.keys(values.rulebook).sort(), [...SEED_ONLY.rulebook].sort());
  assert.deepEqual(Object.keys(values.claims).sort(), [...SEED_ONLY.claims].sort());
  assert.deepEqual(Object.keys(values.tag_decisions).sort(), [...SEED_ONLY.tag_decisions].sort());
});

// ---- select options ----

test('a select value must be an option that already exists (writing a new one would silently create it)', () => {
  refused('tag_decisions', 'Agent proposal', 'Maybe tag', {}, 'unknown-option');
  refused('claims', 'Readiness', 'ready', {}, 'unknown-option');
  refused('claims', 'Readiness', 5, {}, 'unknown-option');
  refused('runs', 'Verdict', 'Pass', {}, 'unknown-option');
  allowed('claims', 'Readiness', 'Ready', {});
  allowed('claims', 'Readiness', null, {}); // clearing is not creating
  allowed('runs', 'Verdict', 'n/a', {});
});

test('an unparseable schema refuses every select, and only selects', () => {
  for (const schema of [null, undefined, {}, { properties: null }, { properties: [] }, 'garbage']) {
    assert.throws(() => assertWritable('claims', 'Readiness', 'Ready', { schema }), (e) => e.code === 'ALLOWLIST' && e.reason === 'unparseable-schema', JSON.stringify(schema));
    assert.throws(() => assertWritable('claims', 'Readiness', null, { schema }), (e) => e.reason === 'unparseable-schema');
    assert.doesNotThrow(() => assertWritable('claims', 'Tag confidence', 'fine', { schema }), 'a text property needs no options');
  }
  const noOptions = { properties: { Readiness: { type: 'select', select: {} } } };
  assert.throws(() => assertWritable('claims', 'Readiness', 'Ready', { schema: noOptions }), (e) => e.reason === 'unparseable-schema');
});

// ---- Rule changes Status ----

test('Rule changes Status: Live and Rolled back only; Proposed only on create; Approved and Rejected never', () => {
  for (const ctx of [{}, { op: 'update' }, { op: 'create' }, { seed: true, op: 'create' }, { promote: true, gate: 'PASS', op: 'update' }]) {
    allowed('rule_changes', 'Status', 'Live', { ctx });
    allowed('rule_changes', 'Status', 'Rolled back', { ctx });
    refused('rule_changes', 'Status', 'Approved', { ctx }, 'status-value');
    refused('rule_changes', 'Status', 'Rejected', { ctx }, 'status-value');
    refused('rule_changes', 'Status', null, { ctx }, 'status-value');
    refused('rule_changes', 'Status', 'Nonsense', { ctx }, 'status-value');
  }
  allowed('rule_changes', 'Status', 'Proposed', { ctx: { op: 'create' } });
  refused('rule_changes', 'Status', 'Proposed', { ctx: { op: 'update' } }, 'status-value');
  refused('rule_changes', 'Status', 'Proposed', { ctx: {} }, 'status-value');
  assert.deepEqual(STATUS_VALUES.editor, ['Approved', 'Rejected']);
});

test('editorValue: Status only counts as Approved or Rejected; everything else passes through', () => {
  assert.equal(editorValue('rule_changes', 'Status', 'Approved'), 'Approved');
  assert.equal(editorValue('rule_changes', 'Status', 'Rejected'), 'Rejected');
  assert.equal(editorValue('rule_changes', 'Status', 'Live'), null);
  assert.equal(editorValue('rule_changes', 'Status', 'Proposed'), null);
  assert.equal(editorValue('tag_decisions', 'Tag outcome', 'Applies'), 'Applies');
  assert.equal(editorValue('tag_decisions', 'Tag outcome', undefined), null);
});

// ---- decided rows ----

test('on a decided Tag decisions row only the follow-up fields may be written', () => {
  const ctx = { op: 'update', key: 'g1::Predictive', decidedKeys: new Set(['g1::Predictive']) };
  allowed('tag_decisions', 'Lesson', ['a0000000-0000-4000-8000-000000000001'], { ctx });
  allowed('tag_decisions', 'In regression suite', '2026-10-14', { ctx });
  allowed('tag_decisions', 'Agent follow-up', 'Fixed', { ctx });
  allowed('tag_decisions', 'Follow-up run', 'Follow-up R2', { ctx });
  assert.deepEqual([...FOLLOW_UP_FIELDS].sort(), ['Agent follow-up', 'Follow-up run', 'In regression suite', 'Lesson']);
  for (const prop of WRITABLE.tag_decisions.filter((p) => !FOLLOW_UP_FIELDS.includes(p))) {
    const value = PROPERTY_TYPES.tag_decisions[prop] === 'select' ? schemas.tag_decisions.properties[prop].select.options[0].name : PROPERTY_TYPES.tag_decisions[prop] === 'number' ? 0.5 : PROPERTY_TYPES.tag_decisions[prop] === 'relation' ? ['a'] : 'x';
    refused('tag_decisions', prop, value, { ctx }, 'decided-row');
  }
  for (const prop of SEED_ONLY.tag_decisions) refused('tag_decisions', prop, prop === 'Seeded outcome' ? 'Applies' : 'x', { ctx: { ...ctx, seed: true } }, 'decided-row');
  // an undecided row, a different key, or an array of keys behave as expected
  allowed('tag_decisions', 'Agent proposal', 'Keep tag', { ctx: { op: 'update', key: 'g2::Predictive', decidedKeys: new Set(['g1::Predictive']) } });
  refused('tag_decisions', 'Agent proposal', 'Keep tag', { ctx: { op: 'update', key: 'g1::Predictive', decidedKeys: ['g1::Predictive'] } }, 'decided-row');
  allowed('tag_decisions', 'Agent proposal', 'Keep tag', { ctx: { op: 'update', key: 'g1::Predictive' } });
});

// ---- Rulebook When to use ----

test('Rulebook When to use needs promote === true and gate === PASS (or the seed creating the row)', () => {
  const wtu = 'Use when ...\n1. Rule.';
  for (const ctx of [{}, { promote: true }, { gate: 'PASS' }, { promote: true, gate: 'HOLD' }, { promote: true, gate: 'FAIL' }, { promote: 'yes', gate: 'PASS' }, { promote: true, gate: 'pass' }, { seed: true, op: 'update' }, { seed: true }]) {
    refused('rulebook', 'When to use', wtu, { ctx }, 'promote-only');
  }
  allowed('rulebook', 'When to use', wtu, { ctx: { promote: true, gate: 'PASS' } });
  allowed('rulebook', 'When to use', wtu, { ctx: { promote: true, gate: 'PASS', op: 'update' } });
  allowed('rulebook', 'When to use', wtu, { ctx: { seed: true, op: 'create' } });
  allowed('rulebook', 'Rule version', '2026-10-14.1', {});
  allowed('rulebook', 'Tag hash', 'sha256:abc', {});
  allowed('rulebook', 'Changed by', ['d0000000-0000-4000-8000-000000000001'], {});
});

// ---- ops, protected databases, paths ----

test('assertOpWritable checks every property and passes the op kind and key into the context', () => {
  const op = { op: 'create', database: 'rule_changes', key: 'L', properties: { 'Lesson title': 'L', Status: 'Proposed', Kind: 'Change the rule' } };
  assert.doesNotThrow(() => assertOpWritable(op, { schema: schemas.rule_changes, ctx: {} }));
  assert.throws(() => assertOpWritable({ ...op, op: 'update' }, { schema: schemas.rule_changes, ctx: {} }), (e) => e.reason === 'status-value', 'Proposed on an update');
  assert.throws(() => assertOpWritable({ ...op, properties: { ...op.properties, 'Approved by': ['u1'] } }, { schema: schemas.rule_changes }), (e) => e.reason === 'editor-owned');
  const decided = { op: 'update', database: 'tag_decisions', key: 'k', properties: { 'Agent proposal': 'Keep tag' } };
  assert.throws(() => assertOpWritable(decided, { schema: schemas.tag_decisions, ctx: { decidedKeys: new Set(['k']) } }), (e) => e.reason === 'decided-row');
});

test('isProtectedDatabase: the real databases are protected in any id format; the six trial databases are not', () => {
  for (const id of config.notion.protected_database_ids) {
    assert.equal(isProtectedDatabase(config, id), true);
    assert.equal(isProtectedDatabase(config, id.replace(/-/g, '')), true);
    assert.equal(isProtectedDatabase(config, id.toUpperCase()), true);
  }
  for (const db of DATABASES) {
    assert.equal(isProtectedDatabase(config, config.notion.databases[db].database_id), false, db);
    assert.equal(isProtectedDatabase(config, config.notion.databases[db].data_source_id), false, db);
  }
  assert.equal(isProtectedDatabase(config, ''), false);
  assert.equal(isProtectedDatabase(config, null), false);
  assert.equal(isProtectedDatabase({}, 'd1307596-e531-420f-8688-2485f3ef28ab'), false, 'no list, nothing protected');
});

test('isProtectedDatabase: every real Geo database and data source id is on the list, in any dash form and any case (EN-12)', () => {
  const real = [
    '7219756338b2416f8fa8af83d75ec47d', '9e979fe1-e03d-45cd-b9b1-d971dc3d90a2', '9e111d22c14e4344bb90072606036942', // U.S. Politics debate claims, its data source (also Claims to review), Claims to review
    'd1307596-e531-420f-8688-2485f3ef28ab', 'f05273e214eb8353b0a981544507de32', 'b65273e2-14eb-8362-86a6-870ea8d632f4', // U.S. Politics data source; the taxonomy Claim Tags - verified (database, data source)
    '0e2273e214eb83b0a2b1013e7d0958fc', 'eec273e2-14eb-8349-a416-074a30396303', '67a1940f-db0d-477a-9737-0a9eb01a5eac', // World affairs debate claims (1) database and data source; World affairs debate claims data source
  ];
  const dashed = (id) => id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  for (const id of real) {
    const bare = id.replace(/-/g, '');
    for (const form of [id, bare, dashed(bare), bare.toUpperCase(), dashed(bare).toUpperCase()]) assert.equal(isProtectedDatabase(config, form), true, form);
  }
  // the list is compared after both sides are normalised: a list written in one form protects the other form
  const spelled = { notion: { protected_database_ids: ['D1307596-E531-420F-8688-2485F3EF28AB', '9E979FE1E03D45CDB9B1D971DC3D90A2'] } };
  assert.equal(isProtectedDatabase(spelled, 'd1307596e531420f86882485f3ef28ab'), true);
  assert.equal(isProtectedDatabase(spelled, '9e979fe1-e03d-45cd-b9b1-d971dc3d90a2'), true);
  assert.deepEqual(config.notion.protected_database_ids.map((id) => id.replace(/-/g, '').toLowerCase()).sort(), real.map((id) => id.replace(/-/g, '')).sort(), 'config.json lists exactly these nine');
  for (const db of DATABASES) {
    assert.equal(isProtectedDatabase(config, config.notion.databases[db].database_id), false, `${db} database`);
    assert.equal(isProtectedDatabase(config, config.notion.databases[db].data_source_id), false, `${db} data source`);
  }
  assert.equal(isProtectedDatabase(config, 'b65273e2-14eb-8362-86a6-870ea8d632f5'), false, 'one digit off is another database');
});

test('Lesson status is not optional: the Stage formula is built on it, so a pull of a schema without it fails (EN-13)', () => {
  assert.equal(OPTIONAL_PROPERTIES.tag_decisions.includes('Lesson status'), false);
  assert.deepEqual([...OPTIONAL_PROPERTIES.tag_decisions].sort(), ['Applied tag', 'Rejected tag'], 'the computed columns no script reads');
  const schema = structuredClone(schemas.tag_decisions);
  assert.deepEqual(schemaProblems('tag_decisions', schema), [], 'the fixture schema has it');
  delete schema.properties['Lesson status'];
  assert.deepEqual(schemaProblems('tag_decisions', schema), ['tag_decisions: property "Lesson status" is missing (renamed or deleted?)']);
  schema.properties['Lesson status'] = { ...schemas.tag_decisions.properties['Lesson status'], type: 'formula' };
  assert.deepEqual(schemaProblems('tag_decisions', schema), ['tag_decisions: property "Lesson status" is formula, the scripts expect rollup']);
  const optional = structuredClone(schemas.tag_decisions);
  delete optional.properties['Applied tag'];
  delete optional.properties['Rejected tag'];
  assert.deepEqual(schemaProblems('tag_decisions', optional), [], 'Applied tag and Rejected tag may still go');
});

test('allowlistSha is a stable h16 and controlPaths names the control files', () => {
  assert.match(allowlistSha(), /^sha256:[0-9a-f]{16}$/);
  assert.equal(allowlistSha(), allowlistSha());
  const p = controlPaths('/agent');
  assert.equal(p.paused, join('/agent', 'runs', 'PAUSED'));
  assert.equal(p.applying, join('/agent', 'runs', 'APPLYING.json'));
  assert.equal(p.setup, join('/agent', 'runs', 'SETUP'));
  assert.equal(p.pull, join('/agent', 'runs', 'pull'));
});

test('the tables are frozen so no caller can widen them', () => {
  assert.throws(() => { WRITABLE.claims.push('Readiness2'); }, TypeError);
  assert.throws(() => { NEVER.tag_decisions.pop(); }, TypeError);
  assert.throws(() => { WRITABLE.extra = []; }, TypeError);
});
