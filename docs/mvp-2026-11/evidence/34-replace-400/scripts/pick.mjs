// Pick the replacement set of 3 Nov 2026 (P52) from the vote-backed pool: score = total votes x balance (min/max of agree and disagree), ties broken
// by likely-issue confidence, then total votes, then the Geo ID; no space quotas; every month of a space's pool keeps at least one claim where it can.
// Writes selection.json and summary.json.
//   node pick.mjs <scratch dir> <labels dir of 29 Oct> <claims.jsonl of a v2 pull> [count]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { normaliseName } = await import(pathToFileURL('X:/work/geo-agents/agents/claim-tagger-mvp/scripts/lib/geo-row.mjs').href);
const [dir, oldLabels, claimsFile, countText] = process.argv.slice(2);
const COUNT = Number(countText ?? 400);
const BOT = JSON.parse(readFileSync('X:/work/geo-agents/agents/claim-tagger-mvp/config.json', 'utf8')).geo.bot_spaces;
const TAGS = ['Context-dependent', 'Trailing period', 'Multi-sentence', 'Improper capitalization', 'Incorrect grammar', 'Poor wording', 'Wordy'];

const pool = JSON.parse(readFileSync(join(dir, 'pool.json'), 'utf8')).claims;
const labels = new Map();
for (const d of [oldLabels, join(dir, 'labels')]) {
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d).filter((f) => f.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(join(d, f), 'utf8').split('\n').filter((l) => l.trim())) {
      const l = JSON.parse(line);
      labels.set(l.id, l);
    }
  }
}
// the corrections of the Opus review of 29 October (evidence/32-import-400/scripts/pick.mjs)
const OVERRIDES = {
  '70f9a00e20b1d22d72985aff291253fa': { tags: [], bucket: 'control', why: "review: 'their brain' is a standard distributive singular" },
  '8c57f1c02c545e9c9bda6207158c1371': { tags: [], bucket: 'control', why: "review: 'in general' carries meaning; not Wordy" },
  '448e144cdff252ebb6213c7a5e84bb84': { tags: ['Poor wording'], why: "review: 'predictions have not proven to be the case' is a semantic mismatch" },
  '0365ad407e6926c588dbd0a38a070010': { tags: ['Context-dependent', 'Poor wording'], why: "review: 'Andy Beshear's Texas funding stance' needs an outside antecedent (rule 3)" },
  'c2f653ff5da86386981b637a2eba58f2': { tags: ['Context-dependent', 'Poor wording'], why: "review: 'Trump's post-election green light' does not say which (rule 3)" },
  '1841d659f56450008365ebc05a981349': { tags: ['Wordy'], why: "review: 'harm the economy ... lower the GDP' is redundant" },
  // the Opus review of 3 November: a generic you or we is one boundary case (rules 1 and 5), labelled the same way everywhere; four Context-dependent misses; less/fewer is accepted usage
  '269127878f5d5367f4de9601be12346b': { tags: [], bucket: 'near_miss', why: "review: generic 'we', boundary between rules 1 and 5" },
  'd6f662ab6686d1b68ce5005868089b52': { tags: [], bucket: 'near_miss', why: "review: generic 'you', boundary between rules 1 and 5" },
  '0705323efc3f426596dd62f3576640d9': { tags: [], bucket: 'near_miss', why: "review: generic 'you', boundary between rules 1 and 5" },
  '64e91fb398e344b7908e327abc56b7cb': { tags: [], bucket: 'near_miss', why: "review: generic 'you', boundary between rules 1 and 5" },
  '66dac9c59985c94476748a1efe544317': { tags: [], bucket: 'near_miss', why: "review: generic 'you/your', boundary between rules 1 and 5" },
  '74dde29c78374109a355eae294069a6b': { tags: [], bucket: 'near_miss', why: "review: generic 'you', boundary between rules 1 and 5" },
  'ab44c9a1568c87e25b906f8386d21bc6': { tags: ['Context-dependent'], confidence: 0.75, why: "review: 'The Hugging Face incident' does not say which incident (rules 2, 3)" },
  '2f82b607208b4098a5d62692654978cf': { tags: ['Context-dependent'], confidence: 0.55, why: "review: 'The asylum system' does not say whose (rule 3)" },
  'a9b89f371a1646e48fb4926c35976cfe': { tags: ['Context-dependent'], confidence: 0.6, why: "review: 'The drop in teen girls identifying...' needs an outside antecedent (rule 2)" },
  '81b67f5dcd2afe27d96f6ac341d032be': { tags: ['Context-dependent'], confidence: 0.55, why: "review: 'The global AI development slowdown' points at an unnamed proposal (rule 3)" },
  '5b7419af345226ee4842f815dd25df7d': { tags: [], bucket: 'near_miss', why: "review: 'not less' is accepted usage; missing article is headline style" },
};
const trailing = (t) => /[^.]\.$/.test(t.trim()) && !/\b(?:[A-Z]\.){2,}$/.test(t.trim()) && !/\b(?:Inc|Ltd|Co|Corp|Jr|Sr|etc)\.$/.test(t.trim());

