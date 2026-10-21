import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ALLOWED_SCRIPTS, DEFAULT_EDITOR_COLUMNS, TOKEN_KINDS, checkTranscript, classifyBash, editorColumnsFromConfig, extractFinalText, findJson, loadEditorColumns,
  MAX_CHECKLIST_LINES, main as checkMain, parseStreamJson, splitChecklist,
} from '../../agents/claim-tagger-mvp/scripts/transcript-check.mjs';
import {
  OUTPUT_STYLE, buildArgs, main as headlessMain, mergeSettings, promptDirName, readPrompts, runPrompt, slugify,
} from '../../agents/claim-tagger-mvp/scripts/headless-check.mjs';

// The checker is tested on transcripts written to tests/mvp/fixtures/transcripts/ (shaped like the stdout of
// `claude -p ... --output-format stream-json --verbose`) and on small ones built here. The runner is tested against fake-headless-claude.mjs,
// a stand-in that prints one of those transcripts. The real CLI is never started, and nothing here reads .env.

const FIXTURES = fileURLToPath(new URL('./fixtures/transcripts/', import.meta.url));
const fixturePath = (name) => join(FIXTURES, `${name}.jsonl`);
const fixture = (name) => readFileSync(fixturePath(name), 'utf8');
const FAKE_CLI = join(FIXTURES, 'fake-headless-claude.mjs');
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const CHECK_SCRIPT = join(REPO, 'agents', 'claim-tagger-mvp', 'scripts', 'transcript-check.mjs');
const HEADLESS_SCRIPT = join(REPO, 'agents', 'claim-tagger-mvp', 'scripts', 'headless-check.mjs');

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-transcript-'));
  dirs.push(d);
  return d;
};
const has = (problems, text) => problems.some((p) => p.includes(text));
const cap = () => {
  const out = [];
  const err = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
};

// ---- builders for small transcripts ----------------------------------------------------------------------------------------------

let counter = 0;
const nextId = () => `toolu_${String(++counter).padStart(4, '0')}`;
const ev = {
  init: (style = 'Explanatory', over = {}) => ({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-sonnet-5-5', output_style: style, claude_code_version: '2.1.296', ...over }),
  text: (t, over = {}) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] }, parent_tool_use_id: null, session_id: 's1', ...over }),
  tool: (name, input = {}, id = nextId(), over = {}) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }, parent_tool_use_id: null, session_id: 's1', ...over }),
  result: (t, over = {}) => ({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, result: t, session_id: 's1', ...over }),
};
const jsonl = (events) => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
const bash = (command, id) => ev.tool('Bash', { command }, id);

const GOOD = [
  'Status: nothing is paused; 12 rows wait in Your queue and no rule change waits for approval.',
  '',
  '| Where | Now |',
  '|---|---|',
  '| Rulebook | 13 Issue tags, edition 2026-10-15.1, same as Notion |',
  '| Your queue | 12 rows, lowest confidence first |',
  '| Lessons waiting | none |',
  '',
  'Next: start at the top of Your queue (link).',
].join('\n');
const SENTENCE = GOOD.split('\n')[0];
const NEXT = 'Next: start at the top of Your queue (link).';

/** A whole transcript whose final message is `final`, with `middle` events before it. */
const run = ({ middle = [], final = GOOD, resultOver = {}, init = ev.init() } = {}) => jsonl([init, ...middle, ev.text(final), ev.result(final, resultOver)]);
const grade = (opts, checkOpts) => checkTranscript(run(opts), checkOpts);
const withTable = (rows, header = '| What | Result |') => [SENTENCE, '', header, `|${'---|'.repeat(header.split('|').length - 2)}`, ...rows, '', NEXT].join('\n');

// ---- parseStreamJson ---------------------------------------------------------------------------------------------------------------

test('parseStreamJson skips a stray non-JSON line and counts it', () => {
  const parsed = parseStreamJson(fixture('pass-with-stray-line'));
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.skippedLines.length, 1);
  assert.match(parsed.skippedLines[0].text, /^npm warn/);
  assert.equal(parsed.events.length, 10, 'the ten events of the passing transcript are all there');
  assert.deepEqual(parsed.events.map((e) => e.type), parseStreamJson(fixture('pass-status')).events.map((e) => e.type));
});

test('parseStreamJson ignores blank lines, a BOM and CRLF line ends without counting them', () => {
  const text = `﻿${JSON.stringify({ type: 'system' })}\r\n\r\n   \r\n${JSON.stringify({ type: 'result' })}\r\n`;
  const parsed = parseStreamJson(text);
  assert.equal(parsed.skipped, 0);
  assert.deepEqual(parsed.events.map((e) => e.type), ['system', 'result']);
});

test('parseStreamJson counts JSON that is not an object (a number, an array, null, a string) as skipped', () => {
  const parsed = parseStreamJson(['42', '[1,2]', 'null', '"text"', '{"type":"result"}'].join('\n'));
  assert.equal(parsed.skipped, 4);
  assert.equal(parsed.events.length, 1);
});

test('parseStreamJson of nothing is nothing', () => {
  assert.deepEqual(parseStreamJson(''), { events: [], skipped: 0, skippedLines: [] });
  assert.deepEqual(parseStreamJson(undefined), { events: [], skipped: 0, skippedLines: [] });
});

// ---- extractFinalText ---------------------------------------------------------------------------------------------------------------

test('extractFinalText is the last assistant text before the result', () => {
  const { events } = parseStreamJson(fixture('pass-status'));
  assert.equal(extractFinalText(events), GOOD);
});

test('extractFinalText follows the LAST result when a background task wakes the model again', () => {
  const events = [ev.init(), ev.text('The judge is running in the background.'), ev.result('The judge is running in the background.'), ev.init(), ev.text(GOOD), ev.result(GOOD)];
  assert.equal(extractFinalText(events), GOOD);
});

test('extractFinalText ignores subagent messages and thinking, and takes the last text block of a message', () => {
  const two = { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'first block' }, { type: 'text', text: GOOD }] }, parent_tool_use_id: null };
  const events = [ev.init(), two, ev.text('a subagent talking', { parent_tool_use_id: 'toolu_parent' }), ev.result('ignored')];
  assert.equal(extractFinalText(events), GOOD);
});

test('extractFinalText falls back to the result text, then to an empty string', () => {
  assert.equal(extractFinalText([ev.init(), ev.result(GOOD)]), GOOD);
  assert.equal(extractFinalText([ev.init(), ev.text('   '), ev.result(undefined)]), '');
  assert.equal(extractFinalText([]), '');
  assert.equal(extractFinalText(undefined), '');
});

test('extractFinalText accepts a message whose content is a plain string', () => {
  const events = [{ type: 'assistant', message: { content: GOOD }, parent_tool_use_id: null }, ev.result(GOOD)];
  assert.equal(extractFinalText(events), GOOD);
});

// ---- the passing transcripts ----------------------------------------------------------------------------------------------------------

test('the passing transcript passes, with its final text, tools and statistics', () => {
  const r = checkTranscript(fixture('pass-status'), { expectStyle: 'Explanatory' });
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.equal(r.final, GOOD);
  assert.deepEqual(r.stats, { turns: 4, tool_calls: 3, bash_calls: 2, notion_reads: 0, notion_writes: 0 });
  assert.deepEqual(r.tools, [
    { name: 'Skill', summary: 'claim-tagger status' },
    { name: 'Bash', summary: 'node agents/claim-tagger-mvp/scripts/pull.mjs --all' },
    { name: 'Bash', summary: 'node agents/claim-tagger-mvp/scripts/status.mjs' },
  ]);
  assert.equal(r.info.style, 'Explanatory');
  assert.equal(r.info.model, 'claude-sonnet-5-5');
  assert.equal(r.info.cli_version, '2.1.296');
  assert.equal(r.info.skipped_lines, 0);
});

test('a longer passing run: a progress line, a Notion read, git status and a three-column table are all fine', () => {
  const r = checkTranscript(fixture('pass-demo-tag'), { expectStyle: 'Explanatory' });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.stats, { turns: 9, tool_calls: 7, bash_calls: 5, notion_reads: 1, notion_writes: 0 });
  assert.match(r.final, /^Demo · tag: /);
  assert.ok(r.tools.some((t) => t.name === 'mcp__claude_ai_notion__notion-fetch'));
  assert.ok(r.tools.some((t) => t.summary === 'git status'));
});

test('a stray non-JSON line in a passing transcript is noted, not held against it', () => {
  const r = checkTranscript(fixture('pass-with-stray-line'));
  assert.equal(r.ok, true);
  assert.equal(r.info.skipped_lines, 1);
  assert.ok(r.info.notes.some((n) => n.includes('not JSON')));
});

test('checkTranscript also takes an array of events', () => {
  const { events } = parseStreamJson(fixture('pass-status'));
  assert.equal(checkTranscript(events).ok, true);
});

// ---- one failing transcript per rule ---------------------------------------------------------------------------------------------------

const FAILING = [
  ['fail-insight-final', ['holds an Insight block'], null],
  ['fail-insight-earlier', ['before the final message hold', 'Insight'], 1],
  ['fail-json-final', ['JSON object'], null],
  ['fail-fourth-part', ['more than three parts', 'heading'], 2],
  ['fail-table-6-rows', ['6 body rows'], 1],
  ['fail-connector-write', ['notion-update-page', 'writes to Notion'], 1],
  ['fail-editor-column-bash', ['"Review status"'], 1],
  ['fail-disallowed-script', ['"setup"', 'not in the allowed list'], 1],
  ['fail-git-push', ['"git push"'], 1],
  ['fail-no-next', ['no line starts with "Next:"'], 1],
  ['fail-time-word', ['duration word: "minutes"'], 1],
  ['fail-error-result', ['is_error'], 1],
  ['fail-no-result', ['no result event', 'does not parse'], null],
  ['fail-two-lists', ['after the Next line: more than one part follows the Next line'], 3],
];
for (const [name, expected, count] of FAILING) {
  test(`${name} fails with the problem it was written for`, () => {
    const r = checkTranscript(fixture(name), { expectStyle: 'Explanatory' });
    assert.equal(r.ok, false);
    for (const text of expected) assert.ok(has(r.problems, text), `expected a problem holding "${text}" in:\n${r.problems.join('\n')}`);
    if (count !== null) assert.equal(r.problems.length, count, r.problems.join('\n'));
  });
}

