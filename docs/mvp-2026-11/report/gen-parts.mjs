#!/usr/bin/env node
/**
 * Write parts/04-structure.html and parts/05-backlog.html from the Markdown notes in the folder above this one.
 *
 *   node gen-parts.mjs [--notes <folder>] [--out <folder>]
 *
 * Reads    ../STRUCTURE.md   the structure proposal: headings, paragraphs, bullets and pipe tables. Optional: when the
 *                            file is missing or holds no content, the Structure tab says "Structure: proposal pending"
 *                            and the build still passes.
 *          ../BACKLOG.md     the backlog: a pipe table with the columns What, Why not now, Trigger and Effort. Required.
 * Writes   parts/04-structure.html and parts/05-backlog.html, one tab each. They are generated: change the Markdown
 *          and run this script again, never edit the parts by hand.
 *
 * Rebuild the page with two commands, from this folder or from the repository root:
 *
 *   node gen-parts.mjs
 *   node build.mjs --strict
 *
 * What the conversion does
 *   # title          dropped: the tab has its own heading. The text before the first ## becomes the short summary above the pages.
 *   ## heading       one page of the tab (a button in the page row) with the heading as its h3. Without any ## heading
 *                    the whole file is one page and ### becomes the h3.
 *   ### and deeper   h4 inside a page.
 *   paragraphs, bullet and numbered lists (one level of nesting), > quotes (as a callout), fenced code, --- (a divider)
 *   | pipe tables |  div.geo-table-wrap > table.geo-table.geo-table-compact.packages, with a colgroup, th scope="col" and
 *                    cells that wrap. Column widths follow the content, and no column is narrower than its header; when the
 *                    headers of a table cannot all stay on one line at the narrowest width, they are set to wrap instead.
 *                    An Effort column of S, M or L turns into small chips (span.geo-tag) and a one-line legend follows.
 *   inline           `code`, **bold**, *italic*, <br>; a link keeps its text (a #link stays a link); raw HTML is shown as text.
 *   references       a parenthesis that holds only a decision reference (the word decision or decisions, then one or more
 *                    codes: a letter D, C, O or G, or ED, followed by a number) or a hard-rule number is removed: the page
 *                    says things in words, not in codes. Any other code that remains is refused by the build (rules check).
 * Warnings (printed, not fatal): a table with more than six columns, a header longer than 28 characters (it is set to
 * wrap, because header cells normally never wrap), a row whose cell count differs from the header. The build refuses
 * a table of more than six columns, and a header over 28 characters that is not set to wrap.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MAX_COLUMNS = 6;
const MAX_HEADER = 28;
const MAX_PAGE_TITLE = 36;

const USAGE = `Usage: node gen-parts.mjs [--notes <folder>] [--out <folder>]
  --notes <folder>  where BACKLOG.md and STRUCTURE.md are read from (default: the folder above this one)
  --out <folder>    where the two parts are written (default: parts/ next to this script)`;

export const TABS = [
  {
    id: 'structure', title: 'Structure', file: '04-structure.html', source: 'STRUCTURE.md', required: false,
    pending: 'Structure: proposal pending.',
    pendingNote: 'The tables the agent keeps in Notion, with their columns, the choices in each dropdown column, the views and sample rows, appear here once the structure proposal is written.',
  },
  {
    id: 'backlog', title: 'Backlog', file: '05-backlog.html', source: 'BACKLOG.md', required: true,
    pending: 'Backlog: nothing listed yet.',
    pendingNote: 'Deferred items appear here, one row each, once the backlog is written.',
  },
];

// ---------------------------------------------------------------- text helpers

const esc = (s) => String(s).replace(/&(?!(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

/** Markdown inline markers removed, for titles, slugs and width estimates. */
const plainText = (s) => String(s)
  .replace(/`([^`]*)`/g, '$1')
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\*\*|__/g, '')
  .replace(/(^|[^\w])[*_]([^*_]+)[*_](?!\w)/g, '$1$2')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1')
  .trim();

/** Placeholders use control characters, so they cannot clash with the notes. */
export function inline(src) {
  const codes = [];
  let s = String(src).replace(/[\u0000-\u0008]/g, '');
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|])/g, (_m, c) => `\u0005${c.charCodeAt(0)}\u0005`);
  s = s.replace(/`([^`]+)`/g, (_m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/<br\s*\/?>/gi, '\u0001');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, text, url) => (url.startsWith('#') ? `\u0002${url.slice(1)}\u0003${text}\u0004` : text));
  s = esc(s);
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\u0001/g, '<br>');
  s = s.replace(/\u0002([^\u0003]*)\u0003([\s\S]*?)\u0004/g, (_m, id, text) => `<a href="#${escAttr(id)}">${text}</a>`);
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, n) => `<code>${esc(codes[Number(n)])}</code>`);
  s = s.replace(/\u0005(\d+)\u0005/g, (_m, n) => esc(String.fromCharCode(Number(n))));
  return s;
}

