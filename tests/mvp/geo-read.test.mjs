import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GeoError, allowedSpaces, countGeoRequests, createGeoClient, debateTaggedQuery, detailsQuery, entityIsStub, geoRequestLogger, readClaim, validateGeoConfig,
} from '../../agents/claim-tagger-mvp/scripts/lib/geo-read.mjs';
import { createFakeGeo, hexId } from './fixtures/fake-geo.mjs';

// Nothing here touches the network: the client talks to the in-memory fake behind fetchImpl, and sleeps are recorded, not waited for.

const CONFIG = JSON.parse(readFileSync(new URL('../../agents/claim-tagger-mvp/config.json', import.meta.url), 'utf8'));
const GEO = CONFIG.geo;
const SPACE = GEO.spaces[5].id; // Technology
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-geo-read-'));
  dirs.push(d);
  return d;
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const world = ({ internalAbove, ...overrides } = {}) => {
  const geo = { ...clone(GEO), ...overrides };
  const fake = createFakeGeo({ geo, internalAbove });
  const sleeps = [];
  const logged = [];
  const client = createGeoClient({ geo, fetchImpl: fake.fetchImpl, log: (l) => logged.push(l), sleep: async (ms) => { sleeps.push(ms); } });
  return { geo, fake, client, sleeps, logged };
};
const addClaims = (fake, n, spaceId = SPACE) => {
  for (let i = 1; i <= n; i++) fake.addClaim({ id: hexId(i), name: `Claim number ${i}`, spaces: [spaceId], created: '2026-09-14' });
};

// ---- the geo block --------------------------------------------------------------------------------------------------------------

test('validateGeoConfig: the live geo block is valid, as the block itself or inside a whole config', () => {
  assert.deepEqual(validateGeoConfig(GEO).errors, []);
  assert.equal(validateGeoConfig(CONFIG).ok, true);
  assert.equal(GEO.spaces.reduce((s, x) => s + x.quota, 0), GEO.total);
  assert.deepEqual(GEO.spaces.map((s) => s.name), ['U.S. Politics', 'World affairs', 'AI', 'Health', 'Crypto', 'Technology']);
  assert.deepEqual(GEO.spaces.map((s) => s.quota), [50, 50, 40, 30, 20, 10]);
});

test('validateGeoConfig: a bad host, a plain-http endpoint, quotas that do not add up, a bad id and a missing block are each refused', () => {
  const bad = (mutate, pattern) => {
    const geo = clone(GEO);
    mutate(geo);
    const r = validateGeoConfig(geo);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => pattern.test(e)), `${pattern}: ${r.errors.join(' | ')}`);
  };
  bad((g) => { g.endpoint = 'https://evil.example.com/graphql'; }, /host "evil\.example\.com" is not in allowed_hosts/);
  bad((g) => { g.endpoint = 'http://api-testnet.geobrowser.io/graphql'; }, /endpoint: .*must be https/);
  bad((g) => { g.endpoint = 'https://user:pw@api-testnet.geobrowser.io/graphql'; }, /user name or password/);
  bad((g) => { g.endpoint = 'not a url'; }, /endpoint: .*not a URL/);
  bad((g) => { g.allowed_hosts = []; }, /allowed_hosts/);
  bad((g) => { g.spaces[0].quota = 51; }, /the quotas add up to 201, but total is 200/);
  bad((g) => { g.total = 199; }, /the quotas add up to 200, but total is 199/);
  bad((g) => { g.spaces.pop(); }, /expected exactly 6 spaces/);
  bad((g) => { g.spaces[1].id = g.spaces[0].id; }, /two spaces have the same id/);
  bad((g) => { g.spaces[1].name = g.spaces[0].name; }, /two spaces have the same name/);
  bad((g) => { g.spaces[2].id = 'NOT-HEX'; }, /spaces\[2\]\.id: expected 32 lowercase hex/);
  bad((g) => { g.ids.debate = 'abc'; }, /ids\.debate/);
  bad((g) => { g.ids.topics = []; }, /ids\.topics/);
  bad((g) => { g.page_size = 10; }, /page_size/);
  bad((g) => { g.detail_batch = 26; }, /detail_batch/);
  bad((g) => { g.browser_url = 'http://www.geobrowser.io'; }, /browser_url: .*must be https/);
  assert.equal(validateGeoConfig({}).ok, false);
  assert.match(validateGeoConfig({}).errors[0], /no "geo" block|geo\./);
  assert.equal(validateGeoConfig(null).ok, false);
});

