import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { USAGE, main, runQueryCli } from '../../agents/claim-tagger-mvp/scripts/geo-query.mjs';
import { countGeoRequests, debateTaggedQuery } from '../../agents/claim-tagger-mvp/scripts/lib/geo-read.mjs';
import { createFakeGeo, hexId } from './fixtures/fake-geo.mjs';

// geo-query.mjs (decision P38): Claude's own read-only questions to Geo. Nothing here touches the network: the fake Geo answers behind fetchImpl, and sleeps are not waited for.

const CONFIG = JSON.parse(readFileSync(new URL('../../agents/claim-tagger-mvp/config.json', import.meta.url), 'utf8'));
const GEO = CONFIG.geo;
const TECH = GEO.spaces[5].id;
const NOW = () => new Date('2026-10-29T09:00:00Z');
const noSleep = async () => {};
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A world: a state folder, a Geo fake with `claims` Debate-tagged claims in Technology, and the io that collects what main prints. */
function world({ claims = 5 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-geo-query-'));
  dirs.push(root);
  const geo = createFakeGeo({ geo: GEO });
  for (let i = 1; i <= claims; i++) geo.addClaim({ id: hexId(i), name: `Claim number ${i}`, spaces: [TECH], created: '2026-09-14' });
  const io = { outs: [], errs: [], out: (s) => io.outs.push(s), err: (s) => io.errs.push(s) };
  const env = { root, config: CONFIG, fetchImpl: geo.fetchImpl, now: NOW, sleep: noSleep };
  const run = (argv, over = {}) => main(argv, io, { ...env, ...over });
  const logFile = () => {
    const base = join(root, 'runs', 'geo-query');
    const folders = existsSync(base) ? readdirSync(base) : [];
    return folders.length === 0 ? null : join(base, folders[0], 'requests.jsonl');
  };
  return { root, geo, io, run, logFile };
}
/** The Debate query of a space, in the frozen shape (it declares $after and selects pageInfo), with `first` set. */
const debate = (first) => debateTaggedQuery(GEO, { spaceId: TECH, first }).document;

test('a plain query is sent and its answer is printed; the only header is Content-Type and the log holds queries only, one line per attempt, no body', async () => {
  const w = world();
  assert.equal(await w.run(['--query', debate(500), '--vars', '{"after":null}']), 0, w.io.errs.join('\n'));
  const answer = JSON.parse(w.io.outs.join('\n'));
  assert.equal(answer.relationsConnection.nodes.length, 5);
  assert.equal(answer.relationsConnection.pageInfo.hasNextPage, false);
  assert.equal(w.geo.requests.length, 1);
  assert.deepEqual(Object.keys(w.geo.requests[0].headers), ['Content-Type']);
  assert.equal(w.geo.requests[0].rejected, false);
  const log = w.logFile();
  assert.ok(log, 'a run folder under runs/geo-query');
  assert.match(log, /runs[\\/]geo-query[\\/]20261029T090000Z-geo-query[\\/]requests\.jsonl$/);
  assert.deepEqual(countGeoRequests(log), { total: 1, nonQuery: 0 });
  const line = JSON.parse(readFileSync(log, 'utf8').trim());
  assert.deepEqual(Object.keys(line).sort(), ['attempt', 'host', 'op', 'status', 'ts']);
  assert.deepEqual([line.host, line.op, line.status, line.attempt], ['api-testnet.geobrowser.io', 'DebateTagged', 200, 1]);
  assert.equal(readFileSync(log, 'utf8').includes('Claim number'), false, 'no answer and no query text in the log');
});

test('--query-file reads the document from a file and --out writes the answer there, saying that no request was other than a query', async () => {
  const w = world();
  const file = join(w.root, 'pool.graphql');
  const out = join(w.root, 'answer.json');
  writeFileSync(file, `\n${debate(500)}\n`);
  assert.equal(await w.run(['--query-file', file, '--out', out]), 0, w.io.errs.join('\n'));
  assert.equal(w.io.outs.length, 1);
  assert.equal(w.io.outs[0], `geo-query: 1 request(s), 0 that were not queries; the answer is in ${out}`);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).relationsConnection.nodes.length, 5);
});

test('--paginate follows endCursor until hasNextPage is false and gives { nodes, pages }', async () => {
  const w = world({ claims: 5 });
  assert.equal(await w.run(['--query', debate(2), '--paginate', 'relationsConnection']), 0, w.io.errs.join('\n'));
  const answer = JSON.parse(w.io.outs.join('\n'));
  assert.equal(answer.pages, 3);
  assert.deepEqual(answer.nodes.map((n) => n.fromEntityId), [1, 2, 3, 4, 5].map((i) => hexId(i)));
  assert.equal(w.geo.requests.length, 3);
  assert.equal(w.geo.requests[0].after, null);
  assert.equal(typeof w.geo.requests[1].after, 'string');
  assert.equal(typeof w.geo.requests[2].after, 'string');
  assert.notEqual(w.geo.requests[1].after, w.geo.requests[2].after, 'a new cursor each time');
  assert.deepEqual(countGeoRequests(w.logFile()), { total: 3, nonQuery: 0 });
  // a first page that holds everything is one request
  const one = world({ claims: 3 });
  assert.equal(await one.run(['--query', debate(500), '--paginate', 'relationsConnection']), 0);
  assert.equal(JSON.parse(one.io.outs.join('\n')).pages, 1);
  // a path that is not a connection with nodes is an error, not a loop
  const wrong = world();
  assert.equal(await wrong.run(['--query', debate(2), '--paginate', 'nothingThere']), 1);
  assert.match(wrong.io.errs.join('\n'), /no connection with nodes at "nothingThere"/);
});

