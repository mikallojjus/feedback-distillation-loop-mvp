Callout: You type four commands yourself (status, tag, distill and promote); the follow-up runs by itself after a PASS, and the engineer sets things up and fixes what breaks.
A practice copy of the editor feedback loop: its own rulebook (one tag), 7 real claims, its own queue. Nothing here changes the real tables or Geo. Do the steps in order; you can stop after any step and come back. Commands go into Claude Code, opened in the geo-agents folder.

Rule 4 of Context-dependent asks: could a reader who sees only this sentence say which specific thing each "the ..." points at? If not, the claim gets the tag. Editors read more loosely: a claim that reads well on its own does not need the tag, even when it says "the larger public health problem".

| Claim | Rule 4's test | The editor |
|---|---|---|
| The focus on the COVID-19 vaccine ignored the larger... | Tag: which problem? | No tag: a general remark |
| Georgia's gubernatorial debate should be moderated... | Tag: which debate? | No tag: reads well |
| Excluding CNN from Air Force One violates the federal... | Tag: which court order? | Tag: "Which order?" |

The first two wait for you: you decide them, the agent drafts a clearer rule 4, you approve it, and a safety check makes sure the earlier decisions still come out right before the new rule is used.

These two were picked for the demo; for real, a row appears only when the agent is unsure.

## Step 1 · Meet the demo

- **Goal of the step.** Check that the demo is ready and see what waits for whom.
- **Existing status.** Rulebook: 1 tag, Context-dependent, edition {{edition}} (an edition is a date plus a count; it goes up when a rule changes). Claims: 7 rows, Agent tags empty. Tag decisions: 7 rows; 5 decided earlier by an editor, 2 waiting for you. Rule changes: empty. Agent settings: not paused.
- **Doing the work.** In Claude Code, type `/claim-tagger demo status`.
- **Explaining the outputs.** No table changes. Claude replies with one sentence, this table and a "Next:" line:

| What | Now |
|---|---|
| Rulebook | edition {{edition}}, 1 tag |
| Waiting for you | 2 rows in Your queue |
| Rule changes | none |
| Paused | no |

## Step 2 · The agent reads the claims

- **Goal of the step.** The agent reads the 7 claims against the rulebook and fills its side of your 2 rows.
- **Existing status.** Your 2 rows have no Agent proposal yet; Agent tags is empty on all 7 claims (step 1).
- **Doing the work.** Type `/claim-tagger demo tag`. It is a short wait; Notion changes only at the end.
- **Explaining the outputs.**

**Tag decisions** (your 2 rows; the 5 earlier rows are not touched)

| Claim | Agent proposal | Agent confidence | Agent reason |
|---|---|---|---|
| The focus on the COVID-19 vaccine ignored the larger public... | Applies | 0.85 | "the larger public health problem": which one? (rule 4) |
| Georgia's gubernatorial debate should be moderated by... | Applies | 0.80 | "Georgia's gubernatorial debate": which debate? (rule 4) |

Both rows also record the rulebook edition they used (Rulebook edition {{edition}}). They wait for you although the agent is fairly sure: they were picked for the demo.

**Claims** (Agent notes is two short lines per claim; the table shows the line break as a slash)

| Geo Name | Agent tags | Agent notes |
|---|---|---|
| The focus on the COVID-19 vaccine ignored the larger public... | (empty) | no tags / 1 waits for an editor · edition {{edition}} |
| Excluding CNN from Air Force One violates the federal court... | Context-dependent | Context-dependent / nothing waits for an editor · edition {{edition}} |

The agent agrees with the earlier decisions. On your 2 rows it follows rule 4, but a tag that waits for you is not written to Agent tags yet; it is counted in Agent notes and sits in Your queue.

## Step 3 · Decide your two rows (you, as the editor)

