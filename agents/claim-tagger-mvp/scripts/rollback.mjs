#!/usr/bin/env node
// Rollback: put a rule back to the text it had before a rule change went live. The rule change must be Live and the rule must still read as that change left
// it. The restored text is the lesson's Current text (decision 16); the change is recorded as a new edition ("rolled back <title>") and the rule change is
// marked Rolled back. Rollback is ask-gated in .claude/settings.json and needs --confirm besides: without it nothing is changed and the command only says what it
// would do (exit 2).
//
//   node agents/claim-tagger-mvp/scripts/rollback.mjs --lesson "<title>" --confirm [--pull <pull-id>] [--run-id <id>] [--no-commit]
//
// Two steps, because a failed write does not stop the ones after it. First the Rulebook copy's When to use (the one rule's line replaced, the rest as it stands,
// `expect` the text the run started from) in the plan of this run, read back; then the new edition is saved (rubric/, with the changelog line) and, in production,
// committed ("rulebook edition <e>: rolled back <title>"). Then a run of its own (runs/<run-id>-record) sets the rule change's Status to Rolled back (its Safety check
// result stays as it is) and gives Agent settings the edition and "Rollback · <date time> · <title>". A rule that already reads as its earlier text (a rollback that
// stopped between the two steps, run again) only gets the second step.
//
// Exit codes: 0 ok, 1 stopped (the same command continues), 2 invalid (no --confirm, the lesson is not Live, the rule has changed since), 3 paused, 4 drift.
//
// Exports: rollback, main, USAGE.

import { EXIT } from './lib/exit-codes.mjs';
import { quoted, stampOf } from './lib/editor-words.mjs';
import {
  LoopExit, addSettingsOp, applyInChild, applyStep, assertApplied, commitRubric, confirmUnchanged, liveRubric, needTables, parseCli, pickLesson, resumeLine, runPreflight, takePull, withRun,
} from './lib/loop.mjs';
import { isMain } from './lib/paths.mjs';
import { newPlan, readLedger } from './lib/plan.mjs';
import { nextEdition, writeEdition } from './lib/rubric.mjs';
import { RuleEditError, oneLineRule, ruleNumberOf, rubricWithRule } from './lib/rulebook-edit.mjs';
import { candidateTextOf } from './promote.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/rollback.mjs --lesson "<title>" --confirm [--pull <pull-id>] [--run-id <id>] [--no-commit]';
const ENGINEER = 'Next: ask the engineer to look at the message the script printed.';

