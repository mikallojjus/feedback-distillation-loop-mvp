// Repository Markdown -> Notion-flavoured Markdown, the dialect the Notion connector's create-pages and update-page accept.
//
//   toNotionMarkdown(text)   -> the converted text
//   escapeInline(text)       -> text with the connector's special characters escaped (bold markers are kept)
//
// What differs from ordinary Markdown (from notion://docs/enhanced-markdown-spec): pipe tables do not exist; a table is a
// <table header-row="true"> block whose rows and cells are tab-indented <tr> and <td> elements holding rich text only.
// The characters \ ~ ` $ [ ] < > { } | ^ are escaped with a backslash in prose and cells; ** stays, because it is how bold
// is written. Empty lines are dropped by Notion, so none are emitted. Headings, bullets, numbered items and bold pass through.
// Used by the setup script for the structure proposal page and by the walkthrough builder for practice-page text.

const SPECIAL = /[\~`$[\]<>{}|^]/g;

export function escapeInline(text) {
  return String(text ?? '').replace(SPECIAL, (c) => `\\${c}`);
}

const isTableLine = (line) => /^\s*\|.*\|\s*$/.test(line);
const isSeparator = (line) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line);

function splitCells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function renderTable(rows) {
  const out = ['<table header-row="true">'];
  for (const cells of rows) {
    out.push('\t<tr>');
    for (const cell of cells) out.push(`\t\t<td>${escapeInline(cell)}</td>`);
    out.push('\t</tr>');
  }
  out.push('</table>');
  return out;
}

/** Convert repository Markdown (headings, paragraphs, bullets, pipe tables, bold) to the connector's dialect. */
export function toNotionMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (isTableLine(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const rows = [splitCells(line)];
      i += 2;
      while (i < lines.length && isTableLine(lines[i])) rows.push(splitCells(lines[i++]));
      const width = Math.max(...rows.map((r) => r.length));
      for (const r of rows) while (r.length < width) r.push('');
      out.push(...renderTable(rows));
      continue;
    }
    if (line.trim() === '') { i += 1; continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { out.push(`${heading[1]} ${escapeInline(heading[2])}`); i += 1; continue; }
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (bullet) { out.push(`- ${escapeInline(bullet[2])}`); i += 1; continue; }
    const numbered = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
    if (numbered) { out.push(`${numbered[2]}. ${escapeInline(numbered[3])}`); i += 1; continue; }
    out.push(escapeInline(line));
    i += 1;
  }
  return out.join('\n');
}
