#!/usr/bin/env node
// Walkthrough: the practice page of the claim tagger. It makes a fresh copy of the editor feedback loop on a Notion page the editor names (its own
// one-tag rulebook, nine real claims, five decided earlier and four that the editor decides on the Claims table, the agent's ledger, seven numbered steps), says where the
// editor is, and runs the loop scripts against it.
//
//   node agents/claim-tagger-mvp/scripts/walkthrough.mjs start --parent <link or id> [--dry-run] [--resume <id>] [--manifest <path>] [--title <text>]
//   node agents/claim-tagger-mvp/scripts/walkthrough.mjs run [--demo <id>] <pull|judge|propose|distill|promote|followup|status> [args...]
//   node agents/claim-tagger-mvp/scripts/walkthrough.mjs where [--demo <id>]
//   node agents/claim-tagger-mvp/scripts/walkthrough.mjs verify [--demo <id>] [--json]
//   node agents/claim-tagger-mvp/scripts/walkthrough.mjs list
//   node agents/claim-tagger-mvp/scripts/walkthrough.mjs decide [--demo <id>] --claim <key> [--outcome "Applies|Does not apply" [--reasoning "<text>"]]
//   node agents/claim-tagger-mvp/scripts/walkthrough.mjs approve [--demo <id>] [--lesson "<title>"] [--wording "<text>" | --clear-wording]
//   node agents/claim-tagger-mvp/scripts/walkthrough.mjs reject [--demo <id>] [--lesson "<title>"]
//
// start. --parent is required and has no default. Steps: (a) one GET of the parent page (unreachable, or protected: exit 2); (b) the profile under
// runs/demos/<id>/ (config.json, rubric/, evals/, demo.json, copies of the manifest and the page template); (c) setup-plan.json, which lists every
// request and every row before any is sent, and preview.md, the template rendered, checked by the page lint (a problem is exit 2 before anything is
// built); --dry-run stops here and has sent nothing but the GET (and a fetch that can only read guards it); (d) the page, its text, five tables (the
// relation of the Claims to the Rulebook is added once both exist), the Help toggle, five views, every id recorded in demo.json the moment it is known;
// (e) the rows, as plans applied by lib/plan.mjs in a profile whose runs/SETUP marker allows the editor's three columns on the five decided claims (the
// one exception to hard rule 1); the ledger (Tag decisions) gets a row for each of them, already read where the editor's outcome differs from the agent's proposal (Agent reading
// "Agent slip", Reading note "Seeded from the audit of 9 October.", decision 73), and the decided claims are created with their Agent reading; the four open claims have no ledger
// row and an empty Agent reading (the tag step and the distill step make them); (f) verify, and the report.
// A start that stops (exit 1) is continued by `start --resume <id>`: it reads Notion first, adopts a page or table of the right title that an
// earlier run made, and never creates what demo.json records. Nothing is ever deleted, archived or moved.
//
// How the page comes out in order. Blocks go to the end of a page and so do tables; a linked view can be put after a given block. So: the text up to
// the tables is appended first, then the five tables are made (they land after it), then the Help toggle, then the three tab views are made and the two
// linked views are put under the blocks they belong to. If Notion refuses a linked view the page gets, under the same block, a paragraph that says where to
// scroll (the fallback). The relations of the Claims (Agent tags, Tags waiting, Verified tags) are added once the Rulebook exists, so they would come last in the
// table's own view; once the views are made that view is set to the review order, as the three views of the Claims already show it (arrangeOwnViews): the agent's
// columns first, then the review columns, then the Geo columns.
//
// run. `node <script>.mjs <args>` as a child process with CLAIM_TAGGER_MVP_ROOT set to the demo's folder (by default the newest finished demo under the Demos sub-page
// whose profile this build reads; a page under Demo tests, or of an older shape, is reached only with --demo <id>). It
// refuses a script that is not on the list, a folder outside runs/demos, and --confirm, --bare, --fallback-model, --unpause. For promote and followup
// without --lesson it passes the title of the demo's only Approved (promote) or Live (followup) rule change from the newest pull. The exit code is
// the child's.
//
// where. Pulls the demo's tables and says which of the seven steps the editor is at (read from the Agent status of the four open claims - no status means the agent has not
// read the claim, "Waits for you" means it has read it and it waits - and Agent settings' Last run summary for steps 1 and 2 - a fresh page is at step 1, and status writes
// nothing, so it stays there until the tag step has run - then from the Review status of the open claims, the rule changes and, for step 7, the Follow-up of the ledger rows the
// live rule change rests on: two of the four, the other two keep Waits for you until the next tag run, decision 76), and the one thing to do next.
// verify. Reads the page and the tables back and lists what differs from what was built (the page lint, the five tables, the seeded readings on the ledger and on the decided
// claims, an empty Agent reading on the open claims, the counts the manifest expects, the views: the Claims table's columns in the review order on its own view and on the
// three views of the Claims, and their filters).
// list. The practice pages, newest first, with their state and step, and a mark on the one the commands reach when no page is named.
//
// decide, approve, reject (decision D31, the demo-only exception to hard rule 1: on a practice page the agent may act as the editor, so the
// calibration runs and the evals of the skill can go through all seven steps). decide enters the editor's three columns of one of the four claims that
// wait (Verified tags, Challenged tags notes, Review status: the values of the manifest's open[].enter when only --claim is
// given; --outcome Applies puts the tag among the verified tags, Does not apply leaves it out, the claim is Reviewed either way, and the note is empty unless --reasoning gives one);
// approve sets a rule change to Approved and may write Editor wording
// (the only Proposed rule change, or with --wording the only Approved one whose safety check did not pass); reject sets Rejected. Each is a plan with
// one update, checked by checkPlan with demoEditor (which allows nothing outside a practice page under runs/demos and nothing but these columns),
// applied and read back, and logged in runs/demos/<id>/editor-actions.jsonl before and after. They are not scripts that `run` starts.
//
// Exit codes: 0 ok, 1 stopped (start --resume continues; or an unexpected error), 2 invalid (a missing or wrong input, a protected or unreachable
// parent, a lint or plan problem, a read-back that differs, a verify that finds problems), 3 paused.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CLAIMS_COPY_COLUMNS, RULEBOOK_COLUMNS, TABLES, editorColumns, isProtected, loadConfig, tableEntry } from './lib/config.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { listNames, notionUrl, plural, quoted, tableLink, viewLink, yourClaims } from './lib/editor-words.mjs';
import { appendJsonl, readJson, readJsonl, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { blockText, countBlocks, lintPage } from './lib/notion-blocks.mjs';
import { StructureError, arrangeOwnViews, completeViewBody, planStructure, verifyStructure, viewPlan } from './lib/notion-build.mjs';
import { BUILDER_API_VERSION, NotionError, clientFromConfig, countRequests } from './lib/notion-rest.mjs';
import { normId, sameValue } from './lib/notion-values.mjs';
import { ROOT_ENV, codeFile, codeRoot, isMain, runId as makeRunId } from './lib/paths.mjs';
import { PlanError, applyPlan, checkPlan, isDemoRoot, newPlan } from './lib/plan.mjs';
import { READING_COLUMNS } from './lib/readings.mjs';
import { buildReport, lintReport, renderReport, writeReport } from './lib/report.mjs';
import { buildRubric, compareEditions, nextEdition, readEdition, readRubric, verifyRubric, writeEdition } from './lib/rubric.mjs';
import { InputError, SETTINGS_NAME, claimLink, claimOps, protectedInLinks, rulebookOps, unknownOptions, withLinkedSources } from './lib/setup-steps.mjs';
import { loadPull, latestPullId, pull, readOnlyFetch, richTextPieces } from './pull.mjs';
import * as dp from './lib/demo-profile.mjs';

export const USAGE = [
  'usage: node agents/claim-tagger-mvp/scripts/walkthrough.mjs start --parent <link or id> [--dry-run] [--resume <id>] [--manifest <path>] [--title <text>]',
  '       node agents/claim-tagger-mvp/scripts/walkthrough.mjs run [--demo <id>] <pull|judge|propose|distill|promote|followup|status> [args...]',
  '       node agents/claim-tagger-mvp/scripts/walkthrough.mjs where [--demo <id>]',
  '       node agents/claim-tagger-mvp/scripts/walkthrough.mjs verify [--demo <id>] [--json]',
  '       node agents/claim-tagger-mvp/scripts/walkthrough.mjs list',
  '       node agents/claim-tagger-mvp/scripts/walkthrough.mjs decide [--demo <id>] --claim <key> [--outcome "Applies|Does not apply" [--reasoning "<text>"]]',
  '       node agents/claim-tagger-mvp/scripts/walkthrough.mjs approve [--demo <id>] [--lesson "<title>"] [--wording "<text>" | --clear-wording]',
  '       node agents/claim-tagger-mvp/scripts/walkthrough.mjs reject [--demo <id>] [--lesson "<title>"]',
].join('\n');

export const RUN_SCRIPTS = Object.freeze(['pull', 'judge', 'propose', 'distill', 'promote', 'followup', 'status']);
/** Notion takes at most this many blocks in one request (the client splits a longer list the same way). */
const MAX_BLOCKS_PER_REQUEST = 100;
export const REFUSED_ARGS = Object.freeze(['--confirm', '--bare', '--fallback-model', '--unpause']);
/** A practice page that stopped is continued by asking again under the same link for this long; after that a new request makes a new page. */
export const RESUME_WINDOW_MS = 24 * 3600 * 1000;

const MESSAGES = Object.freeze({
  noParent: 'Under which Notion page should the demo go? Paste a link.',
  unreachable: 'In Notion, open that page, choose the connections menu and add the claim tagger connection, or pick another page.',
  protectedPage: 'that page is protected; pick another',
  dryNext: 'to build the page for real, ask again for a practice page under the same link',
});

const defaultIo = {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
  rawOut: (s) => process.stdout.write(s),
  rawErr: (s) => process.stderr.write(s),
};

/** The end of a command: an exit code, a message for stderr, and optionally the report to print. */
class Exit extends Error {
  constructor(exit, message, { report = null } = {}) {
    super(message);
    this.name = 'Exit';
    this.exit = exit;
    this.report = report;
  }
}
const stop = (exit, message, opts) => new Exit(exit, message, opts);

const text = (v) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());

// the two ways a parent page is refused: the plain message for the engineer, and the three-part report for the editor
const protectedStop = () => stop(EXIT.INVALID, MESSAGES.protectedPage, {
  report: { sentence: 'Walkthrough: no demo was created, because that page is protected.', rows: [], next: 'Next: paste the link of another Notion page.' },
});
const unreachableStop = () => stop(EXIT.INVALID, MESSAGES.unreachable, {
  report: {
    sentence: 'Walkthrough: no demo was created, because the claim tagger cannot reach that Notion page.',
    rows: [],
    next: `Next: ${MESSAGES.unreachable.charAt(0).toLowerCase()}${MESSAGES.unreachable.slice(1)}`,
  },
});
const oneLine = (s, n = 160) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// ---- reports ------------------------------------------------------------------------------------------------------------------------

// A title that someone chose may hold a word the report lint refuses; text in double quotes is exempt from it, so it goes in quotes then.
function sayable(title) {
  const plain = String(title ?? '').replace(/\s+/g, ' ').trim();
  return lintReport(`${plain}\n\nNext: x\n`).length === 0 ? plain : `"${plain.replace(/["“”]/g, "'")}"`;
}

function emit(io, parts, dir = null) {
  const full = { demo: false, ...parts };
  let markdown;
  if (dir) markdown = writeReport(dir, full).markdown;
  else {
    markdown = renderReport(buildReport(full));
    const problems = lintReport(markdown);
    if (problems.length) throw Object.assign(new Error(`the report does not pass the report lint: ${problems.join('; ')}`), { code: 'REPORT_LINT' });
  }
  io.out(markdown.trimEnd());
  return markdown;
}

// The table of a start or verify report. The ledger (Tag decisions) is the agent's own record and is not in it; the claims are what the editor decides.
const tablesNow = (counts) => [
  ['Rulebook', counts.rulebook === 1 ? '1 tag' : plural(counts.rulebook, 'tag'), ''],
  ['Claims', counts.fresh === false ? `${counts.claims}: ${counts.decided} reviewed, ${counts.open} waiting for you` : `${counts.claims}: ${counts.decided} reviewed earlier, ${counts.open} for you`, ''],
  ['Rule changes', counts.rule_changes === 0 ? 'empty' : String(counts.rule_changes), ''],
];

// ---- the command line -----------------------------------------------------------------------------------------------------------------

function parse(args, options) {
  try {
    const { values } = parseArgs({ args, options: { ...options, help: { type: 'boolean', short: 'h' } }, strict: true, allowPositionals: false });
    return values;
  } catch (e) {
    throw stop(EXIT.INVALID, `${e.message}\n${USAGE}`);
  }
}

// ---- run records ---------------------------------------------------------------------------------------------------------------------

const currentEdition = (root) => {
  try {
    return readRubric(root)?.edition ?? null;
  } catch {
    return null;
  }
};

