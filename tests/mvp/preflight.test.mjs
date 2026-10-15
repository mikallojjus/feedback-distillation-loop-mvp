import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { preflight, refusedReport } from '../../agents/claim-tagger-mvp/scripts/lib/preflight.mjs';
import { lintReport, renderReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { readJson } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { NOW, makeWorld } from './helpers/loop-world.mjs';

const check = async (w, extra = {}) => {
  const p = await w.pull();
  return preflight({ root: w.root, config: w.config, pullId: p.pullId, now: () => NOW, ...extra });
};
const markdown = (r) => renderReport(r);

test('preflight: a clean world passes with the edition in force and no warning', async () => {
  const w = await makeWorld({ claims: 2 });
  const pre = await check(w);
  assert.deepEqual([pre.ok, pre.code, pre.kind, pre.reason, pre.edition], [true, 0, null, null, '2026-10-16.1']);
  assert.deepEqual(pre.warnings, []);
  assert.deepEqual(pre.adopted, []);
});

test('preflight: the PAUSED file means exit 3, and a person has to remove it', async () => {
  const w = await makeWorld({ claims: 2 });
  w.write('runs/PAUSED', 'paused by hand\n');
  const pre = await check(w);
  assert.deepEqual([pre.ok, pre.code, pre.kind], [false, 3, 'paused_file']);
  assert.match(pre.reason, /PAUSED file/);
  const report = refusedReport(w.config, pre, 'Tag');
  assert.equal(report.sentence, 'Tag: nothing was done, because the agent is paused.');
  assert.equal(report.next, 'Next: ask the engineer to remove the pause file.');
  assert.deepEqual(lintReport(markdown(report)), []);
});

test('preflight: Paused ticked in Agent settings means exit 3 and the reason names the Paused box in Agent settings', async () => {
  const w = await makeWorld({ claims: 2 });
  w.setPaused(true);
  const pre = await check(w);
  assert.deepEqual([pre.ok, pre.code, pre.kind], [false, 3, 'paused_notion']);
  assert.match(pre.reason, /Paused is ticked in Agent settings/);
  const report = refusedReport(w.config, pre, 'Distill');
  assert.equal(report.sentence, 'Distill: nothing was done, because the agent is paused.');
  assert.equal(report.next, `Next: untick Paused in Agent settings (https://www.notion.so/${w.DB.agent_settings}).`);
  assert.deepEqual(lintReport(markdown(report)), []);
});

test('preflight: a judged tag whose When to use was edited in Notion means exit 4 and names the tag and the column', async () => {
  const w = await makeWorld({ claims: 2 });
  const old = w.row('rulebook', 'Context-dependent')['When to use'];
  w.fake.editRow(w.ids.tag['Context-dependent'], { 'When to use': `${old}\n6. A sixth rule somebody added by hand.` });
  const pre = await check(w);
  assert.deepEqual([pre.ok, pre.code, pre.kind, pre.tag, pre.column], [false, 4, 'drift', 'Context-dependent', 'When to use']);
  assert.match(pre.reason, /Context-dependent: When to use/);
  const report = refusedReport(w.config, pre, 'Promote');
  assert.equal(report.sentence, 'Promote: nothing was done, because the rulebook text in Notion no longer matches the saved edition (Context-dependent: When to use).');
  assert.equal(report.next, `Next: put the rulebook text back on Context-dependent (https://www.notion.so/${w.DB.rulebook}?v=e3000000000000000000000000000004), or ask the engineer to restore an edition.`);
  assert.deepEqual(lintReport(markdown(report)), []);
});

test('preflight: the other judged columns count too (Description, Example Claims, Counterpart), each named', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag['Context-dependent'], { Description: 'Somebody rewrote this.', Counterpart: 'Standalone' });
  const pre = await check(w);
  assert.equal(pre.code, 4);
  assert.deepEqual(pre.stops.map((s) => s.column).sort(), ['Counterpart', 'Description']);
  assert.match(refusedReport(w.config, pre, 'Tag').sentence, /\(Context-dependent: Description; Context-dependent: Counterpart\)|\(Context-dependent: Counterpart; Context-dependent: Description\)/);
});

test('preflight: a judged tag whose row is gone from the copy also stops the command (exit 4)', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag['Context-dependent'], { Name: 'Renamed by hand' });
  const pre = await check(w);
  assert.deepEqual([pre.ok, pre.code, pre.kind, pre.tag], [false, 4, 'drift', 'Context-dependent']);
  assert.match(pre.reason, /the row is gone from the copy/);
});

test('preflight: an edit to a tag without rules is taken over as a new edition "adopted from Notion", and the command goes on', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag.Wordy, { Description: 'A claim that says in many words what few would say.' });
  const pre = await check(w);
  assert.deepEqual([pre.ok, pre.code], [true, 0]);
  assert.deepEqual(pre.adopted, [{ tag: 'Wordy', columns: ['Description'] }]);
  assert.equal(pre.edition, '2026-10-16.2');
  assert.equal(w.rubric().edition, '2026-10-16.2');
  assert.equal(w.rubric().tags.find((t) => t.name === 'Wordy').description, 'A claim that says in many words what few would say.');
  const log = readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8').trim().split('\n');
  assert.equal(log.length, 2);
  assert.equal(log[1], '- 2026-10-16 · edition 2026-10-16.2 · adopted from Notion: Wordy Description');
  assert.ok(readJson(join(w.root, 'rubric', 'history', '2026-10-16.2.json')).tags.length === 13);
  // the next pull agrees with the new lock
  const again = await check(w);
  assert.deepEqual([again.ok, again.adopted.length, again.edition], [true, 0, '2026-10-16.2']);
});