test('a denied connector write is still reported, and marked as denied', () => {
  const r = checkTranscript(fixture('fail-connector-write'));
  assert.ok(has(r.problems, 'denied'));
  assert.deepEqual(r.stats, { turns: 4, tool_calls: 3, bash_calls: 1, notion_reads: 0, notion_writes: 1 });
  assert.equal(r.tools[2].denied, true);
  assert.equal(r.tools[1].denied, undefined);
  assert.equal(r.info.denials.length, 1);
});

// ---- (a) the shape of the final message --------------------------------------------------------------------------------------------------

test('three parts in order pass: sentence, table of up to 5 rows and 3 columns, Next line', () => {
  const rows5 = ['| a | 1 |', '| b | 2 |', '| c | 3 |', '| d | 4 |', '| e | 5 |'];
  assert.deepEqual(grade({ final: withTable(rows5) }).problems, [], '5 body rows is the limit');
  const three = withTable(['| a | 1 | x |', '| b | 2 | y |'], '| What | Result | Note |');
  assert.deepEqual(grade({ final: three }).problems, [], '3 columns is the limit');
  assert.deepEqual(grade({ final: [SENTENCE, '', NEXT].join('\n') }).problems, [], 'no table is fine when there is nothing to count');
  assert.deepEqual(grade({ final: `Demo · ${SENTENCE}\n\n${NEXT}` }).problems, [], 'the Demo prefix is fine');
});

test('blank lines may be doubled, line ends may be CRLF and the message may carry outer whitespace', () => {
  assert.deepEqual(grade({ final: `\n\n${GOOD.replace(/\n\n/g, '\n\n\n')}\n\n` }).problems, []);
  assert.deepEqual(grade({ final: GOOD.replace(/\n/g, '\r\n') }).problems, []);
});

test('a table with 6 body rows or 4 columns is refused', () => {
  const six = withTable(['| a | 1 |', '| b | 2 |', '| c | 3 |', '| d | 4 |', '| e | 5 |', '| f | 6 |']);
  assert.ok(has(grade({ final: six }).problems, '6 body rows; the limit is 5'));
  const four = withTable(['| a | 1 | x | y |'], '| What | Result | Note | More |');
  assert.ok(has(grade({ final: four }).problems, '4 columns; the limit is 3'));
});

test('a table needs a separator row and at least one body row', () => {
  assert.ok(has(grade({ final: [SENTENCE, '', '| a | b |', '| 1 | 2 |', '', NEXT].join('\n') }).problems, 'no header separator row'));
  assert.ok(has(grade({ final: [SENTENCE, '', '| a | b |', '|---|---|', '', NEXT].join('\n') }).problems, 'no rows'));
});

test('an escaped pipe inside a cell is not a column break', () => {
  assert.deepEqual(grade({ final: withTable(['| a \\| b | c |']) }).problems, []);
});

test('the Next line must be its own part, not glued to the table', () => {
  const glued = [SENTENCE, '', '| a | b |', '|---|---|', '| 1 | 2 |', NEXT].join('\n');
  assert.ok(has(grade({ final: glued }).problems, 'glued to the table'));
});

test('a sentence glued to the table above it is refused', () => {
  const glued = [SENTENCE, '| a | b |', '|---|---|', '| 1 | 2 |', '', NEXT].join('\n');
  assert.ok(has(grade({ final: glued }).problems, 'more than one line'));
});

