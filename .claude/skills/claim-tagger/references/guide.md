# Checklists after a report

Some reports end with a Next line that sends the editor to Notion. Under such a report the skill adds one checklist from this file, and nothing else.

## How a checklist is added

- Relay the report first, verbatim and complete: the sentence, the table, the Next line; a FAIL report of promote has a part more between the table and the Next line, the suggestion (the sentence, its Why line and the block to copy), which is relayed with the rest. Never reword it, and never put a word before it.
- Then one blank line, then the checklist of the Next line (the table below picks it). A checklist is a numbered list of at most five lines, with no heading and no words before or after it.
- A checklist says which view to open, which columns to fill in and in which order, what to look at, and ends with the next command to type.
- A report whose Next line only names a command (`Next: type ...`), a stopped run, a refusal and a report about a pause get no checklist.
- The lists are for Tag decisions, on the hub "Claim tagger v2", where every decision is the editor's: made in Notion, or entered by Claude on the editor's instruction (`/claim-tagger decide`, whose report only names a command and so gets no checklist). The practice pages are parked (P48), so this file has no practice forms; they are in the version tagged claim-tagger-v1.
- The words are the page's: the lists name the views and columns of "Claim tagger v2" as the page and its view hints do (Agent is right, Tag outcome, Your note; Status and Editor wording). The editor never names a reason or a rule: the agent reads each decision itself and writes its view in Agent's view of your decision, with the Rule and Why the agent thinks so (P45). Change the page and this file together.

| The Next line says | Checklist |
|---|---|
| `decide ... in Your queue (link)` or `start at the top of Your queue (link)` (tag, status, and promote after a PASS when rows still wait) | Decide in Your queue |
| `add a note on ... in Needs your note (link), then type /claim-tagger distill again` (distill, when a decision has no note and no rule change was drafted or waits) | Needs your note |
| `read it in Lessons waiting (link) ... and approve it or write your own wording`, or `approve or reject ... in Lessons waiting (link)` (distill, status), or `reject the rule change ... in Lessons waiting (link), then type /claim-tagger distill again` (distill, status and promote, when a rule change rests on a decision the agent now reads as its own slip) | Approve in Lessons waiting |
| `in Lessons waiting (link), paste the block above into Editor wording in place of what is there, or write all of rule 3 as you want it` or `in Lessons waiting (link), open the change and write all of the rule in Editor wording` (promote after a FAIL; the first when the report has the suggestion with its Why line and the block to copy, the second when no sentence could be written) | After a FAIL |
| `say why in Your note on the rows in Agent disagreed (link)` (follow-up) | Agent disagreed |

## Decide in Your queue

1. Open Your queue (the link in the Next line): the rows, a claim and one tag, that wait for you; a claim's rows stand together.
2. Read Agent proposal and Agent reason. Open claim opens the claim, with its sources and its Geo link.
3. Agree with the agent? Tick Agent is right. Disagree, or it says Can't tell? Set Tag outcome. The row then leaves Your queue.
4. Your note is optional. When you overrule the agent, say why in your own words: without a note the agent drafts no rule change. You need not name a rule or a reason.
5. When your rows are decided, type /claim-tagger distill.

## Needs your note

1. Open Needs your note (the link in the Next line): the rows where you overruled the agent and wrote no note.
2. Read Agent's view of your decision and Why the agent thinks so: what the agent made of your decision without a note. That view is a guess, so it drafts no rule change until your note is there.
3. Write Your note on the row: why you decided as you did, in plain words.
4. You need not name a rule or a reason; the agent works them out. The row leaves this list after the agent next reads your notes.
5. When the notes are in, type /claim-tagger distill again.

## Approve in Lessons waiting

1. Open Lessons waiting (the link in the Next line): each row shows Current text and Proposed text side by side.
2. Read both and ask whether the draft says what you mean.
3. If it does, set Status to Approved. If not, write all of the rule as you want it in Editor wording, then set Status to Approved: your wording is tested instead of the draft.
4. A draft you do not want gets Status Rejected. So does a draft whose Next line says it rests on a decision the agent now reads as its own slip: reject it, then type /claim-tagger distill again.
5. When a change is Approved, type /claim-tagger promote.

## After a FAIL

1. Open Lessons waiting (the link in the Next line) and open the change; its Status stays Approved.
2. If the promote report gave a block (the rule with a suggested sentence), read its Why line, then paste the block into Editor wording in place of what is there.
3. If it gave none, or you want other words, write all of the rule as you want it in Editor wording.
4. To give the change up, set Status to Rejected instead: the rule stays as it was.
5. Otherwise type /claim-tagger promote again.

## Agent disagreed

1. Open Agent disagreed (the link in the Next line): the rows where the rule now in force still answers otherwise than you decided.
2. Read Agent proposal, Agent reason and Agent's view of your decision next to your Tag outcome: the view says whether the agent or the rule is the problem.
3. If the agent is right, set Tag outcome to match. If not, say in Your note what the rule misses, in plain words.
4. Type /claim-tagger distill.
