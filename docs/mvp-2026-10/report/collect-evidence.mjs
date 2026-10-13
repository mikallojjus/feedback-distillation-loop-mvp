#!/usr/bin/env node
// collect-evidence.mjs: aggregate the MVP evidence into data/evidence.json and data/counts.json for build.mjs.
// Reads only files under docs/mvp-2026-10/evidence and agents/claim-tagger (including the git-ignored runs/ folder, whose run.json and
// verify.json files hold the model costs and the read-back results); writes only under docs/mvp-2026-10/report/data.
//
//   node collect-evidence.mjs        then   node build.mjs --strict
//
// counts.json holds every figure the parts use as {{count:key}}, each as { value, source } so a number on the page traces back to a file.
// Groups nest ({{count:tagRun.rowsCreated}}). Money is a string with two decimals ("0.70"); accuracy changes are signed strings in points
// with one decimal ("+36.4", "0.0", and a minus sign U+2212 for a loss). A figure that cannot be found makes the script stop with a message
// instead of writing a guess.
// One figure is not derivable from the files: UNIT_TESTS below, recorded from a test run at a named commit.

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const evidence = join(here, '..', 'evidence');
const agent = join(repo, 'agents', 'claim-tagger');

// `node --test tests/` was run on a clean export (git archive) of the commit below; the working tree may carry later edits, so the
// number of test files is counted at the same commit. Update both fields together after a new run.
const UNIT_TESTS = { commit: '9d66fab', value: 856, source: 'node --test tests/ on a clean export of commit 9d66fab, 13 Oct 2026: 856 tests, 856 pass, 0 fail (32 test files)' };

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

function cards() {
  const dir = join(evidence, 'cards');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().map((name) => {
    const p = join(dir, name, 'card.json');
    if (!existsSync(p)) return null;
    const c = readJson(p);
    const md = existsSync(join(dir, name, 'card.md')) ? readFileSync(join(dir, name, 'card.md'), 'utf8') : '';
    const target = (c.per_tag || []).find((t) => t.tag === c.target) || null;
    return {
      name, card_id: c.card_id, kind: c.kind, lesson: c.lesson, target: c.target, verdict: c.verdict, small_sample: c.small_sample,
      canaries: c.canaries, newly_failing: c.cases && Array.isArray(c.cases.newly_failing) ? c.cases.newly_failing : [],
      newly_passing: c.cases && Array.isArray(c.cases.newly_passing) ? c.cases.newly_passing : [],
      gating: c.cases && Array.isArray(c.cases.gating) ? c.cases.gating.length : null,
      target_stats: target ? { n: target.n, positives: target.positives, acc_base: target.acc_base, acc_cand: target.acc_cand, delta: target.delta, ci: target.ci, fixed: target.fixed, broken: target.broken } : null,
      per_tag: (c.per_tag || []).map((t) => ({ tag: t.tag, n: t.n, positives: t.positives, acc_base: t.acc_base, acc_cand: t.acc_cand, delta: t.delta, ci: t.ci, gated: t.gated, fixed: (t.fixed || []).length, broken: (t.broken || []).length })),
      conditions: (c.conditions || []).map((x) => ({ n: x.n, status: x.status })),
      reconfirmed: c.reconfirmed || [], reasons: c.reasons || [], holds: c.holds || [], cost: c.cost || null, md,
      configs: c.configs || null,
    };
  }).filter(Boolean);
}

function queueRows(name) {
  const p = join(evidence, 'notion', name, 'queue.jsonl');
  return existsSync(p) ? readJsonl(p) : [];
}

function snapshots() {
  const dir = join(evidence, 'notion');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().map((name) => {
    const s = join(dir, name, 'summary.json');
    const q = join(dir, name, 'queue.jsonl');
    const out = { name };
    if (existsSync(s)) out.summary = readJson(s);
    if (existsSync(q)) {
      const rows = readJsonl(q);
      const count = (k) => rows.reduce((m, r) => { const v = r[k] ?? '(none)'; m[v] = (m[v] || 0) + 1; return m; }, {});
      out.queue = { rows: rows.length, stage: count('stage'), direction: count('direction'), why_in_queue: count('why_in_queue'), editor_decided: rows.filter((r) => r.tag_outcome).length, effective: rows.filter((r) => r.effective_outcome).length };
    }
    const l = join(dir, name, 'lessons.jsonl');
    if (existsSync(l)) out.lessons = readJsonl(l).map((x) => ({ key: x.lesson_key, id: x.lesson_id, status: x.status, tag: x.tag, rule: x.rule_label, supporting: (x.supporting_page_ids || []).length, cards: (x.result_card_page_ids || []).length, editor_wording_chars: x.editor_wording ? [...x.editor_wording].length : 0 }));
    const c = join(dir, name, 'claims.jsonl');
    if (existsSync(c)) { const rows = readJsonl(c); out.claims = { rows: rows.length, readiness: rows.reduce((m, r) => { const v = r.readiness ?? '(none)'; m[v] = (m[v] || 0) + 1; return m; }, {}) }; }
    const r = join(dir, name, 'runs.jsonl');
    if (existsSync(r)) { const rows = readJsonl(r); out.runs = { rows: rows.length, kind: rows.reduce((m, x) => { m[x.kind] = (m[x.kind] || 0) + 1; return m; }, {}), verdict: rows.reduce((m, x) => { m[x.verdict] = (m[x.verdict] || 0) + 1; return m; }, {}) }; }
    const rb = join(dir, name, 'rulebook.json');
    if (existsSync(rb)) { const j = readJson(rb); const rows = j.rows || []; out.rulebook = { rows: rows.length, drift: (j.drift || []).length, versions: rows.reduce((m, x) => { m[x.rule_version] = (m[x.rule_version] || 0) + 1; return m; }, {}), changed_by: rows.filter((x) => (x.changed_by || []).length).length }; }
    const st = join(dir, name, 'settings.json');
    if (existsSync(st)) { const j = readJson(st); out.settings = { paused: j.paused, weekly_cap: j.weekly_cap, rubric_in_force: j.rubric_in_force }; }
    const pr = join(dir, name, 'propose.json');
    if (existsSync(pr)) out.propose = readJson(pr);
    return out;
  });
}