test('validateGeoConfig: the live block holds the twelve allowed spaces (the six of the pick first, Podcasts not among them) and the Geo bot\'s personal space', () => {
  assert.deepEqual(GEO.allowed_spaces.map((s) => s.name), ['U.S. Politics', 'World affairs', 'AI', 'Health', 'Crypto', 'Technology', 'Pharma', 'Industries', 'Education', 'Software', 'Places', 'Documentation']);
  assert.deepEqual(GEO.allowed_spaces.map((s) => s.id), [
    '4582fbbee28a16589154f7e36f1ee3c5', '89bd89bf28ff8a0963faf92a8c905e20', '41e851610e13a19441c4d980f2f2ce6b', '52c7ae149838b6d47ce0f3b2a5974546', 'c9f267dcb0d270718c2a3c45a64afd32', '870e3b3068661e6280fad2ab456829bc',
    '19f11bc6f1a62ac434936af814d1f8b5', 'd69608290513c2a91102c939b3265bd7', 'ec349623f33236aee13c12dcd629ee81', '9b611b848b12491b9b6b43f3cf019b8b', '84a679ce188f061ac9a92380bac2bab5', '784bfddae3f3976118c561bf28195b44',
  ]);
  assert.deepEqual(GEO.allowed_spaces.slice(0, 6).map(({ name, id }) => ({ name, id })), GEO.spaces.map(({ name, id }) => ({ name, id })), 'the pick\'s six come first, in the same order');
  assert.equal(GEO.allowed_spaces.some((s) => s.id === 'b5a31f8182b042437ede0f84ee02f104'), false, 'Podcasts is deliberately not allowed');
  assert.deepEqual(GEO.bot_spaces, ['cc0bf85a27c217d75993bc785a15b198']);
  // the pick is unchanged: six spaces with their quotas, which add up to the total
  assert.equal(GEO.spaces.length, 6);
  assert.equal(validateGeoConfig(GEO).ok, true);
});

test('validateGeoConfig: allowed_spaces and bot_spaces are checked when present; a list that is wrong, a repeated name or id, a space of the pick that is missing and a bad id are each refused', () => {
  const bad = (mutate, pattern) => {
    const geo = clone(GEO);
    mutate(geo);
    const r = validateGeoConfig(geo);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => pattern.test(e)), `${pattern}: ${r.errors.join(' | ')}`);
  };
  bad((g) => { g.allowed_spaces = 'everything'; }, /allowed_spaces: expected a non-empty list of spaces \{ name, id \}/);
  bad((g) => { g.allowed_spaces = []; }, /allowed_spaces: expected a non-empty list/);
  bad((g) => { g.allowed_spaces = null; }, /allowed_spaces: expected a non-empty list/);
  bad((g) => { g.allowed_spaces[6] = 'Pharma'; }, /allowed_spaces\[6\]: expected an object \{ name, id \}/);
  bad((g) => { g.allowed_spaces[6].id = 'NOT-HEX'; }, /allowed_spaces\[6\]\.id: expected 32 lowercase hex/);
  bad((g) => { g.allowed_spaces[6].id = g.allowed_spaces[6].id.toUpperCase(); }, /allowed_spaces\[6\]\.id: expected 32 lowercase hex/);
  bad((g) => { delete g.allowed_spaces[7].id; }, /allowed_spaces\[7\]\.id: expected 32 lowercase hex/);
  bad((g) => { g.allowed_spaces[6].name = ''; }, /allowed_spaces\[6\]\.name: expected a name/);
  bad((g) => { delete g.allowed_spaces[6].name; }, /allowed_spaces\[6\]\.name: expected a name/);
  bad((g) => { g.allowed_spaces[7].name = g.allowed_spaces[6].name; }, /allowed_spaces: two spaces have the same name/);
  bad((g) => { g.allowed_spaces[7].id = g.allowed_spaces[6].id; }, /allowed_spaces: two spaces have the same id/);
  bad((g) => { g.allowed_spaces.splice(2, 1); }, /allowed_spaces: the space "AI" of spaces \(41e851610e13a19441c4d980f2f2ce6b\) is not among the allowed spaces/);
  bad((g) => { g.allowed_spaces = g.allowed_spaces.slice(1); }, /the space "U\.S\. Politics" of spaces .* is not among the allowed spaces/);
  bad((g) => { g.allowed_spaces[2].name = 'Artificial intelligence'; }, /allowed_spaces: the id 41e851610e13a19441c4d980f2f2ce6b is "Artificial intelligence" here and "AI" in spaces/);
  bad((g) => { g.bot_spaces = 'cc0bf85a27c217d75993bc785a15b198'; }, /bot_spaces: expected a list of space ids/);
  bad((g) => { g.bot_spaces = ['bot']; }, /bot_spaces\[0\]: expected 32 lowercase hex/);
  bad((g) => { g.bot_spaces = [g.bot_spaces[0], g.bot_spaces[0]]; }, /bot_spaces: a space is listed twice/);
  // an empty list of bot spaces is fine (nobody is left out), and so is a block with neither key
  const none = clone(GEO);
  none.bot_spaces = [];
  assert.equal(validateGeoConfig(none).ok, true);
  const bare = clone(GEO);
  delete bare.allowed_spaces;
  delete bare.bot_spaces;
  assert.deepEqual(validateGeoConfig(bare).errors, [], 'old configs have neither key');
  // allowed_spaces may hold more than the pick's spaces and the quotas are only the pick's
  const more = clone(GEO);
  more.allowed_spaces.push({ name: 'Podcasts', id: 'b5a31f8182b042437ede0f84ee02f104' });
  assert.equal(validateGeoConfig(more).ok, true);
});