const unlabelled = [];
const scored = pool.map((c) => {
  const raw = labels.get(c.geo_id);
  if (!raw) unlabelled.push(c.geo_id);
  const l = raw && OVERRIDES[c.geo_id] ? { ...raw, ...OVERRIDES[c.geo_id] } : raw ?? { tags: [], confidence: 0, bucket: 'clean', why: 'not labelled' };
  const tags = new Set((l.tags ?? []).filter((t) => TAGS.includes(t)));
  if (trailing(c.name)) tags.add('Trailing period'); else tags.delete('Trailing period');
  const bucket = tags.size ? 'issue' : l.bucket === 'near_miss' ? 'near_miss' : 'control';
  const total = c.agrees + c.disagrees;
  const balance = Math.min(c.agrees, c.disagrees) / Math.max(c.agrees, c.disagrees);
  return { ...c, tags: [...tags], bucket, label_why: String(l.why ?? ''), issue_conf: bucket === 'issue' ? Number(l.confidence) || 0 : 0, total, balance, score: total * balance };
});
if (unlabelled.length) throw new Error(`${unlabelled.length} pool claims have no label`);

// a pool claim whose text v2 already holds under another Geo ID (a twin entity in Geo) is left out: add.mjs refuses it as same text, since it adds before the old set leaves
const heldEarly = new Map();
for (const line of readFileSync(claimsFile, 'utf8').split('\n').filter(Boolean)) {
  const c = JSON.parse(line);
  heldEarly.set(normaliseName(c.claim ?? ''), String(c.geo_id).replace(/-/g, '').toLowerCase());
}
// such a twin still ranks; when it is picked it goes to selection-after-remove.json, added once its v2 twin is trashed
const twinOfV2 = scored.filter((c) => heldEarly.has(normaliseName(c.name)) && heldEarly.get(normaliseName(c.name)) !== c.geo_id);

// the owner's reading of 3 Nov: most votes, with a split of at most 3:1 (balance >= 1/3) first; then balance, likely-issue confidence, the Geo ID
const SPLIT = 1 / 3;
const order = (a, b) => (b.balance >= SPLIT) - (a.balance >= SPLIT) || b.total - a.total || b.balance - a.balance || b.issue_conf - a.issue_conf || (a.geo_id < b.geo_id ? -1 : 1);
const ranked = [...scored].sort(order);
const chosen = new Set(ranked.slice(0, COUNT).map((c) => c.geo_id));

// publish times: every month of a space's pool keeps one claim where it can; the swap takes out the lowest-ranked pick of that space's fullest month
const swaps = [];
for (const space of [...new Set(pool.map((c) => c.space))]) {
  const mine = ranked.filter((c) => c.space === space);
  for (const m of [...new Set(mine.map((c) => c.month))].sort()) {
    if (mine.some((c) => c.month === m && chosen.has(c.geo_id))) continue;
    const inn = mine.find((c) => c.month === m && !chosen.has(c.geo_id));
    const count = {};
    for (const c of mine) if (chosen.has(c.geo_id)) count[c.month] = (count[c.month] ?? 0) + 1;
    const fullest = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
    const out = fullest ? [...mine].reverse().find((c) => c.month === fullest && chosen.has(c.geo_id)) : [...ranked].reverse().find((c) => chosen.has(c.geo_id));
    chosen.delete(out.geo_id);
    chosen.add(inn.geo_id);
    swaps.push({ space, month: m, in: inn.geo_id, out: out.geo_id, in_score: inn.score, out_score: out.score });
  }
}
const picks = ranked.filter((c) => chosen.has(c.geo_id));

