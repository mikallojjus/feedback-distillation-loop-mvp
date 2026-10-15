# State

| Item | Value |
|---|---|
| Phase | Stage 0 |
| Checkpoint 1 (structure proposal) | not reached |
| Checkpoint 2 (final demo) | not reached |
| Branch | `mvp-2026-11` |
| Last commit on the branch | none yet |
| Parent Notion page | "Feedback Distillation MVP", 3fa273e214eb805199f3d12ef01db453 |
| Notion ids created by this build | none |
| Artifact | not published |

## Running subagents (model, what each was asked)

| Agent | Model | Asked | Writes |
|---|---|---|---|
| W3 sweep | haiku | Digest `docs/analysis-2026-10/design/W3-code-changes.md`: tables, views, config, scripts, rubric/edition/drift, judge, propose, distill, gate, rollback, status, report rules, settings, milestones, contradictions | `sweeps/W3-digest.md` |
| W4 sweep | haiku | Digest `design/W4-walkthrough-skill.md`: skill, manifest, page template, help pieces, lint, evals, calibration, override paragraph, builder, skill-creator steps | `sweeps/W4-digest.md` |
| Library sweep | haiku | API surface of `agents/claim-tagger/scripts/lib/*.mjs` and the test fakes; CLI invocation; whether createDatabase/views exist | `sweeps/lib-digest.md` |
| Orientation sweep | haiku | Bugs from sweep-A, taxonomy schema and 13 rows, every Notion id, the real claims table's columns, the 9 October audit's location, old prompt and skill, debate leftovers | `sweeps/orientation-digest.md` |
