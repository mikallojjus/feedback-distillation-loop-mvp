// The archive step of setup (decision P9, 27 Oct 2026): the first build is set aside under the hub and a fresh set is built next to it. Setup renames the
// root page to "Claim tagger", makes the page "Feedback Distillation MVP (archive, to 27 Oct 2026)" under it, and moves the eight old objects into that page:
// the three sub-pages (Structure proposal, Demos, Demo tests) and the five old tables (Rulebook copy, Claims copy, Tag decisions, Rule changes, Agent settings).
//
// The archive step, P9: this file never deletes or trashes anything (P51: only remove.mjs trashes, and only Claims and Tag decisions rows), and only setup, in a
// builder session, may move the agent's own pages and tables within the hub. This file is the only place that calls movePage and moveDatabase, and it moves nothing but the eight objects that config.json names, only when
// they sit directly on the hub page, only into the Archive page. Everything it moves becomes protected (archiveConfigChange).
//
//   knownObjects(config)                  -> [{ key, kind: 'page' | 'database', id, data_source_id }]  the eight old objects, read from config.json (id null for a placeholder)
//   snapshotRoot({ client, config, archivePageId? })
//                                         -> { root, children, objects, archive }  GET only: the root page, its block children, the current parent of every known object,
//                                            and the Archive page (the recorded one, or the one page under the root with the exact title)
//   planArchive({ config, snapshot, runId?, now? })
//                                         -> the plan: { version, root, archive, ops: [rename_root, create_archive_page, move x8], satisfied, leftovers }  (pure; throws
//                                            ArchiveError when two pages carry the Archive title or there is nothing to archive)
//   checkArchivePlan(plan, config)        -> { ok, problems }  every op targets a known old id, every destination is the Archive page, every source parent is the root
//                                            or already the Archive, no target is protected
//   applyArchive({ plan, dir, client, config, now?, log?, onArchivePage? })
//                                         -> { code, renamed, created, archive_page, moves, stopped, ledger }  writes dir/plan.json and dir/archive-ledger.jsonl; reads
//                                            first and skips what is done; reads every new parent back; stops at the first problem
//   walkArchiveTree({ client, config, objects? })
//                                         -> { practice_pages, tables, views, errors }  GET only: the practice pages under Demos and Demo tests, their tables and data
//                                            source ids, the five old tables, the old views; a failed read is recorded, never fatal
//   archiveConfigChange(config, archive)  -> a new config: pages { onboarding, archive }, table ids set to the placeholder, views cleared, every archived id protected
//   stepArchive(ctx, { planOnly })        -> { code, lines, errors }  the whole step for setup.mjs: snapshot, plan, apply, walk, setup/archive.json, config.json, the
//                                            builder registry set aside under runs/builder/before-archive/
//   readArchiveState(root), archivedIds(root), setAsideBuilder(root), leftoversOf(children, ...), archivePath(root)
//   archiveFirst(root, config)            -> true while the first build's tables are still on the hub and the archive has not run (setup.mjs refuses every other step then); ARCHIVE_FIRST_MESSAGE
//   archiveRewritten(config, archive)     -> does config.json name the Archive page that a "done" record names? false after a config rewrite that failed (setup.mjs then refuses every
//                                            other step with ARCHIVE_NOT_REWRITTEN_MESSAGE until `archive` has run again; that run sends nothing)
//   linksBack(block, hubId)               -> is this block the Archive page's first line, with "Claim tagger" linked to the hub page (matched by the page's id)
//
// Resuming. Nothing is remembered between runs except setup/archive.json (state "moving" while the step is under way, "done" at the end) and what Notion
// shows: every run reads the parents first, skips what is under the Archive page already, and does only what is missing. A move that Notion refuses (400 or
// 403) stops the step with exit 2 and names the object; a person drags it into the Archive page by hand and runs the step again. Any other error is exit 1
// and the same command is run again.

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { builderPaths, logLine } from './builder-registry.mjs';
import { isProtected, validateConfig } from './config.mjs';
import { EXIT } from './exit-codes.mjs';
import { appendJsonl, readJson, renameWithRetry, writeJsonAtomic } from './jsonl.mjs';
import { countRequests } from './notion-rest.mjs';
import { normId } from './notion-values.mjs';

export const ARCHIVE_TITLE = 'Feedback Distillation MVP (archive, to 27 Oct 2026)';
export const HUB_TITLE = 'Claim tagger';
const ARCHIVED_ON = '27 Oct 2026';
const PLACEHOLDER = '<setup>'; // what config.json holds for an id that setup fills (the form of tests/mvp/fixtures/config.placeholder.json)
const RETIRED = '<archived>'; // a page key that no longer names a live page
const BUILDER_FILES = Object.freeze(['pages', 'databases', 'state', 'verify']);

/** The eight old objects: three pages (notion.pages) and five tables. The order is the order of the moves. */
export const KNOWN = Object.freeze([
  { key: 'proposal', kind: 'page' }, { key: 'demos', kind: 'page' }, { key: 'demo_tests', kind: 'page' },
  { key: 'rulebook', kind: 'database' }, { key: 'claims', kind: 'database' }, { key: 'tag_decisions', kind: 'database' },
  { key: 'rule_changes', kind: 'database' }, { key: 'agent_settings', kind: 'database' },
]);

