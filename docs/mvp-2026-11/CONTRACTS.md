# Contracts for `agents/claim-tagger-mvp/` (the shapes every script agrees on)

Written by the orchestrator before the Stage 1 code is built. Coders follow this file; where it is silent, the W3 digest (`sweeps/W3-digest.md`) decides; where both are silent, the coder picks the simplest thing and says so in its report. Plain Node ESM, built-ins only, Windows-safe names (no `:` in generated names), every record validated against a schema before the next step reads it (`lib/validate.mjs`).

## 1. Folder layout

```
agents/claim-tagger-mvp/
  AGENT.md  README.md  config.json
  scripts/
    pull.mjs  judge.mjs  propose.mjs  distill.mjs  promote.mjs  followup.mjs
    rollback.mjs  restore.mjs  status.mjs  setup.mjs  walkthrough.mjs
    hooks/guard.mjs
    lib/  paths.mjs  notion-rest.mjs  claude.mjs  (copies)  hash, jsonl, pyjson, rng, validate, exit-codes, notion-values, stats (re-exports)
          config.mjs  plan.mjs  rubric.mjs  cells.mjs  report.mjs  notion-build.mjs  notion-blocks.mjs  (new)
  schemas/   rubric.schema.json  plan.schema.json  cell.schema.json  judge-reply.schema.json  lesson.schema.json  card.schema.json  report.schema.json
  prompts/   judge.md  distill.md  wording.md
  rubric/    rubric.json  rubric.lock  history/<edition>.json  CHANGELOG.md
  evals/     canaries.jsonl  cases.jsonl
  setup/     taxonomy-issue.json  claims-pick.json  audit-decisions.json  structure.json
  walkthrough/  manifest.json  page.md
  runs/  (git-ignored)  pull/<pull-id>/  judgments/<key16>/  <run-id>/  dry-run/<run-id>/  builder/  demos/<demo-id>/  SETUP  PAUSED  PROMOTING.json
tests/mvp/   *.test.mjs   fixtures/fake-notion.mjs  fixtures/fake-claude.mjs  fixtures/*.json
```

The state root is `agentRoot()` (the agent folder, or `CLAIM_TAGGER_MVP_ROOT` for a demo profile under `runs/demos/<id>/`, which holds its own `config.json`, `rubric/`, `evals/`, `runs/`). Code (schemas, prompts) is always read from the agent folder (`codeFile`).

## 2. config.json (final shape; ids filled by setup)

