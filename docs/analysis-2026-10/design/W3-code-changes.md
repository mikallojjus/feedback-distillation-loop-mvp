# W3: code changes (as decided)

Status: design, not started. Coding starts only on Mika's go-ahead for W3 (decision D16: W3 and W4 each need their own).

This is the single ordered change list for rebuilding the claim tagger. It merges P1's change list C1-C18 (`P1-architecture.md` section 4), P3's debt list and verification plan (`P3-scaling-cost-debt-verification.md` sections 2 and 3) and P2's code changes (`P2-walkthrough-reporting-artifact-debate.md` sections 1.3 and 2), under decisions D1-D24 (`../DECISIONS.md`) and the reconciliation R1-R16 (`RECONCILIATION.md`). Where the plans disagree, the reconciliation wins. Where a later decision changes an earlier one, the later one applies everywhere below: D17 over D6 (duplicates), D18 over every queue cap, D19 over D13 (re-runs), D20 over D14 (gate), D23 over hard rules 5 and 10, D24 over any default parent page. The walkthrough's own design (manifest, page, steps, evals, skill) is `W4-walkthrough-skill.md`; this file holds the code it needs.

Key to the codes used in this file: **Cn** is a change in section 4 (C0 to C22; P1 numbered C1 to C18); **Dn** is a decision of the product owner (D1 to D24, `../DECISIONS.md`); **Rn** is a ruling in `RECONCILIATION.md` (R1 to R23); **Hn** is a housekeeping item inside C0; **ED-n** is an objection from the editor debate of 14 October and **answer n** is the editor's question n (`../debate/dispositions.md`, `../debate/answers.md`; the `ED-8` and `EN-3` named in H7 and C1 belong to the earlier MVP review in `docs/mvp-2026-10/review/`, not to this list); **F5** and **F7** are Mika's feedback items on the report (`../FEEDBACK.md`); **P1, P2, P3** are the three plan reports in this folder (`P3 #n` is item n of P3's debt list, `P2 2.1` its section 2.1); **On** (section 8 only) is an item of P1's optimal setup, each with its trigger there; **G1, G2, S** are the judge's cache groups (explained under `judge.groups` in section 2); **S1 to S5** are the default gate's checks (C14); **W3, W4** are this file and `W4-walkthrough-skill.md`.

Editor debate, round 1, applied in this file: the same four view names on the practice page and the real page, with side-by-side texts in Lessons waiting (ED-4, answer 5); Safety check result and Rulebook edition as the editor-facing column names, so that "rubric" stays only in repository files (ED-8); the mirror's Agent notes in at most two short lines (ED-9); one tag per draft-rules run, chosen by the editor (ED-6); follow-up by itself at the end of a promote PASS (ED-10); one proposed sentence for Editor wording in the report after a failed safety check (answer 4); a staged sequence with no calendar, and the walkthrough before the first real rows are decided (ED-11, F7).

Paths: `S/` = `agents/claim-tagger/scripts/`, `A/` = `agents/claim-tagger/`, `T/` = `tests/`. Line numbers are at commit d195bd4 (`../findings/sweep-A-scripts.md`). A function named without "(new)" exists today under that name.

## 1. How to use this list

- Build in the order of section 4. It is grouped by stage (0 to 3, then Later); section 7 repeats the stages with their milestones. A stage is a place in the sequence, not a length of time (F7).
- Ids keep P1's numbers (C1-C18) so the report's references stay valid. C0 and C19-C22 are new. Some changes moved to another stage than P1 implied, so ids are not consecutive inside a stage.
- "(amended by ...)" marks a change that differs from P1's text; the amendment is written into the change.
- Every change lists its goal (one sentence), files, functions to reuse, what to delete, config keys, tests and acceptance check. A change is done when `npm test` is green and its acceptance check passed. A check that cannot run is reported, never skipped (hard rule 6). One commit per change, once the go-ahead covers commits.
- Config moves step by step: C2 adds the keys of section 2; each later change removes the old keys it no longer reads (its "Config" line says which), and the test fixture config `T/fixtures/config.json` follows. After C14 the file has exactly the shape of section 2.
- Throughout: no script or session writes an editor-owned field (the single exception is the demo setup in rule 1), no script deletes or archives a Notion page, and `.env` never reaches a prompt, log, transcript or report (hard rules 1, 8, 9).

## 2. The final config.json

```json
{
  "agent": "claim-tagger",
  "notion": {
    "api_version": "2022-06-28",
    "builder_api_version": "2026-03-11",
    "page_id": "<Claim tagger page, written by setup>",
    "rulebook": {
      "database_id": "<copy database, written by setup>",
      "data_source_id": "<copy data source, optional>",
      "key": "Name",
      "work_tag": "Issue"
    },
    "mirrors": [
      {
        "name": "us_politics",
        "label": "U.S. Politics debate claims",
        "enabled": true,
        "database_id": "7219756338b2416f8fa8af83d75ec47d",
        "data_source_id": "d1307596-e531-420f-8688-2485f3ef28ab",
        "key": "Geo ID",
        "columns": {
          "claim": "Geo Name",
          "link": "Geo URL",
          "sources": "Geo Sources",
          "sources_count": null,
          "is_factual": "Geo Is factual"
        },
        "write_columns": { "tags": "Agent tags", "notes": "Agent notes" }
      }
    ],
    "databases": {
      "tag_decisions": { "database_id": "<written by setup>", "data_source_id": "<optional>", "key": "Key" },
      "rule_changes": { "database_id": "<written by setup>", "data_source_id": "<optional>", "key": "Lesson" },
      "agent_settings": { "database_id": "<written by setup>", "data_source_id": "<optional>", "key": "Name" }
    },
    "protected_database_ids": [
      "<taxonomy Claim Tags — verified: f05273e214eb8353b0a981544507de32 and its data source>",
      "<Claims to review: database and data source>",
      "<both World affairs mirrors: databases and data sources>",
      "<QA agent work tags: database and data source>",
      "<the 6 trial databases of Editorial feedback loop: 12 ids>",
      "<the 6 sandbox databases of its Walkthrough page: 12 ids>"
    ],
    "requests_per_second": 3,
    "page_size": 100,
    "max_text": 1900
  },
  "models": { "judge": "claude-sonnet-5-5", "cheap": "claude-haiku-5-5", "distill": "claude-opus-5-5" },
  "tags": {
    "default": "text",
    "Unsourced": "deterministic",
    "Improperly sourced": "source",
    "Source inaccessible": "source",
    "Factually challenged": "source",
    "Exact duplicate": "corpus",
    "Semantically duplicated": "corpus"
  },
  "judge": {
    "runs_max": 3,
    "rerun": { "band": [0.25, 0.75], "include_ask_editor": true, "max_share": 0.30 },
    "groups": {
      "G1": ["Context-dependent"],
      "G2": ["Multi-sentence", "Trailing period", "Improper capitalization", "Incorrect grammar", "Poor wording", "Wordy"],
      "S": ["Improperly sourced", "Source inaccessible", "Factually challenged"]
    },
    "batch_size": 8,
    "concurrency": 2,
    "effort": "medium",
    "max_turns": 1,
    "timeout_ms": 300000,
    "claude_bin": "claude",
    "max_error_share": 0.1,
    "prompts": { "text": "prompts/judge.md", "source": "prompts/judge-sources.md" }
  },
  "sources": {
    "max_sources_per_claim": 3,
    "excerpt_chars": 6000,
    "min_words": 150,
    "fetch_timeout_ms": 20000,
    "max_bytes": 3000000,
    "per_host_delay_ms": 1000,
    "refetch_after_days": 30,
    "user_agent": "geo-claim-tagger/1.0",
    "resolver": {
      "graphql_endpoint": "https://api-testnet.geobrowser.io/graphql",
      "web_url_property": "Web URL"
    }
  },
  "queue": { "reason_max_words": 40 },
  "distill": { "min_claims": 2, "max_lessons_per_run": 3, "overfit_ngram": 8, "effort": "high", "timeout_ms": 600000 },
  "gate": {
    "default": { "flip_rejudge_runs": 2 },
    "initial_rules_sample": 30,
    "initial_rules_max_rate": 0.5,
    "strict": {
      "runs": 3, "tolerance": 0.05, "min_positives": 5, "bootstrap": 1000, "ci": [0.025, 0.975],
      "ungated_flips_hold": 1, "ungated_flips_fail": 3, "reconfirm_runs": 5, "reconfirm_max": 16,
      "large_sample_positives": 30
    }
  }
}
```

What the keys mean (only what is new or changed against today's file):

- `notion.api_version` stays 2022-06-28 for every pull, apply and verify. `notion.builder_api_version` (new, R11) is used only by the setup builder (`S/lib/notion-build.mjs`, C20) for pages, databases and views, and only after the API check of C20 passed.
- `notion.rulebook` is the taxonomy-shaped copy (D2). `work_tag` keeps the rows whose Work tags contains Issue (D1). The key is the taxonomy's title column, Name.
- `notion.mirrors[]` (D3, D9) is P1's entry plus P3's fields: `enabled`; `columns.sources_count` (null means "count the links in `columns.sources`", which is the case on U.S. Politics); and `write_columns` as P3's role map (`tags`, `notes`), so the code knows which column gets what. The code intersects `Object.values(write_columns)` with its own constant `MIRROR_COLUMNS = ['Agent tags', 'Agent notes']` (D5): a third name is never written, whatever the config says. P3's per-mirror key prefix (`usp.<geo_id>`) is not used: keys stay `<Geo ID>::<Tag>` while there is one mirror (D9); the question returns with World affairs (section 8).
- `notion.databases` holds the agent's three own databases. `data_source_id` is optional everywhere: the guard no longer reads it, and protected-list comparisons use both ids when present.
- `notion.protected_database_ids`: today's nine ids minus the U.S. Politics pair (now a mirror, D3), plus the 24 trial and sandbox ids (C1). The taxonomy, Claims to review and World affairs stay protected (D9, D23).
- `tags` is the capability map (D1, D17). `text`: judged by the model in the text pass once the tag has rules in force. `source`: judged per claim from fetched source text (D12). `deterministic`: decided in code (Unsourced, from the sources). `corpus`: never judged by the model and never queued; Semantically duplicated is "not checked" in Agent notes on every claim, and Exact duplicate gets a free exact-text check within the mirrors and is queued only on a match (D17). A tag not listed is `text`. A tag with no rules in force is never judged (it is counted under "not checked" in Agent notes). Polarity decides nothing any more: "issue" means "in the Issue view" (Multi-sentence has polarity Classification).
- `judge.runs_max` and `judge.rerun` (D19, R1): run 1 for every claim; a cell is unsure when its decision is `ask_editor` (`include_ask_editor`) or its `p` lies strictly inside `band`; claims with an unsure cell get run 2, at most `max_share` of the run's claims, lowest margin first; run 3 only where runs 1 and 2 disagree. Applied cells with high confidence are not re-read.
- `judge.groups` (R4): prompt and cache groups. The cache key is per group and carries the group's tag hashes, so a rule change re-judges only its group. G1 = Context-dependent; G2 = the six text tags whose first rules the draft-rules step writes, one tag per run (D7, ED-6); S = the source tags, one claim per call (`batch_size` does not apply).
- `sources.resolver` (R9): the Geo GraphQL endpoint that returns a source entity's "Web URL" in one query (`../findings/verification-notes.md`, "Source-URL resolver"). The host name says testnet but serves the production space; the Geo team should confirm the canonical name.
- `queue` has no row cap (D18): every unsure row lands at once, and the views sort by confidence.
- `distill` (R5): a group needs `min_claims` (2) distinct claims; at most `max_lessons_per_run` (3) lessons per run. `effort` and `timeout_ms` are set explicitly (P3 #21: today they are read but unset, so Opus runs at the CLI default); `high` and a timeout of 600000 ms are proposed for the few Opus calls.
- `gate.default.flip_rejudge_runs` (D20, R2): in the default gate, every item whose answer differs between the old and the new rule is read twice more on each side. `gate.initial_rules_*` is P1's base-rate check for first rules. `gate.strict` is P1's, used only with `--strict` (D14).

Removed keys, and the change that removes each:

- `notion.hub_page_id`, `databases_page_id`, `engineer_notes_page_id`, `walkthrough_page_id`, `max_creates_per_call`: no reader (C0, H6).
- `anonymise`: moved to the git-ignored `A/anonymise.local.json` (C0, H5).
- `notion.setup_page_parents`, `setup_content_pages`: the guard has no connector setup path any more, and a parent page is named at run time (C5; amended by R11 and D24, P1 kept `setup_page_parents`).
- `notion.databases.rulebook`, `.claims`, `.runs`: replaced by `notion.rulebook`, `notion.mirrors` and the folded Runs database (R8); the trial ids move to the protected list (C2, C6).
- `judge.runs`, `judge.smoke_runs`, `judge.prompt`, `thresholds` (now `judge.rerun.band`), `scope.*` (now `tags` and `judge.groups`) (C9).
- `readiness`, `queue.weekly_cap_default`, `queue.why_max_words` (renamed `reason_max_words`) (C11; D4, D18).
- `distill.min_claims_rule_change`, `distill.owner_ruling_at` (C13; D4: the editor is the rule owner).
- The flat `gate.*` keys, now under `gate.strict` (C14).
- Never added: P1's `queue.max_new_rows_per_run` (D18), `judge.rerun_if` (D19), and `sources.resolver.geo_api` / `html_fallback` (R9: the entity pages render in the browser, so an HTML fallback finds no properties).

A demo profile's config (written by `walkthrough.mjs start`, C21) has the same shape plus `"demo": true` and `"demo_id"`. Its `notion.page_id`, `rulebook`, `databases` and a single mirror `demo_claims` (label "Claims", the same `columns` and `write_columns`) point at the demo's own databases. Its `protected_database_ids` is production's list plus the production page's databases and every production mirror, so a demo can never reach them. `tags` is `{ "default": "text" }` and `judge.groups` is `{ "G1": ["Context-dependent"] }`. P1's per-mirror `demo` flag becomes this profile-level flag.

## 3. Hard rules as decided (D23); CLAUDE.md is rewritten in C17

Rules 2, 3, 6, 7, 8 and 9 stay word for word. Rules 1, 5 and 10 are replaced. Rule 4 gets one sentence, because R10 asks for the unjudged-tag exception to be said explicitly.

> **1. Notion is written only by applying a plan a script produced.** No agent or script ever writes an editor-owned field: Tag outcome, Why wrong, Your reasoning, Editor wording, the Status values Approved and Rejected, Paused. One exception: when the walkthrough creates a demo page, that demo's setup plan fills Tag outcome and Your reasoning on its earlier-decision rows, once, at creation; this never happens on the production databases or on a mirror. New pages, databases and views are made only by the setup builder, from a setup plan it writes first, under a parent page a person names at run time; rows always go through plan and apply.

> **4.** (today's text, then:) Exception: while a tag has no rules in force, edits to its row in the rulebook copy are adopted from Notion without a gate (`status.mjs --adopt-unjudged`); its first rules still need an Approved lesson and a gate PASS.

> **5. Only rulebook tags with rules in force are judged.** The rulebook is the configured copy of the taxonomy rows whose Work tags contains Issue. A tag is judged once its When to use has numbered rules in force: the rules the copy held at setup, or rules that later went live through the gate. Unsourced is computed from the sources. Source tags are decided only from fetched source text; a source our tools could not resolve or fetch is "not checked", never Source inaccessible. Semantically duplicated is reported as not checked and never queued; Exact duplicate is checked only by an exact text match within the configured mirrors and queued only on a match. Editor verified is never written.

> **10. Real content databases are protected; the configured mirrors accept two text columns.** On each claim mirror listed in `config.notion.mirrors` (today U.S. Politics debate claims), scripts write only its two write columns, Agent tags and Agent notes (the code refuses any other name), never create or delete a row, and change its schema once, at setup and behind a confirm flag, to add those two text columns. The rulebook copy accepts When to use only, after a gate PASS or a confirmed restore, besides the rows created once at setup. The taxonomy ("Claim Tags — verified"), Claims to review, World affairs and every other real database stay protected and are never written. The agent's databases live under the Notion page "Claim tagger"; "Editorial feedback loop", its Walkthrough and their databases are read-only history.

Agents table entry in CLAUDE.md: claim-tagger (editor feedback loop), folder `agents/claim-tagger/`, entry points `/claim-tagger` with setup, status, tag, draft-rules, distill, promote, rollback, follow-up and `demo <step>`, and `/claim-tagger-walkthrough` with start and where (C22). The sentence about `.claude/agents/` says it now holds only the editor persona used for reviews (C16 deletes the two fallback subagents).

Notes for Mika when CLAUDE.md is rewritten:

- Rule 5. D23 reads "only rulebook tags whose rules went live through the gate are judged". Taken literally, that would stop Context-dependent, whose rules come from the taxonomy at setup and never passed a gate. The text above counts the rules the copy holds at setup (the first rulebook edition, version 1 of `rubric.json`) as in force and requires the gate for every rule added or changed after that, which is how P1 C4 and C7 build the first rubric. Please confirm the wording.
- Rule 2 stays: the builder also goes through `S/lib/notion-rest.mjs`; a demo profile's `config.json` is "the agent's config" for that demo.
- Rule 7 stays: `verify.mjs` no longer writes `runs/PAUSED` (R7), but a person can still create it, and Paused in Agent settings still stops every command.

## 4. The change list

### Stage 0: housekeeping, libraries, archive, config, read-only dry run

**C0. Housekeeping (new: P3 debt items 6, 9, 11, 13, 21, 23, 24)**

Goal: close the small debt items first, so every later change starts from safe permissions, no stray setup marker and a clean config.

- **H1. Settings prefix (P3 #9).** The allow, ask and deny entries in `.claude/settings.json` name the Notion tools `mcp__claude_ai_notion__notion-*`, but this workspace's connector is `mcp__16f81eb6-6eb4-423e-9e64-a5cb678b0953__notion-*`, so none of those entries match. Use the prefix that `/permissions` shows on the machine that runs the skill. The guard hook's matcher has no prefix, so it stays the layer that holds on every machine.
- **H2. Wildcard allows become asks (P3 #9).** `Bash(node agents/claim-tagger/scripts/status.mjs:*)` and `.../promote.mjs:*` let the model run `status.mjs --unpause --confirm`, `status.mjs --restore-rulebook --confirm` and `promote.mjs --rollback <lesson> --confirm`, which are a person's call. Replace both wildcards with the explicit forms of C5's final settings and put `--unpause`, `--restore-rulebook` and `--rollback` under `ask` (C7 and C15 add `setup.mjs` and `--adopt-unjudged` there).
- **H3. Delete tools covered (P3 #9).** No rule covers notion-delete-pages or notion-delete-databases. Deny them, and widen the hook matcher from the eight write tools to every Notion connector tool (`mcp__.*notion-.*`); `decide` in `S/hooks/guard.mjs` denies the delete, restore, move and duplicate tools now. C5 turns the guard into "deny every write".
- **H4. SETUP marker removed (P3 #11).** `A/runs/SETUP` and `A/sandbox/runs/SETUP` exist since 14 Oct 14:46, so the guard allows schema changes and setup-page writes today. A person deletes both from a terminal (Claude Code has no write permission under `runs/`). From C7 on, `setup.mjs finish` removes its own marker, and `status.mjs --check` warns while a marker exists (C15).
- **H5. Names out of the repo (P3 #23).** `anonymise.replacements` in `A/config.json` and `A/sandbox/config.json` holds five real name pairs. Move them to `A/anonymise.local.json` (git-ignored: `.gitignore` gains `agents/*/anonymise.local.json`) with a committed `A/anonymise.example.json` of placeholder pairs. `scrubNames` (`S/lib/rubric-build.mjs:57`) already takes the pairs as a parameter; its callers load the local file, and an audit import (setup `evals`, C7) refuses with exit 2 when the file is missing. Deny `Read(agents/**/anonymise.local.json)` so the names stay out of transcripts. The names remain in earlier commits; whether to rewrite that history before the first push to a remote is Mika's call.
- **H6. Dead config keys removed (P3 #21).** Remove `notion.hub_page_id`, `databases_page_id`, `engineer_notes_page_id`, `walkthrough_page_id` (no reader) and `notion.max_creates_per_call` (`S/plan.mjs:41` hard-codes the batch size, and C12 deletes the batch writer). Set `distill.effort` and `distill.timeout_ms` (read at `S/distill.mjs:315, 318`, never set); section 2 proposes `high` and 600000.
- **H7. "Under 30" and "12 judged" text fixes (P3 #24, sweep B).** Gate cards print "a gated tag has under 30 labelled positives" (`S/eval.mjs:799`, constant `LARGE_SAMPLE_POSITIVES` at `:59`) while the gate gates from 5: the line names both numbers now, and from C14 it reads `gate.strict.large_sample_positives` and appears on strict cards only. The MVP report says 12 tags are judged by the model (`docs/mvp-2026-10/report/parts/02-glance.html:35` and `07-decide.html:22`, through `{{count:judgedTags}}` = 12 in `data/counts.json`); it is 10. Add a count `modelJudgedTags` (10, with its source) and use it where the text says "by the model". Also: `docs/mvp-2026-10/plan.md:27` "the 57 decisions seeded" becomes "33 seeded, 24 set aside", and `parts/06-verify.html` stops saying every must-fix gap was addressed (the MVP review's editor item ED-8 is still open). Rebuild that report with `--strict`; republish only if its link is still in use.
- **H8. Usage-window regex split (P3 #6; was part of P1 C3).** `USAGE_WINDOW_RE` (`S/lib/claude.mjs:27`) treats any 429 or "overloaded" as the end of the usage window, so one passing error stops a long run with exit 75. Split it: the usage window is `/usage limit|limit reached|resets?/i`; 429, 529, "rate limit" and "overloaded" are transient and retried after 30 s, then 120 s; only three transient failures in a row stop the run as a usage window. Judge (`S/judge.mjs:849-851`), distill (`S/distill.mjs:323`) and promote (`S/promote.mjs:295`) share the classification; `usageResetHint` is unchanged.
- **H9 (optional, not blocking). Private git remote (P3 #13; the default "recommended, not blocking").** `runs/` is git-ignored and exists on one disk; after C1, copy `A/runs.trial-2026-10/` to a second disk when the remote is added.

- Files: `.claude/settings.json`, `S/hooks/guard.mjs`, `.gitignore`, `A/config.json`, `A/sandbox/config.json`, `A/anonymise.example.json` (new), `S/lib/claude.mjs`, `S/eval.mjs`, `docs/mvp-2026-10/report/parts/*.html` and `data/counts.json`, `docs/mvp-2026-10/plan.md`.
- Reuse: `scrubNames`, `usageResetHint`, `decide`, `hookOutput`.
- Delete: the two SETUP markers; the five name pairs from both configs; the H6 keys.
- Config: removes the H6 keys and `anonymise`; adds `distill.effort` and `distill.timeout_ms`.
- Tests: `T/guard.test.mjs` (delete, restore, move and duplicate tools denied under any server prefix); `T/claude.test.mjs` (the split, the backoff, three in a row); `T/fixtures/fake-claude.mjs` gains a 429 or overloaded mode and a "usage limit reached, resets 3pm" mode (P3); `T/eval.test.mjs` (the card line); `T/rubric-build.test.mjs` (`scrubNames` with pairs read from a temporary local file).
- Accept: `/permissions` lists the Notion reads as allowed and the delete tools as denied; a headless `-p` run asked to unpause stops at the permission check; no SETUP marker on disk; `git grep -n anonymise -- "agents/*/config.json"` is empty; a fake 429 followed by success finishes the batch, and three in a row exit 75 with the resume command; the MVP report builds with `--strict`.

**C3. Library extensions (amended by R9 and R11; the usage-window split moved to H8)**

Goal: give the scripts what the new design needs from Notion and Geo, with no change of behaviour for today's callers.

- Files:
  - `S/lib/notion-values.mjs`: `richTextLinks(value)` (new) returns `[{ text, href }]` from `rich_text[].href` or `text.link.url`; `decodeTyped` drops the links today (lines 33, 60).
  - `S/lib/notion-rest.mjs`, inside `createClient`: `createDatabase({ parentPageId, title, properties, isInline, description })` (new; POST /databases; the body follows the client's API version: top-level `properties` on 2022-06-28, `initial_data_source.properties` with per-property `description` on 2025-09-03 and later, used by C20); `updateDatabase(id, { properties })` (new; PATCH /databases/{id}; used once per mirror by setup, C7); `createPage` accepts `parentPageId` as well as `parentDatabaseId` (exactly one); `queryDatabase` and `queryAll` take `filterProperties` and send them as repeated `filter_properties` query parameters; a `readOnly: true` client option throws before sending anything other than GET or a query POST (C19); a `writeGuard(method, path, body)` option that runs before every write (C12 passes the allowlist's mirror check, P3 #10). The "never send twice" rule (`createUncertain`) extends from POST /pages to POST /databases (C20 adds POST /views).
  - `S/lib/geo-sources.mjs` (new): `parseGeoSources` moved from `S/seed-build.mjs`; `resolveGeoEntity(entityId, { endpoint, webUrlProperty, fetchImpl, cacheDir })` sends one GraphQL query per entity (the query in `../findings/verification-notes.md`, "Source-URL resolver"; the session's probe script `probe/geo-entity2.mjs` is the starting point if it still exists), caches the answer under `runs/sources/resolve/<sha16 of the entity id>.json`, and returns `{ status: 'ok', web_url, publisher, types }` or `{ status: 'unresolved', why }` (no Web URL value, not a source entity, the API unreachable or answering an error). Unresolved means "not checked", never Source inaccessible (R9).
- Reuse: `request`, `createUncertain`, `brokenCursor`, `splitRichText`, `MAX_CHILDREN`, `h16` and `sha256Hex` (`S/lib/hash.mjs`), `appendJsonl`, `writeJsonAtomic`.
- Delete: nothing.
- Config: none read here; callers pass `config.sources.resolver` values.
- Tests: `T/notion-values.test.mjs` (links kept); `T/notion-rest.test.mjs` (both `createDatabase` shapes, `updateDatabase`, a page parent, `filter_properties` encoding, a read-only client refuses a PATCH without sending it, `writeGuard` refuses before sending, a lost POST /databases is not sent again); `T/geo-sources.test.mjs` (new: parsing; the resolver with a fake fetch: Web URL found, missing, API down, a cache hit sends nothing).
- Accept: `npm test`; today's callers behave as before.

**C1. Archive the trial (amended by D11; adds the token clean-up of P3 #10)**

Goal: freeze the trial hub, its Walkthrough sandbox and their local state as read-only history, and cut the token's reach down to what the new design needs (D11).

- Files: git tag `trial-2026-10-14` first. Move `A/rubric/`, `A/evals/` and `A/sandbox/` (without `sandbox/runs/`) to `A/archive/trial-2026-10/`. Rename `A/runs/` to `A/runs.trial-2026-10/` and `A/sandbox/runs/` to `A/runs.sandbox-2026-10/`; `.gitignore` gains `agents/*/runs.*/` (the existing `agents/*/runs/` pattern does not cover renamed folders, and the 61 MB of trial runs must stay out of git). In the archive, `sandbox/WALKTHROUGH.md` gets one line pointing to the walkthrough skill; `sandbox/walkthrough.json` is superseded by the manifest (C21).
- Notion, by a person (the token cannot and must not do it): disconnect the integration from "Editorial feedback loop" (hub, databases page, Walkthrough), from the taxonomy "Claim Tags — verified", from Claims to review and from both World affairs databases; keep it connected to U.S. Politics debate claims with edit access (the two columns, D21); rotate the token (EN-3); add a "History, superseded by Claim tagger" callout to the hub. Nothing is deleted or archived (hard rule 8).
- Reuse: git history keeps every moved file; `probe.mjs` proves the disconnection after C2.
- Delete: nothing; this change only moves files.
- Config: the 24 trial and sandbox ids (6 + 6 databases, database and data-source id each) join `protected_database_ids` in C2's file.
- Tests: lands together with C16, which deletes the scripts and tests that read the moved trial data (`T/rubric-init.test.mjs`, `T/seed.test.mjs`, `T/sandbox.test.mjs`); the two planted-lesson cases of `T/distill.test.mjs` (around lines 578-587) read the archived seed files until C13 deletes them.
- Accept: `npm test` green after C1 with C16; the tag exists; `git status` shows no runs content; after C2, the probe reports every trial, sandbox, taxonomy, Claims to review and World affairs id as 404 or 403.

**C16. Delete the trial-only code (moved to stage 0, with C1; amended: `transcript-check.mjs` stays)**

Goal: remove the scripts, tests and subagents that only served the trial, the research seed or the Runs database.

- Files and delete: scripts `S/seed-build.mjs` (after C3 moved `parseGeoSources`), `S/seed.mjs`, `S/rubric-init.mjs`, `S/snapshot.mjs`, `S/recard.mjs`, `S/run-card.mjs`, `S/sandbox.mjs` (its `runScript` and `SCRIPTS` come back in `walkthrough.mjs run`, C21; `sandboxRubric` is not needed because the demo rubric is built from the manifest's tag row); tests `T/seed-build.test.mjs`, `T/seed.test.mjs`, `T/rubric-init.test.mjs`, `T/snapshot.test.mjs`, `T/sandbox.test.mjs` (replaced by `T/walkthrough.test.mjs`, C21); `.claude/agents/claim-tagger-judge.md` and `.claude/agents/claim-tagger-distiller.md` (wired to nothing, and blocked by the `runs/**` deny, P3 #22); `wilson` in `S/lib/stats.mjs` and its test case (no caller, P3 #27); the settings entries of the deleted scripts.
- Keep (amended): `S/transcript-check.mjs`. P1 deletes it, but P3's headless report check (C18) and the walkthrough evals (C22) use it; it is not part of any subcommand. `package.json` `check:model` stays.
- Reuse: `seed.mjs` `rulebookProps` and `parseGeoSources` stay readable in the tag `trial-2026-10-14` for C7 to copy from.
- Config: none.
- Tests: the deleted files above.
- Accept: `npm test` green; `git grep` finds no import of a deleted module.

**C2. Config, paths and the probe's three target classes (amended by P2 1.3, R11, D24)**

Goal: one config accessor for every script, the mirror list and capability map in config, demo profiles under `A/demos/`, and a probe that knows protected, mirror and configured targets.

- Files:
  - `A/config.json`: the keys of section 2 are added (the new page's ids stay empty until C7); the trial's `notion.databases` entries leave and their ids join the protected list (C1).
  - `S/lib/config.mjs` (new): `loadConfig(root)` (moved from `S/pull.mjs:41`, re-exported there until every importer moves), `dbNames(config)` returning `['rulebook', 'tag_decisions', 'rule_changes', 'agent_settings', ...mirrors as 'mirror.<name>']`, `dbEntry(config, name)`, `mirrorEntries(config, { enabledOnly = true })`, `capabilityOf(config, tag)`, `groupOf(config, tag)` (R4), `isDemo(config)`. Every reader of `config.notion.databases[...]` goes through it: pull, plan (`openPlan`, `prepare`), apply (line 270), probe (`targetsOf`), guard, status, promote, distill, followup, cases-sync.
  - `S/lib/paths.mjs`: keep `ROOT_ENV`, `codeRoot`, `agentRoot`, `repoRoot`, `codeFile`, `runsDir`, `safeName`, `runId`, `ensureDir`, `isMain`; add `demosDir()` (`A/demos`) and `demoRoot(id)`; the `ROOT_ENV` comment now says it is set by `walkthrough.mjs run`.
  - `S/probe.mjs` (moved here from P1's C7, because stage 0 needs it): `targetsOf` returns three classes: protected (expect 404 or 403), mirror (expect 200, the key column, and from C7 on both write columns), configured (expect 200 and the title from `A/schemas/notion/setup.json`, C20; none before C7).
- Amended: P1's `profileRoot(name)` and the rename of `sandbox.mjs` to `profile.mjs` are dropped. Demo profiles live in `A/demos/<id>/`, and `walkthrough.mjs run` (C21) takes over `runScript` (P2 1.3).
- Reuse: `isProtectedDatabase` (`S/allowlist.mjs:154-157`), `readJson`, probe's `judge` and `summaryLine`.
- Delete: `EXPECTED_TITLES` in `S/probe.mjs`.
- Config: adds section 2's keys; removes the trial `notion.databases` entries.
- Tests: `T/paths.test.mjs`; `T/config.test.mjs` (new: the accessors; the `MIRROR_COLUMNS` intersection; the H6 keys and `anonymise` absent); `T/probe.test.mjs` (three classes; a mirror without write columns before setup is reported, not failed). The tests that read the real `A/config.json` (`T/eval.test.mjs:23`, `T/judge.test.mjs:25`, `T/propose.test.mjs:16`) switch to the committed fixture `T/fixtures/config.json`.
- Accept: `node S/probe.mjs` reports every protected id (old hub, sandbox, taxonomy, Claims to review, World affairs) as 404 or 403 and the U.S. Politics mirror as 200 with its key column, and exits 0.

**C19. Read-only dry run on the mirror (new: P3 section 3, "first real check"; R9)**

Goal: learn what the real mirror looks like, and whether its sources resolve, before anything writes to it, with a client that cannot write.

- Files: `S/probe.mjs` gains `--mirror <name> --dry-run`: one `retrieveDatabase` for the schema; a full query with `filterProperties` (key, claim, link, sources, is factual, and both write columns if present) through a `readOnly` client; 20 sample Geo source links resolved with `resolveGeoEntity`; writes `runs/dry-run/<run-id>/report.json` and `report.md` and prints one summary line.
- The report gives: row count (about 2,351) and requests used (about 24); whether every mapped column resolves, with its type (including "Geo Is factual"); duplicate Geo IDs; claims that share an exact normalised text (a preview of the Exact duplicate check, D17); how "Geo Sources" parses (links per claim, the share with no link, the 20 sample links and what each resolved to); whether the database is multi-source (a 2022-06-28 query that fails with a multi-source error, P3 #19); whether `filter_properties` works on 2022-06-28 (P1 could not verify it); whether Agent tags and Agent notes exist yet.
- Reuse: `createClient` with `readOnly`, `queryAll`, `retrieveDatabase`, `decodePage`, `richTextLinks`, `parseGeoSources`, `resolveGeoEntity`, `textHash` (`S/judge.mjs:125`).
- Delete: nothing.
- Config: reads `notion.mirrors` and `sources.resolver`.
- Tests: `T/probe.test.mjs` (the dry run against `T/fixtures/notion/fake-notion.mjs`; the request log holds only GET and query requests; a multi-source 400 is reported, not thrown). This change creates the fixture `T/fixtures/notion/db.mirror-usp.json` (built from the mirror's research schema) and adds the request log and the simulated multi-source 400 to `fake-notion.mjs`; C6 reuses and extends both.
- Accept: the report exists and the request log shows no write; Mika and the engineer read it before stage 1. If the mirror is multi-source, C6 adds `queryDataSource` before the first pull. Optional, after C9: judge 16 claims (2 calls) on Context-dependent to measure tokens per call and output per claim on the real prompt (P3).

### Stage 1: rubric, write rules, pull, apply, the new page, the judge, the first 50 claims

For the editor, nothing in this stage needs a decision: the first real rows wait in Your queue until the walkthrough (stage 2) is done, and nothing is lost while they wait (ED-11; the queue keeps undecided rows for as long as they are left, answer 3).

**C4. Rubric from the copy (amended by D1 and D23; P3 #1, #18)**

Goal: build the rubric from the 13 Issue rows of the taxonomy-shaped copy, whatever their status, polarity or category.

- Files: `S/lib/rubric-build.mjs`, `A/schemas/rubric.schema.json`.
  - `buildRubric`: drop the Verified filter (line 176); take the rows the pull already filtered by Work tags containing `work_tag`.
  - `rowToTag` (line 135): keep the row's Status (Verified, Proposed or empty) instead of stamping Verified; Category and Polarity may be empty; read the taxonomy's column names (Name, Description, When to use, Example Claims, Counterpart, Category, Polarity, Status, Geo Status, Geo Tag ID, Verified on, Evidence); `judged = rules.length > 0 && capability is text or source` (deterministic tags are computed, corpus tags never judged); `deterministic` and `needs_source_reading` come from `capabilityOf` and stay outside `tagHash` (unchanged).
  - Example Claims: one example per line; strip a leading "- " and surrounding quotes; lines that the conservative parser rejects (C7; the known case is Incorrect grammar's "255 legacy linked claims; see ...") are left out of `example_claims`, so they never reach the judge prompt or the canaries.
  - Rules in force (rule 5): the rubric built at setup is version 1 and its rules are in force as copied; every later rule change comes only through `applyLesson` after a gate PASS (C14); `--adopt-unjudged` (C15) never adds rules.
- Schema: `status` is Verified, Proposed or null; `polarity` and `category` are nullable; `human_only` stays (false for all 13).
- Reuse: `splitRules`, `composeWhenToUse`, `rehash`, `checkHashes`, `diffRubric`, `applyLesson`, `nextVersion`, `normaliseText`, `tagHash`, `ruleHash`, `rubricHash`.
- Delete: the Verified filter and the Verified stamp.
- Config: reads `tags` through `capabilityOf`.
- Tests: `T/rubric-build.test.mjs` with the new fixture `T/fixtures/notion/db.rulebook-copy.json`: the 13 rows of `claim-tags-verified.9oct.rows.json` plus the 13 Oct delta (the two status-less duplicate rows, Multi-sentence's Classification polarity, the non-claim Example Claims text).
- Accept: building from the fixture gives 13 tags: Context-dependent, Improperly sourced, Source inaccessible and Factually challenged judged; Unsourced deterministic; the six text tags and the two duplicate tags not judged; hashes check; the schema validates.

**C5. Allowlist, contract, guard and settings (amended by R11, R12, D17, ED-8; finishes H1-H3)**

Goal: make the write rules config-aware for the copy, the three agent databases and any number of mirrors, and close every connector write path.

- Files:
  - `S/allowlist.mjs`: the static constants become config-aware: `assertWritable(db, prop, value, { schema, ctx, config })`; the closed `DATABASES` list (line 16) becomes `dbNames(config)`.
    - rulebook: `WRITABLE = ['When to use']` (a promote PASS or a confirmed restore, checked by gate evidence); `SETUP_CREATE_ONLY` = the 13 copy properties (ctx.setup plus the `runs/SETUP` marker).
    - tag_decisions writable: Claim, Key, Tag, Claim link, Agent proposal, Agent confidence, Agent reason, Rulebook edition, Follow-up; `FOLLOW_UP_FIELDS = ['Follow-up']` (the only field a decided row accepts).
    - rule_changes writable: Lesson, Tag, Rule, Kind, Current text, Proposed text, Safety check result, Supporting rows, Status (Live and Rolled back; Proposed on create).
    - agent_settings writable: Rulebook edition, Last run summary; on create (setup only): Name.
    - mirror (every `mirror.<name>`): update only; the property must be in `MIRROR_COLUMNS` and in `Object.values(write_columns)`, with schema type `rich_text`; creates only when `isDemo(config) && ctx.setup` (a demo's claims table).
    - Demo setup exception (R12, rule 1): `DEMO_SETUP_CREATE_ONLY.tag_decisions = ['Tag outcome', 'Your reasoning']`, accepted only on a create, only with ctx.setup, only when `isDemo(config)` and the demo root holds `runs/SETUP`. Every other path refuses these names.
    - `EDITOR_NAMES` = Tag outcome, Why wrong, Your reasoning, Editor wording, Paused, plus the Status values Approved and Rejected (D4 removes Decided by, Decided at, Approved by, Paused by, Reason, Weekly cap and Owner together with their columns).
    - `isProtectedDatabase` is unchanged; the mirror is no longer protected (D3).
  - `S/lib/notion-contract.mjs` `REQUIRED_OPTIONS`: rulebook Work tags includes Issue; the Tag select includes every tag name in `rubric.json` (checked at pull); Agent proposal (Applies, Does not apply, Can't tell); Tag outcome (Applies, Does not apply); Why wrong (Agent slip, Rule unclear, Rule should change); Follow-up (Fixed, Still wrong); Kind (Clarify wording, Change the rule, Initial rules); Status (Proposed, Approved, Rejected, Live, Rolled back).
  - `S/hooks/guard.mjs` (amended by R11: no connector setup path is left): the matcher covers every Notion connector tool (`mcp__.*notion-.*`, H3); `decide` allows only read tools (names `notion-fetch`, `notion-search`, `notion-query-*`, `notion-get-*`, `notion-list-*`) and denies every other tool with a message naming the script to use instead; it reads no config and no state, and fails closed. Keep `decide` and `hookOutput`; delete `armedBatches`, `decideCreate`, `decideUpdate`, `decideSetupPage`, `protectedMention` and `editorWrite` (all writes are denied, so they decide nothing). This also closes P3 #17 (the guard ignored the profile).
  - `.claude/settings.json`: the final shape below (H1-H3 finished; C21's entries included).
- Reuse: `isProtectedDatabase`, `assertWritable`, `dbNames`, `isDemo`.
- Delete: the six-table `DATABASES` constant and the trial-only per-table constants (Claims, Runs, the old Rulebook columns); `SEED_ONLY` and `SEED_CREATE_ONLY` become `SETUP_CREATE_ONLY` and `DEMO_SETUP_CREATE_ONLY`.
- Config: removes `notion.setup_page_parents` and `notion.setup_content_pages`.
- Tests: `T/allowlist.test.mjs`; `T/mirror-write-allowlist.test.mjs` (new, P3: any column other than Agent tags or Agent notes is refused at plan, at apply and by the REST client's `writeGuard`; so is any create on a non-demo mirror; the demo exception is refused without ctx.setup, without the marker, outside a demo profile, or on an update); `T/notion-contract.test.mjs`; `T/guard.test.mjs` (every write tool denied under any server prefix; reads allowed; no state read).
- Accept: `npm test`; `/permissions` shows the lists below.

Final `.claude/settings.json` (`<N>` = the Notion connector prefix that `/permissions` shows, today `mcp__16f81eb6-6eb4-423e-9e64-a5cb678b0953__`):

```json
{
  "permissions": {
    "allow": [
      "Read(agents/**)", "Read(docs/**)", "Read(tests/**)",
      "<N>notion-fetch", "<N>notion-search", "<N>notion-query-data-sources", "<N>notion-get-async-task",
      "Bash(node --test:*)", "Bash(npm test:*)",
      "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git add agents/claim-tagger:*)", "Bash(git commit:*)",
      "Bash(node agents/claim-tagger/scripts/pull.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/sources.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/judge.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/propose.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/apply.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/verify.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/distill.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/cases-sync.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/eval.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/followup.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/probe.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/transcript-check.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/walkthrough.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/status.mjs)",
      "Bash(node agents/claim-tagger/scripts/status.mjs --check)",
      "Bash(node agents/claim-tagger/scripts/status.mjs --run:*)",
      "Bash(node agents/claim-tagger/scripts/promote.mjs --lesson:*)",
      "Bash(node agents/claim-tagger/scripts/promote.mjs --finalize:*)",
      "Bash(node agents/claim-tagger/scripts/promote.mjs --abort:*)"
    ],
    "ask": [
      "Bash(node agents/claim-tagger/scripts/setup.mjs:*)",
      "Bash(node agents/claim-tagger/scripts/status.mjs --unpause:*)",
      "Bash(node agents/claim-tagger/scripts/status.mjs --restore-rulebook:*)",
      "Bash(node agents/claim-tagger/scripts/status.mjs --adopt-unjudged:*)",
      "Bash(node agents/claim-tagger/scripts/promote.mjs --rollback:*)"
    ],
    "deny": [
      "Read(**/.env*)", "Read(.env)", "Read(agents/**/anonymise.local.json)",
      "Write(agents/claim-tagger/runs*/**)", "Edit(agents/claim-tagger/runs*/**)",
      "Write(agents/claim-tagger/demos/**)", "Edit(agents/claim-tagger/demos/**)",
      "<N>notion-create-pages", "<N>notion-update-page", "<N>notion-move-pages", "<N>notion-duplicate-page",
      "<N>notion-delete-pages", "<N>notion-restore-pages",
      "<N>notion-create-database", "<N>notion-update-data-source", "<N>notion-delete-databases",
      "<N>notion-create-view", "<N>notion-update-view",
      "<N>notion-create-comment", "<N>notion-update-comment", "<N>notion-delete-comment",
      "Bash(curl:*)", "Bash(git push:*)", "Bash(cat .env:*)", "Bash(grep * .env:*)", "Bash(type .env:*)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__.*notion-.*",
        "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/agents/claim-tagger/scripts/hooks/guard.mjs\"" } ]
      }
    ]
  }
}
```

The hook denies any Notion write tool the deny list does not name (attachments, folders, skills and the like).

**C6. Pull (amended by D3, D17, D23; P3 #12, #19)**

Goal: pull the copy, the agent's databases and every enabled mirror into the local files the other scripts read, keeping link targets and nothing more.

- Files: `S/pull.mjs`.
  - Mirrors: each enabled mirror is queried with `filterProperties` (key, claim, link, sources, is factual, both write columns; property ids from `retrieveDatabase`). `norm/claims.jsonl` rows become `{ mirror, geo_id, page_id, notion_url, claim, geo_url, source_links, sources_count, is_factual, agent_tags, agent_notes }`; `source_links` comes from `richTextLinks`, and `sources_count` from `columns.sources_count` when set, else the number of links. The file name stays, so `judge.loadItems` and `cases-sync.claimTexts` keep working. A duplicate Geo ID within one mirror fails (exit 2, as today at line 416); across mirrors it is allowed.
  - If C19 found the mirror multi-source (P3 #19): add `queryDataSource(dataSourceId, opts)` to `S/lib/notion-rest.mjs` on the builder's API version and use it for that mirror only.
  - `rulebookRows`: the copy's column names, filtered by `work_tag`.
  - Queue rows: the 12 columns listed in C20; `decided_at` is the page's `last_edited_time` (there is no Decided at column). Lessons: `supporting_keys` parsed from Supporting rows (the Key at the end of each line, format in C13); `created` from `created_time`. Settings: paused, rulebook_edition, last_run_summary.
  - `computeDrift`: ignore tags that have no rules on both sides (D23).
  - LATEST (P3 #12): `latestPullId` takes an optional list of needed files (for example `['claims']`), and `resolvePullDir` (`S/judge.mjs:158-164`) asks for the newest pull that holds `norm/claims.jsonl`, so a partial pull never breaks a judge run.
  - Retention: keep the last 20 pulls and every pull an unfinished run references.
- Reuse: `loadPull`, `findSchema` (with its fallback of d195bd4), `indexRows`, `editorSnapshot`, `schemaProblems`, `computeDrift`, `latestPullId`, `rulebookRows`, `keyProperty`, `isDecided`, `decodePage`, `richTextLinks`, `dbEntry`, `mirrorEntries`.
- Delete: the normaliser of the trial Claims columns (Claim title, Sources count, Source URLs, the Agent tags relation), Stage and the other formula and rollup fields, the queue's removed columns.
- Config: stops reading the trial `notion.databases` names.
- Tests: `T/pull.test.mjs`; `T/multi-mirror-pull.test.mjs` (new, P3: two mirrors with different column names, one Geo ID in both, one text in both; links kept; counts derived). Fixtures under `T/fixtures/notion/`: `db.rulebook-copy.json` (from C4) and `db.mirror-usp.json` (from C19); new `db.mirror-wa.json` (sources as links, no count column); rewritten `db.tag_decisions.json`, `db.rule_changes.json`, `db.agent_settings.json`; deleted `db.runs.json`, `db.claims.json`, `db.rulebook.json`; `fake-notion.mjs` takes its databases from config, and its request log (C19) gains P3's assertion "no write outside the allowed columns or to a protected id".
- Accept: `pull --all` against the fakes writes the norm files; the mirror is read with filtered properties only.

**C12. Plan, apply, verify (amended by R7; moved before C7 because setup rows go through apply)**

Goal: one apply command that checks, writes, reads back and verifies, with the trust breaker reduced to a warning.

- Files:
  - `S/plan.mjs`: `check` becomes the exported `checkPlan()` (validation, allowlist, `checkGateEvidence`); mirror ops use the database key `mirror.<name>`.
  - `S/apply.mjs`: calls `checkPlan` itself (the separate `plan.mjs check` step goes); keeps the pre-pull reuse, the ledger, `--retry` and `--dry-run`; a missing token is exit 2 (no connector batches); the pre- and post-pulls of mirrors are filtered to the touched columns and pages; the client gets the allowlist's mirror check as `writeGuard` (C3), so a mirror update naming any other property is refused before it is sent. `markdownToBlocks` moves to `S/lib/notion-blocks.mjs` (C20) and is imported back.
  - `S/verify.mjs`: editor-field differences go to `verify.json` and the summary line as a warning; no `runs/PAUSED` and no exit 5 (R7: with one editor it would mostly catch the editor's own clicks; exit 5 stays reserved).
- Reuse: `openPlan`, `prepare`, `readPlan`, `resolveOps`, `PlanError`, `runDirOf`, `checkGateEvidence`, `editorSnapshot`, `markdownToBlocks`, the `--retry` read-before-send behaviour.
- Delete: `armedState`, `disarm`, `writeBatches`, `toConnectorProperties`, the `MAX_BATCH` constant, `APPLYING.json` (P1 rows 21, 22).
- Config: none.
- Tests: `T/plan.test.mjs`, `T/apply.test.mjs`, `T/verify.test.mjs` (an editor-field change gives a warning and exit 0).
- Accept: a plan with one mirror update applies, reads back and verifies; a plan naming a third mirror column is refused at build, at apply and by the client.

**C17. Documentation and the hard rules (amended by D23, R16, P2 2.1, ED-2, ED-6, ED-10; moved before the first mirror write)**

Goal: the rules, the runbook and the skill say what the new system does before it first writes the real mirror (C7's `mirror-columns`).

- Files:
  - `CLAUDE.md`: rules 1, 4, 5 and 10 as in section 3; the opening paragraph names the new "Claim tagger" page; the agents table entry of section 3.
  - `A/AGENT.md`: one runbook (P3 #30: today it exists three times): the steps table; the contracts (cell store `runs/judgments/<key16>/`, sources cache `runs/sources/`, per-run `calls.jsonl`, cards); "Models and runs" (adaptive runs, D19); "Safety checks" (P1 2.7 as amended: allowlist with the mirror rule, read-back, drift for tags with rules, pause, protected ids and the probe, a guard that denies every connector write, the slim gate evidence, one `PROMOTING.json`, trust breaker as a warning); a section on demo profiles (P2).
  - `.claude/skills/claim-tagger/SKILL.md`: the output-style paragraph under the title and the "Reporting style" section, both verbatim from P2 2.1 (R16; the text is in W4 section 11); two examples inline and all of them in `references/report-examples.md` (new; the content of `../debate/inputs/report-examples.md`); the subcommand sequences below; "Sandbox mode" and "Evidence" deleted ("Demo mode" comes in C22); a new rule: a subcommand that finds its own unfinished run resumes it instead of starting another (P2).
  - `README.md`: the install steps name the new page and the token's connections; the routine loop lists the new subcommands; the runbook itself lives in AGENT.md only.
  - `A/schemas/notion/as-built.md`: a section for the "Claim tagger" page, generated from the setup plan's request log (C7).
- Subcommand sequences (P1 2.6, amended). `A` is `apply.mjs --run <id>`; every subcommand starts with `status.mjs --check`.

| Subcommand | Sequence |
|---|---|
| `setup` (once, engineer) | `probe`; `setup api-check --parent <link>`; the engineer creates `runs/SETUP`; `setup page --parent <link>`; `setup databases`; `setup views`; `setup rulebook --from setup/taxonomy-issue.json`, then A; `setup mirror-columns --confirm`; `setup evals`; `setup rubric`; `setup settings`, then A; `setup finish` (probe, then removes `runs/SETUP`); `status` |
| `status` | `pull --all`; `status` |
| `tag [--tags X] [--limit N]` | `pull`; `sources` (only when a source tag is in scope); `judge --pass all`; `propose`; A |
| `draft-rules <tag>` | `pull`; `distill --draft-rules <tag>`; A (one tag per run, chosen by the editor; `all` is an engineer option only, C13) |
| `distill` | `pull`; `distill`; A |
| `promote <lesson> [--strict]` | `pull`; `promote --lesson`; A; `promote --finalize`; commit; `followup`; A |
| `rollback <lesson>` | `promote --rollback --confirm` (asks the person); A; commit |
| `follow-up <lesson>` | `pull`; `followup`; A (only to repeat promote's automatic last step after a run that stopped before it, ED-10) |
| `demo <step>` | the same sequences through `walkthrough.mjs run` (C22) |

Who types: the editor types every row of this table except `setup`, which the engineer runs once and repairs when it breaks (ED-2).

- Reuse: P2 2.1's text; P1 2.7.
- Delete: SKILL.md "Sandbox mode" and "Evidence"; the runbook copies in README.
- Config: none.
- Tests: none here; the headless report check is C18.
- Accept: Mika reads rules 1, 4, 5 and 10 (D23 approved their content; the rule 5 wording note is open); CLAUDE.md, AGENT.md and SKILL.md name the same subcommands (a grep).

**C20. Notion builder on API 2026-03-11, the API check and the blocks (new: P2 1.3-1.4; R11, R12; amended by ED-4, ED-8, answer 5)**

Goal: one deterministic builder that creates a page, its databases (with column descriptions), its views and its content from a setup plan, for production setup and for every demo, gated by one real check of the API version.

- Files:
  - `S/lib/notion-rest.mjs`, methods of a client created with `notion.builder_api_version`: `createView({ dataSourceId, name, type, createDatabase: { parentPageId, afterBlockId }, filter, sorts, configuration })` (`configuration` carries the visible columns, their order and, for Lessons waiting, wrapping on), `updateView(id, ...)`, `listViews({ databaseId })`, `listChildren(blockId)` (all new); `appendBlocks` sends `position` instead of `after` on 2026-03-11; "never send twice" covers POST /views; on resume, `listChildren` adopts a create that landed but whose answer was lost (P2). P2's `updateDataSource` is dropped (the final schema has no relations, R12); P2's `createPageUnder` is C3's `createPage({ parentPageId })`.
  - `S/lib/notion-blocks.mjs` (new): a small Markdown subset to Notion blocks (h2, h3, paragraphs with bold, italic, code and links, bullets, numbered items, callout, pipe table, divider, `{{view:<name>}}` markers) and the page lint that `walkthrough verify` runs (W4 section 9). `markdownToBlocks` moves here from `S/apply.mjs` and becomes its paragraph and list part.
  - `S/lib/notion-build.mjs` (new): `planStructure({ schema, template, parentPageId })` writes the setup plan, every request in order, before anything is sent; `runStructure(plan, { client, record })` sends it and records each created id at once, so a crash resumes; `renderPreview(plan)` writes `preview.md`. Used by `setup.mjs` (C7) and `walkthrough.mjs` (C21).
  - `A/schemas/notion/setup.json` (new; R12: one schema for production and demo): the four database definitions (the copy with the taxonomy's 13 properties; Tag decisions, 12 columns; Rule changes, 11 columns, Lesson ID only in production; Agent settings, 4 columns), their select options and column descriptions (at most 280 characters), each default view's visible columns (at most 5, wrap off; the demo's Rulebook view hides Counterpart, a column that stays in the schema, ED-8), the four views, defined once and used with the same names on the production page and on every demo page (ED-4; P1 2.4): Your queue (Tag decisions; Tag outcome is empty; grouped by Tag; sorted by Agent confidence, lowest first; shows Claim, Tag outcome, Why wrong, Your reasoning); Needs your note (Tag decisions; Why wrong is Rule unclear or Rule should change, and Your reasoning is empty); Lessons waiting (Rule changes; Status is Proposed or Approved; shows Lesson, Current text, Proposed text and Status, with wrapping on so that both texts are read in place, answer 5); Rulebook (the copy, all rows). On a demo page, Your queue and Lessons waiting are the two linked views inside steps 3 and 5, and Needs your note and Rulebook are the views of the Tag decisions and Rulebook tables (W4 section 7). The file also holds the demo claims table (the mirror column map).
  - The API check, `setup.mjs api-check --parent <link>` (R11): one real check against a scratch page under a parent a person names at run time (D24). Its steps and pass rule are in W4 section 4; the result goes to `A/runs/api-check.json`. The builder creates views only when the check passed for the pinned version; otherwise it takes the fallback of W4 section 4.

The databases in `setup.json` (P1 2.3, amended by R12 and R15; no formulas, rollups or relations):

| Database | Columns (type), and who writes them |
|---|---|
| Rulebook copy, "Claim Tags — Issue (copy)" | The taxonomy's 13, same names and types: Name (title); Description, When to use, Example Claims, Counterpart, Geo Tag ID (text); Evidence (url); Category (select: Nature, Form, Quality, Style, Tone, Format, Meaning, Usage, Check); Polarity (select: Classification, Positive, Issue); Status (select: Verified, Proposed); Geo Status (select: Existing in Geo, To be created, Implemented differently); Work tags (multi-select: Pipeline benchmark check, Issue); Verified on (date). The two relations to the claim tables are left out. Rows are created once at setup; the agent then writes When to use only |
| Tag decisions | Agent: Claim (title, the claim text), Key (text, `<Geo ID>::<Tag>`), Tag (select, the 13 names), Agent proposal (select: Applies, Does not apply, Can't tell), Agent confidence (number), Agent reason (text), Claim link (url of the mirror page), Rulebook edition (text), Follow-up (select: Fixed, Still wrong). Editor: Tag outcome (select: Applies, Does not apply), Why wrong (select: Agent slip, Rule unclear, Rule should change), Your reasoning (text) |
| Rule changes | Agent: Lesson (title), Lesson ID (unique id, prefix RC; production only, and only if the API check's unique-id step passed), Tag (select), Rule (text, for example "Context-dependent rule 4" or "Wordy when to use"), Kind (select: Clarify wording, Change the rule, Initial rules), Current text, Proposed text, Safety check result, Supporting rows (text). Editor: Editor wording (text). Status (select: Proposed, Approved, Rejected, Live, Rolled back): the editor sets Approved and Rejected, the agent the others |
| Agent settings | Editor: Paused (checkbox). Agent: Name (title, set at setup), Rulebook edition, Last run summary (text) |

- Reuse: `createClient`, `request`, `createUncertain`, `splitRichText`, `MAX_CHILDREN`, `markdownToBlocks`.
- Delete: nothing.
- Config: reads `notion.builder_api_version`.
- Tests: `T/notion-rest.test.mjs` (views, children, `position`, no second POST /views after a lost answer); `T/notion-blocks.test.mjs` (new: every block kind; the lint: headings, at most 4 columns per table, cells of at most 100 characters, banned phrases, no shorthand codes or time estimates, the four help pieces); `T/notion-build.test.mjs` (new: the plan is written before any request; a crash after the third create resumes without sending it again; the fallback without views); `T/fixtures/notion/fake-notion.mjs` serves `/v1/views` and `initial_data_source` creates.
- Accept: `api-check` passes against a scratch parent, or its failure selects the fallback and names the step that failed. The check also tries wrapping on in a view (W4 section 4.2); if only that fails, the views are still built and one line is added to the page (turn on Wrap cells in Lessons waiting).

**C7. Notion setup (amended by R11, R12, D21, D24, ED-8, answer 5)**

Goal: create the new "Claim tagger" page with its four databases and views, the 13 copy rows, the settings row, the two mirror columns, the evals and the first rubric, through setup plans and the builder, with no connector write.

- Files: `S/setup.mjs` (new). Every Notion write is either a builder request from a setup plan (C20) or a row plan applied by `apply.mjs` with ctx.setup.
  - `api-check --parent <link>` (C20).
  - `page --parent <link>`: the plain page under the parent the engineer names (no default), with a short text and links to the four views.
  - `databases`: the copy ("Claim Tags — Issue (copy)"), Tag decisions, Rule changes and Agent settings from `setup.json`; the database ids (and the data-source ids, which the 2026-03-11 response carries) go into config. Rule changes gets the Lesson ID unique id with prefix RC only when the API check's unique-id step passed; otherwise lessons are named by title (R15).
  - `views`: the four views of `setup.json` (C20) when the API check passed; otherwise the page gets P1's four-line checklist for the editor (R11), whose Lessons waiting line names its four columns (Lesson, Current text, Proposed text, Status) and says to switch wrapping on (answer 5).
  - `rulebook --from setup/taxonomy-issue.json`: a plan creating the 13 copy rows. The rows file is written by the skill from a connector read of the taxonomy's Issue rows (an SQL projection; the view query fails on the relations, verification notes), so the token never needs taxonomy access. The property shape follows `seed.mjs` `rulebookProps` from the tag, retargeted at the taxonomy's names.
  - `mirror-columns --confirm` (D21): for each enabled mirror, `updateDatabase` adds only the missing write columns, as `rich_text`; refuses (exit 2) a column of the same name with another type; never touches any other property; logs the request and reads the schema back. It is the only schema write ever made to a real database. Precondition: Mika has confirmed with the owner of the Geo-to-Notion refresh job that added columns and page ids survive a refresh (D21).
  - `evals`: canaries from the copy's Example Claims with the conservative parser plus a committed `A/evals/canaries.exclude`; the archived Context-dependent negative canaries (from Self-contained examples) are kept; the archived cases for the 13 tags are imported and re-stamped with `cases-sync` `buildCase` logic; the audit decisions (the Claims to review export, anonymised with `scrubNames` and `A/anonymise.local.json`, H5) go to `A/evals/audit.jsonl` as draft-rules input. Canaries are the rulebook's own examples, not held out (P3 #8): cards call them "examples".
  - `rubric`: `buildRubric` from the copy pull; writes `rubric.json`, `rubric.lock`, `history/` and `CHANGELOG`.
  - `settings`: a plan creating the Agent settings row (Name, and Rulebook edition from the new rubric; Paused stays unticked).
  - `finish`: runs the probe and removes `runs/SETUP` (H4).
  - `--demo <id>` (called only by `walkthrough.mjs start`, C21): the same row plans fed from the manifest into `A/demos/<id>/`: the copy (1 row), the claims table (7 mirror-shaped rows; creates are allowed because the profile is a demo), Tag decisions (7 rows; the 5 earlier decisions carry Tag outcome and Your reasoning, the R12 exception of C5), Agent settings (1 row); the rubric is built with `buildRubric` from the manifest's tag row.
- Reuse: `buildRubric`, `rehash`, `checkHashes`, `writeLock` and `appendChangelog` (exported from `S/promote.mjs`), `buildCase`, `scrubNames`, `openPlan`, `checkPlan`, `planStructure`, `runStructure`.
- Delete: nothing (seed and rubric-init went in C16).
- Config: writes `notion.page_id`, `notion.rulebook` and `notion.databases` ids.
- Tests: `T/setup.test.mjs` (new: each subcommand against the fakes; `mirror-columns` refuses without `--confirm`, refuses a same-name column of another type and touches no other property; the rows plan refuses every editor field; the demo plan accepts Tag outcome and Your reasoning only on creates in a demo profile that holds the marker); `T/probe.test.mjs`.
- Accept, on the real workspace: the page exists under the chosen parent with four databases and the four views (or the checklist); the copy's 13 rows match the taxonomy's Issue rows field by field (read back); Agent settings has one row; `probe` exits 0 and sees both write columns on the mirror; `rubric.json` has 13 tags, 4 judged; `status` shows rulebook edition 1 in force.

**C8. Per-group judgment store (amended by R4)**

Goal: cache judgments per tag group, keyed only by what changes that group's answers, so neither a rule change nor a CLI update re-judges the whole mirror.

- Files: `S/lib/cells.mjs` (new), replacing four duplicate readers: `makeDoneCheck` (judge), `loadJudgments` (propose), `loadSide` (eval) and `readRuns` (followup).
  - Key (R4): `h16(pyJson({ driver, model, effort, pass, prompt_version, group, tags: [{ name, tag_hash }] sorted by name }, { sortKeys: true }))`, where `tags` are the group's judged tags. The CLI version is recorded on every line, not keyed (P1, P3 1e).
  - Layout: `runs/judgments/<key16>/meta.json` (the key's inputs) and `run-<n>.jsonl`; one line per item: `{ id, item_hash, status, tags: [{ name, decision, p, rule_ref, rule_hash, trigger, reason, basis }], call: { run_id, batch, call_tags, usage, cli_version } }`; the last line for an item wins. `item_hash` is `textHash(claim)` in the text pass and `h16(claim + bundle_hash)` in the source pass, so changed sources re-judge. A few dozen files instead of about 30,000 at 2,351 claims.
  - One LOCK per store. `--whole-pass` (strict only) adds `context_hash`, the hash of the sorted tag hashes of every group in the call.
- Reuse: `configId`, `promptVersion`, `h16`, `pyJson`, `textHash`, `takeLock`, `appendJsonl`, `readJsonl`.
- Delete: nothing yet; C9 deletes the old layout's code.
- Config: reads `judge.groups`.
- Tests: `T/cells.test.mjs` (new: a change to one tag's hash changes only its group's key; a CLI version changes no key; the last line wins; the lock); `T/hash.test.mjs`.
- Accept: on the fakes, a G1 rule change leaves the G2 and S stores as cache hits; a CLI version bump hits every store.

**C9. Judge (amended by D17, D19/R1, R4, R8; P3 #16, #20)**

Goal: judge only tags with rules in force, per group, with one run for every claim and re-reads only for unsure answers, and record usage per call.

- Files: `S/judge.mjs`, `A/prompts/judge.md`.
  - Scope: `scopeOf(rubric, config)` returns the judged tags per group (`G1`, `G2`, `S`), the code-decided tags (Unsourced, Exact duplicate) and the not-checked ones (Semantically duplicated; tags without rules). A group without a judged tag is skipped.
  - Flags: `--pass text|source|all`; `--tags a,b` (expands to the groups that hold them; a group is always judged whole, because its key covers all its tags); `--runs-max`; `--whole-pass` (strict); `--reference <n>` (D19 calibration: n runs for every claim, no cap); `--refresh` (ignore the cache for the selected groups).
  - Batching: run 1 for every item without a run-1 line in its group's store; batches of `batch_size` per group (one claim per call in S); the system prompt per group with `renderSystemPrompt` and `renderTag`, cached under `runs/judgments/prompts/<h16>.md` with `ensureSystemPrompt`'s checks; replies checked with `validateJudgeOutput(..., { modelTags: groupTags })`.
  - Adaptive runs (D19, R1): after run 1, a cell is unsure when its decision is `ask_editor` or its `p` lies strictly inside `judge.rerun.band`. A claim with an unsure cell in a group is a candidate for run 2 of that group; at most `max_share` of the run's claims get run 2, lowest margin first (margin = the smallest `|p - 0.5|` among its unsure cells; `ask_editor` counts as 0); run 3 only for a claim and group whose runs 1 and 2 disagree on an unsure cell. Applied cells with high confidence are not re-read (D19 narrows D13). Candidates beyond the cap keep their one run and are marked `capped` in `run.json`; propose queues them if they are still unsure.
  - Calibration (D19), once, on the first 200 real claims: `judge --tags Context-dependent --limit 200 --reference 3`. The run card compares the adaptive verdict (run 1 plus the capped re-reads it would have made) with the 3-run majority: the share of claims with a trigger, the share re-read, the cells whose verdict differs, and how many of those would have stayed out of the queue. Mika decides whether to widen the band or raise the cap (proposal: act when more than 2% of cells change verdict outside the queue). About 50 extra calls at 8 claims per call, because run 1 is shared.
  - Code-decided tags (`codeDecidedTag`, extended): Unsourced from the sources count (basis `deterministic`); Exact duplicate (D17): the same duplicate key (new `duplicateKey(text)`: `normaliseClaimText`, lower case, whitespace and punctuation collapsed) on another Geo ID in any enabled mirror gives `apply`, p 1.0, basis `mirror_hash`, with the other claim in the reason; no match gives `cannot_tell`, basis `no_corpus`; Semantically duplicated is always `cannot_tell`, basis `no_corpus`; the source tags' pre-decisions come in C10 (basis `fetch`).
  - Usage (R8, P3 #16): one line per call in `runs/<run-id>/calls.jsonl` (`{ group, pass, batch, items, attempts, usage: { input, cache_write, cache_read, output }, list_usd, duration_ms, cli_version, status }`, usage summed across attempts), replacing the per-config `ledger.jsonl`; `run.json` keeps args, items, passes, totals and the resume command; dollars appear only as "list-price equivalent" in `run.json`.
  - CLI version (P3 1e): recorded per line; when it differs from a store's last line, judge prints one warning and `status` suggests judging the canaries once (`judge --items eval`); invalidating stays manual (`--refresh`).
  - Prompt (P3 #20): `prompts/judge.md` stops naming the old scope ("Tags about sources ... and Editor verified are decided elsewhere") and the "Predictive rule 1" example; the in-scope tags and a neutral rule reference (`<Tag> rule <n>`) are injected.
  - `--smoke` stays for `npm run check:model` only (P1 row 7).
- Reuse: `renderSystemPrompt`, `renderTag`, `ensureSystemPrompt`, `validateJudgeOutput`, `withRecordedOptions`, `loadRunToResume`, `codeDecidedTag`, `loadItems`, `resolvePullDir`, `textHash`, `normaliseClaimText`, `takeLock`, `lib/cells.mjs`, `seedFromString` and `shuffle` (`S/lib/rng.mjs`).
- Delete: `computeConfig`'s whole-rubric key, `makeDoneCheck`, the per-config `ledger.jsonl`, the fixed `judge.runs` loop, the batch cost copied into every item (line 815).
- Config: reads `judge.runs_max`, `judge.rerun`, `judge.groups`, `judge.prompts`, `tags`; removes `judge.runs`, `judge.smoke_runs` (smoke stays one run, as today), `judge.prompt`, `thresholds`, `scope.*`.
- Tests: `T/judge.test.mjs` (grouping, per-group cache hits after a one-tag change, two passes, scope by capability); `T/adaptive-runs.test.mjs` (new, P3: run 1 for all, run 2 only on triggers and for at most 30% of claims, lowest margin first, run 3 only on disagreement, one call line per call with usage summed over attempts, resume after exit 75); `T/capability.test.mjs` (new, P3: a duplicate "cannot tell" is never queued; an Exact duplicate match is queued; tags without rules are never judged); `T/fixtures/fake-claude.mjs` reports per-call usage and keeps reading the "Tags you must decide" section; `T/fixtures/judge/` moves to the cell-store layout.
- Accept: on the fakes, 100 claims of which 20 are unsure take about 17 calls against 13 for one pass (about 1.3x); on the real mirror, the stage-1 milestone.

**C11. Propose (amended by D17, D18, ED-9)**

Goal: write the two mirror columns for every judged claim and a queue row for every unsure cell, with no cap.

- Files: `S/propose.mjs`.
  - `decideVerdict` is called with the number of runs the cell has (1, 2 or 3). `isLowConfidence`: unsure = `ask_editor` or error, runs not unanimous, or a mean p inside `judge.rerun.band`; `cannot_tell` on a corpus tag is never unsure. `proposalFor` returns one of Applies, Does not apply, Can't tell (the same words as Tag outcome).
  - `notesFor(claim)` (new; it replaces `readinessOf`, whose readiness word no longer starts Agent notes) builds Agent notes as at most two short lines, so that the column the whole team reads stays one glance per claim (ED-9). Line 1: the tags that apply and are not waiting for a person (the agent is sure, or an editor decided), comma-separated, or `no tags`. Line 2, parts joined with " · ": how many tags wait for an editor (an unsure cell or an error, each with a queue row); what was not checked; the rulebook edition. "Not checked" counts by kind: source tags while the source pass has not run or the source link could not be resolved, duplicate tags whose verdict is `cannot_tell` with basis `no_corpus` (C9: Semantically duplicated always, and Exact duplicate when its free exact-text check found no match, which is not proof), and text tags without rules in force; the part is left out when everything was checked. Per-tag confidence, rule and reason are not in the notes: they live in the queue row (Agent reason) and in the run files. No readiness word begins the notes any more.
  - Claim ops: one update per mirror page of the Geo ID, writing Agent tags (comma-separated names of the tags that apply and are not waiting for a person: the agent is sure, or an editor decided and always wins; a tag that waits in Your queue is not written, so the team never reads a guess as a result, answer 2) and Agent notes (the two lines above, at most `notion.max_text` characters) only when they differ from the pulled values. Two examples, each the whole cell:

```
Context-dependent, Wordy
1 waits for an editor · not checked: 3 source tags, 2 duplicate tags · edition 2026-10-15.2
```

```
no tags
nothing waits for an editor · edition 2026-10-15.2
```

  - `claimColumns()` (new export, cut out of `run`'s claim-op block) so followup reuses it and its duplicate `liveColumns` goes (C15).
  - Queue (D18): create a row for every unsure text or source cell that has no row yet, and for every Exact duplicate match (D17), with no cap and no priority; update undecided rows (Agent proposal, Agent confidence, Agent reason, Rulebook edition); never touch decided rows (keep `guard: { undecided: true }`). Corpus tags and tags without rules never get a row. Agent reason: at most `queue.reason_max_words` words, then the rule and k/n runs; this is where the per-tag confidence, rule and reason live now that the mirror's notes do not show them (ED-9). The queue views sort by Agent confidence (C7).
- Reuse: `decideVerdict`, `isLowConfidence`, `leansApply`, `proposalFor`, `capLines`, `capWords`, `tagLine`, `recommendation` (now renders Agent reason).
- Delete: `priorityOf`, `mergeWhy`, `isoWeek`, `fullNote`, `readinessOf` (replaced by `notesFor`), the weekly-cap block (lines 589-606) and `runs/state/queue-week.json`, the "rule changed" detection (lines 539-541; the Rulebook edition column stays), the writes of Readiness, Tag confidence and Last judged.
- Config: reads `queue.reason_max_words`, `judge.rerun.band`, `tags`; removes `readiness`, `queue.weekly_cap_default`, `queue.why_max_words`.
- Tests: `T/propose.test.mjs` (P3: capability routing, a different number of runs per claim, no cap, the two mirror text columns, the two-line notes form with its counts, an unsure tag absent from Agent tags and counted in line 2, corpus and rule-less tags counted under "not checked" and never queued); `T/capability.test.mjs` (C9).
- Accept: on the fakes, every unsure cell gets a row and no confident one does; decided rows are untouched; mirror updates name only Agent tags and Agent notes; no Agent notes cell has more than two lines.

**C15. Follow-up and status (amended by D23, R8, ED-10; finishes H4)**

Goal: close the loop after a PASS at no model cost, and report state in the editor's terms.

- Files:
  - `S/followup.mjs`: judges the lesson's supporting claims under the live rubric (cache hits from the gate's candidate side, so 0 calls); writes Follow-up (Fixed or Still wrong) on the supporting rows, the claims' Agent tags and Agent notes through `claimColumns()` (C11), and Last run summary. It runs automatically as promote's last step after a PASS (P1 row 53; ED-10); `/claim-tagger follow-up` is the manual re-run, needed only to repeat the step after a run that stopped before it.
  - `S/status.mjs`: queue counts (open, decided, needs a note); lessons by status; the sources-cache summary (from C10); the PROMOTING phase; usage of the last runs (calls, tokens by kind, wall time and the share of a usage window once known, D22; the script prints these figures for the engineer, and the skill's three-part report leaves out durations and call counts, W4 section 11); `--adopt-unjudged` (D23): records edits made in the copy to tags without rules in force as a new rubric version (a new rulebook edition) with a changelog line, and refuses (exit 4) an edit that adds numbered rules to such a tag (first rules go through draft-rules or an Initial rules lesson and the gate, rule 5); `preflight` warns while `runs/SETUP` exists (H4). Drift on a judged tag (any column) still stops the run (exit 4) and names the column: a person reverts the edit in Notion until `status --adopt <tag>` exists (section 8).
- Reuse: `preflight`, `checkVerdict`, `lockState`, `buildRestorePlan`, `inspect`, `--unpause --confirm` and `--restore-rulebook --confirm` (both under ask, H2), `claimColumns`, `lib/cells.mjs`, `computeDrift`, `diffRubric`, `nextVersion`, `appendChangelog`.
- Delete: `liveColumns`, followup's same-tag regression block (the gate already checked those rows), `readRuns`, `STAGES` and the Stage counts.
- Config: none new.
- Tests: `T/followup.test.mjs` (0 calls after a gate; Fixed and Still wrong; the mirror columns); `T/status.test.mjs` (P3: the usage report; `--adopt-unjudged` adopts a Description edit and refuses new rules; the marker warning).
- Accept: on the fakes, follow-up after a PASS makes 0 calls and marks the rows; live acceptance after the first PASS in stage 2.

### Stage 2: distill, the draft-rules code, the gate, the walkthrough

For the editor, this stage is the walkthrough and nothing else (ED-6, ED-11): no drafted rules to approve and no real rows to decide until it is done. The draft-rules code is built and tested here on the fakes; it is used on real tags from stage 3 on.

**C13. Distill and draft-rules (amended by R5, R13, D7 as corrected, D17, ED-6)**

Goal: turn the editor's "the rule is the problem" decisions into at most three focused rule changes per run, and draft first rules for the six text tags that have none, one tag per run in the order the editor chooses.

- Files: `S/distill.mjs`, `S/cases-sync.mjs`, `A/prompts/distill.md`, `A/prompts/draft-rules.md` (new).
  - Grouping (R5): `groupRows` groups by (tag, cited rule) and keeps `why` (Rule unclear or Rule should change) on each row; `thresholdOf` needs `distill.min_claims` (2) distinct claims for either reason (D4: the owner-ruling route goes).
  - Cited rule (R13): `citedRule(row, tag)` takes the rule the editor names in Your reasoning first ("rule 4", with or without the tag name), then the agent's `<Tag> rule <n>` in Agent reason (the full-note field is gone). The demo's two rows form one group even when the agent cited rule 2 on one of them.
  - Large groups (R5): above 30 rows, newest first, rows with reasoning first, both outcomes represented; the group file records the keys shown, and the unseen rows go first next run. Counter-evidence (12 rows): same rule, opposite outcome first, not key order (P3 #15).
  - One Opus call per group may return up to 3 patterns, each with the row keys it rests on; a lesson's Supporting rows are only the rows it cites (P3 #15). At most `distill.max_lessons_per_run` (3) lessons per run, ranked by distinct supporting claims; the rest wait for the next run.
  - Plan: one Rule changes create per lesson: Lesson, Tag, Rule, Kind, Current text, Proposed text, Status Proposed, Supporting rows. Supporting rows format (new; P1 said "a list of keys"): one line per row, the claim shortened to 60 characters, " · ", then the row's Key; pull parses the trailing Keys (C6). If the text would pass `notion.max_text`, the remaining rows are listed in the lesson's page body and the column ends with "+ n more in the page". `lessonMarkdown` writes the page body with the supporting claims in full.
  - Fixes (P3 #28): the example claims are sent once; `run.json` records the start time before the model calls.
  - Draft rules (D7, corrected: 8 tags lack rules, not 9, and the two duplicate tags are corpus tags under D17, so the step covers 6: Multi-sentence, Trailing period, Improper capitalization, Incorrect grammar, Poor wording, Wordy): `distill --draft-rules <tag>` drafts the first rules of one tag, chosen by the editor, for a text tag with an empty When to use (ED-6: the editor never gets six drafted rulebooks at once). `--draft-rules all` runs the same code once per tag; it is an engineer option for tests and calibration, the skill never passes it, and the editor's path has no "all". Input: the copy row (Description, Example Claims, Counterpart, Category), the tag's rows in `A/evals/audit.jsonl`, and Context-dependent's When to use as a format example. `prompts/draft-rules.md` returns `{ preamble, rules[], note, open_questions }`; one Opus call per tag. Plan: one Rule changes row, Kind "Initial rules", Rule `<Tag> when to use`, Current text empty, Proposed text from `composeWhenToUse(...)`, Status Proposed. The report and the lesson's page body show the tag's example claims (the copy row's Example Claims) next to the drafted rules, so that the editor judges the draft against them. Before drafting, the tag's current copy row is adopted (the `--adopt-unjudged` code, C15).
  - `S/cases-sync.mjs`: `linkedLessons` matches by `supporting_keys`; `citedRule` as above.
- Reuse: `groupRows`, `buildInput`, `checkReply`, `distillGroup`, `ngramOverlap`, `lessonTexts`, `parseRuleLabel`, `targetCurrentText`, `thresholdOf`, `lessonMarkdown`, `composeWhenToUse`, `citedRule`, `ruleWhyOf`, `reasoningOf`, `buildCase`, `syncCases`, the dedupe against open lessons and the 8-word overfit check (P1).
- Delete: `link`, `--link`, `plan-link.jsonl`, `--demo-bad-lesson` and `lessonMarkdown`'s planted-lesson branch (with the two test cases that read the archived seed files, C1), the "Distill <date>" Runs row, `planRegression` and the "In regression suite" writes in cases-sync.
- Config: reads `distill.min_claims`, `max_lessons_per_run`, `overfit_ngram`, `effort`, `timeout_ms`; removes `distill.min_claims_rule_change` and `owner_ruling_at`.
- Tests: `T/distill.test.mjs` (P3: grouping by tag and rule, the rotation of large groups, several patterns per reply, support limited to cited rows, at most 3 lessons, the Supporting rows format); `T/cases-sync.test.mjs` (the editor's "rule 4" wins over the agent's "rule 2"; `linkedLessons` by keys); `T/draft-rules.test.mjs` (new, P3: the fake model drafts rules that become a Proposed row; the tag stays unjudged until its rules pass the gate; the taxonomy is never written; one tag per run, with `all` only as the engineer option; the example claims are in the report); `T/fixtures/loop/fake-claude.mjs` gains the draft-rules reply.
- Accept, on the fakes: `draft-rules <tag>` creates one Proposed row with numbered rules and its report shows the tag's example claims; the engineer option `all` creates the six rows. On the real workspace (stage 3): the editor picks one tag, and `draft-rules <tag>` creates one Proposed row with numbered rules; the next tag follows in a later run, in the editor's order.

**C14. Gate (amended by D20/R2, R4, R8, ED-8, ED-10; P3 #8, #14; answer 4)**

Goal: a cheap default gate with a light noise guard, and today's statistical gate behind `--strict`.

- Files: `S/eval.mjs`, `S/promote.mjs`, `S/lib/gate-evidence.mjs`, `A/schemas/card.schema.json`.
  - `evaluate({ mode: 'simple' | 'strict' })`. Simple mode checks the changed tag's group (R4: with per-group keys the group's other tags are re-judged too, so their cases are checked; other groups are identical by key):
    - S1: every active canary of the group's judged tags passes.
    - S2: no active case of the group's judged tags that passes under the live rubric fails under the candidate.
    - S3: every supporting row comes out as the editor decided.
    - S4: no model `apply` on a tag whose capability is corpus or deterministic.
    - S5 (initial rules only): on a fixed seeded sample of `gate.initial_rules_sample` (30) mirror claims, the tag applies to at most `initial_rules_max_rate` (50%); the applied claims are listed in Safety check result for the editor (P1 finding 5: otherwise the gate cannot see over-tagging by new rules).
    - Each side is judged like any run (D19 re-reads included). Flip re-judge (D20, R2): every item whose answer on a checked tag differs between the sides is judged `gate.default.flip_rejudge_runs` (2) more times on each side, and that side's answer is the majority of its 3 runs (about +4 calls for 3 flips, P3).
    - Verdict: PASS or FAIL; HOLD only when there is nothing to evaluate.
  - Strict mode (`--strict`, D14): today's conditions 1-5 (`S/eval.mjs:681-755`), `pairedBootstrapDelta`, reconfirmation with `gate.strict.reconfirm_runs` (5) and `reconfirm_max` (16), `--whole-pass`; the "small sample" line reads `gate.strict.large_sample_positives` and appears on strict cards only (H7).
  - Safety check result text in Rule changes (the editor-facing name of this column; ED-8): "PASS: examples 11/11, earlier 5/5, yours 2/2" or "FAIL: '<claim, 60 characters>' now Does not apply". Canaries are called examples (P3 #8). The card (`card.json`, `card.md`) adds `mode` and usage (R8); strict-only fields become optional in `card.schema.json`.
  - The report after a FAIL (answer 4): besides the figures and the quoted claim, it proposes one sentence for Editor wording, written from the claim the check named. `S/promote.mjs` makes one call to `models.distill` (rule wording is its job; this path only, reusing distill's CLI call and reply check) with the rule's current text, the lesson's proposed text and the named claim as a `<claim>` block (hard rule 3: data, not instructions), and asks for one sentence of at most 30 words that keeps that claim's answer. The report quotes the claim next to the sentence; the editor may paste it, edit it or reject the change. The sentence appears only in the report and in `card.md`; nothing writes it to Notion, because Editor wording is an editor-owned field (hard rule 1). If the call cannot run, the report says so and gives only the quoted claim (hard rule 6).
  - Next lines (ED-10): after a PASS, follow-up has already run inside the same subcommand, so the report names the rows it marked Fixed, and its Next line points at step 7 of the demo page (in production, at the remaining rows in Your queue); when more rows wait in Your queue than fit one sitting (`queue.sitting_rows`, default 20; ED-13), the status and tag reports give the count and their Next line says "start at the top of Your queue" instead of "decide the N rows"; after a FAIL, the Next line points at Lessons waiting and the proposed sentence; after a run that stopped early it is the same command again. `/claim-tagger follow-up` exists only to repeat the automatic last step after a run that stopped before it.
  - `S/promote.mjs`: `checkLesson` accepts Kind "Initial rules" with an empty Current text when the tag has no rules, and adopts the tag's copy row first (C15); the "New or promoted tag" refusal goes; `syncCases` runs before the items are selected; the candidate side runs `judge --tags <tag>` (its whole group). The PASS plan writes the copy's When to use with `expect` on the current text, the lesson's Live and Safety check result, and Agent settings' Rulebook edition and Last run summary (a short line such as "Promote · 15 Oct 11:20 · PASS", with no duration or call count); no Runs row, Tag hash, Rule version, Changed by or In regression suite. HOLD and FAIL plans write only the lesson's Safety check result and Last run summary. After a PASS, finalize, commit and follow-up (C15) run in the same subcommand. One lock: `takePromoteLock` and `releasePromoteLock` work on `runs/PROMOTING.json` with a `phase` field (`judging`, `planned`), created exclusively at the start and removed on HOLD, FAIL, finalize or abort; `PROMOTE.lock` goes. In a demo, `promote` and `follow-up` without `--lesson` are resolved by `walkthrough.mjs run` (R15); production keeps the Lesson ID when C7 could create it.
  - `S/lib/gate-evidence.mjs` (about 120 lines): `RULE_PROPS` shrinks to When to use; `promoteEvidence` loses the Changed by, Tag hash, Rule version and Agent settings checks; the seed mode becomes the setup mode (and covers the demo exception's plans).
- Reuse: `evaluate`, `pairedBootstrapDelta`, `reconfirmCandidates`, `reconfirmFlips`, `checkLesson`, `takePromoteLock`, `releasePromoteLock`, `finalize`, `abort`, `rollback`, `restoreOps` (When to use only), `candidateVersion`, `buildCandidate`, `writeLock`, `appendChangelog`, `syncCases`, `gateClaims`, `checkGateEvidence`, `promoteEvidence`, `restoreEvidence`, `sample` and `seedFromString` (`S/lib/rng.mjs`) for S5.
- Delete: `DEMO_TITLE`, `localDemoFlag`, `--mark-rolled-back`, `--smoke` (P3 #14: it never passed `--smoke` to the judge), `perTagSummaryWithHash`, `PROMOTE.lock`.
- Config: reads `gate.default`, `gate.initial_rules_*`, `gate.strict`; removes the flat `gate.*` keys. The FAIL wording call reads `models.distill`, `distill.effort` and `distill.timeout_ms`, which already exist. The config now has exactly section 2's shape.
- Tests: `T/eval.test.mjs` (today's tests move under strict; corpus, deterministic and rule-less tags are excluded); `T/simple-gate.test.mjs` (new, P3: canaries pass, no decided claim newly fails, supporting rows fixed, a cached baseline costs 0 calls, the flip re-judge, S5 on initial rules, the excluded tags); `T/promote.test.mjs` (Initial rules; one lock file; no smoke; follow-up after PASS; a FAIL report holds one proposed sentence that quotes the named claim and writes nothing to Editor wording; a failed call is reported; the PASS report's Next line points at step 7 in a demo); `T/gate-evidence.test.mjs`; `T/fixtures/loop/fake-claude.mjs` gains the one-sentence wording reply.
- Accept: on the fakes, a lesson that fixes its rows and breaks nothing PASSes with the baseline from cache, and a single chance flip that the re-judge reverses does not FAIL; on the real workspace, the first Initial rules lesson ends in PASS or FAIL with an S5 list in Safety check result.

**C21. Walkthrough script, manifest and page template (new: P2 1.3, 1.5-1.8; design in W4)**

Goal: one command creates a fresh, verified demo page under a parent the editor names, and the demo steps run against that demo's own profile.

- Files: `S/walkthrough.mjs` (new): `start --parent <link|id>` (required, no default, D24) `[--dry-run] [--resume <id>] [--manifest <path>]`; `run [--demo <id>] <script> [args]`; `where [--demo <id>]`; `verify [--demo <id>] [--json]`; `list`. `A/walkthrough/manifest.json` and `A/walkthrough/page.md` (new; content in W4 sections 6-8). Demo profiles in `A/demos/<id>/` (git-ignored). Design in W4 sections 3-9.
  - `run`: reuses `runScript` and `SCRIPTS` from the deleted `sandbox.mjs` (tag `trial-2026-10-14`) with the root `demoRoot(id)` (the newest demo by default); refuses any root outside `A/demos/`; for `promote` and `followup` without `--lesson`, fills in the demo's only Approved (or Live) lesson (R15).
  - `start`: validates the parent; writes the profile (config with `demo: true`, the rubric from the manifest's tag row, the canaries, `demo.json`); writes `setup-plan.json` and `preview.md` (`planStructure`, `renderPreview`); sends the structure (`runStructure`, recording ids in `demo.json` as they are created); creates `runs/SETUP` in the demo root, pulls, applies the row plans of `setup.mjs --demo` (C7), pulls, runs `cases-sync`, removes the marker; runs `verify` and prints the three-part report. `--dry-run` stops after the plan and the preview and sends GET requests only.
  - `.gitignore` gains `agents/claim-tagger/demos/*/` and `.claude/skills/claim-tagger-walkthrough-workspace/`; the settings entries are in C5's final shape.
- Reuse: `runScript`, `SCRIPTS`, `demoRoot`, `planStructure`, `runStructure`, `renderPreview`, `setup.mjs --demo`, `buildRubric`, `syncCases`, the lint in `S/lib/notion-blocks.mjs`.
- Delete: nothing (the old sandbox files went to the archive in C1).
- Config: writes the demo profile's config (section 2).
- Tests: `T/walkthrough.test.mjs` (new; with the mock fetch: a lost create resumes without a duplicate; a protected parent exits 4; an unreachable parent exits 2; the dry run sends no write; `run` refuses a root outside `demos/`; `where` maps each state to its step; `verify` catches a 5-column table and a banned phrase).
- Accept: `start --dry-run --parent <link>` gives a lint-clean `preview.md`; a real `start` under a parent Mika names gives a page that `verify` passes; the calibration of W4 section 6 then freezes the manifest.

**C22. Walkthrough skill and demo mode (new: P2 1.2, 2.1; design in W4; R16)**

Goal: an editor-facing skill that creates the demo and says where the editor is, and a demo mode of `/claim-tagger` that runs the real commands against the demo.

- Files: `.claude/skills/claim-tagger-walkthrough/` (`SKILL.md`, `references/manifest.md`, `references/page-design.md`, `references/troubleshooting.md`, `evals/evals.json`), built with skill-creator (W4 section 12); `.claude/skills/claim-tagger/SKILL.md` section "Demo mode": every `node S/<x>.mjs ...` becomes `node S/walkthrough.mjs run <x> ...`; no commit after a demo promote; every report starts with "Demo · "; links go to the demo page's views.
  - Insight suppression (R16): the output-style paragraph is in both SKILL.md files (C17 and here); C18 checks it headless with the Explanatory output style on. `S/loop.mjs <subcommand>` (P2 2.4: runs the fixed sequence and prints the three-part report for verbatim relay) is built only if that check fails.
- Reuse: P2 2.1's text; `transcript-check.mjs` for grading.
- Delete: nothing.
- Config: none.
- Tests: the three evals of W4 section 10, graded by script (`walkthrough.mjs verify --json`, `transcript-check.mjs`, a reply parser).
- Accept: the evals pass with the skill; the description optimisation (20 trigger queries) is done; the walkthrough has run end to end once by hand (C18).

### Stage 3: the source pass and the end-to-end check

The editor now decides the first real rows (the walkthrough is done) and then chooses one tag to draft rules for; the remaining tags follow one per run, in the editor's order, under Later (ED-6, ED-11).

**C10. Source pre-fetch and source pass (amended by R9, D12, D17)**

Goal: decide the three source tags from the sources' own text, fetched once by Node and read by the judge as short excerpts, and never call a tooling failure Source inaccessible.

- Files: `S/sources.mjs` (new), `A/prompts/judge-sources.md` (new), `S/judge.mjs` (the source pass), `S/lib/geo-sources.mjs` (C3).
  - Input: `norm/claims.jsonl` `source_links`; flags `--ids`, `--limit`, `--refresh`.
  - Resolve (R9): a Geo entity link goes through `resolveGeoEntity` (one GraphQL query per entity, cached by entity id); a plain external link is used as is; unresolved means not checked.
  - Fetch (D12): one fetch per Web URL, cached as `runs/sources/<sha16 of the URL>/meta.json` and `text.txt` (scripts, styles and navigation stripped, whitespace collapsed); `per_host_delay_ms` between requests to one host; `fetch_timeout_ms`; at most 5 redirects; at most `max_bytes`; one retry on a network error or a 5xx; a refetch after `refetch_after_days`. Statuses: `ok` (readable, at least `min_words`), `thin` (a possible paywall or a page that needs JavaScript), `paywall` (marker strings), `blocked` (401, 403, 429, 451 or a challenge page; D12: recorded as inaccessible), `not_found` (404, 410), `server_error` (5xx after the retry), `timeout`, `network`, `pdf` (counted as inaccessible: Source inaccessible rule 1 names an "unreadable document", and Node built-ins cannot read PDFs), `unresolved` (our tools failed: not checked). Per claim, `runs/sources/claims/<geo_id>.json` holds `{ links, bundle_hash }`.
  - Excerpts: the title, the first 1,500 characters, then the windows of 400 characters either side with the highest word overlap with the claim, up to `excerpt_chars`; at most `max_sources_per_claim` sources per claim.
  - Code pre-decisions (no model call; basis `fetch`): no source: all three source tags `do_not_apply` (Unsourced applies); every source hard-failed: Source inaccessible applies and the other two are `cannot_tell` (Improperly sourced rule 3); nothing readable and something unresolved: all three not checked, no queue row. Otherwise one call per claim (group S) with `prompts/judge-sources.md`: the excerpts quoted as data inside `<source n status url>` blocks (hard rule 3), the same JSON contract and `validateJudgeOutput`, cells keyed by the bundle (C8).
  - What the editor sees: Agent notes count the source tags that were not checked (line 2, for example "not checked: 3 source tags", C11); which sources were read and which were not is in the run files; a queue row on a source tag carries the source lines in Agent reason and the excerpts, exactly as the judge read them, in its page body (P3 1d; ED-9). P3's extra "Sources checked" and "Evidence" columns are left out: the queue keeps its 12 columns (R12; section 8).
- Reuse: `resolveGeoEntity`, `parseGeoSources`, `validateJudgeOutput`, `lib/cells.mjs`, `codeDecidedTag`, `renderSystemPrompt`.
- Delete: the old rule that source-reading tags are `cannot_tell` unless there is no source (`scope.source_reading_tags`, already removed in C9).
- Config: reads `sources.*`.
- Tests: `T/sources.test.mjs` (new; P3's sources-cache cases: a fake fetch returning 200, 403, 404, a timeout, a paywall page and a PDF; Geo entity to Web URL resolution; the cache by URL hash; the excerpt cap; no network); `T/judge.test.mjs` (the source pass: one call per claim, pre-decisions without a call, a changed bundle re-judges); `T/fixtures/fake-claude.mjs` gains a source-pass mode.
- Accept, on the mirror: `sources --limit 50`, then `tag --pass source --limit 50`, report the resolved, fetched and not-checked shares; no claim gets Source inaccessible from an unresolved link.

**C18. End to end (amended: P3 section 3)**

Goal: prove the whole loop on the fakes, on a demo page and on the real mirror, and prove the reports.

1. `npm test`, plus `T/loop.test.mjs` (new): a script-level loop on a temporary demo profile with the fake Notion and the fake Claude (tag, decide by fixture, distill, approve by fixture, promote with its automatic follow-up), asserting that the request log never touches a protected id or a third mirror column.
2. Acceptance on a demo page (P3; W4): a fresh demo under a parent given at run time; the editor decides the two open rows as Rule unclear; distill proposes one Context-dependent lesson; the editor approves it; the default gate PASSes; follow-up marks both rows Fixed. Checks: every report follows the template; the request log shows no touch of the real mirror or the taxonomy; the demo page is left in place.
3. Headless report check (P3, R16): run `status`, then the demo's `tag`, `distill` and `promote`, and a manual `follow-up`, each with `MSYS_NO_PATHCONV=1 claude -p "/claim-tagger status" --settings .claude/settings.json --permission-mode acceptEdits --output-format stream-json --verbose` (with the matching subcommand) and the Explanatory output style on. Check each transcript with `S/transcript-check.mjs` plus a new assertion: the final message has the three parts (one sentence, a table of at most 5 rows, one "Next:" line), about 12 lines or fewer, no Insight block, no JSON, no write to an editor-owned field, only allowed tools. If Insight blocks appear, build `loop.mjs` (C22).
4. Before the first full pass (P3): one usage-window calibration run and a deliberate stop and resume (exit 75, then the same command continues); record the window share per call, so later estimates can read "claims per usage window" (D22).
5. Live order: Context-dependent on `--limit 50` (stage 1; the rows wait for the walkthrough), the D19 calibration on 200 claims, the walkthrough (stage 2, the editor's only task there), the editor's first real rows, the full mirror; then, one tag per run in the editor's order, draft rules and their gates; G2 on the mirror once a tag's rules have passed, and the source pass (stage 3, then Later).

- Accept: all five done, with the results written into WORKLOG and the report.

## 5. P3's debt list: where each item is fixed

| P3 # | Severity | Item | Fixed in |
|---|---|---|---|
| 1 | Blocker | The rulebook build drops the Proposed tags and reads trial column names | C4, C5, C6 |
| 2 | Blocker | One claims table is hard-coded | C2, C5, C6, C9, C11 |
| 3 | Blocker | No capability classes | C2 (`tags`), C9, C11, C14 (S4) |
| 4 | Blocker | The mirror holds Geo entity links, not article URLs | C3 (`richTextLinks`, the resolver), C19 (sample), C10 (R9) |
| 5 | High | The cache key is too coarse | C8, C9 (R4) |
| 6 | High | The usage-window pattern is too broad | C0 H8 |
| 7 | High | The simple gate has no noise guard | C14 (D20) |
| 8 | High | Canaries are not held out | C7, C14 (called examples; the gate rests on decided cases and supporting rows) |
| 9 | High | Settings prefix, wildcard allows, delete tools | C0 H1-H3, C5 |
| 10 | High | The token reaches four real databases | C1 (disconnect, rotate), C2 (probe classes), C3 and C12 (`writeGuard`) |
| 11 | High | The SETUP marker is present | C0 H4, C7 (`finish`), C15 (warning) |
| 12 | High | LATEST points at a partial pull | C6 |
| 13 | High | No git remote; `runs/` on one disk | C0 H9 (optional) |
| 14 | Medium | `promote --smoke` does not use the cheap model | C14 (deleted) |
| 15 | Medium | Distill picks rows by key order and supports unseen rows | C13 (R5) |
| 16 | Medium | Usage accounting | C9, C14, C15 (R8) |
| 17 | Medium | The guard ignores the profile | C5 (the guard reads no state) |
| 18 | Medium | Taxonomy text pitfalls | C4, C7 (parser, exclude file; "issue" means the Issue view) |
| 19 | Medium | The 2022 query fails on a multi-source database | C19 (detect), C6 (`queryDataSource` if needed) |
| 20 | Medium | The judge prompt names the old scope | C9 |
| 21 | Medium | Dead config keys | C0 H6; each change's Config line |
| 22 | Medium | Fallback subagents wired to nothing | C16 |
| 23 | Medium | Real names committed | C0 H5 |
| 24 | Medium | Text errors in the report and plan | C0 H7 |
| 25 | Low | Stale canary tag hashes | C7 (canaries rebuilt for the new rubric; the old ones archived, C1) |
| 26 | Low | Stale rubric text ("tag Neither") | C1 (the trial rubric is archived; Predictive and Hypothetical left the scope, D1) |
| 27 | Low | `wilson` unused; `sandbox.mjs` lists `allowlist` | C16 |
| 28 | Low | Distill sends examples twice; wrong start time | C13 |
| 29 | Low | Notion bloat | C7 (12, 11 and 4 columns, no formulas or rollups, 4 views) |
| 30 | Low | Docs bloat; the runbook exists three times | C17 |

## 6. Tests at a glance

| Test file | Change | Action |
|---|---|---|
| `T/config.test.mjs` | C2 | new |
| `T/geo-sources.test.mjs` | C3 | new |
| `T/mirror-write-allowlist.test.mjs` | C5 | new (P3) |
| `T/multi-mirror-pull.test.mjs` | C6 | new (P3) |
| `T/notion-blocks.test.mjs`, `T/notion-build.test.mjs` | C20 | new |
| `T/setup.test.mjs` | C7 | new |
| `T/cells.test.mjs` | C8 | new |
| `T/adaptive-runs.test.mjs`, `T/capability.test.mjs` | C9, C11 | new (P3) |
| `T/draft-rules.test.mjs` | C13 | new (P3) |
| `T/simple-gate.test.mjs` | C14 | new (P3) |
| `T/walkthrough.test.mjs` | C21 | new (replaces `T/sandbox.test.mjs`) |
| `T/sources.test.mjs` | C10 | new (P3's sources-cache cases) |
| `T/loop.test.mjs` | C18 | new |
| `T/claude.test.mjs` | H8 | update |
| `T/guard.test.mjs` | H3, C5 | update |
| `T/status.test.mjs` | H4, C15 | update |
| `T/eval.test.mjs` | H7, C2, C14 | update |
| `T/rubric-build.test.mjs` | H5, C4 | update |
| `T/paths.test.mjs`, `T/probe.test.mjs` | C2, C19, C7 | update |
| `T/notion-values.test.mjs`, `T/notion-rest.test.mjs` | C3, C20 | update |
| `T/allowlist.test.mjs`, `T/notion-contract.test.mjs` | C5 | update |
| `T/pull.test.mjs` | C6 | update |
| `T/plan.test.mjs`, `T/apply.test.mjs`, `T/verify.test.mjs` | C12 | update |
| `T/hash.test.mjs` | C8 | update |
| `T/judge.test.mjs` | C2, C9, C10 | update |
| `T/propose.test.mjs` | C2, C11 | update |
| `T/followup.test.mjs` | C15 | update |
| `T/distill.test.mjs`, `T/cases-sync.test.mjs` | C1, C13 | update |
| `T/promote.test.mjs`, `T/gate-evidence.test.mjs` | C14 | update |
| `T/stats.test.mjs` | C16 | update (drop the `wilson` case) |
| `T/jsonl.test.mjs`, `T/pyjson.test.mjs`, `T/rng.test.mjs`, `T/validate.test.mjs` | none | unchanged |
| `T/seed-build.test.mjs`, `T/seed.test.mjs`, `T/rubric-init.test.mjs`, `T/snapshot.test.mjs`, `T/sandbox.test.mjs` | C16 | deleted |

Fixtures: `T/fixtures/config.json` (new, C2); `T/fixtures/notion/db.mirror-usp.json` (new, C19), `db.rulebook-copy.json` (new, C4), `db.mirror-wa.json` (new, C6); `db.tag_decisions.json`, `db.rule_changes.json`, `db.agent_settings.json` (rewritten, C6); `db.runs.json`, `db.claims.json`, `db.rulebook.json` (deleted, C6); `fake-notion.mjs` (request log and multi-source 400, C19; databases from config, C6; views, C20); `T/fixtures/fake-claude.mjs` (429 or overloaded and usage-limit modes, per-call usage, source-pass mode; H8, C9, C10); `T/fixtures/loop/fake-claude.mjs` (draft-rules reply, C13); `T/fixtures/judge/` (cell-store layout, C9).

## 7. Build order and milestones

| Stage | Changes, in order | Milestone (acceptance) | People and preconditions |
|---|---|---|---|
| 0 | C0, C3, C1 with C16, C2, C19 | No SETUP marker; settings and guard closed; the trial archived; the probe shows the old hub, sandbox, taxonomy, Claims to review and World affairs unreachable and the mirror reachable; the read-only dry-run report on the mirror (rows, requests, column types, Geo Sources parsing, 20 resolved source links, multi-source or not, `filter_properties`, exact-text duplicates) with a request log free of writes | A person deletes the markers (H4), disconnects the integration and rotates the token (C1). Mika asks the owner of the Geo-to-Notion refresh job whether added columns and page ids survive a refresh (D21) and asks the Geo team for the canonical GraphQL endpoint (R9; not blocking for stage 1) |
| 1 | C4, C5, C6, C12, C17, C20, C7, C8, C9, C11, C15 | The API check recorded; the "Claim tagger" page with four databases and four views (or the checklist); the copy's 13 rows read back equal to the taxonomy's; the two mirror columns added with `--confirm` and read back; rulebook edition 1 (13 tags, 4 judged); `/claim-tagger tag --tags Context-dependent --limit 50`: 50 mirror pages carry Agent tags and Agent notes in the two-line form, every unsure cell has a queue row, the read-back is clean and the report follows the template; then the D19 calibration on the first 200 claims, with its numbers to Mika. The queue rows wait: the editor decides none of them in this stage | The D21 answer before `mirror-columns`; Mika reads CLAUDE.md's new rules (C17) before the first mirror write; the engineer names the parent of the new page; the editor does not decide real rows yet (they wait in Your queue and nothing is lost, ED-11) |
| 2 | C13, C14, C21, C22 | The walkthrough: dry run, a real start, three calibration runs, the manifest frozen; the skill-creator loop done; the draft-rules code passes its tests on the fakes (nothing is drafted for the editor yet); the usage-window calibration and a deliberate stop and resume (C18 step 4), then the full Context-dependent pass of the mirror in the background (its rows wait too). For the editor, this stage is the walkthrough and nothing else (ED-6) | The editor works through the practice page once; Mika names a parent page for every demo and the eval parent (D24) |
| 3 | C10, C18 | The editor has decided the first real rows (after the walkthrough). The first tag the editor chose has its rules drafted (one Initial rules row, shown with its example claims), approved or rewritten, and its promote ended in PASS or FAIL with its S5 list; G2 judged on the mirror for that tag once its first rules passed; `sources`, then the source pass over the mirror (several usage windows, resuming); C18 end to end, including the headless report check | The editor chooses the first tag to draft; the Geo team's endpoint answer before the full source pass (otherwise it runs on the testnet name, R9) |
| Later | no new code (C13 is reused) | The other tags' first rules, one tag per run in the editor's order, each shown with its example claims and each ending in its own PASS or FAIL; G2 judged for each tag once its rules passed; the items of section 8 when their triggers occur | The editor's order, and the editor's approval for each tag |

## 8. What was deliberately left out

| Left out | Why not now | Trigger to add it |
|---|---|---|
| The strict gate as routine (P1 O1) | Samples are tiny; the default gate with the flip re-judge is cheap (D14, D20) | A tag reaches 30 or more decided positives; always before the swap to the real taxonomy; and once several groups are live, a periodic whole-pass re-judge (on a schedule Mika sets), because per-group caching cannot see interference between groups (P1 risks) |
| World affairs (P1 O5) | D9: U.S. Politics only in the first iteration | U.S. Politics has finished one full cycle (tag, decide, distill, promote, follow-up) without incident and Mika enables it. Then: pick the canonical World affairs mirror, move its ids out of the protected list, add a `mirrors[]` entry, add the two columns with `--confirm` after a D21 check with its refresh-job owner, and settle whether one Geo ID can sit in both mirrors (P1 shares judgments and queue rows by Geo ID; P3 prefixes keys with the mirror) |
| A corpus search for the duplicate tags (P1 O6) | D17: it needs an index of the canonical spaces (about 349,000 claims) | A local export of the canonical spaces exists and Mika wants the duplicate tags checked. Then Exact duplicate becomes a normalised-text hash over the export, decided in code, and Semantically duplicated a candidate retrieval plus a pair-adjudication pass, with queue rows only for candidate pairs |
| Per-editor queues (P1 O9) | D4: one editor, who is also the rule owner | A second editor joins: an Editor column and views; a second opinion comes back only then |
| Scheduled runs (P1 O10) | D11: the editor runs the skill | The loop has run by hand over many runs without a stop the editor had to fix, and Mika asks; scheduled runs respect Paused and post a one-line summary after each run |
| The swap to the real taxonomy (P1 O7) | D2: the copy first, while the team fills in missing data | The team agrees that the agent may write When to use on the taxonomy after a PASS, and the copy and the taxonomy agree. Then run `--strict`, change the `notion.rulebook` ids, move the taxonomy from the protected list to the rulebook, and expect 200 in the probe |
| `status --adopt <tag>` for judged tags (P1 O2) | Drift on a judged tag stops the run, and a person reverts the edit (rule 4) | The first time the team edits a judged tag in the copy and wants to keep the edit: it becomes a gated lesson whose Proposed text is the Notion text |
| Code-decided mechanical tags (P1 O3) | Their rules do not exist yet | Trailing period and Multi-sentence have rules that passed the gate and stable cases |
| Throughput tuning (P1 O4) | Measure first | The first full passes show the usage window, not the editor, is what slows the loop: batch size by tags per call, and skipping source tags when "Geo Is factual" is false |
| Per-tag confidence calibration (P1 O8) | No decided data yet | 50 or more decided rows on a tag |
| Script-printed reports (`loop.mjs`, P2 2.4) | The SKILL.md override may be enough (R16) | The headless check of C18 finds Insight blocks with the override in place |
| Extra queue columns for sources ("Sources checked", "Evidence", P3 1d) | One schema of 12 columns (R12) | The editor asks for them after the first source-tag rows |
| A linked view of the mirror on the new page (P1 2.4) | No script creates views on a real database | The editor adds it by hand (Agent tags, Agent notes), for example to skim confident applies |
| Automatic cache invalidation on a CLI update (P3 1e) | The CLI version is recorded, not keyed | The canary check after an update shows more than 5% changed answers |