/** runs/<run-id>/run.json in a demo folder, written first (started) and last (finished); the folder name is never reused. */
function beginRun({ root, kind, argv, now, resume = null }) {
  const base = makeRunId(kind, now());
  let id = base;
  for (let n = 2; existsSync(join(root, 'runs', id)); n += 1) id = `${base}-${n}`;
  const dir = join(root, 'runs', id);
  mkdirSync(dir, { recursive: true });
  const record = { run_id: id, script: 'walkthrough.mjs', args: argv, started_at: now().toISOString(), finished_at: null, exit_code: null, rubric_edition: currentEdition(root), pull_id: null, resume };
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

function freshDir(root, kind, now) {
  const base = makeRunId(kind, now());
  let id = base;
  for (let n = 2; existsSync(join(root, 'runs', id)); n += 1) id = `${base}-${n}`;
  const dir = join(root, 'runs', id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- the context of a practice page ------------------------------------------------------------------------------------------------------

const saveDemo = (ctx) => {
  ctx.demo.updated_at = ctx.now().toISOString();
  writeJsonAtomic(join(ctx.demoRoot, 'demo.json'), ctx.demo);
};
const saveConfig = (ctx) => writeJsonAtomic(join(ctx.demoRoot, 'config.json'), ctx.config);

function loadProduction(root, env) {
  if (env.config) return env.config;
  try {
    return loadConfig(root);
  } catch (e) {
    throw stop(EXIT.INVALID, e.message);
  }
}

/**
 * The practice page a command acts on: the one named with --demo (any page), else the newest finished page under the Demos sub-page of config.json whose profile
 * this build reads (dp.pickDemo). Pages under Demo tests are reached only by naming them. Throws a ManifestError (a message for the person) when there is none.
 */
function pickPage(root, env, id, opts = {}) {
  const under = id === undefined || id === null ? loadProduction(root, env).notion.pages?.demos : null;
  return dp.pickDemo(root, id, { ...opts, under });
}

function loadStructureFile(root) {
  const file = codeFile(root, 'setup', 'structure.json');
  if (!existsSync(file)) throw stop(EXIT.INVALID, `the structure of the tables does not exist (${file}); the engineer has to make it first`);
  return readJson(file);
}

/** The context every command that works on a made practice page needs: its folder, demo.json, config, the copies of the manifest and the template, the page model. */
function loadDemoContext({ root, found, env, io, now }) {
  const { id, dir, demo } = found;
  let config;
  try {
    config = loadConfig(dir);
  } catch (e) {
    throw stop(EXIT.INVALID, `the profile of the practice page ${id} is not valid: ${e.message}`);
  }
  if (config.demo !== true || config.demo_id !== id) throw stop(EXIT.INVALID, `the folder of the practice page ${id} does not hold a demo profile of that name`);
  const manifestFile = join(dir, 'walkthrough', 'manifest.json');
  const templateFile = join(dir, 'walkthrough', 'page.md');
  if (!existsSync(manifestFile) || !existsSync(templateFile)) throw stop(EXIT.INVALID, `the practice page ${id} has no copy of its manifest and page template`);
  const { manifest, sha256 } = dp.loadManifest(manifestFile);
  if (demo.manifest_sha256 && sha256 !== demo.manifest_sha256) throw stop(EXIT.INVALID, `the manifest copy of the practice page ${id} is not the one it was planned from`);
  const template = dp.loadTemplate(templateFile);
  if (demo.page_sha256 && template.sha256 !== demo.page_sha256) throw stop(EXIT.INVALID, `the page template copy of the practice page ${id} is not the one it was planned from`);
  const structure = dp.practiceStructure(readJson(join(dir, 'setup', 'structure.json')));
  const values = { edition: demo.edition, date: demo.date };
  const model = dp.pageModel(template.text, values);
  return {
    root, demoRoot: dir, id, demo, config, manifest, template, structure, values, model, env, io, now, clients: null,
  };
}

// ---- the clients -------------------------------------------------------------------------------------------------------------------------

function makeClients(ctx, { dry = false, builderLog, restLog } = {}) {
  const { env, config } = ctx;
  const base = env.fetchImpl ?? globalThis.fetch;
  const guarded = dry ? readOnlyFetch(base) : base;
  const common = { fetchImpl: dp.placementFetch(guarded), token: env.token, repoRoot: env.repoRoot, sleep: env.sleep };
  let builder = clientFromConfig(config, { ...common, apiVersion: config.notion.builder_api_version ?? BUILDER_API_VERSION, log: builderLog });
  let rest = clientFromConfig(config, { ...common, log: restLog });
  if (!builder || !rest) throw stop(EXIT.INVALID, 'there is no NOTION_TOKEN in .env, so Notion cannot be reached by script');
  if (typeof env.wrapClients === 'function') ({ builder, rest } = env.wrapClients({ builder, rest }));
  return { builder, rest };
}

const logFiles = (demoRoot) => ({ builder: join(demoRoot, 'runs', 'builder', 'requests.jsonl'), rest: join(demoRoot, 'runs', 'builder', 'requests-rows.jsonl') });

function openClients(ctx, opts = {}) {
  const files = logFiles(ctx.demoRoot);
  const builderLog = dp.bufferedLog();
  const restLog = dp.bufferedLog();
  builderLog.attach(files.builder);
  restLog.attach(files.rest);
  ctx.clients = makeClients(ctx, { ...opts, builderLog: builderLog.log, restLog: restLog.log });
  return ctx.clients;
}

/** Every request the practice page's commands have sent, by method: the logs of the clients and of the pulls. */
function countAll(demoRoot) {
  const files = Object.values(logFiles(demoRoot));
  const pullBase = join(demoRoot, 'runs', 'pull');
  if (existsSync(pullBase)) for (const d of readdirSync(pullBase, { withFileTypes: true })) if (d.isDirectory()) files.push(join(pullBase, d.name, 'requests.jsonl'));
  const total = { GET: 0, POST: 0, PATCH: 0, total: 0, writes: 0 };
  for (const file of files) {
    if (!existsSync(file)) continue;
    const c = countRequests(file);
    for (const [m, n] of Object.entries(c.byMethod)) total[m] = (total[m] ?? 0) + n;
    total.total += c.total;
    total.writes += c.writes;
  }
  return total;
}

// ---- reading tables ------------------------------------------------------------------------------------------------------------------------

async function pullTables(ctx, tables = 'all') {
  const { env } = ctx;
  const r = await pull({ root: ctx.demoRoot, config: ctx.config, tables, now: ctx.now, fetchImpl: env.fetchImpl, token: env.token, repoRoot: env.repoRoot, sleep: env.sleep });
  if (r.code !== EXIT.OK) {
    const lines = [...r.problems, ...r.duplicates.map((d) => `two rows of ${d.table} have the key "${d.key}"`)];
    throw stop(EXIT.INVALID, `the tables of the practice page cannot be read cleanly: ${lines.join('; ') || 'see the pull'}`);
  }
  return { result: r, loaded: loadPull(ctx.demoRoot, r.pullId, { config: ctx.config }) };
}

// ---- the setup plan -------------------------------------------------------------------------------------------------------------------------

const viewByKey = (structure, key) => structure.views.find((v) => dp.VIEW_NAMES[key] === v.name);

/**
 * The plan of a start: every request that will be sent, in order, and every row, written to setup-plan.json before the first one is. Deterministic
 * from the profile, so a resumed start rebuilds it and compares it with the file (a plan that was changed is refused).
 */
export function buildSetupPlan(ctx) {
  const { demo, manifest, structure, model } = ctx;
  const parentId = demo.parent.id;
  const dbPlan = planStructure(structure, { notion: { parent_page_id: parentId } });
  const requests = [];
  const add = (r) => requests.push({ n: requests.length + 1, ...r });
  add({ method: 'GET', path: `/pages/${parentId}`, note: 'read the parent page (the only request of a dry run)' });
  add({ method: 'POST', path: '/pages', note: 'the practice page', body: { parent: { page_id: parentId }, title: demo.title } });
  const pre = dp.preBlocks(model);
  // a request carries at most 100 blocks, and the client splits a longer text the same way, so the plan lists one request for each hundred
  for (let i = 0; i < pre.length; i += MAX_BLOCKS_PER_REQUEST) {
    const part = pre.slice(i, i + MAX_BLOCKS_PER_REQUEST);
    add({ method: 'PATCH', path: '/blocks/<page>/children', note: pre.length > MAX_BLOCKS_PER_REQUEST ? `the text before the tables (blocks ${i + 1} to ${i + part.length} of ${pre.length})` : `the text before the tables (${pre.length} blocks)`, blocks: part });
  }
  for (const db of dbPlan.databases) {
    add({ method: 'POST', path: '/databases', note: `the table ${db.title}`, body: { parent: { page_id: '<page>' }, title: db.title, is_inline: true, initial_data_source: db.body.initial_data_source } });
  }
  // a relation column needs the table it points at, so it is added once all five exist (one PATCH of the data source of each table that has one)
  for (const table of TABLES) {
    const relations = dbPlan.columns.filter((c) => c.table === table && c.relation_to);
    if (relations.length === 0) continue;
    add({
      method: 'PATCH', path: `/data_sources/<${dp.PRACTICE_TITLES[table]}>`,
      note: `the column ${relations.map((c) => c.name).join(', ')} of the table ${dp.PRACTICE_TITLES[table]}, a relation to the table ${relations.map((c) => dp.PRACTICE_TITLES[c.relation_to]).join(', ')}`,
      body: { properties: Object.fromEntries(relations.map((c) => [c.name, { ...c.body, relation: { data_source_id: `<${dp.PRACTICE_TITLES[c.relation_to]}>`, single_property: {} } }])) },
    });
  }
  const { stub, children } = dp.splitToggle(model.toggle);
  const post = dp.postBlocks(model);
  if (post.length) add({ method: 'PATCH', path: '/blocks/<page>/children', note: 'the Help toggle, then its text', blocks: post });
  if (stub && children.length) add({ method: 'PATCH', path: '/blocks/<toggle>/children', note: `the text inside the Help toggle (${children.length} blocks)`, blocks: children });
  for (const key of Object.keys(dp.TAB_VIEWS)) {
    const plan = viewPlan(structure, viewByKey(structure, key));
    add({ method: 'POST', path: '/views', note: `the view ${plan.name} of the table ${dp.PRACTICE_TITLES[plan.table]} (a tab, ${dp.TAB_VIEWS[key].position === 'start' ? 'first' : 'last'})`, body: { name: plan.name, type: 'table', ...plan.body } });
  }
  for (const slot of model.slots) {
    const plan = viewPlan(structure, viewByKey(structure, slot.key));
    add({
      method: 'POST', path: '/views', note: `the linked view ${plan.name} of the table ${dp.PRACTICE_TITLES[plan.table]}, put on the page after the block that ends the line before it`,
      body: { name: plan.name, type: 'table', create_database: { parent: { page_id: '<page>' }, position: { type: 'after_block', block_id: '<the block before the view>' } }, ...plan.body },
    });
  }
  for (const slot of model.slots) {
    add({ method: 'PATCH', path: '/blocks/<page>/children', note: `only if the view ${dp.VIEW_NAMES[slot.key]} is refused: one paragraph after the same block`, blocks: [dp.expectedContent({ pre: [{ kind: 'slot', key: slot.key }], post: [] }, [slot.key])[0]] });
  }
  const claimLinks = Object.fromEntries(manifest.claims.map((c) => [c['Geo ID'], `<link to the row of ${c.key} in Claims>`]));
  const tag = manifest.tag.Name;
  const rows = rowOpsFor(ctx, claimLinks, { [tag]: `<the row of ${tag} in Rulebook>` });
  return {
    plan: {
      demo_id: demo.demo_id, title: demo.title, created_at: demo.created_at, parent_page_id: parentId, manifest_version: manifest.manifest_version, manifest_sha256: demo.manifest_sha256,
      edition: demo.edition, counts: { requests: requests.length, rows: Object.values(rows).reduce((n, list) => n + list.length, 0) },
    },
    requests,
    rows,
  };
}

// ---- the rows -----------------------------------------------------------------------------------------------------------------------------------

/**
 * The rows of each table, in the order they are made: Rulebook, Claims, Tag decisions, Agent settings. `claimLinks`: Geo ID -> the link to the claim's row.
 * `tagPages`: tag name -> the page id of its row in the Rulebook (the relation of the decided claims holds it; the plan file holds a placeholder).
 * A claim is made with the Geo columns and the editor's three columns as the manifest has them (decided claims Reviewed, open claims To review); the agent's
 * eight columns (Agent tags, Agent confidence, Agent reasons, Agent status, Tags waiting, Agent edition, Agent remarks, Agent reading) are left empty, except the Agent reading of
 * a decided claim (its seeded reading, decision 73): the tag step writes the first seven and the distill step the reading of the others.
 * The ledger gets a row for each decided claim, already read where the editor's outcome differs from the agent's proposal.
 */
function rowOpsFor(ctx, claimLinks, tagPages) {
  const { manifest, structure, demo } = ctx;
  const columns = (table) => dp.writableColumns(structure, table);
  const claimsEntry = tableEntry(ctx.config, 'claims_copy');
  // the rulebook file the page starts with: its edition is the Rulebook edition of the seeded ledger rows, which the key of the seeded readings holds
  const rubric = dp.practiceRubric(manifest, ctx.config, { edition: demo.edition, now: new Date(demo.created_at) });
  // the pick carries the real table's own values for the editor's columns; none of them is copied (the manifest says what each claim starts with)
  const skip = [...Object.values(claimsEntry.write_columns ?? {}), ...editorColumns(ctx.config, 'claims_copy')];
  const claims = claimOps({ rows: manifest.claims }, columns('claims_copy'), { keyColumn: claimsEntry.key, skip });
  for (const op of claims) {
    const claim = manifest.claims.find((c) => c[claimsEntry.key] === op.key);
    Object.assign(op.properties, dp.claimEditorCells(manifest, claim, tagPages), dp.claimAgentCells(manifest, claim, { rubric, column: claimsEntry.write_columns.reading }));
  }
  return {
    rulebook: rulebookOps({ rows: [dp.rulebookRow(manifest)] }, columns('rulebook')),
    claims_copy: claims,
    tag_decisions: dp.ledgerOps(manifest, claimLinks, { rubric }),
    agent_settings: [{
      key: SETTINGS_NAME,
      // no Last run summary: no command has run yet, and the table of step 1 says so ("Last run | none yet", which is what status prints); the first command that writes fills it
      properties: { Name: SETTINGS_NAME, 'Rulebook edition': demo.edition },
    }],
  };
}

// ---- the profile on disk -------------------------------------------------------------------------------------------------------------------

function writeProfile({ dir, production, practice, manifest, manifestFile, templateFile, template, demo, now, values }) {
  const tag = manifest.manifest.tag.Name;
  const config = dp.buildDemoConfig(production, { demoId: demo.demo_id, title: demo.title, parentId: demo.parent.id, tag });
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(join(dir, 'config.json'), config);
  mkdirSync(join(dir, 'walkthrough'), { recursive: true });
  copyFileSync(manifestFile, join(dir, 'walkthrough', 'manifest.json'));
  copyFileSync(templateFile, join(dir, 'walkthrough', 'page.md'));
  writeJsonAtomic(join(dir, 'setup', 'structure.json'), practice);
  // the rulebook: one judged tag, built from the manifest; the ids of the Notion row are put in when the row exists
  const row = dp.rulebookRow(manifest.manifest);
  const source = { database_id: 'not made yet', data_source_id: 'not made yet', read_via: 'manifest', read_at: now().toISOString() };
  const rubric = buildRubric([row], { config, edition: values.edition, source, now });
  writeEdition(dir, rubric, { reason: `practice page ${demo.demo_id}` });
  // the examples: the manifest's canaries, each for the one tag
  const lines = manifest.manifest.canaries.map((c, i) => JSON.stringify({ id: c.id ?? `canary-${i + 1}`, tag, claim: c.claim, expected: c.expected, source: c.source ?? `example claims of ${tag}` }));
  writeTextAtomic(join(dir, 'evals', 'canaries.jsonl'), `${lines.join('\n')}\n`);
  writeTextAtomic(join(dir, 'evals', 'cases.jsonl'), '');
  return config;
}

// ---- the parent page --------------------------------------------------------------------------------------------------------------------------

function protectedSet(production) {
  const n = production.notion;
  const tables = [n.rulebook, ...(n.claims ?? []), ...Object.values(n.databases ?? {})].flatMap((t) => [t?.database_id, t?.data_source_id]);
  return new Set([...(n.protected_database_ids ?? []), ...(n.protected_page_ids ?? []), ...tables].map((id) => normId(String(id ?? ''))).filter((id) => /^[0-9a-f]{32}$/.test(id)));
}

function refuseProtectedParent(production, parentId) {
  if (protectedSet(production).has(normId(parentId)) || normId(production.notion.parent_page_id) === normId(parentId)) throw protectedStop();
}

const titleOfPage = (page) => {
  const props = Object.values(page?.properties ?? {});
  const title = props.find((p) => p?.type === 'title');
  return text((title?.title ?? []).map((t) => t?.plain_text ?? t?.text?.content ?? '').join(''));
};

async function readParent(client, parentId, production) {
  let page;
  try {
    page = await client.retrievePage(parentId);
  } catch (e) {
    if (e instanceof NotionError && [400, 403, 404].includes(e.status)) throw unreachableStop();
    if (e instanceof NotionError && e.status === 401) throw stop(EXIT.INVALID, 'Notion did not accept the token in .env, so nothing was made; ask the engineer to check it');
    throw e;
  }
  if (page?.object !== undefined && page.object !== 'page') throw unreachableStop();
  if (page?.in_trash === true || page?.archived === true) throw stop(EXIT.INVALID, 'that page is in the trash; pick another');
  const up = page?.parent ?? {};
  const refused = protectedSet(production);
  for (const id of [up.database_id, up.data_source_id, up.page_id]) if (id && refused.has(normId(id))) throw protectedStop();
  return { id: normId(page.id ?? parentId), title: titleOfPage(page), url: page.url ?? notionUrl(parentId) };
}

// ---- building: the page, its text, the tables, the views ----------------------------------------------------------------------------------------

const refusal = (e) => e instanceof NotionError && (e.status === 400 || e.status === 404);

const recordedDatabase = (demo, table) => {
  const d = demo.databases?.[table];
  return d?.database_id && d?.data_source_id ? d : null;
};

function applyIdsToConfig(ctx) {
  const { demo, config } = ctx;
  for (const table of TABLES) {
    const d = recordedDatabase(demo, table);
    if (d) dp.setTableIds(config, table, d);
  }
  if (demo.page?.id) {
    config.notion.parent_page_id = demo.page.id;
    config.notion.setup_page_parents = [demo.page.id];
    config.notion.demo_page_id = demo.page.id;
    config.notion.pages.practice = demo.page.id;
  }
  config.notion.views = {};
  for (const [key, v] of Object.entries(demo.views ?? {})) if (v) config.notion.views[key] = { id: v.id, url: v.url };
}

function persist(ctx) {
  applyIdsToConfig(ctx);
  saveDemo(ctx);
  saveConfig(ctx);
}

const contentOnly = (listing) => listing.filter((b) => dp.CONTENT_TYPES.has(b.type) && !(b.type === 'paragraph' && Object.values(dp.FALLBACK_TEXT).includes(blockText(b))));

function comparePrefix(expected, actual) {
  const n = Math.min(expected.length, actual.length);
  for (let i = 0; i < n; i += 1) {
    const want = dp.signature(expected[i]);
    const got = dp.signature(actual[i]);
    if (want !== got) return { ok: false, at: i, want, got };
  }
  return { ok: true, matched: n, extra: Math.max(0, actual.length - expected.length) };
}

async function listPage(ctx) {
  return ctx.clients.builder.retrieveBlockChildren(ctx.demo.page.id);
}

async function ensurePage(ctx) {
  const { demo } = ctx;
  if (demo.page?.id) return;
  const { builder } = ctx.clients;
  const listing = await builder.retrieveBlockChildren(demo.parent.id);
  const taken = new Set(dp.listDemos(ctx.root).filter((d) => d.id !== demo.demo_id).map((d) => normId(d.demo.page?.id ?? '')));
  const hits = listing.filter((b) => b?.type === 'child_page' && b.child_page?.title === demo.title && !taken.has(normId(b.id)));
  if (hits.length > 1) throw stop(EXIT.INVALID, `more than one page titled "${demo.title}" is under the parent page; keep one, and ask for the practice page again`);
  let id;
  let url;
  if (hits.length === 1) {
    id = normId(hits[0].id);
    url = notionUrl(id);
    ctx.io.err(`walkthrough: the page "${demo.title}" was found under the parent page (made by an earlier try) and is used`);
  } else {
    const created = await builder.createPageUnderPage({ parentPageId: demo.parent.id, title: demo.title });
    id = normId(created.id);
    url = created.url ?? notionUrl(id);
  }
  demo.page = { id, url };
  persist(ctx);
}

async function ensureContent(ctx) {
  const { demo, model } = ctx;
  const { builder } = ctx.clients;
  const pre = dp.preBlocks(model);
  const expected = [...pre, ...dp.postBlocks(model)];
  const listing = await listPage(ctx);
  const actual = contentOnly(listing);
  const cmp = comparePrefix(expected, actual);
  if (!cmp.ok) throw stop(EXIT.INVALID, `the practice page does not read as it was planned (block ${cmp.at + 1}: planned ${oneLine(cmp.want, 70)}, found ${oneLine(cmp.got, 70)}); nothing more was added`);
  if (cmp.extra) throw stop(EXIT.INVALID, `the practice page holds ${cmp.extra} more block(s) than were planned; nothing more was added`);
  const ours = new Set(TABLES.map((t) => normId(demo.databases?.[t]?.database_id ?? '')).filter(Boolean));
  if (cmp.matched < pre.length) {
    if (listing.some((b) => b.type === 'child_database' && ours.has(normId(b.id)))) throw stop(EXIT.INVALID, 'the tables are on the practice page already but the text before them is not complete; it cannot be put in the right place now');
    await builder.appendBlocks(demo.page.id, pre.slice(cmp.matched));
  }
  const after = contentOnly(await listPage(ctx));
  const anchors = dp.anchorIndexes(model);
  demo.anchors = Object.fromEntries(Object.entries(anchors).map(([key, i]) => [key, after[i]?.id ?? null]));
  if (Object.values(demo.anchors).some((id) => !id)) throw stop(EXIT.ERROR, 'the blocks that the linked views go under could not be found on the practice page');
  demo.content = { blocks_before_tables: pre.length };
  persist(ctx);
}

async function ensureDatabases(ctx) {
  const { demo, structure } = ctx;
  const { builder } = ctx.clients;
  const dbPlan = planStructure(structure, { notion: { parent_page_id: demo.page.id } });
  demo.databases ??= {};
  for (const db of dbPlan.databases) {
    if (recordedDatabase(demo, db.table)) continue;
    let databaseId = demo.databases[db.table]?.database_id ?? null;
    let how = 'created';
    if (!databaseId) {
      const listing = await listPage(ctx);
      const hits = listing.filter((b) => b?.type === 'child_database' && b.child_database?.title === db.title && !Object.values(demo.databases).some((d) => normId(d.database_id) === normId(b.id)));
      if (hits.length > 1) throw stop(EXIT.INVALID, `more than one table titled "${db.title}" is on the practice page; keep one, and ask for the practice page again`);
      if (hits.length === 1) {
        databaseId = normId(hits[0].id);
        how = 'adopted';
        ctx.io.err(`walkthrough: the table "${db.title}" was found on the page (made by an earlier try) and is used`);
      }
    }
    let dataSourceId = null;
    if (!databaseId) {
      const created = await builder.createDatabase({ parentPageId: demo.page.id, title: db.title, isInline: true, properties: db.body.initial_data_source.properties });
      databaseId = normId(created.id);
      dataSourceId = created.data_sources?.[0]?.id ?? null;
    }
    if (!dataSourceId) {
      const info = await builder.retrieveDatabase(databaseId);
      dataSourceId = info.data_sources?.[0]?.id ?? null;
    }
    if (!dataSourceId) throw stop(EXIT.ERROR, `Notion lists no data source for the table "${db.title}" yet; ask for the practice page again to read it`);
    if (isProtected(ctx.config, databaseId) || isProtected(ctx.config, dataSourceId)) throw stop(EXIT.INVALID, `the table "${db.title}" is on the protected list, so it is never used`);
    demo.databases[db.table] = { database_id: databaseId, data_source_id: normId(dataSourceId), how };
    persist(ctx);
  }
  demo.tables_position = 'marker';
}

// The relation columns (Agent tags, Tags waiting and Verified tags point at the Rulebook): a relation needs the table it points at, so it is added to a table that exists
// once all five do. A column that is there is left as it is.
async function ensureRelations(ctx) {
  const { demo, structure } = ctx;
  const { builder } = ctx.clients;
  const dbPlan = planStructure(structure, { notion: { parent_page_id: demo.page.id } });
  for (const table of TABLES) {
    const wanted = dbPlan.columns.filter((c) => c.table === table && c.relation_to);
    if (wanted.length === 0) continue;
    const dataSourceId = demo.databases[table].data_source_id;
    const have = (await builder.retrieveDataSource(dataSourceId)).properties ?? {};
    const missing = wanted.filter((c) => !have[c.name]);
    if (missing.length === 0) continue;
    const properties = Object.fromEntries(missing.map((c) => [c.name, { ...c.body, relation: { data_source_id: normId(demo.databases[c.relation_to].data_source_id), single_property: {} } }]));
    await builder.updateDataSource(dataSourceId, { properties });
  }
}

async function ensureToggle(ctx) {
  const { demo, model } = ctx;
  const { builder } = ctx.clients;
  const { children } = dp.splitToggle(model.toggle);
  const pre = dp.preBlocks(model);
  const post = dp.postBlocks(model);
  const expected = [...pre, ...post];
  let actual = contentOnly(await listPage(ctx));
  const cmp = comparePrefix(expected, actual);
  if (!cmp.ok) throw stop(EXIT.INVALID, `the practice page does not read as it was planned (block ${cmp.at + 1}); nothing more was added`);
  if (cmp.matched < pre.length) throw stop(EXIT.INVALID, 'the text before the tables is not complete on the practice page, so the Help toggle cannot be put after the tables; nothing more was added');
  if (cmp.matched < expected.length) {
    await builder.appendBlocks(demo.page.id, post.slice(cmp.matched - pre.length));
    actual = contentOnly(await listPage(ctx));
  }
  const at = pre.length + post.findIndex((b) => b.type === 'toggle');
  if (model.toggle) {
    const toggleId = actual[at]?.id;
    if (!toggleId) throw stop(EXIT.ERROR, 'the Help toggle could not be found on the practice page');
    const kids = await builder.retrieveBlockChildren(toggleId);
    const kc = comparePrefix(children, kids);
    if (!kc.ok || kc.extra) throw stop(EXIT.INVALID, 'the Help toggle does not hold what was planned; nothing more was added');
    if (kc.matched < children.length) await builder.appendBlocks(toggleId, children.slice(kc.matched));
    demo.toggle = { id: normId(toggleId) };
  }
  persist(ctx);
}

// name -> view id for the views a table already has (tabs)
async function tabViewsOf(client, databaseId) {
  const out = new Map();
  for (const ref of await client.listViews(databaseId)) {
    const view = await client.retrieveView(ref.id);
    if (typeof view?.name === 'string' && !out.has(view.name)) out.set(view.name, view.id ?? ref.id);
  }
  return out;
}

async function adoptLinked(ctx, name, dataSourceId) {
  const { builder } = ctx.clients;
  const ours = new Set(TABLES.map((t) => normId(ctx.demo.databases?.[t]?.database_id ?? '')));
  for (const block of await listPage(ctx)) {
    if (block?.type !== 'child_database' || ours.has(normId(block.id))) continue;
    try {
      for (const ref of await builder.listViews(block.id)) {
        const view = await builder.retrieveView(ref.id);
        if (view?.name === name && normId(view.data_source_id ?? '') === normId(dataSourceId)) return { view, blockId: block.id };
      }
    } catch (e) {
      if (!refusal(e)) throw e;
    }
  }
  return null;
}

async function ensureViews(ctx) {
  const { demo, structure, model } = ctx;
  const { builder } = ctx.clients;
  const views = (demo.views && typeof demo.views === 'object' ? demo.views : {});
  demo.views = views;
  const sources = {};
  const sourceOf = async (table) => {
    if (!sources[table]) sources[table] = await builder.retrieveDataSource(demo.databases[table].data_source_id);
    return sources[table];
  };
  const failed = (key, e) => {
    views[key] = null;
    demo.errors = [...(demo.errors ?? []), { at: ctx.now().toISOString(), view: key, message: oneLine(e.message, 300) }];
    ctx.io.err(`walkthrough: the view ${dp.VIEW_NAMES[key]} was refused by Notion (${oneLine(e.message, 120)}); the page goes without it`);
  };
  for (const [key, spec] of Object.entries(dp.TAB_VIEWS)) {
    if (Object.hasOwn(views, key)) continue;
    const name = dp.VIEW_NAMES[key];
    const table = spec.table;
    const database = demo.databases[table];
    try {
      const existing = await tabViewsOf(builder, database.database_id);
      let viewId = existing.get(name) ?? null;
      let kind = 'tab';
      if (!viewId) {
        const plan = viewPlan(structure, viewByKey(structure, key));
        const body = completeViewBody(plan, await sourceOf(table), { databaseId: database.database_id });
        const make = (position) => builder.createView({
          databaseId: body.database_id, dataSourceId: body.data_source_id, name: body.name, type: body.type, filter: body.filter, sorts: body.sorts, configuration: body.configuration, position,
        });
        let res;
        try {
          res = await make({ type: spec.position });
        } catch (e) {
          if (!(e instanceof NotionError && e.status === 400)) throw e;
          res = await make(undefined); // a refused create makes nothing, so it is safe to ask again without the place in the tab bar
        }
        viewId = res.id;
      }
      views[key] = { id: normId(viewId), url: `https://www.notion.so/${normId(database.database_id)}?v=${normId(viewId)}`, kind, table, source_database_id: normId(database.database_id) };
    } catch (e) {
      if (!refusal(e)) throw e;
      failed(key, e);
    }
    persist(ctx);
  }
  // a linked view that Notion refuses is a refusal of the placement itself, so the others are not tried: the steps get their paragraphs together
  let placementRefused = model.slots.some((s) => views[s.key] === null);
  for (const slot of model.slots) {
    const key = slot.key;
    if (Object.hasOwn(views, key)) continue;
    if (placementRefused) {
      views[key] = null;
      persist(ctx);
      continue;
    }
    const table = dp.LINKED_VIEWS[key];
    const database = demo.databases[table];
    try {
      const found = await adoptLinked(ctx, slot.name, database.data_source_id);
      let viewId;
      let linkedId = null;
      if (found) {
        viewId = found.view.id;
        linkedId = found.blockId;
        ctx.io.err(`walkthrough: the linked view "${slot.name}" was found on the page (made by an earlier try) and is used`);
      } else {
        const plan = viewPlan(structure, viewByKey(structure, key));
        const body = completeViewBody(plan, await sourceOf(table), { databaseId: database.database_id });
        const res = await builder.createView({
          databaseId: body.database_id, dataSourceId: body.data_source_id, name: body.name, type: body.type, filter: body.filter, sorts: body.sorts, configuration: body.configuration,
          position: { type: 'after_block', page_id: demo.page.id, block_id: demo.anchors[key] },
        });
        viewId = res.id;
        linkedId = res.parent?.database_id ?? null;
      }
      views[key] = {
        id: normId(viewId), url: `${demo.page.url}${linkedId ? `#${normId(linkedId)}` : ''}`, kind: 'linked', table, source_database_id: normId(database.database_id),
        linked_database_id: linkedId ? normId(linkedId) : null, anchor: demo.anchors[key],
      };
    } catch (e) {
      if (!refusal(e)) throw e;
      failed(key, e);
      placementRefused = true;
    }
    persist(ctx);
  }
  if (Object.values(views).every((v) => v === null)) {
    demo.views = null;
    demo.fallback = 'no-views';
  } else if (model.slots.some((s) => !views[s.key])) demo.fallback = 'no-views';
  else demo.fallback = null;
  persist(ctx);
  await arrangeClaimsView(ctx);
}

// The table's own view of the Claims (Notion's default view) shows the relations last, because they were added after the other columns: set it to the review order, the
// way the three views of the Claims already show it. It is a matter of looks, so a refusal by Notion does not stop the build; it is recorded, and `verify` names the view.
async function arrangeClaimsView(ctx) {
  const { demo, structure } = ctx;
  const { builder } = ctx.clients;
  const database = demo.databases.claims_copy;
  const plan = planStructure(structure, { notion: { parent_page_id: demo.page.id } });
  try {
    const changed = await arrangeOwnViews({ client: builder, plan, table: 'claims_copy', databaseId: database.database_id, dataSourceId: database.data_source_id });
    if (changed.length) ctx.io.err(`walkthrough: the column order of the Claims view${changed.length === 1 ? '' : 's'} ${changed.map((n) => `"${n}"`).join(', ')} was set to the review order`);
  } catch (e) {
    if (!refusal(e)) throw e;
    demo.errors = [...(demo.errors ?? []), { at: ctx.now().toISOString(), view: 'claims_own_view', message: oneLine(e.message, 300) }];
    ctx.io.err(`walkthrough: Notion refused the column order of the Claims view (${oneLine(e.message, 120)}); the page goes without it`);
  }
  persist(ctx);
}

const missingLinked = (ctx) => ctx.model.slots.filter((s) => ctx.demo.fallback === 'no-views' && !ctx.demo.views?.[s.key]).map((s) => s.key);

async function ensureFallback(ctx) {
  const { demo } = ctx;
  const { rest } = ctx.clients;
  for (const key of missingLinked(ctx)) {
    const anchor = demo.anchors?.[key];
    const paragraph = dp.expectedContent({ pre: [{ kind: 'slot', key }], post: [] }, [key])[0];
    const listing = await listPage(ctx);
    const at = listing.findIndex((b) => normId(b.id) === normId(anchor));
    if (at < 0) throw stop(EXIT.ERROR, `the block that the text for ${dp.VIEW_NAMES[key]} goes under is not on the page any more`);
    const next = listing[at + 1];
    if (next?.type === 'paragraph' && blockText(next) === dp.FALLBACK_TEXT[key]) continue;
    await rest.appendBlocks(demo.page.id, [{ ...paragraph, __after: anchor }]);
  }
}

async function buildStructure(ctx) {
  const { demo } = ctx;
  demo.phases ??= {};
  const steps = [['page', ensurePage], ['content', ensureContent], ['databases', ensureDatabases], ['relations', ensureRelations], ['toggle', ensureToggle], ['views', ensureViews], ['fallback', ensureFallback]];
  for (const [name, fn] of steps) {
    if (demo.phases[name]) continue;
    await fn(ctx);
    demo.phases[name] = true;
    persist(ctx);
  }
  const fallbackKeys = missingLinked(ctx);
  const preview = dp.annotatedPreview(ctx.model.rendered, { fallbackKeys, tablesPosition: demo.tables_position });
  writeTextAtomic(join(ctx.demoRoot, 'preview.md'), `${preview}\n`);
  demo.state = 'created';
  persist(ctx);
}

// ---- building: the rows -------------------------------------------------------------------------------------------------------------------------

const SETUP_MARKER = (root) => join(root, 'runs', 'SETUP');

function rewriteRubric(ctx, pageId) {
  const dir = ctx.demoRoot;
  const current = readRubric(dir);
  if (!current) return;
  const tag = current.tags[0];
  if (tag.page_id === pageId && current.source.database_id !== 'not made yet') return;
  const row = { ...dp.rulebookRow(ctx.manifest), page_id: pageId };
  const entry = tableEntry(ctx.config, 'rulebook');
  const source = { database_id: entry.database_id, data_source_id: entry.data_source_id, read_via: 'rest', read_at: ctx.now().toISOString() };
  const next = buildRubric([row], { config: ctx.config, edition: current.edition, source, now: current.built_at });
  writeEdition(dir, next, { reason: `practice page ${ctx.demo.demo_id}` });
}

function describeFailures(result) {
  const out = [];
  for (const [label, list] of [['failed', result.lists.failed], ['read-back differs', result.lists.mismatches], ['not read back', result.lists.unchecked], ['uncertain', result.lists.uncertain]]) {
    for (const x of list.slice(0, 3)) out.push(`${label}: ${oneLine(x.key, 50)}${x.detail ? ` - ${oneLine(x.detail, 120)}` : ''}`);
  }
  if (result.pending > 0) out.push(`${result.pending} row(s) were not reached`);
  return out;
}

/**
 * Create the rows of one table that are not there yet: pull, drop the rows whose key is in the pull, write the plan, check it (setup: true, in a
 * profile with the marker), apply it with a ledger and read every row back. Returns the page ids of all the rows of `ops` by key.
 */
async function createRows(ctx, { table, ops, wrap = (c) => c }) {
  const { demo } = ctx;
  const unknown = unknownOptions(ctx.demoRoot, table, ops);
  if (unknown.length) throw stop(EXIT.INVALID, `nothing was written to ${dp.PRACTICE_TITLES[table]}, because Notion would add options that the structure does not have: ${unknown.slice(0, 3).join('; ')}`);
  const { loaded } = await pullTables(ctx, [table]);
  const have = loaded.pulled([table])[table] ?? {};
  const pages = {};
  for (const op of ops) if (have[op.key]?.page_id) pages[op.key] = have[op.key].page_id;
  const todo = ops.filter((op) => !have[op.key]);
  if (todo.length === 0) return pages;
  const dir = freshDir(ctx.demoRoot, `rows-${table}`, ctx.now);
  const plan = newPlan({ runId: dir.split(/[\\/]/).pop(), script: 'walkthrough.mjs', rubricEdition: demo.edition, config: ctx.config, now: ctx.now });
  for (const op of todo) plan.create(table, op.key, op.properties);
  const checked = checkPlan(plan, ctx.config, { setup: true, root: ctx.demoRoot });
  if (!checked.ok) throw stop(EXIT.INVALID, `the rows of ${dp.PRACTICE_TITLES[table]} were refused by the plan check and nothing was sent: ${checked.problems.slice(0, 3).join('; ')}`);
  let result;
  try {
    result = await applyPlan({
      plan, dir, client: wrap(ctx.clients.rest), config: ctx.config, schemas: { [table]: loaded.schema(table) }, pulled: loaded.pulled([table]), setup: true, root: ctx.demoRoot, now: ctx.now,
    });
  } catch (e) {
    if (e instanceof PlanError) throw stop(EXIT.INVALID, `${e.message}: ${e.problems.slice(0, 3).join('; ')}`);
    throw e;
  }
  if (result.code !== EXIT.OK) {
    throw stop(result.code === EXIT.INVALID ? EXIT.INVALID : EXIT.ERROR, `the rows of ${dp.PRACTICE_TITLES[table]} were not all written${result.code === EXIT.INVALID ? ' (a read-back differed)' : ''}: ${describeFailures(result).join('; ') || 'see the ledger'}`);
  }
  Object.assign(pages, result.created_by_table[table] ?? {});
  return pages;
}

async function seedRows(ctx) {
  const { demo, manifest } = ctx;
  mkdirSync(join(ctx.demoRoot, 'runs'), { recursive: true });
  if (!existsSync(SETUP_MARKER(ctx.demoRoot))) writeFileSync(SETUP_MARKER(ctx.demoRoot), `${JSON.stringify({ opened_at: ctx.now().toISOString(), reason: `practice page ${demo.demo_id}` })}\n`);
  demo.rows ??= {};

  const tag = manifest.tag.Name;
  const emptyLinks = Object.fromEntries(manifest.claims.map((c) => [c['Geo ID'], null]));
  const rulebookOnly = rowOpsFor(ctx, emptyLinks, { [tag]: '<the row of the tag in Rulebook>' }); // only the Rulebook and the settings are used from this one
  if (!demo.rows.rulebook) {
    const pages = await createRows(ctx, { table: 'rulebook', ops: rulebookOnly.rulebook });
    rewriteRubric(ctx, Object.values(pages)[0]);
    demo.rows.rulebook = true;
    demo.rows.rulebook_page = normId(Object.values(pages)[0]);
    persist(ctx);
  }
  // the relation of the decided claims holds the page id of the tag's row in the Rulebook; an earlier go that stopped after that row left it in demo.json
  if (!demo.rows.rulebook_page) {
    const pages = await createRows(ctx, { table: 'rulebook', ops: rulebookOnly.rulebook }); // the row is there: this only reads
    demo.rows.rulebook_page = normId(pages[tag] ?? Object.values(pages)[0]);
    persist(ctx);
  }
  const tagPages = { [tag]: demo.rows.rulebook_page };
  const first = rowOpsFor(ctx, emptyLinks, tagPages);

  let claimPages = {};
  if (!demo.rows.claims_copy) {
    const claimsEntry = tableEntry(ctx.config, 'claims_copy');
    const byGeoId = new Map(manifest.claims.filter((c) => (c.source_pieces ?? []).some((p) => p.href)).map((c) => [c['Geo ID'], c.source_pieces]));
    const inLinks = protectedInLinks(ctx.config, byGeoId);
    if (inLinks.length) throw stop(EXIT.INVALID, `the links of Geo Sources of ${inLinks.length} claim(s) point at a protected table or page; protected ids are never written`);
    const wrap = (client) => withLinkedSources(client, byGeoId, { column: claimsEntry.columns?.sources ?? 'Geo Sources', keyColumn: claimsEntry.key, onWarning: (w) => ctx.io.err(`walkthrough: warning: ${w}`) });
    claimPages = await createRows(ctx, { table: 'claims_copy', ops: first.claims_copy, wrap });
    demo.rows.claims_copy = true;
    persist(ctx);
  } else {
    const { loaded } = await pullTables(ctx, ['claims_copy']);
    claimPages = Object.fromEntries(Object.entries(loaded.pulled(['claims_copy']).claims_copy).map(([k, row]) => [k, row.page_id]));
  }

  if (!demo.rows.tag_decisions) {
    const links = Object.fromEntries(manifest.claims.map((c) => [c['Geo ID'], claimPages[c['Geo ID']] ? claimLink(claimPages[c['Geo ID']]) : null]));
    const ops = rowOpsFor(ctx, links, tagPages).tag_decisions;
    await createRows(ctx, { table: 'tag_decisions', ops });
    demo.rows.tag_decisions = true;
    persist(ctx);
  }
  if (!demo.rows.agent_settings) {
    await createRows(ctx, { table: 'agent_settings', ops: first.agent_settings });
    demo.rows.agent_settings = true;
    persist(ctx);
  }
  demo.state = 'seeded';
  persist(ctx);
}

// ---- verify --------------------------------------------------------------------------------------------------------------------------------------

const sameCell = (schema, column, want, got) => sameValue(schema?.properties?.[column]?.type ?? null, want ?? null, got ?? null);

/**
 * True while nothing has changed the page since it was built: Last run summary is still empty (the build leaves it empty and every command that writes fills it), and nobody has acted as the editor on it
 * (decision D31: a line in editor-actions.jsonl that is not an unchanged one means a row may differ from its first state). Then verify can hold the
 * rows the steps change to their first state.
 */
function untouched(ctx, loaded) {
  if (text(loaded.settings()?.last_run_summary) !== '') return false;
  const file = join(ctx.demoRoot, 'editor-actions.jsonl');
  if (!existsSync(file)) return true;
  try {
    return readJsonl(file).rows.every((r) => r?.status === 'unchanged');
  } catch {
    return false;
  }
}

/**
 * Read the page and the tables back and list what differs from what was built. `loaded` is a pull of all five tables made just now. `fresh`: no command
 * has run on the page yet (Last run summary is still empty), so the rows the steps change must still be empty.
 * Returns { ok, problems, counts }.
 */
export async function verifyDemo(ctx, { loaded, fresh }) {
  const { demo, manifest, model, structure } = ctx;
  const problems = [];
  const add = (msg) => problems.push(msg);
  const counts = {};
  const tag = manifest.tag.Name;
  const lintRaise = (list) => list.forEach((p) => add(`page text, line ${p.line}: ${p.detail}`));

  // 1. the text the page was built from passes the page lint, and preview.md is that text
  const fallbackKeys = missingLinked(ctx);
  const regenerated = `${dp.annotatedPreview(model.rendered, { fallbackKeys, tablesPosition: demo.tables_position })}\n`;
  const previewFile = join(ctx.demoRoot, 'preview.md');
  if (!existsSync(previewFile)) add('preview.md is missing');
  else if (readFileSync(previewFile, 'utf8') !== regenerated) add('preview.md is not the preview of this page (it was changed after the page was made)');
  lintRaise(lintPage(regenerated, { manifest }).problems);

  // 2. local records
  if (!['seeded', 'ready'].includes(demo.state)) add(`the practice page is not finished (its state is "${demo.state}")`);
  if (existsSync(SETUP_MARKER(ctx.demoRoot)) && demo.state === 'ready') add('the setup marker is still there');
  try {
    const rubric = readRubric(ctx.demoRoot);
    if (!rubric) add('the profile has no rulebook edition');
    else {
      const check = verifyRubric(rubric);
      if (!check.ok) add(`the rulebook file is not valid: ${check.errors[0]}`);
      if (rubric.tags.length !== 1 || rubric.tags[0].name !== tag || !rubric.tags[0].judged) add('the rulebook should hold the one judged tag');
      // the page names the edition it was built with; a passed safety check moves the rulebook on, and that first edition then sits in the history
      if (rubric.edition !== demo.edition && (compareEditions(rubric.edition, demo.edition) < 0 || !readEdition(ctx.demoRoot, demo.edition))) {
        add(`the rulebook edition is ${rubric.edition} and the page was built with ${demo.edition}, which is not an earlier edition of this rulebook`);
      }
    }
  } catch (e) {
    add(`the rulebook file cannot be read: ${oneLine(e.message, 120)}`);
  }
  const canaryFile = join(ctx.demoRoot, 'evals', 'canaries.jsonl');
  const canaries = existsSync(canaryFile) ? readFileSync(canaryFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  counts.canaries = canaries.length;
  if (canaries.length !== manifest.canaries.length) add(`evals/canaries.jsonl has ${canaries.length} lines, the manifest has ${manifest.canaries.length}`);
  if (canaries.some((c) => c.tag !== tag)) add('every line of evals/canaries.jsonl should name the tag');

  // 3. the page, block by block
  const { builder } = ctx.clients;
  const listing = await builder.retrieveBlockChildren(demo.page.id);
  const dbByBlock = new Map(TABLES.map((t) => [normId(demo.databases?.[t]?.database_id ?? ''), t]));
  const seen = [];
  for (const b of listing) {
    if (dp.CONTENT_TYPES.has(b.type)) seen.push({ k: 'content', b });
    else if (b.type === 'child_database' && dbByBlock.has(normId(b.id))) seen.push({ k: 'db', table: dbByBlock.get(normId(b.id)), title: b.child_database?.title });
  }
  const expected = dp.expectedContent(model, fallbackKeys);
  const before = dp.preBlocks(model).length + fallbackKeys.length;
  const plan = [...expected.slice(0, before).map((block) => ({ k: 'content', block })), ...TABLES.map((table) => ({ k: 'db', table })), ...expected.slice(before).map((block) => ({ k: 'content', block }))];
  let pageProblems = 0;
  const pageProblem = (msg) => {
    pageProblems += 1;
    if (pageProblems <= 5) add(`page: ${msg}`);
  };
  if (seen.length !== plan.length) pageProblem(`${seen.length} blocks and tables where ${plan.length} were planned`);
  const tablesToRead = [];
  for (let i = 0; i < Math.min(seen.length, plan.length); i += 1) {
    const s = seen[i];
    const p = plan[i];
    if (s.k !== p.k) {
      pageProblem(`position ${i + 1}: ${p.k === 'db' ? `the table ${dp.PRACTICE_TITLES[p.table]}` : dp.signature(p.block)} was planned, ${s.k === 'db' ? `the table ${dp.PRACTICE_TITLES[s.table]}` : dp.signature(s.b)} is there`);
    } else if (p.k === 'db') {
      if (s.table !== p.table) pageProblem(`position ${i + 1}: the tables are not in the planned order`);
      else if (s.title !== dp.PRACTICE_TITLES[p.table]) pageProblem(`the table ${dp.PRACTICE_TITLES[p.table]} is titled "${s.title}"`);
    } else {
      if (dp.signature(s.b) !== dp.signature(p.block)) pageProblem(`position ${i + 1}: planned ${oneLine(dp.signature(p.block), 80)}, found ${oneLine(dp.signature(s.b), 80)}`);
      else if (p.block.type === 'table') tablesToRead.push({ id: s.b.id, block: p.block });
      else if (p.block.type === 'toggle') tablesToRead.push({ id: s.b.id, block: p.block, toggle: true });
    }
  }
  const { children: toggleKids } = dp.splitToggle(model.toggle);
  for (const t of tablesToRead) {
    if (t.toggle) {
      const kids = await builder.retrieveBlockChildren(t.id);
      if (kids.length !== toggleKids.length) pageProblem(`the Help toggle holds ${kids.length} blocks, ${toggleKids.length} were planned`);
      for (let i = 0; i < Math.min(kids.length, toggleKids.length); i += 1) {
        if (dp.signature(kids[i]) !== dp.signature(toggleKids[i])) pageProblem(`Help, block ${i + 1}: planned ${oneLine(dp.signature(toggleKids[i]), 70)}, found ${oneLine(dp.signature(kids[i]), 70)}`);
        else if (toggleKids[i].type === 'table') {
          const rows = await builder.retrieveBlockChildren(kids[i].id);
          const want = toggleKids[i].table.children.map(dp.plainBlockText);
          if (rows.map(dp.plainBlockText).join('\n') !== want.join('\n')) pageProblem(`Help, block ${i + 1}: the rows of the table are not what was planned`);
        }
      }
    } else {
      const rows = await builder.retrieveBlockChildren(t.id);
      const want = t.block.table.children.map(dp.plainBlockText);
      const got = rows.map(dp.plainBlockText);
      if (got.length !== want.length || got.some((g, i) => g !== want[i])) pageProblem(`a table on the page differs from the plan (first row: ${oneLine(want[0] ?? '', 60)})`);
    }
  }
  // a linked view is put right under the block it was asked to follow; where Notion lists it among the blocks of the page, that is checked
  counts.linked_places_checked = 0;
  for (const slot of model.slots) {
    const v = demo.views?.[slot.key];
    if (!v?.linked_database_id) continue;
    const at = listing.findIndex((b) => normId(b.id) === normId(v.linked_database_id));
    if (at < 0) continue;
    counts.linked_places_checked += 1;
    const anchorAt = listing.findIndex((b) => normId(b.id) === normId(v.anchor ?? demo.anchors?.[slot.key] ?? ''));
    if (anchorAt < 0 || at !== anchorAt + 1) pageProblem(`${slot.name} is not right under the line it belongs to`);
  }
  if (pageProblems > 5) add(`page: and ${pageProblems - 5} more differences`);
  counts.blocks = countBlocks(expected);
  counts.tables_on_page = seen.filter((s) => s.k === 'db').length;

  // 4. the tables
  const rowsOf = (table) => loaded.plainRows(table);
  const schemaOf = (table) => loaded.schema(table);
  const missingColumns = (table, names) => {
    const have = schemaOf(table)?.properties ?? {};
    return names.filter((n) => !have[n]);
  };

  const rulebook = rowsOf('rulebook');
  counts.rulebook = rulebook.length;
  if (rulebook.length !== 1) add(`Rulebook has ${rulebook.length} rows, it should have 1`);
  const absentTaxonomy = missingColumns('rulebook', RULEBOOK_COLUMNS);
  if (absentTaxonomy.length) add(`Rulebook has no column ${absentTaxonomy.join(', ')}`);
  if (rulebook[0]) {
    const want = dp.rulebookRow(manifest);
    const r = rulebook[0];
    if (r.Name !== tag) add(`Rulebook holds "${r.Name}", it should hold ${tag}`);
    if (r.Status !== 'Verified') add(`the Rulebook row has Status ${r.Status ?? 'empty'}, it should be Verified`);
    for (const column of RULEBOOK_COLUMNS) {
      if (column === 'Name' || !schemaOf('rulebook')?.properties?.[column]) continue;
      if (column === 'When to use' && !fresh) continue; // a passed safety check changes the rule text
      const expectedValue = want[column] === '' ? null : want[column];
      if (!sameCell(schemaOf('rulebook'), column, expectedValue, r[column])) add(`the Rulebook row differs from the manifest in ${column}`);
    }
  }

  const claims = rowsOf('claims_copy');
  counts.claims = claims.length;
  if (claims.length !== manifest.claims.length) add(`Claims has ${claims.length} rows, it should have ${manifest.claims.length}`);
  const claimsEntry = tableEntry(ctx.config, 'claims_copy');
  const C = claimsEntry.columns; // verified, review_status, notes: the editor's three columns
  const editorCols = [C.verified, C.review_status, C.notes];
  const readingColumn = claimsEntry.write_columns.reading; // the agent's own column on the claims: its reading of the editor's decisions
  const absentClaims = missingColumns('claims_copy', [...CLAIMS_COPY_COLUMNS, ...Object.values(claimsEntry.write_columns), ...editorCols]);
  if (absentClaims.length) add(`Claims has no column ${absentClaims.join(', ')}`);
  const claimByGeo = new Map(claims.map((r) => [text(r[claimsEntry.key]), r]));
  const rawClaims = new Map(loaded.pages('claims_copy').map((p) => [normId(p.id), p]));
  const rulebookPage = rulebook[0]?.page_id ?? null; // the relation of the decided claims points at the row of the tag
  const tagPages = rulebookPage ? { [tag]: rulebookPage } : {};
  const decidedBy = new Map(manifest.decided.map((d) => [d.claim, d]));
  const schemaClaims = schemaOf('claims_copy');
  // the rulebook file the page started with, whose tag hash the seeded readings carry
  const seedRubric = dp.practiceRubric(manifest, ctx.config, { edition: demo.edition, now: new Date(demo.created_at) });
  for (const c of manifest.claims) {
    const r = claimByGeo.get(c['Geo ID']);
    if (!r) {
      add(`Claims has no row for ${oneLine(c['Geo Name'], 50)}`);
      continue;
    }
    for (const column of CLAIMS_COPY_COLUMNS) {
      if (!Object.hasOwn(c, column) || !schemaClaims?.properties?.[column]) continue;
      const wantValue = c[column] === '' || (Array.isArray(c[column]) && c[column].length === 0) ? null : c[column];
      if (!sameCell(schemaClaims, column, wantValue, r[column])) add(`the claim ${oneLine(c['Geo Name'], 40)} differs from the manifest in ${column}`);
    }
    const wantLinks = [...new Set((c.source_pieces ?? []).map((p) => p.href).filter(Boolean))].sort();
    const gotLinks = [...new Set(richTextPieces(rawClaims.get(normId(r.page_id))?.properties?.[claimsEntry.columns.sources]?.rich_text).map((p) => p.href).filter(Boolean))].sort();
    if (JSON.stringify(wantLinks) !== JSON.stringify(gotLinks)) add(`the claim ${oneLine(c['Geo Name'], 40)} has ${gotLinks.length} source link(s) in Notion, ${wantLinks.length} in the manifest`);
    // the agent's columns are empty before any command ran, but for the Agent reading of a decided claim, which is its seeded reading (decision 73); an open claim has none
    const seededReading = dp.claimAgentCells(manifest, c, { rubric: seedRubric, column: readingColumn })[readingColumn] ?? null;
    if (fresh) {
      for (const column of Object.values(claimsEntry.write_columns)) {
        if (column === readingColumn && seededReading !== null) {
          if (text(r[column]) !== seededReading) add(`the earlier decision ${oneLine(c['Geo Name'], 40)} differs from the manifest in ${column}`);
        } else if (text(r[column]) !== '') add(`the claim ${oneLine(c['Geo Name'], 40)} has ${column} filled in before any command ran`);
      }
    }
    // the editor's three columns. A claim decided earlier stays as the manifest has it, whatever has run. A claim that waits for the editor starts To review with the
    // other two empty; once a command has run, or the editor has acted, it may be in any state (the editor decides it in step 3).
    const d = decidedBy.get(c.key);
    if (d) {
      let cells = {};
      try {
        cells = dp.claimEditorCells(manifest, c, tagPages);
      } catch (e) {
        add(`the earlier decision ${oneLine(c['Geo Name'], 40)} cannot be compared: ${oneLine(e.message, 120)}`);
        continue;
      }
      for (const column of editorCols) {
        const want = column === C.verified ? (cells[column] ?? []) : (cells[column] ?? null);
        const got = column === C.verified ? (r[column] ?? []) : (r[column] ?? null);
        if (!sameCell(schemaClaims, column, want, got)) add(`the earlier decision ${oneLine(c['Geo Name'], 40)} differs from the manifest in ${column}`);
      }
    } else if (fresh) {
      if (text(r[C.review_status]) !== 'To review') add(`the claim ${oneLine(c['Geo Name'], 40)} that waits for the editor has ${C.review_status} ${text(r[C.review_status]) === '' ? 'empty' : text(r[C.review_status])}, it should be To review`);
      for (const column of [C.verified, C.notes]) {
        const v = r[column];
        if (Array.isArray(v) ? v.length > 0 : text(v) !== '') add(`the claim ${oneLine(c['Geo Name'], 40)} that waits for the editor already has ${column}`);
      }
    }
  }
  const reviewed = claims.filter((r) => text(r[C.review_status]) === 'Reviewed').length;
  counts.decided = reviewed;
  counts.open = claims.length - reviewed;
  const keys = dp.openKeys(manifest);
  if (fresh && reviewed !== keys.decided.length) add(`${reviewed} claims are Reviewed, ${keys.decided.length} should be`);
  // the counts the manifest expects of a page: nine claims, five decided earlier and four to decide (the manifest's own lists are what the rows were compared with above)
  const expects = manifest.expect ?? {};
  if (expects.claims !== undefined && expects.claims !== manifest.claims.length) add(`the manifest expects ${expects.claims} claims and lists ${manifest.claims.length}`);
  if (expects.reviewed_claims !== undefined && expects.reviewed_claims !== manifest.decided.length) add(`the manifest expects ${expects.reviewed_claims} claims decided earlier and lists ${manifest.decided.length}`);
  if (expects.open_claims !== undefined && expects.open_claims !== manifest.open.length) add(`the manifest expects ${expects.open_claims} claims to decide and lists ${manifest.open.length}`);
  if (expects.ledger_rows !== undefined && expects.ledger_rows !== manifest.decided.length) add(`the manifest expects ${expects.ledger_rows} rows in Tag decisions at the start and the five decided claims make ${manifest.decided.length}`);

  // the ledger: a row for each decided claim as the tag step copies a decision, already read where the agent's proposal differs from the decision (decision 73); the rows of the
  // open claims are the tag step's to make
  const ledger = rowsOf('tag_decisions');
  counts.tag_decisions = ledger.length;
  if (fresh && ledger.length !== keys.decided.length) add(`Tag decisions has ${ledger.length} rows, it should have ${keys.decided.length} (the agent adds the others)`);
  const absentLedger = missingColumns('tag_decisions', ['Claim', 'Key', 'Tag', 'Agent proposal', 'Agent confidence', 'Agent reason', 'Claim link', 'Rulebook edition', 'Follow-up', 'Tag outcome', 'Why wrong', 'Your reasoning', 'Decided under', ...READING_COLUMNS]);
  if (absentLedger.length) add(`Tag decisions has no column ${absentLedger.join(', ')}`);
  const ledgerByKey = new Map(ledger.map((r) => [text(r.Key), r]));
  for (const c of manifest.claims) {
    const key = dp.queueKey(c, tag);
    const r = ledgerByKey.get(key);
    const d = decidedBy.get(c.key);
    if (!r) {
      if (d) add(`Tag decisions has no row ${key}`);
      continue;
    }
    if (!d) {
      if (fresh) add(`Tag decisions has a row for ${oneLine(c['Geo Name'], 40)}, which waits for the editor, before any command ran`);
      continue;
    }
    if (r.Tag !== tag) add(`the row ${oneLine(c['Geo Name'], 40)} is on the tag ${r.Tag ?? 'none'}, it should be ${tag}`);
    if (r.Claim !== c['Geo Name']) add(`the row ${key} names another claim`);
    const claimRow = claimByGeo.get(c['Geo ID']);
    if (claimRow && text(r['Claim link']) !== notionUrl(claimRow.page_id)) add(`the row ${oneLine(c['Geo Name'], 40)} does not link to its row in Claims`);
    const copy = dp.ledgerCopy(manifest, c, { rubric: seedRubric });
    // the agent's reading of a decision is the agent's to change once a command has run (a changed rule is read again), so the seeded one is compared on a page nobody has used
    const compared = fresh ? ['Agent proposal', 'Tag outcome', 'Why wrong', 'Your reasoning', 'Rulebook edition', ...READING_COLUMNS] : ['Agent proposal', 'Tag outcome', 'Why wrong', 'Your reasoning'];
    for (const column of compared) {
      if (!sameCell(schemaOf('tag_decisions'), column, copy[column] ?? null, r[column])) add(`the earlier decision ${oneLine(c['Geo Name'], 40)} differs from the manifest in ${column} of Tag decisions`);
    }
    if (fresh && text(r['Decided under']) !== '') add(`the row ${oneLine(c['Geo Name'], 40)} has Decided under filled in before any command ran`);
  }

  const lessons = rowsOf('rule_changes');
  counts.rule_changes = lessons.length;
  const absentLessons = missingColumns('rule_changes', ['Lesson', 'Tag', 'Rule', 'Kind', 'Current text', 'Proposed text', 'Safety check result', 'Supporting rows', 'Editor wording', 'Status']);
  if (absentLessons.length) add(`Rule changes has no column ${absentLessons.join(', ')}`);
  if (fresh && lessons.length) add(`Rule changes holds ${lessons.length} rows before any command ran`);

  const settings = rowsOf('agent_settings');
  counts.agent_settings = settings.length;
  if (settings.length !== 1) add(`Agent settings has ${settings.length} rows, it should have 1`);
  const absentSettings = missingColumns('agent_settings', ['Name', 'Paused', 'Rulebook edition', 'Last run summary']);
  if (absentSettings.length) add(`Agent settings has no column ${absentSettings.join(', ')}`);
  if (settings[0]) {
    if (text(settings[0]['Rulebook edition']) === '') add('Agent settings has no Rulebook edition');
    else if (fresh && text(settings[0]['Rulebook edition']) !== demo.edition) add(`Agent settings has the edition ${settings[0]['Rulebook edition']}, the page was built with ${demo.edition}`);
    if (fresh && settings[0].Paused === true) add('Paused is ticked in Agent settings');
  }

  // 5. the columns of every table and the views. First the shape the manifest expects of the Claims table and its three views: the structure the page was built from has to say
  // the same, and the live columns and views are compared with that structure below.
  const claimsViews = structure.views.filter((v) => v.table === 'claims_copy');
  if (Array.isArray(expects.claims_columns)) {
    const liveColumns = structure.tables.claims_copy.columns.filter((c) => !c.retired).map((c) => c.name);
    if (JSON.stringify(liveColumns.slice(0, expects.claims_columns.length)) !== JSON.stringify(expects.claims_columns)) add(`the structure of Claims starts with ${liveColumns.slice(0, expects.claims_columns.length).join(', ')}, the manifest expects ${expects.claims_columns.join(', ')}`);
    for (const view of claimsViews) {
      if (JSON.stringify(view.columns) !== JSON.stringify(expects.claims_columns)) add(`the structure shows ${view.columns.join(', ')} on the view ${view.name}, the manifest expects ${expects.claims_columns.join(', ')}`);
    }
  }
  for (const [name, filter] of Object.entries(expects.claims_view_filters ?? {})) {
    const view = claimsViews.find((v) => v.name === name);
    if (!view) add(`the structure has no view ${name} of Claims`);
    else if (view.filter !== filter) add(`the structure filters the view ${name} by "${view.filter}", the manifest expects "${filter}"`);
  }
  const wanted = (demo.views && typeof demo.views === 'object') ? Object.keys(demo.views).filter((k) => demo.views[k]) : [];
  const extraViews = (demo.views && typeof demo.views === 'object') ? Object.keys(demo.views).filter((k) => !Object.hasOwn(dp.VIEW_NAMES, k)) : [];
  if (extraViews.length) add(`the practice page records a view that is not one of the five: ${extraViews.join(', ')}`);
  const checkedStructure = { ...structure, views: structure.views.filter((v) => wanted.includes(Object.keys(dp.VIEW_NAMES).find((k) => dp.VIEW_NAMES[k] === v.name))) };
  const withLinked = {
    ...builder,
    async listViews(databaseId) {
      const refs = await builder.listViews(databaseId);
      const extra = Object.values(demo.views ?? {}).filter((v) => v?.kind === 'linked' && normId(v.source_database_id) === normId(databaseId)).map((v) => ({ object: 'view', id: v.id }));
      return [...refs, ...extra.filter((e) => !refs.some((r) => normId(r.id) === normId(e.id)))];
    },
  };
  try {
    const checked = await verifyStructure({ client: withLinked, config: ctx.config, structure: checkedStructure });
    for (const d of checked.differences) add(`${dp.PRACTICE_TITLES[d.table] ?? d.table}: ${d.kind} - ${oneLine(d.detail, 160)}`);
  } catch (e) {
    add(`the tables and views could not be checked: ${oneLine(e.message, 160)}`);
  }
  if (!demo.views) {
    if (demo.fallback !== 'no-views') add('the practice page has no views and does not record why');
  } else if (demo.fallback !== 'no-views' && ctx.model.slots.some((s) => !demo.views[s.key])) add('a linked view is missing and the fallback is not recorded');
  counts.linked_views = Object.values(demo.views ?? {}).filter((v) => v?.kind === 'linked').length;
  counts.tab_views = Object.values(demo.views ?? {}).filter((v) => v?.kind === 'tab').length;
  counts.fallback = demo.fallback ?? null;
  counts.steps = manifest.steps.length;
  counts.fresh = fresh;
  return { ok: problems.length === 0, problems, counts };
}

// ---- finishing a start ------------------------------------------------------------------------------------------------------------------------

async function finishStart(ctx, run) {
  const { demo } = ctx;
  const { loaded } = await pullTables(ctx, 'all');
  rmSync(SETUP_MARKER(ctx.demoRoot), { force: true });
  const result = await verifyDemo(ctx, { loaded, fresh: true });
  demo.request_counts = countAll(ctx.demoRoot);
  if (result.ok) {
    demo.state = 'ready';
    delete demo.verify_failed;
    demo.errors = (demo.errors ?? []).filter((e) => e.view);
  } else {
    demo.verify_failed = true;
    demo.errors = [...(demo.errors ?? []).filter((e) => e.view), ...result.problems.map((message) => ({ at: ctx.now().toISOString(), message }))];
  }
  persist(ctx);
  const title = sayable(demo.title);
  if (!result.ok) {
    const first = `"${oneLine(result.problems[0], 110).replace(/["“”]/g, "'").replace(/[{}]/g, '')}"`;
    const parts = {
      sentence: `Walkthrough: the practice page was built, but the check found ${plural(result.problems.length, 'problem')}; the first reads ${first}.`,
      rows: [], next: `Next: ask the engineer to look at the practice page (${demo.page.url}).`,
    };
    emit(ctx.io, parts, run.dir);
    for (const p of result.problems) ctx.io.err(`verify: ${p}`);
    return EXIT.INVALID;
  }
  emit(ctx.io, {
    sentence: `Walkthrough: your practice page is ready under ${sayable(demo.parent.title || 'that page')}.`,
    header: ['Table', 'Now', ''],
    rows: tablesNow(result.counts),
    next: `Next: open ${title} (${demo.page.url}) and follow step 1.`,
  }, run.dir);
  return EXIT.OK;
}

// ---- start --------------------------------------------------------------------------------------------------------------------------------------

function checkTitle(raw) {
  const title = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (title === '' || title.length > 200) throw stop(EXIT.INVALID, '--title needs a title of 1 to 200 characters');
  return title;
}

// the plan on disk is the plan that is sent: written first, and a plan that differs from what the profile makes is refused
function settlePlanFile(ctx) {
  const file = join(ctx.demoRoot, 'setup-plan.json');
  const built = buildSetupPlan(ctx);
  if (!existsSync(file)) {
    writeJsonAtomic(file, built);
    return;
  }
  if (JSON.stringify(readJson(file)) !== JSON.stringify(JSON.parse(JSON.stringify(built)))) {
    throw stop(EXIT.INVALID, 'setup-plan.json is not the plan of this practice page any more (it was changed); nothing was sent');
  }
}

// What a failure in the middle of a build means. A refusal that will not change by asking again (a 400, 401, 403 or 404) is exit 2 and the page is
// marked, so that asking again under the same link makes a new page instead of going back to it; anything else (a network failure, a 5xx, a lost
// create, a rate limit) is exit 1: the same request continues where it stopped.
function stopOnNotion(e, ctx) {
  const lost = e instanceof NotionError && e.code === 'create_uncertain';
  const permanent = e instanceof NotionError && [400, 401, 403, 404].includes(e.status);
  const message = lost ? String(e.message) : permanent ? `Notion refused a request (${oneLine(e.message, 200)})` : oneLine(e?.message ?? String(e), 300);
  if (ctx?.demo) {
    ctx.demo.errors = [...(ctx.demo.errors ?? []), { at: ctx.now().toISOString(), message: oneLine(message, 300) }];
    if (permanent) ctx.demo.refused_by_notion = true;
    try {
      saveDemo(ctx);
    } catch {
      // the folder is the engineer's to look at
    }
  }
  const title = ctx?.demo?.title ? ` ${sayable(ctx.demo.title)}` : '';
  if (permanent) {
    return stop(EXIT.INVALID, message, {
      report: { sentence: `Walkthrough: your practice page${title} could not be finished, because Notion refused a request.`, rows: [], next: 'Next: ask the engineer to look at the message the script printed.' },
    });
  }
  const resume = ctx?.demo ? `to continue: node agents/claim-tagger-mvp/scripts/walkthrough.mjs start --resume ${ctx.demo.demo_id}   (or ask for the practice page again under the same link)` : null;
  return stop(EXIT.ERROR, resume ? `${message}\n${resume}` : message, {
    report: {
      sentence: `Walkthrough: your practice page${title} stopped before it was finished.`,
      rows: [],
      next: 'Next: ask for the practice page again under the same link; it continues where it stopped.',
    },
  });
}

async function runBuild(ctx, { argv, resumeCommandLine }) {
  const { io } = ctx;
  if (ctx.demo.state === 'ready') {
    const run = beginRun({ root: ctx.demoRoot, kind: 'walkthrough-start', argv, now: ctx.now, resume: resumeCommandLine });
    openClients(ctx);
    const { loaded } = await pullTables(ctx, 'all');
    const result = await verifyDemo(ctx, { loaded, fresh: untouched(ctx, loaded) });
    run.finish(result.ok ? EXIT.OK : EXIT.INVALID);
    if (!result.ok) throw stop(EXIT.INVALID, `the practice page has problems:\n- ${result.problems.slice(0, 8).join('\n- ')}`);
    emit(io, {
      sentence: `Walkthrough: your practice page is ready under ${sayable(ctx.demo.parent.title || 'that page')}.`,
      header: ['Table', 'Now', ''], rows: tablesNow(result.counts), next: `Next: open ${sayable(ctx.demo.title)} (${ctx.demo.page.url}) and follow step 1.`,
    }, run.dir);
    return EXIT.OK;
  }
  io.out('Building the page.');
  const run = beginRun({ root: ctx.demoRoot, kind: 'walkthrough-start', argv, now: ctx.now, resume: resumeCommandLine });
  let code = EXIT.OK;
  try {
    settlePlanFile(ctx);
    openClients(ctx);
    if (ctx.demo.state === 'planned') await buildStructure(ctx);
    if (ctx.demo.state === 'created') await seedRows(ctx);
    run.update({ pull_id: latestPullId(ctx.demoRoot) });
    code = await finishStart(ctx, run);
  } catch (e) {
    let ended = e;
    if (!(e instanceof Exit)) {
      ended = e instanceof PlanError || e instanceof InputError || e instanceof StructureError || e instanceof dp.ManifestError ? stop(EXIT.INVALID, e.message) : stopOnNotion(e, ctx);
    }
    run.finish(ended.exit);
    throw ended;
  }
  run.finish(code);
  return code;
}

async function startCommand(args, io, env) {
  const v = parse(args, { parent: { type: 'string' }, 'dry-run': { type: 'boolean' }, resume: { type: 'string' }, manifest: { type: 'string' }, title: { type: 'string' } });
  if (v.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  const root = env.root ?? codeRoot();
  const now = env.now ?? (() => new Date());
  const production = loadProduction(root, env);
  const dry = v['dry-run'] === true;
  if (dry && v.resume !== undefined) throw stop(EXIT.INVALID, 'a dry run builds nothing, so it has nothing to resume');
  if (existsSync(join(root, 'runs', 'PAUSED')) && !dry) throw stop(EXIT.PAUSED, 'the agent is paused (the pause file exists), so no practice page was made; a person has to remove the pause first');

  if (v.resume !== undefined) {
    let found;
    try {
      found = dp.pickDemo(root, v.resume);
    } catch (e) {
      throw stop(EXIT.INVALID, e.message);
    }
    if (v.parent !== undefined) {
      const wanted = dp.parseNotionLink(v.parent);
      if (!wanted || normId(wanted) !== normId(found.demo.parent?.id ?? '')) throw stop(EXIT.INVALID, 'this practice page was started under another page; ask for it again with the same link, or leave the link out');
    }
    const ctx = loadDemoContext({ root, found, env, io, now });
    return runBuild(ctx, { argv: ['start', ...args], resumeCommandLine: `node agents/claim-tagger-mvp/scripts/walkthrough.mjs start --resume ${found.id}` });
  }

  if (v.parent === undefined || text(v.parent) === '') throw stop(EXIT.INVALID, MESSAGES.noParent);
  const parentId = dp.parseNotionLink(v.parent);
  if (!parentId) throw stop(EXIT.INVALID, `That is not a link to a Notion page. ${MESSAGES.noParent}`);
  refuseProtectedParent(production, parentId);

  // the inputs, read and checked before Notion is asked anything
  const manifestFile = v.manifest !== undefined ? resolve(v.manifest) : codeFile(root, 'walkthrough', 'manifest.json');
  let manifestInput;
  let template;
  let structure;
  try {
    manifestInput = dp.loadManifest(manifestFile);
    const templateFile = dp.templateFileFor(manifestFile, codeFile(root, 'walkthrough', 'page.md'));
    template = dp.loadTemplate(templateFile);
    template.file = templateFile;
    structure = dp.practiceStructure(loadStructureFile(root));
  } catch (e) {
    if (e instanceof dp.ManifestError || e instanceof StructureError) throw stop(EXIT.INVALID, e.message);
    throw e;
  }
  const when = now();
  const edition = nextEdition(null, when);
  const values = { edition, date: dp.dateWord(when) };
  let model;
  try {
    model = dp.pageModel(template.text, values);
  } catch (e) {
    if (e instanceof dp.ManifestError || e?.code === 'BLOCKS_SYNTAX') throw stop(EXIT.INVALID, e.message);
    throw e;
  }
  const title = v.title !== undefined ? checkTitle(v.title) : dp.demoTitle(when);

  // (a) one GET of the parent page. The log is kept in memory until the folder exists, so a refused parent leaves nothing behind.
  const builderLog = dp.bufferedLog();
  const restLog = dp.bufferedLog();
  const scratch = {
    env, config: production, demoRoot: null, io, now, root,
  };
  const clients = makeClients(scratch, { dry, builderLog: builderLog.log, restLog: restLog.log });
  const parent = await readParent(clients.builder, parentId, production).catch((e) => {
    if (e instanceof Exit) throw e;
    throw stopOnNotion(e, null);
  });

  // a page that stopped earlier under this same parent is continued, not made a second time: asking again is the retry (not when the inputs are chosen)
  if (!dry && v.manifest === undefined && v.title === undefined) {
    const earlier = dp.listDemos(root).find((d) => d.demo.state !== 'ready' && !d.demo.verify_failed && !d.demo.refused_by_notion && normId(d.demo.parent?.id ?? '') === normId(parent.id)
      && d.demo.manifest_sha256 === manifestInput.sha256 && d.demo.page_sha256 === template.sha256 // the same inputs, or it is a new page
      && when.getTime() - Date.parse(d.demo.created_at) < RESUME_WINDOW_MS && when.getTime() >= Date.parse(d.demo.created_at));
    if (earlier) {
      io.err(`walkthrough: the practice page ${earlier.id} under this page stopped earlier; it is continued, not made again`);
      const ctx = loadDemoContext({ root, found: earlier, env, io, now });
      return runBuild(ctx, { argv: ['start', ...args], resumeCommandLine: `node agents/claim-tagger-mvp/scripts/walkthrough.mjs start --resume ${earlier.id}` });
    }
  }

  // (b) the folder, and (c) the plan and the preview, checked by the page lint before anything is built
  let id = null;
  let dir = null;
  for (let tries = 0; tries < 6; tries += 1) {
    id = dp.newDemoId(when, env.random);
    dir = dp.demoDir(root, id);
    if (!existsSync(dir)) break;
    dir = null;
  }
  if (!dir) throw stop(EXIT.ERROR, 'a free id for the practice page could not be found; try again');
  const demo = {
    demo_id: id, created_at: when.toISOString(), updated_at: when.toISOString(), title, manifest_version: manifestInput.manifest.manifest_version, manifest_sha256: manifestInput.sha256,
    page_sha256: template.sha256, api_version: BUILDER_API_VERSION, parent, state: 'planned', edition, date: values.date, page: null, databases: {}, views: {}, fallback: null,
    tables_position: 'marker', anchors: {}, request_counts: null, errors: [],
  };
  const draft = {
    root, demoRoot: dir, id, demo, config: null, manifest: manifestInput.manifest, template, structure, values, model, env, io, now, clients: null,
  };
  const preview = `${dp.annotatedPreview(model.rendered, {})}\n`;
  const lint = lintPage(preview, { manifest: manifestInput.manifest });
  mkdirSync(dir, { recursive: true });
  const planFile = join(dir, 'setup-plan.json');
  const draftPlanCtx = { ...draft, config: dp.buildDemoConfig(production, { demoId: id, title, parentId: parent.id, tag: manifestInput.manifest.tag.Name }) };
  writeJsonAtomic(planFile, buildSetupPlan(draftPlanCtx));
  writeTextAtomic(join(dir, 'preview.md'), preview);
  if (!lint.ok) {
    const lines = lint.problems.slice(0, 10).map((p) => `  preview.md line ${p.line}: ${p.detail}`);
    throw stop(EXIT.INVALID, `the page does not pass its own lint, so nothing was built:\n${lines.join('\n')}${lint.problems.length > 10 ? `\n  ... and ${lint.problems.length - 10} more` : ''}`);
  }
  if (dry) {
    const rowsPlanned = Object.values(buildSetupPlan(draftPlanCtx).rows).reduce((n, list) => n + list.length, 0);
    emit(io, {
      sentence: 'Walkthrough: the preview of your practice page passes the page check; nothing was built in Notion.',
      header: ['What', 'Planned', ''],
      rows: [['Steps', String(manifestInput.manifest.steps.length), ''], ['Tables', String(TABLES.length), ''], ['Views', String(Object.keys(dp.VIEW_NAMES).length), ''], ['Rows', String(rowsPlanned), '']],
      next: `Next: ${MESSAGES.dryNext}.`,
    });
    return EXIT.OK;
  }

  // the profile (b), now that the page passed
  writeProfile({
    dir, production, practice: structure, manifest: manifestInput, manifestFile, templateFile: template.file, template, demo, now, values,
  });
  builderLog.attach(logFiles(dir).builder);
  restLog.attach(logFiles(dir).rest);
  writeJsonAtomic(join(dir, 'demo.json'), demo);
  const ctx = loadDemoContext({ root, found: { id, dir, demo: dp.readDemo(dir) }, env, io, now });
  return runBuild(ctx, { argv: ['start', ...args], resumeCommandLine: `node agents/claim-tagger-mvp/scripts/walkthrough.mjs start --resume ${id}` });
}

// ---- where ---------------------------------------------------------------------------------------------------------------------------------------

/** Where the editor is, from a pull of the page: the Review status of the open claims, the rule changes and the Follow-up of the ledger rows the live rule change rests on (dp.stepOf). */
const stepFor = (ctx, loaded) => dp.stepOf({
  claims: loaded.claims() ?? [], ledger: loaded.queue() ?? [], lessons: loaded.lessons() ?? [], open: dp.openClaims(ctx.manifest), settings: loaded.settings(),
});

function whereParts(ctx, st) {
  const steps = ctx.manifest.steps;
  const command = (n) => steps[n - 1]?.command ?? null;
  const hasView = (key) => Boolean(ctx.demo.views?.[key]);
  const link = (key, table) => (hasView(key) ? { name: dp.VIEW_NAMES[key], href: viewLink(ctx.config, key) } : { name: dp.PRACTICE_TITLES[table], href: tableLink(ctx.config, table) });
  if (st.step === 'complete') {
    return { sentence: 'Walkthrough: you have been through all seven steps of the practice page.', next: 'Next: nothing to type; archive the page by hand when you no longer need it.' };
  }
  const head = `Walkthrough: you are at step ${st.step}, ${steps[st.step - 1].title}`;
  switch (st.step) {
    case 1: return { sentence: `${head}.`, next: `Next: type ${command(1)}.` };
    case 2: return { sentence: `${head}.`, next: `Next: type ${command(2)}.` };
    case 3: {
      // every open claim is To review, so every tag the agent judged on them waits and all are in Your queue (a view of the Claims table; without the view, the table)
      const l = link('your_queue', 'claims_copy');
      // none decided yet: "your four claims" (the words of the page, counted from the manifest); some decided: the ones that are left
      const all = st.remaining === undefined || st.remaining === ctx.manifest.open.length;
      const which = all ? yourClaims(ctx.manifest.open.length) : `your remaining ${st.remaining === 1 ? 'claim' : 'claims'}`;
      return { sentence: `${head}.`, next: `Next: open ${l.name} (${l.href}) and decide ${which}.` };
    }
    case 4: return { sentence: `${head}.`, next: `Next: type ${command(4)}.` };
    case 5: {
      const l = link('lessons_waiting', 'rule_changes');
      return { sentence: `${head}.`, next: `Next: open ${l.name} (${l.href}) and set Status to Approved.` };
    }
    case 6: {
      if (st.branch === 'not-passed') {
        const l = link('lessons_waiting', 'rule_changes');
        return { sentence: `${head}; it did not pass.`, next: `Next: open ${l.name} (${l.href}) and write the rule as you want it in Editor wording.` };
      }
      return { sentence: `${head}.`, next: `Next: type ${command(6)}.` };
    }
    default: {
      if (st.branch === 'stopped') return { sentence: `${head}; the run stopped before it re-checked your claims.`, next: 'Next: type /claim-tagger demo follow-up.' };
      const l = link('agent_disagreed', 'claims_copy');
      return { sentence: `${head}.`, next: `Next: add a note in Challenged tags notes on the claims in ${l.name} (${l.href}).` };
    }
  }
}

async function whereCommand(args, io, env) {
  const v = parse(args, { demo: { type: 'string' } });
  if (v.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  const root = env.root ?? codeRoot();
  const now = env.now ?? (() => new Date());
  let found;
  try {
    found = pickPage(root, env, v.demo);
  } catch (e) {
    throw stop(EXIT.INVALID, e.message);
  }
  const ctx = loadDemoContext({ root, found, env, io, now });
  if (found.demo.state !== 'ready' && found.demo.state !== 'seeded') {
    throw stop(EXIT.ERROR, `the practice page ${found.id} is not finished (its state is "${found.demo.state}")`, {
      report: { sentence: `Walkthrough: your practice page ${sayable(found.demo.title)} was not finished.`, rows: [], next: 'Next: ask for the practice page again under the same link; it continues where it stopped.' },
    });
  }
  const run = beginRun({ root: ctx.demoRoot, kind: 'walkthrough-where', argv: ['where', ...args], now });
  try {
    const { loaded, result } = await pullTables(ctx, 'all');
    run.update({ pull_id: result.pullId });
    const st = stepFor(ctx, loaded);
    if (st.problem) throw stop(EXIT.INVALID, `the practice page does not look as it was built: ${st.problem}`);
    emit(io, whereParts(ctx, st), run.dir);
    run.finish(EXIT.OK);
    return EXIT.OK;
  } catch (e) {
    run.finish(e instanceof Exit ? e.exit : EXIT.ERROR);
    throw e;
  }
}

// ---- verify command ------------------------------------------------------------------------------------------------------------------------

async function verifyCommand(args, io, env) {
  const v = parse(args, { demo: { type: 'string' }, json: { type: 'boolean' } });
  if (v.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  const root = env.root ?? codeRoot();
  const now = env.now ?? (() => new Date());
  let found;
  try {
    found = pickPage(root, env, v.demo);
  } catch (e) {
    throw stop(EXIT.INVALID, e.message);
  }
  const ctx = loadDemoContext({ root, found, env, io, now });
  const run = beginRun({ root: ctx.demoRoot, kind: 'walkthrough-verify', argv: ['verify', ...args], now });
  try {
    if (!['seeded', 'ready'].includes(found.demo.state)) {
      const result = { ok: false, problems: [`the practice page is not finished (its state is "${found.demo.state}")`], counts: {} };
      run.finish(EXIT.INVALID);
      if (v.json) io.out(JSON.stringify(result));
      else emit(io, { sentence: `Walkthrough: your practice page ${sayable(found.demo.title)} was not finished.`, rows: [], next: 'Next: ask for the practice page again under the same link; it continues where it stopped.' }, run.dir);
      return EXIT.INVALID;
    }
    openClients(ctx);
    const { loaded, result: pulled } = await pullTables(ctx, 'all');
    run.update({ pull_id: pulled.pullId });
    const result = await verifyDemo(ctx, { loaded, fresh: untouched(ctx, loaded) });
    run.finish(result.ok ? EXIT.OK : EXIT.INVALID);
    if (v.json) {
      io.out(JSON.stringify({ ok: result.ok, problems: result.problems, counts: result.counts }));
      return result.ok ? EXIT.OK : EXIT.INVALID;
    }
    if (result.ok) {
      emit(io, {
        sentence: `Walkthrough: your practice page ${sayable(found.demo.title)} is as it was built.`,
        header: ['Table', 'Now', ''], rows: tablesNow(result.counts), next: `Next: open ${sayable(found.demo.title)} (${found.demo.page.url}) and follow the step you are at.`,
      }, run.dir);
      return EXIT.OK;
    }
    const first = `"${oneLine(result.problems[0], 110).replace(/["“”]/g, "'").replace(/[{}]/g, '')}"`;
    emit(io, {
      sentence: `Walkthrough: the check found ${plural(result.problems.length, 'problem')} on the practice page; the first reads ${first}.`,
      rows: [], next: `Next: ask the engineer to look at the practice page (${found.demo.page.url}).`,
    }, run.dir);
    for (const p of result.problems) io.err(`verify: ${p}`);
    return EXIT.INVALID;
  } catch (e) {
    run.finish(e instanceof Exit ? e.exit : EXIT.ERROR);
    throw e;
  }
}

// ---- list ----------------------------------------------------------------------------------------------------------------------------------------

async function listCommand(args, io, env) {
  const v = parse(args, {});
  if (v.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  const root = env.root ?? codeRoot();
  const now = env.now ?? (() => new Date());
  const all = dp.listDemos(root);
  if (all.length === 0) {
    emit(io, { sentence: 'Walkthrough: there is no practice page yet.', rows: [], next: 'Next: ask for a practice page under a Notion page of your choice.' });
    return EXIT.OK;
  }
  // the page the demo commands reach when none is named, and the newest page under Demos in any state (an unfinished one is what `where` reports on)
  const reach = (opts) => {
    try {
      return pickPage(root, env, undefined, opts);
    } catch (e) {
      if (e instanceof dp.ManifestError) return null;
      throw e;
    }
  };
  const reached = reach({ ready: true });
  const latest = reach({});
  const newest = all.slice(0, 5);
  const shown = reached && !newest.some((d) => d.id === reached.id) ? [...all.slice(0, 4), reached] : newest;
  const rows = [];
  let reachedAt = null;
  for (const found of shown) {
    let step = '-';
    if (found.demo.state === 'ready') {
      try {
        const ctx = loadDemoContext({ root, found, env, io, now });
        const { loaded } = await pullTables(ctx, 'all');
        const st = stepFor(ctx, loaded);
        step = st.problem ? 'unknown' : st.step === 'complete' ? 'complete' : `step ${st.step}`;
        if (reached && found.id === reached.id) reachedAt = { ctx, st };
      } catch {
        step = 'unknown';
      }
    }
    const cell = `${sayable(found.demo.title)} (${found.demo.page?.url ?? 'not made yet'})`;
    const state = found.demo.state ?? 'unknown';
    rows.push([cell, reached && found.id === reached.id ? `${state} · used by the demo commands` : state, step]);
  }
  // the Next line is for the page the commands reach: its real next step (the archive line only for a page that is complete)
  let next;
  if (latest && latest.demo.state !== 'ready') next = 'Next: ask for the practice page again under the same link; it continues where it stopped.';
  else if (reachedAt && !reachedAt.st.problem) next = whereParts(reachedAt.ctx, reachedAt.st).next;
  else if (reached) next = `Next: open ${sayable(reached.demo.title)} (${reached.demo.page.url}).`;
  else next = 'Next: ask for a practice page under the Demos page; the demo commands reach only the pages under it.';
  const cut = all.length <= shown.length ? '' : (shown === newest ? `, the newest ${shown.length} below` : `, the newest ${shown.length - 1} and the one the demo commands use below`);
  emit(io, {
    sentence: `Walkthrough: ${plural(all.length, 'practice page')}${cut}.`,
    header: ['Practice page', 'State', 'Step'], rows, next,
  });
  return EXIT.OK;
}

// ---- run -----------------------------------------------------------------------------------------------------------------------------------------

async function runCommand(args, io, env) {
  const root = env.root ?? codeRoot();
  let rest = [...args];
  let demoId;
  if (rest[0] === '--demo') {
    demoId = rest[1];
    rest = rest.slice(2);
    if (demoId === undefined) throw stop(EXIT.INVALID, '--demo needs a practice page id');
  } else if (rest[0]?.startsWith('--demo=')) {
    demoId = rest[0].slice('--demo='.length);
    rest = rest.slice(1);
  }
  if (rest[0] === '--help' || rest[0] === '-h') {
    io.out(USAGE);
    return EXIT.OK;
  }
  const script = rest[0];
  const childArgs = rest.slice(1);
  if (!script) throw stop(EXIT.INVALID, `run needs a script to run (${RUN_SCRIPTS.join(', ')})\n${USAGE}`);
  if (!RUN_SCRIPTS.includes(script)) throw stop(EXIT.INVALID, `run: "${script}" is not a script that a practice page may run (${RUN_SCRIPTS.join(', ')})`);
  for (const a of [...childArgs]) {
    const flag = String(a).split('=')[0];
    if (REFUSED_ARGS.includes(flag)) throw stop(EXIT.INVALID, `run: ${flag} is never passed to a script from a practice page`);
  }
  let found;
  try {
    found = pickPage(root, env, demoId, { ready: true });
  } catch (e) {
    throw stop(EXIT.INVALID, e.message);
  }
  if (found.demo.state !== 'ready') throw stop(EXIT.INVALID, `the practice page ${found.id} is not finished (its state is "${found.demo.state}"); ask for it again under the same link`);
  let config;
  try {
    config = loadConfig(found.dir);
  } catch (e) {
    throw stop(EXIT.INVALID, `the profile of the practice page ${found.id} is not valid: ${e.message}`);
  }
  if (config.demo !== true || config.demo_id !== found.id) throw stop(EXIT.INVALID, `the folder ${found.id} is not a demo profile`);

  const args2 = [...childArgs];
  const hasLesson = args2.some((a) => a === '--lesson' || String(a).startsWith('--lesson='));
  if ((script === 'promote' || script === 'followup') && !hasLesson) {
    // the newest pull of the practice page; if that one left Rule changes out, the newest that holds it
    let pullId = latestPullId(found.dir);
    if (pullId && !loadPull(found.dir, pullId, { config }).covers('rule_changes')) pullId = latestPullId(found.dir, ['rule_changes']);
    if (pullId) {
      const status = script === 'promote' ? 'Approved' : 'Live';
      const lessons = (loadPull(found.dir, pullId, { config }).lessons() ?? []).filter((l) => l.Status === status);
      if (lessons.length > 1) {
        throw stop(EXIT.INVALID, `run: ${lessons.length} rule changes are ${status}: ${lessons.map((l) => `"${l.Lesson}"`).join('; ')}. Add --lesson "<title>" to say which one.`);
      }
      if (lessons.length === 1) args2.push('--lesson', lessons[0].Lesson);
    }
  }

  const scriptsDir = env.scriptsDir ?? join(codeRoot(), 'scripts');
  const file = join(scriptsDir, `${script}.mjs`);
  if (!existsSync(file)) throw stop(EXIT.INVALID, `run: the script ${script} does not exist`);
  const out = io.rawOut ?? ((s) => io.out(String(s).replace(/\n$/, '')));
  const err = io.rawErr ?? ((s) => io.err(String(s).replace(/\n$/, '')));
  return new Promise((done) => {
    const child = spawn(process.execPath, [file, ...args2], { env: { ...process.env, ...(env.childEnv ?? {}), [ROOT_ENV]: found.dir }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.setEncoding('utf8'); // a character that arrives in two pieces is put together
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => out(d));
    child.stderr.on('data', (d) => err(d));
    child.on('error', (e) => {
      io.err(`run: ${script} could not be started (${e.message})`);
      done(EXIT.ERROR);
    });
    child.on('close', (code) => done(typeof code === 'number' ? code : EXIT.ERROR));
  });
}

// ---- acting as the editor (decision D31) --------------------------------------------------------------------------------------------------------
//
// On a practice page the agent may do what the editor does in Notion, so that the calibration runs and the evals of the skill can go through all
// seven steps: decide one of the four open claims, approve or reject a rule change (with the editor's own wording). It is the demo-only exception to
// hard rule 1, and it is kept narrow: only a practice page under runs/demos/, only an update of a claim (the editor's three columns, the four claims
// that wait) or of a rule change (Status Approved or Rejected, Editor wording), only through a plan that checkPlan allows with demoEditor: true and
// applyPlan reads back. Every action is a line in runs/demos/<id>/editor-actions.jsonl before it is sent and another when it is done.

const DECISION_OUTCOMES = Object.freeze(['Applies', 'Does not apply']);
const editorSentence = (id) => `acting as the editor on practice page ${id} (decision D31)`;

function logEditorAction(ctx, entry) {
  appendJsonl(join(ctx.demoRoot, 'editor-actions.jsonl'), { at: ctx.now().toISOString(), demo_id: ctx.id, sentence: editorSentence(ctx.id), ...entry });
}

// The practice page an editor action is for: the one named, else the newest finished one; the clients are open and the run is recorded.
async function withEditing(command, v, args, io, env, body) {
  const root = env.root ?? codeRoot();
  const now = env.now ?? (() => new Date());
  let found;
  try {
    found = pickPage(root, env, v.demo, { ready: true });
  } catch (e) {
    throw stop(EXIT.INVALID, e.message);
  }
  if (found.demo.state !== 'ready') throw stop(EXIT.INVALID, `the practice page ${found.id} is not finished (its state is "${found.demo.state}"); ask for it again under the same link`);
  const ctx = loadDemoContext({ root, found, env, io, now });
  if (ctx.config.demo !== true || !isDemoRoot(ctx.demoRoot)) throw stop(EXIT.INVALID, `${command} works only on a practice page, in a folder under runs/demos`);
  if (existsSync(join(ctx.demoRoot, 'runs', 'PAUSED'))) throw stop(EXIT.PAUSED, 'the practice page is paused (its pause file exists), so nothing was written; a person has to remove the pause first');
  openClients(ctx);
  const run = beginRun({ root: ctx.demoRoot, kind: `walkthrough-${command}`, argv: [command, ...args], now });
  try {
    const code = await body(ctx, run);
    run.finish(code);
    return code;
  } catch (e) {
    run.finish(e instanceof Exit ? e.exit : EXIT.ERROR);
    throw e;
  }
}

// a pull of the table to change, or of the tables to read (the Rulebook, for the page ids of the relation), and of Agent settings, for Paused: the rows as they are now
async function pullForEditing(ctx, tables) {
  const { result, loaded } = await pullTables(ctx, [...[].concat(tables), 'agent_settings']);
  if (result.paused) throw stop(EXIT.PAUSED, 'Paused is ticked in Agent settings of the practice page, so nothing was written; a person has to untick it');
  return loaded;
}

/**
 * One update as the editor: a plan with one op (the values it expects to find now, so a row that changed meanwhile is not overwritten), checked with
 * demoEditor, logged, applied and read back, logged again. `wrote` are the new values, `before` the ones found.
 */
async function updateAsEditor(ctx, { action, table, key, pageId, wrote, before, loaded, note = {} }) {
  const dir = freshDir(ctx.demoRoot, `editor-${action}`, ctx.now);
  const planRun = dir.split(/[\\/]/).pop();
  const entry = { action, table, key, page_id: pageId, wrote, before, plan_run: planRun, ...note };
  const plan = newPlan({ runId: planRun, script: 'walkthrough.mjs', rubricEdition: ctx.demo.edition, config: ctx.config, now: ctx.now });
  plan.update(table, key, pageId, wrote, { expect: before });
  const checked = checkPlan(plan, ctx.config, { root: ctx.demoRoot, demoEditor: true });
  if (!checked.ok) throw stop(EXIT.INVALID, `the plan was refused and nothing was sent: ${checked.problems.slice(0, 3).join('; ')}`);
  logEditorAction(ctx, { ...entry, status: 'planned' });
  ctx.io.err(`walkthrough: ${editorSentence(ctx.id)}: ${dp.PRACTICE_TITLES[table]} ${oneLine(key, 60)}: ${Object.keys(wrote).join(', ')}`);
  let result;
  try {
    result = await applyPlan({
      plan, dir, client: ctx.clients.rest, config: ctx.config, schemas: { [table]: loaded.schema(table) }, pulled: loaded.pulled([table]), root: ctx.demoRoot, now: ctx.now, demoEditor: true,
    });
  } catch (e) {
    logEditorAction(ctx, { ...entry, status: 'failed', error: oneLine(e?.message ?? String(e), 300) });
    if (e instanceof PlanError) throw stop(EXIT.INVALID, `${e.message}: ${e.problems.slice(0, 3).join('; ')}`);
    throw e;
  }
  if (result.code === EXIT.OK && (result.done !== 1 || result.skipped > 0)) {
    // the row was no longer what the plan expected when it was to be written: the ledger says skipped and nothing was sent
    const why = result.lists.skipped.map((s) => s.detail).filter(Boolean).join('; ') || 'the row is no longer as it was when it was read';
    logEditorAction(ctx, { ...entry, status: 'failed', error: oneLine(why, 300) });
    throw stop(EXIT.ERROR, `nothing was written to ${dp.PRACTICE_TITLES[table]}, because ${oneLine(why, 200)}; run the command again`);
  }
  if (result.code !== EXIT.OK) {
    const why = describeFailures(result).join('; ') || 'see the ledger';
    logEditorAction(ctx, { ...entry, status: 'failed', error: oneLine(why, 300) });
    const what = result.mismatches > 0 || result.unchecked > 0 ? 'was not confirmed by the read-back' : 'was not made';
    throw stop(result.code === EXIT.INVALID ? EXIT.INVALID : EXIT.ERROR, `the change to ${dp.PRACTICE_TITLES[table]} ${what}: ${why}`);
  }
  logEditorAction(ctx, { ...entry, status: 'done', read_back: 'ok' });
}

// What the editor is to do next, from a fresh pull: the Next line of `where`.
async function nextAfterEditing(ctx) {
  try {
    const { loaded } = await pullTables(ctx, 'all');
    const st = stepFor(ctx, loaded);
    return st.problem ? 'Next: ask the engineer to look at the practice page.' : whereParts(ctx, st).next;
  } catch {
    return 'Next: ask where the practice page stands.';
  }
}

const sameColumns = (schema, wrote, before) => Object.entries(wrote).every(([column, value]) => sameCell(schema, column, value, before[column]));

async function decideCommand(args, io, env) {
  const v = parse(args, { demo: { type: 'string' }, claim: { type: 'string' }, outcome: { type: 'string' }, reasoning: { type: 'string' } });
  if (v.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  return withEditing('decide', v, args, io, env, async (ctx, run) => {
    const { manifest } = ctx;
    const tag = manifest.tag.Name;
    const claimsEntry = tableEntry(ctx.config, 'claims_copy');
    const C = claimsEntry.columns; // verified, review_status, notes
    const editorCols = [C.verified, C.review_status, C.notes];
    const waiting = manifest.open.map((o) => o.claim);
    if (v.claim === undefined || text(v.claim) === '') throw stop(EXIT.INVALID, `decide needs --claim <key>; the claims to decide are: ${waiting.join(', ')}`);
    const claim = manifest.claims.find((c) => c.key === v.claim);
    if (!claim) throw stop(EXIT.INVALID, `decide: "${v.claim}" is not a claim of this practice page (the claims to decide are: ${waiting.join(', ')})`);
    const open = manifest.open.find((o) => o.claim === claim.key);
    if (!open) throw stop(EXIT.INVALID, `decide: "${claim.key}" is one of the earlier decisions, which are not changed (the claims to decide are: ${waiting.join(', ')})`);
    // what the editor types, by column; the tags of the relation are names until the page ids of the Rulebook are known
    let wrote;
    if ([v.outcome, v.reasoning].every((x) => x === undefined)) wrote = { ...open.enter }; // the values the page tells the editor to enter
    else {
      if (v.outcome === undefined) throw stop(EXIT.INVALID, 'decide: --reasoning goes with --outcome (Applies or Does not apply)');
      if (!DECISION_OUTCOMES.includes(v.outcome)) throw stop(EXIT.INVALID, `decide: --outcome must be ${DECISION_OUTCOMES.join(' or ')}`);
      if (v.reasoning !== undefined && text(v.reasoning) === '') throw stop(EXIT.INVALID, 'decide: --reasoning is empty (leave it out to decide with an empty note)');
      // the columns in the order the page gives them; a decision with no --reasoning has an empty note: an empty note is a decision too
      wrote = { [C.verified]: v.outcome === 'Applies' ? [tag] : [], [C.notes]: v.reasoning ?? '', [C.review_status]: 'Reviewed' };
    }
    for (const column of Object.keys(wrote)) if (!editorCols.includes(column)) throw stop(EXIT.INVALID, `decide: "${column}" is not one of the editor's columns (${editorCols.join(', ')})`);
    if (Object.hasOwn(wrote, C.review_status) && wrote[C.review_status] !== 'Reviewed') throw stop(EXIT.INVALID, `decide: ${C.review_status} is Reviewed once the claim is decided`);
    if (Object.hasOwn(wrote, C.verified) && (!Array.isArray(wrote[C.verified]) || wrote[C.verified].some((t) => t !== tag))) throw stop(EXIT.INVALID, `decide: ${C.verified} holds the tag ${tag} or nothing`);

    const loaded = await pullForEditing(ctx, ['claims_copy', 'rulebook']);
    const row = loaded.pulled(['claims_copy']).claims_copy[claim[claimsEntry.key]];
    if (!row) throw stop(EXIT.INVALID, `Claims has no row for "${claim.key}" (${claim[claimsEntry.key]})`);
    const tagPages = Object.fromEntries(Object.entries(loaded.pulled(['rulebook']).rulebook ?? {}).map(([name, r]) => [name, r.page_id]));
    const planned = { ...wrote };
    if (Object.hasOwn(wrote, C.verified)) {
      planned[C.verified] = wrote[C.verified].map((name) => {
        if (!tagPages[name]) throw stop(EXIT.INVALID, `decide: the Rulebook of the practice page has no row for ${name}`);
        return tagPages[name];
      });
    }
    const before = Object.fromEntries(Object.keys(planned).map((column) => [column, row[column] ?? null]));
    const schema = loaded.schema('claims_copy');
    const unchanged = sameColumns(schema, planned, before);
    const key = claim[claimsEntry.key];
    const note = { claim: claim.key, tags: Object.hasOwn(wrote, C.verified) ? wrote[C.verified] : undefined };
    if (unchanged) logEditorAction(ctx, { action: 'decide', status: 'unchanged', table: 'claims_copy', key, page_id: row.page_id, wrote: planned, before, ...note });
    else await updateAsEditor(ctx, { action: 'decide', table: 'claims_copy', key, pageId: row.page_id, wrote: planned, before, loaded, note });

    const tagsNow = Object.hasOwn(wrote, C.verified) ? wrote[C.verified] : null;
    const rows = Object.keys(planned).map((column) => {
      if (column === C.verified) return [column, tagsNow.length ? listNames(tagsNow) : 'none', ''];
      return [column, column === C.notes ? (text(planned[column]) === '' ? '(empty)' : quoted(planned[column], 100)) : planned[column], ''];
    });
    const reads = `Reviewed${tagsNow ? ` with ${tagsNow.length ? listNames(tagsNow) : 'no tag'} verified` : ''}`;
    emit(io, {
      sentence: unchanged ? `Walkthrough: acting as the editor, the claim ${quoted(claim['Geo Name'])} already reads ${reads}; nothing was changed.` : `Walkthrough: acting as the editor, the claim ${quoted(claim['Geo Name'])} now reads ${reads}.`,
      header: ['Column', 'Now', ''],
      rows,
      next: await nextAfterEditing(ctx),
    }, run.dir);
    return EXIT.OK;
  });
}

// The rule change an editor action is for: the one named (its Status has to be one of `allowed`), else the only one in the first group of `tiers`
// that holds one (a group with two is ambiguous and refused).
function chooseLesson(lessons, title, { allowed, tiers }, command) {
  if (title !== undefined && text(title) !== '') {
    const t = text(title);
    const found = lessons.find((l) => l.Lesson === t) ?? lessons.find((l) => text(l.Lesson).toLowerCase() === t.toLowerCase());
    if (!found) throw stop(EXIT.INVALID, `${command}: no rule change is called "${t}"`);
    if (!allowed.includes(found.Status)) throw stop(EXIT.INVALID, `${command}: "${found.Lesson}" is ${found.Status}; only a rule change that is ${allowed.join(' or ')} can be changed here`);
    return found;
  }
  for (const tier of tiers) {
    const open = lessons.filter((l) => tier.includes(l.Status));
    if (open.length > 1) throw stop(EXIT.INVALID, `${command}: ${open.length} rule changes are ${tier.join(' or ')}: ${open.map((l) => `"${l.Lesson}"`).join('; ')}. Add --lesson "<title>" to say which one.`);
    if (open.length === 1) return open[0];
  }
  throw stop(EXIT.INVALID, `${command}: no rule change is ${tiers.flat().join(' or ')}`);
}

async function decideLesson(args, io, env, { command, status, tiers, withWording }) {
  const options = { demo: { type: 'string' }, lesson: { type: 'string' }, ...(withWording ? { wording: { type: 'string' }, 'clear-wording': { type: 'boolean' } } : {}) };
  const v = parse(args, options);
  if (v.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  return withEditing(command, v, args, io, env, async (ctx, run) => {
    if (v.wording !== undefined && text(v.wording) === '') throw stop(EXIT.INVALID, `${command}: --wording is empty (use --clear-wording to empty Editor wording so that the draft is tested)`);
    const clearing = withWording && v['clear-wording'] === true;
    if (clearing && v.wording !== undefined) throw stop(EXIT.INVALID, `${command}: --wording and --clear-wording cannot be combined`);
    const loaded = await pullForEditing(ctx, 'rule_changes');
    const lessons = loaded.lessons() ?? [];
    // approve with wording and no Proposed rule change left means the Approved one whose safety check did not pass
    const chosen = chooseLesson(lessons, v.lesson, { allowed: tiers.flat(), tiers: withWording && (v.wording !== undefined || clearing) ? tiers : tiers.slice(0, 1) }, command);
    const row = loaded.pulled(['rule_changes']).rule_changes[chosen.Lesson];
    if (!row) throw stop(EXIT.INVALID, `Rule changes has no row called "${chosen.Lesson}"`);
    const wrote = {};
    if (row.Status !== status) wrote.Status = status;
    if (v.wording !== undefined) wrote['Editor wording'] = v.wording;
    if (clearing) wrote['Editor wording'] = '';
    const before = Object.fromEntries(Object.keys(wrote).map((column) => [column, row[column] ?? null]));
    const unchanged = Object.keys(wrote).length === 0 || sameColumns(loaded.schema('rule_changes'), wrote, before);
    if (unchanged) logEditorAction(ctx, { action: command, status: 'unchanged', table: 'rule_changes', key: chosen.Lesson, page_id: row.page_id, wrote, before });
    else await updateAsEditor(ctx, { action: command, table: 'rule_changes', key: chosen.Lesson, pageId: row.page_id, wrote, before, loaded });

    const rows = [['Status', status, '']];
    if (v.wording !== undefined) rows.push(['Editor wording', quoted(v.wording, 100), '']);
    if (clearing) rows.push(['Editor wording', 'cleared: the draft is tested', '']);
    const title = quoted(chosen.Lesson, 60);
    let sentence;
    if (unchanged) sentence = `Walkthrough: acting as the editor, the rule change ${title} is already ${status}${v.wording !== undefined ? ' with that wording' : ''}; nothing was changed.`;
    else if (clearing && Object.hasOwn(wrote, 'Editor wording')) sentence = `Walkthrough: acting as the editor, the rule change ${title} is now ${status}, with its Editor wording cleared so that the draft is tested.`;
    else if (Object.hasOwn(wrote, 'Status') && Object.hasOwn(wrote, 'Editor wording')) sentence = `Walkthrough: acting as the editor, the rule change ${title} is now ${status}, with its Editor wording filled in.`;
    else if (Object.hasOwn(wrote, 'Editor wording')) sentence = `Walkthrough: acting as the editor, the Editor wording of the rule change ${title} is now filled in.`;
    else sentence = `Walkthrough: acting as the editor, the rule change ${title} is now ${status}.`;
    emit(io, {
      sentence,
      header: ['Column', 'Now', ''],
      rows,
      next: await nextAfterEditing(ctx),
    }, run.dir);
    return EXIT.OK;
  });
}

const approveCommand = (args, io, env) => decideLesson(args, io, env, { command: 'approve', status: 'Approved', tiers: [['Proposed'], ['Approved']], withWording: true });
const rejectCommand = (args, io, env) => decideLesson(args, io, env, { command: 'reject', status: 'Rejected', tiers: [['Proposed', 'Approved']], withWording: false });

// ---- main -----------------------------------------------------------------------------------------------------------------------------------------

function classify(e, io) {
  if (e instanceof Exit) {
    if (e.message) io.err(e.message);
    if (e.report) {
      try {
        emit(io, e.report);
      } catch {
        // the message above is what the engineer needs
      }
    }
    return e.exit;
  }
  if (e instanceof dp.ManifestError || e instanceof StructureError || e instanceof InputError || e instanceof PlanError) {
    io.err(e.message);
    return EXIT.INVALID;
  }
  if (e instanceof NotionError && e.code === 'create_uncertain') {
    io.err(e.message);
    return EXIT.ERROR;
  }
  io.err(`walkthrough: ${e?.message ?? String(e)}`);
  return EXIT.ERROR;
}

/** Run one command. `env` carries the hooks of the other scripts: root, config, fetchImpl, token, sleep, now, repoRoot; and random, scriptsDir, childEnv, wrapClients. */
export async function main(argv = process.argv.slice(2), io = defaultIo, env = {}) {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'start': return await startCommand(rest, io, env);
      case 'run': return await runCommand(rest, io, env);
      case 'where': return await whereCommand(rest, io, env);
      case 'verify': return await verifyCommand(rest, io, env);
      case 'list': return await listCommand(rest, io, env);
      case 'decide': return await decideCommand(rest, io, env);
      case 'approve': return await approveCommand(rest, io, env);
      case 'reject': return await rejectCommand(rest, io, env);
      case '--help': case '-h': case 'help':
        io.out(USAGE);
        return EXIT.OK;
      default:
        io.err(USAGE);
        return EXIT.INVALID;
    }
  } catch (e) {
    return classify(e, io);
  }
}

if (isMain(import.meta.url)) process.exitCode = await main();
