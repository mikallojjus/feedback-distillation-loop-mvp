---
name: claim-tagger
description: Run the claim tagger's editor feedback loop against the Notion page "Feedback Distillation MVP" - tag the copied claims on Context-dependent, show what waits in the queue, turn the editor's decisions into a proposed rule change, run the safety check and switch to an approved change, repeat the follow-up, roll back a change, or show the agent's state. Use when an editor or engineer asks to run the tagging loop, check what is waiting, tag claims, distill feedback, promote or roll back a rule change, or asks about the agent's state. Subcommands - status, tag, distill, promote, follow-up, rollback, setup, demo <subcommand>.
---

# Claim tagger

**Output style.** For as long as this skill runs, its report format (section "Reporting style") replaces your output style. Do not write Insight blocks, tips or other educational notes before, between or after the commands, and do not explain the scripts, the code or your choices: the editor asked for a result, and will ask if they want the why.

## What this skill does and never does

- Every subcommand runs one or more scripts under `agents/claim-tagger-mvp/scripts/` with the Bash tool, exactly as listed below, one command at a time, each waited for before the next. The working directory is already the repository root: type the command alone, with nothing before or after it (no `cd`, no `&&`, no pipes, no redirection). Nothing else is run: no other tools, no file reads.
- The scripts do the work and write Notion themselves, through the REST client, by applying a plan and reading every write back. You never write Notion through the connector, never create, move or delete a page, never fill an editor column (on the claims table Verified tags, Review status, Why wrong and Challenged tags notes; Editor wording, Paused, the Status values Approved and Rejected), and never edit files under `agents/claim-tagger-mvp/runs/` or `agents/claim-tagger-mvp/rubric/`.
- You never pass `--bare`, `--fallback-model`, `--unpause` or `--confirm`; `rollback` is the one subcommand whose command line carries `--confirm`, and the permission prompt it raises is the person's confirmation.
- A script that stops (exit 1 or 75) is resumed by running the same subcommand again, later; the scripts continue from their own records. Never start a second run for the same step and never repeat a command more than once in a row.
- A refusal because the agent is paused (exit 3) or because the rulebook text was edited by hand (exit 4) also arrives as a printed report: relay it and stop.
- The last thing a script prints is its report. Your final message starts with that printed report, verbatim and complete, with no word before it. When the report's Next line sends the editor to Notion, one checklist follows it (section "After the report: the checklist"), and nothing else; otherwise nothing follows the report.

## Subcommands

