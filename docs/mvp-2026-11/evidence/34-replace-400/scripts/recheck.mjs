// Re-check picks live: the Debate edge in the pick's space, the Claim type, the space, both vote counts, and the author of the edit that first set the name.
//   node recheck.mjs <scratch dir> <n> <seed>      (writes review-sample.jsonl too: 40 picks for the reviewer)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'X:/work/geo-agents/agents/claim-tagger-mvp';
const { createGeoClient, geoRequestLogger, countGeoRequests } = await import(pathToFileURL(join(REPO, 'scripts/lib/geo-read.mjs')).href);
const { mulberry32, seedFromString } = await import(pathToFileURL('X:/work/geo-agents/agents/claim-tagger/scripts/lib/rng.mjs').href);
const [dir, nText, seed] = process.argv.slice(2);
const config = JSON.parse(readFileSync(join(REPO, 'config.json'), 'utf8'));
const sel = JSON.parse(readFileSync(join(dir, 'selection.json'), 'utf8'));
const rnd = mulberry32(seedFromString(seed));
const shuffled = [...sel.claims].sort((a, b) => (a.geo_id < b.geo_id ? -1 : 1));
for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
const picks = shuffled.slice(0, Number(nText));

const logFile = join(dir, 'recheck-requests.jsonl');
const client = createGeoClient({ geo: config.geo, log: geoRequestLogger(logFile) });
const rows = [];
for (const p of picks) {
  const d = await client.send(
    `query Recheck($id: UUID!, $space: UUID!) { entity(id: $id) { name typeIds spaceIds agrees disagrees } relationsConnection(filter: {fromEntityId: {is: $id}, typeId: {is: "${config.geo.ids.tags}"}, toEntityId: {is: "${config.geo.ids.debate}"}, spaceId: {is: $space}}, first: 5) { totalCount } valueVersionsConnection(filter: {entityId: {is: $id}, propertyId: {is: "${config.geo.ids.name_property}"}}, first: 50) { nodes { validFromKey } } }`,
    { id: p.geo_id, space: p.space_id },
  );
  const first = d.valueVersionsConnection.nodes.map((n) => BigInt(n.validFromKey)).sort((a, b) => (a < b ? -1 : 1))[0];
  const e = await client.send('query Author($k: BigInt!) { editVersionsConnection(filter: {versionKey: {is: $k}}, first: 1) { nodes { createdById createdAt } } }', { k: String(first) });
  const author = e.editVersionsConnection.nodes[0]?.createdById?.replace(/-/g, '') ?? null;
  rows.push({
    geo_id: p.geo_id, space: p.space, debate_edge: d.relationsConnection.totalCount > 0, claim_type: d.entity.typeIds.map((x) => x.replace(/-/g, '')).includes(config.geo.ids.claim_type),
    in_space: d.entity.spaceIds.map((x) => x.replace(/-/g, '')).includes(p.space_id), author, bot: sel.bot_spaces.includes(author), name_matches: d.entity.name.trim() === p.name.trim(), agrees: Number(d.entity.agrees), disagrees: Number(d.entity.disagrees), votes_ok: Number(d.entity.agrees) >= 1 && Number(d.entity.disagrees) >= 1,
  });
}
const ok = rows.every((r) => r.debate_edge && r.claim_type && r.in_space && !r.bot && r.author && r.votes_ok);
console.log(JSON.stringify({ ok, requests: countGeoRequests(logFile), rows }, null, 1));

// the reviewer's sample: 25 issue (every tag first), 10 near-miss, 5 control
const pickBy = (bucket, k, tagFirst) => {
  const list = shuffled.filter((c) => c.bucket === bucket);
  const out = [];
  if (tagFirst) for (const t of ['Trailing period', 'Multi-sentence', 'Improper capitalization', 'Incorrect grammar', 'Poor wording', 'Wordy']) {
    const c = list.find((x) => x.predicted_tags.includes(t) && !out.includes(x));
    if (c) out.push(c);
  }
  for (const c of list) { if (out.length >= k) break; if (!out.includes(c)) out.push(c); }
  return out;
};
const review = [...pickBy('issue', 25, true), ...pickBy('near_miss', 10), ...pickBy('control', 5)];
writeFileSync(join(dir, 'review-sample.jsonl'), `${review.map((c) => JSON.stringify({ geo_id: c.geo_id, space: c.space, text: c.name, bucket: c.bucket, predicted_tags: c.predicted_tags, why: c.why })).join('\n')}\n`);
