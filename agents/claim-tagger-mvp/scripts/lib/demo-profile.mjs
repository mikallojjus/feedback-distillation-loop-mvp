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
//   rulebookRow(manifest) / queueOps(manifest, claimLinks) / openKeys(manifest) / queueKey(claim, tag)
//                                              -> the Rulebook row, the creates of Tag decisions, the keys of the two rows that wait, a row's key
//   stepOf({ queue, lessons, openKeys })       -> where the editor is: { step, branch, lesson } (the mapping of the design)
//   placementFetch(inner)                      -> a fetch that spells two placements the Notion client cannot (see the function)
//   bufferedLog()                              -> a request log that starts in memory and moves to its file when the folder exists
//   demosDir / demoDir / listDemos / pickDemo  -> the demos under <root>/runs/demos
//   constants: PRACTICE_TITLES, VIEW_NAMES, LINKED_VIEWS, TAB_VIEWS, FALLBACK_TEXT, CONTENT_TYPES

import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { TABLES } from './config.mjs';
import { readJson } from './jsonl.mjs';
import { blockText, parseInline, renderPreview, splitAtMarkers, toBlocks } from './notion-blocks.mjs';
import { AUTOMATIC_TYPES, validateStructure, viewKey } from './notion-build.mjs';
import { normId } from './notion-values.mjs';
import { stampOf } from './editor-words.mjs';

// ---- names -------------------------------------------------------------------------------------------------------------------------

/** The titles of the five tables on a practice page (decision 28): no "copy" in the name. */
export const PRACTICE_TITLES = Object.freeze({
  rulebook: 'Rulebook', claims_copy: 'Claims', tag_decisions: 'Tag decisions', rule_changes: 'Rule changes', agent_settings: 'Agent settings',
});
/** The four view names of the page (production's), by their config key. */
export const VIEW_NAMES = Object.freeze({
  your_queue: 'Your queue', needs_your_note: 'Needs your note', lessons_waiting: 'Lessons waiting', rulebook: 'Rulebook',
});
/** The two linked views: placed inside a step, a view of this table. */
export const LINKED_VIEWS = Object.freeze({ your_queue: 'tag_decisions', lessons_waiting: 'rule_changes' });
/** The two views that are tabs of their table; `position` is where the tab goes (the table's own first view stays first for Tag decisions). */
export const TAB_VIEWS = Object.freeze({ rulebook: { table: 'rulebook', position: 'start' }, needs_your_note: { table: 'tag_decisions', position: 'end' } });
/** What stands in a step where its linked view could not be made. */
export const FALLBACK_TEXT = Object.freeze({
  your_queue: 'Scroll to Tag decisions at the bottom of this page; your two rows are the ones without a Tag outcome.',
  lessons_waiting: 'Scroll to Rule changes at the bottom of this page and open the row with Status Proposed.',
});
/** The block types the page template can make (anything else on the page, a table or a linked view, is not template text). */
export const CONTENT_TYPES = new Set(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'quote', 'divider', 'callout', 'table', 'toggle']);

const OUTCOMES = ['Applies', 'Does not apply'];
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
      if (label === 'decided') {
        if (!OUTCOMES.includes(r['Tag outcome'])) bad(`decided[${i}] (${r.claim}): Tag outcome must be one of ${OUTCOMES.join(', ')}`);
        if (typeof r['Your reasoning'] !== 'string') bad(`decided[${i}] (${r.claim}): Your reasoning is missing`);
        if (typeof r['Agent proposal'] !== 'string') bad(`decided[${i}] (${r.claim}): Agent proposal is missing`);
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

/** The columns a table is filled from: the structure's, less the ones Notion fills by itself. */
export const writableColumns = (structure, table) => structure.tables[table].columns.filter((c) => !AUTOMATIC_TYPES.includes(c.type)).map((c) => c.name);

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

/** The key of the queue row of a claim: "<Geo ID>::<tag>". */
export const queueKey = (claim, tag) => `${claim['Geo ID']}::${tag}`;

/**
 * The creates for Tag decisions: one row per claim in the order of the manifest, with Claim, Key, Tag and the link to the claim's row; the decided
 * rows (decision 29) also carry Agent proposal, Tag outcome, Why wrong and Your reasoning. `claimLinks` maps a Geo ID to the link of its row.
 */
export function queueOps(manifest, claimLinks) {
  const tag = manifest.tag.Name;
  const decided = new Map(manifest.decided.map((d) => [d.claim, d]));
  return manifest.claims.map((claim) => {
    const properties = { Claim: claim['Geo Name'], Key: queueKey(claim, tag), Tag: tag };
    if (claimLinks[claim['Geo ID']]) properties['Claim link'] = claimLinks[claim['Geo ID']];
    const d = decided.get(claim.key);
    if (d) {
      for (const column of ['Agent proposal', 'Tag outcome', 'Why wrong', 'Your reasoning']) if (typeof d[column] === 'string' && d[column] !== '') properties[column] = d[column];
    }
    return { key: properties.Key, properties };
  });
}

/** The keys of the rows that wait for the editor (the manifest's open rows), and of the rows decided earlier. */
export function openKeys(manifest) {
  const open = new Set(manifest.open.map((o) => o.claim));
  const tag = manifest.tag.Name;
  return {
    open: manifest.claims.filter((c) => open.has(c.key)).map((c) => queueKey(c, tag)),
    decided: manifest.claims.filter((c) => !open.has(c.key)).map((c) => queueKey(c, tag)),
  };
}

// ---- where the editor is ------------------------------------------------------------------------------------------------------------

const text = (v) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());
const byCreated = (a, b) => text(b.created).localeCompare(text(a.created));

