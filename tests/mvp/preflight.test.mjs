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

test('preflight: rules adopted on a tag whose Judged box is not ticked leave it unjudged; ticking the box later makes it judged from the next edition', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag.Wordy, { 'When to use': '1. A claim that repeats itself is Wordy.\n2. A claim with filler words is Wordy.' });
  const pre = await check(w);
  assert.equal(pre.ok, true);
  const wordy = w.rubric().tags.find((t) => t.name === 'Wordy');
  assert.deepEqual([wordy.rules.length, wordy.judged], [2, false], 'rules without a tick: not judged');
  const log = readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8');
  assert.match(log, /adopted from Notion: Wordy When to use/);
  assert.deepEqual(pre.toggled, []);
  // the box is ticked: one more edition, judged on
  w.fake.editRow(w.ids.tag.Wordy, { Judged: true });
  const on = await check(w);
  assert.deepEqual([on.ok, on.edition, on.toggled], [true, '2026-10-16.3', [{ tag: 'Wordy', judged: true }]]);
  assert.equal(w.rubric().tags.find((t) => t.name === 'Wordy').judged, true);
});

test('preflight with adopt: false (status) leaves the rulebook files alone and says an edit waits to be taken over', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag.Wordy, { Description: 'Changed.' });
  const pre = await check(w, { adopt: false });
  assert.equal(pre.ok, true);
  assert.equal(w.rubric().edition, '2026-10-16.1');
  assert.ok(pre.warnings.some((x) => /tag that is not judged has been edited in Notion/.test(x)), pre.warnings.join('|'));
});

const changelog = (w) => readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8').trim().split('\n');
const lockOf = (w) => readJson(join(w.root, 'rubric', 'rubric.lock'));

test('preflight: ticking and unticking the Judged box are taken over as editions with a changelog line each ("Judged on: <tag>", "Judged off: <tag>"), and neither stops the command', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag.Wordy, { 'When to use': '1. A claim that repeats itself is Wordy.\n2. A claim with filler words is Wordy.' });
  assert.equal((await check(w)).edition, '2026-10-16.2', 'the rules come in as an edition of their own, unjudged: the box is not ticked');
  assert.equal(lockOf(w).judged.Wordy, false);

  w.fake.editRow(w.ids.tag.Wordy, { Judged: true });
  const on = await check(w);
  assert.deepEqual([on.ok, on.code, on.edition, on.toggled, on.adopted], [true, 0, '2026-10-16.3', [{ tag: 'Wordy', judged: true }], []]);
  assert.equal(changelog(w).at(-1), '- 2026-10-16 · edition 2026-10-16.3 · Judged on: Wordy');
  assert.equal(w.rubric().tags.find((t) => t.name === 'Wordy').judged, true);
  assert.equal(lockOf(w).judged.Wordy, true);
  assert.equal(readJson(join(w.root, 'rubric', 'history', '2026-10-16.3.json')).tags.find((t) => t.name === 'Wordy').judged, true);
  // the same box seen again is nothing new
  const quiet = await check(w);
  assert.deepEqual([quiet.edition, quiet.toggled, quiet.warnings], ['2026-10-16.3', [], []]);

  w.fake.editRow(w.ids.tag.Wordy, { Judged: false });
  const off = await check(w);
  assert.deepEqual([off.ok, off.edition, off.toggled], [true, '2026-10-16.4', [{ tag: 'Wordy', judged: false }]]);
  assert.equal(changelog(w).at(-1), '- 2026-10-16 · edition 2026-10-16.4 · Judged off: Wordy');
  assert.equal(w.rubric().tags.find((t) => t.name === 'Wordy').judged, false);
  assert.equal(w.rubric().tags.find((t) => t.name === 'Wordy').rules.length, 2, 'the rules stay, unjudged');
  assert.equal(changelog(w).length, 4);
  // after the untick its rules change freely again
  w.fake.editRow(w.ids.tag.Wordy, { 'When to use': '1. Another first rule.' });
  const free = await check(w);
  assert.deepEqual([free.ok, free.edition, free.adopted], [true, '2026-10-16.5', [{ tag: 'Wordy', columns: ['When to use'] }]]);
});

