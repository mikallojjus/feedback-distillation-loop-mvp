// The only door the scripts use to reach Notion: a small REST client with pacing, retries and a token that never leaves
// this file. Nothing here prints, logs, returns or puts the token in an error message.
//
// A copy of agents/claim-tagger/scripts/lib/notion-rest.mjs with the calls the MVP builder needs added. Every old export and
// behaviour is kept, the page create included; what is new is marked "new" below.
//
//   createClient({ token, apiVersion, requestsPerSecond, fetchImpl, log })   -> the client (tests pass a mock fetch)
//   clientFromConfig(config, { fetchImpl, repoRoot, token, apiVersion })      -> a client from config.json + .env, or null without a token
//   loadToken(repoRoot)                                                       -> NOTION_TOKEN from <repoRoot>/.env, or null
//   splitRichText(text, max)                                                  -> Notion rich-text chunks (2,000 characters per object)
//   requestLogger(file)                                                       -> new: a `log` for createClient, one JSON line per HTTP attempt appended to `file`
//   countRequests(file)                                                       -> new: { total, byMethod, writes } read back from such a file: the proof that a dry run only read
//   BUILDER_API_VERSION                                                       -> new: '2026-03-11', next to DEFAULT_API_VERSION '2022-06-28'
//
// What the client can do. Everything goes through one request function that sends GET, POST and PATCH and nothing else:
//   reads    retrievePage, retrieveDatabase, retrievePropertyItem, retrieveBlockChildren (new), retrieveDataSource (new), retrieveView (new),
//            listViews (new), queryDatabase / queryAll, queryDataSource / queryDataSourceAll (new; all pages of a query, following the cursor)
//   writes   createPage (a row), createPageUnderPage (new), createDatabase (new), createView (new), updatePage, updateDataSource (new), appendBlocks
// There is deliberately no call that takes anything away: nothing removes, hides or moves a page, a database, a view or a block out of
// sight (hard rule 8: rows are superseded, never removed), and a test reads this file's source to keep it so.
//
// API versions. DEFAULT_API_VERSION is what every old call runs on. The data source calls need 2025-09-03 or later, and the database
// and view calls need BUILDER_API_VERSION (the reference allows only that value for them): build a second client for those,
// clientFromConfig(config, { apiVersion: BUILDER_API_VERSION }); opts.apiVersion wins over config.notion.api_version. Two clients
// are two token buckets, so back-to-back calls on both can pass 3 requests per second for a moment; a 429 is retried as always.
//
// Pacing is a token bucket (default 3 requests per second, Notion's average limit). A 429 sleeps for Retry-After seconds and
// retries (at most 5 times); a 5xx, a 409 or a network failure retries with 0.5, 1 and 2 s of backoff (at most 3 times);
// any other 4xx throws a NotionError carrying status, code and Notion's message.
//
// One exception: a create (POST /pages, POST /databases or POST /views: createPage, createPageUnderPage, createDatabase, createView) is
// never sent twice. When its answer is lost (a network failure, a 5xx, a 409, or a 2xx whose body cannot be read) the page, database or
// view may exist already, and a second POST would add a copy that no script may remove (a duplicate database could never be cleaned up).
// It throws a NotionError with code 'create_uncertain' (retryable: true) instead, and its message says where to look: for a row,
// apply.mjs --run <id> --retry reads Notion again before it sends anything, so a row that did land is updated by its key and one that
// did not is created then; for a page, a database or a view the caller looks under the parent before creating again. A 429 is still
// retried: Notion did not process that request.
//
// The request log (requestLogger) gets the path as the client scrubs it, so the token cannot get in; a header or a body never reaches a
// log callback. A log callback that throws is not caught: the error reaches the caller, because a request log with holes in it proves nothing.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import { readJsonl } from './jsonl.mjs';
import { repoRoot as defaultRepoRoot } from './paths.mjs';

export const API_BASE = 'https://api.notion.com/v1';
export const DEFAULT_API_VERSION = '2022-06-28';
export const BUILDER_API_VERSION = '2026-03-11'; // views, and the database create with initial_data_source
export const MAX_RATE_LIMIT_RETRIES = 5;
export const MAX_SERVER_RETRIES = 3;
export const BACKOFF_MS = Object.freeze([500, 1000, 2000]);
export const MAX_CHILDREN = 100; // blocks per append / create request
const PLACEHOLDER_TOKEN = 'ntn_replace_me'; // the value in .env.example
const SENT_METHODS = new Set(['GET', 'POST', 'PATCH']); // the only methods this client can send
const CREATE_PATHS = new Set(['/pages', '/databases', '/views']); // the POSTs that make something new: never sent twice

