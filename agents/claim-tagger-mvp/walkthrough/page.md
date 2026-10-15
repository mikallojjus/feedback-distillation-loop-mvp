Callout: You type four commands yourself (status, tag, distill and promote); the follow-up runs by itself after a PASS, and the engineer sets things up and fixes what breaks.
A practice copy of the editor feedback loop: its own rulebook (one tag), 7 real claims, its own queue. Nothing here changes the real tables or Geo. Do the steps in order; you can stop after any step and come back. Commands go into Claude Code, opened in the geo-agents folder. Commands act on the newest practice page under Demos; if one was made after yours, ask the engineer before you continue.

Rule 3 of Context-dependent says that a descriptive definite which names a kind of thing but not which one ("the Bitcoin ETF", "the new model") makes the claim Context-dependent: the reader must already know which one is meant. Editors read it with two gaps: a group every reader knows by its standing role, such as the press pool, is identified, and a capitalised phrase that names no body readers know, such as the AI Force, is not.

| Claim | Rule 3, read strictly | The editor |
|---|---|---|
| The press pool was justified in suspending coverage… | Tag: which press pool? | No tag: everyone knows it |
| The AI Force should enforce binding safety standards | Can't tell: a name, or a kind? | Tag: which body is that? |
| Excluding CNN from Air Force One violates the federal court… | Tag: which order? | Tag: 'Which court order?' |

The first two wait for you: you decide them, the agent drafts a clearer rule 3, you approve it, and a safety check makes sure the earlier decisions still come out right before the new rule is used.

The press pool row was picked for the demo; for real, a row appears only when the agent is unsure, as the AI Force row does.

## Step 1 · Meet the demo

**Goal of the step.** Check that the demo is set up and see what waits for whom.

**Existing status.** Rulebook: 1 tag, Context-dependent, edition {{edition}} (an edition is a date plus a count; it goes up when a rule changes). Claims: 7 rows, Agent tags empty. Tag decisions: 7 rows; 5 decided earlier by an editor, 2 waiting for you. Rule changes: empty. Nothing is paused.

**Doing the work.** In Claude Code, type `/claim-tagger demo status`.

**Explaining the outputs.** No table changes. Claude replies with one sentence, this table and a "Next:" line:

| Where | Now |
|---|---|
| Rulebook | 1 tag, edition {{edition}} |
| Your queue | 2 rows, lowest confidence first |
| Lessons waiting | none |
| Last run | none yet |

The sentence starts with "Demo · " and names this practice page, as every report in the demo does. Its Next line points at step 2, because the agent has not read the claims yet.

## Step 2 · The agent reads the claims

**Goal of the step.** The agent reads the 7 claims against the rulebook and fills its side of your 2 rows.

**Existing status.** Your 2 rows have no Agent proposal yet; Agent tags is empty on all 7 claims (step 1).

**Doing the work.** Type `/claim-tagger demo tag`. It is a short wait; Notion changes only at the end.

**Explaining the outputs.**

**Tag decisions** (your 2 rows; the 5 earlier rows are not touched)

| Claim | Agent proposal | Agent confidence | Agent reason |
|---|---|---|---|
| The press pool was justified in suspending coverage… | Applies | 0.80 | "the press pool": which one? · Context-dependent rule 3 · 3 of 3 runs agree |
| The AI Force should enforce binding safety standards | Can't tell | 0.50 | "The AI Force": a name, or a kind of body? · Context-dependent rule 3 · 2 of 3 runs agree |

