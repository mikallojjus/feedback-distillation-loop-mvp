# geo-agents

Agents of the Geo content team, one folder per agent. The first agent is the **claim tagger with its editor feedback loop** (`agents/claim-tagger/`), built as an MVP in October 2026 from the overnight research "Learning from editor feedback".

## Install

1. Node 22 or later (built with Node 26). No npm dependencies: `npm test` runs `node --test tests/`.
2. Claude Code on the subscription. The headless judge uses `claude -p` with a pinned model; no API key.
3. A Notion integration token for scripted reads and writes: copy `.env.example` to `.env` and set `NOTION_TOKEN=...`. The integration must be connected to the Notion page "Editorial feedback loop" (page → ⋯ → Connections). Without a token the scripts refuse to write: `apply.mjs` exits 2 and leaves the batch files in `runs/<id>/batches` for a connector apply, which is not part of the skill (the skill stops and reports).
4. Open Claude Code in this folder. The skill `/claim-tagger` is discovered from `.claude/skills/`; the first interactive session asks you to trust the folder, after which `.claude/settings.json` (the allow rules for the scripts and the guard hook) applies.
5. Headless use (`claude -p`): a folder never opened interactively is untrusted, so pass the settings explicitly, and in Git Bash stop MSYS from rewriting the leading slash of the skill name:

   ```
   MSYS_NO_PATHCONV=1 claude -p "/claim-tagger status" --settings .claude/settings.json --permission-mode acceptEdits --output-format stream-json --verbose
   ```

   Permission rules for Bash match whole words, so the settings list one rule per script (`Bash(node agents/claim-tagger/scripts/status.mjs:*)` and so on); a command chained with `;` or `&&` is denied, by design.

## The daily loop (editor's view)

```
/claim-tagger status            what is the rubric in force, is the agent paused, what waits for whom
/claim-tagger tag               judge the claims, fill the queue
   ... editors decide rows in "Your queue" on the Notion page ...
/claim-tagger distill           turn decisions into proposed rule changes (Lessons waiting)
   ... the rule owner sets Approved or Rejected ...
/claim-tagger promote LS-1      gate the approved change; PASS goes live, HOLD/FAIL changes nothing
/claim-tagger follow-up LS-1    re-check the claims behind a live change (Fixed / Still wrong)
```

Plain words also work: "run this week's tagging loop, keep it small, tell me what's waiting for me".

## If something stops

Scripts run from the repository root as `node agents/claim-tagger/scripts/<name>.mjs ...`; the table writes just `<name>.mjs ...`. `status.mjs` lists everything unfinished with the command that continues it. Waiting loses nothing: finished judgments are kept (a resume judges only what is missing), and every write is read back from Notion.

| What you see | What to type |
|---|---|
| A judge or promote command ends with exit 75 (the Claude usage window ran out) | When the window reopens, the resume command it printed: `judge.mjs --resume --run-id <id>`, or for a gate run `promote.mjs --lesson "<lesson>" --resume --run-id <id>`. A judge resume needs nothing else: the run remembers its own arguments. |
| You killed a judge or promote run half way, or the machine went down | The same resume command. `status.mjs` shows it under "Unfinished". |
| promote refuses: "run `<id>` holds the promote lock" | That run is still going or was killed. Continue it with `promote.mjs --lesson "<lesson>" --resume --run-id <id>`; to drop it, `promote.mjs --abort <id>` (or delete `runs/PROMOTE.lock`). |
| `apply.mjs` ends with exit 1 (some ops did not land) | `apply.mjs --run <id> --retry`. It reads Notion again before it sends anything, so a row whose create was cut off but landed is updated, not created twice. |
| `apply.mjs` ends with exit 5 (an editor field changed while the agent wrote; the agent paused itself) | Read `runs/PAUSED` and look at the row in Notion, then `status.mjs --unpause --confirm`. Only a person does this. |
| `status.mjs` says PROMOTING (a gate PASS is waiting) | `plan.mjs check --run <id>`, `apply.mjs --run <id>`, then `promote.mjs --finalize <id>`. To give up instead: `promote.mjs --abort <id>`. |
| A Live lesson has to be reverted | `pull.mjs --all`, then `promote.mjs --rollback <lesson> --confirm`, then `plan.mjs check --run <id>` and `apply.mjs --run <id>` for the plan it wrote, and commit `rubric/` and `evals/`. |
| `status.mjs` reports drift (the Rulebook in Notion differs from `rubric.json`) | `status.mjs` explains each difference and offers the restore plan: `status.mjs --restore-rulebook --confirm`, then `plan.mjs check --run <id>` and `apply.mjs --run <id>`. |

## Layout

```
CLAUDE.md                      hard rules + routing
.claude/skills/claim-tagger/   the skill (editor-facing entry point)
.claude/agents/                thin fallback subagents (judge, distiller)
agents/claim-tagger/
  AGENT.md config.json rubric/ prompts/ schemas/ evals/ scripts/ runs/
docs/mvp-2026-10/              the MVP session: plan, state, log, decisions, evidence, reviews, report
tests/                         node:test unit tests and fixtures
```

See `agents/claim-tagger/AGENT.md` for the run loop and contracts, and the Notion page "Engineer notes" for the allowlist and identities.
