# State

| Item | Value |
|---|---|
| Phase | Stage 1 (structure approved 2026-10-15): building setup, the loop scripts and the walkthrough pieces; the Notion tables are created once setup is verified on the fakes |
| Checkpoint 1 (structure proposal) | Approved as proposed on 2026-10-15 (decision P1); page https://app.notion.com/p/3fa273e214eb81ef8504cb40e3bd7052 |
| Checkpoint 2 (final demo) | not reached |
| Branch | `mvp-2026-11` |
| Parent Notion page | "Feedback Distillation MVP", 3fa273e214eb805199f3d12ef01db453 |
| Notion ids created by this build | page "Structure proposal" 3fa273e214eb81ef8504cb40e3bd7052 (`config.json` `notion.pages.proposal`). No table yet. |
| Artifact | https://claude.ai/artifact/EHcW9M6Y8TMCHbeDu3pVtr, "Claim tagger MVP", version 1 (checkpoint 1); rebuild with `node gen-parts.mjs && node build.mjs --strict` in `docs/mvp-2026-11/report/`, republish the same file path |
| Builder session | closed (`runs/SETUP` absent) |
| Inputs ready for setup | `setup/taxonomy-issue.json` (13 rows + Self-contained, connector read 2026-10-15), `setup/claims-pick.json` (50 claims, seed `mvp-2026-11`), `evidence/03-audit-context-dependent-decisions.json` (10 seeded decisions), `evidence/04-dry-run-real-claims/` (34 requests, 0 writes) |

## Stage 1 run order (after the setup coder's hand-back)

1. `setup.mjs structure --from-proposal docs/mvp-2026-11/STRUCTURE.md`; `setup.mjs preview`; `setup.mjs api-check`.
2. `setup.mjs builder open --reason "stage 1 setup"`; `setup.mjs all --taxonomy agents/claim-tagger-mvp/setup/taxonomy-issue.json --claims agents/claim-tagger-mvp/setup/claims-pick.json --audit docs/mvp-2026-11/evidence/03-audit-context-dependent-decisions.json`; `setup.mjs verify`; `setup.mjs builder close`.
3. Evidence: the structure diff (acceptance check 3), the request log, the ledgers; commit; update the config and this file with the ids.
4. The real run on the copy: `pull --all`, `judge --items claims`, `propose` (acceptance check 4); the queue shown.

## Running subagents (model, what each was asked, what it writes)

| Agent | Model | Asked | Writes |
|---|---|---|---|
| Setup coder | Sonnet | `lib/notion-build.mjs` (structure from the proposal, databases and views through REST 2026-03-11, verify), `setup.mjs` subcommands (structure, preview, api-check, pages, databases, views, rulebook, claims, seed-audit, rubric, canaries, settings, verify, all) | `scripts/lib/notion-build.mjs`, `scripts/setup.mjs`, `setup/structure.json`, tests |
| Loop coder | Sonnet | `propose`, `distill`, `promote` (safety check, PASS and FAIL writes, automatic follow-up, wording sentence), `followup`, `rollback`, `restore`, `status`, `lib/preflight.mjs`, the distill and wording prompts, the end-to-end loop test | `scripts/*.mjs`, `prompts/`, tests |
| Blocks coder | Sonnet | `lib/notion-blocks.mjs`: Markdown to REST blocks with markers, preview, the practice-page lint | `scripts/lib/notion-blocks.mjs`, tests |
| Walkthrough drafter | Opus | `walkthrough/manifest.json` and `walkthrough/page.md` from the design, the real claims and the taxonomy read | `agents/claim-tagger-mvp/walkthrough/`, `docs/mvp-2026-11/WALKTHROUGH-DRAFT-NOTES.md` |

## Finished subagents

Haiku digests in `sweeps/`; library coder (88 tests); foundation coder (195 tests); pull and plan coder (63 tests); judge coder (112 tests); proposal drafter (Opus); artifact scaffold (Sonnet). Suite: 1,323 tests pass.
