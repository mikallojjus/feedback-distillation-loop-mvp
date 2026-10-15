#!/usr/bin/env node
// Propose: turns what the judge stored for each claim into the queue an editor works through, and into the two columns the team reads on the
// Claims copy. It reads the cell store the latest judge run filled and writes Notion only by applying a plan it made itself.
//
//   node agents/claim-tagger-mvp/scripts/propose.mjs [--pull <pull-id>] [--plan-only] [--driver cli|fake] [--run-id <id>]
//
//   --pull <id>    use that pull instead of pulling every table first
//   --plan-only    make and check the plan (runs/<run-id>/plan.jsonl) and stop; nothing is sent to Notion
//   --driver       cli (default) or fake: which judge's answers to read (the store key holds the driver; tests use fake)
//   --run-id       name the run folder (default <UTC stamp>-propose)
//
// What a run does (CONTRACTS section 7). For every claim of the pull that the judge has read, for every judged tag, the verdict over the claim's
// reads (majority; unsure when any read was ask_editor or failed, when the reads disagree, or when the mean p is inside the band):
//   Agent proposal    Applies / Does not apply when sure, Can't tell when not
//   Agent confidence  max(p, 1 - p) to two decimals (0.5 is a coin flip; Your queue sorts lowest first)
//   Agent reason      the reason of the last read in at most queue.reason_max_words words, then " · <rule> · <k>/<n> runs agreed"
// The plan: a Tag decisions row for every unsure cell that has no row; the four agent columns of every undecided row whose values changed (a decided
// row is never touched here); and Agent tags and Agent notes on the Claims copy, only where they differ from what the pull holds. Agent tags are the
// tags that apply and do not wait for an editor, plus every tag an editor decided Applies (an editor always wins). Agent notes are two lines:
//   line 1  the same tags, or "no tags"
//   line 2  "<n> wait(s) for an editor" or "nothing waits for an editor", " · not checked: <counts by kind>" when a tag was not checked, " · edition <e>"
// The plan ends with the Agent settings row: the edition and "Tag · <date time> · <n> claims".
//
// Exit codes: 0 ok, 1 stopped (the same command continues), 2 invalid (nothing read yet, a refused plan, a read-back that differed), 3 paused,
// 4 drift of the rulebook text in Notion.
//
// Exports: propose, cellVerdict, claimColumns, notCheckedParts, openRowCount, main, USAGE.

import { readFileSync } from 'node:fs';
import { compareCodePoints } from './lib/pyjson.mjs';
import { codeFile, isMain } from './lib/paths.mjs';
import { normaliseText } from './lib/notion-values.mjs';
import { newPlan } from './lib/plan.mjs';
import { openStore } from './lib/cells.mjs';
import { tableEntry } from './lib/config.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { listNames, plural, stampOf, viewLink, capWords } from './lib/editor-words.mjs';
import {
  LoopExit, addSettingsOp, applyStep, assertApplied, judgeSettings, liveRubric, needTables, parseCli, resumeLine, runPreflight, takePull, withRun,
} from './lib/loop.mjs';
import {
  groupsFor, itemHash, readPromptVersion, storeInputsFor, verdictOf,
} from './judge.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/propose.mjs [--pull <pull-id>] [--plan-only] [--driver cli|fake] [--run-id <id>]';

const round2 = (x) => Math.round(x * 100) / 100;
const AGENT_COLUMNS = ['Agent proposal', 'Agent confidence', 'Agent reason', 'Rulebook edition'];

// ---- one cell: the verdict over a claim's reads -------------------------------------------------------------------------------------

/**
 * The verdict for one claim and one tag. `runLines` are the claim's lines in runs 1 to 3 of the group's store (null where there is none, a line of
 * another claim text counts as none). Returns { proposal, confidence, reason, unsure, decision, runs, agreed, rule_ref }.
 */
