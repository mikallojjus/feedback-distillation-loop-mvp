# Engineer answers to the Editor, round 1

Answers assume the current fixes.

## 1. Changing a Tag outcome later

- **The test** is rebuilt from your decisions at the next run, so it expects your new answer. Needs evidence or Ask another editor switches it off. No tag fits or Other gives no test. Rule unclear or Rule should change makes it wait for a lesson. "In regression suite" is then cleared.
- **The lesson** is not redrafted. It still lists your row but is tested against your new answer. If you no longer support it, tell the rule owner.
- **Agent follow-up** stays until that lesson's follow-up runs again.
- Changing a row while the agent writes to it pauses the agent until an engineer checks; nothing is lost.

## 2. Can a rule change without the owner?

Nothing reaches the Rulebook without a gate PASS on exactly the text that was tested. After the fix, no plan can fake a PASS.

The agent checks that Status says Approved, but not who set it or whether Approved by is filled. Anyone with edit access can change Status and Editor wording. Editing the wording starts nothing; the next promote tests the wording as it stands then.

I recommend promote refuse an empty Approved by, and that only the rule owner touch these fields.

## 3. What a FAIL card means

Nothing changed: the old rule stays, and the lesson stays Approved with its Gate result. Ignore the Rollback line; it is being removed.

- Keep deciding by the written rule. Where you disagree, use Rule should change with one sentence.
- Decided rows are never re-queued. They are tests, and a change that contradicts one fails the gate.
- If a card names your row as newly failing and you agree with the new rule, change that decision. That unblocks the change.
- After a change goes live, only undecided rows whose proposal flips come back as Rule changed.

## 4. Waiting for evidence and Second opinion

Nothing routes these rows: the agent reads no sources, assigns no one, and only the Default view under Databases lists them. A row moves on only when an editor sets Applies or Does not apply. A second editor simply overwrites Tag outcome.

The team should name who handles each and add a hub view.

## 5. Decided at and Decided by

Tag outcome alone moves the row, but please set Decided at. After a lesson is rejected, the agent drafts another on that rule only from rows decided later, and it reads that date from Decided at. Decided by is for people only.

## 6. Why only some decided rows have In regression suite

Only rows that are live tests get the date:

- Rule unclear and Rule should change rows wait for their lesson.
- No tag fits and Other make no test.
- A seeded Unsourced row belongs to a research suite.
- Rows decided since the last run (f4d50e38cf, fbd881e9ff) get the date at the next run.

One mismatch remains: Improperly sourced and Source inaccessible rows get the date, but the gate never runs them in this trial (4bada81d9d).

## On the orchestrator's answers

Accepted, pending the 404 probe and hook transcript.

- EN-7 is withdrawn: the live Direction already treats Read source first as Open.
- If cli_version stays, the runbook must say a CLI update means restarting a paused promote and re-judging everything (about $4).
- An engineer should watch the first real PASS with the rollback commands ready.