const slugOf = (s) => plainText(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'page';

// ---------------------------------------------------------------- references the page must not show

const CODE = '(?:ED-?|[DCOG]-?)\\d+';
const MORE = `(?:\\s*(?:,|;|and|to|&)\\s*${CODE})*`;
const REFERENCES = [
  new RegExp(`\\s*\\(\\s*(?:see\\s+)?(?:decisions?\\s+)?${CODE}${MORE}\\s*\\)`, 'g'),
  /\s*\(\s*(?:see\s+)?hard rules?\s+\d+(?:\s*(?:,|and)\s*\d+)*\s*\)/gi,
];

function dropReferences(text) {
  let removed = 0;
  let out = text;
  for (const re of REFERENCES) out = out.replace(re, () => { removed += 1; return ''; });
  return { text: out, removed };
}

// ---------------------------------------------------------------- Markdown blocks (the subset the notes use)

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let k = 0; k < s.length; k += 1) {
    const ch = s[k];
    if (ch === '\\' && s[k + 1] === '|') { cur += '\\|'; k += 1; continue; }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const isSeparator = (line) => {
  if (!line || !line.includes('-') || !line.includes('|')) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
};

const startsBlock = (line, next) => FENCE.test(line) || HEADING.test(line) || ITEM.test(line) || /^\s*>/.test(line) || RULE.test(line)
  || (line.includes('|') && isSeparator(next));

function parseList(lines, start) {
  const flat = [];
  let i = start;
  let base = null; // indent and kind of the first item: a top-level item of the other kind starts a new list
  while (i < lines.length) {
    const m = lines[i].match(ITEM);
    if (m) {
      const indent = m[1].replace(/\t/g, '    ').length;
      const ordered = /\d/.test(m[2]);
      if (!base) base = { indent, ordered };
      else if (indent <= base.indent && ordered !== base.ordered) break;
      flat.push({ indent, ordered, text: m[3].trim(), children: [] });
      i += 1;
      continue;
    }
    if (!lines[i].trim()) {
      let j = i;
      while (j < lines.length && !lines[j].trim()) j += 1;
      if (j < lines.length && ITEM.test(lines[j])) { i = j; continue; }
      break;
    }
    if (/^\s+\S/.test(lines[i]) && flat.length && !FENCE.test(lines[i]) && !HEADING.test(lines[i].trim())) {
      flat[flat.length - 1].text += ` ${lines[i].trim()}`;
      i += 1;
      continue;
    }
    break;
  }
  const root = { indent: -1, children: [] };
  const stack = [root];
  for (const it of flat) {
    while (stack.length > 1 && stack[stack.length - 1].indent >= it.indent) stack.pop();
    stack[stack.length - 1].children.push(it);
    stack.push(it);
  }
  return { items: root.children, next: i };
}

export function parse(md) {
  const lines = md.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (FENCE.test(line)) {
      const fence = line.trim().slice(0, 3);
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) { body.push(lines[i]); i += 1; }
      i += 1;
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    const h = line.match(HEADING);
    if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2] }); i += 1; continue; }
    if (RULE.test(line)) { blocks.push({ type: 'rule' }); i += 1; continue; }
    if (line.includes('|') && isSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i += 1; }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const paras = [[]];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        const t = lines[i].replace(/^\s*>\s?/, '').trim();
        if (!t) paras.push([]); else paras[paras.length - 1].push(t);
        i += 1;
      }
      blocks.push({ type: 'quote', paras: paras.filter((p) => p.length).map((p) => p.join(' ')) });
      continue;
    }
    if (ITEM.test(line)) {
      const { items, next } = parseList(lines, i);
      blocks.push({ type: 'list', items });
      i = next;
      continue;
    }
    const para = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) { para.push(lines[i].trim()); i += 1; }
    blocks.push({ type: 'para', text: para.join(' ') });
  }
  return blocks;
}

