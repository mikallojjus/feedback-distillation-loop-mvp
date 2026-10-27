#!/usr/bin/env node
// Claude Code PreToolUse hook for the Notion connector: the session never writes Notion unless a script prepared the write.
//
// Reads the hook input (JSON on stdin: tool_name, tool_input, ...) and prints
//   { "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow" | "deny", "permissionDecisionReason": "..." } }
// then exits 0. It never throws: input it cannot read is denied with a reason. A tool it does not guard gets {} (no opinion).
//
// Always denied: delete-pages, delete-databases, delete-comment, move-pages, duplicate-page, restore-pages (hard rule 8: nothing is
// deleted, archived or moved); any call that mentions a protected database or page id anywhere in its input (hard rule 10); any
// page write that names an editor-owned property or sets Status to Approved or Rejected (hard rule 1).
// One exception to the editor-column rule (decisions P18 to P20 and 114): an editor's Claude may decide claims. A notion-update-page call is allowed when
//   - command is update_properties, and the input holds only page_id, command, properties and allow_async (no icon, cover, content or skill field);
//   - the properties are only some of the three Claims editor columns (Verified tags, Review status, Challenged tags notes), and Review status, when given, is
//     Reviewed or To review;
//   - the page_id (a 32-hex id, a dashed id or a notion.so address) is listed in page_ids of a live marker runs/DECIDING (written by decide.mjs open, younger than
//     two hours), in this folder or in a practice page's folder runs/demos/<id>/;
//   - and no protected id appears anywhere in the input (that check comes first, as for every call).
// The page list is what keeps the protected real tables safe: their columns may share these names, their page ids are never in a marker.
// Everything else stays as it was. Otherwise allowed only while the marker file runs/SETUP exists (the setup or walkthrough script creates it for one builder
// session and removes it at the end):
//   create-pages   a plain page (title only, no database properties) under a page listed in config notion.setup_page_parents or in
//                  runs/builder/pages.json (pages the scripts created and registered);
//   update-page    content commands (insert_content, update_content, replace_content without deleting children) on a page listed in
//                  runs/builder/pages.json;
//   create-database, update-data-source, create-view, update-view
//                  only against a parent page or database id listed in runs/builder/pages.json or runs/builder/databases.json (the REST
//                  builder registers what it created; the connector is the fallback for views).
// Everything else is denied: scripts write Notion through the REST client, the session does not.
//
// The hook reads config.json and the marker files directly (no library imports) so that it cannot fail because the library is
// mid-change, and so that it has no way to reach the network or the token.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = resolve(HERE, '..', '..');

const GUARDED = /notion-(create-pages|update-page|create-database|update-data-source|create-view|update-view|move-pages|duplicate-page|delete-pages|delete-databases|delete-comment|restore-pages|update-folder|create-folder)/;
const ALWAYS_DENIED = new Set(['move-pages', 'duplicate-page', 'delete-pages', 'delete-databases', 'delete-comment', 'restore-pages', 'update-folder', 'create-folder']);
const SCHEMA_TOOLS = new Set(['create-database', 'update-data-source', 'create-view', 'update-view']);
const UUID = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi;
// used when the config names none: the editor's three columns of the Claims copy (Why wrong left the editor's work with the reading of 22 October, and Agent reading is the agent's),
// Editor wording and Paused (the list of the shipped config.json)
const DEFAULT_EDITOR_NAMES = ['Verified tags', 'Review status', 'Challenged tags notes', 'Editor wording', 'Paused'];
const DEFAULT_EDITOR_STATUS = ['Approved', 'Rejected'];
// the decide step (P18 to P20): the three columns of Claims that an editor's Claude may write, the keys a decision write may carry, the values of Review status it may set,
// and how long a runs/DECIDING marker counts (the same two hours as the other markers of the loop)
const DEFAULT_CLAIMS_COLUMNS = ['Verified tags', 'Review status', 'Challenged tags notes'];
const DECIDE_KEYS = new Set(['page_id', 'command', 'properties', 'allow_async']);
const DECIDE_REVIEW_VALUES = ['Reviewed', 'To review'];
const DECIDING_STALE_MS = 2 * 60 * 60 * 1000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const normId = (id) => String(id ?? '').replace(/^collection:\/\//, '').replace(/.*\/p\//, '').replace(/[?#].*$/, '').replace(/-/g, '').toLowerCase();

const deny = (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: reason });
const allow = (reason) => ({ permissionDecision: 'allow', permissionDecisionReason: reason });

function readJsonSafe(file) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) : null;
  } catch {
    return null;
  }
}

/** Every string in a value, keys included. */
function* strings(v) {
  if (typeof v === 'string') yield v;
  else if (Array.isArray(v)) for (const x of v) yield* strings(x);
  else if (isObject(v)) for (const [k, x] of Object.entries(v)) { yield k; yield* strings(x); }
}

function protectedMention(toolInput, protectedIds) {
  for (const s of strings(toolInput)) {
    for (const m of s.matchAll(UUID)) if (protectedIds.has(normId(m[0]))) return m[0];
  }
  return null;
}

