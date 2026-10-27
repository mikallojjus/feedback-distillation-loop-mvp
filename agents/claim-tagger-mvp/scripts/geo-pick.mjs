#!/usr/bin/env node
// Geo pick: choose the 200 Geo claims tagged Debate that the Claims table is seeded with (decision P6), reading Geo with queries only.
//
//   node agents/claim-tagger-mvp/scripts/geo-pick.mjs --seed <string> --audit <audit json> [--replace] [--out <file>]
//
//   --seed     any text; the same seed and the same Geo data give the same pick, byte for byte
//   --audit    the audit decisions file (setup/audit-decisions.json): its geo_id values are forced into the pick when Geo tags them Debate
//   --replace  overwrite an existing pick file (without it an existing file is never touched)
//   --out      write the pick here instead of setup/geo-claims-pick.json
//
// It writes the pick file (schemas/geo-pick.schema.json) and a run folder runs/geo-pick/<run-id>/ with report.md, report.json and requests.jsonl (the
// log of every HTTP attempt: time, host, operation name, status, attempt, never a body). It reads only Geo, only through lib/geo-read.mjs, and writes
// no table anywhere: Notion is not touched.
//
// The rules (P6, HUB-AND-GEO-CLAIMS.md):
//   Population   per space, every claim tagged Debate in that space whose entity has the Claim type and a name that is not empty after trimming,
//                one entry per claim. A claim tagged in several spaces stays in the first space in canonical order (every such case is recorded).
//   Month        the UTC month (YYYY-MM) of createdAt (Unix seconds). The month that holds over half of all claims is flagged in the report as likely
//                the migration month, because createdAt is flattened on migrated entities.
//   Audit        a claim named by the audit file that is in a population is forced into its space and its month and counts toward the quota; one that is
//                in no population is left out and named with the reason.
//   Allocation   a space with quota q and m months present gives each month floor(q/m), capped at the month's claims; the rest goes one at a time to the
//                months that still have room, oldest first, until q is placed. Forced claims fill their month's share first (a month never gets fewer
//                than its forced claims).
//   Shortfall    a space with fewer claims than its quota passes the rest round-robin to the other spaces in canonical order, each while it has room.
//   Sampling     inside a month, a seeded shuffle (lib/rng.mjs, seeded by seed|space id|month) of the claim ids sorted ascending; the first ones not
//                already picked are taken.
//   Same text    no two picked claims have the same normalised name (lower case, white space collapsed, a final full stop dropped); the later one in the
//                sample is skipped and recorded. If that leaves a space short, the month with the fewest picks gives one more, and a space that has run
//                out passes the rest to the others the same round-robin way.
//   Details      read only for the picked claims, in batches; the space's own Name value wins over entity.name.
//
// Exit codes: 0 ok; 1 Geo could not be read (the same command resumes: nothing is written until the pick is complete); 2 invalid (usage, a bad config,
// an existing pick without --replace, a pick that fails its schema, fewer usable claims in Geo than the total).
//
// Exports: runPick, main, USAGE, allocateMonths, planTargets, normaliseName, monthOf, dayOf.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './lib/config.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { sha256Hex } from './lib/hash.mjs';
import {
  GEO_ID, GeoError, countGeoRequests, createGeoClient, entityIsStub, geoRequestLogger, readClaim, validateGeoConfig,
} from './lib/geo-read.mjs';
import { readJson, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { agentRoot, codeFile, ensureDir, isMain, repoRoot, runId as makeRunId } from './lib/paths.mjs';
import { mulberry32, sample, seedFromString } from './lib/rng.mjs';
import { validate } from './lib/validate.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/geo-pick.mjs --seed <string> --audit <audit json> [--replace] [--out <file>]';
const NOT_CANONICAL = 'not tagged Debate in a canonical space';
const DOMINANT_NOTE = 'likely the migration month (createdAt is flattened on migrated entities)';
const MIGRATION_SHARE = 0.5;

const byCodePoints = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (list) => list.reduce((s, n) => s + n, 0);
const sortedObject = (map) => Object.fromEntries([...map.entries()].sort((a, b) => byCodePoints(a[0], b[0])));
const bump = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const posix = (p) => p.split('\\').join('/');
const normId = (v) => String(v ?? '').replace(/-/g, '').toLowerCase();

// ---- small pure helpers ---------------------------------------------------------------------------------------------------------

/** The text two claims are compared on: lower case, white space collapsed, a final full stop dropped. */
export function normaliseName(name) {
  return String(name ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/\.$/, '').trim();
}

function dateOf(createdAt) {
  if (createdAt === null || createdAt === undefined || createdAt === '') return null;
  const seconds = Number(createdAt);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const d = new Date(seconds * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The UTC month YYYY-MM of a createdAt in Unix seconds, or null when it is not a time. */
export function monthOf(createdAt) {
  return dateOf(createdAt)?.slice(0, 7) ?? null;
}

/** The UTC date YYYY-MM-DD of a createdAt in Unix seconds, or null when it is not a time. */
export function dayOf(createdAt) {
  return dateOf(createdAt)?.slice(0, 10) ?? null;
}

/**
 * How many claims each month gives to a space quota. months: [{ month, pop, forced }] oldest first (pop = the claims of the month, forced = the audit claims
 * among them). Each free month gets floor(quota / free months) capped at pop; the rest goes one at a time to the months with room, oldest first. A month
 * whose share is smaller than its forced claims is pinned at its forced count and the rest is shared again among the others. Returns a Map month -> count.
 */
export function allocateMonths(quota, months) {
  const target = Math.min(quota, sum(months.map((m) => m.pop)));
  const out = new Map(months.map((m) => [m.month, 0]));
  const pinned = new Set();
  for (;;) {
    const free = months.filter((m) => !pinned.has(m.month));
    if (free.length === 0) break;
    const left = target - sum([...pinned].map((k) => out.get(k)));
    const base = Math.max(0, Math.floor(left / free.length));
    let grew = false;
    for (const m of free) {
      out.set(m.month, Math.min(base, m.pop));
      if (out.get(m.month) < m.forced) {
        out.set(m.month, m.forced);
        pinned.add(m.month);
        grew = true;
      }
    }
    if (grew) continue;
    let rest = left - sum(free.map((m) => out.get(m.month)));
    while (rest > 0) {
      let placed = false;
      for (const m of free) {
        if (rest === 0) break;
        if (out.get(m.month) < m.pop) {
          out.set(m.month, out.get(m.month) + 1);
          rest -= 1;
          placed = true;
        }
      }
      if (!placed) break;
    }
    break;
  }
  return out;
}

// Pass `left` claims of the space `from` round-robin to the other spaces in canonical order, one each, while `give(space)` says it took one.
function passOn(spaces, from, left, give, moves) {
  let rest = left;
  while (rest > 0) {
    let gave = false;
    for (const to of spaces) {
      if (rest === 0) break;
      if (to.name === from.name || !give(to)) continue;
      rest -= 1;
      gave = true;
      const key = `${from.name}\u0000${to.name}`;
      const move = moves.get(key) ?? { from: from.name, to: to.name, count: 0 };
      move.count += 1;
      moves.set(key, move);
    }
    if (!gave) break;
  }
  return rest;
}

/**
 * The claims each space will give once the shortfall is spread. spaces: [{ name, quota }] in canonical order; populations: Map name -> number of claims.
 * A space with fewer claims than its quota takes all it has and passes the rest round-robin (canonical order, one at a time, only to a space that still
 * has claims left). Returns { targets, moved_in, moved_out, moves: [{ from, to, count }], unplaced } as Maps and a list.
 */
export function planTargets(spaces, populations) {
  const targets = new Map();
  const room = new Map();
  const movedIn = new Map();
  const movedOut = new Map();
  for (const s of spaces) {
    const pop = populations.get(s.name) ?? 0;
    targets.set(s.name, Math.min(s.quota, pop));
    room.set(s.name, pop - Math.min(s.quota, pop));
    movedIn.set(s.name, 0);
    movedOut.set(s.name, s.quota - Math.min(s.quota, pop));
  }
  const moves = new Map();
  let unplaced = 0;
  for (const from of spaces) {
    unplaced += passOn(spaces, from, movedOut.get(from.name), (to) => {
      if (room.get(to.name) <= 0) return false;
      room.set(to.name, room.get(to.name) - 1);
      targets.set(to.name, targets.get(to.name) + 1);
      bump(movedIn, to.name);
      return true;
    }, moves);
  }
  return { targets, moved_in: movedIn, moved_out: movedOut, moves: [...moves.values()], unplaced };
}

// ---- reading the populations ----------------------------------------------------------------------------------------------------

function readPopulation(nodes, space, geo) {
  const claims = new Map();
  const dropped = { not_claim: 0, empty_name: 0, bad_id: 0, no_created_at: 0, repeat_edges: 0, other_space: 0 };
  const notes = [];
  for (const node of nodes) {
    if (node.spaceId && normId(node.spaceId) !== space.id) {
      dropped.other_space += 1;
      continue;
    }
    const entity = node.fromEntity;
    const id = normId(entity?.id ?? node.fromEntityId);
    if (!GEO_ID.test(id)) {
      dropped.bad_id += 1;
      continue;
    }
    if (!Array.isArray(entity?.typeIds) || !entity.typeIds.map(normId).includes(geo.ids.claim_type)) {
      dropped.not_claim += 1;
      notes.push({ id, space: space.name, why: 'the entity is not a Claim' });
      continue;
    }
    const name = typeof entity.name === 'string' ? entity.name.trim() : '';
    if (name === '') {
      dropped.empty_name += 1;
      notes.push({ id, space: space.name, why: 'the claim has no name' });
      continue;
    }
    const month = monthOf(entity.createdAt);
    if (!month) {
      dropped.no_created_at += 1;
      notes.push({ id, space: space.name, why: 'the claim has no creation time' });
      continue;
    }
    if (claims.has(id)) {
      dropped.repeat_edges += 1;
      continue;
    }
    claims.set(id, { id, name, created_at: Number(entity.createdAt), month, space: space.name });
  }
  return { claims, dropped, notes, edges: nodes.length };
}

// ---- the audit file -------------------------------------------------------------------------------------------------------------

function readAudit(auditFile) {
  const absolute = resolve(auditFile);
  let bytes;
  try {
    bytes = readFileSync(absolute);
  } catch (e) {
    return { error: `the audit file cannot be read (${e.message})` };
  }
  let json;
  try {
    json = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    return { error: `the audit file is not valid JSON (${e.message})` };
  }
  const ids = (json?.decisions ?? []).map((d) => normId(d?.geo_id)).filter((v) => v !== '');
  if (ids.length === 0) return { error: 'the audit file has no decisions[].geo_id' };
  const badId = ids.find((id) => !GEO_ID.test(id));
  if (badId) return { error: `the audit file has a geo_id that is not a Geo id: ${badId.slice(0, 40)}` };
  if (new Set(ids).size !== ids.length) return { error: 'the audit file repeats a geo_id' };
  const rel = relative(repoRoot(), absolute);
  const shown = rel === '' || rel.startsWith('..') || isAbsolute(rel) ? posix(absolute) : posix(rel);
  return { ids, sha256: sha256Hex(bytes), file: shown };
}

// ---- the report -----------------------------------------------------------------------------------------------------------------

function table(header, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

function renderReport(r) {
  const out = [];
  const titleState = r.state === 'ok' ? 'done' : r.state === 'invalid' ? 'not written, the data is not enough or not valid' : 'stopped, nothing written';
  out.push(`# Geo claims pick (${titleState})`, '');
  out.push(`- Seed: \`${r.seed}\``, `- Endpoint: ${r.endpoint}`, `- Read at: ${r.fetched_at}`);
  out.push(r.state === 'ok' ? `- Result: ${r.rows} claims written to \`${r.pick_file}\`` : `- Result: ${r.result}`);
  out.push(`- Geo requests: ${r.requests.total} sent, ${r.requests.nonQuery} that were not queries (must be 0)`, '');

  if (r.fetch) {
    out.push('## Populations', '', 'Claims tagged Debate, per space, after the checks (Claim type, a name, a creation time, one entry per claim, the first canonical space for a claim in several).', '');
    out.push(table(
      ['Space', 'Links read', 'Claims', 'Not a Claim', 'No name', 'No creation time', 'Repeat links', 'Also in an earlier space'],
      r.spaces.map((s) => {
        const f = r.fetch[s];
        return [s, f.edges, r.populations[s].total, f.dropped.not_claim, f.dropped.empty_name, f.dropped.no_created_at, f.dropped.repeat_edges, f.cross_space_removed];
      }),
    ), '');
    out.push('### Claims per month', '');
    const months = [...new Set(r.spaces.flatMap((s) => Object.keys(r.populations[s].months)))].sort(byCodePoints);
    out.push(table(['Month', ...r.spaces, 'All'], months.map((m) => [m, ...r.spaces.map((s) => r.populations[s].months[m] ?? 0), r.month_totals[m] ?? 0])), '');
    out.push(r.dominant_month
      ? `**${r.dominant_month.month} holds ${Math.round(r.dominant_month.share * 100)}% of all claims (${r.dominant_month.count} of ${r.dominant_month.of}): ${DOMINANT_NOTE}.** The even split over months still draws from every month.`
      : `No month holds more than ${Math.round(MIGRATION_SHARE * 100)}% of all claims.`, '');
  }

  if (r.allocation) {
    out.push('## Allocation', '');
    out.push(table(
      ['Space', 'Quota', 'Claims', 'Moved out', 'Moved in', 'Picked', 'Picked per month'],
      r.spaces.map((s) => {
        const a = r.allocation[s];
        return [s, a.quota, r.populations[s].total, a.moved_out, a.moved_in, a.picked, Object.entries(a.months).map(([m, n]) => `${m}: ${n}`).join(', ')];
      }),
    ), '');
    out.push('### Moves', '');
    const moves = [...r.shortfall_moves.map((m) => ({ ...m, why: 'the space has fewer claims than its quota' })), ...r.duplicate_moves.map((m) => ({ ...m, why: 'same-text claims left the space short' }))];
    out.push(...(moves.length ? moves.map((m) => `- ${m.from} -> ${m.to}: ${plural(m.count, 'claim')} (${m.why})`) : ['No space was short of its quota.']), '');
  }

  if (r.duplicates) {
    out.push('## Duplicates', '', `### In more than one space (${r.duplicates.cross_space.length})`, '');
    out.push(...(r.duplicates.cross_space.length ? r.duplicates.cross_space.map((d) => `- \`${d.geo_id}\` "${d.name}": kept in ${d.kept_in}, also tagged in ${d.also_in.join(', ')}`) : ['None.']), '');
    out.push(`### Same text (${r.duplicates.text.length})`, '');
    out.push(...(r.duplicates.text.length ? r.duplicates.text.map((d) => `- \`${d.geo_id}\` "${d.name}" (${d.space}, ${d.month}) skipped: same text as \`${d.same_as}\` (${d.same_as_space})`) : ['None.']), '');
  }

  if (r.audit) {
    out.push('## Audit claims', '', `File: \`${r.audit.file}\` (sha256 \`${r.audit.sha256}\`)`, '');
    out.push(`- Included (${r.audit.included.length}): ${r.audit.included.length ? r.audit.included.map((id) => `\`${id}\``).join(', ') : 'none'}`);
    out.push(`- Left out (${r.audit.left_out.length}):`);
    out.push(...(r.audit.left_out.length ? r.audit.left_out.map((l) => `  - \`${l.geo_id}\`: ${l.reason}`) : ['  - none']), '');
  }

  if (r.details) {
    out.push('## Details', '');
    out.push(`- Name taken from the space's own Name value: ${r.details.name_own}; from entity.name instead: ${r.details.name_fallback}`);
    out.push(`- Sources: ${r.details.sources} in all, ${r.details.sources_without_web_url} without a Web URL (their Geo link is used)`);
    out.push(`- Claims whose month in the details is the month of the Debate listing: ${r.details.month_matches} of ${r.rows}`, '');
  }

  out.push('## Warnings', '', ...(r.warnings.length ? r.warnings.map((w) => `- ${w}`) : ['None.']), '');
  out.push('## Requests', '', `Geo was asked ${plural(r.geo_stats.attempts, 'time')} (${plural(r.geo_stats.retries, 'retry', 'retries')}, ${plural(r.geo_stats.pages, 'page')} of Debate links, ${plural(r.geo_stats.detail_batches, 'detail batch', 'detail batches')}, page size halved ${plural(r.geo_stats.halvings, 'time')}). The log is requests.jsonl next to this file.`, '');
  if (r.resume) out.push('## To resume', '', 'Nothing was written to the pick file. Run the same command again:', '', `    ${r.resume}`, '');
  return `${out.join('\n')}\n`;
}

