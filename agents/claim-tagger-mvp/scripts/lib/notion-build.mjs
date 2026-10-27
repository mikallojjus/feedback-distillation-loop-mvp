// The REST structure builder: reads the approved structure proposal (docs/mvp-2026-11/STRUCTURE.md) into a structure object, turns it into
// the requests that build it under the parent page (sub-pages, five tables, four views), runs those requests resumably, and reads
// everything back to compare with the structure. Nothing here prints, reads .env or deletes anything: the client it is given sends GET, POST and
// PATCH only (lib/notion-rest.mjs), and every id the builder learns is recorded at once (runs/builder/*.json and config.json), so a run that
// stops halfway is finished by running it again.
//
//   structureFromProposal(markdown)            -> { tables: { rulebook|claims|tag_decisions|rule_changes|agent_settings: { title, description?, columns: [{ name, type, options, description, relation_to?, renamed_from?, retired? }], arrange_default_view? | default_view? { name?, columns } } },
//                                                   views: [{ name, table, filter, sort, columns, wrap, renamed_from? }], pages: ["Demos", "Demo tests"] }
//                                                  Throws StructureError (exit 2) naming the table and column when a type word is unknown, a table
//                                                  section or a "Values:" list is missing, or a view cannot be read. (The approved text of the proposal has no relation
//                                                  column and no renamed view; the revision of 16 October is written into setup/structure.json directly.)
//                                                  A relation column names the table it points at in relation_to; a view that was another view of the same table under an
//                                                  older name says so in renamed_from, and the builder renames that view instead of making a new one.
//   validateStructure(structure), loadStructure(root), saveStructure(root, structure), structurePath(root), countStructure(structure)
//   planStructure(structure, config, { inline }) -> { parent_page_id, pages: [{ key, title, text }], hub, databases: [{ table, title, description?, body }], columns: [{ table, name, type, relation_to, renamed_from, retired, body }],
//                                                   views: [{ table, name, columns, hidden, retired, wrap, renamed_from, body }], arrange: { <table>: { name, shown, hidden } } }
//                                                  body of a database is the POST /databases body (relation columns left out: the table they point at may not exist yet);
//                                                  columns lists every column but the title, so that what a table lacks can be added (PATCH data source); body of a view is the
//                                                  POST /views body without the ids
//   completeViewBody(viewPlan, dataSource, { databaseId }) -> the POST /views body, property ids filled from the created data source
//   defaultViewPlan(structure, table), ownViewName(names, wanted)   how the table's own view (Notion's default view) is arranged: { name, shown, hidden } or null; which view is it
//   arrangeOwnViews({ client, plan, table, databaseId, dataSourceId, log }) -> the names of the table's own views (Notion's default view) whose name or column order was set to the structure's
//                                                  inline false (the default) makes full-page tables (the production tables, P10), true inline ones (the practice page of the walkthrough). hub is the plan of the hub
//                                                  page's body (hubPlan) or null for a structure without a hub block; with a hub block the databases are planned in hub.table_order
//   hubPlan(structure), hubDifferences({ hub, config, children }), readHub({ client, config, hub })   the hub page (P11): its plan; its body compared with the plan (pure); the same read from Notion (GET only)
//   withGeoOptions(structure, { tagNames, spaceNames }) -> { structure, changes, changed }   the options of Geo Tags and Geo Space (setup.mjs structure --options-from); optionColor(table, column, name)
//   runStructure({ plan, client, root, config, log, parts }) -> { ok, code, stopped, pages, databases, columns, columnsRenamed, views, updated, arranged, hub, warnings, created }
//                                                  columnsRenamed: { <table>: [{ from, to }] }; updated: { <table>: { <view name>: ['filter', 'sorts', 'columns', 'wrap'] } } (views the table had
//                                                  that were brought to the structure); arranged: { <table>: [view names] } (the table's own views whose column order was set)
//   verifyStructure({ client, config, structure })  -> { ok, differences: [{ table, kind, detail }], views: { <table>: { <view name>: <view id> } } }
//   renderPreview(structure)                   -> Markdown for the dry run
//   parseViewFilter(text, table, where), parseViewSort(text, table, where)
//   viewKey(name), viewUrl(databaseId, viewId) -> 'your_queue'; 'https://www.notion.so/<database id>?v=<view id>' (ids without dashes)
//
// The hub (decisions P9 to P11, P14). A structure with a "hub" block ({ title, note, view_links, table_order, pages_after }) is built in this order: the tables in table_order (full-page tables,
// each with its description), their columns, the pages (Onboarding), the views (and the table's own views), and then the hub part, which appends the warning line (note) and the one-line links to
// some views at the start of the hub page (found by their text, so a run again adds none) and reads the page's body back: [the warning line][the link lines][the tables in table_order][the pages
// in pages_after, the archive page last]. What is out of place is a difference in plain words (the
// archive page above the tables: drag it to the bottom of the page in Notion), a block that belongs to none of them is a leftover; the hub part only appends, and never moves, edits or removes.
// A structure without a hub block (the fixtures of the earlier builds) is valid and builds as before.
//
// Columns. After the tables exist, runStructure first renames the columns of an earlier build that the structure gives another name (a column's `renamed_from`: the text columns
// Agent tags and Agent notes become "Agent tags (old)" and "Agent notes (old)", the relation "Claim quality tags — verified" becomes "Verified tags", and the select Why wrong of the
// Claims copy becomes "Why wrong (old)" (the editor no longer fills it in: the agent reads each disagreement itself, READ-DECISIONS.md; the Why wrong of Tag decisions keeps its name);
// a rename is made only when the old name is there with the same type and the new name is not), then adds every column of the structure that a table lacks (updateDataSource): a table
// made by an earlier build gains the columns of a later revision (Agent reading on the Claims copy; Agent reading, Rule, Reading note and Read under on Tag decisions), and the relation
// columns, which need the table they point at, are added this way too. A column that is there is never changed or removed. A `retired` column (the "(old)" ones) is never made on a new
// table: it exists only where a rename made it, and every view hides it.
//
// Views. A view the table has already is not left as it was: its filter, its sorts, its shown columns and their order, and whether cells wrap are compared with the structure and
// patched where they differ (updateView), so that a table built by an earlier revision gets the new filter of Your queue and the new column order. The views of a table that sets
// `arrange_default_view` (the practice page's Claims) include the views the structure does not name, Notion's own default view: they get the column order of the structure, every column
// visible and the retired ones hidden, and nothing else of theirs is changed. A table that sets `default_view` { name?, columns } (P15, every production table) has its own view (the one
// called name, else "Table", else the first; a view somebody made is left alone) called name and shows exactly those columns in that order, every other column hidden; that holds for a table
// that names no view of its own too (Agent settings). `verify` reads the name and the shown columns back, and the description the build writes only when it makes the table.
//
// Where the ids go. Pages: config.json notion.pages.<key> (demos, demo_tests) and runs/builder/pages.json. Tables: notion.rulebook, notion.claims,
// notion.databases.<table> (database_id, data_source_id) and runs/builder/databases.json (the table's id and its data source's, under <table> and
// <table>_data_source). Views: config.json notion.views.<key> = { id, url } for each view that exists (your_queue, needs_your_note, agent_disagreed, your_queue_ledger,
// needs_your_note_ledger, lessons_waiting, rulebook); the key is left out for a view that could not be made, so the scripts fall back to the table's address. runs/builder/state.json keeps
// what the last run found, the views that failed included ("views": "failed: <message>").
//
// The client must be a builder client (clientFromConfig(config, { apiVersion: BUILDER_API_VERSION })): database creates, data sources and views
// need Notion-Version 2026-03-11. Rows are written by other code with the default version (lib/plan.mjs).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHIVE_TITLE, archivedIds } from './archive.mjs';
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
  rulebook: 'Rulebook copy', claims: 'Claims copy', tag_decisions: 'Tag decisions', rule_changes: 'Rule changes', agent_settings: 'Agent settings',
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
const DEFAULT_VIEW_KEYS = Object.freeze(['name', 'columns']);

