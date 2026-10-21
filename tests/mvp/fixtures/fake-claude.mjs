#!/usr/bin/env node
// A stand-in for `claude -p ...` for the MVP agent's judge (and, with a marker, the distill and wording prompts). No model, no network.
//
// Two ways to use it:
//   - in-process: lib/claude.mjs imports this file for `driver: "fake"` and calls runFake({ args, stdin, env, state }); this is the default
//     fixture of that driver (the option `fakeScript` names another one);
//   - as a program: node tests/mvp/fixtures/fake-claude.mjs -p --model <id> --system-prompt-file <path> ...   (the prompt on stdin).
//
// What it reads. The user message (stdin): the <claim id="...">text</claim> blocks the judge builds, the text XML-escaped (it is unescaped here).
// The system prompt file: the tag blocks the judge renders from prompts/judge.md, a line "### Tag: <name>" followed by the tag's numbered
// rules ("1. ..."). With no prompt file the one tag is Context-dependent.
//
// What it answers (mode ok). One JSON object {"items": [{id, tags: [{name, decision, p, rule_ref, reason}]}]}, one entry per claim in the
// order given and one object per tag. The answer for a claim comes from a fixture table when the claim's exact text is in it, else from a hash
// of the text and the tag alone, so the same claim always gets the same answer and a run is repeatable:
//   - FAKE_CLAUDE_TABLE: the path of a JSON file { "<exact claim text>": answer }. An answer is { decision, p, rule_ref?, reason? } or a list of
//     them: the n-th time the claim is answered, the n-th entry is used (the last one repeats). That is how a test makes a second read disagree
//     with the first. rule_ref is "<Tag> rule 1" for apply and null otherwise unless the entry says; reason has a default.
//     An entry that is the string "drop" (or { "drop": true }) leaves the claim out of the reply, as a model sometimes does: the reply is valid JSON
//     but does not answer every claim of the batch, so the judge refuses it ("the claim ... is missing from the reply"). The answer is still counted
//     as one read of the claim, so a list such as [ok, "drop", "drop", ok] makes the first two attempts of a batch fail and the third succeed.
//   - without a table entry: p is spread over 0.05 to 0.95 (0.01 steps) by the hash, decision is apply when p >= 0.5.
// A prompt that holds a line "# Distill" (in the system prompt or the message) is answered with a fixed lesson, one that holds "# Wording"
// with one sentence; the shapes are { patterns: [{ lesson, rule, kind, proposed_text, keys }] } and { sentence }.
// A prompt that holds a line "# Reading" is answered with {"readings": [{ key, reading, rule, note }]}: one reading per <row key="..." tag="..."> of the message.
//   - FAKE_CLAUDE_READINGS: the path of a JSON file { "<row key>": { reading, rule, note } }. A row whose key is not in it is read Rule unclear, with the rule its <agent_reason> cites
//     ("<Tag> rule <n>", the last one; null when it cites none) and the note "The rule leaves this kind of case open."
//
// FAKE_CLAUDE_MODE picks the behaviour (default ok):
//   ok               the valid reply
//   invalid-once     the first call of the whole test (see FAKE_CLAUDE_STATE) answers in words, without JSON; every later call is ok
//   invalid-always   every call (after FAKE_CLAUDE_AFTER good ones) answers in words, without JSON
//   transient-once   the first call prints an overloaded error and exits 1; every later call is ok
//   transient-always every call (after FAKE_CLAUDE_AFTER good ones) prints an overloaded error and exits 1
//   usage-window     every call (after FAKE_CLAUDE_AFTER good ones) prints the CLI's "usage limit reached ... resets at 3pm" and exits 1
//   wrong-model      the valid reply, but modelUsage names another model than --model
// The failing modes apply to every kind of call (judge, reading, distill, wording). FAKE_CLAUDE_ONLY (a comma-separated list of reading, distill, wording, judge) limits them to those kinds: any other
// call is answered as in mode ok, and FAKE_CLAUDE_AFTER counts only the calls of the listed kinds.
// Other variables: FAKE_CLAUDE_STATE (a JSON file holding the counters, so they last from one process to the next; without it the counters
// live in the `state` object that runFake is given), FAKE_CLAUDE_AFTER (how many calls succeed before a failing mode starts, default 0),
// FAKE_CLAUDE_LOG (a JSONL file with one line per call: what the fake saw).

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isMain } from '../../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';

