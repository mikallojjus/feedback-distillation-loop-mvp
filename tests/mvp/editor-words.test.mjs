import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import {
  answerWord, capWords, cutText, listNames, notionUrl, plural, practiceLink, quoted, stampOf, tableLink, viewLink,
} from '../../agents/claim-tagger-mvp/scripts/lib/editor-words.mjs';
import { codeRoot } from '../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';
import { lintReport, renderReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';

const base = () => {
  const c = structuredClone(loadConfig(codeRoot()));
  c.notion.rulebook.database_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  c.notion.databases.tag_decisions.database_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  c.notion.databases.rule_changes.database_id = 'cccccccccccccccccccccccccccccccc';
  c.notion.databases.agent_settings.database_id = 'dddddddddddddddddddddddddddddddd';
  return c;
};

test('plural and listNames', () => {
  assert.equal(plural(1, 'row'), '1 row');
  assert.equal(plural(0, 'row'), '0 rows');
  assert.equal(plural(2, 'tag without rules', 'tags without rules'), '2 tags without rules');
  assert.equal(listNames([]), '');
  assert.equal(listNames(['A']), 'A');
  assert.equal(listNames(['A', 'B']), 'A and B');
  assert.equal(listNames(['A', 'B', 'C']), 'A, B and C');
});

test('capWords and cutText shorten with three dots and keep one line', () => {
  assert.equal(capWords('one  two\nthree four', 3), 'one two three...');
  assert.equal(capWords('one two', 3), 'one two');
  assert.equal(cutText('short'), 'short');
  assert.equal(cutText('x'.repeat(100), 60), `${'x'.repeat(57)}...`);
  assert.equal(cutText('x'.repeat(100), 60).length, 60);
  assert.equal(cutText('line\none\tand more', 60), 'line one and more');
  assert.equal(cutText(null), '');
});

test('quoted: double quotes around the cut text, inner double quotes made single, so that the report lint leaves a claim alone', () => {
  assert.equal(quoted('He said "stop" there.'), '"He said \'stop\' there."');
  assert.equal(quoted('x'.repeat(100), 20), `"${'x'.repeat(17)}..."`);
  const md = renderReport({ sentence: `The claim ${quoted('Two weeks later, $2.87 million {went} to the database.')} is quoted.`, next: 'Next: nothing.' });
  assert.deepEqual(lintReport(md), [], 'durations, dollars, braces and the word database are fine inside a quoted claim');
});

test('stampOf is "15 Oct 11:20" in local time, with no leading zero on the day and two digits for the time', () => {
  assert.equal(stampOf(new Date(2026, 9, 5, 7, 3)), '5 Oct 07:03');
  assert.equal(stampOf(new Date(2026, 11, 31, 23, 59)), '31 Dec 23:59');
  assert.match(stampOf(), /^\d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}$/);
});

test('answerWord names the three answers of the queue', () => {
  assert.deepEqual(['apply', 'do_not_apply', 'ask_editor', null].map(answerWord), ['Applies', 'Does not apply', "Can't tell", 'no answer']);
});

test('notionUrl and tableLink: the plain address of a table, dashes taken out', () => {
  assert.equal(notionUrl('aaaaaaaa-aaaa-AAAA-aaaa-aaaaaaaaaaaa'), 'https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const c = base();
  assert.equal(tableLink(c, 'rulebook'), 'https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(tableLink(structuredClone(loadConfig(codeRoot())), 'claims_copy'), `https://www.notion.so/${loadConfig(codeRoot()).notion.parent_page_id}`, 'a table that setup has not made yet points at the page');
});

test('viewLink: a view id gives ?v=, a link is used as it is, an object works, and without a view the table\'s own link is used', () => {
  const c = base();
  assert.equal(viewLink(c, 'your_queue'), 'https://www.notion.so/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  c.notion.views = { your_queue: '11111111-1111-1111-1111-111111111111', lessons_waiting: 'https://www.notion.so/x?v=1', rulebook: { id: '22222222222222222222222222222222' }, needs_your_note: { url: 'https://example.org/v' } };
  assert.equal(viewLink(c, 'your_queue'), 'https://www.notion.so/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?v=11111111111111111111111111111111');
  assert.equal(viewLink(c, 'lessons_waiting'), 'https://www.notion.so/x?v=1');
  assert.equal(viewLink(c, 'rulebook'), 'https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?v=22222222222222222222222222222222');
  assert.equal(viewLink(c, 'needs_your_note'), 'https://example.org/v');
  assert.throws(() => viewLink(c, 'nope'), /unknown view/);
});

test('practiceLink: the practice page of a demo profile, else the Lessons waiting view', () => {
  const c = base();
  assert.equal(practiceLink(c), 'https://www.notion.so/cccccccccccccccccccccccccccccccc');
  c.notion.page_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  assert.equal(practiceLink(c), 'https://www.notion.so/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
});
