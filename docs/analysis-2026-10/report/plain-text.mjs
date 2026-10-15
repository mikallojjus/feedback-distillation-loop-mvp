#!/usr/bin/env node
// Extract the Plain layer of the built report as readable text (for reviews that should not see markup).
//
//   node docs/analysis-2026-10/report/plain-text.mjs [--all] [--out <file>]
//
// Reads claim-tagger-analysis.html next to this file. Keeps every tab section and, inside it, every sub-page
// that is not marked data-layer="tech" (pass --all to keep the technical pages too). Headings become "#" lines,
// table rows become "cell | cell" lines, list items become "- " lines, dfn/strong/em marks are dropped.
// Writes ../debate/inputs/report-plain.md by default and prints a per-tab size summary.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const all = args.includes('--all');
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? resolve(args[outIdx + 1]) : join(here, '..', 'debate', 'inputs', all ? 'report-all.md' : 'report-plain.md');

const html = readFileSync(join(here, 'claim-tagger-analysis.html'), 'utf8');
const body = html.slice(html.indexOf('<main'), html.lastIndexOf('</main>'));

const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

function textOf(fragment) {
  let s = fragment;
  s = s.replace(/<svg[\s\S]*?<\/svg>/g, '[figure]');
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
  s = s.replace(/<\/?(h[1-6])[^>]*>/g, (m) => (m.startsWith('</') ? '\n' : '\n# '));
  s = s.replace(/<\/(p|div|section|li|tr|table|dt|dd|blockquote|figure|figcaption|details|summary)>/g, '\n');
  s = s.replace(/<li[^>]*>/g, '- ');
  s = s.replace(/<\/(td|th)>\s*<(td|th)[^>]*>/g, ' | ');
  s = s.replace(/<br\s*\/?>/g, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decode(s);
  s = s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '').join('\n');
  return s;
}

const sections = [...body.matchAll(/<section\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)];
const pieces = [];
const summary = [];
for (const [, id, inner] of sections) {
  const title = (inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1];
  const subs = [...inner.matchAll(/<div\b[^>]*\bclass="sub"[^>]*>/g)];
  let kept = '';
  for (let i = 0; i < subs.length; i += 1) {
    const open = subs[i];
    const start = open.index + open[0].length;
    const end = i + 1 < subs.length ? subs[i + 1].index : inner.lastIndexOf('<aside');
    const attrs = open[0];
    const tech = /data-layer="tech"/.test(attrs);
    if (tech && !all) continue;
    const pageTitle = (attrs.match(/data-title="([^"]*)"/) || [])[1] || '';
    kept += `\n## ${pageTitle}${tech ? ' (technical)' : ''}\n` + textOf(inner.slice(start, end)) + '\n';
  }
  const block = `# Tab: ${textOf(title || id)}\n${kept}`;
  pieces.push(block);
  summary.push(`${id}: ${block.length} chars, ${subs.filter((s) => all || !/data-layer="tech"/.test(s[0])).length} pages`);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `# Report text, ${all ? 'all layers' : 'Plain layer only'} (generated from claim-tagger-analysis.html)\n\n${pieces.join('\n\n')}\n`);
console.log(`${out}\n${summary.join('\n')}`);
