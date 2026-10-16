# Report examples for the claim tagger skills

Each example is the whole report as the scripts print it today (checked against their output on the practice page of 16 October, where editors decide on the Claims table); the skills relay it verbatim. The shape was agreed in the design review (`docs/analysis-2026-10/debate/inputs/report-examples.md`).

On a practice page the first sentence names the page: a status report starts "Status of the practice page <title>:", and the other reports end their first sentence with "(practice page <title>)". The commands are the demo ones (`/claim-tagger demo promote`).

## Examples

Each example is the whole report, exactly as the editor sees it.

### status (more rows wait than fit one sitting)

Status: nothing is paused; 46 rows and 1 rule change wait for you, more than fit one sitting.

| Where | Now |
|---|---|
| Rulebook | 13 tags, edition 2026-11-04.2 |
| Your queue | 46 rows, lowest confidence first |
| Lessons waiting | 1 rule change to approve |
| Last run | Tag · 4 Nov 09:12 · 214 claims |

Next: start at the top of Your queue (link).

### status (demo, step 1)

Nothing waits yet: Your queue lists the claims the agent is unsure about, and the agent has not read the claims.

Demo · Status of the practice page Claim tagger demo · 15 Oct 10:42: nothing is paused and nothing waits for you.

| Where | Now |
|---|---|
| Rulebook | 1 tag, edition 2026-10-15.1 |
| Your queue | nothing waits |
| Lessons waiting | none |
| Last run | none yet |

Next: type /claim-tagger demo tag so that the agent reads the claims first (step 2 of the practice page).

### status (demo, after the tag step)

Only the AI Force claim waits in Your queue: the agent was fairly sure about the press pool claim, which is still To review in the Claims table. `walkthrough.mjs where` names both claims (see the last example).

Demo · Status of the practice page Claim tagger demo · 15 Oct 10:42: nothing is paused; 1 row waits for you.

| Where | Now |
|---|---|
| Rulebook | 1 tag, edition 2026-10-15.1 |
| Your queue | 1 row, lowest confidence first |
| Lessons waiting | none |
| Last run | Tag · 15 Oct 10:50 · 7 claims |

Next: decide the 1 row in Your queue (link).

### tag (demo)

Demo · Tag: the agent read 7 claims for Context-dependent; 1 waits for you (practice page Claim tagger demo · 15 Oct 10:42).

| What | Result |
|---|---|
| Claims read | 7 |
| Tagged Context-dependent | 3 claims |
| New rows in Your queue | 1, lowest confidence first |

Next: decide the 1 row in Your queue (link).

### tag (real claims, the first run: Context-dependent only)

Tag: the agent read 214 claims for Context-dependent; 9 wait for you.

| What | Result |
|---|---|
| Claims read | 214 |
| Tagged Context-dependent | 31 claims |
| New rows in Your queue | 9, lowest confidence first |

Next: decide the 9 rows in Your queue (link).

### distill (demo)

Demo · Distill: one rule change drafted from your 2 notes (practice page Claim tagger demo · 15 Oct 10:42).

| What | Result |
|---|---|
| Rule change | "Known groups count as identified, unknown names do not" |
| Rule | Context-dependent rule 3, Proposed |
| Rests on | your 2 rows |

Next: read it in Lessons waiting (link), where the current and the proposed text sit side by side, and approve it or write your own wording.

### promote, when it passes (demo)

Demo · Promote: PASS, rule 3 now uses your approved wording (edition 2026-10-15.2), and the follow-up marked both of your rows Fixed (practice page Claim tagger demo · 15 Oct 10:42).

| Check | Result |
|---|---|
| Example claims | 10 of 10 right |
| Earlier decisions | 5 of 5 still right |
| Your 2 rows | 2 of 2 now right, marked Fixed |

Next: look at step 7 on the practice page (link); the demo is then complete.

### promote, when it does not pass (demo)

Editor wording is the whole rule, so the Next line hands the editor the whole text: the rule as it was tested, then one sentence written from the claim that came out wrong. That claim can be an example claim, an earlier decision (as here) or one of the editor's own claims. Double quotes inside the text are printed as single ones.

Demo · Promote: FAIL, rule 3 is unchanged: the new wording turns "The Dallas convention is the unofficial launch of JD Vanc..." to Does not apply (practice page Claim tagger demo · 15 Oct 10:42).

| Check | Result |
|---|---|
| Example claims | 10 of 10 right |
| Earlier decisions | 4 of 5 still right |
| Your 2 rows | 2 of 2 now right |

Next: in Lessons waiting (link), open the change and put this whole text into Editor wording: "A descriptive definite that names a kind of thing but not which one ('the Bitcoin ETF', 'the major-bank stablecoin consortium', 'the open-access version', 'the infrastructure', 'the new model') makes the claim Context-dependent: the reader must already know which ETF, consortium, version or product is meant. Applies to countable things, not to abstract or mass nouns ('the regulatory clearance', 'the market'). A group readers know by its standing role, such as a press corps, counts as identified; a capitalised phrase that names no body readers know does not. A one-off event named only by its place or kind, such as a convention, still needs context."; then type `/claim-tagger demo promote` again.

### follow-up, repeated by hand (demo, only after a promote that stopped before its last step)

Demo · Follow-up, repeated by hand: the agent now agrees with both of your decisions (practice page Claim tagger demo · 15 Oct 10:42).

| Your row | Follow-up |
|---|---|
| "The press pool was justified in suspendi..." | Fixed |
| "The AI Force should enforce binding s..." | Fixed |

Next: nothing; the demo is complete.

### A stopped run

Demo · Tag stopped: your Claude allowance ran out; nothing was written to Notion (practice page Claim tagger demo · 15 Oct 10:42).

Next: when your Claude allowance is back, type /claim-tagger demo tag again; it continues where it stopped.

### Walkthrough: start

If the request has no link, the skill first asks one question and does nothing else: "Under which Notion page should the demo go? Paste a link."

Walkthrough: your practice page is ready under Editor onboarding.

| Table | Now |
|---|---|
| Rulebook | 1 tag |
| Claims | 7: 5 reviewed earlier, 2 for you |
| Rule changes | empty |

Next: open Claim tagger practice · 15 Oct 10:42 (link) and follow step 1.

### Walkthrough: start, when the page cannot be reached

Walkthrough: no demo was created, because the claim tagger cannot reach that Notion page.

Next: in Notion, open that page, choose the connections menu and add the claim tagger connection, or pick another page.

### Walkthrough: where

Your queue lists only the claims the agent is unsure about, and the press pool claim is not one of them, so the line links the Claims table, where both of the editor's claims are To review.

Walkthrough: you are at step 3, Decide your two claims.

Next: open Claims (link) and decide the two claims whose Review status is To review.
