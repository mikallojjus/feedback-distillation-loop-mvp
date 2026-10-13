#!/usr/bin/env node
// cases-sync: every decision becomes a permanent regression case. Rebuilds evals/cases.jsonl from the decisions of a pull plus the research
// cases already in the file, and plans the Tag decisions column "In regression suite" for the rows that became active cases.
//
//   node agents/claim-tagger/scripts/cases-sync.mjs [--pull <id>] [--run-id <id>]
//
// For every decided queue row (effective outcome Applies or Does not apply):
//   case_id      "ctr-" + the last 12 hex digits of the row's page id + "-" + the first 6 letters of the tag, lower case ("ctr-e785afbb7217-predic").
//                A case that is already in the file for the same claim and tag (matched by geo_id and tag) keeps its case_id.
//   expected     apply | do_not_apply (the effective outcome);  tag_hash and rule_hash come from the LIVE rubric (rule_hash only when the row, or the
//                case already in the file, cites "<Tag> rule <n>"), so a hash that went stale with a rubric change is re-stamped on every sync.
//   active       Agent slip, no Why wrong, and a seeded decision all give an active case. Why wrong = Rule unclear or Rule should change gives a
//                CONTESTED case (contested true, active false) until a lesson linked to the row is Live; contested_lesson is the key of the linked
//                lesson (null until distill links one). A seeded decision whose Seeded reasoning starts "Rule should change:" or "Rule unclear:"
//                is active as seeded, and turns contested the moment it is linked to a lesson that is not Live yet (distill --link does that).
//                Why wrong = No tag fits or Other gives no case (an earlier case for the row is switched off: withdrawn).
//   suite        gate; a case on a source-reading tag is kept but marked "not_run" (the MVP fetches no source text). A case of the research file
//                that sits in another suite (mirror-freshness) keeps its suite and its flags.
//   other        key, claim, geo_id, outcome_source (editor | seeded), why_wrong, reasoning, decided_at, source_row (the queue row's page url),
//                rubric_version (the version the hashes were stamped against), source "queue".
// Research cases without a decided queue row stay in the file untouched (source "research"; the old source text moves to research_source).
// The plan sets "In regression suite" (today) on the rows whose case is active and whose date is still empty, never on contested ones.
// Claim texts come from the pull when it holds the Claims, else from an older pull, the cases already in the file or the seed.
//
// Library: syncCases() does the work (distill --link and promote --finalize call it); main() is the command line.
// Exit codes: 0 ok, 1 error, 2 invalid (no pull, the pull lacks Tag decisions, run id used), 3 paused.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { controlPaths } from './allowlist.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { ruleHash } from './lib/hash.mjs';
import { readJson, readJsonl, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { normId } from './lib/notion-values.mjs';
import { agentRoot, isMain, runId as makeRunId } from './lib/paths.mjs';
import { normaliseText } from './lib/rubric-build.mjs';
import { openPlan } from './plan.mjs';
import { latestPullId, loadConfig, loadPull } from './pull.mjs';
import { checkVerdict, inspect } from './status.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/cases-sync.mjs [--pull <id>] [--run-id <id>]';

export const RULE_WHY = Object.freeze(['Rule unclear', 'Rule should change']);
export const NO_CASE_WHY = Object.freeze(['No tag fits', 'Other']);
const SEEDED_PREFIX = /^(Rule should change|Rule unclear):\s*/;
const OWN_SUITES = new Set(['gate', 'not_run']);
const LESSON_RANK = { Approved: 4, Proposed: 3, 'Rolled back': 2, Rejected: 1, Live: 0 };

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- small shared helpers (distill, promote and followup import these) ----------------------------------------------------

/** The first 6 letters and digits of the tag, lower case ("Context-dependent" -> "contex", "Poor wording" -> "poorwo"). */
export function tagSlug(tag) {
  return String(tag).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
}

/** "ctr-" + the last 12 hex digits of the page id + "-" + tagSlug. */
export function caseIdFor(pageId, tag) {
  return `ctr-${normId(pageId).slice(-12)}-${tagSlug(tag)}`;
}

/** The rule number a queue row cites as "<Tag> rule <n>" in the agent's full note, else in its short reason; null when it cites none. */
export function citedRule(row, tag) {
  const re = new RegExp(`${escapeRe(tag)}\\s+rule\\s+(\\d+)`, 'i');
  for (const text of [row.agent_full_note, row.why_i_recommend_this]) {
    const m = re.exec(String(text ?? ''));
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Whether a decided row says the rule is the problem: { why: "Rule unclear" | "Rule should change", source: "editor" | "seeded" } or null.
 * An editor's decision counts through its Why wrong field; a seeded decision through the prefix of its Seeded reasoning.
 */
export function ruleWhyOf(row) {
  const source = row.outcome_source ?? (row.tag_outcome ? 'editor' : 'seeded');
  if (source === 'editor') return RULE_WHY.includes(row.why_wrong) ? { why: row.why_wrong, source } : null;
  const m = SEEDED_PREFIX.exec(String(row.seeded_reasoning ?? ''));
  return m ? { why: m[1], source } : null;
}

/** The reasoning text of a decided row, without the "Rule should change: " prefix of a seeded one. */
export function reasoningOf(row) {
  const source = row.outcome_source ?? (row.tag_outcome ? 'editor' : 'seeded');
  const text = source === 'editor' ? row.your_reasoning : String(row.seeded_reasoning ?? '').replace(SEEDED_PREFIX, '');
  return String(text ?? '').trim() || null;
}

/** The date a row was decided: Decided at (editor) or Seeded at (seeded). */
export const decidedAtOf = (row) => ((row.outcome_source ?? (row.tag_outcome ? 'editor' : 'seeded')) === 'editor' ? row.decided_at : row.seeded_at) ?? null;

export const expectedOf = (row) => (row.effective_outcome === 'Applies' ? 'apply' : 'do_not_apply');

const readNorm = (pull, name) => {
  const file = join(pull.dir, 'norm', name);
  return existsSync(file) ? readJsonl(file).rows : null;
};

/** The lessons of a pull ([] when it does not hold Rule changes) indexed by page id and by key. */
export function lessonIndex(pull) {
  const rows = pull.covers('rule_changes') ? (readNorm(pull, 'lessons.jsonl') ?? []) : [];
  return { rows, byPage: new Map(rows.map((l) => [normId(l.page_id), l])), byKey: new Map(rows.map((l) => [l.lesson_key, l])), known: pull.covers('rule_changes') };
}

/**
 * Claim texts by geo id: { claim, sources_count }. Looks in the pull when it holds the Claims, then in the cases file, then in older pulls
 * (newest first) that did, then in the seed. The first one found wins.
 */
export function claimTexts(root, pull, casesRows = []) {
  const map = new Map();
  const add = (geoId, claim, sources) => {
    if (typeof geoId === 'string' && geoId && typeof claim === 'string' && claim.trim() && !map.has(geoId)) map.set(geoId, { claim, sources_count: Number.isInteger(sources) ? sources : null });
  };
  const fromPull = (dir) => {
    const file = join(dir, 'norm', 'claims.jsonl');
    if (existsSync(file)) for (const r of readJsonl(file).rows) add(r.geo_id, r.claim, r.sources_count);
  };
  if (pull) fromPull(pull.dir);
  for (const c of casesRows) add(c.geo_id, c.claim, null);
  const pullsDir = controlPaths(root).pull;
  if (existsSync(pullsDir)) {
    const older = readdirSync(pullsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== pull?.id && existsSync(join(pullsDir, d.name, 'pull.json')))
      .map((d) => ({ dir: join(pullsDir, d.name), at: String(readJson(join(pullsDir, d.name, 'pull.json')).taken_at ?? '') }))
      .sort((a, b) => b.at.localeCompare(a.at));
    for (const p of older) fromPull(p.dir);
  }
  const seed = join(root, 'evals', 'seed', 'claims.seed.jsonl');
  if (existsSync(seed)) for (const r of readJsonl(seed).rows) add(r.geo_id, r.claim, r.sources_count);
  return map;
}

/**
 * The lessons a row is linked to: { list, live, best, unknown }. `links` is an extra Map(row key -> [lesson key]) for links that are planned
 * but not in Notion yet. `best` is the Live lesson when there is one, else the in-flight one that ranks highest (Approved, Proposed, Rolled back,
 * Rejected). `unknown` means the row has links the pull cannot resolve (it holds no Rule changes).
 */
export function linkedLessons(row, index, links = new Map()) {
  const list = [];
  let unknown = false;
  for (const pageId of row.lesson_page_ids ?? []) {
    const l = index.byPage.get(normId(pageId));
    if (l) list.push(l);
    else unknown = true;
  }
  for (const key of links.get(row.key) ?? []) {
    const l = index.byKey.get(key);
    if (!list.some((x) => x.lesson_key === key)) list.push(l ?? { lesson_key: key, status: 'Proposed' });
  }
  const live = list.find((l) => l.status === 'Live') ?? null;
  const best = live ?? [...list].sort((a, b) => (LESSON_RANK[b.status] ?? 0) - (LESSON_RANK[a.status] ?? 0) || String(b.created ?? '').localeCompare(String(a.created ?? '')))[0] ?? null;
  return { list, live: live !== null, best, unknown };
}

// ---- one case ----------------------------------------------------------------------------------------------------------------

function ruleStamp(row, existing, rubricTag) {
  const n = citedRule(row, row.tag) ?? (/ rule (\d+)$/.exec(existing?.rule_ref ?? '')?.[1] ? Number(/ rule (\d+)$/.exec(existing.rule_ref)[1]) : null);
  const rule = n === null ? null : rubricTag?.when_to_use.rules.find((r) => r.n === n);
  return rule ? { rule_ref: `${row.tag} rule ${rule.n}`, rule_hash: ruleHash(row.tag, rule.n, rule.text) } : { rule_ref: null, rule_hash: null };
}

function buildCase({ row, existing, rubric, claim, lessons, url, today, sourceReadingTags }) {
  const rubricTag = rubric.tags.find((t) => t.name === row.tag);
  const rw = ruleWhyOf(row);
  const source = row.outcome_source ?? (row.tag_outcome ? 'editor' : 'seeded');
  const foreign = existing?.suite && !OWN_SUITES.has(existing.suite);
  let contested = false;
  if (rw) contested = rw.source === 'editor' ? !lessons.live : (lessons.list.length > 0 || lessons.unknown) && !lessons.live;
  let suite = sourceReadingTags.has(row.tag) ? 'not_run' : 'gate';
  let active = !contested;
  let contestedLesson = rw ? (lessons.best?.lesson_key ?? null) : null;
  let contestedWhy = contested ? `${rw.why} (${rw.source}); ${lessons.best ? `lesson "${lessons.best.lesson_key}" is ${lessons.best.status}` : 'no lesson linked yet'}` : null;
  if (foreign) { // another suite (mirror-freshness) has its own rules for these two flags
    suite = existing.suite;
    active = existing.active === true;
    contested = existing.contested === true;
    contestedLesson = existing.contested_lesson ?? null;
    contestedWhy = existing.contested_why ?? null;
  }
  const staleHash = existing && rubricTag && existing.tag_hash !== rubricTag.tag_hash;
  const out = {
    ...(existing ?? {}),
    case_id: existing?.case_id ?? caseIdFor(row.page_id, row.tag),
    key: row.key,
    tag: row.tag,
    geo_id: row.geo_id,
    claim,
    expected: expectedOf(row),
    tag_hash: rubricTag?.tag_hash ?? existing?.tag_hash ?? null,
    ...ruleStamp(row, existing, rubricTag),
    active,
    contested,
    contested_lesson: contestedLesson,
    contested_why: contestedWhy,
    suite,
    source: 'queue',
    outcome_source: source,
    why_wrong: source === 'editor' ? (row.why_wrong ?? null) : (rw?.why ?? null),
    reasoning: reasoningOf(row),
    decided_at: decidedAtOf(row),
    source_row: url ?? existing?.source_row ?? null,
    ...(existing?.source_row && url && existing.source_row !== url && !existing.research_source_row ? { research_source_row: existing.source_row } : {}),
    rubric_version: !existing || staleHash ? rubric.rubric_version : existing.rubric_version ?? rubric.rubric_version,
    created: existing?.created ?? today,
  };
  delete out.withdrawn; // a decision that is back is a case again
  return out;
}

// ---- the sync ------------------------------------------------------------------------------------------------------------------

/**
 * Compute the new cases and (unless write is false) write evals/cases.jsonl. Returns { cases, counts, regression, notes, changed }.
 * Options: root, config, pull (a loaded pull), rubric (default rubric/rubric.json), now, links (Map row key -> [lesson key]), casesPath, write.
 * regression = the rows that need "In regression suite": [{ key, page_id }].
 */
export function syncCases({ root = agentRoot(), config = loadConfig(root), pull, rubric = readJson(join(root, 'rubric', 'rubric.json')), now = () => new Date(), links = new Map(), casesPath = join(root, 'evals', 'cases.jsonl'), write = true }) {
  if (!pull.covers('tag_decisions')) throw new Error(`pull ${pull.id} does not include Tag decisions: run pull.mjs --dbs tag_decisions,rule_changes first`);
  const today = now().toISOString().slice(0, 10);
  const sourceReadingTags = new Set(config.scope?.source_reading_tags ?? []);
  const queue = readNorm(pull, 'queue.jsonl') ?? [];
  const decided = (readNorm(pull, 'decisions.jsonl') ?? []).filter((r) => r.tag && r.geo_id).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const index = lessonIndex(pull);
  const urls = new Map(pull.rows('tag_decisions').map((r) => [normId(r.page_id), r.url]));
  const existing = existsSync(casesPath) ? readJsonl(casesPath).rows : [];
  const texts = claimTexts(root, pull, existing);
  const notes = [];

  const byGeoTag = new Map();
  existing.forEach((c, i) => {
    const k = `${c.geo_id}::${c.tag}`;
    if (!byGeoTag.has(k)) byGeoTag.set(k, i);
  });
  const next = existing.map((c) => ({ ...c }));
  const handled = new Set();
  const regression = [];
  const additions = [];
  const counts = { total: 0, from_queue: 0, kept_research: 0, added: 0, updated: 0, unchanged: 0, restamped: 0, withdrawn: 0, no_case: 0, skipped_no_claim: 0, active: 0, contested: 0, not_run: 0, inactive: 0 };

  const rowsByKey = new Map(queue.map((r) => [r.key, r]));
  const noCaseKeys = new Set(queue.filter((r) => r.tag_outcome && NO_CASE_WHY.includes(r.why_wrong) && ['Applies', 'Does not apply'].includes(r.effective_outcome)).map((r) => r.key));
  counts.no_case = noCaseKeys.size;

  for (const row of decided) {
    const k = `${row.geo_id}::${row.tag}`;
    if (noCaseKeys.has(row.key)) continue; // handled below: no case
    const at = byGeoTag.get(k);
    const old = at === undefined ? null : existing[at];
    const text = texts.get(row.geo_id)?.claim ?? old?.claim ?? null;
    if (!text) {
      counts.skipped_no_claim += 1;
      notes.push(`no claim text for ${row.key}: pull the Claims too (no case was made for it)`);
      continue;
    }
    const lessons = linkedLessons(row, index, links);
    const built = buildCase({ row, existing: old, rubric, claim: text, lessons, url: urls.get(normId(row.page_id)) ?? null, today, sourceReadingTags });
    handled.add(k);
    if (old) {
      if (JSON.stringify(built) !== JSON.stringify(old)) {
        counts.updated += 1;
        if (old.tag_hash !== built.tag_hash || old.rule_hash !== built.rule_hash) counts.restamped += 1;
      } else counts.unchanged += 1;
      next[at] = built;
    } else {
      counts.added += 1;
      additions.push(built);
    }
    counts.from_queue += 1;
    if (built.active && !row.in_regression_suite) regression.push({ key: row.key, page_id: row.page_id });
  }

  // decisions that are no longer a case: No tag fits / Other, or a decision that was withdrawn
  existing.forEach((c, i) => {
    const k = `${c.geo_id}::${c.tag}`;
    if (handled.has(k) || byGeoTag.get(k) !== i) return;
    const row = c.key ? rowsByKey.get(c.key) : [...rowsByKey.values()].find((r) => r.geo_id === c.geo_id && r.tag === c.tag);
    const noCase = row && noCaseKeys.has(row.key);
    if (noCase || (c.source === 'queue' && row && !['Applies', 'Does not apply'].includes(row.effective_outcome))) {
      const reason = noCase ? `Why wrong = ${row.why_wrong}: no rulebook tag settles it, so there is no case` : 'the decision was withdrawn';
      if (c.active || !c.withdrawn) {
        next[i] = { ...c, active: false, contested: false, withdrawn: reason };
        counts.withdrawn += 1;
      }
      return;
    }
    // a research case with no decided row: kept, hashes re-stamped against the live rubric
    const rubricTag = rubric.tags.find((t) => t.name === c.tag);
    const out = { ...c };
    if (c.source !== 'research') {
      if (c.source && c.source !== 'queue') out.research_source = c.source;
      out.source = c.source === 'queue' ? 'queue' : 'research';
    }
    if (rubricTag) {
      if (c.tag_hash !== rubricTag.tag_hash) { out.tag_hash = rubricTag.tag_hash; out.rubric_version = rubric.rubric_version; counts.restamped += 1; }
      const n = / rule (\d+)$/.exec(c.rule_ref ?? '')?.[1];
      const rule = n ? rubricTag.when_to_use.rules.find((r) => r.n === Number(n)) : null;
      if (c.rule_ref) out.rule_hash = rule ? ruleHash(c.tag, rule.n, rule.text) : null;
    }
    if (JSON.stringify(out) !== JSON.stringify(c)) counts.updated += 1;
    else counts.unchanged += 1;
    if (out.source === 'research') counts.kept_research += 1;
    next[i] = out;
  });

  const cases = [...next, ...additions.sort((a, b) => (a.case_id < b.case_id ? -1 : 1))];
  const used = new Set();
  for (const c of cases) { // a clash of two different claims on one id is not expected, but a duplicate id would make the gate refuse the file
    if (used.has(c.case_id)) {
      let n = 2;
      while (used.has(`${c.case_id}-${n}`)) n += 1;
      c.case_id = `${c.case_id}-${n}`;
    }
    used.add(c.case_id);
  }
  for (const c of cases) {
    counts.total += 1;
    if (c.suite === 'not_run' && c.active) counts.not_run += 1;
    if (c.active) counts.active += 1;
    else if (c.contested) counts.contested += 1;
    else counts.inactive += 1;
  }

  const text = cases.length ? `${cases.map((c) => JSON.stringify(c)).join('\n')}\n` : '';
  const before = existing.length ? `${existing.map((c) => JSON.stringify(c)).join('\n')}\n` : '';
  const changed = text !== before;
  if (write && changed) writeTextAtomic(casesPath, text);
  return { cases, counts, regression, notes, changed, today, casesPath };
}

/** The plan that sets "In regression suite" on the given rows. Returns { runId, written, ops } or null when there is nothing to set. */
export function planRegression({ root, config, pull, rows, runId, now, today }) {
  if (!rows.length) return null;
  const plan = openPlan({ runId, sourcePull: pull.id, root, config, pull, now });
  for (const r of rows) plan.update('tag_decisions', r.key, r.page_id, { 'In regression suite': today }, { note: 'decision became an active regression case' });
  return { runId, written: plan.write(), ops: plan.ops.length };
}

// ---- command line --------------------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

export function summaryLine(result, pullId, planned) {
  const c = result.counts;
  return `cases-sync: pull ${pullId}: ${c.total} case(s) (${c.from_queue} from decisions, ${c.kept_research} kept from research), active ${c.active} (${c.not_run} not_run), contested ${c.contested}, inactive ${c.inactive}; added ${c.added}, updated ${c.updated} (hash re-stamped ${c.restamped}), withdrawn ${c.withdrawn}; In regression suite: ${planned ? `${planned.ops} row(s) in plan ${planned.runId}` : 'nothing to set'}${result.changed ? '' : ' (cases.jsonl unchanged)'}`;
}

/** Run the script; returns the exit code. env (tests): { root, now, config }. */
export async function main(argv, io = defaultIo, env = {}) {
  let args;
  try {
    args = parseArgs({ args: argv, options: { pull: { type: 'string' }, 'run-id': { type: 'string' }, help: { type: 'boolean', short: 'h' } }, strict: true, allowPositionals: false }).values;
  } catch (e) {
    io.err(`cases-sync: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  try {
    const root = env.root ?? agentRoot();
    const config = env.config ?? loadConfig(root);
    const now = env.now ?? (() => new Date());
    const pullId = args.pull ?? latestPullId(root);
    if (!pullId) {
      io.err('cases-sync: there is no pull yet: run pull.mjs --dbs tag_decisions,rule_changes first');
      return EXIT.INVALID;
    }
    const gate = checkVerdict(inspect({ root, config, now, pullId }), { ignore: ['lock', 'drift', 'promoting'] });
    if (gate.code === EXIT.PAUSED) {
      io.err(`cases-sync: ${gate.label}: ${gate.text}`);
      return EXIT.PAUSED;
    }
    const pull = loadPull(root, pullId, { config });
    if (!pull.covers('tag_decisions')) {
      io.err(`cases-sync: pull ${pullId} does not include Tag decisions: run pull.mjs --dbs tag_decisions,rule_changes first`);
      return EXIT.INVALID;
    }
    const result = syncCases({ root, config, pull, now });
    const runId = args['run-id'] ?? makeRunId('cases-sync', now());
    const planned = planRegression({ root, config, pull, rows: result.regression, runId, now, today: result.today });
    if (planned || args['run-id']) writeJsonAtomic(join(controlPaths(root).runs, runId, 'cases-sync.json'), { run_id: runId, pull: pullId, counts: result.counts, regression_rows: result.regression.map((r) => r.key), notes: result.notes, created_at: now().toISOString() });
    io.out(summaryLine(result, pullId, planned));
    if (planned) io.out(`cases-sync: next: node agents/claim-tagger/scripts/plan.mjs check --run ${runId}, then apply.mjs --run ${runId}`);
    for (const n of result.notes) io.err(`cases-sync: ${n}`);
    return EXIT.OK;
  } catch (e) {
    io.err(`cases-sync: ${e.message}`);
    return e.name === 'PlanError' || e.code === 'ALLOWLIST' || /does not exist|no pull yet/.test(e.message) ? EXIT.INVALID : EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
