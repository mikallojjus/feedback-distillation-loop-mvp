#!/usr/bin/env node
// distill: turn the editors' "the rule is the problem" decisions into proposed rule changes (lessons).
//
//   node agents/claim-tagger/scripts/distill.mjs [--pull <id>] [--run-id <id>] [--driver cli|fake] [--model <id>]
//   node agents/claim-tagger/scripts/distill.mjs --demo-bad-lesson <path> [--pull <id>] [--run-id <id>]
//   node agents/claim-tagger/scripts/distill.mjs --link --run <id> [--pull <id>] [--run-id <id>]
//
// 1. From the pull: decided rows whose Why wrong is Rule unclear or Rule should change (editor rows), plus seeded rows whose Seeded reasoning starts
//    "Rule should change:" (treated as Rule should change). Rows are grouped by (tag, why wrong, the rule the agent cited: "<Tag> rule <n>" in its
//    notes, else the tag's description; rows that cite nothing join the one rule the others cite, see groupRows) and a group counts its DISTINCT claims. A group is worth a lesson at config.distill.min_claims (Rule unclear),
//    min_claims_rule_change (Rule should change), or at owner_ruling_at claims with owner_ruling_route true: the lesson is then marked as resting on
//    the owner's ruling (the rule owner's Approved counts as the ruling).
// 2. Dedupe: a group on a tag that already has a Proposed, Approved or Live lesson (for the same rule when both are known) only links its unlinked
//    rows to that lesson. A Rejected or Rolled back lesson stands unless at least 2 rows were decided after it was created.
// 3. One model call per group through lib/claude.mjs (--tools "", model config.models.distill, system prompt prompts/distill.md, the user message is the
//    JSON the prompt describes). The reply is parsed with extractJson and checked; current_text ALWAYS comes from the rubric (composeWhenToUse of the
//    targeted part). A proposed_text that repeats config.distill.overfit_ngram (8) consecutive words of a supporting claim gets one retry with a note,
//    then the lesson is flagged overfit_risk. At most two calls per group.
// 4. --demo-bad-lesson <path>: no model. The lesson comes from the JSON file (evals/seed/demo-bad-lesson.json): a labelled, deliberately bad lesson that
//    the gate is expected to FAIL.
// 5. Output: plan A (runs/<run-id>/plan.jsonl) creates the Rule changes rows (Status Proposed) and a Runs row "Distill <date>"; lessons.jsonl holds
//    the lessons (lesson.schema.json); plan-link.jsonl says which Tag decisions rows support which new lesson. A row can only be linked to a lesson
//    that exists, and plans cannot point at rows created in the same plan, so linking is a second step: apply plan A, pull, then
//    `distill.mjs --link --run <id>` builds plan B (<id>-link: Tag decisions.Lesson) and marks the linked rows' cases contested in evals/cases.jsonl.
//
// Which part of a rule a lesson changes: "<Tag> rule <n>" (current_text = "<n>. <rule text>", proposed_text = the new rule text without the number),
// or "<Tag> when to use" for a note or preamble (both texts are then the whole When to use). promote.mjs reads the same two forms.
//
// Exit codes: 0 ok (also "nothing to propose"), 1 error, 2 invalid (no pull, a pull without Tag decisions or Rule changes, a bad demo file, a run
// that was not applied), 3 paused, 4 rubric drift or lock mismatch or the wrong model answered, 75 the usage window ran out (nothing was written).

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { controlPaths } from './allowlist.mjs';
import { FAKE_CLAUDE_SCRIPT, extractJson, findClaudeBin, runClaude, usageResetHint } from './lib/claude.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { readJson, readJsonl, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { normId } from './lib/notion-values.mjs';
import { agentRoot, isMain, repoRoot, runId as makeRunId, safeName } from './lib/paths.mjs';
import { compareCodePoints } from './lib/pyjson.mjs';
import { composeWhenToUse, normaliseText } from './lib/rubric-build.mjs';
import { validate } from './lib/validate.mjs';
import { citedRule, claimTexts, decidedAtOf, lessonIndex, reasoningOf, ruleWhyOf, syncCases } from './cases-sync.mjs';
import { openPlan } from './plan.mjs';
import { latestPullId, loadConfig, loadPull } from './pull.mjs';
import { preflight } from './status.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/distill.mjs [--pull <id>] [--demo-bad-lesson <path>] [--run-id <id>] [--driver cli|fake] [--model <id>] | --link --run <id> [--pull <id>] [--run-id <id>]';

export const OVERFIT_NOTE_MARK = 'The previous proposed_text repeats';
const KINDS = ['Clarify wording', 'Add boundary example', 'Change the rule'];
const ACTIVE_STATUSES = new Set(['Proposed', 'Approved', 'Live']);
const MAX_TEXT = 1900;
const MAX_OTHER_ROWS = 12;
const MAX_GROUP_ROWS = 30;

class UsageError extends Error {}

/** An error that ends the command with an exit code and a plain-words message. */
export class ExitError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---- targets: which text of the rubric a lesson is about -----------------------------------------------------------------------

const oneLine = (s) => normaliseText(String(s ?? '')).replace(/\s*\n\s*/g, ' ').trim();

/** "Predictive rule 1" -> { part: "rule", rule_n: 1 }; "Predictive when to use" -> { part: "whole" }; anything else -> null. */
export function parseRuleLabel(label, tag) {
  const text = oneLine(label);
  const rule = new RegExp(`^${String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+rule\\s+(\\d+)$`, 'i').exec(text);
  if (rule) return { part: 'rule', rule_n: Number(rule[1]) };
  if (new RegExp(`^${String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+when to use$`, 'i').test(text) || /^when to use$/i.test(text)) return { part: 'whole', rule_n: null };
  return null;
}

