import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_STATUS } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import * as decisions from '../../agents/claim-tagger-mvp/scripts/lib/decisions.mjs';
import {
  CANT_TELL, OUTCOMES, READINGS, RULE_WHY, claimSummary, countYourQueue, decidedUnderText, inYourQueue, isDecided, isFollowedUp, isTicked, keyParts, parseDecidedUnder,
  recordChanges, recordDecisions, rowDecision, rowDisagrees, rowStatus,
} from '../../agents/claim-tagger-mvp/scripts/lib/decisions.mjs';

// How an editor's decision on a Tag decisions row is read (PORT-V2.md section 1; P42 to P46): pure functions on the rows a pull writes.

const CD = 'Context-dependent';
const ED = '2026-10-29.1';
const row = (tag = CD, over = {}) => ({
  Key: `g1::${tag}`, Tag: tag, page_id: `l-${tag}`, 'Agent proposal': 'Applies', 'Agent confidence': 0.8, 'Agent reason': `reason ${tag}`, 'Rulebook edition': ED,
  'Agent is right': false, 'Tag outcome': null, 'Your note': null, 'Decided under': null, 'Agent status': AGENT_STATUS.done, ...over,
});

test('the old per-claim readers are gone, so a stale import fails at load time', () => {
  for (const name of ['REVIEWED', 'TO_REVIEW', 'isReviewed', 'isToReview', 'claimWaits', 'claimDisagrees', 'parseTagLines', 'parseTagNotes', 'leadingReason', 'decisionsFor', 'decisionProps', 'decisionChanges', 'syncDecisions']) {
    assert.equal(decisions[name], undefined, name);
  }
});

test('OUTCOMES, CANT_TELL, READINGS and RULE_WHY; keyParts splits at the last "::"', () => {
  assert.deepEqual([...OUTCOMES], ['Applies', 'Does not apply']);
  assert.equal(CANT_TELL, "Can't tell");
  assert.deepEqual([...READINGS], ['Agent slip', 'Rule unclear', 'Rule should change']);
  assert.deepEqual([...RULE_WHY], ['Rule unclear', 'Rule should change']);
  assert.deepEqual(keyParts('abc::Context-dependent'), { geo_id: 'abc', tag: CD });
  assert.deepEqual(keyParts('a::b::Tag'), { geo_id: 'a::b', tag: 'Tag' });
  assert.equal(keyParts('abc'), null);
  assert.equal(keyParts(null), null);
});

test('isFollowedUp: After the rule change is Fixed; Still wrong and empty are not', () => {
  assert.equal(isFollowedUp({ 'After the rule change': 'Fixed' }), true);
  assert.equal(isFollowedUp({ 'After the rule change': 'Still wrong' }), false);
  assert.equal(isFollowedUp({ 'After the rule change': null }), false);
  assert.equal(isFollowedUp({ 'Follow-up': 'Fixed' }), false, 'the old column name is not read');
});

test('Decided under: parsed as { edition, agreed } and written back; a tick keeps the outcome it agreed with', () => {
  assert.deepEqual(parseDecidedUnder(ED), { edition: ED, agreed: null });
  assert.deepEqual(parseDecidedUnder(`  ${ED} · agreed Applies `), { edition: ED, agreed: 'Applies' });
  assert.deepEqual(parseDecidedUnder(`${ED} · agreed Does not apply`), { edition: ED, agreed: 'Does not apply' });
  for (const odd of [null, '', '   ', `${ED} · agreed Maybe`, 'two words']) assert.equal(parseDecidedUnder(odd), null, String(odd));
  assert.equal(decidedUnderText(ED), ED);
  assert.equal(decidedUnderText(ED, 'Applies'), `${ED} · agreed Applies`);
  assert.equal(decidedUnderText('', 'Applies'), null);
  assert.equal(decidedUnderText(null), null);
});

