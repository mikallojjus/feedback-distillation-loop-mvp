# Report: Editor feedback loop MVP

The Geo-themed artifact for the MVP (plan: `../plan.md`, section "Deliverables"). One HTML page with seven tabs, a Plain / Technical switch and a light/dark toggle. It is built from parts with plain Node (v22 or later; written and tested on Node 26, built-ins only, no packages).

## Folder

```
collect-evidence.mjs             read the evidence and write data/evidence.json and data/counts.json (run it before every build)
build.mjs                        assemble editor-feedback-loop-mvp.html and run the checks
preview.mjs                      build a single-tab preview into preview/
editor-feedback-loop-mvp.html    the built page (generated; this is the file to publish)
data/counts.json                 numbers used as {{count:key}} in the text (generated)
data/evidence.json               everything collect-evidence.mjs read, aggregated (generated; for checking a figure)
design-system/                   the Geo design system (tokens.json, bundle.css, fonts/); do not edit
parts/01-header.html             page header, Plain / Technical switch, theme toggle, tab rail (opens div.wrap and main)
parts/02-glance.html ... 07-decide.html   the six content tabs: glance, loop, notion, code, verify, decide
parts/08-glossary.html           the Glossary tab (dt id="g-slug" entries)
parts/99-footer.html             closes main and div.wrap, footer text
parts/page.css                   page styles (layout, prose width, code, tables)
parts/script.js                  tabs, pages, switch, term strips, theme toggle
parts/fragments/                 pieces included into parts: structure-figure.html (the loop and Notion tabs), sample-tables.html
                                 (real rows from the end-state snapshot), review-findings.html (the engineer review and the dispositions)
preview/                         generated previews (git-ignored)
```

## Build

```
node collect-evidence.mjs        refresh data/evidence.json and data/counts.json from the evidence (stops if a figure is missing)
node build.mjs                   writes editor-feedback-loop-mvp.html, prints the checks, exits 0
node build.mjs --strict          the publish gate: any failed check exits 1 and the file is NOT written
node build.mjs --standalone      the whole page inside a full HTML document (doctype, head, body), written to preview/full.html
                                 so you can open every tab in a browser; the publish file is not touched
node build.mjs --out some.html   write somewhere else
```

The default file has the shape the Artifact tool expects: `<title>`, one `<style>` (tokens, fonts, components, page styles), the page content, one `<script>`. It has no doctype, html, head, body or meta tags, because the tool wraps the file in its own skeleton at publish time (a second wrapper, or a viewport meta without `viewport-fit=cover`, would switch off the safe-area padding that skeleton adds). The file is about 385 KB, of which 175 KB are the four inlined Calibre fonts and about 160 KB the page content; the page itself starts after `</style>`.

