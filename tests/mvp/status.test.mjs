import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { countsOf, decisionsCell, main, readingCounts, status } from '../../agents/claim-tagger-mvp/scripts/status.mjs';
import { readJson } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { WITHOUT_NOTE, readUnder, readingHash } from '../../agents/claim-tagger-mvp/scripts/lib/readings.mjs';
import { MAX_ROWS, lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { claimText, makeWorld } from './helpers/loop-world.mjs';

function assertReport(h, r) {
  assert.ok(r.markdown, 'a report was written');
  assert.deepEqual(lintReport(r.markdown), [], r.markdown);
  assert.equal(h.io.outs.join('\n').trimEnd(), r.markdown.trimEnd());
  assert.ok(!/\bcalls?\b|token|duration|\$|\.mjs|--[a-z]|runs\//i.test(r.markdown), r.markdown);
  return r.report;
}

// The rows that wait are rows of Tag decisions (v2): the view Your queue lists a row whose Agent status is Waits for you, with no Tag outcome and no tick on Agent is right (a tick on a
// Can't tell row does not count). The claims of the Claims copy matter for one thing here: a claim with no Agent status has not been read by the agent.
const WAITS = 'Waits for you';
const NOTHING = 'Done';
const DISAGREES = 'Disagrees with your decision';
const ED = '2026-10-16.1';
const id = (i) => `c${String(i).padStart(2, '0')}`;
const lesson = (title, Status, over = {}) => ({ Lesson: title, Tag: 'Context-dependent', Rule: 'Context-dependent rule 4', Kind: 'Clarify wording', 'Current text': 'x', 'Proposed text': 'y', Status, ...over });

const TAG = 'Context-dependent';
const NOTE_LINE = 'Rule 3 does not say it.';
const SO = 'The rule leaves this kind of case open.';
/** The claims `ns` as the agent has read them (Agent status Done), and nothing else: a claim without a row. */
const read = (...ns) => ({ claimRows: Object.fromEntries(ns.map((n) => [id(n), { 'Agent status': NOTHING, 'Agent confidence': 0.9 }])), queue: [] });
/** A row of the agent for the claim n, undecided: it cannot tell and waits (Agent status Waits for you). */
const waitRow = (n, over = {}) => ({
  Claim: claimText(n), Key: `${id(n)}::${TAG}`, Tag: TAG, 'Agent proposal': "Can't tell", 'Agent confidence': 0.5, 'Agent reason': 'Unsure. · 2/3 runs agreed', 'Rulebook edition': ED, 'Agent status': WAITS, ...over,
});
/** Claims whose one row waits. */
const wait = (...ns) => ({ claimRows: read(...ns).claimRows, queue: ns.map((n) => waitRow(n)) });
/**
 * The decided rows of the claims `ns`: the agent proposed Applies, the editor decided Does not apply and wrote NOTE_LINE (so each is a disagreement), the agent has recorded the decision under
 * the edition in force. `status` is the row's Agent status ("Waits for you" until the next tag run reads the decision), `over` any column.
 */
const decided = (ns, { status: rowStatus = DISAGREES, ...over } = {}) => ({
  claimRows: read(...ns).claimRows,
  queue: ns.map((n) => ({
    Claim: claimText(n), Key: `${id(n)}::${TAG}`, Tag: TAG, 'Agent proposal': 'Applies', 'Agent confidence': 0.6, 'Agent reason': 'Maybe. · Context-dependent rule 3 · 2/3 runs agreed', 'Rulebook edition': ED,
    'Agent status': rowStatus, 'Tag outcome': 'Does not apply', 'Your note': NOTE_LINE, 'Decided under': ED, ...over,
  })),
});
const listed = (ns, over = {}) => decided(ns, { status: WAITS, ...over });
const mix = (...parts) => ({ claimRows: Object.assign({}, ...parts.map((p) => p.claimRows)), queue: parts.flatMap((p) => p.queue) });
const NO_NOTE = { 'Your note': '' };

/**
 * The ledger rows of the claims ns hold a reading, the way distill leaves them: Agent's view of your decision, Rule, Why the agent thinks so and Read under (the edition and the hash of the
 * decision as it stands: the outcome, the proposal, the note and the edition the proposal was made under). `noteLine` is the editor's note; `proposalEdition` replaces the edition the row holds;
 * `noNote` opens Why the agent thinks so with "without your note", as distill does.
 */
function markRead(w, ns, { reading = 'Rule unclear', rule = `${TAG} rule 3`, note = SO, noteLine = NOTE_LINE, noNote = false, proposalEdition = null, proposal = 'Applies', outcome = 'Does not apply' } = {}) {
  const ledger = w.fake.plainRows(w.DB.tag_decisions);
  for (const n of ns) {
    const key = `${id(n)}::${TAG}`;
    const held = ledger.find((r) => r.Key === key) ?? {};
    const hash = readingHash({ outcome, proposal, noteLine, reasonWord: null, proposalEdition: proposalEdition ?? held['Rulebook edition'] ?? null });
    w.fake.editRow(w.ids.queue[key], {
      "Agent's view of your decision": reading, Rule: rule, 'Why the agent thinks so': noNote ? `${WITHOUT_NOTE} · ${note}` : note, 'Read under': readUnder(w.rubric().edition, hash),
    });
  }
}

test('status, nothing waits: the sentence, the table of four rows and a Next that reads new claims', async () => {
  const w = await makeWorld({ claims: 3, ...mix(decided([1], { status: NOTHING, 'Agent proposal': 'Does not apply' }), read(2, 3)), settings: { 'Last run summary': 'Tag · 15 Oct 11:20 · 3 claims' } });
  const h = w.hooks();
  const r = await status(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Status: nothing is paused and nothing waits for you.');
  assert.deepEqual(report.header, ['Where', 'Now', '']);
  assert.deepEqual(report.rows, [
    ['Rulebook', '13 tags, edition 2026-10-16.1', ''],
    ['Your queue', 'nothing waits', ''],
    ['Lessons waiting', 'none', ''],
    ['Last run', 'Tag · 15 Oct 11:20 · 3 claims', ''],
  ]);
  assert.equal(report.next, 'Next: type /claim-tagger tag to read new claims.');
  assert.equal(w.writes().length, 0, 'status writes nothing to Notion');
  assert.equal(readJson(join(r.runDir, 'run.json')).exit_code, 0);
});

test('status, rows and a rule change wait: both counted in the sentence, Next points at Your queue', async () => {
  const w = await makeWorld({ claims: 4, ...mix(wait(1, 2, 3), decided([4], { status: NOTHING, 'Agent proposal': 'Does not apply' })), lessons: [lesson('A proposed change', 'Proposed')] });
  const h = w.hooks();
  const r = await status(h);
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Status: nothing is paused; 3 rows and 1 rule change wait for you.');
  assert.deepEqual(report.rows[1], ['Your queue', '3 rows, lowest confidence first', '']);
  assert.deepEqual(report.rows[2], ['Lessons waiting', '1 rule change to approve', '']);
  assert.deepEqual(report.rows[3], ['Last run', 'none yet', '']);
  assert.match(report.next, /^Next: decide your three rows in Your queue \(https:\/\/www\.notion\.so\/[0-9a-f]{32}\?v=[0-9a-f]{32}\)\.$/);
  assert.ok(report.next.includes(w.DB.tag_decisions), 'Your queue is a view of Tag decisions');
});

test('status counts a row by the view\'s own filter: Waits for you with no Tag outcome and no tick; a tick on a Can\'t tell row does not take it out', async () => {
  const w = await makeWorld({
    claims: 7,
    ...mix(
      wait(1),
      listed([2]), // decided (Tag outcome), the status still says Waits for you until the next tag run
      { claimRows: {}, queue: [waitRow(3, { 'Agent proposal': 'Applies', 'Agent is right': true })] }, // a tick on a sure proposal
      { claimRows: {}, queue: [waitRow(4, { 'Agent is right': true })] }, // a tick on Can't tell decides nothing
      { claimRows: {}, queue: [waitRow(5, { 'Agent status': NOTHING })] }, // not waiting
      read(3, 4, 5, 6),
    ),
  });
  const r = await status(w.hooks());
  assert.equal(r.report.sentence, 'Status: nothing is paused; 2 rows wait for you.', 'c01 and c04; c02 and c03 are decided, c05 does not wait, c07 was not read');
  assert.deepEqual(r.report.rows[1], ['Your queue', '2 rows, lowest confidence first; 1 new claim not read yet', ''], 'c07 has no Agent status: it does not wait, it is new');
});

test('status, more rows wait than fit one sitting: the count is in the sentence and Next says where to start', async () => {
  const w = await makeWorld({ claims: 5, ...mix(wait(1, 2, 3, 4), read(5)), lessons: [lesson('A proposed change', 'Proposed')], configure: (c) => { c.queue.sitting_rows = 3; } });
  const h = w.hooks();
  const r = await status(h);
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Status: nothing is paused; 4 rows and 1 rule change wait for you, more than fit one sitting.');
  assert.match(report.next, /^Next: start at the top of Your queue \(/);
  assert.ok(!/decide the/.test(report.next));
});

test('status, only rule changes wait: approve or reject; an approved one is ready to check; singular and plural read right', async () => {
  // both claims are read already: a claim the agent has not read would send the editor to the tag command first
  const one = await makeWorld({ claims: 2, ...read(1, 2), lessons: [lesson('One', 'Proposed')] });
  const r1 = await status(one.hooks());
  assert.equal(r1.report.sentence, 'Status: nothing is paused; 1 rule change waits for you.');
  assert.match(r1.report.next, /^Next: approve or reject the rule change in Lessons waiting \(https:\/\/www\.notion\.so\//);

  const two = await makeWorld({ claims: 2, ...read(1, 2), lessons: [lesson('One', 'Proposed'), lesson('Two', 'Proposed', { Rule: 'Context-dependent rule 2' })] });
  const r2 = await status(two.hooks());
  assert.equal(r2.report.sentence, 'Status: nothing is paused; 2 rule changes wait for you.');
  assert.match(r2.report.next, /^Next: approve or reject the rule changes in Lessons waiting/);

  const ready = await makeWorld({ claims: 2, ...read(1, 2), lessons: [lesson('Ready', 'Approved'), lesson('Done', 'Live')] });
  const r3 = await status(ready.hooks());
  assert.equal(r3.report.sentence, 'Status: nothing is paused; 1 rule change waits for you.');
  assert.deepEqual(r3.report.rows.find((x) => x[0] === 'Lessons waiting'), ['Lessons waiting', '1 approved, ready to check', '']);
  assert.equal(r3.report.next, 'Next: type /claim-tagger promote to check the approved rule change.');

  const both = await makeWorld({ claims: 2, ...read(1, 2), lessons: [lesson('A', 'Proposed'), lesson('B', 'Approved', { Rule: 'Context-dependent rule 2' })] });
  assert.deepEqual((await status(both.hooks())).report.rows.find((x) => x[0] === 'Lessons waiting'), ['Lessons waiting', '1 rule change to approve, 1 approved, ready to check', '']);
});

test('status, a decision without a note shows in the table as "Your decisions", and there is no row of its own for Needs your note any more', async () => {
  // the editor decided the row (Does not apply, the agent proposed Applies) and wrote nothing: the agent has not read it yet, and it has no note to read it by
  const w = await makeWorld({ claims: 3, ...mix(decided([1], NO_NOTE), read(2, 3)) });
  const r = await status(w.hooks());
  assert.deepEqual(r.report.rows.find((x) => x[0] === 'Your decisions'), ['Your decisions', '1 to read, 1 without a note', '']);
  assert.ok(!r.report.rows.some((x) => x[0] === 'Needs your note'));
  assert.equal(r.report.rows.length, 5);
});

test('status, paused: the refusal report and exit 3, from the Paused box or from the PAUSED file', async () => {
  const w = await makeWorld({ claims: 2 });
  w.setPaused(true);
  const h = w.hooks();
  const r = await status(h);
  assert.equal(r.exit, 3);
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Status: nothing was done, because the agent is paused.');
  assert.match(report.next, /^Next: untick Paused in Agent settings \(https:\/\/www\.notion\.so\/[0-9a-f]{32}\)\.$/);

  const file = await makeWorld({ claims: 2 });
  file.write('runs/PAUSED', 'paused\n');
  const rf = await status(file.hooks());
  assert.equal(rf.exit, 3);
  assert.equal(rf.report.next, 'Next: ask the engineer to remove the pause file.');
});

test('status, drift on a judged tag: the drift report and exit 4, naming the tag and the column and asking the engineer to restore the rulebook text', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag['Context-dependent'], { 'When to use': `${w.row('rulebook', 'Context-dependent')['When to use']}\n6. By hand.` });
  const h = w.hooks();
  const r = await status(h);
  assert.equal(r.exit, 4);
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Status: nothing is paused, but the rulebook text in Notion no longer matches the saved edition (Context-dependent: When to use).');
  assert.match(report.next, /^Next: put the rulebook text back on Context-dependent \(https:\/\/www\.notion\.so\/[0-9a-f]{32}\?v=[0-9a-f]{32}\), or ask the engineer to restore the rulebook text\.$/);
});

test('status leaves the rulebook files alone: an edit to a tag without rules is reported and taken over by the next command, not by status', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag.Wordy, { Description: 'Changed.' });
  const r = await status(w.hooks());
  assert.equal(r.exit, 0);
  assert.equal(r.report.rows[0][1], '13 tags, edition 2026-10-16.1, Notion differs on Wordy (taken over at the next run)');
  assert.equal(w.rubric().edition, '2026-10-16.1');
});

test('status says plainly when Notion has other tag rows than the saved edition, without claiming the next run takes them over', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.addRow(w.DB.rulebook, { Name: 'Hedged', 'Work tags': ['Issue'], 'When to use': '' });
  w.fake.editRow(w.ids.tag.Wordy, { Name: 'Wordier' });
  const h = w.hooks();
  const r = await status(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(r.report.rows[0][1], '13 tags, edition 2026-10-16.1, Notion has other tag rows: Hedged and Wordier; Notion lacks tag rows: Wordy');
  assert.deepEqual(lintReport(r.markdown), []);
});

test('status --json prints the counts as JSON instead of the report, after the report files are written', async () => {
  // c03 is decided without a note and the agent has not read it yet
  const w = await makeWorld({
    claims: 3, ...mix(wait(1, 2), decided([3], NO_NOTE)), lessons: [lesson('A', 'Proposed'), lesson('B', 'Live', { Rule: 'Context-dependent rule 2' })],
  });
  const h = w.hooks({ json: true });
  const r = await status(h);
  assert.equal(r.exit, 0);
  assert.equal(h.io.outs.length, 1);
  const json = JSON.parse(h.io.outs[0]);
  assert.deepEqual(json.queue, { open: 2, decided: 1, decided_listed: 0, to_read: 1, pending_rule_decisions: 0, needs_note: 1, unread: 0, sitting_rows: 20, more_than_a_sitting: false }, 'the three counts of the decisions made, and the claims not read yet, are under queue');
  assert.match(json.table, new RegExp(w.DB.tag_decisions), 'the table the counts are about is Tag decisions');
  assert.deepEqual(json.lessons, { Proposed: 1, Approved: 0, Rejected: 0, Live: 1, 'Rolled back': 0 });
  assert.deepEqual([json.edition, json.tags, json.same_as_notion, json.paused], ['2026-10-16.1', 13, true, false]);
  assert.ok(readJson(join(r.runDir, 'report.json')).sentence.startsWith('Status: nothing is paused; 2 rows and 1 rule change wait'));
});

test('status says when a safety check is running now (a promote lock younger than two hours), and ignores an old lock', async () => {
  const w = await makeWorld({ claims: 2, settings: { 'Last run summary': 'Tag · 15 Oct 11:20 · 2 claims' } });
  w.write('runs/PROMOTING.json', { run_id: 'x', lesson: 'A long running change', phase: 'judging', since: new Date(Date.UTC(2026, 9, 16, 8, 30)).toISOString() });
  const running = await status(w.hooks());
  assert.deepEqual(running.report.rows.at(-1), ['Last run', '"A long running change" is being checked now; before that: Tag · 15 Oct 11:20 · 2 claims', '']);
  w.write('runs/PROMOTING.json', { run_id: 'x', lesson: 'An old one', phase: 'judging', since: new Date(Date.UTC(2026, 9, 16, 5, 0)).toISOString() });
  const h = w.hooks({ json: true });
  const old = await status(h);
  assert.deepEqual(old.report.rows.at(-1), ['Last run', 'Tag · 15 Oct 11:20 · 2 claims', '']);
  assert.equal(JSON.parse(h.io.outs[0]).promoting, null);
  w.write('runs/PROMOTING.json', { run_id: 'x', lesson: 'A long running change', phase: 'planned', since: new Date(Date.UTC(2026, 9, 16, 8, 30)).toISOString() });
  const h2 = w.hooks({ json: true });
  await status(h2);
  assert.deepEqual(JSON.parse(h2.io.outs[0]).promoting, { lesson: 'A long running change', phase: 'planned' });
});

const DECIDE = /^Next: decide your (\w+) rows? in Your queue \(https:\/\/www\.notion\.so\/[0-9a-f]{32}\?v=[0-9a-f]{32}\)\.$/;

test('the Next line is "decide the rows" even when other claims have no Agent status yet, and the new claims are counted in the cell, after the rows to decide', async () => {
  const production = await makeWorld({ claims: 3, ...wait(1, 2) }); // c03 is not read
  const h = production.hooks();
  const r = await status(h);
  const report = assertReport(h, r);
  assert.match(report.next, DECIDE);
  assert.ok(!/demo|step 2/.test(report.next));
  assert.deepEqual(report.rows[1], ['Your queue', '2 rows, lowest confidence first; 1 new claim not read yet', ''], 'c03 is counted in the cell, after the rows to decide');
});

// ---- the decisions made: what the agent still has to read (READ-DECISIONS.md, decision 74) ------------------------------------------------------------------------------

// midway: the editor has decided rows and the agent has not read the decisions yet (the next tag run does), so their Agent status still says Waits for you
const DISTILL = 'Next: type /claim-tagger distill to draft a rule change from your decisions.';
const NEXT_TAG = 'Next: type /claim-tagger tag to read new claims.';

// The tables of these tests have been tagged already: a claim a test does not set is read (Agent status Done), so that "new claims not read yet" shows only where a test puts such a claim there.
const tagged = (claims, claimRows = {}) => ({ ...read(...Array.from({ length: claims }, (_, i) => i + 1)).claimRows, ...claimRows });

/** A world, with the ledger rows of `read` (claim numbers) already holding the reading `readOpts` describes. */
async function world({ read: readNs = [], readOpts = {}, claims = 4, claimRows = {}, queue = [], ...opts } = {}) {
  const w = await makeWorld({ claims, claimRows: tagged(claims, claimRows), queue, ...opts });
  if (readNs.length) markRead(w, readNs, readOpts);
  return w;
}
const reportOf = async (opts) => {
  const w = await world(opts);
  const h = w.hooks();
  const r = await status(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(w.writes().length, 0, 'status writes nothing to Notion');
  return assertReport(h, r);
};
const nextOf = async (opts) => (await reportOf(opts)).next;
const countsIn = async (w) => {
  const h = w.hooks({ json: true });
  assert.equal((await status(h)).exit, 0, h.io.errs.join('\n'));
  const { to_read: toRead, pending_rule_decisions: pending, needs_note: needsNote } = JSON.parse(h.io.outs[0]).queue;
  return { toRead, pending, needsNote };
};
const yourDecisions = (report) => report.rows.find((row) => row[0] === 'Your decisions') ?? null;

test('status midway, every row decided: Your queue counts what the view lists, which is nothing, Your decisions says two are to read, and Next points at distill', async () => {
  const w = await makeWorld({ claims: 4, ...mix(listed([1, 2]), read(3, 4)), settings: { 'Last run summary': 'Tag · 15 Oct 11:20 · 4 claims' } });
  const h = w.hooks();
  const r = await status(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Status: nothing is paused; the agent has 2 of your decisions to read.', 'nothing is left to decide, and the sentence does not say that nothing waits while the row Your decisions shows decisions to read');
  assert.deepEqual(report.header, ['Where', 'Now', '']);
  assert.deepEqual(report.rows, [
    ['Rulebook', '13 tags, edition 2026-10-16.1', ''],
    ['Your queue', 'nothing waits', ''],
    ['Your decisions', '2 to read', ''],
    ['Lessons waiting', 'none', ''],
    ['Last run', 'Tag · 15 Oct 11:20 · 4 claims', ''],
  ]);
  assert.equal(report.next, DISTILL);
  assert.ok(!/decided|waiting for the agent/.test(report.rows[1][1]), 'the Your queue row never claims that a decided row is still in the queue');
  assert.match(report.rows[2][1], /^2 to read/, 'the decisions that the agent has not read are told in Your decisions');
  const asJson = w.hooks({ json: true });
  assert.equal((await status(asJson)).exit, 0);
  assert.equal(JSON.parse(asJson.io.outs[0]).queue.decided_listed, 2, 'the two rows still read Waits for you in Agent status until the next tag run, and --json says so');
  assert.equal(w.writes().length, 0, 'status writes nothing to Notion');
  assert.equal(readJson(join(r.runDir, 'report.json')).next, DISTILL);
});

test('status midway: a tick on a sure proposal is a decision too, and a tick on Can\'t tell is none', async () => {
  const w = await makeWorld({
    claims: 4,
    ...mix(read(1, 2, 3, 4), {
      claimRows: {},
      queue: [
        waitRow(1, { 'Agent proposal': 'Applies', 'Agent status': WAITS, 'Agent is right': true }), // agrees with the agent: nothing to read
        waitRow(2, { 'Agent proposal': 'Applies', 'Agent status': WAITS, 'Agent is right': true, 'Decided under': `${ED} · agreed Does not apply` }), // the proposal moved since: a disagreement
        waitRow(3, { 'Agent is right': true }), // Can't tell: decides nothing, still in Your queue
      ],
    }),
  });
  const h = w.hooks({ json: true });
  assert.equal((await status(h)).exit, 0, h.io.errs.join('\n'));
  const q = JSON.parse(h.io.outs[0]).queue;
  assert.deepEqual([q.open, q.decided, q.to_read], [1, 2, 1], 'c03 waits; c01 and c02 are decided; c02 disagrees with what it agreed to and is to be read');
});

test('status midway: one decision the agent has not read is enough for distill; once it is read, Your decisions says what it points at and the minimum of rows applies', async () => {
  // one decided row, not read: to read, and distill reads it even though a lesson needs two
  const one = await world({ ...listed([1]), claimRows: { ...read(2, 3).claimRows, ...listed([1]).claimRows } });
  const r1 = await status(one.hooks());
  assert.deepEqual(r1.report.rows[1], ['Your queue', 'nothing waits', '']);
  assert.deepEqual(r1.report.rows[2], ['Your decisions', '1 to read', '']);
  assert.equal(r1.report.sentence, 'Status: nothing is paused; the agent has 1 of your decisions to read.');
  assert.equal(r1.report.next, DISTILL, 'something is to read, so the minimum of rows for a rule change does not matter yet');

  // the agent has read it (Rule unclear): one row that points at a rule is below distill.min_claims
  const readOnce = await world({ ...decided([1]), read: [1] });
  const r2 = await status(readOnce.hooks());
  assert.deepEqual(r2.report.rows[1], ['Your queue', 'nothing waits', '']);
  assert.deepEqual(r2.report.rows[2], ['Your decisions', '1 points at a rule', '']);
  assert.equal(r2.report.next, NEXT_TAG, 'one row points at a rule, below distill.min_claims (2)');

  // two rows that point at a rule: distill has a lesson to draft
  const readTwice = await world({ ...decided([1, 2]), read: [1, 2] });
  const r3 = await status(readTwice.hooks());
  assert.deepEqual(r3.report.rows[2], ['Your decisions', '2 point at a rule', '']);
  assert.equal(r3.report.next, DISTILL);

  // decided rows that blame the agent, read as Agent slip: nothing for distill to read or draft, and no row of Your decisions
  const slips = await world({ ...decided([1, 2]), read: [1, 2], readOpts: { reading: 'Agent slip' } });
  const r4 = await status(slips.hooks());
  assert.deepEqual(r4.report.rows.map((row) => row[0]), ['Rulebook', 'Your queue', 'Lessons waiting', 'Last run']);
  assert.deepEqual(r4.report.rows[1], ['Your queue', 'nothing waits', '']);
  assert.equal(r4.report.next, NEXT_TAG);
});

test('the counts of the decisions made follow one row through the editor\'s work and the agent\'s reading: unread, read without a note, a note added, the rules changed, Fixed, agreed', async () => {
  const w = await makeWorld({ claims: 3, ...mix(decided([1], NO_NOTE), read(2, 3)) });
  const key = `${id(1)}::${TAG}`;
  // 1. the editor decided Does not apply and wrote nothing: not read yet, and without a note
  assert.deepEqual(await countsIn(w), { toRead: 1, pending: 0, needsNote: 1 });
  // 2. the agent read it Agent slip (without your note): read, and still without a note; it points at no rule
  markRead(w, [1], { reading: 'Agent slip', noNote: true, noteLine: '' });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 0, needsNote: 1 });
  // 3. read as a rule problem, still without a note: the agent's guess about an unexplained decision points at no rule (decision 78); it only needs a note
  markRead(w, [1], { reading: 'Rule unclear', noNote: true, noteLine: '' });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 0, needsNote: 1 });
  // 4. the editor writes a note: the decision changed since the reading, so the row is to be read again; the note is there
  w.decideRow(key, { note: 'Rule 3 is silent here.' });
  assert.deepEqual(await countsIn(w), { toRead: 1, pending: 0, needsNote: 0 });
  // 5. the agent reads it with the note
  markRead(w, [1], { noteLine: 'Rule 3 is silent here.' });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 1, needsNote: 0 });
  // 6. the agent proposed the tag again under a new edition (a tag run after a promote): the reading belongs to the earlier proposal, so it is to be read again
  w.fake.editRow(w.ids.queue[key], { 'Rulebook edition': '2026-10-16.9' });
  assert.deepEqual(await countsIn(w), { toRead: 1, pending: 0, needsNote: 0 });
  // 7. the editor opens the note with words that look like a reason word: it is plain text (P45), a changed note like any other, and it is to be read
  w.decideRow(key, { note: 'Rule should change.' });
  assert.deepEqual(await countsIn(w), { toRead: 1, pending: 0, needsNote: 0 });
  markRead(w, [1], { reading: 'Rule should change', noteLine: 'Rule should change.' });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 1, needsNote: 0 });
  // 8. a rule change resting on the row went live and the agent now agrees: Fixed rows are never read and never counted
  w.fake.editRow(w.ids.queue[key], { 'After the rule change': 'Fixed' });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 0, needsNote: 0 });
  w.decideRow(key, { note: '' });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 0, needsNote: 0 }, 'a Fixed row without a note is not counted either');
  w.fake.editRow(w.ids.queue[key], { 'After the rule change': 'Still wrong' });
  assert.deepEqual(await countsIn(w), { toRead: 1, pending: 0, needsNote: 1 }, 'Still wrong stays open');
  // 9. the editor takes the agent's side: the outcome equals the proposal, so there is nothing to read
  w.decideRow(key, { outcome: 'Applies', note: '' });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 0, needsNote: 0 });
});

