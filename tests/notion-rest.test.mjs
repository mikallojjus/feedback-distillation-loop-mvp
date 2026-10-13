import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API_BASE, BACKOFF_MS, MAX_RATE_LIMIT_RETRIES, MAX_SERVER_RETRIES, NotionError, clientFromConfig, createClient, loadToken,
} from '../agents/claim-tagger/scripts/lib/notion-rest.mjs';

const TOKEN = 'ntn_TEST_SECRET_0123456789';
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-agents-rest-'));
  dirs.push(d);
  return d;
};

const json = (body, { status = 200, headers = {} } = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A fake clock plus a counting fetch. `script` is a list of responses (or functions of the call) used in order; the last one repeats. */
function rig(script, { rps = 1000, token = TOKEN, apiVersion } = {}) {
  let t = 0;
  const sleeps = [];
  const calls = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body), at: t });
    const item = script[Math.min(i++, script.length - 1)];
    const res = typeof item === 'function' ? await item(calls.at(-1)) : item;
    if (res instanceof Error) throw res;
    return res instanceof Response ? res.clone() : res;
  };
  const events = [];
  const client = createClient({
    token, apiVersion, requestsPerSecond: rps, fetchImpl, log: (e) => events.push(e),
    sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t,
  });
  return { client, calls, sleeps, events, clock: () => t };
}

// ---- requests ----

test('every request carries the bearer token and the pinned API version; the body is JSON', async () => {
  const r = rig([json({ object: 'page', id: 'p1' })]);
  await r.client.updatePage('p1', { properties: { A: { checkbox: true } } });
  const c = r.calls[0];
  assert.equal(c.url, `${API_BASE}/pages/p1`);
  assert.equal(c.method, 'PATCH');
  assert.equal(c.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(c.headers['Notion-Version'], '2022-06-28');
  assert.equal(c.headers['Content-Type'], 'application/json');
  assert.deepEqual(c.body, { properties: { A: { checkbox: true } } });
  const r2 = rig([json({ object: 'database', id: 'd' })], { apiVersion: '2025-09-03' });
  await r2.client.retrieveDatabase('d');
  assert.equal(r2.calls[0].headers['Notion-Version'], '2025-09-03');
  assert.equal(r2.calls[0].method, 'GET');
  assert.equal(r2.calls[0].body, undefined);
});

test('createPage posts the parent database and properties; the first 100 blocks ride along, the rest are appended', async () => {
  const blocks = Array.from({ length: 230 }, (_, i) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: `p${i}` } }] } }));
  const r = rig([json({ object: 'page', id: 'new-page' }), json({ results: [] })]);
  const page = await r.client.createPage({ parentDatabaseId: 'db-1', properties: { Name: { title: [] } }, children: blocks });
  assert.equal(page.id, 'new-page');
  assert.equal(r.calls[0].url, `${API_BASE}/pages`);
  assert.equal(r.calls[0].method, 'POST');
  assert.deepEqual(r.calls[0].body.parent, { database_id: 'db-1' });
  assert.equal(r.calls[0].body.children.length, 100);
  assert.equal(r.calls.length, 3);
  assert.equal(r.calls[1].url, `${API_BASE}/blocks/new-page/children`);
  assert.equal(r.calls[1].method, 'PATCH');
  assert.equal(r.calls[1].body.children.length, 100);
  assert.equal(r.calls[2].body.children.length, 30);
  assert.equal(r.calls[2].body.children[0].paragraph.rich_text[0].text.content, 'p200');
});

test('createPage without children sends no children key; appendBlocks chunks by 100', async () => {
  const r = rig([json({ object: 'page', id: 'p' })]);
  await r.client.createPage({ parentDatabaseId: 'db-1', properties: {} });
  assert.equal('children' in r.calls[0].body, false);
  const r2 = rig([json({ results: [{ id: 'b' }] })]);
  const made = await r2.client.appendBlocks('blk', Array.from({ length: 101 }, () => ({ type: 'divider', divider: {} })));
  assert.equal(r2.calls.length, 2);
  assert.equal(made.length, 2);
});

// ---- pagination ----

