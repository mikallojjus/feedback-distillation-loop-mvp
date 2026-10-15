# claim-tagger-mvp

The claim tagger with its editor feedback loop, rebuilt as an MVP in October 2026: it tags Geo claims against a numbered rulebook (only Context-dependent has rules so far), queues what it is unsure about in Notion for an editor, turns the editor's decisions into proposed rule changes, and changes the rulebook only after a safety check passes.

- Start with `AGENT.md`: the runbook for the engineer (commands, setup as it was run, run folders, models, safety, the rulebook, practice pages, tests).
- Editors use the skill `/claim-tagger` (`.claude/skills/claim-tagger/SKILL.md`); `/claim-tagger-walkthrough` builds a practice page.
- The working log of the build is `docs/mvp-2026-11/WORKLOG.md`; the current state is `docs/mvp-2026-11/STATE.md`.
- The file shapes every script agrees on are in `docs/mvp-2026-11/CONTRACTS.md`; the Notion tables are in `docs/mvp-2026-11/STRUCTURE.md`.
- The hard rules are in the repository's `CLAUDE.md`. The previous build, `agents/claim-tagger/`, is read-only history.
- Tests: `node --test tests/mvp/` from the repository root.
