#!/usr/bin/env node
/**
 * Build a single-tab preview for checking one part in a browser.
 *
 *   node preview.mjs parts/02-glance.html        -> preview/02-glance.html
 *   node preview.mjs glance                      (a tab id or a file name without the number works too)
 *   node preview.mjs parts/fragments/structure-figure.html
 *
 * The preview has the same head as the real page (tokens, fonts, components, page styles) inside a full HTML document,
 * the header, the one part, the glossary (so the terms strips and tooltips work) and the footer, and the script.
 * A fragment is shown inside a figure frame when it is an svg, otherwise as plain page content.
 * Open the file in a browser; use the theme toggle for dark mode and the Plain / Technical switch for the technical pages.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, basename, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, PARTS, buildPage, loadCounts, partFiles, read, rel, runChecks, printResults, toDocument } from './build.mjs';

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/** Find the file the argument names: a path, a name in parts/, or a tab id such as glance. */
function locate(arg) {
  const tries = [resolve(process.cwd(), arg), resolve(ROOT, arg), join(PARTS, arg), join(PARTS, `${arg}.html`),
    join(PARTS, 'fragments', arg), join(PARTS, 'fragments', `${arg}.html`)];
  for (const p of tries) if (existsSync(p) && extname(p)) return p;
  const byId = partFiles().find((f) => f.replace(/^\d\d-/, '').replace(/\.html$/, '') === arg);
  return byId ? join(PARTS, byId) : null;
}

function main() {
  const arg = process.argv[2];
  if (!arg || arg === '--help' || arg === '-h') {
    console.log('Usage: node preview.mjs <part file | tab id | fragment file>   e.g. node preview.mjs parts/02-glance.html');
    process.exitCode = arg ? 0 : 1;
    return;
  }
  const file = locate(arg);
  if (!file || !file.startsWith(PARTS + sep)) {
    console.error(`cannot find a part or fragment for "${arg}" under ${rel(PARTS)}`);
    console.error(`parts: ${partFiles().join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const all = partFiles();
  const header = all.find((f) => f.startsWith('01-'));
  const footer = all.find((f) => f.startsWith('99-'));
  const glossary = all.find((f) => /-glossary\.html$/.test(f));
  const isFragment = file.startsWith(join(PARTS, 'fragments') + sep);
  const name = basename(file, '.html');
  let parts;
  if (isFragment) {
    const text = read(file);
    const target = rel(file).replace(/^parts\//, '');
    const inner = `<!-- include:${target} -->`;
    const shown = /^\s*(<!--[\s\S]*?-->\s*)*<svg\b/.test(text)
      ? `<figure class="geo-figure"><div class="geo-figure-frame">${inner}</div></figure>`
      : inner;
    parts = [header, {
      name: '50-fragment-preview.html',
      text: `<section id="fragment-preview" role="tabpanel" aria-labelledby="tab-fragment-preview">\n<h2>Fragment preview</h2>\n<p class="small">${target}</p>\n<div class="sub" id="fragment-preview-page" data-title="Fragment">\n${shown}\n</div>\n</section>`,
    }, glossary, footer];
  } else {
    const wanted = basename(file);
    parts = [...new Set([header, wanted, glossary, footer])].filter(Boolean).sort();
  }

  const page = buildPage(parts, { counts: loadCounts() });
  const html = toDocument(page, `Preview: ${name} · Editor feedback loop MVP`);
  const dir = join(ROOT, 'preview');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${name}.html`);
  writeFileSync(out, html);

  const results = runChecks(page, { strict: false, full: false }).filter((r) => r.status !== 'ok' || ['balance', 'names', 'includes', 'tokens'].includes(r.id));
  console.log(`parts in this preview: ${page.parts.join(', ')}`);
  printResults(results);
  console.log(`\nwrote ${out} (${kb(Buffer.byteLength(html))})`);
  console.log(pathToFileURL(out).href);
}

try { main(); } catch (e) { console.error(e.stack || String(e)); process.exitCode = 1; }
