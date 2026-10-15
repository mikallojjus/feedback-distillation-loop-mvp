# Merged change list for the report, round 1 (orchestrator, 2026-10-14)

Sources merged: Mika's feedback F1-F7 (`../FEEDBACK.md`), the readability review (`review-readability.md`, 148 KB: P-, V-, G-, C-, R- items), the orchestrator's decisions on the review's six open consistency items, and the editor-persona debate round 1 (appended in section 5 when it lands). The rewrite agent follows this file; where it and the review disagree, this file wins. Guiding principle: launch fast and iterate; the Plain layer is for a tired reader, the Technical layer is context for future agents.

## 1. Decisions on the review's open items

| Review item | Decision |
|---|---|
| C-04 blocker 4 (source resolver) | Keep it a Blocker, relabelled "design verified, code to write", effort S to M. Counts unchanged (30 items, 4 blockers). |
| C-05 follow-up | Automatic at the end of a promote PASS, in production and in the demo (R18). Step 7 reads "See that follow-up ran (it runs by itself right after a PASS; the command repeats it by hand)". Fix the three places that say it is typed. |
| C-06 source tags | "Source inaccessible is decided in code from the fetch result; the model's source pass judges Improperly sourced and Factually challenged." Say it once in Questions and once in Features. |
| C-12 Python-compatible hashes | Verdict Later. Counts: keep 30, later 4. |
| C-13 the skim view | Dropped (D18: the editor filters in Notion). Four views, everywhere. |
| C-15 Agent proposal values | Agent proposal: Applies, Does not apply, Can't tell. Tag outcome: Applies, Does not apply. Both "ask an editor" and "cannot tell" show as Can't tell; the Agent reason column says which ("the rules do not settle it" or "needs the source"). Values to learn: 3 + 2 + 3 = 8, unchanged. |
| C-16 taxonomy snapshot | "The 13 rows were re-read live on 14 October (findings/verification-notes.md); read them again before setup." |
| C-19 durations for the code changes | No durations anywhere (F7). The plan is stages, not weeks; each stage has an effort chip (S, M, L) and a "done when" line. |

## 2. Truth first (apply before anything else)

- C-01 to C-03 and R-01 to R-10: the page catches up with DECISIONS.md D17-D24. Remove every "pending your confirmation"; the confirm page becomes "Decided on 14 October" (D17-D24 in plain words) plus "Still open" with exactly three items: (1) whether the Geo-to-Notion refresh keeps added columns and page ids (D21: the product owner asks the owner of the refresh job); (2) the canonical Geo API endpoint name (the Geo team); (3) the re-run band and the gate's noise guard get one calibration on the first 200 real claims (D19, D20). Remove the 50-row cap from all 12 places (D18: no cap; the editor filters, sorted by confidence). The resolver is verified: one GraphQL query per source entity returns its Web URL (10 places, wording in R-01 to R-10). `counts.json`: `confirm.items` = 3 decided-still-open, drop `queue.maxNewRows` and `path.spikeHours`.
- D19 and D20 are now decided, not proposals: the re-run rule is "re-read only unsure answers, at most 30% of claims", the default gate "re-reads flipped claims twice per side".

## 3. Structure of the Plain layer (F4, review top ten 2, 3, 4, 7, 8)

Target: the Plain layer is short and picture-led, about a third of today's words. Everything detailed moves to Technical pages (`data-layer="tech"`), which keep their tables as context for future agents. Label every Plain link that jumps to a Technical page with "(Technical)".

| Tab | Plain layer after the rewrite | Technical pages |
|---|---|---|
| Summary | One verdict sentence. Three cards: Keep, Cut, Do next (each at most five short lines). The loop as a cycle (figure `loop-cycle`). A four-card strip of the tag states (ready now, after drafted rules, needs sources, not yet). Before/after numbers in a small table. Where to read next. | The sixteen decisions table becomes "Decided on 14 October" (D1-D24) and "Still open" (3). |
| Features ranked | A verdict matrix (counts by Keep / Simplify / Cut / Later / Add). Four short tables in plain words: Cut, Simplify, Later, Add (no file names). One sentence on the pattern. | The 73-row ranking with files and reasons; token sinks; scale blockers. |
| Debt and bugs | Thirteen rows: the 4 blockers and the 9 high items, plain words, no paths, a "Fixed in" column naming a stage. | The full 30-row table with file refs; doc and text errors; permissions. |
| Minimal and optimal | F1: the minimal loop end to end as the cycle figure plus the Notion map (figure `notion-map`): which tables exist and who writes what. F3: the final tables with sample rows: Rulebook copy (Name, Status, When to use shortened, Example Claims), Tag decisions (Claim, Tag, Agent proposal, Agent confidence, Tag outcome, Why wrong), Rule changes (Lesson, Rule, Status, Gate result), Agent settings (Paused, Rubric in force, Last run summary), and the mirror's two new columns (Geo Name, Agent tags, Agent notes); two or three real Context-dependent rows each; at most 6 columns shown, full column lists in Technical. F2: "What the optimal version adds" as a figure (`optimal-additions`) that shows the same cycle with the additions marked, and a short list in plain words with the trigger for each. Skill usage as a figure (`skill-usage`): the editor's commands and Notion actions in two lanes. | The minimal vs optimal vs today comparison table; the ten optimal iterations with their trigger and effort; the eighteen change steps (short table); safety checks kept; full column lists. |
| Your questions | Per question: the short-answer callout, one visual (table or figure), and "What would change this answer". About 1,200 Plain words for the tab. Figures: `mirrors` (one rulebook, many claims tables), `tag-routing` (which tags go where), `inflow` (how many rows reach the editor; rows only, no hours). | Every settings, prompt-size, cost-per-call and run-scenario table; the estimate arithmetic. |
| Path to editors | Stages, not weeks (F7): Stage 0 housekeeping and two checks that change nothing; Stage 1 the rulebook copy and Context-dependent on 50 claims; Stage 2 the walkthrough with the editor and the first drafted rules; Stage 3 the text tags live one at a time and the source pass; Later. Figure `stage-plan` (lanes: the product owner, the engineer, the editor, the machine; no durations). The walkthrough as figure `walkthrough-steps` plus the story table and one sample step. Skill reports before and after (two cards). The weekly routine as a short list in effort terms, no minutes. "Decided on 14 October" and "Still open (3)". | Guardrails; the full walkthrough step list; the routine detail. |
| Glossary | Every term from the review's 3A, 3B and 3C with one plain line each; priority A terms first. | — |

