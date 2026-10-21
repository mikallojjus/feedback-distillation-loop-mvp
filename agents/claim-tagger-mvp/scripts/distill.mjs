#!/usr/bin/env node
// Distill: first reads the editors' decisions, then turns the "the rule is the problem" readings into proposed rule changes (READ-DECISIONS.md, decisions P4 and 64 to 76).
//
// Step 1, read the decisions. Where an editor decided a tag differently from the agent's proposal, the agent reads the disagreement itself (lib/readings.mjs): Agent slip, Rule unclear or
// Rule should change, the rule it points at, one line of why. A note line that opens with a reason word (Agent slip., Rule unclear., Rule should change.) is taken as it stands, no model
// call. Any other disagreement goes to the model in batches of distill.reading_batch rows (prompt prompts/reading.md, model models.distill, effort distill.reading_effort, two attempts per
// batch, refused replies kept under the run's rejected/); a batch that fails twice leaves its rows unread this run, and the next run tries again. A row is read again only when its
// "Read under" (edition and a hash of the outcome, the proposal, the note line, the reason word and the edition the proposal was made under) differs from the current one; a row marked Fixed is never read.
// The readings go to the ledger (Agent reading, Rule, Reading note, Read under) and, as one line per tag, to the claim's Agent reading, in the same plan as the rest. Every reading
// of the run is one line of readings.jsonl in the run folder; --readings <run-id> reuses the lines of an earlier run for the rows whose hash is unchanged (the live step after a --plan-only).
//
// Step 2, the lessons. The decided rows of Tag decisions read Rule unclear or Rule should change are grouped by (tag, the rule the reading points at, else the rule the agent cited; a row whose
// Follow-up is Fixed is left out: a rule change that rests on it went live and the agent now agrees; Still wrong stays in), the distill model is asked once per group for at most three patterns,
// every reply is checked, and a Rule changes row (Status Proposed) is written per kept lesson. It never changes a rule: a rule changes only through an Approved lesson, a safety check PASS and
// the promote step. The lesson's Kind is derived: Change the rule when any row of its group reads Rule should change, else Clarify wording.
//
// The copy of a decision is made by the tag step; a claim an editor Reviewed since the last tag step has none yet. So distill first brings the ledger up to date:
// for every Reviewed claim, the ledger rows of its judged tags get the copy (Tag outcome, Why wrong (the reason word only), Your reasoning, Decided under; lib/decisions.mjs), in the same
// plan, and the readings and the groups are made from the rows as they will be then. No column an editor writes is touched.
//
//   node agents/claim-tagger-mvp/scripts/distill.mjs [--pull <pull-id>] [--plan-only] [--readings <run-id>] [--driver cli|fake] [--run-id <id>] [--rows <n>]
//
//   --pull <id>        use that pull instead of pulling every table first
//   --plan-only        make and check the plan and stop; the model is still asked (readings and lessons), nothing is sent to Notion
//   --readings <id>    reuse the readings.jsonl of that run for the rows whose hash is unchanged, and ask the model only for the rest
//   --driver           cli (default) or fake (tests)
//   --run-id           name the run folder (default <UTC stamp>-distill)
//   --rows <n>         the most rows one group shows the model (default 30; tests use a small number)
//
// Grouping. A group is the decided rows that read Rule unclear or Rule should change, by tag and by the reading's rule ("Context-dependent rule 4" in the ledger's Rule), else the rule the agent cited
// in Agent reason ("<Tag> rule 4"), else none ("whole"). A group needs distill.min_claims distinct claims. Only tags that are judged and have the rule are considered (the safety check can
// only test those). A group that already has an open lesson (Status Proposed or Approved) on the same tag and rule is skipped. A group above the row cap shows the newest rows with the
// editor's reasoning first, both outcomes represented. The model also sees up to 12 decided rows of the same tag and rule that were decided the other way (counter-evidence, Agent slip rows
// among them) and the tag's example claims.
//
// The reply is checked: at most 3 patterns; each names a rule that exists (the cited one when the group has one), a text that differs from the rule as it stands, and the keys of at least
// distill.min_claims rows of the group; a `kind` the model still sends is ignored; a text that repeats distill.overfit_ngram (8) consecutive words of a supporting claim is dropped; one lesson
// per rule; the best-supported distill.max_lessons_per_run (3) are kept. The Rule changes row holds the title (unique: " (2)" is added when needed), tag, rule, kind, the rule as it stands, the
// proposed text and one line per supporting row ("the claim cut to 60 characters · key", spilling to the page body with "+ n more in the page"); the page body holds every supporting claim
// in full, with its key.
//
// Run files: plan.jsonl, ledger.jsonl, report.md, run.json, calls.jsonl (one line per model call, purpose reading or distill), readings.jsonl ({ key, hash, edition, source: "model" | "verbatim",
// reading, rule, note, no_note } per reading made or reused this run) and rejected/reading-batch-<n>-attempt-<k>.md (a reply the checks refused, as it came, with the problems).
//
// Exit codes: 0 ok (also when nothing qualifies, when some rows could not be read, and when a rule change was drafted from earlier readings although no row could be read this time),
// 1 stopped (the same command continues), 2 invalid (also: rows were to be read, none could be, and no rule change was drafted), 3 paused, 4 drift or another model, 75 usage window.
//
// Exports: distill, citedRule, buildGroups, buildMessage, checkReply, ngramOverlap, supportingCell, uniqueTitle, main, USAGE.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from './lib/exit-codes.mjs';
import { groupOf, readingSettings, tableEntry } from './lib/config.mjs';
import { READINGS, RULE_WHY, isFollowedUp, isReviewed, syncDecisions } from './lib/decisions.mjs';
import { cutText, plural, quoted, stampOf, viewLink } from './lib/editor-words.mjs';
import { extractJson } from './lib/claude.mjs';
import { LoopExit, addSettingsOp, applyStep, assertApplied, callModel, judgeSettings, liveRubric, modelStop, needClaimColumns, needTables, parseCli, readEvals, resumeLine, runPreflight, takePull, withRun } from './lib/loop.mjs';
import { appendJsonl, readJson, readJsonl, writeTextAtomic } from './lib/jsonl.mjs';
import { splitRichText } from './lib/notion-rest.mjs';
import { codeFile, ensureDir, isMain, safeName } from './lib/paths.mjs';
import { newPlan } from './lib/plan.mjs';
import { resumeFor } from './lib/resume.mjs';
import {
  READING_COLUMNS, agentCitedRule, batchesOf, buildReadingMessage, checkReadings, citedRule, claimReadingCell, classifyRows, clearedReadingCells, readingCells, readingRecord, renderTag,
  reusableReading, verbatimReading, xmlAttr, xmlText,
} from './lib/readings.mjs';
import { oneLineRule, ruleNumberOf } from './lib/rulebook-edit.mjs';
import { validate } from './lib/validate.mjs';