/** The one line of text on each sub-page the builder makes. */
export const PAGE_TEXT = Object.freeze({
  demos: 'Practice pages made by the walkthrough; never deleted.',
  demo_tests: 'Test runs of the walkthrough skill.',
  onboarding: 'Practice pages for new editors live here. Type /claim-tagger-walkthrough in Claude Code and give this page\'s link; nothing on a practice page touches the real Claims table.',
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
  claims: {
    'Geo Space': { 'U.S. Politics': 'blue', 'World affairs': 'green', AI: 'purple', Health: 'red', Crypto: 'orange', Technology: 'gray' },
    'Review status': { 'To review': 'yellow', Reviewed: 'green' },
    'Agent status': { 'Waits for you': 'yellow', Done: 'green', 'Disagrees with your decision': 'red', 'Could not read': 'gray' },
  },
  tag_decisions: {
    'Agent proposal': { Applies: 'green', 'Does not apply': 'red', "Can't tell": 'yellow' },
    'Tag outcome': { Applies: 'green', 'Does not apply': 'red' },
    'Why wrong': { 'Agent slip': 'gray', 'Rule unclear': 'yellow', 'Rule should change': 'orange' },
    'Agent reading': { 'Agent slip': 'gray', 'Rule unclear': 'yellow', 'Rule should change': 'orange' },
    'Follow-up': { Fixed: 'green', 'Still wrong': 'red' },
  },
  rule_changes: {
    Kind: { 'Clarify wording': 'blue', 'Change the rule': 'purple', 'Initial rules': 'gray' },
    Status: { Proposed: 'yellow', Approved: 'blue', Rejected: 'red', Live: 'green', 'Rolled back': 'gray' },
  },
});

/**
 * The colours an option takes when it is not listed in OPTION_COLORS and its column is one whose options come from a file (the Geo Tags of the Claims, from the pick): one of these,
 * chosen by a hash of the option's name alone, so a name keeps its colour whatever else is in the list and in whatever order (setup.mjs structure --options-from, run twice, changes nothing).
 */
export const HASHED_COLORS = Object.freeze({ claims: { 'Geo Tags': ['blue', 'brown', 'gray', 'green', 'orange', 'pink', 'purple', 'red', 'yellow'] } });

// FNV-1a over the UTF-8 bytes of the name: small, stable on every machine, no dependency.
function nameHash(name) {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(String(name), 'utf8')) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The colour of one option of a select column: the listed one, else the hashed one for a column that takes its options from a file, else 'default'. */
export function optionColor(table, column, name) {
  const listed = OPTION_COLORS[table]?.[column]?.[name];
  if (listed) return listed;
  const palette = HASHED_COLORS[table]?.[column];
  return palette ? palette[nameHash(name) % palette.length] : 'default';
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const escapeRe =(s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
      if (c.renamed_from !== undefined && (typeof c.renamed_from !== 'string' || c.renamed_from === '' || c.renamed_from === c.name)) {
        bad(`table "${t.title}", column "${c.name}": renamed_from must be another name that a column of the table had in an earlier build`);
      }
      if (c.retired !== undefined && typeof c.retired !== 'boolean') bad(`table "${t.title}", column "${c.name}": retired must be true or false`);
      if (c.retired === true && c.type === 'title') bad(`table "${t.title}", column "${c.name}": the title column cannot be retired`);
    }
    const olds = t.columns.map((c) => c.renamed_from).filter((x) => x !== undefined);
    if (new Set(olds).size !== olds.length) bad(`table "${t.title}": two columns are renamed from the same name`);
    if (t.arrange_default_view !== undefined && typeof t.arrange_default_view !== 'boolean') bad(`table "${t.title}": arrange_default_view must be true or false`);
    if (t.columns.filter((c) => c.type === 'title').length !== 1) bad(`table "${t.title}" needs exactly one title column`);
    // the one line Notion shows under the table's name (ED-8): optional, made with the table
    if (t.description !== undefined && (typeof t.description !== 'string' || t.description.trim() === '' || [...t.description].length > DESCRIPTION_MAX)) {
      bad(`table "${t.title}": the description must be one line of text of at most ${DESCRIPTION_MAX} characters`);
    }
    // the table's own first view (Notion's default view, P15): the columns it shows, in this order, and the name to give it (optional: without one it keeps Notion's)
    if (t.default_view !== undefined) {
      const dv = t.default_view;
      if (!isPlain(dv)) bad(`table "${t.title}": default_view must be an object { name?, columns }`);
      const stray = Object.keys(dv).filter((k) => !DEFAULT_VIEW_KEYS.includes(k));
      if (stray.length) bad(`table "${t.title}": default_view has "${stray[0]}", which is not part of it (it has ${DEFAULT_VIEW_KEYS.join(', ')})`);
      if (dv.name !== undefined && (typeof dv.name !== 'string' || dv.name.trim() === '')) bad(`table "${t.title}": default_view name must be text`);
      if (!Array.isArray(dv.columns) || dv.columns.length === 0) bad(`table "${t.title}": default_view needs the list of columns it shows`);
      if (new Set(dv.columns).size !== dv.columns.length) bad(`table "${t.title}": default_view lists a column twice`);
      for (const name of dv.columns) {
        const found = t.columns.find((c) => c.name === name);
        if (!found) bad(`table "${t.title}": default_view shows "${name}", which is not a column of the table`);
        if (found.retired === true) bad(`table "${t.title}": default_view shows "${name}", a retired column, which every view hides`);
      }
      if (t.arrange_default_view !== undefined) bad(`table "${t.title}": default_view says which columns the table's own view shows, so arrange_default_view is not given as well`);
      if (Array.isArray(structure.views) && structure.views.some((v) => isPlain(v) && v.table === key && v.name === dv.name)) bad(`table "${t.title}": default_view is called "${dv.name}", the name of one of its other views`);
    }
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
    for (const c of v.columns) {
      const found = structure.tables[v.table].columns.find((x) => x.name === c);
      if (!found) bad(`${where}: the table has no column "${c}"`);
      if (found.retired === true) bad(`${where}: "${c}" is a retired column, which every view hides`);
    }
    if (typeof v.wrap !== 'boolean') bad(`${where}: wrap must be true or false`);
    if (v.renamed_from !== undefined && (typeof v.renamed_from !== 'string' || v.renamed_from === '' || v.renamed_from === v.name)) bad(`${where}: renamed_from must be another name of a view of the same table`);
    parseViewFilter(v.filter, structure.tables[v.table], where);
    parseViewSort(v.sort, structure.tables[v.table], where);
  }
  if (!Array.isArray(structure.pages) || structure.pages.some((p) => typeof p !== 'string' || p === '')) bad('pages must be a list of page titles');
  if (structure.made_from !== undefined && (typeof structure.made_from !== 'string' || structure.made_from.trim() === '')) bad('made_from must be text naming the document the structure was made from');
  if (structure.hub !== undefined) validateHub(structure, bad);
  return structure;
}

