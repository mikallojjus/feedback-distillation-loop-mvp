import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerWord, capWords, cutText, demoCommands, listNames, namePracticePage, notionUrl, plural, practiceLink, practiceTitle, quoted, quotedWhole, splitSentences, stampOf, suggestionPart, tableLink, viewLink, yourClaims,
} from '../../agents/claim-tagger-mvp/scripts/lib/editor-words.mjs';
import { lintReport, renderReport, splitExtra } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { oneLineRule } from '../../agents/claim-tagger-mvp/scripts/lib/rulebook-edit.mjs';
import { placeholderConfig } from './helpers/config-fixture.mjs';

// A config for the link tests: the agent's own as it was before setup (fixtures/config.placeholder.json, not the live config.json that setup has filled in),
// with four tables given ids, no views and the claims table not made yet.
const SETUP_PLACEHOLDER = '<setup>';
const base = () => {
  const c = placeholderConfig();
  delete c.notion.views;
  c.notion.claims.database_id = SETUP_PLACEHOLDER;
  c.notion.claims.data_source_id = SETUP_PLACEHOLDER;
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

test('yourClaims names the claims an editor is to decide in the words of the page: one, two or three up to ten spelled out, then the figure', () => {
  assert.deepEqual([1, 2, 3, 10, 11, 14].map(yourClaims), ['your claim', 'your two claims', 'your three claims', 'your ten claims', 'your 11 claims', 'your 14 claims']);
  assert.equal(yourClaims(2), 'your two claims', 'the words where and the page use');
  assert.equal(yourClaims(4), 'your four claims', 'the practice page has four claims for the editor');
});

test('answerWord names the three answers of the queue', () => {
  assert.deepEqual(['apply', 'do_not_apply', 'ask_editor', null].map(answerWord), ['Applies', 'Does not apply', "Can't tell", 'no answer']);
});

test('notionUrl and tableLink: the plain address of a table, dashes taken out', () => {
  assert.equal(notionUrl('aaaaaaaa-aaaa-AAAA-aaaa-aaaaaaaaaaaa'), 'https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const c = base();
  assert.equal(tableLink(c, 'rulebook'), 'https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(tableLink(c, 'claims'), `https://www.notion.so/${c.notion.parent_page_id}`, 'a table that setup has not made yet points at the page');
});

test('notionUrl with a title is the form Notion gives a page: the words of the title joined by dashes, then the id', () => {
  const id = '400273e214eb8126bf20cd1f1337681e';
  assert.equal(notionUrl(id, 'Claim tagger practice · verification 21 Oct'), `https://app.notion.com/p/Claim-tagger-practice-verification-21-Oct-${id}`);
  assert.equal(notionUrl('3fa273e2-14eb-8125-b451-e4a2c04d099e', 'Claim tagger practice · 15 Oct 21:44'), 'https://app.notion.com/p/Claim-tagger-practice-15-Oct-21-44-3fa273e214eb8125b451e4a2c04d099e');
  assert.equal(notionUrl(id, 'Über — the “demo”!'), `https://app.notion.com/p/Uber-the-demo-${id}`, 'accents and marks are dropped, as in a link');
  for (const none of [undefined, null, '', '   ', '·']) assert.equal(notionUrl(id, none), `https://www.notion.so/${id}`, `no words, no title: ${JSON.stringify(none)}`);
});

test('viewLink: a view id gives ?v=, a link is used as it is, an object works, and without a view the table\'s own link is used', () => {
  const c = base();
  assert.equal(viewLink(c, 'your_queue'), `https://www.notion.so/${c.notion.parent_page_id}`, 'the Claims copy is the table of Your queue; while it is not made the link goes to the page');
  assert.equal(viewLink(c, 'your_queue_ledger'), 'https://www.notion.so/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'the old view of the ledger is a view of Tag decisions');
  c.notion.claims.database_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  assert.equal(viewLink(c, 'your_queue'), 'https://www.notion.so/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
  assert.equal(viewLink(c, 'agent_disagreed'), 'https://www.notion.so/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
  c.notion.views = {
    your_queue: '11111111-1111-1111-1111-111111111111', lessons_waiting: 'https://www.notion.so/x?v=1', rulebook: { id: '22222222222222222222222222222222' }, needs_your_note: { url: 'https://example.org/v' },
    your_queue_ledger: '33333333-3333-3333-3333-333333333333',
  };
  assert.equal(viewLink(c, 'your_queue'), 'https://www.notion.so/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee?v=11111111111111111111111111111111');
  assert.equal(viewLink(c, 'your_queue_ledger'), 'https://www.notion.so/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?v=33333333333333333333333333333333');
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
  // a practice page has a title, and its link has the form of the link Notion itself gives (the one every other report of the practice page shows)
  c.demo = true;
  c.demo_title = 'Claim tagger practice · 21 Oct 12:37';
  assert.equal(practiceLink(c), 'https://app.notion.com/p/Claim-tagger-practice-21-Oct-12-37-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
});

test('quotedWhole: the whole text in double quotes, never cut, inner double quotes made single, on one line, and the report lint leaves it alone', () => {
  const rule = 'Test: could a reader who sees only this sentence say which specific thing each definite reference points at? If any answer is no, tag Context-dependent. '.repeat(3).trim();
  assert.ok([...rule].length > 300);
  assert.equal(quotedWhole(rule), `"${rule}"`, 'a long text is not cut');
  assert.equal(quotedWhole('A reference such as "the market"\nstays whole “here”.'), '"A reference such as \'the market\' stays whole \'here\'."');
  assert.equal(quotedWhole(null), '""');
  const md = renderReport({ sentence: 'Promote: FAIL.', next: `Next: put this whole text into Editor wording: ${quotedWhole('Two weeks, $2.87 million {x}, the database, G20 and the rubric gate.')}; then type /claim-tagger promote again.` });
  assert.deepEqual(lintReport(md), []);
});

// The text of rule 3 of Context-dependent as the safety check tested it on 28 October 2026.
const RULE_3 = 'A descriptive definite that names a kind of thing but not which one (\'the Bitcoin ETF\', \'the major-bank stablecoin consortium\', \'the open-access version\', \'the infrastructure\', \'the new model\') makes the claim Context-dependent: the reader must already know which ETF, consortium, version or product is meant. A description that works as the name of one specific program, law or rule, so that only one thing fits it, already says which one and does not count; a description that more than one thing could fit (more than one campaign, more than one convention in the same city) still counts. Applies to countable things, not to abstract or mass nouns (\'the regulatory clearance\', \'the market\').';

test('splitSentences: rule 3 splits into its three sentences, each whole; the text joined again is the text', () => {
  const sentences = splitSentences(RULE_3);
  assert.equal(sentences.length, 3);
  assert.ok(sentences[0].startsWith('A descriptive definite that names a kind of thing') && sentences[0].endsWith('which ETF, consortium, version or product is meant.'));
  assert.ok(sentences[1].startsWith('A description that works as the name of one specific program') && sentences[1].endsWith('(more than one campaign, more than one convention in the same city) still counts.'));
  assert.ok(sentences[2].startsWith('Applies to countable things') && sentences[2].endsWith('(\'the regulatory clearance\', \'the market\').'));
  assert.equal(sentences.join(' '), RULE_3);
  assert.deepEqual(splitSentences('One sentence only, with no stop in the middle.'), ['One sentence only, with no stop in the middle.']);
  assert.deepEqual(splitSentences('  Two sentences here.\n\n"Quoted" starts the second one.  '), ['Two sentences here.', '"Quoted" starts the second one.'], 'an opening quote starts a sentence too, and line breaks are spaces');
  assert.deepEqual(splitSentences('Starts here today. But not after a lower case word. and not here'), ['Starts here today.', 'But not after a lower case word. and not here'], 'a stop followed by a lower case letter does not split');
  assert.deepEqual(splitSentences(''), []);
});

test('splitSentences: a text with an abbreviation such as "e.g." or "U.S.", or a piece shorter than three words, is not split: one paragraph', () => {
  const eg = 'Names a kind of thing, e.g. The Hague or the court. Applies to countable things only.';
  assert.deepEqual(splitSentences(eg), ['Names a kind of thing, e.g. The Hague or the court.', 'Applies to countable things only.'], 'the abbreviation is not a boundary, the real stop is');
  const us = 'A body of the U.S. Congress counts as identified. A body that is not known does not.';
  assert.deepEqual(splitSentences(us), ['A body of the U.S. Congress counts as identified.', 'A body that is not known does not.']);
  assert.deepEqual(splitSentences('Dr. Smith said it. Applies here too.'), ['Dr. Smith said it.', 'Applies here too.']);
  const short = 'A name alone is not enough. Never. A place and a role are.';
  assert.deepEqual(splitSentences(short), [short], 'a piece of one word ("Never.") means the text is shown as one paragraph');
  const tiny = 'Counts as identified. Needs context.';
  assert.deepEqual(splitSentences(tiny), [tiny], 'two words each is shorter than three');
  const shortEg = 'Use e.g. Paris. Not it.';
  assert.deepEqual(splitSentences(shortEg), [shortEg]);
});

test('splitSentences: titles, places, companies and months written with a full stop do not end a sentence ("St. Louis", "Sen. Warren" even in quotes, "Oct. 5"); a stop after a plain word still does', () => {
  const split = (text) => splitSentences(text);
  assert.deepEqual(split('A convention in St. Louis counts as one thing here. A convention in a big city needs context.'), ['A convention in St. Louis counts as one thing here.', 'A convention in a big city needs context.']);
  assert.deepEqual(split('A claim naming \'Sen. Warren\' alone names one person. A claim naming a senator does not.'), ['A claim naming \'Sen. Warren\' alone names one person.', 'A claim naming a senator does not.']);
  assert.deepEqual(split('A claim naming "Sen. Warren" alone names one person. A claim naming a senator does not.'), ['A claim naming "Sen. Warren" alone names one person.', 'A claim naming a senator does not.']);
  for (const word of ['Rep.', 'Gov.', 'Gen.', 'Lt.', 'Col.', 'Mt.', 'Ft.', 'Inc.', 'Corp.', 'Ltd.', 'Co.', 'No.', 'Jan.', 'Feb.', 'Mar.', 'Apr.', 'Jun.', 'Jul.', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']) {
    assert.deepEqual(split(`A text with ${word} Smith in it is one sentence. A second sentence follows it.`), [`A text with ${word} Smith in it is one sentence.`, 'A second sentence follows it.'], word);
  }
  assert.deepEqual(split('The answer is yes. Another sentence follows it here.'), ['The answer is yes.', 'Another sentence follows it here.'], 'an ordinary word before the stop is a sentence end');
});

test('suggestionPart: the sentence as a quote, the Why line, and the tested rule in a fenced block one sentence per line with the new sentence last; a short piece keeps the rule as one paragraph', () => {
  const sentence = 'A description that names no particular program or law still needs context.';
  const part = suggestionPart({ ruleLabel: 'rule 3', sentence, why: 'The claim names a kind of thing without saying which, so the sentence keeps it under the rule.', ruleText: RULE_3 });
  const rules = splitSentences(RULE_3);
  assert.equal(part, [
    'Suggested sentence for rule 3:',
    `> ${sentence}`,
    '',
    'Why: The claim names a kind of thing without saying which, so the sentence keeps it under the rule.',
    '',
    'Rule 3 with the sentence, to copy into Editor wording:',
    '```',
    ...rules,
    sentence,
    '```',
  ].join('\n'));
  const block = /```\n([\s\S]*)\n```$/.exec(part)[1].split('\n');
  assert.equal(block.length, 4, 'three sentences of the rule and the new one');
  assert.ok(block.every((l) => !/^(\d+[.)]|[-*>#])\s/.test(l) && l === l.trim() && l !== ''), 'only the rule text: no numbers, markers or blank lines');
  assert.equal(block.join(' '), `${RULE_3} ${sentence}`, 'copied back into one line it is the text that was tested and the sentence');
  const label = suggestionPart({ ruleLabel: 'Context-dependent rule 3', sentence, why: 'Because.', ruleText: 'One piece. Never.' });
  assert.ok(label.startsWith('Suggested sentence for Context-dependent rule 3:\n'));
  assert.ok(label.includes('\n\nContext-dependent rule 3 with the sentence, to copy into Editor wording:\n```\nOne piece. Never.\nA description that'), 'the label is the rule\'s name; a short piece keeps the rule on one line');
  // the text is on single lines whatever the model sent, and what stands in the block cannot close it
  const messy = suggestionPart({ ruleLabel: 'rule 3', sentence: 'Two\nlines ``` here.', why: 'A\n\nreason.', ruleText: 'The rule ``` text\nis long enough here.' });
  assert.equal(messy.split('\n').filter((l) => l.startsWith('```')).length, 2, 'only the two fences of the block');
  assert.ok(messy.includes('> Two lines ``` here.\n\nWhy: A reason.\n\n'));
  assert.ok(messy.endsWith('```\nThe rule ``` text is long enough here.\nTwo lines ``` here.\n```'), 'a rule that came in on two lines is one line in the block');
});

test('suggestionPart: the block read back as one line (oneLineRule, the way the safety check reads Editor wording) is the tested rule and the sentence; a rule whose cut would not read back the same stays one paragraph', () => {
  const sentence = 'A plan named only by its subject still needs context.';
  const part = (ruleText) => suggestionPart({ ruleLabel: 'rule 3', sentence, why: 'Because.', ruleText });
  const blockOf = (text) => /\n```\n([\s\S]*)\n```$/.exec(text)[1];
  const check = (rule) => {
    const block = blockOf(part(rule));
    assert.equal(oneLineRule(block), oneLineRule(`${rule} ${sentence}`), `round trip of ${JSON.stringify(rule)}`);
    return block.split('\n');
  };
  const wrap = (text) => renderReport({ sentence: 'Promote: FAIL.', extra: text, next: 'Next: paste it.' });
  // plain: cut at the sentences, the spacing inside each kept as it stands
  assert.deepEqual(check('First sentence is here. Second sentence is here too.'), ['First sentence is here.', 'Second sentence is here too.', sentence]);
  assert.deepEqual(check('First  sentence\tis here. Second sentence is here too.'), ['First  sentence\tis here.', 'Second sentence is here too.', sentence], 'a double space and a tab inside a sentence stay');
  // a double space or a tab between two sentences would be one space once the lines are joined: the rule stays one paragraph, as it stands
  assert.deepEqual(check('First sentence is here.  Second sentence is here too.'), ['First sentence is here.  Second sentence is here too.', sentence]);
  assert.deepEqual(check('First sentence is here.\tSecond sentence is here too.'), ['First sentence is here.\tSecond sentence is here too.', sentence]);
  // triple backticks in the rule are not changed: they cannot close the block unless a line is nothing but backticks, and then the cut is not used
  const ticks = check('Mark it with ``` here. Second sentence is here too.');
  assert.deepEqual(ticks, ['Mark it with ``` here.', 'Second sentence is here too.', sentence]);
  assert.deepEqual(check('``` opens it. Second sentence is here too.'), ['``` opens it.', 'Second sentence is here too.', sentence]);
  for (const rule of ['Mark it with ``` here. Second sentence is here too.', '``` opens it. Second sentence is here too.', 'First sentence is here.  Second sentence is here too.']) {
    assert.deepEqual(lintReport(wrap(part(rule))), [], `still one suggestion, between the sentence and the Next line: ${rule}`);
    assert.equal(splitExtra(wrap(part(rule))).extra, part(rule));
  }
  assert.deepEqual(check('First sentence is here. ``` Second sentence is here too.'), ['First sentence is here. ``` Second sentence is here too.', sentence], 'a cut at a backtick is no cut: this one has no capital letter after the stop');
  assert.deepEqual(check('One sentence. ```\nTwo sentence is here too.'), ['One sentence. ``` Two sentence is here too.', sentence], 'a rule that came in on two lines');
});

test('practiceTitle: the title of the practice page, only for a demo profile that has one', () => {
  assert.equal(practiceTitle({ demo: true, demo_title: 'Claim tagger demo · 15 Oct 10:42' }), 'Claim tagger demo · 15 Oct 10:42');
  assert.equal(practiceTitle({ demo: true, demo_title: '  Two\nlines  ' }), 'Two lines');
  assert.equal(practiceTitle({ demo: true }), null);
  assert.equal(practiceTitle({ demo: true, demo_title: '   ' }), null);
  assert.equal(practiceTitle({ demo_title: 'Not a demo' }), null, 'a profile that is not a demo names no page');
  assert.equal(practiceTitle({ demo: false, demo_title: 'x' }), null);
  assert.equal(practiceTitle(null), null);
});

test('namePracticePage: "Status of the practice page <title>: ..." for a status sentence, " (practice page <title>)" before the final period for any other, unchanged without a title', () => {
  const demo = { demo: true, demo_title: 'Claim tagger demo · 15 Oct 10:42' };
  assert.equal(
    namePracticePage(demo, 'Status: nothing is paused; 2 rows wait for you.'),
    'Status of the practice page Claim tagger demo · 15 Oct 10:42: nothing is paused; 2 rows wait for you.',
  );
  assert.equal(
    namePracticePage(demo, 'Promote: PASS, rule 4 now uses the new wording (edition 2026-10-15.2), and the follow-up marked both of your rows Fixed.'),
    'Promote: PASS, rule 4 now uses the new wording (edition 2026-10-15.2), and the follow-up marked both of your rows Fixed (practice page Claim tagger demo · 15 Oct 10:42).',
  );
  assert.equal(namePracticePage(demo, 'Tag stopped: your Claude allowance ran out'), 'Tag stopped: your Claude allowance ran out (practice page Claim tagger demo · 15 Oct 10:42)', 'no final period: the page is added at the end');
  const once = namePracticePage(demo, 'Distill: one rule change drafted from your 2 notes.');
  assert.equal(namePracticePage(demo, once), once, 'a sentence that names the page already is left alone');
  assert.equal(namePracticePage({ demo: true }, 'Status: x.'), 'Status: x.');
  assert.equal(namePracticePage({ demo_title: 'x' }, 'Status: x.'), 'Status: x.');
  assert.equal(namePracticePage(demo, ''), '');
  assert.equal(namePracticePage(demo, undefined), '');
  // a sentence that names the page passes the report lint
  assert.deepEqual(lintReport(renderReport({ demo: true, sentence: namePracticePage(demo, 'Status: nothing is paused; 2 rows wait for you.'), next: 'Next: nothing.' })), []);
});

test('demoCommands: every slash command of the claim tagger gets "demo", once', () => {
  assert.equal(demoCommands('Next: type /claim-tagger promote again; it continues where it stopped.'), 'Next: type /claim-tagger demo promote again; it continues where it stopped.');
  assert.equal(demoCommands('type `/claim-tagger follow-up` or /claim-tagger status'), 'type `/claim-tagger demo follow-up` or /claim-tagger demo status');
  assert.equal(demoCommands(demoCommands('type /claim-tagger tag')), 'type /claim-tagger demo tag', 'a command that says demo already is left alone');
  assert.equal(demoCommands('type /claim-tagger demo tag'), 'type /claim-tagger demo tag');
  assert.equal(demoCommands('Next: nothing; the demo is complete.'), 'Next: nothing; the demo is complete.');
  assert.equal(demoCommands(undefined), '');
});
