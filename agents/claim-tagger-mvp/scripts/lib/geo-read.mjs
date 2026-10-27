// The only door the scripts use to read Geo: a small GraphQL client that sends queries and nothing else.
//
//   validateGeoConfig(config)                         -> { ok, errors, geo }: checks the "geo" block of config.json (the block itself, or a whole config that has one)
//   createGeoClient({ geo, fetchImpl, log, sleep })   -> the client: send, debateTagged, details, paginateDebate, stats
//   debateTaggedQuery(geo, { spaceId, after, first }) -> { operationName, document, variables }: the frozen query for one page of Debate-tagged links in a space
//   detailsQuery(geo, ids)                            -> { operationName, document, variables }: the frozen query for up to geo.detail_batch entities by id
//   readClaim(entity, { geo, spaceId })               -> the fields of one claim as the pick reads them (name, created, sources, tags, topics, is factual)
//   geoRequestLogger(file, { now })                   -> a `log` for createGeoClient: one JSON line per HTTP attempt appended to `file`
//   countGeoRequests(file)                            -> { total, nonQuery } read back from such a file; nonQuery must always be 0
//   GeoError, GEO_ID, GEO_OPERATIONS, MIN_PAGE
//
// What it does not do, by design:
//   - It sends no write operation and no live feed. send() refuses, before anything leaves the machine, every document that does not start with
//     "query" or that contains one of the REFUSED_WORDS. The two documents the client builds are frozen templates; the only text put into
//     them is a 32-hex id that was checked first, and an integer. The cursor travels as a variable.
//   - It sends no credentials. The only header is Content-Type. A redirect is an error, so a request can never be handed to another host.
//   - It reaches only hosts listed in geo.allowed_hosts, over https.
//   - It never writes a request or a response body to the log: a log line holds ts, host, op (the operation name), status and attempt, nothing else.
//
// Retries follow content-management/lib/gql.mjs: a network error, an HTTP 5xx or 429, and a GraphQL error that matches /Unexpected error|Internal/i
// are tried again, three attempts in all, after 0.5 s and 1 s. When a page of Debate links still fails with a server-side error (a 5xx or an internal
// error), paginateDebate halves `first` (500, 250, 125, 62, 50 at the least) and asks for the same cursor again before it gives up.
//
// Field names are the ones content-management verified live (docs/mvp-2026-11/sweeps/geo-read-facts.md): relationsConnection(filter: {typeId, toEntityId,
// spaceId}, first, after) { nodes { spaceId fromEntityId toEntityId fromEntity { id name typeIds createdAt } } pageInfo { hasNextPage endCursor } } and
// entity(id:) { id name createdAt typeIds spaceIds values { nodes { spaceId property { id name } text ... } } relations { nodes { spaceId typeId toEntity { ... } } } }.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { readJsonl } from './jsonl.mjs';

export const GEO_ID = /^[0-9a-f]{32}$/;
export const GEO_OPERATIONS = Object.freeze(['DebateTagged', 'ClaimDetails']);
export const MIN_PAGE = 50; // the smallest page paginateDebate falls back to
export const MAX_PAGE = 1000; // Geo's own cap on `first`
export const MAX_DETAIL_BATCH = 25; // aliased entity(id:) calls per request, as the geo-mirror sends them
export const SPACE_COUNT = 6;
export const ATTEMPTS = 3;
export const BACKOFF_MS = Object.freeze([500, 1000]);
export const REQUEST_TIMEOUT_MS = 60000;

