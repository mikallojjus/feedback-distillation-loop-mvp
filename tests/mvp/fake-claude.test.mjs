import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractJson, runClaude, usageResetHint } from '../../agents/claim-tagger-mvp/scripts/lib/claude.mjs';
import { FAKE_CLI_VERSION, fallbackAnswer, parseClaims, parseRows, parseTags, readingAnswer, runFake } from './fixtures/fake-claude.mjs';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const MODEL = 'claude-sonnet-5-5';

const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-fake-'));
  roots.push(dir);
  return dir;
}

const SYSTEM = [
  '# The tags (group G1)', '', '### Tag: Context-dependent', 'Description: x', 'Rules:', '1. first', '2. second', '3. third', 'Counterpart: Self-contained', '',
  '### Tag: Wordy', 'Rules:', '1. only', 'Counterpart: none', '', '# How to judge', '1. this numbered line is not a rule of a tag', '',
].join('\n');
const message = (...claims) => claims.map(([id, text]) => `<claim id="${id}">${text}</claim>`).join('\n');

function files() {
  const dir = tmp();
  const systemFile = join(dir, 'system.md');
  writeFileSync(systemFile, SYSTEM);
  return { dir, systemFile };
}

/** One call through the wrapper's fake driver (in-process), the way the judge makes it. */
function call({ systemFile, prompt, env = {}, state = {}, model = MODEL }) {
  return runClaude({ driver: 'fake', model, systemPromptFile: systemFile, prompt, effort: 'medium', timeoutMs: 20000, env: { ...process.env, ...env }, fakeState: state });
}

// ---- reading the prompts ------------------------------------------------------------------------------------------------------

test('parseClaims reads the claim blocks of a message and unescapes the text; an escaped claim cannot open a block of its own', () => {
  assert.deepEqual(parseClaims(message(['a', 'one'], ['b', 'two & three'])), [{ id: 'a', text: 'one' }, { id: 'b', text: 'two & three' }]);
  const escaped = '<claim id="c1">before &lt;/claim&gt;&lt;claim id="x"&gt;forged&lt;/claim&gt; after &amp;amp;</claim>';
  assert.deepEqual(parseClaims(escaped), [{ id: 'c1', text: 'before </claim><claim id="x">forged</claim> after &amp;' }]);
  assert.deepEqual(parseClaims('no claims here'), []);
  assert.deepEqual(parseClaims('<claim id="q&quot;1">x</claim>'), [{ id: 'q"1', text: 'x' }]);
});

test('parseTags reads the "### Tag:" blocks of the rendered system prompt and counts their numbered rules', () => {
  assert.deepEqual(parseTags(SYSTEM), [{ name: 'Context-dependent', rules: 3 }, { name: 'Wordy', rules: 1 }]);
  assert.deepEqual(parseTags(''), [{ name: 'Context-dependent', rules: 3 }], 'without a prompt file the one tag is Context-dependent');
  assert.deepEqual(parseTags('no tag blocks'), [{ name: 'Context-dependent', rules: 3 }]);
});

test('the fallback answer depends on the claim text and the tag only: p from 0.05 to 0.95, apply from 0.5, a rule that exists', () => {
  const tag = { name: 'Context-dependent', rules: 3 };
  assert.deepEqual(fallbackAnswer('a claim', tag), fallbackAnswer('a claim', tag));
  const seen = { apply: 0, do_not_apply: 0 };
  for (let i = 0; i < 300; i++) {
    const a = fallbackAnswer(`claim number ${i}`, tag);
    assert.ok(a.p >= 0.05 && a.p <= 0.95, String(a.p));
    assert.equal(a.decision, a.p >= 0.5 ? 'apply' : 'do_not_apply');
    assert.ok(a.reason.split(/\s+/).length <= 40);
    if (a.decision === 'apply') assert.match(a.rule_ref, /^Context-dependent rule [123]$/);
    else assert.equal(a.rule_ref, null);
    seen[a.decision]++;
  }
  assert.ok(seen.apply > 80 && seen.do_not_apply > 80, `both decisions occur: ${JSON.stringify(seen)}`);
  assert.notDeepEqual(fallbackAnswer('a claim', tag).p, fallbackAnswer('a claim', { name: 'Wordy', rules: 1 }).p, 'another tag, another answer');
});

