# STATE.md — claim-tagger editor-feedback-loop MVP

- Started: 2026-10-13 (plan approved mid-day; see `plan.md` in this folder for the full approved plan)
- Orchestrator: Claude Code session in `X:\work\research\overnight-feedback-loop-research`, folder `X:\work\geo-agents` added to the session
- Notion hub page: https://app.notion.com/p/3da273e214eb80c180d5fd0894bc2db8 (writes only inside it)
- Identities: integration token (bot "claude") in `X:\work\geo-agents\.env` for scripts; the connector (Mika) for the interactive skill and persona decisions
- Current phase: **Day 1 / Notion structure built; lib and seed agents running** (databases, formulas, rollups, views and hub layout done 13 Oct ~14:30)

## Phase plan
| Phase | Status |
|---|---|
| 0 Skeleton, token, docs, memory | done |
| 1 Day-1 checks (CLI flags, DDL, formulas, view DSL, subagent connector) | done; hooks checked in the headless test later |
| 2 lib, schemas, allowlist, guard hook | done |
| 3 pull, plan, apply, verify (REST, token) | done |
| 4 setup + seed applied to Notion (14 + 60 + 50 + 1 rows, verify clean) | done |
| 5 judge (Haiku smoke 5/5 ok; Sonnet tag run 60 x 3 and eval baseline running in background) + propose (report pending) | in progress |
| 6 first tag run → propose → apply | pending (after the Sonnet run) |
| 7 eval done; distill, promote, followup, status, cases-sync pending (agent F after B and C) | in progress |
| 8 SKILL.md, README, headless tests | pending |
| 9 Demo storyline end to end | pending |
| 10 Persona reviews, dispositions | pending |
| 11 Artifact frame built (build checks clean, 63 TODO placeholders); content after the demo | in progress |

## Notion ids (filled as created)
- Hub page: 3da273e214eb80c180d5fd0894bc2db8
- Databases sub-page: (pending)
- Engineer notes sub-page: (pending)
- Data sources: (pending)

## Subagents
- running: connector-access check (Haiku)

## Known problems
- Bash heredocs with apostrophes fail in this Git Bash: write files with the Write tool.
- Never put the token in any file except `.env`.

## Notion ids (created 13 Oct)
- Databases page 3f8273e214eb81c59b0cc7576b1bb62f; Engineer notes page 3f8273e214eb8137a13cd8d4d483b936
- Rulebook db 89043d4a749041ffb834f96a5239e148 / ds 319e6022-0b6a-4068-b560-99c83fae5bdf
- Claims db 9418c3f625d24b439539f381b7ff03c2 / ds 506dddee-af6e-4cbe-980f-a1ef1564d9bd
- Tag decisions db de7a08f6d3ae4c08b9387e6d762d79f2 / ds 92c9f4a9-f729-447b-88b9-982ff0e97074
- Rule changes db 833efad0634f43608ca18e4f7291cc02 / ds e1836e35-d614-4434-ab34-a0ddeaa1842c
- Runs db 0c397590fb154ddb98010830faaa159b / ds e1f2103e-6233-468c-91b4-2c2382e86d1b
- Agent settings db 43c8a1c3a8d44a7f824698b4789cffe6 / ds 5de4f0e4-21ab-417c-b9a5-06bbc6c143eb
