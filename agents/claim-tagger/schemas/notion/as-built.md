# Notion schema as built (13 October 2026)

Every schema and view statement this session sent through the Notion connector that Notion accepted, in order, extracted from the session transcript (50 accepted calls, 12 rejected attempts omitted). The hub page is 3da273e214eb80c180d5fd0894bc2db8; the databases live in its sub-page Databases. Formula text cannot be read back from Notion, so this file is the record of what is live; change a formula only by applying a new statement and appending it here. Later statements on the same column replace earlier ones.

## Databases (notion-create-database)

### Rulebook (13:16:13 UTC)

The rules the agent tags by: a copy of the 14 Verified tags. A rule changes only when the rule owner approves a lesson and it passes the gate; the agent then writes the new text here. To ask for a change, decide a row in Tag decisions and pick Why wrong = Rule unclear or Rule should change.

```sql
CREATE TABLE (
  "Tag title" TITLE COMMENT 'Tag name as in the team taxonomy; the agent key',
  "Status" SELECT('Verified':green, 'Proposed':yellow, 'Retired':gray),
  "Category" SELECT('Meaning':purple, 'Quality':orange, 'Format':blue, 'Usage':yellow, 'Check':gray),
  "Polarity" SELECT('Classification':blue, 'Issue':red, 'Positive':green),
  "Counterpart" RICH_TEXT COMMENT 'Paired tag: exactly one of the two applies',
  "Description" RICH_TEXT,
  "Example claims" RICH_TEXT COMMENT 'One claim per line. Each one is a canary the agent must always get right',
  "When to use" RICH_TEXT COMMENT 'Opening line, numbered rules, optional Note line. Changed only by an approved lesson that passed the gate',
  "Human only" CHECKBOX COMMENT 'Only editors apply this tag',
  "Judged" CHECKBOX COMMENT 'The agent decides this tag. Unticked: human only or computed',
  "Rule version" RICH_TEXT COMMENT 'Rulebook version in which this tag last changed (agent)',
  "Tag hash" RICH_TEXT COMMENT 'Fingerprint of description, rules and examples (agent)'
)
```

### Agent settings (13:16:16 UTC)

The agent's switches. Tick Paused to stop every step at once; the agent checks it before each step.

```sql
CREATE TABLE (
  "Name" TITLE,
  "Paused" CHECKBOX,
  "Paused by" PEOPLE,
  "Reason" RICH_TEXT,
  "Weekly cap" NUMBER COMMENT 'Most new queue rows per week',
  "Owner" PEOPLE,
  "Rubric in force" RICH_TEXT,
  "Last run at" DATE,
  "Last run summary" RICH_TEXT
)
```

### Claims (13:16:52 UTC)

U.S. Politics claims mirrored from Geo on 13 Oct 2026 for this trial. Agent tags = what the agent applies now; a tag you decided always wins. Nothing is written to Geo.

```sql
CREATE TABLE (
  "Claim title" TITLE,
  "Geo ID" RICH_TEXT COMMENT 'Agent key',
  "Geo link" URL,
  "Sources count" NUMBER,
  "Source URLs" RICH_TEXT COMMENT 'One Geo source per line',
  "Table" SELECT('U.S. Politics':blue, 'World affairs':purple),
  "Sample" SELECT('Decided':orange, 'Forecast':purple, 'Random':gray) COMMENT 'Why this claim is in the trial',
  "Agent tags" RELATION('319e6022-0b6a-4068-b560-99c83fae5bdf') COMMENT 'Tags the agent applies. Where an editor decided a tag, the agent follows the decision',
  "Readiness" SELECT('Needs editor':orange, 'Fix needed':red, 'Not checkable':gray, 'Ready':green) COMMENT 'Needs editor: a tag waits in the queue. Fix needed: an issue tag applies. Not checkable: a source is unreadable',
  "Tag confidence" RICH_TEXT COMMENT 'One line per tag: decision, confidence (uncalibrated), rule relied on',
  "Last judged" RICH_TEXT COMMENT 'Rulebook version and run'
)
```

### Rule changes (13:16:58 UTC)

Lessons the agent drafts from your decisions. The rule owner sets Approved or Rejected, and may rewrite the text in Editor wording. Approved changes go through the gate; only on PASS does the agent write the Rulebook and set Live. On HOLD or FAIL the Rulebook is untouched.

