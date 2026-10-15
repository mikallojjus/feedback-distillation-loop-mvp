import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import * as mvp from '../../agents/claim-tagger-mvp/scripts/lib/claude.mjs';
import * as old from '../../agents/claim-tagger/scripts/lib/claude.mjs';

const {
  FAKE_CLAUDE_SCRIPT, TRANSIENT_RE, USAGE_WINDOW_RE, buildArgs, extractJson, parseEnvelope, runClaude, sameModel, scrubEnv, usageResetHint, withTransientRetry,
} = mvp;

// ---- helpers: a fake child process for spawnImpl -----------------------------------------------------------------------------

/**
 * A spawnImpl whose child prints stdout/stderr and exits with code. `spec` is one option object, or a list of them used call by call
 * (the last one repeats). hang: never exits until killed; error: emits an 'error' event; throws: spawn itself throws.
 */
function fakeSpawn(spec = {}) {
  const specs = Array.isArray(spec) ? spec : [spec];
  const calls = [];
  const impl = (command, args, options) => {
    const { stdout = '', stderr = '', code = 0, hang = false, error = null, throws = null } = specs[Math.min(calls.length, specs.length - 1)];
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
      }, 0);
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
const failure = (result, over = {}) => asArray(element({ is_error: true, result, ...over }));

// ---- the exports -------------------------------------------------------------------------------------------------------------

test('the MVP module exports everything the old one did, plus TRANSIENT_RE and withTransientRetry', () => {
  const oldNames = Object.keys(old).sort();
  const names = Object.keys(mvp).sort();
  assert.deepEqual(names, [...oldNames, 'TRANSIENT_RE', 'withTransientRetry'].sort());
  assert.ok(USAGE_WINDOW_RE instanceof RegExp);
  assert.ok(TRANSIENT_RE instanceof RegExp);
  assert.equal(typeof withTransientRetry, 'function');
  assert.equal(FAKE_CLAUDE_SCRIPT, old.FAKE_CLAUDE_SCRIPT, 'the fake CLI is found from the same repository root');
  assert.ok(existsSync(FAKE_CLAUDE_SCRIPT));
});

// ---- the two patterns --------------------------------------------------------------------------------------------------------

const WINDOW_WORDING = [
  'Claude AI usage limit reached|1760000000',
  'USAGE LIMIT',
  'weekly usage limit reached',
  'usage_limit_reached',
  'Weekly limit reached',
  '5-hour limit reached \u2219 resets 3pm',
  'Your limit will reset at 3am',
  'Your 5-hour limit resets at 3pm',
  'Your usage resets in 2 hours',
  'resets on Friday',
  'resets tomorrow',
  'You\'ve hit your limit \u00b7 resets 4pm (Europe/Vilnius)',
  'You\u2019ve hit your weekly limit',
  'You have hit your limit',
  'You\'re out of extra usage',
  'out of usage',
];

const TRANSIENT_WORDING = [
  'API Error: 429 rate_limit_error',
  'HTTP 429',
  '(529)',
  'status: 529 overloaded_error',
  '503 Service Unavailable',
  'rate limit exceeded',
  'Rate Limit',
  'rate_limit_error',
  'Overloaded',
  'overloaded_error',
  'service_unavailable',
  'The server is busy, try again',
  'Request timed out.',
  'timeout of 30000ms exceeded',
  'Timeout',
  'read ECONNRESET',
  'connect ETIMEDOUT 160.79.104.10:443',
];

test('USAGE_WINDOW_RE matches the CLI\'s wording for the subscription window and nothing that clears in seconds', () => {
  for (const s of WINDOW_WORDING) assert.equal(USAGE_WINDOW_RE.test(s), true, s);
  for (const s of [...TRANSIENT_WORDING, 'a normal error', 'API Error: 500 internal server error', 'connection resets by peer', 'quota exceeded', '']) {
    assert.equal(USAGE_WINDOW_RE.test(s), false, JSON.stringify(s));
  }
  assert.equal(USAGE_WINDOW_RE.global || USAGE_WINDOW_RE.sticky, false, 'no flag that keeps state between .test() calls');
  assert.equal(USAGE_WINDOW_RE.test(WINDOW_WORDING[0]), USAGE_WINDOW_RE.test(WINDOW_WORDING[0]));
});