test('queryDatabase follows next_cursor and yields every page; queryAll collects them', async () => {
  const r = rig([
    json({ results: [{ id: 'a' }, { id: 'b' }], has_more: true, next_cursor: 'c1' }),
    json({ results: [{ id: 'c' }], has_more: true, next_cursor: 'c2' }),
    json({ results: [{ id: 'd' }], has_more: false, next_cursor: null }),
  ]);
  const seen = [];
  for await (const p of r.client.queryDatabase('db', { filter: { property: 'X', checkbox: { equals: true } }, pageSize: 2 })) seen.push(p.id);
  assert.deepEqual(seen, ['a', 'b', 'c', 'd']);
  assert.equal(r.calls.length, 3);
  assert.equal(r.calls[0].url, `${API_BASE}/databases/db/query`);
  assert.deepEqual(r.calls[0].body, { page_size: 2, filter: { property: 'X', checkbox: { equals: true } } });
  assert.equal(r.calls[1].body.start_cursor, 'c1');
  assert.equal(r.calls[2].body.start_cursor, 'c2');
  const r2 = rig([json({ results: [{ id: 'x' }], has_more: true, next_cursor: 'k' }), json({ results: [{ id: 'y' }], has_more: false })]);
  assert.deepEqual((await r2.client.queryAll('db')).map((p) => p.id), ['x', 'y']);
  assert.equal(r2.calls[0].body.page_size, 100, 'the default page size is 100');
});

test('a broken cursor chain throws instead of looping or truncating', async () => {
  const noCursor = rig([json({ results: [{ id: 'a' }], has_more: true, next_cursor: null })]);
  await assert.rejects(() => noCursor.client.queryAll('db'), (e) => e.code === 'BROKEN_CURSOR');
  const repeat = rig([json({ results: [{ id: 'a' }], has_more: true, next_cursor: 'same' })]);
  await assert.rejects(() => repeat.client.queryAll('db'), (e) => e.code === 'BROKEN_CURSOR');
  assert.ok(repeat.calls.length <= 3, 'it stops at the repeated cursor');
});

test('retrievePropertyItem collects every page of a long relation', async () => {
  const item = (id) => ({ object: 'property_item', type: 'relation', relation: { id } });
  const r = rig([
    json({ object: 'list', results: [item('a'), item('b')], has_more: true, next_cursor: 'n1', type: 'property_item' }),
    json({ object: 'list', results: [item('c')], has_more: false, next_cursor: null, type: 'property_item' }),
  ]);
  const items = await r.client.retrievePropertyItem('page-1', 'prop%3A1');
  assert.deepEqual(items.map((i) => i.relation.id), ['a', 'b', 'c']);
  assert.equal(r.calls[0].url, `${API_BASE}/pages/page-1/properties/prop%3A1?page_size=100`);
  assert.equal(r.calls[1].url, `${API_BASE}/pages/page-1/properties/prop%3A1?page_size=100&start_cursor=n1`);
  const raw = rig([json({ object: 'list', results: [], has_more: false })]);
  await raw.client.retrievePropertyItem('page-1', 'a b');
  assert.equal(raw.calls[0].url, `${API_BASE}/pages/page-1/properties/a%20b?page_size=100`, 'an id that is not encoded yet is encoded once');
  const single = rig([json({ object: 'property_item', type: 'number', number: 3 })]);
  assert.deepEqual(await single.client.retrievePropertyItem('p', 'n'), [{ object: 'property_item', type: 'number', number: 3 }]);
});

// ---- pacing ----

test('pacing: 3 requests per second on a fake clock, requests spaced a third of a second apart', async () => {
  const r = rig([json({ ok: true })], { rps: 3 });
  for (let i = 0; i < 12; i++) await r.client.retrievePage(`p${i}`);
  assert.equal(r.calls.length, 12);
  assert.ok(r.clock() >= 3600, `12 requests at 3/s are spaced 334 ms apart: 11 gaps take about 3.7 s, took ${r.clock()} ms`);
  assert.ok(r.clock() <= 3800, `and not much more (${r.clock()} ms)`);
  const times = r.calls.map((c) => c.at);
  for (let i = 0; i + 3 < times.length; i++) {
    assert.ok(times[i + 3] - times[i] >= 1000, `requests ${i} and ${i + 3} are at least a second apart, so at most 3 fall in any second`);
  }
});

test('pacing: concurrent callers share one bucket', async () => {
  const r = rig([json({ ok: true })], { rps: 2 });
  await Promise.all(Array.from({ length: 6 }, (_, i) => r.client.retrievePage(`p${i}`)));
  assert.equal(r.calls.length, 6);
  assert.ok(r.clock() >= 2400, `6 requests at 2/s are spaced 500 ms apart: 5 gaps take about 2.5 s, took ${r.clock()} ms`);
});

