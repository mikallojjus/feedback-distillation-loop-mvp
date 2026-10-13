import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendJsonl, readJson, readJsonl, renameWithRetry, sleepSync, writeJsonAtomic, writeTextAtomic,
} from '../agents/claim-tagger/scripts/lib/jsonl.mjs';

// Characters built from code points on purpose (no \u escapes in this file).
const BOM = String.fromCharCode(0xfeff);
const LINE_SEP = String.fromCharCode(0x2028);
const E_ACUTE = String.fromCharCode(0xe9);

const roots = [];
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-jsonl-'));
  roots.push(dir);
  return dir;
}
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

// ---- readJsonl ----

test('readJsonl: a missing file is an empty ledger', () => {
  assert.deepEqual(readJsonl(join(tmp(), 'nope.jsonl')), { rows: [], torn: false });
});

test('readJsonl: rows in order, and a final newline is not a torn line', () => {
  const p = join(tmp(), 'a.jsonl');
  writeFileSync(p, '{"a":1}\n{"b":[2,3]}\n');
  assert.deepEqual(readJsonl(p), { rows: [{ a: 1 }, { b: [2, 3] }], torn: false });
});

test('readJsonl: a complete last row without a newline is kept', () => {
  const p = join(tmp(), 'a.jsonl');
  writeFileSync(p, '{"a":1}\n{"b":2}');
  assert.deepEqual(readJsonl(p), { rows: [{ a: 1 }, { b: 2 }], torn: false });
});

test('readJsonl: a torn last line is ignored and reported', () => {
  const p = join(tmp(), 'a.jsonl');
  writeFileSync(p, '{"a":1}\n{"b":2}\n{"c":');
  assert.deepEqual(readJsonl(p), { rows: [{ a: 1 }, { b: 2 }], torn: true });
  writeFileSync(p, '{"only":');
  assert.deepEqual(readJsonl(p), { rows: [], torn: true });
  writeFileSync(p, '{"a":1}\n\0\0\0\0');
  assert.deepEqual(readJsonl(p), { rows: [{ a: 1 }], torn: true }, 'zero bytes left by an interrupted write are a torn tail');
});

test('readJsonl: a bad line before the end is corruption, not a torn write', () => {
  const p = join(tmp(), 'a.jsonl');
  writeFileSync(p, '{"a":1}\n{"b":\n{"c":3}\n');
  assert.throws(() => readJsonl(p), (e) => e.message.includes('line 2') && e.message.includes(p));
  writeFileSync(p, '{"a":1}\nnot json\n');
  assert.throws(() => readJsonl(p), /line 2/, 'even the last line, when it ends with a newline');
});

test('readJsonl: blank lines, CRLF line ends and a BOM are tolerated', () => {
  const p = join(tmp(), 'a.jsonl');
  writeFileSync(p, BOM + '{"a":1}\r\n\r\n   \r\n{"b":2}\r\n');
  assert.deepEqual(readJsonl(p), { rows: [{ a: 1 }, { b: 2 }], torn: false });
});

// ---- appendJsonl ----

test('appendJsonl: creates parent folders, one line per row, newline terminated', () => {
  const p = join(tmp(), 'deep', 'er', 'ledger.jsonl');
  const second = `caf${E_ACUTE} ${LINE_SEP} end`;
  appendJsonl(p, { id: 1, text: 'line one\nline two' });
  appendJsonl(p, { id: 2, text: second });
  const text = readFileSync(p, 'utf8');
  assert.equal(text.split('\n').length, 3, 'two rows and the empty piece after the last newline');
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(readJsonl(p).rows, [{ id: 1, text: 'line one\nline two' }, { id: 2, text: second }]);
  assert.equal(text.includes('\r'), false);
});

test('appendJsonl: an append after a torn line cuts the torn line off, the file stays valid', () => {
  const p = join(tmp(), 'ledger.jsonl');
  writeFileSync(p, '{"a":1}\n{"b":2}\n{"c":');
  appendJsonl(p, { d: 4 });
  assert.equal(readFileSync(p, 'utf8'), '{"a":1}\n{"b":2}\n{"d":4}\n');
  assert.deepEqual(readJsonl(p), { rows: [{ a: 1 }, { b: 2 }, { d: 4 }], torn: false });
});

test('appendJsonl: a file that is one torn line is emptied before the append', () => {
  const p = join(tmp(), 'ledger.jsonl');
  writeFileSync(p, '{"a":');
  appendJsonl(p, { b: 1 });
  assert.equal(readFileSync(p, 'utf8'), '{"b":1}\n');
});

test('appendJsonl: a complete last row without a newline gets one, nothing is lost', () => {
  const p = join(tmp(), 'ledger.jsonl');
  writeFileSync(p, '{"a":1}\n{"b":2}');
  appendJsonl(p, { c: 3 });
  assert.equal(readFileSync(p, 'utf8'), '{"a":1}\n{"b":2}\n{"c":3}\n');
});