- **Goal of the step.** Record your decision on both rows, and say that rule 4, not the agent, is the problem.
- **Existing status.** Both rows show Applies, citing rule 4 (step 2).
- **Doing the work.** In Your queue, just below, fill in three columns on each row. Tag outcome: Does not apply. Why wrong: Rule unclear. Your reasoning, on the COVID-19 row: "Rule 4 is too strict: 'the larger public health problem' is general; the claim reads fine." On the Georgia row: "Rule 4 is too strict: the claim reads well without a date or names for the debate." What each Why wrong value makes happen is explained in Help at the bottom of the page.

{{view:Your queue}}

- **Explaining the outputs.**

**Tag decisions** (your 2 rows)

| Claim | Tag outcome | Why wrong | Your reasoning |
|---|---|---|---|
| The focus on the COVID-19 vaccine ignored the larger public... | Does not apply | Rule unclear | Rule 4 is too strict: "the larger public health problem" is general; the claim reads fine. |
| Georgia's gubernatorial debate should be moderated by... | Does not apply | Rule unclear | Rule 4 is too strict: the claim reads well without a date or names for the debate. |

The agent is not involved and no other table changes. Both rows leave Your queue when the page reloads; they stay in Tag decisions at the bottom.

## Step 4 · The agent drafts a clearer rule 4

- **Goal of the step.** Turn your two notes into one proposed rewording of rule 4.
- **Existing status.** Rule changes is empty; your 2 rows carry Rule unclear and a sentence that names rule 4 (step 3).
- **Doing the work.** Type `/claim-tagger demo distill`. It is a short wait.
- **Explaining the outputs.**

**Rule changes**

| Lesson | Rule | Status | Supporting rows |
|---|---|---|---|
| General references pass the rule 4 test | Context-dependent rule 4 | Proposed | The focus on the COVID-19 vaccine...; Georgia's gubernatorial debate... |

Current text holds today's rule 4. Proposed text keeps it and adds one sentence, for example: "A general reference that any reader understands, such as 'the larger public health problem', passes the test." Supporting rows lists the two rows the draft rests on.

The Rulebook does not change: a draft changes nothing until you approve it and it passes the safety check.

## Step 5 · Approve the draft (you, as the rule owner)

- **Goal of the step.** Decide whether the draft may be tested; approving does not change the rule yet.
- **Existing status.** The draft from step 4 is Proposed.
- **Doing the work.** In Lessons waiting, just below, read Current text and Proposed text side by side; the cells wrap, so you read both in place. If the draft says what you meant, set Status to Approved right there. If not, open the row and write your own rule 4 in Editor wording first; your wording is then tested instead of the draft.

{{view:Lessons waiting}}

- **Explaining the outputs.**

**Rule changes**

| Lesson | Editor wording | Status |
|---|---|---|
| General references pass the rule 4 test | (empty: the draft is tested) | Approved |

## Step 6 · The safety check

- **Goal of the step.** Test the approved rule 4 against everything already decided, and switch to it only if nothing breaks.
- **Existing status.** The Rulebook still has today's rule 4; the change is Approved (step 5).
- **Doing the work.** Type `/claim-tagger demo promote`. This is the longest wait of the seven steps: the agent reads the 11 example claims, the 5 earlier decisions and your 2 rows, once with each version of rule 4. When the check passes, the same command re-checks your two rows (step 7).
- **Explaining the outputs (PASS).**

**Rulebook**

| Name | When to use, rule 4 |
|---|---|
| Context-dependent | Today's test, plus: "A general reference that any reader understands ... passes the test." |

**Rule changes**

| Lesson | Status | Safety check result |
|---|---|---|
| General references pass the rule 4 test | Live | PASS: examples 11/11, earlier 5/5, yours 2/2 |

**Agent settings**

| Name | Rulebook edition | Last run summary |
|---|---|---|
| claim-tagger | {{next_edition}} | Promote · {{date}} · PASS |

Your 2 rows are now earlier decisions: every future safety check tests a new rule against them.

**If it does not pass.** Rule changes shows Status Approved and a Safety check result such as "FAIL: 'Excluding CNN from Air Force One...' now Does not apply". The Rulebook is unchanged. The report names that claim, quotes it, and hands you one sentence for Editor wording, written from it. 1. Open the change in Lessons waiting and paste the sentence into Editor wording, or write your own. 2. Type `/claim-tagger demo promote` again. 3. If it fails again, set Status to Rejected: the rule stays as it was and the demo ends here.