/** The label a lesson carries in the Rule column for a target. */
export const ruleLabel = (tag, target) => (target.part === 'rule' ? `${tag} rule ${target.rule_n}` : `${tag} when to use`);

/**
 * The composed text of the targeted part, as it stands in the rubric: "<n>. <rule text>" for a rule, the whole When to use for "whole", the
 * preamble line or the "Note: ..." line. null when the tag or the rule does not exist.
 */
export function targetCurrentText(rubric, tagName, target) {
  const tag = rubric.tags.find((t) => t.name === tagName);
  if (!tag) return null;
  const w = tag.when_to_use;
  switch (target.part) {
    case 'rule': {
      const rule = w.rules.find((r) => r.n === target.rule_n);
      return rule ? composeWhenToUse({ rules: [rule] }) : null;
    }
    case 'preamble': return composeWhenToUse({ preamble: w.preamble });
    case 'note': return composeWhenToUse({ note: w.note });
    case 'whole': return composeWhenToUse(w);
    default: return null;
  }
}

/** The text a rule would get from an effective text: a leading "<n>. " an editor typed is dropped. */
export const stripRuleNumber = (text) => oneLine(text).replace(/^\d+\.\s+/, '');

// ---- the overfit check ---------------------------------------------------------------------------------------------------------

const words = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);

/**
 * Whether `text` repeats `n` or more consecutive words of any of the claims: { hit, claim, ngram }. A claim shorter than n words (but at least 5)
 * counts when the text repeats the whole claim.
 */
export function ngramOverlap(text, claims, n = 8) {
  const t = words(text);
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

// ---- the rows and groups ----------------------------------------------------------------------------------------------------------

/** One decided row as distill reads it. */
function toRow(r, texts) {
  const rw = ruleWhyOf(r);
  return {
    key: r.key, page_id: r.page_id, geo_id: r.geo_id, tag: r.tag, why: rw?.why ?? null, source: rw?.source ?? null,
    claim: texts.get(r.geo_id)?.claim ?? null, outcome: r.effective_outcome, reasoning: reasoningOf(r), agent_proposal: r.agent_proposal ?? null,
    agent_reason: r.why_i_recommend_this ?? null, rule_n: citedRule(r, r.tag), decided_at: decidedAtOf(r), lesson_page_ids: r.lesson_page_ids ?? [],
  };
}

/**
 * [{ tag, why, rule_n, rows }] in a stable order: the rows of one tag and one reason, split by the rule the agent cited ("<Tag> rule <n>" in its notes).
 * Rows that cite no rule (the audit's seeded decisions never do) join the group of the one rule the others cite; when two or more different rules are
 * cited they keep a group of their own (rule_n null, "the tag's description"). So a tag with one rule in dispute makes one lesson, not two.
 */
export function groupRows(rows) {
  const cited = new Map(); // tag + reason -> the distinct cited rule numbers
  for (const r of rows) {
    const k = `${r.tag}\n${r.why}`;
    if (!cited.has(k)) cited.set(k, new Set());
    if (r.rule_n !== null) cited.get(k).add(r.rule_n);
  }
  const groups = new Map();
  for (const r of rows) {
    const rules = cited.get(`${r.tag}\n${r.why}`);
    const rule_n = r.rule_n ?? (rules.size === 1 ? [...rules][0] : null);
    const k = `${r.tag}\n${r.why}\n${rule_n ?? 'description'}`;
    if (!groups.has(k)) groups.set(k, { tag: r.tag, why: r.why, rule_n, rows: [] });
    groups.get(k).rows.push(r);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, rows: g.rows.sort((a, b) => compareCodePoints(a.key, b.key)) }))
    .sort((a, b) => compareCodePoints(a.tag, b.tag) || compareCodePoints(a.why, b.why) || (a.rule_n ?? 0) - (b.rule_n ?? 0));
}

const distinctClaims = (rows) => new Set(rows.map((r) => r.geo_id)).size;

/** The threshold of a group: { need, route }. route is true when the group rests on the owner's ruling (fewer claims than a rule change needs). */
export function thresholdOf(group, cfg) {
  const claims = distinctClaims(group.rows);
  if (group.why === 'Rule unclear') return { need: cfg.min_claims ?? 2, claims, ok: claims >= (cfg.min_claims ?? 2), route: false };
  const full = cfg.min_claims_rule_change ?? 3;
  const ownerAt = cfg.owner_ruling_at ?? 2;
  if (claims >= full) return { need: full, claims, ok: true, route: false };
  return { need: full, claims, ok: claims >= ownerAt, route: claims >= ownerAt };
}

function decidedAfter(row, createdIso) {
  const d = row.decided_at;
  if (!d || !createdIso) return false;
  if (String(d).includes('T')) return Date.parse(d) > Date.parse(createdIso);
  return String(d) > String(createdIso).slice(0, 10);
}

const ruleCompatible = (label, group) => {
  const parsed = parseRuleLabel(label ?? '', group.tag);
  return !(parsed?.part === 'rule' && group.rule_n !== null && parsed.rule_n !== group.rule_n);
};

// ---- the model's input and reply ------------------------------------------------------------------------------------------------------

