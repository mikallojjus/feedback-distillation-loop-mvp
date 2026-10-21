import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellVerdict, claimColumns, main, notCheckedParts, openClaimCount, propose, reasonsOfCell, tagsOfCell } from '../../agents/claim-tagger-mvp/scripts/propose.mjs';
import { status } from '../../agents/claim-tagger-mvp/scripts/status.mjs';
import { normId } from '../../agents/claim-tagger-mvp/scripts/lib/notion-values.mjs';
import { readJson, readJsonl } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { reasonLine, stampOf } from '../../agents/claim-tagger-mvp/scripts/lib/editor-words.mjs';
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

const statusOf = (w) => status(w.hooks());
const writesTo = (w, table) => w.writes().filter((r) => r.path.includes(w.DB[table]) || (r.method === 'PATCH' && r.path.startsWith('/pages/')));
const CD = 'Context-dependent';
/** The claims an editor Reviewed in the tests below: c05 (the agent could not tell) decided Applies, c08 (could not tell) Does not apply, c10 (the agent applies it) Does not apply. */
function reviewScenario(w) {
  w.review('c05', { tags: [CD], why: 'Rule unclear', notes: `${CD}: rule 3 does not say so.` });
  w.review('c08', { tags: [], why: 'Rule should change', notes: 'The phrase names a body readers know.' });
  w.review('c10', { tags: [], why: 'Agent slip', notes: '' });
}

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
  // the rows of Step 2's Agent reasons table: the form propose writes, "<reason> · <rule, when one is cited> · <k> of <n> runs agree"
  const cells = page.split('\n').filter((l) => l.startsWith('|') && l.includes('runs agree'));
  assert.equal(cells.length, 2, 'the two rows of Step 2');
  for (const cell of cells) assert.match(cell, new RegExp(` · (?:${rule} · )?\\d of \\d runs agree \\|$`));
  assert.match(cells[0], new RegExp(` · ${rule} · 1 of 1 runs agree \\|$`), 'a claim the agent is sure of is read once: its line ends with one of one');
  // no figure the tag step cannot produce: three readings are never made at once (a second one only for an unsure claim, a third only when the first two disagree)
  assert.ok(!/\b[23] of 3 runs agree\b/.test(page), 'no "2 of 3" or "3 of 3" on the page');
  assert.ok(!/three readings/.test(page));
  for (const cell of cells) {
    const [, k, n] = /(\d) of (\d) runs agree/.exec(cell);
    assert.ok(Number(k) <= Number(n) && Number(n) <= 2, `${k} of ${n}: a count the tag step can write on the first and second reading`);
  }
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
  const base = { judgedNames: [CD], edition: '2026-10-16.2' };
  const sure = claimColumns({ ...base, verdicts: new Map([[CD, 'Applies']]), notChecked: '3 source tags, 2 duplicate tags' });
  assert.equal(sure.agent_tags, CD);
  assert.equal(sure.agent_notes, `${CD}\nnothing waits for an editor · not checked: 3 source tags, 2 duplicate tags · edition 2026-10-16.2`);
  const none = claimColumns({ ...base, verdicts: new Map([[CD, 'Does not apply']]) });
  assert.equal(none.agent_tags, '');
  assert.equal(none.agent_notes, 'no tags\nnothing waits for an editor · edition 2026-10-16.2');
  const waits = claimColumns({ ...base, verdicts: new Map([[CD, "Can't tell"]]) });
  assert.equal(waits.agent_tags, '', 'a tag that waits in Your queue is not written');
  assert.equal(waits.agent_notes, 'no tags\n1 waits for an editor · edition 2026-10-16.2');
  assert.equal(waits.waits, 1);
  const two = claimColumns({ judgedNames: ['A', 'B', 'C'], verdicts: new Map([['A', "Can't tell"], ['B', "Can't tell"], ['C', 'Applies']]), edition: 'e' });
  assert.equal(two.agent_notes, 'C\n2 wait for an editor · edition e', 'two or more wait');
  assert.equal(two.agent_notes.split('\n').length, 2, 'at most two lines');
});

