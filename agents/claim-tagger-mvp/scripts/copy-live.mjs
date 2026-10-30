#!/usr/bin/env node
// Copy live: copy the claim tagger's data from the first page ("Claim tagger", the per-claim layout) into the five tables of the v2 page ("Claim tagger v2", one row per claim and tag).
// Checkpoint 2 of the v2 page (decisions P43, P47, P48; docs/mvp-2026-11/OVERNIGHT.md).
//
//   node agents/claim-tagger-mvp/scripts/copy-live.mjs plan [--overwrite-editor-values] [--run-id <id>]
//   node agents/claim-tagger-mvp/scripts/copy-live.mjs apply [--run <id>]
//   node agents/claim-tagger-mvp/scripts/copy-live.mjs check [--run <id>]
//
//   plan    Read only. Reads every row of the five source tables (setup/first-page.json: the only description of the source) and of the five target tables (the config of the state root,
//           CLAIM_TAGGER_MVP_ROOT; it must be the v2 profile), and writes the plan to runs/copy-live/<run id>/plan.jsonl (+ summary.json). Prints the rows to create and update per table, and the conflicts.
//   apply   Applies the newest plan (or --run <id>) table by table in this order: Rulebook, Claims, Tag decisions, Rule changes, Agent settings. Every table is its own stage
//           (runs/copy-live/<run id>/stages/<n>-<table>/ with its plan and its ledger, written by lib/plan.mjs applyPlan, which checks it again, writes it, and reads every page back). A stage that
//           is stopped is resumed by the same command: the ops the ledger holds as done are not sent again, so no page is created twice. The relation columns of the plan hold names (Rulebook
//           names, Geo IDs); the stage turns them into the page ids of the v2 pages made by the stages before it.
//   check   Read only. Reads the target tables and confirms every value of the plan (exit 0, or 2 when something differs).
//
// Keys. Claims by Geo ID, Tag decisions by Key, Rulebook by Name, Rule changes by Lesson, Agent settings by Name.
// A re-run is a re-sync: it brings over what editors decided on the first page since the last copy, and the rows that are new there. A missing target row is created in full. For a row v2 already has,
// the copy updates ONLY the editor columns, because the loop owns everything else on v2 (proposals, editions, Agent status, readings, the Rulebook): Tag decisions: Tag outcome and Your note, and Decided
// under only when it sets a decision the v2 row does not have yet; Rule changes: Editor wording, and Status when the first page says Approved or Rejected; Agent settings: Paused. Existing Rulebook and
// Claims rows, and every agent column, are never updated. A non-empty editor value of v2 that differs from what the source would write is a conflict: it is kept, reported, and written only when `plan` is given --overwrite-editor-values.
// Agent is right is never written. Nothing is deleted: rows of the target that the source does not have are left alone.
//
// Mapping (the task of 30 Oct). Rulebook: the columns of the Rulebook copy. Claims: the nine Geo columns and the agent's eight (Agent tags and Tags waiting as relations to the v2 Rulebook pages with the
// same Name; Agent reading becomes Agent's view of your decision); never Verified tags, Review status, Challenged tags notes or the columns editors added. Tag decisions: one row per row of the first
// page's ledger, with the renames (Agent reading, Reading note, Follow-up), Open claim, Agent status per row, and the decision read from the first page's claim (lib/first-page.mjs). Rule changes and Agent
// settings: column for column.
//
// Writes. Only through lib/plan.mjs (checkPlan: the narrow allowance for the script "copy-live", on the v2 profile only; applyPlan: ledger and read-back). The source tables are only ever read; a
// target id that also appears in setup/first-page.json stops the script. runs/PAUSED of the root, or Paused in the target's Agent settings, stops plan and apply (exit 3).
//
// Exit codes: 0 ok, 1 Notion could not be read or a write did not finish or a row changed since the plan (run it again; `plan` again for the latter), 2 invalid (not the v2 profile, overlapping ids,
// a column missing, a plan the check refuses, a read-back that differs), 3 paused.
//
// Exports: main, plan, apply, check, buildPlan, readFirstPage, USAGE.

import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  CLAIMS_WRITE_KEYS, COPY_LIVE_COLUMNS, COPY_LIVE_SCRIPT, RULEBOOK_COLUMNS, TABLES, V2_VIEW_COLUMN, isV2, loadConfig, tableEntry,
} from './lib/config.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { decisionsFor, keyGeoId, rowAgentStatus } from './lib/first-page.mjs';
import { readJson, writeJsonAtomic } from './lib/jsonl.mjs';
import { clientFromConfig, countRequests, requestLogger } from './lib/notion-rest.mjs';
import { decodePage, normId } from './lib/notion-values.mjs';
import { agentRoot, codeFile, isMain, runId as makeRunId } from './lib/paths.mjs';
import { PlanError, applyPlan, checkPlan, compareWritten, newPlan, readPlan } from './lib/plan.mjs';
import { richTextFromPieces, withLinkedSources } from './lib/setup-steps.mjs';
import { richTextPieces } from './pull.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/copy-live.mjs (plan [--overwrite-editor-values] [--run-id <id>] | apply [--run <id>] | check [--run <id>])';

/** The tables in the order they are written: Claims point at Rulebook pages, Tag decisions at Claims pages. */
export const ORDER = Object.freeze(['rulebook', 'claims', 'tag_decisions', 'rule_changes', 'agent_settings']);
const ID_RE = /^[A-Za-z0-9._-]+$/;
const REAL_ID = /^[0-9a-f]{32}$/;
const SHOWN = 5; // conflicts and warnings printed; summary.json has all of them

