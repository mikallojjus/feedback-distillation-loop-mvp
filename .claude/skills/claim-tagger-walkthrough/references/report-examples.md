# Report examples for the claim tagger skills

Each example is the whole report as the scripts print it today (the shape after the reading round of 22 October, where the editor fills Verified tags, Challenged tags notes and Review status, and the agent reads each decision itself and writes eight columns of its own); the skills relay it verbatim. When a report's Next line sends the editor to Notion, the skill adds the matching checklist of `guide.md` under it, after one blank line; one example below shows that (the demo tag report). The other examples leave the checklist out to stay short, but the rule is the same for each of them. The shape was agreed in the design review (`docs/analysis-2026-10/debate/inputs/report-examples.md`).

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

Nothing waits yet: Your queue lists a claim only once the agent has read it. The five earlier decisions already carry a reading, put there when the page was made, so there is nothing to read and no Your decisions row.

Demo · Status of the practice page Claim tagger demo · 15 Oct 10:42: nothing is paused and nothing waits for you.

| Where | Now |
|---|---|
| Rulebook | 1 tag, edition 2026-10-15.1 |
| Your queue | nothing waits |
| Lessons waiting | none |
| Last run | none yet |

Next: type /claim-tagger demo tag so that the agent reads the claims first (step 2 of the practice page).

### status (demo, after the tag step)

All four claims of the editor are To review, so after the tag step all four wait in Your queue.

Demo · Status of the practice page Claim tagger demo · 15 Oct 10:42: nothing is paused; 4 rows wait for you.

| Where | Now |
|---|---|
| Rulebook | 1 tag, edition 2026-10-15.1 |
| Your queue | 4 rows, lowest confidence first |
| Lessons waiting | none |
| Last run | Tag · 15 Oct 10:50 · 9 claims |

Next: decide your four claims in Your queue (link).

### status (demo, midway: all four claims decided)

The editor has decided all four claims, but Your queue still lists them until the agent's next run reads the decisions, so the row says that and not "nothing waits". Nothing is left to decide, and the agent has not read the decisions yet, so the sentence says what the agent has to do (it does not say that nothing waits for you), and a Your decisions row counts the decisions, in up to three parts that are left out while they are zero: the decisions still to read ("3 to read"), the decisions that point at a rule, once read and with a note ("2 point at a rule"), and the decisions without a note ("1 without a note"); here the USPS claim was decided without a note. When only decisions without a note are left, the sentence reads "...; 1 of your decisions has no note." The reading is made by distill, so the Next line is the distill step, which reads the decisions and turns the ones that blame the rule into a draft rule. After the follow-up of step 7 has marked the rows the draft rests on Fixed, those claims no longer ask for distill. After a promote nothing is to read (the key of a reading holds the edition the proposal was made under), so the status of step 7 has no Your decisions row.

Demo · Status of the practice page Claim tagger demo · 15 Oct 10:42: nothing is paused; the agent has 3 of your decisions to read.

| Where | Now |
|---|---|
| Rulebook | 1 tag, edition 2026-10-15.1 |
| Your queue | 4 rows decided, waiting for the agent's next run |
| Your decisions | 3 to read, 1 without a note |
| Lessons waiting | none |
| Last run | Tag · 15 Oct 10:50 · 9 claims |

Next: type /claim-tagger demo distill to draft a rule change from your decisions.

### tag (demo), the report followed by its checklist

All four claims of the editor are To review, so no tag is written on them and all four wait; the other five are Reviewed and keep the editor's tags. The Next line sends the editor to Notion, so the checklist "Decide in Your queue" (Demo form, from `guide.md`) follows the report, after one blank line, and nothing follows it. The sentence, the table and the Next line are the report; the numbered list under it is the checklist.

Demo · Tag: the agent read 9 claims for Context-dependent; 4 wait for you (practice page Claim tagger demo · 15 Oct 10:42).

| What | Result |
|---|---|
| Claims read | 9 |
| Carrying Context-dependent | 2 claims (earlier decisions included) |
| New rows in Your queue | 4, lowest confidence first |

Next: decide your four claims in Your queue (link).

