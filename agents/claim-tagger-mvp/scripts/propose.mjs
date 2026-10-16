#!/usr/bin/env node
// Propose: turns what the judge stored for each claim into the three columns the agent fills on the Claims copy (Agent tags, Agent notes, Agent confidence),
// into the agent's ledger (Tag decisions), and, for every claim an editor has Reviewed, into the copy of the editor's decision. It reads the cell store the
// latest judge run filled and writes Notion only by applying a plan it made itself.
//
//   node agents/claim-tagger-mvp/scripts/propose.mjs [--pull <pull-id>] [--plan-only] [--driver cli|fake] [--run-id <id>]
//
//   --pull <id>    use that pull instead of pulling every table first
//   --plan-only    make and check the plan (runs/<run-id>/plan.jsonl) and stop; nothing is sent to Notion
//   --driver       cli (default) or fake: which judge's answers to read (the store key holds the driver; tests use fake)
//   --run-id       name the run folder (default <UTC stamp>-propose)
//
// What a run does (CONTRACTS section 7, CLAIMS-REVIEW.md section 3). For every claim of the pull that the judge has read, for every judged tag, the verdict over
// the claim's reads (majority; unsure when any read was ask_editor or failed, when the reads disagree, or when the mean p is inside the band):
//   Agent proposal    Applies / Does not apply when sure, Can't tell when not
//   Agent confidence  max(p, 1 - p) to two decimals (0.5 is a coin flip)
//   Agent reason      the reason of the last read in at most queue.reason_max_words words, then " · <rule> · <k> of <n> runs agree"
// The plan writes, on every judged claim, Agent tags, Agent notes, Agent confidence (the lowest confidence among the claim's judged tags) and Agent reasons (one line per judged tag, "<Tag>: <the Agent reason of the
// ledger>", so that an editor in Your queue sees why without opening the ledger), only where they differ
// from what the pull holds, and in the ledger a row per judged claim and tag: created when missing, updated when the proposal, the confidence, the reason or the edition
// changed. A claim an editor has Reviewed is decided (lib/decisions.mjs): there the ledger row also gets the copy of the decision (Tag outcome, Why wrong, Your reasoning,
// Decided under), the proposal columns of a row that is decided are never rewritten (they are what the editor saw), and Agent tags are the editor's verified set: a
// proposal that differs from the editor's decision is never applied, and Agent notes says so. Agent tags are, on a claim that is not Reviewed, the tags whose proposal is
// Applies. Agent notes are two lines:
//   line 1  the same tags, or "no tags"
//   line 2  "<n> wait(s) for an editor" or "nothing waits for an editor", " · disagrees with your decision on <tags>" when it does, " · not checked: <counts by kind>"
//           when a tag was not checked, " · edition <e>"
// A claim waits for an editor (Your queue) when a judged tag's proposal is Can't tell and the claim is not Reviewed. The plan ends with the Agent settings row: the
// edition and "Tag · <date time> · <n> claims". Nothing here writes Review status, Claim quality tags — verified, Why wrong or Challenged tags notes of a claim (hard rule 1).
//
// Exit codes: 0 ok, 1 stopped (the same command continues), 2 invalid (nothing read yet, a refused plan, a read-back that differed), 3 paused,
// 4 drift of the rulebook text in Notion.
//
// Exports: propose, cellVerdict, claimColumns, reasonsOfCell, notCheckedParts, tagsOfCell, openClaimCount, main, USAGE.

import { readFileSync } from 'node:fs';
import { compareCodePoints } from './lib/pyjson.mjs';
import { codeFile, isMain } from './lib/paths.mjs';
import { normaliseText } from './lib/notion-values.mjs';
import { newPlan } from './lib/plan.mjs';
import { openStore } from './lib/cells.mjs';
import { tableEntry } from './lib/config.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { claimWaits, decisionChanges, decisionProps, decisionsFor, disagreementsIn, isReviewed } from './lib/decisions.mjs';
import { listNames, plural, reasonLine, stampOf, viewLink } from './lib/editor-words.mjs';
import {
  LoopExit, addSettingsOp, applyStep, assertApplied, judgeSettings, liveRubric, needTables, parseCli, resumeLine, runPreflight, takePull, withRun,
} from './lib/loop.mjs';
import {
  groupsFor, itemHash, readPromptVersion, storeInputsFor, verdictOf,
} from './judge.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/propose.mjs [--pull <pull-id>] [--plan-only] [--driver cli|fake] [--run-id <id>]';