test('TRANSIENT_RE matches 429, 529, 503, rate limit, overloaded, service_unavailable, busy, timed out, timeout, ECONNRESET and ETIMEDOUT', () => {
  for (const s of TRANSIENT_WORDING) assert.equal(TRANSIENT_RE.test(s), true, s);
  for (const s of ['Claude AI usage limit reached|1760000000', 'Your limit resets at 3pm', 'a normal error', 'API Error: 500 internal server error', 'busybox', '']) {
    assert.equal(TRANSIENT_RE.test(s), false, JSON.stringify(s));
  }
  // a status number is a whole number: a time stamp or a count that merely contains 429, 503 or 529 is not a rate limit
  for (const s of ['reset at 1760004290', 'id 15039', 'resets 5290 times', 'ref 4290']) assert.equal(TRANSIENT_RE.test(s), false, s);
  assert.equal(TRANSIENT_RE.global || TRANSIENT_RE.sticky, false);
});

// ---- classification through runClaude ----------------------------------------------------------------------------------------

test('runClaude: the subscription window\'s wording is usage_window, with is_error, with an error subtype and with a non-zero exit', async () => {
  const cases = [
    { stdout: failure('Claude AI usage limit reached|1760000000'), code: 1 },
    { stdout: failure('Your 5-hour limit resets at 3pm'), code: 0 },
    { stdout: asArray(element({ subtype: 'error_during_execution', result: 'weekly usage limit reached' })), code: 0 },
    { stdout: '', stderr: 'You\'ve hit your limit \u00b7 resets 4pm', code: 1 },
    { stdout: failure('You\'re out of extra usage'), code: 1 },
    { stdout: failure('5-hour limit reached \u2219 resets 3pm'), code: 1 },
  ];
  for (const c of cases) {
    const r = await runClaude({ ...base, spawnImpl: fakeSpawn(c) });
    assert.equal(r.ok, false, JSON.stringify(c));
    assert.equal(r.errorKind, 'usage_window', JSON.stringify(c));
  }
  assert.match(usageResetHint('Your 5-hour limit resets at 3pm. Thanks'), /resets at 3pm/);
  assert.match(usageResetHint('You\'ve hit your limit \u00b7 resets 4pm'), /resets 4pm/);
  assert.equal(usageResetHint('nothing to see'), null);
});

test('runClaude: a 429, a rate limit, an overloaded or busy API, a timeout or a reset connection is transient, not the window', async () => {
  const cases = [
    { stdout: '', stderr: 'API Error: 429 rate_limit_error', code: 1 },
    { stdout: failure('API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed the rate limit"}}'), code: 1 },
    { stdout: failure('API Error: 529 overloaded_error'), code: 1 },
    { stdout: failure('Overloaded'), code: 0 },
    { stdout: failure('API Error: 503 service_unavailable'), code: 1 },
    { stdout: '', stderr: 'The API is busy, please retry', code: 1 },
    { stdout: failure('API Error: Request timed out.'), code: 1 },
    { stdout: '', stderr: 'read ECONNRESET', code: 1 },
    { stdout: '', stderr: 'connect ETIMEDOUT 160.79.104.10:443', code: 1 },
    { stdout: asArray(element({ subtype: 'error_during_execution', result: 'rate limit' })), code: 0 },
  ];
  for (const c of cases) {
    const r = await runClaude({ ...base, spawnImpl: fakeSpawn(c) });
    assert.equal(r.ok, false, JSON.stringify(c));
    assert.equal(r.errorKind, 'transient', JSON.stringify(c));
  }
  const r = await runClaude({ ...base, spawnImpl: fakeSpawn(cases[0]) });
  assert.match(r.message, /429/, 'the CLI\'s message is kept');
});

test('runClaude: a reply with both kinds of wording is the window, because the window is checked first', async () => {
  const both = [
    failure('API Error: 429 rate_limit_error: Claude usage limit reached, resets at 3pm'),
    failure('Overloaded. 5-hour limit reached \u2219 resets 3pm'),
  ];
  for (const stdout of both) {
    const r = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout, code: 1 }) });
    assert.equal(r.errorKind, 'usage_window', stdout);
  }
  const viaStderr = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: '', stderr: '429 Too Many Requests; usage limit reached', code: 1 }) });
  assert.equal(viaStderr.errorKind, 'usage_window');
});

