// How an editor's decision on a claim is read (docs/mvp-2026-11/CLAIMS-REVIEW.md, section 2). Pure functions on the plain rows a pull writes
// (norm/claims.jsonl and norm/queue.jsonl); nothing here reads or writes a file or Notion.
//
//   isReviewed(claim)                      -> true when the claim's Review status is Reviewed: the only state in which it has a decision
//   isToReview(claim)                      -> true when the claim's Review status is To review: every judged tag of such a claim waits for the editor, whatever the
//                                             agent's confidence (propose and the follow-up write the notes that way; a claim with Review status empty waits only for a tag the agent could not tell)
//   claimWaits(claim)                      -> true for a claim that is still to decide and that the agent says waits: Agent status is "Waits for you" and the claim is not Reviewed
//                                             (a decided claim keeps the status until the next tag run reads the decision, CLAIMS-REVIEW.md section 6.2)
//   claimDisagrees(claim)                  -> true when Agent status is "Disagrees with your decision"
//   parseTagLines(notes, tagNames)         -> Map(tag -> { text, reason }) when the notes hold lines that start with a tag name and a colon, else null; `reason` is the reason word
//                                             (Agent slip, Rule unclear, Rule should change) that opens the line after the colon and a full stop, else null (section 6.3)
//   parseTagNotes(notes, tagNames)         -> the same as Map(tag -> text), without the reason word
//   decisionsFor(claim, ledgerRows, { tagNames }) -> the decision of every tag the agent judged on a Reviewed claim (none for any other claim):
//                                             [{ key, tag, outcome, why_wrong, reasoning, decided_under }]
//
// The rules (section 2). A claim is decided when Review status is Reviewed. For every tag the agent judged on it (every ledger row of the claim):
//   outcome       Applies when the tag is in Verified tags, else Does not apply
//   why_wrong     the reason word that opens the tag's own line of the notes ("Context-dependent: Rule unclear. ..."), else the claim's Why wrong, for a tag whose outcome differs from the
//                 agent's proposal; null for a tag the agent got right
//   reasoning     the tag's own line of Challenged tags notes (without its reason word) when the notes hold lines that start with "<tag name>:"; otherwise the whole text, for a
//                 tag whose outcome differs from the proposal (a note with no tag name applies to every tag the agent got wrong)
//   decided_under the edition the ledger row's proposal was made under: the row's Decided under when it is already filled (the decision was copied
//                 before), else its Rulebook edition at the time of the sync
// A proposal of "Can't tell" differs from every outcome, so a tag the agent could not tell carries the claim's Why wrong and the editor's words.

import { AGENT_STATUS } from './config.mjs';
import { AUDIT_PREFIX } from './plan.mjs';

const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

export const REVIEWED = 'Reviewed';
// the reason words an editor may put after a tag name (the values of Why wrong), written with a full stop: "Context-dependent: Rule unclear. The pronoun ..."
const REASON_WORDS = Object.freeze(['Agent slip', 'Rule unclear', 'Rule should change']);
const REASON_AT_START = /^(Agent slip|Rule unclear|Rule should change)\.(?:\s+|$)/i;

export const TO_REVIEW = 'To review';

export const isReviewed = (claim) => text(claim?.review_status).trim() === REVIEWED;

/** A claim marked To review (by the editor, or by QA on the real table): every judged tag of it waits for an editor, whatever the confidence. */
export const isToReview = (claim) => text(claim?.review_status).trim() === TO_REVIEW;

/** A claim the agent says waits in Your queue: Agent status is "Waits for you" and an editor has not Reviewed it (a Reviewed claim keeps the status until the next tag run). */
export const claimWaits = (claim) => !isReviewed(claim) && text(claim?.agent_status).trim() === AGENT_STATUS.waits;

/** A claim whose Agent status says that the agent still differs from the editor's decision. */
export const claimDisagrees = (claim) => text(claim?.agent_status).trim() === AGENT_STATUS.disagrees;

/**
 * The editor's words per tag. A line that starts with a tag name (one of `tagNames`, letter case ignored) and a colon opens that tag's text; the lines
 * after it that do not start with a tag name belong to it. The text may start with a reason word (Agent slip, Rule unclear or Rule should change) and a full
 * stop: that is the tag's Why wrong, and it is not part of the text. Returns a Map(tag -> { text, reason }), or null when no line starts with a tag name (the
 * notes are then one note for the claim, for every tag the agent got wrong). Words before the first tag line belong to no tag.
 */
export function parseTagLines(notes, tagNames = []) {
  const known = new Map([...new Set(tagNames)].map((t) => [t.trim().toLowerCase(), t]));
  const out = new Map();
  let current = null;
  for (const raw of text(notes).split(/\r?\n/)) {
    const m = /^\s*([^:\n]+?)\s*:\s*(.*)$/.exec(raw);
    const tag = m ? known.get(m[1].trim().toLowerCase()) : undefined;
    if (tag !== undefined) {
      current = tag;
      out.set(tag, [m[2].trim()]);
    } else if (current !== null) out.get(current).push(raw.trim());
  }
  if (out.size === 0) return null;
  return new Map([...out].map(([tag, lines]) => {
    let body = lines.join('\n').trim();
    let reason = null;
    const r = REASON_AT_START.exec(body);
    if (r) {
      reason = REASON_WORDS.find((w) => w.toLowerCase() === r[1].toLowerCase());
      body = body.slice(r[0].length).trim();
    }
    return [tag, { text: body, reason }];
  }));
}