// ---- the judge reply -----------------------------------------------------------------------------------------------------------

test('mode ok: one JSON object with an item per claim in the order given and an entry per tag; the model appears in modelUsage', async () => {
  const { systemFile } = files();
  const r = await call({ systemFile, prompt: message(['z', 'Zebra claim'], ['a', 'Apple claim']) });
  assert.equal(r.ok, true, r.message);
  const reply = extractJson(r.text);
  assert.deepEqual(reply.items.map((i) => i.id), ['z', 'a']);
  for (const item of reply.items) {
    assert.deepEqual(item.tags.map((t) => t.name), ['Context-dependent', 'Wordy']);
    for (const t of item.tags) {
      assert.deepEqual(Object.keys(t).sort(), ['decision', 'name', 'p', 'reason', 'rule_ref']);
      assert.ok(['apply', 'do_not_apply'].includes(t.decision));
    }
  }
  assert.deepEqual(Object.keys(r.modelUsage), [MODEL]);
  assert.ok(r.modelUsage[MODEL].inputTokens > 0 && r.modelUsage[MODEL].outputTokens > 0);
});

test('the same call twice gives the same answer, and a claim in two batches gets the same answer in both', async () => {
  const { systemFile } = files();
  const a = await call({ systemFile, prompt: message(['x', 'The same claim.'], ['y', 'Another one.']) });
  const b = await call({ systemFile, prompt: message(['y', 'Another one.']) });
  assert.deepEqual(extractJson(b.text).items[0], extractJson(a.text).items[1]);
});

test('the fixture table answers by exact claim text; a list of answers is read in turn, the last one repeating', async () => {
  const { dir, systemFile } = files();
  const table = join(dir, 'table.json');
  writeFileSync(table, JSON.stringify({
    'Sure one': { decision: 'apply', p: 0.93, rule_ref: 'Context-dependent rule 2', reason: 'Because \'sure\'.' },
    'No rule given': { decision: 'do_not_apply', p: 0.1 },
    'Explicit null': { decision: 'apply', p: 0.8, rule_ref: null },
    'Flips': [{ decision: 'do_not_apply', p: 0.45 }, { decision: 'apply', p: 0.55 }],
  }));
  const state = {};
  const env = { FAKE_CLAUDE_TABLE: table };
  const prompt = message(['1', 'Sure one'], ['2', 'No rule given'], ['3', 'Explicit null'], ['4', 'Flips'], ['5', 'Not in the table']);
  const first = extractJson((await call({ systemFile, prompt, env, state })).text).items;
  const tag = (item, n = 0) => item.tags[n];
  assert.deepEqual(tag(first[0]), { name: 'Context-dependent', decision: 'apply', p: 0.93, rule_ref: 'Context-dependent rule 2', reason: 'Because \'sure\'.' });
  assert.deepEqual(tag(first[0], 1).name, 'Wordy', 'an entry answers for every tag of the prompt');
  assert.equal(tag(first[1]).rule_ref, null, 'no rule_ref and not apply: null');
  assert.equal(tag(first[1]).reason, 'Fake table: do_not_apply for Context-dependent.');
  assert.equal(tag(first[2]).rule_ref, null, 'an explicit null stays null');
  assert.equal(tag(first[3]).rule_ref, null);
  assert.deepEqual([tag(first[3]).decision, tag(first[3]).p], ['do_not_apply', 0.45]);
  assert.deepEqual(tag(first[4]), fallbackAnswer('Not in the table', { name: 'Context-dependent', rules: 3 }), 'a claim that is not in the table gets the hash answer');
  const second = extractJson((await call({ systemFile, prompt, env, state })).text).items;
  assert.deepEqual([tag(second[3]).decision, tag(second[3]).p], ['apply', 0.55], 'the second time this claim is answered, the second entry');
  const third = extractJson((await call({ systemFile, prompt, env, state })).text).items;
  assert.deepEqual([tag(third[3]).decision, tag(third[3]).p], ['apply', 0.55], 'the last entry repeats');
  assert.deepEqual(tag(third[0]), tag(first[0]), 'a single entry answers the same every time');
});