test('readingCounts: every combination at once, counted in rows (a claim with two stale rows counts twice, a row that is not decided or that the agent agreed with counts for nothing)', async () => {
  const base = await makeWorld({ claims: 1 });
  const rubric = base.rubric();
  const cd = rubric.tags.find((t) => t.name === TAG);
  // a second judged tag, so that one claim can have two rows
  const wordy = { ...cd, name: 'Wordy', tag_hash: 'cafe1234cafe1234' };
  const two = { ...rubric, tags: [...rubric.tags.filter((t) => t.name !== 'Wordy'), wordy] };
  const edition = rubric.edition;
  const hash = (over = {}) => readUnder(edition, readingHash({ outcome: 'Does not apply', proposal: 'Applies', noteLine: NOTE_LINE, reasonWord: null, proposalEdition: edition, ...over }));
  const claim = (geo) => ({ geo_id: geo, claim: `Claim ${geo}` });
  const row = (geo, over = {}, tag = TAG) => ({
    Key: `${geo}::${tag}`, Tag: tag, 'Agent proposal': 'Applies', 'Agent reason': '', 'Rulebook edition': edition, 'Tag outcome': 'Does not apply', 'Your note': NOTE_LINE, page_id: `p-${geo}-${tag}`, ...over,
  });
  const reading = (under, over = {}) => ({
    "Agent's view of your decision": 'Rule unclear', Rule: `${TAG} rule 3`, 'Why the agent thinks so': SO, 'Read under': under, ...over,
  });
  const geos = ['stale', 'rule', 'should', 'slip', 'nonote', 'nonote-read', 'fixed', 'agree', 'open', 'changed', 'two'];
  const claims = geos.map(claim);
  const queue = [
    row('stale'), // no reading yet
    row('rule', reading(hash())), // read Rule unclear, current
    row('should', reading(hash(), { "Agent's view of your decision": 'Rule should change' })), // read Rule should change, current
    row('slip', reading(hash(), { "Agent's view of your decision": 'Agent slip', Rule: null })), // read Agent slip, current
    row('nonote', { 'Your note': '' }), // no note, not read
    row('nonote-read', reading(hash({ noteLine: '' }), { 'Why the agent thinks so': `${WITHOUT_NOTE} · ${SO}` }), 'Context-dependent'), // no note, read (flagged)
    row('fixed', { 'After the rule change': 'Fixed' }),
    row('agree', { 'Tag outcome': 'Applies' }), // the editor took the agent's side
    row('open', { 'Tag outcome': null }), // not decided
    row('changed', reading(hash(), { 'Your note': 'A newer note.' })), // read under an older note
    row('two'), row('two', {}, 'Wordy'), // two judged tags, both unread
  ];
  queue.find((r) => r.Key === 'nonote-read::Context-dependent')['Your note'] = '';
  const counts = readingCounts({ claims, queue, rubric: two });
  assert.deepEqual(counts, { to_read: 5, pending_rule_decisions: 2, needs_note: 2 }, 'to read: stale, nonote, changed, the two rows of two; pointing at a rule: rule, should (nonote-read is a guess about a decision without a note: it counts only as without a note); without a note: nonote, nonote-read');
  assert.deepEqual(readingCounts({ claims: [], queue: [], rubric: two }), { to_read: 0, pending_rule_decisions: 0, needs_note: 0 });
  assert.deepEqual(readingCounts({ claims, queue, rubric: null }), { to_read: 0, pending_rule_decisions: 0, needs_note: 0 }, 'without a rulebook there is nothing the agent could read');
  // a tag the agent does not judge (no rules, or outside the judge groups of the config) is not read, so it is not counted
  assert.deepEqual(readingCounts({ claims: [claim('w')], queue: [row('w', {}, 'Wordy')], rubric }), { to_read: 0, pending_rule_decisions: 0, needs_note: 0 });
  assert.deepEqual(readingCounts({ claims: [claim('s')], queue: [row('s')], rubric, config: base.config }), { to_read: 1, pending_rule_decisions: 0, needs_note: 0 });
  const elsewhere = structuredClone(base.config);
  elsewhere.judge.groups = { G1: ['Wordy'] };
  assert.deepEqual(readingCounts({ claims: [claim('s')], queue: [row('s')], rubric, config: elsewhere }), { to_read: 0, pending_rule_decisions: 0, needs_note: 0 }, 'a tag outside the judge groups is not judged');
});

