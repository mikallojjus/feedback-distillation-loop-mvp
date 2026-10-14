# Session summary: claim-tagger editor-feedback-loop MVP (13 to 14 October 2026)

Written for the follow-up session. Read this first, then `STATE.md` (the handover list) and `01-log.md` (what happened, in order).

## In one paragraph

Mika asked for a working MVP of the "rulebook loop" from the overnight research: the claim-tagging agent proposes tags, editors decide them in Notion, decisions become permanent tests, the agent distills lessons into proposed rule changes, the rule owner approves, and a change goes live only after it passes a gate. The MVP was built in a new repository, run end to end on 60 real claims inside Mika's Notion page "Editorial feedback loop", reviewed by an Editor persona and an Engineer persona in two rounds, and documented in a published artifact. The gate honestly refused the first lesson five times (the learning is measurable, but the wording also moves one unrelated decision) and refused a planted bad lesson once. The live rulebook never changed. The engineer review found one real hole (a hand-edited plan file could have claimed a gate pass), which is closed. Four actions remain for Mika, the first being to cut the integration token's access down to the hub page.

## Where everything is

| What | Where |
|---|---|
| Repository | `X:\work\geo-agents` (local git, no remote; last commit `bfdcca4`; 856 tests, `node --test tests/`) |
| Agent | `agents/claim-tagger/` (AGENT.md, config.json with every Notion id, rubric/, prompts/, schemas/, evals/, scripts/) |
| Skill | `.claude/skills/claim-tagger/SKILL.md` (`/claim-tagger status | tag | distill | promote | follow-up | setup`) |
| Hard rules and permissions | `CLAUDE.md`, `.claude/settings.json` |
| Session docs | `docs/mvp-2026-10/`: `STATE.md`, `01-log.md`, `decisions.md` (M1 to M14), `plan.md` (the approved plan), `review/`, `evidence/`, `report/` |
| Notion hub (the only page written) | https://app.notion.com/p/3da273e214eb80c180d5fd0894bc2db8 |
| Notion sub-pages | Databases `3f8273e214eb81c59b0cc7576b1bb62f`; Engineer notes `3f8273e214eb8137a13cd8d4d483b936` (runbook, safety checks, access finding) |
| Notion data sources | Rulebook `319e6022-0b6a-4068-b560-99c83fae5bdf`, Claims `506dddee-af6e-4cbe-980f-a1ef1564d9bd`, Tag decisions `92c9f4a9-f729-447b-88b9-982ff0e97074`, Rule changes `e1836e35-d614-4434-ab34-a0ddeaa1842c`, Runs `e1f2103e-6233-468c-91b4-2c2382e86d1b`, Agent settings `5de4f0e4-21ab-417c-b9a5-06bbc6c143eb` |
| As-built Notion schema (DDL, formulas, views) | `agents/claim-tagger/schemas/notion/as-built.md` |
| Artifact (published, private until shared) | https://claude.ai/artifact/U88vn7nPeaRufmrMVXwjB1, built from `docs/mvp-2026-10/report/` with `node build.mjs --strict`; republish by publishing the same file path |
| Research it builds on | `X:\work\research\overnight-feedback-loop-research\SUMMARY.md`, artifact https://claude.ai/artifact/4xaZDHMzcdDMtsgxER8rz3 |
| Token | `X:\work\geo-agents\.env` only (git-ignored); the value Mika pasted in chat on 13 Oct is temporary and must be replaced |

## What was built

- **Notion structure inside the hub**: six databases (Rulebook, Claims, Tag decisions, Rule changes, Runs, Agent settings) with formulas (Stage, Direction, Effective outcome, Owner action) and rollups; editor views (Your queue, Needs your note, Decided, By claim, Easy rows first, Overruled without a note, Waiting for evidence, Second opinion, Handed on, Lessons waiting, Live rules, Latest runs); a callout with the legend; an Engineer notes page.
- **Scripts** (`agents/claim-tagger/scripts/`): `pull` (REST reads, schema and option-set contract check), `judge` (headless `claude -p`, Sonnet 5.5, 3 runs, content-addressed cache, resumable), `propose`, `distill` (Opus 5.5), `eval` (gate: canaries, regression cases, paired bootstrap, reconfirmation of flipped cases), `promote` (two-phase, exclusive lock, gate evidence), `followup`, `cases-sync`, `plan` / `apply` / `verify` (allowlist-checked plan files, REST apply, read-back, editor-field snapshot diff), `status`, `run-card`, `recard`, `snapshot`, `seed`, `probe` (token reach), `transcript-check`, `hooks/guard.mjs`.
- **Safety as built** (see AGENT.md): editor-owned fields are never written; a Rulebook write needs evidence on disk (PROMOTING record, non-smoke PASS card, candidate rubric hashes, Approved lesson); seed needs a `runs/SETUP` marker; the model has no Write/Edit permission under `runs/`; nine real Geo database and data-source ids are protected; writes go only to the six trial databases; creates are never auto-retried; one promote at a time; a trust breaker pauses the agent.

## What was run, and the results

