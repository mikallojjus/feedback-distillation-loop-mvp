import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellVerdict, claimProps, main, notCheckedParts, propose, reasonsOfCell } from '../../agents/claim-tagger-mvp/scripts/propose.mjs';
import { status } from '../../agents/claim-tagger-mvp/scripts/status.mjs';
import { claimSummary } from '../../agents/claim-tagger-mvp/scripts/lib/decisions.mjs';
import { normId } from '../../agents/claim-tagger-mvp/scripts/lib/notion-values.mjs';
import { readJson, readJsonl } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { reasonLine, stampOf } from '../../agents/claim-tagger-mvp/scripts/lib/editor-words.mjs';
import { NOW, claimId, claimText, makeWorld } from './helpers/loop-world.mjs';
import { TABLE_SPECS } from './helpers/tables.mjs';

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
const CD = 'Context-dependent';
const key = (id) => `${id}::${CD}`;
const s = (v) => String(v ?? '');
/** A ledger row as an earlier tag run left it (the claim's number, then values over the defaults). */
const seed = (i, over = {}) => ({
  Claim: claimText(i), Key: key(claimId(i)), Tag: CD, 'Agent proposal': "Can't tell", 'Agent confidence': 0.5, 'Agent reason': 'old', 'Rulebook edition': '2026-10-01.1', ...over,
});
const planOps = (r) => readJsonl(join(r.runDir, 'plan.jsonl')).rows.slice(1);
const EDITOR = ['Agent is right', 'Tag outcome', 'Your note'];

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

test('cellVerdict: the Agent reason has the form propose writes ("<k> of <n> runs agree")', () => {
  const unanimous = cellVerdict([line('apply', 0.85), line('apply', 0.85), line('apply', 0.85)], 'Context-dependent', { rerun: RERUN });
  assert.match(unanimous.reason, / · Context-dependent rule 2 · 3 of 3 runs agree$/);
});

