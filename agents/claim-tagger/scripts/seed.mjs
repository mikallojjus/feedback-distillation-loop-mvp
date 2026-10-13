#!/usr/bin/env node
// Seed: build the plans that fill the trial databases once. It writes plans only; plan.mjs check and apply.mjs do the rest.
//
//   node agents/claim-tagger/scripts/seed.mjs --phase 1|2|3 [--run <id>]
//
//   phase 1  Rulebook (one row per tag of rubric/rubric.json) and the Agent settings row { Name, Weekly cap, Rubric in force }
//   phase 2  Claims from evals/seed/claims.seed.jsonl, merged with evals/seed/sources-fill.json when it exists (it fills the sources
//            count, source URLs and Geo link that the seed leaves empty); Agent tags resolved to Rulebook rows by name
//   phase 3  Tag decisions from evals/seed/decisions.seed.jsonl: Key, Claim, Tag, the agent's proposal and notes, Seeded outcome,
//            Seeded reasoning (prefixed "<hint>: " where the seed carries a why_wrong_hint) and Seeded at. Never Tag outcome.
//
// Each phase reads the id map of the newest pull (runs/pull/LATEST), so run pull.mjs --all before phase 1 (it also fetches the
// schemas) and again after applying each phase. Rows that already exist in Notion are left out, so a phase can be run again.
// The plan carries ctx.seed, which is what lets the allowlist accept seed-only fields (and Weekly cap on the new settings row).
// Exit codes: 0 plan written (or nothing to do), 2 invalid (no pull, earlier phase missing, unreadable seed files, run id used), 1 error.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { EXIT } from './lib/exit-codes.mjs';
import { readJson, readJsonl } from './lib/jsonl.mjs';
import { agentRoot, isMain, repoRoot as defaultRepoRoot, runId as makeRunId } from './lib/paths.mjs';
import { buildRubric, composeWhenToUse, rubricToRows, scrubNames } from './lib/rubric-build.mjs';
import { PlanError, openPlan } from './plan.mjs';
import { latestPullId, loadConfig, loadPull } from './pull.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/seed.mjs --phase 1|2|3 [--run <id>]';

class SeedError extends Error {}

// ---- phase 1: the rubric ------------------------------------------------------------------------------------------

const mapStrings = (value, fn) => {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  return value;
};

/** rubric/rubric.json when it exists; otherwise the research fixture with names replaced by roles (config.anonymise) and every hash recomputed. */
export function loadRubricForSeed({ root, config, fixturePath }) {
  const file = join(root, 'rubric', 'rubric.json');
  if (existsSync(file)) return { rubric: readJson(file), source: 'rubric/rubric.json' };
  if (!existsSync(fixturePath)) throw new SeedError(`there is no ${file} and no fixture at ${fixturePath} to build one from`);
  const replacements = config.anonymise?.replacements;
  if (!Array.isArray(replacements)) throw new SeedError('config.json has no anonymise.replacements list; refusing to copy a rubric that may name people');
  const fixture = readJson(fixturePath);
  const scrubbed = mapStrings(fixture, (s) => scrubNames(s, replacements));
  const rubric = buildRubric(rubricToRows(scrubbed), { version: fixture.rubric_version, source: scrubbed.source ?? {} });
  return { rubric, source: 'the research fixture (names replaced by roles)' };
}

/** The Rulebook row (plain property values) for one tag of a rubric. */
export function rulebookProps(tag, rubric) {
  const props = {
    'Tag title': tag.name,
    Status: tag.status ?? 'Verified',
    Category: tag.category ?? null,
    Polarity: tag.polarity ?? null,
    ...(tag.counterpart ? { Counterpart: tag.counterpart } : {}),
    Description: tag.description ?? '',
    'Example claims': (tag.example_claims ?? []).join('\n'),
    'When to use': composeWhenToUse(tag.when_to_use),
    'Human only': tag.human_only === true,
    Judged: tag.judged === true,
    'Rule version': rubric.rubric_version,
    'Tag hash': tag.tag_hash,
  };
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== null && v !== undefined));
}

// ---- seed files ----------------------------------------------------------------------------------------------------

function readSeedJsonl(seedDir, name) {
  const file = join(seedDir, name);
  if (!existsSync(file)) throw new SeedError(`${file} does not exist (run seed-build.mjs first)`);
  let rows;
  try {
    ({ rows } = readJsonl(file));
  } catch (e) {
    throw new SeedError(e.message);
  }
  if (rows.length === 0) throw new SeedError(`${file} is empty`);
  return rows;
}

