import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimWaits, decisionChanges, decisionProps, decisionsFor, disagreementsIn, isReviewed, parseTagNotes, syncDecisions, waitsForEditor,
} from '../../agents/claim-tagger-mvp/scripts/lib/decisions.mjs';
import * as pull from '../../agents/claim-tagger-mvp/scripts/pull.mjs';

// How an editor's decision on a claim is read (CLAIMS-REVIEW.md, section 2): pure functions on the rows a pull writes.

const CD = 'Context-dependent';
const claim = (over = {}) => ({
  geo_id: 'g1', page_id: 'p-g1', agent_tags: '', agent_notes: '', agent_confidence: 0.65, verified_tags: [], review_status: 'Reviewed', why_wrong: 'Rule unclear', challenged_notes: '', ...over,
});
const row = (tag = CD, over = {}) => ({
  Key: `g1::${tag}`, Tag: tag, page_id: `l-${tag}`, 'Agent proposal': "Can't tell", 'Rulebook edition': '2026-10-16.1', 'Tag outcome': null, 'Why wrong': null, 'Your reasoning': null, 'Decided under': null, decided: false, ...over,
});

test('a claim is decided when Review status is Reviewed, and in no other state', () => {
  assert.equal(isReviewed(claim()), true);
  for (const status of [null, '', 'To review', 'reviewed', undefined]) assert.equal(isReviewed(claim({ review_status: status })), false, String(status));
  assert.deepEqual(decisionsFor(claim({ review_status: 'To review' }), [row()]), []);
  assert.deepEqual(decisionsFor(claim({ review_status: null, verified_tags: [CD] }), [row()]), [], 'a verified tag without Reviewed is still open');
});

test('the outcome is Applies when the tag is in Claim quality tags — verified, else Does not apply', () => {
  const [yes] = decisionsFor(claim({ verified_tags: [CD] }), [row()]);
  assert.deepEqual([yes.key, yes.tag, yes.outcome], [`g1::${CD}`, CD, 'Applies']);
  const [no] = decisionsFor(claim({ verified_tags: ['Wordy'] }), [row()]);
  assert.equal(no.outcome, 'Does not apply');
  const both = decisionsFor(claim({ verified_tags: ['Wordy'] }), [row('Wordy'), row()]);
  assert.deepEqual(both.map((d) => [d.tag, d.outcome]), [[CD, 'Does not apply'], ['Wordy', 'Applies']], 'one decision per judged tag, sorted by tag');
});

test('Why wrong is the claim\'s, for a tag whose outcome differs from the proposal; a tag the agent got right carries none', () => {
  const c = claim({ verified_tags: [CD, 'Wordy'], why_wrong: 'Rule should change' });
  const rows = [row(CD, { 'Agent proposal': 'Applies' }), row('Wordy', { 'Agent proposal': 'Does not apply' }), row('Poor wording', { 'Agent proposal': "Can't tell" })];
  const d = Object.fromEntries(decisionsFor(c, rows).map((x) => [x.tag, x]));
  assert.equal(d[CD].why_wrong, null, 'right');
  assert.equal(d.Wordy.why_wrong, 'Rule should change', 'wrong');
  assert.equal(d['Poor wording'].why_wrong, 'Rule should change', 'Can\'t tell differs from every outcome');
  assert.equal(decisionsFor(claim({ verified_tags: [CD], why_wrong: null }), [row()])[0].why_wrong, null, 'no value on the claim, none on the row');
});

test('Your reasoning is the tag\'s own line when the notes hold lines that start with a tag name and a colon, else the whole text for the tags that differ', () => {
  const lines = claim({ verified_tags: [CD], challenged_notes: `${CD}: rule 3 does not say so.\nWordy: too long to read.\nA stray line.` });
  const rows = [row(CD, { 'Agent proposal': 'Applies' }), row('Wordy', { 'Agent proposal': 'Does not apply' })];
  const d = Object.fromEntries(decisionsFor(lines, rows).map((x) => [x.tag, x]));
  assert.equal(d[CD].reasoning, 'rule 3 does not say so.', 'its own line, even where the agent was right');
  assert.equal(d.Wordy.reasoning, 'too long to read.\nA stray line.', 'a line without a tag name belongs to the line above');
  const whole = claim({ verified_tags: [CD], challenged_notes: 'The press pool names a body readers know.' });
  const [one] = decisionsFor(whole, [row()]);
  assert.equal(one.reasoning, 'The press pool names a body readers know.');
  const right = decisionsFor(whole, [row(CD, { 'Agent proposal': 'Applies' })])[0];
  assert.equal(right.reasoning, null, 'the agent got it right: no words copied');
  assert.equal(decisionsFor(claim({ verified_tags: [CD], challenged_notes: '  ' }), [row()])[0].reasoning, null, 'empty notes');
  const audit = claim({ verified_tags: [], challenged_notes: 'From the audit of 9 October: the claim reads on its own.' });
  assert.equal(decisionsFor(audit, [row(CD, { 'Agent proposal': 'Applies' })])[0].reasoning, 'From the audit of 9 October: the claim reads on its own.', '"From the audit of 9 October" is not a tag name');
});