const clip = (s, n = 600) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 3)}...`;
};

export function buildInput({ rubric, group, otherRows }) {
  const tag = rubric.tags.find((t) => t.name === group.tag);
  const w = tag.when_to_use;
  const view = (r) => ({ claim: clip(r.claim), outcome: r.outcome, reasoning: clip(r.reasoning), agent_proposal: r.agent_proposal, agent_reason: clip(r.agent_reason) });
  return {
    tag: {
      name: tag.name, description: tag.description, counterpart: tag.counterpart ?? null, polarity: tag.polarity ?? null,
      when_to_use: { preamble: w.preamble, rules: w.rules.map((r) => ({ n: r.n, text: r.text })), note: w.note }, example_claims: tag.example_claims,
    },
    why_wrong: group.why,
    rule_cited: group.rule_n === null ? null : `${group.tag} rule ${group.rule_n}`,
    rows: group.rows.slice(0, MAX_GROUP_ROWS).map(view),
    other_rows: otherRows.map((r) => ({ ...view(r), why_wrong: r.why ?? null })),
    example_claims: tag.example_claims,
  };
}

const REPLY_SCHEMA = {
  type: 'object',
  required: ['kind', 'target', 'title', 'statement', 'proposed_text'],
  properties: {
    kind: { type: 'string', enum: KINDS },
    target: { type: 'object', required: ['part'], properties: { rule_n: { type: ['integer', 'null'] }, part: { type: 'string', enum: ['rule', 'note', 'preamble'] } } },
    title: { type: 'string', minLength: 1 },
    statement: { type: 'string', minLength: 1 },
    proposed_text: { type: 'string', minLength: 1 },
    boundary_examples: { type: 'array' },
    counter_evidence: { type: 'array' },
    confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
  },
};

/** Check a parsed reply against the schema and the tag. Returns { problems: [text], reply } (reply is normalised when there are no problems). */
export function checkReply(value, { rubric, group }) {
  const problems = [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { problems: ['the reply must be one JSON object'], reply: null };
  const schema = validate(REPLY_SCHEMA, value);
  if (!schema.ok) return { problems: schema.errors.slice(0, 6), reply: null };
  const tag = rubric.tags.find((t) => t.name === group.tag);
  const target = { part: value.target.part, rule_n: value.target.rule_n ?? null };
  if (target.part === 'rule') {
    if (target.rule_n === null) target.rule_n = group.rule_n;
    if (target.rule_n === null) problems.push('target.rule_n is null but the part is "rule": name the rule number');
    else if (!tag.when_to_use.rules.some((r) => r.n === target.rule_n)) problems.push(`target.rule_n ${target.rule_n} is not a rule of ${group.tag} (rules: ${tag.when_to_use.rules.map((r) => r.n).join(', ')})`);
  } else target.rule_n = null;
  let kind = value.kind;
  if (group.why === 'Rule should change') kind = 'Change the rule';
  else if (kind === 'Change the rule') kind = 'Clarify wording';
  const proposed = target.part === 'rule' ? stripRuleNumber(value.proposed_text) : oneLine(value.proposed_text);
  if (proposed.length > MAX_TEXT) problems.push(`proposed_text is ${proposed.length} characters; the limit is ${MAX_TEXT}`);
  if (proposed === '') problems.push('proposed_text is empty');
  const current = target.part === 'rule' ? targetCurrentText(rubric, group.tag, target) : null;
  if (current && stripRuleNumber(current) === proposed) problems.push('proposed_text is the same as the current rule');
  const title = oneLine(value.title);
  if (title.split(' ').length > 20) problems.push('title is too long: at most 20 words');
  if (problems.length) return { problems, reply: null };
  return {
    problems,
    reply: {
      kind, target, title, statement: oneLine(value.statement), proposed_text: proposed,
      boundary_examples: Array.isArray(value.boundary_examples) ? value.boundary_examples : [],
      counter_evidence: Array.isArray(value.counter_evidence) ? value.counter_evidence.map(String) : [],
      confidence: typeof value.confidence === 'number' ? value.confidence : null,
    },
  };
}

/** The Rule column, Current text and Proposed text of a lesson from a checked reply (a note or preamble makes both texts the whole When to use). */
export function lessonTexts(rubric, tagName, reply) {
  const tag = rubric.tags.find((t) => t.name === tagName);
  const target = reply.target;
  if (target.part === 'rule') {
    return { rule_label: ruleLabel(tagName, target), current_text: targetCurrentText(rubric, tagName, target), proposed_text: reply.proposed_text };
  }
  const w = tag.when_to_use;
  const next = target.part === 'note' ? { ...w, note: reply.proposed_text.replace(/^note:\s*/i, '') } : { ...w, preamble: reply.proposed_text };
  return { rule_label: ruleLabel(tagName, target), current_text: composeWhenToUse(w), proposed_text: composeWhenToUse(next) };
}

// ---- Notion page text -----------------------------------------------------------------------------------------------------------------

function lessonMarkdown(lesson, rows) {
  const out = [`## What the editors decided`, lesson.statement ?? ''];
  out.push('', `## Where it applies`, `- Tag: ${lesson.tag}`, `- Rule: ${lesson.rule_label}`, `- Kind: ${lesson.kind}`, `- Supporting rows: ${lesson.supporting_keys.length}${lesson.owner_ruling_route ? ' (fewer than a rule change normally needs: the rule owner\'s Approved counts as the ruling)' : ''}`);
  const shown = rows.slice(0, 10);
  if (shown.length) {
    out.push('', '## Supporting decisions');
    for (const r of shown) out.push(`- ${clip(r.claim, 240)} - ${r.outcome}${r.reasoning ? `. Editor: "${clip(r.reasoning, 300)}"` : ''}`);
    if (rows.length > shown.length) out.push(`- ... and ${rows.length - shown.length} more`);
  }
  if (lesson.boundary_examples?.length) {
    out.push('', '## Boundary examples');
    for (const b of lesson.boundary_examples) out.push(`- ${b.applies ? 'Applies' : 'Does not apply'}: ${clip(b.claim ?? JSON.stringify(b), 300)}`);
  }
  out.push('', '## Counter-evidence');
  if (lesson.counter_evidence?.length) for (const c of lesson.counter_evidence) out.push(`- ${clip(c, 400)}`);
  else out.push('- None named.');
  const notes = [];
  if (lesson.overfit_risk) notes.push('Overfit risk: the proposed text still repeats a run of words from a supporting claim after one retry. Read it before approving.');
  if (lesson.demo) notes.push(`PLANTED TEST, NOT A REAL LESSON: ${lesson.note ?? 'a deliberately bad lesson that the gate is expected to FAIL.'} Approve it only to watch the gate refuse it.`);
  if (notes.length) out.push('', '## Notes', ...notes.map((n) => `- ${n}`));
  return out.join('\n');
}