// ---- the modes -----------------------------------------------------------------------------------------------------------------

test('invalid-once: the first call answers in words, every later call is ok; the counter file makes that last across processes', async () => {
  const { dir, systemFile } = files();
  const stateFile = join(dir, 'state.json');
  const env = { FAKE_CLAUDE_MODE: 'invalid-once', FAKE_CLAUDE_STATE: stateFile };
  const prompt = message(['a', 'A claim']);
  const first = await call({ systemFile, prompt, env });
  assert.equal(first.ok, true, 'the envelope is fine; it is the answer that is not JSON');
  assert.throws(() => extractJson(first.text), /no JSON/);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).calls, 1);
  const second = await call({ systemFile, prompt, env }); // a different state object, as in another process: only the file remembers
  assert.deepEqual(extractJson(second.text).items.map((i) => i.id), ['a']);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).calls, 2);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).reads['A claim'], 1, 'a garbled answer is not a read of the claim');
});

test('invalid-always answers in words every time, after FAKE_CLAUDE_AFTER good calls', async () => {
  const { systemFile } = files();
  const state = {};
  const env = { FAKE_CLAUDE_MODE: 'invalid-always', FAKE_CLAUDE_AFTER: '1' };
  const prompt = message(['a', 'A claim']);
  assert.ok(extractJson((await call({ systemFile, prompt, env, state })).text).items, 'the first call is within FAKE_CLAUDE_AFTER');
  for (let i = 0; i < 3; i++) {
    const r = await call({ systemFile, prompt, env, state });
    assert.equal(r.ok, true, 'the envelope is fine every time');
    assert.throws(() => extractJson(r.text), /no JSON/);
  }
  assert.equal(state.calls, 4);
});

test('transient-once prints an overloaded error and exits 1 once; the wrapper calls it transient, and the next call is ok', async () => {
  const { systemFile } = files();
  const state = {};
  const env = { FAKE_CLAUDE_MODE: 'transient-once' };
  const prompt = message(['a', 'A claim']);
  const first = await call({ systemFile, prompt, env, state });
  assert.equal(first.ok, false);
  assert.equal(first.errorKind, 'transient');
  assert.equal(first.exitCode, 1);
  assert.match(first.message, /overloaded/i);
  const second = await call({ systemFile, prompt, env, state });
  assert.equal(second.ok, true);
});

test('transient-always fails every call as transient, never as the usage window', async () => {
  const { systemFile } = files();
  const state = {};
  const env = { FAKE_CLAUDE_MODE: 'transient-always' };
  for (let i = 0; i < 4; i++) assert.equal((await call({ systemFile, prompt: message(['a', 'x']), env, state })).errorKind, 'transient');
});

test('usage-window prints the CLI\'s limit wording: the wrapper calls it usage_window and can read when it resets', async () => {
  const { systemFile } = files();
  const state = {};
  const env = { FAKE_CLAUDE_MODE: 'usage-window' };
  const r = await call({ systemFile, prompt: message(['a', 'x']), env, state });
  assert.equal(r.ok, false);
  assert.equal(r.errorKind, 'usage_window');
  assert.match(r.message, /usage limit reached/);
  assert.match(usageResetHint(r.message), /resets at 3pm/);
  assert.equal((await call({ systemFile, prompt: message(['a', 'x']), env, state })).errorKind, 'usage_window', 'and again');
});

test('FAKE_CLAUDE_AFTER lets the first calls succeed before a failing mode starts', async () => {
  const { systemFile } = files();
  const state = {};
  const env = { FAKE_CLAUDE_MODE: 'usage-window', FAKE_CLAUDE_AFTER: '2' };
  const kinds = [];
  for (let i = 0; i < 4; i++) kinds.push((await call({ systemFile, prompt: message(['a', 'x']), env, state })).errorKind);
  assert.deepEqual(kinds, [null, null, 'usage_window', 'usage_window']);
});

test('wrong-model answers validly but names another model, which the wrapper reports as model_mismatch', async () => {
  const { systemFile } = files();
  const r = await call({ systemFile, prompt: message(['a', 'x']), env: { FAKE_CLAUDE_MODE: 'wrong-model' } });
  assert.equal(r.ok, false);
  assert.equal(r.errorKind, 'model_mismatch');
  assert.match(r.message, /claude-sonnet-5-5/);
  assert.ok(!Object.keys(r.modelUsage).includes(MODEL));
});

