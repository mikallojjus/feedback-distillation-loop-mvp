// The vote-backed pool for the replacement of 3 Nov 2026 (P52): Claim-typed Debate claims of the allowed spaces with at least one agree and one
// disagree vote, first allowed space wins, not by the Geo bot, no repeated text inside the pool. Claims already in v2 stay in (the overlap is kept).
// Reads Geo only through lib/geo-read.mjs (queries only), with one request log.
//   node build-pool.mjs <scratch dir> <claims.jsonl of a v2 pull>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'X:/work/geo-agents/agents/claim-tagger-mvp';
const lib = (f) => import(pathToFileURL(join(REPO, 'scripts', 'lib', f)).href);
const { createGeoClient, geoRequestLogger, countGeoRequests } = await lib('geo-read.mjs');
const { normaliseName } = await lib('geo-row.mjs');

const [dir, claimsFile] = process.argv.slice(2);
const config = JSON.parse(readFileSync(join(REPO, 'config.json'), 'utf8'));
const geo = config.geo;
const ALLOWED = (geo.allowed_spaces ?? geo.spaces).map((s) => [s.name, s.id]);
const BOTS = new Set(geo.bot_spaces ?? []);
const CLAIM_TYPE = geo.ids.claim_type;
const NAME_PROP = geo.ids.name_property;
const flat = (s) => String(s ?? '').replace(/-/g, '').toLowerCase();

const inV2 = new Map();
for (const line of readFileSync(claimsFile, 'utf8').split('\n').filter(Boolean)) {
  const c = JSON.parse(line);
  inV2.set(flat(c.geo_id), c.claim ?? '');
}

const logFile = join(dir, 'pool-requests.jsonl');
const client = createGeoClient({ geo, log: geoRequestLogger(logFile) });
const POOL = `query Pool($after: Cursor, $space: UUID!) { relationsConnection(filter: {typeId: {is: "${geo.ids.tags}"}, toEntityId: {is: "${geo.ids.debate}"}, spaceId: {is: $space}}, first: 500, after: $after) { nodes { fromEntity { id name typeIds spaceIds createdAt agrees disagrees } } pageInfo { hasNextPage endCursor } } }`;

const stats = {};
const pool = new Map();
for (const [space, sid] of ALLOWED) {
  const s = (stats[space] = { edges: 0, not_claim: 0, no_name: 0, no_votes_both: 0, other_space_first: 0, kept: 0 });
  let after = null;
  for (;;) {
    const data = await client.send(POOL, { space: sid, after });
    const conn = data.relationsConnection;
    for (const n of conn.nodes) {
      s.edges += 1;
      const e = n.fromEntity;
      const id = flat(e?.id);
      if (!e || !(e.typeIds ?? []).map(flat).includes(CLAIM_TYPE)) { s.not_claim += 1; continue; }
      const name = String(e.name ?? '').trim();
      if (!name) { s.no_name += 1; continue; }
      const agrees = Number(e.agrees ?? 0);
      const disagrees = Number(e.disagrees ?? 0);
      if (!(agrees >= 1 && disagrees >= 1)) { s.no_votes_both += 1; continue; }
      if (pool.has(id)) { s.other_space_first += 1; continue; }
      pool.set(id, { geo_id: id, space, space_id: sid, name, created_at: e.createdAt ?? null, agrees, disagrees, in_v2: inV2.has(id) });
      s.kept += 1;
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
}

// authorship: the earliest Name value -> its edit -> createdById and createdAt
const ids = [...pool.keys()];
const firstKey = new Map();
for (let i = 0; i < ids.length; i += 100) {
  let after = null;
  for (;;) {
    const data = await client.send(
      `query NameVersions($ids: [UUID!], $after: Cursor) { valueVersionsConnection(filter: {entityId: {in: $ids}, propertyId: {is: "${NAME_PROP}"}}, first: 1000, after: $after) { nodes { entityId validFromKey } pageInfo { hasNextPage endCursor } } }`,
      { ids: ids.slice(i, i + 100), after },
    );
    const conn = data.valueVersionsConnection;
    for (const v of conn.nodes) {
      const id = flat(v.entityId);
      const k = BigInt(v.validFromKey);
      if (!firstKey.has(id) || k < firstKey.get(id)) firstKey.set(id, k);
    }
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
}
const keys = [...new Set([...firstKey.values()].map(String))];
const edits = new Map();
for (let i = 0; i < keys.length; i += 200) {
  const data = await client.send(
    'query CreatingEdits($keys: [BigInt!]) { editVersionsConnection(filter: {versionKey: {in: $keys}}, first: 1000) { nodes { versionKey createdAt createdById name } } }',
    { keys: keys.slice(i, i + 200) },
  );
  for (const n of data.editVersionsConnection.nodes) edits.set(String(n.versionKey), n);
}

const out = [];
const seenText = new Map();
let bot = 0;
let unknown = 0;
let sameText = 0;
// claims already in v2 first, so a repeated text keeps the one v2 holds
for (const c of [...pool.values()].sort((a, b) => Number(b.in_v2) - Number(a.in_v2) || (a.geo_id < b.geo_id ? -1 : 1))) {
  const k = firstKey.get(c.geo_id);
  const ed = k === undefined ? null : edits.get(String(k));
  const author = ed ? flat(ed.createdById) : null;
  if (!ed) { unknown += 1; stats[c.space].unknown_author = (stats[c.space].unknown_author ?? 0) + 1; continue; }
  if (BOTS.has(author)) { bot += 1; stats[c.space].bot = (stats[c.space].bot ?? 0) + 1; continue; }
  const t = normaliseName(c.name);
  if (seenText.has(t)) { sameText += 1; stats[c.space].same_text = (stats[c.space].same_text ?? 0) + 1; continue; }
  seenText.set(t, c.geo_id);
  const publishedAt = ed.createdAt ? `${ed.createdAt.replace(/Z?$/, 'Z')}` : null;
  out.push({ ...c, author, published_at: publishedAt, month: (publishedAt ?? new Date(Number(c.created_at) * 1000).toISOString()).slice(0, 7), edit_name: ed.name ?? null });
}
const requests = countGeoRequests(logFile);
writeFileSync(join(dir, 'pool.json'), JSON.stringify({ read_at: new Date().toISOString(), stats, bot, unknown_author: unknown, same_text: sameText, requests, claims: out }, null, 1));
const bySpace = {};
for (const c of out) bySpace[c.space] = (bySpace[c.space] ?? 0) + 1;
console.log(JSON.stringify({ kept: out.length, in_v2: out.filter((c) => c.in_v2).length, bySpace, bot, unknown_author: unknown, same_text: sameText, requests }, null, 1));
