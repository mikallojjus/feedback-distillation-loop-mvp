#!/usr/bin/env node
// Setup: the one-time structural work in Notion, run by the engineer and ask-gated in .claude/settings.json.
//
//   node agents/claim-tagger-mvp/scripts/setup.mjs builder open --reason "<why>"     create runs/SETUP (one builder session)
//   node agents/claim-tagger-mvp/scripts/setup.mjs builder close                      remove runs/SETUP
//   node agents/claim-tagger-mvp/scripts/setup.mjs builder status                     say whether a session is open and what is registered
//   node agents/claim-tagger-mvp/scripts/setup.mjs register page --id <id> --name <role>      register a page the session created
//   node agents/claim-tagger-mvp/scripts/setup.mjs register database --id <id> --name <role>  register a table the session created
//
// Why a builder session: the connector guard (scripts/hooks/guard.mjs) denies every Notion write unless runs/SETUP exists and the
// target is registered in runs/builder/pages.json or runs/builder/databases.json. Opening a session is a deliberate, logged act; the
// session is closed as soon as the structural work is done, so that no later connector write can slip through. Registered ids are
// also written to config.json under notion.pages (pages) so the scripts find them. Nothing here reaches Notion: this file only
// writes the marker and the registry; the structural writes themselves go through the REST builder (later subcommands) or, for
// content pages such as the structure proposal, through the connector while the session is open.
//
// Exit codes: 0 ok, 2 usage error or a session already open / not open.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { EXIT } from './lib/exit-codes.mjs';
import { agentRoot, isMain } from './lib/paths.mjs';

export const USAGE = 'usage: setup.mjs builder open --reason "<why>" | builder close | builder status | register page|database --id <id> --name <role>';

const normId = (id) => String(id ?? '').replace(/^collection:\/\//, '').replace(/.*\/p\//, '').replace(/[?#].*$/, '').replace(/-/g, '').toLowerCase();

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function writeJson(file, value) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function builderPaths(root = agentRoot()) {
  return {
    marker: join(root, 'runs', 'SETUP'),
    dir: join(root, 'runs', 'builder'),
    pages: join(root, 'runs', 'builder', 'pages.json'),
    databases: join(root, 'runs', 'builder', 'databases.json'),
    log: join(root, 'runs', 'builder', 'log.jsonl'),
    config: join(root, 'config.json'),
  };
}

function logLine(paths, entry) {
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.log, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { flag: 'a' });
}

export function openBuilder({ root = agentRoot(), reason, now = () => new Date() } = {}) {
  const paths = builderPaths(root);
  if (existsSync(paths.marker)) return { ok: false, message: `a builder session is already open (${paths.marker}); close it first` };
  if (!reason || !String(reason).trim()) return { ok: false, message: 'builder open needs --reason "<why>"' };
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.marker, `${JSON.stringify({ opened_at: now().toISOString(), reason: String(reason).trim() })}\n`);
  logLine(paths, { event: 'open', reason: String(reason).trim() });
  return { ok: true, message: `builder session open: ${reason}` };
}

export function closeBuilder({ root = agentRoot() } = {}) {
  const paths = builderPaths(root);
  if (!existsSync(paths.marker)) return { ok: false, message: 'no builder session is open' };
  rmSync(paths.marker);
  logLine(paths, { event: 'close' });
  return { ok: true, message: 'builder session closed' };
}

/** Register a page or database the open session created: the guard allows later connector content writes on registered targets. */
export function register({ root = agentRoot(), kind, id, name } = {}) {
  const paths = builderPaths(root);
  if (!['page', 'database'].includes(kind)) return { ok: false, message: 'register needs page or database' };
  const clean = normId(id);
  if (!/^[0-9a-f]{32}$/.test(clean)) return { ok: false, message: `not a Notion id: ${id}` };
  if (!name || !/^[a-z][a-z0-9_-]*$/.test(name)) return { ok: false, message: 'register needs --name <role> (lower-case letters, digits, _ or -)' };
  const file = kind === 'page' ? paths.pages : paths.databases;
  const key = kind === 'page' ? 'pages' : 'ids';
  const registry = readJson(file, { [key]: [], names: {} });
  if (!registry[key].includes(clean)) registry[key].push(clean);
  registry.names[name] = clean;
  writeJson(file, registry);
  if (kind === 'page') {
    const config = readJson(paths.config, null);
    if (config) {
      config.notion = config.notion ?? {};
      config.notion.pages = config.notion.pages ?? {};
      config.notion.pages[name] = clean;
      writeJson(paths.config, config);
    }
  }
  logLine(paths, { event: 'register', kind, id: clean, name });
  return { ok: true, message: `${kind} ${name} registered: ${clean}` };
}

export function builderStatus({ root = agentRoot() } = {}) {
  const paths = builderPaths(root);
  const open = existsSync(paths.marker);
  const pages = readJson(paths.pages, { pages: [], names: {} });
  const databases = readJson(paths.databases, { ids: [], names: {} });
  return {
    ok: true,
    open,
    message: `${open ? 'a builder session is open' : 'no builder session is open'}; ${pages.pages.length} page(s) and ${databases.ids.length} table(s) registered`,
    pages: pages.names,
    databases: databases.names,
  };
}

export function main(argv = process.argv.slice(2), io = { out: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`) }) {
  const [group, verb] = argv;
  const rest = argv.slice(2);
  let result;
  if (group === 'builder' && verb === 'open') {
    const { values } = parseArgs({ args: rest, options: { reason: { type: 'string' } }, allowPositionals: false });
    result = openBuilder({ reason: values.reason });
  } else if (group === 'builder' && verb === 'close') result = closeBuilder();
  else if (group === 'builder' && verb === 'status') result = builderStatus();
  else if (group === 'register' && (verb === 'page' || verb === 'database')) {
    const { values } = parseArgs({ args: rest, options: { id: { type: 'string' }, name: { type: 'string' } }, allowPositionals: false });
    result = register({ kind: verb, id: values.id, name: values.name });
  } else {
    io.err(USAGE);
    return EXIT.INVALID;
  }
  (result.ok ? io.out : io.err)(result.message);
  if (result.ok && group === 'builder' && verb === 'status') {
    for (const [name, id] of Object.entries(result.pages)) io.out(`  page ${name}: ${id}`);
    for (const [name, id] of Object.entries(result.databases)) io.out(`  table ${name}: ${id}`);
  }
  return result.ok ? EXIT.OK : EXIT.INVALID;
}

if (isMain(import.meta.url)) process.exitCode = main();