export const FAKE_CLI_VERSION = '0.0.0-fake (Claude Code)';
const DEFAULT_TAGS = [{ name: 'Context-dependent', rules: 3 }];
const OTHER_MODEL = 'claude-fake-other-0-0';

const DISTILL_REPLY = {
  patterns: [{
    lesson: 'General references pass the rule 4 test',
    rule: 'Context-dependent rule 4',
    kind: 'Rule should change',
    proposed_text: 'A reference to one particular thing that the claim does not name, such as a title alone, makes the claim Context-dependent.',
    keys: [],
  }],
};
const READING_NOTE = 'The rule leaves this kind of case open.';
const WORDING_REPLY = { sentence: 'A reference to one particular thing that the claim does not name, such as a title alone, still fails the test.' };

const h32 = (...parts) => createHash('sha256').update(parts.join('|'), 'utf8').digest().readUInt32BE(0);
const round2 = (x) => Math.round(x * 100) / 100;
const tokens = (text) => Math.ceil(String(text).length / 4);

function flagValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// ---- reading the prompts ---------------------------------------------------------------------------------------------------

/** The claims of a user message: [{ id, text }], both unescaped. The text is escaped, so it cannot hold a "<claim" of its own. */
export function parseClaims(message) {
  return [...String(message).matchAll(/<claim id="([^"]*)">([\s\S]*?)<\/claim>/g)].map((m) => ({ id: unescapeXml(m[1]), text: unescapeXml(m[2]) }));
}

/** The rows of a reading message: [{ key, tag, agentReason }], unescaped. Only a <row> that names its tag is one (the rows of a distill message do not). */
export function parseRows(message) {
  return [...String(message).matchAll(/<row key="([^"]*)" tag="([^"]*)"[^>]*>([\s\S]*?)<\/row>/g)].map((m) => ({
    key: unescapeXml(m[1]), tag: unescapeXml(m[2]), agentReason: unescapeXml(/<agent_reason>([\s\S]*?)<\/agent_reason>/.exec(m[3])?.[1] ?? ''),
  }));
}

/** The tags of a rendered system prompt: [{ name, rules }], rules being how many numbered rules the block lists. */
export function parseTags(systemText) {
  const tags = [];
  let current = null;
  for (const line of String(systemText).split(/\r?\n/)) {
    const m = /^### Tag: (.+?)\s*$/.exec(line);
    if (m) {
      current = { name: m[1], rules: 0 };
      tags.push(current);
    } else if (/^#{1,6} /.test(line)) {
      current = null;
    } else if (current && /^\d+\. /.test(line)) {
      current.rules++;
    }
  }
  return tags.length ? tags : DEFAULT_TAGS;
}

// ---- the answers -----------------------------------------------------------------------------------------------------------