```json
{
  "agent": "claim-tagger-mvp",
  "notion": {
    "api_version": "2022-06-28",
    "builder_api_version": "2026-03-11",
    "parent_page_id": "3fa273e214eb805199f3d12ef01db453",
    "pages": { "proposal": "<set by setup>", "demos": "<set by setup>", "demo_tests": "<set by setup>" },
    "rulebook": { "database_id": "<setup>", "data_source_id": "<setup>", "key": "Name", "work_tag": "Issue" },
    "claims": [ { "name": "claims_copy", "label": "Claims copy", "enabled": true, "database_id": "<setup>", "data_source_id": "<setup>", "key": "Geo ID",
                  "columns": { "claim": "Geo Name", "link": "Geo URL", "sources": "Geo Sources", "is_factual": "Geo Is factual" },
                  "write_columns": { "tags": "Agent tags", "notes": "Agent notes" } } ],
    "databases": {
      "tag_decisions": { "database_id": "<setup>", "data_source_id": "<setup>", "key": "Key" },
      "rule_changes":  { "database_id": "<setup>", "data_source_id": "<setup>", "key": "Lesson" },
      "agent_settings": { "database_id": "<setup>", "data_source_id": "<setup>", "key": "Name" }
    },
    "sources": { "taxonomy": {...read only...}, "real_claims": {...read only...} },
    "protected_database_ids": [ ... ], "protected_page_ids": [ ... ],
    "setup_page_parents": [ "3fa273e214eb805199f3d12ef01db453" ],
    "requests_per_second": 3, "page_size": 100, "max_text": 1900
  },
  "editor_columns": { "tag_decisions": ["Tag outcome", "Why wrong", "Your reasoning"], "rule_changes": ["Editor wording"], "rule_changes_status_editor_values": ["Approved", "Rejected"], "agent_settings": ["Paused"] },
  "models": { "judge": "claude-sonnet-5-5", "distill": "claude-opus-5-5" },
  "tags": { "default": "text", "Unsourced": "deterministic", "Improperly sourced": "source", "Source inaccessible": "source", "Factually challenged": "source", "Exact duplicate": "corpus", "Semantically duplicated": "corpus" },
  "judge": { "runs_max": 3, "rerun": { "band": [0.25, 0.75], "include_ask_editor": true, "max_share": 0.30 }, "groups": { "G1": ["Context-dependent"] },
             "batch_size": 8, "concurrency": 2, "effort": "medium", "max_turns": 1, "timeout_ms": 300000, "claude_bin": "claude", "attempts_per_batch": 2,
             "transient": { "max_in_a_row": 3, "backoff_ms": [30000, 120000] }, "prompt": "prompts/judge.md" },
  "queue": { "reason_max_words": 40, "sitting_rows": 20 },
  "distill": { "min_claims": 2, "max_lessons_per_run": 3, "overfit_ngram": 8, "effort": "high", "timeout_ms": 600000, "prompt": "prompts/distill.md", "wording_prompt": "prompts/wording.md" },
  "gate": { "default": { "flip_rejudge_runs": 2 } },
  "demo": false
}
```

Only tags that are `text` and have rules are judged; in the MVP that is Context-dependent alone. Source and corpus tags are never judged (backlog). `Unsourced` is not computed in the MVP (backlog): Agent notes count it under "not checked". A demo profile's config adds `"demo": true, "demo_id": "<id>"`, points `rulebook`, `claims[0]` and `databases` at the practice page's tables, and lists production's tables under `protected_database_ids`.

## 3. The rubric file (`rubric/rubric.json`), lock, history, changelog

```json
{ "edition": "2026-10-16.1", "built_at": "<ISO>", "source": { "database_id": "...", "data_source_id": "...", "read_via": "connector", "read_at": "<ISO>" },
  "tags": [ { "name": "Context-dependent", "page_id": "<copy row page id>", "category": "Quality", "polarity": "Issue", "status": "Verified",
              "counterpart": "Self-contained", "description": "...", "when_to_use": "<raw text>",
              "rules": [ { "n": 1, "text": "A pronoun with no antecedent ..." } ], "example_claims": ["..."],
              "geo_status": "To be created", "geo_tag_id": null, "verified_on": "2026-09-10", "evidence": "https://...", "work_tags": ["Pipeline benchmark check", "Issue"],
              "capability": "text", "judged": true, "tag_hash": "<h16 of name + rules text>" } ],
  "rubric_hash": "<h16 over the sorted tag hashes>" }
```

- Editions are `YYYY-MM-DD.n` (decision 9). `rubric.lock` holds `{ edition, rubric_hash, locked_at, tags: { <name>: tag_hash }, text: { <name>: when_to_use } }`. `history/<edition>.json` is the full rubric of that edition. `CHANGELOG.md` gets one line per edition: date, edition, what changed and why (a lesson title and PASS, a rollback, an adoption).
- Rules are parsed from When to use: lines starting with `<n>.`; a preamble before rule 1 and a note after the last rule are kept in `when_to_use` but are not rules. The Example Claims column is split one example per line; a leading `- ` and surrounding quotes are stripped; a line that is not a claim (no letters or longer than 400 characters or the known "255 legacy linked claims" line) is dropped.
- `judged = rules.length > 0 && capability === 'text'` (MVP).
- Drift (every command, after `pull`): for every judged tag, compare the copy's When to use, Description, Example Claims and Counterpart with the lock's text; a difference stops with exit 4 and names the tag and the column. For a tag without rules in force, a changed row is adopted: a new edition is written (history, lock, changelog line "adopted from Notion") and the command goes on; if the new text holds numbered rules, the tag becomes judged from that edition (it is still only judged when its group is in `judge.groups`).
- `restore.mjs --edition <e> --confirm` writes the locked When to use of that edition back to the copy for every tag whose text differs (a plan, applied with read-back) and records a new edition "restored from <e>". `rollback.mjs --lesson <title> --confirm` does the same for one tag from the lesson's Current text and sets the lesson Rolled back.

