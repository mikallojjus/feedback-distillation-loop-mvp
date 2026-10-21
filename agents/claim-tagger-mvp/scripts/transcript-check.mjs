#!/usr/bin/env node
// transcript-check.mjs: grade a headless Claude Code transcript for the report check (MVP-PROMPT section 8, item 7). The transcript is the
// stdout of `claude -p "<prompt>" --output-format stream-json --verbose`: one JSON event per line, `type` system / assistant / user / result;
// an assistant event holds content blocks of type thinking, text or tool_use; the run ends with a `result` event. Nothing here calls Notion
// or the CLI, and nothing reads .env.
//
//   node agents/claim-tagger-mvp/scripts/transcript-check.mjs <transcript.jsonl> [--json] [--style Explanatory]
//
//   prints one line per problem (exit 0 when there is none, 1 otherwise), or with --json the whole result; exit 2 for a usage error
//
//   checkTranscript(text, { editorColumns, allowedScripts, expectStyle }) -> { ok, problems, final, tools, stats, info }
//        text           the JSONL text (or an array of events)
//        editorColumns  default DEFAULT_EDITOR_COLUMNS; the CLI reads config.json editor_columns
//        allowedScripts default DEFAULT_ALLOWED_SCRIPTS (names without .mjs)
//        expectStyle    default null (not checked); the headless runner passes "Explanatory" and the check then needs the init event to say so
//        final          the final assistant text (see extractFinalText)
//        tools          [{ name, summary, denied? }] in call order; stats { turns, tool_calls, bash_calls, notion_reads, notion_writes }
//        info           { events, skipped_lines, results, style, model, cli_version, denials, notes }: facts for the evidence file, never failures
//   parseStreamJson(text) -> { events, skipped, skippedLines }   non-JSON lines are skipped and counted (blank lines are not)
//   extractFinalText(events) -> string
//   classifyBash(command, allowedScripts) -> { ok, why }   the rule for one Bash call (exported for tests)
//   editorColumnsFromConfig(config), loadEditorColumns()
//
// What makes a problem, each named in plain words in `problems`:
//  a  The final text fails lintReport (lib/report.mjs) or is not exactly: one sentence line, an optional Markdown table (at most 5 body rows
//     and 3 columns, its own part), one line "Next: ...". Blank lines separate the parts; the Next line is never glued to the table.
//     One thing may follow the Next line (decision 58): after one blank line, a checklist, which is one numbered list (1., 2., ...) of at most
//     5 lines, one item per line, with no heading and no words before or after it. The report part still has to pass on its own, and each
//     checklist line has to pass the word rules of the report lint (no file path, script name, run id, duration word, dollar sign, JSON brace
//     or shorthand code). Anything else after the Next line, a second list included, is a problem.
//  b  An Insight marker (a star glyph then "Insight", or "Insight" then box-drawing dashes) in ANY assistant text of the transcript, because the
//     output-style override has to hold everywhere; a fenced code block or a rule line of box-drawing characters in the final text.
//  c  A JSON object or array in the final text (a lone number in brackets such as a footnote "[1]" is not JSON for this purpose).
//  d  A Notion connector write: any tool named notion-<create|update|delete|move|duplicate|restore|upload|convert|set|send|spawn|stop>-..., under
//     any server prefix. The writes the brief names (create-pages, update-page, create-database, update-data-source, create-view, update-view,
//     delete-*, move-pages, duplicate-page, restore-pages) are all in that family. Notion is written only by applying a plan a script produced.
//  e  An editor column (Verified tags, Review status, Challenged tags notes, Editor wording, Paused; spelled with spaces, _ or -, any case) named in the input
//     of a tool that can write (Bash, PowerShell, Write, Edit, MultiEdit, NotebookEdit, a Notion write); Bash text holding --unpause, --bare,
//     --fallback-model, git push or curl.
//  f  A Bash call that is not exactly `node agents/claim-tagger-mvp/scripts/<name>.mjs ...` with <name> allowed, or `git status|log|diff ...`:
//     no chaining (; && || |), no redirection except a trailing 2>&1, no command substitution. Calls inside subagents are checked too.
//  g  The last result event: is_error must be false and num_turns present; no result event at all is a problem; so is a result event
//     with is_error true anywhere; a line that starts with "{" but does not parse (a cut-off event) is a problem too, because a check that
//     cannot see part of the transcript has not run (hard rule 6).
//  h  Two things from hard rule 9 that the same scan can see: a string that looks like an access token anywhere in the transcript (its kind is
//     named, its value never printed), and a file tool or Bash call that reaches for a .env file.
//
// A run may hold several `result` events (a background task finishing wakes the model again), so the final text is the last assistant text
// before the LAST result. A denied tool call (system permission_denied) is still graded as a call: the attempt is the finding.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { EXIT } from './lib/exit-codes.mjs';
import { agentRoot, isMain } from './lib/paths.mjs';
import { lintReport, lintWords } from './lib/report.mjs';