test('decisionsCell: the parts that are not zero, in the order to read, points at a rule, without a note; singular and plural; nothing when all three are zero', () => {
  assert.equal(decisionsCell({ to_read: 3, pending_rule_decisions: 0, needs_note: 1 }), '3 to read, 1 without a note');
  assert.equal(decisionsCell({ to_read: 0, pending_rule_decisions: 1, needs_note: 0 }), '1 points at a rule');
  assert.equal(decisionsCell({ to_read: 0, pending_rule_decisions: 2, needs_note: 0 }), '2 point at a rule');
  assert.equal(decisionsCell({ to_read: 1, pending_rule_decisions: 2, needs_note: 3 }), '1 to read, 2 point at a rule, 3 without a note');
  assert.equal(decisionsCell({ to_read: 0, pending_rule_decisions: 0, needs_note: 4 }), '4 without a note');
  assert.equal(decisionsCell({ to_read: 0, pending_rule_decisions: 0, needs_note: 0 }), '', 'nothing to say: the row is left out');
  assert.equal(decisionsCell(), '');
  for (const text of ['3 to read, 1 without a note', '1 points at a rule', '1 to read, 2 point at a rule, 3 without a note']) assert.deepEqual(lintReport(`Status: x.\n\n| Where | Now |\n|---|---|\n| Your decisions | ${text} |\n\nNext: type /claim-tagger status.`), [], text);
});

