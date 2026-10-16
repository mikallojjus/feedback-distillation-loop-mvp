// An in-memory Notion for the tests of the claim-tagger-mvp agent: the REST API behind a fetchImpl(url, init) for https://api.notion.com/v1/...,
// so the real client (scripts/lib/notion-rest.mjs) runs against it with its pacing, retries and create-never-twice logic. Built fresh for the
// shapes the MVP client sends; it shares no code with the old fake and imports nothing from the agent.
//
//   const fake = createFakeNotion({ token = 'ntn_test_token_0000', protected: [ids], now })
//   fake.token                        the one bearer token the fake accepts (any other: 401)
//   fake.fetchImpl(url, init)         the HTTP surface: pass it to createClient({ token: fake.token, fetchImpl: fake.fetchImpl })
//   fake.requests                     every request, in order: { method, path, status, body, version } (path is what follows /v1, query string included)
//   fake.writes()                     the requests that are not reads: everything but GET and the POST .../query calls (failed attempts included)
//   fake.addDatabase({ id, dataSourceId, parentPageId, title, properties })  -> { database_id, data_source_id }; properties are REST property configs
//   fake.addPage({ parentPageId, title })        -> page_id        (a child page; no request is logged)
//   fake.addRow(databaseId, plain)               -> page_id        (a row from plain values, encoded by the schema; no request is logged)
//   fake.editRow(pageId, plain)                  an editor changes values (editor-owned columns included): last_edited_by becomes the editor; not logged
//   fake.rows(databaseId) / fake.plainRows(databaseId) / fake.page(id) / fake.database(id) / fake.dataSource(id) / fake.children(id) / fake.views(databaseId)
//   fake.failNext(method, pathRegex, status, times = 1, { code, message, headers, applied })   answer the next matching requests with an error
//   fake.protect(id) / fake.pendingFailures() / fake.createdOptions
//
// Routes (GET, POST and PATCH only; nothing is ever deleted or archived, an attempt is a 400, any other method a 404):
//   GET /pages/{id}  POST /pages  PATCH /pages/{id}  GET /pages/{id}/properties/{property}
//   GET /databases/{id}  POST /databases  POST /databases/{id}/query  GET /databases/{id}/views
//   GET /data_sources/{id}  POST /data_sources/{id}/query  PATCH /data_sources/{id}
//   POST /views  GET /views?database_id=  GET /views/{id}  PATCH /views/{id} (name, filter, sorts, configuration)
//   GET /blocks/{id}/children  PATCH /blocks/{id}/children
// Checks: Authorization (401 unauthorized), Notion-Version (400 missing_version; an unknown version 400 validation_error), ids that do not
// exist or are protected (404 object_not_found; an id of the wrong kind 400), properties that do not exist or do not fit their type (400
// validation_error), text objects over 2,000 characters and more than 100 blocks per request (400), the minimum version of the data source,
// database-create and view routes (400). Query paging uses the cursor as an offset; filters (and/or, text, number, checkbox, select,
// multi_select, date, relation, timestamps) and sorts are evaluated. Not simulated: dual relations stay one-sided, formulas and rollups do not
// exist, rate limits come only from failNext.

