import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  FAKE_CLAUDE_SCRIPT, JsonExtractError, USAGE_WINDOW_RE, buildArgs, claudeVersion, extractJson, findClaudeBin, parseEnvelope, resolveSpawnTarget,
  runClaude, sameModel, scrubEnv, tryExtractJson, usageResetHint,
} from '../agents/claim-tagger/scripts/lib/claude.mjs';
import { fakeJudgments, parseClaims, runFake } from './fixtures/fake-claude.mjs';

const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-claude-'));
  roots.push(dir);
  return dir;
}

// ---- helpers: a fake child process for spawnImpl -----------------------------------------------------------------------------

/** A spawnImpl whose child prints stdout/stderr and exits with code; hang: never exits until killed; error: emits an 'error' event. */
function fakeSpawn({ stdout = '', stderr = '', code = 0, delayMs = 0, hang = false, error = null, throws = null } = {}) {
  const calls = [];
  const impl = (command, args, options) => {
    if (throws) throw throws;
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = undefined;
    const call = { command, args, options, input: '', killed: false };
    child.stdin.on('data', (d) => { call.input += d.toString('utf8'); });
    child.kill = () => {
      call.killed = true;
      setImmediate(() => child.emit('close', null, 'SIGKILL'));
      return true;
    };
    calls.push(call);
    if (error) {
      setImmediate(() => child.emit('error', error));
      return child;
    }
    if (!hang) {
      setTimeout(() => {
        let open = 2;
        const closeWhenDrained = () => {
          if (--open === 0) child.emit('close', code, null);
        };
        child.stdout.on('end', closeWhenDrained);
        child.stderr.on('end', closeWhenDrained);
        child.stdout.end(stdout);
        child.stderr.end(stderr);
      }, delayMs);
    }
    return child;
  };
  impl.calls = calls;
  return impl;
}

const element = (over = {}) => ({
  type: 'result', subtype: 'success', is_error: false, duration_ms: 900, num_turns: 1, result: '[]', total_cost_usd: 0.0123,
  modelUsage: { 'claude-haiku-5-5': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.0123 } }, ...over,
});
const asArray = (el) => JSON.stringify([{ type: 'system', subtype: 'init' }, { type: 'assistant', message: {} }, el]);
const base = { bin: 'claude', model: 'claude-haiku-5-5', systemPromptFile: 'sp.md', prompt: 'hello', effort: 'low', timeoutMs: 5000 };

// ---- extractJson -------------------------------------------------------------------------------------------------------------

test('extractJson: a bare array or object', () => {
  assert.deepEqual(extractJson('[1, 2, {"a": 3}]'), [1, 2, { a: 3 }]);
  assert.deepEqual(extractJson('  {"a": [1]}\n'), { a: [1] });
});

test('extractJson: code fences are stripped, with or without a language, with prose around', () => {
  assert.deepEqual(extractJson('```json\n[{"id": "a"}]\n```'), [{ id: 'a' }]);
  assert.deepEqual(extractJson('Here you go:\n```\n{"ok": true}\n```\nAnything else?'), { ok: true });
  assert.deepEqual(extractJson('```JSON\n[1]\n```'), [1]);
  assert.deepEqual(extractJson('```json [3]```'), [3]);
  assert.deepEqual(extractJson('```json\n[4]'), [4], 'an unterminated fence still works');
});

test('extractJson: brackets inside strings do not end the value early', () => {
  assert.deepEqual(extractJson('{"a": "]["}'), { a: '][' });
  assert.deepEqual(extractJson('[{"reason": "say \\"]\\" now"}]'), [{ reason: 'say "]" now' }]);
});

test('extractJson: prose before and after; the longest separate JSON value wins over a stray [1]', () => {
  assert.deepEqual(extractJson('Sure! [see note 1] Here: [{"id": "x", "tags": []}] Done.'), [{ id: 'x', tags: [] }]);
  assert.deepEqual(extractJson('Footnote [1]. Answer: [{"id": "x"}, {"id": "y"}]'), [{ id: 'x' }, { id: 'y' }]);
});

