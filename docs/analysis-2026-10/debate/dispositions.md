# Dispositions of the editor's round-1 objections (orchestrator, 2026-10-14)

Decision values: Accepted (what changes and where), Declined (one sentence citing a decision number or evidence; only the product owner can decline a must), Deferred (owner and trigger). The product owner's decisions are D1-D24 in `../DECISIONS.md`; feedback items are F1-F7 in `../FEEDBACK.md`.

| ID | Severity | Objection (short) | Decision | Change made | Where |
|---|---|---|---|---|---|
| ED-1 | must | The weekly load is two to three hours at 50 rows a run; wants a 15-row default cap | Declined as a cap by decision D18 (no cap; the editor filters in Notion); Accepted as wording | The report and the routine stop promising rows per run or minutes per row. The routine says: decide as many rows as fit one sitting, lowest confidence first; the rest waits in Your queue and nothing is lost; the next run adds rows only for new or changed claims. The "optional 30-minute review" is removed (no time estimates, F7). The decision is listed in the debate tab as the one must the product owner declined, with the reason. | Summary, Path to editors (routine), walkthrough plan header |
| ED-2 | must | Two tabs disagree on who types the commands | Accepted | One sentence on the Summary and at the top of the practice page: "You type all five commands yourself; the engineer sets things up and fixes what breaks" (decision D11: the editor runs the skill). The routine's engineer lane keeps only setup and repairs. | Summary, Path to editors, walkthrough plan |
| ED-3 | must | The 12 queue columns, the 8 values and a sample row are never shown | Accepted | The Minimal and optimal tab shows the final tables with sample rows: the queue's 12 columns (one line each, who fills it), the 8 values under their columns, two real Context-dependent rows; also Rulebook copy, Rule changes, Agent settings and the mirror's two columns (F3). | Minimal and optimal |
| ED-4 | should | The demo teaches view names the real page does not use | Accepted | The same four view names on the demo page and the real page: Your queue, Needs your note, Lessons waiting, Rulebook. "Decide these rows" and "Approve this change" are dropped. | walkthrough plan, report examples, W4 design |
| ED-5 | should | Minutes and hours promised everywhere | Accepted (F7) | No time estimates anywhere: effort words and order instead; "6 model calls" goes from the editor's reports. | all tabs, walkthrough plan, report examples |
| ED-6 | should | Six drafted rulebooks land in one week | Accepted | Rules are drafted and approved one tag at a time, in the order the editor chooses; the draft-rules command takes one tag; each draft is shown with its example claims; the walkthrough stage contains nothing else. | Path to editors, report examples, W3 and W4 designs |
| ED-7 | should | The plan dropped the old page's help and never says why the rows wait | Accepted | Back on the practice page: one line under the story ("these two were picked for the demo; for real, a row appears only when the agent is unsure"); the four-line Why wrong table (what each value makes happen); a ten-line words list; a two-line "paused / usage limit" help. | walkthrough plan, W4 design |
| ED-8 | should | Column names are code words; "edition" unexplained | Accepted | Editor-facing names: "Safety check result" (was Gate result), "Rulebook edition" (was Rubric in force), one word "rulebook" throughout, Counterpart hidden in the demo view; step 1 explains an edition in one line (a date plus a count; it goes up when a rule changes). The repo keeps "rubric" only for its files. | walkthrough plan, final schema in W3, report |
| ED-9 | should | Agent notes becomes a wall of text on the mirror | Accepted | Agent notes is at most two short lines per claim: the tags that apply, how many wait for an editor, and what was not checked; per-tag reasons and confidence live in the queue row and in the run files. "Fix needed" and "Ready" are dropped from the mirror. | Minimal and optimal, walkthrough plan, W3 design |
| ED-10 | should | Three documents disagree on step 7 | Accepted | One answer: nothing to type; follow-up runs by itself after a PASS; the promote report's Next line points at step 7; the typed command exists only to repeat it. | walkthrough plan, report examples, Path to editors |
| ED-11 | nice | Real rows before the walkthrough | Accepted | The stages are reordered: the walkthrough comes before the first real rows. | Path to editors, W3 milestones |
| ED-12 | nice | Codes never introduced; optimal never summed up for the editor | Accepted (F5) | No codes in the Plain layer; a one-line key where codes appear in Technical tables; three plain lines on what the optimal version adds for the editor. | all tabs |

## Round 2 (2026-10-15)

The persona accepted all twelve dispositions (ED-1 as wording; the cap stays the product owner's call) and all five answers, found every walkthrough step clear, and would run the walkthrough next week and start the loop on Context-dependent alone. It left three small items, all accepted:

| ID | Severity | Objection (short) | Decision | Change made | Where |
|---|---|---|---|---|---|
| ED-13 | should | With no cap, a status line could one day say "decide the 300 rows" | Accepted | When more rows wait than fit one sitting (a setting, default 20), the report gives the count and its Next line says "start at the top of Your queue"; the view shows the count. The first real run is Context-dependent only, so the first queue is tens of rows (already the stage plan). | report examples, Path to editors (routine), W3 report rules, W4 template |
| ED-14 | should | The stage order is only a picture | Accepted | A list under the stage figure: one line per stage (what, who, done when, no time words), naming the stage of the walkthrough and of the first real rows. | Path to editors |
| ED-15 | nice | Step 7 links to a view the rows have left; "five commands" vs "four commands" | Accepted | Step 7 reads "Open Tag decisions at the bottom of the page and the Claims table"; the page header names the four commands and says follow-up runs by itself. | walkthrough plan, W4 |

Open with the product owner (named by the persona and already in the report's "Still open"): whether the Geo-to-Notion refresh keeps the two added columns and the page ids; the persona will not decide rows on a table that may lose them.

## Questions, answered (`answers.md`)

See `answers.md`. Two answers add small features: the FAIL report proposes one sentence for Editor wording (question 4), and Lessons waiting shows Current text and Proposed text side by side with wrap on (question 5). Both go into the W3 and W4 designs.
