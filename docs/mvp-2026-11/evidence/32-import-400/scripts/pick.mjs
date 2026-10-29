// Pick the import from the scored sample: space targets, ~70% issue (Context-dependent first, then every other tag in turn), the rest near-misses then
// clean controls, every month of a space's pool represented where the scored claims allow. Writes selection.json and summary.json.
//   node pick.mjs <scratch dir> <claims.jsonl of a pull>
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { normaliseName } = await import(pathToFileURL('X:/work/geo-agents/agents/claim-tagger-mvp/scripts/lib/geo-row.mjs').href);
const [dir, claimsFile] = process.argv.slice(2);
const TARGET = { 'U.S. Politics': 100, 'World affairs': 100, AI: 80, Health: 60, Crypto: 40, Technology: 20 };
const ISSUE_SHARE = 0.7;
const CD = 'Context-dependent';
const OTHER_TAGS = ['Multi-sentence', 'Trailing period', 'Improper capitalization', 'Incorrect grammar', 'Poor wording', 'Wordy'];
const BOT = 'cc0bf85a27c217d75993bc785a15b198';

const pool = new Map(JSON.parse(readFileSync(join(dir, 'pool.json'), 'utf8')).claims.map((c) => [c.geo_id, c]));
const labels = new Map();
for (const f of readdirSync(join(dir, 'labels')).filter((f) => f.endsWith('.jsonl')).sort()) {
  for (const line of readFileSync(join(dir, 'labels', f), 'utf8').split('\n').filter((l) => l.trim())) {
    const l = JSON.parse(line);
    labels.set(l.id, l);
  }
}

// the two tags the text decides: the text is the truth, the label is corrected and the corrections counted
const trailing = (t) => /[^.]\.$/.test(t.trim()) && !/\b(?:[A-Z]\.){2,}$/.test(t.trim()) && !/\b(?:Inc|Ltd|Co|Corp|Jr|Sr|etc)\.$/.test(t.trim());
const corrections = { trailing_added: 0, trailing_removed: 0 };
// the Opus review of 29 October: labels it judged wrong (an accepted usage is not an error; a misfiled tag), applied before the pick
const OVERRIDES = {
  '70f9a00e20b1d22d72985aff291253fa': { tags: [], bucket: 'control', why: "review: 'their brain' is a standard distributive singular" },
  '8c57f1c02c545e9c9bda6207158c1371': { tags: [], bucket: 'control', why: "review: 'in general' carries meaning; not Wordy" },
  '448e144cdff252ebb6213c7a5e84bb84': { tags: ['Poor wording'], why: "review: 'predictions have not proven to be the case' is a semantic mismatch" },
  '0365ad407e6926c588dbd0a38a070010': { tags: [CD, 'Poor wording'], why: "review: 'Andy Beshear's Texas funding stance' needs an outside antecedent (rule 3)" },
  'c2f653ff5da86386981b637a2eba58f2': { tags: [CD, 'Poor wording'], why: "review: 'Trump's post-election green light' does not say which (rule 3)" },
  '1841d659f56450008365ebc05a981349': { tags: ['Wordy'], why: "review: 'harm the economy ... lower the GDP' is redundant" },
};
const scored = [];
for (const [id, raw] of labels) {
  const c = pool.get(id);
  if (!c) continue;
  const l = OVERRIDES[id] ? { ...raw, ...OVERRIDES[id], confidence: Math.max(Number(raw.confidence) || 0, 0.7) } : raw;
  const tags = new Set((l.tags ?? []).filter((t) => t === CD || OTHER_TAGS.includes(t)));
  if (trailing(c.name) && !tags.has('Trailing period')) { tags.add('Trailing period'); corrections.trailing_added += 1; }
  if (!trailing(c.name) && tags.has('Trailing period')) { tags.delete('Trailing period'); corrections.trailing_removed += 1; }
  const bucket = tags.size ? 'issue' : l.bucket === 'near_miss' ? 'near_miss' : 'control';
  scored.push({ ...c, tags: [...tags], confidence: Number(l.confidence) || 0, bucket, why: String(l.why ?? '').slice(0, 300) });
}