test('preflight: several toggles of one pull are one edition with one clause per tag, in tag order, next to the edits of the same pull', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag.Wordy, { 'When to use': '1. First.\n2. Second.', Judged: true });
  w.fake.editRow(w.ids.tag['Trailing period'], { 'When to use': '1. A claim that ends with a full stop.', Judged: true });
  w.fake.editRow(w.ids.tag['Context-dependent'], { Judged: false });
  w.fake.editRow(w.ids.tag['Poor wording'], { Description: 'An awkward phrase.' });
  const pre = await check(w);
  assert.equal(pre.ok, true);
  assert.equal(pre.edition, '2026-10-16.2', 'one edition for all of it');
  assert.deepEqual(pre.toggled, [{ tag: 'Context-dependent', judged: false }, { tag: 'Trailing period', judged: true }, { tag: 'Wordy', judged: true }]);
  assert.deepEqual(changelog(w).slice(1), [
    '- 2026-10-16 · edition 2026-10-16.2 · adopted from Notion: Poor wording Description; Trailing period When to use; Wordy When to use',
    '- 2026-10-16 · edition 2026-10-16.2 · Judged off: Context-dependent',
    '- 2026-10-16 · edition 2026-10-16.2 · Judged on: Trailing period',
    '- 2026-10-16 · edition 2026-10-16.2 · Judged on: Wordy',
  ], 'the edits on one line as ever, then one line for each tag whose box changed');
  assert.deepEqual(w.rubric().tags.filter((t) => t.judged).map((t) => t.name), ['Trailing period', 'Wordy']);
  assert.deepEqual(Object.entries(lockOf(w).judged).filter(([, v]) => v).map(([k]) => k), ['Trailing period', 'Wordy']);
});

test('preflight: a tag unticked and edited in the same pull is adopted as one edition; a tag edited while its box stays ticked still stops, also when the rules are deleted', async () => {
  const w = await makeWorld({ claims: 2 });
  const cd = w.rubric().tags.find((t) => t.name === 'Context-dependent');
  assert.equal(cd.judged, true);
  w.fake.editRow(w.ids.tag['Context-dependent'], { 'When to use': cd.when_to_use.replace('Test: could', 'Test: would'), Judged: false });
  const both = await check(w);
  assert.deepEqual([both.ok, both.edition, both.toggled], [true, '2026-10-16.2', [{ tag: 'Context-dependent', judged: false }]]);
  assert.deepEqual(changelog(w).slice(1), ['- 2026-10-16 · edition 2026-10-16.2 · adopted from Notion: Context-dependent When to use', '- 2026-10-16 · edition 2026-10-16.2 · Judged off: Context-dependent']);
  assert.equal(w.rubric().tags.find((t) => t.name === 'Context-dependent').judged, false);

  const stays = await makeWorld({ claims: 2 });
  stays.fake.editRow(stays.ids.tag['Context-dependent'], { 'When to use': '' });
  const stop = await check(stays);
  assert.deepEqual([stop.ok, stop.code, stop.kind, stop.tag, stop.column], [false, 4, 'drift', 'Context-dependent', 'When to use'], 'the rules of a ticked tag are not deleted without the stop');
  assert.equal(stays.rubric().edition, '2026-10-16.1');
});

test('preflight: a second command on a pull that was already taken over writes no second edition', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag.Wordy, { 'When to use': '1. First.', Judged: true });
  const p = await w.pull();
  const first = preflight({ root: w.root, config: w.config, pullId: p.pullId, now: () => NOW });
  assert.deepEqual([first.edition, first.toggled.length], ['2026-10-16.2', 1]);
  const again = preflight({ root: w.root, config: w.config, pullId: p.pullId, now: () => NOW });
  assert.equal(again.ok, true);
  assert.deepEqual([again.edition, again.toggled, again.adopted], ['2026-10-16.2', [], []], 'the drift of that pull is older than the edition in force: nothing is written again');
  assert.deepEqual(changelog(w).slice(1), ['- 2026-10-16 · edition 2026-10-16.2 · adopted from Notion: Wordy When to use', '- 2026-10-16 · edition 2026-10-16.2 · Judged on: Wordy'], 'the one edition has its two lines, and no third');
});

