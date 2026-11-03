#!/usr/bin/env node
// Remove: move claims that are no longer wanted, and their Tag decisions rows, to Notion's trash (decision P51), and bring them back if that was a mistake.
//
//   node agents/claim-tagger-mvp/scripts/remove.mjs plan --keep <selection file> [--keep-waiting] [--run-id <id>]
//   node agents/claim-tagger-mvp/scripts/remove.mjs apply --plan <plan.jsonl, or the run folder or run id of the plan> [--run-id <id>] [--verbose]
//   node agents/claim-tagger-mvp/scripts/remove.mjs restore --run <run id of the plan> [--run-id <id>] [--verbose]
//
//   plan      Reads only (a fresh pull of every table; it sends queries and nothing else). --keep is a selection file (schemas/import-selection.schema.json, the file add.mjs --claims-file
//             takes); a file that does not fit the schema, or lists a Geo ID twice, is exit 2 before anything is read. A Claims row is listed for the trash when
//               - its Geo ID is NOT in the selection, and
//               - none of its Tag decisions rows has an editor value (Tag outcome set, Your note not blank, or Agent is right ticked), and
//               - no Rule changes row cites it in Supporting rows (the "<Geo ID>::<tag>" at the end of a line),
//               - and, with --keep-waiting, none of its Tag decisions rows still waits for an editor (Agent status is "Waits for you"; the owner's rule of 3 Nov, P51),
//             and so is every Tag decisions row whose Key starts with the Geo ID of a listed claim. A kept claim's rows are never listed. The demo rows (Geo IDs that start with de0000) and any row
//             without a Geo ID are never listed. The plan (script "remove", one "trash" op per row, the Tag decisions rows first and the Claims rows after them) goes to runs/<run-id>/plan.jsonl,
//             next to a snapshot (snapshot-claims.jsonl, snapshot-tag_decisions.jsonl: the full page JSON of every row listed, one per line) and summary.json (the counts and the claims kept, with
//             the reasons). It prints how many Claims rows and Tag decisions rows would go, how many claims are kept and why (selected, decided, cited, and with --keep-waiting waiting), and how many Claims rows remain. A
//             selection of which no claim is in Claims is refused (exit 2): add the claims first.
//   apply     Takes a fresh pull, checks the plan against it (a row that was decided, cited or changed since the plan was made, or a Claims row with a Tag decisions row the plan does not list, stops
//             the run with exit 2 before anything is sent: make a new plan), then trashes the rows with lib/plan.mjs applyPlan: the ledger of the plan's own run folder records every step, every
//             page is read back (it must say it is in the trash), a step that is done is never sent again, and the same command run again continues where a stopped run left off. A Tag decisions
//             row that a person decided while the plan ran is not trashed and ends the run (exit 2). When every row reads back as trashed, setup/removed-claims.json is written (the Geo IDs of the
//             Claims rows, with the run and the date, merged with what the file holds), so that copy-live.mjs does not bring the claims back and `setup.mjs verify` expects them absent. Exit 0 only when
//             every row reads back as trashed. A plan that was restored is refused.
//   restore   Takes the rows of that run out of the trash again (Claims rows first, then Tag decisions rows), each read back, and takes their Geo IDs out of setup/removed-claims.json. It works
//             from the run's snapshot: a row that is not in the trash is left as it is. Notion keeps trashed pages for a limited time (about 30 days on most plans); after that the snapshot is the only copy.
//
// Production only: a practice page, a config that is not the v2 profile and a root whose tables are the first page's are refused (exit 2). The pause and drift checks of every loop script run first (exit 3, 4).
// remove.mjs asks for permission every time it is typed (.claude/settings.json).
//
// A long run: Notion allows about 3 requests a second, and the client keeps to that. A row costs two requests (a Tag decisions row three: one to look at it first), so about 1,050 rows take
// about 15 minutes. The apply stops after 3 failed rows in a row (and at once on a 401 or 403, or on a refusal); run it again to continue.
//
// Exit codes: 0 ok, 1 Notion could not be read or a write did not finish (run the same command again), 2 invalid (a selection that is not valid or matches nothing, a plan the check refuses or that is out of
// date, a row that does not read back as trashed, a root that is not the v2 page), 3 paused, 4 drift or a changed rulebook file.
//
// Exports: main, remove, USAGE, planRemoval, staleProblems, hasEditorValue.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readSelection } from './add.mjs';
import { AGENT_STATUS, REMOVE_SCRIPT, TABLES, TD, isV2, tableEntry } from './lib/config.mjs';
import { plural } from './lib/editor-words.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { hasEditorValue } from './lib/decisions.mjs';
import { keyGeoId } from './lib/first-page.mjs';
import { appendJsonl, readJson, readJsonl, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import {
  LoopExit, needClaimColumns, needTables, notionClient, parseCli, resumeLine, runPreflight, takePull, withRun,
} from './lib/loop.mjs';
import { isInTrash } from './lib/notion-rest.mjs';
import { normId } from './lib/notion-values.mjs';
import { isMain } from './lib/paths.mjs';
import { MAX_CONSECUTIVE_FAILURES, PlanError, applyPlan, checkPlan, firstPageIds, newPlan, readPlan } from './lib/plan.mjs';
import { renderReport } from './lib/report.mjs';
import { RemovedError, addRemoved, dropRemoved, geoKey } from './lib/removed.mjs';

export const USAGE = [
  'usage: node agents/claim-tagger-mvp/scripts/remove.mjs plan --keep <selection file> [--keep-waiting] [--run-id <id>]',
  '       node agents/claim-tagger-mvp/scripts/remove.mjs apply --plan <plan.jsonl, or the run folder or run id of the plan> [--run-id <id>] [--verbose]',
  '       node agents/claim-tagger-mvp/scripts/remove.mjs restore --run <run id of the plan> [--run-id <id>] [--verbose]',
].join('\n');

const ENGINEER = 'Next: ask the engineer to look at the message the script printed.';
const ID_RE = /^[A-Za-z0-9._-]+$/;
const DEMO_PREFIX = 'de0000'; // the demo rows' Geo IDs
const TRASH_TABLES = Object.freeze(['claims', 'tag_decisions']);
const SNAPSHOT = Object.freeze({ claims: 'snapshot-claims.jsonl', tag_decisions: 'snapshot-tag_decisions.jsonl' });
const TABLE_WORDS = Object.freeze({ claims: 'Claims', tag_decisions: 'Tag decisions' });
const SHOWN = 3; // rows named in a message

const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const byCodePoints = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const keyOf = (table, key) => `${table}\u0000${key}`;

// ---- the rules (pure) -----------------------------------------------------------------------------------------------------------------

/** True when a row of Tag decisions (as pull.mjs norm/queue.jsonl holds it) still waits for an editor: its Agent status is "Waits for you" (STRUCTURE-V2.md). */
export const isWaiting = (row) => text(row?.[TD.status]).trim() === AGENT_STATUS.waits;

/** The Geo IDs (geoKey form) of the claims that have a Tag decisions row waiting for an editor. */
function waitingClaims(queue) {
  const out = new Set();
  for (const row of queue) {
    const geoId = keyGeoId(row?.Key);
    if (geoId !== null && isWaiting(row)) out.add(geoKey(geoId));
  }
  return out;
}

export { hasEditorValue }; // lib/decisions.mjs is the one file that reads the three editor columns (tests/mvp/editor-columns.test.mjs)

/**
 * What the plan lists, from the rows of a pull. `claims` are the rows of norm/claims.jsonl (geo_id, page_id), `queue` those of norm/queue.jsonl (Key, page_id, the editor columns), `lessons` those
 * of norm/lessons.jsonl (supporting_keys), `selected` a Set of the Geo IDs of the selection (geoKey form). `keepWaiting` (the --keep-waiting flag) also keeps every claim that has a Tag decisions
 * row still waiting for an editor (Agent status is "Waits for you"). Returns
 *   { trashClaims, trashRows, kept: { selected, decided, cited, waiting, demo }, reasons: Map(geo key -> [reasons]), waitingTrashed }
 * where a kept claim counts under its first reason in the order selected, decided, cited, waiting (demo claims are kept apart), and waitingTrashed is how many listed claims have a waiting row (always 0
 * with keepWaiting). A Tag decisions row is listed only when the claim of its Key is listed.
 */
export function planRemoval({ claims = [], queue = [], lessons = [], selected = new Set(), keepWaiting = false } = {}) {
  const decided = new Set();
  for (const row of queue) {
    const geoId = keyGeoId(row?.Key);
    if (geoId !== null && hasEditorValue(row)) decided.add(geoKey(geoId));
  }
  const cited = new Set();
  for (const lesson of lessons) {
    for (const key of lesson?.supporting_keys ?? []) {
      const geoId = keyGeoId(key);
      if (geoId !== null) cited.add(geoKey(geoId));
    }
  }
  const waiting = waitingClaims(queue);
  const kept = { selected: [], decided: [], cited: [], waiting: [], demo: [] };
  const reasons = new Map();
  const trashClaims = [];
  for (const claim of claims) {
    const id = geoKey(claim?.geo_id);
    if (id === '' || !text(claim?.page_id)) continue; // no Geo ID or no page: never listed
    if (id.startsWith(DEMO_PREFIX)) {
      kept.demo.push(claim);
      reasons.set(id, ['demo']);
      continue;
    }
    const why = [selected.has(id) ? 'selected' : null, decided.has(id) ? 'decided' : null, cited.has(id) ? 'cited' : null, keepWaiting && waiting.has(id) ? 'waiting' : null].filter(Boolean);
    if (why.length === 0) {
      trashClaims.push(claim);
      continue;
    }
    kept[why[0]].push(claim);
    reasons.set(id, why);
  }
  const listed = new Set(trashClaims.map((c) => geoKey(c.geo_id)));
  const waitingTrashed = trashClaims.filter((c) => waiting.has(geoKey(c.geo_id))).length;
  const trashRows = queue.filter((row) => {
    const geoId = keyGeoId(row?.Key);
    return geoId !== null && text(row?.page_id) !== '' && listed.has(geoKey(geoId));
  });
  // a listed claim has no decided row (it would have been kept), so no listed row can hold an editor value; if one does, the rules above were broken and nothing is planned
  const wrong = trashRows.find(hasEditorValue);
  if (wrong) throw new Error(`internal error: the row ${wrong.Key} has an editor value and was listed for the trash`);
  return { trashClaims, trashRows, kept, reasons, waitingTrashed };
}

/**
 * Why a plan is out of date against a fresh pull: sentences, [] when it still holds. For every trash op not yet done (`done`: Set of keyOf(table, key)) whose row is in the pull: the row must
 * still be the page of the plan; a Tag decisions row must still have no editor value; a Claims row must still be undecided, not cited, not a demo row and have no Tag decisions row that the
 * plan does not list. With keepWaiting (the plan was made with --keep-waiting) a row or a claim that waits for an editor now is out of date too. A row that is not in the pull any more is not checked
 * here (applyPlan looks at it before it sends anything).
 */
export function staleProblems({ ops, done = new Set(), claims = [], queue = [], lessons = [], keepWaiting = false }) {
  const problems = [];
  const claimByKey = new Map(claims.map((c) => [text(c.geo_id).trim(), c]));
  const rowByKey = new Map(queue.map((r) => [text(r.Key).trim(), r]));
  const planned = new Set(ops.filter((o) => o.op === 'trash' && o.table === 'tag_decisions').map((o) => o.key));
  const decided = new Set();
  for (const row of queue) {
    const geoId = keyGeoId(row.Key);
    if (geoId !== null && hasEditorValue(row)) decided.add(geoKey(geoId));
  }
  const cited = new Set(lessons.flatMap((l) => l.supporting_keys ?? []).map((k) => keyGeoId(k)).filter((g) => g !== null).map(geoKey));
  const waiting = keepWaiting ? waitingClaims(queue) : new Set();
  const rowsOfClaim = new Map();
  for (const row of queue) {
    const geoId = keyGeoId(row.Key);
    if (geoId !== null) rowsOfClaim.set(geoKey(geoId), [...(rowsOfClaim.get(geoKey(geoId)) ?? []), row]);
  }
  for (const op of ops) {
    if (op.op !== 'trash' || done.has(keyOf(op.table, op.key))) continue;
    const row = op.table === 'claims' ? claimByKey.get(op.key) : rowByKey.get(op.key);
    if (!row) continue;
    const name = `${TABLE_WORDS[op.table]} "${op.key}"`;
    if (normId(row.page_id) !== normId(op.page_id)) {
      problems.push(`${name} is another page now than the one in the plan`);
      continue;
    }
    if (op.table === 'tag_decisions') {
      if (hasEditorValue(row)) problems.push(`${name} has been decided since the plan was made`);
      if (keepWaiting && isWaiting(row)) problems.push(`${name} waits for an editor now`);
      continue;
    }
    const id = geoKey(op.key);
    if (id.startsWith(DEMO_PREFIX)) problems.push(`${name} is a demo row`);
    if (decided.has(id)) problems.push(`${name} has a Tag decisions row that has been decided since the plan was made`);
    if (cited.has(id)) problems.push(`${name} is cited by a rule change`);
    if (waiting.has(id)) problems.push(`${name} has a Tag decisions row that waits for an editor now`);
    const extra = (rowsOfClaim.get(id) ?? []).filter((r) => !planned.has(text(r.Key).trim()));
    if (extra.length) problems.push(`${name} has ${plural(extra.length, 'Tag decisions row')} that the plan does not list (${extra.slice(0, SHOWN).map((r) => r.Key).join(', ')})`);
  }
  return problems;
}

// ---- the frame ------------------------------------------------------------------------------------------------------------------------

/** Production v2 page only: not a practice page, the v2 profile, and none of the five tables is a table of the first page (setup/first-page.json). */
function needV2Root(ctx) {
  const stop = (message, sentence) => new LoopExit(EXIT.INVALID, message, { sentence: `${ctx.label}: nothing was done, because ${sentence}.`, next: ENGINEER });
  if (ctx.demo) throw stop('remove works on the real tables, not on a practice page', 'it works only on the real tables of the v2 page');
  if (!isV2(ctx.config)) throw stop('config.json is not the v2 profile', 'this folder is not set up for the v2 page');
  let first;
  try {
    first = firstPageIds(ctx.root);
  } catch (e) {
    throw stop(e.message, 'the ids of the first page could not be read');
  }
  const overlap = TABLES.flatMap((t) => {
    const e = tableEntry(ctx.config, t);
    return [e.database_id, e.data_source_id];
  }).map((id) => normId(id)).filter((id) => first.has(id));
  if (overlap.length) throw stop(`${overlap.length} table id(s) of config.json (starting ${[...new Set(overlap)].slice(0, 3).map((i) => i.slice(0, 8)).join(', ')}) belong to the first page (setup/first-page.json)`, 'the tables of this folder are the first page\'s, which are never written');
}

const report = ({ sentence, header = ['What', 'Result', ''], rows = [], next }) => ({ sentence, header, rows, next });

/** The report the editor reads, and the lines under it that only the engineer needs (ids, paths, the next command). */
function printed(r, lines = []) {
  const markdown = renderReport({ demo: false, sentence: r.sentence, header: r.header, rows: r.rows, next: r.next });
  return lines.length ? `${markdown.trimEnd()}\n\n${lines.join('\n')}` : markdown.trimEnd();
}

function writeSnapshot(ctx, table, pageIds) {
  const wanted = new Set(pageIds.map(normId));
  const pages = ctx.pull.pages(table).filter((p) => wanted.has(normId(p.id)));
  const file = join(ctx.runDir, SNAPSHOT[table]);
  writeTextAtomic(file, pages.map((p) => JSON.stringify(p)).join('\n') + (pages.length ? '\n' : ''));
  if (pages.length !== wanted.size) throw new LoopExit(EXIT.ERROR, `the snapshot of ${TABLE_WORDS[table]} holds ${pages.length} page(s) for ${wanted.size} row(s) to trash`, { sentence: 'Remove: nothing was planned, because the snapshot of the rows could not be made whole.', next: ENGINEER });
  return file;
}

// ---- plan -----------------------------------------------------------------------------------------------------------------------------

async function planBody(ctx, keepFile, keepWaiting) {
  needV2Root(ctx);
  const read = readSelection(resolve(keepFile), ctx.root);
  if (read.problem) {
    throw new LoopExit(EXIT.INVALID, read.problem.message, { sentence: 'Remove: nothing was read or planned, because the selection file is not valid.', next: 'Next: correct the selection file and run it again.' });
  }
  const selected = new Set(read.items.map((i) => geoKey(i.id)));

  await takePull(ctx, { pullId: null }); // always fresh
  needTables(ctx, 'claims', 'tag_decisions', 'rule_changes');
  runPreflight(ctx);
  needClaimColumns(ctx);

  const claims = ctx.pull.claims() ?? [];
  const queue = ctx.pull.queue() ?? [];
  const lessons = ctx.pull.lessons() ?? [];
  const inClaims = claims.filter((c) => selected.has(geoKey(c.geo_id))).length;
  if (inClaims === 0) {
    throw new LoopExit(EXIT.INVALID, `none of the ${selected.size} claims of the selection is in Claims, so the selection cannot tell what to keep`, {
      sentence: 'Remove: nothing was planned, because none of the selected claims is in Claims yet.',
      next: 'Next: add the selected claims to Claims first, then plan the removal.',
    });
  }

  let found;
  try {
    found = planRemoval({ claims, queue, lessons, selected, keepWaiting });
  } catch (e) {
    throw new LoopExit(EXIT.ERROR, e.message, { sentence: 'Remove: nothing was planned, because the rules found a row that must not be listed.', next: ENGINEER });
  }
  const { trashClaims, trashRows, kept } = found;
  const remaining = claims.length - trashClaims.length;
  const keptCount = kept.selected.length + kept.decided.length + kept.cited.length + kept.waiting.length;
  const notAdded = selected.size - inClaims;

  const summary = {
    run_id: ctx.runId,
    keep_file: resolve(keepFile),
    keep_waiting: keepWaiting,
    selection: { claims: selected.size, in_claims: inClaims, not_in_claims: notAdded },
    claims_before: claims.length,
    trash: { claims: trashClaims.length, tag_decisions: trashRows.length, claims_with_a_waiting_row: found.waitingTrashed },
    kept: { selected: kept.selected.length, decided: kept.decided.length, cited: kept.cited.length, waiting: kept.waiting.length, demo: kept.demo.length },
    claims_after: remaining,
    kept_claims: [...found.reasons].map(([geo_id, why]) => ({ geo_id, reasons: why })).sort((a, b) => byCodePoints(a.geo_id, b.geo_id)),
  };
  ctx.record.remove = { command: 'plan', ...summary, kept_claims: undefined };
  const countsOut = { claims_to_trash: trashClaims.length, tag_decisions_to_trash: trashRows.length, claims_remaining: remaining };

  if (trashClaims.length === 0) {
    const nothingToRemove = `Remove: nothing to remove; every claim in Claims is selected, decided, cited${keepWaiting ? ', waiting for an editor' : ''} or a demo row.`;
    writeJsonAtomic(join(ctx.runDir, 'summary.json'), summary);
    return {
      exit: EXIT.OK,
      sentence: nothingToRemove,
      next: 'Next: nothing to do.',
      counts: countsOut,
      print: printed(report({ sentence: nothingToRemove, next: 'Next: nothing to do.' }), [`summary: ${join(ctx.runDir, 'summary.json')}`]),
    };
  }

  const plan = newPlan({ runId: ctx.runId, script: REMOVE_SCRIPT, rubricEdition: ctx.edition, config: ctx.config, now: ctx.now });
  const orderedRows = [...trashRows].sort((a, b) => byCodePoints(text(a.Key), text(b.Key)));
  const orderedClaims = [...trashClaims].sort((a, b) => byCodePoints(text(a.geo_id), text(b.geo_id)));
  for (const row of orderedRows) plan.trash('tag_decisions', text(row.Key).trim(), row.page_id); // the rows first, so a claim is never trashed while a row of it stays
  for (const claim of orderedClaims) plan.trash('claims', text(claim.geo_id).trim(), claim.page_id);
  const checked = checkPlan(plan, ctx.config, { root: ctx.root });
  if (!checked.ok) {
    ctx.record.plan_problems = checked.problems.slice(0, 10);
    throw new LoopExit(EXIT.INVALID, `the plan was refused and nothing was written: ${checked.problems.slice(0, 5).join('; ')}`, { sentence: 'Remove: nothing was planned, because the plan breaks a rule about what may be trashed.', next: ENGINEER });
  }
  const planFile = plan.write(ctx.runDir);
  const files = [writeSnapshot(ctx, 'tag_decisions', orderedRows.map((r) => r.page_id)), writeSnapshot(ctx, 'claims', orderedClaims.map((c) => c.page_id))];
  writeJsonAtomic(join(ctx.runDir, 'summary.json'), summary);
  ctx.record.plan = { creates: 0, updates: 0, trashes: plan.ops.length };

  const sentence = `Remove: ${plural(trashClaims.length, 'Claims row')} and ${plural(trashRows.length, 'Tag decisions row')} would go to the trash; ${plural(keptCount, 'claim')} stay${keptCount === 1 ? 's' : ''} for a reason, and ${remaining} Claims rows remain.`;
  // at most five rows in a report: the two counts of the trash share a row, and the row of the claims kept for waiting is there only with --keep-waiting
  const rows = [
    ['To trash', `${plural(trashClaims.length, 'Claims row')}, ${plural(trashRows.length, 'Tag decisions row')}`, ''],
    ['Claims kept: in the selection', String(kept.selected.length), ''],
    ['Claims kept: decided by an editor', String(kept.decided.length), ''],
    ['Claims kept: cited by a rule change', String(kept.cited.length), ''],
    ...(keepWaiting ? [['Claims kept: waiting for an editor', String(kept.waiting.length), '']] : []),
  ];
  const lines = [
    `plan: ${planFile}`,
    `snapshot: ${files.join(' , ')}`,
    `summary: ${join(ctx.runDir, 'summary.json')}`,
    `selection: ${selected.size} claims, ${inClaims} in Claims${notAdded > 0 ? `, ${notAdded} NOT in Claims (add.mjs did not add them)` : ''}; demo rows kept: ${kept.demo.length}; Claims rows now: ${claims.length}`,
    ...(keepWaiting ? [] : [`${found.waitingTrashed} of the ${trashClaims.length} claims to trash have a Tag decisions row that waits for an editor (Agent status "Waits for you"); plan again with --keep-waiting to keep them`]),
    `to apply: ${resumeLine('remove', ['apply', '--plan', planFile])}`,
  ];
  return {
    exit: EXIT.OK,
    sentence,
    header: ['What', 'Result', ''],
    rows,
    next: 'Next: check the counts, then apply the plan.',
    counts: countsOut,
    print: printed(report({ sentence, rows, next: 'Next: check the counts, then apply the plan.' }), lines),
    details: { planFile, planDir: ctx.runDir, summary },
  };
}

// ---- apply ----------------------------------------------------------------------------------------------------------------------------

/** The folder of a plan: runs/<run id>/ from a plan.jsonl, a folder that holds one, or a bare run id. */
function planDirOf(ctx, arg) {
  const asked = resolve(String(arg));
  let dir = null;
  if (existsSync(asked)) dir = asked.toLowerCase().endsWith('.jsonl') ? dirname(asked) : asked;
  else if (ID_RE.test(String(arg))) dir = join(ctx.root, 'runs', String(arg));
  if (!dir || !existsSync(join(dir, 'plan.jsonl'))) {
    throw new LoopExit(EXIT.INVALID, `there is no plan at ${arg}`, { sentence: 'Remove: nothing was done, because that plan does not exist.', next: 'Next: give the plan.jsonl of a remove plan, or its run folder.' });
  }
  return dir;
}

function readRemovePlan(ctx, dir) {
  let plan;
  try {
    plan = readPlan(dir);
  } catch (e) {
    if (e instanceof PlanError) throw new LoopExit(EXIT.INVALID, `${e.message}${e.problems?.length ? `: ${e.problems.slice(0, 5).join('; ')}` : ''}`, { sentence: 'Remove: nothing was done, because the plan cannot be read.', next: ENGINEER });
    throw e;
  }
  if (plan.header?.plan?.script !== REMOVE_SCRIPT) {
    throw new LoopExit(EXIT.INVALID, `the plan in ${dir} was not made by remove.mjs (its script is ${plan.header?.plan?.script ?? 'missing'})`, { sentence: 'Remove: nothing was done, because that plan was not made by the remove command.', next: ENGINEER });
  }
  if (plan.ops.some((o) => o.op !== 'trash')) {
    throw new LoopExit(EXIT.INVALID, `the plan in ${dir} holds an op that is not a trash`, { sentence: 'Remove: nothing was done, because the plan holds more than trashes.', next: ENGINEER });
  }
  const checked = checkPlan(plan, ctx.config, { root: ctx.root });
  if (!checked.ok) {
    ctx.record.plan_problems = checked.problems.slice(0, 10);
    throw new LoopExit(EXIT.INVALID, `the plan was refused and nothing was sent: ${checked.problems.slice(0, 5).join('; ')}`, { sentence: 'Remove: nothing was done, because the plan breaks a rule about what may be trashed.', next: ENGINEER });
  }
  return plan;
}

const ledgerDone = (dir, ops) => {
  const done = new Set();
  const lines = readJsonl(join(dir, 'ledger.jsonl')).rows;
  const last = new Map();
  for (const row of lines) if (Number.isInteger(row?.op_index)) last.set(row.op_index, row);
  for (const [i, line] of last) if (ops[i] && line.status === 'done' && line.read_back === 'ok') done.add(keyOf(ops[i].table, ops[i].key));
  return done;
};

async function applyBody(ctx, planArg, verbose) {
  const dir = planDirOf(ctx, planArg);
  if (existsSync(join(dir, 'restored.json'))) {
    throw new LoopExit(EXIT.INVALID, `the plan in ${dir} was restored (restored.json); its ledger no longer describes Notion`, { sentence: 'Remove: nothing was done, because that plan was restored.', next: 'Next: make a new plan.' });
  }
  const plan = readRemovePlan(ctx, dir);
  const planRunId = plan.header.plan.run_id;
  needV2Root(ctx);

  await takePull(ctx, { pullId: null }); // always fresh
  needTables(ctx, 'claims', 'tag_decisions', 'rule_changes');
  runPreflight(ctx);
  needClaimColumns(ctx);

  // is the plan still true? (nothing is sent when it is not). The summary next to the plan says whether it was made with --keep-waiting
  let keepWaiting = false;
  if (existsSync(join(dir, 'summary.json'))) {
    try {
      keepWaiting = readJson(join(dir, 'summary.json')).keep_waiting === true;
    } catch (e) {
      throw new LoopExit(EXIT.INVALID, `summary.json next to the plan cannot be read: ${e.message}`, { sentence: 'Remove: nothing was done, because the summary next to the plan cannot be read.', next: ENGINEER });
    }
  }
  const stale = staleProblems({ ops: plan.ops, done: ledgerDone(dir, plan.ops), claims: ctx.pull.claims() ?? [], queue: ctx.pull.queue() ?? [], lessons: ctx.pull.lessons() ?? [], keepWaiting });
  if (stale.length) {
    ctx.record.stale = stale.slice(0, 20);
    throw new LoopExit(EXIT.INVALID, `the plan is out of date: ${stale.length} problem(s): ${stale.slice(0, 5).join('; ')}`, {
      sentence: `Remove: nothing was removed, because ${plural(stale.length, 'row')} changed since the plan was made.`,
      next: 'Next: make a new plan.',
    });
  }

  const client = notionClient(ctx);
  const tables = TRASH_TABLES.filter((t) => plan.ops.some((o) => o.table === t));
  let result;
  try {
    result = await applyPlan({
      plan,
      dir,
      client,
      config: ctx.config,
      schemas: Object.fromEntries(tables.map((t) => [t, ctx.pull.schema(t)])),
      pulled: ctx.pull.pulled(tables),
      root: ctx.root,
      now: ctx.now,
      log: verbose ? (line) => ctx.io.err(`${ctx.script}: ${line}`) : null,
    });
  } catch (e) {
    if (e?.name === 'PlanError') {
      throw new LoopExit(EXIT.INVALID, `${e.message}${e.problems?.length ? `: ${e.problems.slice(0, 5).join('; ')}` : ''}`, { sentence: 'Remove: nothing was removed, because the plan cannot be sent as it stands.', next: ENGINEER });
    }
    throw e;
  }
  ctx.record.apply = { done: result.done, failed: result.failed, skipped: result.skipped, mismatches: result.mismatches, uncertain: result.uncertain, unchecked: result.unchecked, pending: result.pending, stopped: result.stopped };

  // the Claims rows that are in the trash and read back are recorded, also after a stop, so that a re-sync of the copy cannot bring them back
  const trashedClaims = Object.keys(result.trashed_by_table.claims ?? {});
  const trashedRows = Object.keys(result.trashed_by_table.tag_decisions ?? {});
  let recorded = 0;
  if (trashedClaims.length) {
    try {
      const date = ctx.now().toISOString().slice(0, 10);
      addRemoved(ctx.root, trashedClaims.map((geo_id) => ({ geo_id, run_id: planRunId, date })));
      recorded = trashedClaims.length;
    } catch (e) {
      throw new LoopExit(EXIT.ERROR, `${trashedClaims.length} Claims rows are in the trash, but setup/removed-claims.json could not be written: ${e.message}`, {
        sentence: 'Remove: rows were trashed, but the list of removed claims could not be written.',
        next: 'Next: ask the engineer to fix the list, then run the same apply command again; it writes the list and sends nothing again.',
      });
    }
  }
  const wanted = { claims: plan.ops.filter((o) => o.table === 'claims').length, tag_decisions: plan.ops.filter((o) => o.table === 'tag_decisions').length };

  if (result.stopped?.reason === 'person_set') {
    throw new LoopExit(EXIT.INVALID, `a person decided the row ${result.stopped.key} while the plan ran; it was not trashed and the run stopped`, {
      sentence: `Remove: stopped, because a Tag decisions row was decided while the plan ran; ${trashedRows.length + trashedClaims.length} rows are in the trash.`,
      next: 'Next: make a new plan.',
    });
  }
  if (result.stopped?.reason === 'refused') {
    const refusal = result.lists.failed.find((f) => f.key === result.stopped.key);
    throw new LoopExit(EXIT.INVALID, `${result.stopped.key}: ${refusal?.detail ?? 'refused'}`, { sentence: 'Remove: stopped, because a row in the plan is not what the pull holds.', next: 'Next: make a new plan.' });
  }
  if (result.mismatches > 0) {
    throw new LoopExit(EXIT.INVALID, `the read-back differs for ${result.mismatches} row(s): ${result.lists.mismatches.slice(0, SHOWN).map((m) => `${m.table} "${m.key}" ${m.detail ?? ''}`).join('; ')}`, {
      sentence: `Remove stopped: Notion does not show ${result.mismatches === 1 ? 'one row' : `${result.mismatches} rows`} as trashed after ${result.mismatches === 1 ? 'it was' : 'they were'} sent.`,
      next: ENGINEER,
    });
  }
  if (result.code !== EXIT.OK) {
    const left = result.failed + result.uncertain + result.unchecked + result.pending + result.skipped;
    throw new LoopExit(EXIT.ERROR, `${left} row(s) are not done: ${[...result.lists.failed, ...result.lists.unchecked].slice(0, SHOWN).map((m) => `${m.table} "${m.key}" ${m.detail ?? ''}`).join('; ') || 'not reached'}`, {
      sentence: `Remove stopped before every row was trashed: ${plural(trashedClaims.length, 'Claims row')} and ${plural(trashedRows.length, 'Tag decisions row')} are in the trash so far.`,
      next: 'Next: run the same apply command again; it continues where it stopped.',
    });
  }

  const sentence = `Remove: ${plural(trashedClaims.length, 'Claims row')} and ${plural(trashedRows.length, 'Tag decisions row')} are in the trash, and every row was read back.`;
  const rows = [
    ['Claims rows in the trash', String(trashedClaims.length), ''],
    ['Tag decisions rows in the trash', String(trashedRows.length), ''],
    ['Claims recorded as removed', String(recorded), ''],
  ];
  const next = 'Next: pull again to check the tables; while the rows are in the trash they can be brought back.';
  return {
    exit: EXIT.OK,
    sentence,
    header: ['What', 'Result', ''],
    rows,
    next,
    counts: { claims_trashed: trashedClaims.length, tag_decisions_trashed: trashedRows.length, planned: wanted },
    print: printed(report({ sentence, rows, next }), [
      `plan: ${join(dir, 'plan.jsonl')}`,
      `ledger: ${result.ledger}`,
      `removed list: setup/removed-claims.json (${recorded} Geo IDs written, run ${planRunId})`,
      `to bring the rows back: ${resumeLine('remove', ['restore', '--run', planRunId])} (Notion keeps trashed pages for a limited time, about 30 days on most plans; after that the snapshot in ${dir} is the only copy)`,
    ]),
  };
}

// ---- restore --------------------------------------------------------------------------------------------------------------------------

async function restoreBody(ctx, runArg, verbose) {
  if (!ID_RE.test(String(runArg))) {
    throw new LoopExit(EXIT.INVALID, `--run may only use letters, digits, '.', '_' and '-', got "${runArg}"`, { sentence: 'Remove: nothing was done, because the run name is not valid.', next: 'Next: give the run id of the plan.' });
  }
  const dir = join(ctx.root, 'runs', String(runArg));
  if (!existsSync(join(dir, 'plan.jsonl'))) {
    throw new LoopExit(EXIT.INVALID, `there is no plan in ${dir}`, { sentence: 'Remove: nothing was done, because there is no remove plan under that run.', next: 'Next: give the run id of the plan.' });
  }
  const plan = readRemovePlan(ctx, dir);
  const planRunId = plan.header.plan.run_id;
  const snapshots = {};
  for (const table of TRASH_TABLES) {
    const file = join(dir, SNAPSHOT[table]);
    if (!plan.ops.some((o) => o.table === table)) {
      snapshots[table] = new Set();
      continue;
    }
    if (!existsSync(file)) {
      throw new LoopExit(EXIT.INVALID, `the snapshot ${file} is missing`, { sentence: 'Remove: nothing was done, because the snapshot of that run is missing.', next: ENGINEER });
    }
    snapshots[table] = new Set(readJsonl(file).rows.map((p) => normId(p?.id)).filter(Boolean));
  }
  needV2Root(ctx);
  await takePull(ctx, { pullId: null });
  needTables(ctx, 'claims', 'tag_decisions');
  runPreflight(ctx);

  // the snapshot is the proof of what the run listed: a row of the plan that is not in it is not touched
  const targets = [];
  for (const table of TRASH_TABLES) for (const op of plan.ops) if (op.table === table && snapshots[table].has(normId(op.page_id))) targets.push(op); // Claims first, then Tag decisions
  const client = notionClient(ctx);
  if (typeof client.untrashPage !== 'function') throw new LoopExit(EXIT.INVALID, 'the Notion client cannot untrash a page', { sentence: 'Remove: nothing was done, because the Notion client cannot restore a page.', next: ENGINEER });
  const ledger = join(ctx.runDir, 'restore-ledger.jsonl');
  const restoredClaims = [];
  const live = { claims: 0, tag_decisions: 0 };
  const back = { claims: 0, tag_decisions: 0 };
  let consecutive = 0;
  let stopped = null;
  const note = (op, status, error = null) => {
    appendJsonl(ledger, { table: op.table, key: op.key, page_id: op.page_id, status, error, at: ctx.now().toISOString() });
    if (verbose) ctx.io.err(`${ctx.script}: restore ${op.table} "${op.key}": ${status}${error ? ` - ${error}` : ''}`);
  };
  for (const op of targets) {
    if (stopped) break;
    try {
      const now = await client.retrievePage(op.page_id);
      if (!isInTrash(now)) {
        live[op.table] += 1;
        if (op.table === 'claims') restoredClaims.push(op.key);
        note(op, 'already live');
        consecutive = 0;
        continue;
      }
      await client.untrashPage(op.page_id);
      const after = await client.retrievePage(op.page_id);
      if (isInTrash(after)) {
        consecutive += 1;
        note(op, 'mismatch', 'the page still says it is in the trash');
        if (consecutive >= MAX_CONSECUTIVE_FAILURES) stopped = 'failures_in_a_row';
        continue;
      }
      back[op.table] += 1;
      if (op.table === 'claims') restoredClaims.push(op.key);
      note(op, 'restored');
      consecutive = 0;
    } catch (e) {
      consecutive += 1;
      note(op, 'failed', String(e?.message ?? e).slice(0, 300));
      if (e?.status === 401 || e?.status === 403) stopped = 'notion_refused';
      else if (consecutive >= MAX_CONSECUTIVE_FAILURES) stopped = 'failures_in_a_row';
    }
  }
  const lines = readJsonl(ledger).rows;
  const failed = new Set(lines.filter((l) => l.status === 'failed' || l.status === 'mismatch').map((l) => keyOf(l.table, l.key)));
  const okKeys = new Set(lines.filter((l) => l.status === 'restored' || l.status === 'already live').map((l) => keyOf(l.table, l.key)));
  const notDone = targets.filter((op) => !okKeys.has(keyOf(op.table, op.key)));
  // the Geo IDs of the claims that are out of the trash leave the list of removed claims, so that the copy and verify treat them as ordinary claims again
  try {
    if (restoredClaims.length) dropRemoved(ctx.root, planRunId, restoredClaims);
  } catch (e) {
    if (e instanceof RemovedError) throw new LoopExit(EXIT.ERROR, e.message, { sentence: 'Remove: rows were restored, but the list of removed claims could not be updated.', next: ENGINEER });
    throw e;
  }
  ctx.record.remove = { command: 'restore', plan_run: planRunId, restored: back, already_live: live, failed: failed.size, stopped };
  if (notDone.length > 0) {
    throw new LoopExit(EXIT.ERROR, `${notDone.length} row(s) are not restored: ${notDone.slice(0, SHOWN).map((o) => `${o.table} "${o.key}"`).join(', ')}${stopped ? ` (stopped: ${stopped})` : ''}`, {
      sentence: `Remove: restore stopped; ${plural(back.claims, 'Claims row')} and ${plural(back.tag_decisions, 'Tag decisions row')} are out of the trash, ${notDone.length} are not.`,
      next: 'Next: run the same restore command again; it continues where it stopped.',
    });
  }
  writeJsonAtomic(join(dir, 'restored.json'), { restored_at: ctx.now().toISOString(), by: ctx.runId, restored: back, already_live: live });
  const sentence = `Remove: ${plural(back.claims, 'Claims row')} and ${plural(back.tag_decisions, 'Tag decisions row')} are out of the trash again, and every row was read back.`;
  const rows = [
    ['Claims rows restored', String(back.claims), ''],
    ['Tag decisions rows restored', String(back.tag_decisions), ''],
    ['Rows that were not in the trash', String(live.claims + live.tag_decisions), ''],
  ];
  const next = 'Next: pull again to check the tables.';
  return {
    exit: EXIT.OK,
    sentence,
    header: ['What', 'Result', ''],
    rows,
    next,
    counts: { claims_restored: back.claims, tag_decisions_restored: back.tag_decisions },
    print: printed(report({ sentence, rows, next }), [`plan: ${join(dir, 'plan.jsonl')}`, `restore ledger: ${ledger}`, 'setup/removed-claims.json no longer lists the restored claims']),
  };
}

// ---- the command ----------------------------------------------------------------------------------------------------------------------

/** Run one command; returns { exit, ... } like the other loop scripts. opts (tests): everything withRun takes (root, config, fetchImpl, token, sleep, now, io, client, runId). */
export async function remove(opts = {}) {
  const { command } = opts;
  const resume = {
    plan: () => resumeLine('remove', ['plan', '--keep', opts.keep ?? '<selection file>', ...(opts.keepWaiting ? ['--keep-waiting'] : [])]),
    apply: () => resumeLine('remove', ['apply', '--plan', opts.plan ?? '<plan.jsonl>']),
    restore: () => resumeLine('remove', ['restore', '--run', opts.run ?? '<run id>']),
  }[command]?.();
  return withRun({ script: 'remove', label: 'Remove', again: resume, opts, args: { command, keep: opts.keep, keep_waiting: opts.keepWaiting === true, plan: opts.plan, run: opts.run }, resume }, async (ctx) => {
    if (command === 'plan') return planBody(ctx, opts.keep, opts.keepWaiting === true);
    if (command === 'apply') return applyBody(ctx, opts.plan, opts.verbose === true);
    if (command === 'restore') return restoreBody(ctx, opts.run, opts.verbose === true);
    throw new LoopExit(EXIT.INVALID, `unknown command ${command}\n${USAGE}`, { sentence: 'Remove: nothing was done, because the command is not known.', next: ENGINEER });
  });
}

const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Parse the command line and run; returns the exit code. deps (tests): everything remove() takes besides the flags. */
export async function main(argv, io = consoleIo, deps = {}) {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    io.out(USAGE);
    return command === undefined ? EXIT.INVALID : EXIT.OK;
  }
  if (!['plan', 'apply', 'restore'].includes(command)) {
    io.err(`remove: unknown command "${command}"\n${USAGE}`);
    return EXIT.INVALID;
  }
  const parsed = parseCli('remove', rest, { keep: { type: 'string' }, 'keep-waiting': { type: 'boolean' }, plan: { type: 'string' }, run: { type: 'string' }, 'run-id': { type: 'string' }, verbose: { type: 'boolean' } }, USAGE, io);
  if (parsed.exit !== undefined) return parsed.exit;
  const v = parsed.values;
  const needs = { plan: ['keep'], apply: ['plan'], restore: ['run'] }[command];
  const wrong = ['keep', 'plan', 'run'].filter((flag) => (needs.includes(flag) ? v[flag] === undefined || String(v[flag]).trim() === '' : v[flag] !== undefined));
  if (wrong.length) {
    io.err(`remove ${command}: ${needs.map((f) => `--${f}`).join(', ')} is required and ${['keep', 'plan', 'run'].filter((f) => !needs.includes(f)).map((f) => `--${f}`).join(', ')} does not belong to this command\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (v['keep-waiting'] && command !== 'plan') {
    io.err(`remove ${command}: --keep-waiting belongs to plan only (an apply reads it from the summary of its plan)
${USAGE}`);
    return EXIT.INVALID;
  }
  try {
    return (await remove({ ...deps, io, command, keep: v.keep, keepWaiting: v['keep-waiting'] === true, plan: v.plan, run: v.run, runId: v['run-id'], verbose: v.verbose === true })).exit;
  } catch (e) {
    io.err(`remove: unexpected error: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