// the order inside a list: higher confidence first, then the id (stable)
const byConf = (a, b) => b.confidence - a.confidence || (a.geo_id < b.geo_id ? -1 : 1);

// issue slots: 70% of each space's target where its scored claims allow; what a space cannot fill goes to the spaces that have issue claims to spare,
// in the order of TARGET, one at a time, while each keeps at least 15% of its target for near-misses and controls
const issueSupply = (space) => scored.filter((c) => c.space === space && c.bucket === 'issue').length;
const ISSUE_SLOTS = {};
let deficit = 0;
for (const [space, n] of Object.entries(TARGET)) {
  const want = Math.round(n * ISSUE_SHARE);
  ISSUE_SLOTS[space] = Math.min(want, issueSupply(space));
  deficit += want - ISSUE_SLOTS[space];
}
const moved = deficit;
while (deficit > 0) {
  const open = Object.entries(TARGET).filter(([s, n]) => ISSUE_SLOTS[s] < Math.min(issueSupply(s), Math.floor(n * 0.85)));
  if (!open.length) break;
  for (const [s] of open) { if (deficit === 0) break; ISSUE_SLOTS[s] += 1; deficit -= 1; }
}

function pickSpace(space, n) {
  const mine = scored.filter((c) => c.space === space);
  const chosen = new Map();
  const take = (c, as) => { if (c && !chosen.has(c.geo_id)) chosen.set(c.geo_id, { ...c, as }); };
  const issueSlots = ISSUE_SLOTS[space];
  const issue = mine.filter((c) => c.bucket === 'issue');
  // Context-dependent first (the one judged tag, and the most precise labels), up to 60% of the issue slots
  const cd = issue.filter((c) => c.tags.includes(CD)).sort(byConf);
  for (const c of cd.slice(0, Math.ceil(issueSlots * 0.6))) take(c, 'issue');
  // then the other tags in turn, one at a time
  const queues = OTHER_TAGS.map((t) => issue.filter((c) => c.tags.includes(t)).sort(byConf));
  let turn = 0;
  while (chosen.size < issueSlots && queues.some((q) => q.length)) {
    const q = queues[turn % queues.length];
    turn += 1;
    while (q.length && chosen.has(q[0].geo_id)) q.shift();
    if (q.length) take(q.shift(), 'issue');
  }
  // what is left of the issue slots: the rest of the issue claims, Wordy resting on length alone last
  const lengthOnly = (c) => c.tags.length === 1 && c.tags[0] === 'Wordy' && /\b\d+\s+words\b|\blong\b|\blength\b/i.test(c.why);
  for (const c of issue.sort((a, b) => lengthOnly(a) - lengthOnly(b) || byConf(a, b))) { if (chosen.size >= issueSlots) break; take(c, 'issue'); }
  // the rest: near-misses for two thirds, clean controls for the rest, then whatever is left
  const rest = n - chosen.size;
  const near = mine.filter((c) => c.bucket === 'near_miss').sort(byConf);
  const clean = mine.filter((c) => c.bucket === 'control').sort(byConf);
  for (const c of near.slice(0, Math.round((rest * 2) / 3))) take(c, 'near_miss');
  for (const c of clean) { if (chosen.size >= n) break; take(c, 'control'); }
  for (const c of [...near, ...issue]) { if (chosen.size >= n) break; take(c, c.bucket); }
  // every month of the pool gets one where a scored claim of that month exists: it replaces the weakest pick of the fullest month, same bucket when possible
  const months = [...new Set([...pool.values()].filter((c) => c.space === space).map((c) => c.month))].sort();
  for (const m of months) {
    if ([...chosen.values()].some((c) => c.month === m)) continue;
    const cand = mine.filter((c) => c.month === m && !chosen.has(c.geo_id)).sort((a, b) => (a.bucket === 'issue' ? -1 : 0) - (b.bucket === 'issue' ? -1 : 0) || byConf(a, b))[0];
    if (!cand) continue;
    const count = {};
    for (const c of chosen.values()) count[c.month] = (count[c.month] ?? 0) + 1;
    const fullest = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
    const out = [...chosen.values()].filter((c) => c.month === fullest).sort((a, b) => (a.as === cand.bucket ? -1 : 1) - (b.as === cand.bucket ? -1 : 1) || a.confidence - b.confidence)[0];
    chosen.delete(out.geo_id);
    take(cand, cand.bucket);
  }
  return [...chosen.values()];
}

