#!/usr/bin/env node
// Promote: the safety check of an approved rule change, and, when it passes, the change itself. The only way a rule changes.
//
//   node agents/claim-tagger-mvp/scripts/promote.mjs [--lesson "<title>"] [--pull <pull-id>] [--driver cli|fake] [--run-id <id>] [--no-commit] [--runs-max <n>]
//
//   --lesson       the title of the rule change; it must be Approved. Without it: the only Approved rule change (two or more: exit 2, naming them)
//   --pull         use that pull instead of pulling every table first
//   --no-commit    do not commit the rubric folder after a PASS (production commits by itself; a practice profile never does)
//   --runs-max     at most this many reads per item (1 to 3, default judge.runs_max)
//
// The check (CONTRACTS section 14, decision 17). The candidate rulebook is the one in force with that one rule's text replaced by the Editor wording when
// there is one, else the Proposed text. Its items are the examples (evals/canaries.jsonl, each with the answer it must get) and the earlier decisions
// (evals/cases.jsonl, which include the rows the lesson rests on). Both rulebooks answer every item (judge() with items eval: the baseline is mostly cache
// hits); each item whose answer differs between them is read gate.default.flip_rejudge_runs more times on each side and each side's answer is the majority of its
// three reads. PASS when every example comes out as expected under the candidate, no earlier decision that was right under the rulebook in force is wrong
// under the candidate, and every supporting row comes out as the editor decided. FAIL otherwise. HOLD when there is nothing to check against. The card
// (runs/<run-id>/card.json and card.md) holds the figures.
//
// PASS, in two steps, because a failed write does not stop the ones after it: first the new text is written to the Rulebook copy (When to use, after a last look at
// the row and the rule change in Notion) in the plan of this run, and read back; then the new edition is saved (rubric/, with a changelog line) and, in production,
// committed; only then does a run of its own (runs/<run-id>-record) set the rule change Live with "PASS: examples a/a, earlier b/b, yours c/c" and give Agent settings
// the new edition and "Promote · <date time> · PASS"; then follow-up runs by itself (runs/<run-id>-followup). If the second step fails the rule is live, the report
// says so, and the same command finishes the job without a second edition.
// FAIL: the rulebook does not change; the rule change gets "FAIL: '<claim>' now <answer>" and Agent settings the summary. Editor wording is the whole rule, so
// the editor is handed the whole text: one sentence is asked from the distill model for the first claim that came out wrong (an example claim, an earlier
// decision or one of the editor's own rows, whichever it is), and the report's Next line and card.md give the rule as it was tested, a space and that sentence.
// Both go into the report and card.md only, never into Notion. HOLD writes the same two rows.
//
// The lock runs/PROMOTING.json { run_id, lesson, phase } is taken at the start and removed on every exit; one younger than two hours from another run
// refuses the command (exit 2).
//
// Exit codes: 0 PASS, 10 HOLD, 11 FAIL, 1 stopped (the same command continues), 2 invalid (the lesson is not Approved, the lock is taken, a refused plan),
// 3 paused, 4 drift or another model, 75 usage window.
//
// Exports: promote, evaluate, candidateTextOf, takePromoteLock, releasePromoteLock, askForWording, cardMarkdown, main, USAGE, LOCK_STALE_MS.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EXIT } from './lib/exit-codes.mjs';
import { groupOf } from './lib/config.mjs';
import { answerWord, cutText, plural, practiceLink, quoted, quotedWhole, stampOf, viewLink, yourClaims } from './lib/editor-words.mjs';
import { extractJson } from './lib/claude.mjs';
import { forceRuns, readAnswers } from './lib/answers.mjs';
import { readJson, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import {
  LOCK_STALE_MS, LoopExit, addSettingsOp, addUsage, applyInChild, applyStep, assertApplied, callModel, childRun, closeChild, commitRubric, confirmUnchanged, liveRubric, needTables, parseCli, pickLesson, readEvals, resumeLine,
  runJudge, runPreflight, supportingKeysOf, takePull, withRun,
} from './lib/loop.mjs';
import { codeFile, isMain } from './lib/paths.mjs';
import { newPlan, readLedger } from './lib/plan.mjs';
import { nextEdition, writeEdition } from './lib/rubric.mjs';
import { RuleEditError, oneLineRule, ruleNumberOf, rubricWithRule } from './lib/rulebook-edit.mjs';
import { validate } from './lib/validate.mjs';
import { claimWaits } from './lib/decisions.mjs';
import { followUp } from './followup.mjs';
import { selectItems } from './judge.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/promote.mjs [--lesson "<title>"] [--pull <pull-id>] [--driver cli|fake] [--run-id <id>] [--no-commit] [--runs-max <n>]';
export { LOCK_STALE_MS };

const ENGINEER = 'Next: ask the engineer to look at the message the script printed.';
const SENTENCE_MAX_WORDS = 30;
const CHECK_HEADER = ['Check', 'Result', ''];

// ---- the lock ---------------------------------------------------------------------------------------------------------------------------

const lockPath = (root) => join(root, 'runs', 'PROMOTING.json');

/** Take runs/PROMOTING.json exclusively. A lock of this run is kept; one younger than two hours from another run refuses the command; an older one is taken over. */
export function takePromoteLock(ctx, lesson) {
  const file = lockPath(ctx.root);
  mkdirSync(dirname(file), { recursive: true });
  const body = `${JSON.stringify({ run_id: ctx.runId, lesson, phase: 'judging', since: ctx.now().toISOString() })}\n`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(file, body, { flag: 'wx' });
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let held = {};
    let born = Number.NaN;
    try {
      held = JSON.parse(readFileSync(file, 'utf8')) ?? {};
      born = Date.parse(held.since);
      if (!Number.isFinite(born)) born = statSync(file).mtimeMs;
    } catch {
      continue; // gone while we looked, or not readable: try to take it again
    }
    if (held.run_id === ctx.runId) return;
    const age = ctx.now().getTime() - born;
    if (age >= LOCK_STALE_MS) {
      rmSync(file, { force: true });
      continue;
    }
    throw new LoopExit(EXIT.INVALID, `${file} is held by the run ${held.run_id ?? '(unknown)'} for ${held.lesson ?? 'another lesson'}`, {
      sentence: 'Promote: nothing was checked, because a safety check is already running.',
      next: 'Next: wait for it to finish, then type /claim-tagger promote again.',
    });
  }
  throw new LoopExit(EXIT.ERROR, 'could not take the promote lock: another process keeps creating it', { sentence: 'Promote: nothing was checked, because a safety check is already running.', next: 'Next: wait for it to finish, then type /claim-tagger promote again.' });
}