```sql
CREATE TABLE (
  "Lesson title" TITLE,
  "Lesson ID" UNIQUE_ID PREFIX 'LS',
  "Tag" RELATION('319e6022-0b6a-4068-b560-99c83fae5bdf'),
  "Rule" RICH_TEXT COMMENT 'For example: Predictive rule 1',
  "Kind" SELECT('Clarify wording':blue, 'Add boundary example':green, 'Change the rule':orange, 'New or promoted tag':purple),
  "Current text" RICH_TEXT COMMENT 'Full When to use today, kept for exact rollback',
  "Proposed text" RICH_TEXT COMMENT 'Full When to use the agent proposes',
  "Editor wording" RICH_TEXT COMMENT 'Optional: if filled, this text is tested instead of Proposed text',
  "Status" SELECT('Proposed':yellow, 'Approved':blue, 'Rejected':gray, 'Live':green, 'Rolled back':red) COMMENT 'Rule owner sets Approved or Rejected. Agent sets Live after a PASS, Rolled back after a FAIL',
  "Approved by" PEOPLE,
  "Rubric version" RICH_TEXT,
  "Gate result" RICH_TEXT,
  "Created" CREATED_TIME
)
```

### Tag decisions (13:17:18 UTC)

One row per claim and tag. Open My queue, read the claim and the agent's reason, then set Tag outcome yourself, whatever the agent proposed. If you overrule the agent or decide against the written rule, pick one Why wrong value and add a sentence when it is a rule value. The agent never changes your fields; Stage updates itself.

```sql
CREATE TABLE (
  "Key" TITLE COMMENT 'geoId::Tag, the agent key',
  "Claim" RELATION('506dddee-af6e-4cbe-980f-a1ef1564d9bd', DUAL 'Tag decisions'),
  "Tag" RELATION('319e6022-0b6a-4068-b560-99c83fae5bdf'),
  "Agent proposal" SELECT('Add tag':blue, 'Remove tag':orange, 'Keep tag':green, 'Do not add tag':gray, 'Read source first':purple),
  "Agent confidence" NUMBER COMMENT '0 to 1, not calibrated: sort by it, do not read it as a probability',
  "Why I recommend this" RICH_TEXT,
  "Agent full note" RICH_TEXT COMMENT 'Agent note and history',
  "Why in queue" SELECT('Low confidence':yellow, 'Auditor flag':orange, 'Editor challenge':pink, 'Rule changed':purple, 'Blind check':blue, 'Seeded decision':gray, 'Migrated decision':gray),
  "Priority" SELECT('High':red, 'Medium':yellow, 'Check source':purple),
  "Rubric version" RICH_TEXT,
  "Tag outcome" SELECT('Applies':green, 'Does not apply':red, 'Needs evidence':yellow, 'Ask another editor':purple) COMMENT 'Your decision. The agent never changes it',
  "Why wrong" SELECT('Agent slip':orange, 'Rule unclear':yellow, 'Rule should change':red, 'No tag fits':purple, 'Other':gray) COMMENT 'Only when overruling the agent or the written rule. Agent slip: the rule settles it, the agent did not follow it. Rule unclear: the rule does not settle it. Rule should change: the rule settles it but is wrong. No tag fits: no rulebook tag names the problem',
  "Your reasoning" RICH_TEXT COMMENT 'One sentence when Why wrong is a rule value or Other; lessons are drafted from it',
  "Decided by" PEOPLE,
  "Decided at" DATE,
  "Seeded outcome" SELECT('Applies':green, 'Does not apply':red) COMMENT 'Decision from the 9 Oct audit, copied once at setup (agent). Your Tag outcome overrides it',
  "Seeded reasoning" RICH_TEXT COMMENT 'The audit editor reasoning, names removed (agent)',
  "Seeded at" DATE,
  "Lesson" RELATION('e1836e35-d614-4434-ab34-a0ddeaa1842c', DUAL 'Supporting rows'),
  "In regression suite" DATE COMMENT 'Agent: when this decision became a permanent test',
  "Agent follow-up" SELECT('Fixed':green, 'Still wrong':red, 'Not re-run':gray),
  "Follow-up run" RICH_TEXT
)
```

### Runs (13:17:23 UTC)

One row per agent step. Open a Gate row for its result card: PASS went live, FAIL was rolled back, HOLD needs more evidence.

```sql
CREATE TABLE (
  "Run title" TITLE,
  "Kind" SELECT('Tag':blue, 'Distill':purple, 'Gate':orange, 'Follow-up':green, 'Smoke':gray),
  "Rubric version" RICH_TEXT,
  "Started" DATE,
  "Claims judged" NUMBER,
  "Canaries" RICH_TEXT COMMENT 'Passed of active; failing ids',
  "Newly failing" NUMBER,
  "Per-tag summary" RICH_TEXT,
  "Verdict" SELECT('PASS':green, 'HOLD':yellow, 'FAIL':red, 'n/a':gray),
  "Summary" RICH_TEXT COMMENT 'The result card in six lines; the full card is in the page body',
  "Lesson" RELATION('e1836e35-d614-4434-ab34-a0ddeaa1842c', DUAL 'Result card'),
  "Cost USD" NUMBER FORMAT 'dollar',
  "Model" RICH_TEXT
)
```

