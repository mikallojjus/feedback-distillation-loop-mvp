import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, splitRichText } from '../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';
import {
  LINT_RULES, blockText, countBlocks, lintPage, parseInline, renderPreview, splitAtMarkers, toBlocks,
} from '../../agents/claim-tagger-mvp/scripts/lib/notion-blocks.mjs';
import { createFakeNotion } from './fixtures/fake-notion.mjs';

const MODULE = fileURLToPath(new URL('../../agents/claim-tagger-mvp/scripts/lib/notion-blocks.mjs', import.meta.url));
const PAGE_FILE = fileURLToPath(new URL('../../agents/claim-tagger-mvp/walkthrough/page.md', import.meta.url));
const MANIFEST_FILE = fileURLToPath(new URL('../../agents/claim-tagger-mvp/walkthrough/manifest.json', import.meta.url));
const OK = readFileSync(new URL('./fixtures/walkthrough-page.ok.md', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const DOT = '\u00b7'; // the middle dot of "Step 1 · Meet the demo"
const MEMO = '\u{1F4DD}';
const CALLOUT = 'You type four commands yourself (status, tag, distill and promote); the follow-up runs by itself after a PASS, and the engineer sets things up and fixes what breaks.';
const VALUES = { edition: '2026-10-15.1', next_edition: '2026-10-15.2', date: '15 Oct' };
const MANIFEST = {
  steps: [
    { n: 1, title: 'Meet the demo', command: '/claim-tagger demo status', affects: [] },
    { n: 2, title: 'The agent reads the claims', command: '/claim-tagger demo tag', affects: ['Tag decisions', 'Claims'] },
    { n: 3, title: 'Decide your two rows', command: null, affects: ['Tag decisions'] },
    { n: 4, title: 'The agent drafts a clearer rule 4', command: '/claim-tagger demo distill', affects: ['Rule changes'] },
    { n: 5, title: 'Approve the draft', command: null, affects: ['Rule changes'] },
    { n: 6, title: 'The safety check', command: '/claim-tagger demo promote', affects: ['Rulebook', 'Rule changes', 'Agent settings'] },
    { n: 7, title: 'The agent re-checks your rows', command: null, affects: ['Tag decisions', 'Claims'] },
  ],
};

// A text object the way parseInline writes it.
const t = (content, annotations) => ({ type: 'text', text: { content }, ...(annotations ? { annotations } : {}) });
const linked = (content, url, annotations) => ({ type: 'text', text: { content, link: { url } }, ...(annotations ? { annotations } : {}) });
const block = (type, payload) => ({ object: 'block', type, [type]: payload });
const paragraph = (...rich) => block('paragraph', { rich_text: rich });

/** Replace the one place `from` occurs; fails when it occurs zero or several times, so a mutation can never silently miss. */
function swap(source, from, to) {
  const first = source.indexOf(from);
  assert.notEqual(first, -1, `the text has no: ${from}`);
  assert.equal(source.indexOf(from, first + from.length), -1, `the text has more than one: ${from}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}
/** The 1-based number of the nth line that contains `needle`. */
function lineNo(source, needle, nth = 1) {
  let seen = 0;
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(needle) && ++seen === nth) return i + 1;
  }
  throw new Error(`no line ${nth} contains: ${needle}`);
}
/** "rule@line" for each problem, in the order the lint returns them. */
const summary = (result) => result.problems.map((p) => `${p.rule}@${p.line}`);
const lint = (source, manifest) => lintPage(source, manifest ? { manifest } : undefined);
// The fixture's safe sentence in Step 1: a place to add a phrase without touching anything else.
const SAFE = 'see what waits for whom.';
const withSafe = (extra) => swap(OK, SAFE, `see what waits for whom; ${extra}`);

// ---- the module itself ---------------------------------------------------------------------------------------------------------

test('the module imports only notion-rest and reads no file, no network and no environment', () => {
  const code = readFileSync(MODULE, 'utf8').split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n');
  const imports = [...code.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./notion-rest.mjs']);
  assert.doesNotMatch(code, /process\.env|readFileSync|writeFile|\bfetch\(|node:fs|node:child_process|\.env\b/);
});

test('LINT_RULES names the rules a to m', () => {
  assert.deepEqual(Object.keys(LINT_RULES), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm']);
  assert.ok(Object.isFrozen(LINT_RULES));
  for (const name of Object.values(LINT_RULES)) assert.match(name, /^[a-z]+(?:-[a-z]+)*$/);
});

test('none of the functions changes what it is given (frozen values, manifest and blocks do not throw)', () => {
  const deepFreeze = (value) => {
    if (value !== null && typeof value === 'object') {
      Object.freeze(value);
      for (const inner of Object.values(value)) deepFreeze(inner);
    }
    return value;
  };
  const values = deepFreeze({ ...VALUES });
  const manifest = deepFreeze(JSON.parse(JSON.stringify(MANIFEST)));
  const blocks = deepFreeze(toBlocks(OK, { values }));
  assert.doesNotThrow(() => {
    renderPreview(OK, values);
    lintPage(OK, { manifest });
    splitAtMarkers(blocks);
    countBlocks(blocks);
    blocks.forEach(blockText);
  });
  assert.deepEqual(toBlocks(OK, { values }), JSON.parse(JSON.stringify(blocks)), 'the same call gives the same blocks');
});

// ---- parseInline -----------------------------------------------------------------------------------------------------------------

test('parseInline: plain text is what splitRichText gives; empty input gives no objects', () => {
  assert.deepEqual(parseInline('Hello, world'), [t('Hello, world')]);
  assert.deepEqual(parseInline('Hello, world'), splitRichText('Hello, world'));
  assert.deepEqual(parseInline(''), []);
  assert.deepEqual(parseInline(null), []);
  assert.deepEqual(parseInline(undefined), []);
  assert.deepEqual(parseInline(42), [t('42')]);
});

test('parseInline: bold, italic and code each become a run with only that flag on', () => {
  assert.deepEqual(parseInline('a **b** c'), [t('a '), t('b', { bold: true }), t(' c')]);
  assert.deepEqual(parseInline('a *b* c'), [t('a '), t('b', { italic: true }), t(' c')]);
  assert.deepEqual(parseInline('a `b` c'), [t('a '), t('b', { code: true }), t(' c')]);
  assert.deepEqual(parseInline('**Goal of the step.** Check it'), [t('Goal of the step.', { bold: true }), t(' Check it')]);
});

test('parseInline: a link keeps its text and address, the text may be styled, an address may hold parentheses', () => {
  assert.deepEqual(parseInline('see [the page](https://example.com/a?b=1) now'), [t('see '), linked('the page', 'https://example.com/a?b=1'), t(' now')]);
  assert.deepEqual(parseInline('[**bold** link](https://x.y)'), [linked('bold', 'https://x.y', { bold: true }), linked(' link', 'https://x.y')]);
  assert.deepEqual(parseInline('[w](https://en.wikipedia.org/wiki/Foo_(bar))!'), [linked('w', 'https://en.wikipedia.org/wiki/Foo_(bar)'), t('!')]);
  assert.deepEqual(parseInline('[`code` link](https://x.y)'), [linked('code', 'https://x.y', { code: true }), linked(' link', 'https://x.y')]);
});

test('parseInline: styles nest (bold with italic or code inside, bold and italic together)', () => {
  assert.deepEqual(parseInline('**a *b* c**'), [t('a ', { bold: true }), t('b', { bold: true, italic: true }), t(' c', { bold: true })]);
  assert.deepEqual(parseInline('***both***'), [t('both', { bold: true, italic: true })]);
  assert.deepEqual(parseInline('**use `x` now**'), [t('use ', { bold: true }), t('x', { bold: true, code: true }), t(' now', { bold: true })]);
  assert.deepEqual(parseInline('*it **bo** it*'), [t('it ', { italic: true }), t('bo', { bold: true, italic: true }), t(' it', { italic: true })]);
  assert.deepEqual(parseInline('**a** **b**'), [t('a', { bold: true }), t(' '), t('b', { bold: true })]);
});

test('parseInline: a marker that is not closed, or has a space inside it, stays text', () => {
  assert.deepEqual(parseInline('a **b'), [t('a **b')]);
  assert.deepEqual(parseInline('2 * 3 * 4'), [t('2 * 3 * 4')]);
  assert.deepEqual(parseInline('5 ** 2'), [t('5 ** 2')]);
  assert.deepEqual(parseInline('snake_case_name and under_score'), [t('snake_case_name and under_score')]);
  assert.deepEqual(parseInline('[x] is not a link'), [t('[x] is not a link')]);
  assert.deepEqual(parseInline('[x](unclosed'), [t('[x](unclosed')]);
  assert.deepEqual(parseInline('a ` b'), [t('a ` b')]);
  assert.deepEqual(parseInline('**a *b** c'), [t('a *b', { bold: true }), t(' c')]);
});

test('parseInline: a backslash before punctuation gives that character as plain text', () => {
  assert.deepEqual(parseInline('\\*not italic\\*'), [t('*not italic*')]);
  assert.deepEqual(parseInline('a \\[b\\](c) \\`d\\`'), [t('a [b](c) `d`')]);
  assert.deepEqual(parseInline('back\\\\slash'), [t('back\\slash')]);
  assert.deepEqual(parseInline('C:\\Users\\me'), [t('C:\\Users\\me')]);
  assert.deepEqual(parseInline('**a\\*b**'), [t('a*b', { bold: true })]);
});

test('parseInline: {{edition}} and {{date}} are left as text, in plain and in styled runs', () => {
  assert.deepEqual(parseInline('edition {{edition}} on {{date}}'), [t('edition {{edition}} on {{date}}')]);
  assert.deepEqual(parseInline('**{{edition}}**'), [t('{{edition}}', { bold: true })]);
});

test('parseInline: no object holds more than 2,000 characters, and the pieces add up to the text', () => {
  const long = 'x'.repeat(4500);
  assert.deepEqual(parseInline(long), splitRichText(long));
  assert.deepEqual(parseInline(long).map((r) => r.text.content.length), [2000, 2000, 500]);
  assert.deepEqual(parseInline(long).map((r) => r.annotations), [undefined, undefined, undefined]);

  const bold = parseInline(`**${'y'.repeat(2500)}**`);
  assert.deepEqual(bold.map((r) => r.text.content.length), [2000, 500]);
  assert.ok(bold.every((r) => r.annotations?.bold === true), 'each piece of a bold run is bold');

  const link = parseInline(`[${'z'.repeat(2001)}](https://x.y)`);
  assert.deepEqual(link.map((r) => r.text.content.length), [2000, 1]);
  assert.ok(link.every((r) => r.text.link.url === 'https://x.y'), 'each piece of a link keeps the link');

  const exact = parseInline('q'.repeat(2000));
  assert.equal(exact.length, 1);
  assert.equal(parseInline('q'.repeat(2001)).length, 2);

  const pair = `${'a'.repeat(1999)}\u{1F600}b`; // the emoji would be cut in two at the boundary
  const pieces = parseInline(pair);
  assert.equal(pieces.map((r) => r.text.content).join(''), pair);
  assert.ok(pieces.every((r) => r.text.content.length <= 2000));
  assert.deepEqual(pieces, splitRichText(pair));
});

// ---- toBlocks: every kind of block ----------------------------------------------------------------------------------------------

test('toBlocks: a paragraph, and an empty page', () => {
  assert.deepEqual(toBlocks('Hello **world**'), [paragraph(t('Hello '), t('world', { bold: true }))]);
  assert.deepEqual(toBlocks(''), []);
  assert.deepEqual(toBlocks('\n\n  \n'), []);
  assert.deepEqual(toBlocks(null), []);
});

test('toBlocks: lines of one paragraph stay together with their line breaks; blank lines separate paragraphs', () => {
  assert.deepEqual(toBlocks('one\ntwo\n\nthree\n\n\n  four  '), [
    paragraph(t('one\ntwo')),
    paragraph(t('three')),
    paragraph(t('four')),
  ]);
  assert.deepEqual(toBlocks('one\r\ntwo\r\n\r\nthree'), [paragraph(t('one\ntwo')), paragraph(t('three'))]);
});

test('toBlocks: "# ", "## " and "### " are headings 1 to 3; "#### " and deeper are heading 3; text after the marks is inline Markdown', () => {
  const kinds = toBlocks(['# One', '## Two', '### Three', '#### Four', '##### Five', '###### Six'].join('\n')).map((b) => b.type);
  assert.deepEqual(kinds, ['heading_1', 'heading_2', 'heading_3', 'heading_3', 'heading_3', 'heading_3']);
  assert.deepEqual(toBlocks('## Step 1 \u00b7 **Meet** the demo'), [block('heading_2', { rich_text: [t('Step 1 \u00b7 '), t('Meet', { bold: true }), t(' the demo')] })]);
  assert.deepEqual(toBlocks('#nospace and #### too far right')[0].type, 'paragraph');
  assert.deepEqual(toBlocks('####### seven')[0].type, 'paragraph');
});

test('toBlocks: bullets ("- " or "* ") and an indented line under one, which joins its text with a space', () => {
  assert.deepEqual(toBlocks(['- a', '  continued **here**', '* b', '- c'].join('\n')), [
    block('bulleted_list_item', { rich_text: [t('a continued '), t('here', { bold: true })] }),
    block('bulleted_list_item', { rich_text: [t('b')] }),
    block('bulleted_list_item', { rich_text: [t('c')] }),
  ]);
  // an unindented line under a bullet is a new paragraph, not a continuation
  assert.deepEqual(toBlocks('- a\nb').map((b) => b.type), ['bulleted_list_item', 'paragraph']);
  // a blank line ends the continuation
  assert.deepEqual(toBlocks('- a\n\n  b').map((b) => b.type), ['bulleted_list_item', 'paragraph']);
});

test('toBlocks: numbered items, with the same continuation rule', () => {
  assert.deepEqual(toBlocks(['1. first', '2. second', '   more', '3) third'].join('\n')), [
    block('numbered_list_item', { rich_text: [t('first')] }),
    block('numbered_list_item', { rich_text: [t('second more')] }),
    block('numbered_list_item', { rich_text: [t('third')] }),
  ]);
  // a number in the middle of a line is only text
  assert.deepEqual(toBlocks('**If it fails.** 1. Open it. 2. Type it.').map((b) => b.type), ['paragraph']);
  assert.deepEqual(toBlocks('2026-10-15.1 is the edition').map((b) => b.type), ['paragraph']);
});

test('toBlocks: a list line that ends with a backslash keeps the line break before the indented line under it, so a sentence can stand on a line of its own inside an item', () => {
  assert.deepEqual(toBlocks(['1. Challenged tags notes: paste this sentence:\\', '   "Rule 3 does not say it."', '2. Review status: Reviewed.'].join('\n')), [
    block('numbered_list_item', { rich_text: [t('Challenged tags notes: paste this sentence:\n"Rule 3 does not say it."')] }),
    block('numbered_list_item', { rich_text: [t('Review status: Reviewed.')] }),
  ]);
  // the same in a bullet: a break, then a continuation that joins with a space as before
  assert.deepEqual(toBlocks(['- a\\', '  b', '  c'].join('\n')), [block('bulleted_list_item', { rich_text: [t('a\nb c')] })]);
  // two backslashes at the end of a line are one backslash of text, and make no break
  assert.deepEqual(toBlocks(['- a\\\\', '  b'].join('\n')), [block('bulleted_list_item', { rich_text: [t('a\\ b')] })]);
  // a break with nothing after it leaves no trailing line break
  assert.deepEqual(toBlocks('- a\\'), [block('bulleted_list_item', { rich_text: [t('a')] })]);
  // the plain text of such an item keeps the break; a paragraph line is not touched by the rule
  assert.equal(blockText(toBlocks('1. x\\\n   y')[0]), 'x\ny');
  assert.deepEqual(toBlocks('a\\\nb'), [paragraph(t('a\\\nb'))]);
});

test('toBlocks: "> " is a quote and adjacent quote lines join into one; "---" is a divider', () => {
  assert.deepEqual(toBlocks(['> one', '> two', '', '> three', '---', '-----', 'x'].join('\n')), [
    block('quote', { rich_text: [t('one\ntwo')] }),
    block('quote', { rich_text: [t('three')] }),
    block('divider', {}),
    block('divider', {}),
    paragraph(t('x')),
  ]);
});

test('toBlocks: a paragraph that starts "Callout: " is a callout with a memo icon; the lines under it stay inside it', () => {
  const [callout, after] = toBlocks('Callout: First line.\nSecond line **bold**.\n\nNext paragraph');
  assert.deepEqual(callout, {
    object: 'block',
    type: 'callout',
    callout: { rich_text: [t('First line.\nSecond line '), t('bold', { bold: true }), t('.')], icon: { type: 'emoji', emoji: MEMO } },
  });
  assert.deepEqual(after, paragraph(t('Next paragraph')));
  assert.deepEqual(toBlocks('Callout:no space')[0].type, 'paragraph');
  assert.deepEqual(toBlocks('A Callout: in the middle')[0].type, 'paragraph');
  // a structure line ends the callout
  assert.deepEqual(toBlocks('Callout: one\n- bullet').map((b) => b.type), ['callout', 'bulleted_list_item']);
});

test('toBlocks: a pipe table is a table block with its width, header flags and table_row children whose cells are rich text', () => {
  const md = ['| Name | Count |', '|---|---:|', '| **Alpha** | 1 |', '| Beta \\| two | `x` |', '| | empty |'].join('\n');
  const [table, ...rest] = toBlocks(md);
  assert.equal(rest.length, 0);
  assert.equal(table.object, 'block');
  assert.equal(table.type, 'table');
  assert.equal(table.table.table_width, 2);
  assert.equal(table.table.has_column_header, true);
  assert.equal(table.table.has_row_header, false);
  assert.equal(table.table.children.length, 4, 'the header row and three body rows, not the separator');
  assert.ok(table.table.children.every((row) => row.object === 'block' && row.type === 'table_row'));
  assert.deepEqual(table.table.children[0].table_row.cells, [[t('Name')], [t('Count')]]);
  assert.deepEqual(table.table.children[1].table_row.cells, [[t('Alpha', { bold: true })], [t('1')]]);
  assert.deepEqual(table.table.children[2].table_row.cells, [[t('Beta | two')], [t('x', { code: true })]]);
  assert.deepEqual(table.table.children[3].table_row.cells, [[], [t('empty')]], 'an empty cell is an empty rich_text array');
  assert.equal(table.children, undefined, 'children sit inside the table object');
});

test('toBlocks: table widths of 1, 3 and 4, a table without outer pipes on the body rows, and a table straight after a paragraph', () => {
  assert.equal(toBlocks('| A |\n|---|\n| 1 |')[0].table.table_width, 1);
  assert.equal(toBlocks('| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |')[0].table.table_width, 3);
  const four = toBlocks('Caption\n| A | B | C | D |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |');
  assert.deepEqual(four.map((b) => b.type), ['paragraph', 'table']);
  assert.equal(four[1].table.table_width, 4);
  assert.equal(four[1].table.children[1].table_row.cells.length, 4);
  assert.equal(toBlocks('| A | B |\n|---|---|').at(0).table.children.length, 1, 'a header row alone is a table');
});

test('toBlocks: the section from "## Help" to the end is one toggle called Help that holds the section as children', () => {
  const md = ['Before', '', '## Help', '', '**Why wrong.**', '', '| A | B |', '|---|---|', '| 1 | 2 |', '', '- one', '- two', '', '## Not a new toggle'].join('\n');
  const blocks = toBlocks(md);
  assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'toggle']);
  const toggle = blocks[1];
  assert.equal(toggle.object, 'block');
  assert.deepEqual(toggle.toggle.rich_text, [t('Help')]);
  assert.deepEqual(toggle.toggle.children.map((b) => b.type), ['paragraph', 'table', 'bulleted_list_item', 'bulleted_list_item', 'heading_2']);
  assert.equal(toggle.toggle.children[1].table.children.length, 2);
  assert.equal(toggle.children, undefined, 'children sit inside the toggle object');
  assert.equal(blockText(toggle.toggle.children[0]), 'Why wrong.');
  // "## Help" has to be the whole heading
  assert.deepEqual(toBlocks('## Helpful tips').map((b) => b.type), ['heading_2']);
  assert.deepEqual(toBlocks('### Help').map((b) => b.type), ['heading_3']);
  // an empty section is a toggle without a children key
  assert.deepEqual(toBlocks('## Help'), [block('toggle', { rich_text: [t('Help')] })]);
});

test('toBlocks: the Help toggle holds up to 100 blocks', () => {
  const items = (n) => Array.from({ length: n }, (_, i) => `- item ${i + 1}`).join('\n');
  assert.equal(toBlocks(`## Help\n\n${items(100)}`)[0].toggle.children.length, 100);
  assert.throws(() => toBlocks(`## Help\n\n${items(101)}`), /line 1: .*101 blocks.*at most 100/);
});

test('a byte-order mark at the start of the file is no part of the text, for the converter, the preview and the lint', () => {
  assert.equal(toBlocks('\uFEFFCallout: Hi')[0].type, 'callout');
  assert.equal(renderPreview('\uFEFFa\nb'), 'a\nb');
  assert.deepEqual(lintPage(`\uFEFF${OK}`, { manifest: MANIFEST }), { ok: true, problems: [] });
});

test('toBlocks: every block has object "block" and a type, and long text is cut at 2,000 characters', () => {
  const md = [`${'w'.repeat(4500)}`, '', `- ${'b'.repeat(2500)}`, '', `| A |`, '|---|', `| ${'c'.repeat(2100)} |`, '', '## Help', '', `> ${'q'.repeat(2001)}`].join('\n');
  const check = (list) => {
    for (const b of list) {
      assert.equal(b.object, 'block');
      assert.equal(typeof b.type, 'string');
      assert.equal(typeof b[b.type], 'object');
      for (const r of b[b.type].rich_text ?? []) assert.ok(r.text.content.length <= 2000);
      for (const cell of b[b.type].cells ?? []) for (const r of cell) assert.ok(r.text.content.length <= 2000);
      if (b[b.type].children) check(b[b.type].children);
    }
  };
  const blocks = toBlocks(md);
  check(blocks);
  assert.deepEqual(blocks[0].paragraph.rich_text.map((r) => r.text.content.length), [2000, 2000, 500]);
  assert.deepEqual(blocks[2].table.children[1].table_row.cells[0].map((r) => r.text.content.length), [2000, 100]);
});

// ---- toBlocks: placeholders and markers ------------------------------------------------------------------------------------------

test('toBlocks: {{edition}}, {{date}} and the keys of values are substituted first; edition and date stay as text without a value', () => {
  const md = 'Edition {{edition}} on {{date}} by {{who}}.\n\n- **{{edition}}**\n\n| A |\n|---|\n| {{date}} |';
  const [p, bullet, table] = toBlocks(md, { values: { edition: '2026-10-15.1', date: '15 Oct', who: 'the agent' } });
  assert.equal(blockText(p), 'Edition 2026-10-15.1 on 15 Oct by the agent.');
  assert.deepEqual(bullet.bulleted_list_item.rich_text, [t('2026-10-15.1', { bold: true })]);
  assert.deepEqual(table.table.children[1].table_row.cells, [[t('15 Oct')]]);
  assert.equal(blockText(toBlocks('{{edition}} and {{date}}')[0]), '{{edition}} and {{date}}');
  assert.equal(blockText(toBlocks('{{edition}}', { values: { edition: 5 } })[0]), '5');
  assert.equal(blockText(toBlocks('{{edition}}', { values: { edition: undefined } })[0]), '{{edition}}');
  assert.equal(blockText(toBlocks('{{ edition }}', { values: { edition: 'E' } })[0]), 'E', 'spaces inside the braces do not matter');
});

test('toBlocks: {{view:<Name>}}, {{tables}} and {{help}} on a line of their own are markers, in order, between the blocks', () => {
  const md = ['A', '', '{{view:Your queue}}', '', 'B', '  {{tables}}  ', '{{help}}', '{{ view: Lessons waiting }}', 'C'].join('\n');
  assert.deepEqual(toBlocks(md), [
    paragraph(t('A')),
    { marker: 'view', name: 'Your queue' },
    paragraph(t('B')),
    { marker: 'tables' },
    { marker: 'help' },
    { marker: 'view', name: 'Lessons waiting' },
    paragraph(t('C')),
  ]);
  const [marker] = toBlocks('{{tables}}');
  assert.equal(marker.object, undefined, 'a marker is not a block');
  assert.equal(marker.type, undefined);
});

test('toBlocks: a marker inside a table, a list or a callout ends it and stands on its own', () => {
  assert.deepEqual(toBlocks('| A |\n|---|\n| 1 |\n{{tables}}\n| B |\n|---|').map((b) => b.type ?? b.marker), ['table', 'tables', 'table']);
  assert.deepEqual(toBlocks('- a\n{{tables}}\n- b').map((b) => b.type ?? b.marker), ['bulleted_list_item', 'tables', 'bulleted_list_item']);
  assert.deepEqual(toBlocks('Callout: a\n{{view:V}}\nb').map((b) => b.type ?? b.marker), ['callout', 'view', 'paragraph']);
});

test('toBlocks: an unknown placeholder throws and names its line', () => {
  const md = ['one', '', 'two {{nope}} three'].join('\n');
  assert.throws(() => toBlocks(md), (e) => e instanceof Error && e.code === 'BLOCKS_SYNTAX' && e.line === 3 && /line 3: unknown placeholder \{\{nope\}\}/.test(e.message));
  assert.throws(() => toBlocks('{{who}}'), /line 1: unknown placeholder \{\{who\}\}/);
  assert.throws(() => toBlocks('| A |\n|---|\n| {{cell}} |'), /line 3: unknown placeholder \{\{cell\}\}/);
  assert.throws(() => toBlocks('## Help\n\nx\n\n- {{inside}}'), /line 5: unknown placeholder \{\{inside\}\}/);
  assert.throws(() => renderPreview('a\n\nb {{nope}}'), /line 3: unknown placeholder \{\{nope\}\}/);
});

test('toBlocks: a block placeholder that shares its line with text, names no view, or sits in the Help section throws with its line', () => {
  assert.throws(() => toBlocks('fine\nSee {{tables}} below'), /line 2: \{\{tables\}\} marks a place on the page and has to stand alone/);
  assert.throws(() => toBlocks('- {{view:Your queue}}'), /line 1: \{\{view:Your queue\}\} marks a place/);
  assert.throws(() => toBlocks('{{view:}}'), /line 1: the placeholder \{\{view:\}\} names no view/);
  assert.throws(() => toBlocks('## Help\n\ntext\n\n{{tables}}'), /line 5: \{\{tables\}\} cannot sit inside the Help section/);
  assert.throws(() => toBlocks('## Help\n\n{{view:Your queue}}'), /line 3: \{\{view:Your queue\}\} cannot sit inside the Help section/);
});

test('toBlocks: an unbalanced table row throws and names its line', () => {
  const md = ['Intro', '', '| A | B |', '|---|---|', '| 1 | 2 |', '| 3 |', ''].join('\n');
  assert.throws(() => toBlocks(md), (e) => e instanceof Error && e.code === 'BLOCKS_SYNTAX' && e.line === 6 && /line 6: this table row has 1 cells but the header row has 2/.test(e.message));
  assert.throws(() => toBlocks('| A |\n|---|\n| 1 | 2 |'), /line 3: this table row has 2 cells but the header row has 1/);
  assert.throws(() => toBlocks('| A | B |\n|---|---|\n| 1 | 2 | 3 |'), /line 3: this table row has 3 cells/);
  assert.throws(() => toBlocks('## Help\n\n| A | B |\n|---|---|\n| only |'), /line 5: this table row has 1 cells/);
});

test('toBlocks: a table needs a separator row of the same width right under its header', () => {
  assert.throws(() => toBlocks('x\n\n| A | B |\n| 1 | 2 |'), /line 3: a table needs a separator row/);
  assert.throws(() => toBlocks('| A | B |'), /line 1: a table needs a separator row/);
  assert.throws(() => toBlocks('| A | B |\n|---|\n| 1 | 2 |'), /line 2: the separator row has 1 cells but the header row has 2/);
  assert.throws(() => toBlocks('| A |\n\n|---|'), /line 1: a table needs a separator row/);
});

test('toBlocks: a nested list is refused with its line, and values may not hold a line break', () => {
  assert.throws(() => toBlocks('- a\n  - b'), /line 2: a nested list is not supported/);
  assert.throws(() => toBlocks('1. a\n   - b'), /line 2: a nested list is not supported/);
  assert.doesNotThrow(() => toBlocks('- a\n\n  - b'), 'after a blank line an indented bullet is just a bullet');
  assert.throws(() => toBlocks('x', { values: { edition: 'a\nb' } }), (e) => e instanceof TypeError && /values\.edition must not hold a line break/.test(e.message));
  assert.throws(() => renderPreview('x', { date: 'a\rb' }), TypeError);
  assert.throws(() => toBlocks('x', { values: 'text' }), TypeError);
});

// ---- splitAtMarkers --------------------------------------------------------------------------------------------------------------

test('splitAtMarkers: each segment is the blocks before a marker and that marker; the last segment has no marker', () => {
  const [a, b, c, d] = [paragraph(t('a')), paragraph(t('b')), paragraph(t('c')), paragraph(t('d'))];
  const view = { marker: 'view', name: 'Your queue' };
  const tables = { marker: 'tables' };
  assert.deepEqual(splitAtMarkers([a, b, view, c, tables, d]), [
    { blocks: [a, b], marker: view },
    { blocks: [c], marker: tables },
    { blocks: [d], marker: null },
  ]);
  assert.equal(splitAtMarkers([a, view]).at(-1).marker, view, 'nothing after the last marker: no empty last segment');
  assert.deepEqual(splitAtMarkers([a, view]), [{ blocks: [a], marker: view }]);
});

test('splitAtMarkers: markers that meet give an empty segment, a page without markers is one segment, an empty page none', () => {
  const a = paragraph(t('a'));
  const [m1, m2] = [{ marker: 'tables' }, { marker: 'help' }];
  assert.deepEqual(splitAtMarkers([m1, m2, a]), [{ blocks: [], marker: m1 }, { blocks: [], marker: m2 }, { blocks: [a], marker: null }]);
  assert.deepEqual(splitAtMarkers([a]), [{ blocks: [a], marker: null }]);
  assert.deepEqual(splitAtMarkers([]), []);
  assert.deepEqual(splitAtMarkers(undefined), []);
});

test('splitAtMarkers on a converted page: the segments come out in the order of the page and hold every block once', () => {
  const md = ['Intro', '', '## One', '', '{{view:Your queue}}', '', '## Two', '', '{{view:Lessons waiting}}', '', '{{tables}}', '', '{{help}}', '', '## Help', '', 'inside'].join('\n');
  const blocks = toBlocks(md);
  const segments = splitAtMarkers(blocks);
  assert.deepEqual(segments.map((s) => s.marker && (s.marker.name ?? s.marker.marker)), ['Your queue', 'Lessons waiting', 'tables', 'help', null]);
  assert.deepEqual(segments.map((s) => s.blocks.map((b) => b.type)), [['paragraph', 'heading_2'], ['heading_2'], [], [], ['toggle']]);
  assert.equal(segments.flatMap((s) => s.blocks).length + segments.filter((s) => s.marker).length, blocks.length);
});

// ---- renderPreview ---------------------------------------------------------------------------------------------------------------

test('renderPreview: text placeholders are substituted, block placeholders stay as lines', () => {
  const md = 'Edition {{edition}} ({{date}})\n\n{{view:Your queue}}\n\n{{tables}}\n{{help}}\n| {{key}} |';
  assert.equal(
    renderPreview(md, { edition: 'E1', date: 'D1', key: 'K' }),
    'Edition E1 (D1)\n\n{{view:Your queue}}\n\n{{tables}}\n{{help}}\n| K |',
  );
  assert.equal(renderPreview('{{edition}} {{date}}'), '{{edition}} {{date}}', 'no values: the text placeholders stay');
  assert.equal(renderPreview('{{edition}}', { edition: 'E' }), 'E');
  assert.equal(renderPreview('a\r\nb\r\n'), 'a\nb\n', 'line breaks are normalised to \\n');
  assert.equal(renderPreview('', {}), '');
  assert.equal(renderPreview('{{edition}}', null), '{{edition}}');
});

test('renderPreview: the same lines come back, a value is put in once and not searched again', () => {
  const out = renderPreview(OK, VALUES);
  assert.equal(out.split('\n').length, OK.split('\n').length);
  assert.doesNotMatch(out, /\{\{(?:edition|next_edition|date)\}\}/);
  assert.match(out, /\{\{view:Your queue\}\}/);
  assert.match(out, /\{\{view:Lessons waiting\}\}/);
  assert.match(out, /^\{\{tables\}\}$/m);
  assert.match(out, /Promote \u00b7 15 Oct \u00b7 PASS/);
  assert.equal(renderPreview('{{edition}}', { edition: '{{date}}', date: 'D' }), '{{date}}');
});

test('renderPreview then toBlocks gives the same blocks and markers as toBlocks with the values', () => {
  assert.deepEqual(toBlocks(renderPreview(OK, VALUES)), toBlocks(OK, { values: VALUES }));
});

// ---- blockText and countBlocks ---------------------------------------------------------------------------------------------------

test('blockText: the plain text of a block, a table row, a table and a marker; blocks read back from the API work too', () => {
  const [p, h, b, table, callout] = toBlocks(['A **bold** [link](https://x.y) `code`', '## Head', '- Item', '| A | B |', '|---|---|', '| 1 | 2 |', '', 'Callout: Note'].join('\n'));
  assert.equal(blockText(p), 'A bold link code');
  assert.equal(blockText(h), 'Head');
  assert.equal(blockText(b), 'Item');
  assert.equal(blockText(table), 'A | B\n1 | 2');
  assert.equal(blockText(table.table.children[1]), '1 | 2');
  assert.equal(blockText(callout), 'Note');
  assert.equal(blockText(block('divider', {})), '');
  assert.equal(blockText({ marker: 'view', name: 'Your queue' }), '{{view:Your queue}}');
  assert.equal(blockText({ marker: 'tables' }), '{{tables}}');
  assert.equal(blockText(null), '');
  assert.equal(blockText({}), '');
  // what the API sends back: plain_text on each rich-text item, and no children on a table
  const read = { object: 'block', id: 'b1', type: 'paragraph', has_children: false, paragraph: { rich_text: [{ type: 'text', text: { content: 'ignored' }, plain_text: 'Read back', annotations: {} }] } };
  assert.equal(blockText(read), 'Read back');
  assert.equal(blockText({ type: 'table', table: { table_width: 2 } }), '');
  assert.equal(blockText({ type: 'child_database', child_database: { title: 'Rulebook' } }), 'Rulebook');
});

test('blockText: a toggle gives its own title only', () => {
  const [toggle] = toBlocks('## Help\n\ninside');
  assert.equal(blockText(toggle), 'Help');
  assert.equal(blockText(toggle.toggle.children[0]), 'inside');
});

test('countBlocks: counts by type, nested children and markers included', () => {
  const blocks = toBlocks(['# T', '', 'p', '', '| A |', '|---|', '| 1 |', '', '{{tables}}', '', '- a', '- b', '', '## Help', '', 'x', '', '| H |', '|---|', '| 1 |', '| 2 |'].join('\n'));
  assert.deepEqual(countBlocks(blocks), {
    heading_1: 1, paragraph: 2, table: 2, table_row: 5, 'marker:tables': 1, bulleted_list_item: 2, toggle: 1,
  });
  assert.deepEqual(countBlocks([]), {});
  assert.deepEqual(countBlocks(undefined), {});
  assert.deepEqual(countBlocks([{ marker: 'view', name: 'V' }, { marker: 'view', name: 'W' }]), { 'marker:view': 2 });
});

// ---- the compliant page, converted -----------------------------------------------------------------------------------------------

test('the compliant page converts: the callout first, seven step headings, two views, the tables marker, the Help toggle last', () => {
  const blocks = toBlocks(OK, { values: VALUES });
  assert.equal(blocks[0].type, 'callout');
  assert.equal(blockText(blocks[0]).split('\n')[0], CALLOUT);
  const counts = countBlocks(blocks);
  assert.equal(counts.heading_2, 8, 'seven steps and "The tables"');
  assert.deepEqual(blocks.filter((b) => b.marker), [
    { marker: 'view', name: 'Your queue' },
    { marker: 'view', name: 'Lessons waiting' },
    { marker: 'tables' },
  ]);
  assert.equal(blocks.at(-1).type, 'toggle');
  const help = blocks.at(-1).toggle.children;
  assert.equal(help.filter((b) => b.type === 'bulleted_list_item').length, 13, 'ten words and three lines of "If something stops"');
  const why = help.find((b) => b.type === 'table');
  assert.equal(why.table.table_width, 2);
  assert.equal(why.table.children.length, 5, 'a header and four values');
  assert.doesNotMatch(JSON.stringify(blocks), /\{\{/, 'every text placeholder was filled');
  assert.match(JSON.stringify(blocks), /Promote \u00b7 15 Oct \u00b7 PASS/);
  assert.throws(() => toBlocks(OK, { values: { edition: 'E' } }), /unknown placeholder \{\{next_edition\}\}/);
  assert.equal(splitAtMarkers(blocks).length, 4);
});

test('the compliant page: the blocks are accepted by the fake Notion and read back with the same text', async () => {
  const fake = createFakeNotion();
  const page = fake.addPage({ title: 'Practice page' });
  const client = createClient({ token: fake.token, fetchImpl: fake.fetchImpl, requestsPerSecond: 1000 });
  const planned = splitAtMarkers(toBlocks(OK, { values: VALUES })).flatMap((segment) => segment.blocks);
  const toggle = planned.at(-1);
  // The fake takes one level of nesting in a request (the REST API takes two), so the toggle goes in first and its children after.
  const { children, ...shell } = toggle.toggle;
  const made = await client.appendBlocks(page, [...planned.slice(0, -1), { ...toggle, toggle: shell }]);
  assert.equal(made.length, planned.length);
  await client.appendBlocks(made.at(-1).id, children);

  const stored = fake.children(page);
  assert.deepEqual(stored.map((b) => b.type), planned.map((b) => b.type));
  planned.forEach((want, i) => {
    if (want.type === 'table') {
      assert.deepEqual(fake.children(stored[i].id).map(blockText), want.table.children.map(blockText), `table ${i}`);
    } else assert.equal(blockText(stored[i]), blockText(want), `block ${i}`);
  });
  const storedHelp = fake.children(stored.at(-1).id);
  assert.deepEqual(storedHelp.map((b) => b.type), children.map((b) => b.type));
  assert.deepEqual(fake.children(storedHelp.find((b) => b.type === 'table').id).map(blockText), children.find((b) => b.type === 'table').table.children.map(blockText));
  assert.deepEqual(countBlocks(stored).callout, 1);
  assert.equal(stored[0].callout.icon.emoji, MEMO);
});

// ---- the lint: the compliant page and its variants ------------------------------------------------------------------------------

test('lintPage: the compliant page passes, with and without a manifest, as a template and as a preview', () => {
  assert.deepEqual(lintPage(OK), { ok: true, problems: [] });
  assert.deepEqual(lintPage(OK, { manifest: MANIFEST }), { ok: true, problems: [] });
  assert.deepEqual(lintPage(renderPreview(OK, VALUES), { manifest: MANIFEST }), { ok: true, problems: [] });
  assert.deepEqual(lintPage(OK.replace(/\n/g, '\r\n'), { manifest: MANIFEST }), { ok: true, problems: [] }, 'Windows line breaks');
  assert.deepEqual(lintPage(OK, null), { ok: true, problems: [] });
});

test('lintPage: the four sub-headings may be bold paragraphs, and a {{help}} line before the Help section is fine', () => {
  let page = OK;
  for (const label of ['Goal of the step.', 'Existing status.', 'Doing the work.', 'Explaining the outputs']) page = page.split(`- **${label}`).join(`**${label}`);
  assert.doesNotMatch(page, /^- \*\*(?:Goal|Existing|Doing|Explaining)/m);
  assert.deepEqual(lintPage(page, { manifest: MANIFEST }), { ok: true, problems: [] });
  const withHelp = swap(OK, '{{tables}}\n\n## Help', '{{tables}}\n\n{{help}}\n\n## Help');
  assert.deepEqual(lintPage(withHelp, { manifest: MANIFEST }), { ok: true, problems: [] });
  const blocks = toBlocks(withHelp, { values: VALUES });
  assert.deepEqual(splitAtMarkers(blocks).slice(-3).map((s) => s.marker && s.marker.marker), ['tables', 'help', null]);
  assert.equal(blocks.at(-1).type, 'toggle');
});

test('lintPage: nothing at all, or a missing argument, is a list of problems and never a throw', () => {
  for (const input of ['', undefined, null, 'Just a sentence.']) {
    const result = lintPage(input);
    assert.equal(result.ok, false);
    for (const letter of ['a', 'f', 'g', 'j', 'm']) assert.ok(result.problems.some((p) => p.rule === letter), `rule ${letter} for ${JSON.stringify(input)}`);
  }
});

test('lintPage: each problem has a rule letter of LINT_RULES, a positive whole line and a sentence; problems come sorted by line', () => {
  const messy = withSafe('leave these, about two minutes, R12 and a gate.');
  const result = lintPage(swap(messy, 'Check that the demo is ready', 'Check that the demo is ready (D7)'), { manifest: MANIFEST });
  assert.ok(result.problems.length >= 5);
  for (const p of result.problems) {
    assert.ok(Object.hasOwn(LINT_RULES, p.rule), p.rule);
    assert.ok(Number.isInteger(p.line) && p.line >= 1);
    assert.equal(typeof p.detail, 'string');
    assert.ok(p.detail.length > 5);
    assert.deepEqual(Object.keys(p).sort(), ['detail', 'line', 'rule']);
  }
  const lines = result.problems.map((p) => p.line);
  assert.deepEqual(lines, [...lines].sort((x, y) => x - y));
});

test('lintPage: a rule reports every violation it finds, one problem each with its own line', () => {
  let page = swap(OK, SAFE, 'see what waits for whom, about two minutes and 3 days.');
  page = swap(page, 'It is a short wait; Notion changes only at the end.', 'It takes a few hours.');
  const result = lintPage(page);
  assert.deepEqual(summary(result), [`d@${lineNo(page, 'about two minutes')}`, `d@${lineNo(page, 'about two minutes')}`, `d@${lineNo(page, 'a few hours')}`]);
  assert.match(result.problems[0].detail, /about two minutes/);
  assert.match(result.problems[1].detail, /3 days/);
  assert.match(result.problems[2].detail, /few hours/);
  // the same violation twice on one line is two problems
  const twice = swap(OK, SAFE, 'see what waits for whom, 3 days and 3 days.');
  assert.deepEqual(summary(lint(twice)), [`d@${lineNo(twice, '3 days and 3 days')}`, `d@${lineNo(twice, '3 days and 3 days')}`]);
});

test('lintPage: the real walkthrough page passes its own lint with the real manifest (skipped until the files exist)', { skip: !existsSync(PAGE_FILE) || !existsSync(MANIFEST_FILE) }, () => {
  const page = readFileSync(PAGE_FILE, 'utf8');
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
  const result = lintPage(page, { manifest });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(lintPage(renderPreview(page, VALUES), { manifest }).problems, []);
  const blocks = toBlocks(page, { values: VALUES });
  assert.equal(blocks.at(-1).type, 'toggle');
  assert.equal(countBlocks(blocks)['marker:view'], 2);
});

// ---- the lint: one test per rule on mutated copies of the compliant page --------------------------------------------------------

test('rule a (steps): Step 1 to Step 7 in order, each with the four sub-headings in order', () => {
  // a sub-heading missing
  let page = swap(OK, '- **Existing status.** The draft from step 4 is Proposed.\n', '');
  assert.deepEqual(summary(lint(page)), [`a@${lineNo(page, '## Step 5')}`]);
  assert.match(lint(page).problems[0].detail, /Step 5 has no \*\*Existing status\.\*\* line/);
  // every sub-heading, in turn, including the long one whose text may continue
  const [stepFour, stepFive] = [lineNo(OK, '## Step 4'), lineNo(OK, '## Step 5')];
  for (const label of ['Goal of the step.', 'Existing status.', 'Doing the work.', 'Explaining the outputs.']) {
    const mutated = OK.split('\n').filter((line, i) => !(line.startsWith(`- **${label}`) && i + 1 > stepFour && i + 1 < stepFive)).join('\n');
    assert.notEqual(mutated, OK, label);
    assert.deepEqual(summary(lint(mutated)), [`a@${lineNo(mutated, '## Step 4')}`], label);
  }
  // two steps, two problems
  page = swap(OK, '- **Existing status.** The draft from step 4 is Proposed.\n', '');
  page = swap(page, '- **Goal of the step.** Turn your two notes into one proposed rewording of rule 4.\n', '');
  assert.deepEqual(summary(lint(page)), [`a@${lineNo(page, '## Step 4')}`, `a@${lineNo(page, '## Step 5')}`]);
  // out of order
  page = swap(OK, '- **Goal of the step.** The agent reads the 7 claims against the rulebook and fills its side of your 2 rows.\n- **Existing status.** Your 2 rows have no Agent proposal yet; Agent tags is empty on all 7 claims (step 1).\n',
    '- **Existing status.** Your 2 rows have no Agent proposal yet; Agent tags is empty on all 7 claims (step 1).\n- **Goal of the step.** The agent reads the 7 claims against the rulebook and fills its side of your 2 rows.\n');
  assert.deepEqual(summary(lint(page)), [`a@${lineNo(page, '**Existing status.** Your 2 rows have no Agent proposal')}`]);
  assert.match(lint(page).problems[0].detail, /out of order/);
  // the same sub-heading twice
  page = swap(OK, '- **Doing the work.** Type `/claim-tagger demo distill`. It is a short wait.\n', '- **Doing the work.** Type `/claim-tagger demo distill`. It is a short wait.\n- **Doing the work.** Again.\n');
  assert.deepEqual(summary(lint(page)), [`a@${lineNo(page, 'Again.')}`]);
  assert.match(lint(page).problems[0].detail, /more than once in Step 4/);
  // a sub-heading in the wrong step does not count for this one: Step 7 loses its Goal line to Step 6
  page = swap(OK, '- **Goal of the step.** Confirm that the agent now agrees with your two decisions.\n', '');
  assert.deepEqual(summary(lint(page)), [`a@${lineNo(page, '## Step 7')}`]);
});

test('rule a (steps): the headings read "## Step N · title", run 1 to 7, and are level 2', () => {
  let page = swap(OK, '## Step 5 \u00b7 Approve the draft (you, as the rule owner)', '## Step 5 - Approve the draft (you, as the rule owner)');
  assert.deepEqual(summary(lint(page)), [`a@${lineNo(page, '## Step 5')}`]);
  assert.match(lint(page).problems[0].detail, /should read "Step 5 \u00b7 <title>"/);
  page = swap(OK, '## Step 7 \u00b7 The agent re-checks your rows', '## Step 8 \u00b7 The agent re-checks your rows');
  assert.deepEqual(summary(lint(page)), [`a@${lineNo(page, '## Step 8')}`]);
  assert.match(lint(page).problems[0].detail, /expected the heading "Step 7" here, found "Step 8"/);
  // a number used twice: two problems (the repeat, and the one that now comes a step late)
  page = swap(OK, '## Step 4 \u00b7 The agent drafts a clearer rule 4', '## Step 3 \u00b7 The agent drafts a clearer rule 4');
  assert.deepEqual(summary(lint(page)), [`a@${lineNo(page, '## Step 3', 2)}`, `a@${lineNo(page, '## Step 5')}`]);
  // a heading of the wrong level is reported and does not count as a step
  page = swap(OK, '## Step 2 \u00b7 The agent reads the claims', '### Step 2 \u00b7 The agent reads the claims');
  assert.ok(lint(page).problems.some((p) => p.rule === 'a' && /level-2 heading/.test(p.detail) && p.line === lineNo(page, '### Step 2')));
  // steps missing at the end
  const short = lint(['## Step 1 \u00b7 One', '', '## Step 2 \u00b7 Two'].join('\n'));
  assert.ok(short.problems.some((p) => p.rule === 'a' && /Step 3 to Step 7 are missing/.test(p.detail)));
  assert.ok(lint(`${OK.slice(0, OK.indexOf('## Step 7'))}\n`).problems.some((p) => p.rule === 'a' && p.detail === 'Step 7 is missing'));
  assert.ok(lint('nothing here').problems.some((p) => p.rule === 'a' && /no "## Step 1/.test(p.detail)));
});

test('rule b (tables): at most 4 columns, no cell over 100 characters, a separator row, balanced rows', () => {
  const table = '| What | Now |\n|---|---|\n| Rulebook | edition {{edition}}, 1 tag |\n| Waiting for you | 2 rows in Your queue |\n| Rule changes | none |\n| Paused | no |';
  const five = '| What | Now | A | B | C |\n|---|---|---|---|---|\n| Rulebook | one | a | b | c |\n| Waiting | two | a | b | c |\n| Changes | none | a | b | c |\n| Paused | no | a | b | c |';
  let page = swap(OK, table, five);
  assert.deepEqual(summary(lint(page)), [`b@${lineNo(page, '| What | Now | A | B | C |')}`]);
  assert.match(lint(page).problems[0].detail, /5 columns; at most 4/);
  assert.deepEqual(lint(OK).problems, [], 'four columns are fine');

  const cell = (n) => 'x'.repeat(n);
  page = swap(OK, '| Rule changes | none |', `| Rule changes | ${cell(101)} |`);
  assert.deepEqual(summary(lint(page)), [`b@${lineNo(page, '| Rule changes |')}`]);
  assert.match(lint(page).problems[0].detail, /101 characters; at most 100/);
  assert.deepEqual(lint(swap(OK, '| Rule changes | none |', `| Rule changes | ${cell(100)} |`)).problems, [], '100 characters pass');
  assert.deepEqual(lint(swap(OK, '| Rule changes | none |', `| Rule changes | ${'\u{1F600}'.repeat(100)} |`)).problems, [], 'characters are counted, not UTF-16 units');
  // two long cells in one row, and one in a header: every one is reported
  page = swap(OK, '| Rule changes | none |', `| ${cell(150)} | ${cell(120)} |`);
  assert.deepEqual(summary(lint(page)), [`b@${lineNo(page, 'xxxxxxxxxx')}`, `b@${lineNo(page, 'xxxxxxxxxx')}`]);
  page = swap(OK, '| What | Now |', `| What | ${cell(101)} |`);
  assert.deepEqual(summary(lint(page)), [`b@${lineNo(page, '| What |')}`]);

  // an unbalanced row
  page = swap(OK, '| Paused | no |', '| Paused |');
  assert.deepEqual(summary(lint(page)), [`b@${lineNo(page, '| Paused |')}`]);
  assert.match(lint(page).problems[0].detail, /1 cells but the header has 2/);
  // no separator row
  page = swap(OK, `${table.split('\n')[0]}\n|---|---|\n`, `${table.split('\n')[0]}\n`);
  assert.deepEqual(summary(lint(page)), [`b@${lineNo(page, '| What | Now |')}`]);
  assert.match(lint(page).problems[0].detail, /separator row/);
  // a separator row of another width
  page = swap(OK, `${table.split('\n')[0]}\n|---|---|\n`, `${table.split('\n')[0]}\n|---|---|---|\n`);
  assert.deepEqual(summary(lint(page)), [`b@${lineNo(page, '| What | Now |') + 1}`], 'the separator row is the line under the header');
  assert.match(lint(page).problems[0].detail, /separator row has 3 cells but the header has 2/);
  // a pipe inside a cell, escaped, is one cell
  assert.deepEqual(lint(swap(OK, '| Rule changes | none |', '| Rule changes | a \\| b |')).problems, []);
});

test('rule c (words): no banned phrase', () => {
  for (const phrase of ['leave these', 'leave them', 'undecided', 'may differ', 'most likely', 'column guide', 'copy this', 'you can ignore', 'note its']) {
    const page = withSafe(`${phrase} alone.`);
    assert.deepEqual(summary(lint(page)), [`c@${lineNo(page, phrase)}`], phrase);
    assert.match(lint(page).problems[0].detail, new RegExp(`banned phrase "${phrase}"`), phrase);
  }
  const loud = withSafe('Leave These alone.');
  assert.deepEqual(summary(lint(loud)), [`c@${lineNo(loud, 'Leave These')}`], 'any case');
  // whole phrases only: "denote its" is not "note its"
  assert.deepEqual(lint(withSafe('we denote its meaning.')).problems, []);
  // quoted text is not exempt from the word rules
  const quoted = withSafe('a claim says "leave these" here.');
  assert.deepEqual(summary(lint(quoted)), [`c@${lineNo(quoted, 'leave these')}`]);
});

test('rule c (words): no engineering word, as a whole word in any case', () => {
  for (const word of ['gate', 'rubric', 'canary', 'canaries', 'regression', 'database', 'databases', 'subagent', 'API', 'mirror', 'sandbox']) {
    const page = withSafe(`the ${word} is closed.`);
    assert.deepEqual(summary(lint(page)), [`c@${lineNo(page, `the ${word} is closed`)}`], word);
    assert.match(lint(page).problems[0].detail, new RegExp(`engineering word "${word}"`), word);
  }
  for (const word of ['Gate', 'RUBRIC', 'Api', 'Databases', 'gates', 'mirrors', 'sandboxes']) {
    const page = withSafe(`the ${word} is closed.`);
    assert.deepEqual(summary(lint(page)), [`c@${lineNo(page, `the ${word} is closed`)}`], word);
  }
  // two on one line are two problems
  const two = withSafe('the gate and the database.');
  assert.deepEqual(summary(lint(two)), [`c@${lineNo(two, 'the gate and')}`, `c@${lineNo(two, 'the gate and')}`]);
  // other words that only contain one
  const fine = withSafe('the gateway investigates a mirrored apiary in a sandboxed way, with no regressive tests.');
  assert.deepEqual(lint(fine).problems, []);
});

test('rule c (words): none of the retired names, and no cell that starts like the old Agent notes', () => {
  const column = swap(OK, '| Lesson | Status | Safety check result |', '| Lesson | Status | Gate result |');
  assert.deepEqual(summary(lint(column)), [`c@${lineNo(column, 'Gate result')}`], 'one problem, not also the word "gate"');
  assert.match(lint(column).problems[0].detail, /retired name "Gate result".*Safety check result/);
  const rubric = swap(OK, '| Name | Rulebook edition | Last run summary |', '| Name | Rubric in force | Last run summary |');
  assert.deepEqual(summary(lint(rubric)), [`c@${lineNo(rubric, 'Rubric in force')}`]);
  assert.match(lint(rubric).problems[0].detail, /Rulebook edition/);
  // the old view names are retired names (c) and retired view names (l)
  for (const [name, use] of [['Decide these rows', 'Your queue'], ['Approve this change', 'Lessons waiting']]) {
    const page = withSafe(`use ${name} now.`);
    const at = lineNo(page, name);
    assert.deepEqual(summary(lint(page)), [`c@${at}`, `l@${at}`], name);
    assert.ok(lint(page).problems.every((p) => p.detail.includes(use)), name);
  }
  // the readiness prefixes at the start of a cell
  for (const prefix of ['Ready \u00b7 ', 'Ready: ', 'Fix needed \u00b7 ', 'Fix needed: ']) {
    const page = swap(OK, '| (empty) | no tags / 1 waits for an editor', `| (empty) | ${prefix}no tags / 1 waits for an editor`);
    assert.deepEqual(summary(lint(page)), [`c@${lineNo(page, prefix)}`], prefix);
    assert.match(lint(page).problems[0].detail, /a cell starts with/, prefix);
  }
  // only at the start of a cell
  assert.deepEqual(lint(swap(OK, '| (empty) | no tags / 1 waits', '| (empty) | no tags / ready and waits')).problems, []);
  assert.deepEqual(lint(withSafe('Ready to start, and a fix needed later.')).problems, [], 'not in a cell');
  assert.deepEqual(lint(swap(OK, '| (empty) | no tags / 1 waits', '| (empty) | Already no tags / 1 waits')).problems, []);
  // a cell that merely holds the word "Ready" later on is fine; one that starts with it is not
  assert.deepEqual(summary(lint(swap(OK, '| Paused | no |', '| Ready | no |'))), [`c@${lineNo(OK, '| Paused | no |')}`]);
});

test('rule d (time estimates): no number, a, an, one, two, few ... before a unit of time, and no "about" one', () => {
  for (const text of ['about two minutes', '3 days', 'a few hours', 'one week', '10 seconds', 'about an hour', 'a 30-minute review', '2 weeks', 'an hour',
    'several days', '1.5 hours', 'twelve weeks', 'a day', 'About 5 minutes', 'two-week', 'about a week']) {
    const page = withSafe(`it takes ${text}.`);
    assert.deepEqual(summary(lint(page)), [`d@${lineNo(page, `it takes ${text}`)}`], text);
  }
  for (const text of ['20 mins', '5 min', '2 hrs', '30 secs', '3 wks']) {
    const page = withSafe(`it takes ${text}.`);
    assert.deepEqual(summary(lint(page)), [`d@${lineNo(page, `it takes ${text}`)}`], text);
  }
  // not time estimates
  for (const text of ['a short wait', 'the longest wait of the seven steps', 'a second editor joins', 'the second table', 'one sentence and two rows',
    'Promote \u00b7 15 Oct 11:20 \u00b7 PASS', 'once with each version', 'a weekly review', 'every day counts as today', 'someone days later', 'step 2 of 7']) {
    assert.deepEqual(lint(withSafe(`${text}.`)).problems, [], text);
  }
  assert.deepEqual(lint(OK).problems, [], 'the page says "a second editor joins" and is clean');
  const page = withSafe('it takes about two minutes.');
  assert.match(lint(page).problems[0].detail, /time estimate "about two minutes"/);
});

test('rule e (shorthand codes): no D7, R12, C20 style code, no ED-4, no "answer 4", no G1 or G2', () => {
  for (const code of ['D7', 'R12', 'C20', 'H5', 'O1', 'P3', 'ED-4', 'ED12', 'answer 4', 'Answer 5', 'answers 4', 'G1', 'G2']) {
    const page = withSafe(`(see ${code}).`);
    assert.deepEqual(summary(lint(page)), [`e@${lineNo(page, `(see ${code})`)}`], code);
    assert.match(lint(page).problems[0].detail, /shorthand code/, code);
  }
  // not codes: G20 and G3, a code inside a longer word, step and rule numbers
  for (const text of ['G20', 'G3', 'R2D2', 'H2O', 'CO2', 'D-Day', 'rule 4', 'step 7', 'edition 2026-10-15.1', 'the 5 earlier decisions', 'F7']) {
    assert.deepEqual(lint(withSafe(`(${text}).`)).problems, [], text);
  }
  // two on one line
  const two = withSafe('(R12 and C20).');
  assert.deepEqual(summary(lint(two)), [`e@${lineNo(two, 'R12 and C20')}`, `e@${lineNo(two, 'R12 and C20')}`]);
});

test('rules d and e: text inside double quotes is exempt, because a claim may say "G20" or "two weeks"', () => {
  const claim = 'The G20 summit is two weeks away and C20 is a code';
  for (const [open, close] of [['"', '"'], ['\u201c', '\u201d']]) {
    const page = withSafe(`one claim reads ${open}${claim}${close} and that is all.`);
    assert.deepEqual(lintPage(page), { ok: true, problems: [] }, `${open}...${close}`);
  }
  // the same words outside quotes are checked (G20 on its own is not a code)
  const bare = withSafe(`one claim reads ${claim} and that is all.`);
  assert.deepEqual(summary(lint(bare)), [`d@${lineNo(bare, 'one claim reads')}`, `e@${lineNo(bare, 'one claim reads')}`]);
  // only the quoted span is exempt: the rest of the line is still checked
  const mixed = withSafe('"two weeks" is a claim, but it takes 3 days.');
  assert.deepEqual(summary(lint(mixed)), [`d@${lineNo(mixed, 'is a claim')}`]);
  assert.match(lint(mixed).problems[0].detail, /3 days/);
  // quotes in a table cell, as the page uses them
  assert.deepEqual(lint(swap(OK, '| Rule changes | none |', '| Rule changes | "G20 in two weeks" |')).problems, []);
  // a lone quote does not open an exemption that runs to the end of the line
  const lone = withSafe('a " lone quote and 3 days.');
  assert.deepEqual(summary(lint(lone)), [`d@${lineNo(lone, 'lone quote')}`]);
});

test('rule f (callout): the first line is exactly the sentence about who types the four commands', () => {
  const line = `Callout: ${CALLOUT}`;
  assert.ok(OK.startsWith(line));
  let page = swap(OK, 'You type four commands', 'You type five commands');
  assert.deepEqual(summary(lint(page)), ['f@1']);
  assert.match(lint(page).problems[0].detail, /exactly: You type four commands yourself/);
  // text added to the same line, or a changed word
  page = swap(OK, 'fixes what breaks.\n', 'fixes what breaks. More.\n');
  assert.deepEqual(summary(lint(page)), ['f@1']);
  page = swap(OK, 'and the engineer sets things up', 'and the engineers set things up');
  assert.deepEqual(summary(lint(page)), ['f@1']);
  // no callout line
  page = swap(OK, `${line}\n`, '');
  assert.deepEqual(summary(lint(page)), ['f@1']);
  assert.match(lint(page).problems[0].detail, /no callout/);
  // the lines under the first stay inside the callout and are free text; the callout may be further down the page
  assert.deepEqual(lint(swap(OK, 'A practice copy of the editor feedback loop', 'Another introduction')).problems, []);
  const moved = swap(OK, `${line}\n`, '');
  assert.deepEqual(summary(lint(`# Practice\n\n${line}\n${moved}`)), [], 'a title above the callout is allowed');
  assert.deepEqual(lint(swap(OK, line, `${line}   `)).problems, [], 'trailing spaces do not matter');
});

test('rule g (story line): a line before Step 1 says the two rows were picked for the demo', () => {
  const story = 'These two were picked for the demo; for real, a row appears only when the agent is unsure.\n\n';
  let page = swap(OK, story, '');
  assert.deepEqual(summary(lint(page)), [`g@${lineNo(page, '## Step 1')}`], 'Step 2 says it too, but that is not under the story');
  assert.match(lint(page).problems[0].detail, /picked for the demo/);
  page = swap(OK, 'These two were picked for the demo;', 'These two were Picked For The Demo;');
  assert.deepEqual(lint(page).problems, [], 'any case');
  page = swap(OK, 'These two were picked for the demo;', 'These two were chosen;');
  assert.deepEqual(summary(lint(page)), [`g@${lineNo(page, '## Step 1')}`]);
});

test('rule h (edition line): Step 1 explains an edition as a date plus a count', () => {
  let page = swap(OK, ' (an edition is a date plus a count; it goes up when a rule changes)', '');
  assert.deepEqual(summary(lint(page)), [`h@${lineNo(page, '## Step 1')}`]);
  assert.match(lint(page).problems[0].detail, /an edition is a date plus a count/);
  // the words list says it too, but only Step 1 counts
  assert.match(OK, /a date plus a count \(\{\{edition\}\}\)/);
  // the line in another step does not help
  page = swap(page, 'The agent agrees with the earlier decisions.', 'The agent agrees with the earlier decisions (an edition is a date plus a count).');
  assert.deepEqual(summary(lint(page)), [`h@${lineNo(page, '## Step 1')}`]);
  assert.deepEqual(lint(swap(OK, 'an edition is a date', 'An Edition is a date')).problems, []);
});

test('rule i (closing lines): Step 7 ends with the three "adds later" lines and the Archive line', () => {
  const label = 'What the full version adds later:\n';
  const third = '- Each editor gets a queue of their own if a second editor joins.\n';
  const archive = 'Archive this page by hand when you no longer need it.\n';
  let page = swap(OK, third, '');
  assert.deepEqual(summary(lint(page)), [`i@${lineNo(page, 'What the full version adds later')}`]);
  assert.match(lint(page).problems[0].detail, /has 2 bullet lines; it needs exactly three/);
  page = swap(OK, third, `${third}- A fourth thing.\n`);
  assert.deepEqual(summary(lint(page)), [`i@${lineNo(page, 'What the full version adds later')}`]);
  assert.match(lint(page).problems[0].detail, /has 4 bullet lines/);
  page = swap(OK, `${archive}\n`, '');
  assert.deepEqual(summary(lint(page)), [`i@${lineNo(page, '## Step 7')}`]);
  assert.match(lint(page).problems[0].detail, /no "Archive this page by hand" line/);
  page = swap(OK, label, '');
  assert.deepEqual(summary(lint(page)), [`i@${lineNo(page, '## Step 7')}`]);
  assert.match(lint(page).problems[0].detail, /no "What the full version adds later" line/);
  // text after the Archive line
  page = swap(OK, archive, `${archive}\nThanks for reading.\n`);
  assert.deepEqual(summary(lint(page)), [`i@${lineNo(page, 'Thanks for reading')}`]);
  assert.match(lint(page).problems[0].detail, /has to end with the "Archive this page by hand" line/);
  // the label as a bold line is fine, as on the real page
  assert.deepEqual(lint(swap(OK, label, '**What the full version adds later:**\n')).problems, []);
  // both missing: two problems
  page = swap(swap(OK, label, ''), `${archive}\n`, '');
  assert.deepEqual(summary(lint(page)), [`i@${lineNo(page, '## Step 7')}`, `i@${lineNo(page, '## Step 7')}`]);
});

test('rule j (help): the Agent reading table has two columns and four values; the words list ten lines; "If something stops" three', () => {
  const header = '| Agent reading | What it makes happen |';
  const lastRow = '| (nothing to read) | You agreed with the agent: no rule change; the claim counts as an earlier decision. |\n';
  // the table
  let page = swap(OK, lastRow, '');
  assert.deepEqual(summary(lint(page)), [`j@${lineNo(page, header)}`]);
  assert.match(lint(page).problems[0].detail, /Agent reading table has 3 value rows; it has exactly four/);
  page = swap(OK, lastRow, `${lastRow}| Another | One more. |\n`);
  assert.deepEqual(summary(lint(page)), [`j@${lineNo(page, header)}`]);
  assert.match(lint(page).problems[0].detail, /5 value rows/);
  page = swap(OK, '| Agent slip |', '| Agent mistake |');
  assert.deepEqual(summary(lint(page)), [`j@${lineNo(page, '| Agent mistake |')}`]);
  assert.match(lint(page).problems[0].detail, /row 1 of the Agent reading table should be "Agent slip"/);
  page = swap(OK, '| (nothing to read) | You agreed', '| Nothing | You agreed');
  assert.deepEqual(summary(lint(page)), [`j@${lineNo(page, '| Nothing |')}`]);
  assert.match(lint(page).problems[0].detail, /row 4 .* "\(nothing to read\)"/);
  page = swap(OK, '| (nothing to read) | You agreed', '| (empty) | You agreed');
  assert.match(lint(page).problems[0].detail, /row 4 .* "\(nothing to read\)"/, 'the old fourth value, (empty), is not the agreeing decision');
  page = swap(OK, `${header}\n|---|---|`, '| Agent reading | What it makes happen | More |\n|---|---|---|')
    .replace(/^(\| (?:Agent slip|Rule unclear|Rule should change|\(nothing to read\)) \|.*) \|$/gm, '$1 | x |');
  assert.deepEqual(summary(lint(page)), [`j@${lineNo(page, '| Agent reading | What it makes happen | More |')}`]);
  assert.match(lint(page).problems[0].detail, /3 columns; it has exactly two/);
  page = swap(OK, header, '| Reason | What it makes happen |');
  assert.deepEqual(summary(lint(page)), [`j@${lineNo(page, '## Help')}`]);
  assert.match(lint(page).problems[0].detail, /no "Agent reading" table/);
  // a table called Why wrong, the old title, is no longer the one the lint looks for
  page = swap(OK, header, '| Why wrong | What it makes happen |');
  assert.match(lint(page).problems[0].detail, /no "Agent reading" table/);

  // the words list
  const word = '- **Claim**: one short statement in Geo.\n';
  page = swap(OK, word, '');
  assert.deepEqual(summary(lint(page)), [`j@${lineNo(page, 'Words used on this page')}`]);
  assert.match(lint(page).problems[0].detail, /words list has 9 lines; it has exactly 10/);
  page = swap(OK, word, `${word}- **Extra**: one too many.\n`);
  assert.deepEqual(summary(lint(page)), [`j@${lineNo(page, 'Words used on this page')}`]);
  assert.match(lint(page).problems[0].detail, /has 11 lines/);
  // the stop list: the paused line, the allowance line and the line for a rulebook text edited by hand
  const stop = '- Claude says your Claude allowance ran out: wait until your Claude allowance is back, then type the same command again; it continues where it stopped.\n';
  page = swap(OK, stop, '');
  assert.deepEqual(summary(lint(page)), [`j@${lineNo(page, 'If something stops')}`]);
  assert.match(lint(page).problems[0].detail, /"If something stops" list has 2 lines; it has exactly 3/);
  const edited = page.slice(page.indexOf('- Claude says the rulebook text was edited by hand'));
  page = swap(swap(OK, stop, ''), edited, '');
  assert.match(lint(page).problems[0].detail, /"If something stops" list has 1 lines; it has exactly 3/);
  page = swap(OK, stop, `${stop}- A fourth line.\n`);
  assert.deepEqual(summary(lint(page)), [`j@${lineNo(page, 'If something stops')}`]);
  assert.match(lint(page).problems[0].detail, /"If something stops" list has 4 lines; it has exactly 3/);
  // labels missing
  page = swap(OK, '**Words used on this page.**', '**Words.**');
  assert.deepEqual(summary(lint(page)), [`j@${lineNo(page, '## Help')}`]);
  assert.match(lint(page).problems[0].detail, /no "Words used on this page" label/);
  page = swap(OK, '**If something stops.**', '**Problems.**');
  assert.deepEqual(summary(lint(page)), [`j@${lineNo(page, '## Help')}`]);
  // no Help section
  page = swap(OK, '## Help\n\n', '');
  assert.deepEqual(summary(lint(page)), ['j@1']);
  assert.match(lint(page).problems[0].detail, /no "## Help" section/);
  // lists outside the Help section do not count
  page = swap(OK, '## Help\n\n', '## Help\n\n- A stray bullet before the table.\n\n');
  assert.deepEqual(lint(page).problems, []);
});

test('rule k (captions): with a manifest every affected table has a bold caption in its step; **Agent settings** is a caption of Step 6 only', () => {
  const caption = '**Rule changes**\n\n| Lesson | Rule | Status | Supporting rows |';
  let page = swap(OK, caption, '| Lesson | Rule | Status | Supporting rows |');
  assert.deepEqual(summary(lint(page, MANIFEST)), [`k@${lineNo(page, '## Step 4')}`]);
  assert.match(lint(page, MANIFEST).problems[0].detail, /Step 4 affects Rule changes but has no \*\*Rule changes\*\* caption/);
  assert.deepEqual(lint(page).problems, [], 'without a manifest the affected tables are not known');
  // a caption of another table does not do
  page = swap(OK, caption, `**Rulebook**\n\n| Lesson | Rule | Status | Supporting rows |`);
  assert.deepEqual(summary(lint(page, MANIFEST)), [`k@${lineNo(page, '## Step 4')}`]);
  // the caption has to be a line of its own, bold, at the start of the line
  page = swap(OK, '**Tag decisions** (your 2 rows)\n\n| Claim | Tag outcome | Why wrong |', 'Tag decisions (your 2 rows)\n\n| Claim | Tag outcome | Why wrong |');
  assert.deepEqual(summary(lint(page, MANIFEST)), [`k@${lineNo(page, '## Step 3')}`]);
  // Agent settings in Step 6 is required by the manifest
  page = swap(OK, '**Agent settings**\n\n| Name | Rulebook edition', '| Name | Rulebook edition');
  assert.deepEqual(summary(lint(page, MANIFEST)), [`k@${lineNo(page, '## Step 6')}`]);
  assert.deepEqual(lint(page).problems, []);
  // Agent settings captioned in another step: with and without a manifest
  page = swap(OK, '**Tag decisions** (your 2 rows)\n\n| Claim | Tag outcome | Why wrong |', '**Agent settings**\n\n**Tag decisions** (your 2 rows)\n\n| Claim | Tag outcome | Why wrong |');
  for (const manifest of [undefined, MANIFEST]) {
    assert.deepEqual(summary(lint(page, manifest)), [`k@${lineNo(page, '**Agent settings**')}`]);
    assert.match(lint(page, manifest).problems[0].detail, /belongs in Step 6 only, not in Step 3/);
  }
  // the plain words "Agent settings" in Step 1's status line and in the bullet of the list of tables are not captions
  assert.match(OK, /Agent settings: not paused/);
  assert.match(OK, /^- \*\*Agent settings\*\*: one row/m);
  assert.deepEqual(lint(OK, MANIFEST).problems, []);
  // every affected table of every step is checked: three captions removed, three problems
  page = OK.replace(/^\*\*(?:Tag decisions|Claims)\*\*.*\n\n/gm, '');
  assert.deepEqual(summary(lint(page, MANIFEST)), [
    `k@${lineNo(page, '## Step 2')}`, `k@${lineNo(page, '## Step 2')}`, `k@${lineNo(page, '## Step 3')}`, `k@${lineNo(page, '## Step 7')}`, `k@${lineNo(page, '## Step 7')}`,
  ]);
});

test('rule k (captions): a manifest without a steps list is a problem, not a skipped check; steps are matched by their number', () => {
  for (const manifest of [{}, { steps: 'none' }, { calibration: {} }]) {
    assert.deepEqual(summary(lint(OK, manifest)), ['k@1'], JSON.stringify(manifest));
    assert.match(lint(OK, manifest).problems[0].detail, /manifest has no steps list/);
  }
  // no n: the position in the list is the step number
  const bare = { steps: MANIFEST.steps.map(({ affects }) => ({ affects })) };
  assert.deepEqual(lint(OK, bare).problems, []);
  const wrong = { steps: MANIFEST.steps.map(({ n, affects }) => ({ n, affects: n === 3 ? ['Rulebook'] : affects })) };
  assert.deepEqual(summary(lint(OK, wrong)), [`k@${lineNo(OK, '## Step 3')}`]);
  // a step that Step 1 to 7 of the page lack is rule a's business; a step the page cannot have is reported, not skipped
  const noSeven = OK.slice(0, OK.indexOf('## Step 7'));
  assert.ok(lint(noSeven, MANIFEST).problems.every((p) => p.rule !== 'k'), 'the missing Step 7 is a problem of rule a only');
  assert.deepEqual(summary(lint(OK, { steps: [...MANIFEST.steps, { n: 9, affects: ['Claims'] }] })), ['k@1']);
  assert.match(lint(OK, { steps: [{ n: 0, affects: [] }] }).problems[0].detail, /manifest lists a Step 0, but the page has Step 1 to Step 7 only/);
  // junk in affects is ignored
  assert.deepEqual(lint(OK, { steps: [{ n: 1, affects: [null, 3, undefined] }, { n: 2 }] }).problems, []);
});

test('rule l (views): Your queue inside Step 3 and Lessons waiting inside Step 5, or none; only the five view names', () => {
  const queue = '{{view:Your queue}}';
  const waiting = '{{view:Lessons waiting}}';
  assert.deepEqual(lint(swap(swap(OK, `${queue}\n\n`, ''), `${waiting}\n\n`, '')).problems, [], 'no views at all is the no-views fallback');
  // one of the two
  let page = swap(OK, `${waiting}\n\n`, '');
  assert.deepEqual(summary(lint(page)), [`l@${lineNo(page, queue)}`]);
  assert.match(lint(page).problems[0].detail, /\{\{view:Lessons waiting\}\} is missing; the page has both linked views or none/);
  page = swap(OK, `${queue}\n\n`, '');
  assert.deepEqual(summary(lint(page)), [`l@${lineNo(page, waiting)}`]);
  // a third view, or a fourth: the views of the Claims table that are tabs are not placed on the page
  page = swap(OK, '- **Goal of the step.** Turn your two notes', `{{view:Agent disagreed}}\n\n- **Goal of the step.** Turn your two notes`);
  assert.deepEqual(summary(lint(page)), [`l@${lineNo(page, 'Agent disagreed}}')}`]);
  assert.match(lint(page).problems[0].detail, /not placed on the page; only Your queue \(Step 3\) and Lessons waiting \(Step 5\) are/);
  page = swap(OK, '- **Goal of the step.** Turn your two notes', `{{view:Needs your note}}\n\n- **Goal of the step.** Turn your two notes`);
  assert.deepEqual(summary(lint(page)), [`l@${lineNo(page, 'Needs your note}}')}`]);
  assert.match(lint(page).problems[0].detail, /not placed on the page; only Your queue \(Step 3\) and Lessons waiting \(Step 5\) are/);
  page = swap(OK, `${waiting}\n\n`, `${waiting}\n\n${waiting}\n\n`);
  assert.deepEqual(summary(lint(page)), [`l@${lineNo(page, waiting, 2)}`]);
  assert.match(lint(page).problems[0].detail, /appears more than once/);
  // in the wrong step, or outside the steps
  page = swap(swap(OK, `${queue}\n\n`, ''), '- **Goal of the step.** Turn your two notes', `${queue}\n\n- **Goal of the step.** Turn your two notes`);
  assert.deepEqual(summary(lint(page)), [`l@${lineNo(page, queue)}`]);
  assert.match(lint(page).problems[0].detail, /sits in Step 4; it belongs inside Step 3/);
  page = swap(swap(OK, `${waiting}\n\n`, ''), '{{tables}}', `{{tables}}\n\n${waiting}`);
  assert.deepEqual(summary(lint(page)), [`l@${lineNo(page, waiting)}`]);
  assert.match(lint(page).problems[0].detail, /sits outside the steps; it belongs inside Step 5/);
  // a name that is not one of the five (the third is a view of the Claims table since the revision of 16 October), or is written in another case
  page = swap(OK, queue, '{{view:Inbox}}');
  assert.deepEqual(summary(lint(page)), [`l@${lineNo(page, '{{view:Inbox}}')}`, `l@${lineNo(page, '{{view:Inbox}}')}`]);
  assert.match(lint(page).problems[0].detail, /\{\{view:Inbox\}\} is not one of the five view names \(Your queue, Needs your note, Agent disagreed, Lessons waiting, Rulebook\)/);
  assert.match(lint(page).problems[1].detail, /\{\{view:Your queue\}\} is missing/);
  page = swap(OK, queue, '{{view:your queue}}');
  assert.deepEqual(summary(lint(page)), [`l@${lineNo(page, '{{view:your queue}}')}`, `l@${lineNo(page, '{{view:your queue}}')}`]);
});

test('rule l (views): "Decide these rows" and "Approve this change" are retired view names, in a placeholder or in the text', () => {
  const queue = '{{view:Your queue}}';
  let page = swap(OK, queue, '{{view:Decide these rows}}');
  let at = lineNo(page, '{{view:Decide these rows}}');
  assert.deepEqual(summary(lint(page)), [`c@${at}`, `l@${at}`, `l@${at}`]);
  assert.match(lint(page).problems.find((p) => p.rule === 'l').detail, /retired view name; the view is now called Your queue/);
  page = swap(OK, '{{view:Lessons waiting}}', '{{view:Approve this change}}');
  at = lineNo(page, '{{view:Approve this change}}');
  assert.deepEqual(summary(lint(page)), [`l@${lineNo(page, queue)}`, `c@${at}`, `l@${at}`], 'the missing view is reported at the first view line');
  assert.ok(lint(page).problems.some((p) => p.rule === 'l' && /Lessons waiting/.test(p.detail)));
  // in a sentence
  page = withSafe('open Approve this change.');
  at = lineNo(page, 'open Approve this change');
  assert.deepEqual(summary(lint(page)), [`c@${at}`, `l@${at}`]);
  assert.match(lint(page).problems.find((p) => p.rule === 'l').detail, /retired view name "Approve this change"/);
  // the five names in plain text are all fine
  assert.deepEqual(lint(withSafe('Your queue, Needs your note, Agent disagreed, Lessons waiting and Rulebook are the views.')).problems, []);
});

test('rule m (tables placeholder): {{tables}} appears exactly once, after Step 7', () => {
  let page = swap(OK, '{{tables}}\n\n', '');
  assert.deepEqual(summary(lint(page)), [`m@${lineNo(page, '## Step 7')}`]);
  assert.match(lint(page).problems[0].detail, /\{\{tables\}\} is missing; it goes once, after Step 7/);
  page = swap(OK, '{{tables}}\n', '{{tables}}\n\n{{tables}}\n');
  assert.deepEqual(summary(lint(page)), [`m@${lineNo(page, '{{tables}}', 2)}`]);
  assert.match(lint(page).problems[0].detail, /appears more than once/);
  page = swap(OK, '{{tables}}\n\n', '');
  page = swap(page, '## Step 7 \u00b7', `{{tables}}\n\n## Step 7 ${DOT}`);
  assert.deepEqual(summary(lint(page)), [`m@${lineNo(page, '{{tables}}')}`]);
  assert.match(lint(page).problems[0].detail, /comes before Step 7/);
  page = swap(OK, '{{tables}}\n\n', '');
  page = swap(page, '## Help\n\n', '## Help\n\n{{tables}}\n\n');
  assert.deepEqual(summary(lint(page)), [`m@${lineNo(page, '{{tables}}')}`]);
  assert.match(lint(page).problems[0].detail, /sits inside the Help section/);
  // sharing a line with text
  page = swap(OK, '{{tables}}', 'See {{tables}} below.');
  assert.deepEqual(summary(lint(page)), [`m@${lineNo(page, '## Step 7')}`, `m@${lineNo(page, 'See {{tables}}')}`], 'the placeholder is missing, and the text line is wrong');
  // a {{help}} line is not {{tables}}
  assert.deepEqual(lint(swap(OK, '{{tables}}', '{{tables}}\n\n{{help}}')).problems, []);
});
