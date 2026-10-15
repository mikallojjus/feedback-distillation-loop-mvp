// The rulebook as the judge reads it: tags with numbered rules, parsed from the Rulebook copy's When to use, hashed, numbered by edition,
// locked on disk, and compared with the copy again on every command to find what an editor changed (CONTRACTS section 3).
//
//   parseRules(whenToUse)            -> { preamble, rules: [{ n, text }], note }
//   parseExamples(text)              -> string[]  (the Example Claims column, one claim per line)
//   tagFromRow(row, config)          -> the tag object of rubric.json (rules, examples, capability, judged, tag_hash)
//   buildRubric(rows, { config, edition, source, now }) -> the rubric object (tags sorted by name, rubric_hash); throws when it is not valid
//   nextEdition(previous, today)     -> 'YYYY-MM-DD.n'
//   verifyRubric(rubric)             -> { ok, errors }: the schema and every hash, judged flag and rule number recomputed
//   writeEdition(root, rubric, { reason }) -> writes rubric/rubric.json, rubric/rubric.lock, rubric/history/<edition>.json and one line of
//                                      rubric/CHANGELOG.md; returns { edition, rubric_hash, lock }
//   readRubric(root)                 -> the current rubric (verified), or null before the first edition
//   readLock(root)                   -> the current lock (validated), or null
//   readEdition(root, edition)       -> the rubric of one earlier edition from rubric/history (verified), or null
//   lockOf(rubric)                   -> the lock object writeEdition writes for a rubric (no file is touched)
//   checkLock(rubric, lock)          -> { ok, errors }: the lock says what the rubric says (edition, hashes, locked text and columns)
//   computeDrift(lock, rows, { config }) -> { judged: [{ tag, column }], adopted: [{ tag, columns }], missing: [name], added: [name] }
//   constants: DRIFT_COLUMNS
//
// A row is the plain shape of a Rulebook copy row: { Name, Category, Counterpart, Description, 'Example Claims', 'When to use', Polarity,
// Status, 'Geo Status', 'Geo Tag ID', 'Work tags': [..], 'Verified on', Evidence, page_id }; a missing key is the same as null. buildRubric and
// computeDrift take the rows of the copy as they are: choosing which rows count (the work tag filter) is the pull's job, and a row without
// a Name is not a tag and is skipped by both.
//
// Reading When to use. A line that starts with "<n>." or "<n>)" starts rule n. Lines before the first rule are the preamble. A line with no
// number continues the rule above it when a later rule follows it (a rule written over several lines). After the last rule a line continues
// that rule only while the rule has not ended with a full stop, a question or exclamation mark, a closing quote or a bracket, and no blank line or
// "Note:" label came first; everything after that is the note. So a note on the next line after a finished rule is a note, and so is anything
// after a blank line.
//
// The tag hash covers the tag's name and the text of its rules, nothing else: a changed description or example claim does not change it, which
// is why the lock also keeps the other columns. The rubric hash covers the sorted tag hashes of all tags, judged or not.
//
// Drift. computeDrift compares, for every tag that is in the lock, four columns of the copy (When to use, Description, Example Claims,
// Counterpart; the examples as parsed) with what the lock holds, after normaliseText. A tag whose locked When to use holds rules is judged:
// any difference goes to `judged` (the command stops with exit 4 and names the tag and the column). With `config` a tag counts as judged only
// when its capability is text and it belongs to a judge group, because only then can its rules change a verdict. Every other tag goes to
// `adopted` with the columns that differ (the caller writes a new edition; if the new text holds rules the tag becomes judged from then on).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { capabilityOf, groupOf, tableEntry } from './config.mjs';
import { h16 } from './hash.mjs';
import { readJson, writeJsonAtomic, writeTextAtomic } from './jsonl.mjs';
import { normaliseText } from './notion-values.mjs';
import { codeRoot } from './paths.mjs';
import { compareCodePoints, pyJson } from './pyjson.mjs';
import { validate } from './validate.mjs';

export const DRIFT_COLUMNS = Object.freeze(['When to use', 'Description', 'Example Claims', 'Counterpart']);