## Later schema changes (notion-update-data-source), in order

### Rulebook (13:18:05 UTC)

```sql
ADD COLUMN "Changed by" RELATION('e1836e35-d614-4434-ab34-a0ddeaa1842c') COMMENT 'The lesson that last changed this tag (agent, written only after a gate PASS)'
```

### Tag decisions (13:18:46 UTC)

```sql
ADD COLUMN "Effective outcome" FORMULA('if(empty(prop("Tag outcome")), prop("Seeded outcome"), prop("Tag outcome"))')
```

### Tag decisions (13:19:21 UTC)

```sql
ADD COLUMN "Direction" FORMULA('lets(o, prop("Effective outcome"), p, prop("Agent proposal"), says, ifs(p == "Add tag" or p == "Keep tag","applies", p == "Remove tag" or p == "Do not add tag","not",""), ifs(o != "Applies" and o != "Does not apply","Open", empty(says),"Open", o == "Applies" and says == "applies","Agent right", o == "Does not apply" and says == "not","Agent right", o == "Applies","Missed","Wrongly applied"))')
```

### Tag decisions (13:19:50 UTC)

```sql
ADD COLUMN "Tag name" ROLLUP('Tag', 'Tag title', 'show_original'); ADD COLUMN "Lesson status" ROLLUP('Lesson', 'Status', 'show_original')
```

### Tag decisions (13:20:01 UTC)

```sql
ADD COLUMN "Stage" FORMULA('lets(o, prop("Effective outcome"), ls, format(prop("Lesson status")), ruleWhy, prop("Why wrong") == "Rule unclear" or prop("Why wrong") == "Rule should change" or prop("Why wrong") == "No tag fits", ifs(empty(o),"To review", o == "Needs evidence","Waiting for evidence", o == "Ask another editor","Second opinion", contains(ls,"Proposed") or contains(ls,"Approved"),"Lesson proposed", prop("Agent follow-up") == "Fixed","Closed", prop("Direction") == "Agent right" and not(ruleWhy),"Closed", not(empty(prop("In regression suite"))),"Regression case","Decided"))')
```

### Tag decisions (13:20:03 UTC)

```sql
ADD COLUMN "Applied tag" FORMULA('if(prop("Effective outcome") == "Applies", format(prop("Tag name")),"")')
```

### Tag decisions (13:20:04 UTC)

```sql
ADD COLUMN "Rejected tag" FORMULA('if(prop("Effective outcome") == "Does not apply", format(prop("Tag name")),"")')
```

### Claims (13:20:22 UTC)

```sql
ADD COLUMN "Decided applies" ROLLUP('Tag decisions', 'Applied tag', 'show_original'); ADD COLUMN "Decided does not apply" ROLLUP('Tag decisions', 'Rejected tag', 'show_original')
```

### Runs (15:07:50 UTC)

```sql
ALTER COLUMN "Kind" SET SELECT('Tag':blue, 'Distill':purple, 'Gate':orange, 'Follow-up':green, 'Smoke':gray, 'Baseline':gray, 'Rollback':red)
```

### Tag decisions (17:56:13 UTC)

```sql
ALTER COLUMN "Direction" SET FORMULA('lets(o, prop("Effective outcome"), p, prop("Agent proposal"), says, ifs(p == "Add tag" or p == "Keep tag","applies", p == "Remove tag" or p == "Do not add tag","not",""), ifs(o != "Applies" and o != "Does not apply","Open", empty(says),"Open", o == "Applies" and says == "applies","Agent right", o == "Does not apply" and says == "not","Agent right", o == "Applies","Missed","Wrongly applied"))') COMMENT 'Computed from your outcome and the agent proposal. Agent right: you agreed. Missed: you applied a tag the agent did not propose. Wrongly applied: you rejected a tag the agent proposed. Open: no outcome yet, or the proposal was Read source first'
```

### Agent settings (17:56:32 UTC)

```sql
ALTER COLUMN "Paused" SET CHECKBOX COMMENT 'Tick to stop the agent: every command (tag, distill, promote, follow-up) checks this first and refuses to run while it is ticked. Untick to resume'; ALTER COLUMN "Weekly cap" SET NUMBER COMMENT 'Most NEW queue rows the agent may create per week; rows already waiting are not limited by it'; ALTER COLUMN "Last run summary" SET RICH_TEXT COMMENT 'One line from the latest agent run (agent)'
```

### Tag decisions (17:57:11 UTC)

