# geo-agents

Agents of the Geo content team, one folder per agent. The first agent is the **claim tagger with its editor feedback loop** (`agents/claim-tagger/`), built as an MVP in October 2026 from the overnight research "Learning from editor feedback".

## Install

1. Node 22 or later (built with Node 26). No npm dependencies: `npm test` runs `node --test tests/`.
2. Claude Code on the subscription. The headless judge uses `claude -p` with a pinned model; no API key.
3. A Notion integration token for scripted reads and writes: copy `.env.example` to `.env` and set `NOTION_TOKEN=...`. The integration must be connected to the Notion page "Editorial feedback loop" (page → ⋯ → Connections). Without a token the skill falls back to the Notion connector for every write (slower).
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