// ---- retries ----

test('429: sleeps for Retry-After seconds, then retries and succeeds', async () => {
  const r = rig([json({ code: 'rate_limited', message: 'slow down' }, { status: 429, headers: { 'Retry-After': '2' } }), json({ object: 'page', id: 'p' })]);
  const page = await r.client.retrievePage('p');
  assert.equal(page.id, 'p');
  assert.equal(r.calls.length, 2);
  assert.deepEqual(r.sleeps, [2000]);
  assert.deepEqual(r.events.map((e) => e.status), [429, 200]);
});

test('429 without a usable Retry-After waits one second; after 5 retries it gives up with a retryable error', async () => {
  const r = rig([json({ code: 'rate_limited', message: 'slow down' }, { status: 429 })]);
  await assert.rejects(() => r.client.retrievePage('p'), (e) => e instanceof NotionError && e.status === 429 && e.code === 'rate_limited' && e.retryable === true);
  assert.equal(r.calls.length, MAX_RATE_LIMIT_RETRIES + 1);
  assert.deepEqual(r.sleeps, Array(MAX_RATE_LIMIT_RETRIES).fill(1000));
});

test('5xx: backs off 0.5, 1, 2 seconds and gives up after 3 retries', async () => {
  const fail = json({ code: 'internal_server_error', message: 'boom' }, { status: 500 });
  const r = rig([fail, fail, json({ object: 'page', id: 'ok' })]);
  assert.equal((await r.client.retrievePage('p')).id, 'ok');
  assert.deepEqual(r.sleeps, [BACKOFF_MS[0], BACKOFF_MS[1]]);
  const dead = rig([json({ code: 'service_unavailable', message: 'down' }, { status: 503 })]);
  await assert.rejects(() => dead.client.retrievePage('p'), (e) => e.status === 503 && e.code === 'service_unavailable' && e.retryable === true);
  assert.equal(dead.calls.length, MAX_SERVER_RETRIES + 1);
  assert.deepEqual(dead.sleeps, [...BACKOFF_MS]);
});

test('409 conflict is retried like a 5xx', async () => {
  const r = rig([json({ code: 'conflict_error', message: 'data collision' }, { status: 409 }), json({ object: 'page', id: 'ok' })]);
  assert.equal((await r.client.retrievePage('p')).id, 'ok');
  assert.equal(r.calls.length, 2);
});

test('a network failure is retried, then reported as retryable without the token', async () => {
  const r = rig([new TypeError(`fetch failed for ${TOKEN}`)]);
  await assert.rejects(() => r.client.retrievePage('p'), (e) => e.code === 'network_error' && e.retryable === true && !e.message.includes(TOKEN));
  assert.equal(r.calls.length, MAX_SERVER_RETRIES + 1);
});

// ---- errors ----

test('4xx: one attempt, an error with status, code and Notion message', async () => {
  const r = rig([json({ object: 'error', status: 400, code: 'validation_error', message: 'Priority is expected to be select.' }, { status: 400 })]);
  await assert.rejects(
    () => r.client.updatePage('p', { properties: {} }),
    (e) => e instanceof NotionError && e.status === 400 && e.code === 'validation_error' && e.retryable === false && /Priority is expected to be select/.test(e.message) && /PATCH \/pages\/p/.test(e.message),
  );
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.sleeps, []);
  const nf = rig([json({ code: 'object_not_found', message: 'Could not find page' }, { status: 404 })]);
  await assert.rejects(() => nf.client.retrievePage('gone'), (e) => e.status === 404 && e.code === 'object_not_found');
  const noBody = rig([new Response('', { status: 401 })]);
  await assert.rejects(() => noBody.client.retrievePage('p'), (e) => e.status === 401 && e.code === null);
});

test('the token never appears in an error, a log event, or the client object', async () => {
  const r = rig([json({ code: 'unauthorized', message: `API token is invalid: ${TOKEN} / Bearer ${TOKEN}` }, { status: 401 })]);
  let caught;
  try {
    await r.client.retrievePage('p');
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, 'it threw');
  assert.equal(caught.message.includes(TOKEN), false);
  assert.equal(String(caught.stack).includes(TOKEN), false);
  assert.equal(JSON.stringify(r.events).includes(TOKEN), false);
  assert.equal(JSON.stringify(Object.entries(r.client)).includes(TOKEN), false);
  assert.match(caught.message, /\[token\]/);
});

