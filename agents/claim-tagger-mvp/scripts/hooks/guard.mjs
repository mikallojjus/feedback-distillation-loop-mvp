#!/usr/bin/env node
// Claude Code PreToolUse hook for the Notion connector: the session never writes Notion unless a script prepared the write.
//
// Reads the hook input (JSON on stdin: tool_name, tool_input, ...) and prints
//   { "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow" | "ask" | "deny", "permissionDecisionReason": "..." } }
// then exits 0. It never throws: input it cannot read is denied with a reason. A tool it does not guard gets {} (no opinion).
//
// Always denied: delete-pages, delete-databases, delete-comment, move-pages, duplicate-page, restore-pages (P51: only remove.mjs trashes, and only Claims
// and Tag decisions rows; nothing is deleted, archived or moved through the connector); any call that mentions a protected database or page id anywhere in its input (hard rule 10); any
// page write that names an editor-owned property or sets Status to Approved or Rejected (hard rule 1).
// One exception to the editor-column rule (decisions P18 to P20, 114 and P42 to P46): an editor's Claude may decide rows of Tag decisions. A notion-update-page call is allowed when
//   - command is update_properties, and the input holds only page_id, command, properties and allow_async (no icon, cover, content or skill field);
//   - the properties are only some of the three Tag decisions editor columns (Agent is right, Tag outcome, Your note), and each value is of the form decide.mjs open prints:
//     Agent is right "__YES__" (the connector's form for a ticked box; unticking is not a decision), Tag outcome Applies or Does not apply, Your note a string (no null: a
//     decision never clears a cell);
//   - every page id found in page_id (a 32-hex id, a dashed id or a notion.so address; there must be one) is listed in page_ids of a live marker runs/DECIDING (a regular
//     file written by decide.mjs open, younger than two hours) in this folder;
//   - the agent is not paused: no runs/PAUSED in this folder (the Paused box in Notion is for decide.mjs, which has the network);
//   - and no protected id appears anywhere in the input (that check comes first, as for every call).
// The page list is what keeps the protected real tables safe: their columns may share these names, their page ids are never in a marker.
// This hook is the gate of the decide step, and the only one: .claude/settings.json has NO permission rule (neither allow nor ask) for notion-update-page, so the hook's
// "allow" is what lets a decision through without a prompt, and when the hook cannot run (it fails to start, it is missing) the call falls to the normal permission flow,
// which is a prompt. A rule under "allow" would let every update-page through when the hook fails.
// Everything else stays as it was. Otherwise it answers "ask" (the editor of the session still sees a prompt) only while the marker file runs/SETUP exists (the setup or
// walkthrough script creates it for one builder session and removes it at the end):
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

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = resolve(HERE, '..', '..');

const GUARDED = /notion-(create-pages|update-page|create-database|update-data-source|create-view|update-view|move-pages|duplicate-page|delete-pages|delete-databases|delete-comment|restore-pages|update-folder|create-folder)/;
const ALWAYS_DENIED = new Set(['move-pages', 'duplicate-page', 'delete-pages', 'delete-databases', 'delete-comment', 'restore-pages', 'update-folder', 'create-folder']);
const SCHEMA_TOOLS = new Set(['create-database', 'update-data-source', 'create-view', 'update-view']);
const UUID = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi;
// used when the config names none: the editor's three columns of Tag decisions, Editor wording and Paused (the list of the shipped config.json)
const DEFAULT_EDITOR_NAMES = ['Agent is right', 'Tag outcome', 'Your note', 'Editor wording', 'Paused'];
const DEFAULT_EDITOR_STATUS = ['Approved', 'Rejected'];
// the decide step (P18 to P20, v2): the three columns of Tag decisions that an editor's Claude may write, the keys a decision write may carry, the values it may set (the
// connector takes a checkbox as "__YES__" or "__NO__"; only "__YES__" is a decision), and how long a runs/DECIDING marker counts (the same two hours as the other markers of the loop)
const DEFAULT_DECIDE_COLUMNS = ['Agent is right', 'Tag outcome', 'Your note'];
const DECIDE_KEYS = new Set(['page_id', 'command', 'properties', 'allow_async']);
const DECIDE_TICK = '__YES__';
const DECIDE_OUTCOMES = ['Applies', 'Does not apply'];
const DECIDING_STALE_MS = 2 * 60 * 60 * 1000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const normId = (id) => String(id ?? '').replace(/^collection:\/\//, '').replace(/.*\/p\//, '').replace(/[?#].*$/, '').replace(/-/g, '').toLowerCase();

const deny = (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: reason });
const allow = (reason) => ({ permissionDecision: 'allow', permissionDecisionReason: reason });
// a builder session's write is not the guard's to wave through: the editor of the session still sees a prompt for it
const ask = (reason) => ({ permissionDecision: 'ask', permissionDecisionReason: reason });

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

// a page id as Notion writes it, with or without dashes, not part of a longer run of hex digits
const PAGE_ID = /(?<![0-9a-f])[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}(?![0-9a-f])/gi;

/** Every page id found anywhere in a value (an id, a dashed id, a notion.so address with a title in front of its id), as 32 lower-case hex digits. */
function pageIdsIn(value) {
  return [...String(value ?? '').matchAll(PAGE_ID)].map((m) => m[0].replace(/-/g, '').toLowerCase());
}

/** A file that exists and is a regular file: a folder named like a marker is not a marker. */
function isRegularFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * The page ids that the live runs/DECIDING marker lists. A marker counts only as a regular file, younger than two hours and not dated in the future, and not while the agent is
 * paused (runs/PAUSED). Practice pages are parked (P48): their markers open no write window. Returns { ids, paused }: `paused` is true when the marker was left out because of the
 * pause. The Paused box in Notion is for decide.mjs to read; this hook has no network.
 */