export { citedRule };

const ENGINEER = 'Next: ask the engineer to look at the message the script printed.';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/distill.mjs [--pull <pull-id>] [--plan-only] [--readings <run-id>] [--driver cli|fake] [--run-id <id>] [--rows <n>]';

// the two kinds of lesson (the Kind column of Rule changes); the kind is derived from the readings the lesson rests on, not asked of the model (decision 69)
const KINDS = Object.freeze({ clarify: 'Clarify wording', change: 'Change the rule' });
const COUNTER_ROWS = 12;
const DEFAULT_ROW_CAP = 30;
const MAX_PATTERNS = 3;
const TITLE_MAX = 60;
const REJECTED_MAX_CHARS = 20000;

const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const outcomeOf = (row) => row['Tag outcome'];
const sameCell = (a, b) => text(a).replace(/\s+/g, ' ').trim() === text(b).replace(/\s+/g, ' ').trim();

// ---- the groups ---------------------------------------------------------------------------------------------------------------------

// A decided ledger row as the groups and the message use it. `n` is the rule it points at (the reading's rule, else the rule the agent cited) when the tag has that rule, else null.
function rowOf(r, rubric) {
  const tag = rubric.tags.find((t) => t.name === r.Tag);
  const valid = (n) => n !== null && Boolean(tag?.rules.some((x) => x.n === n));
  const fromReading = ruleNumberOf(r.Rule);
  const fromAgent = agentCitedRule(r);
  return {
    key: r.Key, page_id: r.page_id, tag: r.Tag, claim: text(r.Claim), outcome: outcomeOf(r), reading: READINGS.includes(r['Agent reading']) ? r['Agent reading'] : null,
    readingNote: text(r['Reading note']).trim(), reasoning: text(r['Your reasoning']).trim(),
    agentReason: text(r['Agent reason']).trim(), proposal: r['Agent proposal'] ?? null, confidence: r['Agent confidence'] ?? null, edited: text(r.last_edited),
    n: valid(fromReading) ? fromReading : (valid(fromAgent) ? fromAgent : null), followedUp: isFollowedUp(r),
  };
}

const newestFirst = (a, b) => (a.edited < b.edited ? 1 : a.edited > b.edited ? -1 : (a.key < b.key ? -1 : 1));
const reasoningFirst = (a, b) => (a.reasoning !== '') === (b.reasoning !== '') ? newestFirst(a, b) : (a.reasoning !== '' ? -1 : 1);

/** The rows a group shows: all of them up to the cap, else the best-ranked (reasoning first, newest first) with both outcomes present when the group has both. */
function chooseShown(rows, cap) {
  const ranked = [...rows].sort(reasoningFirst);
  if (ranked.length <= cap) return ranked;
  const shown = ranked.slice(0, cap);
  const outcomes = new Set(rows.map((r) => r.outcome));
  for (const wanted of outcomes) {
    if (shown.some((r) => r.outcome === wanted)) continue;
    const swapIn = ranked.find((r) => r.outcome === wanted);
    const counts = new Map();
    for (const r of shown) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
    const swapOut = [...shown].reverse().find((r) => counts.get(r.outcome) > 1);
    if (swapIn && swapOut) shown[shown.indexOf(swapOut)] = swapIn;
  }
  return shown;
}

/**
 * The groups of decided rows to ask the model about. `queue` is the pull's Tag decisions rows (as they will be once the readings are written), `rubric` the rulebook in force, `openLessons` the
 * lessons with Status Proposed or Approved ({ Tag, Rule }). Returns { groups, counts } with counts { decided, ruleRows, ruleRowsFollowed, ruleRowsNotJudged, groupsTooSmall, groupsOpen }.
 * Only rows whose Agent reading is Rule unclear or Rule should change build groups (a row read Agent slip, and a row not read, builds none).
 * A row whose Follow-up is Fixed is counted in ruleRows and ruleRowsFollowed and builds no group: a rule change that rests on it went live and the agent agrees. A row marked Still wrong
 * builds groups as before (the editor adds a note and distills again). A Fixed row still counts as a
 * decided row and may serve as counter-evidence, and so may a row read Agent slip.
 * A group: { tag, n (the rule number or null), rows (all), shown, counter, current (the rule's text or null) }.
 */