test('anything between the sentence and the Next line that is not a table is a fourth thing', () => {
  assert.ok(has(grade({ final: [SENTENCE, '', '- one', '- two', '', NEXT].join('\n') }).problems, 'not a Markdown table'));
  assert.ok(has(grade({ final: [SENTENCE, '', 'A second paragraph with more to say.', '', NEXT].join('\n') }).problems, 'not a Markdown table'));
  const heading = grade({ final: [SENTENCE, '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '## Notes', '', 'More text.', '', NEXT].join('\n') });
  assert.ok(has(heading.problems, 'more than three parts'));
  assert.ok(has(heading.problems, 'heading'));
});

test('the first line is one sentence, not a list item, a quote or several sentences', () => {
  assert.ok(has(grade({ final: GOOD.replace(SENTENCE, `- ${SENTENCE}`) }).problems, 'not a sentence'));
  assert.ok(has(grade({ final: GOOD.replace(SENTENCE, `> ${SENTENCE}`) }).problems, 'not a sentence'));
  assert.ok(has(grade({ final: GOOD.replace(SENTENCE, 'Status: nothing is paused. 12 rows wait in Your queue.') }).problems, 'more than one sentence'));
  assert.ok(has(grade({ final: GOOD.replace(SENTENCE, 'Done! The rows wait in Your queue.') }).problems, 'more than one sentence'));
});

test('abbreviations, decimals, quoted text and code in the sentence do not make it two sentences', () => {
  for (const sentence of [
    'Status: use e.g. Applies or Does not apply; 12 rows wait in Your queue.',
    'Tag: edition 2026-11-04.2 is live and 12 rows wait.',
    'Tag: the agent read "Is this true? Yes. Maybe." and queued it.',
    'Tag: type `/claim-tagger tag` to continue.',
  ]) assert.deepEqual(grade({ final: GOOD.replace(SENTENCE, sentence) }).problems, [], sentence);
});

test('a missing, repeated or misplaced Next line is refused', () => {
  assert.ok(has(grade({ final: GOOD.split('\n').slice(0, -2).join('\n') }).problems, 'no line starts with "Next:"'));
  assert.ok(has(grade({ final: `${GOOD}\n\nNext: or do this instead.` }).problems, 'lines start with "Next:"'));
  assert.ok(has(grade({ final: `${NEXT}\n\n${SENTENCE}` }).problems, 'does not start with a sentence'));
});

test('an empty final message is a problem', () => {
  const r = checkTranscript(jsonl([ev.init(), ev.result('')]));
  assert.ok(has(r.problems, 'no final message text'));
});

test('time words and money in the final message are refused, but not inside quoted claim text', () => {
  for (const [word, text] of [['minutes', 'the run took 5 minutes'], ['hours', 'it needs two hours'], ['days', 'wait 3 days'], ['weeks', 'in two weeks'], ['seconds', 'about 30 seconds'], ['ms', 'in 120 ms']]) {
    assert.ok(has(grade({ final: GOOD.replace('and no rule change waits for approval', text) }).problems, `duration word: "${word}"`), word);
  }
  assert.ok(has(grade({ final: GOOD.replace('approval', 'approval ($0.40)') }).problems, 'dollar sign'));
  assert.ok(has(grade({ final: GOOD.replace('approval', 'approval (3 dollars)') }).problems, 'money in words'));
  assert.ok(has(grade({ final: GOOD.replace('approval', 'approval (USD 3)') }).problems, 'money in words'));
  assert.deepEqual(grade({ final: GOOD.replace('and no rule change waits for approval', 'and the claim "costs $2.87 million in two weeks, 3 dollars each" waits') }).problems, []);
});

// ---- (b) Insight blocks and other decorations ------------------------------------------------------------------------------------------

test('an Insight marker in the final message is refused, in each of its spellings', () => {
  for (const marker of ['`★ Insight ─────────────────────────────────────`', '`✶ Insight ─────────`', '✦ Insight', 'Insight ───────────────────', '💡 Insight', '★Insight']) {
    const r = grade({ final: `${marker}\n\n${GOOD}` });
    assert.ok(has(r.problems, 'Insight block'), marker);
  }
  assert.deepEqual(grade({ final: GOOD.replace('nothing is paused', 'nothing is paused (the insight is that 12 rows wait)') }).problems, [], 'the plain word is not a marker');
});

test('an Insight block in an earlier message is refused even when the final message is clean', () => {
  const block = '`★ Insight ─────────────────────────────────────`\nThe skill is a fixed sequence.\n`─────────────────────────────────────────────────`';
  const r = grade({ middle: [ev.text(block), ev.text('Reading the rows.')] });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /^1 assistant message before the final message holds an Insight block/);
  const two = grade({ middle: [ev.text(block), ev.text('✶ Insight ───')] });
  assert.match(two.problems[0], /^2 assistant messages before the final message hold an Insight block/);
  const sub = grade({ middle: [ev.text(block, { parent_tool_use_id: 'toolu_parent' })] });
  assert.equal(sub.problems.length, 1, 'a subagent message counts too: the override has to hold everywhere');
});

test('progress lines before the final message are allowed to say what is happening', () => {
  assert.deepEqual(grade({ middle: [ev.text('Reading 7 claims.'), ev.text('The judge takes a few minutes, $0.20.')] }).problems, []);
});

test('a fenced code block or a rule line in the final message is refused', () => {
  assert.ok(has(grade({ final: `${SENTENCE}\n\n\`\`\`\nplain text\n\`\`\`\n\n${NEXT}` }).problems, 'fenced code block'));
  assert.ok(has(grade({ final: `${SENTENCE}\n\n~~~\nplain text\n~~~\n\n${NEXT}` }).problems, 'fenced code block'));
  assert.ok(has(grade({ final: `${GOOD}\n\n─────────────────────` }).problems, 'rule line'));
  assert.deepEqual(grade({ final: GOOD.replace('Your queue (link)', '`Your queue` (link)') }).problems, [], 'inline code is fine');
});

// ---- (c) JSON ------------------------------------------------------------------------------------------------------------------------

test('a JSON object or array in the final message is refused; a footnote number in brackets is not JSON', () => {
  assert.ok(has(grade({ final: `${SENTENCE}\n\n{"rows": 12}\n\n${NEXT}` }).problems, 'JSON object'));
  assert.ok(has(grade({ final: `${SENTENCE}\n\n["a", "b"]\n\n${NEXT}` }).problems, 'JSON array'));
  assert.ok(has(grade({ final: `${SENTENCE}\n\n[{"id": 1}, {"id": 2}]\n\n${NEXT}` }).problems, 'JSON array'));
  assert.deepEqual(grade({ final: GOOD.replace('approval.', 'approval [1].') }).problems, []);
  assert.deepEqual(grade({ final: GOOD.replace('Your queue (link)', '[Your queue](https://example.test/q)') }).problems, [], 'a Markdown link is not JSON');
});

test('findJson finds balanced JSON values and leaves the rest alone', () => {
  assert.deepEqual(findJson('no braces here'), []);
  assert.deepEqual(findJson('a {"k": [1, 2]} b').map((j) => j.kind), ['object']);
  assert.deepEqual(findJson('x ["a"] y {"b": 1}').map((j) => j.kind), ['array', 'object']);
  assert.deepEqual(findJson('[1]'), [], 'a lone number');
  assert.deepEqual(findJson('{ not json }'), []);
  assert.deepEqual(findJson('{"cut": '), []);
  assert.deepEqual(findJson('{"s": "a } b"}').map((j) => j.text), ['{"s": "a } b"}'], 'a bracket inside a string does not close the object');
});

// ---- (d) connector writes --------------------------------------------------------------------------------------------------------------------

const WRITE_TOOLS = [
  'mcp__claude_ai_notion__notion-update-page',
  'mcp__claude_ai_notion__notion-create-pages',
  'mcp__16f81eb6-6eb4-423e-9e64-a5cb678b0953__notion-create-database',
  'mcp__claude_ai_notion__notion-update-data-source',
  'mcp__other__notion-create-view',
  'mcp__other__notion-update-view',
  'mcp__other__notion-delete-pages',
  'mcp__other__notion-delete-databases',
  'mcp__other__notion-move-pages',
  'mcp__other__notion-duplicate-page',
  'mcp__other__notion-restore-pages',
  'mcp__other__notion-create-comment',
  'mcp__other__notion-update-folder',
  'notion-update-page',
];
for (const name of WRITE_TOOLS) {
  test(`a tool call named ${name} is a connector write`, () => {
    const r = grade({ middle: [ev.tool(name, { page_id: 'p1' })] });
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.ok(has(r.problems, 'writes to Notion through the connector'));
    assert.equal(r.stats.notion_writes, 1);
    assert.equal(r.stats.notion_reads, 0);
  });
}

test('connector reads are counted as reads and are not problems', () => {
  const reads = ['notion-fetch', 'notion-search', 'notion-query-data-sources', 'notion-get-async-task', 'notion-get-self', 'notion-get-users', 'notion-list-recent-pages'];
  const r = grade({ middle: reads.map((n) => ev.tool(`mcp__claude_ai_notion__${n}`, { id: 'x' })) });
  assert.deepEqual(r.problems, []);
  assert.equal(r.stats.notion_reads, reads.length);
  assert.equal(r.stats.notion_writes, 0);
});

test('a tool call that only mentions a Notion write in its input (loading it with ToolSearch) is not a write', () => {
  const r = grade({ middle: [ev.tool('ToolSearch', { query: 'select:mcp__claude_ai_notion__notion-update-page', max_results: 1 })] });
  assert.deepEqual(r.problems, []);
  assert.equal(r.stats.notion_writes, 0);
});

// ---- (e) editor columns and forbidden command text --------------------------------------------------------------------------------------

test('each editor column named in a script argument is refused', () => {
  for (const column of DEFAULT_EDITOR_COLUMNS) {
    const r = grade({ middle: [bash(`node agents/claim-tagger-mvp/scripts/promote.mjs --lesson L1 --set "${column}=Applies"`)] });
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.ok(has(r.problems, `names the editor column "${column}"`), column);
  }
});

test('the editor column is found in other spellings, and not inside longer words', () => {
  for (const arg of ['--review_status=Reviewed', '--REVIEW-STATUS Reviewed', '--editor-wording x', 'challenged   tags   notes', '--set paused=true']) {
    const r = grade({ middle: [bash(`node agents/claim-tagger-mvp/scripts/promote.mjs ${arg}`)] });
    assert.ok(has(r.problems, 'names the editor column'), arg);
  }
  assert.deepEqual(grade({ middle: [bash('node agents/claim-tagger-mvp/scripts/promote.mjs --lesson unpaused-note')] }).problems, []);
});

test('an editor column in the input of a tool that writes files or Notion is refused', () => {
  const plan = ev.tool('Write', { file_path: 'plan.jsonl', content: '{"properties": {"Challenged tags notes": "x"}}' });
  assert.ok(has(grade({ middle: [plan] }).problems, 'names the editor column "Challenged tags notes"'));
  const edit = ev.tool('Edit', { file_path: 'a.md', old_string: 'a', new_string: 'Editor wording' });
  assert.ok(has(grade({ middle: [edit] }).problems, 'names the editor column "Editor wording"'));
  const notion = ev.tool('mcp__claude_ai_notion__notion-update-page', { page_id: 'p', properties: { 'Review status': 'Reviewed' } });
  const r = grade({ middle: [notion] });
  assert.ok(has(r.problems, 'writes to Notion'));
  assert.ok(has(r.problems, 'names the editor column "Review status"'), 'a Notion write on an editor column is named twice: once for the write, once for the column');
});

test('reading or searching for a column name is not writing it', () => {
  const r = grade({
    middle: [
      ev.tool('Read', { file_path: 'docs/Paused.md' }),
      ev.tool('Grep', { pattern: 'Review status', path: 'agents' }),
      ev.tool('Skill', { skill: 'claim-tagger', args: 'status' }),
      ev.tool('ToolSearch', { query: 'Why wrong' }),
      ev.tool('Agent', { description: 'check', prompt: 'Never write Challenged tags notes or Editor wording.' }),
      ev.tool('mcp__claude_ai_notion__notion-search', { query: 'Paused' }),
    ],
  });
  assert.deepEqual(r.problems, []);
});

test('the editor columns come from the options when they are given', () => {
  const r = grade({ middle: [bash('node agents/claim-tagger-mvp/scripts/pull.mjs --set "Secret column=1" --set "Review status=1"')] }, { editorColumns: ['Secret column'] });
  assert.equal(r.problems.length, 1);
  assert.ok(has(r.problems, '"Secret column"'));
});

test('command text with --unpause, --bare, --fallback-model, git push or curl is refused', () => {
  const cases = [
    ['node agents/claim-tagger-mvp/scripts/status.mjs --unpause --confirm', '--unpause'],
    ['claude -p hi --bare', '--bare'],
    ['claude -p hi --fallback-model x', '--fallback-model'],
    ['git push origin mvp-2026-11', 'git push'],
    ['curl -s https://example.test', 'curl'],
    ['CURL https://example.test', 'curl'],
  ];
  for (const [command, label] of cases) {
    const r = grade({ middle: [bash(command)] });
    assert.ok(has(r.problems, `holds "${label}"`), command);
    assert.equal(r.problems.filter((p) => p.includes('tool call 1')).length, 1, `one problem per call: ${r.problems.join('\n')}`);
  }
  assert.deepEqual(grade({ middle: [bash('node agents/claim-tagger-mvp/scripts/pull.mjs --label curly')] }).problems, [], 'a longer word that starts with curl is not curl');
});

// ---- (f) which Bash commands are allowed -----------------------------------------------------------------------------------------------

test('classifyBash allows one allowed script or one read-only git command, and nothing else', () => {
  const allowed = [
    'node agents/claim-tagger-mvp/scripts/pull.mjs --all',
    'node ./agents/claim-tagger-mvp/scripts/status.mjs',
    'node agents\\claim-tagger-mvp\\scripts\\judge.mjs --items claims',
    'node "agents/claim-tagger-mvp/scripts/promote.mjs" --lesson L1',
    'node agents/claim-tagger-mvp/scripts/pull.mjs --all 2>&1',
    'node agents/claim-tagger-mvp/scripts/propose.mjs --reason "a; b | c > d"',
    "node agents/claim-tagger-mvp/scripts/propose.mjs --reason 'a && b $(c)'",
    '  node agents/claim-tagger-mvp/scripts/followup.mjs  ',
    'git status', 'git status --short', 'git log --oneline -5', 'git diff --stat HEAD~1',
    ...DEFAULT_ALLOWED_SCRIPTS.map((s) => `node agents/claim-tagger-mvp/scripts/${s}.mjs`),
  ];
  for (const c of allowed) assert.deepEqual(classifyBash(c), { ok: true }, c);
  const refused = [
    'node agents/claim-tagger-mvp/scripts/setup.mjs',
    'node agents/claim-tagger-mvp/scripts/rollback.mjs --confirm',
    'node agents/claim-tagger-mvp/scripts/restore.mjs',
    'node agents/claim-tagger-mvp/scripts/hooks/guard.mjs',
    'node agents/claim-tagger-mvp/scripts/lib/claude.mjs',
    'node agents/claim-tagger/scripts/status.mjs',
    'node X:\\work\\geo-agents\\agents\\claim-tagger-mvp\\scripts\\pull.mjs',
    'node agents/claim-tagger-mvp/scripts/pull.mjs --all && echo done',
    'node agents/claim-tagger-mvp/scripts/pull.mjs --all; echo "exit=$?"',
    'node agents/claim-tagger-mvp/scripts/pull.mjs | head -5',
    'node agents/claim-tagger-mvp/scripts/pull.mjs > out.txt',
    'node agents/claim-tagger-mvp/scripts/pull.mjs < in.txt',
    'node agents/claim-tagger-mvp/scripts/pull.mjs $(cat x)',
    'node agents/claim-tagger-mvp/scripts/pull.mjs "$(cat x)"',
    'node agents/claim-tagger-mvp/scripts/pull.mjs `id`',
    'node agents/claim-tagger-mvp/scripts/pull.mjs ${HOME}',
    'node agents/claim-tagger-mvp/scripts/pull.mjs --all\nrm -rf x',
    'node agents/claim-tagger-mvp/scripts/pull.mjs --all &',
    'git commit -m x', 'git add .', 'git status && git push', 'git log --output=x.txt', 'git log --output x.txt', 'git -C . status', 'gitk',
    'ls agents', 'cat .env', 'node -e "1"', 'node agents/claim-tagger-mvp/scripts/pull', 'npm test', 'python x.py', '',
  ];
  for (const c of refused) {
    const v = classifyBash(c);
    assert.equal(v.ok, false, JSON.stringify(c));
    assert.equal(typeof v.why, 'string');
  }
});

test('classifyBash names the reason', () => {
  assert.match(classifyBash('node agents/claim-tagger-mvp/scripts/setup.mjs').why, /runs the script "setup", which is not in the allowed list/);
  assert.match(classifyBash('a && b').why, /chains several commands/);
  assert.match(classifyBash('x $(y)').why, /command substitution/);
  assert.match(classifyBash('git log --output=x').why, /--output/);
  assert.match(classifyBash('ls').why, /not one of the allowed scripts/);
});

test('allowedScripts changes which scripts may run', () => {
  const setup = bash('node agents/claim-tagger-mvp/scripts/setup.mjs --all');
  assert.ok(has(grade({ middle: [setup] }).problems, '"setup"'));
  assert.deepEqual(grade({ middle: [setup] }, { allowedScripts: ['setup'] }).problems, []);
  assert.ok(has(grade({ middle: [bash('node agents/claim-tagger-mvp/scripts/pull.mjs')] }, { allowedScripts: ['setup'] }).problems, '"pull"'));
});

test('every Bash call is judged on its own and numbered', () => {
  const r = grade({ middle: [bash('node agents/claim-tagger-mvp/scripts/pull.mjs --all'), bash('ls -la'), bash('node agents/claim-tagger-mvp/scripts/status.mjs')] });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /^tool call 2 \(Bash\)/);
});

test('the PowerShell tool is judged like Bash and counted as a shell call', () => {
  const r = grade({ middle: [ev.tool('PowerShell', { command: 'node agents/claim-tagger-mvp/scripts/pull.mjs --all' }), ev.tool('PowerShell', { command: 'git push' })] });
  assert.equal(r.stats.bash_calls, 2);
  assert.ok(has(r.problems, 'holds "git push"'));
});

// ---- tools: subagents, repeats, summaries ---------------------------------------------------------------------------------------------------

test('a tool call inside a subagent is graded like any other', () => {
  const r = grade({ middle: [ev.tool('mcp__claude_ai_notion__notion-update-page', { page_id: 'p' }, 'toolu_sub', { parent_tool_use_id: 'toolu_parent' })] });
  assert.ok(has(r.problems, 'writes to Notion'));
});

test('a tool_use that appears twice with the same id is one call', () => {
  const same = bash('node agents/claim-tagger-mvp/scripts/pull.mjs', 'toolu_dup');
  const r = grade({ middle: [same, same] });
  assert.equal(r.stats.tool_calls, 1);
  assert.equal(r.stats.bash_calls, 1);
});

test('tool summaries say what was called, one line each', () => {
  const r = grade({
    middle: [
      bash('node agents/claim-tagger-mvp/scripts/status.mjs'),
      ev.tool('Read', { file_path: 'agents/claim-tagger-mvp/config.json' }),
      ev.tool('Grep', { pattern: 'Unsourced', path: 'agents' }),
      ev.tool('Skill', { skill: 'claim-tagger', args: 'status' }),
      ev.tool('mcp__claude_ai_notion__notion-fetch', { id: 'abc' }),
      bash(`node agents/claim-tagger-mvp/scripts/judge.mjs --items claims ${'x'.repeat(300)}`),
    ],
  });
  assert.deepEqual(r.tools.slice(0, 5).map((t) => t.summary), [
    'node agents/claim-tagger-mvp/scripts/status.mjs', 'agents/claim-tagger-mvp/config.json', 'Unsourced in agents', 'claim-tagger status', '{"id":"abc"}',
  ]);
  assert.ok(r.tools[5].summary.length <= 160);
  assert.ok(r.tools[5].summary.endsWith('...'));
});

// ---- (h) hard rule 9: tokens and .env ---------------------------------------------------------------------------------------------------------

test('a file tool or command that reaches for .env is refused', () => {
  for (const [name, input] of [
    ['Read', { file_path: 'X:\\work\\geo-agents\\.env' }],
    ['Read', { file_path: '.env.local' }],
    ['Grep', { pattern: 'TOKEN', path: '.env' }],
    ['Bash', { command: 'cat .env' }],
    ['Glob', { pattern: '**/.env*' }],
  ]) assert.ok(has(grade({ middle: [ev.tool(name, input)] }).problems, 'reaches for a .env file'), `${name} ${JSON.stringify(input)}`);
  for (const [name, input] of [
    ['Read', { file_path: 'agents/claim-tagger-mvp/config.json' }],
    ['Read', { file_path: 'docs/environment.md' }],
    ['Bash', { command: 'node -e "console.log(process.env.HOME)"' }],
    ['Agent', { prompt: 'Never open .env' }],
  ]) assert.ok(!has(grade({ middle: [ev.tool(name, input)] }).problems, 'reaches for a .env file'), `${name} ${JSON.stringify(input)}`);
});

test('a string that looks like an access token is refused, and never echoed', () => {
  const secrets = [
    ['Notion token', ['ntn', 'Zq9xT3'.repeat(7)].join('_')],
    ['Notion token (old form)', ['secret', 'Ab12Cd'.repeat(8)].join('_')],
    ['Anthropic API key', ['sk', 'ant', 'api03', 'Qw3rTy'.repeat(6)].join('-')],
  ];
  for (const [kind, token] of secrets) {
    const events = [ev.init(), { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: `config says ${token}` }] } }, ev.text(GOOD), ev.result(GOOD)];
    const r = checkTranscript(jsonl(events));
    assert.ok(has(r.problems, `looks like a ${kind}`), kind);
    assert.ok(!JSON.stringify(r).includes(token), 'the value is not shown');
  }
  assert.equal(TOKEN_KINDS.length, 3);
  assert.ok(checkTranscript(fixture('pass-demo-tag')).ok, 'ordinary ids are not tokens');
});

