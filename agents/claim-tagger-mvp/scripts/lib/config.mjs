// The agent's configuration: config.json read, checked and asked questions. Scripts get their Notion ids, their table keys, their
// protected ids and their judging settings from here (the guard hook reads config.json on its own: it must not fail because a library does).
//
//   loadConfig(root = agentRoot())              -> the parsed config.json of a state root; throws one Error listing every problem found
//   validateConfig(config)                      -> { ok, errors: string[] } (messages such as "notion.rulebook.key: expected a non-empty string")
//   isDemo(config)                              -> true for a demo profile (config.demo === true); validateConfig refuses one (the practice pages are parked, P48)
//   isV2(config)                                -> true for the v2 profile (config.profile === 'v2'), the only shape this code accepts since P48: one Notion page with five tables, hung
//                                                  under notion.root_parent_page_id (never protected), no editor column on Claims, and the three editor columns of Tag decisions (TD_EDITOR).
//                                                  The per-claim version is the git tag claim-tagger-v1.
//   tableEntry(config, name)                  -> the entry of one table: rulebook, claims (notion.claims, one object: there is one claims table, P5),
//                                                  tag_decisions, rule_changes or agent_settings. It is the entry object itself, not a copy,
//                                                  so setup can write the ids it learns into it before it saves the file.
//   isProtected(config, id)                     -> true when the id is in protected_database_ids or protected_page_ids (dashes and case ignored)
//   writableProperties(config, table, { setup }) -> Set of the column names a plan may write to that table (CONTRACTS section 8); with
//                                                  setup: true also what a create made by the one-time setup may fill
//   addableProperties(config)                   -> Set of the columns a plan of the add script (ADD_SCRIPT) may write to a NEW claims row: the key and CLAIMS_GEO_COLUMNS (P35)
//   copyLiveProperties(config, table)           -> Set of the columns a plan of the copy-live script (COPY_LIVE_SCRIPT, v2 only) may write to a table, editor columns included (P47)
//   REMOVE_SCRIPT, TRASHABLE_TABLES             -> the one script whose plans may trash rows (remove.mjs, P51) and the two tables it may trash (claims, tag_decisions)
//   editorColumns(config, table)                -> the columns only an editor writes (no script ever does, bar the exceptions of hard rule 1):
//                                                  Agent is right, Tag outcome and Your note on tag_decisions (TD_EDITOR), Editor wording on rule_changes,
//                                                  Paused on agent_settings; [] for the others (claims has none on v2)
//   capabilityOf(config, tag)                   -> text, deterministic, source or corpus (config.tags, with its default)
//   groupOf(config, tag)                        -> the judge group the tag belongs to (config.judge.groups), or null
//   readingSettings(config)                     -> { reading_prompt, reading_batch, reading_effort }: config.distill's three reading settings, with READING_DEFAULTS for a missing one
//   constants: AGENT_NAME, TABLES, CAPABILITIES, RULEBOOK_COLUMNS, CLAIMS_GEO_COLUMNS, CLAIMS_WRITE_KEYS, AGENT_STATUS, READING_DEFAULTS, TD, TD_EDITOR, TAG_DECISIONS_WRITABLE, RULE_CHANGES_WRITABLE,
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
/** The value of config.profile (docs/mvp-2026-11/STRUCTURE-V2.md): the v2 page, the only layout this code works on since P48. */
export const V2_PROFILE = 'v2';
// The internal key of the claims table is `claims` (it was `claims_copy` until decision P5, 27 Oct 2026: there is one claims table, not a list).
export const TABLES = Object.freeze(['rulebook', 'claims', 'tag_decisions', 'rule_changes', 'agent_settings']);
export const CAPABILITIES = Object.freeze(['text', 'deterministic', 'source', 'corpus']);

/** The thirteen columns of the Rulebook copy (the taxonomy's, without its two relations). Setup creates a row with all of them. */
export const RULEBOOK_COLUMNS = Object.freeze([
  'Name', 'Category', 'Counterpart', 'Description', 'Evidence', 'Example Claims', 'Geo Status', 'Geo Tag ID', 'Polarity', 'Status', 'Verified on',
  'When to use', 'Work tags',
]);

/**
 * The nine Geo columns of the Claims table (P12, the lean Geo set): the claim's name, its identity and address in Geo, the space it was read from, the day it was made, its
 * sources, whether Geo marks it factual, its tags and its topics. Setup creates a row with all of them (from a row of the Geo pick, scripts/geo-pick.mjs). It was
 * CLAIMS_COPY_COLUMNS, thirteen columns of the old copy of the real table, until the fresh structure of 27 Oct 2026.
 */