export function buildGroups({ queue, rubric, config, minClaims = 2, rowCap = DEFAULT_ROW_CAP, openLessons = [] }) {
  const decided = queue.filter((r) => r.decided && r.Key && r.Tag).map((r) => rowOf(r, rubric));
  const counts = { decided: decided.length, ruleRows: 0, ruleRowsFollowed: 0, ruleRowsNotJudged: 0, groupsTooSmall: 0, groupsOpen: 0 };
  const byGroup = new Map();
  for (const r of decided) {
    if (!RULE_WHY.has(r.reading)) continue;
    counts.ruleRows += 1;
    if (r.followedUp) {
      counts.ruleRowsFollowed += 1;
      continue;
    }
    const tag = rubric.tags.find((t) => t.name === r.tag);
    if (!tag || !tag.judged || groupOf(config, tag.name) === null || tag.rules.length === 0) {
      counts.ruleRowsNotJudged += 1;
      continue;
    }
    const id = `${r.tag}\u0000${r.n ?? 'whole'}`;
    if (!byGroup.has(id)) byGroup.set(id, { tag: r.tag, n: r.n, rows: [] });
    byGroup.get(id).rows.push(r);
  }
  const open = openLessons.map((l) => ({ tag: l.Tag, n: ruleNumberOf(l.Rule) }));
  const groups = [];
  for (const g of byGroup.values()) {
    const claims = new Set(g.rows.map((r) => r.key));
    if (claims.size < minClaims) {
      counts.groupsTooSmall += 1;
      continue;
    }
    if (g.n !== null && open.some((o) => o.tag === g.tag && o.n === g.n)) {
      counts.groupsOpen += 1;
      continue;
    }
    const shown = chooseShown(g.rows, rowCap);
    const mine = new Set(g.rows.map((r) => r.key));
    const tag = rubric.tags.find((t) => t.name === g.tag);
    const dominant = [...shown.reduce((m, r) => m.set(r.outcome, (m.get(r.outcome) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    const counter = decided
      .filter((r) => r.tag === g.tag && !mine.has(r.key) && r.outcome !== dominant && (g.n === null || r.n === g.n || r.n === null))
      .sort((a, b) => ((g.n !== null && a.n === g.n) === (g.n !== null && b.n === g.n) ? newestFirst(a, b) : (g.n !== null && a.n === g.n ? -1 : 1)))
      .slice(0, COUNTER_ROWS);
    groups.push({ tag: g.tag, n: g.n, rows: g.rows, shown, counter, current: g.n === null ? null : tag.rules.find((x) => x.n === g.n).text });
  }
  groups.sort((a, b) => b.rows.length - a.rows.length || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : (a.n ?? 0) - (b.n ?? 0)));
  return { groups, counts };
}

// ---- the message --------------------------------------------------------------------------------------------------------------------

const esc = xmlText;
const attr = xmlAttr;

/**
 * The user message of one group: the tag and its rules, the cited rule, the examples, the rows and the counter-evidence, every free text escaped (it is data). Each row carries the agent's
 * reading of the disagreement (`reading="..."` and a <reading_note>) beside the editor's own words.
 */
export function buildMessage(group, rubric, examples = []) {
  const tag = rubric.tags.find((t) => t.name === group.tag);
  const row = (r) => [
    `<row key="${attr(r.key)}" outcome="${attr(r.outcome)}" reading="${attr(r.reading ?? '')}"${r.proposal ? ` agent_proposal="${attr(r.proposal)}"` : ''}${r.confidence !== null && r.confidence !== undefined ? ` agent_confidence="${attr(r.confidence)}"` : ''}>`,
    `<claim>${esc(r.claim)}</claim>`,
    `<reasoning>${esc(r.reasoning)}</reasoning>`,
    ...(r.readingNote ? [`<reading_note>${esc(r.readingNote)}</reading_note>`] : []),
    ...(r.agentReason ? [`<agent_reason>${esc(r.agentReason)}</agent_reason>`] : []),
    '</row>',
  ].join('\n');
  const parts = [
    renderTag(tag),
    group.n === null ? '<cited_rule n="none">The readings name no rule.</cited_rule>' : `<cited_rule n="${group.n}">${esc(group.current)}</cited_rule>`,
  ];
  if (examples.length) {
    parts.push('<examples>', ...examples.map((e) => `<example answer="${e.expected}">${esc(e.claim)}</example>`), '</examples>');
  }
  parts.push('<rows>', ...group.shown.map(row), '</rows>');
  if (group.counter.length) parts.push('<counter_evidence>', ...group.counter.map(row), '</counter_evidence>');
  return parts.join('\n');
}

// ---- the reply ----------------------------------------------------------------------------------------------------------------------

const words = (s) => text(s).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

/**
 * Whether `textToCheck` repeats `n` or more consecutive words of any of the claims: { hit, claim, ngram }. A claim shorter than n words (but at least
 * five) counts when the text repeats the whole claim.
 */
export function ngramOverlap(textToCheck, claims, n = 8) {
  const t = words(textToCheck);
  const grams = (list, size) => {
    const out = new Set();
    for (let i = 0; i + size <= list.length; i++) out.add(list.slice(i, i + size).join(' '));
    return out;
  };
  for (const claim of claims) {
    const c = words(claim);
    const size = Math.min(n, c.length);
    if (size < Math.min(n, 5)) continue;
    const mine = grams(c, size);
    for (const g of grams(t, size)) if (mine.has(g)) return { hit: true, claim, ngram: g };
  }
  return { hit: false, claim: null, ngram: null };
}

const sameRuleText = (a, b) => oneLineRule(a).toLowerCase() === oneLineRule(b).toLowerCase();

/**
 * Check a parsed reply against its group. Returns { patterns: [{ title, rule, n, kind, text, keys, rows }], dropped: [why] }. A pattern is dropped, with a
 * reason, when it is not an object, names no usable title or text, names a rule that does not exist or is not the cited one,
 * leaves the rule as it is, rests on fewer than minClaims rows of the group, or repeats `ngram` words of a supporting claim. At most 3 patterns are read.
 * The kind is derived, not read from the reply: Change the rule when any row of the group reads Rule should change, else Clarify wording (decision 69).
 */
export function checkReply(value, group, rubric, { minClaims = 2, ngram = 8 } = {}) {
  const patterns = [];
  const dropped = [];
  const list = Array.isArray(value?.patterns) ? value.patterns : null;
  if (list === null) return { patterns, dropped: ['the reply has no "patterns" list'], invalid: true };
  const tag = rubric.tags.find((t) => t.name === group.tag);
  const byKey = new Map(group.shown.map((r) => [r.key, r]));
  list.slice(0, MAX_PATTERNS).forEach((p, i) => {
    const at = `pattern ${i + 1}`;
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return void dropped.push(`${at} is not an object`);
    const title = cutText(text(p.lesson), TITLE_MAX).replace(/\.\.\.$/, '').trim();
    if (title === '') return void dropped.push(`${at} has no title`);
    const m = /^(.+?)\s+rule\s+(\d+)\s*$/i.exec(text(p.rule).trim()) ?? /^()rule\s+(\d+)\s*$/i.exec(text(p.rule).trim());
    if (!m) return void dropped.push(`${at} names no rule`);
    if (m[1] && m[1].trim().toLowerCase() !== group.tag.toLowerCase()) return void dropped.push(`${at} is about another tag (${m[1]})`);
    const n = Number(m[2]);
    const rule = tag.rules.find((r) => r.n === n);
    if (!rule) return void dropped.push(`${at} names rule ${n}, which does not exist`);
    if (group.n !== null && n !== group.n) return void dropped.push(`${at} changes rule ${n}, but the rows cite rule ${group.n}`);
    const body = oneLineRule(p.proposed_text);
    if (body === '') return void dropped.push(`${at} has no text`);
    if (sameRuleText(body, rule.text)) return void dropped.push(`${at} leaves rule ${n} as it is`);
    const keys = [...new Set((Array.isArray(p.keys) ? p.keys : []).map((k) => text(k).trim()))].filter((k) => byKey.has(k));
    if (keys.length < minClaims) return void dropped.push(`${at} rests on ${keys.length} row(s) of the group, fewer than ${minClaims}`);
    const wanted = new Set(keys);
    const rows = group.shown.filter((r) => wanted.has(r.key)); // in the order the group shows them, whatever order the model listed the keys in
    const overlap = ngramOverlap(body, rows.map((r) => r.claim), ngram);
    if (overlap.hit) return void dropped.push(`${at} repeats ${ngram} words of a supporting claim ("${overlap.ngram}")`);
    const kind = group.rows.some((r) => r.reading === 'Rule should change') ? KINDS.change : KINDS.clarify;
    patterns.push({ title, rule: `${group.tag} rule ${n}`, n, kind, text: body, keys: rows.map((r) => r.key), rows, current: rule.text });
  });
  // one lesson per rule inside a reply: the better supported one
  const best = new Map();
  for (const p of patterns) if (!best.has(p.n) || best.get(p.n).rows.length < p.rows.length) best.set(p.n, p);
  const kept = patterns.filter((p) => best.get(p.n) === p);
  for (const p of patterns) if (!kept.includes(p)) dropped.push(`a second change to rule ${p.n} in one reply was left out`);
  return { patterns: kept, dropped, invalid: false };
}

// ---- the lesson row -----------------------------------------------------------------------------------------------------------------

/** The Supporting rows cell: one line per row "the claim cut to 60 characters · key"; beyond `max` characters the rest is "+ n more in the page". */
export function supportingCell(rows, max = 1900) {
  const lines = rows.map((r) => `${cutText(r.claim, 60)} · ${r.key}`);
  const whole = lines.join('\n');
  if (whole.length <= max) return whole;
  for (let kept = lines.length - 1; kept >= 0; kept--) {
    const cell = [...lines.slice(0, kept), `+ ${lines.length - kept} more in the page`].join('\n');
    if (cell.length <= max) return cell;
  }
  return `+ ${lines.length} more in the page`;
}

/** A title no other lesson has: the title, else "<title> (2)", "(3)", ... `taken` holds the titles in use. */
export function uniqueTitle(title, taken) {
  if (!taken.has(title)) return title;
  for (let n = 2; ; n++) if (!taken.has(`${title} (${n})`)) return `${title} (${n})`;
}

const paragraph = (content) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: splitRichText(content) } });