export function cellVerdict(runLines, tagName, { rerun, reasonMaxWords = 40 } = {}) {
  const ok = runLines.filter((l) => l?.status === 'ok');
  const entries = ok.map((l) => l.tags.find((t) => t.name === tagName)).filter(Boolean);
  const hadError = runLines.some((l) => l?.status === 'error');
  const v = verdictOf(entries, rerun, { hadError });
  const last = entries[entries.length - 1] ?? null;
  const proposal = v.unsure ? "Can't tell" : (v.decision === 'apply' ? 'Applies' : 'Does not apply');
  const confidence = v.p_mean === null ? 0.5 : round2(Math.max(v.p_mean, 1 - v.p_mean));
  const lines = runLines.filter(Boolean).length;
  const reason = last
    ? [capWords(last.reason, reasonMaxWords), last.rule_ref, `${v.agreed}/${v.runs} runs agreed`].filter(Boolean).join(' · ')
    : `The agent could not read this claim · 0/${Math.max(lines, 1)} runs agreed`;
  return { proposal, confidence, reason, unsure: v.unsure, decision: v.decision, runs: v.runs, agreed: v.agreed, rule_ref: last?.rule_ref ?? null };
}

// ---- Agent tags and Agent notes -----------------------------------------------------------------------------------------------------

/**
 * "not checked" for a rulebook, as the text after "not checked: " and the count: tags that no judge group covers, by kind. Source tags (and Unsourced,
 * which is worked out from the sources and not yet) are "source tags", the two duplicate tags "duplicate tags", the rest "tags without rules".
 */
export function notCheckedParts(rubric, judgedNames) {
  let source = 0;
  let duplicate = 0;
  let without = 0;
  for (const t of rubric.tags) {
    if (judgedNames.has(t.name)) continue;
    if (t.capability === 'source' || t.capability === 'deterministic') source += 1;
    else if (t.capability === 'corpus') duplicate += 1;
    else without += 1;
  }
  return [
    source ? plural(source, 'source tag') : null,
    duplicate ? plural(duplicate, 'duplicate tag') : null,
    without ? plural(without, 'tag without rules', 'tags without rules') : null,
  ].filter(Boolean).join(', ');
}

/**
 * Agent tags and Agent notes of one claim. `rows` maps a tag to { decided: true, outcome } (an editor decided: Applies counts, Does not apply does
 * not) or { open: true } (a row waits in Your queue: the tag is not written and counts as waiting). A judged tag with no row follows its entry in
 * `proposals` (Applies counts); a tag without a proposal keeps its place in `currentTags`. `notChecked` is notCheckedParts' text.
 * Returns { tags: [names], agent_tags, agent_notes, waits }.
 */
export function claimColumns({ judgedNames, rows, proposals = new Map(), currentTags = [], notChecked = '', edition }) {
  const names = [...new Set([...judgedNames, ...rows.keys()])].sort(compareCodePoints);
  const tags = [];
  let waits = 0;
  for (const tag of names) {
    const row = rows.get(tag);
    if (row?.decided) {
      if (row.outcome === 'Applies') tags.push(tag);
    } else if (row?.open) {
      waits += 1;
    } else if (proposals.has(tag)) {
      if (proposals.get(tag) === 'Applies') tags.push(tag);
    } else if (currentTags.includes(tag)) {
      tags.push(tag);
    }
  }
  const second = [
    waits ? `${waits} ${waits === 1 ? 'waits' : 'wait'} for an editor` : 'nothing waits for an editor',
    notChecked ? `not checked: ${notChecked}` : null,
    `edition ${edition}`,
  ].filter(Boolean).join(' · ');
  return { tags, agent_tags: tags.join(', '), agent_notes: `${tags.length ? tags.join(', ') : 'no tags'}\n${second}`, waits };
}

/** The tags written in a pulled Agent tags cell ("A, B"). */
export const tagsOfCell = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const sameText = (a, b) => normaliseText(a ?? '') === normaliseText(b ?? '');

/** How many rows of the queue wait for an editor: the pull's undecided rows (the rows a run creates are added by the caller). */
export const openRowCount = (queue) => queue.filter((r) => !r.decided).length;

// ---- the run -------------------------------------------------------------------------------------------------------------------------

const tagLine = (names) => (names.length ? listNames(names) : 'no tag');

