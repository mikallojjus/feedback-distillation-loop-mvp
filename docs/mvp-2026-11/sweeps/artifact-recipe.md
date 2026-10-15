# Artifact recipe: building a Geo report page

Digest of the build in `docs/analysis-2026-10/report/` (the claim-tagger analysis report), for a builder who makes a new four-tab page from it. Written 2026-10-15.

**Read:** `report/README.md`, `build.mjs`, `design-system/README.md`, `design-system/tokens.json`, `bundle.css`, `bundle.js`, `parts/01-header.html`, `parts/02-summary.html`, `parts/99-footer.html`, `parts/page.css`, `parts/script.js`, the fragment headers, `data/counts.json` (its notes and format), and the callout, disclosure and glossary markup in parts 06, 08 and 09. `preview.mjs` and `plain-text.mjs` were checked for their imports only.

**Verified:** the build was run twice into the session scratchpad with `--out`, once plain and once `--strict`. Both exit 0 and every check is ok. The repo's own output was not rebuilt. The current output is 460,446 bytes (449.7 KB, the build's KB is 1024 bytes), the same size as the existing `claim-tagger-analysis.html`.

"Four-tab" is read here as four rail buttons. If the glossary is one of them, the page has three content tabs.

---

## 1. Starting a new artifact from this recipe

### 1.1 Folder and depth

- Create the new folder at `docs/<name>/report/`, for example `docs/mvp-2026-11/report/`. The depth matters: build.mjs line 38 finds the names config with `resolve(ROOT, '..', '..', '..', 'agents', 'claim-tagger', 'config.json')`. Any other depth makes the names check fail to run, and `--strict` counts that as a failure.
- Use this folder as the template. `docs/mvp-2026-10/report/` is the original of the same pipeline and is read only.

### 1.2 What is in the folder and what to copy

| Path | What it is | For a new page |
|---|---|---|
| `build.mjs` | assembles the page and runs the checks (about 27 KB) | copy, then edit (1.3) |
| `preview.mjs` | one tab into `preview/` for a quick look | copy if wanted. It imports `ROOT, PARTS, TITLE, buildPage, loadCounts, partFiles, read, rel, runChecks, printResults, toDocument` from build.mjs (line 17), so keep those exports |
| `plain-text.mjs` | writes the Plain layer as text; default output `../debate/inputs/report-plain.md` | analysis only: drop it or change its output path. It imports only built-ins |
| `design-system/` | tokens.json, bundle.css, bundle.js, `fonts/` (four woff2 files), README.md | copy the whole folder unchanged |
| `parts/page.css`, `parts/script.js` | page styles and behaviour | copy unchanged. Their header comments still say "Editor feedback loop MVP" |
| `parts/01-header.html`, `parts/99-footer.html` | header and tab rail; footer | copy, then rewrite (section 2.1) |
| `parts/NN-tab.html` | one file per tab | write new |
| `parts/fragments/` | inline SVG figures (below) | copy only the figures the page uses |
| `data/counts.json` | numbers for `{{count:key}}` (42.5 KB) | write new (2.9). Not needed if no placeholder is used |
| `.gitignore` | ignores `preview/` | copy |
| `README.md`, `CHANGES-ROUND-1.md`, `review-readability.md`, `claim-tagger-analysis.html`, `preview/` | this report's notes, its output and previews | do not copy |

Fragments in `parts/fragments/` (each is one inline `<svg>`, pulled into a part by an include directive):

- `loop-cycle-figure.html`: the minimal loop as a cycle of six steps. Included by 02-summary and 05-versions.
- `skill-usage-figure.html`: the editor's commands and Notion steps in two lanes. Included by 05-versions.
- `notion-map-figure.html`: which Notion tables the agent writes and which it only reads. Included by 05-versions.
- `optimal-additions-figure.html`: the optimal version drawn on the minimal loop. Included by 05-versions.
- `mirrors-figure.html`: one rulebook and several claims tables. Included by 06-questions.
- `tag-routing-figure.html`: which tags go to the text pass, the source pass, code or a search. Included by 06-questions.
- `inflow-figure.html`: how many rows reach the editor in a first full pass. Included by 06-questions.
- `stage-plan-figure.html`: the plan in stages, with lanes for each person and the machine. Included by 07-path.
- `walkthrough-figure.html`: the seven steps of the walkthrough on a practice page. Included by 07-path.
- `minimal-loop-figure.html`: an earlier minimal-loop picture. No part includes it (the README says it is no longer used).

`data/counts.json`: one file of numbers with a `source` for each. The parts use 301 distinct keys; the file holds more, and its `_unused` note lists keys kept for the record. Keys starting with `_` are notes and are ignored.

### 1.3 Edits to build.mjs

| Line | Name | Now | Change |
|---|---|---|---|
| 36 | `OUT` | `claim-tagger-analysis.html`, in the folder | the file name of the new page. This is the file to publish |
| 37 | `TITLE` | `'Claim tagger review'` | the `<title>` of the new page: a short name. The visible heading is the h1 in 01-header.html |
| 38 | `CONFIG` | three levels up to `agents/claim-tagger/config.json` | keep, unless the folder depth changes |
| 41 | `EXTRA_NAMES` | the report owner's first names | keep them, because the names check needs them. Never write them into a part |
| 43-44 | `JARGON` | session words, tool names and this report's working codes | keep the session words and tool names. Replace the codes (`P1`-`P3`, `W1`-`W5`, `sweep-`, `lobster`, `Insight`) with the new report's own, or drop them |
| 1-27, 49-54 | header comment, `USAGE` | describe this report | rewrite the description and usage text |

