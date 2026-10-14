#!/usr/bin/env node
// Pull: read the trial databases from Notion through the REST client and write a normalised copy to disk.
//
//   node agents/claim-tagger/scripts/pull.mjs --dbs <a,b,c> | --all [--pull-id <id>]
//
// For each database: schema/<db>.json (retrieveDatabase) and raw/<db>.json (every page; relations Notion cut at 25 references
// are completed), then in norm/: claims.jsonl, rulebook.json (with drift against rubric/rubric.json), queue.jsonl,
// decisions.jsonl, lessons.jsonl, runs.jsonl, settings.json. Always: id-map.json, snapshot.json (editor-owned fields per page),
// pull.json (manifest) and runs/pull/LATEST. Databases that were not pulled keep the previous pull's id-map entries (marked in
// id-map.carried) so names still resolve; their norm files are simply absent.
//
// Exit codes: 0 ok, 1 Notion or unexpected error, 2 duplicate keys (files are written) or a setup problem or broken cursor chain,
// 3 the Agent settings Paused box is ticked (files are written), 4 a property is missing or has a different type than the scripts expect,
// or a select property lacks an option the scripts or the Notion formulas name (lib/notion-contract.mjs REQUIRED_OPTIONS; extra options pass).
//
// In drift entries ({ tag, part, a, b }) a is the Notion side and b the rubric/rubric.json side; part "added" is a tag that is only in
// rubric.json (deleted, renamed or no longer Verified in Notion) and "missing" one that is only in Notion.

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  DATABASES, EDITOR_OWNED, OPTIONAL_PROPERTIES, PROPERTY_TYPES, controlPaths, editorValue, isProtectedDatabase,
} from './allowlist.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { h16 } from './lib/hash.mjs';
import { readJson, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { agentRoot, isMain, repoRoot as defaultRepoRoot, runId, safeName } from './lib/paths.mjs';
import { checkOptions } from './lib/notion-contract.mjs';
import { clientFromConfig } from './lib/notion-rest.mjs';
import { decodePage, normId, normaliseText } from './lib/notion-values.mjs';
import { compareCodePoints } from './lib/pyjson.mjs';
import { buildRubric, diffRubric } from './lib/rubric-build.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/pull.mjs --dbs <rulebook,claims,tag_decisions,rule_changes,runs,agent_settings> | --all [--pull-id <id>]';

const OUTCOMES = new Set(['Applies', 'Does not apply']);

class UsageError extends Error {}

export const loadConfig = (root = agentRoot()) => readJson(join(root, 'config.json'));
export const keyProperty = (config, db) => config.notion.databases[db].key;

// ---- reading a pull back ------------------------------------------------------------------------------------------

/** The id of the newest pull (the content of runs/pull/LATEST), or null. */
export function latestPullId(root = agentRoot()) {
  const file = join(controlPaths(root).pull, 'LATEST');
  if (!existsSync(file)) return null;
  const id = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  return id === '' ? null : id;
}

export const pullDir = (root, id) => join(controlPaths(root).pull, safeName(id));

/** True when the (decoded) Tag decisions row is decided: its effective outcome is Applies or Does not apply. */
export const isDecided = (row) => OUTCOMES.has(row.props['Effective outcome']);

/**
 * A pull on disk, read lazily: info (pull.json), idMap, schema(db), rows(db) (decoded pages), rowByKey, rowByPageId,
 * decidedKeys(), snapshot(). Only databases listed in `pulled` have a schema, rows and norm files here.
 */
export function loadPull(root = agentRoot(), pullId = latestPullId(root), { config = loadConfig(root) } = {}) {
  if (!pullId) throw new Error('no pull yet: run pull.mjs first');
  const dir = pullDir(root, pullId);
  const infoFile = join(dir, 'pull.json');
  if (!existsSync(infoFile)) throw new Error(`pull "${pullId}" does not exist (${infoFile})`);
  const info = readJson(infoFile);
  const idMap = existsSync(join(dir, 'id-map.json')) ? readJson(join(dir, 'id-map.json')) : null;
  const cache = new Map();
  const memo = (k, fn) => {
    if (!cache.has(k)) cache.set(k, fn());
    return cache.get(k);
  };
  const api = {
    id: pullId,
    dir,
    info,
    idMap,
    pulled: info.dbs,
    covers: (db) => info.dbs.includes(db),
    schema: (db) => memo(`schema:${db}`, () => (info.dbs.includes(db) && existsSync(join(dir, 'schema', `${db}.json`)) ? readJson(join(dir, 'schema', `${db}.json`)) : null)),
    rows: (db) => memo(`rows:${db}`, () => {
      const file = join(dir, 'raw', `${db}.json`);
      if (!info.dbs.includes(db) || !existsSync(file)) return []; // files of an earlier pull under the same id do not count
      const schema = api.schema(db);
      return readJson(file).map((page) => decodePage(page, schema));
    }),
    rowByPageId: (db, pageId) => memo(`byid:${db}`, () => new Map(api.rows(db).map((r) => [normId(r.page_id), r]))).get(normId(pageId)) ?? null,
    rowByKey: (db, key) => {
      const pageId = idMap?.[db]?.[key];
      return pageId ? api.rowByPageId(db, pageId) : null;
    },
    decidedKeys: () => memo('decided', () => new Set(api.rows('tag_decisions').filter(isDecided).map((r) => r.props[keyProperty(config, 'tag_decisions')]))),
    snapshot: () => memo('snapshot', () => (existsSync(join(dir, 'snapshot.json')) ? readJson(join(dir, 'snapshot.json')) : null)),
  };
  return api;
}

/**
 * The schema file of a database from the given pull, else from the latest pull, else from the newest pull on disk that fetched it
 * (by taken_at), else null. The last step matters after an apply: its post pull covers only the touched databases and becomes LATEST.
 */
export function findSchema(root, db, preferredPullId = null) {
  const base = controlPaths(root).pull;
  const schemaIn = (id) => {
    const file = join(base, safeName(id), 'schema', `${db}.json`);
    const manifest = join(base, safeName(id), 'pull.json');
    if (!existsSync(file) || !existsSync(manifest)) return null;
    const info = readJson(manifest);
    return info.dbs?.includes(db) ? { info, file } : null;
  };
  for (const id of [preferredPullId, latestPullId(root)].filter(Boolean)) {
    const hit = schemaIn(id);
    if (hit) return readJson(hit.file);
  }
  if (!existsSync(base)) return null;
  const newest = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => schemaIn(d.name))
    .filter(Boolean)
    .sort((a, b) => String(b.info.taken_at ?? '').localeCompare(String(a.info.taken_at ?? '')))[0];
  return newest ? readJson(newest.file) : null;
}