const round2 = (x) => Math.round(x * 100) / 100;
const AGENT_COLUMNS = ['Agent proposal', 'Agent confidence', 'Agent reason', 'Rulebook edition'];
const SURE = new Set(['Applies', 'Does not apply']);

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
    ? reasonLine(last, v.agreed, v.runs, reasonMaxWords)
    : `The agent could not read this claim · 0 of ${Math.max(lines, 1)} runs agree`;
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
 * Agent tags and Agent notes of one claim. `verdicts` maps a judged tag to the agent's current proposal (Applies, Does not apply or Can't tell); a judged tag
 * with no entry was not read in this run and keeps its place in `currentTags` (and, on a Reviewed claim, in `currentDisagrees`). A claim that is not Reviewed
 * (`reviewed` false) gets the tags whose proposal is Applies, and every tag whose proposal is Can't tell waits for an editor. A Reviewed claim gets the editor's
 * set, `verifiedTags`, nothing waits, and every tag whose proposal is sure and differs from the editor's decision is listed after "disagrees with your decision on".
 * `notChecked` is notCheckedParts' text. `reasons` maps a tag to the text of its Agent reason in this run; a judged tag without one keeps its line from
 * `currentReasons` (the pulled Agent reasons, read by reasonsOfCell). Returns { tags: [names], agent_tags, agent_notes, agent_reasons, waits, disagrees: [names] }.
 */
export function claimColumns({
  judgedNames, verdicts = new Map(), reviewed = false, verifiedTags = [], currentTags = [], currentDisagrees = [], notChecked = '', edition, reasons = new Map(), currentReasons = new Map(),
}) {
  const names = [...new Set(judgedNames)].sort(compareCodePoints);
  const tags = [];
  const disagrees = [];
  let waits = 0;
  if (reviewed) {
    tags.push(...[...new Set(verifiedTags)].sort(compareCodePoints));
    for (const tag of names) {
      const proposal = verdicts.get(tag);
      if (SURE.has(proposal)) {
        if ((proposal === 'Applies') !== verifiedTags.includes(tag)) disagrees.push(tag);
      } else if (proposal === undefined && currentDisagrees.includes(tag)) disagrees.push(tag);
    }
  } else {
    for (const tag of names) {
      const proposal = verdicts.get(tag);
      if (proposal === 'Applies') tags.push(tag);
      else if (proposal === undefined) {
        if (currentTags.includes(tag)) tags.push(tag);
      } else if (proposal === "Can't tell") waits += 1;
    }
  }
  const second = [
    waits ? `${waits} ${waits === 1 ? 'waits' : 'wait'} for an editor` : 'nothing waits for an editor',
    disagrees.length ? `disagrees with your decision on ${disagrees.join(', ')}` : null,
    notChecked ? `not checked: ${notChecked}` : null,
    `edition ${edition}`,
  ].filter(Boolean).join(' · ');
  const lines = names.map((tag) => [tag, reasons.get(tag) ?? currentReasons.get(tag)]).filter(([, text]) => text).map(([tag, text]) => `${tag}: ${text}`);
  return {
    tags, agent_tags: tags.join(', '), agent_notes: `${tags.length ? tags.join(', ') : 'no tags'}\n${second}`, agent_reasons: lines.join('\n'), waits, disagrees,
  };
}

/** The lines of a pulled Agent reasons cell ("<Tag>: <text>") as a Map(tag -> text); a line that does not start with one of `tagNames` and a colon is left out. */
export function reasonsOfCell(text, tagNames) {
  const known = new Set(tagNames);
  const out = new Map();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const at = line.indexOf(': ');
    if (at > 0 && known.has(line.slice(0, at))) out.set(line.slice(0, at), line.slice(at + 2).trim());
  }
  return out;
}

/** The tags written in a pulled Agent tags cell ("A, B"). */
export const tagsOfCell = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const sameText = (a, b) => normaliseText(a ?? '') === normaliseText(b ?? '');

