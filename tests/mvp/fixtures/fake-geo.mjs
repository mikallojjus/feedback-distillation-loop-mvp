// An in-memory Geo GraphQL server for the tests, behind the `fetchImpl` hook of lib/geo-read.mjs. Nothing here touches the network.
//
//   const fake = createFakeGeo({ geo });          // geo: the "geo" block of config.json (its ids and spaces are the ones the fake answers for)
//   fake.addClaim({ id, name, spaces: [spaceId], created: '2026-09-14', tags: ['Debate', 'Politics'], sources: [{ id, name, url }], ... })
//   fake.addEntity({ id, name, typeIds, spaceIds, createdAt })   // anything that is not a claim
//   fake.hideDetailsOf(id)                         // the details of this id come back as a stub, though the Debate listing holds it
//   fake.fetchImpl                                 // pass to createGeoClient / runPick
//   fake.failNext('500' | '429' | 'internal' | 'network' | 'graphql' | 'html', count = 1, { op })   // the next request(s) fail that way (count may be Infinity)
//   fake.requests                                  // every request received: { op, query, variables, headers, first, after, rejected }
//
// It recognises the two operations of the read path by operation name: DebateTagged (paged edges with opaque cursors, the same filter as the live
// query) and ClaimDetails (aliased entity(id:) calls, a stub for an id it does not hold, as Geo answers). It rejects any document that contains the
// word for a write with HTTP 400 and marks the request as rejected, and it answers `Internal` for a page larger than `internalAbove` so the halving of
// `first` can be tested. The answers carry the fields the read path asks for and nothing the live API does not have.

const MONTH_NOON = (day) => Math.floor(Date.parse(`${day}T12:00:00Z`) / 1000);
const FAKE_FACTUAL_PROPERTY = 'f'.repeat(32);
const TYPES_RELATION = '8f151ba4de204e3c9cb499ddf96f48f1';
const WRITE_WORD = /\b(?:mutation|subscription)\b/i;

/** A 32-hex id built from a number (and a lead letter so different kinds of id never meet). */
export function hexId(n, lead = 'c') {
  return lead + Number(n).toString(16).padStart(31, '0');
}

