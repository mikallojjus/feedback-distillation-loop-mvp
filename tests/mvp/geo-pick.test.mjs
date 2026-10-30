import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  USAGE, allocateMonths, dayOf, main, monthOf, normaliseName, planTargets, runPick,
} from '../../agents/claim-tagger-mvp/scripts/geo-pick.mjs';
import { countGeoRequests } from '../../agents/claim-tagger-mvp/scripts/lib/geo-read.mjs';
import { validate } from '../../agents/claim-tagger-mvp/scripts/lib/validate.mjs';
import { createFakeGeo, hexId } from './fixtures/fake-geo.mjs';

// The pick runs against the in-memory fake Geo in a temporary state folder: no network, no Notion, no .env.

const CONFIG = JSON.parse(readFileSync(new URL('../../agents/claim-tagger-mvp/config.json', import.meta.url), 'utf8'));
const GEO = CONFIG.geo;
const SCHEMA = JSON.parse(readFileSync(new URL('../../agents/claim-tagger-mvp/schemas/geo-pick.schema.json', import.meta.url), 'utf8'));
const SPACES = GEO.spaces.map((s) => s.name);
const [US, WORLD, AI, HEALTH, CRYPTO, TECH] = SPACES;
const SPACE_ID = Object.fromEntries(GEO.spaces.map((s) => [s.name, s.id]));
const OUTSIDE = hexId(900, 'b'); // a space that is not one of the six
const NOW = () => new Date('2026-10-27T09:30:00.000Z');
const noSleep = async () => {};
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-geo-pick-'));
  dirs.push(d);
  return d;
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const lines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** The geo block with other quotas (a list of six); the total follows. */
function scaled(quotas) {
  const geo = clone(GEO);
  geo.spaces.forEach((s, i) => { s.quota = quotas[i]; });
  geo.total = quotas.reduce((a, b) => a + b, 0);
  return geo;
}

/**
 * A fake Geo with claims: plan maps a space name to { 'YYYY-MM': count }. Every claim has its own id and name; every second one has a source with a Web
 * URL, every fifth a second source without one, and some carry Is factual and extra tags. Returns { fake, geo, ids } with ids: space -> month -> [id].
 */
function makeWorld(plan, { geo = GEO } = {}) {
  const fake = createFakeGeo({ geo });
  const ids = new Map();
  let n = 0;
  for (const [space, months] of Object.entries(plan)) {
    const bySpace = new Map();
    ids.set(space, bySpace);
    for (const [month, count] of Object.entries(months)) {
      const list = [];
      for (let i = 0; i < count; i++) {
        n += 1;
        const id = hexId(n);
        const sources = [];
        if (n % 2 === 0) sources.push({ id: hexId(n, 'e'), name: `Source ${n}`, url: `https://example.com/article-${n}` });
        if (n % 5 === 0) sources.push({ id: hexId(n, 'f'), name: `Archive ${n}`, url: null });
        fake.addClaim({
          id,
          name: `${space} claim ${n}`,
          spaces: [SPACE_ID[space]],
          created: `${month}-${String(1 + (i % 27)).padStart(2, '0')}`,
          tags: n % 4 === 0 ? ['Featured'] : n % 7 === 0 ? ['Hypothetical'] : [],
          sources,
          topics: n % 3 === 0 ? ['Elections'] : [],
          isFactual: n % 3 === 0 ? true : n % 3 === 1 ? false : undefined,
        });
        list.push(id);
      }
      bySpace.set(month, list);
    }
  }
  return { fake, geo, ids, nextN: () => (n += 1) };
}

const BIG = {
  [US]: { '2026-08': 12, '2026-09': 40, '2026-10': 90 },
  [WORLD]: { '2026-08': 5, '2026-09': 30, '2026-10': 60 },
  [AI]: { '2026-09': 50, '2026-10': 80 },
  [HEALTH]: { '2026-07': 8, '2026-08': 20, '2026-09': 40 },
  [CRYPTO]: { '2026-09': 30, '2026-10': 30 },
  [TECH]: { '2026-09': 24, '2026-10': 50 },
};

function writeAudit(ids, dir = tmp()) {
  const file = join(dir, 'audit.json');
  writeFileSync(file, `${JSON.stringify({ source: 'a test', decisions: ids.map((id) => ({ geo_id: id, claim: 'x' })) }, null, 2)}\n`);
  return file;
}
const GHOST = hexId(77777, 'a');

/** Run the pick in a fresh state folder (or the given one). */
async function pick(w, { seed = 'seed-1', audit = writeAudit([GHOST]), root = tmp(), ...rest } = {}) {
  const r = await runPick({ root, config: { geo: w.geo }, seed, auditFile: audit, fetchImpl: w.fake.fetchImpl, now: NOW, sleep: noSleep, ...rest });
  return { ...r, root, audit };
}
const bySpace = (rows) => Object.fromEntries(SPACES.map((s) => [s, rows.filter((r) => r['Geo Space'] === s).length]));
const rowIds = (r) => r.pick.rows.map((x) => x['Geo ID']);

// ---- the pure pieces ------------------------------------------------------------------------------------------------------------

test('allocateMonths: floor(q/m) per month capped at the month, the remainder one at a time, oldest first', () => {
  const alloc = (q, months) => Object.fromEntries(allocateMonths(q, months));
  assert.deepEqual(alloc(10, [{ month: 'a', pop: 100, forced: 0 }, { month: 'b', pop: 100, forced: 0 }, { month: 'c', pop: 100, forced: 0 }]), { a: 4, b: 3, c: 3 }, '10 over 3: the oldest takes the extra');
  assert.deepEqual(alloc(11, [{ month: 'a', pop: 100, forced: 0 }, { month: 'b', pop: 100, forced: 0 }, { month: 'c', pop: 100, forced: 0 }]), { a: 4, b: 4, c: 3 });
  assert.deepEqual(alloc(50, [{ month: 'a', pop: 3, forced: 0 }, { month: 'b', pop: 100, forced: 0 }, { month: 'c', pop: 100, forced: 0 }]), { a: 3, b: 24, c: 23 }, 'a small month is capped and the rest goes to the others, oldest first');
  assert.deepEqual(alloc(50, [{ month: 'a', pop: 12, forced: 0 }, { month: 'b', pop: 40, forced: 0 }, { month: 'c', pop: 90, forced: 0 }]), { a: 12, b: 19, c: 19 });
  assert.deepEqual(alloc(10, [{ month: 'a', pop: 2, forced: 0 }, { month: 'b', pop: 2, forced: 0 }, { month: 'c', pop: 2, forced: 0 }]), { a: 2, b: 2, c: 2 }, 'a quota above the population gives the whole population');
  assert.deepEqual(alloc(7, [{ month: 'only', pop: 100, forced: 0 }]), { only: 7 });
  assert.deepEqual(alloc(5, []), {});
  assert.deepEqual(alloc(0, [{ month: 'a', pop: 5, forced: 0 }]), { a: 0 });
});

