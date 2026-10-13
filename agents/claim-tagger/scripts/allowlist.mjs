// The write allowlist: which Notion properties a script may write, in which database, with which values.
// One place, imported by plan.mjs (build time and check time), apply.mjs (apply time) and hooks/guard.mjs.
//
//   WRITABLE[db]   properties a plan may write
//   SEED_ONLY[db]  properties a plan may write only with ctx.seed (the one-time seed)
//   NEVER[db]      editor-owned and computed properties: no script ever writes them (one seed exception: Weekly cap on create)
//
// assertWritable(db, prop, value, { schema, ctx }) throws an Error with .code = 'ALLOWLIST' and a .reason, or returns.
// ctx: { op: 'create' | 'update', key, seed, promote, gate, decidedKeys }.

import { join } from 'node:path';
import { h16 } from './lib/hash.mjs';
import { agentRoot } from './lib/paths.mjs';

export const DATABASES = Object.freeze(['rulebook', 'claims', 'tag_decisions', 'rule_changes', 'runs', 'agent_settings']);

/** Property name -> Notion type, from the DDL. pull.mjs checks the live schema against it; assertWritable falls back to it when the schema is unusable. */
export const PROPERTY_TYPES = deepFreeze({
  rulebook: {
    'Tag title': 'title', Status: 'select', Category: 'select', Polarity: 'select', Counterpart: 'rich_text', Description: 'rich_text',
    'Example claims': 'rich_text', 'When to use': 'rich_text', 'Human only': 'checkbox', Judged: 'checkbox', 'Rule version': 'rich_text',
    'Tag hash': 'rich_text', 'Changed by': 'relation',
  },
  claims: {
    'Claim title': 'title', 'Geo ID': 'rich_text', 'Geo link': 'url', 'Sources count': 'number', 'Source URLs': 'rich_text', Table: 'select',
    Sample: 'select', 'Agent tags': 'relation', Readiness: 'select', 'Tag confidence': 'rich_text', 'Last judged': 'rich_text',
    'Tag decisions': 'relation', 'Decided applies': 'rollup', 'Decided does not apply': 'rollup',
  },
  tag_decisions: {
    Key: 'title', Claim: 'relation', Tag: 'relation', 'Agent proposal': 'select', 'Agent confidence': 'number', 'Why I recommend this': 'rich_text',
    'Agent full note': 'rich_text', 'Why in queue': 'select', Priority: 'select', 'Rubric version': 'rich_text', 'Tag outcome': 'select',
    'Why wrong': 'select', 'Your reasoning': 'rich_text', 'Decided by': 'people', 'Decided at': 'date', 'Seeded outcome': 'select',
    'Seeded reasoning': 'rich_text', 'Seeded at': 'date', Lesson: 'relation', 'In regression suite': 'date', 'Agent follow-up': 'select',
    'Follow-up run': 'rich_text', 'Effective outcome': 'formula', Direction: 'formula', Stage: 'formula', 'Applied tag': 'formula',
    'Rejected tag': 'formula', 'Tag name': 'rollup', 'Lesson status': 'rollup',
  },
  rule_changes: {
    'Lesson title': 'title', 'Lesson ID': 'unique_id', Tag: 'relation', Rule: 'rich_text', Kind: 'select', 'Current text': 'rich_text',
    'Proposed text': 'rich_text', 'Editor wording': 'rich_text', Status: 'select', 'Approved by': 'people', 'Rubric version': 'rich_text',
    'Gate result': 'rich_text', Created: 'created_time', 'Supporting rows': 'relation', 'Result card': 'relation',
  },
  runs: {
    'Run title': 'title', Kind: 'select', 'Rubric version': 'rich_text', Started: 'date', 'Claims judged': 'number', Canaries: 'rich_text',
    'Newly failing': 'number', 'Per-tag summary': 'rich_text', Verdict: 'select', Summary: 'rich_text', Lesson: 'relation',
    'Cost USD': 'number', Model: 'rich_text',
  },
  agent_settings: {
    Name: 'title', Paused: 'checkbox', 'Paused by': 'people', Reason: 'rich_text', 'Weekly cap': 'number', Owner: 'people',
    'Rubric in force': 'rich_text', 'Last run at': 'date', 'Last run summary': 'rich_text',
  },
});

/** Computed properties no script reads: pull.mjs does not fail when one of them is renamed or retyped. */
export const OPTIONAL_PROPERTIES = deepFreeze({
  rulebook: [],
  claims: ['Tag decisions', 'Decided applies', 'Decided does not apply'],
  tag_decisions: ['Applied tag', 'Rejected tag', 'Lesson status'],
  rule_changes: [],
  runs: [],
  agent_settings: [],
});

/** Editor-owned fields per database: what snapshot.json records and verify compares. rule_changes Status counts only as Approved or Rejected. */
export const EDITOR_OWNED = deepFreeze({
  rulebook: [],
  claims: [],
  tag_decisions: ['Tag outcome', 'Why wrong', 'Your reasoning', 'Decided by', 'Decided at'],
  rule_changes: ['Editor wording', 'Approved by', 'Status'],
  runs: [],
  agent_settings: ['Paused', 'Paused by', 'Reason', 'Weekly cap', 'Owner'],
});

