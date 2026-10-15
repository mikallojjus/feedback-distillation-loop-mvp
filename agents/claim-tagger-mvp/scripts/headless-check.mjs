#!/usr/bin/env node
// headless-check.mjs: start the Claude Code CLI headless with the Explanatory output style on, save the transcript and grade it
// (MVP-PROMPT section 8, item 7: the final message of each run has the three parts only, no insight block, no JSON, no time words, no
// dollars, and the transcript shows no write to an editor column). The grading is transcript-check.mjs; this script is the runner.
//
//   node agents/claim-tagger-mvp/scripts/headless-check.mjs --prompt "/claim-tagger status" --out <dir>
//        [--settings .claude/settings.json] [--cwd <repo>] [--timeout-ms 1800000] [--claude-bin <name or path>] [--overwrite]
//   node agents/claim-tagger-mvp/scripts/headless-check.mjs --prompts-file <file> --out <dir> [same options]
//
//   --prompt        one prompt; the files go straight into <dir>
//   --prompts-file  several prompts, run in turn (the demo's tag, distill and promote depend on each other); the files go into
//                   <dir>/<nn>-<slug>/ (nn = 01, 02, ...; slug = the prompt in lower case with dashes). The file is a JSON array of strings, or
//                   one prompt per line (blank lines and lines that start with # are skipped). A usage-window stop ends the batch.
//   --out           the output folder (created); an existing <dir>/transcript.jsonl is never overwritten unless --overwrite is given
//   --settings      the settings file to copy (default <cwd>/.claude/settings.json; a relative path is relative to --cwd)
//   --cwd           where the CLI runs (default: the repository root, found from this file); the project's own settings and skills load from there
//   --timeout-ms    stop the CLI (and its child processes) after this long (default 1800000); the partial transcript is still graded
//   --claude-bin    the program to start (default config.json judge.claude_bin, "claude"); found with findClaudeBin, a .cmd shim followed
//                   to its target with resolveSpawnTarget, never started through a shell
//
// For each prompt it writes, in the output folder:
//   headless-settings.json  a copy of the given settings file plus "outputStyle": "Explanatory" (the style under test); nothing else is added, and
//                           the copy is refused if it holds anything that looks like an access token (it never reads .env)
//   transcript.jsonl        the CLI's stdout (stream-json), written by the CLI itself into the file
//   stderr.txt              the CLI's stderr
//   check.json              the result of checkTranscript plus how the run went (prompt, status, exit code, timestamps, the arguments, no environment)
//   final-message.md        the final assistant text, as the editor would see it
// then prints one line per problem and the final message. The CLI is started as
//   claude -p <prompt> --settings <headless-settings.json> --permission-mode acceptEdits --output-format stream-json --verbose
// with MSYS_NO_PATHCONV=1 and the environment minus CLAUDECODE and CLAUDE_CODE_ENTRYPOINT (scrubEnv), no shell, stdin closed. --bare and
// --fallback-model are never passed (hard rule 9): buildArgs refuses them, in the prompt as well.
//
// Exit codes: 0 every prompt passed the check; 1 a check failed, the CLI could not start or timed out; 2 usage, unreadable settings, or an
// output folder that already holds a transcript; 75 the Claude usage window ran out (run it again after the reset).

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { USAGE_WINDOW_RE, findClaudeBin, resolveSpawnTarget, scrubEnv } from './lib/claude.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { agentRoot, ensureDir, isMain, repoRoot } from './lib/paths.mjs';
import { TOKEN_KINDS, checkTranscript, loadEditorColumns, parseStreamJson, statsLine } from './transcript-check.mjs';

export const USAGE = [
  'usage: node agents/claim-tagger-mvp/scripts/headless-check.mjs --prompt "/claim-tagger status" --out <dir> [--settings .claude/settings.json] [--cwd <repo>] [--timeout-ms 1800000] [--claude-bin <program>] [--overwrite]',
  '       node agents/claim-tagger-mvp/scripts/headless-check.mjs --prompts-file <file> --out <dir> [same options]',
].join('\n');

