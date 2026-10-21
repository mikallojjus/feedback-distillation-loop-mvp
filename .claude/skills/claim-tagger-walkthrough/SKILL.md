---
name: claim-tagger-walkthrough
description: >-
  Set up a fresh practice copy of the claim tagger's editor feedback loop in Notion and guide an editor through it:
  one command creates a new page under a page the editor picks, with its own one-tag rulebook (Context-dependent),
  seven real claims that the editor decides on a Claims table like the real one, a rule-changes table and seven
  numbered steps, then says where the editor is and what to type next. Use this skill whenever someone wants to try, learn, practise, demo or teach the claim
  tagger or the editorial feedback loop, onboard a new editor, make a training or practice page, or asks "where am I
  in the walkthrough/demo", even if they never say "walkthrough". It never touches real claims or the real rulebook;
  for real tagging, distilling or promoting use /claim-tagger.
---

# Claim tagger walkthrough

**Output style.** For as long as this skill runs, its report format (section "Reporting style") replaces your output style. Do not write Insight blocks, tips or other educational notes before, between or after the commands, and do not explain the scripts, the code or your choices: the editor asked for a result, and will ask if they want the why.

`W` below stands for `node agents/claim-tagger-mvp/scripts/walkthrough.mjs`, run with the Bash tool from the repository root, one command at a time, each waited for.

## What it does and never does

- Every Notion write comes from `W`, which builds the practice page from a plan it writes first and reads every row back. You never write Notion through the connector, never create, move, archive or delete a page, never fill an editor column (on the Claims table Verified tags, Review status, Why wrong and Challenged tags notes; on Rule changes Editor wording and the Status values Approved and Rejected; on Agent settings Paused), and never read or write the production tables or `agents/claim-tagger-mvp/runs/`. The five claims a new practice page starts Reviewed, and the ledger rows that go with them, are written by the script's own setup plan, not by you.
- You never pass `--confirm`, `--bare`, `--fallback-model` or `--unpause`.
- The last thing `W` prints is a report in the shape of "Reporting style". Your final message is that report, verbatim and complete, and nothing else, except that after a demo command or `W where` a checklist follows the report when its Next line sends the editor to Notion (section "Running the steps").

## Start a practice page

1. If the request contains a Notion link or page id, use it as the parent. Otherwise ask exactly once, as your whole message: "Under which Notion page should the demo go? Paste a link." There is no default page: do not guess one and do not reuse an earlier parent unless the editor says so. Nothing runs until the link is there.
2. Run `W start --parent <link>`. Say once "Building the page." and nothing more until the report. A dry run, when the editor asks to see the page before anything is created, is `W start --parent <link> --dry-run`: it writes a preview and sends no write.
3. Exit codes: 2 with "cannot reach" means the page is not shared with the claim tagger: relay "In Notion, open that page, choose the connections menu and add the claim tagger connection, or pick another page." 2 with "protected" means the parent is a real table or the production page: ask for another page. 1 means a stop halfway: run `W start --resume <id>` once, with the id the report names; never start a second page to retry.

## Where am I

Run `W where` and relay its sentence and its "Next:" line (when that line sends the editor to Notion, with the checklist of "Running the steps" below it). `W where` and the demo commands act on the newest practice page under Demos (the newest finished page under the Demos sub-page that the script can read); a page under Demo tests, or of an older shape, is never the one they reach. `W list` names every practice page with its step when the editor asks which pages exist, and marks the one the demo commands use.

## Running the steps

The steps of the page are `/claim-tagger demo status`, `demo tag`, `demo distill` and `demo promote`; run them exactly as the claim-tagger skill's "Demo mode" says (`W run <script> ...`, against the newest practice page under Demos). Steps 3 and 5 happen in Notion: never fill those columns for the editor; link the table or view instead. Step 3 is Your queue, a view of the Claims table (the claims whose Agent status is Waits for you): both claims of the editor are To review, so after the tag step both wait there (the press pool claim although the agent is fairly sure of it), and `W where` links it. The editor fills in four columns on each claim, in the order of the page: Verified tags, Why wrong, Challenged tags notes, Review status; a claim the editor has decided stays in Your queue until the agent reads it again, which the follow-up of step 7 does. Step 5 is Lessons waiting. Step 7 needs no command: the follow-up runs by itself at the end of a passed safety check, and the promote report's Next line points at step 7; `/claim-tagger demo follow-up` only repeats it after a run that stopped early, and `W where` says when.

After a demo command, and after `W where`, the message is the report relayed verbatim and, when its Next line sends the editor to Notion, one checklist below it and nothing else. The checklist is the Demo form of the matching one in `.claude/skills/claim-tagger/references/guide.md` (Decide in Your queue, Approve in Lessons waiting, After a FAIL, Agent disagreed), copied as it stands: a numbered list of at most five lines under the report, after one blank line, with no heading and no words of your own. Its words are the page's, so step 3 of the page and the checklist name the same columns in the same order. A `W where` report starts with "Walkthrough:", not "Demo · ", and takes the Demo form all the same; the guide's table lists the Next lines of `W where` that send the editor to Notion (open Your queue and decide, open Lessons waiting and set Status to Approved, open Lessons waiting and write the rule in Editor wording, add a note in Agent disagreed). `W start`, `W list`, `W verify` and a report whose Next line only names a command get no checklist; the practice page has the steps.

## Reporting style

Editors read these reports between other tasks. Every report, errors included, has exactly three parts and nothing else:

1. **One sentence**: what ran and what came out, in plain words. Start with "Demo · " when the demo ran.
2. **One table**, at most five rows and three columns, with the figures that matter for this subcommand (see the examples in `references/report-examples.md`). Leave it out when there is nothing to count.
3. **One line starting "Next:"** with exactly one thing to do: a command to type, or a Notion link and the action to take there. When more rows wait than fit one sitting (a setting, default 20), the sentence gives the count and the line says "start at the top of Your queue (link)", not "decide your N claims".

Leave out everything else: headings, how the scripts work, the commands you ran, retries and incidents (if one changed the result, say so in a few words inside the sentence), file paths, run ids, JSON, and any duration, dollar amount or model-call count (they stay in the run record). For a stopped run, "Next:" is the same request again; the script resumes the run itself. While a step takes a while, say once what is happening, with no duration ("Building the page."), then nothing until the report.

Two examples:

Walkthrough: your practice page is ready under Editor onboarding.

| Table | Now |
|---|---|
| Rulebook | 1 tag |
| Claims | 7: 5 reviewed earlier, 2 for you |
| Rule changes | empty |

Next: open Claim tagger practice · 15 Oct 10:42 (link) and follow step 1.

Walkthrough: you are at step 3, Decide your two claims.

Next: open Your queue (link) and decide your two claims.

## References, read only when needed

- `references/manifest.md`: the practice page's content (the seven claims, the five claims Reviewed earlier, the two claims the editor decides, the example claims), how to change it, and the calibration a change must pass.
- `references/page-design.md`: the page template, the fixed format of the seven steps, the table limits, the banned words, the tables and views of the page, and what `W verify` checks.
- `references/troubleshooting.md`: a stop halfway, a stop when the allowance ran out, a run that stopped before step 7, a FAIL at step 6, a paused agent, a hand edit to the rulebook.
- `references/report-examples.md`: every report, as the editor sees it, and one report followed by its checklist.
- `.claude/skills/claim-tagger/references/guide.md`: the checklists that follow a report whose Next line sends the editor to Notion (shared with the claim-tagger skill, in the words of the page).
