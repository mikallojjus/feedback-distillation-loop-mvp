#!/usr/bin/env node
// Setup: the one-time structural work in Notion, run by the engineer and ask-gated in .claude/settings.json.
//
//   The builder session (a marker file; nothing here reaches Notion)
//   node agents/claim-tagger-mvp/scripts/setup.mjs builder open --reason "<why>"     create runs/SETUP (one builder session)
//   node agents/claim-tagger-mvp/scripts/setup.mjs builder close                      remove runs/SETUP
//   node agents/claim-tagger-mvp/scripts/setup.mjs builder status                     say whether a session is open and what is registered
//   node agents/claim-tagger-mvp/scripts/setup.mjs register page --id <id> --name <role>      register a page the session created
//   node agents/claim-tagger-mvp/scripts/setup.mjs register database --id <id> --name <role>  register a table the session created
//
//   The structure (needs no session: files and reads only)
//   setup.mjs structure --from-proposal <STRUCTURE.md>   write setup/structure.json from the approved proposal; print the counts
//   setup.mjs preview                                     print what the structure would build
//   setup.mjs api-check                                   one GET of the parent page under the builder API version -> runs/builder/api-check.json
//   setup.mjs verify [--taxonomy f] [--claims f] [--audit f]   read everything back and list the differences -> runs/builder/verify.json
//
//   The build (needs the session: runs/SETUP)
//   setup.mjs pages | databases | views | build           the sub-pages, the five tables and the columns a table lacks, the views (build = all three), resumable and safe to run again
//                                                         on a table that exists: it renames the columns the structure renames (Agent tags and Agent notes to "(old)", Claim quality
//                                                         tags — verified to Verified tags), adds the columns the table lacks (the revision of 21 October: Agent tags as a relation,
//                                                         Agent status, Tags waiting, Agent edition, Agent remarks), renames a view of an older build that the structure renames
//                                                         (not made again), and brings every view of a table to the structure: its filter, sorts, shown columns in order, wrap; the
//                                                         Claims copy's own default view gets the column order too. It says what it did, and a second run does nothing
//   setup.mjs rulebook [--from setup/taxonomy-issue.json] the 13 rows of the Rulebook copy (a setup plan, applied and read back)
//   setup.mjs claims [--from setup/claims-pick.json]      the 50 rows of the Claims copy, Geo Sources with its links
//   setup.mjs seed-audit [--from <audit json>]            the audit's ten decisions as decided rows of Tag decisions (the agent's ledger)
//   setup.mjs migrate-decisions                           the decisions in Tag decisions carried over, once, to the claims they are about (Reviewed, Verified tags, the
//                                                         audit's words); Decided under on the ledger rows; Agent confidence on the claims that wait
//   setup.mjs rubric [--from setup/taxonomy-issue.json]   rubric/ edition <today>.1 from the taxonomy file (local files only)
//   setup.mjs canaries [--from setup/taxonomy-issue.json] evals/canaries.jsonl (local file only)
//   setup.mjs settings                                    the one Agent settings row (run rubric first)
//   setup.mjs all --taxonomy <f> --claims <f> --audit <f> every step above in order, ending with verify; run it again after a stop
//
// Why a builder session: the connector guard (scripts/hooks/guard.mjs) denies every Notion write unless runs/SETUP exists and the
// target is registered in runs/builder/pages.json or runs/builder/databases.json. Opening a session is a deliberate, logged act; the
// session is closed as soon as the structural work is done, so that no later connector write can slip through. Registered ids are
// also written to config.json under notion.pages (pages) so the scripts find them.
//
// The build goes through the REST client only (hard rule 2): the structure with Notion-Version 2026-03-11 (lib/notion-build.mjs), the rows
// with the default version as plans applied by lib/plan.mjs (hard rule 1; lib/setup-steps.mjs). Every command writes runs/<run-id>/run.json
// (started, then finished with the exit code and the command that resumes it), plans, ledgers and a request log; the structure steps also
// keep runs/builder/requests.jsonl and runs/builder/state.json. A command that stops halfway is run again with the same arguments: it reads
// Notion first and does only what is missing.
//
// Exit codes: 0 ok, 1 error (run the same command again), 2 invalid (usage, a missing input, a plan or a read-back that failed), 3 paused.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { builderPaths, logLine, readJsonOr, register } from './lib/builder-registry.mjs';
import { loadConfig } from './lib/config.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { writeJsonAtomic } from './lib/jsonl.mjs';
import { StructureError, countStructure, loadStructure, renderPreview, saveStructure, structureFromProposal } from './lib/notion-build.mjs';
import { BUILDER_API_VERSION, clientFromConfig, requestLogger } from './lib/notion-rest.mjs';
import { agentRoot, isMain, repoRoot, runId } from './lib/paths.mjs';
import { PlanError } from './lib/plan.mjs';
import { readRubric } from './lib/rubric.mjs';
import * as steps from './lib/setup-steps.mjs';

