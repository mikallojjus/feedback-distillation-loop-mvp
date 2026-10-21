#!/usr/bin/env node
// Propose: turns what the judge stored for each claim into the seven columns the agent fills on the Claims copy (Agent tags, Agent confidence, Agent reasons, Agent status,
// Tags waiting, Agent edition, Agent remarks; CLAIMS-REVIEW.md section 6.1), into the agent's ledger (Tag decisions), and, for every claim an editor has Reviewed, into the copy of
// the editor's decision. It reads the cell store the latest judge run filled and writes Notion only by applying a plan it made itself.
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
// The plan writes, on every judged claim, the seven columns, only where they differ from what the pull holds:
//   Agent tags        a relation to the Rulebook copy: the tags whose proposal is Applies (on a Reviewed claim the editor's verified set: a proposal that differs from the editor's
//                     decision is never applied)
//   Agent confidence  the lowest confidence among the claim's judged tags
//   Agent reasons     one line per judged tag, "<Tag>: <the Agent reason of the ledger>", so that an editor in Your queue sees why without opening the ledger
//   Agent status      Waits for you when a judged tag of the claim waits and the claim is not Reviewed; Disagrees with your decision when the claim is Reviewed and the agent's sure
//                     proposal differs from the editor's verified set; Could not read when the judge could not read the claim (and an editor has not marked it To review); else Done
//   Tags waiting      a relation to the Rulebook copy: the judged tags that wait (empty when nothing waits)
//   Agent edition     the rulebook edition the row was written under
//   Agent remarks     "not checked: <counts by kind>" when a tag of the rulebook was not checked, else empty
// A tag waits when its proposal is Can't tell, and every judged tag of a claim whose Review status is To review waits, whatever the confidence (none of them is written to Agent tags;
// a claim that QA marks To review on the real table lands in Your queue on the next run); a Reviewed claim never waits. A claim that was decided keeps Waits for you until this
// step reads the decision: the row stays in Your queue until the next tag run, by design (section 6.2). In the ledger a row per judged claim and tag is created when missing, and
// updated when the proposal, the confidence, the reason or the edition changed. A claim an editor has Reviewed is decided (lib/decisions.mjs): there the ledger row also gets the copy of
// the decision (Tag outcome, Why wrong, Your reasoning, Decided under), and the proposal columns of a row that is decided are never rewritten (they are what the editor saw). The plan
// ends with the Agent settings row: the edition and "Tag · <date time> · <n> claims". Nothing here writes Review status, Verified tags, Why wrong or Challenged tags notes of a claim (hard rule 1).
//
// Exit codes: 0 ok, 1 stopped (the same command continues), 2 invalid (nothing read yet, a refused plan, a read-back that differed), 3 paused,
// 4 drift of the rulebook text in Notion.
//
// Exports: propose, cellVerdict, claimColumns, claimProps, tagPagesOf, reasonsOfCell, notCheckedParts, openClaimCount, main, USAGE.