test('allowedSpaces: allowed_spaces when the block has it, else the six spaces of the pick', () => {
  assert.equal(allowedSpaces(GEO), GEO.allowed_spaces);
  assert.equal(allowedSpaces(GEO).length, 12);
  const bare = clone(GEO);
  delete bare.allowed_spaces;
  assert.equal(allowedSpaces(bare), bare.spaces);
  assert.equal(allowedSpaces(bare).length, 6);
  assert.deepEqual(allowedSpaces(null), []);
  assert.deepEqual(allowedSpaces({}), []);
});

test('createGeoClient refuses a geo block that does not validate', () => {
  const geo = clone(GEO);
  geo.endpoint = 'https://elsewhere.example.com/graphql';
  assert.throws(() => createGeoClient({ geo, fetchImpl: async () => { throw new Error('must not be called'); } }), (e) => e instanceof GeoError && e.kind === 'config' && /allowed_hosts/.test(e.message));
});

// ---- queries only ---------------------------------------------------------------------------------------------------------------

test('send refuses a write, a live feed and anything that is not a named or bare query, before anything is fetched', async () => {
  const { client, fake } = world();
  const refused = [
    'mutation { createEntity(id: "x") { id } }',
    '  \n mutation M { a }',
    'subscription S { a }',
    'query A { a } mutation B { b }',
    'query A { a } subscription B { b }',
    'query A { MUTATION }',
    '{ entity(id: "x") { id } }',
    'queryX { a }',
    'fragment F on Entity { id }',
    '',
    42,
    null,
  ];
  for (const doc of refused) {
    await assert.rejects(() => client.send(doc), (e) => e instanceof GeoError && e.kind === 'refused', JSON.stringify(doc));
  }
  assert.equal(fake.requests.length, 0, 'nothing reached the network');
  await assert.rejects(() => client.send(' \n query Plain { a }'), (e) => e instanceof GeoError && e.kind === 'graphql', 'a plain query is sent (the fake does not know it)');
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].rejected, false);
});

test('no credential header is ever sent: the only header is Content-Type, the method is POST and a redirect is an error', async () => {
  const { geo, fake } = world();
  addClaims(fake, 3);
  const seen = [];
  const spy = async (url, init) => {
    seen.push({ url, init });
    return fake.fetchImpl(url, init);
  };
  const client = createGeoClient({ geo, fetchImpl: spy, sleep: async () => {} });
  await client.paginateDebate(SPACE);
  await client.details([hexId(1), hexId(2)]);
  assert.ok(seen.length >= 2);
  for (const { url, init } of seen) {
    assert.equal(url, 'https://api-testnet.geobrowser.io/graphql');
    assert.equal(init.method, 'POST');
    assert.deepEqual(Object.keys(init.headers), ['Content-Type']);
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.redirect, 'error');
    assert.equal(Object.keys(init).some((k) => /^(credentials|auth)/i.test(k)), false);
  }
  for (const r of fake.requests) assert.deepEqual(Object.keys(r.headers), ['Content-Type']);
});

