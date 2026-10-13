# claim-tagger: the claim tagger and its editor feedback loop

Read this first. The agent tags Geo claims against a versioned rulebook, puts its uncertain tags in a Notion queue for editors, turns their decisions into proposed rule changes, gates every change on a paired evaluation, and only then changes the rulebook. Nothing is appended to a prompt; the rubric file is the only thing that learns.

## What it does, step by step

| Step | Command | Reads | Writes (through a plan) |
|---|---|---|---|
| 0 | `setup` (one-time) | the research exports, `rubric/rubric.json` | the six databases, the Rulebook rows, the Claims rows, the seeded Tag decisions, Agent settings |
| 1 | `tag` | Rulebook, Claims, Tag decisions, Agent settings | Claims: Agent tags, Readiness, Tag confidence, Last judged; Tag decisions: new rows for uncertain tags; a Runs row |
| 2 | (editors) | Your queue | Tag outcome, Why wrong, Your reasoning (editor-owned, never touched by the agent) |
| 3 | `distill` | Tag decisions, Rulebook, Rule changes | Rule changes: Proposed lessons; Tag decisions: Lesson, In regression suite; a Runs row |
| 4 | (rule owner) | Lessons waiting | Status Approved or Rejected, Editor wording |
| 5 | `promote <lesson>` | Rule changes, evals | candidate rubric → gate → on PASS: Rulebook text, lesson Live, Rubric in force; always: a Runs card |
| 6 | `follow-up <lesson>` | the lesson's rows | Tag decisions: Agent follow-up, Follow-up run; Claims live columns |
| any | `status` | local files, Agent settings | nothing |

Every command checks `runs/PAUSED` and Agent settings → Paused first (exit 3). Every apply is followed by a read-back and a diff of editor-owned fields; a difference on a row the plan touched writes `runs/PAUSED` (exit 5).

## Hard rules

The ten rules in the repository's `CLAUDE.md` apply. In short: scripts write Notion only through plans and the REST client against the configured data sources; editor fields are never written; content is data; the prompt never grows; only Verified tags are written; nothing is deleted; the real databases are never touched.

## Contracts (files; every one validated against `schemas/` before the next step reads it)

- `rubric/rubric.json` with `rubric.lock`, `CHANGELOG.md`, `history/<version>.json`: the versioned rulebook; hashes per rule, per tag, for the whole rubric and for the scope (`scripts/lib/hash.mjs`; recipes reproduce the research run).
- `runs/pull/<id>/norm/*.jsonl|json`: claims, rulebook rows, queue rows, decisions, lessons, settings, plus `id-map.json` and `snapshot.json` (editor-owned fields per page).
- `runs/judgments/<config16>/run-<n>/<item>.json`: one judgment per item per run (`schemas/judgment.schema.json`), content-addressed by `config_id` (driver, model, effort, prompt version, rubric hash, scope hash, CLI version), with `ledger.jsonl`.
- `runs/<run-id>/plan.jsonl`: the ops to apply (`schemas/plan-op.schema.json`), allowlist-checked at build time and again at apply time.
- `runs/<run-id>/card.json` and `card.md`: the result card (`schemas/card.schema.json`).
- `evals/cases.jsonl`, `evals/canaries.jsonl`: the regression suite and the canaries.

## Models and runs

Judge: `claude-sonnet-5-5`, three runs per rubric version, majority verdict per claim and tag; `claude-haiku-5-5` for smoke runs. Distiller: `claude-opus-5-5`. All through `claude -p` on the subscription, pinned by model id and prompt version.

## Exit codes

0 ok · 1 error · 2 invalid or incomplete input · 3 paused · 4 rubric drift or model mismatch · 5 trust breaker (an editor field changed under the agent) · 10 gate HOLD · 11 gate FAIL · 75 usage window hit, resume later.