// ---- reading the decisions ----------------------------------------------------------------------------------------------------------

// the readings.jsonl of an earlier run as Map(key -> line); a run without one ends this run (exit 2) with a report that says so
function earlierReadings(ctx, runId) {
  const file = join(ctx.root, 'runs', safeName(runId), 'readings.jsonl');
  if (!existsSync(file)) {
    throw new LoopExit(EXIT.INVALID, `run ${runId} has no readings.jsonl (${file})`, { sentence: 'Distill: nothing was done, because that run holds no readings to reuse.', next: ENGINEER });
  }
  const lines = new Map();
  for (const line of readJsonl(file).rows) if (line && typeof line.key === 'string') lines.set(line.key, line);
  return lines;
}

// a reply the checks refused, kept as it came (runs/<run-id>/rejected/), so that a batch that failed both attempts can be read by a person
function keepRejected(ctx, n, attempt, batch, reply, why) {
  const body = text(reply);
  const shown = body.length > REJECTED_MAX_CHARS ? `${body.slice(0, REJECTED_MAX_CHARS)}\n[cut after ${REJECTED_MAX_CHARS} characters]` : body;
  const head = `reading batch ${n}, attempt ${attempt}, ${batch.length} row(s): ${batch.map((i) => i.key).join(', ')}`;
  writeTextAtomic(join(ensureDir(join(ctx.runDir, 'rejected')), `reading-batch-${n}-attempt-${attempt}.md`), `# Rejected reply\n\n${head}\n\n## Why\n\n${why.map((w) => `- ${w}`).join('\n')}\n\n## Reply as received\n\n${shown}\n`);
}