test('an id that is not 32 lowercase hex characters never reaches a query text', async () => {
  const { client, geo, fake } = world();
  const badIds = ['abc', 'A'.repeat(32), `${'a'.repeat(31)}"`, '', `${'a'.repeat(32)}"} mutation { x }`, 'a'.repeat(33), null, undefined, 5];
  for (const id of badIds) {
    assert.throws(() => debateTaggedQuery(geo, { spaceId: id }), (e) => e instanceof GeoError && e.kind === 'refused', `space ${JSON.stringify(id)}`);
    assert.throws(() => detailsQuery(geo, [id]), (e) => e instanceof GeoError && e.kind === 'refused', `entity ${JSON.stringify(id)}`);
    await assert.rejects(() => client.details([hexId(1), id]), (e) => e instanceof GeoError && e.kind === 'refused');
    await assert.rejects(() => client.debateTagged({ spaceId: id }), (e) => e.kind === 'refused');
  }
  for (const first of [0, -1, 1001, 1.5, '5', null]) assert.throws(() => debateTaggedQuery(geo, { spaceId: SPACE, first }), (e) => e.kind === 'refused', `first ${first}`);
  for (const after of ['x" mutation {', 'a b', 5, '']) assert.throws(() => debateTaggedQuery(geo, { spaceId: SPACE, after }), (e) => e.kind === 'refused', `after ${after}`);
  const tampered = clone(geo);
  tampered.ids.tags = 'zz';
  assert.throws(() => debateTaggedQuery(tampered, { spaceId: SPACE }), (e) => e.kind === 'refused');
  assert.throws(() => detailsQuery(geo, []), (e) => e.kind === 'refused');
  assert.throws(() => detailsQuery(geo, Array.from({ length: 26 }, (_, i) => hexId(i + 1))), (e) => e.kind === 'refused' && /at most 25/.test(e.message));
  assert.equal(fake.requests.length, 0);
});