test('runClaude: any other failure is still transient with the CLI message, as in the old module', async () => {
  const a = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: failure('API Error: 500 internal server error'), code: 1 }) });
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

test('runClaude: a notice that arrives as plain text, without any envelope, is the window, a transient failure, or a schema problem', async () => {
  const window = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: 'Claude AI usage limit reached|1760000000\n' }) });
  assert.equal(window.errorKind, 'usage_window');
  assert.match(window.message, /usage limit reached/);
  const hit = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: 'You\'ve hit your limit \u00b7 resets 4pm\n' }) });
  assert.equal(hit.errorKind, 'usage_window');
  for (const stdout of ['API Error: 429 rate_limit_error\n', 'API Error: 529 overloaded_error\n', 'The API is busy\n']) {
    const r = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout }) });
    assert.equal(r.errorKind, 'transient', stdout);
  }
  const both = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: '429 rate limit. Claude usage limit reached.\n' }) });
  assert.equal(both.errorKind, 'usage_window');
  for (const stdout of ['Welcome back! Nothing to see here.', 'this is not json', JSON.stringify([{ type: 'system' }])]) {
    const r = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout }) });
    assert.equal(r.errorKind, 'schema', stdout);
  }
});

test('runClaude: a short non-JSON result that is really a notice is judged by its wording; an answer that holds JSON, or a long text, never is', async () => {
  const window = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: asArray(element({ result: 'Claude usage limit reached. Your limit will reset at 3am.' })) }) });
  assert.equal(window.errorKind, 'usage_window');
  const transient = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: asArray(element({ result: 'API Error: 529 overloaded_error' })) }) });
  assert.equal(transient.errorKind, 'transient');
  const json = '[{"id": "a", "reason": "The system is busy; a rate limit and the usage limit are discussed; it resets at 3pm; 429, 503."}]';
  const fine = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: asArray(element({ result: json })) }) });
  assert.equal(fine.ok, true);
  assert.equal(fine.text, json);
  const long = 'The usage limit and the rate limit are discussed in this long, plain answer. '.repeat(8);
  assert.ok(long.length > 400);
  const plainLong = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: asArray(element({ result: long })) }) });
  assert.equal(plainLong.ok, true, 'a long text is an answer, not a notice');
});

test('fake driver: usage_limit is the window and exit_error is a transient failure; a real child process is classified the same way', async () => {
  const claims = '<claims>\n<claim id="f1" sources="2">text of f1</claim>\n</claims>';
  const viaFake = (mode, extra = {}) => runClaude({ driver: 'fake', bin: FAKE_CLAUDE_SCRIPT, model: 'claude-sonnet-5-5', prompt: claims, timeoutMs: 5000, env: { FAKE_CLAUDE_MODE: mode, ...extra } });
  const limit = await viaFake('usage_limit');
  assert.equal(limit.errorKind, 'usage_window');
  assert.match(limit.message, /usage limit reached/);
  assert.equal((await viaFake('exit_error')).errorKind, 'transient');
  assert.equal((await viaFake('ok')).ok, true);
  assert.equal((await viaFake('wrong_model')).errorKind, 'model_mismatch');

  const real = (mode) => runClaude({ bin: FAKE_CLAUDE_SCRIPT, model: 'claude-sonnet-5-5', prompt: claims, timeoutMs: 20000, env: { ...process.env, FAKE_CLAUDE_MODE: mode } });
  const ok = await real('ok');
  assert.equal(ok.ok, true, ok.message);
  assert.deepEqual(extractJson(ok.text).map((c) => c.id), ['f1']);
  assert.equal((await real('usage_limit')).errorKind, 'usage_window');
});

// ---- hard rule 9: no --bare, no --fallback-model -----------------------------------------------------------------------------