/** A step that cannot go on. `code` is the exit code (2 invalid by default); `problems` are the lines a refused plan lists. */
export class ArchiveError extends Error {
  constructor(message, { code = EXIT.INVALID, problems = [] } = {}) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
    this.problems = problems;
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const realId = (v) => {
  if (typeof v !== 'string') return null;
  const n = normId(v.trim());
  return /^[0-9a-f]{32}$/.test(n) ? n : null;
};
const plain = (rich) => (Array.isArray(rich) ? rich.map((x) => x?.plain_text ?? x?.text?.content ?? '').join('') : '');
const pageTitle = (page) => plain(page?.properties?.title?.title);
const databaseTitle = (db) => plain(db?.title);
const parentIdOf = (parent) => {
  const raw = parent?.page_id ?? parent?.block_id ?? parent?.database_id ?? null;
  return raw ? normId(raw) : null;
};
const short = (s, n = 160) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// ---- what config.json names --------------------------------------------------------------------------------------------------------------

/** The eight old objects with their ids as config.json holds them (normalised; null when the entry is a placeholder or missing). */
export function knownObjects(config) {
  const n = config?.notion ?? {};
  return KNOWN.map(({ key, kind }) => {
    if (kind === 'page') return { key, kind, id: realId(n.pages?.[key]), data_source_id: null };
    const entry = key === 'rulebook' ? n.rulebook : key === 'claims' ? n.claims : n.databases?.[key];
    return { key, kind, id: realId(entry?.database_id), data_source_id: realId(entry?.data_source_id) };
  });
}

// ---- setup/archive.json ------------------------------------------------------------------------------------------------------------------

export const archivePath = (root) => join(root, 'setup', 'archive.json');

/** { exists, state, data, error }: what setup/archive.json says. A file that cannot be read has error set; a missing file has exists false. */
export function readArchiveState(root) {
  const file = archivePath(root);
  if (!existsSync(file)) return { exists: false, state: null, data: null, error: null };
  try {
    const data = readJson(file);
    if (!isPlain(data) || typeof data.state !== 'string') return { exists: true, state: null, data: null, error: `${file} has no "state"` };
    return { exists: true, state: data.state, data, error: null };
  } catch (e) {
    return { exists: true, state: null, data: null, error: `${file} cannot be read: ${e.message}` };
  }
}

/** Every id that setup/archive.json lists (the Archive page, the moved pages and tables with their data sources, the practice pages and their tables), normalised. */
export function archivedIds(root) {
  const { data, error } = readArchiveState(root);
  if (error) throw new ArchiveError(error);
  const ids = new Set();
  if (!data) return ids;
  const add = (v) => {
    const n = realId(v);
    if (n) ids.add(n);
  };
  add(data.archive_page);
  for (const m of [...(data.known ?? []), ...(data.moved ?? [])]) {
    add(m?.id);
    add(m?.data_source_id);
  }
  for (const t of data.tables ?? []) {
    add(t?.database_id);
    add(t?.data_source_id);
  }
  for (const p of data.practice_pages ?? []) {
    add(p?.id);
    for (const t of p?.tables ?? []) {
      add(t?.id);
      add(t?.data_source_id);
    }
  }
  return ids;
}

// ---- the gate on the build -------------------------------------------------------------------------------------------------------------------

/**
 * Must the archive step run before this install builds or fills anything? (P9, M1 of the pre-live gate.) True when setup/archive.json is missing and config.json names a real id
 * (database or data source) for any of the five old tables: the first build is still where it was, so a build would add columns and views to its tables and a row step would write
 * the claims into them. A config that holds only placeholders for the tables (a fresh install) is not held back, and neither is an install whose builder state says its tables were
 * recorded by a build that passed this gate (runs/builder/state.json `archive_checked`, written by runStructure): that install has no first build to archive, only the tables it made
 * itself. The state file of the first build has no such mark, so the live install is held back until `setup.mjs archive` has written archive.json. The three old pages (Structure
 * proposal, Demos, Demo tests) do not count: no step writes into a page, and the page of the proposal exists before any setup. A file that exists is judged by readArchiveState instead.
 */
export function archiveFirst(root, config) {
  if (existsSync(archivePath(root))) return false;
  if (!knownObjects(config).some((k) => k.kind === 'database' && (k.id || k.data_source_id))) return false;
  try {
    return readJson(join(builderPaths(root).dir, 'state.json'))?.archive_checked !== true;
  } catch {
    return true;
  }
}

export const ARCHIVE_FIRST_MESSAGE = "the first build's tables are still on the hub page; run setup.mjs archive first (P9)";

/**
 * Has config.json been rewritten for an archive record that says "done"? True when config.notion.pages.archive is the record's Archive page. stepArchive writes the record before it rewrites
 * config.json, so a rewrite that failed (a config that would not validate, a disk error) leaves a "done" record next to a config that still names the first build's tables: the gate of
 * setup.mjs must not let a build or a row step through then (SH-1 of the second pre-live check; they would write into the archived tables, hard rule 10). A record without a real Archive
 * page id is never "rewritten": there is nothing the config could name.
 */
export function archiveRewritten(config, archive) {
  const page = realId(archive?.archive_page);
  return page !== null && realId(config?.notion?.pages?.archive) === page;
}

export const ARCHIVE_NOT_REWRITTEN_MESSAGE = 'the archive step moved everything in Notion but config.json was not rewritten; run setup.mjs archive again (it sends nothing to Notion)';

// ---- reading it back (verify) --------------------------------------------------------------------------------------------------------------

// Does the block carry a link to the page (its address holds the page's id, with or without dashes, in any form Notion may write it: absolute, relative, a /p/<slug>-<id> address)?
const hrefOf = (r) => String(r?.href ?? r?.text?.link?.url ?? '');
const holdsId = (address, pageId) => address.replace(/-/g, '').toLowerCase().includes(String(pageId).replace(/-/g, '').toLowerCase());
const linksToPage = (block, pageId) => (block?.type === 'paragraph' ? block.paragraph?.rich_text ?? [] : []).some((r) => holdsId(hrefOf(r), pageId));

/**
 * GET only. What `setup.mjs verify` reads back of the archive step once setup/archive.json exists (P9; a fresh install has no such file and nothing applies):
 *   the file says "done"; the Archive page is a child of the hub page and its first block links to the hub page; every object that was moved (the eight old pages and tables) has
 *   the Archive page as its parent; every id that archive.json lists (the Archive page, the moved objects and their data sources, the practice pages and their tables) is on
 *   the protected lists of config.json.
 * Returns { applies, differences: [{ kind, detail }] }. A page or table that cannot be read is a difference, not an exception: a check that cannot run is reported, never skipped.
 */
export async function verifyArchive({ client, config, root }) {
  const differences = [];
  const add = (kind, detail) => differences.push({ kind, detail });
  const state = readArchiveState(root);
  if (state.error) {
    add('archive file', state.error);
    return { applies: true, differences };
  }
  if (!state.exists) return { applies: false, differences };
  if (state.state !== 'done') {
    add('archive file', `setup/archive.json says state "${state.state}": the archive step has not finished; run setup.mjs archive again`);
    return { applies: true, differences };
  }
  const data = state.data;
  const rootId = realId(config?.notion?.parent_page_id);
  const archiveId = realId(data.archive_page);
  if (!archiveId) {
    add('archive page', 'setup/archive.json names no Archive page');
  } else {
    try {
      const parent = parentIdOf((await client.retrievePage(archiveId)).parent);
      if (parent !== rootId) add('archive page', `the Archive page sits under ${parent ?? 'an unknown parent'}, not under the hub page`);
    } catch (e) {
      add('archive page', `the Archive page cannot be read (${short(e?.message ?? e)})`);
    }
    try {
      const first = (await client.retrieveBlockChildren(archiveId))[0];
      if (!linksToPage(first, rootId)) add('archive page', 'the first line of the Archive page does not link back to the hub page');
    } catch (e) {
      add('archive page', `the blocks of the Archive page cannot be read (${short(e?.message ?? e)})`);
    }
    for (const m of data.moved ?? []) {
      const id = realId(m?.id);
      if (!id) continue;
      const what = `the ${m.kind === 'page' ? 'page' : 'table'} "${m.title || m.key}"`;
      try {
        const object = m.kind === 'page' ? await client.retrievePage(id) : await client.retrieveDatabase(id);
        const parent = parentIdOf(object.parent);
        if (parent !== archiveId) add('moved object', `${what} sits under ${parent ?? 'an unknown parent'}, not under the Archive page`);
      } catch (e) {
        add('moved object', `${what} cannot be read (${short(e?.message ?? e)})`);
      }
    }
  }
  const unprotected = [...archivedIds(root)].filter((id) => !isProtected(config, id));
  if (unprotected.length) {
    add('protected', `${unprotected.length} id(s) in setup/archive.json are not on the protected lists of config.json (${unprotected.slice(0, 3).join(', ')}${unprotected.length > 3 ? ', ...' : ''}); setup.mjs archive adds them`);
  }
  return { applies: true, differences };
}

// ---- reading -----------------------------------------------------------------------------------------------------------------------------

const blockText = (b) => {
  if (b?.type === 'child_page') return b.child_page?.title ?? '';
  if (b?.type === 'child_database') return b.child_database?.title ?? '';
  return plain(b?.[b?.type]?.rich_text);
};

/**
 * GET only. The root page (config.notion.parent_page_id), its block children, the current parent of each known object, and the Archive page: the one recorded
 * in setup/archive.json when it is still a page under the root with the exact title, else the one child page of the root that has the exact title. More than one
 * such page is listed in archive.matches and left for planArchive to refuse.
 */
export async function snapshotRoot({ client, config, archivePageId = null } = {}) {
  const rootId = realId(config?.notion?.parent_page_id);
  if (!rootId) throw new ArchiveError('config.json has no notion.parent_page_id, so there is no hub page to archive under');
  const rootPage = await client.retrievePage(rootId);
  const blocks = await client.retrieveBlockChildren(rootId);
  const children = blocks.map((b) => ({ id: normId(b.id), type: b.type ?? 'unknown', text: blockText(b) }));

  const objects = [];
  for (const known of knownObjects(config)) {
    if (!known.id) {
      objects.push({ ...known, state: 'not_set', title: null, parent_id: null });
      continue;
    }
    try {
      if (known.kind === 'page') {
        const page = await client.retrievePage(known.id);
        objects.push({ ...known, state: 'read', title: pageTitle(page), parent_id: parentIdOf(page.parent), parent_type: page.parent?.type ?? null });
      } else {
        const db = await client.retrieveDatabase(known.id);
        objects.push({
          ...known, state: 'read', title: databaseTitle(db), parent_id: parentIdOf(db.parent), parent_type: db.parent?.type ?? null,
          data_source_id: realId(db.data_sources?.[0]?.id) ?? known.data_source_id,
        });
      }
    } catch (e) {
      objects.push({ ...known, state: 'unreadable', title: null, parent_id: null, error: short(e?.message ?? e) });
    }
  }

  const matches = children.filter((c) => c.type === 'child_page' && c.text === ARCHIVE_TITLE).map((c) => c.id);
  let archive = { id: null, via: null, matches };
  const recorded = realId(archivePageId);
  if (recorded) {
    try {
      const page = await client.retrievePage(recorded);
      if (parentIdOf(page.parent) === rootId && pageTitle(page) === ARCHIVE_TITLE) archive = { id: recorded, via: 'recorded', matches };
    } catch {
      // the recorded page cannot be read: fall back to the title
    }
  }
  if (!archive.id && matches.length === 1) archive = { id: matches[0], via: 'title', matches };

  return {
    root: { id: rootId, title: pageTitle(rootPage), url: typeof rootPage.url === 'string' && rootPage.url !== '' ? rootPage.url : `https://www.notion.so/${rootId}`, parent: rootPage.parent ?? null },
    children,
    objects,
    archive,
  };
}

/** The root's child blocks that are neither one of the known objects nor the Archive page: for a person to look at, never moved or changed. */
export function leftoversOf(children, { knownIds, archiveId }) {
  return children
    .map((b) => ({ id: normId(b.id), type: b.type ?? 'unknown', text: b.text ?? blockText(b) }))
    .filter((b) => b.id !== archiveId && !knownIds.has(b.id));
}

// ---- planning ----------------------------------------------------------------------------------------------------------------------------

/** The plan from a snapshot: rename the root (unless it is called that already), make the Archive page (unless one exists), move each old object that is not under it. */
export function planArchive({ config, snapshot, runId = null, now = () => new Date() } = {}) {
  const rootId = snapshot.root.id;
  const archiveId = snapshot.archive.id;
  if (!archiveId && snapshot.archive.matches.length > 1) {
    throw new ArchiveError(
      `${snapshot.archive.matches.length} pages under the hub are titled "${ARCHIVE_TITLE}" (${snapshot.archive.matches.join(', ')}); the setup cannot tell which is the Archive page. `
      + 'Rename or remove all but one by hand in Notion, then run setup.mjs archive again',
    );
  }
  if (!snapshot.objects.some((o) => o.state !== 'not_set')) {
    throw new ArchiveError('config.json names no old page or table to archive (every id is a placeholder): there is nothing to move');
  }
  const ops = [];
  if (snapshot.root.title !== HUB_TITLE) ops.push({ op: 'rename_root', page_id: rootId, from: snapshot.root.title, to: HUB_TITLE });
  const holds = snapshot.objects.filter((o) => o.state !== 'not_set').map((o) => o.title || o.key);
  if (!archiveId) ops.push({ op: 'create_archive_page', parent_id: rootId, title: ARCHIVE_TITLE, link_url: snapshot.root.url, holds });
  const satisfied = [];
  for (const o of snapshot.objects) {
    if (o.state === 'not_set') {
      satisfied.push({ key: o.key, id: null, why: 'not set in config.json' });
      continue;
    }
    if (archiveId && o.parent_id === archiveId) {
      satisfied.push({ key: o.key, id: o.id, why: 'already under the Archive page' });
      continue;
    }
    ops.push({
      op: 'move', kind: o.kind, key: o.key, id: o.id, title: o.title, from_parent: o.parent_id, to: 'archive', to_parent: archiveId,
      ...(o.error ? { read_error: o.error } : {}),
    });
  }
  const knownIds = new Set(snapshot.objects.map((o) => o.id).filter(Boolean));
  return {
    version: 1,
    run_id: runId,
    created_at: now().toISOString(),
    root: { id: rootId, title: snapshot.root.title, url: snapshot.root.url },
    hub_title: HUB_TITLE,
    archive_title: ARCHIVE_TITLE,
    archive: { id: archiveId, via: snapshot.archive.via },
    ops,
    satisfied,
    leftovers: leftoversOf(snapshot.children, { knownIds, archiveId }),
  };
}

/** Check a plan before anything is sent: { ok, problems }. See the header of this file for what it refuses. */
export function checkArchivePlan(plan, config) {
  if (!isPlain(plan) || plan.version !== 1 || !Array.isArray(plan.ops) || !isPlain(plan.root)) return { ok: false, problems: ['this is not an archive plan (version 1 with root and ops)'] };
  const problems = [];
  const rootId = realId(config?.notion?.parent_page_id);
  const archiveId = plan.archive?.id ? normId(plan.archive.id) : null;
  const known = new Map(knownObjects(config).filter((k) => k.id).map((k) => [k.id, k]));
  if (!rootId || normId(plan.root.id) !== rootId) problems.push(`the plan's hub page (${plan.root.id}) is not config.json's notion.parent_page_id`);
  if (rootId && isProtected(config, rootId)) problems.push('the hub page is on the protected lists of config.json, so the setup never renames it or builds under it');
  const seen = new Set();
  plan.ops.forEach((op, i) => {
    const at = `op ${i + 1} (${op?.op}${op?.key ? ` ${op.key}` : ''})`;
    switch (op?.op) {
      case 'rename_root':
        if (normId(op.page_id) !== rootId) problems.push(`${at}: it renames ${op.page_id}, which is not the hub page`);
        if (op.to !== HUB_TITLE) problems.push(`${at}: the new title must be "${HUB_TITLE}"`);
        break;
      case 'create_archive_page':
        if (normId(op.parent_id) !== rootId) problems.push(`${at}: the Archive page is made under ${op.parent_id}, not under the hub page`);
        if (op.title !== ARCHIVE_TITLE) problems.push(`${at}: the Archive page must be titled "${ARCHIVE_TITLE}"`);
        if (archiveId) problems.push(`${at}: the plan makes an Archive page although it names one (${archiveId})`);
        break;
      case 'move': {
        const id = normId(op.id);
        if (isProtected(config, id)) problems.push(`${at}: ${id} is on the protected lists of config.json, so it is never moved`);
        if (id === rootId || id === archiveId) problems.push(`${at}: the hub page and the Archive page are never moved`);
        else if (!known.has(id)) problems.push(`${at}: ${id} is not one of the old pages or tables that config.json names, so it is never moved`);
        else if (known.get(id).key !== op.key || known.get(id).kind !== op.kind) problems.push(`${at}: ${id} is the ${known.get(id).kind} "${known.get(id).key}" in config.json, not the ${op.kind} "${op.key}"`);
        if (seen.has(id)) problems.push(`${at}: ${id} is moved twice`);
        seen.add(id);
        if (op.to !== 'archive' || (archiveId ? normId(op.to_parent) !== archiveId : (op.to_parent ?? null) !== null)) {
          problems.push(`${at}: the destination is not the Archive page${op.to_parent ? ` (${op.to_parent})` : ''}`);
        }
        const from = op.from_parent ? normId(op.from_parent) : null;
        if (from === null) problems.push(`${at}: its current parent is unknown${op.read_error ? ` (${op.read_error})` : ''}, so it is not moved`);
        else if (from !== rootId && from !== archiveId) {
          problems.push(`${at}: it sits under ${from}, which is neither the hub page nor the Archive page; the setup moves only what is directly on the hub page`);
        }
        break;
      }
      default:
        problems.push(`${at}: no such operation`);
    }
  });
  if (plan.ops.filter((o) => o?.op === 'move').length > KNOWN.length) problems.push(`the plan has more than ${KNOWN.length} moves`);
  return { ok: problems.length === 0, problems };
}

// ---- applying ----------------------------------------------------------------------------------------------------------------------------

const textPiece = (content, url = null) => ({ type: 'text', text: url ? { content, link: { url } } : { content } });
const paragraph = (rich) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rich } });