test('rowDecision: a Tag outcome is the decision; first sight until Decided under holds the edition', () => {
  const d = rowDecision(row(CD, { 'Tag outcome': 'Does not apply', 'Your note': ' Not general. ' }));
  assert.deepEqual(d, {
    key: `g1::${CD}`, tag: CD, geo_id: 'g1', outcome: 'Does not apply', by: 'outcome', note: 'Not general.', decided_under: ED, first_sight: true, tick_ignored: false, waits: false,
  });
  const seen = rowDecision(row(CD, { 'Tag outcome': 'Applies', 'Decided under': '2026-10-01.1' }));
  assert.deepEqual([seen.outcome, seen.decided_under, seen.first_sight], ['Applies', '2026-10-01.1', false], 'the edition it was decided under, not the one the proposal moved to');
  assert.equal(isDecided(row(CD, { 'Tag outcome': 'Applies' })), true);
  assert.equal(isDecided(row()), false);
});

test('rowDecision: a tick on a sure proposal decides it - first sight takes the proposal, a recorded tick keeps the outcome it agreed with whatever the proposal says now', () => {
  const first = rowDecision(row(CD, { 'Agent is right': true }));
  assert.deepEqual([first.outcome, first.by, first.decided_under, first.first_sight, first.tick_ignored], ['Applies', 'tick', ED, true, false]);
  const recorded = rowDecision(row(CD, { 'Agent is right': true, 'Decided under': `${ED} · agreed Applies`, 'Agent proposal': 'Does not apply', 'Rulebook edition': '2026-11-02.1' }));
  assert.deepEqual([recorded.outcome, recorded.by, recorded.decided_under, recorded.first_sight], ['Applies', 'tick', ED, false], 'the proposal moved; the tick still means the one it agreed with');
  assert.equal(rowDecision(row(CD, { 'Agent is right': true, 'Agent proposal': 'Does not apply' })).outcome, 'Does not apply');
});

test('rowDecision: a tick on Can\'t tell (or on no proposal) decides nothing and the row keeps waiting', () => {
  const d = rowDecision(row(CD, { 'Agent is right': true, 'Agent proposal': CANT_TELL }));
  assert.deepEqual([d.outcome, d.by, d.tick_ignored, d.waits, d.first_sight], [null, null, true, true, false]);
  const empty = rowDecision(row(CD, { 'Agent is right': true, 'Agent proposal': null }));
  assert.deepEqual([empty.outcome, empty.tick_ignored, empty.waits], [null, true, false]);
  assert.equal(isDecided(row(CD, { 'Agent is right': true, 'Agent proposal': CANT_TELL })), false);
});

test('rowDecision: Tag outcome wins over a tick, equal or different (P46)', () => {
  const same = rowDecision(row(CD, { 'Agent is right': true, 'Tag outcome': 'Applies' }));
  assert.deepEqual([same.outcome, same.by], ['Applies', 'outcome']);
  const other = rowDecision(row(CD, { 'Agent is right': true, 'Tag outcome': 'Does not apply' }));
  assert.deepEqual([other.outcome, other.by], ['Does not apply', 'outcome']);
  const recorded = rowDecision(row(CD, { 'Agent is right': true, 'Tag outcome': 'Does not apply', 'Decided under': `${ED} · agreed Applies` }));
  assert.deepEqual([recorded.outcome, recorded.decided_under, recorded.first_sight], ['Does not apply', ED, false], 'the edition of a recorded tick is kept');
});

