#!/usr/bin/env node
// Distill: turns the editors' "the rule is the problem" decisions into proposed rule changes. It reads the decided rows of Tag decisions (the agent's
// ledger, which holds a copy of every decision an editor made on a claim), groups the ones whose Why wrong is Rule unclear or Rule should change by (tag, the
// rule they cite), asks the distill model once per group for at most three patterns, checks every reply, and writes a Rule changes row (Status Proposed) per
// kept lesson. It never changes a rule: a rule changes only through an Approved lesson, a safety check PASS and the promote step.
//
// The copy of a decision is made by the tag step; a claim an editor Reviewed since the last tag step has none yet. So distill first brings the ledger up to date:
// for every Reviewed claim, the ledger rows of its judged tags get the copy (Tag outcome, Why wrong, Your reasoning, Decided under; lib/decisions.mjs), in the same
// plan, and the groups are made from the rows as they will be then. Nothing else of the ledger is touched, and no column of the claim is written.
//
//   node agents/claim-tagger-mvp/scripts/distill.mjs [--pull <pull-id>] [--plan-only] [--driver cli|fake] [--run-id <id>] [--rows <n>]
//
//   --pull <id>    use that pull instead of pulling every table first
//   --plan-only    make and check the plan and stop; the model is still asked, nothing is sent to Notion
//   --driver       cli (default) or fake (tests)
//   --run-id       name the run folder (default <UTC stamp>-distill)
//   --rows <n>     the most rows one group shows the model (default 30; tests use a small number)
//
// Grouping. citedRule(row) is the rule the editor names in Your reasoning ("rule 4", with or without the tag's name), else the rule the agent cited
// in Agent reason ("<Tag> rule 4"), else none ("whole"). A group needs distill.min_claims distinct claims. Only tags that are judged and have the
// rule are considered (the safety check can only test those). A group that already has an open lesson (Status Proposed or Approved) on the same tag
// and rule is skipped. A group above the row cap shows the newest rows with the editor's reasoning first, both outcomes represented. The model also
// sees up to 12 decided rows of the same tag and rule that were decided the other way (counter-evidence) and the tag's example claims.
//
// The reply is checked: at most 3 patterns; each names a rule that exists (the cited one when the group has one), a kind of "Clarify wording" or
// "Change the rule", a text that differs from the rule as it stands, and the keys of at least distill.min_claims rows of the group; a text that
// repeats distill.overfit_ngram (8) consecutive words of a supporting claim is dropped; one lesson per rule; the best-supported distill.max_lessons_per_run
// (3) are kept. The Rule changes row holds the title (unique: " (2)" is added when needed), tag, rule, kind, the rule as it stands, the proposed text
// and one line per supporting row ("the claim cut to 60 characters · key", spilling to the page body with "+ n more in the page"); the page body
// holds every supporting claim in full, with its key.
//
// Exit codes: 0 ok (also when nothing qualifies), 1 stopped (the same command continues), 2 invalid, 3 paused, 4 drift or another model, 75 usage window.
//
// Exports: distill, citedRule, buildGroups, buildMessage, checkReply, ngramOverlap, supportingCell, uniqueTitle, main, USAGE.

import { EXIT } from './lib/exit-codes.mjs';
import { groupOf } from './lib/config.mjs';
import { syncDecisions } from './lib/decisions.mjs';
import { cutText, plural, quoted, stampOf, viewLink } from './lib/editor-words.mjs';
import { extractJson } from './lib/claude.mjs';
import { LoopExit, addSettingsOp, applyStep, assertApplied, callModel, judgeSettings, liveRubric, modelStop, needClaimColumns, needTables, parseCli, readEvals, resumeLine, runPreflight, takePull, withRun } from './lib/loop.mjs';
import { readJson } from './lib/jsonl.mjs';
import { splitRichText } from './lib/notion-rest.mjs';
import { codeFile, isMain } from './lib/paths.mjs';
import { newPlan } from './lib/plan.mjs';
import { oneLineRule, ruleNumberOf } from './lib/rulebook-edit.mjs';
import { validate } from './lib/validate.mjs';

const ENGINEER = 'Next: ask the engineer to look at the message the script printed.';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/distill.mjs [--pull <pull-id>] [--plan-only] [--driver cli|fake] [--run-id <id>] [--rows <n>]';

