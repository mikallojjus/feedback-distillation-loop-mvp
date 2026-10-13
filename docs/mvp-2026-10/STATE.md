# STATE.md — claim-tagger editor-feedback-loop MVP

- Started: 2026-10-13 (plan approved mid-day; see `plan.md` in this folder for the full approved plan)
- Orchestrator: Claude Code session in `X:\work\research\overnight-feedback-loop-research`, folder `X:\work\geo-agents` added to the session
- Notion hub page: https://app.notion.com/p/3da273e214eb80c180d5fd0894bc2db8 (writes only inside it)
- Identities: integration token (bot "claude") in `X:\work\geo-agents\.env` for scripts; the connector (Mika) for the interactive skill and persona decisions
- Current phase: **Day 0 / day-1 checks** (skeleton created, token verified read-only, CLI flag check running)

## Phase plan
| Phase | Status |
|---|---|
| 0 Skeleton, token, docs, memory | in progress |
| 1 Day-1 checks (CLI flags, hooks, DDL, formulas, view DSL, subagent connector) | in progress |
| 2 lib + schemas + allowlist + hooks | pending |
| 3 pull, plan, verify | pending |
| 4 setup + seed (Notion) | pending |
| 5 judge (fake, smoke, canary baseline) | pending |
| 6 propose + first tag run | pending |
| 7 distill, eval, promote, followup, status | pending |
| 8 SKILL.md, README, headless tests | pending |
| 9 Demo storyline end to end | pending |
| 10 Persona reviews, dispositions | pending |
| 11 Artifact | pending |

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