// ---------------------------------------------------------------- tables

/** A header over the limit is set to wrap (an inline white-space rule on its th); a short one keeps the default and never wraps. */
const wraps = (h) => plainText(h).length > MAX_HEADER;

const MIN_TABLE = 520; // the narrowest a table gets: the phone rule in page.css (560 elsewhere)

/** The characters of a header that must fit on one line: all of it, or only its longest word when the header may wrap. */
const needOf = (h, mayWrap) => {
  const text = plainText(h);
  return mayWrap ? Math.min(text.length, Math.max(...text.split(/\s+/).map((w) => w.length)) + 2) : text.length;
};

// header text is Calibre at 16px with 10px of padding each side: measured at 5 to 7.7px a character, so 7px plus 26px never falls short
const minPercent = (chars) => (((chars * 7) + 26) / MIN_TABLE) * 100;

/**
 * Column widths in whole percent, and whether every header of the table is set to wrap. Widths follow the content and no column
 * is narrower than its header. When the headers cannot all stay on one line even at the narrowest width, the headers wrap
 * (a header never overlaps its neighbour), and only the longest word of each must then fit.
 */
function columnWidths(header, rows, warn) {
  const n = header.length;
  const lens = header.map((_h, j) => rows.reduce((a, r) => a + plainText(r[j] || '').length, 0) / Math.max(rows.length, 1));
  const want = lens.map((a) => Math.min(Math.max(a, 6), 90) + 10);
  let wrapAll = false;
  let min = header.map((h) => minPercent(needOf(h, wraps(h))));
  if (min.reduce((x, y) => x + y, 0) > 100) {
    wrapAll = true;
    min = header.map((h) => minPercent(needOf(h, true)));
  }
  const minSum = min.reduce((x, y) => x + y, 0);
  if (minSum > 100.5) {
    warn(`the headers of the table starting "${plainText(header[0])}" are too wide for ${n} columns`);
    min = min.map((m) => (m * 100) / minSum);
  }
  const locked = new Set();
  const share = new Array(n).fill(0);
  for (let guard = 0; guard <= n; guard += 1) {
    const free = 100 - [...locked].reduce((x, j) => x + min[j], 0);
    const sum = want.reduce((x, w, j) => x + (locked.has(j) ? 0 : w), 0);
    let changed = false;
    for (let j = 0; j < n; j += 1) share[j] = locked.has(j) ? min[j] : (sum ? (free * want[j]) / sum : 0);
    for (let j = 0; j < n; j += 1) {
      if (!locked.has(j) && share[j] < min[j]) { locked.add(j); changed = true; }
    }
    if (!changed) break;
  }
  const whole = share.map(Math.floor);
  let left = 100 - whole.reduce((x, y) => x + y, 0);
  share.map((s, j) => [s - Math.floor(s), j]).sort((p, q) => q[0] - p[0]).forEach(([, j]) => { if (left > 0) { whole[j] += 1; left -= 1; } });
  return { widths: whole, wrapAll };
}

/** Cells of an Effort column: a leading S, M or L (and any later one) becomes a small chip. */
function effortCell(raw) {
  const text = raw.trim();
  if (!/^[SML]\b/.test(text)) return inline(text);
  return text.split(/\b([SML])\b/).map((part, k) => (k % 2 ? `<span class="geo-tag">${part}</span>` : inline(part))).join('');
}