What the build does, in order: compiles `design-system/tokens.json` to CSS variables (light on `:root`, dark under `prefers-color-scheme` guarded by `:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`; byte for byte what the research page's `build.py` produced), inlines the four `woff2` fonts as base64 `@font-face` rules, adds `design-system/bundle.css` and `parts/page.css`, concatenates `parts/NN-*.html` in name order, replaces `<!-- include: fragments/x.html -->` with that file (nested includes work), fills `{{count:key}}`, removes HTML comments from the page content, and appends `parts/script.js`.

## Preview

```
node preview.mjs parts/02-glance.html      writes preview/02-glance.html
node preview.mjs glance                    a tab id works too
node preview.mjs parts/fragments/structure-figure.html     a fragment (an svg is shown in a figure frame)
```

A preview is a full HTML document with the same styles and script, the header, the one part, the glossary (for the term strips and tooltips) and the footer. Open `preview/<name>.html` in a browser, switch Plain / Technical to see the technical pages, and toggle dark mode. The command prints the file URL. Never publish a preview or a `--standalone` file.

## Checks

Printed after every build. Without `--strict` they only report. With `--strict`, one failure exits 1.

| Check | Fails when |
|---|---|
| includes | an `<!-- include: -->` target does not exist |
| placeholders | a `{{count:key}}` has no entry in `data/counts.json` |
| pending counts | a `{{count:key}}` points at an entry with `"pending": true` (strict only; otherwise an info line) |
| personal names | a name from `agents/claim-tagger/config.json` (`anonymise.replacements`, first element of each pair) or the report owner's first or full name appears in any part, fragment, css, script or counts file; comments count |
| jargon | the visible text contains a marker from the `JARGON` list at the top of `build.mjs` (edit the list there) |
| glossary | a `<dfn data-t="x">` has no `<dt id="g-x">`, or a `dt` is never marked |
| citations | an `<a class="cite" href="#src-...">` has no `id="src-..."` |
| ids and links | an id appears twice, or an `href="#x"` has no target |
| tabs and pages | the rail and the `section[role="tabpanel"]` elements do not match, a `div.sub` lacks `id` or `data-title`, or the first page of a tab is Technical |
| balance | opening and closing tags differ in count |
| colours | `page.css` has a hex colour or an `rgb()`/`hsl()` call outside a custom-property definition, or the markup has a literal colour (hex, rgb, hsl or a colour name) in a `fill`, `stroke` or `style` attribute; use role tokens such as `var(--ink)` |
| variables | a `var(--x)` has no definition |
| script | `script.js` contains `</script` |
| TODO | any `TODO` text remains (strict only; otherwise an info line with counts per file) |
| size | the file is over 16 MB, or `<title>` is not in the first 8 KB |

## Numbers

Write `{{count:claims}}` anywhere in a part or fragment. `data/counts.json` maps keys to values; `collect-evidence.mjs` writes it, so never edit it by hand:

```json
{
  "claims": { "value": 60, "source": "docs/mvp-2026-10/evidence/notion/00-seeded/claims.jsonl: rows" },
  "tagRun": { "rowsCreated": { "value": 40, "source": "docs/mvp-2026-10/evidence/notion/02-tag-r1/propose.json: rows_created" } },
  "cost": { "tagRun": { "value": "2.06", "source": "agents/claim-tagger/runs/20261013T1800Z-tag-r1/run.json: cost_usd" } }
}
```

A key is a plain value or `{ value, source, pending }`; groups nest and are addressed with dots (`{{count:tagRun.rowsCreated}}`); keys starting with `_` are ignored. `pending: true` marks a figure that is not measured yet: the build says so, and `--strict` refuses to build while a page uses it. Integers of 1,000 or more get thousands separators. Values are HTML-escaped. Money is written as a string with two decimals and accuracy changes as signed strings in points ("+36.4"), so the page shows them as the cards do. Every figure carries its `source`; a figure the collector cannot find stops it with a message instead of a guess. One figure is recorded rather than derived: the unit-test count, with the commit it was measured on (`UNIT_TESTS` at the top of `collect-evidence.mjs`); after a new `node --test tests/` run on a clean copy of a commit, update both fields.

The groups: top-level figures (claims, decisions, canaries, cases, gate runs, applies, judgments, unit tests), `tagRun`, `baseline`, `gate.<card>` (one per gate card: `ls1a1` to `ls1a5`, `ls2`), `best` (the LS-1 card with the most confirmed fixes), `wording`, `cost`, `headless`, `seed`, `stage.<snapshot>`, `direction.end`, `end` (the end-state snapshot), `review` and `config` (the settings in `agents/claim-tagger/config.json`).

Where the figures come from:

| Figure | Source |
|---|---|
| tags in the rulebook, judged tags, the live version | `agents/claim-tagger/rubric/rubric.json` (`tag_count`, `judged_count`, `rubric_version`) |
| seed strata, seeded decisions, excluded rows, check-by-hand rows | `agents/claim-tagger/evals/seed/seed-report.json` |
| canaries and regression cases | `agents/claim-tagger/evals/canaries.jsonl`, `cases.jsonl` |
| Notion state after each step (Stage, Direction, lessons, runs, rulebook, settings) | `docs/mvp-2026-10/evidence/notion/<nn>-<label>/` (the queue, claims, lessons, runs, rulebook and settings files) |
| the tag run's queue figures | `docs/mvp-2026-10/evidence/notion/02-tag-r1/propose.json` |
| gate verdicts, intervals, fixes, reconfirmation, costs | `docs/mvp-2026-10/evidence/cards/<card>/card.json` |
| judgments, errors, model costs | `agents/claim-tagger/runs/*/run.json` (git-ignored, on the machine that ran the trial) |
| applies, writes landed, editor fields touched | `agents/claim-tagger/runs/*/verify.json` (git-ignored) |
| headless sessions | `docs/mvp-2026-10/evidence/headless/*.summary.md` |
| persona writes, Editor wording lengths | `docs/mvp-2026-10/evidence/persona-editor-actions.json` |
| editor review severities | `docs/mvp-2026-10/review/persona-editor-r1.md` (the findings table) |
| gate, judge, queue and distill settings | `agents/claim-tagger/config.json` |

Long verbatim records (the sample rows in `parts/fragments/sample-tables.html`, the result card on the Notion walkthrough, claim and rule texts) are quoted from the evidence files named in their comments; figures inside them that `counts.json` also holds are filled from it.

## Publish

1. `node build.mjs --strict` must pass (no TODO text, no pending counts, no names).
2. Publish `editor-feedback-loop-mvp.html` with the Artifact tool: `file_path` is that file, `icon` is a generic word such as `report` on the first publish, `description` is one sentence (for example "How the claim tagger learns from editor decisions: what was built in October 2026, how it was checked, and what to decide next."). Read the file before publishing (the tool requires it).
3. Note the artifact URL in `../STATE.md`. Every later publish passes `url` with that URL, so the link stays the same ("published once and republished to the same URL" in the plan). Do not pass `icon` again.
4. Keep the file shape: no doctype, html, head, body or meta tags (the build does not add them).

## Writing the parts

- A tab is `<section id="x" role="tabpanel" aria-labelledby="tab-x">` with an `h2`, an optional `<div class="plain">` (the short summary above the pages), `<div class="sub" id="x-page" data-title="Page name">` blocks (add `data-layer="tech"` for a page that shows only in Technical mode; the first page must not be Technical), and `<aside class="terms" data-strip></aside>` at the end. The tab id must match the rail button in `01-header.html` (`aria-controls`, and `tab-x` for the id).
- A page row is built from the `div.sub` blocks; a deep link is `#x-page`. Glossary entries are reachable as `#g-slug`.
- Mark a term where it first appears in a tab: `<dfn data-t="rulebook">rulebook</dfn>`, and add `<dt id="g-rulebook">rulebook</dt><dd>...</dd>` to `08-glossary.html`. The build checks both directions; the script lists the terms at the foot of each tab and sets the tooltip.
- Components are the `geo-*` classes in `design-system/bundle.css`: `geo-callout`, `geo-stat-grid` with `geo-card`, `geo-table-wrap` with `geo-table geo-table-compact`, `geo-figure` with `geo-figure-frame` and `geo-figure-caption`, `geo-disclosure`. A numeric cell is `<td class="num">` (right aligned, wraps when the text is long). Code is `<div class="geo-code"><pre>...</pre></div>` (full column width, scrolls sideways only when a line is longer; escape `<` as `&lt;`).
- Prose is capped at `--measure` (92ch, defined at the top of `parts/page.css`: about 890 px at the 18 px body size, 990 px for the 20 px lede). Tables, figures and code use the full column (1,196 px at the widest: 1,480 px shell, less 32 px of side padding, the 220 px rail and a 32 px gap).
- Colours only from role tokens (`var(--ink)`, `var(--ink-muted)`, `var(--accent)`, `var(--border)`, `var(--surface-raised)`, ...), so the page works in both themes. An inline svg must not contain `<style>` or `<script>`; give it `role="img"` and an `aria-label`, and use its figure caption to say what it shows.
- Sentence case everywhere, no emoji, no personal names (use roles: the editor, the rule owner, the engineer).