/** sources-fill.json rows by Geo ID: accepts { rows: { <geo id>: {...} } }, { <geo id>: {...} } or [{ geo_id, ... }]. */
export function readSourcesFill(seedDir) {
  const file = join(seedDir, 'sources-fill.json');
  if (!existsSync(file)) return new Map();
  let json;
  try {
    json = readJson(file);
  } catch (e) {
    throw new SeedError(e.message);
  }
  const body = json.rows ?? json.claims ?? json;
  const entries = Array.isArray(body) ? body.map((r) => [r.geo_id, r]) : Object.entries(body).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
  return new Map(entries.filter(([id]) => typeof id === 'string'));
}

/** Seed claims with the fill merged in: the fill supplies what the seed has empty; a conflicting value stays as the seed has it. */
export function mergeClaims(claims, fill) {
  const conflicts = [];
  let filled = 0;
  const merged = claims.map((c) => {
    const f = fill.get(c.geo_id);
    if (!f) return c;
    const out = { ...c };
    let used = false;
    if (f.sources_count !== undefined && f.sources_count !== null) {
      if (c.sources_count === null || c.sources_count === undefined) { out.sources_count = f.sources_count; used = true; }
      else if (c.sources_count !== f.sources_count) conflicts.push(`${c.geo_id}: sources_count ${c.sources_count} (seed) vs ${f.sources_count} (fill)`);
    }
    if (Array.isArray(f.source_urls) && f.source_urls.length && (!Array.isArray(c.source_urls) || c.source_urls.length === 0)) { out.source_urls = f.source_urls; used = true; }
    if (f.geo_link && !c.geo_link) { out.geo_link = f.geo_link; used = true; }
    if (used) filled += 1;
    return out;
  });
  return { claims: merged, filled, conflicts };
}

export function claimProps(claim, tagIds) {
  const props = { 'Claim title': claim.claim, 'Geo ID': claim.geo_id };
  if (claim.geo_link) props['Geo link'] = claim.geo_link;
  if (claim.sources_count !== null && claim.sources_count !== undefined) props['Sources count'] = claim.sources_count;
  if (Array.isArray(claim.source_urls) && claim.source_urls.length) props['Source URLs'] = claim.source_urls.join('\n');
  if (claim.table) props.Table = claim.table;
  if (claim.sample) props.Sample = claim.sample;
  if (tagIds.length) props['Agent tags'] = tagIds;
  return props;
}

export function decisionProps(row, ids) {
  const props = {
    Key: row.key,
    Claim: [ids.claim],
    Tag: [ids.tag],
    'Agent proposal': row.agent_proposal,
    'Why I recommend this': row.why_i_recommend_this ?? null,
    'Agent full note': row.agent_full_note ?? null,
    'Why in queue': row.why_in_queue,
    Priority: row.priority,
    'Rubric version': row.rubric_version,
  };
  if (row.seeded_outcome) props['Seeded outcome'] = row.seeded_outcome;
  if (row.seeded_reasoning) props['Seeded reasoning'] = row.why_wrong_hint ? `${row.why_wrong_hint}: ${row.seeded_reasoning}` : row.seeded_reasoning;
  if (row.seeded_at) props['Seeded at'] = row.seeded_at;
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== null && v !== undefined));
}

// ---- building a phase ----------------------------------------------------------------------------------------------

/**
 * Build the plan of one phase. Returns { code, line, runId, counts, notes } (code 0 with runId null when there is nothing to do).
 * env: { seedDir, fixturePath, repoRoot, now, runId }.
 */
