import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API_BASE, BACKOFF_MS, BUILDER_API_VERSION, DEFAULT_API_VERSION, MAX_RATE_LIMIT_RETRIES, MAX_SERVER_RETRIES, NotionError,
  clientFromConfig, countRequests, createClient, loadToken, requestLogger, splitRichText,
} from '../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';

const MODULE = fileURLToPath(new URL('../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs', import.meta.url));
const TOKEN = 'ntn_TEST_SECRET_0123456789';
const FOLDER = '\u{1F4CB}'; // an emoji, written as an escape so this file stays ASCII

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-rest-'));
  dirs.push(d);
  return d;
};

const json = (body, { status = 200, headers = {} } = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const text = (content) => [{ type: 'text', text: { content } }];

/**
 * A fake clock plus a counting fetch. `script` is a list of responses (or functions of the call) used in order; the last one repeats.
 * `log` is called with every event after the rig has recorded it (the way a requestLogger is plugged in).
 */
function rig(script, { rps = 1000, token = TOKEN, apiVersion, log } = {}) {
  let t = 0;
  const sleeps = [];
  const calls = [];
  const events = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body), at: t });
    const item = script[Math.min(i++, script.length - 1)];
    const res = typeof item === 'function' ? await item(calls.at(-1)) : item;
    if (res instanceof Error) throw res;
    return res instanceof Response ? res.clone() : res;
  };
  const client = createClient({
    token, apiVersion, requestsPerSecond: rps, fetchImpl,
    log: (e) => { events.push(e); log?.(e); },
    sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t,
  });
  return { client, calls, sleeps, events, clock: () => t };
}

// ---- versions ----------------------------------------------------------------------------------------------------------------

test('BUILDER_API_VERSION is 2026-03-11 next to the old default 2022-06-28, and a client sends the version it was built with', async () => {
  assert.equal(BUILDER_API_VERSION, '2026-03-11');
  assert.equal(DEFAULT_API_VERSION, '2022-06-28');
  const def = rig([json({ object: 'page', id: 'p' })]);
  await def.client.retrievePage('p');
  assert.equal(def.calls[0].headers['Notion-Version'], '2022-06-28');
  assert.equal(def.calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(def.calls[0].headers['Content-Type'], 'application/json');
  const builder = rig([json({ object: 'view', id: 'v' })], { apiVersion: BUILDER_API_VERSION });
  await builder.client.retrieveView('v');
  assert.equal(builder.calls[0].headers['Notion-Version'], '2026-03-11');
});

test('clientFromConfig: opts.apiVersion beats the version in config.json, which beats the default; no token still gives null', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.headers['Notion-Version']);
    return json({ object: 'page', id: 'p' });
  };
  const config = { notion: { api_version: '2024-01-01', builder_api_version: BUILDER_API_VERSION } };
  await clientFromConfig(config, { token: TOKEN, fetchImpl }).retrievePage('p');
  await clientFromConfig(config, { token: TOKEN, fetchImpl, apiVersion: BUILDER_API_VERSION }).retrievePage('p');
  await clientFromConfig({}, { token: TOKEN, fetchImpl }).retrievePage('p');
  await clientFromConfig({ notion: {} }, { token: TOKEN, fetchImpl, apiVersion: BUILDER_API_VERSION }).retrievePage('p');
  assert.deepEqual(seen, ['2024-01-01', '2026-03-11', '2022-06-28', '2026-03-11']);
  assert.equal(clientFromConfig(config, { repoRoot: tmp(), apiVersion: BUILDER_API_VERSION }), null, 'a folder without .env has no token');
});

test('the client offers exactly the old calls and the new ones, and nothing that takes anything away', () => {
  const client = createClient({ token: TOKEN, fetchImpl: async () => json({}) });
  assert.deepEqual(Object.keys(client).sort(), [
    'appendBlocks', 'createDatabase', 'createPage', 'createPageUnderPage', 'createView', 'listViews', 'queryAll', 'queryDataSource', 'queryDataSourceAll',
    'queryDatabase', 'retrieveBlockChildren', 'retrieveDataSource', 'retrieveDatabase', 'retrievePage', 'retrievePropertyItem', 'retrieveView', 'updateDataSource', 'updatePage', 'updateView',
  ]);
  for (const name of Object.keys(client)) assert.doesNotMatch(name, /delete|remove|archive|trash|restore/i, name);
});

// ---- createDatabase ------------------------------------------------------------------------------------------------------------

test('createDatabase: POST /databases with the parent page, rich-text title and description, is_inline, initial_data_source and an emoji icon', async () => {
  const answer = { object: 'database', id: 'db-1', data_sources: [{ id: 'ds-1', name: 'Claims' }], url: 'https://www.notion.so/db1', is_inline: false };
  const r = rig([json(answer)], { apiVersion: BUILDER_API_VERSION });
  const properties = {
    Name: { type: 'title', title: {} },
    Status: { type: 'select', select: { options: [{ name: 'Open', color: 'blue' }, { name: 'Done', color: 'green' }] } },
  };
  const db = await r.client.createDatabase({
    parentPageId: 'page-1', title: 'Claims to check', description: 'The claims the agent tags', isInline: false, properties, icon: FOLDER,
  });
  assert.deepEqual(db, answer, 'the answer is returned as it came, data_sources included');
  assert.equal(r.calls.length, 1);
  const c = r.calls[0];
  assert.equal(c.url, `${API_BASE}/databases`);
  assert.equal(c.method, 'POST');
  assert.equal(c.headers['Notion-Version'], '2026-03-11');
  assert.equal(c.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(c.headers['Content-Type'], 'application/json');
  assert.deepEqual(c.body, {
    parent: { type: 'page_id', page_id: 'page-1' },
    title: text('Claims to check'),
    description: text('The claims the agent tags'),
    is_inline: false,
    initial_data_source: { properties },
    icon: { type: 'emoji', emoji: FOLDER },
  });
});

test('createDatabase: inline by default; no description or icon key unless given; long text is split; a rich-text array and an icon object pass through', async () => {
  const r = rig([json({ object: 'database', id: 'db' })]);
  await r.client.createDatabase({ parentPageId: 'p', title: 'T', properties: { Name: { type: 'title', title: {} } } });
  assert.deepEqual(r.calls[0].body, {
    parent: { type: 'page_id', page_id: 'p' }, title: text('T'), is_inline: true, initial_data_source: { properties: { Name: { type: 'title', title: {} } } },
  });
  assert.deepEqual(Object.keys(r.calls[0].body).sort(), ['initial_data_source', 'is_inline', 'parent', 'title']);

  const long = 'x'.repeat(2500);
  await r.client.createDatabase({ parentPageId: 'p', title: long, description: long, properties: {} });
  assert.deepEqual(r.calls[1].body.title.map((c) => c.text.content.length), [2000, 500]);
  assert.deepEqual(r.calls[1].body.description.map((c) => c.text.content.length), [2000, 500]);
  assert.deepEqual(r.calls[1].body.title, splitRichText(long));

  const linked = [{ type: 'text', text: { content: 'Docs', link: { url: 'https://example.com' } } }];
  const icon = { type: 'external', external: { url: 'https://example.com/i.png' } };
  await r.client.createDatabase({ parentPageId: 'p', title: linked, properties: {}, icon });
  assert.deepEqual(r.calls[2].body.title, linked);
  assert.deepEqual(r.calls[2].body.icon, icon);
});

test('createDatabase needs a parent page id and sends nothing without one', async () => {
  const r = rig([json({ object: 'database', id: 'db' })]);
  await assert.rejects(() => r.client.createDatabase({ title: 'T', properties: {} }), (e) => e instanceof TypeError && /parentPageId/.test(e.message));
  await assert.rejects(() => r.client.createDatabase({ parentPageId: '  ', title: 'T' }), TypeError);
  await assert.rejects(() => r.client.createDatabase(), TypeError);
  assert.equal(r.calls.length, 0);
});

// A create whose answer is lost: every way it can happen. The second response is what a second POST would have got.
const LOST_ANSWERS = [
  ['a 500', () => json({ code: 'internal_server_error', message: 'boom' }, { status: 500 }), 500, /500 internal_server_error: boom/],
  ['a 502', () => json({ code: 'bad_gateway', message: 'gateway' }, { status: 502 }), 502, /502 bad_gateway/],
  ['a 503', () => json({ code: 'service_unavailable', message: 'down' }, { status: 503 }), 503, /503 service_unavailable/],
  ['a 409', () => json({ code: 'conflict_error', message: 'data collision' }, { status: 409 }), 409, /409 conflict_error/],
  ['a network failure', () => new TypeError(`fetch failed for ${TOKEN}`), null, /network failure/],
  ['an empty 2xx', () => new Response('', { status: 200 }), 200, /could not be read/],
  ['a 2xx without an id', () => json({ object: 'list' }), 200, /could not be read/],
  ['a 2xx whose body breaks off', () => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers(), text: async () => { throw new TypeError('terminated'); } }), 200, /could not be read/],
];

