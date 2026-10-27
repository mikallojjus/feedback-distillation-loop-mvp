# claim-tagger-mvp

The claim tagger with its editor feedback loop, rebuilt as an MVP in October 2026: it tags Geo claims against a numbered rulebook (only Context-dependent has rules so far), queues what it is unsure about in Notion for an editor, turns the editor's decisions into proposed rule changes, and changes the rulebook only after a safety check passes.

- It lives under the Notion page "Claim tagger" (the hub). Claims, its one claims table, holds 200 Geo claims tagged Debate, picked by `scripts/geo-pick.mjs` and seeded by setup; people decide there, and the rulebook learns only from their decisions. The first build (15 to 22 October) is in the hub's archive page, read only.
- Start with `AGENT.md`: the runbook for the engineer (commands, the setup of 27 October with the archive step and the Geo pick, run folders, models, safety, the rulebook, practice pages, tests).
- Editors use the skill `/claim-tagger` (`.claude/skills/claim-tagger/SKILL.md`); `/claim-tagger-walkthrough` builds a practice page under the hub's Onboarding page, for onboarding new editors.
- The working log of the build is `docs/mvp-2026-11/WORKLOG.md`; the current state is `docs/mvp-2026-11/STATE.md`.
- The file shapes every script agrees on are in `docs/mvp-2026-11/CONTRACTS.md`; the Notion layout from 27 October is in `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` and `setup/structure.json` (`docs/mvp-2026-11/STRUCTURE.md` is the approved proposal of 15 October, kept as history).
- The hard rules are in the repository's `CLAUDE.md`. The previous build, `agents/claim-tagger/`, is read-only history.
- Tests: `node --test tests/mvp/` from the repository root.