test('appendJsonl: works on an empty existing file and keeps appending in order', () => {
  const p = join(tmp(), 'ledger.jsonl');
  writeFileSync(p, '');
  for (let i = 0; i < 25; i++) appendJsonl(p, { i });
  assert.deepEqual(readJsonl(p).rows.map((r) => r.i), Array.from({ length: 25 }, (_, i) => i));
});

test('appendJsonl: a torn row bigger than the read chunk is found and cut off', () => {
  const p = join(tmp(), 'ledger.jsonl');
  writeFileSync(p, '{"good":true}\n{"big":"' + 'x'.repeat(200000));
  appendJsonl(p, { next: 1 });
  assert.equal(readFileSync(p, 'utf8'), '{"good":true}\n{"next":1}\n');
});

test('appendJsonl: refuses a row that is not JSON serializable', () => {
  const p = join(tmp(), 'ledger.jsonl');
  assert.throws(() => appendJsonl(p, undefined), TypeError);
  assert.throws(() => appendJsonl(p, () => 1), TypeError);
});

// ---- readJson and atomic writes ----

test('readJson: parses, tolerates a BOM, and names the file when it is broken', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'ok.json'), BOM + '{"a":[1,2]}');
  assert.deepEqual(readJson(join(dir, 'ok.json')), { a: [1, 2] });
  writeFileSync(join(dir, 'bad.json'), '{"a":');
  assert.throws(() => readJson(join(dir, 'bad.json')), (e) => e.message.includes('bad.json'));
});

test('writeJsonAtomic: pretty by default with a final newline, compact on request, creates folders, replaces the file', () => {
  const dir = tmp();
  const p = join(dir, 'x', 'y', 'data.json');
  writeJsonAtomic(p, { a: 1, b: [true, null] });
  assert.equal(readFileSync(p, 'utf8'), '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}\n');
  writeJsonAtomic(p, { a: 2 }, { pretty: false });
  assert.equal(readFileSync(p, 'utf8'), '{"a":2}\n');
  assert.deepEqual(readdirSync(join(dir, 'x', 'y')), ['data.json'], 'no temp file is left behind');
});

test('writeJsonAtomic: repeated writes always leave a complete document', () => {
  const dir = tmp();
  const p = join(dir, 'data.json');
  for (let i = 0; i < 30; i++) {
    writeJsonAtomic(p, { i, pad: 'z'.repeat(i * 100) });
    assert.equal(readJson(p).i, i);
  }
  assert.deepEqual(readdirSync(dir), ['data.json']);
});

test('writeJsonAtomic: refuses a value JSON cannot hold', () => {
  assert.throws(() => writeJsonAtomic(join(tmp(), 'x.json'), undefined), TypeError);
});

test('writeTextAtomic: writes exactly the text given (LF stays LF) as UTF-8', () => {
  const p = join(tmp(), 'note.md');
  writeTextAtomic(p, `one\ntwo caf${E_ACUTE}\n`);
  const bytes = readFileSync(p);
  assert.equal(bytes.toString('utf8'), `one\ntwo caf${E_ACUTE}\n`);
  assert.equal(bytes.includes(0x0d), false);
  assert.equal(bytes.includes(0xc3), true, 'the accent is stored as UTF-8 bytes');
});

test('a failed rename removes the temp file and reports the error', () => {
  const dir = tmp();
  const target = join(dir, 'target');
  mkdirSync(target); // renaming a file over a folder fails on every platform
  assert.throws(() => writeJsonAtomic(target, { a: 1 }));
  assert.deepEqual(readdirSync(dir), ['target'], 'no leftover temp file');
});

// ---- rename retries ----

const err = (code) => Object.assign(new Error(code), { code });

test('renameWithRetry: succeeds once the destination is released', () => {
  let calls = 0;
  renameWithRetry('a', 'b', { delayMs: 1, rename: () => { if (++calls < 3) throw err(calls === 1 ? 'EPERM' : 'EBUSY'); } });
  assert.equal(calls, 3);
});

test('renameWithRetry: gives up after 5 retries (6 attempts) on a persistent lock', () => {
  let calls = 0;
  assert.throws(() => renameWithRetry('a', 'b', { delayMs: 1, rename: () => { calls++; throw err('EPERM'); } }), { code: 'EPERM' });
  assert.equal(calls, 6);
});

test('renameWithRetry: any other error is thrown at once', () => {
  let calls = 0;
  assert.throws(() => renameWithRetry('a', 'b', { delayMs: 1, rename: () => { calls++; throw err('ENOENT'); } }), { code: 'ENOENT' });
  assert.equal(calls, 1);
});

test('renameWithRetry: waits between attempts (about 50 ms by default)', () => {
  let calls = 0;
  const t0 = Date.now();
  renameWithRetry('a', 'b', { rename: () => { if (++calls < 3) throw err('EBUSY'); } });
  assert.ok(Date.now() - t0 >= 70, `two waits of 50 ms expected, took ${Date.now() - t0} ms`);
});

test('sleepSync blocks for about the time asked', () => {
  const t0 = Date.now();
  sleepSync(30);
  assert.ok(Date.now() - t0 >= 20);
});
