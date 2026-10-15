import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCK_STALE_MS, RUNS, STORE_LOCKED, archiveStore, normalizeKeyInputs, openStore, storeDir, storeDirName, storeKey } from '../../agents/claim-tagger-mvp/scripts/lib/cells.mjs';
import { h16 } from '../../agents/claim-tagger-mvp/scripts/lib/hash.mjs';
import { pyJson } from '../../agents/claim-tagger-mvp/scripts/lib/pyjson.mjs';

const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-cells-'));
  roots.push(dir);
  return dir;
}

const inputs = () => ({
  driver: 'fake', model: 'claude-sonnet-5-5', effort: 'medium', pass: 'text', prompt_version: '1', group: 'G1',
  tags: [{ name: 'Context-dependent', tag_hash: 'sha256:aaaaaaaaaaaaaaaa' }, { name: 'Wordy', tag_hash: 'sha256:bbbbbbbbbbbbbbbb' }],
});

const cellTags = (p = 0.9) => [
  { name: 'Context-dependent', decision: 'apply', p, rule_ref: 'Context-dependent rule 1', reason: 'It says \'this one\'.' },
  { name: 'Wordy', decision: 'do_not_apply', p: 0.1, rule_ref: null, reason: 'Short enough.' },
];
const line = (id, over = {}) => ({
  id, item_hash: 'sha256:0123456789abcdef', status: 'ok', tags: cellTags(),
  call: { run_id: 'run-a', batch: 1, attempt: 1, cli_version: '2.1.296', usage: { input: 10, cache_write: 0, cache_read: 5, output: 7 } }, ...over,
});
const errorLine = (id, over = {}) => line(id, { status: 'error', error: 'the reply was not JSON', tags: [], ...over });

// ---- the key -----------------------------------------------------------------------------------------------------------------

test('storeKey is h16 of the sorted-key JSON of the seven inputs, the same for any key order and any tag order', () => {
  const a = inputs();
  const expected = h16(pyJson({
    driver: 'fake', model: 'claude-sonnet-5-5', effort: 'medium', pass: 'text', prompt_version: '1', group: 'G1',
    tags: [{ name: 'Context-dependent', tag_hash: 'sha256:aaaaaaaaaaaaaaaa' }, { name: 'Wordy', tag_hash: 'sha256:bbbbbbbbbbbbbbbb' }],
  }, { sortKeys: true }));
  assert.equal(storeKey(a), expected);
  assert.match(storeKey(a), /^sha256:[0-9a-f]{16}$/);

  const shuffled = {
    tags: [{ tag_hash: 'sha256:bbbbbbbbbbbbbbbb', name: 'Wordy' }, { tag_hash: 'sha256:aaaaaaaaaaaaaaaa', name: 'Context-dependent' }],
    group: 'G1', prompt_version: '1', pass: 'text', effort: 'medium', model: 'claude-sonnet-5-5', driver: 'fake',
  };
  assert.equal(storeKey(shuffled), storeKey(a), 'property order and tag order do not matter');
  const { pass, ...withoutPass } = a;
  assert.equal(pass, 'text');
  assert.equal(storeKey(withoutPass), storeKey(a), 'pass defaults to text');
  assert.equal(storeKey({ ...a, prompt_version: 1 }), storeKey(a), 'a number and its text are the same version');
  assert.equal(storeKey({ ...a, extra: 'ignored', tags: a.tags.map((t) => ({ ...t, note: 'ignored' })) }), storeKey(a), 'fields that are not inputs are not hashed');
});

test('every input changes the key', () => {
  const base = storeKey(inputs());
  const changed = [
    { driver: 'cli' }, { model: 'claude-opus-5-5' }, { effort: 'high' }, { pass: 'source' }, { prompt_version: '2' }, { group: 'G2' },
    { tags: [{ name: 'Context-dependent', tag_hash: 'sha256:cccccccccccccccc' }, { name: 'Wordy', tag_hash: 'sha256:bbbbbbbbbbbbbbbb' }] },
    { tags: [{ name: 'Context-dependent', tag_hash: 'sha256:aaaaaaaaaaaaaaaa' }] },
    { tags: [{ name: 'Context-dependent', tag_hash: 'sha256:aaaaaaaaaaaaaaaa' }, { name: 'Poor wording', tag_hash: 'sha256:bbbbbbbbbbbbbbbb' }] },
  ];
  const keys = new Set([base]);
  for (const c of changed) {
    const key = storeKey({ ...inputs(), ...c });
    assert.notEqual(key, base, JSON.stringify(c));
    keys.add(key);
  }
  assert.equal(keys.size, changed.length + 1, 'no two changes collide');
});