/** The answer that follows from a hash of the claim text and the tag only: p in 0.05..0.95, apply when p >= 0.5. */
export function fallbackAnswer(text, tag) {
  const h = h32(text, tag.name);
  const p = round2(0.05 + (h % 91) / 100);
  const decision = p >= 0.5 ? 'apply' : 'do_not_apply';
  const rule = decision === 'apply' && tag.rules > 0 ? 1 + ((h >>> 8) % tag.rules) : null;
  const phrase = text.split(/\s+/).slice(0, 3).join(' ').replace(/'/g, '');
  return {
    name: tag.name, decision, p, rule_ref: rule === null ? null : `${tag.name} rule ${rule}`,
    reason: `Fake judge: ${decision} for ${tag.name} because of '${phrase}'.`,
  };
}

function loadTable(env) {
  const file = env.FAKE_CLAUDE_TABLE;
  if (!file) return {};
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The reading of one row of a reading message: from the FAKE_CLAUDE_READINGS table when the key is in it, else Rule unclear on the rule the agent's own reason cites. */
export function readingAnswer(row, table = {}) {
  if (Object.hasOwn(table, row.key)) {
    const e = table[row.key];
    return { key: row.key, reading: e.reading, rule: e.rule ?? null, note: e.note ?? READING_NOTE };
  }
  const re = new RegExp(`${row.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+rule\\s+(\\d+)`, 'gi');
  let last = null;
  for (const m of row.agentReason.matchAll(re)) last = m[1];
  return { key: row.key, reading: 'Rule unclear', rule: last === null ? null : `${row.tag} rule ${last}`, note: READING_NOTE };
}

// what a call is asking for: a reading, a distill prompt, a wording prompt, or claims to judge
function kindOf(systemText, stdin) {
  if (/^# Reading/m.test(systemText) || /^# Reading/m.test(stdin)) return 'reading';
  if (/^# Distill/m.test(systemText) || /^# Distill/m.test(stdin)) return 'distill';
  if (/^# Wording/m.test(systemText) || /^# Wording/m.test(stdin)) return 'wording';
  return 'judge';
}

/** What a table entry says to do with a claim: null (leave it out of the reply) or the answer for one tag. */
function answerFor(text, tag, table, readIndex) {
  const entry = Object.hasOwn(table, text) ? table[text] : undefined;
  if (entry === undefined) return fallbackAnswer(text, tag);
  const e = Array.isArray(entry) ? entry[Math.min(readIndex, entry.length - 1)] : entry;
  if (e === 'drop' || e?.drop === true) return null;
  const ruleRef = Object.hasOwn(e, 'rule_ref') ? e.rule_ref : (e.decision === 'apply' ? `${tag.name} rule 1` : null);
  return { name: tag.name, decision: e.decision, p: e.p, rule_ref: ruleRef, reason: e.reason ?? `Fake table: ${e.decision} for ${tag.name}.` };
}

// ---- the envelope ----------------------------------------------------------------------------------------------------------

function envelope({ result, model, isError = false, usage = null }) {
  const u = usage ?? { input: 0, cache_write: 0, cache_read: 0, output: 0 };
  const element = {
    type: 'result',
    subtype: isError ? 'error_during_execution' : 'success',
    is_error: isError,
    duration_ms: 1200,
    duration_api_ms: 1100,
    num_turns: 1,
    result,
    session_id: 'fake-session',
    total_cost_usd: 0.01,
    usage: {
      input_tokens: u.input, output_tokens: u.output, cache_creation_input_tokens: u.cache_write, cache_read_input_tokens: u.cache_read,
    },
  };
  if (!isError) {
    element.modelUsage = {
      [model]: {
        inputTokens: u.input, outputTokens: u.output, cacheReadInputTokens: u.cache_read, cacheCreationInputTokens: u.cache_write, costUSD: 0.01,
      },
    };
  }
  return JSON.stringify([
    { type: 'system', subtype: 'init', model, tools: [], session_id: 'fake-session' },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: result }] } },
    element,
  ]);
}

const failure = (result, model) => ({ stdout: envelope({ result, model, isError: true }), stderr: '', exitCode: 1 });
const transientFailure = (model) => failure('API Error: 529 overloaded_error: Overloaded', model);
const windowFailure = (model) => failure('Claude usage limit reached. Your limit resets at 3pm.', model);
const NOT_JSON = 'I could not produce the JSON this time; in words, the claims look fine.';

// ---- the counters ----------------------------------------------------------------------------------------------------------

// With FAKE_CLAUDE_STATE the counters live in that file (read, changed and written back inside one synchronous stretch); without it they
// live in the `state` object the caller passes in and keeps between calls.
function counters(env, state) {
  const file = env.FAKE_CLAUDE_STATE;
  if (!file) {
    state.calls ??= 0;
    state.reads ??= {};
    state.prompts ??= {};
    return { st: state, save() {} };
  }
  let st = {};
  if (existsSync(file)) {
    try {
      st = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      st = {};
    }
  }
  st.calls ??= 0;
  st.reads ??= {};
  st.prompts ??= {};
  return { st, save: () => writeFileSync(file, JSON.stringify(st)) };
}

// ---- one call --------------------------------------------------------------------------------------------------------------

/**
 * One fake call: { stdout, stderr, exitCode }. args are the CLI arguments, stdin the user message, env supplies FAKE_CLAUDE_*, state a plain
 * object the caller keeps between calls (the counters, and `log`: what each call saw). A fresh one is used when omitted.
 */
export async function runFake({ args = [], stdin = '', env = process.env, state = {} } = {}) {
  if (args.includes('--version')) return { stdout: `${FAKE_CLI_VERSION}\n`, stderr: '', exitCode: 0 };
  const requested = env.FAKE_CLAUDE_MODE || 'ok';
  const after = Number(env.FAKE_CLAUDE_AFTER ?? 0);
  const model = flagValue(args, '--model') || 'claude-fake-0-0';
  const systemPromptFile = flagValue(args, '--system-prompt-file');
  const systemText = systemPromptFile && existsSync(systemPromptFile) ? readFileSync(systemPromptFile, 'utf8') : '';
  const claims = parseClaims(stdin);
  const kind = kindOf(systemText, stdin);

  const { st, save } = counters(env, state);
  st.calls += 1;
  // FAKE_CLAUDE_ONLY limits the failing modes to some kinds of call: the others are answered in mode ok, and the count of good calls is the count of the listed kinds
  const only = (env.FAKE_CLAUDE_ONLY ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  let mode = requested;
  let call = st.calls;
  if (only.length) {
    if (only.includes(kind)) {
      st.matching = (st.matching ?? 0) + 1;
      call = st.matching;
    } else mode = 'ok';
  }
  state.log ??= [];
  const entry = { call: st.calls, mode, model, kind, ids: claims.map((c) => c.id), texts: claims.map((c) => c.text), systemPromptFile, stdin, args };
  state.log.push(entry);
  if (env.FAKE_CLAUDE_LOG) appendFileSync(env.FAKE_CLAUDE_LOG, `${JSON.stringify(entry)}\n`);

  const done = (out) => {
    save();
    return out;
  };
  switch (mode) {
    case 'transient-once':
      if (call === 1) return done(transientFailure(model));
      break;
    case 'transient-always':
      if (call > after) return done(transientFailure(model));
      break;
    case 'usage-window':
      if (call > after) return done(windowFailure(model));
      break;
    default:
      break;
  }
  const garbled = (mode === 'invalid-once' && call === 1) || (mode === 'invalid-always' && call > after);

  // what is being asked: a reading, a distill prompt, a wording prompt, or claims to judge
  let result;
  if (garbled) result = NOT_JSON;
  else if (kind === 'reading') {
    const table = env.FAKE_CLAUDE_READINGS ? JSON.parse(readFileSync(env.FAKE_CLAUDE_READINGS, 'utf8')) : {};
    result = JSON.stringify({ readings: parseRows(stdin).map((row) => readingAnswer(row, table)) });
  }
  else if (kind === 'distill') result = JSON.stringify(DISTILL_REPLY);
  else if (kind === 'wording') result = JSON.stringify(WORDING_REPLY);
  else {
    const tags = parseTags(systemText);
    const table = loadTable(env);
    const answered = claims.map((c) => ({ id: c.id, tags: tags.map((t) => answerFor(c.text, t, table, st.reads[c.text] ?? 0)) }));
    const items = answered.filter((it) => it.tags.every((t) => t !== null)); // a claim whose entry says "drop" is left out of the reply
    if (!garbled) for (const c of claims) st.reads[c.text] = (st.reads[c.text] ?? 0) + 1;
    result = JSON.stringify({ items });
  }

  // a believable usage: the system prompt is written to the prompt cache by the first call and read from it by the rest
  const systemTokens = tokens(systemText);
  const firstOfPrompt = !st.prompts[systemPromptFile ?? ''];
  st.prompts[systemPromptFile ?? ''] = true;
  const usage = {
    input: tokens(stdin), cache_write: firstOfPrompt ? systemTokens : 0, cache_read: firstOfPrompt ? 0 : systemTokens, output: tokens(result),
  };
  return done({ stdout: envelope({ result, model: mode === 'wrong-model' ? OTHER_MODEL : model, usage }), stderr: '', exitCode: 0 });
}

// ---- as a program ----------------------------------------------------------------------------------------------------------

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const stdin = args.includes('--version') ? '' : await readStdin();
  const out = await runFake({ args, stdin, env: process.env });
  process.stdout.write(out.stdout);
  if (out.stderr) process.stderr.write(out.stderr);
  process.exitCode = out.exitCode;
}
