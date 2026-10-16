// The practice page's Markdown template -> Notion REST block objects, the preview text, and the lint that the walkthrough's `verify` and the
// skill's evals run on the page text. Pure functions on strings and plain objects: no network, no files, nothing read from .env.
//
//   parseInline(text)                      -> rich_text array: **bold**, *italic*, `code`, [text](url); plain runs split at 2,000 characters
//   toBlocks(markdown, { values })         -> Notion block objects and marker objects, in page order (rules below)
//   splitAtMarkers(blocks)                 -> [{ blocks, marker }]: the blocks to append, then the marker to handle (null on the last segment)
//   renderPreview(markdown, values)        -> the Markdown with the text placeholders substituted; block placeholders stay as lines
//   lintPage(markdown, { manifest })       -> { ok, problems: [{ rule, line, detail }] }: the practice-page lint (rules a to m, LINT_RULES)
//   blockText(block) / countBlocks(blocks) -> plain text of one block / counts by block type, for read-back comparisons
//
// Placeholders. {{edition}}, {{date}} and any {{key}} given in `values` are text: substituted before anything else is read (a value may not
// hold a line break, so line numbers stay true, and it goes in as Markdown source). Without a value {{edition}} and {{date}} stay as text.
// Three more are block placeholders and must stand alone on their line: {{view:<Name>}} -> { marker: 'view', name }, {{tables}} ->
// { marker: 'tables' }, {{help}} -> { marker: 'help' }. Any other {{...}} is an error that names its line. The builder appends each segment
// of splitAtMarkers and then handles the marker: it creates the linked view after the last appended block, inserts the five tables, or
// inserts the help toggle. A page that has both a {{help}} line and a "## Help" section (the practice page does) gives a help marker and then
// the toggle as the last block: the segments end [... marker tables] [marker help] [toggle].
//
// Markdown subset. `# `, `## `, `### ` -> heading_1/2/3 (`#### ` and deeper -> heading_3); `- ` (or `* `) -> bulleted_list_item, an indented
// line right under it is appended to its text with a space (a nested list is an error); `1. ` -> numbered_list_item; `> ` -> quote (adjacent
// lines join); `---` -> divider; a paragraph that starts `Callout: ` -> callout with the memo icon and the rest of the text (lines under it
// that are not otherwise special stay in the callout, as separate lines); a pipe table (header row, separator row, body rows) -> table with
// table_width = the header's cell count, has_column_header true, has_row_header false and table_row children (a row with another cell count is
// an error); any other run of lines -> paragraph, its line breaks kept; blank lines separate blocks. The section that starts at the line
// `## Help` and runs to the end of the file becomes one toggle block with the rich text "Help" and the section's blocks as children (at most
// 100; a block placeholder inside it is an error). `children` sit inside the block's own object (toggle.children, table.children), as the REST
// API wants them. Every block has `object: 'block'` and `type`.
//
// Nesting. The Help toggle holds the Why wrong table, so the table rows sit two levels below the toggle. The REST API takes two levels of
// nesting in one request; tests/mvp/fixtures/fake-notion.mjs takes one, so against the fake a builder appends the toggle first and then
// its children to the toggle's id (appendBlocks).
//
// The lint reads the Markdown, the template or its preview, and reports every violation with its 1-based line:
//   a steps          "## Step 1 · ..." to "## Step 7 · ..." in order; each step holds **Goal of the step.**, **Existing status.**,
//                    **Doing the work.** and **Explaining the outputs...** in that order (as bold lead-ins, bulleted or not)
//   b tables         every pipe table has at most 4 columns, no cell over 100 characters, a separator row and balanced rows
//   c words          no banned phrase, no engineering word (whole word), none of the retired names (old view and column names, and the Agent
//                    notes prefixes "Ready" and "Fix needed" at the start of a cell)
//   d time-estimate  no number (or a, an, one, two, few ...) directly before minute(s), hour(s), day(s), week(s), second(s); "about" too
//                    ("a second" is left alone: "a second editor" is ordinary text)
//   e shorthand-code no D7, R12, C20 style code, no ED-4, no "answer 4", no G1 or G2
//   f callout        the callout's first line is the sentence on who types the four commands, exactly
//   g story-line     a line before Step 1 says the two rows were "picked for the demo"
//   h edition-line   Step 1 holds "an edition is a date plus a count"
//   i closing-lines  Step 7 ends with "What the full version adds later", three bullets, and "Archive this page by hand"
//   j help           the "## Help" section holds the two-column Why wrong table (a header and exactly four value rows: Agent slip, Rule
//                    unclear, Rule should change and (empty), the empty value), a "Words used on this page" list of exactly ten
//                    lines and an "If something stops" list of exactly three (paused, the Claude allowance, the rulebook text edited by hand)
//   k captions       with a manifest: every table in a step's `affects` has a bold caption line `**<Table>**` in that step; always: the
//                    caption `**Agent settings**` appears in Step 6 only
//   l views          exactly two {{view:...}} lines, Your queue inside Step 3 and Lessons waiting inside Step 5 (or none, the no-views
//                    fallback); the only view names are Your queue, Needs your note, Agent disagreed, Lessons waiting and Rulebook
//                    ("Decide these rows" and "Approve this change" are retired; the first three are views of the Claims table since the
//                    revision of 16 October, which added Agent disagreed to the names)
//   m tables-marker  {{tables}} appears exactly once, after Step 7 (and before the Help section)
// Text inside double quotes (straight or curly) is exempt from d and e, because a claim may say "G20" or "two weeks". A step runs from its
// heading to the next heading of level 1 or 2, the next `---` line or the {{tables}} line. A manifest is { steps: [{ n, affects: [...] }] }.

