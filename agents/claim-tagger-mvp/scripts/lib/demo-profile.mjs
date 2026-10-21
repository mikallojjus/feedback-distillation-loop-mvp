// The practice page's profile and the pure pieces its builder is made of (scripts/walkthrough.mjs uses them; nothing here is a command).
// A practice page is a demo profile: a state folder under runs/demos/<id>/ with its own config.json, rubric/, evals/ and runs/, whose tables live
// on a Notion page that was made for it. Nothing in this file prints, reads .env or sends anything of its own: the one function that touches the
// wire, placementFetch, only rewrites a request that the Notion client already sends.
//
//   parseNotionLink(text)                      -> the 32 hex digits of the page a pasted link or id names, or null
//   newDemoId(now, random)  demoTitle(now)  dateWord(now)  -> "20261015-1422-a1b2c3"; "Claim tagger practice · 15 Oct 14:22"; "15 Oct"
//   loadManifest(file) / loadTemplate(file)    -> { manifest, sha256 } / { text, sha256 }, checked (ManifestError names the problem)
//   practiceStructure(structure)               -> the production structure with the practice page's table titles (Rulebook, Claims, ...)
//   buildDemoConfig(production, { ... })       -> the config.json of a demo profile (protected list = production's plus its own tables and page)
//   pageModel(template, values)                -> what the page is made of: blocks before the tables, the two view slots, the Help toggle
//   expectedContent(model, fallbackKeys)       -> the top-level content blocks the page must hold, in order
//   annotatedPreview(model, { ... })           -> preview.md: the rendered template with a comment under each marker, and the fallback paragraphs
//   rulebookRow(manifest) / practiceRubric(manifest, config, { edition, now }) -> the Rulebook row, and the rulebook file the page starts with (built in memory, the way writeProfile
//                                                 builds it: its edition is the Rulebook edition of the seeded ledger rows and the edition their Read under names)
//   claimEditorCells(manifest, claim, tagPages) / claimAgentCells(manifest, claim, { rubric }) / ledgerCopy(manifest, claim, { rubric }) / ledgerOps(manifest, claimLinks, { rubric })
//   openKeys(manifest) / openClaims(manifest) / queueKey(claim, tag)
//                                              -> the editor's three columns of a claim as the cells of its create, the Agent reading a decided claim is created with, the copy
//                                                 of a decision in the ledger (with the agent's reading of the earlier decisions that disagree with the agent's proposal, decision 73),
//                                                 the creates of Tag decisions (the ledger: the five decided claims only), the ledger keys of the claims that wait, those claims,
//                                                 a ledger row's key
//   stepOf({ claims, ledger, lessons, open, settings }) -> where the editor is: { step, branch, lesson } (the mapping of the design, read from the claims' Review status; step 7
//                                                 from the Follow-up of the rows the live rule change rests on, decision 76)
//   placementFetch(inner)                      -> a fetch that spells two placements the Notion client cannot (see the function)
//   bufferedLog()                              -> a request log that starts in memory and moves to its file when the folder exists
//   demosDir / demoDir / listDemos / pickDemo  -> the demos under <root>/runs/demos; pickDemo is the page a command acts on (the one named, else the
//                                                 newest finished page under the Demos sub-page whose profile the loader can read)
//   profileProblem(found)                      -> why the current loader cannot read a demo's profile (an older manifest shape, a missing or changed copy), else null
//   constants: PRACTICE_TITLES, VIEW_NAMES, LINKED_VIEWS, TAB_VIEWS, FALLBACK_TEXT, CONTENT_TYPES

import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { TABLES, loadConfig } from './config.mjs';
import { readJson } from './jsonl.mjs';
import { blockText, parseInline, renderPreview, splitAtMarkers, toBlocks } from './notion-blocks.mjs';
import { AUTOMATIC_TYPES, validateStructure, viewKey } from './notion-build.mjs';
import { normId } from './notion-values.mjs';
import { stampOf } from './editor-words.mjs';
import { READINGS, decisionsFor } from './decisions.mjs';
import { claimReadingCell, classifyRows, readingCells } from './readings.mjs';
import { buildRubric } from './rubric.mjs';

// ---- names -------------------------------------------------------------------------------------------------------------------------

/** The titles of the five tables on a practice page (decision 28): no "copy" in the name. */
export const PRACTICE_TITLES = Object.freeze({
  rulebook: 'Rulebook', claims_copy: 'Claims', tag_decisions: 'Tag decisions', rule_changes: 'Rule changes', agent_settings: 'Agent settings',
});
/** The five view names of the page (production's), by their config key. The two views of the ledger (Tag decisions) are not on a practice page. */
export const VIEW_NAMES = Object.freeze({
  your_queue: 'Your queue', needs_your_note: 'Needs your note', agent_disagreed: 'Agent disagreed', lessons_waiting: 'Lessons waiting', rulebook: 'Rulebook',
});
/** The two linked views: placed inside a step, a view of this table. */
export const LINKED_VIEWS = Object.freeze({ your_queue: 'claims_copy', lessons_waiting: 'rule_changes' });
/** The three views that are tabs of their table; `position` is where the tab goes (the table's own first view stays first for the Claims). */
export const TAB_VIEWS = Object.freeze({
  rulebook: { table: 'rulebook', position: 'start' },
  needs_your_note: { table: 'claims_copy', position: 'end' },
  agent_disagreed: { table: 'claims_copy', position: 'end' },
});
/** What stands in a step where its linked view could not be made. */
export const FALLBACK_TEXT = Object.freeze({
  your_queue: 'Scroll to Claims in the tables further down this page; your four claims are the ones whose Review status is To review.',
  lessons_waiting: 'Scroll to Rule changes at the bottom of this page and open the row with Status Proposed.',
});
/** The editor's three columns of a claim (the names of the production Claims copy; config.json editor_columns.claims_copy lists the same three). Why wrong left the editor's work (decision P4). */
export const CLAIM_COLUMNS = Object.freeze({
  verified: 'Verified tags', review_status: 'Review status', notes: 'Challenged tags notes',
});
/** The agent's column for its reading of the decisions (config write_columns.reading), and the note a seeded reading carries (decision 73). */
export const AGENT_READING_COLUMN = 'Agent reading';
export const SEEDED_NOTE = 'Seeded from the audit of 9 October.';
/** The block types the page template can make (anything else on the page, a table or a linked view, is not template text). */
export const CONTENT_TYPES = new Set(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'quote', 'divider', 'callout', 'table', 'toggle']);

