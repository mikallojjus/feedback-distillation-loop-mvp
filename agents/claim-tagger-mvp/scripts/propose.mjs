#!/usr/bin/env node
// Propose: turns what the judge stored for each claim into the agent's rows on Tag decisions (one row per claim and tag) and into the seven columns the agent fills on Claims
// (Agent tags, Agent confidence, Agent reasons, Agent status, Tags waiting, Agent edition, Agent remarks). It reads the cell store the latest judge run filled and writes Notion only by
// applying a plan it made itself.
//
//   node agents/claim-tagger-mvp/scripts/propose.mjs [--pull <pull-id>] [--plan-only] [--driver cli|fake] [--run-id <id>]
//
//   --pull <id>    use that pull instead of pulling every table first
//   --plan-only    make and check the plan (runs/<run-id>/plan.jsonl) and stop; nothing is sent to Notion
//   --driver       cli (default) or fake: which judge's answers to read (the store key holds the driver; tests use fake)
//   --run-id       name the run folder (default <UTC stamp>-propose)
//
// What a run does (PORT-V2.md section 2.10). For every claim of the pull that the judge has read, for every judged tag, the verdict over the claim's reads (majority; unsure when any read
// was ask_editor or failed, when the reads disagree, or when the mean p is inside the band):
//   Agent proposal    Applies / Does not apply when sure, Can't tell when not
//   Agent confidence  max(p, 1 - p) to two decimals (0.5 is a coin flip)
//   Agent reason      the reason of the last read in at most queue.reason_max_words words, then " · <rule> · <k> of <n> runs agree"
// Each judged claim and tag has a row on Tag decisions (created when missing, with its Open claim). On every row the judge read, decided or not, the plan writes the four proposal columns
// (Agent proposal, Agent confidence, Agent reason, Rulebook edition) where they differ: the proposals move with the rulebook, and what the editor decided lives in the editor's columns and in
// Decided under (lib/decisions.mjs), so nothing the editor did moves. It also writes
//   Decided under     the record of a decision (recordChanges): the edition a Tag outcome was first seen under, or "<edition> · agreed <Agent proposal>" for a tick on Agent is right; cleared when a
//                     row is no longer decided. Rows of claims the judge did not read get this and nothing else
//   Agent status      per row (rowStatus): Disagrees with your decision, Could not read, Done, or Waits for you for an undecided Can't tell. A Can't tell row with a tick still waits
//   Open claim        the relation to the row's claim on Claims
// and, on the claim, the summary of its rows (claimSummary): Agent tags (the decided Applies rows and the undecided rows proposed Applies), Tags waiting (the undecided Can't tell rows),
// Agent status (the first that holds of Waits for you, Disagrees with your decision, Could not read, else Done), Agent confidence (the lowest of its rows), Agent reasons (one line per row),
// Agent edition and Agent remarks ("not checked: <counts by kind>" when a tag of the rulebook was not checked, else empty). The plan ends with the Agent settings row: the edition and
// "Tag · <date time> · <n> claims". Nothing here writes Agent is right, Tag outcome or Your note (hard rule 1), and nothing writes or clears a reading (Agent's view of your decision, Rule,
// Why the agent thinks so, Read under) or After the rule change: only distill and the follow-up do, so a tag run never undoes a reading.
//
// Exit codes: 0 ok, 1 stopped (the same command continues), 2 invalid (nothing read yet, a refused plan, a read-back that differed), 3 paused,
// 4 drift of the rulebook text in Notion.
//
// Exports: propose, cellVerdict, claimProps, tagPagesOf, reasonsOfCell, notCheckedParts, main, USAGE.

import { readFileSync } from 'node:fs';
import { compareCodePoints } from './lib/pyjson.mjs';
import { codeFile, isMain } from './lib/paths.mjs';
import { normId, normaliseText } from './lib/notion-values.mjs';
import { newPlan } from './lib/plan.mjs';
import { openStore } from './lib/cells.mjs';
import { AGENT_STATUS, TD, tableEntry } from './lib/config.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import {
  claimSummary, countYourQueue, recordChanges, rowDecision, rowStatus,
} from './lib/decisions.mjs';
import { listNames, plural, reasonLine, stampOf, viewLink, yourRows } from './lib/editor-words.mjs';
import {
  LoopExit, addSettingsOp, applyStep, assertApplied, judgeSettings, liveRubric, needClaimColumns, needTables, parseCli, resumeLine, runPreflight, takePull, withRun,
} from './lib/loop.mjs';
import {
  groupsFor, itemHash, readPromptVersion, storeInputsFor, verdictOf,
} from './judge.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/propose.mjs [--pull <pull-id>] [--plan-only] [--driver cli|fake] [--run-id <id>]';

