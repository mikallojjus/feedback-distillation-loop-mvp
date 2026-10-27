// The shared in-memory Notion (fake-notion.mjs) with the things the practice-page builder and the archive step need and the shared fake does not model:
//
//   1. Child pages and child databases are blocks of their page. A page that was made under another page, and a database made under a page, show
//      up in GET /blocks/{page}/children as child_page and child_database blocks, in the order they were made among the page's other blocks (the
//      real API lists them that way; the builder adopts a page or table by its title from that list).
//   2. POST /views with create_database: { parent: { type: 'page_id', page_id }, position: { type: 'after_block', block_id } } makes a linked view
//      block on the page, right after that block (or at the start or end). It is listed among the page's blocks as a child_database block that
//      has its own id; GET /views/{id} answers for it with that id as its parent; it is not one of the views (tabs) of the table it shows.
//   3. Moves (the archive step, decision P9). POST /pages/{id}/move and PATCH /databases/{id} with a parent: the child block leaves the old parent's
//      children and is appended to the new parent's, and the page's or table's `parent` reads back as the new page (GET /pages/{id}, GET /databases/{id}).
//      Needs Notion-Version 2026-03-11 (400 otherwise). A move takes a parent { type: 'page_id', page_id } and nothing else (400 for any other key, in_trash and
//      is_inline included); an unknown new parent is 404 object_not_found, so is an unknown page or table; a page cannot go under itself or under one of its
//      own sub-pages (400); a row of a table cannot be moved (400). A move to the page it is already under changes nothing (200). Sub-pages and tables of a
//      moved page go with it. Token, version, failNext and the request log work as for every route (the shared fake checks them first); a failNext with
//      `applied: true` does not apply a move (the shared fake has no such route), the answer is lost and nothing moved.
//   4. A page's title can be changed (PATCH /pages/{id} with the title property, which the shared fake does): the title that the parent lists for the child
//      page changes with it.
//   5. Append with a position (PATCH /blocks/{id}/children): from 2026-03-11 `position` is { type: 'start' | 'end' | 'after_block', after_block: { id } } and the flat
//      `after` is refused (400); before it `after` works and `position` is refused (400); both together are refused. The blocks land in the page's list at the place
//      asked for.
//   6. Everything else is as it was. Every request goes through the shared fake first (token, version, validation, failNext, the request log), so the
//      linked view's filter, sorts and columns are checked by it like any view's: the request is passed on as a view of the table, and only the
//      bookkeeping of where it lives is this file's.
//
//   const pf = createPagesFake({ protected: [ids] })        everything createFakeNotion gives, plus:
//   pf.linked()                                             the linked views made so far: { view_id, linked_database_id, name, page_id, after_block, source_database_id, data_source_id, body }
//   pf.outline(pageId)                                      the page's blocks in order as short strings: "heading_2|Step 1 · Meet the demo", "database|Rulebook", "linked|Your queue", "child_page|..."
//   pf.entries(pageId)                                      the same as objects { kind, id, type, text }
//   pf.tabViews(databaseId)                                 the views of a table without the linked views made from it
//   pf.parentOf(id)                                         the parent object a page or table has now (after any move)
//   pf.moves()                                              the moves made so far: [{ kind: 'page' | 'database', id, from, to }] (ids as the fake holds them)
//
// Not simulated: linked views are not removed or edited, a linked view's own tabs are not listable beyond the one view, nothing is ever trashed or removed.

import { createFakeNotion } from './fake-notion.mjs';

const MOVE_VERSION = '2026-03-11';

const norm = (id) => String(id ?? '').replace(/-/g, '').toLowerCase();
const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failure = (status, code, message) => json(status, { object: 'error', status, code, message });
const plainOf = (items) => (Array.isArray(items) ? items.map((x) => x?.plain_text ?? x?.text?.content ?? '').join('') : '');
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const versionOf = (init) => {
  const h = init?.headers;
  if (!h) return undefined;
  if (typeof h.get === 'function') return h.get('Notion-Version') ?? undefined;
  return Object.entries(h).find(([k]) => String(k).toLowerCase() === 'notion-version')?.[1];
};

