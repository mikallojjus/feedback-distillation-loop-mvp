import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT } from '../../agents/claim-tagger-mvp/scripts/lib/exit-codes.mjs';
import { createClient } from '../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';
import { codeRoot } from '../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';
import { readLedger, readPlan } from '../../agents/claim-tagger-mvp/scripts/lib/plan.mjs';
import {
  RemovedError, addRemoved, dropRemoved, geoKey, readRemoved, removedFile,
} from '../../agents/claim-tagger-mvp/scripts/lib/removed.mjs';
import {
  USAGE, hasEditorValue, main, planRemoval, remove, staleProblems,
} from '../../agents/claim-tagger-mvp/scripts/remove.mjs';
import { DB, makeWorld, quietIo } from './helpers/loop-world.mjs';
import { TABLE_SPECS } from './helpers/tables.mjs';

// remove.mjs (decision P51) on the in-memory Notion: the plan keeps what it must keep and lists the rest with a snapshot, the apply trashes and reads back and can be run again after a stop, the
// restore brings the rows back, and setup/removed-claims.json follows. Nothing here touches the repository's own setup folder: every run has a throw-away state folder.

const FIRST_PAGE = JSON.parse(readFileSync(join(codeRoot(), 'setup', 'first-page.json'), 'utf8'));
const G = (n) => `${'a'.repeat(30)}${String(n).padStart(2, '0')}`; // a Geo ID: 32 hex characters
const DEMO1 = `de0000${'0'.repeat(25)}1`;
const DEMO2 = `de0000${'0'.repeat(25)}2`;
const TAG = 'Context-dependent';
const key = (geo) => `${geo}::${TAG}`;

/**
 * A world with eleven claims and their Tag decisions rows:
 *   g01 selected          g02 decided (Tag outcome)    g03 decided (Your note)    g04 decided (Agent is right)    g05 cited by a rule change (and the orphan demo row 2 is cited too)
 *   g06 waits for you     g07 g08 done                 g09 two rows (done)        g10 no row at all               DEMO1 a demo claim with a row            DEMO2 only a row, no claim
 * The selection is g01 and g99 (g99 is not in Claims).
 */
async function setup({ relation = false, ...extra } = {}) {
  // with `relation` the Claims table has the column "Tag decisions" (STRUCTURE-V2.md), which lists the rows of each claim
  const tableSpecs = relation ? { claims: { ...TABLE_SPECS.claims, 'Tag decisions': { type: 'relation' } } } : {};
  const w = await makeWorld({
    tableSpecs,
    claims: [...Array.from({ length: 10 }, (_, i) => ({ id: G(i + 1), text: `Claim number ${i + 1} says something about the budget.` })), { id: DEMO1, text: 'A demo claim.' }],
    fakeOptions: { allowTrash: true },
    ...extra,
  });
  const related = {};
  const td = (geo, over = {}, tag = TAG) => {
    const k = `${geo}::${tag}`;
    w.ids.queue[k] = w.fake.addRow(DB.tag_decisions, {
      Claim: `Claim of ${geo.slice(-2)}`, Key: k, Tag: tag, 'Agent proposal': 'Applies', 'Agent status': 'Done', ...(w.ids.claim[geo] ? { 'Open claim': [w.ids.claim[geo]] } : {}), ...over,
    });
    if (relation && w.ids.claim[geo]) {
      related[geo] = [...(related[geo] ?? []), w.ids.queue[k]];
      w.fake.editRow(w.ids.claim[geo], { 'Tag decisions': related[geo] });
    }
    return k;
  };
  td(G(1));
  td(G(2), { 'Tag outcome': 'Applies' });
  td(G(3), { 'Your note': 'I would not tag this.' });
  td(G(4), { 'Agent is right': true });
  td(G(5));
  td(G(6), { 'Agent status': 'Waits for you' });
  td(G(7));
  td(G(8));
  td(G(9));
  td(G(9), {}, 'Other');
  td(DEMO1);
  td(DEMO2);
  w.ids.lesson['Rule one'] = w.fake.addRow(DB.rule_changes, {
    Lesson: 'Rule one', Tag: TAG, Status: 'Live', 'Supporting rows': `Claim number 5 says something · ${key(G(5))}\nA demo claim · ${key(DEMO2)}`,
  });
  return w;
}

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

let files = 0;
const selectionFile = (w, ids = [G(1), 'f'.repeat(32)]) => {
  const file = join(w.root, `selection-${++files}.json`);
  const selection = {
    run_id: 'import-test', created_at: '2026-11-03T09:00:00Z', criteria_file: 'criteria.md', bot_spaces: [],
    claims: ids.map((id, i) => ({
      geo_id: id, space_id: '9'.repeat(32), space: 'U.S. Politics', name: `Claim ${i}`, month: '2026-09', published_at: null, bucket: 'issue', predicted_tags: [TAG], why: 'votes 8/5',
    })),
  };
  writeFileSync(file, JSON.stringify(selection, null, 1));
  return file;
};

const run = (w, command, args = {}, extra = {}) => remove({ ...w.hooks(extra), command, ...args });
const planOf = (w, args = {}, ids) => run(w, 'plan', { keep: selectionFile(w, ids), ...args });
const applyOf = (w, p, extra = {}) => run(w, 'apply', { plan: join(p.runDir, 'plan.jsonl') }, extra);
const readJsonl = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const geoIds = (w, table) => w.fake.plainRows(DB[table]).map((r) => r[table === 'claims' ? 'Geo ID' : 'Key']).sort();
const removedIds = (w) => readRemoved(w.root).entries.map((e) => e.geo_id);
const CLAIMS_TRASHED = [G(6), G(7), G(8), G(9), G(10)];
const ROWS_TRASHED = [key(G(6)), key(G(7)), key(G(8)), key(G(9)), `${G(9)}::Other`];
const patches = (w) => w.fake.requests.filter((r) => r.method === 'PATCH');

// ---- the rules (pure) -----------------------------------------------------------------------------------------------------------------

test('hasEditorValue: Tag outcome, a note that is not blank, or Agent is right ticked; nothing else', () => {
  assert.equal(hasEditorValue({ 'Tag outcome': 'Applies' }), true);
  assert.equal(hasEditorValue({ 'Tag outcome': 'Does not apply' }), true);
  assert.equal(hasEditorValue({ 'Your note': 'x' }), true);
  assert.equal(hasEditorValue({ 'Agent is right': true }), true);
  assert.equal(hasEditorValue({ 'Tag outcome': null, 'Your note': '', 'Agent is right': false }), false);
  assert.equal(hasEditorValue({ 'Your note': '   \n' }), false);
  assert.equal(hasEditorValue({ 'Agent status': 'Waits for you', 'Agent proposal': 'Applies' }), false);
  assert.equal(hasEditorValue(null), false);
});

