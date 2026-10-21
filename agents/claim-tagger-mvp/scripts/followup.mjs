#!/usr/bin/env node
// Follow-up: after a rule change went live, check the rows it rests on once more under the rule now in force and mark each of them Fixed or Still
// wrong. promote runs it by itself as its last step after a PASS (followUp, below); typing it by hand only repeats that step after a run that stopped
// before it.
//
//   node agents/claim-tagger-mvp/scripts/followup.mjs [--lesson "<title>"] [--pull <pull-id>] [--driver cli|fake] [--run-id <id>] [--runs-max <n>] [--plan-only]
//
//   --lesson       the title of the rule change; it must be Live. Without it: the only Live rule change (two or more: exit 2, naming them)
//   --pull, --driver, --run-id, --runs-max, --plan-only   as for the other loop scripts
//
// What it does. The supporting rows of the lesson are rows of the ledger (Tag decisions) that hold a decision, so each is one of the earlier decisions the
// safety check keeps in evals/cases.jsonl (item case-<key>). They are judged under the rulebook in force: right after a PASS that rulebook is the candidate the check judged, so every answer is
// already in the store and nothing is asked. A row whose answer is what the editor decided is Fixed, any other Still wrong. The plan writes
//   Tag decisions    Follow-up on the supporting rows (the only column a decided row accepts), where it differs from the pulled value
//   Claims copy      the agent's columns of the claims of those rows, worked out again the way propose works them (CLAIMS-REVIEW.md sections 6.1 and 6.2): Agent tags (a relation to the Rulebook
//                    copy), Agent reasons (the line of each tag that was checked again, the others kept), Agent status (Done or Disagrees with your decision, Waits for you while a tag waits), Tags waiting
//                    (empty when nothing waits), Agent edition and Agent remarks, and Agent confidence. A claim an editor has Reviewed gets the editor's verified set (an editor
//                    always wins) and the status Disagrees with your decision where the agent's answer under the rule now in force still differs from it. Agent confidence is
//                    the propose rule (the lowest of max(p, 1 - p) over the claim's judged tags) over the answers this step has, so a claim whose answer changed does not keep the
//                    confidence of the answer it had; it is written only when every judged tag of the claim was checked again here (with one judged tag, always), else left as it is
//   Agent settings   the edition and "Follow-up · <date time> · n Fixed, m Still wrong" (left out when promote runs the follow-up)
// It never writes or clears a reading: the claim's Agent reading and the ledger's Agent reading, Rule, Reading note and Read under belong to distill (READ-DECISIONS.md). A row marked
// Fixed keeps the reading it has, and distill does not read it again.
//
// Exit codes: 0 ok, 1 stopped, 2 invalid (the lesson is not Live, a supporting row is not decided any more), 3 paused, 4 drift, 75 usage window.
//
// Exports: followUp, main, USAGE.

import { EXIT } from './lib/exit-codes.mjs';
import { answerWord, plural, quoted, stampOf, viewLink } from './lib/editor-words.mjs';
import { claimDisagrees, isReviewed, isToReview } from './lib/decisions.mjs';
import { readAnswers } from './lib/answers.mjs';
import { tableEntry } from './lib/config.mjs';
import {
  LoopExit, addSettingsOp, applyStep, assertApplied, judgeSettings, liveRubric, needClaimColumns, needTables, parseCli, pickLesson, readEvals, resumeLine, runJudge, runPreflight, supportingKeysOf, takePull, withRun,
} from './lib/loop.mjs';
import { isMain } from './lib/paths.mjs';
import { newPlan } from './lib/plan.mjs';
import { claimColumns, claimProps, notCheckedParts, reasonsOfCell, tagPagesOf } from './propose.mjs';
import { groupsFor, selectItems } from './judge.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/followup.mjs [--lesson "<title>"] [--pull <pull-id>] [--driver cli|fake] [--run-id <id>] [--runs-max <n>] [--plan-only]';

const ENGINEER = 'Next: ask the engineer to look at the message the script printed.';
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Check the rows a lesson rests on under the rulebook in force and write the result (see the header). `ctx` is the run (or a child run of promote), `keys`
 * the keys of the supporting rows, `rubric` the rulebook in force. With summary: false the Agent settings row is left alone (promote has its own line there).
 * Returns { results: [{ key, claim, expected, got, status }], fixed, stillWrong, claimUpdates, result }. Throws a LoopExit when it cannot finish.
 */