/** The editor-owned property names in every database (rule_changes Status is value-restricted, so it is not a plain name). */
export const EDITOR_NAMES = Object.freeze(new Set([
  'Tag outcome', 'Why wrong', 'Your reasoning', 'Decided by', 'Decided at', 'Editor wording', 'Approved by', 'Paused', 'Paused by', 'Reason', 'Weekly cap', 'Owner',
]));

/** rule_changes Status values: the agent writes Live and Rolled back, Proposed only when it creates the row, editors write Approved and Rejected. */
export const STATUS_VALUES = deepFreeze({ agent: ['Live', 'Rolled back'], on_create: ['Proposed'], editor: ['Approved', 'Rejected'] });

/** The only fields that may change on a tag_decisions row an editor (or the seed) already decided. */
export const FOLLOW_UP_FIELDS = Object.freeze(['Lesson', 'In regression suite', 'Agent follow-up', 'Follow-up run']);

export const WRITABLE = deepFreeze({
  rulebook: ['When to use', 'Rule version', 'Tag hash', 'Changed by'],
  claims: ['Agent tags', 'Readiness', 'Tag confidence', 'Last judged'],
  tag_decisions: [
    'Key', 'Claim', 'Tag', 'Agent proposal', 'Agent confidence', 'Why I recommend this', 'Agent full note', 'Why in queue', 'Priority',
    'Rubric version', 'Lesson', 'In regression suite', 'Agent follow-up', 'Follow-up run',
  ],
  rule_changes: ['Lesson title', 'Tag', 'Rule', 'Kind', 'Current text', 'Proposed text', 'Rubric version', 'Gate result', 'Status'],
  runs: [
    'Run title', 'Kind', 'Verdict', 'Rubric version', 'Canaries', 'Per-tag summary', 'Summary', 'Model', 'Started', 'Claims judged',
    'Newly failing', 'Cost USD', 'Lesson',
  ],
  agent_settings: ['Rubric in force', 'Last run at', 'Last run summary'],
});

/** Writable only with ctx.seed (the one-time seed of the Rulebook, Claims, Tag decisions and Agent settings rows). */
export const SEED_ONLY = deepFreeze({
  rulebook: ['Tag title', 'Status', 'Category', 'Polarity', 'Counterpart', 'Description', 'Example claims', 'Human only', 'Judged'],
  claims: ['Claim title', 'Geo ID', 'Geo link', 'Sources count', 'Source URLs', 'Table', 'Sample'],
  tag_decisions: ['Seeded outcome', 'Seeded reasoning', 'Seeded at'],
  rule_changes: [],
  runs: [],
  agent_settings: [],
});

/** Writable only with ctx.seed on a create. Weekly cap is editor-owned; the seed sets its default once, when it creates the Agent settings row. */
export const SEED_CREATE_ONLY = deepFreeze({
  rulebook: [], claims: [], tag_decisions: [], rule_changes: [], runs: [], agent_settings: ['Name', 'Weekly cap'],
});

export const NEVER = deepFreeze({
  rulebook: [],
  claims: ['Tag decisions', 'Decided applies', 'Decided does not apply'],
  tag_decisions: [
    'Tag outcome', 'Why wrong', 'Your reasoning', 'Decided by', 'Decided at', 'Effective outcome', 'Direction', 'Stage', 'Applied tag',
    'Rejected tag', 'Tag name', 'Lesson status',
  ],
  rule_changes: ['Editor wording', 'Approved by', 'Lesson ID', 'Created', 'Supporting rows', 'Result card'],
  runs: [],
  agent_settings: ['Paused', 'Paused by', 'Reason', 'Weekly cap', 'Owner'],
});

const OPTION_TYPES = new Set(['select', 'status', 'multi_select']);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** A short fingerprint of the allowlist, recorded in every plan header. */
export function allowlistSha() {
  return h16(JSON.stringify({ WRITABLE, SEED_ONLY, SEED_CREATE_ONLY, NEVER, FOLLOW_UP_FIELDS, STATUS_VALUES }));
}

/** Where the control files live: runs/PAUSED, runs/APPLYING.json, runs/SETUP and the pull folders. */
export function controlPaths(root = agentRoot()) {
  const runs = join(root, 'runs');
  return { runs, paused: join(runs, 'PAUSED'), applying: join(runs, 'APPLYING.json'), setup: join(runs, 'SETUP'), pull: join(runs, 'pull') };
}

const norm = (id) => String(id ?? '').replace(/-/g, '').toLowerCase();

/** True when the id (any dash form, any case) is on the config's protected list: the real content databases. */
export function isProtectedDatabase(config, databaseId) {
  const id = norm(databaseId);
  return id !== '' && (config?.notion?.protected_database_ids ?? []).some((p) => norm(p) === id);
}

export class AllowlistError extends Error {
  constructor(message, reason, db, property) {
    super(message);
    this.name = 'AllowlistError';
    this.code = 'ALLOWLIST';
    this.reason = reason;
    this.db = db;
    this.property = property;
  }
}

