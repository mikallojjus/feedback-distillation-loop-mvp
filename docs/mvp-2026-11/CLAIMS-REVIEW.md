# Decisions on the claims table (revision of the structure, 2026-10-16)

The product owner asked on 2026-10-16 that editors decide tags on the claims table itself, as they do on the real table, instead of in a separate queue. This note is the specification the code, the Notion structure, the walkthrough and the documents follow. It revises `STRUCTURE.md` (approved on 2026-10-15); the revision was approved in the chat on 2026-10-16 (decision P2).

## 1. The shape

- **Claims copy** is the work surface. The agent writes four columns: Agent tags, Agent notes, Agent confidence (new), and nothing else. The editor writes four columns, named as on the real table: Claim quality tags — verified (new here; a relation to the Rulebook copy, which stands in for the taxonomy), Review status (new here; select: To review, Reviewed), Why wrong (new; select: Agent slip, Rule unclear, Rule should change), Challenged tags notes (new here; text).
- **Tag decisions** becomes the agent's ledger: one row per claim and tag the agent judged, written and superseded by the agent only. Its columns keep their names; Tag outcome, Why wrong and Your reasoning are now copies the agent makes from the claims table when a claim is Reviewed, and "Decided under" (new, text) records the edition the proposal the editor saw was made under. No editor writes to it. The practice page shows it at the bottom with the other tables and one line of explanation, nothing more.
- **Rule changes**, **Rulebook copy** and **Agent settings** are unchanged.
- **Views.** On the Claims copy: Your queue (Review status is not Reviewed, and Agent notes contains "waits for an editor"; sorted by Agent confidence, lowest first), Needs your note (Why wrong is set and Challenged tags notes is empty), Agent disagreed (Agent notes contains "disagrees"). On Rule changes: Lessons waiting (unchanged). On the Rulebook copy: Rulebook (unchanged). The two old views on Tag decisions are renamed "Your queue (ledger)" and "Needs your note (ledger)" and left in place; nothing is deleted.

## 2. How a decision is read

A claim is decided when Review status is Reviewed. For every tag the agent judged on that claim:

- Outcome = Applies when the tag is in Claim quality tags — verified, else Does not apply.
- Why wrong is the claim's Why wrong (one value per claim; it applies to every judged tag whose outcome differs from the agent's proposal; a tag the agent got right carries no Why wrong).
- Your reasoning is taken from Challenged tags notes: when the notes hold lines that start with a tag name and a colon ("Context-dependent: …"), each tag gets its own line; otherwise the whole text applies to every tag whose outcome differs from the proposal.
- Decided under = the edition recorded in the ledger row's proposal at the time of the sync.

A claim with Review status empty or To review has no decision; its judged tags are open. The agent never writes Review status, Claim quality tags — verified, Why wrong or Challenged tags notes (hard rule 1), with the two exceptions below.

## 3. What each command does now

- **pull** reads the four editor columns of the claims (the relation resolved to tag names through the Rulebook copy's page ids) and the ledger, and writes them to `norm/claims.jsonl` and `norm/queue.jsonl` as today. It reads only.
- **judge** is unchanged.
- **propose** (the tag step) writes, through one plan: on every judged claim Agent tags, Agent notes and Agent confidence; in the ledger a row per judged claim and tag (create when missing, update when the proposal, confidence, reason or edition changed), and on Reviewed claims the copied decision (Tag outcome, Why wrong, Your reasoning, Decided under). A proposal that differs from a Reviewed decision is never applied to Agent tags: the editor's set wins there, and Agent notes line 2 says "disagrees with your decision on <tag>". Agent confidence is the lowest confidence among the claim's judged tags (0.5 to 1).
  - Agent notes stays two lines. Line 1: the tags that apply (the editor's verified set where Reviewed, else the agent's), or "no tags". Line 2: "<n> wait(s) for an editor" or "nothing waits for an editor", then "disagrees with your decision on <tags>" when it does, then "not checked: …" as today, then "edition <e>".
- **distill** reads the ledger rows with Why wrong Rule unclear or Rule should change, as today.
- **promote** takes the earlier decisions from the ledger rows with Tag outcome set, as today; the supporting rows are ledger rows. The follow-up marks the ledger's Follow-up and rewrites Agent tags and Agent notes of those claims.
- **followup**, **rollback**, **restore**: unchanged apart from the column names they already use.
- **status** counts the rows that wait from the claims (Agent notes contains "waits" and Review status is not Reviewed) and the lessons waiting as today; its Next line links Your queue on the Claims copy.
- **setup**: `structure.json` gains the three new claims columns, Decided under on the ledger, and the three claims views; a new step `migrate-decisions` carries the twelve existing Tag decisions rows over once: for the ten audit decisions it sets, on the claim's row, Claim quality tags — verified (the Applies ones), Review status Reviewed, Why wrong Agent slip and Challenged tags notes "From the audit of 9 October: …" (the one-time seeding exception of hard rule 1, marked by that prefix), and Decided under on the ledger row; for the two open rows it writes Agent confidence on the claims. `setup verify` compares the revised structure.
- **Plan check and guard.** Editor columns are now, per table: claims_copy Claim quality tags — verified, Review status, Why wrong, Challenged tags notes; rule_changes Editor wording and the Status values Approved and Rejected; agent_settings Paused. Tag decisions has no editor column. The seeding exception (setup, or a practice page's build) and the practice-page exception (decision D31: `decide` on a practice page updates the claims' editor columns; `approve` and `reject` as today) are the only paths that write them.

## 4. The practice page

- The Claims table of a practice page carries the eight columns; the five decided claims are created Reviewed, with Claim quality tags — verified set for the Applies ones, Why wrong Agent slip and Challenged tags notes "From the audit of 9 October: …"; the two open claims are created with Review status To review and the editor's columns empty. Tag decisions is created with the ledger rows for the five decided claims (the pre-audit proposal, the outcome, Decided under empty as the audit gave no edition) and nothing for the two open claims until the tag step runs.
- Step 3 happens in Your queue on the Claims table: the editor sets Claim quality tags — verified (the AI Force row gets Context-dependent, the press pool row stays empty), Review status Reviewed, Why wrong Rule unclear and Challenged tags notes with the sentence the page gives. `walkthrough.mjs decide --claim <key>` does the same on a practice page.
- The linked view in step 3 is Your queue on the Claims table; step 5 keeps Lessons waiting. The tables section lists the five tables; Tag decisions gets one line: "the agent's own record of each decision; nothing to do here". The page never explains the ledger further.
- The manifest's `decided` and `open` entries describe the claims' columns; `expect` gains the Claims views.

## 5. Documents

CLAUDE.md hard rule 1 (the editor-owned fields by table), `STRUCTURE.md` (a revision section pointing here; the approved text stays as history), `CONTRACTS.md`, `AGENT.md`, the two skills and their references, `DECISIONS.md` (P2 and the decisions below), `BACKLOG.md` (the refresh job must preserve the four editor columns and Agent confidence on the real table), the artifact's Status, How to run and Structure tabs.
