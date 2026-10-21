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
// decided ones are still listed there, "<n> rows decided, waiting for the agent's next run"; else "nothing waits"), Your decisions (what the agent still has to do with the
// decisions made: "3 to read, 1 without a note", see below; no row when all three counts are zero), Lessons waiting and the last run (the Last run summary, else "none yet"), at
// most five rows, and one Next line, the first that applies: read the claims (practice page only) / start at the top of Your queue or decide the rows / type distill (something
// is to read, or at least distill.min_claims claims point at a rule, and no rule change is Proposed or Approved: distill has something to read or draft) / approve or reject the
// rule change / check the approved one / read new claims. The Rulebook row does not say that Notion agrees: a drift of the rulebook text on a judged tag is checked before the
// report and ends the command with the drift report (exit 4, naming the tag and the column and telling the editor to ask the engineer to restore the rulebook text); only a
// difference that does not stop the command (a tag without rules edited or added in Notion) or a drift check that could not run is said in the row. A paused agent ends with
// the refusal report (exit 3). On a practice page the sentence starts "Status of the practice page <title>:" (loop.mjs), and while a row that waits has no Agent proposal yet
// (step 1 of the page) the Next line is "type /claim-tagger demo tag" (step 2) instead of "decide the rows": there is nothing to decide before the agent has read the
// claims. In production that line is never used.
//
// The rows that wait are claims of the Claims copy (CLAIMS-REVIEW.md, section 6.2): a claim whose Agent status is "Waits for you" and whose Review status is not Reviewed (what is
// still to decide: Your queue may list a few more, the claims that were decided since the last tag run: queue.decided_listed counts them). Your queue is the view of the Claims copy.
//
// The decisions made (READ-DECISIONS.md, decision 74). The agent reads each disagreement between an editor's decision and its own proposal itself (distill, lib/readings.mjs), and
// only distill makes or writes a reading, so status counts, from the ledger as distill would bring it up to date (syncDecisions) and sorted the way distill sorts it (classifyRows),
// the Reviewed claims with an unfixed disagreement row (a row whose Follow-up is Fixed is never read):
//   queue.to_read                  a row is stale: the editor's decision, note or reason word changed since the agent last read it, or the agent proposed the tag again under a new edition, or it was never read (it is read by
//                                  distill; also a note line that opens with a reason word, which distill takes as it stands without asking a model)
//   queue.pending_rule_decisions   a row the agent has read as a rule problem (Rule unclear or Rule should change) and that stands: distill drafts a rule change from such rows when
//                                  at least distill.min_claims claims point at the same rule
//   queue.needs_note               a row for which the editor wrote neither a reason word nor any words for the tag, whether the agent has read it yet or not (the claim's Agent
//                                  reading says "without your note" once it has)
// Each is a count of claims. The row "Your decisions" shows the parts that are not zero, in this order, "<n> to read", "<n> point(s) at a rule", "<n> without a note", for example
// "3 to read, 1 without a note"; with all three zero there is nothing to say and the row is left out (the table of step 1 of the practice page has four rows). A reading of a decision without
// a note ("without your note" opens its Reading note) points at no rule (pointsAtRule): it counts in "without a note" only (decision 78). With nothing in Your queue and no rule change, the sentence
// follows that row: "Status: nothing is paused; the agent has N of your decisions to read." / "...; N of your decisions have no note." instead of "nothing waits for you".
//
// A Proposed or Approved rule change that rests on a decision the editor now calls the agent's slip (or that no longer points at a rule) is recanted (decision 79, recantedLessons over the ledger
// as distill would leave it, a reason word the editor has just written applied already): the row Lessons waiting says "1 rule change to reject (rests on a decision you now call a slip)" and the Next
// line, after the claims to decide and the distill suggestion and before "approve or reject" and "promote", is "reject the rule change "<title>" in Lessons waiting (<link>), then type /claim-tagger
// distill again."
//
// Exit codes: 0 ok, 2 invalid, 3 paused, 4 drift or an invalid rulebook file.
//
// Exports: status, countsOf, readingCounts, decisionsCell, main, USAGE.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from './lib/exit-codes.mjs';
import { AGENT_STATUS } from './lib/config.mjs';
import { claimWaits, isReviewed, syncDecisions } from './lib/decisions.mjs';
import { approveNext, listNames, plural, quoted, recantedNext, tableLink, viewLink, yourClaims } from './lib/editor-words.mjs';
import { LOCK_STALE_MS, LoopExit, needClaimColumns, parseCli, resumeLine, supportingKeysOf, takePull, withRun } from './lib/loop.mjs';
import { isMain } from './lib/paths.mjs';
import { preflight, refusedReport } from './lib/preflight.mjs';
import { classifyRows, pointsAtRule, recantedLessons, recantedPhrase } from './lib/readings.mjs';
import { readRubric } from './lib/rubric.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/status.mjs [--pull <pull-id>] [--json] [--run-id <id>]';