test('the row "Your decisions" sits between Your queue and Lessons waiting, shows only the parts that are not zero, is left out when all are zero, and the table never has more than five rows', async () => {
  // 3 to read (one of them without a note) and 1 that points at a rule
  const mixed = await reportOf({
    claims: 6,
    ...mix(decided([1, 2], { status: NOTHING }), decided([3], { status: NOTHING, ...NO_NOTE }), decided([4], { status: NOTHING }), read(5, 6)),
    read: [4],
    lessons: [lesson('Old', 'Live')],
    settings: { 'Last run summary': 'Distill · 16 Oct 09:10 · no rule change' },
  });
  assert.deepEqual(mixed.rows, [
    ['Rulebook', '13 tags, edition 2026-10-16.1', ''],
    ['Your queue', 'nothing waits', ''],
    ['Your decisions', '3 to read, 1 points at a rule, 1 without a note', ''],
    ['Lessons waiting', 'none', ''],
    ['Last run', 'Distill · 16 Oct 09:10 · no rule change', ''],
  ]);
  assert.equal(mixed.next, DISTILL);

  // everything read, nothing points at a rule, every row has a note: nothing to say
  const quiet = await reportOf({ ...mix(decided([1, 2], { status: NOTHING }), read(3, 4)), read: [1, 2], readOpts: { reading: 'Agent slip' } });
  assert.deepEqual(quiet.rows.map((row) => row[0]), ['Rulebook', 'Your queue', 'Lessons waiting', 'Last run']);
  assert.equal(quiet.next, NEXT_TAG);

  // with a rule change waiting the table still has five rows at most
  const full = await reportOf({ ...mix(wait(4), decided([1, 2], { status: NOTHING }), read(3)), lessons: [lesson('A', 'Proposed')] });
  assert.deepEqual(full.rows.map((row) => row[0]), ['Rulebook', 'Your queue', 'Your decisions', 'Lessons waiting', 'Last run']);
  assert.equal(full.rows.length, 5);
  assert.equal(yourDecisions(full)[1], '2 to read');
});