// ---- the model call -------------------------------------------------------------------------------------------------------------------

function modelCaller({ root, config, deps, driver, model, state }) {
  const call = deps.runClaude ?? runClaude;
  const promptFile = join(root, 'prompts', 'distill.md');
  if (!existsSync(promptFile)) throw new ExitError(EXIT.INVALID, `the distiller prompt ${promptFile} does not exist`);
  let bin;
  if (driver === 'fake') {
    const loopFake = join(repoRoot(), 'tests', 'fixtures', 'loop', 'fake-claude.mjs');
    bin = deps.bin ?? (existsSync(loopFake) ? loopFake : FAKE_CLAUDE_SCRIPT);
  } else bin = deps.bin ?? findClaudeBin(config.judge?.claude_bin ?? 'claude');
  const timeoutMs = config.distill?.timeout_ms ?? config.judge?.timeout_ms ?? 300000;
  return async (message) => {
    const res = await call({
      bin, driver, model, systemPromptFile: promptFile, prompt: message, effort: config.distill?.effort, maxTurns: 1, timeoutMs,
      env: deps.processEnv ?? process.env, spawnImpl: deps.spawnImpl, fakeState: deps.fakeState,
    });
    state.calls += 1;
    state.cost += res.costUsd ?? 0;
    if (res.errorKind === 'usage_window') throw new ExitError(EXIT.USAGE_WINDOW, `the usage window ran out${usageResetHint(res.message) ? ` (${usageResetHint(res.message)})` : ''}; nothing was written. Run the same command again when it reopens`);
    if (res.errorKind === 'model_mismatch') throw new ExitError(EXIT.DRIFT, `the pinned model ${model} did not answer (${res.message}); nothing was written`);
    if (res.errorKind === 'spawn') throw new ExitError(EXIT.ERROR, `claude could not be started: ${res.message}`);
    return res;
  };
}

/** One group through the model: up to two calls. Returns { reply, overfit (the overlap found, or null), attempts } or { failed: reason, attempts }. */
export async function distillGroup({ ask, input, rubric, group, ngram }) {
  const message = JSON.stringify(input, null, 2);
  const supporting = group.rows.map((r) => r.claim);
  const attempts = [];
  const ask1 = async (text) => {
    const res = await ask(text);
    if (res.errorKind) return { problems: [`${res.errorKind}: ${res.message}`] };
    let value;
    try {
      value = extractJson(res.text);
    } catch (e) {
      return { problems: [`the reply is not valid JSON (${e.message})`] };
    }
    return checkReply(value, { rubric, group });
  };
  const first = await ask1(message);
  attempts.push({ ok: first.problems.length === 0, problems: first.problems });
  if (first.problems.length) {
    const second = await ask1(`${message}\n\nYour previous reply was invalid: ${first.problems.join('; ')}. Reply again with the JSON object only.`);
    attempts.push({ ok: second.problems.length === 0, problems: second.problems });
    if (second.problems.length) return { failed: `no valid reply after two tries (${second.problems[0]})`, attempts };
    const overlap = ngramOverlap(second.reply.proposed_text, supporting, ngram);
    return { reply: second.reply, overfit: overlap.hit ? overlap : null, attempts };
  }
  const overlap = ngramOverlap(first.reply.proposed_text, supporting, ngram);
  if (!overlap.hit) return { reply: first.reply, overfit: null, attempts };
  const note = `${OVERFIT_NOTE_MARK} ${ngram} or more consecutive words of a decided claim ("${overlap.ngram}"). A rule written around one claim is not a rule: write proposed_text again without quoting any decided claim, and reply with the JSON object only.`;
  const second = await ask1(`${message}\n\n${note}`);
  attempts.push({ ok: second.problems.length === 0, problems: second.problems, note: 'retry after the overlap check' });
  if (second.problems.length) return { reply: first.reply, overfit: overlap, attempts };
  const again = ngramOverlap(second.reply.proposed_text, supporting, ngram);
  return { reply: second.reply, overfit: again.hit ? again : null, attempts };
}

// ---- the command --------------------------------------------------------------------------------------------------------------------------

function uniqueTitle(base, taken) {
  let title = oneLine(base);
  let n = 2;
  while (taken.has(title)) title = `${oneLine(base)} (${n++})`;
  taken.add(title);
  return title;
}