// checks
const held = new Map();
for (const line of readFileSync(claimsFile, 'utf8').split('\n').filter(Boolean)) {
  const c = JSON.parse(line);
  held.set(String(c.geo_id).replace(/-/g, '').toLowerCase(), normaliseName(c.claim ?? ''));
}
const heldTextOther = new Map([...held.entries()].map(([id, t]) => [t, id]));
const problems = [];
if (new Set(picks.map((p) => p.geo_id)).size !== picks.length) problems.push('repeated geo id');
if (new Set(picks.map((p) => normaliseName(p.name))).size !== picks.length) problems.push('repeated text');
if (picks.some((p) => BOT.includes(p.author))) problems.push('a pick is by the bot');
if (picks.some((p) => !(p.agrees >= 1 && p.disagrees >= 1))) problems.push('a pick lacks a vote');
const later = picks.filter((p) => twinOfV2.includes(p));
const now = picks.filter((p) => !twinOfV2.includes(p));
const clash = now.filter((p) => !held.has(p.geo_id) && heldTextOther.has(normaliseName(p.name)));
if (clash.length) problems.push(`${clash.length} new pick(s) repeat the text of a claim v2 holds under another Geo ID`);
if (problems.length) throw new Error(problems.join('; '));

const fmt = (x) => (Math.round(x * 100) / 100).toString();
const fileOf = (list, runId) => ({
  run_id: runId,
  created_at: new Date().toISOString(),
  criteria_file: 'docs/mvp-2026-11/evidence/34-replace-400/criteria.md',
  bot_spaces: BOT,
  claims: list.map((p) => ({
    geo_id: p.geo_id, space_id: p.space_id, space: p.space, name: p.name, month: p.month, published_at: p.published_at,
    bucket: p.bucket, predicted_tags: p.tags, why: `votes ${p.agrees} agree / ${p.disagrees} disagree (balance ${fmt(p.balance)}); ${p.label_why}`.slice(0, 300),
  })),
});
writeFileSync(join(dir, 'selection.json'), `${JSON.stringify(fileOf(now, '20261103-replace-400'), null, 1)}\n`);
if (later.length) writeFileSync(join(dir, 'selection-after-remove.json'), `${JSON.stringify(fileOf(later, '20261103-replace-400-after-remove'), null, 1)}\n`);

const tally = (list, key) => list.reduce((m, p) => { const k = key(p); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const tagTally = (list) => { const m = {}; for (const p of list) for (const t of p.tags) m[t] = (m[t] ?? 0) + 1; return m; };
const band = (p) => (p.total >= 10 ? '10+ votes' : p.total >= 5 ? '5-9 votes' : p.total >= 3 ? '3-4 votes' : '2 votes');
const bal = (p) => (p.balance >= 0.8 ? 'even (0.8-1)' : p.balance >= 0.5 ? 'fair (0.5-0.8)' : 'lopsided (<0.5)');
const last = picks.at(-1);
const summary = {
  pool: pool.length, twins_of_v2: twinOfV2.map((c) => ({ geo_id: c.geo_id, name: c.name, v2_geo_id: heldEarly.get(normaliseName(c.name)), picked: chosen.has(c.geo_id) })),
  picked: picks.length, dropped: pool.length - picks.length, in_selection_json: now.length, in_selection_after_remove: later.map((p) => p.geo_id),
  last_pick: { votes: last.total, balance: last.balance }, picks_split_worse_than_3to1: picks.filter((p) => p.balance < SPLIT).length,
  overlap_with_v2: picks.filter((p) => held.has(p.geo_id)).length, new_claims: picks.filter((p) => !held.has(p.geo_id)).length,
  pool_in_v2_dropped: scored.filter((c) => held.has(c.geo_id) && !chosen.has(c.geo_id)).length,
  month_swaps: swaps,
  by_space: tally(picks, (p) => p.space), pool_by_space: tally(scored, (p) => p.space),
  by_month: tally(picks, (p) => p.month), pool_by_month: tally(scored, (p) => p.month),
  by_votes: tally(picks, band), by_balance: tally(picks, bal),
  by_bucket: tally(picks, (p) => p.bucket), by_tag: tagTally(picks),
  dropped_by_bucket: tally(scored.filter((c) => !chosen.has(c.geo_id)), (p) => p.bucket),
};
writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
console.log(JSON.stringify(summary, null, 1));