// ---- (g) the result event and the stream ------------------------------------------------------------------------------------------------------

test('a missing result event, an error result and a missing num_turns are problems', () => {
  const noResult = jsonl([ev.init(), ev.text(GOOD)]);
  assert.ok(has(checkTranscript(noResult).problems, 'no result event'));
  assert.ok(has(grade({ resultOver: { is_error: true } }).problems, 'is_error true'));
  assert.ok(has(grade({ resultOver: { is_error: undefined } }).problems, 'is_error'), 'a result without is_error is not a pass');
  assert.ok(has(grade({ resultOver: { num_turns: undefined } }).problems, 'no num_turns'));
  assert.ok(has(grade({ resultOver: { num_turns: '4' } }).problems, 'no num_turns'));
});

test('two result events: the last one gives the turns and the final message, and an earlier error still counts', () => {
  const ok = jsonl([ev.init(), ev.text('Running.'), ev.result('Running.', { num_turns: 6 }), ev.init(), ev.text(GOOD), ev.result(GOOD, { num_turns: 8 })]);
  const r = checkTranscript(ok);
  assert.deepEqual(r.problems, []);
  assert.equal(r.stats.turns, 8);
  assert.equal(r.info.results, 2);
  const bad = jsonl([ev.init(), ev.text('Running.'), ev.result('Running.', { is_error: true }), ev.init(), ev.text(GOOD), ev.result(GOOD)]);
  assert.ok(has(checkTranscript(bad).problems, 'is_error true'));
});

test('a result text that differs from the last assistant text is noted; the assistant text is what is graded', () => {
  const r = checkTranscript(jsonl([ev.init(), ev.text(GOOD), ev.result('something else')]));
  assert.equal(r.ok, true);
  assert.equal(r.final, GOOD);
  assert.ok(r.info.notes.some((n) => n.includes('differs')));
});

test('a cut-off event is a problem, because part of the transcript could not be read', () => {
  const r = checkTranscript(`${run()}{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","inp`);
  assert.ok(has(r.problems, 'looks like a JSON event but does not parse'));
  const stray = checkTranscript(`warning: something\n${run()}`);
  assert.equal(stray.ok, true, 'a stray text line is not');
  assert.equal(stray.info.skipped_lines, 1);
});

test('expectStyle confirms the output style from the init event', () => {
  assert.equal(grade({}, { expectStyle: 'Explanatory' }).ok, true);
  assert.ok(has(grade({ init: ev.init('default') }, { expectStyle: 'Explanatory' }).problems, 'output style was "default", not "Explanatory"'));
  assert.ok(has(grade({ init: ev.init(undefined, { output_style: undefined }) }, { expectStyle: 'Explanatory' }).problems, 'cannot be confirmed'));
  assert.ok(has(checkTranscript(jsonl([ev.text(GOOD), ev.result(GOOD)]), { expectStyle: 'Explanatory' }).problems, 'cannot be confirmed'), 'no init event at all');
  assert.equal(grade({ init: ev.init('default') }).ok, true, 'not checked when no style is expected');
  const later = jsonl([ev.init(), ev.text('Running.'), ev.result('Running.'), ev.init('default'), ev.text(GOOD), ev.result(GOOD)]);
  assert.ok(has(checkTranscript(later, { expectStyle: 'Explanatory' }).problems, '"default"'), 'every init event is looked at');
});

// ---- the editor columns of the config ------------------------------------------------------------------------------------------------------

test('the editor columns come from config.json without the Status values', () => {
  const config = JSON.parse(readFileSync(join(REPO, 'agents', 'claim-tagger-mvp', 'config.json'), 'utf8'));
  assert.deepEqual(editorColumnsFromConfig(config), ['Verified tags', 'Review status', 'Challenged tags notes', 'Editor wording', 'Paused']);
  assert.deepEqual(editorColumnsFromConfig(config), [...DEFAULT_EDITOR_COLUMNS]);
  assert.deepEqual(editorColumnsFromConfig({ editor_columns: { a: ['X', 'Y'], b: ['Y', 'Z'], c_status_editor_values: ['Approved'] } }), ['X', 'Y', 'Z']);
  assert.deepEqual(editorColumnsFromConfig({}), [...DEFAULT_EDITOR_COLUMNS]);
  assert.deepEqual(loadEditorColumns(REPO + 'no-such-folder'), [...DEFAULT_EDITOR_COLUMNS]);
  const root = tmp();
  writeFileSync(join(root, 'config.json'), JSON.stringify({ editor_columns: { t: ['Only this one'] } }));
  assert.deepEqual(loadEditorColumns(root), ['Only this one']);
});

// ---- the transcript-check command line --------------------------------------------------------------------------------------------------

test('transcript-check prints "no problems" and exits 0 for a passing transcript', () => {
  const c = cap();
  assert.equal(checkMain([fixturePath('pass-status')], c.io), 0);
  assert.match(c.out.join('\n'), /no problems in .*pass-status\.jsonl \(4 turns, 3 tool calls \(2 Bash, 0 Notion reads, 0 Notion writes\)\)/);
  assert.deepEqual(c.err, []);
});

test('transcript-check prints one line per problem and exits 1 for a failing transcript', () => {
  const c = cap();
  assert.equal(checkMain([fixturePath('fail-fourth-part')], c.io), 1);
  const lines = c.out.join('\n').split('\n');
  assert.match(lines[0], /^transcript-check: 2 problems in /);
  assert.equal(lines.filter((l) => l.startsWith('  - ')).length, 2);
});