export const CLAIMS_GEO_COLUMNS = Object.freeze([
  'Geo Name', 'Geo ID', 'Geo URL', 'Geo Space', 'Geo Created', 'Geo Sources', 'Geo Is factual', 'Geo Tags', 'Geo Topics',
]);

/** The keys the per-claim version had in notion.claims.columns for its three editor columns; v2 has none on Claims, so a config that names one is refused. */
const CLAIMS_RETIRED_COLUMN_KEYS = Object.freeze(['verified', 'review_status', 'notes']);
/**
 * The keys of notion.claims.write_columns: the eight columns the agent fills on the Claims copy (Agent tags, Agent confidence, Agent reasons, Agent status, Tags waiting,
 * Agent edition, Agent remarks; CLAIMS-REVIEW.md section 6.1; and Agent reading, READ-DECISIONS.md). Agent notes is retired: a config that still names it is refused.
 */
export const CLAIMS_WRITE_KEYS = Object.freeze(['tags', 'confidence', 'reasons', 'status', 'waiting', 'edition', 'remarks', 'reading']);
/** The write_columns key of a column the agent no longer writes (Agent notes); a config that still has it is refused, because the plan check would otherwise let the agent write it. */
export const CLAIMS_RETIRED_WRITE_KEYS = Object.freeze(['notes']);
/** The values of Agent status (a select on the Claims copy): what the agent says about a claim. */
export const AGENT_STATUS = Object.freeze({
  waits: 'Waits for you', done: 'Done', disagrees: 'Disagrees with your decision', unread: 'Could not read',
});

/**
 * The columns of Tag decisions (v2, P42 to P46), by short name. The only place their Notion names are spelled: every other file asks for TD.<name>. The three editor columns are
 * Agent is right, Tag outcome and Your note; no loop script writes them, and none reads them off a row (lib/decisions.mjs rowDecision is the one reader).
 */
export const TD = Object.freeze({
  claim: 'Claim',
  open: 'Open claim',
  key: 'Key',
  tag: 'Tag',
  proposal: 'Agent proposal',
  confidence: 'Agent confidence',
  reason: 'Agent reason',
  right: 'Agent is right',
  outcome: 'Tag outcome',
  note: 'Your note',
  status: 'Agent status',
  view: "Agent's view of your decision",
  rule: 'Rule',
  why: 'Why the agent thinks so',
  after: 'After the rule change',
  edition: 'Rulebook edition',
  decidedUnder: 'Decided under',
  readUnder: 'Read under',
});
/** The three columns of Tag decisions an editor writes (the same three as config.editor_columns.tag_decisions). */
export const TD_EDITOR = Object.freeze([TD.right, TD.outcome, TD.note]);

// Tag decisions is the agent's ledger plus the editor's decision. The agent writes its proposal, its status, its reading of a disagreement (distill) and the record of what an editor
// decided under (Decided under); the three editor columns are never in this list.
export const TAG_DECISIONS_WRITABLE = Object.freeze([
  TD.claim, TD.open, TD.key, TD.tag, TD.proposal, TD.confidence, TD.reason, TD.status, TD.view, TD.rule, TD.why, TD.after, TD.edition, TD.decidedUnder, TD.readUnder,
]);

