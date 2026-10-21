// Reading the decisions (docs/mvp-2026-11/READ-DECISIONS.md, decision P4 and decisions 64 to 76). Where an editor decided a tag differently from the agent, the agent reads the
// disagreement itself: Agent slip (the rule as written settles it the editor's way and the agent misread), Rule unclear (the rule can honestly be read both ways on this claim) or Rule
// should change (the rule as written decides against the editor); the rule it points at; one line of why. Editors no longer diagnose the agent. Pure functions on the plain rows a pull
// writes (norm/claims.jsonl and norm/queue.jsonl) and on the rubric; nothing here reads or writes Notion, calls a model or touches a run folder (distill.mjs does that; the schema of the
// model's reply, schemas/reading-reply.schema.json, is the one file read).
//
//   READINGS, READING_COLUMNS              the three readings (one definition, lib/decisions.mjs) and the four ledger columns that hold a reading: Agent reading, Rule, Reading note, Read under
//   isDisagreement(row)                    true for a decided ledger row whose Tag outcome differs from its Agent proposal (Can't tell differs from both outcomes)
//   tagRulesHash(rubric, tag)              the tag's tag_hash in the rubric file: it changes when the tag's rules change
//   readingHash({ outcome, proposal, noteLine, reasonWord, rulesHash })   the first 8 hex characters of sha256 over a stable JSON of those five values (spaces in the note folded)
//   readUnder(edition, hash8)              "<edition> · <hash8>", the text of the ledger's Read under (the cache key of a reading)
//   parseReadUnder(text)                   { edition, hash } or null. A row is current when the hash equals the current one; the edition is for people and is never compared
//   citedRule(row), agentCitedRule(row)    the rule number a ledger row points at: in the editor's words ("rule N") first, then the agent's own citation ("<Tag> rule N"); the agent's alone
//   classifyRows({ claims, ledgerRows, rubric, config })
//                                          { verbatim, toRead, current, agree, fixed, unjudged, orphans }. Only Reviewed claims count (decisionsFor). Each item is
//                                          { row, claim, key, tag, decision, hash, edition, reasonWord, noteLine, citedRule }:
//                                            verbatim  disagreements whose note line opens with a reason word and whose Read under hash is stale: the reading is the editor's word, no model call
//                                            toRead    stale disagreements without a reason word: the model reads them
//                                            current   disagreements whose Read under hash is unchanged (and that hold a reading): nothing to do
//                                            agree     judged tags where the outcome equals the proposal
//                                            fixed     disagreements marked Fixed (a rule change resting on them went live): never read, never read again
//                                            unjudged  { claim, tag } for a note line that names a rulebook tag the agent did not judge on that claim
//                                            orphans   items of a tag that is not judged under this config and rubric (no reading is made for them; the run says so)
//   verbatimReading(item)                  { reading, rule, note } of a verbatim item: the word, the rule the note names (else the agent's), "Your note says so."
//   batchesOf(items, size)                 the items in lists of at most `size`, in order
//   buildReadingMessage(batch, rubric)     the user message of one model call: a <tag> block per tag, then <rows> with a <row> per item (claim, agent_reason, note), every text escaped
//   checkReadings(reply, batch, rubric)    { readings: Map(key -> { reading, rule, note }), problems }: the reply must fit the schema, read every key of the batch exactly once and no other,
//                                          point at a rule that exists for the row's tag (or null) and keep the note to 25 words. A reply with a problem is refused as a whole (readings is empty)
//   readingCells(item, reading, edition)   the four ledger values of a reading; "without your note · " opens the note when the editor wrote none (set here, never by the model)
//   readingOfRow(row)                      the reading a ledger row holds, { reading, rule, note, noNote }, or null
//   claimReadingCell({ claim, items, readings, unjudged })
//                                          the text of the claim's Agent reading, or null when it cannot be written yet (a disagreement has no reading); see the rules below
//   readingRecord(item, reading, source), reusableReading(line, item, rubric)   a line of readings.jsonl, and the reading a line gives back for an item whose hash it matches (or null)
//   xmlText(s), xmlAttr(s), renderTag(tag) the escaping and the tag block that distill.mjs uses for its own message too
//   constants: YOUR_NOTE_SAYS_SO, WITHOUT_NOTE, MAX_NOTE_WORDS
//
// The rules.
//  - A reading is made for a (claim, tag), only on a Reviewed claim, only where the editor's outcome differs from the proposal, and not where the row is marked Fixed.
//  - The reason word of a note line (decisionsFor: Agent slip, Rule unclear or Rule should change, then a full stop) is applied as it stands. Removing it hands the row back to the model.
//  - The flag "without your note" belongs to code (decision 67): a row has no note when the editor wrote neither a reason word nor any words for the tag. The model is never asked for it.
//  - The claim's Agent reading has one line per read tag, tags in alphabetical order, then the "did not judge" line of each unjudged tag. A Reviewed claim whose judged tags all agree reads
//    "Nothing to read: the agent agreed with you." A claim with a disagreement that has no reading yet gets no cell (null) this run. A row marked Fixed keeps the reading it has, if any.
//  - An empty cell means "not read yet"; only distill writes it (the editor columns are never touched).

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { groupOf } from './config.mjs';
import { READINGS, decisionsFor, isFollowedUp, isReviewed, parseTagLines } from './decisions.mjs';
import { readJson } from './jsonl.mjs';
import { codeRoot } from './paths.mjs';
import { ruleNumberOf } from './rulebook-edit.mjs';
import { validate } from './validate.mjs';

