#!/usr/bin/env node
// Claude Code PreToolUse hook: no Notion write goes through the connector unless a script produced it.
//
// Reads the hook input (JSON on stdin: tool_name, tool_input, ...) and prints
//   { "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow" | "deny", "permissionDecisionReason": "..." } }
// then exits 0. It never throws: input it cannot read is denied with a reason. A tool it does not guard gets `{}` (no opinion).
//
// Guarded tools: notion-create-pages, notion-update-page, notion-create-database, notion-update-data-source, notion-create-view,
// notion-update-view, notion-move-pages, notion-duplicate-page.
//   Always denied:  any call that mentions a protected (real) database id anywhere; any page write that names an editor-owned
//                   property (or sets rule_changes Status to Approved or Rejected); move-pages and duplicate-page.
//   Page writes:    allowed only while runs/APPLYING.json is armed, the plan file still has the armed sha, and the call equals an op of
//                   that run's batch files (parent, every property, page content); an identical create is allowed once (the ledger
//                   runs/<run>/guard-ledger.jsonl, cleared when `plan.mjs check` arms the run again).
//   Schema tools:   allowed only while the file runs/SETUP exists.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EDITOR_NAMES, STATUS_VALUES, controlPaths, isProtectedDatabase } from '../allowlist.mjs';
import { EXIT } from '../lib/exit-codes.mjs';
import { fileSha256, h16 } from '../lib/hash.mjs';
import { appendJsonl, readJson, readJsonl } from '../lib/jsonl.mjs';
import { agentRoot, isMain } from '../lib/paths.mjs';

const GUARDED = /notion-(create-pages|update-page|create-database|update-data-source|create-view|update-view|move-pages|duplicate-page)/;
const SCHEMA_TOOLS = new Set(['create-database', 'update-data-source', 'create-view', 'update-view']);
const CREATE_KEYS = new Set(['parent', 'pages', 'allow_async']);
const PAGE_KEYS = new Set(['properties', 'content']);
const UPDATE_KEYS = new Set(['page_id', 'command', 'properties']);
const UUID = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi;
const EDITOR_LOWER = new Set([...EDITOR_NAMES].map((n) => n.toLowerCase()));

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const normId = (id) => String(id ?? '').replace(/^collection:\/\//, '').replace(/-/g, '').toLowerCase();

/** JSON with sorted keys: two values are equal when their canonical forms are. */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}

const deny = (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: reason });
const allow = (reason) => ({ permissionDecision: 'allow', permissionDecisionReason: reason });

// every string in a value, keys included
function* strings(v) {
  if (typeof v === 'string') yield v;
  else if (Array.isArray(v)) for (const x of v) yield* strings(x);
  else if (isObject(v)) for (const [k, x] of Object.entries(v)) { yield k; yield* strings(x); }
}

function protectedMention(toolInput, config) {
  for (const s of strings(toolInput)) {
    for (const m of s.matchAll(UUID)) if (isProtectedDatabase(config, m[0])) return m[0];
  }
  return null;
}

// property names a page write touches, flat-connector keys (date:<name>:start) mapped back to <name>
const propertyName = (key) => /^date:(.+):(?:start|end|is_datetime)$/.exec(key)?.[1] ?? key;

function editorWrite(tool, toolInput) {
  const lists = [];
  if (tool === 'create-pages') for (const page of Array.isArray(toolInput.pages) ? toolInput.pages : []) if (isObject(page?.properties)) lists.push(page.properties);
  if (tool === 'update-page') {
    const d = isObject(toolInput.data) ? toolInput.data : toolInput;
    if (isObject(d.properties)) lists.push(d.properties);
  }
  for (const props of lists) {
    for (const [key, value] of Object.entries(props)) {
      const name = propertyName(key);
      if (EDITOR_LOWER.has(name.trim().toLowerCase())) return `the property "${name}" belongs to the editors`;
      if (name.trim().toLowerCase() === 'status' && typeof value === 'string' && STATUS_VALUES.editor.includes(value)) return `Status ${value} is for the rule owner to set`;
    }
  }
  return null;
}

// ---- the armed plan ------------------------------------------------------------------------------------------------

