import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactMcNemar, pairedBootstrapDelta, selfFlipRate, wilson } from '../agents/claim-tagger/scripts/lib/stats.mjs';

const close = (actual, expected, tol = 1e-12, msg = '') => assert.ok(Math.abs(actual - expected) <= tol, `${msg} expected ${expected}, got ${actual}`);
const closeRel = (actual, expected, rel = 1e-9) => assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected), `expected ${expected}, got ${actual}`);

// ---- wilson ----

test('wilson(8, 10) is about 0.49 to 0.94', () => {
  const w = wilson(8, 10);
  assert.equal(w.p, 0.8);
  close(w.lo, 0.49, 0.001);
  close(w.hi, 0.94, 0.004);
  // the standard formula, written out
  const z = 1.96;
  const n = 10;
  const p = 0.8;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  close(w.lo, centre - half);
  close(w.hi, centre + half);
});

test('wilson matches reference values computed in Python', () => {
  const cases = [
    [8, 10, 0.8, 0.49015684672072335, 0.9433190520193067],
    [0, 10, 0, 0, 0.2775401687666166],
    [10, 10, 1, 0.7224598312333834, 1],
    [1, 1, 1, 0.20654329147389294, 1],
    [5, 5, 1, 0.5655085052479191, 1],
    [0, 5, 0, 0, 0.43449149475208104],
    [45, 100, 0.45, 0.3561437510640346, 0.5475557296835656],
    [3, 60, 0.05, 0.01714919117914121, 0.13700734625099836],
  ];
  for (const [k, n, p, lo, hi] of cases) {
    const w = wilson(k, n);
    assert.equal(w.p, p, `p ${k}/${n}`);
    close(w.lo, lo, 1e-12, `lo ${k}/${n}`);
    close(w.hi, hi, 1e-12, `hi ${k}/${n}`);
  }
});

test('wilson: bounds stay in [0, 1], n = 0 knows nothing, z widens the interval, bad input throws', () => {
  for (let n = 1; n <= 30; n++) {
    for (let k = 0; k <= n; k++) {
      const w = wilson(k, n);
      assert.ok(w.lo >= 0 && w.hi <= 1 && w.lo <= w.p + 1e-12 && w.p <= w.hi + 1e-12, `${k}/${n}`);
    }
  }
  assert.deepEqual(wilson(0, 0), { p: 0, lo: 0, hi: 1 });
  const narrow = wilson(8, 10, 1.645);
  const wide = wilson(8, 10, 2.576);
  assert.ok(narrow.hi - narrow.lo < wilson(8, 10).hi - wilson(8, 10).lo);
  assert.ok(wide.hi - wide.lo > wilson(8, 10).hi - wilson(8, 10).lo);
  assert.throws(() => wilson(11, 10), RangeError);
  assert.throws(() => wilson(-1, 10), RangeError);
  assert.throws(() => wilson(1.5, 10), RangeError);
});

// ---- exact McNemar ----

test('exactMcNemar(0, 4) is exactly 0.125', () => {
  assert.equal(exactMcNemar(0, 4), 0.125);
  assert.equal(exactMcNemar(4, 0), 0.125);
});

test('exactMcNemar: no discordant pairs gives 1, ties give 1, the exact small cases', () => {
  assert.equal(exactMcNemar(0, 0), 1);
  assert.equal(exactMcNemar(3, 3), 1);
  assert.equal(exactMcNemar(1, 5), 0.21875); // 2 * (1 + 6) / 64
  assert.equal(exactMcNemar(0, 10), 0.001953125); // 2 / 1024
  assert.equal(exactMcNemar(2, 10), 0.03857421875);
  assert.equal(exactMcNemar(5, 1), exactMcNemar(1, 5), 'symmetric');
});

test('exactMcNemar matches exact big-integer arithmetic (Python) on larger counts', () => {
  close(exactMcNemar(7, 20), 0.0191572904586792, 1e-15);
  closeRel(exactMcNemar(450, 550), 0.0017305360849763176);
  closeRel(exactMcNemar(400, 700), 1.1735888055605814e-19, 1e-9);
  assert.equal(exactMcNemar(0, 1100) < 1e-300, true, 'underflows to a tiny number, never NaN');
  assert.ok(!Number.isNaN(exactMcNemar(0, 5000)));
});