/** An error from the Notion API or the network: status (null for a network failure), Notion's error code, and whether a later retry may help. */
export class NotionError extends Error {
  constructor(message, { status = null, code = null, retryable = false } = {}) {
    super(message);
    this.name = 'NotionError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

/** A Notion rich-text array for a string: chunks of at most `max` UTF-16 units, never cutting a surrogate pair. '' gives []. */
export function splitRichText(text, max = 2000) {
  const s = text === null || text === undefined ? '' : String(text);
  if (!Number.isInteger(max) || max < 2) throw new RangeError(`splitRichText: max must be an integer of at least 2, got ${max}`);
  const out = [];
  for (let i = 0; i < s.length;) {
    let end = Math.min(s.length, i + max);
    if (end < s.length) {
      const last = s.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end -= 1; // the pair would be cut: leave its first half for the next chunk
    }
    out.push({ type: 'text', text: { content: s.slice(i, end) } });
    i = end;
  }
  return out;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Token bucket of capacity 1 refilled at `rate` per second: requests are spaced 1/rate apart, so no second ever holds more than `rate` of them. acquire() resolves in call order. */
function tokenBucket({ rate, sleep, now }) {
  const capacity = 1;
  let tokens = capacity;
  let last = now();
  let chain = Promise.resolve();
  const take = async () => {
    for (;;) {
      const t = now();
      tokens = Math.min(capacity, tokens + ((t - last) / 1000) * rate);
      last = t;
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      await sleep(Math.max(1, Math.ceil(((1 - tokens) / rate) * 1000)));
    }
  };
  return {
    acquire() {
      const turn = chain.then(take);
      chain = turn.catch(() => {});
      return turn;
    },
  };
}

function retryAfterMs(res) {
  const raw = res.headers?.get?.('retry-after');
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 && raw !== null && raw !== '' ? Math.ceil(seconds * 1000) : 1000;
}

const enc = encodeURIComponent;
// Property ids come out of the API already percent-encoded ("%3AQ%7B"); encoding them again would name a different property.
const propertyPath = (id) => (/%[0-9a-f]{2}/i.test(id) ? id : enc(id));

// A string becomes rich-text chunks; an array is taken to be rich text already (links, annotations) and passed on as it is.
const richText = (value) => (Array.isArray(value) ? value : splitRichText(value));
// An emoji string becomes a Notion icon object; an icon object is passed on as it is.
const iconOf = (icon) => (typeof icon === 'string' ? { type: 'emoji', emoji: icon } : icon);

function requireId(what, value) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${what} is required (a non-empty id)`);
  return value;
}

/** "?a=1&b=2" from the values that are set (undefined, null and '' are left out); '' when none is. */
function queryString(params) {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${enc(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// What a create whose answer was lost may have made, and where to look for it: the second half of the create_uncertain message.
function lostCreate(path, body) {
  if (path === '/databases') return ['database', 'look for it under its parent page in Notion before creating it again; no script can remove a duplicate database (hard rule 8)'];
  if (path === '/views') return ['view', 'list the views of the database (listViews) before creating it again; no script can remove a duplicate view (hard rule 8)'];
  if (body?.parent?.database_id !== undefined) return ['row', 'apply.mjs --run <id> --retry reads Notion again before it sends anything, and a row that did land is updated, not created twice'];
  return ['page', 'look for it under its parent page in Notion before creating it again; no script can remove a duplicate page (hard rule 8)'];
}

function brokenCursor(path, why) {
  const e = new Error(`Notion ${path}: broken cursor chain (${why})`);
  e.code = 'BROKEN_CURSOR';
  return e;
}

// The cursor to ask for next, or null after the last page. A chain that cannot be followed (more pages promised but no cursor, or a
// cursor seen before) throws instead of looping or returning a short list as if it were the whole.
function nextCursor(res, path, seen) {
  const cursor = res.has_more ? res.next_cursor ?? null : null;
  if (res.has_more && !cursor) throw brokenCursor(path, 'has_more is true but there is no next_cursor');
  if (cursor && seen.has(cursor)) throw brokenCursor(path, 'the same cursor came back twice');
  if (cursor) seen.add(cursor);
  return cursor;
}

/**
 * The client. `fetchImpl` defaults to the global fetch; `sleep` and `now` exist so tests can run on a fake clock.
 * `log(event)` is called with { method, path, status, attempt } for every HTTP attempt and never sees the token.
 */
export function createClient({
  token, apiVersion = DEFAULT_API_VERSION, requestsPerSecond = 3, fetchImpl = globalThis.fetch, log = null, sleep = defaultSleep, now = Date.now,
} = {}) {
  if (typeof token !== 'string' || token.trim() === '') throw new TypeError('createClient: a token is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('createClient: fetchImpl must be a function');
  const rate = Number(requestsPerSecond);
  if (!(rate > 0)) throw new RangeError(`createClient: requestsPerSecond must be positive, got ${requestsPerSecond}`);
  const bucket = tokenBucket({ rate, sleep, now });
  const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': apiVersion, 'Content-Type': 'application/json' };
  const needles = [...new Set([token, enc(token)])];
  const scrub = (text) => needles.reduce((s, needle) => s.split(needle).join('[token]'), String(text ?? ''));

  // The error of a create whose answer was lost: the page, database or view may exist, so it is not sent again (see the header of this file).
  const createUncertain = (path, body, why, status = null) => {
    const [what, next] = lostCreate(path, body);
    return new NotionError(
      `Notion POST ${path}: ${why}. The ${what} may exist in Notion already, so the create was not sent again; ${next}`,
      { status, code: 'create_uncertain', retryable: true },
    );
  };

  async function request(method, path, body) {
    if (!SENT_METHODS.has(method)) throw new TypeError(`Notion request: ${method} is not a method this client sends`);
    const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    const isCreate = method === 'POST' && CREATE_PATHS.has(path);
    const shown = scrub(path); // the path is all of the request that an error message or the log ever repeats
    let rateLimited = 0;
    let failed = 0;
    let attempt = 0;
    for (;;) {
      await bucket.acquire();
      attempt += 1;
      let res;
      try {
        res = await fetchImpl(`${API_BASE}${path}`, init);
      } catch (cause) {
        log?.({ method, path: shown, status: null, attempt });
        const reason = scrub(cause?.cause?.code ?? cause?.code ?? cause?.message ?? 'unknown');
        if (isCreate) throw createUncertain(shown, body, `no answer (network failure: ${reason})`);
        if (failed >= MAX_SERVER_RETRIES) {
          throw new NotionError(`Notion ${method} ${shown}: network failure (${reason})`, { code: 'network_error', retryable: true });
        }
        await sleep(BACKOFF_MS[failed++]);
        continue;
      }
      log?.({ method, path: shown, status: res.status, attempt });
      let data = null;
      let unreadable = false;
      const text = await res.text().catch(() => { // always drain the body so the connection is released
        unreadable = true;
        return '';
      });
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      if (res.status === 429) {
        if (rateLimited >= MAX_RATE_LIMIT_RETRIES) throw new NotionError(`Notion ${method} ${shown}: still rate limited after ${MAX_RATE_LIMIT_RETRIES} retries`, { status: 429, code: 'rate_limited', retryable: true });
        rateLimited += 1;
        await sleep(retryAfterMs(res));
        continue;
      }
      if (res.ok) {
        // a create that Notion accepted but whose object did not arrive: it exists and its id is unknown
        if (isCreate && (unreadable || typeof data?.id !== 'string')) throw createUncertain(shown, body, `Notion answered ${res.status}, but the answer could not be read`, res.status);
        return data ?? {};
      }
      const code = typeof data?.code === 'string' ? data.code : null;
      if (res.status >= 500 || res.status === 409) {
        if (isCreate) throw createUncertain(shown, body, `Notion answered ${res.status}${code ? ` ${code}` : ''}: ${scrub(data?.message ?? res.statusText)}`, res.status);
        if (failed >= MAX_SERVER_RETRIES) {
          throw new NotionError(`Notion ${method} ${shown} -> ${res.status}${code ? ` ${code}` : ''}: ${scrub(data?.message ?? res.statusText)} (gave up after ${MAX_SERVER_RETRIES} retries)`, { status: res.status, code, retryable: true });
        }
        await sleep(BACKOFF_MS[failed++]);
        continue;
      }
      throw new NotionError(`Notion ${method} ${shown} -> ${res.status}${code ? ` ${code}` : ''}: ${scrub(data?.message ?? res.statusText)}`, { status: res.status, code, retryable: false });
    }
  }

  /** Every page of a query (a database's or a data source's), following next_cursor. Yields page objects. */
  async function* queryPages(path, { filter, sorts, pageSize = 100 } = {}) {
    const seen = new Set();
    let cursor = null;
    do {
      const body = { page_size: pageSize };
      if (filter) body.filter = filter;
      if (sorts) body.sorts = sorts;
      if (cursor) body.start_cursor = cursor;
      const res = await request('POST', path, body);
      for (const page of res.results ?? []) yield page;
      cursor = nextCursor(res, path, seen);
    } while (cursor);
  }

  async function collect(pages) {
    const out = [];
    for await (const page of pages) out.push(page);
    return out;
  }

  /** POST /databases/{id}/query: every row of a database (API version 2022-06-28). */
  const queryDatabase = (databaseId, opts) => queryPages(`/databases/${enc(databaseId)}/query`, opts);
  const queryAll = (databaseId, opts = {}) => collect(queryDatabase(databaseId, opts));

  /** New. POST /data_sources/{id}/query: every row of a data source, like queryDatabase (needs API version 2025-09-03 or later). */
  const queryDataSource = (dataSourceId, opts) => queryPages(`/data_sources/${enc(dataSourceId)}/query`, opts);
  const queryDataSourceAll = (dataSourceId, opts = {}) => collect(queryDataSource(dataSourceId, opts));

  const retrieveDatabase = (databaseId) => request('GET', `/databases/${enc(databaseId)}`);
  const retrievePage = (pageId) => request('GET', `/pages/${enc(pageId)}`);

  /** New. GET /data_sources/{id}: the schema (properties) of a data source. */
  const retrieveDataSource = (dataSourceId) => request('GET', `/data_sources/${enc(dataSourceId)}`);

  /** New. GET /views/{id}: one view, with its filter, sorts and configuration (needs 2026-03-11). */
  const retrieveView = (viewId) => request('GET', `/views/${enc(viewId)}`);

  /** All items of a paginated property (a relation with more than 25 references, a long rollup): the flattened `results` array. */
  async function retrievePropertyItem(pageId, propertyId) {
    const base = `/pages/${enc(pageId)}/properties/${propertyPath(propertyId)}`;
    const items = [];
    const seen = new Set();
    let cursor = null;
    do {
      const res = await request('GET', `${base}?page_size=100${cursor ? `&start_cursor=${enc(cursor)}` : ''}`);
      if (res.object !== 'list') return [res]; // a single-value property
      items.push(...(res.results ?? []));
      cursor = nextCursor(res, base, seen);
    } while (cursor);
    return items;
  }

  // The flattened `results` of a paginated GET (block children, views), 100 to a page, following next_cursor.
  async function listAll(base, params = {}) {
    const items = [];
    const seen = new Set();
    let cursor = null;
    do {
      const res = await request('GET', `${base}${queryString({ ...params, page_size: 100, start_cursor: cursor })}`);
      items.push(...(res.results ?? []));
      cursor = nextCursor(res, base, seen);
    } while (cursor);
    return items;
  }

  /** New. GET /blocks/{id}/children?page_size=100, all pages: the flattened list of the direct children (not their own children). */
  const retrieveBlockChildren = (blockId) => listAll(`/blocks/${enc(blockId)}/children`);

  /**
   * New. GET /views?database_id=...&page_size=100, all pages: the flattened list of the views of a database. Each item is a reference
   * ({ object: 'view', id }); retrieveView gives the view itself (needs 2026-03-11).
   */
  const listViews = async (databaseId) => listAll('/views', { database_id: requireId('listViews: databaseId', databaseId) });

  /** Append blocks in requests of at most 100; returns the created blocks. */
  async function appendBlocks(blockId, children) {
    const results = [];
    for (let i = 0; i < children.length; i += MAX_CHILDREN) {
      const res = await request('PATCH', `/blocks/${enc(blockId)}/children`, { children: children.slice(i, i + MAX_CHILDREN) });
      results.push(...(res.results ?? []));
    }
    return results;
  }

  /** Create a row; `properties` is the REST shape (notion-values.encodeProperties). The first 100 blocks go in the same request, so a row never exists without its content. */
  async function createPage({ parentDatabaseId, properties, children = [] }) {
    const body = { parent: { database_id: parentDatabaseId }, properties };
    if (children.length) body.children = children.slice(0, MAX_CHILDREN);
    const page = await request('POST', '/pages', body);
    if (children.length > MAX_CHILDREN) await appendBlocks(page.id, children.slice(MAX_CHILDREN));
    return page;
  }

  /**
   * New. Create a plain page under another page: POST /pages with parent { type: 'page_id' } and the title as the page's one property.
   * `title` is a string (split into rich-text chunks) or a rich-text array; `icon` an emoji. As with createPage the first 100 blocks go
   * in the create and the rest are appended, and the create is never sent twice (create_uncertain).
   */
  async function createPageUnderPage({ parentPageId, title, children = [], icon } = {}) {
    requireId('createPageUnderPage: parentPageId', parentPageId);
    const body = { parent: { type: 'page_id', page_id: parentPageId }, properties: { title: { title: richText(title) } } };
    if (icon) body.icon = iconOf(icon);
    if (children.length) body.children = children.slice(0, MAX_CHILDREN);
    const page = await request('POST', '/pages', body);
    if (children.length > MAX_CHILDREN) await appendBlocks(page.id, children.slice(MAX_CHILDREN));
    return page;
  }

  /**
   * New. Create a database under a page: POST /databases. `properties` becomes initial_data_source.properties (the property configs of
   * the first data source, for example { Name: { type: 'title', title: {} }, Status: { type: 'select', select: { options: [...] } } }).
   * `title` and `description` are strings (split into rich-text chunks) or rich-text arrays; `icon` an emoji; isInline puts the database
   * on the page as a block. The answer carries the database id and data_sources: [{ id, name }], and the data source id is what a view
   * needs. Never sent twice (create_uncertain). Needs BUILDER_API_VERSION.
   */
  async function createDatabase({ parentPageId, title, description, isInline = true, properties, icon } = {}) {
    requireId('createDatabase: parentPageId', parentPageId);
    const body = {
      parent: { type: 'page_id', page_id: parentPageId },
      title: richText(title),
      ...(description ? { description: richText(description) } : {}),
      is_inline: isInline,
      initial_data_source: { properties },
      ...(icon ? { icon: iconOf(icon) } : {}),
    };
    return request('POST', '/databases', body);
  }

  /**
   * New. Create a view (a tab) on a database: POST /views. Only the fields that are given are sent; `type` defaults to 'table'.
   * `filter` and `sorts` use the data source query format, `configuration` must match the type, `position` is { type: 'start' | 'end' }
   * or { type: 'after_view', view_id }. The answer is a view reference (object, id, parent, type) or the full view. Never sent twice
   * (create_uncertain). Needs BUILDER_API_VERSION.
   */
  async function createView({ databaseId, dataSourceId, name, type = 'table', filter, sorts, configuration, position } = {}) {
    requireId('createView: databaseId', databaseId);
    requireId('createView: dataSourceId', dataSourceId);
    const given = (v) => v !== undefined && v !== null;
    const body = {
      database_id: databaseId,
      data_source_id: dataSourceId,
      ...(given(name) ? { name } : {}),
      type,
      ...(given(filter) ? { filter } : {}),
      ...(given(sorts) ? { sorts } : {}),
      ...(given(configuration) ? { configuration } : {}),
      ...(given(position) ? { position } : {}),
    };
    return request('POST', '/views', body);
  }

  const updatePage = (pageId, { properties }) => request('PATCH', `/pages/${enc(pageId)}`, { properties });

  /**
   * New. PATCH /data_sources/{id}: add or change properties, the title or the description; only what is given is sent. A property whose
   * config is null is refused here: the API takes that to mean "drop this column", and nothing in this client takes anything away.
   * Renaming is { Old: { name: 'New' } }. The API reference lists title, icon and properties for this call and no description, so a
   * description may be refused by Notion with a 400 (unconfirmed). Needs API version 2025-09-03 or later.
   */
  async function updateDataSource(dataSourceId, { properties, title, description } = {}) {
    const body = {};
    if (properties !== undefined) {
      if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) throw new TypeError('updateDataSource: properties must be an object of property configs');
      for (const [name, config] of Object.entries(properties)) {
        if (config === null) throw new TypeError(`updateDataSource: the config of property "${name}" is null, which would drop that column; this client never takes anything away (hard rule 8)`);
      }
      body.properties = properties;
    }
    if (title !== undefined) body.title = richText(title);
    if (description !== undefined) body.description = richText(description);
    if (Object.keys(body).length === 0) throw new TypeError('updateDataSource: give properties, a title or a description');
    return request('PATCH', `/data_sources/${enc(dataSourceId)}`, body);
  }

  return {
    queryDatabase, queryAll, retrieveDatabase, retrievePage, retrievePropertyItem, createPage, updatePage, appendBlocks,
    createDatabase, createPageUnderPage, createView, retrieveView, listViews, retrieveDataSource, queryDataSource, queryDataSourceAll,
    updateDataSource, retrieveBlockChildren,
  };
}

/**
 * NOTION_TOKEN from <repoRoot>/.env via process.loadEnvFile, or null when the file, the variable or a real value is
 * missing. The process environment is put back as it was, so a token loaded for one call never leaks into the next one
 * and an NOTION_TOKEN set elsewhere is never used.
 */
export function loadToken(repoRoot = defaultRepoRoot()) {
  const file = join(repoRoot, '.env');
  if (!existsSync(file)) return null;
  const before = { ...process.env };
  try {
    delete process.env.NOTION_TOKEN;
    process.loadEnvFile(file);
    let token = (process.env.NOTION_TOKEN ?? '').trim();
    if (token === '') {
      // a file saved with a byte-order mark (Windows editors do) hides its first key from the loader: read it again without the mark
      const text = readFileSync(file, 'utf8');
      if (text.charCodeAt(0) === 0xfeff) token = String(parseEnv(text.slice(1)).NOTION_TOKEN ?? '').trim();
    }
    return token !== '' && token !== PLACEHOLDER_TOKEN ? token : null;
  } catch {
    return null;
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in before)) delete process.env[k];
    if ('NOTION_TOKEN' in before) process.env.NOTION_TOKEN = before.NOTION_TOKEN;
  }
}

/**
 * A client built from config.json (notion.api_version, notion.requests_per_second) and the token in .env; null without a token.
 * `token` overrides .env (tests). `apiVersion` overrides config.notion.api_version: the setup script builds its database and view
 * client with BUILDER_API_VERSION this way.
 */
export function clientFromConfig(config, { fetchImpl, repoRoot, token, log, sleep, now, apiVersion } = {}) {
  const value = token ?? loadToken(repoRoot ?? defaultRepoRoot());
  if (!value) return null;
  return createClient({
    token: value,
    apiVersion: apiVersion ?? config?.notion?.api_version ?? DEFAULT_API_VERSION,
    requestsPerSecond: config?.notion?.requests_per_second ?? 3,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(log ? { log } : {}),
    ...(sleep ? { sleep } : {}),
    ...(now ? { now } : {}),
  });
}

/**
 * A `log` callback for createClient that appends one JSON line per HTTP attempt to `file`, parent folders created:
 * { ts: ISO 8601 time, method, path, status (null when the network failed), attempt }. A retry is a line of its own, so the file is
 * the full list of what was sent. The client gives it the scrubbed path and nothing else of the request.
 */
export function requestLogger(file) {
  if (typeof file !== 'string' || file.trim() === '') throw new TypeError('requestLogger: a file path is required'); // fail when it is wired up, not in the middle of a request
  return ({ method, path, status, attempt }) => {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), method, path, status, attempt })}\n`);
  };
}

