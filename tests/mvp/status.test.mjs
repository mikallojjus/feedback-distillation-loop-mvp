import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countsOf, decisionsCell, main, readingCounts, status } from '../../agents/claim-tagger-mvp/scripts/status.mjs';
import { readJson } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { codeRoot } from '../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';
import { WITHOUT_NOTE, readUnder, readingHash } from '../../agents/claim-tagger-mvp/scripts/lib/readings.mjs';
import { lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { claimText, makeWorld } from './helpers/loop-world.mjs';

function assertReport(h, r) {
  assert.ok(r.markdown, 'a report was written');
  assert.deepEqual(lintReport(r.markdown), [], r.markdown);
  assert.equal(h.io.outs.join('\n').trimEnd(), r.markdown.trimEnd());
  assert.ok(!/\bcalls?\b|token|duration|\$|\.mjs|--[a-z]|runs\//i.test(r.markdown), r.markdown);
  return r.report;
}
// the rows that wait are claims of the Claims copy: a claim whose Agent status is Waits for you and that an editor has not Reviewed
const WAITS = 'Waits for you';
const NOTHING = 'Done';
const id = (i) => `c${String(i).padStart(2, '0')}`;
const waiting = (...ns) => Object.fromEntries(ns.map((n) => [id(n), { 'Agent status': WAITS, 'Agent confidence': 0.5 }]));
const read = (...ns) => Object.fromEntries(ns.map((n) => [id(n), { 'Agent status': NOTHING, 'Agent confidence': 0.9 }]));
const reviewed = (ns, over = {}) => Object.fromEntries(ns.map((n) => [id(n), { 'Agent status': NOTHING, 'Review status': 'Reviewed', 'Why wrong': 'Agent slip', 'Challenged tags notes': 'Fine.', ...over }]));
const lesson = (title, Status, over = {}) => ({ Lesson: title, Tag: 'Context-dependent', Rule: 'Context-dependent rule 4', Kind: 'Clarify wording', 'Current text': 'x', 'Proposed text': 'y', Status, ...over });

// the agent's own record of the judged tag of claim n (Tag decisions): it proposed Applies; the editor's decision (no verified tag on the claim) is Does not apply, so the row is a disagreement
const TAG = 'Context-dependent';
const ledgerRow = (n, over = {}) => ({ Claim: claimText(n), Key: `${id(n)}::${TAG}`, Tag: TAG, 'Agent proposal': 'Applies', 'Agent confidence': 0.6, 'Agent reason': 'Maybe. · Context-dependent rule 3 · 2/3 runs agreed', ...over });
const ledgerOf = (ns, over = {}) => ns.map((n) => ledgerRow(n, over));
const NOTE_LINE = 'Rule 3 does not say it.';
const SO = 'The rule leaves this kind of case open.';
/**
 * The ledger rows of the claims ns hold a reading, the way distill leaves them: Agent reading, Rule, Reading note and Read under (the edition and the hash of the decision as it stands:
 * the outcome, the proposal, the note line, the reason word and the edition the proposal was made under). `noteLine` and `reasonWord` are the claim's note without and with its reason
 * word; `proposalEdition` replaces the edition the row holds (its Rulebook edition, null when it has none); `noNote` opens the Reading note with "without your note", as distill does.
 */
function markRead(w, ns, { reading = 'Rule unclear', rule = `${TAG} rule 3`, note = SO, noteLine = NOTE_LINE, reasonWord = 'Rule unclear', noNote = false, proposalEdition = null, proposal = 'Applies', outcome = 'Does not apply' } = {}) {
  const ledger = w.fake.plainRows(w.DB.tag_decisions);
  for (const n of ns) {
    const key = `${id(n)}::${TAG}`;
    const held = ledger.find((r) => r.Key === key) ?? {};
    const hash = readingHash({ outcome, proposal, noteLine, reasonWord, proposalEdition: proposalEdition ?? held['Rulebook edition'] ?? null });
    w.fake.editRow(w.ids.queue[key], {
      'Agent reading': reading, Rule: rule, 'Reading note': noNote ? `${WITHOUT_NOTE} · ${note}` : note, 'Read under': readUnder(w.rubric().edition, hash),
    });
  }
}

test('status, nothing waits: the sentence, the table of four rows and a Next that reads new claims', async () => {
  const w = await makeWorld({ claims: 3, claimRows: { ...reviewed([1]), ...read(2, 3) }, settings: { 'Last run summary': 'Tag · 15 Oct 11:20 · 3 claims' } });
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
  const w = await makeWorld({ claims: 4, claimRows: { ...waiting(1, 2, 3), ...reviewed([4]) }, lessons: [lesson('A proposed change', 'Proposed')] });
  const h = w.hooks();
  const r = await status(h);
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Status: nothing is paused; 3 rows and 1 rule change wait for you.');
  assert.deepEqual(report.rows[1], ['Your queue', '3 rows, lowest confidence first', '']);
  assert.deepEqual(report.rows[2], ['Lessons waiting', '1 rule change to approve', '']);
  assert.deepEqual(report.rows[3], ['Last run', 'none yet', '']);
  assert.match(report.next, /^Next: decide your three claims in Your queue \(https:\/\/www\.notion\.so\/[0-9a-f]{32}\?v=[0-9a-f]{32}\)\.$/);
  assert.ok(report.next.includes(w.DB.claims_copy), 'Your queue is a view of the Claims copy');
});

test('status counts a claim by its Agent status: Done and a Reviewed claim do not wait, Waits for you does', async () => {
  const w = await makeWorld({
    claims: 5,
    claimRows: {
      ...waiting(1),
      [id(2)]: { 'Agent status': 'Waits for you', 'Review status': 'To review' },
      ...read(3),
      ...reviewed([4], { 'Agent status': WAITS }),
    },
  });
  const r = await status(w.hooks());
  assert.equal(r.report.sentence, 'Status: nothing is paused; 2 rows wait for you.', 'c01 and c02; c03 says nothing waits, c04 is Reviewed, c05 was not read');
  assert.deepEqual(r.report.rows[1], ['Your queue', '2 rows, lowest confidence first', '']);
});

test('status, more rows wait than fit one sitting: the count is in the sentence and Next says where to start', async () => {
  const w = await makeWorld({ claims: 5, claimRows: waiting(1, 2, 3, 4), lessons: [lesson('A proposed change', 'Proposed')], configure: (c) => { c.queue.sitting_rows = 3; } });
  const h = w.hooks();
  const r = await status(h);
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Status: nothing is paused; 4 rows and 1 rule change wait for you, more than fit one sitting.');
  assert.match(report.next, /^Next: start at the top of Your queue \(/);
  assert.ok(!/decide the/.test(report.next));
});

test('status, only rule changes wait: approve or reject; an approved one is ready to check; singular and plural read right', async () => {
  const one = await makeWorld({ claims: 2, lessons: [lesson('One', 'Proposed')] });
  const r1 = await status(one.hooks());
  assert.equal(r1.report.sentence, 'Status: nothing is paused; 1 rule change waits for you.');
  assert.match(r1.report.next, /^Next: approve or reject the rule change in Lessons waiting \(https:\/\/www\.notion\.so\//);

  const two = await makeWorld({ claims: 2, lessons: [lesson('One', 'Proposed'), lesson('Two', 'Proposed', { Rule: 'Context-dependent rule 2' })] });
  const r2 = await status(two.hooks());
  assert.equal(r2.report.sentence, 'Status: nothing is paused; 2 rule changes wait for you.');
  assert.match(r2.report.next, /^Next: approve or reject the rule changes in Lessons waiting/);

  const ready = await makeWorld({ claims: 2, lessons: [lesson('Ready', 'Approved'), lesson('Done', 'Live')] });
  const r3 = await status(ready.hooks());
  assert.equal(r3.report.sentence, 'Status: nothing is paused; 1 rule change waits for you.');
  assert.deepEqual(r3.report.rows.find((x) => x[0] === 'Lessons waiting'), ['Lessons waiting', '1 approved, ready to check', '']);
  assert.equal(r3.report.next, 'Next: type /claim-tagger promote to check the approved rule change.');

  const both = await makeWorld({ claims: 2, lessons: [lesson('A', 'Proposed'), lesson('B', 'Approved', { Rule: 'Context-dependent rule 2' })] });
  assert.deepEqual((await status(both.hooks())).report.rows.find((x) => x[0] === 'Lessons waiting'), ['Lessons waiting', '1 rule change to approve, 1 approved, ready to check', '']);
});

test('status, a decision without a note shows in the table as "Your decisions", and there is no row of its own for Needs your note any more', async () => {
  // the editor decided the claim (Does not apply, the agent proposed Applies) and wrote nothing: the agent has not read it yet, and it has no note to read it by
  const w = await makeWorld({ claims: 3, claimRows: { ...reviewed([1], { 'Why wrong': null, 'Challenged tags notes': '' }) }, queue: [ledgerRow(1)] });
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
    claims: 3, claimRows: { ...waiting(1, 2), ...reviewed([3], { 'Why wrong': null, 'Challenged tags notes': '' }) }, queue: [ledgerRow(3)], lessons: [lesson('A', 'Proposed'), lesson('B', 'Live', { Rule: 'Context-dependent rule 2' })],
  });
  const h = w.hooks({ json: true });
  const r = await status(h);
  assert.equal(r.exit, 0);
  assert.equal(h.io.outs.length, 1);
  const json = JSON.parse(h.io.outs[0]);
  assert.deepEqual(json.queue, { open: 2, decided: 1, decided_listed: 0, to_read: 1, pending_rule_decisions: 0, needs_note: 1, sitting_rows: 20, more_than_a_sitting: false }, 'the three counts of the decisions made are under queue');
  assert.match(json.table, new RegExp(w.DB.claims_copy), 'the table the counts are about is the Claims copy');
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

test('status in a practice profile starts with "Demo · "', async () => {
  const w = await makeWorld({ claims: 2, demo: true });
  const r = await status(w.hooks());
  assert.ok(r.markdown.startsWith('Demo · Status: nothing is paused and nothing waits for you.'), r.markdown);
  assert.equal(r.report.demo, true);
});

// the practice page of step 1: one tag in the rulebook, five claims an editor has Reviewed and two that are still open and that the agent has not read yet (no Agent
// tags, notes or confidence: step 2 fills them), no rule change, no run yet
const PRACTICE_TITLE = 'Claim tagger demo · 15 Oct 10:42';
const ONE_TAG = [JSON.parse(readFileSync(join(codeRoot(), 'setup', 'taxonomy-issue.json'), 'utf8')).rows.find((r) => r.Name === 'Context-dependent')];
const earlier = reviewed([3, 4, 5, 6, 7], { 'Agent status': null });
const practicePage = ({ claimRows = {}, ...extra } = {}) => makeWorld({
  claims: 7, rulebook: ONE_TAG, claimRows: { ...earlier, ...claimRows }, demo: true, configure: (c) => { c.demo_title = PRACTICE_TITLE; }, ...extra,
});
const TAG_FIRST = 'Next: type /claim-tagger demo tag so that the agent reads the claims first (step 2 of the practice page).';
const DECIDE = /^Next: decide your (\w+) claims? in Your queue \(https:\/\/www\.notion\.so\/[0-9a-f]{32}\?v=[0-9a-f]{32}\)\.$/;

test('status on a practice page names the page and shows step 1: "1 tag, edition <e>", nothing in Your queue until the agent has read the two open claims, "none", "none yet"', async () => {
  const w = await practicePage();
  const h = w.hooks();
  const r = await status(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  assert.equal(report.sentence, `Status of the practice page ${PRACTICE_TITLE}: nothing is paused and nothing waits for you.`);
  assert.ok(r.markdown.startsWith(`Demo · Status of the practice page ${PRACTICE_TITLE}: nothing is paused and nothing waits for you.\n`), r.markdown);
  assert.deepEqual(report.header, ['Where', 'Now', '']);
  assert.deepEqual(report.rows, [
    ['Rulebook', '1 tag, edition 2026-10-16.1', ''],
    ['Your queue', 'nothing waits', ''],
    ['Lessons waiting', 'none', ''],
    ['Last run', 'none yet', ''],
  ]);
  assert.equal(report.next, TAG_FIRST, 'the agent has not read the claims yet: the editor types the demo tag command (step 2 of the practice page), not decides the rows');
  assert.equal(readJson(join(r.runDir, 'report.json')).next, TAG_FIRST);
});

test('on a practice page the Next line says to type the demo tag command while a claim that is still open has no Agent status yet, and points at Your queue once the agent has read them', async () => {
  const check = async (w) => {
    const h = w.hooks();
    const r = await status(h);
    assert.equal(r.exit, 0, h.io.errs.join('\n'));
    return assertReport(h, r);
  };
  assert.equal((await check(await practicePage())).next, TAG_FIRST, 'step 1: neither open claim has been read');
  assert.equal((await check(await practicePage({ claimRows: waiting(1) }))).next, TAG_FIRST, 'one claim that is not read yet is enough');
  assert.equal((await check(await practicePage({ claimRows: { ...waiting(1), [id(2)]: { 'Agent status': null } } }))).next, TAG_FIRST, 'an empty status is none');
  const both = await check(await practicePage({ claimRows: waiting(1, 2) }));
  assert.match(both.next, DECIDE, 'step 3: the agent has read both claims, the editor decides them');
  assert.equal(DECIDE.exec(both.next)[1], 'two');
  assert.equal(both.sentence, `Status of the practice page ${PRACTICE_TITLE}: nothing is paused; 2 rows wait for you.`);

  // only a claim that is still open can be unread: a Reviewed claim without notes (an earlier decision) does not send the editor back to step 2
  const noEarlier = await check(await practicePage({ claimRows: { ...waiting(1, 2), ...reviewed([3], { 'Agent status': null }) } }));
  assert.match(noEarlier.next, DECIDE);
  assert.equal(DECIDE.exec(noEarlier.next)[1], 'two');

  // unread claims come first, even when more wait than fit one sitting; with nothing to read the Next lines are the ones they always were
  const many = await check(await practicePage({ claims: 9, claimRows: { ...waiting(1, 2, 8), [id(9)]: {} }, configure: (c) => { c.demo_title = PRACTICE_TITLE; c.queue.sitting_rows = 2; } }));
  assert.match(many.sentence, /3 rows wait for you, more than fit one sitting\.$/);
  assert.equal(many.next, TAG_FIRST, 'c09 is not read yet');
  const approved = await check(await practicePage({ claimRows: reviewed([1, 2]), lessons: [lesson('Ready', 'Approved')] }));
  assert.equal(approved.next, 'Next: type /claim-tagger demo promote to check the approved rule change.', 'nothing waits to be read: the line is the one it was');
});

test('in production the Next line stays "decide the rows" even when other claims have no Agent status yet, and --json is the same on a practice page', async () => {
  const production = await makeWorld({ claims: 3, claimRows: waiting(1, 2) }); // c03 is open and not read: in production that is not step 2 of a practice page
  const h = production.hooks();
  const r = await status(h);
  const report = assertReport(h, r);
  assert.match(report.next, DECIDE);
  assert.ok(!/demo|step 2/.test(report.next));

  const practice = await practicePage();
  const j = practice.hooks({ json: true });
  await status(j);
  assert.deepEqual(JSON.parse(j.io.outs[0]).queue, { open: 0, decided: 5, decided_listed: 0, to_read: 0, pending_rule_decisions: 0, needs_note: 0, sitting_rows: 20, more_than_a_sitting: false });
});

test('the table of Step 1 on the practice page is what status prints on a practice page: the same header and the same rows', async () => {
  const page = readFileSync(join(codeRoot(), 'walkthrough', 'page.md'), 'utf8').replace(/\r\n?/g, '\n');
  const step1 = page.slice(page.indexOf('## Step 1'), page.indexOf('## Step 2'));
  const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim());
  const [header, , ...rows] = step1.split('\n').filter((l) => l.startsWith('|')).map(cells);
  const w = await practicePage();
  const r = await status(w.hooks());
  assert.equal(r.exit, 0);
  assert.deepEqual(header, r.report.header.slice(0, 2));
  // Your queue is the row that changed shape (CLAIMS-REVIEW.md, section 1): the two open claims are not in the view until the agent has read them. The row of the page is
  // brought in line with it by the revision of the practice page (section 4); the other three rows are what they were.
  const same = (list) => list.filter((row) => row[0] !== 'Your queue');
  assert.deepEqual(same(rows).map((row) => row.map((c) => c.replace('{{edition}}', '2026-10-16.1'))), same(r.report.rows.map((row) => row.slice(0, 2))));
  assert.deepEqual(r.report.rows.find((row) => row[0] === 'Your queue').slice(0, 2), ['Your queue', 'nothing waits']);
});

test('on a practice page the commands in the report are the demo ones, and a practice profile without a title names no page', async () => {
  const lessons = [lesson('Ready', 'Approved')];
  const demo = await makeWorld({ claims: 2, demo: true, lessons, claimRows: read(1, 2) });
  assert.equal((await status(demo.hooks())).report.next, 'Next: type /claim-tagger demo promote to check the approved rule change.');
  const production = await makeWorld({ claims: 2, lessons, claimRows: read(1, 2) });
  assert.equal((await status(production.hooks())).report.next, 'Next: type /claim-tagger promote to check the approved rule change.');
  assert.equal((await status(demo.hooks())).report.sentence, 'Status: nothing is paused; 1 rule change waits for you.', 'no demo_title in the profile: nothing to name');
  const titled = await practicePage({ lessons, claimRows: waiting(1, 2) });
  assert.equal((await status(titled.hooks())).report.sentence, `Status of the practice page ${PRACTICE_TITLE}: nothing is paused; 2 rows and 1 rule change wait for you.`);
});

test('a practice page title that the report lint refuses is left out of the sentence: the report is written all the same, and the run record says why', async () => {
  const w = await makeWorld({ claims: 2, demo: true, configure: (c) => { c.demo_title = 'The database demo'; } });
  const h = w.hooks();
  const r = await status(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.ok(r.markdown.startsWith('Demo · Status: nothing is paused and nothing waits for you.'), r.markdown);
  assert.ok(readJson(join(r.runDir, 'run.json')).warnings.some((x) => /does not name the practice page/.test(x)));
});

// ---- the decisions made: what the agent still has to read (READ-DECISIONS.md, decision 74) ------------------------------------------------------------------------------

// midway: the editor has decided claims and the agent has not read the decisions yet (the next tag run does), so Your queue still lists them (CLAIMS-REVIEW.md, section 6.2)
const decidedListed = (ns, over = {}) => reviewed(ns, { 'Agent status': WAITS, 'Why wrong': 'Rule unclear', 'Challenged tags notes': NOTE_LINE, ...over });
const DISTILL = 'Next: type /claim-tagger distill to draft a rule change from your decisions.';
const NEXT_TAG = 'Next: type /claim-tagger tag to read new claims.';

/** A world, with the ledger rows of `read` (claim numbers) already holding the reading `readOpts` describes. */
async function world({ read = [], readOpts = {}, claims = 4, ...opts } = {}) {
  const w = await makeWorld({ claims, ...opts });
  if (read.length) markRead(w, read, readOpts);
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

test('status midway, every claim decided but still listed in Your queue: the row says how many are decided and waiting for the agent, Your decisions says two are to read, and Next points at distill', async () => {
  const w = await makeWorld({ claims: 4, claimRows: { ...decidedListed([1, 2]), ...read(3, 4) }, queue: ledgerOf([1, 2]), settings: { 'Last run summary': 'Tag · 15 Oct 11:20 · 4 claims' } });
  const h = w.hooks();
  const r = await status(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Status: nothing is paused and nothing waits for you.', 'nothing is left to decide');
  assert.deepEqual(report.header, ['Where', 'Now', '']);
  assert.deepEqual(report.rows, [
    ['Rulebook', '13 tags, edition 2026-10-16.1', ''],
    ['Your queue', "2 rows decided, waiting for the agent's next run", ''],
    ['Your decisions', '2 to read', ''],
    ['Lessons waiting', 'none', ''],
    ['Last run', 'Tag · 15 Oct 11:20 · 4 claims', ''],
  ]);
  assert.equal(report.next, DISTILL);
  assert.ok(!/nothing waits/.test(report.rows[1][1]));
  assert.equal(w.writes().length, 0, 'status writes nothing to Notion');
  assert.equal(readJson(join(r.runDir, 'report.json')).next, DISTILL);
});

test('status midway: one decision the agent has not read is enough for distill; once it is read, the row says what it points at and the minimum of claims applies', async () => {
  // one decided claim, not read: to read, and distill reads it even though a lesson needs two
  const one = await world({ claimRows: { ...decidedListed([1]), ...read(2, 3) }, queue: ledgerOf([1]) });
  const r1 = await status(one.hooks());
  assert.deepEqual(r1.report.rows[1], ['Your queue', "1 row decided, waiting for the agent's next run", '']);
  assert.deepEqual(r1.report.rows[2], ['Your decisions', '1 to read', '']);
  assert.equal(r1.report.sentence, 'Status: nothing is paused and nothing waits for you.');
  assert.equal(r1.report.next, DISTILL, 'something is to read, so the minimum of claims for a rule change does not matter yet');

  // the agent has read it (Rule unclear) and the claim has left Your queue: one claim that points at a rule is below distill.min_claims
  const readOnce = await world({ claimRows: { ...decidedListed([1], { 'Agent status': NOTHING }), ...read(2, 3) }, queue: ledgerOf([1]), read: [1] });
  const r2 = await status(readOnce.hooks());
  assert.deepEqual(r2.report.rows[1], ['Your queue', 'nothing waits', '']);
  assert.deepEqual(r2.report.rows[2], ['Your decisions', '1 points at a rule', '']);
  assert.equal(r2.report.next, NEXT_TAG, 'one claim points at a rule, below distill.min_claims (2)');

  // two claims that point at a rule: distill has a lesson to draft
  const readTwice = await world({ claimRows: { ...decidedListed([1, 2], { 'Agent status': NOTHING }), ...read(3) }, queue: ledgerOf([1, 2]), read: [1, 2] });
  const r3 = await status(readTwice.hooks());
  assert.deepEqual(r3.report.rows[2], ['Your decisions', '2 point at a rule', '']);
  assert.equal(r3.report.next, DISTILL);

  // decided claims that blame the agent, read as Agent slip: listed until the next tag run all the same, but nothing for distill to read or draft, and no row of Your decisions
  const slips = await world({ claimRows: { ...decidedListed([1, 2], { 'Why wrong': 'Agent slip' }), ...read(3) }, queue: ledgerOf([1, 2]), read: [1, 2], readOpts: { reading: 'Agent slip', reasonWord: 'Agent slip' } });
  const r4 = await status(slips.hooks());
  assert.deepEqual(r4.report.rows.map((row) => row[0]), ['Rulebook', 'Your queue', 'Lessons waiting', 'Last run']);
  assert.deepEqual(r4.report.rows[1], ['Your queue', "2 rows decided, waiting for the agent's next run", '']);
  assert.equal(r4.report.next, NEXT_TAG);
});

test('the counts of the decisions made follow one claim through the editor\'s work and the agent\'s reading: unread, read without a note, a note added, a reason word, the rules changed, Fixed, agreed', async () => {
  const w = await makeWorld({ claims: 3, claimRows: reviewed([1], { 'Why wrong': null, 'Challenged tags notes': '' }), queue: ledgerOf([1]) });
  const key = `${id(1)}::${TAG}`;
  // 1. the editor decided Does not apply and wrote nothing: not read yet, and without a note
  assert.deepEqual(await countsIn(w), { toRead: 1, pending: 0, needsNote: 1 });
  // 2. the agent read it Agent slip (without your note): read, and still without a note; it points at no rule
  markRead(w, [1], { reading: 'Agent slip', noNote: true, noteLine: '', reasonWord: null });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 0, needsNote: 1 });
  // 3. read as a rule problem, still without a note: it points at a rule and needs a note
  markRead(w, [1], { reading: 'Rule unclear', noNote: true, noteLine: '', reasonWord: null });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 1, needsNote: 1 });
  // 4. the editor writes a note: the decision changed since the reading, so the claim is to be read again; the note is there
  w.review(id(1), { tags: [], notes: 'Rule 3 is silent here.' });
  assert.deepEqual(await countsIn(w), { toRead: 1, pending: 0, needsNote: 0 });
  // 5. the agent reads it with the note
  markRead(w, [1], { noteLine: 'Rule 3 is silent here.', reasonWord: null });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 1, needsNote: 0 });
  // 6. the agent proposed the tag again under a new edition (a tag run after a promote): the reading belongs to the earlier proposal, so it is to be read again
  w.fake.editRow(w.ids.queue[`${id(1)}::${TAG}`], { 'Rulebook edition': '2026-10-16.9' });
  assert.deepEqual(await countsIn(w), { toRead: 1, pending: 0, needsNote: 0 });
  // 7. the editor opens the note with a reason word and nothing else: a note, taken as it stands (distill needs no model for it), but it is to be read
  w.review(id(1), { tags: [], notes: 'Rule should change.' });
  assert.deepEqual(await countsIn(w), { toRead: 1, pending: 0, needsNote: 0 });
  markRead(w, [1], { reading: 'Rule should change', noteLine: '', reasonWord: 'Rule should change' });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 1, needsNote: 0 });
  // 8. a rule change resting on the row went live and the agent now agrees: Fixed rows are never read and never counted
  w.fake.editRow(w.ids.queue[key], { 'Follow-up': 'Fixed' });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 0, needsNote: 0 });
  w.review(id(1), { tags: [], notes: '' });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 0, needsNote: 0 }, 'a Fixed row without a note is not counted either');
  w.fake.editRow(w.ids.queue[key], { 'Follow-up': 'Still wrong' });
  assert.deepEqual(await countsIn(w), { toRead: 1, pending: 0, needsNote: 1 }, 'Still wrong stays open');
  // 9. the editor takes the agent's side: the outcome equals the proposal, so there is nothing to read
  w.review(id(1), { tags: [TAG], notes: '' });
  assert.deepEqual(await countsIn(w), { toRead: 0, pending: 0, needsNote: 0 });
});

