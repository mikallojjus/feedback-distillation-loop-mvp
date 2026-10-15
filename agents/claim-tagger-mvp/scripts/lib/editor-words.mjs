// The small helpers that every editor-facing sentence of the loop scripts (propose, distill, promote, followup, rollback, restore, status) uses:
// counts and lists in plain English, claims quoted and cut, the date-and-time stamp of a "Last run summary", the answer words of the queue, and
// the links to the tables and views of the Notion page. Nothing here writes or reads anything.
//
//   plural(n, one, many?)             -> "1 row" / "3 rows" (many defaults to one + "s")
//   listNames(names)                  -> "A", "A and B", "A, B and C"
//   capWords(text, max)               -> at most `max` words in one line; a cut text ends in "..."
//   cutText(text, max = 60)           -> one line of at most `max` characters; a cut text ends in "..."
//   quoted(text, max?)                -> "the text cut and in double quotes" (inner double quotes become single ones), exempt from the report lint
//   stampOf(date)                     -> "15 Oct 11:20" (local time): the date part of a Last run summary
//   answerWord(decision)              -> Applies / Does not apply / Can't tell for apply / do_not_apply / ask_editor
//   notionUrl(id)                     -> https://www.notion.so/<the 32 hex digits>
//   tableLink(config, table)          -> the link to a table of the agent (rulebook, claims_copy, tag_decisions, rule_changes, agent_settings)
//   viewLink(config, name)            -> the link to a view: your_queue, needs_your_note, lessons_waiting or rulebook. config.notion.views.<name>
//                                        may hold a view id, a link, or { id, url }; without it the link is the table's own
//   practiceLink(config)              -> the link to the practice page of a demo profile (else the Lessons waiting view)

import { tableEntry } from './config.mjs';
import { normId } from './notion-values.mjs';

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function listNames(names) {
  const list = [...names];
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

const squash = (text) => String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

export function capWords(text, max) {
  const words = squash(text).split(' ').filter(Boolean);
  return words.length <= max ? words.join(' ') : `${words.slice(0, max).join(' ')}...`;
}

export function cutText(text, max = 60) {
  const t = squash(text);
  if ([...t].length <= max) return t;
  return `${[...t].slice(0, Math.max(0, max - 3)).join('').trimEnd()}...`;
}

/** A claim or title for a sentence: cut, double quotes inside it made single, and put in double quotes (the lint leaves quoted text alone). */
export function quoted(text, max = 60) {
  return `"${cutText(text, max).replace(/["“”]/g, "'")}"`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');

export function stampOf(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function answerWord(decision) {
  switch (decision) {
    case 'apply': return 'Applies';
    case 'do_not_apply': return 'Does not apply';
    case 'ask_editor': return "Can't tell";
    default: return 'no answer';
  }
}

// ---- links -----------------------------------------------------------------------------------------------------------------------

const hex32 = (id) => normId(String(id ?? '').replace(/^collection:\/\//, ''));
const isSet = (id) => typeof id === 'string' && id.trim() !== '' && !id.trim().startsWith('<');

export const notionUrl = (id) => `https://www.notion.so/${hex32(id)}`;

const VIEW_TABLE = Object.freeze({ your_queue: 'tag_decisions', needs_your_note: 'tag_decisions', lessons_waiting: 'rule_changes', rulebook: 'rulebook' });

function databaseIdOf(config, table) {
  try {
    const id = tableEntry(config, table).database_id;
    return isSet(id) ? id : null;
  } catch {
    return null;
  }
}

/** The link to a table; the plain Notion address of the table, or the practice page's when the table is not set up yet. */
export function tableLink(config, table) {
  const id = databaseIdOf(config, table);
  return id ? notionUrl(id) : notionUrl(config?.notion?.parent_page_id ?? '');
}

export function viewLink(config, name) {
  const table = VIEW_TABLE[name];
  if (!table) throw new Error(`viewLink: unknown view "${name}" (expected one of ${Object.keys(VIEW_TABLE).join(', ')})`);
  const view = config?.notion?.views?.[name];
  const given = typeof view === 'string' ? view : (view && typeof view === 'object' ? (view.url ?? view.id ?? null) : null);
  if (typeof given === 'string' && /^https?:\/\//i.test(given)) return given;
  const db = databaseIdOf(config, table);
  if (isSet(given) && db) return `${notionUrl(db)}?v=${hex32(given)}`;
  return tableLink(config, table);
}

export function practiceLink(config) {
  const n = config?.notion ?? {};
  const page = [n.pages?.demo, n.pages?.practice, n.demo_page_id, n.page_id].find(isSet);
  return page ? notionUrl(page) : viewLink(config, 'lessons_waiting');
}