export { READINGS };

export const READING_COLUMNS = Object.freeze(['Agent reading', 'Rule', 'Reading note', 'Read under']);
export const YOUR_NOTE_SAYS_SO = 'Your note says so.';
export const WITHOUT_NOTE = 'without your note';
export const MAX_NOTE_WORDS = 25;
const SEP = ' · ';
const NO_READING_CELLS = Object.freeze({ 'Agent reading': null, Rule: null, 'Reading note': null, 'Read under': null });

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

/** A decided ledger row whose Tag outcome differs from its Agent proposal. A proposal of Can't tell differs from both outcomes. */
export function isDisagreement(row) {
  const outcome = text(row?.['Tag outcome']).trim();
  return outcome !== '' && outcome !== text(row?.['Agent proposal']).trim();
}

/** The hash of the tag's rules in the rubric file (tag_hash: the tag's name and the text of its rules), or null for a tag the rubric does not hold. */
export function tagRulesHash(rubric, tag) {
  return rubric?.tags?.find((t) => t.name === tag)?.tag_hash ?? null;
}

/**
 * The first 8 hex characters of sha256 over a stable JSON of the five values that make a reading (decision 66): the editor's outcome, the agent's proposal, the note line (spaces folded),
 * the reason word (null when there is none) and the hash of the tag's rules. A changed note, decision, reason word or rule gives another hash.
 */
