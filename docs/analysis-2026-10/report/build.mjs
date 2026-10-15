#!/usr/bin/env node
/**
 * Assemble claim-tagger-analysis.html from parts/. A Node port of the research page's build.py, copied from
 * docs/mvp-2026-10/report/build.mjs for the analysis report: the title, the output file name, the usage text and a comment on CONFIG
 * differ; the pipeline, the checks and the --strict semantics are the same.
 *
 *   node build.mjs [--strict] [--standalone] [--out <file>]
 *
 * Reads    design-system/tokens.json        compiled to CSS variables: light on :root, dark under the system preference
 *                                           unless light is forced, and again under a forced dark theme
 *          design-system/fonts/*.woff2      inlined as base64 @font-face rules
 *          design-system/bundle.css         the geo-* component classes
 *          parts/page.css, parts/script.js  the page's own styles and behaviour
 *          parts/NN-*.html                  the page, concatenated in name order; <!-- include: fragments/x.html -->
 *                                           is replaced by parts/fragments/x.html (nested includes work)
 *          data/counts.json                 {{count:key}} placeholders are filled from it when the file exists
 * Writes   claim-tagger-analysis.html       <title>, <style>, the page content, <script>. No doctype, html, head or body
 *                                           tags and no meta tags: the Artifact tool wraps the file in its own skeleton
 *                                           at publish time. --standalone writes a full document to preview/full.html
 *                                           instead, to look at the whole page in a browser (never publish that file).
 *
 * Checks (printed after every build; with --strict any failure exits 1 and the output is not written):
 *   includes, {{...}} tokens and pending counts, personal names (from agents/claim-tagger/config.json anonymise.replacements
 *   plus the report owner's names), leftover jargon markers, glossary (dfn terms without an entry, entries never marked),
 *   citation markers without a source row, internal links and duplicate ids, tabs and pages, unbalanced tags,
 *   literal colours outside the tokens, CSS variables that do not exist, TODO text (strict only), output size.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const DS = join(ROOT, 'design-system');
export const PARTS = join(ROOT, 'parts');
export const DATA = join(ROOT, 'data');
export const OUT = join(ROOT, 'claim-tagger-analysis.html');
export const TITLE = 'Claim tagger review';
export const CONFIG = resolve(ROOT, '..', '..', '..', 'agents', 'claim-tagger', 'config.json'); // docs/analysis-2026-10/report is as deep as docs/mvp-2026-10/report: three levels up is the repo root

// Names that must never appear on the page, besides the first element of every anonymise.replacements pair in the config.
const EXTRA_NAMES = ['Mika', 'Mikalojus', 'Malkovich'];
// Leftover working vocabulary that does not belong in a published report (compared case-insensitively against the visible text).
const JARGON = ['§', '(my ', 'tonight', 'this session', 'plan mode', 'AskUserQuestion', 'lorem',
  'Explore agent', 'Plan agent', 'P1', 'P2', 'P3', 'sweep-', 'notes file', 'ExitPlanMode', 'Insight', 'lobster', 'TBD', 'W1', 'W2', 'W3', 'W4', 'W5'];
// Stand-in for the Artifact publish skeleton, used only by --standalone files and previews.
const SKELETON_RESET = ':root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}\n' +
  'body{margin:0;font:14px system-ui,sans-serif}\nimg{max-width:100%}\n[hidden]{display:none!important}';

const USAGE = `Usage: node build.mjs [--strict] [--standalone] [--out <file>]
  --strict      every check must pass (no TODO text, no pending counts, no personal names, ...); on failure exit 1, write nothing
  --standalone  wrap the page in a full HTML document and write preview/full.html, to open the whole page in a browser;
                claim-tagger-analysis.html keeps the publish shape (title, style, page content, script) because the
                Artifact tool adds the document around it
  --out <file>  write to <file> instead of the default file`;

export const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
export const rel = (p) => relative(ROOT, p).split(sep).join('/');
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// ---------------------------------------------------------------- tokens and fonts (ported one to one from build.py)

const cssName = (name) => '--' + name.replace(/\./g, '\\.');
/** '{white}' becomes 'var(--white)'; plain values pass through. */
const ref = (v) => (typeof v === 'string'
  ? v.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, n) => `var(${cssName(n)})`)
  : String(v));