const HUB_KEYS = Object.freeze(['title', 'note', 'view_links', 'table_order', 'pages_after']);

// The hub block (P11, P14): what the hub page holds besides its title, in order: the one line of warning (the note), the link lines to some views, the five tables, then some pages. A
// structure without one (the earlier builds) is valid and builds as before.
function validateHub(structure, bad) {
  const hub = structure.hub;
  if (!isPlain(hub)) bad('hub must be an object');
  const extra = Object.keys(hub).filter((k) => !HUB_KEYS.includes(k));
  if (extra.length) bad(`hub: "${extra[0]}" is not part of the hub block (it has ${HUB_KEYS.join(', ')})`);
  if (typeof hub.title !== 'string' || hub.title.trim() === '') bad('hub: title must be the name of the hub page');
  if (typeof hub.note !== 'string' || hub.note.trim() === '' || /[\r\n]/.test(hub.note) || [...hub.note].length > 300) bad('hub: note must be the one line of text above the link lines (at most 300 characters)');
  const list = (name, value) => {
    if (!Array.isArray(value) || value.length === 0 || value.some((x) => typeof x !== 'string' || x === '')) bad(`hub: ${name} must be a list of names`);
    if (new Set(value).size !== value.length) bad(`hub: ${name} names something twice`);
  };
  list('view_links', hub.view_links);
  const viewKeys = new Set(structure.views.map((v) => viewKey(v.name)));
  for (const k of hub.view_links) if (!viewKeys.has(k)) bad(`hub: view_links names "${k}", which is not the key of a view (the keys are ${[...viewKeys].join(', ')})`);
  list('table_order', hub.table_order);
  if (hub.table_order.length !== TABLES.length || TABLES.some((t) => !hub.table_order.includes(t))) bad(`hub: table_order must name each of the five tables once (${TABLES.join(', ')})`);
  list('pages_after', hub.pages_after);
  const pageKeys = structure.pages.map(pageKey);
  for (const k of hub.pages_after) if (k !== 'archive' && !pageKeys.includes(k)) bad(`hub: pages_after names "${k}", which is neither "archive" nor one of the pages (${pageKeys.join(', ') || 'none'})`);
  for (const k of pageKeys) if (!hub.pages_after.includes(k)) bad(`hub: pages_after does not place the page "${k}"`);
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

const byCodePoints = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The structure with the options of two columns of the Claims set from the Geo pick (setup.mjs structure --options-from): Geo Tags gets `tagNames` (the pick's tag_names, sorted
 * by code points here as well) and Geo Space gets `spaceNames` in the order given (config.geo.spaces). `structure` is not changed. Returns
 * { structure, changes: [{ column, added, removed, reordered }], changed }; running it again on its own result changes nothing. A list that is empty or names something twice is refused:
 * a select needs its values, and Notion would not take the same option twice.
 */
export function withGeoOptions(structure, { tagNames, spaceNames } = {}) {
  validateStructure(structure);
  const copy = structuredClone(structure);
  const changes = [];
  const plan = [['Geo Space', 'select', spaceNames], ['Geo Tags', 'multi_select', Array.isArray(tagNames) ? [...tagNames].sort(byCodePoints) : tagNames]];
  for (const [name, type, wanted] of plan) {
    const column = copy.tables.claims.columns.find((c) => c.name === name);
    if (!column) throw new StructureError(`the Claims table of the structure has no column "${name}"`);
    if (column.type !== type) throw new StructureError(`the column "${name}" of the Claims table is a ${column.type}, not a ${type}`);
    if (!Array.isArray(wanted) || wanted.length === 0 || wanted.some((x) => typeof x !== 'string' || x === '')) throw new StructureError(`there are no options to set for "${name}"; a select needs its values`);
    if (new Set(wanted).size !== wanted.length) throw new StructureError(`the options for "${name}" name something twice`);
    const before = column.options;
    const added = wanted.filter((o) => !before.includes(o));
    const removed = before.filter((o) => !wanted.includes(o));
    const reordered = added.length === 0 && removed.length === 0 && JSON.stringify(before) !== JSON.stringify(wanted);
    column.options = [...wanted];
    changes.push({ column: name, added, removed, reordered });
  }
  return { structure: validateStructure(copy), changes, changed: changes.some((c) => c.added.length || c.removed.length || c.reordered) };
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

/** The columns of a table that are in use: every column of the structure but the retired ones (the "(old)" columns of an earlier build, which are only ever renamed, never made). */
export const liveColumns = (structure, table) => structure.tables[table].columns.filter((c) => c.retired !== true);

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
    body[column.type] = { options: column.options.map((name) => ({ name, color: optionColor(table, column.name, name) })) };
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
  const retired = t.columns.filter((c) => c.retired === true).map((c) => c.name);
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
    retired,
    body: {
      name: view.name,
      type: 'table',
      ...(filter ? { filter } : {}),
      ...(sorts.length ? { sorts } : {}),
      configuration: { type: 'table', wrap_cells: view.wrap, properties },
    },
  };
}

/** What each link line on the hub page says after the view's name ("Your queue: the claims that wait for your decision"). Any other view gets its name in quotes. */
export const HUB_LINK_TEXT = Object.freeze({
  your_queue: 'the claims that wait for your decision',
  needs_your_note: 'claims where you overruled the agent and left no note',
  lessons_waiting: 'rule changes the agent drafted, for the rule owner to approve or reject',
});

/** The plan of the hub page's body (P11), or null for a structure without a hub block: the link lines with their text, the tables and pages in the order they stand. Pure. */
export function hubPlan(structure) {
  const hub = structure?.hub;
  if (!hub) return null;
  return {
    title: hub.title,
    note: hub.note,
    table_order: [...hub.table_order],
    pages_after: [...hub.pages_after],
    tables: Object.fromEntries(TABLES.map((t) => [t, structure.tables[t].title])),
    pages: Object.fromEntries(structure.pages.map((title) => [pageKey(title), title])),
    view_links: hub.view_links.map((key) => {
      const view = structure.views.find((v) => viewKey(v.name) === key);
      return { key, name: view.name, text: `${view.name}: ${HUB_LINK_TEXT[key] ?? `the view "${view.name}"`}` };
    }),
  };
}