let schemaCache = null;
const rubricSchema = () => (schemaCache ??= readJson(join(codeRoot(), 'schemas', 'rubric.schema.json')));
const lockSchema = () => ({ definitions: rubricSchema().definitions, $ref: '#/definitions/lock' });

// ---- When to use and Example Claims -------------------------------------------------------------------------------------------------

const RULE_LINE = /^(\d+)[.)]\s+(\S.*)$/;
const NOTE_LABEL = /^notes?\s*:\s*/i;
const ENDS_A_SENTENCE = /[.!?…"'”’)\]]$/;

/** Split a When to use text into its preamble, its numbered rules and its note. Never throws: an empty or missing text has no rules. */
export function parseRules(whenToUse) {
  const lines = normaliseText(whenToUse ?? '').split('\n').map((line) => line.trim());
  const starts = [];
  lines.forEach((line, i) => {
    if (RULE_LINE.test(line)) starts.push(i);
  });
  if (starts.length === 0) return { preamble: lines.filter(Boolean).join(' '), rules: [], note: '' };

  const preamble = lines.slice(0, starts[0]).filter(Boolean).join(' ');
  const rules = [];
  let noteLines = [];
  starts.forEach((start, j) => {
    const [, n, first] = RULE_LINE.exec(lines[start]);
    let text = first;
    let i = start + 1;
    if (j < starts.length - 1) {
      for (; i < starts[j + 1]; i++) if (lines[i] !== '') text += ` ${lines[i]}`;
    } else {
      for (; i < lines.length; i++) {
        if (lines[i] === '' || NOTE_LABEL.test(lines[i]) || ENDS_A_SENTENCE.test(text)) break;
        text += ` ${lines[i]}`;
      }
      noteLines = lines.slice(i).filter(Boolean);
    }
    rules.push({ n: Number(n), text });
  });
  return { preamble, rules, note: noteLines.join(' ').replace(NOTE_LABEL, '') };
}

const QUOTES = [['"', '"'], ['“', '”'], ['‘', '’'], ["'", "'"], ['„', '“'], ['«', '»'], ['”', '”'], ['“', '“']];

// Takes one pair of surrounding quotes off a line, but only when the same quote characters do not also appear inside it.
function stripQuotes(line) {
  for (const [open, close] of QUOTES) {
    if (line.length > open.length + close.length && line.startsWith(open) && line.endsWith(close)) {
      const inner = line.slice(open.length, line.length - close.length);
      if (!inner.includes(open) && !inner.includes(close)) return inner.trim();
    }
  }
  return line;
}

/**
 * The example claims of an Example Claims column: one per line, a leading "- " and a pair of surrounding quotes (straight or curly)
 * taken off. Lines without a letter, longer than 400 characters, or mentioning "legacy linked claims" (a note, not a claim) are dropped.
 */
export function parseExamples(text) {
  const source = Array.isArray(text) ? text.join('\n') : text;
  const out = [];
  for (const raw of normaliseText(source ?? '').split('\n')) {
    const line = stripQuotes(raw.trim().replace(/^-\s+/, '').trim());
    if (!/\p{L}/u.test(line) || [...line].length > 400 || /legacy linked claims/i.test(line)) continue;
    out.push(line);
  }
  return out;
}

// ---- tags and the rubric ------------------------------------------------------------------------------------------------------------

const textOrNull = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const tagHashOf = (name, rules) => h16(pyJson({ name, rules: rules.map((r) => r.text) }));
const rubricHashOf = (tags) => h16(pyJson(tags.map((t) => t.tag_hash).sort(compareCodePoints)));

/** One Rulebook copy row as a tag of the rubric. The capability comes from config.tags; a tag is judged when it has rules and its capability is text. */
export function tagFromRow(row, config) {
  if (row === null || typeof row !== 'object') throw new TypeError('tagFromRow: a row must be an object');
  const name = textOrNull(row.Name);
  if (name === null) throw new Error('tagFromRow: the row has no Name');
  const whenToUse = row['When to use'] === null || row['When to use'] === undefined ? '' : String(row['When to use']);
  const { rules } = parseRules(whenToUse);
  const capability = capabilityOf(config, name);
  return {
    name,
    page_id: textOrNull(row.page_id),
    category: textOrNull(row.Category),
    polarity: textOrNull(row.Polarity),
    status: textOrNull(row.Status),
    counterpart: textOrNull(row.Counterpart),
    description: normaliseText(row.Description),
    when_to_use: whenToUse,
    rules,
    example_claims: parseExamples(row['Example Claims']),
    geo_status: textOrNull(row['Geo Status']),
    geo_tag_id: textOrNull(row['Geo Tag ID']),
    verified_on: textOrNull(row['Verified on']),
    evidence: textOrNull(row.Evidence),
    work_tags: Array.isArray(row['Work tags']) ? row['Work tags'].map(String) : [],
    capability,
    judged: rules.length > 0 && capability === 'text',
    tag_hash: tagHashOf(name, rules),
  };
}

function dayOf(date) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new RangeError(`not a date: ${String(date)}`);
  return d.toISOString().slice(0, 10);
}