test('planRemoval: a claim is kept when selected, decided, cited (or waiting, with the flag), listed otherwise; its rows follow it; demo claims and rows without a Geo ID are never listed', () => {
  const claim = (geo, page = `p-${geo}`) => ({ geo_id: geo, page_id: page });
  const row = (geo, over = {}) => ({ Key: key(geo), page_id: `r-${geo}`, 'Tag outcome': null, 'Your note': null, 'Agent is right': false, 'Agent status': 'Done', ...over });
  const claims = [claim(G(1)), claim(G(2)), claim(G(3)), claim(G(4)), claim(G(5)), claim(G(6)), claim(G(7)), claim(DEMO1), claim(''), claim(G(8), ''), claim(G(9).toUpperCase())];
  const queue = [
    row(G(1)), row(G(2), { 'Tag outcome': 'Applies' }), row(G(3), { 'Your note': 'n' }), row(G(4), { 'Agent is right': true }), row(G(5)), row(G(6), { 'Agent status': 'Waits for you' }), row(G(7)),
    row(G(7).replace(/a/g, 'b')), row(DEMO1), row(DEMO2), { Key: 'no-separator', page_id: 'r-x' }, row(G(9)),
  ];
  const lessons = [{ supporting_keys: [key(G(5)), key(DEMO2)] }, { supporting_keys: [] }, {}];
  const selected = new Set([geoKey(G(1)), geoKey(G(3))]);
  const found = planRemoval({ claims, queue, lessons, selected });
  assert.deepEqual(found.kept.selected.map((c) => c.geo_id), [G(1), G(3)], 'selected wins over decided');
  assert.deepEqual(found.kept.decided.map((c) => c.geo_id), [G(2), G(4)]);
  assert.deepEqual(found.kept.cited.map((c) => c.geo_id), [G(5)]);
  assert.deepEqual(found.kept.waiting, [], 'without the flag a waiting claim is not kept for it');
  assert.deepEqual(found.kept.demo.map((c) => c.geo_id), [DEMO1]);
  // G(8) has no page, '' has no Geo ID: never listed; G(9) in capitals is the Geo ID of its row (the key is compared in one form)
  assert.deepEqual(found.trashClaims.map((c) => c.geo_id), [G(6), G(7), G(9).toUpperCase()]);
  assert.deepEqual(found.trashRows.map((r) => r.Key), [key(G(6)), key(G(7)), key(G(9))]);
  assert.equal(found.waitingTrashed, 1);
  assert.deepEqual(found.reasons.get(geoKey(G(3))), ['selected', 'decided']);
  // with the flag: the waiting claim and its row are kept, and counted as waiting
  const keepWaiting = planRemoval({ claims, queue, lessons, selected, keepWaiting: true });
  assert.deepEqual(keepWaiting.kept.waiting.map((c) => c.geo_id), [G(6)]);
  assert.deepEqual(keepWaiting.trashClaims.map((c) => c.geo_id), [G(7), G(9).toUpperCase()]);
  assert.equal(keepWaiting.trashRows.some((r) => r.Key === key(G(6))), false, 'the rows of a kept claim are listed nowhere');
  assert.equal(keepWaiting.waitingTrashed, 0);
  // no listed row is a decided row, and no row of a kept claim is listed
  const kept = new Set([...keepWaiting.kept.selected, ...keepWaiting.kept.decided, ...keepWaiting.kept.cited, ...keepWaiting.kept.waiting, ...keepWaiting.kept.demo].map((c) => geoKey(c.geo_id)));
  for (const r of keepWaiting.trashRows) assert.equal(kept.has(geoKey(r.Key.split('::')[0])), false);
  // a claim that is decided only on its second row is kept with both rows
  const second = planRemoval({ claims: [claim(G(1))], queue: [row(G(1)), { ...row(G(1)), Key: `${G(1)}::Other`, 'Your note': 'x' }], lessons: [], selected: new Set() });
  assert.deepEqual(second.trashClaims, []);
  assert.deepEqual(second.trashRows, []);
});

test('staleProblems: a row that was decided, is cited, waits (with the flag), changed page or got a row the plan does not list; a row that is gone is not checked', () => {
  const ops = [
    { op: 'trash', table: 'tag_decisions', key: key(G(1)), page_id: 'r1' },
    { op: 'trash', table: 'claims', key: G(1), page_id: 'c1' },
    { op: 'trash', table: 'tag_decisions', key: key(G(2)), page_id: 'r2' },
    { op: 'trash', table: 'claims', key: G(2), page_id: 'c2' },
    { op: 'trash', table: 'claims', key: G(3), page_id: 'c3' },
  ];
  const claims = [{ geo_id: G(1), page_id: 'c1' }, { geo_id: G(2), page_id: 'c2-other' }, { geo_id: G(3), page_id: 'c3' }];
  const queue = [
    { Key: key(G(1)), page_id: 'r1', 'Tag outcome': 'Applies' },
    { Key: key(G(2)), page_id: 'r2' },
    { Key: `${G(3)}::Other`, page_id: 'r3', 'Agent status': 'Waits for you' },
  ];
  const lessons = [{ supporting_keys: [key(G(3))] }];
  const problems = staleProblems({ ops, claims, queue, lessons });
  assert.ok(problems.some((p) => /Tag decisions ".*01::Context-dependent" has been decided since the plan was made/.test(p)), problems.join(' | '));
  assert.ok(problems.some((p) => /Claims "a+01" has a Tag decisions row that has been decided/.test(p)));
  assert.ok(problems.some((p) => /Claims "a+02" is another page now/.test(p)));
  assert.ok(problems.some((p) => /Claims "a+03" is cited by a rule change/.test(p)));
  assert.ok(problems.some((p) => /Claims "a+03" has 1 Tag decisions row that the plan does not list/.test(p)));
  assert.equal(problems.some((p) => /waits for an editor/.test(p)), false, 'waiting matters only for a plan made with --keep-waiting');
  assert.ok(staleProblems({ ops, claims, queue, lessons, keepWaiting: true }).some((p) => /Claims "a+03" has a Tag decisions row that waits for an editor now/.test(p)));
  // a done op is not looked at again, and neither is a row that is not in the pull
  assert.deepEqual(staleProblems({ ops, done: new Set(ops.map((o) => `${o.table}\u0000${o.key}`)), claims, queue, lessons }), []);
  assert.deepEqual(staleProblems({ ops, claims: [], queue: [], lessons }), []);
});

test('the list of removed claims: read, merged, sorted, taken out by run; a file that cannot be trusted is an error, not an empty list', () => {
  const w = { root: mkdtempSync(join(tmpdir(), 'geo-agents-mvp-removed-')) };
  dirs.push(w.root);
  assert.equal(removedFile(w.root), join(w.root, 'setup', 'removed-claims.json'));
  assert.deepEqual(readRemoved(w.root), { file: removedFile(w.root), entries: [], ids: new Set() });
  assert.equal(existsSync(removedFile(w.root)), false, 'reading writes nothing');
  addRemoved(w.root, [{ geo_id: G(2), run_id: 'run-a', date: '2026-11-03' }, { geo_id: G(1), run_id: 'run-a', date: '2026-11-03' }]);
  addRemoved(w.root, [{ geo_id: G(3).toUpperCase(), run_id: 'run-b', date: '2026-11-04' }, { geo_id: G(1), run_id: 'run-b', date: '2026-11-04' }]);
  const file = readJson(removedFile(w.root));
  assert.deepEqual(Object.keys(file), ['removed']);
  assert.deepEqual(file.removed.map((e) => e.geo_id), [G(1), G(2), G(3).toUpperCase()], 'sorted by Geo ID');
  assert.deepEqual(file.removed.map((e) => e.run_id), ['run-b', 'run-a', 'run-b'], 'a repeated Geo ID takes the newer run');
  assert.deepEqual([...readRemoved(w.root).ids], [G(1), G(2), G(3)], 'ids are in the comparison form');
  dropRemoved(w.root, 'run-a', [G(2)]);
  assert.deepEqual(removedIds(w), [G(1), G(3).toUpperCase()]);
  dropRemoved(w.root, 'run-b');
  assert.deepEqual(readJson(removedFile(w.root)), { removed: [] }, 'the file stays, with an empty list');
  assert.throws(() => addRemoved(w.root, [{ geo_id: '', run_id: 'r', date: 'd' }]), RemovedError);
  for (const bad of ['{ not json', '[]', '{"removed": "x"}', '{"removed": [{"geo_id": "a"}]}', '{"removed": [1]}']) {
    writeFileSync(removedFile(w.root), bad);
    assert.throws(() => readRemoved(w.root), (e) => e instanceof RemovedError && e.code === 'REMOVED', bad);
  }
});

// ---- plan -----------------------------------------------------------------------------------------------------------------------------

