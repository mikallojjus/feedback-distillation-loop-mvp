// The scenario the promote, follow-up, rollback and loop tests share: Context-dependent has an Approved rule change on rule 4 that rests on two decided
// rows (claims 1 and 2, decided Does not apply, Rule unclear), two earlier decisions (claim 3 Applies, claim 4 Does not apply) and the eleven examples of the
// taxonomy. The fake CLI answers every example and earlier decision as decided, except that the two supporting rows are Can't tell under the rulebook in force
// and come out right under the candidate (the answers change when the system prompt holds MARK, the new rule text).
//
//   const w = await promoteWorld({ ... })       a world (helpers/loop-world.mjs) with the scenario in place and the fake CLI's answers set
//   RULE4, NEW_TEXT, MARK, TITLE                the rule's text now, the text of the lesson, the part of it that marks the candidate, the lesson title

import { claimId, claimText, makeWorld, taxonomyCanaries } from './loop-world.mjs';

export const TITLE = 'General references need no answer';
export const RULE4 = 'Test: could a reader who sees only this sentence say which specific thing each definite reference points at? If any answer is no, tag Context-dependent.';
export const NEW_TEXT = 'Test: a reference that reads as general needs no answer; every other definite reference must point at one specific thing.';
export const MARK = 'every other definite reference must point at one specific thing';
export const keyOf = (i) => `${claimId(i)}::Context-dependent`;

const decidedRow = (i, outcome, why, reasoning) => ({
  Claim: claimText(i), Key: keyOf(i), Tag: 'Context-dependent', 'Agent proposal': "Can't tell", 'Agent confidence': 0.5, 'Agent reason': 'Two readings. · Context-dependent rule 2 · 1/1 runs agreed',
  'Rulebook edition': '2026-10-16.1', 'Tag outcome': outcome, 'Why wrong': why, 'Your reasoning': reasoning,
});

/**
 * Options: wording (the Editor wording), status (the lesson's Status, default Approved), title, open (a number of claims that wait in Your queue: a ledger row
 * for the proposal and Agent notes that say a tag waits),
 * overrides (answers of the candidate, by claim text, laid over the base ones), base (answers of the rulebook in force, by claim text, laid over the scenario's),
 * lessonRows (more Rule changes rows), mark (the text that marks the candidate, default MARK), world (options for makeWorld).
 */
export async function promoteWorld({
  wording = '', status = 'Approved', title = TITLE, open = 0, overrides = {}, base = {}, lessonRows = [], mark = MARK, text = NEW_TEXT, world = {}, supporting = [1, 2],
} = {}) {
  const queue = [
    decidedRow(1, 'Does not apply', 'Rule unclear', 'Rule 4 should let general references pass.'),
    decidedRow(2, 'Does not apply', 'Rule unclear', 'Rule 4 again: this reference is general too.'),
    decidedRow(3, 'Applies', 'Agent slip', 'The pronoun has no antecedent.'),
    decidedRow(4, 'Does not apply', 'Agent slip', 'It names its subject.'),
  ];
  const claimRows = {};
  for (let k = 0; k < open; k++) {
    claimRows[claimId(5 + k)] = { 'Agent notes': 'no tags\n1 waits for an editor · edition 2026-10-16.1', 'Agent confidence': 0.5 };
    queue.push({
      Claim: claimText(5 + k), Key: keyOf(5 + k), Tag: 'Context-dependent', 'Agent proposal': "Can't tell", 'Agent confidence': 0.5, 'Agent reason': 'Unsure. · 2/2 runs agreed', 'Rulebook edition': '2026-10-16.1',
    });
  }
  const lines = supporting.map((i) => `${claimText(i)} · ${keyOf(i)}`).join('\n');
  const lesson = {
    Lesson: title, Tag: 'Context-dependent', Rule: 'Context-dependent rule 4', Kind: 'Clarify wording', 'Current text': RULE4, 'Proposed text': text, 'Supporting rows': lines,
    'Editor wording': wording, Status: status,
  };
  const w = await makeWorld({ claims: 12, queue, claimRows, lessons: [lesson, ...lessonRows], ...world });
  const table = {};
  for (const c of taxonomyCanaries()) table[c.claim] = c.expected === 'apply' ? { decision: 'apply', p: 0.9 } : { decision: 'do_not_apply', p: 0.1 };
  table[claimText(1)] = { decision: 'ask_editor', p: 0.5, rule_ref: null, reason: 'Two readings.' };
  table[claimText(2)] = { decision: 'ask_editor', p: 0.5, rule_ref: null, reason: 'Two readings.' };
  table[claimText(3)] = { decision: 'apply', p: 0.9 };
  table[claimText(4)] = { decision: 'do_not_apply', p: 0.1 };
  Object.assign(table, base);
  w.table(table);
  w.overrides([{ when: mark, table: { [claimText(1)]: { decision: 'do_not_apply', p: 0.1 }, [claimText(2)]: { decision: 'do_not_apply', p: 0.1 }, ...overrides } }]);
  w.lessonTitle = title;
  return w;
}

/** The calls of the fake CLI whose system prompt holds `text`, and those that hold `text` but not `not`. */
export function callsHolding(w, text, not = null) {
  return w.callsWith(text).filter((c) => !not || !w.callsWith(not).includes(c));
}