// The blocks of the Archive page: the line that links back to the hub, the list of what the page holds, and a line that warns the tables here share names with the live ones (ED-9).
export const ARCHIVE_WARNING = 'The tables here share names with the live ones and do nothing now; use the hub.';
function archiveBlocks({ link_url: linkUrl, holds }) {
  return [
    paragraph([textPiece(`Archived on ${ARCHIVED_ON}. The live tables are on the hub: `), textPiece(HUB_TITLE, linkUrl), textPiece('.')]),
    paragraph([textPiece(`This page holds the first build, moved here from the hub: ${holds.join(', ')}. Nothing in it was removed, and the agent reads and writes none of it any more.`)]),
    paragraph([textPiece(ARCHIVE_WARNING)]),
  ];
}

const noun = (op) => (op.kind === 'page' ? 'page' : 'table'); // the editor's word for a database

/** Is this block the Archive page's first line: "Archived on <date>. ... Claim tagger ..." with the words "Claim tagger" linked to the hub page (matched by the page's id, not by the address as written)? */
export const linksBack = (block, hubId) => block?.type === 'paragraph'
  && (block.paragraph?.rich_text ?? []).some((r) => (r?.plain_text ?? r?.text?.content) === HUB_TITLE && holdsId(hrefOf(r), hubId))
  && plain(block.paragraph?.rich_text).startsWith(`Archived on ${ARCHIVED_ON}.`);