const PROPOSALS = ['Applies', 'Does not apply', "Can't tell"];
/** The editor's column that an older practice page still has in its manifest (decision P4: the agent reads each disagreement itself). */
const OLD_COLUMN = 'Why wrong';
/** Where a reading comes from in the story: the model reads it, the editor's note says it (a reason word, no call), or there is nothing to read (the editor agrees with the agent). */
const READING_SOURCES = ['model', 'verbatim', 'none'];
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const two = (n) => String(n).padStart(2, '0');
const isRealId = (v) => typeof v === 'string' && /^[0-9a-f]{32}$/.test(normId(v.trim()));
const hex32 = (v) => normId(String(v ?? '').trim());

/** A problem with a file the builder reads (the manifest, the page template, the structure). Scripts answer it with exit code 2. */
export class ManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestError';
    this.code = 'MANIFEST';
  }
}

// ---- links, ids, times --------------------------------------------------------------------------------------------------------------

/**
 * The page a pasted link or id names: its 32 hex digits, or null. Reads a plain id (with or without dashes), a link whose last path segment ends in
 * the id ("Title-<id>"), and a link that peeks at a page over a table ("?p=<id>").
 */
export function parseNotionLink(text) {
  const raw = String(text ?? '').trim().replace(/^<|>$/g, '').trim();
  if (raw === '') return null;
  const tail = (s) => (/([0-9a-f]{32})$/.exec(String(s).replace(/-/g, '').toLowerCase()) ?? [])[1] ?? null;
  const isLink = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(?:www\.)?notion\.[a-z]+\//i.test(raw);
  if (!isLink && !raw.includes('/')) return tail(raw);
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const peek = tail(url.searchParams.get('p') ?? '');
  if (peek) return peek;
  const segments = url.pathname.split('/').filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  return tail(segments[segments.length - 1] ?? '');
}