test('transcript-check --json prints the whole result, and --style is checked', () => {
  const c = cap();
  assert.equal(checkMain([fixturePath('pass-status'), '--json'], c.io), 0);
  const r = JSON.parse(c.out.join('\n'));
  assert.deepEqual(Object.keys(r), ['ok', 'problems', 'final', 'tools', 'stats', 'info']);
  assert.equal(r.ok, true);
  const learning = cap();
  assert.equal(checkMain([fixturePath('pass-status'), '--style', 'Learning'], learning.io), 1);
  assert.match(learning.out.join('\n'), /output style was "Explanatory", not "Learning"/);
  assert.equal(checkMain([fixturePath('pass-status'), '--style', 'Explanatory'], cap().io), 0);
});

test('transcript-check refuses a bad command line with exit 2', () => {
  for (const argv of [[], ['a.jsonl', 'b.jsonl'], ['--nope', 'a.jsonl'], [join(tmp(), 'missing.jsonl')]]) {
    const c = cap();
    assert.equal(checkMain(argv, c.io), 2, JSON.stringify(argv));
    assert.match(c.err.join('\n'), /transcript-check:/);
  }
  const help = cap();
  assert.equal(checkMain(['--help'], help.io), 0);
  assert.match(help.out.join('\n'), /^usage: node agents\/claim-tagger-mvp\/scripts\/transcript-check\.mjs/);
});

test('transcript-check runs as a script: exit 0 and 1, and --json is pure JSON', () => {
  const pass = spawnSync(process.execPath, [CHECK_SCRIPT, fixturePath('pass-status'), '--json'], { encoding: 'utf8' });
  assert.equal(pass.status, 0, pass.stderr);
  assert.equal(JSON.parse(pass.stdout).ok, true);
  const fail = spawnSync(process.execPath, [CHECK_SCRIPT, fixturePath('fail-git-push')], { encoding: 'utf8' });
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /holds "git push"/);
});

// ---- headless-check: settings and arguments (nothing is started) --------------------------------------------------------------------------

test('mergeSettings adds the Explanatory output style and changes nothing else', () => {
  const base = JSON.parse(readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8'));
  const before = JSON.stringify(base);
  const merged = mergeSettings(base);
  assert.equal(merged.outputStyle, 'Explanatory');
  assert.equal(OUTPUT_STYLE, 'Explanatory');
  assert.deepEqual({ ...merged, outputStyle: undefined }, { ...base, outputStyle: undefined });
  assert.deepEqual(merged.permissions, base.permissions);
  assert.deepEqual(merged.hooks, base.hooks);
  assert.equal(JSON.stringify(base), before, 'the input is not modified');
  assert.notEqual(merged.permissions, base.permissions, 'a deep copy, not the same object');
});

test('mergeSettings replaces a style the file already had, and takes another style when told', () => {
  assert.equal(mergeSettings({ outputStyle: 'default', a: 1 }).outputStyle, 'Explanatory');
  assert.deepEqual(mergeSettings({ a: 1 }, { outputStyle: 'Learning' }), { a: 1, outputStyle: 'Learning' });
  assert.deepEqual(mergeSettings({}), { outputStyle: 'Explanatory' });
});

test('mergeSettings refuses anything that is not a settings object', () => {
  for (const bad of [null, undefined, [], 'text', 3]) assert.throws(() => mergeSettings(bad), TypeError);
  assert.throws(() => mergeSettings({}, { outputStyle: '' }), TypeError);
});

test('buildArgs is exactly the documented command line', () => {
  assert.deepEqual(buildArgs({ prompt: '/claim-tagger status', settingsPath: 'C:\\out\\headless-settings.json' }), [
    '-p', '/claim-tagger status', '--settings', 'C:\\out\\headless-settings.json', '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose',
  ]);
});

test('buildArgs never passes --bare or --fallback-model, whether in the prompt or in the other arguments', () => {
  for (const prompt of ['hello --bare', '/claim-tagger status --fallback-model x', '--bare', 'x --fallback-model=opus', 'say "--bare"', "it's '--bare'"]) {
    assert.throws(() => buildArgs({ prompt, settingsPath: 's.json' }), /never passed to the CLI/, prompt);
  }
  assert.throws(() => buildArgs({ prompt: 'ok', settingsPath: '--bare' }), /never passed/);
  assert.deepEqual(buildArgs({ prompt: 'a bare table and a fallback model', settingsPath: 's.json' }).slice(0, 2), ['-p', 'a bare table and a fallback model'], 'the words are fine');
  assert.ok(!buildArgs({ prompt: '/claim-tagger status', settingsPath: 's.json' }).some((a) => /^--(bare|fallback-model)/.test(a)));
});

test('buildArgs refuses an empty prompt, a prompt that would be read as an option, a drive path and a missing settings path', () => {
  for (const prompt of ['', '   ', undefined, null, 5]) assert.throws(() => buildArgs({ prompt, settingsPath: 's.json' }), /non-empty string/);
  assert.throws(() => buildArgs({ prompt: '--help', settingsPath: 's.json' }), /read as an option/);
  assert.throws(() => buildArgs({ prompt: '-p x', settingsPath: 's.json' }), /read as an option/);
  assert.throws(() => buildArgs({ prompt: 'C:/Program Files/Git/claim-tagger status', settingsPath: 's.json' }), /MSYS_NO_PATHCONV=1/);
  assert.throws(() => buildArgs({ prompt: 'x', settingsPath: '' }), /settingsPath is required/);
  assert.throws(() => buildArgs(), TypeError);
});

test('slugify, promptDirName and readPrompts', () => {
  assert.equal(slugify('/claim-tagger status'), 'claim-tagger-status');
  assert.equal(slugify('/claim-tagger demo tag --limit 5'), 'claim-tagger-demo-tag-limit-5');
  assert.equal(slugify('???'), 'prompt');
  assert.equal(slugify('A'.repeat(100)).length, 40);
  assert.ok(!slugify('word '.repeat(20)).endsWith('-'));
  assert.equal(promptDirName(1, '/claim-tagger status'), '01-claim-tagger-status');
  assert.equal(promptDirName(12, 'x'), '12-x');
  assert.deepEqual(readPrompts('# the demo\n/claim-tagger status\n\n  /claim-tagger demo tag  \r\n# not this\n'), ['/claim-tagger status', '/claim-tagger demo tag']);
  assert.deepEqual(readPrompts('["/a", {"prompt": "/b"}]'), ['/a', '/b']);
  assert.deepEqual(readPrompts(''), []);
  assert.throws(() => readPrompts('["/a", 3]'), /prompt 2/);
  assert.throws(() => readPrompts('[1'), SyntaxError);
});

// ---- headless-check: the runner, against the fake CLI --------------------------------------------------------------------------------------

/** Run the runner in this process; the CLI it starts is the fake one. `fake` is the environment the fake reads. */
async function headless(argv, fake = {}, extraEnv = {}) {
  const c = cap();
  const code = await headlessMain(argv, c.io, { processEnv: { ...process.env, ...fake }, ...extraEnv });
  return { code, out: c.out.join('\n'), err: c.err.join('\n') };
}
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const captured = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('a passing run: the CLI is started as documented, every file is written and the exit code is 0', async () => {
  const dir = tmp();
  const out = join(dir, 'out');
  const capture = join(dir, 'capture.jsonl');
  const r = await headless(['--prompt', '/claim-tagger status', '--out', out, '--claude-bin', FAKE_CLI], {
    FAKE_TRANSCRIPT: fixturePath('pass-status'), FAKE_CAPTURE: capture, FAKE_STDERR: 'a warning\n', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli',
  });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /PASS \/claim-tagger status \(4 turns, 3 tool calls/);
  assert.ok(r.out.includes(GOOD), 'the final message is printed');

  for (const f of ['transcript.jsonl', 'stderr.txt', 'check.json', 'final-message.md', 'headless-settings.json']) assert.ok(existsSync(join(out, f)), f);
  assert.equal(readFileSync(join(out, 'transcript.jsonl'), 'utf8'), fixture('pass-status'), 'the CLI wrote its stdout into the transcript file');
  assert.equal(readFileSync(join(out, 'stderr.txt'), 'utf8'), 'a warning\n');
  assert.equal(readFileSync(join(out, 'final-message.md'), 'utf8'), `${GOOD}\n`);

  const check = readJson(join(out, 'check.json'));
  assert.equal(check.ok, true);
  assert.equal(check.status, 'pass');
  assert.equal(check.exit_code, 0);
  assert.equal(check.timed_out, false);
  assert.deepEqual(check.problems, []);
  assert.equal(check.final, GOOD);
  assert.equal(check.prompt, '/claim-tagger status');
  assert.equal(check.claude.style, 'Explanatory');
  assert.deepEqual(check.stats, { turns: 4, tool_calls: 3, bash_calls: 2, notion_reads: 0, notion_writes: 0 });
  assert.ok(!JSON.stringify(check).includes('CLAUDECODE'), 'no environment is recorded');

  const [call] = captured(capture);
  assert.deepEqual(call.args, buildArgs({ prompt: '/claim-tagger status', settingsPath: join(out, 'headless-settings.json') }));
  assert.deepEqual(call.env, { CLAUDECODE: null, CLAUDE_CODE_ENTRYPOINT: null, MSYS_NO_PATHCONV: '1' }, 'scrubbed environment plus MSYS_NO_PATHCONV');
  assert.equal(resolve(call.cwd).toLowerCase(), resolve(REPO).toLowerCase(), 'the CLI runs in the repository root by default');
});

test('the settings file the CLI is given is the project settings plus the Explanatory style, and nothing else', async () => {
  const dir = tmp();
  const out = join(dir, 'out');
  const r = await headless(['--prompt', '/claim-tagger status', '--out', out, '--claude-bin', FAKE_CLI, '--cwd', REPO], { FAKE_TRANSCRIPT: fixturePath('pass-status') });
  assert.equal(r.code, 0, r.out + r.err);
  const copy = readJson(join(out, 'headless-settings.json'));
  const original = readJson(join(REPO, '.claude', 'settings.json'));
  assert.deepEqual(copy, mergeSettings(original));
  assert.equal(copy.outputStyle, 'Explanatory');
  assert.deepEqual(Object.keys(copy).sort(), [...Object.keys(original), 'outputStyle'].sort());
});

test('a settings file with something that looks like a token is not copied', async () => {
  const dir = tmp();
  const settings = join(dir, 'settings.json');
  writeFileSync(settings, JSON.stringify({ env: { X: ['ntn', 'Zq9xT3'.repeat(7)].join('_') } }));
  const capture = join(dir, 'capture.jsonl');
  const r = await headless(['--prompt', '/claim-tagger status', '--out', join(dir, 'out'), '--claude-bin', FAKE_CLI, '--settings', settings], { FAKE_TRANSCRIPT: fixturePath('pass-status'), FAKE_CAPTURE: capture });
  assert.equal(r.code, 2);
  assert.match(r.err, /looks like a Notion token/);
  assert.ok(!r.err.includes('Zq9xT3'), 'the value is not printed');
  assert.ok(!existsSync(join(dir, 'out', 'headless-settings.json')));
  assert.ok(!existsSync(capture), 'the CLI was not started');
});

test('a failing check exits 1, prints one line per problem and still writes the files', async () => {
  const out = join(tmp(), 'out');
  const r = await headless(['--prompt', '/claim-tagger status', '--out', out, '--claude-bin', FAKE_CLI], { FAKE_TRANSCRIPT: fixturePath('fail-fourth-part') });
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL \/claim-tagger status/);
  assert.equal(r.out.split('\n').filter((l) => l.startsWith('  - ')).length, 2);
  assert.match(r.out, /--- final message ---/);
  const check = readJson(join(out, 'check.json'));
  assert.equal(check.ok, false);
  assert.equal(check.status, 'fail');
  assert.equal(check.problems.length, 2);
});

