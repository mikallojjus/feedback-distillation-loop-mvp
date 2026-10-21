Callout: You type four commands yourself (status, tag, distill and promote); the follow-up runs by itself after a PASS, and the engineer sets things up and fixes what breaks.
A practice copy of the editor feedback loop: its own rulebook (one tag) and 7 real claims that you review in a Claims table like the real one. Nothing here changes the real tables or Geo. Do the steps in order; you can stop after any step and come back. Commands go into Claude Code, opened in the geo-agents folder. Commands act on the newest practice page under Demos; if one was made after yours, ask the engineer before you continue.

Rule 3 of Context-dependent says that a descriptive definite which names a kind of thing but not which one ("the Bitcoin ETF", "the new model") makes the claim Context-dependent: the reader must already know which one is meant. Editors read it with two gaps: a group every reader knows by its standing role, such as the press pool, is identified, and a capitalised phrase that names no body readers know, such as the AI Force, is not.

| Claim | Rule 3, read strictly | The editor |
|---|---|---|
| The press pool was justified in suspending coverage… | Tag: which press pool? | No tag: everyone knows it |
| The AI Force should enforce binding safety standards | Can't tell: a name, or a kind? | Tag: which body is that? |
| Excluding CNN from Air Force One violates the federal court… | Tag: which order? | Tag: 'Which court order?' |

The first two are yours: you decide them in Your queue, the agent drafts a clearer rule 3, you approve it, and a safety check makes sure the earlier decisions still come out right before the new rule is used.

The press pool claim was picked for the demo: the agent is fairly sure of it, but the page marks it To review, so its Agent status reads Waits for you and it sits in Your queue like the AI Force claim, which the agent reads differently from run to run and which the page also marks To review. For real, a claim waits when someone marks it To review or when the agent is unsure.

## Step 1 · Meet the demo

**Goal of the step.** Check that the demo is set up and see what waits for whom.

**Existing status.** Rulebook: 1 tag, Context-dependent, edition {{edition}} (an edition is a date plus a count; it goes up when a rule changes). Claims: 7 rows, Agent tags empty; 5 are Reviewed, decided earlier by an editor, and 2 are To review, for you. Rule changes: empty. Nothing is paused.

**Doing the work.** In Claude Code, type `/claim-tagger demo status`.

**Explaining the outputs.** No table changes. Claude replies with one sentence, this table and a "Next:" line:

| Where | Now |
|---|---|
| Rulebook | 1 tag, edition {{edition}} |
| Your queue | nothing waits |
| Lessons waiting | none |
| Last run | none yet |

The sentence starts with "Demo · " and names this practice page, as every report in the demo does, and says that nothing waits for you yet: Your queue lists a claim only once the agent has read it, and the agent has not read the claims yet. The Next line points at step 2.

## Step 2 · The agent reads the claims

**Goal of the step.** The agent reads the 7 claims against the rulebook and writes its seven columns on every claim, your 2 included.

**Existing status.** Your 2 claims, the press pool and the AI Force, are To review and the agent has written nothing on them; the agent's columns (Agent tags, Agent confidence, Agent reasons, Agent status, Tags waiting, Agent edition and Agent remarks) are empty on all 7 claims (step 1).

**Doing the work.** Type `/claim-tagger demo tag`. It is a short wait; Notion changes only at the end.

**Explaining the outputs.**

**Claims** (all 7)

| Geo Name | Agent tags | Agent confidence | Agent status |
|---|---|---|---|
| The press pool was justified in suspending coverage… | (empty) | 0.80 | Waits for you |
| The AI Force should enforce binding safety standards | (empty) | 0.50 | Waits for you |
| Excluding CNN from Air Force One violates the federal court… | Context-dependent | 0.75 or more | Done |
| The Dallas convention is the unofficial launch of JD Vance’s… | Context-dependent | 0.75 or more | Done |
| A contractor's enforcement of safety restrictions constitutes… | (empty) | 0.75 or more | Done |
| Relocating the Kennedy Center Honors to a sports arena… | (empty) | 0.75 or more | Done |
| December stopgap funding rewards Congress for avoiding a… | (empty) | 0.75 or more | Done |

Tags waiting names the tags that wait for you, and Agent reasons holds one line for each tag the agent judged: the tag, the reason, the rule it cites (when it cites one) and how many of its readings agree. For your 2 claims, as one run read them:

| Geo Name | Tags waiting | Agent reasons |
|---|---|---|
| The press pool was justified in suspending coverage… | Context-dependent | Context-dependent: "the press pool": which one? · Context-dependent rule 3 · 1 of 1 runs agree |
| The AI Force should enforce binding safety standards | Context-dependent | Context-dependent: "The AI Force": a name or a kind? · 2 of 2 runs agree |