test('createDatabase is never sent twice: a 5xx, a 409, a network failure or an unreadable 2xx is create_uncertain, retryable, one POST, no backoff', async () => {
  for (const [label, make, status, why] of LOST_ANSWERS) {
    const r = rig([make(), json({ object: 'database', id: 'second-copy' })]);
    await assert.rejects(
      () => r.client.createDatabase({ parentPageId: 'page-1', title: 'T', properties: { Name: { type: 'title', title: {} } } }),
      (e) => e instanceof NotionError && e.name === 'NotionError' && e.code === 'create_uncertain' && e.retryable === true && e.status === status
        && /^Notion POST \/databases: /.test(e.message) && why.test(e.message)
        && /The database may exist in Notion already, so the create was not sent again/.test(e.message)
        && /no script can remove a duplicate database \(hard rule 8\)/.test(e.message)
        && !e.message.includes(TOKEN) && !String(e.stack).includes(TOKEN),
      label,
    );
    assert.equal(r.calls.length, 1, `${label}: exactly one POST /databases`);
    assert.equal(r.calls[0].method, 'POST');
    assert.equal(r.calls[0].url, `${API_BASE}/databases`);
    assert.deepEqual(r.sleeps, [], `${label}: no backoff and no second try`);
    assert.equal(r.events.length, 1, `${label}: one attempt in the log`);
  }
  const net = rig([new TypeError(`fetch failed for ${TOKEN}`)]);
  await assert.rejects(() => net.client.createDatabase({ parentPageId: 'p', title: 'T', properties: {} }), (e) => /\[token\]/.test(e.message));
});

test('createDatabase: a 429 is retried (Notion did not process it), a 4xx is the plain error it always was', async () => {
  const limited = rig([json({ code: 'rate_limited', message: 'slow down' }, { status: 429, headers: { 'Retry-After': '2' } }), json({ object: 'database', id: 'made' })]);
  assert.equal((await limited.client.createDatabase({ parentPageId: 'p', title: 'T', properties: {} })).id, 'made');
  assert.equal(limited.calls.length, 2);
  assert.deepEqual(limited.sleeps, [2000]);

  const bad = rig([json({ code: 'validation_error', message: 'initial_data_source.properties should be defined.' }, { status: 400 }), json({ object: 'database', id: 'second' })]);
  await assert.rejects(
    () => bad.client.createDatabase({ parentPageId: 'p', title: 'T', properties: {} }),
    (e) => e instanceof NotionError && e.code === 'validation_error' && e.retryable === false && e.status === 400 && /POST \/databases -> 400/.test(e.message),
  );
  assert.equal(bad.calls.length, 1);

  const gone = rig([json({ code: 'object_not_found', message: 'Could not find page with ID' }, { status: 404 })]);
  await assert.rejects(() => gone.client.createDatabase({ parentPageId: 'p', title: 'T', properties: {} }), (e) => e.status === 404 && e.code === 'object_not_found' && e.retryable === false);
});

// ---- createPageUnderPage --------------------------------------------------------------------------------------------------------

test('createPageUnderPage: POST /pages with a page parent and the title property; the first 100 blocks ride along, the rest are appended', async () => {
  const blocks = Array.from({ length: 230 }, (_, i) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: text(`p${i}`) } }));
  const r = rig([json({ object: 'page', id: 'new-page' }), json({ results: [] })]);
  const page = await r.client.createPageUnderPage({ parentPageId: 'parent-1', title: 'Feedback loop', children: blocks, icon: FOLDER });
  assert.equal(page.id, 'new-page');
  assert.equal(r.calls.length, 3);
  const [create, first, second] = r.calls;
  assert.equal(create.url, `${API_BASE}/pages`);
  assert.equal(create.method, 'POST');
  assert.equal(create.headers['Notion-Version'], '2022-06-28');
  assert.deepEqual(create.body.parent, { type: 'page_id', page_id: 'parent-1' });
  assert.deepEqual(create.body.properties, { title: { title: text('Feedback loop') } });
  assert.deepEqual(create.body.icon, { type: 'emoji', emoji: FOLDER });
  assert.equal(create.body.children.length, 100);
  assert.equal(first.url, `${API_BASE}/blocks/new-page/children`);
  assert.equal(first.method, 'PATCH');
  assert.equal(first.body.children.length, 100);
  assert.equal(second.body.children.length, 30);
  assert.equal(second.body.children[0].paragraph.rich_text[0].text.content, 'p200');
});