```sql
ALTER COLUMN "Decided at" SET DATE COMMENT 'Optional: the day you decided. Tag outcome alone moves the row; the date helps the weekly report and the views sort by it'; ALTER COLUMN "Decided by" SET PEOPLE COMMENT 'Optional: set yourself so the weekly report shows who decided; the agent never fills it'; ALTER COLUMN "Priority" SET SELECT('High':red, 'Medium':yellow, 'Check source':purple) COMMENT 'High: the agent leans towards applying an issue tag, or a rule changed under it. Medium: the agent is unsure either way. Check source: cannot be decided without reading the sources (not readable in this trial; choose Needs evidence)'; ALTER COLUMN "Why in queue" SET SELECT('Low confidence':yellow, 'Auditor flag':orange, 'Editor challenge':pink, 'Rule changed':purple, 'Blind check':blue, 'Seeded decision':gray, 'Migrated decision':gray) COMMENT 'Low confidence: the three judge runs disagreed or were unsure. Auditor flag: flagged by the 9 October audit. Rule changed: a rule changed and the agent now answers differently. Seeded decision: copied from the audit at setup. Editor challenge, Blind check: later'; ALTER COLUMN "Agent follow-up" SET SELECT('Fixed':green, 'Still wrong':red, 'Not re-run':gray) COMMENT 'Written by the agent after a rule change went live: Fixed means the agent now agrees with your decision, Still wrong means it does not'; ALTER COLUMN "Follow-up run" SET RICH_TEXT COMMENT 'Which run re-checked this row (agent)'
```

### Rule changes (17:57:15 UTC)

```sql
ALTER COLUMN "Status" SET SELECT('Proposed':yellow, 'Approved':blue, 'Rejected':gray, 'Live':green, 'Rolled back':red) COMMENT 'Rule owner sets Approved or Rejected. Agent sets Live after a gate PASS. After HOLD or FAIL the lesson stays Approved with the verdict in Gate result, so the owner can reword (Editor wording) or reject it. Rolled back: a live change reverted, or a planted test discarded'; ALTER COLUMN "Editor wording" SET RICH_TEXT COMMENT 'Optional, rule owner only: if filled, this text is gated instead of Proposed text. Editing it does not re-run the gate; the engineer runs promote again'; ALTER COLUMN "Gate result" SET RICH_TEXT COMMENT 'The latest gate verdict in six lines (agent); the full card is the linked Runs row'
```

### Tag decisions (17:57:33 UTC)

```sql
ALTER COLUMN "Stage" SET FORMULA('lets(o, prop("Effective outcome"), ls, format(prop("Lesson status")), ruleWhy, prop("Why wrong") == "Rule unclear" or prop("Why wrong") == "Rule should change" or prop("Why wrong") == "No tag fits", ifs(empty(o),"To review", o == "Needs evidence","Waiting for evidence", o == "Ask another editor","Second opinion", contains(ls,"Proposed") or contains(ls,"Approved"),"Lesson proposed", prop("Agent follow-up") == "Fixed","Closed", prop("Direction") == "Agent right" and not(ruleWhy),"Closed", not(empty(prop("In regression suite"))),"Regression case","Decided"))') COMMENT 'Computed. To review: no outcome yet. Waiting for evidence: you chose Needs evidence. Second opinion: Ask another editor. Lesson proposed: a lesson from your decision awaits the rule owner. Regression case: your decision is a permanent test. Closed: agreed, or fixed after a change'
```

### Tag decisions (17:59:53 UTC)

```sql
ADD COLUMN "Claim text" ROLLUP('Claim', 'Claim title', 'show_original'); ALTER COLUMN "In regression suite" SET DATE COMMENT 'Agent: when your decision became a permanent test. Decisions marked Rule unclear or Rule should change wait until their lesson is live; Needs evidence and Ask another editor never become tests'
```

### Tag decisions (18:18:47 UTC)

```sql
ALTER COLUMN "Agent proposal" SET SELECT('Add tag':blue, 'Remove tag':orange, 'Keep tag':green, 'Do not add tag':gray, 'Read source first':purple) COMMENT 'Add tag or Keep tag: the agent thinks the tag applies. Remove tag or Do not add tag: it does not. Read source first: it cannot tell without the sources. Agree by choosing the matching Tag outcome; to overrule, choose the other one and fill Why wrong'; ALTER COLUMN "Tag outcome" SET SELECT('Applies':green, 'Does not apply':red, 'Needs evidence':yellow, 'Ask another editor':purple) COMMENT 'Your decision; the agent never changes it. Applies or Does not apply settles the row. Needs evidence: an editor with source access decides later (view Waiting for evidence). Ask another editor: a second editor decides (view Second opinion)'; ALTER COLUMN "Your reasoning" SET RICH_TEXT COMMENT 'One sentence when Why wrong is Rule unclear, Rule should change, No tag fits or Other; lessons are drafted from it, so say what the rule should have said'
```

### Agent settings (18:18:49 UTC)

