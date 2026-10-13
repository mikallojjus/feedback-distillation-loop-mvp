// Everything about the rubric file: Rulebook rows <-> rubric.json, text normalisation, the per-rule diff the drift
// check prints, candidate building for a lesson, version numbers and the hash check.
// File format: tests/fixtures/rubric.research-example.json (see skeletons/rubric-file-format.md in the research folder).

import { ruleHash, tagHash, rubricHash, scopeHash } from './hash.mjs';
import { compareCodePoints } from './pyjson.mjs';

// ---- text --------------------------------------------------------------------------------------------------------

// Python's str.strip() whitespace, so splitRules cuts lines exactly where build-skeleton-data.py did
// (JS trim() differs: it strips U+FEFF and leaves U+001C..U+001F and U+0085).
const WS = '\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const STRIP = new RegExp(`^[${WS}]+|[${WS}]+$`, 'g');
const pyStrip = (s) => s.replace(STRIP, '');
const oneLine = (s) => pyStrip(String(s ?? '').replace(/\s*\n\s*/g, ' '));
const RULE_LINE = /^(\d+)\.\s+(.*)$/s;
const NOTE_LABEL = /^Note:\s*/i;

/** Port of split_rules(): numbered lines are the rules, lines before the first are the preamble, lines after it the note. A leading "Note:" label is not part of the note. */
export function splitRules(text) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').map(pyStrip).filter(Boolean);
  const pre = [];
  const rules = [];
  const post = [];
  for (const line of lines) {
    const m = RULE_LINE.exec(line);
    if (m) rules.push({ n: Number(m[1]), text: m[2] });
    else if (rules.length) post.push(line);
    else pre.push(line);
  }
  return { preamble: pre.join(' '), rules, note: post.join(' ').replace(NOTE_LABEL, '') };
}

/** The Notion "When to use" text: preamble line, "1. ..." lines, then "Note: ..." when there is a note. splitRules reads it back. */
export function composeWhenToUse({ preamble = '', rules = [], note = '' } = {}) {
  const lines = [];
  if (oneLine(preamble)) lines.push(oneLine(preamble));
  for (const r of rules) lines.push(`${r.n}. ${oneLine(r.text)}`);
  if (oneLine(note)) lines.push(`Note: ${oneLine(note)}`);
  return lines.join('\n');
}

