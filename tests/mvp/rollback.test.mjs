import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { main, rollback } from '../../agents/claim-tagger-mvp/scripts/rollback.mjs';
import { promote } from '../../agents/claim-tagger-mvp/scripts/promote.mjs';
import { restore } from '../../agents/claim-tagger-mvp/scripts/restore.mjs';
import { readJson, readJsonl } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { stampOf } from '../../agents/claim-tagger-mvp/scripts/lib/editor-words.mjs';
import { NOW, claimText } from './helpers/loop-world.mjs';
import { MARK, NEW_TEXT, RULE4, TITLE, keyOf, promoteWorld, readingCells } from './helpers/promote-scenario.mjs';

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
const restoreTo = (w, edition) => restore(w.hooks({ edition, confirm: true }));
const rule4 = (w) => w.row('rulebook', 'Context-dependent')['When to use'].split('\n').find((l) => l.startsWith('4.'));
const originalWhen = (w) => readJson(join(w.root, 'rubric', 'history', '2026-10-16.1.json')).tags.find((t) => t.name === 'Context-dependent').when_to_use;

test('rollback without --confirm changes nothing: it says what it would do and exits 2', async () => {
  const w = await afterPass();
  const writes = w.writes().length;
  const h = w.hooks({ lesson: TITLE });
  const r = await rollback(h);
  assert.equal(r.exit, 2);
  assert.equal(w.writes().length, writes);
  assert.equal(w.rubric().edition, '2026-10-16.2');
  const report = assertReport(h, r);
  assert.equal(report.sentence, `Rollback: nothing was changed yet; this would put rule 4 of Context-dependent back to its earlier text (edition 2026-10-16.3) and mark "${TITLE}" as rolled back.`);
  assert.deepEqual(report.rows.map((x) => x[0]), ['Rule now', 'Rule after']);
  assert.ok(report.rows[0][1].startsWith('"Test: a reference that reads as general needs no answer'));
  assert.ok(report.rows[1][1].startsWith('"Test: could a reader who sees only this sentence'));
  assert.equal(report.next, 'Next: type the same command with --confirm to put the earlier text back.');
});

test('rollback --confirm puts the lesson\'s Current text back, records edition .3 "rolled back <title>", and marks the lesson Rolled back with its result unchanged', async () => {
  const w = await afterPass();
  const h = w.hooks({ lesson: TITLE, confirm: true });
  const r = await rollback(h);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));

  assert.equal(rule4(w), `4. ${RULE4}`);
  assert.equal(w.row('rulebook', 'Context-dependent')['When to use'], originalWhen(w), 'the whole text is what the first edition held');
  const lesson = w.row('rule_changes', TITLE);
  assert.deepEqual([lesson.Status, lesson['Safety check result']], ['Rolled back', 'PASS: examples 11/11, earlier 2/2, yours 2/2']);
  const settings = w.row('agent_settings', 'Claim tagger');
  assert.deepEqual([settings['Rulebook edition'], settings['Last run summary']], ['2026-10-16.3', `Rollback · ${stampOf(NOW)} · ${TITLE}`]);

  const rubric = readJson(join(w.root, 'rubric', 'rubric.json'));
  assert.equal(rubric.edition, '2026-10-16.3');
  assert.equal(rubric.tags.find((t) => t.name === 'Context-dependent').rules[3].text, RULE4);
  assert.equal(rubric.rubric_hash, readJson(join(w.root, 'rubric', 'history', '2026-10-16.1.json')).rubric_hash, 'the rules are those of the first edition again');
  assert.deepEqual(readdirSync(join(w.root, 'rubric', 'history')).sort(), ['2026-10-16.1.json', '2026-10-16.2.json', '2026-10-16.3.json'], 'nothing was removed');
  assert.equal(readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8').trim().split('\n').at(-1), `- 2026-10-16 · edition 2026-10-16.3 · rolled back ${TITLE}`);
  assert.equal(readJson(join(w.root, 'rubric', 'rubric.lock')).text['Context-dependent'], w.row('rulebook', 'Context-dependent')['When to use']);
  const drift = readJson(join(w.root, 'runs', 'pull', (await w.pull()).pullId, 'drift.json'));
  assert.deepEqual([drift.judged.length, drift.adopted.length, drift.missing.length], [0, 0, 0]);

  const report = assertReport(h, r);
  assert.equal(report.sentence, 'Rollback: rule 4 of Context-dependent is back to its earlier text (edition 2026-10-16.3).');
  assert.equal(report.next, 'Next: type /claim-tagger status to see what is open.');
  const plan = readJsonl(join(r.runDir, 'plan.jsonl')).rows.slice(1);
  assert.deepEqual(plan.map((op) => op.table), ['rulebook'], 'the Rulebook copy is written first and alone');
  const bookkeeping = readJsonl(join(`${r.runDir}-record`, 'plan.jsonl')).rows.slice(1);
  assert.deepEqual(bookkeeping.map((op) => op.table), ['rule_changes', 'agent_settings']);
  assert.deepEqual(Object.keys(bookkeeping[0].properties), ['Status'], 'the Safety check result is not rewritten');
  for (const req of w.writes()) for (const col of ['Tag outcome', 'Why wrong', 'Your reasoning', 'Editor wording', 'Paused']) assert.ok(!Object.keys(req.body?.properties ?? {}).includes(col));
});

