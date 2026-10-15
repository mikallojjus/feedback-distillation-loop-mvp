import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listEditions, main, restore } from '../../agents/claim-tagger-mvp/scripts/restore.mjs';
import { promote } from '../../agents/claim-tagger-mvp/scripts/promote.mjs';
import { propose } from '../../agents/claim-tagger-mvp/scripts/propose.mjs';
import { distill } from '../../agents/claim-tagger-mvp/scripts/distill.mjs';
import { followup } from '../../agents/claim-tagger-mvp/scripts/followup.mjs';
import { rollback } from '../../agents/claim-tagger-mvp/scripts/rollback.mjs';
import { status } from '../../agents/claim-tagger-mvp/scripts/status.mjs';
import { readJson } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { stampOf } from '../../agents/claim-tagger-mvp/scripts/lib/editor-words.mjs';
import { NOW } from './helpers/loop-world.mjs';
import { NEW_TEXT, RULE4, TITLE, promoteWorld } from './helpers/promote-scenario.mjs';

function assertReport(h, r) {
  assert.ok(r.markdown, 'a report was written');
  assert.deepEqual(lintReport(r.markdown), [], r.markdown);
  assert.equal(h.io.outs.join('\n').trimEnd(), r.markdown.trimEnd());
  assert.ok(!/\bcalls?\b|token|duration|\$|\.mjs|runs\//i.test(r.markdown), r.markdown);
  return r.report;
}
const afterPass = async (opts = {}) => {
  const w = await promoteWorld(opts);
  assert.equal((await promote(w.hooks())).exit, 0);
  return w;
};
const rule4 = (w) => w.row('rulebook', 'Context-dependent')['When to use'].split('\n').find((l) => l.startsWith('4.'));
const when = (w) => w.row('rulebook', 'Context-dependent')['When to use'];

test('restore --list prints the editions with their changelog line and marks the one in force; it needs no pull, so it works while paused', async () => {
  const w = await afterPass();
  w.setPaused(true);
  const writes = w.writes().length;
  const h = w.hooks({ list: true });
  const r = await restore(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(w.writes().length, writes);
  assert.deepEqual(h.io.outs, [`2026-10-16.1  the first edition of the test world\n2026-10-16.2 (in force)  lesson ${TITLE} PASS`]);
  assert.deepEqual(listEditions(w.root).map((e) => [e.edition, e.current]), [['2026-10-16.1', false], ['2026-10-16.2', true]]);
  assert.deepEqual(lintReport(r.markdown), []);
  assert.equal(r.report.sentence, 'Restore: 2 editions are on file; edition 2026-10-16.2 is in force.');
  assert.deepEqual(r.report.header, ['Edition', 'What changed', '']);
  assert.equal(r.report.rows.length, 2);
  assert.equal(readJson(join(r.runDir, 'run.json')).script, 'restore');
});

test('restore --edition without --confirm changes nothing and says what it would do (exit 2)', async () => {
  const w = await afterPass();
  const writes = w.writes().length;
  const h = w.hooks({ edition: '2026-10-16.1' });
  const r = await restore(h);
  assert.equal(r.exit, 2);
  assert.equal(w.writes().length, writes);
  assert.equal(rule4(w), `4. ${NEW_TEXT}`);
  assert.equal(assertReport(h, r).sentence, 'Restore: nothing was changed yet; this would write the text of edition 2026-10-16.1 back for Context-dependent and record edition 2026-10-16.3.');
  assert.equal(r.report.next, 'Next: run the same command with --confirm to do it.');
});

test('restore --edition <earlier> --confirm writes that edition\'s text back, records "restored from <e>" as a new edition and updates Agent settings', async () => {
  const w = await afterPass();
  const originalWhen = readJson(join(w.root, 'rubric', 'history', '2026-10-16.1.json')).tags.find((t) => t.name === 'Context-dependent').when_to_use;
  const h = w.hooks({ edition: '2026-10-16.1', confirm: true });
  const r = await restore(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(when(w), originalWhen);
  assert.equal(rule4(w), `4. ${RULE4}`);
  const rubric = readJson(join(w.root, 'rubric', 'rubric.json'));
  assert.equal(rubric.edition, '2026-10-16.3');
  assert.equal(rubric.rubric_hash, readJson(join(w.root, 'rubric', 'history', '2026-10-16.1.json')).rubric_hash, 'the rules are those of the earlier edition');
  assert.equal(readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8').trim().split('\n').at(-1), '- 2026-10-16 · edition 2026-10-16.3 · restored from 2026-10-16.1');
  const settings = w.row('agent_settings', 'Claim tagger');
  assert.deepEqual([settings['Rulebook edition'], settings['Last run summary']], ['2026-10-16.3', `Restore · ${stampOf(NOW)} · 2026-10-16.1`]);
  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Restore: the rulebook text of edition 2026-10-16.1 is back in Notion (edition 2026-10-16.3).');
  assert.equal(report.next, 'Next: type /claim-tagger status to see what is open.');
  // the next pull agrees with the new lock, and the rule change keeps its Live status (rollback is how a lesson is marked)
  const drift = readJson(join(w.root, 'runs', 'pull', (await w.pull()).pullId, 'drift.json'));
  assert.deepEqual([drift.judged.length, drift.adopted.length, drift.missing.length], [0, 0, 0]);
  assert.equal(w.row('rule_changes', TITLE).Status, 'Live');
  const plan = readFileSync(join(r.runDir, 'plan.jsonl'), 'utf8').trim().split('\n').slice(1).map((l) => JSON.parse(l));
  assert.deepEqual(plan.map((op) => [op.table, Object.keys(op.properties)]), [['rulebook', ['When to use']]], 'the Rulebook copy first and alone');
  const bookkeeping = readFileSync(join(`${r.runDir}-record`, 'plan.jsonl'), 'utf8').trim().split('\n').slice(1).map((l) => JSON.parse(l));
  assert.deepEqual(bookkeeping.map((op) => [op.table, Object.keys(op.properties)]), [['agent_settings', ['Rulebook edition', 'Last run summary']]]);
});

test('restore is the answer to a drift stop: every command exits 4 on an edited When to use, restoring the edition in force clears it, and the next command runs', async () => {
  const w = await promoteWorld({ status: 'Proposed', open: 1 });
  const locked = when(w);
  w.fake.editRow(w.ids.tag['Context-dependent'], { 'When to use': `${locked}\n6. Somebody added a sixth rule by hand.` });
  for (const [name, run] of [
    ['propose', () => propose(w.hooks())], ['distill', () => distill(w.hooks())], ['promote', () => promote(w.hooks())], ['followup', () => followup(w.hooks())],
    ['rollback', () => rollback(w.hooks({ lesson: TITLE, confirm: true }))], ['status', () => status(w.hooks())],
  ]) {
    const r = await run();
    assert.equal(r.exit, 4, name);
  }
  const editions = w.rubric().edition;
  const h = w.hooks({ edition: editions, confirm: true });
  const r = await restore(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(when(w), locked, 'the saved text is back over the edit');
  assert.equal(w.rubric().edition, '2026-10-16.2', 'a restore that writes is an edition of its own, with the same rules');
  assert.equal(w.rubric().rubric_hash, readJson(join(w.root, 'rubric', 'history', `${editions}.json`)).rubric_hash);
  assert.equal(readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8').trim().split('\n').at(-1), `- 2026-10-16 · edition 2026-10-16.2 · restored from ${editions}`);
  assert.equal(assertReport(h, r).sentence, `Restore: the rulebook text of edition ${editions} is back in Notion (edition 2026-10-16.2).`);
  assert.equal((await status(w.hooks())).exit, 0, 'the next command runs');
});

test('restore: an edit to a column it cannot write (Description) stays, and the report says it has to be put back by hand', async () => {
  const w = await promoteWorld();
  const locked = when(w);
  w.fake.editRow(w.ids.tag['Context-dependent'], { 'When to use': `${locked}\n6. By hand.`, Description: 'Somebody rewrote this.' });
  const h = w.hooks({ edition: w.rubric().edition, confirm: true });
  const r = await restore(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(when(w), locked);
  assert.equal(w.row('rulebook', 'Context-dependent').Description, 'Somebody rewrote this.');
  const report = assertReport(h, r);
  assert.match(report.sentence, /; the other edits on Context-dependent still have to be put back by hand\.$/);
  assert.match(report.next, /^Next: put the other columns back by hand on Context-dependent \(https:\/\/www\.notion\.so\//);
  assert.equal((await status(w.hooks())).exit, 4, 'the Description still stops every command');
});

test('restore: nothing to put back is said plainly; an unknown edition, a bad edition and a missing --edition are exit 2', async () => {
  const w = await promoteWorld();
  const h = w.hooks({ edition: w.rubric().edition, confirm: true });
  const r = await restore(h);
  assert.equal(r.exit, 0);
  assert.equal(assertReport(h, r).sentence, 'Restore: nothing to put back; the rulebook text in Notion already matches edition 2026-10-16.1.');
  assert.equal(w.writes().length, 0);

  const unknown = await restore(w.hooks({ edition: '2026-01-01.1', confirm: true }));
  assert.equal(unknown.exit, 2);
  assert.equal(unknown.report.sentence, 'Restore: nothing was done, because there is no saved edition 2026-01-01.1.');
  assert.equal(unknown.report.next, 'Next: run the restore command with --list to see the editions.');
  const bad = await restore(w.hooks({ edition: 'latest', confirm: true }));
  assert.equal(bad.exit, 2);
  assert.equal(bad.report.sentence, 'Restore: nothing was done, because it needs the edition to put back.');
});

test('restore: a paused agent stops it (exit 3), and a write that fails leaves the edition files alone so the same command can go on', async () => {
  const paused = await afterPass();
  paused.setPaused(true);
  const rp = await restore(paused.hooks({ edition: '2026-10-16.1', confirm: true }));
  assert.equal(rp.exit, 3);
  assert.equal(rp.report.sentence, 'Restore: nothing was done, because the agent is paused.');

  const w = await afterPass();
  w.fake.failNext('PATCH', /\/pages\//, 400, 1);
  const h = w.hooks({ edition: '2026-10-16.1', confirm: true });
  const r = await restore(h);
  assert.equal(r.exit, 1);
  assert.equal(w.rubric().edition, '2026-10-16.2', 'no new edition while the text in Notion was not written');
  assert.equal(rule4(w), `4. ${NEW_TEXT}`);
  const again = await restore(w.hooks({ edition: '2026-10-16.1', confirm: true }));
  assert.equal(again.exit, 0);
  assert.equal(rule4(w), `4. ${RULE4}`);
  assert.equal(w.rubric().edition, '2026-10-16.3');
});

test('restore: when only Agent settings cannot be written the text and the edition are in place, the run says it stopped, and the next writing command brings the settings up to date', async () => {
  const w = await afterPass();
  w.fake.failNext('PATCH', new RegExp(`^/pages/${w.ids.settings}`), 400, 1);
  const r = await restore(w.hooks({ edition: '2026-10-16.1', confirm: true }));
  assert.equal(r.exit, 1);
  assert.equal(r.report.sentence, 'Restore stopped before every change was written to Notion.');
  assert.equal(rule4(w), `4. ${RULE4}`);
  assert.equal(w.rubric().edition, '2026-10-16.3');
  assert.equal(w.row('agent_settings', 'Claim tagger')['Rulebook edition'], '2026-10-16.2', 'the settings line is behind');
  const s = await status(w.hooks());
  assert.equal(s.exit, 0, 'and nothing is stuck: the rulebook text and the saved edition agree');
  const t2 = await propose(w.hooks());
  assert.notEqual(t2.exit, 3);
});

test('restore: the rubric folder is committed whenever a new edition was recorded, and not when there was nothing to put back', async () => {
  const gitCalls = [];
  const git = (args) => {
    gitCalls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  };
  const w = await afterPass();
  assert.equal((await restore(w.hooks({ edition: '2026-10-16.1', confirm: true, git, noCommit: false }))).exit, 0);
  assert.deepEqual(gitCalls, [['add', 'agents/claim-tagger-mvp/rubric'], ['commit', '-m', 'rulebook edition 2026-10-16.3: restored from 2026-10-16.1', '--', 'agents/claim-tagger-mvp/rubric']]);
  gitCalls.length = 0;
  w.fake.editRow(w.ids.tag['Context-dependent'], { 'When to use': `${when(w)}\n6. By hand.` });
  assert.equal((await restore(w.hooks({ edition: '2026-10-16.3', confirm: true, git, noCommit: false }))).exit, 0);
  assert.deepEqual(gitCalls, [['add', 'agents/claim-tagger-mvp/rubric'], ['commit', '-m', 'rulebook edition 2026-10-16.4: restored from 2026-10-16.3', '--', 'agents/claim-tagger-mvp/rubric']], 'also the answer to a drift');
  gitCalls.length = 0;
  assert.equal((await restore(w.hooks({ edition: '2026-10-16.4', confirm: true, git, noCommit: false }))).exit, 0);
  assert.deepEqual(gitCalls, [], 'nothing to put back, nothing recorded');
});

test('restore: the command line needs --list, or --edition with --confirm', async () => {
  const io = { outs: [], errs: [], out: (s) => io.outs.push(s), err: (s) => io.errs.push(s) };
  assert.equal(await main([], io), 2);
  assert.match(io.errs.join('\n'), /give --list, or --edition/);
  assert.equal(await main(['--list', '--edition', '2026-10-16.1'], io), 2);
  assert.equal(await main(['--bogus'], io), 2);
  assert.equal(await main(['--help'], io), 0);
  assert.match(io.outs.join('\n'), /restore\.mjs --list/);
});
