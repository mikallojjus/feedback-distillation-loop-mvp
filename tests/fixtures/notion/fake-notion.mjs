// An in-memory Notion for the tests: the client interface of lib/notion-rest.mjs over six databases built from the
// hand-written schema fixtures (db.<name>.json). It keeps REST-shaped page objects, computes the formulas and rollups the
// scripts read (Effective outcome, Stage, Tag name, Lesson status, ...), keeps dual relations in sync, cuts relations at 25
// references like the real API, and records every request so a test can assert what was (and was not) written.
//
// Not a test file (the name does not match node --test's patterns); imported by the *.test.mjs files.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATABASES } from '../../../agents/claim-tagger/scripts/allowlist.mjs';
import { NotionError } from '../../../agents/claim-tagger/scripts/lib/notion-rest.mjs';
import { decodePage, encodeProperties, normId } from '../../../agents/claim-tagger/scripts/lib/notion-values.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const AGENT = join(REPO, 'agents', 'claim-tagger');

export const loadFixture = (name) => JSON.parse(readFileSync(join(HERE, name), 'utf8'));
export const fixtureSchemas = () => Object.fromEntries(DATABASES.map((db) => [db, loadFixture(`db.${db}.json`)]));
export const realConfig = () => JSON.parse(readFileSync(join(AGENT, 'config.json'), 'utf8'));

const ANNOTATIONS = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };
const richText = (s) => (s === '' || s === null || s === undefined ? [] : [{ type: 'text', text: { content: s, link: null }, annotations: ANNOTATIONS, plain_text: s, href: null }]);
const MAX_INLINE_RELATIONS = 25;

/** A page-shaped property value from an encoded (REST write) value: what the API would echo back for it. */
export function pageValue(def, enc) {
  const { id, type } = def;
  switch (type) {
    case 'title':
    case 'rich_text': return { id, type, [type]: (enc[type] ?? []).map((c) => ({ type: 'text', text: { content: c.text.content, link: null }, annotations: ANNOTATIONS, plain_text: c.text.content, href: null })) };
    case 'select':
    case 'status': return { id, type, [type]: enc[type] ? { id: `opt-${enc[type].name}`, name: enc[type].name, color: 'default' } : null };
    case 'multi_select': return { id, type, multi_select: (enc.multi_select ?? []).map((o) => ({ id: `opt-${o.name}`, name: o.name, color: 'default' })) };
    case 'number': return { id, type, number: enc.number ?? null };
    case 'checkbox': return { id, type, checkbox: enc.checkbox === true };
    case 'url':
    case 'email':
    case 'phone_number': return { id, type, [type]: enc[type] ?? null };
    case 'date': return { id, type, date: enc.date ? { start: enc.date.start, end: enc.date.end ?? null, time_zone: null } : null };
    case 'relation': return { id, type, relation: (enc.relation ?? []).map((r) => ({ id: r.id })), has_more: false };
    case 'people': return { id, type, people: (enc.people ?? []).map((p) => ({ object: 'user', id: p.id })) };
    default: throw new Error(`pageValue: cannot build a ${type} value from a write`);
  }
}

function emptyValue(def, now, db) {
  const { id, type } = def;
  switch (type) {
    case 'title': case 'rich_text': return { id, type, [type]: [] };
    case 'select': case 'status': return { id, type, [type]: null };
    case 'multi_select': return { id, type, multi_select: [] };
    case 'number': return { id, type, number: null };
    case 'checkbox': return { id, type, checkbox: false };
    case 'url': case 'email': case 'phone_number': return { id, type, [type]: null };
    case 'date': return { id, type, date: null };
    case 'relation': return { id, type, relation: [], has_more: false };
    case 'people': return { id, type, people: [] };
    case 'formula': return { id, type, formula: { type: 'string', string: null } };
    case 'rollup': return { id, type, rollup: { type: 'array', array: [], function: 'show_original' } };
    case 'created_time': return { id, type, created_time: now().toISOString() };
    case 'unique_id': return { id, type, unique_id: { prefix: def.unique_id?.prefix ?? null, number: null } };
    default: throw new Error(`emptyValue: ${db}.${def.name}: unsupported type ${type}`);
  }
}

const strFormula = (def, s) => ({ id: def.id, type: 'formula', formula: { type: 'string', string: s ?? null } });
const titleOf = (page) => {
  const t = Object.values(page.properties).find((v) => v.type === 'title');
  return (t?.title ?? []).map((x) => x.plain_text).join('');
};

/**
 * The fake. `client` is the same shape as createClient()'s result. Extra controls: add (an existing row), editorSet (a person
 * edits a field), failNext (inject an API error), onWrite (a callback after every successful write), requests / writes (the log).
 */
