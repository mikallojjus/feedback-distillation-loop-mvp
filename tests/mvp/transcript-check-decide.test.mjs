import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ALLOWED_SCRIPTS, DEFAULT_DECIDE_COLUMNS, checkTranscript, classifyBash, isDecideWrite, loadDecideColumns, loadReviewColumn, main as checkMain,
} from '../../agents/claim-tagger-mvp/scripts/transcript-check.mjs';
import { isDecidePrompt, main as headlessMain } from '../../agents/claim-tagger-mvp/scripts/headless-check.mjs';

// The transcript check in decide mode (decision 115): the connector writes of the step /claim-tagger decide (or demo decide) are not a problem, the same write anywhere else is, and a
// decide transcript that writes another column fails. The CLI is never started except the fake stand-in of the other transcript tests; nothing here reads .env.

const FIXTURES = fileURLToPath(new URL('./fixtures/transcripts/', import.meta.url));
const FAKE_CLI = join(FIXTURES, 'fake-headless-claude.mjs');

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-transcript-decide-'));
  dirs.push(d);
  return d;
};
const has = (problems, text) => problems.some((p) => p.includes(text));

let counter = 0;
const nextId = () => `toolu_d${String(++counter).padStart(4, '0')}`;
const ev = {
  init: () => ({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-sonnet-5-5', output_style: 'Explanatory', claude_code_version: '2.1.296' }),
  text: (t) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] }, parent_tool_use_id: null, session_id: 's1' }),
  tool: (name, input = {}, id = nextId()) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }, parent_tool_use_id: null, session_id: 's1' }),
  result: (t) => ({ type: 'result', subtype: 'success', is_error: false, num_turns: 9, result: t, session_id: 's1' }),
};
const jsonl = (events) => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
const bash = (command) => ev.tool('Bash', { command });
const CONNECTOR = 'mcp__16f81eb6-6eb4-423e-9e64-a5cb678b0953__notion-update-page';
const write = (properties = {}, over = {}) => ev.tool(CONNECTOR, {
  page_id: '0a9e00000000400080000000000000d1', command: 'update_properties', allow_async: false,
  properties: { 'Verified tags': ['0a9e00000000400080000000000000a1'], 'Challenged tags notes': 'Context-dependent: Agent slip. Review status is not mine to guess.', 'Review status': 'Reviewed', ...properties }, ...over,
});

const REPORT = [
  'Decide: 2 claims decided and read back; 1 differs from the agent.',
  '',
  '| What | Result |',
  '|---|---|',
  '| Decided | 2 |',
  '| Same as the agent | 1 |',
  '| Different from the agent | 1, with a note |',
  '',
  'Next: type /claim-tagger distill to read the decisions.',
].join('\n');
const OPEN = `node agents/claim-tagger-mvp/scripts/decide.mjs open --decisions '[{"claim":"c01","verified_tags":["Context-dependent"],"note":"Context-dependent: Agent slip. The Review status is set last."}]'`;

/** The transcript of a decide step: pull, list, open, two connector writes, check, then the report. */
const decideRun = (middle = [write(), write()]) => jsonl([
  ev.init(),
  bash('node agents/claim-tagger-mvp/scripts/pull.mjs --all'),
  bash('node agents/claim-tagger-mvp/scripts/decide.mjs list --claims c01,c02'),
  bash(OPEN),
  ...middle,
  bash('node agents/claim-tagger-mvp/scripts/decide.mjs check'),
  ev.text(REPORT),
  ev.result(REPORT),
]);

test('a decide transcript with the three-column writes passes in decide mode', () => {
  const r = checkTranscript(decideRun(), { decide: true });
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.equal(r.stats.notion_writes, 2, 'the writes are still counted');
  assert.equal(r.stats.bash_calls, 4);
});

test('the same transcript is a failure in any other mode: the writes and the column names are named', () => {
  const r = checkTranscript(decideRun(), {});
  assert.equal(r.ok, false);
  assert.ok(has(r.problems, 'writes to Notion through the connector'));
  assert.ok(has(r.problems, 'names the editor column "Verified tags"'));
  assert.ok(has(r.problems, 'names the editor column "Review status"'));
  // and the call of decide.mjs open, whose JSON names the columns, is a problem outside a decide step too
  const onlyOpen = checkTranscript(jsonl([ev.init(), bash(OPEN), ev.text(REPORT), ev.result(REPORT)]), {});
  assert.ok(has(onlyOpen.problems, 'names the editor column "Verified tags"'), 'verified_tags is the column spelled with an underscore');
  assert.equal(onlyOpen.problems.length >= 1, true);
});