/**
 * The mapping of the design (W4 9.3), from a pull of the demo's tables: queue = the rows of Tag decisions (Key, Agent proposal, Tag outcome, Follow-up),
 * lessons = the rows of Rule changes (Lesson, Status, Safety check result), openKeys = the keys of the two rows that wait for the editor.
 *   { step: 2 }                          the open rows have no Agent proposal yet
 *   { step: 3 }                          they have a proposal and no Tag outcome
 *   { step: 4 }                          both are decided and there is no rule change
 *   { step: 5, lesson }                  a rule change is Proposed
 *   { step: 6, lesson }                  Approved, no Safety check result yet
 *   { step: 6, branch: 'not-passed' }    Approved, with a result that is not a PASS
 *   { step: 7, branch: 'stopped' }       Live, and a row of the two has no Follow-up
 *   { step: 7, branch: 'read' }          Live, every row has a Follow-up and one of them is Still wrong
 *   { step: 'complete' }                 Live with both Fixed, or the rule change was Rejected or rolled back
 *   { problem }                          one of the two rows is not in the queue
 */
export function stepOf({ queue = [], lessons = [], openKeys: keys = [] }) {
  const byKey = new Map(queue.map((r) => [text(r.Key), r]));
  const open = keys.map((k) => byKey.get(k));
  if (open.length === 0 || open.some((r) => !r)) return { problem: `a row that waits for the editor is not in Tag decisions (${keys.filter((k) => !byKey.has(k)).join(', ') || 'none are known'})` };
  if (open.some((r) => text(r['Agent proposal']) === '')) return { step: 2 };
  if (open.some((r) => text(r['Tag outcome']) === '')) return { step: 3 };
  const mine = [...lessons].sort(byCreated);
  const approved = mine.find((l) => l.Status === 'Approved');
  if (approved) return text(approved['Safety check result']) === '' ? { step: 6, lesson: approved } : { step: 6, branch: 'not-passed', lesson: approved };
  const proposed = mine.find((l) => l.Status === 'Proposed');
  if (proposed) return { step: 5, lesson: proposed };
  const live = mine.find((l) => l.Status === 'Live');
  if (live) {
    if (open.some((r) => text(r['Follow-up']) === '')) return { step: 7, branch: 'stopped', lesson: live };
    if (open.some((r) => text(r['Follow-up']) !== 'Fixed')) return { step: 7, branch: 'read', lesson: live };
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

/** The demo asked for by id, else the newest (a ready one when `ready` is set). Throws ManifestError when there is none. */
export function pickDemo(root, id, { ready = false } = {}) {
  if (id !== undefined && id !== null) {
    const dir = demoDir(root, id);
    const demo = readDemo(dir);
    if (!demo) throw new ManifestError(`there is no practice page "${id}" (no demo.json in its folder)`);
    return { id, dir, demo };
  }
  const found = listDemos(root).find((d) => !ready || d.demo.state === 'ready');
  if (!found) throw new ManifestError(ready ? 'there is no finished practice page yet; ask for one first' : 'there is no practice page yet; ask for one first');
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
