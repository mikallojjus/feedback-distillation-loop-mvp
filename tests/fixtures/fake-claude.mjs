#!/usr/bin/env node
// A stand-in for `claude -p ...` that answers like the judge prompt asks, without a model.
//
// Two ways to use it:
//   - as a program:   node tests/fixtures/fake-claude.mjs -p --model <id> --system-prompt-file <path> ...   (prompt on stdin)
//   - in-process:     import { runFake } from this file; lib/claude.mjs does that for `driver: "fake"`.
//
// It reads the <claims> block of the user message and the scope and counterpart pairs from the system prompt file that
// judge.mjs rendered ("# Counterpart pairs" lines "- A vs B", "# Tags you must decide for every claim" lines "- Name"), then
// answers every claim with deterministic judgments: a function of the claim text and the tag only, so three runs agree.
// Counterpart pairs always get exactly one apply and one do_not_apply.
//
// FAKE_CLAUDE_MODE picks the behaviour (default ok):
//   ok                the valid reply
//   malformed_once    the first attempt for a batch is cut off mid-array; the retry (its prompt says the previous reply was invalid) is valid
//   malformed_always  every attempt is cut off mid-array
//   inconsistent_pair every attempt has both members of the first counterpart pair applying
//   drop_id           the last claim of the batch is left out
//   fenced            the valid reply inside a ```json fence with prose around it
//   usage_limit       after FAKE_CLAUDE_LIMIT_AFTER successful calls (default 0) every call is a usage-limit error (exit 1)
//   wrong_model       the valid reply, but modelUsage names another model
//   no_model_usage    the valid reply without a modelUsage block
//   object_envelope   the valid reply in the single-object envelope form (default is the array form)
//   bad_envelope      stdout that is not JSON, exit 0
//   exit_error        no stdout, a message on stderr, exit 1 (a transient failure)
//   hang              sleeps FAKE_CLAUDE_DELAY_MS (default 30000) before the valid reply
// Other variables: FAKE_CLAUDE_STATE_FILE (call counter shared between processes), FAKE_CLAUDE_LOG (JSONL of what each call saw).

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isMain } from '../../agents/claim-tagger/scripts/lib/paths.mjs';

const RETRY_MARK = 'Your previous reply was invalid';
const DEFAULT_SCOPE = ['Context-dependent', 'Debate', 'Factual', 'Hypothetical', 'Multiple statements', 'Opinion', 'Predictive', 'Self-contained', 'Simple', 'Single core statement'];
const DEFAULT_PAIRS = [['Context-dependent', 'Self-contained'], ['Debate', 'Simple'], ['Factual', 'Opinion'], ['Multiple statements', 'Single core statement']];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h32 = (...parts) => createHash('sha256').update(parts.join('|'), 'utf8').digest().readUInt32BE(0);

function flagValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** The claims of a user message: [{ id, sources, text }]. */
export function parseClaims(message) {
  return [...String(message).matchAll(/<claim id="([^"]*)" sources="([^"]*)">([\s\S]*?)<\/claim>/g)]
    .map((m) => ({ id: unescapeXml(m[1]), sources: m[2], text: unescapeXml(m[3]) }));
}

function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^# /.test(lines[i])) break;
    const m = /^- (.+)$/.exec(lines[i].trim());
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** { scope, pairs } as rendered into the system prompt file (the defaults when there is none). */
export function parseSystemPrompt(path) {
  if (!path || !existsSync(path)) return { scope: DEFAULT_SCOPE, pairs: DEFAULT_PAIRS, text: '' };
  const text = readFileSync(path, 'utf8');
  const scope = section(text, '# Tags you must decide for every claim');
  const pairs = section(text, '# Counterpart pairs').filter((l) => l.includes(' vs ')).map((l) => l.split(' vs ').map((s) => s.trim()));
  return { scope: scope.length ? scope : DEFAULT_SCOPE, pairs, text };
}

/** The deterministic judgments for a list of claims: [{ id, tags: [...] }]. Exported for tests. */
export function fakeJudgments(claims, { scope, pairs }, { breakFirstPair = false } = {}) {
  const partner = new Map();
  for (const [a, b] of pairs) {
    partner.set(a, b);
    partner.set(b, a);
  }
  return claims.map((c) => ({
    id: c.id,
    tags: [...scope].sort().map((name) => {
      let decision;
      const other = partner.get(name);
      if (other) {
        const [a, b] = [name, other].sort();
        decision = (h32(c.text, a, b) % 2 === 0 ? a : b) === name ? 'apply' : 'do_not_apply';
      } else {
        decision = h32(c.text, name) % 4 === 0 ? 'apply' : 'do_not_apply';
      }
      if (breakFirstPair && pairs.length && (name === pairs[0][0] || name === pairs[0][1])) decision = 'apply';
      const p = Math.round((0.55 + (h32(c.text, name, 'p') % 40) / 100) * 100) / 100;
      return {
        name,
        decision,
        p,
        rule_ref: decision === 'apply' ? `${name} rule 1` : `${name} description`,
        trigger: decision === 'apply' ? c.text.split(/\s+/).slice(0, 3).join(' ') : null,
        reason: `Fake judge: ${decision} for ${name}.`,
      };
    }),
  }));
}

