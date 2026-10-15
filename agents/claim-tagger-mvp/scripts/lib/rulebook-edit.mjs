// Changing one numbered rule of a tag's When to use, and the rulebook edition that holds the change. Promote (a candidate edition for the
// safety check, then the new edition on a PASS), rollback (the earlier text of a rule) and restore (an earlier edition's rules) use it.
//
//   oneLineRule(text)                      -> the text of a rule as one line: a leading "4. " the editor typed is dropped
//   ruleNumberOf(label)                    -> 4 for "Context-dependent rule 4" (or "rule 4"), else null
//   replaceRule(whenToUse, n, newText)     -> the When to use text with rule n replaced by newText, the rest of the text left as it was
//   rowFromTag(tag)                        -> the plain Rulebook copy row of a rubric tag (the shape buildRubric reads)
//   rubricWithRule(rubric, tagName, n, newText, { config, edition, now })
//                                          -> { rubric, whenToUse, before }: the same rulebook with that one rule changed, its tag hash and the
//                                             rubric hash recomputed, as the given edition; `before` is the rule's text until now
//   ruleText(rubric, tagName, n)           -> the text of rule n of a tag, or null
//
// replaceRule works on the lines of the text, so a preamble, a note, the numbering style ("4." or "4)") and the blank lines between the rules
// stay exactly as the team wrote them. It reads the text back with parseRules and refuses (RuleEditError) unless the only change is the text of
// rule n: a replacement that moved or merged anything else is a bug that would otherwise reach the rulebook in Notion.

import { normaliseText } from './notion-values.mjs';
import { buildRubric, parseRules } from './rubric.mjs';

/** A rule that cannot be replaced: the message is in plain words (the caller turns it into a report with exit code 2). */
export class RuleEditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RuleEditError';
  }
}

const RULE_HEAD = /^(\s*)(\d+)([.)])\s+(\S.*)$/;
const NOTE_LABEL = /^notes?\s*:\s*/i;
const ENDS_A_SENTENCE = /[.!?…"'”’)\]]$/;

/** One line of rule text, without a number in front. */
export function oneLineRule(text) {
  return normaliseText(String(text ?? '')).replace(/\s*\n\s*/g, ' ').replace(/^\d+[.)]\s+/, '').trim();
}

/** The rule number in a label such as "Context-dependent rule 4" or "rule 4"; null when the label names no rule. */
export function ruleNumberOf(label) {
  const m = /\brule\s*#?\s*(\d+)\s*$/i.exec(String(label ?? '').trim());
  return m ? Number(m[1]) : null;
}

/** The text of rule n of a tag in a rubric, or null. */
export function ruleText(rubric, tagName, n) {
  return rubric?.tags?.find((t) => t.name === tagName)?.rules?.find((r) => r.n === n)?.text ?? null;
}

/** The text with rule n replaced by `newText` (see the header). Throws RuleEditError when there is no such rule or the result does not check. */
export function replaceRule(whenToUse, n, newText) {
  const text = oneLineRule(newText);
  if (text === '') throw new RuleEditError(`the new text of rule ${n} is empty`);
  const raw = String(whenToUse ?? '').replace(/\r\n?/g, '\n');
  const lines = raw.split('\n');
  const starts = [];
  lines.forEach((line, i) => {
    const m = RULE_HEAD.exec(line);
    if (m) starts.push({ i, n: Number(m[2]) });
  });
  const at = starts.findIndex((s) => s.n === n);
  if (at < 0) throw new RuleEditError(`the text has no rule ${n}`);
  const start = starts[at].i;
  const head = RULE_HEAD.exec(lines[start]);
  let end;
  if (at < starts.length - 1) {
    end = starts[at + 1].i;
    while (end - 1 > start && lines[end - 1].trim() === '') end -= 1; // the blank lines between two rules stay where they are
  } else {
    let seen = head[4].trim(); // the last rule goes on over the lines below it until parseRules would stop
    end = start + 1;
    for (; end < lines.length; end++) {
      const t = lines[end].trim();
      if (t === '' || NOTE_LABEL.test(t) || ENDS_A_SENTENCE.test(seen)) break;
      seen += ` ${t}`;
    }
  }
  const result = [...lines.slice(0, start), `${head[1]}${n}${head[3]} ${text}`, ...lines.slice(end)].join('\n');

  const before = parseRules(raw);
  const after = parseRules(result);
  const same = before.rules.length === after.rules.length
    && before.rules.every((r, i) => r.n === after.rules[i].n && (r.n === n || r.text === after.rules[i].text))
    && before.preamble === after.preamble && before.note === after.note;
  if (!same || after.rules.find((r) => r.n === n)?.text !== normaliseText(text)) {
    throw new RuleEditError(`rule ${n} could not be replaced without changing something else in the text`);
  }
  return result;
}

/** The plain Rulebook copy row of a rubric tag: what buildRubric (tagFromRow) reads, so that a tag survives a round trip unchanged. */
export function rowFromTag(tag) {
  return {
    Name: tag.name,
    Category: tag.category,
    Counterpart: tag.counterpart,
    Description: tag.description,
    'Example Claims': tag.example_claims.join('\n'),
    'When to use': tag.when_to_use,
    Polarity: tag.polarity,
    Status: tag.status,
    'Geo Status': tag.geo_status,
    'Geo Tag ID': tag.geo_tag_id,
    'Work tags': tag.work_tags,
    'Verified on': tag.verified_on,
    Evidence: tag.evidence,
    page_id: tag.page_id,
  };
}

/**
 * The rulebook of `rubric` with rule n of `tagName` set to `newText`, as edition `edition`. Every other tag comes through buildRubric as it
 * was (the round trip is checked by the tests), the changed tag gets its rules parsed again and its tag hash recomputed. Throws RuleEditError
 * for an unknown tag or rule.
 */
export function rubricWithRule(rubric, tagName, n, newText, { config, edition, now } = {}) {
  const tag = rubric?.tags?.find((t) => t.name === tagName);
  if (!tag) throw new RuleEditError(`the rulebook has no tag ${tagName}`);
  const before = tag.rules.find((r) => r.n === n)?.text;
  if (before === undefined) throw new RuleEditError(`${tagName} has no rule ${n}`);
  const whenToUse = replaceRule(tag.when_to_use, n, newText);
  const rows = rubric.tags.map((t) => rowFromTag(t.name === tagName ? { ...t, when_to_use: whenToUse } : t));
  return { rubric: buildRubric(rows, { config, edition, now }), whenToUse, before };
}