test('the run is graded with the Explanatory style expected', async () => {
  const dir = tmp();
  const wrongStyle = join(dir, 'wrong.jsonl');
  writeFileSync(wrongStyle, fixture('pass-status').replace('"output_style":"Explanatory"', '"output_style":"default"'));
  const r = await headless(['--prompt', '/claim-tagger status', '--out', join(dir, 'out'), '--claude-bin', FAKE_CLI], { FAKE_TRANSCRIPT: wrongStyle });
  assert.equal(r.code, 1);
  assert.match(r.out, /output style was "default", not "Explanatory"/);
});

test('a CLI that exits with an error code fails the check even when the transcript is clean', async () => {
  const out = join(tmp(), 'out');
  const r = await headless(['--prompt', '/claim-tagger status', '--out', out, '--claude-bin', FAKE_CLI], { FAKE_TRANSCRIPT: fixturePath('pass-status'), FAKE_EXIT: '3' });
  assert.equal(r.code, 1);
  assert.match(r.out, /the CLI exited with code 3/);
  assert.equal(readJson(join(out, 'check.json')).exit_code, 3);
});

test('the usage window ends the run with exit 75 and a plain message, not a failed check', async () => {
  const out = join(tmp(), 'out');
  const r = await headless(['--prompt', '/claim-tagger status', '--out', out, '--claude-bin', FAKE_CLI], { FAKE_TRANSCRIPT: fixturePath('usage-limit'), FAKE_EXIT: '1' });
  assert.equal(r.code, 75);
  assert.match(r.out, /STOPPED \/claim-tagger status: the Claude usage window is used up \("You've hit your limit/);
  assert.equal(readJson(join(out, 'check.json')).status, 'usage_window');
});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

test('a CLI that never ends is stopped at the timeout, really killed, and the partial transcript is graded', async () => {
  const dir = tmp();
  const out = join(dir, 'out');
  const capture = join(dir, 'capture.jsonl');
  const r = await headless(['--prompt', '/claim-tagger status', '--out', out, '--claude-bin', FAKE_CLI, '--timeout-ms', '1500'], {
    FAKE_TRANSCRIPT: fixturePath('fail-no-result'), FAKE_HANG: '1', FAKE_CAPTURE: capture,
  });
  const [{ pid }] = captured(capture);
  try {
    assert.equal(r.code, 1);
    assert.match(r.out, /did not finish within 1500 ms and was stopped/);
    const check = readJson(join(out, 'check.json'));
    assert.equal(check.status, 'timeout');
    assert.equal(check.timed_out, true);
    assert.ok(has(check.problems, 'no result event'));
    for (let i = 0; i < 30 && alive(pid); i++) await new Promise((done) => setTimeout(done, 100));
    assert.equal(alive(pid), false, 'the CLI process is gone, not left running behind the result');
  } finally {
    if (alive(pid)) process.kill(pid, 'SIGKILL'); // never leave a hung stand-in behind, even when the assertions above fail
  }
});

test('a child that cannot be killed does not hang the run: it is let go after the grace period', async () => {
  const dir = tmp();
  const seen = { killed: false, unref: false };
  const spawnImpl = () => {
    const child = new EventEmitter(); // never closes, like a process that ignores the kill
    child.kill = () => { seen.killed = true; };
    child.unref = () => { seen.unref = true; };
    return child;
  };
  const r = await runPrompt({
    prompt: '/claim-tagger status', outDir: join(dir, 'o'), settingsPath: join(dir, 's.json'), cwd: REPO, bin: 'claude', spawnImpl, timeoutMs: 50, killGraceMs: 50,
  });
  assert.equal(r.status, 'timeout');
  assert.equal(r.code, 1);
  assert.equal(seen.killed, true);
  assert.equal(seen.unref, true, 'the process handle is released, or this script could never exit');
  assert.match(r.problems[0], /did not finish within 50 ms and was stopped/);
});

test('a program that cannot be started is reported as the only problem', async () => {
  const out = join(tmp(), 'out');
  const r = await headless(['--prompt', '/claim-tagger status', '--out', out, '--claude-bin', join(tmp(), 'no-such-claude.exe')]);
  assert.equal(r.code, 1);
  const check = readJson(join(out, 'check.json'));
  assert.equal(check.status, 'spawn_error');
  assert.equal(check.problems.length, 1);
  assert.match(check.problems[0], /^cannot start the CLI: /);
});

test('runPrompt with an injected spawn: the CLI gets the files as stdout and stderr, no shell, a closed stdin', async () => {
  const dir = tmp();
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    writeSync(options.stdio[1], fixture('pass-status'));
    setImmediate(() => child.emit('close', 0, null));
    return child;
  };
  const settingsPath = join(dir, 's.json');
  const r = await runPrompt({ prompt: '/claim-tagger status', outDir: join(dir, 'o'), settingsPath, cwd: REPO, bin: 'claude', spawnImpl, env: { PATH: 'x', CLAUDECODE: '1' } });
  assert.equal(r.status, 'pass');
  assert.equal(calls.length, 1);
  const [{ command, args, options }] = calls;
  assert.equal(command, 'claude');
  assert.deepEqual(args, buildArgs({ prompt: '/claim-tagger status', settingsPath }));
  assert.equal(options.shell, false);
  assert.equal(options.stdio[0], 'ignore');
  assert.equal(options.cwd, REPO);
  assert.deepEqual(options.env, { PATH: 'x', MSYS_NO_PATHCONV: '1' });
});

test('runPrompt reports a spawn that throws or errors', async () => {
  const dir = tmp();
  const base = { prompt: '/claim-tagger status', settingsPath: join(dir, 's.json'), cwd: REPO, bin: 'claude' };
  const thrown = await runPrompt({ ...base, outDir: join(dir, 'a'), spawnImpl: () => { throw new Error('boom'); } });
  assert.equal(thrown.status, 'spawn_error');
  assert.match(thrown.problems[0], /boom/);
  const errored = await runPrompt({
    ...base,
    outDir: join(dir, 'b'),
    spawnImpl: () => {
      const child = new EventEmitter();
      setImmediate(() => child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })));
      return child;
    },
  });
  assert.equal(errored.status, 'spawn_error');
  assert.match(errored.problems[0], /ENOENT/);
});

test('--prompts-file runs the prompts in turn into numbered folders and writes a summary', async () => {
  const dir = tmp();
  const out = join(dir, 'out');
  const file = join(dir, 'prompts.txt');
  writeFileSync(file, '# the demo\n/claim-tagger status\n/claim-tagger demo tag\n');
  const capture = join(dir, 'capture.jsonl');
  const r = await headless(['--prompts-file', file, '--out', out, '--claude-bin', FAKE_CLI], {
    FAKE_TRANSCRIPTS: JSON.stringify({ '/claim-tagger status': fixturePath('pass-status'), '/claim-tagger demo tag': fixturePath('fail-time-word') }), FAKE_CAPTURE: capture,
  });
  assert.equal(r.code, 1);
  for (const sub of ['01-claim-tagger-status', '02-claim-tagger-demo-tag']) {
    for (const f of ['transcript.jsonl', 'stderr.txt', 'check.json', 'final-message.md']) assert.ok(existsSync(join(out, sub, f)), `${sub}/${f}`);
  }
  assert.equal(readJson(join(out, '01-claim-tagger-status', 'check.json')).ok, true);
  assert.equal(readJson(join(out, '02-claim-tagger-demo-tag', 'check.json')).ok, false);
  assert.ok(existsSync(join(out, 'headless-settings.json')), 'one settings copy for the batch');
  assert.deepEqual(captured(capture).map((c) => c.args[1]), ['/claim-tagger status', '/claim-tagger demo tag'], 'in order');
  const summary = readJson(join(out, 'summary.json'));
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.prompts.map((p) => [p.n, p.status, p.ok]), [[1, 'pass', true], [2, 'fail', false]]);
  assert.match(r.out, /1 of 2 prompts passed/);
});

test('--prompts-file stops at the usage window and says which prompts were not run', async () => {
  const dir = tmp();
  const file = join(dir, 'prompts.json');
  writeFileSync(file, JSON.stringify(['/claim-tagger status', '/claim-tagger demo tag', '/claim-tagger demo distill']));
  const capture = join(dir, 'capture.jsonl');
  const r = await headless(['--prompts-file', file, '--out', join(dir, 'out'), '--claude-bin', FAKE_CLI], {
    FAKE_TRANSCRIPTS: JSON.stringify({ '/claim-tagger status': fixturePath('usage-limit') }), FAKE_EXIT: '1', FAKE_CAPTURE: capture,
  });
  assert.equal(r.code, 75);
  assert.match(r.out, /STOPPED \/claim-tagger status/);
  assert.match(r.out, /2 prompt\(s\) not run: "\/claim-tagger demo tag", "\/claim-tagger demo distill"/);
  assert.equal(captured(capture).length, 1, 'nothing was started after the stop');
  assert.ok(!existsSync(join(dir, 'out', '02-claim-tagger-demo-tag')));
  assert.equal(readJson(join(dir, 'out', 'summary.json')).ok, false);
});