/**
 * The edition after `previous`: 'YYYY-MM-DD.n' with the day in UTC. The same day (or a previous edition dated later than today, which
 * only a clock set back can cause) counts up; a new day, or no valid previous edition, starts at .1. `today` is a Date, an ISO time or a
 * 'YYYY-MM-DD' day.
 */
export function nextEdition(previous, today = new Date()) {
  const day = dayOf(today);
  const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(previous ?? '');
  return m && m[1] >= day ? `${m[1]}.${Number(m[2]) + 1}` : `${day}.1`;
}

/** Orders 'YYYY-MM-DD.n' editions: negative when a is earlier than b; by day, then by n as a number (so .10 comes after .9). */
export function compareEditions(a, b) {
  const [dayA, nA] = a.split('.');
  const [dayB, nB] = b.split('.');
  return dayA < dayB ? -1 : dayA > dayB ? 1 : Math.sign(Number(nA) - Number(nB));
}

function isoOf(now) {
  const value = typeof now === 'function' ? now() : now ?? new Date();
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError(`not a time: ${String(value)}`);
  return d.toISOString();
}

/**
 * The rubric object for a set of Rulebook copy rows. `edition` defaults to the first edition of today, `source` to the copy's ids read
 * through REST just now, `now` is a Date or a function that returns one. Tags are sorted by name; rubric_hash covers the sorted tag
 * hashes. Throws when two rows share a name, when there is no row with a name, or when the result does not verify.
 */
export function buildRubric(rows, { config, edition, source, now } = {}) {
  if (!Array.isArray(rows)) throw new TypeError('buildRubric: rows must be an array');
  if (!config) throw new TypeError('buildRubric: a config is required');
  const at = isoOf(now);
  const tags = rows.filter((row) => textOrNull(row?.Name) !== null).map((row) => tagFromRow(row, config));
  if (tags.length === 0) throw new Error('buildRubric: no row has a Name, so there is no rulebook to build');
  tags.sort((a, b) => compareCodePoints(a.name, b.name));
  for (let i = 1; i < tags.length; i++) if (tags[i].name === tags[i - 1].name) throw new Error(`buildRubric: two rows are named "${tags[i].name}"`);
  const entry = tableEntry(config, 'rulebook');
  const rubric = {
    edition: edition ?? nextEdition(null, at),
    built_at: at,
    source: source ?? { database_id: entry.database_id, data_source_id: entry.data_source_id, read_via: 'rest', read_at: at },
    tags,
    rubric_hash: rubricHashOf(tags),
  };
  const check = verifyRubric(rubric);
  if (!check.ok) throw new Error(`buildRubric: the rubric is not valid:\n- ${check.errors.join('\n- ')}`);
  return rubric;
}

/** The schema, then everything the hashes and flags promise: tag hashes, rubric hash, judged flags, tag order, unique names and rule numbers. */
export function verifyRubric(rubric) {
  const { errors } = validate(rubricSchema(), rubric);
  if (errors.length) return { ok: false, errors };
  const problems = [];
  const names = new Set();
  rubric.tags.forEach((tag, i) => {
    if (names.has(tag.name)) problems.push(`two tags are named "${tag.name}"`);
    names.add(tag.name);
    if (i > 0 && compareCodePoints(rubric.tags[i - 1].name, tag.name) > 0) problems.push(`"${tag.name}" is out of order: tags are sorted by name`);
    if (tag.tag_hash !== tagHashOf(tag.name, tag.rules)) problems.push(`${tag.name}: tag_hash does not match the name and rules`);
    if (tag.judged !== (tag.rules.length > 0 && tag.capability === 'text')) problems.push(`${tag.name}: judged must be true exactly when the tag has rules and its capability is text`);
    const numbers = tag.rules.map((r) => r.n);
    if (new Set(numbers).size !== numbers.length) problems.push(`${tag.name}: two rules have the same number (${numbers.join(', ')})`);
  });
  if (rubric.rubric_hash !== rubricHashOf(rubric.tags)) problems.push('rubric_hash does not match the tag hashes');
  return { ok: problems.length === 0, errors: problems };
}

