import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellVerdict, claimColumns, main, notCheckedParts, propose, tagsOfCell } from '../../agents/claim-tagger-mvp/scripts/propose.mjs';
import { readJson, readJsonl } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { stampOf } from '../../agents/claim-tagger-mvp/scripts/lib/editor-words.mjs';
import { NOW, claimId, claimText, makeWorld } from './helpers/loop-world.mjs';

// ---- helpers ---------------------------------------------------------------------------------------------------------------------

const line = (decision, p, extra = {}) => ({
  status: 'ok', id: 'x', item_hash: 'sha256:0000000000000000', call: {},
  tags: [{ name: 'Context-dependent', decision, p, rule_ref: decision === 'apply' ? 'Context-dependent rule 2' : null, reason: `Reason ${decision} ${p}.`, ...extra }],
});
const errorLine = () => ({ status: 'error', id: 'x', item_hash: 'sha256:0000000000000000', tags: [], error: 'bad reply', call: {} });
const RERUN = { band: [0.25, 0.75], include_ask_editor: true, max_share: 0.3 };

/** What every report must be: the lint, and report.md is what the script printed. */
function assertReport(h, r) {
  assert.ok(r.markdown, 'a report was written');
  assert.deepEqual(lintReport(r.markdown), [], r.markdown);
  assert.equal(h.io.outs.join('\n').trimEnd(), r.markdown.trimEnd(), 'the script prints the report and nothing else on stdout');
  assert.ok(!/\bcalls?\b|token|duration|\$|\.mjs|--[a-z]|runs\//i.test(r.markdown), r.markdown);
  return r.report;
}

/** The scenario of the tests: 12 claims, c03 ask_editor, c05 flips on its second read, c08 apply 0.6, c10 confident apply, the rest confident do_not_apply. */
function scenarioTable() {
  const table = {};
  for (let i = 1; i <= 12; i++) table[claimText(i)] = { decision: 'do_not_apply', p: 0.1 };
  table[claimText(3)] = { decision: 'ask_editor', p: 0.5, rule_ref: null, reason: 'Two rules pull apart.' };
  table[claimText(5)] = [{ decision: 'do_not_apply', p: 0.45 }, { decision: 'apply', p: 0.55 }, { decision: 'apply', p: 0.65 }];
  table[claimText(8)] = { decision: 'apply', p: 0.6 };
  table[claimText(10)] = { decision: 'apply', p: 0.9 };
  return table;
}

async function judged(opts = {}) {
  const w = await makeWorld(opts);
  w.table(scenarioTable());
  const j = await w.judge();
  assert.equal(j.exit, 0);
  return w;
}

const writesTo = (w, table) => w.writes().filter((r) => r.path.includes(w.DB[table]) || (r.method === 'PATCH' && r.path.startsWith('/pages/')));

// ---- the verdict of one cell ------------------------------------------------------------------------------------------------------

test('cellVerdict: a sure answer gives a proposal, the confidence max(p, 1 - p) and the reason with its rule and how many runs agree', () => {
  const apply = cellVerdict([line('apply', 0.9), null, null], 'Context-dependent', { rerun: RERUN });
  assert.deepEqual(
    [apply.proposal, apply.confidence, apply.unsure, apply.reason],
    ['Applies', 0.9, false, 'Reason apply 0.9. · Context-dependent rule 2 · 1 of 1 runs agree'],
  );
  const no = cellVerdict([line('do_not_apply', 0.1), line('do_not_apply', 0.2), null], 'Context-dependent', { rerun: RERUN });
  assert.deepEqual([no.proposal, no.confidence, no.unsure, no.agreed, no.runs], ['Does not apply', 0.85, false, 2, 2]);
  assert.equal(no.reason, 'Reason do_not_apply 0.2. · 2 of 2 runs agree', 'a reason without a rule has no rule part; the last read speaks');
});

test('cellVerdict: ask_editor, a p inside the band, reads that disagree and a failed read are all unsure and give Can\'t tell', () => {
  const ask = cellVerdict([line('ask_editor', 0.5), line('ask_editor', 0.5), null], 'Context-dependent', { rerun: RERUN });
  assert.deepEqual([ask.proposal, ask.confidence, ask.unsure], ["Can't tell", 0.5, true]);
  const band = cellVerdict([line('apply', 0.6), null, null], 'Context-dependent', { rerun: RERUN });
  assert.deepEqual([band.proposal, band.confidence, band.unsure], ["Can't tell", 0.6, true]);
  const split = cellVerdict([line('do_not_apply', 0.45), line('apply', 0.55), line('apply', 0.65)], 'Context-dependent', { rerun: RERUN });
  assert.deepEqual([split.proposal, split.confidence, split.unsure, split.agreed, split.runs], ["Can't tell", 0.55, true, 2, 3]);
  assert.match(split.reason, /Context-dependent rule 2 · 2 of 3 runs agree$/);
  const failed = cellVerdict([errorLine(), null, null], 'Context-dependent', { rerun: RERUN });
  assert.deepEqual([failed.proposal, failed.confidence, failed.unsure], ["Can't tell", 0.5, true]);
  assert.equal(failed.reason, 'The agent could not read this claim · 0 of 1 runs agree');
  const later = cellVerdict([line('do_not_apply', 0.1), errorLine(), null], 'Context-dependent', { rerun: RERUN });
  assert.equal(later.unsure, true, 'a later read that failed makes the cell unsure');
});

test('cellVerdict: the practice page shows the Agent reason in the form propose writes ("<k> of <n> runs agree")', () => {
  const unanimous = cellVerdict([line('apply', 0.85), line('apply', 0.85), line('apply', 0.85)], 'Context-dependent', { rerun: RERUN });
  assert.match(unanimous.reason, / · Context-dependent rule 2 · 3 of 3 runs agree$/);
  const page = readFileSync(new URL('../../agents/claim-tagger-mvp/walkthrough/page.md', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../../agents/claim-tagger-mvp/walkthrough/manifest.json', import.meta.url), 'utf8'));
  const rule = manifest.expect.lesson_rule; // the rule the story is about ("Context-dependent rule 3"); the page's Step 2 rows cite it
  const cells = page.split('\n').filter((l) => l.includes('runs agree'));
  assert.equal(cells.length, 2, 'the two rows of Step 2');
  for (const cell of cells) assert.match(cell, new RegExp(` · ${rule} · \\d of \\d runs agree \\|$`));
});

test('cellVerdict: the reason is cut to reason_max_words words', () => {
  const long = line('apply', 0.9, { reason: Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ') });
  const v = cellVerdict([long, null, null], 'Context-dependent', { rerun: RERUN, reasonMaxWords: 10 });
  assert.ok(v.reason.startsWith('w0 w1 w2 w3 w4 w5 w6 w7 w8 w9... · Context-dependent rule 2'), v.reason);
});

// ---- Agent tags and Agent notes ------------------------------------------------------------------------------------------------------

test('notCheckedParts counts the tags no group judges by kind: source tags (Unsourced with them), duplicate tags, tags without rules', async () => {
  const w = await makeWorld({ claims: 1 });
  const text = notCheckedParts(w.rubric(), new Set(['Context-dependent']));
  assert.equal(text, '4 source tags, 2 duplicate tags, 6 tags without rules');
  assert.equal(notCheckedParts({ tags: [{ name: 'A', capability: 'text' }] }, new Set(['A'])), '', 'nothing left over: the part is left out');
  assert.equal(notCheckedParts({ tags: [{ name: 'A', capability: 'source' }, { name: 'B', capability: 'corpus' }] }, new Set()), '1 source tag, 1 duplicate tag');
});

test('claimColumns: the two-line form of Agent notes, with the tags that apply, the count that waits, what was not checked and the edition', () => {
  const base = { judgedNames: ['Context-dependent'], edition: '2026-10-16.2' };
  const sure = claimColumns({ ...base, rows: new Map(), proposals: new Map([['Context-dependent', 'Applies']]), notChecked: '3 source tags, 2 duplicate tags' });
  assert.equal(sure.agent_tags, 'Context-dependent');
  assert.equal(sure.agent_notes, 'Context-dependent\nnothing waits for an editor · not checked: 3 source tags, 2 duplicate tags · edition 2026-10-16.2');
  const none = claimColumns({ ...base, rows: new Map(), proposals: new Map([['Context-dependent', 'Does not apply']]) });
  assert.equal(none.agent_tags, '');
  assert.equal(none.agent_notes, 'no tags\nnothing waits for an editor · edition 2026-10-16.2');
  const waits = claimColumns({ ...base, rows: new Map([['Context-dependent', { open: true }]]), proposals: new Map([['Context-dependent', "Can't tell"]]) });
  assert.equal(waits.agent_tags, '', 'a tag that waits in Your queue is not written');
  assert.equal(waits.agent_notes, 'no tags\n1 waits for an editor · edition 2026-10-16.2');
  const two = claimColumns({ judgedNames: ['A', 'B', 'C'], rows: new Map([['A', { open: true }], ['B', { open: true }]]), proposals: new Map([['C', 'Applies']]), edition: 'e' });
  assert.equal(two.agent_notes, 'C\n2 wait for an editor · edition e', 'two or more wait');
  assert.equal(two.agent_notes.split('\n').length, 2, 'at most two lines');
});

test('claimColumns: an editor always wins, over a sure agent as well, and a tag the judge does not cover counts when an editor decided it', () => {
  const rows = new Map([['Context-dependent', { decided: true, outcome: 'Does not apply' }], ['Wordy', { decided: true, outcome: 'Applies' }]]);
  const c = claimColumns({ judgedNames: ['Context-dependent'], rows, proposals: new Map([['Context-dependent', 'Applies']]), edition: 'e' });
  assert.equal(c.agent_tags, 'Wordy');
  const kept = claimColumns({ judgedNames: ['A', 'B'], rows: new Map(), proposals: new Map([['A', 'Applies']]), currentTags: ['B', 'Z'], edition: 'e' });
  assert.equal(kept.agent_tags, 'A, B', 'a tag without a proposal keeps its place from the cell as it was; a tag nobody knows is dropped');
  assert.deepEqual(tagsOfCell(' A, B ,, C'), ['A', 'B', 'C']);
});

// ---- the run ------------------------------------------------------------------------------------------------------------------------------

test('propose: every unsure cell gets a row and no confident one does; the row holds the proposal, confidence, reason, claim link and edition', async () => {
  const w = await judged();
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const rows = w.rows('tag_decisions');
  assert.deepEqual(rows.map((x) => x.Key).sort(), ['c03::Context-dependent', 'c05::Context-dependent', 'c08::Context-dependent'], 'unsure cells only (ask_editor, a flipping read, a p inside the band)');
  const c03 = w.row('tag_decisions', 'c03::Context-dependent');
  assert.deepEqual(
    [c03.Claim, c03.Tag, c03['Agent proposal'], c03['Agent confidence'], c03['Rulebook edition'], c03['Tag outcome'], c03['Why wrong'], c03['Your reasoning']],
    [claimText(3), 'Context-dependent', "Can't tell", 0.5, '2026-10-16.1', null, null, ''],
  );
  assert.equal(c03['Agent reason'], 'Two rules pull apart. · 2 of 2 runs agree');
  assert.match(c03['Claim link'], /^https:\/\/www\.notion\.so\//, 'the link is the claim row in the Claims copy');
  const c05 = w.row('tag_decisions', 'c05::Context-dependent');
  assert.deepEqual([c05['Agent proposal'], c05['Agent confidence']], ["Can't tell", 0.55]);
  assert.match(c05['Agent reason'], / · Context-dependent rule 1 · 2 of 3 runs agree$/);
  const report = assertReport(h, r);
  assert.equal(report.demo, false);
  assert.equal(report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 3 wait for you.');
  assert.deepEqual(report.rows, [['Claims read', '12', ''], ['Tagged Context-dependent', '1 claim', ''], ['New rows in Your queue', '3, lowest confidence first', '']]);
  assert.equal(report.next, `Next: decide the 3 rows in Your queue (https://www.notion.so/${w.DB.tag_decisions}?v=${'e3000000000000000000000000000001'}).`);
  assert.deepEqual([r.claimsRead, r.created, r.open], [12, 3, 3], 'the result carries the counts for callers');
});

test('propose: the Claims copy gets Agent tags and Agent notes in the two-line form, and only those two columns are named', async () => {
  const w = await judged();
  const r = await propose(w.hooks());
  assert.equal(r.exit, 0);
  const c10 = w.row('claims_copy', 'c10');
  assert.equal(c10['Agent tags'], 'Context-dependent');
  assert.equal(c10['Agent notes'], 'Context-dependent\nnothing waits for an editor · not checked: 4 source tags, 2 duplicate tags, 6 tags without rules · edition 2026-10-16.1');
  const c03 = w.row('claims_copy', 'c03');
  assert.equal(c03['Agent tags'], '');
  assert.equal(c03['Agent notes'], 'no tags\n1 waits for an editor · not checked: 4 source tags, 2 duplicate tags, 6 tags without rules · edition 2026-10-16.1');
  assert.equal(w.row('claims_copy', 'c01')['Agent notes'].split('\n').length, 2);
  for (let i = 1; i <= 12; i++) assert.ok(w.row('claims_copy', claimId(i))['Agent notes'].split('\n').length <= 2);

  const plan = readJsonl(join(r.runDir, 'plan.jsonl')).rows.slice(1);
  const claimOps = plan.filter((op) => op.table === 'claims_copy');
  assert.equal(claimOps.length, 12, 'every claim read got its two columns');
  for (const op of claimOps) assert.deepEqual(Object.keys(op.properties).sort(), ['Agent notes', 'Agent tags'].filter((k) => k in op.properties).sort());
  assert.ok(claimOps.every((op) => Object.keys(op.properties).every((k) => k === 'Agent tags' || k === 'Agent notes')), 'only the two write columns');
  for (const op of plan) assert.ok(['tag_decisions', 'claims_copy', 'agent_settings'].includes(op.table));
  const settings = w.row('agent_settings', 'Claim tagger');
  assert.equal(settings['Last run summary'], `Tag · ${stampOf(NOW)} · 12 claims`);
  assert.equal(settings['Rulebook edition'], '2026-10-16.1');
});

test('propose: a decided row is never touched, an editor\'s Applies reaches Agent tags, and an undecided row is updated when its values changed', async () => {
  const w = await judged({
    queue: [
      { Claim: claimText(5), Key: 'c05::Context-dependent', Tag: 'Context-dependent', 'Agent proposal': "Can't tell", 'Agent confidence': 0.5, 'Agent reason': 'old', 'Rulebook edition': '2026-10-01.1', 'Tag outcome': 'Applies', 'Why wrong': 'Agent slip', 'Your reasoning': 'Mine.' },
      { Claim: claimText(8), Key: 'c08::Context-dependent', Tag: 'Context-dependent', 'Agent proposal': 'Applies', 'Agent confidence': 0.99, 'Agent reason': 'stale', 'Rulebook edition': '2026-10-01.1' },
    ],
  });
  const before = structuredClone(w.row('tag_decisions', 'c05::Context-dependent'));
  const decidedPage = w.ids.queue['c05::Context-dependent'];
  const r = await propose(w.hooks());
  assert.equal(r.exit, 0);
  assert.deepEqual(w.row('tag_decisions', 'c05::Context-dependent'), before, 'the decided row is as the editor left it');
  assert.ok(!w.writes().some((x) => x.path.includes(decidedPage.replace(/-/g, '')) || x.path.includes(decidedPage)), 'no request names the decided row');
  const c08 = w.row('tag_decisions', 'c08::Context-dependent');
  assert.deepEqual([c08['Agent proposal'], c08['Agent confidence'], c08['Rulebook edition']], ["Can't tell", 0.6, '2026-10-16.1'], 'the undecided row follows the new answer');
  assert.deepEqual(w.rows('tag_decisions').map((x) => x.Key).sort(), ['c03::Context-dependent', 'c05::Context-dependent', 'c08::Context-dependent'], 'no second row for a key');
  const c05 = w.row('claims_copy', 'c05');
  assert.equal(c05['Agent tags'], 'Context-dependent', 'the editor decided Applies, so the tag is written');
  assert.match(c05['Agent notes'], /^Context-dependent\nnothing waits for an editor/);
  assert.equal(r.report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 2 wait for you.', 'the decided row does not wait');
  assert.deepEqual(r.report.rows[2], ['New rows in Your queue', '1, lowest confidence first', '']);
});

test('propose: a second run changes nothing in the queue or the Claims copy', async () => {
  const w = await judged();
  const first = await propose(w.hooks());
  assert.equal(first.exit, 0);
  const rowsBefore = structuredClone(w.rows('tag_decisions'));
  const claimsBefore = structuredClone(w.rows('claims_copy'));
  const h = w.hooks();
  const again = await propose(h);
  assert.equal(again.exit, 0, h.io.errs.join('\n'));
  assert.deepEqual(w.rows('tag_decisions'), rowsBefore);
  assert.deepEqual(w.rows('claims_copy'), claimsBefore);
  const plan = readJsonl(join(again.runDir, 'plan.jsonl')).rows;
  assert.deepEqual(plan[0].plan.counts, { creates: 0, updates: 1 }, 'only the Agent settings summary is sent again');
  assert.equal(plan[1].table, 'agent_settings');
  assert.equal(again.report.rows[2][1], 'none', 'no new rows');
  assert.equal(again.report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 3 wait for you.', 'the rows from before still wait');
});

test('propose: when more rows wait than fit one sitting the sentence says so and Next starts at the top of Your queue', async () => {
  const w = await judged({ configure: (c) => { c.queue.sitting_rows = 2; } });
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0);
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 3 wait for you, more than fit one sitting.');
  assert.match(report.next, /^Next: start at the top of Your queue \(https:\/\/www\.notion\.so\/[0-9a-f]{32}\?v=[0-9a-f]{32}\)\.$/);
  assert.ok(!/decide the/.test(report.next));
});

test('propose: one open row says "waits", and with nothing open the sentence and Next say nothing waits', async () => {
  const w = await makeWorld({ claims: 4 });
  const table = {};
  for (let i = 1; i <= 4; i++) table[claimText(i)] = { decision: 'do_not_apply', p: 0.1 };
  table[claimText(2)] = { decision: 'ask_editor', p: 0.5, rule_ref: null };
  w.table(table);
  await w.judge();
  const one = await propose(w.hooks());
  assert.equal(one.report.sentence, 'Tag: the agent read 4 claims for Context-dependent; 1 waits for you.');
  assert.match(one.report.next, /^Next: decide the 1 row in Your queue \(/);

  const w2 = await makeWorld({ claims: 3 });
  w2.table(Object.fromEntries([1, 2, 3].map((i) => [claimText(i), { decision: 'do_not_apply', p: 0.1 }])));
  await w2.judge();
  const h = w2.hooks();
  const none = await propose(h);
  const report = assertReport(h, none);
  assert.equal(report.sentence, 'Tag: the agent read 3 claims for Context-dependent; nothing waits for you.');
  assert.equal(report.next, 'Next: nothing waits for you; type /claim-tagger tag when new claims arrive.');
  assert.deepEqual(report.rows[2], ['New rows in Your queue', 'none', '']);
});

test('propose: in a practice profile the sentence starts with "Demo · " and report.json says so', async () => {
  const w = await judged({ demo: true });
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.ok(r.markdown.startsWith('Demo · Tag: the agent read 12 claims'), r.markdown);
  assert.equal(r.report.demo, true);
  assert.deepEqual(lintReport(r.markdown), []);
  assert.equal(readJson(join(r.runDir, 'report.json')).demo, true);
  assert.equal(r.report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 3 wait for you.', 'no demo_title in the profile: no page to name');
});

test('propose on a practice page: the first sentence ends with the practice page, and the commands in the report are the demo ones', async () => {
  const title = 'Claim tagger demo · 15 Oct 10:42';
  const w = await makeWorld({ claims: 3, demo: true, configure: (c) => { c.demo_title = title; } });
  w.table(Object.fromEntries([1, 2, 3].map((i) => [claimText(i), { decision: 'do_not_apply', p: 0.1 }])));
  await w.judge();
  const h = w.hooks();
  const r = await propose(h);
  const report = assertReport(h, r);
  assert.equal(report.sentence, `Tag: the agent read 3 claims for Context-dependent; nothing waits for you (practice page ${title}).`);
  assert.ok(r.markdown.startsWith(`Demo · Tag: the agent read 3 claims for Context-dependent; nothing waits for you (practice page ${title}).\n`), r.markdown);
  assert.equal(report.next, 'Next: nothing waits for you; type /claim-tagger demo tag when new claims arrive.');
});

test('propose --plan-only: the plan is checked and written, nothing is sent to Notion, and the report says so', async () => {
  const w = await judged();
  const writesBefore = w.writes().length;
  const h = w.hooks({ planOnly: true });
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(w.writes().length, writesBefore, 'no write');
  assert.equal(w.rows('tag_decisions').length, 0);
  const plan = readJsonl(join(r.runDir, 'plan.jsonl')).rows;
  assert.deepEqual(plan[0].plan.counts, { creates: 3, updates: 13 });
  assert.equal(assertReport(h, r).sentence, 'Tag: the plan is ready (3 new rows, 0 row updates, 12 claim updates) and nothing was written to Notion.');
  assert.deepEqual(readJson(join(r.runDir, 'run.json')).plan, { creates: 3, updates: 13 });
});

test('propose: claims the judge has not read are left alone and counted as not read yet', async () => {
  const w = await makeWorld({ claims: 6 });
  w.table(Object.fromEntries([1, 2, 3].map((i) => [claimText(i), { decision: 'do_not_apply', p: 0.1 }])));
  await w.judge({ limit: 3 });
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(r.report.sentence, 'Tag: the agent read 3 claims for Context-dependent; nothing waits for you.');
  assert.deepEqual(r.report.rows.at(-1), ['Not read yet', '3', '']);
  assert.equal(w.row('claims_copy', 'c05')['Agent notes'], '', 'an unread claim keeps its columns');
  assert.notEqual(w.row('claims_copy', 'c01')['Agent notes'], '');
});

test('propose: without any judgment it stops with exit 2 and says the agent has not read a claim yet', async () => {
  const w = await makeWorld({ claims: 3 });
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 2);
  assert.equal(assertReport(h, r).sentence, 'Tag: nothing was proposed, because the agent has not read any claim yet.');
  assert.equal(w.writes().length, 0);
});

test('propose: the run folder holds run.json written first and last, the plan, the ledger and the request log, and no request names a protected id', async () => {
  const w = await judged();
  const r = await propose(w.hooks());
  assert.equal(r.exit, 0);
  const run = readJson(join(r.runDir, 'run.json'));
  assert.equal(run.script, 'propose');
  assert.equal(run.exit_code, 0);
  assert.equal(run.status, 'done');
  assert.equal(run.rubric_edition, '2026-10-16.1');
  assert.ok(run.pull_id && run.started_at && run.finished_at && run.resume);
  const ledger = readJsonl(join(r.runDir, 'ledger.jsonl')).rows;
  assert.ok(ledger.length > 0 && ledger.every((l) => l.status === 'done' && l.read_back === 'ok'), 'every write was read back');
  const log = readJsonl(join(r.runDir, 'requests.jsonl')).rows;
  assert.ok(log.length > 0 && log.every((l) => l.status === 200));
  const protectedIds = [...w.config.notion.protected_database_ids, ...w.config.notion.protected_page_ids].map((id) => id.replace(/-/g, ''));
  for (const req of w.requests()) {
    const text = JSON.stringify(req).replace(/-/g, '');
    for (const id of protectedIds) assert.ok(!text.includes(id), `a request names the protected id ${id}`);
  }
  for (const req of w.writes()) {
    const props = Object.keys(req.body?.properties ?? {});
    for (const forbidden of ['Tag outcome', 'Why wrong', 'Your reasoning', 'Editor wording', 'Paused']) assert.ok(!props.includes(forbidden), `${forbidden} is an editor column`);
  }
});

test('propose: a paused agent stops with exit 3 before it reads or writes anything, and the report points at the Paused box', async () => {
  const w = await judged();
  w.setPaused(true);
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 3);
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Tag: nothing was done, because the agent is paused.');
  assert.match(report.next, /^Next: untick Paused in Agent settings \(https:\/\/www\.notion\.so\/[0-9a-f]{32}\)\.$/);
  assert.equal(w.writes().length, 0);
  assert.equal(readJson(join(r.runDir, 'run.json')).exit_code, 3);
});

test('propose: a bad command line is refused with exit 2 and the usage', async () => {
  const io = { outs: [], errs: [], out: (s) => io.outs.push(s), err: (s) => io.errs.push(s) };
  assert.equal(await main(['--nope'], io), 2);
  assert.match(io.errs.join('\n'), /usage: node agents\/claim-tagger-mvp\/scripts\/propose\.mjs/);
  assert.equal(await main(['--driver', 'real'], io), 2);
  assert.equal(await main(['--help'], io), 0);
  assert.match(io.outs.join('\n'), /--plan-only/);
});

test('propose: reads the same store a judge run with the same driver filled, and a store of another driver is not read', async () => {
  const w = await judged();
  const h = w.hooks({ driver: 'cli' });
  const r = await propose(h);
  assert.equal(r.exit, 2, 'the judge filled the store of the fake driver, and a cli run finds nothing');
  assert.match(r.report.sentence, /has not read any claim yet/);
  assert.equal(w.rows('tag_decisions').length, 0);
});

test('the fixture check: the world\'s rulebook is the real thirteen rows, one judged tag', async () => {
  const w = await makeWorld({ claims: 1 });
  const rubric = readJson(join(w.root, 'rubric', 'rubric.json'));
  assert.equal(rubric.tags.length, 13);
  assert.deepEqual(rubric.tags.filter((t) => t.judged).map((t) => t.name), ['Context-dependent']);
  assert.equal(readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8').trim().split('\n').length, 1);
});
