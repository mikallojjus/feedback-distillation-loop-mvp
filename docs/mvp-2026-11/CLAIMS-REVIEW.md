# Decisions on the claims table (revision of the structure, 2026-10-16)

The product owner asked on 2026-10-16 that editors decide tags on the claims table itself, as they do on the real table, instead of in a separate queue. This note is the specification the code, the Notion structure, the walkthrough and the documents follow. It revises `STRUCTURE.md` (approved on 2026-10-15); the revision was approved in the chat on 2026-10-16 (decision P2).

## 1. The shape

- **Claims copy** is the work surface. The agent writes four columns: Agent tags, Agent notes, Agent confidence (new), Agent reasons (new: one line per judged tag, "<Tag>: <the agent's reason> · <rule cited> · <k> of <n> runs agree", so that the editor deciding in Your queue sees why without opening the ledger), and nothing else. The editor writes four columns, named as on the real table: Claim quality tags — verified (new here; a relation to the Rulebook copy, which stands in for the taxonomy), Review status (new here; select: To review, Reviewed), Why wrong (new; select: Agent slip, Rule unclear, Rule should change), Challenged tags notes (new here; text).
- **Tag decisions** becomes the agent's ledger: one row per claim and tag the agent judged, written and superseded by the agent only. Its columns keep their names; Tag outcome, Why wrong and Your reasoning are now copies the agent makes from the claims table when a claim is Reviewed, and "Decided under" (new, text) records the edition the proposal the editor saw was made under. No editor writes to it. The practice page shows it at the bottom with the other tables and one line of explanation, nothing more.
- **Rule changes**, **Rulebook copy** and **Agent settings** are unchanged.
- **Views.** On the Claims copy: Your queue (Review status is not Reviewed, Agent notes contains "for an editor" and does not contain "nothing waits"; sorted by Agent confidence, lowest first; "nothing waits for an editor" would otherwise match a filter on "waits for an editor"), Needs your note (Why wrong is set and Challenged tags notes is empty; sorted by Agent confidence), Agent disagreed (Agent notes contains "disagrees"; sorted by Agent confidence). On Rule changes: Lessons waiting (unchanged). On the Rulebook copy: Rulebook (unchanged). The two old views on Tag decisions are renamed "Your queue (ledger)" and "Needs your note (ledger)" and left in place; nothing is deleted.

## 2. How a decision is read

A claim is decided when Review status is Reviewed. For every tag the agent judged on that claim:

- Outcome = Applies when the tag is in Claim quality tags — verified, else Does not apply.
- Why wrong is the claim's Why wrong (one value per claim; it applies to every judged tag whose outcome differs from the agent's proposal; a tag the agent got right carries no Why wrong).
- Your reasoning is taken from Challenged tags notes: when the notes hold lines that start with a tag name and a colon ("Context-dependent: …"), each tag gets its own line; otherwise the whole text applies to every tag whose outcome differs from the proposal.
- Decided under = the edition recorded in the ledger row's proposal at the time of the sync; empty for the ten audit decisions, which carry no edition.

A claim with Review status empty or To review has no decision; its judged tags are open. The agent never writes Review status, Claim quality tags — verified, Why wrong or Challenged tags notes (hard rule 1), with the two exceptions below.

## 3. What each command does now