function runs() {
  const dir = join(agent, 'runs');
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name, 'run.json');
    if (!existsSync(p)) continue;
    try { const r = readJson(p); out.push({ run_id: r.run_id || name, kind: r.kind, status: r.status, model: r.model, runs: r.runs, counts: r.counts, cost_usd: r.cost_usd, rubric_version: r.rubric_version, config_id: r.config_id, items: Array.isArray(r.items) ? r.items.length : (r.items ?? null), smoke: r.smoke || false }); } catch { /* skip */ }
  }
  return out.sort((a, b) => String(a.run_id).localeCompare(String(b.run_id)));
}

/** Every apply's read-back: runs/<id>/verify.json (written by verify.mjs after apply.mjs). */
function verifies() {
  const dir = join(agent, 'runs');
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name, 'verify.json');
    if (!existsSync(p)) continue;
    try {
      const v = readJson(p);
      out.push({ run_id: v.run_id || name, result: v.result, ops: v.ops_total || 0, landed: v.landed || 0, missing: (v.missing || []).length, mismatched: (v.mismatched || []).length, editor_changes: (v.editor_changes || []).length });
    } catch { /* skip */ }
  }
  return out;
}

function personaActions() {
  const p = join(evidence, 'persona-editor-actions.json');
  if (!existsSync(p)) return null;
  const j = readJson(p);
  const actions = j.actions || [];
  const byRole = actions.reduce((m, a) => { const r = a.role || 'editor'; m[r] = (m[r] || 0) + 1; return m; }, {});
  const wording = actions.map((a) => a.editor_wording_chars).filter((n) => typeof n === 'number');
  return {
    total: actions.length, by_role: byRole, fields_written: [...new Set(actions.flatMap((a) => Object.keys(a.after || {})))],
    approvals: actions.filter((a) => a.before && a.after && a.before.Status === 'Proposed' && a.after.Status === 'Approved').length,
    amendments: actions.filter((a) => a.action === 'quality-check amendment').length,
    wording_chars: wording,
  };
}

function headless() {
  const dir = join(evidence, 'headless');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.summary.md')).map((f) => {
    const text = readFileSync(join(dir, f), 'utf8');
    const grab = (re) => { const m = text.match(re); return m ? m[1] : null; };
    const m = f.match(/^(.*?)(?:-(\d+))?\.summary\.md$/);
    const bash = Number(grab(/^- Bash: (\d+)/m) || 0);
    const denials = Number(grab(/permission denials: (\d+)/) || 0);
    return {
      file: f, test: m[1], attempt: m[2] ? Number(m[2]) : 1, is_error: grab(/is_error: (\w+)/), turns: grab(/turns: (\d+)/), cost: grab(/cost: \$([\d.]+)/),
      denials, bash, ran: bash > denials, editor_writes: grab(/Editor-owned fields written by the connector: (\d+)/),
      connector_calls: /## Notion connector calls\s+- none/.test(text) ? 0 : null,
    };
  }).sort((a, b) => a.test.localeCompare(b.test) || a.attempt - b.attempt);
}

function tests() {
  const dir = join(repo, 'tests');
  const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs'));
  let atCommit = null;
  try {
    const listed = execFileSync('git', ['-C', repo, 'ls-tree', '--name-only', UNIT_TESTS.commit, 'tests/'], { encoding: 'utf8' });
    atCommit = listed.split('\n').filter((f) => f.endsWith('.test.mjs')).length;
  } catch { /* reported below as a missing figure */ }
  return { files: files.length, files_at_commit: atCommit, commit: UNIT_TESTS.commit };
}

function rubric() {
  const r = readJson(join(agent, 'rubric', 'rubric.json'));
  const lock = readJson(join(agent, 'rubric', 'rubric.lock'));
  return { version: r.rubric_version, hash: r.rubric_hash, scope_hash: r.scope_hash, tags: r.tag_count, judged: r.judged_count, lock_version: lock.rubric_version };
}