export { builderPaths, register };

export const USAGE = [
  'usage: setup.mjs builder open --reason "<why>" | builder close | builder status',
  '       setup.mjs register page|database --id <id> --name <role>',
  '       setup.mjs structure --from-proposal <STRUCTURE.md> | preview | api-check | verify [--taxonomy f] [--claims f] [--audit f]',
  '       setup.mjs pages | databases | views | build            (needs a builder session)',
  '       setup.mjs rulebook [--from f] | claims [--from f] | seed-audit [--from f] | migrate-decisions | rubric [--from f] | canaries [--from f] | settings',
  '       setup.mjs all --taxonomy <f> --claims <f> --audit <f>',
].join('\n');

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

export function builderStatus({ root = agentRoot() } = {}) {
  const paths = builderPaths(root);
  const open = existsSync(paths.marker);
  const pages = readJsonOr(paths.pages, { pages: [], names: {} });
  const databases = readJsonOr(paths.databases, { ids: [], names: {} });
  return {
    ok: true,
    open,
    message: `${open ? 'a builder session is open' : 'no builder session is open'}; ${pages.pages.length} page(s) and ${databases.ids.length} table(s) registered`,
    pages: pages.names,
    databases: databases.names,
  };
}

// ---- the commands that build ----------------------------------------------------------------------------------------------------------------

const FROM = { from: { type: 'string' } };
const INPUTS = { taxonomy: { type: 'string' }, claims: { type: 'string' }, audit: { type: 'string' } };

// setup: the command needs an open builder session (and stops when the agent is paused)
const COMMANDS = {
  structure: { setup: false, options: { 'from-proposal': { type: 'string' } } },
  preview: { setup: false },
  'api-check': { setup: false },
  verify: { setup: false, options: INPUTS },
  pages: { setup: true },
  databases: { setup: true },
  views: { setup: true },
  build: { setup: true },
  rulebook: { setup: true, options: FROM },
  claims: { setup: true, options: FROM },
  'seed-audit': { setup: true, options: FROM },
  'migrate-decisions': { setup: true },
  rubric: { setup: true, options: FROM },
  canaries: { setup: true, options: FROM },
  settings: { setup: true },
  all: { setup: true, options: INPUTS },
};

const ALL_STEPS = ['api-check', 'pages', 'databases', 'views', 'rulebook', 'claims', 'seed-audit', 'migrate-decisions', 'rubric', 'canaries', 'settings', 'verify'];

