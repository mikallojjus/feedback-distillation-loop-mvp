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
// Allowed only while the marker file runs/SETUP exists (the setup or walkthrough script creates it for one builder session and
// removes it at the end):
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

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = resolve(HERE, '..', '..');

const GUARDED = /notion-(create-pages|update-page|create-database|update-data-source|create-view|update-view|move-pages|duplicate-page|delete-pages|delete-databases|delete-comment|restore-pages|update-folder|create-folder)/;
const ALWAYS_DENIED = new Set(['move-pages', 'duplicate-page', 'delete-pages', 'delete-databases', 'delete-comment', 'restore-pages', 'update-folder', 'create-folder']);
const SCHEMA_TOOLS = new Set(['create-database', 'update-data-source', 'create-view', 'update-view']);
const UUID = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi;
// used when the config names none: the editor's columns of the Claims copy, Editor wording and Paused (the list of the shipped config.json)
const DEFAULT_EDITOR_NAMES = ['Verified tags', 'Review status', 'Why wrong', 'Challenged tags notes', 'Editor wording', 'Paused'];
const DEFAULT_EDITOR_STATUS = ['Approved', 'Rejected'];

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

/** The decision for one hook input. Exported for the tests; `root` is the agent folder (config.json, runs/). */
export function decide(input, root = AGENT_ROOT) {
  const toolName = String(input?.tool_name ?? '');
  const m = GUARDED.exec(toolName);
  if (!m) return null; // no opinion
  const tool = m[1];
  const toolInput = isObject(input?.tool_input) ? input.tool_input : {};
  const config = readJsonSafe(join(root, 'config.json')) ?? {};
  const protectedIds = new Set([...(config.notion?.protected_database_ids ?? []), ...(config.notion?.protected_page_ids ?? [])].map(normId));
  // every list of config.editor_columns (claims_copy, rule_changes, agent_settings, whatever the config names) except the Status values
  const editorNames = Object.entries(isObject(config.editor_columns) ? config.editor_columns : {})
    .filter(([key, list]) => !key.endsWith('_status_editor_values') && Array.isArray(list))
    .flatMap(([, list]) => list.filter((n) => typeof n === 'string'));
  const names = editorNames.length ? editorNames : DEFAULT_EDITOR_NAMES;
  const statusValues = config.editor_columns?.rule_changes_status_editor_values ?? DEFAULT_EDITOR_STATUS;

  if (ALWAYS_DENIED.has(tool)) return deny(`notion-${tool} is never allowed: nothing is deleted, archived, moved or duplicated (hard rule 8)`);
  const hit = protectedMention(toolInput, protectedIds);
  if (hit) return deny(`the call mentions the protected id ${hit}; real tables and the old trial are never written (hard rule 10)`);
  const editor = editorWrite(tool, toolInput, names, statusValues);
  if (editor) return deny(`${editor} (hard rule 1)`);

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