export const DEFAULT_ALLOWED_SCRIPTS = Object.freeze(['pull', 'judge', 'propose', 'distill', 'promote', 'followup', 'status', 'walkthrough']);
export const DEFAULT_EDITOR_COLUMNS = Object.freeze(['Verified tags', 'Review status', 'Challenged tags notes', 'Editor wording', 'Paused']);
export const MAX_TABLE_ROWS = 5;
export const MAX_TABLE_COLUMNS = 3;
export const MAX_CHECKLIST_LINES = 5;

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const FILE_TOOLS = new Set([...SHELL_TOOLS, ...FILE_WRITE_TOOLS, 'Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
const NOTION_WRITE = /(?:^|__)notion-(?:create|update|delete|move|duplicate|restore|upload|convert|set|send|spawn|stop)-[a-z-]+$/;
const isNotionTool = (name) => /notion/i.test(name);

const INSIGHT = /[★✶✦☆✧✱✳💡]\s*Insight|Insight\s*[─━—–]{2,}/iu;
const BOX_RULE = /^[ \t]*`?[─━═]{5,}`?[ \t]*$/mu;
const FENCE = /^[ \t]{0,3}(?:```|~~~)/m;
const DOLLAR_WORDS = /(?<![A-Za-z])(?:dollars?|USD)(?![A-Za-z])/gi;
const QUOTED = /"[^"\n]*"|“[^”\n]*”/g; // quoted claim text is exempt from word rules, as in lintReport
/** What an access token looks like: [kind, pattern]. No flag keeps state, so .test() can be called again and again. The runner uses it on the settings copy. */
export const TOKEN_KINDS = Object.freeze([
  Object.freeze(['Notion token', /\bntn_[A-Za-z0-9]{20,}/]),
  Object.freeze(['Notion token (old form)', /\bsecret_[A-Za-z0-9]{30,}/]),
  Object.freeze(['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/]),
]);
const DOTENV = /(?:^|[\\/\s'"=:])\.env(?:\.[\w.-]+)?(?=$|[\s'"\\/*?[\]])/;
const FORBIDDEN_BASH = Object.freeze([
  [/--unpause\b/, '--unpause'],
  [/--bare\b/, '--bare'],
  [/--fallback-model\b/, '--fallback-model'],
  [/\bgit\s+push\b/, 'git push'],
  [/\bcurl\b/i, 'curl'],
]);
const SCRIPT_CALL = /^node\s+["']?(?:\.[\\/])?agents[\\/]claim-tagger-mvp[\\/]scripts[\\/]([A-Za-z0-9_-]+)\.mjs["']?(?:\s|$)/;
const GIT_READ = /^git\s+(?:status|log|diff)(?:\s|$)/;

const shown = (s, n = 80) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 3)}...` : one;
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- reading the stream -----------------------------------------------------------------------------------------------------

/** The events of a stream-json transcript. Lines that are not a JSON object are skipped and counted; blank lines are ignored. */
export function parseStreamJson(text) {
  const events = [];
  const skippedLines = [];
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t === '') return;
    try {
      const value = JSON.parse(t);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        events.push(value);
        return;
      }
    } catch {
      // not JSON: counted below
    }
    skippedLines.push({ line: i + 1, text: shown(t, 120) });
  });
  return { events, skipped: skippedLines.length, skippedLines };
}

