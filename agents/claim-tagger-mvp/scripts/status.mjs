#!/usr/bin/env node
// Status: what is open, in the three parts of every report. It pulls every table, looks at the pause and the rulebook, and counts; it writes nothing to Notion.
//
//   node agents/claim-tagger-mvp/scripts/status.mjs [--pull <pull-id>] [--json] [--run-id <id>]
//
//   --pull <id>   use that pull instead of pulling every table first
//   --json        print the counts as JSON (for the engineer) instead of the report; the report files are written all the same
//
// The report. "Status: nothing is paused; N rows and M rule changes wait for you." (", more than fit one sitting" when N is above queue.sitting_rows), a table with
// the Rulebook ("<n> tags, edition <e>"; "1 tag, edition <e>" on a practice page), Your queue ("<n> rows, lowest confidence first"; when no undecided claim waits but
// decided ones are still listed there, "<n> rows decided, waiting for the agent's next run"; else "nothing waits"), Lessons waiting and the last run (the Last run
// summary, else "none yet"), and one Next line, the first that applies: read the claims (practice page only) / start at the top of Your queue or decide the rows /
// type distill (at least distill.min_claims decided claims whose Why wrong says the rule is the problem and whose Tag decisions row is not marked Fixed yet, and no rule
// change Proposed or Approved: distill has something to draft) / approve or reject the rule change / check the approved one / read new claims. The Rulebook row does not say that Notion agrees: a drift of the rulebook text on a judged tag is checked before the report and ends the command
// with the drift report (exit 4, naming the tag and the column and telling the editor to ask the engineer to restore the rulebook text); only a difference that does
// not stop the command (a tag without rules edited or added in Notion) or a drift check that could not run is said in the row. A paused agent ends with the refusal
// report (exit 3). On a practice page the sentence starts "Status of the practice page <title>:" (loop.mjs), and while a row that waits has no Agent proposal yet
// (step 1 of the page) the Next line is "type /claim-tagger demo tag" (step 2) instead of "decide the rows": there is nothing to decide before the agent has read the
// claims. In production that line is never used.
//
// The rows that wait are claims of the Claims copy (CLAIMS-REVIEW.md, section 6.2): a claim whose Agent status is "Waits for you" and whose Review status is not Reviewed (what is
// still to decide: Your queue may list a few more, the claims that were decided since the last tag run: queue.decided_listed counts them). Needs your note counts the claims that
// have a Why wrong and no Challenged tags notes. queue.pending_rule_decisions counts the Reviewed claims that distill would still read: a decision (copied to the ledger the way distill copies it) with Why wrong Rule unclear or
// Rule should change on a Tag decisions row whose Follow-up is not Fixed; Fixed means a rule change resting on the row went live and the agent now agrees, while Still wrong stays open
// for the next lesson.
// Your queue is the view of the Claims copy.
//
// Exit codes: 0 ok, 2 invalid, 3 paused, 4 drift or an invalid rulebook file.
//
// Exports: status, countsOf, main, USAGE.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from './lib/exit-codes.mjs';
import { AGENT_STATUS } from './lib/config.mjs';
import { RULE_WHY, claimWaits, isFollowedUp, isReviewed, syncDecisions } from './lib/decisions.mjs';
import { listNames, plural, quoted, tableLink, viewLink, yourClaims } from './lib/editor-words.mjs';
import { LOCK_STALE_MS, LoopExit, needClaimColumns, parseCli, resumeLine, takePull, withRun } from './lib/loop.mjs';
import { isMain } from './lib/paths.mjs';
import { preflight, refusedReport } from './lib/preflight.mjs';
import { readRubric } from './lib/rubric.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/status.mjs [--pull <pull-id>] [--json] [--run-id <id>]';

/**
 * How many Reviewed claims distill would still read: the claims with a decided Tag decisions row (the decisions are copied to the ledger rows the way distill copies them first) whose
 * Why wrong is Rule unclear or Rule should change and whose row is not marked Fixed (Still wrong stays open). A claim with no ledger row, or with only Fixed rows, is not counted.
 */
export function pendingRuleDecisions(claims, queue) {
  const reviewed = new Set(claims.filter((c) => isReviewed(c)).map((c) => c.geo_id));
  const { rows } = syncDecisions(claims, queue);
  const claimsOf = rows
    .filter((r) => r.decided && r.Key && r.Tag && RULE_WHY.has(String(r['Why wrong'] ?? '').trim()) && !isFollowedUp(r))
    .map((r) => String(r.Key).slice(0, String(r.Key).lastIndexOf('::')))
    .filter((geoId) => reviewed.has(geoId));
  return new Set(claimsOf).size;
}

