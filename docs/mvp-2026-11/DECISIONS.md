# Decisions taken alone between checkpoints

One line of reason each. The product owner's decisions D1 to D35 live in `docs/analysis-2026-10/DECISIONS.md` and are not repeated here.

| # | Decision | Reason |
|---|---|---|
| 1 | The untracked inputs (`docs/analysis-2026-10/`, `MVP-PROMPT.md`, `.claude/agents/editor-persona.md`) are committed as the branch's first commit. | A session that loses its context must find the brief and the designs in git, not only on disk. |
| 2 | Haiku sweep digests are written to `docs/mvp-2026-11/sweeps/` and only summarised back. | The digests replace reading the 180 KB of designs and survive context loss. |
| 3 | There is no unpause command and no `--unpause` flag anywhere. | Hard rule 7: a person clears Paused and `runs/PAUSED`; the agent never does, so nothing needs an allow rule. |
| 4 | `rollback` and `restore` are separate scripts listed only under `ask` in the settings; every other script is allowed by name. | Bash allow rules match a prefix, so a dangerous flag on an allowed script could never ask; separate scripts can. |