/** "20261015-1422-a1b2c3": the local date and time of the start and a short random suffix (letters and digits only, no colon). */
export function newDemoId(now = new Date(), random = () => randomBytes(3).toString('hex')) {
  const d = now instanceof Date ? now : new Date(now);
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}-${String(random()).replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'x'}`;
}

/** "Claim tagger practice · 15 Oct 14:22" (local time). */
export const demoTitle = (now = new Date()) => `Claim tagger practice · ${stampOf(now)}`;

/** "15 Oct": the date part of a stamp, for the {{date}} placeholder of the page. */
export const dateWord = (now = new Date()) => stampOf(now).split(' ').slice(0, 2).join(' ');

export const sha256Of = (data) => createHash('sha256').update(data).digest('hex');

// ---- the manifest and the template --------------------------------------------------------------------------------------------------

function manifestProblems(m) {
  const out = [];
  const C = CLAIM_COLUMNS;
  const bad = (msg) => out.push(msg);
  if (!isPlain(m)) return ['the manifest is not a JSON object'];
  if (typeof m.manifest_version !== 'string' || m.manifest_version === '') bad('manifest_version is missing');
  const tag = m.tag;
  if (!isPlain(tag) || typeof tag.Name !== 'string' || tag.Name.trim() === '') bad('tag.Name is missing');
  else if (typeof tag['When to use'] !== 'string' || tag['When to use'].trim() === '') bad('tag["When to use"] is missing');
  else if (!(Array.isArray(tag['Example Claims']) || typeof tag['Example Claims'] === 'string')) bad('tag["Example Claims"] must be a list or a text');
  if (!Array.isArray(m.canaries) || m.canaries.length === 0) bad('canaries is missing or empty');
  else {
    m.canaries.forEach((c, i) => {
      if (!isPlain(c) || typeof c.claim !== 'string' || c.claim.trim() === '') bad(`canaries[${i}] has no claim`);
      else if (!['apply', 'do_not_apply'].includes(c.expected)) bad(`canaries[${i}].expected must be apply or do_not_apply`);
    });
  }
  const keys = new Set();
  const ids = new Set();
  if (!Array.isArray(m.claims) || m.claims.length === 0) bad('claims is missing or empty');
  else {
    m.claims.forEach((c, i) => {
      const at = `claims[${i}]`;
      if (!isPlain(c) || typeof c.key !== 'string' || c.key === '') return bad(`${at} has no key`);
      if (typeof c['Geo ID'] !== 'string' || c['Geo ID'] === '') bad(`${at} (${c.key}) has no Geo ID`);
      if (typeof c['Geo Name'] !== 'string' || c['Geo Name'].trim() === '') bad(`${at} (${c.key}) has no Geo Name`);
      if (keys.has(c.key)) bad(`${at}: the key ${c.key} appears twice`);
      if (ids.has(c['Geo ID'])) bad(`${at}: the Geo ID of ${c.key} appears twice`);
      keys.add(c.key);
      ids.add(c['Geo ID']);
    });
  }
  const placed = new Map();
  for (const [list, label] of [[m.decided, 'decided'], [m.open, 'open']]) {
    if (!Array.isArray(list) || list.length === 0) {
      bad(`${label} is missing or empty`);
      continue;
    }
    list.forEach((r, i) => {
      if (!isPlain(r) || !keys.has(r.claim)) return bad(`${label}[${i}].claim names no claim of the manifest`);
      if (placed.has(r.claim)) bad(`${label}[${i}]: the claim ${r.claim} is both decided and open, or listed twice`);
      placed.set(r.claim, label);
      const at = `${label}[${i}] (${r.claim})`;
      const tagsOf = (list, where) => {
        if (!Array.isArray(list) || list.some((t) => typeof t !== 'string' || t !== m.tag?.Name)) bad(`${where}: ${C.verified} must be a list of tag names; the page has one tag, ${m.tag?.Name ?? 'none'}`);
      };
      if (label === 'decided') {
        // a claim an editor has Reviewed: the page creates it in this state (the agent's pre-audit answer goes to the ledger row)
        if (!PROPOSALS.includes(r['Agent proposal'])) bad(`${at}: Agent proposal must be one of ${PROPOSALS.join(', ')}`);
        tagsOf(r[C.verified], at);
        if (r[C.review_status] !== 'Reviewed') bad(`${at}: ${C.review_status} must be Reviewed`);
        if (Object.hasOwn(r, OLD_COLUMN)) bad(`${at}: ${OLD_COLUMN} is not a column of the editor any more; this manifest has an older shape`);
        if (typeof r[C.notes] !== 'string' || r[C.notes].trim() === '') bad(`${at}: ${C.notes} is missing (it carries the words of the audit)`);
      } else {
        // a claim the editor still has to decide: created To review with the other two columns empty; `enter` is what the editor types
        if (r[C.review_status] !== undefined && r[C.review_status] !== 'To review') bad(`${at}: ${C.review_status} is To review when the page is made`);
        if (Object.hasOwn(r, OLD_COLUMN)) bad(`${at}: ${OLD_COLUMN} is not a column of the editor any more; this manifest has an older shape`);
        if (r.agrees !== undefined && typeof r.agrees !== 'boolean') bad(`${at}: agrees must be true or false`);
        if (r.enter !== undefined) {
          if (!isPlain(r.enter)) bad(`${at}: enter must be an object`);
          else {
            if (Object.hasOwn(r.enter, OLD_COLUMN)) bad(`${at}.enter: ${OLD_COLUMN} is not a column of the editor any more; this manifest has an older shape`);
            for (const column of Object.keys(r.enter)) if (column !== OLD_COLUMN && !Object.values(C).includes(column)) bad(`${at}.enter: "${column}" is not one of the editor's columns (${Object.values(C).join(', ')})`);
            tagsOf(r.enter[C.verified], `${at}.enter`);
            if (r.enter[C.review_status] !== 'Reviewed') bad(`${at}.enter: ${C.review_status} must be Reviewed`);
            // a note may be empty only for a claim where the editor agrees with the agent: an empty note is a decision too
            if (typeof r.enter[C.notes] !== 'string' || (r.enter[C.notes].trim() === '' && r.agrees !== true)) bad(`${at}.enter: ${C.notes} is missing`);
          }
        }
        if (r.expect_reading !== undefined) {
          const e = r.expect_reading;
          if (!isPlain(e)) bad(`${at}: expect_reading must be an object`);
          else {
            if (!READING_SOURCES.includes(e.source)) bad(`${at}.expect_reading: source must be one of ${READING_SOURCES.join(', ')}`);
            const list = e.reading;
            if (list !== null && (!Array.isArray(list) || list.length === 0 || list.some((x) => !READINGS.includes(x)))) bad(`${at}.expect_reading: reading must be null or a list of ${READINGS.join(', ')}`);
            if (e.rule !== undefined && e.rule !== null && !Number.isInteger(e.rule)) bad(`${at}.expect_reading: rule must be a rule number or null`);
            if ((e.source === 'none') !== (list === null) || (e.source === 'none') !== (r.agrees === true)) bad(`${at}: expect_reading says there is nothing to read exactly when the editor agrees with the agent (agrees: true)`);
          }
        }
      }
    });
  }
  if (keys.size && placed.size !== keys.size) bad(`every claim is decided or open: ${[...keys].filter((k) => !placed.has(k)).join(', ')} is neither`);
  if (!Array.isArray(m.steps) || m.steps.length !== 7) bad('steps must list the seven steps');
  else {
    m.steps.forEach((s, i) => {
      if (!isPlain(s) || s.n !== i + 1 || typeof s.title !== 'string' || s.title === '') bad(`steps[${i}] must be step ${i + 1} with a title`);
    });
  }
  return out;
}