- **pull** reads the four editor columns of the claims (the relation resolved to tag names through the Rulebook copy's page ids) and the ledger, and writes them to `norm/claims.jsonl` and `norm/queue.jsonl` as today. It reads only.
- **judge** is unchanged.
- **propose** (the tag step) writes, through one plan: on every judged claim Agent tags, Agent notes, Agent confidence and Agent reasons; in the ledger a row per judged claim and tag (create when missing, update when the proposal, confidence, reason or edition changed), and on Reviewed claims the copied decision (Tag outcome, Why wrong, Your reasoning, Decided under). A proposal that differs from a Reviewed decision is never applied to Agent tags: the editor's set wins there, and Agent notes line 2 says "disagrees with your decision on <tag>". Agent confidence is the lowest confidence among the claim's judged tags (0.5 to 1).
  - A claim whose Review status is "To review" waits for the editor on every judged tag, whatever the confidence (none is written to Agent tags, Agent notes line 2 counts it in "<n> wait(s) for an editor", Agent reasons and Agent confidence are written as usual); a claim with Review status empty waits only on a tag the agent could not tell; a Reviewed claim never waits. So a claim that QA marks To review on the real table lands in Your queue on the next run.
  - Agent notes stays two lines. Line 1: the tags that apply (the editor's verified set where Reviewed, else the agent's), or "no tags". Line 2: "<n> wait(s) for an editor" or "nothing waits for an editor", then "disagrees with your decision on <tags>" when it does, then "not checked: …" as today, then "edition <e>".
- **distill** first brings the ledger's copies up to date from the claims (the same copy the tag step makes, ledger columns only), so an editor who decides and types distill without a tag run in between is not told that nothing is decided; then it reads the ledger rows with Why wrong Rule unclear or Rule should change, as today.
- **promote** takes the earlier decisions from the ledger rows with Tag outcome set, as today; the supporting rows are ledger rows. The follow-up marks the ledger's Follow-up and rewrites Agent tags and Agent notes of those claims.
- **followup**, **rollback**, **restore**: unchanged apart from the column names they already use.
- **status** counts the rows that wait from the claims (Agent notes says "<n> wait(s) for an editor" and Review status is not Reviewed) and the lessons waiting as today; its Next line links Your queue on the Claims copy.
- **setup**: `structure.json` gains the three new claims columns, Decided under on the ledger, and the three claims views; a new step `migrate-decisions` carries the twelve existing Tag decisions rows over once: for the ten audit decisions it sets, on the claim's row, Claim quality tags — verified (the Applies ones), Review status Reviewed, Why wrong Agent slip and Challenged tags notes "From the audit of 9 October: …" (the one-time seeding exception of hard rule 1, marked by that prefix), and Decided under on the ledger row; for the two open rows it writes Agent confidence on the claims. `setup verify` compares the revised structure.
- **Plan check and guard.** Editor columns are now, per table: claims_copy Claim quality tags — verified, Review status, Why wrong, Challenged tags notes; rule_changes Editor wording and the Status values Approved and Rejected; agent_settings Paused. Tag decisions has no editor column. The seeding exception (setup, or a practice page's build) and the practice-page exception (decision D31: `decide` on a practice page updates the claims' editor columns; `approve` and `reject` as today) are the only paths that write them.

## 4. The practice page

- The Claims table of a practice page carries the Geo columns, the four agent columns and the four editor columns; the five decided claims are created Reviewed, with Claim quality tags — verified set for the Applies ones, Why wrong Agent slip and Challenged tags notes "From the audit of 9 October: …"; the two open claims are created with Review status To review and the editor's columns empty. Tag decisions is created with the ledger rows for the five decided claims (the pre-audit proposal, the outcome, Decided under empty as the audit gave no edition) and nothing for the two open claims until the tag step runs.
- Step 3 happens in Your queue on the Claims table: the editor sets Claim quality tags — verified (the AI Force row gets Context-dependent, the press pool row stays empty), Review status Reviewed, Why wrong Rule unclear and Challenged tags notes with the sentence the page gives. `walkthrough.mjs decide --claim <key>` does the same on a practice page.
- The linked view in step 3 is Your queue on the Claims table; step 5 keeps Lessons waiting. The tables section lists the five tables; Tag decisions gets one line: "the agent's own record of each decision; nothing to do here". The page never explains the ledger further.
- The manifest's `decided` and `open` entries describe the claims' columns; `expect` gains the Claims views.

## 5. Documents

CLAUDE.md hard rule 1 (the editor-owned fields by table), `STRUCTURE.md` (a revision section pointing here; the approved text stays as history), `CONTRACTS.md`, `AGENT.md`, the two skills and their references, `DECISIONS.md` (P2 and the decisions below), `BACKLOG.md` (the refresh job must preserve the four editor columns and Agent confidence on the real table), the artifact's Status, How to run and Structure tabs.

## 6. Feedback round of 21 October (decision P3)

The product owner tested the practice page and asked for seven changes; they revise sections 1 to 4 as follows.

### 6.1 The claims table's columns

The agent writes seven columns, all its own: Agent tags (now a relation to the Rulebook table, several tags at once), Agent confidence (number), Agent reasons (text, one line per judged tag), Agent status (select: "Waits for you", "Done", "Disagrees with your decision", "Could not read"), Tags waiting (a relation to the tags that wait for the editor), Agent edition (text, the edition the row was written under), Agent remarks (text: the "not checked: …" remark, else empty). Agent notes is retired: on the live copy it is renamed "Agent notes (old)" and hidden in every view; a practice page does not create it. On the live copy the text column Agent tags is renamed "Agent tags (old)" and hidden, and a relation named Agent tags is added, because a column's type cannot be changed in place; the next tag run fills it.

The editor writes four columns: Verified tags (the relation; the config maps it, so the real table's "Claim quality tags — verified" needs only a config change later), Review status, Why wrong, Challenged tags notes.

Column order, set on the table's default view and on every view of the table: Geo Name, Agent tags, Agent confidence, Agent reasons, Agent status, Tags waiting, Agent edition, Agent remarks, Verified tags, Review status, Why wrong, Challenged tags notes, then the Geo columns. The review needs no horizontal scrolling.

### 6.2 Agent status and the views

- Agent status is "Waits for you" when any judged tag of the claim waits (an unsure tag, or any tag on a claim marked To review) and the claim is not Reviewed; "Disagrees with your decision" when the claim is Reviewed and the agent's proposal differs from the editor's verified set; "Could not read" when the judge could not read the claim; else "Done". A decided claim keeps "Waits for you" until the next tag run reads the decision: that is intended, so that the row does not vanish from Your queue the moment Review status is set (the product owner's point 5).
- Your queue: Agent status is "Waits for you"; sorted by Agent confidence, lowest first. It no longer filters on Review status. Agent disagreed: Agent status is "Disagrees with your decision". Needs your note: Why wrong is set and Challenged tags notes is empty. The page and the reports say that a decided claim leaves Your queue at the agent's next tag run.
- status and propose count "N wait for you" as the claims with Agent status "Waits for you" whose Review status is not Reviewed (what is still to decide); the view may show a few more, the decided ones awaiting the next run.

### 6.3 The note convention for several tags

A line of Challenged tags notes starts with a tag name and a colon. It may start with a reason word (Agent slip, Rule unclear, Rule should change) followed by a full stop, which overrides Why wrong for that tag; without one the tag takes the claim's Why wrong. A tag the editor agrees with needs no line; a note with no tag name applies to every tag the agent got wrong. The ledger copy stores the per-tag reason in its Why wrong and the line in Your reasoning. With one tag judged the whole note belongs to that tag, as today.

### 6.4 The practice page and the skills

- Step 3's Doing the work is a numbered list per claim, one column per line, the sentence to paste on its own line, Review status last only because it closes the claim (the row stays in Your queue until the next tag run).
- The claim-tagger skill guides as the walkthrough does: after each report, when the Next line sends the editor to Notion, the skill adds a checklist of at most five lines (which view to open, which columns to fill in which order, what to look at) and names the next command, from one reference file (`references/guide.md`) shared in wording by the practice page; the report itself stays three parts and is relayed verbatim first. The same for the demo commands.
- The practice page's step tables and the structure document show the new columns.

### 6.5 The live step

`setup.mjs build` (idempotent): rename the two text columns with "(old)", add the five new columns (Agent tags relation, Agent status, Tags waiting, Agent edition, Agent remarks), rename "Claim quality tags — verified" to "Verified tags", set the column order and visible columns on the default view and the three views, change Your queue's filter; then one tag run fills the agent's columns; `setup.mjs verify` compares.

## 7. Read the decisions (decision P4, 2026-10-21)

Why wrong leaves the editor's work. The agent reads every disagreement itself, per tag, as Agent slip, Rule unclear or Rule should change, and distill drafts from those readings; a reason word at the start of a note line still overrides the reading for that tag. The editor's columns on the claims table are Verified tags, Challenged tags notes and Review status; the live copy keeps the old column hidden as "Why wrong (old)" and practice pages do not create it. The practice page gets four open claims on one tag. The specification, the stages, the verification loop and decisions 64 to 76 are in `READ-DECISIONS.md`; sections 1 to 6 above stay as the history they describe.