test('allocateMonths: forced claims fill their month\'s share first, and a month never gets fewer than its forced claims', () => {
  const alloc = (q, months) => Object.fromEntries(allocateMonths(q, months));
  assert.deepEqual(alloc(10, [{ month: 'a', pop: 100, forced: 6 }, { month: 'b', pop: 100, forced: 0 }, { month: 'c', pop: 100, forced: 0 }]), { a: 6, b: 2, c: 2 });
  assert.deepEqual(alloc(10, [{ month: 'a', pop: 100, forced: 2 }, { month: 'b', pop: 100, forced: 0 }, { month: 'c', pop: 100, forced: 0 }]), { a: 4, b: 3, c: 3 }, 'a forced claim inside the share changes nothing');
  assert.deepEqual(alloc(9, [{ month: 'a', pop: 100, forced: 5 }, { month: 'b', pop: 100, forced: 4 }, { month: 'c', pop: 100, forced: 0 }]), { a: 5, b: 4, c: 0 });
  assert.equal([...allocateMonths(9, [{ month: 'a', pop: 100, forced: 5 }, { month: 'b', pop: 100, forced: 4 }, { month: 'c', pop: 100, forced: 0 }]).values()].reduce((a, b) => a + b, 0), 9);
});

test('planTargets: a short space passes its rest round-robin to the others in canonical order, only while they have room', () => {
  const spaces = [{ name: 'A', quota: 5 }, { name: 'B', quota: 5 }, { name: 'C', quota: 5 }, { name: 'D', quota: 5 }];
  const plan = planTargets(spaces, new Map([['A', 2], ['B', 100], ['C', 100], ['D', 5]]));
  assert.deepEqual(Object.fromEntries(plan.targets), { A: 2, B: 7, C: 6, D: 5 });
  assert.deepEqual(plan.moves, [{ from: 'A', to: 'B', count: 2 }, { from: 'A', to: 'C', count: 1 }]);
  assert.deepEqual(Object.fromEntries(plan.moved_in), { A: 0, B: 2, C: 1, D: 0 });
  assert.deepEqual(Object.fromEntries(plan.moved_out), { A: 3, B: 0, C: 0, D: 0 });
  assert.equal(plan.unplaced, 0);
  const tight = planTargets(spaces, new Map([['A', 1], ['B', 6], ['C', 5], ['D', 5]]));
  assert.deepEqual(Object.fromEntries(tight.targets), { A: 1, B: 6, C: 5, D: 5 });
  assert.equal(tight.unplaced, 3, 'only B had one claim to spare');
  const two = planTargets(spaces, new Map([['A', 3], ['B', 4], ['C', 100], ['D', 100]]));
  assert.deepEqual(Object.fromEntries(two.targets), { A: 3, B: 4, C: 7, D: 6 }, 'two short spaces: A passes 2 first (to C, D), then B passes 1 (to C)');
  assert.deepEqual(two.moves.map((m) => `${m.from}>${m.to}:${m.count}`), ['A>C:1', 'A>D:1', 'B>C:1']);
});

test('normaliseName, monthOf and dayOf', () => {
  assert.equal(normaliseName('  The Sky   is\tBlue. '), 'the sky is blue');
  assert.equal(normaliseName('the sky is blue'), 'the sky is blue');
  assert.equal(normaliseName('Why?'), 'why?');
  assert.equal(normaliseName(null), '');
  assert.equal(monthOf('1792050522'), '2026-10');
  assert.equal(dayOf('1792050522'), '2026-10-15');
  assert.equal(monthOf(String(Date.parse('2026-08-31T23:59:59Z') / 1000)), '2026-08', 'the month is the UTC month');
  assert.equal(monthOf(String(Date.parse('2026-09-01T00:00:00Z') / 1000)), '2026-09');
  for (const bad of [null, undefined, '', 'x', '0', '-5', NaN]) assert.equal(monthOf(bad), null, String(bad));
});

// ---- the whole pick -------------------------------------------------------------------------------------------------------------

test('quotas are met: 200 rows, 50 / 50 / 40 / 30 / 20 / 10, each month\'s share even, rows sorted, every row on the schema', async () => {
  const w = makeWorld(BIG);
  const r = await pick(w);
  assert.equal(r.code, 0, r.line);
  assert.match(r.line, /^geo-pick: 200 claims \(0 from the audit, 1 audit claim left out, seed "seed-1"\) -> /);
  assert.equal(r.pick.rows.length, 200);
  assert.deepEqual(bySpace(r.pick.rows), { [US]: 50, [WORLD]: 50, [AI]: 40, [HEALTH]: 30, [CRYPTO]: 20, [TECH]: 10 });
  assert.equal(new Set(rowIds(r)).size, 200, 'no claim twice');
  assert.deepEqual(r.pick.allocation[US].months, { '2026-08': 12, '2026-09': 19, '2026-10': 19 });
  assert.deepEqual(r.pick.allocation[WORLD].months, { '2026-08': 5, '2026-09': 23, '2026-10': 22 });
  assert.deepEqual(r.pick.allocation[AI].months, { '2026-09': 20, '2026-10': 20 });
  assert.deepEqual(r.pick.allocation[HEALTH].months, { '2026-07': 8, '2026-08': 11, '2026-09': 11 });
  assert.deepEqual(r.pick.allocation[CRYPTO].months, { '2026-09': 10, '2026-10': 10 });
  assert.deepEqual(r.pick.allocation[TECH].months, { '2026-09': 5, '2026-10': 5 });
  for (const s of SPACES) {
    const a = r.pick.allocation[s];
    assert.equal(a.picked, GEO.spaces.find((x) => x.name === s).quota);
    assert.equal(a.quota, a.picked);
    assert.deepEqual([a.moved_in, a.moved_out], [0, 0]);
    assert.equal(Object.values(a.months).reduce((x, y) => x + y, 0), a.picked);
  }
  // the rows are real claims of the right space and month, in space, month, Geo ID order
  const order = r.pick.rows.map((x) => [SPACES.indexOf(x['Geo Space']), x.month, x['Geo ID']]);
  assert.deepEqual(order, [...order].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || (a[2] < b[2] ? -1 : 1)));
  for (const x of r.pick.rows) {
    assert.ok(w.ids.get(x['Geo Space']).get(x.month).includes(x['Geo ID']), 'the claim is in that space and month');
    assert.equal(x['Geo URL'], `https://www.geobrowser.io/space/${SPACE_ID[x['Geo Space']]}/${x['Geo ID']}`);
    assert.equal(x['Geo Created'].slice(0, 7), x.month);
  }
  assert.deepEqual(validate(SCHEMA, r.pick).errors, []);
  assert.deepEqual(JSON.parse(readFileSync(r.path, 'utf8')), r.pick, 'the file holds the pick');
  assert.equal(r.path, join(r.root, 'setup', 'geo-claims-pick.json'));
  assert.deepEqual(Object.keys(r.pick), ['pick_version', 'seed', 'endpoint', 'fetched_at', 'spec', 'populations', 'duplicates', 'allocation', 'audit', 'tag_names', 'rows']);
  assert.equal(r.pick.fetched_at, '2026-10-27T09:30:00.000Z');
  assert.equal(r.pick.endpoint, GEO.endpoint);
  assert.deepEqual(r.pick.spec, { total: 200, spaces: GEO.spaces });
  assert.deepEqual(r.pick.populations[US], { total: 142, months: { '2026-08': 12, '2026-09': 40, '2026-10': 90 } });
});

