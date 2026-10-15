---
name: claim-tagger
description: Run the claim tagger's editor feedback loop against the Notion page "Feedback Distillation MVP" - tag the copied claims on Context-dependent, show what waits in the queue, turn the editor's decisions into a proposed rule change, run the safety check and switch to an approved change, repeat the follow-up, roll back a change, or show the agent's state. Use when an editor or engineer asks to run the tagging loop, check what is waiting, tag claims, distill feedback, promote or roll back a rule change, or asks about the agent's state. Subcommands - status, tag, distill, promote, follow-up, rollback, setup, demo <subcommand>.
---

# Claim tagger

**Output style.** For as long as this skill runs, its report format (section "Reporting style") replaces your output style. Do not write Insight blocks, tips or other educational notes before, between or after the commands, and do not explain the scripts, the code or your choices: the editor asked for a result, and will ask if they want the why.

## What this skill does and never does

- Every subcommand runs one or more scripts under `agents/claim-tagger-mvp/scripts/` with the Bash tool, from the repository root, exactly as listed below, one command at a time, each waited for before the next. Nothing else is run: no other tools, no file reads, no shell pipes.
- The scripts do the work and write Notion themselves, through the REST client, by applying a plan and reading every write back. You never write Notion through the connector, never create, move or delete a page, never fill an editor column (Tag outcome, Why wrong, Your reasoning, Editor wording, Paused, the Status values Approved and Rejected), and never edit files under `agents/claim-tagger-mvp/runs/` or `agents/claim-tagger-mvp/rubric/`.
- You never pass `--bare`, `--fallback-model`, `--unpause` or `--confirm`; `rollback` is the one subcommand whose command line carries `--confirm`, and the permission prompt it raises is the person's confirmation.
- A script that stops (exit 1 or 75) is resumed by running the same subcommand again, later; the scripts continue from their own records. Never start a second run for the same step and never repeat a command more than once in a row.
- A refusal because the agent is paused (exit 3) or because the rulebook text was edited by hand (exit 4) also arrives as a printed report: relay it and stop.
- The last thing a script prints is its report. Your final message is that printed report, verbatim and complete, and nothing else: no words before it, no words after it.

## Subcommands

| You are asked | Commands, in order |
|---|---|
| status (what waits, which edition is in force) | `node agents/claim-tagger-mvp/scripts/status.mjs` |
| tag (read the claims, fill the queue) | `node agents/claim-tagger-mvp/scripts/pull.mjs --all` then `node agents/claim-tagger-mvp/scripts/judge.mjs --items claims` then `node agents/claim-tagger-mvp/scripts/propose.mjs` |
| distill (draft rule changes from the editor's decisions) | `node agents/claim-tagger-mvp/scripts/distill.mjs` |
| promote <lesson> (the safety check, then the switch to the approved rule; the follow-up runs by itself after a PASS) | `node agents/claim-tagger-mvp/scripts/promote.mjs --lesson "<the rule change's title>"`; when the editor names no title, run it without `--lesson` and the script takes the only Approved rule change |
| follow-up <lesson> (repeat the automatic last step of a promote that stopped before it) | `node agents/claim-tagger-mvp/scripts/followup.mjs --lesson "<the rule change's title>"` |
| rollback <lesson> (put the earlier rule text back) | `node agents/claim-tagger-mvp/scripts/rollback.mjs --lesson "<the rule change's title>" --confirm` |
| setup | Engineer only; the sequence is in `agents/claim-tagger-mvp/AGENT.md`. Never run it for an editor; say that setup is the engineer's step. |
| demo <subcommand> | See Demo mode. |

For `tag`, the report to relay is the one `propose.mjs` prints; what `pull.mjs` and `judge.mjs` print is not shown. When `judge.mjs` stops with exit 75 (the usage window), relay the report it printed and stop; it tells the editor to type the same command again later.

## Demo mode

A practice page, made by `/claim-tagger-walkthrough`, has its own small tables under the Demos sub-page. The demo subcommands run the same scripts against the newest practice page through the walkthrough runner: replace `node agents/claim-tagger-mvp/scripts/<x>.mjs` with `node agents/claim-tagger-mvp/scripts/walkthrough.mjs run <x>` and keep the arguments. `promote` and `followup` without `--lesson` take the demo's only Approved (or Live) rule change. Every demo report starts with "Demo · ", and its links point at the practice page's views. Every demo report names the practice page it acted on. Steps 3 and 5 of the practice page happen in Notion: never fill those columns for the editor; the report's Next line links the view. Step 7 needs no command, because the follow-up runs by itself after a PASS; `demo follow-up` only repeats it after a run that stopped early. No git commit happens after a demo promote.

## Reporting style

Editors read these reports between other tasks. Every report, errors included, has exactly three parts and nothing else:

1. **One sentence**: what ran and what came out, in plain words. Start with "Demo · " when the demo ran.
2. **One table**, at most five rows and three columns, with the figures that matter for this subcommand (see the examples in `references/report-examples.md`). Leave it out when there is nothing to count.
3. **One line starting "Next:"** with exactly one thing to do: a command to type, or a Notion link and the action to take there. When more rows wait than fit one sitting (a setting, default 20), the sentence gives the count and the line says "start at the top of Your queue (link)", not "decide the N rows".

Leave out everything else: headings, how the scripts work, the commands you ran, retries and incidents (if one changed the result, say so in a few words inside the sentence), file paths, run ids, JSON, and any duration, dollar amount or model-call count (they stay in the run record). Add one row, "Usage", only when the share of the usage window that the run took is known. For a stopped run, "Next:" is the same slash command; the skill resumes the run itself. While a step takes a while, say once what is happening, with no duration ("Reading 7 claims."), then nothing until the report.

The scripts write the report in exactly this shape. Relay it as printed; do not reword, shorten or extend it.

## Two examples

Status, when more rows wait than fit one sitting:

Status: nothing is paused; 46 rows and 1 rule change wait for you, more than fit one sitting.

| Where | Now |
|---|---|
| Rulebook | 13 Issue tags, edition 2026-11-04.2, same as Notion |
| Your queue | 46 rows, lowest confidence first (the view shows the count) |
| Lessons waiting | 1 rule change to approve |
| Last run | Tag · 4 Nov 09:12 · 214 claims |

Next: start at the top of Your queue (link).

Promote, when it passes, in a demo:

Demo · promote: PASS, rule 4 now uses your approved wording (edition 2026-10-15.2), and the follow-up marked both of your rows Fixed.

| Check | Result |
|---|---|
| Example claims | 11 of 11 right |
| Earlier decisions | 5 of 5 still right |
| Your 2 rows | 2 of 2 now right, marked Fixed |

Next: look at step 7 on the practice page (link); the demo is then complete.

All the examples are in `references/report-examples.md`.