```sql
ALTER COLUMN "Weekly cap" SET NUMBER COMMENT 'Most new queue rows the agent may create per week (editor-owned). It does not limit what already waits in the queue'
```

### Rule changes (18:27:00 UTC)

```sql
ADD COLUMN "Owner action" FORMULA('ifs(prop("Status") == "Proposed", "Approve or reject", prop("Status") == "Approved" and contains(prop("Gate result"), "Verdict: HOLD"), "Gate HOLD: wait for more decided examples, or reword", prop("Status") == "Approved" and contains(prop("Gate result"), "Verdict: FAIL"), "Gate FAIL: reword in Editor wording, or reject", "")') COMMENT 'Computed: what the rule owner must do with this lesson. Empty means nothing is waiting on the owner. Lessons waiting shows every lesson where this is filled'
```

## Views (notion-create-view and notion-update-view), in order

| Time (UTC) | Call | Database | Where | View | configure |
|---|---|---|---|---|---|
| 13:20:27 | create-view | Tag decisions | database tab | My queue | `FILTER "Stage" = "To review"; SORT BY "Priority" ASC, "Agent confidence" ASC; GROUP BY "Tag name"; SHOW "Key", "Claim", "Agent proposal", "Why I recommend this", "Agent confidence", "Priority", "Why in queue", "Tag outcome", "Why wrong", "Your reasoning", "Decided at"; WRAP CELLS true; FREEZE COLUMNS 1` |
| 13:20:30 | create-view | Tag decisions | database tab | Needs your note | `FILTER "Why wrong" IN ("Rule unclear", "Rule should change", "No tag fits", "Other"); FILTER "Your reasoning" IS EMPTY; SORT BY "Decided at" DESC; SHOW "Key", "Claim", "Tag name", "Tag outcome", "Why wrong", "Your reasoning", "Why I recommend this"; WRAP CELLS true` |
| 13:20:35 | create-view | Tag decisions | database tab | Decided | `FILTER "Effective outcome" IN ("Applies", "Does not apply"); SORT BY "Decided at" DESC; QUICK FILTER "Stage", "Direction", "Agent follow-up"; SHOW "Key", "Claim", "Tag name", "Effective outcome", "Direction", "Why wrong", "Your reasoning", "Stage", "Lesson", "In regression suite", "Agent follow-up", "Decided at"; WRAP CELLS true` |
| 13:20:39 | create-view | Rule changes | database tab | Lessons waiting | `FILTER "Status" = "Proposed"; SORT BY "Created" ASC; SHOW "Lesson title", "Lesson ID", "Tag", "Rule", "Kind", "Current text", "Proposed text", "Editor wording", "Supporting rows", "Status", "Approved by"; WRAP CELLS true` |
| 13:20:42 | create-view | Rule changes | database tab | Live rules | `FILTER "Status" = "Live"; SORT BY "Created" DESC; SHOW "Lesson title", "Lesson ID", "Tag", "Rule", "Rubric version", "Gate result", "Result card"; WRAP CELLS true` |
| 13:20:46 | create-view | Runs | database tab | Latest runs | `SORT BY "Started" DESC; SHOW "Run title", "Kind", "Verdict", "Rubric version", "Claims judged", "Canaries", "Newly failing", "Summary", "Lesson", "Cost USD", "Started"; WRAP CELLS true` |
| 13:20:50 | create-view | Rulebook | database tab | All tags | `SORT BY "Tag title" ASC; SHOW "Tag title", "Category", "Polarity", "Counterpart", "Judged", "Human only", "Rule version", "Changed by", "When to use"; WRAP CELLS true` |
| 13:20:53 | create-view | Claims | database tab | All claims | `SORT BY "Claim title" ASC; QUICK FILTER "Sample", "Readiness"; SHOW "Claim title", "Agent tags", "Decided applies", "Decided does not apply", "Readiness", "Last judged", "Sample", "Geo link"; WRAP CELLS true` |
| 13:20:56 | create-view | Claims | database tab | Needs editor | `FILTER "Readiness" = "Needs editor"; SORT BY "Claim title" ASC; SHOW "Claim title", "Agent tags", "Readiness", "Tag confidence", "Last judged"; WRAP CELLS true` |
| 13:21:55 | create-view | Tag decisions | hub page | Your queue | `FILTER "Stage" = "To review"; SORT BY "Priority" ASC, "Agent confidence" ASC; SHOW "Key", "Claim", "Tag name", "Agent proposal", "Why I recommend this", "Agent confidence", "Priority", "Why in queue", "Tag outcome", "Why wrong", "Your reasoning"; WRAP CELLS true; FREEZE COLUMNS 1` |
| 13:21:58 | create-view | Tag decisions | hub page | Needs your note | `FILTER "Why wrong" IN ("Rule unclear", "Rule should change", "No tag fits", "Other"); FILTER "Your reasoning" IS EMPTY; SORT BY "Decided at" DESC; SHOW "Key", "Claim", "Tag name", "Tag outcome", "Why wrong", "Your reasoning"; WRAP CELLS true` |
| 13:22:02 | create-view | Rule changes | hub page | Lessons waiting for the rule owner | `FILTER "Status" = "Proposed"; SORT BY "Created" ASC; SHOW "Lesson title", "Tag", "Rule", "Kind", "Current text", "Proposed text", "Editor wording", "Supporting rows", "Status"; WRAP CELLS true` |
| 13:22:05 | create-view | Runs | hub page | Latest runs | `SORT BY "Started" DESC; SHOW "Run title", "Kind", "Verdict", "Rubric version", "Claims judged", "Canaries", "Newly failing", "Summary", "Cost USD", "Started"; WRAP CELLS true` |
| 17:59:57 | create-view | Tag decisions | database tab | Overruled without a note | `FILTER "Direction" IN ("Missed", "Wrongly applied"); FILTER "Why wrong" IS EMPTY; SORT BY "Decided at" DESC; SHOW "Key", "Claim text", "Tag name", "Tag outcome", "Agent proposal", "Direction", "Why wrong", "Your reasoning"; WRAP CELLS true` |
| 18:00:01 | create-view | Tag decisions | database tab | Easy rows first | `FILTER "Stage" = "To review"; SORT BY "Agent confidence" DESC; SHOW "Key", "Claim text", "Tag name", "Agent proposal", "Why I recommend this", "Agent confidence", "Tag outcome", "Why wrong", "Your reasoning"; WRAP CELLS true; FREEZE COLUMNS 1` |
| 18:18:53 | create-view | Tag decisions | database tab | Waiting for evidence | `FILTER "Stage" = "Waiting for evidence"; SORT BY "Decided at" DESC; SHOW "Key", "Claim text", "Tag name", "Agent proposal", "Why I recommend this", "Tag outcome", "Your reasoning", "Decided by"; WRAP CELLS true` |
| 18:18:57 | create-view | Tag decisions | database tab | Second opinion | `FILTER "Stage" = "Second opinion"; SORT BY "Decided at" DESC; SHOW "Key", "Claim text", "Tag name", "Agent proposal", "Why I recommend this", "Tag outcome", "Your reasoning", "Decided by"; WRAP CELLS true` |
| 18:19:00 | create-view | Tag decisions | database tab | By claim | `FILTER "Stage" = "To review"; GROUP BY "Claim"; SORT BY "Agent confidence" DESC; SHOW "Key", "Tag name", "Agent proposal", "Why I recommend this", "Agent confidence", "Priority", "Tag outcome", "Why wrong", "Your reasoning"; WRAP CELLS true` |
| 18:19:58 | update-view |  |  | view://3f8273e2-14eb-81b8-ab1f-000c24bfb2d4 | `SHOW "Key", "Claim text", "Tag name", "Agent proposal", "Why I recommend this", "Agent confidence", "Priority", "Tag outcome", "Why wrong", "Your reasoning", "Claim"; WRAP CELLS true; FREEZE COLUMNS 1` |
| 18:20:01 | update-view |  |  | view://3f8273e2-14eb-8156-af45-000c3c911fcd | `SHOW "Key", "Claim text", "Tag name", "Agent proposal", "Why I recommend this", "Agent confidence", "Priority", "Tag outcome", "Why wrong", "Your reasoning", "Claim"; WRAP CELLS true; FREEZE COLUMNS 1` |
| 18:20:03 | update-view |  |  | view://3f8273e2-14eb-81c5-bb6a-000cd09c2c9b | `SHOW "Key", "Claim text", "Tag name", "Tag outcome", "Why wrong", "Your reasoning", "Why I recommend this"; WRAP CELLS true` |
| 18:20:05 | update-view |  |  | view://3f8273e2-14eb-81bf-883d-000c5d98f459 | `SHOW "Key", "Claim text", "Tag name", "Tag outcome", "Why wrong", "Your reasoning", "Why I recommend this"; WRAP CELLS true` |
| 18:20:08 | update-view |  |  | view://3f8273e2-14eb-819d-a5fa-000c7e7c6363 | `SHOW "Key", "Claim text", "Tag name", "Effective outcome", "Direction", "Why wrong", "Your reasoning", "Stage", "Lesson", "In regression suite", "Agent follow-up", "Decided at"; WRAP CELLS true` |
| 18:27:42 | create-view | Tag decisions | hub page | Handed on: needs evidence or a second opinion | `FILTER "Stage" IN ("Waiting for evidence", "Second opinion"); SORT BY "Decided at" DESC; SHOW "Key", "Claim text", "Tag name", "Stage", "Agent proposal", "Why I recommend this", "Tag outcome", "Your reasoning", "Decided by"; WRAP CELLS true` |
| 18:27:44 | update-view |  |  | view://3f8273e2-14eb-81fd-bffd-000c4feeae16 | `CLEAR FILTER; FILTER "Owner action" IS NOT EMPTY; SORT BY "Created" ASC; SHOW "Lesson title", "Lesson ID", "Owner action", "Tag", "Rule", "Kind", "Current text", "Proposed text", "Editor wording", "Gate result", "Supporting rows", "Status", "Approved by"; WRAP CELLS true` |
| 18:27:47 | update-view |  |  | view://3f8273e2-14eb-8119-9dc4-000c8b0e889a | `CLEAR FILTER; FILTER "Owner action" IS NOT EMPTY; SORT BY "Created" ASC; SHOW "Lesson title", "Lesson ID", "Owner action", "Tag", "Rule", "Kind", "Current text", "Proposed text", "Editor wording", "Gate result", "Supporting rows", "Status", "Approved by"; WRAP CELLS true` |

