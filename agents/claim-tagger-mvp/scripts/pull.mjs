#!/usr/bin/env node
// Pull: read the agent's tables from Notion into a local copy, plus the one read-only dry run of the real claims table and the pick of 50 claims.
// Nothing here writes Notion. Every request goes through lib/notion-rest.mjs and is logged to a requests.jsonl next to the files it produced.
//
//   node agents/claim-tagger-mvp/scripts/pull.mjs --all | --tables <a,b> [--pull-id <id>]
//   node agents/claim-tagger-mvp/scripts/pull.mjs --source real_claims --dry-run [--run-id <id>]
//   node agents/claim-tagger-mvp/scripts/pull.mjs --source real_claims --pick 50 --seed <string> --audit <audit json> [--from <dry-run id>]
//
// The tables are rulebook, claims_copy, tag_decisions, rule_changes and agent_settings (aliases: claims, queue, lessons, settings). A table whose
// id in config.json is still a placeholder ("<setup>") or missing is skipped and listed in pull.json; a pull that reads no table at all does not
// become runs/pull/LATEST. A pull of a paused agent completes: pull.json and the result say `paused`, and the caller decides.
//
// runs/pull/<pull-id>/
//   schema/<table>.json   the retrieveDatabase answer          raw/<table>.jsonl   every page object, one per line
//   norm/claims.jsonl     { table, geo_id, page_id, notion_url, claim, geo_url, sources_text, source_links [{ text, href }], is_factual, agent_tags, agent_notes,
//                           agent_confidence (a number or null), agent_reasons (text), verified_tags (Claim quality tags — verified as tag names), review_status (To review, Reviewed
//                           or null), why_wrong (or null), challenged_notes (text), last_edited }
//                         The relation is resolved to names through the page ids of the Rulebook copy's rows (this pull's, else the ones in rubric/rubric.json);
//                         an id that names no tag of the rulebook is left out and said in a warning.
//   norm/rulebook.json    [ { <every column by its Notion name>, page_id } ] for the rows that carry the work tag (config notion.rulebook.work_tag)
//   norm/queue.jsonl      the thirteen columns of Tag decisions (the agent's ledger) by their Notion names + page_id, last_edited, decided (Tag outcome is set)
//   norm/lessons.jsonl    the ten columns of Rule changes + page_id, created, supporting_keys (the trailing <geo_id>::<tag> of each Supporting rows line)
//   norm/settings.json    { page_id, name, paused, rulebook_edition, last_run_summary }
//   drift.json            computeDrift(lock, rulebook rows), or { skipped: ... }        requests.jsonl   the request log       pull.json   the manifest
// and evals/cases.jsonl is rewritten from the decided ledger rows whenever tag_decisions is pulled. The decision itself is the editor's, made on the claim
// (CLAIMS-REVIEW.md, section 2); decisionsFor (lib/decisions.mjs, exported here too) derives it for every judged tag, and propose copies it to the ledger.
//
// runs/dry-run/<run-id>/ (--dry-run): schema.json, rows.jsonl (one plain row per page: every column by its Notion name, plus page_id, url,
// last_edited_time, source_links, source_pieces), report.json, report.md, requests.jsonl. The client behind it cannot send a write, and the run ends
// by counting the request log: writes must be 0.
//
// setup/claims-pick.json (--pick): { seed, picked_at, dry_run, audit_ids, random_ids, rows }, the ten audit claims first, then the random ones.
//
// Exit codes: 0 ok, 1 unexpected error (also: a dry run whose request log shows a write), 2 invalid (usage, no token, a duplicate key in a table,
// a missing key column, a pick that cannot be made, Notion refused).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { TABLES, isProtected, loadConfig, tableEntry } from './lib/config.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { readJson, readJsonl, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { BUILDER_API_VERSION, clientFromConfig, countRequests, requestLogger } from './lib/notion-rest.mjs';
import { decodePage, normId } from './lib/notion-values.mjs';
import { agentRoot, codeFile, isMain, repoRoot as defaultRepoRoot, runId as makeRunId, safeName } from './lib/paths.mjs';
import { compareCodePoints } from './lib/pyjson.mjs';
import { mulberry32, sample, seedFromString } from './lib/rng.mjs';
import { computeDrift, readLock, readRubric } from './lib/rubric.mjs';
import { claimWaits, decisionsFor, disagreementsIn, isReviewed, parseTagNotes, waitsForEditor } from './lib/decisions.mjs';
import { validate } from './lib/validate.mjs';

export { claimWaits, decisionsFor, disagreementsIn, isReviewed, parseTagNotes, waitsForEditor };

export const USAGE = [
  'usage: node agents/claim-tagger-mvp/scripts/pull.mjs --all | --tables <rulebook,claims_copy,tag_decisions,rule_changes,agent_settings> [--pull-id <id>]',
  '       node agents/claim-tagger-mvp/scripts/pull.mjs --source real_claims --dry-run [--run-id <id>]',
  '       node agents/claim-tagger-mvp/scripts/pull.mjs --source real_claims --pick 50 --seed <string> --audit <audit json> [--from <dry-run id>]',
].join('\n');

class UsageError extends Error {}

const NORM_FILES = Object.freeze({
  rulebook: 'rulebook.json', claims_copy: 'claims.jsonl', tag_decisions: 'queue.jsonl', rule_changes: 'lessons.jsonl', agent_settings: 'settings.json',
});
const ALIASES = Object.freeze({
  claims: 'claims_copy', queue: 'tag_decisions', decisions: 'tag_decisions', lessons: 'rule_changes', settings: 'agent_settings',
});
export const QUEUE_COLUMNS = Object.freeze([
  'Claim', 'Key', 'Tag', 'Agent proposal', 'Agent confidence', 'Agent reason', 'Claim link', 'Rulebook edition', 'Follow-up', 'Tag outcome', 'Why wrong', 'Your reasoning',
  'Decided under',
]);
export const LESSON_COLUMNS = Object.freeze([
  'Lesson', 'Tag', 'Rule', 'Kind', 'Current text', 'Proposed text', 'Safety check result', 'Supporting rows', 'Editor wording', 'Status',
]);
const SETTINGS_COLUMNS = Object.freeze(['Name', 'Paused', 'Rulebook edition', 'Last run summary']);
const AUDIT_PREFIX = 'From the audit of 9 October';

// ---- small helpers -------------------------------------------------------------------------------------------------------------

const rowSchemas = new Map();
function rowSchema(name) {
  const file = codeFile(agentRoot(), 'schemas', `${name}.schema.json`);
  if (!rowSchemas.has(file)) rowSchemas.set(file, readJson(file));
  return rowSchemas.get(file);
}

const isSet = (id) => typeof id === 'string' && id.trim() !== '' && !id.trim().startsWith('<');
const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const byCodePoints = (a, b) => compareCodePoints(String(a), String(b));
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
const shorten = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const pullBase = (root) => join(root, 'runs', 'pull');
const dryBase = (root) => join(root, 'runs', 'dry-run');

