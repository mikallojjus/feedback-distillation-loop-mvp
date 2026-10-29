#!/usr/bin/env node
// Geo query: send one read-only GraphQL query to Geo and print the answer, for Claude's own exploration (the import workflow, decision P38).
//
//   node agents/claim-tagger-mvp/scripts/geo-query.mjs (--query "<query ...>" | --query-file <file>) [--vars '<json>'] [--paginate <dot.path>] [--out <file>]
//
//   --query, --query-file  the document; it must start with "query" (name it, as in "query Pool { ... }") and name no mutation or subscription
//   --vars                 the variables, as a JSON object
//   --paginate             a dot path to a *Connection in the answer (for example relationsConnection): the query is sent again with variables.after set to
//                          pageInfo.endCursor until hasNextPage is false, and the answer is { nodes, pages }. The query must declare $after: Cursor and select
//                          pageInfo { hasNextPage endCursor }.
//   --out                  write the answer here (JSON) instead of printing it
//
// It goes through lib/geo-read.mjs and nothing else: the same send() the scripts use, so the same refusals hold (a document that does not start with
// "query" or that names a mutation or a subscription is refused before anything leaves the machine; no credential; no redirect; only geo.allowed_hosts).
// Every HTTP attempt is logged to runs/geo-query/<run-id>/requests.jsonl (time, host, operation name, status, attempt; never a body), and the log is
// counted back at the end: a request that was not a query makes exit 2. It writes no table anywhere.
//
// Exit codes: 0 ok; 1 Geo could not be read or answered an error; 2 invalid (usage, a refused document, a request that was not a query).
//
// Exports: runQueryCli, main, USAGE.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { GeoError, countGeoRequests, createGeoClient, geoRequestLogger } from './lib/geo-read.mjs';
import { agentRoot, ensureDir, isMain, runId as makeRunId } from './lib/paths.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/geo-query.mjs (--query "<query ...>" | --query-file <file>) [--vars \'<json>\'] [--paginate <dot.path>] [--out <file>]';
const MAX_PAGES = 1000;

const defaultIo = { out: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`) };
const at = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Send the query (and its pages); returns { code, data, line, logFile, requests }. */
export async function runQueryCli({ root = agentRoot(), config, document, variables, paginate, fetchImpl, now = () => new Date(), sleep } = {}) {
  const cfg = config ?? loadConfig(root);
  const runDir = ensureDir(join(root, 'runs', 'geo-query', makeRunId('geo-query', now())));
  const logFile = join(runDir, 'requests.jsonl');
  const client = createGeoClient({ geo: cfg.geo ?? cfg, fetchImpl, log: geoRequestLogger(logFile, { now }), sleep });
  let data;
  let error = null;
  try {
    if (!paginate) {
      data = await client.send(document, variables);
    } else {
      const nodes = [];
      let after = variables?.after ?? null;
      let pages = 0;
      for (;;) {
        const page = await client.send(document, { ...(variables ?? {}), after });
        const conn = at(page, paginate);
        if (!conn || !Array.isArray(conn.nodes)) throw new GeoError(`the answer has no connection with nodes at "${paginate}"`, { kind: 'shape' });
        nodes.push(...conn.nodes);
        pages += 1;
        if (!conn.pageInfo?.hasNextPage) break;
        if (pages >= MAX_PAGES) throw new GeoError(`stopped after ${MAX_PAGES} pages`, { kind: 'shape' });
        after = conn.pageInfo.endCursor;
      }
      data = { nodes, pages };
    }
  } catch (e) {
    if (!(e instanceof GeoError)) throw e;
    error = e;
  }
  const requests = countGeoRequests(logFile);
  if (requests.nonQuery > 0) return { code: EXIT.INVALID, line: `geo-query: ${requests.nonQuery} request(s) were not queries; see ${logFile}`, logFile, requests };
  if (error) {
    const mine = error.kind === 'config' || error.kind === 'refused';
    return { code: mine ? EXIT.INVALID : EXIT.ERROR, line: `geo-query: ${error.message}`, logFile, requests };
  }
  return { code: EXIT.OK, data, logFile, requests };
}

export async function main(argv, io = defaultIo, env = {}) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        query: { type: 'string' }, 'query-file': { type: 'string' }, vars: { type: 'string' }, paginate: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (e) {
    io.err(`geo-query: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  if ((args.query === undefined) === (args['query-file'] === undefined)) {
    io.err(`geo-query: give exactly one of --query and --query-file\n${USAGE}`);
    return EXIT.INVALID;
  }
  let document;
  let variables;
  try {
    document = args.query ?? readFileSync(args['query-file'], 'utf8');
    variables = args.vars === undefined ? undefined : JSON.parse(args.vars);
  } catch (e) {
    io.err(`geo-query: ${e.message}`);
    return EXIT.INVALID;
  }
  if (variables !== undefined && (variables === null || typeof variables !== 'object' || Array.isArray(variables))) {
    io.err('geo-query: --vars must be a JSON object');
    return EXIT.INVALID;
  }
  try {
    const r = await runQueryCli({ root: env.root, config: env.config, document, variables, paginate: args.paginate, fetchImpl: env.fetchImpl, now: env.now, sleep: env.sleep });
    if (r.code !== EXIT.OK) {
      io.err(r.line);
      return r.code;
    }
    const text = JSON.stringify(r.data, null, 1);
    if (args.out) {
      writeFileSync(args.out, `${text}\n`);
      io.out(`geo-query: ${r.requests.total} request(s), 0 that were not queries; the answer is in ${args.out}`);
    } else io.out(text);
    return EXIT.OK;
  } catch (e) {
    io.err(`geo-query: ${e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
