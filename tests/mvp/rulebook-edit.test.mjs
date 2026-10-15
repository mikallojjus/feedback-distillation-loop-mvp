import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { codeRoot } from '../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';
import { RuleEditError, oneLineRule, replaceRule, rowFromTag, ruleNumberOf, ruleText, rubricWithRule } from '../../agents/claim-tagger-mvp/scripts/lib/rulebook-edit.mjs';
import { buildRubric, parseRules, tagFromRow, verifyRubric } from '../../agents/claim-tagger-mvp/scripts/lib/rubric.mjs';
import { placeholderConfig } from './helpers/config-fixture.mjs';

const config = placeholderConfig();
const NOW = new Date('2026-10-16T09:00:00.000Z');
const taxonomy = JSON.parse(readFileSync(join(codeRoot(), 'setup', 'taxonomy-issue.json'), 'utf8'));
const rubric = buildRubric(taxonomy.rows, { config, edition: '2026-10-16.1', now: NOW });

test('oneLineRule: one line, without the number an editor typed in front', () => {
  assert.equal(oneLineRule('  4. The text\n  over two lines.  '), 'The text over two lines.');
  assert.equal(oneLineRule('12) a number in the other style'), 'a number in the other style');
  assert.equal(oneLineRule(null), '');
  assert.equal(oneLineRule('3.5 percent of claims'), '3.5 percent of claims');
});

test('ruleNumberOf reads the number at the end of a label', () => {
  assert.equal(ruleNumberOf('Context-dependent rule 4'), 4);
  assert.equal(ruleNumberOf('rule #12'), 12);
  assert.equal(ruleNumberOf('Context-dependent when to use'), null);
  assert.equal(ruleNumberOf(''), null);
  assert.equal(ruleNumberOf(undefined), null);
});

test('replaceRule replaces one rule and leaves the preamble, the note, the numbering style and the blank lines as they were', () => {
  const text = 'A preamble line.\n\n1) First rule.\n\n2) Second rule\n   over two lines.\n\n3) Third rule.\nNote: a note at the end.';
  const out = replaceRule(text, 2, '2) The new second rule.');
  assert.equal(out, 'A preamble line.\n\n1) First rule.\n\n2) The new second rule.\n\n3) Third rule.\nNote: a note at the end.');
  assert.deepEqual(parseRules(out).rules.map((r) => r.text), ['First rule.', 'The new second rule.', 'Third rule.']);
  assert.equal(parseRules(out).preamble, 'A preamble line.');
  assert.equal(parseRules(out).note, 'a note at the end.');
});

test('replaceRule on the last rule takes its continuation lines with it, but not the note or what follows a blank line', () => {
  const text = '1. First.\n2. Last rule that goes on\n   to a second line\n   and a third.\n\nNote: after the blank line.';
  assert.equal(replaceRule(text, 2, 'Last, replaced.'), '1. First.\n2. Last, replaced.\n\nNote: after the blank line.');
  const noted = '1. First.\n2. Last rule that is finished.\nNote: a note.';
  assert.equal(replaceRule(noted, 2, 'New last.'), '1. First.\n2. New last.\nNote: a note.');
  assert.equal(replaceRule('1. Only rule.', 1, 'Changed.'), '1. Changed.');
  assert.equal(replaceRule('1. Rule one.\r\n2. Rule two.\r\n', 1, 'One.'), '1. One.\n2. Rule two.\n', 'line ends are made LF');
  assert.equal(replaceRule('  1. Indented.\n  2. Also.', 2, 'Changed.'), '  1. Indented.\n  2. Changed.', 'the indentation stays');
});

test('replaceRule refuses a rule that is not there, an empty text, and anything that would change another rule', () => {
  assert.throws(() => replaceRule('1. One.\n2. Two.', 3, 'x'), (e) => e instanceof RuleEditError && /no rule 3/.test(e.message));
  assert.throws(() => replaceRule('1. One.', 1, '  '), (e) => e instanceof RuleEditError && /empty/.test(e.message));
  assert.throws(() => replaceRule('No rules here.', 1, 'x'), RuleEditError);
  // a text is one line, so it cannot start a rule of its own: the second line of a sneaky text becomes part of rule 1
  assert.equal(replaceRule('1. One.\n2. Two.', 1, 'First.\n2. A sneaky second'), '1. First. 2. A sneaky second\n2. Two.');
});

test('every tag of the real taxonomy survives rowFromTag and tagFromRow unchanged', () => {
  assert.equal(rubric.tags.length, 13);
  for (const tag of rubric.tags) assert.ok(isDeepStrictEqual(tagFromRow(rowFromTag(tag), config), tag), tag.name);
});

test('rubricWithRule changes one rule of one tag: its tag hash and the rubric hash move, every other tag is as it was, and the result verifies', () => {
  const next = rubricWithRule(rubric, 'Context-dependent', 4, '4. A reference that reads as general needs no answer.', { config, edition: '2026-10-16.2', now: NOW });
  assert.equal(next.before, ruleText(rubric, 'Context-dependent', 4));
  assert.equal(next.rubric.edition, '2026-10-16.2');
  assert.equal(verifyRubric(next.rubric).ok, true);
  assert.equal(ruleText(next.rubric, 'Context-dependent', 4), 'A reference that reads as general needs no answer.');
  assert.deepEqual(next.rubric.tags.map((t) => t.name), rubric.tags.map((t) => t.name));
  for (const t of next.rubric.tags) {
    const old = rubric.tags.find((x) => x.name === t.name);
    if (t.name === 'Context-dependent') {
      assert.notEqual(t.tag_hash, old.tag_hash);
      assert.deepEqual(t.rules.map((r) => r.text).filter((_, i) => i !== 3), old.rules.map((r) => r.text).filter((_, i) => i !== 3), 'the other four rules');
    } else assert.deepEqual(t, old, t.name);
  }
  assert.notEqual(next.rubric.rubric_hash, rubric.rubric_hash);
  assert.ok(next.whenToUse.split('\n').length === rubric.tags[0].when_to_use.split('\n').length);
  // the same text gives the same rules again
  const same = rubricWithRule(rubric, 'Context-dependent', 4, ruleText(rubric, 'Context-dependent', 4), { config, edition: '2026-10-16.2', now: NOW });
  assert.equal(same.rubric.rubric_hash, rubric.rubric_hash);
  assert.throws(() => rubricWithRule(rubric, 'No such tag', 1, 'x', { config, edition: 'e', now: NOW }), RuleEditError);
  assert.throws(() => rubricWithRule(rubric, 'Context-dependent', 9, 'x', { config, edition: '2026-10-16.2', now: NOW }), RuleEditError);
  assert.throws(() => rubricWithRule(rubric, 'Wordy', 1, 'x', { config, edition: '2026-10-16.2', now: NOW }), RuleEditError, 'a tag without rules has no rule 1');
});
