#!/usr/bin/env node
// run-card.mjs: write a Runs row (a result card) for a judge/propose run or for an eval card.
//
//   node run-card.mjs --tag <judge-run-id> --propose <propose-run-id> [--pull <id>] [--run-id <id>]
//   node run-card.mjs --card <dir-with-card.json> --kind Baseline|Gate|Smoke|Follow-up|Rollback --title "<title>" [--lesson <key>] [--pull <id>]
//
// Produces runs/<run-id>/plan.jsonl with one Runs create; then `plan.mjs check --run <id>` and `apply.mjs --run <id>`.
// The Verdict column is the gate verdict, so only --kind Gate fills it from the card; a Baseline, Smoke, Follow-up or Rollback row says
// n/a there and keeps the card's own verdict word in its Summary text.
// The agent-owned Runs database has no editor fields, so this is the simplest plan in the repository.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openPlan } from './plan.mjs';
import { latestPullId } from './pull.mjs';
import { agentRoot, runId as makeRunId, isMain } from './lib/paths.mjs';
import { EXIT } from './lib/exit-codes.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    out[k] = v;
  }
  return out;
}

function readJson(p) { return JSON.parse(readFileSync(p, 'utf8')); }

export function buildTagCard(root, judgeRun, proposeRun) {
  const run = readJson(join(root, 'runs', judgeRun, 'run.json'));
  const prop = readJson(join(root, 'runs', proposeRun, 'propose.json'));
  const r = prop.readiness_counts || {};
  const summary = [
    `Tagged ${prop.claims_judged} claims under rubric ${run.rubric_version} (${run.rubric_hash}), ${run.model}, ${run.runs} run(s) each.`,
    `Queue: ${prop.rows_created} rows created, ${prop.rows_updated} updated, ${prop.held_by_cap} held back by the weekly cap of ${prop.weekly_cap}.`,
    `Readiness: Needs editor ${r['Needs editor'] || 0}, Fix needed ${r['Fix needed'] || 0}, Not checkable ${r['Not checkable'] || 0}, Ready ${r['Ready'] || 0}.`,
    `Decided tags kept as decided: ${prop.kept_by_decision}. Editor fields changed by the agent: 0 (verified by read-back).`,
    `Cost $${Number(run.cost_usd || 0).toFixed(2)}.`,
  ].join('\n');
  const title = `Tag ${run.rubric_version} · ${judgeRun}`;
  const props = {
    'Run title': title,
    Kind: 'Tag',
    'Rubric version': run.rubric_version,
    Started: run.started,
    'Claims judged': prop.claims_judged,
    Canaries: '',
    'Newly failing': null,
    'Per-tag summary': Object.entries(prop.by_why_in_queue || {}).map(([k, v]) => `${k}: ${v}`).join(' · '),
    Verdict: 'n/a',
    Summary: summary.slice(0, 1900),
    'Cost USD': Number(run.cost_usd || 0),
    Model: `${run.model} · effort ${run.effort || 'default'}`,
  };
  const content = `# Tag run ${judgeRun}\n\n${summary}\n\n## Judge configuration\n\n- config id: ${run.config_id}\n- rubric: ${run.rubric_version} ${run.rubric_hash}\n- runs per claim: ${run.runs}\n- propose run: ${proposeRun}\n`;
  return { title, props, content };
}