// ---- the other prompts, the usage, the logs ------------------------------------------------------------------------------------

test('a prompt with "# Distill" gets a fixed lesson and one with "# Wording" gets one sentence, from the system prompt or the message', async () => {
  const dir = tmp();
  const distillFile = join(dir, 'distill.md');
  writeFileSync(distillFile, '# Distill\n\nRead the rows and propose a lesson.\n');
  const viaFile = await call({ systemFile: distillFile, prompt: 'rows' });
  const lesson = extractJson(viaFile.text);
  assert.equal(lesson.patterns.length, 1);
  assert.deepEqual(Object.keys(lesson.patterns[0]).sort(), ['keys', 'kind', 'lesson', 'proposed_text', 'rule']);
  assert.deepEqual(lesson.patterns[0].keys, []);
  const viaMessage = await call({ systemFile: join(dir, 'missing.md'), prompt: '# Distill\n\nrows' });
  assert.deepEqual(extractJson(viaMessage.text), lesson);

  const wording = extractJson((await call({ systemFile: join(dir, 'missing.md'), prompt: '# Wording\n\nThe claim was...' })).text);
  assert.deepEqual(Object.keys(wording), ['sentence']);
  assert.equal(typeof wording.sentence, 'string');
  assert.ok(!/\n/.test(wording.sentence));
  const judge = extractJson((await call({ systemFile: files().systemFile, prompt: message(['a', 'x']) })).text);
  assert.ok(judge.items, 'a judge prompt is not mistaken for either');
});

// ---- the reading prompt ---------------------------------------------------------------------------------------------------------

const READING_MESSAGE = [
  '<tag name="Context-dependent">', 'Rules:', '1. one', '</tag>', '<rows>',
  '<row key="c1::Context-dependent" tag="Context-dependent" outcome="Does not apply" proposal="Applies" confidence="0.8">', '<claim>A claim &amp; more</claim>',
  '<agent_reason>It names no one. · Context-dependent rule 2 · 2 of 2 runs agree</agent_reason>', '<note none="true"/>', '</row>',
  '<row key="c2::Context-dependent" tag="Context-dependent" outcome="Applies" proposal="Can&apos;t tell" confidence="0.5">', '<claim>Another</claim>',
  '<agent_reason>Unsure.</agent_reason>', '<note>Words.</note>', '</row>', '</rows>',
].join('\n');

function readingFile() {
  const dir = tmp();
  const file = join(dir, 'reading.md');
  writeFileSync(file, '# Reading\n\nYou read disagreements.\n');
  return { dir, file };
}

test('parseRows reads the rows of a reading message (key, tag, the agent\'s reason, unescaped); the rows of a distill message are not rows of it', () => {
  assert.deepEqual(parseRows(READING_MESSAGE), [
    { key: 'c1::Context-dependent', tag: 'Context-dependent', agentReason: 'It names no one. · Context-dependent rule 2 · 2 of 2 runs agree' },
    { key: 'c2::Context-dependent', tag: 'Context-dependent', agentReason: 'Unsure.' },
  ]);
  assert.deepEqual(parseRows('<rows>\n<row key="c1::X" outcome="Applies" reading="Rule unclear">\n</row>\n</rows>'), []);
  assert.deepEqual(parseRows('nothing'), []);
});

test('a prompt with "# Reading" gets {"readings": [...]}: one reading per row, Rule unclear on the rule the agent\'s reason cites, null when it cites none', async () => {
  const { file } = readingFile();
  const r = await call({ systemFile: file, prompt: READING_MESSAGE });
  assert.equal(r.ok, true);
  assert.deepEqual(extractJson(r.text), {
    readings: [
      { key: 'c1::Context-dependent', reading: 'Rule unclear', rule: 'Context-dependent rule 2', note: 'The rule leaves this kind of case open.' },
      { key: 'c2::Context-dependent', reading: 'Rule unclear', rule: null, note: 'The rule leaves this kind of case open.' },
    ],
  });
  const viaMessage = await call({ systemFile: join(tmp(), 'missing.md'), prompt: `# Reading\n\n${READING_MESSAGE}` });
  assert.equal(extractJson(viaMessage.text).readings.length, 2, 'the marker may be in the message too');
  assert.equal(readingAnswer({ key: 'k', tag: 'T', agentReason: 'T rule 1 and T rule 4' }).rule, 'T rule 4', 'the last rule the reason cites');
  assert.equal(readingAnswer({ key: 'k', tag: 'T (x)', agentReason: 'T (x) rule 2' }).rule, 'T (x) rule 2', 'a tag name with characters of a pattern');
});