## 4. Canaries and cases (`evals/`)

- `canaries.jsonl`: `{ "id": "canary-<n>", "tag": "Context-dependent", "claim": "...", "expected": "apply" | "do_not_apply", "source": "example claims of Context-dependent" | "example claims of Self-contained" }`. Eleven rows at setup (6 apply, 5 do not apply). Built by setup from the taxonomy file; frozen until a rule change.
- `cases.jsonl`: the earlier decisions, synced from decided queue rows by pull: `{ "key": "<geo_id>::<tag>", "tag", "claim", "outcome": "Applies" | "Does not apply", "why_wrong", "decided_edition", "source": "audit of 9 October" | "queue" }`.

## 5. Pulls (`runs/pull/<pull-id>/`)

`pull.mjs` (reads only) writes `schema/<table>.json` (retrieveDatabase), `raw/<table>.jsonl` (pages), `norm/claims.jsonl` `{ table, geo_id, page_id, notion_url, claim, geo_url, sources_text, source_links, is_factual, agent_tags, agent_notes, last_edited }`, `norm/rulebook.json` (the copy rows as rubric tags, un-hashed), `norm/queue.jsonl` (12 columns plus `page_id`, `last_edited`, `decided` boolean), `norm/lessons.jsonl` (10 columns plus `page_id`, `created`, `supporting_keys`), `norm/settings.json` `{ page_id, paused, rulebook_edition, last_run_summary }`, `drift.json`, `requests.jsonl` (the request log), `pull.json` (manifest) and `runs/pull/LATEST`. Flags: `--tables a,b` or `--all`; `--source real_claims --dry-run` pulls the real table into `runs/dry-run/<run-id>/` (schema, every row, `report.md` with row count, column types, how Geo Sources parses, `requests.jsonl`) and nothing else. A pull of a paused agent still completes (the caller decides). Duplicate keys within a table: exit 2.

## 6. The cell store (`runs/judgments/<key16>/`)

Key: `h16(pyJson({ driver, model, effort, pass: "text", prompt_version, group, tags: [{ name, tag_hash }] sorted by name }, { sortKeys: true }))`. `meta.json` holds those inputs. `run-1.jsonl`, `run-2.jsonl`, `run-3.jsonl`: one line per item `{ "id": "<geo_id>", "item_hash": "<h16 of the claim text>", "status": "ok" | "error", "tags": [ { "name", "decision": "apply" | "do_not_apply" | "ask_editor", "p": 0..1, "rule_ref": "Context-dependent rule 3" | null, "reason": "<= 40 words" } ], "call": { "run_id", "batch", "attempt", "cli_version", "usage": { "input", "cache_write", "cache_read", "output" } } }`; the last line for an item wins. A rule change changes the tag hash, so the group gets a fresh store; the old one stays as history.

Judge reply JSON (one call per batch): `{ "items": [ { "id": "<the id given in the claim block>", "tags": [ { "name", "decision", "p", "rule_ref", "reason" } ] } ] }`, validated against `schemas/judge-reply.schema.json` (every id of the batch present once; every judged tag of the group present once per item; `p` a number in [0,1]; names from the group). An invalid reply gets a second attempt for the batch (`attempts_per_batch` 2); after that the batch's items are `status: error` for that run.