test('extractJson: nothing parseable throws a JsonExtractError that says what is wrong', () => {
  assert.throws(() => extractJson(''), (e) => e instanceof JsonExtractError && /empty/.test(e.message));
  assert.throws(() => extractJson('no json here'), (e) => e instanceof JsonExtractError && /no JSON/.test(e.message));
  assert.throws(() => extractJson('[{"id": "a", "tags": [{"name": "x"'), (e) => e instanceof JsonExtractError && /cut off/.test(e.message), 'a reply cut off before its closing bracket');
  assert.throws(() => extractJson('Sure: [{"id": "a", "tags": [{"name": "x"}, {"name": "y"} and then stops'), /cut off/, 'a complete inner object of a cut-off array is not an answer');
  assert.throws(() => extractJson('[1, 2,, 3]'), (e) => e instanceof JsonExtractError && /valid JSON/.test(e.message));
  assert.equal(tryExtractJson('nope').ok, false);
  assert.deepEqual(tryExtractJson('[1]'), { ok: true, value: [1] });
});

// ---- the envelope ------------------------------------------------------------------------------------------------------------

test('parseEnvelope: the array form takes the last result element, the object form is the element itself', () => {
  const el = element({ result: 'ARRAY' });
  assert.equal(parseEnvelope(asArray(el)).element.result, 'ARRAY');
  assert.equal(parseEnvelope(JSON.stringify(element({ result: 'OBJECT' }))).element.result, 'OBJECT');
  assert.equal(parseEnvelope(`\uFEFF${asArray(el)}\n`).element.result, 'ARRAY', 'BOM and trailing newline');
});

test('parseEnvelope: several JSON lines (stream form) and a warning line before the JSON', () => {
  const lines = [JSON.stringify({ type: 'system' }), 'a warning that is not JSON', JSON.stringify(element({ result: 'LINES' }))].join('\n');
  assert.equal(parseEnvelope(lines).element.result, 'LINES');
});

test('parseEnvelope: nothing, not JSON, and JSON without a result element are all reported', () => {
  assert.match(parseEnvelope('').error, /printed nothing/);
  assert.match(parseEnvelope('hello world').error, /not JSON/);
  assert.match(parseEnvelope(JSON.stringify([{ type: 'system' }])).error, /no element of type "result"/);
  assert.match(parseEnvelope('"just a string"').error, /not a result envelope/);
});

// ---- runClaude with a fake child ---------------------------------------------------------------------------------------------

test('runClaude: a good call is parsed, the prompt goes on stdin, the arguments are an array and no shell is used', async () => {
  const spawnImpl = fakeSpawn({ stdout: asArray(element({ result: '[{"id":"a"}]' })) });
  const prompt = 'Claim with "quotes", an umlaut \u00fc and a newline\nsecond line; rm -rf / & echo %PATH%';
  const r = await runClaude({ ...base, prompt, spawnImpl, env: { PATH: 'p', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', KEEP_ME: 'yes' } });
  assert.equal(r.ok, true);
  assert.equal(r.errorKind, null);
  assert.equal(r.text, '[{"id":"a"}]');
  assert.equal(r.costUsd, 0.0123);
  assert.equal(r.numTurns, 1);
  assert.deepEqual(Object.keys(r.modelUsage), ['claude-haiku-5-5']);
  assert.equal(typeof r.durationMs, 'number');
  assert.equal(r.raw.type, 'result');

  const call = spawnImpl.calls[0];
  assert.equal(call.command, 'claude');
  assert.deepEqual(call.args, [
    '-p', '--model', 'claude-haiku-5-5', '--output-format', 'json', '--tools', '', '--system-prompt-file', 'sp.md', '--max-turns', '1',
    '--effort', 'low', '--permission-mode', 'dontAsk', '--safe-mode', '--strict-mcp-config', '--no-session-persistence',
  ]);
  assert.equal(call.input, prompt, 'the whole prompt arrives on stdin, byte for byte');
  assert.ok(!call.args.some((a) => a.includes('Claim with')), 'the prompt is never in argv');
  assert.equal(call.options.shell, false);
  assert.deepEqual(call.options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(call.options.env.CLAUDECODE, undefined);
  assert.equal(call.options.env.CLAUDE_CODE_ENTRYPOINT, undefined);
  assert.equal(call.options.env.KEEP_ME, 'yes');
  assert.equal(call.options.env.PATH, 'p');
});

test('runClaude: the single-object envelope works too, and extra args are appended', async () => {
  const spawnImpl = fakeSpawn({ stdout: JSON.stringify(element({ result: 'OBJ' })) });
  const r = await runClaude({ ...base, spawnImpl, extraArgs: ['--foo', 'bar'], maxTurns: 3, effort: undefined });
  assert.equal(r.ok, true);
  assert.equal(r.text, 'OBJ');
  const args = spawnImpl.calls[0].args;
  assert.deepEqual(args.slice(-2), ['--foo', 'bar']);
  assert.equal(args[args.indexOf('--max-turns') + 1], '3');
  assert.ok(!args.includes('--effort'), 'no --effort without an effort');
});

test('runClaude: the cost falls back to the sum over modelUsage', async () => {
  const el = element();
  delete el.total_cost_usd;
  el.modelUsage['claude-haiku-5-5'].costUSD = 0.5;
  const r = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: asArray(el) }) });
  assert.equal(r.costUsd, 0.5);
});