function readBatches(dir) {
  const batchDir = join(dir, 'batches');
  const creates = [];
  const updates = [];
  if (!existsSync(batchDir)) return { creates, updates };
  for (const file of readdirSync(batchDir).sort()) {
    if (file.endsWith('.json')) {
      const batch = readJson(join(batchDir, file));
      for (const page of batch.pages ?? []) creates.push({ parent: normId(batch.parent?.data_source_id), properties: page.properties, content: page.content ?? null });
    } else if (file.endsWith('.jsonl')) {
      for (const line of readJsonl(join(batchDir, file)).rows) updates.push({ page_id: normId(line.page_id), properties: line.properties });
    }
  }
  return { creates, updates };
}

function armedBatches(root) {
  const paths = controlPaths(root);
  if (!existsSync(paths.applying)) return { problem: 'no plan is armed (runs/APPLYING.json is missing): scripts write Notion, not the session' };
  let armed;
  try {
    armed = readJson(paths.applying);
  } catch {
    return { problem: 'runs/APPLYING.json is not readable' };
  }
  if (typeof armed.run_id !== 'string' || typeof armed.plan_sha !== 'string') return { problem: 'runs/APPLYING.json has no run_id and plan_sha' };
  const dir = join(paths.runs, armed.run_id);
  const planFile = join(dir, 'plan.jsonl');
  if (!existsSync(planFile)) return { problem: `the armed plan ${armed.run_id} has no plan.jsonl` };
  if (fileSha256(planFile) !== armed.plan_sha) return { problem: `the plan of run ${armed.run_id} changed after it was armed` };
  const checkFile = join(dir, 'check.json');
  if (!existsSync(checkFile) || readJson(checkFile).plan_sha !== armed.plan_sha) return { problem: `the batch files of run ${armed.run_id} are not from the armed plan; run plan.mjs check again` };
  return { armed, dir, ...readBatches(dir) };
}

function pageSha(parent, page) {
  return h16(canon({ parent, properties: page.properties, content: page.content ?? null }));
}

function decideCreate(toolInput, state) {
  const extra = Object.keys(toolInput).filter((k) => !CREATE_KEYS.has(k));
  if (extra.length) return deny(`notion-create-pages carries ${extra.join(', ')}, which no plan batch has`);
  const parent = isObject(toolInput.parent) ? normId(toolInput.parent.data_source_id ?? toolInput.parent.database_id ?? toolInput.parent.page_id) : '';
  if (!parent) return deny('notion-create-pages has no parent data source');
  if (!Array.isArray(toolInput.pages) || toolInput.pages.length === 0) return deny('notion-create-pages has no pages');
  const ledgerFile = join(state.dir, 'guard-ledger.jsonl');
  const sent = new Set(existsSync(ledgerFile) ? readJsonl(ledgerFile).rows.map((r) => r.sha) : []);
  const batch = new Set();
  for (const [i, page] of toolInput.pages.entries()) {
    if (!isObject(page) || !isObject(page.properties)) return deny(`page ${i + 1} has no properties`);
    const extraKeys = Object.keys(page).filter((k) => !PAGE_KEYS.has(k));
    if (extraKeys.length) return deny(`page ${i + 1} carries ${extraKeys.join(', ')}, which no plan batch has`);
    const wanted = canon({ parent, properties: page.properties, content: page.content ?? null });
    const match = state.creates.find((c) => canon({ parent: c.parent, properties: c.properties, content: c.content }) === wanted);
    if (!match) {
      const sameParent = state.creates.filter((c) => c.parent === parent);
      const keyOf = (props) => Object.entries(props).find(([k]) => /^(Key|Geo ID|Tag title|Run title|Lesson title|Name)$/.test(k))?.[1];
      const near = sameParent.find((c) => keyOf(c.properties) !== undefined && keyOf(c.properties) === keyOf(page.properties));
      if (near) {
        const diff = [...new Set([...Object.keys(near.properties), ...Object.keys(page.properties)])].filter((k) => canon(near.properties[k]) !== canon(page.properties[k]));
        return deny(`page ${i + 1} differs from the planned page in ${diff.join(', ')}`);
      }
      return deny(`page ${i + 1} is not a create in the armed plan (run ${state.armed.run_id})`);
    }
    const sha = pageSha(parent, page);
    if (sent.has(sha) || batch.has(sha)) return deny(`page ${i + 1} was already created from this plan (duplicate create)`);
    batch.add(sha);
  }
  for (const sha of batch) appendJsonl(ledgerFile, { at: new Date().toISOString(), tool: 'create-pages', sha });
  return allow(`${toolInput.pages.length} page(s) match creates of the armed plan (run ${state.armed.run_id})`);
}