const dragWords = (op) => `drag the ${noun(op)} "${op.title || op.key}" into the page "${ARCHIVE_TITLE}" by hand in Notion (open the hub page, then drag it onto that page or use its Move to menu), then run setup.mjs archive again; the rerun reads where it is and finds it moved`;

/**
 * Send a plan that checkArchivePlan accepts. Resumable by reading: before every move the object's parent is read, and an object under the Archive page already
 * is skipped. Every change is read back (the root title, the Archive page's parent, title and first line, each moved object's parent). The first problem stops
 * it: result.code is 0 (done), 1 (an error: run the same command again) or 2 (Notion refused a move, a read-back differed, or something sits where it should not),
 * and result.stopped says what and what to do next.
 */
export async function applyArchive({ plan, dir, client, config, now = () => new Date(), log = () => {}, onArchivePage = () => {} } = {}) {
  for (const method of ['retrievePage', 'retrieveDatabase', 'retrieveBlockChildren', 'updatePage', 'createPageUnderPage', 'movePage', 'moveDatabase']) {
    if (typeof client?.[method] !== 'function') throw new TypeError(`applyArchive: the Notion client has no ${method}`);
  }
  const checked = checkArchivePlan(plan, config);
  if (!checked.ok) throw new ArchiveError('the archive plan was refused and nothing was sent', { problems: checked.problems });
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(join(dir, 'plan.json'), plan);
  const ledger = join(dir, 'archive-ledger.jsonl');
  const rootId = normId(plan.root.id);
  let archiveId = plan.archive?.id ? normId(plan.archive.id) : null;
  const result = { code: EXIT.OK, renamed: false, created: false, archive_page: archiveId, moves: [], stopped: null, ledger };
  const total = plan.ops.filter((o) => o.op === 'move').length;

  const record = (i, op, fields) => {
    const line = { op_index: i, op: op.op, key: op.key ?? null, id: op.id ?? op.page_id ?? null, status: null, read_back: null, error: null, ...fields, at: now().toISOString() };
    appendJsonl(ledger, line);
    return line;
  };
  const stop = (i, op, reason, code, message, next) => {
    result.code = code;
    result.stopped = { op_index: i, op: op.op, key: op.key ?? null, reason, message, next };
  };

  for (let i = 0; i < plan.ops.length && !result.stopped; i += 1) {
    const op = plan.ops[i];
    try {
      if (op.op === 'rename_root') {
        if (pageTitle(await client.retrievePage(rootId)) === op.to) {
          record(i, op, { status: 'skipped', read_back: 'ok', error: `skipped: the hub page is called "${op.to}" already` });
          continue;
        }
        await client.updatePage(rootId, { properties: { title: { title: [{ type: 'text', text: { content: op.to } }] } } });
        const back = pageTitle(await client.retrievePage(rootId));
        if (back !== op.to) {
          record(i, op, { status: 'done', read_back: 'mismatch', error: `read-back: the title reads "${back}"` });
          stop(i, op, 'mismatch', EXIT.INVALID, `the hub page was renamed, but reads "${back}" instead of "${op.to}"`, 'Look at the hub page in Notion, then run setup.mjs archive again.');
          continue;
        }
        record(i, op, { status: 'done', read_back: 'ok' });
        result.renamed = true;
        log(`renamed the hub page to "${op.to}" (read back)`);
      } else if (op.op === 'create_archive_page') {
        const made = await client.createPageUnderPage({ parentPageId: rootId, title: op.title, children: archiveBlocks(op) });
        archiveId = normId(made.id);
        result.archive_page = archiveId;
        result.created = true;
        onArchivePage(archiveId);
        const back = await client.retrievePage(archiveId);
        const first = (await client.retrieveBlockChildren(archiveId))[0];
        if (parentIdOf(back.parent) !== rootId || pageTitle(back) !== op.title || !linksBack(first, rootId)) {
          record(i, op, { status: 'done', read_back: 'mismatch', id: archiveId, error: 'read-back: the Archive page is not under the hub page, or its title or its first line (the link back to the hub) is not as written' });
          stop(i, op, 'mismatch', EXIT.INVALID, `the Archive page ${archiveId} was made, but reading it back shows a different parent, title or first line`, 'Look at it in Notion and fix it by hand; the next run adopts the page by its title.');
          continue;
        }
        record(i, op, { status: 'done', read_back: 'ok', id: archiveId });
        log(`made the page "${op.title}" (${archiveId}); its first line links back to the hub`);
      } else {
        const read = (id) => (op.kind === 'page' ? client.retrievePage(id) : client.retrieveDatabase(id));
        const before = parentIdOf((await read(op.id)).parent);
        const entry = { key: op.key, kind: op.kind, id: normId(op.id), title: op.title ?? null, from_parent: before, to_parent: archiveId };
        if (before === archiveId) {
          record(i, op, { status: 'skipped', read_back: 'ok', error: 'skipped: it is under the Archive page already' });
          result.moves.push({ ...entry, status: 'already', read_back: 'ok' });
          continue;
        }
        if (before !== rootId) {
          record(i, op, { status: 'failed', error: `it sits under ${before ?? 'an unknown parent'}, not under the hub page` });
          stop(i, op, 'unexpected_parent', EXIT.INVALID, `${noun(op)} "${op.title || op.key}" (${op.id}) sits under ${before ?? 'an unknown parent'}, which is neither the hub page nor the Archive page, so it was not moved`, 'Put it back on the hub page by hand (or into the Archive page, if that is where it belongs), then run setup.mjs archive again.');
          continue;
        }
        if (op.kind === 'page') await client.movePage(op.id, { parentPageId: archiveId });
        else await client.moveDatabase(op.id, { parentPageId: archiveId });
        const after = parentIdOf((await read(op.id)).parent);
        if (after !== archiveId) {
          record(i, op, { status: 'done', read_back: 'mismatch', error: `read-back: it sits under ${after ?? 'an unknown parent'}, not under the Archive page` });
          stop(i, op, 'mismatch', EXIT.INVALID, `${noun(op)} "${op.title || op.key}" was moved, but reading it back shows it under ${after ?? 'an unknown parent'}, not under the Archive page`, `Look at it in Notion; if it is not in the Archive page, ${dragWords(op)}.`);
          continue;
        }
        record(i, op, { status: 'done', read_back: 'ok' });
        result.moves.push({ ...entry, status: 'moved', read_back: 'ok' });
        log(`moved ${result.moves.filter((m) => m.status === 'moved').length + result.moves.filter((m) => m.status === 'already').length} of ${total}: ${noun(op)} "${op.title || op.key}" into the Archive page (parent read back)`);
      }
    } catch (e) {
      const refused = e?.name === 'NotionError' && (e.status === 400 || e.status === 403);
      const what = op.op === 'move' ? `${noun(op)} "${op.title || op.key}" (${op.id})` : op.op === 'rename_root' ? 'the hub page' : 'the Archive page';
      record(i, op, { status: e?.code === 'create_uncertain' ? 'uncertain' : 'failed', error: short(e?.message ?? e, 400) });
      if (e?.code === 'create_uncertain') {
        stop(i, op, 'create_uncertain', EXIT.ERROR, `Notion may have made the Archive page, but the answer was lost: ${short(e.message)}`, `Look under the hub page for "${ARCHIVE_TITLE}"; run the same command again and it is adopted by its title, or made if it is not there.`);
      } else if (refused && op.op === 'move') {
        stop(i, op, 'refused', EXIT.INVALID, `Notion refused to move ${what}: ${short(e.message)}`, `To go on: ${dragWords(op)}.`);
      } else if (refused) {
        stop(i, op, 'refused', EXIT.INVALID, `Notion refused the request for ${what}: ${short(e.message)}`, 'Check that the integration has edit access to the hub page, then run setup.mjs archive again.');
      } else {
        stop(i, op, 'error', EXIT.ERROR, `${what}: ${short(e?.message ?? e)}`, 'Run the same command again: it reads Notion first and does only what is missing.');
      }
    }
  }
  return result;
}