1. Open Your queue (the link in the Next line): your four claims wait there.
2. On each of your four claims fill in, in this order: Verified tags, Challenged tags notes, Review status; step 3 of the practice page gives the values.
3. Paste the words between the quotes that the page gives for Challenged tags notes (the Georgia claim's note stays empty: an empty note is a decision too), and set Review status to Reviewed last.
4. A decided claim stays in Your queue until the agent reads it again, which the follow-up of step 7 does for the claims the rule change rests on.
5. When all four claims are Reviewed, type /claim-tagger demo distill.

### tag (real claims, the first run: Context-dependent only)

Tag: the agent read 214 claims for Context-dependent; 9 wait for you.

| What | Result |
|---|---|
| Claims read | 214 |
| Carrying Context-dependent | 31 claims (earlier decisions included) |
| New rows in Your queue | 9, lowest confidence first |

Next: decide your nine claims in Your queue (link).

### status (demo, a rule change that rests on a decision the editor now calls the agent's slip)

The editor opened the note of a decision the draft rests on with "Agent slip." after the draft was made. The draft's text was written with that decision in mind, so the row of Lessons waiting says to reject it, and the Next line comes before "approve or reject". Only the editor sets Rejected; the agent never withdraws a draft.

Demo · Status of the practice page Claim tagger demo · 15 Oct 10:42: nothing is paused; 1 rule change waits for you.

| Where | Now |
|---|---|
| Rulebook | 1 tag, edition 2026-10-15.1 |
| Your queue | nothing waits |
| Lessons waiting | 1 rule change to reject (rests on a decision you now call a slip) |
| Last run | Distill · 15 Oct 11:02 · 1 rule change |

Next: reject the rule change "Known groups count as identified, unknown names do not" in Lessons waiting (link), then type /claim-tagger demo distill again.

### distill (demo)

The agent read three decisions (the press pool and the AI Force claim through its model, the USPS claim from the reason word in the editor's note), found nothing to read on the Georgia claim, and drafted one rule change from the two decisions that blame the rule. The sentence counts decisions, not notes.

Demo · Distill: read 3 of your decisions and drafted one rule change from 2 of them (practice page Claim tagger demo · 15 Oct 10:42).

| What | Result |
|---|---|
| Read | 3 decisions |
| Point at a rule | 2 decisions |
| Agent slips | 1 decision |
| Without a note | none |
| Rule change | "Known groups count as identified, unknown names do not", Context-dependent rule 3 |

Next: read it in Lessons waiting (link), where the current and the proposed text sit side by side, and approve it or write your own wording.

### distill (demo), a decision without a note

A decision that differs from the agent's tag and has no note is read all the same, carefully and from the claim and the rule alone, and flagged "without your note" on the claim. The agent's reading of a decision nobody explained is a guess, so it never goes into a draft: it is counted under Without a note, listed in Needs your note, and the sentence says how many decisions wait for a note. Here a rule change was drafted from the two decisions that have a note, so the Next line opens Lessons waiting.

Demo · Distill: read 3 of your decisions and drafted one rule change from 2 of them; 1 of your decisions has no note and waits in Needs your note (practice page Claim tagger demo · 15 Oct 10:42).

| What | Result |
|---|---|
| Read | 3 decisions |
| Point at a rule | 2 decisions |
| Agent slips | none |
| Without a note | 1 decision |
| Rule change | "Known groups count as identified, unknown names do not", Context-dependent rule 3 |

Next: read it in Lessons waiting (link), where the current and the proposed text sit side by side, and approve it or write your own wording.

### distill (demo), no rule change while a decision has no note

When no rule change is drafted and none waits, the Next line sends the editor to Needs your note. Once the note is there the row is read again and may support a draft.

Demo · Distill: read 1 of your decisions; no rule change to draft; 6 decided rows name no rule problem; 1 of your decisions has no note and waits in Needs your note (practice page Claim tagger demo · 15 Oct 10:42).

| What | Result |
|---|---|
| Read | 1 decision |
| Point at a rule | none |
| Agent slips | 1 decision |
| Without a note | 1 decision |
| Rule change | none |

Next: add a note on 1 claim in Needs your note (link), then type /claim-tagger demo distill again.

### distill (demo), a rule change that rests on a decision the editor now calls the agent's slip

The editor opened a note with "Agent slip." after the draft was made. The agent takes the word at once and asks nothing, but the draft's text was written with that decision in mind, so the sentence says so and the Next line asks the editor to reject the draft before anything else. Nothing new is drafted for that rule while the old draft is open; after the rejection, typing distill again drafts from the decisions that remain.

Demo · Distill: read 1 of your decisions; no rule change to draft; the 2 decisions that point at rule 3 already have a rule change waiting for you; the rule change "Known groups count as identified, unknown names do not" rests on a decision you now call the agent's slip (practice page Claim tagger demo · 15 Oct 10:42).

| What | Result |
|---|---|
| Read | 1 decision |
| Point at a rule | none |
| Agent slips | 1 decision |
| Without a note | none |
| Rule change | none |

Next: reject the rule change "Known groups count as identified, unknown names do not" in Lessons waiting (link), then type /claim-tagger demo distill again.

### distill (demo), nothing new to read

When a rule change already waits, the Next line is the one status gives: approve or reject it (or, for an approved one, type the promote command).

Demo · Distill: nothing new to read; no rule change to draft; the 2 decisions that point at rule 3 already have a rule change waiting for you (practice page Claim tagger demo · 15 Oct 10:42).

Next: approve or reject the rule change in Lessons waiting (link).

### distill (demo), nothing new to read and nothing waiting

Demo · Distill: nothing new to read; no rule change to draft; 6 decided rows name no rule problem (practice page Claim tagger demo · 15 Oct 10:42).

Next: type /claim-tagger demo status to see what is open.

### promote, when it passes (demo)

Demo · Promote: PASS, rule 3 now uses your approved wording (edition 2026-10-15.2), and the follow-up marked both of your rows Fixed (practice page Claim tagger demo · 15 Oct 10:42).

| Check | Result |
|---|---|
| Example claims | 10 of 10 right |
| Earlier decisions | 6 of 6 still right |
| Your 2 rows | 2 of 2 now right, marked Fixed |

Next: look at step 7 on the practice page (link); the demo is then complete.

### promote, held because a decision was recanted (demo)

The editor approved a draft that rests on a decision they have since called the agent's slip. Promote holds before the safety check and writes nothing; the rule change stays Approved until the editor rejects it.

Demo · Promote: held: the rule change "Known groups count as identified, unknown names do not" rests on a decision you now call the agent's slip, so the safety check did not run (practice page Claim tagger demo · 15 Oct 10:42).

Next: reject the rule change "Known groups count as identified, unknown names do not" in Lessons waiting (link), then type /claim-tagger demo distill again.

### promote, when it does not pass (demo)

Editor wording is the whole rule, so the Next line hands the editor the whole text: the rule as it was tested, then one sentence written from the claim that came out wrong. That claim can be an example claim, an earlier decision (as here) or one of the editor's own claims. Double quotes inside the text are printed as single ones.

Demo · Promote: FAIL, rule 3 is unchanged: the new wording turns "The Dallas convention is the unofficial launch of JD Vanc..." to Does not apply (practice page Claim tagger demo · 15 Oct 10:42).

| Check | Result |
|---|---|
| Example claims | 10 of 10 right |
| Earlier decisions | 5 of 6 still right |
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
| Claims | 9: 5 reviewed earlier, 4 for you |
| Rule changes | empty |

Next: open Claim tagger practice · 15 Oct 10:42 (link) and follow step 1.

### Walkthrough: start, when the page cannot be reached

Walkthrough: no demo was created, because the claim tagger cannot reach that Notion page.

Next: in Notion, open that page, choose the connections menu and add the claim tagger connection, or pick another page.

### Walkthrough: where

Without the linked view (Notion refused it) the line links the Claims table instead.

Walkthrough: you are at step 3, Decide your four claims.

Next: open Your queue (link) and decide your four claims.

### Walkthrough: where, on a page where no command has written yet

`status` writes nothing, so a page stays at step 1 until the tag step has run.

Walkthrough: you are at step 1, Meet the demo.

Next: type /claim-tagger demo status.

### Walkthrough: where, after the first of the four claims

Walkthrough: you are at step 3, Decide your four claims.

Next: open Your queue (link) and decide your remaining claims.

### Walkthrough: where, when a follow-up marked a claim Still wrong

Walkthrough: you are at step 7, The agent re-checks your claims.

Next: add a note in Challenged tags notes on the claims in Agent disagreed (link).