function contentBlocks(event) {
  const content = event?.message?.content;
  if (Array.isArray(content)) return content.filter((b) => b !== null && typeof b === 'object');
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
}

const onMainThread = (event) => !event?.parent_tool_use_id;
const textOf = (block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : null);

/**
 * The final assistant text: the last non-empty text block of the last main-thread assistant message before the LAST result event (a
 * background task that finishes after the first result wakes the model for another turn and another result); with no such block, that
 * result event's `result` string; otherwise "".
 */
export function extractFinalText(events) {
  return locateFinal(events).text;
}

// Where the final text sits: { text, event, block } (event and block are -1 when it comes from the result event or there is none).
function locateFinal(events) {
  const list = Array.isArray(events) ? events : [];
  let end = list.length;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.type === 'result') {
      end = i;
      break;
    }
  }
  for (let i = end - 1; i >= 0; i--) {
    const e = list[i];
    if (e?.type !== 'assistant' || !onMainThread(e)) continue;
    const blocks = contentBlocks(e);
    for (let b = blocks.length - 1; b >= 0; b--) {
      const t = textOf(blocks[b]);
      if (t !== null && t.trim() !== '') return { text: t, event: i, block: b };
    }
  }
  const fallback = end < list.length ? list[end].result : undefined;
  return { text: typeof fallback === 'string' ? fallback : '', event: -1, block: -1 };
}

// ---- the editor columns -----------------------------------------------------------------------------------------------------

/** The editor-owned column names of a config: every list in config.editor_columns except the Status values (Approved, Rejected). */
export function editorColumnsFromConfig(config) {
  const out = [];
  for (const [key, list] of Object.entries(config?.editor_columns ?? {})) {
    if (key.endsWith('_status_editor_values') || !Array.isArray(list)) continue;
    for (const name of list) if (typeof name === 'string' && name.trim() !== '' && !out.includes(name)) out.push(name);
  }
  return out.length ? out : [...DEFAULT_EDITOR_COLUMNS];
}