test('createPageUnderPage: no children or icon key unless given; a long title is split; a parent id is required', async () => {
  const r = rig([json({ object: 'page', id: 'p' })]);
  await r.client.createPageUnderPage({ parentPageId: 'par', title: 'T' });
  assert.deepEqual(r.calls[0].body, { parent: { type: 'page_id', page_id: 'par' }, properties: { title: { title: text('T') } } });
  await r.client.createPageUnderPage({ parentPageId: 'par', title: 't'.repeat(2001) });
  assert.deepEqual(r.calls[1].body.properties.title.title.map((c) => c.text.content.length), [2000, 1]);
  await assert.rejects(() => r.client.createPageUnderPage({ title: 'T' }), (e) => e instanceof TypeError && /parentPageId/.test(e.message));
  assert.equal(r.calls.length, 2);
});

test('createPageUnderPage is never sent twice either (create_uncertain, the page message), and a row create keeps its own message', async () => {
  for (const [label, make, status] of LOST_ANSWERS) {
    const r = rig([make(), json({ object: 'page', id: 'second-copy' })]);
    await assert.rejects(
      () => r.client.createPageUnderPage({ parentPageId: 'par', title: 'T' }),
      (e) => e.code === 'create_uncertain' && e.retryable === true && e.status === status && /The page may exist in Notion already/.test(e.message)
        && /under its parent page/.test(e.message) && !/apply\.mjs/.test(e.message) && !e.message.includes(TOKEN),
      label,
    );
    assert.equal(r.calls.length, 1, label);
    assert.deepEqual(r.sleeps, [], label);
  }
  const row = rig([json({ code: 'internal_server_error', message: 'boom' }, { status: 500 }), json({ object: 'page', id: 'second-copy' })]);
  await assert.rejects(
    () => row.client.createPage({ parentDatabaseId: 'db-1', properties: {} }),
    (e) => e.code === 'create_uncertain' && /The row may exist in Notion already/.test(e.message) && /apply\.mjs --run <id> --retry/.test(e.message),
  );
  assert.equal(row.calls.length, 1);
});

test('the blocks after the first hundred of a page under a page go in a PATCH, which keeps its retries', async () => {
  const blocks = Array.from({ length: 120 }, () => ({ object: 'block', type: 'divider', divider: {} }));
  const boom = json({ code: 'internal_server_error', message: 'boom' }, { status: 500 });
  const r = rig([json({ object: 'page', id: 'new-page' }), boom, json({ results: [] })]);
  assert.equal((await r.client.createPageUnderPage({ parentPageId: 'par', title: 'T', children: blocks })).id, 'new-page');
  assert.deepEqual(r.calls.map((c) => c.method), ['POST', 'PATCH', 'PATCH']);
});

// ---- createView ------------------------------------------------------------------------------------------------------------------