export function createFakeNotion({ config = realConfig(), schemas = fixtureSchemas(), now = () => new Date('2026-10-13T12:00:00.000Z') } = {}) {
  const dbOfId = new Map(DATABASES.map((db) => [normId(config.notion.databases[db].database_id), db]));
  const pages = new Map(); // normalised page id -> { db, page }
  const blocks = new Map(); // page id -> appended blocks
  const requests = [];
  const failures = [];
  const unique = { rule_changes: 0 };
  let counter = 0;
  const state = { onWrite: null };

  const dbName = (databaseId) => {
    const db = dbOfId.get(normId(databaseId));
    if (!db) throw new NotionError(`Could not find database with ID: ${databaseId}`, { status: 404, code: 'object_not_found' });
    return db;
  };
  const newId = (db) => `${DATABASES.indexOf(db) + 1}0000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}`;
  const entry = (pageId) => {
    const e = pages.get(normId(pageId));
    if (!e) throw new NotionError(`Could not find page with ID: ${pageId}`, { status: 404, code: 'object_not_found' });
    return e;
  };

  function maybeFail(method, info) {
    const i = failures.findIndex((f) => f.method === method && (!f.match || f.match(info)));
    if (i < 0) return;
    const f = failures[i];
    if (--f.times <= 0) failures.splice(i, 1);
    throw f.error;
  }

  // ---- derived values -------------------------------------------------------------------------------------------

  function recompute() {
    const byId = (id) => pages.get(normId(id))?.page;
    for (const { db, page } of pages.values()) {
      const p = page.properties;
      const def = (name) => schemas[db].properties[name];
      if (db === 'tag_decisions') {
        const outcome = p['Tag outcome'].select?.name ?? p['Seeded outcome'].select?.name ?? null;
        const tagNames = p.Tag.relation.map((r) => byId(r.id)).filter(Boolean).map(titleOf);
        p['Effective outcome'] = strFormula(def('Effective outcome'), outcome);
        p.Stage = strFormula(def('Stage'), outcome ? 'Decided' : 'To review');
        p.Direction = strFormula(def('Direction'), outcome ? 'Agent right' : 'Open');
        p['Applied tag'] = strFormula(def('Applied tag'), outcome === 'Applies' ? tagNames.join(', ') : null);
        p['Rejected tag'] = strFormula(def('Rejected tag'), outcome === 'Does not apply' ? tagNames.join(', ') : null);
        p['Tag name'] = {
          id: def('Tag name').id,
          type: 'rollup',
          rollup: { type: 'array', array: p.Tag.relation.map((r) => byId(r.id)).filter(Boolean).map((t) => ({ type: 'title', title: richText(titleOf(t)) })), function: 'show_original' },
        };
        p['Lesson status'] = {
          id: def('Lesson status').id,
          type: 'rollup',
          rollup: { type: 'array', array: p.Lesson.relation.map((r) => byId(r.id)).filter(Boolean).map((l) => ({ type: 'select', select: l.properties.Status.select })), function: 'show_original' },
        };
      }
      if (db === 'claims') {
        const rows = p['Tag decisions'].relation.map((r) => byId(r.id)).filter(Boolean);
        const pick = (name) => rows.map((r) => r.properties[name].formula.string).filter(Boolean).map((s) => ({ type: 'formula', formula: { type: 'string', string: s } }));
        p['Decided applies'] = { id: def('Decided applies').id, type: 'rollup', rollup: { type: 'array', array: pick('Applied tag'), function: 'show_original' } };
        p['Decided does not apply'] = { id: def('Decided does not apply').id, type: 'rollup', rollup: { type: 'array', array: pick('Rejected tag'), function: 'show_original' } };
      }
    }
  }

  // dual relations: the synced side always mirrors the side that was written
  function syncDuals(db, page, writtenNames) {
    for (const name of writtenNames) {
      const d = schemas[db].properties[name];
      if (d.type !== 'relation' || d.relation.type !== 'dual_property') continue;
      const targetDb = dbName(d.relation.database_id);
      const syncedName = d.relation.dual_property.synced_property_name;
      const mine = new Set(page.properties[name].relation.map((r) => normId(r.id)));
      for (const { db: tdb, page: tp } of pages.values()) {
        if (tdb !== targetDb) continue;
        const list = tp.properties[syncedName].relation;
        const has = list.some((r) => normId(r.id) === normId(page.id));
        if (mine.has(normId(tp.id)) && !has) list.push({ id: page.id });
        if (!mine.has(normId(tp.id)) && has) tp.properties[syncedName].relation = list.filter((r) => normId(r.id) !== normId(page.id));
      }
    }
  }

  function applyEncoded(db, page, encoded) {
    for (const [name, enc] of Object.entries(encoded)) {
      const def = schemas[db].properties[name];
      if (!def) throw new NotionError(`${name} is not a property that exists.`, { status: 400, code: 'validation_error' });
      if (['formula', 'rollup', 'created_time', 'unique_id'].includes(def.type)) throw new NotionError(`${name} is ${def.type} and cannot be set`, { status: 400, code: 'validation_error' });
      if (def.type === 'select' && enc.select && !def.select.options.some((o) => o.name === enc.select.name)) {
        // the real API would create the option; the allowlist is supposed to make this unreachable, so a test wants to see it
        state.createdOptions = [...(state.createdOptions ?? []), `${db}.${name}=${enc.select.name}`];
      }
      page.properties[name] = pageValue(def, enc);
    }
    syncDuals(db, page, Object.keys(encoded));
    page.last_edited_time = now().toISOString();
  }

  function build(db, id, createdAt) {
    const page = {
      object: 'page', id, created_time: createdAt, last_edited_time: createdAt,
      created_by: { object: 'user', id: 'bot-user' }, last_edited_by: { object: 'user', id: 'bot-user' }, cover: null, icon: null,
      parent: { type: 'database_id', database_id: config.notion.databases[db].database_id }, archived: false, in_trash: false,
      url: `https://www.notion.so/${id.replace(/-/g, '')}`, properties: {},
    };
    for (const [name, def] of Object.entries(schemas[db].properties)) page.properties[name] = emptyValue({ ...def, name }, now, db);
    return page;
  }

  // ---- direct controls for tests --------------------------------------------------------------------------------

  /** Insert an existing row from plain values (as if it had been there before). Returns the page id. */
  function add(db, plain, { id } = {}) {
    const pid = id ?? newId(db);
    const page = build(db, pid, now().toISOString());
    pages.set(normId(pid), { db, page });
    if (db === 'rule_changes') page.properties['Lesson ID'].unique_id.number = ++unique.rule_changes;
    applyEncoded(db, page, encodeProperties(plain, schemas[db]));
    recompute();
    return pid;
  }

  /** A person edits fields (plain values, any field, including editor-owned ones). Not logged as a script write. */
  function editorSet(pageId, plain) {
    const { db, page } = entry(pageId);
    applyEncoded(db, page, encodeProperties(plain, schemas[db]));
    page.last_edited_by = { object: 'user', id: 'a-person' };
    recompute();
  }

  const failNext = (method, error, { times = 1, match = null } = {}) => failures.push({ method, error, times, match });
  const snapshotPage = (e) => structuredClone(e.page);

  /** A page with relations cut at 25 references, the way the real API returns them. */
  function view(e) {
    const page = structuredClone(e.page);
    for (const v of Object.values(page.properties)) {
      if (v.type === 'relation' && v.relation.length > MAX_INLINE_RELATIONS) {
        v.relation = v.relation.slice(0, MAX_INLINE_RELATIONS);
        v.has_more = true;
      }
    }
    return page;
  }

  const rowsOf = (db) => [...pages.values()].filter((e) => e.db === db);
  const decodeRow = (e) => decodePage(e.page, schemas[e.db]);

  const client = {
    async *queryDatabase(databaseId) {
      const db = dbName(databaseId);
      requests.push({ method: 'queryAll', db });
      maybeFail('queryAll', { db });
      for (const e of rowsOf(db)) yield view(e);
    },
    async queryAll(databaseId) {
      const db = dbName(databaseId);
      requests.push({ method: 'queryAll', db });
      maybeFail('queryAll', { db });
      return rowsOf(db).map(view);
    },
    async retrieveDatabase(databaseId) {
      const db = dbName(databaseId);
      requests.push({ method: 'retrieveDatabase', db });
      maybeFail('retrieveDatabase', { db });
      return structuredClone(schemas[db]);
    },
    async retrievePage(pageId) {
      requests.push({ method: 'retrievePage', pageId });
      return view(entry(pageId));
    },
    async retrievePropertyItem(pageId, propertyId) {
      requests.push({ method: 'retrievePropertyItem', pageId, propertyId });
      const { page } = entry(pageId);
      const v = Object.values(page.properties).find((x) => x.id === propertyId);
      if (!v) throw new NotionError('property not found', { status: 404, code: 'object_not_found' });
      if (v.type === 'relation') return v.relation.map((r) => ({ object: 'property_item', id: `item-${r.id}`, type: 'relation', relation: { id: r.id } }));
      return [{ object: 'property_item', id: v.id, ...v }];
    },
    async createPage({ parentDatabaseId, properties, children = [] }) {
      const db = dbName(parentDatabaseId);
      const info = { db, properties, children };
      requests.push({ method: 'createPage', ...info });
      maybeFail('createPage', info);
      const id = newId(db);
      const page = build(db, id, now().toISOString());
      if (db === 'rule_changes') page.properties['Lesson ID'].unique_id.number = ++unique.rule_changes;
      applyEncoded(db, page, properties);
      pages.set(normId(id), { db, page });
      if (children.length) blocks.set(id, [...children]);
      recompute();
      state.onWrite?.({ method: 'createPage', db, pageId: id });
      return snapshotPage(pages.get(normId(id)));
    },
    async updatePage(pageId, { properties }) {
      const e = entry(pageId);
      const info = { db: e.db, pageId, properties };
      requests.push({ method: 'updatePage', ...info });
      maybeFail('updatePage', info);
      applyEncoded(e.db, e.page, properties);
      recompute();
      state.onWrite?.({ method: 'updatePage', db: e.db, pageId });
      return snapshotPage(e);
    },
    async appendBlocks(blockId, children) {
      requests.push({ method: 'appendBlocks', blockId, children });
      maybeFail('appendBlocks', { blockId });
      blocks.set(blockId, [...(blocks.get(blockId) ?? []), ...children]);
      return children.map((c, i) => ({ object: 'block', id: `block-${blockId}-${i}`, ...c }));
    },
  };

  // The same store behind the HTTP surface of the API, for tests that go through lib/notion-rest.mjs: fetch(url, init) -> Response.
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const httpError = (e) => json(e.status ?? 500, { object: 'error', status: e.status ?? 500, code: e.code ?? 'internal_server_error', message: e.message });
  const seenHeaders = [];
  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const headers = init.headers ?? {};
    seenHeaders.push(headers);
    const bearer = headers.Authorization ?? '';
    if (!bearer.startsWith('Bearer ') || bearer.length < 12) return json(401, { object: 'error', status: 401, code: 'unauthorized', message: 'API token is invalid.' });
    if (!headers['Notion-Version']) return json(400, { object: 'error', status: 400, code: 'missing_version', message: 'Notion-Version header failed validation' });
    const body = init.body ? JSON.parse(init.body) : {};
    const [version, ...route] = u.pathname.split('/').filter(Boolean);
    const take = (list, size, cursor) => {
      const from = cursor ? Number(cursor) : 0;
      const slice = list.slice(from, from + size);
      return { object: 'list', results: slice, has_more: from + size < list.length, next_cursor: from + size < list.length ? String(from + size) : null };
    };
    const [kind, id, sub, subId] = route;
    try {
      if (version !== 'v1') throw new NotionError('Invalid request URL', { status: 404, code: 'invalid_request_url' });
      if (method === 'POST' && kind === 'databases' && sub === 'query') return json(200, take(await client.queryAll(id), body.page_size ?? 100, body.start_cursor));
      if (method === 'GET' && kind === 'databases' && !sub) return json(200, await client.retrieveDatabase(id));
      if (method === 'GET' && kind === 'pages' && sub === 'properties') {
        const items = await client.retrievePropertyItem(id, subId);
        return json(200, { ...take(items, Number(u.searchParams.get('page_size') ?? 100), u.searchParams.get('start_cursor')), type: 'property_item' });
      }
      if (method === 'GET' && kind === 'pages' && !sub) return json(200, await client.retrievePage(id));
      if (method === 'POST' && kind === 'pages' && !id) return json(200, await client.createPage({ parentDatabaseId: body.parent?.database_id, properties: body.properties, children: body.children ?? [] }));
      if (method === 'PATCH' && kind === 'pages' && !sub) return json(200, await client.updatePage(id, { properties: body.properties }));
      if (method === 'PATCH' && kind === 'blocks' && sub === 'children') return json(200, { object: 'list', results: await client.appendBlocks(id, body.children) });
      throw new NotionError(`Invalid request URL: ${method} ${u.pathname}`, { status: 404, code: 'invalid_request_url' });
    } catch (e) {
      return httpError(e);
    }
  }

  return {
    client,
    fetch: fetchImpl,
    seenHeaders,
    schemas,
    config,
    add,
    editorSet,
    failNext,
    requests,
    blocks,
    /** Script writes only: createPage, updatePage and appendBlocks calls, in order. */
    writes: () => requests.filter((r) => ['createPage', 'updatePage', 'appendBlocks'].includes(r.method)),
    /** Decoded rows of a database: [{ page_id, props, ... }]. */
    rows: (db) => rowsOf(db).map(decodeRow),
    /** One decoded row by its key property value. */
    find: (db, key) => rowsOf(db).map(decodeRow).find((r) => r.props[config.notion.databases[db].key] === key) ?? null,
    get: (pageId) => decodeRow(entry(pageId)),
    raw: (pageId) => structuredClone(entry(pageId).page),
    count: (db) => rowsOf(db).length,
    set onWrite(fn) { state.onWrite = fn; },
    get createdOptions() { return state.createdOptions ?? []; },
  };
}