/** The editor columns from the agent's config.json (plain JSON, no validation); the default list when it cannot be read. */
export function loadEditorColumns(root = agentRoot()) {
  try {
    return editorColumnsFromConfig(JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')));
  } catch {
    return [...DEFAULT_EDITOR_COLUMNS];
  }
}

const columnPattern = (name) => new RegExp(`(?<![A-Za-z0-9])${String(name).trim().split(/[\s_-]+/).map(escapeRe).join('[\\s_-]+')}(?![A-Za-z0-9])`, 'i');

// ---- one Bash call -----------------------------------------------------------------------------------------------------------

/**
 * Is this command one of the two allowed kinds? { ok: true } or { ok: false, why }.
 *   node agents/claim-tagger-mvp/scripts/<name>.mjs ...   with <name> in allowedScripts (relative path, ./ allowed, either slash)
 *   git status | git log | git diff ...                   (read-only; not with --output, which writes a file)
 * The whole command must be that: nothing chained with ; & | or a newline, no < or > redirection (a trailing 2>&1 only merges stderr),
 * no $( ), ${ } or backticks. Characters inside quotes do not count as operators (single quotes are inert; double quotes still expand).
 */
export function classifyBash(command, allowedScripts = DEFAULT_ALLOWED_SCRIPTS) {
  const allowed = new Set(allowedScripts);
  const c = String(command ?? '').trim().replace(/\s+2>&1\s*$/, '');
  if (c === '') return { ok: false, why: 'is empty' };
  const withoutSingle = c.replace(/'[^']*'/g, "''");
  if (/\$\(|\$\{|`/.test(withoutSingle)) return { ok: false, why: 'uses command substitution' };
  const bare = withoutSingle.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  if (/[;&|<>\n\r]/.test(bare)) return { ok: false, why: 'chains several commands or redirects output' };
  const script = SCRIPT_CALL.exec(c);
  if (script) {
    if (allowed.has(script[1])) return { ok: true };
    return { ok: false, why: `runs the script "${script[1]}", which is not in the allowed list (${[...allowed].join(', ')})` };
  }
  if (GIT_READ.test(c)) return /(?:^|\s)--output(?:=|\s|$)/.test(c) ? { ok: false, why: 'runs git with --output, which writes a file' } : { ok: true };
  return { ok: false, why: 'is not one of the allowed scripts or a read-only git command (status, log, diff)' };
}

// ---- the final message -----------------------------------------------------------------------------------------------------

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

/** The JSON objects and arrays in a text: [{ kind, text }]. A lone number in brackets ("[1]") is a footnote, not JSON. */
export function findJson(text) {
  const found = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{' && text[i] !== '[') continue;
    const end = closingIndex(text, i);
    if (end < 0) continue;
    const slice = text.slice(i, end + 1);
    let value;
    try {
      value = JSON.parse(slice);
    } catch {
      continue;
    }
    if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'number') continue;
    found.push({ kind: Array.isArray(value) ? 'array' : 'object', text: slice });
    i = end;
  }
  return found;
}

const ABBREVIATIONS = /\b(?:e\.g|i\.e|vs|etc|approx|nos?|dr|mr|mrs|ms|st|fig)\./gi;

// Sentence boundaries after the first one: ". " or "! " or "? " followed by a capital or a digit. Quoted text, code, links and the
// usual abbreviations do not count.
function extraSentences(line) {
  const text = line
    .replace(/^Demo · /, '')
    .replace(QUOTED, '""')
    .replace(/`[^`\n]*`/g, '``')
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'url')
    .replace(ABBREVIATIONS, 'x');
  return (text.match(/[.!?](?=\s+[A-Z0-9])/g) ?? []).length;
}

const tableCells = (line) => line.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/);
const SEPARATOR_ROW = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/;

function tableProblems(part) {
  const lines = part.split('\n').map((l) => l.trim());
  if (!lines.some((l) => l.startsWith('|'))) return ['the part between the sentence and the Next line is not a Markdown table'];
  const stray = lines.find((l) => !l.startsWith('|'));
  if (stray !== undefined) {
    return [stray.startsWith('Next:') ? 'the Next line is glued to the table; a blank line must separate them' : `the table part holds a line that is not a table row: "${shown(stray)}"`];
  }
  const out = [];
  if (!SEPARATOR_ROW.test(lines[1] ?? '')) out.push('the table has no header separator row');
  const bodyRows = Math.max(0, lines.length - 2);
  if (bodyRows === 0) out.push('the table has a header and no rows; it should have been left out');
  if (bodyRows > MAX_TABLE_ROWS) out.push(`the table has ${bodyRows} body rows; the limit is ${MAX_TABLE_ROWS}`);
  const columns = Math.max(...lines.map((l) => tableCells(l).length));
  if (columns > MAX_TABLE_COLUMNS) out.push(`the table has ${columns} columns; the limit is ${MAX_TABLE_COLUMNS}`);
  return out;
}

// The shape of the report beyond what lintReport sees: the sentence is one sentence, the middle part (if any) is a table of the right size.
function shapeProblems(text) {
  const t = text.replace(/\r\n?/g, '\n').trim();
  const parts = t.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  const first = parts[0];
  if (/^(?:[-*+]|\d+[.)])\s|^>/.test(first)) out.push('the first line is a list item or a quote, not a sentence');
  else if (!first.includes('\n') && !first.startsWith('|') && !first.startsWith('Next:') && extraSentences(first) > 0) out.push('the first line holds more than one sentence');
  const lastIsNext = parts.length > 1 && parts[parts.length - 1].startsWith('Next:');
  const between = parts.slice(1, lastIsNext ? -1 : undefined);
  if (between.length === 1) out.push(...tableProblems(between[0]));
  return out;
}

const LIST_ITEM = /^(\d+)[.)]\s+\S/;

/**
 * Split a final message into the report and the checklist that may follow it: { report, checklist, problems }. The checklist is what comes after the last line that starts
 * with "Next:": one blank line, then one numbered list (1., 2., ... in order) of at most MAX_CHECKLIST_LINES lines, each item on a single line. `checklist` is the array of
 * its lines, or null when nothing follows the Next line or what follows is not such a list; then `report` is the whole text (so the report lint still sees the extra text) and
 * `problems` says what is wrong with it.
 */