const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function compileTokens() {
  const t = JSON.parse(read(join(DS, 'tokens.json')));
  const light = [];
  const dark = [];
  const themed = (tok) => {
    const v = tok.value;
    if (isDict(v)) {
      const lv = 'light' in v ? v.light : v.value;
      if (lv === undefined) throw new Error(`token ${tok.name} has no light value`);
      light.push(`${cssName(tok.name)}:${ref(lv)}`);
      if ('dark' in v) dark.push(`${cssName(tok.name)}:${ref(v.dark)}`);
    } else {
      light.push(`${cssName(tok.name)}:${ref(v)}`);
    }
  };
  for (const tok of t.color.tokens) themed(tok);
  for (const group of ['spacing', 'radius', 'size']) {
    for (const tok of t[group].tokens) light.push(`${cssName(tok.name)}:${ref(tok.value)}`);
  }
  for (const tok of t.shadow.tokens) themed(tok);
  light.push(`--font-sans:${t.type.families.sans}`);
  light.push(`--font-mono:${t.type.families.mono}`);
  dark.push('color-scheme:dark');
  return '/* Geo design system tokens (tokens.json): palette, roles, spacing, radius, size, shadows. Light on :root; ' +
    'dark under the system preference unless light is forced, and again under a forced dark theme. */\n' +
    `:root{\n  ${light.join(';\n  ')};\n}\n` +
    `@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){\n  ${dark.join(';\n  ')};\n} }\n` +
    `:root[data-theme="dark"]{\n  ${dark.join(';\n  ')};\n}\n`;
}

const FACES = [['calibre-regular.woff2', 400], ['calibre-medium.woff2', 500], ['calibre-semibold.woff2', 600], ['calibre-bold.woff2', 700]];

