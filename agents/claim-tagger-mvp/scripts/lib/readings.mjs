// Reading the decisions (docs/mvp-2026-11/READ-DECISIONS.md, decision P4 and decisions 64 to 76; v2: PORT-V2.md, P42 to P46). Where an editor decided a tag differently from the agent, the agent reads the
// disagreement itself: Agent slip (the rule as written settles it the editor's way and the agent misread), Rule unclear (the rule can honestly be read both ways on this claim) or Rule
// should change (the rule as written decides against the editor); the rule it points at; one line of why. Editors do not diagnose the agent, and no reason word in their note is obeyed (P45). Pure
// functions on the plain rows a pull writes (norm/claims.jsonl and norm/queue.jsonl) and on the rubric; nothing here reads or writes Notion, calls a model or touches a run folder (distill.mjs
// does that; the schema of the model's reply, schemas/reading-reply.schema.json, is the one file read).
//
//   READINGS, READING_COLUMNS              the three readings (one definition, lib/decisions.mjs) and the four Tag decisions columns that hold a reading: Agent's view of your decision, Rule, Why the agent thinks so, Read under
//   isDisagreement(row)                    true for a decided row whose decision differs from its Agent proposal (rowDisagrees; Can't tell differs from both outcomes)
//   readingHash({ outcome, proposal, noteLine, reasonWord, proposalEdition })   the first 8 hex characters of sha256 over a stable JSON of those five values (spaces in the note folded);
//                                          proposalEdition is the row's Rulebook edition, the edition the agent's proposal was made under. reasonWord is always null on v2 (it stays in the hash for shape)
//   readUnder(edition, hash8)              "<edition> · <hash8>", the text of the row's Read under (the cache key of a reading)
//   parseReadUnder(text)                   { edition, hash } or null. A row is current when the hash equals the current one; the edition is for people and is never compared
//   citedRule(row), agentCitedRule(row)    the rule number a row points at: in the editor's words ("rule N" in Your note) first, then the agent's own citation ("<Tag> rule N"); the agent's alone
//   classifyRows({ claims, ledgerRows, rubric, config })
//                                          { verbatim, toRead, current, agree, fixed, unjudged, orphans }. One item per DECIDED row (rowDecision), not per claim. Each item is
//                                          { row, claim, key, tag, decision, hash, edition, reasonWord, noteLine, citedRule }:
//                                            toRead    stale disagreements: the model reads them
//                                            current   disagreements whose Read under hash is unchanged (and that hold a reading): nothing to do
//                                            agree     decided rows where the decision equals the proposal
//                                            fixed     disagreements marked Fixed (a rule change resting on them went live): never read, never read again
//                                            orphans   items of a tag that is not judged under this config and rubric (no reading is made for them; the run says so)
//                                            verbatim, unjudged   always empty on v2 (there are no reason words, and a row is per tag); the keys stay so that distill and status need no branch
//   batchesOf(items, size)                 the items in lists of at most `size`, in order
//   buildReadingMessage(batch, rubric)     the user message of one model call: a <tag> block per tag, then <rows> with a <row> per item (claim, agent_reason, note), every text escaped
//   checkReadings(reply, batch, rubric)    { readings: Map(key -> { reading, rule, note }), problems }: the reply must fit the schema, read every key of the batch exactly once and no other,
//                                          point at a rule that exists for the row's tag (or null) and keep the note to 25 words. A reply with a problem is refused as a whole (readings is empty)
//   readingCells(item, reading, edition)   the four row values of a reading; "without your note · " opens the note when the editor wrote none (set here, never by the model)
//   readingOfRow(row)                      the reading a row holds, { reading, rule, note, noNote }, or null
//   pointsAtRule(row)                      true when the row's reading blames the rule (Rule unclear or Rule should change) and the editor wrote a note: a reading whose note opens "without your note"
//                                          is the agent's guess about an unexplained decision and never supports a draft (decision 78)
//   ledgerAsRead({ claims, ledgerRows, rubric, config })
//                                          { rows, classes }: the rows as distill would leave them before it asks a model anything (the decisions recorded in Decided under, the reading of a row that
//                                          stopped being a disagreement cleared), for status, promote and the follow-up
//   recantedKeys(lesson, ledgerRows)       the keys of the rows a rule change rests on (its supporting_keys) whose row does not point at a rule any more: no row, no longer a disagreement,
//                                          marked Fixed, or a reading that is not a rule reading (re-read as Agent slip after a changed note, or none) (decision 79)
//   recantedAmong(lessons, ledgerRows)     [{ lesson, keys, why }] for the Proposed or Approved lessons that have recanted keys; `why` is "slip" when every one reads Agent slip, else "other"
//   recantedLessons({ lessons, claims, ledgerRows, rubric, config })   the same over ledgerAsRead's rows (status and promote)
//   recantedPhrase(keys, why, { short })   "a decision the agent now reads as its own slip" / "a decision that no longer points at a rule" (plural for several), the words of the sentences
//   claimReadingCell({ claim, items, readings, unjudged })
//                                          the text of the claim's Agent's view of your decision, or null when it cannot be written yet (a disagreement has no reading); see the rules below
//   readingRecord(item, reading, source), reusableReading(line, item, rubric)   a line of readings.jsonl, and the reading a line gives back for an item whose hash it matches (or null)
//   xmlText(s), xmlAttr(s), renderTag(tag) the escaping and the tag block that distill.mjs uses for its own message too
//   constants: WITHOUT_NOTE, MAX_NOTE_WORDS
//
// The rules.
//  - A reading is made for a row (one claim and one tag), only where the decision (Tag outcome, or a tick on a sure proposal) differs from the proposal, and not where the row is marked Fixed.
//  - The flag "without your note" belongs to code (decision 67): a row has no note when the editor wrote nothing in Your note. The model is never asked for it.
//  - The claim's Agent's view of your decision has one line per read tag, tags in alphabetical order. A claim whose decided rows all agree reads "Nothing to read: the agent agreed with you."
//    A claim with a disagreement that has no reading yet gets no cell (null) this run. A row marked Fixed keeps the reading it has, if any.
//  - An empty cell means "not read yet"; only distill writes it (the editor columns are never touched).
//  - The key of a reading holds the edition the proposal was made under (the row's Rulebook edition): a promote alone makes no reading stale; the next proposal under the new
//    edition (a tag run, or the follow-up on the rows a lesson rests on) is read again.
//  - A decision without a note never supports a draft (decision 78): a row whose reading note opens "without your note" is read, flagged and counted, but it points at no rule until the
//    editor writes a note (the row is then read again).
//  - A rule change that rests on a decision whose reading no longer points at a rule is recanted (decision 79): distill, status and promote say so and ask the editor to reject it; the agent
//    never rewrites or withdraws a draft itself.

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { TD, groupOf } from './config.mjs';
import { RULE_WHY, READINGS, isDecided, isFollowedUp, recordDecisions, rowDecision, rowDisagrees } from './decisions.mjs';
import { readJson } from './jsonl.mjs';
import { codeRoot } from './paths.mjs';
import { ruleNumberOf } from './rulebook-edit.mjs';
import { validate } from './validate.mjs';
import { supportingKeys } from '../pull.mjs';