test('plan: lists the claims that are not selected, decided or cited, and their rows; keeps the others and every kept claim\'s rows; writes the plan, the snapshot and the summary; sends queries only', async () => {
  const w = await setup();
  const before = geoIds(w, 'claims').length;
  const p = await planOf(w);
  assert.equal(p.exit, EXIT.OK, w.hooks().io.errs.join('\n'));
  assert.equal(before, 11);

  // the plan: the Tag decisions rows first, then the Claims rows, one trash op each, sorted
  const plan = readPlan(p.runDir);
  assert.equal(plan.header.plan.script, 'remove');
  assert.deepEqual(plan.header.plan.counts, { creates: 0, updates: 0, trashes: 10 });
  assert.deepEqual(plan.ops.map((o) => [o.op, o.table, o.key]), [
    ...[...ROWS_TRASHED].sort().map((k) => ['trash', 'tag_decisions', k]),
    ...CLAIMS_TRASHED.map((k) => ['trash', 'claims', k]),
  ]);
  for (const op of plan.ops) {
    assert.deepEqual(Object.keys(op).sort(), ['key', 'op', 'page_id', 'table']);
    assert.equal(op.page_id, op.table === 'claims' ? w.ids.claim[op.key] : w.ids.queue[op.key], `${op.key} names its own page`);
  }
  // nothing that is kept is listed, in either table: the selected, the three decided, the cited, the demo claim and its row, the orphan demo row, a kept claim's rows
  const listed = new Set(plan.ops.map((o) => o.key));
  for (const kept of [G(1), G(2), G(3), G(4), G(5), DEMO1]) {
    assert.equal(listed.has(kept), false, `${kept} is kept`);
    assert.equal(listed.has(key(kept)), false, `the row of ${kept} is kept`);
  }
  assert.equal(listed.has(key(DEMO2)), false, 'the orphan demo row has no claim in the list');

  // the snapshot: the full page JSON of each row to trash, one per line, one file per table
  const claimSnapshot = readJsonl(join(p.runDir, 'snapshot-claims.jsonl'));
  const rowSnapshot = readJsonl(join(p.runDir, 'snapshot-tag_decisions.jsonl'));
  assert.equal(claimSnapshot.length, 5);
  assert.equal(rowSnapshot.length, 5);
  assert.deepEqual(claimSnapshot.map((x) => x.id).sort(), CLAIMS_TRASHED.map((g) => w.ids.claim[g]).sort());
  assert.deepEqual(rowSnapshot.map((x) => x.id).sort(), ROWS_TRASHED.map((k) => w.ids.queue[k]).sort());
  for (const page of [...claimSnapshot, ...rowSnapshot]) {
    assert.equal(page.object, 'page');
    assert.ok(page.properties && page.parent && page.created_time, 'the whole page object');
  }
  assert.equal(claimSnapshot.find((x) => x.id === w.ids.claim[G(6)]).properties['Geo ID'].rich_text[0].plain_text, G(6));

  // the summary and the run record
  const summary = readJson(join(p.runDir, 'summary.json'));
  assert.deepEqual(summary.trash, { claims: 5, tag_decisions: 5, claims_with_a_waiting_row: 1 });
  assert.deepEqual(summary.kept, { selected: 1, decided: 3, cited: 1, waiting: 0, demo: 1 });
  assert.equal(summary.keep_waiting, false);
  assert.equal(summary.claims_before, 11);
  assert.equal(summary.claims_after, 6);
  assert.deepEqual(summary.selection, { claims: 2, in_claims: 1, not_in_claims: 1 });
  assert.deepEqual(summary.kept_claims.find((c) => c.geo_id === G(2)).reasons, ['decided']);
  assert.deepEqual(summary.kept_claims.find((c) => c.geo_id === G(5)).reasons, ['cited']);
  assert.deepEqual(summary.kept_claims.find((c) => c.geo_id === DEMO1).reasons, ['demo']);

  // the report: counts of what goes, what stays and why, and what remains
  assert.equal(p.report.sentence, 'Remove: 5 Claims rows and 5 Tag decisions rows would go to the trash; 5 claims stay for a reason, and 6 Claims rows remain.');
  assert.deepEqual(p.report.rows, [
    ['To trash', '5 Claims rows, 5 Tag decisions rows', ''],
    ['Claims kept: in the selection', '1', ''],
    ['Claims kept: decided by an editor', '3', ''],
    ['Claims kept: cited by a rule change', '1', ''],
  ]);
  assert.equal(p.report.next, 'Next: check the counts, then apply the plan.');

  // it only read: the pull's queries, no write, and the tables are as they were
  assert.deepEqual(w.fake.writes(), []);
  assert.equal(w.fake.trashed(DB.claims).length, 0);
  assert.equal(geoIds(w, 'claims').length, 11);
  assert.equal(geoIds(w, 'tag_decisions').length, 12);
});

test('plan prints the report and the lines the engineer needs: the plan, the snapshot, the selection and the command to apply it', async () => {
  const w = await setup();
  const h = w.hooks();
  const r = await remove({ ...h, command: 'plan', keep: selectionFile(w) });
  assert.equal(r.exit, EXIT.OK);
  const printed = h.io.outs.join('\n');
  assert.match(printed, /^Remove: 5 Claims rows and 5 Tag decisions rows would go to the trash/);
  assert.match(printed, /\| To trash \| 5 Claims rows, 5 Tag decisions rows \|/);
  assert.match(printed, /plan: .*plan\.jsonl/);
  assert.match(printed, /snapshot: .*snapshot-tag_decisions\.jsonl , .*snapshot-claims\.jsonl/);
  assert.match(printed, /selection: 2 claims, 1 in Claims, 1 NOT in Claims/);
  assert.match(printed, /demo rows kept: 1; Claims rows now: 11/);
  assert.match(printed, /1 of the 5 claims to trash have a Tag decisions row that waits for an editor .*--keep-waiting/);
  assert.match(printed, /to apply: node agents\/claim-tagger-mvp\/scripts\/remove\.mjs apply --plan /);
});

test('plan --keep-waiting: a claim with a Tag decisions row that waits for an editor stays with its rows, and the count has its own row', async () => {
  const w = await setup();
  const h = w.hooks();
  const p = await remove({ ...h, command: 'plan', keep: selectionFile(w), keepWaiting: true });
  assert.equal(p.exit, EXIT.OK, h.io.errs.join('\n'));
  const plan = readPlan(p.runDir);
  const listed = new Set(plan.ops.map((o) => o.key));
  assert.equal(listed.has(G(6)), false, 'the waiting claim is kept');
  assert.equal(listed.has(key(G(6))), false, 'and so is its row');
  assert.deepEqual(plan.ops.filter((o) => o.table === 'claims').map((o) => o.key), [G(7), G(8), G(9), G(10)]);
  assert.deepEqual(plan.header.plan.counts.trashes, 8);
  const summary = readJson(join(p.runDir, 'summary.json'));
  assert.equal(summary.keep_waiting, true);
  assert.deepEqual(summary.kept, { selected: 1, decided: 3, cited: 1, waiting: 1, demo: 1 });
  assert.deepEqual(summary.trash, { claims: 4, tag_decisions: 4, claims_with_a_waiting_row: 0 });
  assert.deepEqual(summary.kept_claims.find((c) => c.geo_id === G(6)).reasons, ['waiting']);
  assert.equal(p.report.sentence, 'Remove: 4 Claims rows and 4 Tag decisions rows would go to the trash; 6 claims stay for a reason, and 7 Claims rows remain.');
  assert.deepEqual(p.report.rows, [
    ['To trash', '4 Claims rows, 4 Tag decisions rows', ''],
    ['Claims kept: in the selection', '1', ''],
    ['Claims kept: decided by an editor', '3', ''],
    ['Claims kept: cited by a rule change', '1', ''],
    ['Claims kept: waiting for an editor', '1', ''],
  ]);
  assert.doesNotMatch(h.io.outs.join('\n'), /plan again with --keep-waiting/, 'the hint is for a plan made without the flag');
  assert.equal(readJson(join(p.runDir, 'run.json')).args.keep_waiting, true);
  assert.match(readJson(join(p.runDir, 'run.json')).resume, /remove\.mjs plan --keep ".*selection-\d+\.json" --keep-waiting$/);

  // a claim whose only row is Done is listed even with the flag, and a waiting claim that is also selected or decided counts under that reason first
  const w2 = await setup();
  w2.decideRow(key(G(6)), { outcome: 'Applies' });
  const p2 = await remove({ ...w2.hooks(), command: 'plan', keep: selectionFile(w2), keepWaiting: true });
  assert.deepEqual(readJson(join(p2.runDir, 'summary.json')).kept, { selected: 1, decided: 4, cited: 1, waiting: 0, demo: 1 });
});

test('plan: a selection that lists everything in Claims leaves nothing to remove: exit 0, no plan', async () => {
  const w = await setup();
  const all = [...Array.from({ length: 10 }, (_, i) => G(i + 1)), DEMO1];
  const p = await planOf(w, {}, all);
  assert.equal(p.exit, EXIT.OK);
  assert.equal(p.report.sentence, 'Remove: nothing to remove; every claim in Claims is selected, decided, cited or a demo row.');
  assert.equal(existsSync(join(p.runDir, 'plan.jsonl')), false);
  assert.deepEqual(w.fake.writes(), []);
});

