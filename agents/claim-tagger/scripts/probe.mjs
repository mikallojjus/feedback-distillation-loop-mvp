#!/usr/bin/env node
// Token access probe (EN-12 evidence): does the integration token reach the trial databases and nothing else?
//
//   node agents/claim-tagger/scripts/probe.mjs [--record <path>]
//
// With the NOTION_TOKEN from .env (lib/notion-rest.mjs loadToken) it sends GET https://api.notion.com/v1/databases/<id>, with the
// Notion-Version header config.notion.api_version names, one request at a time and at most 3 per second, for
//   - every id in config.notion.protected_database_ids: expected 404 (object_not_found) or 403 (restricted_resource), because the real
//     content databases must be invisible to the token;
//   - the database_id of every database in config.notion.databases: expected 200 with the database's title (EXPECTED_TITLES).
// One line per id (id, kind protected | configured, HTTP status, ok | NOT OK, detail), then a summary line. `--record <path>` also writes
// { at, results, ok } as JSON; the token is in no output and no file, and the body of a protected database's answer is never recorded.
//
// What a 404 proves: this token cannot see that id. It cannot tell "not shared with the integration" from "not a database id at all", so the
// protected list must hold real database ids (not data-source ids) for the probe to mean anything.
//
// Reads only, and sends its requests itself (fetch) on purpose: the REST client of lib/notion-rest.mjs turns a 404 into an exception and
// retries 5xx answers, and this probe has to see the raw status of every id. Nothing is ever written to Notion.
//
// Exit codes: 0 every expectation holds, 1 a request got no usable answer (network failure, timeout, 429, 5xx) and nothing worse was found,
// 2 no token in .env, bad arguments or a config that names no database to probe, 4 a protected id is reachable or a configured one does
// not answer as expected (a refused token shows up here too: every id answers 401).

import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { EXIT } from './lib/exit-codes.mjs';
import { readJson, writeJsonAtomic } from './lib/jsonl.mjs';
import { API_BASE, DEFAULT_API_VERSION, loadToken } from './lib/notion-rest.mjs';
import { normId } from './lib/notion-values.mjs';
import { agentRoot, isMain, repoRoot as defaultRepoRoot } from './lib/paths.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/probe.mjs [--record <path>]';

export const MAX_REQUESTS_PER_SECOND = 3;
export const TIMEOUT_MS = 15000;

/** The title each configured database must answer with: the names of the six trial databases. A key that is not listed here is expected under its own name, capitalised, underscores as spaces. */
export const EXPECTED_TITLES = Object.freeze({
  rulebook: 'Rulebook', claims: 'Claims', tag_decisions: 'Tag decisions', rule_changes: 'Rule changes', runs: 'Runs', agent_settings: 'Agent settings',
});

/** The answers that prove a protected id is invisible to the token: HTTP status -> Notion's error code. */
export const PROTECTED_ANSWERS = Object.freeze({ 404: 'object_not_found', 403: 'restricted_resource' });