// relation columns of the target: the plan holds names (Rulebook names, Geo IDs); a stage turns them into page ids
const RELATIONS = Object.freeze({
  claims: Object.freeze({ 'Agent tags': 'rulebook', 'Tags waiting': 'rulebook' }),
  tag_decisions: Object.freeze({ 'Open claim': 'claims' }),
});
// editor columns of the target: what the copy must not overwrite when a person has filled it (owned), and which columns a write is protected on with `expect`
const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const GUARDS = Object.freeze({
  tag_decisions: { columns: ['Tag outcome', 'Your note'], owned: (col, v) => text(v).trim() !== '' },
  rule_changes: { columns: ['Editor wording', 'Status'], owned: (col, v) => (col === 'Editor wording' ? text(v).trim() !== '' : ['Approved', 'Rejected'].includes(v)) },
  agent_settings: { columns: ['Paused'], owned: (col, v) => v === true },
});
// what a re-sync may change on a row that v2 already has: the editor columns only (never agent columns, the Rulebook, editions or Claims)
const DECIDED_STATUS = Object.freeze(['Approved', 'Rejected']);
const EDITOR_UPDATES = Object.freeze({
  tag_decisions: Object.freeze(['Tag outcome', 'Your note', 'Decided under']),
  rule_changes: Object.freeze(['Editor wording', 'Status']),
  agent_settings: Object.freeze(['Paused']),
});
const TAG_DECISIONS_SOURCE = Object.freeze([
  'Claim', 'Key', 'Tag', 'Agent proposal', 'Agent confidence', 'Agent reason', 'Rulebook edition', 'Decided under', 'Rule', 'Read under', 'Agent reading', 'Reading note', 'Follow-up',
]);

/** A stop with an exit code and a message. */
class Stop extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Stop';
    this.code = code;
  }
}

const short = (v, n = 70) => {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v ?? null);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const empty = (v) => v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0);

// ---- the source description and the target config -----------------------------------------------------------------------------------------------

/** setup/first-page.json (the root's own copy, else the agent folder's), checked: five tables with ids and keys, and the claims column names. */
export function readFirstPage(root) {
  const file = codeFile(root, 'setup', 'first-page.json');
  let doc;
  try {
    doc = readJson(file);
  } catch (e) {
    throw new Stop(EXIT.INVALID, `${file} cannot be read: ${e.message}`);
  }
  const problems = [];
  for (const table of TABLES) {
    const t = doc?.tables?.[table];
    if (!t || typeof t !== 'object') {
      problems.push(`tables.${table}: missing`);
      continue;
    }
    for (const f of ['database_id', 'data_source_id']) if (!REAL_ID.test(normId(t[f]))) problems.push(`tables.${table}.${f}: expected a Notion id`);
    if (text(t.key).trim() === '') problems.push(`tables.${table}.key: expected a column name`);
  }
  const c = doc?.tables?.claims;
  for (const k of ['claim', 'link', 'sources', 'is_factual', 'verified', 'review_status', 'notes']) if (text(c?.columns?.[k]).trim() === '') problems.push(`tables.claims.columns.${k}: expected a column name`);
  for (const k of CLAIMS_WRITE_KEYS) if (text(c?.write_columns?.[k]).trim() === '') problems.push(`tables.claims.write_columns.${k}: expected a column name`);
  if (problems.length) throw new Stop(EXIT.INVALID, `${file} is not valid:\n- ${problems.join('\n- ')}`);
  return doc;
}

/** The ids of the five tables of a description or a config, normalised: database and data source. */
const idsOf = (entries) => entries.flatMap((e) => [e?.database_id, e?.data_source_id]).map((id) => normId(id)).filter((id) => REAL_ID.test(id));

// ---- reading tables -----------------------------------------------------------------------------------------------------------------------

/** One table: its schema and every row as { page_id, props, raw } (props decoded; a relation that Notion cut at 25 references is read whole). Read only. */
async function readTable(client, entry, pageSize) {
  const schema = await client.retrieveDatabase(entry.database_id);
  const pages = await client.queryAll(entry.database_id, { pageSize });
  const rows = [];
  for (const page of pages) {
    const d = decodePage(page, schema);
    for (const column of d.relation_has_more ?? []) {
      const items = await client.retrievePropertyItem(page.id, schema.properties[column].id);
      d.props[column] = items.map((i) => i?.relation?.id).filter(Boolean);
    }
    rows.push({ page_id: d.page_id, props: d.props, raw: page });
  }
  return { entry, schema, rows };
}

/** Map key -> row. A repeated key is refused: the copy could not tell which row is meant. */
function indexRows(table, keyColumn, label, warnings = null) {
  const byKey = new Map();
  const twice = [];
  for (const row of table.rows) {
    const key = text(row.props[keyColumn]).trim();
    if (key === '') {
      warnings?.push(`${label}: a row with an empty ${keyColumn} was left out`);
      continue;
    }
    if (byKey.has(key)) twice.push(key);
    else byKey.set(key, row);
  }
  if (twice.length) throw new Stop(EXIT.INVALID, `${label} has ${twice.length} ${keyColumn} value(s) on more than one row (${twice.slice(0, 3).map((k) => short(k, 40)).join(', ')}); the copy cannot tell which is meant`);
  return byKey;
}

function needColumns(label, schema, names) {
  const have = schema?.properties ?? {};
  const missing = [...new Set(names)].filter((n) => !have[n]);
  if (missing.length) throw new Stop(EXIT.INVALID, `${label} has no column ${missing.map((m) => `"${m}"`).join(', ')}; the copy reads and writes it`);
}

// ---- the plan -----------------------------------------------------------------------------------------------------------------------------

/** A plain value of a source column, in the form the target column takes: null for a missing value, [] for a missing multi-select, false for a missing checkbox. */
function plainOf(props, column, type) {
  const v = props[column];
  if (type === 'multi_select') return Array.isArray(v) ? [...v] : [];
  if (type === 'checkbox') return v === true;
  return v === undefined ? null : v;
}