function renderTable(t, warn) {
  const n = t.header.length;
  const name = plainText(t.header[0] || '');
  if (n > MAX_COLUMNS) warn(`the table starting "${name}" has ${n} columns; at most ${MAX_COLUMNS} read well`);
  for (const h of t.header) if (wraps(h)) warn(`the header "${plainText(h)}" is over ${MAX_HEADER} characters; it is set to wrap, a shorter one reads better`);
  const rows = t.rows.map((r) => {
    if (r.length !== n) warn(`a row of the table starting "${name}" has ${r.length} cells for ${n} columns: "${plainText(r[0] || '')}"`);
    return Array.from({ length: n }, (_x, j) => r[j] || '');
  });
  const effort = t.header.map((h) => /^(effort|size)$/i.test(plainText(h)));
  const { widths, wrapAll } = columnWidths(t.header, rows, warn);
  const out = [];
  out.push('<div class="geo-table-wrap"><table class="geo-table geo-table-compact packages">');
  out.push(`<colgroup>${widths.map((w) => `<col style="width:${w}%">`).join('')}</colgroup>`);
  out.push(`<thead><tr>${t.header.map((h) => `<th scope="col"${wrapAll || wraps(h) ? ' style="white-space:normal"' : ''}>${inline(h)}</th>`).join('')}</tr></thead>`);
  out.push('<tbody>');
  for (const r of rows) out.push(`<tr>${r.map((c, j) => `<td>${effort[j] ? effortCell(c) : inline(c)}</td>`).join('')}</tr>`);
  out.push('</tbody>', '</table></div>');
  if (effort.some(Boolean)) out.push('<p class="small">Effort is the engineer\'s work to bring the item in: S is small, M is medium, L is large.</p>');
  return { html: out.join('\n'), rows: rows.length };
}

// ---------------------------------------------------------------- rendering

function renderList(items) {
  const tag = items[0].ordered ? 'ol' : 'ul';
  const li = items.map((it) => `<li>${inline(it.text)}${it.children.length ? `\n${renderList(it.children)}\n` : ''}</li>`);
  return `<${tag}>\n${li.join('\n')}\n</${tag}>`;
}

function renderBlocks(blocks, ctx) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'heading') {
      const tag = ctx.pages || b.level > 3 ? 'h4' : 'h3';
      out.push(`<${tag}>${inline(b.text)}</${tag}>`);
    } else if (b.type === 'para') {
      out.push(`<p>${inline(b.text)}</p>`);
    } else if (b.type === 'list') {
      out.push(renderList(b.items));
    } else if (b.type === 'table') {
      const t = renderTable(b, ctx.warn);
      ctx.stats.tables += 1;
      ctx.stats.rows += t.rows;
      out.push(t.html);
    } else if (b.type === 'quote') {
      out.push(`<div class="geo-callout"><div class="geo-callout-body">\n${b.paras.map((p) => `<p>${inline(p)}</p>`).join('\n')}\n</div></div>`);
    } else if (b.type === 'code') {
      out.push(`<div class="geo-code"><pre>${esc(b.text)}</pre></div>`);
    } else if (b.type === 'rule') {
      out.push('<hr class="geo-divider">');
    }
  }
  return out;
}

const banner = (tab) => `Generated by gen-parts.mjs from ../${tab.source}. Do not edit this part: change the Markdown and run gen-parts.mjs again.`;
const open = (tab) => `<section id="${tab.id}" role="tabpanel" aria-labelledby="tab-${tab.id}" hidden>\n<h2>${tab.title}</h2>`;

function pendingPart(tab, why) {
  return `<!-- ${banner(tab)} ${why} -->\n${open(tab)}\n<p>${tab.pending}</p>\n<p class="small">${tab.pendingNote}</p>\n</section>\n`;
}