test('claimColumns: a Reviewed claim gets the editor\'s set, nothing waits, and a sure proposal that differs from it is named after "disagrees with your decision on"', () => {
  const base = { judgedNames: [CD, 'Wordy'], edition: 'e', reviewed: true };
  const agrees = claimColumns({ ...base, verifiedTags: [CD], verdicts: new Map([[CD, 'Applies'], ['Wordy', 'Does not apply']]) });
  assert.equal(agrees.agent_notes, `${CD}\nnothing waits for an editor · edition e`);
  assert.deepEqual(agrees.disagrees, []);
  const differs = claimColumns({ ...base, verifiedTags: [], verdicts: new Map([[CD, 'Applies'], ['Wordy', 'Does not apply']]), notChecked: '1 source tag' });
  assert.equal(differs.agent_tags, '', 'the proposal is never applied');
  assert.equal(differs.agent_notes, `no tags\nnothing waits for an editor · disagrees with your decision on ${CD} · not checked: 1 source tag · edition e`);
  assert.deepEqual(differs.disagrees, [CD]);
  const both = claimColumns({ ...base, verifiedTags: ['Wordy'], verdicts: new Map([[CD, 'Applies'], ['Wordy', 'Does not apply']]) });
  assert.equal(both.agent_tags, 'Wordy');
  assert.match(both.agent_notes, /disagrees with your decision on Context-dependent, Wordy · edition e$/);
  const unsure = claimColumns({ ...base, verifiedTags: [], verdicts: new Map([[CD, "Can't tell"]]) });
  assert.deepEqual([unsure.disagrees, unsure.waits], [[], 0], 'an agent that cannot tell does not disagree, and a Reviewed claim does not wait');
  const extra = claimColumns({ ...base, verifiedTags: ['Poor wording', CD], verdicts: new Map() });
  assert.equal(extra.agent_tags, `${CD}, Poor wording`, 'a tag the judge does not cover counts when the editor verified it');
  const kept = claimColumns({ ...base, verifiedTags: [], verdicts: new Map(), currentDisagrees: [CD] });
  assert.deepEqual(kept.disagrees, [CD], 'a tag that was not read again keeps what Agent notes said');
});

test('claimColumns: a tag without a verdict keeps its place from the cell as it was, and the tags of a cell are read apart by their commas', () => {
  const kept = claimColumns({ judgedNames: ['A', 'B'], verdicts: new Map([['A', 'Applies']]), currentTags: ['B', 'Z'], edition: 'e' });
  assert.equal(kept.agent_tags, 'A, B', 'a tag without a proposal keeps its place from the cell as it was; a tag nobody knows is dropped');
  assert.deepEqual(tagsOfCell(' A, B ,, C'), ['A', 'B', 'C']);
});

test('openClaimCount counts the claims that say a tag waits and are not Reviewed; "nothing waits for an editor" is not that', () => {
  const claim = (agent_notes, review_status = null) => ({ agent_notes, review_status });
  assert.equal(openClaimCount([
    claim('no tags\n1 waits for an editor · edition e'), claim('no tags\n2 wait for an editor · edition e', 'To review'), claim('no tags\nnothing waits for an editor · edition e'),
    claim('no tags\n1 waits for an editor · edition e', 'Reviewed'), claim(''),
  ]), 2);
});

// ---- the run ------------------------------------------------------------------------------------------------------------------------------