function cases() {
  const rows = readJsonl(join(agent, 'evals', 'cases.jsonl'));
  const canaries = readJsonl(join(agent, 'evals', 'canaries.jsonl'));
  return { cases: rows.length, active: rows.filter((r) => r.active).length, contested: rows.filter((r) => r.contested).length, canaries: canaries.length, canaries_active: canaries.filter((c) => c.active).length };
}

function seed() {
  const p = join(agent, 'evals', 'seed', 'seed-report.json');
  return existsSync(p) ? readJson(p) : null;
}

const data = {
  generated_at: new Date().toISOString(), rubric: rubric(), cases: cases(), seed: seed(), cards: cards(), snapshots: snapshots(), runs: runs(),
  verifies: verifies(), persona: personaActions(), headless: headless(), tests: tests(), config: readJson(join(agent, 'config.json')),
};
const totalCost = data.runs.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
data.total_cost_usd = Math.round(totalCost * 100) / 100;
delete data.config.anonymise; // the page never needs the name list, and evidence.json should not carry it

mkdirSync(join(here, 'data'), { recursive: true });
writeFileSync(join(here, 'data', 'evidence.json'), JSON.stringify(data, null, 2) + '\n');

// ------------------------------------------------------------------ counts.json: the keys used by {{count:key}} in the parts

const problems = [];
/** A count entry; a value that is missing is reported and the script exits without writing counts.json. */
const c = (value, source) => {
  if (value === undefined || value === null || (typeof value === 'number' && Number.isNaN(value))) problems.push(source);
  return { value, source };
};
const money = (x) => (x === undefined || x === null ? null : (Number(x) || 0).toFixed(2));
const points = (x) => {
  if (x === undefined || x === null) return null;
  const v = Math.round(x * 1000) / 10;
  if (v === 0) return '0.0';
  return v > 0 ? `+${v.toFixed(1)}` : `−${Math.abs(v).toFixed(1)}`;
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+(.)?/g, (_m, ch) => (ch ? ch.toUpperCase() : ''));
const sum = (list) => list.reduce((s, x) => s + (Number(x) || 0), 0);

const EV = 'docs/mvp-2026-10/evidence';
const RUNS = 'agents/claim-tagger/runs';
const snapByPrefix = (p) => data.snapshots.find((s) => s.name.startsWith(p)) || null;
const withQueue = data.snapshots.filter((s) => s.queue);
const seeded = snapByPrefix('00-');
const afterTag = snapByPrefix('02-');
const afterDecisions = snapByPrefix('03-');
const beforeReview = snapByPrefix('07-');
const endState = snapByPrefix('08-');
const last = withQueue[withQueue.length - 1];
if (!seeded || !afterTag || !afterDecisions || !beforeReview || !endState || !last) {
  console.error('collect-evidence: a snapshot folder is missing (expected 00-, 02-, 03-, 07- and 08- under evidence/notion)');
  process.exit(1);
}

const STAGES = ['To review', 'Waiting for evidence', 'Second opinion', 'Lesson proposed', 'Regression case', 'Decided', 'Closed'];
const DIRECTIONS = ['Open', 'Agent right', 'Missed', 'Wrongly applied'];
const stageGroup = (s) => ({
  rows: c(s.queue.rows, `${EV}/notion/${s.name}/queue.jsonl: rows`),
  ...Object.fromEntries(STAGES.map((st) => [slug(st), c(s.queue.stage[st] || 0, `${EV}/notion/${s.name}/queue.jsonl: rows with Stage "${st}"`)])),
});
const directionGroup = (s) => Object.fromEntries(DIRECTIONS.map((d) => [slug(d), c(s.queue.direction[d] || 0, `${EV}/notion/${s.name}/queue.jsonl: rows with Direction "${d}"`)]));

// rows an editor-side role decided between two snapshots, split by whether the row already had a seeded outcome
const decidedBetween = (a, b) => {
  const before = new Set(queueRows(a.name).filter((r) => r.tag_outcome).map((r) => r.key));
  return queueRows(b.name).filter((r) => r.tag_outcome && !before.has(r.key));
};
const lateDecisions = decidedBetween(beforeReview, endState);

const judgeRuns = data.runs.filter((r) => r.kind === 'judge');
const runById = (re) => data.runs.find((r) => re.test(r.run_id)) || null;
const tagRun = runById(/-tag-r1$/);
const evalRun = runById(/-eval-r1$/);
const propose = afterTag.propose || {};

