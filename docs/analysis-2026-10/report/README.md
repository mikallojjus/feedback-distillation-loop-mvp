# Report: Claim tagger, analysis and path forward

The Geo-themed artifact for the analysis session (log: `../WORKLOG.md`, decisions: `../DECISIONS.md`). One HTML page with eight tabs, a Plain / Technical switch and a light/dark toggle, built from parts with plain Node (v22 or later; run on Node 26, built-ins only, no packages).

It reproduces the MVP report's pipeline, `../../mvp-2026-10/report/` (read only; never edit it from here): the same design system, `page.css`, `script.js`, checks and `--strict` gate. `build.mjs` and `preview.mjs` differ from the originals only in the title, the output file name and the usage and example text; `build.mjs` also adds one name to `EXTRA_NAMES` and the analysis vocabulary to `JARGON` (plan codes, workstream codes and similar working terms).

**State.** Round 1 applied (`CHANGES-ROUND-1.md`): `parts/02-summary.html` to `parts/07-path.html` and `parts/09-glossary.html` hold the report, with a short, picture-led Plain layer and the detail on Technical pages; there are no time estimates and no shorthand codes in the Plain layer. Round 2 of the editor review is applied (`../debate/dispositions.md`, ED-13 to ED-15): `parts/08-debate.html` holds the editor's debate, a Plain page (how it ran, the objections and decisions ED-1 to ED-15, the persona's Tuesday, where it ended) and a shortened Technical transcript (answers, the rest of the final reply, a note on the first draft); the full rounds stay in `../debate/`. Quoted persona text keeps to the page's no-time-words rule, so durations in it are replaced by [bracketed words]. `node build.mjs --strict` passes and the page stays under 450 KB (the four inlined fonts take about 175 KB of it; the page is 449.7 KB, within about 0.3 KB of the limit, so anything added needs something cut). `data/counts.json` holds every figure the parts cite, each with its source; keys that encode durations are kept for the record but unused (its `_unused` note lists them).

## Folder

```
build.mjs                        assemble claim-tagger-analysis.html and run the checks
preview.mjs                      build a single-tab preview into preview/
claim-tagger-analysis.html       the built page (generated; this is the file to publish)
data/counts.json                 numbers used as {{count:key}} in the text (edited by hand; every entry names its source)
design-system/                   the Geo design system, copied unchanged; do not edit
parts/01-header.html             header, Plain / Technical switch, theme toggle, tab rail (opens div.wrap and main)
parts/02-summary.html ... 08-debate.html   the seven content tabs: summary, features, debt, versions, questions, path, debate
parts/09-glossary.html           the Glossary tab (dt id="g-slug" entries)
parts/99-footer.html             closes main and div.wrap, footer text
parts/page.css, parts/script.js  page styles and behaviour, copied unchanged from the MVP report
parts/fragments/                 the inline SVG figures included into parts: loop-cycle (Summary, Minimal and optimal),
                                 skill-usage, notion-map, optimal-additions (Minimal and optimal), mirrors, tag-routing,
                                 inflow (Your questions), stage-plan, walkthrough (Path to editors); minimal-loop-figure.html
                                 is no longer included
plain-text.mjs                   the Plain layer as text, with characters per tab; it writes ../debate/inputs/report-plain.md
                                 unless --out names another file
preview/                         generated previews (git-ignored)
```

## Build and preview

```
node build.mjs                   writes claim-tagger-analysis.html, prints the checks, exits 0
node build.mjs --strict          the publish gate: any failed check exits 1 and the file is NOT written
node build.mjs --standalone      the page as a full HTML document in preview/full.html, to open every tab in a browser
node build.mjs --out some.html   write somewhere else
node preview.mjs summary         one tab (plus header, glossary, footer) in preview/02-summary.html; a part path works too
```

Run from this folder, or from the repo root as `node docs/analysis-2026-10/report/build.mjs`. The default file has the shape the Artifact tool expects: `<title>`, one `<style>`, the page content, one `<script>`, and no doctype, html, head, body or meta tags (the tool adds its skeleton at publish time). The build compiles `design-system/tokens.json` to CSS variables, inlines the four Calibre fonts, adds `bundle.css` and `page.css`, concatenates `parts/NN-*.html` in name order with includes expanded and `{{count:key}}` filled, removes comments, and appends `script.js`. Never publish a preview or a `--standalone` file.

## Checks

Printed after every build. Without `--strict` they only report; with `--strict` one failure exits 1.