test('plan refuses a selection that is not valid before it reads anything, and one of which no claim is in Claims', async () => {
  const w = await setup();
  const before = w.fake.requests.length;
  const bad = join(w.root, 'bad-selection.json');
  for (const text of ['{ not json', '{}', JSON.stringify({ run_id: 'x', created_at: 'now', criteria_file: 'c', bot_spaces: [], claims: [] })]) {
    writeFileSync(bad, text);
    const r = await run(w, 'plan', { keep: bad });
    assert.equal(r.exit, EXIT.INVALID, text);
    assert.equal(r.report.sentence, 'Remove: nothing was read or planned, because the selection file is not valid.');
    assert.equal(r.report.next, 'Next: correct the selection file and run it again.');
  }
  const twice = selectionFile(w, [G(1), G(1)]);
  assert.equal((await run(w, 'plan', { keep: twice })).exit, EXIT.INVALID);
  assert.equal((await run(w, 'plan', { keep: join(w.root, 'there-is-no-such-file.json') })).exit, EXIT.INVALID);
  assert.equal(w.fake.requests.length, before, 'not one request to Notion');

  const none = await planOf(w, {}, ['e'.repeat(32), 'f'.repeat(32)]);
  assert.equal(none.exit, EXIT.INVALID);
  assert.equal(none.report.sentence, 'Remove: nothing was planned, because none of the selected claims is in Claims yet.');
  assert.equal(existsSync(join(none.runDir, 'plan.jsonl')), false, 'no plan is written for a selection that matches nothing');
  assert.deepEqual(w.fake.writes(), []);
});