function decidingPageIds(root, now) {
  const markers = [{ file: join(root, 'runs', 'DECIDING'), paused: existsSync(join(root, 'runs', 'PAUSED')) }];
  const ids = new Set();
  let paused = false;
  for (const marker of markers) {
    try {
      if (!isRegularFile(marker.file)) continue;
      const data = readJsonSafe(marker.file);
      const opened = Date.parse(data?.opened_at);
      const born = Number.isFinite(opened) ? opened : statSync(marker.file).mtimeMs;
      if (now - born >= DECIDING_STALE_MS || born - now > 5 * 60 * 1000) continue;
      if (marker.paused) {
        paused = true;
        continue;
      }
      for (const id of Array.isArray(data?.page_ids) ? data.page_ids : []) for (const hex of pageIdsIn(id)) ids.add(hex);
    } catch {
      // an unreadable marker lists nothing
    }
  }
  return { ids, paused };
}

/** May this update-page call write a decision? { ok: true, reason } or { ok: false, why }. Only called for an update-page call whose properties name an editor column, so `properties` is an object with a key in it. */
function decideWrite(toolInput, config, root, now) {
  const no = (why) => ({ ok: false, why });
  // the columns come from editor_columns.tag_decisions; the per-claim list (editor_columns.claims, empty on v2) is never a fallback
  const named = Array.isArray(config.editor_columns?.tag_decisions) ? config.editor_columns.tag_decisions.filter((n) => typeof n === 'string') : [];
  const columns = named.length ? named : DEFAULT_DECIDE_COLUMNS;
  const lower = new Set(columns.map((n) => n.toLowerCase()));
  if (toolInput.command !== 'update_properties') return no(`a decision is written with update_properties; got "${toolInput.command ?? 'none'}"`);
  const extra = Object.keys(toolInput).filter((k) => !DECIDE_KEYS.has(k));
  if (extra.length) return no(`a decision write carries only page_id, command, properties and allow_async; got ${extra.join(', ')}`);
  if ('allow_async' in toolInput && typeof toolInput.allow_async !== 'boolean') return no('allow_async must be true or false');
  const others = Object.keys(toolInput.properties).filter((k) => !lower.has(k.trim().toLowerCase()));
  if (others.length) return no(`a decision write may name only ${columns.join(', ')}; got ${others.join(', ')}`);
  for (const [key, value] of Object.entries(toolInput.properties)) {
    const column = key.trim().toLowerCase();
    if (column === 'agent is right' && value !== DECIDE_TICK) return no(`${key} may be set to ${DECIDE_TICK} only (a tick; a decision never unticks)`);
    if (column === 'tag outcome' && !DECIDE_OUTCOMES.includes(value)) return no(`${key} may be set to ${DECIDE_OUTCOMES.join(' or ')} only`);
    if (column === 'your note' && typeof value !== 'string') return no(`${key} must be text`);
  }
  // every page id found anywhere in page_id must be a listed one, and there must be one: an address that carries a second id is not taken for the first
  const found = pageIdsIn(toolInput.page_id);
  if (found.length === 0) return no('the page_id is not a page id or a notion.so address');
  const { ids: listed, paused } = decidingPageIds(root, now);
  const unlisted = found.filter((id) => !listed.has(id));
  // a marker that the pause put aside is the reason when it is the one that would have listed the page
  if (unlisted.length && paused) return no('the agent is paused (runs/PAUSED exists), so no decision is written');
  if (listed.size === 0) return no('no decide run is open (runs/DECIDING is missing, not a file or older than two hours)');
  if (unlisted.length) return no(`the page ${unlisted[0]} is not listed by an open decide run`);
  return { ok: true, reason: `a decision on a Tag decisions row that an open decide run lists (runs/DECIDING), writing only ${columns.join(', ')}` };
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

  if (ALWAYS_DENIED.has(tool)) return deny(`notion-${tool} is never allowed: nothing is deleted, archived, moved or duplicated (P51: only remove.mjs trashes, and only Claims and Tag decisions rows)`);
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
  if (!isRegularFile(marker)) return deny('no builder session is open (runs/SETUP is missing or is not a file): scripts write Notion through the REST client, the session does not');
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
    return ask('a plain page under a registered setup page while runs/SETUP exists');
  }
  if (tool === 'update-page') {
    const pageId = normId(toolInput.page_id ?? '');
    if (!registered.has(pageId)) return deny(`the page ${pageId} is not a registered setup page`);
    const command = String(toolInput.command ?? '');
    if (!['insert_content', 'update_content', 'replace_content'].includes(command)) return deny(`only content commands are allowed on a setup page; got "${command || 'none'}"`);
    if (toolInput.allow_deleting_content === true) return deny('a content replace may not delete child pages or databases (P51: only remove.mjs trashes, and only Claims and Tag decisions rows)');
    return ask(`${command} on a registered setup page while runs/SETUP exists`);
  }
  if (SCHEMA_TOOLS.has(tool)) {
    const target = normId(toolInput.parent?.page_id ?? toolInput.parent_page_id ?? toolInput.database_id ?? toolInput.data_source_id ?? toolInput.view_id ?? '');
    const dataSource = normId(toolInput.data_source_id ?? '');
    if (!(registered.has(target) || registered.has(dataSource))) return deny(`the target ${target || dataSource || '(none)'} is not a registered setup page or table`);
    if (tool === 'update-data-source' && (toolInput.in_trash === true || 'in_trash' in toolInput)) return deny('a table is never trashed (P51: only remove.mjs trashes, and only Claims and Tag decisions rows)');
    return ask(`notion-${tool} on a registered setup target while runs/SETUP exists`);
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
