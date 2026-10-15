# State

| Item | Value |
|---|---|
| Phase | Stage 0, nearly done: the structure proposal is being drafted; code for Stage 1 has started against the proposed structure |
| Checkpoint 1 (structure proposal) | not reached; the proposal page is not yet in Notion |
| Checkpoint 2 (final demo) | not reached |
| Branch | `mvp-2026-11` |
| Last commit on the branch | `fc7eaa9` contracts note |
| Parent Notion page | "Feedback Distillation MVP", 3fa273e214eb805199f3d12ef01db453 (empty, read-only so far) |
| Notion ids created by this build | none |
| Artifact | not published |
| Read-only facts | `sweeps/live-schemas.md`, `evidence/03-audit-context-dependent-decisions.json`, the REST token reads the parent page, the real claims table, the taxonomy and the audit table (GET only) |

## Running subagents (model, what each was asked, what it writes)

| Agent | Model | Asked | Writes |
|---|---|---|---|
| Library coder | Sonnet | Copy `paths.mjs`, `notion-rest.mjs` (add createDatabase, createPageUnderPage, createView, retrieveView, listViews, retrieveDataSource, queryDataSource, updateDataSource, retrieveBlockChildren, requestLogger, countRequests; create-uncertain for databases and views; no delete), `claude.mjs` (usage window split from transient errors, withTransientRetry, refuse --bare and --fallback-model); shims for the unchanged modules; tests | `agents/claim-tagger-mvp/scripts/lib/`, `tests/mvp/{paths,notion-rest,claude}.test.mjs` |
| Foundation coder | Sonnet | `lib/config.mjs`, `lib/report.mjs` (three-part report writer with lint), `lib/rubric.mjs` (rules and examples parsing, hashes, editions, lock, history, changelog, drift), the schemas, the in-memory Notion fake; tests | `agents/claim-tagger-mvp/scripts/lib/{config,report,rubric}.mjs`, `schemas/`, `tests/mvp/fixtures/fake-notion.mjs`, tests |
| Proposal drafter | Opus | `STRUCTURE.md` and `STRUCTURE.notion.md`: five tables with columns, values, who fills what and sample rows from the audit's real claims; four views; three sub-pages; words list; open points | `docs/mvp-2026-11/STRUCTURE.md`, `STRUCTURE.notion.md` |
| Artifact scaffold | Sonnet | `docs/mvp-2026-11/report/` from the Geo recipe: four tabs (Status, How to run, Structure, Backlog), `gen-parts.mjs` from `STRUCTURE.md` and `BACKLOG.md`, strict build | `docs/mvp-2026-11/report/` |

## Finished subagents

Haiku digests in `sweeps/` (W3, W4, library, orientation, artifact recipe). Their reports are summarised in `WORKLOG.md` entries 3 to 5.
