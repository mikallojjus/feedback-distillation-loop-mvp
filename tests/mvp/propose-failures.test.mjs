import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { propose } from '../../agents/claim-tagger-mvp/scripts/propose.mjs';
import { readJson, readJsonl } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { claimText, makeWorld } from './helpers/loop-world.mjs';

// What the loop scripts do when Notion, the token, a table or the data is not as they need it. Propose stands for the harness they all share.

const sure = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [claimText(i + 1), { decision: 'do_not_apply', p: 0.1 }]));
const unsureTable = (n, unsure) => {
  const table = sure(n);
  for (const i of unsure) table[claimText(i)] = { decision: 'ask_editor', p: 0.5, rule_ref: null, reason: 'Two readings.' };
  return table;
};
async function judged(n = 6, unsure = [2, 4, 5], opts = {}) {
  const w = await makeWorld({ claims: n, ...opts });
  w.table(unsureTable(n, unsure));
  assert.equal((await w.judge()).exit, 0);
  return w;
}
const clean = (h, r) => {
  assert.deepEqual(lintReport(r.markdown), [], r.markdown);
  assert.equal(h.io.outs.join('\n').trimEnd(), r.markdown.trimEnd());
};

test('without a Notion token the run stops with exit 2 and says so; nothing is read from .env of the repository by a test', async () => {
  const w = await judged();
  const before = w.requests().length;
  const h = w.hooks({ fetchImpl: undefined, token: undefined, repoRoot: w.root });
  const r = await propose(h);
  assert.equal(r.exit, 2);
  clean(h, r);
  assert.equal(r.report.sentence, 'Tag: nothing was done, because there is no Notion token for the scripts.');
  assert.equal(r.report.next, 'Next: ask the engineer to check the Notion token and that the integration is connected to the page.');
  assert.equal(w.requests().length, before, 'no request was made');
});

test('a token Notion refuses is exit 2; a Notion that cannot be reached is exit 1 and the same command is the Next line', async () => {
  const w = await judged();
  const refused = await propose(w.hooks({ token: 'ntn_not_the_token' }));
  assert.equal(refused.exit, 2);
  assert.equal(refused.report.sentence, 'Tag: nothing was done, because Notion refused the request.');

  const down = await judged();
  down.fake.failNext('POST', /\/query$/, 500, 20);
  const h = down.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 1);
  clean(h, r);
  assert.equal(r.report.sentence, 'Tag: nothing was done, because Notion could not be read.');
  assert.equal(r.report.next, 'Next: type /claim-tagger tag again in a while.');
  assert.equal(down.writes().length, 0);
});

test('a table that setup has not made yet, or that holds two rows with one key, stops the run with exit 2 and says which table', async () => {
  const noTable = await judged(6, [2], { configure: (c) => { c.notion.databases.rule_changes.database_id = '<setup>'; c.notion.databases.rule_changes.data_source_id = '<setup>'; } });
  const r = await propose(noTable.hooks());
  assert.equal(r.exit, 0, 'propose does not need Rule changes');
  const { distill } = await import('../../agents/claim-tagger-mvp/scripts/distill.mjs');
  const d = await distill(noTable.hooks());
  assert.equal(d.exit, 2);
  assert.equal(d.report.sentence, 'Distill: nothing was done, because the Rule changes table is not set up yet.');
  assert.equal(d.report.next, 'Next: ask the engineer to finish the setup.');

  const twice = await judged(6, [2]);
  const row = { Claim: claimText(1), Key: 'c01::Context-dependent', Tag: 'Context-dependent' };
  twice.fake.addRow(twice.DB.tag_decisions, row);
  twice.fake.addRow(twice.DB.tag_decisions, row);
  const h = twice.hooks();
  const t = await propose(h);
  assert.equal(t.exit, 2);
  clean(h, t);
  assert.equal(t.report.sentence, 'Tag: nothing was done, because the Tag decisions table has two rows with the same key.');
  assert.equal(twice.writes().length, 0);
});