const card = (name) => data.cards.find((x) => x.name === name) || null;
const baseline = card('baseline-r1');
const lessonCards = data.cards.filter((x) => x.lesson);
const ls1Cards = data.cards.filter((x) => /^gate-ls1-/.test(x.name));
const perTag = (k, tag) => (k.per_tag.find((t) => t.tag === tag) || {});
const recon = (k, flip, outcome) => k.reconfirmed.filter((r) => r.flip === flip && r.outcome === outcome).length;
const cardKey = (name) => name.replace(/^gate-/, '').replace(/-attempt(\d+)$/, 'a$1').replace(/-planted$/, '');
const gate = {};
for (const k of lessonCards) {
  const src = `${EV}/cards/${k.name}/card.json`;
  const t = k.target_stats || {};
  gate[cardKey(k.name)] = {
    verdict: c(k.verdict, `${src}: verdict`),
    canaries: c(`${k.canaries.candidate.passed} of ${k.canaries.candidate.active}`, `${src}: canaries.candidate`),
    casesActive: c(k.gating, `${src}: cases.gating (active gate cases)`),
    newlyFailing: c(k.newly_failing.length, `${src}: cases.newly_failing`),
    targetDelta: c(points(t.delta), `${src}: per_tag[target].delta`),
    targetCiLow: c(points(t.ci && t.ci[0]), `${src}: per_tag[target].ci[0]`),
    targetCiHigh: c(points(t.ci && t.ci[1]), `${src}: per_tag[target].ci[1]`),
    targetFixed: c((t.fixed || []).length, `${src}: per_tag[target].fixed`),
    targetBroken: c((t.broken || []).length, `${src}: per_tag[target].broken`),
    targetN: c(t.n, `${src}: per_tag[target].n`),
    targetPositives: c(t.positives, `${src}: per_tag[target].positives`),
    hypotheticalDelta: c(points(perTag(k, 'Hypothetical').delta), `${src}: per_tag Hypothetical delta`),
    hypotheticalCiLow: c(points((perTag(k, 'Hypothetical').ci || [])[0]), `${src}: per_tag Hypothetical ci[0]`),
    contextDelta: c(points(perTag(k, 'Context-dependent').delta), `${src}: per_tag Context-dependent delta`),
    predictiveDelta: c(points(perTag(k, 'Predictive').delta), `${src}: per_tag Predictive delta`),
    predictiveCiLow: c(points((perTag(k, 'Predictive').ci || [])[0]), `${src}: per_tag Predictive ci[0]`),
    reconfirmed: c(k.reconfirmed.length, `${src}: reconfirmed`),
    fixesConfirmed: c(recon(k, 'fixed', 'confirmed'), `${src}: reconfirmed fixed flips confirmed`),
    fixesNoise: c(recon(k, 'fixed', 'noise'), `${src}: reconfirmed fixed flips that were noise`),
    breaksConfirmed: c(recon(k, 'broken', 'confirmed'), `${src}: reconfirmed broken flips confirmed`),
    breaksNoise: c(recon(k, 'broken', 'noise'), `${src}: reconfirmed broken flips that were noise`),
    cost: c(money(k.cost && k.cost.usd), `${src}: cost.usd`),
    candidate: c(k.configs && k.configs.candidate && k.configs.candidate.config16, `${src}: configs.candidate.config16`),
  };
}
const best = ls1Cards.filter((k) => k.reconfirmed.length).sort((a, b) => recon(b, 'fixed', 'confirmed') - recon(a, 'fixed', 'confirmed'))[0];
if (!best) problems.push('no LS-1 gate card with reconfirmed cases');
const bestSrc = best ? `${EV}/cards/${best.name}/card.json` : 'missing';
const headlessRuns = data.headless;
const statusRuns = headlessRuns.filter((h) => h.test === 'status-run');
const firstPass = statusRuns.find((h) => h.ran);
const dryRun = headlessRuns.find((h) => h.test === 'tag-dry-run');
const endLessons = endState.lessons || [];
const ls1 = endLessons.find((l) => l.id === 'LS-1') || {};
const ls2 = endLessons.find((l) => l.id === 'LS-2') || {};
const cfg = data.config;
const sd = data.seed || {};
const wording = (data.persona && data.persona.wording_chars) || [];

// the Rulebook in every snapshot compared with the seeded one: tag hash and When to use per tag
const rulebookPrint = (name) => {
  const p = join(evidence, 'notion', name, 'rulebook.json');
  if (!existsSync(p)) return null;
  return JSON.stringify((readJson(p).rows || []).map((r) => [r.name, r.tag_hash, r.when_to_use, r.rule_version]).sort());
};
const withRulebook = data.snapshots.filter((s) => s.rulebook);
const firstPrint = withRulebook.length ? rulebookPrint(withRulebook[0].name) : null;
const identicalRulebooks = withRulebook.filter((s) => rulebookPrint(s.name) === firstPrint).length;

// severity counts of a persona review's findings table (rows "| ED-n | must | ...")
const reviewCounts = (file, prefix) => {
  const p = join(here, '..', 'review', file);
  if (!existsSync(p)) return { must: null, should: null, nice: null, total: null };
  const rows = [...readFileSync(p, 'utf8').matchAll(new RegExp(`^\\|\\s*${prefix}-\\d+\\s*\\|\\s*(must|should|nice)\\s*\\|`, 'gmi'))].map((m) => m[1].toLowerCase());
  return { must: rows.filter((x) => x === 'must').length, should: rows.filter((x) => x === 'should').length, nice: rows.filter((x) => x === 'nice').length, total: rows.length };
};
const editorReview = reviewCounts('persona-editor-r1.md', 'ED');