/**
 * The REST plan for a structure under config.notion.parent_page_id. Pure: nothing is sent. `inline` says whether the tables are made as inline tables on the page
 * (is_inline true) or as full-page tables (false, the default: the production tables are full-page, P10); the practice page of the walkthrough passes true. With a hub block
 * the tables are planned in hub.table_order (the order they stand on the hub page), without one in the order of TABLES, and `hub` holds the plan of the page body.
 */
export function planStructure(structure, config, { inline = false } = {}) {
  validateStructure(structure);
  const parent = config?.notion?.parent_page_id;
  if (!realId(parent)) throw new StructureError('config.json has no notion.parent_page_id');
  const order = structure.hub ? structure.hub.table_order : TABLES;
  return {
    parent_page_id: parent,
    pages: structure.pages.map((title) => {
      const key = pageKey(title);
      return { key, title, text: PAGE_TEXT[key] ?? `${title}.` };
    }),
    hub: hubPlan(structure),
    databases: order.map((table) => {
      const t = structure.tables[table];
      const properties = {};
      for (const column of t.columns) if (column.type !== 'relation' && column.retired !== true) properties[column.name] = propertyConfig(table, column);
      return {
        table,
        title: t.title,
        ...(t.description ? { description: t.description } : {}),
        body: {
          parent: { type: 'page_id', page_id: parent },
          title: [{ type: 'text', text: { content: t.title } }],
          ...(t.description ? { description: [{ type: 'text', text: { content: t.description } }] } : {}),
          is_inline: inline === true,
          initial_data_source: { properties },
        },
      };
    }),
    columns: TABLES.flatMap((table) => structure.tables[table].columns
      .filter((c) => c.type !== 'title')
      .map((c) => ({
        table, name: c.name, type: c.type, relation_to: c.relation_to ?? null, renamed_from: c.renamed_from ?? null, retired: c.retired === true, body: propertyConfig(table, c),
      }))),
    views: structure.views.map((v) => viewPlan(structure, v)),
    // the table's own view (Notion's default view, which the structure does not name) is arranged too: see defaultViewPlan
    arrange: Object.fromEntries(TABLES.map((table) => [table, defaultViewPlan(structure, table)]).filter(([, arranged]) => arranged !== null)),
  };
}

/**
 * How the table's own view (Notion's default view, the one the structure's views do not name) is arranged, or null when the structure leaves it alone. { name, shown, hidden }:
 *   default_view { name?, columns }   it shows exactly those columns in that order, every other column hidden, and is called name (null: it keeps Notion's name)  (P15)
 *   arrange_default_view: true        it shows every live column in the structure's order and the retired ones are hidden; the name is left (the practice page's Claims)
 */
export function defaultViewPlan(structure, table) {
  const t = structure.tables[table];
  if (t.default_view) {
    return { name: t.default_view.name ?? null, shown: [...t.default_view.columns], hidden: t.columns.map((c) => c.name).filter((n) => !t.default_view.columns.includes(n)) };
  }
  if (t.arrange_default_view === true) return { name: null, shown: liveColumns(structure, table).map((c) => c.name), hidden: t.columns.filter((c) => c.retired === true).map((c) => c.name) };
  return null;
}