test('the Debate query is the live filter shape: Tags relation, Debate target, one space, the cursor as a variable', () => {
  const q = debateTaggedQuery(GEO, { spaceId: SPACE, after: 'Y3Vyc29y', first: 250 });
  assert.equal(q.operationName, 'DebateTagged');
  assert.deepEqual(q.variables, { after: 'Y3Vyc29y' });
  assert.match(q.document, /^query DebateTagged\(\$after: Cursor\) \{ relationsConnection\(filter: \{typeId: \{is: "257090341ba5406f94e4d4af90042fba"\}, toEntityId: \{is: "55c95b2626f8482cb9739ea99dfde438"\}, spaceId: \{is: "870e3b3068661e6280fad2ab456829bc"\}\}, first: 250, after: \$after\)/);
  assert.match(q.document, /nodes \{ spaceId fromEntityId toEntityId fromEntity \{ id name typeIds createdAt \} \} pageInfo \{ hasNextPage endCursor \}/);
  assert.equal(debateTaggedQuery(GEO, { spaceId: SPACE }).document.includes('first: 500'), true, 'the default page is geo.page_size');
  assert.equal(debateTaggedQuery(GEO, { spaceId: SPACE }).variables.after, null);
});

test('the details query has one aliased entity(id:) call per id with the fields the pick reads', () => {
  const ids = [hexId(1), hexId(2), hexId(3)];
  const q = detailsQuery(GEO, ids);
  assert.equal(q.operationName, 'ClaimDetails');
  assert.equal(q.variables, undefined);
  assert.ok(q.document.startsWith('query ClaimDetails {'));
  ids.forEach((id, i) => assert.ok(q.document.includes(`e${i}: entity(id: "${id}")`)));
  for (const field of ['name', 'createdAt', 'typeIds', 'spaceIds', 'values(first: 100)', 'relations(first: 100)', 'spaceId', 'typeId', 'toEntity { id name values(first: 50)', 'property { id name }']) {
    assert.ok(q.document.includes(field), field);
  }
  assert.equal((q.document.match(/entity\(id:/g) ?? []).length, 3);
});

// ---- retries and halving --------------------------------------------------------------------------------------------------------

test('a 500, a 429, an internal error and a network error are each tried again, with 0.5 s and 1 s of backoff, one log line per attempt', async () => {
  for (const [kind, status] of [['500', 500], ['429', 429], ['internal', 200], ['network', null]]) {
    const { client, fake, sleeps, logged } = world();
    addClaims(fake, 2);
    fake.failNext(kind, 1);
    const page = await client.debateTagged({ spaceId: SPACE });
    assert.equal(page.nodes.length, 2, kind);
    assert.equal(fake.requests.length, 2, kind);
    assert.deepEqual(sleeps, [500], kind);
    assert.deepEqual(logged.map((l) => [l.op, l.status, l.attempt]), [['DebateTagged', status, 1], ['DebateTagged', 200, 2]], kind);
    assert.ok(logged.every((l) => l.host === 'api-testnet.geobrowser.io'));
  }
  const { client, fake, sleeps } = world();
  addClaims(fake, 1);
  fake.failNext('500', 2);
  assert.equal((await client.debateTagged({ spaceId: SPACE })).nodes.length, 1);
  assert.deepEqual(sleeps, [500, 1000]);
});

test('three failures in a row end in a GeoError that says what failed; a server failure is transient, a network failure is not', async () => {
  for (const [kind, errKind, transient] of [['500', 'http', true], ['internal', 'internal', true], ['network', 'network', false], ['429', 'http', false]]) {
    const { client, fake, sleeps } = world();
    addClaims(fake, 1);
    fake.failNext(kind, Infinity);
    await assert.rejects(() => client.debateTagged({ spaceId: SPACE }), (e) => {
      assert.ok(e instanceof GeoError);
      assert.equal(e.kind, errKind, kind);
      assert.equal(e.transient, transient, kind);
      assert.equal(e.attempts, 3);
      assert.match(e.message, /after 3 attempts/);
      return true;
    });
    assert.equal(fake.requests.length, 3, kind);
    assert.deepEqual(sleeps, [500, 1000], kind);
  }
});

test('other GraphQL errors and a body that is not JSON are not retried', async () => {
  for (const [kind, errKind] of [['graphql', 'graphql'], ['html', 'parse']]) {
    const { client, fake, sleeps } = world();
    fake.failNext(kind, Infinity);
    await assert.rejects(() => client.debateTagged({ spaceId: SPACE }), (e) => e instanceof GeoError && e.kind === errKind && !e.transient);
    assert.equal(fake.requests.length, 1, kind);
    assert.deepEqual(sleeps, []);
  }
});

test('an internal error on a page halves `first` (500, 250, ...) and asks for the same cursor again', async () => {
  const { client, fake, geo } = world({ internalAbove: 300, page_size: 500 });
  addClaims(fake, 74);
  const nodes = await client.paginateDebate(SPACE);
  assert.equal(nodes.length, 74);
  assert.deepEqual(fake.requests.map((r) => r.first), [500, 500, 500, 250], 'three attempts at 500, then one at 250');
  assert.equal(client.stats.halvings, 1);
  assert.equal(geo.page_size, 500);
});

test('halving goes 500, 250, 125, 62, 50 and then gives up; a 429 or a network failure does not halve', async () => {
  const { client, fake } = world();
  addClaims(fake, 3);
  fake.failNext('500', Infinity);
  await assert.rejects(() => client.paginateDebate(SPACE), (e) => e instanceof GeoError && e.transient);
  assert.deepEqual([...new Set(fake.requests.map((r) => r.first))], [500, 250, 125, 62, 50]);
  assert.equal(fake.requests.length, 15, 'three attempts at each of five sizes');
  assert.equal(client.stats.halvings, 4);
  for (const kind of ['429', 'network']) {
    const w = world();
    addClaims(w.fake, 3);
    w.fake.failNext(kind, Infinity);
    await assert.rejects(() => w.client.paginateDebate(SPACE), (e) => e instanceof GeoError);
    assert.deepEqual([...new Set(w.fake.requests.map((r) => r.first))], [500], kind);
    assert.equal(w.fake.requests.length, 3);
  }
});

test('a halved page size is kept for the pages after it', async () => {
  const { client, fake } = world({ internalAbove: 120, page_size: 200 });
  addClaims(fake, 230);
  const nodes = await client.paginateDebate(SPACE);
  assert.equal(nodes.length, 230);
  assert.equal(new Set(nodes.map((n) => n.fromEntityId)).size, 230, 'no link twice, none missed across the change of page size');
  assert.deepEqual(fake.requests.map((r) => r.first), [200, 200, 200, 100, 100, 100], 'three failed attempts at 200, then three pages of 100, 100 and 30');
  assert.equal(client.stats.halvings, 1);
});

// ---- paging and details ---------------------------------------------------------------------------------------------------------

test('paginateDebate follows endCursor until hasNextPage is false: 74 links at 50 per page are two pages', async () => {
  const { client, fake } = world({ page_size: 50 });
  addClaims(fake, 74);
  const nodes = await client.paginateDebate(SPACE);
  assert.equal(nodes.length, 74);
  assert.equal(new Set(nodes.map((n) => n.fromEntityId)).size, 74);
  assert.equal(fake.requests.length, 2);
  assert.equal(fake.requests[0].after, null);
  assert.ok(typeof fake.requests[1].after === 'string' && fake.requests[1].after.length > 10, 'the second page carries the first page\'s cursor');
  assert.equal(client.stats.pages, 2);
  assert.ok(nodes.every((n) => n.spaceId === SPACE && n.toEntityId === GEO.ids.debate && n.fromEntity.typeIds.includes(GEO.ids.claim_type)));
});

test('paging: exactly one page when the count fits, three pages for 150, none for an empty space, other spaces are not mixed in', async () => {
  const w = world({ page_size: 50 });
  addClaims(w.fake, 50);
  assert.equal((await w.client.paginateDebate(SPACE)).length, 50);
  assert.equal(w.fake.requests.length, 1, '50 links at 50 per page is one page: hasNextPage is false');
  const w2 = world({ page_size: 50 });
  addClaims(w2.fake, 150);
  assert.equal((await w2.client.paginateDebate(SPACE)).length, 150);
  assert.equal(w2.fake.requests.length, 3);
  const w3 = world();
  addClaims(w3.fake, 4, GEO.spaces[0].id);
  assert.deepEqual(await w3.client.paginateDebate(SPACE), []);
  assert.equal((await w3.client.paginateDebate(GEO.spaces[0].id)).length, 4);
});

test('a page that says there is more but repeats its cursor stops with an error instead of looping', async () => {
  const geo = clone(GEO);
  const answers = async () => new Response(JSON.stringify({ data: { relationsConnection: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'c3RpY2t5' } } } }), { status: 200 });
  const client = createGeoClient({ geo, fetchImpl: answers, sleep: async () => {} });
  await assert.rejects(() => client.paginateDebate(SPACE), (e) => e instanceof GeoError && e.kind === 'shape' && /no new cursor/.test(e.message));
});