function loadState({ root, config, now, pullId, need }) {
  const id = pullId ?? latestPullId(root);
  if (!id) throw new ExitError(EXIT.INVALID, 'there is no pull yet: run pull.mjs --dbs rulebook,claims,tag_decisions,rule_changes first');
  const pf = preflight({ root, config, now, pullId: id });
  if (pf.code !== EXIT.OK) throw new ExitError(pf.code, pf.message);
  let pull;
  try {
    pull = loadPull(root, id, { config });
  } catch (e) {
    throw new ExitError(EXIT.INVALID, e.message);
  }
  for (const db of need) {
    if (!pull.covers(db)) throw new ExitError(EXIT.INVALID, `pull ${id} does not include ${db}: run pull.mjs --dbs ${need.join(',')} first`);
  }
  return { pull, warnings: pf.state.drift.checked ? [] : ['Rulebook drift was not checked (the pull has no Rulebook)'] };
}

function runsTitle(base, pull) {
  const known = new Set((pull.covers('runs') ? (readJsonl(join(pull.dir, 'norm', 'runs.jsonl')).rows ?? []) : []).map((r) => r.title));
  let title = base;
  let n = 2;
  while (known.has(title) || pull.idMap?.runs?.[title]) title = `${base} (${n++})`;
  return title;
}

const lessonRecord = ({ rubric, group, reply, key, texts, ownerRoute, overfit, demo, note, supportingKeys }) => ({
  lesson_key: key,
  page_id: null,
  lesson_id: null,
  tag: group.tag,
  target: { rule_n: reply.target.rule_n, part: reply.target.part },
  rule_label: texts.rule_label,
  kind: reply.kind,
  why_wrong: group.why ?? null,
  title: key,
  statement: reply.statement,
  current_text: texts.current_text,
  proposed_text: texts.proposed_text,
  editor_wording: null,
  effective_text: texts.proposed_text,
  supporting_keys: supportingKeys,
  boundary_examples: reply.boundary_examples,
  counter_evidence: reply.counter_evidence,
  confidence: reply.confidence,
  owner_ruling_route: ownerRoute,
  status: 'Proposed',
  approved_by: [],
  rubric_version: rubric.rubric_version,
  gate_result: null,
  card_id: null,
  demo,
  ...(overfit ? { overfit_risk: true, overfit_ngram: overfit.ngram } : {}),
  ...(note ? { note } : {}),
});