test('propose: every judged claim and tag gets a ledger row (the unsure ones wait in Your queue); the row holds the proposal, confidence, reason, claim link and edition', async () => {
  const w = await judged();
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const rows = w.rows('tag_decisions');
  assert.deepEqual(rows.map((x) => x.Key).sort(), Array.from({ length: 12 }, (_, i) => `${claimId(i + 1)}::${CD}`), 'one row per claim and tag the agent judged');
  const c03 = w.row('tag_decisions', 'c03::Context-dependent');
  assert.deepEqual(
    [c03.Claim, c03.Tag, c03['Agent proposal'], c03['Agent confidence'], c03['Rulebook edition'], c03['Tag outcome'], c03['Why wrong'], c03['Your reasoning'], c03['Decided under']],
    [claimText(3), 'Context-dependent', "Can't tell", 0.5, '2026-10-16.1', null, null, '', ''],
  );
  assert.equal(c03['Agent reason'], 'Two rules pull apart. · 2 of 2 runs agree');
  assert.match(c03['Claim link'], /^https:\/\/www\.notion\.so\//, 'the link is the claim row in the Claims copy');
  const c05 = w.row('tag_decisions', 'c05::Context-dependent');
  assert.deepEqual([c05['Agent proposal'], c05['Agent confidence']], ["Can't tell", 0.55]);
  assert.match(c05['Agent reason'], / · Context-dependent rule 1 · 2 of 3 runs agree$/);
  const c01 = w.row('tag_decisions', 'c01::Context-dependent');
  assert.deepEqual([c01['Agent proposal'], c01['Agent confidence']], ['Does not apply', 0.9], 'a sure answer has a ledger row too');
  assert.equal(w.row('tag_decisions', 'c10::Context-dependent')['Agent proposal'], 'Applies');
  const report = assertReport(h, r);
  assert.equal(report.demo, false);
  assert.equal(report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 3 wait for you.');
  assert.deepEqual(report.rows, [['Claims read', '12', ''], ['Carrying Context-dependent', '1 claim (earlier decisions included)', ''], ['New rows in Your queue', '3, lowest confidence first', '']]);
  assert.equal(report.next, `Next: decide your three claims in Your queue (https://www.notion.so/${w.DB.claims_copy}?v=${'e3000000000000000000000000000001'}).`, 'Your queue is a view of the Claims copy');
  assert.deepEqual([r.claimsRead, r.created, r.open], [12, 12, 3], 'the result carries the counts for callers');
});

test('propose: the Claims copy gets Agent tags, Agent notes, Agent confidence and Agent reasons, the notes in the two-line form, and only those four columns are named', async () => {
  const w = await judged();
  const r = await propose(w.hooks());
  assert.equal(r.exit, 0);
  const c10 = w.row('claims_copy', 'c10');
  assert.equal(c10['Agent tags'], 'Context-dependent');
  assert.equal(c10['Agent notes'], 'Context-dependent\nnothing waits for an editor · not checked: 4 source tags, 2 duplicate tags, 6 tags without rules · edition 2026-10-16.1');
  assert.equal(c10['Agent confidence'], 0.9);
  const c03 = w.row('claims_copy', 'c03');
  assert.equal(c03['Agent tags'], '');
  assert.equal(c03['Agent notes'], 'no tags\n1 waits for an editor · not checked: 4 source tags, 2 duplicate tags, 6 tags without rules · edition 2026-10-16.1');
  assert.equal(c03['Agent confidence'], 0.5, 'a coin flip');
  assert.equal(c03['Agent reasons'], 'Context-dependent: Two rules pull apart. · 2 of 2 runs agree', 'one line: the tag, a colon, the reason the ledger holds');
  for (let i = 1; i <= 12; i++) {
    assert.equal(w.row('claims_copy', claimId(i))['Agent reasons'], `Context-dependent: ${w.row('tag_decisions', `${claimId(i)}::Context-dependent`)['Agent reason']}`, claimId(i));
  }
  assert.match(w.row('claims_copy', 'c10')['Agent reasons'], /^Context-dependent: .+ · \d of \d runs agree$/);
  assert.equal(w.row('claims_copy', 'c05')['Agent confidence'], 0.55);
  assert.equal(w.row('claims_copy', 'c01')['Agent notes'].split('\n').length, 2);
  for (let i = 1; i <= 12; i++) {
    assert.ok(w.row('claims_copy', claimId(i))['Agent notes'].split('\n').length <= 2);
    assert.ok(w.row('claims_copy', claimId(i))['Agent confidence'] >= 0.5);
  }

  const plan = readJsonl(join(r.runDir, 'plan.jsonl')).rows.slice(1);
  const claimOps = plan.filter((op) => op.table === 'claims_copy');
  assert.equal(claimOps.length, 12, 'every claim read got its columns');
  assert.ok(claimOps.every((op) => op.op === 'update' && Object.keys(op.properties).every((k) => ['Agent tags', 'Agent notes', 'Agent confidence', 'Agent reasons'].includes(k))), 'only the four write columns, never one of the editor\'s four');
  assert.ok(claimOps.every((op) => 'Agent confidence' in op.properties && 'Agent notes' in op.properties && 'Agent reasons' in op.properties));
  for (const op of plan) assert.ok(['tag_decisions', 'claims_copy', 'agent_settings'].includes(op.table));
  const settings = w.row('agent_settings', 'Claim tagger');
  assert.equal(settings['Last run summary'], `Tag · ${stampOf(NOW)} · 12 claims`);
  assert.equal(settings['Rulebook edition'], '2026-10-16.1');
});

test('propose: a claim an editor Reviewed gets the copy of the decision in the ledger, keeps the editor\'s set in Agent tags, and the proposal the editor saw is not rewritten', async () => {
  const w = await judged({
    queue: [
      { Claim: claimText(5), Key: 'c05::Context-dependent', Tag: CD, 'Agent proposal': "Can't tell", 'Agent confidence': 0.5, 'Agent reason': 'old', 'Rulebook edition': '2026-10-01.1' },
      { Claim: claimText(8), Key: 'c08::Context-dependent', Tag: CD, 'Agent proposal': 'Applies', 'Agent confidence': 0.99, 'Agent reason': 'stale', 'Rulebook edition': '2026-10-01.1' },
    ],
  });
  reviewScenario(w);
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));

  // c05: the editor verified the tag; the agent could not tell, so Why wrong and the editor's words (the line for the tag) are copied
  const c05 = w.row('tag_decisions', 'c05::Context-dependent');
  assert.deepEqual([c05['Tag outcome'], c05['Why wrong'], c05['Your reasoning'], c05['Decided under']], ['Applies', 'Rule unclear', 'rule 3 does not say so.', '2026-10-01.1'], 'Decided under is the edition of the proposal the editor saw');
  assert.deepEqual([c05['Agent proposal'], c05['Agent confidence'], c05['Agent reason'], c05['Rulebook edition']], ["Can't tell", 0.5, 'old', '2026-10-01.1'], 'what the editor saw stays');
  // c08: the agent now applies it (0.6 is inside the band, so it cannot tell); the editor said Does not apply
  const c08 = w.row('tag_decisions', 'c08::Context-dependent');
  assert.deepEqual([c08['Tag outcome'], c08['Why wrong'], c08['Your reasoning'], c08['Decided under']], ['Does not apply', 'Rule should change', 'The phrase names a body readers know.', '2026-10-01.1']);
  assert.deepEqual([c08['Agent proposal'], c08['Agent confidence'], c08['Rulebook edition']], ['Applies', 0.99, '2026-10-01.1'], 'a row of a Reviewed claim is not brought up to date');
  // c10: no row yet; it is created with the proposal now and the decision, which differs from the agent
  const c10 = w.row('tag_decisions', 'c10::Context-dependent');
  assert.deepEqual([c10['Agent proposal'], c10['Agent confidence'], c10['Tag outcome'], c10['Why wrong'], c10['Your reasoning'], c10['Decided under']], ['Applies', 0.9, 'Does not apply', 'Agent slip', '', '2026-10-16.1']);
  // an unreviewed claim's ledger row has no decision
  assert.deepEqual([w.row('tag_decisions', 'c03::Context-dependent')['Tag outcome'], w.row('tag_decisions', 'c03::Context-dependent')['Decided under']], [null, '']);

  // Agent tags are the editor's set; a proposal that differs is never applied and is said in line 2
  assert.equal(w.row('claims_copy', 'c05')['Agent tags'], CD);
  assert.match(w.row('claims_copy', 'c05')['Agent notes'], /^Context-dependent\nnothing waits for an editor · not checked/, 'the agent could not tell: no disagreement');
  assert.equal(w.row('claims_copy', 'c08')['Agent tags'], '');
  assert.match(w.row('claims_copy', 'c08')['Agent notes'], /^no tags\nnothing waits for an editor · not checked/);
  assert.equal(w.row('claims_copy', 'c10')['Agent tags'], '', 'the agent applied the tag, the editor did not: the editor wins');
  assert.equal(w.row('claims_copy', 'c10')['Agent notes'], 'no tags\nnothing waits for an editor · disagrees with your decision on Context-dependent · not checked: 4 source tags, 2 duplicate tags, 6 tags without rules · edition 2026-10-16.1');
  assert.equal(w.row('claims_copy', 'c10')['Agent confidence'], 0.9);

  // the editor's four columns are as the editor left them
  assert.deepEqual([w.row('claims_copy', 'c05')['Review status'], w.row('claims_copy', 'c05')['Why wrong'], w.row('claims_copy', 'c05')['Challenged tags notes']], ['Reviewed', 'Rule unclear', 'Context-dependent: rule 3 does not say so.']);
  for (const req of w.writes()) {
    const claimIds = Object.values(w.ids.claim).map((id) => normId(id));
    if (req.method === 'PATCH' && claimIds.includes(normId(req.path.split('/').at(-1)))) {
      assert.ok(Object.keys(req.body.properties).every((k) => ['Agent tags', 'Agent notes', 'Agent confidence', 'Agent reasons'].includes(k)), `a write to a claim names ${Object.keys(req.body.properties)}`);
    }
  }

  // the report: the claims that wait, and the ones the agent disagrees on
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 1 waits for you.', 'c05 and c08 are Reviewed, so only c03 waits');
  assert.deepEqual(report.rows.at(-1), ['Agent disagreed', '1 claim', '']);
  assert.deepEqual([r.copied, r.disagreed, r.open], [3, 1, 1]);
});