test('the pick file is byte for byte what it was before the row builder moved to lib/geo-row.mjs (P35)', async () => {
  const w = makeWorld(BIG);
  const r = await pick(w);
  assert.equal(r.code, 0, r.line);
  // the one thing that differs from run to run is the path of the audit file (a temporary folder); everything else is fixed by the seed, the fake Geo and the clock
  const bytes = readFileSync(r.path, 'utf8').split(JSON.stringify(r.pick.audit.file)).join('"AUDIT_FILE"');
  const sha = createHash('sha256').update(bytes).digest('hex');
  // pinned with the code of claims-hub-2026-10, before the move: the same seed and the same fake Geo gave exactly these bytes
  assert.equal(sha, '3c543eb460cd63ddfd48cdc7494e4640ea52b178fea37cb00f6ebfd3d1ef6dfb');
});

test('the run folder holds report.md, report.json and requests.jsonl, and the log has queries only and no bodies', async () => {
  const w = makeWorld(BIG);
  const r = await pick(w);
  assert.match(r.runDir, /runs[\\/]geo-pick[\\/]20261027T093000Z-geo-pick$/);
  assert.deepEqual(readdirSync(r.runDir).sort(), ['report.json', 'report.md', 'requests.jsonl']);
  const log = join(r.runDir, 'requests.jsonl');
  const rows = lines(log);
  assert.equal(rows.length, w.fake.requests.length);
  assert.ok(rows.every((x) => Object.keys(x).join() === 'ts,host,op,status,attempt'));
  assert.deepEqual(countGeoRequests(log), { total: rows.length, nonQuery: 0 });
  assert.equal(w.fake.requests.every((x) => x.rejected === false && Object.keys(x.headers).join() === 'Content-Type'), true);
  // 6 spaces, one or two pages each (the biggest has 142 links at 500 per page: one), 200 details in batches of 25, plus the ghost audit claim
  assert.equal(w.fake.requestsFor('DebateTagged').length, 6);
  assert.deepEqual(w.fake.requestsFor('ClaimDetails').map((x) => x.aliases), [1, 25, 25, 25, 25, 25, 25, 25, 25], 'the audit claim that no space holds is looked up first, then the 200 picked claims');
  const json = JSON.parse(readFileSync(join(r.runDir, 'report.json'), 'utf8'));
  assert.equal(json.state, 'ok');
  assert.deepEqual(json.requests, { total: rows.length, nonQuery: 0 });
  assert.equal(json.rows, 200);
  const md = readFileSync(join(r.runDir, 'report.md'), 'utf8');
  for (const heading of ['## Populations', '### Claims per month', '## Allocation', '### Moves', '## Duplicates', '## Audit claims', '## Warnings', '## Requests']) assert.ok(md.includes(heading), heading);
  assert.ok(md.includes('| 2026-10 |'), 'each space\'s month histogram is shown');
  const again = await pick(w, { root: r.root, audit: r.audit, replace: true });
  assert.match(again.runDir, /20261027T093000Z-geo-pick-2$/, 'a second run in the same second gets its own folder');
});

test('the report flags the month that holds over half of all claims as the likely migration month', async () => {
  const w = makeWorld(BIG); // 2026-10 holds 310 of 569
  const r = await pick(w);
  const md = readFileSync(join(r.runDir, 'report.md'), 'utf8');
  assert.match(md, /2026-10 holds 54% of all claims \(310 of 569\): likely the migration month \(createdAt is flattened on migrated entities\)\./);
  const json = JSON.parse(readFileSync(join(r.runDir, 'report.json'), 'utf8'));
  assert.deepEqual(json.dominant_month, { month: '2026-10', count: 310, of: 569, share: 310 / 569 });
  assert.deepEqual(json.month_totals, { '2026-07': 8, '2026-08': 37, '2026-09': 214, '2026-10': 310 });

  const even = makeWorld(Object.fromEntries(SPACES.map((s) => [s, { '2026-08': 40, '2026-09': 40, '2026-10': 40 }])));
  const r2 = await pick(even);
  assert.equal(r2.code, 0, r2.line);
  const md2 = readFileSync(join(r2.runDir, 'report.md'), 'utf8');
  assert.equal(md2.includes('migration month'), false);
  assert.match(md2, /No month holds more than 50% of all claims\./);
  assert.equal(JSON.parse(readFileSync(join(r2.runDir, 'report.json'), 'utf8')).dominant_month, null);
  const exactlyHalf = makeWorld(Object.fromEntries(SPACES.map((s) => [s, { '2026-08': 10, '2026-10': 10 }])));
  const r3 = await runPick({ root: tmp(), config: { geo: scaled([5, 5, 4, 3, 2, 1]) }, seed: 's', auditFile: writeAudit([GHOST]), fetchImpl: exactlyHalf.fake.fetchImpl, now: NOW, sleep: noSleep });
  assert.equal(JSON.parse(readFileSync(join(r3.runDir, 'report.json'), 'utf8')).dominant_month, null, 'exactly half is not over half');
});

test('a space with fewer claims than its quota passes the shortfall round-robin to the others, and the report shows every move', async () => {
  const plan = { ...BIG, [TECH]: { '2026-10': 4 } };
  const w = makeWorld(plan);
  const r = await pick(w);
  assert.equal(r.code, 0, r.line);
  assert.equal(r.pick.rows.length, 200);
  assert.deepEqual(bySpace(r.pick.rows), { [US]: 52, [WORLD]: 51, [AI]: 41, [HEALTH]: 31, [CRYPTO]: 21, [TECH]: 4 });
  assert.deepEqual([r.pick.allocation[TECH].moved_out, r.pick.allocation[TECH].moved_in, r.pick.allocation[TECH].picked, r.pick.allocation[TECH].quota], [6, 0, 4, 10]);
  assert.deepEqual(SPACES.map((s) => r.pick.allocation[s].moved_in), [2, 1, 1, 1, 1, 0]);
  assert.deepEqual(r.pick.allocation[US].months, { '2026-08': 12, '2026-09': 20, '2026-10': 20 }, 'the even spread uses the larger quota');
  assert.deepEqual(r.pick.populations[TECH], { total: 4, months: { '2026-10': 4 } });
  const json = JSON.parse(readFileSync(join(r.runDir, 'report.json'), 'utf8'));
  assert.deepEqual(json.shortfall_moves, [
    { from: TECH, to: US, count: 2 }, { from: TECH, to: WORLD, count: 1 }, { from: TECH, to: AI, count: 1 }, { from: TECH, to: HEALTH, count: 1 }, { from: TECH, to: CRYPTO, count: 1 },
  ]);
  const md = readFileSync(join(r.runDir, 'report.md'), 'utf8');
  assert.ok(md.includes(`- ${TECH} -> ${US}: 2 claims (the space has fewer claims than its quota)`));
  assert.ok(md.includes(`- ${TECH} -> ${WORLD}: 1 claim (the space has fewer claims than its quota)`));
});