test('createView: POST /views with every field that is given, in the shape of the API', async () => {
  const r = rig([json({ object: 'view', id: 'view-1', parent: { type: 'database_id', database_id: 'db-1' }, type: 'table' })], { apiVersion: BUILDER_API_VERSION });
  const filter = { and: [{ property: 'Readiness', select: { equals: 'Ready' } }, { property: 'Status', status: { does_not_equal: ['Done', 'Archive'] } }] };
  const sorts = [{ property: 'Created', direction: 'descending' }, { timestamp: 'last_edited_time', direction: 'ascending' }];
  const configuration = { type: 'table', properties: [{ property_id: 'title', visible: true }, { property_id: 'abc%3D', visible: false, width: 120 }], frozen_column_index: 0 };
  const view = await r.client.createView({
    databaseId: 'db-1', dataSourceId: 'ds-1', name: 'Your queue', type: 'table', filter, sorts, configuration, position: { type: 'start' },
  });
  assert.equal(view.id, 'view-1');
  assert.equal(r.calls.length, 1);
  const c = r.calls[0];
  assert.equal(c.url, `${API_BASE}/views`);
  assert.equal(c.method, 'POST');
  assert.equal(c.headers['Notion-Version'], '2026-03-11');
  assert.equal(c.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(c.body, {
    database_id: 'db-1', data_source_id: 'ds-1', name: 'Your queue', type: 'table', filter, sorts, configuration, position: { type: 'start' },
  });
});

test('createView: only the fields that are given are sent, and the type is a table unless said otherwise', async () => {
  const r = rig([json({ object: 'view', id: 'v' })]);
  await r.client.createView({ databaseId: 'db', dataSourceId: 'ds', name: 'All' });
  assert.deepEqual(r.calls[0].body, { database_id: 'db', data_source_id: 'ds', name: 'All', type: 'table' });
  await r.client.createView({ databaseId: 'db', dataSourceId: 'ds', name: 'Board', type: 'board', position: { type: 'after_view', view_id: 'v0' } });
  assert.deepEqual(r.calls[1].body, { database_id: 'db', data_source_id: 'ds', name: 'Board', type: 'board', position: { type: 'after_view', view_id: 'v0' } });
  await r.client.createView({ databaseId: 'db', dataSourceId: 'ds', name: 'Nothing else', filter: null, sorts: undefined, configuration: null, position: undefined });
  assert.deepEqual(Object.keys(r.calls[2].body).sort(), ['data_source_id', 'database_id', 'name', 'type'], 'null and undefined mean "not given"');
  await r.client.createView({ databaseId: 'db', dataSourceId: 'ds', name: 'No sort', sorts: [] });
  assert.deepEqual(r.calls[3].body.sorts, [], 'an empty list is a value');
  await r.client.createView({ databaseId: 'db', dataSourceId: 'ds' });
  assert.equal('name' in r.calls[4].body, false, 'no name key without a name');
});

test('createView needs a database id and a data source id and sends nothing without them', async () => {
  const r = rig([json({ object: 'view', id: 'v' })]);
  await assert.rejects(() => r.client.createView({ dataSourceId: 'ds', name: 'x' }), (e) => e instanceof TypeError && /databaseId/.test(e.message));
  await assert.rejects(() => r.client.createView({ databaseId: 'db', name: 'x' }), (e) => e instanceof TypeError && /dataSourceId/.test(e.message));
  await assert.rejects(() => r.client.createView(), TypeError);
  assert.equal(r.calls.length, 0);
});

test('createView is never sent twice: a 5xx, a 409, a network failure or an unreadable 2xx is create_uncertain, retryable, one POST, no backoff', async () => {
  for (const [label, make, status, why] of LOST_ANSWERS) {
    const r = rig([make(), json({ object: 'view', id: 'second-copy' })]);
    await assert.rejects(
      () => r.client.createView({ databaseId: 'db', dataSourceId: 'ds', name: 'x' }),
      (e) => e instanceof NotionError && e.code === 'create_uncertain' && e.retryable === true && e.status === status
        && /^Notion POST \/views: /.test(e.message) && why.test(e.message)
        && /The view may exist in Notion already, so the create was not sent again/.test(e.message) && /listViews/.test(e.message)
        && !e.message.includes(TOKEN),
      label,
    );
    assert.equal(r.calls.length, 1, `${label}: exactly one POST /views`);
    assert.equal(r.calls[0].url, `${API_BASE}/views`);
    assert.deepEqual(r.sleeps, [], `${label}: no backoff and no second try`);
  }
  const limited = rig([json({ code: 'rate_limited', message: 'slow' }, { status: 429, headers: { 'Retry-After': '3' } }), json({ object: 'view', id: 'made' })]);
  assert.equal((await limited.client.createView({ databaseId: 'db', dataSourceId: 'ds', name: 'x' })).id, 'made');
  assert.deepEqual(limited.sleeps, [3000], 'a 429 is retried');
  const bad = rig([json({ code: 'validation_error', message: 'bad view' }, { status: 400 })]);
  await assert.rejects(() => bad.client.createView({ databaseId: 'db', dataSourceId: 'ds', name: 'x' }), (e) => e.code === 'validation_error' && e.retryable === false);
  assert.equal(bad.calls.length, 1);
});

// ---- reads -------------------------------------------------------------------------------------------------------------------------

test('retrieveView and retrieveDataSource are GETs of one object, without a body', async () => {
  const r = rig([json({ object: 'view', id: 'v 1', name: 'All' }), json({ object: 'data_source', id: 'ds-1', properties: { Name: { type: 'title' } } })], { apiVersion: BUILDER_API_VERSION });
  assert.equal((await r.client.retrieveView('v 1')).name, 'All');
  assert.equal((await r.client.retrieveDataSource('ds-1')).properties.Name.type, 'title');
  assert.deepEqual(r.calls.map((c) => [c.method, c.url, c.body]), [
    ['GET', `${API_BASE}/views/v%201`, undefined],
    ['GET', `${API_BASE}/data_sources/ds-1`, undefined],
  ]);
  for (const c of r.calls) {
    assert.equal(c.headers['Notion-Version'], '2026-03-11');
    assert.equal(c.headers.Authorization, `Bearer ${TOKEN}`);
  }
  const gone = rig([json({ code: 'object_not_found', message: 'no such view' }, { status: 404 })]);
  await assert.rejects(() => gone.client.retrieveView('nope'), (e) => e.status === 404 && e.code === 'object_not_found' && /GET \/views\/nope/.test(e.message));
});

test('listViews: GET /views?database_id=...&page_size=100, follows the cursor, returns the flattened view references', async () => {
  const ref = (id) => ({ object: 'view', id });
  const r = rig([
    json({ object: 'list', results: [ref('v1'), ref('v2')], has_more: true, next_cursor: 'c 1', type: 'view', view: {} }),
    json({ object: 'list', results: [ref('v3')], has_more: false, next_cursor: null, type: 'view', view: {} }),
  ], { apiVersion: BUILDER_API_VERSION });
  const views = await r.client.listViews('db 1');
  assert.deepEqual(views.map((v) => v.id), ['v1', 'v2', 'v3']);
  assert.deepEqual(r.calls.map((c) => [c.method, c.url, c.body]), [
    ['GET', `${API_BASE}/views?database_id=db%201&page_size=100`, undefined],
    ['GET', `${API_BASE}/views?database_id=db%201&page_size=100&start_cursor=c%201`, undefined],
  ]);
  for (const c of r.calls) {
    assert.equal(c.headers['Notion-Version'], '2026-03-11');
    assert.equal(c.headers.Authorization, `Bearer ${TOKEN}`);
  }
  const none = rig([json({ object: 'list', results: [], has_more: false, next_cursor: null, type: 'view', view: {} })]);
  assert.deepEqual(await none.client.listViews('db'), []);
  await assert.rejects(() => none.client.listViews(''), (e) => e instanceof TypeError && /databaseId/.test(e.message));
  await assert.rejects(() => none.client.listViews(), TypeError);
  assert.equal(none.calls.length, 1, 'the two refused calls sent nothing');
});

test('listViews and retrieveBlockChildren: a broken cursor chain throws instead of looping or truncating', async () => {
  const noCursor = rig([json({ results: [{ id: 'a' }], has_more: true, next_cursor: null })]);
  await assert.rejects(() => noCursor.client.listViews('db'), (e) => e.code === 'BROKEN_CURSOR' && /\/views/.test(e.message));
  await assert.rejects(() => noCursor.client.retrieveBlockChildren('blk'), (e) => e.code === 'BROKEN_CURSOR' && /\/blocks\/blk\/children/.test(e.message));
  const repeat = rig([json({ results: [{ id: 'a' }], has_more: true, next_cursor: 'same' })]);
  await assert.rejects(() => repeat.client.listViews('db'), (e) => e.code === 'BROKEN_CURSOR' && /twice/.test(e.message));
  assert.ok(repeat.calls.length <= 3, 'it stops at the repeated cursor');
  const repeatBlocks = rig([json({ results: [{ id: 'a' }], has_more: true, next_cursor: 'same' })]);
  await assert.rejects(() => repeatBlocks.client.retrieveBlockChildren('blk'), (e) => e.code === 'BROKEN_CURSOR');
  assert.ok(repeatBlocks.calls.length <= 3);
});

test('retrieveBlockChildren: GET /blocks/{id}/children?page_size=100, follows the cursor, returns the flattened blocks', async () => {
  const block = (id) => ({ object: 'block', id, type: 'paragraph', has_children: false });
  const r = rig([
    json({ object: 'list', results: [block('b1'), block('b2')], has_more: true, next_cursor: 'n1', type: 'block', block: {} }),
    json({ object: 'list', results: [block('b3')], has_more: true, next_cursor: 'n 2', type: 'block', block: {} }),
    json({ object: 'list', results: [block('b4')], has_more: false, next_cursor: null, type: 'block', block: {} }),
  ]);
  const blocks = await r.client.retrieveBlockChildren('page 1');
  assert.deepEqual(blocks.map((b) => b.id), ['b1', 'b2', 'b3', 'b4']);
  assert.deepEqual(r.calls.map((c) => [c.method, c.url, c.body]), [
    ['GET', `${API_BASE}/blocks/page%201/children?page_size=100`, undefined],
    ['GET', `${API_BASE}/blocks/page%201/children?page_size=100&start_cursor=n1`, undefined],
    ['GET', `${API_BASE}/blocks/page%201/children?page_size=100&start_cursor=n%202`, undefined],
  ]);
  for (const c of r.calls) assert.equal(c.headers['Notion-Version'], '2022-06-28', 'block children keep the old version');
  const empty = rig([json({ object: 'list', results: [], has_more: false, next_cursor: null })]);
  assert.deepEqual(await empty.client.retrieveBlockChildren('b'), []);
  const flaky = rig([json({ code: 'internal_server_error', message: 'boom' }, { status: 500 }), json({ results: [block('x')], has_more: false })]);
  assert.deepEqual((await flaky.client.retrieveBlockChildren('b')).map((b) => b.id), ['x'], 'a read keeps its retries');
  assert.equal(flaky.calls.length, 2);
});

test('queryDataSource: POST /data_sources/{id}/query, an async generator that follows next_cursor; queryDataSourceAll collects it', async () => {
  const r = rig([
    json({ object: 'list', results: [{ id: 'a' }, { id: 'b' }], has_more: true, next_cursor: 'c1' }),
    json({ object: 'list', results: [{ id: 'c' }], has_more: true, next_cursor: 'c2' }),
    json({ object: 'list', results: [{ id: 'd' }], has_more: false, next_cursor: null }),
  ], { apiVersion: '2025-09-03' });
  const filter = { property: 'Readiness', select: { equals: 'Ready' } };
  const sorts = [{ timestamp: 'created_time', direction: 'ascending' }];
  const seen = [];
  for await (const p of r.client.queryDataSource('ds 1', { filter, sorts, pageSize: 2 })) seen.push(p.id);
  assert.deepEqual(seen, ['a', 'b', 'c', 'd']);
  assert.equal(r.calls.length, 3);
  assert.equal(r.calls[0].url, `${API_BASE}/data_sources/ds%201/query`);
  assert.equal(r.calls[0].method, 'POST');
  assert.equal(r.calls[0].headers['Notion-Version'], '2025-09-03');
  assert.deepEqual(r.calls[0].body, { page_size: 2, filter, sorts });
  assert.deepEqual(r.calls[1].body, { page_size: 2, filter, sorts, start_cursor: 'c1' });
  assert.equal(r.calls[2].body.start_cursor, 'c2');

  const all = rig([json({ results: [{ id: 'x' }], has_more: true, next_cursor: 'k' }), json({ results: [{ id: 'y' }], has_more: false })]);
  assert.deepEqual((await all.client.queryDataSourceAll('ds')).map((p) => p.id), ['x', 'y']);
  assert.deepEqual(all.calls[0].body, { page_size: 100 }, 'the default page size is 100 and no empty filter or sorts are sent');
  assert.equal(all.calls[1].body.start_cursor, 'k');
});

test('queryDataSource: a broken cursor chain throws; a query keeps its retries (only creates are protected)', async () => {
  const noCursor = rig([json({ results: [{ id: 'a' }], has_more: true, next_cursor: null })]);
  await assert.rejects(() => noCursor.client.queryDataSourceAll('ds'), (e) => e.code === 'BROKEN_CURSOR' && /data_sources\/ds\/query/.test(e.message));
  const repeat = rig([json({ results: [{ id: 'a' }], has_more: true, next_cursor: 'same' })]);
  await assert.rejects(() => repeat.client.queryDataSourceAll('ds'), (e) => e.code === 'BROKEN_CURSOR');
  assert.ok(repeat.calls.length <= 3);
  const boom = json({ code: 'internal_server_error', message: 'boom' }, { status: 500 });
  const flaky = rig([boom, new TypeError('reset'), json({ results: [{ id: 'a' }], has_more: false })]);
  assert.deepEqual((await flaky.client.queryDataSourceAll('ds')).map((p) => p.id), ['a']);
  assert.equal(flaky.calls.length, 3);
  assert.equal(flaky.calls[0].method, 'POST', 'a POST, but not a create');
  assert.deepEqual(flaky.sleeps, [BACKOFF_MS[0], BACKOFF_MS[1]]);
});

// ---- updateDataSource --------------------------------------------------------------------------------------------------------------

test('updateDataSource: PATCH /data_sources/{id} with only what is given; strings become rich text', async () => {
  const r = rig([json({ object: 'data_source', id: 'ds-1' })], { apiVersion: '2025-09-03' });
  const properties = { Priority: { select: { options: [{ name: 'High', color: 'red' }] } }, Old: { name: 'Renamed' } };
  await r.client.updateDataSource('ds 1', { properties, title: 'Claims', description: 'All the claims' });
  const c = r.calls[0];
  assert.equal(c.url, `${API_BASE}/data_sources/ds%201`);
  assert.equal(c.method, 'PATCH');
  assert.equal(c.headers['Notion-Version'], '2025-09-03');
  assert.deepEqual(c.body, { properties, title: text('Claims'), description: text('All the claims') });
  await r.client.updateDataSource('ds-1', { properties });
  assert.deepEqual(r.calls[1].body, { properties });
  await r.client.updateDataSource('ds-1', { title: [{ type: 'text', text: { content: 'Linked', link: { url: 'https://example.com' } } }] });
  assert.deepEqual(Object.keys(r.calls[2].body), ['title']);
  assert.equal(r.calls[2].body.title[0].text.link.url, 'https://example.com');
  await r.client.updateDataSource('ds-1', { description: 'D' });
  assert.deepEqual(r.calls[3].body, { description: text('D') });
});

test('updateDataSource refuses to drop a column (a null property config), an empty update and a bad properties value, before any request', async () => {
  const r = rig([json({ object: 'data_source', id: 'ds-1' })]);
  await assert.rejects(() => r.client.updateDataSource('ds-1', { properties: { Keep: { rich_text: {} }, Gone: null } }), (e) => e instanceof TypeError && /"Gone"/.test(e.message) && /hard rule 8/.test(e.message));
  await assert.rejects(() => r.client.updateDataSource('ds-1', {}), (e) => e instanceof TypeError && /give properties/.test(e.message));
  await assert.rejects(() => r.client.updateDataSource('ds-1'), TypeError);
  await assert.rejects(() => r.client.updateDataSource('ds-1', { properties: null }), TypeError);
  await assert.rejects(() => r.client.updateDataSource('ds-1', { properties: [{ name: 'x' }] }), TypeError);
  assert.equal(r.calls.length, 0, 'nothing was sent');
});

test('updateDataSource and updatePage keep their retries: an update can be repeated safely', async () => {
  const boom = json({ code: 'internal_server_error', message: 'boom' }, { status: 500 });
  const r = rig([boom, json({ object: 'data_source', id: 'ds' })]);
  await r.client.updateDataSource('ds', { title: 'T' });
  assert.equal(r.calls.length, 2);
  assert.deepEqual(r.sleeps, [BACKOFF_MS[0]]);
});

// ---- updateView --------------------------------------------------------------------------------------------------------------------

test('updateView: PATCH /views/{id} with only what is given (the name, a filter, sorts or a configuration), on the builder version', async () => {
  const r = rig([json({ object: 'view', id: 'v-1', name: 'Your queue (ledger)' })], { apiVersion: BUILDER_API_VERSION });
  await r.client.updateView('v 1', { name: 'Your queue (ledger)' });
  const c = r.calls[0];
  assert.equal(c.url, `${API_BASE}/views/v%201`);
  assert.equal(c.method, 'PATCH');
  assert.equal(c.headers['Notion-Version'], '2026-03-11');
  assert.deepEqual(c.body, { name: 'Your queue (ledger)' });
  const filter = { property: 'Tag outcome', select: { is_empty: true } };
  await r.client.updateView('v-1', { filter, sorts: [{ property: 'Agent confidence', direction: 'ascending' }], configuration: { type: 'table', wrap_cells: false } });
  assert.deepEqual(Object.keys(r.calls[1].body).sort(), ['configuration', 'filter', 'sorts']);
});

test('updateView refuses a null (it would clear the filter), an empty update, an empty name and a missing id, before any request', async () => {
  const r = rig([json({ object: 'view', id: 'v-1' })], { apiVersion: BUILDER_API_VERSION });
  await assert.rejects(() => r.client.updateView('v-1', { filter: null }), (e) => e instanceof TypeError && /filter is null/.test(e.message) && /hard rule 8/.test(e.message));
  await assert.rejects(() => r.client.updateView('v-1', { sorts: null }), TypeError);
  await assert.rejects(() => r.client.updateView('v-1', {}), (e) => e instanceof TypeError && /give a name/.test(e.message));
  await assert.rejects(() => r.client.updateView('v-1'), TypeError);
  await assert.rejects(() => r.client.updateView('v-1', { name: '  ' }), (e) => e instanceof TypeError && /name must be a non-empty string/.test(e.message));
  await assert.rejects(() => r.client.updateView('', { name: 'x' }), (e) => e instanceof TypeError && /viewId is required/.test(e.message));
  assert.equal(r.calls.length, 0, 'nothing was sent');
});

// ---- the request log -----------------------------------------------------------------------------------------------------------------

const readLog = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('requestLogger: one JSON line per HTTP attempt (a retry is a line of its own), the parent folders are created', async () => {
  const file = join(tmp(), 'runs', 'dry-run', 'requests.jsonl');
  const limited = json({ code: 'rate_limited', message: 'slow down' }, { status: 429, headers: { 'Retry-After': '1' } });
  const r = rig([limited, json({ object: 'page', id: 'p1' }), new TypeError('reset'), json({ object: 'page', id: 'p2' }), json({ results: [], has_more: false })], { log: requestLogger(file) });
  await r.client.retrievePage('p1');
  await r.client.retrievePage('p2');
  await r.client.queryAll('db');
  const rows = readLog(file);
  assert.equal(rows.length, 5, 'five HTTP attempts');
  assert.deepEqual(rows.map((x) => [x.method, x.path, x.status, x.attempt]), [
    ['GET', '/pages/p1', 429, 1],
    ['GET', '/pages/p1', 200, 2],
    ['GET', '/pages/p2', null, 1],
    ['GET', '/pages/p2', 200, 2],
    ['POST', '/databases/db/query', 200, 1],
  ]);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['attempt', 'method', 'path', 'status', 'ts']);
    assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(new Date(row.ts).toISOString(), row.ts);
    assert.ok(Math.abs(Date.parse(row.ts) - Date.now()) < 60000, 'the time is now');
  }
  assert.deepEqual(r.events.map((e) => e.status), rows.map((x) => x.status), 'the rig saw the same events');
  assert.equal(readFileSync(file, 'utf8').endsWith('\n'), true, 'every line ends with a newline');
});