function envelope({ result, model, claimCount, isError = false, mode, env }) {
  const cost = Math.round((0.01 + 0.002 * claimCount) * 1e6) / 1e6;
  const element = {
    type: 'result',
    subtype: isError ? 'error_during_execution' : 'success',
    is_error: isError,
    duration_ms: 1200 + claimCount * 30,
    duration_api_ms: 1100,
    num_turns: 1,
    result,
    session_id: 'fake-session',
    total_cost_usd: cost,
    usage: { input_tokens: 1000 + claimCount * 40, output_tokens: 200 + claimCount * 90 },
  };
  if (mode !== 'no_model_usage') {
    element.modelUsage = {
      [mode === 'wrong_model' ? 'claude-fallback-0-0' : model]: {
        inputTokens: 1000 + claimCount * 40, outputTokens: 200 + claimCount * 90, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: cost,
      },
    };
  }
  if (mode === 'object_envelope' || env.FAKE_CLAUDE_ENVELOPE === 'object') return JSON.stringify(element);
  return JSON.stringify([
    { type: 'system', subtype: 'init', model, tools: [], session_id: 'fake-session' },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: result }] } },
    element,
  ]);
}

/**
 * One fake call: { stdout, stderr, exitCode }. args are the CLI arguments, stdin the user message, env supplies FAKE_CLAUDE_*,
 * state is a plain object shared between calls ({ calls, log }); a fresh one is used when omitted.
 */
export async function runFake({ args = [], stdin = '', env = process.env, state = {} } = {}) {
  if (args.includes('--version')) return { stdout: '0.0.0-fake (Claude Code)\n', stderr: '', exitCode: 0 };
  const mode = env.FAKE_CLAUDE_MODE || 'ok';
  const model = flagValue(args, '--model') || 'claude-fake-0-0';
  const systemPromptFile = flagValue(args, '--system-prompt-file');
  const retry = stdin.includes(RETRY_MARK);
  const claims = parseClaims(stdin);
  const prompt = parseSystemPrompt(systemPromptFile);

  state.calls = (state.calls ?? 0) + 1;
  state.log ??= [];
  const entry = {
    call: state.calls, mode, model, retry, ids: claims.map((c) => c.id), systemPromptFile,
    systemPromptSha256: createHash('sha256').update(prompt.text, 'utf8').digest('hex'), args, stdin,
  };
  state.log.push(entry);
  if (env.FAKE_CLAUDE_LOG) appendFileSync(env.FAKE_CLAUDE_LOG, JSON.stringify({ ...entry, stdin: undefined }) + '\n');

  const ok = (result) => ({ stdout: envelope({ result, model, claimCount: claims.length, mode, env }), stderr: '', exitCode: 0 });

  switch (mode) {
    case 'bad_envelope':
      return { stdout: 'this is not json at all', stderr: '', exitCode: 0 };
    case 'exit_error':
      return { stdout: '', stderr: 'Error: connection reset by peer (fake transient failure)', exitCode: 1 };
    case 'usage_limit':
      if (state.calls > Number(env.FAKE_CLAUDE_LIMIT_AFTER ?? 0)) {
        return {
          stdout: envelope({ result: 'Claude usage limit reached. Your limit will reset at 3am.', model, claimCount: 0, isError: true, mode: 'ok', env }),
          stderr: '',
          exitCode: 1,
        };
      }
      break;
    case 'hang':
      await sleep(Number(env.FAKE_CLAUDE_DELAY_MS ?? 30000));
      break;
    default:
      break;
  }

  const good = JSON.stringify(fakeJudgments(claims, prompt, { breakFirstPair: mode === 'inconsistent_pair' }));
  switch (mode) {
    case 'malformed_once':
      if (retry) return ok(good);
      return ok(`Sure, here is the judgment:\n${good.slice(0, Math.max(10, Math.floor(good.length / 2)))}`);
    case 'malformed_always':
      return ok(`Sure, here is the judgment:\n${good.slice(0, Math.max(10, Math.floor(good.length / 2)))}`);
    case 'drop_id':
      return ok(JSON.stringify(fakeJudgments(claims.slice(0, -1), prompt)));
    case 'fenced':
      return ok(`Here you go:\n\`\`\`json\n${good}\n\`\`\`\nLet me know if you need anything else.`);
    default:
      return ok(good);
  }
}

// ---- as a program -------------------------------------------------------------------------------------------------------

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const stdin = args.includes('--version') ? '' : await readStdin();
  const stateFile = process.env.FAKE_CLAUDE_STATE_FILE;
  let state = {};
  if (stateFile && existsSync(stateFile)) {
    try {
      state = { calls: JSON.parse(readFileSync(stateFile, 'utf8')).calls ?? 0 };
    } catch {
      state = {};
    }
  }
  const out = await runFake({ args, stdin, env: process.env, state });
  if (stateFile) writeFileSync(stateFile, JSON.stringify({ calls: state.calls }));
  process.stdout.write(out.stdout);
  if (out.stderr) process.stderr.write(out.stderr);
  process.exitCode = out.exitCode;
}
