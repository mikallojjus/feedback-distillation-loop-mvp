# State

| Item | Value |
|---|---|
| Phase | Stage 1 (structure approved 2026-10-15): building setup, judge and the loop scripts; the Notion tables are created once setup is verified on the fakes |
| Checkpoint 1 (structure proposal) | Approved as proposed on 2026-10-15 (decision P1); page https://app.notion.com/p/3fa273e214eb81ef8504cb40e3bd7052 |
| Checkpoint 2 (final demo) | not reached |
| Branch | `mvp-2026-11` |
| Parent Notion page | "Feedback Distillation MVP", 3fa273e214eb805199f3d12ef01db453 |
| Notion ids created by this build | page "Structure proposal" 3fa273e214eb81ef8504cb40e3bd7052 (also in `config.json` under `notion.pages.proposal`). No table yet. |
| Artifact | https://claude.ai/artifact/EHcW9M6Y8TMCHbeDu3pVtr, "Claim tagger MVP", version 1 (checkpoint 1); rebuild with `node gen-parts.mjs && node build.mjs --strict` in `docs/mvp-2026-11/report/`, republish the same file path |
| Builder session | closed (`runs/SETUP` absent) |
| Read-only facts | `sweeps/live-schemas.md`, `evidence/03-audit-context-dependent-decisions.json`; the REST token reads the parent page, the real claims table, the taxonomy and the audit table (GET only) |

## After "go"

1. Fetch the proposal page, convert back to the repository shape, diff against `STRUCTURE.md`; adopt the product owner's edits into `STRUCTURE.md` and `setup/structure.json`; log the diff in `WORKLOG.md`.
2. Run the read-only dry run of the real table and the 50-claim pick (`pull.mjs --source real_claims --dry-run`, then `--pick 50 --seed mvp-2026-11 --audit evidence/03-...json`); save the report and the request log under `evidence/`.
3. Read the taxonomy's 13 rows once through the connector into `setup/taxonomy-issue.json`.
4. `setup.mjs` builds the page tree, the five tables, the views, the rows (13 rulebook, 50 claims, 10 seeded decisions, 1 settings), the rubric edition `<date>.1` and the canaries; read back and diff against the approved structure.

## Running subagents (model, what each was asked, what it writes)

| Agent | Model | Asked | Writes |
|---|---|---|---|
| Foundation coder | Sonnet | `lib/config.mjs`, `lib/report.mjs`, `lib/rubric.mjs`, the schemas, `tests/mvp/fixtures/fake-notion.mjs`, tests | `agents/claim-tagger-mvp/scripts/lib/{config,report,rubric}.mjs`, `schemas/`, `tests/mvp/` |
| Pull and plan coder | Sonnet | `lib/plan.mjs` (plan, check, apply, ledger, read-back, resume), `pull.mjs` (tables, dry run of the real table, the 50-claim pick), tests | `scripts/lib/plan.mjs`, `scripts/pull.mjs`, `schemas/plan.schema.json`, `tests/mvp/` |
| Judge coder | Sonnet | `lib/cells.mjs`, `prompts/judge.md`, `judge.mjs` (adaptive runs, error classes, calls log, report), `tests/mvp/fixtures/fake-claude.mjs`, tests; may add a `fakeScript` option to `lib/claude.mjs` | `scripts/lib/cells.mjs`, `scripts/judge.mjs`, `prompts/judge.md`, `tests/mvp/` |

## Finished subagents

Haiku digests in `sweeps/`; the library coder (88 tests, committed `7e5ad24`); the proposal drafter (Opus); the artifact scaffold (Sonnet).