test('requestLogger appends: a second logger on the same file continues it; it needs a file path when it is made, not when the first request is sent', () => {
  const file = join(tmp(), 'log.jsonl');
  requestLogger(file)({ method: 'GET', path: '/a', status: 200, attempt: 1 });
  requestLogger(file)({ method: 'PATCH', path: '/b', status: 200, attempt: 1 });
  assert.deepEqual(readLog(file).map((x) => x.path), ['/a', '/b']);
  assert.throws(() => requestLogger(), TypeError);
  assert.throws(() => requestLogger(''), TypeError);
  assert.throws(() => requestLogger(42), TypeError);
});

test('the token never reaches the request log or an error: not in a header, a message or a path', async () => {
  const file = join(tmp(), 'requests.jsonl');
  const r = rig([
    json({ code: 'unauthorized', message: `API token is invalid: ${TOKEN} / Bearer ${TOKEN}` }, { status: 401 }),
    new TypeError(`fetch failed for ${TOKEN}`),
    json({ object: 'page', id: 'ok' }),
  ], { log: requestLogger(file) });
  await assert.rejects(() => r.client.retrievePage('p'), (e) => !e.message.includes(TOKEN));
  await r.client.retrievePage('q');
  assert.equal(readFileSync(file, 'utf8').includes(TOKEN), false, 'the log file does not hold the token');
  assert.equal(JSON.stringify(r.events).includes(TOKEN), false);
  assert.equal(JSON.stringify(Object.entries(r.client)).includes(TOKEN), false);
});

