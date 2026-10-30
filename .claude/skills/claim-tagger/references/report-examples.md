# Report examples for the claim tagger skills

Each example is the whole report as the scripts print it on the page "Claim tagger v2" (one row per claim and tag on Tag decisions, where the editor ticks Agent is right or sets Tag outcome and may write Your note, and the agent reads each decision itself and writes its view in Agent's view of your decision, with the Rule and Why the agent thinks so); the skills relay it verbatim. When a report's Next line sends the editor to Notion, the skill adds the matching checklist of `guide.md` under it, after one blank line; one example below shows that (the tag report). The other examples leave the checklist out to stay short, but the rule is the same for each of them. The shape was agreed in the design review (`docs/analysis-2026-10/debate/inputs/report-examples.md`).

The practice pages are parked (P48): their reports, which start "Demo · ", are in the version tagged claim-tagger-v1.

## Examples

Each example is the whole report, exactly as the editor sees it.

### status (more rows wait than fit one sitting)

Status: nothing is paused; 46 rows and 1 rule change wait for you, more than fit one sitting.

| Where | Now |
|---|---|
| Rulebook | 13 tags, edition 2026-11-04.2 |
| Your queue | 46 rows, by claim, lowest confidence first |
| Lessons waiting | 1 rule change to approve |
| Last run | Tag · 4 Nov 09:12 · 200 claims |

Next: start at the top of Your queue (link).

### status (nothing left to decide, decisions to read)

The editor has decided every row in Your queue. A row leaves Your queue as soon as it has a Tag outcome, or a tick on a row whose proposal is not Can't tell, so the row Your queue counts only what the view lists and says "nothing waits"; the rows still read Waits for you in Agent status until the next tag run, but the view does not show them. Nothing is left to decide, and the agent has not read the decisions yet, so the sentence says what the agent has to do (it does not say that nothing waits for you), and a Your decisions row counts the decided rows, in up to three parts that are left out while they are zero: the decisions still to read ("3 to read"), the decisions that point at a rule, once read and with a note ("2 point at a rule"), and the decisions without a note ("1 without a note"). When only decisions without a note are left, the sentence reads "...; 1 of your decisions has no note." The reading is made by distill, so the Next line is the distill step, which reads the decisions and turns the ones that blame the rule into a draft rule. After a promote nothing is to read (the key of a reading holds the edition the proposal was made under), so the status after it has no Your decisions row.

Status: nothing is paused; the agent has 3 of your decisions to read.

| Where | Now |
|---|---|
| Rulebook | 13 tags, edition 2026-10-30.1 |
| Your queue | nothing waits |
| Your decisions | 3 to read, 1 without a note |
| Lessons waiting | none |
| Last run | Tag · 30 Oct 10:50 · 600 claims |

Next: type /claim-tagger distill to draft a rule change from your decisions.

### tag (the first run: Context-dependent only), the report followed by its checklist

The agent read every claim of Claims for the one tag that has rules; the rows decided earlier count as the editor decided them. The Next line sends the editor to Notion, so the checklist "Decide in Your queue" (from `guide.md`) follows the report, after one blank line, and nothing follows it. The sentence, the table and the Next line are the report; the numbered list under it is the checklist. When a later run answers otherwise than a decided row, the table adds a row "Agent disagreed" with the count; claims the judge could not read this time are counted in "Not read yet".

Tag: the agent read 200 claims for Context-dependent; 9 wait for you.

| What | Result |
|---|---|
| Claims read | 200 |
| Carrying Context-dependent | 31 claims (earlier decisions included) |
| New rows in Your queue | 9, by claim, lowest confidence first |

Next: decide your nine rows in Your queue (link).

1. Open Your queue (the link in the Next line): the rows, a claim and one tag, that wait for you; a claim's rows stand together.
2. Read Agent proposal and Agent reason. Open claim opens the claim, with its sources and its Geo link.
3. Agree with the agent? Tick Agent is right. Disagree, or it says Can't tell? Set Tag outcome. The row then leaves Your queue.
4. Your note is optional. When you overrule the agent, say why in your own words: without a note the agent drafts no rule change. You need not name a rule or a reason.
5. When your rows are decided, type /claim-tagger distill.

### status (a rule change that rests on a decision the agent now reads as its own slip)

The editor changed the note of a decision the draft rests on after the draft was made, and the agent now reads that decision as its own slip. The draft's text was written with that decision in mind, so the row of Lessons waiting says to reject it, and the Next line comes before "approve or reject". Only the editor sets Rejected; the agent never withdraws a draft.

Status: nothing is paused; 1 rule change waits for you.

| Where | Now |
|---|---|
| Rulebook | 13 tags, edition 2026-10-30.1 |
| Your queue | nothing waits |
| Lessons waiting | 1 rule change to reject (rests on a decision the agent now reads as a slip) |
| Last run | Distill · 30 Oct 11:02 · 1 rule change |

Next: reject the rule change "Known groups count as identified, unknown names do not" in Lessons waiting (link), then type /claim-tagger distill again.

### distill

The agent read three decisions through its model and drafted one rule change from the two that blame the rule. The sentence counts decisions, not notes. Every decision is read by the model: a note that names a reason ("Agent slip") is evidence of what the editor saw, never taken as it stands (P45).

Distill: read 3 of your decisions and drafted one rule change from 2 of them.

| What | Result |
|---|---|
| Read | 3 decisions |
| Point at a rule | 2 decisions |
| Agent slips | 1 decision |
| Without a note | none |
| Rule change | "Known groups count as identified, unknown names do not", Context-dependent rule 3 |

Next: read it in Lessons waiting (link), where the current and the proposed text sit side by side, and approve it or write your own wording.

### distill, a decision without a note

A decision that differs from the agent's proposal and has no note is read all the same, carefully and from the claim and the rule alone, and Why the agent thinks so opens with "without your note" on its row. The agent's reading of a decision nobody explained is a guess, so it never goes into a draft: it is counted under Without a note, listed in Needs your note, and the sentence says how many decisions wait for a note. Here a rule change was drafted from the two decisions that have a note, so the Next line opens Lessons waiting.

Distill: read 3 of your decisions and drafted one rule change from 2 of them; 1 of your decisions has no note and waits in Needs your note.

| What | Result |
|---|---|
| Read | 3 decisions |
| Point at a rule | 2 decisions |
| Agent slips | none |
| Without a note | 1 decision |
| Rule change | "Known groups count as identified, unknown names do not", Context-dependent rule 3 |

Next: read it in Lessons waiting (link), where the current and the proposed text sit side by side, and approve it or write your own wording.

### distill, no rule change while a decision has no note

When no rule change is drafted and none waits, the Next line sends the editor to Needs your note. Once the note is there the row is read again and may support a draft.

Distill: read 1 of your decisions; no rule change to draft; 6 decided rows name no rule problem; 1 of your decisions has no note and waits in Needs your note.

| What | Result |
|---|---|
| Read | 1 decision |
| Point at a rule | none |
| Agent slips | 1 decision |
| Without a note | 1 decision |
| Rule change | none |

Next: add a note on 1 row in Needs your note (link), then type /claim-tagger distill again.

### distill, a rule change that rests on a decision the agent now reads as its own slip

The editor changed the note of a decision after the draft was made, and the agent now reads it as its own slip. The draft's text was written with that decision in mind, so the sentence says so and the Next line asks the editor to reject the draft before anything else. Nothing new is drafted for that rule while the old draft is open; after the rejection, typing distill again drafts from the decisions that remain.

Distill: read 1 of your decisions; no rule change to draft; the 2 decisions that point at rule 3 already have a rule change waiting for you; the rule change "Known groups count as identified, unknown names do not" rests on a decision the agent now reads as its own slip.

| What | Result |
|---|---|
| Read | 1 decision |
| Point at a rule | none |
| Agent slips | 1 decision |
| Without a note | none |
| Rule change | none |

Next: reject the rule change "Known groups count as identified, unknown names do not" in Lessons waiting (link), then type /claim-tagger distill again.

### distill, nothing new to read

When a rule change already waits, the Next line is the one status gives: approve or reject it (or, for an approved one, type the promote command).

Distill: nothing new to read; no rule change to draft; the 2 decisions that point at rule 3 already have a rule change waiting for you.

Next: approve or reject the rule change in Lessons waiting (link).

### distill, nothing new to read and nothing waiting

Distill: nothing new to read; no rule change to draft; 6 decided rows name no rule problem.

Next: type /claim-tagger status to see what is open.

### promote, when it passes

The follow-up runs by itself after a PASS: it checks the rows the change rests on once more and writes Fixed or Still wrong in their After the rule change column. "Your 2 rows" counts those rows.

Promote: PASS, rule 3 now uses your approved wording (edition 2026-10-28.2), and the follow-up marked both of your rows Fixed.

| Check | Result |
|---|---|
| Example claims | 10 of 10 right |
| Earlier decisions | 5 of 5 still right |
| Your 2 rows | 2 of 2 now right, marked Fixed |

Next: nothing waits; type /claim-tagger status to see what is open.

### promote, when it passes with an example that was wrong before

The safety check counts example claims the way it counts earlier decisions: the ones the rulebook in force gets right, and a change fails only by turning one of those wrong. So "Example claims" reads like "Earlier decisions". An example that is wrong under both rulebooks is shown in its own row, "Wrong before the change", and not counted; the row is in the table of a FAIL too. The result written in Rule changes then reads "PASS: examples 10/10 (1 more wrong before, not counted), earlier 5/5, yours 2/2", and with no such example it reads as it always did. An old miss that the change puts right is not in the row; the engineer's card lists it as fixed by the change. An example or an earlier decision that comes out wrong under both rulebooks is read again on both sides before it is called an old miss, so one unlucky read cannot hide a real break. The engineer may recalibrate the example in the examples file; the editor needs to do nothing.

Promote: PASS, rule 3 now uses your approved wording (edition 2026-10-28.2), and the follow-up marked both of your rows Fixed.

| Check | Result |
|---|---|
| Example claims | 10 of 10 right |
| Wrong before the change | 1 more example claim, not counted |
| Earlier decisions | 5 of 5 still right |
| Your 2 rows | 2 of 2 now right, marked Fixed |

Next: nothing waits; type /claim-tagger status to see what is open.

### promote, when it does not pass

Editor wording is the whole rule, so a FAIL report has a fourth part between the table and the Next line, the suggestion: one sentence written from the claim that came out wrong, the reason for it (the Why line), and the rule as it was tested with the sentence added, one sentence per line, in a block to copy. The sentence of the report says which answer the claim came out with and which one is right. The claim can be an example claim that was right under the rule in force (an example that is wrong under both rulebooks is shown in its own row and never named here), an earlier decision or one of the rows the change rests on. The block holds only the rule, so what is pasted into Editor wording is what was tested and the sentence; the editor may also write the whole rule as wanted. The suggested sentence uses the rule's own words and does not repeat what the rule already says, and the Why line has two halves: what the claim needs to get its answer, and what in the tested wording let it go the other way. When no sentence could be written the report has its three parts and the Next line asks for the whole rule.

Promote: FAIL, rule 3 is unchanged: the new wording turns "The infrastructure plan won approval from the council." to Does not apply; the right answer is Applies.

| Check | Result |
|---|---|
| Example claims | 9 of 10 right |
| Wrong before the change | 1 more example claim, not counted |
| Earlier decisions | 5 of 5 still right |
| Your 2 rows | 2 of 2 now right |

Suggested sentence for rule 3:
> A plan named only by its subject, such as 'the infrastructure plan', fits more than one plan and still makes the claim Context-dependent.

Why: Readers cannot tell which plan 'The infrastructure plan' means, so it needs context to be tagged. The new wording read it as the name of one specific program, which let it slip to Does not apply.

Rule 3 with the sentence, to copy into Editor wording:
```
A descriptive definite that names a kind of thing but not which one ('the Bitcoin ETF', 'the major-bank stablecoin consortium', 'the open-access version', 'the infrastructure', 'the new model') makes the claim Context-dependent: the reader must already know which ETF, consortium, version or product is meant.
A description that works as the name of one specific program, law or rule, so that only one thing fits it, already says which one and does not count; a description that more than one thing could fit (more than one campaign, more than one convention in the same city) still counts.
Applies to countable things, not to abstract or mass nouns ('the regulatory clearance', 'the market').
A plan named only by its subject, such as 'the infrastructure plan', fits more than one plan and still makes the claim Context-dependent.
```

Next: in Lessons waiting (link), paste the block above into Editor wording in place of what is there, or write all of rule 3 as you want it; then type /claim-tagger promote again.

### promote, held because a decision now reads as the agent's slip

The editor approved a draft that rests on a decision the agent has since read as its own slip (the editor changed the note after the draft was made). Promote holds before the safety check and writes nothing; the rule change stays Approved until the editor rejects it.

Promote: held: the rule change "Known groups count as identified, unknown names do not" rests on a decision the agent now reads as its own slip, so the safety check did not run.

Next: reject the rule change "Known groups count as identified, unknown names do not" in Lessons waiting (link), then type /claim-tagger distill again.

### follow-up, repeated by hand (only after a promote that stopped before its last step)

The table names each row the rule change rests on by its claim, and what the follow-up wrote in its After the rule change column. When a row is still wrong the sentence says how many, and the Next line is "say why in Your note on the rows in Agent disagreed (link)", which takes the checklist "Agent disagreed".

Follow-up, repeated by hand: the agent now agrees with both of your decisions.

| Your row | After the rule change |
|---|---|
| "The press pool was justified in suspendi..." | Fixed |
| "The AI Force should enforce binding s..." | Fixed |

Next: type /claim-tagger status to see what is open.

### decide

The editor and Claude went through six rows in a conversation: Claude showed a draft, the editor changed it, and Claude wrote the three Tag decisions columns (Agent is right, Tag outcome, Your note) through the connector only after the editor said to write. `decide.mjs check` then read every row back, so this is the report of `check`; the draft, and what `list` and `open` print, are for the conversation and are not part of the report. The rows count the decisions: the ones that equal the agent's proposal (a tick always does), and the ones that differ, with how many of those carry a note. A note is the editor's own words on the row; a decision that differs and has none has no note, and distill drafts nothing from it. The row "Not compared with the agent" comes only when a decision gave only a note on a row that holds no decision, or the row has no proposal, and counts them. The row "Changed an earlier decision" comes only when some of the rows were decided before the run and the decision changes their outcome or their note (a decided row may be decided again), and counts them; the table has five rows at most (Decided, Same as the agent, Different from the agent, Not compared with the agent and Changed an earlier decision). A decision may give only the tick, only Tag outcome, only the note, or Tag outcome and the note, and the read-back compares only what was written. The Next line only names a command, so no checklist follows. When a row does not read back, the sentence says how many did not ("were not written" when none of them was written at all), the table names each row by its Key and the column that differs ("not written" for a row that still holds what it held before, "not found" for one that is gone), and the Next line asks for `/claim-tagger decide` again with those rows (with "; ... is no longer in the Tag decisions table" added for a row that is gone, and the editor sent to Tag decisions only when every row that differs is gone). When Notion could not be read, the sentence says that the decisions were sent but could not be read back, and the Next line is `/claim-tagger decide check`.

Decide: 6 rows decided and read back; 2 differ from the agent.

| What | Result |
|---|---|
| Decided | 6 |
| Same as the agent | 4 |
| Different from the agent | 2, both with a note |
| Changed an earlier decision | 1 |

Next: type /claim-tagger distill to read the decisions.

### add, all claims added

The editor gave three Geo links. The script read the claims from Geo, created three new rows in Claims with the Geo columns only (name, address, space, date, sources, whether Geo marks it factual, Geo's tags and topics) and read every row back, then looked once more that none of them is in Claims twice. Nothing is marked and nothing is tagged: the Next line sends the editor to the tag command and says where the new claims are (the table's own address, where All claims is the first view). The sentence names at most three of the claims (cut like the other reports); with one claim added the Next line says "the new claim" and "it is in All claims". Over three, the sentence ends the list with "and more". The Next line only names a command, so no checklist follows.

Add: 3 claims added to Claims from Geo ("The mayor said the budget grew by half.", "Rents in the city rose faster than wa..." and "The bill was passed by a large majority.").

| What | Result |
|---|---|
| Added | 3 |

Next: type /claim-tagger tag to read the 3 new claims; they are in All claims (link).

### add, some claims refused

Seven items: one claim was added and six were not. The table has a row for each kind of reason that is present, in this order: Added (the count), Already in Claims, Not found in Geo, Not a claim, Not in the six spaces of Claims, Same text as a claim in Claims, Not a Geo link or ID, No name in Geo, A source links to a protected Notion page. Every row but Added names its items, at most three and then "and n more": the claim's text when Geo or Claims has it, else "link ending" (when the editor gave a link) or "ID ending" (when the editor gave the ID) and the last eight characters of its Geo ID. An item that is not a link or ID is echoed as it was typed, cut at 40 characters, only when it is harmless text (no brace, bracket, angle bracket or quote mark, no folder or script name, drive path or run id); otherwise it is named "an item that is not a link". The same-text row names the claim that is there already (or, for a claim earlier in the same list, says "earlier in your list"). With more than five kinds the table would be too long: the first four kinds present in the fixed order Added, Already in Claims, Same text as a claim in Claims, Not found in Geo, Not a claim, Not in the six spaces of Claims, Not a Geo link or ID, No name in Geo, A source links to a protected Notion page keep their row (in the order above), and the rest are one row, "Other reasons", which names its kinds (here the item that is not a claim, the one in a space Claims does not use and the one that is not a Geo link or ID). The Geo IDs, the reason for each item, the existing claims and the page ids are in the run record, not in the report.

Add: 1 claim added to Claims from Geo ("The new tax will cost families about..."); 6 were not added.

| What | Result |
|---|---|
| Added | 1 |
| Already in Claims | 1: "The senator voted against it twice." |
| Not found in Geo | 1: ID ending 0000000e |
| Same text as a claim in Claims | 1: "The senator voted against it twice." is there already |
| Other reasons | 3: 1 not a claim, 1 not in the spaces of Claims, 1 not a Geo link or ID |

Next: type /claim-tagger tag to read the new claim; it is in All claims (link).

### add, nothing added

Nothing was written, and the run ends with exit 2. When every claim was in Claims already, the sentence names them (up to three) and the Next line depends on the claims: when one of them has no Agent status (the agent has not read it), it is "type /claim-tagger tag to read them." (here the Agent status of both is empty); when the agent has read all of them, it says there is nothing new to read and where they are.

Add: nothing was added; both claims are already in Claims ("The senator voted against it twice." and "Rents rose.").

| What | Result |
|---|---|
| Already in Claims | 2: "The senator voted against it twice." and "Rents rose." |

Next: type /claim-tagger tag to read them.

Add: nothing was added; both claims are already in Claims ("The senator voted against it twice." and "Rents rose.").

| What | Result |
|---|---|
| Already in Claims | 2: "The senator voted against it twice." and "Rents rose." |

Next: nothing new to read; they are in All claims (link).

When some claims were refused instead, the sentence says why and the table names each item:

Add: nothing was added to Claims: 1 not found in Geo, 1 not a claim and 1 not a Geo link or ID.

| What | Result |
|---|---|
| Not found in Geo | 1: ID ending 0000000e |
| Not a claim | 1: "A person" |
| Not a Geo link or ID | 1: "nonsense" |

Next: check the links and type /claim-tagger add again.

### add, from a selection file

`/claim-tagger import` ends with `add.mjs --claims-file <selection file>` (decision P38). One command takes any number of claims; the report has the same sentence, table and Next line as for links. A stop says to run the same file again, not to type links:

Next: run the same selection file again; the ones added are skipped.

### add, stopped

Every stop that can be put right by typing the command again says to give the same links again: typed without them the command gives nothing useful. When Geo or Notion could not be read, nothing was written:

Add: nothing was added, because Geo could not be read.

Next: type /claim-tagger add again with the same links in a while.

When a write stopped part way, the sentence says how many claims were written and read back (here 2 of 5); the ones added are then "already in Claims" and are skipped:

Add: 2 of 5 claims were added before it stopped.

Next: type /claim-tagger add again with the same links; the ones added are skipped.

A claim whose write answered an error may have landed all the same, and a claim that was written may not have been read back; they are told apart from the ones that were read back:

Add: 1 of 3 claims was added and 1 more may have been, before it stopped.

Next: type /claim-tagger add again with the same links; the ones added are skipped.

When none was read back:

Add: none was confirmed and 2 may have been added, before it stopped.

Next: type /claim-tagger add again with the same links; the ones added are skipped.

When no claim was written or may have been, the sentence is "Add: it stopped before any claim was added." and the Next line is "type /claim-tagger add again with the same links in a while."

### add, a claim found twice

Two editors added the same claim at the same moment, and Claims now holds it twice. The run that made its row finds it after the read-back and says so (exit 2). No script removes a row: the engineer removes the row the run record names (the two rows are identical), and every command stops on the repeated key until then. Both page ids and the one to remove are in the run record.

Add: "The mayor said the budget grew by half." is in Claims twice now, because the same claim was added from two places at the same moment.

Next: ask the engineer to remove the row named in the run record (the two rows are identical); every command stops until then.

### A stopped run

Distill stopped: your Claude allowance ran out; nothing was written to Notion.

Next: when your Claude allowance is back, type /claim-tagger distill again; it continues where it stopped.