test('the folder name is the 16 hex digits of the key, with no colon, under runs/judgments', () => {
  const key = storeKey(inputs());
  assert.equal(storeDirName(key), key.slice('sha256:'.length));
  assert.match(storeDirName(key), /^[0-9a-f]{16}$/);
  const root = tmp();
  assert.equal(storeDir(root, inputs()), join(root, 'runs', 'judgments', storeDirName(key)));
  const store = openStore(root, inputs());
  try {
    assert.equal(store.dir, storeDir(root, inputs()));
    assert.equal(store.key, key);
    assert.equal(store.key16, storeDirName(key));
    assert.ok(!store.dir.slice(root.length).includes(':'));
  } finally {
    store.close();
  }
});

test('key inputs that are missing or of the wrong kind are refused with the field named', () => {
  const bad = (over, field) => assert.throws(() => storeKey({ ...inputs(), ...over }), (e) => e instanceof TypeError && e.message.includes(field), field);
  bad({ driver: undefined }, 'driver');
  bad({ model: '' }, 'model');
  bad({ effort: null }, 'effort');
  bad({ group: 7 }, 'group');
  bad({ pass: '' }, 'pass');
  bad({ prompt_version: undefined }, 'prompt_version');
  bad({ tags: [] }, 'tags');
  bad({ tags: 'Context-dependent' }, 'tags');
  bad({ tags: [{ name: 'Wordy' }] }, 'tags[0]');
  bad({ tags: [{ name: 'Wordy', tag_hash: 'sha256:aaaaaaaaaaaaaaaa' }, { name: 'Wordy', tag_hash: 'sha256:bbbbbbbbbbbbbbbb' }] }, 'twice');
  assert.throws(() => normalizeKeyInputs(null), TypeError);
  assert.deepEqual(normalizeKeyInputs(inputs()).tags.map((t) => t.name), ['Context-dependent', 'Wordy'], 'tags come back sorted by name');
});

// ---- meta.json ---------------------------------------------------------------------------------------------------------------