A claim the agent is sure of is read once, so its line ends with a count of one; the agent reads a claim again only when it is unsure, and a third time only when the first two readings disagree. The figures differ from run to run, and the AI Force claim most of all: the agent may read it as Can't tell, as here, or answer with confidence either way, and then its line may cite a rule or none. Both claims are To review, so each waits for you whatever the agent reads: Agent tags stays empty on both, Agent status reads Waits for you and Tags waiting holds the tag. Both are now in Your queue, lowest confidence first. Agent confidence is the lowest confidence among the tags the agent judged on a claim. The agent agrees with all 5 earlier decisions: their Agent tags are the tags an editor confirmed, their Agent status is Done and their Tags waiting is empty. Agent edition holds {{edition}} on all 7 claims, and Agent remarks stays empty, because the rulebook has no tag that was left unchecked.

## Step 3 · Decide your two claims (you, as the editor)

**Goal of the step.** Record your decision on both claims, and say that rule 3, not the agent, is the problem.

**Existing status.** Both of your claims are To review and wait in Your queue (step 2): Agent status reads Waits for you on both, Tags waiting holds Context-dependent and Agent tags is empty.

**Doing the work.** Fill in four columns on each of your two claims, in the order of its list, in Your queue under the lists. The sentence for Challenged tags notes stands on its own line between quotes: paste the words between the quotes, not the quotes. Review status comes last only because it closes the claim: a claim you have decided stays in Your queue until the agent reads it again (the next tag run does that, and in this practice the follow-up in step 7 does it for these two), so the order of the four columns does not matter for the view. What each Why wrong value makes happen is explained in Help at the bottom of the page.

**The AI Force claim**

1. Verified tags: Context-dependent.
2. Why wrong: Rule unclear.
3. Challenged tags notes: paste the words between the quotes:\
   "Rule 3 does not say that a capitalised phrase which names no body readers know, such as the AI Force, is still a kind of thing and not which one; it is: the claim needs context."
4. Review status: Reviewed.

**The press pool claim**

1. Verified tags: leave it empty, because the tag does not apply.
2. Why wrong: Rule unclear.
3. Challenged tags notes: paste the words between the quotes:\
   "Rule 3 does not say that a group every reader knows by its standing role, such as the press pool, counts as identified; it does: the claim reads well."
4. Review status: Reviewed.

{{view:Your queue}}

**Explaining the outputs.**

**Claims** (your 2 claims)

| Geo Name | Verified tags | Review status | Why wrong |
|---|---|---|---|
| The press pool was justified in suspending coverage… | (empty) | Reviewed | Rule unclear |
| The AI Force should enforce binding safety standards | Context-dependent | Reviewed | Rule unclear |

Challenged tags notes holds your sentence on each claim. The agent is not involved and no other table changes: its seven columns still show what it wrote in step 2, so both claims stay in Your queue, with Agent status Waits for you, until the agent reads them again in step 7. Both claims are earlier decisions now.

## Step 4 · The agent drafts a clearer rule 3

**Goal of the step.** Turn your two notes into one proposed rewording of rule 3.

**Existing status.** Rule changes is empty; your 2 claims carry Rule unclear and a note that names rule 3 (step 3).

**Doing the work.** Type `/claim-tagger demo distill`. It is a short wait.

**Explaining the outputs.**

**Rule changes**

| Lesson | Rule | Status | Supporting rows |
|---|---|---|---|
| Known groups count as identified, unknown names do not | Context-dependent rule 3 | Proposed | The press pool was justified in suspending coverage… · 5c9d133e…::Context-dependent |

Current text holds today's rule 3. Proposed text keeps it and adds what your two notes say, for example: "A group readers know by its standing role, such as a press corps, counts as identified; a capitalised phrase that names no body readers know does not." Supporting rows lists the two claims the draft rests on, one line each (the table shows the first). Each Supporting rows line ends with the claim's id and the tag; you can skip it.

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

**Doing the work.** Type `/claim-tagger demo promote`. This is the longest wait of the seven steps: the agent reads the 10 example claims, the 5 earlier decisions and your 2 claims, once with each version of rule 3, and twice more any claim whose answer differs between the two versions. When the check passes, the same command re-checks your two claims (step 7).

**Explaining the outputs.** When the check passes, Claude's report says PASS in its sentence, its table counts what came out right (the example claims, the earlier decisions and your claims), and its Next line points at step 7. These tables change:

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

Your 2 claims are now earlier decisions: every future safety check tests a new rule against them.

**If it does not pass.** Rule changes shows Status Approved and a Safety check result such as "FAIL: 'Excluding CNN from Air Force One violates the federal court…' now Does not apply". The Rulebook is unchanged. Claude's report says FAIL in its sentence and quotes that claim; its Next line hands you the whole text for Editor wording: the rule as it was tested, with a sentence written from that claim added at the end. For example, the added sentence reads: "A definite that names one particular order, case or document the claim does not identify still makes the claim Context-dependent."

1. Open the change in Lessons waiting. Editor wording must hold all of rule 3: put the whole text the report gives you into it (the rule as it was tested, with the added sentence at the end), or write all of rule 3 as you want it. Edit the added sentence if it does not say what you mean. You may also reject the change.
2. Type `/claim-tagger demo promote` again.
3. If it fails again, set Status to Rejected. The rule stays as it was, the demo ends here, and the safety check has done its job.