/** Which of the views the structure does not name is the table's own: the one called `wanted` (it was renamed already), else Notion's "Table", else the first. null without views. */
export function ownViewName(names, wanted = null) {
  if (wanted !== null && names.includes(wanted)) return wanted;
  if (names.includes('Table')) return 'Table';
  return names[0] ?? null;
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
  const retired = new Set(plan.retired ?? []);
  const properties = plan.body.configuration.properties.filter(({ name }) => props[name]?.id || !retired.has(name)).map(({ name, ...rest }) => {
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
// A child whose id is protected, or that setup/archive.json lists (the first build, set aside by `setup.mjs archive`, decision P9), is never adopted: it counts as not found.
async function findChild(ctx, type, title) {
  if (ctx.children === null) {
    try {
      ctx.children = await ctx.client.retrieveBlockChildren(ctx.plan.parent_page_id);
    } catch (e) {
      ctx.children = [];
      ctx.result.warnings.push(`the blocks under the parent page could not be listed (${e.message}); a page or table made by an earlier stopped run would not be noticed`);
    }
  }
  ctx.archived ??= archivedIds(ctx.root);
  const hits = ctx.children.filter((b) => b?.type === type && (b[type]?.title ?? '') === title && !isProtected(ctx.config, b.id) && !ctx.archived.has(normId(b.id)));
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
        created = await client.createDatabase({ parentPageId: plan.parent_page_id, title: db.title, description: db.description, isInline: db.body.is_inline === true, properties: db.body.initial_data_source.properties });
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

// Rename the columns of an earlier build that the structure gives another name, then add the columns a table lacks (updateDataSource, one call for the renames and one for the
// additions, per table): the columns of a revision that came after the table was made, and every relation column, which needs the table it points at. A column that is there is
// left as it is, whatever it holds; nothing is removed, and a rename keeps the column's contents. A rename happens only when the column of the old name has the type of the
// structure's column of the new name and the new name is free, so a table that already has the new shape is left alone and a second run finds nothing to do.
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
    const have = { ...(dataSource.properties ?? {}) };

    const renames = wanted.filter((c) => c.renamed_from && !have[c.name] && have[c.renamed_from]?.type === c.type);
    if (renames.length) {
      try {
        await client.updateDataSource(entry.data_source_id, { properties: Object.fromEntries(renames.map((c) => [c.renamed_from, { name: c.name }])) });
      } catch (e) {
        stopWith(ctx, `the renamed columns of "${table}"`, e);
        return;
      }
      for (const c of renames) {
        have[c.name] = { ...have[c.renamed_from], name: c.name };
        delete have[c.renamed_from];
      }
      result.columnsRenamed[table] = renames.map((c) => ({ from: c.renamed_from, to: c.name }));
      result.created.columns_renamed += renames.length;
      log(`table "${table}": ${renames.length} column(s) renamed (${renames.map((c) => `${c.renamed_from} -> ${c.name}`).join(', ')})`);
    }

    const missing = wanted.filter((c) => c.retired !== true && !have[c.name]);
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

// name -> view (the whole view, as retrieveView answers) for the views a table already has
async function existingViews(client, databaseId) {
  const out = new Map();
  for (const ref of await client.listViews(databaseId)) {
    const view = await client.retrieveView(ref.id);
    if (typeof view?.name === 'string' && !out.has(view.name)) out.set(view.name, { ...view, id: view.id ?? ref.id });
  }
  return out;
}

// ---- keeping a view as the structure says --------------------------------------------------------------------------------------------------------

// The properties of a view's configuration as [{ name, visible }], in the order the view shows them, with the names of the data source.
const configured = (view, nameOf) => (view?.configuration?.properties ?? []).map((p) => ({ name: nameOf(p.property_id), visible: p.visible !== false }));

// Does a view show `shown` in this order, and hide every column of `hidden` that the table has? (A column the view does not list may be visible, so it counts as not hidden.)
function columnsDiffer(shown, hidden, current, present) {
  if (stable(current.filter((p) => p.visible).map((p) => p.name)) !== stable(shown)) return true;
  const state = new Map(current.map((p) => [p.name, p.visible]));
  return hidden.filter((n) => present.has(n)).some((n) => state.get(n) !== false);
}

/**
 * The configuration to send for a view: `shown` in this order, `hidden` after them, then any column of the table the structure does not know (as visible as it is now). With `wrap`
 * true or false every shown column and the view wrap their cells or not; with null the view keeps its own wrap settings. The widths a view has are kept, and so are its other settings
 * (frozen columns, vertical lines, grouping, sub-tasks).
 */
function buildConfiguration(dataSource, { shown, hidden, wrap = null, found = null }) {
  const props = dataSource.properties ?? {};
  const nameOf = nameLookup(dataSource);
  const now = new Map((found?.configuration?.properties ?? []).map((p) => [nameOf(p.property_id), p]));
  const item = (name, visible) => {
    const was = now.get(name);
    return {
      property_id: props[name].id,
      visible,
      ...(visible ? (wrap === null ? (typeof was?.wrap === 'boolean' ? { wrap: was.wrap } : {}) : { wrap }) : {}),
      ...(Number.isInteger(was?.width) ? { width: was.width } : {}),
    };
  };
  const listed = new Set([...shown, ...hidden]);
  const properties = [
    ...shown.filter((n) => props[n]).map((n) => item(n, true)),
    ...hidden.filter((n) => props[n]).map((n) => item(n, false)),
    ...Object.keys(props).filter((n) => !listed.has(n)).map((n) => item(n, now.get(n)?.visible !== false)),
  ];
  const keep = {};
  for (const k of ['frozen_column_index', 'show_vertical_lines', 'group_by', 'subtasks']) {
    const v = found?.configuration?.[k];
    if (v === undefined || v === null) continue;
    if (k === 'frozen_column_index' && !(Number.isInteger(v) && v >= 0)) continue; // Notion reports -1 for "no frozen column" and refuses it back
    keep[k] = v;
  }
  const wrapCells = wrap === null ? found?.configuration?.wrap_cells : wrap;
  return { type: 'table', ...keep, ...(typeof wrapCells === 'boolean' ? { wrap_cells: wrapCells } : {}), properties };
}

/** What differs between a view of the table and its plan: any of 'filter', 'sorts', 'columns', 'wrap'. */
export function viewDifferences(plan, found, dataSource) {
  const nameOf = nameLookup(dataSource);
  const out = [];
  if (stable(canonFilter(plan.body.filter, (n) => n)) !== stable(canonFilter(found.filter, nameOf))) out.push('filter');
  if (stable(canonSorts(plan.body.sorts, (n) => n)) !== stable(canonSorts(found.sorts, nameOf))) out.push('sorts');
  if (columnsDiffer(plan.columns, plan.hidden, configured(found, nameOf), new Set(Object.keys(dataSource.properties ?? {})))) out.push('columns');
  if ((found.configuration?.wrap_cells === true) !== plan.wrap) out.push('wrap');
  return out;
}

// Bring one view of the table to its plan: only what differs is sent. A filter or sorts that the plan does not have cannot be taken away (the client never clears), so that is said.
async function reconcileView(ctx, table, plan, found, dataSource) {
  const { client, log, result } = ctx;
  const diff = viewDifferences(plan, found, dataSource);
  if (diff.length === 0) return [];
  const body = {};
  if (diff.includes('filter')) {
    if (plan.body.filter) body.filter = plan.body.filter;
    else result.warnings.push(`view "${plan.name}" of "${table}" has a filter that the structure does not have; the client never clears a filter, so it was left`);
  }
  if (diff.includes('sorts')) body.sorts = plan.body.sorts ?? [];
  if (diff.includes('columns') || diff.includes('wrap')) {
    body.configuration = buildConfiguration(dataSource, { shown: plan.columns, hidden: plan.hidden, wrap: plan.wrap, found });
  }
  if (Object.keys(body).length === 0) return [];
  await client.updateView(found.id, body);
  const done = diff.filter((d) => (d === 'filter' ? body.filter : d === 'sorts' ? body.sorts : body.configuration));
  result.created.views_updated += 1;
  (result.updated[table] ??= {})[plan.name] = done;
  log(`view "${plan.name}": updated (${done.join(', ')})`);
  return done;
}

// The table's own view (Notion's default view, the one the structure does not name), arranged as defaultViewPlan says: with a default_view it is called as the structure says and shows
// exactly the columns listed in their order (every other column hidden); with arrange_default_view it shows every live column in the structure's order, the retired ones hidden and
// the name left. Nothing else of the view is touched. A table that gives no name arranges every view the structure does not name; one that does arranges only its own view (the one
// already called that, else Notion's "Table", else the first), so a view somebody made by hand is left alone. A second run finds it arranged and sends nothing. Returns the names of the
// views that were changed (the name they had when the run began).
async function arrangeDefaultViews(ctx, table, have, dataSource) {
  const { plan, client, log, result } = ctx;
  const named = new Set(plan.views.filter((v) => v.table === table).flatMap((v) => [v.name, v.renamed_from].filter(Boolean)));
  const nameOf = nameLookup(dataSource);
  const { name: wanted, shown, hidden } = plan.arrange[table];
  const present = new Set(Object.keys(dataSource.properties ?? {}));
  const unnamed = [...have.keys()].filter((n) => !named.has(n));
  const targets = wanted === null ? unnamed : [ownViewName(unnamed, wanted)].filter(Boolean);
  const changed = [];
  for (const name of targets) {
    const found = have.get(name);
    const body = {};
    const said = [];
    if (wanted !== null && name !== wanted) {
      body.name = wanted;
      said.push(`called "${wanted}"`);
    }
    if (columnsDiffer(shown.filter((n) => present.has(n)), hidden, configured(found, nameOf), present)) {
      body.configuration = buildConfiguration(dataSource, { shown, hidden, found });
      said.push('column order and visibility set');
    }
    if (Object.keys(body).length === 0) continue;
    await client.updateView(found.id, body);
    if (body.name) {
      have.delete(name);
      have.set(wanted, { ...found, name: wanted });
    }
    changed.push(name);
    result.created.views_updated += 1;
    log(`view "${name}" (the table's own): ${said.join(', ')}`);
  }
  if (changed.length) result.arranged[table] = changed;
  return changed;
}

/**
 * Set the column order and visibility of the table's own views (the views the structure does not name: Notion's default view) to the structure's, for a table that sets
 * `arrange_default_view`. For a builder that makes its tables and views itself (the practice page): the relation columns are made after the others, so the default view
 * shows them last until this is called. `plan` is planStructure's answer. Returns the names of the views that were changed ([] when they were in order already).
 */
export async function arrangeOwnViews({ client, plan, table, databaseId, dataSourceId, log = () => {} } = {}) {
  if (!plan?.arrange?.[table]) return [];
  const dataSource = await client.retrieveDataSource(dataSourceId);
  const have = await existingViews(client, databaseId);
  const result = { created: { views_updated: 0 }, arranged: {} };
  return arrangeDefaultViews({ plan, client, log, result }, table, have, dataSource);
}

async function buildViews(ctx) {
  const { plan, client, config, log, result } = ctx;
  for (const table of TABLES) {
    const wanted = plan.views.filter((v) => v.table === table);
    if (wanted.length === 0 && !plan.arrange?.[table]) continue; // no view to make and the table's own view is left as it is
    const entry = tableEntry(config, table);
    if (!realId(entry.database_id) || !realId(entry.data_source_id)) {
      stopWith(ctx, `the views of "${table}"`, new Error(`the table "${table}" is not created yet; run "setup.mjs databases" first`));
      result.code = EXIT.INVALID;
      return;
    }
    const mine = wanted.length ? (result.views[table] = {}) : {}; // a table with only its own view to arrange has no entry among the views made
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
      let id = null;
      let status = null;
      if (have.has(v.name)) {
        id = have.get(v.name).id;
        status = 'exists';
        const known = config.notion?.views?.[viewKey(v.name)];
        if (!known || known.id !== normId(id) || known.url !== viewUrl(entry.database_id, id)) recordView(ctx, v, entry.database_id, id);
        log(`view "${v.name}": already there`);
      } else if (v.renamed_from && have.has(v.renamed_from)) {
        // the table has this view under its older name: give it the new one (the next step brings its filter, sorts and columns to the structure's)
        id = have.get(v.renamed_from).id;
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
        have.set(v.name, { ...have.get(v.renamed_from), name: v.name });
        have.delete(v.renamed_from);
        status = 'renamed';
        recordView(ctx, v, entry.database_id, id);
        result.created.renamed += 1;
        log(`view "${v.renamed_from}": renamed to "${v.name}" (${id})`);
      }
      if (status !== null) {
        let changed = [];
        try {
          changed = await reconcileView(ctx, table, v, have.get(v.name), dataSource);
        } catch (e) {
          if (e?.name === 'NotionError' && (e.status === 400 || e.status === 404)) {
            mine[v.name] = { id, status: 'failed', message: `the view could not be brought to the structure: ${e.message}`, url: viewUrl(entry.database_id, id) };
            log(`view "${v.name}": could not be updated (${e.message})`);
            previous = id;
            continue;
          }
          stopWith(ctx, `the view "${v.name}" of "${table}"`, e);
          return;
        }
        mine[v.name] = { id, status, url: viewUrl(entry.database_id, id), ...(changed.length ? { changed } : {}) };
        previous = id;
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
        have.set(v.name, { id: res.id, name: v.name });
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
    if (plan.arrange?.[table]) {
      try {
        await arrangeDefaultViews(ctx, table, have, dataSource);
      } catch (e) {
        if (e?.name === 'NotionError' && (e.status === 400 || e.status === 404)) {
          result.warnings.push(`the table's own view of "${table}" could not be arranged: ${e.message}`);
          continue;
        }
        stopWith(ctx, `the table's own view of "${table}"`, e);
        return;
      }
    }
  }
}

// ---- the hub page (P11) ---------------------------------------------------------------------------------------------------------------------

const plainText = (rich) => (Array.isArray(rich) ? rich.map((x) => x?.plain_text ?? x?.text?.content ?? '').join('') : '');
const short = (s, n = 60) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const blockWords = (b) => {
  if (b?.type === 'child_page') return b.child_page?.title ?? '';
  if (b?.type === 'child_database') return b.child_database?.title ?? '';
  return plainText(b?.[b?.type]?.rich_text);
};

// The warning above the link lines (P14): one plain paragraph.
const noteBlock = (text) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } });

// One link line: the view's name linked to the view, then the words that say what is in it.
function linkBlock(line, url) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: line.name, link: { url } } }, { type: 'text', text: { content: line.text.slice(line.name.length) } }] },
  };
}