test('readingCounts: every combination at once, counted in claims (a claim with two stale rows counts once, a claim that is not Reviewed or that the agent agreed with counts for nothing)', async () => {
  const base = await makeWorld({ claims: 1 });
  const rubric = base.rubric();
  const cd = rubric.tags.find((t) => t.name === TAG);
  // a second judged tag, so that one claim can have two rows
  const wordy = { ...cd, name: 'Wordy', tag_hash: 'cafe1234cafe1234' };
  const two = { ...rubric, tags: [...rubric.tags.filter((t) => t.name !== 'Wordy'), wordy] };
  const edition = rubric.edition;
  const hash = (over = {}) => readUnder(edition, readingHash({ outcome: 'Does not apply', proposal: 'Applies', noteLine: NOTE_LINE, reasonWord: null, proposalEdition: edition, ...over }));
  const claim = (geo, notes, over = {}) => ({ geo_id: geo, claim: `Claim ${geo}`, review_status: 'Reviewed', verified_tags: [], challenged_notes: notes, agent_status: 'Done', ...over });
  const row = (geo, over = {}, tag = TAG) => ({ Key: `${geo}::${tag}`, Tag: tag, 'Agent proposal': 'Applies', 'Agent reason': '', 'Rulebook edition': edition, decided: false, page_id: `p-${geo}-${tag}`, ...over });
  const reading = (under, over = {}) => ({ 'Agent reading': 'Rule unclear', Rule: `${TAG} rule 3`, 'Reading note': SO, 'Read under': under, ...over });
  const claims = [
    claim('stale', NOTE_LINE), // no reading yet
    claim('verbatim', `Rule unclear. ${NOTE_LINE}`), // a reason word: taken as it stands, but still to be written
    claim('rule', NOTE_LINE), // read Rule unclear, current
    claim('should', NOTE_LINE), // read Rule should change, current
    claim('slip', NOTE_LINE), // read Agent slip, current
    claim('nonote', ''), // no note, not read
    claim('nonote-read', ''), // no note, read (flagged)
    claim('fixed', NOTE_LINE), // Fixed, not read
    claim('agree', NOTE_LINE, { verified_tags: [TAG] }), // the editor took the agent's side
    claim('open', NOTE_LINE, { review_status: null }), // not Reviewed
    claim('changed', 'A newer note.'), // read under an older note
    claim('two', NOTE_LINE), // two judged tags, both unread
  ];
  const queue = [
    row('stale'), row('verbatim'),
    row('rule', reading(hash())), row('should', reading(hash(), { 'Agent reading': 'Rule should change' })), row('slip', reading(hash(), { 'Agent reading': 'Agent slip', Rule: null })),
    row('nonote'), row('nonote-read', reading(hash({ noteLine: '' }), { 'Reading note': `${WITHOUT_NOTE} · ${SO}` })),
    row('fixed', { 'Follow-up': 'Fixed' }), row('agree'), row('open'), row('changed', reading(hash())), row('two'), row('two', {}, 'Wordy'),
  ];
  const counts = readingCounts({ claims, queue, rubric: two });
  assert.deepEqual(counts, { to_read: 5, pending_rule_decisions: 3, needs_note: 2 }, 'to read: stale, verbatim, nonote, changed, two; pointing at a rule: rule, should, nonote-read; without a note: nonote, nonote-read');
  assert.deepEqual(readingCounts({ claims: [], queue: [], rubric: two }), { to_read: 0, pending_rule_decisions: 0, needs_note: 0 });
  assert.deepEqual(readingCounts({ claims, queue, rubric: null }), { to_read: 0, pending_rule_decisions: 0, needs_note: 0 }, 'without a rulebook there is nothing the agent could read');
  // a tag the agent does not judge (no rules, or outside the judge groups of the config) is not read, so it is not counted
  assert.deepEqual(readingCounts({ claims: [claim('w', NOTE_LINE)], queue: [row('w', {}, 'Wordy')], rubric }), { to_read: 0, pending_rule_decisions: 0, needs_note: 0 });
  assert.deepEqual(readingCounts({ claims: [claim('s', NOTE_LINE)], queue: [row('s')], rubric, config: base.config }), { to_read: 1, pending_rule_decisions: 0, needs_note: 0 });
  const elsewhere = structuredClone(base.config);
  elsewhere.judge.groups = { G1: ['Wordy'] };
  assert.deepEqual(readingCounts({ claims: [claim('s', NOTE_LINE)], queue: [row('s')], rubric, config: elsewhere }), { to_read: 0, pending_rule_decisions: 0, needs_note: 0 }, 'a tag outside the judge groups is not judged');
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
    claimRows: { ...decidedListed([1, 2], { 'Agent status': NOTHING }), ...reviewed([3], { 'Why wrong': null, 'Challenged tags notes': '', 'Agent status': NOTHING }), ...decidedListed([4], { 'Agent status': NOTHING }), ...read(5, 6) },
    queue: ledgerOf([1, 2, 3, 4]),
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
  const quiet = await reportOf({ claimRows: { ...decidedListed([1, 2], { 'Agent status': NOTHING, 'Why wrong': 'Agent slip' }), ...read(3, 4) }, queue: ledgerOf([1, 2]), read: [1, 2], readOpts: { reading: 'Agent slip', reasonWord: 'Agent slip' } });
  assert.deepEqual(quiet.rows.map((row) => row[0]), ['Rulebook', 'Your queue', 'Lessons waiting', 'Last run']);
  assert.equal(quiet.next, NEXT_TAG);

  // with a rule change waiting the table still has five rows at most
  const full = await reportOf({ claimRows: { ...waiting(4), ...decidedListed([1, 2], { 'Agent status': NOTHING }), ...read(3) }, queue: ledgerOf([1, 2]), lessons: [lesson('A', 'Proposed')] });
  assert.deepEqual(full.rows.map((row) => row[0]), ['Rulebook', 'Your queue', 'Your decisions', 'Lessons waiting', 'Last run']);
  assert.equal(full.rows.length, 5);
  assert.equal(yourDecisions(full)[1], '2 to read');
});