const quote = (s) => (/[\s"']/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
const resumeCommand = (argv) => `node agents/claim-tagger-mvp/scripts/setup.mjs ${argv.map(quote).join(' ')}`.trim();

function currentEdition(root) {
  try {
    return readRubric(root)?.edition ?? null;
  } catch {
    return null;
  }
}

/** runs/<run-id>/run.json, written first (started) and last (finished); the folder name is never reused. */
function beginRun({ root, kind, argv, now }) {
  const base = runId(kind, now());
  let id = base;
  for (let n = 2; existsSync(join(root, 'runs', id)); n += 1) id = `${base}-${n}`;
  const dir = join(root, 'runs', id);
  mkdirSync(dir, { recursive: true });
  const record = {
    run_id: id, script: 'setup.mjs', args: argv, started_at: now().toISOString(), finished_at: null, exit_code: null, rubric_edition: currentEdition(root), pull_id: null, resume: resumeCommand(argv),
  };
  const file = join(dir, 'run.json');
  writeJsonAtomic(file, record);
  return {
    id,
    dir,
    record,
    update(fields) {
      Object.assign(record, fields);
      writeJsonAtomic(file, record);
    },
    finish(code) {
      record.finished_at = now().toISOString();
      record.exit_code = code;
      record.rubric_edition = currentEdition(root);
      writeJsonAtomic(file, record);
    },
  };
}

// The context the steps get: the state root, the config, the clock, the run folder, the two output channels and the two Notion clients.
function makeContext({ root, config, env, run, io }) {
  const now = env.now ?? (() => new Date());
  const memo = new Map();
  const build = (kind, { logFile, optional = false } = {}) => {
    if (memo.has(kind)) return memo.get(kind);
    let client = kind === 'rest' ? env.client : env.builderClient;
    if (client === undefined) {
      client = clientFromConfig(config, {
        apiVersion: kind === 'builder' ? config.notion.builder_api_version ?? BUILDER_API_VERSION : undefined,
        fetchImpl: env.fetchImpl, token: env.token, repoRoot: env.repoRoot, sleep: env.sleep, log: requestLogger(logFile ?? join(run.dir, 'requests.jsonl')),
      });
    }
    if (!client && !optional) throw new steps.InputError('there is no NOTION_TOKEN in .env, so Notion cannot be reached by script');
    memo.set(kind, client);
    return client;
  };
  return {
    root, config, now, run,
    log: (line) => io.out(line),
    warn: (line) => io.err(`setup: warning: ${line}`),
    restClient: (opts) => build('rest', opts),
    builderClient: (opts) => build('builder', opts),
  };
}

function defaultAudit(root) {
  const own = join(root, 'setup', 'audit-decisions.json');
  if (existsSync(own)) return own;
  const evidence = join(repoRoot(), 'docs', 'mvp-2026-11', 'evidence', '03-audit-context-dependent-decisions.json');
  return existsSync(evidence) ? evidence : undefined;
}

const path = (p) => (p ? resolve(p) : undefined);

// Run one step; returns { code, lines, errors, ... }.
async function dispatch(name, values, ctx) {
  const { root } = ctx;
  switch (name) {
    case 'structure': {
      const from = path(values['from-proposal']) ?? join(repoRoot(), 'docs', 'mvp-2026-11', 'STRUCTURE.md');
      if (!existsSync(from)) throw new steps.InputError(`the proposal does not exist (${from})`);
      const structure = structureFromProposal(readFileSync(from, 'utf8'));
      const file = saveStructure(root, structure);
      const c = countStructure(structure);
      return { code: EXIT.OK, lines: [`structure: ${c.tables} tables, ${c.columns} columns, ${c.views} views, ${c.pages} sub-pages -> ${relative(process.cwd(), file) || file}`] };
    }
    case 'preview':
      return { code: EXIT.OK, lines: [renderPreview(loadStructure(root)).trimEnd()] };
    case 'api-check':
      return steps.stepApiCheck(ctx);
    case 'pages':
      return steps.stepStructure(ctx, ['pages']);
    case 'databases':
      return steps.stepStructure(ctx, ['databases']);
    case 'views':
      return steps.stepStructure(ctx, ['views']);
    case 'build':
      return steps.stepStructure(ctx, ['pages', 'databases', 'views']);
    case 'rulebook':
      return steps.stepRulebook(ctx, { from: path(values.from) });
    case 'claims':
      return steps.stepClaims(ctx, { from: path(values.from) });
    case 'seed-audit':
      return steps.stepSeedAudit(ctx, { from: path(values.from) ?? defaultAudit(root) });
    case 'migrate-decisions':
      return steps.stepMigrateDecisions(ctx);
    case 'rubric':
      return steps.stepRubric(ctx, { from: path(values.from) });
    case 'canaries':
      return steps.stepCanaries(ctx, { from: path(values.from) });
    case 'settings':
      return steps.stepSettings(ctx);
    case 'verify':
      return steps.stepVerify(ctx, { taxonomy: path(values.taxonomy), claims: path(values.claims), audit: path(values.audit) ?? defaultAudit(root) });
    default:
      throw new Error(`setup: no such step "${name}"`);
  }
}

// What a thrown error means for the exit code, and what to tell the engineer.
function failure(e) {
  if (e instanceof steps.InputError || e instanceof StructureError) return { code: EXIT.INVALID, errors: [e.message] };
  if (e instanceof PlanError) return { code: EXIT.INVALID, errors: [e.message, ...e.problems.map((p) => `  ${p}`)] };
  if (e?.name === 'NotionError' && [401, 403, 404].includes(e.status)) {
    return { code: EXIT.INVALID, errors: [e.message, 'Notion refused the request; check the token and that the integration is connected to the parent page'] };
  }
  if (e?.code === 'BROKEN_CURSOR') return { code: EXIT.INVALID, errors: [e.message] };
  return { code: EXIT.ERROR, errors: [e?.message ?? String(e)] };
}

function show(io, out) {
  for (const line of out.lines ?? []) io.out(line);
  for (const line of out.errors ?? []) io.err(line);
}

async function runOne(name, argv, values, { root, config, env, io }) {
  const now = env.now ?? (() => new Date());
  const run = beginRun({ root, kind: `setup-${name}`, argv, now });
  const ctx = makeContext({ root, config, env, run, io });
  let out;
  try {
    out = await dispatch(name, values, ctx);
  } catch (e) {
    out = failure(e);
  }
  run.finish(out.code);
  return { out, run };
}

async function runAll(argv, values, { root, config, env, io }) {
  const now = env.now ?? (() => new Date());
  const overall = beginRun({ root, kind: 'setup-all', argv, now });
  const results = [];
  let code = EXIT.OK;
  for (const name of ALL_STEPS) {
    const { out, run } = await runOne(name, childArgv(name, values), stepValues(name, values), { root, config, env, io });
    results.push({ step: name, run_id: run.id, exit_code: out.code });
    show(io, out);
    if (out.code !== EXIT.OK && out.fatal !== false) {
      code = Math.max(code, out.code);
      io.err(name === 'verify'
        ? `setup all: every step ran, but verify found differences (exit ${out.code}); fix what is named above and run the same command again: every step does only what is missing`
        : `setup all: stopped at "${name}" (exit ${out.code}); fix what is named above and run the same command again: every step does only what is missing`);
      break;
    }
    if (out.code !== EXIT.OK) code = Math.max(code, out.code);
  }
  if (code === EXIT.OK) io.out('setup all: every step finished and the read-back found no differences; close the session with: setup.mjs builder close');
  overall.update({ steps: results });
  overall.finish(code);
  return code;
}

// "all" tells each step which file to read: the taxonomy file for rulebook, rubric and canaries, the pick for claims, the audit for seed-audit.
function stepValues(name, values) {
  switch (name) {
    case 'rulebook': case 'rubric': case 'canaries': return { from: values.taxonomy };
    case 'claims': return { from: values.claims };
    case 'seed-audit': return { from: values.audit };
    case 'verify': return { taxonomy: values.taxonomy, claims: values.claims, audit: values.audit };
    default: return {};
  }
}

// the command line a step of "all" would have had on its own (run.json keeps it as the way to resume that step)
function childArgv(name, values) {
  const sv = stepValues(name, values);
  const flags = [];
  for (const [flag, value] of Object.entries(sv)) if (value) flags.push(`--${flag}`, value);
  return [name, ...flags];
}

async function runCommand(name, args, io, env) {
  const spec = COMMANDS[name];
  let values;
  try {
    ({ values } = parseArgs({ args, options: { ...(spec.options ?? {}), help: { type: 'boolean', short: 'h' } }, strict: true, allowPositionals: false }));
  } catch (e) {
    io.err(`setup ${name}: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (values.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  const root = env.root ?? agentRoot();
  if (spec.setup && !existsSync(builderPaths(root).marker)) {
    io.err(`setup ${name}: no builder session is open (runs/SETUP is missing); open one with: setup.mjs builder open --reason "<why>"`);
    return EXIT.INVALID;
  }
  if (spec.setup && existsSync(join(root, 'runs', 'PAUSED'))) {
    io.err(`setup ${name}: runs/PAUSED exists, so the agent is paused and nothing was done; a person has to remove it`);
    return EXIT.PAUSED;
  }
  let config = null;
  if (name !== 'structure' && name !== 'preview') {
    try {
      config = env.config ?? loadConfig(root);
    } catch (e) {
      io.err(`setup ${name}: ${e.message}`);
      return EXIT.INVALID;
    }
  }
  const argv = [name, ...args];
  if (name === 'all') {
    const code = await runAll(argv, { ...values }, { root, config, env, io });
    return code;
  }
  const { out } = await runOne(name, argv, values, { root, config, env, io });
  show(io, out);
  return out.code;
}

export async function main(argv = process.argv.slice(2), io = { out: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`) }, env = {}) {
  const [group, verb] = argv;
  const rest = argv.slice(2);
  let result;
  if (Object.hasOwn(COMMANDS, group ?? '')) return runCommand(group, argv.slice(1), io, env);
  if (group === 'builder' && verb === 'open') {
    const { values } = parseArgs({ args: rest, options: { reason: { type: 'string' } }, allowPositionals: false });
    result = openBuilder({ root: env.root, reason: values.reason, now: env.now });
  } else if (group === 'builder' && verb === 'close') result = closeBuilder({ root: env.root });
  else if (group === 'builder' && verb === 'status') result = builderStatus({ root: env.root });
  else if (group === 'register' && (verb === 'page' || verb === 'database')) {
    const { values } = parseArgs({ args: rest, options: { id: { type: 'string' }, name: { type: 'string' } }, allowPositionals: false });
    result = register({ root: env.root, kind: verb, id: values.id, name: values.name });
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

if (isMain(import.meta.url)) process.exitCode = await main();