test('FAKE_CLAUDE_READINGS names a file of readings by row key; a key that is not in it gets the default', async () => {
  const { dir, file } = readingFile();
  const table = join(dir, 'readings.json');
  writeFileSync(table, JSON.stringify({ 'c2::Context-dependent': { reading: 'Agent slip', rule: 'Context-dependent rule 1', note: 'Rule 1 settles it.' }, 'zz::Other': { reading: 'Rule unclear' } }));
  const r = await call({ systemFile: file, prompt: READING_MESSAGE, env: { FAKE_CLAUDE_READINGS: table } });
  const { readings } = extractJson(r.text);
  assert.deepEqual(readings[1], { key: 'c2::Context-dependent', reading: 'Agent slip', rule: 'Context-dependent rule 1', note: 'Rule 1 settles it.' });
  assert.equal(readings[0].reading, 'Rule unclear', 'the other row gets the default');
  assert.deepEqual(readingAnswer({ key: 'zz::Other', tag: 'Other', agentReason: '' }, { 'zz::Other': { reading: 'Rule unclear' } }), { key: 'zz::Other', reading: 'Rule unclear', rule: null, note: 'The rule leaves this kind of case open.' }, 'a rule and a note left out are null and the default note');
});

test('the failing modes apply to reading calls too: words instead of JSON, an overloaded error, the usage window', async () => {
  const { file } = readingFile();
  const garbled = await call({ systemFile: file, prompt: READING_MESSAGE, env: { FAKE_CLAUDE_MODE: 'invalid-always' } });
  assert.equal(garbled.ok, true);
  assert.throws(() => extractJson(garbled.text));
  assert.equal((await call({ systemFile: file, prompt: READING_MESSAGE, env: { FAKE_CLAUDE_MODE: 'transient-always' } })).errorKind, 'transient');
  assert.equal((await call({ systemFile: file, prompt: READING_MESSAGE, env: { FAKE_CLAUDE_MODE: 'usage-window' } })).errorKind, 'usage_window');
  assert.equal((await call({ systemFile: file, prompt: READING_MESSAGE, env: { FAKE_CLAUDE_MODE: 'wrong-model' } })).errorKind, 'model_mismatch');
});

test('FAKE_CLAUDE_ONLY limits the failing modes to some kinds of call: the others are answered as in mode ok, and FAKE_CLAUDE_AFTER counts the listed kinds only', async () => {
  const { file } = readingFile();
  const { systemFile } = files();
  const state = {};
  const env = { FAKE_CLAUDE_MODE: 'invalid-always', FAKE_CLAUDE_ONLY: 'reading', FAKE_CLAUDE_AFTER: '1' };
  const answers = [];
  for (const [sys, prompt] of [[systemFile, message(['a', 'x'])], [file, READING_MESSAGE], [systemFile, message(['b', 'y'])], [file, READING_MESSAGE], [file, READING_MESSAGE]]) {
    answers.push(Boolean(tryJson((await call({ systemFile: sys, prompt, env, state })).text)));
  }
  assert.deepEqual(answers, [true, true, true, false, false], 'judge calls are never garbled; the first reading is good, the later ones are words');
  assert.deepEqual(state.log.map((e) => e.kind), ['judge', 'reading', 'judge', 'reading', 'reading']);
  assert.deepEqual(state.log.map((e) => e.mode), ['ok', 'invalid-always', 'ok', 'invalid-always', 'invalid-always'], 'the log shows the mode each call was answered in');
  const both = { FAKE_CLAUDE_MODE: 'usage-window', FAKE_CLAUDE_ONLY: 'distill, reading' };
  assert.equal((await call({ systemFile: file, prompt: READING_MESSAGE, env: both })).errorKind, 'usage_window');
  assert.equal((await call({ systemFile, prompt: message(['a', 'x']), env: both })).errorKind, null);
});