| You are asked | Commands, in order |
|---|---|
| status (what waits, which edition is in force) | `node agents/claim-tagger-mvp/scripts/status.mjs` |
| tag (read the claims, write the agent's side of the claims table and copy the editor's decisions into its ledger) | `node agents/claim-tagger-mvp/scripts/pull.mjs --all` then `node agents/claim-tagger-mvp/scripts/judge.mjs --items claims` then `node agents/claim-tagger-mvp/scripts/propose.mjs` |
| distill (draft rule changes from the editor's decisions) | `node agents/claim-tagger-mvp/scripts/distill.mjs` |
| promote <lesson> (the safety check, then the switch to the approved rule; the follow-up runs by itself after a PASS) | `node agents/claim-tagger-mvp/scripts/promote.mjs --lesson "<the rule change's title>"`; when the editor names no title, run it without `--lesson` and the script takes the only Approved rule change |
| follow-up <lesson> (repeat the automatic last step of a promote that stopped before it) | `node agents/claim-tagger-mvp/scripts/followup.mjs --lesson "<the rule change's title>"` |
| rollback <lesson> (put the earlier rule text back) | `node agents/claim-tagger-mvp/scripts/rollback.mjs --lesson "<the rule change's title>" --confirm` |
| setup | Engineer only; the sequence is in `agents/claim-tagger-mvp/AGENT.md`. Never run it for an editor; say that setup is the engineer's step. |
| demo <subcommand> | See Demo mode. |

For `tag`, the report to relay is the one `propose.mjs` prints; what `pull.mjs` and `judge.mjs` print is not shown. When `judge.mjs` stops with exit 75 (your Claude allowance ran out), relay the report it printed and stop; it tells the editor to type the same command again when the allowance is back.

## Demo mode

A practice page, made by `/claim-tagger-walkthrough`, has its own small tables under the Demos sub-page. The demo subcommands run the same scripts against the newest practice page under Demos (the newest finished page under the Demos sub-page that the script can read; a page under Demo tests is never the one) through the walkthrough runner: replace `node agents/claim-tagger-mvp/scripts/<x>.mjs` with `node agents/claim-tagger-mvp/scripts/walkthrough.mjs run <x>` and keep the arguments. `promote` and `followup` without `--lesson` take the demo's only Approved (or Live) rule change. Every demo report starts with "Demo · ", and its links point at the practice page's views. Every demo report names the practice page it acted on. Steps 3 and 5 of the practice page happen in Notion: never fill those columns for the editor; the report's Next line links the view, and the Demo checklist of `references/guide.md` under the report says what to fill in there, in the words of the page. Step 7 needs no command, because the follow-up runs by itself after a PASS; `demo follow-up` only repeats it after a run that stopped early. No git commit happens after a demo promote.

## Reporting style

Editors read these reports between other tasks. Every report, errors included, has exactly three parts and nothing else:

1. **One sentence**: what ran and what came out, in plain words. Start with "Demo · " when the demo ran.
2. **One table**, at most five rows and three columns, with the figures that matter for this subcommand (see the examples in `references/report-examples.md`). Leave it out when there is nothing to count.
3. **One line starting "Next:"** with exactly one thing to do: a command to type, or a Notion link and the action to take there. When more rows wait than fit one sitting (a setting, default 20), the sentence gives the count and the line says "start at the top of Your queue (link)", not "decide your N claims".

Leave out everything else: headings, how the scripts work, the commands you ran, retries and incidents (if one changed the result, say so in a few words inside the sentence), file paths, run ids, JSON, and any duration, dollar amount or model-call count (they stay in the run record). Add one row, "Usage", only when the share of your Claude allowance that the run took is known. For a stopped run, "Next:" is the same slash command; the skill resumes the run itself. While a step takes a while, say once what is happening, with no duration ("Reading 7 claims."), then nothing until the report.

The scripts write the report in exactly this shape. Relay it as printed; do not reword, shorten or extend it. The checklist below is not part of the report: it is a separate part of the message.

## After the report: the checklist

The report is relayed verbatim first. When its Next line sends the editor to Notion (a view to open and something to fill in there), read `references/guide.md` and add the checklist that matches the Next line below the report, after one blank line, and nothing else: no heading, no words before or after, not reworded, not shortened, not extended. The guide has a checklist for deciding in Your queue (after `tag`, `status` or a `promote` that passed with claims still waiting), for approving in Lessons waiting (after `distill`), for a `promote` that ended in FAIL, and for the claims in Agent disagreed (after `follow-up`); each comes in a real and a demo form, and a report that starts with "Demo · " takes the demo form. A checklist is a numbered list of at most five lines: which view to open, which columns to fill in and in which order, what to look at, and the next command to type. Its words are the practice page's (same column names, same order), so the editor meets the same words on the page and under the report.

A report whose Next line only names a command, a stopped run (exit 1 or 75), a pause, a refusal or a drift report gets no checklist. Never add a checklist the guide does not have, and never add one of your own; if no checklist matches the Next line, send the report alone.

## Two examples

Status, when more rows wait than fit one sitting:

Status: nothing is paused; 46 rows and 1 rule change wait for you, more than fit one sitting.

| Where | Now |
|---|---|
| Rulebook | 13 tags, edition 2026-11-04.2 |
| Your queue | 46 rows, lowest confidence first |
| Lessons waiting | 1 rule change to approve |
| Last run | Tag · 4 Nov 09:12 · 214 claims |

Next: start at the top of Your queue (link).

Promote, when it passes, in a demo:

Demo · Promote: PASS, rule 3 now uses your approved wording (edition 2026-10-15.2), and the follow-up marked both of your rows Fixed.

| Check | Result |
|---|---|
| Example claims | 11 of 11 right |
| Earlier decisions | 5 of 5 still right |
| Your 2 rows | 2 of 2 now right, marked Fixed |

Next: look at step 7 on the practice page (link); the demo is then complete.

All the examples are in `references/report-examples.md` (one of them shows a report followed by its checklist); the checklists are in `references/guide.md`.