| Figure | Value |
|---|---|
| Claims in the trial | 60 (real U.S. Politics claims, anonymised seed decisions from the 9 Oct audit) |
| Tag run | 180 judgments, 0 errors, $2.06; 40 queue rows created, 23 updated |
| Judgments in all, errors | 1,240, 0 |
| Editor decisions in the trial | 13 live (10 by the Editor persona, 2 by the Editor reviewer, 1 ruling) plus 27 seeded |
| Regression cases, canaries | 70 cases, 83 canaries (all passing in every gate run) |
| Lessons | LS-1 "Hedged likely to needs a definite future outcome" (Predictive rule 1): Approved, gated 5 times, FAIL each time; LS-2 (planted bad lesson): FAIL, Rolled back |
| Best LS-1 result | 4 of 4 hedged rows fixed, +36 points on Predictive (lower bound +9), one confirmed Context-dependent flip on an unrelated claim, which the rule owner ruled correct |
| Script writes to Notion, outside the trial databases | 304, 0 (`evidence/write-audit.json`) |
| Editor fields changed by the agent | 0 (every apply verified by read-back) |
| Unit tests | 856 passing (clean export of commit `9d66fab`) |
| Model cost | about $13.88 |

Decision M11 (symmetric reconfirmation of flipped cases, 5 extra runs per configuration) came out of the gate attempts; M12 to M14 came out of the reviews (decided rows are never re-queued; a failed-gate lesson stays visible through Owner action; a Rulebook write needs evidence, not a flag).

## Reviews (both rounds closed)

- **Editor persona** (Fable 5.1, Notion only): 17 findings (4 must, 9 should, 4 nice). Fixed: legends and descriptions, Decided at/by guidance, the "For editors:" card opener, claim text first in every view, five new views, Owner action, the re-rendered gate cards. Round 2: the hub is clear for the weekly job; open ask for Mika: name who reads sources and who gives second opinions.
- **Engineer persona** (Opus 5.5, read-only): 17 findings (4 must, 10 should, 3 nice). Fixed in code: EN-1 gate evidence, EN-2 resume commands and runbook, EN-5 duplicate creates, EN-6 regression date clearing, EN-8 promote lock, EN-11 permissions (connector write tools ask; absolute hook path), EN-12 protected ids and probe, EN-13 contract check and as-built schema, EN-16 texts. Round 2: clear and operable; four forgeries refused; resume and rollback work from the Engineer notes alone. Open musts for Mika: EN-3 (token reach), EN-4 (remote).
- Files: `review/persona-editor-r1.md`, `persona-editor-r1-answers.md`, `persona-editor-r2.md`, `persona-engineer-r1.md`, `persona-engineer-r1-answers.md`, `persona-engineer-r2.md`, `dispositions.md` (one row per finding, with the change made).

## Actions for Mika, in order

1. **Cut the token's reach.** `probe.mjs` found the integration "claude" can read four real databases (U.S. Politics debate claims, Claims to review, the taxonomy Claim Tags, World affairs debate claims (1)). Nothing was written there (write audit), but the agent's write whitelist is the only thing in the way. Disconnect the integration from those pages (page → ⋯ → Connections), replace the temporary token in `.env`, then run `node agents/claim-tagger/scripts/probe.mjs` until it exits 0, and record the date in `STATE.md`.
2. **Add a private remote** and push; the rubric, its history and the cases live on one disk.
3. **Name the two readers** in the hub callout (Needs evidence, Ask another editor) and set Owner in Agent settings.
4. **Decide**: should promote refuse a lesson whose Approved by is empty (ED-13); pin the Claude Code version on the runner or accept one re-judge per update (EN-9); the weekly expectation per editor (the cap is 40 new rows a week, about an hour at 1 to 3 minutes a row).
5. **Run the guard-hook headless test once** (command in `evidence/README.md`); the orchestrating session could not start it.
6. **Next engineering step**: a per-tag judge, then LS-1 through the gate again with the attempt-4 wording; a Context-dependent boundary lesson for the Melania case; more labelled Predictive and Hypothetical claims.

## Not done, stated plainly

- The guard hook was never observed firing in a headless session (tested only by unit tests and now backed by permissions that ask before any connector write).
- The PASS path (finalize, follow-up, rollback against real Notion) ran only against the test fake, because no lesson passed; the next passing lesson is its first real run, to be watched by an engineer.
- The headless tag path on an editor's machine judged nothing (every claim was cached) and stopped before propose, so it is untested beyond `status`.
- The Editor persona's people fields (Decided by, Approved by) are empty; in production they fill themselves.

## How to resume in a new session

1. Open `X:\work\geo-agents` (add it to the session) and read `docs/mvp-2026-10/STATE.md`, then this file's "Actions for Mika".
2. Preflight: `node agents/claim-tagger/scripts/status.mjs --check` (token present, not paused, no drift, no promote in flight), then `node agents/claim-tagger/scripts/probe.mjs` (exit 0 once the connections are fixed).
3. The loop, interactively: `/claim-tagger status`, `tag`, `distill`, `promote <lesson>`, `follow-up <lesson>`; headless from the repo root with `--settings .claude/settings.json` and `MSYS_NO_PATHCONV=1` (see README "Headless").
4. If something stops: the README table "If something stops" or the Engineer notes runbook; `status.mjs` prints the resume command.
5. Notion schema changes go through the connector and must be appended to `schemas/notion/as-built.md`; formula text cannot be read back from Notion.
6. The artifact: edit `docs/mvp-2026-10/report/parts/`, `node collect-evidence.mjs`, `node build.mjs --strict`, publish `editor-feedback-loop-mvp.html` to the same URL.
7. Claude's memory for this project (`project-claim-tagger-mvp.md` and the shell-trap notes) already points at these files.

## Costs and commits

- Model cost about $13.88 (judge, distiller, gates with reconfirmation); the subscription usage window, not money, is the binding limit.
- Commits: `86ef650` editor-review fixes; `9d66fab` engineer-review fixes; `860246d` round 2; `bfdcca4` handover docs.
