---
name: claim-tagger
description: Run the claim tagger's editor feedback loop against the Notion page "Editorial feedback loop" - tag claims, distill editor decisions into proposed rule changes, gate and promote approved changes, follow up, or show status. Use when an editor or engineer asks to run the tagging loop, check what is waiting, tag claims, distill feedback, promote or roll back a lesson, or asks about the agent's state. Subcommands - status, tag, distill, promote, follow-up, setup.
---

# /claim-tagger

The editor-facing entry point of the claim tagger (`agents/claim-tagger/`). Every subcommand is a fixed sequence of scripts. The scripts are deterministic and do all Notion reads and writes themselves through the integration token in `.env`; you run them in order, read their one-line summaries and exit codes, and report in plain words. You never write a Notion field by hand, never edit a plan file, and never touch an editor-owned field (Tag outcome, Why wrong, Your reasoning, Decided by, Decided at, Editor wording, Approved by, Status Approved/Rejected, Paused, Paused by, Reason, Weekly cap, Owner).

Read `agents/claim-tagger/AGENT.md` once per session before the first subcommand. Run every command from the repository root. `S` below means `agents/claim-tagger/scripts`.

## Exit codes

0 ok · 1 error (read the message; retry once if it looks transient) · 2 invalid input or nothing to do (report it; a `plan.mjs check` on a run with no plan is "nothing to do") · 3 paused (stop: a person must untick Paused in Agent settings or run `status.mjs --unpause --confirm`) · 4 rubric drift or model mismatch (stop and report; `status.mjs` explains) · 5 trust breaker (stop; report the changed editor field from `runs/PAUSED`) · 10 gate HOLD · 11 gate FAIL (both are results, not errors) · 75 usage window (tell the user when to resume with `--resume <run-id>`).

## Preflight (every subcommand)

```
node S/status.mjs --check
```

Stops on PAUSED, lock mismatch, drift or an unfinished promote, and reports whether an integration token is configured. Never read, grep or print `.env`; if the check says no token is configured, say so and stop: every write goes through the token in this version.

## The apply step (used below as "A")

```
node S/plan.mjs check --run <run-id>
node S/apply.mjs --run <run-id>
```

`apply.mjs` pulls the touched databases before and after, writes, reads back and verifies; its summary line ends with "verify clean" and "editor fields changed: 0". On exit 1 run `apply.mjs --run <run-id> --retry` once; on exit 5 stop and report the trust breaker.

## Subcommands

### `status`

```
node S/pull.mjs --all
node S/status.mjs
```

Report: rubric version and hash and whether the Rulebook matches; paused or not; queue counts by stage and the Needs-your-note count; lessons by status; the last run cards; anything unfinished and its resume command.

### `tag [--limit n] [--runs 1|3] [--dry-run] [--resume <run-id>]`

```
node S/pull.mjs --all
node S/judge.mjs --items claims [--limit n] [--runs n] [--run-id <id>] [--resume]     (background; poll `status.mjs --run <id>`)
node S/propose.mjs --run <judge-run-id> --pull <pull-id> --out-run <id>-propose
A on <id>-propose                                                                 (skipped with --dry-run)
node S/run-card.mjs --tag <judge-run-id> --propose <id>-propose --run-id <id>-card
A on <id>-card
node S/pull.mjs --all
node S/cases-sync.mjs --run-id <id>-cases          (then A on <id>-cases when it wrote a plan)
```

`judge.mjs` takes minutes (about 50 seconds per 8 claims); never start a second judge on the same run. If its summary says `cells=0`, every claim already has its judgments under the current rubric (judgments are cached by rubric and model): say so, and run `propose.mjs` against the latest tag run listed by `status.mjs` instead of judging again. Report the propose summary (claims judged, rows queued, held by cap, readiness counts, cost) and link "Your queue" on the hub page.

### `distill`

```
node S/pull.mjs --all
node S/distill.mjs --run-id <id>
A on <id>
node S/pull.mjs --all
node S/distill.mjs --link --run <id>
A on <id>-link
node S/pull.mjs --all
node S/cases-sync.mjs --run-id <id>-cases          (then A on <id>-cases when it wrote a plan)
```

Report each proposed lesson (title, tag, rule, supporting rows) and say: "rule owner: set Status = Approved or Rejected in Lessons waiting, or rewrite the text in Editor wording".

### `promote <lesson>` (a Lesson ID such as LS-1, or the lesson title)

```
node S/pull.mjs --all
node S/promote.mjs --lesson <lesson> --run-id <id>        (background; exit 0 PASS, 10 HOLD, 11 FAIL)
A on <id>
node S/promote.mjs --finalize <id>                        (PASS only, after A verified clean)
A on <id>-cases                                           (PASS only: activates the lesson's cases)
git add agents/claim-tagger/rubric agents/claim-tagger/evals && git commit -m "rubric <version>: <lesson> (gate PASS, <id>)"
```

A regression case that flips between the baseline and the candidate (broken or fixed) is judged again with `gate.reconfirm_runs` extra runs per rubric before it counts; the card lists each reconfirmed case as confirmed or noise, and the verdict after reconfirmation is the one that counts. On HOLD or FAIL only the card plan is applied; the Rulebook is untouched and the lesson stays Approved with its Gate result filled in (a planted demo lesson is marked Rolled back). Print `runs/<id>/card.md` verbatim. Other forms: `promote.mjs --abort <id>` after a failed apply; `promote.mjs --rollback <lesson> --confirm` restores the previous version of the most recent Live lesson (then A on its run and a commit).

### `follow-up <lesson>`

```
node S/pull.mjs --all
node S/followup.mjs --lesson <lesson> --run-id <id>
A on <id>
```

Report the Fixed and Still wrong counts.

### `setup` (engineer, one-time; already done for the trial page)

The six databases, formulas and views were created through the connector on 13 October 2026 (ids in `config.json`). Seeding: `node S/pull.mjs --all`, then for phase 1, 2 and 3: `node S/seed.mjs --phase <n>`, A on the phase run, `node S/pull.mjs --all`. Then `node S/rubric-init.mjs` if `rubric/rubric.json` does not exist, and `cases-sync.mjs`.

## Evidence

After each step of a demo or review run: `node S/snapshot.mjs --step <n> --label <text>` copies the latest pull into `docs/mvp-2026-10/evidence/notion/`.

## Reporting style

One short paragraph in plain words: what changed, what waits for whom, where to look (link the hub views), and the cost. Numbers go in a short table when there are more than two. Never paste JSON at the user unless asked.