const refuse = (db, prop, reason, why) => {
  throw new AllowlistError(`allowlist: ${db}.${prop} refused: ${why}`, reason, db, prop);
};

// What the schema (or, when it cannot be read, the static table) says about a property: { type, options } or undefined.
function describe(db, prop, schema) {
  const props = schema && typeof schema === 'object' ? schema.properties : null;
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    const def = props[prop];
    if (!def || typeof def !== 'object' || typeof def.type !== 'string') return undefined;
    const cfg = def[def.type];
    const options = Array.isArray(cfg?.options) ? cfg.options.map((o) => o?.name).filter((n) => typeof n === 'string') : null;
    return { type: def.type, options };
  }
  const type = PROPERTY_TYPES[db]?.[prop];
  return type ? { type, options: null } : undefined; // unparseable schema: every select is refused below
}

const has = (set, key) => (set instanceof Set ? set.has(key) : Array.isArray(set) && set.includes(key));

/** Throws an AllowlistError (code 'ALLOWLIST') unless the script may write `value` to property `prop` of database `db`. */
export function assertWritable(db, prop, value, { schema = null, ctx = {} } = {}) {
  if (!DATABASES.includes(db)) throw new AllowlistError(`allowlist: "${db}" is not one of the configured databases`, 'unknown-database', db, prop);
  if (typeof prop !== 'string' || prop === '') throw new AllowlistError(`allowlist: ${db}: a property name is required`, 'unknown-property', db, String(prop));
  const seedCreate = ctx.seed === true && ctx.op === 'create';

  // 1. editor-owned and computed properties are never written (one seed exception: the Weekly cap default on create)
  if (EDITOR_NAMES.has(prop) || NEVER[db].includes(prop)) {
    if (!(seedCreate && SEED_CREATE_ONLY[db].includes(prop))) {
      refuse(db, prop, EDITOR_NAMES.has(prop) ? 'editor-owned' : 'computed', EDITOR_NAMES.has(prop) ? 'an editor owns this field' : 'Notion computes this property');
    }
  }

  // 2. the property exists
  const info = describe(db, prop, schema);
  if (!info) refuse(db, prop, 'unknown-property', 'no such property in the database schema');

  // 3. it is on the writable list, or on a seed list with the seed flag
  if (!WRITABLE[db].includes(prop)) {
    if (SEED_ONLY[db].includes(prop)) {
      if (ctx.seed !== true) refuse(db, prop, 'seed-only', 'only the one-time seed may write this property');
    } else if (SEED_CREATE_ONLY[db].includes(prop)) {
      if (!seedCreate) refuse(db, prop, 'seed-only', 'only the one-time seed may write this property, and only when it creates the row');
    } else {
      refuse(db, prop, 'not-writable', 'the property is not on the allowlist');
    }
  }

  // 4. rows an editor (or the seed) already decided accept only the follow-up fields
  if (db === 'tag_decisions' && ctx.key !== undefined && has(ctx.decidedKeys, ctx.key) && !FOLLOW_UP_FIELDS.includes(prop)) {
    refuse(db, prop, 'decided-row', `the row "${ctx.key}" is decided; only ${FOLLOW_UP_FIELDS.join(', ')} may change`);
  }

  // 5. rules that depend on the value or the context
  if (db === 'rule_changes' && prop === 'Status') {
    const ok = STATUS_VALUES.agent.includes(value) || (ctx.op === 'create' && STATUS_VALUES.on_create.includes(value));
    if (!ok) refuse(db, prop, 'status-value', `the agent sets Live or Rolled back (and Proposed when it creates the row), never ${JSON.stringify(value)}`);
  }
  if (db === 'rulebook' && prop === 'When to use' && !(ctx.promote === true && ctx.gate === 'PASS') && !seedCreate) {
    refuse(db, prop, 'promote-only', 'the rule text changes only through promote with a gate PASS');
  }

  // 6. select-like values must be options that already exist (writing an unknown name would silently create it)
  if (OPTION_TYPES.has(info.type)) {
    if (!info.options) refuse(db, prop, 'unparseable-schema', 'the schema has no readable options, so no select can be written');
    const values = value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (typeof v !== 'string' || !info.options.includes(v)) refuse(db, prop, 'unknown-option', `${JSON.stringify(v)} is not an existing option (${info.options.join(', ')})`);
    }
  }
}

/** assertWritable for every property of one op. `op` is { op: 'create' | 'update', database, key, properties }. */
export function assertOpWritable(op, { schema = null, ctx = {} } = {}) {
  const full = { ...ctx, op: op.op, key: op.key };
  for (const [prop, value] of Object.entries(op.properties ?? {})) assertWritable(op.database, prop, value, { schema, ctx: full });
}

/** The value of an editor-owned field as snapshots and verify compare it (rule_changes Status only counts as Approved or Rejected). */
export function editorValue(db, prop, value) {
  if (db === 'rule_changes' && prop === 'Status') return STATUS_VALUES.editor.includes(value) ? value : null;
  return value === undefined ? null : value;
}