const REFUSED_WORDS = /\b(?:mutation|subscription)\b/i;
const FORBIDDEN_HEADER = /^(?:auth|proxy-auth|cookie|x-api)/i;
const TRANSIENT_GRAPHQL = /Unexpected error|Internal/i;
const OPERATION_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CURSOR = /^[A-Za-z0-9+/=_-]{1,4096}$/;
const LOGGED_KEYS = Object.freeze(['ts', 'host', 'op', 'status', 'attempt']);

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** An error from the Geo read path. kind: config, refused, network, http, internal, graphql, parse, shape. transient: the server (a 5xx or an internal error) could not answer. */
export class GeoError extends Error {
  constructor(message, { kind = 'error', transient = false, status = null, attempts = 0, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GeoError';
    this.kind = kind;
    this.transient = transient;
    this.status = status;
    this.attempts = attempts;
  }
}

// ---- the geo block of config.json -----------------------------------------------------------------------------------------------

/**
 * Check the "geo" block: an https endpoint on an allowlisted host, 32-hex ids, six spaces { name, id, quota } whose quotas add up to `total`, and the
 * paging sizes. Accepts the block itself or a whole config that has a `geo` key. Never throws: { ok, errors, geo } with a dotted path in front of each message.
 */
export function validateGeoConfig(config) {
  const errors = [];
  const bad = (path, message) => errors.push(`geo.${path}: ${message}`);
  const geo = isPlain(config) && isPlain(config.geo) && config.endpoint === undefined ? config.geo : config;
  if (!isPlain(geo)) return { ok: false, errors: ['geo: the config has no "geo" block'], geo: null };

  const httpsUrl = (path, value) => {
    if (typeof value !== 'string' || value.trim() !== value || value === '') return bad(path, 'expected an https URL'), null;
    let url;
    try {
      url = new URL(value);
    } catch {
      return bad(path, `"${value}" is not a URL`), null;
    }
    if (url.protocol !== 'https:') bad(path, `"${value}" must be https`);
    if (url.username || url.password) bad(path, 'a URL must not carry a user name or password');
    return url;
  };
  const hexId = (path, value) => {
    if (typeof value !== 'string' || !GEO_ID.test(value)) bad(path, `expected 32 lowercase hex characters, got ${JSON.stringify(value)}`);
  };
  const int = (path, value, min, max) => {
    if (!Number.isInteger(value) || value < min || value > max) bad(path, `expected a whole number from ${min} to ${max}, got ${JSON.stringify(value)}`);
  };

  const hosts = Array.isArray(geo.allowed_hosts) ? geo.allowed_hosts : null;
  if (!hosts || hosts.length === 0 || !hosts.every((h) => typeof h === 'string' && /^[a-z0-9.-]+(?::\d+)?$/.test(h))) {
    bad('allowed_hosts', 'expected a non-empty list of lowercase host names');
  }
  const endpoint = httpsUrl('endpoint', geo.endpoint);
  if (endpoint && hosts && !hosts.includes(endpoint.host)) bad('endpoint', `the host "${endpoint.host}" is not in allowed_hosts (${hosts.join(', ')})`);
  httpsUrl('browser_url', geo.browser_url);

  if (!isPlain(geo.ids)) {
    bad('ids', 'expected an object');
  } else {
    for (const key of ['debate', 'claim_type', 'tags', 'sources', 'web_url']) hexId(`ids.${key}`, geo.ids[key]);
    if (!Array.isArray(geo.ids.topics) || geo.ids.topics.length === 0) bad('ids.topics', 'expected a non-empty list of ids');
    else geo.ids.topics.forEach((id, i) => hexId(`ids.topics[${i}]`, id));
    for (const key of ['name_property', 'is_factual_property']) if (geo.ids[key] !== undefined && geo.ids[key] !== null) hexId(`ids.${key}`, geo.ids[key]);
  }

  int('total', geo.total, 1, 100000);
  int('page_size', geo.page_size, MIN_PAGE, MAX_PAGE);
  int('detail_batch', geo.detail_batch, 1, MAX_DETAIL_BATCH);
  if (!Array.isArray(geo.spaces) || geo.spaces.length !== SPACE_COUNT) {
    bad('spaces', `expected exactly ${SPACE_COUNT} spaces { name, id, quota }`);
  } else {
    let sum = 0;
    geo.spaces.forEach((s, i) => {
      if (!isPlain(s)) return bad(`spaces[${i}]`, 'expected an object { name, id, quota }');
      if (typeof s.name !== 'string' || s.name.trim() === '') bad(`spaces[${i}].name`, 'expected a name');
      hexId(`spaces[${i}].id`, s.id);
      int(`spaces[${i}].quota`, s.quota, 1, 100000);
      if (Number.isInteger(s.quota)) sum += s.quota;
    });
    const names = geo.spaces.map((s) => s?.name);
    const spaceIds = geo.spaces.map((s) => s?.id);
    if (new Set(names).size !== names.length) bad('spaces', 'two spaces have the same name');
    if (new Set(spaceIds).size !== spaceIds.length) bad('spaces', 'two spaces have the same id');
    if (Number.isInteger(geo.total) && sum !== geo.total) bad('spaces', `the quotas add up to ${sum}, but total is ${geo.total}`);
  }
  return { ok: errors.length === 0, errors, geo };
}

// ---- the frozen queries ---------------------------------------------------------------------------------------------------------

function checkedId(label, value) {
  if (typeof value !== 'string' || !GEO_ID.test(value)) throw new GeoError(`${label} is not a 32-character lowercase hex id: ${JSON.stringify(String(value).slice(0, 40))}`, { kind: 'refused' });
  return value;
}

/** The query for one page of the Debate links of a space. Only ids that passed the check and an integer go into the text; the cursor is a variable. */
export function debateTaggedQuery(geo, { spaceId, after = null, first = geo.page_size } = {}) {
  checkedId('spaceId', spaceId);
  if (!Number.isInteger(first) || first < 1 || first > MAX_PAGE) throw new GeoError(`first must be a whole number from 1 to ${MAX_PAGE}, got ${JSON.stringify(first)}`, { kind: 'refused' });
  if (after !== null && (typeof after !== 'string' || !CURSOR.test(after))) throw new GeoError('after must be null or a cursor string', { kind: 'refused' });
  const tags = checkedId('ids.tags', geo.ids.tags);
  const debate = checkedId('ids.debate', geo.ids.debate);
  const document = `query DebateTagged($after: Cursor) { relationsConnection(filter: {typeId: {is: "${tags}"}, toEntityId: {is: "${debate}"}, spaceId: {is: "${spaceId}"}}, first: ${first}, after: $after) { nodes { spaceId fromEntityId toEntityId fromEntity { id name typeIds createdAt } } pageInfo { hasNextPage endCursor } } }`;
  return { operationName: 'DebateTagged', document, variables: { after } };
}

const ENTITY_FIELDS = 'id name createdAt typeIds spaceIds '
  + 'values(first: 100) { nodes { spaceId property { id name } text datetime boolean integer float } } '
  + 'relations(first: 100) { nodes { spaceId typeId toEntity { id name values(first: 50) { nodes { spaceId property { id name } text } } } } }';

/** The query for up to geo.detail_batch entities by id, one aliased entity(id:) call each (e0, e1, ...). */
export function detailsQuery(geo, ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new GeoError('details needs at least one id', { kind: 'refused' });
  if (ids.length > geo.detail_batch) throw new GeoError(`details takes at most ${geo.detail_batch} ids per query, got ${ids.length}`, { kind: 'refused' });
  const aliases = ids.map((id, i) => `e${i}: entity(id: "${checkedId('entity id', id)}") { ${ENTITY_FIELDS} }`);
  return { operationName: 'ClaimDetails', document: `query ClaimDetails { ${aliases.join(' ')} }`, variables: undefined };
}

/** True for what Geo answers for an id it does not hold: an entity with no type and no space. */
export function entityIsStub(entity) {
  return !isPlain(entity) || ((entity.typeIds ?? []).length === 0 && (entity.spaceIds ?? []).length === 0);
}

// ---- the client -----------------------------------------------------------------------------------------------------------------

/**
 * A client for the Geo read API. fetchImpl, log and sleep are the hooks tests replace. `log` gets { host, op, status, attempt } for every HTTP attempt
 * (status is null when the network failed). Throws a GeoError of kind "config" when the geo block is not valid.
 */
export function createGeoClient({ geo, fetchImpl = globalThis.fetch, log = null, sleep = defaultSleep } = {}) {
  const checked = validateGeoConfig(geo);
  if (!checked.ok) throw new GeoError(`the geo block is not valid: ${checked.errors.join('; ')}`, { kind: 'config' });
  const block = checked.geo;
  const endpoint = new URL(block.endpoint);
  const stats = { attempts: 0, retries: 0, pages: 0, halvings: 0, detail_batches: 0 };

  function refuse(message) {
    throw new GeoError(`the Geo read path sends queries only: ${message}`, { kind: 'refused' });
  }

  /** POST one query document and return the `data` object of the answer; retried as the header says. */
  async function send(document, variables = undefined) {
    if (typeof document !== 'string') refuse('the document is not text');
    const text = document.trim();
    if (!/^query(?=[\s({])/.test(text)) refuse('the document does not start with "query"');
    if (REFUSED_WORDS.test(text)) refuse('the document names an operation that is not a read');
    if (!block.allowed_hosts.includes(endpoint.host)) refuse(`the host ${endpoint.host} is not allowed`);
    const op = /^query\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(text)?.[1] ?? 'anonymous';
    const headers = { 'Content-Type': 'application/json' };
    if (Object.keys(headers).some((h) => FORBIDDEN_HEADER.test(h))) refuse('a credential header is not allowed');
    const body = JSON.stringify(variables === undefined ? { query: text } : { query: text, variables });

    let last = null;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (attempt > 1) {
        stats.retries += 1;
        await sleep(BACKOFF_MS[attempt - 2] ?? BACKOFF_MS[BACKOFF_MS.length - 1]);
      }
      stats.attempts += 1;
      let res;
      try {
        res = await fetchImpl(block.endpoint, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (cause) {
        log?.({ host: endpoint.host, op, status: null, attempt });
        last = new GeoError(`Geo could not be reached (attempt ${attempt} of ${ATTEMPTS}): ${cause?.message ?? cause}`, { kind: 'network', attempts: attempt, cause });
        continue;
      }
      log?.({ host: endpoint.host, op, status: res.status, attempt });
      if (res.status >= 500 || res.status === 429) {
        last = new GeoError(`Geo answered HTTP ${res.status} (attempt ${attempt} of ${ATTEMPTS})`, { kind: 'http', transient: res.status >= 500, status: res.status, attempts: attempt });
        continue;
      }
      const raw = await res.text();
      let json;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new GeoError(`Geo answered something that is not JSON (HTTP ${res.status})`, { kind: 'parse', status: res.status, attempts: attempt });
      }
      if (Array.isArray(json?.errors) && json.errors.length > 0) {
        const message = json.errors.map((e) => String(e?.message ?? e)).join(' | ');
        if (TRANSIENT_GRAPHQL.test(message)) {
          last = new GeoError(`Geo answered an internal error (attempt ${attempt} of ${ATTEMPTS}): ${message}`, { kind: 'internal', transient: true, status: res.status, attempts: attempt });
          continue;
        }
        throw new GeoError(`Geo refused the query ${op}: ${message}`, { kind: 'graphql', status: res.status, attempts: attempt });
      }
      if (!res.ok) throw new GeoError(`Geo answered HTTP ${res.status}`, { kind: 'http', status: res.status, attempts: attempt });
      return json?.data ?? null;
    }
    throw new GeoError(`Geo did not answer ${op} after ${ATTEMPTS} attempts: ${last.message}`, { kind: last.kind, transient: last.transient, status: last.status, attempts: ATTEMPTS, cause: last });
  }

  /** One page of the Debate links of a space: { nodes, pageInfo: { hasNextPage, endCursor } }. */
  async function debateTagged(args) {
    const q = debateTaggedQuery(block, args);
    const data = await send(q.document, q.variables);
    const connection = data?.relationsConnection;
    if (!isPlain(connection) || !Array.isArray(connection.nodes) || !isPlain(connection.pageInfo)) {
      throw new GeoError('Geo answered relationsConnection in a shape this script does not know', { kind: 'shape' });
    }
    return {
      nodes: connection.nodes.filter((n) => isPlain(n)),
      pageInfo: { hasNextPage: connection.pageInfo.hasNextPage === true, endCursor: connection.pageInfo.endCursor ?? null },
    };
  }

  /** Every Debate link of a space, page after page. A server-side failure halves `first` (down to MIN_PAGE) and asks for the same cursor again. */
  async function paginateDebate(spaceId) {
    const nodes = [];
    const seen = new Set();
    let after = null;
    let first = block.page_size;
    for (;;) {
      let page;
      for (;;) {
        try {
          page = await debateTagged({ spaceId, after, first });
          break;
        } catch (e) {
          if (!(e instanceof GeoError) || !e.transient || first <= MIN_PAGE) throw e;
          first = Math.max(MIN_PAGE, Math.floor(first / 2));
          stats.halvings += 1;
        }
      }
      stats.pages += 1;
      nodes.push(...page.nodes);
      if (!page.pageInfo.hasNextPage) return nodes;
      const next = page.pageInfo.endCursor;
      if (typeof next !== 'string' || next === '' || seen.has(next)) throw new GeoError('Geo said there is another page but gave no new cursor', { kind: 'shape' });
      seen.add(next);
      after = next;
    }
  }

  async function detailsChunk(ids) {
    const q = detailsQuery(block, ids);
    stats.detail_batches += 1;
    let data;
    try {
      data = await send(q.document, q.variables);
    } catch (e) {
      if (e instanceof GeoError && e.transient && ids.length > 1) {
        const half = Math.ceil(ids.length / 2);
        return [...(await detailsChunk(ids.slice(0, half))), ...(await detailsChunk(ids.slice(half)))];
      }
      throw e;
    }
    return ids.map((id, i) => [id, data?.[`e${i}`] ?? null]);
  }

  /** The entities for a list of ids, in batches of geo.detail_batch: a Map from id to the entity (a stub for an id Geo does not hold). */
  async function details(ids) {
    const unique = [...new Set(ids.map((id) => checkedId('entity id', id)))];
    const out = new Map();
    for (let i = 0; i < unique.length; i += block.detail_batch) {
      for (const [id, entity] of await detailsChunk(unique.slice(i, i + block.detail_batch))) out.set(id, entity);
    }
    return out;
  }

  return { send, debateTagged, details, paginateDebate, stats, geo: block };
}

// ---- reading the fields of a claim ----------------------------------------------------------------------------------------------

const nodesOf = (connection) => (Array.isArray(connection?.nodes) ? connection.nodes.filter((n) => isPlain(n)) : []);
const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');
const byCodePoints = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function factualOf(value) {
  if (typeof value.boolean === 'boolean') return value.boolean;
  if (typeof value.text === 'string') {
    const t = value.text.trim().toLowerCase();
    if (t === 'true' || t === 'yes') return true;
    if (t === 'false' || t === 'no') return false;
  }
  for (const n of [value.integer, value.float]) {
    if (n !== null && n !== undefined && n !== '' && Number(n) === 1) return true;
    if (n !== null && n !== undefined && n !== '' && Number(n) === 0) return false;
  }
  return null;
}

/**
 * The fields of one claim entity as seen from one space (the space it was picked in): the Name value of that space, falling back to entity.name;
 * Is factual (by property name); and, from the relations of that space, the Tags, the Sources (with the Web URL of each target, the space's own value
 * first) and the Topics. Names are sorted so the same data always gives the same answer. `truncated` is true when a list came back full (100 values
 * or 100 relations), so some may be cut off.
 */
export function readClaim(entity, { geo, spaceId }) {
  const ids = geo.ids;
  const values = nodesOf(entity?.values);
  const relationsAll = nodesOf(entity?.relations);
  const here = (node) => node.spaceId === undefined || node.spaceId === null || node.spaceId === spaceId;
  const inSpaceFirst = (list) => [...list.filter((v) => v.spaceId === spaceId), ...list.filter((v) => v.spaceId !== spaceId)];

  const isName = (v) => (ids.name_property ? v.property?.id === ids.name_property : false) || v.property?.name === 'Name';
  const own = values.find((v) => v.spaceId === spaceId && isName(v) && trimmed(v.text) !== '');
  const name = own ? trimmed(own.text) : trimmed(entity?.name);

  let isFactual = null;
  const factualValues = values.filter((v) => (ids.is_factual_property ? v.property?.id === ids.is_factual_property : false) || v.property?.name === 'Is factual');
  for (const v of inSpaceFirst(factualValues)) {
    isFactual = factualOf(v);
    if (isFactual !== null) break;
  }

  const relations = relationsAll.filter(here);
  const targetName = (r) => trimmed(r.toEntity?.name);
  const tags = [...new Set(relations.filter((r) => r.typeId === ids.tags).map(targetName).filter((n) => n !== ''))].sort(byCodePoints);
  const topics = [...new Set(relations.filter((r) => ids.topics.includes(r.typeId)).map(targetName).filter((n) => n !== ''))].sort(byCodePoints);

  const browser = geo.browser_url.replace(/\/+$/, '');
  const seen = new Set();
  const sources = [];
  for (const r of relations.filter((x) => x.typeId === ids.sources && isPlain(x.toEntity) && typeof x.toEntity.id === 'string')) {
    if (seen.has(r.toEntity.id)) continue;
    seen.add(r.toEntity.id);
    const urlValues = nodesOf(r.toEntity.values).filter((v) => v.property?.id === ids.web_url && /^https?:\/\/\S+$/.test(trimmed(v.text)));
    const urlsIn = (list) => list.map((v) => trimmed(v.text)).sort(byCodePoints);
    const web = [...urlsIn(urlValues.filter((v) => v.spaceId === spaceId)), ...urlsIn(urlValues.filter((v) => v.spaceId !== spaceId))][0] ?? null;
    const geoUrl = `${browser}/space/${spaceId}/${r.toEntity.id}`;
    sources.push({ id: r.toEntity.id, name: targetName(r) || web || r.toEntity.id, url: web ?? geoUrl, has_web_url: web !== null });
  }
  sources.sort((a, b) => byCodePoints(a.name, b.name) || byCodePoints(a.id, b.id));

  const created = Number(entity?.createdAt);
  return {
    name,
    name_source: own ? 'own' : 'fallback',
    created_at: Number.isFinite(created) && entity?.createdAt !== null && entity?.createdAt !== '' ? created : null,
    is_factual: isFactual,
    tags,
    topics,
    sources,
    truncated: values.length >= 100 || relationsAll.length >= 100,
  };
}

// ---- the request log ------------------------------------------------------------------------------------------------------------

/** A `log` callback for createGeoClient: appends { ts, host, op, status, attempt } for every HTTP attempt to `file` (parent folders are created). Never a body, never variables. */
export function geoRequestLogger(file, { now = () => new Date() } = {}) {
  if (typeof file !== 'string' || file.trim() === '') throw new TypeError('geoRequestLogger: a file path is required');
  return ({ host, op, status, attempt }) => {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ ts: now().toISOString(), host, op, status, attempt })}\n`);
  };
}

/**
 * What a geoRequestLogger file says was sent: { total, nonQuery }, one count per line (per HTTP attempt). A line is a query when its op is the name of a
 * named operation; anything else (a missing or odd op, or a line that holds more than the five logged fields, which would mean a body got in) counts in
 * nonQuery, which must always be 0. A missing file is no requests at all; a half-written last line throws, because a count that cannot be trusted must
 * not pass for proof.
 */
export function countGeoRequests(file) {
  const { rows, torn } = readJsonl(file);
  if (torn) throw new Error(`${file}: the request log ends with a half-written line, so its count cannot be trusted`);
  let nonQuery = 0;
  for (const row of rows) {
    const keys = isPlain(row) ? Object.keys(row) : [];
    const plain = keys.length === LOGGED_KEYS.length && LOGGED_KEYS.every((k) => keys.includes(k));
    if (!plain || typeof row.op !== 'string' || !OPERATION_NAME.test(row.op) || REFUSED_WORDS.test(row.op)) nonQuery += 1;
  }
  return { total: rows.length, nonQuery };
}