// property names a page write touches; flat connector keys (date:<name>:start) map back to <name>
const propertyName = (key) => /^date:(.+):(?:start|end|is_datetime)$/.exec(key)?.[1] ?? key;

function editorWrite(tool, toolInput, editorNames, editorStatus) {
  const lower = new Set(editorNames.map((n) => n.toLowerCase()));
  const lists = [];
  if (tool === 'create-pages') for (const page of Array.isArray(toolInput.pages) ? toolInput.pages : []) if (isObject(page?.properties)) lists.push(page.properties);
  if (tool === 'update-page' && isObject(toolInput.properties)) lists.push(toolInput.properties);
  for (const props of lists) {
    for (const [key, value] of Object.entries(props)) {
      const name = propertyName(key).trim();
      if (lower.has(name.toLowerCase())) return `the property "${name}" belongs to the editor`;
      if (name.toLowerCase() === 'status' && typeof value === 'string' && editorStatus.includes(value)) return `Status ${value} is for the editor to set`;
    }
  }
  return null;
}

/** The 32 hex digits a page is known by, from an id, a dashed id or a notion.so address; null when the value is none of them. */
function pageIdOf(value) {
  const s = String(value ?? '').trim().replace(/[?#].*$/, '').replace(/[/\\]+$/, '');
  if (!/[/\\]/.test(s)) {
    const compact = s.replace(/-/g, '').toLowerCase();
    return /^[0-9a-f]{32}$/.test(compact) ? compact : null;
  }
  const last = s.split(/[/\\]/).pop() ?? '';
  return /[0-9a-f]{32}$/.exec(last.replace(/-/g, '').toLowerCase())?.[0] ?? null;
}

/** The page ids that the live runs/DECIDING markers list: this folder's and those of the practice pages under runs/demos/. A marker older than two hours, or dated in the future, counts for nothing. */
function decidingPageIds(root, now) {
  const files = [join(root, 'runs', 'DECIDING')];
  try {
    for (const entry of readdirSync(join(root, 'runs', 'demos'), { withFileTypes: true })) {
      if (entry.isDirectory()) files.push(join(root, 'runs', 'demos', entry.name, 'runs', 'DECIDING'));
    }
  } catch {
    // no practice pages
  }
  const ids = new Set();
  for (const file of files) {
    try {
      if (!existsSync(file)) continue;
      const data = readJsonSafe(file);
      const opened = Date.parse(data?.opened_at);
      const born = Number.isFinite(opened) ? opened : statSync(file).mtimeMs;
      if (now - born >= DECIDING_STALE_MS || born - now > 5 * 60 * 1000) continue;
      for (const id of Array.isArray(data?.page_ids) ? data.page_ids : []) {
        const hex = pageIdOf(id);
        if (hex) ids.add(hex);
      }
    } catch {
      // an unreadable marker lists nothing
    }
  }
  return ids;
}

/** May this update-page call write a decision? { ok: true, reason } or { ok: false, why }. Only called for a call that names an editor column. */
function decideWrite(toolInput, config, root, now) {
  const no = (why) => ({ ok: false, why });
  const columns = Array.isArray(config.editor_columns?.claims) && config.editor_columns.claims.length ? config.editor_columns.claims.filter((n) => typeof n === 'string') : DEFAULT_CLAIMS_COLUMNS;
  const lower = new Set(columns.map((n) => n.toLowerCase()));
  const reviewColumn = String(config.notion?.claims?.columns?.review_status ?? 'Review status').toLowerCase();
  if (toolInput.command !== 'update_properties') return no(`a decision is written with update_properties; got "${toolInput.command ?? 'none'}"`);
  const extra = Object.keys(toolInput).filter((k) => !DECIDE_KEYS.has(k));
  if (extra.length) return no(`a decision write carries only page_id, command, properties and allow_async; got ${extra.join(', ')}`);
  if ('allow_async' in toolInput && typeof toolInput.allow_async !== 'boolean') return no('allow_async must be true or false');
  if (!isObject(toolInput.properties) || Object.keys(toolInput.properties).length === 0) return no('a decision write needs properties');
  const others = Object.keys(toolInput.properties).filter((k) => !lower.has(k.trim().toLowerCase()));
  if (others.length) return no(`a decision write may name only ${columns.join(', ')}; got ${others.join(', ')}`);
  for (const [key, value] of Object.entries(toolInput.properties)) {
    if (key.trim().toLowerCase() === reviewColumn && !DECIDE_REVIEW_VALUES.includes(value)) return no(`${key} may be set to ${DECIDE_REVIEW_VALUES.join(' or ')} only`);
  }
  const pageId = pageIdOf(toolInput.page_id);
  if (!pageId) return no('the page_id is not a page id or a notion.so address');
  const listed = decidingPageIds(root, now);
  if (listed.size === 0) return no('no decide run is open (runs/DECIDING is missing or older than two hours)');
  if (!listed.has(pageId)) return no(`the page ${pageId} is not listed by an open decide run`);
  return { ok: true, reason: `a decision on a page that an open decide run lists (runs/DECIDING), writing only ${columns.join(', ')}` };
}

/** The decision for one hook input. Exported for the tests; `root` is the agent folder (config.json, runs/); options.now is the time the markers are measured against (milliseconds). */
export function decide(input, root = AGENT_ROOT, options = {}) {
  const toolName = String(input?.tool_name ?? '');
  const m = GUARDED.exec(toolName);
  if (!m) return null; // no opinion
  const tool = m[1];
  const toolInput = isObject(input?.tool_input) ? input.tool_input : {};
  const config = readJsonSafe(join(root, 'config.json')) ?? {};
  const protectedIds = new Set([...(config.notion?.protected_database_ids ?? []), ...(config.notion?.protected_page_ids ?? [])].map(normId));
  // every list of config.editor_columns (claims, rule_changes, agent_settings, whatever the config names) except the Status values
  const editorNames = Object.entries(isObject(config.editor_columns) ? config.editor_columns : {})
    .filter(([key, list]) => !key.endsWith('_status_editor_values') && Array.isArray(list))
    .flatMap(([, list]) => list.filter((n) => typeof n === 'string'));
  const names = editorNames.length ? editorNames : DEFAULT_EDITOR_NAMES;
  const statusValues = config.editor_columns?.rule_changes_status_editor_values ?? DEFAULT_EDITOR_STATUS;

  if (ALWAYS_DENIED.has(tool)) return deny(`notion-${tool} is never allowed: nothing is deleted, archived, moved or duplicated (hard rule 8)`);
  const hit = protectedMention(toolInput, protectedIds);
  if (hit) return deny(`the call mentions the protected id ${hit}; real tables and the old trial are never written (hard rule 10)`);
  const editor = editorWrite(tool, toolInput, names, statusValues);
  if (editor) {
    if (tool !== 'update-page') return deny(`${editor} (hard rule 1)`);
    // the one exception: a decision on a page that an open decide run lists (P18 to P20)
    const decision = decideWrite(toolInput, config, root, options.now ?? Date.now());
    return decision.ok ? allow(decision.reason) : deny(`${editor} (hard rule 1); ${decision.why}`);
  }

  const marker = join(root, 'runs', 'SETUP');
  if (!existsSync(marker)) return deny('no builder session is open (runs/SETUP is missing): scripts write Notion through the REST client, the session does not');
  const registered = new Set([
    ...(config.notion?.setup_page_parents ?? []),
    ...(readJsonSafe(join(root, 'runs', 'builder', 'pages.json'))?.pages ?? []),
    ...(readJsonSafe(join(root, 'runs', 'builder', 'databases.json'))?.ids ?? []),
  ].map(normId));

  if (tool === 'create-pages') {
    const parentId = normId(toolInput.parent?.page_id ?? '');
    if (!parentId || toolInput.parent?.database_id || toolInput.parent?.data_source_id) return deny('a database row is created by applying a plan through the REST client, never through the connector');
    if (!registered.has(parentId)) return deny(`the parent page ${parentId} is not a registered setup page`);
    for (const page of Array.isArray(toolInput.pages) ? toolInput.pages : []) {
      const keys = Object.keys(isObject(page?.properties) ? page.properties : {}).filter((k) => k.toLowerCase() !== 'title');
      if (keys.length) return deny(`a setup page may only have a title; got properties ${keys.join(', ')}`);
    }
    return allow('a plain page under a registered setup page while runs/SETUP exists');
  }
  if (tool === 'update-page') {
    const pageId = normId(toolInput.page_id ?? '');
    if (!registered.has(pageId)) return deny(`the page ${pageId} is not a registered setup page`);
    const command = String(toolInput.command ?? '');
    if (!['insert_content', 'update_content', 'replace_content'].includes(command)) return deny(`only content commands are allowed on a setup page; got "${command || 'none'}"`);
    if (toolInput.allow_deleting_content === true) return deny('a content replace may not delete child pages or databases (hard rule 8)');
    return allow(`${command} on a registered setup page while runs/SETUP exists`);
  }
  if (SCHEMA_TOOLS.has(tool)) {
    const target = normId(toolInput.parent?.page_id ?? toolInput.parent_page_id ?? toolInput.database_id ?? toolInput.data_source_id ?? toolInput.view_id ?? '');
    const dataSource = normId(toolInput.data_source_id ?? '');
    if (!(registered.has(target) || registered.has(dataSource))) return deny(`the target ${target || dataSource || '(none)'} is not a registered setup page or table`);
    if (tool === 'update-data-source' && (toolInput.in_trash === true || 'in_trash' in toolInput)) return deny('a table is never trashed (hard rule 8)');
    return allow(`notion-${tool} on a registered setup target while runs/SETUP exists`);
  }
  return deny(`notion-${tool} is not something the session may do`);
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    input = null;
  }
  let decision;
  if (!input) decision = deny('the hook input could not be read, so the write was refused');
  else {
    try {
      decision = decide(input);
    } catch (e) {
      decision = deny(`the guard failed (${e?.message ?? e}), so the write was refused`);
    }
  }
  if (!decision) {
    process.stdout.write('{}\n');
    return;
  }
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...decision } })}\n`);
}

const isDirectRun = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
  } catch {
    return false;
  }
})();
if (isDirectRun) main();
