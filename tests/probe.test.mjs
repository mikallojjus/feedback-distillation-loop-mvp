import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { normId } from '../agents/claim-tagger/scripts/lib/notion-values.mjs';
import {
  EXPECTED_TITLES, MAX_REQUESTS_PER_SECOND, USAGE, formatLine, judge, main, probe, summaryLine, targetsOf,
} from '../agents/claim-tagger/scripts/probe.mjs';
import { realConfig } from './fixtures/notion/fake-notion.mjs';

const TOKEN = 'ntn_FAKE_PROBE_TOKEN_0123456789';
const PROTECTED = ['d1307596-e531-420f-8688-2485f3ef28ab', '9e979fe1-e03d-45cd-b9b1-d971dc3d90a2'];
const CONFIGURED = {
  rulebook: '89043d4a749041ffb834f96a5239e148',
  claims: '9418c3f625d24b439539f381b7ff03c2',
  tag_decisions: 'de7a08f6d3ae4c08b9387e6d762d79f2',
  rule_changes: '833efad0634f43608ca18e4f7291cc02',
  runs: '0c397590fb154ddb98010830faaa159b',
  agent_settings: '43c8a1c3a8d44a7f824698b4789cffe6',
};

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-agents-probe-'));
  dirs.push(d);
  return d;
};

