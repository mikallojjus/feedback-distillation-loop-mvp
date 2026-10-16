// The REST structure builder: reads the approved structure proposal (docs/mvp-2026-11/STRUCTURE.md) into a structure object, turns it into
// the requests that build it under the parent page (sub-pages, five tables, four views), runs those requests resumably, and reads
// everything back to compare with the structure. Nothing here prints, reads .env or deletes anything: the client it is given sends GET, POST and
// PATCH only (lib/notion-rest.mjs), and every id the builder learns is recorded at once (runs/builder/*.json and config.json), so a run that
// stops halfway is finished by running it again.
//
//   structureFromProposal(markdown)            -> { tables: { rulebook|claims_copy|tag_decisions|rule_changes|agent_settings: { title, columns: [{ name, type, options, description, relation_to? }] } },
//                                                   views: [{ name, table, filter, sort, columns, wrap, renamed_from? }], pages: ["Demos", "Demo tests"] }
//                                                  Throws StructureError (exit 2) naming the table and column when a type word is unknown, a table
//                                                  section or a "Values:" list is missing, or a view cannot be read. (The approved text of the proposal has no relation
//                                                  column and no renamed view; the revision of 16 October is written into setup/structure.json directly.)
//                                                  A relation column names the table it points at in relation_to; a view that was another view of the same table under an
//                                                  older name says so in renamed_from, and the builder renames that view instead of making a new one.
//   validateStructure(structure), loadStructure(root), saveStructure(root, structure), structurePath(root), countStructure(structure)
//   planStructure(structure, config)           -> { parent_page_id, pages: [{ key, title, text }], databases: [{ table, title, body }], columns: [{ table, name, type, relation_to, body }],
//                                                   views: [{ table, name, columns, hidden, wrap, renamed_from, body }] }
//                                                  body of a database is the POST /databases body (relation columns left out: the table they point at may not exist yet);
//                                                  columns lists every column but the title, so that what a table lacks can be added (PATCH data source); body of a view is the
//                                                  POST /views body without the ids
//   completeViewBody(viewPlan, dataSource, { databaseId }) -> the POST /views body, property ids filled from the created data source
//   runStructure({ plan, client, root, config, log, parts }) -> { ok, code, stopped, pages, databases, columns, views, warnings, created }
//   verifyStructure({ client, config, structure })  -> { ok, differences: [{ table, kind, detail }], views: { <table>: { <view name>: <view id> } } }
//   renderPreview(structure)                   -> Markdown for the dry run
//   parseViewFilter(text, table, where), parseViewSort(text, table, where)
//   viewKey(name), viewUrl(databaseId, viewId) -> 'your_queue'; 'https://www.notion.so/<database id>?v=<view id>' (ids without dashes)
//
// Columns. After the tables exist, runStructure adds every column of the structure that a table lacks (updateDataSource): a table made by an earlier build gains the
// columns of a later revision, and the relation columns, which need the table they point at, are added this way too. A column that is there is never changed or removed.
//
// Where the ids go. Pages: config.json notion.pages.<key> (demos, demo_tests) and runs/builder/pages.json. Tables: notion.rulebook, notion.claims[0],
// notion.databases.<table> (database_id, data_source_id) and runs/builder/databases.json (the table's id and its data source's, under <table> and
// <table>_data_source). Views: config.json notion.views.<key> = { id, url } for each view that exists (your_queue, needs_your_note, agent_disagreed, your_queue_ledger,
// needs_your_note_ledger, lessons_waiting, rulebook); the key is left out for a view that could not be made, so the scripts fall back to the table's address. runs/builder/state.json keeps
// what the last run found, the views that failed included ("views": "failed: <message>").
//
// The client must be a builder client (clientFromConfig(config, { apiVersion: BUILDER_API_VERSION })): database creates, data sources and views
// need Notion-Version 2026-03-11. Rows are written by other code with the default version (lib/plan.mjs).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { TABLES, isProtected, tableEntry } from './config.mjs';
import { EXIT } from './exit-codes.mjs';
import { readJson, writeJsonAtomic } from './jsonl.mjs';
import { normId } from './notion-values.mjs';
import { agentRoot } from './paths.mjs';
import { builderPaths, readJsonOr, register, writeJsonPretty } from './builder-registry.mjs';

/** A structure that cannot be read, built or checked. Scripts answer it with exit code 2. */
export class StructureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StructureError';
    this.code = 'STRUCTURE';
  }
}

export const SECTION_TITLES = Object.freeze({
  rulebook: 'Rulebook copy', claims_copy: 'Claims copy', tag_decisions: 'Tag decisions', rule_changes: 'Rule changes', agent_settings: 'Agent settings',
});

/** The type words of the proposal's column tables and the REST property types they stand for. */
export const TYPE_WORDS = Object.freeze({
  title: 'title',
  text: 'rich_text',
  select: 'select',
  'multi-select': 'multi_select',
  number: 'number',
  link: 'url',
  checkbox: 'checkbox',
  date: 'date',
  'created time': 'created_time',
  'created by': 'created_by',
  'last edited time': 'last_edited_time',
  'last edited by': 'last_edited_by',
});
export const COLUMN_TYPES = Object.freeze([...new Set(Object.values(TYPE_WORDS)), 'relation']);
/** Columns Notion fills by itself: compared by type only, never written. */
export const AUTOMATIC_TYPES = Object.freeze(['created_time', 'created_by', 'last_edited_time', 'last_edited_by']);
export const DESCRIPTION_MAX = 280;

/** The one line of text on each sub-page the builder makes. */
export const PAGE_TEXT = Object.freeze({
  demos: 'Practice pages made by the walkthrough; never deleted.',
  demo_tests: 'Test runs of the walkthrough skill.',
});

/** Select colours: the taxonomy's own on the Rulebook copy (docs/mvp-2026-11/sweeps/live-schemas.md), Geo's on the claims, sensible ones on the queue. Anything not listed is default. */
export const OPTION_COLORS = Object.freeze({
  rulebook: {
    Category: { Nature: 'blue', Form: 'purple', Quality: 'green', Style: 'yellow', Tone: 'orange', Format: 'pink', Meaning: 'default', Usage: 'gray', Check: 'red' },
    'Geo Status': { 'Existing in Geo': 'green', 'To be created': 'yellow', 'Implemented differently': 'orange' },
    Polarity: { Classification: 'blue', Positive: 'green', Issue: 'red' },
    Status: { Verified: 'green', Proposed: 'yellow' },
    'Work tags': { 'Pipeline benchmark check': 'gray', Issue: 'orange' },
  },
  claims_copy: {
    'Geo Name source': { 'This space': 'green', 'Other space (fallback)': 'orange' },
    'Review status': { 'To review': 'yellow', Reviewed: 'green' },
    'Why wrong': { 'Agent slip': 'gray', 'Rule unclear': 'yellow', 'Rule should change': 'orange' },
  },
  tag_decisions: {
    'Agent proposal': { Applies: 'green', 'Does not apply': 'red', "Can't tell": 'yellow' },
    'Tag outcome': { Applies: 'green', 'Does not apply': 'red' },
    'Why wrong': { 'Agent slip': 'gray', 'Rule unclear': 'yellow', 'Rule should change': 'orange' },
    'Follow-up': { Fixed: 'green', 'Still wrong': 'red' },
  },
  rule_changes: {
    Kind: { 'Clarify wording': 'blue', 'Change the rule': 'purple', 'Initial rules': 'gray' },
    Status: { Proposed: 'yellow', Approved: 'blue', Rejected: 'red', Live: 'green', 'Rolled back': 'gray' },
  },
});

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const realId = (v) => {
  if (typeof v !== 'string') return null;
  const n = normId(v.trim());
  return /^[0-9a-f]{32}$/.test(n) ? n : null;
};

