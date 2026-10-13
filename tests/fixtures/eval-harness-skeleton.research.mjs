#!/usr/bin/env node
/**
 * eval-harness-skeleton.mjs — outline of the claim-tagger evaluation harness (geo-agents/agents/claim-tagger/evals/run.mjs).
 *
 * THE GATE, stated once. The report's Decision tab, the glossary and this header carry the same text, and the code below
 * implements it:
 *   A candidate (a rubric version, prompt version, model and scope) is compared with the current version on the same
 *   claims: the gold set, the active saved cases and the canaries, three runs each, verdicts by majority. It passes
 *   only if (1) every active canary passes (contested canaries are inactive until the rule owner's ruling); (2) no
 *   active saved case that the current version passes fails under the candidate; (3) for every tag with at least 30
 *   labelled positives in the gold set (claims labelled as carrying the tag: the "labelled examples" of the one-line
 *   version), the lower bound of the paired change in claim-level accuracy is above minus 5 points (percentage
 *   points of correctly tagged claims); (4) when the change names a target tag, that tag's lower bound is above
 *   zero; (5) no tag the agent must never write (the human-only Editor verified, or the computed Unsourced) is
 *   written. Tags with fewer than 30 labelled positives are reported, not gated: one named negative flip on such a
 *   tag whose rules changed, or which is newly in scope, gives HOLD, more than two give FAIL. HOLD also results when
 *   the target's interval straddles zero. On HOLD the candidate stays unpublished, the weekly blind check adds
 *   labels, and the gate is re-run; on FAIL the candidate is rolled back. Cases whose rule fingerprint no longer
 *   matches the live rulebook are listed for re-confirmation and do not gate.
 *
 * Runs inside Claude Code on the subscription: plain Node, no API key, no network. The agent outputs it reads are
 * judgment files written by tagging runs (runs/<date>/run-<n>/<id>.json, one per claim per run; canary claims are judged
 * under their canary id). Nothing here writes to Notion.
 *
 * Usage:
 *   node evals/run.mjs --rubric rubric/rubric.json --baseline-rubric rubric/rubric.baseline.json --gold gold.jsonl \
 *        --cases cases.jsonl --canaries canaries.jsonl --baseline runs/2026-10-20/ --candidate runs/2026-10-21/ \
 *        --tolerance 0.05 --min-positives 30 --runs 3 --target Predictive --out evals/reports/2026-10-21
 *   The two rubric files may differ only in scope (the day-6 candidate); the harness evaluates the union of their judged tags.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ---------- 0. configuration -------------------------------------------------------------------------------------
const config = {
  tolerance: 0.05,          // the lower bound of the paired accuracy change may not fall below −5 points
  minPositives: 30,         // below this many labelled positives a tag is reported, not gated
  maxNewlyFailing: 0,       // regression cases the baseline passes that the candidate fails
  ungatedFlipsHold: 1,      // named negative flips on an ungated tag whose rules changed: this many or more gives HOLD
  ungatedFlipsFail: 3,      // and this many or more gives FAIL
  runs: 3,                  // runs per version; verdicts by majority; a missing run is "run incomplete", never "two of two"
  bootstrap: 1000,          // resamples for the paired accuracy-change interval
  floor: 0.60,              // DD5 write floor, kept as config; not used by the gate (the gate reads decisions, not p)
};

// ---------- 1. loading ----------------------------------------------------------------------------------------------
/** rubric.json: the tag list, per-tag hashes and the scope come from here, never from the gold set. */
function loadRubric(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/** gold.jsonl: one line per claim per labeller round, merged by the sampler into one adjudicated line per claim
 *   { geo_id, claim, table: "us-politics" | "world-affairs", stratum: "random" | "enriched" | "challenged" | "boundary" | "weekly-blind",
 *     weight: 1.0,                      // the stratum's sampling weight; "boundary" rows carry weight 0 for population figures
 *     tags: ["Hypothetical"], cannot_tell: ["Improperly sourced", "Source inaccessible"],   // sources are not opened in gold v1
 *     labelled_blind: true, labeller: "editor-2", second_labeller: "editor-1" | null, agreed: true | false | null,
 *     reviewed_at, rubric_version, tag_hashes: { "Hypothetical": "sha256:…", … } }
 *  Every judged tag has a label (present, absent, or cannot_tell) on every gold claim. Rows labelled with the agent's
 *  proposal on screen are NOT gold (DD6 as revised): they are regression cases. A gold label whose tag_hash differs
 *  from the current rubric is listed for re-confirmation and not graded until confirmed. Per-tag rates are weighted
 *  by `weight`; the boundary stratum feeds only the target check. */
function loadGold(file) { return readJsonl(file); }

/** cases.jsonl and canaries.jsonl: see regression-case-format.md. Only active, non-contested items gate. A case whose
 *  rule_hash (or, when it cites no rule, tag_hash) is not in the live rubric awaits re-confirmation and is reported, not gated. */
function loadCases(file, rubric) {
  const liveRuleHashes = new Set(rubric.tags.flatMap(t => t.when_to_use.rules.map(r => r.rule_hash)));
  const liveTagHashes = new Set(rubric.tags.map(t => t.tag_hash));
  const all = readJsonl(file).filter(c => c.active && !c.contested && (c.suite ?? 'gate') === 'gate');
  const current = c => c.rule_hash ? liveRuleHashes.has(c.rule_hash) : liveTagHashes.has(c.tag_hash);
  return { gating: all.filter(current), awaitingReconfirmation: all.filter(c => !current(c)) };
}
function loadCanaries(file) { return readJsonl(file).filter(c => c.active && !c.contested); }

/** A run directory holds one judgment per claim per run, under runs/<date>/run-<n>/<id>.json:
 *   { id, run: 1|2|3, tags: [{name, decision: "apply"|"do_not_apply"|"ask_editor"|"cannot_tell", p, rule_ref, rule_hash, reason}],
 *     config: { model, rubric_version, rubric_hash, scope_hash, prompt_version } }
 *  Coverage: every gold claim, every case claim and every canary must be present in every run, with a decision for every
 *  tag in THAT RUN'S scope (the baseline and the candidate may differ in scope: the day-6 change), and exactly config.runs
 *  runs must exist. Anything missing is "run incomplete" (exit 2), never a silent "do not apply". A tag outside a run's
 *  scope was not written by that configuration, and is scored as not applied: that is the truth of the configuration. */
function loadRun(dir, expectedIds, judgedTags) {
  const runDirs = fs.readdirSync(dir).filter(d => /^run-\d+$/.test(d)).sort();
  if (runDirs.length !== config.runs) throw new Error(`run incomplete: ${dir} has ${runDirs.length} runs, expected ${config.runs}`);
  const byRun = new Map(), configs = new Set();
  for (const rd of runDirs) {
    const m = new Map();
    for (const f of fs.readdirSync(path.join(dir, rd)).filter(f => f.endsWith('.json'))) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, rd, f), 'utf8'));
      configs.add(JSON.stringify(j.config)); m.set(j.id, j);
    }
    byRun.set(rd, m);
  }
  if (configs.size !== 1) throw new Error(`run ${dir} mixes configurations`);
  const missing = [], noDecision = [];
  for (const id of expectedIds) for (const [rd, m] of byRun) {
    const j = m.get(id);
    if (!j) { missing.push(`${rd}/${id}`); continue; }
    for (const t of judgedTags) if (!j.tags.some(x => x.name === t && x.decision)) noDecision.push(`${rd}/${id}/${t}`);
  }
  return { byRun, config: JSON.parse([...configs][0]), missing, noDecision };
}
function readJsonl(file) { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }

// ---------- 2. verdicts ---------------------------------------------------------------------------------------------
/** Majority verdict across runs for one tag on one claim: "apply" if applied in 2 of 3 runs, else not. "ask_editor" and
 *  "cannot_tell" count as not applied for the gate and are reported separately. A tag outside the run's scope has no
 *  decision and counts as not applied (loadRun has already checked that every in-scope tag has one). */
function verdict(run, id, tag) {
  const votes = [...run.byRun.values()].map(m => (m.get(id).tags.find(t => t.name === tag) || {}).decision === 'apply');
  return votes.filter(Boolean).length * 2 > votes.length;
}
/** Self-flip rate: share of (claim, tag) cells on which the same version disagrees with itself across its runs. Reported
 *  on the card as the noise floor; it is not a gate condition. */
function selfFlipRate(run, ids, tags) { /* ... count cells with mixed votes / total cells ... */ }
/** Written-when-forbidden: any apply on a tag with judged: false, in any run, on any claim. */
function forbiddenWrites(run, ids, forbiddenTags) {
  const hits = [];
  for (const id of ids) for (const [rd, m] of run.byRun) for (const t of m.get(id).tags) if (forbiddenTags.has(t.name) && t.decision === 'apply') hits.push(`${rd}/${id}/${t.name}`);
  return hits;
}