async function distill({ args, io, root, config, deps, now }) {
  const rubric = readJson(join(root, 'rubric', 'rubric.json'));
  const demoPath = args['demo-bad-lesson'] ? resolve(args['demo-bad-lesson']) : null;
  const { pull, warnings } = loadState({ root, config, now, pullId: args.pull, need: ['tag_decisions', 'rule_changes'] });
  for (const w of warnings) io.err(`distill: warning: ${w}`);
  const cfg = config.distill ?? {};
  const driver = args.driver ?? 'cli';
  const model = args.model ?? config.models.distill;
  const index = lessonIndex(pull);
  const decided = (existsSync(join(pull.dir, 'norm', 'decisions.jsonl')) ? readJsonl(join(pull.dir, 'norm', 'decisions.jsonl')).rows : []).filter((r) => r.tag && r.geo_id);
  const cases = existsSync(join(root, 'evals', 'cases.jsonl')) ? readJsonl(join(root, 'evals', 'cases.jsonl')).rows : [];
  const texts = claimTexts(root, pull, cases);
  const rowsAll = decided.map((r) => toRow(r, texts));
  const byKey = new Map(rowsAll.map((r) => [r.key, r]));
  const notes = [];
  const skipped = [];
  const lessons = [];
  const links = []; // { lesson_key, row_keys } to an EXISTING lesson, done in plan A
  const takenTitles = new Set(index.rows.map((l) => l.lesson_key));
  const state = { calls: 0, cost: 0 };
  const groupFiles = [];

  const latestClosed = (tag, group) => index.rows.filter((l) => l.tag === tag && (l.status === 'Rejected' || l.status === 'Rolled back') && ruleCompatible(l.rule_label, group))
    .sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')))[0] ?? null;
  const activeLessons = (tag, group) => index.rows.filter((l) => l.tag === tag && ACTIVE_STATUSES.has(l.status) && ruleCompatible(l.rule_label, group))
    .sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));

  if (demoPath) {
    // ---- the planted lesson: no model
    if (!existsSync(demoPath)) throw new ExitError(EXIT.INVALID, `--demo-bad-lesson file ${demoPath} does not exist`);
    const d = readJson(demoPath);
    for (const f of ['title', 'tag', 'rule_n', 'kind', 'proposed_text', 'statement', 'supporting_keys']) {
      if (d[f] === undefined || d[f] === null || d[f] === '') throw new ExitError(EXIT.INVALID, `${demoPath}: "${f}" is missing`);
    }
    if (!KINDS.includes(d.kind)) throw new ExitError(EXIT.INVALID, `${demoPath}: kind "${d.kind}" is not one of ${KINDS.join(', ')}`);
    const rubricTag = rubric.tags.find((t) => t.name === d.tag);
    const target = { part: 'rule', rule_n: Number(d.rule_n) };
    if (!rubricTag || !targetCurrentText(rubric, d.tag, target)) throw new ExitError(EXIT.INVALID, `${demoPath}: the live rubric has no ${d.tag} rule ${d.rule_n}`);
    if (!Array.isArray(d.supporting_keys) || !d.supporting_keys.length) throw new ExitError(EXIT.INVALID, `${demoPath}: supporting_keys must name queue rows`);
    const missing = d.supporting_keys.filter((k) => !byKey.has(k));
    if (missing.length) throw new ExitError(EXIT.INVALID, `${demoPath}: these supporting rows are not decided rows of pull ${pull.id}: ${missing.join(', ')}`);
    const title = oneLine(d.title);
    if (index.byKey.has(title)) {
      io.out(`distill: nothing to do: the demo lesson "${title}" is already in Notion (${index.byKey.get(title).status})`);
      return EXIT.OK;
    }
    const reply = { kind: d.kind, target, statement: oneLine(d.statement), boundary_examples: d.boundary_examples ?? [], counter_evidence: d.counter_evidence ?? [], confidence: null, proposed_text: stripRuleNumber(d.proposed_text) };
    const group = { tag: d.tag, why: null, rule_n: target.rule_n, rows: d.supporting_keys.map((k) => byKey.get(k)) };
    const text = lessonTexts(rubric, d.tag, reply);
    lessons.push({
      lesson: lessonRecord({
        rubric, group, reply, key: title, texts: text, ownerRoute: false, overfit: null, demo: true, supportingKeys: [...d.supporting_keys].sort(compareCodePoints),
        note: d.note ?? 'a planted test: this lesson is deliberately bad and the gate is expected to FAIL it.',
      }),
      rows: group.rows,
    });
    takenTitles.add(title);
  } else {
    // ---- the real thing: rows, groups, thresholds, dedupe, the model
    const ruleRows = rowsAll.filter((r) => r.why !== null);
    const lacking = ruleRows.filter((r) => !r.claim);
    for (const r of lacking) notes.push(`no claim text for ${r.key}: pull the Claims too; the row was left out`);
    const groups = groupRows(ruleRows.filter((r) => r.claim));
    if (!groups.length) {
      io.out(`distill: nothing to propose: no decided row says the rule is the problem (${decided.length} decided row(s) read from pull ${pull.id})`);
      for (const n of notes) io.err(`distill: ${n}`);
      return EXIT.OK;
    }
    const ask = modelCaller({ root, config, deps, driver, model, state });
    let n = 0;
    for (const group of groups) {
      const label = `${group.tag} · ${group.why}${group.rule_n ? ` · rule ${group.rule_n}` : ''}`;
      const th = thresholdOf(group, cfg);
      if (!th.ok) {
        skipped.push(`${label}: ${th.claims} of ${th.need} claims`);
        continue;
      }
      const active = activeLessons(group.tag, group);
      const activeIds = new Set(active.map((l) => normId(l.page_id)));
      const unlinked = group.rows.filter((r) => !r.lesson_page_ids.some((id) => activeIds.has(normId(id)))); // rows no open lesson about this rule covers yet
      if (active.length) {
        if (!unlinked.length) {
          skipped.push(`${label}: already covered by "${active[0].lesson_key}"`);
          continue;
        }
        links.push({ lesson_key: active[0].lesson_key, rows: unlinked });
        continue;
      }
      const closed = latestClosed(group.tag, group);
      if (closed) {
        const fresh = group.rows.filter((r) => decidedAfter(r, closed.created));
        if (fresh.length < 2) {
          skipped.push(`${label}: "${closed.lesson_key}" is ${closed.status} and only ${fresh.length} row(s) were decided since`);
          continue;
        }
      }
      const others = rowsAll.filter((r) => r.tag === group.tag && r.claim && !group.rows.some((g) => g.key === r.key))
        .sort((a, b) => Number(Boolean(b.reasoning)) - Number(Boolean(a.reasoning)) || compareCodePoints(a.key, b.key)).slice(0, MAX_OTHER_ROWS);
      const input = buildInput({ rubric, group, otherRows: others });
      const result = await distillGroup({ ask, input, rubric, group, ngram: cfg.overfit_ngram ?? 8 });
      n += 1;
      groupFiles.push({ n, group, input, result });
      if (result.failed) {
        skipped.push(`${label}: ${result.failed}`);
        notes.push(`${label}: ${result.failed}`);
        continue;
      }
      const key = uniqueTitle(result.reply.title, takenTitles);
      const texts2 = lessonTexts(rubric, group.tag, result.reply);
      lessons.push({
        lesson: lessonRecord({ rubric, group, reply: result.reply, key, texts: texts2, ownerRoute: th.route, overfit: result.overfit, demo: false, supportingKeys: unlinked.map((r) => r.key) }),
        rows: unlinked,
      });
    }
  }

  const recordGroups = (runDir) => {
    for (const g of groupFiles) {
      writeJsonAtomic(join(runDir, 'groups', `${String(g.n).padStart(2, '0')}-${safeName(`${g.group.tag}-${g.group.why}`)}.group.json`), {
        prompt_path: join(root, 'prompts', 'distill.md'), output_path: null, tag: g.group.tag, why_wrong: g.group.why, rule_cited: g.group.rule_n, row_keys: g.group.rows.map((r) => r.key),
        input: g.input, attempts: g.result.attempts ?? [], reply: g.result.reply ?? null, failed: g.result.failed ?? null, overfit: g.result.overfit ?? null,
      });
    }
  };
  // ---- nothing to write?
  if (!lessons.length && !links.length) {
    if (state.calls > 0) { // money was spent: keep what was asked and what came back
      const failedId = args['run-id'] ?? makeRunId('distill', now());
      const failedDir = join(controlPaths(root).runs, failedId);
      recordGroups(failedDir);
      writeJsonAtomic(join(failedDir, 'run.json'), { run_id: failedId, kind: 'distill', status: 'nothing proposed', pull: pull.id, rubric_version: rubric.rubric_version, driver, model, started: now().toISOString(), calls: state.calls, cost_usd: Math.round(state.cost * 1e6) / 1e6, skipped, notes });
    }
    io.out(`distill: nothing to propose: ${skipped.length ? skipped.slice(0, 4).join('; ') : 'no group reached a lesson'}${skipped.length > 4 ? `; and ${skipped.length - 4} more` : ''}`);
    for (const n of notes) io.err(`distill: ${n}`);
    return notes.length && !lessons.length && groupFiles.length && groupFiles.every((g) => g.result.failed) ? EXIT.ERROR : EXIT.OK;
  }

  // ---- plan A, the lessons file, the link instructions
  const runId = args['run-id'] ?? makeRunId('distill', now());
  const runDir = join(controlPaths(root).runs, runId);
  if (existsSync(join(runDir, 'plan.jsonl'))) throw new ExitError(EXIT.INVALID, `run "${runId}" already has a plan; pick another --run-id`);
  const plan = openPlan({ runId, sourcePull: pull.id, root, config, pull, now });
  const lessonSchema = readJson(join(root, 'schemas', 'lesson.schema.json'));
  for (const { lesson, rows } of lessons) {
    const checked = validate(lessonSchema, lesson);
    if (!checked.ok) throw new Error(`internal error: the lesson "${lesson.lesson_key}" does not match lesson.schema.json: ${checked.errors.slice(0, 3).join('; ')}`);
    plan.create('rule_changes', lesson.lesson_key, {
      Tag: [{ rulebook: lesson.tag }], Rule: lesson.rule_label, Kind: lesson.kind, 'Current text': lesson.current_text, 'Proposed text': lesson.proposed_text,
      Status: 'Proposed', 'Rubric version': rubric.rubric_version,
    }, { content_md: lessonMarkdown(lesson, rows), note: lesson.demo ? 'planted test lesson (expected to fail the gate)' : null });
  }
  for (const link of links) {
    for (const row of link.rows) {
      plan.update('tag_decisions', row.key, row.page_id, { Lesson: [...row.lesson_page_ids, { rule_changes: link.lesson_key }] }, { note: `supporting row of the existing lesson "${link.lesson_key}"` });
    }
  }
  const started = now();
  const titles = lessons.map((l) => l.lesson.lesson_key);
  const summary = [
    titles.length ? `${titles.length} lesson(s) proposed: ${titles.join('; ')}` : 'no new lesson',
    links.length ? `${links.reduce((s, l) => s + l.rows.length, 0)} row(s) linked to existing lessons` : null,
    skipped.length ? `skipped: ${skipped.join('; ')}` : null,
  ].filter(Boolean).join('. ');
  const runTitle = runsTitle(`Distill ${started.toISOString().slice(0, 10)}`, pull);
  plan.create('runs', runTitle, {
    Kind: 'Distill', 'Rubric version': rubric.rubric_version, Started: started.toISOString(), Verdict: 'n/a', Summary: summary.slice(0, MAX_TEXT),
    Model: demoPath ? 'demo lesson (no model)' : model, 'Cost USD': Math.round(state.cost * 1e6) / 1e6,
  }, { content_md: ['## Distill run', summary, '', ...lessons.map(({ lesson }) => `- ${lesson.lesson_key} (${lesson.rule_label}, ${lesson.kind}, ${lesson.supporting_keys.length} supporting row(s))`)].join('\n') });
  const written = plan.write();

  writeTextAtomic(join(runDir, 'lessons.jsonl'), lessons.length ? `${lessons.map(({ lesson }) => JSON.stringify(lesson)).join('\n')}\n` : '');
  writeTextAtomic(join(runDir, 'plan-link.jsonl'), lessons.length ? `${lessons.map(({ lesson }) => JSON.stringify({ op: 'link', lesson_key: lesson.lesson_key, relation: 'Lesson', row_keys: lesson.supporting_keys })).join('\n')}\n` : '');
  recordGroups(runDir);
  writeJsonAtomic(join(runDir, 'run.json'), {
    run_id: runId, kind: 'distill', status: 'done', pull: pull.id, rubric_version: rubric.rubric_version, driver, model: demoPath ? null : model, demo: Boolean(demoPath),
    started: started.toISOString(), finished: now().toISOString(), calls: state.calls, cost_usd: Math.round(state.cost * 1e6) / 1e6, lessons: titles, links: links.map((l) => ({ lesson_key: l.lesson_key, rows: l.rows.map((r) => r.key) })), skipped, notes,
  });

  io.out(`distill: run ${runId}: ${titles.length} lesson(s) proposed${titles.length ? ` (${titles.map((t) => `"${t}"`).join(', ')})` : ''}${links.length ? `, ${links.reduce((s, l) => s + l.rows.length, 0)} row(s) linked to existing lessons` : ''}${skipped.length ? `, ${skipped.length} group(s) skipped` : ''}; ${state.calls} model call(s), $${state.cost.toFixed(4)}; plan ${written.path}; next: node agents/claim-tagger/scripts/plan.mjs check --run ${runId}; apply.mjs --run ${runId}; pull.mjs --dbs tag_decisions,rule_changes; distill.mjs --link --run ${runId}`);
  for (const l of lessons) if (l.lesson.overfit_risk) io.err(`distill: warning: "${l.lesson.lesson_key}" still repeats ${cfg.overfit_ngram ?? 8} words of a supporting claim after one retry (overfit risk)`);
  for (const n of notes) io.err(`distill: ${n}`);
  return EXIT.OK;
}