function decideUpdate(toolInput, state) {
  const d = isObject(toolInput.data) ? toolInput.data : toolInput;
  const outer = isObject(toolInput.data) ? Object.keys(toolInput).filter((k) => k !== 'data') : [];
  const extra = [...Object.keys(d).filter((k) => !UPDATE_KEYS.has(k)), ...outer];
  if (extra.length) return deny(`notion-update-page carries ${extra.join(', ')}, which a plan update does not`);
  if (d.command !== 'update_properties') return deny(`notion-update-page may only run update_properties, not ${JSON.stringify(d.command)}`);
  if (typeof d.page_id !== 'string' || !isObject(d.properties)) return deny('notion-update-page needs page_id and properties');
  const id = normId(d.page_id);
  const wanted = canon(d.properties);
  const forPage = state.updates.filter((u) => u.page_id === id);
  if (forPage.length === 0) return deny(`page ${d.page_id} is not updated by the armed plan (run ${state.armed.run_id})`);
  if (!forPage.some((u) => canon(u.properties) === wanted)) {
    const planned = forPage[0].properties;
    const diff = [...new Set([...Object.keys(planned), ...Object.keys(d.properties)])].filter((k) => canon(planned[k]) !== canon(d.properties[k]));
    return deny(`the properties differ from the planned update of page ${d.page_id}: ${diff.join(', ')}`);
  }
  return allow(`the update of page ${d.page_id} matches the armed plan (run ${state.armed.run_id})`);
}

/**
 * The decision for one hook input: { permissionDecision, permissionDecisionReason }, or { none: true } for a tool this hook does not guard.
 * Never throws.
 */
export function decide(input, { root = agentRoot() } = {}) {
  try {
    if (!isObject(input) || typeof input.tool_name !== 'string' || input.tool_name === '') return deny('the hook input has no tool_name, so it cannot be judged');
    const m = GUARDED.exec(input.tool_name);
    if (!m) return { none: true };
    const tool = m[1];
    if (!isObject(input.tool_input)) return deny(`${input.tool_name} has no tool_input`);
    const toolInput = input.tool_input;
    let config;
    try {
      config = readJson(join(root, 'config.json'));
    } catch {
      return deny('config.json is not readable, so the protected databases are unknown');
    }
    const hit = protectedMention(toolInput, config);
    if (hit) return deny(`the call mentions the protected database ${hit}; the real content databases are never written`);
    const editor = editorWrite(tool, toolInput);
    if (editor) return deny(`${editor}; no script or agent writes editor-owned fields`);
    if (tool === 'move-pages' || tool === 'duplicate-page') return deny(`${input.tool_name} is never allowed: no plan moves or duplicates a page`);
    if (SCHEMA_TOOLS.has(tool)) {
      return existsSync(controlPaths(root).setup)
        ? allow('runs/SETUP exists: schema work is allowed during setup')
        : deny('schema changes need the setup marker runs/SETUP (created by the engineer during setup)');
    }
    const state = armedBatches(root);
    if (state.problem) return deny(state.problem);
    return tool === 'create-pages' ? decideCreate(toolInput, state) : decideUpdate(toolInput, state);
  } catch (e) {
    return deny(`the guard hit an error and refuses: ${e?.message ?? e}`);
  }
}

/** The JSON the hook prints for an input. */
export function hookOutput(input, opts) {
  const d = decide(input, opts);
  if (d.none) return {};
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', ...d } };
}

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Take the stdin text, print the decision. Always returns 0. env (tests): { root }. */
export function main(stdinText, io = defaultIo, env = {}) {
  let input;
  try {
    input = JSON.parse(stdinText);
  } catch {
    io.out(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...deny('the hook input is not valid JSON') } }));
    return EXIT.OK;
  }
  io.out(JSON.stringify(hookOutput(input, { root: env.root ?? agentRoot() })));
  return EXIT.OK;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

if (isMain(import.meta.url)) process.exitCode = main(await readStdin());