export function setPromotePhase(ctx, phase) {
  const file = lockPath(ctx.root);
  try {
    const held = JSON.parse(readFileSync(file, 'utf8'));
    if (held.run_id === ctx.runId) writeFileSync(file, `${JSON.stringify({ ...held, phase })}\n`);
  } catch {
    // the lock is gone: nothing to update
  }
}

/** Remove the lock when it is this run's (or cannot be read); another run's lock is left alone. */
export function releasePromoteLock(ctx) {
  const file = lockPath(ctx.root);
  try {
    const held = JSON.parse(readFileSync(file, 'utf8'));
    if (held.run_id !== ctx.runId) return;
  } catch {
    // an unreadable lock has no owner to protect
  }
  rmSync(file, { force: true });
}

// ---- the text and the verdict --------------------------------------------------------------------------------------------------------------

/** The text the check tests: the Editor wording when there is one, else the Proposed text, as one line without numbering. */
export function candidateTextOf(lesson) {
  const wording = oneLineRule(lesson['Editor wording'] ?? '');
  return wording !== '' ? { text: wording, fromEditor: true } : { text: oneLineRule(lesson['Proposed text'] ?? ''), fromEditor: false };
}

const verdictWords = (n, total) => (total === 0 ? 'none yet' : `${n} of ${total}`);

/**
 * The verdict over the answers of the two rulebooks. canaries, earlier and yours are lists of { id, claim, expected (apply | do_not_apply) }; base and cand map an id to
 * { decision }. Returns { verdict (PASS | FAIL), checks (the card's shape), first (the first failing item with .got and .was, or null) }.
 *   canaries  every one must come out as expected under the candidate
 *   earlier   those that were right under the rulebook in force must still be right (the ones that were wrong before are not counted)
 *   yours     the rows the lesson rests on: every one must come out as the editor decided
 */