test('when Geo holds fewer usable claims than the total, nothing is written and the exit code is 2', async () => {
  const w = makeWorld(Object.fromEntries(SPACES.map((s) => [s, { '2026-10': 10 }])));
  const r = await pick(w);
  assert.equal(r.code, 2);
  assert.match(r.line, /Geo holds only enough usable claims for 60 of the 200; nothing was written/);
  assert.equal(existsSync(join(r.root, 'setup', 'geo-claims-pick.json')), false);
  assert.equal(JSON.parse(readFileSync(join(r.runDir, 'report.json'), 'utf8')).state, 'invalid');
});

test('claims with an empty name, claims without a creation time and entities that are not Claims never enter a population', async () => {
  const geo = scaled([3, 3, 3, 3, 3, 3]);
  const w = makeWorld(Object.fromEntries(SPACES.map((s) => [s, { '2026-09': 6 }])), { geo });
  const sp = SPACE_ID[US];
  w.fake.addClaim({ id: hexId(5001), name: '', spaces: [sp], created: '2026-09-02' });
  w.fake.addClaim({ id: hexId(5002), name: '   \t', spaces: [sp], created: '2026-09-02' });
  w.fake.addClaim({ id: hexId(5003), name: 'An article, not a claim', spaces: [sp], created: '2026-09-02', typeIds: [hexId(321, 'a')] });
  w.fake.addClaim({ id: hexId(5004), name: 'A claim nobody dated', spaces: [sp], created: null });
  w.fake.addClaim({ id: hexId(5005), name: 'Tagged twice in its space', spaces: [sp], created: '2026-09-03', repeatEdge: true });
  const r = await pick(w, { audit: writeAudit([hexId(5001), hexId(5003)]) });
  assert.equal(r.code, 0, r.line);
  assert.equal(r.pick.populations[US].total, 7, '6 plain claims and the one tagged twice, counted once');
  const dropped = JSON.parse(readFileSync(join(r.runDir, 'report.json'), 'utf8')).fetch[US];
  assert.deepEqual(dropped, { edges: 12, dropped: { not_claim: 1, empty_name: 2, bad_id: 0, no_created_at: 1, repeat_edges: 1, other_space: 0 }, cross_space_removed: 0 });
  const ids = new Set(rowIds(r));
  for (const bad of [5001, 5002, 5003, 5004]) assert.equal(ids.has(hexId(bad)), false, `claim ${bad} is not picked`);
  assert.deepEqual(r.pick.audit.included, []);
  assert.deepEqual(r.pick.audit.left_out.map((l) => l.reason), [
    `tagged Debate in ${US}, but it is not counted: the claim has no name`,
    `tagged Debate in ${US}, but it is not counted: the entity is not a Claim`,
  ]);
  assert.ok(r.pick.rows.every((x) => x['Geo Name'].trim() !== ''));
});

test('audit claims in a population are forced into their space and month and count toward the quota; the others are left out with their reasons', async () => {
  const w = makeWorld(BIG);
  const sp = (s) => SPACE_ID[s];
  const baseline = await pick(w);
  const picked = new Set(rowIds(baseline));
  const unpicked = (space, month) => w.ids.get(space).get(month).find((id) => !picked.has(id));
  const forcedUs = unpicked(US, '2026-10');
  const forcedCrypto = unpicked(CRYPTO, '2026-09');
  assert.ok(forcedUs && forcedCrypto);
  const dual = hexId(6001);
  w.fake.addClaim({ id: dual, name: 'A claim tagged in two spaces', spaces: [sp(CRYPTO), sp(HEALTH)], created: '2026-09-09', sources: [{ id: hexId(6001, 'e'), name: 'Shared source', url: 'https://example.com/shared' }] });
  const outside = hexId(6002);
  w.fake.addClaim({ id: outside, name: 'Tagged Debate only in a space that is not picked from', spaces: [OUTSIDE], created: '2026-09-09' });
  const notClaim = hexId(6003);
  w.fake.addClaim({ id: notClaim, name: 'Tagged Debate but not a claim', spaces: [sp(US)], created: '2026-09-09', typeIds: [hexId(321, 'a')] });
  const untagged = hexId(6004);
  w.fake.addEntity({ id: untagged, name: 'A claim with no Debate tag', typeIds: [GEO.ids.claim_type], spaceIds: [sp(US)], createdAt: '1790000000' });
  const ghost = hexId(6005);
  const auditIds = [forcedUs, ghost, outside, forcedCrypto, notClaim, untagged, dual];
  const audit = writeAudit(auditIds);
  const r = await pick(w, { audit });
  assert.equal(r.code, 0, r.line);

  const rows = new Map(r.pick.rows.map((x) => [x['Geo ID'], x]));
  assert.equal(rows.has(forcedUs), true, 'an audit claim that the sample alone did not pick is forced in');
  assert.equal(rows.has(forcedCrypto), true);
  assert.equal(rows.get(forcedUs)['Geo Space'], US);
  assert.equal(rows.get(forcedUs).month, '2026-10');
  assert.equal(rows.get(forcedCrypto)['Geo Space'], CRYPTO);
  assert.equal(rows.get(dual)['Geo Space'], HEALTH, 'a claim in two spaces goes to the first in canonical order');
  assert.deepEqual(r.pick.audit.included, [forcedUs, forcedCrypto, dual], 'in the audit file\'s order');
  assert.deepEqual(r.pick.audit.left_out, [
    { geo_id: ghost, reason: 'not tagged Debate in a canonical space (Geo holds no such entity)' },
    { geo_id: outside, reason: `not tagged Debate in a canonical space (tagged Debate in space ${OUTSIDE}, which is not one of the 6 pick spaces)` },
    { geo_id: notClaim, reason: `tagged Debate in ${US}, but it is not counted: the entity is not a Claim` },
    { geo_id: untagged, reason: 'not tagged Debate in a canonical space' },
  ]);
  assert.equal(r.pick.audit.sha256, createHash('sha256').update(readFileSync(audit)).digest('hex'));
  assert.equal(r.pick.audit.file.replace(/\\/g, '/'), audit.replace(/\\/g, '/'), 'a file outside the repository is named by its full path');
  assert.equal(rows.get(dual)['Geo Sources'], 'Shared source');

  // they count toward the quota and their month's share: the same counts as without them
  assert.equal(r.pick.rows.length, 200);
  assert.deepEqual(bySpace(r.pick.rows), { [US]: 50, [WORLD]: 50, [AI]: 40, [HEALTH]: 30, [CRYPTO]: 20, [TECH]: 10 });
  assert.equal(r.pick.allocation[US].months['2026-10'], 19);
  assert.equal(r.pick.allocation[CRYPTO].months['2026-09'], 10);
  assert.deepEqual(r.pick.duplicates.cross_space, [{ geo_id: dual, name: 'A claim tagged in two spaces', kept_in: HEALTH, also_in: [CRYPTO] }]);
  assert.equal(r.pick.populations[CRYPTO].total, 60, 'the claim tagged in two spaces counts once, in Health');
  assert.equal(r.pick.populations[HEALTH].total, 69);
  const md = readFileSync(join(r.runDir, 'report.md'), 'utf8');
  assert.ok(md.includes(`\`${ghost}\`: not tagged Debate in a canonical space (Geo holds no such entity)`));
  assert.deepEqual(validate(SCHEMA, r.pick).errors, []);
});