function refuses(flag, makeOptions) {
  return async () => {
    for (const extraArgs of [[flag], ['--foo', flag], [flag, 'claude-sonnet-5-5'], [`${flag}=x`], ['--model', flag]]) {
      assert.throws(
        () => buildArgs({ ...makeOptions, extraArgs }),
        (e) => e instanceof TypeError && e.message.includes(flag) && /hard rule 9/.test(e.message),
        JSON.stringify(extraArgs),
      );
    }
    // the same flag arriving as the value of any other option is on the command line too, so it is refused too
    for (const option of ['model', 'systemPromptFile', 'effort', 'maxTurns']) {
      assert.throws(() => buildArgs({ model: 'm', [option]: flag }), (e) => e instanceof TypeError && e.message.includes(flag), option);
    }
    assert.throws(() => buildArgs({ extraArgs: flag }), (e) => e instanceof TypeError && /array/.test(e.message), 'a string cannot be spread past the check');

    // runClaude throws before it spawns anything: no process, no stdin, no fake driver call
    const spawnImpl = fakeSpawn({ stdout: asArray(element()) });
    await assert.rejects(() => runClaude({ ...base, spawnImpl, extraArgs: ['--max-turns', '2', flag] }), (e) => e instanceof TypeError && e.message.includes(flag));
    assert.equal(spawnImpl.calls.length, 0, 'nothing was spawned');
    const fakeState = {};
    await assert.rejects(() => runClaude({ ...base, driver: 'fake', fakeState, extraArgs: [flag] }), (e) => e instanceof TypeError && e.message.includes(flag));
    assert.equal(fakeState.calls, undefined, 'the fake driver was not asked either');
    await assert.rejects(() => runClaude({ ...base, spawnImpl, model: flag }), TypeError);
    assert.equal(spawnImpl.calls.length, 0);
  };
}

test('--bare is refused: buildArgs and runClaude throw a TypeError that names the flag, before anything is spawned', refuses('--bare', { model: 'm' }));

test('--fallback-model is refused: buildArgs and runClaude throw a TypeError that names the flag, before anything is spawned', refuses('--fallback-model', { model: 'm' }));

test('only the two flags themselves are refused: flags that merely start with the same letters, and every other argument, pass unchanged', async () => {
  const extraArgs = ['--barefoot', '--bare-metal', '--fallback', '--fallback-models', '--no-bare', 'bare', '-p', '--foo', 'bar'];
  assert.deepEqual(buildArgs({ model: 'm', extraArgs }).slice(-extraArgs.length), extraArgs);
  const spawnImpl = fakeSpawn({ stdout: asArray(element()) });
  const r = await runClaude({ ...base, spawnImpl, extraArgs: ['--foo', 'bar'] });
  assert.equal(r.ok, true);
  assert.deepEqual(spawnImpl.calls[0].args.slice(-2), ['--foo', 'bar']);
});

test('buildArgs gives the old module\'s argument list for every combination that is allowed', () => {
  const sets = [
    {},
    { model: 'claude-haiku-5-5' },
    { model: 'claude-sonnet-5-5', systemPromptFile: 'sp.md', effort: 'high', maxTurns: 2, extraArgs: ['--x', 'y'] },
    { systemPromptFile: 'C:\\temp\\system prompt.md', maxTurns: 5 },
  ];
  for (const s of sets) assert.deepEqual(buildArgs(s), old.buildArgs(s), JSON.stringify(s));
  assert.deepEqual(buildArgs({ model: 'claude-haiku-5-5', systemPromptFile: 'sp.md', effort: 'low' }), [
    '-p', '--model', 'claude-haiku-5-5', '--output-format', 'json', '--tools', '', '--system-prompt-file', 'sp.md', '--max-turns', '1',
    '--effort', 'low', '--permission-mode', 'dontAsk', '--safe-mode', '--strict-mcp-config', '--no-session-persistence',
  ]);
  assert.deepEqual(buildArgs(), old.buildArgs());
});

// ---- withTransientRetry --------------------------------------------------------------------------------------------------------

const transient = (n) => ({ ok: false, errorKind: 'transient', message: `attempt ${n}` });
const okResult = { ok: true, errorKind: null, text: 'fine' };

/** A function that returns the given results one call after the other (the last one repeats) and counts its calls. */
function scripted(results) {
  const fn = async () => results[Math.min(fn.calls++, results.length - 1)];
  fn.calls = 0;
  return fn;
}