/**
 * Everything the plan is made of. source and target are { [table]: { entry, schema, rows } } as readTable gives them. Returns { plan (the builder of lib/plan.mjs), summary }. Pure apart from the
 * plan builder: nothing is read or written.
 */
export function buildPlan({ config, firstPage, source, target, overwrite = false, runId, now = () => new Date() }) {
  const src = firstPage.tables;
  const cols = src.claims.columns;
  const wc = src.claims.write_columns;
  const warnings = [];
  const conflicts = [];
  const stats = Object.fromEntries(ORDER.map((t) => [t, { source: 0, create: 0, update: 0, same: 0, conflicts: 0 }]));

  // the columns both sides must have: a missing one stops the copy before anything is planned
  const geoSource = {
    'Geo Name': cols.claim, 'Geo ID': src.claims.key, 'Geo URL': cols.link, 'Geo Space': 'Geo Space', 'Geo Created': 'Geo Created', 'Geo Sources': cols.sources, 'Geo Is factual': cols.is_factual,
    'Geo Tags': 'Geo Tags', 'Geo Topics': 'Geo Topics',
  };
  const agentSource = {
    'Agent tags': wc.tags, 'Agent confidence': wc.confidence, 'Agent reasons': wc.reasons, 'Agent status': wc.status, 'Tags waiting': wc.waiting, 'Agent edition': wc.edition,
    'Agent remarks': wc.remarks, [V2_VIEW_COLUMN]: wc.reading,
  };
  needColumns('the first page\'s Rulebook', source.rulebook.schema, RULEBOOK_COLUMNS);
  needColumns('the first page\'s Claims', source.claims.schema, [...Object.values(geoSource), ...Object.values(agentSource), cols.verified, cols.review_status, cols.notes]);
  needColumns('the first page\'s Tag decisions', source.tag_decisions.schema, TAG_DECISIONS_SOURCE);
  needColumns('the first page\'s Rule changes', source.rule_changes.schema, COPY_LIVE_COLUMNS.rule_changes);
  needColumns('the first page\'s Agent settings', source.agent_settings.schema, COPY_LIVE_COLUMNS.agent_settings);
  for (const table of ORDER) needColumns(`the v2 ${table.replace('_', ' ')} table`, target[table].schema, [...COPY_LIVE_COLUMNS[table], tableEntry(config, table).key]);

  const typeOf = (table, column, side = source) => side[table].schema.properties[column]?.type ?? null;
  const plan = newPlan({ runId, script: COPY_LIVE_SCRIPT, rubricEdition: null, config, now });

  // ---- indexes: the rows of both sides by key, the Rulebook names by page id
  const srcRulebook = indexRows(source.rulebook, src.rulebook.key, 'the first page\'s Rulebook', warnings);
  const srcClaims = indexRows(source.claims, src.claims.key, 'the first page\'s Claims', warnings);
  const srcLedger = indexRows(source.tag_decisions, src.tag_decisions.key, 'the first page\'s Tag decisions', warnings);
  const srcChanges = indexRows(source.rule_changes, src.rule_changes.key, 'the first page\'s Rule changes', warnings);
  const srcSettings = indexRows(source.agent_settings, src.agent_settings.key, 'the first page\'s Agent settings', warnings);
  const tgt = {
    rulebook: indexRows(target.rulebook, tableEntry(config, 'rulebook').key, 'the v2 Rulebook'),
    claims: indexRows(target.claims, tableEntry(config, 'claims').key, 'the v2 Claims'),
    tag_decisions: indexRows(target.tag_decisions, tableEntry(config, 'tag_decisions').key, 'the v2 Tag decisions'),
    rule_changes: indexRows(target.rule_changes, tableEntry(config, 'rule_changes').key, 'the v2 Rule changes'),
    agent_settings: indexRows(target.agent_settings, tableEntry(config, 'agent_settings').key, 'the v2 Agent settings'),
  };
  const srcTagName = new Map([...srcRulebook].map(([name, row]) => [normId(row.page_id), name]));
  const tgtRulebookName = new Map([...tgt.rulebook].map(([name, row]) => [normId(row.page_id), name]));
  const tgtClaimGeoId = new Map([...tgt.claims].map(([geoId, row]) => [normId(row.page_id), geoId]));
  const namesOf = (ids) => [...new Set((ids ?? []).map((id) => srcTagName.get(normId(id))).filter(Boolean))].sort();

  /** One row: a create when the target has none, else an update of the columns that differ, minus the editor values a person has set (a conflict). */
  function emit(table, key, desired, existing, relationMaps = {}) {
    const guard = GUARDS[table] ?? null;
    const s = stats[table];
    if (!existing) {
      const kept = Object.fromEntries(Object.entries(desired).filter(([c, v]) => c === tableEntry(config, table).key || !empty(v)));
      plan.create(table, key, kept);
      s.create += 1;
      return;
    }
    const comparable = { ...existing.props };
    for (const [column, map] of Object.entries(relationMaps)) {
      comparable[column] = (existing.props[column] ?? []).map((id) => map.get(normId(id)) ?? `unknown:${id}`).sort();
    }
    // a re-sync of an existing row: only the editor columns can change, and only to carry what a person decided on the first page
    const carried = {};
    for (const column of EDITOR_UPDATES[table] ?? []) {
      if (!Object.hasOwn(desired, column)) continue;
      const held = existing.props[column] ?? null;
      if (table === 'tag_decisions' && column === 'Decided under' && !(empty(held) && !empty(desired[column]) && !empty(desired['Tag outcome']))) continue; // sets a decision the row does not have yet, never moves one
      if (table === 'rule_changes' && column === 'Status' && !DECIDED_STATUS.includes(desired[column])) continue; // only Approved or Rejected is an editor's word
      carried[column] = desired[column];
    }
    const props = {};
    const expect = {};
    for (const { column } of compareWritten(carried, comparable, target[table].schema)) {
      const held = existing.props[column] ?? null;
      if (guard?.columns.includes(column) && guard.owned(column, held)) {
        // a person's value is overwritten only on request, and only by a value: the flag never blanks what an editor wrote
        const blank = empty(desired[column]);
        if (!overwrite || blank) {
          conflicts.push({ table, key, column, kept: held, source: desired[column] ?? null, kind: blank ? 'source is empty' : 'different' });
          s.conflicts += 1;
          continue;
        }
      }
      props[column] = desired[column];
      if (desired[`${column}:end`] !== undefined) props[`${column}:end`] = desired[`${column}:end`];
      if (guard?.columns.includes(column)) expect[column] = held; // an editor who writes between the plan and the apply makes the op skip, not lose
    }
    if (Object.keys(props).length === 0) {
      s.same += 1;
      return;
    }
    plan.update(table, key, existing.page_id, props, Object.keys(expect).length ? { expect } : {});
    s.update += 1;
  }

  // ---- Rulebook: every column of the copy, by the same names
  for (const [name, row] of srcRulebook) {
    stats.rulebook.source += 1;
    const desired = {};
    for (const column of RULEBOOK_COLUMNS) {
      const type = typeOf('rulebook', column);
      if (type !== typeOf('rulebook', column, target)) throw new Stop(EXIT.INVALID, `the Rulebook column "${column}" is ${type} on the first page and ${typeOf('rulebook', column, target)} on v2`);
      desired[column] = plainOf(row.props, column, type);
      if (type === 'date' && row.props[`${column}:end`]) desired[`${column}:end`] = row.props[`${column}:end`];
    }
    desired[tableEntry(config, 'rulebook').key] = name;
    emit('rulebook', name, desired, tgt.rulebook.get(name));
  }

  // ---- the first page's claims as the decision rule reads them
  const tagNames = [...srcRulebook.keys()];
  const claimOf = (geoId, row) => ({
    geo_id: geoId,
    review_status: row.props[cols.review_status] ?? null,
    verified_tags: namesOf(row.props[cols.verified]),
    challenged_notes: row.props[cols.notes] ?? null,
    agent_status: row.props[wc.status] ?? null,
    tags_waiting: namesOf(row.props[wc.waiting]),
  });
  const claimObjects = new Map([...srcClaims].map(([geoId, row]) => [geoId, claimOf(geoId, row)]));

  // ---- Claims
  const claimMaps = { 'Agent tags': tgtRulebookName, 'Tags waiting': tgtRulebookName };
  for (const [geoId, row] of srcClaims) {
    stats.claims.source += 1;
    const desired = {};
    for (const [targetColumn, sourceColumn] of Object.entries({ ...geoSource, ...agentSource })) {
      const type = typeOf('claims', sourceColumn);
      const targetType = typeOf('claims', targetColumn, target);
      if (type !== targetType) throw new Stop(EXIT.INVALID, `the Claims column "${targetColumn}" is ${targetType} on v2 but "${sourceColumn}" is ${type} on the first page`);
      if (type === 'relation') desired[targetColumn] = namesOf(row.props[sourceColumn]);
      else {
        desired[targetColumn] = plainOf(row.props, sourceColumn, type);
        if (type === 'date' && row.props[`${sourceColumn}:end`]) desired[`${targetColumn}:end`] = row.props[`${sourceColumn}:end`];
      }
    }
    desired[tableEntry(config, 'claims').key] = geoId;
    emit('claims', geoId, desired, tgt.claims.get(geoId), claimMaps);
  }

  // ---- Tag decisions: one row per row of the ledger
  const ledgerOf = new Map(); // geo id -> the ledger rows of the claim, as plain rows
  for (const [key, row] of srcLedger) {
    const geoId = keyGeoId(key);
    if (geoId === null) {
      warnings.push(`the first page's Tag decisions: the Key ${short(key, 40)} has no "::", so its row has no claim`);
      continue;
    }
    ledgerOf.set(geoId, [...(ledgerOf.get(geoId) ?? []), { ...row.props, Key: key }]);
  }
  const decided = new Map(); // ledger key -> decision
  for (const [geoId, rows] of ledgerOf) {
    const claim = claimObjects.get(geoId);
    if (!claim) continue;
    for (const d of decisionsFor(claim, rows, { tagNames })) decided.set(d.key, d);
  }
  let orphans = 0;
  const statusCounts = {};
  const ledgerMaps = { 'Open claim': tgtClaimGeoId };
  for (const [key, row] of srcLedger) {
    stats.tag_decisions.source += 1;
    const p = row.props;
    const geoId = keyGeoId(key);
    const claim = geoId === null ? null : claimObjects.get(geoId) ?? null;
    if (!claim) orphans += 1;
    const decision = decided.get(key) ?? null;
    const status = rowAgentStatus(claim, p, decision);
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    const same = (column) => plainOf(p, column, typeOf('tag_decisions', column));
    const desired = {
      Claim: same('Claim'), Key: key, Tag: same('Tag'), 'Agent proposal': same('Agent proposal'), 'Agent confidence': same('Agent confidence'), 'Agent reason': same('Agent reason'),
      'Rulebook edition': same('Rulebook edition'), 'Decided under': decision ? decision.decided_under : same('Decided under'), Rule: same('Rule'), 'Read under': same('Read under'),
      [V2_VIEW_COLUMN]: same('Agent reading'), 'Why the agent thinks so': same('Reading note'), 'After the rule change': same('Follow-up'),
      'Open claim': claim ? [geoId] : [], 'Agent status': status, 'Tag outcome': decision ? decision.outcome : null, 'Your note': decision ? decision.note : null,
    };
    emit('tag_decisions', key, desired, tgt.tag_decisions.get(key), ledgerMaps);
  }
  if (orphans) warnings.push(`${orphans} row(s) of the first page's Tag decisions have no claim in the first page's Claims; they are copied without Open claim and without a decision`);

  // ---- Rule changes and Agent settings: column for column
  const straight = (table, rows, tableName) => {
    for (const [key, row] of rows) {
      stats[table].source += 1;
      const desired = {};
      for (const column of COPY_LIVE_COLUMNS[table]) {
        const type = typeOf(table, column);
        if (type !== typeOf(table, column, target)) throw new Stop(EXIT.INVALID, `the ${tableName} column "${column}" is ${type} on the first page and ${typeOf(table, column, target)} on v2`);
        desired[column] = plainOf(row.props, column, type);
      }
      emit(table, key, desired, tgt[table].get(key));
    }
  };
  straight('rule_changes', srcChanges, 'Rule changes');
  straight('agent_settings', srcSettings, 'Agent settings');

  const summary = {
    run_id: runId,
    created_at: now().toISOString(),
    overwrite_editor_values: overwrite,
    tables: stats,
    decided: { rows: decided.size, claims: new Set([...decided.values()].map((d) => keyGeoId(d.key))).size },
    row_status: statusCounts,
    conflicts,
    warnings,
  };
  return { plan, summary };
}

