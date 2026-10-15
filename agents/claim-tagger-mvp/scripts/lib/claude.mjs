// Run `claude -p` as a judge or distiller: build the argument list, spawn it without a shell, feed the prompt on stdin,
// parse the JSON envelope, classify what went wrong, and check that the pinned model really answered.
//
// A copy of agents/claim-tagger/scripts/lib/claude.mjs with two changes: the usage window is told apart from transient errors, and
// the argument builder refuses the two flags hard rule 9 forbids. Everything else is the old code, export for export.
//
//   findClaudeBin(configured)                      where claude.exe / claude.cmd lives (Windows: `where`)
//   runClaude({ bin, model, systemPromptFile, prompt, effort, ... })   -> { ok, text, errorKind, costUsd, modelUsage, ... }
//   withTransientRetry(fn, { attempts, backoffMs, sleep })   calls fn() again, with a pause, while the result is errorKind "transient"
//   extractJson(text)                              the outermost [...] or {...} in a reply, fences stripped; throws if none parses
//   claudeVersion(bin)                             `claude --version`, cached per process
//   USAGE_WINDOW_RE, TRANSIENT_RE                  the two wordings that classify a failed call (see below)
//
// Why things are the way they are:
//  - No shell, ever. Content goes on stdin and every argument is a separate array element, so a claim cannot reach a command line.
//    Node refuses to start a .cmd or .bat file without a shell (EINVAL since the BatBadBut fix), so findClaudeBin prefers a
//    real .exe, and a .cmd shim is only followed to the program behind it (resolveSpawnTarget), never run through cmd.exe.
//  - CLAUDECODE and CLAUDE_CODE_ENTRYPOINT are removed from the child's environment: left in, the CLI believes it is nested
//    inside another session. Nothing else in the environment is touched (in particular no API key is added or dropped).
//  - Two flags are never passed (hard rule 9): --bare and --fallback-model. buildArgs throws a TypeError naming the flag, before
//    anything is spawned, whether it came from extraArgs or from any other option, in the plain form or as --flag=value.
//    A fallback model would let another model answer in silence and make every judgment irreproducible.
//  - A usage window (the subscription's 5-hour or weekly allowance) is not an error of the item: errorKind "usage_window" lets the
//    caller stop and resume after the reset. Only the CLI's wording for that counts (USAGE_WINDOW_RE: "usage limit", "limit reached",
//    "resets at 3pm", ...). A passing 429, "rate limit", "overloaded" or "busy" is errorKind "transient": the API clears in seconds, so
//    withTransientRetry waits and asks again, and it never retries the window, which no wait of seconds can clear. The window is
//    checked first, so a reply with both kinds of words (a 429 that says the usage limit was reached) is the window. As before, any
//    other failed call (a non-zero exit, is_error, an error subtype) is also "transient"; TRANSIENT_RE names the wording that is
//    certainly transient, and it is what tells a notice that arrives as plain text or as a short non-JSON result (older CLI
//    versions) from a schema problem.
//  - The pinned model must appear in the envelope's modelUsage; a silent fallback to another model would make every
//    judgment irreproducible, so a missing or different model is errorKind "model_mismatch".
//  - Tests: `spawnImpl` replaces child_process.spawn; `driver: "fake"` runs tests/fixtures/fake-claude.mjs in-process.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './paths.mjs';

/**
 * The CLI's own wording when the subscription window is used up: "Claude AI usage limit reached|1760000000", "5-hour limit reached
 * - resets 3pm", "Your limit will reset at 3am", "You've hit your limit", "You're out of extra usage". Narrow on purpose: a 429, a
 * "rate limit" or an "overloaded" API are TRANSIENT_RE, because those clear in seconds and the window does not. No flags that keep
 * state (g, y), so .test() can be called again and again.
 */
