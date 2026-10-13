// Seeded randomness: the same seed gives the same shuffle and the same bootstrap on every machine.

import { createHash } from 'node:crypto';

/** The first 4 bytes of SHA-256(utf8(s)) as a big-endian unsigned 32-bit integer. */
export function seedFromString(s) {
  return createHash('sha256').update(String(s), 'utf8').digest().readUInt32BE(0);
}

/** mulberry32: a tiny 32-bit generator. Returns a function giving floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates; returns a new array and leaves the input alone. */
export function shuffle(array, rng) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** n distinct items (all of them, shuffled, when n >= length). */
export function sample(array, n, rng) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`sample: n must be a non-negative integer, got ${n}`);
  return shuffle(array, rng).slice(0, n);
}