test('rollback: the commit of the rubric folder in production, and none with --no-commit', async () => {
  const gitCalls = [];
  const git = (args) => {
    gitCalls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  };
  const w = await afterPass();
  assert.equal((await rollback(w.hooks({ lesson: TITLE, confirm: true, git, noCommit: false }))).exit, 0);
  assert.deepEqual(gitCalls, [['add', 'agents/claim-tagger-mvp/rubric'], ['commit', '-m', `rulebook edition 2026-10-16.3: rolled back ${TITLE}`, '--', 'agents/claim-tagger-mvp/rubric']]);
  gitCalls.length = 0;
  const w2 = await afterPass();
  assert.equal((await rollback(w2.hooks({ lesson: TITLE, confirm: true, git, noCommit: true }))).exit, 0);
  assert.deepEqual(gitCalls, []);
});

test('rollback: only a Live rule change can be rolled back, and the title is required', async () => {
  const w = await promoteWorld();
  const h = w.hooks({ lesson: TITLE, confirm: true });
  const r = await rollback(h);
  assert.equal(r.exit, 2);
  const report = assertReport(h, r);
  assert.equal(report.sentence, `Rollback: nothing was done, because "${TITLE}" is approved, not live.`);
  assert.equal(w.writes().length, 0);

  const missing = await rollback(w.hooks({ confirm: true }));
  assert.equal(missing.exit, 2);
  assert.equal(missing.report.sentence, 'Rollback: nothing was done, because it needs the title of the rule change to roll back.');

  const again = await afterPass();
  assert.equal((await rollback(again.hooks({ lesson: TITLE, confirm: true }))).exit, 0);
  const twice = await rollback(again.hooks({ lesson: TITLE, confirm: true }));
  assert.equal(twice.exit, 2, 'a rolled back lesson cannot be rolled back again');
  assert.equal(twice.report.sentence, `Rollback: nothing was done, because "${TITLE}" is rolled back, not live.`);
});

test('rollback: a rule that has changed since the lesson went live is not rolled back over the later change', async () => {
  const w = await afterPass();
  const NEW_B = 'Test: a reference that reads as general needs no answer; a title alone is general; every other definite reference must point at one specific thing, named in the claim.';
  for (const i of [3, 4]) w.fake.editRow(w.ids.queue[keyOf(i)], readingCells('Rule unclear')); // the later change rests on these two rows, so they point at a rule (decision 79)
  w.fake.addRow(w.DB.rule_changes, {
    Lesson: 'A title is general', Tag: 'Context-dependent', Rule: 'Context-dependent rule 4', Kind: 'Clarify wording', 'Current text': NEW_TEXT, 'Proposed text': NEW_B,
    'Supporting rows': `${claimText(3)} · ${keyOf(3)}\n${claimText(4)} · ${keyOf(4)}`, Status: 'Approved',
  });
  const no = { decision: 'do_not_apply', p: 0.1 };
  w.overrides([{ when: 'named in the claim', table: { [claimText(1)]: no, [claimText(2)]: no } }, { when: MARK, table: { [claimText(1)]: no, [claimText(2)]: no } }]);
  assert.equal((await promote(w.hooks({ lesson: 'A title is general' }))).exit, 0);
  assert.equal(w.rubric().edition, '2026-10-16.3');

  const h = w.hooks({ lesson: TITLE, confirm: true });
  const refused = await rollback(h);
  assert.equal(refused.exit, 2);
  assert.equal(assertReport(h, refused).sentence, `Rollback: nothing was done, because rule 4 of Context-dependent has changed since "${TITLE}" went live.`);
  assert.equal(refused.report.next, 'Next: roll back the later change first.');

  assert.equal((await rollback(w.hooks({ lesson: 'A title is general', confirm: true }))).exit, 0, 'the later change first');
  assert.equal(rule4(w), `4. ${NEW_TEXT}`);
  assert.equal((await rollback(w.hooks({ lesson: TITLE, confirm: true }))).exit, 0, 'then the earlier one');
  assert.equal(rule4(w), `4. ${RULE4}`);
  assert.equal(w.rubric().edition, '2026-10-16.5');
});

