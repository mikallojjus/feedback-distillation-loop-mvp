#!/usr/bin/env node
// Restore: put the rulebook text of an earlier edition back into the Rulebook copy. It is also the answer to a drift stop (exit 4): when somebody has edited the
// When to use of a judged tag in Notion, restoring the edition in force writes the saved text over the edit, so that the next command runs. Ask-gated in
// .claude/settings.json and needs --confirm besides.
//
//   node agents/claim-tagger-mvp/scripts/restore.mjs --list
//   node agents/claim-tagger-mvp/scripts/restore.mjs --edition <edition> --confirm [--pull <pull-id>] [--run-id <id>] [--no-commit]
//
//   --list         print the editions in rubric/history/ with their changelog line, newest last; the edition in force is marked
//   --edition <e>  the edition whose When to use texts are written back; for every tag whose text in the Rulebook copy differs from it, one plan op writes it
//   --confirm      without it nothing is changed and the command only says what it would do (exit 2)
//
// Whenever the restore writes anything (or the rules of that edition differ from the edition in force) a new edition is recorded ("restored from <e>", with the rules
// of <e>), so that the changelog shows it; when nothing differs at all it says so and does nothing. Two steps: the Rulebook copy writes (one plan op per tag) in the plan
// of this run, read back; then the new edition is saved and, in production, committed; then a run of its own (runs/<run-id>-record) gives Agent settings the edition and
// "Restore · <date time> · <e>". A drift in a column other than When to use (Description, Example Claims, Counterpart) is not something this can write, and the report
// says so.
//
// Exit codes: 0 ok, 1 stopped (the same command continues), 2 invalid (no --confirm, no such edition), 3 paused, 4 the rulebook file on disk is not valid.
//
// Exports: restore, listEditions, main, USAGE.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from './lib/exit-codes.mjs';
import { listNames, plural, stampOf, viewLink } from './lib/editor-words.mjs';
import {
  LoopExit, addSettingsOp, applyInChild, applyStep, assertApplied, commitRubric, liveRubric, needTables, parseCli, resumeLine, runPreflight, takePull, withRun,
} from './lib/loop.mjs';
import { normaliseText } from './lib/notion-values.mjs';
import { isMain } from './lib/paths.mjs';
import { newPlan, readLedger } from './lib/plan.mjs';
import { buildRubric, nextEdition, readEdition, writeEdition } from './lib/rubric.mjs';
import { rowFromTag } from './lib/rulebook-edit.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/restore.mjs --list\n       node agents/claim-tagger-mvp/scripts/restore.mjs --edition <edition> --confirm [--pull <pull-id>] [--run-id <id>] [--no-commit]';
const EDITION = /^\d{4}-\d{2}-\d{2}\.\d+$/;
const ENGINEER = 'Next: ask the engineer to look at the message the script printed.';
const sameText = (a, b) => normaliseText(a ?? '') === normaliseText(b ?? '');
const order = (a, b) => {
  const [da, na] = a.split('.');
  const [db, nb] = b.split('.');
  return da < db ? -1 : da > db ? 1 : Number(na) - Number(nb);
};

/** The editions on file, oldest first: [{ edition, reason (the changelog line's text, or null), current }]. */
export function listEditions(root) {
  const dir = join(root, 'rubric', 'history');
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.\d+\.json$/.test(f)).map((f) => f.slice(0, -5)).sort(order) : [];
  const reasons = new Map();
  const log = join(root, 'rubric', 'CHANGELOG.md');
  if (existsSync(log)) {
    for (const line of readFileSync(log, 'utf8').split('\n')) {
      const m = /^- \d{4}-\d{2}-\d{2} · edition (\d{4}-\d{2}-\d{2}\.\d+) · (.*)$/.exec(line.trim());
      if (m) reasons.set(m[1], m[2]);
    }
  }
  let current = null;
  try {
    current = JSON.parse(readFileSync(join(root, 'rubric', 'rubric.json'), 'utf8')).edition;
  } catch {
    current = null;
  }
  return names.map((edition) => ({ edition, reason: reasons.get(edition) ?? null, current: edition === current }));
}