test('meta.json is written on first open with the inputs and checked on every later open', () => {
  const root = tmp();
  const first = openStore(root, inputs());
  const metaFile = join(first.dir, 'meta.json');
  assert.ok(existsSync(metaFile));
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  assert.equal(meta.key, first.key);
  for (const f of ['driver', 'model', 'effort', 'pass', 'prompt_version', 'group', 'tags']) assert.deepEqual(meta[f], first.inputs[f], f);
  assert.match(meta.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(first.meta, meta);
  first.close();

  const again = openStore(root, { ...inputs(), tags: inputs().tags.reverse() });
  assert.equal(again.dir, first.dir, 'the same inputs, in another order, open the same folder');
  assert.deepEqual(again.meta, meta, 'meta.json is not rewritten');
  again.close();
});

test('a meta.json that does not say what the folder name says stops the open, and no lock is left behind', () => {
  const root = tmp();
  const s = openStore(root, inputs());
  const { dir } = s;
  s.close();
  const metaFile = join(dir, 'meta.json');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  for (const [field, value] of [['model', 'claude-haiku-5-5'], ['prompt_version', '9'], ['tags', [{ name: 'Wordy', tag_hash: 'sha256:bbbbbbbbbbbbbbbb' }]], ['key', 'sha256:ffffffffffffffff']]) {
    writeFileSync(metaFile, JSON.stringify({ ...meta, [field]: value }));
    assert.throws(() => openStore(root, inputs()), /other inputs/, field);
    assert.ok(!existsSync(join(dir, 'LOCK')), `${field}: the failed open released its lock`);
  }
  writeFileSync(metaFile, JSON.stringify(meta));
  openStore(root, inputs()).close();

  writeFileSync(metaFile, '{ not json');
  assert.throws(() => openStore(root, inputs()), /invalid JSON/);
  assert.ok(!existsSync(join(dir, 'LOCK')));
});

test('a folder with judgments but no meta.json cannot be checked, so it is refused', () => {
  const root = tmp();
  const s = openStore(root, inputs());
  s.append(1, [line('a')]);
  const { dir } = s;
  s.close();
  rmSync(join(dir, 'meta.json'));
  assert.throws(() => openStore(root, inputs()), /no meta\.json/);
  assert.ok(!existsSync(join(dir, 'LOCK')));
});

// ---- append, last line wins ---------------------------------------------------------------------------------------------------

test('append writes one line per item to run-<n>.jsonl, and the last line for an item wins', () => {
  const root = tmp();
  const s = openStore(root, inputs());
  s.append(1, [line('a'), line('b')]);
  s.append(1, [line('a', { tags: cellTags(0.55), call: { ...line('a').call, attempt: 2 } })]);
  const lines = s.lines(1);
  assert.deepEqual([...lines.keys()].sort(), ['a', 'b']);
  assert.equal(lines.get('a').tags[0].p, 0.55, 'the later line replaced the earlier one');
  assert.equal(lines.get('a').call.attempt, 2);
  assert.equal(lines.get('b').tags[0].p, 0.9);
  assert.equal(s.lines(2).size, 0);
  const file = join(s.dir, 'run-1.jsonl');
  assert.equal(readFileSync(file, 'utf8').trimEnd().split('\n').length, 3, 'the file is append-only: both lines of a are still there');
  s.close();

  const back = openStore(root, inputs());
  assert.equal(back.lines(1).get('a').tags[0].p, 0.55, 'the same after a close and an open');
  assert.equal(back.lines(1).size, 2);
  back.close();
});

test('runsFor lists an item\'s lines over the runs, in run order, and can drop the lines made for another text', () => {
  const root = tmp();
  const s = openStore(root, inputs());
  s.append(1, [line('a')]);
  s.append(2, [line('a', { tags: cellTags(0.6) })]);
  s.append(3, [errorLine('a')]);
  s.append(1, [line('b', { item_hash: 'sha256:fedcba9876543210' })]);
  const runs = s.runsFor('a');
  assert.deepEqual(runs.map((r) => r.run), [1, 2, 3]);
  assert.deepEqual(runs.map((r) => r.line.status), ['ok', 'ok', 'error']);
  assert.deepEqual(s.runsFor('nobody'), []);
  assert.deepEqual(s.runsFor('b').map((r) => r.run), [1]);
  assert.deepEqual(s.runsFor('b', 'sha256:0123456789abcdef'), [], 'the claim text changed since: that line is not for this text');
  assert.deepEqual(s.runsFor('b', 'sha256:fedcba9876543210').map((r) => r.run), [1]);
  s.close();
});

test('lines() hands out a copy: changing it does not change the store', () => {
  const root = tmp();
  const s = openStore(root, inputs());
  s.append(1, [line('a')]);
  const copy = s.lines(1);
  copy.delete('a');
  copy.set('z', line('z'));
  assert.deepEqual([...s.lines(1).keys()], ['a']);
  s.close();
});

test('error lines are stored like any other line and are replaced by a later ok line', () => {
  const root = tmp();
  const s = openStore(root, inputs());
  s.append(1, [errorLine('a')]);
  assert.equal(s.lines(1).get('a').status, 'error');
  assert.equal(s.lines(1).get('a').error, 'the reply was not JSON');
  s.append(1, [line('a')]);
  assert.equal(s.lines(1).get('a').status, 'ok');
  s.close();
});

test('every line is checked before it is written: a bad line writes nothing at all', () => {
  const root = tmp();
  const s = openStore(root, inputs());
  const file = join(s.dir, 'run-1.jsonl');
  const bad = [
    ['an unknown decision', line('a', { tags: [{ ...cellTags()[0], decision: 'maybe' }, cellTags()[1]] })],
    ['p above 1', line('a', { tags: [{ ...cellTags()[0], p: 1.2 }, cellTags()[1]] })],
    ['a field the schema does not know', line('a', { extra: 1 })],
    ['a missing call', (() => { const l = line('a'); delete l.call; return l; })()],
    ['a bad item hash', line('a', { item_hash: 'abc' })],
    ['a missing tag of the group', line('a', { tags: [cellTags()[0]] })],
    ['a tag listed twice', line('a', { tags: [cellTags()[0], cellTags()[0]] })],
    ['a tag that is not in the group', line('a', { tags: [cellTags()[0], { ...cellTags()[1], name: 'Opinion' }] })],
    ['an ok line without tags', line('a', { tags: [] })],
    ['an error line with tags', line('a', { status: 'error', error: 'x' })],
    ['a fractional token count', line('a', { call: { ...line('a').call, usage: { input: 1.5, cache_write: 0, cache_read: 0, output: 0 } } })],
  ];
  for (const [what, bad1] of bad) {
    assert.throws(() => s.append(1, [line('first'), bad1]), /cells:/, what);
    assert.ok(!existsSync(file), `${what}: nothing was written, not even the good line before it`);
    assert.equal(s.lines(1).size, 0, what);
  }
  assert.throws(() => s.append(4, [line('a')]), RangeError);
  assert.throws(() => s.append(0, [line('a')]), RangeError);
  assert.deepEqual(RUNS, [1, 2, 3]);
  s.close();
  assert.throws(() => s.append(1, [line('a')]), /closed/);
});

test('a line that does not pass the schema when the file is read back stops the read and names the line', () => {
  const root = tmp();
  const s = openStore(root, inputs());
  s.append(1, [line('a'), line('b')]);
  const file = join(s.dir, 'run-1.jsonl');
  s.close();
  const text = readFileSync(file, 'utf8').split('\n');
  const broken = JSON.parse(text[1]);
  broken.status = 'unknown';
  writeFileSync(file, `${text[0]}\n${JSON.stringify(broken)}\n`);
  const again = openStore(root, inputs());
  assert.throws(() => again.lines(1), (e) => e.message.includes('run-1.jsonl') && e.message.includes('line 2'));
  again.close();
});

test('a torn last line, left by a crash in the middle of a write, is ignored and cut off by the next append', () => {
  const root = tmp();
  const s = openStore(root, inputs());
  s.append(1, [line('a')]);
  const file = join(s.dir, 'run-1.jsonl');
  s.close();
  writeFileSync(file, `${readFileSync(file, 'utf8')}{"id":"b","item_hash":"sha256:0123`);
  const again = openStore(root, inputs());
  assert.deepEqual([...again.lines(1).keys()], ['a'], 'the half line is not an item');
  again.append(1, [line('c')]);
  assert.deepEqual([...again.lines(1).keys()], ['a', 'c']);
  again.close();
  const rows = readFileSync(file, 'utf8').trimEnd().split('\n');
  assert.equal(rows.length, 2, 'the torn line is gone, nothing was glued to it');
  rows.forEach((r) => JSON.parse(r));
});

// ---- the lock -----------------------------------------------------------------------------------------------------------------

test('a LOCK is taken at open and removed at close; a second writer is told plainly that the store is in use', () => {
  const root = tmp();
  const first = openStore(root, inputs());
  const lockFile = join(first.dir, 'LOCK');
  assert.ok(existsSync(lockFile));
  const held = JSON.parse(readFileSync(lockFile, 'utf8'));
  assert.equal(held.pid, process.pid);
  assert.match(held.since, /^\d{4}-\d{2}-\d{2}T/);

  assert.throws(() => openStore(root, inputs()), (e) => /in use/.test(e.message) && e.message.includes(first.dir) && /LOCK/.test(e.message) && e.code === STORE_LOCKED);
  assert.ok(existsSync(lockFile), 'the refused open did not remove the lock of the first');
  const other = openStore(root, { ...inputs(), group: 'G2' });
  assert.notEqual(other.dir, first.dir, 'another group has its own store and its own lock');
  other.close();

  first.close();
  assert.ok(!existsSync(lockFile));
  first.close(); // a second close is harmless
  const next = openStore(root, inputs());
  assert.ok(existsSync(lockFile));
  next.close();
});

test('a lock older than an hour is stale and is taken over, and so is one whose process is gone', () => {
  const root = tmp();
  const s = openStore(root, inputs());
  const { dir } = s;
  const lockFile = join(dir, 'LOCK');
  s.close();

  // another live process holds a fresh lock (the parent of the test runner is alive and is not this process)
  writeFileSync(lockFile, JSON.stringify({ pid: process.ppid, token: 'someone-else', since: new Date().toISOString() }));
  assert.throws(() => openStore(root, inputs()), /in use .* by process/);

  // the same lock, an hour and a bit later (the clock moves; the file's age decides)
  const later = openStore(root, inputs(), { now: () => Date.now() + LOCK_STALE_MS + 60000 });
  later.close();

  // old by its modification time
  writeFileSync(lockFile, JSON.stringify({ pid: process.ppid, token: 'someone-else' }));
  const old = new Date(Date.now() - 2 * LOCK_STALE_MS);
  utimesSync(lockFile, old, old);
  openStore(root, inputs()).close();
  assert.ok(!existsSync(lockFile));

  // a lock nobody can explain: fresh holds, old goes
  writeFileSync(lockFile, 'locked');
  assert.throws(() => openStore(root, inputs()), /in use/);
  utimesSync(lockFile, old, old);
  openStore(root, inputs()).close();

  // a judge that was killed leaves a fresh lock behind; its process is gone, so the resume is not blocked for an hour
  const gone = spawnSync(process.execPath, ['-e', '0']).pid;
  writeFileSync(lockFile, JSON.stringify({ pid: gone, token: 'killed', since: new Date().toISOString() }));
  openStore(root, inputs()).close();
  assert.ok(!existsSync(lockFile));
});

test('close removes only its own lock: one that somebody else took over in the meantime stays', () => {
  const root = tmp();
  const s = openStore(root, inputs());
  const lockFile = join(s.dir, 'LOCK');
  writeFileSync(lockFile, JSON.stringify({ pid: process.ppid, token: 'taken-over', since: new Date().toISOString() }));
  s.close();
  assert.ok(existsSync(lockFile));
  assert.equal(JSON.parse(readFileSync(lockFile, 'utf8')).token, 'taken-over');
});

// ---- read-only ----------------------------------------------------------------------------------------------------------------

test('a read-only open creates nothing, takes no lock, reads what is there and refuses to append', () => {
  const root = tmp();
  const missing = openStore(root, inputs(), { readOnly: true });
  assert.equal(missing.meta, null);
  assert.equal(missing.lines(1).size, 0);
  assert.deepEqual(missing.runsFor('a'), []);
  assert.ok(!existsSync(join(root, 'runs')), 'a store that does not exist is not created by looking at it');
  assert.throws(() => missing.append(1, [line('a')]), /read-only/);
  missing.close();

  const writer = openStore(root, inputs());
  writer.append(1, [line('a')]);
  writer.append(2, [line('a', { tags: cellTags(0.6) })]);
  const reader = openStore(root, inputs(), { readOnly: true }); // the writer still holds its lock
  assert.equal(reader.lines(1).get('a').tags[0].p, 0.9);
  assert.deepEqual(reader.runsFor('a').map((r) => r.run), [1, 2]);
  assert.deepEqual(reader.meta, writer.meta);
  assert.throws(() => reader.append(1, [line('b')]), /read-only/);
  reader.close();
  assert.ok(existsSync(join(writer.dir, 'LOCK')), 'closing a reader leaves the writer\'s lock alone');
  writer.close();
});

test('a read-only open still checks meta.json', () => {
  const root = tmp();
  const s = openStore(root, inputs());
  const { dir } = s;
  s.close();
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...meta, group: 'G9' }));
  assert.throws(() => openStore(root, inputs(), { readOnly: true }), /other inputs/);
});

