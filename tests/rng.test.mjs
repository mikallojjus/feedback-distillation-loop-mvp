import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, sample, seedFromString, shuffle } from '../agents/claim-tagger/scripts/lib/rng.mjs';

const E_ACUTE = String.fromCharCode(0xe9);
const draw = (seed, n = 5) => {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => r());
};

// Reference values: an independent Python port of mulberry32 with explicit 32-bit masks.
test('mulberry32 reproduces the reference sequences', () => {
  assert.deepEqual(draw(0), [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111, 0.46732782293111086]);
  assert.deepEqual(draw(1), [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849]);
  assert.deepEqual(draw(42), [0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693, 0.17481389874592423]);
  assert.deepEqual(draw(123456789), [0.2577907438389957, 0.9707721115555614, 0.7853280142880976, 0.20616457983851433, 0.30307188746519387]);
  assert.deepEqual(draw(0xffffffff), [0.8964226141106337, 0.189478256739676, 0.7156526781618595, 0.9440599093213677, 0.8452364315744489]);
});

test('mulberry32: floats in [0, 1), deterministic, independent generators', () => {
  const a = mulberry32(99);
  const b = mulberry32(99);
  const xs = Array.from({ length: 2000 }, () => a());
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.deepEqual(xs, Array.from({ length: 2000 }, () => b()));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(mean > 0.47 && mean < 0.53, `mean ${mean}`);
  assert.notDeepEqual(draw(1), draw(2));
  const first = mulberry32(5);
  const second = mulberry32(5);
  first();
  assert.notEqual(first(), second(), 'each generator has its own state');
});

test('mulberry32 takes the seed as an unsigned 32-bit integer', () => {
  assert.deepEqual(draw(-1), draw(0xffffffff));
  assert.deepEqual(draw(2 ** 32 + 5), draw(5));
  assert.deepEqual(draw(7.9), draw(7));
});

test('seedFromString is the first 4 bytes of SHA-256 as a big-endian unsigned integer', () => {
  assert.equal(seedFromString('abc'), 3128432319); // ba7816bf...
  assert.equal(seedFromString(''), 3820012610); // e3b0c442...
  assert.equal(seedFromString('paired-bootstrap'), 1485029027);
  assert.equal(seedFromString('run-1'), 1315296251);
  assert.equal(seedFromString(`caf${E_ACUTE}`), 2232384964, 'UTF-8 bytes');
  assert.equal(seedFromString(42), seedFromString('42'));
  for (const s of ['a', 'b', 'c', 'seed']) {
    const v = seedFromString(s);
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffffff);
  }
});

test('shuffle reproduces the reference permutations and leaves the input alone', () => {
  const input = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.deepEqual(shuffle(input, mulberry32(7)), [6, 5, 8, 1, 2, 3, 4, 7, 9, 0]);
  assert.deepEqual(input, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(shuffle([...'abcdefgh'], mulberry32(seedFromString('seed-a'))), ['d', 'a', 'g', 'f', 'b', 'h', 'c', 'e']);
});

test('shuffle: a new array with the same items, deterministic per seed, edge sizes', () => {
  const input = Array.from({ length: 50 }, (_, i) => i);
  const out = shuffle(input, mulberry32(3));
  assert.notEqual(out, input);
  assert.deepEqual([...out].sort((a, b) => a - b), input);
  assert.deepEqual(out, shuffle(input, mulberry32(3)));
  assert.notDeepEqual(out, shuffle(input, mulberry32(4)));
  assert.notDeepEqual(out, input);
  assert.deepEqual(shuffle([], mulberry32(1)), []);
  assert.deepEqual(shuffle(['only'], mulberry32(1)), ['only']);
});

test('shuffle draws exactly n - 1 numbers from the generator, so a stream can be shared with later draws', () => {
  const rng = mulberry32(7);
  shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
  assert.equal(rng(), draw(7, 10)[9], 'the next number is the 10th of the stream');
  const rng2 = mulberry32(7);
  shuffle(['only'], rng2);
  assert.equal(rng2(), draw(7, 1)[0], 'a one-item array draws nothing');
});

test('shuffle: every position is reachable (a coarse uniformity check over many seeds)', () => {
  const counts = [0, 0, 0, 0];
  for (let seed = 0; seed < 400; seed++) counts[shuffle([0, 1, 2, 3], mulberry32(seed)).indexOf(0)]++;
  for (const c of counts) assert.ok(c > 60 && c < 140, `item 0 landed in each slot about 100 times, got ${counts}`);
});

test('sample: n distinct items, deterministic, all of them when n is large, none when n is 0', () => {
  const input = Array.from({ length: 20 }, (_, i) => i);
  const s = sample(input, 5, mulberry32(11));
  assert.equal(s.length, 5);
  assert.equal(new Set(s).size, 5);
  assert.ok(s.every((x) => input.includes(x)));
  assert.deepEqual(s, sample(input, 5, mulberry32(11)));
  assert.deepEqual(s, shuffle(input, mulberry32(11)).slice(0, 5));
  assert.equal(sample(input, 20, mulberry32(1)).length, 20);
  assert.equal(sample(input, 99, mulberry32(1)).length, 20);
  assert.deepEqual([...sample(input, 99, mulberry32(1))].sort((a, b) => a - b), input);
  assert.deepEqual(sample(input, 0, mulberry32(1)), []);
  assert.deepEqual(input, Array.from({ length: 20 }, (_, i) => i), 'input untouched');
});

test('sample rejects a bad n', () => {
  assert.throws(() => sample([1, 2], -1, mulberry32(1)), RangeError);
  assert.throws(() => sample([1, 2], 1.5, mulberry32(1)), RangeError);
  assert.throws(() => sample([1, 2], '2', mulberry32(1)), RangeError);
});
