// The agent's configuration: config.json read, checked and asked questions. Scripts get their Notion ids, their table keys, their
// protected ids and their judging settings from here (the guard hook reads config.json on its own: it must not fail because a library does).
//
//   loadConfig(root = agentRoot())              -> the parsed config.json of a state root; throws one Error listing every problem found
//   validateConfig(config)                      -> { ok, errors: string[] } (messages such as "notion.rulebook.key: expected a non-empty string")
//   isDemo(config)                              -> true for a demo profile (config.demo === true)
//   tableEntry(config, name)                    -> the entry of one table: rulebook, claims_copy (the first enabled entry of notion.claims),
//                                                  tag_decisions, rule_changes or agent_settings. It is the entry object itself, not a copy,
//                                                  so setup can write the ids it learns into it before it saves the file.
//   isProtected(config, id)                     -> true when the id is in protected_database_ids or protected_page_ids (dashes and case ignored)
//   writableProperties(config, table, { setup }) -> Set of the column names a plan may write to that table (CONTRACTS section 8); with
//                                                  setup: true also what a create made by the one-time setup may fill
//   editorColumns(config, table)                -> the columns only an editor writes (no script ever does); [] for rulebook and claims_copy
//   capabilityOf(config, tag)                   -> text, deterministic, source or corpus (config.tags, with its default)
//   groupOf(config, tag)                        -> the judge group the tag belongs to (config.judge.groups), or null
//   constants: AGENT_NAME, TABLES, CAPABILITIES, RULEBOOK_COLUMNS, CLAIMS_COPY_COLUMNS, TAG_DECISIONS_WRITABLE, RULE_CHANGES_WRITABLE,
//              RULE_CHANGES_AGENT_STATUS (the Status values a script may write; Approved and Rejected belong to the editor,
//              see config.editor_columns.rule_changes_status_editor_values)
//
// Ids in the setup-filled places may still be placeholders that start with "<" (for example "<setup>"); every other id must be a
// real Notion id. Two safety checks are made on top of the shape: every id under notion.sources must be in the protected lists, and
// none of the agent's own tables may be (a protected table is never written, so an agent table in that list could never work).

import { join } from 'node:path';
import { readJson } from './jsonl.mjs';
import { normId } from './notion-values.mjs';
import { agentRoot } from './paths.mjs';

export const AGENT_NAME = 'claim-tagger-mvp';
export const TABLES = Object.freeze(['rulebook', 'claims_copy', 'tag_decisions', 'rule_changes', 'agent_settings']);
export const CAPABILITIES = Object.freeze(['text', 'deterministic', 'source', 'corpus']);

/** The thirteen columns of the Rulebook copy (the taxonomy's, without its two relations). Setup creates a row with all of them. */
export const RULEBOOK_COLUMNS = Object.freeze([
  'Name', 'Category', 'Counterpart', 'Description', 'Evidence', 'Example Claims', 'Geo Status', 'Geo Tag ID', 'Polarity', 'Status', 'Verified on',
  'When to use', 'Work tags',
]);

/** The thirteen Geo columns of the real claims table that the Claims copy carries. Setup creates a row with all of them. */
export const CLAIMS_COPY_COLUMNS = Object.freeze([
  'Geo Name', 'Geo ID', 'Geo URL', 'Geo Sources', 'Geo Tags', 'Geo Topics', 'Geo Score', 'Geo Supporting arguments', 'Geo Opposing arguments',
  'Geo Related people', 'Geo Related projects', 'Geo Is factual', 'Geo Name source',
]);

export const TAG_DECISIONS_WRITABLE = Object.freeze([
  'Claim', 'Key', 'Tag', 'Agent proposal', 'Agent confidence', 'Agent reason', 'Claim link', 'Rulebook edition', 'Follow-up',
]);
export const RULE_CHANGES_WRITABLE = Object.freeze([
  'Lesson', 'Tag', 'Rule', 'Kind', 'Current text', 'Proposed text', 'Safety check result', 'Supporting rows', 'Status',
]);
export const RULE_CHANGES_AGENT_STATUS = Object.freeze(['Proposed', 'Live', 'Rolled back']);
const AGENT_SETTINGS_WRITABLE = Object.freeze(['Rulebook edition', 'Last run summary']);
const RULEBOOK_WRITABLE = Object.freeze(['When to use']);