test('audit claims with the same text: the first is forced, the second is left out and recorded; two audit claims beyond a quota are an error', async () => {
  const geo = scaled([3, 3, 3, 3, 3, 3]);
  const w = makeWorld(Object.fromEntries(SPACES.map((s) => [s, { '2026-09': 8 }])), { geo });
  const a = hexId(7001);
  const b = hexId(7002);
  w.fake.addClaim({ id: a, name: 'Taxes should go up.', spaces: [SPACE_ID[US]], created: '2026-09-02' });
  w.fake.addClaim({ id: b, name: 'taxes   should GO up', spaces: [SPACE_ID[US]], created: '2026-09-03' });
  const r = await pick(w, { audit: writeAudit([a, b]) });
  assert.equal(r.code, 0, r.line);
  assert.deepEqual(r.pick.audit.included, [a]);
  assert.deepEqual(r.pick.audit.left_out, [{ geo_id: b, reason: `same text as the audit claim ${a}, which is already in the pick` }]);
  assert.equal(rowIds(r).includes(b), false);
  assert.deepEqual(r.pick.duplicates.text, [{ geo_id: b, name: 'taxes   should GO up', space: US, month: '2026-09', same_as: a, same_as_space: US }]);

  const tiny = scaled([1, 3, 3, 3, 3, 3]);
  const w2 = makeWorld(Object.fromEntries(SPACES.map((s) => [s, { '2026-09': 8 }])), { geo: tiny });
  w2.fake.addClaim({ id: a, name: 'One', spaces: [SPACE_ID[US]], created: '2026-09-02' });
  w2.fake.addClaim({ id: b, name: 'Two', spaces: [SPACE_ID[US]], created: '2026-09-03' });
  const r2 = await pick(w2, { audit: writeAudit([a, b]) });
  assert.equal(r2.code, 2);
  assert.match(r2.line, new RegExp(`${US.replace('.', '\\.')} has 2 audit claims but a target of only 1`));
  assert.equal(existsSync(join(r2.root, 'setup', 'geo-claims-pick.json')), false);
});

test('a claim tagged in more than one space stays in the first canonical space; every such case is recorded', async () => {
  const geo = scaled([3, 3, 3, 3, 3, 3]);
  const w = makeWorld(Object.fromEntries(SPACES.map((s) => [s, { '2026-09': 8 }])), { geo });
  const x = hexId(8001);
  const y = hexId(8002);
  w.fake.addClaim({ id: x, name: 'In Health, Crypto and Technology', spaces: [SPACE_ID[TECH], SPACE_ID[CRYPTO], SPACE_ID[HEALTH]], created: '2026-09-05' });
  w.fake.addClaim({ id: y, name: 'In World affairs and AI', spaces: [SPACE_ID[AI], SPACE_ID[WORLD]], created: '2026-09-06' });
  const r = await pick(w);
  assert.equal(r.code, 0, r.line);
  assert.deepEqual(r.pick.duplicates.cross_space, [
    { geo_id: x, name: 'In Health, Crypto and Technology', kept_in: HEALTH, also_in: [CRYPTO, TECH] },
    { geo_id: y, name: 'In World affairs and AI', kept_in: WORLD, also_in: [AI] },
  ]);
  assert.deepEqual([r.pick.populations[HEALTH].total, r.pick.populations[CRYPTO].total, r.pick.populations[TECH].total, r.pick.populations[WORLD].total, r.pick.populations[AI].total], [9, 8, 8, 9, 8]);
  for (const row of r.pick.rows.filter((q) => [x, y].includes(q['Geo ID']))) assert.equal(row['Geo Space'], row['Geo ID'] === x ? HEALTH : WORLD);
  assert.equal(rowIds(r).length, new Set(rowIds(r)).size);
  const json = JSON.parse(readFileSync(join(r.runDir, 'report.json'), 'utf8'));
  assert.equal(json.fetch[CRYPTO].cross_space_removed, 1);
  assert.equal(json.fetch[TECH].cross_space_removed, 1);
  assert.equal(json.fetch[AI].cross_space_removed, 1);
  assert.equal(json.fetch[HEALTH].cross_space_removed, 0);
});

test('no two picked claims have the same text; the later one in the sample is skipped and recorded, and the space passes the gap on', async () => {
  const geo = scaled([4, 3, 3, 3, 3, 3]);
  const plan = { [US]: {}, [WORLD]: { '2026-09': 9 }, [AI]: { '2026-09': 9 }, [HEALTH]: { '2026-09': 9 }, [CRYPTO]: { '2026-09': 9 }, [TECH]: { '2026-09': 9 } };
  const w = makeWorld(plan, { geo });
  const first = hexId(9001);
  const second = hexId(9002);
  w.fake.addClaim({ id: first, name: 'The sky is blue.', spaces: [SPACE_ID[US]], created: '2026-09-02' });
  w.fake.addClaim({ id: second, name: 'the  sky is   BLUE', spaces: [SPACE_ID[US]], created: '2026-09-03' });
  w.fake.addClaim({ id: hexId(9003), name: 'Grass is green', spaces: [SPACE_ID[US]], created: '2026-09-04' });
  w.fake.addClaim({ id: hexId(9004), name: 'Water is wet', spaces: [SPACE_ID[US]], created: '2026-09-05' });
  const r = await pick(w);
  assert.equal(r.code, 0, r.line);
  assert.equal(r.pick.rows.length, 19);
  assert.equal(r.pick.populations[US].total, 4);
  const names = r.pick.rows.map((x) => normaliseName(x['Geo Name']));
  assert.equal(new Set(names).size, names.length, 'no two normalised names are equal');
  assert.equal(r.pick.duplicates.text.length, 1);
  const dup = r.pick.duplicates.text[0];
  assert.deepEqual([dup.space, dup.month, dup.same_as_space], [US, '2026-09', US]);
  assert.deepEqual([dup.geo_id, dup.same_as].sort(), [first, second].sort());
  assert.equal(rowIds(r).includes(dup.geo_id), false);
  assert.equal(rowIds(r).includes(dup.same_as), true);
  assert.equal(r.pick.allocation[US].picked, 3);
  assert.equal(r.pick.allocation[US].moved_out, 1);
  assert.equal(r.pick.allocation[WORLD].picked, 4, 'the next space in canonical order takes the one that US could not fill');
  assert.equal(r.pick.allocation[WORLD].moved_in, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(r.runDir, 'report.json'), 'utf8')).duplicate_moves, [{ from: US, to: WORLD, count: 1 }]);
  assert.ok(readFileSync(join(r.runDir, 'report.md'), 'utf8').includes(`- ${US} -> ${WORLD}: 1 claim (same-text claims left the space short)`));

  // the same text in two different spaces: only one of them is picked
  const geo2 = scaled([3, 3, 3, 3, 3, 3]);
  const w2 = makeWorld({ [US]: { '2026-09': 6 }, [WORLD]: { '2026-09': 6 }, [AI]: { '2026-09': 2 }, [HEALTH]: { '2026-09': 6 }, [CRYPTO]: { '2026-09': 6 }, [TECH]: { '2026-09': 2 } }, { geo: geo2 });
  w2.fake.addClaim({ id: hexId(9101), name: 'One claim, entered twice', spaces: [SPACE_ID[AI]], created: '2026-09-04' });
  w2.fake.addClaim({ id: hexId(9102), name: 'One claim, entered twice.', spaces: [SPACE_ID[TECH]], created: '2026-09-04' });
  const r2 = await pick(w2);
  assert.equal(r2.code, 0, r2.line);
  assert.equal(r2.pick.rows.length, 18);
  assert.equal(r2.pick.allocation[TECH].picked, 2, 'Technology could only give two different claims');
  assert.equal(r2.pick.allocation[US].moved_in, 1);
  const names2 = r2.pick.rows.map((x) => normaliseName(x['Geo Name']));
  assert.equal(new Set(names2).size, names2.length);
  assert.equal(r2.pick.rows.filter((x) => normaliseName(x['Geo Name']) === 'one claim, entered twice').length, 1);
  assert.equal(r2.pick.duplicates.text.some((d) => d.space === TECH && d.same_as_space === AI), true);
});