function safeEntry(config, table) {
  try {
    return tableEntry(config, table);
  } catch {
    return null;
  }
}

/** A plain row of a decoded page: every column by its Notion name (a date's end as "<name>:end"), plus page_id, url and last_edited_time. */
function plainRow(d) {
  return { ...d.props, page_id: d.page_id, url: d.url, last_edited_time: d.last_edited_time };
}

// ---- links in rich text --------------------------------------------------------------------------------------------------------

const MARKDOWN_LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL = /https?:\/\/[^\s<>()[\]"']+/g;
const trimUrl = (u) => u.replace(/[.,;:!?]+$/, '');
const pieceText = (p) => p?.plain_text ?? p?.text?.content ?? '';
const pieceHref = (p) => p?.href ?? p?.text?.link?.url ?? null;

/** Every piece of a Notion rich-text array as { text, href } (href null when the piece carries no link), in order. */
export function richTextPieces(richText) {
  return (Array.isArray(richText) ? richText : []).map((p) => ({ text: pieceText(p), href: pieceHref(p) }));
}

/**
 * The links of a Notion rich-text array: [{ text, href }] for every piece that carries a link, neighbouring pieces of the same link merged
 * (Notion splits one link in several pieces when part of it is bold), a repeated address kept once.
 */
export function richTextLinks(richText) {
  const links = [];
  let run = null;
  const close = () => {
    if (run && !links.some((l) => l.href === run.href)) links.push({ text: run.text.trim(), href: run.href });
    run = null;
  };
  for (const piece of richTextPieces(richText)) {
    if (piece.href && run && run.href === piece.href) run.text += piece.text;
    else {
      close();
      if (piece.href) run = { href: piece.href, text: piece.text };
    }
  }
  close();
  return links;
}

/**
 * The links of a Geo Sources cell: [{ text, href, form }], in order, each address once. `form` says how the link was written in the cell:
 * "rich_text" (a real link on the text), "markdown" ([title](address) written out as text) or "bare" (an address typed as text).
 * Without a rich-text array the plain text is read the same way.
 */
export function geoSourceLinks(richText, plain = null) {
  const out = [];
  const add = (linkText, href, form) => {
    if (!out.some((l) => l.href === href)) out.push({ text: linkText.trim(), href, form });
  };
  const fromText = (t) => {
    for (const m of t.matchAll(MARKDOWN_LINK)) add(m[1], m[2], 'markdown');
    for (const m of t.replace(MARKDOWN_LINK, ' ').matchAll(BARE_URL)) add('', trimUrl(m[0]), 'bare');
  };
  const pieces = richTextPieces(richText);
  if (pieces.length === 0 && typeof plain === 'string') {
    fromText(plain);
    return out;
  }
  let run = null;
  const close = () => {
    if (run) add(run.text, run.href, 'rich_text');
    run = null;
  };
  for (const piece of pieces) {
    if (piece.href) {
      if (run && run.href === piece.href) run.text += piece.text;
      else {
        close();
        run = { href: piece.href, text: piece.text };
      }
    } else {
      close();
      fromText(piece.text);
    }
  }
  close();
  return out;
}

/** The keys named at the end of the lines of a Supporting rows cell ("<claim shortened> · <geo_id>::<tag>"), each once, in order. */
export function supportingKeys(value) {
  const keys = [];
  for (const raw of text(value).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.lastIndexOf(' · ');
    const candidate = (at >= 0 ? line.slice(at + 3) : line).trim();
    if (/^[^\s:]+::\S[^\n]*$/.test(candidate) && !keys.includes(candidate)) keys.push(candidate);
  }
  return keys;
}

// ---- reading a pull back ---------------------------------------------------------------------------------------------------------

const pullDir = (root, id) => join(pullBase(root), safeName(id));

/**
 * The id of the newest pull (the content of runs/pull/LATEST), or null. With `needs` (table names, aliases allowed) it is the newest pull that
 * holds all of those tables, so a partial pull never stands in for a full one.
 */
export function latestPullId(root = agentRoot(), needs = []) {
  const base = pullBase(root);
  if (!existsSync(base)) return null;
  if (needs.length === 0) {
    const file = join(base, 'LATEST');
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, 'utf8');
    const id = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).trim();
    return id === '' ? null : id;
  }
  const wanted = needs.map((n) => ALIASES[n] ?? n);
  const found = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const file = join(base, d.name, 'pull.json');
    if (!existsSync(file)) return null;
    try {
      const info = readJson(file);
      return wanted.every((t) => info.tables?.includes(t)) ? { id: d.name, at: String(info.taken_at ?? '') } : null;
    } catch {
      return null;
    }
  }).filter(Boolean).sort((a, b) => byCodePoints(b.at, a.at) || byCodePoints(b.id, a.id));
  return found[0]?.id ?? null;
}


/**
 * A pull on disk, read lazily. info (pull.json), tables, covers(table), schema(table), pages(table) (the raw page objects), plainRows(table)
 * (every column by its Notion name + page_id, url, last_edited_time), byKey(table) (key -> plain row: what applyPlan takes as `pulled[table]`),
 * pulled(tables) (that for several tables), and the norm files: claims(), rulebook(), queue(), lessons(), settings(), drift().
 */
export function loadPull(root = agentRoot(), id = latestPullId(root), { config = null } = {}) {
  if (!id) throw new Error('no pull yet: run pull.mjs first');
  const dir = pullDir(root, id);
  const infoFile = join(dir, 'pull.json');
  if (!existsSync(infoFile)) throw new Error(`pull "${id}" does not exist (${infoFile})`);
  const info = readJson(infoFile);
  const cache = new Map();
  const memo = (k, fn) => {
    if (!cache.has(k)) cache.set(k, fn());
    return cache.get(k);
  };
  const cfg = () => config ?? loadConfig(root);
  const norm = (name, asJson = false) => memo(`norm:${name}`, () => {
    const file = join(dir, 'norm', name);
    if (!existsSync(file)) return null;
    return asJson ? readJson(file) : readJsonl(file).rows;
  });
  const api = {
    id,
    dir,
    info,
    tables: info.tables ?? [],
    covers: (table) => (info.tables ?? []).includes(ALIASES[table] ?? table),
    schema: (table) => memo(`schema:${table}`, () => (existsSync(join(dir, 'schema', `${table}.json`)) ? readJson(join(dir, 'schema', `${table}.json`)) : null)),
    pages: (table) => memo(`pages:${table}`, () => readJsonl(join(dir, 'raw', `${table}.jsonl`)).rows),
    decoded: (table) => memo(`decoded:${table}`, () => api.pages(table).map((page) => decodePage(page, api.schema(table)))),
    plainRows: (table) => memo(`plain:${table}`, () => api.decoded(table).map(plainRow)),
    byKey: (table) => memo(`bykey:${table}`, () => {
      const keyColumn = safeEntry(cfg(), table)?.key;
      const found = new Map();
      // a repeated key maps to its oldest row
      const oldestFirst = [...api.decoded(table)].sort((x, y) => byCodePoints(x.created_time ?? '', y.created_time ?? '') || byCodePoints(x.page_id, y.page_id));
      for (const d of oldestFirst) {
        const key = text(d.props[keyColumn]).trim();
        if (key !== '' && !found.has(key)) found.set(key, plainRow(d));
      }
      return Object.fromEntries([...found].sort(([a], [b]) => byCodePoints(a, b)));
    }),
    pulled: (tables = api.tables) => Object.fromEntries(tables.map((t) => [t, api.byKey(t)])),
    claims: () => norm('claims.jsonl'),
    rulebook: () => norm('rulebook.json', true),
    queue: () => norm('queue.jsonl'),
    lessons: () => norm('lessons.jsonl'),
    settings: () => norm('settings.json', true),
    drift: () => memo('drift', () => (existsSync(join(dir, 'drift.json')) ? readJson(join(dir, 'drift.json')) : null)),
  };
  return api;
}