const round2 = (x) => Math.round(x * 100) / 100;
const AGENT_COLUMNS = [TD.proposal, TD.confidence, TD.reason, TD.edition];
const trimmed = (v) => String(v ?? '').trim();

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

// ---- the columns of a claim ---------------------------------------------------------------------------------------------------

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
 * The properties of a claims update: the columns of `columns` (claimSummary's answer) that differ from the pulled `claim`, under the config's column names `writeColumns`. The two
 * relations go as lists of page ids of the Rulebook copy (`tagPages`, tagPagesOf); a tag without a row there is an error naming it. Agent confidence is not here (propose and the
 * follow-up work it out differently).
 */
export function claimProps({ claim, columns, writeColumns, tagPages, label = 'Tag' }) {
  const ids = (names) => names.map((name) => {
    const id = tagPages.get(name);
    if (!id) throw new LoopExit(EXIT.INVALID, `the tag "${name}" has no row in the Rulebook, so it cannot be written to a relation column`, {
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

// ---- the run -------------------------------------------------------------------------------------------------------------------------

const tagLine = (names) => (names.length ? listNames(names) : 'no tag');

/** Run propose. opts: the flags (pull, planOnly, driver, runId) and the hooks of the other scripts (root, config, io, now, fetchImpl, token, sleep, client). */
export async function propose(opts = {}) {
  return withRun({
    script: 'propose', label: 'Tag', again: '/claim-tagger tag', opts, args: { pull: opts.pull ?? null, plan_only: opts.planOnly === true, driver: opts.driver ?? 'cli' },
    resume: resumeLine('propose', opts.driver === 'fake' ? ['--driver', 'fake'] : []),
  }, async (ctx) => {
    await takePull(ctx);
    needTables(ctx, 'claims', 'tag_decisions');
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
    const ledgerByKey = new Map(ledger.filter((r) => r[TD.key]).map((r) => [r[TD.key], r]));
    const writeColumns = tableEntry(ctx.config, 'claims').write_columns;
    const tagPages = tagPagesOf(ctx, rubric);
    const claims = ctx.pull.claims() ?? [];

    const plan = newPlan({ runId: ctx.runId, script: 'propose', rubricEdition: edition, config: ctx.config, now: ctx.now });
    const rerun = jc.judge.rerun;
    const tagged = new Map(judgedList.map((t) => [t, 0]));
    // every Tag decisions row as it will be once the plan is written (the pulled row merged with the plan's changes, or the row the plan creates), by Key
    const after = new Map(ledger.filter((r) => r[TD.key]).map((r) => [r[TD.key], r]));
    const touched = new Set(); // keys of the rows of claims the judge read
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

      const mine = [];
      for (const [tag, v] of verdicts) {
        const key = `${claim.geo_id}::${tag}`;
        touched.add(key);
        const existing = ledgerByKey.get(key);
        const values = {
          [TD.proposal]: v.proposal, [TD.confidence]: v.confidence, [TD.reason]: v.reason, [TD.edition]: edition,
        };
        const unreadable = v.runs === 0;
        if (!existing) {
          const props = {
            [TD.claim]: claim.claim, [TD.key]: key, [TD.tag]: tag, ...values, [TD.status]: rowStatus({ outcome: null, proposal: v.proposal, unreadable }), [TD.open]: [claim.page_id],
          };
          plan.create('tag_decisions', key, props);
          created += 1;
          mine.push(props);
          after.set(key, props);
          continue;
        }
        // an existing row: the proposal columns where they differ (decided or not), the record of a decision (worked out on the pulled row), the row's status and its Open claim
        const changes = {};
        for (const c of AGENT_COLUMNS) {
          const same = c === TD.confidence ? round2(Number(existing[c] ?? Number.NaN)) === values[c] : sameText(existing[c], values[c]);
          if (!same) changes[c] = values[c];
        }
        Object.assign(changes, recordChanges(existing));
        const status = rowStatus({ outcome: rowDecision(existing).outcome, proposal: v.proposal, unreadable });
        if (trimmed(existing[TD.status]) !== status) changes[TD.status] = status;
        const rel = (existing[TD.open] ?? []).map(normId);
        if (rel.length !== 1 || rel[0] !== normId(claim.page_id)) changes[TD.open] = [claim.page_id];
        const merged = { ...existing, ...changes };
        if (Object.keys(changes).length) {
          plan.update('tag_decisions', key, existing.page_id, changes);
          updated += 1;
          after.set(key, merged);
        }
        mine.push(merged);
      }

      const columns = claimSummary(mine, { judgedNames: judgedList, edition, notChecked });
      for (const t of columns.tags) if (tagged.has(t)) tagged.set(t, tagged.get(t) + 1);
      const props = claimProps({ claim, columns, writeColumns, tagPages });
      if (columns.confidence !== null && (claim.agent_confidence === null || round2(claim.agent_confidence) !== columns.confidence)) props[writeColumns.confidence] = columns.confidence;
      if (Object.keys(props).length) {
        plan.update('claims', claim.geo_id, claim.page_id, props);
        claimUpdates += 1;
      }
    }

    // the rows of claims the judge did not read keep every column but Decided under: a tick is recorded, and a cleared decision is cleared
    for (const row of ledger) {
      const key = row[TD.key];
      if (!key || touched.has(key)) continue;
      const changes = recordChanges(row);
      if (Object.keys(changes).length) {
        plan.update('tag_decisions', key, row.page_id, changes);
        updated += 1;
        after.set(key, { ...row, ...changes });
      }
    }
    const recorded = [...after.keys()].filter((key) => trimmed(after.get(key)[TD.decidedUnder]) !== trimmed(ledgerByKey.get(key)?.[TD.decidedUnder])).length;
    const afterRows = [...after.values()];
    const open = countYourQueue(afterRows);
    const newlyWaiting = afterRows.filter((r) => trimmed(r[TD.status]) === AGENT_STATUS.waits && trimmed(ledgerByKey.get(r[TD.key])?.[TD.status]) !== AGENT_STATUS.waits).length;
    const disagreed = afterRows.filter((r) => trimmed(r[TD.status]) === AGENT_STATUS.disagrees).length;

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
    const details = { claimsRead: read, notRead, created, updated, recorded, claimUpdates, open, newlyWaiting, disagreed, tagged: Object.fromEntries(tagged), result };
    const counts = {
      claims_read: read, not_read: notRead, rows_created: created, rows_updated: updated, decisions_recorded: recorded, claims_updated: claimUpdates, open_rows: open, disagreed,
    };

    if (ctx.opts.planOnly) {
      return {
        exit: EXIT.OK,
        sentence: `Tag: the plan is ready (${plural(created, 'new ledger row')}, ${plural(updated, 'ledger row update')}, ${plural(claimUpdates, 'claim update')}) and nothing was written to Notion.`,
        rows: [['Ledger rows to create', String(created), ''], ['Ledger rows to update', String(updated), ''], ['Claims to update', String(claimUpdates), '']],
        next: 'Next: type /claim-tagger tag to write it.',
        details,
        counts,
      };
    }
    assertApplied(ctx, result);

    const waiting = open === 0 ? 'nothing waits for you' : (open > sitting ? `${open} wait for you, more than fit one sitting` : (open === 1 ? '1 waits for you' : `${open} wait for you`));
    const rows = [['Claims read', String(read), '']];
    // the count is of the claims that carry the tag in Agent tags, and that includes the earlier decisions (a decided row of the tag counts as the editor decided it), so the row says so:
    // read as "tagged", an editor takes it for a count of their own claims
    if (judgedList.length <= 2) for (const t of judgedList) rows.push([`Carrying ${t}`, `${plural(tagged.get(t), 'claim')} (earlier decisions included)`, '']);
    else rows.push(['Carrying tags', `${plural([...tagged.values()].reduce((a, b) => a + b, 0), 'tag')} (earlier decisions included)`, '']);
    rows.push(['New rows in Your queue', newlyWaiting ? `${newlyWaiting}, lowest confidence first` : 'none', '']);
    if (disagreed > 0 && rows.length < 5) rows.push(['Agent disagreed', plural(disagreed, 'row'), '']);
    if (notRead > 0 && rows.length < 5) rows.push(['Not read yet', String(notRead), '']);
    const next = open === 0
      ? 'Next: nothing waits for you; type /claim-tagger tag when new claims arrive.'
      : (open > sitting ? `Next: start at the top of Your queue (${link}).` : `Next: decide ${yourRows(open)} in Your queue (${link}).`);
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