/** Read and check a manifest file: { manifest, sha256, file }. */
export function loadManifest(file) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (e) {
    throw new ManifestError(`the manifest cannot be read (${file}): ${e.code ?? e.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new ManifestError(`the manifest ${file} is not valid JSON: ${e.message}`);
  }
  const problems = manifestProblems(manifest);
  if (problems.length) throw new ManifestError(`the manifest ${file} is not valid:\n- ${problems.slice(0, 8).join('\n- ')}`);
  return { manifest, sha256: sha256Of(bytes), file };
}

/** Read the page template: { text, sha256, file }. */
export function loadTemplate(file) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (e) {
    throw new ManifestError(`the page template cannot be read (${file}): ${e.code ?? e.message}`);
  }
  return { text: bytes.toString('utf8').replace(/^\uFEFF/, ''), sha256: sha256Of(bytes), file };
}

/** The first existing page template: the one next to the manifest, else the agent's own. */
export function templateFileFor(manifestFile, fallback) {
  const beside = join(dirname(manifestFile), 'page.md');
  return existsSync(beside) ? beside : fallback;
}

// ---- the structure and the config ----------------------------------------------------------------------------------------------------

/** The structure of the five tables with the practice page's titles (a copy; validated). The sub-pages of production are left out. */
export function practiceStructure(structure) {
  const copy = structuredClone(structure);
  for (const [key, title] of Object.entries(PRACTICE_TITLES)) {
    if (!copy.tables?.[key]) throw new ManifestError(`the structure has no table "${key}"`);
    copy.tables[key].title = title;
  }
  copy.pages = [];
  return validateStructure(copy);
}

/** The columns a table is filled from: the structure's, less the ones Notion fills by itself and the retired ones ("Agent tags (old)" and "Agent notes (old)" are never made on a practice page). */
export const writableColumns = (structure, table) => structure.tables[table].columns.filter((c) => !AUTOMATIC_TYPES.includes(c.type) && c.retired !== true).map((c) => c.name);

const PLACEHOLDER = '<setup>';

/**
 * The config.json of a demo profile. A copy of production's with demo: true; the tables, the sub-pages and the views are placeholders until the
 * builder fills them; the protected lists hold production's plus its own five tables and its parent page (so no plan can ever name them).
 */
export function buildDemoConfig(production, { demoId, title, parentId, tag }) {
  const cfg = structuredClone(production);
  const n = cfg.notion;
  const own = [n.rulebook, ...(n.claims ?? []), ...Object.values(n.databases ?? {})].flatMap((t) => [t?.database_id, t?.data_source_id]).filter(isRealId);
  cfg.demo = true;
  cfg.demo_id = demoId;
  cfg.demo_title = title;
  const productionClaims = (n.claims ?? []).find((c) => c.enabled === true) ?? n.claims[0];
  // the production page is listed as a page and, since a reader may look in either list, as a protected id there too
  n.protected_database_ids = [...new Set([...(n.protected_database_ids ?? []), ...own, production.notion.parent_page_id])].filter(Boolean);
  n.protected_page_ids = [...new Set([...(n.protected_page_ids ?? []), production.notion.parent_page_id])].filter(Boolean);
  n.pages = { proposal: '<none>', demos: '<none>', demo_tests: '<none>' };
  n.rulebook = { database_id: PLACEHOLDER, data_source_id: PLACEHOLDER, key: production.notion.rulebook.key, work_tag: production.notion.rulebook.work_tag };
  n.claims = [{
    name: 'demo_claims', label: 'Claims', enabled: true, database_id: PLACEHOLDER, data_source_id: PLACEHOLDER, key: productionClaims.key,
    columns: { ...productionClaims.columns }, write_columns: { ...productionClaims.write_columns },
  }];
  n.databases = Object.fromEntries(Object.entries(production.notion.databases).map(([k, v]) => [k, { database_id: PLACEHOLDER, data_source_id: PLACEHOLDER, key: v.key }]));
  n.views = {};
  n.parent_page_id = parentId;
  n.setup_page_parents = [parentId];
  n.demo_parent_page_id = parentId;
  cfg.tags = { default: 'text' };
  cfg.judge.groups = { G1: [tag] };
  return cfg;
}

/** The ids of the five tables go into the demo's config (database and data source) as soon as they are known. */
export function setTableIds(config, table, { database_id: databaseId, data_source_id: dataSourceId }) {
  const entry = table === 'rulebook' ? config.notion.rulebook : table === 'claims_copy' ? config.notion.claims[0] : config.notion.databases[table];
  entry.database_id = hex32(databaseId);
  entry.data_source_id = hex32(dataSourceId);
}

// ---- the page --------------------------------------------------------------------------------------------------------------------------

const paragraphBlock = (text) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: parseInline(text) } });
const keyOfViewName = (name) => viewKey(name);

/** The text of a block with every run of white space made one space: how a page that was read back is compared with the one that was planned. */
export const plainBlockText = (block) => blockText(block).replace(/\s+/g, ' ').trim();

/** A short signature of a block, for comparing a page that was read back with the one that was planned: the type, and its text (a table: its width). */
export function signature(block) {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'table') return `table|${block.table?.table_width ?? ''}`;
  return `${block.type}|${plainBlockText(block)}`;
}

/**
 * What the page is made of, from the template. { rendered, pre, post, slots, toggle }:
 *   rendered  the template with {{edition}} and {{date}} filled in (block placeholders stay on their lines)
 *   pre       the items before the tables, in order: { kind: 'block', block } or { kind: 'slot', key, name } (a linked view goes there)
 *   post      the blocks after the tables (the Help toggle)
 *   slots     [{ key, name, index }] with the index of the slot in `pre`; the block before a slot is its anchor
 */
export function pageModel(template, values) {
  const rendered = renderPreview(template, values);
  const segments = splitAtMarkers(toBlocks(template, { values }));
  const pre = [];
  const post = [];
  const slots = [];
  let tables = 0;
  for (const seg of segments) {
    const into = tables > 0 ? post : pre;
    for (const block of seg.blocks) into.push({ kind: 'block', block });
    const m = seg.marker;
    if (!m) continue;
    if (m.marker === 'view') {
      const key = keyOfViewName(m.name);
      if (!Object.hasOwn(LINKED_VIEWS, key)) throw new ManifestError(`the page template places a view called "${m.name}", which is not one of the linked views (Your queue, Lessons waiting)`);
      if (tables > 0) throw new ManifestError(`the page template places "${m.name}" after the tables`);
      if (slots.some((s) => s.key === key)) throw new ManifestError(`the page template places "${m.name}" twice`);
      if (pre.length === 0 || pre[pre.length - 1].kind !== 'block') throw new ManifestError(`the page template places "${m.name}" without a block before it to put it after`);
      slots.push({ key, name: m.name, index: pre.length });
      pre.push({ kind: 'slot', key, name: m.name });
    } else if (m.marker === 'tables') {
      tables += 1;
      if (tables > 1) throw new ManifestError('the page template has more than one tables placeholder');
    }
  }
  if (tables !== 1) throw new ManifestError('the page template has no tables placeholder');
  const toggle = post.find((p) => p.block.type === 'toggle')?.block ?? null;
  return { rendered, pre, post, slots, toggle };
}

/** A toggle without its children (the REST API takes the children of a toggle in a request of their own), and its children. */
export function splitToggle(toggle) {
  if (!toggle) return { stub: null, children: [] };
  const { children = [], ...rest } = toggle.toggle;
  return { stub: { ...toggle, toggle: rest }, children };
}

/** The top-level content blocks the page must hold, in order (the toggle without its children last). `fallbackKeys`: the slots whose linked view is missing. */
export function expectedContent(model, fallbackKeys = []) {
  const out = [];
  for (const item of model.pre) {
    if (item.kind === 'block') out.push(item.block);
    else if (fallbackKeys.includes(item.key)) out.push(paragraphBlock(FALLBACK_TEXT[item.key]));
  }
  for (const item of model.post) out.push(item.block.type === 'toggle' ? splitToggle(item.block).stub : item.block);
  return out;
}

/** The blocks of the pre-tables part only (without slots): what is appended before the databases are made. */
export const preBlocks = (model) => model.pre.filter((i) => i.kind === 'block').map((i) => i.block);

/** The blocks to put after the tables, with the toggle in its stub form. */
export const postBlocks = (model) => model.post.map((i) => (i.block.type === 'toggle' ? splitToggle(i.block).stub : i.block));

/** The block before each slot, as an index into preBlocks(model): { your_queue: 26, lessons_waiting: 43 }. */
export function anchorIndexes(model) {
  const out = {};
  let count = 0;
  for (const item of model.pre) {
    if (item.kind === 'block') count += 1;
    else out[item.key] = count - 1;
  }
  return out;
}

/** The template as the page reads when the linked view of a slot is missing: the marker line is replaced by its fallback paragraph. */
export function withFallbackText(rendered, fallbackKeys) {
  if (!fallbackKeys.length) return rendered;
  return rendered.split('\n').map((line) => {
    const m = /^\s*\{\{\s*view:\s*([^{}]*?)\s*\}\}\s*$/.exec(line);
    const key = m ? keyOfViewName(m[1]) : null;
    return key && fallbackKeys.includes(key) ? FALLBACK_TEXT[key] : line;
  }).join('\n');
}

const tableList = () => TABLES.map((t) => PRACTICE_TITLES[t]).join(', ');

/**
 * preview.md: the rendered template, with an HTML comment under each marker that says what goes there (the five tables in order; each linked view and
 * the table it shows), and, where a linked view is missing, its fallback paragraph in place of the marker. The comments are invisible when the file is
 * shown as Markdown and carry nothing that the page lint reads; `tablesPosition` "end" says that the tables sit at the end of the page instead.
 */
export function annotatedPreview(rendered, { fallbackKeys = [], tablesPosition = 'marker' } = {}) {
  const lines = withFallbackText(rendered, fallbackKeys).split('\n');
  const out = [];
  for (const line of lines) {
    out.push(line);
    const view = /^\s*\{\{\s*view:\s*([^{}]*?)\s*\}\}\s*$/.exec(line);
    if (view) out.push(`<!-- Linked view ${VIEW_NAMES[keyOfViewName(view[1])] ?? view[1]}: a view of the ${PRACTICE_TITLES[LINKED_VIEWS[keyOfViewName(view[1])]] ?? 'table'} table, placed here, right under the line above. -->`);
    else if (/^\s*\{\{\s*tables\s*\}\}\s*$/.test(line)) {
      out.push(tablesPosition === 'end'
        ? `<!-- The five tables could not be placed here, so they sit at the end of the page, in this order: ${tableList()}. -->`
        : `<!-- The five tables are made here, in this order: ${tableList()}. -->`);
    }
  }
  return out.join('\n');
}

// ---- rows ---------------------------------------------------------------------------------------------------------------------------

/** The Rulebook row: the manifest's tag, with Example Claims as one text (one claim per line), shaped like a row of the taxonomy file. */
export function rulebookRow(manifest) {
  const tag = { ...manifest.tag };
  tag['Example Claims'] = Array.isArray(tag['Example Claims']) ? tag['Example Claims'].join('\n') : tag['Example Claims'];
  delete tag.copied_from;
  return tag;
}

/** The key of the ledger row of a claim: "<Geo ID>::<tag>". */
export const queueKey = (claim, tag) => `${claim['Geo ID']}::${tag}`;

/**
 * The rulebook file a practice page starts with, built in memory the way writeProfile builds it (the one tag of the manifest, the demo's config). Its edition is the edition the seeded
 * proposals are said to be made under (the Rulebook edition of each seeded ledger row, which the key of a reading holds: lib/readings.mjs readingHash) and the edition in the Read under of
 * each seeded reading, so the first distill sees the readings as current and asks the model nothing about them.
 */
export function practiceRubric(manifest, config, { edition, now = new Date(0) } = {}) {
  const source = { database_id: 'not made yet', data_source_id: 'not made yet', read_via: 'manifest', read_at: new Date(now).toISOString() };
  return buildRubric([rulebookRow(manifest)], { config, edition, source, now });
}

/**
 * The editor's three columns of a claim as the cells of its create. A decided claim (the manifest's decided entry) is created Reviewed, with its verified tags and the
 * audit's words; an open claim is created with Review status To review and the other two empty. `tagPages` maps a tag name to the page id of its row in the
 * Rulebook (the relation holds page ids); a tag it does not know is an error. The names of the columns are CLAIM_COLUMNS.
 */
export function claimEditorCells(manifest, claim, tagPages) {
  const C = CLAIM_COLUMNS;
  const d = manifest.decided.find((x) => x.claim === claim.key);
  const cells = {};
  if (!d) {
    cells[C.review_status] = 'To review';
    return cells;
  }
  const ids = d[C.verified].map((name) => {
    if (!tagPages?.[name]) throw new ManifestError(`the claim ${claim.key} names the tag ${name} in ${C.verified}, which has no row in the Rulebook of the page`);
    return tagPages[name];
  });
  if (ids.length) cells[C.verified] = ids;
  cells[C.review_status] = d[C.review_status];
  cells[C.notes] = d[C.notes];
  return cells;
}

// A decided claim of the manifest as the reading step sees it (decision 73): the claim as a pull would give it, its ledger row as the page creates it, and the item that
// classifyRows makes of the two for the one tag (the same inputs that distill hashes, so the seeded readings are current at the first distill). null for an open claim.
function seedOf(manifest, claim, rubric) {
  const C = CLAIM_COLUMNS;
  const tag = manifest.tag.Name;
  const d = manifest.decided.find((x) => x.claim === claim.key);
  if (!d) return null;
  const row = { Key: queueKey(claim, tag), Tag: tag, 'Agent proposal': d['Agent proposal'], 'Rulebook edition': rubric?.edition ?? null };
  const reviewed = { geo_id: claim['Geo ID'], review_status: d[C.review_status], verified_tags: d[C.verified], challenged_notes: d[C.notes] };
  const [decision] = decisionsFor(reviewed, [row], { tagNames: [tag] });
  const differs = decision.outcome !== row['Agent proposal'];
  let item = null;
  if (rubric) {
    const classes = classifyRows({ claims: [reviewed], ledgerRows: [row], rubric });
    item = Object.values(classes).flat().find((i) => i?.key === row.Key) ?? null;
  }
  return { d, row, reviewed, decision, differs, item };
}

// The four ledger values of a seeded reading, for a decided claim whose outcome differs from the agent's proposal: Agent slip (the audit found that the agent slipped), the rule the
// row's Agent reason cites (none: the seeded rows carry no Agent reason), the note "Seeded from the audit of 9 October.", and Read under with the key classifyRows computes.
function seededCells(seed, rubric) {
  if (!seed.differs || !seed.item) return null;
  const rule = seed.item.citedRule === null ? null : `${seed.item.tag} rule ${seed.item.citedRule}`;
  return readingCells(seed.item, { reading: 'Agent slip', rule, note: SEEDED_NOTE }, rubric.edition);
}

/**
 * What the ledger holds for a decided claim, as the tag step copies it (lib/decisions.mjs decisionsFor): the proposal the agent made before the audit, the editor's
 * outcome (Applies when the tag is among the verified tags) and the words. Decided under stays empty (the audit gave no edition; the first tag step copies it). With the page's `rubric`
 * the row also holds the Rulebook edition of the page (the edition the proposal is said to be made under, which the key of a reading holds), and a row where the outcome differs from the
 * proposal is created already read (decision 73): Agent reading "Agent slip", Rule, Reading note "Seeded from the audit of 9 October." and Read under; a row where the agent was right
 * gets no reading columns.
 */
export function ledgerCopy(manifest, claim, { rubric = null } = {}) {
  const seed = seedOf(manifest, claim, rubric);
  if (!seed) return null;
  const copy = {
    'Agent proposal': seed.d['Agent proposal'], 'Tag outcome': seed.decision.outcome, 'Why wrong': seed.decision.why_wrong, 'Your reasoning': seed.decision.reasoning,
  };
  return rubric ? { ...copy, 'Rulebook edition': rubric.edition, ...(seededCells(seed, rubric) ?? {}) } : copy;
}

/**
 * The agent's own cell on a decided claim at creation: its Agent reading (decision 68), worked out by the same function that distill uses, from the claim and its ledger row with
 * the seeded reading. A disagreement reads "Context-dependent: Agent slip · Seeded from the audit of 9 October." (with ", rule <n>" after Agent slip when a rule is cited); a claim
 * where the agent was right reads "Nothing to read: the agent agreed with you.". An open claim has none (an empty cell means not read yet). `column` is config write_columns.reading.
 */
export function claimAgentCells(manifest, claim, { rubric, column = AGENT_READING_COLUMN }) {
  const seed = seedOf(manifest, claim, rubric);
  if (!seed || !seed.item) return {};
  const cells = seededCells(seed, rubric);
  const item = { ...seed.item, row: { ...seed.row, ...(cells ?? {}) } };
  const cell = claimReadingCell({ claim: seed.reviewed, items: [item], readings: undefined, unjudged: [] });
  return cell === null ? {} : { [column]: cell };
}

/**
 * The creates for Tag decisions (the agent's ledger): one row for each decided claim, in the order of the manifest, with Claim, Key, Tag, the link to the claim's row and
 * the copy of the decision (Agent proposal, Tag outcome, Your reasoning) and, with the page's `rubric`, the seeded reading of a disagreement. The open claims have no row: the
 * tag step makes them. `claimLinks` maps a Geo ID to the link of its row.
 */
export function ledgerOps(manifest, claimLinks, { rubric = null } = {}) {
  const tag = manifest.tag.Name;
  return manifest.claims.filter((claim) => manifest.decided.some((d) => d.claim === claim.key)).map((claim) => {
    const properties = { Claim: claim['Geo Name'], Key: queueKey(claim, tag), Tag: tag };
    if (claimLinks[claim['Geo ID']]) properties['Claim link'] = claimLinks[claim['Geo ID']];
    for (const [column, value] of Object.entries(ledgerCopy(manifest, claim, { rubric }))) if (typeof value === 'string' && value !== '') properties[column] = value;
    return { key: properties.Key, properties };
  });
}

/** The ledger keys of the claims that wait for the editor (the manifest's open claims), and of the claims decided earlier. */
export function openKeys(manifest) {
  const open = new Set(manifest.open.map((o) => o.claim));
  const tag = manifest.tag.Name;
  return {
    open: manifest.claims.filter((c) => open.has(c.key)).map((c) => queueKey(c, tag)),
    decided: manifest.claims.filter((c) => !open.has(c.key)).map((c) => queueKey(c, tag)),
  };
}

/** The claims that wait for the editor, in the order of the manifest: [{ claim: 'presspool', geo_id, key (the ledger key) }]. */
export function openClaims(manifest) {
  const tag = manifest.tag.Name;
  return manifest.open.map((o) => {
    const claim = manifest.claims.find((c) => c.key === o.claim);
    return { claim: claim.key, geo_id: claim['Geo ID'], key: queueKey(claim, tag) };
  });
}

// ---- where the editor is ------------------------------------------------------------------------------------------------------------

const text = (v) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());
const byCreated = (a, b) => text(b.created).localeCompare(text(a.created));

/**
 * The mapping of the design (W4 9.3), from a pull of the demo's tables: claims = the rows of the Claims (geo_id, review_status, agent_status), ledger = the rows of Tag
 * decisions (Key, Follow-up), lessons = the rows of Rule changes (Lesson, Status, Safety check result, supporting_keys), open = the claims that wait for the editor
 * (openClaims: geo_id and ledger key; four on the page), settings = the row of Agent settings (Last run summary). An editor's decision is a claim whose Review status is Reviewed.
 *   { step: 1 }                          a fresh page: an open claim is not Reviewed, has no Agent status, and Agent settings has no Last run summary
 *   { step: 2 }                          the same, but a command has written a Last run summary (the tag step, which writes the agent's columns, has not finished)
 *   { step: 3, remaining }               they have an Agent status (the agent has read them) and `remaining` of them are not Reviewed
 *   { step: 4 }                          all are Reviewed and there is no rule change
 *   { step: 5, lesson }                  a rule change is Proposed
 *   { step: 6, lesson }                  Approved, no Safety check result yet
 *   { step: 6, branch: 'not-passed' }    Approved, with a result that is not a PASS
 *   { step: 7, branch: 'stopped' }       Live, and the ledger row of one of the claims it rests on has no Follow-up
 *   { step: 7, branch: 'read' }          Live, every such row has a Follow-up and one of them is Still wrong
 *   { step: 'complete' }                 Live with every such row Fixed, or the rule change was Rejected or rolled back
 *   { problem }                          an open claim is not in Claims
 * Step 7 is read from the ledger rows the live rule change rests on (its supporting_keys, decision 76), not from all the open claims: on the page it rests on two of the four, and the
 * other two keep Agent status Waits for you until the next tag run. A live rule change that names none of the open claims (a Supporting rows cell that cannot be read) is read from all of them.
 */
export function stepOf({ claims = [], ledger = [], lessons = [], open = [], settings = null }) {
  const byId = new Map(claims.map((c) => [text(c.geo_id), c]));
  const rows = open.map((o) => byId.get(o.geo_id));
  if (open.length === 0 || rows.some((r) => !r)) {
    const missing = open.filter((o) => !byId.has(o.geo_id)).map((o) => o.claim ?? o.geo_id);
    return { problem: `a claim that waits for the editor is not in Claims (${missing.join(', ') || 'none are known'})` };
  }
  const reviewed = (c) => text(c.review_status) === 'Reviewed';
  // Last run summary is empty from the build until the first command that writes: the tag step writes it together with the agent's columns, and status writes nothing,
  // so a page where only status was typed is still at step 1. No Agent status means the agent has not read the claim; "Waits for you" means it has read it and it waits.
  if (rows.some((c) => !reviewed(c) && text(c.agent_status) === '')) return text(settings?.last_run_summary) === '' ? { step: 1 } : { step: 2 };
  const remaining = rows.filter((c) => !reviewed(c)).length;
  if (remaining > 0) return { step: 3, remaining };
  const mine = [...lessons].sort(byCreated);
  const approved = mine.find((l) => l.Status === 'Approved');
  if (approved) return text(approved['Safety check result']) === '' ? { step: 6, lesson: approved } : { step: 6, branch: 'not-passed', lesson: approved };
  const proposed = mine.find((l) => l.Status === 'Proposed');
  if (proposed) return { step: 5, lesson: proposed };
  const live = mine.find((l) => l.Status === 'Live');
  if (live) {
    const byKey = new Map(ledger.map((r) => [text(r.Key), r]));
    const resting = new Set((live.supporting_keys ?? []).map(text));
    const rests = open.filter((o) => resting.has(text(o.key)));
    const follow = (rests.length > 0 ? rests : open).map((o) => text(byKey.get(o.key)?.['Follow-up']));
    if (follow.some((f) => f === '')) return { step: 7, branch: 'stopped', lesson: live };
    if (follow.some((f) => f !== 'Fixed')) return { step: 7, branch: 'read', lesson: live };
    return { step: 'complete', lesson: live };
  }
  if (mine.length > 0) return { step: 'complete', lesson: mine[0] }; // Rejected or Rolled back: the safety check did its job and the demo ends
  return { step: 4 };
}

// ---- the demos on disk -----------------------------------------------------------------------------------------------------------------

export const demosDir = (root) => join(root, 'runs', 'demos');

/** A demo id is letters, digits, dot, dash and underscore, never "." or "..". */
export const validDemoId = (id) => typeof id === 'string' && /^[A-Za-z0-9._-]+$/.test(id) && !/^\.+$/.test(id);

/** The folder of a demo, refusing any id that would leave runs/demos. Returns the path (it need not exist). */
export function demoDir(root, id) {
  if (!validDemoId(id)) throw new ManifestError(`"${id}" is not a practice page id`);
  const base = resolve(demosDir(root));
  const dir = resolve(base, id);
  const rel = relative(base, dir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.includes('/') || rel.includes('\\')) throw new ManifestError(`"${id}" is not a folder under the practice pages`);
  return dir;
}

/** demo.json of a demo folder, or null. */
export function readDemo(dir) {
  const file = join(dir, 'demo.json');
  if (!existsSync(file)) return null;
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

/** Every demo under <root>/runs/demos that has a demo.json, newest first: [{ id, dir, demo }]. */
export function listDemos(root) {
  const base = demosDir(root);
  if (!existsSync(base)) return [];
  const out = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || !validDemoId(entry.name)) continue;
    const dir = join(base, entry.name);
    const demo = readDemo(dir);
    if (demo && typeof demo === 'object') out.push({ id: entry.name, dir, demo });
  }
  return out.sort((a, b) => String(b.demo.created_at ?? '').localeCompare(String(a.demo.created_at ?? '')) || b.id.localeCompare(a.id));
}

/**
 * Why the current loader cannot read a demo's profile, or null when it can: its config.json is not that of a demo profile of that name, the copy of the manifest
 * or the page template is missing, or has a shape this build does not read (the pages of 15 October have the older manifest), or its structure or page model does
 * not load. The same files and order as `loadDemoContext` in scripts/walkthrough.mjs, but returning the first problem instead of throwing. A copy that reads but is
 * no longer the one the page was planned from (the checksums in demo.json) is not a profile that cannot be read: that is damage, and the command that acts on the
 * page says so out loud. `found` is { id, dir, demo } as listDemos makes it.
 */
export function profileProblem({ id, dir, demo }) {
  try {
    const config = loadConfig(dir);
    if (config.demo !== true || config.demo_id !== id) return 'its config.json is not the profile of a practice page of that name';
    const manifestFile = join(dir, 'walkthrough', 'manifest.json');
    const templateFile = join(dir, 'walkthrough', 'page.md');
    if (!existsSync(manifestFile) || !existsSync(templateFile)) return 'it has no copy of its manifest and page template';
    loadManifest(manifestFile);
    const template = loadTemplate(templateFile);
    practiceStructure(readJson(join(dir, 'setup', 'structure.json')));
    pageModel(template.text, { edition: demo?.edition, date: demo?.date });
    return null;
  } catch (e) {
    return String(e?.message ?? e).split('\n').slice(0, 2).map((l) => l.trim()).join(' ');
  }
}

/** True when the demo's page was made under the page `under` (a 32-digit id, with or without dashes). */
export const isUnder = (found, under) => isRealId(under) && hex32(found?.demo?.parent?.id) === hex32(under);

/**
 * The practice page a command acts on. With an id: that page, wherever it is (any state, any folder). Without one: the newest page that was made under the Demos
 * sub-page (`under`, the id in config.notion.pages.demos), whose profile the current loader can read, and, when `ready` is set, whose build is finished. A page under
 * Demo tests (the evals and verification runs) or any other parent is never picked by default, and neither is a page of an older shape; they are reached with the id.
 * Throws ManifestError when there is none, and when the default is asked for with no Demos page to look under.
 */
export function pickDemo(root, id, { ready = false, under = null } = {}) {
  if (id !== undefined && id !== null) {
    const dir = demoDir(root, id);
    const demo = readDemo(dir);
    if (!demo) throw new ManifestError(`there is no practice page "${id}" (no demo.json in its folder)`);
    return { id, dir, demo };
  }
  if (!isRealId(under)) throw new ManifestError('the Demos page is not set in config.json (notion.pages.demos), so the newest practice page under it cannot be told; name a page with --demo <id>');
  const found = listDemos(root).find((d) => isUnder(d, under) && (!ready || d.demo.state === 'ready') && profileProblem(d) === null);
  if (!found) throw new ManifestError(ready ? 'there is no finished practice page under Demos yet; ask for one first' : 'there is no practice page under Demos yet; ask for one first');
  return found;
}

// ---- the request log ------------------------------------------------------------------------------------------------------------------

/**
 * A request log that can start before its folder exists: events are kept in memory until attach(file) is called (a practice page that is
 * refused leaves no folder behind), then written to the file in the format of requestLogger, and later events go straight to it.
 */
export function bufferedLog() {
  let file = null;
  const held = [];
  const write = (event) => {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(event)}\n`);
  };
  return {
    log: ({ method, path, status, attempt }) => {
      const event = { ts: new Date().toISOString(), method, path, status, attempt };
      if (file) write(event);
      else held.push(event);
    },
    attach(target) {
      file = target;
      for (const event of held.splice(0)) write(event);
    },
  };
}