test('status, the Next line takes the first that applies: read, decide, distill, approve, check, tag', async () => {
  // decided rows 1 and 2, both read as a rule problem and no longer listed in Your queue
  const pointing = { ...decided([1, 2], { status: NOTHING }), read: [1, 2] };
  const plus = (extra) => { const m = mix(pointing, extra); return { ...pointing, claimRows: m.claimRows, queue: m.queue }; };

  // decide beats distill: rows that still wait for the editor come first, however many decisions are to read or point at a rule
  assert.match(await nextOf(plus(wait(3))), /^Next: decide your row in Your queue \(/);
  assert.match(await nextOf({ ...plus(wait(3, 4)), configure: (c) => { c.queue.sitting_rows = 1; } }), /^Next: start at the top of Your queue \(/);
  // distill: enough rows that point at a rule, and no rule change that is Proposed or Approved; a Live, Rejected or Rolled back one is not open
  assert.equal(await nextOf(pointing), DISTILL);
  assert.equal(await nextOf({ ...pointing, lessons: [lesson('Old', 'Live'), lesson('No', 'Rejected', { Rule: 'Context-dependent rule 2' }), lesson('Back', 'Rolled back', { Rule: 'Context-dependent rule 3' })] }), DISTILL);
  // an open rule change takes distill's place: approve, then check
  assert.match(await nextOf({ ...pointing, lessons: [lesson('New', 'Proposed')] }), /^Next: approve or reject the rule change in Lessons waiting \(/);
  assert.equal(await nextOf({ ...pointing, lessons: [lesson('Ready', 'Approved')] }), 'Next: type /claim-tagger promote to check the approved rule change.');
  assert.match(await nextOf({ ...pointing, lessons: [lesson('New', 'Proposed'), lesson('Ready', 'Approved', { Rule: 'Context-dependent rule 2' })] }), /^Next: approve or reject the rule change in Lessons waiting \(/);

  // distill while something is to read, even below distill.min_claims: the reading is made only by distill
  const unread = { ...mix(listed([1]), read(2, 3, 4)) };
  assert.equal(await nextOf(unread), DISTILL, 'one decision to read');
  assert.equal(await nextOf({ ...unread, configure: (c) => { c.distill.min_claims = 5; } }), DISTILL, 'whatever the minimum');
  assert.match(await nextOf({ ...unread, lessons: [lesson('New', 'Proposed')] }), /^Next: approve or reject the rule change in Lessons waiting \(/, 'a rule change that waits for the editor comes before the next reading');
  assert.equal(await nextOf({ ...unread, lessons: [lesson('Ready', 'Approved')] }), 'Next: type /claim-tagger promote to check the approved rule change.');
  assert.equal(await nextOf({ ...unread, lessons: [lesson('Old', 'Live')] }), DISTILL);
  const decideToo = mix(unread, wait(3));
  assert.match(await nextOf(decideToo), /^Next: decide your row in Your queue \(/, 'deciding comes before reading');

  // nothing to read and nothing that points at a rule: read new claims
  assert.equal(await nextOf({ ...mix(decided([1, 2], { status: NOTHING }), read(3, 4)), read: [1, 2], readOpts: { reading: 'Agent slip', noteLine: NOTE_LINE } }), NEXT_TAG);
  assert.equal(await nextOf(mix(decided([1, 2], { status: NOTHING, 'Agent proposal': 'Does not apply' }), read(3, 4))), NEXT_TAG, 'the agent had it right: nothing to read');
  // a row that is not decided has no decision to read, whatever its note says
  assert.equal(await nextOf(mix({ claimRows: {}, queue: [1, 2].map((n) => waitRow(n, { 'Agent status': NOTHING, 'Your note': NOTE_LINE })) }, read(1, 2, 3, 4))), NEXT_TAG);
});

test('status asks for distill while a decision is to read, or while at least distill.min_claims rows point at a rule that no rule change has fixed', async () => {
  const next = async (opts) => nextOf({ claims: 4, read: [1, 2, 3], ...opts });
  const rowsOf = (ns, over = {}) => decided(ns, { status: NOTHING, ...over }).queue;
  const marked = (ns, mark) => rowsOf(ns, { 'After the rule change': mark });

  assert.equal(await next({ queue: rowsOf([1, 2]), read: [1, 2] }), DISTILL, 'two rows read as a rule problem: distill drafts one lesson');
  // Fixed means a rule change resting on the row went live and the agent agrees: a finished cycle does not ask for the same lesson again. Still wrong stays open for the next lesson
  assert.equal(await next({ queue: marked([1, 2], 'Fixed'), read: [1, 2] }), NEXT_TAG, 'both marked Fixed');
  assert.equal(await next({ queue: marked([1, 2], 'Still wrong'), read: [1, 2] }), DISTILL, 'both marked Still wrong: the editor adds notes and distills again');
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...marked([2], 'Still wrong')], read: [1, 2] }), NEXT_TAG, 'one Fixed and one Still wrong: one row points at a rule, below distill.min_claims');
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...marked([2, 3], 'Still wrong')] }), DISTILL, 'one Fixed and two Still wrong');
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...rowsOf([2])], read: [1, 2] }), NEXT_TAG, 'one marked and one not: below distill.min_claims');
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...rowsOf([2, 3])] }), DISTILL, 'a third decision makes two again');
  // a new decision the agent has not read beside a finished cycle is to be read: distill reads it
  assert.equal(await next({ queue: [...marked([1, 2], 'Fixed'), ...rowsOf([3])], read: [1, 2] }), DISTILL, 'a new decision beside a finished cycle is to be read');
  assert.equal(await next({ queue: [...marked([1, 2], 'Fixed'), ...rowsOf([3])] }), NEXT_TAG, 'once it is read, one row points at a rule: below distill.min_claims');
  // the count is of rows of the judged tag: a row of a tag the agent does not judge is not counted, and a claim with no row is not counted
  const twoTags = [...marked([1], 'Fixed'), { ...rowsOf([1])[0], Key: `${id(1)}::Wordy`, Tag: 'Wordy' }];
  assert.equal(await next({ queue: [...twoTags, ...rowsOf([2])], read: [1, 2] }), NEXT_TAG, 'Wordy is not judged: only row 2 points at a rule');
  assert.equal(await next({ queue: rowsOf([1]), read: [1] }), NEXT_TAG, 'claims 2 and 3 have no row, so there is nothing to read in them');
  // a decision the agent already got right is no disagreement
  assert.equal(await next({ queue: rowsOf([1, 2], { 'Agent proposal': 'Does not apply' }), read: [] }), NEXT_TAG);
  // the minimum comes from the configuration
  assert.equal(await next({ queue: rowsOf([1, 2]), read: [1, 2], configure: (c) => { c.distill.min_claims = 3; } }), NEXT_TAG);
  assert.equal(await next({ queue: rowsOf([1, 2, 3]), read: [1, 2, 3], configure: (c) => { c.distill.min_claims = 3; } }), DISTILL);
  assert.equal(await next({ queue: rowsOf([1]), read: [1], configure: (c) => { c.distill.min_claims = 1; } }), DISTILL);
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...marked([2], 'Fixed')], read: [1, 2], configure: (c) => { c.distill.min_claims = 1; } }), NEXT_TAG, 'Fixed rows never count, whatever the minimum');
});