/** parseTagLines with the text only: Map(tag -> text) or null. */
export function parseTagNotes(notes, tagNames = []) {
  const lines = parseTagLines(notes, tagNames);
  return lines === null ? null : new Map([...lines].map(([tag, { text: body }]) => [tag, body]));
}

const keyTag = (key) => {
  const at = text(key).lastIndexOf('::');
  return at < 0 ? null : { geo_id: text(key).slice(0, at), tag: text(key).slice(at + 2) };
};

/**
 * The decisions on a Reviewed claim, one per ledger row of the claim (the tags the agent judged). `ledgerRows` are rows of norm/queue.jsonl (or
 * rows of the same shape that a plan is about to create: Key, Tag, Agent proposal, Rulebook edition, Decided under); rows of other claims are
 * ignored. `tagNames` are the tag names the notes may start a line with (the claim's verified tags and its rows' tags are always known).
 * Returns [{ key, tag, outcome, why_wrong, reasoning, decided_under }] sorted by tag; [] for a claim that is not Reviewed.
 */
export function decisionsFor(claim, ledgerRows, { tagNames = [] } = {}) {
  if (!isReviewed(claim)) return [];
  const verified = new Set(claim.verified_tags ?? []);
  const rows = (ledgerRows ?? []).filter((r) => keyTag(r?.Key)?.geo_id === claim.geo_id && text(r.Tag).trim() !== '');
  const perTag = parseTagLines(claim.challenged_notes, [...tagNames, ...verified, ...rows.map((r) => r.Tag)]);
  const whole = text(claim.challenged_notes).trim();
  return rows.map((r) => {
    const outcome = verified.has(r.Tag) ? 'Applies' : 'Does not apply';
    const differs = r['Agent proposal'] !== outcome;
    let reasoning = null;
    const own = perTag?.get(r.Tag) ?? null;
    if (perTag) reasoning = own?.text || null;
    else if (differs && whole !== '') reasoning = whole;
    const under = text(r['Decided under']).trim() || text(r['Rulebook edition']).trim() || null;
    return {
      key: r.Key, tag: r.Tag, outcome, why_wrong: differs ? (own?.reason ?? claim.why_wrong ?? null) : null, reasoning, decided_under: under,
    };
  }).sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

// ---- copying a decision to the ledger -------------------------------------------------------------------------------------------------------

const same = (a, b) => text(a).replace(/\s+/g, ' ').trim() === text(b).replace(/\s+/g, ' ').trim();

/** The ledger columns that hold the copy of a decision (decisionsFor's output) as plain values; a missing Why wrong or Your reasoning is null. */
export const decisionProps = (d) => ({
  'Tag outcome': d.outcome, 'Why wrong': d.why_wrong ?? null, 'Your reasoning': d.reasoning ?? null, 'Decided under': d.decided_under ?? null,
});

/**
 * The columns of a pulled ledger row that differ from the copy of a decision, as the values to write ({} when the row holds the copy already). An edition that is
 * recorded in Decided under is never overwritten (it is the edition the editor saw), and an empty one is never written over anything. The words of the audit of
 * 9 October stay on a ledger row where the agent had been right (no words are copied for such a tag) as long as the claim still carries them (`claim`).
 */
export function decisionChanges(row, d, claim = null) {
  const out = {};
  for (const [column, value] of Object.entries(decisionProps(d))) {
    const have = row?.[column] ?? null;
    if (column === 'Decided under' && (value === null || text(have).trim() !== '')) continue;
    if (column === 'Your reasoning' && value === null && text(have).startsWith(AUDIT_PREFIX) && text(claim?.challenged_notes).startsWith(AUDIT_PREFIX)) continue;
    if (!same(have, value)) out[column] = value;
  }
  return out;
}

/**
 * The copies of decisions that the ledger is missing: for every Reviewed claim, every ledger row of the claim (the tags the agent judged) whose Tag outcome,
 * Why wrong, Your reasoning or Decided under differs from the decision. Returns { changes: [{ key, page_id, changes }], rows } where `rows` are the ledger rows as they
 * will be once the changes are written (the others untouched), so a step that reads decisions can read them before the write has happened.
 */
export function syncDecisions(claims, ledgerRows, { tagNames = [] } = {}) {
  const rows = (ledgerRows ?? []).map((r) => ({ ...r }));
  const changes = [];
  for (const claim of claims ?? []) {
    if (!isReviewed(claim)) continue;
    for (const d of decisionsFor(claim, rows, { tagNames })) {
      const row = rows.find((r) => r.Key === d.key);
      const diff = decisionChanges(row, d, claim);
      if (Object.keys(diff).length === 0) continue;
      changes.push({ key: d.key, page_id: row.page_id, changes: diff });
      Object.assign(row, diff, { decided: true });
    }
  }
  return { changes, rows };
}