test('a token that ends up in a path is scrubbed from the log and from the error message (the URL on the wire is the caller\'s own)', async () => {
  const file = join(tmp(), 'requests.jsonl');
  const odd = 'ntn_a/b+c=d'; // a token with characters that percent-encoding changes
  for (const token of [TOKEN, odd]) {
    const r = rig([json({ code: 'object_not_found', message: 'nope' }, { status: 404 })], { token, log: requestLogger(file) });
    await assert.rejects(
      () => r.client.retrievePage(token),
      (e) => e.code === 'object_not_found' && !e.message.includes(token) && !e.message.includes(encodeURIComponent(token)) && /GET \/pages\/\[token\]/.test(e.message),
    );
    assert.ok(r.calls[0].url.endsWith(encodeURIComponent(token)), 'the request itself is not changed');
    const net = rig([new TypeError('reset')], { token, log: requestLogger(file) });
    await assert.rejects(() => net.client.retrieveDatabase(token), (e) => e.code === 'network_error' && !e.message.includes(token) && /GET \/databases\/\[token\]/.test(e.message));
  }
  const text = readFileSync(file, 'utf8');
  assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes(odd), false);
  assert.equal(text.includes(encodeURIComponent(odd)), false);
  assert.ok(readLog(file).every((x) => x.path.endsWith('/[token]')), 'every line shows [token] where the token was');
});

// ---- countRequests -------------------------------------------------------------------------------------------------------------------

