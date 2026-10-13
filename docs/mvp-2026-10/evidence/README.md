# Evidence of the MVP run (October 2026)

Everything here is produced by scripts or copied from their outputs; nothing is hand-edited.

- `notion/<nn>-<label>/`: the normalised pull of the Notion databases at each step of the demo storyline (`claims.jsonl`, `queue.jsonl`, `decisions.jsonl`, `lessons.jsonl`, `runs.jsonl`, `rulebook.json`, `settings.json`, `summary.json`). Step `00-seeded` is the state right after the seed, before any judge run.
- `headless/`: transcripts (`*.jsonl`) and summaries (`*.summary.md`) of the fresh headless Claude Code sessions that ran the skill as an editor's machine would.
- `persona-editor-actions.json`: every Notion write the Editor persona made during the review (row, field, before, after, when).
- `cards/`: copies of the result cards (`card.json`, `card.md`) of every gate, smoke and follow-up run.

The artifact's numbers are generated from these files by `../report/build.mjs` (see `../report/README.md`), so a figure on the page always traces back to a file here.