test('runClaude: the pinned model must be in modelUsage (a date stamp or a context suffix is fine, another model is not)', async () => {
  const withUsage = (id) => fakeSpawn({ stdout: asArray(element({ modelUsage: { [id]: { costUSD: 1 } } })) });
  assert.equal((await runClaude({ ...base, spawnImpl: withUsage('claude-haiku-5-5-20261001') })).ok, true);
  assert.equal((await runClaude({ ...base, spawnImpl: withUsage('claude-haiku-5-5[1m]') })).ok, true);
  assert.equal((await runClaude({ ...base, spawnImpl: withUsage('CLAUDE-HAIKU-5-5') })).ok, true);

  const wrong = await runClaude({ ...base, spawnImpl: withUsage('claude-sonnet-5-5') });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.errorKind, 'model_mismatch');
  assert.match(wrong.message, /claude-haiku-5-5/);
  assert.match(wrong.message, /claude-sonnet-5-5/);
  assert.equal(wrong.text, '[]', 'the text is still returned so a caller can log it');

  const similar = await runClaude({ ...base, spawnImpl: withUsage('claude-haiku-5-50') });
  assert.equal(similar.errorKind, 'model_mismatch', 'a longer id is not the same model');

  const none = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: asArray(element({ modelUsage: undefined })) }) });
  assert.equal(none.errorKind, 'model_mismatch');
  assert.match(none.message, /no modelUsage/);

  const other = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: asArray(element({ modelUsage: { 'claude-haiku-5-5': {}, 'claude-sonnet-5-5': {} } })) }) });
  assert.equal(other.ok, true, 'extra models next to the pinned one are fine');
});

test('runClaude: without a pinned model nothing is checked', async () => {
  const r = await runClaude({ ...base, model: undefined, spawnImpl: fakeSpawn({ stdout: asArray(element({ modelUsage: undefined })) }) });
  assert.equal(r.ok, true);
});

test('runClaude: usage-window wording is recognised, with is_error and with a non-zero exit', async () => {
  const cases = [
    { stdout: asArray(element({ is_error: true, result: 'Claude AI usage limit reached|1760000000' })), code: 1 },
    { stdout: asArray(element({ is_error: true, result: 'Your 5-hour limit resets at 3pm' })), code: 0 },
    { stdout: '', stderr: 'API Error: 429 rate_limit_error', code: 1 },
    { stdout: asArray(element({ is_error: true, result: 'quota exceeded for this organisation' })), code: 1 },
    { stdout: asArray(element({ is_error: true, result: 'API Error: 529 overloaded_error' })), code: 1 },
    { stdout: asArray(element({ subtype: 'error_during_execution', result: 'weekly usage limit reached' })), code: 0 },
  ];
  for (const c of cases) {
    const r = await runClaude({ ...base, spawnImpl: fakeSpawn(c) });
    assert.equal(r.ok, false, JSON.stringify(c));
    assert.equal(r.errorKind, 'usage_window', JSON.stringify(c));
  }
  assert.match(usageResetHint('Your 5-hour limit resets at 3pm. Thanks'), /resets at 3pm/);
  assert.equal(usageResetHint('nothing to see'), null);
  assert.ok(USAGE_WINDOW_RE.test('Usage Limit') && !USAGE_WINDOW_RE.test('a normal error'));
});

