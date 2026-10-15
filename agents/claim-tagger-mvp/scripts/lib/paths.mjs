// Folder locations and file-name safety. Windows host: node:path only, and never a ':' in an id or file name.
//
// A copy of agents/claim-tagger/scripts/lib/paths.mjs, and it has to be a copy: codeRoot() is found from this file's own location,
// so the old module would keep answering with the old agent's folder. Everything else is the old code, export for export; only the
// state-root override has its own name (CLAIM_TAGGER_MVP_ROOT), so a variable set for the old agent's walkthrough sandbox can never
// point this agent at a different folder.

import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // <agent>/scripts/lib

/** The environment variable that points the scripts at another state folder (a sandbox or a test folder). The old agent's CLAIM_TAGGER_ROOT is ignored here. */
export const ROOT_ENV = 'CLAIM_TAGGER_MVP_ROOT';

/** <repo>/agents/claim-tagger-mvp, found from this file's location: the code (scripts, schemas, prompts). Never moves. */
export function codeRoot() {
  return resolve(HERE, '..', '..');
}

/**
 * The state folder the scripts work on: config.json, rubric/, evals/, runs/. That is the agent folder itself, unless CLAIM_TAGGER_MVP_ROOT
 * names another one, so the same code can run a separate copy of the loop.
 */
export function agentRoot() {
  const override = process.env[ROOT_ENV];
  return override ? resolve(override) : codeRoot();
}

/** The geo-agents repository root (where .env lives), always found from the code, never from a sandbox. */
export function repoRoot() {
  return resolve(codeRoot(), '..', '..');
}

/** A code file (a schema, a prompt) for a state root: the root's own copy when it has one, else the agent folder's. */
export function codeFile(root, ...parts) {
  const own = join(root, ...parts);
  return existsSync(own) ? own : join(codeRoot(), ...parts);
}

/** <agent>/runs, the git-ignored folder for pulls, judgments, plans and cards. */
export function runsDir() {
  return join(agentRoot(), 'runs');
}

/** Replace anything outside [A-Za-z0-9._-] with '-'. A result that is empty or only dots can never name "." or "..". */
export function safeName(s) {
  const out = String(s).replace(/[^A-Za-z0-9._-]/gu, '-');
  return /^\.*$/.test(out) ? out.replace(/\./g, '-') || '-' : out;
}

const two = (n) => String(n).padStart(2, '0');

/** YYYYMMDDTHHMMSSZ-<kind> in UTC, built from parts because an ISO string has colons. */
export function runId(kind, date = new Date()) {
  const d = date;
  const stamp = `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}T${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`;
  return `${stamp}-${safeName(kind)}`;
}

/** mkdir -p; returns the path. */
export function ensureDir(p) {
  mkdirSync(p, { recursive: true });
  return p;
}

/**
 * The main guard for scripts: isMain(import.meta.url). Compares real paths, so a drive-letter case difference or a
 * junction on Windows cannot make a script silently do nothing (comparing import.meta.url with argv[1] can).
 */
export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync.native(fileURLToPath(metaUrl)) === realpathSync.native(resolve(argv1));
  } catch {
    return false;
  }
}
