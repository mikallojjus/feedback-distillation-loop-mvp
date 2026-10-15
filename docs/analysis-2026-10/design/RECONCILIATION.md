# Reconciliation of the Plan-agent reports (orchestrator, 2026-10-14)

P1 (architecture) and P3 (scaling, cost, debt, verification) agree on the shape: a taxonomy-shaped rulebook copy, a list of mirrors with two text columns, capability classes per tag, a per-tag or per-group judgment cache, a two-pass judge, a simple gate by default, a draft-rules step, and roughly half the scripts and a third of the Notion columns gone. They disagree, or add conditions, on the points below. Each has my resolution, and the ones marked "ask Mika" go into the next question batch. P2 (walkthrough, reporting, artifact, debate) is folded in when it arrives.

## Conflicts and resolutions

| # | Topic | P1 | P3 | Resolution |
|---|---|---|---|---|
| R1 | Adaptive re-run trigger | Re-run a cell when it is `apply`, `ask_editor`, text-pass `cannot_tell`, or p < 0.75 | On the trial data 88% of claims would trigger at least one re-run, giving 1.9-2.8x, not 1.3x | Trigger only on `ask_editor` or p strictly between 0.25 and 0.75; cap re-runs at 30% of the claims in a run (lowest margin first); calibrate on the first 200 real claims with one 3-run reference pass (38 calls). This narrows decision D13, which also re-ran every applied Issue tag. **Ask Mika.** |
| R2 | Noise guard in the simple gate | Verdict per side from the adaptive majority; HOLD only when nothing can be evaluated | At 4-8% per-run disagreement, 40 cases produce 1.6-2.8 chance flips, so a one-run gate false-FAILs 80-95% of the time | Keep a light re-judge in the default gate: every case that flips between the sides is judged twice more on both sides (reuse the reconfirmation code with 2 runs; about +4 calls). The bootstrap, confidence intervals and 5-run reconfirmation stay behind `--strict`. This adjusts decision D14. **Ask Mika.** |
| R3 | Duplicate tags | Never queue corpus-capability tags; the notes say "not checked" | Same; add a free within-mirror exact text-hash match for Exact duplicate, queued only on a hit | Adopt both. Semantically duplicated is reported as "not checked" and never queued until a corpus search exists. This changes decision D6, which said "the editor decides". **Ask Mika.** |
| R4 | Cache key granularity | One key per tag (tag_hash in the key) | Per tag costs about 170 output tokens of fixed overhead per claim per call; two groups (G1 Context-dependent, G2 the drafted quality tags) is the balance | Tag groups are config data (`judge.groups`); the cache key is per group and carries the group's tag hashes; default groups: G1 Context-dependent, G2 the drafted text tags, S the source tags (one claim per call). A rule change re-judges only its group. The CLI version is recorded, not keyed (both agree). |
| R5 | Distill grouping | Keep tag x why x rule groups; threshold 2 distinct claims | Group by (tag, cited rule), keep the reason per row, let one Opus call return up to 3 patterns with the rows each rests on, support only the cited rows, newest and reasoned rows first when a group exceeds 30, counter-evidence by "same rule, opposite outcome", at most 3 lessons per run ranked by distinct supporting claims | Adopt P3's version; keep P1's threshold of 2 distinct claims and its dedupe and overfit checks. |
| R6 | Editor inflow | `queue.max_new_rows_per_run = 150`, sorted by margin | First full pass would queue 330-820 rows (6-40 hours of editor time); queue only proposed changes and real uncertainty; bulk-confirm views for confident applies; "top N per run" | Default N = 50 new rows per run, sorted by lowest margin, with the rest reported as "held"; plus a view of confident applies that the editor can skim rather than decide. **Ask Mika for the acceptable weekly number.** |
| R7 | Trust breaker | Warn-only (the allowlist already blocks editor-field writes; with one editor it fires on their own clicks) | Not discussed | Warn-only in the default; keep exit 5 reserved. Note for the report: defense in depth goes down, acceptable for one editor. |
| R8 | Runs database | Fold into Last run summary, the lesson's Gate result and local cards | Replace "Cost USD" with a Usage column | Fold the database; the usage figures (calls, tokens by kind, wall time, window share) go into the local card and the one-line Last run summary. |
| R9 | Source tags | Node pre-fetch with a resolver for Geo entity links; failure = "not checked", never Source inaccessible | Same blocker; the pull drops link targets today | **Resolved by verification (14 Oct):** the Geo GraphQL API returns a source entity's "Web URL" value and its Publisher in one unauthenticated query (findings/verification-notes.md). The resolver is one query per entity, cached by entity id; `pull` must keep link targets (`richTextLinks`). Only the canonical endpoint name needs the Geo team's confirmation. |
| R10 | Hard rules | Rule 5 and rule 10 change; drift enforced only for tags with rules, so edits to unjudged tags are adopted without a gate | Not discussed | Adopt, and say so explicitly in CLAUDE.md. **Ask Mika** to sign off the exception for unjudged tags. |

## P2 against P1 (added when P2 arrived)

