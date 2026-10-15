// The shared in-memory Notion (fake-notion.mjs) with the three things the practice-page builder needs and the shared fake does not model:
//
//   1. Child pages and child databases are blocks of their page. A page that was made under another page, and a database made under a page, show
//      up in GET /blocks/{page}/children as child_page and child_database blocks, in the order they were made among the page's other blocks (the
//      real API lists them that way; the builder adopts a page or table by its title from that list).
//   2. POST /views with create_database: { parent: { type: 'page_id', page_id }, position: { type: 'after_block', block_id } } makes a linked view
//      block on the page, right after that block (or at the start or end). It is listed among the page's blocks as a child_database block that
//      has its own id; GET /views/{id} answers for it with that id as its parent; it is not one of the views (tabs) of the table it shows.
//   3. Nothing else changes. Every request goes through the shared fake first (token, version, validation, failNext, the request log), so the
//      linked view's filter, sorts and columns are checked by it like any view's: the request is passed on as a view of the table, and only the
//      bookkeeping of where it lives is this file's.
//
//   const pf = createPagesFake({ protected: [ids] })        everything createFakeNotion gives, plus:
//   pf.linked()                                             the linked views made so far: { view_id, linked_database_id, name, page_id, after_block, source_database_id, data_source_id, body }
//   pf.outline(pageId)                                      the page's blocks in order as short strings: "heading_2|Step 1 · Meet the demo", "database|Rulebook", "linked|Your queue", "child_page|..."
//   pf.entries(pageId)                                      the same as objects { kind, id, type, text }
//   pf.tabViews(databaseId)                                 the views of a table without the linked views made from it
//
// Not simulated: linked views are not removed or edited, a linked view's own tabs are not listable beyond the one view.

import { createFakeNotion } from './fake-notion.mjs';

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

export function createPagesFake(options = {}) {
  const stock = createFakeNotion(options);
  const lists = new Map(); // normalised page id -> [{ kind: 'block' | 'child_page' | 'child_database' | 'linked', id, title?, view_id? }]
  const linked = new Map(); // normalised view id -> record
  const linkedDatabases = new Map(); // normalised linked database id -> record
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

    const res = await stock.fetchImpl(url, init);
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
      list.splice(at, 0, ...made.results.map((b) => ({ kind: 'block', id: b.id })));
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
  };
}