export const USAGE_WINDOW_RE = /usage[ _]limit|limit[ _]reached|limit will reset|resets? (?:at|in|on|tomorrow|today|\d)|out of (?:extra )?usage|you(?:['\u2019]ve| have) hit your (?:[\w-]+ )?limit/i;

/**
 * The wording of a failure that a later try may clear: 429 and 529 (too many requests, overloaded), 503, "rate limit" and
 * "rate_limit_error", "overloaded" and "overloaded_error", "service_unavailable", "busy", "timed out" and "timeout", ECONNRESET,
 * ETIMEDOUT. Checked after USAGE_WINDOW_RE. The status numbers are matched as whole numbers, so a timestamp that happens to contain
 * 429 is not a rate limit.
 */
export const TRANSIENT_RE = /(?<!\d)(?:429|503|529)(?!\d)|rate[ _]limit|overloaded|service[ _]unavailable|\bbusy\b|time(?:d)?[ -]?out|ECONNRESET|ETIMEDOUT/i;

/** Flags that are never passed to the CLI (hard rule 9). */
const REFUSED_FLAGS = Object.freeze(['--bare', '--fallback-model']);
const SCRUBBED_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'];
const OUTPUT_CAP = 20000; // characters of stdout kept in a result (the full text is in `text`)
const KILL_GRACE_MS = 5000;

/** The fake CLI used by the tests and by `judge.mjs --driver fake`. */
export const FAKE_CLAUDE_SCRIPT = join(repoRoot(), 'tests', 'fixtures', 'fake-claude.mjs');

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cap = (s, n = OUTPUT_CAP) => (s.length > n ? `${s.slice(0, n)}... [${s.length - n} more characters]` : s);
const oneLine = (s, n = 400) => cap(String(s ?? '').replace(/\s+/g, ' ').trim(), n);

// ---- finding the program ------------------------------------------------------------------------------------------

function whereSync(name) {
  const r = spawnSync('where', [name], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || typeof r.stdout !== 'string') return [];
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

const RANK = new Map([['.exe', 0], ['.cmd', 1], ['.bat', 2]]);

/**
 * Where to start the CLI from. Elsewhere than Windows the name is returned as given (spawn searches PATH). On Windows `where`
 * lists every match (the extensionless npm script, claude.cmd, claude.exe); .exe comes first because it can be started
 * directly, then .cmd (followed to its target by resolveSpawnTarget), then anything else. A path, or a name that `where`
 * does not know, is returned as given and fails later as errorKind "spawn" with a message.
 */
export function findClaudeBin(configured = 'claude', { platform = process.platform, whereImpl = whereSync } = {}) {
  if (platform !== 'win32') return configured;
  if (isAbsolute(configured) || /[\\/]/.test(configured)) return configured;
  const found = whereImpl(configured);
  if (!found.length) return configured;
  const ranked = found.map((p, i) => ({ p, i, r: RANK.get(extname(p).toLowerCase()) ?? 9 })).sort((a, b) => a.r - b.r || a.i - b.i);
  return ranked[0].p;
}

const SCRIPT_EXT = new Set(['.mjs', '.js', '.cjs']);
const SHIM_TARGET = /"%~?dp0%?\\([^"]+?\.(?:exe|js|mjs|cjs))"/i;

/**
 * What to hand to spawn for a program path: { command, prefixArgs }.
 *  - a .mjs/.js/.cjs script runs under the current Node (how the tests start fake-claude.mjs for real);
 *  - an npm .cmd shim on Windows is followed to the .exe or .js it launches, because the shim itself cannot be spawned without a shell;
 *  - everything else is spawned as it is.
 * Throws an Error with a plain-words message when a .cmd/.bat file cannot be followed.
 */
export function resolveSpawnTarget(bin, { platform = process.platform, readFileImpl = readFileSync, existsImpl = existsSync } = {}) {
  const ext = extname(bin).toLowerCase();
  if (SCRIPT_EXT.has(ext)) return { command: process.execPath, prefixArgs: [resolve(bin)] };
  if (platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
    let text = '';
    try {
      text = String(readFileImpl(bin, 'utf8'));
    } catch (e) {
      throw new Error(`cannot read ${bin} to find the program behind it (${e.code ?? e.message})`, { cause: e });
    }
    const m = SHIM_TARGET.exec(text);
    const target = m ? join(dirname(bin), m[1]) : null;
    if (!target || !existsImpl(target)) {
      throw new Error(`${bin} is a batch file and Node cannot start those without a shell; install the native claude.exe or set judge.claude_bin in config.json to the full path of claude.exe`);
    }
    return resolveSpawnTarget(target, { platform, readFileImpl, existsImpl });
  }
  return { command: bin, prefixArgs: [] };
}

/** A copy of the environment without the variables that make the CLI think it runs inside another Claude Code session. */
export function scrubEnv(env = process.env) {
  const out = { ...env };
  for (const k of SCRUBBED_ENV) delete out[k];
  return out;
}

/**
 * The argument list for one headless call. No tools, one turn, no session file, no MCP servers, no permission prompts, and the
 * system prompt from a file so that its bytes (and the prompt cache) stay identical from call to call. The user prompt is NOT
 * here: it goes on stdin. Throws a TypeError, naming the flag, when the list would carry --bare or --fallback-model (hard rule 9),
 * from extraArgs or from any other option: the whole finished list is checked, so nothing can slip in as a value either.
 */
export function buildArgs({ model, systemPromptFile, effort, maxTurns = 1, extraArgs = [] } = {}) {
  if (!Array.isArray(extraArgs)) throw new TypeError('buildArgs: extraArgs must be an array of separate arguments');
  const args = ['-p'];
  if (model) args.push('--model', model);
  args.push('--output-format', 'json', '--tools', '');
  if (systemPromptFile) args.push('--system-prompt-file', systemPromptFile);
  args.push('--max-turns', String(maxTurns));
  if (effort) args.push('--effort', effort);
  args.push('--permission-mode', 'dontAsk', '--safe-mode', '--strict-mcp-config', '--no-session-persistence');
  const all = [...args, ...extraArgs];
  for (const arg of all) {
    const text = String(arg);
    const flag = REFUSED_FLAGS.find((f) => text === f || text.startsWith(`${f}=`));
    if (flag) throw new TypeError(`claude: the flag ${flag} is never passed to the CLI (hard rule 9)`);
  }
  return all;
}

// ---- JSON out of text -----------------------------------------------------------------------------------------------

export class JsonExtractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JsonExtractError';
  }
}