const dashed = (id) => {
  const h = normId(id);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const makeConfig = ({ protectedIds = PROTECTED, rps = 3, apiVersion = '2022-06-28' } = {}) => ({
  notion: {
    api_version: apiVersion,
    requests_per_second: rps,
    databases: Object.fromEntries(Object.entries(CONFIGURED).map(([db, id]) => [db, { database_id: id, data_source_id: `ds-${db}`, key: 'Name' }])),
    protected_database_ids: [...protectedIds],
  },
});

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = (id) => json(404, { object: 'error', status: 404, code: 'object_not_found', message: `Could not find database with ID: ${id}. Make sure the relevant pages and databases are shared with your integration.` });
const restricted = () => json(403, { object: 'error', status: 403, code: 'restricted_resource', message: 'Insufficient permissions for this endpoint.' });
const database = (id, title) => json(200, { object: 'database', id: dashed(id), title: [{ type: 'text', plain_text: title, text: { content: title } }], properties: {} });
const networkError = (code = 'ECONNRESET') => Object.assign(new TypeError('fetch failed'), { cause: { code } });

/** A fake Notion for the probe: configured ids answer 200 with their title, everything else 404; `answers` (by id) overrides one. A fake clock records when every call started. */
function rig(config, answers = {}) {
  let t = Date.parse('2026-10-13T12:00:00.000Z');
  const calls = [];
  const sleeps = [];
  const titles = new Map(Object.entries(config.notion.databases).map(([db, cfg]) => [normId(cfg.database_id), EXPECTED_TITLES[db]]));
  const fetchImpl = async (url, init = {}) => {
    const id = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    calls.push({ url, method: init.method, headers: init.headers, id, at: t, signal: init.signal });
    const answer = answers[normId(id)];
    const res = typeof answer === 'function' ? answer(id) : answer;
    if (res instanceof Error) throw res;
    if (res) return res.clone();
    return titles.has(normId(id)) ? database(id, titles.get(normId(id))) : notFound(id);
  };
  return { fetchImpl, calls, sleeps, now: () => new Date(t), sleep: async (ms) => { sleeps.push(ms); t += ms; } };
}

function captureIo() {
  const out = [];
  const err = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
}

/** Run main against the rig. Without repoRoot the token is given directly (null = none); with repoRoot it is read from <repoRoot>/.env. */
async function run(argv, { config = makeConfig(), answers = {}, token = TOKEN, repoRoot = null, extra = {} } = {}) {
  const r = rig(config, answers);
  const cap = captureIo();
  const env = { config, fetchImpl: r.fetchImpl, now: r.now, sleep: r.sleep, ...(repoRoot ? { repoRoot } : { token }), ...extra };
  const code = await main(argv, cap.io, env);
  return { code, out: cap.out, err: cap.err, calls: r.calls, sleeps: r.sleeps, text: [...cap.out, ...cap.err].join('\n') };
}

// ---- the happy path ------------------------------------------------------------------------------------------------------------

test('protected ids answer 404 and configured ids 200 with the right title: one line per id, a summary, exit 0', async () => {
  const r = await run([]);
  assert.equal(r.code, EXIT.OK, r.text);
  assert.deepEqual(r.err, []);
  assert.equal(r.out.length, 8 + 1, 'one line per id plus the summary');
  assert.match(r.out[0], /^d1307596-e531-420f-8688-2485f3ef28ab\s+protected\s+404\s+ok\s+object_not_found$/);
  assert.match(r.out[1], /^9e979fe1-e03d-45cd-b9b1-d971dc3d90a2\s+protected\s+404\s+ok\s+object_not_found$/);
  assert.match(r.out[2], /^89043d4a749041ffb834f96a5239e148\s+configured\s+200\s+ok\s+rulebook "Rulebook"$/);
  assert.match(r.out[7], /^43c8a1c3a8d44a7f824698b4789cffe6\s+configured\s+200\s+ok\s+agent_settings "Agent settings"$/);
  assert.equal(r.out[8], 'probe: 8 id(s) with Notion-Version 2022-06-28: 2 of 2 protected not reachable, 6 of 6 configured answering with the right title; all ok');
  assert.ok(r.out.slice(0, 8).every((l) => !l.includes('NOT OK')));
});

test('every id is asked once with GET /v1/databases/<id>, the bearer token and the Notion-Version of the config; nothing else is sent', async () => {
  const config = makeConfig({ apiVersion: '2022-06-28' });
  const r = await run([], { config });
  assert.equal(r.code, EXIT.OK);
  assert.deepEqual(r.calls.map((c) => c.id), [...PROTECTED, ...Object.values(CONFIGURED)]);
  for (const c of r.calls) {
    assert.equal(c.method, 'GET');
    assert.equal(c.url, `https://api.notion.com/v1/databases/${c.id}`);
    assert.deepEqual(c.headers, { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28' });
    assert.ok(c.signal instanceof AbortSignal, 'a timeout is set');
  }
  const other = await run([], { config: makeConfig({ apiVersion: '2025-09-03' }) });
  assert.ok(other.calls.every((c) => c.headers['Notion-Version'] === '2025-09-03'), 'the version comes from config.notion.api_version');
  assert.match(other.out.at(-1), /Notion-Version 2025-09-03/);
});

test('403 restricted_resource is as good as 404 object_not_found for a protected id', async () => {
  const r = await run([], { answers: { [normId(PROTECTED[0])]: restricted() } });
  assert.equal(r.code, EXIT.OK, r.text);
  assert.match(r.out[0], /protected\s+403\s+ok\s+restricted_resource$/);
});

test('an answer without a body is enough when the status is 404 or 403', async () => {
  const bare = new Response('', { status: 404 });
  const r = await run([], { answers: { [normId(PROTECTED[0])]: bare, [normId(PROTECTED[1])]: new Response('<html>', { status: 403 }) } });
  assert.equal(r.code, EXIT.OK, r.text);
});

// ---- findings: exit 4 --------------------------------------------------------------------------------------------------------

test('a protected id that answers 200 is reachable: NOT OK on its line, exit 4, and its title is not printed or kept', async () => {
  const leak = database(PROTECTED[1], 'Claims to review');
  const dir = tmp();
  const record = join(dir, 'probe.json');
  const r = await run(['--record', record], { answers: { [normId(PROTECTED[1])]: leak } });
  assert.equal(r.code, EXIT.DRIFT);
  assert.match(r.out[0], /protected\s+404\s+ok/);
  assert.match(r.out[1], /^9e979fe1-e03d-45cd-b9b1-d971dc3d90a2\s+protected\s+200\s+NOT OK\s+REACHABLE/);
  assert.match(r.out.at(-1), /; 1 NOT OK$/);
  assert.match(r.err.join('\n'), /a protected database is reachable/);
  assert.equal(r.text.includes('Claims to review'), false);
  const saved = JSON.parse(readFileSync(record, 'utf8'));
  assert.equal(saved.ok, false);
  assert.equal(JSON.stringify(saved).includes('Claims to review'), false);
  const hit = saved.results.find((x) => x.id === PROTECTED[1]);
  assert.deepEqual([hit.status, hit.ok, hit.failure], [200, false, 'reachable']);
  assert.equal('title' in hit, false);
});

test('a protected id with any other answer proves nothing: NOT OK, exit 4', async () => {
  const cases = {
    'validation error': json(400, { object: 'error', status: 400, code: 'validation_error', message: 'path failed validation' }),
    'refused token': json(401, { object: 'error', status: 401, code: 'unauthorized', message: 'API token is invalid.' }),
    'wrong error code': json(404, { object: 'error', status: 404, code: 'invalid_request_url', message: 'Invalid request URL.' }),
    'code of the other status': json(403, { object: 'error', status: 403, code: 'object_not_found', message: 'x' }),
    reachable: json(200, { object: 'list', results: [] }),
  };
  for (const [name, answer] of Object.entries(cases)) {
    const r = await run([], { answers: { [normId(PROTECTED[0])]: answer } });
    assert.equal(r.code, EXIT.DRIFT, name);
    assert.match(r.out[0], /protected\s+\d+\s+NOT OK/, name);
  }
});

test('a configured database that does not answer 200 is NOT OK, exit 4 (not shared, refused token, wrong title, wrong database, not a database)', async () => {
  const id = CONFIGURED.claims;
  const cases = [
    ['not shared', notFound(id), /configured\s+404\s+NOT OK\s+answered 404 object_not_found, expected 200; is the page "Editorial feedback loop" shared/],
    ['refused token', json(401, { object: 'error', status: 401, code: 'unauthorized', message: 'x' }), /configured\s+401\s+NOT OK\s+answered 401: the token was refused/],
    ['wrong title', database(id, 'Claims to review'), /configured\s+200\s+NOT OK\s+answered 200 with the title "Claims to review", expected "Claims"/],
    ['another database', database(CONFIGURED.runs, 'Claims'), /configured\s+200\s+NOT OK\s+answered 200 for database 0c397590-fb15-4ddb-9801-0830faaa159b, not 9418c3f625d24b439539f381b7ff03c2/],
    ['not a database', json(200, { object: 'page', id: dashed(id), title: [] }), /configured\s+200\s+NOT OK\s+answered 200 but the object is "page"/],
  ];
  for (const [name, answer, line] of cases) {
    const r = await run([], { answers: { [normId(id)]: answer } });
    assert.equal(r.code, EXIT.DRIFT, name);
    assert.match(r.out.find((l) => l.startsWith(id)), line, name);
    assert.match(r.err.join('\n'), /does not reach what it should/, name);
  }
});

test('a title is matched exactly, and a configured key that is not in the table is expected under its own name', async () => {
  const r = await run([], { answers: { [normId(CONFIGURED.runs)]: database(CONFIGURED.runs, 'runs') } });
  assert.equal(r.code, EXIT.DRIFT);
  assert.match(r.out.find((l) => l.startsWith(CONFIGURED.runs)), /expected "Runs"/);
  const config = makeConfig();
  config.notion.databases.lesson_cards = { database_id: 'aaaaaaaabbbbccccddddeeeeeeeeeeee' };
  const extra = await run([], { config, answers: { aaaaaaaabbbbccccddddeeeeeeeeeeee: database('aaaaaaaabbbbccccddddeeeeeeeeeeee', 'Lesson cards') } });
  assert.equal(extra.code, EXIT.OK, extra.text);
  assert.match(extra.out.find((l) => l.startsWith('aaaaaaaa')), /lesson_cards "Lesson cards"/);
});

// ---- no usable answer: exit 1 ------------------------------------------------------------------------------------------------

test('a network failure is exit 1 and says which id got no answer', async () => {
  const r = await run([], { answers: { [normId(CONFIGURED.claims)]: networkError('ECONNRESET') } });
  assert.equal(r.code, EXIT.ERROR);
  assert.match(r.out.find((l) => l.startsWith(CONFIGURED.claims)), /configured\s+error\s+NOT OK\s+no answer \(ECONNRESET\)$/);
  assert.match(r.err.join('\n'), /no usable answer/);
  assert.equal(r.calls.length, 8, 'the other ids were still asked');
});

test('a timeout, a 429 and a 5xx are also exit 1: they say nothing about access', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  for (const [name, answer, line] of [
    ['timeout', timeout, /no answer \(timed out after 15000 ms\)/],
    ['rate limit', json(429, { object: 'error', status: 429, code: 'rate_limited', message: 'slow down' }), /answered 429 rate_limited, so this id was not checked/],
    ['server error', json(503, { object: 'error', status: 503, code: 'service_unavailable', message: 'x' }), /answered 503 service_unavailable/],
  ]) {
    const protectedRun = await run([], { answers: { [normId(PROTECTED[0])]: answer } });
    assert.equal(protectedRun.code, EXIT.ERROR, `${name} on a protected id`);
    assert.match(protectedRun.out[0], line, name);
    const configuredRun = await run([], { answers: { [normId(CONFIGURED.runs)]: answer } });
    assert.equal(configuredRun.code, EXIT.ERROR, `${name} on a configured id`);
  }
});

test('a reachable protected id outranks a failed request: exit 4, not 1', async () => {
  const r = await run([], { answers: { [normId(PROTECTED[0])]: database(PROTECTED[0], 'x'), [normId(CONFIGURED.claims)]: networkError() } });
  assert.equal(r.code, EXIT.DRIFT);
});

test('the token never appears in the output, whatever the network error says', async () => {
  const leaky = Object.assign(new TypeError(`fetch failed for Bearer ${TOKEN}`), { cause: { message: TOKEN } });
  const r = await run([], { answers: { [normId(CONFIGURED.claims)]: leaky } });
  assert.equal(r.code, EXIT.ERROR);
  assert.equal(r.text.includes(TOKEN), false);
  assert.match(r.text, /\[token\]/);
});

// ---- no token / bad input: exit 2 --------------------------------------------------------------------------------------------

test('no token: exit 2, nothing asked, nothing recorded', async () => {
  const dir = tmp();
  const record = join(dir, 'probe.json');
  const none = await run(['--record', record], { token: null });
  assert.equal(none.code, EXIT.INVALID);
  assert.match(none.err.join('\n'), /there is no NOTION_TOKEN in \.env/);
  assert.deepEqual(none.calls, []);
  assert.deepEqual(none.out, []);
  assert.equal(existsSync(record), false);
  // a repo root without a .env, with an empty one, and with the placeholder from .env.example
  const repo = tmp();
  assert.equal((await run([], { repoRoot: repo })).code, EXIT.INVALID);
  writeFileSync(join(repo, '.env'), 'NOTION_TOKEN=\n');
  assert.equal((await run([], { repoRoot: repo })).code, EXIT.INVALID);
  writeFileSync(join(repo, '.env'), 'NOTION_TOKEN=ntn_replace_me\n');
  const placeholder = await run([], { repoRoot: repo });
  assert.equal(placeholder.code, EXIT.INVALID);
  assert.deepEqual(placeholder.calls, []);
});

test('the token is read from <repoRoot>/.env and appears in no output and no record', async () => {
  const repo = tmp();
  const secret = 'ntn_FAKE_ENV_TOKEN_ZYXWVUTSRQ';
  writeFileSync(join(repo, '.env'), `NOTION_TOKEN=${secret}\n`);
  const record = join(tmp(), 'out', 'probe.json');
  const r = await run(['--record', record], { repoRoot: repo });
  assert.equal(r.code, EXIT.OK, r.text);
  assert.ok(r.calls.length > 0 && r.calls.every((c) => c.headers.Authorization === `Bearer ${secret}`));
  assert.equal(r.text.includes(secret), false);
  assert.equal(readFileSync(record, 'utf8').includes(secret), false);
});

test('arguments: unknown options, --record without a path, a stray word; --help prints the usage', async () => {
  for (const argv of [['--bogus'], ['--record'], ['--record', ''], ['stray'], ['--record', 'a.json', '--record', 'b.json', 'c']]) {
    const r = await run(argv);
    assert.equal(r.code, EXIT.INVALID, argv.join(' '));
    assert.deepEqual(r.calls, [], argv.join(' '));
  }
  const help = await run(['--help']);
  assert.equal(help.code, EXIT.OK);
  assert.deepEqual(help.out, [USAGE]);
  assert.deepEqual(help.calls, []);
});

test('a config that cannot be probed is exit 2 before any request: no database_id, an entry that is no id, nothing to probe', async () => {
  const noId = makeConfig();
  delete noId.notion.databases.claims.database_id;
  const bad = makeConfig({ protectedIds: [42] });
  const empty = makeConfig({ protectedIds: [] });
  empty.notion.databases = {};
  for (const [name, config, pattern] of [['no database_id', noId, /databases\.claims has no database_id/], ['not an id', bad, /not an id/], ['nothing', empty, /names no database to probe/]]) {
    const r = await run([], { config });
    assert.equal(r.code, EXIT.INVALID, name);
    assert.match(r.err.join('\n'), pattern, name);
    assert.deepEqual(r.calls, [], name);
  }
});

test('an empty protected list still probes the configured databases, with a warning that it proves nothing about the real ones', async () => {
  const r = await run([], { config: makeConfig({ protectedIds: [] }) });
  assert.equal(r.code, EXIT.OK, r.text);
  assert.equal(r.calls.length, 6);
  assert.match(r.err.join('\n'), /warning: config\.json lists no protected database ids/);
});

test('a protected id listed twice (dashes or not, any case) is asked once', async () => {
  const config = makeConfig({ protectedIds: [PROTECTED[0], normId(PROTECTED[0]).toUpperCase(), PROTECTED[1], PROTECTED[1]] });
  const r = await run([], { config });
  assert.equal(r.code, EXIT.OK, r.text);
  assert.equal(r.calls.length, 2 + 6);
  assert.equal(r.calls.filter((c) => c.id === PROTECTED[1]).length, 1);
});

// ---- pacing: at most 3 requests per second ---------------------------------------------------------------------------------------

test('requests start at least 334 ms apart, so no second ever holds more than 3', async () => {
  const r = await run([], { config: makeConfig({ rps: 3 }) });
  assert.equal(MAX_REQUESTS_PER_SECOND, 3);
  assert.equal(r.calls.length, 8);
  for (let i = 1; i < r.calls.length; i++) assert.ok(r.calls[i].at - r.calls[i - 1].at >= 334, `gap before call ${i}: ${r.calls[i].at - r.calls[i - 1].at} ms`);
  for (const c of r.calls) assert.ok(r.calls.filter((o) => o.at >= c.at && o.at < c.at + 1000).length <= 3, `window from call at ${c.at}`);
});

test('a configured rate above 3 is capped at 3, a lower rate is respected, a nonsense rate means 3', async () => {
  const gapOf = async (rps) => {
    const r = await run([], { config: makeConfig({ rps }) });
    return Math.min(...r.calls.slice(1).map((c, i) => c.at - r.calls[i].at));
  };
  assert.ok(await gapOf(50) >= 334);
  assert.ok(await gapOf(1) >= 1000);
  assert.ok(await gapOf(0) >= 334);
  assert.ok(await gapOf('fast') >= 334);
  assert.ok(await gapOf(undefined) >= 334);
});

test('a slow answer does not add a wait: the gap counts from the start of the previous request', async () => {
  const config = makeConfig();
  const base = rig(config);
  const sleeps = [];
  let t = 0;
  const slow = async (url, init) => {
    t += 700; // each request itself takes 700 ms of the fake clock
    return base.fetchImpl(url, init);
  };
  const result = await probe({ config, token: TOKEN, fetchImpl: slow, now: () => new Date(t), sleep: async (ms) => { sleeps.push(ms); t += ms; } });
  assert.equal(result.code, EXIT.OK);
  assert.equal(base.calls.length, 8);
  assert.deepEqual(sleeps, [], 'nothing to wait for: 700 ms is already more than the gap');
});

// ---- the record ---------------------------------------------------------------------------------------------------------------

test('--record writes { at, results, ok } and nothing else at the top level, creating the folder; the token is not in it', async () => {
  const record = join(tmp(), 'evidence', 'deeper', 'probe.json');
  const r = await run(['--record', record]);
  assert.equal(r.code, EXIT.OK, r.text);
  const saved = JSON.parse(readFileSync(record, 'utf8'));
  assert.deepEqual(Object.keys(saved), ['at', 'results', 'ok']);
  assert.match(saved.at, /^2026-10-13T12:00:0\d\.\d{3}Z$/);
  assert.equal(saved.ok, true);
  assert.equal(saved.results.length, 8);
  assert.deepEqual(saved.results[0], { id: PROTECTED[0], kind: 'protected', status: 404, code: 'object_not_found', ok: true });
  assert.deepEqual(saved.results[2], { id: CONFIGURED.rulebook, kind: 'configured', db: 'rulebook', status: 200, code: null, ok: true, title: 'Rulebook', expected_title: 'Rulebook' });
  assert.equal(JSON.stringify(saved).includes(TOKEN), false);
  assert.equal(r.out.length, 9, 'recording adds no output');
});

test('--record also keeps a failing result, with the reason', async () => {
  const record = join(tmp(), 'probe.json');
  const r = await run(['--record', record], { answers: { [normId(CONFIGURED.tag_decisions)]: notFound(CONFIGURED.tag_decisions) } });
  assert.equal(r.code, EXIT.DRIFT);
  const saved = JSON.parse(readFileSync(record, 'utf8'));
  assert.equal(saved.ok, false);
  const bad = saved.results.find((x) => x.db === 'tag_decisions');
  assert.deepEqual([bad.status, bad.code, bad.ok, bad.failure], [404, 'object_not_found', false, 'unexpected']);
  assert.match(bad.reason, /expected 200/);
  assert.equal(saved.results.filter((x) => x.ok).length, 7);
});

test('a record that cannot be written is exit 1 when the probe was fine, and does not hide a finding', async () => {
  const dir = tmp();
  const blocker = join(dir, 'a-file');
  writeFileSync(blocker, 'x');
  const fine = await run(['--record', join(blocker, 'probe.json')]); // a folder cannot be made under a file
  assert.equal(fine.code, EXIT.ERROR);
  assert.match(fine.err.join('\n'), /could not write/);
  const finding = await run(['--record', join(blocker, 'probe.json')], { answers: { [normId(PROTECTED[0])]: database(PROTECTED[0], 'x') } });
  assert.equal(finding.code, EXIT.DRIFT);
});

// ---- the pieces -----------------------------------------------------------------------------------------------------------------

test('targetsOf: protected ids first (de-duplicated), then every configured database; judge, formatLine and summaryLine', () => {
  const targets = targetsOf(makeConfig());
  assert.deepEqual(targets.map((t) => [t.kind, t.id]), [...PROTECTED.map((id) => ['protected', id]), ...Object.values(CONFIGURED).map((id) => ['configured', id])]);
  assert.deepEqual(targets.at(-1), { id: CONFIGURED.agent_settings, kind: 'configured', db: 'agent_settings' });

  const protectedId = { id: PROTECTED[0], kind: 'protected' };
  assert.equal(judge(protectedId, 404, { code: 'object_not_found' }).ok, true);
  assert.equal(judge(protectedId, 403, { code: 'restricted_resource' }).ok, true);
  assert.equal(judge(protectedId, 404, null).ok, true);
  assert.equal(judge(protectedId, 200, { object: 'database' }).failure, 'reachable');
  assert.equal(judge(protectedId, 201, {}).failure, 'reachable');
  assert.equal(judge(protectedId, 429, {}).failure, 'error');
  assert.equal(judge(protectedId, 502, null).failure, 'error');
  assert.equal(judge(protectedId, 400, { code: 'validation_error' }).failure, 'unexpected');

  const line = formatLine({ id: 'abc', kind: 'protected', status: null, ok: false, reason: 'no answer (ECONNRESET)' }, 6);
  assert.equal(line, 'abc     protected   error  NOT OK  no answer (ECONNRESET)');
  assert.equal(formatLine({ id: 'abc', kind: 'protected', status: 404, code: null, ok: true }, 3), 'abc  protected   404    ok', 'no trailing spaces');
  assert.equal(summaryLine([{ kind: 'protected', ok: true }, { kind: 'configured', ok: false }], 'v1'), 'probe: 2 id(s) with Notion-Version v1: 1 of 1 protected not reachable, 0 of 1 configured answering with the right title; 1 NOT OK');
});

test('probe(): a token and a fetch function are required', async () => {
  await assert.rejects(() => probe({ config: makeConfig(), token: '', fetchImpl: async () => notFound('x') }), /a token is required/);
  await assert.rejects(() => probe({ config: makeConfig(), token: TOKEN, fetchImpl: 'nope' }), /fetchImpl must be a function/);
});

test('the real config.json: every protected id and every configured database is asked once, and a fake Notion that agrees gives exit 0', async () => {
  const config = realConfig();
  const protectedIds = new Set(config.notion.protected_database_ids.map(normId));
  const r = await run([], { config });
  assert.equal(r.code, EXIT.OK, r.text);
  assert.equal(r.calls.length, protectedIds.size + Object.keys(config.notion.databases).length);
  assert.equal(new Set(r.calls.map((c) => normId(c.id))).size, r.calls.length, 'no id twice');
  assert.ok(r.calls.every((c) => c.headers['Notion-Version'] === config.notion.api_version));
  for (const [db, cfg] of Object.entries(config.notion.databases)) assert.ok(r.calls.some((c) => normId(c.id) === normId(cfg.database_id)), db);
  for (const id of config.notion.protected_database_ids) assert.ok(r.calls.some((c) => normId(c.id) === normId(id)), id);
});

test('a probe is a reader: nothing but GET is ever sent, to api.notion.com/v1/databases only', async () => {
  const r = await run([]);
  assert.ok(r.calls.every((c) => c.method === 'GET' && c.url.startsWith('https://api.notion.com/v1/databases/') && !c.url.includes('?')));
});