import { MAX_CHILDREN, splitRichText } from './notion-rest.mjs';

const MIDDLE_DOT = String.fromCharCode(0xb7); // the dot in "Step 1 . Meet the demo" (U+00B7)
const CALLOUT_ICON = '\u{1F4DD}'; // the memo in the callout
const TEXT_PLACEHOLDERS = new Set(['edition', 'date']);

// ---- small helpers ---------------------------------------------------------------------------------------------------------

const withoutBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const lineList = (markdown) => withoutBom(String(markdown ?? '')).replace(/\r\n?/g, '\n').split('\n'); // a byte-order mark and Windows line breaks are no part of the text
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const indentOf = (s) => (/^[ \t]*/.exec(s)[0]).replace(/\t/g, '    ').length;
const isMarker = (item) => item !== null && typeof item === 'object' && typeof item.marker === 'string';
const shown = (s, max = 60) => (s.length > max ? `${s.slice(0, max - 3)}...` : s);

function syntaxError(line, message) {
  const error = new Error(`notion-blocks: line ${line}: ${message}`);
  error.code = 'BLOCKS_SYNTAX';
  error.line = line;
  return error;
}

// ---- inline text -----------------------------------------------------------------------------------------------------------

const PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

/** Where a `*`-delimited span that opens at `from - n` closes: the index of its closing stars, or -1. Escapes and code spans are skipped. */
function findCloser(s, from, n) {
  for (let j = from; j < s.length; j += 1) {
    const c = s[j];
    if (c === '\\') {
      j += 1;
      continue;
    }
    if (c === '`') {
      const end = s.indexOf('`', j + 1);
      if (end !== -1) j = end;
      continue;
    }
    if (c !== '*') continue;
    let run = 1;
    while (s[j + run] === '*') run += 1;
    const start = j;
    j += run - 1;
    if (run < n || (n === 1 && run !== 1)) continue; // italics close on a single star only; stars in a run belong to bold
    const at = start + run - n;
    if (at <= from || /\s/.test(s[at - 1])) continue; // empty, or the closer follows a space
    return at;
  }
  return -1;
}

/** Does the `*` at s[i] open bold (**), italic (*) or both (***)? { from, to, end, fmt } for the span, or null (the star is then plain text). */
function matchEmphasis(s, i) {
  let run = 1;
  while (s[i + run] === '*') run += 1;
  const n = Math.min(run, 3);
  const from = i + n;
  if (from >= s.length || /\s/.test(s[from])) return null;
  const at = findCloser(s, from, n);
  if (at === -1) return null;
  const fmt = n === 3 ? { bold: true, italic: true } : n === 2 ? { bold: true } : { italic: true };
  return { from, to: at, end: at + n, fmt };
}

/** `[label](url)` that opens at s[open]: { label, url, end } or null. The label may nest brackets, the address balanced parentheses. */
function matchLink(s, open) {
  let depth = 0;
  let j = open;
  for (; j < s.length; j += 1) {
    const c = s[j];
    if (c === '\\') {
      j += 1;
      continue;
    }
    if (c === '`') {
      const end = s.indexOf('`', j + 1);
      if (end !== -1) j = end;
      continue;
    }
    if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (j >= s.length || s[j + 1] !== '(') return null;
  const label = s.slice(open + 1, j);
  if (label.trim() === '') return null;
  let k = j + 2;
  let parens = 1;
  for (; k < s.length; k += 1) {
    const c = s[k];
    if (c === '\\') {
      k += 1;
      continue;
    }
    if (c === '(') parens += 1;
    else if (c === ')') {
      parens -= 1;
      if (parens === 0) break;
    }
  }
  if (k >= s.length) return null;
  const url = s.slice(j + 2, k).trim().split(/\s+/)[0]; // a title after the address is ignored
  if (!url) return null;
  return { label, url, end: k + 1 };
}

/** Appends the runs of `s` (each { text, bold?, italic?, code?, link? }) to `out`; `fmt` is what the enclosing spans already set. */
function inline(s, fmt, out) {
  let plain = '';
  const flush = () => {
    if (plain !== '') out.push({ text: plain, ...fmt });
    plain = '';
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && PUNCTUATION.includes(s[i + 1])) {
      plain += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ text: s.slice(i + 1, end), ...fmt, code: true });
        i = end + 1;
        continue;
      }
    }
    if (c === '[' && fmt.link === undefined) {
      const link = matchLink(s, i);
      if (link) {
        flush();
        inline(link.label, { ...fmt, link: link.url }, out);
        i = link.end;
        continue;
      }
    }
    if (c === '*') {
      const em = matchEmphasis(s, i);
      if (em) {
        flush();
        inline(s.slice(em.from, em.to), { ...fmt, ...em.fmt }, out);
        i = em.end;
        continue;
      }
    }
    plain += c;
    i += 1;
  }
  flush();
}

const sameFormat = (a, b) => a.bold === b.bold && a.italic === b.italic && a.code === b.code && a.link === b.link;

/** Merge neighbouring runs with the same format, cut each at 2,000 characters (splitRichText) and give each piece its Notion shape. */
function richTextOf(runs) {
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && sameFormat(last, run)) last.text += run.text;
    else merged.push({ ...run });
  }
  const out = [];
  for (const run of merged) {
    const annotations = {};
    if (run.bold) annotations.bold = true;
    if (run.italic) annotations.italic = true;
    if (run.code) annotations.code = true;
    for (const piece of splitRichText(run.text)) {
      const item = { type: 'text', text: { content: piece.text.content } };
      if (run.link) item.text.link = { url: run.link };
      if (Object.keys(annotations).length > 0) item.annotations = { ...annotations };
      out.push(item);
    }
  }
  return out;
}