View ids (from the create calls):

- My queue (Tag decisions, database tab): view://3f8273e2-14eb-8156-af45-000c3c911fcd
- Needs your note (Tag decisions, database tab): view://3f8273e2-14eb-81bf-883d-000c5d98f459
- Decided (Tag decisions, database tab): view://3f8273e2-14eb-819d-a5fa-000c7e7c6363
- Lessons waiting (Rule changes, database tab): view://3f8273e2-14eb-81fd-bffd-000c4feeae16
- Live rules (Rule changes, database tab): view://3f8273e2-14eb-8186-9716-000c46151880
- Latest runs (Runs, database tab): view://3f8273e2-14eb-81f9-b85e-000cb1bc9630
- All tags (Rulebook, database tab): view://3f8273e2-14eb-8152-95c1-000c7414af5a
- All claims (Claims, database tab): view://3f8273e2-14eb-8165-a65a-000cc613e85a
- Needs editor (Claims, database tab): view://3f8273e2-14eb-814f-9cb4-000c76f388d7
- Your queue (Tag decisions, hub page): view://3f8273e2-14eb-81b8-ab1f-000c24bfb2d4
- Needs your note (Tag decisions, hub page): view://3f8273e2-14eb-81c5-bb6a-000cd09c2c9b
- Lessons waiting for the rule owner (Rule changes, hub page): view://3f8273e2-14eb-8119-9dc4-000c8b0e889a
- Latest runs (Runs, hub page): view://3f8273e2-14eb-81ad-a879-000c59dd1cff
- Overruled without a note (Tag decisions, database tab): view://3f8273e2-14eb-81fe-a7fb-000cef057369
- Easy rows first (Tag decisions, database tab): view://3f8273e2-14eb-8146-8e53-000ce9aaa6d0
- Waiting for evidence (Tag decisions, database tab): view://3f8273e2-14eb-81a4-be9c-000cddfa4aaf
- Second opinion (Tag decisions, database tab): view://3f8273e2-14eb-810f-b384-000c5c28d906
- By claim (Tag decisions, database tab): view://3f8273e2-14eb-816d-94f1-000ce2224598
- Handed on: needs evidence or a second opinion (Tag decisions, hub page): view://3f8273e2-14eb-81c9-b9cb-000c5063e1d3

