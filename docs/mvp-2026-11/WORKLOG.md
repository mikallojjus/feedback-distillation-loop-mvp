# Work log: claim-tagger MVP (build started 2026-10-15)

Append-only. One numbered entry per step: what was done, what was verified, what comes next. A new session reads this file first, then STATE.md.

## State at the last entry

- Phase: Stage 0 (branch, working directory, sweeps, CLAUDE.md amendment, settings, read-only dry run, structure proposal).
- Checkpoint 1 (Notion structure proposal): not reached.
- Checkpoint 2 (final demo): not reached.
- Branch `mvp-2026-11`; nothing committed on it yet.
- Notion: nothing created. Parent page "Feedback Distillation MVP" = 3fa273e214eb805199f3d12ef01db453.
- Artifact: not published.

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

Done: read-only. The taxonomy's schema and its 13 Issue rows (the rows whose Work tags contain "Issue": Context-dependent, Exact duplicate, Factually challenged, Improper capitalization, Improperly sourced, Incorrect grammar, Multi-sentence, Poor wording, Semantically duplicated, Source inaccessible, Trailing period, Unsourced, Wordy; a Polarity filter gives a different set of 12 that includes Hypothetical and Predictive, so the copy is defined by Work tags). The real claims table's schema (22 columns; `sweeps/live-schemas.md`). The 9 October audit lives in "Claims to review" (protected); its 10 decided Context-dependent rows (8 Agree, 2 Disagree: Georgia and COVID) are saved in `evidence/03-audit-context-dependent-decisions.json` with the mapping to Applies / Does not apply. The library digest arrived (`sweeps/lib-digest.md`); the Sonnet coder building the new library layer was told to refuse the two forbidden CLI flags in code.

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