export function seedPhase({ root = agentRoot(), config = loadConfig(root), phase, runId, seedDir = join(root, 'evals', 'seed'), fixturePath, now = () => new Date() }) {
  if (![1, 2, 3].includes(phase)) throw new SeedError(`phase must be 1, 2 or 3, got ${phase}`);
  const pullId = latestPullId(root);
  if (!pullId) throw new SeedError('there is no pull yet: run pull.mjs --all first (the plan needs the schemas and the id map)');
  const pull = loadPull(root, pullId, { config });
  const idMap = pull.idMap ?? {};
  const need = { 1: ['rulebook', 'agent_settings'], 2: ['claims', 'rulebook'], 3: ['tag_decisions', 'claims', 'rulebook'] }[phase];
  for (const db of need) {
    if (!pull.covers(db) && !(idMap.carried && db in idMap.carried)) throw new SeedError(`pull ${pull.id} does not include ${db}: run pull.mjs --all`);
  }
  const id = runId ?? makeRunId(`seed-phase${phase}`, now());
  const plan = openPlan({ runId: id, root, config, pull, ctx: { seed: true }, now });
  const notes = [];
  const counts = {};
  let existing = 0;

  if (phase === 1) {
    const { rubric, source } = loadRubricForSeed({ root, config, fixturePath });
    notes.push(`rubric ${rubric.rubric_version} from ${source}`);
    counts.rulebook = 0;
    for (const tag of rubric.tags) {
      if (idMap.rulebook?.[tag.name]) { existing += 1; continue; }
      plan.create('rulebook', tag.name, rulebookProps(tag, rubric));
      counts.rulebook += 1;
    }
    const name = config.agent ?? 'claim-tagger';
    if (idMap.agent_settings?.[name]) existing += 1;
    else {
      plan.create('agent_settings', name, { Name: name, 'Weekly cap': config.queue?.weekly_cap_default ?? 40, 'Rubric in force': rubric.rubric_version });
      counts.agent_settings = 1;
    }
  }

  if (phase === 2) {
    if (Object.keys(idMap.rulebook ?? {}).length === 0) throw new SeedError('the Rulebook is empty in the id map: apply phase 1 and run pull.mjs --all before phase 2');
    const merged = mergeClaims(readSeedJsonl(seedDir, 'claims.seed.jsonl'), readSourcesFill(seedDir));
    if (merged.filled) notes.push(`filled ${merged.filled} claim(s) from sources-fill.json`);
    for (const c of merged.conflicts) notes.push(`kept the seed value, conflict: ${c}`);
    const dropped = new Map();
    counts.claims = 0;
    for (const claim of merged.claims) {
      if (idMap.claims?.[claim.geo_id]) { existing += 1; continue; }
      const tagIds = [];
      for (const name of claim.agent_tags ?? []) {
        if (idMap.rulebook?.[name]) tagIds.push(idMap.rulebook[name]);
        else dropped.set(name, (dropped.get(name) ?? 0) + 1);
      }
      plan.create('claims', claim.geo_id, claimProps(claim, tagIds));
      counts.claims += 1;
    }
    for (const [name, n] of dropped) notes.push(`dropped unknown agent tag "${name}" on ${n} claim(s)`);
  }

  if (phase === 3) {
    const rows = readSeedJsonl(seedDir, 'decisions.seed.jsonl');
    const unresolved = [];
    counts.tag_decisions = 0;
    for (const row of rows) {
      if (idMap.tag_decisions?.[row.key]) { existing += 1; continue; }
      const claim = idMap.claims?.[row.geo_id];
      const tag = idMap.rulebook?.[row.tag];
      if (!claim) unresolved.push(`${row.key}: no claim ${row.geo_id} in Notion (apply phase 2 and pull first)`);
      else if (!tag) unresolved.push(`${row.key}: no Rulebook tag "${row.tag}"`);
      else {
        plan.create('tag_decisions', row.key, decisionProps(row, { claim, tag }));
        counts.tag_decisions += 1;
      }
    }
    if (unresolved.length) throw new SeedError(`${unresolved.length} decision(s) cannot be linked:\n  ${unresolved.slice(0, 10).join('\n  ')}${unresolved.length > 10 ? `\n  ... and ${unresolved.length - 10} more` : ''}`);
  }

  const total = plan.ops.length;
  if (total === 0) return { code: EXIT.OK, runId: null, counts, notes, line: `seed: phase ${phase}: nothing to do, all ${existing} row(s) are already in Notion` };
  const dir = join(root, 'runs', id);
  if (existsSync(join(dir, 'plan.jsonl'))) throw new SeedError(`run "${id}" already has a plan; pick another --run id`);
  plan.write();
  const what = Object.entries(counts).filter(([, n]) => n).map(([db, n]) => `${n} ${db}`).join(', ');
  return {
    code: EXIT.OK, runId: id, counts, notes, existing,
    line: `seed: phase ${phase}: plan ${id} written: ${what} create(s)${existing ? `, ${existing} already in Notion` : ''}; next: plan.mjs check --run ${id}, then apply.mjs --run ${id}, then pull.mjs --all`,
  };
}

// ---- command line ------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Run the script; returns the exit code. env (tests): { root, repoRoot, seedDir, fixturePath, now }. */
export function main(argv, io = defaultIo, env = {}) {
  let args;
  try {
    args = parseArgs({ args: argv, options: { phase: { type: 'string' }, run: { type: 'string' }, help: { type: 'boolean', short: 'h' } }, strict: true, allowPositionals: false }).values;
  } catch (e) {
    io.err(`seed: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  if (!['1', '2', '3'].includes(args.phase)) {
    io.err(`seed: --phase must be 1, 2 or 3\n${USAGE}`);
    return EXIT.INVALID;
  }
  try {
    const root = env.root ?? agentRoot();
    const repo = env.repoRoot ?? defaultRepoRoot();
    const result = seedPhase({
      root, phase: Number(args.phase), runId: args.run, seedDir: env.seedDir, fixturePath: env.fixturePath ?? join(repo, 'tests', 'fixtures', 'rubric.research-example.json'), now: env.now,
    });
    io.out(result.line);
    for (const n of result.notes) io.err(`seed: ${n}`);
    return result.code;
  } catch (e) {
    io.err(`seed: ${e.message}`);
    return e instanceof SeedError || e instanceof PlanError || e.code === 'ALLOWLIST' || /no pull yet|does not exist/.test(e.message) ? EXIT.INVALID : EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