export function evaluate({ canaries, earlier, yours, base, cand }) {
  const answer = (ans, m) => ans.get(m.id)?.decision ?? null;
  const miss = (m, extra = {}) => ({ id: m.key ?? m.id, claim: m.claim, expected: m.expected, got: answer(cand, m), was: answer(base, m), ...extra });
  const canaryFailures = canaries.filter((m) => answer(cand, m) !== m.expected).map((m) => miss(m));
  const wasRight = earlier.filter((m) => answer(base, m) === m.expected);
  const newly = wasRight.filter((m) => answer(cand, m) !== m.expected).map((m) => miss(m));
  const yoursFailures = yours.filter((m) => answer(cand, m) !== m.expected).map((m) => miss(m));
  const checks = {
    canaries: { passed: canaries.length - canaryFailures.length, total: canaries.length, failures: canaryFailures },
    cases: { passed: wasRight.length - newly.length, total: wasRight.length, newly_failing: newly },
    supporting: { passed: yours.length - yoursFailures.length, total: yours.length, failures: yoursFailures },
  };
  const first = canaryFailures[0] ?? newly[0] ?? yoursFailures[0] ?? null;
  return { verdict: first ? 'FAIL' : 'PASS', checks, first };
}

const resultLine = (checks) => `examples ${checks.canaries.passed}/${checks.canaries.total}, earlier ${checks.cases.passed}/${checks.cases.total}, yours ${checks.supporting.passed}/${checks.supporting.total}`;

// ---- the card -----------------------------------------------------------------------------------------------------------------------------

const cleanMiss = ({ id, claim, expected, got }) => ({ id, claim, expected, got });

/**
 * card.md: the same figures as card.json for the engineer, in plain words. The sentence for Editor wording (FAIL only) and the whole text the report hands the
 * editor for Editor wording (`wholeText`: the rule as it was tested, a space, the sentence) are here and in the report, never in Notion.
 */
export function cardMarkdown(card, { sentence = null, wholeText = null, ruleLabel = '', nowWording = false } = {}) {
  const c = card.checks;
  const line = (name, passed, total, what) => `| ${name} | ${verdictWords(passed, total)} ${what} |`;
  const out = [
    `# Safety check: ${card.lesson ?? ''}`,
    '',
    `Verdict: ${card.verdict}${ruleLabel ? ` for ${ruleLabel}` : ''}. Rulebook in force: ${card.editions.baseline}; tested: ${card.editions.candidate}${nowWording ? ' (with the Editor wording)' : ''}.`,
    '',
    '| Check | Result |',
    '|---|---|',
    line('Example claims', c.canaries.passed, c.canaries.total, 'right'),
    line('Earlier decisions', c.cases.passed, c.cases.total, 'still right'),
    line('Rows this rests on', c.supporting.passed, c.supporting.total, 'now right'),
  ];
  const list = (title, items) => {
    if (!items.length) return;
    out.push('', title);
    for (const m of items) out.push(`- "${cutText(m.claim, 80).replace(/"/g, "'")}": expected ${answerWord(m.expected)}, now ${answerWord(m.got)}`);
  };
  list('Example claims that came out wrong:', c.canaries.failures);
  list('Earlier decisions that broke:', c.cases.newly_failing);
  list('Rows this rests on that are still wrong:', c.supporting.failures);
  if (card.flips.length) {
    out.push('', 'Answers that changed between the two rulebooks:');
    for (const f of card.flips) out.push(`- "${cutText(f.claim ?? f.id, 80).replace(/"/g, "'")}": ${answerWord(f.from)} to ${answerWord(f.to)}`);
  }
  if (sentence) out.push('', `Suggested sentence for Editor wording: "${sentence}"`);
  if (sentence && wholeText) out.push(`Whole text for Editor wording (the rule as it was tested, a space, the sentence): "${wholeText}"`);
  return `${out.join('\n')}\n`;
}

// ---- the wording sentence (FAIL) -----------------------------------------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');

/**
 * One sentence of at most 30 words that could be added to the rule so that the failing claim keeps its answer, from the distill model (prompts/wording.md).
 * The claim goes in a <claim> block as data. Returns { sentence } or { sentence: null, why }; it never throws for a call that cannot run, because the verdict
 * stands without it and the report says the sentence could not be written.
 */