// ---- normalising ---------------------------------------------------------------------------------------------------------------

function indexRows(table, keyColumn, decoded) {
  const groups = new Map();
  const empty = [];
  for (const row of decoded) {
    const key = text(row.props[keyColumn]).trim();
    if (key === '') {
      empty.push(row.page_id);
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const rows = [];
  const duplicates = [];
  for (const key of [...groups.keys()].sort(byCodePoints)) {
    const group = groups.get(key).sort((a, b) => byCodePoints(a.created_time ?? '', b.created_time ?? '') || byCodePoints(a.page_id, b.page_id));
    rows.push({ key, row: group[0] });
    if (group.length > 1) duplicates.push({ table, key, page_ids: group.map((r) => r.page_id) });
  }
  return { rows, duplicates, empty };
}

const numberOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// page id (dashes and case ignored) -> tag name: from the rows of the Rulebook copy this pull read, else from the pages of the rulebook edition in force
function tagNamesById(config, decodedRulebook, root) {
  const byId = new Map();
  if (decodedRulebook) {
    const key = safeEntry(config, 'rulebook')?.key || 'Name';
    for (const row of decodedRulebook) {
      const name = text(row.props[key]).trim();
      if (name !== '') byId.set(normId(row.page_id), name);
    }
  } else {
    try {
      for (const t of readRubric(root)?.tags ?? []) if (t.page_id && t.name) byId.set(normId(t.page_id), t.name);
    } catch {
      // no edition yet, or a rulebook file that fails its own checks: the caller's preflight says so; the relation stays unresolved
    }
  }
  return byId;
}

function claimsNorm(entry, table, decoded, pagesById, warnings, tagNames = new Map()) {
  const keyColumn = entry.key;
  const cols = entry.columns ?? {};
  const writeCols = entry.write_columns ?? {};
  const { rows, duplicates, empty } = indexRows(table, keyColumn, decoded);
  if (empty.length) warnings.push(`${table}: ${empty.length} row(s) without a ${keyColumn} were left out of the norm file`);
  let unresolved = 0;
  const out = rows.map(({ key, row }) => {
    const p = row.props;
    const raw = pagesById.get(normId(row.page_id));
    const links = geoSourceLinks(raw?.properties?.[cols.sources]?.rich_text, text(p[cols.sources]));
    const verified = [];
    for (const id of Array.isArray(p[cols.verified]) ? p[cols.verified] : []) {
      const name = tagNames.get(normId(id));
      if (name === undefined) unresolved += 1;
      else if (!verified.includes(name)) verified.push(name);
    }
    return {
      table: entry.name ?? table,
      geo_id: key,
      page_id: row.page_id,
      notion_url: row.url ?? null,
      claim: text(p[cols.claim]),
      geo_url: p[cols.link] ?? null,
      sources_text: text(p[cols.sources]),
      source_links: links.map(({ text: t, href }) => ({ text: t, href })),
      is_factual: p[cols.is_factual] ?? null,
      agent_tags: text(p[writeCols.tags]),
      agent_notes: text(p[writeCols.notes]),
      agent_confidence: numberOrNull(p[writeCols.confidence]),
      agent_reasons: text(p[writeCols.reasons]),
      verified_tags: verified.sort(byCodePoints),
      review_status: text(p[cols.review_status]).trim() || null,
      why_wrong: text(p[cols.why_wrong]).trim() || null,
      challenged_notes: text(p[cols.notes]),
      last_edited: row.last_edited_time ?? null,
    };
  });
  if (unresolved) warnings.push(`${table}: ${unresolved} reference(s) in ${cols.verified} name no tag of the rulebook (their page ids are not among the Rulebook copy's rows), so they were left out`);
  return { out, duplicates };
}

function queueNorm(entry, table, decoded, warnings) {
  const { rows, duplicates, empty } = indexRows(table, entry.key, decoded);
  if (empty.length) warnings.push(`${table}: ${empty.length} row(s) without a ${entry.key} were left out of the norm file`);
  const out = rows.map(({ row }) => {
    const base = {};
    for (const column of QUEUE_COLUMNS) base[column] = row.props[column] ?? null;
    const outcome = text(row.props['Tag outcome']).trim();
    return { ...base, page_id: row.page_id, last_edited: row.last_edited_time ?? null, decided: outcome !== '' };
  });
  return { out, duplicates };
}

function lessonsNorm(entry, table, decoded, warnings) {
  const { rows, duplicates, empty } = indexRows(table, entry.key, decoded);
  if (empty.length) warnings.push(`${table}: ${empty.length} row(s) without a ${entry.key} were left out of the norm file`);
  const out = rows.map(({ row }) => {
    const base = {};
    for (const column of LESSON_COLUMNS) base[column] = row.props[column] ?? null;
    return { ...base, page_id: row.page_id, created: row.created_time ?? null, supporting_keys: supportingKeys(row.props['Supporting rows']) };
  });
  return { out, duplicates };
}

function rulebookNorm(entry, table, decoded, warnings) {
  const { rows, duplicates, empty } = indexRows(table, entry.key, decoded);
  if (empty.length) warnings.push(`${table}: ${empty.length} row(s) without a ${entry.key} were left out of the norm file`);
  const workTag = entry.work_tag;
  const kept = rows.filter(({ row }) => !workTag || (Array.isArray(row.props['Work tags']) && row.props['Work tags'].includes(workTag)));
  if (workTag && kept.length < rows.length) warnings.push(`${table}: ${rows.length - kept.length} row(s) without the work tag "${workTag}" were left out of the rulebook`);
  return { out: kept.map(({ row }) => ({ ...row.props, page_id: row.page_id })), duplicates };
}

function settingsNorm(config, entry, decoded, warnings) {
  const keyColumn = entry.key || 'Name';
  const rows = decoded.filter((r) => text(r.props[keyColumn]).trim() !== '');
  const row = rows.find((r) => r.props[keyColumn] === config.agent) ?? rows[0] ?? null;
  if (!row) warnings.push('agent_settings: no row yet, so Paused cannot be read (it is treated as not paused)');
  else if (rows.length > 1) warnings.push(`agent_settings: ${rows.length} rows; the one named "${config.agent}", else the first, is used`);
  const p = row?.props ?? {};
  return {
    page_id: row?.page_id ?? null,
    name: row ? text(p[keyColumn]) : null,
    paused: p.Paused === true,
    rulebook_edition: text(p['Rulebook edition']).trim() || null,
    last_run_summary: text(p['Last run summary']).trim() || null,
  };
}

/** The earlier decisions, from the decided queue rows: evals/cases.jsonl (CONTRACTS section 4). */
function casesFrom(queueRows) {
  const seen = new Set();
  const out = [];
  for (const r of queueRows) {
    if (!r.decided || text(r.Key).trim() === '' || seen.has(r.Key)) continue;
    seen.add(r.Key);
    out.push({
      key: r.Key,
      tag: r.Tag,
      claim: r.Claim,
      outcome: r['Tag outcome'],
      why_wrong: r['Why wrong'] ?? null,
      decided_edition: text(r['Rulebook edition']).trim() || null,
      source: text(r['Your reasoning']).startsWith(AUDIT_PREFIX) ? 'audit of 9 October' : 'queue',
    });
  }
  return out;
}

// What a table must have to be read at all (the key) and what its norm file fills from (a missing one is a warning, the norm file holds null).
function expectedColumns(table, entry) {
  switch (table) {
    case 'rulebook': return [entry.key, 'When to use', 'Work tags'];
    case 'claims_copy': return [entry.key, ...Object.values(entry.columns ?? {}), ...Object.values(entry.write_columns ?? {})];
    case 'tag_decisions': return [...QUEUE_COLUMNS];
    case 'rule_changes': return [...LESSON_COLUMNS];
    default: return [...SETTINGS_COLUMNS];
  }
}

// A folder id for a new pull or dry run: the one asked for (it must be new), else the stamp of `now`, with -2, -3 ... when that stamp is taken.
function freshId(base, asked, exists, label, flag) {
  if (asked) {
    const id = safeName(asked);
    if (exists(id)) throw new UsageError(`${label} "${id}" already exists; choose another ${flag}`);
    return id;
  }
  let id = safeName(base);
  for (let n = 2; exists(id); n++) id = `${safeName(base)}-${n}`;
  return id;
}

// Notion cuts a title or rich-text value at 25 pieces in a page object. A value that long may be longer: read it whole from the property item.
const CUT_AT = 25;
async function completeLongText(client, pages, column) {
  let completed = 0;
  for (const page of pages) {
    const value = page.properties?.[column];
    if (value?.type !== 'rich_text' || !Array.isArray(value.rich_text) || value.rich_text.length < CUT_AT) continue;
    const full = (await client.retrievePropertyItem(page.id, value.id)).map((item) => item.rich_text).filter(Boolean);
    if (full.length > value.rich_text.length) {
      value.rich_text = full;
      completed += 1;
    }
  }
  return completed;
}

// ---- the pull ------------------------------------------------------------------------------------------------------------------

/** The tables a pull is asked for: canonical names, aliases resolved, order of TABLES, each once. */
export function tablesFor(names) {
  if (names === 'all') return [...TABLES];
  const wanted = new Set();
  const unknown = [];
  for (const raw of names) {
    const name = ALIASES[raw] ?? raw;
    if (TABLES.includes(name)) wanted.add(name);
    else unknown.push(raw);
  }
  if (unknown.length || wanted.size === 0) throw new UsageError(`unknown table name(s): ${unknown.join(', ') || '(none given)'}; choose from ${TABLES.join(', ')}`);
  return TABLES.filter((t) => wanted.has(t));
}

/**
 * Read the tables and write the files described at the top of this file. Returns { code, pullId, dir, tables, skipped, counts, duplicates,
 * problems, paused, warnings, drift, line }. `client` (tests) replaces the client built from config.json and .env; null means "no token".
 * Otherwise the client is built here with a request log in the pull folder; `fetchImpl`, `token`, `repoRoot` and `sleep` are test hooks.
 */
export async function pull({
  root = agentRoot(), config = loadConfig(root), client, tables = 'all', pullId, now = () => new Date(), fetchImpl, token, repoRoot, sleep,
} = {}) {
  const wanted = tablesFor(tables);
  const skipped = [];
  const targets = [];
  for (const table of wanted) {
    const entry = safeEntry(config, table);
    if (!entry) skipped.push({ table, reason: 'config.json has no entry for this table' });
    else if (!isSet(entry.database_id)) skipped.push({ table, reason: 'not created yet (the id in config.json is a placeholder)' });
    else if (isProtected(config, entry.database_id) || isProtected(config, entry.data_source_id)) throw new UsageError(`${table} is on the protected list in config.json; refusing to read it as one of the agent's tables`);
    else targets.push({ table, entry });
  }
  const id = freshId(makeRunId('pull', now()), pullId, (x) => existsSync(join(pullDir(root, x), 'pull.json')), 'pull', '--pull-id');
  const dir = pullDir(root, id);
  const takenAt = now().toISOString();
  const pageSize = config.notion?.page_size ?? 100;

  let notion = client;
  if (targets.length > 0 && notion === undefined) {
    notion = clientFromConfig(config, { fetchImpl, token, repoRoot: repoRoot ?? defaultRepoRoot(), sleep, log: requestLogger(join(dir, 'requests.jsonl')) });
  }
  if (targets.length > 0 && !notion) throw new UsageError('there is no NOTION_TOKEN in .env, so Notion cannot be read by script');

  mkdirSync(join(dir, 'schema'), { recursive: true });
  mkdirSync(join(dir, 'raw'), { recursive: true });
  mkdirSync(join(dir, 'norm'), { recursive: true });

  const warnings = [];
  const problems = [];
  const duplicates = [];
  const counts = {};
  const decoded = {};
  const pagesById = {};
  const pulledTables = [];
  for (const { table, entry } of targets) {
    const schema = await notion.retrieveDatabase(entry.database_id);
    writeJsonAtomic(join(dir, 'schema', `${table}.json`), schema);
    const pages = await notion.queryAll(entry.database_id, { pageSize });
    if (table === 'claims_copy' && entry.columns?.sources) await completeLongText(notion, pages, entry.columns.sources);
    writeTextAtomic(join(dir, 'raw', `${table}.jsonl`), jsonl(pages));
    pulledTables.push(table);
    counts[table] = pages.length;
    const have = schema?.properties ?? {};
    if (!have[entry.key]) {
      problems.push(`${table}: the key column "${entry.key}" is not in the table, so its rows cannot be told apart`);
      continue;
    }
    for (const column of expectedColumns(table, entry)) {
      if (!have[column]) warnings.push(`${table}: the column "${column}" is not in the table (the norm file holds null for it)`);
    }
    decoded[table] = pages.map((p) => decodePage(p, schema));
    pagesById[table] = new Map(pages.map((p) => [normId(p.id), p]));
  }

  const norm = (name) => join(dir, 'norm', name);
  let rulebookRows = null;
  let queueRows = null;
  let paused = false;
  if (decoded.rulebook) {
    const { out, duplicates: d } = rulebookNorm(safeEntry(config, 'rulebook'), 'rulebook', decoded.rulebook, warnings);
    duplicates.push(...d);
    rulebookRows = out;
    writeJsonAtomic(norm(NORM_FILES.rulebook), out);
  }
  if (decoded.claims_copy) {
    const { out, duplicates: d } = claimsNorm(safeEntry(config, 'claims_copy'), 'claims_copy', decoded.claims_copy, pagesById.claims_copy, warnings, tagNamesById(config, decoded.rulebook, root));
    duplicates.push(...d);
    for (const row of out) {
      const bad = validate(rowSchema('claim-row'), row).errors;
      if (bad.length) warnings.push(`claims_copy: the claim ${row.geo_id} does not fit schemas/claim-row.schema.json (${bad.slice(0, 2).join('; ')})`);
    }
    writeTextAtomic(norm(NORM_FILES.claims_copy), jsonl(out));
  }
  if (decoded.tag_decisions) {
    const { out, duplicates: d } = queueNorm(safeEntry(config, 'tag_decisions'), 'tag_decisions', decoded.tag_decisions, warnings);
    duplicates.push(...d);
    for (const row of out) {
      const bad = validate(rowSchema('ledger-row'), row).errors;
      if (bad.length) warnings.push(`tag_decisions: the row ${row.Key} does not fit schemas/ledger-row.schema.json (${bad.slice(0, 2).join('; ')})`);
    }
    queueRows = out;
    writeTextAtomic(norm(NORM_FILES.tag_decisions), jsonl(out));
  }
  if (decoded.rule_changes) {
    const { out, duplicates: d } = lessonsNorm(safeEntry(config, 'rule_changes'), 'rule_changes', decoded.rule_changes, warnings);
    duplicates.push(...d);
    writeTextAtomic(norm(NORM_FILES.rule_changes), jsonl(out));
  }
  if (decoded.agent_settings) {
    const settings = settingsNorm(config, safeEntry(config, 'agent_settings'), decoded.agent_settings, warnings);
    paused = settings.paused;
    writeJsonAtomic(norm(NORM_FILES.agent_settings), settings);
  }

  // the earlier decisions follow the queue
  let cases = null;
  if (queueRows) {
    const rows = casesFrom(queueRows);
    cases = rows.length;
    writeTextAtomic(join(root, 'evals', 'cases.jsonl'), jsonl(rows.sort((a, b) => byCodePoints(a.key, b.key))));
  }

  // drift: the Rulebook copy against the lock
  let drift;
  if (!existsSync(join(root, 'rubric', 'rubric.lock'))) drift = { skipped: 'no lock' };
  else if (!rulebookRows) drift = { skipped: 'the rulebook was not pulled' };
  else {
    try {
      const lock = readLock(root);
      drift = lock === null ? { skipped: 'no lock' } : computeDrift(lock, rulebookRows, { config });
    } catch (e) {
      drift = { skipped: 'the check could not run', error: e.message };
      warnings.push(`drift: the check could not run (${e.message})`);
    }
  }
  writeJsonAtomic(join(dir, 'drift.json'), drift);

  const duplicateLines = duplicates.map((d) => ({ table: d.table, key: d.key, page_ids: d.page_ids }));
  writeJsonAtomic(join(dir, 'pull.json'), {
    pull_id: id, taken_at: takenAt, tables: pulledTables, skipped, counts, cases, duplicates: duplicateLines, problems, paused, warnings,
    drift: 'skipped' in drift ? { checked: false, ...drift } : { checked: true, judged: drift.judged?.length ?? 0, adopted: drift.adopted?.length ?? 0, missing: drift.missing?.length ?? 0, added: drift.added?.length ?? 0 },
    request_log: existsSync(join(dir, 'requests.jsonl')) ? 'requests.jsonl' : null,
  });
  if (pulledTables.length > 0) writeTextAtomic(join(pullBase(root), 'LATEST'), id);

  const code = duplicates.length > 0 || problems.length > 0 ? EXIT.INVALID : EXIT.OK;
  const parts = pulledTables.map((t) => `${t} ${counts[t]}`);
  const driftWord = 'skipped' in drift ? `not checked (${drift.skipped})` : `${(drift.judged?.length ?? 0) + (drift.adopted?.length ?? 0) + (drift.missing?.length ?? 0) + (drift.added?.length ?? 0)} difference(s)`;
  const line = `pull ${id}: ${parts.length ? parts.join(', ') : 'no table read'}${skipped.length ? `; skipped ${skipped.map((s) => s.table).join(', ')} (not created yet)` : ''}; drift ${driftWord}; duplicates ${duplicates.length}; paused ${paused ? 'yes' : 'no'}`;
  return { code, pullId: id, dir, tables: pulledTables, skipped, counts, duplicates: duplicateLines, problems, paused, warnings, drift, cases, line };
}

// ---- the dry run of the real claims table --------------------------------------------------------------------------------------------

// A fetch that can only read: a GET, or a POST to a query or search path. Anything else is refused before it leaves the process.
export function readOnlyFetch(inner = globalThis.fetch) {
  return async (url, init = {}) => {
    const method = String(init.method ?? 'GET').toUpperCase();
    const path = new URL(String(url)).pathname;
    if (!(method === 'GET' || (method === 'POST' && /\/(?:query|search)$/.test(path)))) throw new Error(`the dry run only reads: ${method} ${path} was refused`);
    return inner(url, init);
  };
}

const LINK_BUCKETS = ['0', '1', '2', '3 or more'];
const bucketOf = (n) => LINK_BUCKETS[Math.min(n, 3)];

function optionNames(def) {
  const options = def?.select?.options ?? def?.multi_select?.options ?? def?.status?.options;
  return Array.isArray(options) ? options.map((o) => o.name) : null;
}

function countBy(values) {
  const out = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

/** The report of a dry run (report.json): pure, from the schema, the plain rows and the request summary. */
export function dryRunReport({ schema, rows, columns, requests, runId, readAt, multiSource = false, completedRows = 0 }) {
  const props = schema?.properties ?? {};
  const keyColumn = columns.key;
  const typeOf = (name) => props[name]?.type ?? null;

  const ids = rows.map((r) => text(r[keyColumn]).trim());
  const idCounts = countBy(ids.filter((v) => v !== ''));
  const duplicates = Object.entries(idCounts).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || byCodePoints(a[0], b[0]));

  const sourceStats = rows.map((r) => ({ row: r, links: r.source_links ?? [] }));
  const perRow = countBy(sourceStats.map((s) => bucketOf(s.links.length)));
  const forms = countBy(sourceStats.flatMap((s) => s.links.map((l) => l.form ?? 'rich_text')));
  const hosts = countBy(sourceStats.flatMap((s) => s.links.map((l) => { try { return new URL(l.href).host; } catch { return '(not an address)'; } })));
  const withLinks = sourceStats.filter((s) => s.links.length > 0);
  const samples = [];
  for (const wanted of [3, 1, 2]) {
    const hit = withLinks.find((s) => (wanted === 3 ? s.links.length >= 3 : s.links.length === wanted) && !samples.some((x) => x.row === s.row));
    if (hit) samples.push(hit);
  }
  for (const s of withLinks) if (samples.length < 3 && !samples.some((x) => x.row === s.row)) samples.push(s);

  const tagValues = rows.map((r) => (Array.isArray(r[columns.tags]) ? r[columns.tags] : []));
  const tagCounts = countBy(tagValues.flat());
  const reviewCounts = countBy(rows.map((r) => text(r[columns.review]).trim() || '(empty)'));
  const factual = rows.map((r) => r[columns.is_factual]);

  return {
    run_id: runId,
    read_at: readAt,
    source: 'real_claims',
    multi_source: multiSource,
    row_count: rows.length,
    column_count: Object.keys(props).length,
    columns: Object.entries(props).map(([name, def]) => {
      const options = optionNames(def);
      return { name, type: def.type, ...(options ? { options } : {}) };
    }),
    key: {
      column: keyColumn, type: typeOf(keyColumn), empty: ids.filter((v) => v === '').length, unique: duplicates.length === 0, duplicates: duplicates.slice(0, 10).map(([value, n]) => ({ value, rows: n })),
    },
    claim_name: { column: columns.claim, type: typeOf(columns.claim), empty: rows.filter((r) => text(r[columns.claim]).trim() === '').length },
    geo_sources: {
      column: columns.sources,
      type: typeOf(columns.sources),
      non_empty_rows: rows.filter((r) => text(r[columns.sources]).trim() !== '').length,
      empty_rows: rows.filter((r) => text(r[columns.sources]).trim() === '').length,
      rows_with_links: withLinks.length,
      rows_read_whole: completedRows,
      total_links: sourceStats.reduce((n, s) => n + s.links.length, 0),
      links_per_row: Object.fromEntries(LINK_BUCKETS.map((b) => [b, perRow[b] ?? 0])),
      links_by_form: { rich_text: forms.rich_text ?? 0, markdown: forms.markdown ?? 0, bare: forms.bare ?? 0 },
      hosts: Object.entries(hosts).sort((a, b) => b[1] - a[1] || byCodePoints(a[0], b[0])).slice(0, 5).map(([host, links]) => ({ host, links })),
      samples: samples.map(({ row, links }) => ({
        geo_id: text(row[keyColumn]), claim: shorten(text(row[columns.claim]), 90), sources_text: shorten(text(row[columns.sources]), 160), links: links.map((l) => ({ text: shorten(l.text ?? '', 60), href: l.href, form: l.form })),
      })),
    },
    is_factual: {
      column: columns.is_factual, type: typeOf(columns.is_factual), true: factual.filter((v) => v === true).length, false: factual.filter((v) => v === false).length, empty: factual.filter((v) => v !== true && v !== false).length,
    },
    geo_tags: { column: columns.tags, type: typeOf(columns.tags), counts: Object.fromEntries(Object.entries(tagCounts).sort((a, b) => b[1] - a[1] || byCodePoints(a[0], b[0]))), rows_without: tagValues.filter((v) => v.length === 0).length },
    review_status: { column: columns.review, type: typeOf(columns.review), counts: Object.fromEntries(Object.entries(reviewCounts).sort((a, b) => b[1] - a[1] || byCodePoints(a[0], b[0]))) },
    requests: { total: requests.total, by_method: requests.byMethod, writes: requests.writes },
  };
}

const list = (obj) => Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none';

/** report.md of a dry run: for the engineer and the evidence folder, plain words, no money and no durations. */
export function dryRunMarkdown(r) {
  const lines = [];
  lines.push('# Dry run of the real claims table');
  lines.push('');
  lines.push(`Read only: nothing was written to Notion. Read on ${r.read_at.slice(0, 10)} (run ${r.run_id}).`);
  lines.push('');
  lines.push('## Size');
  lines.push('');
  lines.push(`- Rows: ${r.row_count}`);
  lines.push(`- Columns: ${r.column_count}`);
  if (r.multi_source) lines.push('- The table has more than one data source; it was read through the data source route.');
  lines.push('');
  lines.push('## Columns');
  lines.push('');
  lines.push('| Column | Type | Options |');
  lines.push('|---|---|---|');
  for (const c of r.columns) lines.push(`| ${c.name} | ${c.type} | ${c.options ? c.options.join(', ') : ''} |`);
  lines.push('');
  lines.push(`## ${r.key.column}`);
  lines.push('');
  lines.push(`- Type: ${r.key.type}`);
  lines.push(`- Empty on ${r.key.empty} row(s)`);
  lines.push(`- Unique on every row that has one: ${r.key.unique ? 'yes' : `no (${r.key.duplicates.length} value(s) repeat, for example ${r.key.duplicates.slice(0, 3).map((d) => `${d.value} on ${d.rows} rows`).join('; ')})`}`);
  lines.push(`- Rows with an empty ${r.claim_name.column}: ${r.claim_name.empty}`);
  lines.push('');
  const s = r.geo_sources;
  lines.push(`## ${s.column}`);
  lines.push('');
  lines.push(`- Type: ${s.type}`);
  lines.push(`- Rows with something in it: ${s.non_empty_rows} of ${r.row_count}; rows with at least one link: ${s.rows_with_links}`);
  lines.push(`- Links per row: ${list(s.links_per_row)}`);
  if (s.rows_read_whole > 0) lines.push(`- ${s.rows_read_whole} row(s) had so many pieces that Notion cut the cell short; those were read whole from the cell itself`);
  lines.push(`- Links found: ${s.total_links} (as real links on the text: ${s.links_by_form.rich_text}; written as [title](address): ${s.links_by_form.markdown}; an address typed as text: ${s.links_by_form.bare})`);
  lines.push(`- Where the links point: ${s.hosts.length ? s.hosts.map((h) => `${h.host} (${h.links})`).join(', ') : 'nowhere'}`);
  lines.push('');
  lines.push('Three sample rows:');
  lines.push('');
  s.samples.forEach((x, i) => {
    lines.push(`${i + 1}. ${x.claim} (${x.geo_id})`);
    for (const l of x.links) lines.push(`   - ${l.text ? `${l.text} ` : ''}${l.href} (${l.form})`);
  });
  if (s.samples.length === 0) lines.push('(no row has a link)');
  lines.push('');
  lines.push(`## ${r.is_factual.column}`);
  lines.push('');
  lines.push(`- Type: ${r.is_factual.type}`);
  lines.push(`- Ticked: ${r.is_factual.true}; not ticked: ${r.is_factual.false}; empty or other: ${r.is_factual.empty}`);
  lines.push('');
  lines.push(`## ${r.geo_tags.column}`);
  lines.push('');
  lines.push(`- Rows with each value: ${list(r.geo_tags.counts)}`);
  lines.push(`- Rows with none: ${r.geo_tags.rows_without}`);
  lines.push('');
  lines.push(`## ${r.review_status.column}`);
  lines.push('');
  lines.push(`- Rows with each value: ${list(r.review_status.counts)}`);
  lines.push('');
  lines.push('## Requests');
  lines.push('');
  lines.push(`- Sent in total: ${r.requests.total} (${list(r.requests.by_method)})`);
  lines.push(`- Writes: ${r.requests.writes}`);
  lines.push('');
  return lines.join('\n');
}

const DEFAULT_COLUMNS = Object.freeze({ claim: 'Geo Name', sources: 'Geo Sources', is_factual: 'Geo Is factual', tags: 'Geo Tags', review: 'Review status' });

/**
 * The one read-only pull of the real claims table (config notion.sources.real_claims) into runs/dry-run/<run-id>/. One retrieveDatabase and one
 * queryAll through a client that cannot write and logs every request; the run ends by counting that log. Returns { code, runId, dir, report, line }.
 */
export async function dryRun({
  root = agentRoot(), config = loadConfig(root), runId, now = () => new Date(), fetchImpl, token, repoRoot, sleep,
} = {}) {
  const source = config.notion?.sources?.real_claims;
  if (!source || !isSet(source.database_id)) throw new UsageError('config.json has no notion.sources.real_claims with a database_id');
  const id = freshId(makeRunId('dry-run', now()), runId, (x) => existsSync(join(dryBase(root), x, 'report.json')) || existsSync(join(dryBase(root), x, 'requests.jsonl')), 'dry run', '--run-id');
  const dir = join(dryBase(root), id);
  const logFile = join(dir, 'requests.jsonl');
  const guarded = readOnlyFetch(fetchImpl);
  const options = { fetchImpl: guarded, token, repoRoot: repoRoot ?? defaultRepoRoot(), sleep, log: requestLogger(logFile) };
  const client = clientFromConfig(config, options);
  if (!client) throw new UsageError('there is no NOTION_TOKEN in .env, so Notion cannot be read by script');
  mkdirSync(dir, { recursive: true });

  const claimsEntry = safeEntry(config, 'claims_copy');
  const columns = {
    key: source.key || 'Geo ID',
    claim: claimsEntry?.columns?.claim ?? DEFAULT_COLUMNS.claim,
    sources: claimsEntry?.columns?.sources ?? DEFAULT_COLUMNS.sources,
    is_factual: claimsEntry?.columns?.is_factual ?? DEFAULT_COLUMNS.is_factual,
    tags: DEFAULT_COLUMNS.tags,
    review: DEFAULT_COLUMNS.review,
  };
  const pageSize = config.notion?.page_size ?? 100;

  let schema;
  let pages;
  let reader = client;
  let multiSource = false;
  try {
    schema = await client.retrieveDatabase(source.database_id);
    pages = await client.queryAll(source.database_id, { pageSize });
  } catch (e) {
    // a database with more than one data source refuses the 2022 query: read the one data source with the builder's API version
    if (!(e?.status === 400 && /data source/i.test(e.message ?? '') && isSet(source.data_source_id))) throw e;
    multiSource = true;
    const newer = clientFromConfig(config, { ...options, apiVersion: config.notion?.builder_api_version ?? BUILDER_API_VERSION });
    reader = newer;
    schema = await newer.retrieveDataSource(source.data_source_id);
    pages = await newer.queryDataSourceAll(source.data_source_id, { pageSize });
  }

  const sourcesColumn = columns.sources;
  const completedRows = await completeLongText(reader, pages, sourcesColumn);
  const rows = pages.map((page) => {
    const d = decodePage(page, schema);
    const richText = page.properties?.[sourcesColumn]?.rich_text;
    const links = geoSourceLinks(richText, text(d.props[sourcesColumn]));
    return {
      ...plainRow(d),
      ...(d.relation_has_more ? { relation_has_more: d.relation_has_more } : {}),
      source_links: links,
      source_pieces: richTextPieces(richText),
    };
  });

  writeJsonAtomic(join(dir, 'schema.json'), schema);
  writeTextAtomic(join(dir, 'rows.jsonl'), jsonl(rows));
  const requests = countRequests(logFile);
  const report = dryRunReport({ schema, rows, columns, requests, runId: id, readAt: now().toISOString(), multiSource, completedRows });
  writeJsonAtomic(join(dir, 'report.json'), report);
  writeTextAtomic(join(dir, 'report.md'), dryRunMarkdown(report));

  const final = countRequests(logFile);
  const line = `dry run ${id}: ${rows.length} rows, ${report.column_count} columns; ${report.key.column} ${report.key.unique && report.key.empty === 0 ? 'unique and filled on every row' : `not clean (${report.key.empty} empty, ${report.key.duplicates.length} repeated)`}; ${report.geo_sources.rows_with_links} rows with links; requests ${final.total} (${list(final.byMethod)}), writes ${final.writes}`;
  if (final.writes !== 0) return { code: EXIT.ERROR, runId: id, dir, report, line: `${line} -- THE REQUEST LOG SHOWS A WRITE; this must never happen, read ${logFile}` };
  return { code: EXIT.OK, runId: id, dir, report, line };
}

// ---- the pick ------------------------------------------------------------------------------------------------------------------

function newestDryRun(root) {
  const base = dryBase(root);
  if (!existsSync(base)) return null;
  const found = readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(base, d.name, 'rows.jsonl'))).map((d) => {
    let at = '';
    try {
      at = String(readJson(join(base, d.name, 'report.json')).read_at ?? '');
    } catch {
      at = new Date(statSync(join(base, d.name, 'rows.jsonl')).mtimeMs).toISOString();
    }
    return { id: d.name, at };
  }).sort((a, b) => byCodePoints(b.at, a.at) || byCodePoints(b.id, a.id));
  return found[0]?.id ?? null;
}