/**
 * Inline Markdown to a Notion rich_text array. **bold**, *italic*, ***both***, `code`, [text](url) (the text may be bold or italic); a
 * backslash before punctuation gives that character as plain text; a marker that is not closed stays as text. A plain run is the same
 * { type: 'text', text: { content } } that splitRichText gives, a styled run adds `annotations` with only the flags that are on, a link
 * adds text.link. No object holds more than 2,000 characters. {{edition}} and {{date}} are ordinary text here.
 */
export function parseInline(text) {
  const runs = [];
  inline(String(text ?? ''), {}, runs);
  return richTextOf(runs);
}

// ---- Markdown to blocks ----------------------------------------------------------------------------------------------------

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const WHOLE_PLACEHOLDER = /^\s*\{\{([^{}]*)\}\}\s*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(\S.*?)[ \t]*$/;
const DIVIDER = /^ {0,3}-{3,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const BULLET = /^([ \t]*)[-*+][ \t]+(\S.*?)[ \t]*$/;
const NUMBERED = /^([ \t]*)\d{1,9}[.)][ \t]+(\S.*?)[ \t]*$/;
const CALLOUT = /^Callout:[ \t]+(\S.*?)[ \t]*$/;
const TABLE_ROW = /^[ \t]*\|/;
const HELP_HEADING = /^##[ \t]+Help[ \t]*$/;

/** The marker object for the key of a block placeholder ("tables", "help", "view:<Name>"), or null for any other key. */
function markerOf(key, line) {
  if (key === 'tables') return { marker: 'tables' };
  if (key === 'help') return { marker: 'help' };
  if (key.startsWith('view:')) {
    const name = key.slice('view:'.length).trim();
    if (name === '') throw syntaxError(line, 'the placeholder {{view:}} names no view');
    return { marker: 'view', name };
  }
  return null;
}

const markerText = (m) => (m.marker === 'view' ? `{{view:${m.name}}}` : `{{${m.marker}}}`);

function checkValues(values) {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('values must be an object of placeholder values');
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && /[\r\n]/.test(String(value))) throw new TypeError(`values.${key} must not hold a line break`);
  }
}

/** One source line: { n, marker } for a block placeholder on its own, else { n, text } with the text placeholders substituted. */
function prepareLine(raw, n, values) {
  const whole = WHOLE_PLACEHOLDER.exec(raw);
  if (whole) {
    const marker = markerOf(whole[1].trim(), n);
    if (marker) return { n, marker };
  }
  const text = raw.replace(PLACEHOLDER, (all, inner) => {
    const key = inner.trim();
    const value = Object.hasOwn(values, key) ? values[key] : undefined;
    if (value !== undefined && value !== null) return String(value);
    if (TEXT_PLACEHOLDERS.has(key)) return all;
    if (markerOf(key, n)) throw syntaxError(n, `${all} marks a place on the page and has to stand alone on its line`);
    throw syntaxError(n, `unknown placeholder ${all} (known: {{edition}}, {{date}}, {{tables}}, {{help}}, {{view:<Name>}} and the keys given in values)`);
  });
  return { n, text };
}

const block = (type, payload) => ({ object: 'block', type, [type]: payload });

/** The cells of a pipe-table row: the outer pipes dropped, split on pipes that are not escaped, trimmed. */
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

const isSeparator = (line) => TABLE_ROW.test(line) && splitRow(line).every((cell) => /^:?-+:?$/.test(cell));

/** Read the table that starts at entries[start]: { block, next } where `next` is the index of the first entry after it. */
function readTable(entries, start) {
  const head = entries[start];
  const header = splitRow(head.text);
  const sep = entries[start + 1];
  if (!sep || sep.marker || !isSeparator(sep.text)) throw syntaxError(head.n, 'a table needs a separator row ("| --- | --- |") right under its header row');
  const sepCells = splitRow(sep.text).length;
  if (sepCells !== header.length) throw syntaxError(sep.n, `the separator row has ${sepCells} cells but the header row has ${header.length}`);
  const rows = [header];
  let k = start + 2;
  for (; k < entries.length; k += 1) {
    const e = entries[k];
    if (e.marker || !TABLE_ROW.test(e.text)) break;
    const cells = splitRow(e.text);
    if (cells.length !== header.length) throw syntaxError(e.n, `this table row has ${cells.length} cells but the header row has ${header.length}`);
    rows.push(cells);
  }
  const children = rows.map((cells) => block('table_row', { cells: cells.map((cell) => parseInline(cell)) }));
  return { block: block('table', { table_width: header.length, has_column_header: true, has_row_header: false, children }), next: k };
}

/** The block for a run of lines that is finished. */
function finish(open) {
  switch (open.kind) {
    case 'callout':
      return block('callout', { rich_text: parseInline(open.lines.join('\n')), icon: { type: 'emoji', emoji: CALLOUT_ICON } });
    case 'quote':
      return block('quote', { rich_text: parseInline(open.lines.join('\n')) });
    case 'item':
      return block(open.type, { rich_text: parseInline(open.text) });
    default:
      return block('paragraph', { rich_text: parseInline(open.lines.join('\n')) });
  }
}