test('status, the Next line takes the first that applies: read, decide, distill, approve, check, tag', async () => {
  // decided claims 1 and 2, both read as a rule problem and no longer listed in Your queue
  const pointing = { claimRows: decidedListed([1, 2], { 'Agent status': NOTHING }), queue: ledgerOf([1, 2]), read: [1, 2] };

  // decide beats distill: claims that still wait for the editor come first, however many decisions are to read or point at a rule
  assert.match(await nextOf({ ...pointing, claimRows: { ...pointing.claimRows, ...waiting(3) } }), /^Next: decide your claim in Your queue \(/);
  assert.match(await nextOf({ ...pointing, claimRows: { ...pointing.claimRows, ...waiting(3, 4) }, configure: (c) => { c.queue.sitting_rows = 1; } }), /^Next: start at the top of Your queue \(/);
  // distill: enough claims that point at a rule, and no rule change that is Proposed or Approved; a Live, Rejected or Rolled back one is not open
  assert.equal(await nextOf(pointing), DISTILL);
  assert.equal(await nextOf({ ...pointing, lessons: [lesson('Old', 'Live'), lesson('No', 'Rejected', { Rule: 'Context-dependent rule 2' }), lesson('Back', 'Rolled back', { Rule: 'Context-dependent rule 3' })] }), DISTILL);
  // an open rule change takes distill's place: approve, then check
  assert.match(await nextOf({ ...pointing, lessons: [lesson('New', 'Proposed')] }), /^Next: approve or reject the rule change in Lessons waiting \(/);
  assert.equal(await nextOf({ ...pointing, lessons: [lesson('Ready', 'Approved')] }), 'Next: type /claim-tagger promote to check the approved rule change.');
  assert.match(await nextOf({ ...pointing, lessons: [lesson('New', 'Proposed'), lesson('Ready', 'Approved', { Rule: 'Context-dependent rule 2' })] }), /^Next: approve or reject the rule change in Lessons waiting \(/);

  // distill while something is to read, even below distill.min_claims: the reading is made only by distill
  const unread = { claimRows: { ...decidedListed([1], { 'Agent status': NOTHING }), ...read(2, 3, 4) }, queue: ledgerOf([1]) };
  assert.equal(await nextOf(unread), DISTILL, 'one decision to read');
  assert.equal(await nextOf({ ...unread, configure: (c) => { c.distill.min_claims = 5; } }), DISTILL, 'whatever the minimum');
  assert.match(await nextOf({ ...unread, lessons: [lesson('New', 'Proposed')] }), /^Next: approve or reject the rule change in Lessons waiting \(/, 'a rule change that waits for the editor comes before the next reading');
  assert.equal(await nextOf({ ...unread, lessons: [lesson('Ready', 'Approved')] }), 'Next: type /claim-tagger promote to check the approved rule change.');
  assert.equal(await nextOf({ ...unread, lessons: [lesson('Old', 'Live')] }), DISTILL);
  assert.match(await nextOf({ ...unread, claimRows: { ...unread.claimRows, ...waiting(3) } }), /^Next: decide your claim in Your queue \(/, 'deciding comes before reading');

  // nothing to read and nothing that points at a rule: read new claims
  assert.equal(await nextOf({ claimRows: { ...reviewed([1, 2]), ...read(3, 4) }, queue: ledgerOf([1, 2]), read: [1, 2], readOpts: { reading: 'Agent slip', reasonWord: 'Agent slip', noteLine: 'Fine.' } }), NEXT_TAG);
  assert.equal(await nextOf({ claimRows: { ...reviewed([1, 2], { 'Why wrong': null }), ...read(3, 4) }, queue: ledgerOf([1, 2], { 'Agent proposal': 'Does not apply' }) }), NEXT_TAG, 'the agent had it right: nothing to read');
  // a claim that is not Reviewed has no decision to read, whatever its notes say
  const toReview = (ns) => Object.fromEntries(ns.map((n) => [id(n), { 'Agent status': NOTHING, 'Review status': 'To review', 'Why wrong': 'Rule unclear', 'Challenged tags notes': NOTE_LINE }]));
  assert.equal(await nextOf({ claimRows: { ...toReview([1, 2]), ...read(3, 4) }, queue: ledgerOf([1, 2]) }), NEXT_TAG);
});

test('status asks for distill while a decision is to read, or while at least distill.min_claims claims point at a rule that no rule change has fixed', async () => {
  const claimRows = { ...decidedListed([1, 2, 3], { 'Agent status': NOTHING }), ...read(4) };
  const next = async (opts) => nextOf({ claims: 4, claimRows, read: [1, 2, 3], ...opts });
  const marked = (ns, mark) => ledgerOf(ns, { 'Follow-up': mark });

  assert.equal(await next({ queue: ledgerOf([1, 2]), read: [1, 2] }), DISTILL, 'two rows read as a rule problem: distill drafts one lesson');
  // Fixed means a rule change resting on the row went live and the agent agrees: a finished cycle does not ask for the same lesson again. Still wrong stays open for the next lesson
  assert.equal(await next({ queue: marked([1, 2], 'Fixed'), read: [1, 2] }), NEXT_TAG, 'both marked Fixed');
  assert.equal(await next({ queue: marked([1, 2], 'Still wrong'), read: [1, 2] }), DISTILL, 'both marked Still wrong: the editor adds notes and distills again');
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...marked([2], 'Still wrong')], read: [1, 2] }), NEXT_TAG, 'one Fixed and one Still wrong: one claim points at a rule, below distill.min_claims');
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...marked([2, 3], 'Still wrong')] }), DISTILL, 'one Fixed and two Still wrong');
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...ledgerOf([2])], read: [1, 2] }), NEXT_TAG, 'one marked and one not: below distill.min_claims');
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...ledgerOf([2, 3])] }), DISTILL, 'a third decision makes two again');
  // a new decision the agent has not read beside a finished cycle is to be read: distill reads it
  assert.equal(await next({ queue: [...marked([1, 2], 'Fixed'), ...ledgerOf([3])], read: [1, 2] }), DISTILL, 'a new decision beside a finished cycle is to be read');
  assert.equal(await next({ queue: [...marked([1, 2], 'Fixed'), ...ledgerOf([3])] }), NEXT_TAG, 'once it is read, one claim points at a rule: below distill.min_claims');
  // the count is of claims: a claim with a Fixed row and an unmarked row of another tag is counted once, and a claim with no ledger row is not counted
  const twoTags = [...marked([1], 'Fixed'), { ...ledgerRow(1), Key: `${id(1)}::Wordy`, Tag: 'Wordy' }];
  assert.equal(await next({ queue: [...twoTags, ...ledgerOf([2])], read: [1, 2] }), NEXT_TAG, 'Wordy is not judged: only claim 2 points at a rule');
  assert.equal(await next({ queue: ledgerOf([1]), read: [1] }), NEXT_TAG, 'claims 2 and 3 have no ledger row, so there is nothing to read in them');
  // a decision the agent already got right is no disagreement
  assert.equal(await next({ queue: ledgerOf([1, 2], { 'Agent proposal': 'Does not apply' }), read: [] }), NEXT_TAG);
  // the minimum comes from the configuration
  assert.equal(await next({ queue: ledgerOf([1, 2]), read: [1, 2], configure: (c) => { c.distill.min_claims = 3; } }), NEXT_TAG);
  assert.equal(await next({ queue: ledgerOf([1, 2, 3]), read: [1, 2, 3], configure: (c) => { c.distill.min_claims = 3; } }), DISTILL);
  assert.equal(await next({ queue: ledgerOf([1]), read: [1], configure: (c) => { c.distill.min_claims = 1; } }), DISTILL);
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...marked([2], 'Fixed')], read: [1, 2], configure: (c) => { c.distill.min_claims = 1; } }), NEXT_TAG, 'Fixed rows never count, whatever the minimum');
});

