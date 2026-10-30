// How the first page ("Claim tagger", the per-claim layout) reads an editor's decision on a claim, frozen for the copy to v2 (scripts/copy-live.mjs).
// It is a copy of the rule of lib/decisions.mjs as it stood at the git tag claim-tagger-v1, kept apart because decisions.mjs is rewritten for v2. Pure functions on plain values;
// nothing here reads or writes a file or Notion.
//
// The claim is the plain object { geo_id, review_status, verified_tags (tag names), challenged_notes, agent_status, tags_waiting (tag names) }; a ledger row is a row of the first
// page's Tag decisions as plain values ({ Key, Tag, 'Agent proposal', 'Decided under', 'Rulebook edition', ... }).
//
//   keyGeoId(key)                                  -> the part of a ledger Key before "::" (null without it)
//   parseTagLines(notes, tagNames)                 -> Map(tag -> the editor's own words after "<Tag>:") when the notes hold lines that start with a tag name and a colon, else null.
//                                                     The words are kept whole (a leading reason word included, nothing stripped); lines that follow a tag line and do not start with a
//                                                     tag name belong to it; words before the first tag line belong to no tag
//   decisionsFor(claim, ledgerRows, { tagNames })  -> [{ key, tag, outcome, note, decided_under }] for every ledger row of a Reviewed claim, [] for any other claim
//   rowAgentStatus(claim, row, decision)           -> the Agent status of one ledger row on v2 (decision is its entry of decisionsFor, or null)
//   isReviewed(claim), isToReview(claim), STATUS, OUTCOME, REVIEWED, TO_REVIEW
//
// The rules (the task of the copy, CLAIMS-REVIEW.md section 2 as P4 revised it). A claim is decided only when Review status is Reviewed; every other Review status (To review, empty) decides nothing.
// For each ledger row of a decided claim: Tag outcome is Applies when the row's Tag is among the claim's Verified tags (compared by the tag's name), else Does not apply. Your note is the claim's
// Challenged tags notes line that starts with "<Tag>:"; notes with no tag line at all go to the rows whose Tag outcome differs from Agent proposal, and to every row of the claim when none differs,
// so no word is lost. Agent is right is never set by the copy. Decided under is the row's Decided under when it is filled, else its Rulebook edition.

const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

export const REVIEWED = 'Reviewed';
export const TO_REVIEW = 'To review';
export const OUTCOME = Object.freeze({ applies: 'Applies', not: 'Does not apply' });
/** The values of Agent status (the same on Claims and, on v2, on Tag decisions). */
export const STATUS = Object.freeze({
  waits: 'Waits for you', done: 'Done', disagrees: 'Disagrees with your decision', unread: 'Could not read',
});

export const isReviewed = (claim) => text(claim?.review_status).trim() === REVIEWED;
export const isToReview = (claim) => text(claim?.review_status).trim() === TO_REVIEW;

/** The Geo ID of a ledger Key ("<Geo ID>::<tag>"), or null for a Key without "::". */
export function keyGeoId(key) {
  const k = text(key);
  const at = k.lastIndexOf('::');
  return at < 0 ? null : k.slice(0, at);
}

/**
 * The editor's words per tag. A line that starts with a tag name (one of `tagNames`, letter case ignored) and a colon opens that tag's text; the lines after it that do not start with a tag
 * name belong to it. A tag named by two lines gets both, one under the other. Nothing is stripped: a reason word at the start of the words stays (they are the editor's own). Returns a
 * Map(tag -> text), or null when no line starts with a tag name.
 */
export function parseTagLines(notes, tagNames = []) {
  const known = new Map([...new Set(tagNames)].map((t) => [text(t).trim().toLowerCase(), t]));
  const lines = new Map();
  let current = null;
  for (const raw of text(notes).split(/\r?\n/)) {
    const m = /^\s*([^:\n]+?)\s*:\s*(.*)$/.exec(raw);
    const tag = m ? known.get(m[1].trim().toLowerCase()) : undefined;
    if (tag !== undefined) {
      current = tag;
      lines.set(tag, [...(lines.get(tag) ?? []), m[2].trim()]);
    } else if (current !== null) lines.get(current).push(raw.trim());
  }
  if (lines.size === 0) return null;
  return new Map([...lines].map(([tag, parts]) => [tag, parts.join('\n').trim()]));
}

/**
 * The decision on every ledger row of a claim: [{ key, tag, outcome, note, decided_under }] in the order of the rows; [] unless the claim is Reviewed. `note` and `decided_under` are null when
 * empty. `tagNames` are the names of every tag of the rulebook (a note line that starts with a rulebook tag the agent did not judge is that tag's own entry, never part of the line above it);
 * the claim's verified tags and its rows' tags are always known.
 */
export function decisionsFor(claim, ledgerRows, { tagNames = [] } = {}) {
  if (!isReviewed(claim)) return [];
  const verified = new Set((claim.verified_tags ?? []).map((t) => text(t).trim()));
  const rows = (ledgerRows ?? []).filter((r) => keyGeoId(r?.Key) === claim.geo_id && text(r.Tag).trim() !== '');
  const entries = rows.map((r) => {
    const tag = text(r.Tag).trim();
    const outcome = verified.has(tag) ? OUTCOME.applies : OUTCOME.not;
    return { key: r.Key, tag, outcome, differs: text(r['Agent proposal']).trim() !== outcome, row: r };
  });
  const perTag = parseTagLines(claim.challenged_notes, [...tagNames, ...verified, ...entries.map((e) => e.tag)]);
  const whole = text(claim.challenged_notes).trim();
  // a note with no tag line: the rows the agent got wrong carry it, and every row when it got none wrong
  const wrong = entries.filter((e) => e.differs);
  const carriers = new Set((wrong.length > 0 ? wrong : entries).map((e) => e.key));
  return entries.map((e) => {
    let note = null;
    if (perTag) note = perTag.get(e.tag) || null;
    else if (whole !== '' && carriers.has(e.key)) note = whole;
    const under = text(e.row['Decided under']).trim() || text(e.row['Rulebook edition']).trim() || null;
    return { key: e.key, tag: e.tag, outcome: e.outcome, note, decided_under: under };
  });
}

/**
 * The Agent status of a ledger row on v2. Could not read when the claim says so. A decided row (decision given) is "Disagrees with your decision" when the claim's Agent status is that and the
 * row's Agent proposal differs from its Tag outcome, else Done. An undecided row is "Waits for you" when the claim's Agent status is "Waits for you" and the row's Tag is among the claim's
 * Tags waiting, or when the claim is To review; else Done.
 */
export function rowAgentStatus(claim, row, decision = null) {
  const claimStatus = text(claim?.agent_status).trim();
  if (claimStatus === STATUS.unread) return STATUS.unread;
  if (decision) {
    return claimStatus === STATUS.disagrees && text(row?.['Agent proposal']).trim() !== decision.outcome ? STATUS.disagrees : STATUS.done;
  }
  const waiting = new Set((claim?.tags_waiting ?? []).map((t) => text(t).trim()));
  if ((claimStatus === STATUS.waits && waiting.has(text(row?.Tag).trim())) || isToReview(claim)) return STATUS.waits;
  return STATUS.done;
}
