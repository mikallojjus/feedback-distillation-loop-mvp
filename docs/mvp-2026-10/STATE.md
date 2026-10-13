# STATE.md — claim-tagger editor-feedback-loop MVP

- Started: 2026-10-13 (plan approved mid-day; see `plan.md` in this folder for the full approved plan)
- Orchestrator: Claude Code session in `X:\work\research\overnight-feedback-loop-research`, folder `X:\work\geo-agents` added to the session
- Notion hub page: https://app.notion.com/p/3da273e214eb80c180d5fd0894bc2db8 (writes only inside it)
- Identities: integration token (bot "claude") in `X:\work\geo-agents\.env` for scripts; the connector (Mika) for the interactive skill and persona decisions
- Current phase: **Handed over** (13 to 14 Oct 2026): demo done (LS-1 gated five times, honest FAIL each time; LS-2 planted gate FAIL and rolled back); both persona reviews closed in round 2; engineer must-fixes in code (commits 9d66fab, 860246d; 856 tests); artifact published at https://claude.ai/artifact/U88vn7nPeaRufmrMVXwjB1; actions left for Mika listed under Handover

## Phase plan
| Phase | Status |
|---|---|
| 0 Skeleton, token, docs, memory | done |
| 1 Day-1 checks (CLI flags, DDL, formulas, view DSL, subagent connector) | done; hooks checked in the headless test later |
| 2 lib, schemas, allowlist, guard hook | done |
| 3 pull, plan, apply, verify (REST, token) | done |
| 4 setup + seed applied to Notion (14 + 60 + 50 + 1 rows, verify clean) | done |
| 5 judge + propose (Sonnet tag run 180/180, baseline 83/83 canaries) | done |
| 6 first tag run → propose → apply (40 rows queued, 60 claims updated, verify clean) | done |
| 7 eval, distill, promote, followup, status, cases-sync, snapshot, run-card | done (690 tests) |
| 8 SKILL.md, README, headless tests | done (status and tag dry-run transcripts in evidence/headless; guard-hook headless test left as a manual step, see evidence/README.md) |
| 9 Demo storyline | done: steps 0-7 (LS-1 FAIL x5 with reconfirmation, LS-2 FAIL and rolled back); steps 8-9 skipped because nothing went live; step 10 covered by the verify tests |
| 10 Persona reviews, dispositions | done: round 1 and 2 for both personas (review/), dispositions.md final; open musts are decisions for Mika (EN-3 token and page connections, EN-4 remote, ED-8 names) |
| 11 Artifact | done: built with `build.mjs --strict` from report/parts and data/counts.json (collect-evidence.mjs); published: https://claude.ai/artifact/U88vn7nPeaRufmrMVXwjB1 (republish by publishing the same file path) |

## Subagents
- none running; every report is in 01-log.md and under review/

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


## Handover (actions for Mika, in order)
1. Disconnect the integration "claude" from the four real databases the probe can read (U.S. Politics debate claims, Claims to review, the taxonomy Claim Tags, World affairs debate claims (1)), rotate the temporary token, put the new one in `.env`, run `node agents/claim-tagger/scripts/probe.mjs` until it exits 0, and record the date here.
2. Add a private remote and push: the rubric, its lock and history, and the cases live on one disk.
3. Name in the hub callout who reads sources (Needs evidence) and who gives second opinions (Ask another editor); set Owner in Agent settings.
4. Decide: promote refusing an empty Approved by (ED-13); pinning the Claude Code version on the runner (EN-9); the weekly expectation per editor (Q-E4).
5. Run the guard-hook headless test once (evidence/README.md) and keep its transcript under evidence/headless/.
6. Next engineering step: a per-tag judge, then LS-1 through the gate again with the attempt-4 wording; a Context-dependent boundary lesson; more Predictive and Hypothetical labels.