/** Prepared lines to blocks and markers. `inHelp`: the lines are the Help section's, where a block placeholder is an error. */
function convert(entries, inHelp) {
  const out = [];
  let open = null;
  const close = () => {
    if (open !== null) out.push(finish(open));
    open = null;
  };
  for (let k = 0; k < entries.length; k += 1) {
    const e = entries[k];
    if (e.marker) {
      close();
      if (inHelp) throw syntaxError(e.n, `${markerText(e.marker)} cannot sit inside the Help section; the Help toggle holds blocks only`);
      out.push({ ...e.marker });
      continue;
    }
    const text = e.text;
    if (text.trim() === '') {
      close();
      continue;
    }
    if (TABLE_ROW.test(text)) {
      close();
      const table = readTable(entries, k);
      out.push(table.block);
      k = table.next - 1;
      continue;
    }
    let m = HEADING.exec(text);
    if (m) {
      close();
      out.push(block(`heading_${Math.min(m[1].length, 3)}`, { rich_text: parseInline(m[2]) }));
      continue;
    }
    if (DIVIDER.test(text)) {
      close();
      out.push(block('divider', {}));
      continue;
    }
    m = QUOTE.exec(text);
    if (m) {
      if (open?.kind === 'quote') open.lines.push(m[1].trim());
      else {
        close();
        open = { kind: 'quote', lines: [m[1].trim()] };
      }
      continue;
    }
    m = BULLET.exec(text);
    const numbered = m ? null : NUMBERED.exec(text);
    if (m || numbered) {
      const hit = m ?? numbered;
      if (open?.kind === 'item' && indentOf(hit[1]) >= 2) throw syntaxError(e.n, 'a nested list is not supported; make the sub-item a bullet of its own or part of the sentence');
      close();
      open = { kind: 'item', type: m ? 'bulleted_list_item' : 'numbered_list_item', text: hit[2] };
      continue;
    }
    m = CALLOUT.exec(text);
    if (m) {
      close();
      open = { kind: 'callout', lines: [m[1]] };
      continue;
    }
    if (open?.kind === 'item' && /^[ \t]/.test(text)) {
      open.text += ` ${text.trim()}`; // an indented line under a list item continues it
      continue;
    }
    if (open?.kind === 'paragraph' || open?.kind === 'callout') {
      open.lines.push(text.trim());
      continue;
    }
    close();
    open = { kind: 'paragraph', lines: [text.trim()] };
  }
  close();
  return out;
}

/**
 * The page template as Notion block objects and marker objects, in page order (see the header for the rules). `values` fills {{key}} text
 * placeholders. Throws an Error ('BLOCKS_SYNTAX', with .line) that names the line of an unbalanced table row, a table without a separator
 * row, an unknown placeholder, a block placeholder that is not alone on its line or sits in the Help section, or a nested list.
 */
export function toBlocks(markdown, options) {
  const values = options?.values ?? {};
  checkValues(values);
  const entries = lineList(markdown).map((raw, k) => prepareLine(raw, k + 1, values));
  const helpAt = entries.findIndex((e) => e.text !== undefined && HELP_HEADING.test(e.text));
  if (helpAt === -1) return convert(entries, false);
  const top = convert(entries.slice(0, helpAt), false);
  const children = convert(entries.slice(helpAt + 1), true);
  if (children.length > MAX_CHILDREN) throw syntaxError(entries[helpAt].n, `the Help section has ${children.length} blocks; a toggle holds at most ${MAX_CHILDREN}`);
  top.push(block('toggle', { rich_text: parseInline('Help'), ...(children.length > 0 ? { children } : {}) }));
  return top;
}

/**
 * Cut the output of toBlocks at its markers: [{ blocks, marker }] in order. A segment holds the blocks that come before its marker (none
 * when two markers meet); the last segment has marker null and is left out when nothing follows the last marker.
 */
export function splitAtMarkers(blocks) {
  const segments = [];
  let current = [];
  for (const item of blocks ?? []) {
    if (isMarker(item)) {
      segments.push({ blocks: current, marker: item });
      current = [];
    } else current.push(item);
  }
  if (current.length > 0) segments.push({ blocks: current, marker: null });
  return segments;
}

/** The template with {{edition}}, {{date}} and the keys of `values` substituted; block placeholders stay on their lines. Unknown placeholders throw like toBlocks. */
export function renderPreview(markdown, values = {}) {
  const vals = values ?? {};
  checkValues(vals);
  return lineList(markdown)
    .map((raw, k) => {
      const prepared = prepareLine(raw, k + 1, vals);
      return prepared.marker ? raw : prepared.text;
    })
    .join('\n');
}

// ---- read-back helpers -----------------------------------------------------------------------------------------------------

const plainOf = (richText) => (Array.isArray(richText) ? richText.map((r) => r?.plain_text ?? r?.text?.content ?? r?.equation?.expression ?? '').join('') : '');

/**
 * The plain text of one block, from the objects toBlocks makes and from the blocks the API reads back (plain_text is used when present): its
 * own rich text; a table_row's cells joined with " | "; a table's rows joined with a line break (when they are present); a marker's placeholder.
 * A toggle gives its own title only, so compare its children one by one.
 */
export function blockText(item) {
  if (item === null || typeof item !== 'object') return '';
  if (isMarker(item)) return markerText(item);
  const payload = item[item.type];
  if (payload === null || typeof payload !== 'object') return '';
  if (item.type === 'table_row') return (payload.cells ?? []).map(plainOf).join(' | ');
  if (item.type === 'table') return (payload.children ?? []).map(blockText).join('\n');
  if (typeof payload.title === 'string') return payload.title;
  return plainOf(payload.rich_text);
}

/** Counts by block type, nested children (table rows, toggle contents) included: { paragraph: 12, table: 6, table_row: 21, ... }. A marker counts as "marker:<kind>". */
export function countBlocks(blocks) {
  const counts = {};
  const walk = (list) => {
    for (const item of Array.isArray(list) ? list : []) {
      if (item === null || typeof item !== 'object') continue;
      const key = isMarker(item) ? `marker:${item.marker}` : item.type;
      if (typeof key !== 'string') continue;
      counts[key] = (counts[key] ?? 0) + 1;
      const kids = typeof item.type === 'string' ? item[item.type]?.children : undefined;
      if (Array.isArray(kids)) walk(kids);
    }
  };
  walk(blocks);
  return counts;
}