const counts = {
  _about: 'Generated by collect-evidence.mjs from the evidence files; do not edit by hand. Each entry is { value, source }.',
  claims: c(seeded.claims && seeded.claims.rows, `${EV}/notion/${seeded.name}/claims.jsonl: rows`),
  rulebookTags: c(data.rubric.tags, 'agents/claim-tagger/rubric/rubric.json: tag_count'),
  judgedTags: c(data.rubric.judged, 'agents/claim-tagger/rubric/rubric.json: judged_count'),
  rubricVersion: c(data.rubric.version, 'agents/claim-tagger/rubric/rubric.json: rubric_version (the live version, equal to rubric.lock)'),
  candidateVersion: c(ls1Cards[0] && ls1Cards[0].configs && ls1Cards[0].configs.candidate.rubric_version, `${EV}/cards/gate-ls1-attempt1/card.json: configs.candidate.rubric_version`),
  queueRowsSeeded: c(seeded.queue && seeded.queue.rows, `${EV}/notion/${seeded.name}/queue.jsonl: rows`),
  queueRowsNow: c(last.queue.rows, `${EV}/notion/${last.name}/queue.jsonl: rows`),
  decisions: c(last.queue.editor_decided, `${EV}/notion/${last.name}/queue.jsonl: rows with a Tag outcome (latest snapshot)`),
  editorDecisions: c(last.queue.editor_decided, `${EV}/notion/${last.name}/queue.jsonl: rows with a Tag outcome (latest snapshot)`),
  personaDecisions: c(afterDecisions.queue.editor_decided, `${EV}/notion/${afterDecisions.name}/queue.jsonl: rows with a Tag outcome`),
  reviewerDecisions: c(lateDecisions.filter((r) => !r.seeded_outcome).length, `${EV}/notion/${beforeReview.name} -> ${endState.name}: rows newly given a Tag outcome, without a seeded outcome`),
  seededConfirmed: c(lateDecisions.filter((r) => r.seeded_outcome).length, `${EV}/notion/${beforeReview.name} -> ${endState.name}: rows newly given a Tag outcome over a seeded outcome`),
  effectiveDecided: c(last.queue.effective, `${EV}/notion/${last.name}/queue.jsonl: rows with an Effective outcome`),
  canaries: c(data.cases.canaries_active, 'agents/claim-tagger/evals/canaries.jsonl: active'),
  canariesTotal: c(data.cases.canaries, 'agents/claim-tagger/evals/canaries.jsonl: rows'),
  casesTotal: c(data.cases.cases, 'agents/claim-tagger/evals/cases.jsonl: rows'),
  casesActive: c(data.cases.active, 'agents/claim-tagger/evals/cases.jsonl: active'),
  casesContested: c(data.cases.contested, 'agents/claim-tagger/evals/cases.jsonl: contested'),
  gateRuns: c(lessonCards.length, `${EV}/cards: gate cards with a lesson (the baseline card has none)`),
  gateAttemptsLs1: c(ls1Cards.length, `${EV}/cards/gate-ls1-attempt*`),
  gateWordingsLs1: c(new Set(ls1Cards.map((k) => k.configs && k.configs.candidate.config16)).size, `${EV}/cards/gate-ls1-attempt*/card.json: distinct candidate config ids`),
  totalCostUsd: c(money(data.total_cost_usd), `${RUNS}/*/run.json: sum of cost_usd`),
  testFiles: c(data.tests.files_at_commit, `git ls-tree ${UNIT_TESTS.commit} tests/: *.test.mjs files (the commit the unit-test figure was measured on)`),
  testCommit: c(UNIT_TESTS.commit, 'the commit the unit-test figure was measured on'),
  unitTests: c(UNIT_TESTS.value, UNIT_TESTS.source),
  personaActions: c(data.persona ? data.persona.total : null, `${EV}/persona-editor-actions.json: actions`),
  ruleOwnerApprovals: c(data.persona && data.persona.approvals, `${EV}/persona-editor-actions.json: Status Proposed -> Approved`),
  qualityAmendments: c(data.persona && data.persona.amendments, `${EV}/persona-editor-actions.json: quality-check amendments`),
  editorFieldsTouched: c(sum(data.verifies.map((v) => v.editor_changes)), `${RUNS}/*/verify.json: editor_changes, summed over every apply`),
  applies: c(data.verifies.length, `${RUNS}/*/verify.json: files`),
  appliesClean: c(data.verifies.filter((v) => v.result === 'clean').length, `${RUNS}/*/verify.json: result clean`),
  opsLanded: c(sum(data.verifies.map((v) => v.landed)), `${RUNS}/*/verify.json: landed, summed`),
  judgments: c(sum(judgeRuns.map((r) => r.counts && r.counts.done)), `${RUNS}/*/run.json (judge runs): counts.done, summed`),
  judgeErrors: c(sum(judgeRuns.map((r) => r.counts && r.counts.error)), `${RUNS}/*/run.json (judge runs): counts.error, summed`),
  judgeRuns: c(judgeRuns.length, `${RUNS}/*/run.json: kind judge`),
  tagRun: {
    claims: c(tagRun && tagRun.items, `${RUNS}/${tagRun && tagRun.run_id}/run.json: items`),
    runs: c(tagRun && tagRun.runs, `${RUNS}/${tagRun && tagRun.run_id}/run.json: runs`),
    judgments: c(tagRun && tagRun.counts && tagRun.counts.done, `${RUNS}/${tagRun && tagRun.run_id}/run.json: counts.done`),
    errors: c(tagRun && tagRun.counts && tagRun.counts.error, `${RUNS}/${tagRun && tagRun.run_id}/run.json: counts.error`),
    candidates: c((propose.rows_created ?? NaN) + (propose.held_by_cap ?? NaN), `${EV}/notion/${afterTag.name}/propose.json: rows_created + held_by_cap`),
    rowsCreated: c(propose.rows_created, `${EV}/notion/${afterTag.name}/propose.json: rows_created`),
    rowsUpdated: c(propose.rows_updated, `${EV}/notion/${afterTag.name}/propose.json: rows_updated`),
    heldByCap: c(propose.held_by_cap, `${EV}/notion/${afterTag.name}/propose.json: held_by_cap`),
    weeklyCap: c(propose.weekly_cap, `${EV}/notion/${afterTag.name}/propose.json: weekly_cap`),
    keptByDecision: c(propose.kept_by_decision, `${EV}/notion/${afterTag.name}/propose.json: kept_by_decision`),
    claimsUpdated: c(propose.claims_updated, `${EV}/notion/${afterTag.name}/propose.json: claims_updated`),
    needsEditor: c(propose.readiness_counts && propose.readiness_counts['Needs editor'], `${EV}/notion/${afterTag.name}/propose.json: readiness_counts`),
    fixNeeded: c(propose.readiness_counts && propose.readiness_counts['Fix needed'], `${EV}/notion/${afterTag.name}/propose.json: readiness_counts`),
    notCheckable: c(propose.readiness_counts && propose.readiness_counts['Not checkable'], `${EV}/notion/${afterTag.name}/propose.json: readiness_counts`),
    ready: c(propose.readiness_counts && propose.readiness_counts.Ready, `${EV}/notion/${afterTag.name}/propose.json: readiness_counts`),
  },
  baseline: {
    canaries: c(baseline && `${baseline.canaries.candidate.passed} of ${baseline.canaries.candidate.active}`, `${EV}/cards/baseline-r1/card.json: canaries`),
    casesActive: c(baseline && baseline.gating, `${EV}/cards/baseline-r1/card.json: cases.gating`),
    newlyFailing: c(baseline && baseline.newly_failing.length, `${EV}/cards/baseline-r1/card.json: cases.newly_failing`),
    judgments: c(evalRun && evalRun.counts && evalRun.counts.done, `${RUNS}/${evalRun && evalRun.run_id}/run.json: counts.done`),
    cached: c(evalRun && evalRun.counts && evalRun.counts.skipped, `${RUNS}/${evalRun && evalRun.run_id}/run.json: counts.skipped (judgments reused)`),
    config: c(baseline && baseline.configs && baseline.configs.baseline.config16, `${EV}/cards/baseline-r1/card.json: configs.baseline.config16`),
  },
  review: {
    editorMust: c(editorReview.must, 'docs/mvp-2026-10/review/persona-editor-r1.md: findings marked must'),
    editorShould: c(editorReview.should, 'docs/mvp-2026-10/review/persona-editor-r1.md: findings marked should'),
    editorNice: c(editorReview.nice, 'docs/mvp-2026-10/review/persona-editor-r1.md: findings marked nice'),
    editorTotal: c(editorReview.total, 'docs/mvp-2026-10/review/persona-editor-r1.md: findings'),
  },
  gate,
  best: {
    attempt: c(best ? Number(best.name.replace(/^.*attempt/, '')) : null, `${bestSrc}: the LS-1 card with the most confirmed fixes`),
    delta: c(best && points(best.target_stats.delta), `${bestSrc}: per_tag[target].delta`),
    ciLow: c(best && points(best.target_stats.ci[0]), `${bestSrc}: per_tag[target].ci[0]`),
    ciHigh: c(best && points(best.target_stats.ci[1]), `${bestSrc}: per_tag[target].ci[1]`),
    fixesConfirmed: c(best && recon(best, 'fixed', 'confirmed'), `${bestSrc}: reconfirmed`),
    breaksConfirmed: c(best && recon(best, 'broken', 'confirmed'), `${bestSrc}: reconfirmed`),
    runsEach: c(best && best.reconfirmed[0] && best.reconfirmed[0].baseline.runs, `${bestSrc}: reconfirmed[].baseline.runs`),
    baseAccuracy: c(best && (Math.round(best.target_stats.acc_base * 1000) / 10).toFixed(1), `${bestSrc}: per_tag[target].acc_base`),
    candAccuracy: c(best && (Math.round(best.target_stats.acc_cand * 1000) / 10).toFixed(1), `${bestSrc}: per_tag[target].acc_cand`),
  },
  wording: {
    long: c(wording.length ? Math.max(...wording) : null, `${EV}/persona-editor-actions.json: editor_wording_chars (longest Editor wording)`),
    minimal: c(wording.length ? Math.min(...wording) : null, `${EV}/persona-editor-actions.json: editor_wording_chars (shortest Editor wording)`),
  },
  cost: {
    total: c(money(data.total_cost_usd), `${RUNS}/*/run.json: sum of cost_usd (judge and distiller calls; the headless sessions are separate)`),
    tagRun: c(money(tagRun && tagRun.cost_usd), `${RUNS}/${tagRun && tagRun.run_id}/run.json: cost_usd`),
    baseline: c(money(evalRun && evalRun.cost_usd), `${RUNS}/${evalRun && evalRun.run_id}/run.json: cost_usd`),
    smoke: c(money(sum(data.runs.filter((r) => r.smoke).map((r) => r.cost_usd))), `${RUNS}/*/run.json: smoke runs`),
    distill: c(money(sum(data.runs.filter((r) => r.kind === 'distill').map((r) => r.cost_usd))), `${RUNS}/*/run.json: kind distill`),
    gates: c(money(sum(lessonCards.map((k) => k.cost && k.cost.usd))), `${EV}/cards/gate-*/card.json: cost.usd, summed`),
    headless: c(money(sum(headlessRuns.map((h) => h.cost))), `${EV}/headless/*.summary.md: cost, summed`),
    headlessMax: c(money(Math.max(...headlessRuns.map((h) => Number(h.cost) || 0))), `${EV}/headless/*.summary.md: the dearest session`),
  },
  headless: {
    sessions: c(headlessRuns.length, `${EV}/headless/*.summary.md`),
    statusRuns: c(statusRuns.length, `${EV}/headless/status-run*.summary.md`),
    statusBlocked: c(statusRuns.filter((h) => !h.ran).length, `${EV}/headless/status-run*.summary.md: every Bash call denied`),
    statusPassedOn: c(firstPass ? firstPass.attempt : null, `${EV}/headless/status-run*.summary.md: first run in which the scripts ran`),
    editorWrites: c(sum(headlessRuns.map((h) => h.editor_writes)), `${EV}/headless/*.summary.md: editor-owned fields written by the connector`),
    dryRunRan: c(dryRun ? (dryRun.ran ? 'yes' : 'no') : null, `${EV}/headless/tag-dry-run.summary.md`),
  },
  seed: {
    decided: c(sd.claims_by_sample && sd.claims_by_sample.Decided, 'agents/claim-tagger/evals/seed/seed-report.json: claims_by_sample.Decided'),
    forecast: c(sd.claims_by_sample && sd.claims_by_sample.Forecast, 'agents/claim-tagger/evals/seed/seed-report.json: claims_by_sample.Forecast'),
    random: c(sd.claims_by_sample && sd.claims_by_sample.Random, 'agents/claim-tagger/evals/seed/seed-report.json: claims_by_sample.Random'),
    rows: c(sd.decisions_total, 'agents/claim-tagger/evals/seed/seed-report.json: decisions_total'),
    seededDecision: c(sd.decisions_by_why_in_queue && sd.decisions_by_why_in_queue['Seeded decision'], 'agents/claim-tagger/evals/seed/seed-report.json: decisions_by_why_in_queue'),
    auditorFlag: c(sd.decisions_by_why_in_queue && sd.decisions_by_why_in_queue['Auditor flag'], 'agents/claim-tagger/evals/seed/seed-report.json: decisions_by_why_in_queue'),
    withOutcome: c(sd.decisions_with_seeded_outcome, 'agents/claim-tagger/evals/seed/seed-report.json: decisions_with_seeded_outcome'),
    applies: c(sd.decisions_by_seeded_outcome && sd.decisions_by_seeded_outcome.Applies, 'agents/claim-tagger/evals/seed/seed-report.json: decisions_by_seeded_outcome'),
    doesNotApply: c(sd.decisions_by_seeded_outcome && sd.decisions_by_seeded_outcome['Does not apply'], 'agents/claim-tagger/evals/seed/seed-report.json: decisions_by_seeded_outcome'),
    open: c(sd.decisions_by_seeded_outcome && sd.decisions_by_seeded_outcome.open, 'agents/claim-tagger/evals/seed/seed-report.json: decisions_by_seeded_outcome'),
    excluded: c(sd.excluded_total, 'agents/claim-tagger/evals/seed/seed-report.json: excluded_total'),
    checkByHand: c(sd.check_by_hand_rows && sd.check_by_hand_rows.length, 'agents/claim-tagger/evals/seed/seed-report.json: check_by_hand_rows'),
    sourcesFetched: c(sd.claims_with_unknown_sources_count && sd.claims_with_unknown_sources_count.count, 'agents/claim-tagger/evals/seed/seed-report.json: claims_with_unknown_sources_count'),
    auditRows: c(sd.inputs && sd.inputs['sources/claims-to-review.13oct.jsonl'] && sd.inputs['sources/claims-to-review.13oct.jsonl'].rows, 'agents/claim-tagger/evals/seed/seed-report.json: inputs (claims-to-review rows)'),
  },
  stage: { seeded: stageGroup(seeded), afterTag: stageGroup(afterTag), afterDecisions: stageGroup(afterDecisions), end: stageGroup(endState) },
  direction: { end: directionGroup(endState) },
  end: {
    snapshot: c(endState.name, `${EV}/notion: the end-state snapshot folder`),
    runsRows: c(endState.runs && endState.runs.rows, `${EV}/notion/${endState.name}/runs.jsonl: rows`),
    gateRows: c(endState.runs && endState.runs.kind.Gate, `${EV}/notion/${endState.name}/runs.jsonl: Kind Gate`),
    lessons: c(endLessons.length, `${EV}/notion/${endState.name}/lessons.jsonl: rows`),
    rulebookAtVersion: c(endState.rulebook && endState.rulebook.versions[data.rubric.version], `${EV}/notion/${endState.name}/rulebook.json: rows at the live version`),
    rulebookChanged: c(endState.rulebook && endState.rulebook.changed_by, `${EV}/notion/${endState.name}/rulebook.json: rows with Changed by`),
    snapshots: c(withRulebook.length, `${EV}/notion/*/rulebook.json: snapshots`),
    rulebookIdentical: c(identicalRulebooks, `${EV}/notion/*/rulebook.json: snapshots whose rows (tag hash, When to use, version) equal the seeded snapshot's`),
    drift: c(endState.rulebook && endState.rulebook.drift, `${EV}/notion/${endState.name}/rulebook.json: drift`),
    paused: c(endState.settings ? (endState.settings.paused ? 'yes' : 'no') : null, `${EV}/notion/${endState.name}/settings.json: paused`),
    weeklyCap: c(endState.settings && endState.settings.weekly_cap, `${EV}/notion/${endState.name}/settings.json: weekly_cap`),
    ls1Supporting: c(ls1.supporting, `${EV}/notion/${endState.name}/lessons.jsonl: LS-1 supporting rows`),
    ls1Cards: c(ls1.cards, `${EV}/notion/${endState.name}/lessons.jsonl: LS-1 result cards`),
    ls2Supporting: c(ls2.supporting, `${EV}/notion/${endState.name}/lessons.jsonl: LS-2 supporting rows`),
    claimsNeedsEditor: c(endState.claims && endState.claims.readiness['Needs editor'], `${EV}/notion/${endState.name}/claims.jsonl: Readiness`),
    claimsFixNeeded: c(endState.claims && endState.claims.readiness['Fix needed'], `${EV}/notion/${endState.name}/claims.jsonl: Readiness`),
    claimsReady: c(endState.claims && endState.claims.readiness.Ready, `${EV}/notion/${endState.name}/claims.jsonl: Readiness`),
  },
  config: {
    judgeRuns: c(cfg.judge && cfg.judge.runs, 'agents/claim-tagger/config.json: judge.runs'),
    batchSize: c(cfg.judge && cfg.judge.batch_size, 'agents/claim-tagger/config.json: judge.batch_size'),
    minPositives: c(cfg.gate && cfg.gate.min_positives, 'agents/claim-tagger/config.json: gate.min_positives'),
    tolerancePoints: c(cfg.gate && Math.round(cfg.gate.tolerance * 100), 'agents/claim-tagger/config.json: gate.tolerance, in points'),
    bootstrap: c(cfg.gate && cfg.gate.bootstrap, 'agents/claim-tagger/config.json: gate.bootstrap'),
    reconfirmRuns: c(cfg.gate && cfg.gate.reconfirm_runs, 'agents/claim-tagger/config.json: gate.reconfirm_runs'),
    reconfirmTotal: c(cfg.gate && cfg.judge && cfg.judge.runs + cfg.gate.reconfirm_runs, 'agents/claim-tagger/config.json: judge.runs + gate.reconfirm_runs'),
    ungatedHold: c(cfg.gate && cfg.gate.ungated_flips_hold, 'agents/claim-tagger/config.json: gate.ungated_flips_hold'),
    ungatedFail: c(cfg.gate && cfg.gate.ungated_flips_fail, 'agents/claim-tagger/config.json: gate.ungated_flips_fail'),
    tApply: c(cfg.thresholds && cfg.thresholds.t_apply, 'agents/claim-tagger/config.json: thresholds.t_apply'),
    tSkip: c(cfg.thresholds && cfg.thresholds.t_skip, 'agents/claim-tagger/config.json: thresholds.t_skip'),
    weeklyCap: c(cfg.queue && cfg.queue.weekly_cap_default, 'agents/claim-tagger/config.json: queue.weekly_cap_default'),
    minClaims: c(cfg.distill && cfg.distill.min_claims, 'agents/claim-tagger/config.json: distill.min_claims'),
    minClaimsRuleChange: c(cfg.distill && cfg.distill.min_claims_rule_change, 'agents/claim-tagger/config.json: distill.min_claims_rule_change'),
    overfitWords: c(cfg.distill && cfg.distill.overfit_ngram, 'agents/claim-tagger/config.json: distill.overfit_ngram'),
    maxText: c(cfg.notion && cfg.notion.max_text, 'agents/claim-tagger/config.json: notion.max_text'),
    requestsPerSecond: c(cfg.notion && cfg.notion.requests_per_second, 'agents/claim-tagger/config.json: notion.requests_per_second'),
  },
};

if (problems.length) {
  console.error(`collect-evidence: ${problems.length} figure(s) could not be found; counts.json was not written:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
writeFileSync(join(here, 'data', 'counts.json'), JSON.stringify(counts, null, 2) + '\n');
console.log(`evidence: ${data.cards.length} cards, ${data.snapshots.length} snapshots, ${data.runs.length} runs, ${data.verifies.length} applies, total cost $${money(data.total_cost_usd)}; counts written`);