test('rowDecision: a Tag outcome outside the two counts as empty; an undecided row waits only on Can\'t tell; the note is never parsed', () => {
  const odd = rowDecision(row(CD, { 'Tag outcome': 'Maybe', 'Agent proposal': CANT_TELL }));
  assert.deepEqual([odd.outcome, odd.waits], [null, true]);
  assert.equal(rowDecision(row(CD, { 'Tag outcome': 'Maybe' })).outcome, null);
  assert.equal(rowDecision(row()).waits, false);
  assert.equal(rowDecision(row(CD, { 'Agent proposal': CANT_TELL })).waits, true);
  const n = rowDecision(row(CD, { 'Tag outcome': 'Applies', 'Your note': 'Agent slip. Rule 3 settles it.\r\nSecond line.' }));
  assert.equal(n.note, 'Agent slip. Rule 3 settles it.\nSecond line.', 'a reason word is plain text now (P45)');
  assert.equal(rowDecision(row()).note, null);
  assert.equal(rowDecision({}).tag, null, 'a row with nothing in it');
  assert.equal(rowDecision({ Key: 'g9::Wordy' }).tag, 'Wordy', 'the tag falls back to the Key');
  assert.equal(isTicked(row(CD, { 'Agent is right': true })), true);
  assert.equal(isTicked(row(CD, { 'Agent is right': 'true' })), false);
});

test('rowDisagrees: decided and different from the proposal; Can\'t tell differs from both outcomes', () => {
  assert.equal(rowDisagrees(row(CD, { 'Tag outcome': 'Applies' })), false);
  assert.equal(rowDisagrees(row(CD, { 'Tag outcome': 'Does not apply' })), true);
  assert.equal(rowDisagrees(row(CD, { 'Tag outcome': 'Applies', 'Agent proposal': CANT_TELL })), true);
  assert.equal(rowDisagrees(row(CD, { 'Agent is right': true })), false, 'a tick agrees by definition');
  assert.equal(rowDisagrees(row(CD, { 'Agent is right': true, 'Agent proposal': CANT_TELL })), false, 'a tick on Can\'t tell is no decision');
  assert.equal(rowDisagrees(row()), false);
});

test('inYourQueue is the filter of the view: Waits for you, no Tag outcome, and no tick unless the proposal is Can\'t tell', () => {
  const waits = { 'Agent status': AGENT_STATUS.waits };
  assert.equal(inYourQueue(row(CD, waits)), true);
  assert.equal(inYourQueue(row(CD, { ...waits, 'Tag outcome': 'Applies' })), false);
  assert.equal(inYourQueue(row(CD, { ...waits, 'Agent is right': true })), false);
  assert.equal(inYourQueue(row(CD, { ...waits, 'Agent is right': true, 'Agent proposal': CANT_TELL })), true, 'a tick on Can\'t tell keeps the row in the queue');
  assert.equal(inYourQueue(row(CD, { 'Agent status': AGENT_STATUS.done })), false);
  assert.equal(inYourQueue(row(CD, { ...waits, 'Tag outcome': 'Maybe' })), false, 'the view only asks whether Tag outcome is empty');
  assert.equal(countYourQueue([row('A', waits), row('B', waits), row('C', { ...waits, 'Tag outcome': 'Applies' }), row('D')]), 2);
  assert.equal(countYourQueue(null), 0);
});

test('recordChanges: the first sight of a Tag outcome records the Rulebook edition, the first sight of a tick records the edition and the outcome agreed with', () => {
  assert.deepEqual(recordChanges(row(CD, { 'Tag outcome': 'Applies' })), { 'Decided under': ED });
  assert.deepEqual(recordChanges(row(CD, { 'Agent is right': true })), { 'Decided under': `${ED} · agreed Applies` });
  assert.deepEqual(recordChanges(row(CD, { 'Agent is right': true, 'Agent proposal': 'Does not apply' })), { 'Decided under': `${ED} · agreed Does not apply` });
  assert.deepEqual(recordChanges(row()), {}, 'nothing decided, nothing recorded');
  assert.deepEqual(recordChanges(row(CD, { 'Agent is right': true, 'Agent proposal': CANT_TELL })), {}, 'a tick that decides nothing records nothing');
});