// ---- walking the old tree ----------------------------------------------------------------------------------------------------------------

/**
 * GET only. The child pages of Demos and Demo tests (the practice pages), each practice page's tables with their data source ids, the data source ids of the
 * five old tables (`objects` is the snapshot's list; config.json's ids stand in for a missing one), and the old views of config.notion.views. A read that fails is
 * listed in errors and the walk goes on.
 */
export async function walkArchiveTree({ client, config, objects = null } = {}) {
  const errors = [];
  const note = (what, id, e) => errors.push({ what, id: id ?? null, message: short(e?.message ?? e) });
  const known = knownObjects(config);
  const practicePages = [];
  for (const parent of known.filter((k) => k.key === 'demos' || k.key === 'demo_tests')) {
    if (!parent.id) continue;
    let kids = [];
    try {
      kids = await client.retrieveBlockChildren(parent.id);
    } catch (e) {
      note(`the practice pages under ${parent.key}`, parent.id, e);
      continue;
    }
    for (const kid of kids.filter((b) => b?.type === 'child_page')) {
      const page = { id: normId(kid.id), title: kid.child_page?.title ?? '', under: parent.key, tables: [] };
      try {
        const inner = await client.retrieveBlockChildren(kid.id);
        for (const block of inner.filter((b) => b?.type === 'child_database')) {
          const table = { id: normId(block.id), title: block.child_database?.title ?? '', data_source_id: null };
          try {
            const db = await client.retrieveDatabase(block.id);
            table.id = normId(db.id ?? block.id);
            table.data_source_id = realId(db.data_sources?.[0]?.id);
            if (!table.data_source_id) note(`the data source of the table "${table.title}" on "${page.title}"`, table.id, new Error('Notion lists no data source for it'));
          } catch (e) {
            note(`the table "${table.title}" on the practice page "${page.title}"`, table.id, e);
          }
          if (!page.tables.some((t) => t.id === table.id)) page.tables.push(table);
        }
      } catch (e) {
        note(`the blocks of the practice page "${page.title}"`, page.id, e);
      }
      practicePages.push(page);
    }
  }
  const bySnapshot = new Map((objects ?? []).map((o) => [o.key, o]));
  const tables = known.filter((k) => k.kind === 'database' && k.id).map((k) => ({
    key: k.key, database_id: k.id, data_source_id: bySnapshot.get(k.key)?.data_source_id ?? k.data_source_id,
  }));
  const views = Object.entries(config?.notion?.views ?? {}).map(([key, v]) => ({ key, id: realId(v?.id) ?? null, url: v?.url ?? null }));
  return { practice_pages: practicePages, tables, views, errors };
}