test('the judge takes a toggle over before it reads the rulebook: one run judges the tag that was just ticked, stops judging the one just unticked, and the command after it finds nothing left to take over', async () => {
  const w = await makeWorld({ claims: 3 });
  w.fake.editRow(w.ids.tag.Wordy, { 'When to use': '1. A claim that repeats itself is Wordy.\n2. A claim with filler words is Wordy.' });
  assert.equal((await check(w)).edition, '2026-10-16.2');

  w.fake.editRow(w.ids.tag.Wordy, { Judged: true });
  const on = await w.judge({ runsMax: 1 });
  assert.equal(on.exit, 0, JSON.stringify(on.report));
  const record = readJson(join(on.runDir, 'run.json'));
  assert.equal(record.rubric_edition, '2026-10-16.3', 'the run judged with the edition that holds the tick');
  assert.deepEqual(record.groups.map((g) => [g.name, g.tags]), [['G1', ['Context-dependent']], ['Wordy', ['Wordy']]], 'the tick made a group of its own: no config edit');
  assert.match(record.warnings.join(' '), /Judged on: Wordy\); it was taken over into edition 2026-10-16\.3 before this run/);
  assert.equal(changelog(w).at(-1), '- 2026-10-16 · edition 2026-10-16.3 · Judged on: Wordy');
  const after = await check(w);
  assert.deepEqual([after.edition, after.toggled, after.adopted], ['2026-10-16.3', [], []]);

  w.fake.editRow(w.ids.tag.Wordy, { Judged: false });
  const off = await w.judge({ runsMax: 1 });
  assert.equal(off.exit, 0);
  const second = readJson(join(off.runDir, 'run.json'));
  assert.equal(second.rubric_edition, '2026-10-16.4');
  assert.deepEqual(second.groups.map((g) => g.name), ['G1']);
  assert.equal(changelog(w).at(-1), '- 2026-10-16 · edition 2026-10-16.4 · Judged off: Wordy');
});

test('the judge leaves a toggle to the next command when it cannot take it over: a candidate rulebook (--rubric), and it never stops for one', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag.Wordy, { 'When to use': '1. First.', Judged: true });
  const r = await w.judge({ runsMax: 1, rubric: join(w.root, 'rubric', 'rubric.json') });
  assert.equal(r.exit, 0);
  assert.equal(w.rubric().edition, '2026-10-16.1', 'a candidate file is judged as it is: no edition was written');
  assert.equal(readJson(join(r.runDir, 'run.json')).groups.length, 1);
});

test('preflight: with adopt: false (status) a toggle waits and is said in words, and no file is written', async () => {
  const w = await makeWorld({ claims: 2 });
  w.fake.editRow(w.ids.tag.Wordy, { 'When to use': '1. First.', Judged: true });
  const pre = await check(w, { adopt: false });
  assert.equal(pre.ok, true);
  assert.equal(w.rubric().edition, '2026-10-16.1');
  assert.ok(pre.warnings.some((x) => /Judged on: Wordy in Notion; the next command takes it over/.test(x)), pre.warnings.join('|'));
  assert.deepEqual(pre.toggled, []);
});