| # | Topic | P1 | P2 | Resolution |
|---|---|---|---|---|
| R11 | How the demo page and its views are created | Databases and rows through REST on 2022-06-28; views through the connector's create-view under the `runs/SETUP` marker, or a checklist for the editor | A second REST client pinned to Notion API 2026-03-11 (`/v1/views` exists since March 2026) builds page, databases, views and content; no connector, no marker; fallback: skip the two linked views and point at the inline tables | Adopt P2, gated on one real call that confirms the version, that views can be created and placed, and that the 2022-06-28 pull and apply still read databases created under the new version. If the call fails, P1's checklist fallback applies. |
| R12 | Queue, lessons and Runs in the demo steps | 12-column queue, no relations, "Supporting rows" as text, no Runs database, 4-column Agent settings, no formulas | Steps show a Runs table, a Lesson relation on Tag decisions, an "Earlier decision" column | P1's schema wins (one schema file shared by production and demo). Steps drop the Runs tables; step 4 shows Rule changes with its Supporting rows text instead of a Lesson column on Tag decisions; "Earlier decision" is modelled as the decided rows carrying Tag outcome and Your reasoning entered at setup through the setup plan (the only time those columns are written by a script, and only on a demo page; CLAUDE.md rule 1 gets that exception for demo setup). Agent settings appears only in step 6. |
| R13 | The cited rule for grouping | tag x reason x cited rule groups | The editor's own "rule n" in Your reasoning must win over the rule the agent cited, else the two demo rows split into two groups below the threshold | Adopt P2's `citedRule` precedence; with R5 (group by tag and rule, threshold 2 distinct claims) the demo's two rows form one group. |
| R14 | Demo claims table columns | Mirror column map: Geo Name, Geo URL, Geo Sources, Geo Is factual; write columns Agent tags, Agent notes | Steps still name "Claim title", "Sources count" | The demo claims table copies P1's mirror column map exactly, so a demo is structurally a mirror. |
| R15 | Lesson id in the demo | Rule changes keeps a unique id with a new prefix | Demo databases have no unique id; `run promote` resolves the only Approved lesson | Both: production keeps the unique id; the demo runner resolves the lesson so the page never asks the editor to note an id. |
| R16 | Insight suppression | Not discussed | A SKILL.md override paragraph; fallback a `loop.mjs` that prints the three-part report for verbatim relay | Adopt the override now and verify it headless with the Explanatory style on; build `loop.mjs` only if the override fails. |

## Conflicts raised by the W3/W4 consolidation (resolved by the orchestrator, 2026-10-14)

| # | Topic | Resolution |
|---|---|---|
| R17 | Hard rule 5 wording | D23 read literally would stop Context-dependent, whose rules come from the taxonomy at setup and never passed a gate. Final wording: "a tag is judged only when it has rules in force: the rules the copy held at setup, or rules that later went live through the gate". Consistent with Mika's intent; shown in the report's confirmation list as a wording note. |
| R18 | Walkthrough step 7 | Follow-up runs automatically at the end of a promote PASS, in production and in the demo (P1). Step 7 keeps the fixed format with "Doing the work: nothing to type; open the two tables"; the typed command stays only for a run that stopped early. |
| R19 | Rule 10 and restores | The rulebook copy's "When to use" is written after a gate PASS, or by a confirmed restore of text that already passed a gate. Both allowed. |
| R20 | "Last run summary" in the steps | Every command rewrites it, so it is exempt from the rule that every affected table is shown in a step; Agent settings appears only in step 6. |
| R21 | Values without a source | `distill.effort: high` and `distill.timeout_ms: 600000` are defaults to confirm by the first real distill; the calibration threshold "act when more than 2% of cells change verdict outside the queue" is a proposal; the R1 calibration is 100 random claims with 3 runs, about 38 calls (matches P3), not 200. |
| R22 | Keys across mirrors | Keys stay Geo ID + tag while there is one mirror; the mirror prefix is decided with World affairs (O5), after checking whether one Geo ID can sit in two mirrors. |
| R23 | Smaller calls made in W3/W4 | `transcript-check.mjs` kept for the headless report check; `demos/<id>` and `walkthrough.mjs run` replace `profiles/` and `profile.mjs`; `setup_page_parents` dropped (D24); no `updateDataSource` (no relations); the default gate checks the whole tag group (R4); the demo view "Decide these rows" filters on Tag outcome empty; reports show time and model calls, not dollars; C16 deletes move to week 0, C12 before C7, C17 before the first real-mirror write. Accepted as written. |

## Corrections to my own notes

- 8 tags lack rules, not 9 (Factually challenged has four rules but is Proposed). DECISIONS.md D7 and the WORKLOG are corrected by this note.
- Today's rubric build would keep the two status-less duplicate rows and drop the 7 Proposed rows.
- 22 trial canaries also carry stale tag hashes, not only the sandbox ones.
- The uncommitted sandbox work was committed by the other session.

## Items that need Mika (next question batch)

1. Source URLs: is there a Geo API or a Sources table with the original article URLs behind the Geo entity links? (Resolved by my own fetch if an entity page exposes it.)
2. Adaptive trigger: narrow band plus a 30% cap, calibrated on 200 claims (R1).
3. Gate noise guard in the default gate (R2).
4. Duplicates never queued until corpus search exists (R3).
5. Acceptable editor inflow per run or week; is a skim view of confident applies acceptable (R6).
6. Who adds the two columns to the real mirror, and does the Geo-to-Notion sync keep added columns.
7. The usage-window size and plan tier (never hit in the trial; the busiest stretch was 171 calls and 1.25M output tokens in 5 hours).
8. Sign-off on the hard-rule changes (rules 5 and 10) and the unjudged-tag drift exception (R10).