/** Run propose. opts: the flags (pull, planOnly, driver, runId) and the hooks of the other scripts (root, config, io, now, fetchImpl, token, sleep, client). */
export async function propose(opts = {}) {
  return withRun({
    script: 'propose', label: 'Tag', again: '/claim-tagger tag', opts, args: { pull: opts.pull ?? null, plan_only: opts.planOnly === true, driver: opts.driver ?? 'cli' },
    resume: resumeLine('propose', opts.driver === 'fake' ? ['--driver', 'fake'] : []),
  }, async (ctx) => {
    await takePull(ctx);
    needTables(ctx, 'claims_copy', 'tag_decisions');
    runPreflight(ctx);
    const rubric = liveRubric(ctx);
    const jc = judgeSettings(ctx);
    const reasonMax = ctx.config.queue?.reason_max_words ?? jc.reasonMaxWords;

    const groups = groupsFor(jc, rubric, null);
    if (!groups.length) {
      throw new LoopExit(EXIT.INVALID, 'the rulebook has no tag with rules in force in any judge group', {
        sentence: 'Tag: nothing was proposed, because no tag has rules to judge by.',
        next: 'Next: ask the engineer to look at the message the script printed.',
      });
    }
    const { version: promptVersion } = readPromptVersion(readFileSync(codeFile(ctx.root, jc.judge.prompt), 'utf8'));
    const stores = groups.map((group) => {
      const store = openStore(ctx.root, storeInputsFor({ driver: ctx.driver, model: jc.model, effort: jc.judge.effort, promptVersion, group }), { readOnly: true });
      return { group, runs: [1, 2, 3].map((n) => store.lines(n)) };
    });
    const judgedNames = new Set(groups.flatMap((g) => g.tags.map((t) => t.name)));
    const judgedList = [...judgedNames].sort(compareCodePoints);
    const notChecked = notCheckedParts(rubric, judgedNames);
    const edition = rubric.edition;

    const queue = ctx.pull.queue() ?? [];
    const queueByKey = new Map(queue.filter((r) => r.Key).map((r) => [r.Key, r]));
    const byClaim = new Map(); // geo id -> Map(tag -> queue row)
    for (const r of queue) {
      const at = String(r.Key ?? '').lastIndexOf('::');
      if (at < 0 || !r.Tag) continue;
      const id = r.Key.slice(0, at);
      if (!byClaim.has(id)) byClaim.set(id, new Map());
      byClaim.get(id).set(r.Tag, r);
    }
    const writeColumns = tableEntry(ctx.config, 'claims_copy').write_columns;

    const plan = newPlan({ runId: ctx.runId, script: 'propose', rubricEdition: edition, config: ctx.config, now: ctx.now });
    const claims = ctx.pull.claims() ?? [];
    const rerun = jc.judge.rerun;
    const tagged = new Map(judgedList.map((t) => [t, 0]));
    let read = 0;
    let created = 0;
    let updated = 0;
    let claimUpdates = 0;
    let notRead = 0;

    for (const claim of claims) {
      const hash = itemHash(claim.claim);
      const verdicts = new Map();
      let covered = true;
      for (const { group, runs } of stores) {
        const lines = runs.map((m) => {
          const l = m.get(claim.geo_id);
          return l && l.item_hash === hash ? l : null;
        });
        if (!lines[0]) {
          covered = false;
          break;
        }
        for (const tag of group.tags) verdicts.set(tag.name, cellVerdict(lines, tag.name, { rerun, reasonMaxWords: reasonMax }));
      }
      if (!covered) {
        notRead += 1;
        continue;
      }
      read += 1;

      const rows = new Map();
      const proposals = new Map();
      for (const [tag, v] of verdicts) {
        proposals.set(tag, v.proposal);
        const key = `${claim.geo_id}::${tag}`;
        const existing = queueByKey.get(key);
        const values = { 'Agent proposal': v.proposal, 'Agent confidence': v.confidence, 'Agent reason': v.reason, 'Rulebook edition': edition };
        if (existing?.decided) {
          rows.set(tag, { decided: true, outcome: existing['Tag outcome'] });
        } else if (existing) {
          rows.set(tag, { open: true });
          const same = AGENT_COLUMNS.every((c) => (c === 'Agent confidence'
            ? round2(Number(existing[c] ?? Number.NaN)) === values[c]
            : sameText(existing[c], values[c])));
          if (!same) {
            plan.update('tag_decisions', key, existing.page_id, values);
            updated += 1;
          }
        } else if (v.unsure) {
          rows.set(tag, { open: true });
          plan.create('tag_decisions', key, {
            Claim: claim.claim, Key: key, Tag: tag, ...values, 'Claim link': claim.notion_url ?? null,
          });
          created += 1;
        }
      }
      for (const [tag, row] of byClaim.get(claim.geo_id) ?? []) { // rows on tags the judge does not cover: an editor's decision still counts
        if (!rows.has(tag)) rows.set(tag, row.decided ? { decided: true, outcome: row['Tag outcome'] } : { open: true });
      }

      const columns = claimColumns({ judgedNames: judgedList, rows, proposals, currentTags: tagsOfCell(claim.agent_tags), notChecked, edition });
      for (const t of columns.tags) if (tagged.has(t)) tagged.set(t, tagged.get(t) + 1);
      const props = {};
      if (!sameText(claim.agent_tags, columns.agent_tags)) props[writeColumns.tags] = columns.agent_tags;
      if (!sameText(claim.agent_notes, columns.agent_notes)) props[writeColumns.notes] = columns.agent_notes;
      if (Object.keys(props).length) {
        plan.update('claims_copy', claim.geo_id, claim.page_id, props);
        claimUpdates += 1;
      }
    }

    if (read === 0) {
      throw new LoopExit(EXIT.INVALID, `none of the ${claims.length} claims has an answer in the store of the current rulebook`, {
        sentence: 'Tag: nothing was proposed, because the agent has not read any claim yet.',
        next: 'Next: ask the engineer to look at the message the script printed.',
      });
    }
    addSettingsOp(ctx, plan, `Tag · ${stampOf(ctx.now())} · ${plural(read, 'claim')}`, edition);

    const { result } = await applyStep(ctx, plan);
    const open = openRowCount(queue) + created;
    const sitting = ctx.config.queue?.sitting_rows ?? 20;
    const link = viewLink(ctx.config, 'your_queue');
    const details = { claimsRead: read, notRead, created, updated, claimUpdates, open, tagged: Object.fromEntries(tagged), result };
    const counts = { claims_read: read, not_read: notRead, rows_created: created, rows_updated: updated, claims_updated: claimUpdates, open_rows: open };

    if (ctx.opts.planOnly) {
      return {
        exit: EXIT.OK,
        sentence: `Tag: the plan is ready (${plural(created, 'new row')}, ${plural(updated, 'row update')}, ${plural(claimUpdates, 'claim update')}) and nothing was written to Notion.`,
        rows: [['New rows in Your queue', String(created), ''], ['Rows to update', String(updated), ''], ['Claims to update', String(claimUpdates), '']],
        next: 'Next: type /claim-tagger tag to write it.',
        details,
        counts,
      };
    }
    assertApplied(ctx, result);

    const waiting = open === 0 ? 'nothing waits for you' : (open > sitting ? `${open} wait for you, more than fit one sitting` : (open === 1 ? '1 waits for you' : `${open} wait for you`));
    const rows = [['Claims read', String(read), '']];
    if (judgedList.length <= 2) for (const t of judgedList) rows.push([`Tagged ${t}`, plural(tagged.get(t), 'claim'), '']);
    else rows.push(['Tagged', `${plural([...tagged.values()].reduce((a, b) => a + b, 0), 'tag')} written`, '']);
    rows.push(['New rows in Your queue', created ? `${created}, lowest confidence first` : 'none', '']);
    if (notRead > 0 && rows.length < 5) rows.push(['Not read yet', String(notRead), '']);
    const next = open === 0
      ? 'Next: nothing waits for you; type /claim-tagger tag when new claims arrive.'
      : (open > sitting ? `Next: start at the top of Your queue (${link}).` : `Next: decide the ${plural(open, 'row')} in Your queue (${link}).`);
    return {
      exit: EXIT.OK,
      sentence: `Tag: the agent read ${plural(read, 'claim')} for ${tagLine(judgedList)}; ${waiting}.`,
      rows,
      next,
      details,
      counts,
    };
  });
}

// ---- the command line -----------------------------------------------------------------------------------------------------------------

const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Parse the command line and run; returns the exit code. deps (tests): everything propose() takes besides the flags. */
export async function main(argv, io = consoleIo, deps = {}) {
  const parsed = parseCli('propose', argv, { pull: { type: 'string' }, 'plan-only': { type: 'boolean' }, 'run-id': { type: 'string' } }, USAGE, io);
  if (parsed.exit !== undefined) return parsed.exit;
  const v = parsed.values;
  try {
    return (await propose({ ...deps, io, pull: v.pull, planOnly: v['plan-only'] === true, driver: v.driver ?? deps.driver, runId: v['run-id'] })).exit;
  } catch (e) {
    io.err(`propose: unexpected error: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