function tryJson(text) {
  try {
    return extractJson(text);
  } catch {
    return null;
  }
}

test('usage numbers: the first call with a system prompt writes it to the cache, the later ones read it', async () => {
  const { systemFile } = files();
  const state = {};
  const prompt = message(['a', 'A claim']);
  const first = (await call({ systemFile, prompt, state })).modelUsage[MODEL];
  const second = (await call({ systemFile, prompt, state })).modelUsage[MODEL];
  assert.ok(first.cacheCreationInputTokens > 0 && first.cacheReadInputTokens === 0);
  assert.ok(second.cacheCreationInputTokens === 0 && second.cacheReadInputTokens === first.cacheCreationInputTokens);
  assert.equal(first.inputTokens, second.inputTokens);
});

test('the call log records what the fake saw: in memory on the state object, and in the file named by FAKE_CLAUDE_LOG', async () => {
  const { dir, systemFile } = files();
  const logFile = join(dir, 'log.jsonl');
  const state = {};
  await call({ systemFile, prompt: message(['a', 'one'], ['b', 'two']), env: { FAKE_CLAUDE_LOG: logFile }, state });
  assert.equal(state.log.length, 1);
  assert.deepEqual(state.log[0].ids, ['a', 'b']);
  assert.deepEqual(state.log[0].texts, ['one', 'two']);
  assert.equal(state.log[0].systemPromptFile, systemFile);
  assert.ok(state.log[0].args.includes('--system-prompt-file'));
  const logged = readFileSync(logFile, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0].ids, ['a', 'b']);
});

// ---- as a program, and through the wrapper --------------------------------------------------------------------------------------

test('--version answers without counting a call', async () => {
  const state = {};
  const out = await runFake({ args: ['--version'], state });
  assert.equal(out.stdout.trim(), FAKE_CLI_VERSION);
  assert.equal(out.exitCode, 0);
  assert.equal(state.calls, undefined);
});

test('started as a real program (no driver option) the fake reads stdin, prints the envelope, and the counter file lasts from one process to the next', async () => {
  const { dir, systemFile } = files();
  const stateFile = join(dir, 'state.json');
  const real = (mode) => runClaude({
    bin: FAKE, model: MODEL, systemPromptFile: systemFile, prompt: message(['a', 'One claim']), timeoutMs: 30000, env: { ...process.env, FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_STATE: stateFile },
  });
  const first = await real('invalid-once');
  assert.equal(first.ok, true, first.message);
  assert.throws(() => extractJson(first.text));
  const second = await real('invalid-once'); // a new process: only the file remembers that the first call was already made
  assert.equal(second.ok, true, second.message);
  assert.deepEqual(extractJson(second.text).items.map((i) => i.id), ['a']);
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).calls, 2);
  const window = await real('usage-window');
  assert.equal(window.errorKind, 'usage_window');
  assert.equal(window.exitCode, 1);
  assert.ok(existsSync(FAKE));
});

test('the wrapper\'s fake driver runs this fixture by default, and fakeScript names another one', async () => {
  const { systemFile } = files();
  const viaDefault = await runClaude({ driver: 'fake', model: MODEL, systemPromptFile: systemFile, prompt: message(['a', 'x']), timeoutMs: 20000 });
  assert.equal(viaDefault.ok, true, viaDefault.message);
  assert.deepEqual(extractJson(viaDefault.text).items.map((i) => i.id), ['a'], 'this fixture\'s reply shape, not the old fixture\'s array');
  const viaOption = await runClaude({ driver: 'fake', fakeScript: FAKE, model: MODEL, systemPromptFile: systemFile, prompt: message(['a', 'x']), timeoutMs: 20000 });
  assert.deepEqual(extractJson(viaOption.text), extractJson(viaDefault.text));
  const missing = await runClaude({ driver: 'fake', fakeScript: join(tmp(), 'nope.mjs'), model: MODEL, prompt: 'x', timeoutMs: 20000 });
  assert.equal(missing.errorKind, 'spawn', 'a fake that cannot be loaded is a spawn failure, not a crash');
});