// ---- the context ----------------------------------------------------------------------------------------------------------------------------

const now0 = (opts) => opts.now ?? (() => new Date());
const runsBase = (root) => join(root, 'runs', 'copy-live');

function openContext(opts, command) {
  const root = resolve(opts.root ?? agentRoot());
  let config;
  try {
    config = opts.config ?? loadConfig(root);
  } catch (e) {
    throw new Stop(EXIT.INVALID, e.message);
  }
  if (!isV2(config)) throw new Stop(EXIT.INVALID, 'the target config is not the v2 profile (it has no "profile": "v2"), and copy-live writes only the v2 page; point CLAIM_TAGGER_MVP_ROOT at the v2 state folder');
  const firstPage = readFirstPage(root);
  const target = idsOf(TABLES.map((t) => tableEntry(config, t)));
  const first = new Set(idsOf(Object.values(firstPage.tables)));
  const overlap = target.filter((id) => first.has(id));
  if (overlap.length) throw new Stop(EXIT.INVALID, `${overlap.length} id(s) of the target config (starting ${[...new Set(overlap)].slice(0, 3).map((i) => i.slice(0, 8)).join(', ')}) are also in setup/first-page.json; the source and the target must be different tables`);
  if (command !== 'check' && existsSync(join(root, 'runs', 'PAUSED'))) throw new Stop(EXIT.PAUSED, 'runs/PAUSED exists, so a person has to remove it first');
  return { root, config, firstPage, now: now0(opts), opts };
}