export async function followUp(ctx, { tag, keys, rubric, summary = true }) {
  const { cases } = readEvals(ctx.root);
  const byKey = new Map(cases.map((c) => [c.key, c]));
  const missing = keys.filter((k) => !byKey.has(k));
  if (missing.length) {
    throw new LoopExit(EXIT.INVALID, `no earlier decision for: ${missing.join(', ')}`, {
      sentence: `${ctx.label}: nothing was done, because ${missing.length === 1 ? 'a row this rule change rests on is' : `${missing.length} rows this rule change rests on are`} not decided any more.`,
      next: ENGINEER,
    });
  }
  const wanted = keys.map((k) => byKey.get(k));
  await runJudge(ctx, { items: 'eval', tags: [tag], ids: wanted.map((c) => c.id), runsMax: ctx.opts.runsMax, runId: `${ctx.runId}-judge` });
  const items = selectItems({ root: ctx.root, items: 'eval', ids: wanted.map((c) => c.id) }).items;
  const answers = readAnswers(ctx, rubric, tag, items);
  const results = wanted.map((c) => {
    const got = answers.get(c.id)?.decision ?? null;
    return {
      key: c.key, claim: c.claim, expected: c.expected, got, status: got === c.expected ? 'Fixed' : 'Still wrong', reason: answers.get(c.id)?.reason ?? null, p: answers.get(c.id)?.p ?? null,
    };
  });
  const fixed = results.filter((r) => r.status === 'Fixed').length;
  const stillWrong = results.length - fixed;

  const plan = newPlan({ runId: ctx.runId, script: 'followup', rubricEdition: rubric.edition, config: ctx.config, now: ctx.now });
  const queue = ctx.pull.queue() ?? [];
  const byRow = new Map(queue.map((r) => [r.Key, r]));
  for (const r of results) {
    const row = byRow.get(r.key);
    if (row && row['Follow-up'] !== r.status) plan.update('tag_decisions', r.key, row.page_id, { 'Follow-up': r.status });
  }

  // the claims of those rows: the agent's columns again, with the editor's decisions
  const groups = groupsFor(judgeSettings(ctx), rubric, null);
  const judgedNames = [...new Set(groups.flatMap((g) => g.tags.map((t) => t.name)))].sort();
  const notChecked = notCheckedParts(rubric, new Set(judgedNames));
  const writeColumns = tableEntry(ctx.config, 'claims_copy').write_columns;
  const tagPages = tagPagesOf(ctx, rubric);
  const claims = new Map((ctx.pull.claims() ?? []).map((c) => [c.geo_id, c]));
  let claimUpdates = 0;
  for (const id of [...new Set(keys.map((k) => k.slice(0, k.lastIndexOf('::'))))]) {
    const claim = claims.get(id);
    if (!claim) continue;
    // the answers under the rule now in force, for the tags of this claim that were checked again (the others keep what Agent tags and Tags waiting say)
    const verdicts = new Map();
    const reasons = new Map();
    const confidences = [];
    for (const r of results) {
      const at = r.key.lastIndexOf('::');
      if (r.key.slice(0, at) !== id || r.got === null) continue;
      verdicts.set(r.key.slice(at + 2), answerWord(r.got));
      if (r.reason) reasons.set(r.key.slice(at + 2), r.reason);
      if (typeof r.p === 'number') confidences.push(round2(Math.max(r.p, 1 - r.p)));
    }
    const cols = claimColumns({
      judgedNames,
      verdicts,
      reviewed: isReviewed(claim),
      toReview: isToReview(claim),
      verifiedTags: claim.verified_tags ?? [],
      currentTags: claim.agent_tags ?? [],
      currentWaiting: claim.tags_waiting ?? [],
      previouslyDisagreed: claimDisagrees(claim),
      notChecked,
      edition: rubric.edition,
      reasons,
      currentReasons: reasonsOfCell(claim.agent_reasons, judgedNames),
    });
    const props = claimProps({ claim, columns: cols, writeColumns, tagPages, label: ctx.label });
    // the confidence of the answers just read (propose's rule), when they are all the claim's judged tags: a claim that was re-tagged does not keep the confidence of its old answer
    if (judgedNames.length > 0 && verdicts.size === judgedNames.length && confidences.length === verdicts.size) {
      const confidence = Math.min(...confidences);
      if (claim.agent_confidence === null || claim.agent_confidence === undefined || round2(claim.agent_confidence) !== confidence) props[writeColumns.confidence] = confidence;
    }
    if (Object.keys(props).length) {
      plan.update('claims_copy', id, claim.page_id, props);
      claimUpdates += 1;
    }
  }
  if (summary) addSettingsOp(ctx, plan, `Follow-up · ${stampOf(ctx.now())} · ${fixed} Fixed, ${stillWrong} Still wrong`, rubric.edition);

  const { result } = await applyStep(ctx, plan);
  assertApplied(ctx, result);
  return { results, fixed, stillWrong, claimUpdates, result, planOnly: ctx.opts.planOnly === true };
}