## Step 7 · The agent re-checks your rows

- **Goal of the step.** Confirm that the agent now agrees with your two decisions.
- **Existing status.** You decided both rows in step 3 and the new rule 4 went live in step 6; in step 2 the agent had answered Applies on both rows, which was its proposal and not yet a tag on the claims.
- **Doing the work.** Nothing to type: the follow-up ran by itself at the end of the safety check, re-reading your two rows with the new rule 4. Open Tag decisions at the bottom of the page and the Claims table.
- **Explaining the outputs.**

**Tag decisions** (your 2 rows)

| Claim | Tag outcome | Follow-up |
|---|---|---|
| The focus on the COVID-19 vaccine ignored the larger public... | Does not apply | Fixed |
| Georgia's gubernatorial debate should be moderated by... | Does not apply | Fixed |

**Claims**

| Geo Name | Agent tags | Agent notes |
|---|---|---|
| The focus on the COVID-19 vaccine ignored the larger public... | (empty) | no tags / nothing waits for an editor · edition {{next_edition}} |
| Georgia's gubernatorial debate should be moderated by... | (empty) | no tags / nothing waits for an editor · edition {{next_edition}} |

That is one full cycle: your two notes became a clearer rule 4, it was tested against every earlier decision before it went live, and your two rows are earlier decisions now.

What the full version adds later:

- All 13 tags are judged, not only Context-dependent.
- Duplicates are found by searching all claims, not only by matching exact text.
- Each editor gets a queue of their own if a second editor joins.

Archive this page by hand when you no longer need it.

## The tables

- **Rulebook**: one row per tag (here one). The agent changes When to use only after a passed safety check.
- **Claims**: one row per claim, shaped like the real claims table. The agent writes only Agent tags and Agent notes.
- **Tag decisions**: one row per claim and tag that a person decides. You type in Tag outcome, Why wrong and Your reasoning; the agent fills the rest.
- **Rule changes**: one row per proposed rule change. You set Status and may write Editor wording.
- **Agent settings**: one row. Tick Paused to stop the agent; Last run summary always describes the latest command.
- Hover over a column name to see what it means.

{{tables}}

## Help

**What the agent's reading makes happen.**

| Agent reading | What it makes happen |
|---|---|
| Agent slip | The rule is fine, the agent misread it: no rule change; the claim counts as an earlier decision. |
| Rule unclear | The rule does not settle this claim: the agent drafts a clearer rule from your note. |
| Rule should change | The rule settles it, but against you: the agent drafts a changed rule from your note. |
| (nothing to read) | You agreed with the agent: no rule change; the claim counts as an earlier decision. |

**Words used on this page.**

- **Claim**: one short statement in Geo.
- **Tag**: a label for one kind of problem a claim can have.
- **Rulebook**: the numbered rules for each tag; it changes only after a safety check.
- **Edition**: the rulebook's version, a date plus a count ({{edition}}); it goes up when a rule changes.
- **Your queue**: the rows the agent wants a person to decide.
- **Earlier decision**: a claim an editor already decided; the agent must keep getting it right.
- **Example claim**: an example printed in the rulebook; it must always come out right.
- **Rule change**: a proposed new wording for one rule.
- **Rule owner**: the person who approves or rejects rule changes; on this page, you.
- **Safety check**: the test of the old rule against the new one before the new one is used; it ends with a re-check of your rows.

**If something stops.**

- Claude says "paused": untick Paused in Agent settings (the last table on this page), then type the command again.
- Claude says your Claude allowance ran out: wait until your Claude allowance is back, then type the same command again; it continues where it stopped.
- Claude says some answers could not be read: type the same command again; it continues where it stopped. If it stops the same way twice, send the engineer the whole report.
- Claude says the rulebook text was edited by hand: put When to use back as it was (the report links the Rulebook), or ask the engineer; then type the command again. Anything else: send the engineer the whole report.