const expectedTitle = (db) => EXPECTED_TITLES[db] ?? (db.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
const defaultSleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

class UsageError extends Error {}

/** What to ask: every protected id once, then every configured database. Throws a UsageError for a config that cannot be probed. */
export function targetsOf(config) {
  const notion = config?.notion;
  const targets = [];
  const seen = new Set();
  for (const id of notion?.protected_database_ids ?? []) {
    if (typeof id !== 'string' || id.trim() === '') throw new UsageError('config.json: protected_database_ids holds an entry that is not an id');
    if (seen.has(normId(id))) continue;
    seen.add(normId(id));
    targets.push({ id: id.trim(), kind: 'protected' });
  }
  for (const [db, cfg] of Object.entries(notion?.databases ?? {})) {
    if (typeof cfg?.database_id !== 'string' || cfg.database_id.trim() === '') throw new UsageError(`config.json: databases.${db} has no database_id`);
    targets.push({ id: cfg.database_id.trim(), kind: 'configured', db });
  }
  if (!targets.length) throw new UsageError('config.json names no database to probe');
  return targets;
}

const titleOf = (body) => (Array.isArray(body?.title) ? body.title.map((t) => t?.plain_text ?? t?.text?.content ?? '').join('') : null);
const errorCode = (body) => (typeof body?.code === 'string' ? body.code : null);

/**
 * Judge one answer. Returns { ok, failure, reason, code, title }: failure is null when ok, 'reachable' (a protected id answered with a
 * success), 'unexpected' (any other answer that breaks the expectation) or 'error' (no usable answer: 429, 5xx; says nothing about access).
 */
export function judge(target, status, body) {
  const code = errorCode(body);
  const base = { ok: false, failure: 'unexpected', reason: '', code, title: null };
  if (status === 429 || status >= 500) return { ...base, failure: 'error', reason: `Notion answered ${status}${code ? ` ${code}` : ''}, so this id was not checked; run the probe again later` };
  if (target.kind === 'protected') {
    if (status >= 200 && status < 300) return { ...base, failure: 'reachable', reason: 'REACHABLE: this token can read a database that must be invisible to it' };
    const wanted = PROTECTED_ANSWERS[status];
    if (!wanted) return { ...base, reason: `answered ${status}${code ? ` ${code}` : ''}, expected 404 object_not_found or 403 restricted_resource` };
    if (code !== null && code !== wanted) return { ...base, reason: `answered ${status} ${code}, expected ${status} ${wanted}` };
    return { ...base, ok: true, failure: null };
  }
  // a configured database
  if (status === 401) return { ...base, reason: 'answered 401: the token was refused; check NOTION_TOKEN in .env' };
  if (status !== 200) return { ...base, reason: `answered ${status}${code ? ` ${code}` : ''}, expected 200; is the page "Editorial feedback loop" shared with the integration?` };
  const title = titleOf(body);
  const want = expectedTitle(target.db);
  if (body?.object !== 'database') return { ...base, title, reason: `answered 200 but the object is ${JSON.stringify(body?.object ?? null)}, not a database` };
  if (normId(body?.id) !== normId(target.id)) return { ...base, title, reason: `answered 200 for database ${body?.id ?? '(no id)'}, not ${target.id}` };
  if (title !== want) return { ...base, title, reason: `answered 200 with the title ${JSON.stringify(title)}, expected ${JSON.stringify(want)}` };
  return { ...base, ok: true, failure: null, title };
}

/**
 * Ask Notion about every target. fetchImpl, now (a Date) and sleep are injectable for tests. Returns { results, ok, code }:
 * code is the exit code the answers deserve (0, 1 or 4; the other codes belong to main).
 */
export async function probe({
  config, token, fetchImpl = globalThis.fetch, now = () => new Date(), sleep = defaultSleep, timeoutMs = TIMEOUT_MS,
}) {
  if (typeof token !== 'string' || token.trim() === '') throw new TypeError('probe: a token is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('probe: fetchImpl must be a function');
  const apiVersion = config?.notion?.api_version ?? DEFAULT_API_VERSION;
  const configured = Number(config?.notion?.requests_per_second);
  const rate = configured > 0 ? Math.min(MAX_REQUESTS_PER_SECOND, configured) : MAX_REQUESTS_PER_SECOND;
  const gapMs = Math.ceil(1000 / rate); // request starts at least this far apart: never more than `rate` of them in any second
  const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': apiVersion };
  const scrub = (text) => String(text ?? '').split(token).join('[token]');

  async function ask(target) {
    const url = `${API_BASE}/databases/${encodeURIComponent(target.id)}`;
    const shape = { id: target.id, kind: target.kind, ...(target.db ? { db: target.db } : {}) };
    let res;
    try {
      res = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      const why = cause?.name === 'TimeoutError' || cause?.name === 'AbortError' ? `timed out after ${timeoutMs} ms` : cause?.cause?.code ?? cause?.code ?? cause?.message ?? 'unknown';
      return { ...shape, status: null, code: null, ok: false, failure: 'error', reason: `no answer (${scrub(why)})` };
    }
    const text = await res.text().catch(() => '');
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const verdict = judge(target, res.status, body);
    const out = { ...shape, status: res.status, code: verdict.code, ok: verdict.ok };
    // The title of a database that must be invisible is never recorded, even when it leaked.
    if (target.kind === 'configured') {
      out.title = verdict.title;
      out.expected_title = expectedTitle(target.db);
    }
    if (!verdict.ok) {
      out.failure = verdict.failure;
      out.reason = scrub(verdict.reason);
    }
    return out;
  }

  const results = [];
  let lastStart = null;
  for (const target of targetsOf(config)) {
    if (lastStart !== null) {
      // a timer can fire a millisecond early, so the clock is looked at again after each sleep (at most 3 times: a frozen test clock cannot hang this)
      let wait = lastStart + gapMs - now().getTime();
      for (let i = 0; wait > 0 && i < 3; i++) {
        await sleep(wait);
        wait = lastStart + gapMs - now().getTime();
      }
    }
    lastStart = now().getTime();
    results.push(await ask(target));
  }
  const failures = results.filter((r) => !r.ok);
  const findings = failures.filter((r) => r.failure !== 'error');
  return { results, ok: failures.length === 0, code: findings.length ? EXIT.DRIFT : failures.length ? EXIT.ERROR : EXIT.OK };
}

/** One printed line per result: id, kind, status, ok | NOT OK, detail. */
export function formatLine(r, idWidth = 0) {
  const status = r.status === null ? 'error' : String(r.status);
  const detail = r.ok ? (r.kind === 'configured' ? `${r.db} ${JSON.stringify(r.title)}` : r.code ?? '') : r.reason;
  return `${r.id.padEnd(idWidth)}  ${r.kind.padEnd(10)}  ${status.padEnd(5)}  ${(r.ok ? 'ok' : 'NOT OK').padEnd(6)}  ${detail}`.trimEnd();
}

/** The summary line under the per-id lines. */
export function summaryLine(results, apiVersion) {
  const count = (kind, okOnly = false) => results.filter((r) => r.kind === kind && (!okOnly || r.ok)).length;
  const bad = results.filter((r) => !r.ok).length;
  return `probe: ${results.length} id(s) with Notion-Version ${apiVersion}: ${count('protected', true)} of ${count('protected')} protected not reachable, ${count('configured', true)} of ${count('configured')} configured answering with the right title; ${bad ? `${bad} NOT OK` : 'all ok'}`;
}

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/**
 * Run the script; returns the exit code. env (tests): { root, repoRoot, config, token (null = none), fetchImpl, now, sleep, timeoutMs }.
 * Without env.token the token comes from <repoRoot>/.env.
 */
export async function main(argv, io = defaultIo, env = {}) {
  let args;
  try {
    args = parseArgs({ args: argv, options: { record: { type: 'string' }, help: { type: 'boolean', short: 'h' } }, strict: true, allowPositionals: false }).values;
  } catch (e) {
    io.err(`probe: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  if (args.record !== undefined && args.record.trim() === '') {
    io.err(`probe: --record needs a file path\n${USAGE}`);
    return EXIT.INVALID;
  }
  let token = null;
  try {
    const root = env.root ?? agentRoot();
    const config = env.config ?? readJson(join(root, 'config.json'));
    targetsOf(config); // a config that cannot be probed is refused before the token is even looked for
    token = env.token !== undefined ? env.token : loadToken(env.repoRoot ?? defaultRepoRoot());
    if (!token) {
      io.err('probe: there is no NOTION_TOKEN in .env, so the probe cannot run');
      return EXIT.INVALID;
    }
    const apiVersion = config.notion.api_version ?? DEFAULT_API_VERSION;
    if ((config.notion.protected_database_ids ?? []).length === 0) io.err('probe: warning: config.json lists no protected database ids, so nothing here shows that the token cannot reach the real databases');
    const now = env.now ?? (() => new Date());
    const { results, ok, code } = await probe({ config, token, fetchImpl: env.fetchImpl, now, sleep: env.sleep, timeoutMs: env.timeoutMs });
    const width = Math.max(...results.map((r) => r.id.length));
    for (const r of results) io.out(formatLine(r, width));
    io.out(summaryLine(results, apiVersion));
    if (results.some((r) => r.failure === 'reachable')) io.err('probe: a protected database is reachable with this token: take it out of the integration\'s access (page connections) before anything else runs');
    else if (code === EXIT.DRIFT) io.err('probe: the token does not reach what it should; read the NOT OK lines above');
    else if (code === EXIT.ERROR) io.err('probe: some ids got no usable answer, so the result is incomplete; run the probe again');
    let exit = code;
    if (args.record !== undefined) {
      try {
        writeJsonAtomic(resolve(args.record), { at: now().toISOString(), results, ok });
      } catch (e) {
        io.err(`probe: could not write ${args.record}: ${String(e.message).split(token).join('[token]')}`);
        if (exit === EXIT.OK) exit = EXIT.ERROR;
      }
    }
    return exit;
  } catch (e) {
    const message = String(e?.message ?? e);
    if (e instanceof UsageError) {
      io.err(`probe: ${message}\n${USAGE}`);
      return EXIT.INVALID;
    }
    io.err(`probe: ${token ? message.split(token).join('[token]') : message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