/**
 * Step 1: make the readings the classification calls for. Verbatim rows are read at once, rows whose hash a --readings run holds are taken from it, and the rest go to the model in
 * batches. Returns { fresh: Map(key -> reading), items: Map(key -> item), unread: [items], kinds }. A usage window, repeated errors or another model end the run (the LoopExit of modelStop).
 */
async function readTheDecisions(ctx, { classes, rubric, rs, cfg, attempts }) {
  const fresh = new Map();
  const items = new Map();
  const unread = [];
  const kinds = { verbatim: 0, reused: 0, model: 0 };
  const file = join(ctx.runDir, 'readings.jsonl');
  writeTextAtomic(file, ''); // always there, empty when nothing is read, so that --readings <this run> can follow any run
  const add = (item, reading, source) => {
    fresh.set(item.key, reading);
    items.set(item.key, item);
    appendJsonl(file, readingRecord(item, reading, source));
  };
  for (const item of classes.verbatim) {
    add(item, verbatimReading(item), 'verbatim');
    kinds.verbatim += 1;
  }
  const earlier = ctx.opts.readings ? earlierReadings(ctx, ctx.opts.readings) : new Map();
  const pending = [];
  for (const item of classes.toRead) {
    const hit = reusableReading(earlier.get(item.key), item, rubric);
    if (hit) {
      add(item, hit, 'model');
      kinds.reused += 1;
    } else pending.push(item);
  }
  const systemPromptFile = codeFile(ctx.root, rs.reading_prompt);
  let n = 0;
  for (const batch of batchesOf(pending, rs.reading_batch)) {
    n += 1;
    const prompt = buildReadingMessage(batch, rubric);
    let accepted = null;
    for (let attempt = 1; attempt <= attempts && accepted === null; attempt++) {
      const res = await callModel(ctx, {
        model: ctx.config.models.distill, systemPromptFile, prompt, effort: rs.reading_effort, timeoutMs: cfg.timeout_ms, purpose: 'reading', meta: { batch: n, attempt, items: batch.length },
      });
      const stop = modelStop(ctx, res);
      if (stop) throw stop;
      if (res.errorKind) continue; // a timeout or an envelope that could not be read: the same message once more
      let value;
      try {
        value = extractJson(res.text);
      } catch (e) {
        keepRejected(ctx, n, attempt, batch, res.text, [`the reply is not valid JSON (${e.message})`]);
        continue;
      }
      const checked = checkReadings(value, batch, rubric);
      if (checked.problems.length) {
        keepRejected(ctx, n, attempt, batch, res.text, checked.problems);
        continue;
      }
      accepted = checked.readings;
    }
    if (accepted === null) {
      unread.push(...batch);
      continue;
    }
    for (const item of batch) add(item, accepted.get(item.key), 'model');
    kinds.model += batch.length;
  }
  return { fresh, items, unread, kinds };
}

// ---- the run ------------------------------------------------------------------------------------------------------------------------

const countWord = (n) => (n === 0 ? 'none' : plural(n, 'decision'));

