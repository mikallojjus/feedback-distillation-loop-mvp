// How an editor's decision on one Tag decisions row is read (docs/mvp-2026-11/PORT-V2.md section 1; decisions P42 to P46). Pure functions on the plain rows a pull writes
// (norm/claims.jsonl and norm/queue.jsonl); nothing here reads or writes a file or Notion. This is the ONE place that reads Tag outcome, Agent is right and Your note off a row:
// every other file asks rowDecision(row) (tests/mvp/editor-columns.test.mjs keeps it so).
//
// The rules (v2, one row per claim and tag):
//  - Tag outcome (Applies, Does not apply) is the decision. It wins over a tick, whatever the tick says (P46). Any other value counts as empty.
//  - Agent is right (a tick) means "I take the proposal the row showed": the agent records that proposal, with the edition, in Decided under as "<edition> · agreed <Outcome>", because
//    the agent never writes Tag outcome and a later tag run moves the proposal. A tick on Can't tell (or on no proposal) decides nothing; the row keeps waiting.
//  - Your note is the editor's own words, never parsed: no reason words (P45). The agent works the reason out (lib/readings.mjs).
//  - A row with no decision has Decided under empty; a decided row keeps the edition it was decided under.
//
//   OUTCOMES, CANT_TELL, READINGS, RULE_WHY   the two decisions, "Can't tell", the three readings of a disagreement, and the two that blame the rule
//   isFollowedUp(row)                         true when After the rule change is Fixed (distill drafts no lesson from such a row again)
//   keyParts(key)                             { geo_id, tag } from "<geo_id>::<tag>" (split at the last "::"), else null
//   isTicked(row), parseDecidedUnder(v), decidedUnderText(edition, agreed)    the tick, and Decided under as { edition, agreed } and back
//   rowDecision(row)                          { key, tag, geo_id, outcome, by ('outcome' | 'tick' | null), note, decided_under, first_sight, tick_ignored, waits }
//   isDecided(row), rowDisagrees(row)         decided / decided against the agent's proposal (Can't tell differs from both outcomes)
//   inYourQueue(row), countYourQueue(rows)    the filter of the view Your queue, and how many rows it shows
//   recordChanges(row), recordDecisions(rows) the Decided under writes that record decisions, for one row / for the ledger (the shape of the old syncDecisions)
//   rowStatus({ outcome, proposal, unreadable })   the Agent status of one row
//   claimSummary(rows, { judgedNames, edition, notChecked })   the agent's columns of a Claims row, from the claim's Tag decisions rows

import { AGENT_STATUS, TD } from './config.mjs';
import { compareCodePoints } from './pyjson.mjs';

const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const trim = (v) => text(v).replace(/\r\n?/g, '\n').trim();

export const OUTCOMES = Object.freeze(['Applies', 'Does not apply']);
export const CANT_TELL = "Can't tell";
// the readings of a disagreement (the values of Agent's view of your decision)
export const READINGS = Object.freeze(['Agent slip', 'Rule unclear', 'Rule should change']);
/** The readings that say the rule is the problem: distill drafts rule changes from the decided rows that carry one of them. */
export const RULE_WHY = new Set(['Rule unclear', 'Rule should change']);

/**
 * A Tag decisions row whose After the rule change is Fixed: a lesson resting on it went live and the agent now agrees with the decision, so no lesson is drafted from it again. A row
 * marked Still wrong is not followed up in this sense: the editor says why in Your note and distills again, so it stays open for the next lesson.
 */
export const isFollowedUp = (row) => trim(row?.[TD.after]) === 'Fixed';

/** { geo_id, tag } from a Key "<geo_id>::<tag>" (split at the last "::"), else null. */
export function keyParts(key) {
  const k = text(key);
  const at = k.lastIndexOf('::');
  return at < 0 ? null : { geo_id: k.slice(0, at), tag: k.slice(at + 2) };
}

/** True when Agent is right is ticked. */
export const isTicked = (row) => row?.[TD.right] === true;

const DECIDED_UNDER = /^(\S+)(?:\s+·\s+agreed\s+(Applies|Does not apply))?$/;

/** { edition, agreed } from a Decided under text ("2026-10-29.1" or "2026-10-29.1 · agreed Applies"); agreed is null without the suffix. Null for an empty or odd text. */
export function parseDecidedUnder(value) {
  const m = DECIDED_UNDER.exec(trim(value));
  return m ? { edition: m[1], agreed: m[2] ?? null } : null;
}

