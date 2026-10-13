// The small statistics the gate needs. Plain functions, deterministic, no dependencies.

import { mulberry32, seedFromString } from './rng.mjs';

/** Wilson score interval for k successes in n trials (z = 1.96 gives 95%). With n = 0 nothing is known: p 0, interval 0 to 1. */
export function wilson(k, n, z = 1.96) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || k > n) throw new RangeError(`wilson: need integers with 0 <= k <= n, got k=${k}, n=${n}`);
  if (n === 0) return { p: 0, lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const d = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

function bit(x) {
  if (x === 0 || x === false) return 0;
  if (x === 1 || x === true) return 1;
  throw new RangeError(`pairedBootstrapDelta: expected 0 or 1 per claim, got ${x}`);
}

/**
 * Paired percentile bootstrap of the change in accuracy (candidate minus baseline) over claims.
 * baseCorrect and candCorrect: equal-length arrays, 1 when that version tagged the claim correctly, else 0.
 * Resamples claim indices with replacement B times with mulberry32(seedFromString(seed)); the interval is the
 * ci[0] and ci[1] percentiles of the resampled deltas (no interpolation, so the bounds are values the statistic can take).
 */
export function pairedBootstrapDelta(baseCorrect, candCorrect, { B = 1000, seed = 'paired-bootstrap', ci = [0.025, 0.975] } = {}) {
  const n = baseCorrect.length;
  if (candCorrect.length !== n) throw new RangeError(`pairedBootstrapDelta: arrays differ in length (${n} and ${candCorrect.length})`);
  if (n === 0) return { n: 0, delta: 0, lo: 0, hi: 0 };
  const diff = new Int8Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    diff[i] = bit(candCorrect[i]) - bit(baseCorrect[i]);
    total += diff[i];
  }
  const rng = mulberry32(typeof seed === 'number' ? seed : seedFromString(seed));
  const deltas = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += diff[Math.floor(rng() * n)];
    deltas[b] = sum / n;
  }
  deltas.sort();
  const at = (i) => deltas[Math.min(B - 1, Math.max(0, i))];
  return { n, delta: total / n, lo: at(Math.floor(ci[0] * B + 1e-9)), hi: at(Math.ceil(ci[1] * B - 1e-9) - 1) };
}

/** Two-sided exact McNemar test: b and c are the two discordant counts. 1 when there are none. */
export function exactMcNemar(b, c) {
  if (!Number.isInteger(b) || !Number.isInteger(c) || b < 0 || c < 0) throw new RangeError(`exactMcNemar: need non-negative integers, got ${b} and ${c}`);
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let tail = 0; // P(X <= k) for X ~ Binomial(n, 1/2)
  if (n <= 1000) {
    let term = 2 ** -n; // exact for small n, which keeps results such as 0.125 exact
    for (let i = 0; i <= k; i++) {
      if (i > 0) term = (term * (n - i + 1)) / i;
      tail += term;
    }
  } else {
    let logTerm = -n * Math.LN2; // 2^-n would underflow
    for (let i = 0; i <= k; i++) {
      if (i > 0) logTerm += Math.log((n - i + 1) / i);
      tail += Math.exp(logTerm);
    }
  }
  return Math.min(1, 2 * tail);
}

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Share of items whose decisions are not all identical. runsByItem: { itemId: [decision of run 1, run 2, run 3] } (or a Map). */
export function selfFlipRate(runsByItem) {
  const lists = runsByItem instanceof Map ? [...runsByItem.values()] : Object.values(runsByItem);
  if (lists.length === 0) return 0;
  const flipped = lists.filter((d) => d.some((x) => !same(x, d[0]))).length;
  return flipped / lists.length;
}