test('runClaude: other failures are transient, with the CLI message', async () => {
  const a = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: asArray(element({ is_error: true, result: 'API Error: 500 internal server error' })), code: 1 }) });
  assert.equal(a.errorKind, 'transient');
  assert.match(a.message, /500/);
  assert.equal(a.isError, true);
  const b = await runClaude({ ...base, spawnImpl: fakeSpawn({ stderr: 'something broke\nsecond line', code: 2 }) });
  assert.equal(b.errorKind, 'transient');
  assert.equal(b.exitCode, 2);
  assert.match(b.message, /something broke second line/);
  const c = await runClaude({ ...base, spawnImpl: fakeSpawn({ code: 1 }) });
  assert.equal(c.errorKind, 'transient');
  assert.match(c.message, /exited with code 1/);
});

test('runClaude: an answer that merely mentions quota or limits is not an error', async () => {
  const text = '[{"id": "a", "reason": "The quota and the usage limit are discussed; it resets weekly."}]';
  const r = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: asArray(element({ result: text })) }) });
  assert.equal(r.ok, true);
  assert.equal(r.text, text);
});

test('runClaude: a limit notice printed as an ordinary short result still counts as the usage window', async () => {
  const r = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: asArray(element({ result: 'Claude usage limit reached. Your limit will reset at 3am.' })) }) });
  assert.equal(r.errorKind, 'usage_window');
});

test('runClaude: a plain-text limit notice without any envelope is still the usage window', async () => {
  const plain = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: 'Claude AI usage limit reached|1760000000\n' }) });
  assert.equal(plain.errorKind, 'usage_window');
  assert.match(plain.message, /usage limit reached/);
  const other = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: 'Welcome back! Nothing to see here.' }) });
  assert.equal(other.errorKind, 'schema');
});

test('runClaude: unusable output with exit 0 is a schema problem', async () => {
  const notJson = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: 'this is not json' }) });
  assert.equal(notJson.errorKind, 'schema');
  const noResult = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: JSON.stringify([{ type: 'system' }]) }) });
  assert.equal(noResult.errorKind, 'schema');
  const empty = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: asArray(element({ result: '   ' })) }) });
  assert.equal(empty.errorKind, 'schema');
  assert.match(empty.message, /no text/);
});

test('runClaude: a program that cannot be started is errorKind spawn, whether spawn throws or emits an error', async () => {
  const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
  const a = await runClaude({ ...base, spawnImpl: fakeSpawn({ error: enoent }) });
  assert.equal(a.errorKind, 'spawn');
  assert.match(a.message, /ENOENT/);
  const einval = Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' });
  const b = await runClaude({ ...base, spawnImpl: fakeSpawn({ throws: einval }) });
  assert.equal(b.errorKind, 'spawn');
  assert.match(b.message, /EINVAL/);
});

test('runClaude: a call that does not answer in time is killed and reported as a timeout', async () => {
  const spawnImpl = fakeSpawn({ hang: true });
  const t0 = Date.now();
  const r = await runClaude({ ...base, spawnImpl, timeoutMs: 40 });
  assert.equal(r.errorKind, 'timeout');
  assert.equal(r.ok, false);
  assert.equal(spawnImpl.calls[0].killed, true);
  assert.ok(Date.now() - t0 < 2000);
  assert.match(r.message, /40 ms/);
});

// ---- the real spawn path, with the fake CLI as a script --------------------------------------------------------------------

const realEnv = (mode, extra = {}) => ({ ...process.env, FAKE_CLAUDE_MODE: mode, ...extra });
const promptFor = (...ids) => `data\n<claims>\n${ids.map((id) => `<claim id="${id}" sources="2">text of ${id}</claim>`).join('\n')}\n</claims>\nReply with the JSON array only.`;