// ---- --link ---------------------------------------------------------------------------------------------------------------------------

async function link({ args, io, root, config, now }) {
  if (!args.run) throw new UsageError('--link needs --run <the distill run id>');
  const runDir = join(controlPaths(root).runs, args.run);
  const lessonsFile = join(runDir, 'lessons.jsonl');
  const linkFile = join(runDir, 'plan-link.jsonl');
  if (!existsSync(lessonsFile) || !existsSync(linkFile)) throw new ExitError(EXIT.INVALID, `run ${args.run} has no lessons.jsonl and plan-link.jsonl (${runDir}); was it a distill run that proposed lessons?`);
  const { pull } = loadState({ root, config, now, pullId: args.pull, need: ['tag_decisions', 'rule_changes'] });
  const instructions = readJsonl(linkFile).rows.filter((r) => r.op === 'link');
  const index = lessonIndex(pull);
  const queue = readJsonl(join(pull.dir, 'norm', 'queue.jsonl')).rows;
  const rowByKey = new Map(queue.map((r) => [r.key, r]));
  const notYet = instructions.filter((i) => !pull.idMap?.rule_changes?.[i.lesson_key]);
  if (notYet.length) {
    throw new ExitError(EXIT.INVALID, `${notYet.length} lesson(s) are not in Notion yet (${notYet.slice(0, 3).map((i) => `"${i.lesson_key}"`).join(', ')}): run plan.mjs check --run ${args.run}, apply.mjs --run ${args.run} and pull.mjs --dbs tag_decisions,rule_changes first`);
  }
  const runId = args['run-id'] ?? `${args.run}-link`;
  const plan = openPlan({ runId, sourcePull: pull.id, root, config, pull, now });
  const overlay = new Map();
  const missing = [];
  let ops = 0;
  let already = 0;
  for (const ins of instructions) {
    const lessonPage = pull.idMap.rule_changes[ins.lesson_key];
    for (const key of ins.row_keys) {
      const row = rowByKey.get(key);
      if (!row) {
        missing.push(key);
        continue;
      }
      overlay.set(key, [...(overlay.get(key) ?? []), ins.lesson_key]);
      if ((row.lesson_page_ids ?? []).some((id) => normId(id) === normId(lessonPage))) {
        already += 1;
        continue;
      }
      plan.update('tag_decisions', key, row.page_id, { Lesson: [...(row.lesson_page_ids ?? []), { rule_changes: ins.lesson_key }] }, { note: `supporting row of "${ins.lesson_key}"` });
      ops += 1;
    }
  }
  let planned = null;
  if (ops) planned = plan.write();
  const sync = syncCases({ root, config, pull, now, links: overlay });
  const contested = sync.cases.filter((c) => c.contested && overlay.has(c.key ?? '')).length;
  io.out(`distill --link: run ${args.run}: ${ops} row(s) to link in plan ${ops ? runId : '(none: all linked already)'}${already ? `, ${already} already linked` : ''}; cases.jsonl: ${sync.counts.contested} contested case(s)${sync.changed ? ' (file updated)' : ' (unchanged)'}, ${contested} of them for these lessons${planned ? `; next: node agents/claim-tagger/scripts/plan.mjs check --run ${runId}; apply.mjs --run ${runId}; then cases-sync.mjs sets In regression suite where a decision became an active case` : ''}`);
  for (const m of missing) io.err(`distill --link: the row "${m}" is not in pull ${pull.id}; it was not linked`);
  for (const n of sync.notes) io.err(`distill --link: ${n}`);
  return EXIT.OK;
}

