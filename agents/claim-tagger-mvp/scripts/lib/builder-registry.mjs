// The builder session's files: the marker runs/SETUP, the registry of what the session created (runs/builder/pages.json and
// databases.json) and the session log. These functions used to sit in scripts/setup.mjs; they moved here, unchanged, so that the REST
// structure builder (lib/notion-build.mjs) can register the pages and tables it makes without importing a script. setup.mjs re-exports
// builderPaths and register, so every caller keeps working.
//
//   builderPaths(root)                       -> { marker, dir, pages, databases, log, config }
//   register({ root, kind, id, name })       -> { ok, message }; kind is page or database. Writes the registry; a page also goes into
//                                               config.json under notion.pages.<name>. Ids are stored without dashes.
//   logLine(paths, entry)                    -> appends one line to runs/builder/log.jsonl
//   normBuilderId(id), readJsonOr(file, fallback), writeJsonPretty(file, value)
//
// Why a registry: the connector guard (scripts/hooks/guard.mjs) denies every Notion write unless runs/SETUP exists and the target is
// registered here. Nothing in this file reaches Notion.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentRoot } from './paths.mjs';

export const normBuilderId = (id) => String(id ?? '').replace(/^collection:\/\//, '').replace(/.*\/p\//, '').replace(/[?#].*$/, '').replace(/-/g, '').toLowerCase();

export function readJsonOr(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

export function writeJsonPretty(file, value) {
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

export function logLine(paths, entry) {
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.log, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { flag: 'a' });
}

/** Register a page or database the open session created: the guard allows later connector content writes on registered targets. */
export function register({ root = agentRoot(), kind, id, name } = {}) {
  const paths = builderPaths(root);
  if (!['page', 'database'].includes(kind)) return { ok: false, message: 'register needs page or database' };
  const clean = normBuilderId(id);
  if (!/^[0-9a-f]{32}$/.test(clean)) return { ok: false, message: `not a Notion id: ${id}` };
  if (!name || !/^[a-z][a-z0-9_-]*$/.test(name)) return { ok: false, message: 'register needs --name <role> (lower-case letters, digits, _ or -)' };
  const file = kind === 'page' ? paths.pages : paths.databases;
  const key = kind === 'page' ? 'pages' : 'ids';
  const registry = readJsonOr(file, { [key]: [], names: {} });
  if (!registry[key].includes(clean)) registry[key].push(clean);
  registry.names[name] = clean;
  writeJsonPretty(file, registry);
  if (kind === 'page') {
    const config = readJsonOr(paths.config, null);
    if (config) {
      config.notion = config.notion ?? {};
      config.notion.pages = config.notion.pages ?? {};
      config.notion.pages[name] = clean;
      writeJsonPretty(paths.config, config);
    }
  }
  logLine(paths, { event: 'register', kind, id: clean, name });
  return { ok: true, message: `${kind} ${name} registered: ${clean}` };
}