const RULE_WHY = new Set(['Rule unclear', 'Rule should change']);
const KINDS = new Map([
  ['clarify wording', 'Clarify wording'], ['change the rule', 'Change the rule'], ['rule unclear', 'Clarify wording'], ['rule should change', 'Change the rule'],
]);
const COUNTER_ROWS = 12;
const DEFAULT_ROW_CAP = 30;
const MAX_PATTERNS = 3;
const TITLE_MAX = 60;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const outcomeOf = (row) => row['Tag outcome'];

// ---- the cited rule -----------------------------------------------------------------------------------------------------------------

/** The rule number a decided row points at: "rule N" in Your reasoning first, then "<Tag> rule N" in Agent reason (the last one: the rule the agent cited is at the end), else null. */
export function citedRule(row) {
  const mine = /\brule\s*#?\s*(\d+)\b/i.exec(text(row['Your reasoning']));
  if (mine) return Number(mine[1]);
  const re = new RegExp(`${escapeRe(text(row.Tag))}\\s+rule\\s+(\\d+)`, 'gi');
  let last = null;
  for (const m of text(row['Agent reason']).matchAll(re)) last = Number(m[1]);
  return last;
}

// ---- the groups ---------------------------------------------------------------------------------------------------------------------

const rowOf = (r) => ({
  key: r.Key, page_id: r.page_id, tag: r.Tag, claim: text(r.Claim), outcome: outcomeOf(r), why: r['Why wrong'] ?? null, reasoning: text(r['Your reasoning']).trim(),
  agentReason: text(r['Agent reason']).trim(), proposal: r['Agent proposal'] ?? null, confidence: r['Agent confidence'] ?? null, edited: text(r.last_edited), n: citedRule(r),
});

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
 * The groups of decided rows to ask the model about. `queue` is the pull's Tag decisions rows, `rubric` the rulebook in force, `openLessons` the lessons
 * with Status Proposed or Approved ({ Tag, Rule }). Returns { groups, counts } with counts { decided, ruleRows, ruleRowsNotJudged, groupsTooSmall, groupsOpen }.
 * A group: { tag, n (the cited rule number or null), rows (all), shown, counter, current (the cited rule's text or null) }.
 */
export function buildGroups({ queue, rubric, config, minClaims = 2, rowCap = DEFAULT_ROW_CAP, openLessons = [] }) {
  const decided = queue.filter((r) => r.decided && r.Key && r.Tag).map(rowOf);
  const counts = { decided: decided.length, ruleRows: 0, ruleRowsNotJudged: 0, groupsTooSmall: 0, groupsOpen: 0 };
  const byGroup = new Map();
  for (const r of decided) {
    if (!RULE_WHY.has(r.why)) continue;
    counts.ruleRows += 1;
    const tag = rubric.tags.find((t) => t.name === r.tag);
    if (!tag || !tag.judged || groupOf(config, tag.name) === null || tag.rules.length === 0) {
      counts.ruleRowsNotJudged += 1;
      continue;
    }
    const n = r.n !== null && tag.rules.some((x) => x.n === r.n) ? r.n : null;
    const id = `${r.tag}\u0000${n ?? 'whole'}`;
    if (!byGroup.has(id)) byGroup.set(id, { tag: r.tag, n, rows: [] });
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

const esc = (s) => text(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;').replace(/[\r\n]+/g, ' ');

/** The user message of one group: the tag and its rules, the cited rule, the examples, the rows and the counter-evidence, every free text escaped (it is data). */
export function buildMessage(group, rubric, examples = []) {
  const tag = rubric.tags.find((t) => t.name === group.tag);
  const row = (r) => [
    `<row key="${attr(r.key)}" outcome="${attr(r.outcome)}" why_wrong="${attr(r.why ?? '')}"${r.proposal ? ` agent_proposal="${attr(r.proposal)}"` : ''}${r.confidence !== null && r.confidence !== undefined ? ` agent_confidence="${attr(r.confidence)}"` : ''}>`,
    `<claim>${esc(r.claim)}</claim>`,
    `<reasoning>${esc(r.reasoning)}</reasoning>`,
    ...(r.agentReason ? [`<agent_reason>${esc(r.agentReason)}</agent_reason>`] : []),
    '</row>',
  ].join('\n');
  const parts = [
    `<tag name="${attr(tag.name)}">`,
    ...(tag.description ? [`Description: ${esc(tag.description)}`] : []),
    'Rules:',
    ...[...tag.rules].sort((a, b) => a.n - b.n).map((r) => `${r.n}. ${esc(r.text)}`),
    '</tag>',
    group.n === null ? '<cited_rule n="none">The editors name no rule.</cited_rule>' : `<cited_rule n="${group.n}">${esc(group.current)}</cited_rule>`,
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
 * reason, when it is not an object, names no usable title or text, names a rule that does not exist or is not the cited one, has a kind other than the two,
 * leaves the rule as it is, rests on fewer than minClaims rows of the group, or repeats `ngram` words of a supporting claim. At most 3 patterns are read.
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
    const kind = KINDS.get(text(p.kind).trim().toLowerCase());
    if (!kind) return void dropped.push(`${at} has a kind that is neither Clarify wording nor Change the rule`);
    const body = oneLineRule(p.proposed_text);
    if (body === '') return void dropped.push(`${at} has no text`);
    if (sameRuleText(body, rule.text)) return void dropped.push(`${at} leaves rule ${n} as it is`);
    const keys = [...new Set((Array.isArray(p.keys) ? p.keys : []).map((k) => text(k).trim()))].filter((k) => byKey.has(k));
    if (keys.length < minClaims) return void dropped.push(`${at} rests on ${keys.length} row(s) of the group, fewer than ${minClaims}`);
    const wanted = new Set(keys);
    const rows = group.shown.filter((r) => wanted.has(r.key)); // in the order the group shows them, whatever order the model listed the keys in
    const overlap = ngramOverlap(body, rows.map((r) => r.claim), ngram);
    if (overlap.hit) return void dropped.push(`${at} repeats ${ngram} words of a supporting claim ("${overlap.ngram}")`);
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

// ---- the run ------------------------------------------------------------------------------------------------------------------------

/** Run distill. opts: pull, planOnly, driver, runId, rows, and the hooks of the other scripts (root, config, io, now, fetchImpl, token, sleep, fakeScript, fakeState, env). */
export async function distill(opts = {}) {
  return withRun({
    script: 'distill', label: 'Distill', again: '/claim-tagger distill', opts,
    args: { pull: opts.pull ?? null, plan_only: opts.planOnly === true, driver: opts.driver ?? 'cli', rows: opts.rows ?? null },
    resume: resumeLine('distill', opts.driver === 'fake' ? ['--driver', 'fake'] : []),
  }, async (ctx) => {
    await takePull(ctx);
    needTables(ctx, 'tag_decisions', 'rule_changes');
    runPreflight(ctx);
    if (ctx.pull.covers('claims_copy')) needClaimColumns(ctx);
    const rubric = liveRubric(ctx);
    const cfg = ctx.config.distill;
    const jc = judgeSettings(ctx);
    const maxText = ctx.config.notion.max_text;
    const rowCap = ctx.opts.rows ?? DEFAULT_ROW_CAP;
    if (!Number.isInteger(rowCap) || rowCap < 1) throw new LoopExit(EXIT.INVALID, `--rows needs a whole number from 1, got ${rowCap}`, { sentence: 'Distill: nothing was done, because --rows needs a whole number.', next: 'Next: ask the engineer to look at the message the script printed.' });

    const { changes: copies, rows: queue } = syncDecisions(ctx.pull.claims() ?? [], ctx.pull.queue() ?? []);
    const lessons = ctx.pull.lessons() ?? [];
    const openLessons = lessons.filter((l) => l.Status === 'Proposed' || l.Status === 'Approved');
    const { groups, counts } = buildGroups({ queue, rubric, config: ctx.config, minClaims: cfg.min_claims, rowCap, openLessons });
    ctx.record.groups = groups.map((g) => ({ tag: g.tag, rule: g.n, rows: g.rows.length, shown: g.shown.map((r) => r.key), counter: g.counter.map((r) => r.key) }));

    // one model call per group
    const canaries = readEvals(ctx.root).canaries;
    const examplesOf = (tag) => canaries.filter((c) => c.tag === tag);
    const systemPromptFile = codeFile(ctx.root, cfg.prompt);
    const attempts = jc.judge.attempts_per_batch;
    const candidates = [];
    const dropped = [];
    let unreadable = 0;
    for (const group of groups) {
      const prompt = buildMessage(group, rubric, examplesOf(group.tag));
      let checked = null;
      let problem = null;
      for (let attempt = 1; attempt <= attempts && checked === null; attempt++) {
        const res = await callModel(ctx, { model: ctx.config.models.distill, systemPromptFile, prompt, effort: cfg.effort, timeoutMs: cfg.timeout_ms });
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
    for (const c of copies) plan.update('tag_decisions', c.key, c.page_id, c.changes);
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
    const details = { lessons: kept.map((k) => ({ title: k.title, rule: k.rule, kind: k.kind, keys: k.keys })), dropped, unreadable, counts, result };
    const link = viewLink(ctx.config, 'lessons_waiting');
    if (ctx.opts.planOnly) {
      return {
        exit: EXIT.OK,
        sentence: `Distill: the plan is ready (${plural(kept.length, 'rule change')}) and nothing was written to Notion.`,
        rows: kept.length ? kept.map((k) => ['Rule change', quoted(k.title), '']) : [],
        next: 'Next: type /claim-tagger distill to write it.',
        details,
      };
    }
    assertApplied(ctx, result);

    if (kept.length === 0) {
      let why;
      if (unreadable > 0) why = 'the replies could not be used';
      else if (candidates.length > 0 || dropped.length > 0) why = 'none of the drafts passed the checks';
      else if (counts.ruleRows === 0) why = counts.decided === 0 ? 'no row is decided yet' : `${plural(counts.decided, 'decided row')} ${counts.decided === 1 ? 'names' : 'name'} no rule problem`;
      else if (counts.groupsOpen > 0 && groups.length === 0) why = 'the rules the rows point at already have a rule change waiting';
      else if (counts.ruleRowsNotJudged === counts.ruleRows) why = 'the rows that name a rule problem are about tags the agent does not judge yet';
      else if (groups.length === 0) why = `no rule has ${cfg.min_claims} decided rows pointing at it yet`;
      else why = 'the rows do not point at a change that is safe to make';
      return {
        exit: unreadable > 0 ? EXIT.INVALID : EXIT.OK,
        sentence: `Distill: no rule change to draft; ${why}.`,
        rows: [],
        next: 'Next: type /claim-tagger status to see what is open.',
        details,
      };
    }
    const noteRows = new Set(kept.flatMap((k) => k.keys)).size;
    const one = kept.length === 1;
    const rows = one
      ? [['Rule change', quoted(kept[0].title), ''], ['Rule', `${kept[0].rule}, Proposed`, ''], ['Rests on', `your ${plural(kept[0].keys.length, 'row')}`, '']]
      : kept.map((k) => [quoted(k.title), `${k.rule}, Proposed`, `your ${plural(k.keys.length, 'row')}`]);
    return {
      exit: EXIT.OK,
      sentence: `Distill: ${one ? 'one rule change' : `${kept.length} rule changes`} drafted from your ${plural(noteRows, 'note')}.`,
      header: one ? undefined : ['Rule change', 'Rule', 'Rests on'],
      rows,
      next: `Next: read ${one ? 'it' : 'them'} in Lessons waiting (${link}), where the current and the proposed text sit side by side, and approve ${one ? 'it' : 'each one'} or write your own wording.`,
      details,
      counts: { lessons: kept.length, groups: groups.length, decisions_copied: copies.length },
    };
  });
}

// ---- the command line -----------------------------------------------------------------------------------------------------------------

const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Parse the command line and run; returns the exit code. deps (tests): everything distill() takes besides the flags. */
export async function main(argv, io = consoleIo, deps = {}) {
  const parsed = parseCli('distill', argv, { pull: { type: 'string' }, 'plan-only': { type: 'boolean' }, 'run-id': { type: 'string' }, rows: { type: 'string' } }, USAGE, io);
  if (parsed.exit !== undefined) return parsed.exit;
  const v = parsed.values;
  if (v.rows !== undefined && !/^[1-9]\d*$/.test(v.rows)) {
    io.err(`distill: --rows needs a whole number from 1, got "${v.rows}"\n${USAGE}`);
    return EXIT.INVALID;
  }
  try {
    return (await distill({ ...deps, io, pull: v.pull, planOnly: v['plan-only'] === true, driver: v.driver ?? deps.driver, runId: v['run-id'], rows: v.rows ? Number(v.rows) : deps.rows })).exit;
  } catch (e) {
    io.err(`distill: unexpected error: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