test('a status transcript with the same connector write fails, whatever the mode of the others', () => {
  const text = jsonl([ev.init(), bash('node agents/claim-tagger-mvp/scripts/status.mjs'), write(), ev.text(REPORT), ev.result(REPORT)]);
  const r = checkTranscript(text, { decide: false });
  assert.equal(r.ok, false);
  assert.ok(has(r.problems, 'writes to Notion through the connector'));
  assert.ok(has(r.problems, 'names the editor column'));
  // the step is the prompt's, not the transcript's: with decide off, nothing in the events turns it on
  assert.equal(checkTranscript(text, {}).ok, false);
});

test('a decide transcript that writes another column, another command or another field still fails', () => {
  for (const [name, middle, expected] of [
    ['an agent column next to the decision', [write({ 'Agent tags': [] })], 'writes to Notion through the connector'],
    ['an agent column only', [write({ 'Agent status': 'Done' })], 'writes to Notion through the connector'],
    ['Editor wording', [ev.tool(CONNECTOR, { page_id: 'p', command: 'update_properties', properties: { 'Editor wording': 'x' } })], 'names the editor column "Editor wording"'],
    ['Paused', [ev.tool(CONNECTOR, { page_id: 'p', command: 'update_properties', properties: { Paused: '__YES__' } })], 'names the editor column "Paused"'],
    ['a rule change Status Approved', [ev.tool(CONNECTOR, { page_id: 'p', command: 'update_properties', properties: { Status: 'Approved' } })], 'writes to Notion through the connector'],
    ['Review status with another value', [write({ 'Review status': 'Approved' })], 'writes to Notion through the connector'],
    ['a content command', [ev.tool(CONNECTOR, { page_id: 'p', command: 'replace_content', new_str: 'x' })], 'writes to Notion through the connector'],
    ['an icon', [write({}, { icon: '🚀' })], 'writes to Notion through the connector'],
    ['a cover', [write({}, { cover: 'none' })], 'writes to Notion through the connector'],
    ['a created page', [ev.tool('mcp__x__notion-create-pages', { parent: { page_id: 'p' }, pages: [{ properties: { 'Verified tags': [] } }] })], 'writes to Notion through the connector'],
    ['a deleted page', [ev.tool('mcp__x__notion-delete-pages', { page_ids: ['p'] })], 'writes to Notion through the connector'],
    ['a column written by a script file', [ev.tool('Write', { file_path: 'plan.json', content: '{"Verified tags":[]}' })], 'names the editor column "Verified tags"'],
    ['a column in a script other than decide.mjs', [bash('node agents/claim-tagger-mvp/scripts/status.mjs --note "Review status"')], 'names the editor column "Review status"'],
  ]) {
    const r = checkTranscript(decideRun(middle), { decide: true });
    assert.equal(r.ok, false, name);
    assert.ok(has(r.problems, expected), `${name}: ${r.problems.join(' | ')}`);
  }
});

test('decide mode does not widen the other rules: the report, the script list and the forbidden words still apply', () => {
  const bad = jsonl([ev.init(), bash('node agents/claim-tagger-mvp/scripts/decide.mjs check; echo done'), ev.text('Done.'), ev.result('Done.')]);
  const r = checkTranscript(bad, { decide: true });
  assert.equal(r.ok, false);
  assert.ok(has(r.problems, 'chains several commands'));
  assert.ok(has(r.problems, 'final message'));
  assert.ok(has(checkTranscript(jsonl([ev.init(), bash('node agents/claim-tagger-mvp/scripts/setup.mjs'), ev.text(REPORT), ev.result(REPORT)]), { decide: true }).problems, 'not in the allowed list'));
  assert.ok(DEFAULT_ALLOWED_SCRIPTS.includes('decide'), 'decide.mjs joins the scripts the check allows');
  for (const c of ['node agents/claim-tagger-mvp/scripts/decide.mjs list', 'node agents/claim-tagger-mvp/scripts/decide.mjs check', OPEN,
    'node agents/claim-tagger-mvp/scripts/walkthrough.mjs run decide check', 'node agents/claim-tagger-mvp/scripts/walkthrough.mjs run --demo practice-1 decide list']) {
    assert.deepEqual(classifyBash(c), { ok: true }, c);
  }
});

