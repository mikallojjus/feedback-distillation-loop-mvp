# claim-tagger-mvp

The claim tagger with its editor feedback loop, rebuilt as an MVP in October 2026: it tags Geo claims against a numbered rulebook (only Context-dependent has rules so far), queues what it is unsure about in Notion for an editor, turns the editor's decisions into proposed rule changes, and changes the rulebook only after a safety check passes.

- It lives under the Notion page "Claim tagger v2" (the hub), a sub-page of the first page "Claim tagger". Editors decide on Tag decisions, one row per claim and tag: they tick Agent is right or set Tag outcome, and may add Your note in plain words. Claims holds the Geo claims with the agent's summary of each and is read only. The rulebook learns only from the editors' decisions. The first page and its tables, copied into v2 on 30 October, stay in Notion as they were, read only; the per-claim version of the code is the git tag `claim-tagger-v1`.
- Start with `AGENT.md`: the runbook for the engineer (commands, the v2 page with the copy and the config swap, run folders, models, safety, the rulebook, tests; the per-claim setup of 27 October as history).
- Editors use the skill `/claim-tagger` (`.claude/skills/claim-tagger/SKILL.md`). The practice pages and `/claim-tagger-walkthrough` are parked: they run on the git tag `claim-tagger-v1`.
- The working log of the build is `docs/mvp-2026-11/WORKLOG.md`; the current state is `docs/mvp-2026-11/STATE.md`; the night that made v2 the default is `docs/mvp-2026-11/OVERNIGHT.md`.
- The file shapes every script agrees on are in `docs/mvp-2026-11/CONTRACTS.md`; the Notion layout is in `docs/mvp-2026-11/STRUCTURE-V2.md` and `setup/structure.json`, and the port of the loop to it in `docs/mvp-2026-11/PORT-V2.md`.
- The hard rules are in the repository's `CLAUDE.md`. The previous build, `agents/claim-tagger/`, is read-only history.
- Tests: `node --test tests/mvp/` from the repository root.
