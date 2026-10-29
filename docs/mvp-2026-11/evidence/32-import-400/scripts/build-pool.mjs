// Build the candidate pool: Claim-typed Debate claims of the allowed spaces, not in Claims, not the same text, with the author and time of the edit
// that first set their name; drops the Geo bot's. Reads Geo only through lib/geo-read.mjs (queries only), one request log.
//   node build-pool.mjs <scratch dir> <claims.jsonl of a pull>
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'X:/work/geo-agents/agents/claim-tagger-mvp';
const lib = (f) => import(pathToFileURL(join(REPO, 'scripts', 'lib', f)).href);
const { createGeoClient, geoRequestLogger, countGeoRequests } = await lib('geo-read.mjs');
const { normaliseName } = await lib('geo-row.mjs');

const [dir, claimsFile] = process.argv.slice(2);
const config = JSON.parse(readFileSync(join(REPO, 'config.json'), 'utf8'));
const ALLOWED = [
  ['U.S. Politics', '4582fbbee28a16589154f7e36f1ee3c5'], ['World affairs', '89bd89bf28ff8a0963faf92a8c905e20'], ['AI', '41e851610e13a19441c4d980f2f2ce6b'],
  ['Health', '52c7ae149838b6d47ce0f3b2a5974546'], ['Crypto', 'c9f267dcb0d270718c2a3c45a64afd32'], ['Technology', '870e3b3068661e6280fad2ab456829bc'],
  ['Pharma', '19f11bc6f1a62ac434936af814d1f8b5'], ['Industries', 'd69608290513c2a91102c939b3265bd7'], ['Education', 'ec349623f33236aee13c12dcd629ee81'],
  ['Software', '9b611b848b12491b9b6b43f3cf019b8b'], ['Places', '84a679ce188f061ac9a92380bac2bab5'], ['Documentation', '784bfddae3f3976118c561bf28195b44'],
];
const BOT = 'cc0bf85a27c217d75993bc785a15b198';
const CLAIM_TYPE = config.geo.ids.claim_type;
const NAME_PROP = config.geo.ids.name_property;
const flat = (s) => String(s ?? '').replace(/-/g, '').toLowerCase();

// what Claims holds
const held = new Set();
const heldText = new Set();
for (const line of readFileSync(claimsFile, 'utf8').split('\n').filter(Boolean)) {
  const c = JSON.parse(line);
  held.add(flat(c.geo_id));
  const t = normaliseName(c.claim ?? '');
  if (t) heldText.add(t);
}

// the pool, first allowed space wins
const stats = {};
const pool = new Map();
const seenText = new Set();
for (const [space, sid] of ALLOWED) {
  const s = (stats[space] = { edges: 0, not_claim: 0, no_name: 0, other_space_first: 0, in_claims: 0, same_text: 0, kept: 0 });
  const file = join(dir, 'pool', `${sid}.json`);
  const { nodes } = JSON.parse(readFileSync(file, 'utf8'));
  for (const n of nodes) {
    s.edges += 1;
    const e = n.fromEntity;
    const id = flat(e?.id);
    if (!e || !(e.typeIds ?? []).map(flat).includes(CLAIM_TYPE)) { s.not_claim += 1; continue; }
    const name = String(e.name ?? '').trim();
    if (!name) { s.no_name += 1; continue; }
    if (pool.has(id)) { s.other_space_first += 1; continue; }
    if (held.has(id)) { s.in_claims += 1; continue; }
    const t = normaliseName(name);
    if (heldText.has(t) || seenText.has(t)) { s.same_text += 1; continue; }
    seenText.add(t);
    pool.set(id, { geo_id: id, space, space_id: sid, name, created_at: e.createdAt ?? null });
    s.kept += 1;
  }
}

// authorship: the earliest name value of each claim -> its edit -> createdById, createdAt
const logFile = join(dir, 'authorship-requests.jsonl');
const client = createGeoClient({ geo: config.geo, log: geoRequestLogger(logFile) });
const ids = [...pool.keys()];
const firstKey = new Map();
for (let i = 0; i < ids.length; i += 100) {
  const batch = ids.slice(i, i + 100);
  let after = null;
  for (;;) {
    const data = await client.send(
      `query NameVersions($ids: [UUID!], $after: Cursor) { valueVersionsConnection(filter: {entityId: {in: $ids}, propertyId: {is: "${NAME_PROP}"}}, first: 1000, after: $after) { nodes { entityId validFromKey } pageInfo { hasNextPage endCursor } } }`,
      { ids: batch, after },
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
  const batch = keys.slice(i, i + 200);
  const data = await client.send(
    `query CreatingEdits($keys: [BigInt!]) { editVersionsConnection(filter: {versionKey: {in: $keys}}, first: 1000) { nodes { versionKey createdAt createdById name } } }`,
    { keys: batch },
  );
  for (const n of data.editVersionsConnection.nodes) edits.set(String(n.versionKey), n);
}

const out = [];
const authors = {};
let bot = 0;
let unknown = 0;
for (const c of pool.values()) {
  const k = firstKey.get(c.geo_id);
  const ed = k === undefined ? null : edits.get(String(k));
  const author = ed ? flat(ed.createdById) : null;
  if (!ed) unknown += 1;
  authors[author ?? 'unknown'] = (authors[author ?? 'unknown'] ?? 0) + 1;
  if (author === BOT) { bot += 1; stats[c.space].bot = (stats[c.space].bot ?? 0) + 1; continue; }
  const publishedAt = ed?.createdAt ? `${ed.createdAt.replace(/Z?$/, 'Z')}` : null;
  out.push({ ...c, author, published_at: publishedAt, month: (publishedAt ?? new Date(Number(c.created_at) * 1000).toISOString()).slice(0, 7), edit_name: ed?.name ?? null });
}
const requests = countGeoRequests(logFile);
writeFileSync(join(dir, 'pool.json'), JSON.stringify({ stats, bot, unknown_author: unknown, authors, requests, claims: out }, null, 1));
console.log(JSON.stringify({ stats, bot, unknown_author: unknown, top_authors: Object.entries(authors).sort((a, b) => b[1] - a[1]).slice(0, 8), requests, kept: out.length }, null, 1));
