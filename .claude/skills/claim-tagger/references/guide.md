# Checklists after a report

Some reports end with a Next line that sends the editor to Notion. Under such a report the skill adds one checklist from this file, and nothing else.

## How a checklist is added

- Relay the report first, verbatim and complete: the sentence, the table, the Next line. Never reword it, and never put a word before it.
- Then one blank line, then the checklist of the Next line (the table below picks it). A checklist is a numbered list of at most five lines, with no heading and no words before or after it.
- A checklist says which view to open, which columns to fill in and in which order, what to look at, and ends with the next command to type.
- A report whose Next line only names a command (`Next: type ...`), a stopped run, a refusal and a report about a pause get no checklist. In the demo, `Next: look at step 7 on the practice page` gets none either: the page has the text.
- A demo report starts with "Demo · ": use the Demo list, whose command is `/claim-tagger demo ...`.
- The words are the practice page's. The Demo lists name the same columns in the same order as steps 3 and 5 of the page (Verified tags, Why wrong, Challenged tags notes, Review status; Status and Editor wording), and the real lists use the same column names and order. Change the page and this file together.

| The Next line says | Checklist |
|---|---|
| `decide ... in Your queue (link)` or `start at the top of Your queue (link)` (tag, status, and promote after a PASS when claims still wait) | Decide in Your queue |
| `read it in Lessons waiting (link) ... and approve it or write your own wording`, or `approve or reject ... in Lessons waiting (link)` (distill, status) | Approve in Lessons waiting |
| `in Lessons waiting (link), open the change and put this whole text into Editor wording` or `write all of the rule in Editor wording` (promote after a FAIL) | After a FAIL |
| `add a note in Challenged tags notes on the claims in Agent disagreed (link)` (follow-up, and the demo's step 7) | Agent disagreed |

## Decide in Your queue

Real:

1. Open Your queue (the link in the Next line): the claims that wait for you, lowest Agent confidence first.
2. Read Agent reasons and Tags waiting: they say which tag waits and why.
3. On each claim fill in, in this order: Verified tags, Why wrong (only where the agent was wrong), Challenged tags notes, Review status.
4. Set Review status to Reviewed last: a claim you have decided stays in Your queue until the agent reads it again.
5. When your claims are decided, type /claim-tagger distill.

Demo:

1. Open Your queue (the link in the Next line): your two claims wait there.
2. On each of your two claims fill in, in this order: Verified tags, Why wrong, Challenged tags notes, Review status; step 3 of the practice page gives the values.
3. Paste the sentence for Challenged tags notes as the page gives it, and set Review status to Reviewed last.
4. A decided claim stays in Your queue until the agent reads it again, which the follow-up of step 7 does for these two.
5. When both claims are Reviewed, type /claim-tagger demo distill.

## Approve in Lessons waiting

Real:

1. Open Lessons waiting (the link in the Next line): each row shows Current text and Proposed text side by side.
2. Read both and ask whether the draft says what you mean.
3. If it does, set Status to Approved. If not, write all of the rule as you want it in Editor wording, then set Status to Approved: your wording is tested instead of the draft.
4. A draft you do not want gets Status Rejected.
5. When a change is Approved, type /claim-tagger promote.

Demo:

1. Open Lessons waiting (the link in the Next line): the draft shows Current text and Proposed text side by side.
2. Read both and ask whether the draft says what you meant.
3. If it does, set Status to Approved. If not, write all of rule 3 as you want it in Editor wording, then set Status to Approved: your wording is tested instead of the draft.
4. Approving changes no rule yet; the safety check comes next.
5. Type /claim-tagger demo promote.

## After a FAIL

Real:

1. Open Lessons waiting (the link in the Next line) and open the change.
2. Put the whole text the Next line gives into Editor wording, or write all of the rule as you want it; edit the added sentence if it does not say what you mean.
3. To give the change up, set Status to Rejected instead: the rule stays as it was.
4. Type /claim-tagger promote again.

Demo:

1. Open Lessons waiting (the link in the Next line) and open the change.
2. Put the whole text the Next line gives into Editor wording, or write all of rule 3 as you want it; edit the added sentence if it does not say what you mean.
3. If it fails again, set Status to Rejected: the rule stays as it was, the demo ends here, and the safety check has done its job.
4. Type /claim-tagger demo promote again.

## Agent disagreed

Real:

1. Open Agent disagreed (the link in the Next line): the claims where the rule now in force still reads another way than you did.
2. Read Agent reasons next to your Verified tags and Challenged tags notes.
3. Add to Challenged tags notes what the rule misses: start a line with the tag name and a colon, then your words, and set Why wrong when the reason differs.
4. Type /claim-tagger distill.

Demo:

1. Open Agent disagreed (the link in the Next line): the claims where the new rule 3 still reads another way than you did.
2. Read Agent reasons next to your Verified tags and Challenged tags notes.
3. Add to Challenged tags notes what rule 3 misses: start a line with the tag name and a colon, then your words.
4. Type /claim-tagger demo distill.
