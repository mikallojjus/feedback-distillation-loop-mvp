// Folder locations and file-name safety. Windows host: node:path only, and never a ':' in an id or file name.

import { mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // <agent>/scripts/lib

/** <repo>/agents/claim-tagger, found from this file's location, so it works from any working directory. */
export function agentRoot() {
  return resolve(HERE, '..', '..');
}

/** The geo-agents repository root. */
export function repoRoot() {
  return resolve(agentRoot(), '..', '..');
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
