// The report every script ends with, and the lint that keeps it short and plain (CONTRACTS section 9). An editor reads it between other
// tasks, so it has exactly three parts and nothing else: one sentence, an optional table, one "Next:" line. The skill prints report.md
// word for word as its whole final message, so whatever passes the lint here is what the editor sees.
//
//   buildReport({ demo, sentence, header, rows, next }) -> the checked report object (the shape of report.json); throws on a bad shape
//        demo      true: the sentence is shown with "Demo · " in front of it (default false)
//        sentence  one line, without the prefix
//        header    three strings, default ["What", "Result", ""]; the third is empty for a two-column table
//        rows      at most 5 rows of exactly 3 strings (the third is "" in a two-column table); [] or left out: no table
//        next      one line that starts with "Next: "
//   renderReport(report)  -> the Markdown of report.md: sentence, a blank line, the table, a blank line, the Next line
//   lintReport(markdown)  -> string[] of problems; [] means the report may be shown. Flags: more than three parts, a heading line, a file path
//        or script name, a run id, a duration word, a dollar sign, a JSON brace, a shorthand code, the words database, rubric and gate
//        (editors say table, rulebook and safety check), an Insight block marker, and a missing, repeated or misplaced Next line.
//        Text inside double quotes (straight or curly) is a quoted claim and is not checked for those words and characters, because a claim
//        may say "two weeks", "$2.87 million" or "G20" (the same exemption the walkthrough page lint has): put claim text in quotes.
//   writeReport(dir, report) -> builds, renders and lints; writes dir/report.json then dir/report.md; throws (code REPORT_LINT, .problems)
//        before writing anything when the lint finds a problem
//   constants: MAX_ROWS, DEMO_PREFIX, DEFAULT_HEADER

import { join } from 'node:path';
import { readJson, writeJsonAtomic, writeTextAtomic } from './jsonl.mjs';
import { codeRoot, ensureDir } from './paths.mjs';
import { validate } from './validate.mjs';

export const MAX_ROWS = 5;
export const DEMO_PREFIX = 'Demo · ';
export const DEFAULT_HEADER = Object.freeze(['What', 'Result', '']);

let schemaCache = null;
const reportSchema = () => (schemaCache ??= readJson(join(codeRoot(), 'schemas', 'report.schema.json')));

// ---- build -----------------------------------------------------------------------------------------------------------------

/** Check the parts of a report and return the object that report.json holds: { demo, sentence, header, rows, next } (header and rows only when there are rows). */
export function buildReport({ demo = false, sentence, header = DEFAULT_HEADER, rows = [], next } = {}) {
  const body = rows ?? [];
  const candidate = { demo, sentence: typeof sentence === 'string' ? sentence.trim() : sentence };
  if (!Array.isArray(body) || body.length > 0) {
    candidate.header = Array.isArray(header) ? [...header] : header;
    candidate.rows = Array.isArray(body) ? body.map((row) => (Array.isArray(row) ? [...row] : row)) : body;
  }
  candidate.next = typeof next === 'string' ? next.trim() : next;
  const { errors } = validate(reportSchema(), candidate);
  if (candidate.header && Array.isArray(candidate.header)) {
    if (typeof candidate.header[0] === 'string' && candidate.header[0].trim() === '') errors.push('$.header[0]: the first header cell must not be empty');
    if (typeof candidate.header[1] === 'string' && candidate.header[1].trim() === '') errors.push('$.header[1]: the second header cell must not be empty');
  }
  if (errors.length) throw new Error(`report: ${errors.join('; ')}`);
  return candidate;
}

// ---- render ----------------------------------------------------------------------------------------------------------------

const cell = (text) => text.replace(/\|/g, '\\|');

function renderTable(header, rows) {
  const twoColumns = header[2] === '' && rows.every((row) => row[2] === '');
  const width = twoColumns ? 2 : 3;
  const line = (cells) => `| ${cells.slice(0, width).map(cell).join(' | ')} |`;
  return [line(header), `|${'---|'.repeat(width)}`, ...rows.map(line)].join('\n');
}

/** The Markdown of report.md (ends with one newline). Builds the report first, so a bad shape throws here too. */
export function renderReport(report) {
  const r = buildReport(report);
  const sentence = r.demo && !r.sentence.startsWith(DEMO_PREFIX) ? DEMO_PREFIX + r.sentence : r.sentence;
  const parts = [sentence];
  if (r.rows) parts.push(renderTable(r.header, r.rows));
  parts.push(r.next);
  return `${parts.join('\n\n')}\n`;
}

// ---- lint ------------------------------------------------------------------------------------------------------------------