const NO_READING_COUNTS = Object.freeze({ to_read: 0, pending_rule_decisions: 0, needs_note: 0 });

/**
 * The three counts of the decisions made (see the header), from the pull's claims and ledger rows (queue), the rulebook in force and the config. Each counts claims. The ledger is brought
 * up to date the way distill does it first (syncDecisions with the names of every tag of the rulebook), so that a decision an editor made since the last tag run counts at once. Without a
 * rulebook there is nothing the agent could read: all three are 0.
 */
export function readingCounts({ claims = [], queue = [], rubric = null, config = null } = {}) {
  if (!rubric || !Array.isArray(rubric.tags)) return { ...NO_READING_COUNTS };
  const { rows } = syncDecisions(claims, queue, { tagNames: rubric.tags.map((t) => t.name) });
  const classes = classifyRows({ claims, ledgerRows: rows, rubric, config });
  const claimsOf = (items) => new Set(items.map((i) => i.claim.geo_id)).size;
  const noNote = (item) => item.reasonWord === null && String(item.noteLine ?? '').trim() === '';
  return {
    to_read: claimsOf([...classes.verbatim, ...classes.toRead]),
    pending_rule_decisions: claimsOf(classes.current.filter((item) => pointsAtRule(item.row))),
    needs_note: claimsOf([...classes.toRead, ...classes.current].filter(noNote)),
  };
}

/** The cell of the row "Your decisions": the parts of the counts that are not zero, "3 to read, 1 without a note"; the empty string when all three are zero. */
export function decisionsCell({ to_read: toRead = 0, pending_rule_decisions: pending = 0, needs_note: needsNote = 0 } = {}) {
  return [
    toRead > 0 ? `${toRead} to read` : null,
    pending > 0 ? `${pending} ${pending === 1 ? 'points' : 'point'} at a rule` : null,
    needsNote > 0 ? `${needsNote} without a note` : null,
  ].filter(Boolean).join(', ');
}

