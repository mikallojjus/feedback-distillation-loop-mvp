---
name: claim-tagger
description: Run the claim tagger's editor feedback loop against the Notion page "Editorial feedback loop" - tag claims, distill editor decisions into proposed rule changes, gate and promote approved changes, follow up, or show status. Use when an editor or engineer asks to run the tagging loop, check what is waiting, tag claims, distill feedback, promote or roll back a lesson, or asks about the agent's state. Subcommands - setup, status, tag, distill, promote, follow-up.
---

# /claim-tagger

The editor-facing entry point of the claim tagger (`agents/claim-tagger/`). Every subcommand is a sequence of scripts plus a plan apply. The scripts are deterministic and do all Notion reads and writes themselves through the integration token (`.env`); you run them, read their one-line summaries and exit codes, and report in plain words. You never write a Notion field by hand, never edit a plan file, and never touch an editor-owned field (Tag outcome, Why wrong, Your reasoning, Decided by, Decided at, Editor wording, Approved by, Status Approved/Rejected, Paused, Paused by, Reason, Weekly cap, Owner).

Read `agents/claim-tagger/AGENT.md` once per session before the first subcommand.

## Exit codes you will see

0 ok · 1 error (read the message, fix, retry once) · 2 invalid input (stop and report) · 3 paused (stop: a person must untick Paused or delete `runs/PAUSED`) · 4 rubric drift or model mismatch (stop and report; `status` explains) · 5 trust breaker (stop; report the changed editor field) · 10 gate HOLD · 11 gate FAIL (both are results, not errors) · 75 usage window (tell the user when to resume; `--resume <run-id>`).

## Preflight (every subcommand)

```
node agents/claim-tagger/scripts/status.mjs --check
```

Stops on PAUSED, lock mismatch or an unfinished promote. If `.env` has no `NOTION_TOKEN`, say so: the fallback is to apply plans through the Notion connector by hand (see "No token" below).

## Subcommands

### `status [--refresh]`

```
node agents/claim-tagger/scripts/pull.mjs --dbs agent_settings,tag_decisions,rule_changes,runs   (only with --refresh)
node agents/claim-tagger/scripts/status.mjs
```

Report: rubric version and hash and whether the Rulebook matches; paused or not; queue counts (To review, Needs your note); lessons by status; the last run cards; anything unfinished and its resume command.

### `tag [--limit n] [--runs 1|3] [--dry-run] [--resume <run-id>]`

```
node agents/claim-tagger/scripts/pull.mjs --dbs agent_settings,rulebook,claims,tag_decisions
node agents/claim-tagger/scripts/judge.mjs --items claims [--limit n] [--runs n] [--resume <run-id>]
node agents/claim-tagger/scripts/propose.mjs --run <run-id>
node agents/claim-tagger/scripts/apply.mjs --run <run-id>        (skipped with --dry-run)
```

`judge.mjs` can take minutes: run it in the background and poll `status.mjs --run <run-id>` every minute or so; never start a second judge on the same run. After apply, report the summary line it prints (claims judged, rows queued, held by cap, cost, editor fields changed: 0) and link "Your queue" on the hub page.

### `distill`

```
node agents/claim-tagger/scripts/pull.mjs --dbs rulebook,tag_decisions,rule_changes
node agents/claim-tagger/scripts/distill.mjs
node agents/claim-tagger/scripts/apply.mjs --run <run-id>
```

Report each proposed lesson (title, tag, rule, supporting rows) and say: "rule owner: set Status = Approved or Rejected in Lessons waiting".

### `promote <lesson-key> [--smoke] [--resume <run-id>] | promote --rollback <lesson-key>`

```
node agents/claim-tagger/scripts/pull.mjs --dbs rulebook,tag_decisions,rule_changes,runs,agent_settings
node agents/claim-tagger/scripts/promote.mjs --lesson <lesson-key>        (background; exit 0 PASS, 10 HOLD, 11 FAIL)
node agents/claim-tagger/scripts/apply.mjs --run <run-id>
node agents/claim-tagger/scripts/promote.mjs --finalize <run-id>          (only after a PASS apply verified)
git add agents/claim-tagger/rubric agents/claim-tagger/evals && git commit -m "rubric <version>: <lesson> (gate PASS, <card-id>)"
```

On HOLD or FAIL only the card plan is applied; the Rulebook is untouched and the lesson stays Approved with its Gate result filled in. Print `runs/<run-id>/card.md` verbatim.

### `follow-up <lesson-key>`

```
node agents/claim-tagger/scripts/pull.mjs --dbs rulebook,claims,tag_decisions,rule_changes
node agents/claim-tagger/scripts/followup.mjs --lesson <lesson-key>
node agents/claim-tagger/scripts/apply.mjs --run <run-id>
```

Report the Fixed and Still wrong counts.

### `setup` (engineer, one-time)

Creates the databases and seeds them. The schema was created by hand in October 2026 (ids in `config.json`); the seed is `node agents/claim-tagger/scripts/seed.mjs --phase 1|2|3` followed by `apply.mjs` for each phase. See `docs/mvp-2026-10/plan.md`.

## No token (connector fallback)

If `.env` has no token, `apply.mjs` writes `runs/<run-id>/batches/*.json` and exits 2 with "apply by connector". Then, for each batch file in order: creates go to `notion-create-pages` with the batch's `parent` and `pages` exactly as written (at most 100 per call); updates go to `notion-update-page` with `update_properties` and the properties exactly as written. Copy values verbatim; never add, drop or rename a property. Afterwards run `pull.mjs` for the touched databases and `verify.mjs --run <run-id>`.

## Reporting style

One short paragraph in plain words: what changed, what waits for whom, where to look (link the hub views), and the cost. Numbers go in a short table when there are more than two. Never paste JSON at the user unless asked.