// The text inside the first code fence that holds JSON, else the text without a stray leading or trailing fence.
function unfence(text) {
  const blocks = [...text.matchAll(/```[A-Za-z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/g)].map((m) => m[1]);
  const withJson = blocks.find((b) => /[[{]/.test(b));
  if (withJson !== undefined) return withJson;
  return text.replace(/^\s*```[A-Za-z0-9_-]*[ \t]*\r?\n?/, '').replace(/```\s*$/, '');
}

// Index of the bracket that closes the one at `start` (strings and escapes respected), or -1.
function closingIndex(text, start) {
  const want = text[start] === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return c === want ? i : -1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/**
 * The JSON value in a model reply: code fences are stripped, then the outermost balanced [...] or {...} that parses is taken
 * (the longest one when the reply has several separate ones, so a stray "[1]" in the prose loses to the real answer).
 * Returns the parsed value; throws JsonExtractError when nothing parses (for example a reply cut off before its closing bracket).
 */
export function extractJson(text) {
  const src = unfence(String(text ?? '').replace(/^﻿/, ''));
  let best = null;
  let firstError = null;
  let cutOffAt = null;
  let tries = 0;
  for (let i = 0; i < src.length && tries < 200; i++) {
    const c = src[i];
    if (c !== '[' && c !== '{') continue;
    const end = closingIndex(src, i);
    if (end < 0) {
      cutOffAt = i; // never closed: a reply cut off mid-value. What follows is a fragment of it, not an answer, so stop here.
      break;
    }
    tries++;
    const slice = src.slice(i, end + 1);
    try {
      const value = JSON.parse(slice);
      if (!best || slice.length > best.length) best = { value, length: slice.length };
    } catch (e) {
      firstError ??= e;
    }
    i = end; // what is inside is part of this bracket pair, not a candidate of its own
  }
  if (best) return best.value;
  if (cutOffAt !== null) throw new JsonExtractError(`the reply is cut off: the bracket at position ${cutOffAt} is never closed`);
  if (firstError) throw new JsonExtractError(`the reply holds brackets but no valid JSON (${firstError.message})`);
  throw new JsonExtractError(src.trim() === '' ? 'the reply is empty' : 'the reply holds no JSON array or object');
}

/** extractJson without the throw: { ok: true, value } or { ok: false, error }. */
export function tryExtractJson(text) {
  try {
    return { ok: true, value: extractJson(text) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---- the envelope ---------------------------------------------------------------------------------------------------

function pickResult(value) {
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) if (isPlain(value[i]) && value[i].type === 'result') return { element: value[i] };
    return { element: null, error: 'the CLI output has no element of type "result"' };
  }
  if (isPlain(value) && (value.type === 'result' || 'result' in value || 'is_error' in value)) return { element: value };
  return { element: null, error: 'the CLI output is JSON but not a result envelope' };
}

/**
 * The result element of the CLI's JSON output: both the array form (the last element with type "result") and the single-object
 * form, and, when the output is several JSON lines, the last line that is a result. { element } or { element: null, error }.
 */
export function parseEnvelope(stdout) {
  const text = String(stdout ?? '').replace(/^﻿/, '').trim();
  if (!text) return { element: null, error: 'the CLI printed nothing' };
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    const lines = [];
    for (const line of text.split(/\r?\n/)) {
      try {
        lines.push(JSON.parse(line.trim()));
      } catch {
        // a warning line among the JSON lines
      }
    }
    if (lines.length) value = lines;
    else {
      const found = tryExtractJson(text);
      if (!found.ok) return { element: null, error: 'the CLI output is not JSON' };
      value = found.value;
    }
  }
  return pickResult(value);
}

// ---- the model check -------------------------------------------------------------------------------------------------

const canonicalModel = (id) => String(id ?? '').trim().toLowerCase().replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');

/** Same model id, ignoring case, a context suffix such as "[1m]" and a trailing -YYYYMMDD date stamp. */
export function sameModel(a, b) {
  return canonicalModel(a) === canonicalModel(b);
}

// ---- the process ------------------------------------------------------------------------------------------------------

function killTree(child) {
  if (process.platform === 'win32' && child.pid) {
    try {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch {
      // fall through to the plain kill
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // already gone
  }
}

function runProcess({ command, args, input, env, timeoutMs, spawnImpl }) {
  return new Promise((done) => {
    let child;
    try {
      child = spawnImpl(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
    } catch (e) {
      done({ spawnError: e, stdout: '', stderr: '', exitCode: null, timedOut: false });
      return;
    }
    const out = [];
    const err = [];
    let settled = false;
    let timedOut = false;
    let timer = null;
    let grace = null;
    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      done({ stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut, exitCode: null, ...extra });
    };
    child.stdout?.on('data', (d) => out.push(Buffer.from(d)));
    child.stderr?.on('data', (d) => err.push(Buffer.from(d)));
    child.on('error', (e) => finish({ spawnError: e }));
    child.on('close', (code, signal) => finish({ exitCode: code, signal }));
    child.stdin?.on('error', () => {}); // EPIPE when the child exits before reading; 'close' reports what happened
    try {
      child.stdin?.end(input, 'utf8');
    } catch {
      // same
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
        grace = setTimeout(() => finish({ exitCode: null }), KILL_GRACE_MS); // a child that ignores the kill must not hang the run
      }, timeoutMs);
    }
  });
}

async function runFakeInProcess({ bin, args, input, env, timeoutMs, fakeState }) {
  const script = typeof bin === 'string' && /fake-claude\.mjs$/i.test(bin) ? resolve(bin) : FAKE_CLAUDE_SCRIPT;
  let mod;
  try {
    mod = await import(pathToFileURL(script).href);
  } catch (e) {
    return { spawnError: e, stdout: '', stderr: '', exitCode: null, timedOut: false };
  }
  let timer = null;
  const clock = new Promise((tick) => {
    if (timeoutMs > 0) timer = setTimeout(() => tick({ timedOut: true, stdout: '', stderr: '', exitCode: null }), timeoutMs);
  });
  try {
    const answer = Promise.resolve(mod.runFake({ args, stdin: input, env, state: fakeState }))
      .then((r) => ({ stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exitCode ?? 0, timedOut: false }));
    return await Promise.race([answer, clock]);
  } catch (e) {
    return { stdout: '', stderr: `fake-claude crashed: ${e.message}`, exitCode: 1, timedOut: false };
  } finally {
    clearTimeout(timer);
  }
}

function interpret(proc, { model, timeoutMs, wallMs }) {
  const stdout = proc.stdout ?? '';
  const stderr = proc.stderr ?? '';
  const base = {
    ok: false, text: '', isError: false, errorKind: null, message: '', costUsd: null, modelUsage: null, numTurns: null,
    durationMs: wallMs, exitCode: proc.exitCode ?? null, stdout: cap(stdout), stderr: cap(stderr, 4000), raw: null,
  };
  if (proc.spawnError) {
    const e = proc.spawnError;
    return { ...base, errorKind: 'spawn', message: `cannot start claude: ${e.code ? `${e.code} ` : ''}${e.message}` };
  }
  if (proc.timedOut) {
    return { ...base, errorKind: 'timeout', message: `claude did not answer within ${timeoutMs} ms and was stopped` };
  }

  const { element, error } = parseEnvelope(stdout);
  const resultText = typeof element?.result === 'string' ? element.result : '';
  const modelUsage = isPlain(element?.modelUsage) ? element.modelUsage : null;
  let costUsd = typeof element?.total_cost_usd === 'number' ? element.total_cost_usd : null;
  if (costUsd === null && modelUsage) {
    const parts = Object.values(modelUsage).map((u) => u?.costUSD).filter((x) => typeof x === 'number');
    if (parts.length) costUsd = parts.reduce((a, b) => a + b, 0);
  }
  const common = {
    ...base,
    text: resultText,
    isError: element?.is_error === true,
    costUsd,
    modelUsage,
    numTurns: typeof element?.num_turns === 'number' ? element.num_turns : null,
    raw: element,
  };

  const subtypeFailed = typeof element?.subtype === 'string' && element.subtype.startsWith('error');
  if (proc.exitCode !== 0 || element?.is_error === true || subtypeFailed) {
    const haystack = [resultText, stderr, element ? '' : stdout].join('\n');
    return {
      ...common,
      errorKind: USAGE_WINDOW_RE.test(haystack) ? 'usage_window' : 'transient', // the window first; the rest, 429 and overloaded included, may clear
      message: oneLine(resultText || stderr || stdout || `claude exited with code ${proc.exitCode}`),
    };
  }
  if (!element) {
    // no envelope at all: a plain-text limit notice (older CLI versions) is still the usage window, a plain-text 429 or overloaded
    // notice is transient, anything else is a schema problem
    const plain = `${stdout}\n${stderr}`;
    if (plain.length < 2000 && USAGE_WINDOW_RE.test(plain)) return { ...common, errorKind: 'usage_window', message: oneLine(plain) };
    if (plain.length < 2000 && TRANSIENT_RE.test(plain)) return { ...common, errorKind: 'transient', message: oneLine(plain) };
    return { ...common, errorKind: 'schema', message: error };
  }
  if (resultText.trim() === '') return { ...common, errorKind: 'schema', message: 'the result element has no text' };
  if (resultText.length < 400 && !/[[{]/.test(resultText)) {
    // some CLI versions print the limit notice, or a 429 or overloaded notice, as an ordinary result; a reply that holds JSON never gets here
    if (USAGE_WINDOW_RE.test(resultText)) return { ...common, errorKind: 'usage_window', message: oneLine(resultText) };
    if (TRANSIENT_RE.test(resultText)) return { ...common, errorKind: 'transient', message: oneLine(resultText) };
  }
  if (model) {
    const seen = Object.keys(modelUsage ?? {});
    if (!seen.some((k) => sameModel(k, model))) {
      return {
        ...common,
        errorKind: 'model_mismatch',
        message: seen.length ? `asked for ${model} but modelUsage lists ${seen.join(', ')}` : `asked for ${model} but the result has no modelUsage, so the model cannot be verified`,
      };
    }
  }
  return { ...common, ok: true };
}

/**
 * One headless call. Never throws for a failed call: every failure is a result with ok false and an errorKind (the one throw is
 * a TypeError for a refused flag, a mistake in the caller, raised by buildArgs before anything is spawned):
 *   "spawn"         the program could not be started
 *   "timeout"       no answer within timeoutMs; the process (tree) was killed
 *   "usage_window"  non-zero exit or is_error with the subscription window's wording (USAGE_WINDOW_RE: "usage limit", "limit reached", "resets at 3pm")
 *   "transient"     any other non-zero exit or is_error, among them 429, "rate limit", "overloaded", "busy", "timed out" (TRANSIENT_RE); withTransientRetry retries it
 *   "schema"        exit 0 but no usable result envelope or an empty answer
 *   "model_mismatch"  the pinned `model` is missing from modelUsage
 * ok is true only when errorKind is null. `text` is the model's answer (the envelope's `result`), `costUsd` total_cost_usd,
 * `durationMs` wall-clock time of the call, `raw` the parsed result element (stdout and stderr are kept, capped).
 *
 * options: bin (default "claude"), driver ("cli" | "fake"), model, systemPromptFile, prompt (stdin), effort, maxTurns (1),
 * timeoutMs (300000), extraArgs, env (default process.env, scrubbed), spawnImpl (tests), fakeState (the fake's call log).
 */
export async function runClaude(options = {}) {
  const {
    bin = 'claude', driver = 'cli', model, systemPromptFile, prompt = '', effort, maxTurns = 1, timeoutMs = 300000,
    extraArgs = [], env = process.env, spawnImpl = spawn, fakeState,
  } = options;
  const args = buildArgs({ model, systemPromptFile, effort, maxTurns, extraArgs });
  const childEnv = scrubEnv(env);
  const started = Date.now();
  let proc;
  if (driver === 'fake') {
    proc = await runFakeInProcess({ bin, args, input: prompt, env: childEnv, timeoutMs, fakeState });
  } else {
    let target;
    try {
      target = resolveSpawnTarget(bin);
    } catch (e) {
      return interpret({ spawnError: e, stdout: '', stderr: '', exitCode: null }, { model, timeoutMs, wallMs: Date.now() - started });
    }
    proc = await runProcess({ command: target.command, args: [...target.prefixArgs, ...args], input: prompt, env: childEnv, timeoutMs, spawnImpl });
  }
  return interpret(proc, { model, timeoutMs, wallMs: Date.now() - started });
}

// ---- version ---------------------------------------------------------------------------------------------------------

const versionCache = new Map();

/** `claude --version` (first line, for example "2.1.296 (Claude Code)"), asked once per program per process; "unknown" when it cannot be read. */
export function claudeVersion(bin = 'claude', { spawnSyncImpl = spawnSync, env = process.env, cache = versionCache } = {}) {
  if (cache.has(bin)) return cache.get(bin);
  let version = 'unknown';
  try {
    const target = resolveSpawnTarget(bin);
    const r = spawnSyncImpl(target.command, [...target.prefixArgs, '--version'], { encoding: 'utf8', env: scrubEnv(env), windowsHide: true, timeout: 30000 });
    const line = String(r.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (r.status === 0 && line) version = line.slice(0, 80);
  } catch {
    // the version stays "unknown"; the first real call reports the actual problem
  }
  cache.set(bin, version);
  return version;
}

/** The part of a limit message that says when the window reopens ("resets 3pm"), or null. For the line the resume command is printed with. */
export function usageResetHint(text) {
  const m = /(?:resets?|reset at|available again)[^.\n|]{0,40}/i.exec(String(text ?? ''));
  return m ? m[0].trim() : null;
}

// ---- retrying a transient failure ---------------------------------------------------------------------------------------------

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call fn() and, while its result is a transient failure (result.errorKind === 'transient'), wait and call it again: at most
 * `attempts` retries, the i-th one after backoffMs[i] milliseconds (5 s, 15 s, 45 s; the last entry is reused when the list is
 * shorter than the retries). Returns the first result that is not transient, or the last result when the retries are used up, so the
 * caller always gets a result to look at and fn runs at most attempts + 1 times. Every other kind comes back at once, above all
 * "usage_window", which no wait of seconds can clear (the caller stops and resumes after the reset), but also "timeout", "spawn",
 * "schema" and "model_mismatch". fn may be sync or async; if it throws, so does this. `sleep(ms)` is there for tests.
 */
export async function withTransientRetry(fn, { attempts = 3, backoffMs = [5000, 15000, 45000], sleep } = {}) {
  if (typeof fn !== 'function') throw new TypeError('withTransientRetry: fn must be a function');
  if (!Number.isInteger(attempts) || attempts < 0) throw new RangeError(`withTransientRetry: attempts must be a whole number of at least 0, got ${attempts}`);
  if (!Array.isArray(backoffMs)) throw new TypeError('withTransientRetry: backoffMs must be an array of milliseconds');
  const pause = sleep ?? defaultSleep;
  let result = await fn();
  for (let retry = 0; retry < attempts && result?.errorKind === 'transient'; retry++) {
    await pause(backoffMs.length ? backoffMs[Math.min(retry, backoffMs.length - 1)] : 0);
    result = await fn();
  }
  return result;
}