export async function askForWording(ctx, { tag, n, current, proposed, claim, expected }) {
  const cfg = ctx.config.distill;
  const prompt = [
    `<rule>${esc(tag)} rule ${n}</rule>`,
    `<current_text>${esc(current)}</current_text>`,
    `<proposed_text>${esc(proposed)}</proposed_text>`,
    `<claim answer="${attr(answerWord(expected))}">${esc(claim)}</claim>`,
  ].join('\n');
  let why = 'the model did not answer';
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await callModel(ctx, { model: ctx.config.models.distill, systemPromptFile: codeFile(ctx.root, cfg.wording_prompt), prompt, effort: cfg.effort, timeoutMs: cfg.timeout_ms });
    } catch (e) {
      return { sentence: null, why: e.message };
    }
    if (res.errorKind) {
      why = `${res.errorKind}: ${res.message}`;
      if (['usage_window', 'spawn', 'model_mismatch'].includes(res.errorKind)) break;
      continue;
    }
    let value;
    try {
      value = extractJson(res.text);
    } catch (e) {
      why = `the reply is not valid JSON (${e.message})`;
      continue;
    }
    const sentence = String(value?.sentence ?? '').replace(/\s+/g, ' ').replace(/["“”]/g, "'").trim().replace(/^'+|'+$/g, '').trim();
    const count = sentence.split(' ').filter(Boolean).length;
    if (sentence === '') {
      why = 'the reply has no sentence';
      continue;
    }
    if (count > SENTENCE_MAX_WORDS) {
      why = `the sentence has ${count} words, more than ${SENTENCE_MAX_WORDS}`;
      continue;
    }
    return { sentence };
  }
  return { sentence: null, why };
}

// ---- the run -----------------------------------------------------------------------------------------------------------------------------------

const rowsWord =(n) => (n === 1 ? 'your row' : (n === 2 ? 'both of your rows' : `all ${n} of your rows`));