The same three steps apply when the check names one of your own claims instead of an example claim: the Safety check result then reads like "FAIL: 'The press pool was justified in suspending coverage…' now Applies", and the report proposes a sentence for that claim in the same way.

## Step 7 · The agent re-checks your claims

**Goal of the step.** Confirm that the agent now agrees with your two decisions.

**Existing status.** You decided both claims in step 3 and the new rule 3 went live in step 6; in step 2 both claims waited for you, so the agent had written no tag on either, and both still read Waits for you in Agent status.

**Doing the work.** Nothing to type: the follow-up ran by itself at the end of the safety check. It takes the answers the check already gave for your two claims under the new rule 3, so there was nothing more to wait for. Open the Claims table in The tables just below.

**Explaining the outputs.**

**Claims** (your 2 claims)

| Geo Name | Agent tags | Agent status | Agent edition |
|---|---|---|---|
| The press pool was justified in suspending coverage… | (empty) | Done | the next edition |
| The AI Force should enforce binding safety standards | Context-dependent | Done | the next edition |

Agent tags now holds the tags you decided: the AI Force claim carries the tag and the press pool claim does not. Agent status reads Done on both, so both have left Your queue; neither claim says Disagrees with your decision, and a claim that did would show up in Agent disagreed and would need a clearer rule. Agent edition names the next edition, the one the safety check put in force, and Agent confidence follows the new reading. Only your two claims name the new edition: the 5 earlier decisions keep theirs until the next tag run. That is one full cycle: your two notes became a clearer rule 3, it was tested against every earlier decision before it went live, and your two claims are earlier decisions now, checked by every future safety check.

**What the full version adds later:**

- All 13 tags are judged, not only Context-dependent.
- Duplicates are found by searching all claims.
- Each editor gets a queue of their own when more editors join.

Archive this page by hand when you no longer need it.

## The tables

- **Rulebook**: one row per tag (here one). The agent changes When to use only after a passed safety check. Do not edit When to use by hand: every command then stops until the text is put back.
- **Claims**: one row per claim, shaped like the real claims table. The agent writes Agent tags, Agent confidence, Agent reasons, Agent status, Tags waiting, Agent edition and Agent remarks; you write Verified tags, Review status, Why wrong and Challenged tags notes.
- **Tag decisions**: the agent's own record of each decision; nothing to do here.
- **Rule changes**: one row per proposed rule change. You set Status and may write Editor wording.
- **Agent settings**: one row. Tick Paused to stop the agent; Last run summary always describes the latest command.
- Hover over a column name to see what it means.

{{tables}}

{{help}}

## Help

**What to choose in Why wrong.**

| Why wrong | What it makes happen |
|---|---|
| Agent slip | The rule is fine, the agent misread it: no rule change; the claim counts as an earlier decision. |
| Rule unclear | The rule does not settle this claim: the agent drafts a clearer rule from your note. |
| Rule should change | The rule settles it, but wrongly: the agent drafts a changed rule from your note. |
| (empty) | The agent was right, or no reason given: no rule change; the claim counts as an earlier decision. |

**Words used on this page.**

- **Rulebook**: the numbered rules for each tag, kept in When to use; it changes only after a passed safety check.
- **Edition**: the rulebook's version, a date plus a count ({{edition}}); it goes up when a rule changes.
- **Safety check**: the test a rule change must pass before it is used: example claims, earlier decisions and your claims must all come out right; its result, PASS or FAIL, is written in Safety check result.
- **Earlier decision**: a claim an editor already decided (here the 5 from the audit of 9 October, when editors checked the agent's tags on real claims); the agent must keep getting it right.
- **Example claim**: one of the tag's 6 examples in the Rulebook, or one of 4 examples of its opposite tag, Self-contained, which the agent keeps in its own files (they are not on this page); it must always come out right.
- **Agent confidence**: how sure the agent is of its answers on a claim, from 0.5 (a coin flip) to 1 (certain); Your queue shows the least sure claims first.
- **Agent status**: what the agent says about a claim: Waits for you, Done, Disagrees with your decision or Could not read; a claim you have decided leaves Your queue once the agent reads it again.
- **Verified tags**: the tags you confirm on a claim (the real claims table calls this column Claim quality tags — verified); it always wins over the agent's answer.
- **Review status**: To review until you decide a claim, then Reviewed; a Reviewed claim is an earlier decision.
- **Views**: the Claims table has Your queue (the claims whose Agent status is Waits for you), Needs your note (a Why wrong with no Challenged tags notes) and Agent disagreed (the agent disagrees with your decision); Lessons waiting shows the Rule changes not yet decided.

**If something stops.**

- Claude says "paused": untick Paused in Agent settings (the last table on this page), then type the command again.
- Claude says your Claude allowance ran out: wait until your Claude allowance is back, then type the same command again; it continues where it stopped.
- Claude says the rulebook text was edited by hand: put When to use back as it was (the report links the Rulebook), or ask the engineer; then type the command again. Anything else: send the engineer the whole report.