test('createClient insists on a token, a function fetch and a positive rate', () => {
  assert.throws(() => createClient({}), /token is required/);
  assert.throws(() => createClient({ token: '  ' }), /token is required/);
  assert.throws(() => createClient({ token: 'x', fetchImpl: 5 }), /fetchImpl/);
  assert.throws(() => createClient({ token: 'x', fetchImpl: () => {}, requestsPerSecond: 0 }), RangeError);
});

// ---- token loading ----

test('loadToken: no .env gives null, whatever the process environment holds', () => {
  const dir = tmp();
  const before = process.env.NOTION_TOKEN;
  process.env.NOTION_TOKEN = 'from-the-environment';
  try {
    assert.equal(loadToken(dir), null);
    assert.equal(process.env.NOTION_TOKEN, 'from-the-environment', 'the environment is left as it was');
  } finally {
    if (before === undefined) delete process.env.NOTION_TOKEN;
    else process.env.NOTION_TOKEN = before;
  }
});

test('loadToken: reads NOTION_TOKEN from .env and leaves process.env alone', () => {
  const dir = tmp();
  writeFileSync(join(dir, '.env'), `# comment\nOTHER=1\nNOTION_TOKEN="${TOKEN}"\n`);
  const before = process.env.NOTION_TOKEN;
  delete process.env.NOTION_TOKEN;
  try {
    assert.equal(loadToken(dir), TOKEN);
    assert.equal(process.env.NOTION_TOKEN, undefined, 'the token is not left in the environment');
    assert.equal(process.env.OTHER, undefined);
    assert.equal(loadToken(dir), TOKEN, 'and loading twice works');
  } finally {
    if (before !== undefined) process.env.NOTION_TOKEN = before;
  }
});

test('loadToken: the placeholder, an empty value and a file without the variable all give null', () => {
  for (const content of ['NOTION_TOKEN=ntn_replace_me\n', 'NOTION_TOKEN=\n', 'SOMETHING_ELSE=1\n', '']) {
    const dir = tmp();
    writeFileSync(join(dir, '.env'), content);
    assert.equal(loadToken(dir), null, JSON.stringify(content));
  }
});

test('clientFromConfig: null without a token; with one it uses the config version and rate', async () => {
  const dir = tmp();
  mkdirSync(join(dir, 'x'));
  assert.equal(clientFromConfig({ notion: {} }, { repoRoot: dir }), null);
  const calls = [];
  const client = clientFromConfig(
    { notion: { api_version: '2024-01-01', requests_per_second: 50 } },
    { token: TOKEN, fetchImpl: async (url, init) => { calls.push(init.headers); return json({ object: 'page', id: 'p' }); } },
  );
  await client.retrievePage('p');
  assert.equal(calls[0]['Notion-Version'], '2024-01-01');
  const fromEnvFile = (() => {
    const d = tmp();
    writeFileSync(join(d, '.env'), `NOTION_TOKEN=${TOKEN}\n`);
    return clientFromConfig({}, { repoRoot: d, fetchImpl: async (url, init) => { calls.push(init.headers); return json({}); } });
  })();
  await fromEnvFile.retrievePage('p');
  assert.equal(calls[1]['Notion-Version'], '2022-06-28', 'the default version');
  assert.equal(calls[1].Authorization, `Bearer ${TOKEN}`);
});

test('loadToken: Windows line ends, quotes, export and a byte-order mark in .env are all handled', () => {
  const cases = [
    [`NOTION_TOKEN=${TOKEN}\r\nOTHER=1\r\n`, TOKEN],
    [`export NOTION_TOKEN='${TOKEN}'  # the integration token\n`, TOKEN],
    [`﻿NOTION_TOKEN=${TOKEN}\r\n`, TOKEN],
    ['﻿# only a comment\r\n', null],
    [`﻿NOTION_TOKEN=ntn_replace_me\n`, null],
  ];
  for (const [content, expected] of cases) {
    const dir = tmp();
    writeFileSync(join(dir, '.env'), content);
    assert.equal(loadToken(dir), expected, JSON.stringify(content));
    assert.equal(process.env.NOTION_TOKEN === TOKEN, false, 'the token never stays in the environment');
  }
});