// ---- checking the schema ------------------------------------------------------------------------------------------

/**
 * Problems between a live database object and what the scripts expect: names and types from allowlist.PROPERTY_TYPES (minus the computed
 * ones nobody reads) and, for the select properties, the option names of lib/notion-contract.mjs REQUIRED_OPTIONS (extra options pass).
 */
export function schemaProblems(db, schema, config = null) {
  const props = schema?.properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return [`${db}: the database object has no properties`];
  const problems = [];
  if (config && schema.id && normId(schema.id) !== normId(config.notion.databases[db].database_id)) {
    problems.push(`${db}: Notion returned database ${schema.id}, config.json says ${config.notion.databases[db].database_id}`);
  }
  for (const [name, type] of Object.entries(PROPERTY_TYPES[db])) {
    if (OPTIONAL_PROPERTIES[db].includes(name)) continue;
    const def = props[name];
    if (!def) problems.push(`${db}: property "${name}" is missing (renamed or deleted?)`);
    else if (def.type !== type) problems.push(`${db}: property "${name}" is ${def.type}, the scripts expect ${type}`);
  }
  for (const { property, option } of checkOptions(db, props).missing) {
    if (OPTIONAL_PROPERTIES[db].includes(property)) continue;
    problems.push(`${db}: property "${property}" has no option "${option}" (renamed or deleted?)`);
  }
  return problems;
}

/** Warnings for what the option check could not look at: a select property whose option list the API did not return (the allowlist then refuses every write to it). */
export function schemaWarnings(db, schema) {
  const props = schema?.properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return [];
  return checkOptions(db, props).unreadable
    .filter((property) => !OPTIONAL_PROPERTIES[db].includes(property))
    .map((property) => `${db}: property "${property}" has no readable option list, so its options were not checked`);
}

// ---- normalising --------------------------------------------------------------------------------------------------