test('the pick is deterministic: the same seed and data give the same file, byte for byte; another seed gives another pick', async () => {
  const w = makeWorld(BIG);
  const a = await pick(w, { seed: 'claims-2026-10-27' });
  const b = await pick(w, { seed: 'claims-2026-10-27', audit: a.audit });
  assert.equal(readFileSync(a.path, 'utf8'), readFileSync(b.path, 'utf8'));
  const c = await pick(w, { seed: 'a different seed', audit: a.audit });
  assert.equal(c.code, 0);
  assert.notDeepEqual(rowIds(c), rowIds(a));
  const same = rowIds(c).filter((id) => rowIds(a).includes(id)).length;
  assert.ok(same < 200 && same > 0, `a different seed reshuffles but the pools overlap (${same} claims in common)`);
  assert.deepEqual(c.pick.allocation, a.pick.allocation, 'the allocation follows the data, not the seed');
  assert.deepEqual(bySpace(c.pick.rows), bySpace(a.pick.rows));
  // the sample of one month does not depend on the others: changing the world elsewhere leaves the pick of an unchanged space and month alone
  const w2 = makeWorld({ ...BIG, [AI]: { '2026-09': 50, '2026-10': 81 } });
  const d = await pick(w2, { seed: 'claims-2026-10-27', audit: a.audit });
  const inUs = (r) => r.pick.rows.filter((x) => x['Geo Space'] === US).map((x) => x['Geo ID']);
  assert.deepEqual(inUs(d), inUs(a));
  // the order Geo lists the links in does not matter: the ids are sorted before the sample
  const backwards = async (url, init) => {
    const res = await w.fake.fetchImpl(url, init);
    const body = await res.json();
    if (body?.data?.relationsConnection) body.data.relationsConnection.nodes.reverse();
    return new Response(JSON.stringify(body), { status: res.status });
  };
  const e = await pick({ ...w, fake: { fetchImpl: backwards } }, { seed: 'claims-2026-10-27', audit: a.audit });
  assert.equal(e.code, 0, e.line);
  assert.equal(readFileSync(e.path, 'utf8'), readFileSync(a.path, 'utf8'));
});

test('an existing pick is never overwritten without --replace (exit 2, no request sent); --replace writes a new one; --out writes elsewhere', async () => {
  const w = makeWorld(BIG);
  const root = tmp();
  const first = await pick(w, { root, seed: 'one' });
  assert.equal(first.code, 0);
  const before = readFileSync(first.path, 'utf8');
  const requests = w.fake.requests.length;
  const refused = await pick(w, { root, seed: 'two', audit: first.audit });
  assert.equal(refused.code, 2);
  assert.match(refused.line, /already exists; it is left as it is\. Add --replace/);
  assert.equal(readFileSync(first.path, 'utf8'), before, 'the file is untouched');
  assert.equal(w.fake.requests.length, requests, 'nothing was asked of Geo');
  assert.equal(refused.runDir, null);
  const replaced = await pick(w, { root, seed: 'two', audit: first.audit, replace: true });
  assert.equal(replaced.code, 0);
  assert.equal(JSON.parse(readFileSync(first.path, 'utf8')).seed, 'two');
  const out = join(tmp(), 'elsewhere', 'pick.json');
  const other = await pick(w, { root, seed: 'three', audit: first.audit, out });
  assert.equal(other.code, 0);
  assert.equal(other.path, out);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).seed, 'three');
  assert.equal(JSON.parse(readFileSync(first.path, 'utf8')).seed, 'two', 'the default file was not touched');
  const again = await pick(w, { root, seed: 'three', audit: first.audit, out });
  assert.equal(again.code, 2, 'an existing --out file is protected as well');
});

test('the pick file is checked against its schema before it is written, and the schema refuses what it should', async () => {
  const w = makeWorld(BIG);
  const r = await pick(w);
  const ok = validate(SCHEMA, r.pick);
  assert.deepEqual(ok.errors, []);
  const broken = (mutate, pattern) => {
    const p = clone(r.pick);
    mutate(p);
    const v = validate(SCHEMA, p);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => pattern.test(e)), `${pattern}: ${v.errors.join(' | ')}`);
  };
  broken((p) => { p.pick_version = 2; }, /pick_version/);
  broken((p) => { p.rows[0].month = 'October'; }, /rows\[0\]\.month: must match/);
  broken((p) => { p.rows[0]['Geo ID'] = 'abc'; }, /rows\[0\]\["Geo ID"\]: must match/);
  broken((p) => { delete p.rows[0]['Geo Space']; }, /Geo Space.*missing required property/);
  broken((p) => { p.rows[0].extra = 1; }, /rows\[0\]\.extra: unexpected property/);
  broken((p) => { p.rows[0]['Geo Is factual'] = 'yes'; }, /Geo Is factual/);
  broken((p) => { p.rows[0].source_pieces = [{ name: 'x', url: 'ftp://x' }]; }, /source_pieces\[0\]\.url: must match/);
  broken((p) => { p.audit.sha256 = 'nope'; }, /audit\.sha256: must match/);
  broken((p) => { p.audit.left_out = [{ geo_id: GHOST }]; }, /reason: missing required property/);
  broken((p) => { p.allocation[US].moved_in = -1; }, /moved_in: must be >= 0/);
  broken((p) => { p.rows = []; }, /rows: must have at least 1 items/);
  broken((p) => { delete p.duplicates.text; }, /duplicates\.text: missing required property/);
});