test('recordChanges: a recorded decision stays as it is, however the proposal and the edition move afterwards', () => {
  assert.deepEqual(recordChanges(row(CD, { 'Tag outcome': 'Applies', 'Decided under': '2026-10-01.1', 'Rulebook edition': '2026-11-02.1' })), {});
  assert.deepEqual(recordChanges(row(CD, { 'Agent is right': true, 'Decided under': `${ED} · agreed Applies`, 'Agent proposal': 'Does not apply', 'Rulebook edition': '2026-11-02.1' })), {});
});

test('recordChanges: removing the tick or clearing Tag outcome clears Decided under, so a later tick is recorded afresh', () => {
  assert.deepEqual(recordChanges(row(CD, { 'Decided under': `${ED} · agreed Applies` })), { 'Decided under': null }, 'untick');
  assert.deepEqual(recordChanges(row(CD, { 'Decided under': ED })), { 'Decided under': null }, 'Tag outcome cleared');
  const again = recordChanges(row(CD, { 'Agent is right': true, 'Rulebook edition': '2026-11-02.1', 'Agent proposal': 'Does not apply' }));
  assert.deepEqual(again, { 'Decided under': '2026-11-02.1 · agreed Does not apply' });
});

test('recordChanges: a tick followed by a Tag outcome drops the suffix and keeps the edition', () => {
  assert.deepEqual(recordChanges(row(CD, { 'Agent is right': true, 'Tag outcome': 'Does not apply', 'Decided under': `${ED} · agreed Applies` })), { 'Decided under': ED });
  assert.deepEqual(recordChanges(row(CD, { 'Tag outcome': 'Applies', 'Decided under': `${ED} · agreed Applies`, 'Rulebook edition': '2026-11-02.1' })), { 'Decided under': ED });
});

test('recordDecisions: the changes with Key and page id, copies of the rows with the changes applied, and decided on every row; nothing passed in is changed', () => {
  const rows = [
    row('A', { 'Tag outcome': 'Applies' }),
    row('B', { 'Agent is right': true, 'Agent proposal': 'Does not apply' }),
    row('C'),
    row('D', { 'Tag outcome': 'Does not apply', 'Decided under': ED }),
    row('E', { 'Agent is right': true, 'Agent proposal': CANT_TELL }),
  ];
  const before = JSON.stringify(rows);
  const { changes, rows: after } = recordDecisions(rows);
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(changes, [
    { key: 'g1::A', page_id: 'l-A', changes: { 'Decided under': ED } },
    { key: 'g1::B', page_id: 'l-B', changes: { 'Decided under': `${ED} · agreed Does not apply` } },
  ]);
  assert.deepEqual(after.map((r) => [r.Tag, r['Decided under'], r.decided]), [
    ['A', ED, true], ['B', `${ED} · agreed Does not apply`, true], ['C', null, false], ['D', ED, true], ['E', null, false],
  ]);
  assert.deepEqual(recordDecisions(after).changes, [], 'recording twice changes nothing');
  assert.deepEqual(recordDecisions(null), { changes: [], rows: [] });
});

test('rowStatus: Disagrees with your decision, Could not read, Done for a decided row, Waits for you for Can\'t tell, else Done', () => {
  assert.equal(rowStatus({ outcome: 'Applies', proposal: 'Does not apply' }), AGENT_STATUS.disagrees);
  assert.equal(rowStatus({ outcome: 'Applies', proposal: 'Applies' }), AGENT_STATUS.done);
  assert.equal(rowStatus({ outcome: 'Applies', proposal: CANT_TELL }), AGENT_STATUS.done, 'Can\'t tell does not disagree');
  assert.equal(rowStatus({ outcome: 'Applies', proposal: 'Does not apply', unreadable: true }), AGENT_STATUS.disagrees, 'a disagreement comes before unreadable');
  assert.equal(rowStatus({ outcome: null, proposal: 'Applies', unreadable: true }), AGENT_STATUS.unread);
  assert.equal(rowStatus({ outcome: 'Applies', proposal: 'Applies', unreadable: true }), AGENT_STATUS.unread);
  assert.equal(rowStatus({ outcome: null, proposal: CANT_TELL }), AGENT_STATUS.waits);
  assert.equal(rowStatus({ outcome: null, proposal: 'Does not apply' }), AGENT_STATUS.done);
});