test('an answer in a shape the read path does not know is a GeoError, not a crash', async () => {
  const client = createGeoClient({ geo: clone(GEO), fetchImpl: async () => new Response(JSON.stringify({ data: { relationsConnection: null } }), { status: 200 }), sleep: async () => {} });
  await assert.rejects(() => client.debateTagged({ spaceId: SPACE }), (e) => e instanceof GeoError && e.kind === 'shape');
});

test('details: 60 ids are three requests of 25, 25 and 10 aliases; repeated ids are asked once; an unknown id comes back as a stub', async () => {
  const { client, fake } = world();
  addClaims(fake, 59);
  const ids = Array.from({ length: 60 }, (_, i) => hexId(i + 1));
  const found = await client.details([...ids, ids[0], ids[1]]);
  assert.deepEqual(fake.requestsFor('ClaimDetails').map((r) => r.aliases), [25, 25, 10]);
  assert.equal(found.size, 60);
  assert.equal(found.get(ids[0]).name, 'Claim number 1');
  assert.equal(entityIsStub(found.get(ids[59])), true, 'id 60 was never added');
  assert.equal(entityIsStub(found.get(ids[58])), false);
  assert.equal(entityIsStub(null), true);
});

test('details: a batch the server cannot answer is split in halves instead of failing', async () => {
  const { client, fake } = world();
  addClaims(fake, 10);
  fake.failNext('500', 3, { op: 'ClaimDetails' });
  const found = await client.details(Array.from({ length: 10 }, (_, i) => hexId(i + 1)));
  assert.equal(found.size, 10);
  assert.deepEqual(fake.requestsFor('ClaimDetails').map((r) => r.aliases ?? 'failed'), ['failed', 'failed', 'failed', 5, 5]);
  assert.equal(client.stats.detail_batches, 3);
});