test('runClaude: spawns the fake CLI as a real child process, prompt on stdin, answer parsed', async () => {
  const dir = tmp();
  const sp = join(dir, 'system-prompt.md');
  writeFileSync(sp, '# Counterpart pairs\n\n- A vs B\n\n# Tags you must decide for every claim\n\n- A\n- B\n- C\n\n# Decisions\n');
  const r = await runClaude({
    bin: FAKE_CLAUDE_SCRIPT, model: 'claude-sonnet-5-5', systemPromptFile: sp, prompt: promptFor('c1', 'c2'), effort: 'medium', timeoutMs: 20000, env: realEnv('ok'),
  });
  assert.equal(r.ok, true, r.message);
  const reply = extractJson(r.text);
  assert.deepEqual(reply.map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(reply[0].tags.map((t) => t.name), ['A', 'B', 'C']);
  const [a, b] = reply[0].tags;
  assert.deepEqual([a.decision, b.decision].sort(), ['apply', 'do_not_apply'], 'the pair is consistent');
  assert.deepEqual(Object.keys(r.modelUsage), ['claude-sonnet-5-5']);
});

test('runClaude: non-ASCII prompts survive the pipe; a missing program is errorKind spawn', async () => {
  const text = 'Caf\u00e9 \u201cquoted\u201d \u2014 \u00fcber';
  const prompt = `<claim id="u1" sources="unknown">${text}</claim>`;
  const sp = join(tmp(), 'sp.md');
  writeFileSync(sp, '');
  const r = await runClaude({ bin: FAKE_CLAUDE_SCRIPT, model: 'm', systemPromptFile: sp, prompt, timeoutMs: 20000, env: realEnv('ok', { FAKE_CLAUDE_LOG: join(tmp(), 'log.jsonl') }) });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(extractJson(r.text).map((c) => c.id), ['u1']);
  const missing = await runClaude({ bin: join(tmp(), 'does-not-exist.exe'), model: 'm', prompt: 'x', timeoutMs: 5000 });
  assert.equal(missing.ok, false);
  assert.equal(missing.errorKind, 'spawn');
});

test('runClaude: a hanging child process is killed after the timeout (real process, short timeout)', async () => {
  const t0 = Date.now();
  const r = await runClaude({
    bin: FAKE_CLAUDE_SCRIPT, model: 'm', prompt: promptFor('h1'), timeoutMs: 600, env: realEnv('hang', { FAKE_CLAUDE_DELAY_MS: '60000' }),
  });
  assert.equal(r.errorKind, 'timeout');
  assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0} ms`);
});

test('runClaude: exit codes and stderr of a real failing child are classified', async () => {
  const r = await runClaude({ bin: FAKE_CLAUDE_SCRIPT, model: 'm', prompt: promptFor('e1'), timeoutMs: 20000, env: realEnv('exit_error') });
  assert.equal(r.errorKind, 'transient');
  assert.equal(r.exitCode, 1);
  assert.match(r.message, /connection reset/);
  const limit = await runClaude({ bin: FAKE_CLAUDE_SCRIPT, model: 'm', prompt: promptFor('e1'), timeoutMs: 20000, env: realEnv('usage_limit') });
  assert.equal(limit.errorKind, 'usage_window');
});

// ---- the fake driver, in-process ---------------------------------------------------------------------------------------------

const fakeCall = (mode, extra = {}, over = {}) => runClaude({
  driver: 'fake', bin: FAKE_CLAUDE_SCRIPT, model: 'claude-sonnet-5-5', prompt: promptFor('f1', 'f2', 'f3'), timeoutMs: 5000, env: { FAKE_CLAUDE_MODE: mode, ...extra }, ...over,
});

test('fake driver: ok gives deterministic judgments that two calls (and three runs) agree on', async () => {
  const a = await fakeCall('ok');
  const b = await fakeCall('ok');
  assert.equal(a.ok, true);
  assert.equal(a.text, b.text);
  const reply = extractJson(a.text);
  assert.equal(reply.length, 3);
  for (const c of reply) {
    assert.equal(c.tags.length, 10, 'the default scope has 10 tags');
    assert.ok(c.tags.every((t) => typeof t.p === 'number' && t.p >= 0 && t.p <= 1 && t.rule_ref && t.reason));
  }
});

test('fake driver: the scope and pairs come from the system prompt file', async () => {
  const sp = join(tmp(), 'sp.md');
  writeFileSync(sp, '# Counterpart pairs\n\n- Left vs Right\n\n# Tags you must decide for every claim\n\n- Left\n- Right\n- Solo\n\n# Decisions\n');
  const r = await fakeCall('ok', {}, { systemPromptFile: sp });
  const reply = extractJson(r.text);
  for (const c of reply) {
    assert.deepEqual(c.tags.map((t) => t.name), ['Left', 'Right', 'Solo']);
    assert.equal(c.tags.filter((t) => ['Left', 'Right'].includes(t.name) && t.decision === 'apply').length, 1);
  }
});

test('fake driver: malformed_once breaks the first attempt only (the retry mark is what it looks for)', async () => {
  const first = await fakeCall('malformed_once');
  assert.equal(first.ok, true, 'the envelope is fine; the reply inside it is cut off');
  assert.throws(() => extractJson(first.text), JsonExtractError);
  const retry = await fakeCall('malformed_once', {}, { prompt: `${promptFor('f1')}\n\nYour previous reply was invalid: x. Reply again with the JSON array only.` });
  assert.equal(extractJson(retry.text).length, 1);
  const always = await fakeCall('malformed_always', {}, { prompt: `${promptFor('f1')}\n\nYour previous reply was invalid: x.` });
  assert.throws(() => extractJson(always.text), JsonExtractError, 'malformed_always also breaks the retry');
});

test('fake driver: usage_limit lets FAKE_CLAUDE_LIMIT_AFTER calls through, then reports the window', async () => {
  const fakeState = {};
  const run = () => fakeCall('usage_limit', { FAKE_CLAUDE_LIMIT_AFTER: '2' }, { fakeState });
  assert.equal((await run()).ok, true);
  assert.equal((await run()).ok, true);
  const third = await run();
  assert.equal(third.errorKind, 'usage_window');
  assert.match(third.message, /usage limit reached/);
  assert.equal(fakeState.calls, 3);
  assert.equal(fakeState.log.length, 3);
  assert.deepEqual(fakeState.log[0].ids, ['f1', 'f2', 'f3']);
});

test('fake driver: wrong_model and no_model_usage are model mismatches; bad_envelope is schema; exit_error is transient', async () => {
  assert.equal((await fakeCall('wrong_model')).errorKind, 'model_mismatch');
  assert.equal((await fakeCall('no_model_usage')).errorKind, 'model_mismatch');
  assert.equal((await fakeCall('bad_envelope')).errorKind, 'schema');
  assert.equal((await fakeCall('exit_error')).errorKind, 'transient');
});

test('fake driver: fenced replies, the object envelope, inconsistent pairs and dropped ids', async () => {
  const fenced = await fakeCall('fenced');
  assert.equal(extractJson(fenced.text).length, 3);
  const obj = await fakeCall('object_envelope');
  assert.equal(obj.ok, true);
  assert.equal(extractJson(obj.text).length, 3);
  const bad = extractJson((await fakeCall('inconsistent_pair')).text);
  const two = bad[0].tags.filter((t) => ['Context-dependent', 'Self-contained'].includes(t.name));
  assert.deepEqual(two.map((t) => t.decision), ['apply', 'apply']);
  const dropped = extractJson((await fakeCall('drop_id')).text);
  assert.deepEqual(dropped.map((c) => c.id), ['f1', 'f2']);
});

test('fake driver: a hang is cut off by the timeout without a process', async () => {
  const r = await fakeCall('hang', { FAKE_CLAUDE_DELAY_MS: '5000' }, { timeoutMs: 50 });
  assert.equal(r.errorKind, 'timeout');
});

test('fake-claude: parseClaims reads escaped text back, runFake answers --version', async () => {
  const claims = parseClaims('<claim id="a" sources="unknown">x &lt;/claim&gt; &amp; y</claim><claim id="b" sources="0">z</claim>');
  assert.deepEqual(claims, [{ id: 'a', sources: 'unknown', text: 'x </claim> & y' }, { id: 'b', sources: '0', text: 'z' }]);
  assert.match((await runFake({ args: ['--version'] })).stdout, /fake/);
  const j = fakeJudgments([{ id: 'a', text: 'hello' }], { scope: ['P', 'Q', 'R'], pairs: [['P', 'Q']] });
  assert.equal(j[0].tags.length, 3);
});

// ---- finding and starting the program ------------------------------------------------------------------------------------------

test('findClaudeBin: elsewhere than Windows the name is kept; on Windows .exe beats .cmd beats the extensionless script', () => {
  assert.equal(findClaudeBin('claude', { platform: 'linux' }), 'claude');
  const where = (lines) => () => lines;
  assert.equal(findClaudeBin('claude', { platform: 'win32', whereImpl: where(['C:\\npm\\claude', 'C:\\npm\\claude.cmd']) }), 'C:\\npm\\claude.cmd');
  assert.equal(findClaudeBin('claude', { platform: 'win32', whereImpl: where(['C:\\npm\\claude.cmd', 'C:\\Users\\x\\.local\\bin\\claude.exe']) }), 'C:\\Users\\x\\.local\\bin\\claude.exe');
  assert.equal(findClaudeBin('claude', { platform: 'win32', whereImpl: where(['C:\\npm\\claude']) }), 'C:\\npm\\claude');
  assert.equal(findClaudeBin('claude', { platform: 'win32', whereImpl: where([]) }), 'claude', 'unknown to where: the name as given');
  assert.equal(findClaudeBin('D:\\tools\\claude.exe', { platform: 'win32', whereImpl: () => { throw new Error('where must not be asked for a path'); } }), 'D:\\tools\\claude.exe');
});

test('resolveSpawnTarget: scripts run under node, a plain program as it is, an npm .cmd shim is followed to what it launches', () => {
  assert.deepEqual(resolveSpawnTarget('C:\\bin\\claude.exe', { platform: 'win32' }), { command: 'C:\\bin\\claude.exe', prefixArgs: [] });
  const script = resolveSpawnTarget(FAKE_CLAUDE_SCRIPT);
  assert.equal(script.command, process.execPath);
  assert.equal(script.prefixArgs.length, 1);

  const dir = tmp();
  mkdirSync(join(dir, 'node_modules', '@anthropic-ai', 'claude-code'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'), '// shim target\n');
  writeFileSync(join(dir, 'claude.cmd'), '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n');
  const viaShim = resolveSpawnTarget(join(dir, 'claude.cmd'), { platform: 'win32' });
  assert.equal(viaShim.command, process.execPath);
  assert.match(viaShim.prefixArgs[0], /claude-code[\\/]cli\.js$/);

  writeFileSync(join(dir, 'odd.cmd'), '@echo hello\r\n');
  assert.throws(() => resolveSpawnTarget(join(dir, 'odd.cmd'), { platform: 'win32' }), /claude\.exe/);
  assert.throws(() => resolveSpawnTarget(join(dir, 'missing.cmd'), { platform: 'win32' }), /cannot read/);
  assert.deepEqual(resolveSpawnTarget(join(dir, 'claude.cmd'), { platform: 'linux' }), { command: join(dir, 'claude.cmd'), prefixArgs: [] }, 'only Windows has the shim problem');
});

test('runClaude: a .cmd that cannot be followed is reported as spawn with the way out, never run through a shell', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'odd.cmd'), '@echo hello\r\n');
  const r = await runClaude({ ...base, bin: join(dir, 'odd.cmd'), spawnImpl: () => { throw new Error('spawn must not be reached'); } });
  if (process.platform === 'win32') {
    assert.equal(r.errorKind, 'spawn');
    assert.match(r.message, /claude\.exe/);
  } else {
    assert.equal(r.errorKind, 'spawn'); // the stub throws, which is also a spawn failure
  }
});

test('scrubEnv, buildArgs and sameModel', () => {
  const env = { A: '1', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x' };
  assert.deepEqual(scrubEnv(env), { A: '1' });
  assert.deepEqual(env, { A: '1', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x' }, 'the input is not modified');
  assert.deepEqual(buildArgs({ model: 'm', systemPromptFile: 'f', effort: 'high', maxTurns: 2, extraArgs: ['--x'] }).slice(0, 8), ['-p', '--model', 'm', '--output-format', 'json', '--tools', '', '--system-prompt-file']);
  assert.ok(!buildArgs({}).includes('--model'));
  assert.ok(sameModel('claude-sonnet-5-5', 'claude-sonnet-5-5-20261001'));
  assert.ok(!sameModel('claude-sonnet-5-5', 'claude-haiku-5-5'));
});

test('claudeVersion: the first line of --version, cached per program, unknown when it cannot be read', () => {
  const cache = new Map();
  let calls = 0;
  const spawnSyncImpl = (command, args) => {
    calls++;
    assert.ok(args.includes('--version'));
    return { status: 0, stdout: '2.1.296 (Claude Code)\nmore\n' };
  };
  assert.equal(claudeVersion('C:\\bin\\claude.exe', { spawnSyncImpl, cache }), '2.1.296 (Claude Code)');
  assert.equal(claudeVersion('C:\\bin\\claude.exe', { spawnSyncImpl, cache }), '2.1.296 (Claude Code)');
  assert.equal(calls, 1);
  assert.equal(claudeVersion('x', { spawnSyncImpl: () => ({ status: 1, stdout: '' }), cache }), 'unknown');
  assert.equal(claudeVersion('y', { spawnSyncImpl: () => { throw new Error('boom'); }, cache }), 'unknown');
  assert.equal(claudeVersion(FAKE_CLAUDE_SCRIPT, { cache: new Map() }), '0.0.0-fake (Claude Code)', 'the real spawnSync path, through the fake script');
});