test('propose: a second run changes nothing in the ledger or the Claims copy, also after claims were Reviewed', async () => {
  const w = await judged();
  reviewScenario(w);
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
  assert.equal(again.report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 1 waits for you.', 'the claim from before still waits');
});

test('propose: an editor who changes a decision gets the new copy, with the edition the proposal was made under kept; a row the setup carried over is not rewritten', async () => {
  const w = await judged();
  reviewScenario(w);
  await propose(w.hooks());
  assert.equal(w.row('tag_decisions', 'c05::Context-dependent')['Tag outcome'], 'Applies');
  w.review('c05', { tags: [], why: 'Agent slip', notes: 'Not after all.' }); // the editor changes their mind: the tag comes out of the relation
  const r = await propose(w.hooks());
  assert.equal(r.exit, 0);
  const c05 = w.row('tag_decisions', 'c05::Context-dependent');
  assert.deepEqual([c05['Tag outcome'], c05['Why wrong'], c05['Your reasoning'], c05['Decided under']], ['Does not apply', 'Agent slip', 'Not after all.', '2026-10-16.1']);
  assert.equal(c05['Agent proposal'], "Can't tell", 'what the editor saw stays');
  assert.equal(w.row('claims_copy', 'c05')['Agent tags'], '');
  const plan = readJsonl(join(r.runDir, 'plan.jsonl')).rows.slice(1);
  assert.deepEqual(plan.filter((op) => op.table === 'tag_decisions').map((op) => [op.op, op.key, Object.keys(op.properties).sort()]), [
    ['update', 'c05::Context-dependent', ['Tag outcome', 'Why wrong', 'Your reasoning'].sort()],
  ], 'Decided under is not written again');
});

test('propose: a tag of a Reviewed claim whose reasoning has no line of its own takes the whole note only where the outcome differs from the proposal', async () => {
  const w = await judged();
  w.review('c10', { tags: [CD], why: 'Rule unclear', notes: 'This reads on its own.' }); // the agent applies it too: nothing to explain
  w.review('c01', { tags: [CD], why: 'Rule unclear', notes: 'The reference is clear.' }); // the agent does not apply it: the note explains the difference
  const r = await propose(w.hooks());
  assert.equal(r.exit, 0);
  const c10 = w.row('tag_decisions', 'c10::Context-dependent');
  assert.deepEqual([c10['Tag outcome'], c10['Why wrong'], c10['Your reasoning']], ['Applies', null, ''], 'the agent got it right: no Why wrong and no words');
  const c01 = w.row('tag_decisions', 'c01::Context-dependent');
  assert.deepEqual([c01['Tag outcome'], c01['Why wrong'], c01['Your reasoning']], ['Applies', 'Rule unclear', 'The reference is clear.']);
  assert.match(w.row('claims_copy', 'c01')['Agent notes'], /^Context-dependent\nnothing waits for an editor · disagrees with your decision on Context-dependent/, 'the agent said Does not apply (0.9), the editor Applies');
  assert.equal(w.row('claims_copy', 'c01')['Agent tags'], CD);
});

test('propose: decided rows of the ledger whose claim is not Reviewed (the setup has not carried them over) are said in a warning and change nothing', async () => {
  const w = await judged({
    queue: [{ Claim: claimText(5), Key: 'c05::Context-dependent', Tag: CD, 'Agent proposal': "Can't tell", 'Agent confidence': 0.5, 'Tag outcome': 'Applies', 'Why wrong': 'Agent slip', 'Your reasoning': 'From the audit of 9 October: yes.' }],
  });
  const before = structuredClone(w.row('tag_decisions', 'c05::Context-dependent'));
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.deepEqual(w.row('tag_decisions', 'c05::Context-dependent'), before, 'the decided row is as it was');
  assert.match(h.io.errs.join('\n'), /1 decided row of the ledger belongs to claims that are not Reviewed.*migrate-decisions/);
  assert.match(readJson(join(r.runDir, 'run.json')).warnings.join(' '), /migrate-decisions/);
  assert.equal(w.row('claims_copy', 'c05')['Review status'], null, 'no script Reviews a claim');
});

test('propose: when more rows wait than fit one sitting the sentence says so and Next starts at the top of Your queue', async () => {
  const w = await judged({ configure: (c) => { c.queue.sitting_rows = 2; } });
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0);
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 3 wait for you, more than fit one sitting.');
  assert.match(report.next, /^Next: start at the top of Your queue \(https:\/\/www\.notion\.so\/[0-9a-f]{32}\?v=[0-9a-f]{32}\)\.$/);
  assert.ok(report.next.includes(w.DB.claims_copy), 'the link is the Claims copy\'s');
  assert.ok(!/decide your/.test(report.next));
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
  assert.match(one.report.next, /^Next: decide your claim in Your queue \(/);

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
  assert.deepEqual(plan[0].plan.counts, { creates: 12, updates: 13 });
  assert.equal(assertReport(h, r).sentence, 'Tag: the plan is ready (12 new ledger rows, 0 ledger row updates, 12 claim updates) and nothing was written to Notion.');
  assert.deepEqual(readJson(join(r.runDir, 'run.json')).plan, { creates: 12, updates: 13 });
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
  const claimPages = Object.values(w.ids.claim).map((id) => normId(id));
  for (const req of w.writes()) {
    const props = Object.keys(req.body?.properties ?? {});
    for (const forbidden of ['Claim quality tags — verified', 'Review status', 'Challenged tags notes', 'Editor wording', 'Paused']) assert.ok(!props.includes(forbidden), `${forbidden} is an editor column`);
    if (req.method === 'PATCH' && claimPages.includes(normId(req.path.split('/').at(-1)))) assert.ok(!props.includes('Why wrong'), 'Why wrong on a claim is the editor\'s');
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

// ---- Agent reasons (CLAIMS-REVIEW.md, section 1): why the agent proposed what it did, on the claim itself ------------------------------------

test('claimColumns: Agent reasons is one line per judged tag, "<Tag>: <reason>", in tag order; a tag with no reason of this run keeps its line from the cell', () => {
  const base = { judgedNames: ['Wordy', CD], edition: 'e' };
  const both = claimColumns({ ...base, verdicts: new Map([[CD, 'Applies'], ['Wordy', 'Does not apply']]), reasons: new Map([[CD, 'A pronoun. · Context-dependent rule 1 · 2 of 2 runs agree'], ['Wordy', 'Fine. · 1 of 1 runs agree']]) });
  assert.equal(both.agent_reasons, `${CD}: A pronoun. · Context-dependent rule 1 · 2 of 2 runs agree\nWordy: Fine. · 1 of 1 runs agree`);
  const kept = claimColumns({ ...base, verdicts: new Map([[CD, 'Applies']]), reasons: new Map([[CD, 'New. · 1 of 1 runs agree']]), currentReasons: new Map([[CD, 'Old.'], ['Wordy', 'Kept. · 1 of 1 runs agree'], ['Poor wording', 'Not judged.']]) });
  assert.equal(kept.agent_reasons, `${CD}: New. · 1 of 1 runs agree\nWordy: Kept. · 1 of 1 runs agree`, 'the new line replaces the old one; a tag that is not judged is dropped');
  assert.equal(claimColumns({ ...base }).agent_reasons, '', 'no reasons, no lines');
  const reviewed = claimColumns({ ...base, reviewed: true, verifiedTags: [], verdicts: new Map([[CD, 'Applies']]), reasons: new Map([[CD, 'R. · 1 of 1 runs agree']]) });
  assert.equal(reviewed.agent_reasons, `${CD}: R. · 1 of 1 runs agree`, 'a Reviewed claim shows the reason of the proposal it disagrees with');
});

test('reasonsOfCell reads the lines back: only lines that start with a known tag and a colon, the text after it', () => {
  assert.deepEqual([...reasonsOfCell(`${CD}: A reason: with a colon · 1 of 1 runs agree\nWordy: Another.\nstray line\nUnknown: x`, [CD, 'Wordy'])], [[CD, 'A reason: with a colon · 1 of 1 runs agree'], ['Wordy', 'Another.']]);
  assert.deepEqual([...reasonsOfCell('', [CD])], []);
  assert.deepEqual([...reasonsOfCell(null, [CD])], []);
  assert.deepEqual([...reasonsOfCell(`${CD}: a\r\nWordy: b`, [CD, 'Wordy'])], [[CD, 'a'], ['Wordy', 'b']], 'Windows line ends');
});

test('reasonLine builds the text of an Agent reason: the reason in at most the given words, the rule, and how many runs agree', () => {
  assert.equal(reasonLine({ reason: 'One two three.', rule_ref: 'Context-dependent rule 2' }, 2, 3), 'One two three. · Context-dependent rule 2 · 2 of 3 runs agree');
  assert.equal(reasonLine({ reason: 'One two three four.', rule_ref: null }, 1, 1, 2), 'One two... · 1 of 1 runs agree');
});

test('propose: a Reviewed claim shows the reason of the current proposal, while its ledger row keeps the one the editor saw', async () => {
  const w = await judged({
    queue: [{ Claim: claimText(10), Key: 'c10::Context-dependent', Tag: CD, 'Agent proposal': 'Does not apply', 'Agent confidence': 0.8, 'Agent reason': 'The old reason. · 1 of 1 runs agree', 'Rulebook edition': '2026-10-01.1' }],
  });
  w.review('c10', { tags: [], why: 'Agent slip', notes: '' });
  const r = await propose(w.hooks());
  assert.equal(r.exit, 0);
  assert.equal(w.row('tag_decisions', 'c10::Context-dependent')['Agent reason'], 'The old reason. · 1 of 1 runs agree', 'the ledger row is what the editor saw');
  assert.match(w.row('claims_copy', 'c10')['Agent reasons'], /^Context-dependent: Fake table: apply for Context-dependent\. · Context-dependent rule 1 · 1 of 1 runs agree$/, 'the claim shows what the agent proposes now');
});

test('propose: an unread claim keeps its Agent reasons, and a second run writes nothing for them', async () => {
  const w = await makeWorld({ claims: 4 });
  w.table(Object.fromEntries([1, 2].map((i) => [claimText(i), { decision: 'do_not_apply', p: 0.1 }])));
  w.fake.editRow(w.ids.claim.c04, { 'Agent reasons': 'Context-dependent: kept from an earlier run.' });
  await w.judge({ limit: 2 });
  const first = await propose(w.hooks());
  assert.equal(first.exit, 0);
  assert.equal(w.row('claims_copy', 'c04')['Agent reasons'], 'Context-dependent: kept from an earlier run.');
  assert.match(w.row('claims_copy', 'c01')['Agent reasons'], /^Context-dependent: .+ · 1 of 1 runs agree$/);
  const again = await propose(w.hooks());
  const plan = readJsonl(join(again.runDir, 'plan.jsonl')).rows;
  assert.deepEqual(plan[0].plan.counts, { creates: 0, updates: 1 }, 'only the settings line');
});

// ---- Review status To review: every judged tag waits (CLAIMS-REVIEW.md, section 3) ---------------------------------------------------------

test('claimColumns: on a claim marked To review every judged tag waits and none is written to Agent tags; with Review status empty only Can\'t tell waits; a Reviewed claim never waits', () => {
  const base = { judgedNames: [CD, 'Wordy'], edition: 'e', verdicts: new Map([[CD, 'Applies'], ['Wordy', 'Does not apply']]) };
  const open = claimColumns({ ...base, toReview: true });
  assert.deepEqual([open.agent_tags, open.waits], ['', 2]);
  assert.equal(open.agent_notes, 'no tags\n2 wait for an editor · edition e');
  const one = claimColumns({ judgedNames: [CD], edition: 'e', verdicts: new Map([[CD, 'Applies']]), toReview: true });
  assert.equal(one.agent_notes, 'no tags\n1 waits for an editor · edition e');
  const empty = claimColumns({ ...base });
  assert.deepEqual([empty.agent_tags, empty.waits], [CD, 0], 'Review status empty: a sure answer does not wait');
  const cant = claimColumns({ ...base, verdicts: new Map([[CD, "Can't tell"], ['Wordy', 'Does not apply']]) });
  assert.equal(cant.waits, 1, 'Review status empty: Can\'t tell waits');
  const reviewed = claimColumns({ ...base, reviewed: true, toReview: true, verifiedTags: [CD] });
  assert.deepEqual([reviewed.waits, reviewed.agent_tags], [0, CD], 'a Reviewed claim never waits, whatever else is said');
});

test('propose: a claim marked To review waits whatever the confidence; the same claim with Review status empty does not; a Reviewed claim never waits', async () => {
  const w = await judged({
    claimRows: {
      c10: { 'Review status': 'To review' }, // the agent applies the tag with 0.9
      c01: { 'Review status': 'To review' }, // the agent does not apply it, with 0.9
      c08: { 'Review status': 'Reviewed', 'Challenged tags notes': 'Looked at it.' }, // the agent could not tell, but the editor has decided
    },
  });
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const rest = 'not checked: 4 source tags, 2 duplicate tags, 6 tags without rules · edition 2026-10-16.1';

  const c10 = w.row('claims_copy', 'c10');
  assert.equal(c10['Agent tags'], '', 'a claim that waits has no tag written, even one the agent is sure of');
  assert.equal(c10['Agent notes'], `no tags\n1 waits for an editor · ${rest}`);
  assert.equal(c10['Agent confidence'], 0.9, 'confidence and reasons are written as usual');
  assert.match(c10['Agent reasons'], /^Context-dependent: .+ · \d of \d runs agree$/);
  assert.equal(w.row('tag_decisions', 'c10::Context-dependent')['Agent proposal'], 'Applies', 'the ledger holds the proposal as it was made');
  const c01 = w.row('claims_copy', 'c01');
  assert.equal(c01['Agent notes'], `no tags\n1 waits for an editor · ${rest}`);
  assert.equal(c01['Agent confidence'], 0.9);

  // the same kind of claim with Review status empty
  assert.equal(w.row('claims_copy', 'c02')['Agent notes'], `no tags\nnothing waits for an editor · ${rest}`);
  assert.equal(w.row('claims_copy', 'c02')['Review status'], null);
  // a Reviewed claim never waits, also where the agent could not tell
  assert.equal(w.row('claims_copy', 'c08')['Agent notes'], `no tags\nnothing waits for an editor · ${rest}`);
  // c03 (ask_editor) and c05 (a read that flips) wait as before
  for (const id of ['c03', 'c05']) assert.match(w.row('claims_copy', id)['Agent notes'], /^no tags\n1 waits for an editor/, id);

  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 4 wait for you.', 'c10, c01, c03 and c05');
  assert.deepEqual(report.rows.find((x) => x[0] === 'New rows in Your queue'), ['New rows in Your queue', '4, lowest confidence first', '']);
});

test('propose: a claim that QA marks To review lands in Your queue on the next run, and leaves it when it is Reviewed', async () => {
  const w = await judged();
  const first = await propose(w.hooks());
  assert.match(w.row('claims_copy', 'c02')['Agent notes'], /^no tags\nnothing waits for an editor/);
  assert.equal(first.report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 3 wait for you.');

  w.editClaim('c02', { 'Review status': 'To review' });
  const second = await propose(w.hooks());
  assert.equal(second.exit, 0);
  assert.match(w.row('claims_copy', 'c02')['Agent notes'], /^no tags\n1 waits for an editor/);
  assert.equal(second.report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 4 wait for you.');
  assert.deepEqual(second.report.rows.find((x) => x[0] === 'New rows in Your queue'), ['New rows in Your queue', '1, lowest confidence first', ''], 'only c02 is new in the queue');
  const status = await statusOf(w);
  assert.equal(status.report.sentence, 'Status: nothing is paused; 4 rows wait for you.', 'status counts the claims the way Your queue lists them');

  w.review('c02', { tags: [], why: 'Agent slip', notes: '' });
  const third = await propose(w.hooks());
  assert.match(w.row('claims_copy', 'c02')['Agent notes'], /^no tags\nnothing waits for an editor/);
  assert.equal(third.report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 3 wait for you.');

  // a second run with nothing changed writes only the settings line
  const again = await propose(w.hooks());
  assert.deepEqual(readJsonl(join(again.runDir, 'plan.jsonl')).rows[0].plan.counts, { creates: 0, updates: 1 });
});