// A unit counts as a duration word when it is not part of a longer word, so "16ms" and "3 days" are found and "today" and "weekly" are not.
const DURATION = /(?<![A-Za-z])(?:minutes?|hours?|days?|weeks?|seconds?|ms)(?![A-Za-z])/gi;
const SHORTHAND = /\b(?:D|C|R|ED|O|G|LS|WT)-?\d+\b/g;
const PLAIN_WORDS = /\b(?:databases?|rubrics?|gates?)\b/gi;
const RUN_ID = /\d{8}T\d{6}Z/;
const INSIGHT = /[★✶✦☆✧]\s*Insight/u;
const HEADING = /^\s{0,3}(?:#{1,6}(?:\s|$)|={3,}\s*$|-{3,}\s*$)/;
const BACKSLASH = /\\(?!\|)/; // "\|" is how a table cell holds a pipe
const DRIVE_PATH = /\b[A-Za-z]:\//;
const QUOTED = /"[^"\n]*"|“[^”\n]*”/g; // quoted claim text: "like this" or “like this”
const LINK = /https?:\/\/[^\s)\]]+/g; // a link is an address, not prose: its slug may repeat a page title word for word ("second-run"), which is not a duration
const shown = (line) => (line.length > 60 ? `${line.slice(0, 57)}...` : line);

/** What is wrong with a report's Markdown, as plain sentences; an empty array means it may be shown. */
export function lintReport(markdown) {
  const problems = [];
  const text = String(markdown ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const parts = text.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);

  if (parts.length > 3) problems.push(`more than three parts (${parts.length}): a report is a sentence, a table and a Next line`);
  if (parts.length > 0) {
    const first = parts[0];
    if (first.startsWith('|') || first.startsWith('Next:')) problems.push('the report does not start with a sentence');
    else if (first.split('\n').length > 1) problems.push('the sentence runs over more than one line');
  }

  lines.forEach((whole, i) => {
    const at = `line ${i + 1}`;
    if (HEADING.test(whole)) problems.push(`${at} is a heading or a rule line: "${shown(whole)}"`);
    const line = whole.replace(QUOTED, '""').replace(LINK, 'https://link'); // the rest is checked without what is quoted or linked
    if (line.includes('runs/')) problems.push(`${at} names a run folder (runs/): "${shown(line)}"`);
    if (line.includes('.mjs')) problems.push(`${at} names a script file (.mjs): "${shown(line)}"`);
    if (BACKSLASH.test(line) || DRIVE_PATH.test(line)) problems.push(`${at} holds a file path: "${shown(line)}"`);
    const runId = RUN_ID.exec(line);
    if (runId) problems.push(`${at} holds a run id: ${runId[0]}`);
    for (const m of line.match(DURATION) ?? []) problems.push(`${at} holds a duration word: "${m}"`);
    if (line.includes('$')) problems.push(`${at} holds a dollar sign`);
    if (/[{}]/.test(line)) problems.push(`${at} holds a JSON brace: "${shown(line)}"`);
    for (const m of line.match(SHORTHAND) ?? []) problems.push(`${at} holds the shorthand code ${m}`);
    for (const m of line.match(PLAIN_WORDS) ?? []) problems.push(`${at} says "${m}"; editors read table, rulebook and safety check`);
    if (INSIGHT.test(line)) problems.push(`${at} holds an Insight block marker`);
  });

  const nextAt = lines.flatMap((line, i) => (line.startsWith('Next:') ? [i] : []));
  if (nextAt.length === 0) problems.push('no line starts with "Next:"');
  else {
    if (nextAt.length > 1) problems.push(`${nextAt.length} lines start with "Next:"; a report has exactly one`);
    const lastLine = lines.reduce((last, line, i) => (line.trim() === '' ? last : i), -1);
    if (nextAt[nextAt.length - 1] !== lastLine) problems.push('the Next line is not the last line');
  }
  return problems;
}

// ---- write -----------------------------------------------------------------------------------------------------------------

/** Build, render and lint a report, then write dir/report.json and dir/report.md. Nothing is written when the lint finds a problem. */
export function writeReport(dir, report) {
  const built = buildReport(report);
  const markdown = renderReport(built);
  const problems = lintReport(markdown);
  if (problems.length) {
    const error = new Error(`report.md would not pass the report lint: ${problems.join('; ')}`);
    error.code = 'REPORT_LINT';
    error.problems = problems;
    throw error;
  }
  ensureDir(dir);
  const json = join(dir, 'report.json');
  const md = join(dir, 'report.md');
  writeJsonAtomic(json, built);
  writeTextAtomic(md, markdown);
  return { json, md, markdown, report: built };
}