// POSTs that only ask a question: POST /databases/{id}/query, POST /data_sources/{id}/query, POST /search.
const READ_ONLY_POST = /\/(?:query|search)$/;

/**
 * What a requestLogger file says was sent: { total, byMethod: { GET, POST, PATCH, ... }, writes }, one count per line (per HTTP attempt).
 * `writes` is every PATCH and PUT (and any other method that is not a GET) plus every POST whose path is not a /query or /search
 * path; a dry run proves it only read when writes is 0. A missing file is no requests at all (total 0, so a dry run that read something
 * can be told from a logger that was never attached); a line that does not parse throws, because a count that cannot be trusted
 * must not pass for a proof, and so does a last line cut short.
 */
export function countRequests(file) {
  const { rows, torn } = readJsonl(file);
  if (torn) throw new Error(`${file}: the request log ends with a half-written line, so its count cannot be trusted`);
  const byMethod = { GET: 0, POST: 0, PATCH: 0 };
  let writes = 0;
  for (const row of rows) {
    const method = String(row?.method ?? '').toUpperCase();
    byMethod[method] = (byMethod[method] ?? 0) + 1;
    const route = String(row?.path ?? '').split('?')[0];
    if (method !== 'GET' && !(method === 'POST' && READ_ONLY_POST.test(route))) writes += 1;
  }
  return { total: rows.length, byMethod, writes };
}