// ---------- 3. per-tag metrics (reported for every judged tag, weighted by stratum) ---------------------------------
function perTag(tag, gold, run) {
  let tp = 0, fp = 0, fn = 0, tn = 0, ct = 0, positives = 0;
  for (const g of gold) {
    if ((g.cannot_tell || []).includes(tag)) { ct++; continue; }
    const w = g.weight ?? 1, truth = g.tags.includes(tag), pred = verdict(run, g.geo_id, tag);
    if (truth) positives++;                       // unweighted count: this is what decides "gated"
    if (pred && truth) tp += w; else if (pred && !truth) fp += w; else if (!pred && truth) fn += w; else tn += w;
  }
  const n = tp + fp + fn + tn, acc = (tp + tn) / (n || 1), p = tp / (tp + fp || 1), r = tp / (tp + fn || 1);
  return { tag, positives, n, cannotTell: ct, accuracy: acc, precision: p, recall: r, f1: (2 * p * r) / (p + r || 1),
           precisionCI: wilson(tp, tp + fp), recallCI: wilson(tp, tp + fn), gated: positives >= config.minPositives };
}
function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 1];
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - s) / d, (c + s) / d];
}
function pairConfusion(pair, gold, run) { /* ... 2x2 matrix per counterpart pair (gold A/B x predicted A/B/neither) ... */ }

// ---------- 4. paired comparison on claim-level accuracy ---------------------------------------------------------
/** Same gold claims, two versions, majority verdict against majority verdict. For each tag: per-claim correctness under
 *  baseline and candidate; the weighted paired difference in accuracy with a bootstrap interval; named negative flips
 *  (claims right before, wrong now). Rows the target check uses (stratum "boundary") are included for the target tag only. */
function paired(tag, gold, base, cand, { includeBoundary = false } = {}) {
  const rows = gold.filter(g => !(g.cannot_tell || []).includes(tag) && (includeBoundary || g.stratum !== 'boundary')).map(g => {
    const truth = g.tags.includes(tag);
    return { id: g.geo_id, w: g.weight ?? 1, okB: verdict(base, g.geo_id, tag) === truth, okC: verdict(cand, g.geo_id, tag) === truth };
  });
  const wsum = rows.reduce((s, r) => s + r.w, 0) || 1;
  const delta = rows.reduce((s, r) => s + r.w * ((r.okC ? 1 : 0) - (r.okB ? 1 : 0)), 0) / wsum;
  return { tag, deltaAccuracy: delta, deltaCI: bootstrapDelta(rows), negativeFlips: rows.filter(r => r.okB && !r.okC).map(r => r.id),
           positiveFlips: rows.filter(r => !r.okB && r.okC).length, mcnemarP: exactMcNemar(rows.filter(r => r.okB && !r.okC).length, rows.filter(r => !r.okB && r.okC).length) };
}
function bootstrapDelta(rows) { /* resample rows with replacement config.bootstrap times (weights kept); 2.5th and 97.5th percentile of the mean difference */ }
function exactMcNemar(b, c) { /* two-sided binomial test on min(b, c) out of b + c; 1 when b + c === 0 */ }