test('a demo decide transcript passes in decide mode: the commands go through the walkthrough runner', () => {
  const W = 'node agents/claim-tagger-mvp/scripts/walkthrough.mjs run';
  const demo = jsonl([
    ev.init(), bash(`${W} pull --all`), bash(`${W} decide list`),
    bash(`${W} decide open --decisions '[{"claim":"c01","verified_tags":["Context-dependent"],"note":""}]'`), write(),
    bash(`${W} decide check`), ev.text(`Demo · ${REPORT.replace('Next: type /claim-tagger distill', 'Next: type /claim-tagger demo distill')}`), ev.result(REPORT),
  ]);
  const r = checkTranscript(demo, { decide: true });
  assert.deepEqual(r.problems, []);
  // the walkthrough runner for another script gets no such leave
  const other = jsonl([ev.init(), bash(`${W} status --note "Review status"`), ev.text(REPORT), ev.result(REPORT)]);
  assert.ok(has(checkTranscript(other, { decide: true }).problems, 'names the editor column "Review status"'));
});

test('isDecideWrite: the shape of a decision write, in the columns it is given', () => {
  const tool = (input, name = CONNECTOR) => ({ name, input });
  const base = { page_id: 'p', command: 'update_properties', properties: { 'Review status': 'Reviewed' } };
  assert.equal(isDecideWrite(tool(base)), true);
  assert.equal(isDecideWrite(tool({ ...base, allow_async: true })), true);
  assert.equal(isDecideWrite(tool(base, 'mcp__claude_ai_notion__notion-update-page')), true, 'under any server prefix');
  assert.equal(isDecideWrite(tool({ ...base, properties: { 'Review status': 'To review', 'Verified tags': [] } })), true);
  for (const input of [{ ...base, command: 'insert_content' }, { ...base, icon: 'x' }, { ...base, allow_async: 'yes' }, { ...base, properties: {} }, { ...base, properties: null }, { ...base, properties: { 'Agent tags': [] } },
    { ...base, properties: { 'Review status': 'Approved' } }, { page_id: 'p', command: 'update_properties' }]) {
    assert.equal(isDecideWrite(tool(input)), false, JSON.stringify(input));
  }
  assert.equal(isDecideWrite(tool(base, 'mcp__x__notion-create-pages')), false);
  assert.equal(isDecideWrite(tool(base, 'Bash')), false);
  assert.equal(isDecideWrite(tool({ ...base, properties: { Mine: 'x' } }), ['Mine']), true, 'the columns come from the config');
  assert.deepEqual([...DEFAULT_DECIDE_COLUMNS], ['Verified tags', 'Review status', 'Challenged tags notes']);
});

test('loadDecideColumns reads editor_columns.claims of the config, and the default list when it cannot', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ editor_columns: { claims: ['A', 'B'], agent_settings: ['Paused'] } }));
  assert.deepEqual(loadDecideColumns(dir), ['A', 'B']);
  assert.deepEqual(loadDecideColumns(join(dir, 'nowhere')), ['Verified tags', 'Review status', 'Challenged tags notes']);
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ editor_columns: {} }));
  assert.deepEqual(loadDecideColumns(dir), ['Verified tags', 'Review status', 'Challenged tags notes']);
  assert.deepEqual(loadDecideColumns(), ['Verified tags', 'Review status', 'Challenged tags notes'], 'the shipped config lists the same three');
});