// ---- the lint --------------------------------------------------------------------------------------------------------------

/** The lint rules by letter: the `rule` of a problem is one of these keys. */
export const LINT_RULES = Object.freeze({
  a: 'steps',
  b: 'tables',
  c: 'words',
  d: 'time-estimate',
  e: 'shorthand-code',
  f: 'callout',
  g: 'story-line',
  h: 'edition-line',
  i: 'closing-lines',
  j: 'help',
  k: 'captions',
  l: 'views',
  m: 'tables-marker',
});

const CALLOUT_LINE = 'You type four commands yourself (status, tag, distill and promote); the follow-up runs by itself after a PASS, and the engineer sets things up and fixes what breaks.';
const SUB_HEADINGS = Object.freeze([
  { mark: '**Goal of the step.**', show: '**Goal of the step.**' },
  { mark: '**Existing status.**', show: '**Existing status.**' },
  { mark: '**Doing the work.**', show: '**Doing the work.**' },
  { mark: '**Explaining the outputs', show: '**Explaining the outputs.**' },
]);
const BANNED_PHRASES = Object.freeze(['leave these', 'leave them', 'undecided', 'may differ', 'most likely', 'column guide', 'copy this', 'you can ignore', 'note its']);
const ENGINEERING_WORDS = /\b(?:gates?|rubrics?|canary|canaries|regressions?|databases?|subagents?|apis?|mirrors?|sandbox(?:es)?)\b/gi;
const RETIRED = Object.freeze([
  { name: 'Decide these rows', use: 'Your queue', kind: 'view' },
  { name: 'Approve this change', use: 'Lessons waiting', kind: 'view' },
  { name: 'Gate result', use: 'Safety check result', kind: 'column' },
  { name: 'Rubric in force', use: 'Rulebook edition', kind: 'column' },
].map((r) => ({ ...r, rx: new RegExp(`\\b${escapeRegExp(r.name)}\\b`, 'gi') })));
const BANNED_RX = BANNED_PHRASES.map((phrase) => ({ phrase, rx: new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi') }));
const NOTE_PREFIX = /^(?:Ready|Fix needed)\b/;
const VIEW_NAMES = Object.freeze(['Your queue', 'Needs your note', 'Agent disagreed', 'Lessons waiting', 'Rulebook']);
const PLACED_VIEWS = Object.freeze({ 'Your queue': 3, 'Lessons waiting': 5 });

const NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|few|several|couple(?:[ \\t]+of)?';
const TIME_ESTIMATE = new RegExp(`(?<![\\w.-])(?:about[ \\t]+)?(?:(\\d+(?:[.,]\\d+)?)|(an?)|(${NUMBER_WORDS}))[ \\t-]+(minutes?|hours?|days?|weeks?|seconds?)\\b`, 'gi');
const TIME_SHORT = /(?<![\w.-])\d+[ \t]*(?:mins?|hrs?|secs?|wks?)\b/gi;
const SHORTHAND = [/\b[DRCHOP]\d+\b/g, /\bED-?\d+\b/g, /\banswers? \d+\b/gi, /\bG[12]\b/g];
const LEFT_QUOTE = String.fromCharCode(0x201c);
const RIGHT_QUOTE = String.fromCharCode(0x201d);
const QUOTED = new RegExp('"[^"\\n]*"|' + LEFT_QUOTE + '[^' + RIGHT_QUOTE + '\\n]*' + RIGHT_QUOTE, 'g'); // quoted claim text: "like this" or in curly quotes

const STEP_HEADING = /^(#{1,6})[ \t]+Step[ \t]+(\d+)\b(.*)$/;
const SECTION_END = /^(?:#{1,2}[ \t]|[ \t]*-{3,}[ \t]*$|[ \t]*\{\{\s*tables\s*\}\}[ \t]*$)/;
const TABLES_LINE = /^[ \t]*\{\{\s*tables\s*\}\}[ \t]*$/;
const VIEW_PLACEHOLDER = /\{\{\s*view:([^{}]*)\}\}/g;
const subHeadingRx = (mark) => new RegExp(`^[ \\t]*(?:(?:[-*+]|\\d+[.)])[ \\t]+)?${escapeRegExp(mark)}`);
const captionRx = (name) => new RegExp(`^[ \\t]*\\*\\*${escapeRegExp(name)}\\*\\*`);
const plainCell = (s) => String(s ?? '').replace(/[*_`]/g, '').trim();

/** The step headings, checked: [{ n, line, start, end, rest }]. A step runs from its heading to the next level 1 or 2 heading, `---` or {{tables}}. */
function findSteps(lines, add) {
  const heads = [];
  lines.forEach((text, i) => {
    const m = STEP_HEADING.exec(text);
    if (!m) return;
    if (m[1].length !== 2) {
      add('a', i + 1, `"Step ${m[2]}" has to be a level-2 heading ("## Step ${m[2]} ${MIDDLE_DOT} <title>")`);
      return;
    }
    heads.push({ n: Number(m[2]), line: i + 1, start: i, rest: m[3] });
  });
  const titled = new RegExp(`^[ \\t]*${MIDDLE_DOT}[ \\t]+\\S`);
  let expected = 1;
  for (const h of heads) {
    if (h.n !== expected) add('a', h.line, `expected the heading "Step ${expected}" here, found "Step ${h.n}"`);
    expected = h.n + 1;
    if (!titled.test(h.rest)) add('a', h.line, `the heading should read "Step ${h.n} ${MIDDLE_DOT} <title>"`);
    let end = lines.length;
    for (let j = h.start + 1; j < lines.length; j += 1) {
      if (SECTION_END.test(lines[j])) {
        end = j;
        break;
      }
    }
    h.end = end;
  }
  if (heads.length === 0) add('a', 1, `the page has no "## Step 1 ${MIDDLE_DOT} <title>" heading`);
  else if (expected <= 7) add('a', heads[heads.length - 1].line, expected === 7 ? 'Step 7 is missing' : `Step ${expected} to Step 7 are missing`);
  return heads;
}

/** Rule a, second half: the four sub-headings of every step, once each, in order. */
function checkSubHeadings(lines, steps, add) {
  for (const step of steps) {
    const found = SUB_HEADINGS.map((sub) => {
      const rx = subHeadingRx(sub.mark);
      const at = [];
      for (let i = step.start + 1; i < step.end; i += 1) if (rx.test(lines[i])) at.push(i);
      return at;
    });
    SUB_HEADINGS.forEach((sub, k) => {
      if (found[k].length === 0) add('a', step.line, `Step ${step.n} has no ${sub.show} line`);
      for (const again of found[k].slice(1)) add('a', again + 1, `${sub.show} appears more than once in Step ${step.n}`);
    });
    const present = found.map((at, k) => ({ k, first: at[0] })).filter((p) => p.first !== undefined);
    const byPosition = [...present].sort((x, y) => x.first - y.first);
    const wrong = byPosition.findIndex((p, k) => p.k !== present[k].k);
    if (wrong !== -1) {
      const names = byPosition.map((p) => SUB_HEADINGS[p.k].show).join(', ');
      add('a', byPosition[wrong].first + 1, `the sub-headings of Step ${step.n} are out of order (${names}); they go Goal of the step, Existing status, Doing the work, Explaining the outputs`);
    }
  }
}

/** Every pipe table: { line, header, rows: [{ line, cells }], separator, separatorCells }. A header row without a separator row under it is a table with `separator: false`. */
function findTables(lines) {
  const tables = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!TABLE_ROW.test(lines[i])) continue;
    const header = splitRow(lines[i]);
    const table = { line: i + 1, header, rows: [{ line: i + 1, cells: header }], separator: false };
    let j = i + 1;
    if (j < lines.length && isSeparator(lines[j])) {
      table.separator = true;
      table.separatorCells = splitRow(lines[j]).length;
      j += 1;
    }
    for (; j < lines.length && TABLE_ROW.test(lines[j]); j += 1) {
      if (table.separator) table.rows.push({ line: j + 1, cells: splitRow(lines[j]) });
    }
    tables.push(table);
    i = j - 1;
  }
  return tables;
}

/** Rule b. */
function checkTables(tables, add) {
  for (const table of tables) {
    if (!table.separator) {
      add('b', table.line, 'a table needs a separator row ("| --- | --- |") right under its header row');
      continue;
    }
    if (table.header.length > 4) add('b', table.line, `the table has ${table.header.length} columns; at most 4`);
    if (table.separatorCells !== table.header.length) add('b', table.line + 1, `the separator row has ${table.separatorCells} cells but the header has ${table.header.length}`);
    for (const row of table.rows) {
      if (row.cells.length !== table.header.length) add('b', row.line, `this row has ${row.cells.length} cells but the header has ${table.header.length}`);
      for (const cell of row.cells) {
        const length = [...cell.replace(/\\\|/g, '|')].length;
        if (length > 100) add('b', row.line, `a cell has ${length} characters; at most 100 ("${shown(cell, 40)}")`);
      }
    }
  }
}

/** Rule c: banned phrases, engineering words, retired names, and the Agent notes prefixes at the start of a cell. */
function checkWords(lines, add) {
  lines.forEach((text, i) => {
    const line = i + 1;
    const retired = [];
    for (const r of RETIRED) {
      for (const m of text.matchAll(r.rx)) {
        retired.push([m.index, m.index + m[0].length]);
        add('c', line, `retired name "${m[0]}"; the ${r.kind} is now called ${r.use}`);
      }
    }
    const covered = (from, to) => retired.some(([a, b]) => from >= a && to <= b); // "Gate result" is one problem, not two
    for (const { phrase, rx } of BANNED_RX) {
      for (const m of text.matchAll(rx)) if (!covered(m.index, m.index + m[0].length)) add('c', line, `banned phrase "${phrase}"`);
    }
    for (const m of text.matchAll(ENGINEERING_WORDS)) {
      if (!covered(m.index, m.index + m[0].length)) add('c', line, `engineering word "${m[0]}"; the editor's words are rulebook, edition, safety check, example claim and table`);
    }
    if (TABLE_ROW.test(text)) {
      for (const cell of splitRow(text)) {
        const m = NOTE_PREFIX.exec(cell);
        if (m) add('c', line, `a cell starts with "${m[0]}", a retired prefix of Agent notes`);
      }
    }
  });
}

/** Rules d and e, on every line without the text inside double quotes. */
function checkNumbers(lines, add) {
  lines.forEach((text, i) => {
    const line = i + 1;
    const bare = text.replace(QUOTED, '""');
    for (const m of bare.matchAll(TIME_ESTIMATE)) {
      if (m[2] && /^second$/i.test(m[4])) continue; // "a second editor" is not a time
      add('d', line, `time estimate "${m[0]}"; say "a short wait" instead`);
    }
    for (const m of bare.matchAll(TIME_SHORT)) add('d', line, `time estimate "${m[0]}"; say "a short wait" instead`);
    for (const rx of SHORTHAND) {
      for (const m of bare.matchAll(rx)) add('e', line, `shorthand code "${m[0]}"; say the thing in words`);
    }
  });
}

/** Rule f. */
function checkCallout(lines, add) {
  const at = lines.findIndex((text) => /^Callout:[ \t]/.test(text));
  if (at === -1) {
    add('f', 1, 'the page has no callout (a "Callout: ..." line at the top)');
    return;
  }
  const first = lines[at].replace(/^Callout:[ \t]+/, '').trimEnd();
  if (first !== CALLOUT_LINE) add('f', at + 1, `the callout's first line has to be exactly: ${CALLOUT_LINE}`);
}

/** Rule g: a line before Step 1 says why the two rows wait. */
function checkStory(lines, steps, add) {
  const before = steps.length > 0 ? steps[0].start : lines.length;
  const found = lines.slice(0, before).some((text) => /picked for the demo/i.test(text));
  if (!found) add('g', steps.length > 0 ? steps[0].line : 1, 'no line under the story says why the two rows wait; it should say they were "picked for the demo"');
}

/** Rule h: Step 1 explains an edition. */
function checkEdition(lines, steps, add) {
  const step = steps.find((s) => s.n === 1);
  if (!step) return; // rule a reports the missing step
  const found = lines.slice(step.start + 1, step.end).some((text) => /an edition is a date plus a count/i.test(text));
  if (!found) add('h', step.line, 'Step 1 does not explain an edition ("an edition is a date plus a count")');
}

/** Rule i: Step 7 ends with the label, three bullets and the archive line. */
function checkClosing(lines, steps, add) {
  const step = steps.find((s) => s.n === 7);
  if (!step) return;
  const filled = [];
  for (let i = step.start + 1; i < step.end; i += 1) if (lines[i].trim() !== '') filled.push(i);
  const last = (rx) => filled.findLast((i) => rx.test(lines[i]));
  const labelAt = last(/what the full version adds later/i);
  const archiveAt = last(/archive this page by hand/i);
  if (labelAt === undefined) add('i', step.line, 'Step 7 has no "What the full version adds later" line');
  if (archiveAt === undefined) add('i', step.line, 'Step 7 has no "Archive this page by hand" line');
  if (labelAt !== undefined) {
    const stop = archiveAt !== undefined && archiveAt > labelAt ? archiveAt : step.end;
    const bullets = filled.filter((i) => i > labelAt && i < stop && BULLET.test(lines[i]) && indentOf(lines[i]) < 2).length;
    if (bullets !== 3) add('i', labelAt + 1, `"What the full version adds later" has ${bullets} bullet lines; it needs exactly three`);
  }
  if (archiveAt !== undefined) {
    if (labelAt !== undefined && archiveAt < labelAt) add('i', archiveAt + 1, 'the "Archive this page by hand" line comes before "What the full version adds later"');
    const after = filled.find((i) => i > archiveAt);
    if (after !== undefined) add('i', after + 1, 'Step 7 has to end with the "Archive this page by hand" line');
  }
}

/** How many top-level bullet lines follow the label at lines[at] (blank lines between bullets are allowed, indented lines continue a bullet). */
function bulletsAfter(lines, at) {
  let count = 0;
  for (let i = at + 1; i < lines.length; i += 1) {
    const text = lines[i];
    if (text.trim() === '') continue;
    if (BULLET.test(text) && indentOf(text) < 2) {
      count += 1;
      continue;
    }
    if (count > 0 && /^[ \t]+\S/.test(text)) continue;
    break;
  }
  return count;
}

/** Rule j. */
function checkHelp(lines, helpAt, tables, add) {
  if (helpAt === -1) {
    add('j', 1, 'the page has no "## Help" section');
    return;
  }
  const why = tables.find((t) => t.line - 1 > helpAt && plainCell(t.header[0]).toLowerCase() === 'why wrong');
  if (!why) add('j', helpAt + 1, 'the Help section has no "Why wrong" table');
  else {
    const body = why.rows.slice(1);
    if (why.header.length !== 2) add('j', why.line, `the Why wrong table has ${why.header.length} columns; it has exactly two`);
    if (body.length !== 4) add('j', why.line, `the Why wrong table has ${body.length} value rows; it has exactly four`);
    const values = ['Agent slip', 'Rule unclear', 'Rule should change', '(empty)'];
    body.slice(0, 4).forEach((row, k) => {
      if (plainCell(row.cells[0]) !== values[k]) add('j', row.line, `row ${k + 1} of the Why wrong table should be "${values[k]}"`);
    });
  }
  for (const [label, count, name] of [['words used on this page', 10, 'words list'], ['if something stops', 3, '"If something stops" list']]) {
    const at = lines.findIndex((text, i) => i > helpAt && text.toLowerCase().includes(label));
    if (at === -1) {
      add('j', helpAt + 1, `the Help section has no "${label.charAt(0).toUpperCase()}${label.slice(1)}" label above the ${name}`);
      continue;
    }
    const found = bulletsAfter(lines, at);
    if (found !== count) add('j', at + 1, `the ${name} has ${found} lines; it has exactly ${count}`);
  }
}

/** Rule k. */
function checkCaptions(lines, steps, manifest, add) {
  const agent = captionRx('Agent settings');
  for (const step of steps) {
    if (step.n === 6) continue;
    for (let i = step.start + 1; i < step.end; i += 1) {
      if (agent.test(lines[i])) add('k', i + 1, `the caption **Agent settings** belongs in Step 6 only, not in Step ${step.n}`);
    }
  }
  if (manifest === undefined || manifest === null) return;
  if (typeof manifest !== 'object' || !Array.isArray(manifest.steps)) {
    add('k', 1, 'the manifest has no steps list, so the captions could not be checked');
    return;
  }
  manifest.steps.forEach((spec, k) => {
    const n = Number.isInteger(spec?.n) ? spec.n : k + 1;
    const step = steps.find((s) => s.n === n);
    if (!step) {
      // Step 1 to 7 missing from the page is rule a's business; a step the page cannot have is the manifest's mistake, and says so.
      if (!(n >= 1 && n <= 7)) add('k', 1, `the manifest lists a Step ${n}, but the page has Step 1 to Step 7 only, so its captions could not be checked`);
      return;
    }
    for (const table of Array.isArray(spec?.affects) ? spec.affects : []) {
      if (typeof table !== 'string') continue;
      const rx = captionRx(table);
      let seen = false;
      for (let i = step.start + 1; i < step.end && !seen; i += 1) seen = rx.test(lines[i]);
      if (!seen) add('k', step.line, `Step ${n} affects ${table} but has no **${table}** caption`);
    }
  });
}

/** Rule l. */
function checkViews(lines, steps, add) {
  const stepAt = (index) => steps.find((s) => index >= s.start && index < s.end)?.n ?? null;
  const placed = [];
  lines.forEach((text, i) => {
    for (const m of text.matchAll(VIEW_PLACEHOLDER)) placed.push({ name: m[1].trim(), line: i + 1, step: stepAt(i) });
  });
  for (const p of placed) {
    const retired = RETIRED.find((r) => r.kind === 'view' && r.name.toLowerCase() === p.name.toLowerCase());
    if (retired) add('l', p.line, `{{view:${p.name}}} is a retired view name; the view is now called ${retired.use}`);
    else if (!VIEW_NAMES.includes(p.name)) add('l', p.line, `{{view:${p.name}}} is not one of the five view names (${VIEW_NAMES.join(', ')})`);
    else if (PLACED_VIEWS[p.name] === undefined) add('l', p.line, `{{view:${p.name}}} is not placed on the page; only Your queue (Step 3) and Lessons waiting (Step 5) are`);
    else if (p.step !== PLACED_VIEWS[p.name]) {
      add('l', p.line, `{{view:${p.name}}} sits ${p.step === null ? 'outside the steps' : `in Step ${p.step}`}; it belongs inside Step ${PLACED_VIEWS[p.name]}`);
    }
  }
  if (placed.length > 0) {
    for (const name of Object.keys(PLACED_VIEWS)) {
      const mine = placed.filter((p) => p.name === name);
      if (mine.length === 0) add('l', placed[0].line, `{{view:${name}}} is missing; the page has both linked views or none`);
      for (const extra of mine.slice(1)) add('l', extra.line, `{{view:${name}}} appears more than once`);
    }
  }
  lines.forEach((text, i) => {
    if (/\{\{\s*view:/.test(text)) return; // a placeholder was judged above
    for (const r of RETIRED) {
      if (r.kind !== 'view') continue;
      for (const m of text.matchAll(r.rx)) add('l', i + 1, `retired view name "${m[0]}"; the view is now called ${r.use}`);
    }
  });
}

/** Rule m. */
function checkTablesMarker(lines, steps, helpAt, add) {
  const step7 = steps.find((s) => s.n === 7);
  const alone = [];
  lines.forEach((text, i) => {
    if (TABLES_LINE.test(text)) alone.push(i);
    else if (/\{\{\s*tables\s*\}\}/.test(text)) add('m', i + 1, '{{tables}} has to stand alone on its line');
  });
  if (alone.length === 0) add('m', step7 ? step7.line : 1, '{{tables}} is missing; it goes once, after Step 7');
  for (const extra of alone.slice(1)) add('m', extra + 1, '{{tables}} appears more than once');
  const first = alone[0];
  if (first === undefined) return;
  if (step7 && first < step7.start) add('m', first + 1, '{{tables}} comes before Step 7; it goes after Step 7');
  if (helpAt !== -1 && first > helpAt) add('m', first + 1, '{{tables}} sits inside the Help section; it goes between Step 7 and the Help section');
}

/**
 * The practice-page lint, rules a to m of the header (LINT_RULES names them). `markdown` is the template or its preview. `manifest` is
 * optional ({ steps: [{ n, affects: [...] }] }); without it rule k checks only that **Agent settings** is a caption of Step 6 alone.
 * Returns { ok, problems: [{ rule, line, detail }] } with every violation, sorted by line.
 */
export function lintPage(markdown, options) {
  const manifest = options?.manifest;
  const lines = lineList(markdown);
  const found = [];
  const add = (rule, line, detail) => found.push({ rule, line: Math.max(1, line), detail });
  const steps = findSteps(lines, add);
  const helpAt = lines.findIndex((text) => HELP_HEADING.test(text));
  const tables = findTables(lines);

  checkSubHeadings(lines, steps, add);
  checkTables(tables, add);
  checkWords(lines, add);
  checkNumbers(lines, add);
  checkCallout(lines, add);
  checkStory(lines, steps, add);
  checkEdition(lines, steps, add);
  checkClosing(lines, steps, add);
  checkHelp(lines, helpAt, tables, add);
  checkCaptions(lines, steps, manifest, add);
  checkViews(lines, steps, add);
  checkTablesMarker(lines, steps, helpAt, add);

  const problems = found.sort((x, y) => x.line - y.line || (x.rule < y.rule ? -1 : x.rule > y.rule ? 1 : 0)); // a stable sort: same line and rule keep their order
  return { ok: problems.length === 0, problems };
}
