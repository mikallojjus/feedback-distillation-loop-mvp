# W1: the analysis report and its artifact

Structure, build and publishing are in P2 section 3; the scaffold and its pitfalls are in `../report/README.md`. This file records the review steps that run on the draft before it is published.

## Review 1: readability and visual presentation (Sonnet 5.5, requested by the product owner 2026-10-14)

A sonnet agent reads the built page (or the parts) as a first-time reader with no background and reports:

1. **Plain language.** Every paragraph of the Plain layer must be understandable without the technical pages. List each sentence or paragraph that is not, with a rewrite.
2. **Visual presentation.** Wherever prose carries numbers, comparisons, sequences or structures (a loop, a before/after, a ranking, a week-by-week plan, a capability matrix), ask for a table, a stat grid or a diagram instead, and say which. The report may add inline SVG figures built with role tokens, as the minimal-loop figure is.
3. **Glossary coverage.** Every term of art used in the Plain layer (claim, tag, rulebook, rubric, judge, queue, lesson, gate, canary, regression case, mirror, capability, adaptive runs, usage window, profile, walkthrough, demo page, allowlist, read-back, drift, pause, follow-up, source pass, cache group, and any other it finds) must be marked with `<dfn data-t="slug">` at first use and have a one-line entry in the glossary tab. List missing terms and missing marks.
4. **Consistency.** Numbers that appear in more than one place must agree; names of tables, columns and commands must be the same everywhere.

Its findings are applied to the parts (by a sonnet agent or the orchestrator), the build is re-run with `--strict`, and only then does the editor-persona debate (W2) read the Plain layer.

## Review 2: the editor-persona debate (Fable)

See `W2-debate.md`.

## Publishing

`node docs/analysis-2026-10/report/build.mjs --strict` must exit 0. Publish `claim-tagger-analysis.html` with the Artifact tool (title "Claim tagger review", icon "report", one-sentence description); record the URL in `WORKLOG.md`; republish to the same URL after the debate dispositions.

Sequencing change (2026-10-14, after Mika's aggregate instruction): debate round 1 runs in parallel with the readability review on the same draft; all findings (F1-F7, the review, round 1) are merged into one change list and applied in one pass; round 2 reads the revised page.
