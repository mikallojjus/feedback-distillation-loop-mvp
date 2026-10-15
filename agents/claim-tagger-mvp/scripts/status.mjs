#!/usr/bin/env node
// Status: what is open, in the three parts of every report. It pulls every table, looks at the pause and the rulebook, and counts; it writes nothing to Notion.
//
//   node agents/claim-tagger-mvp/scripts/status.mjs [--pull <pull-id>] [--json] [--run-id <id>]
//
//   --pull <id>   use that pull instead of pulling every table first
//   --json        print the counts as JSON (for the engineer) instead of the report; the report files are written all the same
//
// The report. "Status: nothing is paused; N rows and M rule changes wait for you." (", more than fit one sitting" when N is above queue.sitting_rows), a table with
// the Rulebook ("<n> tags, edition <e>"; "1 tag, edition <e>" on a practice page), Your queue ("<n> rows, lowest confidence first"), Lessons waiting and the last run
// (the Last run summary, else "none yet"), and one Next line: decide the rows / start at the top of Your queue / approve or reject the rule change / check the approved
// one / read new claims. The Rulebook row does not say that Notion agrees: a drift of the rulebook text on a judged tag is checked before the report and ends the command
// with the drift report (exit 4, naming the tag and the column and telling the editor to ask the engineer to restore the rulebook text); only a difference that does
// not stop the command (a tag without rules edited or added in Notion) or a drift check that could not run is said in the row. A paused agent ends with the refusal
// report (exit 3). On a practice page the sentence starts "Status of the practice page <title>:" (loop.mjs).
//
// Exit codes: 0 ok, 2 invalid, 3 paused, 4 drift or an invalid rulebook file.
//
// Exports: status, countsOf, main, USAGE.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from './lib/exit-codes.mjs';
import { listNames, plural, quoted, tableLink, viewLink } from './lib/editor-words.mjs';
import { LOCK_STALE_MS, LoopExit, parseCli, resumeLine, takePull, withRun } from './lib/loop.mjs';
import { isMain } from './lib/paths.mjs';
import { preflight, refusedReport } from './lib/preflight.mjs';
import { readRubric } from './lib/rubric.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/status.mjs [--pull <pull-id>] [--json] [--run-id <id>]';
const RULE_WHY = new Set(['Rule unclear', 'Rule should change']);

/** The counts the report and --json are made of, from the pull's queue, lessons and settings. */
export function countsOf({ queue = [], lessons = [], settings = null, sitting = 20 }) {
  const open = queue.filter((r) => !r.decided).length;
  const needsNote = queue.filter((r) => RULE_WHY.has(r['Why wrong']) && String(r['Your reasoning'] ?? '').trim() === '').length;
  const byStatus = { Proposed: 0, Approved: 0, Rejected: 0, Live: 0, 'Rolled back': 0 };
  for (const l of lessons) byStatus[l.Status] = (byStatus[l.Status] ?? 0) + 1;
  return {
    queue: { open, decided: queue.length - open, needs_note: needsNote, sitting_rows: sitting, more_than_a_sitting: open > sitting },
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

    let rubric = null;
    try {
      rubric = readRubric(ctx.root);
    } catch {
      rubric = null;
    }
    const sitting = ctx.config.queue?.sitting_rows ?? 20;
    const counts = countsOf({ queue: ctx.pull.queue() ?? [], lessons: ctx.pull.lessons() ?? [], settings: ctx.pull.settings(), sitting });
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
    const rows = [
      ['Rulebook', rulebook, ''],
      ['Your queue', n === 0 ? 'nothing waits' : `${plural(n, 'row')}, lowest confidence first`, ''],
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
    let next;
    if (counts.queue.more_than_a_sitting) next = `Next: start at the top of Your queue (${viewLink(ctx.config, 'your_queue')}).`;
    else if (n > 0) next = `Next: decide the ${plural(n, 'row')} in Your queue (${viewLink(ctx.config, 'your_queue')}).`;
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
      table: tableLink(ctx.config, 'tag_decisions'),
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