import { readFileSync } from 'node:fs';
import { compareCodePoints } from './lib/pyjson.mjs';
import { codeFile, isMain } from './lib/paths.mjs';
import { normaliseText } from './lib/notion-values.mjs';
import { newPlan } from './lib/plan.mjs';
import { openStore } from './lib/cells.mjs';
import { AGENT_STATUS, tableEntry } from './lib/config.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { claimDisagrees, claimWaits, decisionChanges, decisionProps, decisionsFor, isReviewed, isToReview } from './lib/decisions.mjs';
import { listNames, plural, reasonLine, stampOf, viewLink, yourClaims } from './lib/editor-words.mjs';
import {
  LoopExit, addSettingsOp, applyStep, assertApplied, judgeSettings, liveRubric, needClaimColumns, needTables, parseCli, resumeLine, runPreflight, takePull, withRun,
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

// ---- the seven columns of a claim ---------------------------------------------------------------------------------------------------

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
 * The agent's columns of one claim (CLAIMS-REVIEW.md sections 6.1 and 6.2). `verdicts` maps a judged tag to the agent's current proposal (Applies, Does not apply or Can't tell);
 * a judged tag with no entry was not read in this run and keeps its place in `currentTags` and `currentWaiting` (the pulled Agent tags and Tags waiting), and on a Reviewed claim
 * `previouslyDisagreed` (the pulled Agent status was Disagrees with your decision) keeps the status while some judged tag was not read again, because the status does not say which tag.
 *   not Reviewed   Agent tags are the tags whose proposal is Applies, Tags waiting the tags whose proposal is Can't tell; Agent status is Waits for you when a tag waits, else Done
 *   To review      (`toReview`: the editor's, or QA's, mark) every judged tag waits, whatever the proposal, and none is written to Agent tags; Agent status is Waits for you
 *   Reviewed       Agent tags are the editor's set, `verifiedTags`; nothing waits; Agent status is Disagrees with your decision when a sure proposal differs from the editor's decision
 *   unreadable     (`unreadable`: the judge has no usable answer for the claim) Agent status is Could not read and nothing waits, unless the claim is To review, which waits
 * `notChecked` is notCheckedParts' text, written to Agent remarks as "not checked: ...". `reasons` maps a tag to the text of its Agent reason in this run; a judged tag without one
 * keeps its line from `currentReasons` (the pulled Agent reasons, read by reasonsOfCell).
 * Returns { tags: [names], waiting: [names], status, agent_reasons, agent_edition, agent_remarks, waits (how many tags wait), disagrees: [names] }.
 */
export function claimColumns({
  judgedNames, verdicts = new Map(), reviewed = false, toReview = false, unreadable = false, verifiedTags = [], currentTags = [], currentWaiting = [], previouslyDisagreed = false,
  notChecked = '', edition, reasons = new Map(), currentReasons = new Map(),
}) {
  const names = [...new Set(judgedNames)].sort(compareCodePoints);
  const tags = [];
  const waiting = [];
  const disagrees = [];
  let status = AGENT_STATUS.done;
  if (reviewed) {
    tags.push(...[...new Set(verifiedTags)].sort(compareCodePoints));
    let notReadAgain = false;
    for (const tag of names) {
      const proposal = verdicts.get(tag);
      if (SURE.has(proposal)) {
        if ((proposal === 'Applies') !== verifiedTags.includes(tag)) disagrees.push(tag);
      } else if (proposal === undefined) notReadAgain = true;
    }
    if (disagrees.length || (notReadAgain && previouslyDisagreed)) status = AGENT_STATUS.disagrees;
    else if (unreadable) status = AGENT_STATUS.unread;
  } else if (toReview) {
    waiting.push(...names);
    status = AGENT_STATUS.waits;
  } else if (unreadable) {
    status = AGENT_STATUS.unread;
  } else {
    for (const tag of names) {
      const proposal = verdicts.get(tag);
      if (proposal === 'Applies') tags.push(tag);
      else if (proposal === undefined) {
        if (currentTags.includes(tag)) tags.push(tag);
        if (currentWaiting.includes(tag)) waiting.push(tag);
      } else if (proposal === "Can't tell") waiting.push(tag);
    }
    if (waiting.length) status = AGENT_STATUS.waits;
  }
  const lines = names.map((tag) => [tag, reasons.get(tag) ?? currentReasons.get(tag)]).filter(([, text]) => text).map(([tag, text]) => `${tag}: ${text}`);
  return {
    tags, waiting, status, agent_reasons: lines.join('\n'), agent_edition: edition, agent_remarks: notChecked ? `not checked: ${notChecked}` : '', waits: waiting.length, disagrees,
  };
}

/** Tag name -> page id of its row in the Rulebook copy: the rows of the pull, else the page ids of the rulebook edition in force (the same sources pull.mjs resolves a relation with). */
export function tagPagesOf(ctx, rubric = null) {
  const map = new Map();
  for (const t of rubric?.tags ?? []) if (t.page_id && t.name) map.set(t.name, t.page_id);
  const key = tableEntry(ctx.config, 'rulebook').key || 'Name';
  for (const row of ctx.pull?.rulebook?.() ?? []) {
    const name = String(row?.[key] ?? '').trim();
    if (name !== '' && row.page_id) map.set(name, row.page_id);
  }
  return map;
}

const sameNames = (a, b) => JSON.stringify([...new Set(a)].sort(compareCodePoints)) === JSON.stringify([...new Set(b)].sort(compareCodePoints));

/**
 * The properties of a claims update: the columns of `columns` (claimColumns' answer) that differ from the pulled `claim`, under the config's column names `writeColumns`. The two
 * relations go as lists of page ids of the Rulebook copy (`tagPages`, tagPagesOf); a tag without a row there is an error naming it. Agent confidence is not here (propose and the
 * follow-up work it out differently).
 */
export function claimProps({ claim, columns, writeColumns, tagPages, label = 'Tag' }) {
  const ids = (names) => names.map((name) => {
    const id = tagPages.get(name);
    if (!id) throw new LoopExit(EXIT.INVALID, `the tag "${name}" has no row in the Rulebook copy, so it cannot be written to a relation column`, {
      sentence: `${label}: nothing was written, because the tag "${name}" has no row in the rulebook table.`,
      next: 'Next: ask the engineer to look at the message the script printed.',
    });
    return id;
  });
  const props = {};
  if (!sameText(claim.agent_reasons, columns.agent_reasons)) props[writeColumns.reasons] = columns.agent_reasons;
  if (!sameNames(claim.agent_tags ?? [], columns.tags)) props[writeColumns.tags] = ids(columns.tags);
  if (!sameNames(claim.tags_waiting ?? [], columns.waiting)) props[writeColumns.waiting] = ids(columns.waiting);
  if ((claim.agent_status ?? null) !== columns.status) props[writeColumns.status] = columns.status;
  if (!sameText(claim.agent_edition, columns.agent_edition)) props[writeColumns.edition] = columns.agent_edition;
  if (!sameText(claim.agent_remarks, columns.agent_remarks)) props[writeColumns.remarks] = columns.agent_remarks;
  return props;
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

const sameText = (a, b) => normaliseText(a ?? '') === normaliseText(b ?? '');

/** How many claims wait in Your queue: the pull's claims whose Agent status is Waits for you and that are not Reviewed (what is still to decide). */
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
    needClaimColumns(ctx);
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
    const tagPages = tagPagesOf(ctx, rubric);
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
        if (claimDisagrees(claim)) disagreed += 1;
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
        toReview: isToReview(claim),
        verifiedTags: claim.verified_tags ?? [],
        unreadable: [...verdicts.values()].every((v) => v.runs === 0),
        currentTags: claim.agent_tags ?? [],
        currentWaiting: claim.tags_waiting ?? [],
        previouslyDisagreed: claimDisagrees(claim),
        notChecked,
        edition,
        reasons: new Map([...verdicts].map(([tag, v]) => [tag, v.reason])),
      });
      for (const t of columns.tags) if (tagged.has(t)) tagged.set(t, tagged.get(t) + 1);
      if (!reviewed && columns.status === AGENT_STATUS.waits) {
        open += 1;
        if (!claimWaits(claim)) newlyWaiting += 1;
      }
      if (columns.status === AGENT_STATUS.disagrees) disagreed += 1;

      const confidence = round2(Math.min(...[...verdicts.values()].map((v) => v.confidence)));
      const props = claimProps({ claim, columns, writeColumns, tagPages });
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
    // the count is of the claims that carry the tag in Agent tags, and that includes the earlier decisions (a Reviewed claim carries the editor's verified set), so the row says so:
    // read as "tagged", an editor takes it for a count of their own claims
    if (judgedList.length <= 2) for (const t of judgedList) rows.push([`Carrying ${t}`, `${plural(tagged.get(t), 'claim')} (earlier decisions included)`, '']);
    else rows.push(['Carrying tags', `${plural([...tagged.values()].reduce((a, b) => a + b, 0), 'tag')} (earlier decisions included)`, '']);
    rows.push(['New rows in Your queue', newlyWaiting ? `${newlyWaiting}, lowest confidence first` : 'none', '']);
    if (disagreed > 0 && rows.length < 5) rows.push(['Agent disagreed', plural(disagreed, 'claim'), '']);
    if (notRead > 0 && rows.length < 5) rows.push(['Not read yet', String(notRead), '']);
    const next = open === 0
      ? 'Next: nothing waits for you; type /claim-tagger tag when new claims arrive.'
      : (open > sitting ? `Next: start at the top of Your queue (${link}).` : `Next: decide ${yourClaims(open)} in Your queue (${link}).`);
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