Adaptive runs (decision D19): run 1 for every item; a cell is unsure when its decision is `ask_editor` or its `p` is strictly inside the band; items with an unsure cell are candidates for run 2, at most `max_share` of the run's items, lowest margin first (margin = the smallest `|p - 0.5|`; `ask_editor` counts as 0); run 3 only when runs 1 and 2 disagree. Candidates beyond the cap are marked `capped` in `run.json`.

Error classes (decision 14): a reply matching the usage-window wording stops the run with exit 75 and writes the resume command into `run.json` and `report.md`; a transient error waits `backoff_ms[k]` and retries, and the third transient failure in a row stops the run with exit 1 and the same resume command; a validation failure uses the second attempt. Every call is one line in `runs/<run-id>/calls.jsonl` `{ group, batch, items, attempts, usage, duration_ms, cli_version, status }`; nothing in an editor-facing report shows durations, call counts or dollars.

## 7. Verdicts (propose)

Per cell, over the runs it has: `decision` by majority (`ask_editor` wins any tie), `p_mean`. Unsure when any run is `ask_editor` or `error`, when the runs are not unanimous, or when `p_mean` is strictly inside the band. `Agent proposal`: Applies when not unsure and the majority is `apply`; Does not apply when not unsure and the majority is `do_not_apply`; Can't tell otherwise. `Agent confidence` = `max(p_mean, 1 - p_mean)` rounded to two decimals (0.5 is a coin flip; the queue sorts ascending so the least sure row is on top). `Agent reason`: the reason of the last run shortened to `reason_max_words` words, then " · <rule_ref> · <k>/<n> runs agreed". A queue row is created for every unsure cell without a row; undecided rows are updated; decided rows are never touched (only Follow-up, by followup).

Agent tags: the names of the tags whose proposal is Applies and that have no open queue row, plus every tag an editor decided Applies (an editor always wins); comma-separated; empty when none. Agent notes, two lines: line 1 the same list or `no tags`; line 2 `<n> wait(s) for an editor` or `nothing waits for an editor`, then ` · not checked: <counts by kind>` when something was not checked (source tags, duplicate tags, tags without rules), then ` · edition <edition>`. Written only when they differ from the pulled values.

## 8. Plans, apply, ledger, read-back (`lib/plan.mjs`)

Every script that writes Notion builds `runs/<run-id>/plan.jsonl` first: a header line `{ "plan": { "run_id", "script", "created_at", "rubric_edition", "counts": { "creates", "updates" } } }`, then one op per line `{ "op": "create" | "update", "table": "tag_decisions" | "rule_changes" | "agent_settings" | "rulebook" | "claims_copy", "key": "<row key>", "page_id": "<update only>", "properties": { "<Column>": <plain value> }, "expect": { "<Column>": <plain value> }, "children": [ <blocks> ] }`. `checkPlan` runs before any request: the table must be one of the config's own tables; every property must be in the table's writable set (tag_decisions: Claim, Key, Tag, Agent proposal, Agent confidence, Agent reason, Claim link, Rulebook edition, Follow-up; rule_changes: Lesson, Tag, Rule, Kind, Current text, Proposed text, Safety check result, Supporting rows, Status with values Proposed, Live, Rolled back; agent_settings: Rulebook edition, Last run summary, plus Name on a setup create; rulebook: When to use, plus every column on a setup create; claims_copy: Agent tags, Agent notes, plus every copied column on a setup create); an editor column is refused unless the plan is a setup plan seeding the audit (tag_decisions creates whose Your reasoning starts with "From the audit of 9 October") or the config is a demo profile and `runs/SETUP` exists. Protected ids are refused anywhere in a plan. `applyPlan` sends the ops in order through the REST client (version 2022-06-28; `expect` is checked against the pulled value before an update and the op is skipped with `skipped: expect` when it differs), appends `ledger.jsonl` `{ op_index, key, page_id, status: "done" | "failed" | "skipped", read_back: "ok" | "mismatch", error, at }` after each op, reads every written page back and compares the plain values, and ends with exit 2 when any read-back mismatched. `--plan-only` stops after `checkPlan`. A `create_uncertain` error stops the apply; the next run of the same script reads Notion first and resumes by key (never a second create for a key that exists).