Both rows cite rule 3, the rule on descriptive definites: the agent is fairly sure about the press pool and unsure about the AI Force (Can't tell, or Does not apply at low confidence; the table shows one reading). Both rows also record the rulebook edition they used (Rulebook edition {{edition}}). The press pool row waits for you although the agent is fairly sure, because it was picked for the demo; the AI Force row waits because the agent is unsure, as a row does for real.

**Claims** (Agent notes is two short lines per claim; the table shows the line break as a slash)

| Geo Name | Agent tags | Agent notes |
|---|---|---|
| The press pool was justified in suspending coverage… | (empty) | no tags / 1 waits for an editor · edition {{edition}} |
| The AI Force should enforce binding safety standards | (empty) | no tags / 1 waits for an editor · edition {{edition}} |
| Excluding CNN from Air Force One violates the federal court… | Context-dependent | Context-dependent / nothing waits for an editor · edition {{edition}} |
| The Dallas convention is the unofficial launch of JD Vance’s… | Context-dependent | Context-dependent / nothing waits for an editor · edition {{edition}} |
| A contractor's enforcement of safety restrictions constitutes… | (empty) | no tags / nothing waits for an editor · edition {{edition}} |
| Relocating the Kennedy Center Honors to a sports arena… | (empty) | no tags / nothing waits for an editor · edition {{edition}} |
| December stopgap funding rewards Congress for avoiding a… | (empty) | no tags / nothing waits for an editor · edition {{edition}} |

The agent agrees with all 5 earlier decisions; their rows are not touched, so their Agent proposal still shows what the agent said before the audit of 9 October. On your 2 rows the agent follows rule 3, but a tag that waits for you is not written to Agent tags yet; it is counted in Agent notes and sits in Your queue. Confidence, rule and reason are in the Tag decisions rows above, not in Agent notes.

## Step 3 · Decide your two rows (you, as the editor)

**Goal of the step.** Record your decision on both rows, and say that rule 3, not the agent, is the problem.

**Existing status.** The press pool row shows Applies and the AI Force row Can't tell or Does not apply at low confidence, both citing rule 3 (step 2).

**Doing the work.** In Your queue, just below, fill in three columns on each row. Press pool row: Tag outcome Does not apply, Why wrong Rule unclear, Your reasoning "Rule 3 does not say that a group every reader knows by its standing role, such as the press pool, counts as identified; it does: the claim reads well." AI Force row: Tag outcome Applies, Why wrong Rule unclear, Your reasoning "Rule 3 does not say that a capitalised phrase which names no body readers know, such as the AI Force, is still a kind of thing and not which one; it is: the claim needs context." What each Why wrong value makes happen is explained in Help at the bottom of the page.

{{view:Your queue}}

**Explaining the outputs.**

**Tag decisions** (your 2 rows)

| Claim | Tag outcome | Why wrong | Your reasoning |
|---|---|---|---|
| The press pool was justified in suspending coverage… | Does not apply | Rule unclear | Rule 3 does not say that a group every reader knows by its role counts as identified; it does. |
| The AI Force should enforce binding safety standards | Applies | Rule unclear | Rule 3 does not say that a name-like phrase for an unknown body is still a kind, not which; it is. |

The agent is not involved and no other table changes. Both rows leave Your queue when the page reloads; they stay in Tag decisions at the bottom.

## Step 4 · The agent drafts a clearer rule 3

**Goal of the step.** Turn your two notes into one proposed rewording of rule 3.

**Existing status.** Rule changes is empty; your 2 rows carry Rule unclear and a sentence that names rule 3 (step 3).

**Doing the work.** Type `/claim-tagger demo distill`. It is a short wait.

**Explaining the outputs.**

**Rule changes**

| Lesson | Rule | Status | Supporting rows |
|---|---|---|---|
| Known groups count as identified, unknown names do not | Context-dependent rule 3 | Proposed | The press pool was justified in suspending coverage… · 5c9d133e…::Context-dependent |

Current text holds today's rule 3. Proposed text keeps it and adds what your two notes say, for example: "A group readers know by its standing role, such as a press corps, counts as identified; a capitalised phrase that names no body readers know does not." Supporting rows lists the two rows the draft rests on, one line each (the table shows the first). Each Supporting rows line ends with the row's key, the claim's id and the tag; you can skip it.

The Rulebook does not change: a draft changes nothing until you approve it and it passes the safety check.

## Step 5 · Approve the draft (you, as the rule owner)

**Goal of the step.** Decide whether the draft may be tested; approving does not change the rule yet.

**Existing status.** The draft from step 4 is Proposed.

**Doing the work.** In Lessons waiting, just below, read Current text and Proposed text side by side; the cells wrap, so you read both in place. If the draft says what you meant, set Status to Approved right there. If not, open the row, write all of rule 3 as you want it in Editor wording, then set Status to Approved; your wording is tested instead of the draft.

{{view:Lessons waiting}}

**Explaining the outputs.**

**Rule changes**

| Lesson | Editor wording | Status |
|---|---|---|
| Known groups count as identified, unknown names do not | (empty: the draft is tested) | Approved |

## Step 6 · The safety check

**Goal of the step.** Test the approved rule 3 against everything already decided, and switch to it only if nothing breaks.

**Existing status.** The Rulebook still has today's rule 3; the change is Approved (step 5).

**Doing the work.** Type `/claim-tagger demo promote`. This is the longest wait of the seven steps: the agent reads the 10 example claims, the 5 earlier decisions and your 2 rows, once with each version of rule 3, and twice more any claim whose answer differs between the two versions. When the check passes, the same command re-checks your two rows (step 7).

**Explaining the outputs.** When the check passes, Claude's report says PASS in its sentence, its table counts what came out right (the example claims, the earlier decisions and your rows), and its Next line points at step 7. These tables change:

**Rulebook**

| Name | When to use, rule 3 |
|---|---|
| Context-dependent | Today's rule, plus: "a group known by its role is identified; an unknown name-like phrase is not." |

**Rule changes**

| Lesson | Status | Safety check result |
|---|---|---|
| Known groups count as identified, unknown names do not | Live | PASS: examples 10/10, earlier 5/5, yours 2/2 |

**Agent settings**

| Name | Rulebook edition | Last run summary |
|---|---|---|
| Claim tagger | the next edition | Promote · {{date}} 11:20 · PASS |

Your 2 rows are now earlier decisions: every future safety check tests a new rule against them.

**If it does not pass.** Rule changes shows Status Approved and a Safety check result such as "FAIL: 'Excluding CNN from Air Force One violates the federal court…' now Does not apply". The Rulebook is unchanged. Claude's report says FAIL in its sentence and quotes that claim; its Next line hands you the whole text for Editor wording: the rule as it was tested, with a sentence written from that claim added at the end. For example, the added sentence reads: "A definite that names one particular order, case or document the claim does not identify still makes the claim Context-dependent."

1. Open the change in Lessons waiting. Editor wording must hold all of rule 3: put the whole text the report gives you into it (the rule as it was tested, with the added sentence at the end), or write all of rule 3 as you want it. Edit the added sentence if it does not say what you mean. You may also reject the change.
2. Type `/claim-tagger demo promote` again.
3. If it fails again, set Status to Rejected. The rule stays as it was, the demo ends here, and the safety check has done its job.

The same three steps apply when the check names one of your own rows instead of an example claim: the Safety check result then reads like "FAIL: 'The press pool was justified in suspending coverage…' now Applies", and the report proposes a sentence for that row in the same way.

## Step 7 · The agent re-checks your rows

**Goal of the step.** Confirm that the agent now agrees with your two decisions.

**Existing status.** You decided both rows in step 3 and the new rule 3 went live in step 6; in step 2 the agent had answered Applies on the press pool row and Can't tell (or Does not apply at low confidence) on the AI Force row, which were its proposals and not yet tags on the claims.

**Doing the work.** Nothing to type: the follow-up ran by itself at the end of the safety check. It takes the answers the check already gave for your two rows under the new rule 3, so there was nothing more to wait for. Open Tag decisions at the bottom of the page and the Claims table.

**Explaining the outputs.**

**Tag decisions** (your 2 rows)

| Claim | Tag outcome | Follow-up |
|---|---|---|
| The press pool was justified in suspending coverage… | Does not apply | Fixed |
| The AI Force should enforce binding safety standards | Applies | Fixed |

**Claims** (your 2 claims)

| Geo Name | Agent tags | Agent notes |
|---|---|---|
| The press pool was justified in suspending coverage… | (empty) | no tags / nothing waits for an editor · the next edition |
| The AI Force should enforce binding safety standards | Context-dependent | Context-dependent / nothing waits for an editor · the next edition |

Agent notes now names the next edition, the one the safety check put in force, and the AI Force claim carries the tag you decided. Your queue no longer lists your two rows. They stay in Tag decisions at the bottom of the page, where Agent proposal still shows what the agent said in step 2 and Follow-up shows what it says now. That is one full cycle: your two notes became a clearer rule 3, it was tested against every earlier decision before it went live, and your two rows are earlier decisions now, checked by every future safety check.

**What the full version adds later:**

- All 13 tags are judged, not only Context-dependent.
- Duplicates are found by searching all claims.
- Each editor gets a queue of their own when more editors join.

Archive this page by hand when you no longer need it.

## The tables

- **Rulebook**: one row per tag (here one). The agent changes When to use only after a passed safety check. Do not edit When to use by hand: every command then stops until the text is put back.
- **Claims**: one row per claim, shaped like the real claims table. The agent writes only Agent tags and Agent notes.
- **Tag decisions**: one row per claim and tag that a person decides. You type in Tag outcome, Why wrong and Your reasoning; the agent fills the rest. Needs your note lists the rows where you chose a reason but left Your reasoning empty.
- **Rule changes**: one row per proposed rule change. You set Status and may write Editor wording.
- **Agent settings**: one row. Tick Paused to stop the agent; Last run summary always describes the latest command.
- Hover over a column name to see what it means.

{{tables}}

{{help}}

## Help

**What to choose in Why wrong.**

| Why wrong | What it makes happen |
|---|---|
| Agent slip | The rule is fine, the agent misread it: no rule change; the row still counts as an earlier decision. |
| Rule unclear | The rule does not settle this claim: the agent drafts a clearer rule from your note. |
| Rule should change | The rule settles it, but wrongly: the agent drafts a changed rule from your note. |
| (empty) | The agent was right, or no reason given: no rule change; the row counts as an earlier decision. |

**Words used on this page.**

- **Rulebook**: the numbered rules for each tag, kept in When to use; it changes only after a passed safety check.
- **Edition**: the rulebook's version, a date plus a count ({{edition}}); it goes up when a rule changes.
- **Safety check**: the test a rule change must pass before it is used: example claims, earlier decisions and your rows must all come out right; its result, PASS or FAIL, is written in Safety check result.
- **Earlier decision**: a claim an editor already decided (here the 5 from the audit of 9 October, when editors checked the agent's tags on real claims); the agent must keep getting it right.
- **Example claim**: one of the tag's 6 examples in the Rulebook, or one of 4 examples of its opposite tag, Self-contained, which the agent keeps in its own files (they are not on this page); it must always come out right.
- **Agent proposal**: the agent's answer for one claim and one tag: Applies, Does not apply or Can't tell.
- **Tag outcome**: your decision on a row; it always wins over the agent's answer.
- **Why wrong**: your reason the agent was wrong; the table above says what each value makes happen.
- **Follow-up**: after a PASS, the agent re-checks the rows the change rests on and marks each Fixed or Still wrong.
- **Queue**: the Tag decisions table. Your queue shows its rows that wait for you; Needs your note the ones where you chose a reason but wrote no note. Lessons waiting shows the Rule changes not yet decided.

**If something stops.**

- Claude says "paused": untick Paused in Agent settings (the last table on this page), then type the command again.
- Claude says your Claude allowance ran out: wait until your Claude allowance is back, then type the same command again; it continues where it stopped.
- Claude says the rulebook text was edited by hand: put When to use back as it was (the report links the Rulebook), or ask the engineer; then type the command again. Anything else: send the engineer the whole report.