// ---- the pick -------------------------------------------------------------------------------------------------------------------

const quoteArg = (s) => (/[\s"']/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s);

/**
 * Pick the claims. opts: root (state folder), config (default: <root>/config.json), seed, auditFile, replace, out, and the hooks fetchImpl, now, sleep.
 * Returns { code, line, resume, pick, path, runDir, report } and never prints.
 */
export async function runPick(opts = {}) {
  const { root = agentRoot(), seed, auditFile, replace = false, out, fetchImpl = globalThis.fetch, now = () => new Date(), sleep } = opts;
  const resume = ['node agents/claim-tagger-mvp/scripts/geo-pick.mjs', '--seed', quoteArg(String(seed ?? '<seed>')), '--audit', quoteArg(String(auditFile ?? '<audit json>')), ...(replace ? ['--replace'] : []), ...(out ? ['--out', quoteArg(out)] : [])].join(' ');
  const stop = (code, line, extra = {}) => ({ code, line, resume: null, pick: null, path: null, runDir: null, report: null, ...extra });

  if (typeof seed !== 'string' || seed.trim() === '') return stop(EXIT.INVALID, `geo-pick: --seed <string> is required (the same seed and the same Geo data give the same pick)\n${USAGE}`);
  if (typeof auditFile !== 'string' || auditFile.trim() === '') return stop(EXIT.INVALID, `geo-pick: --audit <path to the audit json> is required\n${USAGE}`);

  let config = opts.config;
  if (!config) {
    try {
      config = loadConfig(root);
    } catch (e) {
      return stop(EXIT.INVALID, `geo-pick: ${e.message}`);
    }
  }
  const checked = validateGeoConfig(config);
  if (!checked.ok) return stop(EXIT.INVALID, `geo-pick: the geo block of config.json is not valid:\n- ${checked.errors.join('\n- ')}`);
  const geo = checked.geo;

  const audit = readAudit(auditFile);
  if (audit.error) return stop(EXIT.INVALID, `geo-pick: ${audit.error}`);

  const target = out ? resolve(out) : join(root, 'setup', 'geo-claims-pick.json');
  if (existsSync(target) && !replace) return stop(EXIT.INVALID, `geo-pick: ${target} already exists; it is left as it is. Add --replace to write a new pick over it.`);

  const startedAt = now();
  const id = makeRunId('geo-pick', startedAt);
  let runDir = join(root, 'runs', 'geo-pick', id);
  for (let n = 2; existsSync(runDir); n++) runDir = join(root, 'runs', 'geo-pick', `${id}-${n}`);
  ensureDir(runDir);
  const requestsFile = join(runDir, 'requests.jsonl');
  const fetchedAt = startedAt.toISOString();

  const client = createGeoClient({ geo, fetchImpl, log: geoRequestLogger(requestsFile, { now }), sleep });
  const spaces = geo.spaces;
  const warnings = [];
  const report = { report_version: 1, state: 'ok', run_id: id, seed, endpoint: geo.endpoint, fetched_at: fetchedAt, spec: { total: geo.total, spaces }, warnings };

  const finish = (code, state, problem, extra = {}) => {
    report.state = state;
    report.result = problem;
    report.requests = countGeoRequests(requestsFile);
    report.geo_stats = { ...client.stats };
    report.resume = state === 'stopped' ? resume : null;
    Object.assign(report, extra);
    writeJsonAtomic(join(runDir, 'report.json'), report);
    writeTextAtomic(join(runDir, 'report.md'), renderReport({ ...report, spaces: spaces.map((s) => s.name), pick_file: posix(target) }));
    return stop(code, `geo-pick: ${problem}`, { resume: state === 'stopped' ? resume : null, runDir, report });
  };

  try {
    // 1. the populations
    const fetchInfo = {};
    const perSpace = new Map();
    const edgeNotes = new Map();
    for (const space of spaces) {
      const nodes = await client.paginateDebate(space.id);
      const pop = readPopulation(nodes, space, geo);
      perSpace.set(space.name, pop);
      fetchInfo[space.name] = { edges: pop.edges, dropped: pop.dropped, cross_space_removed: 0 };
      for (const n of pop.notes) edgeNotes.set(n.id, [...(edgeNotes.get(n.id) ?? []), n]);
    }

    // 2. a claim in more than one space stays in the first space in canonical order
    const owner = new Map();
    const crossSpace = new Map();
    for (const space of spaces) {
      const claims = perSpace.get(space.name).claims;
      for (const claim of [...claims.values()]) {
        const first = owner.get(claim.id);
        if (!first) {
          owner.set(claim.id, claim);
          continue;
        }
        claims.delete(claim.id);
        fetchInfo[space.name].cross_space_removed += 1;
        const entry = crossSpace.get(claim.id) ?? { geo_id: claim.id, name: first.name, kept_in: first.space, also_in: [] };
        entry.also_in.push(space.name);
        crossSpace.set(claim.id, entry);
      }
    }
    const duplicates = { cross_space: [...crossSpace.values()].sort((a, b) => byCodePoints(a.geo_id, b.geo_id)), text: [] };

    // 3. the months of each space
    const stateOf = new Map(); // space name -> { months: [month], by: Map month -> { order, pos, picked } }
    const populations = {};
    const monthTotals = new Map();
    for (const space of spaces) {
      const claims = [...perSpace.get(space.name).claims.values()].sort((a, b) => byCodePoints(a.id, b.id));
      const byMonth = new Map();
      for (const c of claims) byMonth.set(c.month, [...(byMonth.get(c.month) ?? []), c]);
      const months = [...byMonth.keys()].sort(byCodePoints);
      const by = new Map();
      for (const month of months) {
        const list = byMonth.get(month);
        const order = sample(list, list.length, mulberry32(seedFromString(`${seed}|${space.id}|${month}`)));
        by.set(month, { list, order, pos: 0, picked: [] });
        bump(monthTotals, month, list.length);
      }
      stateOf.set(space.name, { space, months, by });
      populations[space.name] = { total: claims.length, months: sortedObject(new Map(months.map((m) => [m, byMonth.get(m).length]))) };
    }
    const allClaims = sum([...monthTotals.values()]);
    let dominant = null;
    for (const [month, count] of [...monthTotals.entries()].sort((a, b) => byCodePoints(a[0], b[0]))) {
      if (allClaims > 0 && count / allClaims > MIGRATION_SHARE && (!dominant || count > dominant.count)) dominant = { month, count, of: allClaims, share: count / allClaims };
    }
    Object.assign(report, { fetch: fetchInfo, populations, month_totals: sortedObject(monthTotals), dominant_month: dominant });

    // 4. the picking state shared by every step below
    const registry = new Map(); // normalised name -> { id, space }
    const skip = new Set(); // ids that are never sampled (an audit claim set aside as a same-text duplicate)
    const taken = new Set();
    const take = (space, month, claim, forced) => {
      taken.add(claim.id);
      registry.set(normaliseName(claim.name), { id: claim.id, space: space.name });
      stateOf.get(space.name).by.get(month).picked.push({ claim, forced });
    };
    const nextValid = (space, month) => {
      const m = stateOf.get(space.name).by.get(month);
      while (m.pos < m.order.length) {
        const c = m.order[m.pos];
        if (taken.has(c.id) || skip.has(c.id)) {
          m.pos += 1;
          continue;
        }
        const twin = registry.get(normaliseName(c.name));
        if (twin) {
          duplicates.text.push({ geo_id: c.id, name: c.name, space: space.name, month, same_as: twin.id, same_as_space: twin.space });
          skip.add(c.id);
          m.pos += 1;
          continue;
        }
        return c;
      }
      return null;
    };
    const pickedCount = (space) => sum([...stateOf.get(space.name).by.values()].map((m) => m.picked.length));
    // one more claim from the month with the fewest picks (oldest first on a tie) that still has a claim to give
    const pickOne = (space) => {
      let best = null;
      for (const month of stateOf.get(space.name).months) {
        const c = nextValid(space, month);
        if (!c) continue;
        const count = stateOf.get(space.name).by.get(month).picked.length;
        if (!best || count < best.count) best = { month, c, count };
      }
      if (!best) return false;
      take(space, best.month, best.c, false);
      return true;
    };

    // 5. the audit claims that are in a population are forced in, in the audit file's order
    const included = [];
    const reasons = new Map();
    const unexplained = [];
    for (const idv of audit.ids) {
      const claim = owner.get(idv);
      if (claim) {
        const twin = registry.get(normaliseName(claim.name));
        const space = spaces.find((s) => s.name === claim.space);
        if (twin) {
          reasons.set(idv, `same text as the audit claim ${twin.id}, which is already in the pick`);
          duplicates.text.push({ geo_id: claim.id, name: claim.name, space: claim.space, month: claim.month, same_as: twin.id, same_as_space: twin.space });
          skip.add(claim.id);
        } else {
          take(space, claim.month, claim, true);
          included.push(idv);
        }
      } else if (edgeNotes.has(idv)) {
        const n = edgeNotes.get(idv)[0];
        reasons.set(idv, `tagged Debate in ${n.space}, but it is not counted: ${n.why}`);
      } else {
        unexplained.push(idv);
      }
    }

    // 6. the shortfall, then the months of every space
    const plan = planTargets(spaces.map((s) => ({ name: s.name, quota: s.quota })), new Map(spaces.map((s) => [s.name, populations[s.name].total])));
    for (const space of spaces) {
      const st = stateOf.get(space.name);
      const goal = plan.targets.get(space.name);
      const forcedBy = (m) => st.by.get(m).picked.filter((p) => p.forced).length;
      const forcedTotal = sum(st.months.map(forcedBy));
      if (forcedTotal > goal) {
        return finish(EXIT.INVALID, 'invalid', `${space.name} has ${plural(forcedTotal, 'audit claim')} but a target of only ${goal}; raise its quota or shorten the audit file`);
      }
      const shares = allocateMonths(goal, st.months.map((m) => ({ month: m, pop: st.by.get(m).list.length, forced: forcedBy(m) })));
      for (const month of st.months) {
        const need = shares.get(month) - forcedBy(month);
        for (let i = 0; i < need; i++) {
          const c = nextValid(space, month);
          if (!c) break;
          take(space, month, c, false);
        }
      }
      // same-text claims may have left a month short: give from the other months of the space
      while (pickedCount(space) < goal && pickOne(space)) { /* one more each time */ }
    }

    // 7. a space that ran out of unique claims passes the rest on
    const dupMoves = new Map();
    const movedIn = new Map(plan.moved_in);
    const movedOut = new Map(plan.moved_out);
    for (const from of spaces) {
      const lacking = plan.targets.get(from.name) - pickedCount(from);
      if (lacking <= 0) continue;
      movedOut.set(from.name, movedOut.get(from.name) + lacking);
      passOn(spaces, from, lacking, (to) => {
        if (!pickOne(to)) return false;
        bump(movedIn, to.name);
        return true;
      }, dupMoves);
    }

    const allocation = {};
    for (const space of spaces) {
      const st = stateOf.get(space.name);
      allocation[space.name] = {
        quota: space.quota,
        picked: pickedCount(space),
        months: sortedObject(new Map(st.months.map((m) => [m, st.by.get(m).picked.length]))),
        moved_in: movedIn.get(space.name),
        moved_out: movedOut.get(space.name),
      };
    }
    Object.assign(report, { allocation, shortfall_moves: plan.moves, duplicate_moves: [...dupMoves.values()], duplicates });

    // 8. the audit claims that no population holds: say why
    if (unexplained.length) {
      try {
        const found = await client.details(unexplained);
        for (const idv of unexplained) {
          const entity = found.get(idv);
          const spacesTagged = new Set();
          for (const r of entity?.relations?.nodes ?? []) if (r?.typeId === geo.ids.tags && normId(r?.toEntity?.id) === geo.ids.debate && r?.spaceId) spacesTagged.add(normId(r.spaceId));
          const outside = [...spacesTagged].filter((s) => !spaces.some((x) => x.id === s)).sort(byCodePoints);
          if (entityIsStub(entity)) reasons.set(idv, `${NOT_CANONICAL} (Geo holds no such entity)`);
          else if (outside.length) reasons.set(idv, `${NOT_CANONICAL} (tagged Debate in space ${outside[0]}, which is not one of the ${spaces.length} pick spaces)`);
          else reasons.set(idv, NOT_CANONICAL);
        }
      } catch (e) {
        if (!(e instanceof GeoError)) throw e;
        for (const idv of unexplained) reasons.set(idv, NOT_CANONICAL);
        warnings.push(`the audit claims that no space holds could not be looked up in Geo (${e.message}); their reason is the general one`);
      }
    }
    const leftOut = audit.ids.filter((idv) => reasons.has(idv)).map((idv) => ({ geo_id: idv, reason: reasons.get(idv) }));

    // 9. the details of the picked claims
    const picked = [];
    for (const space of spaces) {
      const st = stateOf.get(space.name);
      for (const month of st.months) for (const p of st.by.get(month).picked) picked.push({ space, month, claim: p.claim });
    }
    picked.sort((a, b) => spaces.indexOf(a.space) - spaces.indexOf(b.space) || byCodePoints(a.month, b.month) || byCodePoints(a.claim.id, b.claim.id));
    if (picked.length !== geo.total) {
      return finish(EXIT.INVALID, 'invalid', `Geo holds only enough usable claims for ${picked.length} of the ${geo.total}; nothing was written`);
    }
    const entities = await client.details(picked.map((p) => p.claim.id));
    const browser = geo.browser_url.replace(/\/+$/, '');
    const detailStats = { name_own: 0, name_fallback: 0, sources: 0, sources_without_web_url: 0, month_matches: 0 };
    const rows = picked.map(({ space, month, claim }) => {
      const entity = entities.get(claim.id);
      let f;
      if (entityIsStub(entity)) {
        warnings.push(`${claim.id}: Geo gave no details, so the row has only what the Debate listing held (no sources, tags or topics)`);
        f = { name: claim.name, name_source: 'fallback', created_at: claim.created_at, is_factual: null, tags: [], topics: [], sources: [], truncated: false };
      } else {
        f = readClaim(entity, { geo, spaceId: space.id });
        if (f.truncated) warnings.push(`${claim.id}: a list of values or relations came back full (100), so some may be cut off`);
      }
      detailStats[f.name_source === 'own' ? 'name_own' : 'name_fallback'] += 1;
      detailStats.sources += f.sources.length;
      detailStats.sources_without_web_url += f.sources.filter((s) => !s.has_web_url).length;
      const created = f.created_at ?? claim.created_at;
      if (monthOf(created) === month) detailStats.month_matches += 1;
      else warnings.push(`${claim.id}: createdAt in the details (${monthOf(created)}) differs from the Debate listing (${month}); the listing's month is used`);
      return {
        'Geo Name': f.name || claim.name,
        'Geo ID': claim.id,
        'Geo URL': `${browser}/space/${space.id}/${claim.id}`,
        'Geo Space': space.name,
        'Geo Created': dayOf(created),
        'Geo Sources': f.sources.map((s) => s.name).join('\n'),
        source_pieces: f.sources.map((s) => ({ name: s.name, url: s.url })),
        'Geo Is factual': f.is_factual,
        'Geo Tags': f.tags,
        'Geo Topics': f.topics.join('\n'),
        month,
      };
    });
    const tagNames = [...new Set(rows.flatMap((r) => r['Geo Tags']))].sort(byCodePoints);

    // 10. the pick file
    const pick = {
      pick_version: 1,
      seed,
      endpoint: geo.endpoint,
      fetched_at: fetchedAt,
      spec: { total: geo.total, spaces: spaces.map((s) => ({ name: s.name, id: s.id, quota: s.quota })) },
      populations,
      duplicates,
      allocation,
      audit: { file: audit.file, sha256: audit.sha256, included, left_out: leftOut },
      tag_names: tagNames,
      rows,
    };
    const schema = readJson(codeFile(root, 'schemas', 'geo-pick.schema.json'));
    const verdict = validate(schema, pick);
    Object.assign(report, { audit: pick.audit, details: detailStats, rows: rows.length });
    if (!verdict.ok) return finish(EXIT.INVALID, 'invalid', `the pick does not fit its schema, so it was not written:\n- ${verdict.errors.slice(0, 10).join('\n- ')}`);
    writeJsonAtomic(target, pick);
    const counts = `${rows.length} claims (${included.length} from the audit, ${leftOut.length} audit ${leftOut.length === 1 ? 'claim' : 'claims'} left out, seed "${seed}")`;
    const done = finish(EXIT.OK, 'ok', `${counts} -> ${target}`);
    return { ...done, line: `geo-pick: ${counts} -> ${target}`, pick, path: target };
  } catch (e) {
    if (!(e instanceof GeoError)) throw e;
    return finish(EXIT.ERROR, 'stopped', `Geo could not be read: ${e.message}`);
  }
}

// ---- command line ---------------------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Run the script; returns the exit code. env (tests): { root, config, fetchImpl, now, sleep }. */
export async function main(argv, io = defaultIo, env = {}) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: { seed: { type: 'string' }, audit: { type: 'string' }, replace: { type: 'boolean' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (e) {
    io.err(`geo-pick: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  try {
    const r = await runPick({ root: env.root, config: env.config, seed: args.seed, auditFile: args.audit, replace: args.replace === true, out: args.out, fetchImpl: env.fetchImpl, now: env.now, sleep: env.sleep });
    (r.code === EXIT.OK ? io.out : io.err)(r.line);
    if (r.resume) io.err(`geo-pick: to resume, run the same command again: ${r.resume}`);
    if (r.code === EXIT.OK && r.report?.warnings?.length) io.err(`geo-pick: ${plural(r.report.warnings.length, 'warning')}; see ${join(r.runDir, 'report.md')}`);
    return r.code;
  } catch (e) {
    io.err(`geo-pick: ${e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