test('exactMcNemar: the log-space branch (n > 1000) agrees with the exact branch at the boundary', () => {
  closeRel(exactMcNemar(451, 550), 0.0019371180914118246, 1e-9); // n = 1001
  assert.ok(Math.abs(exactMcNemar(500, 501) - 1) < 1e-9);
  assert.ok(exactMcNemar(300, 800) < exactMcNemar(310, 800));
});

test('exactMcNemar never exceeds 1 and rejects bad counts', () => {
  for (let b = 0; b <= 12; b++) for (let c = 0; c <= 12; c++) assert.ok(exactMcNemar(b, c) <= 1 && exactMcNemar(b, c) > 0);
  assert.throws(() => exactMcNemar(-1, 2), RangeError);
  assert.throws(() => exactMcNemar(1.5, 2), RangeError);
});

// ---- paired bootstrap ----

const FIXED4_OF_8 = [[0, 0, 0, 0, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1]];
const FIXED2_OF_6 = [[0, 0, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]];

test('bootstrap: n = 8 with 4 fixed and 0 broken has a lower bound above zero', () => {
  const r = pairedBootstrapDelta(...FIXED4_OF_8, { seed: 'gate-a' });
  assert.deepEqual(r, { n: 8, delta: 0.5, lo: 0.125, hi: 0.875 });
  assert.ok(r.lo > 0);
});

test('bootstrap: n = 6 with 2 fixed and 0 broken has a lower bound at or below zero', () => {
  const r = pairedBootstrapDelta(...FIXED2_OF_6, { seed: 'gate-b' });
  assert.equal(r.n, 6);
  assert.equal(r.delta, 1 / 3);
  assert.ok(r.lo <= 0, `lo ${r.lo}`);
  assert.equal(r.hi, 2 / 3);
});

test('bootstrap: the lower bound only clears zero from 4 fixed (0 broken) among 8 or among 60', () => {
  const sixty = (fixed) => [Array.from({ length: 60 }, (_, i) => (i < fixed ? 0 : 1)), Array(60).fill(1)];
  for (const seed of ['s1', 's2', 's3']) {
    assert.ok(pairedBootstrapDelta(...sixty(2), { seed }).lo <= 0, `2 fixed, ${seed}`);
    assert.ok(pairedBootstrapDelta(...sixty(5), { seed }).lo > 0, `5 fixed, ${seed}`);
  }
});

test('bootstrap reproduces the reference values of an independent Python implementation', () => {
  const mixedBase = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const mixedCand = [1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1];
  assert.deepEqual(pairedBootstrapDelta(mixedBase, mixedCand, { seed: 'gate-c' }), { n: 12, delta: 0.16666666666666666, lo: -0.16666666666666666, hi: 0.5 });
  assert.deepEqual(pairedBootstrapDelta(mixedBase, mixedCand), { n: 12, delta: 0.16666666666666666, lo: -0.08333333333333333, hi: 0.5 }, 'default seed');
  assert.deepEqual(pairedBootstrapDelta(mixedBase, mixedCand, { B: 200, seed: 's', ci: [0.1, 0.9] }), { n: 12, delta: 0.16666666666666666, lo: 0, hi: 0.3333333333333333 });
  const broken = [Array(20).fill(1), [...Array(15).fill(1), ...Array(5).fill(0)]];
  assert.deepEqual(pairedBootstrapDelta(...broken, { seed: 'gate-d' }), { n: 20, delta: -0.25, lo: -0.45, hi: -0.05 });
});

test('bootstrap percentiles: with B = 40 and ci [0.1, 0.9] the bounds are the 5th and the 36th smallest resampled delta', () => {
  // sorted[floor(0.1 * 40)] = sorted[4] and sorted[ceil(0.9 * 40) - 1] = sorted[35]; the neighbours differ for these seeds
  const base = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  const cand = [1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1];
  const opts = { B: 40, ci: [0.1, 0.9] };
  assert.deepEqual(pairedBootstrapDelta(base, cand, { ...opts, seed: 'b2' }), { n: 12, delta: 0.16666666666666666, lo: -0.08333333333333333, hi: 0.4166666666666667 });
  assert.deepEqual(pairedBootstrapDelta(base, cand, { ...opts, seed: 'b1' }), { n: 12, delta: 0.16666666666666666, lo: 0, hi: 0.3333333333333333 });
});