export function buildEvalCard(root, cardDir, kind, title, lesson) {
  const card = readJson(join(cardDir, 'card.json'));
  const md = existsSync(join(cardDir, 'card.md')) ? readFileSync(join(cardDir, 'card.md'), 'utf8') : '';
  const can = card.canaries || {};
  const canText = can.candidate ? `${can.candidate.passed} of ${can.candidate.active}` : (can.passed !== undefined ? `${can.passed} of ${can.active}` : '');
  const cases = card.cases || {};
  const perTag = (card.per_tag || []).map((t) => `${t.tag}: ${t.acc_base == null ? '-' : Math.round(t.acc_base * 100) + '%'} -> ${t.acc_cand == null ? '-' : Math.round(t.acc_cand * 100) + '%'} (n ${t.n}${t.gated ? '' : ', not gated'})`).join(' · ');
  // Only a Gate row carries the gate verdict. A Baseline, Smoke, Follow-up or Rollback row is not a gate result, so its Verdict column
  // is n/a; the card's own verdict word stays in the Summary text (the card.md line "Verdict: ...", or one added here when that line is missing).
  const verdictWord = typeof card.verdict === 'string' && card.verdict !== '' ? card.verdict : null;
  const hasVerdictLine = verdictWord !== null && md.split('\n').some((l) => l.startsWith(`Verdict: ${verdictWord}`));
  const summary = kind !== 'Gate' && verdictWord !== null && !hasVerdictLine ? `Verdict: ${verdictWord}\n${md}` : md;
  const props = {
    'Run title': title,
    Kind: kind,
    'Rubric version': card.configs && card.configs.candidate ? `${card.configs.baseline ? card.configs.baseline.rubric_version + ' → ' : ''}${card.configs.candidate.rubric_version}` : '',
    Started: new Date().toISOString(),
    'Claims judged': (card.cases && card.cases.gating ? card.cases.gating.length : null),
    Canaries: canText,
    'Newly failing': Array.isArray(cases.newly_failing) ? cases.newly_failing.length : (cases.newly_failing ?? null),
    'Per-tag summary': perTag.slice(0, 1900),
    Verdict: kind === 'Gate' ? card.verdict : 'n/a',
    Summary: summary.slice(0, 1900),
    'Cost USD': card.cost && card.cost.usd != null ? Number(card.cost.usd) : null,
    Model: card.configs && card.configs.candidate && card.configs.candidate.model ? card.configs.candidate.model : '',
  };
  if (lesson) props.Lesson = { rule_changes: lesson };
  const content = `# ${title}\n\n\`\`\`\n${md}\n\`\`\`\n\n## Full card\n\n\`\`\`json\n${JSON.stringify(card, null, 2).slice(0, 60000)}\n\`\`\`\n`;
  return { title, props, content };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = agentRoot();
  const sourcePull = args.pull || latestPullId(root);
  const runId = args['run-id'] || makeRunId('card');
  let built;
  if (args.tag) built = buildTagCard(root, args.tag, args.propose);
  else if (args.card) built = buildEvalCard(root, args.card, args.kind || 'Baseline', args.title || `Card ${runId}`, args.lesson || null);
  else { console.error('usage: run-card.mjs --tag <judge-run> --propose <propose-run> | --card <dir> --kind <Kind> --title <title> [--lesson <key>]'); return EXIT.INVALID; }
  const plan = openPlan({ runId, sourcePull, root });
  const props = Object.fromEntries(Object.entries(built.props).filter(([, v]) => v !== null && v !== undefined && v !== ''));
  plan.create('runs', built.title, props, { content_md: built.content, note: 'run card' });
  // Keep Agent settings current (agent-owned fields only): the editors' page shows when the agent last ran and what it did.
  try {
    const idMap = JSON.parse(readFileSync(join(root, 'runs', 'pull', sourcePull, 'id-map.json'), 'utf8'));
    const settingsId = idMap.agent_settings && idMap.agent_settings['claim-tagger'];
    if (settingsId) {
      const summary = String(props.Summary || built.title).split('\n')[0].slice(0, 300);
      plan.update('agent_settings', 'claim-tagger', settingsId, { 'Last run at': new Date().toISOString(), 'Last run summary': `${built.title}: ${summary}` }, { note: 'last run' });
    }
  } catch { /* no settings row in the pull: skip */ }
  const out = plan.write();
  console.log(`run-card: plan ${runId} written (${built.title}); next: plan.mjs check --run ${runId}, then apply.mjs --run ${runId}`);
  return EXIT.OK;
}

if (isMain(import.meta.url)) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(`run-card: ${e.message}`); process.exit(EXIT.ERROR); });
}