test('countRequests: the numbers of a real client run, retries counted, creates and updates told apart from queries', async () => {
  const file = join(tmp(), 'requests.jsonl');
  const limited = json({ code: 'rate_limited', message: 'slow down' }, { status: 429, headers: { 'Retry-After': '1' } });
  const r = rig([
    json({ object: 'database', id: 'db' }),
    json({ results: [], has_more: false }),
    json({ results: [], has_more: false }),
    limited,
    json({ object: 'page', id: 'p' }),
    json({ object: 'page', id: 'p' }),
    json({ object: 'page', id: 'new' }),
    json({ object: 'database', id: 'newdb' }),
    json({ object: 'view', id: 'v1' }),
  ], { log: requestLogger(file) });
  await r.client.retrieveDatabase('db'); // GET
  await r.client.queryAll('db'); // POST .../query
  await r.client.queryDataSourceAll('ds'); // POST .../query
  await r.client.retrievePage('p'); // GET 429, GET 200
  await r.client.updatePage('p', { properties: {} }); // PATCH
  await r.client.createPage({ parentDatabaseId: 'db', properties: {} }); // POST /pages
  await r.client.createDatabase({ parentPageId: 'par', title: 'T', properties: {} }); // POST /databases
  await r.client.createView({ databaseId: 'db', dataSourceId: 'ds', name: 'x' }); // POST /views
  assert.deepEqual(countRequests(file), { total: 9, byMethod: { GET: 3, POST: 5, PATCH: 1 }, writes: 4 });
});

test('countRequests: a dry run that only read has writes 0, and the count notices the first write', async () => {
  const file = join(tmp(), 'dry-run.jsonl');
  const r = rig([json({ object: 'list', id: 'x', results: [], has_more: false, next_cursor: null })], { log: requestLogger(file) });
  await r.client.retrieveDatabase('db');
  await r.client.retrievePage('p');
  await r.client.retrievePropertyItem('p', 'prop');
  await r.client.retrieveBlockChildren('b');
  await r.client.retrieveDataSource('ds');
  await r.client.retrieveView('v');
  await r.client.listViews('db');
  await r.client.queryAll('db');
  await r.client.queryDataSourceAll('ds');
  assert.deepEqual(countRequests(file), { total: 9, byMethod: { GET: 7, POST: 2, PATCH: 0 }, writes: 0 });
  await r.client.updatePage('p', { properties: {} });
  assert.deepEqual(countRequests(file), { total: 10, byMethod: { GET: 7, POST: 2, PATCH: 1 }, writes: 1 });
});

test('countRequests: every PATCH, PUT and any other non-GET is a write, and so is a POST that is not a /query or /search path', () => {
  const file = join(tmp(), 'hand-written.jsonl');
  const line = (method, path) => JSON.stringify({ ts: '2026-10-15T12:00:00.000Z', method, path, status: 200, attempt: 1 });
  writeFileSync(file, [
    line('GET', '/pages/p1'),
    line('POST', '/search'),
    line('POST', '/databases/d/query'),
    line('POST', '/data_sources/d/query?filter_properties=a'),
    line('POST', '/pages'),
    line('POST', '/views'),
    line('POST', '/databases'),
    line('POST', '/views/v1/queries'),
    line('PATCH', '/pages/p1'),
    line('PUT', '/pages/p1'),
    line('DELETE', '/blocks/b1'),
  ].join('\n') + '\n');
  assert.deepEqual(countRequests(file), { total: 11, byMethod: { GET: 1, POST: 7, PATCH: 1, PUT: 1, DELETE: 1 }, writes: 7 });
  // method names are compared in upper case, and a line without a method is not trusted
  writeFileSync(file, `${line('get', '/a')}\n${line('post', '/x/query')}\n${JSON.stringify({ path: '/y' })}\n`);
  assert.deepEqual(countRequests(file), { total: 3, byMethod: { GET: 1, POST: 1, PATCH: 0, '': 1 }, writes: 1 });
});

test('countRequests: no file is no requests; a line cut short or a line that is not JSON throws instead of passing for a proof', () => {
  const dir = tmp();
  assert.deepEqual(countRequests(join(dir, 'never-written.jsonl')), { total: 0, byMethod: { GET: 0, POST: 0, PATCH: 0 }, writes: 0 });
  const torn = join(dir, 'torn.jsonl');
  writeFileSync(torn, '{"method":"GET","path":"/a","status":200,"attempt":1}\n{"method":"PO');
  assert.throws(() => countRequests(torn), /half-written line/);
  const bad = join(dir, 'bad.jsonl');
  writeFileSync(bad, '{"method":"GET","path":"/a"}\nnot json at all\n{"method":"GET","path":"/b"}\n');
  assert.throws(() => countRequests(bad), /line 2 is not valid JSON/);
  const empty = join(dir, 'empty.jsonl');
  writeFileSync(empty, '');
  assert.equal(countRequests(empty).total, 0);
});

// ---- nothing takes anything away ------------------------------------------------------------------------------------------------------