/** The createdAt string Geo gives (Unix seconds) for a day written YYYY-MM-DD. */
export function unixOf(day) {
  return String(MONTH_NOON(day));
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const cursorOf = (key) => Buffer.from(JSON.stringify(['primary_key_asc', [key]])).toString('base64');
const keyOf = (cursor) => JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'))[1][0];

export function createFakeGeo({ geo, internalAbove = Infinity } = {}) {
  const entities = new Map();
  const edges = [];
  const requests = [];
  const failures = [];
  const hidden = new Set(); // ids whose details are answered as a stub, though the Debate listing holds them
  let ordinal = 0;
  const tagId = (name) => hexId([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 0xffffff, 7), 'd');

  function addEntity({ id, name = '', typeIds = [], spaceIds = [], createdAt = null, values = [], relations = [] }) {
    entities.set(id, { id, name, typeIds, spaceIds, createdAt, values, relations });
    return id;
  }

  /** A claim tagged Debate in each of `spaces`. created: 'YYYY-MM-DD'. ownName: the Name value in the first space (default: the name; null: none). */
  function addClaim({
    id, name, spaces, created, tags = [], sources = [], topics = [], isFactual, ownName, typeIds = [geo.ids.claim_type], repeatEdge = false, extraRelations = [],
  }) {
    const home = spaces[0];
    const values = [];
    const own = ownName === undefined ? name : ownName;
    if (own !== null) values.push({ spaceId: home, property: { id: geo.ids.name_property, name: 'Name' }, text: own, datetime: null, boolean: null, integer: null, float: null });
    if (typeof isFactual === 'boolean') values.push({ spaceId: home, property: { id: FAKE_FACTUAL_PROPERTY, name: 'Is factual' }, text: null, datetime: null, boolean: isFactual, integer: null, float: null });
    const relations = [];
    for (const spaceId of spaces) {
      for (const tag of ['Debate', ...tags]) {
        const tagEntity = tag === 'Debate' ? geo.ids.debate : tagId(tag);
        relations.push({ spaceId, typeId: geo.ids.tags, toEntity: { id: tagEntity, name: tag, values: { nodes: [] } } });
      }
      relations.push({ spaceId, typeId: TYPES_RELATION, toEntity: { id: geo.ids.claim_type, name: 'Claim', values: { nodes: [] } } });
      for (const s of sources) {
        const webValues = (s.urls ?? (s.url ? [{ url: s.url, spaceId }] : [])).map((u) => ({ spaceId: u.spaceId ?? spaceId, property: { id: geo.ids.web_url, name: 'Web URL' }, text: u.url }));
        relations.push({ spaceId, typeId: geo.ids.sources, toEntity: { id: s.id, name: s.name, values: { nodes: webValues } } });
      }
      for (const t of topics) relations.push({ spaceId, typeId: geo.ids.topics[0], toEntity: { id: tagId(`topic:${t}`), name: t, values: { nodes: [] } } });
    }
    relations.push(...extraRelations);
    addEntity({ id, name, typeIds, spaceIds: spaces, createdAt: created === null ? null : unixOf(created), values, relations });
    for (const spaceId of spaces) {
      edges.push({ spaceId, fromEntityId: id, ordinal: ordinal++ });
      if (repeatEdge && spaceId === home) edges.push({ spaceId, fromEntityId: id, ordinal: ordinal++ });
    }
    return id;
  }

  function failNext(kind, count = 1, { op = null } = {}) {
    failures.push({ kind, remaining: count, op });
  }

  const stub = (id) => ({ id, name: null, createdAt: null, typeIds: [], spaceIds: [], values: { nodes: [] }, relations: { nodes: [] } });
  const detail = (e) => ({ id: e.id, name: e.name, createdAt: e.createdAt, typeIds: e.typeIds, spaceIds: e.spaceIds, values: { nodes: e.values }, relations: { nodes: e.relations } });

  function takeFailure(op) {
    const f = failures.find((x) => x.remaining > 0 && (x.op === null || x.op === op));
    if (!f) return null;
    f.remaining -= 1;
    return f.kind;
  }

  async function fetchImpl(url, init = {}) {
    const body = JSON.parse(init.body);
    const query = String(body.query ?? '');
    const record = {
      url: String(url),
      method: init.method,
      headers: { ...init.headers },
      query,
      variables: body.variables,
      op: /^\s*query\s+([A-Za-z_]\w*)/.exec(query)?.[1] ?? null,
      first: null,
      after: body.variables?.after ?? null,
      rejected: false,
    };
    if (record.op === 'DebateTagged') record.first = Number(/\}\}, first: (\d+)/.exec(query)?.[1] ?? NaN);
    requests.push(record);

    const failure = takeFailure(record.op);
    if (failure === 'network') throw new TypeError('fetch failed');
    if (failure === '500') return new Response('Internal Server Error', { status: 500 });
    if (failure === '429') return new Response('Too Many Requests', { status: 429 });
    if (failure === 'internal') return json(200, { errors: [{ message: 'Unexpected error.' }], data: null });
    if (failure === 'graphql') return json(200, { errors: [{ message: 'Cannot query field "bogus" on type "Entity".' }] });
    if (failure === 'html') return new Response('<html>bad gateway</html>', { status: 200 });

    if (WRITE_WORD.test(query)) {
      record.rejected = true;
      return json(400, { errors: [{ message: 'this fake server answers queries only' }] });
    }

    if (record.op === 'DebateTagged') {
      const m = /typeId: \{is: "([0-9a-f]{32})"\}, toEntityId: \{is: "([0-9a-f]{32})"\}, spaceId: \{is: "([0-9a-f]{32})"\}\}, first: (\d+)/.exec(query);
      if (!m) return json(400, { errors: [{ message: 'the fake does not know this filter' }] });
      const [, typeId, toEntityId, spaceId] = m;
      const first = Number(m[4]);
      record.first = first;
      if (first > 1000) return json(200, { errors: [{ message: 'first must be at most 1000' }] });
      if (first > internalAbove) return json(200, { errors: [{ message: 'Internal server error' }] });
      let list = [];
      if (typeId === geo.ids.tags && toEntityId === geo.ids.debate) {
        list = edges.filter((e) => e.spaceId === spaceId).map((e) => ({ ...e, key: `${e.fromEntityId}-${String(e.ordinal).padStart(8, '0')}` })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      }
      if (record.after) {
        const after = keyOf(record.after);
        list = list.filter((e) => e.key > after);
      }
      const page = list.slice(0, first);
      const nodes = page.map((e) => {
        const ent = entities.get(e.fromEntityId);
        return {
          spaceId: e.spaceId,
          fromEntityId: e.fromEntityId,
          toEntityId: geo.ids.debate,
          fromEntity: ent ? { id: ent.id, name: ent.name, typeIds: ent.typeIds, createdAt: ent.createdAt } : null,
        };
      });
      const hasNextPage = list.length > page.length;
      return json(200, { data: { relationsConnection: { nodes, pageInfo: { hasNextPage, endCursor: page.length ? cursorOf(page[page.length - 1].key) : null } } } });
    }

    if (record.op === 'ClaimDetails') {
      const data = {};
      for (const m of query.matchAll(/(e\d+): entity\(id: "([0-9a-f]{32})"\)/g)) {
        const ent = entities.get(m[2]);
        data[m[1]] = ent && !hidden.has(m[2]) ? detail(ent) : stub(m[2]);
      }
      record.aliases = Object.keys(data).length;
      return json(200, { data });
    }

    return json(400, { errors: [{ message: `the fake does not know the operation ${record.op}` }] });
  }

  return {
    fetchImpl,
    addClaim,
    addEntity,
    failNext,
    hideDetailsOf: (id) => hidden.add(id),
    requests,
    entities,
    edgesIn: (spaceId) => edges.filter((e) => e.spaceId === spaceId).length,
    requestsFor: (op) => requests.filter((r) => r.op === op),
  };
}
