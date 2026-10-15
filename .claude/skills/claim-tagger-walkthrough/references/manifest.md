# The manifest: what a practice page holds, how to change it, and the calibration

File: `agents/claim-tagger-mvp/walkthrough/manifest.json`. Every practice page is built from it; `walkthrough.mjs start` reads it (or `--manifest <path>`).

## Content

- `tag`: the real Context-dependent row of the taxonomy (Name, Description, When to use with its five rules, Example Claims, Counterpart Self-contained, Category, Polarity, Status Verified, Work tags, Geo Status, Geo Tag ID, Evidence, Verified on, `copied_from`). The practice page's Rulebook has this one row.
- `counterpart`: the Self-contained row, kept for its five example claims only (it is not on the page).
- `canaries`: the eleven example claims the safety check reads: the six of Context-dependent (expected to apply) and the five of Self-contained (expected not to apply). The builder adds `"tag": "Context-dependent"` when it writes `evals/canaries.jsonl`.
- `claims`: the seven real claims, in story order, with the thirteen Geo columns from the 50-claim pick (`key`: covid, georgia, melania, cnn, contractor, kennedy, stopgap; `short`: the claim cut to about 60 characters).
- `decided`: the five earlier decisions (melania Applies, cnn Applies, contractor, kennedy and stopgap Does not apply) with the agent's pre-audit answer as Agent proposal, Why wrong "Agent slip" and the editor's reasoning from the audit of 9 October ("From the audit of 9 October: ...").
- `open`: the two rows the editor decides at step 3 (covid and georgia), with the values the page tells the editor to enter (`enter`) and what the calibration expects from the agent (`calibrate`: apply at p 0.75 or more in at least two of three runs, citing rule 4).
- `alternates`: claims that can replace Georgia if the calibration fails (two Fairford withdrawal claims and the USPS ballot portal claim, with their Geo ids and texts), and the note on how Georgia then becomes an earlier decision.
- `views`: Your queue in step 3, Lessons waiting in step 5. `expect`: the counts `verify` checks. `steps`: the seven steps with their commands and the tables they affect. `quiet_columns`: Agent settings' Last run summary, rewritten by every command and not required in the step tables.
- `calibration`: `status` (`pending` or `frozen`) and `runs` (one entry per calibration run: date, demo id, the agent's p and cited rule per open row, the lesson, the verdict).

## Changing it

Change a claim only by replacing the whole entry (the Geo columns come from the dry run of the real table, `runs/dry-run/<id>/rows.jsonl`, so Geo Sources keeps its links). Keep the story: two open rows the editor disagrees with the rule on, five decided rows that cover both outcomes, eleven example claims. Change the page text in `page.md` to match (the shortened claims appear in every step table). Bump `manifest_version` and set `calibration.status` back to `pending`.

## Calibration (before a manifest version ships)

Three fresh practice pages run end to end under the Demos sub-page, entering the manifest's decisions at steps 3 and 5. The manifest is frozen when all of these hold: the two open rows get Applies at a probability of 0.75 or more in at least two of the three tag runs, citing rule 4 in at least two; every earlier decision and every example claim comes out as expected in every run; distill drafts exactly one rule change, on Context-dependent rule 4, from the two rows in every run; at least two of the three safety checks PASS, and any FAIL names a different claim each time and proposes a sentence for Editor wording that quotes the named claim; after step 2 no Agent notes cell has more than two lines and the two open rows have empty Agent tags and one tag waiting for an editor. Otherwise swap Georgia for an alternate (Georgia becomes an earlier decision: Does not apply, "the claim reads well") and repeat. Each run is recorded in `calibration.runs`.
