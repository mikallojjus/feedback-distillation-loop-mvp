#!/usr/bin/env node
// Apply: send an armed plan to Notion through the REST client, then read back and verify.
//
//   node agents/claim-tagger/scripts/apply.mjs --run <id> [--dry-run] [--retry]
//
// Preconditions: no runs/PAUSED; runs/APPLYING.json armed for this run and its plan_sha equal to the plan file's (a plan edited after
// `plan.mjs check` is refused); Agent settings not paused; a token in .env (without one the connector batch files are written and the
// exit code is 2, "apply by connector").
// Flow: pre-snapshot pull of the touched databases (the plan's source pull is reused when it is under 10 minutes old and the run is
// fresh; a resumed run always pulls again, so a create that did land becomes an update), ops in seq order (create -> createPage with its
// page content in the same request, update -> updatePage), every result in runs/<id>/applied.jsonl { seq, page_id, status, error, ... }, a
// post pull, then verify.mjs. A run can be started again: ops already recorded ok are skipped. --retry re-sends only the ops in
// plan.retry.jsonl (the ones verify or a failed call named), even when the ledger says ok.
// A clean run (exit 0) disarms; any other result leaves the run armed so it can be resumed.
// Exit codes: 0 ok, 1 retryable failures or ops that did not land (plan.retry.jsonl), 2 invalid (refusal, no token, a call Notion rejected,
// duplicate keys), 3 paused, 4 schema drift, 5 trust breaker (an editor field changed; runs/PAUSED written).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { controlPaths, isProtectedDatabase } from './allowlist.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from './lib/jsonl.mjs';
import { clientFromConfig, splitRichText } from './lib/notion-rest.mjs';
import { encodeProperties } from './lib/notion-values.mjs';
import { agentRoot, isMain, repoRoot as defaultRepoRoot } from './lib/paths.mjs';
import {
  PlanError, armedState, disarm, readPlan, resolveOps, writeBatches,
} from './plan.mjs';
import { latestPullId, loadConfig, loadPull, pull } from './pull.mjs';
import { readLedger, verify } from './verify.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/apply.mjs --run <id> [--dry-run] [--retry]';
export const FRESH_MS = 10 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;

// ---- a tiny markdown-to-blocks helper ----------------------------------------------------------------------------

const CODE_LANGUAGES = new Set(['bash', 'shell', 'powershell', 'json', 'javascript', 'typescript', 'python', 'sql', 'html', 'css', 'yaml', 'markdown', 'diff', 'plain text']);

const textBlock = (type, text, extra = {}) => ({ object: 'block', type, [type]: { rich_text: splitRichText(text), ...extra } });

/**
 * Markdown to Notion blocks: "#", "##", "###" headings (deeper levels become heading 3), "-" or "*" bullets, "1." numbered items,
 * fenced code (the fence language is kept when Notion knows it), blank-line separated paragraphs (lines inside one stay together).
 */
