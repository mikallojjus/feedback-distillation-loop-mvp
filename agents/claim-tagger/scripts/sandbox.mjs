#!/usr/bin/env node
// The walkthrough sandbox: a small, separate copy of the loop that an editor can run end to end without touching the trial.
//
//   node agents/claim-tagger/scripts/sandbox.mjs <script> [args...]   run scripts/<script>.mjs against agents/claim-tagger/sandbox
//   node agents/claim-tagger/scripts/sandbox.mjs init [--force]       build the sandbox rubric, canaries and seed files
//
// The sandbox folder has its own config.json (six small Notion databases under the page Walkthrough), rubric/, evals/ and runs/;
// the code, schemas and prompts are the agent's own. A script run here sets CLAIM_TAGGER_ROOT for the child process only (see
// lib/paths.mjs), so the trial's config, rubric, cases and runs are never read or written by it.
//
// init reads sandbox/walkthrough.json (tags, decided keys, open keys) and the trial's rubric, canaries and seed files, and writes:
//   rubric/rubric.json, rubric.lock, CHANGELOG.md, history/<version>.json   the trial rubric cut down to the listed tags, rehashed
//   evals/canaries.jsonl                                                      the trial canaries of those tags
//   evals/cases.jsonl                                                         empty: cases-sync fills it from decided rows
//   evals/seed/claims.seed.jsonl, decisions.seed.jsonl                        the listed claims; decided rows carry Seeded outcome
//                                                                             Applies, open rows carry none (they wait in Your queue)
// Exit codes: init 0 done, 2 refused or invalid, 1 error; a script run returns the script's own exit code (2 for an unknown script).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from './lib/exit-codes.mjs';
import { fileSha256 } from './lib/hash.mjs';
import { readJson, readJsonl, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { ROOT_ENV, codeRoot, isMain, safeName } from './lib/paths.mjs';
import { checkHashes, rehash } from './lib/rubric-build.mjs';
import { validate } from './lib/validate.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/sandbox.mjs <script> [args...] | init [--force]';

/** The scripts an editor's walkthrough runs. Setup-only and repository tools (rubric-init, seed-build, snapshot, transcript-check) are left out. */
export const SCRIPTS = new Set(['allowlist', 'apply', 'cases-sync', 'distill', 'eval', 'followup', 'judge', 'plan', 'probe', 'promote', 'propose', 'pull', 'recard', 'run-card', 'seed', 'status', 'verify']);

export const sandboxRoot = () => join(codeRoot(), 'sandbox');

class InitError extends Error {}

const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');

/** The trial rubric cut down to `tags`, with its own version and changelog line, every hash recomputed. */
export function sandboxRubric(trial, { tags, version, date }) {
  const keep = new Set(tags);
  const missing = tags.filter((t) => !trial.tags.some((x) => x.name === t));
  if (missing.length) throw new InitError(`the trial rubric has no tag ${missing.join(', ')}`);
  const rubric = structuredClone(trial);
  rubric.rubric_version = version;
  rubric.tags = rubric.tags.filter((t) => keep.has(t.name));
  rubric.counterpart_pairs = (rubric.counterpart_pairs ?? []).filter(([a, b]) => keep.has(a) && keep.has(b));
  rubric.source = { ...rubric.source, note: `walkthrough sandbox: the trial rubric ${trial.rubric_version} cut down to ${tags.join(', ')}` };
  rubric.changelog = [{ version, date, by: 'sandbox init', change: `Walkthrough sandbox: tags ${tags.join(', ')} copied unchanged from the trial rubric ${trial.rubric_version}.` }];
  return rehash(rubric);
}

/** The sandbox seed rows: claims of every listed key, decided rows with Seeded outcome Applies, open rows waiting for an editor. */
export function sandboxSeed({ claims, decisions, cases, spec }) {
  const byKey = new Map(decisions.map((d) => [d.key, d]));
  const caseByKey = new Map(cases.map((c) => [c.key, c]));
  const claimById = new Map(claims.map((c) => [c.geo_id, c]));
  const rows = [];
  for (const [kind, keys] of [['decided', spec.decided], ['open', spec.open]]) {
    for (const key of keys) {
      const [geoId, tag] = key.split('::');
      if (!spec.tags.includes(tag)) throw new InitError(`${key} is on ${tag}, which is not a sandbox tag`);
      const d = byKey.get(key);
      if (kind === 'decided') {
        if (!d) throw new InitError(`the trial seed has no decision ${key}`);
        const expected = caseByKey.get(key)?.expected ?? (d.seeded_outcome === 'Applies' ? 'apply' : null);
        if (expected !== 'apply') throw new InitError(`${key} is listed as decided but the trial does not label it Applies`);
        rows.push({ ...d, why_in_queue: 'Seeded decision', seeded_outcome: 'Applies', seeded_reasoning: d.seeded_reasoning ?? 'Decided in the trial; copied for the walkthrough.', seeded_at: d.seeded_at ?? spec.rubric_version.slice(0, 10), why_wrong_hint: null });
      } else {
        // an open row waits in Your queue with no proposal yet: the first tag run fills the agent's side (the trial row may not be in its seed)
        rows.push({
          key, geo_id: geoId, tag, claim: d?.claim ?? claimById.get(geoId)?.claim ?? null, audit_row_url: d?.audit_row_url ?? null,
          agent_proposal: null, why_i_recommend_this: spec.open_note ?? null,
          agent_full_note: 'Walkthrough: queued before the first tag run; the tag run fills in the agent proposal, its confidence and its reason.',
          why_in_queue: 'Auditor flag', priority: 'High', rubric_version: 'walkthrough seed (before the first tag run)',
          seeded_outcome: null, seeded_reasoning: null, seeded_at: null, why_wrong_hint: null,
        });
      }
    }
  }
  const ids = [...new Set(rows.map((r) => r.geo_id))];
  const missing = ids.filter((id) => !claimById.has(id));
  if (missing.length) throw new InitError(`the trial seed has no claim ${missing.join(', ')}`);
  return { claims: ids.map((id) => claimById.get(id)), decisions: rows };
}

/** Build the sandbox's local files from the trial's. Refuses to replace a sandbox rubric unless force. */
export function init({ trialRoot = codeRoot(), root = sandboxRoot(), force = false, now = () => new Date() } = {}) {
  const spec = readJson(join(root, 'walkthrough.json'));
  const rubricPath = join(root, 'rubric', 'rubric.json');
  if (existsSync(rubricPath) && !force) throw new InitError(`${rubricPath} already exists; nothing was changed (use --force to rebuild it before the walkthrough starts)`);
  const trial = readJson(join(trialRoot, 'rubric', 'rubric.json'));
  const rubric = sandboxRubric(trial, { tags: spec.tags, version: spec.rubric_version, date: spec.rubric_version.slice(0, 10) });
  const problems = [...checkHashes(rubric).mismatches.map((m) => `hash ${m.kind} ${m.where}`), ...validate(readJson(join(codeRoot(), 'schemas', 'rubric.schema.json')), rubric).errors];
  if (problems.length) throw new InitError(`the sandbox rubric is not valid: ${problems.slice(0, 5).join('; ')}`);
  const tagHash = new Map(rubric.tags.map((t) => [t.name, t.tag_hash]));

  const canaries = readJsonl(join(trialRoot, 'evals', 'canaries.jsonl')).rows
    .filter((c) => tagHash.has(c.tag))
    .map((c) => ({ ...c, tag_hash: tagHash.get(c.tag), rubric_version: spec.rubric_version }));
  const seed = sandboxSeed({
    claims: readJsonl(join(trialRoot, 'evals', 'seed', 'claims.seed.jsonl')).rows,
    decisions: readJsonl(join(trialRoot, 'evals', 'seed', 'decisions.seed.jsonl')).rows,
    cases: readJsonl(join(trialRoot, 'evals', 'cases.jsonl')).rows,
    spec,
  });

  writeJsonAtomic(rubricPath, rubric);
  const sha = fileSha256(rubricPath);
  writeJsonAtomic(join(root, 'rubric', 'rubric.lock'), { rubric_version: rubric.rubric_version, rubric_hash: rubric.rubric_hash, scope_hash: rubric.scope_hash, file_sha256: sha, locked_at: now().toISOString() });
  writeTextAtomic(join(root, 'rubric', 'history', `${safeName(rubric.rubric_version)}.json`), readFileSync(rubricPath, 'utf8'));
  writeTextAtomic(join(root, 'rubric', 'CHANGELOG.md'), [
    '# Rubric changelog (walkthrough sandbox)', '',
    'One line per rubric version, oldest first: version (date), who, what changed, and the hashes of that version.', '',
    `- ${rubric.rubric_version} (${rubric.changelog[0].date}), sandbox init: ${rubric.changelog[0].change} rubric_hash ${rubric.rubric_hash}, scope_hash ${rubric.scope_hash}.`, '',
  ].join('\n'));
  writeTextAtomic(join(root, 'evals', 'canaries.jsonl'), toJsonl(canaries));
  writeTextAtomic(join(root, 'evals', 'cases.jsonl'), '');
  writeTextAtomic(join(root, 'evals', 'seed', 'claims.seed.jsonl'), toJsonl(seed.claims));
  writeTextAtomic(join(root, 'evals', 'seed', 'decisions.seed.jsonl'), toJsonl(seed.decisions));
  return `sandbox init: rubric ${rubric.rubric_version} (${rubric.tags.map((t) => t.name).join(', ')}; rubric_hash ${rubric.rubric_hash}), ${canaries.length} canaries, ${seed.claims.length} claims, ${seed.decisions.length} seed rows (${spec.decided.length} decided, ${spec.open.length} open)`;
}

/** Run scripts/<name>.mjs against the sandbox root; returns its exit code. */
export function runScript(name, args, { root = sandboxRoot(), spawn = spawnSync, io = defaultIo } = {}) {
  if (!SCRIPTS.has(name)) {
    io.err(`sandbox: "${name}" is not a walkthrough script (one of: ${[...SCRIPTS].sort().join(', ')})\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (!existsSync(join(root, 'config.json'))) {
    io.err(`sandbox: ${root} has no config.json; the sandbox is not set up (see the Engineer notes)`);
    return EXIT.INVALID;
  }
  io.err(`sandbox: running ${name} against ${root}`);
  const r = spawn(process.execPath, [join(codeRoot(), 'scripts', `${name}.mjs`), ...args], { stdio: 'inherit', env: { ...process.env, [ROOT_ENV]: root } });
  if (r.error) {
    io.err(`sandbox: could not start ${name}: ${r.error.message}`);
    return EXIT.ERROR;
  }
  return r.status ?? EXIT.ERROR;
}

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** The command line; returns the exit code. */
export function main(argv, io = defaultIo, env = {}) {
  const [first, ...rest] = argv;
  if (!first || first === '--help' || first === '-h') {
    (first ? io.out : io.err)(USAGE);
    return first ? EXIT.OK : EXIT.INVALID;
  }
  if (first === 'init') {
    const extra = rest.filter((a) => a !== '--force');
    if (extra.length) {
      io.err(`sandbox: init takes only --force, not ${extra.join(' ')}\n${USAGE}`);
      return EXIT.INVALID;
    }
    try {
      io.out(init({ root: env.root, trialRoot: env.trialRoot, force: rest.includes('--force') }));
      return EXIT.OK;
    } catch (e) {
      io.err(`sandbox: ${e.message}`);
      return e instanceof InitError ? EXIT.INVALID : EXIT.ERROR;
    }
  }
  return runScript(first, rest, { root: env.root ?? sandboxRoot(), spawn: env.spawn, io });
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
