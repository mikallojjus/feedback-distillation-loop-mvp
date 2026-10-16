import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TOKEN, createFakeNotion } from './fixtures/fake-notion.mjs';
import { BUILDER_API_VERSION, createClient } from '../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';

const OLD = '2022-06-28';
const DS = '2025-09-03';
const VIEWS = BUILDER_API_VERSION;

/** One HTTP call to the fake: { status, body, headers }. */
async function call(fake, method, path, { body, version = OLD, token = fake.token, headers = {} } = {}) {
  const sent = { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), ...(version === null ? {} : { 'Notion-Version': version }), 'Content-Type': 'application/json', ...headers };
  const res = await fake.fetchImpl(`https://api.notion.com/v1${path}`, { method, headers: sent, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json(), headers: res.headers };
}
const get = (fake, path, o) => call(fake, 'GET', path, o);
const post = (fake, path, body, o) => call(fake, 'POST', path, { ...o, body });
const patch = (fake, path, body, o) => call(fake, 'PATCH', path, { ...o, body });

const text = (content) => [{ type: 'text', text: { content } }];
const props = {
  Claim: { type: 'title', title: {} },
  Key: { type: 'rich_text', rich_text: {} },
  Tag: { type: 'select', select: { options: [{ name: 'Context-dependent', color: 'red' }, { name: 'Wordy' }] } },
  Labels: { type: 'multi_select', multi_select: { options: [{ name: 'a' }, { name: 'b' }] } },
  Confidence: { type: 'number', number: { format: 'number' } },
  Link: { type: 'url', url: {} },
  Done: { type: 'checkbox', checkbox: {} },
  Due: { type: 'date', date: {} },
  Created: { type: 'created_time', created_time: {} },
  Edited: { type: 'last_edited_time', last_edited_time: {} },
  Number: { type: 'unique_id', unique_id: { prefix: 'RC' } },
};

/** A fake with a root page and one database of every property type the fake knows. */
function world(options) {
  const fake = createFakeNotion(options);
  const root = fake.addPage({ title: 'Root' });
  const { database_id: db, data_source_id: ds } = fake.addDatabase({ parentPageId: root, title: 'Decisions', properties: props });
  return { fake, root, db, ds };
}
const row = (n, over = {}) => ({ Claim: `Claim ${n}`, Key: `g${n}::Context-dependent`, Tag: 'Context-dependent', Confidence: n / 10, ...over });

// ---- the surface ---------------------------------------------------------------------------------------------------------------------

test('the fake exposes its token, the HTTP surface and the test helpers', () => {
  const fake = createFakeNotion();
  assert.equal(fake.token, DEFAULT_TOKEN);
  assert.equal(DEFAULT_TOKEN, 'ntn_test_token_0000');
  assert.equal(createFakeNotion({ token: 'other_token_123456' }).token, 'other_token_123456');
  assert.equal(typeof fake.fetchImpl, 'function');
  assert.deepEqual(fake.requests, []);
  assert.deepEqual(fake.writes(), []);
  for (const name of ['addDatabase', 'addPage', 'addRow', 'editRow', 'rows', 'plainRows', 'page', 'database', 'dataSource', 'children', 'views', 'failNext', 'protect', 'pendingFailures']) {
    assert.equal(typeof fake[name], 'function', name);
  }
});

test('the Authorization header must carry the fake\'s token', async () => {
  const fake = createFakeNotion();
  const ok = await get(fake, `/pages/${fake.addPage({ title: 'P' })}`);
  assert.equal(ok.status, 200);
  for (const token of [null, '', 'ntn_wrong_token_999', 'short']) {
    const r = await get(fake, '/pages/x', { token });
    assert.equal(r.status, 401, String(token));
    assert.deepEqual(r.body, { object: 'error', status: 401, code: 'unauthorized', message: 'API token is invalid.' });
  }
  const basic = await get(fake, '/pages/x', { token: null, headers: { Authorization: `Basic ${fake.token}` } });
  assert.equal(basic.status, 401);
  const lower = await get(fake, '/pages/x', { token: null, headers: { authorization: `Bearer ${fake.token}` } });
  assert.equal(lower.status, 404, 'header names are case-insensitive: this one got past the token check');
});

test('Notion-Version must be present and one the fake knows', async () => {
  const { fake, root } = world();
  const missing = await get(fake, `/pages/${root}`, { version: null });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, 'missing_version');
  assert.equal(missing.body.object, 'error');
  const unknown = await get(fake, `/pages/${root}`, { version: '2024-01-01' });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, 'validation_error');
  assert.match(unknown.body.message, /2024-01-01/);
  for (const v of ['2021-05-13', OLD, DS, VIEWS]) assert.equal((await get(fake, `/pages/${root}`, { version: v })).status, 200, v);
  const lowercase = await get(fake, `/pages/${root}`, { version: null, headers: { 'notion-version': OLD } });
  assert.equal(lowercase.status, 200, 'the header name is case-insensitive');
});

test('headers may be a plain object, a Headers instance or a list of pairs', async () => {
  const fake = createFakeNotion();
  const id = fake.addPage({ title: 'P' });
  const url = `https://api.notion.com/v1/pages/${id}`;
  for (const headers of [
    { Authorization: `Bearer ${fake.token}`, 'Notion-Version': OLD },
    new Headers({ Authorization: `Bearer ${fake.token}`, 'Notion-Version': OLD }),
    [['authorization', `Bearer ${fake.token}`], ['notion-version', OLD]],
  ]) assert.equal((await fake.fetchImpl(url, { headers })).status, 200);
});

test('unknown routes and methods are 404 invalid_request_url, a foreign host is a test bug and throws', async () => {
  const { fake, root } = world();
  for (const [method, path] of [['GET', '/users/me'], ['POST', '/search'], ['GET', '/nope'], ['DELETE', `/pages/${root}`], ['DELETE', `/blocks/${root}`], ['PUT', `/pages/${root}`], ['GET', '/pages'], ['POST', `/pages/${root}`], ['PATCH', '/databases/x']]) {
    const r = await call(fake, method, path);
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.equal(r.body.code, 'invalid_request_url', `${method} ${path}`);
  }
  await assert.rejects(() => fake.fetchImpl('https://example.com/v1/pages/x', { headers: {} }), /not an api\.notion\.com\/v1 URL/);
  await assert.rejects(() => fake.fetchImpl('https://api.notion.com/v2/pages/x', { headers: {} }), /not an api\.notion\.com\/v1 URL/);
});