export const DEFAULT_TOKEN = 'ntn_test_token_0000';
const API_ORIGIN = 'https://api.notion.com';
const KNOWN_VERSIONS = ['2021-05-13', '2021-05-31', '2021-08-16', '2022-02-22', '2022-06-28', '2025-09-03', '2026-03-11'];
const DATA_SOURCE_VERSION = '2025-09-03';
const VIEW_VERSION = '2026-03-11';
const OLD_VERSION = '2022-06-28';
const MAX_TEXT = 2000;
const MAX_BLOCKS = 100;
const MAX_RICH_TEXT_ITEMS = 100;
const BOT = '0b070000-0000-4000-8000-000000000001';
const EDITOR = '0ed10000-0000-4000-8000-000000000002';
const SUPPORTED_TYPES = ['title', 'rich_text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'relation', 'created_time', 'last_edited_time', 'unique_id'];
const READ_ONLY_TYPES = ['created_time', 'last_edited_time', 'unique_id'];
const VIEW_TYPES = ['table', 'board', 'list', 'calendar', 'timeline', 'gallery', 'form', 'chart', 'map', 'dashboard'];
const BLOCK_TYPES = [
  'paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout', 'code',
  'divider', 'table', 'table_row', 'column_list', 'column', 'bookmark', 'embed', 'link_to_page', 'image', 'file', 'pdf', 'video', 'audio', 'equation',
  'breadcrumb', 'table_of_contents', 'link_preview', 'synced_block',
];
const STATUS_TEXT = { 200: 'OK', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' };
const CODE_OF_STATUS = {
  400: 'validation_error', 401: 'unauthorized', 403: 'restricted_resource', 404: 'object_not_found', 409: 'conflict_error', 429: 'rate_limited',
  500: 'internal_server_error', 502: 'bad_gateway', 503: 'service_unavailable', 504: 'gateway_timeout',
};

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const normId = (id) => String(id ?? '').replace(/-/g, '').toLowerCase();
const clone = (v) => structuredClone(v);

/** 32 hex digits (dashes optional) become the 8-4-4-4-12 form the API answers with; any other string is kept as given. */
function canonicalId(id) {
  const n = normId(id);
  return /^[0-9a-f]{32}$/.test(n) ? `${n.slice(0, 8)}-${n.slice(8, 12)}-${n.slice(12, 16)}-${n.slice(16, 20)}-${n.slice(20)}` : String(id);
}

class HttpError extends Error {
  constructor(status, code, message, { headers = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}
const validation = (message) => new HttpError(400, 'validation_error', message);
const notFound = (what, id) => new HttpError(404, 'object_not_found', `Could not find ${what} with ID: ${id}. Make sure the relevant pages and databases are shared with your integration.`);

const versionAtLeast = (version, min) => version >= min;

// ---- paging ----------------------------------------------------------------------------------------------------------------------------

function pageOf(list, size, cursor) {
  const n = size === undefined || size === null || size === '' ? 100 : Number(size);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw validation('page_size should be an integer between 1 and 100.');
  const start = cursor === undefined || cursor === null || cursor === '' ? 0 : Number(cursor);
  if (!Number.isInteger(start) || start < 0 || start > list.length) throw validation('start_cursor provided is invalid.');
  const end = Math.min(list.length, start + n);
  return { results: list.slice(start, end), has_more: end < list.length, next_cursor: end < list.length ? String(end) : null };
}

// ---- text ------------------------------------------------------------------------------------------------------------------------------

const annotations = () => ({ bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' });

/** Rich text from a write: checked (text objects only, 2,000 characters each, 100 objects) and filled out the way the API echoes it. */
function richTextIn(items, where) {
  if (!Array.isArray(items)) throw validation(`${where} should be an array, instead was ${JSON.stringify(items)}.`);
  if (items.length > MAX_RICH_TEXT_ITEMS) throw validation(`${where}.length should be ≤ \`${MAX_RICH_TEXT_ITEMS}\`, instead was \`${items.length}\`.`);
  return items.map((item, i) => {
    const at = `${where}[${i}]`;
    if (!isPlain(item)) throw validation(`${at} should be an object.`);
    if ((item.type ?? 'text') !== 'text' || !isPlain(item.text)) throw validation(`${at}: this fake supports text objects only.`);
    const { content, link } = item.text;
    if (typeof content !== 'string') throw validation(`${at}.text.content should be a string, instead was ${JSON.stringify(content)}.`);
    if (content.length > MAX_TEXT) throw validation(`${at}.text.content.length should be ≤ \`${MAX_TEXT}\`, instead was \`${content.length}\`.`);
    return {
      type: 'text',
      text: { content, link: link ?? null },
      annotations: { ...annotations(), ...(isPlain(item.annotations) ? item.annotations : {}) },
      plain_text: content,
      href: link?.url ?? null,
    };
  });
}

const plainText = (items) => (items ?? []).map((x) => x.plain_text ?? x.text?.content ?? '').join('');
const textItems = (s) => (s === null || s === undefined || s === '' ? [] : richTextIn(s.length > MAX_TEXT ? chunk(s) : [{ type: 'text', text: { content: s } }], 'text'));
function chunk(s) {
  const out = [];
  for (let i = 0; i < s.length; i += MAX_TEXT) out.push({ type: 'text', text: { content: s.slice(i, i + MAX_TEXT) } });
  return out;
}

// ---- the fake --------------------------------------------------------------------------------------------------------------------------

export function createFakeNotion({ token = DEFAULT_TOKEN, protected: protectedIds = [], now = null } = {}) {
  let counter = 0;
  let clock = 0;
  const KIND = { page: '0a9e', database: '0db0', data_source: '0d50', block: '0b10', view: '0e10' };
  const nextId = (kind) => `${KIND[kind]}0000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}`;
  const nextShort = (prefix) => `${prefix}${(++counter).toString(36)}`;
  const stamp = () => {
    if (now) {
      const v = typeof now === 'function' ? now() : now;
      return (v instanceof Date ? v : new Date(v)).toISOString();
    }
    return new Date(Date.UTC(2026, 9, 15, 9, 0, 0) + 1000 * clock++).toISOString();
  };

  const databases = new Map(); // normalised id -> record
  const dataSources = new Map();
  const pages = new Map(); // rows and child pages
  const blocks = new Map();
  const childrenOf = new Map(); // normalised parent id -> [block ids]
  const views = new Map();
  const viewsOfDatabase = new Map(); // normalised database id -> [view ids]
  const requests = [];
  const failures = [];
  const hidden = new Set(protectedIds.map(normId));
  const createdOptions = [];
  let version = OLD_VERSION; // the Notion-Version of the request being served; the test helpers read as the old version

  // ---- lookups: hidden (protected) records do not exist ----------------------------------------------------------------------------

  const parentIdOf = (parent) => parent?.page_id ?? parent?.database_id ?? parent?.data_source_id ?? parent?.block_id ?? null;
  function isHidden(record) {
    if (hidden.has(normId(record.id))) return true;
    let parent = record.parent;
    for (let depth = 0; parent && depth < 20; depth++) {
      const id = parentIdOf(parent);
      if (!id) return false;
      const key = normId(id);
      if (hidden.has(key)) return true;
      const above = pages.get(key) ?? databases.get(key) ?? dataSources.get(key) ?? blocks.get(key);
      parent = above?.parent;
    }
    return false;
  }
  const kindOf = (id) => {
    const key = normId(id);
    if (pages.has(key)) return 'a page';
    if (databases.has(key)) return 'a database';
    if (dataSources.has(key)) return 'a data source';
    if (blocks.has(key)) return 'a block';
    if (views.has(key)) return 'a view';
    return null;
  };
  function lookup(map, id, what, article) {
    const record = map.get(normId(id));
    if (record && !isHidden(record)) return record;
    const other = !record && kindOf(id);
    if (other && !isHidden((pages.get(normId(id)) ?? databases.get(normId(id)) ?? dataSources.get(normId(id)) ?? blocks.get(normId(id)) ?? views.get(normId(id))))) {
      throw validation(`Provided ID ${id} is ${other}, not ${article}.${what === 'data source' ? ' Use the database endpoints for a database id.' : ''}`);
    }
    throw notFound(what, id);
  }
  const getPage = (id) => lookup(pages, id, 'page', 'a page');
  const getDatabase = (id) => lookup(databases, id, 'database', 'a database');
  const getDataSource = (id) => lookup(dataSources, id, 'data source', 'a data source');
  const getView = (id) => lookup(views, id, 'view', 'a view');
  const getBlockParent = (id) => {
    const key = normId(id);
    const record = pages.get(key) ?? blocks.get(key);
    if (record && !isHidden(record)) return record;
    throw notFound('block', id);
  };

  // ---- schema ----------------------------------------------------------------------------------------------------------------------

  const optionOf = (o, at) => {
    if (!isPlain(o) || typeof o.name !== 'string' || o.name.trim() === '') throw validation(`${at}.name should be a non-empty string.`);
    if (o.name.includes(',')) throw validation(`${at}.name cannot contain commas.`);
    return { id: nextShort('o'), name: o.name, color: o.color ?? 'default', ...(o.description ? { description: o.description } : {}) };
  };

  function schemaProperty(name, config) {
    const at = `initial_data_source.properties.${name}`;
    if (!isPlain(config)) throw validation(`${at} should be an object.`);
    const type = config.type ?? SUPPORTED_TYPES.find((t) => t in config);
    if (!SUPPORTED_TYPES.includes(type)) throw validation(`${at}: the property type ${JSON.stringify(type)} is not supported by this fake.`);
    const body = config[type] ?? {};
    if (!isPlain(body)) throw validation(`${at}.${type} should be an object.`);
    const def = { id: type === 'title' ? 'title' : nextShort('p'), name, type };
    if (config.description) def.description = config.description;
    switch (type) {
      case 'select':
      case 'multi_select':
        def[type] = { options: (body.options ?? []).map((o, i) => optionOf(o, `${at}.${type}.options[${i}]`)) };
        break;
      case 'number':
        def.number = { format: body.format ?? 'number' };
        break;
      case 'unique_id':
        def.unique_id = { prefix: body.prefix ?? null };
        break;
      case 'relation': {
        const target = dataSources.get(normId(body.data_source_id ?? body.database_id));
        if (!target || isHidden(target)) throw notFound('data source', body.data_source_id ?? body.database_id);
        const dual = 'dual_property' in body;
        def.relation = { database_id: target.parent.database_id, data_source_id: target.id, type: dual ? 'dual_property' : 'single_property', [dual ? 'dual_property' : 'single_property']: {} };
        break;
      }
      default:
        def[type] = {};
    }
    return def;
  }

  function newSchema(propertyConfigs, where) {
    if (!isPlain(propertyConfigs)) throw validation(`${where} should be an object of property configs.`);
    const schema = {};
    for (const [name, config] of Object.entries(propertyConfigs)) schema[name] = schemaProperty(name, config);
    const titles = Object.values(schema).filter((d) => d.type === 'title');
    if (titles.length !== 1) throw validation(`${where} needs exactly one title property, found ${titles.length}.`);
    return schema;
  }

  const propertyOf = (ds, nameOrId) => {
    const wanted = decodeURIComponentSafe(String(nameOrId));
    return Object.values(ds.properties).find((d) => d.name === wanted || d.id === wanted || d.id === nameOrId) ?? null;
  };

  function makeDatabase({ id, dataSourceId, parent, title, description, isInline, icon, properties }) {
    const created = stamp();
    const dbId = id ? canonicalId(id) : nextId('database');
    const dsId = dataSourceId ? canonicalId(dataSourceId) : nextId('data_source');
    const name = plainText(title);
    const schema = properties;
    databases.set(normId(dbId), {
      id: dbId, parent, title, description: description ?? [], is_inline: isInline, icon: icon ?? null, created_time: created, last_edited_time: created, dsId,
    });
    dataSources.set(normId(dsId), {
      id: dsId, parent: { type: 'database_id', database_id: dbId }, name, title: clone(title), properties: schema, created_time: created, last_edited_time: created, rows: [],
    });
    return { database_id: dbId, data_source_id: dsId };
  }

  // ---- values ----------------------------------------------------------------------------------------------------------------------

  const emptyValue = (def) => {
    switch (def.type) {
      case 'title':
      case 'rich_text': return { id: def.id, type: def.type, [def.type]: [] };
      case 'multi_select': return { id: def.id, type: def.type, multi_select: [] };
      case 'checkbox': return { id: def.id, type: 'checkbox', checkbox: false };
      case 'relation': return { id: def.id, type: 'relation', relation: [], has_more: false };
      default: return { id: def.id, type: def.type, [def.type]: null };
    }
  };

  function optionByName(ds, def, name) {
    const options = def[def.type].options;
    let option = options.find((o) => o.name === name);
    if (!option) {
      option = optionOf({ name }, `body.properties.${def.name}.${def.type}`);
      options.push(option);
      createdOptions.push(`${ds.name}.${def.name}=${name}`);
    }
    return { id: option.id, name: option.name, color: option.color };
  }

  function optionRef(ds, def, ref, at) {
    if (!isPlain(ref)) throw validation(`${at} should be an object with a name or an id.`);
    if (typeof ref.name === 'string') {
      if (ref.name.includes(',')) throw validation(`${at}.name cannot contain commas.`);
      return optionByName(ds, def, ref.name);
    }
    const option = def[def.type].options.find((o) => o.id === ref.id);
    if (!option) throw validation(`${at}.id ${JSON.stringify(ref.id)} is not an option of ${def.name}.`);
    return { id: option.id, name: option.name, color: option.color };
  }

  /** A property value from a write, checked against the property's type: the value as the API would store and echo it. */
  function coerce(ds, def, value) {
    const at = `body.properties.${def.name}`;
    if (!isPlain(value)) throw validation(`${at} should be an object, instead was ${JSON.stringify(value)}.`);
    if (READ_ONLY_TYPES.includes(def.type)) throw validation(`${at}: a ${def.type} property cannot be set.`);
    if (value.type !== undefined && value.type !== def.type) throw validation(`${at}.type should be "${def.type}", instead was "${value.type}".`);
    if (!(def.type in value)) throw validation(`${at} should hold a ${def.type} value, found ${Object.keys(value).join(', ') || 'nothing'}.`);
    const extra = Object.keys(value).filter((k) => !['id', 'type', def.type].includes(k));
    if (extra.length) throw validation(`${at}.${extra[0]} should not be present for a ${def.type} property.`);
    const v = value[def.type];
    const out = { id: def.id, type: def.type };
    switch (def.type) {
      case 'title':
      case 'rich_text':
        out[def.type] = richTextIn(v, `${at}.${def.type}`);
        break;
      case 'number':
        if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) throw validation(`${at}.number should be a number or null, instead was ${JSON.stringify(v)}.`);
        out.number = v;
        break;
      case 'checkbox':
        if (typeof v !== 'boolean') throw validation(`${at}.checkbox should be a boolean, instead was ${JSON.stringify(v)}.`);
        out.checkbox = v;
        break;
      case 'url':
        if (v !== null && (typeof v !== 'string' || v.length > MAX_TEXT)) throw validation(`${at}.url should be a string of at most ${MAX_TEXT} characters or null.`);
        out.url = v === '' ? null : v;
        break;
      case 'select':
        out.select = v === null ? null : optionRef(ds, def, v, `${at}.select`);
        break;
      case 'multi_select':
        if (!Array.isArray(v)) throw validation(`${at}.multi_select should be an array.`);
        out.multi_select = v.map((o, i) => optionRef(ds, def, o, `${at}.multi_select[${i}]`));
        break;
      case 'date': {
        if (v === null) {
          out.date = null;
          break;
        }
        const ok = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}(T.+)?$/.test(s) && !Number.isNaN(Date.parse(s));
        if (!isPlain(v) || !ok(v.start) || (v.end !== undefined && v.end !== null && !ok(v.end))) throw validation(`${at}.date should be null or { start, end? } with ISO 8601 dates.`);
        out.date = { start: v.start, end: v.end ?? null, time_zone: v.time_zone ?? null };
        break;
      }
      case 'relation':
        if (!Array.isArray(v)) throw validation(`${at}.relation should be an array.`);
        out.relation = v.map((r, i) => {
          if (!isPlain(r) || typeof r.id !== 'string') throw validation(`${at}.relation[${i}].id should be a page id.`);
          const page = pages.get(normId(r.id));
          if (!page || isHidden(page)) throw validation(`${at}.relation[${i}]: could not find page with ID: ${r.id}.`);
          return { id: page.id };
        });
        out.has_more = false;
        break;
      default:
        throw validation(`${at}: unsupported property type ${def.type}.`);
    }
    return out;
  }

  function writeProperties(rec, ds, properties) {
    if (!isPlain(properties)) throw validation('body.properties should be an object.');
    // all or nothing: a bad value anywhere in the request changes nothing, and that includes the select options an earlier value would have created
    const schemaBefore = clone(ds.properties);
    const optionsBefore = createdOptions.length;
    try {
      const staged = {};
      for (const [key, value] of Object.entries(properties)) {
        const def = propertyOf(ds, key);
        if (!def) throw validation(`${key} is not a property that exists.`);
        staged[def.name] = coerce(ds, def, value);
      }
      Object.assign(rec.props, staged);
    } catch (e) {
      ds.properties = schemaBefore;
      createdOptions.length = optionsBefore;
      throw e;
    }
  }

  function propertiesOf(rec, ds) {
    const out = {};
    for (const def of Object.values(ds.properties)) {
      switch (def.type) {
        case 'created_time': out[def.name] = { id: def.id, type: 'created_time', created_time: rec.created_time }; break;
        case 'last_edited_time': out[def.name] = { id: def.id, type: 'last_edited_time', last_edited_time: rec.last_edited_time }; break;
        case 'unique_id': out[def.name] = { id: def.id, type: 'unique_id', unique_id: { prefix: def.unique_id.prefix, number: rec.unique?.[def.name] ?? null } }; break;
        default: out[def.name] = clone(rec.props[def.name] ?? emptyValue(def));
      }
    }
    return out;
  }

  function assignUnique(ds, rec) {
    for (const def of Object.values(ds.properties)) {
      if (def.type !== 'unique_id') continue;
      const used = ds.rows.map((id) => pages.get(normId(id))?.unique?.[def.name] ?? 0);
      rec.unique = { ...(rec.unique ?? {}), [def.name]: Math.max(0, ...used) + 1 };
    }
  }

  const urlOf = (id) => `https://www.notion.so/${normId(id)}`;

  function pageObject(rec) {
    const base = {
      object: 'page', id: rec.id, created_time: rec.created_time, last_edited_time: rec.last_edited_time,
      created_by: { object: 'user', id: rec.created_by }, last_edited_by: { object: 'user', id: rec.last_edited_by },
      cover: null, icon: rec.icon ?? null, parent: null, archived: false, in_trash: false, is_locked: false, properties: null, url: urlOf(rec.id), public_url: null,
    };
    if (rec.dsId) {
      const ds = dataSources.get(normId(rec.dsId));
      base.parent = versionAtLeast(version, DATA_SOURCE_VERSION)
        ? { type: 'data_source_id', data_source_id: ds.id, database_id: ds.parent.database_id }
        : { type: 'database_id', database_id: ds.parent.database_id };
      base.properties = propertiesOf(rec, ds);
    } else {
      base.parent = clone(rec.parent);
      base.properties = clone(rec.props);
    }
    return base;
  }

  function databaseObject(db) {
    const ds = dataSources.get(normId(db.dsId));
    const out = {
      object: 'database', id: db.id, created_time: db.created_time, last_edited_time: db.last_edited_time,
      created_by: { object: 'user', id: BOT }, last_edited_by: { object: 'user', id: BOT },
      title: clone(db.title), description: clone(db.description), icon: db.icon, cover: null, parent: clone(db.parent), url: urlOf(db.id), is_inline: db.is_inline,
      archived: false, in_trash: false, public_url: null, data_sources: [{ id: ds.id, name: ds.name }],
    };
    if (!versionAtLeast(version, DATA_SOURCE_VERSION)) out.properties = clone(ds.properties);
    return out;
  }

  function dataSourceObject(ds) {
    const db = databases.get(normId(ds.parent.database_id));
    return {
      object: 'data_source', id: ds.id, created_time: ds.created_time, last_edited_time: ds.last_edited_time,
      created_by: { object: 'user', id: BOT }, last_edited_by: { object: 'user', id: BOT },
      title: clone(ds.title), description: [], icon: null, parent: clone(ds.parent), database_parent: clone(db.parent), properties: clone(ds.properties),
      archived: false, in_trash: false, url: urlOf(ds.id),
    };
  }

  // ---- blocks ----------------------------------------------------------------------------------------------------------------------

  function richTextInBlock(payload, where) {
    if (payload.rich_text !== undefined) payload.rich_text = richTextIn(payload.rich_text, `${where}.rich_text`);
    if (Array.isArray(payload.cells)) payload.cells = payload.cells.map((cell, i) => richTextIn(cell, `${where}.cells[${i}]`));
    if (Array.isArray(payload.caption)) payload.caption = richTextIn(payload.caption, `${where}.caption`);
  }

  /** Check blocks, nested ones included, without storing anything: a tree of { type, payload, nested } ready for commitBlocks. */
  function prepareBlocks(children, where, depth = 0) {
    if (!Array.isArray(children)) throw validation(`${where} should be an array.`);
    if (children.length > MAX_BLOCKS) throw validation(`${where}.length should be ≤ \`${MAX_BLOCKS}\`, instead was \`${children.length}\`.`);
    if (depth > 1) throw validation(`${where}: blocks can be nested two levels deep in one request.`);
    return children.map((child, i) => {
      const at = `${where}[${i}]`;
      if (!isPlain(child) || typeof child.type !== 'string') throw validation(`${at}.type should be a block type.`);
      if (!BLOCK_TYPES.includes(child.type)) throw validation(`${at}.type: ${JSON.stringify(child.type)} is not a block type this fake can create.`);
      if (!isPlain(child[child.type])) throw validation(`${at}.${child.type} should be an object.`);
      const payload = clone(child[child.type]);
      const nested = payload.children;
      delete payload.children;
      richTextInBlock(payload, `${at}.${child.type}`);
      return { type: child.type, payload, nested: nested === undefined ? undefined : prepareBlocks(nested, `${at}.${child.type}.children`, depth + 1) };
    });
  }

  /** Store prepared blocks under a parent (after one of its children when asked); nested blocks become children of their block. Returns the new ids. */
  function commitBlocks(prepared, parentRecord, { after = null } = {}) {
    const parentKey = normId(parentRecord.id);
    const parentRef = pages.has(parentKey) ? { type: 'page_id', page_id: parentRecord.id } : { type: 'block_id', block_id: parentRecord.id };
    const created = prepared.map((p) => {
      const created_time = stamp();
      const record = { id: nextId('block'), parent: clone(parentRef), created_time, last_edited_time: created_time, type: p.type, payload: p.payload };
      blocks.set(normId(record.id), record);
      return { record, p };
    });
    const siblings = childrenOf.get(parentKey) ?? [];
    siblings.splice(after === null ? siblings.length : siblings.indexOf(after) + 1, 0, ...created.map((c) => c.record.id));
    childrenOf.set(parentKey, siblings);
    for (const { record, p } of created) if (p.nested !== undefined) commitBlocks(p.nested, record);
    return created.map((c) => c.record.id);
  }

  /** Check and store blocks under a parent in one go: when any block is bad, nothing is stored. */
  const storeBlocks = (children, parentRecord, where, { after = null } = {}) => commitBlocks(prepareBlocks(children, where), parentRecord, { after });

  const blockObject = (record) => ({
    object: 'block', id: record.id, parent: clone(record.parent), created_time: record.created_time, last_edited_time: record.last_edited_time,
    created_by: { object: 'user', id: BOT }, last_edited_by: { object: 'user', id: BOT }, has_children: (childrenOf.get(normId(record.id)) ?? []).length > 0,
    archived: false, in_trash: false, type: record.type, [record.type]: clone(record.payload),
  });

  // ---- filters and sorts -----------------------------------------------------------------------------------------------------------

  const TEXT_OPS = ['equals', 'does_not_equal', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'];
  const DATE_OPS = ['equals', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty'];
  const FILTER_OPS = {
    title: TEXT_OPS, rich_text: TEXT_OPS, url: TEXT_OPS,
    number: ['equals', 'does_not_equal', 'greater_than', 'less_than', 'greater_than_or_equal_to', 'less_than_or_equal_to', 'is_empty', 'is_not_empty'],
    checkbox: ['equals', 'does_not_equal'],
    select: ['equals', 'does_not_equal', 'is_empty', 'is_not_empty'],
    multi_select: ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
    date: DATE_OPS, created_time: DATE_OPS, last_edited_time: DATE_OPS,
    relation: ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'],
  };

  function checkFilter(ds, filter, where) {
    if (!isPlain(filter)) throw validation(`${where} should be an object.`);
    const keys = Object.keys(filter);
    if (keys.length === 1 && (keys[0] === 'and' || keys[0] === 'or')) {
      if (!Array.isArray(filter[keys[0]]) || filter[keys[0]].length === 0) throw validation(`${where}.${keys[0]} should be a non-empty array of filters.`);
      filter[keys[0]].forEach((f, i) => checkFilter(ds, f, `${where}.${keys[0]}[${i}]`));
      return;
    }
    let type;
    if ('timestamp' in filter) {
      type = filter.timestamp;
      if (type !== 'created_time' && type !== 'last_edited_time') throw validation(`${where}.timestamp should be created_time or last_edited_time.`);
    } else {
      if (typeof filter.property !== 'string') throw validation(`${where}.property should be a property name or id.`);
      const def = propertyOf(ds, filter.property);
      if (!def) throw validation(`${where}: could not find property with name or id: ${filter.property}.`);
      type = def.type;
    }
    if (!FILTER_OPS[type]) throw validation(`${where}: filters on ${type} properties are not supported by this fake.`);
    const rest = Object.keys(filter).filter((k) => k !== 'property' && k !== 'timestamp');
    if (rest.length !== 1 || rest[0] !== type) throw validation(`${where} should hold exactly one ${type} condition, found ${rest.join(', ') || 'none'}.`);
    const condition = filter[type];
    const ops = isPlain(condition) ? Object.keys(condition) : [];
    if (ops.length !== 1 || !FILTER_OPS[type].includes(ops[0])) throw validation(`${where}.${type} should hold exactly one of ${FILTER_OPS[type].join(', ')}.`);
    if ((ops[0] === 'is_empty' || ops[0] === 'is_not_empty') && condition[ops[0]] !== true) throw validation(`${where}.${type}.${ops[0]} should be true.`);
  }

  const lowerContains = (s, a) => s.toLowerCase().includes(String(a).toLowerCase());

  function evalCondition(type, value, condition) {
    const [op, arg] = Object.entries(condition)[0];
    const empty = (op === 'is_empty') ? true : (op === 'is_not_empty' ? false : null);
    switch (type) {
      case 'title':
      case 'rich_text':
      case 'url': {
        const s = type === 'url' ? value.url ?? '' : plainText(value[type]);
        if (empty !== null) return (s === '') === empty;
        return { equals: s === arg, does_not_equal: s !== arg, contains: lowerContains(s, arg), does_not_contain: !lowerContains(s, arg), starts_with: s.toLowerCase().startsWith(String(arg).toLowerCase()), ends_with: s.toLowerCase().endsWith(String(arg).toLowerCase()) }[op];
      }
      case 'number': {
        const n = value.number;
        if (empty !== null) return (n === null) === empty;
        if (n === null) return op === 'does_not_equal';
        return { equals: n === arg, does_not_equal: n !== arg, greater_than: n > arg, less_than: n < arg, greater_than_or_equal_to: n >= arg, less_than_or_equal_to: n <= arg }[op];
      }
      case 'checkbox':
        return op === 'equals' ? value.checkbox === arg : value.checkbox !== arg;
      case 'select': {
        const name = value.select?.name ?? null;
        if (empty !== null) return (name === null) === empty;
        const wanted = Array.isArray(arg) ? arg : [arg];
        return op === 'equals' ? wanted.includes(name) : !wanted.includes(name);
      }
      case 'multi_select': {
        const names = value.multi_select.map((o) => o.name);
        if (empty !== null) return (names.length === 0) === empty;
        return op === 'contains' ? names.includes(arg) : !names.includes(arg);
      }
      case 'relation': {
        const ids = value.relation.map((r) => normId(r.id));
        if (empty !== null) return (ids.length === 0) === empty;
        return op === 'contains' ? ids.includes(normId(arg)) : !ids.includes(normId(arg));
      }
      default: { // date, created_time, last_edited_time
        const start = type === 'date' ? value.date?.start ?? null : value[type];
        if (empty !== null) return (start === null) === empty;
        if (start === null) return false;
        const a = Date.parse(start);
        const b = Date.parse(arg);
        const day = (s) => s.slice(0, 10);
        return { equals: day(start) === day(arg), before: a < b, after: a > b, on_or_before: a <= b, on_or_after: a >= b }[op];
      }
    }
  }

  function matches(rec, ds, filter) {
    if ('and' in filter) return filter.and.every((f) => matches(rec, ds, f));
    if ('or' in filter) return filter.or.some((f) => matches(rec, ds, f));
    if ('timestamp' in filter) return evalCondition(filter.timestamp, { [filter.timestamp]: rec[filter.timestamp] }, filter[filter.timestamp]);
    const def = propertyOf(ds, filter.property);
    return evalCondition(def.type, propertiesOf(rec, ds)[def.name], filter[def.type]);
  }

  function sortKey(rec, ds, sort) {
    if (sort.timestamp) return rec[sort.timestamp];
    const def = propertyOf(ds, sort.property);
    const value = propertiesOf(rec, ds)[def.name];
    switch (def.type) {
      case 'title':
      case 'rich_text': return plainText(value[def.type]);
      case 'select': return value.select?.name ?? null;
      case 'multi_select': return value.multi_select.map((o) => o.name).join(',');
      case 'date': return value.date?.start ?? null;
      case 'unique_id': return value.unique_id.number;
      case 'relation': return value.relation.length;
      default: return value[def.type] ?? null;
    }
  }

  function sortRows(list, ds, sorts) {
    if (!Array.isArray(sorts)) throw validation('sorts should be an array.');
    for (const [i, s] of sorts.entries()) {
      if (!isPlain(s) || (s.direction !== 'ascending' && s.direction !== 'descending')) throw validation(`sorts[${i}].direction should be ascending or descending.`);
      if (s.timestamp ? (s.timestamp !== 'created_time' && s.timestamp !== 'last_edited_time') : !propertyOf(ds, s.property)) throw validation(`sorts[${i}] names a property or timestamp that does not exist.`);
    }
    const keyed = list.map((rec, index) => ({ rec, index, keys: sorts.map((s) => sortKey(rec, ds, s)) }));
    keyed.sort((x, y) => {
      for (const [i, s] of sorts.entries()) {
        const a = x.keys[i];
        const b = y.keys[i];
        if (a === b) continue;
        const dir = s.direction === 'descending' ? -1 : 1;
        if (a === null || a === undefined) return -dir;
        if (b === null || b === undefined) return dir;
        return (a < b ? -1 : 1) * dir;
      }
      return x.index - y.index;
    });
    return keyed.map((k) => k.rec);
  }

  // ---- views -----------------------------------------------------------------------------------------------------------------------

  const TABLE_ITEM_KEYS = ['property_id', 'visible', 'width', 'wrap', 'status_show_as', 'card_property_width_mode', 'date_format', 'time_format'];
  const TABLE_KEYS = ['type', 'properties', 'group_by', 'subtasks', 'wrap_cells', 'frozen_column_index', 'show_vertical_lines'];

  function checkConfiguration(ds, type, configuration) {
    if (!isPlain(configuration)) throw validation('configuration should be an object.');
    if (configuration.type !== type) throw validation(`configuration.type should be "${type}" to match the view type, instead was ${JSON.stringify(configuration.type)}.`);
    if (type !== 'table') return;
    const unknown = Object.keys(configuration).find((k) => !TABLE_KEYS.includes(k));
    if (unknown) throw validation(`configuration.${unknown} should not be present for a table view.`);
    const byId = (id) => Object.values(ds.properties).some((d) => d.id === id);
    if (configuration.properties !== undefined && configuration.properties !== null) {
      if (!Array.isArray(configuration.properties) || configuration.properties.length > 100) throw validation('configuration.properties should be an array of at most 100 items.');
      configuration.properties.forEach((item, i) => {
        const at = `configuration.properties[${i}]`;
        if (!isPlain(item) || typeof item.property_id !== 'string') throw validation(`${at}.property_id should be a property id.`);
        const bad = Object.keys(item).find((k) => !TABLE_ITEM_KEYS.includes(k));
        if (bad) throw validation(`${at}.${bad} should not be present.`);
        if (!byId(item.property_id)) throw validation(`${at}.property_id ${JSON.stringify(item.property_id)} is not the id of a property of the data source (names do not work here).`);
        for (const k of ['visible', 'wrap']) if (item[k] !== undefined && typeof item[k] !== 'boolean') throw validation(`${at}.${k} should be a boolean.`);
        if (item.width !== undefined && (!Number.isInteger(item.width) || item.width < 1)) throw validation(`${at}.width should be an integer of at least 1.`);
      });
    }
    if (configuration.group_by !== undefined && configuration.group_by !== null) {
      if (!isPlain(configuration.group_by) || !byId(configuration.group_by.property_id)) throw validation('configuration.group_by.property_id should be the id of a property of the data source.');
    }
    for (const k of ['wrap_cells', 'show_vertical_lines']) if (configuration[k] !== undefined && typeof configuration[k] !== 'boolean') throw validation(`configuration.${k} should be a boolean.`);
    if (configuration.frozen_column_index !== undefined && (!Number.isInteger(configuration.frozen_column_index) || configuration.frozen_column_index < 0)) throw validation('configuration.frozen_column_index should be an integer of at least 0.');
  }

  const viewObject = (v, { full }) => {
    const out = { object: 'view', id: v.id, parent: { type: 'database_id', database_id: v.database_id }, type: v.type, name: v.name };
    if (!full) return out;
    return {
      ...out, created_time: v.created_time, last_edited_time: v.last_edited_time, created_by: { object: 'user', id: BOT }, last_edited_by: { object: 'user', id: BOT },
      url: `${urlOf(v.database_id)}?v=${normId(v.id)}`, data_source_id: v.data_source_id, filter: clone(v.filter), sorts: clone(v.sorts), quick_filters: clone(v.quick_filters),
      configuration: clone(v.configuration),
    };
  };

  // ---- routes ----------------------------------------------------------------------------------------------------------------------

  const requireVersion = (min, what) => {
    if (!versionAtLeast(version, min)) throw validation(`${what} needs Notion-Version ${min} or later, this request used ${version}.`);
  };
  const list = (kind, results, extra = {}) => ({ object: 'list', results, next_cursor: extra.next_cursor ?? null, has_more: extra.has_more ?? false, type: kind, [kind]: {} });
  const rowsOf = (ds) => ds.rows.map((id) => pages.get(normId(id)));
  const parentFor = (body) => {
    const parent = body.parent;
    if (!isPlain(parent)) throw validation('body.parent should be defined.');
    return parent;
  };

  function createPageRoute(body) {
    const parent = parentFor(body);
    if (body.properties === undefined || !isPlain(body.properties)) throw validation('body.properties should be defined as an object.');
    const children = body.children ?? [];
    if (parent.database_id !== undefined || parent.data_source_id !== undefined) {
      const ds = parent.data_source_id !== undefined ? getDataSource(parent.data_source_id) : getDataSource(getDatabase(parent.database_id).dsId);
      const created = stamp();
      const rec = { id: nextId('page'), dsId: ds.id, parent: { data_source_id: ds.id }, created_time: created, last_edited_time: created, created_by: BOT, last_edited_by: BOT, icon: body.icon ?? null, props: {} };
      writeProperties(rec, ds, body.properties);
      const prepared = prepareBlocks(children, 'body.children'); // a bad block fails the whole request before anything is stored
      assignUnique(ds, rec);
      pages.set(normId(rec.id), rec);
      ds.rows.push(rec.id);
      commitBlocks(prepared, rec);
      return pageObject(rec);
    }
    if (parent.page_id !== undefined) {
      const above = getPage(parent.page_id);
      const keys = Object.keys(body.properties);
      if (keys.length !== 1 || keys[0] !== 'title') throw validation('A page under a page takes one property, "title".');
      const titleValue = coerce({ name: 'x' }, { id: 'title', name: 'title', type: 'title' }, body.properties.title);
      const created = stamp();
      const rec = { id: nextId('page'), parent: { type: 'page_id', page_id: above.id }, created_time: created, last_edited_time: created, created_by: BOT, last_edited_by: BOT, icon: body.icon ?? null, props: { title: titleValue } };
      const prepared = prepareBlocks(children, 'body.children');
      pages.set(normId(rec.id), rec);
      commitBlocks(prepared, rec);
      return pageObject(rec);
    }
    throw validation('body.parent should hold a database_id, a data_source_id or a page_id.');
  }

  function updatePageRoute(id, body) {
    const rec = getPage(id);
    if (body.archived === true || body.in_trash === true) throw validation('This fake never archives or deletes anything; archived and in_trash may not be set to true.');
    if (body.properties !== undefined) {
      if (rec.dsId) writeProperties(rec, dataSources.get(normId(rec.dsId)), body.properties);
      else {
        const keys = Object.keys(body.properties);
        if (keys.some((k) => k !== 'title')) throw validation(`${keys.find((k) => k !== 'title')} is not a property that exists.`);
        if (keys.length) rec.props.title = coerce({ name: 'x' }, { id: 'title', name: 'title', type: 'title' }, body.properties.title);
      }
    }
    if (body.icon !== undefined) rec.icon = body.icon;
    rec.last_edited_time = stamp();
    rec.last_edited_by = BOT;
    return pageObject(rec);
  }

  function propertyItemRoute(id, prop, query) {
    const rec = getPage(id);
    if (!rec.dsId) {
      if (decodeURIComponentSafe(prop) !== 'title') throw notFound('property', prop);
    }
    const ds = rec.dsId ? dataSources.get(normId(rec.dsId)) : { properties: { title: { id: 'title', name: 'title', type: 'title' } } };
    const def = propertyOf(ds, prop);
    if (!def) throw notFound('property', prop);
    const value = rec.dsId ? propertiesOf(rec, ds)[def.name] : clone(rec.props.title);
    if (['title', 'rich_text', 'relation'].includes(def.type)) {
      const items = (def.type === 'relation' ? value.relation : value[def.type]).map((x, i) => ({
        object: 'property_item', id: def.type === 'relation' ? `${def.id}-${i}` : def.id, type: def.type, [def.type]: def.type === 'relation' ? { id: x.id } : x,
      }));
      const paged = pageOf(items, query.get('page_size'), query.get('start_cursor'));
      return { ...list('property_item', paged.results, paged), property_item: { id: def.id, next_url: null, type: def.type, [def.type]: {} } };
    }
    return { object: 'property_item', ...value };
  }

  function queryRoute(ds, body, query, kind) {
    let rows = rowsOf(ds);
    if (body.filter !== undefined && body.filter !== null) {
      checkFilter(ds, body.filter, 'filter');
      rows = rows.filter((rec) => matches(rec, ds, body.filter));
    }
    if (body.sorts !== undefined && body.sorts !== null) rows = sortRows(rows, ds, body.sorts);
    const paged = pageOf(rows, body.page_size, body.start_cursor);
    return list(kind, paged.results.map(pageObject), paged);
  }

  function createDatabaseRoute(body) {
    requireVersion(DATA_SOURCE_VERSION, 'Creating a database with initial_data_source');
    if (body.properties !== undefined) throw validation('body.properties should not be present; a database takes its columns in initial_data_source.properties.');
    const parent = parentFor(body);
    if (parent.page_id === undefined) throw validation('body.parent.page_id should be defined.');
    const above = getPage(parent.page_id);
    if (!Array.isArray(body.title)) throw validation('body.title should be an array of rich text.');
    const title = richTextIn(body.title, 'body.title');
    if (!isPlain(body.initial_data_source)) throw validation('body.initial_data_source should be defined.');
    const properties = newSchema(body.initial_data_source.properties, 'body.initial_data_source.properties');
    const description = body.description === undefined ? [] : richTextIn(body.description, 'body.description');
    const made = makeDatabase({ parent: { type: 'page_id', page_id: above.id }, title, description, isInline: body.is_inline === true, icon: body.icon, properties });
    return databaseObject(databases.get(normId(made.database_id)));
  }

  function patchDataSourceRoute(ds, body) {
    const allowed = ['properties', 'title', 'icon'];
    const unknown = Object.keys(body).find((k) => !allowed.includes(k));
    if (unknown) throw validation(`body.${unknown} should not be present; a data source takes title, icon and properties.`);
    const defs = Object.values(clone(ds.properties)); // copies, in column order: nothing changes unless the whole request is good
    const renames = [];
    const added = [];
    if (body.properties !== undefined) {
      if (!isPlain(body.properties)) throw validation('body.properties should be an object.');
      for (const [name, config] of Object.entries(body.properties)) {
        if (config === null) throw validation(`body.properties.${name} is null, which would delete the property; this fake never deletes.`);
        if (!isPlain(config)) throw validation(`body.properties.${name} should be an object.`);
        const existing = defs.find((d) => d.name === name || d.id === name);
        if (existing) {
          if (typeof config.name === 'string' && config.name !== existing.name) {
            if (defs.some((d) => d.name === config.name)) throw validation(`body.properties.${name}.name: a property named ${config.name} exists already.`);
            renames.push([existing.name, config.name]);
            existing.name = config.name;
          }
          const type = Object.keys(config).find((k) => SUPPORTED_TYPES.includes(k));
          if (type) {
            if (type !== existing.type) throw validation(`body.properties.${name}: this fake does not change the type of a property.`);
            if ((type === 'select' || type === 'multi_select') && !isPlain(config[type])) throw validation(`body.properties.${name}.${type} should be an object.`);
            if (type === 'select' || type === 'multi_select') {
              const have = new Map(existing[type].options.map((o) => [o.name, o]));
              existing[type] = { options: (config[type].options ?? []).map((o, i) => have.get(o?.name) ?? optionOf(o, `body.properties.${name}.${type}.options[${i}]`)) };
            }
          }
        } else {
          const def = schemaProperty(name, config);
          if (def.type === 'title') throw validation(`body.properties.${name}: a data source has one title property already.`);
          defs.push(def);
          added.push(def);
        }
      }
    }
    if (body.title !== undefined) {
      ds.title = richTextIn(body.title, 'body.title');
      ds.name = plainText(ds.title);
    }
    ds.properties = Object.fromEntries(defs.map((d) => [d.name, d]));
    for (const [from, to] of renames) {
      for (const rec of rowsOf(ds)) {
        if (from in rec.props) {
          rec.props[to] = rec.props[from];
          delete rec.props[from];
        }
        if (rec.unique && from in rec.unique) {
          rec.unique[to] = rec.unique[from];
          delete rec.unique[from];
        }
      }
    }
    for (const def of added) {
      if (def.type !== 'unique_id') continue;
      ds.rows.forEach((id, i) => {
        const rec = pages.get(normId(id));
        rec.unique = { ...(rec.unique ?? {}), [def.name]: i + 1 };
      });
    }
    ds.last_edited_time = stamp();
    return dataSourceObject(ds);
  }

  function createViewRoute(body) {
    requireVersion(VIEW_VERSION, 'Views');
    const placements = ['database_id', 'view_id', 'create_database'].filter((k) => body[k] !== undefined);
    if (placements.length !== 1) throw validation(`Exactly one of database_id, view_id or create_database must be given, found ${placements.length}.`);
    if (placements[0] !== 'database_id') throw validation(`This fake creates views as tabs of a database (database_id); ${placements[0]} is not supported.`);
    const db = getDatabase(body.database_id);
    if (typeof body.data_source_id !== 'string') throw validation('body.data_source_id should be defined.');
    const ds = getDataSource(body.data_source_id);
    if (ds.parent.database_id !== db.id) throw validation(`data_source_id ${body.data_source_id} does not belong to database ${body.database_id}.`);
    if (typeof body.name !== 'string' || body.name.trim() === '') throw validation('body.name should be a non-empty string.');
    if (!VIEW_TYPES.includes(body.type)) throw validation(`body.type should be one of ${VIEW_TYPES.join(', ')}.`);
    if (body.filter !== undefined && body.filter !== null) checkFilter(ds, body.filter, 'filter');
    if (body.sorts !== undefined && body.sorts !== null) {
      if (!Array.isArray(body.sorts) || body.sorts.length > 100) throw validation('sorts should be an array of at most 100 items.');
      sortRows([], ds, body.sorts);
    }
    if (body.configuration !== undefined && body.configuration !== null) checkConfiguration(ds, body.type, body.configuration);
    const order = viewsOfDatabase.get(normId(db.id)) ?? [];
    const position = body.position ?? { type: 'end' };
    let at = order.length;
    if (position.type === 'start') at = 0;
    else if (position.type === 'after_view') {
      const i = order.findIndex((v) => normId(v) === normId(position.view_id));
      if (i < 0) throw validation(`position.view_id ${position.view_id} is not a view of this database.`);
      at = i + 1;
    } else if (position.type !== 'end') throw validation('position.type should be start, end or after_view.');
    const created = stamp();
    const view = {
      id: nextId('view'), parent: { database_id: db.id }, database_id: db.id, data_source_id: ds.id, name: body.name, type: body.type, filter: body.filter ?? null, sorts: body.sorts ?? null,
      quick_filters: body.quick_filters ?? null, configuration: body.configuration ?? null, created_time: created, last_edited_time: created,
    };
    views.set(normId(view.id), clone(view));
    order.splice(at, 0, view.id);
    viewsOfDatabase.set(normId(db.id), order);
    return viewObject(view, { full: false });
  }

  function patchViewRoute(id, body) {
    requireVersion(VIEW_VERSION, 'Views');
    const view = getView(id);
    const allowed = ['name', 'filter', 'sorts', 'configuration'];
    const unknown = Object.keys(body).find((k) => !allowed.includes(k));
    if (unknown) throw validation(`body.${unknown} should not be present; this fake updates the name, the filter, the sorts and the configuration of a view.`);
    if (Object.keys(body).length === 0) throw validation('body should hold a name, a filter, sorts or a configuration.');
    const ds = getDataSource(view.data_source_id);
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim() === '')) throw validation('body.name should be a non-empty string.');
    if (body.filter !== undefined && body.filter !== null) checkFilter(ds, body.filter, 'filter');
    if (body.sorts !== undefined && body.sorts !== null) {
      if (!Array.isArray(body.sorts) || body.sorts.length > 100) throw validation('sorts should be an array of at most 100 items.');
      sortRows([], ds, body.sorts);
    }
    if (body.configuration !== undefined && body.configuration !== null) checkConfiguration(ds, view.type, body.configuration);
    for (const k of allowed) if (body[k] !== undefined) view[k] = clone(body[k]);
    view.last_edited_time = stamp();
    return viewObject(view, { full: true });
  }

  function listViewsRoute(query, databaseId = null) {
    requireVersion(VIEW_VERSION, 'Views');
    const fromDs = query.get('data_source_id');
    const dbId = databaseId ?? query.get('database_id');
    let ids;
    if (dbId) ids = viewsOfDatabase.get(normId(getDatabase(dbId).id)) ?? [];
    else if (fromDs) {
      const ds = getDataSource(fromDs);
      ids = (viewsOfDatabase.get(normId(ds.parent.database_id)) ?? []).filter((v) => normId(views.get(normId(v)).data_source_id) === normId(ds.id));
    } else throw validation('database_id or data_source_id is required.');
    const paged = pageOf(ids, query.get('page_size'), query.get('start_cursor'));
    return list('view', paged.results.map((id) => ({ object: 'view', id })), paged);
  }

  function route(method, segments, query, body) {
    const [kind, id, sub, subId] = segments;
    if (method === 'GET' && kind === 'pages' && id && !sub) return pageObject(getPage(id));
    if (method === 'GET' && kind === 'pages' && id && sub === 'properties' && subId && segments.length === 4) return propertyItemRoute(id, subId, query);
    if (method === 'POST' && kind === 'pages' && !id) return createPageRoute(body);
    if (method === 'PATCH' && kind === 'pages' && id && !sub) return updatePageRoute(id, body);

    if (method === 'GET' && kind === 'databases' && id && !sub) return databaseObject(getDatabase(id));
    if (method === 'POST' && kind === 'databases' && !id) return createDatabaseRoute(body);
    if (method === 'POST' && kind === 'databases' && id && sub === 'query' && segments.length === 3) {
      const db = getDatabase(id);
      return queryRoute(dataSources.get(normId(db.dsId)), body, query, 'page_or_database');
    }
    if (method === 'GET' && kind === 'databases' && id && sub === 'views' && segments.length === 3) return listViewsRoute(query, id);

    if (kind === 'data_sources' && id && (sub === undefined || (sub === 'query' && segments.length === 3))) {
      requireVersion(DATA_SOURCE_VERSION, 'Data sources');
      if (method === 'GET' && !sub) return dataSourceObject(getDataSource(id));
      if (method === 'POST' && sub === 'query') return queryRoute(getDataSource(id), body, query, 'page_or_data_source');
      if (method === 'PATCH' && !sub) return patchDataSourceRoute(getDataSource(id), body);
    }

    if (method === 'POST' && kind === 'views' && !id) return createViewRoute(body);
    if (method === 'GET' && kind === 'views' && !id) return listViewsRoute(query);
    if (method === 'GET' && kind === 'views' && id && !sub) {
      requireVersion(VIEW_VERSION, 'Views');
      return viewObject(getView(id), { full: true });
    }
    if (method === 'PATCH' && kind === 'views' && id && !sub) return patchViewRoute(id, body);

    if (kind === 'blocks' && id && sub === 'children' && segments.length === 3) {
      const parent = getBlockParent(id);
      if (method === 'GET') {
        const ids = childrenOf.get(normId(parent.id)) ?? [];
        const paged = pageOf(ids, query.get('page_size'), query.get('start_cursor'));
        return list('block', paged.results.map((bid) => blockObject(blocks.get(normId(bid)))), paged);
      }
      if (method === 'PATCH') {
        if (body.children === undefined) throw validation('body.children should be defined.');
        if (Array.isArray(body.children) && body.children.length === 0) throw validation('body.children should contain at least one block.');
        let after = null;
        if (body.after !== undefined) {
          after = (childrenOf.get(normId(parent.id)) ?? []).find((b) => normId(b) === normId(body.after)) ?? null;
          if (after === null) throw validation(`body.after ${body.after} is not a child of this block.`);
        }
        const made = storeBlocks(body.children, parent, 'body.children', { after });
        if (parent.last_edited_time !== undefined) parent.last_edited_time = stamp();
        return list('block', made.map((bid) => blockObject(blocks.get(normId(bid)))));
      }
    }
    throw new HttpError(404, 'invalid_request_url', `Invalid request URL: ${method} /${segments.join('/')}`);
  }

  // ---- the HTTP surface ------------------------------------------------------------------------------------------------------------

  function readHeader(headers, name) {
    if (!headers) return undefined;
    if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
    const entries = Array.isArray(headers) ? headers : Object.entries(headers);
    return entries.find(([k]) => String(k).toLowerCase() === name.toLowerCase())?.[1];
  }

  const respond = (status, body, headers = {}) => new Response(JSON.stringify(body), {
    status, statusText: STATUS_TEXT[status] ?? '', headers: { 'content-type': 'application/json', ...headers },
  });
  const errorBody = (status, code, message) => ({ object: 'error', status, code, message });

  const isRead = (r) => r.method === 'GET' || (r.method === 'POST' && /\/query$/.test(r.path.split('?')[0]));

  async function fetchImpl(url, init = {}) {
    const u = new URL(String(url));
    if (u.origin !== API_ORIGIN || !u.pathname.startsWith('/v1/')) throw new Error(`fake-notion: the URL ${u.origin}${u.pathname} is not an api.notion.com/v1 URL`);
    const method = String(init.method ?? 'GET').toUpperCase();
    const path = u.pathname.slice(3) + u.search;
    const requestedVersion = readHeader(init.headers, 'Notion-Version');
    const entry = { method, path, status: null, body: null, version: requestedVersion ?? null };
    requests.push(entry);

    // an injected failure is used up when it is served: a network failure before anything else, a status failure once the token and version passed
    const matching = () => failures.find((f) => (f.method === '*' || f.method === method) && f.re.test(path));
    const useUp = (f) => {
      if (--f.times <= 0) failures.splice(failures.indexOf(f), 1);
    };
    const dropped = matching();
    if (dropped?.status === 'network') {
      useUp(dropped);
      if (dropped.applied) {
        try {
          serve();
        } catch {
          // the request reached Notion and may have been refused; either way the answer is lost
        }
      }
      const error = new TypeError('fetch failed');
      error.cause = Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' });
      throw error;
    }

    let result;
    function serve() {
      version = requestedVersion;
      try {
        if (typeof init.body === 'string' && init.body !== '') {
          try {
            entry.body = JSON.parse(init.body);
          } catch {
            throw new HttpError(400, 'invalid_json', 'Error parsing JSON body.');
          }
        }
        const segments = u.pathname.slice(4).split('/').filter(Boolean).map(decodeURIComponentSafe);
        return route(method, segments, u.searchParams, entry.body ?? {});
      } finally {
        version = OLD_VERSION;
      }
    }

    try {
      const bearer = readHeader(init.headers, 'Authorization');
      if (bearer !== `Bearer ${token}`) throw new HttpError(401, 'unauthorized', 'API token is invalid.');
      if (requestedVersion === undefined || requestedVersion === '') throw new HttpError(400, 'missing_version', 'Notion-Version header failed validation: Notion-Version header should be defined, instead was `undefined`.');
      if (!KNOWN_VERSIONS.includes(requestedVersion)) throw new HttpError(400, 'validation_error', `Notion-Version header failed validation: ${JSON.stringify(requestedVersion)} is not a Notion-Version this fake knows (${KNOWN_VERSIONS.join(', ')}).`);
      if (!['GET', 'POST', 'PATCH'].includes(method)) throw new HttpError(404, 'invalid_request_url', `Invalid request URL: ${method} ${u.pathname}`);
      const failure = matching();
      if (failure) {
        useUp(failure);
        if (failure.applied) {
          try {
            serve();
          } catch {
            // the attempt reached Notion; whether it worked or not, the caller only hears the injected error
          }
        }
        throw new HttpError(failure.status, failure.code ?? CODE_OF_STATUS[failure.status] ?? 'internal_server_error', failure.message ?? `Injected ${failure.status} (failNext).`, { headers: failure.headers });
      }
      result = { status: 200, body: serve() };
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      result = { status: e.status, body: errorBody(e.status, e.code, e.message), headers: e.headers ?? {} };
    }
    entry.status = result.status;
    return respond(result.status, result.body, result.headers);
  }

  // ---- test helpers (no request is logged) -----------------------------------------------------------------------------------------

  function dataSourceOfDatabase(databaseId) {
    const key = normId(databaseId);
    const db = databases.get(key);
    if (db) return dataSources.get(normId(db.dsId));
    const ds = dataSources.get(key);
    if (ds) return ds;
    throw new Error(`fake-notion: there is no database ${databaseId}`);
  }

  function plainToStored(ds, name, value) {
    const def = Object.values(ds.properties).find((d) => d.name === name);
    if (!def) throw new Error(`fake-notion: ${ds.name} has no property "${name}"`);
    if (READ_ONLY_TYPES.includes(def.type)) throw new Error(`fake-notion: ${name} is a ${def.type} property and cannot be set`);
    let v;
    switch (def.type) {
      case 'title':
      case 'rich_text': v = textItems(value); break;
      case 'select': v = value === null || value === undefined || value === '' ? null : { name: String(value) }; break;
      case 'multi_select': v = (value ?? []).map((n) => ({ name: String(n) })); break;
      case 'relation': v = (value ?? []).map((id) => ({ id })); break;
      case 'date': v = value === null || value === undefined || value === '' ? null : (isPlain(value) ? value : { start: String(value) }); break;
      case 'url': v = value === '' ? null : value ?? null; break;
      case 'number': v = value ?? null; break;
      default: v = value;
    }
    return [def, { [def.type]: v }];
  }

  function toPlain(def, value, out) {
    switch (def.type) {
      case 'title':
      case 'rich_text': out[def.name] = plainText(value[def.type]); break;
      case 'select': out[def.name] = value.select?.name ?? null; break;
      case 'multi_select': out[def.name] = value.multi_select.map((o) => o.name); break;
      case 'relation': out[def.name] = value.relation.map((r) => r.id); break;
      case 'date':
        out[def.name] = value.date?.start ?? null;
        if (value.date?.end) out[`${def.name}:end`] = value.date.end;
        break;
      case 'unique_id': out[def.name] = value.unique_id.number === null ? null : `${value.unique_id.prefix ? `${value.unique_id.prefix}-` : ''}${value.unique_id.number}`; break;
      default: out[def.name] = value[def.type] ?? null;
    }
  }

  return {
    token,
    fetchImpl,
    requests,
    writes: () => requests.filter((r) => !isRead(r)),

    addDatabase({ id, dataSourceId, parentPageId, title = 'Untitled', properties } = {}) {
      const schema = newSchema(properties, 'properties');
      return makeDatabase({
        id, dataSourceId, parent: parentPageId ? { type: 'page_id', page_id: canonicalId(parentPageId) } : { type: 'workspace', workspace: true },
        title: textItems(title), description: [], isInline: false, properties: schema,
      });
    },

    addPage({ parentPageId, title = 'Untitled' } = {}) {
      const created = stamp();
      const rec = {
        id: nextId('page'), parent: parentPageId ? { type: 'page_id', page_id: canonicalId(parentPageId) } : { type: 'workspace', workspace: true },
        created_time: created, last_edited_time: created, created_by: BOT, last_edited_by: BOT, icon: null,
        props: { title: { id: 'title', type: 'title', title: textItems(title) } },
      };
      pages.set(normId(rec.id), rec);
      return rec.id;
    },

    addRow(databaseId, plain = {}) {
      const ds = dataSourceOfDatabase(databaseId);
      const created = stamp();
      const rec = { id: nextId('page'), dsId: ds.id, parent: { data_source_id: ds.id }, created_time: created, last_edited_time: created, created_by: BOT, last_edited_by: BOT, icon: null, props: {} };
      for (const [name, value] of Object.entries(plain)) {
        const [def, stored] = plainToStored(ds, name, value);
        rec.props[def.name] = coerce(ds, def, stored);
      }
      assignUnique(ds, rec);
      pages.set(normId(rec.id), rec);
      ds.rows.push(rec.id);
      return rec.id;
    },

    editRow(pageId, plain = {}) {
      const rec = pages.get(normId(pageId));
      if (!rec || !rec.dsId) throw new Error(`fake-notion: there is no row ${pageId}`);
      const ds = dataSources.get(normId(rec.dsId));
      const staged = {};
      for (const [name, value] of Object.entries(plain)) {
        const [def, stored] = plainToStored(ds, name, value);
        staged[def.name] = coerce(ds, def, stored);
      }
      Object.assign(rec.props, staged);
      rec.last_edited_time = stamp();
      rec.last_edited_by = EDITOR;
    },

    rows(databaseId) {
      return rowsOf(dataSourceOfDatabase(databaseId)).map(pageObject);
    },

    plainRows(databaseId) {
      const ds = dataSourceOfDatabase(databaseId);
      return rowsOf(ds).map((rec) => {
        const out = { page_id: rec.id };
        const props = propertiesOf(rec, ds);
        for (const def of Object.values(ds.properties)) toPlain(def, props[def.name], out);
        return out;
      });
    },

    page(id) {
      const rec = pages.get(normId(id));
      if (!rec) throw new Error(`fake-notion: there is no page ${id}`);
      return pageObject(rec);
    },

    database(id) {
      const db = databases.get(normId(id));
      if (!db) throw new Error(`fake-notion: there is no database ${id}`);
      return { ...databaseObject(db), properties: clone(dataSources.get(normId(db.dsId)).properties) };
    },

    dataSource(id) {
      const ds = dataSources.get(normId(id)) ?? dataSources.get(normId(databases.get(normId(id))?.dsId));
      if (!ds) throw new Error(`fake-notion: there is no data source ${id}`);
      return dataSourceObject(ds);
    },

    children(id) {
      return (childrenOf.get(normId(id)) ?? []).map((bid) => blockObject(blocks.get(normId(bid))));
    },

    views(databaseId) {
      const db = databases.get(normId(databaseId));
      if (!db) throw new Error(`fake-notion: there is no database ${databaseId}`);
      return (viewsOfDatabase.get(normId(db.id)) ?? []).map((id) => viewObject(views.get(normId(id)), { full: true }));
    },

    failNext(method, pathRegex, status, times = 1, { code, message, headers, applied = false } = {}) {
      const re = pathRegex instanceof RegExp ? new RegExp(pathRegex.source, pathRegex.flags.replace(/[gy]/g, '')) : new RegExp(String(pathRegex));
      const m = method === null || method === undefined ? '*' : String(method).toUpperCase();
      const headerSet = headers ?? (status === 429 ? { 'retry-after': '0' } : undefined);
      failures.push({ method: m, re, status, times, code, message, headers: headerSet, applied });
    },

    pendingFailures: () => failures.reduce((n, f) => n + f.times, 0),
    protect(id) { hidden.add(normId(id)); },
    get createdOptions() { return [...createdOptions]; },
  };
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
