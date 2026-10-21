// A stand-in for `claude -p` for the tests of the loop scripts (distill, promote, followup and the end-to-end loop). It wraps the stock fake
// (fake-claude.mjs, which stays as it is) and adds what those tests need: a default answer for every claim the table does not name, answers that
// depend on the rule text in the system prompt (so a candidate rulebook can answer differently from the live one), and a distill reply that
// cites the rows it was given. Run it in-process with the `fakeScript` option of lib/claude.mjs (judge(), the loop scripts and runClaude all pass it on).
//
// Environment (all optional; the stock FAKE_CLAUDE_* variables work as before):
//   FAKE_CLAUDE_TABLE     path of { "<exact claim text>": answer | [answer, ...] } (stock)
//   FAKE_LOOP_DEFAULT     JSON of one answer, for example {"decision":"do_not_apply","p":0.1}: used for a claim the table does not name
//   FAKE_LOOP_OVERRIDES   path of a JSON list [{ "when": "<text that the system prompt holds>", "table": { "<claim>": answer } }]: the first entry whose
//                         `when` text is in the system prompt of the call lays its table over the base table (how a candidate rule answers otherwise)
//   FAKE_LOOP_DISTILL     path of { "patterns": [{ "lesson", "rule"?, "kind"?, "proposed_text", "keys"?: "all" | [keys] | { "first": n } }] }; without it one pattern
//                         that cites every row given. "rule" defaults to "<the tag> rule <the cited rule or 1>".
//   FAKE_LOOP_WORDING     the sentence of the wording reply (default: the stock one); the word "invalid" makes the reply not JSON
//   FAKE_CLAUDE_READINGS  path of { "<row key>": { reading, rule, note } }, passed through to the stock fake, which answers a prompt that holds a line "# Reading" with one reading per
//                         <row key="..." tag="..."> of the message (a key not in the file is read Rule unclear on the rule its agent reason cites); FAKE_CLAUDE_ONLY works the same way
//
// Every call is also noted in state.log (the stock fake's log), which holds the system prompt file, so a test can tell which side asked.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseClaims, runFake as stockRunFake } from './fake-claude.mjs';

const flagValue = (args, name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

// The stock fake builds the envelope; put another reply into it (the assistant text and the result element).
// true when the stock fake answered with its fixed JSON reply (a garbled mode answers in words, and that must stay as it is)
function isJsonReply(stdout) {
  try {
    return JSON.parse(stdout).some((el) => el.type === 'result' && typeof el.result === 'string' && el.result.trim().startsWith('{'));
  } catch {
    return false;
  }
}

function withReply(stdout, text) {
  const items = JSON.parse(stdout);
  for (const el of items) {
    if (el.type === 'result') el.result = text;
    if (el.type === 'assistant' && Array.isArray(el.message?.content)) el.message.content = [{ type: 'text', text }];
  }
  return JSON.stringify(items);
}

function distillReply(stdin, env) {
  const tag = unescapeXml(/<tag name="([^"]*)"/.exec(stdin)?.[1] ?? 'Context-dependent');
  const cited = /<cited_rule n="(\d+)"/.exec(stdin)?.[1] ?? '1';
  const rows = /<rows>([\s\S]*?)<\/rows>/.exec(stdin)?.[1] ?? '';
  const keys = [...rows.matchAll(/<row key="([^"]*)"/g)].map((m) => unescapeXml(m[1]));
  const config = env.FAKE_LOOP_DISTILL ? readJson(env.FAKE_LOOP_DISTILL) : {
    patterns: [{ lesson: 'General references need no answer', kind: 'Clarify wording', proposed_text: 'Test: a reference that reads as general needs no answer; every other definite reference must point at one specific thing.', keys: 'all' }],
  };
  return {
    patterns: config.patterns.map((p) => {
      let cited_keys = keys;
      if (Array.isArray(p.keys)) cited_keys = p.keys;
      else if (p.keys && typeof p.keys === 'object') cited_keys = keys.slice(0, p.keys.first);
      return { lesson: p.lesson, rule: p.rule ?? `${tag} rule ${cited}`, kind: p.kind ?? 'Clarify wording', proposed_text: p.proposed_text, keys: cited_keys };
    }),
  };
}

function mergedTable(systemText, claims, env) {
  const base = env.FAKE_CLAUDE_TABLE ? readJson(env.FAKE_CLAUDE_TABLE) : {};
  const over = env.FAKE_LOOP_OVERRIDES ? readJson(env.FAKE_LOOP_OVERRIDES).find((o) => systemText.includes(o.when)) : null;
  const table = { ...base, ...(over?.table ?? {}) };
  if (env.FAKE_LOOP_DEFAULT) {
    const fallback = JSON.parse(env.FAKE_LOOP_DEFAULT);
    for (const c of claims) if (!Object.hasOwn(table, c.text)) table[c.text] = fallback;
  }
  return table;
}

export async function runFake({ args = [], stdin = '', env = process.env, state = {} } = {}) {
  const systemPromptFile = flagValue(args, '--system-prompt-file');
  const systemText = systemPromptFile && existsSync(systemPromptFile) ? readFileSync(systemPromptFile, 'utf8') : '';

  if (/^# Reading/m.test(systemText)) return stockRunFake({ args, stdin, env, state }); // the stock fake answers a reading, and the failing modes apply to it as to every call

  if (/^# Distill/m.test(systemText) || /^# Wording/m.test(systemText)) {
    const out = await stockRunFake({ args, stdin, env, state });
    if (out.exitCode !== 0 || !out.stdout || !isJsonReply(out.stdout)) return out;
    if (/^# Distill/m.test(systemText)) return { ...out, stdout: withReply(out.stdout, JSON.stringify(distillReply(stdin, env))) };
    const sentence = env.FAKE_LOOP_WORDING;
    if (sentence === 'invalid') return { ...out, stdout: withReply(out.stdout, 'I could not write a sentence this time.') };
    return sentence ? { ...out, stdout: withReply(out.stdout, JSON.stringify({ sentence })) } : out;
  }

  const claims = parseClaims(stdin);
  const table = mergedTable(systemText, claims, env);
  const text = JSON.stringify(table);
  const dir = join(tmpdir(), `geo-agents-fake-claude-loop-${process.pid}`); // one folder per process: test files run in parallel
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${createHash('sha256').update(text).digest('hex').slice(0, 24)}.json`);
  if (!existsSync(file)) writeFileSync(file, text);
  return stockRunFake({ args, stdin, env: { ...env, FAKE_CLAUDE_TABLE: file }, state });
}