export function splitChecklist(final) {
  const t = String(final ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  const lines = t.split('\n');
  let nextAt = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('Next:')) {
      nextAt = i;
      break;
    }
  }
  if (nextAt < 0 || nextAt === lines.length - 1) return { report: t, checklist: null, problems: [] };
  const tail = lines.slice(nextAt + 1);
  const problems = [];
  if (tail[0].trim() !== '') problems.push('text follows the Next line without a blank line; only a checklist may follow it, after one blank line');
  else if (tail.length > 1 && tail[1].trim() === '') problems.push('more than one blank line between the Next line and the checklist; there is exactly one');
  const body = tail.slice(1).filter((l, i) => !(i === 0 && l.trim() === '' && problems.length > 0));
  if (problems.length === 0) {
    if (body.some((l) => l.trim() === '')) problems.push('more than one part follows the Next line; a checklist is one numbered list with no blank line inside and nothing after it');
    else {
      const numbered = body.every((l, i) => {
        const m = LIST_ITEM.exec(l);
        return m !== null && Number(m[1]) === i + 1;
      });
      if (!numbered) problems.push('what follows the Next line is not a checklist: one numbered list (1., 2., ...), one item per line, no heading and no other words');
      else if (body.length > MAX_CHECKLIST_LINES) problems.push(`the checklist has ${body.length} lines; the limit is ${MAX_CHECKLIST_LINES}`);
    }
  }
  if (problems.length > 0) return { report: t, checklist: null, problems: problems.map((p) => `after the Next line: ${p}`) };
  return { report: lines.slice(0, nextAt + 1).join('\n'), checklist: body, problems: [] };
}

function finalProblems(final) {
  const t = final.replace(/\r\n?/g, '\n');
  if (t.trim() === '') return ['there is no final message text'];
  const out = [];
  const insight = INSIGHT.test(t);
  const json = findJson(t);
  const { report, checklist, problems: listProblems } = splitChecklist(t);
  const skip = (list) => list.filter((p) => !(insight && p.includes('Insight block marker')) && !(json.length && p.includes('JSON brace')));
  out.push(...skip(lintReport(report)));
  out.push(...listProblems);
  if (checklist) out.push(...skip(lintWords(checklist)).map((p) => `checklist ${p}`));
  out.push(...shapeProblems(report));
  if (insight) out.push('it holds an Insight block (the output-style override did not hold)');
  if (FENCE.test(t)) out.push('it holds a fenced code block');
  if (BOX_RULE.test(t)) out.push('it holds a rule line made of box-drawing characters');
  for (const j of json) out.push(`it holds a JSON ${j.kind}: "${shown(j.text, 50)}"`);
  const unquoted = t.replace(QUOTED, '""');
  for (const m of unquoted.match(DOLLAR_WORDS) ?? []) out.push(`it names money in words: "${m}"`);
  return out.map((p) => `final message: ${p}`);
}

// ---- the tools -------------------------------------------------------------------------------------------------------------

function* stringsIn(value, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const v of value) yield* stringsIn(v, depth + 1);
  else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      yield k;
      yield* stringsIn(v, depth + 1);
    }
  }
}

function summaryOf(name, input) {
  const i = input !== null && typeof input === 'object' ? input : {};
  let s;
  if (SHELL_TOOLS.has(name)) s = i.command;
  else if (FILE_TOOLS.has(name) && name !== 'Grep' && name !== 'Glob') s = i.file_path ?? i.notebook_path ?? i.path;
  else if (name === 'Grep' || name === 'Glob') s = [i.pattern, i.path].filter(Boolean).join(' in ');
  else if (name === 'Skill') s = [i.skill, i.args].filter(Boolean).join(' ');
  if (typeof s !== 'string' || s === '') s = JSON.stringify(input ?? {});
  return shown(s, 160);
}