/** Run distill. opts: pull, planOnly, readings, driver, runId, rows, and the hooks of the other scripts (root, config, io, now, fetchImpl, token, sleep, fakeScript, fakeState, env). */
export async function distill(opts = {}) {
  return withRun({
    script: 'distill', label: 'Distill', again: '/claim-tagger distill', opts,
    args: { pull: opts.pull ?? null, plan_only: opts.planOnly === true, driver: opts.driver ?? 'cli', rows: opts.rows ?? null, readings: opts.readings ?? null },
    resume: resumeLine('distill', [...(opts.driver === 'fake' ? ['--driver', 'fake'] : []), ...(opts.readings ? ['--readings', opts.readings] : [])]),
  }, async (ctx) => {
    await takePull(ctx);
    needTables(ctx, 'tag_decisions', 'rule_changes');
    runPreflight(ctx);
    if (ctx.pull.covers('claims_copy')) needClaimColumns(ctx);
    const rubric = liveRubric(ctx);
    const cfg = ctx.config.distill;
    const rs = readingSettings(ctx.config);
    const jc = judgeSettings(ctx);
    const maxText = ctx.config.notion.max_text;
    const rowCap = ctx.opts.rows ?? DEFAULT_ROW_CAP;
    if (!Number.isInteger(rowCap) || rowCap < 1) throw new LoopExit(EXIT.INVALID, `--rows needs a whole number from 1, got ${rowCap}`, { sentence: 'Distill: nothing was done, because --rows needs a whole number.', next: 'Next: ask the engineer to look at the message the script printed.' });
    const attempts = jc.judge.attempts_per_batch;

    // step 1: the decisions are copied to the ledger rows, and the disagreements are read
    const claims = ctx.pull.claims() ?? [];
    const claimsEntry = ctx.pull.covers('claims_copy') ? tableEntry(ctx.config, 'claims_copy') : null;
    const readingColumn = claimsEntry?.write_columns?.reading ?? null;
    const { changes: copies, rows: queue } = syncDecisions(claims, ctx.pull.queue() ?? [], { tagNames: rubric.tags.map((t) => t.name) });
    const classes = classifyRows({ claims, ledgerRows: queue, rubric, config: ctx.config });
    const made = await readTheDecisions(ctx, { classes, rubric, rs, cfg, attempts });
    const toReadN = classes.verbatim.length + classes.toRead.length;
    const unreadKeys = new Set(made.unread.map((i) => i.key));
    ctx.record.readings = {
      to_read: toReadN, read: made.fresh.size, verbatim: made.kinds.verbatim, reused: made.kinds.reused, model: made.kinds.model, could_not_read: made.unread.map((i) => i.key),
      current: classes.current.length, agree: classes.agree.length, fixed: classes.fixed.length,
    };
    if (classes.unjudged.length) ctx.record.unjudged = classes.unjudged.map((u) => ({ claim: u.claim.geo_id, tag: u.tag }));
    if (classes.orphans.length) ctx.record.not_read_tag_not_judged = classes.orphans.map((i) => i.key);

    // the ledger rows as the plan will leave them: the copies of the decisions, the fresh readings, and no reading on a row that stopped being a disagreement
    const ledgerOps = new Map(copies.map((c) => [c.key, { page_id: c.page_id, changes: { ...c.changes } }]));
    const setCells = (row, cells) => {
      const diff = {};
      for (const [column, value] of Object.entries(cells)) if (!sameCell(row[column], value)) diff[column] = value;
      if (Object.keys(diff).length === 0) return;
      if (!ledgerOps.has(row.Key)) ledgerOps.set(row.Key, { page_id: row.page_id, changes: {} });
      Object.assign(ledgerOps.get(row.Key).changes, diff);
      Object.assign(row, diff);
    };
    for (const [key, reading] of made.fresh) {
      const item = made.items.get(key);
      setCells(item.row, readingCells(item, reading, rubric.edition));
    }
    for (const item of classes.agree) if (READING_COLUMNS.some((c) => text(item.row[c]).trim() !== '')) setCells(item.row, clearedReadingCells());

    // the claims' Agent reading: one cell per Reviewed claim whose disagreements all have a reading after this run
    const claimOps = [];
    if (readingColumn) {
      const itemsOf = new Map();
      for (const list of [classes.verbatim, classes.toRead, classes.current, classes.agree, classes.fixed]) {
        for (const item of list) itemsOf.set(item.claim.geo_id, [...(itemsOf.get(item.claim.geo_id) ?? []), item]);
      }
      const unjudgedOf = new Map();
      for (const u of classes.unjudged) unjudgedOf.set(u.claim.geo_id, [...(unjudgedOf.get(u.claim.geo_id) ?? []), u]);
      for (const claim of claims) {
        if (!isReviewed(claim)) continue;
        const cell = claimReadingCell({ claim, items: itemsOf.get(claim.geo_id) ?? [], readings: made.fresh, unjudged: unjudgedOf.get(claim.geo_id) ?? [] });
        if (cell !== null && !sameCell(claim.agent_reading, cell)) claimOps.push({ geo_id: claim.geo_id, page_id: claim.page_id, cell });
      }
    }

    // step 2: the lessons, from the rows as the plan leaves them (a row whose batch could not be read has no usable reading this run)
    const groupQueue = queue.map((r) => (unreadKeys.has(r.Key) ? { ...r, 'Agent reading': null, Rule: null, 'Reading note': null } : r));
    const lessons = ctx.pull.lessons() ?? [];
    const openLessons = lessons.filter((l) => l.Status === 'Proposed' || l.Status === 'Approved');
    const { groups, counts } = buildGroups({ queue: groupQueue, rubric, config: ctx.config, minClaims: cfg.min_claims, rowCap, openLessons });
    ctx.record.groups = groups.map((g) => ({ tag: g.tag, rule: g.n, rows: g.rows.length, shown: g.shown.map((r) => r.key), counter: g.counter.map((r) => r.key) }));

    // one model call per group
    const canaries = readEvals(ctx.root).canaries;
    const examplesOf = (tag) => canaries.filter((c) => c.tag === tag);
    const systemPromptFile = codeFile(ctx.root, cfg.prompt);
    const candidates = [];
    const dropped = [];
    let unreadable = 0;
    for (const group of groups) {
      const prompt = buildMessage(group, rubric, examplesOf(group.tag));
      let checked = null;
      let problem = null;
      for (let attempt = 1; attempt <= attempts && checked === null; attempt++) {
        const res = await callModel(ctx, {
          model: ctx.config.models.distill, systemPromptFile, prompt, effort: cfg.effort, timeoutMs: cfg.timeout_ms, purpose: 'distill', meta: { tag: group.tag, rule: group.n, attempt, items: group.shown.length },
        });
        const stop = modelStop(ctx, res);
        if (stop) throw stop;
        if (res.errorKind) {
          problem = res.message;
          continue;
        }
        let value;
        try {
          value = extractJson(res.text);
        } catch (e) {
          problem = `the reply is not valid JSON (${e.message})`;
          continue;
        }
        const r = checkReply(value, group, rubric, { minClaims: cfg.min_claims, ngram: cfg.overfit_ngram });
        if (r.invalid) {
          problem = r.dropped.join('; ');
          continue;
        }
        checked = r;
      }
      if (checked === null) {
        unreadable += 1;
        dropped.push(`${group.tag} rule ${group.n ?? 'none'}: ${problem}`);
        continue;
      }
      dropped.push(...checked.dropped.map((d) => `${group.tag}: ${d}`));
      for (const p of checked.patterns) candidates.push({ ...p, tag: group.tag, groupRows: group.rows.length });
    }

    // ranked by distinct supporting claims; one lesson per rule; no rule that already has an open lesson (a group that named no rule is checked here)
    const taken = new Set(lessons.map((l) => l.Lesson));
    candidates.sort((a, b) => b.rows.length - a.rows.length);
    const kept = [];
    for (const p of candidates) {
      if (kept.length >= cfg.max_lessons_per_run) break;
      if (kept.some((k) => k.tag === p.tag && k.n === p.n)) continue;
      if (openLessons.some((l) => l.Tag === p.tag && ruleNumberOf(l.Rule) === p.n)) {
        dropped.push(`${p.tag} rule ${p.n} already has a rule change waiting`);
        continue;
      }
      const title = uniqueTitle(p.title, taken);
      taken.add(title);
      kept.push({ ...p, title });
    }
    ctx.record.lessons = kept.map((k) => ({ title: k.title, rule: k.rule, kind: k.kind, rows: k.keys }));
    if (dropped.length) ctx.record.dropped = dropped.slice(0, 30);

    const plan = newPlan({ runId: ctx.runId, script: 'distill', rubricEdition: rubric.edition, config: ctx.config, now: ctx.now });
    const lessonSchema = readJson(codeFile(ctx.root, 'schemas', 'lesson.schema.json'));
    for (const [key, op] of ledgerOps) plan.update('tag_decisions', key, op.page_id, op.changes);
    for (const c of claimOps) plan.update('claims_copy', c.geo_id, c.page_id, { [readingColumn]: c.cell });
    for (const k of kept) {
      const row = {
        Lesson: k.title, Tag: k.tag, Rule: k.rule, Kind: k.kind, 'Current text': k.current, 'Proposed text': k.text, Status: 'Proposed', 'Supporting rows': supportingCell(k.rows, maxText),
      };
      const bad = validate(lessonSchema, row).errors; // every record is checked against its schema before the next step reads it
      if (bad.length) throw new LoopExit(EXIT.INVALID, `the rule change "${k.title}" is not a valid Rule changes row: ${bad.slice(0, 3).join('; ')}`, { sentence: 'Distill: nothing was written, because a drafted rule change is not valid.', next: ENGINEER });
      plan.create('rule_changes', k.title, row, { children: k.rows.map((r) => paragraph(`${r.claim} · ${r.key}`)) });
    }
    addSettingsOp(ctx, plan, `Distill · ${stampOf(ctx.now())} · ${kept.length === 0 ? 'no rule change' : plural(kept.length, 'rule change')}`, rubric.edition);
    const { result } = await applyStep(ctx, plan);

    // what the run says about itself
    const readN = made.fresh.size;
    const unreadN = made.unread.length;
    const nothingStale = toReadN === 0;
    const kinds = [...made.fresh.values()];
    const tally = {
      rule: kinds.filter((r) => RULE_WHY.has(r.reading)).length,
      slips: kinds.filter((r) => r.reading === 'Agent slip').length,
      noNote: [...made.fresh.keys()].filter((key) => made.items.get(key).reasonWord === null && text(made.items.get(key).noteLine).trim() === '').length,
    };
    const differing = [...classes.verbatim, ...classes.toRead, ...classes.current].filter((i) => i.reasonWord === null && text(i.noteLine).trim() === '');
    const needNote = new Set(differing.map((i) => i.claim.geo_id)).size;
    const details = {
      lessons: kept.map((k) => ({ title: k.title, rule: k.rule, kind: k.kind, keys: k.keys })), dropped, unreadable, counts, result, readings: ctx.record.readings,
    };
    const link = viewLink(ctx.config, 'lessons_waiting');
    const noteLink = viewLink(ctx.config, 'needs_your_note');
    const tableRows = readN > 0
      ? [
        ['Read', plural(readN, 'decision'), ''], ['Point at a rule', countWord(tally.rule), ''], ['Agent slips', countWord(tally.slips), ''], ['Without a note', countWord(tally.noNote), ''],
        ['Rule change', ruleChangeCell(kept), ''],
      ]
      : (kept.length ? [['Rule change', ruleChangeCell(kept), '']] : []);
    const counted = { lessons: kept.length, groups: groups.length, decisions_copied: copies.length, readings: readN, could_not_read: unreadN };
    // exit 2 only when something was to read, nothing at all could be read, and no rule change was drafted; a run that drafted one from the readings of earlier runs is a success whose sentence
    // still says how many decisions could not be read this time (READ-DECISIONS.md, section 5)
    const exit = toReadN > 0 && readN === 0 && kept.length === 0 ? EXIT.INVALID : EXIT.OK;

    if (ctx.opts.planOnly) {
      ctx.record.live_step = resumeFor(ctx.root, resumeLine('distill', [...(ctx.driver === 'fake' ? ['--driver', 'fake'] : []), '--readings', ctx.runId])); // the live step: it reuses these readings and asks the model for no row whose hash is unchanged
      const parts = [...(readN > 0 ? [`${plural(readN, 'decision')} read`] : []), plural(kept.length, 'rule change'), ...(unreadN > 0 ? [`${unreadN} not read`] : [])];
      return {
        exit,
        sentence: `Distill: the plan is ready (${parts.join(', ')}) and nothing was written to Notion.`,
        rows: tableRows,
        next: 'Next: type /claim-tagger distill to write it.',
        details,
        counts: counted,
      };
    }
    assertApplied(ctx, result);

    const tail = unreadN > 0 ? `; ${unreadN} could not be read this time` : '';
    if (kept.length === 0) {
      let why;
      if (unreadable > 0) why = 'the replies could not be used';
      else if (candidates.length > 0 || dropped.length > 0) why = 'none of the drafts passed the checks';
      else if (counts.ruleRows === 0 && unreadN > 0) why = 'none of the decisions read so far names a rule problem';
      else if (counts.ruleRows === 0) why = counts.decided === 0 ? 'no row is decided yet' : `${plural(counts.decided, 'decided row')} ${counts.decided === 1 ? 'names' : 'name'} no rule problem`;
      else if (counts.ruleRowsFollowed === counts.ruleRows) why = 'a rule change was already made for every decided row that names a rule problem';
      else if (counts.groupsOpen > 0 && groups.length === 0) why = 'the rules the rows point at already have a rule change waiting';
      else if (counts.ruleRowsNotJudged === counts.ruleRows - counts.ruleRowsFollowed) why = 'the rows that name a rule problem are about tags the agent does not judge yet';
      else if (groups.length === 0) why = `no rule has ${cfg.min_claims} decided rows pointing at it yet`;
      else why = 'the rows do not point at a change that is safe to make';
      let sentence;
      if (readN > 0) sentence = `Distill: read ${readN} of your decisions; no rule change to draft; ${why}${tail}.`;
      else if (unreadN > 0) sentence = `Distill: no decision could be read this time; no rule change to draft; ${why}.`;
      else sentence = `Distill: nothing new to read; no rule change to draft; ${why}.`;
      return {
        exit: unreadable > 0 ? EXIT.INVALID : exit,
        sentence,
        rows: tableRows,
        next: needNote > 0 ? needNoteNext(needNote, noteLink) : 'Next: type /claim-tagger status to see what is open.',
        details,
        counts: counted,
      };
    }
    const noteRows = new Set(kept.flatMap((k) => k.keys)).size;
    const one = kept.length === 1;
    const drafted = `${one ? 'one rule change' : `${kept.length} rule changes`} from your ${plural(noteRows, 'note')}`;
    let lead;
    if (readN > 0) lead = `read ${readN} of your decisions and drafted ${drafted}`;
    else lead = `${nothingStale ? 'nothing new to read; ' : ''}drafted ${drafted}`;
    return {
      exit,
      sentence: `Distill: ${lead}${tail}.`,
      rows: tableRows,
      next: `Next: read ${one ? 'it' : 'them'} in Lessons waiting (${link}), where the current and the proposed text sit side by side, and approve ${one ? 'it' : 'each one'} or write your own wording.`,
      details,
      counts: counted,
    };
  });
}