test('a body that is not JSON is a 400 invalid_json', async () => {
  const { fake } = world();
  const res = await fake.fetchImpl('https://api.notion.com/v1/pages', { method: 'POST', headers: { Authorization: `Bearer ${fake.token}`, 'Notion-Version': OLD }, body: '{ nope' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'invalid_json');
});

test('requests records method, path with query, status, body and version; writes() leaves out GET and the query POSTs', async () => {
  const { fake, root, db, ds } = world();
  await get(fake, `/pages/${root}`);
  await post(fake, `/databases/${db}/query`, { page_size: 10 });
  await post(fake, `/data_sources/${ds}/query`, {}, { version: DS });
  await get(fake, `/blocks/${root}/children?page_size=5`);
  const created = await post(fake, '/pages', { parent: { database_id: db }, properties: { Claim: { title: text('A') } } });
  await patch(fake, `/pages/${created.body.id}`, { properties: { Claim: { title: text('B') } } });
  await patch(fake, `/blocks/${root}/children`, { children: [{ type: 'paragraph', paragraph: { rich_text: text('x') } }] });
  await get(fake, '/pages/x', { token: 'wrong_token_000000' });
  assert.deepEqual(fake.requests.map((r) => [r.method, r.status]), [
    ['GET', 200], ['POST', 200], ['POST', 200], ['GET', 200], ['POST', 200], ['PATCH', 200], ['PATCH', 200], ['GET', 401],
  ]);
  assert.equal(fake.requests[0].path, `/pages/${root}`);
  assert.equal(fake.requests[3].path, `/blocks/${root}/children?page_size=5`);
  assert.deepEqual(fake.requests[1].body, { page_size: 10 });
  assert.equal(fake.requests[0].body, null);
  assert.equal(fake.requests[2].version, DS);
  assert.equal(fake.requests[1].version, OLD);
  assert.deepEqual(fake.writes().map((r) => [r.method, r.path.split('/')[1]]), [['POST', 'pages'], ['PATCH', 'pages'], ['PATCH', 'blocks']]);
  await post(fake, '/pages', { parent: { database_id: 'nope' }, properties: {} });
  await post(fake, '/pages', {}, { token: 'wrong_token_000000' });
  assert.equal(fake.writes().length, 5, 'failed and refused writes are still writes: they were attempts');
});

test('the helpers log nothing', () => {
  const { fake, db } = world();
  fake.addRow(db, row(1));
  fake.addPage({ title: 'X' });
  fake.rows(db);
  fake.plainRows(db);
  assert.deepEqual(fake.requests, []);
});

// ---- ids, pages and databases ------------------------------------------------------------------------------------------------------

test('ids come out dashed (8-4-4-4-12), and the same page answers to any spelling of its id', async () => {
  const { fake, root, db, ds } = world();
  for (const id of [root, db, ds]) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(new Set([root, db, ds]).size, 3);
  for (const spelling of [root, root.replace(/-/g, ''), root.toUpperCase()]) {
    const r = await get(fake, `/pages/${spelling}`);
    assert.equal(r.status, 200, spelling);
    assert.equal(r.body.id, root);
  }
});

test('addDatabase takes the ids you give it, in any spelling, and answers with the dashed form', () => {
  const fake = createFakeNotion();
  const made = fake.addDatabase({ id: '7219756338b2416f8fa8af83d75ec47d', dataSourceId: 'D1307596-E531-420F-8688-2485F3EF28AB', title: 'Fixed ids', properties: { Name: { type: 'title', title: {} } } });
  assert.deepEqual(made, { database_id: '72197563-38b2-416f-8fa8-af83d75ec47d', data_source_id: 'd1307596-e531-420f-8688-2485f3ef28ab' });
  assert.equal(fake.database('7219756338b2416f8fa8af83d75ec47d').id, made.database_id);
  assert.equal(fake.dataSource(made.data_source_id).id, made.data_source_id);
  assert.equal(fake.dataSource(made.database_id).id, made.data_source_id, 'a database id finds its data source');
});

test('addDatabase and addPage check what they are given', () => {
  const fake = createFakeNotion();
  assert.throws(() => fake.addDatabase({ title: 'No properties' }), /properties should be an object/);
  assert.throws(() => fake.addDatabase({ title: 'No title column', properties: { A: { type: 'rich_text', rich_text: {} } } }), /needs exactly one title property, found 0/);
  assert.throws(() => fake.addDatabase({ title: 'Two', properties: { A: { type: 'title', title: {} }, B: { type: 'title', title: {} } } }), /found 2/);
  assert.throws(() => fake.addDatabase({ title: 'Odd', properties: { A: { type: 'title', title: {} }, B: { type: 'formula', formula: {} } } }), /not supported by this fake/);
  assert.throws(() => fake.addDatabase({ title: 'Bad option', properties: { A: { type: 'title', title: {} }, B: { type: 'select', select: { options: [{ name: 'a,b' }] } } } }), /cannot contain commas/);
  const page = fake.addPage({ parentPageId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', title: 'Child' });
  assert.deepEqual(fake.page(page).parent, { type: 'page_id', page_id: 'a1b2c3d4-e5f6-0718-293a-4b5c6d7e8f90' }, 'the parent need not exist when seeding');
  assert.equal(fake.page(fake.addPage({ title: 'Top' })).parent.type, 'workspace');
});

test('GET /pages/{id} returns the page object with its properties in REST shape', async () => {
  const { fake, root, db, ds } = world();
  const id = fake.addRow(db, { ...row(1), Labels: ['a', 'b'], Link: 'https://example.com', Done: true, Due: '2026-10-16' });
  const r = await get(fake, `/pages/${id}`);
  assert.equal(r.status, 200);
  const p = r.body;
  assert.equal(p.object, 'page');
  assert.equal(p.id, id);
  assert.equal(p.url, `https://www.notion.so/${id.replace(/-/g, '')}`);
  assert.deepEqual(p.parent, { type: 'database_id', database_id: db });
  assert.equal(p.archived, false);
  assert.equal(p.in_trash, false);
  assert.match(p.created_time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(p.last_edited_time >= p.created_time);
  assert.deepEqual(Object.keys(p.properties), Object.keys(props), 'in schema order');
  assert.equal(p.properties.Claim.type, 'title');
  assert.equal(p.properties.Claim.title[0].plain_text, 'Claim 1');
  assert.equal(p.properties.Claim.title[0].text.content, 'Claim 1');
  assert.deepEqual(p.properties.Claim.title[0].annotations, { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' });
  assert.equal(p.properties.Claim.id, 'title');
  assert.equal(p.properties.Tag.select.name, 'Context-dependent');
  assert.equal(p.properties.Tag.select.color, 'red');
  assert.deepEqual(p.properties.Labels.multi_select.map((o) => o.name), ['a', 'b']);
  assert.equal(p.properties.Confidence.number, 0.1);
  assert.equal(p.properties.Link.url, 'https://example.com');
  assert.equal(p.properties.Done.checkbox, true);
  assert.deepEqual(p.properties.Due.date, { start: '2026-10-16', end: null, time_zone: null });
  assert.equal(p.properties.Created.created_time, p.created_time);
  assert.equal(p.properties.Edited.last_edited_time, p.last_edited_time);
  assert.deepEqual(p.properties.Number.unique_id, { prefix: 'RC', number: 1 });
  assert.equal(new Set(Object.values(p.properties).map((v) => v.id)).size, 11, 'every property has its own id');
  const newer = await get(fake, `/pages/${id}`, { version: DS });
  assert.deepEqual(newer.body.parent, { type: 'data_source_id', data_source_id: ds, database_id: db }, 'the newer versions name the data source');
  const child = await get(fake, `/pages/${root}`);
  assert.deepEqual(child.body.parent, { type: 'workspace', workspace: true });
  assert.equal(child.body.properties.title.title[0].plain_text, 'Root');
});

test('unknown ids are 404 object_not_found, and an id of the wrong kind is a 400 that says so', async () => {
  const { fake, root, db, ds } = world();
  const missing = await get(fake, '/pages/0a9e0000-0000-4000-8000-ffffffffffff');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, 'object_not_found');
  assert.match(missing.body.message, /Could not find page with ID: 0a9e0000-0000-4000-8000-ffffffffffff/);
  assert.equal((await get(fake, '/databases/nope')).status, 404);
  assert.equal((await get(fake, '/data_sources/nope', { version: DS })).status, 404);
  assert.equal((await get(fake, '/blocks/nope/children')).status, 404);
  assert.equal((await get(fake, '/views/nope', { version: VIEWS })).status, 404);
  const dbAsPage = await get(fake, `/pages/${db}`);
  assert.equal(dbAsPage.status, 400);
  assert.match(dbAsPage.body.message, /is a database, not a page/);
  assert.match((await get(fake, `/databases/${root}`)).body.message, /is a page, not a database/);
  assert.match((await get(fake, `/databases/${ds}`)).body.message, /is a data source, not a database/);
  assert.match((await get(fake, `/data_sources/${db}`, { version: DS })).body.message, /is a database, not a data source/);
});

test('GET /databases/{id}: properties for the old versions, the data source list for all, never anything under a protected id', async () => {
  const { fake, root, db, ds } = world();
  const old = (await get(fake, `/databases/${db}`)).body;
  assert.equal(old.object, 'database');
  assert.equal(old.id, db);
  assert.equal(old.title[0].plain_text, 'Decisions');
  assert.deepEqual(old.parent, { type: 'page_id', page_id: root });
  assert.deepEqual(old.data_sources, [{ id: ds, name: 'Decisions' }]);
  assert.deepEqual(Object.keys(old.properties), Object.keys(props));
  assert.equal(old.properties.Tag.type, 'select');
  assert.deepEqual(old.properties.Tag.select.options.map((o) => [o.name, o.color]), [['Context-dependent', 'red'], ['Wordy', 'default']]);
  assert.ok(old.properties.Tag.select.options.every((o) => typeof o.id === 'string' && o.id !== ''));
  assert.deepEqual(old.properties.Number.unique_id, { prefix: 'RC' });
  assert.equal(old.properties.Claim.id, 'title');
  const newer = (await get(fake, `/databases/${db}`, { version: DS })).body;
  assert.equal(newer.properties, undefined, 'from 2025-09-03 the columns belong to the data source');
  assert.deepEqual(newer.data_sources, [{ id: ds, name: 'Decisions' }]);
  assert.deepEqual(fake.database(db).properties, old.properties, 'the helper always shows the columns');
});

test('GET /data_sources/{id} needs 2025-09-03 and carries the columns', async () => {
  const { fake, db, ds } = world();
  const tooOld = await get(fake, `/data_sources/${ds}`);
  assert.equal(tooOld.status, 400);
  assert.match(tooOld.body.message, /needs Notion-Version 2025-09-03 or later/);
  const r = await get(fake, `/data_sources/${ds}`, { version: DS });
  assert.equal(r.status, 200);
  assert.equal(r.body.object, 'data_source');
  assert.equal(r.body.id, ds);
  assert.deepEqual(r.body.parent, { type: 'database_id', database_id: db });
  assert.deepEqual(Object.keys(r.body.properties), Object.keys(props));
  assert.equal(r.body.title[0].plain_text, 'Decisions');
});

// ---- addRow, editRow and the plain readers -------------------------------------------------------------------------------------------

test('addRow encodes plain values by the schema, and plainRows reads them back', () => {
  const { fake, db } = world();
  const a = fake.addRow(db, { ...row(1), Labels: ['b', 'a'], Link: 'https://example.com/a', Done: true, Due: '2026-10-16' });
  const b = fake.addRow(db, { Claim: 'Only a title' });
  const rows = fake.plainRows(db);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    page_id: a, Claim: 'Claim 1', Key: 'g1::Context-dependent', Tag: 'Context-dependent', Labels: ['b', 'a'], Confidence: 0.1, Link: 'https://example.com/a', Done: true,
    Due: '2026-10-16', Created: rows[0].Created, Edited: rows[0].Edited, Number: 'RC-1',
  });
  assert.match(rows[0].Created, /^2026-10-15T/);
  assert.deepEqual(rows[1], {
    page_id: b, Claim: 'Only a title', Key: '', Tag: null, Labels: [], Confidence: null, Link: null, Done: false, Due: null, Created: rows[1].Created, Edited: rows[1].Edited, Number: 'RC-2',
  });
  assert.equal(fake.rows(db).length, 2);
  assert.equal(fake.rows(db)[0].object, 'page');
  assert.deepEqual(fake.rows(db)[0], fake.page(a));
});

test('addRow: dates with an end, a relation between two tables, and the data source id works as well as the database id', () => {
  const fake = createFakeNotion();
  const { database_id: otherDb, data_source_id: other } = fake.addDatabase({ title: 'Other', properties: { Name: { type: 'title', title: {} } } });
  const target = fake.addRow(other, { Name: 'Target' });
  const { database_id: db, data_source_id: ds } = fake.addDatabase({
    title: 'Linked', properties: { Name: { type: 'title', title: {} }, Span: { type: 'date', date: {} }, Link: { type: 'relation', relation: { data_source_id: other, single_property: {} } } },
  });
  fake.addRow(ds, { Name: 'x', Span: { start: '2026-10-01', end: '2026-10-05' }, Link: [target] });
  assert.deepEqual(fake.plainRows(db)[0], { page_id: fake.plainRows(ds)[0].page_id, Name: 'x', Span: '2026-10-01', 'Span:end': '2026-10-05', Link: [target] });
  assert.deepEqual(fake.database(db).properties.Link.relation, { database_id: fake.database(otherDb).id, data_source_id: other, type: 'single_property', single_property: {} });
});

test('addRow refuses names that are not columns, columns that Notion fills in, and relations to pages that do not exist', () => {
  const { fake, db } = world();
  assert.throws(() => fake.addRow(db, { Nope: 'x' }), /has no property "Nope"/);
  assert.throws(() => fake.addRow(db, { Created: '2026-10-16T00:00:00Z' }), /created_time property and cannot be set/);
  assert.throws(() => fake.addRow(db, { Number: 5 }), /unique_id property and cannot be set/);
  assert.throws(() => fake.addRow('nope', {}), /there is no database nope/);
  assert.throws(() => fake.addRow(db, { Confidence: 'high' }), /number should be a number or null/);
  assert.throws(() => fake.addRow(db, { Due: 'next week' }), /ISO 8601/);
  assert.throws(() => fake.addRow(db, { Labels: ['a,b'] }), /cannot contain commas/);
});

test('a select value that is not an option yet creates the option, and createdOptions says so', () => {
  const { fake, db } = world();
  assert.deepEqual(fake.createdOptions, []);
  fake.addRow(db, row(1));
  assert.deepEqual(fake.createdOptions, [], 'an existing option is not a new one');
  fake.addRow(db, row(2, { Tag: 'Brand new' }));
  fake.addRow(db, row(3, { Tag: 'Brand new' }));
  assert.deepEqual(fake.createdOptions, ['Decisions.Tag=Brand new']);
  assert.deepEqual(fake.database(db).properties.Tag.select.options.map((o) => o.name), ['Context-dependent', 'Wordy', 'Brand new']);
  assert.notDeepEqual(fake.createdOptions, fake.createdOptions.concat('x'), 'a copy is returned');
});

test('a request that creates a select option and then fails leaves no option behind', async () => {
  const { fake, db } = world();
  const id = fake.addRow(db, row(1));
  const optionsBefore = fake.database(db).properties.Tag.select.options.map((o) => o.name);
  const failed = await patch(fake, `/pages/${id}`, { properties: { Tag: { select: { name: 'Never created' } }, Confidence: { number: 'high' } } });
  assert.equal(failed.status, 400);
  assert.deepEqual(fake.database(db).properties.Tag.select.options.map((o) => o.name), optionsBefore);
  assert.deepEqual(fake.createdOptions, []);
  const created = await post(fake, '/pages', { parent: { database_id: db }, properties: { Labels: { multi_select: [{ name: 'fresh' }] }, Nope: { rich_text: [] } } });
  assert.equal(created.status, 400);
  assert.deepEqual(fake.createdOptions, []);
  const ok = await patch(fake, `/pages/${id}`, { properties: { Tag: { select: { name: 'Created now' } } } });
  assert.equal(ok.status, 200);
  assert.deepEqual(fake.createdOptions, ['Decisions.Tag=Created now']);
});

test('editRow is an editor\'s change: values change, last_edited_by is the editor, nothing is logged', async () => {
  const { fake, db } = world();
  const id = fake.addRow(db, row(1));
  const before = fake.page(id);
  assert.equal(before.last_edited_by.object, 'user');
  assert.equal(before.created_by.id, before.last_edited_by.id, 'the bot made it and last edited it');
  fake.editRow(id, { Tag: 'Wordy', Key: 'edited' });
  const after = fake.page(id);
  assert.equal(after.properties.Tag.select.name, 'Wordy');
  assert.equal(after.properties.Key.rich_text[0].plain_text, 'edited');
  assert.equal(after.properties.Claim.title[0].plain_text, 'Claim 1', 'other columns stay');
  assert.ok(after.last_edited_time > before.last_edited_time);
  assert.notEqual(after.last_edited_by.id, before.last_edited_by.id);
  assert.equal(after.created_by.id, before.created_by.id);
  assert.deepEqual(fake.requests, []);
  assert.throws(() => fake.editRow(id, { Nope: 1 }), /has no property "Nope"/);
  assert.throws(() => fake.editRow('nope', {}), /there is no row nope/);
  const api = await patch(fake, `/pages/${id}`, { properties: { Key: { rich_text: text('by the bot') } } });
  assert.equal(api.body.last_edited_by.id, before.last_edited_by.id, 'a write through the API is the bot again');
});

test('timestamps move forward with every change, and can be set by the test', async () => {
  const { fake, db } = world();
  const id = fake.addRow(db, row(1));
  const t0 = fake.page(id).last_edited_time;
  const r = await patch(fake, `/pages/${id}`, { properties: { Done: { checkbox: true } } });
  assert.ok(r.body.last_edited_time > t0);
  assert.equal(r.body.created_time, fake.page(id).created_time);
  const fixed = createFakeNotion({ now: () => new Date('2030-01-02T03:04:05.678Z') });
  const { database_id } = fixed.addDatabase({ title: 'T', properties: { Name: { type: 'title', title: {} } } });
  assert.equal(fixed.page(fixed.addRow(database_id, { Name: 'x' })).created_time, '2030-01-02T03:04:05.678Z');
});

// ---- POST /pages ---------------------------------------------------------------------------------------------------------------------

test('POST /pages creates a row under a database id or a data source id, by property name or property id', async () => {
  const { fake, db, ds } = world();
  const byDb = await post(fake, '/pages', { parent: { database_id: db }, properties: { Claim: { title: text('Via database') }, Tag: { select: { name: 'Wordy' } } } });
  assert.equal(byDb.status, 200);
  assert.equal(byDb.body.object, 'page');
  assert.deepEqual(byDb.body.parent, { type: 'database_id', database_id: db });
  assert.equal(byDb.body.properties.Tag.select.name, 'Wordy');
  const byDs = await post(fake, '/pages', { parent: { type: 'data_source_id', data_source_id: ds }, properties: { Claim: { title: text('Via data source') } } }, { version: DS });
  assert.equal(byDs.status, 200);
  assert.equal(byDs.body.parent.data_source_id, ds);
  const keyId = fake.database(db).properties.Key.id;
  const byId = await post(fake, '/pages', { parent: { database_id: db }, properties: { title: { title: text('Via ids') }, [keyId]: { rich_text: text('k1') } } });
  assert.equal(byId.status, 200);
  assert.equal(byId.body.properties.Key.rich_text[0].plain_text, 'k1', 'a property id works as the key, and so does the title property\'s id');
  assert.deepEqual(fake.plainRows(db).map((r) => r.Claim), ['Via database', 'Via data source', 'Via ids']);
  assert.deepEqual(fake.plainRows(db).map((r) => r.Number), ['RC-1', 'RC-2', 'RC-3'], 'unique ids count up');
});

test('POST /pages checks every value against its property type and creates nothing when one is wrong', async () => {
  const { fake, db } = world();
  const bad = async (properties, status, pattern) => {
    const r = await post(fake, '/pages', { parent: { database_id: db }, properties });
    assert.equal(r.status, status, JSON.stringify(properties));
    assert.equal(r.body.code, 'validation_error');
    assert.match(r.body.message, pattern, JSON.stringify(properties));
  };
  await bad({ Nope: { rich_text: text('x') } }, 400, /Nope is not a property that exists/);
  await bad({ Tag: { rich_text: text('x') } }, 400, /body\.properties\.Tag should hold a select value, found rich_text/);
  await bad({ Key: { select: { name: 'x' } } }, 400, /Key should hold a rich_text value/);
  await bad({ Confidence: { number: 'high' } }, 400, /number should be a number or null/);
  await bad({ Done: { checkbox: 'yes' } }, 400, /checkbox should be a boolean/);
  await bad({ Due: { date: { start: 'tomorrow' } } }, 400, /ISO 8601/);
  await bad({ Labels: { multi_select: { name: 'a' } } }, 400, /multi_select should be an array/);
  await bad({ Labels: { multi_select: [{ id: 'no-such-option' }] } }, 400, /is not an option of Labels/);
  await bad({ Tag: { select: { name: 'a,b' } } }, 400, /cannot contain commas/);
  await bad({ Created: { created_time: '2026-10-16T00:00:00Z' } }, 400, /created_time property cannot be set/);
  await bad({ Number: { unique_id: { number: 9 } } }, 400, /unique_id property cannot be set/);
  await bad({ Key: { rich_text: 'plain string' } }, 400, /rich_text should be an array/);
  await bad({ Key: { type: 'select', rich_text: text('x') } }, 400, /type should be "rich_text", instead was "select"/);
  await bad({ Key: { rich_text: text('x'), select: null } }, 400, /select should not be present/);
  await bad({ Key: 'x' }, 400, /should be an object/);
  await bad({ Claim: { title: text('good') }, Confidence: { number: 'bad' } }, 400, /number should be a number/);
  assert.deepEqual(fake.rows(db), [], 'no row was made by any of those');
});

test('POST /pages: text objects hold 2,000 characters, no more', async () => {
  const { fake, db } = world();
  const exact = await post(fake, '/pages', { parent: { database_id: db }, properties: { Claim: { title: text('x'.repeat(2000)) }, Key: { rich_text: text('y'.repeat(2000)) } } });
  assert.equal(exact.status, 200);
  const long = await post(fake, '/pages', { parent: { database_id: db }, properties: { Claim: { title: text('x'.repeat(2001)) } } });
  assert.equal(long.status, 400);
  assert.match(long.body.message, /body\.properties\.Claim\.title\[0\]\.text\.content\.length should be ≤ `2000`, instead was `2001`/);
  const split = await post(fake, '/pages', { parent: { database_id: db }, properties: { Key: { rich_text: [...text('a'.repeat(2000)), ...text('b'.repeat(500))] } } });
  assert.equal(split.status, 200);
  assert.equal(split.body.properties.Key.rich_text.length, 2);
  const many = await post(fake, '/pages', { parent: { database_id: db }, properties: { Key: { rich_text: Array.from({ length: 101 }, () => text('x')[0]) } } });
  assert.equal(many.status, 400);
  assert.match(many.body.message, /rich_text\.length should be ≤ `100`/);
  assert.equal(fake.rows(db).length, 2);
});

test('POST /pages: body.parent and body.properties are required, and the parent must exist', async () => {
  const { fake, db } = world();
  assert.match((await post(fake, '/pages', { properties: {} })).body.message, /body\.parent should be defined/);
  assert.match((await post(fake, '/pages', { parent: { database_id: db } })).body.message, /body\.properties should be defined/);
  assert.match((await post(fake, '/pages', { parent: { workspace: true }, properties: {} })).body.message, /database_id, a data_source_id or a page_id/);
  assert.equal((await post(fake, '/pages', { parent: { database_id: 'nope' }, properties: {} })).status, 404);
  assert.equal((await post(fake, '/pages', { parent: { data_source_id: 'nope' }, properties: {} }, { version: DS })).status, 404);
  assert.equal((await post(fake, '/pages', { parent: { page_id: 'nope' }, properties: { title: { title: [] } } })).status, 404);
  assert.match((await post(fake, '/pages', { parent: { database_id: fake.dataSource(db).id }, properties: {} })).body.message, /is a data source, not a database/);
});

test('POST /pages with a page parent makes a child page whose only property is its title', async () => {
  const { fake, root } = world();
  const r = await post(fake, '/pages', { parent: { page_id: root }, properties: { title: { title: text('Practice page') } }, icon: { type: 'emoji', emoji: '📘' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.parent, { type: 'page_id', page_id: root });
  assert.deepEqual(Object.keys(r.body.properties), ['title']);
  assert.equal(r.body.properties.title.title[0].plain_text, 'Practice page');
  assert.deepEqual(r.body.icon, { type: 'emoji', emoji: '📘' });
  assert.match((await post(fake, '/pages', { parent: { page_id: root }, properties: { Name: { title: text('x') } } })).body.message, /takes one property, "title"/);
  assert.equal((await post(fake, '/pages', { parent: { page_id: root }, properties: { title: { rich_text: text('x') } } })).status, 400);
  const patched = await patch(fake, `/pages/${r.body.id}`, { properties: { title: { title: text('Renamed') } } });
  assert.equal(patched.body.properties.title.title[0].plain_text, 'Renamed');
  assert.match((await patch(fake, `/pages/${r.body.id}`, { properties: { Other: { title: text('x') } } })).body.message, /Other is not a property that exists/);
});

test('POST /pages stores its children, which GET /blocks/{id}/children returns in order', async () => {
  const { fake, db } = world();
  const children = [
    { object: 'block', type: 'paragraph', paragraph: { rich_text: text('First') } },
    { type: 'heading_2', heading_2: { rich_text: text('Second') } },
    { type: 'divider', divider: {} },
  ];
  const r = await post(fake, '/pages', { parent: { database_id: db }, properties: { Claim: { title: text('With body') } }, children });
  assert.equal(r.status, 200);
  const got = await get(fake, `/blocks/${r.body.id}/children`);
  assert.equal(got.status, 200);
  assert.equal(got.body.object, 'list');
  assert.deepEqual(got.body.results.map((b) => b.type), ['paragraph', 'heading_2', 'divider']);
  assert.equal(got.body.results[0].paragraph.rich_text[0].plain_text, 'First');
  assert.equal(got.body.results[0].object, 'block');
  assert.deepEqual(got.body.results[0].parent, { type: 'page_id', page_id: r.body.id });
  assert.equal(got.body.results[0].has_children, false);
  assert.equal(got.body.has_more, false);
  assert.deepEqual(fake.children(r.body.id).map((b) => b.type), ['paragraph', 'heading_2', 'divider']);
  const bad = await post(fake, '/pages', { parent: { database_id: db }, properties: { Claim: { title: text('Bad body') } }, children: [{ type: 'paragraph', paragraph: { rich_text: text('x'.repeat(2001)) } }] });
  assert.equal(bad.status, 400);
  assert.equal(fake.rows(db).length, 1, 'a page whose body is refused is not created');
  const many = await post(fake, '/pages', { parent: { database_id: db }, properties: {}, children: Array.from({ length: 101 }, () => children[2]) });
  assert.match(many.body.message, /body\.children\.length should be ≤ `100`, instead was `101`/);
});

// ---- PATCH /pages ---------------------------------------------------------------------------------------------------------------------

test('PATCH /pages/{id} changes the named properties and leaves the others', async () => {
  const { fake, db } = world();
  const id = fake.addRow(db, { ...row(1), Labels: ['a'] });
  const r = await patch(fake, `/pages/${id}`, { properties: { Tag: { select: { name: 'Wordy' } }, Confidence: { number: 0.9 }, Done: { checkbox: true } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.properties.Tag.select.name, 'Wordy');
  assert.equal(r.body.properties.Confidence.number, 0.9);
  assert.equal(r.body.properties.Done.checkbox, true);
  assert.equal(r.body.properties.Claim.title[0].plain_text, 'Claim 1');
  assert.deepEqual(r.body.properties.Labels.multi_select.map((o) => o.name), ['a']);
  const cleared = await patch(fake, `/pages/${id}`, { properties: { Tag: { select: null }, Link: { url: null }, Labels: { multi_select: [] }, Key: { rich_text: [] } } });
  assert.equal(cleared.body.properties.Tag.select, null);
  assert.deepEqual(cleared.body.properties.Labels.multi_select, []);
  assert.deepEqual(cleared.body.properties.Key.rich_text, []);
  assert.equal(fake.plainRows(db)[0].Key, '');
});

test('PATCH /pages/{id} with a property that does not exist is a 400 validation_error and changes nothing', async () => {
  const { fake, db } = world();
  const id = fake.addRow(db, row(1));
  const before = fake.page(id);
  const r = await patch(fake, `/pages/${id}`, { properties: { Confidence: { number: 5 }, Nope: { rich_text: text('x') } } });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'validation_error');
  assert.match(r.body.message, /Nope is not a property that exists/);
  assert.deepEqual(fake.page(id), before, 'not even the good property of the same request was applied');
  assert.equal((await patch(fake, '/pages/0a9e0000-0000-4000-8000-ffffffffffff', { properties: {} })).status, 404);
});

test('nothing is ever archived or trashed through the fake', async () => {
  const { fake, db } = world();
  const id = fake.addRow(db, row(1));
  for (const body of [{ archived: true }, { in_trash: true }, { archived: true, properties: {} }]) {
    const r = await patch(fake, `/pages/${id}`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.message, /never archives or deletes anything/);
  }
  assert.equal((await patch(fake, `/pages/${id}`, { archived: false, in_trash: false })).status, 200);
  assert.equal((await call(fake, 'DELETE', `/blocks/${id}`)).status, 404);
  assert.equal(fake.page(id).archived, false);
  assert.equal(fake.rows(db).length, 1);
});

// ---- queries ---------------------------------------------------------------------------------------------------------------------------

test('a query pages with start_cursor as an offset and page_size, in creation order', async () => {
  const { fake, db } = world();
  for (let n = 1; n <= 5; n++) fake.addRow(db, row(n));
  const seen = [];
  let cursor;
  const pageSizes = [];
  do {
    const r = await post(fake, `/databases/${db}/query`, { page_size: 2, ...(cursor ? { start_cursor: cursor } : {}) });
    assert.equal(r.status, 200);
    assert.equal(r.body.object, 'list');
    pageSizes.push(r.body.results.length);
    seen.push(...r.body.results.map((p) => p.properties.Claim.title[0].plain_text));
    assert.equal(r.body.has_more, r.body.next_cursor !== null);
    cursor = r.body.next_cursor;
  } while (cursor);
  assert.deepEqual(seen, ['Claim 1', 'Claim 2', 'Claim 3', 'Claim 4', 'Claim 5']);
  assert.deepEqual(pageSizes, [2, 2, 1]);
  const all = await post(fake, `/databases/${db}/query`, {});
  assert.equal(all.body.results.length, 5);
  assert.equal(all.body.has_more, false);
  assert.equal(all.body.next_cursor, null);
  const empty = await post(fake, `/databases/${db}/query`, { start_cursor: '5' });
  assert.deepEqual(empty.body.results, []);
  assert.equal(empty.body.has_more, false);
});

test('a query refuses a page_size outside 1 to 100 and a cursor it did not hand out', async () => {
  const { fake, db } = world();
  fake.addRow(db, row(1));
  for (const body of [{ page_size: 0 }, { page_size: 101 }, { page_size: 'x' }, { page_size: 1.5 }, { start_cursor: 'abc' }, { start_cursor: '-1' }, { start_cursor: '99' }]) {
    const r = await post(fake, `/databases/${db}/query`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, 'validation_error');
  }
  assert.equal((await post(fake, `/databases/${db}/query`, { page_size: 100 })).status, 200);
});

test('queries by database id and by data source id return the same rows; the data source route needs 2025-09-03; filter_properties is ignored', async () => {
  const { fake, db, ds } = world();
  fake.addRow(db, row(1));
  fake.addRow(db, row(2));
  const a = await post(fake, `/databases/${db}/query?filter_properties=title&filter_properties=abc`, {});
  const b = await post(fake, `/data_sources/${ds}/query`, {}, { version: DS });
  assert.equal(a.body.results.length, 2);
  assert.equal(a.body.type, 'page_or_database');
  assert.deepEqual(a.body.page_or_database, {});
  assert.equal(b.body.type, 'page_or_data_source');
  assert.deepEqual(b.body.page_or_data_source, {});
  assert.ok(a.body.results.every((p) => Object.keys(p.properties).length === Object.keys(props).length), 'all columns come back');
  assert.deepEqual(b.body.results.map((p) => p.id), a.body.results.map((p) => p.id));
  assert.equal((await post(fake, `/data_sources/${ds}/query`, {})).status, 400);
  assert.match((await post(fake, `/databases/${ds}/query`, {})).body.message, /is a data source, not a database/);
  assert.match((await post(fake, `/data_sources/${db}/query`, {}, { version: DS })).body.message, /is a database, not a data source/);
});

test('query filters: text, select, multi_select, number, checkbox, date, and/or, is_empty', async () => {
  const { fake, db } = world();
  fake.addRow(db, { Claim: 'Apple pie', Key: 'k1', Tag: 'Wordy', Labels: ['a'], Confidence: 0.2, Done: true, Due: '2026-10-10' });
  fake.addRow(db, { Claim: 'Banana split', Key: 'k2', Tag: 'Context-dependent', Labels: ['a', 'b'], Confidence: 0.5, Done: false, Due: '2026-10-20' });
  fake.addRow(db, { Claim: 'Cherry tart', Tag: null, Labels: [], Confidence: null, Done: false });
  const names = async (filter, sorts) => (await post(fake, `/databases/${db}/query`, { filter, ...(sorts ? { sorts } : {}) })).body.results.map((p) => p.properties.Claim.title[0].plain_text);
  assert.deepEqual(await names({ property: 'Claim', title: { contains: 'an' } }), ['Banana split']);
  assert.deepEqual(await names({ property: 'Claim', title: { contains: 'PIE' } }), ['Apple pie'], 'contains ignores case');
  assert.deepEqual(await names({ property: 'Claim', title: { equals: 'apple pie' } }), [], 'equals does not');
  assert.deepEqual(await names({ property: 'Claim', title: { starts_with: 'Cher' } }), ['Cherry tart']);
  assert.deepEqual(await names({ property: 'Claim', title: { ends_with: 'split' } }), ['Banana split']);
  assert.deepEqual(await names({ property: 'Key', rich_text: { is_empty: true } }), ['Cherry tart']);
  assert.deepEqual(await names({ property: 'Key', rich_text: { is_not_empty: true } }), ['Apple pie', 'Banana split']);
  assert.deepEqual(await names({ property: 'Key', rich_text: { equals: 'k2' } }), ['Banana split']);
  assert.deepEqual(await names({ property: 'Tag', select: { equals: 'Wordy' } }), ['Apple pie']);
  assert.deepEqual(await names({ property: 'Tag', select: { does_not_equal: 'Wordy' } }), ['Banana split', 'Cherry tart']);
  assert.deepEqual(await names({ property: 'Tag', select: { is_empty: true } }), ['Cherry tart']);
  assert.deepEqual(await names({ property: 'Tag', select: { equals: ['Wordy', 'Context-dependent'] } }), ['Apple pie', 'Banana split']);
  assert.deepEqual(await names({ property: 'Labels', multi_select: { contains: 'b' } }), ['Banana split']);
  assert.deepEqual(await names({ property: 'Labels', multi_select: { does_not_contain: 'b' } }), ['Apple pie', 'Cherry tart']);
  assert.deepEqual(await names({ property: 'Labels', multi_select: { is_empty: true } }), ['Cherry tart']);
  assert.deepEqual(await names({ property: 'Confidence', number: { greater_than: 0.3 } }), ['Banana split']);
  assert.deepEqual(await names({ property: 'Confidence', number: { less_than_or_equal_to: 0.5 } }), ['Apple pie', 'Banana split']);
  assert.deepEqual(await names({ property: 'Confidence', number: { equals: 0.2 } }), ['Apple pie']);
  assert.deepEqual(await names({ property: 'Confidence', number: { is_empty: true } }), ['Cherry tart']);
  assert.deepEqual(await names({ property: 'Done', checkbox: { equals: true } }), ['Apple pie']);
  assert.deepEqual(await names({ property: 'Done', checkbox: { does_not_equal: true } }), ['Banana split', 'Cherry tart']);
  assert.deepEqual(await names({ property: 'Due', date: { before: '2026-10-15' } }), ['Apple pie']);
  assert.deepEqual(await names({ property: 'Due', date: { on_or_after: '2026-10-20' } }), ['Banana split']);
  assert.deepEqual(await names({ property: 'Due', date: { equals: '2026-10-10' } }), ['Apple pie']);
  assert.deepEqual(await names({ property: 'Due', date: { is_empty: true } }), ['Cherry tart']);
  assert.deepEqual(await names({ and: [{ property: 'Tag', select: { is_not_empty: true } }, { property: 'Done', checkbox: { equals: false } }] }), ['Banana split']);
  assert.deepEqual(await names({ or: [{ property: 'Done', checkbox: { equals: true } }, { property: 'Confidence', number: { is_empty: true } }] }), ['Apple pie', 'Cherry tart']);
  assert.deepEqual(await names({ and: [{ or: [{ property: 'Tag', select: { equals: 'Wordy' } }, { property: 'Tag', select: { is_empty: true } }] }, { property: 'Done', checkbox: { equals: false } }] }), ['Cherry tart']);
  assert.deepEqual(await names({ timestamp: 'created_time', created_time: { is_not_empty: true } }), ['Apple pie', 'Banana split', 'Cherry tart']);
  assert.deepEqual(await names({ property: 'Created', created_time: { after: '2000-01-01T00:00:00Z' } }), ['Apple pie', 'Banana split', 'Cherry tart']);
});

test('query filters that name no property, mix types or hold two conditions are 400, not ignored', async () => {
  const { fake, db } = world();
  fake.addRow(db, row(1));
  for (const filter of [
    { property: 'Nope', select: { equals: 'x' } },
    { property: 'Tag', rich_text: { equals: 'x' } },
    { property: 'Tag', select: { equals: 'x', does_not_equal: 'y' } },
    { property: 'Tag', select: { starts_with: 'x' } },
    { property: 'Tag', select: { is_empty: false } },
    { property: 'Tag' },
    { and: [] },
    { and: [{ property: 'Tag', select: { equals: 'a' } }], or: [] },
    { timestamp: 'due_time', created_time: { is_empty: true } },
    { property: 'Number', unique_id: { equals: 1 } },
    'Tag',
  ]) {
    const r = await post(fake, `/databases/${db}/query`, { filter });
    assert.equal(r.status, 400, JSON.stringify(filter));
    assert.equal(r.body.code, 'validation_error');
  }
});

test('query sorts: by property, by timestamp, ascending and descending, ties in creation order', async () => {
  const { fake, db } = world();
  fake.addRow(db, { Claim: 'B', Confidence: 0.5, Tag: 'Wordy' });
  fake.addRow(db, { Claim: 'A', Confidence: 0.9, Tag: 'Context-dependent' });
  fake.addRow(db, { Claim: 'C', Confidence: 0.5 });
  fake.addRow(db, { Claim: 'D', Confidence: null });
  const order = async (sorts) => (await post(fake, `/databases/${db}/query`, { sorts })).body.results.map((p) => p.properties.Claim.title[0].plain_text).join('');
  assert.equal(await order([{ property: 'Claim', direction: 'ascending' }]), 'ABCD');
  assert.equal(await order([{ property: 'Claim', direction: 'descending' }]), 'DCBA');
  assert.equal(await order([{ property: 'Confidence', direction: 'ascending' }]), 'DBCA', 'empty first, equal values in creation order');
  assert.equal(await order([{ property: 'Confidence', direction: 'descending' }]), 'ABCD', 'highest first, equal values in creation order, empty last');
  assert.equal(await order([{ property: 'Confidence', direction: 'descending' }, { property: 'Claim', direction: 'descending' }]), 'ACBD', 'a second sort breaks the tie');
  assert.equal(await order([{ timestamp: 'created_time', direction: 'descending' }]), 'DCAB', 'the rows were made as B, A, C, D');
  assert.equal(await order([{ property: 'Tag', direction: 'ascending' }]), 'CDAB', 'empty first, then Context-dependent, then Wordy');
  for (const sorts of [[{ property: 'Nope', direction: 'ascending' }], [{ property: 'Claim', direction: 'up' }], [{ timestamp: 'x', direction: 'ascending' }], 'Claim']) {
    const r = await post(fake, `/databases/${db}/query`, { sorts });
    assert.equal(r.status, 400, JSON.stringify(sorts));
  }
});

test('filters and sorts work together with paging', async () => {
  const { fake, db } = world();
  for (let n = 1; n <= 6; n++) fake.addRow(db, row(n, { Done: n % 2 === 0 }));
  const first = await post(fake, `/databases/${db}/query`, { filter: { property: 'Done', checkbox: { equals: true } }, sorts: [{ property: 'Confidence', direction: 'descending' }], page_size: 2 });
  assert.deepEqual(first.body.results.map((p) => p.properties.Confidence.number), [0.6, 0.4]);
  assert.equal(first.body.has_more, true);
  const second = await post(fake, `/databases/${db}/query`, { filter: { property: 'Done', checkbox: { equals: true } }, sorts: [{ property: 'Confidence', direction: 'descending' }], page_size: 2, start_cursor: first.body.next_cursor });
  assert.deepEqual(second.body.results.map((p) => p.properties.Confidence.number), [0.2]);
  assert.equal(second.body.has_more, false);
});

// ---- property items --------------------------------------------------------------------------------------------------------------------

test('GET /pages/{id}/properties/{property}: a single value, or a list that pages', async () => {
  const fake = createFakeNotion();
  const { data_source_id: other } = fake.addDatabase({ title: 'Other', properties: { Name: { type: 'title', title: {} } } });
  const targets = Array.from({ length: 5 }, (_, i) => fake.addRow(other, { Name: `T${i}` }));
  const { database_id: db } = fake.addDatabase({
    title: 'Main', properties: { Name: { type: 'title', title: {} }, Note: { type: 'rich_text', rich_text: {} }, Count: { type: 'number', number: {} }, Link: { type: 'relation', relation: { data_source_id: other, single_property: {} } } },
  });
  const id = fake.addRow(db, { Name: 'Row', Note: 'A note', Count: 3, Link: targets });
  const schema = fake.database(db).properties;
  const one = await get(fake, `/pages/${id}/properties/${schema.Count.id}`);
  assert.deepEqual(one.body, { object: 'property_item', id: schema.Count.id, type: 'number', number: 3 });
  const title = await get(fake, `/pages/${id}/properties/title`);
  assert.equal(title.body.object, 'list');
  assert.equal(title.body.results[0].title.plain_text, 'Row');
  assert.equal(title.body.property_item.type, 'title');
  const note = await get(fake, `/pages/${id}/properties/${encodeURIComponent(schema.Note.id)}`);
  assert.equal(note.body.results[0].rich_text.plain_text, 'A note');
  const first = await get(fake, `/pages/${id}/properties/${schema.Link.id}?page_size=2`);
  assert.deepEqual(first.body.results.map((r) => r.relation.id), targets.slice(0, 2));
  assert.equal(first.body.has_more, true);
  const rest = await get(fake, `/pages/${id}/properties/${schema.Link.id}?page_size=100&start_cursor=${first.body.next_cursor}`);
  assert.deepEqual(rest.body.results.map((r) => r.relation.id), targets.slice(2));
  assert.equal(rest.body.has_more, false);
  assert.equal((await get(fake, `/pages/${id}/properties/nope`)).status, 404);
  assert.equal((await get(fake, `/pages/nope/properties/title`)).status, 404);
});

// ---- POST /databases and PATCH /data_sources ---------------------------------------------------------------------------------------

const newDatabase = (parent, over = {}) => ({
  parent: { type: 'page_id', page_id: parent },
  title: text('Rulebook copy'),
  is_inline: true,
  initial_data_source: { properties: { Name: { type: 'title', title: {} }, Status: { type: 'select', select: { options: [{ name: 'Verified', color: 'green' }, { name: 'Proposed' }] } }, Evidence: { url: {} } } },
  ...over,
});

test('POST /databases creates a database with one data source and answers with data_sources', async () => {
  const { fake, root } = world();
  const r = await post(fake, '/databases', newDatabase(root, { description: text('Copy of the taxonomy') }), { version: VIEWS });
  assert.equal(r.status, 200);
  assert.equal(r.body.object, 'database');
  assert.deepEqual(r.body.parent, { type: 'page_id', page_id: root });
  assert.equal(r.body.title[0].plain_text, 'Rulebook copy');
  assert.equal(r.body.description[0].plain_text, 'Copy of the taxonomy');
  assert.equal(r.body.is_inline, true);
  assert.equal(r.body.data_sources.length, 1);
  assert.equal(r.body.data_sources[0].name, 'Rulebook copy');
  assert.equal(r.body.properties, undefined, 'a 2025-09-03 database has no columns of its own');
  const dsId = r.body.data_sources[0].id;
  const ds = (await get(fake, `/data_sources/${dsId}`, { version: DS })).body;
  assert.deepEqual(Object.keys(ds.properties), ['Name', 'Status', 'Evidence']);
  assert.equal(ds.properties.Name.id, 'title');
  assert.equal(ds.properties.Evidence.type, 'url', 'the type may be left out when the key says it');
  assert.deepEqual(ds.properties.Status.select.options.map((o) => [o.name, o.color]), [['Verified', 'green'], ['Proposed', 'default']]);
  assert.deepEqual(ds.parent, { type: 'database_id', database_id: r.body.id });
  const row = await post(fake, '/pages', { parent: { data_source_id: dsId }, properties: { Name: { title: text('Context-dependent') }, Status: { select: { name: 'Verified' } } } }, { version: DS });
  assert.equal(row.status, 200);
  assert.equal(fake.plainRows(r.body.id)[0].Status, 'Verified');
  assert.equal(fake.writes().filter((w) => w.path === '/databases').length, 1);
});

test('POST /databases checks its body: version, parent, title property, columns at the right place', async () => {
  const { fake, root } = world();
  const old = await post(fake, '/databases', newDatabase(root));
  assert.equal(old.status, 400);
  assert.match(old.body.message, /needs Notion-Version 2025-09-03 or later/);
  const fail = async (body, pattern, status = 400) => {
    const r = await post(fake, '/databases', body, { version: VIEWS });
    assert.equal(r.status, status, pattern.toString());
    assert.match(r.body.message, pattern);
  };
  await fail({ ...newDatabase(root), properties: { Name: { title: {} } } }, /body\.properties should not be present; a database takes its columns in initial_data_source\.properties/);
  await fail({ ...newDatabase(root), parent: undefined }, /body\.parent should be defined/);
  await fail({ ...newDatabase(root), parent: { page_id: 'nope' } }, /Could not find page with ID: nope/, 404);
  await fail({ ...newDatabase(root), parent: { database_id: root } }, /body\.parent\.page_id should be defined/);
  await fail({ ...newDatabase(root), title: 'Plain string' }, /body\.title should be an array/);
  await fail({ ...newDatabase(root), initial_data_source: undefined }, /initial_data_source should be defined/);
  await fail(newDatabase(root, { initial_data_source: { properties: { Status: { select: { options: [] } } } } }), /needs exactly one title property, found 0/);
  await fail(newDatabase(root, { initial_data_source: { properties: { A: { title: {} }, B: { title: {} } } } }), /found 2/);
  await fail(newDatabase(root, { initial_data_source: { properties: { A: { title: {} }, B: { select: { options: [{ name: 'x,y' }] } } } } }), /cannot contain commas/);
  await fail(newDatabase(root, { initial_data_source: { properties: { A: { title: {} }, B: { relation: { data_source_id: 'nope', single_property: {} } } } } }), /Could not find data source with ID: nope/, 404);
  await fail(newDatabase(root, { title: text('x'.repeat(2001)) }), /text\.content\.length should be ≤ `2000`/);
  assert.equal(fake.requests.at(-1).status, 400);
});

test('PATCH /data_sources/{id} adds a column, renames one, adds options, and never takes anything away', async () => {
  const { fake, db, ds } = world();
  const id = fake.addRow(db, row(1));
  const added = await patch(fake, `/data_sources/${ds}`, { properties: { 'Agent tags': { rich_text: {} }, Priority: { select: { options: [{ name: 'High' }] } } } }, { version: DS });
  assert.equal(added.status, 200);
  assert.deepEqual(Object.keys(added.body.properties).slice(-2), ['Agent tags', 'Priority']);
  assert.equal(added.body.properties['Agent tags'].type, 'rich_text');
  assert.notEqual(added.body.properties['Agent tags'].id, added.body.properties.Priority.id);
  const page = fake.page(id);
  assert.deepEqual(page.properties['Agent tags'].rich_text, [], 'a row that existed before shows the new column empty');
  assert.equal(page.properties.Priority.select, null);
  await patch(fake, `/pages/${id}`, { properties: { 'Agent tags': { rich_text: text('Wordy') } } });
  const renamed = await patch(fake, `/data_sources/${ds}`, { properties: { 'Agent tags': { name: 'Tags by agent' } } }, { version: DS });
  assert.equal(renamed.status, 200);
  assert.ok(renamed.body.properties['Tags by agent']);
  assert.equal(renamed.body.properties['Agent tags'], undefined);
  assert.equal(renamed.body.properties['Tags by agent'].id, added.body.properties['Agent tags'].id, 'a rename keeps the id');
  assert.equal(fake.plainRows(db)[0]['Tags by agent'], 'Wordy', 'and the value');
  const optionId = added.body.properties.Priority.select.options[0].id;
  const more = await patch(fake, `/data_sources/${ds}`, { properties: { Priority: { select: { options: [{ name: 'High' }, { name: 'Low' }] } } } }, { version: DS });
  assert.equal(more.body.properties.Priority.select.options[0].id, optionId, 'the option that was there keeps its id');
  assert.deepEqual(more.body.properties.Priority.select.options.map((o) => o.name), ['High', 'Low']);
  const titled = await patch(fake, `/data_sources/${ds}`, { title: text('Renamed table') }, { version: DS });
  assert.equal(titled.body.title[0].plain_text, 'Renamed table');
  assert.deepEqual(fake.database(db).data_sources, [{ id: ds, name: 'Renamed table' }]);
});

test('PATCH /data_sources/{id} refuses what would delete, retype or duplicate a column, and what the API does not take', async () => {
  const { fake, ds } = world();
  const fail = async (body, pattern) => {
    const r = await patch(fake, `/data_sources/${ds}`, body, { version: DS });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.message, pattern, JSON.stringify(body));
  };
  await fail({ properties: { Tag: null } }, /would delete the property; this fake never deletes/);
  await fail({ properties: { Tag: { rich_text: {} } } }, /does not change the type of a property/);
  await fail({ properties: { Extra: { title: {} } } }, /one title property already/);
  await fail({ properties: { Tag: { name: 'Key' } } }, /a property named Key exists already/);
  await fail({ description: text('x') }, /body\.description should not be present; a data source takes title, icon and properties/);
  await fail({ properties: 'x' }, /body\.properties should be an object/);
  assert.equal((await patch(fake, `/data_sources/${ds}`, { properties: {} })).status, 400, 'and 2022-06-28 does not have the route');
  assert.deepEqual(Object.keys(fake.dataSource(ds).properties), Object.keys(props), 'nothing changed');
});

test('PATCH /data_sources/{id} keeps the column order through a rename and applies all of a request or none of it', async () => {
  const { fake, ds } = world();
  const before = Object.keys(fake.dataSource(ds).properties);
  const renamed = await patch(fake, `/data_sources/${ds}`, { properties: { Key: { name: 'Row key' } } }, { version: DS });
  assert.deepEqual(Object.keys(renamed.body.properties), before.map((n) => (n === 'Key' ? 'Row key' : n)), 'the renamed column stays where it was');
  const snapshot = fake.dataSource(ds);
  const mixed = [
    { properties: { Fresh: { rich_text: {} }, Tag: { name: 'Claim' } } },
    { properties: { Tag: { select: { options: [{ name: 'Added' }] } }, Nope: null } },
    { properties: { Tag: { select: { options: [{ name: 'Added' }] } }, Labels: { select: { options: [] } } } },
    { properties: { Tag: { select: null } } },
    { properties: { Fresh: { rich_text: {} }, Other: { select: { options: [{ name: 'a,b' }] } } } },
    { title: text('New name'), properties: { Tag: { rich_text: {} } } },
  ];
  for (const body of mixed) {
    const r = await patch(fake, `/data_sources/${ds}`, body, { version: DS });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(fake.dataSource(ds), snapshot, `nothing of ${JSON.stringify(body)} was applied`);
  }
});

test('a relation column needs an existing data source, and PATCH can add one', async () => {
  const { fake, ds } = world();
  const { data_source_id: other } = fake.addDatabase({ title: 'Other', properties: { Name: { type: 'title', title: {} } } });
  const added = await patch(fake, `/data_sources/${ds}`, { properties: { Related: { relation: { data_source_id: other, dual_property: {} } } } }, { version: DS });
  assert.equal(added.status, 200);
  assert.equal(added.body.properties.Related.relation.data_source_id, other);
  assert.equal(added.body.properties.Related.relation.type, 'dual_property');
  const missing = await patch(fake, `/data_sources/${ds}`, { properties: { Bad: { relation: { data_source_id: 'nope', single_property: {} } } } }, { version: DS });
  assert.equal(missing.status, 404);
});

test('a unique_id column added later numbers the rows that exist', async () => {
  const { fake, db, ds } = world();
  fake.addRow(db, row(1));
  fake.addRow(db, row(2));
  await patch(fake, `/data_sources/${ds}`, { properties: { Serial: { unique_id: { prefix: 'S' } } } }, { version: DS });
  assert.deepEqual(fake.plainRows(db).map((r) => r.Serial), ['S-1', 'S-2']);
  fake.addRow(db, row(3));
  assert.equal(fake.plainRows(db)[2].Serial, 'S-3');
});

// ---- views -----------------------------------------------------------------------------------------------------------------------------

test('POST /views makes a tab of a database, answers with the partial view and records everything it was given', async () => {
  const { fake, db, ds } = world();
  const ids = fake.database(db).properties;
  const body = {
    database_id: db, data_source_id: ds, name: 'Your queue', type: 'table',
    filter: { property: 'Tag', select: { equals: 'Wordy' } },
    sorts: [{ property: 'Confidence', direction: 'ascending' }],
    configuration: { type: 'table', properties: [{ property_id: ids.Claim.id, visible: true }, { property_id: ids.Key.id, visible: false, width: 120 }], wrap_cells: true },
  };
  const r = await post(fake, '/views', body, { version: VIEWS });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { object: 'view', id: r.body.id, parent: { type: 'database_id', database_id: db }, type: 'table', name: 'Your queue' });
  assert.match(r.body.id, /^[0-9a-f]{8}-/);
  const full = (await get(fake, `/views/${r.body.id}`, { version: VIEWS })).body;
  assert.equal(full.object, 'view');
  assert.equal(full.name, 'Your queue');
  assert.equal(full.data_source_id, ds);
  assert.deepEqual(full.filter, body.filter);
  assert.deepEqual(full.sorts, body.sorts);
  assert.deepEqual(full.configuration, body.configuration);
  assert.equal(full.quick_filters, null);
  assert.deepEqual(full.parent, { type: 'database_id', database_id: db });
  assert.match(full.created_time, /^\d{4}-/);
  assert.deepEqual(fake.views(db).map((v) => [v.name, v.type]), [['Your queue', 'table']]);
  assert.deepEqual(fake.views(db)[0].filter, body.filter);
  assert.deepEqual(fake.views(db)[0].configuration, body.configuration);
});

test('views are listed by GET /views?database_id= and GET /databases/{id}/views, as references, in order, and page', async () => {
  const { fake, db, ds } = world();
  const make = async (name, position) => (await post(fake, '/views', { database_id: db, data_source_id: ds, name, type: 'table', ...(position ? { position } : {}) }, { version: VIEWS })).body.id;
  const a = await make('A');
  const b = await make('B');
  const c = await make('C', { type: 'start' });
  const d = await make('D', { type: 'after_view', view_id: a });
  assert.deepEqual(fake.views(db).map((v) => v.name), ['C', 'A', 'D', 'B']);
  const list = await get(fake, `/views?database_id=${db}`, { version: VIEWS });
  assert.equal(list.status, 200);
  assert.equal(list.body.object, 'list');
  assert.deepEqual(list.body.results, [c, a, d, b].map((id) => ({ object: 'view', id })));
  assert.equal(list.body.has_more, false);
  const viaDatabase = await get(fake, `/databases/${db}/views`, { version: VIEWS });
  assert.deepEqual(viaDatabase.body.results, list.body.results);
  const first = await get(fake, `/views?database_id=${db}&page_size=3`, { version: VIEWS });
  assert.equal(first.body.results.length, 3);
  assert.equal(first.body.has_more, true);
  const rest = await get(fake, `/views?database_id=${db}&page_size=3&start_cursor=${first.body.next_cursor}`, { version: VIEWS });
  assert.deepEqual([...first.body.results, ...rest.body.results].map((v) => v.id), [c, a, d, b]);
  const byDs = await get(fake, `/views?data_source_id=${ds}`, { version: VIEWS });
  assert.equal(byDs.body.results.length, 4);
  assert.equal((await get(fake, '/views', { version: VIEWS })).status, 400);
  assert.equal((await get(fake, `/views?database_id=${db}`)).status, 400, 'views need 2026-03-11');
  assert.equal((await get(fake, `/views/${a}`, { version: DS })).status, 400);
  assert.equal((await post(fake, '/views', { database_id: db, data_source_id: ds, name: 'X', type: 'table' }, { version: DS })).status, 400);
  assert.equal((await get(fake, '/views?database_id=nope', { version: VIEWS })).status, 404);
});

test('POST /views checks placement, ids, type, filter, sorts and configuration', async () => {
  const { fake, root, db, ds } = world();
  const { database_id: otherDb, data_source_id: otherDs } = fake.addDatabase({ title: 'Other', properties: { Name: { type: 'title', title: {} } } });
  const ids = fake.database(db).properties;
  const ok = { database_id: db, data_source_id: ds, name: 'V', type: 'table' };
  const fail = async (body, pattern, status = 400) => {
    const r = await post(fake, '/views', body, { version: VIEWS });
    assert.equal(r.status, status, JSON.stringify(body));
    assert.match(r.body.message, pattern, JSON.stringify(body));
  };
  await fail({ ...ok, database_id: undefined }, /Exactly one of database_id, view_id or create_database must be given, found 0/);
  await fail({ ...ok, view_id: otherDb }, /found 2/);
  await fail({ ...ok, database_id: undefined, create_database: { parent: { type: 'page_id', page_id: root } } }, /create_database is not supported/);
  await fail({ ...ok, database_id: 'nope' }, /Could not find database with ID: nope/, 404);
  await fail({ ...ok, data_source_id: otherDs }, /does not belong to database/);
  await fail({ ...ok, data_source_id: undefined }, /body\.data_source_id should be defined/);
  await fail({ ...ok, data_source_id: 'nope' }, /Could not find data source with ID: nope/, 404);
  await fail({ ...ok, name: '' }, /body\.name should be a non-empty string/);
  await fail({ ...ok, type: 'spreadsheet' }, /body\.type should be one of table, board/);
  await fail({ ...ok, filter: { property: 'Nope', select: { equals: 'x' } } }, /could not find property with name or id: Nope/);
  await fail({ ...ok, sorts: [{ property: 'Nope', direction: 'ascending' }] }, /names a property or timestamp that does not exist/);
  await fail({ ...ok, configuration: { type: 'board' } }, /configuration\.type should be "table"/);
  await fail({ ...ok, configuration: { type: 'table', properties: [{ property_id: 'Claim' }] } }, /is not the id of a property of the data source \(names do not work here\)/);
  await fail({ ...ok, configuration: { type: 'table', properties: [{ visible: true }] } }, /property_id should be a property id/);
  await fail({ ...ok, configuration: { type: 'table', properties: [{ property_id: ids.Claim.id, hidden: true }] } }, /\.hidden should not be present/);
  await fail({ ...ok, configuration: { type: 'table', properties: [{ property_id: ids.Claim.id, width: 0 }] } }, /width should be an integer of at least 1/);
  await fail({ ...ok, configuration: { type: 'table', columns: [] } }, /configuration\.columns should not be present/);
  await fail({ ...ok, configuration: { type: 'table', group_by: { property_id: 'Tag' } } }, /group_by\.property_id should be the id of a property/);
  await fail({ ...ok, position: { type: 'after_view', view_id: 'nope' } }, /is not a view of this database/);
  await fail({ ...ok, position: { type: 'middle' } }, /position\.type should be start, end or after_view/);
  assert.deepEqual(fake.views(db), [], 'no refused request left a view behind');
  const good = await post(fake, '/views', { ...ok, configuration: { type: 'table', properties: [{ property_id: ids.Tag.id, visible: true }], group_by: { property_id: ids.Tag.id } } }, { version: VIEWS });
  assert.equal(good.status, 200);
});

test('a view needs a data source of its own database, and views of protected databases do not exist', async () => {
  const { fake, db, ds } = world();
  fake.protect(db);
  assert.equal((await post(fake, '/views', { database_id: db, data_source_id: ds, name: 'V', type: 'table' }, { version: VIEWS })).status, 404);
  assert.equal((await get(fake, `/views?database_id=${db}`, { version: VIEWS })).status, 404);
});

// ---- blocks ----------------------------------------------------------------------------------------------------------------------------

const paragraph = (s) => ({ type: 'paragraph', paragraph: { rich_text: text(s) } });

test('PATCH /blocks/{id}/children appends blocks in order and answers with them; GET lists them and pages', async () => {
  const { fake, root } = world();
  const r = await patch(fake, `/blocks/${root}/children`, { children: [paragraph('one'), paragraph('two')] });
  assert.equal(r.status, 200);
  assert.equal(r.body.object, 'list');
  assert.deepEqual(r.body.results.map((b) => b.paragraph.rich_text[0].plain_text), ['one', 'two']);
  assert.ok(r.body.results.every((b) => b.object === 'block' && /^[0-9a-f]{8}-/.test(b.id)));
  await patch(fake, `/blocks/${root}/children`, { children: [paragraph('three')] });
  const all = await get(fake, `/blocks/${root}/children`);
  assert.deepEqual(all.body.results.map((b) => b.paragraph.rich_text[0].plain_text), ['one', 'two', 'three']);
  const first = await get(fake, `/blocks/${root}/children?page_size=2`);
  assert.equal(first.body.results.length, 2);
  assert.equal(first.body.has_more, true);
  const second = await get(fake, `/blocks/${root}/children?page_size=2&start_cursor=${first.body.next_cursor}`);
  assert.deepEqual(second.body.results.map((b) => b.paragraph.rich_text[0].plain_text), ['three']);
  assert.equal(second.body.has_more, false);
  assert.equal((await get(fake, `/blocks/${root}/children?page_size=101`)).status, 400);
});

test('PATCH /blocks/{id}/children inserts after a block when asked, and refuses an after that is not a child', async () => {
  const { fake, root } = world();
  const made = (await patch(fake, `/blocks/${root}/children`, { children: [paragraph('a'), paragraph('c')] })).body.results;
  await patch(fake, `/blocks/${root}/children`, { children: [paragraph('b')], after: made[0].id });
  assert.deepEqual(fake.children(root).map((b) => b.paragraph.rich_text[0].plain_text), ['a', 'b', 'c']);
  assert.match((await patch(fake, `/blocks/${root}/children`, { children: [paragraph('x')], after: 'nope' })).body.message, /is not a child of this block/);
});

test('blocks: at most 100 per request, at least one, known types, 2,000 characters per text object', async () => {
  const { fake, root } = world();
  const hundred = await patch(fake, `/blocks/${root}/children`, { children: Array.from({ length: 100 }, (_, i) => paragraph(`p${i}`)) });
  assert.equal(hundred.status, 200);
  assert.equal(hundred.body.results.length, 100);
  const fail = async (body, pattern) => {
    const r = await patch(fake, `/blocks/${root}/children`, body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    assert.match(r.body.message, pattern);
  };
  await fail({ children: Array.from({ length: 101 }, () => paragraph('x')) }, /body\.children\.length should be ≤ `100`, instead was `101`/);
  await fail({ children: [] }, /should contain at least one block/);
  await fail({}, /body\.children should be defined/);
  await fail({ children: 'x' }, /body\.children should be an array/);
  await fail({ children: [{ type: 'child_page', child_page: { title: 'x' } }] }, /is not a block type this fake can create/);
  await fail({ children: [{ type: 'paragraph' }] }, /body\.children\[0\]\.paragraph should be an object/);
  await fail({ children: ['x'] }, /body\.children\[0\]\.type should be a block type/);
  await fail({ children: [paragraph('x'.repeat(2001))] }, /body\.children\[0\]\.paragraph\.rich_text\[0\]\.text\.content\.length should be ≤ `2000`/);
  await fail({ children: [paragraph('fine'), paragraph('y'.repeat(2001))] }, /children\[1\]/);
  await fail({ children: [{ type: 'paragraph', paragraph: { rich_text: [{ type: 'mention', mention: {} }] } }] }, /supports text objects only/);
  assert.equal(fake.children(root).length, 100, 'refused requests added nothing');
  const long = await patch(fake, `/blocks/${root}/children`, { children: [paragraph('x'.repeat(2000))] });
  assert.equal(long.status, 200);
});

test('blocks nest: children inside a table or toggle become that block\'s children', async () => {
  const { fake, root } = world();
  const tableRow = (...cells) => ({ type: 'table_row', table_row: { cells: cells.map((c) => text(c)) } });
  const r = await patch(fake, `/blocks/${root}/children`, {
    children: [
      { type: 'table', table: { table_width: 2, has_column_header: true, children: [tableRow('What', 'Result'), tableRow('Claims', '7')] } },
      { type: 'toggle', toggle: { rich_text: text('More'), children: [paragraph('hidden text')] } },
    ],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results.map((b) => [b.type, b.has_children]), [['table', true], ['toggle', true]]);
  assert.equal(r.body.results[0].table.children, undefined, 'the children are not part of the typed object');
  assert.equal(r.body.results[0].table.table_width, 2);
  const rows = await get(fake, `/blocks/${r.body.results[0].id}/children`);
  assert.deepEqual(rows.body.results.map((b) => b.table_row.cells[0][0].plain_text), ['What', 'Claims']);
  assert.deepEqual(rows.body.results[0].parent, { type: 'block_id', block_id: r.body.results[0].id });
  assert.equal(fake.children(r.body.results[1].id)[0].paragraph.rich_text[0].plain_text, 'hidden text');
  const deep = await patch(fake, `/blocks/${root}/children`, {
    children: [{ type: 'toggle', toggle: { rich_text: text('a'), children: [{ type: 'toggle', toggle: { rich_text: text('b'), children: [{ type: 'toggle', toggle: { rich_text: text('c'), children: [paragraph('d')] } }] } }] } }],
  });
  assert.equal(deep.status, 400);
  assert.match(deep.body.message, /two levels deep/);
  const count = fake.children(root).length;
  const bad = await patch(fake, `/blocks/${root}/children`, { children: [paragraph('fine'), { type: 'table', table: { children: [tableRow('ok'), { type: 'table_row', table_row: { cells: [text('x'.repeat(2001))] } }] } }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /children\[1\]\.table\.children\[1\]\.table_row\.cells\[0\]\[0\]\.text\.content\.length/);
  assert.equal(fake.children(root).length, count, 'a bad block anywhere in the request, nested ones included, means nothing is appended');
  const page = await post(fake, '/pages', { parent: { page_id: root }, properties: { title: { title: text('Nested') } }, children: [{ type: 'toggle', toggle: { rich_text: text('t'), children: [paragraph('x'.repeat(2001))] } }] });
  assert.equal(page.status, 400);
  assert.equal(fake.requests.filter((r) => r.path === '/pages' && r.status === 200).length, 0, 'and no page is made');
});

test('blocks hang from pages and blocks, not from databases', async () => {
  const { fake, db, ds } = world();
  assert.equal((await get(fake, `/blocks/${db}/children`)).status, 404);
  assert.equal((await patch(fake, `/blocks/${ds}/children`, { children: [paragraph('x')] })).status, 404);
  const page = fake.addRow(db, row(1));
  assert.equal((await patch(fake, `/blocks/${page}/children`, { children: [paragraph('a row can have a body')] })).status, 200);
  assert.deepEqual(fake.children(page).map((b) => b.type), ['paragraph']);
});

// ---- failNext --------------------------------------------------------------------------------------------------------------------------

test('failNext answers the next matching requests with the given status, then lets the rest through', async () => {
  const { fake, db } = world();
  fake.failNext('POST', /^\/pages$/, 503, 2);
  assert.equal(fake.pendingFailures(), 2);
  const create = () => post(fake, '/pages', { parent: { database_id: db }, properties: { Claim: { title: text('x') } } });
  const a = await create();
  assert.equal(a.status, 503);
  assert.deepEqual(a.body, { object: 'error', status: 503, code: 'service_unavailable', message: 'Injected 503 (failNext).' });
  assert.equal((await create()).status, 503);
  assert.equal(fake.pendingFailures(), 0);
  assert.equal((await create()).status, 200);
  assert.equal(fake.rows(db).length, 1, 'the failed attempts created nothing');
  assert.deepEqual(fake.requests.map((r) => r.status), [503, 503, 200]);
  assert.equal(fake.writes().length, 3, 'all three were attempts to write');
});

test('failNext matches on method and path, a string counts as a pattern, * and null mean any method', async () => {
  const { fake, root, db } = world();
  fake.failNext('GET', /^\/pages\//, 500);
  assert.equal((await post(fake, `/databases/${db}/query`, {})).status, 200, 'another route is not touched');
  assert.equal((await patch(fake, `/pages/${root}`, { properties: {} })).status, 200, 'another method is not touched');
  assert.equal((await get(fake, `/pages/${root}`)).status, 500);
  assert.equal((await get(fake, `/pages/${root}`)).status, 200, 'times defaults to 1');
  fake.failNext('post', `/databases/${db}/query`, 409);
  assert.equal((await post(fake, `/databases/${db}/query`, {})).status, 409, 'the method is case-insensitive and the string is a pattern');
  fake.failNext('*', /blocks/, 502);
  assert.equal((await get(fake, `/blocks/${root}/children`)).status, 502);
  fake.failNext(null, /blocks/, 504);
  assert.equal((await patch(fake, `/blocks/${root}/children`, { children: [paragraph('x')] })).status, 504);
  assert.equal(fake.children(root).length, 0);
  fake.failNext('GET', /pages\/[^?]*\?x=1/, 500);
  assert.equal((await get(fake, `/pages/${root}`)).status, 200);
  assert.equal((await get(fake, `/pages/${root}?x=1`)).status, 500, 'the query string is part of the path that is matched');
  const global = /pages/g;
  fake.failNext('GET', global, 500, 2);
  assert.equal((await get(fake, `/pages/${root}`)).status, 500);
  assert.equal((await get(fake, `/pages/${root}`)).status, 500, 'a global flag does not make every other match fail');
});

test('failNext codes: Notion\'s own for each status, or the ones given; 429 says retry-after 0 unless told otherwise', async () => {
  const { fake, root } = world();
  const codes = {};
  for (const status of [400, 401, 403, 404, 409, 429, 500, 502, 503, 504, 418]) {
    fake.failNext('GET', /pages/, status);
    const r = await get(fake, `/pages/${root}`);
    codes[status] = r.body.code;
    assert.equal(r.status, status);
  }
  assert.deepEqual(codes, {
    400: 'validation_error', 401: 'unauthorized', 403: 'restricted_resource', 404: 'object_not_found', 409: 'conflict_error', 429: 'rate_limited', 500: 'internal_server_error',
    502: 'bad_gateway', 503: 'service_unavailable', 504: 'gateway_timeout', 418: 'internal_server_error',
  });
  fake.failNext('GET', /pages/, 429);
  assert.equal((await get(fake, `/pages/${root}`)).headers.get('retry-after'), '0');
  fake.failNext('GET', /pages/, 429, 1, { headers: { 'retry-after': '7' } });
  assert.equal((await get(fake, `/pages/${root}`)).headers.get('retry-after'), '7');
  fake.failNext('GET', /pages/, 500, 1, { code: 'custom_code', message: 'Custom message' });
  const custom = await get(fake, `/pages/${root}`);
  assert.deepEqual(custom.body, { object: 'error', status: 500, code: 'custom_code', message: 'Custom message' });
  fake.failNext('GET', /pages/, 500);
  assert.equal((await get(fake, `/pages/${root}`)).headers.get('retry-after'), null);
});

test('failNext with applied: true does the work and loses only the answer', async () => {
  const { fake, db } = world();
  fake.failNext('POST', /^\/pages$/, 500, 1, { applied: true });
  const lost = await post(fake, '/pages', { parent: { database_id: db }, properties: { Claim: { title: text('Created, answer lost') } } });
  assert.equal(lost.status, 500);
  assert.deepEqual(fake.plainRows(db).map((r) => r.Claim), ['Created, answer lost']);
  fake.failNext('PATCH', /^\/pages\//, 502, 1, { applied: true });
  const id = fake.plainRows(db)[0].page_id;
  assert.equal((await patch(fake, `/pages/${id}`, { properties: { Done: { checkbox: true } } })).status, 502);
  assert.equal(fake.plainRows(db)[0].Done, true);
  fake.failNext('POST', /^\/pages$/, 500, 1, { applied: true });
  const bad = await post(fake, '/pages', { parent: { database_id: db }, properties: { Nope: { title: text('x') } } });
  assert.equal(bad.status, 500, 'the injected answer wins, but the request that was bad changed nothing');
  assert.equal(fake.rows(db).length, 1);
});

test('failNext with "network" makes fetch itself fail, like a dropped connection', async () => {
  const { fake, db } = world();
  fake.failNext('POST', /^\/pages$/, 'network');
  await assert.rejects(() => post(fake, '/pages', { parent: { database_id: db }, properties: {} }), (e) => e instanceof TypeError && e.message === 'fetch failed' && e.cause.code === 'ECONNRESET');
  assert.equal(fake.rows(db).length, 0);
  assert.equal(fake.requests.at(-1).status, null, 'it is logged, with no status');
  fake.failNext('POST', /^\/pages$/, 'network', 1, { applied: true });
  await assert.rejects(() => post(fake, '/pages', { parent: { database_id: db }, properties: { Claim: { title: text('Made, then the line dropped') } } }), TypeError);
  assert.equal(fake.rows(db).length, 1);
  assert.equal((await post(fake, '/pages', { parent: { database_id: db }, properties: {} })).status, 200);
});

test('failNext does not hide a wrong token or a missing version', async () => {
  const { fake, root } = world();
  fake.failNext('GET', /pages/, 500);
  assert.equal((await get(fake, `/pages/${root}`, { token: 'wrong_token_000000' })).status, 401);
  assert.equal((await get(fake, `/pages/${root}`, { version: null })).status, 400);
  assert.equal(fake.pendingFailures(), 1, 'neither of those used up the failure');
});

// ---- protected ids ---------------------------------------------------------------------------------------------------------------------

test('protected ids do not exist for the API: reads, writes and children are all 404', async () => {
  const fake = createFakeNotion({ protected: ['9E111D22C14E4344BB90072606036942', 'd1307596-e531-420f-8688-2485f3ef28ab', '3da273e214eb80c180d5fd0894bc2db8'] });
  const real = fake.addDatabase({ id: '9e111d22-c14e-4344-bb90-072606036942', dataSourceId: 'D1307596E531420F86882485F3EF28AB', title: 'Real claims', properties: { Name: { type: 'title', title: {} } } });
  const rowId = fake.addRow(real.database_id, { Name: 'A real claim' });
  const secretPage = fake.addPage({ title: 'Secret' });
  fake.protect(secretPage);
  const open = fake.addPage({ title: 'Open' });
  assert.equal((await get(fake, `/databases/${real.database_id}`)).status, 404);
  assert.equal((await get(fake, `/databases/${real.database_id.replace(/-/g, '')}`)).status, 404, 'in any spelling');
  assert.equal((await post(fake, `/databases/${real.database_id}/query`, {})).status, 404);
  assert.equal((await get(fake, `/data_sources/${real.data_source_id}`, { version: DS })).status, 404, 'the data source id is protected itself');
  assert.equal((await post(fake, `/data_sources/${real.data_source_id}/query`, {}, { version: DS })).status, 404);
  assert.equal((await get(fake, `/pages/${rowId}`)).status, 404, 'a row of a protected database');
  assert.equal((await patch(fake, `/pages/${rowId}`, { properties: { Name: { title: text('Changed') } } })).status, 404);
  assert.equal((await post(fake, '/pages', { parent: { database_id: real.database_id }, properties: { Name: { title: text('New') } } })).status, 404);
  assert.equal((await post(fake, '/pages', { parent: { data_source_id: real.data_source_id }, properties: { Name: { title: text('New') } } }, { version: DS })).status, 404);
  assert.equal((await get(fake, `/pages/${secretPage}`)).status, 404);
  assert.equal((await patch(fake, `/blocks/${secretPage}/children`, { children: [paragraph('x')] })).status, 404);
  assert.equal((await get(fake, `/blocks/${secretPage}/children`)).status, 404);
  assert.equal((await post(fake, '/pages', { parent: { page_id: secretPage }, properties: { title: { title: text('Child') } } })).status, 404);
  assert.equal((await post(fake, '/databases', newDatabase(secretPage), { version: VIEWS })).status, 404);
  assert.equal((await get(fake, `/pages/${open}`)).status, 200, 'everything else works');
  assert.equal(fake.plainRows(real.database_id)[0].Name, 'A real claim', 'the helpers still see it, and nothing changed it');
  assert.equal(fake.writes().filter((w) => w.status !== 404).length, 0);
});

test('a page under a protected page, and a block of such a page, are protected as well', async () => {
  const { fake, root } = world();
  const child = fake.addPage({ parentPageId: root, title: 'Child' });
  const grandchild = fake.addPage({ parentPageId: child, title: 'Grandchild' });
  assert.equal((await get(fake, `/pages/${grandchild}`)).status, 200);
  const made = (await patch(fake, `/blocks/${grandchild}/children`, { children: [paragraph('x')] })).body.results[0];
  fake.protect(root);
  for (const id of [root, child, grandchild]) assert.equal((await get(fake, `/pages/${id}`)).status, 404, id);
  assert.equal((await get(fake, `/blocks/${made.id}/children`)).status, 404);
});

// ---- the whole thing through the real client -------------------------------------------------------------------------------------------

/** A clock that moves a second with every look, so the client's request pacing never has to wait. */
function ticking() {
  let t = 0;
  return () => (t += 1000);
}

/** The MVP client of scripts/lib/notion-rest.mjs, pointed at the fake with no waiting. */
function clients(fake, options = {}) {
  const base = { token: fake.token, fetchImpl: fake.fetchImpl, requestsPerSecond: 1_000_000, sleep: async () => {}, now: ticking(), ...options };
  return { old: createClient({ ...base, apiVersion: OLD }), data: createClient({ ...base, apiVersion: DS }), builder: createClient({ ...base, apiVersion: BUILDER_API_VERSION }) };
}

test('the client builds a practice page, a table and its views, fills a row, reads it back and updates it (every route the client sends)', async () => {
  const fake = createFakeNotion();
  const parent = fake.addPage({ title: 'Parent' });
  const { old, data, builder } = clients(fake);

  const page = await builder.createPageUnderPage({ parentPageId: parent, title: 'Claim tagger', icon: '📘', children: [paragraph('Welcome')] });
  assert.equal(page.object, 'page');
  assert.deepEqual(page.icon, { type: 'emoji', emoji: '📘' });
  assert.equal((await builder.retrieveBlockChildren(page.id)).length, 1);

  const database = await builder.createDatabase({
    parentPageId: page.id, title: 'Tag decisions', description: 'The queue', properties: {
      Claim: { type: 'title', title: {} }, Key: { type: 'rich_text', rich_text: {} }, Tag: { type: 'select', select: { options: [{ name: 'Context-dependent' }] } },
      'Agent confidence': { type: 'number', number: { format: 'number' } }, 'Tag outcome': { type: 'select', select: { options: [{ name: 'Applies' }, { name: 'Does not apply' }] } },
    },
  });
  assert.equal(database.data_sources.length, 1);
  const dsId = database.data_sources[0].id;
  assert.equal(database.properties, undefined);

  const schema = await data.retrieveDataSource(dsId);
  assert.deepEqual(Object.keys(schema.properties), ['Claim', 'Key', 'Tag', 'Agent confidence', 'Tag outcome']);
  const withColumn = await data.updateDataSource(dsId, { properties: { 'Agent notes': { rich_text: {} } } });
  assert.ok(withColumn.properties['Agent notes']);

  const created = await old.createPage({
    parentDatabaseId: database.id,
    properties: { Claim: { title: [{ type: 'text', text: { content: 'He said the new model is better.' } }] }, Key: { rich_text: [{ type: 'text', text: { content: 'g1::Context-dependent' } }] }, Tag: { select: { name: 'Context-dependent' } }, 'Agent confidence': { number: 0.62 } },
    children: [paragraph('Supporting text')],
  });
  assert.equal(created.object, 'page');
  assert.deepEqual((await old.retrieveBlockChildren(created.id)).map((b) => b.type), ['paragraph']);
  const read = await old.retrievePage(created.id);
  assert.equal(read.properties['Agent confidence'].number, 0.62);
  await old.updatePage(created.id, { properties: { 'Agent confidence': { number: 0.8 } } });
  assert.equal((await old.retrievePage(created.id)).properties['Agent confidence'].number, 0.8);
  assert.equal((await old.retrieveDatabase(database.id)).properties.Claim.type, 'title');
  assert.equal((await old.queryAll(database.id)).length, 1);
  assert.equal((await data.queryDataSourceAll(dsId)).length, 1);
  assert.equal((await old.queryAll(database.id, { filter: { property: 'Tag outcome', select: { is_empty: true } } })).length, 1);
  assert.equal((await old.queryAll(database.id, { filter: { property: 'Tag outcome', select: { equals: 'Applies' } } })).length, 0);
  assert.equal((await old.retrievePropertyItem(created.id, 'title')).length, 1);
  assert.equal((await old.appendBlocks(page.id, [paragraph('a'), paragraph('b')])).length, 2);

  const ids = (await data.retrieveDataSource(dsId)).properties;
  const view = await builder.createView({
    databaseId: database.id, dataSourceId: dsId, name: 'Your queue', type: 'table', filter: { property: 'Tag outcome', select: { is_empty: true } },
    sorts: [{ property: 'Agent confidence', direction: 'ascending' }], configuration: { type: 'table', properties: [{ property_id: ids.Claim.id, visible: true }, { property_id: ids['Tag outcome'].id, visible: true }] },
  });
  assert.equal(view.object, 'view');
  const listed = await builder.listViews(database.id);
  assert.deepEqual(listed.map((v) => v.id), [view.id]);
  const detail = await builder.retrieveView(view.id);
  assert.equal(detail.name, 'Your queue');
  assert.equal(detail.configuration.properties.length, 2);

  assert.equal(fake.requests.every((r) => r.status === 200), true, JSON.stringify(fake.requests.filter((r) => r.status !== 200)));
  assert.equal(fake.requests.find((r) => r.path === '/views').version, VIEWS);
  assert.equal(fake.requests.find((r) => r.path === '/databases' && r.method === 'POST').version, VIEWS);
  assert.equal(fake.requests.filter((r) => r.method === 'POST' && r.path === '/pages')[1].version, OLD);
  assert.deepEqual(fake.writes().map((w) => `${w.method} ${w.path.split('?')[0].replace(/\/[0-9a-f-]{36}/g, '/{id}')}`), [
    'POST /pages', 'POST /databases', 'PATCH /data_sources/{id}', 'POST /pages', 'PATCH /pages/{id}', 'PATCH /blocks/{id}/children', 'POST /views',
  ]);
});

test('the client\'s create is never sent twice: a lost answer is create_uncertain, and the row exists exactly once', async () => {
  const { fake, db } = world();
  const { old } = clients(fake);
  fake.failNext('POST', /^\/pages$/, 500, 1, { applied: true });
  await assert.rejects(
    () => old.createPage({ parentDatabaseId: db, properties: { Claim: { title: [{ type: 'text', text: { content: 'Once' } }] } } }),
    (e) => e.code === 'create_uncertain' && e.retryable === true,
  );
  assert.equal(fake.requests.filter((r) => r.method === 'POST' && r.path === '/pages').length, 1, 'one attempt');
  assert.deepEqual(fake.plainRows(db).map((r) => r.Claim), ['Once']);
  fake.failNext('POST', /^\/pages$/, 'network', 1, { applied: true });
  await assert.rejects(() => old.createPage({ parentDatabaseId: db, properties: { Claim: { title: [{ type: 'text', text: { content: 'Twice?' } }] } } }), (e) => e.code === 'create_uncertain');
  assert.deepEqual(fake.plainRows(db).map((r) => r.Claim), ['Once', 'Twice?']);
  const { builder } = clients(fake);
  const parent = fake.addPage({ title: 'P' });
  fake.failNext('POST', /^\/databases$/, 503, 1, { applied: true });
  await assert.rejects(() => builder.createDatabase({ parentPageId: parent, title: 'T', properties: { Name: { type: 'title', title: {} } } }), (e) => e.code === 'create_uncertain');
  fake.failNext('POST', /^\/views$/, 409, 1);
  await assert.rejects(() => builder.createView({ databaseId: db, dataSourceId: fake.dataSource(db).id, name: 'V', type: 'table' }), (e) => e.code === 'create_uncertain');
  assert.deepEqual(fake.views(db), [], 'a refused create made nothing');
});

test('the client retries reads on 429 and 5xx, and gives up with the fake\'s error code on a 400', async () => {
  const { fake, root, db } = world();
  const slept = [];
  const { old } = clients(fake, { sleep: async (ms) => { slept.push(ms); } });
  fake.failNext('GET', /^\/pages\//, 429, 2);
  assert.equal((await old.retrievePage(root)).id, root);
  assert.deepEqual(slept, [0, 0], 'Retry-After 0 from the fake: no wait');
  fake.failNext('GET', /^\/pages\//, 503, 2);
  assert.equal((await old.retrievePage(root)).id, root);
  assert.deepEqual(slept.slice(2), [500, 1000], 'two 503s: the client\'s first two backoffs');
  fake.failNext('GET', /^\/pages\//, 'network', 1);
  assert.equal((await old.retrievePage(root)).id, root);
  assert.deepEqual(slept.slice(4), [500]);
  assert.equal(fake.requests.filter((r) => r.path === `/pages/${root}`).length, 3 + 3 + 2);
  await assert.rejects(() => old.updatePage(root, { properties: { Nope: { rich_text: [] } } }), (e) => e.status === 400 && e.code === 'validation_error' && /Nope is not a property that exists/.test(e.message));
  await assert.rejects(() => old.retrieveDatabase('0db00000-0000-4000-8000-ffffffffffff'), (e) => e.status === 404 && e.code === 'object_not_found');
  assert.equal((await old.queryAll(db)).length, 0);
});

test('a client with the wrong token gets the fake\'s 401, and one without a version is refused before any route', async () => {
  const { fake, root } = world();
  const wrong = createClient({ token: 'ntn_not_the_token_999', fetchImpl: fake.fetchImpl, requestsPerSecond: 1_000_000, sleep: async () => {} });
  await assert.rejects(() => wrong.retrievePage(root), (e) => e.status === 401 && e.code === 'unauthorized');
  assert.equal(fake.requests.length, 1, 'a 401 is not retried');
});

test('PATCH /views/{id} renames a view and changes its filter, sorts or configuration, and nothing else; an empty or foreign body is a 400', async () => {
  const { fake, db, ds } = world();
  const ids = fake.database(db).properties;
  const made = await post(fake, '/views', {
    database_id: db, data_source_id: ds, name: 'Your queue', type: 'table', filter: { property: 'Tag', select: { equals: 'Wordy' } },
    configuration: { type: 'table', properties: [{ property_id: ids.Claim.id, visible: true }] },
  }, { version: VIEWS });
  const id = made.body.id;
  const renamed = await patch(fake, `/views/${id}`, { name: 'Your queue (ledger)' }, { version: VIEWS });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.name, 'Your queue (ledger)');
  assert.equal(renamed.body.id, id, 'the same view');
  const full = (await get(fake, `/views/${id}`, { version: VIEWS })).body;
  assert.deepEqual([full.name, full.filter, full.configuration.properties.length], ['Your queue (ledger)', { property: 'Tag', select: { equals: 'Wordy' } }, 1], 'only the name changed');
  assert.deepEqual(fake.views(db).map((v) => v.name), ['Your queue (ledger)']);

  const both = await patch(fake, `/views/${id}`, { filter: { property: 'Tag', select: { equals: 'Context-dependent' } }, sorts: [{ property: 'Confidence', direction: 'descending' }] }, { version: VIEWS });
  assert.equal(both.status, 200);
  assert.deepEqual(fake.views(db)[0].sorts, [{ property: 'Confidence', direction: 'descending' }]);
  assert.deepEqual(fake.views(db)[0].filter, { property: 'Tag', select: { equals: 'Context-dependent' } });

  assert.equal((await patch(fake, `/views/${id}`, {}, { version: VIEWS })).status, 400, 'nothing to change');
  assert.equal((await patch(fake, `/views/${id}`, { name: '  ' }, { version: VIEWS })).status, 400);
  assert.equal((await patch(fake, `/views/${id}`, { type: 'board' }, { version: VIEWS })).status, 400, 'the type of a view is not changed');
  assert.equal((await patch(fake, `/views/${id}`, { filter: { property: 'Nope', select: { equals: 'x' } } }, { version: VIEWS })).status, 400, 'a filter on a column the table lacks');
  assert.equal((await patch(fake, `/views/${id}`, { name: 'x' })).status, 400, 'views need 2026-03-11');
  assert.equal((await patch(fake, '/views/nope', { name: 'x' }, { version: VIEWS })).status, 404);
  assert.equal(fake.views(db)[0].name, 'Your queue (ledger)', 'a refused change changed nothing');
  assert.equal(fake.writes().filter((r) => r.method === 'PATCH' && r.path.startsWith('/views/')).length, 8, 'every attempt is on the log, refused ones included');
});