export function markdownToBlocks(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push(textBlock('paragraph', paragraph.join('\n')));
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```\s*(\S*)\s*$/.exec(line);
    if (fence) {
      flush();
      const code = [];
      for (i += 1; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) code.push(lines[i]);
      const language = fence[1].toLowerCase();
      blocks.push(textBlock('code', code.join('\n'), { language: CODE_LANGUAGES.has(language) ? language : language === 'js' ? 'javascript' : language === 'sh' ? 'shell' : 'plain text' }));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(textBlock(`heading_${Math.min(heading[1].length, 3)}`, heading[2].trim()));
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push(textBlock('bulleted_list_item', bullet[1]));
      continue;
    }
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      flush();
      blocks.push(textBlock('numbered_list_item', numbered[1]));
      continue;
    }
    if (line.trim() === '') flush();
    else paragraph.push(line);
  }
  flush();
  return blocks;
}

// ---- apply -------------------------------------------------------------------------------------------------------

const fail = (code, ...errors) => ({ code, line: null, errors });
const retryable = (e) => e?.retryable === true;
const isAuthError = (e) => e?.status === 401 || e?.status === 403;

function readPaused(root) {
  try {
    const p = readJson(controlPaths(root).paused);
    return `${p.field ? `${p.field} changed on page ${p.page_id}` : 'no reason recorded'}${p.run_id ? ` during run ${p.run_id}` : ''}`;
  } catch {
    return 'the file is not readable';
  }
}

/**
 * Apply one armed run. client null = no token. Returns { code, line, errors }; `line` is the one summary line (null on a refusal).
 * Options: dryRun (resolve and count, send nothing, write nothing), retry (only the ops in plan.retry.jsonl).
 */
export async function apply({ root = agentRoot(), config = loadConfig(root), client, runId, dryRun = false, retry = false, now = () => new Date() }) {
  const paths = controlPaths(root);
  let plan;
  try {
    plan = readPlan(root, runId);
  } catch (e) {
    if (e instanceof PlanError) return fail(EXIT.INVALID, e.message, ...e.problems);
    throw e;
  }
  const touched = [...new Set(plan.ops.map((o) => o.database))];
  for (const db of touched) {
    const cfg = config.notion.databases[db];
    if (!cfg || isProtectedDatabase(config, cfg.database_id) || isProtectedDatabase(config, cfg.data_source_id)) return fail(EXIT.INVALID, `${db} is not a configured trial database (or is protected); nothing was sent`);
  }
  const needs = [...new Set([...touched, 'agent_settings'])]; // agent_settings: the Paused switch is read on every apply
  const retrySeqs = retry ? retrySet(plan.dir) : null;
  if (retry && !retrySeqs) return fail(EXIT.INVALID, `--retry needs ${join(plan.dir, 'plan.retry.jsonl')}, which apply or verify writes when ops did not land`);

  // ---- dry run: judge the plan against the pull it was checked with, send nothing
  if (dryRun) {
    const checkFile = join(plan.dir, 'check.json');
    const id = (existsSync(checkFile) ? readJson(checkFile).pull_id : null) ?? latestPullId(root) ?? plan.header.source_pull;
    let dry;
    try {
      dry = loadPull(root, id, { config });
    } catch (e) {
      return fail(EXIT.INVALID, e.message);
    }
    const missingDbs = touched.filter((db) => !dry.covers(db));
    if (missingDbs.length) return fail(EXIT.INVALID, `pull ${dry.id} does not cover ${missingDbs.join(', ')}`);
    const { ops, skipped, violations } = resolveOps(plan, dry, { config });
    if (violations.length) return fail(EXIT.INVALID, ...violations.map((v) => `op ${v.seq} (${v.database} "${v.key}"): ${v.message}`));
    const creates = ops.filter((o) => o.kind === 'create').length;
    const state = armedState(root);
    const notes = skipped.map((s) => `skipped op ${s.seq} (${s.database} "${s.key}"): ${s.reason}`);
    if (existsSync(paths.paused)) notes.push('note: runs/PAUSED exists, so a real run would refuse');
    if (!state || state.run_id !== runId || state.plan_sha !== plan.sha) notes.push(`note: run ${runId} is not armed for this plan yet; a real run needs plan.mjs check --run ${runId} first`);
    return { code: EXIT.OK, line: `apply: dry run for ${runId} (pull ${dry.id}): would create ${creates}, update ${ops.length - creates}, skip ${skipped.length}; nothing was sent`, errors: notes };
  }

  if (existsSync(paths.paused)) return fail(EXIT.PAUSED, `runs/PAUSED exists (${readPaused(root)}); a person has to delete it before anything is written`);
  const armed = armedState(root);
  if (!armed || armed.unreadable || armed.run_id !== runId) {
    return fail(EXIT.INVALID, `run ${runId} is not armed (${armed ? `APPLYING.json is for ${armed.run_id ?? 'an unreadable state'}` : 'nothing is armed'}): run plan.mjs check --run ${runId} first`);
  }
  if (armed.plan_sha !== plan.sha) return fail(EXIT.INVALID, `the plan for run ${runId} changed after it was armed (armed ${String(armed.plan_sha).slice(0, 12)}, file ${plan.sha.slice(0, 12)}); a plan is never edited by hand: build it again and run plan.mjs check`);

  // ---- no token: hand over the batch files
  if (!client) {
    const checkFile = join(plan.dir, 'check.json');
    const id = (existsSync(checkFile) ? readJson(checkFile).pull_id : null) ?? latestPullId(root) ?? plan.header.source_pull;
    try {
      const fallback = loadPull(root, id, { config });
      const { ops } = resolveOps(plan, fallback, { config });
      const files = writeBatches({ dir: plan.dir, ops, config, pull: fallback });
      return fail(EXIT.INVALID, `there is no NOTION_TOKEN in .env, so this cannot be applied by script: apply by connector. ${files.length} batch file(s) are in ${join(plan.dir, 'batches')} (SKILL.md, "No token (connector fallback)"); afterwards pull and run verify.mjs --run ${runId}`);
    } catch (e) {
      return fail(EXIT.INVALID, `there is no NOTION_TOKEN in .env, and the batch files could not be written: ${e.message}`);
    }
  }

  // ---- the pull that ops are resolved against (and, the first time, the editor-field baseline)
  const applyFile = join(plan.dir, 'apply.json');
  let state = existsSync(applyFile) ? readJson(applyFile) : null;
  if (state && state.plan_sha !== plan.sha) state = null;
  const invocation = (state?.invocations ?? 0) + 1;
  let source = null;
  try {
    source = plan.header.source_pull ? loadPull(root, plan.header.source_pull, { config }) : null;
  } catch {
    source = null;
  }
  const reusable = !state && source && needs.every((db) => source.covers(db)) && now().getTime() - Date.parse(source.info.taken_at) < FRESH_MS;
  let current;
  let preId = state?.pre_pull ?? null;
  if (reusable) {
    if (source.info.paused) return fail(EXIT.PAUSED, 'the agent is paused in Agent settings (Paused is ticked); a person has to untick it');
    current = source;
    preId = source.id;
  } else {
    const pullId = invocation === 1 ? `${runId}-pre` : `${runId}-r${invocation}`;
    const fetched = await pull({ root, config, client, dbs: needs, pullId, now });
    if (fetched.code === EXIT.PAUSED) return fail(EXIT.PAUSED, 'the agent is paused in Agent settings (Paused is ticked); a person has to untick it');
    if (fetched.code !== EXIT.OK) return fail(fetched.code, fetched.line, ...fetched.warnings);
    current = loadPull(root, pullId, { config });
    preId ??= pullId;
  }
  writeJsonAtomic(applyFile, {
    run_id: runId, plan_sha: plan.sha, pre_pull: preId, post_pull: state?.post_pull ?? null, resolved_from: current.id, invocations: invocation, started_at: state?.started_at ?? now().toISOString(),
  });

  const { ops, skipped, violations } = resolveOps(plan, current, { config });
  if (violations.length) return fail(EXIT.INVALID, ...violations.map((v) => `op ${v.seq} (${v.database} "${v.key}"): ${v.message}`));

  // ---- send
  const ledgerFile = join(plan.dir, 'applied.jsonl');
  const ledger = readLedger(plan.dir);
  const stamp = () => now().toISOString();
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0, already: 0 };
  const warnings = [];
  for (const s of skipped) {
    if (retrySeqs && !retrySeqs.has(s.seq)) continue;
    const previous = ledger.get(s.seq);
    if (previous?.status === 'ok' && !retrySeqs) {
      counts.already += 1; // it landed on an earlier start; the pull now shows it as up to date
      continue;
    }
    counts.skipped += 1;
    warnings.push(`skipped op ${s.seq} (${s.database} "${s.key}"): ${s.reason}`);
    if (!(previous?.status === 'skipped' && previous.reason === s.reason)) appendJsonl(ledgerFile, { seq: s.seq, database: s.database, key: s.key, kind: null, page_id: null, status: 'skipped', error: null, reason: s.reason, at: stamp() });
  }
  let consecutive = 0;
  let fatal = null;
  let hardFailures = 0;
  for (const op of ops) {
    if (retrySeqs ? !retrySeqs.has(op.seq) : ledger.get(op.seq)?.status === 'ok') {
      counts.already += 1;
      continue;
    }
    const base = { seq: op.seq, database: op.database, key: op.key, kind: op.kind };
    try {
      const schema = current.schema(op.database);
      const properties = encodeProperties(op.properties, schema);
      let pageId = op.page_id;
      if (op.kind === 'create') {
        const children = op.content_md ? markdownToBlocks(op.content_md) : [];
        const page = await client.createPage({ parentDatabaseId: config.notion.databases[op.database].database_id, properties, children });
        pageId = page.id;
        counts.created += 1;
      } else {
        await client.updatePage(op.page_id, { properties });
        counts.updated += 1;
      }
      appendJsonl(ledgerFile, { ...base, page_id: pageId, status: 'ok', error: null, at: stamp() });
      consecutive = 0;
    } catch (e) {
      counts.failed += 1;
      consecutive += 1;
      if (!retryable(e)) hardFailures += 1;
      appendJsonl(ledgerFile, { ...base, page_id: op.page_id ?? null, status: 'failed', error: String(e?.message ?? e), retryable: retryable(e), at: stamp() });
      warnings.push(`op ${op.seq} (${op.database} "${op.key}") failed: ${e?.message ?? e}`);
      if (isAuthError(e)) {
        fatal = e;
        break;
      }
      if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
        warnings.push(`stopped after ${MAX_CONSECUTIVE_FAILURES} failures in a row; run apply.mjs --run ${runId} again to continue`);
        break;
      }
    }
  }
  if (fatal) return { code: EXIT.INVALID, line: null, errors: [...warnings, 'Notion refused the token; check .env and that the integration is connected to the page "Editorial feedback loop"'] };

  // ---- read back and verify
  const postId = `${runId}-post`;
  const after = await pull({ root, config, client, dbs: needs, pullId: postId, now });
  if (after.code === EXIT.DRIFT) return fail(EXIT.DRIFT, after.line, ...after.warnings);
  writeJsonAtomic(applyFile, { ...readJson(applyFile), post_pull: postId, finished_at: stamp() });
  const checked = verify({ root, config, runId, prePullId: preId, postPullId: postId, now });
  if (checked.line === null) return { code: checked.code, line: null, errors: [...warnings, ...checked.problems] };
  let code = checked.code;
  if (code === EXIT.ERROR && hardFailures > 0) code = EXIT.INVALID; // a call Notion rejected will not succeed on its own
  if (code === EXIT.OK) disarm(root);
  const verdict = code === EXIT.OK ? `verify clean (pre ${preId}, post ${postId})` : checked.line;
  const line = `apply: run ${runId}: created ${counts.created}, updated ${counts.updated}, skipped ${counts.skipped}, failed ${counts.failed}${counts.already ? `, already done ${counts.already}` : ''}; ${verdict}`;
  return { code, line, errors: warnings };
}

function retrySet(dir) {
  const file = join(dir, 'plan.retry.jsonl');
  if (!existsSync(file)) return null;
  return new Set(readJsonl(file).rows.filter((r) => r.op !== 'header').map((r) => r.seq));
}

// ---- command line ------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Run the script; returns the exit code. env (tests): { root, repoRoot, client (null = no token), fetchImpl, now }. */
export async function main(argv, io = defaultIo, env = {}) {
  let args;
  try {
    args = parseArgs({ args: argv, options: { run: { type: 'string' }, 'dry-run': { type: 'boolean' }, retry: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } }, strict: true, allowPositionals: false }).values;
  } catch (e) {
    io.err(`apply: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  if (!args.run) {
    io.err(`apply: --run <id> is required\n${USAGE}`);
    return EXIT.INVALID;
  }
  try {
    const root = env.root ?? agentRoot();
    const config = env.config ?? loadConfig(root);
    const client = env.client !== undefined ? env.client : clientFromConfig(config, { fetchImpl: env.fetchImpl, repoRoot: env.repoRoot ?? defaultRepoRoot() });
    const result = await apply({ root, config, client, runId: args.run, dryRun: args['dry-run'] === true, retry: args.retry === true, now: env.now });
    for (const e of result.errors ?? []) io.err(`apply: ${e}`);
    if (result.line) io.out(result.line);
    return result.code;
  } catch (e) {
    io.err(`apply: ${e.message}`);
    if (e.code === 'BROKEN_CURSOR') return EXIT.INVALID;
    if (e.name === 'NotionError' && [401, 403, 404].includes(e.status)) return EXIT.INVALID;
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