/** A sleep that does not wait and remembers how long it was asked to. */
function fakeSleep() {
  const sleep = async (ms) => { sleep.waits.push(ms); };
  sleep.waits = [];
  return sleep;
}

test('withTransientRetry: a result that is not transient comes back at once, untouched, without a pause', async () => {
  const sleep = fakeSleep();
  const fn = scripted([okResult]);
  assert.equal(await withTransientRetry(fn, { sleep }), okResult);
  assert.equal(fn.calls, 1);
  assert.deepEqual(sleep.waits, []);
});

test('withTransientRetry: asks again after 5, 15 and 45 seconds while the result is transient, and returns the first one that is not', async () => {
  const sleep = fakeSleep();
  const fn = scripted([transient(1), transient(2), okResult]);
  assert.equal(await withTransientRetry(fn, { sleep }), okResult);
  assert.equal(fn.calls, 3);
  assert.deepEqual(sleep.waits, [5000, 15000]);

  const third = fakeSleep();
  const late = scripted([transient(1), transient(2), transient(3), okResult]);
  assert.equal(await withTransientRetry(late, { sleep: third }), okResult);
  assert.equal(late.calls, 4);
  assert.deepEqual(third.waits, [5000, 15000, 45000]);
});

test('withTransientRetry: after the retries are used up it returns the last result, so the caller can read its message', async () => {
  const sleep = fakeSleep();
  const results = [transient(1), transient(2), transient(3), transient(4), transient(5)];
  const fn = scripted(results);
  const last = await withTransientRetry(fn, { sleep });
  assert.equal(fn.calls, 4, 'the first call and three retries');
  assert.equal(last, results[3]);
  assert.equal(last.message, 'attempt 4');
  assert.deepEqual(sleep.waits, [5000, 15000, 45000]);
});

test('withTransientRetry never retries the usage window, however it comes, and stops when a retry turns into one', async () => {
  const sleep = fakeSleep();
  const window = { ok: false, errorKind: 'usage_window', message: 'usage limit reached' };
  const fn = scripted([window, okResult]);
  assert.equal(await withTransientRetry(fn, { sleep }), window);
  assert.equal(fn.calls, 1);
  assert.deepEqual(sleep.waits, []);

  const turns = fakeSleep();
  const later = scripted([transient(1), window, okResult]);
  assert.equal(await withTransientRetry(later, { sleep: turns }), window);
  assert.equal(later.calls, 2);
  assert.deepEqual(turns.waits, [5000]);
});

test('withTransientRetry leaves every other failure alone: timeout, spawn, schema, model_mismatch, and results that are not results', async () => {
  for (const errorKind of ['timeout', 'spawn', 'schema', 'model_mismatch', 'something_new']) {
    const sleep = fakeSleep();
    const result = { ok: false, errorKind };
    const fn = scripted([result, okResult]);
    assert.equal(await withTransientRetry(fn, { sleep }), result, errorKind);
    assert.equal(fn.calls, 1, errorKind);
    assert.deepEqual(sleep.waits, [], errorKind);
  }
  for (const odd of [null, undefined, 'text', 0, {}]) {
    const sleep = fakeSleep();
    const fn = scripted([odd]);
    assert.equal(await withTransientRetry(fn, { sleep }), odd);
    assert.equal(fn.calls, 1);
  }
});

test('withTransientRetry: attempts counts the retries, backoffMs lists the pauses (the last one repeats), a sync function works', async () => {
  const one = fakeSleep();
  const a = scripted([transient(1)]);
  await withTransientRetry(a, { attempts: 1, backoffMs: [7, 8, 9], sleep: one });
  assert.equal(a.calls, 2);
  assert.deepEqual(one.waits, [7]);

  const many = fakeSleep();
  const b = scripted([transient(1)]);
  await withTransientRetry(b, { attempts: 5, backoffMs: [10, 20], sleep: many });
  assert.equal(b.calls, 6);
  assert.deepEqual(many.waits, [10, 20, 20, 20, 20]);

  const none = fakeSleep();
  const c = scripted([transient(1)]);
  assert.equal((await withTransientRetry(c, { attempts: 0, sleep: none })).errorKind, 'transient');
  assert.equal(c.calls, 1);
  assert.deepEqual(none.waits, []);

  const empty = fakeSleep();
  const d = scripted([transient(1)]);
  await withTransientRetry(d, { attempts: 2, backoffMs: [], sleep: empty });
  assert.deepEqual(empty.waits, [0, 0]);

  const sync = fakeSleep();
  let n = 0;
  const result = await withTransientRetry(() => (++n < 3 ? transient(n) : okResult), { sleep: sync });
  assert.equal(result, okResult);
  assert.equal(n, 3);
});