function clientFor(ctx, runDir, name) {
  mkdirSync(runDir, { recursive: true });
  const client = ctx.opts.client ?? clientFromConfig(ctx.config, {
    fetchImpl: ctx.opts.fetchImpl, token: ctx.opts.token, repoRoot: ctx.opts.repoRoot, sleep: ctx.opts.sleep, log: requestLogger(join(runDir, `requests-${name}.jsonl`)),
  });
  if (!client) throw new Stop(EXIT.INVALID, 'there is no NOTION_TOKEN in .env');
  return client;
}

async function readTargets(ctx, client, tables = ORDER) {
  const out = {};
  for (const t of tables) out[t] = await readTable(client, tableEntry(ctx.config, t), ctx.config.notion.page_size);
  return out;
}

async function readSources(ctx, client, tables = ORDER) {
  const out = {};
  for (const t of tables) out[t] = await readTable(client, ctx.firstPage.tables[t], ctx.config.notion.page_size);
  return out;
}

/** Stop with exit 3 when a target Agent settings row has Paused ticked. */
function pausedInNotion(agentSettings) {
  if (agentSettings.rows.some((r) => r.props.Paused === true)) throw new Stop(EXIT.PAUSED, 'Paused is ticked in the v2 Agent settings, so a person has to untick it first');
}

const newestRun = (root) => {
  const base = runsBase(root);
  if (!existsSync(base)) return null;
  const names = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(base, e.name, 'plan.jsonl'))).map((e) => e.name).sort();
  return names.length ? names.at(-1) : null;
};

function pickRun(ctx, asked) {
  const id = asked ?? newestRun(ctx.root);
  if (!id) throw new Stop(EXIT.INVALID, 'there is no plan yet: run copy-live.mjs plan first');
  if (!ID_RE.test(id)) throw new Stop(EXIT.INVALID, `--run may only use letters, digits, '.', '_' and '-', got "${id}"`);
  const dir = join(runsBase(ctx.root), id);
  if (!existsSync(join(dir, 'plan.jsonl'))) throw new Stop(EXIT.INVALID, `there is no plan in ${dir}`);
  return { id, dir };
}

/** The plan of a run folder, read, validated against the schema and checked. */
function loadPlan(ctx, dir) {
  const master = readPlan(dir);
  if (master.header?.plan?.script !== COPY_LIVE_SCRIPT) throw new Stop(EXIT.INVALID, `the plan in ${dir} was not made by copy-live.mjs`);
  const checked = checkPlan(master, ctx.config, { root: ctx.root });
  if (!checked.ok) throw new Stop(EXIT.INVALID, `the plan in ${dir} is refused by the check:\n- ${checked.problems.slice(0, 10).join('\n- ')}`);
  return master;
}

// ---- plan -----------------------------------------------------------------------------------------------------------------------------------