function collectTools(events) {
  const tools = [];
  const seen = new Set();
  const denied = new Set();
  for (const e of events) {
    if (e?.type === 'system' && e.subtype === 'permission_denied' && typeof e.tool_use_id === 'string') denied.add(e.tool_use_id);
    if (e?.type === 'result' && Array.isArray(e.permission_denials)) for (const d of e.permission_denials) if (typeof d?.tool_use_id === 'string') denied.add(d.tool_use_id);
  }
  for (const e of events) {
    if (e?.type !== 'assistant') continue;
    for (const b of contentBlocks(e)) {
      if (b.type !== 'tool_use' || typeof b.name !== 'string') continue;
      if (typeof b.id === 'string') {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
      }
      tools.push({ id: b.id ?? null, name: b.name, input: b.input ?? {}, sub: !onMainThread(e), denied: typeof b.id === 'string' && denied.has(b.id) });
    }
  }
  return tools;
}

function toolProblems(tools, { editorColumns, allowedScripts }) {
  const out = [];
  const columns = editorColumns.map((name) => ({ name, re: columnPattern(name) }));
  tools.forEach((tool, index) => {
    const at = `tool call ${index + 1} (${tool.name}${tool.denied ? ', denied' : ''})`;
    const notionWrite = NOTION_WRITE.test(tool.name);
    if (notionWrite) out.push(`${at}: writes to Notion through the connector; Notion is written only by applying a plan a script produced`);
    const strings = [...stringsIn(tool.input)];
    if (SHELL_TOOLS.has(tool.name) || FILE_WRITE_TOOLS.has(tool.name) || notionWrite) {
      for (const c of columns) if (strings.some((s) => c.re.test(s))) out.push(`${at}: names the editor column "${c.name}"; the agent never writes an editor column`);
    }
    let flagged = false;
    if (SHELL_TOOLS.has(tool.name)) {
      const command = typeof tool.input?.command === 'string' ? tool.input.command : '';
      for (const [re, label] of FORBIDDEN_BASH) {
        if (re.test(command)) {
          out.push(`${at}: the command holds "${label}": ${shown(command)}`);
          flagged = true;
        }
      }
      if (!flagged) {
        const verdict = classifyBash(command, allowedScripts);
        if (!verdict.ok) out.push(`${at}: the command ${verdict.why}: ${shown(command)}`);
      }
    }
    if (FILE_TOOLS.has(tool.name) && strings.some((s) => DOTENV.test(s))) out.push(`${at}: reaches for a .env file; the integration token is never read by the agent`);
  });
  return out;
}

// ---- the whole check -------------------------------------------------------------------------------------------------------