test('the module source has no way to remove, hide or restore anything: no in_trash, no archived, no DELETE, only GET, POST and PATCH', () => {
  const source = readFileSync(MODULE, 'utf8');
  const forbidden = [
    ['in_trash', /in_trash/i],
    ['archived', /archived/i],
    ['archive', /archive/i],
    ['trash', /trash/i],
    ['the DELETE method', /DELETE/],
    ['a quoted delete method', /['"`]delete['"`]/i],
    ['a PUT call', /request\(\s*['"`]PUT/],
  ];
  for (const [what, re] of forbidden) assert.equal(re.test(source), false, `notion-rest.mjs must not contain ${what}`);
  const methods = new Set([...source.matchAll(/request\(\s*(['"`])([A-Za-z]+)\1/g)].map((m) => m[2]));
  assert.deepEqual([...methods].sort(), ['GET', 'PATCH', 'POST'], 'every call to the request function names one of the three methods');
  assert.match(source, /const SENT_METHODS = new Set\(\['GET', 'POST', 'PATCH'\]\);/, 'and the request function refuses any other method');
  // the JS operator in loadToken is the only "delete" in the file
  const deletes = [...source.matchAll(/\bdelete\b/g)].length;
  assert.equal(deletes, 2, 'only the two `delete process.env...` statements of loadToken');
});

// ---- the copy keeps what the old module did -------------------------------------------------------------------------------------------

test('copy: createPage posts a row under a database; a lost answer is create_uncertain with the old row message; a 429 is retried', async () => {
  const blocks = Array.from({ length: 230 }, (_, i) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: text(`p${i}`) } }));
  const r = rig([json({ object: 'page', id: 'new-page' }), json({ results: [] })]);
  const page = await r.client.createPage({ parentDatabaseId: 'db-1', properties: { Name: { title: [] } }, children: blocks });
  assert.equal(page.id, 'new-page');
  assert.deepEqual(r.calls[0].body.parent, { database_id: 'db-1' });
  assert.equal(r.calls[0].body.children.length, 100);
  assert.deepEqual(r.calls.map((c) => c.method), ['POST', 'PATCH', 'PATCH']);

  const lost = rig([new TypeError(`fetch failed for ${TOKEN}`), json({ object: 'page', id: 'late' })]);
  await assert.rejects(
    () => lost.client.createPage({ parentDatabaseId: 'db-1', properties: {} }),
    (e) => e instanceof NotionError && e.code === 'create_uncertain' && e.retryable === true && e.status === null && !e.message.includes(TOKEN)
      && e.message.startsWith('Notion POST /pages: no answer (network failure: fetch failed for [token]). The row may exist in Notion already, so the create was not sent again; apply.mjs --run <id> --retry reads Notion again'),
  );
  assert.equal(lost.calls.length, 1);

  const limited = rig([json({ code: 'rate_limited', message: 'slow down' }, { status: 429, headers: { 'Retry-After': '2' } }), json({ object: 'page', id: 'made' })]);
  assert.equal((await limited.client.createPage({ parentDatabaseId: 'db-1', properties: {} })).id, 'made');
  assert.deepEqual(limited.sleeps, [2000]);
});

test('copy: queries paginate, 5xx back off 0.5, 1, 2 seconds, other 4xx throw once, a broken cursor throws', async () => {
  const r = rig([
    json({ results: [{ id: 'a' }, { id: 'b' }], has_more: true, next_cursor: 'c1' }),
    json({ results: [{ id: 'c' }], has_more: false, next_cursor: null }),
  ]);
  assert.deepEqual((await r.client.queryAll('db', { filter: { property: 'X', checkbox: { equals: true } }, pageSize: 2 })).map((p) => p.id), ['a', 'b', 'c']);
  assert.equal(r.calls[0].url, `${API_BASE}/databases/db/query`);
  assert.deepEqual(r.calls[0].body, { page_size: 2, filter: { property: 'X', checkbox: { equals: true } } });
  assert.equal(r.calls[1].body.start_cursor, 'c1');

  const dead = rig([json({ code: 'service_unavailable', message: 'down' }, { status: 503 })]);
  await assert.rejects(() => dead.client.retrievePage('p'), (e) => e.status === 503 && e.code === 'service_unavailable' && e.retryable === true);
  assert.equal(dead.calls.length, MAX_SERVER_RETRIES + 1);
  assert.deepEqual(dead.sleeps, [...BACKOFF_MS]);

  const limited = rig([json({ code: 'rate_limited', message: 'slow down' }, { status: 429 })]);
  await assert.rejects(() => limited.client.retrievePage('p'), (e) => e.status === 429 && e.code === 'rate_limited' && e.retryable === true);
  assert.equal(limited.calls.length, MAX_RATE_LIMIT_RETRIES + 1);

  const bad = rig([json({ object: 'error', status: 400, code: 'validation_error', message: 'Priority is expected to be select.' }, { status: 400 })]);
  await assert.rejects(() => bad.client.updatePage('p', { properties: {} }), (e) => e.status === 400 && e.retryable === false && /PATCH \/pages\/p/.test(e.message));
  assert.equal(bad.calls.length, 1);

  const loop = rig([json({ results: [{ id: 'a' }], has_more: true, next_cursor: 'same' })]);
  await assert.rejects(() => loop.client.queryAll('db'), (e) => e.code === 'BROKEN_CURSOR');
});

test('copy: retrievePropertyItem collects a long relation; createClient insists on a token, a function fetch and a positive rate', async () => {
  const item = (id) => ({ object: 'property_item', type: 'relation', relation: { id } });
  const r = rig([
    json({ object: 'list', results: [item('a'), item('b')], has_more: true, next_cursor: 'n1', type: 'property_item' }),
    json({ object: 'list', results: [item('c')], has_more: false, next_cursor: null, type: 'property_item' }),
  ]);
  assert.deepEqual((await r.client.retrievePropertyItem('page-1', 'prop%3A1')).map((i) => i.relation.id), ['a', 'b', 'c']);
  assert.equal(r.calls[0].url, `${API_BASE}/pages/page-1/properties/prop%3A1?page_size=100`);
  assert.equal(r.calls[1].url, `${API_BASE}/pages/page-1/properties/prop%3A1?page_size=100&start_cursor=n1`);
  const single = rig([json({ object: 'property_item', type: 'number', number: 3 })]);
  assert.deepEqual(await single.client.retrievePropertyItem('p', 'n'), [{ object: 'property_item', type: 'number', number: 3 }]);
  assert.throws(() => createClient({}), /token is required/);
  assert.throws(() => createClient({ token: 'x', fetchImpl: 5 }), /fetchImpl/);
  assert.throws(() => createClient({ token: 'x', fetchImpl: () => {}, requestsPerSecond: 0 }), RangeError);
});

test('copy: pacing holds 3 requests per second on a fake clock, and one bucket serves concurrent callers', async () => {
  const r = rig([json({ ok: true })], { rps: 3 });
  for (let i = 0; i < 12; i++) await r.client.retrievePage(`p${i}`);
  assert.ok(r.clock() >= 3600 && r.clock() <= 3800, `11 gaps of 334 ms, took ${r.clock()} ms`);
  const times = r.calls.map((c) => c.at);
  for (let i = 0; i + 3 < times.length; i++) assert.ok(times[i + 3] - times[i] >= 1000);
  const shared = rig([json({ ok: true })], { rps: 2 });
  await Promise.all(Array.from({ length: 6 }, (_, i) => shared.client.retrievePage(`p${i}`)));
  assert.ok(shared.clock() >= 2400);
});

test('copy: splitRichText never cuts a surrogate pair; loadToken reads a temp .env and leaves process.env alone', () => {
  assert.deepEqual(splitRichText(''), []);
  assert.deepEqual(splitRichText(null), []);
  assert.deepEqual(splitRichText('x'.repeat(2001)).map((c) => c.text.content.length), [2000, 1]);
  const pair = '\u{1F600}';
  const chunks = splitRichText(`${'a'.repeat(1999)}${pair}`);
  assert.deepEqual(chunks.map((c) => c.text.content.length), [1999, 2], 'the pair moves whole into the next chunk');
  assert.throws(() => splitRichText('x', 1), RangeError);

  const dir = tmp();
  mkdirSync(join(dir, 'x'));
  writeFileSync(join(dir, '.env'), `# comment\nOTHER=1\nNOTION_TOKEN="${TOKEN}"\n`);
  const before = process.env.NOTION_TOKEN;
  delete process.env.NOTION_TOKEN;
  try {
    assert.equal(loadToken(dir), TOKEN);
    assert.equal(process.env.NOTION_TOKEN, undefined, 'the token is not left in the environment');
    assert.equal(process.env.OTHER, undefined);
    assert.equal(loadToken(tmp()), null, 'a folder without .env has no token');
    for (const content of ['NOTION_TOKEN=ntn_replace_me\n', 'NOTION_TOKEN=\n', 'SOMETHING_ELSE=1\n', '']) {
      writeFileSync(join(dir, '.env'), content);
      assert.equal(loadToken(dir), null, JSON.stringify(content));
    }
  } finally {
    if (before !== undefined) process.env.NOTION_TOKEN = before;
  }
});