test('withTransientRetry: the real timer is used when no sleep is given', async () => {
  const fn = scripted([transient(1), transient(2), okResult]);
  const t0 = Date.now();
  assert.equal(await withTransientRetry(fn, { backoffMs: [20, 20] }), okResult);
  assert.equal(fn.calls, 3);
  assert.ok(Date.now() - t0 >= 30, `two pauses of 20 ms took ${Date.now() - t0} ms`);
});

test('withTransientRetry: a function that throws, or a sleep that throws, is not swallowed; bad arguments are refused', async () => {
  const boom = new Error('boom');
  let calls = 0;
  await assert.rejects(() => withTransientRetry(async () => { calls++; throw boom; }, { sleep: fakeSleep() }), (e) => e === boom);
  assert.equal(calls, 1, 'no retry after a throw');
  const stuck = async () => { throw new Error('sleep broke'); };
  await assert.rejects(() => withTransientRetry(scripted([transient(1)]), { sleep: stuck }), /sleep broke/);
  await assert.rejects(() => withTransientRetry('not a function'), TypeError);
  await assert.rejects(() => withTransientRetry(scripted([okResult]), { attempts: -1 }), RangeError);
  await assert.rejects(() => withTransientRetry(scripted([okResult]), { attempts: 1.5 }), RangeError);
  await assert.rejects(() => withTransientRetry(scripted([okResult]), { attempts: '3' }), RangeError);
  await assert.rejects(() => withTransientRetry(scripted([okResult]), { backoffMs: 5000 }), TypeError);
});

test('withTransientRetry around runClaude: a 429, then an overloaded API, then the answer; the window in between ends it', async () => {
  const answer = { stdout: asArray(element({ result: '[{"id":"a"}]' })) };
  const spawnImpl = fakeSpawn([
    { stdout: '', stderr: 'API Error: 429 rate_limit_error', code: 1 },
    { stdout: failure('API Error: 529 overloaded_error'), code: 1 },
    answer,
  ]);
  const sleep = fakeSleep();
  const r = await withTransientRetry(() => runClaude({ ...base, spawnImpl }), { sleep });
  assert.equal(r.ok, true);
  assert.equal(r.text, '[{"id":"a"}]');
  assert.equal(spawnImpl.calls.length, 3);
  assert.deepEqual(sleep.waits, [5000, 15000]);

  const windowSpawn = fakeSpawn([
    { stdout: '', stderr: 'API Error: 429 rate_limit_error', code: 1 },
    { stdout: failure('5-hour limit reached \u2219 resets 3pm'), code: 1 },
    answer,
  ]);
  const stopped = fakeSleep();
  const w = await withTransientRetry(() => runClaude({ ...base, spawnImpl: windowSpawn }), { sleep: stopped });
  assert.equal(w.errorKind, 'usage_window');
  assert.equal(windowSpawn.calls.length, 2);
  assert.deepEqual(stopped.waits, [5000]);
  assert.match(usageResetHint(w.message), /resets 3pm/);

  const plain = fakeSpawn({ stdout: failure('API Error: 500 internal server error'), code: 1 });
  const always = fakeSleep();
  const e = await withTransientRetry(() => runClaude({ ...base, spawnImpl: plain }), { sleep: always });
  assert.equal(e.errorKind, 'transient');
  assert.equal(plain.calls.length, 4);
  assert.deepEqual(always.waits, [5000, 15000, 45000]);
});

// ---- the copy keeps what the old module did ----------------------------------------------------------------------------------