test('bootstrap: same seed, same answer; the seed can be a string or a number; seeds matter', () => {
  const base = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? 0 : 1));
  const cand = Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? 0 : 1));
  const one = pairedBootstrapDelta(base, cand, { seed: 'x' });
  assert.deepEqual(one, pairedBootstrapDelta(base, cand, { seed: 'x' }));
  assert.deepEqual(pairedBootstrapDelta(base, cand, { seed: 12345 }), pairedBootstrapDelta(base, cand, { seed: 12345 }));
  assert.equal(pairedBootstrapDelta(base, cand).delta, 0.15, 'the observed delta does not depend on the seed');
  const results = ['a', 'b', 'c', 'd', 'e', 'f'].map((seed) => JSON.stringify(pairedBootstrapDelta(base, cand, { seed })));
  assert.ok(new Set(results).size > 1, 'different seeds resample differently');
});

test('bootstrap: degenerate inputs', () => {
  assert.deepEqual(pairedBootstrapDelta([1, 1, 1], [1, 1, 1], { seed: 'q' }), { n: 3, delta: 0, lo: 0, hi: 0 });
  assert.deepEqual(pairedBootstrapDelta([0, 0, 0, 0, 0], [1, 1, 1, 1, 1], { seed: 'q' }), { n: 5, delta: 1, lo: 1, hi: 1 });
  assert.deepEqual(pairedBootstrapDelta([1, 1, 1, 1], [0, 0, 0, 0], { seed: 'q' }), { n: 4, delta: -1, lo: -1, hi: -1 });
  assert.deepEqual(pairedBootstrapDelta([], []), { n: 0, delta: 0, lo: 0, hi: 0 });
  assert.deepEqual(pairedBootstrapDelta([true, false], [true, true], { seed: 'q' }).delta, 0.5, 'booleans count as 0 and 1');
});

test('bootstrap: lo <= hi, and the interval brackets the observed delta for a mixed sample', () => {
  const base = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? 0 : 1));
  const cand = Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? 0 : 1));
  const r = pairedBootstrapDelta(base, cand, { seed: 'br' });
  assert.ok(r.lo <= r.delta && r.delta <= r.hi && r.lo <= r.hi, JSON.stringify(r));
});

test('bootstrap rejects unequal lengths and values other than 0 and 1', () => {
  assert.throws(() => pairedBootstrapDelta([1, 0], [1]), RangeError);
  assert.throws(() => pairedBootstrapDelta([1, 2], [1, 1]), RangeError);
  assert.throws(() => pairedBootstrapDelta([1, 1], [1, 'yes']), RangeError);
});

// ---- self flip ----

test('selfFlipRate: share of items whose decisions are not all the same', () => {
  assert.equal(selfFlipRate({ a: ['x', 'x', 'x'], b: ['x', 'y', 'x'], c: ['y', 'y', 'y'], d: ['x', 'x', 'z'] }), 0.5);
  assert.equal(selfFlipRate({ a: ['x', 'x', 'x'], b: ['y', 'y', 'y'] }), 0);
  assert.equal(selfFlipRate({ a: ['x', 'y', 'z'] }), 1);
  assert.equal(selfFlipRate({}), 0);
});

test('selfFlipRate: structured decisions, a Map, and items with fewer than two runs', () => {
  assert.equal(selfFlipRate({ a: [{ d: 'apply', p: 1 }, { d: 'apply', p: 1 }], b: [{ d: 'apply' }, { d: 'skip' }] }), 0.5);
  assert.equal(selfFlipRate(new Map([['a', ['x', 'y', 'x']], ['b', ['x', 'x', 'x']]])), 0.5);
  assert.equal(selfFlipRate({ a: ['x'], b: [] }), 0);
});
