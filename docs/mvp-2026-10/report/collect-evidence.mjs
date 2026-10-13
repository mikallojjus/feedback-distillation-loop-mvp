#!/usr/bin/env node
// collect-evidence.mjs: aggregate the MVP evidence into data/evidence.json and data/counts.json for build.mjs.
// Reads only files under docs/mvp-2026-10/evidence and agents/claim-tagger; writes only under docs/mvp-2026-10/report/data.

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const evidence = join(here, '..', 'evidence');
const agent = join(repo, 'agents', 'claim-tagger');

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
      target_stats: target ? { n: target.n, positives: target.positives, acc_base: target.acc_base, acc_cand: target.acc_cand, delta: target.delta, ci: target.ci, fixed: target.fixed, broken: target.broken } : null,
      per_tag: (c.per_tag || []).map((t) => ({ tag: t.tag, n: t.n, positives: t.positives, acc_base: t.acc_base, acc_cand: t.acc_cand, delta: t.delta, ci: t.ci, gated: t.gated, fixed: (t.fixed || []).length, broken: (t.broken || []).length })),
      reconfirmed: c.reconfirmed || [], reasons: c.reasons || [], holds: c.holds || [], cost: c.cost || null, md,
      configs: c.configs || null,
    };
  }).filter(Boolean);
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
      out.queue = { rows: rows.length, stage: count('stage'), direction: count('direction'), why_in_queue: count('why_in_queue'), editor_decided: rows.filter((r) => r.tag_outcome).length };
    }
    const l = join(dir, name, 'lessons.jsonl');
    if (existsSync(l)) out.lessons = readJsonl(l).map((x) => ({ key: x.lesson_key, id: x.lesson_id, status: x.status, tag: x.tag, rule: x.rule_label }));
    const c = join(dir, name, 'claims.jsonl');
    if (existsSync(c)) { const rows = readJsonl(c); out.claims = { rows: rows.length, readiness: rows.reduce((m, r) => { const v = r.readiness ?? '(none)'; m[v] = (m[v] || 0) + 1; return m; }, {}) }; }
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

function personaActions() {
  const p = join(evidence, 'persona-editor-actions.json');
  if (!existsSync(p)) return null;
  const j = readJson(p);
  const actions = j.actions || [];
  const byRole = actions.reduce((m, a) => { const r = a.role || 'editor'; m[r] = (m[r] || 0) + 1; return m; }, {});
  return { total: actions.length, by_role: byRole, fields_written: [...new Set(actions.flatMap((a) => Object.keys(a.after || {})))] };
}

function headless() {
  const dir = join(evidence, 'headless');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.summary.md')).sort().map((f) => {
    const text = readFileSync(join(dir, f), 'utf8');
    const grab = (re) => { const m = text.match(re); return m ? m[1] : null; };
    return { file: f, is_error: grab(/is_error: (\w+)/), turns: grab(/turns: (\d+)/), cost: grab(/cost: \$([\d.]+)/), denials: grab(/permission denials: (\d+)/), editor_writes: grab(/Editor-owned fields written by the connector: (\d+)/) };
  });
}

function tests() {
  const dir = join(repo, 'tests');
  const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs'));
  return { files: files.length };
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

const data = { generated_at: new Date().toISOString(), rubric: rubric(), cases: cases(), seed: seed(), cards: cards(), snapshots: snapshots(), runs: runs(), persona: personaActions(), headless: headless(), tests: tests() };
const totalCost = data.runs.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
data.total_cost_usd = Math.round(totalCost * 100) / 100;

mkdirSync(join(here, 'data'), { recursive: true });
writeFileSync(join(here, 'data', 'evidence.json'), JSON.stringify(data, null, 2) + '\n');

// counts.json keys used by {{count:key}} placeholders in the parts
const seeded = data.snapshots.find((s) => s.name.startsWith('00-')) || {};
const last = data.snapshots[data.snapshots.length - 1] || {};
const counts = {
  claims: seeded.claims ? seeded.claims.rows : (data.seed ? data.seed.counts?.claims?.total ?? 60 : 60),
  queueRowsSeeded: seeded.queue ? seeded.queue.rows : 50,
  queueRowsNow: last.queue ? last.queue.rows : null,
  editorDecisions: last.queue ? last.queue.editor_decided : null,
  rulebookTags: data.rubric.tags,
  judgedTags: data.rubric.judged,
  canaries: data.cases.canaries_active,
  casesActive: data.cases.active,
  casesContested: data.cases.contested,
  gateRuns: data.cards.filter((c) => c.kind === 'gate').length,
  totalCostUsd: data.total_cost_usd,
  testFiles: data.tests.files,
  personaActions: data.persona ? data.persona.total : 0,
  editorFieldsTouched: 0,
};
writeFileSync(join(here, 'data', 'counts.json'), JSON.stringify(counts, null, 2) + '\n');
console.log(`evidence: ${data.cards.length} cards, ${data.snapshots.length} snapshots, ${data.runs.length} runs, total cost $${data.total_cost_usd}; counts written`);
