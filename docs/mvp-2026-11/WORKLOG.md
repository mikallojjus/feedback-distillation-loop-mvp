# Work log: claim-tagger MVP (build started 2026-10-15)

Append-only. One numbered entry per step: what was done, what was verified, what comes next. A new session reads this file first, then STATE.md.

## State at the last entry

- Phase (entry 47): "The hub and the Geo claims" (P5 to P25, `HUB-AND-GEO-CLAIMS.md`, `CLAUDE-DECIDES.md`) on the branch `claims-hub-2026-10`. The live runbook is done to step 9: 200 claims tagged, 6 waiting in Your queue. The decide step is a conversation (P21 to P25, decisions 117 to 122). Claude drafts, the editor iterates and says "write it". Any claim may be decided, a Reviewed one included, and writes may be partial. The guard hook is the gate, with no permission rule for update-page. It is built, reviewed and merged, and ran live for the first time on 28 October (entry 49): the 6 claims of Your queue are decided and read back. In step 10, distill drafted a change to rule 3; promote failed it on an example the rule in force already missed, and P33 and P34 fixed the check and its report (entry 50, merged as 61df7bb). Promote then passed: rule 3 is live in edition 2026-10-28.1 (entry 51). P35 to P37 (entry 52, `ADD-CLAIMS.md`): editors add Geo claims to Claims with `/claim-tagger add`, built, reviewed and merged as 057bdb9 (entry 53). Next: the product owner's live test of add, then a tag run at the new edition.
- Earlier phase: "Read the decisions" (P4) is complete and merged into `main` on 22 October.
- Blockers: none open.
- Branch: merged into `main` on 22 October (fast-forward) and pushed to https://github.com/mikallojjus/feedback-distillation-loop-mvp. Before the first push the history was rewritten once to drop the brief MVP-PROMPT.md (every commit from the first MVP commit on has a new hash), so the commit hashes quoted in entries 1 to 30, in STATE.md, DECISIONS.md and the evidence folders belong to the history before that rewrite; it is kept locally as the branch `history-before-github`, which is never pushed.
- Notion: ids in `agents/claim-tagger-mvp/config.json` and STATE.md. The hub holds the warning line, three link lines, Claims, Rulebook, Rule changes, Tag decisions, Agent settings, Onboarding (empty so far) and the archive page. The archive holds the first build: its five tables, Structure proposal, Demos and Demo tests with every practice page made until 27 October. All of it is protected.
- Artifact: https://claude.ai/artifact/EHcW9M6Y8TMCHbeDu3pVtr, republished on 22 October.
- Still to do after the merge: the backlog rows added on the branch (twelve, size S); the unpaused practice-page eval; a second independent verification of the acceptance checks.

## Entries

### 1. Stage 0 opened (2026-10-15)

Done: read `MVP-PROMPT.md`, the project memory, `docs/analysis-2026-10/DECISIONS.md`, `FEEDBACK.md`, `debate/dispositions.md`, `report/CHANGES-ROUND-1.md`, `.claude/settings.json`, the old agent's `config.json` and `scripts/lib/notion-rest.mjs`. Created the branch `mvp-2026-11` and this folder. Launched four haiku sweeps that write digests to `sweeps/` (W3 code design, W4 walkthrough design, library modules and test fakes, old build + bugs + taxonomy + Notion ids).

Verified: branch exists (`git branch`), folder exists.

Next: skeleton docs and first commit (the untracked analysis inputs); CLAUDE.md amendment; settings for the new folder; read-only dry run; structure proposal.

### 2. First commit, toolchain check, API facts (2026-10-15)

Done: committed the untracked inputs and the working directory (`44f716d`). Node v26.10.0, Claude Code CLI 2.1.296. The old suite passes as a baseline (865 tests, 0 failures; `evidence/00-baseline-old-tests.txt`). The parent page "Feedback Distillation MVP" is empty (fetched through the connector). Notion REST facts checked on developers.notion.com: `POST /v1/databases` takes `parent {page_id}`, `title`, `initial_data_source.properties` (select options with colours, status with groups); `POST /v1/views` exists since March 2026 under `Notion-Version: 2026-03-11` with `database_id`, `data_source_id`, `name`, `type`, `filter` (query-filter format), `sorts`, `configuration.properties[{property_id, visible}]`. Library import graph: only `paths.mjs` (location-bound), `notion-rest.mjs` (to extend) and `claude.mjs` (usage-window split) need copies; the rest can be re-exported.

Verified: test summary line read from the run output; API facts quoted from the reference pages.

Next: sweep digests; CLAUDE.md amendment (one commit); settings; the read-only dry run; the structure proposal.

### 3. Live reads through the connector (2026-10-15)

Done: read-only. The taxonomy's schema and its 13 Issue rows (the rows whose Work tags contain "Issue": Context-dependent, Exact duplicate, Factually challenged, Improper capitalization, Improperly sourced, Incorrect grammar, Multi-sentence, Poor wording, Semantically duplicated, Source inaccessible, Trailing period, Unsourced, Wordy; a Polarity filter gives a different set of 12 that includes Hypothetical and Predictive, so the copy is defined by Work tags). The real claims table's schema (21 columns; `sweeps/live-schemas.md`). The 9 October audit lives in "Claims to review" (protected); its 10 decided Context-dependent rows (8 Agree, 2 Disagree: Georgia and COVID) are saved in `evidence/03-audit-context-dependent-decisions.json` with the mapping to Applies / Does not apply. The library digest arrived (`sweeps/lib-digest.md`); the Sonnet coder building the new library layer was told to refuse the two forbidden CLI flags in code.

Verified: counts from a grouped SQL query (10 assessed and decided, 48 assessed still to review); the JSON file parses.

Next: remaining digests; CLAUDE.md; settings; dry run; proposal.

### 4. CLAUDE.md amended; settings, config skeleton and connector guard for the new folder (2026-10-15)

Done: `CLAUDE.md` rules 1, 5, 10 and the agents table amended as decisions D23 and D31 say, in one commit (`3c62989`). `.claude/settings.json`: allow rules for the new scripts, ask for `setup`, `rollback`, `restore` and the connector write tools (both server names), deny for the delete, move, duplicate and restore tools, writes under `runs/`, and the old folder's writer scripts; the hook now runs `agents/claim-tagger-mvp/scripts/hooks/guard.mjs`. `agents/claim-tagger-mvp/config.json` holds the parent page, the two read-only sources, the protected ids (real tables, the audit, World affairs, the old hub and sandbox databases) and the editor columns. The guard denies deletes and moves always, any mention of a protected id, any editor-column write, and everything else unless `runs/SETUP` exists and the target is registered in `runs/builder/`.

Verified: 18 guard decisions checked against expectations in a temporary root (all as expected); the stdin path answers deny, no opinion and deny-on-garbage. Digests complete: library, orientation, W4 (1,043 lines, with 25 contradictions to settle), artifact recipe; W3 still being written.

Next: W3 digest; dry-run pull script; structure proposal; artifact scaffold.

### 5. Design read; proposal and artifact drafting started (2026-10-15)

Done: read the W3 digest (1,189 lines; tables, views, config, scripts, rubric, judge, propose, distill, gate, report rules, settings, 25 contradictions) and settled the points that touch the MVP as decisions 9 to 20. Checked with GET requests only that the integration token reads the parent page, the real claims table, the taxonomy and the audit table (all 200). Read the counterpart tag Self-contained's five example claims (the do-not-apply canaries). Launched: an Opus drafter for `STRUCTURE.md` and its Notion-flavoured twin, a Sonnet coder for the artifact scaffold under `docs/mvp-2026-11/report/`. The Sonnet library coder is still running.

Verified: the REST request log of the access check shows four GETs and nothing else.

Next: library hand-back; pull script with the read-only dry run; the proposal page in Notion; the artifact's first publish; checkpoint 1.

### 6. Builder session commands (2026-10-15)

Done: `agents/claim-tagger-mvp/scripts/setup.mjs` with `builder open --reason`, `builder close`, `builder status` and `register page|database --id --name`. Opening writes `runs/SETUP`; registering writes `runs/builder/pages.json` or `databases.json`, a log line, and a registered page's id into `config.json` under `notion.pages`. The connector guard allows a content page write only while the marker exists and the target is registered; the structure proposal page will be created this way. The full setup subcommands (tables, rows, views) come in Stage 1 and extend this file.

Verified: a cycle against a temporary root (open, second open refused with exit 2, register, a bad id refused, status, close; the real root has no `runs/` folder afterwards).

Next: hand-backs from the four coders; the proposal page; the artifact's first publish; checkpoint 1.

### 7. Checkpoint 1 reached: the structure proposal is in Notion and the artifact is published (2026-10-15)

Done: the Opus draft of `STRUCTURE.md` reviewed and corrected (a select value carried a parenthetical; "confidence" had two meanings; the two waiting sample rows are the audit-decided Georgia and COVID claims, now said so). Converted to the connector's dialect (`lib/notion-markdown.mjs`: pipe tables become `<table>` blocks, special characters escaped) and created as the page "Structure proposal" under the parent through the connector while a builder session was open (`https://app.notion.com/p/3fa273e214eb81ef8504cb40e3bd7052`); the page registered (`notion.pages.proposal`) and the session closed. The artifact scaffold (`docs/mvp-2026-11/report/`, four tabs, `gen-parts.mjs` from `STRUCTURE.md` and `BACKLOG.md`, a strict build with an added rules check) rebuilt with the final proposal and published: `https://claude.ai/artifact/EHcW9M6Y8TMCHbeDu3pVtr` (title "Claim tagger MVP", icon report; republish by the same file path).

Verified: the page fetched back through the connector shows every section and all 13 tables; the strict build exits 0 (270 KB, no external loads); `builder status` shows no open session and one registered page; the config holds the page id.

Next: wait for the product owner's "go" (or edits to the page); meanwhile the Stage 1 coders (foundation modules and the Notion fake, pull and plan, judge and cells) continue; after "go": read the page back, diff it against `STRUCTURE.md`, adopt edits, log the diff, build exactly that.

### 8. Checkpoint 1 approved; Stage 1 opens (2026-10-15)

Done: the product owner wrote "Approved". The proposal page was fetched again: `page_last_edited_at` equals its creation time (2026-10-15T10:53:32Z) and the content equals `STRUCTURE.notion.md`, so there is no diff to adopt (decision P1). Also done while waiting: the read-only dry run of the real table (2,351 rows, 21 columns, 1,408 rows with source links, Geo ID unique on every row; 34 requests, 0 writes; `evidence/04-dry-run-real-claims/`), the 50-claim pick with seed `mvp-2026-11` (`setup/claims-pick.json`: the 10 audit claims first, then 40 at random), the taxonomy's 13 Issue rows and the counterpart Self-contained read once through the connector (`setup/taxonomy-issue.json`), the foundation modules and the plan and pull modules committed (1,322 tests pass).

Verified: the request log of the dry run counted by `countRequests` (writes 0); the pick holds 50 unique Geo IDs; the taxonomy file parses with 13 rows and 1 counterpart.

Next: the setup coder's hand-back (structure builder and setup subcommands); then a builder session, `setup all`, the read-back and the structure diff (acceptance check 3); the judge coder's hand-back; then the loop scripts.

### 9. Judge committed; the remaining Stage 1 and Stage 2 pieces in flight (2026-10-15)

Done: the judge (adaptive runs, per-group cell store, the judge prompt at version 1, the fake CLI with its error modes; 112 tests) committed. Four coders running: setup with the REST structure builder (structure file from the approved proposal, databases, views, rows, rubric edition, canaries, verify), the loop scripts (propose, distill, promote with the safety check and the automatic follow-up, followup, rollback, restore, status, preflight, the distill and wording prompts, an end-to-end loop test on the fakes), the Markdown-to-blocks converter with the practice-page lint, and the walkthrough manifest and page template (Opus, from the design and the real claims).