/** Run restore. opts: list, edition, confirm, pull, runId, noCommit, git and the hooks of the other scripts (root, config, io, now, fetchImpl, token, sleep). */
export async function restore(opts = {}) {
  return withRun({
    script: 'restore', label: 'Restore', again: 'the restore command', opts,
    args: { list: opts.list === true, edition: opts.edition ?? null, confirm: opts.confirm === true, pull: opts.pull ?? null, no_commit: opts.noCommit === true },
    resume: opts.list ? resumeLine('restore', ['--list']) : resumeLine('restore', ['--edition', opts.edition ?? '<edition>', '--confirm']),
  }, async (ctx) => {
    if (opts.list) {
      const editions = listEditions(ctx.root);
      const lines = editions.map((e) => `${e.edition}${e.current ? ' (in force)' : ''}  ${e.reason ?? ''}`.trimEnd());
      const last = editions.slice(-5);
      return {
        exit: EXIT.OK,
        sentence: editions.length ? `Restore: ${plural(editions.length, 'edition')} ${editions.length === 1 ? 'is' : 'are'} on file${editions.some((e) => e.current) ? `; edition ${editions.find((e) => e.current).edition} is in force` : ''}.` : 'Restore: no edition is on file yet.',
        header: ['Edition', 'What changed', ''],
        rows: last.map((e) => [e.edition + (e.current ? ' (in force)' : ''), e.reason ?? '', '']),
        next: 'Next: to put one back, run the restore command with --edition and --confirm.',
        print: lines.length ? lines.join('\n') : 'no edition is on file yet',
        details: { editions },
      };
    }
    if (opts.edition === undefined || !EDITION.test(String(opts.edition))) {
      throw new LoopExit(EXIT.INVALID, '--edition <YYYY-MM-DD.n> is required (use --list to see the editions)', {
        sentence: 'Restore: nothing was done, because it needs the edition to put back.', next: 'Next: run the restore command with --list to see the editions.',
      });
    }
    const wanted = String(opts.edition);
    await takePull(ctx);
    needTables(ctx, 'rulebook');
    const pre = runPreflight(ctx, { adopt: false, allowDrift: true });
    const current = liveRubric(ctx);
    let target;
    try {
      target = readEdition(ctx.root, wanted);
    } catch (e) {
      throw new LoopExit(EXIT.DRIFT, e.message, { sentence: `Restore: nothing was done, because the saved edition ${wanted} does not match its own checks.`, next: ENGINEER });
    }
    if (!target) {
      const have = listEditions(ctx.root).map((e) => e.edition);
      throw new LoopExit(EXIT.INVALID, `there is no edition ${wanted} in rubric/history (have: ${have.join(', ') || 'none'})`, {
        sentence: `Restore: nothing was done, because there is no saved edition ${wanted}.`, next: 'Next: run the restore command with --list to see the editions.',
      });
    }

    const rows = new Map((ctx.pull.rulebook() ?? []).map((r) => [r.Name, r]));
    const diffs = [];
    const gone = [];
    for (const t of target.tags) {
      const row = rows.get(t.name);
      if (!row?.page_id) gone.push(t.name);
      else if (!sameText(row['When to use'], t.when_to_use)) diffs.push({ tag: t.name, page_id: row.page_id, now: row['When to use'] ?? '', to: t.when_to_use });
    }
    if (gone.length) ctx.warnings.push(`${listNames(gone)} ${gone.length === 1 ? 'has' : 'have'} no row in the Rulebook copy, so ${gone.length === 1 ? 'its' : 'their'} text was not written`);
    const rulesDiffer = target.rubric_hash !== current.rubric_hash;
    const records = rulesDiffer || diffs.length > 0; // a restore that writes anything is an edition of its own, so that the changelog shows it
    const newEdition = records ? nextEdition(current.edition, ctx.now()) : current.edition;
    ctx.record.restore = { from: wanted, tags: diffs.map((d) => d.tag), new_edition: records ? newEdition : null };

    // columns this cannot write: they stay as they are, and the report says so
    const others = (pre?.stops ?? []).filter((s) => s.column !== 'When to use');
    const otherTags = [...new Set(others.map((s) => s.tag).filter(Boolean))];

    if (!records) {
      return {
        exit: EXIT.OK,
        sentence: `Restore: nothing to put back; the rulebook text in Notion already matches edition ${wanted}${otherTags.length ? `, but the other edits on ${listNames(otherTags)} are still there` : ''}.`,
        rows: [],
        next: otherTags.length
          ? `Next: put the other columns back by hand on ${listNames(otherTags)} (${viewLink(ctx.config, 'rulebook')}).`
          : 'Next: type /claim-tagger status to see what is open.',
        details: { diffs: [], newEdition: null },
      };
    }
    if (opts.confirm !== true) {
      return {
        exit: EXIT.INVALID,
        sentence: `Restore: nothing was changed yet; this would write the text of edition ${wanted} back for ${diffs.length ? listNames(diffs.map((d) => d.tag)) : 'no tag'}${records ? ` and record edition ${newEdition}` : ''}.`,
        rows: [],
        next: 'Next: run the same command with --confirm to do it.',
        details: { confirmed: false, diffs },
      };
    }

    // 1. the Rulebook copy: every tag whose text differs, applied and read back before anything else is written; then the new edition is saved and committed
    if (diffs.length) {
      const first = newPlan({ runId: ctx.runId, script: 'restore', rubricEdition: current.edition, config: ctx.config, now: ctx.now });
      for (const d of diffs) first.update('rulebook', d.tag, d.page_id, { 'When to use': d.to }, { expect: { 'When to use': d.now } });
      const written = await applyStep(ctx, first);
      const ledger = readLedger(ctx.runDir);
      if (first.ops.some((_, i) => ledger.get(i)?.status === 'skipped')) {
        throw new LoopExit(EXIT.DRIFT, 'the Rulebook copy changed while the restore ran', { sentence: 'Restore: nothing more was done, because the rulebook text in Notion was edited while it ran.', next: 'Next: run the same command again.' });
      }
      assertApplied(ctx, written.result, 'the restore command');
      if (!first.ops.every((_, i) => ledger.get(i)?.status === 'done' && ledger.get(i)?.read_back === 'ok')) {
        throw new LoopExit(EXIT.ERROR, 'a write to the Rulebook copy was not confirmed by the read-back', { sentence: 'Restore stopped before every tag was written to Notion.', next: 'Next: run the same command again; it continues where it stopped.' });
      }
    }
    if (records) {
      const rubric = buildRubric(target.tags.map(rowFromTag), { config: ctx.config, edition: newEdition, now: ctx.now });
      writeEdition(ctx.root, rubric, { reason: `restored from ${wanted}` });
      ctx.record.rubric_edition = newEdition;
      commitRubric(ctx, `rulebook edition ${newEdition}: restored from ${wanted}`);
    }

    // 2. Agent settings: the edition in force and the summary
    await applyInChild(ctx, 'record', (child) => {
      const plan = newPlan({ runId: child.runId, script: 'restore', rubricEdition: newEdition, config: ctx.config, now: ctx.now });
      addSettingsOp(child, plan, `Restore · ${stampOf(ctx.now())} · ${wanted}`, newEdition);
      return plan;
    });

    return {
      exit: EXIT.OK,
      sentence: `Restore: the rulebook text of edition ${wanted} is back in Notion (edition ${newEdition})${otherTags.length ? `; the other edits on ${listNames(otherTags)} still have to be put back by hand` : ''}.`,
      rows: [['Tags written', diffs.length ? listNames(diffs.map((d) => d.tag)) : 'none', ''], ['Rulebook', `edition ${newEdition}`, '']],
      next: otherTags.length ? `Next: put the other columns back by hand on ${listNames(otherTags)} (${viewLink(ctx.config, 'rulebook')}).` : 'Next: type /claim-tagger status to see what is open.',
      details: { diffs, edition: newEdition, restoredFrom: wanted },
    };
  });
}

const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Parse the command line and run; returns the exit code. deps (tests): everything restore() takes besides the flags. */
export async function main(argv, io = consoleIo, deps = {}) {
  const parsed = parseCli('restore', argv, {
    list: { type: 'boolean' }, edition: { type: 'string' }, confirm: { type: 'boolean' }, pull: { type: 'string' }, 'run-id': { type: 'string' }, 'no-commit': { type: 'boolean' },
  }, USAGE, io);
  if (parsed.exit !== undefined) return parsed.exit;
  const v = parsed.values;
  if (v.list && (v.edition || v.confirm)) {
    io.err(`restore: --list cannot be combined with --edition or --confirm\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (!v.list && v.edition === undefined) {
    io.err(`restore: give --list, or --edition <edition> --confirm\n${USAGE}`);
    return EXIT.INVALID;
  }
  try {
    return (await restore({ ...deps, io, list: v.list === true, edition: v.edition, confirm: v.confirm === true, pull: v.pull, runId: v['run-id'], noCommit: v['no-commit'] === true || deps.noCommit === true })).exit;
  } catch (e) {
    io.err(`restore: unexpected error: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