/** The settings of the reading step in config.distill, and what a config that does not name them gets (READ-DECISIONS.md section 1: ten rows to a call, medium effort). */
export const READING_DEFAULTS = Object.freeze({ reading_prompt: 'prompts/reading.md', reading_batch: 10, reading_effort: 'medium' });
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
  // v2 is the only layout (P48): a per-claim config, or any other profile, is refused with the way back
  if (config.profile !== V2_PROFILE) bad('profile', `expected "${V2_PROFILE}": this code works on the v2 layout only (P48); the per-claim version is the git tag claim-tagger-v1`);

  // notion
  const n = config.notion;
  if (obj('notion', n)) {
    version('notion.api_version', n.api_version);
    version('notion.builder_api_version', n.builder_api_version);
    // the page that holds the five tables is made by `setup.mjs root`, so until then parent_page_id may be a placeholder
    id('notion.parent_page_id', n.parent_page_id, true);
    id('notion.root_parent_page_id', n.root_parent_page_id);
    if (obj('notion.pages', n.pages)) for (const k of ['proposal', 'demos', 'demo_tests', 'onboarding', 'archive']) id(`notion.pages.${k}`, n.pages[k], true);
    if (obj('notion.rulebook', n.rulebook)) {
      table('notion.rulebook', n.rulebook);
      text('notion.rulebook.work_tag', n.rulebook.work_tag);
    }
    // there is one claims table (P5): notion.claims is one object, never a list
    if (Array.isArray(n.claims)) {
      bad('notion.claims', 'expected one object: there is one claims table (P5), not a list of tables; this config has the older shape');
    } else if (obj('notion.claims', n.claims)) {
      const path = 'notion.claims';
      const c = n.claims;
      text(`${path}.label`, c.label);
      table(path, c);
      if (obj(`${path}.columns`, c.columns)) for (const k of ['claim', 'link', 'sources', 'is_factual']) text(`${path}.columns.${k}`, c.columns[k]);
      // there is no editor column on Claims (editors decide on Tag decisions): a config that still names one is refused
      if (isPlain(c.columns)) for (const k of CLAIMS_RETIRED_COLUMN_KEYS) if (c.columns[k] !== undefined) bad(`${path}.columns.${k}`, 'there is no editor column on Claims in v2 (editors decide on Tag decisions); remove this key');
      if (obj(`${path}.write_columns`, c.write_columns)) {
        for (const k of CLAIMS_WRITE_KEYS) text(`${path}.write_columns.${k}`, c.write_columns[k]);
        if (typeof c.write_columns.reading === 'string' && c.write_columns.reading !== TD.view) bad(`${path}.write_columns.reading`, `expected "${TD.view}" (the column was renamed in v2; "${c.write_columns.reading}" is the per-claim name)`);
        for (const k of CLAIMS_RETIRED_WRITE_KEYS) if (c.write_columns[k] !== undefined) bad(`${path}.write_columns.${k}`, 'Agent notes is retired (CLAIMS-REVIEW.md section 6.1); remove this key');
        const names = CLAIMS_WRITE_KEYS.map((k) => c.write_columns[k]).filter((v) => typeof v === 'string' && v.trim() !== '');
        if (new Set(names).size !== names.length) bad(`${path}.write_columns`, 'two keys name the same column');
      }
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
    // a placeholder until `setup.mjs root` makes the page (the hub it hangs under is never a setup parent, so a build step run too early finds no parent and stops)
    list('notion.setup_page_parents', n.setup_page_parents, (path, v) => id(path, v, true), { min: 1 });
    if (typeof n.requests_per_second !== 'number' || !(n.requests_per_second > 0)) bad('notion.requests_per_second', 'expected a number above 0');
    int('notion.page_size', n.page_size, 1, 100);
    int('notion.max_text', n.max_text, 1, 2000);

    // the sources are protected; the agent's own tables are not
    if (Array.isArray(n.protected_database_ids) && Array.isArray(n.protected_page_ids)) {
      const protectedIds = new Set([...n.protected_database_ids, ...n.protected_page_ids].map((p) => normId(p)));
      // the page hangs under the first page's hub, which it only ever reads children of: if the hub were protected, `setup.mjs root` could never make the page under it
      if (typeof n.root_parent_page_id === 'string' && protectedIds.has(normId(n.root_parent_page_id))) bad('notion.root_parent_page_id', 'is in the protected lists, so no page could be made under it');
      for (const [k, s] of Object.entries(isPlain(n.sources) ? n.sources : {})) {
        for (const f of ['database_id', 'data_source_id']) {
          if (isPlain(s) && typeof s[f] === 'string' && !protectedIds.has(normId(s[f]))) bad(`notion.sources.${k}.${f}`, 'must also be listed in protected_database_ids');
        }
      }
      const own = [['notion.rulebook', n.rulebook], ['notion.claims', n.claims],
        ...Object.entries(isPlain(n.databases) ? n.databases : {}).map(([k, v]) => [`notion.databases.${k}`, v])];
      for (const [path, t] of own) {
        for (const f of ['database_id', 'data_source_id']) {
          if (isPlain(t) && typeof t[f] === 'string' && protectedIds.has(normId(t[f]))) bad(`${path}.${f}`, 'is in the protected lists, so it could never be written');
        }
      }
    }
  }

  // editor_columns: none on Claims, the three of TD_EDITOR on Tag decisions, Editor wording and the two Status values on Rule changes, Paused on Agent settings
  if (obj('editor_columns', config.editor_columns)) {
    for (const k of ['claims', 'rule_changes', 'rule_changes_status_editor_values', 'agent_settings']) {
      list(`editor_columns.${k}`, config.editor_columns[k], (path, v) => text(path, v));
    }
    if (Array.isArray(config.editor_columns.claims) && config.editor_columns.claims.length > 0) bad('editor_columns.claims', 'there is no editor column on Claims in v2: expected an empty list');
    const td = config.editor_columns.tag_decisions;
    if (!Array.isArray(td)) bad('editor_columns.tag_decisions', `expected the three editor columns of Tag decisions (${TD_EDITOR.join(', ')})`);
    else {
      list('editor_columns.tag_decisions', td, (path, v) => text(path, v));
      if (td.length !== TD_EDITOR.length || !TD_EDITOR.every((name) => td.includes(name))) bad('editor_columns.tag_decisions', `expected exactly ${TD_EDITOR.join(', ')}`);
      // none of the columns the agent writes may be one of the editor's
      if (isPlain(n?.claims) && isPlain(n.claims.write_columns)) {
        for (const k of CLAIMS_WRITE_KEYS) {
          if (td.includes(n.claims.write_columns[k])) bad(`notion.claims.write_columns.${k}`, `"${n.claims.write_columns[k]}" is an editor column (editor_columns.tag_decisions), so the agent could never write it`);
        }
      }
      for (const name of TAG_DECISIONS_WRITABLE) if (td.includes(name)) bad('editor_columns.tag_decisions', `"${name}" is a column the agent writes`);
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
    // the reading step (READ-DECISIONS.md): each setting is optional, READING_DEFAULTS stands in for a missing one
    if (d.reading_prompt !== undefined) relativePath('distill.reading_prompt', d.reading_prompt);
    if (d.reading_batch !== undefined) int('distill.reading_batch', d.reading_batch, 1);
    if (d.reading_effort !== undefined && !EFFORTS.includes(d.reading_effort)) bad('distill.reading_effort', `expected one of ${EFFORTS.join(', ')}`);
  }
  if (obj('gate', config.gate) && obj('gate.default', config.gate.default)) int('gate.default.flip_rejudge_runs', config.gate.default.flip_rejudge_runs, 0);

  // the practice pages are parked (P48)
  if (config.demo !== undefined) bool('demo', config.demo);
  if (config.demo === true) bad('demo', 'practice pages are parked (P48); use the git tag claim-tagger-v1');

  return { ok: errors.length === 0, errors };
}

// ---- questions -------------------------------------------------------------------------------------------------------------

/** True for the v2 profile: a config with "profile": "v2" (every valid config has it since P48; setup-steps still asks). */
export function isV2(config) {
  return config?.profile === V2_PROFILE;
}

/** True for a demo profile: a config with "demo": true (its tables live on the practice page). */
export function isDemo(config) {
  return config?.demo === true;
}

/**
 * The entry of one table. rulebook is notion.rulebook, claims is notion.claims (one object: there is one claims table, P5), and tag_decisions,
 * rule_changes and agent_settings are notion.databases.<name>. Each has database_id, data_source_id and key. It is the entry object itself.
 */
export function tableEntry(config, name) {
  const n = config?.notion ?? {};
  let entry;
  switch (name) {
    case 'rulebook':
      entry = n.rulebook;
      break;
    case 'claims':
      entry = n.claims;
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
 *   tag_decisions    TAG_DECISIONS_WRITABLE: Claim, Open claim, Key, Tag, Agent proposal, Agent confidence, Agent reason, Agent status, the agent's reading (Agent's view of your
 *                    decision, Rule, Why the agent thinks so, Read under), After the rule change, Rulebook edition, Decided under. Never Agent is right, Tag outcome or Your note
 *   rule_changes     Lesson, Tag, Rule, Kind, Current text, Proposed text, Safety check result, Supporting rows, Status
 *                    (the Status values are limited to RULE_CHANGES_AGENT_STATUS)
 *   agent_settings   Rulebook edition, Last run summary; with setup also the key column (Name)
 *   rulebook         When to use; with setup every column of the copy
 *   claims           the eight write columns (Agent tags, Agent confidence, Agent reasons, Agent status, Tags waiting, Agent edition, Agent remarks, Agent reading); with setup also every copied column
 * Editor columns are never in these sets. The one script that may write them is the copy (copyLiveProperties), and that exception is checked by the plan code, not here.
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
    case 'claims': {
      const entry = tableEntry(config, 'claims');
      add(...CLAIMS_WRITE_KEYS.map((k) => entry.write_columns[k]).filter(Boolean));
      if (setup) add(entry.key, ...Object.values(entry.columns), ...CLAIMS_GEO_COLUMNS);
      break;
    }
    default:
      throw new Error(`writableProperties: unknown table "${table}" (expected one of ${TABLES.join(', ')})`);
  }
  return set;
}