export function createPagesFake(options = {}) {
  const stock = createFakeNotion(options);
  const lists = new Map(); // normalised page id -> [{ kind: 'block' | 'child_page' | 'child_database' | 'linked', id, title?, view_id? }]
  const linked = new Map(); // normalised view id -> record
  const linkedDatabases = new Map(); // normalised linked database id -> record
  const parents = new Map(); // normalised id of a page or table that was moved -> its parent now
  const movesMade = [];
  let counter = 0;

  const isPage = (id) => {
    try {
      stock.page(id);
      return true;
    } catch {
      return false;
    }
  };
  const listOf = (pageId) => {
    const key = norm(pageId);
    if (!lists.has(key)) lists.set(key, stock.children(pageId).map((b) => ({ kind: 'block', id: b.id })));
    return lists.get(key);
  };
  const titleOfProperty = (p) => plainOf(p?.title);
  const titleOfDatabase = (title) => (Array.isArray(title) ? title.map((x) => x?.text?.content ?? '').join('') : '');

  function block(entry, real) {
    if (entry.kind === 'block') return real.get(norm(entry.id));
    const at = '2026-10-15T09:00:00.000Z';
    const base = { object: 'block', id: entry.id, parent: { type: 'page_id' }, created_time: at, last_edited_time: at, has_children: false, archived: false, in_trash: false };
    if (entry.kind === 'child_page') return { ...base, type: 'child_page', child_page: { title: entry.title } };
    return { ...base, type: 'child_database', child_database: { title: entry.title } };
  }

  function entriesOf(pageId) {
    const real = new Map(stock.children(pageId).map((b) => [norm(b.id), b]));
    return listOf(pageId).map((e) => {
      const b = block(e, real);
      const type = b?.type ?? 'missing';
      const text = e.kind === 'block' ? plainOf(b?.[type]?.rich_text) || (type === 'table' ? `width ${b.table?.table_width}` : '') : e.title;
      return { kind: e.kind, id: e.id, type, text, view_id: e.view_id };
    });
  }

  async function createLinked(url, init, body) {
    const { create_database: cd, data_source_id: dataSourceId, ...rest } = body;
    const pageId = cd?.parent?.page_id;
    if (typeof pageId !== 'string' || !isPage(pageId)) return failure(404, 'object_not_found', `Could not find page with ID: ${pageId}.`);
    let ds;
    try {
      ds = stock.dataSource(dataSourceId);
    } catch {
      return failure(404, 'object_not_found', `Could not find data source with ID: ${dataSourceId}.`);
    }
    const list = listOf(pageId);
    const position = cd.position ?? { type: 'end' };
    let at = list.length;
    if (position.type === 'after_block') {
      const i = list.findIndex((e) => norm(e.id) === norm(position.block_id));
      if (i < 0) return failure(400, 'validation_error', `create_database.position.block_id ${position.block_id} is not a block of this page.`);
      at = i + 1;
    } else if (position.type === 'start') at = 0;
    else if (position.type !== 'end') return failure(400, 'validation_error', 'create_database.position.type should be start, end or after_block.');
    const sourceDatabase = ds.parent.database_id;
    const passed = await stock.fetchImpl(url, { ...init, body: JSON.stringify({ ...rest, database_id: sourceDatabase, data_source_id: dataSourceId }) });
    if (!passed.ok) return passed;
    const view = await passed.json();
    counter += 1;
    const linkedId = `0ad00000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
    const record = {
      view_id: view.id, linked_database_id: linkedId, name: rest.name, page_id: pageId, after_block: position.block_id ?? null, source_database_id: sourceDatabase,
      data_source_id: dataSourceId, body, position,
    };
    linked.set(norm(view.id), record);
    linkedDatabases.set(norm(linkedId), record);
    list.splice(at, 0, { kind: 'linked', id: linkedId, title: ds.name, view_id: view.id });
    return json(200, { ...view, parent: { type: 'database_id', database_id: linkedId } });
  }

  // ---- moves -------------------------------------------------------------------------------------------------------------------------

  const existingPage = (id) => {
    try {
      return stock.page(id);
    } catch {
      return null;
    }
  };
  const existingDatabase = (id) => {
    try {
      return stock.database(id);
    } catch {
      return null;
    }
  };
  const parentNow = (id) => {
    if (parents.has(norm(id))) return structuredClone(parents.get(norm(id)));
    return (existingPage(id) ?? existingDatabase(id))?.parent ?? null;
  };

  // The shared fake has no move route, so the request is passed to it first (token, version, failNext and the request log work as for every route) and
  // answers 404 invalid_request_url when nothing stopped it; that answer is the cue to do the move here and to correct the status in the log.
  async function moveRoute(kind, id, url, init, body) {
    const at = stock.requests.length;
    const res = await stock.fetchImpl(url, init);
    if (res.status !== 404) return res;
    const probe = await res.clone().json().catch(() => null);
    if (probe?.code !== 'invalid_request_url') return res;
    const entry = stock.requests[at];
    const answer = (status, code, message) => {
      entry.status = status;
      return failure(status, code, message);
    };
    const version = entry.version ?? '';
    if (version < MOVE_VERSION) return answer(400, 'validation_error', `Moving a ${kind} needs Notion-Version ${MOVE_VERSION}, this request used ${version || 'none'}.`);
    const extra = Object.keys(body ?? {}).filter((k) => k !== 'parent');
    if (extra.length) return answer(400, 'validation_error', `body.${extra[0]} should not be present; this fake moves with a parent and nothing else.`);
    const parent = body?.parent;
    if (!isPlain(parent) || parent.type !== 'page_id' || typeof parent.page_id !== 'string' || Object.keys(parent).some((k) => k !== 'type' && k !== 'page_id')) {
      return answer(400, 'validation_error', 'body.parent should be { type: "page_id", page_id }.');
    }
    const current = kind === 'page' ? existingPage(id) : existingDatabase(id);
    if (!current) return answer(404, 'object_not_found', `Could not find ${kind} with ID: ${id}. Make sure the relevant pages and databases are shared with your integration.`);
    if (kind === 'page' && ['data_source_id', 'database_id'].includes(current.parent?.type)) return answer(400, 'validation_error', 'A row of a table cannot be moved to another page.');
    const target = existingPage(parent.page_id);
    if (!target || ['data_source_id', 'database_id'].includes(target.parent?.type)) {
      return answer(404, 'object_not_found', `Could not find page with ID: ${parent.page_id}. Make sure the relevant pages and databases are shared with your integration.`);
    }
    // a page cannot go under itself or under one of its own sub-pages
    if (kind === 'page') {
      let up = norm(target.id);
      for (let depth = 0; up && depth < 100; depth += 1) {
        if (up === norm(id)) return answer(400, 'validation_error', 'A page cannot be moved into itself or into one of its own sub-pages.');
        const above = parentNow(up)?.page_id;
        up = above ? norm(above) : null;
      }
    }
    const from = parentNow(id)?.page_id ?? null;
    if (from === null || norm(from) !== norm(target.id)) {
      if (from !== null && existingPage(from)) {
        const old = listOf(from);
        for (let i = old.length - 1; i >= 0; i -= 1) if (norm(old[i].id) === norm(id)) old.splice(i, 1);
      }
      const title = kind === 'page' ? plainOf(current.properties?.title?.title) : titleOfDatabase(current.title);
      const next = listOf(target.id);
      if (!next.some((e) => norm(e.id) === norm(id))) next.push({ kind: kind === 'page' ? 'child_page' : 'child_database', id: current.id, title });
      parents.set(norm(id), { type: 'page_id', page_id: target.id });
      movesMade.push({ kind, id: current.id, from, to: target.id });
    }
    entry.status = 200;
    const { properties, ...rest } = current;
    return json(200, { ...(kind === 'page' ? { ...rest, properties } : rest), parent: parentNow(id) });
  }

  // What is wrong with the placement of an append, or null: `position` from 2026-03-11, the flat `after` before it, never both.
  function appendProblem(init, body, parentId) {
    const version = versionOf(init) ?? '';
    if (body.after !== undefined && body.position !== undefined) return 'after and position cannot both be sent.';
    if (body.after !== undefined && version >= MOVE_VERSION) return 'body.after is no longer accepted from Notion-Version 2026-03-11; use position.';
    if (body.position === undefined) return null;
    if (version < MOVE_VERSION) return `body.position should not be present before Notion-Version ${MOVE_VERSION}; use after.`;
    const p = body.position;
    if (!isPlain(p) || !['start', 'end', 'after_block'].includes(p.type)) return 'body.position.type should be start, end or after_block.';
    if (p.type === 'after_block') {
      const wanted = p.after_block?.id;
      if (typeof wanted !== 'string') return 'body.position.after_block.id should be a block id.';
      if (isPage(parentId) && !listOf(parentId).some((e) => norm(e.id) === norm(wanted))) return `body.position.after_block.id ${wanted} is not a child of this block.`;
    }
    if (p.type === 'start' && !isPage(parentId)) return 'this fake supports a start position on pages only.';
    return null;
  }

  // a child page was renamed: the parent lists it under the new title
  function retitle(id, title) {
    for (const list of lists.values()) for (const e of list) if (e.kind === 'child_page' && norm(e.id) === norm(id)) e.title = title;
  }

  async function fetchImpl(url, init = {}) {
    const u = new URL(String(url));
    const method = String(init.method ?? 'GET').toUpperCase();
    const path = u.pathname.replace(/^\/v1/, '');
    const segments = path.split('/').filter(Boolean).map(decode);
    let body = null;
    if (typeof init.body === 'string' && init.body !== '') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = null;
      }
    }

    if (method === 'POST' && segments[0] === 'pages' && segments[2] === 'move' && segments.length === 3) return moveRoute('page', segments[1], url, init, body);
    if (method === 'PATCH' && segments[0] === 'databases' && segments.length === 2) return moveRoute('database', segments[1], url, init, body);

    const appends = method === 'PATCH' && segments[0] === 'blocks' && segments[2] === 'children' && segments.length === 3;
    if (appends && isPlain(body) && (body.position !== undefined || body.after !== undefined)) {
      const problem = appendProblem(init, body, segments[1]);
      if (problem) {
        stock.requests.push({ method, path: path + u.search, status: 400, body, version: versionOf(init) ?? null });
        return failure(400, 'validation_error', problem);
      }
      // under a block that is not a page the shared fake knows the flat `after` only
      if (body.position?.type === 'after_block' && !isPage(segments[1])) init = { ...init, body: JSON.stringify({ children: body.children, after: body.position.after_block.id }) };
    }

    if (method === 'POST' && segments[0] === 'views' && segments.length === 1 && body?.create_database) return createLinked(url, init, body);
    if (method === 'GET' && segments[0] === 'views' && segments.length === 1 && linkedDatabases.has(norm(u.searchParams.get('database_id')))) {
      const record = linkedDatabases.get(norm(u.searchParams.get('database_id')));
      stock.requests.push({ method, path: path + u.search, status: 200, body: null, version: null }); // answered here, but a request all the same
      return json(200, { object: 'list', results: [{ object: 'view', id: record.view_id }], next_cursor: null, has_more: false, type: 'view', view: {} });
    }

    // a page that is about to get a child: its list of blocks is taken before the shared fake changes anything
    if (method === 'PATCH' && segments[0] === 'blocks' && segments[2] === 'children' && isPage(segments[1])) listOf(segments[1]);
    const parentPage = body?.parent?.page_id;
    if (method === 'POST' && (segments[0] === 'pages' || segments[0] === 'databases') && segments.length === 1 && typeof parentPage === 'string' && isPage(parentPage)) listOf(parentPage);

    // The list of a page that this fake keeps holds tables and linked views among the blocks, so a page can have more entries than the shared fake has blocks, and the shared
    // fake would refuse the cursor of the second page; this fake reads the cursor itself (below), so the shared one is asked without it.
    let sent = url;
    if (method === 'GET' && segments[0] === 'blocks' && segments[2] === 'children' && segments.length === 3 && lists.has(norm(segments[1])) && u.searchParams.has('start_cursor')) {
      const bare = new URL(String(url));
      bare.searchParams.delete('start_cursor');
      sent = bare.toString();
    }
    const res = await stock.fetchImpl(sent, init);
    if (!res.ok) return res;

    if (method === 'POST' && segments.length === 1 && typeof parentPage === 'string' && lists.has(norm(parentPage))) {
      const made = await res.clone().json();
      if (segments[0] === 'pages') lists.get(norm(parentPage)).push({ kind: 'child_page', id: made.id, title: titleOfProperty(body.properties?.title) });
      else if (segments[0] === 'databases') lists.get(norm(parentPage)).push({ kind: 'child_database', id: made.id, title: titleOfDatabase(body.title) });
    }
    if (method === 'PATCH' && segments[0] === 'blocks' && segments[2] === 'children' && lists.has(norm(segments[1]))) {
      const made = await res.clone().json();
      const list = lists.get(norm(segments[1]));
      let at = list.length;
      if (body?.after !== undefined) at = list.findIndex((e) => norm(e.id) === norm(body.after)) + 1;
      else if (body?.position?.type === 'start') at = 0;
      else if (body?.position?.type === 'after_block') at = list.findIndex((e) => norm(e.id) === norm(body.position.after_block.id)) + 1;
      list.splice(at, 0, ...made.results.map((b) => ({ kind: 'block', id: b.id })));
    }
    if (segments[0] === 'pages' && segments.length === 2 && (method === 'GET' || method === 'PATCH')) {
      const page = await res.clone().json();
      if (method === 'PATCH' && page?.properties?.title) retitle(page.id, plainOf(page.properties.title.title));
      if (parents.has(norm(segments[1]))) return json(200, { ...page, parent: parentNow(segments[1]) });
    }
    if (method === 'GET' && segments[0] === 'databases' && segments.length === 2 && parents.has(norm(segments[1]))) {
      return json(200, { ...(await res.json()), parent: parentNow(segments[1]) });
    }
    if (method === 'GET' && segments[0] === 'blocks' && segments[2] === 'children' && segments.length === 3 && lists.has(norm(segments[1]))) {
      const real = new Map(stock.children(segments[1]).map((b) => [norm(b.id), b]));
      const all = lists.get(norm(segments[1])).map((e) => block(e, real));
      const size = Number(u.searchParams.get('page_size') ?? 100);
      const start = Number(u.searchParams.get('start_cursor') ?? 0);
      const end = Math.min(all.length, start + size);
      return json(200, { object: 'list', results: all.slice(start, end), next_cursor: end < all.length ? String(end) : null, has_more: end < all.length, type: 'block', block: {} });
    }
    if (method === 'GET' && segments[0] === 'views' && segments.length === 2 && linked.has(norm(segments[1]))) {
      const view = await res.json();
      return json(200, { ...view, parent: { type: 'database_id', database_id: linked.get(norm(segments[1])).linked_database_id } });
    }
    if (method === 'GET' && segments[0] === 'views' && segments.length === 1 && u.searchParams.get('database_id')) {
      const list = await res.json();
      return json(200, { ...list, results: list.results.filter((v) => !linked.has(norm(v.id))) });
    }
    return res;
  }

  return {
    ...stock,
    fetchImpl,
    linked: () => [...linked.values()],
    entries: entriesOf,
    outline: (pageId) => entriesOf(pageId).map((e) => (e.kind === 'block' ? `${e.type}|${e.text}` : e.kind === 'child_database' ? `database|${e.text}` : e.kind === 'linked' ? `linked|${linked.get(norm(e.view_id ?? ''))?.name ?? e.text}` : `${e.kind}|${e.text}`)),
    tabViews: (databaseId) => stock.views(databaseId).filter((v) => !linked.has(norm(v.id))),
    parentOf: parentNow,
    moves: () => movesMade.map((m) => ({ ...m })),
  };
}