// ---- reading ---------------------------------------------------------------------------------------------------------------

/** Read and check <root>/config.json. A missing file, a file that is not JSON and a config of the wrong shape each throw an Error that names the file. */
export function loadConfig(root = agentRoot()) {
  const file = join(root, 'config.json');
  let config;
  try {
    config = readJson(file);
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${file}: there is no config.json in this state folder`, { cause: e });
    throw e;
  }
  const { ok, errors } = validateConfig(config);
  if (!ok) throw new Error(`${file} is not a valid config:\n- ${errors.join('\n- ')}`);
  return config;
}

// ---- checking --------------------------------------------------------------------------------------------------------------

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const REAL_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const VERSION = /^\d{4}-\d{2}-\d{2}$/;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/** Check the shape of a parsed config.json (CONTRACTS section 2). Never throws: { ok, errors } with a dotted path in front of each message. */
export function validateConfig(config) {
  const errors = [];
  const bad = (path, why) => errors.push(`${path}: ${why}`);
  const obj = (path, v) => {
    if (isPlain(v)) return true;
    bad(path, 'expected an object');
    return false;
  };
  const text = (path, v) => {
    if (typeof v !== 'string' || v.trim() === '') bad(path, 'expected a non-empty string');
  };
  const bool = (path, v) => {
    if (typeof v !== 'boolean') bad(path, 'expected true or false');
  };
  const int = (path, v, min, max = Infinity) => {
    if (!Number.isInteger(v) || v < min || v > max) bad(path, `expected a whole number from ${min}${max === Infinity ? ' up' : ` to ${max}`}`);
  };
  const share = (path, v) => {
    if (typeof v !== 'number' || !(v >= 0 && v <= 1)) bad(path, 'expected a number from 0 to 1');
  };
  const list = (path, v, each, { min = 0 } = {}) => {
    if (!Array.isArray(v)) {
      bad(path, 'expected an array');
      return;
    }
    if (v.length < min) bad(path, `expected at least ${min} item${min === 1 ? '' : 's'}`);
    v.forEach((x, i) => each(`${path}[${i}]`, x));
  };
  const version = (path, v) => {
    if (typeof v !== 'string' || !VERSION.test(v)) bad(path, 'expected an API version such as 2022-06-28');
  };
  // setupFilled: the id may still be a placeholder such as "<setup>"
  const id = (path, v, setupFilled = false) => {
    if (typeof v === 'string' && REAL_ID.test(v)) return;
    if (setupFilled && typeof v === 'string' && v.startsWith('<')) return;
    bad(path, setupFilled ? 'expected a Notion id or a placeholder that starts with "<"' : 'expected a Notion id (32 hex digits, dashes optional)');
  };
  const relativePath = (path, v) => {
    text(path, v);
    if (typeof v === 'string' && (/^([A-Za-z]:|[\\/])/.test(v) || v.split(/[\\/]/).includes('..'))) bad(path, 'expected a path inside the agent folder');
  };
  const table = (path, t, { keyed = true } = {}) => {
    if (!obj(path, t)) return;
    id(`${path}.database_id`, t.database_id, true);
    id(`${path}.data_source_id`, t.data_source_id, true);
    if (keyed) text(`${path}.key`, t.key);
  };

  if (!obj('config', config)) return { ok: false, errors };
  if (config.agent !== AGENT_NAME) bad('agent', `expected "${AGENT_NAME}"`);

  // notion
  const n = config.notion;
  if (obj('notion', n)) {
    version('notion.api_version', n.api_version);
    version('notion.builder_api_version', n.builder_api_version);
    id('notion.parent_page_id', n.parent_page_id);
    if (obj('notion.pages', n.pages)) for (const k of ['proposal', 'demos', 'demo_tests']) id(`notion.pages.${k}`, n.pages[k], true);
    if (obj('notion.rulebook', n.rulebook)) {
      table('notion.rulebook', n.rulebook);
      text('notion.rulebook.work_tag', n.rulebook.work_tag);
    }
    list('notion.claims', n.claims, (path, c) => {
      if (!obj(path, c)) return;
      text(`${path}.name`, c.name);
      text(`${path}.label`, c.label);
      bool(`${path}.enabled`, c.enabled);
      table(path, c);
      if (obj(`${path}.columns`, c.columns)) for (const k of ['claim', 'link', 'sources', 'is_factual']) text(`${path}.columns.${k}`, c.columns[k]);
      if (obj(`${path}.write_columns`, c.write_columns)) for (const k of ['tags', 'notes']) text(`${path}.write_columns.${k}`, c.write_columns[k]);
    }, { min: 1 });
    if (Array.isArray(n.claims)) {
      if (!n.claims.some((c) => c?.enabled === true)) bad('notion.claims', 'no entry is enabled');
      const names = n.claims.map((c) => c?.name);
      if (new Set(names).size !== names.length) bad('notion.claims', 'two entries have the same name');
    }
    if (obj('notion.databases', n.databases)) for (const k of ['tag_decisions', 'rule_changes', 'agent_settings']) table(`notion.databases.${k}`, n.databases[k]);
    if (obj('notion.sources', n.sources)) {
      for (const k of ['taxonomy', 'real_claims']) {
        const s = n.sources[k];
        if (!obj(`notion.sources.${k}`, s)) continue;
        id(`notion.sources.${k}.database_id`, s.database_id);
        id(`notion.sources.${k}.data_source_id`, s.data_source_id);
        if (s.read_only !== true) bad(`notion.sources.${k}.read_only`, 'must be true: the sources are only ever read');
      }
    }
    list('notion.protected_database_ids', n.protected_database_ids, (path, v) => id(path, v), { min: 1 });
    list('notion.protected_page_ids', n.protected_page_ids, (path, v) => id(path, v));
    list('notion.setup_page_parents', n.setup_page_parents, (path, v) => id(path, v), { min: 1 });
    if (typeof n.requests_per_second !== 'number' || !(n.requests_per_second > 0)) bad('notion.requests_per_second', 'expected a number above 0');
    int('notion.page_size', n.page_size, 1, 100);
    int('notion.max_text', n.max_text, 1, 2000);

    // the sources are protected; the agent's own tables are not
    if (Array.isArray(n.protected_database_ids) && Array.isArray(n.protected_page_ids)) {
      const protectedIds = new Set([...n.protected_database_ids, ...n.protected_page_ids].map((p) => normId(p)));
      for (const [k, s] of Object.entries(isPlain(n.sources) ? n.sources : {})) {
        for (const f of ['database_id', 'data_source_id']) {
          if (isPlain(s) && typeof s[f] === 'string' && !protectedIds.has(normId(s[f]))) bad(`notion.sources.${k}.${f}`, 'must also be listed in protected_database_ids');
        }
      }
      const own = [['notion.rulebook', n.rulebook], ...(Array.isArray(n.claims) ? n.claims.map((c, i) => [`notion.claims[${i}]`, c]) : []),
        ...Object.entries(isPlain(n.databases) ? n.databases : {}).map(([k, v]) => [`notion.databases.${k}`, v])];
      for (const [path, t] of own) {
        for (const f of ['database_id', 'data_source_id']) {
          if (isPlain(t) && typeof t[f] === 'string' && protectedIds.has(normId(t[f]))) bad(`${path}.${f}`, 'is in the protected lists, so it could never be written');
        }
      }
    }
  }

  // editor_columns
  if (obj('editor_columns', config.editor_columns)) {
    for (const k of ['tag_decisions', 'rule_changes', 'rule_changes_status_editor_values', 'agent_settings']) {
      list(`editor_columns.${k}`, config.editor_columns[k], (path, v) => text(path, v));
    }
  }

  // models
  if (obj('models', config.models)) for (const k of ['judge', 'distill']) text(`models.${k}`, config.models[k]);

  // tags: capability per tag, with a default
  if (obj('tags', config.tags)) {
    if (!CAPABILITIES.includes(config.tags.default)) bad('tags.default', `expected one of ${CAPABILITIES.join(', ')}`);
    for (const [k, v] of Object.entries(config.tags)) if (!CAPABILITIES.includes(v)) bad(`tags.${k}`, `expected one of ${CAPABILITIES.join(', ')}`);
  }

  // judge
  const j = config.judge;
  if (obj('judge', j)) {
    int('judge.runs_max', j.runs_max, 1, 9);
    if (obj('judge.rerun', j.rerun)) {
      const band = j.rerun.band;
      if (!Array.isArray(band) || band.length !== 2 || band.some((b) => typeof b !== 'number' || !(b >= 0 && b <= 1)) || band[0] > band[1]) {
        bad('judge.rerun.band', 'expected [low, high] with 0 <= low <= high <= 1');
      }
      bool('judge.rerun.include_ask_editor', j.rerun.include_ask_editor);
      share('judge.rerun.max_share', j.rerun.max_share);
    }
    if (obj('judge.groups', j.groups)) {
      const seen = new Map();
      for (const [g, names] of Object.entries(j.groups)) {
        list(`judge.groups.${g}`, names, (path, v) => text(path, v), { min: 1 });
        for (const name of Array.isArray(names) ? names : []) {
          if (seen.has(name)) bad(`judge.groups.${g}`, `"${name}" is already in group ${seen.get(name)}`);
          seen.set(name, g);
          if (isPlain(config.tags) && CAPABILITIES.includes(config.tags.default)) {
            const cap = Object.hasOwn(config.tags, name) && name !== 'default' ? config.tags[name] : config.tags.default;
            if (cap !== 'text') bad(`judge.groups.${g}`, `"${name}" is a ${cap} tag, and only text tags are judged`);
          }
        }
      }
    }
    int('judge.batch_size', j.batch_size, 1);
    int('judge.concurrency', j.concurrency, 1);
    if (!EFFORTS.includes(j.effort)) bad('judge.effort', `expected one of ${EFFORTS.join(', ')}`);
    int('judge.max_turns', j.max_turns, 1);
    int('judge.timeout_ms', j.timeout_ms, 1000);
    text('judge.claude_bin', j.claude_bin);
    int('judge.attempts_per_batch', j.attempts_per_batch, 1);
    if (obj('judge.transient', j.transient)) {
      int('judge.transient.max_in_a_row', j.transient.max_in_a_row, 1);
      list('judge.transient.backoff_ms', j.transient.backoff_ms, (path, v) => int(path, v, 0), { min: 1 });
    }
    relativePath('judge.prompt', j.prompt);
  }

  // queue, distill, gate
  if (obj('queue', config.queue)) {
    int('queue.reason_max_words', config.queue.reason_max_words, 1);
    int('queue.sitting_rows', config.queue.sitting_rows, 1);
  }
  const d = config.distill;
  if (obj('distill', d)) {
    int('distill.min_claims', d.min_claims, 1);
    int('distill.max_lessons_per_run', d.max_lessons_per_run, 1);
    int('distill.overfit_ngram', d.overfit_ngram, 1);
    if (!EFFORTS.includes(d.effort)) bad('distill.effort', `expected one of ${EFFORTS.join(', ')}`);
    int('distill.timeout_ms', d.timeout_ms, 1000);
    relativePath('distill.prompt', d.prompt);
    relativePath('distill.wording_prompt', d.wording_prompt);
  }
  if (obj('gate', config.gate) && obj('gate.default', config.gate.default)) int('gate.default.flip_rejudge_runs', config.gate.default.flip_rejudge_runs, 0);

  // demo profile
  if (config.demo !== undefined) bool('demo', config.demo);
  if (config.demo === true && (typeof config.demo_id !== 'string' || !SAFE_NAME.test(config.demo_id) || /^\.+$/.test(config.demo_id))) {
    bad('demo_id', 'a demo profile needs a demo_id made of letters, digits, dot, dash and underscore');
  }

  return { ok: errors.length === 0, errors };
}

// ---- questions -------------------------------------------------------------------------------------------------------------

/** True for a demo profile: a config with "demo": true (its tables live on the practice page). */
export function isDemo(config) {
  return config?.demo === true;
}

/**
 * The entry of one table. rulebook is notion.rulebook, claims_copy the first enabled entry of notion.claims, and tag_decisions,
 * rule_changes and agent_settings are notion.databases.<name>. Each has database_id, data_source_id and key. It is the entry object itself.
 */
export function tableEntry(config, name) {
  const n = config?.notion ?? {};
  let entry;
  switch (name) {
    case 'rulebook':
      entry = n.rulebook;
      break;
    case 'claims_copy':
      entry = (n.claims ?? []).find((c) => c?.enabled === true);
      if (!entry) throw new Error('tableEntry: no entry of notion.claims is enabled');
      break;
    case 'tag_decisions':
    case 'rule_changes':
    case 'agent_settings':
      entry = n.databases?.[name];
      break;
    default:
      throw new Error(`tableEntry: unknown table "${name}" (expected one of ${TABLES.join(', ')})`);
  }
  if (!isPlain(entry)) throw new Error(`tableEntry: the config has no entry for the table "${name}"`);
  return entry;
}

/** True when the id (dashes and case do not matter) is one of the protected database or page ids. Anything that is not a string is not protected. */
export function isProtected(config, id) {
  if (typeof id !== 'string') return false;
  const wanted = normId(id.trim());
  if (wanted === '') return false;
  const n = config?.notion ?? {};
  return [...(n.protected_database_ids ?? []), ...(n.protected_page_ids ?? [])].some((p) => normId(p) === wanted);
}

/**
 * The column names a plan may write to a table (CONTRACTS section 8), as a new Set each time.
 *   tag_decisions    Claim, Key, Tag, Agent proposal, Agent confidence, Agent reason, Claim link, Rulebook edition, Follow-up
 *   rule_changes     Lesson, Tag, Rule, Kind, Current text, Proposed text, Safety check result, Supporting rows, Status
 *                    (the Status values are limited to RULE_CHANGES_AGENT_STATUS)
 *   agent_settings   Rulebook edition, Last run summary; with setup also the key column (Name)
 *   rulebook         When to use; with setup every column of the copy
 *   claims_copy      the two write columns (Agent tags, Agent notes); with setup also every copied column
 * Editor columns are never in these sets. A setup plan that seeds the audit, or a demo profile's setup, is the only way one is
 * written, and that exception is checked by the plan code, not here.
 */
export function writableProperties(config, table, { setup = false } = {}) {
  const set = new Set();
  const add = (...names) => names.forEach((x) => set.add(x));
  switch (table) {
    case 'tag_decisions':
      add(...TAG_DECISIONS_WRITABLE);
      break;
    case 'rule_changes':
      add(...RULE_CHANGES_WRITABLE);
      break;
    case 'agent_settings':
      add(...AGENT_SETTINGS_WRITABLE);
      if (setup) add(tableEntry(config, 'agent_settings').key);
      break;
    case 'rulebook':
      add(...RULEBOOK_WRITABLE);
      if (setup) add(...RULEBOOK_COLUMNS, tableEntry(config, 'rulebook').key);
      break;
    case 'claims_copy': {
      const entry = tableEntry(config, 'claims_copy');
      add(entry.write_columns.tags, entry.write_columns.notes);
      if (setup) add(entry.key, ...Object.values(entry.columns), ...CLAIMS_COPY_COLUMNS);
      break;
    }
    default:
      throw new Error(`writableProperties: unknown table "${table}" (expected one of ${TABLES.join(', ')})`);
  }
  return set;
}

/** The columns of a table that only an editor writes (config.editor_columns): [] for the tables that have none. */
export function editorColumns(config, table) {
  if (!TABLES.includes(table)) throw new Error(`editorColumns: unknown table "${table}" (expected one of ${TABLES.join(', ')})`);
  return [...(config?.editor_columns?.[table] ?? [])];
}

/** How a tag is decided: text, deterministic, source or corpus. A tag that config.tags does not name gets config.tags.default. */
export function capabilityOf(config, tag) {
  const tags = config?.tags ?? {};
  return Object.hasOwn(tags, tag) && tag !== 'default' ? tags[tag] : tags.default;
}

/** The judge group (config.judge.groups) that holds the tag, or null when none does. */
export function groupOf(config, tag) {
  for (const [group, names] of Object.entries(config?.judge?.groups ?? {})) if (names.includes(tag)) return group;
  return null;
}