/** Run rollback. opts: lesson, confirm, pull, runId, noCommit, git and the hooks of the other scripts (root, config, io, now, fetchImpl, token, sleep). */
export async function rollback(opts = {}) {
  return withRun({
    script: 'rollback', label: 'Rollback', again: '/claim-tagger rollback', opts,
    args: { lesson: opts.lesson ?? null, confirm: opts.confirm === true, pull: opts.pull ?? null, no_commit: opts.noCommit === true },
    resume: resumeLine('rollback', ['--lesson', opts.lesson ?? '<title>', '--confirm']),
  }, async (ctx) => {
    if (opts.lesson === undefined || String(opts.lesson).trim() === '') {
      throw new LoopExit(EXIT.INVALID, '--lesson "<title>" is required', { sentence: 'Rollback: nothing was done, because it needs the title of the rule change to roll back.', next: 'Next: type /claim-tagger rollback with the title of the rule change.' });
    }
    await takePull(ctx);
    needTables(ctx, 'rulebook', 'rule_changes');
    runPreflight(ctx);
    const live = liveRubric(ctx);
    const lesson = pickLesson(ctx, opts.lesson, { status: 'Live', command: '/claim-tagger rollback' });
    const title = lesson.Lesson;
    ctx.record.lesson = title;
    const tag = lesson.Tag;
    const n = ruleNumberOf(lesson.Rule);
    const tagInfo = live.tags.find((t) => t.name === tag);
    if (lesson.Kind === 'Initial rules' || n === null || !tagInfo?.rules.some((r) => r.n === n)) {
      throw new LoopExit(EXIT.INVALID, `the lesson "${title}" is of kind ${lesson.Kind} for ${lesson.Rule}`, { sentence: `Rollback: nothing was done, because ${quoted(title)} is not a change to one numbered rule of the rulebook.`, next: ENGINEER });
    }
    const liveText = tagInfo.rules.find((r) => r.n === n).text;
    const put = candidateTextOf(lesson).text;
    const earlier = oneLineRule(lesson['Current text'] ?? '');
    if (earlier === '') {
      throw new LoopExit(EXIT.INVALID, `the lesson "${title}" has no Current text to restore`, { sentence: `Rollback: nothing was done, because ${quoted(title)} does not keep the text the rule had before.`, next: ENGINEER });
    }
    // the rule has to read as the lesson left it, or already as it read before (a rollback that stopped after the rulebook text was written and is run again)
    if (liveText !== earlier && put !== '' && liveText !== put) {
      throw new LoopExit(EXIT.INVALID, `rule ${n} of ${tag} reads differently now than when "${title}" put it live`, {
        sentence: `Rollback: nothing was done, because rule ${n} of ${tag} has changed since ${quoted(title)} went live.`,
        next: 'Next: roll back the later change first.',
      });
    }
    const edition = nextEdition(live.edition, ctx.now());
    let built;
    try {
      built = rubricWithRule(live, tag, n, earlier, { config: ctx.config, edition, now: ctx.now });
    } catch (e) {
      if (e instanceof RuleEditError) throw new LoopExit(EXIT.INVALID, e.message, { sentence: `Rollback: nothing was done, because rule ${n} of ${tag} could not be replaced in the rulebook text.`, next: ENGINEER });
      throw e;
    }
    const alreadyBack = built.rubric.rubric_hash === live.rubric_hash; // nothing to write in the rulebook: only the rule change is marked
    const newEdition = alreadyBack ? live.edition : edition;
    if (opts.confirm !== true) {
      return {
        exit: EXIT.INVALID,
        sentence: alreadyBack
          ? `Rollback: nothing was changed yet; rule ${n} of ${tag} already reads as its earlier text, so this would only mark ${quoted(title)} as rolled back.`
          : `Rollback: nothing was changed yet; this would put rule ${n} of ${tag} back to its earlier text (edition ${edition}) and mark ${quoted(title)} as rolled back.`,
        rows: [['Rule now', quoted(liveText, 80), ''], ['Rule after', quoted(earlier, 80), '']],
        next: 'Next: type the same command with --confirm to put the earlier text back.',
        details: { confirmed: false },
      };
    }

    const copy = (ctx.pull.rulebook() ?? []).find((r) => r.Name === tag);
    if (!alreadyBack && !copy?.page_id) {
      throw new LoopExit(EXIT.INVALID, `the Rulebook copy has no row for ${tag}`, { sentence: `Rollback: nothing was written, because the Rulebook copy has no row for ${tag}.`, next: ENGINEER });
    }
    await confirmUnchanged(ctx, { lesson, copy: alreadyBack ? null : copy, tag, status: 'Live' });

    // 1. the Rulebook copy, applied and read back on its own; then the new edition is saved and committed
    if (!alreadyBack) {
      const first = newPlan({ runId: ctx.runId, script: 'rollback', rubricEdition: live.edition, config: ctx.config, now: ctx.now });
      first.update('rulebook', tag, copy.page_id, { 'When to use': built.whenToUse }, { expect: { 'When to use': copy['When to use'] ?? '' } });
      const written = await applyStep(ctx, first);
      const line = readLedger(ctx.runDir).get(0);
      if (line?.status === 'skipped') {
        throw new LoopExit(EXIT.DRIFT, `the Rulebook copy's When to use for ${tag} no longer reads as it did when the run started`, {
          sentence: 'Rollback: nothing was changed, because the rulebook text in Notion was edited while it ran.', next: 'Next: put the rulebook text back, or ask the engineer to restore an edition.',
        });
      }
      assertApplied(ctx, written.result);
      if (!(line?.status === 'done' && line.read_back === 'ok')) {
        throw new LoopExit(EXIT.ERROR, `the write to the Rulebook copy for ${tag} was not confirmed by the read-back`, { sentence: 'Rollback stopped before the rulebook text was written to Notion.', next: 'Next: type /claim-tagger rollback again with the title; it continues where it stopped.' });
      }
      writeEdition(ctx.root, built.rubric, { reason: `rolled back ${title}` });
      ctx.record.rubric_edition = edition;
      commitRubric(ctx, `rulebook edition ${edition}: rolled back ${title}`);
    }

    // 2. the rule change is marked Rolled back (its Safety check result stays as it is), and Agent settings follow
    try {
      await applyInChild(ctx, 'record', (child) => {
        const plan = newPlan({ runId: child.runId, script: 'rollback', rubricEdition: newEdition, config: ctx.config, now: ctx.now });
        plan.update('rule_changes', title, lesson.page_id, { Status: 'Rolled back' }, { expect: { Status: 'Live' } });
        addSettingsOp(child, plan, `Rollback · ${stampOf(ctx.now())} · ${title}`, newEdition);
        return plan;
      });
    } catch (e) {
      if (e instanceof LoopExit && e.code === EXIT.ERROR && !alreadyBack) {
        throw new LoopExit(EXIT.ERROR, e.message, {
          sentence: `Rollback stopped: rule ${n} of ${tag} is back to its earlier text (edition ${newEdition}), but ${quoted(title)} could not be marked Rolled back in Notion.`,
          next: 'Next: type /claim-tagger rollback again with the title; it finishes the job.',
        });
      }
      throw e;
    }

    return {
      exit: EXIT.OK,
      sentence: `Rollback: rule ${n} of ${tag} is back to its earlier text (edition ${newEdition}).`,
      rows: [['Rule change', `${quoted(title)}, Rolled back`, ''], ['Rulebook', `edition ${newEdition}`, '']],
      next: 'Next: type /claim-tagger status to see what is open.',
      details: { confirmed: true, edition: newEdition, alreadyBack },
    };
  });
}

const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Parse the command line and run; returns the exit code. deps (tests): everything rollback() takes besides the flags. */
export async function main(argv, io = consoleIo, deps = {}) {
  const parsed = parseCli('rollback', argv, {
    lesson: { type: 'string' }, confirm: { type: 'boolean' }, pull: { type: 'string' }, 'run-id': { type: 'string' }, 'no-commit': { type: 'boolean' },
  }, USAGE, io);
  if (parsed.exit !== undefined) return parsed.exit;
  const v = parsed.values;
  try {
    return (await rollback({ ...deps, io, lesson: v.lesson, confirm: v.confirm === true, pull: v.pull, runId: v['run-id'], noCommit: v['no-commit'] === true || deps.noCommit === true })).exit;
  } catch (e) {
    io.err(`rollback: unexpected error: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
