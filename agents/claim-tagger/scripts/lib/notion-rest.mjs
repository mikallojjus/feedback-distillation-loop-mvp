// The only door the scripts use to reach Notion: a small REST client with pacing, retries and a token that never leaves
// this file. Nothing here prints, logs, returns or puts the token in an error message.
//
//   createClient({ token, apiVersion, requestsPerSecond, fetchImpl, log })   -> the client (tests pass a mock fetch)
//   clientFromConfig(config, { fetchImpl, repoRoot, token })                  -> a client from config.json + .env, or null without a token
//   loadToken(repoRoot)                                                       -> NOTION_TOKEN from <repoRoot>/.env, or null
//   splitRichText(text, max)                                                  -> Notion rich-text chunks (2,000 characters per object)
//
// Pacing is a token bucket (default 3 requests per second, Notion's average limit). A 429 sleeps for Retry-After seconds and
// retries (at most 5 times); a 5xx, a 409 or a network failure retries with 0.5, 1 and 2 s of backoff (at most 3 times);
// any other 4xx throws a NotionError carrying status, code and Notion's message.
//
// One exception: a page create (POST /pages, createPage) is never sent twice. When its answer is lost (a network failure, a 5xx, a 409,
// or a 2xx whose body cannot be read) the page may exist already, and a second POST would add a copy that no script may delete. It throws
// a NotionError with code 'create_uncertain' (retryable: true) instead; apply.mjs --run <id> --retry reads Notion again before it sends
// anything, so a row that did land is updated by its key and one that did not is created then. A 429 is still retried: Notion did not
// process that request.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { repoRoot as defaultRepoRoot } from './paths.mjs';

export const API_BASE = 'https://api.notion.com/v1';
export const DEFAULT_API_VERSION = '2022-06-28';
export const MAX_RATE_LIMIT_RETRIES = 5;
export const MAX_SERVER_RETRIES = 3;
export const BACKOFF_MS = Object.freeze([500, 1000, 2000]);
export const MAX_CHILDREN = 100; // blocks per append / create request
const PLACEHOLDER_TOKEN = 'ntn_replace_me'; // the value in .env.example

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
  const scrub = (text) => String(text ?? '').split(token).join('[token]');

  // The error of a page create whose answer was lost: the row may exist, so it is not sent again (see the header of this file).
  const createUncertain = (why, status = null) => new NotionError(
    `Notion POST /pages: ${why}. The row may exist in Notion already, so the create was not sent again; apply.mjs --run <id> --retry reads Notion again before it sends anything, and a row that did land is updated, not created twice`,
    { status, code: 'create_uncertain', retryable: true },
  );

  async function request(method, path, body) {
    const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    const isCreate = method === 'POST' && path === '/pages';
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
        log?.({ method, path, status: null, attempt });
        const reason = scrub(cause?.cause?.code ?? cause?.code ?? cause?.message ?? 'unknown');
        if (isCreate) throw createUncertain(`no answer (network failure: ${reason})`);
        if (failed >= MAX_SERVER_RETRIES) {
          throw new NotionError(`Notion ${method} ${path}: network failure (${reason})`, { code: 'network_error', retryable: true });
        }
        await sleep(BACKOFF_MS[failed++]);
        continue;
      }
      log?.({ method, path, status: res.status, attempt });
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
        if (rateLimited >= MAX_RATE_LIMIT_RETRIES) throw new NotionError(`Notion ${method} ${path}: still rate limited after ${MAX_RATE_LIMIT_RETRIES} retries`, { status: 429, code: 'rate_limited', retryable: true });
        rateLimited += 1;
        await sleep(retryAfterMs(res));
        continue;
      }
      if (res.ok) {
        // a create that Notion accepted but whose page object did not arrive: the row exists and its id is unknown
        if (isCreate && (unreadable || typeof data?.id !== 'string')) throw createUncertain(`Notion answered ${res.status}, but the answer could not be read`, res.status);
        return data ?? {};
      }
      const code = typeof data?.code === 'string' ? data.code : null;
      if (res.status >= 500 || res.status === 409) {
        if (isCreate) throw createUncertain(`Notion answered ${res.status}${code ? ` ${code}` : ''}: ${scrub(data?.message ?? res.statusText)}`, res.status);
        if (failed >= MAX_SERVER_RETRIES) {
          throw new NotionError(`Notion ${method} ${path} -> ${res.status}${code ? ` ${code}` : ''}: ${scrub(data?.message ?? res.statusText)} (gave up after ${MAX_SERVER_RETRIES} retries)`, { status: res.status, code, retryable: true });
        }
        await sleep(BACKOFF_MS[failed++]);
        continue;
      }
      throw new NotionError(`Notion ${method} ${path} -> ${res.status}${code ? ` ${code}` : ''}: ${scrub(data?.message ?? res.statusText)}`, { status: res.status, code, retryable: false });
    }
  }

  function brokenCursor(path, why) {
    const e = new Error(`Notion ${path}: broken cursor chain (${why})`);
    e.code = 'BROKEN_CURSOR';
    return e;
  }

  /** Every page of a database query, following next_cursor. Yields page objects. */
  async function* queryDatabase(databaseId, { filter, sorts, pageSize = 100 } = {}) {
    const path = `/databases/${enc(databaseId)}/query`;
    const seen = new Set();
    let cursor = null;
    do {
      const body = { page_size: pageSize };
      if (filter) body.filter = filter;
      if (sorts) body.sorts = sorts;
      if (cursor) body.start_cursor = cursor;
      const res = await request('POST', path, body);
      for (const page of res.results ?? []) yield page;
      cursor = res.has_more ? res.next_cursor ?? null : null;
      if (res.has_more && !cursor) throw brokenCursor(path, 'has_more is true but there is no next_cursor');
      if (cursor && seen.has(cursor)) throw brokenCursor(path, 'the same cursor came back twice');
      if (cursor) seen.add(cursor);
    } while (cursor);
  }

  async function queryAll(databaseId, opts = {}) {
    const pages = [];
    for await (const page of queryDatabase(databaseId, opts)) pages.push(page);
    return pages;
  }

  const retrieveDatabase = (databaseId) => request('GET', `/databases/${enc(databaseId)}`);
  const retrievePage = (pageId) => request('GET', `/pages/${enc(pageId)}`);

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
      cursor = res.has_more ? res.next_cursor ?? null : null;
      if (res.has_more && !cursor) throw brokenCursor(base, 'has_more is true but there is no next_cursor');
      if (cursor && seen.has(cursor)) throw brokenCursor(base, 'the same cursor came back twice');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return items;
  }

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

  const updatePage = (pageId, { properties }) => request('PATCH', `/pages/${enc(pageId)}`, { properties });

  return { queryDatabase, queryAll, retrieveDatabase, retrievePage, retrievePropertyItem, createPage, updatePage, appendBlocks };
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

/** A client built from config.json (notion.api_version, notion.requests_per_second) and the token in .env; null without a token. `token` overrides .env (tests). */
export function clientFromConfig(config, { fetchImpl, repoRoot, token, log, sleep, now } = {}) {
  const value = token ?? loadToken(repoRoot ?? defaultRepoRoot());
  if (!value) return null;
  return createClient({
    token: value,
    apiVersion: config?.notion?.api_version ?? DEFAULT_API_VERSION,
    requestsPerSecond: config?.notion?.requests_per_second ?? 3,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(log ? { log } : {}),
    ...(sleep ? { sleep } : {}),
    ...(now ? { now } : {}),
  });
}