test('preflight: when the adopted text holds numbered rules the tag is judged from the new edition (it still needs a judge group to be judged)', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag.Wordy, { 'When to use': '1. A claim that repeats itself is Wordy.\n2. A claim with filler words is Wordy.' });
  const pre = await check(w);
  assert.equal(pre.ok, true);
  const wordy = w.rubric().tags.find((t) => t.name === 'Wordy');
  assert.deepEqual([wordy.rules.length, wordy.judged], [2, true]);
  const log = readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8');
  assert.match(log, /adopted from Notion: Wordy When to use/);
});

test('preflight with adopt: false (status) leaves the rulebook files alone and says an edit waits to be taken over', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag.Wordy, { Description: 'Changed.' });
  const pre = await check(w, { adopt: false });
  assert.equal(pre.ok, true);
  assert.equal(w.rubric().edition, '2026-10-16.1');
  assert.ok(pre.warnings.some((x) => /without rules has been edited in Notion/.test(x)), pre.warnings.join('|'));
});

test('preflight: a builder session (runs/SETUP) is a warning, not a stop', async () => {
  const w = await makeWorld({ claims: 2 });
  w.write('runs/SETUP', '{}\n');
  const pre = await check(w);
  assert.equal(pre.ok, true);
  assert.ok(pre.warnings.some((x) => /builder session is open/.test(x)));
});

test('preflight: a check that cannot run is reported as a warning: no pull yet, no lock, a rulebook file that is gone', async () => {
  const w = await makeWorld({ claims: 2, rulebook: false });
  const none = preflight({ root: w.root, config: w.config, now: () => NOW });
  assert.equal(none.ok, true);
  assert.ok(none.warnings.some((x) => /no pull yet/.test(x)));
  assert.ok(none.warnings.some((x) => /no rulebook edition yet/.test(x)));
  const pull = await w.pull();
  const after = preflight({ root: w.root, config: w.config, pullId: pull.pullId, now: () => NOW });
  assert.ok(after.warnings.some((x) => /no rulebook edition yet/.test(x)));
});

test('preflight: a rulebook file that does not match its own hashes, or its lock, means exit 4', async () => {
  const w = await makeWorld({ claims: 2 });
  const file = join(w.root, 'rubric', 'rubric.json');
  const rubric = readJson(file);
  rubric.tags.find((t) => t.name === 'Context-dependent').rules[0].text = 'A rule edited by hand on disk.';
  writeFileSync(file, `${JSON.stringify(rubric, null, 2)}\n`);
  const pre = await check(w);
  assert.deepEqual([pre.ok, pre.code, pre.kind], [false, 4, 'rubric_file']);
  assert.match(pre.reason, /rulebook file on disk is not valid/);
  const report = refusedReport(w.config, pre, 'Tag');
  assert.equal(report.sentence, 'Tag: nothing was done, because the rulebook file on disk no longer matches its own checks.');
  assert.equal(report.next, 'Next: ask the engineer to restore the rulebook file.');

  const w2 = await makeWorld({ claims: 2 });
  const lockFile = join(w2.root, 'rubric', 'rubric.lock');
  const lock = readJson(lockFile);
  lock.text['Context-dependent'] = 'A locked text that differs.';
  writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  const pre2 = await check(w2);
  assert.deepEqual([pre2.code, pre2.kind], [4, 'rubric_file']);
  assert.match(pre2.reason, /no longer matches its lock/);
});

test('preflight: a drift check that the pull skipped is a warning', async () => {
  const w = await makeWorld({ claims: 2 });
  const p = await w.pull();
  writeFileSync(join(w.root, 'runs', 'pull', p.pullId, 'drift.json'), `${JSON.stringify({ skipped: 'the check could not run' })}\n`);
  const pre = preflight({ root: w.root, config: w.config, pullId: p.pullId, now: () => NOW });
  assert.equal(pre.ok, true);
  assert.ok(pre.warnings.some((x) => /drift check was skipped/.test(x)));
});

test('refusedReport: a plain sentence of why, a demo prefix, and no label all give a lint-clean three-part report', async () => {
  const w = await makeWorld({ claims: 1, demo: true });
  const plain = refusedReport(w.config, 'the table is not set up yet');
  assert.equal(plain.sentence, 'Nothing was done, because the table is not set up yet.');
  assert.equal(plain.demo, true);
  assert.ok(markdown(plain).startsWith('Demo · Nothing was done'));
  assert.deepEqual(lintReport(markdown(plain)), []);
  const empty = refusedReport(w.config, {}, 'Status');
  assert.equal(empty.sentence, 'Status: nothing was done.');
  const several = refusedReport(w.config, { kind: 'drift', stops: [{ tag: 'A', column: 'When to use' }, { tag: 'B', column: 'Description' }, { tag: 'A', column: 'Counterpart' }] }, 'Tag');
  assert.match(several.next, /^Next: put the rulebook text back on A and B \(/);
  assert.deepEqual(lintReport(markdown(several)), []);
});