test('an output folder that already holds a transcript is not overwritten unless asked', async () => {
  const out = join(tmp(), 'out');
  const argv = ['--prompt', '/claim-tagger status', '--out', out, '--claude-bin', FAKE_CLI];
  assert.equal((await headless(argv, { FAKE_TRANSCRIPT: fixturePath('pass-status') })).code, 0);
  const again = await headless(argv, { FAKE_TRANSCRIPT: fixturePath('fail-time-word') });
  assert.equal(again.code, 2);
  assert.match(again.err, /already holds a transcript/);
  assert.equal(readFileSync(join(out, 'transcript.jsonl'), 'utf8'), fixture('pass-status'), 'the first transcript is untouched');
  assert.equal((await headless([...argv, '--overwrite'], { FAKE_TRANSCRIPT: fixturePath('fail-time-word') })).code, 1);
  assert.equal(readFileSync(join(out, 'transcript.jsonl'), 'utf8'), fixture('fail-time-word'));
});

test('a bad command line is refused with exit 2 before anything is started', async () => {
  const dir = tmp();
  const capture = join(dir, 'capture.jsonl');
  const fake = { FAKE_TRANSCRIPT: fixturePath('pass-status'), FAKE_CAPTURE: capture };
  const base = ['--claude-bin', FAKE_CLI];
  const bad = [
    ['--out', join(dir, 'a')],
    ['--prompt', 'x'],
    ['--prompt', 'x', '--prompts-file', 'y', '--out', join(dir, 'b')],
    ['--prompt', 'x --bare', '--out', join(dir, 'c')],
    ['--prompt', 'x --fallback-model y', '--out', join(dir, 'd')],
    ['--prompt', '--help', '--out', join(dir, 'e')],
    ['--prompt', 'C:/Program Files/Git/claim-tagger status', '--out', join(dir, 'f')],
    ['--prompt', 'x', '--out', join(dir, 'g'), '--timeout-ms', '0'],
    ['--prompt', 'x', '--out', join(dir, 'h'), '--timeout-ms', 'soon'],
    ['--prompt', 'x', '--out', join(dir, 'i'), '--cwd', join(dir, 'no-such-folder')],
    ['--prompt', 'x', '--out', join(dir, 'j'), '--settings', join(dir, 'no-such-settings.json')],
    ['--prompt', 'x', '--out', join(dir, 'k'), '--bare'],
    ['--prompts-file', join(dir, 'no-such-prompts.txt'), '--out', join(dir, 'l')],
  ];
  for (const argv of bad) {
    const r = await headless([...argv, ...base], fake);
    assert.equal(r.code, 2, `${JSON.stringify(argv)}\n${r.out}${r.err}`);
    assert.match(r.err, /headless-check:/);
  }
  const empty = join(dir, 'empty.txt');
  writeFileSync(empty, '# nothing\n');
  assert.equal((await headless(['--prompts-file', empty, '--out', join(dir, 'm'), ...base], fake)).code, 2);
  assert.ok(!existsSync(capture), 'the CLI was never started');
  const help = await headless(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /^usage: node agents\/claim-tagger-mvp\/scripts\/headless-check\.mjs --prompt/);
});

test('a failure to write the output folder is reported with exit 1, not as a crash', async () => {
  const dir = tmp();
  const blocker = join(dir, 'a-file');
  writeFileSync(blocker, 'this is a file, not a folder');
  const capture = join(dir, 'capture.jsonl');
  const r = await headless(['--prompt', '/claim-tagger status', '--out', join(blocker, 'sub'), '--claude-bin', FAKE_CLI], { FAKE_TRANSCRIPT: fixturePath('pass-status'), FAKE_CAPTURE: capture });
  assert.equal(r.code, 1);
  assert.match(r.err, /^headless-check: /);
  assert.ok(!existsSync(capture), 'the CLI was not started');
});