export function readingHash({ outcome, proposal, noteLine, reasonWord, rulesHash }) {
  const stable = JSON.stringify({
    outcome: outcome ?? null, proposal: proposal ?? null, noteLine: squash(noteLine), reasonWord: reasonWord ?? null, rulesHash: rulesHash ?? null,
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
  const re = new RegExp(`${escapeRe(text(row?.Tag))}\\s+rule\\s+(\\d+)`, 'gi');
  let last = null;
  for (const m of text(row?.['Agent reason']).matchAll(re)) last = Number(m[1]);
  return last;
}

/** The rule number a decided row points at: "rule N" in Your reasoning first, then "<Tag> rule N" in Agent reason (the last one), else null. */
export function citedRule(row) {
  const mine = /\brule\s*#?\s*(\d+)\b/i.exec(text(row?.['Your reasoning']));
  if (mine) return Number(mine[1]);
  return agentCitedRule(row);
}

const hasRule = (tag, n) => Number.isInteger(n) && (tag?.rules ?? []).some((r) => r.n === n);
const ruleLabel = (tagName, n) => (n === null || n === undefined ? null : `${tagName} rule ${n}`);

// the rule an item points at, checked against the tag: the one the note names, else the one the agent cited, else null
function ruleOfItem(row, noteLine, tag) {
  const mine = /\brule\s*#?\s*(\d+)\b/i.exec(text(noteLine));
  if (mine && hasRule(tag, Number(mine[1]))) return Number(mine[1]);
  const theirs = agentCitedRule({ Tag: tag.name, 'Agent reason': row?.['Agent reason'] });
  return hasRule(tag, theirs) ? theirs : null;
}

// ---- classifying -------------------------------------------------------------------------------------------------------------------------------

const hasNoNote = (item) => item.reasonWord === null && squash(item.noteLine) === '';

/**
 * Sort the judged tags of every Reviewed claim into the ways a row can stand (see the header). `ledgerRows` are the rows of Tag decisions as they will be once the decisions are copied
 * (syncDecisions), `claims` the pulled claim rows, `rubric` the rulebook in force. The names of every tag of the rubric are what a note line may start with, so a line for a tag the agent
 * did not judge is its own entry and never becomes part of another tag's note.
 */
export function classifyRows({ claims, ledgerRows, rubric, config }) {
  const out = {
    verbatim: [], toRead: [], current: [], agree: [], fixed: [], unjudged: [], orphans: [],
  };
  const edition = rubric?.edition ?? null;
  const tagNames = (rubric?.tags ?? []).map((t) => t.name);
  const byKey = new Map((ledgerRows ?? []).map((r) => [r.Key, r]));
  for (const claim of claims ?? []) {
    if (!isReviewed(claim)) continue;
    const decisions = decisionsFor(claim, ledgerRows, { tagNames });
    for (const d of decisions) {
      const row = byKey.get(d.key);
      const tag = rubric.tags.find((t) => t.name === d.tag);
      const proposal = row['Agent proposal'] ?? null;
      const noteLine = d.reasoning ?? '';
      const item = {
        row,
        claim,
        key: d.key,
        tag: d.tag,
        decision: d,
        hash: readingHash({ outcome: d.outcome, proposal, noteLine, reasonWord: d.why_wrong ?? null, rulesHash: tag?.tag_hash ?? null }),
        edition,
        reasonWord: d.why_wrong ?? null,
        noteLine,
        citedRule: tag ? ruleOfItem(row, noteLine, tag) : null,
      };
      if (!tag || !tag.judged || (config && groupOf(config, tag.name) === null)) {
        out.orphans.push(item);
        continue;
      }
      if (d.outcome === proposal) out.agree.push(item);
      else if (isFollowedUp(row)) out.fixed.push(item);
      else if (parseReadUnder(row['Read under'])?.hash === item.hash && readingOfRow(row) !== null) out.current.push(item);
      else if (item.reasonWord !== null) out.verbatim.push(item);
      else out.toRead.push(item);
    }
    const judged = new Set(decisions.map((d) => d.tag));
    const lines = parseTagLines(claim.challenged_notes, tagNames);
    for (const tag of lines ? [...lines.keys()].sort(byName) : []) if (!judged.has(tag)) out.unjudged.push({ claim, tag });
  }
  return out;
}

/** The reading of a verbatim item: the editor's reason word, the rule the note names (else the one the agent cited, else none), and "Your note says so." */
export function verbatimReading(item) {
  return { reading: item.reasonWord, rule: ruleLabel(item.tag, item.citedRule), note: YOUR_NOTE_SAYS_SO };
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
    const confidence = it.row['Agent confidence'];
    const note = squash(it.noteLine) === '' ? '<note none="true"/>' : `<note>${xmlText(it.noteLine)}</note>`;
    parts.push(
      `<row key="${xmlAttr(it.key)}" tag="${xmlAttr(it.tag)}" outcome="${xmlAttr(it.decision.outcome)}" proposal="${xmlAttr(it.row['Agent proposal'] ?? '')}" confidence="${xmlAttr(confidence ?? '')}">`,
      `<claim>${xmlText(it.claim.claim ?? it.row.Claim)}</claim>`,
      `<agent_reason>${xmlText(it.row['Agent reason'])}</agent_reason>`,
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

/** The four ledger values of a reading (READING_COLUMNS). The note opens with "without your note · " when the editor wrote nothing for the tag. */
export function readingCells(item, reading, edition = item.edition) {
  return {
    'Agent reading': reading.reading,
    Rule: reading.rule ?? null,
    'Reading note': hasNoNote(item) ? `${WITHOUT_NOTE}${SEP}${reading.note}` : reading.note,
    'Read under': readUnder(edition, item.hash),
  };
}

/** All four reading columns emptied: what a row gets when it stopped being a disagreement. */
export const clearedReadingCells = () => ({ ...NO_READING_CELLS });

/** The reading a ledger row holds as { reading, rule, note, noNote } (the note without its "without your note · " opening), or null when the row holds none. */
export function readingOfRow(row) {
  const reading = text(row?.['Agent reading']).trim();
  if (!READINGS.includes(reading)) return null;
  let note = text(row['Reading note']).trim();
  const prefix = `${WITHOUT_NOTE}${SEP}`;
  const noNote = note.startsWith(prefix);
  if (noNote) note = note.slice(prefix.length).trim();
  return { reading, rule: text(row.Rule).trim() || null, note, noNote };
}

// the reading an item has after this run: a fresh one, or the one its row holds when that is current (or the row is marked Fixed); null when it has none
function readingFor(item, readings) {
  const fresh = readings?.get(item.key);
  if (fresh) return fresh;
  const held = readingOfRow(item.row);
  if (held === null) return null;
  if (isFollowedUp(item.row) || parseReadUnder(item.row['Read under'])?.hash === item.hash) return held;
  return null;
}

function claimLine(tag, r, noNote) {
  const n = ruleNumberOf(r.rule);
  return `${tag}: ${r.reading}${n !== null ? `, rule ${n}` : ''}${noNote ? `, ${WITHOUT_NOTE}` : ''}${SEP}${r.note}`;
}

/**
 * The text of a claim's Agent reading (decision 68). `items` are every judged tag of the claim (the items of classifyRows for the claim, in any of its lists), `readings` the fresh readings
 * of this run as Map(key -> { reading, rule, note }), `unjudged` the entries ({ tag }) for the claim's note lines about tags the agent did not judge. One line per read tag, tags in
 * alphabetical order: "<Tag>: <reading>, rule <n> · <note>" ("<Tag>: <reading> · <note>" without a rule; ", without your note" after the rule when the editor wrote none), then
 * "<Tag>: the agent did not judge this tag, so nothing to read." per unjudged tag; "Nothing to read: the agent agreed with you." when judged tags exist and none differs. Returns null when
 * a disagreement has no reading yet (the cell is written once every one has) and when the claim has nothing to say.
 */
export function claimReadingCell({ claim, items, readings, unjudged }) {
  const mine = (items ?? []).filter((i) => i.claim === claim || i.claim?.geo_id === claim?.geo_id);
  const lines = [];
  const differing = mine.filter((i) => i.decision.outcome !== (i.row['Agent proposal'] ?? null));
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