// ---------- 5. suites -------------------------------------------------------------------------------------------------
/** Cases are judged under their claim's id, canaries under "canary:<canary_id>"; both are in the coverage check. */
const itemId = it => it.geo_id ?? `canary:${it.canary_id}`;
function runSuite(items, run, base) {
  return items.map(it => {
    const got = verdict(run, itemId(it), it.tag) ? 'apply' : 'do_not_apply';
    const gotBase = base ? (verdict(base, itemId(it), it.tag) ? 'apply' : 'do_not_apply') : null;
    return { id: it.case_id ?? it.canary_id, tag: it.tag, pass: got === it.expected, passBase: gotBase === null ? null : gotBase === it.expected };
  });
}

// ---------- 6. the gate (the five conditions in the header, in order) ----------------------------------------------
function gate({ canaryResults, caseResults, pairs, metrics, target, targetPair, changedTags, forbidden }) {
  const reasons = [], holds = [], notGated = [];
  const canaryFails = canaryResults.filter(r => !r.pass);
  if (canaryFails.length) reasons.push(`${canaryFails.length} canaries fail: ${canaryFails.slice(0, 5).map(r => r.id).join(', ')}`);            // 1
  const newlyFailing = caseResults.filter(r => r.passBase === true && !r.pass);
  if (newlyFailing.length > config.maxNewlyFailing) reasons.push(`${newlyFailing.length} regression cases newly failing: ${newlyFailing.slice(0, 5).map(r => r.id).join(', ')}`);   // 2
  for (const p of pairs) {                                                                                                       // 3, and the ungated rule
    const m = metrics.find(x => x.tag === p.tag);
    if (!m.gated) {
      notGated.push(`${p.tag} (${m.positives} positives)`);
      if (changedTags.has(p.tag) && p.negativeFlips.length >= config.ungatedFlipsFail) reasons.push(`${p.tag} (not gated): ${p.negativeFlips.length} negative flips after a rule change`);
      else if (changedTags.has(p.tag) && p.negativeFlips.length >= config.ungatedFlipsHold) holds.push(`${p.tag} (not gated): negative flips ${p.negativeFlips.join(', ')}`);
      continue;
    }
    if (p.deltaCI[0] < -config.tolerance) reasons.push(`${p.tag}: accuracy lower bound ${(p.deltaCI[0] * 100).toFixed(1)} points (tolerance −${config.tolerance * 100})`);
  }
  if (target) {                                                                                                                  // 4
    const t = targetPair;
    if (!t) reasons.push(`${target}: not evaluated`);
    else if (t.deltaCI[1] <= 0) reasons.push(`${target}: no improvement (upper bound ${(t.deltaCI[1] * 100).toFixed(1)})`);
    else if (t.deltaCI[0] <= 0) holds.push(`${target}: interval straddles zero (${(t.deltaCI[0] * 100).toFixed(1)} to ${(t.deltaCI[1] * 100).toFixed(1)} points); more labels needed`);
  }
  if (forbidden.length) reasons.push(`${forbidden.length} writes on tags the agent must never write: ${forbidden.slice(0, 5).join(', ')}`);   // 5
  const verdictWord = reasons.length ? 'FAIL' : holds.length ? 'HOLD' : 'PASS';
  return { verdict: verdictWord, reasons, holds, notGated };
}

