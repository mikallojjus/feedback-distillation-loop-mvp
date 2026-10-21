// The small helpers that every editor-facing sentence of the loop scripts (propose, distill, promote, followup, rollback, restore, status) uses:
// counts and lists in plain English, claims quoted and cut, the date-and-time stamp of a "Last run summary", the answer words of the queue, and
// the links to the tables and views of the Notion page. Nothing here writes or reads anything.
//
//   plural(n, one, many?)             -> "1 row" / "3 rows" (many defaults to one + "s")
//   yourClaims(n)                     -> "your claim" / "your two claims" / "your 14 claims": how a Next line names the claims an editor is to decide (the words of `where` and of the page)
//   listNames(names)                  -> "A", "A and B", "A, B and C"
//   capWords(text, max)               -> at most `max` words in one line; a cut text ends in "..."
//   reasonLine({ reason, rule_ref }, agreed, runs, max) -> the text of an Agent reason: the reason in at most `max` words, the rule cited, "<k> of <n> runs agree"
//   cutText(text, max = 60)           -> one line of at most `max` characters; a cut text ends in "..."
//   quoted(text, max?)                -> "the text cut and in double quotes" (inner double quotes become single ones), exempt from the report lint
//   quotedWhole(text)                 -> the same, never cut: for text an editor is to copy whole (the complete wording of a rule)
//   stampOf(date)                     -> "15 Oct 11:20" (local time): the date part of a Last run summary
//   answerWord(decision)              -> Applies / Does not apply / Can't tell for apply / do_not_apply / ask_editor
//   notionUrl(id, title?)             -> https://www.notion.so/<the 32 hex digits>; with a title the form Notion itself gives a page: https://app.notion.com/p/<the title's words joined by dashes>-<the 32 hex digits>
//   tableLink(config, table)          -> the link to a table of the agent (rulebook, claims_copy, tag_decisions, rule_changes, agent_settings)
//   viewLink(config, name)            -> the link to a view: your_queue, needs_your_note, agent_disagreed (all three on the Claims copy), your_queue_ledger,
//                                        needs_your_note_ledger (the two old views of Tag decisions), lessons_waiting or rulebook. config.notion.views.<name>
//                                        may hold a view id, a link, or { id, url }; without it the link is the table's own
//   practiceLink(config)              -> the link to the practice page of a demo profile, in the form of Notion's own link with the page's title (else the Lessons waiting view)
//   practiceTitle(config)             -> the title of the practice page a demo profile acts on (config.demo_title, written by the walkthrough
//                                        runner), else null: outside a demo, or when the profile has no title
//   namePracticePage(config, sentence) -> the first sentence of a demo report naming that page: "Status: ..." becomes "Status of the practice page
//                                        <title>: ...", any other sentence gets " (practice page <title>)" before its final period; unchanged
//                                        without a title, and when it already names the page
//   demoCommands(text)                -> the slash commands of a report in their demo form: "/claim-tagger promote" -> "/claim-tagger demo promote"
//                                        (a command that already says demo is left alone, so it can run twice)

import { tableEntry } from './config.mjs';
import { normId } from './notion-values.mjs';

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "your claim", "your two claims", "your 14 claims": the claims an editor is to decide, in the words the page and `where` use (a count up to ten is spelled out). */
export const yourClaims = (n) => (n === 1 ? 'your claim' : `your ${n >= 0 && n <= 10 ? NUMBER_WORDS[n] : n} claims`);

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

/** The text of an Agent reason (the ledger's column, and a line of the claim's Agent reasons): "<reason> · <rule cited> · <k> of <n> runs agree". */
export function reasonLine(entry, agreed, runs, max = 40) {
  return [capWords(entry.reason, max), entry.rule_ref, `${agreed} of ${runs} runs agree`].filter(Boolean).join(' · ');
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

/** Like quoted, but the whole text: for a text the editor has to copy complete. Inner double quotes become single ones so the report lint still leaves it alone. */
export function quotedWhole(text) {
  return `"${squash(text).replace(/["“”]/g, "'")}"`;
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

/** The words of a title as Notion puts them in a link: letters and digits, every other run of characters one dash ("Claim tagger practice · 15 Oct 14:22" -> "Claim-tagger-practice-15-Oct-14-22"). */
const slugOf = (title) => String(title ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function notionUrl(id, title = null) {
  const slug = slugOf(title);
  return slug ? `https://app.notion.com/p/${slug}-${hex32(id)}` : `https://www.notion.so/${hex32(id)}`;
}

const VIEW_TABLE = Object.freeze({
  your_queue: 'claims_copy', needs_your_note: 'claims_copy', agent_disagreed: 'claims_copy',
  your_queue_ledger: 'tag_decisions', needs_your_note_ledger: 'tag_decisions', lessons_waiting: 'rule_changes', rulebook: 'rulebook',
});

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
  return page ? notionUrl(page, practiceTitle(config)) : viewLink(config, 'lessons_waiting');
}

// ---- the practice page in a demo's reports -------------------------------------------------------------------------------------------

/** The title of the practice page a demo profile acts on, or null (not a demo, or no demo_title in the profile). */
export function practiceTitle(config) {
  if (config?.demo !== true) return null;
  const title = squash(config.demo_title);
  return title === '' ? null : title;
}

/** The first sentence of a report, naming the practice page in a demo (see the header); the sentence as it is anywhere else. */
export function namePracticePage(config, sentence) {
  const text = String(sentence ?? '');
  const title = practiceTitle(config);
  if (title === null || text === '' || text.includes(`practice page ${title}`)) return text;
  if (text.startsWith('Status:')) return `Status of the practice page ${title}:${text.slice('Status:'.length)}`;
  return text.endsWith('.') ? `${text.slice(0, -1)} (practice page ${title}).` : `${text} (practice page ${title})`;
}

/** The slash commands of a report as an editor on a practice page types them: "/claim-tagger tag" -> "/claim-tagger demo tag". */
export function demoCommands(text) {
  return String(text ?? '').replace(/\/claim-tagger (?!demo\b)(?=[a-z])/g, '/claim-tagger demo ');
}