// ---- command line -----------------------------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Run the script; returns the exit code. deps (tests): root, now, runClaude, fakeState, bin, spawnImpl, config, processEnv. */
export async function main(argv, io = defaultIo, deps = {}) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        pull: { type: 'string' }, 'demo-bad-lesson': { type: 'string' }, 'run-id': { type: 'string' }, driver: { type: 'string' }, model: { type: 'string' },
        link: { type: 'boolean' }, run: { type: 'string' }, help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }).values;
    if (args.driver && !['cli', 'fake'].includes(args.driver)) throw new UsageError(`--driver must be cli or fake, got "${args.driver}"`);
    if (args.link && args['demo-bad-lesson']) throw new UsageError('--link and --demo-bad-lesson do not go together');
    if (args.run && !args.link) throw new UsageError('--run goes with --link');
    for (const f of ['run-id', 'run']) if (args[f] !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args[f])) throw new UsageError(`--${f} may only use letters, digits, '.', '_' and '-', got "${args[f]}"`);
  } catch (e) {
    io.err(`distill: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  try {
    const root = deps.root ?? agentRoot();
    const config = deps.config ?? loadConfig(root);
    const now = deps.now ?? (() => new Date());
    return args.link ? await link({ args, io, root, config, now }) : await distill({ args, io, root, config, deps, now });
  } catch (e) {
    if (e instanceof ExitError) {
      io.err(`distill: ${e.message}`);
      return e.code;
    }
    if (e instanceof UsageError) {
      io.err(`distill: ${e.message}\n${USAGE}`);
      return EXIT.INVALID;
    }
    if (e.name === 'PlanError' || e.code === 'ALLOWLIST') {
      io.err(`distill: ${e.message}${e.problems?.length ? `\n  ${e.problems.join('\n  ')}` : ''}`);
      return EXIT.INVALID;
    }
    io.err(`distill: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