/**
 * Pick the claims for the Claims copy: the rows named by the audit file first (in its order), then random ones. Deterministic for a seed and a
 * dry run (the pool is put in Geo ID order before the seeded shuffle). Writes <root>/setup/claims-pick.json and returns { code, pick, path, line }.
 */
export function pickClaims({
  root = agentRoot(), config = loadConfig(root), count = 50, seed, auditPath, from, now = () => new Date(),
} = {}) {
  if (typeof seed !== 'string' || seed.trim() === '') throw new UsageError('--seed <string> is required (the same seed and dry run give the same pick)');
  if (!Number.isInteger(count) || count < 1) throw new UsageError('--pick needs a whole number of claims, for example 50');
  if (!auditPath) throw new UsageError('--audit <path to the audit json> is required');
  const fail = (message) => ({ code: EXIT.INVALID, pick: null, path: null, line: `pick: ${message}` });

  let audit;
  try {
    audit = readJson(resolve(auditPath));
  } catch (e) {
    return fail(`the audit file cannot be read (${e.message})`);
  }
  const auditIds = (audit?.decisions ?? []).map((d) => d?.geo_id).filter((v) => typeof v === 'string' && v !== '');
  if (auditIds.length === 0) return fail('the audit file has no decisions[].geo_id');
  if (new Set(auditIds.map(normId)).size !== auditIds.length) return fail('the audit file repeats a geo_id');

  const dryId = from ? safeName(from) : newestDryRun(root);
  if (!dryId) return fail('there is no dry run with rows yet: run --dry-run first');
  const rowsFile = join(dryBase(root), dryId, 'rows.jsonl');
  if (!existsSync(rowsFile)) return fail(`dry run "${dryId}" has no rows.jsonl`);
  const rows = readJsonl(rowsFile).rows;
  const keyColumn = config.notion?.sources?.real_claims?.key || 'Geo ID';
  const nameColumn = safeEntry(config, 'claims_copy')?.columns?.claim ?? DEFAULT_COLUMNS.claim;
  const idOf = (r) => text(r[keyColumn]).trim();

  const byId = new Map();
  for (const r of rows) {
    const key = normId(idOf(r));
    if (key === '') continue;
    byId.set(key, [...(byId.get(key) ?? []), r]);
  }
  const missing = auditIds.filter((a) => !byId.has(normId(a)));
  if (missing.length) return fail(`${missing.length} audit claim(s) are not in dry run ${dryId}: ${missing.map((m) => m.slice(0, 12)).join(', ')}`);
  const repeated = auditIds.filter((a) => byId.get(normId(a)).length > 1);
  if (repeated.length) return fail(`${repeated.length} audit claim(s) appear on more than one row of dry run ${dryId}`);
  const auditRows = auditIds.map((a) => byId.get(normId(a))[0]);

  const randomCount = count - auditRows.length;
  if (randomCount < 0) return fail(`--pick ${count} is fewer than the ${auditRows.length} audit claims`);
  const taken = new Set(auditIds.map(normId));
  const pool = rows
    .filter((r) => idOf(r) !== '' && !taken.has(normId(idOf(r))) && byId.get(normId(idOf(r))).length === 1 && text(r[nameColumn]).trim() !== '')
    .sort((a, b) => byCodePoints(normId(idOf(a)), normId(idOf(b))));
  if (pool.length < randomCount) return fail(`only ${pool.length} rows are left to choose from, ${randomCount} are needed`);
  const chosen = sample(pool, randomCount, mulberry32(seedFromString(seed)));

  const pick = {
    seed,
    picked_at: now().toISOString(),
    dry_run: dryId,
    audit_ids: auditRows.map(idOf),
    random_ids: chosen.map(idOf),
    rows: [...auditRows, ...chosen],
  };
  const path = join(root, 'setup', 'claims-pick.json');
  writeJsonAtomic(path, pick);
  return { code: EXIT.OK, pick, path, line: `pick: ${pick.rows.length} claims (${auditRows.length} from the audit, ${chosen.length} at random, seed "${seed}") from dry run ${dryId} -> ${path}` };
}

