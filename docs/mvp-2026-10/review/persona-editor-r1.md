# Persona review: editor, round 1

2026-10-13. Geo content editor, fresh eyes, Notion connector only, no code.

## Verdict: clear to an editor?

Mostly, for the one job the callout describes: open Your queue, read the claim and the reason, set Tag outcome, add Why wrong only when overruling. A plain case takes a minute. Everything around that job is unclear: what Stage and Direction mean (no legend anywhere), whether I set Decided at myself, what follows Needs evidence or Ask another editor, and what the five red FAIL cards on the hub mean for me. The queue also puts the hardest cases first and scatters a claim's sibling rows far apart. I could use it weekly for yes/no decisions today, but not for the other two outcomes or anything touching lessons and runs without a one-screen legend and the engineer's answers below.

## Stage values as I read them from the page alone

Stage is a formula with no description or value list; these readings come from the names, the callout and the view filters.

- To review: no Tag outcome yet; the row is mine (Your queue filters on this).
- Waiting for evidence: I chose Needs evidence; someone unstated must read a source first.
- Second opinion: I chose Ask another editor; an unnamed, unassigned editor must decide.
- Lesson proposed: my decision was folded into a lesson waiting for the rule owner.
- Regression case: the decision is a permanent test for every rule change.
- Decided: Tag outcome set (or a seeded outcome stands), nothing pending.
- Closed: finished and no longer counted; nothing says what closes a row.

Why wrong (well described on the column):

- Agent slip: the rule settles it and the agent misread it; fix the agent.
- Rule unclear: the rule does not settle it; clarify it or add a boundary example.
- Rule should change: the rule settles it but gives the wrong answer.
- No tag fits: a real problem no rulebook tag names.
- Other: none of the above; a sentence is required.

## Findings

| ID | Severity (must/should/nice) | Finding | Where | Suggested change |
|---|---|---|---|---|
| ED-1 | must | The callout names only Tag outcome, Why wrong and a sentence; nothing says whether I fill Decided at or Decided by. | Hub callout; Decided at, Decided by | Say which I set, or drive Stage from Tag outcome and auto-stamp the date. |
| ED-2 | must | Stage and Direction, the main status signals, have no description and no value list. | Stage, Direction | One-line meaning per value in the description; a legend line in the callout. |
| ED-3 | must | Status promises "Rolled back after a FAIL", but LS-1 is still Approved after four FAIL gates while LS-2 is Rolled back after one. | Rule changes: Status; Latest runs | Make Status follow the latest gate, or add Gate verdict and Attempts; say when a lesson is retried. |
| ED-4 | must | The FAIL card is for engineers: unlinked case ids, "canaries", "paired accuracy", "95% CI", a CLI rollback command, and no line on what it means for editors. | Runs: Gate 2026-10-13.2 · LS-1 (4) | Open with "What this means for editors"; link failing cases to their rows; move the command to Engineer notes. |
| ED-5 | should | Row title is a hash, the page body is blank, the claim is a link, and a row shows 25+ mostly agent-internal properties. | Tag decisions rows | Title = claim snippet + tag, or a Claim text property; hide agent-internal properties in editor views. |
| ED-6 | should | Sorting by Priority then confidence scatters a claim's siblings (Predictive/Hypothetical, Simple/Debate, Factual/Opinion); one claim appears four times. | Your queue, My queue | Group by Claim; when one of a pair is decided, pre-fill or hide the other. |
| ED-7 | should | Proposal-to-outcome mapping is unstated: Keep tag means Applies, Do not add or Remove means Does not apply; Read source first has no agreeing outcome. | Agent proposal | One line in the description or callout. |
| ED-8 | should | Needs evidence and Ask another editor lead nowhere visible: no who, no instruction; four Check source rows sit in the queue that nobody can decide. | Tag outcome; Priority = Check source | Describe the follow-up on the options; keep Read-source-first rows out of the queue until sources are readable. |
| ED-9 | should | No descriptions on Why in queue (Blind check, Editor challenge, Migrated decision), Priority, Agent follow-up, Follow-up run, Decided by; "a rule value" is never named. | Tag decisions schema | Fill them; name the rule values. |
| ED-10 | should | Overrules without a reason go unflagged: the Melania Trump row answers Applies against Do not add tag with Why wrong empty. | Decided; Needs your note | A view or Direction state for "overruled, no Why wrong". |
| ED-11 | should | The callout says decisions become permanent tests, but only some decided rows carry In regression suite, with no stated reason. | In regression suite | Say which decisions become tests and when. |
| ED-12 | should | Last run at, Last run summary and Owner are empty despite a Tag run and five gates today; Paused says nothing about what it stops. | Agent settings | Fill from the last run; describe Paused; set Owner. |
| ED-13 | should | LS-1 is Approved with Approved by empty, and its Editor wording differs from Proposed text with no author or date. | Rule changes: LS-1 | Require Approved by; stamp Editor wording with who and when. |
| ED-14 | nice | Hub and database views show different columns; the Decided view carries three empty filter chips. | Hub views; Decided | One shared view per purpose; delete the empty filters. |
| ED-15 | nice | The Tag run says "67 held back by the weekly cap of 40" while 53 rows wait; the cap limits new rows, not the queue. | Weekly cap | Say so in the description; show the queue count on the hub. |
| ED-16 | nice | Least confident first means a new editor's first page is the hardest cases. | Your queue sort | Offer a sure-things-first sort, or open with the 3-of-3 rows. |
| ED-17 | nice | Lessons waiting is empty with no explanation. | Hub: Lessons waiting | Show all lessons with Status, or an empty-state line. |