// ---- the config after the archive --------------------------------------------------------------------------------------------------------

const addIds = (list, ids) => {
  const seen = new Set((list ?? []).map((p) => normId(p)));
  const out = [...(list ?? [])];
  for (const raw of ids) {
    const id = realId(raw);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
};

/**
 * A new config for after the archive; `config` is not changed. The old pages and tables are out of it and their ids are protected:
 *   notion.pages       { onboarding: '<setup>', archive: <the Archive page> }, with proposal, demos and demo_tests kept as the placeholder '<archived>' because
 *                      validateConfig asks for every key of notion.pages to be an id or a placeholder
 *   the five tables    database_id and data_source_id set to '<setup>' (the form of tests/mvp/fixtures/config.placeholder.json)
 *   notion.views       {}
 *   protected_page_ids gains the Archive page, the three old sub-pages and every practice page
 *   protected_database_ids gains the five old tables (database and data source ids) and every practice page's tables
 * Nothing else changes, nothing is added twice, and the result must pass validateConfig (an ArchiveError otherwise).
 */
export function archiveConfigChange(config, archive) {
  const archivePage = realId(archive?.archive_page);
  if (!archivePage) throw new ArchiveError('archiveConfigChange: the archive record names no Archive page');
  const next = structuredClone(config);
  const n = next.notion;
  n.pages = { onboarding: PLACEHOLDER, archive: archivePage, proposal: RETIRED, demos: RETIRED, demo_tests: RETIRED };
  for (const entry of [n.rulebook, n.claims, n.databases?.tag_decisions, n.databases?.rule_changes, n.databases?.agent_settings]) {
    if (isPlain(entry)) {
      entry.database_id = PLACEHOLDER;
      entry.data_source_id = PLACEHOLDER;
    }
  }
  n.views = {};
  const moved = archive.moved ?? [];
  const practice = archive.practice_pages ?? [];
  n.protected_page_ids = addIds(n.protected_page_ids, [
    archivePage, ...moved.filter((m) => m.kind === 'page').map((m) => m.id), ...practice.map((p) => p.id),
  ]);
  n.protected_database_ids = addIds(n.protected_database_ids, [
    ...(archive.tables ?? []).flatMap((t) => [t.database_id, t.data_source_id]),
    ...moved.filter((m) => m.kind === 'database').flatMap((m) => [m.id, m.data_source_id]),
    ...practice.flatMap((p) => (p.tables ?? []).flatMap((t) => [t.id, t.data_source_id])),
  ]);
  const { ok, errors } = validateConfig(next);
  if (!ok) throw new ArchiveError(`the config after the archive would not be valid:\n- ${errors.join('\n- ')}`);
  return next;
}

// ---- the builder registry ----------------------------------------------------------------------------------------------------------------

/** Move runs/builder/{pages,databases,state,verify}.json (those that exist) to runs/builder/before-archive/: they register the old tables. Returns the file names moved. */
export function setAsideBuilder(root) {
  const paths = builderPaths(root);
  const target = join(paths.dir, 'before-archive');
  const moved = [];
  for (const name of BUILDER_FILES) {
    const from = join(paths.dir, `${name}.json`);
    if (!existsSync(from)) continue;
    mkdirSync(target, { recursive: true });
    renameWithRetry(from, join(target, `${name}.json`));
    moved.push(`${name}.json`);
  }
  return moved;
}

// ---- the step ----------------------------------------------------------------------------------------------------------------------------

const describeOp = (op) => {
  if (op.op === 'rename_root') return `rename the hub page "${op.from}" to "${op.to}"`;
  if (op.op === 'create_archive_page') return `make the page "${op.title}" under the hub page (its first line links back to the hub)`;
  return `move the ${noun(op)} "${op.title || op.key}" (${op.key}, ${op.id}) into the Archive page`;
};
const describeLeftover = (b) => `${b.type}${b.text ? ` "${short(b.text, 60)}"` : ''} (${b.id})`;

// the config rewrite and the registry set-aside: local files only, safe to do again
function finishLocally(ctx, archive) {
  const { root, config } = ctx;
  const next = archiveConfigChange(config, archive);
  writeJsonAtomic(builderPaths(root).config, next);
  const aside = setAsideBuilder(root);
  logLine(builderPaths(root), { event: 'archive', archive_page: archive.archive_page, moved: (archive.moved ?? []).length });
  return { next, aside };
}

function localLines({ next, aside }) {
  return [
    `archive: config.json rewritten: pages onboarding and archive, the five table ids set to <setup>, the old views cleared, ${next.notion.protected_page_ids.length} page ids and ${next.notion.protected_database_ids.length} database ids protected`,
    `archive: ${aside.length ? `${aside.join(', ')} moved to runs/builder/before-archive/` : 'no builder registry file to set aside'}`,
  ];
}

/**
 * The whole step, behind a builder session. planOnly: GETs only, plan.json and snapshot.json in the run folder, nothing else written. A real run: apply, walk the
 * old tree, write setup/archive.json (state "done"), save the rewritten config.json, set the builder registry aside. A run after state "done" says so and sends nothing.
 */
export async function stepArchive(ctx, { planOnly = false } = {}) {
  const { root, config } = ctx;
  const resume = ctx.run?.record?.resume ?? 'node agents/claim-tagger-mvp/scripts/setup.mjs archive';
  const file = archivePath(root);
  const existing = readArchiveState(root);
  if (existing.error) return { code: EXIT.INVALID, lines: [], errors: [`archive: ${existing.error}`] };

  if (existing.state === 'done') {
    const archive = existing.data;
    if (archiveRewritten(config, archive)) return { code: EXIT.OK, lines: [`archive: done already (${archive.archived_at}); the Archive page is ${archive.archive_page}; nothing was sent`] };
    if (planOnly) return { code: EXIT.OK, lines: ['archive: the pages and tables are moved already, but config.json still has the old ids; run it without --plan-only to finish that (it sends nothing to Notion)'] };
    try {
      const local = finishLocally(ctx, archive);
      return { code: EXIT.OK, lines: ['archive: the pages and tables were moved by an earlier run; the rest is finished now (nothing was sent to Notion)', ...localLines(local), 'Next: node agents/claim-tagger-mvp/scripts/setup.mjs build'] };
    } catch (e) {
      if (e instanceof ArchiveError) return { code: e.code, lines: [], errors: [`archive: ${e.message}`] };
      throw e;
    }
  }

  const client = ctx.builderClient();
  let snapshot;
  let plan;
  try {
    snapshot = await snapshotRoot({ client, config, archivePageId: existing.data?.archive_page ?? null });
    plan = planArchive({ config, snapshot, runId: ctx.run.id, now: ctx.now });
  } catch (e) {
    if (e instanceof ArchiveError) return { code: e.code, lines: [], errors: [`archive: ${e.message}`] };
    throw e;
  }
  writeJsonAtomic(join(ctx.run.dir, 'snapshot.json'), snapshot);
  writeJsonAtomic(join(ctx.run.dir, 'plan.json'), plan);
  const checked = checkArchivePlan(plan, config);
  if (!checked.ok) {
    return { code: EXIT.INVALID, lines: [], errors: ['archive: the plan was refused and nothing was sent:', ...checked.problems.map((p) => `  ${p}`)] };
  }

  if (planOnly) {
    let requests = '';
    try {
      const c = countRequests(join(ctx.run.dir, 'requests.jsonl'));
      requests = `${c.byMethod.GET} GET requests, ${c.writes} writes`;
    } catch {
      requests = 'the request log could not be read';
    }
    return {
      code: EXIT.OK,
      lines: [
        'archive (plan only): nothing was sent except reads. The plan:',
        ...plan.ops.map((op, i) => `  ${i + 1}. ${describeOp(op)}`),
        ...plan.satisfied.map((s) => `  already done: ${s.key} (${s.why})`),
        ...(plan.archive.id ? [`  the Archive page exists already (${plan.archive.id}, found by ${plan.archive.via === 'recorded' ? 'archive.json' : 'its title'}) and is used as it is`] : []),
        plan.leftovers.length ? `  left alone on the hub page, for a person to remove by hand: ${plan.leftovers.map(describeLeftover).join('; ')}` : '  nothing else is on the hub page',
        `archive: ${requests}; the plan and the snapshot are in ${ctx.run.dir}`,
      ],
    };
  }

  const startedAt = existing.data?.started_at ?? ctx.now().toISOString();
  const progress = {
    state: 'moving',
    started_at: startedAt,
    run_id: ctx.run.id,
    root: plan.root.id,
    archive_page: plan.archive.id ?? null,
    known: snapshot.objects.filter((o) => o.id).map((o) => ({ key: o.key, kind: o.kind, id: o.id, data_source_id: o.data_source_id ?? null })),
    stopped: null,
  };
  const save = (extra = {}) => writeJsonAtomic(file, { ...progress, ...extra, updated_at: ctx.now().toISOString() });
  save();
  const applied = await applyArchive({
    plan, dir: ctx.run.dir, client, config, now: ctx.now, log: (line) => ctx.log(`archive: ${line}`),
    onArchivePage: (id) => {
      progress.archive_page = id;
      save();
    },
  });
  if (applied.code !== EXIT.OK) {
    save({ stopped: applied.stopped });
    const s = applied.stopped;
    return {
      code: applied.code,
      lines: [],
      errors: [
        `archive: stopped at ${s.op === 'move' ? `the move of "${s.key}"` : s.op}: ${s.message}`,
        `archive: ${s.next}`,
        ...(applied.code === EXIT.ERROR ? [`archive: run the same command again: ${resume}`] : [`archive: then run: ${resume}`]),
        'archive: setup/archive.json says "moving", so build refuses to run until this step is done',
      ],
    };
  }

  const archiveId = applied.archive_page;
  const knownIds = new Set(snapshot.objects.map((o) => o.id).filter(Boolean));
  const children = await client.retrieveBlockChildren(plan.root.id);
  const leftovers = leftoversOf(children.map((b) => ({ id: b.id, type: b.type, text: blockText(b) })), { knownIds, archiveId });
  const walk = await walkArchiveTree({ client, config, objects: snapshot.objects });
  const moves = new Map(applied.moves.map((m) => [m.key, m]));
  const moved = snapshot.objects.filter((o) => o.state !== 'not_set').map((o) => ({
    key: o.key, kind: o.kind, id: o.id, title: o.title, ...(o.kind === 'database' ? { data_source_id: o.data_source_id } : {}),
    from_parent: moves.get(o.key)?.from_parent ?? o.parent_id, to_parent: archiveId, status: moves.get(o.key)?.status ?? 'already', read_back: 'ok',
  }));
  const archive = {
    state: 'done',
    archived_at: ctx.now().toISOString(),
    run_id: ctx.run.id,
    root: plan.root.id,
    root_title: HUB_TITLE,
    archive_page: archiveId,
    archive_title: ARCHIVE_TITLE,
    moved,
    practice_pages: walk.practice_pages,
    tables: walk.tables,
    views: walk.views,
    leftovers,
    walk_errors: walk.errors,
  };
  writeJsonAtomic(file, archive);
  const local = finishLocally(ctx, archive);

  const made = moved.filter((m) => m.status === 'moved').length;
  const practiceTables = walk.practice_pages.reduce((n, p) => n + p.tables.length, 0);
  return {
    code: EXIT.OK,
    lines: [
      applied.renamed ? `archive: the hub page is renamed "${HUB_TITLE}" (read back)` : `archive: the hub page is called "${HUB_TITLE}" already`,
      applied.created ? `archive: made the page "${ARCHIVE_TITLE}" (${archiveId}); its first line links back to the hub` : `archive: the Archive page was there already (${archiveId})`,
      `archive: ${made} of ${moved.length} moved into it${made < moved.length ? `, ${moved.length - made} were there already` : ''}; the new parent of every one was read back`,
      `archive: walked the old tree: ${walk.practice_pages.length} practice pages with ${practiceTables} tables, ${walk.tables.length} old tables, ${walk.views.length} old views${walk.errors.length ? `; ${walk.errors.length} read(s) failed and are listed in setup/archive.json` : ''}`,
      leftovers.length
        ? `archive: ${leftovers.length} other block(s) are on the hub page. They were not touched; remove these by hand from the hub page: ${leftovers.map(describeLeftover).join('; ')}`
        : 'archive: nothing else is on the hub page',
      ...localLines(local),
      'Next: node agents/claim-tagger-mvp/scripts/setup.mjs build',
    ],
    archive,
  };
}