/** How many claims wait in Your queue: the pull's claims that say a tag waits for an editor and are not Reviewed. */
export const openClaimCount = (claims) => claims.filter((c) => claimWaits(c)).length;

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

    const ledger = ctx.pull.queue() ?? [];
    const ledgerByKey = new Map(ledger.filter((r) => r.Key).map((r) => [r.Key, r]));
    const writeColumns = tableEntry(ctx.config, 'claims_copy').write_columns;
    const claims = ctx.pull.claims() ?? [];

    // ledger decisions whose claim an editor has not Reviewed: the setup has not carried them over yet (or the editor reopened the claim)
    const claimById = new Map(claims.map((c) => [c.geo_id, c]));
    const orphans = ledger.filter((r) => r.decided && !isReviewed(claimById.get(String(r.Key ?? '').slice(0, String(r.Key ?? '').lastIndexOf('::')))));
    if (orphans.length) {
      ctx.warnings.push(`${plural(orphans.length, 'decided row')} of the ledger belong${orphans.length === 1 ? 's' : ''} to claims that are not Reviewed, so ${orphans.length === 1 ? 'it does' : 'they do'} not count as decisions here (run setup.mjs migrate-decisions once to carry earlier decisions over)`);
    }

    const plan = newPlan({ runId: ctx.runId, script: 'propose', rubricEdition: edition, config: ctx.config, now: ctx.now });
    const rerun = jc.judge.rerun;
    const tagged = new Map(judgedList.map((t) => [t, 0]));
    let read = 0;
    let created = 0;
    let updated = 0;
    let copied = 0;
    let claimUpdates = 0;
    let notRead = 0;
    let open = 0;
    let newlyWaiting = 0;
    let disagreed = 0;

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
        if (claimWaits(claim)) open += 1;
        if (disagreementsIn(claim.agent_notes).length) disagreed += 1;
        continue;
      }
      read += 1;
      const reviewed = isReviewed(claim);

      for (const [tag, v] of verdicts) {
        const key = `${claim.geo_id}::${tag}`;
        const existing = ledgerByKey.get(key);
        const values = { 'Agent proposal': v.proposal, 'Agent confidence': v.confidence, 'Agent reason': v.reason, 'Rulebook edition': edition };
        if (!existing) {
          const props = { Claim: claim.claim, Key: key, Tag: tag, ...values, 'Claim link': claim.notion_url ?? null };
          if (reviewed) {
            const [d] = decisionsFor(claim, [{ Key: key, Tag: tag, ...values }]);
            Object.assign(props, decisionProps(d));
            copied += 1;
          }
          plan.create('tag_decisions', key, props);
          created += 1;
        } else if (reviewed) {
          // the row holds what the editor saw: only the copy of the decision is written (and only where it differs)
          const [d] = decisionsFor(claim, [existing]);
          const changes = decisionChanges(existing, d, claim);
          if (Object.keys(changes).length) {
            plan.update('tag_decisions', key, existing.page_id, changes);
            copied += 1;
          }
        } else if (!existing.decided) {
          const same = AGENT_COLUMNS.every((c) => (c === 'Agent confidence'
            ? round2(Number(existing[c] ?? Number.NaN)) === values[c]
            : sameText(existing[c], values[c])));
          if (!same) {
            plan.update('tag_decisions', key, existing.page_id, values);
            updated += 1;
          }
        }
      }

      const proposals = new Map([...verdicts].map(([tag, v]) => [tag, v.proposal]));
      const columns = claimColumns({
        judgedNames: judgedList,
        verdicts: proposals,
        reviewed,
        verifiedTags: claim.verified_tags ?? [],
        currentTags: tagsOfCell(claim.agent_tags),
        currentDisagrees: disagreementsIn(claim.agent_notes),
        notChecked,
        edition,
        reasons: new Map([...verdicts].map(([tag, v]) => [tag, v.reason])),
      });
      for (const t of columns.tags) if (tagged.has(t)) tagged.set(t, tagged.get(t) + 1);
      if (!reviewed && columns.waits > 0) {
        open += 1;
        if (!claimWaits(claim)) newlyWaiting += 1;
      }
      if (columns.disagrees.length) disagreed += 1;

      const confidence = round2(Math.min(...[...verdicts.values()].map((v) => v.confidence)));
      const props = {};
      if (!sameText(claim.agent_reasons, columns.agent_reasons)) props[writeColumns.reasons] = columns.agent_reasons;
      if (!sameText(claim.agent_tags, columns.agent_tags)) props[writeColumns.tags] = columns.agent_tags;
      if (!sameText(claim.agent_notes, columns.agent_notes)) props[writeColumns.notes] = columns.agent_notes;
      if (claim.agent_confidence === null || round2(claim.agent_confidence) !== confidence) props[writeColumns.confidence] = confidence;
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
    const sitting = ctx.config.queue?.sitting_rows ?? 20;
    const link = viewLink(ctx.config, 'your_queue');
    const details = { claimsRead: read, notRead, created, updated, copied, claimUpdates, open, newlyWaiting, disagreed, tagged: Object.fromEntries(tagged), result };
    const counts = {
      claims_read: read, not_read: notRead, rows_created: created, rows_updated: updated, decisions_copied: copied, claims_updated: claimUpdates, open_rows: open, disagreed,
    };

    if (ctx.opts.planOnly) {
      return {
        exit: EXIT.OK,
        sentence: `Tag: the plan is ready (${plural(created, 'new ledger row')}, ${plural(updated + copied, 'ledger row update')}, ${plural(claimUpdates, 'claim update')}) and nothing was written to Notion.`,
        rows: [['Ledger rows to create', String(created), ''], ['Ledger rows to update', String(updated + copied), ''], ['Claims to update', String(claimUpdates), '']],
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
    rows.push(['New rows in Your queue', newlyWaiting ? `${newlyWaiting}, lowest confidence first` : 'none', '']);
    if (disagreed > 0 && rows.length < 5) rows.push(['Agent disagreed', plural(disagreed, 'claim'), '']);
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