test('copy: a good call is parsed, the prompt goes on stdin, the arguments are an array, no shell is used and the environment is scrubbed', async () => {
  const spawnImpl = fakeSpawn({ stdout: asArray(element({ result: '[{"id":"a"}]' })) });
  const prompt = 'Claim with "quotes", an umlaut \u00fc and a newline\nsecond line; rm -rf / & echo %PATH%';
  const r = await runClaude({ ...base, prompt, spawnImpl, env: { PATH: 'p', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', KEEP_ME: 'yes' } });
  assert.equal(r.ok, true);
  assert.equal(r.errorKind, null);
  assert.equal(r.text, '[{"id":"a"}]');
  assert.equal(r.costUsd, 0.0123);
  assert.deepEqual(Object.keys(r.modelUsage), ['claude-haiku-5-5']);
  const call = spawnImpl.calls[0];
  assert.equal(call.command, 'claude');
  assert.equal(call.input, prompt, 'the whole prompt arrives on stdin, byte for byte');
  assert.ok(!call.args.some((a) => a.includes('Claim with')), 'the prompt is never in argv');
  assert.ok(!call.args.includes('--bare') && !call.args.includes('--fallback-model'));
  assert.equal(call.options.shell, false);
  assert.equal(call.options.env.CLAUDECODE, undefined);
  assert.equal(call.options.env.CLAUDE_CODE_ENTRYPOINT, undefined);
  assert.equal(call.options.env.KEEP_ME, 'yes');
  assert.deepEqual(scrubEnv({ A: '1', CLAUDECODE: '1' }), { A: '1' });
});

test('copy: the pinned model must appear in modelUsage; a date stamp is fine, another model or none is a model_mismatch', async () => {
  const withUsage = (id) => fakeSpawn({ stdout: asArray(element({ modelUsage: { [id]: { costUSD: 1 } } })) });
  assert.equal((await runClaude({ ...base, spawnImpl: withUsage('claude-haiku-5-5-20261001') })).ok, true);
  const wrong = await runClaude({ ...base, spawnImpl: withUsage('claude-sonnet-5-5') });
  assert.equal(wrong.errorKind, 'model_mismatch');
  assert.match(wrong.message, /claude-haiku-5-5/);
  const none = await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: asArray(element({ modelUsage: undefined })) }) });
  assert.equal(none.errorKind, 'model_mismatch');
  assert.ok(sameModel('claude-sonnet-5-5', 'claude-sonnet-5-5-20261001'));
  assert.ok(!sameModel('claude-sonnet-5-5', 'claude-haiku-5-5'));
});

test('copy: a program that cannot be started is spawn, a call that does not answer is killed and reported as timeout, unusable output is schema', async () => {
  const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
  const a = await runClaude({ ...base, spawnImpl: fakeSpawn({ error: enoent }) });
  assert.equal(a.errorKind, 'spawn');
  assert.match(a.message, /ENOENT/);
  const b = await runClaude({ ...base, spawnImpl: fakeSpawn({ throws: Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' }) }) });
  assert.equal(b.errorKind, 'spawn');
  const hang = fakeSpawn({ hang: true });
  const t = await runClaude({ ...base, spawnImpl: hang, timeoutMs: 40 });
  assert.equal(t.errorKind, 'timeout');
  assert.equal(hang.calls[0].killed, true);
  assert.match(t.message, /40 ms/);
  assert.equal((await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: 'this is not json' }) })).errorKind, 'schema');
  assert.equal((await runClaude({ ...base, spawnImpl: fakeSpawn({ stdout: asArray(element({ result: '   ' })) }) })).errorKind, 'schema');
});

test('copy: extractJson and parseEnvelope read what the CLI prints', () => {
  assert.deepEqual(extractJson('```json\n[{"id": "a"}]\n```'), [{ id: 'a' }]);
  assert.deepEqual(extractJson('Footnote [1]. Answer: [{"id": "x"}, {"id": "y"}]'), [{ id: 'x' }, { id: 'y' }]);
  assert.throws(() => extractJson('[{"id": "a", "tags": [{"name": "x"'), /cut off/);
  assert.equal(parseEnvelope(asArray(element({ result: 'ARRAY' }))).element.result, 'ARRAY');
  assert.equal(parseEnvelope(JSON.stringify(element({ result: 'OBJECT' }))).element.result, 'OBJECT');
  assert.match(parseEnvelope('').error, /printed nothing/);
});