export function fontFaces() {
  return FACES.map(([file, weight]) => {
    const b64 = readFileSync(join(DS, 'fonts', file)).toString('base64');
    return `@font-face{font-family:"Calibre";font-style:normal;font-weight:${weight};font-display:swap;` +
      `src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
  }).join('\n');
}

// ---------------------------------------------------------------- counts

/** data/counts.json as a Map key -> { value, source, pending }; null when the file does not exist. */
export function loadCounts() {
  const file = join(DATA, 'counts.json');
  if (!existsSync(file)) return null;
  const text = read(file);
  const map = new Map();
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('_')) continue;
      const key = prefix ? `${prefix}.${k}` : k;
      if (isDict(v) && !('value' in v)) walk(v, key);
      else if (isDict(v)) map.set(key, { value: v.value, source: v.source, pending: v.pending === true });
      else map.set(key, { value: v, source: undefined, pending: false });
    }
  };
  walk(JSON.parse(text), '');
  map.file = { file: 'data/counts.json', text };
  return map;
}

const formatCount = (v) => (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(v));
const COUNT_RE = /\{\{count:([A-Za-z0-9_.-]+)\}\}/g;

function substituteCounts(text, counts) {
  const used = new Map();
  const missing = new Set();
  const out = text.replace(COUNT_RE, (_m, key) => {
    const entry = counts && counts.get(key);
    if (!entry) { missing.add(key); return `{{count:${key}}}`; }
    used.set(key, entry);
    return esc(formatCount(entry.value));
  });
  return { text: out, used, missing };
}

// ---------------------------------------------------------------- assembling

/** The numbered parts in name order: 01-header.html ... 99-footer.html. */
export function partFiles() {
  return readdirSync(PARTS).filter((f) => /^\d\d-.*\.html$/.test(f)).sort();
}

const INCLUDE_RE = /<!--\s*include:\s*(\S+?)\s*-->/g;
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/**
 * Build the page from parts. Each part is a file name in parts/ or { name, text } for a generated part.
 * Returns the css, script and body plus everything the checks need.
 */
export function buildPage(parts, { counts = null } = {}) {
  const sources = [];
  const addSource = (file, text) => { if (!sources.some((s) => s.file === file)) sources.push({ file, text }); };
  const includes = [];
  const missingIncludes = [];

  const resolveIncludes = (text, chain) => text.replace(INCLUDE_RE, (_m, target) => {
    const p = resolve(PARTS, target);
    if (!p.startsWith(PARTS + sep)) { missingIncludes.push(`${target} (outside parts/)`); return `<!-- missing include ${target} -->`; }
    if (!existsSync(p)) { missingIncludes.push(target); return `<!-- missing include ${target} -->`; }
    if (chain.includes(target) || chain.length > 6) { missingIncludes.push(`${target} (include loop)`); return `<!-- include loop ${target} -->`; }
    const inner = read(p);
    addSource(`parts/${target}`, inner);
    if (!includes.includes(target)) includes.push(target);
    return resolveIncludes(inner, [...chain, target]);
  });

  const names = [];
  const joined = parts.map((part) => {
    const name = typeof part === 'string' ? part : part.name;
    const text = typeof part === 'string' ? read(join(PARTS, part)) : part.text;
    names.push(name);
    addSource(`parts/${name}`, text);
    return resolveIncludes(text, [name]);
  }).join('\n');

  const { text: raw, used, missing } = substituteCounts(joined, counts);
  const pageCss = read(join(PARTS, 'page.css'));
  const script = read(join(PARTS, 'script.js'));
  addSource('parts/page.css', pageCss);
  addSource('parts/script.js', script);
  if (counts && counts.file) addSource(counts.file.file, counts.file.text);

  const tokens = compileTokens();
  const fonts = fontFaces();
  const bundle = read(join(DS, 'bundle.css'));
  const css = `${tokens}\n/* Calibre, inlined from design-system/fonts */\n${fonts}\n/* Geo components (design-system/bundle.css) */\n${bundle}\n/* Page styles (parts/page.css) */\n${pageCss}`;

  return {
    parts: names, includes, missingIncludes, sources,
    raw, body: stripComments(raw), counts: { present: counts !== null, used, missing: [...missing] },
    css, pageCss, tokens, fonts, bundle, script,
  };
}

/** The publish shape: title and style first (only the first 8 KB are scanned for the title), then the page, then the script. */
export function toArtifact(page) {
  return `<title>${esc(TITLE)}</title>\n<style>\n${page.css}\n</style>\n${page.body}\n<script>\n${page.script}\n</script>\n`;
}

/** A full document for opening a file directly in a browser (previews, --standalone). */
export function toDocument(page, title = TITLE) {
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    `<title>${esc(title)}</title>\n` +
    `<style>\n/* stand-in for the Artifact publish skeleton */\n${SKELETON_RESET}\n</style>\n` +
    `<style>\n${page.css}\n</style>\n</head>\n<body>\n${page.body}\n<script>\n${page.script}\n</script>\n</body>\n</html>\n`;
}

// ---------------------------------------------------------------- checks

const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const list = (items, max = 12) => (items.length > max ? [...items.slice(0, max), `... and ${items.length - max} more`] : items);

function loadNames() {
  let fromConfig = [];
  let problem = null;
  try {
    const cfg = JSON.parse(read(CONFIG));
    const pairs = (cfg.anonymise && cfg.anonymise.replacements) || [];
    fromConfig = pairs.map((p) => (Array.isArray(p) ? p[0] : null)).filter(Boolean);
    if (!fromConfig.length) problem = `${rel(CONFIG)} has no anonymise.replacements`;
  } catch (e) {
    problem = `cannot read ${CONFIG}: ${e.message}`;
  }
  return { names: [...new Set([...fromConfig, ...EXTRA_NAMES])], problem };
}

const nameRegex = (names) => new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${[...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'giu');

const BALANCED = ['section', 'div', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'caption', 'details', 'summary', 'figure', 'figcaption',
  'dl', 'dt', 'dd', 'ul', 'ol', 'li', 'p', 'main', 'aside', 'nav', 'header', 'footer', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4',
  'a', 'button', 'span', 'dfn', 'strong', 'code', 'label', 'svg', 'g', 'text'];

function paintLiterals(body) {
  const hits = [];
  const NAMED = new Set(['black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'gray', 'grey', 'silver', 'navy',
    'teal', 'maroon', 'olive', 'lime', 'aqua', 'fuchsia', 'brown', 'cyan', 'magenta', 'gold', 'indigo', 'violet', 'crimson', 'coral']);
  for (const m of body.matchAll(/\s(fill|stroke|stop-color|flood-color|lighting-color|color)="([^"]*)"/g)) {
    const v = m[2].trim();
    if (/^(none|currentcolor|transparent|inherit|initial|unset|revert|context-fill|context-stroke)$/i.test(v) || /^(var|url)\(/i.test(v)) continue;
    hits.push(`${m[1]}="${v}"`);
  }
  for (const m of body.matchAll(/\sstyle="([^"]*)"/g)) {
    for (const decl of m[1].split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim();
      const val = decl.slice(i + 1).trim();
      if (!prop || prop.startsWith('--')) continue;
      const colourProp = /^(color|background|background-color|border(-[a-z]+)*|fill|stroke|outline(-color)?|box-shadow|text-decoration-color|caret-color|accent-color)$/i.test(prop);
      if (/#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\(/i.test(val) || (colourProp && val.split(/[\s,]+/).some((w) => NAMED.has(w.toLowerCase())))) {
        hits.push(`style ${prop}: ${val}`);
      }
    }
  }
  return hits;
}

/**
 * Run the checks. full: false is for single-part previews, which lack the other tabs (no glossary, tab or link checks).
 * Each result: { id, status: 'ok' | 'fail' | 'info', text, lines }.
 */
export function runChecks(page, { strict = false, full = true } = {}) {
  const results = [];
  const add = (id, ok, okText, failText, lines = []) => results.push({ id, status: ok ? 'ok' : 'fail', text: ok ? okText : failText, lines: ok ? [] : list(lines) });
  const info = (id, text, lines = []) => results.push({ id, status: 'info', text, lines: list(lines) });
  const body = page.body;
  const markup = page.sources.filter((s) => s.file.endsWith('.html'));

  // includes
  add('includes', page.missingIncludes.length === 0,
    page.includes.length ? `includes resolved (${page.includes.join(', ')})` : 'no includes used',
    `${page.missingIncludes.length} include(s) not found`, page.missingIncludes);

  // {{count:key}} placeholders and pending counts (other {{...}} text, such as a template shown in a code block, is left alone)
  const leftTokens = [...new Set(body.match(/\{\{count:[^}]*\}\}/g) || [])];
  add('tokens', leftTokens.length === 0,
    `no unresolved {{count:...}} placeholders (${page.counts.used.size} count key(s) filled)`,
    `unresolved placeholders: ${leftTokens.join(' ')}${page.counts.present ? '' : ' (data/counts.json does not exist)'}`);
  const pending = [...page.counts.used].filter(([, e]) => e.pending).map(([k, e]) => `${k} = ${JSON.stringify(e.value)}`);
  if (strict) add('pending', pending.length === 0, 'no pending counts in use', `${pending.length} pending count(s) in use`, pending);
  else if (pending.length) info('pending', `pending counts in use (--strict refuses them): ${pending.map((p) => p.split(' = ')[0]).join(', ')}`);

  // personal names, scanned in every source file (parts, fragments, css, script, counts), comments included
  const { names, problem } = loadNames();
  if (problem) {
    add('names', false, '', `personal names: the check could not run, ${problem}`);
  } else {
    const re = nameRegex(names);
    const hits = [];
    for (const s of page.sources) for (const m of s.text.matchAll(re)) hits.push(`${s.file}:${lineOf(s.text, m.index)} ${JSON.stringify(m[0])}`);
    add('names', hits.length === 0, `no personal names (${names.length} names checked)`, `PERSONAL NAMES REMAIN (${hits.length})`, hits);
  }

  // leftover jargon markers in the visible text
  const visible = body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').toLowerCase();
  const jargon = JARGON.map((w) => [w, visible.split(w.toLowerCase()).length - 1]).filter(([, n]) => n > 0).map(([w, n]) => `LEFTOVER ${JSON.stringify(w)}: ${n}`);
  add('jargon', jargon.length === 0, 'no leftover jargon markers', 'leftover jargon markers', jargon);

  if (full) {
    // glossary: every dfn has an entry, every entry is marked at least once
    const dfns = new Set([...body.matchAll(/<dfn\b[^>]*\bdata-t="([^"]+)"/g)].map((m) => m[1]));
    const dts = [...body.matchAll(/<dt\b[^>]*\bid="g-([^"]+)"/g)].map((m) => m[1]);
    const noEntry = [...dfns].filter((t) => !dts.includes(t)).sort();
    const neverMarked = dts.filter((t) => !dfns.has(t)).sort();
    add('glossary-entries', noEntry.length === 0, `every dfn term has a glossary entry (${dfns.size} terms)`, 'dfn terms without a glossary entry', noEntry);
    add('glossary-marked', neverMarked.length === 0, `every glossary entry is marked in the text (${dts.length} entries)`, 'glossary entries never marked with a dfn', neverMarked);

    // citations
    const cites = new Set();
    for (const m of body.matchAll(/<a\b[^>]*>/g)) {
      const a = attrsOf(m[0]);
      if (/(^|\s)cite(\s|$)/.test(a.class || '') && /^#src-/.test(a.href || '')) cites.add(a.href.slice(1));
    }
    const srcIds = new Set([...body.matchAll(/\bid="(src-[^"]+)"/g)].map((m) => m[1]));
    const noRow = [...cites].filter((c) => !srcIds.has(c)).sort();
    add('cites', noRow.length === 0, `every citation marker has a source row (${cites.size} markers)`, 'citation markers without a source row', noRow);

    // ids and internal links
    const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dupIds = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
    add('ids', dupIds.length === 0, `ids are unique (${ids.length})`, 'duplicate ids', dupIds);
    const idSet = new Set(ids);
    const dangling = [...new Set([...body.matchAll(/\shref="#([^"]+)"/g)].map((m) => m[1]).filter((h) => !idSet.has(h)))];
    add('links', dangling.length === 0, 'every #link has a target', 'links to ids that do not exist', dangling);

    // tabs and pages
    const problems = [];
    const tabBtns = [...body.matchAll(/<button\b[^>]*\brole="tab"[^>]*>/g)].map((m) => attrsOf(m[0]));
    const panelTags = [...body.matchAll(/<section\b[^>]*\brole="tabpanel"[^>]*>/g)];
    const panels = panelTags.map((m) => attrsOf(m[0]));
    for (const t of tabBtns) if (!panels.some((p) => p.id === t['aria-controls'])) problems.push(`tab ${t.id || '?'} controls a missing panel ${t['aria-controls']}`);
    for (const p of panels) {
      if (!tabBtns.some((t) => t['aria-controls'] === p.id)) problems.push(`panel ${p.id} has no tab in the rail`);
      if (!tabBtns.some((t) => t.id === p['aria-labelledby'])) problems.push(`panel ${p.id} is labelled by a missing tab ${p['aria-labelledby']}`);
    }
    panelTags.forEach((m, i) => {
      const end = i + 1 < panelTags.length ? panelTags[i + 1].index : body.length;
      const subs = [...body.slice(m.index, end).matchAll(/<div\b[^>]*>/g)].map((d) => attrsOf(d[0])).filter((a) => (a.class || '').split(/\s+/).includes('sub'));
      const id = panels[i].id;
      for (const s of subs) if (!s.id || !s['data-title']) problems.push(`a page in ${id} lacks id or data-title (${s.id || s['data-title'] || 'unnamed'})`);
      if (subs.length && subs[0]['data-layer'] === 'tech') problems.push(`the first page of ${id} is Technical, so Plain mode would open on a hidden page`);
    });
    add('tabs', problems.length === 0, `${panels.length} tabs match the rail (${panels.map((p) => p.id).join(', ')}); pages have ids and titles`, 'tabs and pages', problems);
  }

  // tag balance
  const unbalanced = [];
  const bare = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  for (const tag of BALANCED) {
    const open = (bare.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) || []).filter((t) => !t.endsWith('/>')).length;
    const close = (bare.match(new RegExp(`</${tag}>`, 'g')) || []).length;
    if (open !== close) unbalanced.push(`TAG MISMATCH ${tag}: ${open} open, ${close} close`);
  }
  add('balance', unbalanced.length === 0, 'tags are balanced', 'unbalanced tags', unbalanced);

  // colours and variables
  const colours = [];
  const noComments = page.pageCss.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  noComments.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) colours.push(`parts/page.css:${i + 1} ${m[0]}`);
    if (!/(^|[;{\s])--[\w-]+\s*:/.test(line)) for (const m of line.matchAll(/\b(?:rgba?|hsla?|hwb|oklab|oklch)\(/g)) colours.push(`parts/page.css:${i + 1} ${m[0]}...)`);
  });
  colours.push(...paintLiterals(body));
  add('colours', colours.length === 0, 'no literal colours outside the tokens', 'literal colours outside the tokens', colours);
  const defined = new Set([...page.css.matchAll(/(--[A-Za-z0-9_\\.-]+)\s*:/g)].map((m) => m[1]));
  const usedVars = new Map();
  for (const m of `${page.css}\n${body}`.matchAll(/var\(\s*(--[A-Za-z0-9_\\.-]+)/g)) usedVars.set(m[1], true);
  const undefinedVars = [...usedVars.keys()].filter((v) => !defined.has(v));
  add('vars', undefinedVars.length === 0, `every var(--...) is defined (${usedVars.size} used)`, 'CSS variables used but not defined', undefinedVars);

  // script safety
  add('script', !/<\/script/i.test(page.script) && !page.script.includes('<!--'), 'script.js can sit inside a <script> element', 'script.js contains </script or <!--');

  // TODO text: allowed while drafting, refused by --strict
  const todo = markup.map((s) => [s.file, (s.text.match(/\bTODO\b/g) || []).length]).filter(([, n]) => n > 0);
  const todoTotal = todo.reduce((n, [, c]) => n + c, 0);
  if (strict) add('todo', todoTotal === 0, 'no TODO text left', `TODO text remains (${todoTotal})`, todo.map(([f, n]) => `${f}: ${n}`));
  else if (todoTotal) info('todo', `TODO markers: ${todoTotal} in ${todo.length} file(s); --strict refuses them`, todo.map(([f, n]) => `${f}: ${n}`));
  else info('todo', 'no TODO text left');

  return results;
}

export function printResults(results) {
  for (const r of results) {
    const tag = r.status === 'ok' ? 'ok  ' : r.status === 'fail' ? 'FAIL' : 'info';
    console.log(`  ${tag}  ${r.text}`);
    for (const l of r.lines) console.log(`          ${l}`);
  }
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
  const outArg = option(args, '--out');
  const known = new Set(['--strict', '--standalone', '--out']);
  const stray = args.filter((a, i) => !known.has(a.split('=')[0]) && args[i - 1] !== '--out');
  if (stray.length || (args.some((a) => a.split('=')[0] === '--out') && !outArg)) {
    console.error(`${stray.length ? `unknown argument: ${stray.join(' ')}` : '--out needs a file name'}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  const strict = args.includes('--strict');
  const standalone = args.includes('--standalone');
  const out = outArg ? resolve(process.cwd(), outArg) : (standalone ? join(ROOT, 'preview', 'full.html') : OUT);

  const names = partFiles();
  const page = buildPage(names, { counts: loadCounts() });
  const html = standalone ? toDocument(page) : toArtifact(page);
  const bytes = Buffer.byteLength(html);

  console.log(`parts (${names.length}): ${names.join(', ')}`);
  console.log(`css: tokens ${kb(Buffer.byteLength(page.tokens))}, fonts ${kb(Buffer.byteLength(page.fonts))}, bundle ${kb(Buffer.byteLength(page.bundle))}, page ${kb(Buffer.byteLength(page.pageCss))}; ` +
    `page content ${kb(Buffer.byteLength(page.body))}; script ${kb(Buffer.byteLength(page.script))}`);
  console.log(`checks${strict ? ' (strict)' : ''}:`);
  const results = runChecks(page, { strict, full: true });
  const titleAt = html.indexOf('<title>');
  results.push({
    id: 'size', status: bytes <= 16 * 1024 * 1024 && titleAt >= 0 && titleAt < 8192 ? 'ok' : 'fail',
    text: bytes <= 16 * 1024 * 1024 && titleAt >= 0 && titleAt < 8192 ? `output ${kb(bytes)} (${bytes.toLocaleString('en-US')} bytes); title at byte ${titleAt}` : `output ${kb(bytes)}; title must sit in the first 8 KB and the file under 16 MB`,
    lines: [],
  });
  printResults(results);
  const failed = results.filter((r) => r.status === 'fail');

  if (strict && failed.length) {
    console.log(`\nstrict: ${failed.length} check(s) failed; ${rel(out)} was not written`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`\nwrote ${out} (${kb(bytes)})${failed.length ? `; ${failed.length} check(s) failed, which --strict would refuse` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(e.stack || String(e)); process.exitCode = 1; }
}