test('rollback: a paused agent, a drift of the rulebook text and a rulebook text edited while it ran all stop it before the rulebook is written', async () => {
  const paused = await afterPass();
  paused.setPaused(true);
  const rp = await rollback(paused.hooks({ lesson: TITLE, confirm: true }));
  assert.equal(rp.exit, 3);
  assert.equal(rp.report.sentence, 'Rollback: nothing was done, because the agent is paused.');

  const drifted = await afterPass();
  drifted.fake.editRow(drifted.ids.tag['Context-dependent'], { Counterpart: 'Somebody renamed it' });
  const rd = await rollback(drifted.hooks({ lesson: TITLE, confirm: true }));
  assert.equal(rd.exit, 4);
  assert.match(rd.report.sentence, /\(Context-dependent: Counterpart\)\.$/);
  assert.equal(drifted.row('rule_changes', TITLE).Status, 'Live');
});

test('rollback: the rule changes status moves only to Rolled back, in the plan that the check accepts', async () => {
  const w = await afterPass();
  const r = await rollback(w.hooks({ lesson: TITLE, confirm: true }));
  assert.equal(r.exit, 0);
  const req = w.writes().filter((x) => x.method === 'PATCH' && x.body?.properties?.Status).at(-1);
  assert.equal(req.body.properties.Status.select.name, 'Rolled back');
  assert.equal(existsSync(join(w.root, 'runs', 'PROMOTING.json')), false);
});

test('rollback: when the Rulebook copy cannot be written nothing else is; when only the bookkeeping fails the same command finishes the job', async () => {
  const w = await afterPass();
  w.fake.failNext('PATCH', new RegExp(`^/pages/${w.ids.tag['Context-dependent']}`), 400, 1);
  const h = w.hooks({ lesson: TITLE, confirm: true });
  const r = await rollback(h);
  assert.equal(r.exit, 1, h.io.errs.join('\n'));
  assert.equal(r.report.sentence, 'Rollback stopped before every change was written to Notion.');
  assert.equal(rule4(w), `4. ${NEW_TEXT}`);
  assert.equal(w.row('rule_changes', TITLE).Status, 'Live', 'not marked Rolled back over a rulebook text that was not put back');
  assert.equal(w.rubric().edition, '2026-10-16.2');
  assert.equal((await rollback(w.hooks({ lesson: TITLE, confirm: true }))).exit, 0);
  assert.equal(rule4(w), `4. ${RULE4}`);

  const v = await afterPass();
  v.fake.failNext('PATCH', new RegExp(`^/pages/${v.ids.lesson[TITLE]}`), 400, 1);
  const r2 = await rollback(v.hooks({ lesson: TITLE, confirm: true }));
  assert.equal(r2.exit, 1);
  assert.equal(r2.report.sentence, `Rollback stopped: rule 4 of Context-dependent is back to its earlier text (edition 2026-10-16.3), but "${TITLE}" could not be marked Rolled back in Notion.`);
  assert.equal(rule4(v), `4. ${RULE4}`);
  assert.equal(v.rubric().edition, '2026-10-16.3');
  assert.equal(v.row('rule_changes', TITLE).Status, 'Live');
  const again = await rollback(v.hooks({ lesson: TITLE, confirm: true }));
  assert.equal(again.exit, 0, again.markdown);
  assert.equal(v.row('rule_changes', TITLE).Status, 'Rolled back');
  assert.equal(v.rubric().edition, '2026-10-16.3', 'no second edition: the rule was back already');
  assert.equal(again.report.sentence, 'Rollback: rule 4 of Context-dependent is back to its earlier text (edition 2026-10-16.3).');
  assert.equal(v.row('agent_settings', 'Claim tagger')['Last run summary'], `Rollback · ${stampOf(NOW)} · ${TITLE}`);
});

test('rollback: a rule that already reads as its earlier text only marks the rule change as rolled back', async () => {
  const w = await afterPass();
  assert.equal((await restoreTo(w, '2026-10-16.1')).exit, 0, 'a restore put the earlier text back first');
  const dry = await rollback(w.hooks({ lesson: TITLE }));
  assert.equal(dry.exit, 2);
  assert.equal(dry.report.sentence, `Rollback: nothing was changed yet; rule 4 of Context-dependent already reads as its earlier text, so this would only mark "${TITLE}" as rolled back.`);
  const r = await rollback(w.hooks({ lesson: TITLE, confirm: true }));
  assert.equal(r.exit, 0, r.markdown);
  assert.equal(w.row('rule_changes', TITLE).Status, 'Rolled back');
  assert.equal(w.rubric().edition, '2026-10-16.3', 'the restore made edition .3; this made none');
  assert.equal(rule4(w), `4. ${RULE4}`);
});

test('rollback: a bad command line is refused with the usage', async () => {
  const io = { outs: [], errs: [], out: (s) => io.outs.push(s), err: (s) => io.errs.push(s) };
  assert.equal(await main(['--bogus'], io), 2);
  assert.match(io.errs.join('\n'), /usage: node agents\/claim-tagger-mvp\/scripts\/rollback\.mjs/);
  assert.equal(await main(['--help'], io), 0);
  assert.match(io.outs.join('\n'), /--confirm/);
});
