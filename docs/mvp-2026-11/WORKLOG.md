# Work log: claim-tagger MVP (build started 2026-10-15)

Append-only. One numbered entry per step: what was done, what was verified, what comes next. A new session reads this file first, then STATE.md.

## State at the last entry

- Phase: Stage 2 (2026-10-15). Stage 1 is live in Notion under the parent page: the approved structure, 13 rulebook rows, 50 claims, 10 seeded decisions, edition 2026-10-15.2 (the restore after the drift check), 11 canaries; the first real run tagged the 50 claims (2 open queue rows).
- Checkpoint 1 (Notion structure proposal): approved as proposed on 2026-10-15 (decision P1).
- Checkpoint 2 (final demo): not reached. Remaining: the calibration of manifest 2026-10-15.3 (three runs; run 5 in flight), the rollback read-back on a passed page, the walkthrough evals under Demo tests, the verifier, the artifact republish, a fresh practice page for the product owner.
- Done since the last state: calibration runs 2 to 4 of manifest .2 (two PASS after one wording round each, one not passed), the headless checks for the demo's tag, distill and promote (acceptance check 7), two fixes (verify after a PASS, rejected replies kept), manifest .3 with a new story (decision 37).
- Branch `mvp-2026-11`; the last commit is the newest one in `git log`.
- Notion: ids in `agents/claim-tagger-mvp/config.json` and STATE.md. The builder session is closed. Practice pages under Demos: calibration 1 to 5 (ids in `runs/demos/`).
- Artifact: https://claude.ai/artifact/EHcW9M6Y8TMCHbeDu3pVtr (version 1, checkpoint 1).
- Blockers: none open (B1, the malformed token, was fixed by the product owner on 2026-10-15).

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