/** The counts the report and --json are made of, from the pull's claims, lessons, ledger rows (queue), settings, and the rulebook and config the readings are counted under. */
export function countsOf({ claims = [], lessons = [], queue = [], settings = null, sitting = 20, rubric = null, config = null }) {
  const open = claims.filter((c) => claimWaits(c)).length;
  // decided since the last tag run: Reviewed, and the agent's status still says "Waits for you", so Your queue still lists the claim (CLAIMS-REVIEW.md, section 6.2)
  const decidedListed = claims.filter((c) => isReviewed(c) && String(c.agent_status ?? '').trim() === AGENT_STATUS.waits).length;
  const byStatus = { Proposed: 0, Approved: 0, Rejected: 0, Live: 0, 'Rolled back': 0 };
  for (const l of lessons) byStatus[l.Status] = (byStatus[l.Status] ?? 0) + 1;
  const readings = readingCounts({ claims, queue, rubric, config });
  // the Proposed or Approved rule changes that rest on a decision whose reading no longer points at a rule (decision 79), judged over the ledger as distill would leave it
  const recanted = recantedLessons({ lessons, claims, ledgerRows: queue, rubric, config }).map((x) => ({ title: x.lesson.Lesson, status: x.lesson.Status, keys: x.keys, why: x.why }));
  return {
    queue: {
      open,
      decided: claims.filter((c) => isReviewed(c)).length,
      decided_listed: decidedListed,
      to_read: readings.to_read,
      pending_rule_decisions: readings.pending_rule_decisions,
      needs_note: readings.needs_note,
      sitting_rows: sitting,
      more_than_a_sitting: open > sitting,
    },
    lessons: byStatus,
    waiting_lessons: byStatus.Proposed + byStatus.Approved,
    recanted,
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
    // the keys a rule change rests on, with the ones its page body holds when the cell was cut (read only for a Proposed or Approved one)
    const lessonRows = [];
    for (const l of ctx.pull.lessons() ?? []) lessonRows.push(l.Status === 'Proposed' || l.Status === 'Approved' ? { ...l, supporting_keys: await supportingKeysOf(ctx, l) } : l);
    const counts = countsOf({ claims, lessons: lessonRows, queue: ctx.pull.queue() ?? [], settings: ctx.pull.settings(), sitting, rubric, config: ctx.config });
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
    // a rule change that rests on a decision the editor has since called the agent's slip is to be rejected, not approved or checked (decision 79)
    const recanted = counts.recanted;
    const recantedOf = (status) => recanted.filter((x) => x.status === status).length;
    const toApprove = proposed - recantedOf('Proposed');
    const ready = approved - recantedOf('Approved');
    const toReject = recanted.length;
    const rejectCell = toReject === 1
      ? `1 rule change to reject (rests on ${recantedPhrase(recanted[0].keys, recanted[0].why, { short: true })})`
      : `${toReject} rule changes to reject (they rest on decisions you changed)`;
    const lessonsCell = m === 0 ? 'none' : [
      toApprove > 0 ? `${plural(toApprove, 'rule change')} to approve` : null,
      toReject > 0 ? rejectCell : null,
      ready > 0 ? `${ready} approved, ready to check` : null,
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
    // what the agent still has to do with the decisions made; nothing to say when all three counts are zero, so no row (the table stays at five rows at most)
    const decisions = decisionsCell(counts.queue);
    if (decisions !== '') rows.splice(2, 0, ['Your decisions', decisions, '']);

    const parts = [n ? plural(n, 'row') : null, m ? plural(m, 'rule change') : null].filter(Boolean);
    // with nothing in Your queue and no rule change, the sentence must not say that nothing waits while the row "Your decisions" shows decisions the agent has to read or that have no note
    const toRead = counts.queue.to_read;
    const noNote = counts.queue.needs_note;
    let sentence;
    if (parts.length > 0) {
      sentence = `Status: nothing is paused; ${parts.join(' and ')} ${parts.length === 1 && (n === 1 || (n === 0 && m === 1)) ? 'waits' : 'wait'} for you${counts.queue.more_than_a_sitting ? ', more than fit one sitting' : ''}.`;
    } else if (toRead > 0) sentence = `Status: nothing is paused; the agent has ${toRead} of your decisions to read.`;
    else if (noNote > 0) sentence = `Status: nothing is paused; ${noNote} of your decisions ${noNote === 1 ? 'has' : 'have'} no note.`;
    else sentence = 'Status: nothing is paused and nothing waits for you.';
    // On a practice page the two claims that are still open are seeded without the agent's side (step 1); the agent fills its columns (Agent status, Agent tags, Agent confidence ...) when
    // the editor types the demo tag command (step 2). Until it has, there is nothing to decide yet, so the Next line sends the editor to step 2. In production
    // the agent has always filled its side of a claim before the claim waits, so this never applies there.
    const unread = ctx.demo ? claims.filter((c) => !isReviewed(c) && String(c.agent_status ?? '').trim() === '').length : 0;
    let next;
    if (unread > 0) next = 'Next: type /claim-tagger demo tag so that the agent reads the claims first (step 2 of the practice page).';
    else if (counts.queue.more_than_a_sitting) next = `Next: start at the top of Your queue (${viewLink(ctx.config, 'your_queue')}).`;
    else if (n > 0) next = `Next: decide ${yourClaims(n)} in Your queue (${viewLink(ctx.config, 'your_queue')}).`;
    // distill has something to do while a decision is still to read (the reading is made only by distill, so even one row is enough), or while enough decisions point at a rule for it to
    // draft from, and no rule change is open (Proposed or Approved)
    else if ((counts.queue.to_read > 0 || counts.queue.pending_rule_decisions >= minClaims) && m === 0) next = 'Next: type /claim-tagger distill to draft a rule change from your decisions.';
    // a rule change that rests on a decision the editor has since called the agent's slip is rejected first, then distill drafts again from the rows that remain (decision 79)
    else if (recanted.length > 0) next = recantedNext(ctx.config, recanted.map((x) => x.title));
    else if (proposed > 0) next = approveNext(ctx.config, proposed);
    else if (approved > 0) next = `Next: type /claim-tagger promote to check the approved ${approved === 1 ? 'rule change' : 'rule changes'}.`;
    else next = 'Next: type /claim-tagger tag to read new claims.';

    const json = {
      paused: false,
      edition: rubric?.edition ?? null,
      tags: rubric?.tags.length ?? 0,
      same_as_notion: differs.length === 0,
      queue: counts.queue,
      lessons: counts.lessons,
      recanted_lessons: recanted.map((x) => x.title),
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