Verified: `node --test tests/` 1,323 pass after the judge landed (the judge coder's run).

Next: hand-backs in any order; then a builder session and `setup all` on the live parent page, the read-back and the structure diff (acceptance check 3); the real run on the copy (acceptance check 4); the two skills.

### 10. The loop, the page blocks and lint, the headless tooling and the skill are committed (2026-10-15)

Done: the loop scripts (propose, distill, promote with the safety check, the PASS and FAIL writes, the wording sentence and the automatic follow-up; followup; rollback; restore; status; preflight; the distill and wording prompts; an end-to-end loop test on the fakes; 169 tests), the Markdown-to-blocks converter with the practice-page lint (68 tests; the drafted page passes with no problems), the transcript checker and the headless runner (115 tests; the runner forces the Explanatory output style and grades the final message), the walkthrough manifest and page (Opus draft, reviewed; alternates filled from the dry run; decision 29), and `.claude/skills/claim-tagger/SKILL.md` rewritten for the MVP agent with the output-style override, the subcommand command lines, demo mode, the reporting style and the examples (`references/report-examples.md`). Coder decisions are recorded in `CONTRACTS.md` section 14.

Verified: the loop coder's `node --test tests/` run: 1,750 tests pass, 0 fail.

Next: the setup coder's hand-back; the live setup; the walkthrough runner; `AGENT.md` and `README.md`; the real run; the headless check; the verifier.

### 11. Stage 1 setup done in Notion: the approved structure, the rows, edition 2026-10-15.1 (2026-10-15)

Done: `setup.mjs structure --from-proposal` (5 tables, 58 columns, 4 views, 2 sub-pages), `preview` reviewed, `api-check` (one GET under Notion-Version 2026-03-11: ok), a builder session, `build` (the sub-pages Demos and Demo tests, the five tables and the four views, all through REST; the views were accepted, no fallback), `verify` (structure equal: no column, type, option or view difference; only the rows missing), then `all` (13 Rulebook copy rows, 50 Claims copy rows, 10 seeded audit decisions marked "seeded from the audit of 9 October", rubric edition 2026-10-15.1 with lock, history and changelog, 11 canaries, 1 Agent settings row; every row read back ok; final verify: no differences), the session closed. Ids are in `config.json`; evidence in `evidence/05-setup/` (verify, request logs, plans, ledgers).

Verified: request logs: builder 34 requests (11 writes: 2 pages, 5 tables, 4 views), rulebook 13 writes, claims 50, seed-audit 10, settings 1, verify 0 writes; `verify.json` ok with no differences; the parent page fetched through the connector shows the three sub-pages and five tables.

Next: the real run on the copy (pull, judge, propose), the walkthrough runner, the editor-review fixes, the two skills' headless checks, the verifier.

### 12. The real run on the copy (acceptance check 4) (2026-10-15)

Done: `pull --all` (13, 50, 10, 0, 1 rows; drift 0), `judge --items claims` with the live model (50 claims, 9 calls, 4 unsure after 5 re-reads, no transient error, no usage window), `propose` (2 new queue rows for the unsure cells, both Can't tell at confidence 0.61 and 0.67 with the rule cited; 5 claims tagged Context-dependent; Agent tags and Agent notes written on all 50 claims in the two-line form; Agent settings edition and Last run summary). Evidence in `evidence/06-real-run/` (plan, ledger, request log, reports, the judge's calls, the queue read back).

Verified: the ledger shows 53 ops done with read_back ok (50 claims_copy updates, 2 tag_decisions creates, 1 agent_settings update); the plan's properties are only Agent tags, Agent notes, the nine agent columns of Tag decisions and the two agent columns of Agent settings (no editor column); the request log shows 53 writes and 53 reads; a fresh pull shows 12 queue rows (10 decided from the audit, 2 open with Tag outcome, Why wrong and Your reasoning empty), the longest Agent notes cell is 2 lines, `evals/cases.jsonl` holds the 10 earlier decisions.

Next: the drift and pause checks on the live tables (acceptance 9 and 10) after the editor-review fixes land; the walkthrough runner; the evals and calibration; the headless check; the verifier.

### 13. Review fixes, runbook, headless status check, token blocker (2026-10-15)

Done: the editor persona's review of the practice page and the skill (one must: the FAIL report now hands the editor the whole Editor wording text; the rest applied by a fixer: status table on step 1, Rule unclear reasoning, drift help and a third stop line, the words list, the practice page named in demo reports, "your Claude allowance", "k of n runs agree"). `AGENT.md` and the READMEs written; the old fallback subagents removed; `commitRubric` commits the rubric paths only. The headless check of `/claim-tagger status` with the Explanatory output style passes (one Bash call, three-part final message, no insight block, no Notion write). The product owner tested a connection token (reads of every object ok) and switched `.env`; a malformed line caused 401s for a while (blocker B1, fixed the same day).

Verified: `evidence/07-headless/status/` (check.json ok); status against the live tables after the fix: edition 2026-10-15.1, 2 rows waiting.

Next: the walkthrough runner with the editor actions (decision 31), the test-fixture fix, drift and pause checks, evals and calibration, the verifier.

### 14. Pause and drift checks on the live tables (acceptance checks 10 and 9) (2026-10-15)

Done: a person's actions were simulated once each through the REST client in one-off commands and recorded in `evidence/08-pause-drift/by-hand-*.json`: ticking Paused in Agent settings, unticking it, and appending a sixth line to Context-dependent's When to use. While paused, `status`, `propose`, `judge` and `distill` all refused with exit 3 and a report whose Next line points at Agent settings. After the hand edit, `status` and `propose` refused with exit 4 naming "Context-dependent: When to use" and pointing at the Rulebook or the engineer's restore. `restore --list` showed the editions; `restore --edition 2026-10-15.1 --confirm` wrote the locked text back and recorded edition 2026-10-15.2 ("restored from 2026-10-15.1"); `status` then ran (exit 0).

Verified: the Rulebook copy's When to use read back equals the text of edition 2026-10-15.1 and no longer holds the hand edit (`evidence/08-pause-drift/read-back.json`); the changelog and `history/` hold both editions.

Next: the walkthrough runner's hand-back; the full test run for the evidence; the evals and calibration; the verifier.

### 15. The walkthrough runner, the first practice page and calibration run 1 (2026-10-15)

Done: `walkthrough.mjs` (start with dry run and resume, run, where, verify, list, and the editor actions decide, approve, reject for practice pages, decision 31) committed with 76 tests; the full suite saved as evidence (1,853 tests pass, `evidence/01-tests/`). A dry run under Demos passed the page check and sent one GET. The first practice page "Claim tagger practice · calibration 1" was built under Demos (page, five tables, blocks, two linked views in steps 3 and 5, two tab views, 16 rows; `verify` ok) and read back through the connector block by block. Steps 1 to 6 ran with the agent as the editor: status, tag (7 claims, 0 unsure), decide both rows, distill (one rule change on rule 4 from the two notes), approve with a deliberately wrong wording ("whenever the claim contains the word 'the'"), promote FAIL with the whole Editor wording text proposed; then approve with the wording cleared (new `--clear-wording`, decision 34), promote FAIL again on the fragile Melania decision (examples 11 of 11, the editor's rows 2 of 2, earlier decisions 4 of 5). Calibration findings: COVID-19 Applies at 0.80 citing rule 2; Georgia Does not apply at 0.15 in every reading; Melania Does not apply at 0.20 to 0.25; the alternates Fairford (0.93), USPS (0.80) and Dallas (0.72 to 0.80) Applies; the press pool claim Applies at 0.75 (decision 33). The manifest and page are being revised to the second story (COVID-19 and the press pool open; CNN, Dallas, contractor, Kennedy Center, stopgap decided).

Verified: `evidence/09-calibration/run-1/` holds every report, the verify results and the where output; every editor action is logged in the demo's `editor-actions.jsonl`; the FAIL reports hand over the complete Editor wording text.

Next: manifest 2026-10-15.2; three calibration runs under Demos (the headless checks for tag, distill and promote ride on one of them); the rollback check after a PASS; the evals under Demo tests; the verifier.

### 16. Calibration runs 2 to 4, the headless demo checks, two fixes, manifest 2026-10-15.3 (2026-10-15)

Done: three practice pages (calibration 2, 3, 4) were run end to end from manifest .2 with the agent as the editor (decision 31); run 4's tag, distill and first promote went through the headless report check (`evidence/07-headless/demo-tag`, `demo-distill`, `demo-promote`: all pass, three-part reports, one Bash call per script, no Notion writes; acceptance check 7). Run 2 reached PASS after one wording round (edition 2026-10-15.2 on its page, both rows Fixed) once its safety check got past a judge reply that twice left out the same earlier decision; run 3 reached PASS after one wording round; run 4 failed three checks in a row (the press pool row, then the COVID-19 row, then the domestic-chips example claim) and was stopped. Two fixes with tests: `verify` accepts a rulebook one or more editions ahead of the page when the page's edition is in the history (decision 35; run 3's verify had failed a healthy page), and the judge keeps every refused reply under the run's `rejected/` folder (decision 36). Manifest 2026-10-15.3 (decision 37): the open rows are the press pool claim and the AI Force claim, both on rule 3; COVID-19 retires to the alternates with its note; the domestic-chips example claim leaves the demo's example set (ten remain; a backlog row records it for production); the page text, the skill's references, the report examples and the tests follow; runs 2 to 4 are recorded in `calibration.runs`. A dry run under Demos passes the page check; calibration page 5 is built from manifest .3.

Verified: `evidence/09-calibration/run-2`, `run-3`, `run-4` hold every report, verify result and where output; the judge, walkthrough and rubric test files pass (202 tests), then the walkthrough file again after the manifest change (77); `verify` on run 3's page is clean with the rulebook at edition .2 and the page at .1; no secret appears in the evidence (scan for token prefixes: none).

Next: calibration runs 5 to 7 on manifest .3 (freeze when the criteria in `references/manifest.md` hold, else revise again); the rollback read-back on a passed page; the walkthrough evals under Demo tests; the verifier; the artifact republish; the product owner's practice page; checkpoint 2.

### 17. Calibration run 5, the rollback read-back, the walkthrough evals, the pause blocker (2026-10-15)

Done: calibration page 5 was built from manifest .3 and run end to end: the press pool row read Applies at 0.75 and the AI Force row Does not apply at 0.35 (the story holds either way: the editor's Applies with Rule unclear carries the lesson); distill drafted one rule change on rule 3; the first safety check FAILed with the press pool at Can't tell (examples 10 of 10, earlier 5 of 5, yours 1 of 2); the editor's wording PASSed (edition 2026-10-15.2 on the page, both rows Fixed; `verify` clean with the page at .1, decision 35 at work). The distill prompt now asks for the kind in the editors' own words (decision 38). Rollback (acceptance check 6) ran on calibration page 3: rule 4 back to its earlier text as edition 2026-10-15.3, the lesson Rolled back, the Rulebook row's When to use read back from Notion equal to the restored text (`evidence/10-rollback/`). The walkthrough skill's evals (acceptance check 8) ran as six subagent runs, three with the skill and three without, with the production profile paused: the dry run (with 4 of 4, without 2 of 4), the real tagging request (4 of 4 both, the baseline longer), and the practice page under the pause (with 4 of 4, without 2 of 4: the baseline told the editor how to delete the pause file and gave a node command); grading, timing, `benchmark.md` and the static review page are in `evidence/11-walkthrough-evals/` and `.claude/skills/claim-tagger-walkthrough-workspace/`. The pause then could not be removed by the engineer (refused; hard rule 7), so page 6 was not built and the unpaused practice-page eval waits: blocker B2, decision 39. The description optimiser runs on the twenty trigger queries (`evals/trigger-eval.json`).

Verified: run 5's reports, verify and where in `evidence/09-calibration/run-5/`; the rollback ledger shows one update with read-back ok and the fresh pull holds the restored text; every eval assertion was checked by `grade.py` against the saved final messages, the demo folders and the subagents' tool calls (no connector write in any run); the walkthrough tests pass against manifest .3 (77) and the page passes the page check in a dry run.

Next: the verifier (acceptance check 11), the artifact republish, the checkpoint 2 message; after a person clears the pause: calibration runs 6 and 7, the unpaused practice-page eval, the owner's fresh practice page.

### 18. The verifier, the test fix, the artifact, checkpoint 2 (2026-10-15)

Done: the independent verifier re-ran acceptance checks 1, 3, 5, 7, 8 and 10 and the inspection for hard rule 9 from commit dd65af9, read-only towards Notion, and wrote `VERIFICATION.md`: checks 3, 5 (with the rollback), 7, 8 and 10 and the key inspection PASS; check 1 FAILed on one stale test expectation (the propose test still expected rule 4 on the practice page's Step 2 rows after the story moved to rule 3). The test now takes the rule from the manifest; the full suite was re-run (1,854 tests, 0 failures) and `evidence/01-tests/` refreshed; the verifier re-verified check 1 from commit a478df6 (1,854 of 1,854 pass, test names equal to the evidence) and its overall verdict is PASS, with notes for awareness (its discrepancies 2 to 5 and 7). The verifier's other findings were taken up: the grader now follows the eval workspace's layout and says plainly when a transcript is missing (five of the six subagent transcripts were empty when graded, decision 40); the pause and drift checks' one-off hand edits of editor-owned fields on the production tables are disclosed as such (decision 41); entry 17's "Does not apply at 0.35" for the AI Force row describes the judge's reading, while the queue row reads Can't tell at 0.65 (propose writes the unsure band as Can't tell and the confidence as the distance from 0.5). The description optimiser ran twice on the twenty trigger queries (once with the installed skill set aside); it counted no trigger on any positive query and left the description as written; a backlog row asks the product owner to try the ten positive phrasings in ordinary sessions. The artifact was rebuilt (Status, How to run, Backlog; the strict build passes every check) and republished at the same link.

Verified: `evidence/01-tests/node-test-spec.txt` (1,854 pass, 0 fail); `VERIFICATION.md`; the grader's verdicts unchanged after the layout fix (with the skill 12 of 12, without 8 of 12); the strict build's check list; no secret in the committed files (the verifier's inspection and the engineer's scan).

Next: the product owner deletes the pause file, builds a fresh practice page and runs the seven steps; then calibration runs 6 and 7 and the unpaused practice-page eval; the MVP is agreed when the product owner says so.

### 19. Revision: decisions on the claims table (2026-10-16)

Done: the product owner reviewed the Tag decisions queue after checkpoint 2 and asked for the editor's decisions to live on the claims table, with the queue reduced to an agent-written ledger (decision P2). The specification is `CLAIMS-REVIEW.md`: the claims table gains Agent confidence and the real table's four review columns, the views move to the claims table, a decision is read from Review status and the verified relation (decision 42), disagreements are shown and never applied (decision 43). Implementation started: scripts and tests first, then the live structure change and the migration of the twelve existing decisions, then the walkthrough, then the documents and the artifact.

Verified: nothing yet; this entry opens the work.

Next: the scripts coder's hand-back; the live migration (needs the pause file deleted by the product owner); the walkthrough; the documents; the artifact.

### 20. The revision built: decisions on the claims table (2026-10-16)

Done: two coders implemented `CLAIMS-REVIEW.md`. Scripts: the Claims copy carries four agent columns (Agent tags, Agent notes, Agent confidence, Agent reasons; decision 44) and the real table's four editor columns; the decision is read from Review status and the verified relation (decision 42); propose writes the agent's side and copies decisions into the ledger, distill brings the ledger up to date first (decision 46), a disagreement is shown and never applied (decision 43), a claim marked To review waits whatever the confidence (decision 48); status counts from the claims; the plan check and the guard treat the claims' four editor columns as the editor's and the ledger as the agent's; setup gains the revised structure (65 columns, seven views) and a `migrate-decisions` step for the twelve existing rows. Practice page: the Claims table has the agent and editor columns, the five decided claims are created Reviewed with the audit values, the two open ones To review, the ledger holds the five audit copies, `decide` writes the four editor columns, Your queue is the linked view of step 3 on the Claims table, the ledger is shown at the bottom with one line and explained nowhere else (decision 49). CLAUDE.md hard rules 1 and 10, `STRUCTURE.md` (a revision section with sample rows), `CONTRACTS.md`, `AGENT.md`, the two skills and their references, `BACKLOG.md` and the artifact's Status, How to run and Structure tabs follow. Older practice pages keep the old shape.

Verified: `node --test tests/`: 1,935 tests pass, 0 fail (`evidence/01-tests/`); the practice page and the manifest pass the page check in a dry run on the fakes (a test covers it); the artifact's strict build passes every check. Not yet verified live: the migration and a fresh practice page wait for the pause file to be deleted.

Next: the product owner deletes the pause file; the engineer runs the live step (build, migrate-decisions, verify) and builds a fresh practice page; the product owner runs the seven steps; then calibration runs 6 and 7 of the story and the unpaused practice-page eval.

### 21. The revision live: columns, views, the carry-over, the first tag run, a fresh practice page (2026-10-21)

Done: after the product owner deleted the pause file, a builder session ran `setup.mjs build` (six columns added to the Claims copy and Decided under to the ledger; Your queue, Needs your note and Agent disagreed created on the Claims copy; the two old queue views renamed with "(ledger)"; the ids recorded in `config.json`), `setup.mjs migrate-decisions` (twelve claim updates through one plan with read-back: ten audit claims Reviewed with their verified tags, Why wrong Agent slip and the audit note; the two open claims given Agent confidence), `setup.mjs verify` (30 requests, 0 writes, no differences) and `builder close`. The first tag run under the new shape then ran on the copy: 50 claims received the agent's four columns, 38 ledger rows were created and 2 updated (one per judged claim and tag), 5 claims are tagged Context-dependent, 2 claims wait in Your queue, and on 1 reviewed claim the agent now disagrees with the audit's decision and says so in its notes; status reads 2 rows waiting at edition 2026-10-15.2. A fresh practice page for the product owner was built under Demos from manifest 2026-10-16.1 and read back clean. Evidence in `evidence/12-revision-live/` (the build and migration logs, the migration plan and ledger, the verify result, the tag run's reports, the page's verify and where).

Verified: every migration op read back ok; `setup verify` found no structure difference and every audit claim Reviewed with the audit's values; the tag run's ledger read back; the practice page passes `verify`.

Next: the product owner runs the seven steps on the fresh page; then calibration runs 6 and 7 of the story on the new shape, the unpaused practice-page eval, and a second independent verification.

### 22. Two verification runs of the walkthrough, the findings fixed (2026-10-21)

Done: an independent verifier built a fresh practice page under Demo tests and went through the seven steps as the editor (`evidence/13-walkthrough-verification/`): every command exited 0, every report passed the three-part check, the safety check passed on the first try and the follow-up marked both rows Fixed. It raised eleven findings; the engineer fixed ten (the eleventh is the model's own wording): the demo commands' default page is the newest readable page under Demos (decision 50), `where` names step 1 on a fresh page (51), demo runs record wrapped resume lines (52), step 2 of the page shows figures the tag step can produce and says they vary, the tag and status reports say "decide your N claims", the judge's stop lines end with a full stop, the promote report links the page like the others, the practice page's audit notes say which way the editor went, the follow-up writes Agent confidence, `list` and `decide` end with a Next line that fits. A second verifier re-ran the walkthrough on another fresh page (`evidence/14-walkthrough-verification-2/`): worked end to end again, PASS on the draft, nine findings confirmed fixed, one partly (by design) and one not applicable; it found that a page title holding a word the report check reads as a duration ("second run") made `start` report a stop after building the page and then broke `list` for everyone, which is fixed by reading links as addresses (decision 53). A second practice page was built for the product owner under Demos and is the page the commands reach. Three cosmetic points went to the backlog.

Verified: `node --test tests/`: 1,945 tests pass, 0 fail (`evidence/01-tests/`); `list` works live again with the misread title among the newest pages and still marks the owner's page; the two verification reports are in the evidence with every step's report.

Next: the product owner runs the seven steps on the new page; then calibration runs 6 and 7 on the new shape, the unpaused practice-page eval, a second verification of the acceptance checks.

### 23. Feedback round of 21 October: seven changes to the claims table, the page and the skill (2026-10-21)

Done: the product owner tested the practice page and gave seven points (decision P3, specification `CLAIMS-REVIEW.md` section 6, decisions 54 to 58): Agent tags as a relation, step 3 as a checklist, the verified column renamed Verified tags, the agent's columns before the review columns, a decided claim staying in Your queue until the next tag run, the skill guiding after each report, Agent notes replaced by Agent status, Tags waiting, Agent edition and Agent remarks. Implementation started: scripts and structure first, then the practice page and the skills, then the live change on the copy and a fresh page.

Verified: nothing yet; this entry opens the work.

Next: the coders' hand-backs; the live change; a fresh practice page; the documents and the artifact.

### 24. The feedback round live: columns, views, the page, the skills, a third verification (2026-10-21)

Done: two coders implemented `CLAIMS-REVIEW.md` section 6 (decisions 54 to 61). Scripts: the Claims copy's agent side is seven columns (Agent tags as a relation, Agent confidence, Agent reasons, Agent status, Tags waiting, Agent edition, Agent remarks), the editor's verified column is Verified tags, the views filter on Agent status and show the agent's columns before the review columns in every view including the table's own, a note line may start with a reason word, `build` renames and adds columns and arranges views idempotently, and a column guard stops every writing command until the table has the new columns. Practice page: step 2 and 7 show the new columns, step 3 is a checklist per claim, `decide` writes the four editor columns under the new name, the page's Claims views carry the order and filters. Skills: after a report whose Next line sends the editor to Notion, both skills add one checklist of at most five lines from `references/guide.md`, and the headless report checker accepts exactly that shape. Live: `setup.mjs build` renamed three columns, added five, brought the five Claims and ledger views to the structure; the first pass could not arrange the table's own view (Notion refuses the frozen-column value it reports), the fix landed and the second pass did; `verify` reads back no difference; a tag run wrote the agent's columns on all 50 claims (2 wait, 1 disagreement shown). A fresh page was built for the product owner. A third verifier ran a fresh page end to end: it worked end to end, the safety check passed on the first try, all seven changes were found in place (Agent remarks could not be exercised with one tag), and its three minor findings (status midway pointing at tag instead of distill and counting only undecided claims, the guide not mapping where's Next lines, the paste sentence shown in quotes) were fixed the same evening together with a narrower distill suggestion (decisions 62 and 63).

Verified: `node --test tests/`: 1,994 tests pass, 0 fail (`evidence/01-tests/`); `setup verify` clean after the second pass (`evidence/15-feedback-round-live/`); the owner's page verifies clean and `list` marks it as the default; the verifier's report in `evidence/16-walkthrough-verification-3/`.

Next: the product owner runs the seven steps on the new page; then calibration runs 6 and 7 on the current shape, the unpaused practice-page eval, a second verification of the acceptance checks.

### 25. Read the decisions: the specification approved, the branch opened (2026-10-21)

Done: the product owner decided that Why wrong leaves the editor's work and that the agent reads each disagreement itself, per tag (decision P4), and that the practice page gets four open claims on one tag. The specification was written in plan mode with an exploration of the distill, decisions, status and walkthrough code and a design pass, then approved: `READ-DECISIONS.md` (the feature, decisions 64 to 76, stages 0 to 5, the verifier's brief, the edge cases, the risks). The branch `read-decisions-2026-11` was created off `mvp-2026-11` at 8827ceb; `CLAIMS-REVIEW.md` section 7 points at the specification; DECISIONS.md holds P4 and 64 to 76. Two subagent tasks of the earlier stages were found still open: each was a `python3 -` probe whose heredoc the shell had collapsed, waiting on standard input, idle; the product owner stopped them. Coders on this branch are briefed to write scripts through the Write tool and never with a heredoc.

Verified: `git branch --show-current` prints `read-decisions-2026-11`; the specification is in the repo word for word apart from its preamble; nothing under `agents/` changed in this entry.

Next: stage 1, the scripts (the reading step in distill, the ledger and claim columns, status, the build, the fakes and the tests), on fakes only.

### 26. Read the decisions: stages 1 to 3 built and merged (2026-10-21, evening)

Done: three coders and one drafter, on fakes only. Stage 1, first half (one coder): `lib/readings.mjs` (the classification of every judged tag of a Reviewed claim into verbatim, to read, current, agree, fixed, unjudged and orphan; the hash and Read under; the message, the reply check, the ledger cells and the claim's Agent reading lines), the reading step at the start of distill (verbatim rows without a call, batches of ten through the distill model at medium effort, two attempts, refused replies kept, `readings.jsonl`, `--plan-only` and `--readings <run-id>`, the readings in the same plan as the decision copies, groups and lessons from the rule readings, Kind derived), the ledger's four columns and the claim's Agent reading in the schemas, config and pull, the column guard extended to the ledger, the fakes (`# Reading`, `FAKE_CLAUDE_READINGS`), the decision's why_wrong as the reason word only, and the prompt `prompts/reading.md` written by the engineer. Second half (a second coder, in a worktree): status counts to_read, pending_rule_decisions and needs_note in one "Your decisions" row (left out when all are zero) and suggests distill while something is to read; propose passes the rubric's tag names so its ledger copy equals distill's; the production structure (Agent reading after Agent remarks, Why wrong renamed "Why wrong (old)" and hidden, the ledger's four columns after Decided under, Needs your note filtering on Agent reading contains "without your note", the ledger's view on Reading note) with an idempotent build; distill exits 2 only when something was to read, nothing could be read and nothing was drafted. Decision 66 amended by the engineer after that coder showed a promote made every reading of the tag stale: the key holds the edition the proposal was made under, so a promote alone re-reads nothing. Stage 2 (a third coder, in a worktree): manifest 2026-10-22.1 with nine claims and four open on Context-dependent (press pool, AI Force, the USPS ballot portal with the verbatim "Agent slip." note, Georgia's debate where the editor agrees), the seeded ledger rows created already read as Agent slip with "Seeded from the audit of 9 October." and a Read under that distill finds current, `decide` with three columns (`--why` gone), `verify` checking the seeded readings and the structure, `where` reading step 7 from the rows the live lesson rests on (decision 76), the page rewritten (four checklists in step 3, the Agent reading lines in step 4, the Help table "Agent reading | What it makes happen"), rule j of the page lint, both skills and their guide (a Needs your note checklist). Stage 3 (an Opus drafter): CLAUDE.md rules 1 and 10, AGENT.md, STRUCTURE.md (the revision of 22 October), BACKLOG.md (four rows), STATE.md; the engineer corrected four leftover descriptions of the old key. Two stale subagent tasks of the earlier session were a collapsed heredoc each; coders were briefed to write scripts with the Write tool, and none hung.

Verified: `node --test tests/` on the merged branch at d020153: 2,059 tests pass, 0 fail (`evidence/01-tests/node-test-spec.txt`); `walkthrough.mjs start --dry-run` against the Demo tests page passes the page check with one read and no write (7 steps, 5 tables, 5 views, 16 rows); `grep -c "two claims\|your 2\|Why wrong" walkthrough/page.md` is 0; `git grep why_wrong` in the scripts names only the decision field and the ledger column; CLAUDE.md, AGENT.md, the skills and CONTRACTS name Why wrong only as "(old)" or as history.

Next: stage 4, the live step on the copy in a builder session (build, verify), the plan-only readings of the eight audit disagreements compared with the audit, the real distill run with `--readings`, then calibration runs 6 to 8 of the story on fresh pages under Demos.

### 27. Read the decisions: the live step and the story's calibration (2026-10-21, evening)

Done: stage 4. On the live copy, in a builder session, `setup.mjs build` added Agent reading to the Claims copy, renamed Why wrong to "Why wrong (old)" (hidden), added Agent reading, Rule, Reading note and Read under to Tag decisions and set the Needs your note filters; `verify` read back no difference with 0 writes (`evidence/17-readings-live/01-build-verify.txt`). `status --json` then counted 8 decisions to read (the audit's disagreements), none pointing at a rule, none without a note. `distill --plan-only` read the eight in one call to the distill model at medium effort: all eight Agent slip, as the audit had them (`readings-vs-audit.md`, 8 of 8 agree), so the prompt was not tightened; `distill --readings <that run>` wrote the four reading columns on the eight ledger rows and the Agent reading line on the ten Reviewed claims (eight slip lines, two "Nothing to read") with no second call, every write read back; status after: nothing to read; no claim carries "without your note", so the Needs your note view is empty. Calibration of manifest 2026-10-22.1: three runners built the pages "calibration 6", "7" and "8" under Demos and went through the seven steps as the editor (decision D31). Runs 7 and 8 met every tag-step threshold (press pool Applies 0.85, AI Force Can't tell, USPS Applies 0.78, Georgia Does not apply at 0.20 and 0.25); in run 6 the press pool and USPS came out Can't tell at 0.72 because the re-read cap went to two other claims. In all three runs: one reading call, the press pool read Rule should change and the AI Force Rule unclear on rule 3, USPS Agent slip on rule 5 verbatim, Georgia nothing to read, one rule change on rule 3 resting on the two keys (Kind Change the rule), PASS on the draft with examples 10 of 10 and earlier decisions 6 of 6, both rows Fixed, USPS and Georgia still waiting, `where` complete, no "Your decisions" row after the promote. The story is frozen (decision 77: the criterion on the rule the agent cites is dropped; the lesson rests on the reading's rule). Three figures on the page were brought to what the runs showed: the press pool's example reading is Rule should change, Georgia's confidence 0.75, the earlier decisions "0.65 or more" (Dallas reads at about 0.65). The run records carry the real date, 21 October; "22 October" stays the revision's name.

Verified: `setup verify` clean; `readings-vs-audit.md` 8 of 8; the real distill run's plan (`distill-plan.jsonl`) touches only Agent reading, Rule, Reading note, Read under on the ledger and Agent reading on the claims (plus the settings row); every calibration command exited 0; the three `record.json` files are in `evidence/09-calibration/run-6` to `run-8` and in the manifest's calibration.runs; the suite after the page and manifest edits is in the next entry.

Next: stage 5, the verification loop: an independent verifier builds a page under Demo tests and goes through the sequence of READ-DECISIONS.md section 4, including the no-note decision on USPS; at most three loops.

### 28. Verification run 4, decisions 78 and 79, the fixes (2026-10-21, late evening)

Done: an independent verifier built "Claim tagger practice · verification 4" under Demo tests and went through the seven steps as the editor, with the planned detour of deciding the USPS claim first without a note and only then with the manifest's "Agent slip." note (`evidence/18-walkthrough-verification-4/`, 84 files, REPORT.md saved from its message). Every command exited 0 and the safety check passed on the draft, but the feature did not behave as specified on the detour: the model read the no-note USPS decision as Rule unclear on rule 3, distill grouped it with the two rule rows, the draft rested on three keys and carried a clause about a single portal; the editor's later "Agent slip." re-read the row verbatim but the draft kept resting on it, the safety check counted "your 3 rows" and the follow-up marked USPS Fixed (1 must). Two should: a no-note decision joined a draft before the editor was asked for a note; the distill sentence counted rows as notes. Three nice: the second distill's Next line named status while a rule change waited; status said "nothing waits for you" beside "3 to read"; the page did not explain a decision without a note or the distill report. Settled: decision 78 (a decision without a note never supports a draft; it is read, flagged, counted, listed in Needs your note, and left out of the groups and of the "points at a rule" count until the editor writes a note) and decision 79 (a draft resting on a recanted decision is called out by distill and status with a Next line to reject it and distill again; promote holds with exit 10; the follow-up marks only rows whose reading still points at a rule; the agent never rewrites or withdraws a draft). A coder implemented both with `pointsAtRule`, `recantedKeys` and `ledgerAsRead` in `lib/readings.mjs` (status, promote and the follow-up judge a recant over the ledger as distill would leave it, so a reason word the editor just typed holds at once), the distill sentence that counts decisions and names the decisions without a note, the Next order (reject a recanted draft → Lessons waiting when drafted → approve or reject when one is Proposed → promote when one is Approved → Needs your note → status), the status sentence "the agent has N of your decisions to read", the page's two sentences, the guide, the examples; 17 tests added, including a full no-note run and a recanted run on the fakes. Left for the backlog: `where` does not know the recanted case; plan-only does not name a recanted draft; a lesson drafted before readings existed would count as recanted (none exists on the live copy).

Verified: `node --test tests/`: 2,076 tests pass, 0 fail (`evidence/01-tests/`); the page's dry run against the Demo tests page passes the page check; the findings' state is re-checked by verification run 5.

Next: verification run 5 (the same sequence; decision 78 and 79 expectations); if clean, the artifact's tabs, a fresh page for the product owner, the final message.

### 29. Verification run 5, decision 80, the fixes (2026-10-21, night)

Done: the second verifier built "Claim tagger practice · verification 5" under Demo tests and went through the same sequence (`evidence/19-walkthrough-verification-5/`, 102 files, REPORT.md saved from its message). Every fix of run 4 held and decision 78 worked live: the no-note USPS decision was read, flagged and listed, and stayed out of the draft, which rested on the two rule keys with no portal clause; the later "Agent slip." note was taken verbatim with no call and no second draft; the safety check counted "your 2 rows"; the follow-up marked only the press pool and AI Force, and USPS and Georgia kept "Waits for you". One new must, older than the branch: the safety check's extra read to settle a flip dropped the AI Force claim from a two-claim reply twice, both items got error lines in run 3 of the candidate's store, promote stopped with "type promote again; it continues where it stopped", and every later promote stopped at the judge in four seconds, because `summarize` counted any error line as "could not be read again" while `planReruns` never planned a retry for a run it had not asked for; the verifier got past it only with an Editor wording equal to the draft but for one comma. Two nice: the Help's "If something stops" did not cover the stop; the second distill's reason said "the rules the rows point at". Settled as decision 80 (the judge counts a failed reread only in a run its plan asked for; an unplanned error line is left to the extra read, which retries every item without an ok line; the tag step and the safety check share a cell store, told apart by item id). A coder implemented it in `judge.mjs` (`summarize` and `hadError` over `planReruns` on the store as it stands), added the fake's "drop" answer, the Help's fourth stop case (the page lint pin went from three lines to four), the distill reason "the 2 decisions that point at rule 3 already have a rule change waiting for you" (`openRuleReason`, `buildGroups` returning the waiting groups), and eight tests, among them a promote that stops on a dropped claim and passes on the second run judging only what was missing.

Verified: `node --test tests/`: 2,084 tests pass, 0 fail (`evidence/01-tests/`); the page's dry run against the Demo tests page passes; the coder reverted the one-line judge fix and saw the new tests fail the way the live run did, then put it back.

Next: verification run 6, the last loop the specification allows; if it has no must or should finding, the artifact's tabs, the product owner's fresh page and the final message; otherwise the findings go to BLOCKED.md and the product owner decides.

### 30. Verification run 6 clean; the branch complete (2026-10-22)

Done: the third verifier built "Claim tagger practice · verification 6" under Demo tests and went through the same sequence (`evidence/20-walkthrough-verification-6/`, REPORT.md saved from its message): every command exited 0 at its first try; the no-note USPS decision was read, flagged and listed and stayed out of the draft; the later note was taken verbatim with no call; the safety check passed on the agent's own draft at the first promote (examples 10 of 10, earlier decisions 6 of 6, the two rows 2 of 2); the follow-up marked only the press pool and AI Force; USPS and Georgia kept "Waits for you"; where, status and verify ended as the page says. Run 5's must could not recur live (nothing stopped) and was confirmed by the eight tests on the fakes and by replaying run 5's stuck store through the judge's plan, which no longer counts the unplanned error lines. Verdict: 0 must, 0 should, 3 nice (the distill table's "Point at a rule: none" under a sentence naming earlier decisions; the page's "0.65 or more" floor, which the Dallas claim read under once; the extra reads of the safety check keeping no refused reply), all three in BACKLOG.md. By READ-DECISIONS section 3 the loop stops. Then: the product owner's page "Claim tagger practice · product owner, 22 Oct" built under Demos (`evidence/21-owner-page/`: start ok, verify ok with no problems, list marks it as used by the demo commands, where says step 1); the artifact's Status and How to run tabs rewritten for the revision with the counts refreshed (2,084 tests in 35 files, 80 decisions, 36 backlog rows, 8 calibration pages, 3 verification runs), built with the strict checks and republished at the same link.

Verified: run 6's report and step files; the owner's page verifies clean; `node build.mjs --strict` wrote the page with every check ok; the suite at 2,084 tests pass (`evidence/01-tests/`).

Next: the product owner runs the seven steps on the new page and says whether the MVP is agreed and whether `read-decisions-2026-11` may be merged into `mvp-2026-11`; the engineer merges on that say-so. After that: the twelve backlog rows of the branch, the unpaused practice-page eval, a second verification of the acceptance checks.

### 31. The hub and the Geo claims: decisions P5 to P12, the specification, the branch (2026-10-27)

Done: the product owner decided, in four rounds of questions, on one Claims table seeded with 200 Geo claims tagged Debate (P5, P6), the walkthrough for onboarding only with D31 retired (P7), testing on Claims with people-only decisions (P8), the same root page renamed "Claim tagger" with the old contents moved by setup into an archive sub-page and hard rule 8 amended for that move (P9), a fresh set of five full-page tables (P10), a hub body of links only (P11) and the lean Geo columns (P12). The decisions are in `DECISIONS.md` (P5 to P12; D3 in `docs/analysis-2026-10/DECISIONS.md` marked reversed); the approved plan is `HUB-AND-GEO-CLAIMS.md`. Research before the plan (three Haiku explorations and one Opus design pass, read-only): the code passes one claims table only although the config takes a list (`tableEntry` picks the first); `buildDatabases` adopts a root child table by title, so the archive must run before the fresh build; `stepRubric` keeps an edition in force when the rules are unchanged; the REST client and hard rule 8 forbid moves today, while the Notion API at 2026-03-11 moves pages (`POST /v1/pages/{id}/move`) and databases (`PATCH /v1/databases/{id}` with `parent`); Geo is read without auth at `https://api-testnet.geobrowser.io/graphql`, and the first 1,000 Debate links are 997 claims in US Politics 299, World affairs 273, Relationships 186 (not canonical), AI 107, Health 55, Crypto 30, Technology 10, mostly created in September and October 2026. Model routing: the global CLAUDE.md and an older memory note disagreed on who verifies; the product owner chose CLAUDE.md (Opus 5.5 verifies and reviews editor-facing text), so `.claude/agents/editor-persona.md` now runs on Opus. The branch `claims-hub-2026-10` was created off `main` at 9dc97e4. Three Haiku sweeps write `sweeps/p9-occurrences.md`, `sweeps/notion-move-facts.md` and `sweeps/geo-read-facts.md`; the baseline suite runs into `evidence/22-baseline/`.

Verified: `git branch --show-current` prints `claims-hub-2026-10`; nothing under `agents/` changed in this entry; nothing was written to Notion or Geo.

Next: stage 1, one claims table in code (one Sonnet commit, then the diff reviewed against the specification).

### 32. Stage 1: one claims table in code (2026-10-27)

Done: a Sonnet coder in a worktree made the rename in one commit (62573cf, 41 files): `notion.claims` is one object `{ label, database_id, data_source_id, key, columns, write_columns }` and an array is refused ("there is one claims table (P5)"); the internal key `claims_copy` is `claims` in `TABLES`, the plan schema, plan, pull (the norm file stays `claims.jsonl`; rows now carry the table "claims"), judge, propose, distill, followup, promote, status, walkthrough, loop, editor-words, setup-steps, notion-build (`SECTION_TITLES` still reads the historical "Claims copy" section of STRUCTURE.md) and demo-profile; `editor_columns.claims`. A practice-page profile of the older shape (a list of claims tables) reads as "unknown" in `list`, is skipped as the default page, and `run`, `where` and `verify --demo` stop with exit 2 and one line asking for a new practice page (`olderShapeProblem` in demo-profile). Nothing Notion-facing changed: titles, columns and views stay for stage 5. Merged into `claims-hub-2026-10` (6bf224a) after the diff of `config.mjs` was read. The git-ignored `runs/` state is not migrated (old pulls, the builder registry under the old key), as the specification accepts. Three sweeps arrived: Technology holds 74 Debate claims (two pages), not 10; under Notion-Version 2026-03-11 block appends take `position` (start, end, after a block) and page creates take a position, while databases have none, so the archive page made before the fresh tables will sit above them until a person drags it (verify names it).

Verified: `node --test tests/` on the merged branch: 2,086 tests pass, 0 fail (two added, one replaced); `git grep claims_copy` in the scripts, config and structure finds only the comment in `config.mjs` and the older-shape check in `demo-profile.mjs`.

Next: stages 2 (walkthrough for onboarding only), 3 (the archive step) and 4 (the Geo pick) in three parallel worktrees, merged one at a time with the full suite after each; then stage 5.

### 33. Stages 4 and 2: the Geo read path and the pick; the walkthrough for onboarding only (2026-10-27)

Done: stage 4 (a Sonnet coder, e3c428e): `scripts/lib/geo-read.mjs` (`validateGeoConfig`, `createGeoClient` with two frozen operations, DebateTagged and ClaimDetails; `send` refuses any document that is not a query or that names a mutation or subscription, sends no Authorization header, follows no redirect; retries on network errors, 5xx, 429 and Geo's internal errors with the page size halved down to 50; `readClaim` reads the space's own Name, Is factual by property name, Tags, Topics and Sources with each source's Web URL; a request log with no bodies and `countGeoRequests`), `scripts/geo-pick.mjs` (populations per space from the Debate tag links, Claim-typed and named; cross-space and same-text duplicates recorded; quotas spread evenly over created months with caps and the remainder in month order; a short space passes its gap round-robin; the audit claims forced in where Geo tags them, left out with a reason where not; a seeded sample; details for picked ids only; the pick file validated against `schemas/geo-pick.schema.json`; an existing pick is never overwritten without `--replace`), the `geo` block in `config.json` (the space is spelled "U.S. Politics", as content-management spells it), a fake Geo server and 50 tests. `geo-pick.mjs` was added under ask in `.claude/settings.json`. The one query shape the sweep had not seen live (values nested under a relation's target, where a source's Web URL lives) was probed read-only: one DebateTagged page and one ClaimDetails batch of three Technology claims, two requests, both 200, queries only; the three claims carry tags and topics but no sources and no Is factual. Stage 2 (a Sonnet coder, 41e63f1): `walkthrough.mjs decide`, `approve`, `reject` and `--clear-wording` removed, and the `demoEditor` allowance with them, so no plan can write an editor column on an update anywhere; a practice page's decided rows are still written once by a create under the demo's `runs/SETUP` marker; the default practice page is the newest under `notion.pages.onboarding`; a practice page whose page or parent is protected is refused by `run`, `where` and `verify` ("in the archive ... read only") and shown as archived by `list`; the seven-step test on the fakes plays the editor through the fake's own rows; `config.json` carries `pages.onboarding` and `pages.archive` as placeholders until setup fills them; AGENT.md's D31 sentence replaced. Practice pages built before this change fail the stricter config check and list as unknown.

Verified: after the stage 4 merge 2,136 tests pass, 0 fail; after the stage 2 merge 2,128 pass, 0 fail (8 tests of the removed commands went); `git grep` finds no demoEditor, decide, approve, reject or clear-wording command left in the scripts and tests.

Next: stage 3 (the archive step) merges next; then stage 5 (fresh structure and hub) and stage 6 (docs and skills).

### 34. Stage 3: the archive step and the two move calls (2026-10-27)

Done: a Sonnet coder (74e13c3). `lib/notion-rest.mjs` gains `movePage` (`POST /pages/{id}/move` with exactly `{"parent":{"type":"page_id","page_id":…}}`) and `moveDatabase` (`PATCH /databases/{id}` with the same body and no other key), both only on the builder client (2026-03-11) and retried like reads; `appendBlocks` takes a `position` (start, end, after a block) on the builder client and maps "after a block" to the old `after` on the 2022-06-28 client; the header says moves exist only for the archive step (hard rule 8 as amended by P9) and a source scan keeps `DELETE`, PUT, `in_trash`, `archived:` and `is_archived` out of the file. New `lib/archive.mjs` and `setup.mjs archive [--plan-only]`: a snapshot of the root (GETs only), a plan of one rename ("Claim tagger"), one create (the archive page, whose first line links back to the hub) and eight moves (Structure proposal, Demos, Demo tests and the five old tables), checked so that every op names a known old id and every destination is the archive page; applied with a read-back of every new parent; `setup/archive.json` written as "moving" before the first write and "done" at the end; the tree under Demos and Demo tests walked (practice pages, their tables and data sources); `config.json` rewritten (pages `onboarding` and `archive`, the three old page keys as `<archived>`, table ids `<setup>`, views cleared, every archived id protected); the builder registry set aside under `runs/builder/before-archive/`. Work already done is skipped (the plan's `satisfied` list), so a rerun resumes; a refused move stops with exit 2 and asks for a drag into the archive page by hand; other failures exit 1 with the same command. Leftover root blocks are listed and never touched. The build steps stop while `archive.json` is not done, and `findChild` never adopts a protected or archived child by title (an old test that expected a stop now expects a new table). The fake Notion moves blocks between parents. 28 tests.

Verified: after the merge 2,156 tests pass, 0 fail (2,128 + 28); the rewritten config validates under stage 2's page keys (placeholders starting with "<" are accepted). Not verified live: whether an inline database's parent reads back as the archive page after a parent-only PATCH, and whether a moved page takes its sub-pages and tables with it (the reference says nothing); the `--plan-only` run is the first live check, and a refusal has the drag path.

Next: stage 5 (Sonnet, fresh structure and hub) and stage 6 (Opus, docs, hard rules and skills) in parallel worktrees.

### 35. The app crashed during stages 5 and 6; recovered from the worktrees (2026-10-27)

Done: the Claude app crashed while the stage 5 coder and the stage 6 drafter were running. Nothing committed was lost (the branch stood at f07243b). Each worktree still held its uncommitted work: stage 5 had five files changed (structure.json, notion-build, setup-steps, config, archive's read-back) and one new fixture, with tests, `setup.mjs` and `pull.mjs` still to do; stage 6 had nineteen documents and skill files changed, with decisions 81 to 97, the four hard rules and a valid evals.json already in. Both diffs were saved as patches in the session's scratch folder as a safety net, and both agents were resumed from their saved transcripts with the instruction to finish from where they stopped, not to redo.

Verified: `git worktree list` shows both worktrees at adec9a8 with their changes; the patches hold 6 and 19 files; nothing was written to Notion or Geo.

Next: the two hand-backs, merged one at a time with the full suite after each; then stage 7.

### 36. Stage 6: the docs, the hard rules and the skills (2026-10-27)

Done: the Opus drafter, resumed after the crash, found all nineteen files still edited, added one dated history line at the head of CONTRACTS sections 14 to 17 and committed (6846597). CLAUDE.md: hard rule 1 keeps one exception only (setup seeds the audit decisions of 9 October once, on Claims and on each new practice page when it is made) and says no agent or script ever acts as the editor (P7, P8); rule 2 adds that Geo is read only through `geo-read.mjs`, queries only; rule 8 reads "Never delete or trash a Notion page, table, row or block. Only setup.mjs, in a builder session, may move the agent's own pages and tables, and only within the hub (the archive step, P9)"; rule 10 names the hub "Claim tagger" and protects its archive sub-page and everything in it; rules 4 and 5 say "the Rulebook". AGENT.md, both READMEs, EDITOR-HANDOVER.md (practice pages under Onboarding; the commands without demo act on the real training table; pull first), both skills and their references (the demo commands kept as the practice page's commands, for onboarding; the walkthrough skill offers the Onboarding page), evals.json (the live practice-page eval retired, the dry-run, real-tag and paused evals kept), CONTRACTS (the config shape, the Geo pick, archive.json, the hub block), a pointer at the top of STRUCTURE.md, BACKLOG rows, and decisions 81 to 97. Twenty-three `<!-- stage 5 -->` markers wait for stage 5's code (AGENT.md 11, CONTRACTS 4, DECISIONS 7, EDITOR-HANDOVER 1). The drafter noted that `pull.mjs --pick` still ran (stage 5 retires it) and that `walkthrough.mjs` still says it has no default page, which is consistent because the skill passes `--parent`.

Verified: merged into the branch (bb79dfd); 2,156 tests pass, 0 fail; the skills' new descriptions are what the app now lists.

Next: stage 5's hand-back and merge; then the stage 5 markers checked against its code and removed; then stage 7.

### 37. Stage 5 merged, the live Geo pick, the pre-live gate (NO-GO) and the editor review; decisions P13 to P16 (2026-10-27)

Done: stage 5 (a Sonnet coder resumed after the crash, 8a87875, merged as 38d365f): `setup/structure.json` is the fresh set (Claims and Rulebook titles, the lean Geo columns, Geo Space and Geo Created, Onboarding the only page, the `hub` block, no retired columns); production tables are created full-page; the build runs databases, Onboarding, views and a new `hub` part that appends the three link lines at the top of the hub page and reports order differences and leftovers, never moving or editing a block; `setup.mjs structure --options-from <pick>` sets Geo Tags and Geo Space; setup reads the Geo pick, refuses stale page-id files, seeds only `audit.included`, writes a fresh rulebook edition when the page ids change and the rules do not, and verifies the hub, the full-page tables and the archive; `pull --pick` is retired. The live Geo pick ran (geo-pick asks first): 200 claims at exactly the quotas, 23 requests, all queries, none retried; 2026-10 holds 61% of the 5,469 Debate claims (likely the migration month), and the month spread still draws from every month; 69 claims carry sources, 84 an Is factual value; Geo Tags options Debate, Featured, Main claim, Top Debate (set with `--options-from`). Only 3 of the 10 audit claims are tagged Debate: the other 7 carry "New Story Potential Debates" or "Potential debate" instead (the gate checked them with one query), so the safety check starts with 3 earlier decisions (all Agent slip disagreements) plus the 11 examples. Committing the pick un-skipped the real-inputs test and showed four tests pinned to the structure file's options before `--options-from`; they now start from a "before options" copy, and the test of the committed file checks that its Geo Tags options equal the committed pick's tag names (ad888e7; 2,186 tests pass, none skipped). The Opus gate (`evidence/24-pre-live-gate/gate.md`) found the new code safe under the hard rules but said NO-GO: M1, `build` and `all` before `archive` would have written the old tables, because the gate let a missing `archive.json` through; M3, setting the old pick aside would break 13 test files; and three should items (the archive's link-back check by exact address, old table names in two messages, the Rulebook's page ids not verified). The editor review on Opus (`editor-review.md`) found the hub and the views not ready for other editors. The product owner decided four of its points: P13 (a claim leaves Your queue as soon as it is Reviewed, Review status last; replaces decision 55), P14 (one warning line on the hub: Claims is the real table), P15 (lean views and lean default tabs), P16 (a judged tag left out of Verified tags counts as Does not apply, said plainly; revisit with a second judged tag).

Verified: after the stage 5 merge 2,185 pass and 1 skipped; after the pick commit 2,186 pass, 0 fail, 0 skipped; the pick report shows 0 requests that were not queries.

Next: one Sonnet fix pass (the gate's must and should items, P13 to P16, the editor's wording, the 23 stage 5 markers), then an Opus re-check; then the live runbook, which starts with the product owner telling editors with their own checkouts to pull.

### 38. Stage 7 fix pass: the gate's items, P13 to P16, the editor's wording (2026-10-27)

Done: a Sonnet coder in a worktree (ebb9e71, merged as 5f11c6d; 47 files). M1: every setup step that builds or writes, all but `archive`, refuses with exit 2 while `setup/archive.json` is missing and `config.json` still names a real id of one of the five old tables ("the first build's tables are still on the hub page; run setup.mjs archive first (P9)"). The coder narrowed the literal rule (decision 98): the three old pages do not count, and an install whose `runs/builder/state.json` carries `archive_checked` passes, a mark that only a build which passed the gate writes. Read literally, M1 would have held back an install's own second run and broken about 80 tests. The live state file has no such mark, so the live install is held back. M3: the tests read `tests/mvp/fixtures/claims-pick.50.json`, a copy of the old pick, and pass with the three old setup files moved out (decision 99). S1: the archive page's link back is matched by the hub's page id. S2: "Rulebook copy" and "Claims copy" are gone from the messages; the config label is "Claims". S3: `verify` compares `rubric/rubric.json`'s page ids with the live Rulebook rows (decision 100). P13: Your queue filters on "Agent status is Waits for you and Review status is not Reviewed"; status counts what the view lists, and decided claims the agent has not read are told in Your decisions (decision 101). P14: the hub's warning line, the structure's hub `note`, goes first (decision 103). P15: lean columns on the three review views; each table has a one-line description, sent when the table is made, and a `default_view` (Claims calls it "All claims"; decision 104). P16 and ED-1 to ED-12: the column descriptions, the guide, the handover, the practice page, the archive page's warning line (ED-9) and the practice page's last line (decision 105). The practice page follows the real table only in the Your queue filter, because its manifest is frozen (decision 102). All 23 stage 5 markers resolved; the only remaining hit of the string is entry 36's prose. Backlog rows: P16 to revisit with a second judged tag; the ledger views keep their names because the names are keys; "All claims" opens as the last tab, not the first, because the named views land before Notion's own view.

Verified: after the merge 2,202 tests pass, 0 fail, 0 skipped (`evidence/01-tests/node-test-claims-hub-stage7.txt`; 16 new). Nothing ran against Notion or Geo. Not verified live: whether Notion's "is not Reviewed" on a select keeps the rows whose Review status is empty (the fake does), and whether a table description can be sent on create under 2026-03-11.

Next: the Opus re-check (`evidence/24-pre-live-gate/recheck.md`) for a GO; then the live runbook.

### 39. The re-check (NO-GO), a second fix pass, the confirmation (GO); decision P17 (2026-10-27)

Done: the Opus re-check of the stage 7 fixes (`evidence/24-pre-live-gate/recheck.md`, c6cf615) found M1, M3, S1 to S3, the editor's wording, the markers and the hard rules sound. It proved M1 on a copy of the live install with the network blocked: all 13 write steps exit 2 before the archive. Two items blocked the build. MF-1: no Notion document says whether "is not Reviewed" keeps a claim whose Review status is empty, and all 200 new claims start empty. MF-2: the named views were made in front of each table's own view, so Claims would open on Your queue, not All claims (P15), and no script can move a tab afterwards. SH-1 was a failure path: archive.json is written "done" before config.json is rewritten, and the gate trusted "done", so a failed rewrite would have let `all` write into the archived Claims copy. The product owner said nobody else has a checkout (decision P17; runbook step 1 skipped). A second Sonnet fix pass (51c28a4, merged as da08d57; decisions 106 to 110) changed four things. A select "is not X" is sent as "is not X, or is empty"; the words and the frozen manifest are unchanged. A table with a default_view gets its named views made after its own view, and a view Notion will not place gives a warning that names the drag. The named view "Rulebook" is dropped, the Rulebook's own view takes its name, and the practice page keeps it through `practiceStructure`, so there are six views. The gate also refuses a "done" archive.json whose Archive page config.json does not name. The guide got the ED-4 wording. The views API does not say in what order it lists views, so verify cannot check the tab order; the runbook now asks a person to open Claims once and to drag a tab if the build warns. Evidence folders after 24 move up by one (25-archive, 26-fresh-setup, 27 status, 28 tag run, 29 people loop, 30 verification).

Verified: after the merge 2,210 tests pass, 0 fail, 0 skipped (`evidence/01-tests/node-test-claims-hub-fix2.txt`). The Opus confirmation (`evidence/24-pre-live-gate/confirm.md`) says GO with no must-fix. It proved SH-1 and M1 again on a copy (0 network attempts): a "done" record with the old config, a placeholder or another archive page exits 2, and archive run again finishes locally and opens the gate. The practice structure is deep-equal before and after. Not verified live: a view filter of an `and` holding an `or` (the reference allows two levels; a refusal stops the build with exit 1), a view created `after_view`, a table description on create.

Next: the live runbook from step 2 (set the old setup files aside, tests, commit), then the builder session and `archive --plan-only`; the archive itself waits for the product owner's go.

### 40. Live runbook steps 2 to 7: the archive, the fresh set under the hub, 200 claims, verify clean (2026-10-27)

Done: step 2 set the first build's pick and page-id files aside under `setup/archive-2026-10/` (322c890; 2,210 tests pass with them moved). A builder session was opened. `archive --plan-only` listed the rename, the archive page and the 8 moves (3 pages, 5 tables). On the product owner's go, `archive` ran (30fac28, `evidence/25-archive/`). It renamed the root "Claim tagger", made "Feedback Distillation MVP (archive, to 27 Oct 2026)" with its line back to the hub, moved Structure proposal, Demos, Demo tests and the five old tables into it and read every new parent back: 10 writes, no DELETE. It rewrote `config.json`, with 29 page ids and 296 database ids now protected. Step 6 ran `preview`, `build` and `all` (fc07323, `evidence/26-fresh-setup/`):
- the structure: 5 full-page tables, 6 views (each table opens on its own view), Onboarding, and the hub's warning line and three link lines;
- the rows: 13 Rulebook rows, the 200 Geo claims of the pick, 3 audit decisions seeded and migrated ("From the audit of 9 October"; the other 7 audit claims are not tagged Debate in a canonical space and are named in the run), and the settings row;
- the rubric: edition 2026-10-27.1, the rules of 2026-10-15.2 with the fresh Rulebook's page ids;
- 11 canaries.

Notion named every table's own view "Default view"; the build found it, renamed or arranged it and placed every named view after it, so no tab warning came. The first verify named 4 differences:
- the archive page above the tables;
- two empty paragraphs left from the first build;
- a false link difference on one claim. Notion adds a trailing slash to a bare origin; decision 111 fixes the comparison (4529266; 2,211 tests).

The product owner dragged the archive page to the bottom, removed the two paragraphs and checked that Claims opens on All claims. In doing so the warning line went too, and a new empty paragraph appeared below the archive page. The `hub` step put the warning line back at the top (1 append, read back). The product owner removed the new paragraph. The builder session is closed.

Verified: the last `setup.mjs verify` reports no differences, 49 requests and 0 writes (`evidence/26-fresh-setup/verify-final.txt`, `builder/verify.json`). The day's request logs (`requests-audit.json`) hold:
- 928 requests and 250 writes: 10 for the archive, 20 for the structure, 220 rows;
- POST queries counted as reads;
- 0 DELETE, 0 trash or archived fields, 0 failed requests.

Every plan op that touches an editor-owned field (3, all migrate-decisions on Claims) carries the audit prefix. The Claims tab order was checked by a person, since verify cannot read it. Also seen live: a view filter of an `and` holding an `or` is accepted (the build made Your queue), a view is accepted when created `after_view`, and a table description is accepted on create and stored (a GET of each of the five tables reads its description back, with `is_inline` false). Not verified yet: that "is not Reviewed, or is empty" keeps the claims whose Review status is empty. Your queue lists claims only once the tag run has set Agent status, so step 8's status and step 9's tag run show it.

Next: runbook step 8, the walkthrough's `start --parent <Onboarding> --dry-run` and the headless `/claim-tagger status` (`evidence/27-…`). Then step 9, the tag run on the 200 claims, which writes about 400 rows and waits for the product owner's go.

### 41. Live runbook step 8: the practice-page dry run under Onboarding and the headless status check (2026-10-27)

Done: on the product owner's word ("Stop before the tag run"), two read-only checks ran (`evidence/27-status/`).

`walkthrough.mjs start --parent 406273e214eb81a881dcd1480c5d015e --dry-run` passed the page check. It planned 7 steps, 5 tables, 5 views, 16 rows and 19 requests, sent nothing but the parent GET, and built nothing (`walkthrough-dry-run/`: output, preview.md, setup-plan.json).
- Of the 16 planned rows, 9 claims carry an editor column. The 5 decided claims are the audit seeding, each note opening "From the audit of 9 October". The 4 open claims start at Review status "To review". The manifest is frozen at 2026-10-22.1 and unchanged.
- The dry run leaves `runs/demos/20261027-2054-9deb8c/` with no demo.json. `listDemos` lists only folders that hold one, so the demo commands do not see it.

`status.mjs` run directly said:
- "nothing is paused; the agent has 3 of your decisions to read";
- the Rulebook at 13 tags, edition 2026-10-27.1, the same as Notion;
- Your queue: nothing waits; Lessons waiting: none;
- Next: "type /claim-tagger distill".

`headless-check.mjs --prompt "/claim-tagger status"` gave PASS: 2 turns, 1 Bash call (`status.mjs`), 0 Notion reads or writes through tools, no problems, 16 s. Its final message is word for word the direct run's. The CLI was 2.1.303 on its default model, claude-fable-5-1. That is the editor's own CLI, not a subagent of this build; status makes no model call, and the judge stays pinned to claude-sonnet-5-5 in config.json.

Found: status's Next line rests on an assumption the fresh Claims table breaks. `status.mjs` (lines 228-231) counts claims with no Agent status only on a practice page: "In production the agent has always filled its side of a claim before the claim waits". With 200 claims seeded and none read yet, production status skips them. It says "Your queue: nothing waits" and points to distill (for the 3 audit decisions) instead of tag. Notion and the counts are right; only the advice is off. The gap closes after the tag run, since every claim then has an Agent status, and comes back whenever new claims are added (the pick refresh in the backlog). Whether to fix it is the product owner's call.

Verified: both checks exit 0. The headless settings and transcript hold no token. Nothing was written to Notion in this step.

Next: the product owner decides on the status gap. Then step 9, `/claim-tagger tag` on the 200 claims (`evidence/28-real-tag-200/`), on the product owner's go.

### 42. Status counts the claims the agent has not read (decision 112); stopped before the tag run (2026-10-27)

Done: the product owner decided to fix the gap of entry 41 before the tag run. In production, status counts the unread claims, shows them in the Your queue cell, and says to type the tag command after any claims to decide and ahead of distill (decision 112, amending 101).

A Sonnet coder made the change. Its first worktree was cut from an old main (a7730fe), not this branch. The coder caught it from the test count (2,084, not 2,211), and the commit was redone on the branch (052d4f9). Coder briefs now name the branch to start from and the expected count; the memory has a note.

An Opus reviewer said GO with no must-fix:
- 14 deliberately wrong versions of status.mjs were all caught by the tests;
- the parent's tests fail on the new code only where the spec asks;
- no other doc is made wrong.

Merged as e35ca37. Then the reviewer's three smaller points: decision 112 records the amendment; the example numbers in AGENT.md became N; status.mjs's header was rewrapped. CONTRACTS keeps its "3a" in section 17, the lettering it already used for decision 79's "4a". A claim with a Geo ID but no text would stay unread after every tag run, since the judge skips it (the reviewer's COULD 1). The pick only takes claims with a name, so it cannot happen with these 200; it is left for the backlog.

Verified: 2,220 tests pass, 0 fail (`evidence/01-tests/node-test-claims-hub-status-unread.txt`). Live status, which only reads, now says:
- "Your queue | nothing waits; 197 new claims not read yet";
- "Your decisions | 3 to read";
- "Next: type /claim-tagger tag to read 197 new claims."

That is 197, not 200, because the 3 audit claims are Reviewed. The `--json` queue has `unread: 197` (`evidence/27-status/status-after-fix/`). Nothing was written to Notion.

Next: step 9, `/claim-tagger tag` on the 200 claims (`evidence/28-real-tag-200/`), on the product owner's go.

### 43. Live runbook step 9: the tag run on Claims (2026-10-27)

Done: on the product owner's go, `/claim-tagger tag` ran through the skill (`evidence/28-real-tag-200/`, `console.txt` holds the three printed outputs).
- `pull.mjs --all`: rulebook 13, claims 200, tag decisions 3; no drift; not paused.
- `judge.mjs --items claims`, under edition 2026-10-27.1:
  - read 200 claims for Context-dependent, 7 unsure and re-read;
  - 27 model calls, all ok, in 3 min 16 s; the runbook estimated about 30 calls and 5 minutes;
  - the judge is pinned to claude-sonnet-5-5, and a mismatch would have stopped it with exit 4.
- `propose.mjs`, in 5 min 29 s:
  - wrote the agent's side of all 200 claims and 197 new Tag decisions rows (the 3 audit claims had theirs), and the settings row;
  - its report: "the agent read 200 claims for Context-dependent; 6 wait for you"; 3 claims carry Context-dependent, earlier decisions included.

Verified:
- **Writes.** The propose run sent 796 requests: 398 writes (200 claim updates, 197 ledger creates, 1 settings update), each read back "ok". There were 0 errors, 0 DELETE, no trash fields and no failed request. Its plan touches no editor field (`requests-audit.json`).
- **Status after the run** (`status-after/`): "6 rows wait for you"; Your queue "6 rows, lowest confidence first"; Your decisions "3 to read"; `unread` 0; Next "decide your six claims in Your queue". Agent status is now Done on 194 claims and Waits for you on 6.
- **The view's filter, read live.** The last item left from entry 39 is now checked. The Your queue view's filter is "Agent status is Waits for you and (Review status is not Reviewed or is empty)". Run as a query on the Claims data source (a POST query, which only reads), it keeps exactly the 6 claims, all with an empty Review status, at confidence 0.54 to 0.78 (`status-after/your-queue-view-filter.txt`). So the "or is empty" half (decision 106) does what MF-1 needed.

Found: runbook step 10 asks a person to decide "at least 10 claims in Your queue", but the tag run put only 6 there. The other 194 are Done, since Context-dependent seldom applies to these Debate claims. Ten decisions need 4 more claims, taken from All claims. The 3 audit decisions are already decided and do not count. How many to decide is the product owner's call.

Next: step 10. People decide in Your queue, and possibly in All claims; then `distill --plan-only`, an Opus review, `distill`, a person's approval in Lessons waiting, `promote` and the follow-up (`evidence/29-people-loop/`).

### 44. Decisions P18 to P20: an editor's Claude may decide claims; the design of the decide step (2026-10-27)

Done: the product owner asked me to decide the first 6 claims in Your queue. I declined under hard rule 1 and P8. The product owner then changed the rule: editors will talk to their own Claude, and Claude should be able to decide when instructed. Asked four questions, the product owner chose:
- Claude may decide, including judging the claims itself (P18);
- the three Claims editor columns, on Claims and on practice pages (P18); rule-change approvals and Paused stay with people;
- the Notion connector under the editor's login (P19);
- no marker (P20).

The design is in `CLAUDE-DECIDES.md`, engineering decisions 113 to 116:
- `decide.mjs list`, `open` (records the decisions and writes `runs/DECIDING`) and `check` (reads back and removes the marker);
- the guard hook allows a connector `update-page` naming only the three columns, on a page id an open marker lists;
- the transcript check accepts such writes only in a decide transcript;
- the frozen practice page text waits for a backlog row.

Before deciding, the product owner connected the Notion connector in this session.

Next: a Sonnet coder builds it in a worktree off this branch (2,220 tests expected at the start), then an Opus review; no live decision until the merge and the product owner's word.

### 45. The decide step built, reviewed twice and merged (2026-10-28)

Done: a Sonnet coder built the decide step on `claude-decides`, checking the base first (31a4f0c, 2,220 tests). The commit 2123b82 holds:
- `decide.mjs` (`list`, `open`, `check`);
- the guard hook's allowance (decision 114) and the transcript check's decide mode (decision 115);
- the runner's `run decide`;
- both skills, CLAUDE.md hard rule 1 in the product owner's wording, AGENT.md, CONTRACTS section 19, EDITOR-HANDOVER, README, the backlog row of decision 116;
- `decide.mjs` among the allowed scripts in `.claude/settings.json`. The connector's write entries stay under "ask", so the editor sees each write.

The Opus review said NO-GO. It fed the hook 131 inputs, found nothing outside the spec allowed, and caught 59 of 66 mutants. Findings:
- **M1:** a check that could not read Notion said "nothing was done" after the writes had gone, with the marker gone, so a second "decide the first 6" would decide six other claims.
- **S1:** `open` trusted a pull of any age and could overwrite a person's tags or note.
- **S2:** paths after `open` that never reached `check`.
- **S3:** a mismatch Next line that led nowhere.
- **S4:** peek-style URLs the hook and the connector read differently.
- **S5:** `--run-id SETUP` or `--run-id DECIDING` made the marker folders.
- **S6:** the hook ignored a pause.
- **S7:** the apostrophe form broke the transcript check.
- **S8:** test gaps.

A fix pass (dcb6a6d) addressed every finding:
- **M1:** check gets its own "sent, but could not be read back" sentence, and a `decide check` re-reads the newest run without a write window.
- **S1:** `open` pulls itself and refuses Reviewed claims or a decision that removes tags or note words.
- **S2:** every path ends in `check`, which names the claims "not written".
- **S3:** two Next lines.
- **S4:** every id in `page_id` must be the listed one.
- **S5:** reserved run ids (`lib/reserved-run-ids.mjs`, also for judge), and markers must be regular files, SETUP included.
- **S6:** the hook honours `runs/PAUSED`.
- **S7:** apostrophes go into the JSON as the escape backslash-u0027.

The Opus re-check confirmed each fix:
- 165 hook cases; the 3 that changed verdict are the peek URLs S4 meant to close;
- 86 of 90 mutants caught, the 4 survivors equivalent or minor;
- 2,288 tests.

It left one text MUST: the skill's and CONTRACTS' apostrophe instruction had lost its escape and told Claude to write a plain apostrophe, which would close the quoted argument.

Merged as 040ae6f, then fixed in this session:
- the escape is back in SKILL.md and CONTRACTS.md, written by a node script. The tool-call layer decodes a backslash-u sequence in Edit arguments, which is how it was lost twice. A test now pins it.
- the S1 refusal's Next line is the editor's: "type /claim-tagger decide again; Claude keeps the tags and words already there".
- "correct it" for one claim;
- two stray formatting edits in `lib/paths.mjs` and `transcript-check.mjs` reverted.

Verified: after these fixes 2,289 tests pass, 0 fail (`evidence/01-tests/node-test-claims-hub-decide.txt`; 2,288 plus the test that pins the apostrophe escape). No Notion write in this entry; nothing was decided live.

Not verified live: whether the connector treats markdown characters in a note as formatting; whether `[]` clears a relation the way `null` does; the connector's async answer. CONTRACTS section 19 lists these. The guard trusts a marker file on disk, as it trusts `runs/SETUP`: it stops mistakes, not a session set on getting around it.

Next: the first live decide, on the product owner's word. "decide the first 6" on Claims writes through the connector, with one permission prompt per claim. Then distill for runbook step 10.

### 46. Decisions P21 to P25: the decide step becomes a conversation; the plan (2026-10-28)

Done: the product owner found the decide step too strict for how editors will work. An editor sorts All claims by confidence, reads the agent's tags, and where they disagree either tells their Claude in their own words ("claim x should be y because z") or corrects the tags by hand and asks Claude to write the note, iterating until satisfied. The product owner decided:
- Claude drafts and the editor approves; nothing is written before the OK (P21);
- any claim may be decided, Reviewed or not; an editor may change another editor's review on their OK, and the new tags and note replace the old (P22);
- no permission prompt per write (P23);
- a write may change only the tags, only the note, or both (P24);
- the editor's reasoning stays theirs; Claude adds structure, not substance (P25).

The plan (engineering decisions 117 to 120):
- `list` prints a `seen` fingerprint per claim, and `open` refuses a claim that changed since;
- `list --all` covers the whole table;
- `verified_tags` and `note` become optional in `open`;
- `check` compares only what was written, adds the row "Changed an earlier review", and its mismatch Next line always offers decide again.

The guard hook is unchanged: it already allows any subset of the three columns.

Next: a Sonnet coder builds it off this branch (2,289 tests at the start), then an Opus review; no live decide until the merge and the product owner's word.

### 47. The decide step as a conversation, built, reviewed and merged; decisions 121 and 122 (night of 28 October)

Done: a Sonnet coder built P21 to P25 on `decide-conversation` (cc125b6; base checked, 2,289 tests):
- `list --all` and `--claims` covering Reviewed claims, with a `seen` fingerprint and the agent's reading;
- `open` with optional `verified_tags` and `note`, the Reviewed and removal refusals removed, and a refusal of a changed claim;
- `check` comparing only what was written, with the row "Changed an earlier review";
- the skill's Deciding section rewritten around the draft and the OK;
- the docs and tests to match.

The Opus review said NO-GO:
- **M1:** with update-page under "allow", the guard was the only gate, and a guard that fails to start lets every page update through unprompted.
- **SHOULD 1:** `seen` was not bound to its claim.
- **SHOULD 2:** builder sessions lost their prompt.
- **SHOULD 3 to 5:** when an OK counts, the Claims-table link, and proposals in the compact list.

The Claude Code docs, checked by a guide agent, confirmed that a hook's "allow" skips the prompt only when no ask rule matches, and that a failed hook leaves the normal prompt.

The fix pass (a33e07c):
- update-page is in no permission list, and the guard answers "ask" in builder sessions and accepts only Reviewed (decision 121);
- `seen` hashes the page id and must be 12 hex characters (decision 122);
- the skill says when an OK counts, and that Claude compares `open`'s summary lines with the approved draft before sending;
- the Next lines and the counting are corrected, and the mutation gaps have tests.

The Opus re-check said GO: 187 hook cases, of which 12 changed as intended (builder calls allow → ask, "To review" allow → deny), and 2,307 tests. During the re-check the reviewer ran the coder's mutation script by mistake. It restores each file after mutating it; the worktree was checked clean afterwards, and the merge takes the commit, not the working tree.

Merged as 518e2b7. Then the re-check's SHOULD was added: an unexpected update-page prompt means the guard did not run; answer No, never "Yes, and don't ask again", and tell the engineer (SKILL.md step 3, EDITOR-HANDOVER, and AGENT.md for builder sessions).

Calls made overnight under the product owner's instruction to decide in P21 to P25's spirit: decision 121 (no permission rule rather than "allow", builder sessions "ask", only Reviewed), the "answer No" guidance, and leaving out `"onFailure": "block"`.

Verified: the full suite after the merge (`evidence/01-tests/node-test-claims-hub-decide-conversation.txt`). No Notion write; nothing was decided live.

Next: the guardrail research (Haiku sweeps, an Opus pro-editor review, an Opus check against the code, an artifact), then step 10 on the product owner's word.

### 48. The guardrail audit for pro editors; an old decide run left open (night of 28 October)

Done: the product owner asked, before going to sleep, for a list of the guardrails that would annoy a pro editor ("editors are the owners of the rulebook ... they should be able to operate rather freely"). The answers to the setup questions:
- scope: editor commands, rule changes and the Notion layout;
- nothing is treated as fixed, security rules included;
- each flag gets one line and a severity;
- missing conveniences are listed apart;
- Notion is read only.

The audit ran in three steps:
1. Three Haiku sweeps inventoried every guardrail (`guardrail-audit-2026-10-28/inventory-*.md`).
2. The Opus editor persona flagged 30 and named 10 missing conveniences (`flags-draft.md`).
3. An Opus verifier checked each against the code at 5153eb6: 13 true, 17 partly true and corrected, none false. Several severities came down; it added 3 annoyances, the worst being that a note-only decide leaves Verified tags empty, so the agent's tag counts as Does not apply.

The result is 4 major, 11 moderate and 18 minor flags and 9 missing conveniences, published as https://claude.ai/artifact/MWzo4rj8CFTtpw6iiF9tG5, with a copy in `guardrail-audit-2026-10-28/friction-audit.html`. The four majors:
- a hand edit of the judged tag stops every command;
- a rule change cannot be started directly;
- only one existing numbered rule can change;
- the safety check cannot be overruled, and its examples are out of the editor's reach.

Found: the session "Claims table MVP setup (continue path)" opened a decide run in the live agent folder at 22:38 UTC on 27 October (run 20261027T223853Z-decide, the 6 claims of Your queue, Claude's own verdicts). It used the old one-shot flow and is parked at a prompt. Nothing was written: a read-only status shows all 6 still waiting. Its `runs/DECIDING` marker is past two hours, so the guard refuses its writes. In the morning: answer No in that session, type `/claim-tagger decide check` to read the run back and close it, then decide the 6 again with the new flow.

Next: the product owner reads the artifact and decides which guardrails to loosen; then step 10.

### 49. Live runbook step 10, part 1: the old decide run closed, and the 6 queue claims decided with the new flow (2026-10-28)

Done:
- The parked session could not be stopped from here: the app stops no session that waits at a prompt. The product owner stopped it by hand, but at 09:13 UTC the app still listed its update-page call as waiting. Its hook approved that call at 22:39 UTC, and removing the marker does not withdraw an approval already given. So until the prompt is dismissed, a Yes there would write claim 1 with the old note.
- `decide check` read the old run 20261027T223853Z-decide back: 6 of 6 not written, and the marker removed (`04-check-old-run.txt`). The new check reads a record made before P24 correctly.
- Pull 20261028T090931Z-pull, then `decide list`: 6 claims in Your queue, all Can't tell. Claude judged them: claim 4 (the US-led campaign against Iran) is Context-dependent (Agent slip). The other five do not apply: 2 and 3 are Rule unclear and name rule 3, 5 is Rule unclear and names rule 5, and 1 and 6 are Agent slip. These are the same tags and reason words the old run had. The draft was shown (`03-draft.md`), and the product owner said "Write it".
- `open` (run 20261028T091325Z-decide) took five note-only decisions and one with tags, and its summary lines matched the draft (`05-open.txt`). Six connector calls followed with no prompt: the guard allowed them.
- `check`: 6 decided and read back, 6 differ from the agent, all with a note (`06-check.txt`). Status: Your queue is empty, with 9 decisions to read: the 6 and the 3 from the audit (`07-status.txt`).

Found: the five claims whose tags stay none were sent note-only, as the skill says (give only the fields that change). With Review status Reviewed, an empty Verified tags reads as Does not apply. That is the audit's moderate flag, and here it is what was meant.

Next: the rest of step 10, distill (plan only first), an Opus review, distill, approval, promote and follow-up. Claims 2 and 3 both blame rule 3 as Rule unclear, two distinct claims, so distill should draft a clarification of rule 3.

### 50. The safety check stops blaming a change for old misses, and the FAIL suggestion becomes readable (P33, P34; 2026-10-28)

Found: the product owner ran the rest of step 10 in another session.
- Distill read 9 decisions and drafted one change to rule 3 from claims 2 and 3 ("A name-like description of one program or law says which").
- The first promote stopped because nothing was approved yet (exit 2).
- After the approval, promote ended in FAIL (run 20261028T095657Z-promote; `evidence/29-people-loop/08` to `10`). The only failure was canary-8, "The shift to domestic chips...", which the rule in force also answered wrong. Example claims were counted absolutely, earlier decisions relatively.
- The report's suggested sentence chased that unrelated miss, and the whole rule sat inside its Next line.

Decided by the product owner: P33 (only new breaks block; an old miss gets its own row) and P34 (a formatted suggestion with its reasoning). They also decided:
- Claude setting Approved on the editor's OK is P26 of the other plan;
- this fix is built here, on its own, before that plan;
- today's change stays Approved until the merge.

Done:
- A Sonnet coder made three commits: 2ca3c47, 29347a9 and 4582888.
- Opus code review: GO, with two moderate findings. The transcript check accepted the suggestion part anywhere, and the new row counted examples the change fixes.
- The editor-persona review raised ED-1 to ED-9. The main one: "not counted" sat next to a total that counted the old miss.
- My calls C1 to C6 became decisions 123 to 126.
- Opus re-check: GO, with R1 to R5. Single-quoted phrases could carry paths into the report, and ordinary rule words such as "a second program" were refused.
- Every finding was fixed. Merged as 61df7bb.

Note: the plan file was shared with the session "Claims table MVP setup (explain decide)", and its P26 to P32 draft was in it. On the product owner's word this plan replaced that draft, and that session is to be briefed. This merge takes the numbers its draft had reserved: decisions 123 onwards and work log entry 50.

Follow-ups, not done:
- `cutText` cuts claims mid-word.
- A PASS whose Next line says "nothing waits; type /claim-tagger status to see what is open".
- Product questions from the editor review: should the Rule changes row keep the suggestion, so it outlives the chat (P-1)? Who acts on a "Wrong before the change" example, and is the editor told when it is fixed (P-2)?

Next: on the product owner's instruction, an Opus agent runs `/claim-tagger promote` on the Approved rule-3 change, with evidence in `evidence/29-people-loop/`.

### 51. Live runbook step 10: promote PASS, rule 3 is live (edition 2026-10-28.1; 2026-10-28)

Done: on the product owner's instruction, an Opus agent ran `/claim-tagger promote` once in the main checkout (run 20261028T124052Z-promote, exit 0, no warnings), then status. I checked the run records and git myself.
- PASS: example claims 10 of 10 right, plus 1 more wrong before and not counted (canary-8: 2 of 3 reads say Applies under the rule in force, 3 of 3 under the new text); earlier decisions 5 of 5 still right; both of the editor's rows now right and marked Fixed. 5 items re-read; 4 model calls (everything else from the morning's cached reads).
- 7 Notion writes, all read back: the Rulebook's When to use; the rule change Live with "PASS: examples 10/10 (1 more wrong before, not counted), earlier 5/5, yours 2/2"; Agent settings; two Tag decisions rows Fixed; two claims Done at the new edition.
- The rubric commit 7fc868c ("rulebook edition 2026-10-28.1: ..."). Status: nothing paused, nothing waits, no drift, 1 decision points at a rule (the universities claim, rule 5, below distill's minimum). Evidence `evidence/29-people-loop/11-promote-pass.md`, `11-promote-pass-card.json`, `12-status-after-promote.md`.

Found (none a bug in this run):
- "Earlier decisions 5 of 5" leaves out two decisions the change fixed (FCC/ABC and universities); examples have `fixed_by_change`, earlier decisions do not.
- The Claims table keeps the old agent answers for those two claims until the next tag run.
- canary-8 stays wrong under both rulebooks; recalibrating it is a person's decision.
- The judge sub-runs' report.md files end "Next: type /claim-tagger tag to finish", which misleads a reader of the run folders.

Next: the product owner reviews. Then a tag run to refresh the agent's answers at the new edition, the MVP report artifact, the final Opus verification (`evidence/30-verification/`), and briefing the session "Claims table MVP setup (explain decide)".

### 52. Decisions P35 to P37: editors add Geo claims to Claims; the plan (2026-10-28)

Context: the product owner looked for demo claims. Two candidates I proposed (the Lula and US–Iran conflict claims) and two reset candidates (the Dallas convention and the US-led campaign) were judged "very debatable". Under the live rule, the agent agrees with all 9 earlier decisions, so a reset gives no mistake to show. The product owner then asked how editors can bring specific Geo claims into the loop.

Found:
- Only setup, in a builder session, creates Claims rows.
- `geo-pick.mjs` draws a seeded sample and cannot take specific claims.
- A row typed by hand in Notion is read by the pull, which needs only a Geo ID, but nothing checks it.
- `lib/plan.mjs` refuses the Geo columns for any plan made without the setup flag.

Decided by the product owner, in two question batches:
- P35: editors add by link or ID with no prompt; this is hard rule 10's exception.
- P36: Claim entities in the six spaces, Debate or not; at most 50 per command; the same text is refused.
- P37: not marked; tag stays a separate step; production only.

The design and the plan are in `ADD-CLAIMS.md`. My calls there: a shared row builder for the pick and add; which space a claim takes; unknown Geo Tags left out; an allowance in `lib/plan.mjs` for the script `add` only; a re-read before sending; setup verify counting added rows as information.

Next: the Sonnet build, an Opus code review and an editor-persona review, fix rounds until GO, then the merge. Then stop before any live add.

### 53. `/claim-tagger add` built, reviewed and merged (P35 to P37; 2026-10-28)

Done:
- The Sonnet coder built `add.mjs` and `lib/geo-row.mjs`, with the narrow allowance in `lib/plan.mjs`, the change to setup verify, the skill, the handover and CONTRACTS section 20 (faedde2, 627b8ad). It ran 19 mutations; all were caught after two tests were strengthened. 2,370 tests.
- Opus code review: GO, with one moderate (two editors adding the same claim at once could still make a duplicate, and the docs said it could not) and 9 minor.
- The editor-persona review raised two musts: the report counted refused claims without naming them, and the handover promised that added claims wait in Your queue, which only the unsure ones do. It also raised ten smaller points.
- Fix round 73466ec with my calls C1 to C5. They became decisions 129 and 132.
- Opus re-check: GO, with one moderate (a stopped write under-counted rows that landed) and four minor. Last fixes fe00fc9.
- My own probe found that a typed `[true]`, echoed back, passed the report lint but failed the transcript check. The echo rule went in as 2b63aab.
- Merged as 057bdb9; 2,384 tests (`evidence/01-tests/node-test-claims-hub-add.txt`). Decisions 127 to 132.

Not done or not verified:
- The Notion `or` filter (the re-read and the check after writing) ran only against the fake.
- A real Geo link from a browser address bar has not been tried.
- Both wait for the product owner's live test.

Open for the product owner: should added claims always wait for an editor? An added claim the agent is sure about lands in Done, not Your queue (the editor review's PQ-1). With "not marked" (P37) the agent cannot tell it apart, and a script may not set Review status.

Next: stop. The product owner tests live: `/claim-tagger add <one or two Geo links>`, then `/claim-tagger tag`, with evidence in `evidence/31-add-claims/`.

### 54. Demo mocks: two staged claims for showing the loop, with a checkpoint and a reset (2026-10-28)

Context: the product owner wants to show an editor the loop on claims the agent gets wrong. Real candidates were debatable, and the agent now agrees with every earlier decision. The product owner asked for two mock claims with mock agent tags, set up so they can be decided, distilled and promoted, and reset to a checkpoint on request so the demo can be run twice. They also said (memory: "Owner in conversation") that in conversation guardrails are not to be presented as blockers.

Done: `agents/claim-tagger-mvp/scripts/demo-mocks.mjs`, an owner tool. It is not an editor command and not in the skill.
- `setup` puts two mock claims in Claims (Geo IDs `de000000000000000000000000000001` and `…02`):
  - "The ruling weakens public confidence in the state's election officials": the agent "missed" it (no tag, Does not apply, 0.91);
  - "The European Central Bank should cut interest rates before inflation reaches 2%": the agent "over-tagged" it (Context-dependent, Applies, 0.88).
  
  It also puts their ledger rows in Tag decisions, as if the agent had read them, so that decide, distill, promote and follow-up treat them like real claims. Then it writes `runs/demo-mocks/checkpoint.json` with the edition, Context-dependent's rules and the ids of the existing rule change rows.
- `reset`:
  - rolls back, through `rollback.mjs`, every rule change the test made Live, newest first;
  - sets the test's open rule changes to Rejected;
  - checks that the rules read as at the checkpoint;
  - makes both mocks fresh again, editor columns, readings, the decision copy and Follow-up included.
- `status` shows what changed since the checkpoint.
- Rows are written directly through `lib/notion-rest.mjs`, outside the plan machinery: the product owner's call.

Verified live: `setup` (checkpoint at edition 2026-10-28.1). A test helper then marked mock 1 decided and read (Reviewed, a note, Verified tags, a reading, Follow-up Fixed), and `reset` brought both mocks back fresh. `decide list` shows the mock answers. Then the product owner's first full run on the mocks:
- decide, then distill, which drafted "Named institutions resolve; a bare 'the ruling' does not" on rule 2;
- approve, then promote: PASS at edition 2026-10-28.2 (commit e4f9751), with the follow-up marking both mocks Fixed.

`reset` then rolled the change back through `rollback.mjs` (edition 2026-10-28.3, commit 3a8a50a, the rule change marked Rolled back) and made both mocks fresh. `status` showed no drift, and the working tree came back clean (the earlier decisions file regenerated without the mocks).

What reset does not undo: edition numbers move forward (a PASS and its rollback are two editions with the same text, both committed). The test's rule change rows stay in Rule changes as Rolled back or Rejected; they are out of Lessons waiting and block nothing.

Never run `tag` while the mocks are in Claims: it overwrites the mock answers with real reads. When the demos are over, delete the two mock claims and their two ledger rows by hand.

### 55. Import 400 more Geo claims, chosen by Claude (2026-10-29)

**Context.** The product owner asked for 400 more claims "similar to seeded", with these rules:
- tagged Debate;
- not published by the Geo bot (the personal space "Web Knowledge", `cc0bf85a…`);
- in the canonical spaces except Podcasts;
- spread over publish dates;
- leaning toward claims likely to break the rulebook.

The selection was to be an agentic operation rather than a tight script, and guardrails that block it were to go: "We are the rulers of the rulebook".

The owner's answers:
- about 70% likely issues, the rest near-misses and controls;
- the seed's space weights doubled, with a small share for the extra spaces;
- for the likely issues, infer working tests for the text-only tags (phrasing, grammar, structure), and ignore the tags that need Geo or the web.

The plan is at `~/.claude/plans/i-want-to-import-prancy-muffin.md`. Decisions P38 to P41.

**Done.**

Code (commits 17f78f2 and ff939fc, a Sonnet coder):
- `scripts/geo-query.mjs` sends free-form read-only queries through `lib/geo-read.mjs`. The same refusals apply, and every attempt is logged and counted back. It runs with no permission prompt.
- `config.json` gains:
  - `geo.allowed_spaces`: 12 canonical spaces, Podcasts out;
  - `geo.bot_spaces`.
- `geo.spaces` and the pick are unchanged.
- `add.mjs`:
  - gains `--claims-file` (`schemas/import-selection.schema.json`);
  - has no item cap;
  - takes its spaces from the allowed list;
  - lets Notion make a missing Geo Space option on write. The read-back is unchanged.
- `setup.mjs verify` accepts Geo Space options listed in `structure.json` that are not live yet (`GROWING_OPTIONS`).
- Tests: 2,384 to 2,409, all passing.

Docs and skills:
- A new `import` subcommand and `references/import.md`.
- A copy of the geo-query skill (content-management 0.2.9), with its client section pointed at `geo-query.mjs`.
- DECISIONS P38 to P41, CLAUDE.md rules 2 and 10, the AGENT.md add step and import paragraph, and both `report-examples.md` copies.

The authorship path, found live:
- An entity has no author field.
- Take the smallest `validFromKey` of the claim's Name value versions. The `editVersion` with that `versionKey` has `createdById` (the author's personal space) and `createdAt` (the real publish time).
- Checked on a seed claim ("Add Immigration claims", 2026-07-22) and on the bot's 6,915 edits.

The pool (`evidence/32-import-400/pool-stats.json`):
- The Debate edges were read for all 12 spaces.
- The six extra canonical spaces hold no Debate claims, so the import comes from the seed's six spaces.
- After Claim type, name, first-space-wins, not-in-Claims and same-text: 6,160.
- The bot's claims were dropped: 151. Every claim's author was found.
- That leaves 6,009.
- Months run from 2026-07 to 2026-10, and the edit dates agree with `createdAt`.

The selection:
- Criteria: `criteria.md`, for choosing only (P41).
- Scoring: six Sonnet scorers labelled a seeded, month-spread sample of 2,807 (`labels/`).
- `pick.mjs` chose 400:
  - by space: U.S. Politics 100, World affairs 100, AI 80, Health 60, Crypto 40, Technology 20;
  - by bucket: 279 likely issues, 72 near-misses, 49 controls.
- Crypto had only 12 likely issues in its whole pool and Technology none, so their 30 issue slots went to the four larger spaces. The space totals stayed as asked.
- Tags: Context-dependent 115, Wordy 95, Poor wording 59, Incorrect grammar 17, Trailing period 7, Improper capitalization 3, Multi-sentence 1.
- Months: October 268, September 105, August 25, July 2. Every month in a space's pool is represented, and the split mirrors the pool.

Verified:
- 10 random picks re-checked live: the Debate edge in the space, the Claim type, the space, an author that is not the bot, and the name. All passed, with 0 requests that were not queries.
- `readSelection` validates the file: 400 items.
- The 400 are unique, none is in Claims, and no two have the same text.
- The Opus review of the criteria and 40 picks: GO with notes. It estimates about 74% of the issue bucket are real issues (Context-dependent about 84%, Wordy about 60%, Poor wording about 70%). Applied:
  - the Context-dependent rules quoted verbatim;
  - notes on the contested tests;
  - six label overrides;
  - Context-dependent's share raised to 60% of issue slots;
  - Wordy picks that rest on length alone moved last.

**The import, run live after the owner's yes.** Command: `add.mjs --claims-file docs/mvp-2026-11/evidence/32-import-400/selection.json --run-id 20261029-import-400-add`.
- Exit 0: 400 added and read back, with 0 mismatches and 0 unchecked.
- Geo: 16 requests, 0 that were not queries.
- One claim's Geo Tags "AI" and "debate claim" were left out, because the column has no such options.
- A claims-only pull afterwards: 602 rows (200 seed, 2 demo mocks, 400 imported), 0 duplicates, all 400 present and unread. Geo Space: U.S. Politics 100, World affairs 100, AI 80, Health 60, Crypto 40, Technology 20.
- `status`: "400 new claims not read yet".
- `setup.mjs verify`: "added after setup: 402" and 7 differences, none from the import:
  - three columns people added to Claims (Proposed fix, Reviewer, Filter tags);
  - three view column orders people changed;
  - Context-dependent's When to use against `setup/taxonomy-issue.json`, which promotes have changed since setup.

**Not done or not verified.**
- Nothing is tagged. `/claim-tagger tag` reads the 400 when someone asks: 400 judge reads.
- From the review: only Context-dependent feeds the loop today (distill reads judged tags). The roughly 165 picks for the other tags wait for rules that people write.
- The near-misses lean on "named institution" and "generic government". The controls are easy.
- The demo mocks are still in Claims (entry 54).

**Next.** `/claim-tagger tag` when the owner asks: never while the demo mocks are in Claims (entry 54), or remove the mocks first. Then commit this entry with the docs, skills and evidence.

### 56. The v2 page, checkpoint 1: per-tag decisions, built empty beside the live hub (P42 to P44; 2026-10-29)

**Why.** Today editors decide per claim, and P16 makes every judged tag left out of Verified tags count as Does not apply. With a second judged tag that causes four problems:
- made-up decisions on every claim already Reviewed;
- false disagreements;
- old untagged notes supporting rule changes on the wrong tag;
- editors asked to explain decisions they never made.

The owner chose per-tag decisions (P42). The move happens gradually, on a separate page that the editor, now reviewing the live hub, does not have to see break (P43). Checkpoint 1 is the empty page (P44). Plan: `C:\Users\John Malkovich\.claude\plans\we-could-start-a-melodic-thacker.md`. Branch `v2-page` off `import-claims`.

**Done.**
- **Snapshot.** Production `setup verify` showed 0 writes and the 7 known differences (`evidence/33-v2-page/production-verify-before.md`). The 3 columns people added to Claims (Proposed fix, Reviewer, Filter tags) and the two widened views are the editor's feedback on the live page.
- **Spec.** `STRUCTURE-V2.md`, drafted by Opus. It is reviewed by the editor persona (ED-1 to ED-10). ED-1 (Claim page in Your queue), ED-2 (Lessons waiting with Editor wording) and ED-10 (a wider All claims, an Agent disagreed link) are applied. The rest are open questions 5 to 10 for the owner.
- **Code** (Sonnet, then mine):
  - `lib/v2-profile.mjs` and `v2-profile.mjs init | structure`: the config from the live one, and the structure from the spec with its completion block;
  - `config.mjs`: the v2 shape;
  - every loop script refuses a v2 root;
  - `setup.mjs root`;
  - `notion-build.mjs`: the hub block's `link_text`, and colours for the per-row Agent status;
  - `.gitignore`: `agents/*/profiles/*/runs/`.
  - Tests: 2,409 → 2,441, all passing.
- **Built.** `setup.mjs root` and `build` in the v2 root (`evidence/33-v2-page/build.md`). The page is "Claim tagger v2 (in preparation)" (408273e214eb81d78f78ecfe4885d1ab), under the hub, with 5 tables, 4 views and 0 rows.

**Verified.**
- v2 `setup verify` found no structure differences. Its 6 reports are missing data inputs, which is by design.
- Production `setup verify` after the build: 0 writes, the 7 old differences, and one new difference, the v2 child page on the hub, listed as a "leftover". That is by design until the switch-over; do not remove it.
- The build's 18 writes all name v2 objects.
- An independent Opus read-back sent 116 requests and 0 writes. All six checks passed: page, tables, views, write targets, live tables unchanged (600 / 602 / 13 / 3 / 1 rows, no edits after the build started), and the spec's intent.

**Not done.**
- The open questions 1 to 10 of `STRUCTURE-V2.md` are the owner's to decide.
- v2 Claims has no back-relation to its rows, because the builder makes one-way relations only (open question 6).
- Nothing is committed.

**Next.** Checkpoint 1: the owner clicks through the v2 page and answers the open questions. Then plan checkpoint 2, the keyed data copy.

### 57. The v2 page after the owner's answers (30 Oct, P45 and P46)

Checkpoint 1 was committed as 1690803. The owner answered open questions 1 to 10 in chat (P45). I decided how Agent is right works within hard rule 1 (P46). The editor persona reviewed the new editor-facing words, and its fixes are in the spec. One fix was a design gap: a tick on a Can't tell row would have left the row in no view, so Your queue now keeps such rows.

**Builder.** Sonnet, plus one fix of mine:
- several sorts per view ("; then ");
- checkbox filters and a bracketed "or" group;
- two-way relations (`two_way`), converted in place from one-way;
- hint lines under the hub links (`hub.view_hints`);
- a description sync that only a structure with `sync_descriptions: true` turns on (v2 only);
- `updateDatabase` in notion-rest;
- my fix: Notion refuses a description-only property update (400 "<type> should be defined"), so the update now carries the column's type as Notion reports it (`sameTypeConfig`).

Tests: 2,479 pass.

**Applied to v2** (builder session opened and closed):
- six columns renamed: Claim page to Open claim, Agent reading (twice), Reading note, Follow-up, and Notion's synced column to Tag decisions;
- Agent is right added;
- Open claim made two-way, which Notion accepted on the existing one-way relation;
- three views updated (filter, sorts, columns);
- four hint lines added;
- eight column descriptions and two table descriptions written.

v2 verify: 0 writes, and only the 6 expected missing-data notes. Production verify: 0 writes, rows 13 / 600 / 602 / 3 / 1, and the same 8 differences as after checkpoint 1.

**Not done.** Nothing of this entry is committed. The expected weekly row volume is still open. Next is planning checkpoint 2, the keyed data copy, with the owner.

### 58. Checkpoints 2 and 3 overnight: v2 holds the data and the loop runs on it (29 to 30 Oct, P47 to P49)

The full account is in `OVERNIGHT.md`: its morning summary, plan, progress list and a log line per step with the commit.

**Checkpoint 2.** `copy-live.mjs` (plan, apply, check) copied the first page into v2: 1,219 rows, with the 8 first-page decisions as Tag outcome and Your note. It was read back in full, and no first-page id was written. A re-sync now touches only editor columns on existing rows.

**The swap (P48).**
- `config.json` is the v2 config, `setup/structure.json` the v2 structure, and the per-claim setup files are in `setup/v1/`.
- `runs/` was restarted; the old one is `runs-v1/`, and only the judge store was carried over.
- The rulebook edition is 2026-10-30.1: the same rules, with v2 Rulebook page ids.
- The page is retitled "Claim tagger v2" (P49).

**Checkpoint 3.** The loop was ported per `PORT-V2.md` (Opus design) in four Sonnet packages: decisions per row, ticks recorded in Decided under, no reason words, the guard and decide on the three Tag decisions columns, and the walkthrough parked. Skills and AGENT.md were rewritten by Opus.

**On the real page:** tag read 600 claims with 0 model calls; Your queue holds 29 rows; status, decide list and distill run; tag, distill and copy all re-plan empty.

**Tests:** 2,357 of 2,358 pass. M1 fails only because of the owner's overnight .claude/settings.json edit.

**Independent Opus check:** the first page was not written tonight. Its findings were fixed or listed in the morning summary.

**Not done.**
- The walkthrough port.
- The page-id check in applyPlan.
- The product question on Your queue holding only Can't tell rows.
- The owner's manual steps: revert settings.json, fix the first page's text, and the two orphan rows.

### 59. v2 accepted; `v2-page` merged into `main` and pushed (2026-11-03)

The owner accepted the v2 page. `main` was fast-forwarded to `v2-page` (no merge commit; `main` had nothing of its own since `import-claims`) and pushed to `origin`, together with the tag `claim-tagger-v1`, so the old per-claim version can be found on the remote too.

**Verified before the push:** `npm test` passes 2,358 of 2,358. M1 is green again now that `.claude/settings.json` is restored. `origin/main` was an ancestor of `main`, and no `.env` or credential file is in the diff.

**Left out on purpose:** `agents/claim-tagger-mvp/evals/cases.jsonl` (regenerated by the 30 Oct v2 pull, still uncommitted) and `docs/mvp-2026-11/overnight-permissions.cjs` (the one-night script, untracked).

**Still open:** the items under "Not done or follow-ups" in `OVERNIGHT.md`, and the weekly row volume.

### 60. The v2 claim set replaced: 400 vote-backed Geo claims in, 507 old claims trashed (P51, P52; 2026-11-03)

**Context.** The owner asked to re-choose the claims of v2 Claims with the 29 Oct rules plus two new ones:
- at least one agree and one disagree vote ("≥1 agree, ≥1 disagree");
- a preference for the most votes with a similar vote ratio.

The old set was to go: "600 previous claims removed, 400 new added", keeping the old claims that are also in the new set. Plan: `~/.claude/plans/i-want-to-import-prancy-muffin.md`. Branch `replace-claims` from `main` (6206b75).

The owner's answers:
- remove hard rule 8 (P51);
- keep the 8 decided claims, and the 27 claims with a row waiting in Your queue;
- no space quotas;
- rank by most votes, with a split worse than 3:1 last (P52).

**Found.**
- Geo's positions are the `agrees` and `disagrees` vote counts on the entity. They match `votesCountsConnection` voteKind 1; the owner's sample claim has 8 and 5.
- The vote rule leaves a small pool: 547 claims after the bot (20 left out) and repeated texts (5).
  - By space: U.S. Politics 203, AI 156, World affairs 102, Health 46, Crypto 38, Technology 2, the other canonical spaces 0.
- Vote-backed claims are mostly clean sentences. Only about 29 in the pool look like likely issues, against about 14% of the general Debate sample on 29 Oct.

**Code** (Sonnet, commits 4eb9bc6 and 66ce0cd, reviewed by Opus):
- `notion-rest.mjs`: `trashPage` / `untrashPage` (`archived` for the client's 2022-06-28 API, `in_trash` from 2026-03-11).
- A `trash` plan op, allowed only to the script `remove` on Claims and Tag decisions, never on a protected, first-page or table id.
- `scripts/remove.mjs plan | apply | restore`, which asks every time:
  - keeps selected, decided, cited (page bodies included) and, with `--keep-waiting`, waiting claims;
  - writes the snapshot and summary before the plan;
  - apply re-checks against a fresh pull, trashes a claim only after all its rows read back trashed, stops on `runs/PAUSED`, resumes, and writes `setup/removed-claims.json`.
- `copy-live.mjs` skips removed claims, and `setup.mjs verify` expects them gone.
- No code or test cites hard rule 8 any more; the protections it named stay, cited as P51.
- Tests: 2,358 → 2,415, all passing.

**Rules and docs.** CLAUDE.md rule 8 is marked removed (the number kept) and rule 10 names `remove.mjs`. DECISIONS P51 and P52. AGENT.md (the scripts table and the replacement). The skill's import section, and `references/import.md` "Replacing the set". Evidence: `evidence/34-replace-400/`.

**The selection.**
- Labels: 275 pool claims reused their 29 Oct labels; 272 were labelled by two Sonnet scorers against `criteria.md`.
- The first Opus review (GO with notes) led to:
  - generic you/we labelled one way;
  - four Context-dependent misses added;
  - the owner's choice between three readings of the ranking.
- The final 400:
  - 58 already in v2 and 342 new, one of them added after the trash: `2b59691d…`, whose same-text twin `c6f4b830…` was in v2;
  - by space: U.S. Politics 148, AI 124, World affairs 73, Health 30, Crypto 24, Technology 1;
  - by month: Jul 9, Aug 116, Sep 178, Oct 95, Nov 2 (every space-month of the pool represented);
  - 28 likely issues (9 Context-dependent), 144 near-misses, 228 controls.
- 10 random picks re-checked live: all pass (`recheck.json`).

**Live.**
- Add: exit 0, 341 added and read back, 0 mismatches, 58 already in Claims, Geo 14 requests with 0 that were not queries.
- Remove plan: 507 Claims rows and 507 Tag decisions rows, the same 1,014 rows as the dry plan.
  - Kept: 399 selected, 8 decided, 0 cited (both cited claims are decided), 27 waiting.
  - Snapshot copied to `evidence/34-replace-400/remove/`.
- Remove apply: exit 0, 1,014 done, 0 failed, 0 mismatches, every row read back as in the trash. `setup/removed-claims.json` lists 507 Geo IDs, and the ledger is in `evidence/34-replace-400/remove/`.
- The twin `2b59691d…` was added after the trash: exit 0.
- After:
  - a pull: Claims 435 (400 selected, 8 decided, 27 waiting), Tag decisions 95 (the kept claims' 93 rows and the 2 demo rows), 0 duplicates, drift 0;
  - `status`: 342 new claims not read yet, 29 rows in Your queue;
  - `evals/cases.jsonl` holds the 8 decided cases;
  - `copy-live.mjs plan`: 0 creates, with 507 + 507 first-page rows skipped as removed;
  - `setup.mjs verify`: 507 "removed on purpose and absent", and 0 differences from the replacement. Its 12 differences come from people's edits: the adopted rules, a Priority column on the Rulebook, a view's columns, and the settings edition label.
- Found afterwards:
  - The first page has 37 claims with an editor's mark. 28 of them are decisions made there after the 30 Oct copy; all are on kept claims, and `copy-live` would copy them as updates (not applied).
  - One trashed claim, "Hydrogen should be reserved for industries that are difficult to elect…" (`f85b5131…`), has a first-page note but is not Reviewed. It is reported to the owner.

**Also today.** People wrote When to use in the v2 Rulebook for eight tags without rules. The first pull of the day adopted them (hard rule 5) as edition 2026-11-03.1 (commit 7a8dd0a). Judged tags are now Context-dependent plus Trailing period, Multi-sentence, Improper capitalization, Incorrect grammar, Poor wording and Wordy, so the next `tag` reads seven tags per claim.

**Not done.** Nothing is tagged: the 342 new claims wait for `/claim-tagger tag`, now 7 judged tags per claim. Nothing is pushed.

### 61. A Judged box on the Rulebook decides which tags are judged; the seven Priority 1 tags ticked (P53, P54; 2026-11-03)

**Context.** The owners wrote When to use for the text tags and added a Priority column (1 to 3) to the v2 Rulebook. The pull adopted the rules as edition 2026-11-03.1 (commit 7a8dd0a). They want Priority 1 judged. They chose an explicit checkbox **Judged** over Priority: a tag is judged only when it is ticked. Their answers:
- toggles are free in both directions, each one an edition with a changelog line (P54);
- no hand-picked canaries.

On the second point the owner was right: the safety check reads a change against the rows it rests on and every earlier editor decision on that tag. So it never HOLDs a real rule change, and tagging never waits on it.

Plan: `~/.claude/plans/i-want-to-import-prancy-muffin.md`. Branch `judged-tick` (a Sonnet coder in a worktree), fast-forwarded into `replace-claims`.

**Before.**
- The judge ran only the tags in `config.json` `judge.groups` (G1 = Context-dependent).
- `rubric.json`'s `judged` meant "has rules and is a text tag".
- Drift locked a tag's rules once the tag was in a group.

**Code** (6be41c4 and 1f649e9):
- `judged` = ticked, with rules in force, a text tag. The tick is not in the tag hash.
- `rubric.lock` gains a `judged` map. A lock without it is read as Context-dependent only (`LEGACY_JUDGED_TAGS`, `withLockedJudged`).
- `judgeGroupOf` / `isJudgedTag` (lib/config.mjs) replace every "judged and in a group" check.
- G2 = Trailing period, Multi-sentence, Improper capitalization, Incorrect grammar, Poor wording, Wordy. A ticked tag no group names gets a group of its own.
- The G1 store key is unchanged (`sha256:04c9114c423fd858`, pinned).
- A changed box is a drift kind of its own (`toggled`). It is taken over by the next loop command, or by `judge.mjs` when it runs on its own, as one edition with one changelog line per tag. It never stops the loop.
- Pulls stamp their drift with the lock they compared against (`against`). Preflight takes a change over only while that lock is in force, never while a builder session is open, and never from a loop child's judge or during a live promote.
- `setup.mjs seed-judged --tags` is the only script that may write Judged, and only to tick. Judged is an editor column of the Rulebook, and the guard and transcript-check deny connector writes to it.
- `writeEdition` refuses a second writer of the same edition with a different lock.
- Tests: 2,415 → 2,475, all passing.

**Reviewed by Opus.** The first review was GO with fixes. It reproduced a high finding: a toggle pending at a promote let the follow-up's judge re-adopt from the older pull, putting back the old rule text. Also:
- a promote baseline adopting mid-promote;
- Context-dependent un-judged between the build and the seed;
- readers judging seven tags before the first adoption;
- three low findings.

All were fixed in 1f649e9. The re-check was GO. The reviewer re-ran the reproduction and walked the live order on a copy of the real rubric files: six "Judged on" lines in one edition, G1 key unchanged, Context-dependent judged throughout.

**Rules and docs.**
- CLAUDE.md:
  - rule 1: Judged is editor-owned, seeded once;
  - rule 4: the owners' untick, edit, re-tick exception;
  - rule 5: judged only when ticked with rules in force; toggles adopted as editions;
  - rule 10: the Rulebook accepts Judged only from `seed-judged`.
- DECISIONS P53 and P54.
- AGENT.md, STRUCTURE-V2.md (the Judged column, after the section's tag list, which the spec parser reads), and the skill description ("the tags ticked Judged").

**Live.**
- `setup.mjs builder open`, then `setup.mjs databases`: 1 column added, Rulebook Judged. Only `databases`, not `build`: the views step would have reset the Tag decisions view the team widened.
- `setup.mjs seed-judged --tags "<the seven>"`: exit 0, all seven ticked and read back. Its own pre-pull warned that no box was ticked yet; that pull un-judged nothing. Then `builder close`.
- `pull --all` (20261103T170627Z-pull):
  - drift: six "Judged on" lines (Context-dependent was judged already), stamp `against` 2026-11-03.1, no stops;
  - rulebook norm: Judged true on exactly the seven.
- `status`: edition 2026-11-03.1 with "Notion changed the Judged box (Judged on: …), taken over at the next run"; 29 rows in Your queue; 342 new claims not read yet.
- `setup.mjs verify`: 0 writes and 20 differences, all expected:
  - Priority (people's column);
  - the Rulebook's own view does not show Judged (the views step was skipped);
  - the Tag decisions view the team widened;
  - the Rulebook rows against the 27 Oct taxonomy file: the adopted When to use and the new Judged values;
  - the settings edition label.

**Not done.**
- The first adopting command, normally `/claim-tagger tag`, takes the six ticks over as edition 2026-11-03.2 (or 2026-11-04.1 after midnight UTC), then judges 435 claims on seven tags. G1 is mostly from the store; G2 is about 55 new model calls and about 2,600 new Tag decisions rows. Not run: nothing is tagged until the owner asks.
- Judged is not shown in the Rulebook's own view. Show it from the view's properties menu in Notion, or run the views step, which would also reset the Tag decisions view.
- From the re-check (low, not on the live path):
  - preflight has no PROMOTING check of its own, so another session's command can adopt a toggle during a promote. This was so before this branch too.
  - If `seed-judged` stops partway and the builder session is closed before it is run again, Context-dependent can be read as unticked.
  - `setup.mjs rubric` with a rubric file but no lock builds with no ticks.
  - A cosmetic double warning.
- Nothing is pushed.

### 62. The first tag run on seven tags; the judge's exit 13 fixed (2026-11-03)

**Context.** After entry 61 the owner typed `/claim-tagger tag` in the editor session.

**Exit 13 (b6782dd).**
- The first attempt (20261103T171155Z-judge) exited 13 before reading a claim. Its run.json still says "running".
- Cause: `judge.mjs` ends in `process.exitCode = await main(...)`, so it is still being evaluated while it runs. The Judged takeover (1f649e9) loaded `lib/preflight.mjs` from inside `main`, and preflight imported `judge.mjs` for `driftStops`. Each module waited for the other, and Node exited 13 ("unsettled top-level await"). The tests import `judge.mjs` as a module, so they never saw it.
- Fix: `driftStops` moved to `lib/rubric.mjs` (`judge.mjs` re-exports it), so preflight no longer reaches `judge.mjs`.
- Two tests in `preflight.test.mjs`: preflight's import tree never reaches `judge.mjs`, and `judge.mjs` run as a program with a toggle pending takes it over and exits 0. Both fail on the old code. Tests: 2,477 pass.
- The failed attempt wrote nothing.

**The run.**
- 20261103T171926Z-judge took the six ticks over as edition 2026-11-03.2 (six "Judged on" lines in the changelog, the lock's `judged` map), then stopped after 93 of 435 claims: the `claude` CLI's login had expired (exit 1). Nothing was written to Notion.
- After the owner logged in again, 20261103T172514Z-judge (a new run; the 93 came back from the store): 435 read, 50 unsure, 53 re-read, 105 calls (G1 45, G2 60), Sonnet 5.5, 18 minutes. The G1 store key is unchanged (`04c9114c423fd858`); G2's is `6b0593df939c7354`.
- 20261103T174339Z-propose: 2,952 Tag decisions rows created, 93 updated (the kept claims' Context-dependent rows, Rulebook edition only), 435 claims and the settings row updated. 3,481 writes, 0 failed, 0 mismatches, 48 minutes.

**Checked against Notion** (pull 20261103T183655Z-pull, `status --json`):
- Claims 435, all on edition 2026-11-03.2: 386 Done, 49 waiting.
- Tag decisions 3,047: 435 for each of the seven tags, plus the 2 demo rows (`de0000…01`, `…02`). 0 duplicate keys.
- Your queue 52: the 29 from before and 23 new (Wordy 12, Context-dependent 5, Poor wording 4, Incorrect grammar 2). Decided 8, unchanged. `same_as_notion` true, no toggle pending.
- The six new tags: 3 Applies in 2,610 rows (Multi-sentence 0.97, Improper capitalization 0.85 on "U.S Economy", Wordy 0.78), 18 Can't tell, the rest Does not apply. Spot-check against the text: no claim ends in a period (Trailing period has 0 Applies), and exactly one claim has two sentences (the one Multi-sentence Applies). The set was picked for votes, not for likely issues (P52), so few hits is expected.

**Committed.**
- Edition 2026-11-03.2: `rubric.json`, `rubric.lock`, `CHANGELOG.md`, `history/2026-11-03.2.json`.
- `evals/cases.jsonl`, regenerated by the 30 Oct v2 pull and left out until now (entry 59). It holds the 8 decided rows of v2. The audit's Iran case (`4aa87f42…`, Applies) is not among them: its v2 row is not decided.

**Not done.**
- The editors' review of Your queue: 52 rows, more than one sitting.
- The two demo rows (the owner's manual step, entry 58).
- The open items of entry 61.
- Nothing is pushed.