## 4. Rules for every part (F5, F6, F7, review 1A, 9, 10)

- No time estimates anywhere: no minutes, hours, days or weeks, in prose, tables, figures, captions or counts. Use effort (S, M, L) or sequence (first, then, later; stage 0 to 3). This also applies to the walkthrough figure ("about 30 minutes" goes), the skill-report examples ("about 2 minutes" becomes "a short wait") and the machine's routine.
- No shorthand codes in the Plain layer: O-numbers, G1/G2, C-numbers, R-numbers, LS-, WT-, D-numbers. In Plain prose, say the thing ("the second cache group, the drafted text tags"; "the decision to drop the queue cap"). Codes may appear in Technical tables with a one-line legend at the top of the table.
- No references to internal documents ("the architecture plan", "the scaling analysis", "the notes") in Plain. Technical pages may cite `docs/analysis-2026-10/design/...` once at the bottom.
- One name for one thing: table (not database) in Plain, with the glossary line "Notion calls a table a database"; "queue (the Tag decisions table)" at first use, "Your queue" only for the view; "cache group" everywhere; "practice page" for the demo page; "earlier decision" for a regression case in Plain; "you" is the product owner everywhere except inside the walkthrough, where "you" is the editor and the page says so once.
- Every glossary term is marked with `<dfn data-t>` at its first use on each tab (review 3A-3D, G-M1 to G-M10); Technical-only entries get one mark on a Technical page; every `dt` has at least one `dfn` (build constraint).
- Plain-language rewrites P-01 to P-63 apply as written unless the sentence is removed by the restructuring; the feature-row glosses P-F01 to P-F36 and the debt glosses P-D01 to P-D13 become the plain wording of the short tables.
- Tables in Plain: at most 6 columns, short headers, `.packages` class so cells wrap, no file paths, no run ids.
- Figures: role tokens only, 13 px minimum text, `aria-label` with one sentence per step, a caption in plain words, legend "ink outline = the agent writes, accent outline = a person decides".

## 5. Editor debate, round 1 (dispositions in `../debate/dispositions.md`; apply these)

- ED-2: one sentence on the Summary and at the top of the walkthrough plan: "You type all five commands yourself; the engineer sets things up and fixes what breaks." The routine's engineer lane keeps only setup and repairs. Remove every "the engineer runs tag and promote".
- ED-1 wording: no rows per run and no minutes per row anywhere. The routine: "decide as many rows as fit one sitting, lowest confidence first; the rest waits and nothing is lost; the next run adds rows only for new or changed claims". The debate tab lists ED-1 as the one must declined, by decision D18, with that wording.
- ED-3 = F3: the final tables with sample rows on the Minimal and optimal tab (queue: all 12 columns, who fills each, the 8 values under their columns, two real Context-dependent rows).
- ED-4: the four view names are identical on the demo page and the real page: Your queue, Needs your note, Lessons waiting, Rulebook. Replace "Decide these rows" and "Approve this change" everywhere, including `../debate/inputs/walkthrough-plan.md` and `report-examples.md`.
- ED-6: rules are drafted one tag at a time in the order the editor chooses; the stage with the walkthrough contains nothing else; the draft-rules example report shows one tag with its example claims.
- ED-7: the walkthrough plan regains: one line under the story on why the two rows wait; the four-line Why wrong table; a ten-line words list; a two-line "paused / usage limit" help.
- ED-8: editor-facing names "Safety check result" and "Rulebook edition"; one word "rulebook" in Plain (never "rubric"); Counterpart hidden in the demo view; step 1 explains an edition in one line.
- ED-9: Agent notes on the mirror is at most two short lines per claim (tags that apply; how many wait for an editor; what was not checked). Show that format in the mirror sample row.
- ED-10: step 7 has nothing to type; the promote PASS report's Next line points at step 7; the typed command exists only to repeat it. Fix the report's step list and the follow-up example.
- ED-11: stage order: the walkthrough before the first real rows.
- ED-12: three plain lines under the side-by-side table on what optimal adds for the editor: all 13 tags judged, duplicates found by search, a queue per editor if a second editor joins.
- Answers 4 and 5: the FAIL report proposes one sentence for Editor wording; Lessons waiting shows Current text and Proposed text side by side with wrap on. Mention both in the walkthrough plan (step 5, step 6 fail branch) and in the report's Path tab.
- Also update `../debate/inputs/walkthrough-plan.md` and `../debate/inputs/report-examples.md` to match, because round 2 reads them.

## 6. Build and checks

`node build.mjs` while writing, `node build.mjs --strict` at the end (exit 0); page under 450 KB; after applying, these searches return nothing in the parts: `pending your confirmation`, `queue.maxNewRows`, `resolver spike`, `Not yet verified end to end`, `tag group`, `Decisions D1 to D16`, `minute`, `hour`, `week ` (except in the glossary line that explains why there are no time estimates, if one is added). Then `node plain-text.mjs` and check the Plain word count per tab against the targets above.