test('claimSummary: tags are decided Applies rows and undecided Applies proposals; waiting is the undecided Can\'t tell rows; a tick on Can\'t tell still waits', () => {
  const rows = [
    row('Delta', { 'Agent proposal': 'Does not apply', 'Tag outcome': 'Applies' }),
    row('Alpha', { 'Agent proposal': 'Applies' }),
    row('Bravo', { 'Agent proposal': 'Applies', 'Tag outcome': 'Does not apply', 'Agent status': AGENT_STATUS.disagrees }),
    row('Charlie', { 'Agent proposal': CANT_TELL, 'Agent status': AGENT_STATUS.waits }),
    row('Echo', { 'Agent proposal': CANT_TELL, 'Agent status': AGENT_STATUS.waits, 'Agent is right': true }),
    row('Foxtrot', { 'Agent proposal': 'Applies', 'Agent status': AGENT_STATUS.unread }),
    row('Golf', { 'Agent proposal': CANT_TELL, 'Agent status': AGENT_STATUS.unread }),
    row('Hotel', { 'Agent proposal': 'Applies', 'Agent is right': true }),
  ];
  const s = claimSummary(rows, { judgedNames: rows.map((r) => r.Tag), edition: ED, notChecked: '' });
  assert.deepEqual(s.tags, ['Alpha', 'Delta', 'Hotel']);
  assert.deepEqual(s.waiting, ['Charlie', 'Echo']);
  assert.equal(s.waits, 2);
  assert.deepEqual(s.disagrees, ['Bravo']);
  assert.equal(s.agent_edition, ED);
  assert.equal(s.agent_remarks, '');
});

test('claimSummary: the status is the first that holds of Waits for you, Disagrees, Could not read, else Done (and Done with no rows)', () => {
  const st = (...statuses) => claimSummary(statuses.map((s, i) => row(`T${i}`, { 'Agent status': s })), { edition: ED }).status;
  assert.equal(st(AGENT_STATUS.done, AGENT_STATUS.unread, AGENT_STATUS.disagrees, AGENT_STATUS.waits), AGENT_STATUS.waits);
  assert.equal(st(AGENT_STATUS.done, AGENT_STATUS.unread, AGENT_STATUS.disagrees), AGENT_STATUS.disagrees);
  assert.equal(st(AGENT_STATUS.done, AGENT_STATUS.unread), AGENT_STATUS.unread);
  assert.equal(st(AGENT_STATUS.done, AGENT_STATUS.done), AGENT_STATUS.done);
  assert.equal(claimSummary([], { edition: ED }).status, AGENT_STATUS.done);
});

test('claimSummary: lowest confidence to two decimals, one reason line per row (tags A to Z, empty reasons left out), the remarks, and only the judged tags count', () => {
  const rows = [
    row('Zed', { 'Agent confidence': 0.91, 'Agent reason': 'last' }),
    row('Ace', { 'Agent confidence': 0.6666, 'Agent reason': 'first' }),
    row('Mid', { 'Agent confidence': null, 'Agent reason': '' }),
    row('Skipped', { 'Agent confidence': 0.5, 'Agent reason': 'not judged this run' }),
  ];
  const s = claimSummary(rows, { judgedNames: ['Zed', 'Ace', 'Mid'], edition: ED, notChecked: '2 source tags' });
  assert.equal(s.confidence, 0.67);
  assert.equal(s.agent_reasons, 'Ace: first\nZed: last');
  assert.equal(s.agent_remarks, 'not checked: 2 source tags');
  assert.equal(claimSummary([row('Mid', { 'Agent confidence': null })], { edition: ED }).confidence, null);
});