// What the hub page should hold, in order, each with a test that tells whether a block is it: the link lines (matched by their text), the tables (by id), the pages (by id).
// A table or page whose id is not known yet is left out (the table check and the "not built yet" line say so); no archive page is expected before setup.mjs archive has recorded one.
function hubExpected(hub, config) {
  const items = [];
  const notBuilt = [];
  if (hub.note) items.push({ id: 'note', label: 'the warning line at the top', short: 'the warning line', match: (b) => b?.type === 'paragraph' && plainText(b.paragraph?.rich_text) === hub.note });
  for (const l of hub.view_links) {
    items.push({ id: `link:${l.key}`, label: `the link line "${l.name}"`, short: `link "${l.name}"`, match: (b) => b?.type === 'paragraph' && plainText(b.paragraph?.rich_text) === l.text });
  }
  for (const key of hub.table_order) {
    let id = null;
    try {
      id = realId(tableEntry(config, key).database_id);
    } catch {
      id = null;
    }
    if (!id) continue;
    const title = hub.tables[key] ?? key;
    items.push({ id: `table:${key}`, label: `the table "${title}"`, short: title, match: (b) => b?.type === 'child_database' && normId(b.id) === id });
  }
  for (const key of hub.pages_after) {
    const id = realId(config?.notion?.pages?.[key]);
    if (key === 'archive') {
      if (!id) continue;
      items.push({ id: 'page:archive', label: `the archive page "${ARCHIVE_TITLE}"`, short: 'the archive page', match: (b) => b?.type === 'child_page' && normId(b.id) === id });
      continue;
    }
    const title = hub.pages[key] ?? key;
    if (!id) {
      notBuilt.push(`the page "${title}" is not built yet (config.json has no id for it); run setup.mjs pages`);
      continue;
    }
    items.push({ id: `page:${key}`, label: `the page "${title}"`, short: title, match: (b) => b?.type === 'child_page' && normId(b.id) === id });
  }
  return { items, notBuilt };
}

/**
 * The hub page's body compared with its plan, from the blocks listed: { differences: [{ kind, detail }], leftovers: [{ id, type, text }] }. Pure. Differences are plain lines for
 * a person: a thing missing, things out of order (each with the one drag that puts it right), a block that belongs to none of them (a leftover, left alone), a link line that is there twice.
 */
export function hubDifferences({ hub, config, children }) {
  const { items, notBuilt } = hubExpected(hub, config);
  const differences = notBuilt.map((detail) => ({ kind: 'missing', detail }));
  const found = new Map();
  const leftovers = [];
  const actual = [];
  for (const b of children) {
    const item = items.find((i) => i.match(b));
    if (item && !found.has(item.id)) {
      found.set(item.id, b);
      actual.push(item.id);
    } else {
      leftovers.push({ id: normId(b.id), type: b.type ?? 'unknown', text: blockWords(b), duplicate: Boolean(item), of: item?.id === 'note' ? 'the warning line' : 'a link line' });
    }
  }
  for (const item of items) if (!found.has(item.id)) differences.push({ kind: 'missing', detail: `${item.label} is not on the hub page` });
  const present = items.map((i) => i.id).filter((id) => found.has(id));
  const names = (ids) => ids.map((id) => items.find((i) => i.id === id)?.short ?? id).join(', ');
  let now = actual;
  let want = present;
  const archiveAt = now.indexOf('page:archive');
  if (archiveAt >= 0 && archiveAt !== now.length - 1) {
    const after = now[archiveAt + 1];
    const above = after.startsWith('table:') || now.slice(archiveAt + 1).some((x) => x.startsWith('table:')) ? 'the tables' : after.startsWith('page:') ? 'Onboarding' : 'the link lines';
    differences.push({ kind: 'order', detail: `the archive page sits above ${above}: drag it to the bottom of the page in Notion` });
    now = now.filter((x) => x !== 'page:archive');
    want = want.filter((x) => x !== 'page:archive');
  }
  if (JSON.stringify(now) !== JSON.stringify(want)) {
    differences.push({ kind: 'order', detail: `the blocks of the hub page are not in order: they should be ${names(want)}, and they are ${names(now)}; drag them into that order in Notion` });
  }
  for (const l of leftovers) {
    differences.push({
      kind: 'leftover',
      detail: `${l.duplicate ? `a second copy of ${l.of}` : 'a block that is none of these'} is on the hub page and was left as it is: ${l.type}${l.text ? ` "${short(l.text)}"` : ''} (${l.id}); remove it by hand if it should not be there`,
    });
  }
  return { differences, leftovers };
}