export const OUTPUT_STYLE = 'Explanatory';
export const DEFAULT_TIMEOUT_MS = 1800000;
const KILL_GRACE_MS = 5000;
const STDERR_CAP = 4000;

/** Flags that are never passed to the CLI (hard rule 9). */
export const REFUSED_FLAGS = Object.freeze(['--bare', '--fallback-model']);
const REFUSED = /(?:^|[\s"'=])(--bare|--fallback-model)(?![\w-])/;

const shown = (s, n = 70) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 3)}...` : one;
};

// ---- settings and arguments (no process is started by any of these) --------------------------------------------------------------

/**
 * The settings the check runs with: a deep copy of `settings` with "outputStyle" set (default "Explanatory"), replacing any style
 * the file had. Nothing else changes, and the input is not modified.
 */
export function mergeSettings(settings, { outputStyle = OUTPUT_STYLE } = {}) {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('mergeSettings: the settings must be a JSON object');
  if (typeof outputStyle !== 'string' || outputStyle.trim() === '') throw new TypeError('mergeSettings: outputStyle must be a non-empty string');
  return { ...structuredClone(settings), outputStyle };
}

/**
 * The argument list for the CLI: -p <prompt> --settings <file> --permission-mode acceptEdits --output-format stream-json --verbose.
 * Throws a TypeError for an empty prompt, a prompt that starts with "-" (it would be read as an option), a prompt that starts with a
 * drive path (Git Bash rewrote a leading "/" before Node saw the command line: start it with MSYS_NO_PATHCONV=1), a missing settings
 * path, and --bare or --fallback-model anywhere in the finished list, prompt included (hard rule 9).
 */
export function buildArgs({ prompt, settingsPath } = {}) {
  if (typeof prompt !== 'string' || prompt.trim() === '') throw new TypeError('buildArgs: the prompt must be a non-empty string');
  if (typeof settingsPath !== 'string' || settingsPath === '') throw new TypeError('buildArgs: settingsPath is required');
  const args = ['-p', prompt, '--settings', settingsPath, '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose'];
  for (const arg of args) {
    const hit = REFUSED.exec(arg);
    if (hit) throw new TypeError(`headless-check: ${hit[1]} is never passed to the CLI (hard rule 9); it was found in "${shown(arg)}"`);
  }
  if (prompt.startsWith('-')) throw new TypeError(`buildArgs: a prompt that starts with "-" would be read as an option: "${shown(prompt)}"`);
  if (/^[A-Za-z]:[\\/]/.test(prompt)) {
    throw new TypeError(`buildArgs: the prompt "${shown(prompt)}" starts with a drive path; Git Bash turns a leading "/" into one before Node sees it. Start this command with MSYS_NO_PATHCONV=1`);
  }
  return args;
}

/** A name for a prompt's folder: lower case, letters and digits joined by single dashes, at most 40 characters ("/claim-tagger status" -> "claim-tagger-status"). */
export function slugify(prompt) {
  const slug = String(prompt ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return slug || 'prompt';
}

/** The folder name for the n-th prompt (1-based): "01-claim-tagger-status". */
export function promptDirName(n, prompt) {
  return `${String(n).padStart(2, '0')}-${slugify(prompt)}`;
}

/** The prompts of a --prompts-file: a JSON array of strings (or { prompt } objects), or one prompt per line (blank lines and # lines skipped). */
export function readPrompts(text) {
  const t = String(text ?? '').replace(/^﻿/, '').trim();
  if (t.startsWith('[')) {
    const list = JSON.parse(t);
    if (!Array.isArray(list)) throw new Error('the prompts file must be a JSON array');
    return list.map((item, i) => {
      const prompt = typeof item === 'string' ? item : item?.prompt;
      if (typeof prompt !== 'string' || prompt.trim() === '') throw new Error(`prompt ${i + 1} of the prompts file is not a non-empty string`);
      return prompt.trim();
    });
  }
  return t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
}

// ---- the process ---------------------------------------------------------------------------------------------------------------

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

// Start the program with its stdout and stderr going straight into two open files; resolve when it ends, fails to start, or is stopped.
function execute({ command, args, cwd, env, outFd, errFd, timeoutMs, killGraceMs, spawnImpl }) {
  return new Promise((done) => {
    let child;
    try {
      child = spawnImpl(command, args, { cwd, env, stdio: ['ignore', outFd, errFd], windowsHide: true, shell: false });
    } catch (e) {
      done({ spawnError: e, exitCode: null, signal: null, timedOut: false });
      return;
    }
    let settled = false;
    let timedOut = false;
    let timer = null;
    let grace = null;
    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      child.unref?.(); // a child that could not be killed must not keep this script alive once its result is known
      done({ exitCode: null, signal: null, timedOut, ...extra });
    };
    child.on('error', (e) => finish({ spawnError: e }));
    child.on('close', (code, signal) => finish({ exitCode: code, signal }));
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
        grace = setTimeout(() => finish({}), killGraceMs); // a child that ignores the kill must not hang the run
      }, timeoutMs);
    }
  });
}

const readText = (path, cap = Infinity) => {
  try {
    const text = readFileSync(path, 'utf8');
    return text.length > cap ? text.slice(0, cap) : text;
  } catch {
    return '';
  }
};

/**
 * Run one prompt and grade it. Returns { status, ok, code, problems, final, dir, check }; status is "pass", "fail", "usage_window",
 * "timeout" or "spawn_error", code the exit code the script should end with for this prompt.
 * options: prompt, outDir, settingsPath, cwd, bin, timeoutMs, killGraceMs (how long to wait for a killed child, default 5000), env (the environment
 * to scrub), spawnImpl (tests), editorColumns, allowedScripts.
 */
export async function runPrompt(options) {
  const {
    prompt, outDir, settingsPath, cwd, bin = 'claude', timeoutMs = DEFAULT_TIMEOUT_MS, killGraceMs = KILL_GRACE_MS, env = process.env, spawnImpl = spawn, editorColumns, allowedScripts,
  } = options;
  ensureDir(outDir);
  const transcriptPath = join(outDir, 'transcript.jsonl');
  const stderrPath = join(outDir, 'stderr.txt');
  const args = buildArgs({ prompt, settingsPath });
  const childEnv = { ...scrubEnv(env), MSYS_NO_PATHCONV: '1' };
  const startedAt = new Date();

  let target = null;
  let proc;
  try {
    target = resolveSpawnTarget(bin);
  } catch (e) {
    proc = { spawnError: e, exitCode: null, signal: null, timedOut: false };
  }
  if (!proc) {
    const outFd = openSync(transcriptPath, 'w');
    const errFd = openSync(stderrPath, 'w');
    try {
      proc = await execute({ command: target.command, args: [...target.prefixArgs, ...args], cwd, env: childEnv, outFd, errFd, timeoutMs, killGraceMs, spawnImpl });
    } finally {
      closeSync(outFd);
      closeSync(errFd);
    }
  }

  const transcript = readText(transcriptPath);
  const stderr = readText(stderrPath, STDERR_CAP);
  const check = checkTranscript(transcript, { editorColumns, allowedScripts, expectStyle: OUTPUT_STYLE });
  const lastResult = parseStreamJson(transcript).events.findLast((e) => e?.type === 'result');

  // The status, and the problems that go with it. A program that never started has no transcript to grade, so its start error is the
  // only problem; a timeout keeps the grading of the partial transcript behind the timeout itself.
  let status;
  let notice = '';
  const problems = [];
  if (proc.spawnError) {
    status = 'spawn_error';
    problems.push(`cannot start the CLI: ${proc.spawnError.code ? `${proc.spawnError.code} ` : ''}${proc.spawnError.message}`);
  } else {
    problems.push(...check.problems);
    if (proc.timedOut) {
      status = 'timeout';
      problems.unshift(`the CLI did not finish within ${timeoutMs} ms and was stopped`);
    } else {
      if (proc.exitCode !== 0) problems.push(`the CLI exited with code ${proc.exitCode}${proc.signal ? ` (${proc.signal})` : ''}`);
      status = problems.length ? 'fail' : 'pass';
      // The usage window is not a failure of the skill: say so and stop, so the run can be repeated after the reset.
      if (lastResult?.is_error === true || proc.exitCode !== 0) {
        const haystack = [lastResult?.result, check.final, stderr].filter((s) => typeof s === 'string' && s !== '').join('\n');
        if (USAGE_WINDOW_RE.test(haystack)) {
          status = 'usage_window';
          notice = shown(check.final || lastResult?.result || stderr, 120);
        }
      }
    }
  }

  const finishedAt = new Date();
  const record = {
    prompt,
    ok: status === 'pass',
    status,
    exit_code: proc.exitCode,
    signal: proc.signal ?? null,
    timed_out: proc.timedOut,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt - startedAt,
    claude: { bin, command: target?.command ?? null, version: check.info.cli_version, model: check.info.model, style: check.info.style },
    args,
    cwd,
    settings: settingsPath,
    problems,
    final: check.final,
    stats: check.stats,
    tools: check.tools,
    info: check.info,
  };
  writeJsonAtomic(join(outDir, 'check.json'), record);
  writeTextAtomic(join(outDir, 'final-message.md'), check.final === '' ? '' : `${check.final.replace(/\s+$/, '')}\n`);

  const code = status === 'pass' ? EXIT.OK : status === 'usage_window' ? EXIT.USAGE_WINDOW : EXIT.ERROR;
  return { status, ok: status === 'pass', code, problems, final: check.final, dir: outDir, check: record, notice };
}

// ---- command line ---------------------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

function configuredBin(root = agentRoot()) {
  try {
    const bin = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))?.judge?.claude_bin;
    return typeof bin === 'string' && bin !== '' ? bin : 'claude';
  } catch {
    return 'claude';
  }
}

function report(io, result, label) {
  const stats = result.check.stats;
  if (result.status === 'usage_window') {
    io.out(`headless-check: STOPPED ${label}: the Claude usage window is used up ("${result.notice}"); run it again after the reset`);
  } else {
    io.out(`headless-check: ${result.ok ? 'PASS' : 'FAIL'} ${label} (${statsLine(stats)})`);
    for (const p of result.problems) io.out(`  - ${p}`);
  }
  io.out(`  files: ${result.dir}`);
  if (result.final !== '') io.out(['--- final message ---', result.final.replace(/\s+$/, ''), '---'].join('\n'));
}

/**
 * Run the script; returns the exit code. env (tests): { processEnv, spawnImpl, root }.
 */
export async function main(argv, io = defaultIo, env = {}) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        prompt: { type: 'string' }, 'prompts-file': { type: 'string' }, out: { type: 'string' }, settings: { type: 'string' }, cwd: { type: 'string' },
        'timeout-ms': { type: 'string' }, 'claude-bin': { type: 'string' }, overwrite: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (e) {
    io.err(`headless-check: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (values.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  if ((values.prompt === undefined) === (values['prompts-file'] === undefined)) {
    io.err(`headless-check: give exactly one of --prompt and --prompts-file\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (!values.out) {
    io.err(`headless-check: --out is required\n${USAGE}`);
    return EXIT.INVALID;
  }
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (values['timeout-ms'] !== undefined) {
    timeoutMs = Number(values['timeout-ms']);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      io.err(`headless-check: --timeout-ms must be a whole number of milliseconds above 0, got "${values['timeout-ms']}"`);
      return EXIT.INVALID;
    }
  }

  const cwd = resolve(values.cwd ?? repoRoot());
  if (!existsSync(cwd)) {
    io.err(`headless-check: --cwd ${cwd} does not exist`);
    return EXIT.INVALID;
  }
  const outRoot = resolve(values.out);
  let prompts;
  try {
    prompts = values.prompt !== undefined ? [values.prompt.trim()] : readPrompts(readFileSync(resolve(values['prompts-file']), 'utf8'));
  } catch (e) {
    io.err(`headless-check: cannot read the prompts (${e.code ?? e.message})`);
    return EXIT.INVALID;
  }
  if (prompts.length === 0 || prompts.some((p) => p === '')) {
    io.err('headless-check: there is no prompt to run');
    return EXIT.INVALID;
  }
  try {
    for (const p of prompts) buildArgs({ prompt: p, settingsPath: 'x' }); // refuse a bad prompt before anything starts
  } catch (e) {
    io.err(`headless-check: ${e.message}`);
    return EXIT.INVALID;
  }

  const single = values.prompt !== undefined;
  const dirs = prompts.map((p, i) => (single ? outRoot : join(outRoot, promptDirName(i + 1, p))));
  if (!values.overwrite) {
    const taken = dirs.find((d) => existsSync(join(d, 'transcript.jsonl')));
    if (taken) {
      io.err(`headless-check: ${taken} already holds a transcript; pick another --out or pass --overwrite`);
      return EXIT.INVALID;
    }
  }

  // The settings: a copy of the project's file plus the output style. Only settings.json is read, never .env.
  const sourcePath = resolve(cwd, values.settings ?? join('.claude', 'settings.json'));
  let merged;
  try {
    merged = mergeSettings(JSON.parse(readFileSync(sourcePath, 'utf8')));
  } catch (e) {
    io.err(`headless-check: cannot use the settings file ${sourcePath} (${e.code ?? e.message})`);
    return EXIT.INVALID;
  }
  const settingsText = `${JSON.stringify(merged, null, 2)}\n`;
  const leak = TOKEN_KINDS.find(([, re]) => re.test(settingsText));
  if (leak) {
    io.err(`headless-check: ${sourcePath} holds a string that looks like a ${leak[0]}; the copy for the check is not written`);
    return EXIT.INVALID;
  }
  const bin = findClaudeBin(values['claude-bin'] ?? configuredBin(env.root));
  const editorColumns = loadEditorColumns(env.root);
  const results = [];
  let code = EXIT.OK;
  try {
    ensureDir(outRoot);
    const settingsPath = join(outRoot, 'headless-settings.json');
    writeTextAtomic(settingsPath, settingsText);
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      io.out(`headless-check: running ${single ? '' : `${i + 1} of ${prompts.length}: `}${prompt}`);
      const result = await runPrompt({
        prompt, outDir: dirs[i], settingsPath, cwd, bin, timeoutMs, env: env.processEnv ?? process.env, spawnImpl: env.spawnImpl ?? spawn, editorColumns,
      });
      results.push({ n: i + 1, prompt, dir: dirs[i], status: result.status, ok: result.ok, problems: result.problems.length });
      report(io, result, prompt);
      if (result.code === EXIT.USAGE_WINDOW) {
        code = EXIT.USAGE_WINDOW;
        if (i < prompts.length - 1) io.out(`headless-check: ${prompts.length - 1 - i} prompt(s) not run: ${prompts.slice(i + 1).map((p) => `"${p}"`).join(', ')}`);
        break;
      }
      if (result.code !== EXIT.OK) code = EXIT.ERROR;
    }
    if (!single) {
      writeJsonAtomic(join(outRoot, 'summary.json'), { ok: code === EXIT.OK, prompts: results });
      io.out(`headless-check: ${results.filter((r) => r.ok).length} of ${prompts.length} prompts passed`);
    }
  } catch (e) {
    io.err(`headless-check: ${e.message}`);
    return EXIT.ERROR;
  }
  return code;
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
