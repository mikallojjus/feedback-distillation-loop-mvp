#!/usr/bin/env node
// recard.mjs: re-render the Summary of existing gate and smoke Runs rows, and the Gate result of their lessons, from the
// card.json files on disk. Used once after the card wording changes (13 October 2026: the "For editors:" opener and the
// rollback line only on PASS cards), so the cards editors see on the hub match what new runs would write.
//
//   node recard.mjs [--pull <id>] [--run-id <id>] [--dry-run]
//
// Writes runs/<run-id>/plan.jsonl with Runs Summary updates, Rule changes Gate result updates (the latest card per
// lesson) and the Agent settings Last run at (the newest Runs row's Started); then plan.mjs check and apply.mjs as usual.
// Only agent-owned fields; no Rulebook op, no lesson Status, so no gate evidence is involved.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openPlan } from './plan.mjs';
import { latestPullId } from './pull.mjs';
import { renderCardMd } from './eval.mjs';
import { agentRoot, runId as makeRunId, isMain } from './lib/paths.mjs';
import { EXIT } from './lib/exit-codes.mjs';

const MAX_TEXT = 1900;

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

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const norm = (s) => String(s ?? '').replace(/\r\n/g, '\n').trim();

/** Every run folder with a card.json and a run_title: { runId, title, card, md }. */
export function cardsOnDisk(root) {
  const runsDir = join(root, 'runs');
  const out = [];
  for (const name of readdirSync(runsDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const dir = join(runsDir, name.name);
    if (!existsSync(join(dir, 'card.json')) || !existsSync(join(dir, 'run.json'))) continue;
    const run = readJson(join(dir, 'run.json'));
    if (!run.run_title) continue;
    const card = readJson(join(dir, 'card.json'));
    out.push({ runId: name.name, title: run.run_title, card, md: renderCardMd(card).trimEnd() });
  }
  return out.sort((a, b) => (a.runId < b.runId ? -1 : 1));
}

export function buildRecardPlan({ root, pullId, dryRun = false }) {
  const pullDir = join(root, 'runs', 'pull', pullId);
  const runsRows = readJsonl(join(pullDir, 'norm', 'runs.jsonl'));
  const lessons = readJsonl(join(pullDir, 'norm', 'lessons.jsonl'));
  const idMap = readJson(join(pullDir, 'id-map.json'));
  const cards = cardsOnDisk(root);
  const runId = makeRunId('recard');
  const plan = openPlan({ runId, sourcePull: pullId, root });
  const changes = [];

  // 1. Runs rows: Summary = the re-rendered card
  const rowByTitle = new Map(runsRows.map((r) => [r.title, r]));
  for (const c of cards) {
    const row = rowByTitle.get(c.title);
    if (!row) { changes.push({ skip: `no Runs row titled "${c.title}"` }); continue; }
    const summary = c.md.slice(0, MAX_TEXT);
    if (norm(row.summary) === norm(summary)) continue;
    plan.update('runs', c.title, row.page_id, { Summary: summary }, { note: `card re-rendered from runs/${c.runId}/card.json` });
    changes.push({ runs: c.title });
  }

  // 2. Rule changes: Gate result = the latest gate card of the lesson
  for (const lesson of lessons) {
    if (!lesson.gate_result) continue;
    const mine = cards.filter((c) => c.card.kind === 'gate' && c.card.lesson === lesson.lesson_key);
    if (!mine.length) continue;
    const latest = mine[mine.length - 1];
    const text = latest.md.slice(0, MAX_TEXT);
    if (norm(lesson.gate_result) === norm(text)) continue;
    plan.update('rule_changes', lesson.lesson_key, lesson.page_id, { 'Gate result': text }, { note: `gate result re-rendered from runs/${latest.runId}/card.json` });
    changes.push({ rule_changes: lesson.lesson_key, from: latest.runId });
  }

  // 3. Agent settings: Last run at = the newest Runs row's Started
  const started = runsRows.map((r) => r.started).filter(Boolean).sort();
  const settingsId = idMap.agent_settings && idMap.agent_settings['claim-tagger'];
  if (settingsId && started.length) {
    plan.update('agent_settings', 'claim-tagger', settingsId, { 'Last run at': started[started.length - 1] }, { note: 'Last run at follows the newest Runs row' });
    changes.push({ agent_settings: started[started.length - 1] });
  }

  if (dryRun) return { runId, changes, written: null };
  const written = plan.write();
  return { runId, changes, written };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = agentRoot();
  const pullId = args.pull || latestPullId(root);
  if (!pullId) { console.error('recard: no pull; run pull.mjs --all first'); return EXIT.INVALID; }
  const { runId, changes, written } = buildRecardPlan({ root, pullId, dryRun: args['dry-run'] === true });
  const ops = changes.filter((c) => !c.skip);
  for (const c of changes) if (c.skip) console.error(`recard: skipped: ${c.skip}`);
  if (!ops.length) { console.log('recard: every card already matches its re-rendered text; nothing to do'); return EXIT.INVALID; }
  console.log(`recard: ${ops.length} update(s) (${ops.filter((c) => c.runs).length} Runs rows, ${ops.filter((c) => c.rule_changes).length} Gate result(s), ${ops.filter((c) => c.agent_settings).length} settings) ${written ? `in plan ${runId}; next: plan.mjs check --run ${runId}, then apply.mjs --run ${runId}` : '(dry run, no plan written)'}`);
  return EXIT.OK;
}

if (isMain(import.meta.url)) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(`recard: ${e.message}`); process.exit(EXIT.ERROR); });
}
