import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_HEADER, DEMO_PREFIX, MAX_ROWS, buildReport, lintReport, renderReport, writeReport,
} from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';

const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-report-'));
  roots.push(dir);
  return dir;
}

const base = () => ({
  demo: false,
  sentence: 'Tag: the agent read 214 new claims for Context-dependent; 9 of them wait for you.',
  header: ['What', 'Result', ''],
  rows: [['Claims read', '214', ''], ['New rows in Your queue', '9, lowest confidence first', '']],
  next: 'Next: decide the 9 rows in Your queue (link).',
});
const good = () => renderReport(base());
const has = (problems, text) => problems.some((p) => p.includes(text));

// ---- the examples of the design -----------------------------------------------------------------------------------------------

// The examples of docs/analysis-2026-10/debate/inputs/report-examples.md, each cut down to the report itself (the sentence, the table, the Next line).
const doc = readFileSync(new URL('../../docs/analysis-2026-10/debate/inputs/report-examples.md', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const examples = doc.slice(doc.indexOf('\n## Examples')).split(/\n### /).slice(1).map((block) => {
  const [title, ...rest] = block.split('\n');
  const paragraphs = rest.join('\n').split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
  const nextAt = paragraphs.findLastIndex((p) => p.startsWith('Next:'));
  const tableAt = nextAt > 0 && paragraphs[nextAt - 1].startsWith('|') ? nextAt - 1 : -1;
  const start = (tableAt >= 0 ? tableAt : nextAt) - 1;
  return { title: title.trim(), text: `${paragraphs.slice(start, nextAt + 1).join('\n\n')}\n` };
});
const example = (title) => examples.find((e) => e.title === title)?.text;

test('the design document has the examples this file reads', () => {
  assert.ok(examples.length >= 10, `found ${examples.length} examples`);
  for (const e of examples) assert.match(e.text, /\nNext: /, e.title);
  assert.match(example('A stopped run'), /^Demo · tag stopped:/);
});

test('every example of the design passes the lint', () => {
  for (const e of examples) assert.deepEqual(lintReport(e.text), [], e.title);
});

test('renderReport produces the examples of the design character for character', () => {
  const status = renderReport({
    sentence: 'Status: nothing is paused; 46 rows and 1 rule change wait for you, more than fit one sitting.',
    header: ['Where', 'Now', ''],
    rows: [
      ['Rulebook', '13 Issue tags, edition 2026-11-04.2, same as Notion', ''],
      ['Your queue', '46 rows, lowest confidence first (the view shows the count)', ''],
      ['Lessons waiting', '1 rule change to approve', ''],
      ['Last run', 'Tag · 4 Nov 09:12 · 214 claims', ''],
    ],
    next: 'Next: start at the top of Your queue (link).',
  });
  assert.equal(status, example('status (more rows wait than fit one sitting)'));

  const tagDemo = renderReport({
    demo: true,
    sentence: 'tag: the agent read the 7 claims and proposed Applies on both of your rows.',
    rows: [['Claims read', '7', ''], ['Your rows', '2, both Applies, citing rule 4', ''], ['Earlier decisions', '5 of 5 agree with the agent', '']],
    next: 'Next: fill in your 2 rows in Your queue (link).',
  });
  assert.equal(tagDemo, example('tag (demo)'));

  const stopped = renderReport({
    demo: true,
    sentence: 'tag stopped: the usage limit was reached after 4 of 7 claims; nothing was written to Notion.',
    next: 'Next: when your Claude allowance is back, type `/claim-tagger demo tag` again; it continues where it stopped.',
  });
  assert.equal(stopped, example('A stopped run'));

  const followUp = renderReport({
    demo: true,
    sentence: 'follow-up, repeated by hand: the agent now agrees with both of your decisions.',
    header: ['Your row', 'Follow-up', ''],
    rows: [['The focus on the COVID-19 vaccine...', 'Fixed', ''], ["Georgia's gubernatorial debate...", 'Fixed', '']],
    next: 'Next: nothing; the demo is complete.',
  });
  assert.equal(followUp, example('follow-up, repeated by hand (demo, only after a promote that stopped before its last step)'));

  const unreachable = renderReport({
    sentence: 'Walkthrough: no demo was created, because the claim tagger cannot reach that Notion page.',
    next: 'Next: in Notion, open that page, choose ⋯ → Connections and add the claim tagger connection, then ask again (or paste another page).',
  });
  assert.equal(unreachable, example('Walkthrough: start, when the page cannot be reached'));
});

// ---- buildReport -----------------------------------------------------------------------------------------------------------------

test('buildReport returns the shape of report.json, with the default header and the sentence trimmed', () => {
  const r = buildReport({ sentence: '  Tag: done.  ', rows: [['A', '1', '']], next: 'Next: nothing.' });
  assert.deepEqual(r, { demo: false, sentence: 'Tag: done.', header: ['What', 'Result', ''], rows: [['A', '1', '']], next: 'Next: nothing.' });
  assert.deepEqual([...DEFAULT_HEADER], ['What', 'Result', '']);
  assert.equal(MAX_ROWS, 5);
});

test('buildReport leaves the table out when there is nothing to count', () => {
  for (const rows of [undefined, [], null]) {
    const r = buildReport({ demo: true, sentence: 'Stopped.', rows, next: 'Next: type it again.' });
    assert.deepEqual(r, { demo: true, sentence: 'Stopped.', next: 'Next: type it again.' });
  }
});

test('buildReport copies its input, so a later change to the input does not change the report', () => {
  const input = base();
  const r = buildReport(input);
  input.rows[0][1] = 'changed';
  input.header[0] = 'changed';
  assert.equal(r.rows[0][1], '214');
  assert.equal(r.header[0], 'What');
});

test('buildReport accepts five rows and refuses six', () => {
  const row = (i) => [`Row ${i}`, String(i), ''];
  assert.equal(buildReport({ ...base(), rows: [1, 2, 3, 4, 5].map(row) }).rows.length, 5);
  assert.throws(() => buildReport({ ...base(), rows: [1, 2, 3, 4, 5, 6].map(row) }), /\$\.rows: must have at most 5 items/);
});

test('buildReport refuses a sentence that is empty or runs over two lines', () => {
  assert.throws(() => buildReport({ ...base(), sentence: '' }), /\$\.sentence/);
  assert.throws(() => buildReport({ ...base(), sentence: '   ' }), /\$\.sentence/);
  assert.throws(() => buildReport({ ...base(), sentence: 'One.\nTwo.' }), /\$\.sentence: must match/);
  assert.throws(() => buildReport({ ...base(), sentence: undefined }), /\$\.sentence/);
  assert.throws(() => buildReport({ ...base(), sentence: 7 }), /\$\.sentence: expected string/);
});

test('buildReport refuses a Next line that does not start with "Next: " or says nothing', () => {
  for (const next of ['Next:', 'Next: ', 'Next:  ', 'next: do it', 'Then: do it', 'Next:do it', 'Next: one\ntwo', undefined, null]) {
    assert.throws(() => buildReport({ ...base(), next }), /\$\.next/, String(next));
  }
  assert.equal(buildReport({ ...base(), next: '  Next: do it.  ' }).next, 'Next: do it.', 'surrounding spaces are cut');
});

test('buildReport refuses rows that are not three strings on one line', () => {
  const rows = (...r) => ({ ...base(), rows: r });
  assert.throws(() => buildReport(rows(['A', '1'])), /\$\.rows\[0\]: must have at least 3 items/);
  assert.throws(() => buildReport(rows(['A', '1', '', 'x'])), /\$\.rows\[0\]: must have at most 3 items/);
  assert.throws(() => buildReport(rows(['A', 1, ''])), /\$\.rows\[0\]\[1\]: expected string/);
  assert.throws(() => buildReport(rows(['A', null, ''])), /\$\.rows\[0\]\[1\]: expected string/);
  assert.throws(() => buildReport(rows(['A', 'two\nlines', ''])), /\$\.rows\[0\]\[1\]: must match/);
  assert.throws(() => buildReport(rows('not a row')), /\$\.rows\[0\]: expected array/);
  assert.throws(() => buildReport({ ...base(), rows: 'text' }), /\$\.rows: expected array/);
});

test('buildReport refuses a header that is not three strings with the first two filled', () => {
  const header = (h) => ({ ...base(), header: h });
  assert.throws(() => buildReport(header(['What', 'Result'])), /\$\.header: must have at least 3 items/);
  assert.throws(() => buildReport(header(['', 'Result', ''])), /header\[0\]: the first header cell must not be empty/);
  assert.throws(() => buildReport(header(['What', ' ', ''])), /header\[1\]: the second header cell must not be empty/);
  assert.throws(() => buildReport(header(['What', 'Result', 3])), /\$\.header\[2\]: expected string/);
});

test('buildReport refuses a demo flag that is not true or false, and names every problem at once', () => {
  assert.throws(() => buildReport({ ...base(), demo: 'yes' }), /\$\.demo: expected boolean/);
  assert.throws(() => buildReport({ demo: 1, sentence: '', rows: [['x', 'y']], next: 'later' }), (e) => /\$\.demo/.test(e.message) && /\$\.sentence/.test(e.message) && /\$\.rows\[0\]/.test(e.message) && /\$\.next/.test(e.message));
  assert.throws(() => buildReport(), /\$\.sentence/);
});

// ---- renderReport ----------------------------------------------------------------------------------------------------------------

test('renderReport: sentence, blank line, table, blank line, Next line, one final newline', () => {
  assert.equal(good(), [
    'Tag: the agent read 214 new claims for Context-dependent; 9 of them wait for you.',
    '',
    '| What | Result |',
    '|---|---|',
    '| Claims read | 214 |',
    '| New rows in Your queue | 9, lowest confidence first |',
    '',
    'Next: decide the 9 rows in Your queue (link).',
    '',
  ].join('\n'));
});

test('renderReport: without rows there are two parts, and demo puts "Demo · " in front of the sentence once', () => {
  const md = renderReport({ demo: true, sentence: 'tag stopped: nothing was written.', next: 'Next: type it again.' });
  assert.equal(md, 'Demo · tag stopped: nothing was written.\n\nNext: type it again.\n');
  assert.equal(DEMO_PREFIX, 'Demo · ');
  const again = renderReport({ demo: true, sentence: 'Demo · tag: done.', next: 'Next: nothing.' });
  assert.equal(again, 'Demo · tag: done.\n\nNext: nothing.\n', 'a sentence that already has the prefix does not get it twice');
  const plain = renderReport({ demo: false, sentence: 'Demo · tag: done.', next: 'Next: nothing.' });
  assert.ok(plain.startsWith('Demo · tag: done.'));
});

test('renderReport: a third column appears when the header or any row fills it', () => {
  const md = renderReport({
    sentence: 'Three columns.',
    header: ['Tag', 'Rows', 'Waiting'],
    rows: [['Context-dependent', '31', '9'], ['Wordy', '0', '']],
    next: 'Next: go on.',
  });
  assert.equal(md, 'Three columns.\n\n| Tag | Rows | Waiting |\n|---|---|---|\n| Context-dependent | 31 | 9 |\n| Wordy | 0 |  |\n\nNext: go on.\n');
  const oneRow = renderReport({ sentence: 'S.', rows: [['A', '1', 'x']], next: 'Next: n.' });
  assert.match(oneRow, /\| What \| Result \|  \|\n\|---\|---\|---\|\n\| A \| 1 \| x \|/, 'an empty header cell above a filled column');
});

test('renderReport: a pipe inside a cell is escaped, and the lint accepts the escape', () => {
  const md = renderReport({ sentence: 'Pipes.', rows: [['a | b', 'c', '']], next: 'Next: n.' });
  assert.match(md, /\| a \\\| b \| c \|/);
  assert.deepEqual(lintReport(md), []);
});

test('renderReport checks the shape too', () => {
  assert.throws(() => renderReport({ sentence: 'x', next: 'no prefix' }), /\$\.next/);
});

// ---- lintReport: one defect at a time ----------------------------------------------------------------------------------------------

test('the plain report passes, and so do dates, editions, slash commands and links', () => {
  assert.deepEqual(lintReport(good()), []);
  const md = renderReport({
    sentence: 'Tag · 4 Nov 09:12: 214 claims read under edition 2026-11-04.2; see rule 4 and COVID-19 in step 3.',
    rows: [['Rulebook', 'Today the weekly check ran; 16 Oct 11:20', ''], ['Items', 'https://www.notion.so/Your-queue-3fa273e214eb805199f3d12ef01db453', '']],
    next: 'Next: type `/claim-tagger demo promote` and open Your queue (https://example.com/q?v=1).',
  });
  assert.deepEqual(lintReport(md), []);
});

test('lint: more than three parts', () => {
  assert.ok(has(lintReport(`${good()}\nA fourth paragraph.\n`), 'more than three parts (4)'));
  assert.ok(has(lintReport(`A first paragraph.\n\n${good()}`), 'more than three parts (4)'));
  assert.ok(!has(lintReport(renderReport({ sentence: 'Two parts.', next: 'Next: x.' })), 'more than three parts'));
});

test('lint: the first part is one sentence, not a table and not the Next line', () => {
  assert.ok(has(lintReport('Line one\nline two\n\nNext: x.\n'), 'runs over more than one line'));
  assert.ok(has(lintReport('Sentence\n| a | b |\n|---|---|\n| 1 | 2 |\n\nNext: x.\n'), 'runs over more than one line'));
  assert.ok(has(lintReport('| a | b |\n|---|---|\n| 1 | 2 |\n\nNext: x.\n'), 'does not start with a sentence'));
  assert.ok(has(lintReport('Next: x.\n'), 'does not start with a sentence'));
});

test('lint: a heading line', () => {
  for (const heading of ['# Tag report', '## Result', '###### Deep', '   # Indented', '#', '---', '=====']) {
    assert.ok(has(lintReport(`${heading}\n\n${good()}`), 'is a heading or a rule line'), heading);
  }
  assert.ok(!has(lintReport(good()), 'heading'), 'the table separator is not a rule line');
  assert.ok(!has(lintReport(renderReport({ sentence: 'Issue #4 and C# are fine.', next: 'Next: x.' })), 'heading'));
});

test('lint: a file path, a run folder or a script name', () => {
  for (const sentence of [
    'See runs/20261015T091200Z-tag/report.md.', 'Written to the runs/ folder.', 'Ran pull.mjs.', 'Look in C:\\Users\\x\\file.', 'Look in X:/work/geo-agents.', 'Open a\\b.',
  ]) {
    const problems = lintReport(renderReport({ sentence, next: 'Next: x.' }));
    assert.ok(problems.some((p) => /run folder|script file|file path/.test(p)), sentence);
  }
});

test('lint: a run id', () => {
  assert.ok(has(lintReport(renderReport({ sentence: 'Run 20261015T091200Z finished.', next: 'Next: x.' })), 'holds a run id: 20261015T091200Z'));
  assert.ok(has(lintReport(renderReport({ sentence: 'Done.', rows: [['Run', '20261015T091200Z-tag', '']], next: 'Next: x.' })), 'run id'));
});

test('lint: duration words, whole words, any case, and units stuck to a number', () => {
  for (const word of ['minute', 'minutes', 'hour', 'hours', 'day', 'days', 'week', 'weeks', 'second', 'seconds', 'ms', 'Minutes', 'HOURS', 'Day', 'MS']) {
    assert.ok(has(lintReport(renderReport({ sentence: `It took 3 ${word} to finish.`, next: 'Next: x.' })), 'holds a duration word'), word);
  }
  for (const stuck of ['16ms', '3days', '2hours', '5weeks']) {
    assert.ok(has(lintReport(renderReport({ sentence: `Took ${stuck}.`, next: 'Next: x.' })), 'holds a duration word'), stuck);
  }
  const fine = ['today', 'weekly', 'Sunday', 'daylight', 'Items', 'Teams', 'seconded', 'hourly', 'minuter', 'Monday 5 Oct', '16 Oct 11:20', '4 Nov 09:12'];
  for (const word of fine) assert.ok(!has(lintReport(renderReport({ sentence: `It was ${word} again.`, next: 'Next: x.' })), 'duration'), word);
});

test('lint: a dollar sign, in the sentence, a cell or the Next line', () => {
  assert.ok(has(lintReport(renderReport({ sentence: 'It cost $1.20.', next: 'Next: x.' })), 'dollar sign'));
  assert.ok(has(lintReport(renderReport({ sentence: 'S.', rows: [['Cost', '$3', '']], next: 'Next: x.' })), 'dollar sign'));
  assert.ok(has(lintReport(renderReport({ sentence: 'S.', next: 'Next: pay $5.' })), 'dollar sign'));
});

test('lint: a JSON brace', () => {
  assert.ok(has(lintReport(renderReport({ sentence: 'Got {"a": 1}.', next: 'Next: x.' })), 'JSON brace'));
  assert.ok(has(lintReport(renderReport({ sentence: 'Got }.', next: 'Next: x.' })), 'JSON brace'));
  assert.ok(has(lintReport(renderReport({ sentence: 'S.', next: 'Next: open {link}.' })), 'JSON brace'), 'an unfilled placeholder is caught too');
});

test('lint: shorthand codes (D, C, R, ED, O, G, LS, WT followed by digits)', () => {
  for (const code of ['D19', 'C5', 'R13', 'ED-8', 'O3', 'G1', 'LS2', 'WT-1', 'D-12', 'C22']) {
    assert.ok(has(lintReport(renderReport({ sentence: `Decision ${code} applies.`, next: 'Next: x.' })), `shorthand code ${code}`), code);
  }
  for (const fine of ['COVID-19', 'rule 4', 'edition 2026-11-04.2', 'step 3', 'ED', 'D', 'Q4', 'A1', 'H2O', 'C-section', 'the 3rd', 'mp3']) {
    assert.ok(!has(lintReport(renderReport({ sentence: `Saw ${fine} here.`, next: 'Next: x.' })), 'shorthand'), fine);
  }
});

test('lint: the words database, rubric and gate (editors say table, rulebook and safety check)', () => {
  for (const word of ['database', 'databases', 'Database', 'rubric', 'Rubrics', 'gate', 'GATE', 'gates']) {
    assert.ok(has(lintReport(renderReport({ sentence: `The ${word} is ready.`, next: 'Next: x.' })), 'editors read table, rulebook and safety check'), word);
  }
  for (const fine of ['table', 'tables', 'rulebook', 'Rulebook', 'safety check', 'navigate', 'aggregate', 'gateway', 'data']) {
    assert.deepEqual(lintReport(renderReport({ sentence: `The ${fine} is ready.`, next: 'Next: x.' })), [], fine);
  }
});

test('lint: an Insight block marker', () => {
  assert.ok(has(lintReport(`${good()}\n✶ Insight ─────────────────\n`), 'Insight block marker'));
  assert.ok(has(lintReport(renderReport({ sentence: '★ Insight: it works.', next: 'Next: x.' })), 'Insight block marker'));
  assert.ok(!has(lintReport(renderReport({ sentence: 'We gained an insight.', next: 'Next: x.' })), 'Insight block marker'));
});

test('lint: quoted claim text is not checked for words and characters, and everything outside the quotes still is', () => {
  const claim = "Melania Trump should not host her initiative's G20 event for two weeks, a $2.87 million fee";
  assert.deepEqual(lintReport(renderReport({ demo: true, sentence: `promote: FAIL, the new wording turns "${claim}" to Does not apply.`, next: 'Next: type `/claim-tagger demo promote`.' })), []);
  assert.deepEqual(lintReport(renderReport({ sentence: 'It turns “It lasted 3 days, cost $5 and used {braces} at runs/x or pull.mjs, D5” to Does not apply.', next: 'Next: x.' })), [], 'curly quotes too');
  assert.deepEqual(lintReport(renderReport({ sentence: 'Rows.', rows: [['"In the first 100 days, the database rule"', 'Fixed', '']], next: 'Next: x.' })), [], 'in a table cell');
  const unquoted = lintReport(renderReport({ sentence: `The claim ${claim} was turned.`, next: 'Next: x.' }));
  assert.ok(has(unquoted, 'duration word: "weeks"') && has(unquoted, 'dollar sign') && has(unquoted, 'shorthand code G20'), unquoted.join(' | '));
  const outside = lintReport(renderReport({ sentence: 'The claim "lasted two weeks" and it then took 3 days.', next: 'Next: x.' }));
  assert.deepEqual(outside.map((p) => p.replace(/^line \d+ /, '')), ['holds a duration word: "days"'], 'only the unquoted part is found');
  for (const sentence of ['He said "two weeks later.', "He said 'two weeks' later.", 'He said "one" and then two weeks.', 'He said "a"" two weeks']) {
    assert.ok(has(lintReport(renderReport({ sentence, next: 'Next: x.' })), 'duration word: "weeks"'), sentence);
  }
  assert.ok(has(lintReport(`# "Quoted heading"\n\n${good()}`), 'is a heading or a rule line'), 'a quote does not hide a heading');
  assert.ok(has(lintReport('Tag: "a quoted claim".\n'), 'no line starts with "Next:"'), 'or a missing Next line');
  assert.ok(has(lintReport(`${good()}\n"A fourth paragraph."\n`), 'more than three parts'));
});

test('lint: exactly one Next line, and it is the last line', () => {
  const noNext = 'Tag: done.\n\n| What | Result |\n|---|---|\n| A | 1 |\n';
  assert.ok(has(lintReport(noNext), 'no line starts with "Next:"'));
  assert.ok(has(lintReport(''), 'no line starts with "Next:"'));
  assert.ok(has(lintReport(undefined), 'no line starts with "Next:"'));
  assert.ok(has(lintReport('Sentence. Next: later.\n'), 'no line starts with "Next:"'), 'Next in the middle of a line does not count');
  assert.ok(has(lintReport('Tag: done.\n\nNext: one.\nNext: two.\n'), '2 lines start with "Next:"'));
  assert.ok(has(lintReport('Tag: done.\n\nNext: one.\nand then some more text\n'), 'the Next line is not the last line'));
  assert.ok(has(lintReport('Tag: done.\nNext: one.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n'), 'the Next line is not the last line'));
  assert.deepEqual(lintReport('Tag: done.\n\nNext: one.'), [], 'the final newline is not needed');
  assert.deepEqual(lintReport('Tag: done.\r\n\r\nNext: one.\r\n'), [], 'Windows line ends are fine');
});

test('lint reports every problem, each once per occurrence, in line order', () => {
  const md = '# Report\n\nRan pull.mjs for 3 days; cost $2.\n\nNext: x.\n';
  const problems = lintReport(md);
  assert.equal(problems.length, 4, problems.join(' | '));
  assert.ok(has(problems, 'line 1 is a heading'));
  assert.ok(has(problems, 'line 3 names a script file'));
  assert.ok(has(problems, 'line 3 holds a duration word: "days"'));
  assert.ok(has(problems, 'line 3 holds a dollar sign'));
});

// ---- writeReport -----------------------------------------------------------------------------------------------------------------

test('writeReport writes report.json and report.md next to each other', () => {
  const dir = join(tmp(), 'run');
  const out = writeReport(dir, base());
  assert.equal(out.md, join(dir, 'report.md'));
  assert.equal(readFileSync(out.md, 'utf8'), good());
  assert.equal(out.markdown, good());
  const json = JSON.parse(readFileSync(out.json, 'utf8'));
  assert.deepEqual(json, base());
  assert.deepEqual(buildReport(json), json, 'report.json is a valid report');
  assert.deepEqual(renderReport(json), good(), 'and renders to the same Markdown');
  assert.deepEqual(readdirSync(dir).sort(), ['report.json', 'report.md']);
});

test('writeReport writes a demo report without a table', () => {
  const dir = tmp();
  writeReport(dir, { demo: true, sentence: 'tag stopped: the usage limit was reached.', next: 'Next: type `/claim-tagger demo tag` again.' });
  assert.equal(readFileSync(join(dir, 'report.md'), 'utf8'), 'Demo · tag stopped: the usage limit was reached.\n\nNext: type `/claim-tagger demo tag` again.\n');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')), { demo: true, sentence: 'tag stopped: the usage limit was reached.', next: 'Next: type `/claim-tagger demo tag` again.' });
});

test('writeReport throws before writing anything when the lint finds a problem', () => {
  const dir = join(tmp(), 'never');
  assert.throws(() => writeReport(dir, { ...base(), sentence: 'It took 3 minutes and cost $2.' }), (e) => {
    assert.equal(e.code, 'REPORT_LINT');
    assert.ok(e.problems.length >= 2);
    assert.match(e.message, /would not pass the report lint/);
    assert.match(e.message, /duration word/);
    return true;
  });
  assert.equal(existsSync(dir), false, 'not even the folder was made');
});

test('writeReport throws on a bad shape before it writes anything', () => {
  const dir = join(tmp(), 'never');
  assert.throws(() => writeReport(dir, { ...base(), next: 'later' }), /\$\.next/);
  assert.equal(existsSync(dir), false);
});

test('writeReport replaces the files of an earlier report in the same folder', () => {
  const dir = tmp();
  writeReport(dir, base());
  writeReport(dir, { sentence: 'Later report.', next: 'Next: done.' });
  assert.equal(readFileSync(join(dir, 'report.md'), 'utf8'), 'Later report.\n\nNext: done.\n');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')), { demo: false, sentence: 'Later report.', next: 'Next: done.' });
  assert.deepEqual(readdirSync(dir).sort(), ['report.json', 'report.md'], 'no temp files are left');
});