/** The Decided under text: "<edition>", or "<edition> · agreed <Outcome>" for a tick; null when the edition is empty. */
export function decidedUnderText(edition, agreed = null) {
  const e = trim(edition);
  if (e === '') return null;
  return agreed ? `${e} · agreed ${agreed}` : e;
}

// ---- reading a row's decision -------------------------------------------------------------------------------------------------------------------

/**
 * The decision a Tag decisions row holds. Returns
 *   { key, tag, geo_id, outcome, by, note, decided_under, first_sight, tick_ignored, waits }
 * outcome is Applies, Does not apply or null (undecided); by says where it came from ('outcome' = Tag outcome, 'tick' = Agent is right) or null; decided_under is the edition the
 * decision was made under; first_sight is true when the agent has not recorded the decision in Decided under yet; tick_ignored is true for a tick that decides nothing (the proposal is
 * Can't tell or empty); waits is true for an undecided row whose proposal is Can't tell. note is Your note, trimmed, or null.
 */
export function rowDecision(row) {
  const key = text(row?.[TD.key]);
  const parts = keyParts(key);
  const o = trim(row?.[TD.outcome]);
  const p = trim(row?.[TD.proposal]);
  const du = parseDecidedUnder(row?.[TD.decidedUnder]);
  const ed = trim(row?.[TD.edition]) || null;
  const note = trim(row?.[TD.note]) || null;
  const base = {
    key, tag: trim(row?.[TD.tag]) || parts?.tag || null, geo_id: parts?.geo_id ?? null, outcome: null, by: null, note, decided_under: null, first_sight: false, tick_ignored: false, waits: false,
  };
  if (OUTCOMES.includes(o)) return { ...base, outcome: o, by: 'outcome', decided_under: du?.edition ?? ed, first_sight: du === null };
  if (isTicked(row)) {
    if (du?.agreed) return { ...base, outcome: du.agreed, by: 'tick', decided_under: du.edition };
    if (OUTCOMES.includes(p)) return { ...base, outcome: p, by: 'tick', decided_under: ed, first_sight: true };
    return { ...base, tick_ignored: true, waits: p === CANT_TELL };
  }
  return { ...base, waits: p === CANT_TELL };
}

/** True when the row is decided: by Tag outcome, or by a tick on a sure proposal. */
export const isDecided = (row) => rowDecision(row).outcome !== null;

/** True for a decided row whose decision differs from the agent's proposal. Can't tell differs from both outcomes. */
export function rowDisagrees(row) {
  const { outcome } = rowDecision(row);
  return outcome !== null && outcome !== trim(row?.[TD.proposal]);
}

/**
 * True when the view Your queue shows the row: Agent status is Waits for you, Tag outcome is empty, and Agent is right is not ticked (a tick on Can't tell does not count).
 * This is the view's own filter, for counting what an editor sees; rowDecision(row).waits is the agent's sense of "waits for you".
 */
export function inYourQueue(row) {
  return trim(row?.[TD.status]) === AGENT_STATUS.waits && trim(row?.[TD.outcome]) === '' && (!isTicked(row) || trim(row?.[TD.proposal]) === CANT_TELL);
}

/** How many of the rows are in Your queue. */
export const countYourQueue = (rows) => (rows ?? []).filter(inYourQueue).length;

// ---- recording decisions ------------------------------------------------------------------------------------------------------------------------

/**
 * The write that records a row's decision in Decided under: {} when the row holds it already, else { 'Decided under': value }.
 * First sight of a Tag outcome records the row's Rulebook edition; first sight of a tick records "<edition> · agreed <Agent proposal>"; the edition of a recorded decision
 * never changes while the row stays decided; a tick followed by a Tag outcome drops the suffix and keeps the edition; a row that is not decided any more has it cleared (null).
 */
export function recordChanges(row) {
  const d = rowDecision(row);
  const want = d.outcome === null ? null : decidedUnderText(d.decided_under, d.by === 'tick' ? d.outcome : null);
  const have = trim(row?.[TD.decidedUnder]) || null;
  return have === want ? {} : { [TD.decidedUnder]: want };
}

/**
 * The records that the ledger is missing. Returns { changes: [{ key, page_id, changes }], rows } where `rows` are copies of the ledger rows with the changes applied and `decided`
 * set on every row (isDecided), so a step that reads decisions can read them before the write has happened. Nothing the caller passed is changed.
 */