// ---- reading the fields of a claim ----------------------------------------------------------------------------------------------

const rel = (spaceId, typeId, id, name, urls = []) => ({
  spaceId, typeId, toEntity: { id, name, values: { nodes: urls.map(([sp, text]) => ({ spaceId: sp, property: { id: GEO.ids.web_url, name: 'Web URL' }, text })) } },
});

test('readClaim: the space\'s own Name wins, Is factual is read by name, and the lists are sorted and limited to the space', () => {
  const S = GEO.spaces[0].id;
  const OTHER = GEO.spaces[1].id;
  const entity = {
    id: hexId(1), name: 'Denormalised name', createdAt: '1792050522', typeIds: [GEO.ids.claim_type], spaceIds: [S, OTHER],
    values: { nodes: [
      { spaceId: OTHER, property: { id: GEO.ids.name_property, name: 'Name' }, text: 'Name in the other space' },
      { spaceId: S, property: { id: GEO.ids.name_property, name: 'Name' }, text: '  Name in its space  ' },
      { spaceId: OTHER, property: { id: hexId(9), name: 'Is factual' }, boolean: true },
      { spaceId: S, property: { id: hexId(9), name: 'Is factual' }, boolean: false },
    ] },
    relations: { nodes: [
      rel(S, GEO.ids.tags, GEO.ids.debate, 'Debate'),
      rel(S, GEO.ids.tags, hexId(20, 'd'), 'Context-dependent'),
      rel(S, GEO.ids.tags, hexId(21, 'd'), 'Debate'),
      rel(OTHER, GEO.ids.tags, hexId(22, 'd'), 'Only in the other space'),
      rel(S, GEO.ids.topics[0], hexId(30, 'd'), 'Zoning'),
      rel(S, GEO.ids.topics[1], hexId(31, 'd'), 'Courts'),
      rel(S, GEO.ids.sources, hexId(40, 'e'), 'Beta source', [[OTHER, 'https://other.example.com/b'], [S, 'https://example.com/b2'], [S, 'https://example.com/b1']]),
      rel(S, GEO.ids.sources, hexId(41, 'e'), 'Alpha source', [[OTHER, 'https://other.example.com/a']]),
      rel(S, GEO.ids.sources, hexId(42, 'e'), 'No url source', [[S, 'not a url']]),
      rel(S, GEO.ids.sources, hexId(40, 'e'), 'Beta source', []),
      rel(OTHER, GEO.ids.sources, hexId(43, 'e'), 'Source in the other space', [[OTHER, 'https://other.example.com/c']]),
    ] },
  };
  const f = readClaim(entity, { geo: GEO, spaceId: S });
  assert.equal(f.name, 'Name in its space');
  assert.equal(f.name_source, 'own');
  assert.equal(f.created_at, 1792050522);
  assert.equal(f.is_factual, false, 'the value of the claim\'s own space comes first');
  assert.deepEqual(f.tags, ['Context-dependent', 'Debate']);
  assert.deepEqual(f.topics, ['Courts', 'Zoning']);
  assert.deepEqual(f.sources.map((s) => [s.name, s.url, s.has_web_url]), [
    ['Alpha source', 'https://other.example.com/a', true],
    ['Beta source', 'https://example.com/b1', true],
    ['No url source', `https://www.geobrowser.io/space/${S}/${hexId(42, 'e')}`, false],
  ]);
  assert.equal(f.truncated, false);
});