## 9. Reports (`lib/report.mjs`, `runs/<run-id>/report.md` and `report.json`)

Every script ends by writing `report.json` `{ "demo": false, "sentence": "...", "rows": [["What", "Now", ""], ...] (at most 5 rows of 3 cells; omit when nothing to count), "next": "Next: ..." }` and `report.md`, the three parts in order with one blank line between them: the sentence (prefixed "Demo · " when `demo` is true), the table (a Markdown table with a header row; omitted when `rows` is empty), the Next line. Nothing else: no headings, no file paths, no run ids, no durations, no call counts, no dollars, no JSON, no time estimates (no minutes, hours, days, weeks); dates are allowed ("16 Oct 11:20"). When more open queue rows exist than `queue.sitting_rows`, the sentence gives the count and the Next line is `Next: start at the top of Your queue (<link>)`. After a stop (exit 1 or 75) the Next line is the same slash command. The skill prints `report.md` verbatim as its whole final message. Templates and examples: `docs/analysis-2026-10/debate/inputs/report-examples.md` and W4 digest section 8.

## 10. Run folders and ids

`runId(kind)` gives `YYYYMMDDTHHMMSSZ-<kind>`; every script writes `runs/<run-id>/run.json` `{ run_id, script, args, started_at, finished_at, exit_code, rubric_edition, pull_id, resume: "<the exact command to continue>" }` first (started) and last (finished). `status.mjs --check` is the first thing every script does: refuses with exit 3 when `runs/PAUSED` exists or Agent settings' Paused is ticked in the newest pull; warns when `runs/SETUP` exists; stops with exit 4 on drift; stops with exit 4 on a model mismatch reported by the CLI wrapper.

## 11. Exit codes