/** Run promote. opts: lesson, pull, driver, runId, runsMax, noCommit, git and the hooks of the other scripts (root, config, io, now, fetchImpl, token, sleep, fakeScript, fakeState, env). */
export async function promote(opts = {}) {
  return withRun({
    script: 'promote', label: 'Promote', again: '/claim-tagger promote', opts,
    args: { lesson: opts.lesson ?? null, pull: opts.pull ?? null, driver: opts.driver ?? 'cli', runs_max: opts.runsMax ?? null, no_commit: opts.noCommit === true },
    resume: resumeLine('promote', [...(opts.lesson ? ['--lesson', opts.lesson] : []), ...(opts.driver === 'fake' ? ['--driver', 'fake'] : [])]),
  }, async (ctx) => {
    await takePull(ctx);
    needTables(ctx, 'rulebook', 'rule_changes', 'tag_decisions', 'claims_copy');
    runPreflight(ctx);
    const live = liveRubric(ctx);
    const lesson = pickLesson(ctx, opts.lesson, { status: 'Approved', command: '/claim-tagger promote' });
    const title = lesson.Lesson;
    ctx.record.lesson = title;
    const link = viewLink(ctx.config, 'lessons_waiting');

    // what the lesson is about
    const tag = lesson.Tag;
    const n = ruleNumberOf(lesson.Rule);
    const tagInfo = live.tags.find((t) => t.name === tag);
    if (lesson.Kind === 'Initial rules' || n === null) {
      throw new LoopExit(EXIT.INVALID, `the lesson "${title}" is of kind ${lesson.Kind} for ${lesson.Rule}`, {
        sentence: `Promote: nothing was checked, because ${quoted(title)} is not a change to one numbered rule.`, next: ENGINEER,
      });
    }
    if (!tagInfo || !tagInfo.judged || groupOf(ctx.config, tag) === null || !tagInfo.rules.some((r) => r.n === n)) {
      throw new LoopExit(EXIT.INVALID, `${tag} rule ${n} is not a rule that is judged`, {
        sentence: `Promote: nothing was checked, because ${tag} rule ${n} is not a rule the agent judges by.`, next: ENGINEER,
      });
    }
    const liveText = tagInfo.rules.find((r) => r.n === n).text;
    const { text: candidateText, fromEditor } = candidateTextOf(lesson);
    if (candidateText === '') {
      throw new LoopExit(EXIT.INVALID, `the lesson "${title}" has no text to test`, { sentence: `Promote: nothing was checked, because ${quoted(title)} has no text.`, next: `Next: write the rule in Editor wording in Lessons waiting (${link}).` });
    }
    const was = oneLineRule(lesson['Current text'] ?? '');
    if (was !== '' && was !== liveText && candidateText !== liveText) {
      throw new LoopExit(EXIT.INVALID, `rule ${n} of ${tag} reads differently now than when "${title}" was drafted`, {
        sentence: `Promote: nothing was checked, because rule ${n} of ${tag} has changed since ${quoted(title)} was drafted.`,
        next: 'Next: type /claim-tagger distill to draft the change again.',
      });
    }

    // the candidate rulebook
    const candidateEdition = nextEdition(live.edition, ctx.now());
    let built;
    try {
      built = rubricWithRule(live, tag, n, candidateText, { config: ctx.config, edition: candidateEdition, now: ctx.now });
    } catch (e) {
      if (e instanceof RuleEditError) throw new LoopExit(EXIT.INVALID, e.message, { sentence: `Promote: nothing was checked, because rule ${n} of ${tag} could not be replaced in the rulebook text.`, next: ENGINEER });
      throw e;
    }
    const candidate = built.rubric;
    const inForce = candidate.rubric_hash === live.rubric_hash;
    const candidateFile = join(ctx.runDir, 'candidate-rubric.json');
    writeJsonAtomic(candidateFile, candidate);

    // the items
    const keys = await supportingKeysOf(ctx, lesson);
    const evals = readEvals(ctx.root);
    const canaries = evals.canaries.filter((c) => c.tag === tag);
    const decided = evals.cases.filter((c) => c.tag === tag);
    const missingRows = keys.filter((k) => !decided.some((c) => c.key === k));
    if (missingRows.length) {
      throw new LoopExit(EXIT.INVALID, `no earlier decision for the supporting rows: ${missingRows.join(', ')}`, {
        sentence: `Promote: nothing was checked, because ${missingRows.length === 1 ? 'a row' : `${missingRows.length} rows`} ${quoted(title)} rests on ${missingRows.length === 1 ? 'is' : 'are'} not decided any more.`,
        next: 'Next: type /claim-tagger distill to draft the change again.',
      });
    }
    const supporting = new Set(keys);
    const yours = decided.filter((c) => supporting.has(c.key));
    const earlier = decided.filter((c) => !supporting.has(c.key));
    const everyItem = [...canaries, ...earlier, ...yours];

    takePromoteLock(ctx, title);
    try {
      return await check();
    } finally {
      releasePromoteLock(ctx);
    }

    // eslint-disable-next-line no-inner-declarations
    async function check() {
      const settingsWord = (v) => `Promote · ${stampOf(ctx.now())} · ${v}`;
      const usage = { input: 0, cache_write: 0, cache_read: 0, output: 0 };
      const addRunUsage = (res) => {
        try {
          addUsage(usage, readJson(join(res.runDir, 'run.json')).usage ?? {});
        } catch {
          // a judge run without a record adds nothing
        }
      };
      let checks;
      let verdict;
      let first = null;
      let flips = [];
      let rejudged = 0;
      if (everyItem.length === 0) {
        verdict = 'HOLD';
        checks = { canaries: { passed: 0, total: 0, failures: [] }, cases: { passed: 0, total: 0, newly_failing: [] }, supporting: { passed: 0, total: 0, failures: [] } };
      } else {
        const jc = ctx.opts.runsMax ? { runsMax: ctx.opts.runsMax } : {};
        const base = await runJudge(ctx, { items: 'eval', tags: [tag], runId: `${ctx.runId}-baseline`, ...jc });
        addRunUsage(base);
        const cand = await runJudge(ctx, { items: 'eval', tags: [tag], rubric: candidateFile, runId: `${ctx.runId}-candidate`, ...jc });
        addRunUsage(cand);
        const ids = new Set(everyItem.map((m) => m.id));
        const items = selectItems({ root: ctx.root, items: 'eval' }).items.filter((it) => ids.has(it.id));
        let baseAns = readAnswers(ctx, live, tag, items);
        let candAns = readAnswers(ctx, candidate, tag, items);
        const flipped = items.filter((it) => baseAns.get(it.id).decision !== candAns.get(it.id).decision);
        const extra = ctx.config.gate?.default?.flip_rejudge_runs ?? 2;
        if (flipped.length && extra > 0) {
          const upTo = Math.min(3, 1 + extra);
          addUsage(usage, (await forceRuns(ctx, { rubric: live, tag, items: flipped, upTo })).usage);
          addUsage(usage, (await forceRuns(ctx, { rubric: candidate, tag, items: flipped, upTo })).usage);
          baseAns = readAnswers(ctx, live, tag, items);
          candAns = readAnswers(ctx, candidate, tag, items);
          rejudged = flipped.length;
        }
        const byId = new Map(everyItem.map((m) => [m.id, m]));
        flips = items.filter((it) => baseAns.get(it.id).decision !== candAns.get(it.id).decision).map((it) => ({
          id: byId.get(it.id).key ?? it.id, tag, claim: byId.get(it.id).claim, from: baseAns.get(it.id).decision ?? 'none', to: candAns.get(it.id).decision ?? 'none',
        }));
        ({ verdict, checks, first } = evaluate({ canaries, earlier, yours, base: baseAns, cand: candAns }));
      }
      setPromotePhase(ctx, 'planned');

      const card = {
        mode: 'simple', verdict, lesson: title, tag, checks: {
          canaries: { ...checks.canaries, failures: checks.canaries.failures.map(cleanMiss) },
          cases: { ...checks.cases, newly_failing: checks.cases.newly_failing.map(cleanMiss) },
          supporting: { ...checks.supporting, failures: checks.supporting.failures.map(cleanMiss) },
        },
        flips, editions: { baseline: live.edition, candidate: candidateEdition }, usage, rejudged,
      };
      const problems = validate(readJson(codeFile(ctx.root, 'schemas', 'card.schema.json')), card).errors;
      if (problems.length) throw new LoopExit(EXIT.INVALID, `the card is not valid: ${problems.slice(0, 3).join('; ')}`, { sentence: 'Promote: nothing was written, because the card of the check is not valid.', next: ENGINEER });
      writeJsonAtomic(join(ctx.runDir, 'card.json'), card);
      ctx.record.verdict = verdict;
      ctx.record.card = { examples: checks.canaries, earlier: checks.cases.total, yours: checks.supporting.total };

      const several = live.tags.filter((t) => t.judged && groupOf(ctx.config, t.name) !== null).length > 1;
      const ruleLabel = several ? `${tag} rule ${n}` : `rule ${n}`; // one judged tag: "rule 4" is clear
      const rowsFor = (yoursNote) => [
        ['Example claims', `${verdictWords(checks.canaries.passed, checks.canaries.total)} right`, ''],
        ['Earlier decisions', `${verdictWords(checks.cases.passed, checks.cases.total)} still right`, ''],
        [`Your ${plural(checks.supporting.total, 'row')}`, `${verdictWords(checks.supporting.passed, checks.supporting.total)} now right${yoursNote}`, ''],
      ];

      // ---- HOLD
      if (verdict === 'HOLD') {
        writeTextAtomic(join(ctx.runDir, 'card.md'), cardMarkdown(card, { ruleLabel }));
        const plan = newPlan({ runId: ctx.runId, script: 'promote', rubricEdition: live.edition, config: ctx.config, now: ctx.now });
        plan.update('rule_changes', title, lesson.page_id, { 'Safety check result': 'HOLD: there is nothing to check the change against yet' });
        addSettingsOp(ctx, plan, settingsWord('HOLD'), live.edition);
        const { result } = await applyStep(ctx, plan);
        assertApplied(ctx, result);
        return {
          exit: EXIT.HOLD,
          sentence: `Promote: HOLD, ${ruleLabel} is unchanged: there are no example claims or earlier decisions to check ${quoted(title)} against yet.`,
          rows: [],
          next: 'Next: ask the engineer to set up the example claims, then type /claim-tagger promote again.',
          details: { verdict, card },
        };
      }

      // ---- FAIL
      if (verdict === 'FAIL') {
        // for the first claim that came out wrong, whatever kind it is: an example claim, an earlier decision or one of the editor's own rows
        const asked = await askForWording(ctx, { tag, n, current: liveText, proposed: candidateText, claim: first.claim, expected: first.expected });
        const wholeText = asked.sentence === null ? null : `${candidateText} ${asked.sentence}`; // Editor wording is the whole rule: the rule as tested, then the sentence
        writeTextAtomic(join(ctx.runDir, 'card.md'), cardMarkdown(card, { sentence: asked.sentence, wholeText, ruleLabel, nowWording: fromEditor }));
        if (asked.sentence === null) ctx.record.wording_failed = asked.why;
        const result = `FAIL: '${cutText(first.claim, 60)}' now ${answerWord(first.got)}`;
        const plan = newPlan({ runId: ctx.runId, script: 'promote', rubricEdition: live.edition, config: ctx.config, now: ctx.now });
        plan.update('rule_changes', title, lesson.page_id, { 'Safety check result': result });
        addSettingsOp(ctx, plan, settingsWord('FAIL'), live.edition);
        const applied = await applyStep(ctx, plan);
        assertApplied(ctx, applied.result);
        const changed = first.was !== first.got;
        const what = changed ? `the new wording turns ${quoted(first.claim)} to ${answerWord(first.got)}` : `the new wording leaves ${quoted(first.claim)} at ${answerWord(first.got)}`;
        return {
          exit: EXIT.FAIL,
          sentence: `Promote: FAIL, ${ruleLabel} is unchanged: ${what}${asked.sentence === null ? '; a suggested sentence could not be written' : ''}.`,
          header: CHECK_HEADER,
          rows: rowsFor(''),
          next: asked.sentence === null
            ? `Next: in Lessons waiting (${link}), open the change and write all of ${ruleLabel} in Editor wording so that ${quoted(first.claim)} keeps its answer; then type /claim-tagger promote again.`
            : `Next: in Lessons waiting (${link}), open the change and put this whole text into Editor wording: ${quotedWhole(wholeText)}; then type /claim-tagger promote again.`,
          details: { verdict, card, sentence: asked.sentence, text: wholeText, first },
        };
      }

      // ---- PASS
      writeTextAtomic(join(ctx.runDir, 'card.md'), cardMarkdown(card, { ruleLabel, nowWording: fromEditor }));
      const newEdition = inForce ? live.edition : candidateEdition;
      const copy = (ctx.pull.rulebook() ?? []).find((r) => r.Name === tag);
      await confirmUnchanged(ctx, { lesson, copy: inForce ? null : copy, tag, status: 'Approved' });

      // 1. the Rulebook copy: the one write that changes what is in force. It is applied and read back before anything else is written, because applyPlan goes on
      //    after a failed write, and a rule change marked Live over an old rulebook text would have no way back. Then the new edition is saved, and committed.
      if (!inForce) {
        if (!copy?.page_id) {
          throw new LoopExit(EXIT.INVALID, `the Rulebook copy has no row for ${tag}`, { sentence: `Promote: nothing was written, because the Rulebook copy has no row for ${tag}.`, next: ENGINEER });
        }
        const first = newPlan({ runId: ctx.runId, script: 'promote', rubricEdition: live.edition, config: ctx.config, now: ctx.now });
        first.update('rulebook', tag, copy.page_id, { 'When to use': built.whenToUse }, { expect: { 'When to use': copy['When to use'] ?? '' } });
        const written = await applyStep(ctx, first);
        const line = readLedger(ctx.runDir).get(0);
        if (line?.status === 'skipped') {
          throw new LoopExit(EXIT.DRIFT, `the Rulebook copy's When to use for ${tag} no longer reads as it did when the check started`, {
            sentence: 'Promote: nothing was changed, because the rulebook text in Notion was edited while the check ran.',
            next: `Next: put the rulebook text back on ${tag} (${viewLink(ctx.config, 'rulebook')}), or ask the engineer to restore an edition.`,
          });
        }
        assertApplied(ctx, written.result);
        if (!(line?.status === 'done' && line.read_back === 'ok')) {
          throw new LoopExit(EXIT.ERROR, `the write to the Rulebook copy for ${tag} was not confirmed by the read-back`, { sentence: 'Promote stopped before the rulebook text was written to Notion.', next: 'Next: type /claim-tagger promote again; it continues where it stopped.' });
        }
        writeEdition(ctx.root, candidate, { reason: `lesson ${title} PASS` });
        ctx.record.rubric_edition = newEdition;
        commitRubric(ctx, `rulebook edition ${newEdition}: ${title}`);
      }

      // 2. the rule change is set Live with its figures, and Agent settings follow
      try {
        const recorded = await applyInChild(ctx, 'record', (child) => {
          const plan = newPlan({ runId: child.runId, script: 'promote', rubricEdition: newEdition, config: ctx.config, now: ctx.now });
          plan.update('rule_changes', title, lesson.page_id, { Status: 'Live', 'Safety check result': `PASS: ${resultLine(checks)}` }, { expect: { Status: 'Approved' } });
          addSettingsOp(child, plan, settingsWord('PASS'), newEdition);
          return plan;
        });
        if (recorded.result?.skipped > 0) {
          throw new LoopExit(EXIT.ERROR, `a row changed in Notion while the check ran: ${recorded.result.lists.skipped.map((s) => `${s.table} "${s.key}" ${s.detail ?? ''}`).join('; ')}`, {
            sentence: `Promote stopped: ${quoted(title)} was changed in Notion while it was checked.`, next: 'Next: type /claim-tagger promote again.',
          });
        }
      } catch (e) {
        if (e instanceof LoopExit && e.code === EXIT.ERROR && !inForce) {
          throw new LoopExit(EXIT.ERROR, e.message, { sentence: `Promote stopped: ${ruleLabel} is live (edition ${newEdition}), but ${quoted(title)} could not be marked Live in Notion.`, next: 'Next: type /claim-tagger promote again; it finishes the job.' });
        }
        throw e;
      }
      setPromotePhase(ctx, 'finalized');

      // the follow-up, by itself, in its own folder
      const child = childRun(ctx, 'followup', { script: 'followup', label: 'Follow-up' });
      child.again = '/claim-tagger follow-up';
      let fu = null;
      let fuProblem = null;
      try {
        fu = await followUp(child, { tag, keys, rubric: candidate, summary: false });
        closeChild(child, EXIT.OK);
      } catch (e) {
        if (!(e instanceof LoopExit)) throw e;
        fuProblem = e;
        closeChild(child, e.code, { message: e.message });
      }
      const phrase = fromEditor ? 'your approved wording' : 'the new wording';
      const head = `Promote: PASS, ${ruleLabel} now uses ${phrase} (edition ${newEdition})`;
      if (fuProblem) {
        return {
          exit: EXIT.ERROR,
          sentence: `${head}, but the follow-up could not finish.`,
          header: CHECK_HEADER,
          rows: rowsFor(''),
          next: 'Next: type /claim-tagger follow-up to repeat it.',
          message: fuProblem.message,
          details: { verdict, card, edition: newEdition },
        };
      }
      const marks = fu.stillWrong === 0
        ? `marked ${rowsWord(fu.results.length)} Fixed`
        : `marked ${fu.fixed} of your ${plural(fu.results.length, 'row')} Fixed and ${fu.stillWrong} Still wrong`;
      const open = (ctx.pull.claims() ?? []).filter((c) => claimWaits(c)).length;
      const sitting = ctx.config.queue?.sitting_rows ?? 20;
      let next;
      if (ctx.demo) next = `Next: look at step 7 on the practice page (${practiceLink(ctx.config)}); the demo is then complete.`;
      else if (open === 0) next = 'Next: nothing waits; type /claim-tagger status to see what is open.';
      else if (open > sitting) next = `Next: start at the top of Your queue (${viewLink(ctx.config, 'your_queue')}).`;
      else next = `Next: decide ${yourClaims(open)} in Your queue (${viewLink(ctx.config, 'your_queue')}).`;
      return {
        exit: EXIT.OK,
        sentence: `${head}, and the follow-up ${marks}.`,
        header: CHECK_HEADER,
        rows: rowsFor(fu.stillWrong === 0 ? ', marked Fixed' : `, ${fu.fixed} marked Fixed`),
        next,
        details: { verdict, card, edition: newEdition, followUp: fu, committed: !inForce },
        counts: { fixed: fu.fixed, still_wrong: fu.stillWrong },
      };
    }
  });
}

// ---- the command line ---------------------------------------------------------------------------------------------------------------------

const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Parse the command line and run; returns the exit code. deps (tests): everything promote() takes besides the flags. */
export async function main(argv, io = consoleIo, deps = {}) {
  const parsed = parseCli('promote', argv, {
    lesson: { type: 'string' }, pull: { type: 'string' }, 'run-id': { type: 'string' }, 'no-commit': { type: 'boolean' }, 'runs-max': { type: 'string' },
  }, USAGE, io);
  if (parsed.exit !== undefined) return parsed.exit;
  const v = parsed.values;
  if (v['runs-max'] !== undefined && !/^[1-3]$/.test(v['runs-max'])) {
    io.err(`promote: --runs-max needs a whole number from 1 to 3, got "${v['runs-max']}"\n${USAGE}`);
    return EXIT.INVALID;
  }
  try {
    return (await promote({
      ...deps, io, lesson: v.lesson, pull: v.pull, driver: v.driver ?? deps.driver, runId: v['run-id'], noCommit: v['no-commit'] === true || deps.noCommit === true,
      runsMax: v['runs-max'] ? Number(v['runs-max']) : deps.runsMax,
    })).exit;
  } catch (e) {
    io.err(`promote: unexpected error: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