export async function plan(opts = {}) {
  const ctx = openContext(opts, 'plan');
  const base = runsBase(ctx.root);
  const stamp = opts.runId ?? makeRunId('copy-live', ctx.now());
  if (!ID_RE.test(stamp)) throw new Stop(EXIT.INVALID, `--run-id may only use letters, digits, '.', '_' and '-', got "${stamp}"`);
  let id = stamp;
  if (opts.runId !== undefined && opts.runId !== null) {
    if (existsSync(join(base, id))) throw new Stop(EXIT.INVALID, `a run folder named ${id} already exists; pick another --run-id`);
  } else for (let n = 2; existsSync(join(base, id)); n++) id = `${stamp}-${n}`;
  const dir = join(base, id);
  const client = clientFor(ctx, dir, 'plan');

  const target = await readTargets(ctx, client);
  pausedInNotion(target.agent_settings);
  const source = await readSources(ctx, client);
  const { plan: built, summary } = buildPlan({ config: ctx.config, firstPage: ctx.firstPage, source, target, overwrite: opts.overwriteEditorValues === true, runId: id, now: ctx.now });

  const checked = checkPlan(built, ctx.config, { root: ctx.root });
  if (!checked.ok) throw new Stop(EXIT.INVALID, `the plan is refused by the check and was not written:\n- ${checked.problems.slice(0, 10).join('\n- ')}${checked.problems.length > 10 ? `\n- ... and ${checked.problems.length - 10} more` : ''}`);
  const requests = countRequests(join(dir, 'requests-plan.jsonl'));
  if (requests.writes > 0) throw new Stop(EXIT.INVALID, `plan sent ${requests.writes} request(s) that are not reads; nothing may be sent by plan`);
  built.write(dir);
  writeJsonAtomic(join(dir, 'summary.json'), { ...summary, requests });

  const lines = [`copy-live plan ${id}: read ${requests.total} request(s), wrote none.`];
  for (const t of ORDER) {
    const s = summary.tables[t];
    lines.push(`  ${t.padEnd(14)} source ${String(s.source).padStart(4)}  create ${String(s.create).padStart(4)}  update ${String(s.update).padStart(4)}  same ${String(s.same).padStart(4)}${s.conflicts ? `  conflicts ${s.conflicts}` : ''}`);
  }
  lines.push(`  decisions read from the first page: ${summary.decided.rows} row(s) of ${summary.decided.claims} claim(s); row status ${Object.entries(summary.row_status).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  if (summary.conflicts.length) {
    lines.push(`  ${summary.conflicts.length} editor value(s) on v2 differ from the first page and are kept${summary.overwrite_editor_values ? '' : ' (plan again with --overwrite-editor-values to force them)'}:`);
    for (const c of summary.conflicts.slice(0, SHOWN)) lines.push(`    ${c.table} ${short(c.key, 36)} ${c.column}: v2 ${short(c.kept, 40)} / first page ${short(c.source, 40)} (${c.kind})`);
    if (summary.conflicts.length > SHOWN) lines.push(`    ... and ${summary.conflicts.length - SHOWN} more in ${join(dir, 'summary.json')}`);
  }
  for (const w of summary.warnings.slice(0, SHOWN)) lines.push(`  warning: ${w}`);
  if (summary.warnings.length > SHOWN) lines.push(`  ... and ${summary.warnings.length - SHOWN} more warnings in summary.json`);
  lines.push(`  plan: ${join(dir, 'plan.jsonl')}`, `Next: node agents/claim-tagger-mvp/scripts/copy-live.mjs apply --run ${id}`);
  return { exit: EXIT.OK, lines, id, dir, summary };
}

// ---- resolving the relations ----------------------------------------------------------------------------------------------------------------

/** The page ids the relation columns need: Rulebook name -> page id, Geo ID -> Claims page id, from the target as it is now. */
function idMaps(ctx, target) {
  const byKey = (table, keyColumn) => new Map(target[table].rows.map((r) => [text(r.props[keyColumn]).trim(), r.page_id]).filter(([k]) => k !== ''));
  return {
    rulebook: target.rulebook ? byKey('rulebook', tableEntry(ctx.config, 'rulebook').key) : new Map(),
    claims: target.claims ? byKey('claims', tableEntry(ctx.config, 'claims').key) : new Map(),
  };
}

/** The properties of an op with its relation columns turned from names into page ids; `problems` collects every name that has no page. */
function resolveProps(table, op, maps, problems) {
  const props = { ...op.properties };
  for (const [column, via] of Object.entries(RELATIONS[table] ?? {})) {
    if (!Object.hasOwn(props, column)) continue;
    props[column] = (props[column] ?? []).map((name) => {
      const id = maps[via].get(name);
      if (!id) problems.push(`${table} ${short(op.key, 40)}: ${column} names ${short(name, 40)}, which has no page in the v2 ${via === 'rulebook' ? 'Rulebook' : 'Claims'}`);
      return id ?? name;
    });
  }
  return props;
}

// ---- apply ----------------------------------------------------------------------------------------------------------------------------------

/** The Geo Sources links of the claims (pieces of the source text with their addresses), for the claims that have a link at all: a plan holds plain text only. */
async function sourceLinks(ctx, client) {
  const t = ctx.firstPage.tables.claims;
  const table = await readTable(client, t, ctx.config.notion.page_size);
  const byGeoId = new Map();
  for (const row of table.rows) {
    const geoId = text(row.props[t.key]).trim();
    const pieces = richTextPieces(row.raw?.properties?.[t.columns.sources]?.rich_text);
    if (geoId !== '' && pieces.some((p) => p.href)) byGeoId.set(geoId, pieces);
  }
  return byGeoId;
}

const joinContent = (rich) => (Array.isArray(rich) ? rich : []).map((p) => p?.text?.content ?? '').join('');

/** A client that puts the links back into Geo Sources on a create and on an update, when the pieces read as exactly the planned text. */
function linkedClient(client, byGeoId, pageToGeoId, warn) {
  const created = withLinkedSources(client, byGeoId, { column: 'Geo Sources', keyColumn: 'Geo ID', onWarning: warn });
  return {
    ...created,
    async updatePage(pageId, args) {
      const geoId = pageToGeoId.get(normId(pageId));
      const pieces = geoId ? byGeoId.get(geoId) : null;
      const planned = args?.properties?.['Geo Sources']?.rich_text;
      if (!pieces || !planned) return client.updatePage(pageId, args);
      if (joinContent(planned) !== pieces.map((p) => p.text).join('')) {
        warn(`${geoId}: the pieces of Geo Sources do not read as the planned text, so the cell is written as plain text`);
        return client.updatePage(pageId, args);
      }
      const { items } = richTextFromPieces(pieces);
      return client.updatePage(pageId, { properties: { ...args.properties, 'Geo Sources': { rich_text: items } } });
    },
  };
}

const sameOps = (a, b) => a.length === b.length && a.every((o, i) => o.op === b[i].op && o.table === b[i].table && o.key === b[i].key && (o.page_id ?? null) === (b[i].page_id ?? null));

export async function apply(opts = {}) {
  if (opts.overwriteEditorValues) throw new Stop(EXIT.INVALID, '--overwrite-editor-values belongs to plan: the plan holds what is written; make a new plan with it');
  const ctx = openContext(opts, 'apply');
  const run = pickRun(ctx, opts.run);
  const master = loadPlan(ctx, run.dir);
  const client = clientFor(ctx, run.dir, 'apply');
  const logFile = join(run.dir, 'apply.log');
  const log = (line) => appendFileSync(logFile, `${ctx.now().toISOString()} ${line}\n`);
  const warnings = [];
  pausedInNotion(await readTable(client, tableEntry(ctx.config, 'agent_settings'), ctx.config.notion.page_size));

  const lines = [`copy-live apply ${run.id}: ${master.header.plan.counts.creates} create(s) and ${master.header.plan.counts.updates} update(s) planned.`];
  const progress = [];
  let exit = EXIT.OK;
  let replan = false;
  let stage = 0;
  for (const table of ORDER) {
    const ops = master.ops.filter((o) => o.table === table);
    if (ops.length === 0) continue;
    stage += 1;
    const stageDir = join(run.dir, 'stages', `${stage}-${table}`);
    // the target as it is now: the page ids the relations need (the stages before this one made them), and the rows already there
    const needs = [table, ...new Set(Object.values(RELATIONS[table] ?? {}))];
    const fresh = await readTargets(ctx, client, needs);
    const maps = idMaps(ctx, fresh);
    const mine = fresh[table];
    const mineByPage = new Set(mine.rows.map((r) => normId(r.page_id)));
    for (const op of ops) {
      if (op.op === 'update' && !mineByPage.has(normId(op.page_id))) throw new Stop(EXIT.INVALID, `${table} ${short(op.key, 40)}: the update names a page that is not a row of the v2 table; make a new plan`);
    }

    let stagePlan;
    if (existsSync(join(stageDir, 'plan.jsonl'))) {
      stagePlan = readPlan(stageDir); // a stage that was started: its plan is the record of what was sent
      if (!sameOps(stagePlan.ops, ops)) throw new Stop(EXIT.INVALID, `the stage plan in ${stageDir} does not belong to this plan`);
    } else {
      const problems = [];
      const built = newPlan({ runId: `${run.id}-${stage}-${table}`, script: COPY_LIVE_SCRIPT, rubricEdition: null, config: ctx.config, now: ctx.now });
      for (const op of ops) {
        const properties = resolveProps(table, op, maps, problems);
        if (op.op === 'create') built.create(table, op.key, properties);
        else built.update(table, op.key, op.page_id, properties, op.expect ? { expect: op.expect } : {});
      }
      if (problems.length) throw new Stop(EXIT.INVALID, `stage ${table} cannot be sent, because:\n- ${problems.slice(0, 10).join('\n- ')}${problems.length > 10 ? `\n- ... and ${problems.length - 10} more` : ''}`);
      mkdirSync(stageDir, { recursive: true });
      built.write(stageDir);
      stagePlan = readPlan(stageDir);
    }

    let sender = client;
    if (table === 'claims') {
      const links = await sourceLinks(ctx, client);
      const pageToGeoId = new Map(stagePlan.ops.filter((o) => o.op === 'update').map((o) => [normId(o.page_id), o.key]));
      sender = linkedClient(client, links, pageToGeoId, (w) => {
        warnings.push(w);
        log(`warning: ${w}`);
      });
    }
    const pulled = { [table]: new Map(mine.rows.map((r) => [text(r.props[tableEntry(ctx.config, table).key]).trim(), { page_id: r.page_id, ...r.props }])) };
    let result;
    try {
      result = await applyPlan({
        plan: stagePlan, dir: stageDir, client: sender, config: ctx.config, schemas: { [table]: mine.schema }, pulled, root: ctx.root, now: ctx.now, log: (l) => log(`${table}: ${l}`),
      });
    } catch (e) {
      if (e instanceof PlanError) throw new Stop(EXIT.INVALID, `${table}: ${e.message}${e.problems?.length ? `:\n- ${e.problems.slice(0, 10).join('\n- ')}` : ''}`);
      throw e;
    }
    const made = Object.keys(result.created_by_table[table] ?? {}).length;
    const skippedExpect = result.lists.skipped.filter((s) => /skipped: expect/.test(s.detail ?? '')).length;
    const skippedExists = result.lists.skipped.length - skippedExpect;
    progress.push({ table, stage, code: result.code, ops: stagePlan.ops.length, done: result.done, created: made, already_done: result.already_done, failed: result.failed, uncertain: result.uncertain, unchecked: result.unchecked, mismatches: result.mismatches, pending: result.pending, skipped_expect: skippedExpect, skipped_exists: skippedExists });
    writeJsonAtomic(join(run.dir, 'apply.json'), { run_id: run.id, stages: progress, warnings });
    lines.push(`  ${table.padEnd(14)} ${result.done}/${stagePlan.ops.length} done (${made} created in all, ${result.already_done} already done before this start)${result.skipped ? `, ${skippedExpect} skipped because the row changed since the plan, ${skippedExists} skipped because the row exists` : ''}${result.failed + result.uncertain + result.unchecked + result.pending + result.mismatches ? `, NOT FINISHED: ${result.failed} failed, ${result.uncertain} uncertain, ${result.unchecked} not read back, ${result.pending} not reached, ${result.mismatches} read-back differences` : ''}`);
    if (result.code !== EXIT.OK) {
      exit = result.code;
      const first = [...result.lists.failed, ...result.lists.uncertain, ...result.lists.unchecked, ...result.lists.mismatches][0];
      if (first) lines.push(`    first problem: ${short(first.key, 40)} ${first.detail ?? ''}`);
      lines.push(result.code === EXIT.INVALID ? `Next: the read-back differs; look at ${join(stageDir, 'ledger.jsonl')}.` : `Next: run the same command again; it continues where it stopped (nothing done is sent twice).`);
      break;
    }
    if (skippedExpect > 0) replan = true;
  }
  for (const w of warnings.slice(0, SHOWN)) lines.push(`  warning: ${w}`);
  if (exit === EXIT.OK && replan) {
    exit = EXIT.ERROR;
    lines.push('Next: make a new plan (copy-live.mjs plan), because a row changed since this one was made; the rows that were skipped are in the ledgers of the stages.');
  } else if (exit === EXIT.OK) lines.push(`Next: node agents/claim-tagger-mvp/scripts/copy-live.mjs check --run ${run.id}`);
  return { exit, lines, id: run.id };
}

// ---- check ----------------------------------------------------------------------------------------------------------------------------------

export async function check(opts = {}) {
  if (opts.overwriteEditorValues) throw new Stop(EXIT.INVALID, '--overwrite-editor-values belongs to plan');
  const ctx = openContext(opts, 'check');
  const run = pickRun(ctx, opts.run);
  const master = loadPlan(ctx, run.dir);
  const client = clientFor(ctx, run.dir, 'check');
  const target = await readTargets(ctx, client);
  const maps = idMaps(ctx, target);
  const byKey = Object.fromEntries(ORDER.map((t) => [t, new Map(target[t].rows.map((r) => [text(r.props[tableEntry(ctx.config, t).key]).trim(), r]))]));
  const problems = [];
  const checked = Object.fromEntries(ORDER.map((t) => [t, 0]));
  const differ = [];
  for (const op of master.ops) {
    const row = byKey[op.table].get(op.key);
    if (!row) {
      problems.push(`${op.table} ${short(op.key, 40)}: there is no such row in v2`);
      continue;
    }
    const wanted = resolveProps(op.table, op, maps, problems);
    const diffs = compareWritten(wanted, row.props, target[op.table].schema);
    checked[op.table] += 1;
    for (const d of diffs) differ.push(`${op.table} ${short(op.key, 40)} ${d.column}: planned ${short(d.wrote, 40)}, found ${short(d.found, 40)}`);
  }
  const all = [...problems, ...differ];
  const lines = [`copy-live check ${run.id}: ${master.ops.length} planned row(s) read back from v2 (${ORDER.map((t) => `${t} ${checked[t]}`).join(', ')}).`];
  if (all.length === 0) lines.push('Every planned value is in v2.');
  else {
    lines.push(`${all.length} difference(s):`, ...all.slice(0, 10).map((p) => `  ${p}`));
    if (all.length > 10) lines.push(`  ... and ${all.length - 10} more`);
    lines.push('Next: run apply again (a row that changed since the plan needs a new plan).');
  }
  writeJsonAtomic(join(run.dir, 'check.json'), { run_id: run.id, checked, differences: all });
  return { exit: all.length === 0 ? EXIT.OK : EXIT.INVALID, lines, id: run.id };
}

// ---- the command line -----------------------------------------------------------------------------------------------------------------------

const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Parse the command line and run; returns the exit code. deps (tests): root, fetchImpl, token, sleep, now, client. */
export async function main(argv, io = consoleIo, deps = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { 'run-id': { type: 'string' }, run: { type: 'string' }, 'overwrite-editor-values': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
      strict: true,
      allowPositionals: true,
    });
  } catch (e) {
    io.err(`copy-live: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  const command = positionals[0];
  if (positionals.length !== 1 || !['plan', 'apply', 'check'].includes(command)) {
    io.err(`copy-live: expected one of plan, apply, check\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (command === 'plan' && values.run !== undefined) {
    io.err(`copy-live: --run belongs to apply and check\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (command !== 'plan' && values['run-id'] !== undefined) {
    io.err(`copy-live: --run-id belongs to plan\n${USAGE}`);
    return EXIT.INVALID;
  }
  const opts = { ...deps, runId: values['run-id'], run: values.run, overwriteEditorValues: values['overwrite-editor-values'] === true };
  try {
    const result = await { plan, apply, check }[command](opts);
    for (const line of result.lines) io.out(line);
    return result.exit;
  } catch (e) {
    if (e instanceof Stop) {
      io.err(`copy-live ${command}: ${e.message}`);
      return e.code;
    }
    if (e instanceof PlanError) {
      io.err(`copy-live ${command}: ${e.message}${e.problems?.length ? `:\n- ${e.problems.slice(0, 10).join('\n- ')}` : ''}`);
      return EXIT.INVALID;
    }
    io.err(`copy-live ${command}: unexpected error: ${e?.stack ?? e?.message ?? e}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