test('status midway on a practice page: the demo distill command, and reading the claims still comes first', async () => {
  // step 4 of the page: both claims decided, the agent has not read the decisions (Agent status still Waits for you), no rule change yet
  const w = await practicePage({ claimRows: decidedListed([1, 2]), queue: ledgerOf([1, 2]) });
  const h = w.hooks();
  const r = await status(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  assert.equal(report.sentence, `Status of the practice page ${PRACTICE_TITLE}: nothing is paused and nothing waits for you.`);
  assert.deepEqual(report.rows, [
    ['Rulebook', '1 tag, edition 2026-10-16.1', ''],
    ['Your queue', "2 rows decided, waiting for the agent's next run", ''],
    ['Your decisions', '2 to read', ''],
    ['Lessons waiting', 'none', ''],
    ['Last run', 'none yet', ''],
  ]);
  assert.equal(report.next, 'Next: type /claim-tagger demo distill to draft a rule change from your decisions.');
  assert.ok(r.markdown.startsWith('Demo · Status of the practice page'), r.markdown);

  // a claim of the page that is still open and not read comes first; a draft that is Proposed takes distill's place
  const unread = await status((await practicePage({ claimRows: { ...decidedListed([1]), [id(2)]: { 'Agent status': null } }, queue: ledgerOf([1, 2]) })).hooks());
  assert.equal(unread.report.next, TAG_FIRST);
  const drafted = await status((await practicePage({ claimRows: decidedListed([1, 2]), queue: ledgerOf([1, 2]), lessons: [lesson('Draft', 'Proposed')] })).hooks());
  assert.match(drafted.report.next, /^Next: approve or reject the rule change in Lessons waiting \(/);
  assert.deepEqual(drafted.report.rows[2], ['Your decisions', '2 to read', ''], 'the second distill reads whatever the editor decided since');

  // the end of the cycle (step 7): the rule change is Live and the follow-up marked both rows, so the page does not ask for the same draft again
  const finished = await practicePage({
    claimRows: decidedListed([1, 2], { 'Agent status': NOTHING }), queue: [...ledgerOf([1], { 'Follow-up': 'Fixed' }), ...ledgerOf([2], { 'Follow-up': 'Fixed' })], lessons: [lesson('Draft', 'Live')],
  });
  markRead(finished, [1, 2]);
  const done = await status(finished.hooks());
  assert.equal(done.report.next, 'Next: type /claim-tagger demo tag to read new claims.');
  assert.ok(!done.report.rows.some((row) => row[0] === 'Your decisions'), 'two Fixed rows: nothing to read or draft');
});

test('countsOf: open, decided, decided but still listed, the three counts of the decisions made, lessons by status', async () => {
  const base = await makeWorld({ claims: 1 });
  const rubric = base.rubric();
  const cd = rubric.tags.find((t) => t.name === TAG);
  const under = (over = {}) => readUnder(rubric.edition, readingHash({ outcome: 'Does not apply', proposal: 'Applies', noteLine: 'Rule 4.', reasonWord: null, proposalEdition: rubric.edition, ...over }));
  const claim = (geo_id, over) => ({ geo_id, claim: `Claim ${geo_id}`, verified_tags: [], ...over });
  const row = (geo_id, over = {}) => ({ Key: `${geo_id}::${TAG}`, Tag: TAG, 'Agent proposal': 'Applies', 'Rulebook edition': rubric.edition, page_id: `p-${geo_id}`, ...over });
  const readRow = (geo_id, over = {}) => row(geo_id, { 'Agent reading': 'Rule unclear', Rule: `${TAG} rule 4`, 'Reading note': SO, 'Read under': under(), ...over });
  const c = countsOf({
    claims: [
      claim('a', { agent_status: WAITS, review_status: null, challenged_notes: '' }),
      claim('b', { agent_status: NOTHING, review_status: 'Reviewed', challenged_notes: ' ' }), // decided, no note, not read
      claim('c', { agent_status: WAITS, review_status: 'Reviewed', challenged_notes: 'Rule 4.' }), // listed, read as a rule problem
      claim('d', { agent_status: ' Waits for you ', review_status: 'Reviewed', challenged_notes: 'Rule 4.' }), // listed, read as a rule problem
      claim('e', { agent_status: WAITS, review_status: 'To review', challenged_notes: 'Rule 4.' }), // not decided
      claim('f', { agent_status: NOTHING, review_status: 'Reviewed', challenged_notes: 'Rule 4.' }), // Fixed
      claim('g', { agent_status: 'Disagrees with your decision', review_status: 'Reviewed', challenged_notes: 'Rule 4.' }), // Still wrong
      claim('h', { agent_status: NOTHING, review_status: 'Reviewed', challenged_notes: 'Rule 4.' }), // not read yet
    ],
    queue: [row('a'), row('b'), readRow('c'), readRow('d'), row('e'), readRow('f', { 'Follow-up': 'Fixed' }), readRow('g', { 'Follow-up': 'Still wrong' }), row('h')],
    lessons: [{ Status: 'Proposed' }, { Status: 'Approved' }, { Status: 'Live' }],
    settings: { last_run_summary: 'x' },
    sitting: 1,
    rubric,
    config: base.config,
  });
  // to read: b and h (never read); pointing at a rule: c, d and g (Still wrong stays open); without a note: b. a and e are not decided, f is Fixed
  assert.deepEqual(c.queue, { open: 2, decided: 6, decided_listed: 2, to_read: 2, pending_rule_decisions: 3, needs_note: 1, sitting_rows: 1, more_than_a_sitting: true });
  assert.deepEqual([c.waiting_lessons, c.last_run], [2, 'x']);
  const bare = countsOf({ claims: [claim('b', { review_status: 'Reviewed', challenged_notes: '' })], rubric, config: base.config });
  assert.deepEqual([bare.queue.to_read, bare.queue.pending_rule_decisions, bare.queue.needs_note], [0, 0, 0], 'without ledger rows there is nothing to read');
  const noRulebook = countsOf({ claims: [claim('b', { review_status: 'Reviewed', challenged_notes: '' })], queue: [row('b')] });
  assert.deepEqual([noRulebook.queue.to_read, noRulebook.queue.pending_rule_decisions, noRulebook.queue.needs_note], [0, 0, 0], 'without a rulebook the counts are 0');
});

test('status: a bad command line is refused with the usage', async () => {
  const io = { outs: [], errs: [], out: (s) => io.outs.push(s), err: (s) => io.errs.push(s) };
  assert.equal(await main(['--bogus'], io), 2);
  assert.match(io.errs.join('\n'), /usage: node agents\/claim-tagger-mvp\/scripts\/status\.mjs/);
  assert.equal(await main(['--help'], io), 0);
  assert.match(io.outs.join('\n'), /--json/);
});

test('status counts a claim marked To review the way propose wrote it: it waits whatever the confidence, and a Reviewed claim does not', async () => {
  const w = await makeWorld({
    claims: 4,
    claimRows: {
      [id(1)]: { 'Agent status': WAITS, 'Agent confidence': 0.9, 'Review status': 'To review' }, // a confident answer on a claim marked To review: propose wrote Waits for you
      [id(2)]: { 'Agent status': NOTHING, 'Agent confidence': 0.9 }, // Review status empty and a confident answer
      [id(3)]: { 'Agent status': NOTHING, 'Agent confidence': 0.9, 'Review status': 'Reviewed' },
    },
  });
  const r = await status(w.hooks());
  assert.equal(r.report.sentence, 'Status: nothing is paused; 1 row waits for you.');
  assert.deepEqual(r.report.rows[1], ['Your queue', '1 row, lowest confidence first', '']);
});
