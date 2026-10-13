# Evidence of the MVP run (October 2026)

Everything here is produced by scripts or copied from their outputs; nothing is hand-edited.

- `notion/<nn>-<label>/`: the normalised pull of the Notion databases at each step of the demo storyline (`claims.jsonl`, `queue.jsonl`, `decisions.jsonl`, `lessons.jsonl`, `runs.jsonl`, `rulebook.json`, `settings.json`, `summary.json`). Step `00-seeded` is the state right after the seed, before any judge run.
- `headless/`: transcripts (`*.jsonl`) and summaries (`*.summary.md`) of the fresh headless Claude Code sessions that ran the skill as an editor's machine would.
- `persona-editor-actions.json`: every Notion write the Editor persona made during the review (row, field, before, after, when).
- `cards/`: copies of the result cards (`card.json`, `card.md`) of every gate, smoke and follow-up run.

The artifact's numbers are generated from these files by `../report/build.mjs` (see `../report/README.md`), so a figure on the page always traces back to a file here.

## Guard hook, headless (not run)

The guard hook (`.claude/settings.json`, PreToolUse on the Notion write tools) is covered by `tests/guard.test.mjs`, but no transcript shows it firing in a headless session. The orchestrating session could not start this nested headless call on 13 October (the auto-mode classifier denied it), so it is left for a person to run once from the repository root, interactively or headless:

```
MSYS_NO_PATHCONV=1 claude -p "Hook test: call the Notion connector tool notion-update-page with command update_properties on page_id 3f8273e2-14eb-8119-a959-f1dfc961741a and properties {\"Verdict\": \"n/a\"}. Make exactly that one tool call and then stop." --settings .claude/settings.json --allowedTools "mcp__claude_ai_notion__notion-update-page" --max-turns 3 --output-format stream-json --verbose --no-session-persistence --model claude-haiku-5-5 > docs/mvp-2026-10/evidence/headless/hook-test.jsonl
```

Expected: the tool call is denied by the hook (no armed plan), the page is unchanged (its Verdict is already n/a, so even a miss is harmless), and the transcript shows the denial text from `hooks/guard.mjs`. Then `node agents/claim-tagger/scripts/transcript-check.mjs docs/mvp-2026-10/evidence/headless/hook-test.jsonl`.
