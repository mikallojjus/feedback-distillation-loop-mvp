# geo-agents

Agents of the Geo content team, one folder per agent.

| Agent | Folder | Status |
|---|---|---|
| **Claim tagger with its editor feedback loop**, built as an MVP in October 2026 from the overnight research "Learning from editor feedback" | `agents/claim-tagger-mvp/` | The live build. Works under the Notion page "Feedback Distillation MVP". Runbook: `agents/claim-tagger-mvp/AGENT.md` |
| Claim tagger, previous build | `agents/claim-tagger/` | Read-only history: kept for orientation, never run against Notion again, never edited. The live build still imports eight small helper modules from its `scripts/lib/`, so the folder stays |

## Install

1. Node 22 or later (built with Node 26). No npm dependencies: `npm test` runs `node --test tests/`.
2. Claude Code on the subscription. The headless judge uses `claude -p` with a pinned model; no API key.
3. A Notion integration token for scripted reads and writes: copy `.env.example` to `.env` and set `NOTION_TOKEN=...`. The line must read exactly `NOTION_TOKEN=<the token>`, with no quotes, spaces or comment; `.env` is git-ignored and never printed. The integration must be connected to the Notion page "Feedback Distillation MVP" (page → ⋯ → Connections). Without a token (no `.env`, an empty value or the placeholder from `.env.example`) every script that reaches Notion stops with exit 2 and a report that says so, and nothing is written. The Notion tables were set up once by the engineer with the `setup.mjs` sequence in `agents/claim-tagger-mvp/AGENT.md` (section 3); editors never run it.
4. Open Claude Code in this folder. The skills `/claim-tagger` and `/claim-tagger-walkthrough` are discovered from `.claude/skills/`; the first interactive session asks you to trust the folder, after which `.claude/settings.json` (the allow rules for the scripts and the guard hook) applies.
5. Headless use (`claude -p`): a folder never opened interactively is untrusted, so pass the settings explicitly, and in Git Bash stop MSYS from rewriting the leading slash of the skill name:

   ```
   MSYS_NO_PATHCONV=1 claude -p "/claim-tagger status" --settings .claude/settings.json --permission-mode acceptEdits --output-format stream-json --verbose
   ```

   Permission rules for Bash match whole words, so the settings list one rule per script (`Bash(node agents/claim-tagger-mvp/scripts/status.mjs:*)` and so on); a command chained with `;` or `&&` does not match them, so the skill types every command alone. `setup.mjs`, `rollback.mjs` and `restore.mjs` are under `ask`: Claude Code asks every time. `headless-check.mjs` makes this headless call for you and grades the final message (`agents/claim-tagger-mvp/AGENT.md`, section 2).

## The daily loop (editor's view)

```
/claim-tagger status              what is open: is the agent paused, which edition of the rulebook is in force, what waits for whom
/claim-tagger tag                 read the claims, put the answers the agent is unsure about in Your queue
   ... editors decide the rows in "Your queue" on the Notion page ...
/claim-tagger distill             turn the decisions into proposed rule changes (Lessons waiting)
   ... the rule owner sets Approved or Rejected, and may write the rule in Editor wording ...
/claim-tagger promote "<title>"   run the safety check on the approved change; a PASS puts the new rule live
```

These are the four commands an editor types; the title can be left out when only one change is Approved. After a PASS the follow-up runs by itself and marks the rows the change rests on Fixed or Still wrong; a FAIL or HOLD leaves the rulebook as it is. `/claim-tagger follow-up` only repeats the follow-up when a promote stopped before it. Setting things up (`setup`) and putting an earlier rule back (`rollback`, `restore`) are the engineer's, in `agents/claim-tagger-mvp/AGENT.md`. A new editor starts with `/claim-tagger-walkthrough`, which builds a practice page under a Notion page they name and says what to type next.

Plain words also work: "tag the new claims and tell me what is waiting for me".

## If something stops

Every report ends with one Next line that says what to do, and a stopped command continues where it stopped when the same command is typed again. Waiting loses nothing: finished judgments are kept (a repeated command judges only what is missing), and every write is read back from Notion. The engineer runs scripts from the repository root as `node agents/claim-tagger-mvp/scripts/<name>.mjs ...`; the table writes just `<name>.mjs ...`. The full list is in section 6 of `agents/claim-tagger-mvp/AGENT.md`.

| What you see | What to do |
|---|---|
| The agent is paused (exit 3) | A person unticks Paused in Agent settings or removes `runs/PAUSED`; then type the same command again. No command and no flag clears a pause. |
| Your Claude allowance ran out (exit 75, the usage window) | When the allowance is back, type the same command again; it continues where it stopped. A judge run also resumes with `judge.mjs --resume <run-id>`. |
| A command stopped (exit 1), you stopped it half way, or the machine went down | Type the same command again. It reads Notion first, so nothing is written twice. The exact line is in `agents/claim-tagger-mvp/runs/<run-id>/run.json` under `resume`. |
| The rulebook text in Notion no longer matches the saved edition (exit 4) | Someone edited the rules of a tag by hand. Put the text back on that tag, or the engineer runs `restore.mjs --edition <edition> --confirm` (`restore.mjs --list` shows the editions). |
| A promote ends with FAIL (exit 11) | A result, not an error: the rulebook did not change. Put the whole rule the report hands over into Editor wording in Lessons waiting, then type the promote again. |
| A promote passed but its follow-up could not finish | Type `/claim-tagger follow-up`; it repeats only that last step. |
| A live rule change has to be undone | The engineer runs `rollback.mjs --lesson "<title>" --confirm` (Claude Code asks for permission each time): the earlier rule text goes back, a new edition is saved and the change becomes Rolled back. |
| There is no Notion token, or Notion refused the request (exit 2) | The engineer checks `.env`: the line must read exactly `NOTION_TOKEN=<the token>`, and the integration must be connected to the parent page. |

## Layout

```
CLAUDE.md                      hard rules + routing
.claude/skills/claim-tagger/   the skill (editor-facing entry point)
.claude/skills/claim-tagger-walkthrough/   the skill that builds a practice page
.claude/agents/                thin fallback subagents (judge, distiller) of the previous build
agents/claim-tagger-mvp/       the live agent
  AGENT.md README.md config.json rubric/ prompts/ schemas/ evals/ setup/ walkthrough/ scripts/ runs/
agents/claim-tagger/           the previous build, read-only history
docs/mvp-2026-11/              the live build's session: contracts, decisions, structure, work log, evidence, report
docs/mvp-2026-10/              the previous build's session
tests/                         node:test unit tests and fixtures (tests/mvp/ is the live agent's)
```

See `agents/claim-tagger-mvp/AGENT.md` for the runbook of the live agent: run loop, contracts, safety. `agents/claim-tagger/AGENT.md` and the Notion page "Engineer notes" describe the previous build.
