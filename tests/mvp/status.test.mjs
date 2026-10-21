import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countsOf, main, status } from '../../agents/claim-tagger-mvp/scripts/status.mjs';
import { readJson } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { codeRoot } from '../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';
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

test('status, a Reviewed claim with a Why wrong and no Challenged tags notes shows in the table', async () => {
  const w = await makeWorld({ claims: 3, claimRows: { ...reviewed([1], { 'Why wrong': 'Rule unclear', 'Challenged tags notes': '' }), ...reviewed([2], { 'Why wrong': 'Rule should change', 'Challenged tags notes': 'Rule 4.' }) } });
  const r = await status(w.hooks());
  assert.deepEqual(r.report.rows.find((x) => x[0] === 'Needs your note'), ['Needs your note', '1 row', '']);
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
  const w = await makeWorld({ claims: 3, claimRows: { ...waiting(1, 2), ...reviewed([3], { 'Why wrong': 'Rule unclear', 'Challenged tags notes': '' }) }, lessons: [lesson('A', 'Proposed'), lesson('B', 'Live', { Rule: 'Context-dependent rule 2' })] });
  const h = w.hooks({ json: true });
  const r = await status(h);
  assert.equal(r.exit, 0);
  assert.equal(h.io.outs.length, 1);
  const json = JSON.parse(h.io.outs[0]);
  assert.deepEqual(json.queue, { open: 2, decided: 1, decided_listed: 0, pending_rule_decisions: 0, needs_note: 1, sitting_rows: 20, more_than_a_sitting: false });
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
  assert.deepEqual(JSON.parse(j.io.outs[0]).queue, { open: 0, decided: 5, decided_listed: 0, pending_rule_decisions: 0, needs_note: 0, sitting_rows: 20, more_than_a_sitting: false });
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

// midway: the editor has decided claims and the agent has not read the decisions yet (the next tag run does), so Your queue still lists them (CLAIMS-REVIEW.md, section 6.2)
const decidedListed = (ns, over = {}) => reviewed(ns, { 'Agent status': WAITS, 'Why wrong': 'Rule unclear', 'Challenged tags notes': 'Rule 3 does not say it.', ...over });
// the agent's own record of the judged tag of each claim (Tag decisions): the agent proposed Applies, the editor's decision (no verified tag) differs, so Why wrong counts
const ledger = (ns, over = {}) => ns.map((n) => ({ Claim: claimText(n), Key: `${id(n)}::Context-dependent`, Tag: 'Context-dependent', 'Agent proposal': 'Applies', ...over }));
const DISTILL = 'Next: type /claim-tagger distill to draft a rule change from your decisions.';
const TAG = 'Next: type /claim-tagger tag to read new claims.';

test('status midway, every claim decided but still listed in Your queue: the row says how many are decided and waiting for the agent, and Next points at distill', async () => {
  const w = await makeWorld({ claims: 4, claimRows: { ...decidedListed([1, 2]), ...read(3, 4) }, queue: ledger([1, 2]), settings: { 'Last run summary': 'Tag · 15 Oct 11:20 · 4 claims' } });
  const h = w.hooks();
  const r = await status(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Status: nothing is paused and nothing waits for you.', 'nothing is left to decide');
  assert.deepEqual(report.header, ['Where', 'Now', '']);
  assert.deepEqual(report.rows, [
    ['Rulebook', '13 tags, edition 2026-10-16.1', ''],
    ['Your queue', "2 rows decided, waiting for the agent's next run", ''],
    ['Lessons waiting', 'none', ''],
    ['Last run', 'Tag · 15 Oct 11:20 · 4 claims', ''],
  ]);
  assert.equal(report.next, DISTILL);
  assert.ok(!/nothing waits/.test(report.rows[1][1]));
  assert.equal(w.writes().length, 0, 'status writes nothing to Notion');
  assert.equal(readJson(join(r.runDir, 'report.json')).next, DISTILL);
});

test('status midway: one decided claim reads in the singular, and the row says nothing waits once the agent has read the decision', async () => {
  const one = await makeWorld({ claims: 3, claimRows: { ...decidedListed([1]), ...read(2, 3) }, queue: ledger([1]) });
  const r1 = await status(one.hooks());
  assert.deepEqual(r1.report.rows[1], ['Your queue', "1 row decided, waiting for the agent's next run", '']);
  assert.equal(r1.report.sentence, 'Status: nothing is paused and nothing waits for you.');
  assert.equal(r1.report.next, TAG, 'one decision is below distill.min_claims (2): distill would draft nothing');

  // the agent has read the decisions (Agent status Done): the claims have left Your queue, so the row is "nothing waits"; distill still has the decisions to read
  const gone = await makeWorld({ claims: 3, claimRows: { ...decidedListed([1, 2], { 'Agent status': NOTHING }), ...read(3) }, queue: ledger([1, 2]) });
  const r2 = await status(gone.hooks());
  assert.deepEqual(r2.report.rows[1], ['Your queue', 'nothing waits', '']);
  assert.equal(r2.report.next, DISTILL);

  // decided claims that blame the agent, not the rule, are listed until the next run all the same, but give distill nothing to read
  const slip = await makeWorld({ claims: 3, claimRows: { ...decidedListed([1, 2], { 'Why wrong': 'Agent slip' }), ...read(3) }, queue: ledger([1, 2]) });
  const r3 = await status(slip.hooks());
  assert.deepEqual(r3.report.rows[1], ['Your queue', "2 rows decided, waiting for the agent's next run", '']);
  assert.equal(r3.report.next, TAG);
});

test('status, the Next line takes the first that applies: read, decide, distill, approve, check, tag', async () => {
  const next = async (opts) => (await status((await makeWorld({ claims: 4, ...opts })).hooks())).report.next;
  const ruleDecisions = { ...decidedListed([1]), ...reviewed([2], { 'Why wrong': 'Rule should change' }) };
  const queue = ledger([1, 2]);

  // decide beats distill: claims that still wait for the editor come first, however many decisions blame the rule
  assert.match(await next({ claimRows: { ...ruleDecisions, ...waiting(3) }, queue }), /^Next: decide your claim in Your queue \(/);
  // the rows of one sitting too
  assert.match(await next({ claimRows: { ...ruleDecisions, ...waiting(3, 4) }, queue, configure: (c) => { c.queue.sitting_rows = 1; } }), /^Next: start at the top of Your queue \(/);
  // distill: enough decisions that blame the rule, and no rule change that is Proposed or Approved; a Live, Rejected or Rolled back one is not open
  assert.equal(await next({ claimRows: ruleDecisions, queue }), DISTILL);
  assert.equal(await next({ claimRows: ruleDecisions, queue, lessons: [lesson('Old', 'Live'), lesson('No', 'Rejected', { Rule: 'Context-dependent rule 2' }), lesson('Back', 'Rolled back', { Rule: 'Context-dependent rule 3' })] }), DISTILL);
  // an open rule change takes distill's place: approve, then check
  assert.match(await next({ claimRows: ruleDecisions, queue, lessons: [lesson('New', 'Proposed')] }), /^Next: approve or reject the rule change in Lessons waiting \(/);
  assert.equal(await next({ claimRows: ruleDecisions, queue, lessons: [lesson('Ready', 'Approved')] }), 'Next: type /claim-tagger promote to check the approved rule change.');
  assert.match(await next({ claimRows: ruleDecisions, queue, lessons: [lesson('New', 'Proposed'), lesson('Ready', 'Approved', { Rule: 'Context-dependent rule 2' })] }), /^Next: approve or reject the rule change in Lessons waiting \(/);
  // nothing blames the rule: read new claims
  assert.equal(await next({ claimRows: { ...reviewed([1, 2]), ...read(3, 4) }, queue }), TAG);
  assert.equal(await next({ claimRows: { ...reviewed([1, 2], { 'Why wrong': null }), ...read(3, 4) }, queue }), TAG);
  // a claim that is not Reviewed has no decision to read, whatever its Why wrong says
  const toReview = (ns) => Object.fromEntries(ns.map((n) => [id(n), { 'Agent status': NOTHING, 'Review status': 'To review', 'Why wrong': 'Rule unclear' }]));
  assert.equal(await next({ claimRows: { ...toReview([1, 2]), ...read(3, 4) }, queue }), TAG);
});

test('status asks for distill only while distill has something to draft: at least distill.min_claims decisions on rows not marked Fixed', async () => {
  const claimRows = { ...decidedListed([1, 2, 3], { 'Agent status': NOTHING }), ...read(4) };
  const next = async (opts) => (await status((await makeWorld({ claims: 4, claimRows, ...opts })).hooks())).report.next;
  const marked = (ns, mark) => ledger(ns, { 'Follow-up': mark });

  assert.equal(await next({ queue: ledger([1, 2]) }), DISTILL, 'two unmarked rows: distill drafts one lesson');
  // Fixed means a rule change resting on the row went live and the agent agrees: a finished cycle does not ask for the same lesson again. Still wrong stays open for the next lesson
  assert.equal(await next({ queue: marked([1, 2], 'Fixed') }), TAG, 'both marked Fixed');
  assert.equal(await next({ queue: marked([1, 2], 'Still wrong') }), DISTILL, 'both marked Still wrong: the editor adds notes and distills again');
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...marked([2], 'Still wrong')] }), TAG, 'one Fixed and one Still wrong: one pending decision is below distill.min_claims');
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...marked([2, 3], 'Still wrong')] }), DISTILL, 'one Fixed and two Still wrong');
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...ledger([2])] }), TAG, 'one marked and one not: below distill.min_claims');
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...ledger([2, 3])] }), DISTILL, 'a third decision makes two pending again');
  assert.equal(await next({ queue: [...marked([1, 2], 'Fixed'), ...ledger([3])] }), TAG, 'one new decision beside a finished cycle is below the minimum');
  // the pending count is of claims: a claim with a marked row and an unmarked row of another tag is pending once, and a claim with no ledger row is not counted
  const twoTags = [...marked([1], 'Fixed'), { ...ledger([1])[0], Key: `${id(1)}::Wordy`, Tag: 'Wordy' }];
  assert.equal(await next({ queue: [...twoTags, ...ledger([2])] }), DISTILL, 'claim 1 still has an unmarked row, claim 2 is pending too');
  assert.equal(await next({ queue: ledger([1]) }), TAG, 'claims 2 and 3 have no ledger row, so distill has nothing to read from them');
  // a decision the agent already got right gives distill no rule problem to read
  assert.equal(await next({ queue: ledger([1, 2], { 'Agent proposal': 'Does not apply' }) }), TAG);
  // the minimum comes from the configuration
  assert.equal(await next({ queue: ledger([1, 2]), configure: (c) => { c.distill.min_claims = 3; } }), TAG);
  assert.equal(await next({ queue: ledger([1, 2, 3]), configure: (c) => { c.distill.min_claims = 3; } }), DISTILL);
  assert.equal(await next({ queue: ledger([1]), configure: (c) => { c.distill.min_claims = 1; } }), DISTILL);
  assert.equal(await next({ queue: [...marked([1], 'Fixed'), ...marked([2], 'Fixed')], configure: (c) => { c.distill.min_claims = 1; } }), TAG, 'Fixed rows never count, whatever the minimum');
});