// ---- files ---------------------------------------------------------------------------------------------------------------------------

const rubricDir = (root) => join(root, 'rubric');

/** The lock that writeEdition writes for a rubric, as an object and without touching any file: { edition, rubric_hash, locked_at, tags, text, columns }. */
export function lockOf(rubric) {
  const tags = {};
  const text = {};
  const columns = {};
  for (const tag of rubric.tags) {
    tags[tag.name] = tag.tag_hash;
    text[tag.name] = tag.when_to_use;
    columns[tag.name] = { Description: tag.description, 'Example Claims': tag.example_claims.join('\n'), Counterpart: tag.counterpart ?? '' };
  }
  return { edition: rubric.edition, rubric_hash: rubric.rubric_hash, locked_at: rubric.built_at, tags, text, columns };
}

/**
 * Whether a lock was made from this rubric: the same edition and rubric hash, and for every tag the same tag hash, locked When to use and
 * locked columns. A stop between the two writes of writeEdition (or a hand edit) shows up here as a list of what differs.
 */
export function checkLock(rubric, lock) {
  const errors = [];
  const expected = lockOf(rubric);
  for (const key of ['edition', 'rubric_hash']) if (lock?.[key] !== expected[key]) errors.push(`${key}: the lock says ${lock?.[key]}, the rubric says ${expected[key]}`);
  for (const [part, label, verb] of [['tags', 'tag hash', 'differs'], ['text', 'When to use text', 'differs'], ['columns', 'other columns', 'differ']]) {
    const names = [...new Set([...Object.keys(expected[part]), ...Object.keys(lock?.[part] ?? {})])].sort(compareCodePoints);
    for (const name of names) {
      if (!isDeepStrictEqual(lock?.[part]?.[name], expected[part][name])) errors.push(`${name}: the lock's ${label} ${verb} from the rubric`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Make `rubric` the current edition of the state folder `root`: history/<edition>.json (never rewritten with different rules), rubric.json,
 * rubric.lock, and one line in CHANGELOG.md: "- <date> · edition <edition> · <reason>". Nothing is written when the rubric does not verify.
 * Running it again for the same edition and rules (after a stop halfway) finishes the job and adds no second changelog line.
 */
export function writeEdition(root, rubric, { reason } = {}) {
  if (typeof reason !== 'string' || reason.trim() === '') throw new TypeError('writeEdition: a reason is required (it becomes the changelog line)');
  const check = verifyRubric(rubric);
  if (!check.ok) throw new Error(`writeEdition: the rubric is not valid:\n- ${check.errors.join('\n- ')}`);
  const dir = rubricDir(root);
  const historyFile = join(dir, 'history', `${rubric.edition}.json`);
  if (existsSync(historyFile) && readJson(historyFile).rubric_hash !== rubric.rubric_hash) {
    throw new Error(`writeEdition: edition ${rubric.edition} exists already with other rules; an edition is never rewritten, use the next one`);
  }
  const currentFile = join(dir, 'rubric.json');
  const current = existsSync(currentFile) ? readJson(currentFile)?.edition : null;
  if (typeof current === 'string' && /^\d{4}-\d{2}-\d{2}\.\d+$/.test(current) && compareEditions(rubric.edition, current) < 0) {
    throw new Error(`writeEdition: edition ${rubric.edition} is older than the current edition ${current}; editions only go forward`);
  }
  const lock = lockOf(rubric);
  writeJsonAtomic(historyFile, rubric);
  writeJsonAtomic(currentFile, rubric);
  writeJsonAtomic(join(dir, 'rubric.lock'), lock);

  const changelog = join(dir, 'CHANGELOG.md');
  const prefix = `- ${rubric.edition.slice(0, 10)} · edition ${rubric.edition} · `;
  let text = existsSync(changelog) ? readFileSync(changelog, 'utf8') : '';
  if (!text.split('\n').some((line) => line.startsWith(prefix))) {
    if (text !== '' && !text.endsWith('\n')) text += '\n';
    writeTextAtomic(changelog, `${text}${prefix}${reason.replace(/\s+/g, ' ').trim()}\n`);
  }
  return { edition: rubric.edition, rubric_hash: rubric.rubric_hash, lock };
}

function readVerified(file) {
  if (!existsSync(file)) return null;
  const rubric = readJson(file);
  const check = verifyRubric(rubric);
  if (!check.ok) throw new Error(`${file} is not a valid rulebook edition:\n- ${check.errors.join('\n- ')}`);
  return rubric;
}

/** rubric/rubric.json of a state folder, schema and hashes verified; null before the first edition exists. */
export function readRubric(root) {
  return readVerified(join(rubricDir(root), 'rubric.json'));
}

/** rubric/rubric.lock of a state folder, validated; null before the first edition exists. */
export function readLock(root) {
  const file = join(rubricDir(root), 'rubric.lock');
  if (!existsSync(file)) return null;
  const lock = readJson(file);
  const { errors } = validate(lockSchema(), lock);
  if (errors.length) throw new Error(`${file} is not a valid lock:\n- ${errors.join('\n- ')}`);
  return lock;
}

/** The rubric of one earlier edition (rubric/history/<edition>.json), verified; null when that edition does not exist. */
export function readEdition(root, edition) {
  if (typeof edition !== 'string' || !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(edition)) throw new TypeError(`readEdition: "${String(edition)}" is not an edition (YYYY-MM-DD.n)`);
  return readVerified(join(rubricDir(root), 'history', `${edition}.json`));
}

// ---- drift ---------------------------------------------------------------------------------------------------------------------------

const sameText = (a, b) => normaliseText(a ?? '') === normaliseText(b ?? '');

const lockedColumn = (lock, name, column) => (column === 'When to use' ? lock.text?.[name] : lock.columns?.[name]?.[column]);

function rowColumn(row, column) {
  if (column === 'Example Claims') return parseExamples(row[column]).join('\n');
  if (column === 'Counterpart') return textOrNull(row[column]) ?? '';
  return row[column] ?? '';
}

/**
 * What the Rulebook copy holds now against what the lock says. See the header for the buckets. Both lists are sorted by tag name; a
 * column the lock never recorded is not compared; two rows with the same name throw.
 */
export function computeDrift(lock, rows, { config } = {}) {
  if (lock === null || typeof lock !== 'object') throw new TypeError('computeDrift: the lock is missing');
  if (!Array.isArray(rows)) throw new TypeError('computeDrift: rows must be an array');
  const byName = new Map();
  for (const row of rows) {
    const name = textOrNull(row?.Name);
    if (name === null) continue;
    if (byName.has(name)) throw new Error(`computeDrift: two rows are named "${name}"`);
    byName.set(name, row);
  }
  const drift = { judged: [], adopted: [], missing: [], added: [] };
  for (const name of Object.keys(lock.tags ?? {}).sort(compareCodePoints)) {
    const row = byName.get(name);
    if (!row) {
      drift.missing.push(name);
      continue;
    }
    const differing = DRIFT_COLUMNS.filter((column) => {
      const locked = lockedColumn(lock, name, column);
      return locked !== undefined && !sameText(locked, rowColumn(row, column));
    });
    if (differing.length === 0) continue;
    const hasRules = parseRules(lock.text?.[name] ?? '').rules.length > 0;
    const judgedNow = hasRules && (!config || (capabilityOf(config, name) === 'text' && groupOf(config, name) !== null));
    if (judgedNow) for (const column of differing) drift.judged.push({ tag: name, column });
    else drift.adopted.push({ tag: name, columns: differing });
  }
  for (const name of [...byName.keys()].sort(compareCodePoints)) if (!Object.hasOwn(lock.tags ?? {}, name)) drift.added.push(name);
  return drift;
}