## Walkthrough sandbox (14 October 2026)

The page **Walkthrough** (3f9273e214eb81c2a075fd94e339d40e) under the hub holds a separate copy of the six databases in its sub-page **Sandbox databases** (3f9273e214eb817f8dd1cd336e2e6ab9). Each was created with the statements above in their final form (every later `ALTER COLUMN ... COMMENT` folded into the `CREATE TABLE`, the `ADD COLUMN` formulas and rollups added afterwards in the same order), with three differences: relations point at the sandbox data sources; the Rule changes `Lesson ID` prefix is **WT** (Notion refuses a second `LS` prefix in the workspace); and a few descriptions say "walkthrough" or "copied from the trial" instead of the 9 Oct audit. The scripts reach it through `agents/claim-tagger/sandbox/config.json` and `scripts/sandbox.mjs`.

| Database | database id | data source id |
|---|---|---|
| Rulebook | 32d9cf20624c49dd82e381e035092b8a | 4ad48d6f-cc91-417e-b780-5db4bcd0d1a6 |
| Claims | 5e8b5f36885f4d60a8951255aeec086b | 755397bf-906c-4d60-9f05-fcd46f67c22d |
| Tag decisions | 8483669142a04204a1d82ef8e7f511b5 | ab0b0930-3d8f-4ce7-9491-904b25272f27 |
| Rule changes | a9fb71b6896843afa4d8994414233562 | 43614e6d-9d8c-4e0e-b1f5-26311eb03194 |
| Runs | 3be370cd6657424786b9d942b2583b31 | 737d2036-0e9f-4cbb-871f-0755d665d706 |
| Agent settings | 86ede9c7e6764512a8a5e85ca88f1340 | 7e81475a-37b7-471a-87a5-bcebd6b304b7 |