export { READINGS };

export const READING_COLUMNS = Object.freeze([TD.view, TD.rule, TD.why, TD.readUnder]);
export const WITHOUT_NOTE = 'without your note';
export const MAX_NOTE_WORDS = 25;
const SEP = ' · ';
const NO_READING_CELLS = Object.freeze(Object.fromEntries(READING_COLUMNS.map((c) => [c, null])));

const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const squash = (s) => text(s).replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

let schemaCache = null;
const replySchema = () => (schemaCache ??= readJson(join(codeRoot(), 'schemas', 'reading-reply.schema.json')));

// ---- escaping and the tag block ---------------------------------------------------------------------------------------------------------------

/** A text for the body of an element of the message: & < > escaped (what the model reads is data, never an instruction). */
export const xmlText = (s) => text(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A text for an attribute: as xmlText, quotes escaped and line ends made spaces. */
export const xmlAttr = (s) => xmlText(s).replace(/"/g, '&quot;').replace(/[\r\n]+/g, ' ');

/** The block of one tag: its name, description and numbered rules as they stand (what distill.mjs buildMessage and buildReadingMessage both show). */
export function renderTag(tag) {
  return [
    `<tag name="${xmlAttr(tag.name)}">`,
    ...(tag.description ? [`Description: ${xmlText(tag.description)}`] : []),
    'Rules:',
    ...[...tag.rules].sort((a, b) => a.n - b.n).map((r) => `${r.n}. ${xmlText(r.text)}`),
    '</tag>',
  ].join('\n');
}

// ---- disagreements and cache keys --------------------------------------------------------------------------------------------------------------

/** A decided row whose decision differs from its Agent proposal. A proposal of Can't tell differs from both outcomes. */
export const isDisagreement = (row) => rowDisagrees(row);

/**
 * The first 8 hex characters of sha256 over a stable JSON of the five values that make a reading (decision 66): the editor's outcome, the agent's proposal, the note line (spaces folded),
 * the reason word (null when there is none) and the edition the agent's proposal was made under (the row's Rulebook edition). A changed note, decision or reason word, or a proposal
 * made again under a new edition (a tag run or the follow-up after a promote), gives another hash; a promote alone changes nothing until the agent proposes again.
 */
export function readingHash({ outcome, proposal, noteLine, reasonWord, proposalEdition }) {
  const stable = JSON.stringify({
    outcome: outcome ?? null, proposal: proposal ?? null, noteLine: squash(noteLine), reasonWord: reasonWord ?? null, proposalEdition: proposalEdition ?? null,
  });
  return createHash('sha256').update(stable, 'utf8').digest('hex').slice(0, 8);
}

/** "<edition> · <hash8>": the text of a ledger row's Read under. */
export const readUnder = (edition, hash8) => `${edition}${SEP}${hash8}`;

/** { edition, hash } from a Read under text, or null when it is empty or not of that shape. */
export function parseReadUnder(value) {
  const m = /^(.+?)\s·\s([0-9a-f]{8})$/.exec(text(value).trim());
  return m ? { edition: m[1].trim(), hash: m[2] } : null;
}

// ---- the rule a row points at ------------------------------------------------------------------------------------------------------------------

/** The rule number the agent itself cited in a ledger row's Agent reason ("<Tag> rule N", the last one: the rule a run cited is at the end), or null. */
export function agentCitedRule(row) {
  const re = new RegExp(`${escapeRe(text(row?.[TD.tag]))}\\s+rule\\s+(\\d+)`, 'gi');
  let last = null;
  for (const m of text(row?.[TD.reason]).matchAll(re)) last = Number(m[1]);
  return last;
}

/** The rule number a decided row points at: "rule N" in Your note first, then "<Tag> rule N" in Agent reason (the last one), else null. */
export function citedRule(row) {
  const mine = /\brule\s*#?\s*(\d+)\b/i.exec(text(rowDecision(row).note));
  if (mine) return Number(mine[1]);
  return agentCitedRule(row);
}

const hasRule = (tag, n) => Number.isInteger(n) && (tag?.rules ?? []).some((r) => r.n === n);
const ruleLabel = (tagName, n) => (n === null || n === undefined ? null : `${tagName} rule ${n}`);

// the rule an item points at, checked against the tag: the one the note names, else the one the agent cited, else null
function ruleOfItem(row, noteLine, tag) {
  const mine = /\brule\s*#?\s*(\d+)\b/i.exec(text(noteLine));
  if (mine && hasRule(tag, Number(mine[1]))) return Number(mine[1]);
  const theirs = agentCitedRule({ [TD.tag]: tag.name, [TD.reason]: row?.[TD.reason] });
  return hasRule(tag, theirs) ? theirs : null;
}

// ---- classifying -------------------------------------------------------------------------------------------------------------------------------

const hasNoNote = (item) => item.reasonWord === null && squash(item.noteLine) === '';

/**
 * Sort the DECIDED rows into the ways a row can stand (see the header). `ledgerRows` are the rows of Tag decisions as they will be once the decisions are recorded (recordDecisions),
 * `claims` the pulled claim rows (they only name the item's claim: a row whose claim is not among them gets { geo_id, claim: <the row's Claim> }), `rubric` the rulebook in force.
 * `verbatim` and `unjudged` are always empty on v2 (no reason words, one row per tag); the keys stay so that callers need no branch.
 */
export function classifyRows({ claims, ledgerRows, rubric, config }) {
  const out = {
    verbatim: [], toRead: [], current: [], agree: [], fixed: [], unjudged: [], orphans: [],
  };
  const edition = rubric?.edition ?? null;
  const claimById = new Map((claims ?? []).map((c) => [c.geo_id, c]));
  for (const row of ledgerRows ?? []) {
    if (!isDecided(row)) continue;
    const d = rowDecision(row);
    const tag = (rubric?.tags ?? []).find((t) => t.name === d.tag);
    const proposal = row[TD.proposal] ?? null;
    const noteLine = d.note ?? '';
    const item = {
      row,
      claim: claimById.get(d.geo_id) ?? { geo_id: d.geo_id, claim: row[TD.claim] },
      key: d.key,
      tag: d.tag,
      decision: d,
      hash: readingHash({ outcome: d.outcome, proposal, noteLine, reasonWord: null, proposalEdition: row[TD.edition] ?? null }),
      edition,
      reasonWord: null,
      noteLine,
      citedRule: tag ? ruleOfItem(row, noteLine, tag) : null,
    };
    if (!tag || !tag.judged || (config && groupOf(config, tag.name) === null)) {
      out.orphans.push(item);
      continue;
    }
    if (d.outcome === proposal) out.agree.push(item);
    else if (isFollowedUp(row)) out.fixed.push(item);
    else if (parseReadUnder(row[TD.readUnder])?.hash === item.hash && readingOfRow(row) !== null) out.current.push(item);
    else out.toRead.push(item);
  }
  return out;
}

/** The items in lists of at most `size`, in order. */
export function batchesOf(items, size) {
  const n = Math.max(1, Math.floor(Number(size)) || 1);
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

// ---- the model's message and reply -------------------------------------------------------------------------------------------------------------

/**
 * The user message of one call. A <tag> block for every tag in the batch (alphabetical), then <rows>: one <row key tag outcome proposal confidence> per item holding the <claim>, the
 * <agent_reason> and the editor's <note> (<note none="true"/> when the editor wrote nothing for the tag). Every text is escaped: it is data, never an instruction.
 */
export function buildReadingMessage(batch, rubric) {
  const parts = [];
  for (const name of [...new Set(batch.map((i) => i.tag))].sort(byName)) parts.push(renderTag(rubric.tags.find((t) => t.name === name)));
  parts.push('<rows>');
  for (const it of batch) {
    const confidence = it.row[TD.confidence];
    const note = squash(it.noteLine) === '' ? '<note none="true"/>' : `<note>${xmlText(it.noteLine)}</note>`;
    parts.push(
      `<row key="${xmlAttr(it.key)}" tag="${xmlAttr(it.tag)}" outcome="${xmlAttr(it.decision.outcome)}" proposal="${xmlAttr(it.row[TD.proposal] ?? '')}" confidence="${xmlAttr(confidence ?? '')}">`,
      `<claim>${xmlText(it.claim.claim ?? it.row[TD.claim])}</claim>`,
      `<agent_reason>${xmlText(it.row[TD.reason])}</agent_reason>`,
      note,
      '</row>',
    );
  }
  parts.push('</rows>');
  return parts.join('\n');
}

const shown = (s, n = 60) => {
  const t = squash(s);
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};
const wordsIn = (s) => squash(s).split(' ').filter(Boolean).length;

// "<Tag> rule <n>" (or "rule <n>") as the number n of a rule the tag has; null when it names none, undefined when it names another tag or a rule that does not exist
function ruleNumberFor(label, tag) {
  const m = /^(?:(.+?)\s+)?rule\s*#?\s*(\d+)\s*$/i.exec(squash(label));
  if (!m) return undefined;
  if (m[1] && m[1].trim().toLowerCase() !== tag.name.toLowerCase()) return undefined;
  const n = Number(m[2]);
  return hasRule(tag, n) ? n : undefined;
}

/**
 * Check the model's reply for a batch. `reply` is the parsed JSON, `batch` the items it was asked about. Returns { readings: Map(key -> { reading, rule, note }), problems }. The reply must be
 * {"readings": [...]} that fits schemas/reading-reply.schema.json, read every key of the batch exactly once and no other key, point at "<Tag> rule <n>" for a rule the row's tag has (or
 * null) and keep the note to MAX_NOTE_WORDS words. One problem refuses the whole reply: `readings` is then empty.
 */
export function checkReadings(reply, batch, rubric) {
  const problems = [];
  const schemaErrors = validate(replySchema(), reply).errors;
  if (schemaErrors.length) return { readings: new Map(), problems: schemaErrors.slice(0, 5).map((e) => `the reply does not fit the reading schema: ${e}`) };
  const byKey = new Map(batch.map((i) => [i.key, i]));
  const readings = new Map();
  for (const r of reply.readings) {
    const at = shown(r.key);
    const item = byKey.get(r.key);
    if (!item) {
      problems.push(`the reply reads "${at}", which is not a row of the batch`);
      continue;
    }
    if (readings.has(r.key)) {
      problems.push(`the row "${at}" is read more than once`);
      continue;
    }
    const tag = rubric.tags.find((t) => t.name === item.tag);
    let rule = null;
    if (r.rule !== null) {
      const n = ruleNumberFor(r.rule, tag);
      if (n === undefined) problems.push(`the row "${at}" points at "${shown(r.rule)}", which is not a rule of ${item.tag}`);
      else rule = ruleLabel(tag.name, n);
    }
    const note = squash(r.note);
    if (note === '') problems.push(`the row "${at}" has an empty note`);
    else if (wordsIn(note) > MAX_NOTE_WORDS) problems.push(`the note of the row "${at}" has ${wordsIn(note)} words, more than ${MAX_NOTE_WORDS}`);
    readings.set(r.key, { reading: r.reading, rule, note });
  }
  for (const key of byKey.keys()) if (!readings.has(key)) problems.push(`the reply has no reading for the row "${shown(key)}"`);
  return problems.length ? { readings: new Map(), problems } : { readings, problems };
}

// ---- the cells ---------------------------------------------------------------------------------------------------------------------------------

/** The four row values of a reading (READING_COLUMNS). The note opens with "without your note · " when the editor wrote nothing for the tag. */
export function readingCells(item, reading, edition = item.edition) {
  return {
    [TD.view]: reading.reading,
    [TD.rule]: reading.rule ?? null,
    [TD.why]: hasNoNote(item) ? `${WITHOUT_NOTE}${SEP}${reading.note}` : reading.note,
    [TD.readUnder]: readUnder(edition, item.hash),
  };
}

/** All four reading columns emptied: what a row gets when it stopped being a disagreement. */
export const clearedReadingCells = () => ({ ...NO_READING_CELLS });

/** The reading a ledger row holds as { reading, rule, note, noNote } (the note without its "without your note · " opening), or null when the row holds none. */
export function readingOfRow(row) {
  const reading = text(row?.[TD.view]).trim();
  if (!READINGS.includes(reading)) return null;
  let note = text(row[TD.why]).trim();
  const prefix = `${WITHOUT_NOTE}${SEP}`;
  const noNote = note.startsWith(prefix);
  if (noNote) note = note.slice(prefix.length).trim();
  return { reading, rule: text(row[TD.rule]).trim() || null, note, noNote };
}

/**
 * True when a ledger row's reading blames the rule (Rule unclear or Rule should change) and the editor wrote a note (decision 78). A reading whose note opens "without your note" is the agent's
 * guess about an unexplained decision: it is shown and counted as a decision without a note, and it supports no draft until the editor writes a note and the row is read again.
 */
export function pointsAtRule(row) {
  const r = readingOfRow(row);
  return r !== null && RULE_WHY.has(r.reading) && !r.noNote;
}

/**
 * The rows as they stand once the decisions are recorded in Decided under (recordDecisions, the way distill records them first) and the reading of a row that stopped being a
 * disagreement is cleared, with the classification of the decided rows. A row the model has still to read keeps the reading it holds. `rows` are copies: nothing the caller passed
 * is changed. For status, promote and the follow-up, which look at the rows a rule change rests on without waiting for distill to write them.
 */
export function ledgerAsRead({ claims, ledgerRows, rubric, config }) {
  if (!rubric || !Array.isArray(rubric.tags)) return { rows: (ledgerRows ?? []).map((r) => ({ ...r })), classes: null };
  const { rows } = recordDecisions(ledgerRows);
  const classes = classifyRows({ claims, ledgerRows: rows, rubric, config });
  for (const item of classes.agree) if (READING_COLUMNS.some((c) => text(item.row[c]).trim() !== '')) Object.assign(item.row, clearedReadingCells());
  for (const row of rows) if (!isDecided(row) && READING_COLUMNS.some((c) => text(row[c]).trim() !== '')) Object.assign(row, clearedReadingCells()); // no decision, no reading
  return { rows, classes };
}

/** The keys of the rows a rule change rests on: its supporting_keys when the pull parsed them, else the keys at the end of the lines of its Supporting rows cell. */
const keysOfLesson = (lesson) => (Array.isArray(lesson?.supporting_keys) ? lesson.supporting_keys : supportingKeys(lesson?.['Supporting rows']));

/**
 * The keys of the rows `lesson` rests on whose ledger row does not point at a rule any more (decision 79): it is no longer a disagreement, it is marked Fixed (a rule change resting on it went
 * live), or its reading is not a rule reading any more (re-read as Agent slip after a reason word or a changed note, no reading, or a reading without a note). A key that has no ledger row at all is
 * not named here: promote and the follow-up already stop on a row that is not decided any more. `lesson` carries `supporting_keys` (the pull parses them; a caller that needs the keys of the
 * page body passes the whole list); `ledgerRows` are rows of Tag decisions as they stand.
 */
export function recantedKeys(lesson, ledgerRows) {
  const byKey = new Map((ledgerRows ?? []).map((r) => [r.Key, r]));
  return keysOfLesson(lesson).filter((key) => {
    const row = byKey.get(key);
    return row !== undefined && (!isDisagreement(row) || isFollowedUp(row) || !pointsAtRule(row));
  });
}

const isOpenLesson = (l) => l?.Status === 'Proposed' || l?.Status === 'Approved';

/**
 * The Proposed or Approved rule changes that rest on a decision whose reading no longer points at a rule: [{ lesson, keys, why }]. `why` is "slip" when every recanted row reads Agent slip with a
 * note of the editor's, else "other" (no reading, no longer a disagreement, Fixed, or a guess about a decision without a note).
 */
export function recantedAmong(lessons, ledgerRows) {
  const byKey = new Map((ledgerRows ?? []).map((r) => [r.Key, r]));
  const slip = (key) => {
    const row = byKey.get(key);
    const r = row && isDisagreement(row) && !isFollowedUp(row) ? readingOfRow(row) : null;
    return r !== null && r.reading === 'Agent slip' && !r.noNote;
  };
  const out = [];
  for (const lesson of lessons ?? []) {
    if (!isOpenLesson(lesson)) continue;
    const keys = recantedKeys(lesson, ledgerRows);
    if (keys.length) out.push({ lesson, keys, why: keys.every(slip) ? 'slip' : 'other' });
  }
  return out;
}

/** recantedAmong over the ledger as ledgerAsRead leaves it (status and promote); [] without a rulebook. */
export function recantedLessons({ lessons, claims, ledgerRows, rubric, config }) {
  if (!rubric || !Array.isArray(rubric.tags) || !(lessons ?? []).some(isOpenLesson)) return [];
  return recantedAmong(lessons, ledgerAsRead({ claims, ledgerRows, rubric, config }).rows);
}

/**
 * The words that say what a recanted rule change rests on: "a decision the agent now reads as its own slip" / "a decision that no longer points at a rule"; for several keys "3 decisions the
 * agent now reads as its own slips" / "3 decisions that no longer point at a rule". With `short` the slip is "a slip" (the cell of status's row). The editor never names a reason (P45).
 */
export function recantedPhrase(keys, why, { short = false } = {}) {
  const n = Array.isArray(keys) ? keys.length : Number(keys);
  const slip = short ? 'a slip' : 'its own slip';
  const slips = short ? 'slips' : 'its own slips';
  if (why === 'slip') return n === 1 ? `a decision the agent now reads as ${slip}` : `${n} decisions the agent now reads as ${slips}`;
  return n === 1 ? 'a decision that no longer points at a rule' : `${n} decisions that no longer point at a rule`;
}

// the reading an item has after this run: a fresh one, or the one its row holds when that is current (or the row is marked Fixed); null when it has none
function readingFor(item, readings) {
  const fresh = readings?.get(item.key);
  if (fresh) return fresh;
  const held = readingOfRow(item.row);
  if (held === null) return null;
  if (isFollowedUp(item.row) || parseReadUnder(item.row[TD.readUnder])?.hash === item.hash) return held;
  return null;
}

function claimLine(tag, r, noNote) {
  const n = ruleNumberOf(r.rule);
  return `${tag}: ${r.reading}${n !== null ? `, rule ${n}` : ''}${noNote ? `, ${WITHOUT_NOTE}` : ''}${SEP}${r.note}`;
}

/**
 * The text of a claim's Agent's view of your decision (decision 68). `items` are every decided row of the claim (the items of classifyRows for the claim, in any of its lists), `readings` the fresh readings
 * of this run as Map(key -> { reading, rule, note }), `unjudged` (always empty on v2) the entries ({ tag }) for tags the agent did not judge. One line per read tag, tags in
 * alphabetical order: "<Tag>: <reading>, rule <n> · <note>" ("<Tag>: <reading> · <note>" without a rule; ", without your note" after the rule when the editor wrote none), then
 * "<Tag>: the agent did not judge this tag, so nothing to read." per unjudged tag; "Nothing to read: the agent agreed with you." when judged tags exist and none differs. Returns null when
 * a disagreement has no reading yet (the cell is written once every one has) and when the claim has nothing to say.
 */
export function claimReadingCell({ claim, items, readings, unjudged }) {
  const mine = (items ?? []).filter((i) => i.claim === claim || i.claim?.geo_id === claim?.geo_id);
  const lines = [];
  const differing = mine.filter((i) => i.decision.outcome !== (i.row[TD.proposal] ?? null));
  for (const item of [...differing].sort((a, b) => byName(a.tag, b.tag))) {
    const r = readingFor(item, readings);
    if (r === null) {
      if (isFollowedUp(item.row)) continue; // a Fixed row is never read; it has nothing to show
      return null;
    }
    lines.push(claimLine(item.tag, r, r.noNote ?? hasNoNote(item)));
  }
  if (mine.length > 0 && differing.length === 0) lines.push('Nothing to read: the agent agreed with you.');
  for (const u of [...(unjudged ?? [])].map((x) => (typeof x === 'string' ? x : x.tag)).sort(byName)) lines.push(`${u}: the agent did not judge this tag, so nothing to read.`);
  return lines.length ? lines.join('\n') : null;
}

// ---- readings.jsonl ----------------------------------------------------------------------------------------------------------------------------

/** A line of runs/<run-id>/readings.jsonl: { key, hash, edition, source: "model" | "verbatim", reading, rule, note, no_note }. */
export function readingRecord(item, reading, source) {
  return {
    key: item.key, hash: item.hash, edition: item.edition, source, reading: reading.reading, rule: reading.rule ?? null, note: reading.note, no_note: hasNoNote(item),
  };
}

/**
 * The reading a line of an earlier run's readings.jsonl gives back for an item, or null: only a line the model made, for the same key, with the same hash, that still checks (a reading
 * of the three, a note, a rule the tag has now) is reused. Anything else is asked again.
 */
export function reusableReading(line, item, rubric) {
  if (!line || typeof line !== 'object' || line.source !== 'model' || line.key !== item.key || line.hash !== item.hash) return null;
  if (!READINGS.includes(line.reading) || typeof line.note !== 'string' || squash(line.note) === '' || wordsIn(line.note) > MAX_NOTE_WORDS) return null;
  const tag = rubric.tags.find((t) => t.name === item.tag);
  if (!tag) return null;
  let rule = null;
  if (line.rule !== null && line.rule !== undefined) {
    const n = ruleNumberFor(line.rule, tag);
    if (n === undefined) return null;
    rule = ruleLabel(tag.name, n);
  }
  return { reading: line.reading, rule, note: squash(line.note) };
}