test('rows carry the lean Geo set: the space\'s own Name, sources with their Web URL or Geo link, Is factual, tags and topics', async () => {
  const geo = scaled([2, 2, 2, 2, 2, 2]);
  const plan = Object.fromEntries(SPACES.map((s) => [s, s === AI ? {} : { '2026-09': 2 }]));
  const w = makeWorld(plan, { geo });
  // AI holds exactly the two claims below and takes two: both are picked, so the details checked here are all in the pick
  const sp = SPACE_ID[AI];
  const rich = hexId(4001);
  const sparse = hexId(4002);
  w.fake.addClaim({
    id: rich, name: 'Name on the entity', ownName: 'Name in its space', spaces: [sp], created: '2026-09-17', tags: ['Context-dependent', 'Featured'], topics: ['Zoning', 'Courts'], isFactual: true,
    sources: [
      { id: hexId(4001, 'e'), name: 'Zeta Times', url: 'https://example.com/zeta' },
      { id: hexId(4002, 'e'), name: 'Alpha Weekly', urls: [{ url: 'https://other.example.com/alpha', spaceId: SPACE_ID[WORLD] }, { url: 'https://example.com/alpha', spaceId: sp }] },
      { id: hexId(4003, 'e'), name: 'No link magazine', url: null },
    ],
  });
  w.fake.addClaim({ id: sparse, name: 'Only the entity name', ownName: null, spaces: [sp], created: '2026-09-18' });
  const r = await pick(w, { audit: writeAudit([rich, sparse]) });
  assert.equal(r.code, 0, r.line);
  const row = r.pick.rows.find((x) => x['Geo ID'] === rich);
  assert.deepEqual(row, {
    'Geo Name': 'Name in its space',
    'Geo ID': rich,
    'Geo URL': `https://www.geobrowser.io/space/${sp}/${rich}`,
    'Geo Space': AI,
    'Geo Created': '2026-09-17',
    'Geo Sources': 'Alpha Weekly\nNo link magazine\nZeta Times',
    source_pieces: [
      { name: 'Alpha Weekly', url: 'https://example.com/alpha' },
      { name: 'No link magazine', url: `https://www.geobrowser.io/space/${sp}/${hexId(4003, 'e')}` },
      { name: 'Zeta Times', url: 'https://example.com/zeta' },
    ],
    'Geo Is factual': true,
    'Geo Tags': ['Context-dependent', 'Debate', 'Featured'],
    'Geo Topics': 'Courts\nZoning',
    month: '2026-09',
  });
  const thin = r.pick.rows.find((x) => x['Geo ID'] === sparse);
  assert.equal(thin['Geo Name'], 'Only the entity name');
  assert.deepEqual([thin['Geo Sources'], thin.source_pieces, thin['Geo Is factual'], thin['Geo Tags'], thin['Geo Topics']], ['', [], null, ['Debate'], '']);
  assert.ok(r.pick.tag_names.includes('Context-dependent') && r.pick.tag_names.includes('Debate'));
  assert.deepEqual(r.pick.tag_names, [...new Set(r.pick.rows.flatMap((x) => x['Geo Tags']))].sort());
  const details = JSON.parse(readFileSync(join(r.runDir, 'report.json'), 'utf8')).details;
  assert.ok(details.name_own >= 1 && details.name_fallback >= 1);
  assert.ok(details.sources_without_web_url >= 1);
});

// ---- Geo trouble ----------------------------------------------------------------------------------------------------------------

test('a Geo outage after the retries gives exit 1, writes no pick, and prints the same command to resume', async () => {
  const w = makeWorld(BIG);
  w.fake.failNext('500', Infinity);
  const audit = writeAudit([GHOST]);
  const r = await pick(w, { audit });
  assert.equal(r.code, 1);
  assert.match(r.line, /^geo-pick: Geo could not be read: Geo did not answer DebateTagged after 3 attempts/);
  assert.equal(r.resume, `node agents/claim-tagger-mvp/scripts/geo-pick.mjs --seed seed-1 --audit ${audit.includes(' ') ? `"${audit}"` : audit}`);
  assert.equal(existsSync(join(r.root, 'setup', 'geo-claims-pick.json')), false);
  const log = join(r.runDir, 'requests.jsonl');
  const total = countGeoRequests(log);
  assert.equal(total.nonQuery, 0);
  assert.equal(total.total, 15, 'three attempts at each of the five page sizes');
  const json = JSON.parse(readFileSync(join(r.runDir, 'report.json'), 'utf8'));
  assert.equal(json.state, 'stopped');
  assert.equal(json.resume, r.resume);
  assert.ok(readFileSync(join(r.runDir, 'report.md'), 'utf8').includes(r.resume));
  // the same command, once Geo answers again, completes (nothing was left half done)
  const w2 = makeWorld(BIG);
  const resumed = await pick(w2, { audit, root: r.root });
  assert.equal(resumed.code, 0, resumed.line);
  assert.equal(resumed.pick.rows.length, 200);
});

test('a Geo failure while the details are read is the same: exit 1, nothing written, the resume line', async () => {
  const w = makeWorld(BIG);
  w.fake.failNext('500', Infinity, { op: 'ClaimDetails' });
  const out = join(tmp(), 'p.json');
  const r = await pick(w, { replace: true, out });
  assert.equal(r.code, 1);
  assert.match(r.line, /Geo could not be read/);
  assert.match(r.resume, / --replace --out /);
  assert.equal(existsSync(out), false);
  const json = JSON.parse(readFileSync(join(r.runDir, 'report.json'), 'utf8'));
  assert.equal(json.state, 'stopped');
  assert.ok(json.warnings.some((x) => /could not be looked up in Geo/.test(x)), 'the audit claim lookup that failed is reported, not skipped');
});

test('a network that never answers is exit 1 as well', async () => {
  const w = makeWorld(BIG);
  w.fake.failNext('network', Infinity);
  const r = await pick(w);
  assert.equal(r.code, 1);
  assert.match(r.line, /Geo could not be read: Geo did not answer DebateTagged after 3 attempts: Geo could not be reached/);
  assert.equal(countGeoRequests(join(r.runDir, 'requests.jsonl')).total, 3, 'a network failure does not halve the page, it stops after three attempts');
});

test('a picked claim whose details Geo does not give is reported as a warning and its row holds only what the listing had', async () => {
  const geo = scaled([2, 2, 2, 2, 2, 2]);
  const w = makeWorld(Object.fromEntries(SPACES.map((s) => [s, { '2026-09': 2 }])), { geo });
  const hidden = w.ids.get(WORLD).get('2026-09')[0];
  w.fake.hideDetailsOf(hidden);
  const r = await pick(w);
  assert.equal(r.code, 0, r.line);
  const row = r.pick.rows.find((x) => x['Geo ID'] === hidden);
  assert.deepEqual([row['Geo Name'], row['Geo Sources'], row.source_pieces, row['Geo Is factual'], row['Geo Tags'], row['Geo Topics']], [`${WORLD} claim ${Number.parseInt(hidden.slice(1), 16)}`, '', [], null, [], '']);
  const json = JSON.parse(readFileSync(join(r.runDir, 'report.json'), 'utf8'));
  assert.deepEqual(json.warnings, [`${hidden}: Geo gave no details, so the row has only what the Debate listing held (no sources, tags or topics)`]);
  const c = cap();
  const env = { root: tmp(), config: { geo }, fetchImpl: w.fake.fetchImpl, now: NOW, sleep: noSleep };
  assert.equal(await main(['--seed', 's', '--audit', writeAudit([GHOST])], c.io, env), 0);
  assert.match(c.err[0], /1 warning; see .*report\.md/);
});

