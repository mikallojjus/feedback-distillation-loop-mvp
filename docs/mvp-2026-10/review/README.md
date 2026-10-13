# Persona reviews of the MVP

Two reviewers with fresh context read the MVP after the demo storyline has run: an **Editor persona** (Fable 5.1), who reads only what an editor sees (the Notion hub, Your queue, Needs your note, Lessons waiting, Live rules, Latest runs, one gate card, the Rulebook row of the changed tag, Agent settings; later the artifact's Plain layer) and writes only editor-owned fields; and an **Engineer persona** (Opus 5.5), who reads the repository, the Engineer notes page, the six database schemas, the run cards and these dispositions (later the artifact's Technical layer).

## Files

- `persona-editor-r1.md`, `persona-engineer-r1.md`: round-1 findings and questions for the other persona.
- `persona-editor-r1-answers.md`, `persona-engineer-r1-answers.md`: each persona's answers to the other's questions, relayed by the orchestrator.
- `dispositions.md`: one row per finding.
- `persona-editor-r2.md`, `persona-engineer-r2.md`: round-2 re-check against the dispositions and an acceptance statement.
- `../evidence/persona-editor-actions.json`: every Notion write the Editor persona made (row, field, before, after, when).

## Disposition format

| ID | Source | Severity | Finding | Decision | Change made | Where |
|---|---|---|---|---|---|---|
| ED-1 | editor, r1 | must / should / nice | one sentence | Fixed / Answered / Declined: reason / Deferred: who, when | what changed | path, Notion URL or artifact tab |

IDs: ED-n editor findings, EN-n engineer findings, Q-n questions, HL-n headless-test findings.

## Acceptance

1. No must-fix finding open; every finding has a decision.
2. Both round-2 statements say "clear" for their audience; the editor's one-line meanings of every Stage and Why wrong value match the column comments; the engineer can resume and roll back from Engineer notes alone (dry run).
3. The headless test passes (the status and tag dry-run sessions of 13 October did; the guard-hook headless test is a manual step recorded in ../evidence/README.md).
4. The artifact build checks are clean.
5. The demo end state holds (see `../plan.md`, "The demo storyline").