test('readClaim: no Name value falls back to entity.name; the Is factual kinds; nothing at all gives null and empty lists', () => {
  const S = GEO.spaces[0].id;
  const base = { id: hexId(1), name: ' From the entity ', createdAt: 'x', values: { nodes: [{ spaceId: 'f'.repeat(32), property: { id: GEO.ids.name_property, name: 'Name' }, text: 'Another space only' }] }, relations: { nodes: [] } };
  const f = readClaim(base, { geo: GEO, spaceId: S });
  assert.deepEqual([f.name, f.name_source, f.created_at, f.is_factual, f.tags, f.topics, f.sources], ['From the entity', 'fallback', null, null, [], [], []]);
  const factual = (v) => readClaim({ ...base, values: { nodes: [{ spaceId: S, property: { id: hexId(9), name: 'Is factual' }, ...v }] } }, { geo: GEO, spaceId: S }).is_factual;
  assert.equal(factual({ boolean: true }), true);
  assert.equal(factual({ text: 'False' }), false);
  assert.equal(factual({ text: 'yes' }), true);
  assert.equal(factual({ integer: '1' }), true);
  assert.equal(factual({ float: 0 }), false);
  assert.equal(factual({ text: 'maybe' }), null);
  assert.equal(readClaim({ ...base, values: { nodes: Array.from({ length: 100 }, () => ({ spaceId: S, property: { name: 'x' } })) } }, { geo: GEO, spaceId: S }).truncated, true);
  assert.equal(readClaim(null, { geo: GEO, spaceId: S }).name, '');
});

// ---- the request log ------------------------------------------------------------------------------------------------------------

test('the request log holds ts, host, op, status and attempt per attempt and no body; countGeoRequests finds no non-query', async () => {
  const dir = tmp();
  const file = join(dir, 'nested', 'requests.jsonl');
  const geo = clone(GEO);
  const fake = createFakeGeo({ geo });
  addClaims(fake, 60);
  const now = () => new Date('2026-10-27T10:00:00.000Z');
  const client = createGeoClient({ geo, fetchImpl: fake.fetchImpl, log: geoRequestLogger(file, { now }), sleep: async () => {} });
  fake.failNext('500', 1);
  await client.paginateDebate(SPACE);
  await client.details([hexId(1), hexId(2)]);
  const text = readFileSync(file, 'utf8');
  const rows = text.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, fake.requests.length);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), ['ts', 'host', 'op', 'status', 'attempt']);
    assert.equal(row.ts, '2026-10-27T10:00:00.000Z');
    assert.equal(row.host, 'api-testnet.geobrowser.io');
    assert.ok(['DebateTagged', 'ClaimDetails'].includes(row.op));
  }
  assert.deepEqual(rows.map((r) => r.status).slice(0, 2), [500, 200]);
  for (const forbidden of [SPACE, GEO.ids.debate, GEO.ids.tags, hexId(1), 'relationsConnection', 'entity(', 'query', 'Claim number', 'variables']) {
    assert.equal(text.includes(forbidden), false, `the log must not contain ${forbidden}`);
  }
  assert.deepEqual(countGeoRequests(file), { total: rows.length, nonQuery: 0 });
});

test('countGeoRequests: a missing file is no requests, a line that is not a plain query line counts as non-query, a torn last line throws', () => {
  const dir = tmp();
  assert.deepEqual(countGeoRequests(join(dir, 'none.jsonl')), { total: 0, nonQuery: 0 });
  const file = join(dir, 'r.jsonl');
  const line = (o) => `${JSON.stringify(o)}\n`;
  writeFileSync(file, line({ ts: 't', host: 'h', op: 'DebateTagged', status: 200, attempt: 1 }));
  appendFileSync(file, line({ ts: 't', host: 'h', op: 'mutation', status: 200, attempt: 1 }));
  appendFileSync(file, line({ ts: 't', host: 'h', op: 'ClaimDetails', status: 200, attempt: 1, query: 'query ClaimDetails { a }' }));
  appendFileSync(file, line({ ts: 't', host: 'h', op: null, status: 200, attempt: 1 }));
  assert.deepEqual(countGeoRequests(file), { total: 4, nonQuery: 3 });
  appendFileSync(file, '{"ts":"t","host"');
  assert.throws(() => countGeoRequests(file), /half-written/);
  assert.throws(() => geoRequestLogger(''), TypeError);
});