const ruleChangeCell = (kept) => (kept.length === 0 ? 'none' : kept.length === 1 ? `${quoted(kept[0].title)}, ${kept[0].rule}` : `${kept.length} drafted`);
const needNoteNext = (n, link) => `Next: add a note on ${plural(n, 'claim')} in Needs your note (${link}), then type /claim-tagger distill again.`;

// ---- the command line -----------------------------------------------------------------------------------------------------------------

const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Parse the command line and run; returns the exit code. deps (tests): everything distill() takes besides the flags. */
export async function main(argv, io = consoleIo, deps = {}) {
  const parsed = parseCli('distill', argv, { pull: { type: 'string' }, 'plan-only': { type: 'boolean' }, 'run-id': { type: 'string' }, rows: { type: 'string' }, readings: { type: 'string' } }, USAGE, io);
  if (parsed.exit !== undefined) return parsed.exit;
  const v = parsed.values;
  if (v.rows !== undefined && !/^[1-9]\d*$/.test(v.rows)) {
    io.err(`distill: --rows needs a whole number from 1, got "${v.rows}"\n${USAGE}`);
    return EXIT.INVALID;
  }
  try {
    return (await distill({
      ...deps, io, pull: v.pull, planOnly: v['plan-only'] === true, readings: v.readings ?? deps.readings, driver: v.driver ?? deps.driver, runId: v['run-id'], rows: v.rows ? Number(v.rows) : deps.rows,
    })).exit;
  } catch (e) {
    io.err(`distill: unexpected error: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
