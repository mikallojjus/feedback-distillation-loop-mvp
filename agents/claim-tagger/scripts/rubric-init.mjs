#!/usr/bin/env node
// Day-0 setup of the rubric: copy the 13 Oct research snapshot, replace names by roles (config.json anonymise.replacements),
// recompute every hash, and write rubric/rubric.json, rubric.lock, CHANGELOG.md and history/<version>.json.
//
//   node agents/claim-tagger/scripts/rubric-init.mjs [--from <fixture>] [--version 2026-10-13.1] [--force]
//   (test hooks: --rubric-dir <dir> writes somewhere else, --config <file> reads another config)
//
// Refuses to overwrite an existing rubric.json unless --force. Exit codes: 0 done, 2 refused or invalid, 1 unexpected error.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXIT } from './lib/exit-codes.mjs';
import { fileSha256 } from './lib/hash.mjs';
import { readJson, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { agentRoot, codeRoot, isMain, repoRoot, safeName } from './lib/paths.mjs';
import { checkHashes, rehash, scrubNames } from './lib/rubric-build.mjs';
import { validate } from './lib/validate.mjs';

const SOURCE_NOTE = 'copied from the 13 Oct research snapshot, names replaced by roles';
const CHANGE = 'Initial rubric: copied from the 13 Oct research snapshot, names replaced by roles, every hash recomputed.';
const USAGE = 'usage: node agents/claim-tagger/scripts/rubric-init.mjs [--from <fixture>] [--version YYYY-MM-DD.n] [--force]';
const VERSION_RE = /^\d{4}-\d{2}-\d{2}\.\d+$/;

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--from': opts.from = resolve(value()); break;
      case '--version': opts.version = value(); break;
      case '--force': opts.force = true; break;
      case '--rubric-dir': opts.rubricDir = resolve(value()); break;
      case '--config': opts.config = resolve(value()); break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new UsageError(`unknown argument ${arg}`);
    }
  }
  return opts;
}

function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  return value;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The scrubbed copy of the research rubric with the new version and fresh hashes. Pure: no files. */
export function initialRubric(fixture, { replacements, version }) {
  const rubric = mapStrings(fixture, (s) => scrubNames(s, replacements));
  rubric.rubric_version = version;
  rubric.source = { ...rubric.source, note: SOURCE_NOTE };
  rubric.changelog = [{ version, date: version.slice(0, 10), by: 'rubric-init', change: CHANGE }];
  return rehash(rubric);
}

function leftoverNames(rubric, replacements) {
  const text = JSON.stringify(rubric);
  return replacements.map(([from]) => from).filter((from) => from && new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(from)}(?![\\p{L}\\p{N}_])`, 'iu').test(text));
}

function upsertChangelog(path, version, line) {
  const header = ['# Rubric changelog', '', 'One line per rubric version, oldest first: version (date), who, what changed, and the hashes of that version.', ''];
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((l, i, all) => !(i === all.length - 1 && l === '')) : header;
  writeTextAtomic(path, [...lines.filter((l) => !l.startsWith(`- ${version} `)), line].join('\n') + '\n');
}

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Run the script; returns the exit code. */
export function main(argv, io = defaultIo) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.err(`rubric-init: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (opts.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  try {
    const rubricDir = opts.rubricDir ?? join(agentRoot(), 'rubric');
    const rubricPath = join(rubricDir, 'rubric.json');
    if (existsSync(rubricPath) && !opts.force) {
      io.err(`rubric-init: ${rubricPath} already exists; nothing was changed. Re-run with --force to replace it.`);
      return EXIT.INVALID;
    }
    const fixture = readJson(opts.from ?? join(repoRoot(), 'tests', 'fixtures', 'rubric.research-example.json'));
    const replacements = readJson(opts.config ?? join(agentRoot(), 'config.json')).anonymise?.replacements;
    if (!Array.isArray(replacements)) {
      io.err('rubric-init: config.json has no anonymise.replacements list (an empty list is fine); refusing to copy a rubric that may name people.');
      return EXIT.INVALID;
    }
    const version = opts.version ?? fixture.rubric_version;
    if (!VERSION_RE.test(version)) {
      io.err(`rubric-init: version "${version}" is not YYYY-MM-DD.n`);
      return EXIT.INVALID;
    }

    const rubric = initialRubric(fixture, { replacements, version });
    const problems = [
      ...checkHashes(rubric).mismatches.map((m) => `hash mismatch: ${m.kind} ${m.where}`),
      ...validate(readJson(join(codeRoot(), 'schemas', 'rubric.schema.json')), rubric).errors,
      ...leftoverNames(rubric, replacements).map((n) => `the name "${n}" is still in the rubric`),
    ];
    if (problems.length) {
      io.err(`rubric-init: the rubric is not valid, nothing was written:\n  ${problems.slice(0, 10).join('\n  ')}`);
      return EXIT.INVALID;
    }

    let replaced = null;
    if (existsSync(rubricPath)) {
      try {
        replaced = readJson(rubricPath).rubric_version;
      } catch {
        replaced = 'unreadable file'; // --force exists for exactly this: replacing a rubric that cannot be read
      }
    }
    writeJsonAtomic(rubricPath, rubric);
    const sha = fileSha256(rubricPath);
    writeJsonAtomic(join(rubricDir, 'rubric.lock'), {
      rubric_version: version,
      rubric_hash: rubric.rubric_hash,
      scope_hash: rubric.scope_hash,
      file_sha256: sha,
      locked_at: new Date().toISOString(),
    });
    writeTextAtomic(join(rubricDir, 'history', `${safeName(version)}.json`), readFileSync(rubricPath, 'utf8'));
    upsertChangelog(
      join(rubricDir, 'CHANGELOG.md'),
      version,
      `- ${version} (${version.slice(0, 10)}), rubric-init: ${CHANGE} rubric_hash ${rubric.rubric_hash}, scope_hash ${rubric.scope_hash}.`,
    );
    io.out(
      `rubric-init: wrote ${rubricPath} version ${version} (${rubric.tag_count} tags, ${rubric.judged_count} judged)` +
      ` rubric_hash=${rubric.rubric_hash} scope_hash=${rubric.scope_hash} file_sha256=${sha.slice(0, 16)}` +
      (replaced ? ` (replaced version ${replaced})` : ''),
    );
    return EXIT.OK;
  } catch (e) {
    io.err(`rubric-init: ${e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