// ---- setting a store aside ----------------------------------------------------------------------------------------------------

test('archiveStore renames the folder, keeps everything in it, and the next open starts a fresh store', () => {
  const root = tmp();
  const s = openStore(root, inputs());
  s.append(1, [line('a'), line('b')]);
  s.append(2, [line('a', { tags: cellTags(0.6) })]);
  const { dir } = s;
  s.close();

  const moved = archiveStore(root, inputs(), '20261016T101500Z-judge');
  assert.equal(moved, `${dir}.superseded-20261016T101500Z-judge`);
  assert.ok(!existsSync(dir));
  assert.ok(!moved.slice(root.length).includes(':'));
  assert.equal(readFileSync(join(moved, 'run-1.jsonl'), 'utf8').trimEnd().split('\n').length, 2, 'the old judgments are kept as history');
  assert.ok(existsSync(join(moved, 'run-2.jsonl')));
  assert.ok(existsSync(join(moved, 'meta.json')));
  assert.ok(!existsSync(join(moved, 'LOCK')));

  const fresh = openStore(root, inputs());
  assert.equal(fresh.dir, dir, 'the same inputs open the ordinary folder again');
  assert.equal(fresh.lines(1).size, 0);
  assert.equal(fresh.lines(2).size, 0);
  fresh.append(1, [line('a', { tags: cellTags(0.8) })]);
  fresh.close();
  assert.equal(readdirSync(join(root, 'runs', 'judgments')).length, 2);

  // a second time with the same label does not overwrite the first
  const again = archiveStore(root, inputs(), '20261016T101500Z-judge');
  assert.equal(again, `${dir}.superseded-20261016T101500Z-judge-2`);
  assert.ok(existsSync(moved));
});

test('archiveStore has nothing to do for a store that does not exist or holds no run file, and it refuses a store in use', () => {
  const root = tmp();
  assert.equal(archiveStore(root, inputs(), 'x'), null);
  const s = openStore(root, inputs());
  s.close();
  assert.equal(archiveStore(root, inputs(), 'x'), null, 'a folder with only meta.json is reused, not set aside');
  assert.ok(existsSync(s.dir));

  const busy = openStore(root, inputs());
  busy.append(1, [line('a')]);
  assert.throws(() => archiveStore(root, inputs(), 'x'), (e) => /in use/.test(e.message) && e.code === STORE_LOCKED);
  assert.ok(existsSync(busy.dir));
  busy.close();
  assert.ok(archiveStore(root, inputs(), 'a:b/c d'), 'a label with odd characters still gives a Windows-safe name');
  assert.ok(readdirSync(join(root, 'runs', 'judgments')).some((n) => n.endsWith('.superseded-a-b-c-d')));
});