const lines = (s) => String(s ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
const first = (list) => (Array.isArray(list) && list.length ? list[0] : null);
const byKey = (a, b) => compareCodePoints(String(a), String(b));

function rulebookRows(rows) {
  return rows.filter((r) => typeof r.props['Tag title'] === 'string' && r.props['Tag title'].trim() !== '').map(({ page_id, props: p }) => ({
    name: p['Tag title'],
    page_id,
    status: p.Status,
    category: p.Category,
    polarity: p.Polarity,
    counterpart: p.Counterpart || null,
    description: p.Description,
    when_to_use: p['When to use'],
    example_claims: p['Example claims'],
    judged: p.Judged === true,
    human_only: p['Human only'] === true,
    rule_version: p['Rule version'] || null,
    tag_hash: p['Tag hash'] || null,
    changed_by: p['Changed by'] ?? [],
  })).sort((a, b) => byKey(a.name, b.name));
}

/** Rulebook text rebuilt into a rubric and compared with rubric.json, judged tags only. */
export function computeDrift(root, rows) {
  const file = join(root, 'rubric', 'rubric.json');
  if (!existsSync(file)) return { drift: [], checked: false };
  const current = readJson(file);
  const known = new Map(current.tags.map((t) => [t.name, t]));
  const buildRows = rows.map((r) => ({
    name: r.name,
    status: r.status,
    category: r.category,
    polarity: r.polarity,
    counterpart: r.counterpart,
    description: r.description,
    when_to_use: r.when_to_use,
    example_claims: r.example_claims,
    human_only: r.human_only,
    judged: r.judged,
    deterministic: known.get(r.name)?.deterministic === true, // not Notion columns: taken from the rubric file
    needs_source_reading: known.get(r.name)?.needs_source_reading === true,
  }));
  let built;
  try {
    built = buildRubric(buildRows, { version: current.rubric_version });
  } catch (e) {
    return { drift: [{ tag: null, part: 'invalid', a: e.message, b: null }], checked: true };
  }
  const judged = new Set([...current.tags.filter((t) => t.judged).map((t) => t.name), ...rows.filter((r) => r.judged).map((r) => r.name)]);
  return { drift: diffRubric(built, current).filter((d) => judged.has(d.tag)), checked: true };
}

/** { db: { key: pageId }, duplicates, empty } from decoded rows. A duplicated key maps to its oldest row. */
function indexRows(config, db, rows) {
  const keyName = keyProperty(config, db);
  const groups = new Map();
  const empty = [];
  for (const row of rows) {
    const key = row.props[keyName];
    if (typeof key !== 'string' || key.trim() === '') {
      empty.push(row.page_id);
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const map = {};
  const duplicates = [];
  for (const key of [...groups.keys()].sort(byKey)) {
    const group = groups.get(key).sort((a, b) => byKey(a.created_time ?? '', b.created_time ?? '') || byKey(a.page_id, b.page_id));
    map[key] = group[0].page_id;
    if (group.length > 1) duplicates.push({ db, key, page_ids: group.map((r) => r.page_id) });
  }
  return { map, duplicates, empty };
}

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');

/** Editor-owned fields of every pulled row, for verify's before/after comparison. */
function editorSnapshot(config, decoded, takenAt, pullId) {
  const editor_fields = {};
  for (const db of Object.keys(decoded)) {
    const names = EDITOR_OWNED[db] ?? [];
    if (!names.length) continue;
    for (const row of decoded[db]) {
      const fields = {};
      for (const name of names) {
        fields[name] = editorValue(db, name, row.props[name] ?? null);
        if (`${name}:end` in row.props) fields[`${name}:end`] = row.props[`${name}:end`];
      }
      editor_fields[row.page_id] = { db, key: row.props[keyProperty(config, db)] ?? null, fields };
    }
  }
  return { pull_id: pullId, taken_at: takenAt, editor_fields };
}

// ---- the pull ----------------------------------------------------------------------------------------------------

/** Fetch, write and normalise. Returns { code, pullId, dir, counts, drift, duplicates, paused, warnings, line }. */
export async function pull({ root = agentRoot(), config = loadConfig(root), client, dbs, pullId, now = () => new Date() }) {
  const want = DATABASES.filter((d) => dbs.includes(d));
  const unknown = dbs.filter((d) => !DATABASES.includes(d));
  if (unknown.length || want.length === 0) throw new UsageError(`unknown database name(s): ${unknown.join(', ') || '(none given)'}; choose from ${DATABASES.join(', ')}`);
  for (const db of want) {
    const cfg = config.notion.databases[db];
    if (!cfg?.database_id) throw new UsageError(`config.json has no database_id for ${db}`);
    if (isProtectedDatabase(config, cfg.database_id) || isProtectedDatabase(config, cfg.data_source_id)) throw new UsageError(`${db} is on the protected list in config.json; refusing to touch it`);
  }
  const id = safeName(pullId ?? runId('pull', now()));
  const dir = pullDir(root, id);
  const previousId = latestPullId(root);
  const previous = previousId && existsSync(join(pullDir(root, previousId), 'id-map.json')) ? readJson(join(pullDir(root, previousId), 'id-map.json')) : null;
  const takenAt = now().toISOString();
  mkdirSync(join(dir, 'schema'), { recursive: true });
  mkdirSync(join(dir, 'raw'), { recursive: true });
  mkdirSync(join(dir, 'norm'), { recursive: true });

  const schemas = {};
  const decoded = {};
  const problems = [];
  const schemaNotes = [];
  const pageSize = config.notion.page_size ?? 100;
  for (const db of want) {
    const databaseId = config.notion.databases[db].database_id;
    const schema = await client.retrieveDatabase(databaseId);
    schemas[db] = schema;
    writeJsonAtomic(join(dir, 'schema', `${db}.json`), schema);
    const found = schemaProblems(db, schema, config);
    problems.push(...found);
    schemaNotes.push(...schemaWarnings(db, schema));
    const pages = await client.queryAll(databaseId, { pageSize });
    for (const page of pages) {
      for (const value of Object.values(page.properties ?? {})) {
        if (value?.type === 'relation' && value.has_more) {
          const items = await client.retrievePropertyItem(page.id, value.id);
          value.relation = [...new Map(items.map((i) => [normId(i.relation.id), { id: i.relation.id }])).values()];
          value.has_more = false;
        }
      }
    }
    writeJsonAtomic(join(dir, 'raw', `${db}.json`), pages);
    if (!found.length) decoded[db] = pages.map((p) => decodePage(p, schema));
  }
  if (problems.length) {
    writeJsonAtomic(join(dir, 'pull.json'), { pull_id: id, taken_at: takenAt, dbs: want, schema_problems: problems });
    return { code: EXIT.DRIFT, pullId: id, dir, problems, counts: {}, drift: [], duplicates: [], paused: false, warnings: problems, line: `pull ${id}: ${problems.length} schema problem(s), nothing normalised` };
  }

  // id map, duplicates, carried entries
  const idMap = { pull_id: id };
  const carried = {};
  const duplicates = [];
  const warnings = [...schemaNotes];
  const counts = {};
  for (const db of DATABASES) {
    if (decoded[db]) {
      const { map, duplicates: dup, empty } = indexRows(config, db, decoded[db]);
      idMap[db] = map;
      duplicates.push(...dup);
      counts[db] = decoded[db].length;
      if (empty.length) warnings.push(`${db}: ${empty.length} row(s) without a ${keyProperty(config, db)} were left out of the id map (${empty.slice(0, 3).join(', ')}${empty.length > 3 ? ', ...' : ''})`);
    } else {
      idMap[db] = previous?.[db] ?? {};
      if (previous && previous[db]) carried[db] = previous.carried?.[db] ?? previous.pull_id;
    }
  }
  idMap.duplicates = duplicates;
  idMap.carried = carried;

  // names for relation ids: this pull's Rulebook, else the carried map
  const rulebookNames = new Map(Object.entries(idMap.rulebook).map(([name, pageId]) => [normId(pageId), name]));
  const tagName = (pageId) => rulebookNames.get(normId(pageId)) ?? null;
  const norm = (name) => join(dir, 'norm', name);

  let driftCount = 0;
  let drift = [];
  if (decoded.rulebook) {
    const rows = rulebookRows(decoded.rulebook);
    const result = computeDrift(root, rows);
    drift = result.drift;
    driftCount = drift.length;
    writeJsonAtomic(norm('rulebook.json'), { pull_id: id, rows, drift, drift_checked: result.checked });
  }
  if (decoded.claims) {
    const claimsKey = keyProperty(config, 'claims');
    const rows = decoded.claims.filter((r) => typeof r.props[claimsKey] === 'string' && r.props[claimsKey].trim() !== '').map(({ page_id, props: p }) => {
      const tagIds = p['Agent tags'] ?? [];
      const claim = p['Claim title'] ?? '';
      return {
        geo_id: p['Geo ID'], page_id, claim, geo_link: p['Geo link'], text_hash: h16(normaliseText(claim)), table: p.Table, sample: p.Sample,
        sources_count: p['Sources count'], source_urls: lines(p['Source URLs']), agent_tags: tagIds.map(tagName).filter(Boolean), agent_tag_ids: tagIds,
        readiness: p.Readiness, tag_confidence: p['Tag confidence'] || null, last_judged: p['Last judged'] || null,
      };
    }).sort((a, b) => byKey(a.geo_id, b.geo_id));
    writeTextAtomic(norm('claims.jsonl'), jsonl(rows));
  }
  if (decoded.tag_decisions) {
    const keyName = keyProperty(config, 'tag_decisions');
    const rows = decoded.tag_decisions.filter((r) => typeof r.props[keyName] === 'string' && r.props[keyName].trim() !== '').map(({ page_id, props: p }) => {
      const tagPageId = first(p.Tag);
      return {
        key: p[keyName], page_id, geo_id: p[keyName].split('::')[0], claim_page_id: first(p.Claim), tag: first(p['Tag name']) ?? (tagPageId ? tagName(tagPageId) : null), tag_page_id: tagPageId,
        agent_proposal: p['Agent proposal'], agent_confidence: p['Agent confidence'], why_i_recommend_this: p['Why I recommend this'] || null, agent_full_note: p['Agent full note'] || null,
        why_in_queue: p['Why in queue'], priority: p.Priority, rubric_version: p['Rubric version'] || null, tag_outcome: p['Tag outcome'], why_wrong: p['Why wrong'],
        your_reasoning: p['Your reasoning'] || null, decided_by: p['Decided by'] ?? [], decided_at: p['Decided at'], seeded_outcome: p['Seeded outcome'],
        seeded_reasoning: p['Seeded reasoning'] || null, seeded_at: p['Seeded at'], effective_outcome: p['Effective outcome'], direction: p.Direction, stage: p.Stage,
        lesson_page_ids: p.Lesson ?? [], in_regression_suite: p['In regression suite'], agent_follow_up: p['Agent follow-up'], follow_up_run: p['Follow-up run'] || null,
      };
    }).sort((a, b) => byKey(a.key, b.key));
    writeTextAtomic(norm('queue.jsonl'), jsonl(rows));
    writeTextAtomic(norm('decisions.jsonl'), jsonl(rows.filter((r) => OUTCOMES.has(r.effective_outcome)).map((r) => ({ ...r, outcome_source: r.tag_outcome ? 'editor' : 'seeded' }))));
  }
  if (decoded.rule_changes) {
    const keyName = keyProperty(config, 'rule_changes');
    const rows = decoded.rule_changes.filter((r) => typeof r.props[keyName] === 'string' && r.props[keyName].trim() !== '').map(({ page_id, props: p }) => {
      const tagPageId = first(p.Tag);
      return {
        lesson_key: p[keyName], page_id, lesson_id: p['Lesson ID'], title: p[keyName], tag: tagPageId ? tagName(tagPageId) : null, tag_page_id: tagPageId, rule_label: p.Rule || null, kind: p.Kind,
        current_text: p['Current text'], proposed_text: p['Proposed text'], editor_wording: p['Editor wording'] || null, status: p.Status, approved_by: p['Approved by'] ?? [],
        rubric_version: p['Rubric version'] || null, gate_result: p['Gate result'] || null, supporting_page_ids: p['Supporting rows'] ?? [], result_card_page_ids: p['Result card'] ?? [], created: p.Created,
      };
    }).sort((a, b) => byKey(a.lesson_key, b.lesson_key));
    writeTextAtomic(norm('lessons.jsonl'), jsonl(rows));
  }
  if (decoded.runs) {
    const keyName = keyProperty(config, 'runs');
    const rows = decoded.runs.filter((r) => typeof r.props[keyName] === 'string' && r.props[keyName].trim() !== '').map(({ page_id, props: p }) => ({
      title: p[keyName], page_id, kind: p.Kind, verdict: p.Verdict, rubric_version: p['Rubric version'] || null, canaries: p.Canaries || null, per_tag_summary: p['Per-tag summary'] || null,
      summary: p.Summary || null, model: p.Model || null, started: p.Started, claims_judged: p['Claims judged'], newly_failing: p['Newly failing'], cost_usd: p['Cost USD'], lesson_page_ids: p.Lesson ?? [],
    })).sort((a, b) => byKey(a.started ?? '', b.started ?? '') || byKey(a.title, b.title));
    writeTextAtomic(norm('runs.jsonl'), jsonl(rows));
  }
  let paused = false;
  if (decoded.agent_settings) {
    const keyName = keyProperty(config, 'agent_settings');
    const rows = decoded.agent_settings.filter((r) => typeof r.props[keyName] === 'string' && r.props[keyName].trim() !== '');
    const row = rows.find((r) => r.props[keyName] === config.agent) ?? rows[0] ?? null;
    const p = row?.props ?? {};
    const settings = {
      page_id: row?.page_id ?? null, name: row ? p[keyName] : config.agent ?? null, paused: p.Paused === true, paused_by: p['Paused by'] ?? [], reason: p.Reason || null, weekly_cap: p['Weekly cap'] ?? null,
      owner: p.Owner ?? [], rubric_in_force: p['Rubric in force'] || null, last_run_at: p['Last run at'] ?? null, last_run_summary: p['Last run summary'] || null,
    };
    if (!row) warnings.push('agent_settings: no row yet, so Paused cannot be read (it is treated as not paused)');
    paused = settings.paused;
    writeJsonAtomic(norm('settings.json'), settings);
  }

  writeJsonAtomic(join(dir, 'id-map.json'), idMap);
  writeJsonAtomic(join(dir, 'snapshot.json'), editorSnapshot(config, decoded, takenAt, id));
  writeJsonAtomic(join(dir, 'pull.json'), { pull_id: id, taken_at: takenAt, dbs: want, counts, drift_count: driftCount, duplicates: duplicates.length, paused, warnings });
  writeTextAtomic(join(controlPaths(root).pull, 'LATEST'), id);

  const code = paused ? EXIT.PAUSED : duplicates.length ? EXIT.INVALID : EXIT.OK;
  const line = `pull ${id}: ${want.map((d) => `${d} ${counts[d]}`).join(', ')}; drift ${driftCount}; duplicates ${duplicates.length}; paused ${paused ? 'yes' : 'no'}`;
  return { code, pullId: id, dir, counts, drift, duplicates, paused, warnings, line };
}

// ---- command line ------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/**
 * Run the script; returns the exit code. env (tests): { root, repoRoot, client (null = no token), fetchImpl, now }.
 */
export async function main(argv, io = defaultIo, env = {}) {
  let args;
  try {
    args = parseArgs({ args: argv, options: { dbs: { type: 'string' }, all: { type: 'boolean' }, 'pull-id': { type: 'string' }, help: { type: 'boolean', short: 'h' } }, strict: true, allowPositionals: false }).values;
  } catch (e) {
    io.err(`pull: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  if (Boolean(args.dbs) === Boolean(args.all)) {
    io.err(`pull: give exactly one of --dbs and --all\n${USAGE}`);
    return EXIT.INVALID;
  }
  try {
    const root = env.root ?? agentRoot();
    const config = env.config ?? loadConfig(root);
    const dbs = args.all ? [...DATABASES] : [...new Set(args.dbs.split(',').map((s) => s.trim()).filter(Boolean))];
    const client = env.client !== undefined ? env.client : clientFromConfig(config, { fetchImpl: env.fetchImpl, repoRoot: env.repoRoot ?? defaultRepoRoot() });
    if (!client) {
      io.err('pull: there is no NOTION_TOKEN in .env, so Notion cannot be read by script (the skill can read through the connector instead)');
      return EXIT.INVALID;
    }
    const result = await pull({ root, config, client, dbs, pullId: args['pull-id'], now: env.now });
    io.out(result.line);
    for (const w of result.warnings) io.err(`pull: warning: ${w}`);
    if (result.code === EXIT.DRIFT) {
      for (const p of result.problems) io.err(`pull: ${p}`);
      io.err('pull: the Notion schema no longer matches what the scripts expect; fix the property or option in Notion, or update allowlist.mjs PROPERTY_TYPES or lib/notion-contract.mjs REQUIRED_OPTIONS');
    } else if (result.paused) {
      io.err('pull: the agent is paused (Agent settings -> Paused); a person must untick it');
    } else if (result.duplicates.length) {
      for (const d of result.duplicates) io.err(`pull: duplicate key in ${d.db}: "${d.key}" on pages ${d.page_ids.join(', ')}`);
    }
    return result.code;
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`pull: ${e.message}\n${USAGE}`);
      return EXIT.INVALID;
    }
    io.err(`pull: ${e.message}`);
    if (e.code === 'BROKEN_CURSOR') return EXIT.INVALID;
    if (e.name === 'NotionError' && [401, 403, 404].includes(e.status)) {
      io.err('pull: Notion refused the request; check the token and that the integration is connected to the page "Editorial feedback loop"');
      return EXIT.INVALID;
    }
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