// the report check of assertReport, but for the words of decision 79 ("a decision the agent now reads as a slip"): assertReport keeps the word call out of a report, because for an engineer it means a model call
function assertRecantedReport(h, r) {
  assert.deepEqual(lintReport(r.markdown), [], r.markdown);
  assert.equal(h.io.outs.join('\n').trimEnd(), r.markdown.trimEnd());
  assert.ok(!/token|duration|\$|\.mjs|--[a-z]|runs\//i.test(r.markdown) && !/\bcalls?\b/i.test(r.markdown), r.markdown);
  return r.report;
}

test('status asks the editor to reject a rule change that rests on a decision the agent now reads as a slip: the row of Lessons waiting says so, and the Next line comes before "approve or reject" and "promote"', async () => {
  const lines = (...ns) => ns.map((n) => `${claimText(n)} · ${id(n)}::${TAG}`).join('\n');
  const makeIt = async (extra = {}) => {
    const w = await makeWorld({ claims: 4, ...mix(decided([1, 2, 3], { status: NOTHING }), read(4)), lessons: [lesson('Draft', 'Proposed', { 'Supporting rows': lines(1, 2, 3) })], ...extra });
    markRead(w, [1, 2, 3]);
    return w;
  };
  const slip = (w, n) => w.fake.editRow(w.ids.queue[`${id(n)}::${TAG}`], { "Agent's view of your decision": 'Agent slip', Rule: null }); // distill re-read the row as Agent slip
  const lessonsRow = (report) => report.rows.find((row) => row[0] === 'Lessons waiting')[1];

  // three decisions that point at the rule: the draft is to be approved
  const fine = await makeIt();
  const h0 = fine.hooks();
  const r0 = await status(h0);
  const report0 = assertReport(h0, r0);
  assert.equal(lessonsRow(report0), '1 rule change to approve');
  assert.match(report0.next, /^Next: approve or reject the rule change in Lessons waiting \(/);
  assert.deepEqual(r0.json.recanted_lessons, []);

  // distill re-read the row of claim 3 as the agent's own slip: the draft rests on a decision that is no longer a rule problem
  slip(fine, 3);
  const h1 = fine.hooks();
  const r1 = await status(h1);
  const report1 = assertRecantedReport(h1, r1);
  assert.equal(lessonsRow(report1), '1 rule change to reject (rests on a decision the agent now reads as a slip)');
  assert.equal(report1.next, `Next: reject the rule change "Draft" in Lessons waiting (https://www.notion.so/${fine.DB.rule_changes}?v=e3000000000000000000000000000003), then type /claim-tagger distill again.`);
  assert.equal(report1.sentence, 'Status: nothing is paused; 1 rule change waits for you.');
  assert.deepEqual(r1.json.recanted_lessons, ['Draft']);
  assert.equal(fine.writes().length, 0, 'status writes nothing to Notion');

  // an Approved draft is rejected, not checked
  const approved = await makeIt({ lessons: [lesson('Draft', 'Approved', { 'Supporting rows': lines(1, 2, 3) })] });
  slip(approved, 3);
  const hA = approved.hooks();
  const reportA = assertRecantedReport(hA, await status(hA));
  assert.equal(lessonsRow(reportA), '1 rule change to reject (rests on a decision the agent now reads as a slip)', 'not "approved, ready to check"');
  assert.match(reportA.next, /^Next: reject the rule change "Draft" in Lessons waiting/);

  // the editor takes the agent's side on claim 3: the decision is no longer a disagreement, which is another way of not pointing at a rule
  const agreed = await makeIt();
  agreed.decideRow(`${id(3)}::${TAG}`, { outcome: 'Applies' });
  const hG = agreed.hooks();
  const reportG = assertRecantedReport(hG, await status(hG));
  assert.equal(lessonsRow(reportG), '1 rule change to reject (rests on a decision that no longer points at a rule)');

  // two rule changes
  const two = await makeIt({ lessons: [lesson('Draft', 'Proposed', { 'Supporting rows': lines(1, 2, 3) }), lesson('Other', 'Proposed', { Rule: 'Context-dependent rule 2', 'Supporting rows': lines(3, 1) })] });
  slip(two, 3);
  const hT = two.hooks();
  const reportT = assertRecantedReport(hT, await status(hT));
  assert.equal(lessonsRow(reportT), '2 rule changes to reject (they rest on decisions you changed)');
  assert.match(reportT.next, /^Next: reject the 2 rule changes in Lessons waiting \(/);

  // a recanted draft does not hide the rows that wait for the editor: deciding comes first, as it always did
  const waitingToo = await makeIt({ claims: 5, ...mix(decided([1, 2, 3], { status: NOTHING }), read(4), wait(5)) });
  markRead(waitingToo, [1, 2, 3]);
  slip(waitingToo, 3);
  assert.match((await status(waitingToo.hooks())).report.next, /^Next: decide your row in Your queue \(/);
});

test('status, nothing in Your queue and no rule change: the sentence does not say that nothing waits while the agent has decisions to read or decisions have no note', async () => {
  // decisions to read: the sentence follows the row of Your decisions
  const toRead = await reportOf({ ...mix(decided([1, 2, 3], { status: NOTHING }), read(4)) });
  assert.equal(toRead.sentence, 'Status: nothing is paused; the agent has 3 of your decisions to read.');
  assert.equal(yourDecisions(toRead)[1], '3 to read');
  // one decision to read and one without a note: the sentence is about what the agent will do
  const mixed = await reportOf({ ...mix(decided([1], { status: NOTHING }), decided([2], { status: NOTHING, ...NO_NOTE }), read(3, 4)) });
  assert.equal(mixed.sentence, 'Status: nothing is paused; the agent has 2 of your decisions to read.');
  assert.equal(yourDecisions(mixed)[1], '2 to read, 1 without a note');
  // only decisions without a note are left: read, and waiting for a note
  const bare = await reportOf({
    ...mix(decided([1, 2], { status: NOTHING, ...NO_NOTE }), read(3, 4)), read: [1, 2], readOpts: { reading: 'Agent slip', noNote: true, noteLine: '' },
  });
  assert.equal(bare.sentence, 'Status: nothing is paused; 2 of your decisions have no note.');
  assert.equal(yourDecisions(bare)[1], '2 without a note');
  const one = await reportOf({
    ...mix(decided([1], { status: NOTHING, ...NO_NOTE }), read(2, 3, 4)), read: [1], readOpts: { reading: 'Agent slip', noNote: true, noteLine: '' },
  });
  assert.equal(one.sentence, 'Status: nothing is paused; 1 of your decisions has no note.');
  // a reading of a decision without a note supports no draft: two of them make no call for distill (decision 78), only the note is missing
  assert.equal(bare.next, NEXT_TAG);
  const guesses = await reportOf({
    ...mix(decided([1, 2], { status: NOTHING, ...NO_NOTE }), read(3, 4)), read: [1, 2], readOpts: { reading: 'Rule unclear', noNote: true, noteLine: '' },
  });
  assert.equal(yourDecisions(guesses)[1], '2 without a note', 'two readings of Rule unclear without a note point at no rule');
  assert.equal(guesses.next, NEXT_TAG, 'and ask for no draft');
  // a decision that points at a rule is nothing to read and has a note: the sentence stays as it was
  const pointing = await reportOf({ ...mix(decided([1, 2], { status: NOTHING }), read(3, 4)), read: [1, 2] });
  assert.equal(pointing.sentence, 'Status: nothing is paused and nothing waits for you.');
});

test('countsOf: open, decided, decided but still listed, the three counts of the decisions made, lessons by status', async () => {
  const base = await makeWorld({ claims: 1 });
  const rubric = base.rubric();
  const under = (over = {}) => readUnder(rubric.edition, readingHash({ outcome: 'Does not apply', proposal: 'Applies', noteLine: 'Rule 4.', reasonWord: null, proposalEdition: rubric.edition, ...over }));
  const claim = (geo_id, over) => ({ geo_id, claim: `Claim ${geo_id}`, ...over });
  const row = (geo_id, over = {}) => ({
    Key: `${geo_id}::${TAG}`, Tag: TAG, 'Agent proposal': 'Applies', 'Rulebook edition': rubric.edition, page_id: `p-${geo_id}`, 'Tag outcome': 'Does not apply', 'Your note': 'Rule 4.', ...over,
  });
  const readRow = (geo_id, over = {}) => row(geo_id, {
    "Agent's view of your decision": 'Rule unclear', Rule: `${TAG} rule 4`, 'Why the agent thinks so': SO, 'Read under': under(), ...over,
  });
  const c = countsOf({
    claims: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((g) => claim(g, { agent_status: NOTHING })),
    queue: [
      row('a', { 'Tag outcome': null, 'Your note': '', 'Agent status': WAITS, 'Agent proposal': "Can't tell" }), // waits
      row('b', { 'Your note': ' ', 'Agent status': NOTHING }), // decided, no note, not read
      readRow('c', { 'Agent status': WAITS }), // listed, read as a rule problem
      readRow('d', { 'Agent status': ' Waits for you ' }), // listed, read as a rule problem
      row('e', { 'Tag outcome': null, 'Agent status': WAITS, 'Agent proposal': "Can't tell" }), // waits
      readRow('f', { 'After the rule change': 'Fixed', 'Agent status': NOTHING }), // Fixed
      readRow('g', { 'After the rule change': 'Still wrong', 'Agent status': DISAGREES }), // Still wrong
      row('h', { 'Agent status': NOTHING }), // not read yet
    ],
    lessons: [{ Status: 'Proposed' }, { Status: 'Approved' }, { Status: 'Live' }],
    settings: { last_run_summary: 'x' },
    sitting: 1,
    rubric,
    config: base.config,
  });
  // open: a and e (the rows the view lists); decided: all the others; listed: c and d (the status still says Waits for you); to read: b and h (never read); pointing at a rule: c, d and g (Still wrong stays open);
  // without a note: b. f is Fixed
  assert.deepEqual(c.queue, { open: 2, decided: 6, decided_listed: 2, to_read: 2, pending_rule_decisions: 3, needs_note: 1, unread: 0, sitting_rows: 1, more_than_a_sitting: true });
  assert.deepEqual([c.waiting_lessons, c.last_run], [2, 'x']);
  const bare = countsOf({ claims: [claim('b')], rubric, config: base.config });
  assert.deepEqual([bare.queue.to_read, bare.queue.pending_rule_decisions, bare.queue.needs_note], [0, 0, 0], 'without rows there is nothing to read');
  const noRulebook = countsOf({ claims: [claim('b')], queue: [row('b')] });
  assert.deepEqual([noRulebook.queue.to_read, noRulebook.queue.pending_rule_decisions, noRulebook.queue.needs_note], [0, 0, 0], 'without a rulebook the counts are 0');
});

test('status: a bad command line is refused with the usage', async () => {
  const io = { outs: [], errs: [], out: (s) => io.outs.push(s), err: (s) => io.errs.push(s) };
  assert.equal(await main(['--bogus'], io), 2);
  assert.match(io.errs.join('\n'), /usage: node agents\/claim-tagger-mvp\/scripts\/status\.mjs/);
  assert.equal(await main(['--help'], io), 0);
  assert.match(io.outs.join('\n'), /--json/);
});

// ---- the claims the agent has not read yet ------------------------------------------------------------------------------------------------------------------------------
// A claim with no Agent status has not been read by the agent. A table that was just filled holds many of them.

const NEW_CLAIMS_TAG = (n) => `Next: type /claim-tagger tag to read ${n === 1 ? '1 new claim' : `${n} new claims`}.`;
/** assertReport, and the table has the five rows at most (a row is never added for the claims that are not read yet). */
function assertFiveRowsAtMost(h, r) {
  const report = assertReport(h, r);
  assert.ok(report.rows.length <= MAX_ROWS, `${report.rows.length} rows: ${r.markdown}`);
  return report;
}

test('status, a table just filled with claims nobody has tagged: Your queue says how many, Next sends the editor to the tag command and not to distill, the sentence still names the decisions to read', async () => {
  // c01 to c03 are decisions the agent has not read; c04 to c203 have no Agent status
  const w = await makeWorld({ claims: 203, ...decided([1, 2, 3], { status: NOTHING }) });
  const h = w.hooks();
  const r = await status(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const report = assertFiveRowsAtMost(h, r);
  assert.equal(report.sentence, 'Status: nothing is paused; the agent has 3 of your decisions to read.', 'the decisions come first in the sentence, as they did');
  assert.deepEqual(report.rows, [
    ['Rulebook', '13 tags, edition 2026-10-16.1', ''],
    ['Your queue', 'nothing waits; 200 new claims not read yet', ''],
    ['Your decisions', '3 to read', ''],
    ['Lessons waiting', 'none', ''],
    ['Last run', 'none yet', ''],
  ]);
  assert.equal(report.next, 'Next: type /claim-tagger tag to read 200 new claims.', 'tag, not distill: the 200 claims have no tags yet');
  assert.equal(report.rows.length, 5);
  assert.equal(r.json.queue.unread, 200);
  assert.equal(r.json.queue.to_read, 3);
  assert.equal(readJson(join(r.runDir, 'report.json')).next, 'Next: type /claim-tagger tag to read 200 new claims.');
  assert.equal(w.writes().length, 0, 'status writes nothing to Notion');

  // the same table, printed as JSON: the count is under queue with the others
  const j = w.hooks({ json: true });
  await status(j);
  assert.deepEqual(JSON.parse(j.io.outs[0]).queue, { open: 0, decided: 3, decided_listed: 0, to_read: 3, pending_rule_decisions: 0, needs_note: 0, unread: 200, sitting_rows: 20, more_than_a_sitting: false });
});

test('status, rows wait for the editor and claims are not read yet: the cell has both parts, and Next is still to decide the rows (or to start at the top)', async () => {
  const w = await makeWorld({ claims: 8, ...mix(wait(1, 2, 3), read(4)) }); // c05 to c08 have no Agent status
  const h = w.hooks();
  const report = assertFiveRowsAtMost(h, await status(h));
  assert.equal(report.sentence, 'Status: nothing is paused; 3 rows wait for you.', 'the claims not read yet do not wait for the editor');
  assert.deepEqual(report.rows, [
    ['Rulebook', '13 tags, edition 2026-10-16.1', ''],
    ['Your queue', '3 rows, lowest confidence first; 4 new claims not read yet', ''],
    ['Lessons waiting', 'none', ''],
    ['Last run', 'none yet', ''],
  ]);
  assert.match(report.next, DECIDE);
  assert.equal(DECIDE.exec(report.next)[1], 'three');
  assert.ok(!/tag|new claims/.test(report.next), report.next);

  // more rows wait than fit one sitting: start at the top, the cell still has both parts
  const many = await makeWorld({ claims: 8, ...wait(1, 2, 3), configure: (c) => { c.queue.sitting_rows = 2; } });
  const hm = many.hooks();
  const reportMany = assertFiveRowsAtMost(hm, await status(hm));
  assert.equal(reportMany.sentence, 'Status: nothing is paused; 3 rows wait for you, more than fit one sitting.');
  assert.deepEqual(reportMany.rows[1], ['Your queue', '3 rows, lowest confidence first; 5 new claims not read yet', '']);
  assert.match(reportMany.next, /^Next: start at the top of Your queue \(/);

  // a rule change waiting beside the rows and the new claims
  const lessonToo = await makeWorld({ claims: 5, ...wait(1), lessons: [lesson('A', 'Proposed')] });
  const hl = lessonToo.hooks();
  const reportLesson = assertFiveRowsAtMost(hl, await status(hl));
  assert.equal(reportLesson.sentence, 'Status: nothing is paused; 1 row and 1 rule change wait for you.');
  assert.deepEqual(reportLesson.rows[1], ['Your queue', '1 row, lowest confidence first; 4 new claims not read yet', '']);
  assert.match(reportLesson.next, /^Next: decide your row in Your queue \(/);

  // a decided row (Agent status still Waits for you) is not in Your queue and its claim is not unread: only the claims with no Agent status are counted, and Next reads them before distill
  const decidedToo = await makeWorld({ claims: 4, ...mix(listed([1]), read(2)) });
  const hd = decidedToo.hooks();
  const reportListed = assertFiveRowsAtMost(hd, await status(hd));
  assert.deepEqual(reportListed.rows[1], ['Your queue', 'nothing waits; 2 new claims not read yet', '']);
  assert.deepEqual(reportListed.rows[2], ['Your decisions', '1 to read', '']);
  assert.equal(reportListed.next, NEW_CLAIMS_TAG(2), 'nothing is left to decide: reading the new claims comes before distill');
});

test('status, one claim nobody has tagged and nothing else to say: "nothing waits; 1 new claim not read yet", the sentence names the claim, Next is the tag command', async () => {
  const w = await makeWorld({ claims: 3, ...mix(decided([1], { status: NOTHING, 'Agent proposal': 'Does not apply' }), { claimRows: { c01: { 'Agent status': null } }, queue: [] }, read(2)), settings: { 'Last run summary': 'Tag · 15 Oct 11:20 · 2 claims' } });
  const h = w.hooks();
  const r = await status(h);
  const report = assertFiveRowsAtMost(h, r);
  assert.equal(report.sentence, 'Status: nothing is paused; the agent has 2 new claims to read.', 'c01 (no Agent status, whatever its row says) and c03');
  assert.equal(r.json.queue.unread, 2);

  const one = await makeWorld({ claims: 3, ...read(1, 2), settings: { 'Last run summary': 'Tag · 15 Oct 11:20 · 2 claims' } });
  const h1 = one.hooks();
  const r1 = await status(h1);
  const report1 = assertFiveRowsAtMost(h1, r1);
  assert.equal(report1.sentence, 'Status: nothing is paused; the agent has 1 new claim to read.');
  assert.deepEqual(report1.rows, [
    ['Rulebook', '13 tags, edition 2026-10-16.1', ''],
    ['Your queue', 'nothing waits; 1 new claim not read yet', ''],
    ['Lessons waiting', 'none', ''],
    ['Last run', 'Tag · 15 Oct 11:20 · 2 claims', ''],
  ]);
  assert.equal(report1.next, 'Next: type /claim-tagger tag to read 1 new claim.');
  assert.equal(r1.json.queue.unread, 1);
  assert.equal(one.writes().length, 0, 'status writes nothing to Notion');

  // several: the plural form in the sentence, the cell and the Next line
  const several = await makeWorld({ claims: 6, ...read(1, 2) });
  const hs = several.hooks();
  const reportSeveral = assertFiveRowsAtMost(hs, await status(hs));
  assert.equal(reportSeveral.sentence, 'Status: nothing is paused; the agent has 4 new claims to read.');
  assert.deepEqual(reportSeveral.rows[1], ['Your queue', 'nothing waits; 4 new claims not read yet', '']);
  assert.equal(reportSeveral.next, 'Next: type /claim-tagger tag to read 4 new claims.');
});

test('status, no claim is unread: the report is what it was, "nothing waits for you" and the tag command to read new claims, and --json holds unread 0', async () => {
  // a claim the agent could not read and claims it has read: none of them is unread
  const w = await makeWorld({
    claims: 5,
    claimRows: { ...read(1, 2, 4, 5).claimRows, [id(3)]: { 'Agent status': 'Could not read' } },
    settings: { 'Last run summary': 'Tag · 15 Oct 11:20 · 5 claims' },
  });
  const h = w.hooks();
  const r = await status(h);
  const report = assertFiveRowsAtMost(h, r);
  assert.equal(report.sentence, 'Status: nothing is paused and nothing waits for you.');
  assert.deepEqual(report.rows, [
    ['Rulebook', '13 tags, edition 2026-10-16.1', ''],
    ['Your queue', 'nothing waits', ''],
    ['Lessons waiting', 'none', ''],
    ['Last run', 'Tag · 15 Oct 11:20 · 5 claims', ''],
  ]);
  assert.equal(report.next, 'Next: type /claim-tagger tag to read new claims.', 'the final fallback keeps its words');
  assert.equal(r.json.queue.unread, 0);
  assert.ok(!/not read yet/.test(r.markdown), r.markdown);
});

test('countsOf: queue.unread counts the claims whose Agent status is empty after trim; "Could not read" and every other status are not unread', () => {
  const claim = (geo_id, over = {}) => ({ geo_id, claim: `Claim ${geo_id}`, ...over });
  const c = countsOf({
    claims: [
      claim('empty', { agent_status: '' }), // unread
      claim('null', { agent_status: null }), // unread
      claim('missing'), // unread: no Agent status at all
      claim('blank', { agent_status: '   ' }), // unread: only spaces
      claim('could-not-read', { agent_status: 'Could not read' }), // the agent tried
      claim('done', { agent_status: 'Done' }),
      claim('waits', { agent_status: WAITS }),
      claim('disagrees', { agent_status: 'Disagrees with your decision' }),
    ],
  });
  assert.equal(c.queue.unread, 4);
  assert.equal(countsOf({}).queue.unread, 0, 'no claims');
  assert.equal(countsOf({ claims: [claim('x', { agent_status: ' Could not read ' })] }).queue.unread, 0, 'a status with spaces around it is a status');
});

test('status: the sentence names the new claims only when it would have said that nothing waits; every other sentence is as it was', async () => {
  // a rule change waits: the sentence is about it, the Next line is the tag command (new claims come before approving)
  const lessonWaits = await makeWorld({ claims: 4, ...read(1, 2), lessons: [lesson('A', 'Proposed')] });
  const h1 = lessonWaits.hooks();
  const r1 = await status(h1);
  const report1 = assertFiveRowsAtMost(h1, r1);
  assert.equal(report1.sentence, 'Status: nothing is paused; 1 rule change waits for you.');
  assert.deepEqual(report1.rows.find((row) => row[0] === 'Your queue'), ['Your queue', 'nothing waits; 2 new claims not read yet', '']);
  assert.equal(report1.next, NEW_CLAIMS_TAG(2));

  // a decision has no note (read, flagged): its sentence stays
  const bare = await makeWorld({ claims: 4, ...mix(decided([1], { status: NOTHING, ...NO_NOTE }), read(2, 3)) });
  markRead(bare, [1], { reading: 'Agent slip', noNote: true, noteLine: '' });
  const h2 = bare.hooks();
  const report2 = assertFiveRowsAtMost(h2, await status(h2));
  assert.equal(report2.sentence, 'Status: nothing is paused; 1 of your decisions has no note.');
  assert.deepEqual(report2.rows.find((row) => row[0] === 'Your queue'), ['Your queue', 'nothing waits; 1 new claim not read yet', '']);
  assert.equal(report2.next, NEW_CLAIMS_TAG(1));

  // decisions to read: its sentence stays (and the cell and the Next line are the ones of the first test)
  const toRead = await makeWorld({ claims: 5, ...mix(decided([1, 2], { status: NOTHING }), read(3)) });
  const h3 = toRead.hooks();
  const report3 = assertFiveRowsAtMost(h3, await status(h3));
  assert.equal(report3.sentence, 'Status: nothing is paused; the agent has 2 of your decisions to read.');
  assert.equal(report3.next, NEW_CLAIMS_TAG(2));
});

test('status, the Next line for new claims comes after deciding the rows and before distill, rejecting a recanted rule change, approving and promoting', async () => {
  const nextOfWorld = async (w) => {
    const h = w.hooks();
    const r = await status(h);
    assert.equal(r.exit, 0, h.io.errs.join('\n'));
    return assertFiveRowsAtMost(h, r).next;
  };
  // c05 has no Agent status in every world below
  const pointing = mix(decided([1, 2], { status: NOTHING }), read(3, 4));
  const pointed = async (extra = {}) => { const w = await makeWorld({ claims: 5, ...pointing, ...extra }); markRead(w, [1, 2]); return w; };

  // distill would be next (two decisions that point at a rule): not while a claim is not read
  assert.equal(await nextOfWorld(await pointed()), NEW_CLAIMS_TAG(1), 'before distill');
  // a rule change that is Proposed or Approved
  assert.equal(await nextOfWorld(await pointed({ lessons: [lesson('New', 'Proposed')] })), NEW_CLAIMS_TAG(1), 'before approve or reject');
  assert.equal(await nextOfWorld(await pointed({ lessons: [lesson('Ready', 'Approved')] })), NEW_CLAIMS_TAG(1), 'before promote');
  // a rule change that rests on a decision the agent now reads as a slip: the Lessons waiting row says so, the Next line is the tag command
  const lines = (...ns) => ns.map((n) => `${claimText(n)} · ${id(n)}::${TAG}`).join('\n');
  const recanted = await makeWorld({
    claims: 5, ...mix(decided([1, 2, 3], { status: NOTHING }), read(4)), lessons: [lesson('Draft', 'Proposed', { 'Supporting rows': lines(1, 2, 3) })],
  });
  markRead(recanted, [1, 2, 3]);
  recanted.fake.editRow(recanted.ids.queue[`${id(3)}::${TAG}`], { "Agent's view of your decision": 'Agent slip', Rule: null });
  const hr = recanted.hooks();
  const rr = await status(hr);
  const reportRecanted = assertRecantedReport(hr, rr);
  assert.equal(reportRecanted.rows.find((row) => row[0] === 'Lessons waiting')[1], '1 rule change to reject (rests on a decision the agent now reads as a slip)');
  assert.equal(reportRecanted.next, NEW_CLAIMS_TAG(1), 'before rejecting');
  // rows that wait for the editor come first
  assert.match(await nextOfWorld(await pointed({ ...mix(pointing, wait(4)) })), /^Next: decide your row in Your queue \(/);
  // once the new claims are read the line is what it was
  assert.equal(await nextOfWorld(await pointed({ ...mix(pointing, read(5)) })), DISTILL);
});

test('status, the table never has more than five rows with claims not read yet: every row at once, and the Your decisions row left out', async () => {
  // every row at once: the Your decisions row, a rule change, rows to decide, new claims
  const full = await makeWorld({
    claims: 9,
    ...mix(wait(4), decided([1, 2], { status: NOTHING }), read(3)), // c05 to c09 are not read
    lessons: [lesson('A', 'Proposed')],
    settings: { 'Last run summary': 'Tag · 15 Oct 11:20 · 4 claims' },
  });
  const h = full.hooks();
  const report = assertFiveRowsAtMost(h, await status(h));
  assert.deepEqual(report.rows.map((row) => row[0]), ['Rulebook', 'Your queue', 'Your decisions', 'Lessons waiting', 'Last run']);
  assert.equal(report.rows.length, 5);
  assert.deepEqual(report.rows[1], ['Your queue', '1 row, lowest confidence first; 5 new claims not read yet', '']);
  assert.equal(report.sentence, 'Status: nothing is paused; 1 row and 1 rule change wait for you.');
  assert.match(report.next, /^Next: decide your row in Your queue \(/);

  // while a safety check runs, the last row says so and the table is still five rows or fewer
  const checking = await makeWorld({ claims: 4, ...mix(decided([1, 2], { status: NOTHING }), read(3)), lessons: [lesson('A', 'Approved')] });
  checking.write('runs/PROMOTING.json', { run_id: 'x', lesson: 'A long running change', phase: 'judging', since: new Date(Date.UTC(2026, 9, 16, 8, 30)).toISOString() });
  const hc = checking.hooks();
  const reportChecking = assertFiveRowsAtMost(hc, await status(hc));
  assert.equal(reportChecking.rows.length, 5);
  assert.deepEqual(reportChecking.rows[1], ['Your queue', 'nothing waits; 1 new claim not read yet', '']);
  assert.equal(reportChecking.next, NEW_CLAIMS_TAG(1));
});
