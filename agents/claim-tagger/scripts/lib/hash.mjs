// Hash recipes. They reproduce research/scripts/build-skeleton-data.py exactly, so the numbers in the research
// rubric (and every Rulebook row that carries one) can be re-derived here.
//
// Surprise worth knowing: the Python script calls json.dumps(..., ensure_ascii=False) for the tag, rubric and
// scope hashes, so non-ASCII characters (em dashes, accents) are hashed raw, not as \uXXXX escapes. Five of the
// 14 research tags only reproduce that way. configId() is a new recipe of ours and uses Python's default (ASCII).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pyJson, compareCodePoints } from './pyjson.mjs';

const RAW = { ensureAscii: false };

/** Full SHA-256 hex digest of a string (UTF-8) or of bytes. */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function fileSha256(path) {
  return sha256Hex(readFileSync(path));
}

/** "sha256:" + the first 16 hex digits of the SHA-256 of a string (UTF-8) or of bytes. */
export function h16(data) {
  return 'sha256:' + sha256Hex(data).slice(0, 16);
}

/** One numbered rule: h16("<tag name>|<n>|<rule text>"). */
export function ruleHash(tag, n, text) {
  return h16(`${tag}|${n}|${text}`);
}

/**
 * One tag: h16 of the sorted-key JSON of name, counterpart, polarity, description, when_to_use and example_claims,
 * where every rule inside when_to_use carries its rule_hash. The rule hashes are recomputed from the rule text,
 * never read from the stored field, so a stale stored hash cannot hide an edited rule.
 */
export function tagHash(tag) {
  const w = tag.when_to_use;
  const subset = {
    name: tag.name,
    counterpart: tag.counterpart ?? null,
    polarity: tag.polarity,
    description: tag.description,
    when_to_use: {
      preamble: w.preamble,
      rules: w.rules.map((r) => ({ n: r.n, text: r.text, rule_hash: ruleHash(tag.name, r.n, r.text) })),
      note: w.note,
    },
    example_claims: tag.example_claims,
  };
  return h16(pyJson(subset, { sortKeys: true, ...RAW }));
}

/** The whole rulebook: h16 of the JSON list of the tag hashes, tags in name order. The version is not part of it. */
export function rubricHash(rubricOrTags) {
  const tags = Array.isArray(rubricOrTags) ? rubricOrTags : rubricOrTags.tags;
  const sorted = [...tags].sort((a, b) => compareCodePoints(a.name, b.name));
  return h16(pyJson(sorted.map(tagHash), RAW));
}

/** The judged scope: h16 of the JSON list of the judged tag names, sorted. */
export function scopeHash(scopeOrRubric) {
  const scope = Array.isArray(scopeOrRubric) ? scopeOrRubric : scopeOrRubric.scope;
  return h16(pyJson([...scope].sort(compareCodePoints), RAW));
}

/** Version of a prompt file: h16 over its bytes (pass the Buffer from readFileSync, no decoding). */
export function promptVersion(buffer) {
  return h16(buffer);
}

/** Identity of a judging configuration: h16 of the sorted-key JSON of the config object. */
export function configId(obj) {
  return h16(pyJson(obj, { sortKeys: true }));
}
