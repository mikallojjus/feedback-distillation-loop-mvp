# The practice page: template, fixed format and what `verify` checks

The page is built from `agents/claim-tagger-mvp/walkthrough/page.md` (repository Markdown) by `walkthrough.mjs start`, through `scripts/lib/notion-blocks.mjs`. Placeholders: `{{edition}}` and `{{date}}` are text the builder fills; `{{view:Your queue}}` and `{{view:Lessons waiting}}` mark where the two linked views go (right under "Doing the work" of steps 3 and 5); `{{tables}}` marks where the five inline tables sit; `{{help}}` marks the Help toggle, whose content is the `## Help` section at the end of the file.

## Layout, top to bottom

1. A callout whose first line is exactly: "You type four commands yourself (status, tag, distill and promote); the follow-up runs by itself after a PASS, and the engineer sets things up and fixes what breaks."
2. The story: two sentences, a three-row table (Claim, Rule 4's test, The editor), one sentence, and the line "These two were picked for the demo; for real, a row appears only when the agent is unsure."
3. Steps 1 to 7 as headings "Step n · <title>", each with the four bold labels in order: Goal of the step, Existing status, Doing the work, Explaining the outputs. "Explaining the outputs" shows one small table per affected table, with a bold caption naming it, at most four columns and cells of at most 100 characters, claims shortened to about 60 characters. Step 1 explains an edition in one line. Step 7 has nothing to type and ends with the three lines on what the full version adds later and "Archive this page by hand when you no longer need it."
4. "The tables": the six-line list, then the five inline tables: Rulebook, Claims, Tag decisions, Rule changes, Agent settings.
5. Help, one toggle: the Why wrong table (a header and four value rows, two columns), the words list (exactly ten entries), and "If something stops" (exactly three lines).

The four view names are production's: Your queue (linked in step 3), Lessons waiting (linked in step 5, wrapping on), Needs your note (a view of Tag decisions), Rulebook (a view of Rulebook that hides Counterpart). No other view name appears on the page.

## Words

Page text is for the editor: no time estimates (no minutes, hours, days, weeks, seconds; say "a short wait" and "the longest wait of the seven steps"), no shorthand codes (nothing like D7, R12, C20, ED-4, "answer 4", G1), and never the words gate, rubric, canary, regression, database, subagent, API, mirror or sandbox (say safety check, rulebook, example claim, earlier decision, table, agent, Notion, practice page). Retired names that must not appear: the old view names "Decide these rows" and "Approve this change", the old column names "Gate result" and "Rubric in force", and the old Agent notes prefixes "Fix needed" and "Ready". Banned phrases: "leave these", "leave them", "undecided", "may differ", "most likely", "column guide", "copy this", "you can ignore", "note its". Text quoted from a claim is exempt (a claim may say G20).

## What `W verify` checks

On the page (also on `preview.md` for a dry run): the seven step headings with the four labels in order; every table at most four columns and 100 characters per cell; no banned phrase, engineering word, retired name, time estimate or code; the callout's first line; the "picked for the demo" line; the edition line in step 1; the three closing lines and the archive line in step 7; the Help toggle's three pieces with their exact counts; every affected table captioned in its step and Agent settings in step 6 only; exactly the two linked views (or none, with the no-views fallback recorded in `demo.json`), and only the four view names.

In the tables: five inline tables with the practice titles; Rulebook 1 row, Context-dependent, Status Verified, with the taxonomy's columns; Claims 7 rows with Agent tags and Agent notes empty at creation; Tag decisions 7 rows on Context-dependent, exactly 5 carrying Tag outcome (with Agent proposal, Why wrong and Your reasoning as the manifest has them) and the 2 open rows carrying no Tag outcome, Why wrong or Agent proposal; Rule changes empty with the column Safety check result; Agent settings 1 row with Rulebook edition set.

`W verify --json` prints `{ ok, problems, counts }`; the walkthrough's evals grade with it.
