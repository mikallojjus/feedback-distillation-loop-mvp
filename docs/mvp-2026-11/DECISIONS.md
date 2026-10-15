# Decisions taken alone between checkpoints

One line of reason each. The product owner's decisions D1 to D35 live in `docs/analysis-2026-10/DECISIONS.md` and are not repeated here.

| # | Decision | Reason |
|---|---|---|
| 1 | The untracked inputs (`docs/analysis-2026-10/`, `MVP-PROMPT.md`, `.claude/agents/editor-persona.md`) are committed as the branch's first commit. | A session that loses its context must find the brief and the designs in git, not only on disk. |
| 2 | Haiku sweep digests are written to `docs/mvp-2026-11/sweeps/` and only summarised back. | The digests replace reading the 180 KB of designs and survive context loss. |
| 3 | There is no unpause command and no `--unpause` flag anywhere. | Hard rule 7: a person clears Paused and `runs/PAUSED`; the agent never does, so nothing needs an allow rule. |
| 4 | `rollback` and `restore` are separate scripts listed only under `ask` in the settings; every other script is allowed by name. | Bash allow rules match a prefix, so a dangerous flag on an allowed script could never ask; separate scripts can. |
| 5 | Settings: the new folder's read and loop scripts are allowed by name; `setup`, `rollback` and `restore` are under ask; the old folder's writer scripts are denied; connector tools are listed under both server names (`claude_ai_notion` and this session's id). | Setup is a one-time structural write that could never be undone (hard rule 8); the connector's server name differs between sessions. |
| 6 | The guard's registry of builder-created pages and tables lives in `runs/builder/`, not `runs/setup/`. | Windows paths are case-insensitive: `runs/setup/` would collide with the `runs/SETUP` marker (found by the guard's own test). |
| 7 | Connector writes are allowed only while `runs/SETUP` exists and only on registered targets: content pages (the proposal, practice pages) go through the connector; tables, rows and views go through the REST client. | Rich page content is a connector strength; rows and tables stay under the plan-and-apply rule. |
| 8 | The copy's relations: one dual relation between the Claims copy's "Claim quality tags — verified" and the Rulebook copy's "U.S. Politics debate claims"; "World affairs debate claims" and "Editors challenging the QA tags" are left out. Shown as a deviation in the structure proposal. | A relation must point at a table; the World affairs and editors tables have no copy and are protected. |
