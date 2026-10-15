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