0 ok; 1 error (a resumable stop: the report's Next line repeats the command); 2 invalid (a plan, a reply or a read-back failed validation; a duplicate key); 3 paused; 4 drift or model mismatch; 5 reserved; 10 HOLD (nothing to evaluate); 11 FAIL (the safety check); 75 usage window (resume later).

## 12. The fakes (`tests/mvp/fixtures/`)

- `fake-notion.mjs`: an in-memory Notion behind a `fetchImpl(url, init)` for `https://api.notion.com/v1/...`. Databases are created from a schema fixture or through `POST /databases` (returns `data_sources: [{ id }]`); routes: `GET /pages/{id}`, `POST /pages` (page or database or data source parent), `PATCH /pages/{id}`, `GET /databases/{id}`, `POST /databases/{id}/query` (cursor paging, `filter_properties` ignored), `GET /data_sources/{id}`, `POST /data_sources/{id}/query`, `PATCH /data_sources/{id}`, `POST /views`, `GET /views/{id}`, `GET /databases/{id}/views`, `GET /blocks/{id}/children`, `PATCH /blocks/{id}/children`. It checks the Authorization and Notion-Version headers, records every request `{ method, path, status, body }`, returns 404 for ids in a `protected` list, applies `failNext(method, pathPattern, status, times)`, and exposes `rows(databaseId)`, `page(id)`, `writes()` (every non-read request). Property values follow the REST shapes (title, rich_text, select, multi_select, number, url, checkbox, date, created_time, last_edited_time, unique_id, relation).
- `fake-claude.mjs`: a Node script started in place of the CLI (`claude_bin` points at it through a `.cmd`-free path: the tests pass `driver: 'fake'` to the wrapper as the old fixture does). It reads the prompt from stdin, finds the `<claim id="...">` blocks and the tags of the system prompt, and answers from a fixture table keyed by claim text (`{ decision, p, rule_ref, reason }`), else deterministically from a hash of the text; modes through an environment variable `FAKE_CLAUDE_MODE`: `ok`, `invalid-once` (first reply is not JSON), `transient-once` (prints an overloaded error and exits 1 once), `usage-window` (prints the limit-reached wording), `wrong-model`. For distill and wording it returns a fixed lesson or sentence from the fixture.

## 13. Editor-facing words

table (not database); queue (the Tag decisions table); Your queue (the view); rulebook and Rulebook copy; edition and "Rulebook edition"; safety check and "Safety check result"; practice page; canaries are called "examples" in anything a person reads. No personal names anywhere a person reads. No shorthand codes.

## 14. Decisions taken by the coders and adopted (2026-10-15)

- `rubric.lock` has a fourth key `columns { <name>: { Description, "Example Claims" (parsed, one per line), Counterpart } }`, because drift compares four columns.
- `computeDrift(lock, rows, { config })`: a tag is judged when its locked text holds rules and (with a config) it is a text tag in a judge group; otherwise a change is `adopted`. `added` and `missing` hold names; `judged` holds one entry per differing column.
- Reports: `header` is its own field (default `["What", "Result", ""]`), `rows` are body rows; the lint also requires a one-line first sentence and exactly one Next line, last. Text inside double quotes (straight or curly) is exempt from the word and character rules, so scripts quote claim text in sentences and cells. "second" counts as a time word.
- `parseRules`: a numberless line continues the rule above it when a later rule follows; after the last rule it continues only until a blank line, a "Note:" label, or a rule that ended with a sentence mark; the rest is the note.
- `buildRubric` and `computeDrift` skip rows without a Name. `writeEdition` only moves forward and never rewrites an existing edition with other rules, so a stop halfway is re-run safely.
- The fake Notion: the token must equal `fake.token` (else 401); data-source and database-create routes need Notion-Version 2025-09-03 or later and views 2026-03-11 (else 400); requests are all-or-nothing; filters and sorts are evaluated; protected ids hide everything beneath them; `editRow(pageId, plain)` is an editor's edit and is not logged as a write.
- `config.mjs` refuses a config whose read-only sources are not in the protected list or whose own tables are.
- Plans: a create must carry its key column in `properties` (`newPlan` adds it when given the config); a create whose key exists in `pulled[table]` is skipped ("skipped: exists"); `pulled` is keyed by Notion column names (`loadPull(root, id, { config }).pulled()`); ledger lines carry `table`, `op`, `sent`; a read-back that could not run is `unchecked` (exit 1) and a mismatch exit 2, both re-read, never re-written, on the next run; a `create_uncertain` stop needs a fresh pull before the next run.
- Dry-run rows carry every column as a plain value plus `page_id`, `url`, `last_edited_time`, `source_links` [{text, href, form}] and `source_pieces` [{text, href}] so Geo Sources can be rebuilt with its links; a Geo Sources cell longer than 25 rich-text pieces is re-read whole from the property item; a multi-source database falls back to the data-source route.
- The 50-claim pick: pool = non-audit rows with a name and a unique Geo ID sorted by Geo ID; `sample(pool, 40, mulberry32(seedFromString(seed)))`; seed `mvp-2026-11`; audit rows first in the audit file's order.
- Judge: after a stop, `report.md`'s Next line is the slash command ("type /claim-tagger tag again; it continues where it stopped"); the exact resume command is in `run.json.resume`. `--refresh` renames the group's store to `<key16>.superseded-<run-id>` and fills a new one under the ordinary key. A batch that fails both attempts gets error lines and the run ends with exit 2; the next run retries them. Extra reply checks: `apply` needs `p >= 0.5` and `do_not_apply` `p <= 0.5`; a `rule_ref` naming no real rule becomes null; `reason` is cut to 40 words. `{{claim_count}}` renders as `judge.batch_size` so the system prompt is byte-identical across calls. `storeInputsFor(...)` opens the store a run filled (for propose and the safety check). Not built: `--reference`, the CLI-version warning.