/** The counts the report and --json are made of, from the pull's claims, lessons, ledger rows (queue) and settings. */
export function countsOf({ claims = [], lessons = [], queue = [], settings = null, sitting = 20 }) {
  const open = claims.filter((c) => claimWaits(c)).length;
  const needsNote = claims.filter((c) => c.why_wrong && String(c.challenged_notes ?? '').trim() === '').length;
  // decided since the last tag run: Reviewed, and the agent's status still says "Waits for you", so Your queue still lists the claim (CLAIMS-REVIEW.md, section 6.2)
  const decidedListed = claims.filter((c) => isReviewed(c) && String(c.agent_status ?? '').trim() === AGENT_STATUS.waits).length;
  const byStatus = { Proposed: 0, Approved: 0, Rejected: 0, Live: 0, 'Rolled back': 0 };
  for (const l of lessons) byStatus[l.Status] = (byStatus[l.Status] ?? 0) + 1;
  return {
    queue: {
      open, decided: claims.filter((c) => isReviewed(c)).length, decided_listed: decidedListed, pending_rule_decisions: pendingRuleDecisions(claims, queue), needs_note: needsNote, sitting_rows: sitting, more_than_a_sitting: open > sitting,
    },
    lessons: byStatus,
    waiting_lessons: byStatus.Proposed + byStatus.Approved,
    last_run: settings?.last_run_summary ?? null,
  };
}

/** The safety check that is running now ({ lesson, phase }), from runs/PROMOTING.json when it is younger than two hours; else null. */
function promotingNow(root, now) {
  const file = join(root, 'runs', 'PROMOTING.json');
  if (!existsSync(file)) return null;
  try {
    const held = JSON.parse(readFileSync(file, 'utf8'));
    const born = Number.isFinite(Date.parse(held.since)) ? Date.parse(held.since) : statSync(file).mtimeMs;
    return now().getTime() - born < LOCK_STALE_MS ? { lesson: held.lesson ?? null, phase: held.phase ?? null } : null;
  } catch {
    return null;
  }
}