The rest of build.mjs (token compile, font inlining, includes, counts, checks) is generic. Leave it alone.

### 1.4 Parts, names and order

- A part is `parts/NN-name.html`, with two digits. `partFiles()` (line 151) takes files matching `^\d\d-.*\.html$` and sorts them by name, so the header (01) comes first and the footer (99) last. Fragments are not parts: they live in `parts/fragments/` and come in by an include directive.
- A tab's id is a contract in four places. Use the same `x` in all four: the rail button in 01-header (`id="tab-x"`, `aria-controls="x"`); the panel (`<section id="x" role="tabpanel" aria-labelledby="tab-x">`); the file name `NN-x.html` (preview.mjs finds a tab by it); and every `href="#x"` that points at it.
- The glossary is `id="glossary"` in a file ending `-glossary.html`. page.css and script.js select `section#glossary`, and preview.mjs adds that file to every preview.
- Tab order is the rail order. script.js rewrites the rail numbers to 1 to n, so the typed numbers in the header are only a fallback.
- A normal build writes `OUT` in the folder. `--out` writes elsewhere for one run.

### 1.5 Four-tab checklist

1. Make the folder (1.1) and copy the files in 1.2.
2. Edit build.mjs (1.3).
3. Write `parts/01-header.html` from 2.1: the h1, eyebrow and sub, then four `button.geo-sidenav-item` rail buttons with the ids and `aria-controls` of your tabs.
4. Write one `parts/NN-tab.html` per content tab (2.2). Each tab's first page is Plain.
5. If the text marks any term with `dfn` (2.8), write the glossary part. It is a rail tab too: it counts as one of the four, or it is a fifth tab if you want four content tabs.
6. Write `parts/99-footer.html`, and `data/counts.json` with a source for each key used (2.9).
7. Run the build (1.6) until `--strict` passes, then publish (1.7).

### 1.6 Build and checks

```text
node build.mjs                 writes OUT and prints the checks; a failing check still writes the file
node build.mjs --strict        any failing check: exit 1 and nothing is written. This is the publish gate
node build.mjs --standalone    a full HTML document in preview/full.html for a browser. Never publish it
node build.mjs --out x.html    write to another file, for one run
node preview.mjs <tab>         one tab plus header, glossary and footer, in preview/NN-tab.html
```

Run from the folder, or from the repo root as `node docs/<name>/report/build.mjs`. It needs Node 22 or later and uses built-ins only. The output lists the parts, the size of each block, and every check.

The checks are in `runChecks` (build.mjs line 276). "Strict only" checks print as information without `--strict`. "Full" checks are skipped in single-tab previews.

| Check | What it enforces |
|---|---|
| includes | every `<!-- include: ... -->` target exists under `parts/`; no loops; nesting at most six deep |
| tokens | no `{{count:...}}` left in the visible text, that is, a key with no entry in counts.json |
| pending | (strict only) no count in use with `"pending": true` |
| names | no name from the config's `anonymise.replacements` (first element of each pair) and none from EXTRA_NAMES, in any part, included fragment, page.css, script.js or counts.json. Comments are included. The match is a prefix match with no word boundary. The check fails if the config cannot be read |
| jargon | no JARGON marker in the visible text: a case-insensitive substring match |
| glossary-entries, glossary-marked | (full) every `dfn data-t="x"` has `dt id="g-x"`, and every glossary entry is marked at least once |
| cites | (full) every citation link `a.cite` points at an element with `id="src-..."`. This report has none |
| ids | (full) no duplicate id across the whole page |
| links | (full) every `href="#x"` has a target `id="x"` |
| tabs | (full) rail buttons (`button role="tab"`) and panels (`section role="tabpanel"`) match both ways; each `div.sub` has `id` and `data-title`; a tab's first page is not Technical |
| balance | open and close tags match for the listed elements (div, section, table, dl, dt, dd, figure, svg, dfn and others). Void tags are not counted |
| colours | page.css: no `#` followed by 3 to 8 hex digits, and no rgb, hsl or oklch function outside a `--name:` definition. Body: no literal `fill`, `stroke`, `color` attribute, and no colour in a style attribute |
| vars | every `var(--x)` in the CSS or the body is defined in the CSS |
| script | script.js contains no `</script` and no `<!--` |
| todo | (strict only) no TODO text in parts or included fragments, comments included |
| size | the file is at most 16 MB, and `<title>` begins within the first 8 KB |

### 1.7 Publish (from the README)