export function recordDecisions(ledgerRows) {
  const changes = [];
  const rows = (ledgerRows ?? []).map((r) => {
    const diff = recordChanges(r);
    const out = { ...r, ...diff };
    if (Object.keys(diff).length > 0) changes.push({ key: r.Key, page_id: r.page_id, changes: diff });
    out.decided = isDecided(out);
    return out;
  });
  return { changes, rows };
}

// ---- status and summary ------------------------------------------------------------------------------------------------------------------------

/**
 * The Agent status of one row, from its decision (`outcome`, null when undecided), the proposal of this run and whether the judge could read the claim (`unreadable`).
 * Disagrees with your decision, then Could not read, then Done for a decided row, Waits for you for a Can't tell, else Done.
 */
export function rowStatus({ outcome = null, proposal = null, unreadable = false } = {}) {
  const p = trim(proposal);
  if (outcome !== null && OUTCOMES.includes(p) && p !== outcome) return AGENT_STATUS.disagrees;
  if (unreadable) return AGENT_STATUS.unread;
  if (outcome !== null) return AGENT_STATUS.done;
  if (p === CANT_TELL) return AGENT_STATUS.waits;
  return AGENT_STATUS.done;
}

const tagOf = (row) => trim(row?.[TD.tag]) || keyParts(row?.[TD.key])?.tag || '';

/**
 * The agent's columns of one claim, from the claim's Tag decisions rows as they will be once the plan is written (the pulled row merged with the plan's changes), restricted to the tags in
 * `judgedNames`. Returns
 *   { tags, waiting, status, confidence, agent_reasons, agent_edition, agent_remarks, waits, disagrees }
 * tags: decided Applies rows and undecided rows the agent proposes Applies for (not unreadable ones), by code point; waiting: undecided Can't tell rows (not unreadable); status: the first that
 * holds of Waits for you, Disagrees with your decision, Could not read, else Done; confidence: the lowest Agent confidence, two decimals, or null; agent_reasons: "<Tag>: <reason>" per row,
 * tags A to Z; waits: how many rows wait; disagrees: the tag names of the rows that disagree. "Agent's view of your decision" is not here: only distill writes it.
 */
export function claimSummary(rows, { judgedNames, edition, notChecked = '' } = {}) {
  const judged = judgedNames === undefined ? null : new Set(judgedNames);
  const mine = (rows ?? []).filter((r) => judged === null || judged.has(tagOf(r))).sort((a, b) => compareCodePoints(tagOf(a), tagOf(b)));
  const tags = new Set();
  const waiting = new Set();
  const disagrees = [];
  const statuses = new Set();
  const lines = [];
  let confidence = null;
  for (const row of mine) {
    const tag = tagOf(row);
    const d = rowDecision(row);
    const proposal = trim(row[TD.proposal]);
    const status = trim(row[TD.status]);
    statuses.add(status);
    if (status === AGENT_STATUS.disagrees) disagrees.push(tag);
    if (d.outcome !== null) {
      if (d.outcome === 'Applies') tags.add(tag);
    } else if (status !== AGENT_STATUS.unread) {
      if (proposal === 'Applies') tags.add(tag);
      else if (proposal === CANT_TELL) waiting.add(tag);
    }
    const reason = trim(row[TD.reason]);
    if (reason !== '') lines.push(`${tag}: ${reason}`);
    const c = row[TD.confidence];
    if (typeof c === 'number' && Number.isFinite(c) && (confidence === null || c < confidence)) confidence = c;
  }
  const status = statuses.has(AGENT_STATUS.waits) ? AGENT_STATUS.waits
    : statuses.has(AGENT_STATUS.disagrees) ? AGENT_STATUS.disagrees
      : statuses.has(AGENT_STATUS.unread) ? AGENT_STATUS.unread : AGENT_STATUS.done;
  return {
    tags: [...tags].sort(compareCodePoints),
    waiting: [...waiting].sort(compareCodePoints),
    status,
    confidence: confidence === null ? null : Math.round(confidence * 100) / 100,
    agent_reasons: lines.join('\n'),
    agent_edition: edition,
    agent_remarks: notChecked ? `not checked: ${notChecked}` : '',
    waits: waiting.size,
    disagrees,
  };
}