/** GET only: the hub page's title and body against the plan. Returns { title, children, differences, leftovers }; a page that cannot be read is a difference, not an exception. */
export async function readHub({ client, config, hub }) {
  const rootId = realId(config?.notion?.parent_page_id);
  let title = null;
  let children = [];
  const differences = [];
  try {
    const page = await client.retrievePage(rootId);
    title = plainText(page?.properties?.title?.title);
    if (title !== hub.title) differences.push({ kind: 'title', detail: `the hub page is called "${title}" and should be called "${hub.title}": setup.mjs archive renames it, or rename it in Notion` });
  } catch (e) {
    differences.push({ kind: 'unreadable', detail: `the hub page cannot be read (${e.message})` });
    return { title, children, differences, leftovers: [] };
  }
  try {
    children = await client.retrieveBlockChildren(rootId);
  } catch (e) {
    differences.push({ kind: 'unreadable', detail: `the blocks of the hub page cannot be read (${e.message})` });
    return { title, children, differences, leftovers: [] };
  }
  const body = hubDifferences({ hub, config, children });
  return { title, children, differences: [...differences, ...body.differences], leftovers: body.leftovers };
}

// The hub part of a run: the three link lines at the start of the hub page (only the ones that are not there; a line is found by its text, so a second run adds nothing), then a
// report of the page's body against the plan. It adds blocks and changes none: nothing is moved, edited or removed here, and what is out of place is said in plain words.
async function buildHub(ctx) {
  const { plan, client, config, log, result } = ctx;
  const hub = plan.hub;
  const rootId = plan.parent_page_id;
  result.created.hub_links = 0;
  result.created.hub_note = 0;
  const added = [];
  const missing = [];
  let children;
  try {
    children = await client.retrieveBlockChildren(rootId);
    const views = config.notion?.views ?? {};
    const blocks = [];
    for (const line of hub.view_links) {
      if (children.some((b) => b?.type === 'paragraph' && plainText(b.paragraph?.rich_text) === line.text)) continue;
      const url = views[line.key]?.url;
      if (typeof url !== 'string' || url === '') {
        missing.push({ kind: 'link', line: line.name, detail: `the link line "${line.name}" cannot be added: config.json has no address for the view (notion.views.${line.key}); run setup.mjs views` });
        continue;
      }
      blocks.push({ line, block: linkBlock(line, url) });
    }
    // the warning line (P14) goes first, in the same request as the link lines when both are missing; with the warning there already, the link lines go right after it
    const noteAt = hub.note ? children.find((b) => b?.type === 'paragraph' && plainText(b.paragraph?.rich_text) === hub.note) : null;
    const fresh = [
      ...(hub.note && !noteAt ? [{ text: hub.note, name: 'the warning line', block: noteBlock(hub.note) }] : []),
      ...blocks.map((b) => ({ text: b.line.text, name: b.line.name, block: b.block })),
    ];
    if (fresh.length) {
      await client.appendBlocks(rootId, fresh.map((b) => b.block), { position: noteAt ? { type: 'after_block', after_block: { id: noteAt.id } } : { type: 'start' } });
      added.push(...fresh.map((b) => b.text));
      result.created.hub_links += blocks.length;
      result.created.hub_note = fresh.length - blocks.length;
      log(`hub page: ${fresh.length} line(s) added at the top (${fresh.map((b) => b.name).join(', ')})`);
    }
  } catch (e) {
    stopWith(ctx, 'the link lines on the hub page', e);
    return;
  }
  const read = await readHub({ client, config, hub });
  // a link line that could not be added is said once, with its reason, not again as "not on the hub page"
  const said = new Set(missing.map((m) => `the link line "${m.line}" is not on the hub page`));
  const differences = [...missing, ...read.differences.filter((d) => !said.has(d.detail))];
  result.hub = { added, differences, leftovers: read.leftovers, ok: differences.length === 0 };
  if (!added.length && !differences.length) log('hub page: the link lines are there and the body is in order');
}

