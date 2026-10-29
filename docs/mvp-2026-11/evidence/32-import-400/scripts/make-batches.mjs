// Stratified, seeded sample of the pool for scoring: per space a target size, spread over months (every month's claims up to a floor first).
//   node make-batches.mjs <scratch dir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { mulberry32, seedFromString } = await import(pathToFileURL('X:/work/geo-agents/agents/claim-tagger-mvp/scripts/lib/rng.mjs').href);
const dir = process.argv[2];
const pool = JSON.parse(readFileSync(join(dir, 'pool.json'), 'utf8')).claims;
const SAMPLE = { 'U.S. Politics': 800, 'World affairs': 800, AI: 600, Health: 402, Crypto: 158, Technology: 56 };
const FLOOR = 40; // a month keeps up to this many before the rest is shared out

const shuffle = (list, seed) => {
  const rnd = mulberry32(seedFromString(seed));
  const a = [...list].sort((x, y) => (x.geo_id < y.geo_id ? -1 : 1));
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

const picked = [];
for (const [space, n] of Object.entries(SAMPLE)) {
  const months = {};
  for (const c of pool.filter((c) => c.space === space)) (months[c.month] ??= []).push(c);
  const lists = Object.fromEntries(Object.entries(months).map(([m, l]) => [m, shuffle(l, `import-2026-10-29|${space}|${m}`)]));
  const take = Object.fromEntries(Object.keys(lists).map((m) => [m, Math.min(FLOOR, lists[m].length)]));
  let left = n - Object.values(take).reduce((s, x) => s + x, 0);
  // the rest in proportion to what each month still has
  const room = () => Object.keys(lists).filter((m) => take[m] < lists[m].length);
  while (left > 0 && room().length) {
    const r = room();
    const total = r.reduce((s, m) => s + lists[m].length - take[m], 0);
    let given = 0;
    for (const m of r) {
      const g = Math.min(lists[m].length - take[m], Math.max(1, Math.floor((left * (lists[m].length - take[m])) / total)));
      const gg = Math.min(g, left - given);
      take[m] += gg; given += gg;
      if (given >= left) break;
    }
    left -= given;
  }
  for (const m of Object.keys(lists)) picked.push(...lists[m].slice(0, take[m]));
}

const all = shuffle(picked, 'import-2026-10-29|batches');
const SIZE = 470;
mkdirSync(join(dir, 'batches'), { recursive: true });
let b = 0;
for (let i = 0; i < all.length; i += SIZE, b++) {
  const lines = all.slice(i, i + SIZE).map((c) => JSON.stringify({ id: c.geo_id, text: c.name }));
  writeFileSync(join(dir, 'batches', `batch-${b + 1}.jsonl`), `${lines.join('\n')}\n`);
}
console.log({ sampled: all.length, batches: b });