test('preflight: a lock from before the Judged box judges Context-dependent only, so the first command takes the other ticks over as toggles and the one judged tag stays protected', async () => {
  const { readFileSync: read } = await import('node:fs');
  const taxonomy = JSON.parse(read(join(import.meta.dirname, '..', '..', 'agents', 'claim-tagger-mvp', 'setup', 'taxonomy-issue.json'), 'utf8'));
  const seeded = taxonomy.rows.map((row) => (['Wordy', 'Trailing period'].includes(row.Name) ? { ...row, 'When to use': '1. A rule.\n2. Another rule.', Judged: true } : row));
  const w = await makeWorld({ claims: 2, rulebook: seeded });
  assert.deepEqual(w.rubric().tags.filter((t) => t.judged).map((t) => t.name), ['Context-dependent', 'Trailing period', 'Wordy']);
  // the state of the repository before the Judged box: a lock with no judged map, and an edition whose flags are "has rules and is a text tag"
  const lock = lockOf(w);
  delete lock.judged;
  writeFileSync(join(w.root, 'rubric', 'rubric.lock'), `${JSON.stringify(lock, null, 2)}\n`);
  const stale = await check(w, { adopt: false });
  assert.equal(stale.ok, true, 'the file and its old lock still agree');
  assert.ok(stale.warnings.some((x) => /Judged on: Trailing period; Judged on: Wordy in Notion/.test(x)), stale.warnings.join('|'));
  const first = await check(w);
  assert.deepEqual([first.ok, first.edition, first.toggled], [true, '2026-10-16.2', [{ tag: 'Trailing period', judged: true }, { tag: 'Wordy', judged: true }]], 'Context-dependent was judged and is: it is no toggle');
  assert.deepEqual(changelog(w).slice(1), ['- 2026-10-16 · edition 2026-10-16.2 · Judged on: Trailing period', '- 2026-10-16 · edition 2026-10-16.2 · Judged on: Wordy'], 'a line for each tag, and none for Context-dependent');
  assert.deepEqual(Object.entries(lockOf(w).judged).filter(([, v]) => v).map(([k]) => k), ['Context-dependent', 'Trailing period', 'Wordy'], 'the new lock has the map');
  assert.deepEqual((await check(w)).toggled, [], 'and the next pull is quiet');

  // the same migration, but somebody edited the rules of Context-dependent before the first pull: that is a stop, not an adoption
  const guarded = await makeWorld({ claims: 2, rulebook: seeded });
  const old = lockOf(guarded);
  delete old.judged;
  writeFileSync(join(guarded.root, 'rubric', 'rubric.lock'), `${JSON.stringify(old, null, 2)}\n`);
  guarded.fake.editRow(guarded.ids.tag['Context-dependent'], { 'When to use': '1. Somebody rewrote the rules.' });
  const stop = await check(guarded);
  assert.deepEqual([stop.ok, stop.code, stop.tag, stop.column], [false, 4, 'Context-dependent', 'When to use']);
  assert.equal(guarded.rubric().edition, '2026-10-16.1');
});

test('preflight: a Rulebook that has lost the Judged column keeps the saved ticks: a warning, no toggle, and an edit taken over in that state does not un-judge anything', async () => {
  const { TABLE_SPECS } = await import('./helpers/tables.mjs');
  const { Judged: _box, ...withoutBox } = TABLE_SPECS.rulebook;
  const w = await makeWorld({ claims: 2, tableSpecs: { rulebook: withoutBox } });
  // the world made its first edition from rows that had no box: nothing is judged. Make the edition of a Rulebook that had it.
  const { buildRubric, writeEdition } = await import('../../agents/claim-tagger-mvp/scripts/lib/rubric.mjs');
  const { loadPull, latestPullId } = await import('../../agents/claim-tagger-mvp/scripts/pull.mjs');
  const rows = loadPull(w.root, latestPullId(w.root), { config: w.config }).rulebook().map((r) => ({ ...r, Judged: r.Name === 'Context-dependent' }));
  writeEdition(w.root, buildRubric(rows, { config: w.config, edition: '2026-10-16.2', now: NOW }), { reason: 'the Rulebook as it was with the box' });
  assert.equal(w.rubric().tags.find((t) => t.name === 'Context-dependent').judged, true);

  w.fake.editRow(w.ids.tag.Wordy, { Description: 'Edited while the column was gone.' });
  const pre = await check(w);
  assert.equal(pre.ok, true);
  assert.deepEqual(pre.toggled, []);
  assert.ok(pre.warnings.some((x) => /has no Judged column/.test(x)), pre.warnings.join('|'));
  assert.equal(pre.edition, '2026-10-16.3', 'the edit is taken over');
  assert.equal(w.rubric().tags.find((t) => t.name === 'Context-dependent').judged, true, 'but Context-dependent is still judged: a missing column is not an untick');
  assert.deepEqual(lockOf(w).judged['Context-dependent'], true);
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