test('the command line takes --decide', () => {
  const dir = tmp();
  const file = join(dir, 'decide.jsonl');
  writeFileSync(file, decideRun());
  const run = (argv) => {
    const out = [];
    const err = [];
    const code = checkMain(argv, { out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const plain = run([file]);
  assert.equal(plain.code, 1);
  assert.match(plain.out, /writes to Notion through the connector/);
  const decide = run([file, '--decide']);
  assert.equal(decide.code, 0, decide.out);
  assert.match(decide.out, /no problems/);
  assert.match(run(['--help']).out || run(['--help']).err, /\[--decide\]|usage/);
});

test('S7: a decide transcript whose note carries an apostrophe written as \\u0027 followed by a semicolon passes: the whole command is one script call', () => {
  const open = `node agents/claim-tagger-mvp/scripts/decide.mjs open --decisions '[{"claim":"c01","verified_tags":["Context-dependent"],"note":"Context-dependent: Agent slip. It\\u0027s settled; the title names it."}]'`;
  assert.ok(open.includes('\\u0027s settled;'), 'the command holds the escape, not a quote');
  assert.deepEqual(classifyBash(open), { ok: true });
  const text = jsonl([ev.init(), bash('node agents/claim-tagger-mvp/scripts/pull.mjs --all'), bash(open), write(), bash('node agents/claim-tagger-mvp/scripts/decide.mjs check'), ev.text(REPORT), ev.result(REPORT)]);
  const r = checkTranscript(text, { decide: true });
  assert.deepEqual(r.problems, []);
  // the old way of writing an apostrophe, closing the quote and opening it again, is a command the check refuses to read as one call when it carries a semicolon
  const quoted = open.replace('\\u0027', "'\\''");
  assert.equal(classifyBash(quoted).ok, false, 'the \'\\\'\' form is not accepted when the note has a semicolon');
});

test('the Review status column is the one the config names, not a hard-coded string', () => {
  const tool = (properties) => ({ name: CONNECTOR, input: { page_id: 'p', command: 'update_properties', properties } });
  const columns = ['Verdict', 'Marks', 'Words'];
  assert.equal(isDecideWrite(tool({ Marks: 'Reviewed', Verdict: [] }), columns, 'Marks'), true);
  assert.equal(isDecideWrite(tool({ Marks: 'Approved' }), columns, 'Marks'), false, 'the named column is held to Reviewed or To review');
  assert.equal(isDecideWrite(tool({ Marks: 'Approved' }), columns), true, 'with the default name, Marks is not the Review status column and is free text here');
  assert.equal(isDecideWrite(tool({ 'Review status': 'Approved' }), ['Review status', 'Verified tags']), false, 'the default still holds');
  const dir = tmp();
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ notion: { claims: { columns: { review_status: 'Marks' } } } }));
  assert.equal(loadReviewColumn(dir), 'Marks');
  assert.equal(loadReviewColumn(join(dir, 'nowhere')), 'Review status');
  assert.equal(loadReviewColumn(), 'Review status', 'the shipped config names Review status');
  // through the whole check
  const custom = jsonl([ev.init(), bash('node agents/claim-tagger-mvp/scripts/decide.mjs list'), ev.tool(CONNECTOR, { page_id: 'p', command: 'update_properties', properties: { Marks: 'Approved' } }), ev.text(REPORT), ev.result(REPORT)]);
  assert.equal(checkTranscript(custom, { decide: true, decideColumns: columns, reviewColumn: 'Marks' }).ok, false);
  const fine = jsonl([ev.init(), bash('node agents/claim-tagger-mvp/scripts/decide.mjs list'), ev.tool(CONNECTOR, { page_id: 'p', command: 'update_properties', properties: { Marks: 'Reviewed' } }), ev.text(REPORT), ev.result(REPORT)]);
  assert.deepEqual(checkTranscript(fine, { decide: true, decideColumns: columns, reviewColumn: 'Marks' }).problems, []);
});

// ---- the runner sets the mode from the prompt -------------------------------------------------------------------------------------------

test('isDecidePrompt: only /claim-tagger decide and /claim-tagger demo decide', () => {
  for (const p of ['/claim-tagger decide', '/claim-tagger decide the first 6', '/claim-tagger demo decide', '  /claim-tagger  demo   decide claim 2  ', '/CLAIM-TAGGER decide']) assert.equal(isDecidePrompt(p), true, p);
  for (const p of ['/claim-tagger status', '/claim-tagger decided', '/claim-tagger demo status', 'decide', 'please /claim-tagger decide', '/claim-tagger tag decide', '/claim-tagger distill', '', undefined, null]) assert.equal(isDecidePrompt(p), false, String(p));
});

test('the headless runner grades a decide prompt in decide mode and any other prompt in the strict mode', async () => {
  const dir = tmp();
  const transcript = join(dir, 'decide.jsonl');
  writeFileSync(transcript, decideRun());
  const run = async (prompt, name) => {
    const out = join(dir, name);
    const lines = [];
    const code = await headlessMain(['--prompt', prompt, '--out', out, '--claude-bin', FAKE_CLI], { out: (s) => lines.push(s), err: (s) => lines.push(s) }, { processEnv: { ...process.env, FAKE_TRANSCRIPT: transcript } });
    return { code, lines: lines.join('\n'), check: JSON.parse(readFileSync(join(out, 'check.json'), 'utf8')) };
  };
  const decide = await run('/claim-tagger decide the first 2', 'decide');
  assert.equal(decide.code, 0, decide.lines);
  assert.deepEqual(decide.check.problems, []);
  assert.equal(decide.check.stats.notion_writes, 2);
  const demo = await run('/claim-tagger demo decide', 'demo');
  assert.equal(demo.code, 0, demo.lines);
  const status = await run('/claim-tagger status', 'status');
  assert.equal(status.code, 1);
  assert.ok(status.check.problems.some((p) => p.includes('writes to Notion through the connector')), status.check.problems.join(' | '));
});