test('parseTagNotes: tag names are matched in any letter case, only names it knows start a line, and no tag line means no map', () => {
  assert.deepEqual([...parseTagNotes('context-dependent :  one\ntwo', [CD])], [[CD, 'one\ntwo']]);
  assert.equal(parseTagNotes('Rule 3: not a tag\nBecause: neither', [CD]), null);
  assert.equal(parseTagNotes('', [CD]), null);
  assert.equal(parseTagNotes(null, [CD]), null);
  assert.deepEqual([...parseTagNotes('words before\nWordy: after', ['Wordy'])], [['Wordy', 'after']], 'words before the first tag line belong to no tag');
  assert.deepEqual([...parseTagNotes(`${CD}: a\r\nWordy: b`, [CD, 'Wordy'])], [[CD, 'a'], ['Wordy', 'b']], 'Windows line ends');
});

test('Decided under is the edition recorded in the row when the decision is copied, and the one already there afterwards', () => {
  const c = claim({ verified_tags: [CD] });
  assert.equal(decisionsFor(c, [row(CD, { 'Rulebook edition': '2026-10-01.2' })])[0].decided_under, '2026-10-01.2');
  assert.equal(decisionsFor(c, [row(CD, { 'Rulebook edition': '2026-10-16.5', 'Decided under': '2026-10-01.2' })])[0].decided_under, '2026-10-01.2');
  assert.equal(decisionsFor(c, [row(CD, { 'Rulebook edition': null })])[0].decided_under, null, 'a row from the audit records no edition');
});

test('decisionsFor takes the rows of its own claim only, and a row without a tag is no decision', () => {
  const c = claim({ verified_tags: [CD] });
  const rows = [row(), { ...row(), Key: `g2::${CD}` }, { ...row('Wordy'), Tag: '' }];
  assert.deepEqual(decisionsFor(c, rows).map((d) => d.key), [`g1::${CD}`]);
});

test('waitsForEditor reads the count in front of the words: "nothing waits for an editor" has the same words and says the opposite', () => {
  assert.equal(waitsForEditor('no tags\n1 waits for an editor · edition e'), true);
  assert.equal(waitsForEditor('no tags\n2 wait for an editor · edition e'), true);
  assert.equal(waitsForEditor('no tags\n12 wait for an editor'), true);
  assert.equal(waitsForEditor('no tags\nnothing waits for an editor · edition e'), false);
  assert.equal(waitsForEditor('Context-dependent\nnothing waits for an editor · disagrees with your decision on Context-dependent'), false);
  assert.equal(waitsForEditor(''), false);
  assert.equal(waitsForEditor(null), false);
  assert.equal(claimWaits({ agent_notes: '1 waits for an editor', review_status: 'To review' }), true);
  assert.equal(claimWaits({ agent_notes: '1 waits for an editor', review_status: 'Reviewed' }), false);
});

test('disagreementsIn lists the tags after "disagrees with your decision on"', () => {
  assert.deepEqual(disagreementsIn('no tags\nnothing waits for an editor · disagrees with your decision on Context-dependent · edition e'), [CD]);
  assert.deepEqual(disagreementsIn('x\nnothing waits for an editor · disagrees with your decision on Context-dependent, Wordy · not checked: 1 source tag · edition e'), [CD, 'Wordy']);
  assert.deepEqual(disagreementsIn('x\nnothing waits for an editor · edition e'), []);
  assert.deepEqual(disagreementsIn(''), []);
});

