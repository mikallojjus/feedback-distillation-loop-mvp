# Skill reports: the template and examples (design, updated after the editor's first review)

How `/claim-tagger` and the walkthrough skill report back after each command. The first part is the exact wording planned for the skills' instructions. The second part shows what the editor sees after each command; the figures are illustrative. There is no table of runs, so "Last run" is read from the Agent settings row ("Last run summary"). Reports carry no durations, no dollar amounts and no model-call counts: those stay in the run record. One row, "Usage", is added only once the share of the usage window that a run took is known. View names are the same on the practice page and the real page: Your queue, Needs your note, Lessons waiting, Rulebook. When more rows wait than fit one sitting (a setting, default 20), the sentence gives the count and "Next:" says "start at the top of Your queue (link)" instead of "decide the N rows" (see status). The first real run judges Context-dependent only, so the first queue is tens of rows.

## The template (wording for the skill instructions)

Put this directly under the title paragraph:

> **Output style.** For as long as this skill runs, its report format (section "Reporting style") replaces your output style. Do not write Insight blocks, tips or other educational notes before, between or after the commands, and do not explain the scripts, the code or your choices: the editor asked for a result, and will ask if they want the why.

Replace the current "Reporting style" section with:

> ## Reporting style
>
> Editors read these reports between other tasks. Every report, errors included, has exactly three parts and nothing else:
>
> 1. **One sentence**: what ran and what came out, in plain words. Start with "Demo · " when the demo ran.
> 2. **One table**, at most five rows and three columns, with the figures that matter for this subcommand (see the examples in `references/report-examples.md`). Leave it out when there is nothing to count.
> 3. **One line starting "Next:"** with exactly one thing to do: a command to type, or a Notion link and the action to take there. When more rows wait than fit one sitting (a setting, default 20), the sentence gives the count and the line says "start at the top of Your queue (link)", not "decide the N rows".
>
> Leave out everything else: headings, how the scripts work, the commands you ran, retries and incidents (if one changed the result, say so in a few words inside the sentence), file paths, run ids, JSON, and any duration, dollar amount or model-call count (they stay in the run record). Add one row, "Usage", only when the share of the usage window that the run took is known. For a stopped run, "Next:" is the same slash command; the skill resumes the run itself. While a step takes a while, say once what is happening, with no duration ("Reading 7 claims."), then nothing until the report.

## Examples

Each example is the whole report, exactly as the editor sees it.

### status (more rows wait than fit one sitting)

Status: nothing is paused; 46 rows and 1 rule change wait for you, more than fit one sitting.

| Where | Now |
|---|---|
| Rulebook | 13 Issue tags, edition 2026-11-04.2, same as Notion |
| Your queue | 46 rows, lowest confidence first (the view shows the count) |
| Lessons waiting | 1 rule change to approve |
| Last run | Tag · 4 Nov 09:12 · 214 claims |

Next: start at the top of Your queue (link).

### tag (demo)

Demo · tag: the agent read the 7 claims and proposed Applies on both of your rows.

| What | Result |
|---|---|
| Claims read | 7 |
| Your rows | 2, both Applies, citing rule 4 |
| Earlier decisions | 5 of 5 agree with the agent |

Next: fill in your 2 rows in Your queue (link).

### tag (real claims, the first run: Context-dependent only)

Tag: the agent read 214 new claims for Context-dependent; 9 of them wait for you.

| What | Result |
|---|---|
| Claims read | 214 |
| Tagged Context-dependent | 31 claims |
| New rows in Your queue | 9, lowest confidence first |
| Usage | 3% of the usage window (a row shown only once the share is known) |

Next: decide the 9 rows in Your queue (link).

### distill (demo)

Demo · distill: one rule change drafted from your 2 notes.

| What | Result |
|---|---|
| Rule change | General references pass the rule 4 test |
| Rule | Context-dependent rule 4, Proposed |
| Rests on | your 2 rows |

Next: read it in Lessons waiting (link), where the current and the proposed text sit side by side, and approve it or write your own wording.

### draft-rules (one tag, chosen by the editor)

Draft rules: first rules for Wordy are drafted and wait for your approval.

| What | Result |
|---|---|
| Tag | Wordy, the tag you chose |
| Rule change | First rules for Wordy, Proposed |
| Example claims | the tag's examples from the taxonomy, shown next to the drafted rules |

Next: read the rules next to the example claims in Lessons waiting (link), and approve or rewrite them.

### promote, when it passes (demo)

Demo · promote: PASS, rule 4 now uses your approved wording (edition 2026-10-15.2), and the follow-up marked both of your rows Fixed.

| Check | Result |
|---|---|
| Example claims | 11 of 11 right |
| Earlier decisions | 5 of 5 still right |
| Your 2 rows | 2 of 2 now right, marked Fixed |

Next: look at step 7 on the demo page (link); the demo is then complete.

### promote, when it does not pass (demo)

Demo · promote: FAIL, rule 4 is unchanged: the new wording turns "Melania Trump should not host her initiative's..." to Does not apply.

| Check | Result |
|---|---|
| Example claims | 11 of 11 right |
| Earlier decisions | 4 of 5 still right |
| Your 2 rows | 2 of 2 now right |

Next: in Lessons waiting (link), paste this sentence into Editor wording or edit it: "A reference to one particular thing the claim does not name, such as 'her initiative', still fails the test." Then type `/claim-tagger demo promote`.

### follow-up, repeated by hand (demo, only after a promote that stopped before its last step)

Demo · follow-up, repeated by hand: the agent now agrees with both of your decisions.

| Your row | Follow-up |
|---|---|
| The focus on the COVID-19 vaccine... | Fixed |
| Georgia's gubernatorial debate... | Fixed |

Next: nothing; the demo is complete.

### A stopped run

Demo · tag stopped: the usage limit was reached after 4 of 7 claims; nothing was written to Notion.

Next: when your Claude allowance is back, type `/claim-tagger demo tag` again; it continues where it stopped.

### Walkthrough: start

If the request has no link, the skill first asks one question and does nothing else: "Under which Notion page should the demo go? Paste a link."

Walkthrough: your demo page is ready under Editor onboarding.

| Table | Now |
|---|---|
| Rulebook | 1 tag, Context-dependent |
| Claims | 7 |
| Tag decisions | 7: 5 decided earlier, 2 for you |
| Rule changes | empty |

Next: open Claim tagger demo · 15 Oct 10:42 (link) and follow step 1.

### Walkthrough: start, when the page cannot be reached

Walkthrough: no demo was created, because the claim tagger cannot reach that Notion page.

Next: in Notion, open that page, choose ⋯ → Connections and add the claim tagger connection, then ask again (or paste another page).

### Walkthrough: where

Walkthrough: you are at step 3, deciding your two rows.

Next: fill in your 2 rows in Your queue (link).