test('a mutation, a subscription and a document that does not start with "query" are refused with exit 2 and nothing is fetched; the log has 0 non-queries', async () => {
  const refused = [
    'mutation { createEntity(id: "x") { id } }',
    '  \n mutation M { a }',
    'subscription S { a }',
    'query A { a } mutation B { b }',
    'query A { a } subscription B { b }',
    'query A { MUTATION }',
    '{ entity(id: "x") { id } }',
    'queryX { a }',
    'fragment F on Entity { id }',
    '# a comment first\nquery A { a }',
    '   ',
  ];
  for (const doc of refused) {
    const w = world();
    assert.equal(await w.run(['--query', doc]), 2, JSON.stringify(doc));
    assert.match(w.io.errs.join('\n'), /^geo-query: the Geo read path sends queries only: /, JSON.stringify(doc));
    assert.equal(w.geo.requests.length, 0, `nothing was fetched: ${JSON.stringify(doc)}`);
    assert.deepEqual(w.io.outs, [], 'nothing was printed as an answer');
    const log = w.logFile();
    assert.deepEqual(countGeoRequests(log), { total: 0, nonQuery: 0 }, 'the log has no non-query');
  }
  // the same through a file and with --paginate: the document is checked before the first page
  const w = world();
  const file = join(w.root, 'write.graphql');
  writeFileSync(file, 'mutation Write($after: Cursor) { relationsConnection { nodes { a } } }');
  assert.equal(await w.run(['--query-file', file, '--paginate', 'relationsConnection']), 2);
  assert.equal(w.geo.requests.length, 0);
  // a refused document through the function itself
  const direct = await runQueryCli({ root: w.root, config: CONFIG, document: 'mutation { a }', fetchImpl: w.geo.fetchImpl, now: NOW, sleep: noSleep });
  assert.equal(direct.code, 2);
  assert.deepEqual(direct.requests, { total: 0, nonQuery: 0 });
});

test('a request that was not a query makes exit 2: the log is counted back at the end', async () => {
  const w = world();
  const tampering = async (url, init) => {
    appendFileSync(w.logFile() ?? join(w.root, 'runs', 'geo-query', '20261029T090000Z-geo-query', 'requests.jsonl'), `${JSON.stringify({ ts: '2026-10-29T09:00:00.000Z', host: 'api-testnet.geobrowser.io', op: null, status: 200, attempt: 1 })}\n`);
    return w.geo.fetchImpl(url, init);
  };
  assert.equal(await w.run(['--query', debate(500)], { fetchImpl: tampering }), 2);
  assert.match(w.io.errs.join('\n'), /geo-query: 1 request\(s\) were not queries; see /);
  assert.deepEqual(w.io.outs, [], 'the answer is not printed when the log cannot be trusted');
});

test('Geo that cannot be read or answers an error is exit 1, not 2', async () => {
  for (const kind of ['500', '429', 'network', 'html', 'graphql']) {
    const w = world();
    w.geo.failNext(kind, Infinity);
    assert.equal(await w.run(['--query', debate(500)]), 1, kind);
    assert.match(w.io.errs.join('\n'), /^geo-query: /, kind);
    assert.deepEqual(w.io.outs, [], kind);
    assert.deepEqual(countGeoRequests(w.logFile()).nonQuery, 0, kind);
  }
});

test('a config whose endpoint is not on the allowed hosts sends nothing', async () => {
  const w = world();
  const config = { ...CONFIG, geo: { ...GEO, endpoint: 'https://evil.example.com/graphql' } };
  const code = await w.run(['--query', debate(500)], { config });
  assert.notEqual(code, 0);
  assert.equal(w.geo.requests.length, 0);
  assert.match(w.io.errs.join('\n'), /not in allowed_hosts/);
});

test('the command line: one of --query and --query-file, --vars a JSON object, no unknown option; --help prints the usage', async () => {
  const w = world();
  assert.equal(await w.run(['--help']), 0);
  assert.equal(w.io.outs[0], USAGE);
  const bad = async (argv, pattern) => {
    const x = world();
    assert.equal(await x.run(argv), 2, argv.join(' '));
    assert.match(x.io.errs.join('\n'), pattern, argv.join(' '));
    assert.equal(x.geo.requests.length, 0, 'nothing was fetched');
  };
  await bad([], /give exactly one of --query and --query-file/);
  await bad(['--query', 'query A { a }', '--query-file', 'x.graphql'], /give exactly one of --query and --query-file/);
  await bad(['--query', 'query A { a }', '--bogus'], /bogus/);
  await bad(['--query', 'query A { a }', '--vars', '{ not json'], /geo-query: /);
  await bad(['--query', 'query A { a }', '--vars', '[1, 2]'], /--vars must be a JSON object/);
  await bad(['--query', 'query A { a }', '--vars', 'null'], /--vars must be a JSON object/);
  await bad(['--query-file', join(w.root, 'there-is-no-such-file.graphql')], /geo-query: /);
  assert.match(USAGE, /--query "<query \.\.\.>" \| --query-file <file>\) \[--vars/);
});