test('decisionChanges names only the columns that differ; the edition the editor saw and the audit\'s words stay', () => {
  const d = { outcome: 'Applies', why_wrong: 'Rule unclear', reasoning: 'Words.', decided_under: '2026-10-16.1' };
  assert.deepEqual(decisionProps(d), { 'Tag outcome': 'Applies', 'Why wrong': 'Rule unclear', 'Your reasoning': 'Words.', 'Decided under': '2026-10-16.1' });
  assert.deepEqual(decisionChanges(row(), d), decisionProps(d), 'a row with no copy gets all four');
  assert.deepEqual(decisionChanges(row(CD, { 'Tag outcome': 'Applies', 'Why wrong': 'Rule unclear', 'Your reasoning': 'Words.', 'Decided under': '2026-10-16.1' }), d), {}, 'nothing to write');
  assert.deepEqual(decisionChanges(row(CD, { 'Tag outcome': 'Applies', 'Why wrong': 'Rule unclear', 'Your reasoning': 'Words.', 'Decided under': '2026-10-01.1' }), d), {}, 'Decided under is not overwritten');
  assert.deepEqual(decisionChanges(row(CD, { 'Tag outcome': 'Does not apply', 'Why wrong': null, 'Your reasoning': ' Words.  ', 'Decided under': '2026-10-01.1' }), d), { 'Tag outcome': 'Applies', 'Why wrong': 'Rule unclear' }, 'text is compared after its spaces are folded');
  assert.deepEqual(decisionChanges(row(), { ...d, why_wrong: null, reasoning: null }), { 'Tag outcome': 'Applies', 'Decided under': '2026-10-16.1' }, 'nothing to copy is nothing to write on an empty row');
  assert.deepEqual(decisionChanges(row(CD, { 'Why wrong': 'Agent slip', 'Tag outcome': 'Applies', 'Decided under': 'x' }), { ...d, why_wrong: null }), { 'Why wrong': null, 'Your reasoning': 'Words.' }, 'a value the editor took away is taken away');
  assert.deepEqual(decisionChanges(row(), { ...d, decided_under: null }), { 'Tag outcome': 'Applies', 'Why wrong': 'Rule unclear', 'Your reasoning': 'Words.' }, 'an empty edition is never written');

  const audit = row(CD, { 'Tag outcome': 'Does not apply', 'Your reasoning': 'From the audit of 9 October: it reads on its own.', 'Decided under': 'x' });
  const none = { outcome: 'Does not apply', why_wrong: null, reasoning: null, decided_under: null };
  assert.deepEqual(decisionChanges(audit, none, { challenged_notes: 'From the audit of 9 October: it reads on its own.' }), {}, 'the agent was right: the audit\'s words stay on the ledger row');
  assert.deepEqual(decisionChanges(audit, none, { challenged_notes: 'Rewritten by the editor.' }), { 'Your reasoning': null }, 'but not once the editor has put other words in the claim');
  assert.deepEqual(decisionChanges(audit, none), { 'Your reasoning': null });
});

test('syncDecisions: the copies the ledger is missing, and the rows as they will be', () => {
  const claims = [
    claim({ geo_id: 'g1', verified_tags: [CD], challenged_notes: `${CD}: say so.` }),
    claim({ geo_id: 'g2', review_status: 'To review', verified_tags: [CD] }),
    claim({ geo_id: 'g3', verified_tags: [] }),
  ];
  const ledger = [row(), { ...row(), Key: `g2::${CD}`, page_id: 'l-g2' }, { ...row(), Key: `g3::${CD}`, page_id: 'l-g3', 'Agent proposal': 'Does not apply', 'Tag outcome': 'Does not apply', 'Decided under': '2026-10-01.1' }];
  const { changes, rows } = syncDecisions(claims, ledger);
  assert.deepEqual(changes, [{ key: `g1::${CD}`, page_id: `l-${CD}`, changes: { 'Tag outcome': 'Applies', 'Why wrong': 'Rule unclear', 'Your reasoning': 'say so.', 'Decided under': '2026-10-16.1' } }]);
  assert.equal(rows[0].decided, true);
  assert.equal(rows[0]['Tag outcome'], 'Applies');
  assert.equal(rows[1]['Tag outcome'], null, 'a claim that is not Reviewed has no decision to copy');
  assert.equal(ledger[0]['Tag outcome'], null, 'the rows it was given are not changed');
  assert.deepEqual(syncDecisions(claims, rows).changes, [], 'a second look finds nothing to copy');
});

test('pull.mjs exports the same functions, so a caller that reads a pull has them at hand', () => {
  assert.equal(pull.decisionsFor, decisionsFor);
  assert.equal(pull.isReviewed, isReviewed);
  assert.equal(pull.claimWaits, claimWaits);
  assert.equal(pull.waitsForEditor, waitsForEditor);
  assert.equal(pull.disagreementsIn, disagreementsIn);
  assert.equal(pull.parseTagNotes, parseTagNotes);
});