// ---- the run -------------------------------------------------------------------------------------------------------------------------

const decisionWords = (n) => (n === 1 ? 'your decision' : (n === 2 ? 'both of your decisions' : `all ${n} of your decisions`));

/** Run follow-up by hand. opts: lesson, pull, driver, runId, runsMax, planOnly and the hooks of the other scripts. */
export async function followup(opts = {}) {
  return withRun({
    script: 'followup', label: 'Follow-up', again: '/claim-tagger follow-up', opts,
    args: { lesson: opts.lesson ?? null, pull: opts.pull ?? null, driver: opts.driver ?? 'cli', runs_max: opts.runsMax ?? null },
    resume: resumeLine('followup', [...(opts.lesson ? ['--lesson', opts.lesson] : []), ...(opts.driver === 'fake' ? ['--driver', 'fake'] : [])]),
  }, async (ctx) => {
    await takePull(ctx);
    needTables(ctx, 'tag_decisions', 'rule_changes', 'claims_copy');
    runPreflight(ctx);
    needClaimColumns(ctx);
    const rubric = liveRubric(ctx);
    const lesson = pickLesson(ctx, opts.lesson, { status: 'Live', command: '/claim-tagger follow-up' });
    const keys = await supportingKeysOf(ctx, lesson);
    if (keys.length === 0) {
      throw new LoopExit(EXIT.INVALID, `the rule change "${lesson.Lesson}" lists no supporting rows`, { sentence: `Follow-up: nothing was done, because ${quoted(lesson.Lesson)} lists no rows it rests on.`, next: ENGINEER });
    }
    ctx.record.lesson = lesson.Lesson;
    const out = await followUp(ctx, { tag: lesson.Tag, keys, rubric });
    const n = out.results.length;
    if (out.planOnly) {
      return {
        exit: EXIT.OK, sentence: `Follow-up: the plan is ready (${out.fixed} Fixed, ${out.stillWrong} Still wrong) and nothing was written to Notion.`, rows: [], next: 'Next: type /claim-tagger follow-up to write it.', details: { results: out.results },
      };
    }
    const header = ['Your row', 'Follow-up', ''];
    const shown = out.results.slice(0, n > 5 ? 4 : 5).map((r) => [quoted(r.claim, 40), r.status, '']);
    if (n > 5) shown.push([`and ${n - 4} more`, `${out.results.slice(4).filter((r) => r.status === 'Fixed').length} Fixed`, '']);
    const sentence = out.stillWrong === 0
      ? `Follow-up, repeated by hand: the agent now agrees with ${decisionWords(n)}.`
      : `Follow-up, repeated by hand: the agent agrees with ${out.fixed} of your ${plural(n, 'decision')}; ${out.stillWrong} still ${out.stillWrong === 1 ? 'comes' : 'come'} out wrong.`;
    const next = out.stillWrong > 0
      ? `Next: add a note in Challenged tags notes on the claims in Agent disagreed (${viewLink(ctx.config, 'agent_disagreed')}).`
      : (ctx.demo ? 'Next: nothing; the demo is complete.' : 'Next: type /claim-tagger status to see what is open.');
    return {
      exit: EXIT.OK, sentence, header, rows: shown, next, details: { results: out.results, fixed: out.fixed, stillWrong: out.stillWrong, lesson: lesson.Lesson },
      counts: { fixed: out.fixed, still_wrong: out.stillWrong, claims_updated: out.claimUpdates },
    };
  });
}

// ---- the command line ----------------------------------------------------------------------------------------------------------------

const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Parse the command line and run; returns the exit code. deps (tests): everything followup() takes besides the flags. */
export async function main(argv, io = consoleIo, deps = {}) {
  const parsed = parseCli('followup', argv, {
    lesson: { type: 'string' }, pull: { type: 'string' }, 'run-id': { type: 'string' }, 'runs-max': { type: 'string' }, 'plan-only': { type: 'boolean' },
  }, USAGE, io);
  if (parsed.exit !== undefined) return parsed.exit;
  const v = parsed.values;
  if (v['runs-max'] !== undefined && !/^[1-3]$/.test(v['runs-max'])) {
    io.err(`followup: --runs-max needs a whole number from 1 to 3, got "${v['runs-max']}"\n${USAGE}`);
    return EXIT.INVALID;
  }
  try {
    return (await followup({
      ...deps, io, lesson: v.lesson, pull: v.pull, planOnly: v['plan-only'] === true, driver: v.driver ?? deps.driver, runId: v['run-id'], runsMax: v['runs-max'] ? Number(v['runs-max']) : deps.runsMax,
    })).exit;
  } catch (e) {
    io.err(`followup: unexpected error: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