/** What the drift check compares: LF line ends, <br> as a line break, markdown escapes removed, each line trimmed, long blank runs collapsed. */
export function normaliseText(s) {
  const text = String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\([*_[\]#])/g, '$1')
    .split('\n').map(pyStrip).join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return pyStrip(text);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace names by roles: [from, to] pairs, whole words, case-sensitive, longest first ("Yaniv's rule" before "Yaniv"). */
export function scrubNames(text, replacements) {
  const pairs = [...replacements].filter(([from]) => from).sort((a, b) => b[0].length - a[0].length);
  if (!pairs.length || typeof text !== 'string') return text;
  const to = new Map(pairs);
  const word = '[\\p{L}\\p{N}_]';
  const re = new RegExp(`(?<!${word})(?:${pairs.map(([from]) => escapeRe(from)).join('|')})(?!${word})`, 'gu');
  return text.replace(re, (m) => to.get(m));
}

// ---- versions ----------------------------------------------------------------------------------------------------

const versionDate = (v) => /^(\d{4}-\d{2}-\d{2})\./.exec(v ?? '')?.[1] ?? new Date().toISOString().slice(0, 10);

/** YYYY-MM-DD.n: the next number when the current version is from today (UTC) or later, else today's .1. */
export function nextVersion(current, today = new Date()) {
  const day = today.toISOString().slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(current ?? '');
  return m && m[1] >= day ? `${m[1]}.${Number(m[2]) + 1}` : `${day}.1`;
}

// ---- hashes and counts -------------------------------------------------------------------------------------------

/** Recompute rule, tag, rubric and scope hashes plus scope, tag_count and judged_count, in place. Returns the rubric. */
export function rehash(rubric) {
  for (const t of rubric.tags) {
    for (const r of t.when_to_use.rules) r.rule_hash = ruleHash(t.name, r.n, r.text);
    t.tag_hash = tagHash(t);
  }
  const scope = rubric.tags.filter((t) => t.judged).map((t) => t.name).sort(compareCodePoints);
  rubric.scope = scope;
  rubric.scope_hash = scopeHash(scope);
  rubric.tag_count = rubric.tags.length;
  rubric.judged_count = scope.length;
  rubric.rubric_hash = rubricHash(rubric);
  return rubric;
}

/** Recompute every hash and count without touching the rubric: { ok, mismatches: [{ kind, where, stored, computed }] }. */
export function checkHashes(rubric) {
  const mismatches = [];
  const add = (kind, where, stored, computed) => {
    if (JSON.stringify(stored) !== JSON.stringify(computed)) mismatches.push({ kind, where, stored, computed });
  };
  for (const t of rubric.tags) {
    for (const r of t.when_to_use.rules) add('rule_hash', `${t.name} rule ${r.n}`, r.rule_hash, ruleHash(t.name, r.n, r.text));
    add('tag_hash', t.name, t.tag_hash, tagHash(t));
  }
  const judged = rubric.tags.filter((t) => t.judged).map((t) => t.name).sort(compareCodePoints);
  add('rubric_hash', 'rubric', rubric.rubric_hash, rubricHash(rubric));
  add('scope_hash', 'scope', rubric.scope_hash, scopeHash(rubric.scope));
  add('scope', 'scope', rubric.scope, judged);
  add('tag_count', 'tag_count', rubric.tag_count, rubric.tags.length);
  add('judged_count', 'judged_count', rubric.judged_count, judged.length);
  return { ok: mismatches.length === 0, mismatches };
}

// ---- Rulebook rows <-> rubric ------------------------------------------------------------------------------------

function toWhenToUse(v) {
  if (v === null || v === undefined || typeof v === 'string') return splitRules(normaliseText(v));
  return {
    preamble: oneLine(normaliseText(v.preamble)),
    rules: (v.rules ?? []).map((r) => ({ n: Number(r.n), text: oneLine(normaliseText(r.text)) })),
    note: oneLine(normaliseText(v.note)),
  };
}

function rowToTag(row) {
  const name = pyStrip(String(row.name ?? ''));
  if (!name) throw new Error('buildRubric: a row has no name');
  const humanOnly = row.human_only === true;
  const deterministic = row.deterministic === true;
  const judged = typeof row.judged === 'boolean' ? row.judged : !humanOnly && !deterministic;
  if (judged && (humanOnly || deterministic)) throw new Error(`buildRubric: "${name}" is marked judged but also ${humanOnly ? 'human only' : 'deterministic'}`);
  const examples = Array.isArray(row.example_claims) ? row.example_claims.join('\n') : row.example_claims;
  return {
    name,
    notion_page_id: row.notion_page_id ?? null,
    status: 'Verified',
    category: row.category ?? null,
    polarity: row.polarity ?? null,
    counterpart: pyStrip(String(row.counterpart ?? '')) || null,
    geo_status: row.geo_status ?? null,
    geo_tag_id: row.geo_tag_id ?? null,
    verified_on: row.verified_on ?? null,
    evidence_url: row.evidence_url ?? null,
    description: normaliseText(row.description),
    when_to_use: toWhenToUse(row.when_to_use),
    example_claims: normaliseText(examples).split('\n').map(pyStrip).filter(Boolean),
    human_only: humanOnly,
    deterministic,
    needs_source_reading: row.needs_source_reading === true,
    tag_hash: '',
    judged,
  };
}

function derivePairs(tags) {
  const names = new Set(tags.map((t) => t.name));
  const seen = new Set();
  const pairs = [];
  for (const t of tags) {
    if (!t.counterpart || !names.has(t.counterpart)) continue;
    const pair = [t.name, t.counterpart].sort(compareCodePoints);
    if (!seen.has(pair.join('\n'))) {
      seen.add(pair.join('\n'));
      pairs.push(pair);
    }
  }
  return pairs.sort((x, y) => compareCodePoints(x[0], y[0]) || compareCodePoints(x[1], y[1]));
}

/**
 * Rulebook rows -> rubric object in the fixture's shape. Rows that are not Verified are left out (decision D1).
 * Row fields: name, status, category, polarity, counterpart, description, when_to_use (text), example_claims (one per
 * line), human_only, judged, deterministic, needs_source_reading; optional notion_page_id, geo_status, geo_tag_id,
 * verified_on, evidence_url. Options: version, source, and optionally changelog, counterpartPairs, by, change.
 */
export function buildRubric(rows, { version = nextVersion(), source = {}, changelog, counterpartPairs, by = 'rubric-build', change = 'Built from Rulebook rows.' } = {}) {
  const tags = rows.filter((r) => r.status === undefined || r.status === null || r.status === 'Verified').map(rowToTag);
  tags.sort((a, b) => compareCodePoints(a.name, b.name));
  const dup = tags.find((t, i) => i > 0 && t.name === tags[i - 1].name);
  if (dup) throw new Error(`buildRubric: two rows are named "${dup.name}"`);
  return rehash({
    rubric_version: version,
    rubric_hash: '',
    scope: [],
    scope_hash: '',
    source: structuredClone(source),
    tag_count: 0,
    judged_count: 0,
    counterpart_pairs: counterpartPairs ?? derivePairs(tags),
    changelog: changelog ?? [{ version, date: versionDate(version), by, change }],
    tags,
  });
}

/** The inverse of buildRubric: one Rulebook-style row per tag (When to use composed, examples one per line). */
export function rubricToRows(rubric) {
  return rubric.tags.map((t) => ({
    name: t.name,
    status: t.status ?? 'Verified',
    category: t.category,
    polarity: t.polarity,
    counterpart: t.counterpart,
    description: t.description,
    when_to_use: composeWhenToUse(t.when_to_use),
    example_claims: t.example_claims.join('\n'),
    human_only: t.human_only,
    judged: t.judged,
    deterministic: t.deterministic,
    needs_source_reading: t.needs_source_reading,
    notion_page_id: t.notion_page_id,
    geo_status: t.geo_status,
    geo_tag_id: t.geo_tag_id,
    verified_on: t.verified_on,
    evidence_url: t.evidence_url,
  }));
}

// ---- diff --------------------------------------------------------------------------------------------------------

const norm = (s) => normaliseText(s ?? '');

/**
 * What differs between two rubrics, as normalised text: [{ tag, part, a, b }]. part is one of description, preamble,
 * "rule N", note, examples, polarity, counterpart, judged, human_only, deterministic, needs_source_reading (the parts
 * that feed a hash or the scope), or missing (tag only in a) and added (tag only in b). A rule missing on one side has null there.
 */
export function diffRubric(a, b) {
  const ta = new Map(a.tags.map((t) => [t.name, t]));
  const tb = new Map(b.tags.map((t) => [t.name, t]));
  const out = [];
  for (const tag of [...new Set([...ta.keys(), ...tb.keys()])].sort(compareCodePoints)) {
    const x = ta.get(tag);
    const y = tb.get(tag);
    if (!x || !y) {
      out.push({ tag, part: x ? 'missing' : 'added', a: x ? norm(x.description) : null, b: y ? norm(y.description) : null });
      continue;
    }
    const differ = (part, va, vb) => {
      if (va !== vb) out.push({ tag, part, a: va, b: vb });
    };
    differ('description', norm(x.description), norm(y.description));
    differ('polarity', x.polarity ?? null, y.polarity ?? null);
    differ('counterpart', x.counterpart ?? null, y.counterpart ?? null);
    differ('preamble', norm(x.when_to_use.preamble), norm(y.when_to_use.preamble));
    const ra = new Map(x.when_to_use.rules.map((r) => [r.n, norm(r.text)]));
    const rb = new Map(y.when_to_use.rules.map((r) => [r.n, norm(r.text)]));
    for (const n of [...new Set([...ra.keys(), ...rb.keys()])].sort((p, q) => p - q)) differ(`rule ${n}`, ra.get(n) ?? null, rb.get(n) ?? null);
    differ('note', norm(x.when_to_use.note), norm(y.when_to_use.note));
    differ('examples', x.example_claims.map(norm).join('\n'), y.example_claims.map(norm).join('\n'));
    for (const flag of ['judged', 'human_only', 'deterministic', 'needs_source_reading']) differ(flag, Boolean(x[flag]), Boolean(y[flag]));
  }
  return out;
}

// ---- candidate for a lesson --------------------------------------------------------------------------------------

/**
 * A deep copy of the rubric with one lesson applied: rule ruleN of tag gets newText, or the tag's whole When to use is
 * replaced by newWhenToUse (an editor's wording). Hashes are recomputed, rubric_version set (default: the next one) and a
 * changelog entry appended: { version, previous_version, date, tag, kind, ruleN, lesson_id?, note }.
 */
export function applyLesson(rubric, lesson, { version } = {}) {
  const { tag, kind = null, ruleN = null, newText, newWhenToUse } = lesson;
  const out = structuredClone(rubric);
  const t = out.tags.find((x) => x.name === tag);
  if (!t) throw new Error(`applyLesson: the rubric has no tag "${tag}"`);
  let what;
  if (newWhenToUse !== undefined && newWhenToUse !== null) {
    const parsed = splitRules(normaliseText(newWhenToUse));
    if (parsed.rules.length === 0) throw new Error(`applyLesson: the new When to use for "${tag}" has no numbered rules`);
    t.when_to_use = parsed;
    what = `${tag}: whole When to use replaced`;
  } else {
    const rule = t.when_to_use.rules.find((r) => r.n === Number(ruleN));
    if (!rule) throw new Error(`applyLesson: "${tag}" has no rule ${ruleN}`);
    const text = oneLine(normaliseText(newText));
    if (!text) throw new Error('applyLesson: the new rule text is empty');
    rule.text = text;
    what = `${tag} rule ${rule.n} replaced`;
  }
  const previous = rubric.rubric_version;
  const next = version ?? nextVersion(previous);
  if (next === previous) throw new Error(`applyLesson: a candidate needs a new version, got "${next}" again`);
  rehash(out);
  out.rubric_version = next;
  const lessonId = lesson.lesson_id ?? lesson.lessonId;
  out.changelog = [
    ...(out.changelog ?? []),
    {
      version: next,
      previous_version: previous,
      date: versionDate(next),
      tag,
      kind,
      ruleN: newWhenToUse !== undefined && newWhenToUse !== null ? null : Number(ruleN),
      ...(lessonId ? { lesson_id: lessonId } : {}),
      note: lesson.note ?? `${what}${lessonId ? ` (${lessonId})` : ''}`,
    },
  ];
  return out;
}