Views, all inline on the Walkthrough page (configure strings as in the hub views above unless noted):

- Your queue (Tag decisions): view://3f9273e2-14eb-8195-bec9-000c6a4c800f
- Needs your note (Tag decisions): view://3f9273e2-14eb-81c7-9e5a-000c3b4d40b0
- Your decisions (Tag decisions), new: `FILTER "Tag outcome" IS NOT EMPTY; SORT BY "Key" ASC; SHOW "Key", "Claim text", "Tag name", "Tag outcome", "Why wrong", "Your reasoning", "Direction", "Stage", "Lesson", "In regression suite", "Agent follow-up"; WRAP CELLS true`: view://3f9273e2-14eb-81b3-a923-000cab8d9f9a
- Lessons waiting for the rule owner (Rule changes, the Owner action form): view://3f9273e2-14eb-8177-beee-000c6177b251
- Latest runs (Runs, with "Lesson"): view://3f9273e2-14eb-81d3-92fa-000c8d5e4b90
- Rulebook in force (Rulebook), new: `SORT BY "Tag title" DESC; SHOW "Tag title", "When to use", "Rule version", "Changed by"; WRAP CELLS true`: view://3f9273e2-14eb-816e-9c65-000c7f091240

Later the same day (editor feedback: claim text first, a view of the claims): the three Tag decisions views were reordered with `SHOW "Claim text", "Tag name", ..., "Key"` (Key last; Your queue keeps `FREEZE COLUMNS 1` on Claim text), Your decisions sorts by Claim text, and a seventh view was added:

- The 13 claims (Claims): `SORT BY "Claim title" ASC; SHOW "Claim title", "Decided applies", "Agent tags", "Readiness", "Tag confidence", "Last judged"; WRAP CELLS true`: view://3f9273e2-14eb-81a0-bfeb-000cc0f0089b

Restructure for first-time editors (same day): every column of the six sandbox data sources got a plain-language description (`ALTER COLUMN "<name>" SET <same type> COMMENT '...'`, one statement per column, types, options, formulas and DUAL relations restated unchanged; Notion keeps option ids and the relation pair; descriptions are capped at 280 characters). A sandbox pull afterwards showed 13 queue rows, all linked to claim and tag, drift 0. These descriptions differ from the trial's on purpose (written for someone new to the loop). Six full-table views were added on the Walkthrough page, one per data source, every column shown:

- Claims (full table): view://3f9273e2-14eb-8158-aa8d-000cca8bd82b
- Tag decisions (full table): view://3f9273e2-14eb-8184-898e-000c5a798a71
- Rulebook (full table): view://3f9273e2-14eb-8196-8b6e-000c0f8cb5db
- Rule changes (full table): view://3f9273e2-14eb-817c-b382-000c9943532e
- Runs (full table): view://3f9273e2-14eb-81b5-89bc-000cddd63baa
- Agent settings (full table): view://3f9273e2-14eb-813f-a8a8-000c252c6a3c

The page itself is now: table of contents; four toggle sections (1 ideas, 2 the six tables with a column guide and the full view each, 3 steps 1 to 8 each with Before / Do / What happens / After and the relevant small views, 4 help).

Layout fix (same day, editor feedback with screenshots): tables nested in toggle headings render narrow, so parts 2 and 3 now use plain headings and all 13 inline views sit at the page's top level; only text folds (column guides and examples as toggles; parts 1 and 4 stay toggle headings). The page's Full width setting cannot be set through the connector; the callout asks the reader to turn it on.

View columns aligned with the walkthrough text (every column a step names is shown in that step's view): The 13 claims adds "Decided does not apply"; Your queue adds "Stage", "Direction"; Your decisions adds "Effective outcome", "Lesson status", "Follow-up run".
- Fill in here: your 4 rows (Tag decisions, step 3, directly under the suggested values): `FILTER "Tag" = <Predictive Rulebook page 3f9273e2-14eb-8199-8d52-e51b2aecc7d5>; FILTER "Seeded outcome" IS EMPTY; SORT BY "Key" ASC; SHOW "Claim text", "Tag outcome", "Why wrong", "Your reasoning", "Stage", "Agent proposal", "Agent confidence"; WRAP CELLS true; FREEZE COLUMNS 1`: view://3f9273e2-14eb-81ee-9223-000c28868724. Sorting by Key gives a fixed order (Iran, expand, uphold, Texas) that the suggested-values table above it repeats, numbered 1 to 4.