/** { html, stats } for a tab, or null when the Markdown holds no content. */
export function tabPart(tab, md, warn) {
  const cleaned = dropReferences(md);
  let blocks = parse(cleaned.text);
  if (blocks.length && blocks[0].type === 'heading' && blocks[0].level === 1) blocks = blocks.slice(1);
  blocks = blocks.map((b) => (b.type === 'heading' && b.level === 1 ? { ...b, level: 2 } : b));
  if (!blocks.length) return null;

  const stats = { tables: 0, rows: 0, pages: 0, removed: cleaned.removed };
  const ctx = { warn, stats, pages: false };
  const first = blocks.findIndex((b) => b.type === 'heading' && b.level === 2);
  const out = [`<!-- ${banner(tab)} -->`, open(tab)];

  if (first < 0) {
    out.push(...renderBlocks(blocks, ctx));
  } else {
    ctx.pages = true;
    const intro = blocks.slice(0, first);
    if (intro.length) out.push('<div class="plain">', ...renderBlocks(intro, ctx), '</div>');
    const used = new Set();
    let at = first;
    while (at < blocks.length) {
      let end = at + 1;
      while (end < blocks.length && !(blocks[end].type === 'heading' && blocks[end].level === 2)) end += 1;
      const title = blocks[at].text;
      const label = plainText(title);
      if (label.length > MAX_PAGE_TITLE) warn(`the page title "${label}" is over ${MAX_PAGE_TITLE} characters; it is a button label`);
      let id = `${tab.id}-${slugOf(title)}`;
      for (let n = 2; used.has(id); n += 1) id = `${tab.id}-${slugOf(title)}-${n}`;
      used.add(id);
      out.push(`<div class="sub" id="${id}" data-title="${escAttr(label)}">`, `<h3>${inline(title)}</h3>`, ...renderBlocks(blocks.slice(at + 1, end), ctx), '</div>');
      stats.pages += 1;
      at = end;
    }
  }
  out.push('</section>');
  return { html: `${out.join('\n')}\n`, stats };
}

// ---------------------------------------------------------------- main

function option(args, name) {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return null;
  return args[i].includes('=') ? args[i].slice(args[i].indexOf('=') + 1) : args[i + 1];
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
  const notesArg = option(args, '--notes');
  const outArg = option(args, '--out');
  const known = new Set(['--notes', '--out']);
  const stray = args.filter((a, i) => !known.has(a.split('=')[0]) && !(i > 0 && known.has(args[i - 1]) && !args[i - 1].includes('=')));
  if (stray.length || (args.some((a) => a.split('=')[0] === '--notes') && !notesArg) || (args.some((a) => a.split('=')[0] === '--out') && !outArg)) {
    console.error(`${stray.length ? `unknown argument: ${stray.join(' ')}` : 'an option is missing its value'}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  const notes = notesArg ? resolve(process.cwd(), notesArg) : resolve(ROOT, '..');
  const outDir = outArg ? resolve(process.cwd(), outArg) : join(ROOT, 'parts');
  const show = (p) => relative(process.cwd(), p).split(sep).join('/') || '.';

  const inputs = TABS.map((tab) => {
    const file = join(notes, tab.source);
    return { tab, file, text: existsSync(file) ? readFileSync(file, 'utf8') : null };
  });
  const lost = inputs.filter((x) => x.text === null && x.tab.required);
  if (lost.length) {
    console.error(`gen-parts: cannot run, ${lost.map((x) => show(x.file)).join(', ')} does not exist; nothing was written`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(outDir, { recursive: true });
  for (const { tab, file, text } of inputs) {
    const target = join(outDir, tab.file);
    const warnings = [];
    const warn = (m) => warnings.push(m);
    let html;
    let note;
    if (text === null) {
      html = pendingPart(tab, `${tab.source} does not exist yet.`);
      note = `${tab.source} does not exist: the tab says "${tab.pending.replace(/\.$/, '')}"`;
    } else {
      const part = tabPart(tab, text, warn);
      if (part) {
        html = part.html;
        const s = part.stats;
        note = `${s.pages ? `${s.pages} page${s.pages === 1 ? '' : 's'}, ` : ''}${s.tables} table${s.tables === 1 ? '' : 's'}, ${s.rows} row${s.rows === 1 ? '' : 's'}${s.removed ? `; ${s.removed} decision reference${s.removed === 1 ? '' : 's'} left out` : ''}`;
      } else {
        html = pendingPart(tab, `${tab.source} holds no content yet.`);
        note = `${tab.source} holds no content: the tab says "${tab.pending.replace(/\.$/, '')}"`;
      }
    }
    writeFileSync(target, html);
    console.log(`gen-parts: ${show(file)} -> ${show(target)} (${note})`);
    for (const w of warnings) console.warn(`  warning: ${w}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(e.stack || String(e)); process.exitCode = 1; }
}