| Check | Fails when |
|---|---|
| includes, placeholders, pending | an include target or a `{{count:key}}` entry is missing; a used entry has `"pending": true` (strict only) |
| personal names | a name from `agents/claim-tagger/config.json` (`anonymise.replacements`, first element of each pair) or the report owner's names appears in any part, css, script or counts file, comments included; there is no right word boundary, so a word that starts with a name also hits |
| jargon | the visible text holds a marker from the `JARGON` list in `build.mjs`, such as "this session" or "tonight" |
| glossary, citations, ids, links | a `dfn` has no `dt id="g-..."` or the reverse; a citation has no `id="src-..."`; an id repeats; an `href="#x"` has no target |
| tabs and pages | the rail and the `section[role="tabpanel"]` elements do not match, a `div.sub` lacks `id` or `data-title`, or a tab's first page is Technical |
| balance, colours, variables, script | tags are unbalanced; a literal colour sits outside a token; a `var(--x)` is undefined; `script.js` contains `</script` |
| TODO | any `TODO` text remains in a part or a comment (strict only; otherwise an info line with counts per file) |
| size | the file is over 16 MB, or `<title>` is not in the first 8 KB |

## Numbers

`{{count:claims}}` in a part is filled from `data/counts.json`. An entry is a plain value or `{ "value": 60, "source": "path: what was counted", "pending": false }`; groups nest and are addressed with dots (`{{count:group.key}}`); keys starting with `_` are ignored. `pending: true` marks a figure not measured yet, and `--strict` refuses a page that uses one. There is no collector script (the MVP's `collect-evidence.mjs` was not copied): add each key by hand, with its `source`.

## Publish

1. `node build.mjs --strict` must pass (no TODO text, no pending counts, no names).
2. Publish `claim-tagger-analysis.html` with the Artifact tool: `file_path` is that file, `icon` a generic word such as `report` on the first publish, `description` one sentence. Read the file first (the tool requires it). The tool prefers a short name as the page title: `TITLE` at the top of `build.mjs` sets the `<title>`, and the visible heading is the `h1` in `parts/01-header.html`.
3. Note the artifact URL in `../WORKLOG.md`. Every later publish passes `url` with that URL, so the link stays the same; do not pass `icon` again.
4. Keep the file shape: no doctype, html, head, body or meta tags.

## Writing the parts

- A tab is `<section id="x" role="tabpanel" aria-labelledby="tab-x">` (`hidden` on every tab but the first) holding an `h2`, an optional `<div class="plain">` (the short summary above the pages), `<div class="sub" id="x-page" data-title="Page name">` blocks as direct children, and `<aside class="terms" data-strip></aside>` last. Add `data-layer="tech"` to a page shown only in Technical mode; the first page must not be Technical. Two or more pages give a row of page buttons; one page gives none.
- The tab id is a contract in four places: the rail button in `01-header.html` (`id="tab-x"`, `aria-controls="x"`), the section (`id="x"`), the part's file name (`NN-x.html`, which is how `preview.mjs x` finds it) and every `#x` link. The glossary must stay `id="glossary"` in a file ending `-glossary.html`: `page.css` and `script.js` select `section#glossary`, and `preview.mjs` adds that file to every preview. The rail numbers itself; tab order is the order of the rail buttons.
- Mark a term where it first appears in a tab, `<dfn data-t="rulebook">rulebook</dfn>`, and add `<dt id="g-rulebook">rulebook</dt><dd>...</dd>` to the glossary. The script lists a tab's terms at its foot and sets the tooltips.
- Includes: `<!-- include: fragments/x.html -->` (path relative to `parts/`) is replaced by that file; nested includes work, up to six deep. Directives and `{{count:key}}` are expanded before comments are removed, so a directive written inside an HTML comment still includes the file (or fails the includes check): in a part, describe it in prose, never as a commented example. Fragments are not numbered parts.
- Components are the `geo-*` classes in `design-system/bundle.css`: `geo-callout`, `geo-stat-grid` with `geo-card`, `geo-table-wrap` with `geo-table geo-table-compact`, `geo-figure`, `geo-disclosure`. Prose is capped at `--measure` (92ch); tables, figures and code use the full column. Code is `<div class="geo-code"><pre>...</pre></div>` (escape `<` as `&lt;`).
- Tables: a numeric cell is `<td class="num">` (right aligned, tabular figures). It must be allowed to wrap: `page.css` sets `white-space:normal` on `td.num` because the research page forbade wrapping there and text overlapped in a wide table; do not add `nowrap` back. Header cells never wrap (`bundle.css`, `page.css`), so keep column headers short. For long text in several cells, add `packages` to the table's classes (fixed layout, left aligned).
- Colours only from role tokens (`var(--ink)`, `var(--ink-muted)`, `var(--accent)`, `var(--border)`, `var(--surface-raised)`, ...). An inline svg must not contain `<style>` or `<script>`; give it `role="img"` and an `aria-label`.
- Sentence case, no emoji, no personal names (use roles: the editor, the rule owner, the engineer). The working notes in `../` use first names; replace them with roles when text is copied into a part.

## Published

Version 1 published 2026-10-15 at https://claude.ai/artifact/3geEmJ3M3LsWJFE7PokF7M (title Claim tagger review, icon report). Republish to the same URL: publish the same file path from the original session, or pass the URL as url from another session. Read the page with the Artifact tool before republishing from a new session.