test('a write that fails stops the run with exit 1 and the same command finishes the job without a second row', async () => {
  const w = await judged();
  w.fake.failNext('PATCH', /^\/pages\//, 400, 1);
  const h = w.hooks();
  const first = await propose(h);
  assert.equal(first.exit, 1);
  clean(h, first);
  assert.equal(first.report.sentence, 'Tag stopped before every change was written to Notion.');
  assert.equal(first.report.next, 'Next: type /claim-tagger tag again; it continues where it stopped.');
  const ledger = readJsonl(join(first.runDir, 'ledger.jsonl')).rows;
  assert.ok(ledger.some((l) => l.status === 'failed'));

  const again = await propose(w.hooks());
  assert.equal(again.exit, 0);
  assert.deepEqual(w.rows('tag_decisions').map((r) => r.Key).sort(), [1, 2, 3, 4, 5, 6].map((i) => `c0${i}::Context-dependent`));
  for (let i = 1; i <= 6; i++) assert.notEqual(w.row('claims_copy', `c0${i}`)['Agent notes'], '', `claim ${i} has its notes now`);
});

test('a create whose answer was lost is never sent twice: the next run finds the row and writes nothing again for it', async () => {
  const w = await judged();
  w.fake.failNext('POST', /^\/pages$/, 500, 1, { applied: true });
  const first = await propose(w.hooks());
  assert.equal(first.exit, 1);
  const created = w.rows('tag_decisions').length;
  assert.ok(created >= 1, 'the create that was lost did land');
  const again = await propose(w.hooks());
  assert.equal(again.exit, 0);
  assert.deepEqual(w.rows('tag_decisions').map((r) => r.Key).sort(), [1, 2, 3, 4, 5, 6].map((i) => `c0${i}::Context-dependent`), 'one row per key');
  const posts = w.requests().filter((r) => r.method === 'POST' && r.path === '/pages' && r.status === 200);
  assert.equal(posts.length + 1 >= 3, true);
});

test('a run folder written by a stopped run keeps its plan and ledger, and run.json says how it ended and what to type', async () => {
  const w = await judged();
  w.fake.failNext('PATCH', /^\/pages\//, 400, 1);
  const r = await propose(w.hooks());
  assert.equal(r.exit, 1);
  const run = readJson(join(r.runDir, 'run.json'));
  assert.deepEqual([run.status, run.exit_code], ['stopped', 1]);
  assert.match(run.message, /write\(s\) did not finish/);
  assert.equal(run.resume, 'node agents/claim-tagger-mvp/scripts/propose.mjs --driver fake');
  assert.ok(run.apply.failed >= 1);
  assert.ok(readFileSync(join(r.runDir, 'plan.jsonl'), 'utf8').split('\n').length > 3);
});

test('two judged tags in two groups: each has its own cells, its own row for an unsure claim, and both are listed in Agent tags and in the counts', async () => {
  const { default: taxonomy } = await import('../../agents/claim-tagger-mvp/setup/taxonomy-issue.json', { with: { type: 'json' } });
  const rows = taxonomy.rows.map((r) => (r.Name === 'Wordy' ? { ...r, 'When to use': '1. A sentence that says the same thing twice is Wordy.\n2. A sentence with filler words that add nothing is Wordy.' } : r));
  const w = await makeWorld({ claims: 4, rulebook: rows, configure: (c) => { c.judge.groups.G2 = ['Wordy']; } });
  const table = { ...sure(4), [claimText(1)]: { decision: 'apply', p: 0.9 }, [claimText(3)]: { decision: 'ask_editor', p: 0.5, rule_ref: null } };
  w.table(table);
  assert.equal((await w.judge()).exit, 0);
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.deepEqual(w.rows('tag_decisions').map((x) => x.Key).sort(), [1, 2, 3, 4].flatMap((i) => [`c0${i}::Context-dependent`, `c0${i}::Wordy`]), 'a ledger row for every claim and every judged tag');
  assert.deepEqual(w.rows('claims_copy').map((c) => [c['Geo ID'], c['Agent confidence']]).sort(), [['c01', 0.9], ['c02', 0.9], ['c03', 0.5], ['c04', 0.9]], 'the lowest confidence among the judged tags');
  assert.equal(w.row('claims_copy', 'c01')['Agent tags'], 'Context-dependent, Wordy');
  assert.equal(w.row('claims_copy', 'c01')['Agent notes'], 'Context-dependent, Wordy\nnothing waits for an editor · not checked: 4 source tags, 2 duplicate tags, 5 tags without rules · edition 2026-10-16.1');
  assert.equal(w.row('claims_copy', 'c03')['Agent notes'].split('\n')[1].startsWith('2 wait for an editor'), true);
  assert.equal(r.report.sentence, 'Tag: the agent read 4 claims for Context-dependent and Wordy; 1 waits for you.', 'Your queue lists claims: c03 waits once, for two tags');
  assert.deepEqual(r.report.rows.slice(0, 3).map((x) => x[0]), ['Claims read', 'Carrying Context-dependent', 'Carrying Wordy']);
  clean(h, r);
});

test('two judged tags: Agent reasons has one line per tag, in tag order, each the reason its ledger row holds', async () => {
  const { default: taxonomy } = await import('../../agents/claim-tagger-mvp/setup/taxonomy-issue.json', { with: { type: 'json' } });
  const rows = taxonomy.rows.map((r) => (r.Name === 'Wordy' ? { ...r, 'When to use': '1. A sentence that says the same thing twice is Wordy.\n2. A sentence with filler words that add nothing is Wordy.' } : r));
  const w = await makeWorld({ claims: 2, rulebook: rows, configure: (c) => { c.judge.groups.G2 = ['Wordy']; } });
  w.table({ ...sure(2), [claimText(1)]: { decision: 'apply', p: 0.9 } });
  assert.equal((await w.judge()).exit, 0);
  const h = w.hooks();
  const r = await propose(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  const cd = w.row('tag_decisions', 'c01::Context-dependent')['Agent reason'];
  const wordy = w.row('tag_decisions', 'c01::Wordy')['Agent reason'];
  assert.equal(w.row('claims_copy', 'c01')['Agent reasons'], `Context-dependent: ${cd}\nWordy: ${wordy}`);
  assert.equal(w.row('claims_copy', 'c02')['Agent reasons'].split('\n').length, 2);
  clean(h, r);
});