// ---- reading the proposal -----------------------------------------------------------------------------------------------------------

function splitCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

const isSeparator = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line.trim());

// The first Markdown table at or after line `from` (a few lines of prose may come first; a heading ends the search): { header, rows } or null.
function readTable(lines, from) {
  let i = from;
  while (i < lines.length && !lines[i].trim().startsWith('|') && !/^#{1,6}\s/.test(lines[i])) i += 1;
  if (i >= lines.length || !lines[i].trim().startsWith('|')) return null;
  const raw = [];
  while (i < lines.length && lines[i].trim().startsWith('|')) {
    raw.push(lines[i]);
    i += 1;
  }
  if (raw.length < 2 || !isSeparator(raw[1])) return null;
  return { header: splitCells(raw[0]), rows: raw.slice(2).map(splitCells) };
}

function headerIndexes(table, wanted, where) {
  const lower = table.header.map((h) => h.toLowerCase());
  return wanted.map((name) => {
    const at = lower.indexOf(name.toLowerCase());
    if (at < 0) throw new StructureError(`${where}: the table has no "${name}" column (it has ${table.header.map((h) => `"${h}"`).join(', ')})`);
    return at;
  });
}

// "## Title" sections of the document; the text before the first one is a section with title null.
function sections(markdown) {
  const out = [{ title: null, lines: [] }];
  for (const line of markdown.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ title: m[1], lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

const sectionName = (title) => String(title ?? '').replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();

function firstParagraph(lines) {
  const out = [];
  let started = false;
  for (const line of lines) {
    if (line.trim() === '') {
      if (started) break;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) break;
    started = true;
    out.push(line.trim());
  }
  return out.join(' ');
}

// "Values: a, b, c" at the end of a Meaning cell: { description, values } (values null without the list).
function splitValues(meaning) {
  const m = /(?:^|\s)Values:\s*(.*)$/.exec(meaning);
  if (!m) return { description: meaning.trim(), values: null };
  return { description: meaning.slice(0, m.index).trim(), values: m[1].trim().replace(/\.$/, '').trim() };
}

function cut(text, max = DESCRIPTION_MAX) {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

// The names listed in the Rulebook copy section's first paragraph ("... same column names and types: A, B, ..., Z. Only ..."), `count` of them.
function tagNamesFrom(paragraph, count) {
  let from = paragraph.indexOf(':');
  while (from >= 0) {
    const tail = paragraph.slice(from + 1);
    const end = tail.search(/\.(\s|$)/);
    const names = (end < 0 ? tail : tail.slice(0, end)).split(',').map((s) => s.trim()).filter(Boolean);
    if (names.length === count) return names;
    from = paragraph.indexOf(':', from + 1);
  }
  return null;
}

function parseColumns(key, section, tagNames) {
  const title = SECTION_TITLES[key];
  const at = section.lines.findIndex((l) => /^###\s+Columns\s*$/i.test(l.trim()));
  if (at < 0) throw new StructureError(`table "${title}": the section has no "### Columns" heading`);
  const table = readTable(section.lines, at + 1);
  if (!table) throw new StructureError(`table "${title}": no column table follows "### Columns"`);
  const [iName, iType, iMeaning] = headerIndexes(table, ['Column', 'Type', 'Meaning'], `table "${title}"`);
  const columns = [];
  for (const [n, cells] of table.rows.entries()) {
    if (cells.length !== table.header.length) throw new StructureError(`table "${title}": column row ${n + 1} has ${cells.length} cells, expected ${table.header.length}`);
    const name = cells[iName];
    if (name === '') throw new StructureError(`table "${title}": column row ${n + 1} has no name`);
    const word = cells[iType].toLowerCase();
    if (!Object.hasOwn(TYPE_WORDS, word)) {
      throw new StructureError(`table "${title}", column "${name}": unknown type word "${cells[iType]}" (expected one of ${Object.keys(TYPE_WORDS).join(', ')})`);
    }
    const type = TYPE_WORDS[word];
    if (columns.some((c) => c.name === name)) throw new StructureError(`table "${title}": the column "${name}" is listed twice`);
    const { description, values } = splitValues(cells[iMeaning]);
    let options = [];
    if (type === 'select' || type === 'multi_select') {
      if (values === null || values === '') throw new StructureError(`table "${title}", column "${name}": a ${word} needs "Values: a, b, c" in its Meaning`);
      const named = /^the (\d+) tag names of the Rulebook copy$/i.exec(values);
      if (named) {
        if (!tagNames || tagNames.length !== Number(named[1])) {
          throw new StructureError(`table "${title}", column "${name}": "${values}" cannot be resolved; the Rulebook copy section's first paragraph does not list ${named[1]} names`);
        }
        options = [...tagNames];
      } else {
        options = values.split(',').map((s) => s.trim()).filter(Boolean);
      }
      if (new Set(options).size !== options.length) throw new StructureError(`table "${title}", column "${name}": a value is listed twice`);
    } else if (values !== null) {
      throw new StructureError(`table "${title}", column "${name}": "Values:" belongs to a select, but the type word is "${cells[iType]}"`);
    }
    columns.push({ name, type, options, description: cut(description) });
  }
  const titles = columns.filter((c) => c.type === 'title');
  if (titles.length !== 1) throw new StructureError(`table "${title}": a table needs exactly one title column, found ${titles.length}`);
  return columns;
}

// ---- views: filter, sort -----------------------------------------------------------------------------------------------------------

const byLengthDesc = (a, b) => b.length - a.length;

// the leaf of a filter: `{ property, <type>: condition }`
const leaf = (column, condition) => ({ property: column.name, [column.type]: condition });

/**
 * The data-source query filter for a view's "Rows shown" text, or null for "all rows". The words it reads: "<Column> is empty", "<Column> is not empty",
 * "<Column> is <A> or <B>", "<Column> is not <A>" (a select), "<Column> contains <text>" and "<Column> does not contain <text>" (a text column), clauses
 * joined by ", and ". Values of a select must be options of the column.
 */
export function parseViewFilter(text, table, where = 'view') {
  const source = String(text ?? '').trim();
  if (source === '' || /^(all rows|none|no filter)$/i.test(source)) return null;
  const columns = table.columns;
  const names = columns.map((c) => c.name).sort(byLengthDesc);
  const split = new RegExp(`,?\\s+and\\s+(?=(?:${names.map(escapeRe).join('|')})\\s+(?:is|contains|does not contain)\\s)`, 'i');
  const parts = source.split(split).map((c) => c.trim()).filter(Boolean);
  const clauses = parts.map((clause) => {
    const name = names.find((n) => clause.startsWith(`${n} is `) || clause.startsWith(`${n} contains `) || clause.startsWith(`${n} does not contain `));
    if (!name) {
      throw new StructureError(`${where}: cannot read the filter "${clause}"; it should read "<column> is empty", "<column> is <value> or <value>", "<column> is not <value>", "<column> contains <text>" or "<column> does not contain <text>"`);
    }
    const column = columns.find((c) => c.name === name);
    const textual = column.type === 'rich_text' || column.type === 'title' || column.type === 'url';
    const positive = clause.startsWith(`${name} contains `);
    if (positive || clause.startsWith(`${name} does not contain `)) {
      if (!textual) throw new StructureError(`${where}: "contains" needs a text column, and "${name}" is a ${column.type}`);
      const needle = clause.slice(name.length + (positive ? 10 : 18)).trim().replace(/^"(.*)"$/, '$1');
      if (needle === '') throw new StructureError(`${where}: "${clause}" names no text to look for`);
      return leaf(column, { [positive ? 'contains' : 'does_not_contain']: needle });
    }
    const rest = clause.slice(name.length + 4).trim();
    if (/^empty$/i.test(rest)) return leaf(column, { is_empty: true });
    if (/^not empty$/i.test(rest)) return leaf(column, { is_not_empty: true });
    if (column.type === 'select' && /^not\s/i.test(rest)) {
      const value = rest.slice(4).trim();
      if (!column.options.includes(value)) throw new StructureError(`${where}: "${value}" is not a value of "${name}" (values: ${column.options.join(', ')})`);
      return leaf(column, { does_not_equal: value });
    }
    let values;
    if (column.type === 'select' || column.type === 'multi_select') {
      values = [];
      let left = rest;
      while (left !== '') {
        const option = [...column.options].sort(byLengthDesc).find((o) => left === o || left.startsWith(`${o} or `));
        if (!option) throw new StructureError(`${where}: "${left}" is not a value of "${name}" (values: ${column.options.join(', ')})`);
        values.push(option);
        left = left === option ? '' : left.slice(option.length + 4).trim();
      }
    } else if (textual) {
      values = [rest];
    } else {
      throw new StructureError(`${where}: a filter on a ${column.type} column ("${name}") cannot be read from words`);
    }
    const condition = (value) => (column.type === 'multi_select' ? { contains: value } : { equals: value });
    const leaves = values.map((v) => leaf(column, condition(v)));
    return leaves.length === 1 ? leaves[0] : { or: leaves };
  });
  return clauses.length === 1 ? clauses[0] : { and: clauses };
}

const DIRECTIONS = Object.freeze({
  'lowest first': 'ascending', 'smallest first': 'ascending', 'oldest first': 'ascending', 'a to z': 'ascending',
  'highest first': 'descending', 'largest first': 'descending', 'newest first': 'descending', 'z to a': 'descending',
});

/** The sorts for a view's "Sorted by" text: "<Column>, lowest first" or "none" (no sorts). */
export function parseViewSort(text, table, where = 'view') {
  const source = String(text ?? '').trim();
  if (source === '' || /^(none|no sort)$/i.test(source)) return [];
  for (const name of table.columns.map((c) => c.name).sort(byLengthDesc)) {
    if (!source.startsWith(name)) continue;
    const direction = DIRECTIONS[source.slice(name.length).replace(/^\s*,\s*/, '').trim().toLowerCase()];
    if (direction) return [{ property: name, direction }];
  }
  throw new StructureError(`${where}: cannot read the sort "${source}"; it should read "<column>, lowest first", "<column>, highest first" or "none"`);
}

function parseViews(section, tables) {
  if (!section) throw new StructureError('the proposal has no "## Views" section');
  const table = readTable(section.lines, 0);
  if (!table) throw new StructureError('the "## Views" section has no table');
  const [iView, iTable, iRows, iSort, iColumns] = headerIndexes(table, ['View', 'Table', 'Rows shown', 'Sorted by', 'Columns shown'], 'the Views table');
  const views = [];
  for (const [n, cells] of table.rows.entries()) {
    if (cells.length !== table.header.length) throw new StructureError(`the Views table: row ${n + 1} has ${cells.length} cells, expected ${table.header.length}`);
    const name = cells[iView];
    const where = `view "${name}"`;
    const key = TABLES.find((k) => tables[k].title.toLowerCase() === cells[iTable].toLowerCase());
    if (!key) throw new StructureError(`${where}: the table "${cells[iTable]}" is not one of the five tables`);
    const [shown, ...note] = cells[iColumns].split(';');
    const columns = shown.split(',').map((s) => s.trim()).filter(Boolean);
    for (const c of columns) {
      if (!tables[key].columns.some((x) => x.name === c)) throw new StructureError(`${where}: the table "${tables[key].title}" has no column "${c}"`);
    }
    if (columns.length === 0) throw new StructureError(`${where}: no columns are shown`);
    if (views.some((v) => v.table === key && v.name === name)) throw new StructureError(`${where}: the table "${tables[key].title}" has two views with this name`);
    const view = { name, table: key, filter: cells[iRows], sort: cells[iSort], columns, wrap: /\bwrap\b/i.test(note.join(';')) };
    parseViewFilter(view.filter, tables[key], where); // fail now, not when the plan is made
    parseViewSort(view.sort, tables[key], where);
    views.push(view);
  }
  return views;
}

function parsePages(markdown) {
  const lines = markdown.replace(/^﻿/, '').split(/\r?\n/);
  const at = lines.findIndex((l) => /^Sub-pages:\s*$/i.test(l.trim()));
  if (at < 0) throw new StructureError('the proposal has no "Sub-pages:" list');
  const pages = [];
  let sawBullet = false;
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const m = /^\s*[-*]\s+\*\*(.+?)\*\*\s*:?\s*(.*)$/.exec(line);
    if (m) {
      sawBullet = true;
      if (!/^this page\b/i.test(m[2])) pages.push(m[1].trim());
      continue;
    }
    if (line.trim() === '' && !sawBullet) continue;
    break;
  }
  if (pages.length === 0) throw new StructureError('the "Sub-pages:" list names no page to build');
  return pages;
}

/** The structure object from the text of the approved proposal (docs/mvp-2026-11/STRUCTURE.md). */
export function structureFromProposal(markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') throw new StructureError('the proposal is empty');
  const secs = sections(markdown);
  const found = {};
  for (const key of TABLES) {
    const section = secs.find((s) => s.title !== null && sectionName(s.title) === SECTION_TITLES[key].toLowerCase());
    if (!section) throw new StructureError(`table "${SECTION_TITLES[key]}": the proposal has no "## ${SECTION_TITLES[key]}" section`);
    found[key] = section;
  }
  const count = (/the\s+(\d+)\s+tag names of the Rulebook copy/i.exec(markdown) ?? [])[1];
  const tagNames = count ? tagNamesFrom(firstParagraph(found.rulebook.lines), Number(count)) : null;
  const tables = {};
  for (const key of TABLES) tables[key] = { title: SECTION_TITLES[key], columns: parseColumns(key, found[key], tagNames) };
  const views = parseViews(secs.find((s) => s.title !== null && sectionName(s.title) === 'views'), tables);
  return { tables, views, pages: parsePages(markdown) };
}

// ---- the structure file ------------------------------------------------------------------------------------------------------------------

export const structurePath = (root = agentRoot()) => join(root, 'setup', 'structure.json');

/** Check the shape of a structure object (the file is read by later steps, so a hand edit is caught here). Returns the structure; throws StructureError. */
export function validateStructure(structure) {
  const bad = (why) => {
    throw new StructureError(`structure: ${why}`);
  };
  if (!isPlain(structure) || !isPlain(structure.tables)) bad('expected an object with tables');
  for (const key of TABLES) {
    const t = structure.tables[key];
    if (!isPlain(t)) bad(`table "${SECTION_TITLES[key]}" is missing`);
    if (typeof t.title !== 'string' || t.title === '') bad(`table "${key}" has no title`);
    if (!Array.isArray(t.columns) || t.columns.length === 0) bad(`table "${t.title}" has no columns`);
    const seen = new Set();
    for (const c of t.columns) {
      if (!isPlain(c) || typeof c.name !== 'string' || c.name === '') bad(`table "${t.title}" has a column without a name`);
      if (seen.has(c.name)) bad(`table "${t.title}": the column "${c.name}" is listed twice`);
      seen.add(c.name);
      if (!COLUMN_TYPES.includes(c.type)) bad(`table "${t.title}", column "${c.name}": unknown type "${c.type}"`);
      if (!Array.isArray(c.options) || c.options.some((o) => typeof o !== 'string' || o === '')) bad(`table "${t.title}", column "${c.name}": options must be a list of names`);
      if ((c.type === 'select' || c.type === 'multi_select') && c.options.length === 0) bad(`table "${t.title}", column "${c.name}": a select needs its values`);
      if (c.type !== 'select' && c.type !== 'multi_select' && c.options.length > 0) bad(`table "${t.title}", column "${c.name}": only a select has options`);
      if (typeof c.description !== 'string' || [...c.description].length > DESCRIPTION_MAX) bad(`table "${t.title}", column "${c.name}": the description must be text of at most ${DESCRIPTION_MAX} characters`);
      if (c.type === 'relation') {
        if (!TABLES.includes(c.relation_to) || c.relation_to === key) bad(`table "${t.title}", column "${c.name}": a relation names another of the five tables in relation_to`);
      } else if (c.relation_to !== undefined) bad(`table "${t.title}", column "${c.name}": only a relation has relation_to`);
    }
    if (t.columns.filter((c) => c.type === 'title').length !== 1) bad(`table "${t.title}" needs exactly one title column`);
  }
  if (!Array.isArray(structure.views)) bad('views must be a list');
  const viewKeys = new Set();
  for (const v of structure.views) {
    const where = `view "${v?.name}"`;
    if (!isPlain(v) || typeof v.name !== 'string' || v.name === '') bad('a view has no name');
    if (viewKeys.has(viewKey(v.name))) bad(`${where}: two views have this name; config.json notion.views is keyed by it`);
    viewKeys.add(viewKey(v.name));
    if (!TABLES.includes(v.table)) bad(`${where}: the table "${v.table}" is not one of ${TABLES.join(', ')}`);
    if (!Array.isArray(v.columns) || v.columns.length === 0) bad(`${where}: no columns are shown`);
    for (const c of v.columns) if (!structure.tables[v.table].columns.some((x) => x.name === c)) bad(`${where}: the table has no column "${c}"`);
    if (typeof v.wrap !== 'boolean') bad(`${where}: wrap must be true or false`);
    if (v.renamed_from !== undefined && (typeof v.renamed_from !== 'string' || v.renamed_from === '' || v.renamed_from === v.name)) bad(`${where}: renamed_from must be another name of a view of the same table`);
    parseViewFilter(v.filter, structure.tables[v.table], where);
    parseViewSort(v.sort, structure.tables[v.table], where);
  }
  if (!Array.isArray(structure.pages) || structure.pages.some((p) => typeof p !== 'string' || p === '')) bad('pages must be a list of page titles');
  return structure;
}

export function loadStructure(root = agentRoot()) {
  const file = structurePath(root);
  if (!existsSync(file)) throw new StructureError(`${file} does not exist: run "setup.mjs structure --from-proposal docs/mvp-2026-11/STRUCTURE.md" first`);
  return validateStructure(readJson(file));
}

export function saveStructure(root, structure) {
  validateStructure(structure);
  writeJsonAtomic(structurePath(root), structure);
  return structurePath(root);
}

/** { tables, columns, views, pages } for the line that `setup.mjs structure` prints. */
export function countStructure(structure) {
  return {
    tables: TABLES.length,
    columns: TABLES.reduce((n, k) => n + structure.tables[k].columns.length, 0),
    views: structure.views.length,
    pages: structure.pages.length,
  };
}

// ---- the plan ------------------------------------------------------------------------------------------------------------------------------

export const pageKey = (title) => String(title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** The key of a view in config.json notion.views: its name in lower case with underscores ("Your queue" -> "your_queue"). */
export const viewKey = pageKey;

/** The address of one view of a table, the way Notion writes it: the database id and the view id, both without dashes. */
export const viewUrl = (databaseId, viewId) => `https://www.notion.so/${normId(databaseId)}?v=${normId(viewId)}`;

function propertyConfig(table, column) {
  const body = {};
  if (column.type === 'relation') body.relation = { single_property: {} }; // the data source id of the table it points at is added with the column, once that table exists
  else if (column.type === 'number') body.number = { format: 'number' };
  else if (column.type === 'select' || column.type === 'multi_select') {
    body[column.type] = { options: column.options.map((name) => ({ name, color: OPTION_COLORS[table]?.[column.name]?.[name] ?? 'default' })) };
  } else body[column.type] = {};
  return { type: column.type, ...body, ...(column.description ? { description: column.description } : {}) };
}

/** The plan of one view: what to show, what is hidden, and the POST /views body with column names where the property ids will go. */
export function viewPlan(structure, view) {
  const t = structure.tables[view.table];
  const where = `view "${view.name}"`;
  const filter = parseViewFilter(view.filter, t, where);
  const sorts = parseViewSort(view.sort, t, where);
  const hidden = t.columns.map((c) => c.name).filter((n) => !view.columns.includes(n));
  const properties = [
    ...view.columns.map((name) => ({ name, visible: true, wrap: view.wrap })),
    ...hidden.map((name) => ({ name, visible: false })),
  ];
  return {
    table: view.table,
    name: view.name,
    columns: [...view.columns],
    hidden,
    wrap: view.wrap,
    renamed_from: view.renamed_from ?? null,
    body: {
      name: view.name,
      type: 'table',
      ...(filter ? { filter } : {}),
      ...(sorts.length ? { sorts } : {}),
      configuration: { type: 'table', wrap_cells: view.wrap, properties },
    },
  };
}

/** The REST plan for a structure under config.notion.parent_page_id. Pure: nothing is sent. */
export function planStructure(structure, config) {
  validateStructure(structure);
  const parent = config?.notion?.parent_page_id;
  if (!realId(parent)) throw new StructureError('config.json has no notion.parent_page_id');
  return {
    parent_page_id: parent,
    pages: structure.pages.map((title) => {
      const key = pageKey(title);
      return { key, title, text: PAGE_TEXT[key] ?? `${title}.` };
    }),
    databases: TABLES.map((table) => {
      const t = structure.tables[table];
      const properties = {};
      for (const column of t.columns) if (column.type !== 'relation') properties[column.name] = propertyConfig(table, column);
      return {
        table,
        title: t.title,
        body: {
          parent: { type: 'page_id', page_id: parent },
          title: [{ type: 'text', text: { content: t.title } }],
          is_inline: true,
          initial_data_source: { properties },
        },
      };
    }),
    columns: TABLES.flatMap((table) => structure.tables[table].columns
      .filter((c) => c.type !== 'title')
      .map((c) => ({ table, name: c.name, type: c.type, relation_to: c.relation_to ?? null, body: propertyConfig(table, c) }))),
    views: structure.views.map((v) => viewPlan(structure, v)),
  };
}

/**
 * The POST /views body for a view plan, with the property ids of the created data source in place of the column names. `dataSource` is the
 * retrieveDataSource answer; the database id comes from opts.databaseId or from the data source's parent.
 */
export function completeViewBody(plan, dataSource, { databaseId } = {}) {
  const props = dataSource?.properties;
  if (!isPlain(props)) throw new StructureError(`view "${plan?.name}": the data source has no properties`);
  const db = databaseId ?? dataSource.parent?.database_id;
  if (!db) throw new StructureError(`view "${plan.name}": the database id is unknown`);
  const properties = plan.body.configuration.properties.map(({ name, ...rest }) => {
    const id = props[name]?.id;
    if (!id) throw new StructureError(`view "${plan.name}": the table has no column "${name}"`);
    return { property_id: id, ...rest };
  });
  return { database_id: db, data_source_id: dataSource.id, ...plan.body, configuration: { ...plan.body.configuration, properties } };
}

// ---- running it ---------------------------------------------------------------------------------------------------------------------------

const paragraph = (text) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } });

// write the same change to config.json on disk (when there is one) and to the config object in memory
function changeConfig(root, config, apply) {
  const file = builderPaths(root).config;
  if (existsSync(file)) {
    const disk = readJson(file);
    apply(disk);
    writeJsonAtomic(file, disk);
  }
  apply(config);
}

function recordPage(ctx, key, id) {
  const clean = normId(id);
  const r = register({ root: ctx.root, kind: 'page', id: clean, name: key });
  if (!r.ok) throw new Error(r.message);
  changeConfig(ctx.root, ctx.config, (c) => {
    c.notion = c.notion ?? {};
    c.notion.pages = c.notion.pages ?? {};
    c.notion.pages[key] = clean;
  });
  return clean;
}

// config.json notion.views.<key> = { id, url } for a view that exists; the keys stay in the order of the proposal's Views table
function recordView(ctx, view, databaseId, viewId) {
  const key = viewKey(view.name);
  const entry = { id: normId(viewId), url: viewUrl(databaseId, viewId) };
  const order = ctx.plan.views.map((v) => viewKey(v.name));
  changeConfig(ctx.root, ctx.config, (c) => {
    c.notion = c.notion ?? {};
    const views = { ...(c.notion.views ?? {}), [key]: entry };
    c.notion.views = Object.fromEntries([
      ...order.filter((k) => views[k]).map((k) => [k, views[k]]),
      ...Object.entries(views).filter(([k]) => !order.includes(k)),
    ]);
  });
  return entry;
}

function recordTable(ctx, table, databaseId, dataSourceId) {
  const db = normId(databaseId);
  const ds = normId(dataSourceId);
  for (const [id, name] of [[db, table], [ds, `${table}_data_source`]]) {
    const r = register({ root: ctx.root, kind: 'database', id, name });
    if (!r.ok) throw new Error(r.message);
  }
  changeConfig(ctx.root, ctx.config, (c) => {
    const entry = tableEntry(c, table);
    entry.database_id = db;
    entry.data_source_id = ds;
  });
  return { database_id: db, data_source_id: ds };
}

// What went wrong with a create, as the result of the run.
function stopWith(ctx, what, e) {
  const { result } = ctx;
  result.ok = false;
  if (e?.code === 'create_uncertain') {
    result.code = EXIT.ERROR;
    result.stopped = {
      reason: 'create_uncertain',
      what,
      message: String(e.message),
      next: `Notion may have made ${what}, but the answer was lost, so nothing was recorded and nothing was sent twice. Look under the parent page (for a table or page) or among the views of the table (for a view) in Notion, then run the same command again: ${what} is found by its name and recorded if it is there, and made if it is not.`,
    };
    return;
  }
  const refused = e?.name === 'NotionError' && e.status >= 400 && e.status < 500 && e.status !== 429;
  result.code = refused ? EXIT.INVALID : EXIT.ERROR;
  const message = String(e?.message ?? e);
  const users = refused && /created[_ ]by|last[_ ]edited[_ ]by/i.test(message);
  result.stopped = {
    reason: refused ? 'refused' : 'error',
    what,
    message,
    next: users
      ? 'Notion may not take the Created by and Last edited by columns through the API. Nothing was made twice. If so, remove those two columns from setup/structure.json (the approved proposal lists them, so say so in the log) and run the same command again.'
      : 'Fix what the message names and run the same command again; what was made is recorded and is not made twice.',
  };
}

// The child pages or databases of the parent page (listed once per run): a thing made by an earlier run that stopped before it was recorded is found here.
async function findChild(ctx, type, title) {
  if (ctx.children === null) {
    try {
      ctx.children = await ctx.client.retrieveBlockChildren(ctx.plan.parent_page_id);
    } catch (e) {
      ctx.children = [];
      ctx.result.warnings.push(`the blocks under the parent page could not be listed (${e.message}); a page or table made by an earlier stopped run would not be noticed`);
    }
  }
  const hits = ctx.children.filter((b) => b?.type === type && (b[type]?.title ?? '') === title);
  if (hits.length > 1) return 'many';
  return hits.length === 1 ? { id: hits[0].id } : null;
}

async function buildPages(ctx) {
  const { plan, client, root, config, log, result } = ctx;
  const registry = readJsonOr(builderPaths(root).pages, { pages: [], names: {} });
  for (const page of plan.pages) {
    const recorded = realId(config.notion?.pages?.[page.key]) ?? realId(registry.names?.[page.key]);
    if (recorded) {
      if (!realId(config.notion?.pages?.[page.key])) recordPage(ctx, page.key, recorded);
      result.pages[page.key] = { id: recorded, status: 'exists' };
      log(`page "${page.title}": already recorded (${recorded})`);
      continue;
    }
    const found = await findChild(ctx, 'child_page', page.title);
    if (found === 'many') {
      stopWith(ctx, `the page "${page.title}"`, new Error(`more than one page titled "${page.title}" is under the parent page; keep one and register it with "setup.mjs register page --id <id> --name ${page.key}"`));
      return;
    }
    if (found) {
      const id = recordPage(ctx, page.key, found.id);
      result.pages[page.key] = { id, status: 'adopted' };
      log(`page "${page.title}": found under the parent page (made by an earlier run) and recorded (${id})`);
      continue;
    }
    let created;
    try {
      created = await client.createPageUnderPage({ parentPageId: plan.parent_page_id, title: page.title, children: [paragraph(page.text)] });
    } catch (e) {
      stopWith(ctx, `the page "${page.title}"`, e);
      return;
    }
    const id = recordPage(ctx, page.key, created.id);
    result.pages[page.key] = { id, status: 'created' };
    result.created.pages += 1;
    log(`page "${page.title}": created (${id})`);
  }
}

async function buildDatabases(ctx) {
  const { plan, client, config, log, result } = ctx;
  for (const db of plan.databases) {
    const entry = tableEntry(config, db.table);
    const haveDb = realId(entry.database_id);
    const haveDs = realId(entry.data_source_id);
    if (haveDb && haveDs) {
      result.databases[db.table] = { database_id: haveDb, data_source_id: haveDs, status: 'exists' };
      log(`table "${db.title}": already recorded (${haveDb})`);
      continue;
    }
    let databaseId = haveDb;
    let status = 'created';
    if (!databaseId) {
      const found = await findChild(ctx, 'child_database', db.title);
      if (found === 'many') {
        stopWith(ctx, `the table "${db.title}"`, new Error(`more than one table titled "${db.title}" is under the parent page; keep one and put its ids into config.json by hand`));
        return;
      }
      if (found) {
        databaseId = normId(found.id);
        status = 'adopted';
      }
    } else status = 'adopted';
    let dataSourceId = null;
    if (databaseId) {
      try {
        const info = await client.retrieveDatabase(databaseId);
        dataSourceId = info.data_sources?.[0]?.id ?? null;
      } catch (e) {
        stopWith(ctx, `the table "${db.title}"`, e);
        return;
      }
      if (!dataSourceId) {
        stopWith(ctx, `the table "${db.title}"`, new Error('Notion lists no data source for it'));
        return;
      }
      if (isProtected(config, databaseId) || isProtected(config, dataSourceId)) {
        stopWith(ctx, `the table "${db.title}"`, new Error('it is on the protected list of config.json, so it is never adopted'));
        return;
      }
      log(`table "${db.title}": found under the parent page (made by an earlier run) and recorded (${databaseId})`);
    } else {
      let created;
      try {
        created = await client.createDatabase({ parentPageId: plan.parent_page_id, title: db.title, isInline: true, properties: db.body.initial_data_source.properties });
        dataSourceId = created.data_sources?.[0]?.id ?? null;
        if (!dataSourceId) dataSourceId = (await client.retrieveDatabase(created.id)).data_sources?.[0]?.id ?? null;
      } catch (e) {
        stopWith(ctx, `the table "${db.title}"`, e);
        return;
      }
      if (!dataSourceId) {
        // the table exists but its data source id is unknown: stop; the next run finds the table under the parent page and reads it
        stopWith(ctx, `the table "${db.title}"`, new Error('Notion made the table but lists no data source for it; run the same command again to read it'));
        return;
      }
      databaseId = created.id;
      result.created.databases += 1;
      log(`table "${db.title}": created (${normId(databaseId)})`);
    }
    const ids = recordTable(ctx, db.table, databaseId, dataSourceId);
    result.databases[db.table] = { ...ids, status };
  }
}

// Add the columns a table lacks (updateDataSource, one call per table): the columns of a revision that came after the table was made, and every relation column, which
// needs the table it points at. A column that is there is left as it is, whatever it holds; nothing is changed or removed.
async function buildColumns(ctx) {
  const { plan, client, config, log, result } = ctx;
  for (const table of TABLES) {
    const wanted = (plan.columns ?? []).filter((c) => c.table === table);
    if (wanted.length === 0) continue;
    const entry = tableEntry(config, table);
    if (!realId(entry.database_id) || !realId(entry.data_source_id)) continue; // buildDatabases stopped the run already
    let dataSource;
    try {
      dataSource = await client.retrieveDataSource(entry.data_source_id);
    } catch (e) {
      stopWith(ctx, `the columns of "${table}"`, e);
      return;
    }
    const missing = wanted.filter((c) => !dataSource.properties?.[c.name]);
    if (missing.length === 0) continue;
    const properties = {};
    for (const c of missing) {
      if (c.relation_to) {
        const target = tableEntry(config, c.relation_to);
        if (!realId(target.data_source_id)) {
          stopWith(ctx, `the column "${c.name}" of "${table}"`, new Error(`the table "${c.relation_to}" it points at is not created yet`));
          return;
        }
        properties[c.name] = { ...c.body, relation: { data_source_id: normId(target.data_source_id), single_property: {} } };
      } else properties[c.name] = c.body;
    }
    try {
      await client.updateDataSource(entry.data_source_id, { properties });
    } catch (e) {
      stopWith(ctx, `the columns of "${table}"`, e);
      return;
    }
    result.columns[table] = missing.map((c) => c.name);
    result.created.columns += missing.length;
    log(`table "${table}": ${missing.length} column(s) added (${missing.map((c) => c.name).join(', ')})`);
  }
}

// name -> view id for the views a table already has
async function existingViews(client, databaseId) {
  const out = new Map();
  for (const ref of await client.listViews(databaseId)) {
    const view = await client.retrieveView(ref.id);
    if (typeof view?.name === 'string' && !out.has(view.name)) out.set(view.name, view.id ?? ref.id);
  }
  return out;
}

async function buildViews(ctx) {
  const { plan, client, config, log, result } = ctx;
  for (const table of TABLES) {
    const wanted = plan.views.filter((v) => v.table === table);
    if (wanted.length === 0) continue;
    const entry = tableEntry(config, table);
    if (!realId(entry.database_id) || !realId(entry.data_source_id)) {
      stopWith(ctx, `the views of "${table}"`, new Error(`the table "${table}" is not created yet; run "setup.mjs databases" first`));
      result.code = EXIT.INVALID;
      return;
    }
    const mine = (result.views[table] = {});
    let dataSource;
    let have;
    try {
      dataSource = await client.retrieveDataSource(entry.data_source_id);
      have = await existingViews(client, entry.database_id);
    } catch (e) {
      if (e?.name === 'NotionError' && (e.status === 400 || e.status === 404)) {
        for (const v of wanted) mine[v.name] = { id: null, status: 'failed', message: String(e.message) };
        log(`views of "${table}": failed (${e.message})`);
        continue;
      }
      stopWith(ctx, `the views of "${table}"`, e);
      return;
    }
    let previous = null; // the view before this one in the tab bar: ours go first, in the order of the proposal, ahead of Notion's own default view
    for (const v of wanted) {
      if (have.has(v.name)) {
        const known = config.notion?.views?.[viewKey(v.name)];
        const link = !known || known.id !== normId(have.get(v.name)) || known.url !== viewUrl(entry.database_id, have.get(v.name)) ? recordView(ctx, v, entry.database_id, have.get(v.name)) : known;
        mine[v.name] = { id: have.get(v.name), status: 'exists', url: link.url };
        previous = have.get(v.name);
        log(`view "${v.name}": already there`);
        continue;
      }
      if (v.renamed_from && have.has(v.renamed_from)) {
        // the table has this view under its older name: give it the new one (its filter, sorts and columns are the structure's own; verify compares them)
        const id = have.get(v.renamed_from);
        try {
          await client.updateView(id, { name: v.name });
        } catch (e) {
          if (e?.name === 'NotionError' && (e.status === 400 || e.status === 404)) {
            mine[v.name] = { id: null, status: 'failed', message: String(e.message) };
            log(`view "${v.renamed_from}": could not be renamed to "${v.name}" (${e.message})`);
            continue;
          }
          stopWith(ctx, `the view "${v.renamed_from}" of "${table}" (its new name)`, e);
          return;
        }
        have.delete(v.renamed_from);
        have.set(v.name, id);
        previous = id;
        const link = recordView(ctx, v, entry.database_id, id);
        mine[v.name] = { id, status: 'renamed', url: link.url };
        result.created.renamed += 1;
        log(`view "${v.renamed_from}": renamed to "${v.name}" (${id})`);
        continue;
      }
      const body = completeViewBody(v, dataSource, { databaseId: entry.database_id });
      const make = (position) => client.createView({
        databaseId: body.database_id, dataSourceId: body.data_source_id, name: body.name, type: body.type, filter: body.filter, sorts: body.sorts, configuration: body.configuration, position,
      });
      try {
        let res;
        try {
          res = await make(previous ? { type: 'after_view', view_id: previous } : { type: 'start' });
        } catch (e) {
          if (!(e?.name === 'NotionError' && e.status === 400)) throw e;
          // a refused create makes nothing, so it is safe to ask again without the place in the tab bar
          log(`view "${v.name}": Notion did not take its place in the tab bar (${e.message}); asking again without it`);
          res = await make(undefined);
        }
        have.set(v.name, res.id);
        previous = res.id;
        const link = recordView(ctx, v, entry.database_id, res.id);
        mine[v.name] = { id: res.id, status: 'created', url: link.url };
        result.created.views += 1;
        log(`view "${v.name}": created (${res.id})`);
      } catch (e) {
        if (e?.name === 'NotionError' && (e.status === 400 || e.status === 404)) {
          mine[v.name] = { id: null, status: 'failed', message: String(e.message) };
          log(`view "${v.name}": failed (${e.message})`);
          continue;
        }
        stopWith(ctx, `the view "${v.name}" of "${table}"`, e);
        return;
      }
    }
  }
}

function writeState(ctx) {
  const { root, result, plan } = ctx;
  const file = join(builderPaths(root).dir, 'state.json');
  const state = readJsonOr(file, { pages: {}, tables: {} });
  state.updated_at = new Date().toISOString();
  state.parent_page_id = plan.parent_page_id;
  const keep = (before, now) => (before === 'created' && now === 'exists' ? 'created' : now); // the file says how it came to be, not that a later run found it
  for (const [key, p] of Object.entries(result.pages)) state.pages[key] = { id: p.id, status: keep(state.pages[key]?.status, p.status) };
  for (const [table, d] of Object.entries(result.databases)) state.tables[table] = { ...(state.tables[table] ?? {}), database_id: d.database_id, data_source_id: d.data_source_id };
  for (const [table, views] of Object.entries(result.views)) {
    const failed = Object.values(views).filter((v) => v.status === 'failed');
    state.tables[table] = {
      ...(state.tables[table] ?? {}),
      views: failed.length ? `failed: ${failed[0].message}` : 'ok',
      view_ids: Object.fromEntries(Object.entries(views).filter(([, v]) => v.id).map(([name, v]) => [name, v.id])),
      view_status: Object.fromEntries(Object.entries(views).map(([name, v]) => [name, v.status === 'failed' ? `failed: ${v.message}` : keep(state.tables[table]?.view_status?.[name], v.status)])),
    };
  }
  writeJsonPretty(file, state);
}

/**
 * Make the pages, tables and views of a plan, in that order, recording every id the moment it is known. Resumable: what config.json (or the
 * registry) already holds is not made again, a page or table of the right title already under the parent page is adopted, and a view whose name
 * the table already has is left alone. A create whose answer was lost stops the run (result.stopped says what to check); a view that Notion
 * refuses (400 or 404) is recorded as failed and the run goes on. `parts` limits the run to some of 'pages', 'databases', 'views'.
 */
export async function runStructure({ plan, client, root = agentRoot(), config, log = () => {}, parts = ['pages', 'databases', 'views'] } = {}) {
  if (!plan || !Array.isArray(plan.pages) || !Array.isArray(plan.databases) || !Array.isArray(plan.views)) throw new TypeError('runStructure: a plan from planStructure is required');
  if (!client || typeof client.createDatabase !== 'function') throw new TypeError('runStructure: a Notion client is required');
  if (!config) throw new TypeError('runStructure: the config is required');
  if (isProtected(config, plan.parent_page_id)) throw new StructureError('the parent page is on the protected list of config.json; the builder never builds there');
  const result = { ok: true, code: EXIT.OK, stopped: null, pages: {}, databases: {}, columns: {}, views: {}, warnings: [], created: { pages: 0, databases: 0, columns: 0, views: 0, renamed: 0 } };
  const ctx = { plan, client, root, config, log, result, children: null };
  try {
    if (parts.includes('pages')) await buildPages(ctx);
    if (result.ok && parts.includes('databases')) {
      await buildDatabases(ctx);
      if (result.ok) await buildColumns(ctx);
    }
    if (result.ok && parts.includes('views')) await buildViews(ctx);
  } finally {
    writeState(ctx);
  }
  return result;
}

// ---- reading it back --------------------------------------------------------------------------------------------------------------------

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isPlain(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function nameLookup(dataSource) {
  const byId = new Map();
  for (const [name, def] of Object.entries(dataSource?.properties ?? {})) {
    for (const id of [def.id, safeDecode(def.id), encodeURIComponent(def.id ?? '')]) if (id) byId.set(id, name);
  }
  return (ref) => byId.get(ref) ?? byId.get(safeDecode(ref)) ?? ref;
}

// A filter the way it is compared: property ids turned into names, a lone and/or removed, nested same-kind groups merged.
function canonFilter(filter, nameOf) {
  if (!isPlain(filter)) return null;
  const op = Array.isArray(filter.and) ? 'and' : Array.isArray(filter.or) ? 'or' : null;
  if (op) {
    let parts = filter[op].map((f) => canonFilter(f, nameOf)).filter((f) => f !== null);
    parts = parts.flatMap((p) => (Array.isArray(p[op]) ? p[op] : [p]));
    return parts.length === 1 ? parts[0] : { [op]: parts };
  }
  const out = {};
  for (const [k, v] of Object.entries(filter)) out[k] = k === 'property' ? nameOf(v) : v;
  return out;
}

const canonSorts = (sorts, nameOf) => (Array.isArray(sorts) ? sorts : []).map((s) => (s.property !== undefined ? { property: nameOf(s.property), direction: s.direction } : { timestamp: s.timestamp, direction: s.direction }));

function compareColumns(add, key, t, dataSource, config) {
  const actual = dataSource?.properties ?? {};
  for (const c of t.columns) {
    const def = actual[c.name];
    if (!def) {
      add(key, 'missing column', `"${c.name}" (${c.type}) is not in the table`);
      continue;
    }
    if (def.type !== c.type) {
      add(key, 'type', `"${c.name}" is ${def.type} in Notion but ${c.type} in the structure`);
      continue;
    }
    if (c.type === 'relation') {
      let target = null;
      try {
        target = tableEntry(config, c.relation_to).data_source_id;
      } catch {
        target = null;
      }
      const found = def.relation?.data_source_id ?? null;
      if (realId(target) && (found === null || normId(found) !== normId(target))) {
        add(key, 'relation', `"${c.name}" points at ${found ? normId(found) : 'no table'} in Notion, not at the ${c.relation_to} table (${normId(target)})`);
      }
    }
    if (c.type === 'select' || c.type === 'multi_select') {
      const have = new Set((def[c.type]?.options ?? []).map((o) => o.name));
      const want = new Set(c.options);
      const missing = [...want].filter((n) => !have.has(n));
      const extra = [...have].filter((n) => !want.has(n));
      if (missing.length || extra.length) {
        add(key, 'options', `"${c.name}":${missing.length ? ` missing ${missing.map((n) => `"${n}"`).join(', ')}` : ''}${missing.length && extra.length ? ';' : ''}${extra.length ? ` extra ${extra.map((n) => `"${n}"`).join(', ')}` : ''}`);
      }
    }
  }
  for (const [name, def] of Object.entries(actual)) {
    if (!t.columns.some((c) => c.name === name)) add(key, 'extra column', `"${name}" (${def.type}) is in the table but not in the structure`);
  }
}

async function compareViews(add, key, structure, wanted, entry, client, dataSource, seen) {
  let views;
  try {
    views = [];
    for (const ref of await client.listViews(entry.database_id)) views.push(await client.retrieveView(ref.id));
  } catch (e) {
    for (const v of wanted) add(key, 'missing view', `"${v.name}" cannot be checked: the views of the table cannot be read (${e.message})`);
    return;
  }
  const nameOf = nameLookup(dataSource);
  for (const v of wanted) {
    const found = views.find((x) => x?.name === v.name);
    if (!found) {
      add(key, 'missing view', `"${v.name}" is not among the views of the table`);
      continue;
    }
    (seen[key] ??= {})[v.name] = found.id;
    const plan = viewPlan(structure, v);
    const wantFilter = canonFilter(plan.body.filter, (n) => n);
    const haveFilter = canonFilter(found.filter, nameOf);
    if (stable(wantFilter) !== stable(haveFilter)) add(key, 'view filter', `"${v.name}": expected ${wantFilter ? stable(wantFilter) : 'no filter'}, found ${haveFilter ? stable(haveFilter) : 'no filter'}`);
    const wantSorts = canonSorts(plan.body.sorts, (n) => n);
    const haveSorts = canonSorts(found.sorts, nameOf);
    if (stable(wantSorts) !== stable(haveSorts)) add(key, 'view sort', `"${v.name}": expected ${stable(wantSorts)}, found ${stable(haveSorts)}`);
    const haveShown = (found.configuration?.properties ?? []).filter((p) => p.visible !== false).map((p) => nameOf(p.property_id));
    if (stable(plan.columns) !== stable(haveShown)) add(key, 'view columns', `"${v.name}": expected ${plan.columns.join(', ')}; found ${haveShown.join(', ') || 'none'}`);
    const haveWrap = found.configuration?.wrap_cells === true;
    if (haveWrap !== plan.wrap) add(key, 'view wrap', `"${v.name}": cells ${plan.wrap ? 'should' : 'should not'} wrap, and they ${haveWrap ? 'do' : 'do not'}`);
  }
}

/**
 * Read every table back (its columns and its views) and compare with the structure. Extra views (Notion's own default view) are not a
 * difference. A table or a view that cannot be read is a difference too: a check that cannot run is reported, never skipped.
 */
export async function verifyStructure({ client, config, structure } = {}) {
  if (!client || typeof client.retrieveDataSource !== 'function') throw new TypeError('verifyStructure: a Notion client is required');
  validateStructure(structure);
  const differences = [];
  const seen = {}; // table -> { view name -> view id } for the views that were found
  const add = (table, kind, detail) => differences.push({ table, kind, detail });
  for (const key of TABLES) {
    const t = structure.tables[key];
    let entry = null;
    try {
      entry = tableEntry(config, key);
    } catch {
      entry = null;
    }
    if (!entry || !realId(entry.database_id) || !realId(entry.data_source_id)) {
      add(key, 'missing table', `config.json has no ids for "${t.title}" yet`);
      continue;
    }
    let dataSource;
    try {
      dataSource = await client.retrieveDataSource(entry.data_source_id);
    } catch (e) {
      add(key, 'missing table', `"${t.title}" cannot be read (${e.message})`);
      continue;
    }
    compareColumns(add, key, t, dataSource, config);
    const wanted = structure.views.filter((v) => v.table === key);
    if (wanted.length) await compareViews(add, key, structure, wanted, entry, client, dataSource, seen);
  }
  return { ok: differences.length === 0, differences, views: seen };
}

// ---- the dry run ----------------------------------------------------------------------------------------------------------------------------

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Markdown for the dry run: the sub-pages, then every table with its columns, options and views. */
export function renderPreview(structure) {
  validateStructure(structure);
  const counts = countStructure(structure);
  const lines = ['# Structure preview', ''];
  lines.push(`${counts.tables} tables, ${counts.columns} columns, ${counts.views} views and ${counts.pages} sub-pages, built under the parent page.`, '');
  lines.push('## Sub-pages', '');
  for (const title of structure.pages) lines.push(`- ${title}: ${PAGE_TEXT[pageKey(title)] ?? `${title}.`}`);
  lines.push('');
  for (const key of TABLES) {
    const t = structure.tables[key];
    lines.push(`## ${t.title} (${t.columns.length} columns)`, '');
    lines.push('| Column | Type | Options | Meaning |', '|---|---|---|---|');
    for (const c of t.columns) lines.push(`| ${cell(c.name)} | ${c.type} | ${cell(c.relation_to ? `points at the ${structure.tables[c.relation_to].title}` : c.options.join(', '))} | ${cell(c.description)} |`);
    const views = structure.views.filter((v) => v.table === key);
    if (views.length) {
      lines.push('', 'Views:', '');
      for (const v of views) {
        lines.push(`- **${v.name}**${v.renamed_from ? ` (the view "${v.renamed_from}" of an earlier build is renamed to this)` : ''}: rows shown: ${v.filter}; sorted by: ${v.sort}; columns: ${v.columns.join(', ')}${v.wrap ? '; cells wrap' : ''}`);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