1. `node build.mjs --strict` passes. Publish only the file it writes.
2. Read the output file with the Artifact tool first, because the tool requires a read. Then publish with `file_path` set to that file, `icon` on the first publish only (one generic word, such as `report`), and `description` as one sentence. Without `url`, the publish creates a new artifact.
3. Later publishes pass `url` (this artifact's own URL) and no `icon`.
4. Never pass the Claim tagger review's URL (the README lists it): that overwrites that page. Record the new URL in the project log.
5. Keep the file shape described in section 5.

---

## 2. HTML conventions (templates)

Each template is copied from a part in this folder. `…` stands for text left out.

### 2.1 Header: 01-header.html (verbatim)

```html
<div class="wrap">
<a class="skip-link" href="#main">Skip to content</a>
<header class="geo-pageheader">
  <div class="geo-pageheader-main">
    <div class="geo-eyebrow">Geo content team · Analysis report · October 2026</div>
    <h1 class="geo-pageheader-title">Claim tagger: analysis and path forward</h1>
    <p class="geo-pageheader-sub">A review of the claim tagger after the October 2026 MVP: which features to keep, where the debt and bugs are, a minimal and an optimal version, and the path to editors.</p>
    <div class="header-controls">
      <div class="geo-pill-group layer-switch" id="layer-switch" role="group" aria-label="Reading level">
        <button type="button" class="geo-pill" data-v="plain" aria-pressed="true">Plain</button>
        <button type="button" class="geo-pill" data-v="tech" aria-pressed="false">Technical</button>
      </div>
      <span class="layer-hint" id="layer-hint">Plain: each tab shows its overview pages. Switch to Technical for the detailed pages.</span>
      <label class="geo-checkbox-label theme-switch"><button type="button" class="geo-toggle" role="switch" id="theme-toggle" aria-checked="false" aria-label="Dark mode"><span class="geo-toggle-knob"></span></button><span class="geo-icon theme-icon" id="theme-icon-sun" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="3" stroke="currentColor"/><path d="M8 0.5V2.5M8 13.5V15.5M0.5 8H2.5M13.5 8H15.5M2.7 2.7L4.1 4.1M11.9 11.9L13.3 13.3M2.7 13.3L4.1 11.9M11.9 4.1L13.3 2.7" stroke="currentColor" stroke-linecap="round"/></svg></span><span class="geo-icon theme-icon" id="theme-icon-moon" aria-hidden="true" hidden><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.5 9.5C12.7 12.4 10.2 14.5 7.3 14.5C3.9 14.5 1.5 11.8 1.5 8.6C1.5 5.6 3.7 3 6.5 2.5C5.9 3.4 5.6 4.5 5.6 5.6C5.6 8.7 8.1 11.1 11.1 11.1C12 11.1 12.8 10.6 13.5 9.5Z" stroke="currentColor" stroke-linejoin="round"/></svg></span></label>
    </div>
  </div>
</header>

<nav class="geo-sidenav" role="tablist" aria-orientation="vertical" aria-label="Sections">
  <button type="button" class="geo-sidenav-item" role="tab" id="tab-summary" aria-controls="summary" aria-selected="true"><span class="geo-sidenav-num">1</span>Summary</button>
  <button type="button" class="geo-sidenav-item" role="tab" id="tab-features" aria-controls="features" aria-selected="false"><span class="geo-sidenav-num">2</span>Features ranked</button>
  <button type="button" class="geo-sidenav-item" role="tab" id="tab-debt" aria-controls="debt" aria-selected="false"><span class="geo-sidenav-num">3</span>Debt and bugs</button>
  <button type="button" class="geo-sidenav-item" role="tab" id="tab-versions" aria-controls="versions" aria-selected="false"><span class="geo-sidenav-num">4</span>Minimal and optimal</button>
  <button type="button" class="geo-sidenav-item" role="tab" id="tab-questions" aria-controls="questions" aria-selected="false"><span class="geo-sidenav-num">5</span>Your questions</button>
  <button type="button" class="geo-sidenav-item" role="tab" id="tab-path" aria-controls="path" aria-selected="false"><span class="geo-sidenav-num">6</span>Path to editors</button>
  <button type="button" class="geo-sidenav-item" role="tab" id="tab-debate" aria-controls="debate" aria-selected="false"><span class="geo-sidenav-num">7</span>Editor's debate</button>
  <button type="button" class="geo-sidenav-item" role="tab" id="tab-glossary" aria-controls="glossary" aria-selected="false"><span class="geo-sidenav-num">8</span>Glossary</button>
</nav>

<main id="main">
```

Notes: the `<div class="wrap">` opened here is closed by 99-footer.html, which also closes `<main>`. The h1 is the visible title. The ids `layer-switch`, `layer-hint`, `theme-toggle`, `theme-icon-sun` and `theme-icon-moon` are used by script.js. The rail is `nav.geo-sidenav[role=tablist]` and each button is a real `<button role="tab">`, which the tabs check needs.

Footer (99-footer.html, verbatim):

```html
</main>

<footer>Built in October 2026 for the Geo content team. The working notes, findings and designs behind this report are in the repository, folder <code>docs/analysis-2026-10</code>.</footer>
</div>
```

### 2.2 A tab section (02-summary.html)

```html
<!-- ============================== 1 SUMMARY ============================== -->
<section id="summary" role="tabpanel" aria-labelledby="tab-summary">
<h2>Summary</h2>

<div class="plain">
<p class="geo-eyebrow plain-label">The answer</p>
<p>…</p>
</div>

<div class="sub" id="summary-loop" data-title="The loop">
<h3>The loop in one picture</h3>
…
</div>

<div class="sub" id="summary-decisions" data-title="Decisions" data-layer="tech">
…
</div>

<aside class="terms" data-strip></aside>
</section>
```

- Every tab but the first carries `hidden` on its section, as in `<section id="features" role="tabpanel" aria-labelledby="tab-features" hidden>` (03-features.html line 2). The script sets the same attribute, so the page still works without it.
- `div.plain` is the short Plain summary above the pages. Six of the eight tabs have one; the debate and glossary tabs do not.
- Pages are `div.sub` blocks that are direct children of the section, because script.js reads `section.children`. With two or more pages, script.js builds a row of page buttons above the first page, labelled with `data-title`. With one page there is no row.
- A page id is a deep link (`#summary-loop`), so ids must be unique across the whole page.
- `aside.terms[data-strip]` goes last. script.js fills it with the tab's marked terms (2.8).

### 2.3 Page counts in this report

40 pages in all: 20 Plain and 20 Technical, across eight tabs (the glossary has a Main terms page and a Technical terms page). Every tab's first page is Plain.

### 2.4 A geo-* card (02-summary.html line 57, verbatim)

```html
<div class="geo-stat-grid">
<div class="geo-card"><div class="geo-stat-value">{{count:tags.readyNow}}</div><div class="geo-stat-label"><strong>Ready now</strong>: Context-dependent; Unsourced, by code</div></div>
</div>
```

### 2.5 A table (02-summary.html lines 63-67, verbatim, rows trimmed)

```html
<div class="geo-table-wrap"><table class="geo-table geo-table-compact packages">
<colgroup><col style="width:52%"><col style="width:24%"><col style="width:24%"></colgroup>
<thead><tr><th>What</th><th>Today (the MVP)</th><th>Minimal version</th></tr></thead>
<tbody>
<tr><td>Scripts</td><td class="num">{{count:code.scripts}}</td><td class="num">{{count:code.minimalScripts}}</td></tr>
…
</tbody>
</table></div>
```

- Wrap every table in `div.geo-table-wrap`. The table takes `geo-table geo-table-compact`. Set column widths with `col style` if needed.
- `packages` (41 of this report's 53 tables) gives a fixed layout, left-aligned text, and long cells that wrap. Use it for tables with long text in several cells.
- A numeric cell is `<td class="num">`: right-aligned, tabular figures. It must wrap, so never add `nowrap`. Header cells never wrap, so keep column headings short.
- A table caption is written as `<caption><strong>Where to read next</strong></caption>` (02-summary line 77).
- Status marks sit in cells or headings as `<span class="mark mark-yes">Keep</span>` (02-summary line 11). `mark-part` is a warning dot and `mark-no` a danger dot; the label stays in ink.

### 2.6 A figure with role tokens

Part (02-summary.html lines 44-49, verbatim):

```html
<figure class="geo-figure">
<div class="geo-figure-frame">
<!-- include: fragments/loop-cycle-figure.html -->
</div>
<figcaption class="geo-figure-caption">The loop in six steps. People decide in steps 3 and 5; the agent does the rest; nothing changes a <dfn data-t="rule">rule</dfn> unless the gate passes.</figcaption>
</figure>
```

The include directive is an HTML comment. The build replaces it with the file, and it does so even inside a comment, so write it only as markup, never as an example in prose.

Fragment opening (loop-cycle-figure.html, lines 6-8, verbatim except for the elided aria-label):

```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 420" width="100%" role="img" aria-label="…">
<rect x="4" y="8" width="952" height="374" rx="12" fill="none" stroke="var(--border)" stroke-width="1.5" stroke-dasharray="6 5"/>
<g fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-linejoin="round">
```

Rules, from the fragment's own usage comment and the checks:
- Colours come only from role tokens: `var(--ink)`, `var(--ink-muted)`, `var(--accent)`, `var(--border)`, `var(--border-control)`, `var(--surface-raised)`, `var(--surface-sunken)`. Presentation attributes such as `fill="var(--ink)"` pass the colour check, but the build checks syntax, not rendering. Look at both themes in a browser after any change.
- The svg has `role="img"` and an `aria-label` that describes the picture in words. The label may contain `{{count:...}}` placeholders, which the build fills.
- No `<style>` or `<script>` inside the svg, and no ids inside.
- The figure caption is in plain words. Fragments may open with a usage comment; the build strips it.

### 2.7 A callout (06-questions.html lines 19-21, verbatim, text trimmed)

```html
<div class="geo-callout"><div class="geo-callout-body">
<p><strong>Short answer.</strong> …</p>
</div></div>
```

All seven callouts in this report use the default tone. The bundle also has `geo-callout-warning`, `geo-callout-success` and `geo-callout-neutral` (section 3.2).

### 2.8 Glossary: marking a term

In the text (02-summary.html line 7):

```html
<dfn data-t="tag">tag</dfn>
```

In the glossary part (09-glossary.html lines 11-12, verbatim):

```html
<dl class="geo-glossary">
<dt id="g-adaptive-runs">adaptive runs</dt><dd>Judging each claim once and again only for the answers the judge was unsure about, at most {{count:adaptive.capShare}} of a run's claims, instead of three runs for every answer. Decided on 14 October.</dd>
```

Rules:
- The `data-t` value is the dt id without the `g-` prefix. Each mark needs an entry, and each entry needs at least one mark (the two glossary checks).
- page.css adds the asterisk after a mark. script.js sets the mark's tooltip from the entry, and on each tab lists the tab's marked terms at its foot, in `aside.terms`, under "Terms marked * on this tab".
- This report has 235 marks in the text and 105 entries. The glossary has two pages: Main terms, and Technical terms with `data-layer="tech"`.

### 2.9 Count placeholders and data/counts.json

- In text, anywhere, write `{{count:tags.readyNow}}`. Dots address groups. Placeholders also work inside attributes, such as figure aria-labels.
- The file is `data/counts.json`, edited by hand. Each entry is a plain value, or an object with `value`, `source` and optional `pending`. Groups nest. Verbatim entry (counts.json line 8):

```json
"scripts": { "value": 22, "source": "agents/claim-tagger/scripts/*.mjs at commit d195bd4, counted with ls: 21 runnable scripts plus allowlist.mjs" },
```

  That key is `code.scripts` because it sits in the group `"code": { ... }`.
- `"pending": true` marks a figure that is not measured yet. Strict refuses a page that uses it.
- Formatting: whole numbers of 1000 or more get en-US separators (`2351` shows as `2,351`). Other values appear as text, HTML-escaped. Quote a number that has decimals, as the file does for `"13.88"`.
- Every key used needs an entry. A missing key leaves the placeholder in the text, and the tokens check fails.

### 2.10 The Plain and Technical switch

The switch is in the header (2.1, lines 9-12). Each Technical page is marked on its `div.sub` (02-summary.html line 90, verbatim):

```html
<div class="sub" id="summary-decisions" data-title="Decisions" data-layer="tech">
```

Rules:
- A Technical page has `data-layer="tech"`. Plain mode hides Technical pages and their page buttons. Technical mode shows them. A link to a Technical page switches the viewer to Technical.
- The first page of every tab must be Plain (the tabs check).
- The choice is kept in the viewer's browser only, under the key `efl-mvp-layer`.
- Folded sections: page.css and script.js support `details.tech`, which opens and closes with the switch, but no part in this report uses it. The report uses Technical pages instead.

A disclosure that is always available (08-debate.html lines 51-53, verbatim, with the body elided):

```html
<details class="geo-disclosure">
<summary><span>Round 1: reading the first draft</span><span class="geo-disclosure-chevron" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M1 5L8 12L15 5" stroke="currentColor" stroke-linecap="round"/></svg></span></summary>
<div class="geo-disclosure-body">
…
</div>
</details>
```

---

## 3. The design-system bundle

### 3.1 What the files are

- `design-system/bundle.css` (22.9 KB) is inlined into the page. Static HTML uses the `geo-*` classes, and every rule uses role tokens.
- `design-system/bundle.js` (18.1 KB) holds React 18 wrappers on `window.Geo`: 23 components and an `iconNames` list. It is not embedded. build.mjs reads only bundle.css, and the page loads no React. Use the class markup in 3.2 and do not use `window.Geo`.
- The design README calls the stylesheet `components/bundle.css`. The file is `design-system/bundle.css`.

### 3.2 The 23 components

Props are the React props in bundle.js. Static markup is the class and ARIA markup that the same component produces, usable in plain HTML. "In this report" says whether a part uses it.

| Component | Static markup | Props (bundle.js) | In this report |
|---|---|---|---|
| Button | `button.geo-btn` with `geo-btn-primary`, `-secondary`, `-tertiary`, `-ghost`, `-transparent`, `-success`, `-error`, `-done`; `geo-btn-small`; `geo-btn-text`; `geo-btn-disabled` | `variant` (default `primary`, or `text`), `small`, `icon`, `disabled`, `className`; other props go to the button | no |
| Tag | `span.geo-tag` | `className` | no |
| Badge | `span.geo-badge`, with `geo-badge-new` | `tone` (`new`), `className` | no |
| Chip | `span.geo-chip` (an `a` when given an href, a `button` when given onClick) | `href`, `onClick`, `className` | no |
| StatusChip | `span.geo-status.geo-status-{severe, high, medium, low, done}` with `span.geo-status-dot` | `tone` (default `low`), `title`, `className` | no (cells use `span.mark`) |
| PillToggle | `div.geo-pill-group` with `button.geo-pill[aria-pressed]`, `geo-pill-label`, `geo-pill-count` | `options` (`[{value, label, count}]`), `value`, `onChange`, `label`, `className` | yes: the Plain / Technical switch |
| Tabs | `div.geo-tabs` > `div.geo-tabs-row[role=tablist]` > `button.geo-tab[role=tab][aria-selected]` | `tabs` (`[{value, label, badge, disabled}]`), `value`, `onChange`, `label`, `className` | not used as a component; script.js builds the page row from the same classes |
| SideNav | `nav.geo-sidenav[role=tablist]` > `button.geo-sidenav-item[role=tab][aria-selected]` > `span.geo-sidenav-num` | `items` (`[{value, label}]`), `value`, `onChange`, `label` (default `Sections`), `numbered` (false hides the numbers), `className` | yes: the tab rail |
| PageHeader | `header.geo-pageheader` > `div.geo-pageheader-main` (`div.geo-eyebrow`, `h1.geo-pageheader-title`, `p.geo-pageheader-sub`) and `div.geo-pageheader-meta` | `eyebrow`, `title`, `subtitle`, `meta`, `className` | yes |
| Card | `div.geo-card`, with `geo-card-selected` (`aria-current`), `geo-card-eyebrow`, `geo-card-title`, `geo-card-body`, `geo-card-band`; `geo-card-grid` for a grid | `eyebrow`, `title` (an h3), `children`, `footer` (the band), `selected`, `className` | yes |
| StatCard | `div.geo-card` > `div.geo-stat-value` and `div.geo-stat-label`, inside `div.geo-stat-grid` | `value`, `label`, `className` | yes: four stat grids |
| Callout | `div.geo-callout` (with `geo-callout-warning`, `-success` or `-neutral`) > `div.geo-callout-body`; `span.geo-callout-title` for a lead-in | `tone` (`info` by default; `warning` adds role `note` and an icon; `success` adds an icon), `title`, `children`, `className` | yes: seven, default tone |
| Table | `div.geo-table-wrap` > `table.geo-table` (with `geo-table-compact`); `tr.geo-row-highlight`; `geo-table-count` | `columns` (`[{key, label, width}]`), `rows` (`[{id, highlight, ...cells}]`), `compact`, `className`. Headers get `scope="col"` | yes: 53 tables |
| Code | `div.geo-code` > `pre` for a block; `code.geo-code-inline` inline | `block`, `className`, `children` | no code blocks; inline `code` is styled by page.css |
| Figure | `figure.geo-figure` > `div.geo-figure-frame` and `figcaption.geo-figure-caption` | `caption`, `className`, `children` | yes: ten |
| Disclosure | `details.geo-disclosure` > `summary` (with `span.geo-disclosure-chevron`) and `div.geo-disclosure-body`; `geo-disclosure-sm` for a small one | `summary`, `small`, `defaultOpen`, `className`, `children` | yes: three, in the debate transcript |
| Term | `dfn.geo-term` > text and `span.geo-term-tip[role=tooltip]` | `id` (the tooltip id), `definition`, `className`, `children` | no. Parts use `dfn[data-t]` and script.js makes the tooltip |
| Glossary | `div` > `h4.geo-glossary-title` and `dl.geo-glossary` (dt and dd pairs) | `items` (`[{term, definition}]`), `title`, `className` | yes: the glossary part |
| Divider | `hr.geo-divider`, with `geo-divider-dashed` | `dashed`, `className` | no |
| Input | `div.geo-input-wrap` > `span.geo-input-icon` and `input.geo-input` (`geo-input-search` for a search box) | `search`, `className`; other props go to the input | no |
| Checkbox | `button.geo-checkbox[role=checkbox][aria-checked]` (`mixed` for null) inside `label.geo-checkbox-label` | `checked` (true, false, or null for mixed), `label`, `onChange`, `id`, `aria-label` | only the label class, which wraps the theme switch |
| Toggle | `button.geo-toggle[role=switch][aria-checked]` > `span.geo-toggle-knob` | `checked`, `onChange`, `id`, `aria-label`, `className` | yes: the theme switch |
| Icon | `span.geo-icon` holding an inline svg | `name` (one of 20), `size`, `color` (a role-token name), `label` (sets role `img`), `className` | yes: the sun and moon icons |

The Icon names in bundle.js (20 entries; the design README says 18): check, minus, search, close, chevron-down-small, chevron-down, chevron-right, info-small, warning, check-circle-small, tick-small, plus, new-tab, copy-small, filter, link, question-circle, right-arrow-long-small, moon, sun.

### 3.3 tokens.json

- Top-level keys: `name`, `version`, `meta` (source paths, the source file of each component, and `synced`), `color`, `type`, `spacing`, `radius`, `shadow`, `gradient`, `breakpoint`, `size`, `zIndex`.
- An entry is `{ "name": "ink", "value": { "light": "{text}", "dark": "#ececee" }, "usage": "..." }`. A value is either a `light`/`dark` pair (dark optional) or a plain string. `{text}` names another token and compiles to `var(--text)`.
- Counts: colour 51 (26 role tokens with dark values, and 25 Geo palette values that keep their light value in both themes), spacing 10, radius 7, size 4, shadow 16, gradient 7, breakpoint 6, zIndex 4. `type.groups` lists the named text styles for reference.
- build.mjs `compileTokens` (line 71) compiles colour, spacing, radius, size (light only), shadow, and `type.families` (`sans`, `mono`) to CSS variables `--<name>`. Dots are escaped, so `space-1.5` becomes `--space-1\.5`, used as `var(--space-1\.5)`.
- Not compiled: gradient, breakpoint, zIndex and the type groups. To use one, extend `compileTokens`.
- Role tokens that pages use: surface, surface-raised, surface-sunken, surface-hover, ink, ink-muted, ink-faint, border, border-control, rule, disabled-fill, accent, accent-hover, accent-tint, on-accent, inverse, on-inverse, danger, danger-tint, danger-edge, warning, success, success-tint, on-success, diff-added, diff-deleted.
- Geo palette (light value only): white, text, ctaPrimary, ctaHover, ctaTertiary, purple, black, pink, bg, grey-01 to grey-05, link, divider, orange, green, successTertiary, errorTertiary, red-01 to red-03, deleted, added.

### 3.4 Fonts

- Four Calibre files: `calibre-regular.woff2` (400), `calibre-medium.woff2` (500), `calibre-semibold.woff2` (600) and `calibre-bold.woff2` (700).
- build.mjs `fontFaces()` (line 103, with the list in `FACES` at line 101) writes one `@font-face` per file, with the file as a base64 data URI: `src:url(data:font/woff2;base64,...) format("woff2")`, `font-display: swap`. The fonts are inline, so there is no font request. The raw files total 133,667 bytes; the base64 text is 174.6 KB of the page.
- The mono stack is the system one (`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`). It has no file.
- The text styles in tokens.json (`text-mainPage`, `text-body` and the rest) are reference only. They are not classes. Pages set sizes in page.css.

### 3.5 Light and dark mode

- Light is the default. Dark applies when `data-theme="dark"` is on `<html>`, or when the system is dark and no `data-theme` attribute is set. `data-theme="light"` forces light.
- The compiled tokens emit all three blocks: `:root` (light), `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }`, and `:root[data-theme="dark"]`. Each dark block also sets `color-scheme: dark`. bundle.css sets `[data-theme="dark"] { color-scheme: dark }`. page.css repeats `--code-fill` in the same three places.
- Only tokens with a dark value change. The Geo palette keeps its light value in both themes.
- The toggle is the header's `#theme-toggle` switch. script.js sets `data-theme`, keeps `aria-checked` and the sun and moon icons in step, and follows a `data-theme` change made by the host (a MutationObserver).
- The dark values are a proposal, because Geo has no dark mode of its own. Dark surfaces are `#141518`, ink is `#ececee`, and the accent is `#7b98ff` with `#0d1330` text on it.
- The design README asks artifacts to repeat the dark values under the media query. build.mjs already emits that block, so do not add a second copy.

---

## 4. page.css and script.js

### 4.1 page.css (12.4 KB): one responsibility per line

- Custom properties: `--code-fill` (light and dark) and `--measure: 92ch`, the prose cap.
- Shell: a `.wrap` grid with a 220px rail and one column, 1480px at most. The header and footer span both columns. The rail `.geo-sidenav` is sticky. At 1023px the rail narrows to 200px. At 767px the page is one column and the rail becomes a horizontal, scrolling row.
- Text: h2, h3, h4, `p` (capped at `--measure`), lists, `.lede`, `.small`, `strong`, and inline `code` inside cells, lists, paragraphs, dd, headings and summaries.
- Code and quotes: `.geo-code` and `pre` (which scrolls sideways), and `blockquote` with `cite`.
- Pages: `nav.subnav` and `.geo-tab` (no wrap); the page row wraps from 768px up; `.sub` and `.sub[hidden]`.
- Plain and Technical: `.plain`, `.plain-label`, `.plain .answer` (cards in columns), `details.tech` and `.layer-band` (both unused here).
- Blocks: `.geo-callout`, `.geo-stat-grid`, `.geo-card-title`, `.geo-figure`, `.geo-figure-frame` (scrolls sideways), `.geo-figure-caption`, `.geo-table-wrap`, `.geo-table` (560px minimum; 520px on phones), table captions, `td.num` (right-aligned, tabular, wraps), `.two` (two columns) and `.geo-disclosure`.
- Tables: `.packages` (fixed layout, full width, left-aligned, long text wraps). `.mock` and `.plan` are also used here.
- Terms and citations: `dfn` (dotted underline, and the asterisk from `::after`), `aside.terms`, `section#glossary .geo-glossary`, `a.cite` and `tr[id^="src-"]` (both unused: no citations).
- Marks: `.mark` with `.mark-yes` (success dot), `.mark-part` (warning dot) and `.mark-no` (danger dot).
- Unused here, inherited from the research page: `.opt*` (option catalogue), `.scorebar`, `.svgtext`, `.svgmono`, `.svgsmall`, `.yes`, `.score`, `.geo-card-grid`, `.geo-disclosure-sm`, `.layer-band` and `details.tech`. They are safe to delete if the page does not use them.
- Accessibility: `:focus-visible` outlines, and no transitions under reduced motion.

### 4.2 script.js (11.3 KB): one responsibility per line

- Rail: numbers the rail buttons 1 to n, and hides a rail button whose panel is missing (single-tab previews).
- Keyboard: arrow keys, Home and End move between rail buttons (all four arrows, since the rail becomes a row on phones), and between page buttons (left and right).
- Page rows: turns each tab's `div.sub` children into a row of page buttons when there are two or more. Each button takes its label from `data-title` and its layer from `data-layer`. `showSub` hides the other pages and scrolls to the top on a change.
- Plain and Technical: stores the choice in `localStorage` under `efl-mvp-layer` (inside try/catch), sets `data-layer` on `<html>`, sets `aria-pressed` on the switch, opens or closes `details.tech`, hides the Technical page buttons in Plain mode and moves the viewer off a Technical page, and updates `#layer-hint`.
- Hash routing: `#tab` opens a tab; `#page-id` opens a page, switching to Technical if needed; `#g-...` opens the glossary entry's page and highlights the entry; `#src-...` opens a source row. In-page `a[href^="#"]` links use the same routing, and `hashchange` is handled.
- Terms: for each tab, collects the `dfn[data-t]` marks, sets each mark's tooltip from its glossary entry, and builds "Terms marked * on this tab" in `aside.terms[data-strip]`, sorted by term. It removes the strip when the tab has no terms.
- Citations: sets a tooltip on each `a.cite` from the target row's `.src-title`. This report has none.
- Theme: `#theme-toggle` writes `data-theme` on `<html>`, keeps `aria-checked` and the icons in step, and follows host changes.
- Ids and selectors it needs: `layer-switch`, `layer-hint`, `theme-toggle`, `theme-icon-sun`, `theme-icon-moon`, `section#glossary`, `nav.geo-sidenav`, `section[role="tabpanel"]` and `aside.terms[data-strip]`.

---

## 5. Inline or external, and size

- The output is one file with everything inline. Its blocks, from the build's report: generated tokens CSS 4.8 KB; four Calibre fonts as base64 `@font-face` rules 174.6 KB; bundle.css 22.9 KB; page.css 12.4 KB; page content 223.5 KB (includes expanded, counts filled, comments removed); script.js 11.3 KB, in one inline `<script>` with no `src`.
- Shape: the file begins `<title>Claim tagger review</title>` (the title sits at byte 0), then one `<style>`, the page content, and one `<script>`. It has no doctype, html, head, body or meta tags. The publish tool adds the skeleton.
- External loads: none. In the current output there is no `<link>`, `<img>`, `<iframe>` or `@import`, and no script with a `src`. The only `http` strings are 12 SVG namespace URIs (`http://www.w3.org/2000/svg`), which are not requests. The file has four `url(data:font/woff2;base64,...)` font loads.
- Size: 460,446 bytes (449.7 KB) now. The fonts are about 39% of it. The README's "under 450 KB" is an authoring budget, so new content must be paid for by cutting something. The only size check in build.mjs is the 16 MB limit and the title position.

---

## 6. Pitfalls

From the README and the build's own comments:

1. Publish only the file written by `node build.mjs --strict`. A plain `node build.mjs` writes the output even when checks fail. Never publish a file from `preview/`, or `preview/full.html`.
2. Keep the file shape (section 5). No doctype, html, head, body or meta tags. The title must sit in the first 8 KB.
3. A new report is a new artifact: no `url` on its first publish. Passing the Claim tagger review's URL overwrites that report.
4. The tab id is a contract in four places (1.4). The glossary is `id="glossary"` in a `-glossary.html` file.
5. Each `div.sub` is a direct child of its section and has `id` and `data-title`. The first page of each tab is Plain.
6. Include directives are expanded before comments are removed, so a directive in prose, or inside an HTML comment, includes the file (or fails the includes check). Describe a fragment in words in the parts.
7. Fragments are not parts: they have no two-digit prefix, live in `parts/fragments/`, and their include paths are relative to `parts/`. Nesting goes six deep at most.
8. Colour comes only from role tokens. Literal colours fail. So does any `#` followed by three to eight hex digits in page.css, so an id selector such as `#bad` fails.
9. Inline svg: no `<style>` or `<script>`, and give it `role="img"` and an `aria-label`.
10. Tables: never add `nowrap` to `td.num`. Header cells never wrap, so keep headings short. Use `packages` for long text in cells.
11. Text rules: sentence case, no emoji, no personal names (use roles: the editor, the rule owner, the engineer). This report also keeps time estimates and shorthand codes out of the Plain layer. The build does not check those.
12. A `{{count:...}}` with no entry fails the tokens check. A `pending` entry fails strict. Every entry needs a `source`.
13. Duplicate ids fail, and ids span the whole page, fragments included.
14. Keep preview.mjs working: renaming an export it imports (build.mjs line 17) breaks previews.
15. Node 22 or later, built-ins only.

From reading the code (what the checks do not see):

16. The names check reads parts, the included fragments, page.css, script.js and counts.json. It does not read `TITLE` in build.mjs, the `icon` or `description` you pass to the publish tool, any README, or the unused fragments. Check those by hand. `TITLE` does end up in the published file.
17. The names check is a prefix match with no word boundary, so a name also hits any word that starts with it. It is case-insensitive, and it reads comments.
18. The jargon check reads only the visible text, with comments removed. It is a case-insensitive substring match. Short markers such as `P1`, `W1` and `TBD`, and ordinary words such as `insight`, can fire on innocent text.
19. A missing count inside an HTML comment passes silently, because the tokens check reads text with comments removed.
20. page.css and script.js keep their comments in the published file (only HTML comments in the body are stripped). Both still say "Editor feedback loop MVP", and script.js still mentions the old `#glance` example. Tidy them when reusing.
21. Visual rendering is not checked. Run the page in a browser in both themes, and at phone width, after any change.
22. The design README gives the stylesheet path as `components/bundle.css` (the file is `design-system/bundle.css`) and says 18 icons (bundle.js has 20).
23. bundle.js needs React 18 and is not embedded. Do not use `window.Geo` in an artifact.