test('headless-check runs as a script: --help, and a whole run through a real child process', () => {
  const help = spawnSync(process.execPath, [HEADLESS_SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^usage: node agents\/claim-tagger-mvp\/scripts\/headless-check\.mjs/);

  const out = join(tmp(), 'out');
  const run1 = spawnSync(process.execPath, [HEADLESS_SCRIPT, '--prompt', '/claim-tagger status', '--out', out, '--claude-bin', FAKE_CLI], {
    encoding: 'utf8', env: { ...process.env, FAKE_TRANSCRIPT: fixturePath('pass-status'), CLAUDECODE: '1' },
  });
  assert.equal(run1.status, 0, run1.stdout + run1.stderr);
  assert.match(run1.stdout, /PASS \/claim-tagger status/);
  assert.equal(readJson(join(out, 'check.json')).ok, true);

  const out2 = join(tmp(), 'out');
  const run2 = spawnSync(process.execPath, [HEADLESS_SCRIPT, '--prompt', '/claim-tagger status', '--out', out2, '--claude-bin', FAKE_CLI], {
    encoding: 'utf8', env: { ...process.env, FAKE_TRANSCRIPT: fixturePath('fail-git-push') },
  });
  assert.equal(run2.status, 1);
  assert.match(run2.stdout, /holds "git push"/);
});

test('the fixture folder holds the transcripts the tests read', () => {
  for (const name of ['pass-status', 'pass-demo-tag', 'pass-with-stray-line', ...FAILING.map(([n]) => n), 'usage-limit']) assert.ok(existsSync(fixturePath(name)), name);
  assert.ok(existsSync(FAKE_CLI));
});

// ---- a checklist after the report (decision 58) -------------------------------------------------------------------------------------------------

const LIST = [
  '1. Open Your queue (the link in the Next line): the claims that wait for you, lowest Agent confidence first.',
  '2. Read Agent reasons and Tags waiting: they say which tag waits and why.',
  '3. On each claim fill in, in this order: Verified tags, Challenged tags notes (start a line with the tag name and a colon when the agent judged several tags), Review status last.',
  '4. You need not say why the agent was wrong: it reads your decision itself. If you know the reason, start the note with Agent slip, Rule unclear or Rule should change and a full stop; the agent then takes your word as it stands.',
  '5. When your claims are decided, type /claim-tagger distill.',
];
const withList = (lines = LIST, glue = '\n\n') => `${GOOD}${glue}${lines.join('\n')}`;

// the report that sends the editor to Needs your note (a distill that read a decision with no note and drafted nothing), and its checklist (the guide's "Needs your note", Demo form)
const NOTE_REPORT = [
  'Demo · Distill: read 1 of your decisions; no rule change to draft; 6 decided rows name no rule problem; 1 of your decisions has no note and waits in Needs your note (practice page Claim tagger practice · 15 Oct 14:22).',
  '',
  '| What | Result |',
  '|---|---|',
  '| Read | 1 decision |',
  '| Point at a rule | none |',
  '| Agent slips | 1 decision |',
  '| Without a note | 1 decision |',
  '| Rule change | none |',
  '',
  'Next: add a note on 1 claim in Needs your note (https://www.notion.so/0123456789abcdef0123456789abcdef?v=fedcba9876543210fedcba9876543210), then type /claim-tagger demo distill again.',
].join('\n');
const NOTE_LIST = [
  '1. Open Needs your note (the link in the Next line): the claims where you decided against the agent and wrote no note.',
  '2. Read Agent reading next to your Verified tags: it says what the agent made of your decision without a note. That reading is a guess, so it drafts no rule change until your note is there.',
  '3. Add a line in Challenged tags notes for the tag: start with the tag name and a colon, then your words.',
  '4. If you know the reason, start your words with Agent slip, Rule unclear or Rule should change and a full stop; the agent then takes your word as it stands.',
  '5. When the notes are in, type /claim-tagger demo distill again.',
];

test('the report that sends the editor to Needs your note passes alone and with its checklist of five lines, and a sixth line or a second list fails it', () => {
  assert.deepEqual(grade({ final: NOTE_REPORT }).problems, [], 'the report alone');
  assert.deepEqual(grade({ final: `${NOTE_REPORT}\n\n${NOTE_LIST.join('\n')}` }).problems, [], 'the report and the Needs your note checklist');
  const split = splitChecklist(`${NOTE_REPORT}\n\n${NOTE_LIST.join('\n')}`);
  assert.equal(split.report, NOTE_REPORT);
  assert.deepEqual([split.checklist, split.problems], [NOTE_LIST, []]);
  assert.ok(has(grade({ final: `${NOTE_REPORT}\n\n${[...NOTE_LIST, '6. Check the Agent disagreed view.'].join('\n')}` }).problems, 'the checklist has 6 lines; the limit is 5'));
  assert.ok(has(grade({ final: `${NOTE_REPORT}\n\n${NOTE_LIST.join('\n')}\n\n${LIST.join('\n')}` }).problems, 'more than one part follows the Next line'));
  assert.ok(has(grade({ final: `${NOTE_REPORT}\n\n${NOTE_LIST.join('\n')}`.replace('Rule should change and a full stop', 'Rule should change and a full stop (see runs/20261021T092138Z)') }).problems, 'checklist line 4'), 'the word rules hold for this checklist too');
});

// the report that asks the editor to reject a rule change that rests on a decision they now call the agent's slip (decision 79), and the checklist "Approve in Lessons waiting", Demo form, that covers it
const RECANTED_REPORT = [
  'Demo · Distill: read 1 of your decisions; no rule change to draft; the rules the rows point at already have a rule change waiting; the rule change "Known groups count as identified, unknown names do not" rests on a decision you now call the agent\'s slip (practice page Claim tagger practice · 15 Oct 14:22).',
  '',
  '| What | Result |',
  '|---|---|',
  '| Read | 1 decision |',
  '| Point at a rule | none |',
  '| Agent slips | 1 decision |',
  '| Without a note | none |',
  '| Rule change | none |',
  '',
  'Next: reject the rule change "Known groups count as identified, unknown names do not" in Lessons waiting (https://www.notion.so/0123456789abcdef0123456789abcdef?v=fedcba9876543210fedcba9876543210), then type /claim-tagger demo distill again.',
].join('\n');
const RECANTED_LIST = [
  '1. Open Lessons waiting (the link in the Next line): the draft shows Current text and Proposed text side by side.',
  '2. Read both and ask whether the draft says what you meant.',
  '3. If it does, set Status to Approved. If not, write all of rule 3 as you want it in Editor wording, then set Status to Approved: your wording is tested instead of the draft.',
  '4. Approving changes no rule yet; the safety check comes next. If the Next line says the draft rests on a decision you now call the agent\'s slip, set Status to Rejected instead and type /claim-tagger demo distill again.',
  '5. Type /claim-tagger demo promote.',
];

test('the report that asks to reject a recanted rule change passes alone and with the checklist that covers it', () => {
  assert.deepEqual(grade({ final: RECANTED_REPORT }).problems, [], 'the report alone');
  assert.deepEqual(grade({ final: `${RECANTED_REPORT}\n\n${RECANTED_LIST.join('\n')}` }).problems, [], 'and with its checklist');
});

test('pass-with-checklist passes: a report, one blank line, one numbered list of five lines', () => {
  const r = checkTranscript(fixture('pass-with-checklist'), { expectStyle: 'Explanatory' });
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.ok(r.final.endsWith(LIST[4]));
  const c = cap();
  assert.equal(checkMain([fixturePath('pass-with-checklist')], c.io), 0);
  const fail = cap();
  assert.equal(checkMain([fixturePath('fail-two-lists')], fail.io), 1);
  assert.match(fail.out.join('\n'), /after the Next line: more than one part follows the Next line/);
});

test('a final message is the report alone, or the report and then one checklist', () => {
  assert.deepEqual(grade({ final: GOOD }).problems, [], 'the report alone');
  assert.deepEqual(grade({ final: withList() }).problems, [], 'the report and a checklist of five lines');
  for (const n of [1, 2, 3, 4]) assert.deepEqual(grade({ final: withList(LIST.slice(0, n)) }).problems, [], `${n} line(s)`);
  assert.deepEqual(grade({ final: `${withList()}\n` }).problems, [], 'a line end after the list is nothing');
  assert.deepEqual(grade({ final: `${withList().replace(/\n/g, '\r\n')}\r\n` }).problems, [], 'Windows line ends');
  assert.deepEqual(grade({ final: GOOD.replace(SENTENCE, `Demo · ${SENTENCE}`) + '\n\n' + LIST.join('\n') }).problems, [], 'a demo report too');
  assert.deepEqual(grade({ final: withList(['1) Open Your queue.', '2) Fill in Verified tags.']) }).problems, [], 'a bracket after the number is a numbered list too');
  assert.equal(MAX_CHECKLIST_LINES, 5);
});

test('splitChecklist: the report and the lines of the checklist, or why what follows the Next line is not one', () => {
  const ok = splitChecklist(withList());
  assert.equal(ok.report, GOOD);
  assert.deepEqual([ok.checklist, ok.problems], [LIST, []]);
  assert.deepEqual(splitChecklist(GOOD), { report: GOOD, checklist: null, problems: [] });
  assert.deepEqual(splitChecklist(`${GOOD}\n\n\n`), { report: GOOD, checklist: null, problems: [] }, 'blank lines after the Next line are not a checklist');
  const bad = splitChecklist(withList([...LIST, '6. Check Needs your note.']));
  assert.equal(bad.checklist, null);
  assert.equal(bad.report, withList([...LIST, '6. Check Needs your note.']), 'then the report is the whole text, so the report lint sees the extra lines');
  assert.match(bad.problems[0], /the checklist has 6 lines; the limit is 5/);
  assert.equal(splitChecklist('no report at all').checklist, null);
});

test('after the Next line only one numbered list of at most five lines may follow, after one blank line', () => {
  const cases = [
    [withList([...LIST, '6. Check Needs your note.']), ['the checklist has 6 lines; the limit is 5']],
    [withList(LIST, '\n'), ['text follows the Next line without a blank line']],
    [withList(LIST, '\n\n\n'), ['more than one blank line between the Next line and the checklist']],
    [withList(['## What to do', ...LIST.slice(0, 2)]), ['not a checklist', 'heading']],
    [`${withList()}\n\nHappy deciding.`, ['more than one part follows the Next line']],
    [`${withList()}\n\n1. Open Lessons waiting (the link in the Next line).\n2. Read both.`, ['more than one part follows the Next line']],
    [withList(['Open Your queue first.', ...LIST.slice(1, 3)]), ['what follows the Next line is not a checklist']],
    [withList(['- Open Your queue.', '- Fill in Verified tags.']), ['what follows the Next line is not a checklist']],
    [withList(['2. Open Your queue.', '3. Fill in Verified tags.']), ['what follows the Next line is not a checklist']],
    [withList([LIST[0], '   and then the rest of the first line', LIST[1]]), ['what follows the Next line is not a checklist']],
    [withList([LIST[0], `${LIST[1]} Then wait.`, '', 'Thanks.']), ['more than one part follows the Next line']],
    [`${GOOD}\n\nThe queue has 12 rows.`, ['what follows the Next line is not a checklist']],
    [`${GOOD}\nThe queue has 12 rows.`, ['text follows the Next line without a blank line']],
  ];
  for (const [final, expected] of cases) {
    const r = grade({ final });
    assert.equal(r.ok, false, final);
    for (const text of expected) assert.ok(has(r.problems, text), `expected "${text}" in:\n${r.problems.join('\n')}\nfor:\n${final}`);
  }
});

test('the report part has to pass on its own, and a checklist does not excuse it', () => {
  assert.ok(has(grade({ final: `${withTable(['| a | b |', '| a | b |', '| a | b |', '| a | b |', '| a | b |', '| a | b |'], '| What | Result |')}\n\n${LIST.join('\n')}` }).problems, '6 body rows'));
  assert.ok(has(grade({ final: `${GOOD.replace(NEXT, '')}\n${LIST.join('\n')}` }).problems, 'no line starts with "Next:"'));
  assert.ok(has(grade({ final: `${GOOD.replace(SENTENCE, 'Status: done. Twelve rows wait.')}\n\n${LIST.join('\n')}` }).problems, 'more than one sentence'));
  assert.ok(has(grade({ final: `${[SENTENCE, '', '1. one', '2. two', '', NEXT].join('\n')}\n\n${LIST.join('\n')}` }).problems, 'not a Markdown table'), 'a list between the sentence and the Next line is still a fourth thing');
  assert.ok(has(grade({ final: `${GOOD}\n\n${LIST.join('\n')}\n\nNext: and then this.` }).problems, 'lines start with "Next:"'));
  assert.ok(has(grade({ final: `${LIST.join('\n')}\n\n${GOOD}` }).problems, 'does not start with a sentence') || has(grade({ final: `${LIST.join('\n')}\n\n${GOOD}` }).problems, 'not a sentence'), 'a list before the report');
});

test('the word rules of the report lint hold for every line of the checklist', () => {
  const rules = [
    ['2. Read the files under runs/ for the details.', 'checklist line 2 names a run folder'],
    ['2. Open the script setup.mjs and read it.', 'checklist line 2 names a script file'],
    ['2. Look in C:/work/notes for the page.', 'checklist line 2 holds a file path'],
    ['2. Look in agents\\claim-tagger-mvp for the page.', 'checklist line 2 holds a file path'],
    ['2. The run 20261021T092138Z is the one to open.', 'checklist line 2 holds a run id'],
    ['2. Allow a few minutes before you type the command.', 'checklist line 2 holds a duration word: "minutes"'],
    ['2. This takes about 30 seconds.', 'checklist line 2 holds a duration word: "seconds"'],
    ['2. The run costs $0.40.', 'checklist line 2 holds a dollar sign'],
    ['2. Fill in {Verified tags} first.', 'checklist line 2 holds a JSON brace'],
    ['2. See rule D-3 for the reason.', 'checklist line 2 holds the shorthand code D-3'],
    ['2. Open the rubric and read it.', 'checklist line 2 says "rubric"'],
    ['2. Open the database and read it.', 'checklist line 2 says "database"'],
  ];
  for (const [line, expected] of rules) {
    const r = grade({ final: withList([LIST[0], line]) });
    assert.equal(r.ok, false, line);
    assert.ok(has(r.problems, expected), `expected "${expected}" in:\n${r.problems.join('\n')}`);
    assert.equal(r.problems.length, 1, `${line}: one problem, not several\n${r.problems.join('\n')}`);
  }
  assert.deepEqual(grade({ final: withList([LIST[0], '2. The claim "costs $2.87 million in two weeks" reads on its own.']) }).problems, [], 'quoted claim text is exempt');
  assert.ok(has(grade({ final: withList([LIST[0], '2. ★ Insight ─────']) }).problems, 'Insight'));
  assert.ok(has(grade({ final: withList([LIST[0], '2. The run took 3 dollars.']) }).problems, 'money in words'));
  assert.ok(has(grade({ final: withList([LIST[0], '2. Use [1, 2] as the values.']) }).problems, 'JSON array'));
});

test('a fenced code block in the checklist is refused', () => {
  const r = grade({ final: withList(['1. Type this:', '```', '/claim-tagger distill', '```']) });
  assert.equal(r.ok, false);
  assert.ok(has(r.problems, 'fenced code block'));
});

test('the checklists of the skill\'s guide (references/guide.md) pass the checker after a report', () => {
  const guide = readFileSync(join(REPO, '.claude', 'skills', 'claim-tagger', 'references', 'guide.md'), 'utf8').replace(/\r\n?/g, '\n').split('\n');
  const groups = [];
  let current = null;
  for (const line of guide) {
    if (/^\d+\.\s/.test(line)) (current ??= []).push(line);
    else if (current) {
      groups.push(current);
      current = null;
    }
  }
  if (current) groups.push(current);
  assert.ok(groups.length >= 7, `the guide holds several checklists (found ${groups.length})`);
  for (const group of groups) {
    assert.ok(group.length >= 1 && group.length <= MAX_CHECKLIST_LINES, group[0]);
    assert.deepEqual(grade({ final: withList(group) }).problems, [], group.join('\n'));
  }
});

test('the headless runner passes a run whose final message is a report and a checklist, and keeps the message whole', async () => {
  const dir = tmp();
  const out = join(dir, 'out');
  const r = await headless(['--prompt', '/claim-tagger status', '--out', out, '--claude-bin', FAKE_CLI, '--cwd', REPO], { FAKE_TRANSCRIPT: fixturePath('pass-with-checklist') });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(readFileSync(join(out, 'final-message.md'), 'utf8'), /Next: start at the top of Your queue \(link\)\.\n\n1\. Open Your queue[\s\S]*5\. When your claims are decided, type \/claim-tagger distill\.\n$/);
  assert.deepEqual(readJson(join(out, 'check.json')).problems, []);
  const bad = await headless(['--prompt', '/claim-tagger status', '--out', join(dir, 'bad'), '--claude-bin', FAKE_CLI, '--cwd', REPO], { FAKE_TRANSCRIPT: fixturePath('fail-two-lists') });
  assert.equal(bad.code, 1);
  assert.match(bad.out + bad.err, /more than one part follows the Next line/);
});