test('cellVerdict: the reason is cut to reason_max_words words', () => {
  const long = line('apply', 0.9, { reason: Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ') });
  const v = cellVerdict([long, null, null], 'Context-dependent', { rerun: RERUN, reasonMaxWords: 10 });
  assert.ok(v.reason.startsWith('w0 w1 w2 w3 w4 w5 w6 w7 w8 w9... · Context-dependent rule 2'), v.reason);
});

// ---- the columns of a claim ---------------------------------------------------------------------------------------------------------------

test('notCheckedParts counts the tags no group judges by kind: source tags (Unsourced with them), duplicate tags, tags without rules', async () => {
  const w = await makeWorld({ claims: 1 });
  const text = notCheckedParts(w.rubric(), new Set(['Context-dependent']));
  assert.equal(text, '4 source tags, 2 duplicate tags, 6 tags without rules');
  assert.equal(notCheckedParts({ tags: [{ name: 'A', capability: 'text' }] }, new Set(['A'])), '', 'nothing left over: the part is left out');
  assert.equal(notCheckedParts({ tags: [{ name: 'A', capability: 'source' }, { name: 'B', capability: 'corpus' }] }, new Set()), '1 source tag, 1 duplicate tag');
});

test('claimProps: only the columns that differ from the pulled claim, the two relations as page ids of the Rulebook copy', () => {
  const rows = [
    { Key: key('c01'), Tag: CD, 'Agent proposal': "Can't tell", 'Agent status': 'Waits for you', 'Agent reason': 'R. · 1 of 1 runs agree', 'Agent confidence': 0.5 },
    { Key: 'c01::Wordy', Tag: 'Wordy', 'Agent proposal': 'Applies', 'Agent status': 'Done', 'Agent reason': 'Fine. · 1 of 1 runs agree', 'Agent confidence': 0.9 },
  ];
  const columns = claimSummary(rows, { judgedNames: [CD, 'Wordy'], edition: 'e1', notChecked: '1 source tag' });
  const writeColumns = { tags: 'T', waiting: 'W', status: 'S', edition: 'E', remarks: 'M', reasons: 'R', confidence: 'C' };
  const tagPages = new Map([[CD, 'page-cd'], ['Wordy', 'page-wordy']]);
  const fresh = { agent_tags: [], tags_waiting: [], agent_status: null, agent_edition: '', agent_remarks: '', agent_reasons: '' };
  assert.deepEqual(claimProps({ claim: fresh, columns, writeColumns, tagPages }), {
    R: `${CD}: R. · 1 of 1 runs agree\nWordy: Fine. · 1 of 1 runs agree`, T: ['page-wordy'], W: ['page-cd'], S: 'Waits for you', E: 'e1', M: 'not checked: 1 source tag',
  });
  const same = {
    agent_tags: ['Wordy'], tags_waiting: [CD], agent_status: 'Waits for you', agent_edition: 'e1', agent_remarks: 'not checked: 1 source tag', agent_reasons: `${CD}: R. · 1 of 1 runs agree\nWordy: Fine. · 1 of 1 runs agree`,
  };
  assert.deepEqual(claimProps({ claim: same, columns, writeColumns, tagPages }), {}, 'nothing differs: nothing is written');
  assert.deepEqual(claimProps({ claim: { ...same, tags_waiting: [] }, columns, writeColumns, tagPages }), { W: ['page-cd'] });
  assert.deepEqual(claimProps({ claim: { ...same, agent_tags: ['Wordy', CD] }, columns, writeColumns, tagPages }), { T: ['page-wordy'] });
  assert.deepEqual(claimProps({ claim: { ...same, agent_remarks: 'x' }, columns: claimSummary([], { judgedNames: [CD], edition: 'e1' }), writeColumns, tagPages }).M, '', 'an empty remark is written over an old one');
  assert.throws(() => claimProps({ claim: fresh, columns, writeColumns, tagPages: new Map([[CD, 'page-cd']]) }), /the tag "Wordy" has no row in the Rulebook/);
});

test('claimProps never names the claim\'s Agent\'s view of your decision, whatever the claim holds', () => {
  const writeColumns = {
    tags: 'Agent tags', confidence: 'Agent confidence', reasons: 'Agent reasons', status: 'Agent status', waiting: 'Tags waiting', edition: 'Agent edition', remarks: 'Agent remarks', reading: "Agent's view of your decision",
  };
  const claim = {
    agent_tags: [], tags_waiting: [], agent_status: 'Done', agent_reasons: 'old', agent_edition: 'old', agent_remarks: 'old', agent_reading: 'Context-dependent: Agent slip · x',
  };
  const columns = {
    tags: [CD], waiting: [], status: 'Waits for you', agent_reasons: 'new', agent_edition: '2026-10-16.1', agent_remarks: 'not checked: 6 tags without rules', waits: 0, disagrees: [],
  };
  const props = claimProps({ claim, columns, writeColumns, tagPages: new Map([[CD, 'page-cd']]) });
  assert.deepEqual(Object.keys(props).sort(), ['Agent edition', 'Agent reasons', 'Agent remarks', 'Agent status', 'Agent tags']);
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

// ---- the run ------------------------------------------------------------------------------------------------------------------------------

test('propose: every judged claim and tag gets a row (the unsure ones wait in Your queue) with the proposal, confidence, reason, edition, status and Open claim', async () => {
  const w = await judged();
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const rows = w.rows('tag_decisions');
  assert.deepEqual(rows.map((x) => x.Key).sort(), Array.from({ length: 12 }, (_, i) => key(claimId(i + 1))), 'one row per claim and tag the agent judged');
  const c03 = w.row('tag_decisions', key('c03'));
  assert.deepEqual(
    [c03.Claim, c03.Tag, c03['Agent proposal'], c03['Agent confidence'], c03['Rulebook edition'], c03['Agent status'], c03['Tag outcome'], c03['Agent is right'], s(c03['Your note']), s(c03['Decided under'])],
    [claimText(3), 'Context-dependent', "Can't tell", 0.5, '2026-10-16.1', 'Waits for you', null, false, '', ''],
  );
  assert.equal(c03['Agent reason'], 'Two rules pull apart. · 2 of 2 runs agree');
  assert.deepEqual((c03['Open claim'] ?? []).map(normId), [normId(w.ids.claim.c03)], 'Open claim is the row of the claim on Claims');
  const c05 = w.row('tag_decisions', key('c05'));
  assert.deepEqual([c05['Agent proposal'], c05['Agent confidence'], c05['Agent status']], ["Can't tell", 0.55, 'Waits for you']);
  assert.match(c05['Agent reason'], / · Context-dependent rule 1 · 2 of 3 runs agree$/);
  const c01 = w.row('tag_decisions', key('c01'));
  assert.deepEqual([c01['Agent proposal'], c01['Agent confidence'], c01['Agent status']], ['Does not apply', 0.9, 'Done'], 'a sure answer has a row too');
  assert.equal(w.row('tag_decisions', key('c10'))['Agent proposal'], 'Applies');
  const report = assertReport(h, r);
  assert.equal(report.demo, false);
  assert.equal(report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 3 wait for you.');
  assert.deepEqual(report.rows, [['Claims read', '12', ''], ['Carrying Context-dependent', '1 claim (earlier decisions included)', ''], ['New rows in Your queue', '3, by claim, lowest confidence first', '']]);
  assert.equal(report.next, `Next: decide your three rows in Your queue (https://www.notion.so/${w.DB.tag_decisions}?v=${'e3000000000000000000000000000001'}).`, 'Your queue is a view of Tag decisions');
  assert.deepEqual([r.claimsRead, r.created, r.open], [12, 12, 3], 'the result carries the counts for callers');
  assert.equal(readJson(join(r.runDir, 'run.json')).counts.decisions_recorded, 0);
});

const WRITE_COLUMNS = ['Agent tags', 'Agent confidence', 'Agent reasons', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks'];
const REMARK = 'not checked: 4 source tags, 2 duplicate tags, 6 tags without rules';

test('propose: the Claims copy gets the seven agent columns, the two relations as tags of the Rulebook copy, and only those seven columns are named', async () => {
  const w = await judged();
  const r = await propose(w.hooks());
  assert.equal(r.exit, 0);
  const c10 = w.claim('c10');
  assert.deepEqual([c10['Agent tags'], c10['Tags waiting'], c10['Agent status'], c10['Agent edition'], c10['Agent remarks']], [[CD], [], 'Done', '2026-10-16.1', REMARK]);
  assert.equal(c10['Agent confidence'], 0.9);
  const c03 = w.claim('c03');
  assert.deepEqual([c03['Agent tags'], c03['Tags waiting'], c03['Agent status'], c03['Agent edition'], c03['Agent remarks']], [[], [CD], 'Waits for you', '2026-10-16.1', REMARK]);
  assert.equal(c03['Agent confidence'], 0.5, 'a coin flip');
  assert.equal(c03['Agent reasons'], 'Context-dependent: Two rules pull apart. · 2 of 2 runs agree', 'one line: the tag, a colon, the reason the row holds');
  for (let i = 1; i <= 12; i++) {
    assert.equal(w.claim(claimId(i))['Agent reasons'], `Context-dependent: ${w.row('tag_decisions', key(claimId(i)))['Agent reason']}`, claimId(i));
    assert.equal(w.claim(claimId(i))['Agent edition'], '2026-10-16.1');
    assert.ok(w.claim(claimId(i))['Agent confidence'] >= 0.5);
  }
  assert.equal(w.claim('c05')['Agent confidence'], 0.55);
  assert.deepEqual([w.claim('c05')['Agent status'], w.claim('c05')['Tags waiting']], ['Waits for you', [CD]], 'a read that flips waits');
  assert.deepEqual(['c01', 'c02', 'c04', 'c06', 'c07', 'c09', 'c11', 'c12'].map((id) => w.claim(id)['Agent status']), Array(8).fill('Done'));

  const plan = planOps(r);
  const claimOps = plan.filter((op) => op.table === 'claims');
  assert.equal(claimOps.length, 12, 'every claim read got its columns');
  assert.ok(claimOps.every((op) => op.op === 'update' && Object.keys(op.properties).every((k) => WRITE_COLUMNS.includes(k))), 'only the seven write columns');
  assert.ok(claimOps.every((op) => ['Agent confidence', 'Agent reasons', 'Agent status', 'Agent edition', 'Agent remarks'].every((k) => k in op.properties)), 'a first run writes the five plain columns of every claim');
  assert.ok(claimOps.every((op) => ['Agent tags', 'Tags waiting'].every((k) => !(k in op.properties) || Array.isArray(op.properties[k]))), 'the relations go as lists of page ids');
  assert.deepEqual(claimOps.find((op) => op.key === 'c10').properties['Agent tags'], [w.ids.tag[CD]]);
  assert.deepEqual(claimOps.find((op) => op.key === 'c03').properties['Tags waiting'], [w.ids.tag[CD]]);
  assert.equal('Agent tags' in claimOps.find((op) => op.key === 'c03').properties, false, 'an empty relation that is empty already is not written');
  for (const op of plan) assert.ok(['tag_decisions', 'claims', 'agent_settings'].includes(op.table));
  const settings = w.row('agent_settings', 'Claim tagger');
  assert.equal(settings['Last run summary'], `Tag · ${stampOf(NOW)} · 12 claims`);
  assert.equal(settings['Rulebook edition'], '2026-10-16.1');
});

test('propose: a table that still has the text column Agent tags is not written; the report says to run the setup build', async () => {
  const w = await makeWorld({ claims: 3, tableSpecs: { claims: { ...TABLE_SPECS.claims, 'Agent tags': 'rich_text' } } });
  w.table(Object.fromEntries([1, 2, 3].map((i) => [claimText(i), { decision: 'do_not_apply', p: 0.1 }])));
  assert.equal((await w.judge()).exit, 0);
  const before = w.writes().length;
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 2);
  assert.equal(r.report.sentence, 'Tag: nothing was done, because the tables do not have the v2 columns yet.');
  assert.equal(r.report.next, 'Next: ask the engineer to run the setup build, then type the same command again.');
  assert.match(h.io.errs.join('\n'), /Agent tags \(rich_text, not relation\)/);
  assert.equal(w.writes().length, before);
});

test('propose: a Tag outcome is recorded in Decided under, the status of the row says whether the agent disagrees, and the editor\'s columns are as the editor left them', async () => {
  const w = await judged({
    queue: [
      seed(5, { 'Tag outcome': 'Applies', 'Your note': 'Rule 3 does not say so.' }),
      seed(8, { 'Agent proposal': 'Applies', 'Agent confidence': 0.99, 'Agent reason': 'stale', 'Tag outcome': 'Does not apply' }),
    ],
  });
  await propose(w.hooks()); // first run: the rows exist, the decisions are recorded
  w.decideRow(key('c10'), { outcome: 'Does not apply', note: 'The phrase names a body readers know.' });
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));

  const c05 = w.row('tag_decisions', key('c05'));
  assert.deepEqual([c05['Tag outcome'], c05['Your note'], c05['Decided under'], c05['Agent status']], ['Applies', 'Rule 3 does not say so.', '2026-10-01.1', 'Done'], 'Decided under is the edition the row held when the decision was first seen');
  assert.deepEqual([c05['Agent proposal'], c05['Rulebook edition']], ["Can't tell", '2026-10-16.1'], 'the proposal moves with the rulebook; the decision does not');
  const c08 = w.row('tag_decisions', key('c08'));
  assert.deepEqual([c08['Tag outcome'], c08['Decided under'], c08['Agent proposal'], c08['Agent confidence']], ['Does not apply', '2026-10-01.1', "Can't tell", 0.6]);
  assert.equal(c08['Agent status'], 'Done', 'the agent cannot tell now, so it does not disagree');
  const c10 = w.row('tag_decisions', key('c10'));
  assert.deepEqual([c10['Tag outcome'], c10['Decided under'], c10['Agent proposal'], c10['Agent status']], ['Does not apply', '2026-10-16.1', 'Applies', 'Disagrees with your decision'], 'the agent applies the tag, the editor did not');
  assert.equal(w.row('tag_decisions', key('c03'))['Decided under'], '', 'an undecided row records nothing');

  // the claim: the decided Applies row is in Agent tags, the disagreement is its status
  assert.deepEqual([w.claim('c05')['Agent tags'], w.claim('c05')['Tags waiting'], w.claim('c05')['Agent status']], [[CD], [], 'Done'], 'a decided row does not wait');
  assert.deepEqual([w.claim('c08')['Agent tags'], w.claim('c08')['Tags waiting'], w.claim('c08')['Agent status']], [[], [], 'Done']);
  assert.deepEqual([w.claim('c10')['Agent tags'], w.claim('c10')['Tags waiting'], w.claim('c10')['Agent status']], [[], [], 'Disagrees with your decision'], 'the editor wins');
  assert.equal(w.claim('c10')['Agent remarks'], REMARK);

  // no write names an editor column
  for (const op of planOps(r)) assert.ok(!Object.keys(op.properties).some((k) => EDITOR.includes(k)), `${op.table} ${op.key} names an editor column`);

  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 1 waits for you.', 'c03 waits; c05, c08 and c10 are decided');
  assert.deepEqual(report.rows.at(-1), ['Agent disagreed', '1 row', '']);
  assert.deepEqual([r.disagreed, r.open, r.recorded], [1, 1, 1], 'recorded: the c10 decision of this run (the other two were recorded by the first run)');
});

test('propose: a decided row keeps the edition it was decided under while its proposal moves on, and the move is written under the new edition', async () => {
  const w = await judged({ queue: [seed(10, { 'Agent proposal': 'Does not apply', 'Agent confidence': 0.8, 'Tag outcome': 'Does not apply', 'Decided under': '2026-09-01.1' })] });
  const r = await propose(w.hooks());
  assert.equal(r.exit, 0);
  const row = w.row('tag_decisions', key('c10'));
  assert.deepEqual([row['Agent proposal'], row['Agent confidence'], row['Rulebook edition'], row['Decided under'], row['Agent status']], ['Applies', 0.9, '2026-10-16.1', '2026-09-01.1', 'Disagrees with your decision']);
  const op = planOps(r).find((o) => o.table === 'tag_decisions' && o.key === key('c10'));
  assert.deepEqual(Object.keys(op.properties).sort(), ['Agent confidence', 'Agent proposal', 'Agent reason', 'Agent status', 'Open claim', 'Rulebook edition'], 'Decided under is not written again');
});

test('propose: a tick on a sure proposal is recorded as "<edition> · agreed <Outcome>", and the decision stays when the proposal moves', async () => {
  // c10: the row showed Does not apply under the old edition; the editor ticked Agent is right; the agent now applies the tag
  const w = await judged({ queue: [seed(10, { 'Agent proposal': 'Does not apply', 'Agent confidence': 0.8, 'Agent is right': true, 'Agent status': 'Done' })] });
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const row = w.row('tag_decisions', key('c10'));
  assert.equal(row['Decided under'], '2026-10-01.1 · agreed Does not apply');
  assert.deepEqual([row['Agent proposal'], row['Agent status'], row['Agent is right'], row['Tag outcome']], ['Applies', 'Disagrees with your decision', true, null], 'the proposal moved; the tick and the outcome column are the editor\'s');
  assert.deepEqual([w.claim('c10')['Agent tags'], w.claim('c10')['Agent status']], [[], 'Disagrees with your decision'], 'the claim counts the agreed outcome, not the new proposal');
  assert.equal(r.recorded, 1);
  // nothing changes on the next run
  const again = await propose(w.hooks());
  assert.deepEqual(readJsonl(join(again.runDir, 'plan.jsonl')).rows[0].plan.counts, { creates: 0, updates: 1 });
  assert.equal(w.row('tag_decisions', key('c10'))['Decided under'], '2026-10-01.1 · agreed Does not apply');
});

test('propose: a tick on a row the agent has not recorded yet takes the proposal it showed, with that row\'s edition, and is read from a row the run has just created', async () => {
  const w = await judged();
  await propose(w.hooks());
  w.decideRow(key('c01'), { right: true }); // Does not apply, 0.9
  w.decideRow(key('c10'), { right: true }); // Applies
  const r = await propose(w.hooks());
  assert.equal(r.exit, 0);
  assert.equal(w.row('tag_decisions', key('c01'))['Decided under'], '2026-10-16.1 · agreed Does not apply');
  assert.equal(w.row('tag_decisions', key('c10'))['Decided under'], '2026-10-16.1 · agreed Applies');
  assert.deepEqual([w.claim('c10')['Agent tags'], w.claim('c10')['Agent status']], [[CD], 'Done']);
  assert.equal(w.row('tag_decisions', key('c01'))['Tag outcome'], null, 'the agent never writes Tag outcome');
});

test('propose: a tick on a Can\'t tell row decides nothing: the row still waits, stays in Your queue and records nothing', async () => {
  const w = await judged();
  await propose(w.hooks());
  w.decideRow(key('c03'), { right: true });
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const row = w.row('tag_decisions', key('c03'));
  assert.deepEqual([row['Agent status'], s(row['Decided under']), row['Agent is right']], ['Waits for you', '', true]);
  assert.deepEqual([w.claim('c03')['Agent status'], w.claim('c03')['Tags waiting']], ['Waits for you', [CD]]);
  assert.equal(r.report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 3 wait for you.', 'a ticked Can\'t tell row is still counted');
});

test('propose: removing a tick clears the record, and a Tag outcome after a tick drops the "agreed" suffix and keeps the edition', async () => {
  const w = await judged();
  await propose(w.hooks());
  w.decideRow(key('c01'), { right: true });
  w.decideRow(key('c10'), { right: true });
  await propose(w.hooks());
  assert.equal(w.row('tag_decisions', key('c01'))['Decided under'], '2026-10-16.1 · agreed Does not apply');
  w.decideRow(key('c01'), { right: false });
  w.decideRow(key('c10'), { outcome: 'Does not apply' }); // the tick stays; the outcome wins
  const r = await propose(w.hooks());
  assert.equal(r.exit, 0);
  assert.equal(s(w.row('tag_decisions', key('c01'))['Decided under']), '', 'no longer decided: the record is cleared');
  assert.equal(w.row('tag_decisions', key('c10'))['Decided under'], '2026-10-16.1', 'the outcome replaces the agreement; the edition stays');
  assert.equal(w.row('tag_decisions', key('c10'))['Agent status'], 'Disagrees with your decision', 'Tag outcome wins over the tick');
});

test('propose: a decided claim leaves Your queue at the next run, and a second run changes nothing in the rows or the Claims copy', async () => {
  const w = await judged();
  const first = await propose(w.hooks());
  assert.equal(first.report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 3 wait for you.');
  w.decideRow(key('c03'), { outcome: 'Applies' });
  assert.equal(w.row('tag_decisions', key('c03'))['Agent status'], 'Waits for you', 'nothing has run since the editor decided: the row is still in the view');
  const second = await propose(w.hooks());
  assert.equal(second.report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 2 wait for you.');
  assert.deepEqual([w.row('tag_decisions', key('c03'))['Agent status'], w.claim('c03')['Agent status'], w.claim('c03')['Tags waiting'], w.claim('c03')['Agent tags']], ['Done', 'Done', [], [CD]]);
  const rowsBefore = structuredClone(w.rows('tag_decisions'));
  const claimsBefore = structuredClone(w.rows('claims'));
  const h = w.hooks();
  const again = await propose(h);
  assert.equal(again.exit, 0, h.io.errs.join('\n'));
  assert.deepEqual(w.rows('tag_decisions'), rowsBefore);
  assert.deepEqual(w.rows('claims'), claimsBefore);
  const plan = readJsonl(join(again.runDir, 'plan.jsonl')).rows;
  assert.deepEqual(plan[0].plan.counts, { creates: 0, updates: 1 }, 'only the Agent settings summary is sent again');
  assert.equal(plan[1].table, 'agent_settings');
  assert.equal(again.report.rows[2][1], 'none', 'no new rows');
  assert.equal(again.report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 2 wait for you.');
});

test('propose: status counts the rows of Your queue the way the view lists them', async () => {
  const w = await judged();
  await propose(w.hooks());
  w.decideRow(key('c03'), { outcome: 'Applies' });
  const st = await statusOf(w);
  assert.equal(st.report.sentence, 'Status: nothing is paused; 2 rows wait for you.', 'the decided row is not counted');
});

test('propose: Open claim is written on a row that lacks it or points elsewhere, and a row of a claim the judge did not read gets its record and nothing else', async () => {
  const w = await makeWorld({
    claims: 6,
    queue: [
      seed(1, { 'Agent proposal': 'Does not apply', 'Agent confidence': 0.9, 'Agent reason': 'old', 'Open claim': [] }),
      seed(2, { 'Agent proposal': 'Does not apply', 'Agent confidence': 0.9, 'Agent is right': true }), // claim 2 is read; claim 5 is not
      seed(5, { 'Agent proposal': 'Applies', 'Agent confidence': 0.9, 'Agent is right': true, 'Agent status': 'Done', 'Agent reason': 'kept' }),
      { ...seed(7), Key: 'c07::Context-dependent', Claim: 'A claim that is not on Claims' },
    ],
  });
  w.table(Object.fromEntries([1, 2, 3].map((i) => [claimText(i), { decision: 'do_not_apply', p: 0.1 }])));
  await w.judge({ limit: 3 });
  const r = await propose(w.hooks());
  assert.equal(r.exit, 0);
  assert.deepEqual((w.row('tag_decisions', key('c01'))['Open claim'] ?? []).map(normId), [normId(w.ids.claim.c01)]);
  assert.deepEqual((w.row('tag_decisions', key('c02'))['Open claim'] ?? []).map(normId), [normId(w.ids.claim.c02)]);
  const unread = w.row('tag_decisions', key('c05'));
  assert.deepEqual([unread['Decided under'], unread['Agent proposal'], unread['Agent reason'], unread['Rulebook edition'], unread['Agent status']], ['2026-10-01.1 · agreed Applies', 'Applies', 'kept', '2026-10-01.1', 'Done'], 'only Decided under changed');
  const op = planOps(r).find((o) => o.table === 'tag_decisions' && o.key === key('c05'));
  assert.deepEqual(Object.keys(op.properties), ['Decided under']);
  assert.equal(w.row('tag_decisions', 'c07::Context-dependent')['Decided under'] ?? '', '', 'a row without a claim is left alone');
  assert.deepEqual([w.claim('c05')['Agent status'], w.claim('c05')['Agent edition']], [null, ''], 'an unread claim keeps its columns');
  assert.deepEqual(r.report.rows.at(-1), ['Not read yet', '3', '']);
});

test('propose: when more rows wait than fit one sitting the sentence says so and Next starts at the top of Your queue', async () => {
  const w = await judged({ configure: (c) => { c.queue.sitting_rows = 2; } });
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0);
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Tag: the agent read 12 claims for Context-dependent; 3 wait for you, more than fit one sitting.');
  assert.match(report.next, /^Next: start at the top of Your queue \(https:\/\/www\.notion\.so\/[0-9a-f]{32}\?v=[0-9a-f]{32}\)\.$/);
  assert.ok(report.next.includes(w.DB.tag_decisions), 'the link is Tag decisions\'');
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
  assert.match(one.report.next, /^Next: decide your row in Your queue \(/);

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
  assert.deepEqual([w.claim('c05')['Agent status'], w.claim('c05')['Agent edition']], [null, ''], 'an unread claim keeps its columns');
  assert.equal(w.claim('c01')['Agent status'], 'Done');
});

test('propose: without any judgment it stops with exit 2 and says the agent has not read a claim yet', async () => {
  const w = await makeWorld({ claims: 3 });
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 2);
  assert.equal(assertReport(h, r).sentence, 'Tag: nothing was proposed, because the agent has not read any claim yet.');
  assert.equal(w.writes().length, 0);
});

test('propose: the run folder holds run.json written first and last, the plan, the ledger and the request log, and no request names a protected id or an editor column', async () => {
  const w = await judged({ queue: [seed(10, { 'Agent is right': true, 'Your note': 'Mine.' }), seed(5, { 'Tag outcome': 'Applies' })] });
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
    for (const forbidden of [...EDITOR, 'Editor wording', 'Paused', 'After the rule change', "Agent's view of your decision", 'Rule', 'Why the agent thinks so', 'Read under']) assert.ok(!props.includes(forbidden), `${forbidden} is not the tag step's`);
  }
  // the editor's columns are as the editor left them
  assert.deepEqual([w.row('tag_decisions', key('c10'))['Agent is right'], w.row('tag_decisions', key('c10'))['Your note'], w.row('tag_decisions', key('c05'))['Tag outcome']], [true, 'Mine.', 'Applies']);
});

test('propose never writes or clears a reading: not the row\'s view, rule, why and read under, nor After the rule change, nor the claim\'s Agent\'s view of your decision', async () => {
  const held = {
    "Agent's view of your decision": 'Rule unclear', Rule: `${CD} rule 3`, 'Why the agent thinks so': 'The rule leaves this kind of case open.', 'Read under': '2026-10-16.1 · 0a1b2c3d', 'After the rule change': 'Still wrong',
  };
  const text = `${CD}: Rule unclear, rule 3 · The rule leaves this kind of case open.`;
  const w = await judged({ queue: [seed(10, { 'Agent proposal': 'Applies', 'Agent confidence': 0.9, 'Tag outcome': 'Does not apply', ...held })] });
  w.editClaim('c10', { "Agent's view of your decision": text, 'Agent status': 'Waits for you' });
  const r = await propose(w.hooks());
  assert.equal(r.exit, 0);
  const plan = planOps(r);
  assert.ok(plan.some((o) => o.op === 'create' && o.table === 'tag_decisions') && plan.some((o) => o.op === 'update' && o.table === 'tag_decisions') && plan.some((o) => o.table === 'claims'), 'a create, an update of a row and a claim update are in the plan');
  for (const op of plan) {
    for (const column of [...Object.keys(held), "Agent's view of your decision"]) assert.ok(!Object.keys(op.properties).includes(column), `${op.table} ${op.key}: the plan does not name ${column}`);
  }
  const row = w.row('tag_decisions', key('c10'));
  assert.deepEqual(Object.keys(held).map((c) => row[c]), Object.values(held), 'the reading of the row stays');
  assert.equal(row['Decided under'], '2026-10-01.1', 'the decision was recorded all the same');
  assert.equal(w.row('claims', 'c10')["Agent's view of your decision"], text, 'and so does the claim\'s reading');
  assert.equal(w.row('claims', 'c10')['Agent status'], 'Disagrees with your decision', 'the agent\'s other columns of the claim were written');
  const created = w.row('tag_decisions', key('c01'));
  assert.deepEqual([created["Agent's view of your decision"], s(created.Rule), s(created['Read under'])], [null, '', ''], 'a row propose creates is unread');
  const before = structuredClone(w.rows('tag_decisions'));
  const again = await propose(w.hooks());
  assert.equal(again.exit, 0);
  assert.deepEqual(w.rows('tag_decisions'), before);
});

test('propose: a row the judge could not read is Could not read and waits for nobody; its claim says so', async () => {
  const w = await makeWorld({ claims: 3 });
  w.table(Object.fromEntries([1, 2, 3].map((i) => [claimText(i), { decision: 'do_not_apply', p: 0.1 }])));
  await w.judge();
  // the store holds a failed read for claims 1 and 2 only
  const store = readdirSync(join(w.root, 'runs', 'judgments')).filter((d) => existsSync(join(w.root, 'runs', 'judgments', d, 'run-1.jsonl')));
  assert.equal(store.length, 1);
  const file = join(w.root, 'runs', 'judgments', store[0], 'run-1.jsonl');
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const failed = lines.map((l) => (['c01', 'c02'].includes(l.id) ? { ...l, status: 'error', tags: [], error: 'bad reply' } : l));
  writeFileSync(file, `${failed.map((l) => JSON.stringify(l)).join('\n')}\n`);
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.deepEqual([w.row('tag_decisions', key('c01'))['Agent status'], w.row('tag_decisions', key('c01'))['Agent proposal']], ['Could not read', "Can't tell"]);
  assert.deepEqual([w.claim('c01')['Agent status'], w.claim('c01')['Tags waiting'], w.claim('c01')['Agent tags']], ['Could not read', [], []]);
  assert.match(w.claim('c01')['Agent reasons'], /^Context-dependent: The agent could not read this claim · 0 of 1 runs agree$/);
  assert.deepEqual([w.claim('c03')['Agent status'], w.claim('c03')['Tags waiting']], ['Done', []]);
  assert.equal(r.report.sentence, 'Tag: the agent read 3 claims for Context-dependent; nothing waits for you.');
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

test('propose: an unread claim keeps its Agent reasons, and a second run writes nothing for them', async () => {
  const w = await makeWorld({ claims: 4 });
  w.table(Object.fromEntries([1, 2].map((i) => [claimText(i), { decision: 'do_not_apply', p: 0.1 }])));
  w.fake.editRow(w.ids.claim.c04, { 'Agent reasons': 'Context-dependent: kept from an earlier run.' });
  await w.judge({ limit: 2 });
  const first = await propose(w.hooks());
  assert.equal(first.exit, 0);
  assert.equal(w.row('claims', 'c04')['Agent reasons'], 'Context-dependent: kept from an earlier run.');
  assert.match(w.row('claims', 'c01')['Agent reasons'], /^Context-dependent: .+ · 1 of 1 runs agree$/);
  const again = await propose(w.hooks());
  const plan = readJsonl(join(again.runDir, 'plan.jsonl')).rows;
  assert.deepEqual(plan[0].plan.counts, { creates: 0, updates: 1 }, 'only the settings line');
});