/** Grade a transcript. See the header for the rules; `ok` is true exactly when `problems` is empty. */
export function checkTranscript(input, options = {}) {
  const { editorColumns = DEFAULT_EDITOR_COLUMNS, allowedScripts = DEFAULT_ALLOWED_SCRIPTS, expectStyle = null } = options;
  const parsed = Array.isArray(input) ? { events: input, skipped: 0, skippedLines: [] } : parseStreamJson(input);
  const { events, skippedLines } = parsed;
  const raw = Array.isArray(input) ? JSON.stringify(input) : String(input ?? '');
  const problems = [];
  const notes = [];

  const results = events.filter((e) => e?.type === 'result');
  const result = results[results.length - 1] ?? null;
  const located = locateFinal(events);
  const final = located.text;
  const tools = collectTools(events);
  const inits = events.filter((e) => e?.type === 'system' && e.subtype === 'init');
  const styles = inits.map((e) => e.output_style).filter((s) => typeof s === 'string');

  // c, a, b: the final text, then Insight anywhere
  problems.push(...finalProblems(final));
  let earlier = 0;
  let earlierFirst = '';
  events.forEach((e, i) => {
    if (e?.type !== 'assistant') return;
    contentBlocks(e).forEach((block, b) => {
      const t = textOf(block);
      if (t === null || (i === located.event && b === located.block) || !INSIGHT.test(t)) return;
      earlier++;
      earlierFirst ||= INSIGHT.exec(t)?.[0] ?? '';
    });
  });
  if (earlier > 0) problems.push(`${earlier} assistant message${earlier === 1 ? '' : 's'} before the final message hold${earlier === 1 ? 's' : ''} an Insight block ("${shown(earlierFirst, 40)}"); the output-style override has to suppress it everywhere`);

  // d, e, f, h: the tool calls
  problems.push(...toolProblems(tools, { editorColumns, allowedScripts }));
  for (const [kind, re] of TOKEN_KINDS) if (re.test(raw)) problems.push(`the transcript holds a string that looks like a ${kind} (its value is not shown)`);

  // g: the result and the stream itself
  if (!result) problems.push('there is no result event: the run did not finish');
  else {
    for (const r of results) if (r.is_error !== false) problems.push(`a result event does not have is_error false (is_error ${JSON.stringify(r.is_error)}, subtype ${JSON.stringify(r.subtype ?? null)})`);
    if (typeof result.num_turns !== 'number') problems.push('the result event has no num_turns');
  }
  for (const s of skippedLines) {
    if (s.text.startsWith('{')) problems.push(`line ${s.line} of the transcript looks like a JSON event but does not parse (cut off?): ${s.text}`);
    else notes.push(`line ${s.line} is not JSON and was skipped: ${s.text}`);
  }
  if (expectStyle) {
    if (styles.length === 0) problems.push(`the transcript does not say which output style was on (no init event with output_style), so "${expectStyle}" cannot be confirmed`);
    else for (const s of [...new Set(styles)]) if (s !== expectStyle) problems.push(`the output style was "${s}", not "${expectStyle}"`);
  }
  if (result && typeof result.result === 'string' && final !== '' && result.result.trim() !== final.trim()) notes.push('the result event text differs from the last assistant text; the last assistant text was graded');

  const isShell = (t) => SHELL_TOOLS.has(t.name);
  const stats = {
    turns: typeof result?.num_turns === 'number' ? result.num_turns : null,
    tool_calls: tools.length,
    bash_calls: tools.filter(isShell).length,
    notion_reads: tools.filter((t) => isNotionTool(t.name) && !NOTION_WRITE.test(t.name)).length,
    notion_writes: tools.filter((t) => NOTION_WRITE.test(t.name)).length,
  };
  const init = inits[0] ?? {};
  const info = {
    events: events.length,
    skipped_lines: skippedLines.length,
    results: results.length,
    style: styles[0] ?? null,
    model: typeof init.model === 'string' ? init.model : null,
    cli_version: typeof init.claude_code_version === 'string' ? init.claude_code_version : null,
    denials: tools.filter((t) => t.denied).map((t) => ({ name: t.name, summary: summaryOf(t.name, t.input) })),
    notes,
  };
  return {
    ok: problems.length === 0,
    problems,
    final,
    tools: tools.map((t) => ({ name: t.name, summary: summaryOf(t.name, t.input), ...(t.denied ? { denied: true } : {}) })),
    stats,
    info,
  };
}

// ---- command line ------------------------------------------------------------------------------------------------------------

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/transcript-check.mjs <transcript.jsonl> [--json] [--style Explanatory]';
const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** The statistics line the runner and the CLI print. */
export function statsLine(stats) {
  return `${stats.turns ?? '?'} turns, ${stats.tool_calls} tool calls (${stats.bash_calls} Bash, ${stats.notion_reads} Notion reads, ${stats.notion_writes} Notion writes)`;
}

/** Run the script; returns the exit code (0 no problems, 1 problems, 2 usage or unreadable file). */
export function main(argv, io = defaultIo, env = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { json: { type: 'boolean' }, style: { type: 'string' }, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
  } catch (e) {
    io.err(`transcript-check: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (parsed.values.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  if (parsed.positionals.length !== 1) {
    io.err(`transcript-check: give exactly one transcript file\n${USAGE}`);
    return EXIT.INVALID;
  }
  const file = parsed.positionals[0];
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    io.err(`transcript-check: cannot read ${file} (${e.code ?? e.message})`);
    return EXIT.INVALID;
  }
  const result = checkTranscript(text, { editorColumns: env.editorColumns ?? loadEditorColumns(), expectStyle: parsed.values.style ?? null });
  if (parsed.values.json) io.out(JSON.stringify(result, null, 2));
  else if (result.ok) io.out(`transcript-check: no problems in ${file} (${statsLine(result.stats)})`);
  else io.out([`transcript-check: ${result.problems.length} problem${result.problems.length === 1 ? '' : 's'} in ${file}`, ...result.problems.map((p) => `  - ${p}`)].join('\n'));
  return result.ok ? EXIT.OK : EXIT.ERROR;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