function writeState(ctx) {
  const { root, result, plan } = ctx;
  const file = join(builderPaths(root).dir, 'state.json');
  const state = readJsonOr(file, { pages: {}, tables: {} });
  state.updated_at = new Date().toISOString();
  state.parent_page_id = plan.parent_page_id;
  state.archive_checked = true; // a build ran, so the gate on the archive was passed: the tables recorded here are this install's own, not a first build waiting to be archived (archive.mjs archiveFirst)
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
 * refuses (400 or 404) is recorded as failed and the run goes on. `parts` limits the run to some of 'pages', 'databases', 'views', 'hub'.
 *
 * With a hub block (plan.hub, P11) the order is: the tables in hub.table_order, their columns, the pages (Onboarding), the views, and a hub part that puts the link lines at the start
 * of the hub page and reports the page's body (result.hub: { added, differences, leftovers, ok }); the tables come first so that the pages made after them stand below them. The hub
 * part adds blocks and never moves, edits or removes one. Without a hub block the order is pages, tables, views, as it was.
 */
export async function runStructure({ plan, client, root = agentRoot(), config, log = () => {}, parts = ['pages', 'databases', 'views', 'hub'] } = {}) {
  if (!plan || !Array.isArray(plan.pages) || !Array.isArray(plan.databases) || !Array.isArray(plan.views)) throw new TypeError('runStructure: a plan from planStructure is required');
  if (!client || typeof client.createDatabase !== 'function') throw new TypeError('runStructure: a Notion client is required');
  if (!config) throw new TypeError('runStructure: the config is required');
  if (isProtected(config, plan.parent_page_id)) throw new StructureError('the parent page is on the protected list of config.json; the builder never builds there');
  const result = {
    ok: true, code: EXIT.OK, stopped: null, pages: {}, databases: {}, columns: {}, columnsRenamed: {}, views: {}, updated: {}, arranged: {}, hub: null, warnings: [],
    created: { pages: 0, databases: 0, columns: 0, views: 0, renamed: 0, columns_renamed: 0, views_updated: 0 }, // plus hub_links when the plan has a hub block
  };
  const ctx = { plan, client, root, config, log, result, children: null };
  const doPages = async () => {
    if (parts.includes('pages')) await buildPages(ctx);
  };
  const doTables = async () => {
    if (parts.includes('databases')) {
      await buildDatabases(ctx);
      if (result.ok) await buildColumns(ctx);
    }
  };
  try {
    if (plan.hub) {
      await doTables();
      if (result.ok) await doPages();
    } else {
      await doPages();
      if (result.ok) await doTables();
    }
    if (result.ok && parts.includes('views')) await buildViews(ctx);
    if (result.ok && plan.hub && parts.includes('hub')) await buildHub(ctx);
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
      if (c.retired === true) continue; // a retired column exists only where a rename made it
      const old = c.renamed_from && actual[c.renamed_from] ? ` ("${c.renamed_from}" is there under its old name; setup.mjs build renames it)` : '';
      add(key, 'missing column', `"${c.name}" (${c.type}) is not in the table${old}`);
      continue;
    }
    if (def.type !== c.type) {
      const successor = t.columns.find((o) => o.renamed_from === c.name && o.type === def.type);
      add(key, 'type', `"${c.name}" is ${def.type} in Notion but ${c.type} in the structure${successor ? `; setup.mjs build renames it to "${successor.name}" and adds the new one` : ''}`);
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
  // the table's own view (a view the structure does not name) of a table that arranges it (defaultViewPlan): its name when the structure gives one, and exactly the columns it shows, in order
  const arranged = defaultViewPlan(structure, key);
  if (arranged) {
    const named = new Set(structure.views.filter((v) => v.table === key).flatMap((v) => [v.name, v.renamed_from].filter(Boolean)));
    const present = new Set(Object.keys(dataSource?.properties ?? {}));
    const unnamed = views.filter((x) => x && !named.has(x.name));
    let targets = unnamed;
    if (arranged.name !== null) {
      // Notion makes one such view for every table; a table that has none (somebody removed it) has nothing to arrange or to compare
      const own = ownViewName(unnamed.map((x) => x.name), arranged.name);
      targets = unnamed.filter((x) => x.name === own);
      if (targets.length && own !== arranged.name) add(key, 'view name', `the table's own view is called "${own}" and the structure calls it "${arranged.name}"`);
    }
    for (const found of targets) {
      const haveShown = (found.configuration?.properties ?? []).filter((p) => p.visible !== false).map((p) => nameOf(p.property_id));
      const wantShown = arranged.shown.filter((n) => present.has(n));
      const known = haveShown.filter((n) => structure.tables[key].columns.some((c) => c.name === n)); // a column the structure does not know is not compared
      if (stable(wantShown) !== stable(known)) add(key, 'view columns', `"${found.name}" (the table's own view): expected ${wantShown.join(', ')}; found ${known.join(', ') || 'none'}`);
    }
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
    if (wanted.length || defaultViewPlan(structure, key)) await compareViews(add, key, structure, wanted, entry, client, dataSource, seen);
    if (structure.hub || t.description !== undefined) await compareDatabase(add, key, t, entry, client, { fullPage: Boolean(structure.hub) });
  }
  if (structure.hub) {
    // the hub page: its title, the order of its body and its leftovers, as the hub part of the build reports them (an order difference is a difference here, so verify is ok only when the page is in order)
    const read = await readHub({ client, config, hub: hubPlan(structure) });
    for (const d of read.differences) add('hub', d.kind, d.detail);
  }
  return { ok: differences.length === 0, differences, views: seen };
}

// The table itself, read once: a production table is a full-page table (P10, is_inline false; an inline table would sit inside the hub page's body instead of being a page of its own), and
// the one line under its name is the structure's description (ED-8).
async function compareDatabase(add, key, t, entry, client, { fullPage }) {
  try {
    const db = await client.retrieveDatabase(entry.database_id);
    if (t.description !== undefined) {
      const has = (Array.isArray(db?.description) ? db.description : []).map((x) => x?.plain_text ?? x?.text?.content ?? '').join('');
      if (has !== t.description) add(key, 'description', `"${t.title}" has the description ${JSON.stringify(has)}, the structure says ${JSON.stringify(t.description)}; write it in Notion under the table's name (the build writes it only when it makes the table)`);
    }
    if (fullPage && db?.is_inline !== false) add(key, 'inline', `"${t.title}" ${db?.is_inline === true ? 'is an inline table' : `reads is_inline ${JSON.stringify(db?.is_inline ?? null)}`}, but the structure builds full-page tables; turn it into a full-page table in Notion`);
  } catch (e) {
    add(key, 'inline', `"${t.title}" cannot be read to see whether it is a full-page table and what its description is (${e.message})`);
  }
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
  const hub = hubPlan(structure);
  if (hub) {
    lines.push(`## Hub page "${hub.title}"`, '');
    lines.push('The hub page holds only links, in this order (nothing on it is moved, edited or removed by a later run; what is out of place is reported):', '');
    lines.push(`1. the warning line at the very top: ${hub.note}`);
    lines.push(`2. ${hub.view_links.length} link lines at the top: ${hub.view_links.map((l) => l.text).join('; ')}`);
    lines.push(`3. the ${hub.table_order.length} tables as full-page tables, in this order: ${hub.table_order.map((t) => hub.tables[t]).join(', ')}`);
    lines.push(`4. then: ${hub.pages_after.map((k) => (k === 'archive' ? `the archive page "${ARCHIVE_TITLE}" (made by setup.mjs archive; it sits above the tables until a person drags it down)` : hub.pages[k])).join(', ')}`);
    lines.push('');
  }
  for (const key of structure.hub ? structure.hub.table_order : TABLES) {
    const t = structure.tables[key];
    lines.push(`## ${t.title} (${t.columns.length} columns)`, '');
    if (t.description) lines.push(`Description under the table's name: ${t.description}`, '');
    lines.push('| Column | Type | Options | Meaning |', '|---|---|---|---|');
    for (const c of t.columns) {
      const options = c.relation_to ? `points at the ${structure.tables[c.relation_to].title}` : c.options.join(', ');
      const note = [c.renamed_from ? `the column "${c.renamed_from}" of an earlier build is renamed to this` : null, c.retired ? 'retired: never made on a new table, hidden in every view' : null].filter(Boolean).join('; ');
      lines.push(`| ${cell(c.name)} | ${c.type} | ${cell(options)} | ${cell(c.description)}${note ? ` (${cell(note)})` : ''} |`);
    }
    const views = structure.views.filter((v) => v.table === key);
    const own = defaultViewPlan(structure, key);
    if (views.length || own) {
      lines.push('', 'Views:', '');
      for (const v of views) {
        lines.push(`- **${v.name}**${v.renamed_from ? ` (the view "${v.renamed_from}" of an earlier build is renamed to this)` : ''}: rows shown: ${v.filter}; sorted by: ${v.sort}; columns: ${v.columns.join(', ')}${v.wrap ? '; cells wrap' : ''}`);
      }
      if (own) lines.push(`- The table's own view (Notion's default)${own.name ? `, called ${own.name}` : ''}: shows ${own.shown.join(', ')}${own.hidden.length ? `; the other ${own.hidden.length} column${own.hidden.length === 1 ? ' is' : 's are'} hidden` : ''}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