## The two decisions

| Row | Claim | Agent | Mine | Time | Looked up |
|---|---|---|---|---|---|
| [f4d50e38…::Predictive](https://app.notion.com/p/3f8273e214eb819d8df0e2b395fbc70b) | The Trump administration will find another route to restrict mail voting before November | Add tag, 0.92, 3 of 3 | Applies, no Why wrong | about 1 min | The claim page (the row shows the claim only as a link). |
| [fbd881e9…::Context-dependent](https://app.notion.com/p/3f8273e214eb81bfabb9ded1c570c9fe) | Keeping the Camp David meeting secret shields Iran-Yemen policy from public accountability | Keep tag, 0.65, 3 of 3 | Applies, no Why wrong | 2 to 3 min | Claim page; Context-dependent and Self-contained rule 3; inferred that Keep tag means Applies. |

Written on each: Tag outcome, Your reasoning, Decided at = 2026-10-13; Decided by left empty. Both rows left Your queue at once (53 to 51); whether Tag outcome alone would do that, I cannot tell. Finding two decidable rows took longer (about 2 minutes) than deciding them.

## Questions for the engineer

1. If I change a Tag outcome next week, what happens to the permanent test, to a lesson drafted from my old sentence, and to the agent's follow-up?
2. Can a rule change without the owner? LS-1's Editor wording was rewritten after approval with Approved by empty. Who may edit it, and does editing re-run the gate?
3. What does a FAIL card mean for me? Do I keep deciding under the old rule, and are old-rule decisions re-queued as Rule changed if the lesson later passes?
4. What do I do with Waiting for evidence and Second opinion: who reads the source or gives the second opinion, and what moves the row on?
5. Must I set Decided at and Decided by, or does Tag outcome alone move the row?
6. Why do only some decided rows carry In regression suite?

## Questions for the orchestrator

1. Should the queue be grouped by claim, with counterpart pairs decided as one row?
2. Who owns the editor-facing text (legend, mapping, descriptions), and can it land before editors are invited?
3. Should Read-source-first rows stay out of the editor queue until sources can be read?
4. What is the weekly expectation per editor? 53 rows waited today against 40 new per week; easy rows take 1 to 3 minutes.
5. Should reviewers set Decided by? Empty, it hides who decided.