/**
 * The script whose plans may CREATE rows of the claims table, from claims read from Geo (decision P35): scripts/add.mjs. checkPlan gives a plan with this script
 * name (and only that) the columns of addableProperties on a create of a claims row; no other script may create one (setup has its own path, `setup: true`).
 */
export const ADD_SCRIPT = 'add';

/** The columns a plan of the add script may write to a new claims row (P35): the table's key (Geo ID) and the nine Geo columns, nothing else: no agent column, no editor column. */
export function addableProperties(config) {
  return new Set([tableEntry(config, 'claims').key, ...CLAIMS_GEO_COLUMNS]);
}

/**
 * The script whose plans may CREATE and UPDATE rows of all five tables of the v2 profile, editor columns included (decision P47, the data copy of checkpoint 2): scripts/copy-live.mjs. checkPlan
 * gives a plan with this script name (and only that) the columns of copyLiveProperties, and only on a config with "profile": "v2". It never writes Agent is right, a protected table or id, and a plan has no way to delete.
 */
export const COPY_LIVE_SCRIPT = 'copy-live';

/**
 * The script whose plans may TRASH rows (decision P51): scripts/remove.mjs. checkPlan gives a plan with this script name (and only that) the op "trash", only on a config with "profile": "v2",
 * only on the rows of TRASHABLE_TABLES, never on a protected id or an id of setup/first-page.json. A plan of this script holds nothing but trash ops.
 */