// ---- the two placements the client cannot spell ----------------------------------------------------------------------------------------

/**
 * A fetch for the builder's clients that spells two placements which lib/notion-rest.mjs has no argument for. Everything else passes through
 * untouched, and so does every request that does not carry the marker, so this changes nothing for the other scripts.
 *
 *   createView({ ..., position: { type: 'after_block', page_id, block_id } })
 *       -> POST /views with create_database: { parent: { type: 'page_id', page_id }, position: { type: 'after_block', block_id } } in place of
 *          database_id: a linked view of the data source, put on the page right after that block (2026-03-11)
 *   appendBlocks(pageId, [{ ..., __after: '<block id>' }, ...])
 *       -> PATCH /blocks/<pageId>/children with `after: '<block id>'`: the blocks go after that block and not at the end (2022-06-28)
 *
 * The request still goes through the client, so it is paced, retried, scrubbed, logged, and a create whose answer is lost is still never sent twice.
 */
export function placementFetch(inner = globalThis.fetch) {
  return async (url, init = {}) => {
    const method = String(init.method ?? 'GET').toUpperCase();
    if ((method !== 'POST' && method !== 'PATCH') || typeof init.body !== 'string') return inner(url, init);
    let route;
    try {
      route = new URL(String(url)).pathname.replace(/^\/v1/, '');
    } catch {
      return inner(url, init);
    }
    if (method === 'POST' && route === '/views') {
      const body = JSON.parse(init.body);
      const p = body?.position;
      if (p?.type === 'after_block' && typeof p.page_id === 'string' && typeof p.block_id === 'string') {
        const { database_id: _database, position: _position, ...rest } = body;
        const next = { ...rest, create_database: { parent: { type: 'page_id', page_id: p.page_id }, position: { type: 'after_block', block_id: p.block_id } } };
        return inner(url, { ...init, body: JSON.stringify(next) });
      }
    } else if (method === 'PATCH' && /^\/blocks\/[^/]+\/children$/.test(route)) {
      const body = JSON.parse(init.body);
      const first = body?.children?.[0];
      if (first && typeof first === 'object' && typeof first.__after === 'string') {
        const after = first.__after;
        const { __after: _marker, ...clean } = first;
        return inner(url, { ...init, body: JSON.stringify({ ...body, children: [clean, ...body.children.slice(1)], after }) });
      }
    }
    return inner(url, init);
  };
}