test('plan and apply stop on the pause and on a root that is the first page\'s or a practice page', async () => {
  const w = await setup();
  w.setPaused(true);
  const paused = await planOf(w);
  assert.equal(paused.exit, EXIT.PAUSED);
  assert.equal(existsSync(join(paused.runDir, 'plan.jsonl')), false);
  w.setPaused(false);
  const p = await planOf(w);
  assert.equal(p.exit, EXIT.OK);
  w.setPaused(true);
  const stopped = await applyOf(w, p);
  assert.equal(stopped.exit, EXIT.PAUSED);
  assert.equal(w.fake.trashed(DB.claims).length, 0);
  assert.deepEqual(patches(w), []);
  w.setPaused(false);
  writeFileSync(join(w.root, 'runs', 'PAUSED'), 'paused');
  assert.equal((await applyOf(w, p)).exit, EXIT.PAUSED, 'the PAUSED file stops it too');
  assert.deepEqual(patches(w), []);

  // the first page's tables as the target: refused before one request
  const w2 = await setup();
  const first = structuredClone(w2.config);
  first.notion.claims.database_id = FIRST_PAGE.tables.claims.database_id;
  const before = w2.fake.requests.length;
  const r = await run(w2, 'plan', { keep: selectionFile(w2) }, { config: first });
  assert.equal(r.exit, EXIT.INVALID);
  assert.match(r.report.sentence, /^Remove: nothing was done, because the tables of this folder are the first page's/);
  assert.equal(w2.fake.requests.length, before);
  assert.equal((await run(w2, 'apply', { plan: join(p.runDir, 'plan.jsonl') }, { config: first })).exit, EXIT.INVALID);
  assert.equal((await run(w2, 'restore', { run: p.runId }, { config: first })).exit, EXIT.INVALID);

  // a practice page, a config that is not the v2 profile
  const demo = structuredClone(w2.config);
  demo.demo = true;
  const d = await run(w2, 'plan', { keep: selectionFile(w2) }, { config: demo });
  assert.equal(d.exit, EXIT.INVALID);
  assert.match(d.report.sentence, /works only on the real tables of the v2 page/);
  const old = structuredClone(w2.config);
  delete old.profile;
  assert.equal((await run(w2, 'plan', { keep: selectionFile(w2) }, { config: old })).exit, EXIT.INVALID);
  assert.deepEqual(w2.fake.writes(), []);
});

// ---- apply ----------------------------------------------------------------------------------------------------------------------------

test('apply: trashes every listed row, reads each back as trashed, ledgers it, writes the list of removed claims, and leaves every kept row alone', async () => {
  const w = await setup();
  const p = await planOf(w);
  const a = await applyOf(w, p);
  assert.equal(a.exit, EXIT.OK, w.hooks().io.errs.join('\n'));
  assert.equal(a.report.sentence, 'Remove: 5 Claims rows and 5 Tag decisions rows are in the trash, and every row was read back.');
  assert.deepEqual(a.report.rows, [
    ['Claims rows in the trash', '5', ''],
    ['Tag decisions rows in the trash', '5', ''],
    ['Claims recorded as removed', '5', ''],
  ]);

  // Notion: the listed rows are in the trash (every page says so), the rest is as it was
  assert.deepEqual(w.fake.trashed(DB.claims).sort(), CLAIMS_TRASHED.map((g) => w.ids.claim[g]).sort());
  assert.deepEqual(w.fake.trashed(DB.tag_decisions).sort(), ROWS_TRASHED.map((k) => w.ids.queue[k]).sort());
  for (const id of [...w.fake.trashed(DB.claims), ...w.fake.trashed(DB.tag_decisions)]) assert.equal(w.fake.page(id).in_trash, true);
  assert.deepEqual(geoIds(w, 'claims'), [G(1), G(2), G(3), G(4), G(5), DEMO1].sort());
  assert.deepEqual(geoIds(w, 'tag_decisions'), [key(G(1)), key(G(2)), key(G(3)), key(G(4)), key(G(5)), key(DEMO1), key(DEMO2)].sort());
  assert.equal(w.row('tag_decisions', key(G(2)))['Tag outcome'], 'Applies', 'a decision is untouched');
  assert.equal(w.row('tag_decisions', key(G(3)))['Your note'], 'I would not tag this.');
  assert.equal(w.row('tag_decisions', key(G(4)))['Agent is right'], true);

  // what was sent: ten PATCHes of the flag and nothing else that writes; the sends are the ledger's
  assert.equal(patches(w).length, 10);
  for (const q of patches(w)) assert.deepEqual(q.body, { archived: true });
  assert.equal(w.fake.writes().length, 10);
  const ledger = [...readLedger(p.runDir).values()];
  assert.equal(ledger.length, 10);
  assert.ok(ledger.every((l) => l.op === 'trash' && l.status === 'done' && l.read_back === 'ok'));

  // the list of removed claims
  const list = readJson(join(w.root, 'setup', 'removed-claims.json'));
  assert.deepEqual(list.removed.map((e) => e.geo_id), CLAIMS_TRASHED);
  assert.ok(list.removed.every((e) => e.run_id === p.runId && e.date === '2026-10-16'));
  assert.deepEqual(Object.keys(list.removed[0]), ['geo_id', 'run_id', 'date']);

  // the run record, and the next apply of the same plan sends nothing
  assert.equal(readJson(join(a.runDir, 'run.json')).exit_code, 0);
  const sent = w.fake.writes().length;
  const again = await applyOf(w, p);
  assert.equal(again.exit, EXIT.OK);
  assert.equal(w.fake.writes().length, sent, 'nothing is sent again');
  assert.equal(removedIds(w).length, 5);
  // a new plan after the removal finds nothing to remove
  const next = await planOf(w);
  assert.equal(next.exit, EXIT.OK);
  assert.match(next.report.sentence, /nothing to remove/);
});

test('apply takes the plan from its file, its folder or its run id', async () => {
  const w = await setup();
  const p = await planOf(w);
  const viaFolder = await run(w, 'apply', { plan: p.runDir });
  assert.equal(viaFolder.exit, EXIT.OK, w.hooks().io.errs.join('\n'));
  const viaId = await run(w, 'apply', { plan: p.runId });
  assert.equal(viaId.exit, EXIT.OK);
  const missing = await run(w, 'apply', { plan: join(w.root, 'runs', 'there-is-none', 'plan.jsonl') });
  assert.equal(missing.exit, EXIT.INVALID);
  assert.equal(missing.report.sentence, 'Remove: nothing was done, because that plan does not exist.');
  assert.equal((await run(w, 'apply', { plan: 'no-such-run' })).exit, EXIT.INVALID);
});

test('apply refuses a plan that another script made, one that holds more than trashes, and one that breaks the check, before it reads or sends anything', async () => {
  const w = await setup();
  const p = await planOf(w);
  const lines = readFileSync(join(p.runDir, 'plan.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const fork = (name, change) => {
    const dir = join(w.root, 'runs', name);
    mkdirSync(dir, { recursive: true });
    const copy = structuredClone(lines);
    change(copy);
    writeFileSync(join(dir, 'plan.jsonl'), `${copy.map((l) => JSON.stringify(l)).join('\n')}\n`);
    return join(dir, 'plan.jsonl');
  };
  const before = w.fake.requests.length;
  const another = fork('other-script', (c) => { c[0].plan.script = 'propose'; });
  assert.equal((await run(w, 'apply', { plan: another })).exit, EXIT.INVALID);
  const protectedId = fork('protected', (c) => { c[1].page_id = '3da273e214eb80c180d5fd0894bc2db8'; });
  const r = await run(w, 'apply', { plan: protectedId });
  assert.equal(r.exit, EXIT.INVALID);
  assert.equal(r.report.sentence, 'Remove: nothing was done, because the plan breaks a rule about what may be trashed.');
  const firstPage = fork('first-page', (c) => { c[2].page_id = FIRST_PAGE.tables.claims.database_id; });
  assert.equal((await run(w, 'apply', { plan: firstPage })).exit, EXIT.INVALID);
  const otherTable = fork('other-table', (c) => { c[1].table = 'rule_changes'; });
  assert.equal((await run(w, 'apply', { plan: otherTable })).exit, EXIT.INVALID);
  const update = fork('update', (c) => { c[1] = { op: 'update', table: 'claims', key: G(6), page_id: w.ids.claim[G(6)], properties: { 'Agent edition': 'x' } }; c[0].plan.counts = { creates: 0, updates: 1, trashes: 9 }; });
  assert.equal((await run(w, 'apply', { plan: update })).exit, EXIT.INVALID);
  assert.equal(w.fake.requests.length, before, 'not one request');
  assert.deepEqual(patches(w), []);
});

test('apply: a row that was decided, a claim that is cited, a row that waits (with the flag) or one that is new, since the plan was made, makes the plan out of date: exit 2, nothing is sent', async () => {
  const cases = [
    ['decided', (w) => w.decideRow(key(G(7)), { outcome: 'Applies' }), /Tag decisions ".*07::Context-dependent" has been decided since the plan was made/],
    ['note', (w) => w.decideRow(key(G(8)), { note: 'a word' }), /has been decided since the plan was made/],
    ['ticked', (w) => w.decideRow(key(G(9)), { right: true }), /has been decided since the plan was made/],
    ['cited', (w) => w.fake.addRow(DB.rule_changes, { Lesson: 'Rule two', Tag: TAG, Status: 'Proposed', 'Supporting rows': `Claim number 10 · ${key(G(10))}` }), /Claims "a+10" is cited by a rule change/],
    ['a new row', (w) => w.fake.addRow(DB.tag_decisions, { Claim: 'New', Key: `${G(10)}::Other`, Tag: 'Other', 'Open claim': [w.ids.claim[G(10)]] }), /Claims "a+10" has 1 Tag decisions row that the plan does not list/],
  ];
  for (const [label, change, re] of cases) {
    const w = await setup();
    const p = await planOf(w);
    change(w);
    const before = w.fake.writes().length;
    const a = await applyOf(w, p);
    assert.equal(a.exit, EXIT.INVALID, label);
    assert.match(a.report.sentence, /^Remove: nothing was removed, because \d+ rows? changed since the plan was made\.$/, label);
    assert.equal(a.report.next, 'Next: make a new plan.');
    assert.match(readJson(join(a.runDir, 'run.json')).stale.join(' | '), re, label);
    assert.equal(w.fake.writes().length, before, `${label}: nothing was sent`);
    assert.deepEqual(w.fake.trashed(DB.claims), []);
    assert.equal(existsSync(join(w.root, 'setup', 'removed-claims.json')), false);
  }

  // a plan made with --keep-waiting is out of date when a row waits now; one made without it is not
  const w = await setup();
  const kept = await remove({ ...w.hooks(), command: 'plan', keep: selectionFile(w), keepWaiting: true });
  w.fake.editRow(w.ids.queue[key(G(7))], { 'Agent status': 'Waits for you' });
  const stale = await applyOf(w, kept);
  assert.equal(stale.exit, EXIT.INVALID);
  assert.match(readJson(join(stale.runDir, 'run.json')).stale.join(' | '), /waits for an editor now/);
  assert.deepEqual(patches(w), []);
  const plain = await planOf(w);
  w.fake.editRow(w.ids.queue[key(G(8))], { 'Agent status': 'Waits for you' });
  assert.equal((await applyOf(w, plain)).exit, EXIT.OK, 'a plan made without the flag does not mind a waiting row');
});

test('apply stops when a row was decided between the look and the trash, and trashes nothing after it', async () => {
  const w = await setup();
  const p = await planOf(w);
  // an editor decides G(8)'s row after the apply has pulled: it is the third row of the plan (G(6), G(7), G(8)), so two rows are trashed and the run stops there
  const real = w.fake.fetchImpl;
  let decided = false;
  const fetchImpl = async (url, init) => {
    const target = w.ids.queue[key(G(8))].replace(/-/g, '');
    if (!decided && init.method === 'GET' && String(url).replace(/-/g, '').endsWith(`/pages/${target}`)) {
      decided = true;
      w.fake.editRow(w.ids.queue[key(G(8))], { 'Your note': 'decided just now' });
    }
    return real(url, init);
  };
  // the pull and the writes share this fetch; the decision lands on the first GET of that row, which is the apply's last look at it
  const a = await run(w, 'apply', { plan: join(p.runDir, 'plan.jsonl') }, { fetchImpl });
  assert.equal(decided, true);
  assert.equal(a.exit, EXIT.INVALID);
  assert.match(a.report.sentence, /^Remove: stopped, because a Tag decisions row was decided while the plan ran;/);
  assert.equal(a.report.next, 'Next: make a new plan.');
  assert.equal(w.row('tag_decisions', key(G(8)))['Your note'], 'decided just now', 'the decided row is live');
  assert.equal(w.fake.trashed(DB.tag_decisions).includes(w.ids.queue[key(G(8))]), false);
  assert.deepEqual(w.fake.trashed(DB.claims), [], 'no claim was trashed');
  assert.equal(existsSync(join(w.root, 'setup', 'removed-claims.json')), false);
});

test('apply goes on after a stop: the rows that were done are not sent again, and the list of removed claims has the claims that were done even after a stop', async () => {
  const w = await setup();
  const p = await planOf(w);
  // G(10) cannot be trashed the first time: its PATCH fails on every attempt, the others go through
  w.fake.failNext('PATCH', new RegExp(w.ids.claim[G(10)]), 500, 4);
  const first = await applyOf(w, p);
  assert.equal(first.exit, EXIT.ERROR);
  assert.equal(first.report.next, 'Next: run the same apply command again; it continues where it stopped.');
  assert.match(first.report.sentence, /^Remove stopped before every row was trashed: 4 Claims rows and 5 Tag decisions rows are in the trash so far\.$/);
  assert.deepEqual(w.fake.trashed(DB.claims).length, 4);
  assert.deepEqual(removedIds(w), [G(6), G(7), G(8), G(9)], 'the claims that are in the trash are recorded after a stop');
  const okFirst = patches(w).filter((q) => q.status === 200).length;
  assert.equal(okFirst, 9);

  const second = await applyOf(w, p);
  assert.equal(second.exit, EXIT.OK, w.hooks().io.errs.join('\n'));
  assert.equal(second.report.sentence, 'Remove: 5 Claims rows and 5 Tag decisions rows are in the trash, and every row was read back.');
  const ok = patches(w).filter((q) => q.status === 200);
  assert.equal(ok.length, 10, 'one more PATCH, for the one that was left');
  assert.equal(new Set(ok.map((q) => q.path)).size, 10, 'no page was sent twice');
  assert.deepEqual(removedIds(w), CLAIMS_TRASHED);

  // three rows that fail in a row end the run, and the next one sends the rest
  const v = await setup();
  const pv = await planOf(v);
  v.fake.failNext('PATCH', /\/pages\//, 500, 12);
  const stopped = await applyOf(v, pv);
  assert.equal(stopped.exit, EXIT.ERROR);
  assert.equal(readJson(join(stopped.runDir, 'run.json')).apply.stopped.reason, 'failures_in_a_row');
  assert.equal(existsSync(join(v.root, 'setup', 'removed-claims.json')), false, 'no claim was trashed, so none is recorded');
  assert.equal((await applyOf(v, pv)).exit, EXIT.OK);
  assert.equal(patches(v).filter((q) => q.status === 200).length, 10);
});

test('apply: a Notion that does not show a row as trashed after the PATCH is exit 2, and the list of removed claims has only the claims that read back', async () => {
  const w = await setup();
  const p = await planOf(w);
  // the answer to a GET of one claim says it is live, whatever was sent
  const real = w.fake.fetchImpl;
  const liar = async (url, init) => {
    const res = await real(url, init);
    if (init.method === 'GET' && String(url).replace(/-/g, '').endsWith(`/pages/${w.ids.claim[G(9)].replace(/-/g, '')}`)) {
      const body = await res.json();
      return new Response(JSON.stringify({ ...body, in_trash: false, archived: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return res;
  };
  const a = await run(w, 'apply', { plan: join(p.runDir, 'plan.jsonl') }, { fetchImpl: liar });
  assert.equal(a.exit, EXIT.INVALID);
  assert.match(a.report.sentence, /^Remove stopped: Notion does not show one row as trashed after it was sent\.$/);
  assert.equal(removedIds(w).includes(G(9)), false);
  assert.ok(removedIds(w).includes(G(10)));
});

test('apply: a claim waits for its rows: a row that cannot be trashed leaves its claim, the run ends with exit 1 naming the claim, and the same command finishes it; the list of removed claims has only the claims that are in the trash', async () => {
  const w = await setup({ relation: true });
  const p = await planOf(w);
  w.fake.failNext('PATCH', new RegExp(w.ids.queue[key(G(6))]), 500, 4);
  const h = w.hooks();
  const a = await remove({ ...h, command: 'apply', plan: join(p.runDir, 'plan.jsonl') });
  assert.equal(a.exit, EXIT.ERROR);
  assert.match(a.report.sentence, /^Remove stopped before every row was trashed: 4 Claims rows and 4 Tag decisions rows are in the trash so far; 1 claim stays until its rows are trashed\.$/);
  assert.equal(a.report.next, 'Next: run the same apply command again; it continues where it stopped.');
  assert.match(h.io.errs.join('\n'), new RegExp(`1 claim left alone because a Tag decisions row of it is not in the trash \\(${G(6)}\\)`));
  assert.deepEqual(readJson(join(a.runDir, 'run.json')).apply.blocked_claims, [G(6)]);
  assert.deepEqual(w.fake.trashed(DB.claims).sort(), [G(7), G(8), G(9), G(10)].map((g) => w.ids.claim[g]).sort());
  assert.equal(w.fake.trashed(DB.claims).includes(w.ids.claim[G(6)]), false);
  assert.equal(w.fake.requests.some((r) => r.method !== 'GET' && r.path.includes(w.ids.claim[G(6)])), false, 'nothing was sent to the claim');
  assert.deepEqual(removedIds(w), [G(7), G(8), G(9), G(10)], 'the claim that is not in the trash is not on the list');

  const b = await applyOf(w, p);
  assert.equal(b.exit, EXIT.OK, w.hooks().io.errs.join('\n'));
  assert.deepEqual(removedIds(w), CLAIMS_TRASHED);
  const ok = patches(w).filter((q) => q.status === 200);
  assert.equal(ok.length, 10);
  assert.equal(new Set(ok.map((q) => q.path)).size, 10, 'no page was sent twice');
});

test('apply reads a claim\'s page before it trashes it: a row of the claim that was created after the pull and is live keeps the claim (exit 1), and the same command finishes it once the row is in the trash', async () => {
  const w = await setup({ relation: true });
  const p = await planOf(w);
  let late = null;
  const real = w.fake.fetchImpl;
  const fetchImpl = async (url, init) => {
    if (late === null && init.method === 'GET' && String(url).endsWith(`/pages/${w.ids.claim[G(7)]}`)) {
      late = w.fake.addRow(DB.tag_decisions, { Claim: 'Late', Key: `${G(7)}::Late`, Tag: 'Late', 'Open claim': [w.ids.claim[G(7)]] });
      w.fake.editRow(w.ids.claim[G(7)], { 'Tag decisions': [w.ids.queue[key(G(7))], late] });
    }
    return real(url, init);
  };
  const h = w.hooks({ fetchImpl });
  const a = await remove({ ...h, command: 'apply', plan: join(p.runDir, 'plan.jsonl') });
  assert.ok(late);
  assert.equal(a.exit, EXIT.ERROR);
  assert.match(h.io.errs.join('\n'), new RegExp(`1 claim left alone because a Tag decisions row of it is not in the trash \\(${G(7)}\\)`));
  assert.match(h.io.errs.join('\n'), new RegExp(`not trashed: the Tag decisions row ${late} of this claim is not in the trash`));
  assert.equal(w.fake.trashed(DB.claims).includes(w.ids.claim[G(7)]), false);
  assert.equal(w.fake.trashed(DB.claims).length, 4);
  assert.equal(removedIds(w).includes(G(7)), false);
  // the late row is a row of a claim the plan lists but not a row the plan lists: a new apply of this plan is out of date until the row is gone
  const stale = await applyOf(w, p);
  assert.equal(stale.exit, EXIT.INVALID);
  assert.match(readJson(join(stale.runDir, 'run.json')).stale.join(' | '), /Claims "a+07" has 1 Tag decisions row that the plan does not list/);
  const client = createClient({ token: w.fake.token, fetchImpl: w.fake.fetchImpl, requestsPerSecond: 1000, sleep: async () => {} });
  await client.trashPage(late);
  const done = await applyOf(w, p);
  assert.equal(done.exit, EXIT.OK, w.hooks().io.errs.join('\n'));
  assert.deepEqual(removedIds(w), CLAIMS_TRASHED);
});

test('apply stops between two rows when runs/PAUSED appears (exit 3), keeps what is done, and goes on when the pause is cleared', async () => {
  const w = await setup();
  const p = await planOf(w);
  const real = w.fake.fetchImpl;
  let sent = 0;
  const fetchImpl = async (url, init) => {
    const res = await real(url, init);
    if (init.method === 'PATCH' && /\/pages\//.test(String(url))) {
      sent += 1;
      if (sent === 4) writeFileSync(join(w.root, 'runs', 'PAUSED'), 'a person paused the agent');
    }
    return res;
  };
  const a = await run(w, 'apply', { plan: join(p.runDir, 'plan.jsonl') }, { fetchImpl });
  assert.equal(a.exit, EXIT.PAUSED);
  assert.equal(a.report.sentence, 'Remove: stopped, because the agent was paused; 0 Claims rows and 4 Tag decisions rows are in the trash so far.');
  assert.equal(a.report.next, 'Next: a person clears the pause, then run the same apply command again; it continues where it stopped.');
  assert.equal(sent, 4, 'not one PATCH after the pause appeared');
  assert.equal(w.fake.trashed(DB.tag_decisions).length, 4);
  assert.deepEqual(w.fake.trashed(DB.claims), []);
  assert.equal(existsSync(join(w.root, 'setup', 'removed-claims.json')), false, 'no claim is in the trash yet');
  assert.equal(readJson(join(a.runDir, 'run.json')).apply.stopped.reason, 'paused');

  // while the pause stands, the command stops before it reads anything
  const requests = w.fake.requests.length;
  assert.equal((await applyOf(w, p)).exit, EXIT.PAUSED);
  assert.equal(w.fake.requests.length - requests > 0 && patches(w).length === 4, true, 'it may read (the pull), it sends nothing');

  rmSync(join(w.root, 'runs', 'PAUSED'));
  const b = await applyOf(w, p);
  assert.equal(b.exit, EXIT.OK, w.hooks().io.errs.join('\n'));
  const ok = patches(w).filter((q) => q.status === 200);
  assert.equal(ok.length, 10);
  assert.equal(new Set(ok.map((q) => q.path)).size, 10, 'no page was sent twice');
  assert.deepEqual(removedIds(w), CLAIMS_TRASHED);
});

test('cited: Supporting rows that overflow into the page of a rule change are read too, in the plan and again in the apply; a page that cannot be read ends the plan', async () => {
  const w = await setup();
  const client = createClient({ token: w.fake.token, fetchImpl: w.fake.fetchImpl, requestsPerSecond: 1000, sleep: async () => {} });
  const paragraph = (content) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } });
  // a rule change whose cell keeps one row and says the rest is in the page, where G(8) and G(10) are
  const lesson = w.fake.addRow(DB.rule_changes, { Lesson: 'Rule two', Tag: TAG, Status: 'Proposed', 'Supporting rows': `Claim number 7 says something · ${key(G(7))}\n+ 2 more in the page` });
  await client.appendBlocks(lesson, [paragraph(`Claim number 8 says something about the budget. · ${key(G(8))}`), paragraph(`Claim number 10 says something about the budget. · ${key(G(10))}`), paragraph('A note without a key.')]);
  const writes = w.fake.writes().length;
  const p = await planOf(w);
  assert.equal(p.exit, EXIT.OK, w.hooks().io.errs.join('\n'));
  assert.equal(w.fake.writes().length, writes, 'the plan only read');
  assert.ok(w.fake.requests.some((r) => r.method === 'GET' && r.path.startsWith(`/blocks/${lesson}/children`)), 'the page body was read');
  const plan = readPlan(p.runDir);
  const listed = new Set(plan.ops.map((o) => o.key));
  for (const cited of [G(7), G(8), G(10)]) {
    assert.equal(listed.has(cited), false, `${cited} is cited and stays`);
    assert.equal(listed.has(key(cited)), false);
  }
  assert.deepEqual(plan.ops.filter((o) => o.table === 'claims').map((o) => o.key), [G(6), G(9)]);
  const summary = readJson(join(p.runDir, 'summary.json'));
  assert.deepEqual(summary.kept, { selected: 1, decided: 3, cited: 4, waiting: 0, demo: 1 });
  assert.deepEqual(summary.kept_claims.find((c) => c.geo_id === G(10)).reasons, ['cited']);

  // the apply asks again: a rule change that cites G(9) only in its page, after the plan was made, makes the plan out of date
  const later = w.fake.addRow(DB.rule_changes, { Lesson: 'Rule three', Tag: TAG, Status: 'Proposed', 'Supporting rows': '+ 1 more in the page' });
  await client.appendBlocks(later, [paragraph(`Claim number 9 says something about the budget. · ${key(G(9))}`)]);
  const a = await applyOf(w, p);
  assert.equal(a.exit, EXIT.INVALID);
  assert.match(readJson(join(a.runDir, 'run.json')).stale.join(' | '), /Claims "a+09" is cited by a rule change/);
  assert.deepEqual(patches(w).filter((q) => q.path.startsWith('/pages/')), [], 'no page was trashed (the two PATCHes there are the test\'s own blocks)');

  // a page that cannot be read: nothing is planned, exit 1, and the claims it might cite are not guessed
  const w2 = await setup();
  const c2 = createClient({ token: w2.fake.token, fetchImpl: w2.fake.fetchImpl, requestsPerSecond: 1000, sleep: async () => {} });
  const l2 = w2.fake.addRow(DB.rule_changes, { Lesson: 'Rule two', Tag: TAG, Status: 'Proposed', 'Supporting rows': '+ 1 more in the page' });
  await c2.appendBlocks(l2, [paragraph(`Claim number 10 says something. · ${key(G(10))}`)]);
  w2.fake.failNext('GET', /\/blocks\//, 500, 4);
  const h = w2.hooks();
  const failed = await remove({ ...h, command: 'plan', keep: selectionFile(w2) });
  assert.equal(failed.exit, EXIT.ERROR);
  assert.equal(failed.report.sentence, 'Remove: nothing was done, because the page of a rule change could not be read, and the claims it cites are not known.');
  assert.match(h.io.errs.join('\n'), /the page of the rule change "Rule two" could not be read/);
  assert.equal(existsSync(join(failed.runDir, 'plan.jsonl')), false);
  assert.equal(existsSync(join(failed.runDir, 'snapshot-claims.jsonl')), false);
});

test('plan writes the snapshots and the summary before plan.jsonl, and apply refuses a plan whose record is missing or is not its own, before it reads Notion', async () => {
  const w = await setup();
  const p = await planOf(w);
  const mtime = (name) => statSync(join(p.runDir, name)).mtimeMs;
  assert.ok(mtime('plan.jsonl') >= mtime('summary.json'), 'the plan is written after the summary');
  assert.ok(mtime('summary.json') >= mtime('snapshot-claims.jsonl'), 'and the summary after the snapshots');
  assert.ok(mtime('snapshot-claims.jsonl') >= mtime('snapshot-tag_decisions.jsonl'));

  let forks = 0;
  /** A copy of the plan's folder with something wrong in the record next to the plan; `change(dir)` makes it wrong. */
  const fork = (change) => {
    const dir = join(w.root, 'runs', `fork-${++forks}`);
    mkdirSync(dir, { recursive: true });
    for (const name of ['plan.jsonl', 'summary.json', 'snapshot-claims.jsonl', 'snapshot-tag_decisions.jsonl']) copyFileSync(join(p.runDir, name), join(dir, name));
    change(dir);
    return join(dir, 'plan.jsonl');
  };
  const lines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const cases = [
    ['no summary', (d) => rmSync(join(d, 'summary.json')), /summary\.json is missing/],
    ['a summary that is not JSON', (d) => writeFileSync(join(d, 'summary.json'), '{ not json'), /summary\.json cannot be read/],
    ['a summary without keep_waiting', (d) => writeFileSync(join(d, 'summary.json'), JSON.stringify({ run_id: 'x' })), /does not say whether the plan was made with --keep-waiting/],
    ['keep_waiting that is not a boolean', (d) => writeFileSync(join(d, 'summary.json'), JSON.stringify({ keep_waiting: 'yes' })), /does not say whether/],
    ['no claims snapshot', (d) => rmSync(join(d, 'snapshot-claims.jsonl')), /snapshot-claims\.jsonl is missing/],
    ['no Tag decisions snapshot', (d) => rmSync(join(d, 'snapshot-tag_decisions.jsonl')), /snapshot-tag_decisions\.jsonl is missing/],
    ['a snapshot with a page less', (d) => writeFileSync(join(d, 'snapshot-claims.jsonl'), `${lines(join(d, 'snapshot-claims.jsonl')).slice(1).join('\n')}\n`), /snapshot-claims\.jsonl holds 4 page\(s\) and the plan trashes 5 Claims row\(s\)/],
    ['a snapshot with a page more', (d) => writeFileSync(join(d, 'snapshot-claims.jsonl'), `${[...lines(join(d, 'snapshot-claims.jsonl')), lines(join(d, 'snapshot-tag_decisions.jsonl'))[0]].join('\n')}\n`), /snapshot-claims\.jsonl holds 6 page\(s\)/],
    ['a snapshot of other pages', (d) => writeFileSync(join(d, 'snapshot-claims.jsonl'), `${[...lines(join(d, 'snapshot-claims.jsonl')).slice(1), lines(join(d, 'snapshot-tag_decisions.jsonl'))[0]].join('\n')}\n`), /snapshot-claims\.jsonl holds 5 page\(s\) and the plan trashes 5 Claims row\(s\): they are not the same pages/],
    ['a snapshot with a page twice', (d) => writeFileSync(join(d, 'snapshot-claims.jsonl'), `${[...lines(join(d, 'snapshot-claims.jsonl')).slice(1), lines(join(d, 'snapshot-claims.jsonl'))[1]].join('\n')}\n`), /they are not the same pages/],
  ];
  const before = w.fake.requests.length;
  for (const [label, change, re] of cases) {
    const file = fork(change);
    const a = await run(w, 'apply', { plan: file });
    assert.equal(a.exit, EXIT.INVALID, label);
    assert.equal(a.report.sentence, "Remove: nothing was done, because the snapshot or the summary next to the plan is missing or is not the plan's own.", label);
    assert.equal(a.report.next, 'Next: make a new plan.');
    assert.match(readJson(join(a.runDir, 'run.json')).record_problems.join(' | '), re, label);
  }
  assert.equal(w.fake.requests.length, before, 'not one request, for any of them');
  assert.deepEqual(patches(w), []);
  // the plan's own record is whole: the apply goes through
  assert.equal((await applyOf(w, p)).exit, EXIT.OK);
});

// ---- restore --------------------------------------------------------------------------------------------------------------------------

test('restore: takes every row of the run out of the trash, reads each back, takes the claims out of the list of removed claims, and a plan that was restored is not applied again', async () => {
  const w = await setup();
  const p = await planOf(w);
  assert.equal((await applyOf(w, p)).exit, EXIT.OK);
  assert.equal(w.fake.trashed(DB.claims).length + w.fake.trashed(DB.tag_decisions).length, 10);

  const r = await run(w, 'restore', { run: p.runId });
  assert.equal(r.exit, EXIT.OK, w.hooks().io.errs.join('\n'));
  assert.equal(r.report.sentence, 'Remove: 5 Claims rows and 5 Tag decisions rows are out of the trash again, and every row was read back.');
  assert.deepEqual(w.fake.trashed(DB.claims), []);
  assert.deepEqual(w.fake.trashed(DB.tag_decisions), []);
  assert.equal(geoIds(w, 'claims').length, 11);
  assert.equal(geoIds(w, 'tag_decisions').length, 12);
  for (const id of [...CLAIMS_TRASHED.map((g) => w.ids.claim[g]), ...ROWS_TRASHED.map((k) => w.ids.queue[k])]) assert.equal(w.fake.page(id).in_trash, false);
  // the PATCHes of the restore name the flag false, and the Claims rows come before the Tag decisions rows
  const restores = patches(w).slice(10);
  assert.equal(restores.length, 10);
  for (const q of restores) assert.deepEqual(q.body, { archived: false });
  const order = restores.map((q) => (CLAIMS_TRASHED.some((g) => q.path.includes(w.ids.claim[g])) ? 'claims' : 'rows'));
  assert.deepEqual(order, [...Array(5).fill('claims'), ...Array(5).fill('rows')]);
  // the list of removed claims is empty, the marker is written, the log is kept
  assert.deepEqual(removedIds(w), []);
  assert.equal(readJson(join(p.runDir, 'restored.json')).restored.claims, 5);
  assert.equal(readJsonl(join(r.runDir, 'restore-ledger.jsonl')).filter((l) => l.status === 'restored').length, 10);

  // the old plan is refused now: its ledger says done, Notion says live
  const refused = await applyOf(w, p);
  assert.equal(refused.exit, EXIT.INVALID);
  assert.equal(refused.report.sentence, 'Remove: nothing was done, because that plan was restored.');
  assert.equal(patches(w).length, 20);
  // and restoring again finds everything live and sends nothing
  const twice = await run(w, 'restore', { run: p.runId });
  assert.equal(twice.exit, EXIT.OK);
  assert.equal(patches(w).length, 20);
  assert.deepEqual(twice.report.rows[2], ['Rows that were not in the trash', '10', '']);
});

test('restore leaves the claims of other runs in the list, goes on after a stop, and touches only the rows of its snapshot', async () => {
  const w = await setup();
  addRemoved(w.root, [{ geo_id: 'c'.repeat(32), run_id: 'an-older-run', date: '2026-10-01' }]);
  const p = await planOf(w);
  assert.equal((await applyOf(w, p)).exit, EXIT.OK);
  // a page of the plan that is not in the snapshot is not touched: take one line out of the snapshot file
  const snapshotFile = join(p.runDir, 'snapshot-claims.jsonl');
  const kept = readFileSync(snapshotFile, 'utf8').split('\n').filter(Boolean);
  writeFileSync(snapshotFile, `${kept.filter((l) => JSON.parse(l).id !== w.ids.claim[G(6)]).join('\n')}\n`);
  w.fake.failNext('PATCH', /\/pages\//, 500, 12);
  const stopped = await run(w, 'restore', { run: p.runId });
  assert.equal(stopped.exit, EXIT.ERROR);
  assert.match(stopped.report.sentence, /^Remove: restore stopped; 0 Claims rows and 0 Tag decisions rows are out of the trash, \d+ are not\.$/);
  assert.equal(existsSync(join(p.runDir, 'restored.json')), false);
  const done = await run(w, 'restore', { run: p.runId });
  assert.equal(done.exit, EXIT.OK, w.hooks().io.errs.join('\n'));
  assert.deepEqual(w.fake.trashed(DB.claims), [w.ids.claim[G(6)]], 'the claim that is not in the snapshot stays in the trash');
  assert.deepEqual(removedIds(w).sort(), ['c'.repeat(32), G(6)].sort(), 'the other run\'s claim is still listed, and so is the one that was not restored');
});

test('restore asks for a plan that exists and a snapshot that is there', async () => {
  const w = await setup();
  assert.equal((await run(w, 'restore', { run: 'no-such-run' })).exit, EXIT.INVALID);
  assert.equal((await run(w, 'restore', { run: '../escape' })).exit, EXIT.INVALID);
  const p = await planOf(w);
  assert.equal((await applyOf(w, p)).exit, EXIT.OK);
  writeFileSync(join(p.runDir, 'snapshot-claims.jsonl'), '');
  rmSync(join(p.runDir, 'snapshot-tag_decisions.jsonl'), { force: true });
  const r = await run(w, 'restore', { run: p.runId });
  assert.equal(r.exit, EXIT.INVALID);
  assert.equal(r.report.sentence, 'Remove: nothing was done, because the snapshot of that run is missing.');
  assert.equal(w.fake.trashed(DB.claims).length, 5, 'nothing was restored');
});

// ---- the command line -------------------------------------------------------------------------------------------------------------------

test('main: the command and its flags are checked before anything runs', async () => {
  const run1 = async (argv) => {
    const io = quietIo();
    const code = await main(argv, io, { root: join(process.cwd(), 'does-not-exist-root') });
    return { code, io };
  };
  assert.equal((await run1(['--help'])).code, EXIT.OK);
  assert.equal((await run1(['--help'])).io.outs.join('\n'), USAGE);
  assert.equal((await run1([])).code, EXIT.INVALID);
  assert.equal((await run1(['bogus'])).code, EXIT.INVALID);
  assert.match((await run1(['bogus'])).io.errs.join('\n'), /unknown command "bogus"/);
  for (const argv of [
    ['plan'], ['plan', '--plan', 'x'], ['plan', '--keep', 'x', '--run', 'y'], ['apply'], ['apply', '--keep', 'x'], ['apply', '--plan', 'x', '--run', 'y'], ['restore'], ['restore', '--run', 'x', '--plan', 'y'],
    ['apply', '--plan', 'x', '--keep-waiting'], ['restore', '--run', 'x', '--keep-waiting'], ['plan', '--keep', ''], ['plan', '--nonsense'], ['plan', 'positional'], ['plan', '--keep', 'x', '--run-id', 'bad id'],
  ]) {
    const r = await run1(argv);
    assert.equal(r.code, EXIT.INVALID, argv.join(' '));
  }
  assert.match(USAGE, /plan --keep <selection file> \[--keep-waiting\] \[--run-id <id>\]/);
  assert.match(USAGE, /apply --plan /);
  assert.match(USAGE, /restore --run /);
});

test('main runs a plan through the command line like remove() does', async () => {
  const w = await setup();
  const io = quietIo();
  const code = await main(['plan', '--keep', selectionFile(w), '--keep-waiting', '--run-id', 'cli-plan'], io, w.hooks({ io }));
  assert.equal(code, EXIT.OK, io.errs.join('\n'));
  assert.ok(existsSync(join(w.root, 'runs', 'cli-plan', 'plan.jsonl')));
  assert.equal(readPlan(join(w.root, 'runs', 'cli-plan')).header.plan.counts.trashes, 8);
  const io2 = quietIo();
  assert.equal(await main(['apply', '--plan', 'cli-plan', '--verbose'], io2, w.hooks({ io: io2 })), EXIT.OK, io2.errs.join('\n'));
  assert.ok(io2.errs.some((l) => /apply 1\/8 trash tag_decisions/.test(l)), '--verbose shows the steps');
  const io3 = quietIo();
  assert.equal(await main(['restore', '--run', 'cli-plan'], io3, w.hooks({ io: io3 })), EXIT.OK, io3.errs.join('\n'));
  assert.equal(w.fake.trashed(DB.claims).length, 0);
});