/** Run status. opts: pull, json, runId and the hooks of the other scripts (root, config, io, now, fetchImpl, token, sleep). */
export async function status(opts = {}) {
  return withRun({
    script: 'status', label: 'Status', again: '/claim-tagger status', opts,
    args: { pull: opts.pull ?? null, json: opts.json === true }, resume: resumeLine('status', []),
  }, async (ctx) => {
    await takePull(ctx);
    const pre = preflight({ root: ctx.root, config: ctx.config, pullId: ctx.pull.id, now: ctx.now, adopt: false });
    ctx.warnings.push(...pre.warnings);
    if (!pre.ok && pre.kind !== 'drift') {
      const report = refusedReport(ctx.config, pre, 'Status');
      throw new LoopExit(pre.code, pre.reason, { sentence: report.sentence, rows: report.rows, next: report.next });
    }
    if (!pre.ok) {
      const what = pre.stops.slice(0, 3).map((s) => [s.tag, s.column].filter(Boolean).join(': ')).join('; ');
      const tags = [...new Set(pre.stops.map((s) => s.tag).filter(Boolean))];
      throw new LoopExit(EXIT.DRIFT, pre.reason, {
        sentence: `Status: nothing is paused, but the rulebook text in Notion no longer matches the saved edition (${what}).`,
        next: `Next: put the rulebook text back on ${listNames(tags)} (${viewLink(ctx.config, 'rulebook')}), or ask the engineer to restore the rulebook text.`,
      });
    }

    needClaimColumns(ctx);
    let rubric = null;
    try {
      rubric = readRubric(ctx.root);
    } catch {
      rubric = null;
    }
    const sitting = ctx.config.queue?.sitting_rows ?? 20;
    const claims = ctx.pull.claims() ?? [];
    const counts = countsOf({ claims, lessons: ctx.pull.lessons() ?? [], queue: ctx.pull.queue() ?? [], settings: ctx.pull.settings(), sitting });
    const minClaims = ctx.config.distill?.min_claims ?? 2; // distill drafts nothing from fewer decided claims
    const n = counts.queue.open;
    const proposed = counts.lessons.Proposed;
    const approved = counts.lessons.Approved;
    const m = counts.waiting_lessons;

    const drift = ctx.pull.drift();
    const edited = [...new Set((drift?.adopted ?? []).map((x) => x.tag))]; // tags without rules that somebody edited: the next command takes the edit over
    const added = drift?.added ?? [];
    const missing = drift?.missing ?? [];
    const differs = [...edited, ...added, ...missing];
    const notionSays = [
      edited.length ? `Notion differs on ${listNames(edited)} (taken over at the next run)` : null,
      added.length ? `Notion has other tag rows: ${listNames(added)}` : null,
      missing.length ? `Notion lacks tag rows: ${listNames(missing)}` : null,
      drift && typeof drift.skipped === 'string' ? 'not compared with Notion' : null,
    ].filter(Boolean).join('; ');
    const rulebook = rubric
      ? `${plural(rubric.tags.length, 'tag')}, edition ${rubric.edition}${notionSays ? `, ${notionSays}` : ''}`
      : 'no edition yet';
    const lessonsCell = m === 0 ? 'none' : [
      proposed ? `${plural(proposed, 'rule change')} to approve` : null,
      approved ? `${approved} approved, ready to check` : null,
    ].filter(Boolean).join(', ');
    // Your queue still lists a decided claim until the agent's next tag run reads the decision, so "nothing waits" would contradict the view when only such claims are left
    const decidedListed = counts.queue.decided_listed;
    const queueCell = n > 0
      ? `${plural(n, 'row')}, lowest confidence first`
      : decidedListed > 0 ? `${plural(decidedListed, 'row')} decided, waiting for the agent's next run` : 'nothing waits';
    const rows = [
      ['Rulebook', rulebook, ''],
      ['Your queue', queueCell, ''],
      ['Lessons waiting', lessonsCell, ''],
      ['Last run', counts.last_run ?? 'none yet', ''],
    ];
    const promoting = promotingNow(ctx.root, ctx.now);
    if (promoting) rows[rows.length - 1][1] = `${quoted(promoting.lesson ?? 'a rule change', 40)} is being checked now; before that: ${counts.last_run ?? 'none yet'}`;
    if (counts.queue.needs_note > 0) rows.splice(2, 0, ['Needs your note', plural(counts.queue.needs_note, 'row'), '']);

    const parts = [n ? plural(n, 'row') : null, m ? plural(m, 'rule change') : null].filter(Boolean);
    const sentence = parts.length === 0
      ? 'Status: nothing is paused and nothing waits for you.'
      : `Status: nothing is paused; ${parts.join(' and ')} ${parts.length === 1 && (n === 1 || (n === 0 && m === 1)) ? 'waits' : 'wait'} for you${counts.queue.more_than_a_sitting ? ', more than fit one sitting' : ''}.`;
    // On a practice page the two claims that are still open are seeded without the agent's side (step 1); the agent fills its columns (Agent status, Agent tags, Agent confidence ...) when
    // the editor types the demo tag command (step 2). Until it has, there is nothing to decide yet, so the Next line sends the editor to step 2. In production
    // the agent has always filled its side of a claim before the claim waits, so this never applies there.
    const unread = ctx.demo ? claims.filter((c) => !isReviewed(c) && String(c.agent_status ?? '').trim() === '').length : 0;
    let next;
    if (unread > 0) next = 'Next: type /claim-tagger demo tag so that the agent reads the claims first (step 2 of the practice page).';
    else if (counts.queue.more_than_a_sitting) next = `Next: start at the top of Your queue (${viewLink(ctx.config, 'your_queue')}).`;
    else if (n > 0) next = `Next: decide ${yourClaims(n)} in Your queue (${viewLink(ctx.config, 'your_queue')}).`;
    else if (counts.queue.pending_rule_decisions >= minClaims && m === 0) next = 'Next: type /claim-tagger distill to draft a rule change from your decisions.'; // enough decisions that blame the rule for distill to draft from, and no rule change open (Proposed or Approved)
    else if (proposed > 0) next = `Next: approve or reject the ${proposed === 1 ? 'rule change' : 'rule changes'} in Lessons waiting (${viewLink(ctx.config, 'lessons_waiting')}).`;
    else if (approved > 0) next = `Next: type /claim-tagger promote to check the approved ${approved === 1 ? 'rule change' : 'rule changes'}.`;
    else next = 'Next: type /claim-tagger tag to read new claims.';

    const json = {
      paused: false,
      edition: rubric?.edition ?? null,
      tags: rubric?.tags.length ?? 0,
      same_as_notion: differs.length === 0,
      queue: counts.queue,
      lessons: counts.lessons,
      last_run: counts.last_run,
      promoting,
      table: tableLink(ctx.config, 'claims_copy'),
    };
    return {
      exit: EXIT.OK, sentence, header: ['Where', 'Now', ''], rows, next, details: { counts, json }, ...(ctx.opts.json ? { print: JSON.stringify(json, null, 2) } : {}),
    };
  });
}

const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Parse the command line and run; returns the exit code. deps (tests): everything status() takes besides the flags. */
export async function main(argv, io = consoleIo, deps = {}) {
  const parsed = parseCli('status', argv, { pull: { type: 'string' }, json: { type: 'boolean' }, 'run-id': { type: 'string' } }, USAGE, io);
  if (parsed.exit !== undefined) return parsed.exit;
  const v = parsed.values;
  try {
    return (await status({ ...deps, io, pull: v.pull, json: v.json === true, runId: v['run-id'] })).exit;
  } catch (e) {
    io.err(`status: unexpected error: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