// ---- the command line -----------------------------------------------------------------------------------------------------------

const cap = () => {
  const out = [];
  const err = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
};

test('main: usage errors exit 2 and the help exits 0; a good run prints one line and exits 0; an outage prints the resume line and exits 1', async () => {
  const w = makeWorld(BIG);
  const root = tmp();
  const audit = writeAudit([GHOST]);
  const env = { root, config: { geo: w.geo }, fetchImpl: w.fake.fetchImpl, now: NOW, sleep: noSleep };
  for (const argv of [[], ['--audit', audit], ['--seed', 's'], ['--seed', 's', '--audit', audit, '--bogus'], ['--seed', ' ', '--audit', audit], ['--seed', 's', '--audit', join(tmp(), 'missing.json')], ['positional']]) {
    const c = cap();
    assert.equal(await main(argv, c.io, env), 2, argv.join(' '));
    assert.ok(c.err.length >= 1);
  }
  assert.equal(w.fake.requests.length, 0, 'bad usage never reaches Geo');
  const help = cap();
  assert.equal(await main(['--help'], help.io, env), 0);
  assert.equal(help.out[0], USAGE);
  const good = cap();
  assert.equal(await main(['--seed', 'cli seed', '--audit', audit], good.io, env), 0);
  assert.match(good.out[0], /^geo-pick: 200 claims \(0 from the audit, 1 audit claim left out, seed "cli seed"\) -> .*geo-claims-pick\.json$/);
  assert.equal(good.err.length, 0);
  assert.equal(JSON.parse(readFileSync(join(root, 'setup', 'geo-claims-pick.json'), 'utf8')).seed, 'cli seed');
  const down = makeWorld(BIG);
  down.fake.failNext('500', Infinity);
  const bad = cap();
  assert.equal(await main(['--seed', 'x y', '--audit', audit, '--replace'], bad.io, { ...env, root: tmp(), fetchImpl: down.fake.fetchImpl }), 1);
  assert.match(bad.err[0], /Geo could not be read/);
  assert.match(bad.err[1], /to resume, run the same command again: node agents\/claim-tagger-mvp\/scripts\/geo-pick\.mjs --seed "x y" --audit .* --replace$/);
});

test('main: a geo block that does not validate is exit 2 and names the problem', async () => {
  const geo = clone(GEO);
  geo.spaces[0].quota = 49;
  const c = cap();
  const code = await main(['--seed', 's', '--audit', writeAudit([GHOST])], c.io, { root: tmp(), config: { geo }, fetchImpl: async () => { throw new Error('must not be called'); }, now: NOW, sleep: noSleep });
  assert.equal(code, 2);
  assert.match(c.err[0], /the quotas add up to 199, but total is 200/);
  const noGeo = cap();
  assert.equal(await main(['--seed', 's', '--audit', writeAudit([GHOST])], noGeo.io, { root: tmp(), config: { other: 1 }, now: NOW }), 2);
});

test('the audit file is checked: not JSON, no decisions, a repeated id and a bad id are exit 2', async () => {
  const w = makeWorld(BIG);
  const dir = tmp();
  const write = (text) => {
    const f = join(dir, `a${Math.random()}.json`);
    writeFileSync(f, text);
    return f;
  };
  for (const [text, pattern] of [
    ['not json', /not valid JSON/],
    [JSON.stringify({ decisions: [] }), /no decisions\[\]\.geo_id/],
    [JSON.stringify({ decisions: [{ geo_id: GHOST }, { geo_id: GHOST }] }), /repeats a geo_id/],
    [JSON.stringify({ decisions: [{ geo_id: 'short' }] }), /not a Geo id/],
  ]) {
    const r = await pick(w, { audit: write(text) });
    assert.equal(r.code, 2, text);
    assert.match(r.line, pattern);
  }
  const liveUrl = new URL('../../agents/claim-tagger-mvp/setup/v1/audit-decisions.json', import.meta.url);
  const live = JSON.parse(readFileSync(liveUrl, 'utf8'));
  const withLive = await pick(w, { audit: fileURLToPath(liveUrl) });
  assert.equal(withLive.code, 0, withLive.line);
  assert.equal(live.decisions.length, 10);
  assert.equal(withLive.pick.audit.left_out.length, 10, 'none of the ten real audit claims is in the fake');
  assert.deepEqual(withLive.pick.audit.left_out.map((l) => l.geo_id), live.decisions.map((d) => d.geo_id), 'named in the audit file\'s order');
  assert.equal(withLive.pick.audit.file, 'agents/claim-tagger-mvp/setup/v1/audit-decisions.json', 'a file inside the repository is named relative to it');
  assert.equal(withLive.pick.audit.sha256, createHash('sha256').update(readFileSync(liveUrl)).digest('hex'));
});

// ---- what the scripts may not contain -------------------------------------------------------------------------------------------

test('source scan: the Geo scripts contain no write operation, no credential header and no publish, and reach Geo only through the client', () => {
  const read = (rel) => readFileSync(new URL(`../../agents/claim-tagger-mvp/scripts/${rel}`, import.meta.url), 'utf8');
  const sources = { 'lib/geo-read.mjs': read('lib/geo-read.mjs'), 'geo-pick.mjs': read('geo-pick.mjs') };
  for (const [name, text] of Object.entries(sources)) {
    // the one line that names the refused words is the refusal itself
    const rest = text.split('\n').filter((l) => !l.includes('const REFUSED_WORDS')).join('\n');
    assert.equal(/mutation/i.test(rest), false, `${name}: no mutation`);
    assert.equal(/subscription/i.test(rest), false, `${name}: no subscription`);
    assert.equal(/authorization/i.test(text), false, `${name}: no Authorization`);
    assert.equal(/publish/i.test(text), false, `${name}: no publish`);
    assert.equal(/\bmethod:\s*['"](?!POST)/i.test(text), false, `${name}: POST is the only method`);
    assert.equal(/\.env\b|NOTION_|process\.env/.test(text), false, `${name}: reads no secret`);
    assert.equal(/notion/i.test(text.replace(/Notion is not touched/g, '')), false, `${name}: does not reach Notion`);
  }
  assert.equal(sources['lib/geo-read.mjs'].split('\n').filter((l) => l.includes('const REFUSED_WORDS')).length, 1);
  assert.match(sources['lib/geo-read.mjs'], /REFUSED_WORDS\.test\(text\)/, 'send() applies the refusal');
  assert.match(sources['lib/geo-read.mjs'], /\^query\(\?=\[\\s\(\{\]\)/, 'send() refuses what does not start with query');
  assert.equal(/\bfetch\(/.test(sources['geo-pick.mjs']), false, 'geo-pick.mjs asks Geo through createGeoClient only');
  assert.match(sources['geo-pick.mjs'], /createGeoClient\(/);
});