test('status midway on a practice page: the demo distill command, and reading the claims still comes first', async () => {
  // step 4 of the page: both claims decided with Rule unclear, the agent has not read the decisions (Agent status still Waits for you), no rule change yet
  const w = await practicePage({ claimRows: decidedListed([1, 2]), queue: ledger([1, 2]) });
  const h = w.hooks();
  const r = await status(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const report = assertReport(h, r);
  assert.equal(report.sentence, `Status of the practice page ${PRACTICE_TITLE}: nothing is paused and nothing waits for you.`);
  assert.deepEqual(report.rows, [
    ['Rulebook', '1 tag, edition 2026-10-16.1', ''],
    ['Your queue', "2 rows decided, waiting for the agent's next run", ''],
    ['Lessons waiting', 'none', ''],
    ['Last run', 'none yet', ''],
  ]);
  assert.equal(report.next, 'Next: type /claim-tagger demo distill to draft a rule change from your decisions.');
  assert.ok(r.markdown.startsWith('Demo · Status of the practice page'), r.markdown);

  // a claim of the page that is still open and not read comes first; a draft that is Proposed takes distill's place
  const unread = await status((await practicePage({ claimRows: { ...decidedListed([1]), [id(2)]: { 'Agent status': null } }, queue: ledger([1, 2]) })).hooks());
  assert.equal(unread.report.next, TAG_FIRST);
  const drafted = await status((await practicePage({ claimRows: decidedListed([1, 2]), queue: ledger([1, 2]), lessons: [lesson('Draft', 'Proposed')] })).hooks());
  assert.match(drafted.report.next, /^Next: approve or reject the rule change in Lessons waiting \(/);

  // the end of the cycle (step 7): the rule change is Live and the follow-up marked both rows, so the page does not ask for the same draft again
  const finished = await status((await practicePage({
    claimRows: decidedListed([1, 2], { 'Agent status': NOTHING }), queue: [...ledger([1], { 'Follow-up': 'Fixed' }), ...ledger([2], { 'Follow-up': 'Fixed' })], lessons: [lesson('Draft', 'Live')],
  })).hooks());
  assert.equal(finished.report.next, 'Next: type /claim-tagger demo tag to read new claims.');
});

test('status midway: the report stays three parts with at most five rows, the row for Needs your note included', async () => {
  const w = await makeWorld({ claims: 3, claimRows: { ...decidedListed([1, 2], { 'Challenged tags notes': '' }), ...read(3) }, queue: ledger([1, 2]), lessons: [lesson('Old', 'Live')] });
  const h = w.hooks();
  const r = await status(h);
  const report = assertReport(h, r);
  assert.deepEqual(report.rows.map((row) => row[0]), ['Rulebook', 'Your queue', 'Needs your note', 'Lessons waiting', 'Last run']);
  assert.equal(report.rows.length, 5);
  assert.equal(report.rows[1][1], "2 rows decided, waiting for the agent's next run");
  assert.equal(report.next, DISTILL);
});

test('countsOf: open, decided, decided but still listed, decisions distill would still read, needs a note, lessons by status', () => {
  const claim = (geo_id, over) => ({ geo_id, ...over });
  const key = (geo_id, tag = 'Context-dependent') => `${geo_id}::${tag}`;
  const row = (geo_id, over = {}) => ({ Key: key(geo_id), Tag: 'Context-dependent', 'Agent proposal': 'Applies', ...over });
  const c = countsOf({
    claims: [
      claim('a', { agent_status: WAITS, review_status: null, why_wrong: null, challenged_notes: '' }),
      claim('b', { agent_status: NOTHING, review_status: 'Reviewed', why_wrong: 'Rule unclear', challenged_notes: ' ' }),
      claim('c', { agent_status: WAITS, review_status: 'Reviewed', why_wrong: 'Agent slip', challenged_notes: 'Fine.' }),
      claim('d', { agent_status: ' Waits for you ', review_status: 'Reviewed', why_wrong: 'Rule should change', challenged_notes: 'Rule 4.' }),
      claim('e', { agent_status: WAITS, review_status: 'To review', why_wrong: 'Rule unclear', challenged_notes: 'Rule 4.' }),
      claim('f', { agent_status: NOTHING, review_status: 'Reviewed', why_wrong: 'Rule unclear', challenged_notes: 'Rule 4.' }),
      claim('g', { agent_status: 'Disagrees with your decision', review_status: 'Reviewed', why_wrong: 'Rule unclear', challenged_notes: 'Rule 4.' }),
    ],
    queue: [row('a'), row('b'), row('c'), row('d'), row('e'), row('f', { 'Follow-up': 'Fixed' }), row('g', { 'Follow-up': 'Still wrong' })],
    lessons: [{ Status: 'Proposed' }, { Status: 'Approved' }, { Status: 'Live' }],
    settings: { last_run_summary: 'x' },
    sitting: 1,
  });
  // pending: b and d (Reviewed, a rule problem, not marked Fixed) and g (marked Still wrong: it stays open); c blames the agent, e is not Reviewed, f is marked Fixed
  assert.deepEqual(c.queue, { open: 2, decided: 5, decided_listed: 2, pending_rule_decisions: 3, needs_note: 1, sitting_rows: 1, more_than_a_sitting: true });
  assert.deepEqual([c.waiting_lessons, c.last_run], [2, 'x']);
  assert.equal(countsOf({ claims: [claim('b', { review_status: 'Reviewed', why_wrong: 'Rule unclear' })] }).queue.pending_rule_decisions, 0, 'without ledger rows distill has nothing to read');
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