// ---------- 7. reports -----------------------------------------------------------------------------------------------
/** eval-card.md, ten lines for a product owner:
 *    Change under test: rubric 2026-10-20.2 vs 2026-10-21.1 (hashes …), scope … vs …, model …, prompt v….
 *    Verdict: PASS | HOLD | FAIL, one sentence.
 *    Gold: 152 claims (118 U.S. Politics, 34 World affairs), 150 labelled blind by two editors; boundary set 18; agreement per tag in the appendix.
 *    Better: Hypothetical +9 points (lower bound +3). Worse or at risk: none past −5. Not gated: Source inaccessible (6 positives), Multiple statements (4), …
 *    Suites: canaries 83 of 83; regression 31 of 33 pass (baseline 26); newly failing 0; awaiting re-confirmation 0.
 *    Noise: baseline self-flips 2.1% of cells; candidate self-flips 1.8%.
 *  report.json: every cell, pinned to both configurations. */
function writeReports(outDir, summary) { fs.mkdirSync(outDir, { recursive: true }); /* ... */ }

// ---------- main -----------------------------------------------------------------------------------------------------
function main(argv) {
  const args = parseArgs(argv);
  const rubric = loadRubric(args.rubric), baseRubric = args.baselineRubric ? loadRubric(args.baselineRubric) : rubric;
  const judgedCand = rubric.tags.filter(t => t.judged).map(t => t.name), judgedBase = baseRubric.tags.filter(t => t.judged).map(t => t.name);
  const judged = [...new Set([...judgedCand, ...judgedBase])];                                                    // evaluated: the union of both scopes
  const forbiddenTags = new Set(rubric.tags.filter(t => !t.judged).map(t => t.name));                           // human-only and computed
  // a tag counts as changed when its rules changed or when it is newly in scope: both are what the ungated-flip rule guards
  const changedTags = new Set(rubric.tags.filter(t => (baseRubric.tags.find(b => b.name === t.name) || {}).tag_hash !== t.tag_hash).map(t => t.name));
  for (const t of judgedCand) if (!judgedBase.includes(t)) changedTags.add(t);
  const gold = loadGold(args.gold), { gating: cases, awaitingReconfirmation } = loadCases(args.cases, rubric), canaries = loadCanaries(args.canaries);
  const ids = new Set([...gold.map(g => g.geo_id), ...cases.map(c => c.geo_id), ...canaries.map(itemId)]);
  const base = loadRun(args.baseline, ids, judgedBase), cand = loadRun(args.candidate, ids, judgedCand);   // each run against its own scope
  const incomplete = [...base.missing, ...cand.missing, ...base.noDecision, ...cand.noDecision];
  if (incomplete.length) { console.log('run incomplete:', incomplete.length, 'gaps, for example', incomplete.slice(0, 5).join(', ')); process.exit(2); }
  const metrics = judged.map(t => perTag(t, gold, cand));
  const pairs = judged.map(t => paired(t, gold, base, cand));
  const targetPair = args.target ? paired(args.target, gold, base, cand, { includeBoundary: true }) : null;
  const noise = { baselineSelfFlipRate: selfFlipRate(base, ids, judged), candidateSelfFlipRate: selfFlipRate(cand, ids, judged) };
  const forbidden = forbiddenWrites(cand, ids, forbiddenTags);
  const decision = gate({ canaryResults: runSuite(canaries, cand, base), caseResults: runSuite(cases, cand, base), pairs, metrics, target: args.target, targetPair, changedTags, forbidden });
  writeReports(args.out, { configs: { baseline: base.config, candidate: cand.config }, metrics, pairs, targetPair, decision, noise, awaitingReconfirmation: awaitingReconfirmation.map(c => c.case_id) });
  console.log(decision.verdict, [...decision.reasons, ...decision.holds].join('; '), decision.notGated.length ? `| not gated: ${decision.notGated.join(', ')}` : '',
              awaitingReconfirmation.length ? `| cases awaiting re-confirmation: ${awaitingReconfirmation.length}` : '');
  process.exit(decision.verdict === 'PASS' ? 0 : 1);
}
function parseArgs(argv) { /* --rubric --baseline-rubric --gold --cases --canaries --baseline --candidate --tolerance --min-positives --runs --target --out */ return {}; }

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));   // works on Windows paths too