// ---- command line ------------------------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/**
 * Run the script; returns the exit code. env (tests): { root, config, client (null = no token), fetchImpl, token, repoRoot, sleep, now }.
 */
export async function main(argv, io = defaultIo, env = {}) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        all: { type: 'boolean' }, tables: { type: 'string' }, 'pull-id': { type: 'string' }, source: { type: 'string' }, 'dry-run': { type: 'boolean' }, 'run-id': { type: 'string' },
        pick: { type: 'string' }, seed: { type: 'string' }, audit: { type: 'string' }, from: { type: 'string' }, help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (e) {
    io.err(`pull: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  const modes = [Boolean(args.all || args.tables), Boolean(args['dry-run']), args.pick !== undefined].filter(Boolean).length;
  if (modes !== 1 || (args.all && args.tables)) {
    io.err(`pull: give exactly one of --all / --tables, --source real_claims --dry-run, or --source real_claims --pick\n${USAGE}`);
    return EXIT.INVALID;
  }
  if ((args['dry-run'] || args.pick !== undefined) && args.source !== 'real_claims') {
    io.err(`pull: --dry-run and --pick need --source real_claims\n${USAGE}`);
    return EXIT.INVALID;
  }
  const root = env.root ?? agentRoot();
  let config;
  try {
    config = env.config ?? loadConfig(root);
  } catch (e) {
    io.err(`pull: ${e.message}`);
    return EXIT.INVALID;
  }
  try {
    const now = env.now;
    if (args['dry-run']) {
      const r = await dryRun({ root, config, runId: args['run-id'], now, fetchImpl: env.fetchImpl, token: env.token, repoRoot: env.repoRoot, sleep: env.sleep });
      (r.code === EXIT.OK ? io.out : io.err)(r.line);
      return r.code;
    }
    if (args.pick !== undefined) {
      const count = Number(args.pick);
      const r = pickClaims({ root, config, count, seed: args.seed, auditPath: args.audit, from: args.from, now });
      (r.code === EXIT.OK ? io.out : io.err)(r.line);
      return r.code;
    }
    const names = args.all ? 'all' : args.tables.split(',').map((s) => s.trim()).filter(Boolean);
    const r = await pull({ root, config, client: env.client, tables: names, pullId: args['pull-id'], now, fetchImpl: env.fetchImpl, token: env.token, repoRoot: env.repoRoot, sleep: env.sleep });
    io.out(r.line);
    for (const w of r.warnings) io.err(`pull: warning: ${w}`);
    for (const p of r.problems) io.err(`pull: ${p}`);
    for (const d of r.duplicates) io.err(`pull: duplicate key in ${d.table}: "${d.key}" on pages ${d.page_ids.join(', ')}`);
    return r.code;
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`pull: ${e.message}\n${USAGE}`);
      return EXIT.INVALID;
    }
    io.err(`pull: ${e.message}`);
    if (e.code === 'BROKEN_CURSOR') return EXIT.INVALID;
    if (e.name === 'NotionError' && [401, 403, 404].includes(e.status)) {
      io.err('pull: Notion refused the request; check the token and that the integration is connected to the page the tables are under');
      return EXIT.INVALID;
    }
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