export const REMOVE_SCRIPT = 'remove';

/** The tables whose rows a plan of the remove script may trash (P51): Claims and Tag decisions. Nothing else is ever trashed by a script. */
export const TRASHABLE_TABLES = Object.freeze(['claims', 'tag_decisions']);

/** The name of the column that holds the agent's view of a decision on v2 (STRUCTURE-V2.md, P45): "Agent reading" on the first page. */
export const V2_VIEW_COLUMN = TD.view;

/**
 * The columns a copy-live plan may write, per table, under the names they have on the v2 page (not read from the config: the config of the loop may name the agent's columns otherwise).
 * Tag outcome, Your note, Editor wording and Paused are the editors' columns; the copy writes them from the decisions made on the first page. Agent is right is not here: the copy never sets it.
 */
export const COPY_LIVE_COLUMNS = Object.freeze({
  rulebook: RULEBOOK_COLUMNS,
  claims: Object.freeze([
    ...CLAIMS_GEO_COLUMNS, 'Agent tags', 'Agent confidence', 'Agent reasons', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks', V2_VIEW_COLUMN,
  ]),
  tag_decisions: Object.freeze([
    'Claim', 'Key', 'Tag', 'Agent proposal', 'Agent confidence', 'Agent reason', 'Rulebook edition', 'Decided under', 'Rule', 'Read under', V2_VIEW_COLUMN,
    'Why the agent thinks so', 'After the rule change', 'Open claim', 'Agent status', 'Tag outcome', 'Your note',
  ]),
  rule_changes: Object.freeze([
    'Lesson', 'Tag', 'Rule', 'Kind', 'Current text', 'Proposed text', 'Safety check result', 'Supporting rows', 'Editor wording', 'Status',
  ]),
  agent_settings: Object.freeze(['Name', 'Paused', 'Rulebook edition', 'Last run summary']),
});

/** The columns a plan of the copy-live script may write to a table: COPY_LIVE_COLUMNS and the table's key. */
export function copyLiveProperties(config, table) {
  if (!TABLES.includes(table)) throw new Error(`copyLiveProperties: unknown table "${table}" (expected one of ${TABLES.join(', ')})`);
  return new Set([...COPY_LIVE_COLUMNS[table], tableEntry(config, table).key]);
}

/** The columns of a table that only an editor writes (config.editor_columns): [] for the tables that have none (Claims has none on v2). */
export function editorColumns(config, table) {
  if (!TABLES.includes(table)) throw new Error(`editorColumns: unknown table "${table}" (expected one of ${TABLES.join(', ')})`);
  return [...(config?.editor_columns?.[table] ?? [])];
}

/** The settings of the reading step: config.distill's reading_prompt, reading_batch and reading_effort, READING_DEFAULTS for any it does not name. */
export function readingSettings(config) {
  const d = config?.distill ?? {};
  return {
    reading_prompt: d.reading_prompt ?? READING_DEFAULTS.reading_prompt,
    reading_batch: d.reading_batch ?? READING_DEFAULTS.reading_batch,
    reading_effort: d.reading_effort ?? READING_DEFAULTS.reading_effort,
  };
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