// space targets; a shortfall passes round-robin to the others
const picks = [];
let short = 0;
const room = {};
for (const [space, n] of Object.entries(TARGET)) {
  const got = pickSpace(space, n);
  picks.push(...got);
  short += n - got.length;
  room[space] = scored.filter((c) => c.space === space).length - got.length;
}
if (short > 0) throw new Error(`short by ${short}; spread not implemented because no space was short in the scored sample`);

// checks: unique ids, none in Claims, no repeated text, none by the bot
const held = new Set();
const heldText = new Set();
for (const line of readFileSync(claimsFile, 'utf8').split('\n').filter(Boolean)) {
  const c = JSON.parse(line);
  held.add(String(c.geo_id).replace(/-/g, '').toLowerCase());
  heldText.add(normaliseName(c.claim ?? ''));
}
const ids = new Set(picks.map((p) => p.geo_id));
const texts = new Set(picks.map((p) => normaliseName(p.name)));
const problems = [];
if (ids.size !== picks.length) problems.push('repeated geo id');
if (texts.size !== picks.length) problems.push('repeated text');
if (picks.some((p) => held.has(p.geo_id))) problems.push('a pick is in Claims');
if (picks.some((p) => heldText.has(normaliseName(p.name)))) problems.push('a pick has the text of a claim in Claims');
if (picks.some((p) => p.author === BOT)) problems.push('a pick is by the bot');
if (problems.length) throw new Error(problems.join('; '));

const selection = {
  run_id: '20261029-import-400',
  created_at: new Date().toISOString(),
  criteria_file: 'docs/mvp-2026-11/evidence/32-import-400/criteria.md',
  bot_spaces: [BOT],
  claims: picks.map((p) => ({
    geo_id: p.geo_id, space_id: p.space_id, space: p.space, name: p.name, month: p.month, published_at: p.published_at,
    bucket: p.as, predicted_tags: p.tags, why: p.why,
  })),
};
writeFileSync(join(dir, 'selection.json'), `${JSON.stringify(selection, null, 1)}\n`);

const count = (key) => picks.reduce((m, p) => ((m[key(p)] = (m[key(p)] ?? 0) + 1), m), {});
const tagCount = {};
for (const p of picks) for (const t of p.tags) tagCount[t] = (tagCount[t] ?? 0) + 1;
const scoredTags = {};
for (const c of scored) for (const t of c.tags) scoredTags[t] = (scoredTags[t] ?? 0) + 1;
const summary = {
  picked: picks.length, issue_slots: ISSUE_SLOTS, issue_slots_moved: moved, issue_slots_unfilled: deficit, by_space: count((p) => p.space),
  by_space_bucket: count((p) => `${p.space} ${p.as}`), by_bucket: count((p) => p.as), by_month: count((p) => p.month),
  by_space_month: count((p) => `${p.space} ${p.month}`), by_tag: tagCount,
  scored: scored.length, scored_by_bucket: scored.reduce((m, c) => ((m[c.bucket] = (m[c.bucket] ?? 0) + 1), m), {}), scored_by_tag: scoredTags, corrections,
};
writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
console.log(JSON.stringify(summary, null, 1));
