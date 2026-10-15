# W3 digest: code changes (as decided)

Digest of `X:\work\geo-agents\docs\analysis-2026-10\design\W3-code-changes.md` (768 numbered lines, read in full in five chunks). It replaces the source for the builder. Quotes are verbatim. `L<n>` = line number in the source. Where the source defers to another file (W4, P1, P2, P3, DECISIONS, RECONCILIATION), this digest says "external" and does not fill the gap.

Path keys used by W3: `S/` = `agents/claim-tagger/scripts/`, `A/` = `agents/claim-tagger/`, `T/` = `tests/`. Line numbers in W3 refer to commit d195bd4. Codes: Cn = change (C0 to C22), Dn = decision (D1 to D24), Rn = ruling (R1 to R23, see section 14), Hn = housekeeping item inside C0, ED-n = editor-debate objection, P1/P2/P3 = plan reports (external).

Status of the design: "Status: design, not started. Coding starts only on Mika's go-ahead for W3" (L3).

## 1. Notion tables in the final design

### 1.1 Rulebook copy: "Claim Tags — Issue (copy)" (C20, L451)

"The taxonomy's 13, same names and types. The two relations to the claim tables are left out. Rows are created once at setup; the agent then writes When to use only." Config: `notion.rulebook` with `key` "Name" and `work_tag` "Issue" (L31-36, L130-131). Rows whose Work tags contains Issue are the copy (D1).

| Column | Type | Select values | Filled by | Meaning |
|---|---|---|---|---|
| Name | title | - | setup creates the row; editor/team edits | Tag name; the copy's key (`rulebook.key`). |
| Description | text | - | editor/team | Tag description; read by the rubric build (C4) and by draft-rules (C13). |
| When to use | text | - | setup creates; agent writes after a gate PASS or a confirmed restore (the only agent-writable copy column) | The numbered rules the judge applies. A tag is judged once its When to use has numbered rules in force (rule 5). |
| Example Claims | text | - | editor/team | One example per line. A leading "- " and surrounding quotes are stripped. Lines the conservative parser rejects are left out of `example_claims` (C4); the known case is Incorrect grammar's "255 legacy linked claims; see ...". |
| Counterpart | text | - | editor/team | Stays in the schema; hidden in the demo's Rulebook view (ED-8). |
| Geo Tag ID | text | - | editor/team | Geo tag id. |
| Evidence | url | - | editor/team | Evidence link. |
| Category | select | Nature, Form, Quality, Style, Tone, Format, Meaning, Usage, Check | editor/team | Category; may be empty (C4). |
| Polarity | select | Classification, Positive, Issue | editor/team | Decides nothing any more; "issue" means "in the Issue view" (L135). Multi-sentence has polarity Classification. |
| Status | select | Verified, Proposed | editor/team | Read as it is (Verified, Proposed or empty). The rubric build no longer stamps Verified (C4). |
| Geo Status | select | Existing in Geo, To be created, Implemented differently | editor/team | Geo status. |
| Work tags | multi-select | Pipeline benchmark check, Issue | editor/team | Filter for the copy: rows containing Issue. |
| Verified on | date | - | editor/team | Date verified. |

"editor/team" means no script writes the column. W3 does not name the person who fills it; it says the team fills in missing data (L759, D2).

### 1.2 Tag decisions: the queue, 12 columns (C20, L452)

Nine columns are agent-filled and three are editor-filled. Config: `notion.databases.tag_decisions`, key "Key" (L56). Creates and updates go through plan and apply (rule 1).

| Column | Type | Select values | Filled by | Meaning |
|---|---|---|---|---|
| Claim | title | - | agent (plan create) | The claim text. |
| Key | text | - | agent | `<Geo ID>::<Tag>`. The row's identity; pull parses it (C6). |
| Tag | select | the 13 tag names | agent | The tag the row is about. |
| Agent proposal | select | Applies, Does not apply, Can't tell | agent (propose) | The agent's verdict for the cell (`proposalFor`, C11). |
| Agent confidence | number | - | agent | Confidence of the verdict. The queue views sort by it, lowest first (C7). |
| Agent reason | text | - | agent | At most `queue.reason_max_words` (40) words, then the rule and k/n runs (C11). For a source tag, the source lines and excerpts as the judge read them (C10). |
| Claim link | url | - | agent | URL of the mirror page. |
| Rulebook edition | text | - | agent | Edition the verdict was made under. |
| Follow-up | select | Fixed, Still wrong | agent (followup) | Set on the supporting rows after a PASS (C15). |
| Tag outcome | select | Applies, Does not apply | editor | The editor's decision. Empty means the row waits in Your queue. |
| Why wrong | select | Agent slip, Rule unclear, Rule should change | editor | The editor's reason. Distill groups rows by it (C13). |
| Your reasoning | text | - | editor | Free text. "rule 4" typed here names the cited rule (R13). |

Writable fields (C5, L294): "Claim, Key, Tag, Claim link, Agent proposal, Agent confidence, Agent reason, Rulebook edition, Follow-up". "FOLLOW_UP_FIELDS = ['Follow-up'] (the only field a decided row accepts)."

### 1.3 Rule changes (lessons): 11 columns in production (C20, L453)

Config: `notion.databases.rule_changes`, key "Lesson" (L57). "Lesson ID only in production" (L453).

| Column | Type | Select values | Filled by | Meaning |
|---|---|---|---|---|
| Lesson | title | - | agent | The lesson's name. Named by title when no Lesson ID exists (R15). |
| Lesson ID | unique id, prefix RC | - | agent; production only, and only if the API check's unique-id step passed (C7) | The lesson's identifier. |
| Tag | select | the 13 tag names | agent | The tag the lesson changes. |
| Rule | text | "Context-dependent rule 4", "Wordy when to use" (examples given in W3) | agent | The rule the lesson changes. |
| Kind | select | Clarify wording, Change the rule, Initial rules | agent | Kind of change. |
| Current text | text | - | agent | The rule text now. Empty for Initial rules (C14). |
| Proposed text | text | - | agent | The proposed text. For Initial rules, from `composeWhenToUse(...)` (C13). |
| Safety check result | text | "PASS: examples 11/11, earlier 5/5, yours 2/2"; "FAIL: '<claim, 60 characters>' now Does not apply" | agent (gate) | The gate's result (section 9). |
| Supporting rows | text | One line per row: "the claim shortened to 60 characters, ' · ', then the row's Key" (C13) | agent | The decided rows the lesson cites. |
| Editor wording | text | - | editor | The rule as the editor words it. No script writes it (rule 1). |
| Status | select | Proposed, Approved, Rejected, Live, Rolled back | editor sets Approved and Rejected; agent sets Proposed (on create), Live and Rolled back | Lifecycle. |

Page body: `lessonMarkdown` writes "the supporting claims in full" (C13). For draft-rules, "the report and the lesson's page body show the tag's example claims (the copy row's Example Claims) next to the drafted rules" (C13).

### 1.4 Agent settings (C20, L454)

Config: `notion.databases.agent_settings`, key "Name" (L58).

| Column | Type | Select values | Filled by | Meaning |
|---|---|---|---|---|
| Paused | checkbox | - | editor | Stop switch. "`runs/PAUSED` on disk or Paused in Agent settings means stop" (CLAUDE.md rule 7, L175: "Paused in Agent settings still stops every command"). |
| Name | title | - | agent, at setup only (C5) | The settings row's name. Value not stated in W3. |
| Rulebook edition | text | - | agent (setup, PASS, adopt-unjudged) | The edition in force (C5, C7, C14, C15). |
| Last run summary | text | - | agent | One short line, for example "Promote · 15 Oct 11:20 · PASS" (C14). No duration or call count. |

### 1.5 Claims mirror: U.S. Politics debate claims (config `notion.mirrors[0]`, L37-53)

The one mirror in the config: `"enabled": true`, `"key": "Geo ID"`. Its Geo columns already exist. The two write columns do not exist yet; `setup mirror-columns --confirm` adds them once (C7, D21). The mirror is no longer protected (D3; C5 L297-300).

| Config role | Notion column | Type | Filled by | Notes |
|---|---|---|---|---|
| key | Geo ID | not stated | Geo side (refresh job) | Keys stay `<Geo ID>::<Tag>` while there is one mirror (D9). |
| columns.claim | Geo Name | not stated | Geo side | |
| columns.link | Geo URL | not stated | Geo side | |
| columns.sources | Geo Sources | not stated | Geo side | Geo entity links, not article URLs (P3 #4, C19). Parsed by `parseGeoSources` (C3). |
| columns.sources_count | null | - | - | Verbatim (L132): `null` means "count the links in `columns.sources`", which is the case on U.S. Politics. |
| columns.is_factual | Geo Is factual | not stated (the C19 dry run reports its type) | Geo side | |
| write_columns.tags | Agent tags | rich_text (added at setup) | agent | Format in section 7.4. |
| write_columns.notes | Agent notes | rich_text (added at setup) | agent | Format in section 7.5. |

W3 does not say who writes the Geo columns. It names "the owner of the Geo-to-Notion refresh job" (L472, L745). The C6 normalised row (L377) is `{ mirror, geo_id, page_id, notion_url, claim, geo_url, source_links, sources_count, is_factual, agent_tags, agent_notes }`.

Demo claims table: `demo_claims` (label "Claims"), with "the same `columns` and `write_columns`" (L155). It holds seven mirror-shaped rows, created by `setup --demo` (L475).

### 1.6 Protected and read-only databases (never written)

Source: `protected_database_ids` (L60-67), rule 10 (L167), C1 (L221).

- Taxonomy "Claim Tags — verified" (`f05273e214eb8353b0a981544507de32` and its data source). Read only. The skill reads its Issue rows through a connector SQL projection into `setup/taxonomy-issue.json`, "so the token never needs taxonomy access" (C7, L471).
- Claims to review (database and data source).
- World affairs, both mirrors (databases and data sources). Not enabled (D9; section 8 of W3).
- QA agent work tags (database and data source).
- The 6 trial databases of "Editorial feedback loop" (12 ids). Read-only history (rule 10). The hub gets a "History, superseded by Claim tagger" callout by hand (C1).
- The 6 sandbox databases of its Walkthrough page (12 ids).

Rule 10 (L167): "The agent's databases live under the Notion page 'Claim tagger'; 'Editorial feedback loop', its Walkthrough and their databases are read-only history." Disconnecting the integration and rotating the token are done by a person, not by the agent (C1, EN-3).
### 1.7 What setup and the demo create

- The "Claim tagger" page under a parent that a person names at run time: "The plain page under the parent the engineer names (no default), with a short text and links to the four views" (C7, `page --parent <link>`).
- Four databases: the copy, Tag decisions, Rule changes, Agent settings (C7 `databases`, from `A/schemas/notion/setup.json`, C20).
- Four views (section 2), or the editor's checklist when the API check fails: "P1's four-line checklist for the editor (R11), whose Lessons waiting line names its four columns (Lesson, Current text, Proposed text, Status) and says to switch wrapping on (answer 5)" (C7 `views`).
- Copy rows: 13 (C7 `rulebook --from setup/taxonomy-issue.json`). Settings row: 1 (C7 `settings`).
- API check: "one real check against a scratch page under a parent a person names at run time (D24)"; result to `A/runs/api-check.json` (C20, L445).
- Demo (C7 `--demo <id>`, L475; C21): "the copy (1 row), the claims table (7 mirror-shaped rows; creates are allowed because the profile is a demo), Tag decisions (7 rows; the 5 earlier decisions carry Tag outcome and Your reasoning, the R12 exception of C5), Agent settings (1 row); the rubric is built with `buildRubric` from the manifest's tag row." The four definitions in `setup.json` serve production and demo alike: "one schema for production and demo" (R12, C20 L444).

### 1.8 Editor-owned fields, write allowlist and hard rules (L157-175, C5 L292-300)

Rule 1, as decided (L161), verbatim:

> **1. Notion is written only by applying a plan a script produced.** No agent or script ever writes an editor-owned field: Tag outcome, Why wrong, Your reasoning, Editor wording, the Status values Approved and Rejected, Paused. One exception: when the walkthrough creates a demo page, that demo's setup plan fills Tag outcome and Your reasoning on its earlier-decision rows, once, at creation; this never happens on the production databases or on a mirror. New pages, databases and views are made only by the setup builder, from a setup plan it writes first, under a parent page a person names at run time; rows always go through plan and apply.

Rule 4 gets one sentence (L163): "Exception: while a tag has no rules in force, edits to its row in the rulebook copy are adopted from Notion without a gate (`status.mjs --adopt-unjudged`); its first rules still need an Approved lesson and a gate PASS."

Rule 5, as decided (L165), verbatim:

> **5. Only rulebook tags with rules in force are judged.** The rulebook is the configured copy of the taxonomy rows whose Work tags contains Issue. A tag is judged once its When to use has numbered rules in force: the rules the copy held at setup, or rules that later went live through the gate. Unsourced is computed from the sources. Source tags are decided only from fetched source text; a source our tools could not resolve or fetch is "not checked", never Source inaccessible. Semantically duplicated is reported as not checked and never queued; Exact duplicate is checked only by an exact text match within the configured mirrors and queued only on a match. Editor verified is never written.

Rule 10, as decided (L167), verbatim:

> **10. Real content databases are protected; the configured mirrors accept two text columns.** On each claim mirror listed in `config.notion.mirrors` (today U.S. Politics debate claims), scripts write only its two write columns, Agent tags and Agent notes (the code refuses any other name), never create or delete a row, and change its schema once, at setup and behind a confirm flag, to add those two text columns. The rulebook copy accepts When to use only, after a gate PASS or a confirmed restore, besides the rows created once at setup. The taxonomy ("Claim Tags — verified"), Claims to review, World affairs and every other real database stay protected and are never written. The agent's databases live under the Notion page "Claim tagger"; "Editorial feedback loop", its Walkthrough and their databases are read-only history.

Rules 2, 3, 6, 7, 8 and 9 "stay word for word" (L159). Rule 2 still covers the builder: "the builder also goes through `S/lib/notion-rest.mjs`; a demo profile's `config.json` is 'the agent's config' for that demo" (L174). Rule 7: "`verify.mjs` no longer writes `runs/PAUSED` (R7), but a person can still create it, and Paused in Agent settings still stops every command" (L175).

Editor-owned set in code (C5, L299): `EDITOR_NAMES` = "Tag outcome, Why wrong, Your reasoning, Editor wording, Paused, plus the Status values Approved and Rejected (D4 removes Decided by, Decided at, Approved by, Paused by, Reason, Weekly cap and Owner together with their columns)."

Write allowlist (C5, L292-298), as written in W3:
- rulebook: `WRITABLE = ['When to use']` (a promote PASS or a confirmed restore, checked by gate evidence); `SETUP_CREATE_ONLY` = the 13 copy properties (ctx.setup plus the `runs/SETUP` marker).
- tag_decisions writable: Claim, Key, Tag, Claim link, Agent proposal, Agent confidence, Agent reason, Rulebook edition, Follow-up.
- rule_changes writable: Lesson, Tag, Rule, Kind, Current text, Proposed text, Safety check result, Supporting rows, Status (Live and Rolled back; Proposed on create).
- agent_settings writable: Rulebook edition, Last run summary; on create (setup only): Name.
- mirror (every `mirror.<name>`): update only; the property must be in `MIRROR_COLUMNS` and in `Object.values(write_columns)`, with schema type `rich_text`; creates only when `isDemo(config) && ctx.setup`.
- Demo exception (R12, rule 1): `DEMO_SETUP_CREATE_ONLY.tag_decisions = ['Tag outcome', 'Your reasoning']`, accepted only on a create, only with ctx.setup, only when `isDemo(config)` and the demo root holds `runs/SETUP`. Every other path refuses these names.
- `MIRROR_COLUMNS = ['Agent tags', 'Agent notes']` is a constant in code (D5). "A third name is never written, whatever the config says" (L132).

## 2. The views

Source: C20 `setup.json` (L444), C7 `views` (L470), ED-4 (L9): the four names are the same on the practice page and the real page.

| # | View | On table | Filter | Sort | Visible columns and options |
|---|---|---|---|---|---|
| 1 | Your queue | Tag decisions | Tag outcome is empty | grouped by Tag; sorted by Agent confidence, lowest first | Claim, Tag outcome, Why wrong, Your reasoning |
| 2 | Needs your note | Tag decisions | Why wrong is Rule unclear or Rule should change, and Your reasoning is empty | not stated | not stated |
| 3 | Lessons waiting | Rule changes | Status is Proposed or Approved | not stated | Lesson, Current text, Proposed text and Status; wrapping on, "so that both texts are read in place" (answer 5) |
| 4 | Rulebook | Rulebook copy | all rows (no filter stated) | not stated | all columns; on the demo page Counterpart is hidden (ED-8) |

Rule for all four (L444): "each default view's visible columns (at most 5, wrap off; the demo's Rulebook view hides Counterpart, a column that stays in the schema, ED-8)". Lessons waiting is the exception, with wrap on.

Demo page (L444, W4 section 7): "Your queue and Lessons waiting are the two linked views inside steps 3 and 5, and Needs your note and Rulebook are the views of the Tag decisions and Rulebook tables".

Creation (C20): `createView({ dataSourceId, name, type, createDatabase: { parentPageId, afterBlockId }, filter, sorts, configuration })`; `configuration` "carries the visible columns, their order and, for Lessons waiting, wrapping on". Views are created "only when the check passed for the pinned version" (L445). If the view step of the API check fails, the page gets the checklist (C7). If only the wrapping step fails, "the views are still built and one line is added to the page (turn on Wrap cells in Lessons waiting)" (C20 Accept, L460).

No script creates a view on a real database beyond these four. "A linked view of the mirror on the new page (P1 2.4): No script creates views on a real database. The editor adds it by hand (Agent tags, Agent notes), for example to skim confident applies" (section 8 of W3, L766).
## 3. config.json shape (L22-155)

### 3.1 The final config, verbatim (L24-126)

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

Config moves step by step: C2 adds the keys; each later change removes the old keys it no longer reads; "After C14 the file has exactly the shape of section 2" (L19).

### 3.2 What each key means (L130-141, as written)

- `notion.api_version` "stays 2022-06-28 for every pull, apply and verify." `notion.builder_api_version` (new, R11) "is used only by the setup builder (`S/lib/notion-build.mjs`, C20) for pages, databases and views, and only after the API check of C20 passed."
- `notion.rulebook` is "the taxonomy-shaped copy (D2). `work_tag` keeps the rows whose Work tags contains Issue (D1). The key is the taxonomy's title column, Name."
- `notion.mirrors[]` (D3, D9): "P1's entry plus P3's fields: `enabled`; `columns.sources_count` (...); and `write_columns` as P3's role map (`tags`, `notes`)." The code intersects `Object.values(write_columns)` with `MIRROR_COLUMNS = ['Agent tags', 'Agent notes']` (D5). "P3's per-mirror key prefix (`usp.<geo_id>`) is not used: keys stay `<Geo ID>::<Tag>` while there is one mirror (D9); the question returns with World affairs (section 8)."
- `notion.databases` holds the agent's three own databases. "`data_source_id` is optional everywhere: the guard no longer reads it, and protected-list comparisons use both ids when present."
- `notion.protected_database_ids`: "today's nine ids minus the U.S. Politics pair (now a mirror, D3), plus the 24 trial and sandbox ids (C1). The taxonomy, Claims to review and World affairs stay protected (D9, D23)."
- `tags` (the capability map, D1, D17): "`text`: judged by the model in the text pass once the tag has rules in force. `source`: judged per claim from fetched source text (D12). `deterministic`: decided in code (Unsourced, from the sources). `corpus`: never judged by the model and never queued; Semantically duplicated is 'not checked' in Agent notes on every claim, and Exact duplicate gets a free exact-text check within the mirrors and is queued only on a match (D17). A tag not listed is `text`. A tag with no rules in force is never judged (it is counted under 'not checked' in Agent notes). Polarity decides nothing any more: 'issue' means 'in the Issue view' (Multi-sentence has polarity Classification)." (See section 14 on "never queued".)
- `judge.runs_max` and `judge.rerun` (D19, R1): "run 1 for every claim; a cell is unsure when its decision is `ask_editor` (`include_ask_editor`) or its `p` lies strictly inside `band`; claims with an unsure cell get run 2, at most `max_share` of the run's claims, lowest margin first; run 3 only where runs 1 and 2 disagree. Applied cells with high confidence are not re-read."
- `judge.groups` (R4): "prompt and cache groups. The cache key is per group and carries the group's tag hashes, so a rule change re-judges only its group. G1 = Context-dependent; G2 = the six text tags whose first rules the draft-rules step writes, one tag per run (D7, ED-6); S = the source tags, one claim per call (`batch_size` does not apply)."
- `sources.resolver` (R9): "the Geo GraphQL endpoint that returns a source entity's 'Web URL' in one query. The host name says testnet but serves the production space; the Geo team should confirm the canonical name."
- `queue` (D18): "has no row cap: every unsure row lands at once, and the views sort by confidence."
- `distill` (R5): "a group needs `min_claims` (2) distinct claims; at most `max_lessons_per_run` (3) lessons per run. `effort` and `timeout_ms` are set explicitly (P3 #21: today they are read but unset, so Opus runs at the CLI default); `high` and a timeout of 600000 ms are proposed for the few Opus calls."
- `gate.default.flip_rejudge_runs` (D20, R2): "in the default gate, every item whose answer differs between the old and the new rule is read twice more on each side." `gate.initial_rules_*` is P1's base-rate check for first rules. `gate.strict` is P1's, used only with `--strict` (D14).

### 3.3 Removed keys (L143-153)

- `notion.hub_page_id`, `databases_page_id`, `engineer_notes_page_id`, `walkthrough_page_id`, `max_creates_per_call`: "no reader" (C0, H6).
- `anonymise`: "moved to the git-ignored `A/anonymise.local.json` (C0, H5)."
- `notion.setup_page_parents`, `setup_content_pages`: "the guard has no connector setup path any more, and a parent page is named at run time (C5; amended by R11 and D24, P1 kept `setup_page_parents`)."
- `notion.databases.rulebook`, `.claims`, `.runs`: "replaced by `notion.rulebook`, `notion.mirrors` and the folded Runs database (R8); the trial ids move to the protected list (C2, C6)." (Which Runs database is meant is unclear; see section 14.)
- `judge.runs`, `judge.smoke_runs`, `judge.prompt`, `thresholds` (now `judge.rerun.band`), `scope.*` (now `tags` and `judge.groups`) (C9).
- `readiness`, `queue.weekly_cap_default`, `queue.why_max_words` (renamed `reason_max_words`) (C11; D4, D18).
- `distill.min_claims_rule_change`, `distill.owner_ruling_at` (C13; D4: the editor is the rule owner).
- The flat `gate.*` keys, now under `gate.strict` (C14).
- Never added: P1's `queue.max_new_rows_per_run` (D18), `judge.rerun_if` (D19), and `sources.resolver.geo_api` / `html_fallback` (R9: the entity pages render in the browser, so an HTML fallback finds no properties).

### 3.4 Demo profile config (L155)

Written by `walkthrough.mjs start` (C21). "Has the same shape plus `"demo": true` and `"demo_id"`. Its `notion.page_id`, `rulebook`, `databases` and a single mirror `demo_claims` (label 'Claims', the same `columns` and `write_columns`) point at the demo's own databases. Its `protected_database_ids` is production's list plus the production page's databases and every production mirror, so a demo can never reach them. `tags` is `{ "default": "text" }` and `judge.groups` is `{ "G1": ["Context-dependent"] }`. P1's per-mirror `demo` flag becomes this profile-level flag."

### 3.5 Thresholds and numeric defaults in one place

| Key | Value | Stated meaning |
|---|---|---|
| judge.runs_max | 3 | Runs per claim at most (L136). |
| judge.rerun.band | [0.25, 0.75] | Unsure when p lies strictly inside (L136). |
| judge.rerun.max_share | 0.30 | Share of a run's claims that get run 2 (L136). |
| judge.batch_size | 8 | Items per call per group; S uses one claim per call (L137). |
| judge.timeout_ms | 300000 | Not described in W3. |
| judge.max_error_share | 0.1 | Not described in W3. |
| distill.min_claims | 2 | Distinct claims a group needs (L140). |
| distill.max_lessons_per_run | 3 | Lessons per run, ranked by distinct supporting claims (L571). |
| distill.overfit_ngram | 8 | "the 8-word overfit check (P1)" (L576); the check itself is not restated. |
| distill.effort / timeout_ms | high / 600000 | Set explicitly (H6, L140). |
| gate.default.flip_rejudge_runs | 2 | Extra judgments per side for each flipped item (D20). |
| gate.initial_rules_sample | 30 | Seeded sample of mirror claims for S5 (C14). |
| gate.initial_rules_max_rate | 0.5 | Max share of the sample the tag may apply to (S5). |
| gate.strict.* | runs 3; tolerance 0.05; min_positives 5; bootstrap 1000; ci [0.025, 0.975]; ungated_flips_hold 1; ungated_flips_fail 3; reconfirm_runs 5; reconfirm_max 16; large_sample_positives 30 | Strict mode only (D14). Only `reconfirm_runs`, `reconfirm_max` and `large_sample_positives` are explained in W3. |
| queue.reason_max_words | 40 | Words of Agent reason before the rule and k/n runs (C11). |
| sources.max_sources_per_claim | 3 | Sources per claim (C10). |
| sources.excerpt_chars | 6000 | Excerpt budget per claim (C10). |
| sources.min_words | 150 | "ok" needs at least this many words (C10). |
| sources.fetch_timeout_ms | 20000 | Fetch timeout (C10). |
| sources.max_bytes | 3000000 | Byte cap per fetch (C10). |
| sources.per_host_delay_ms | 1000 | Delay between requests to one host (C10). |
| sources.refetch_after_days | 30 | Refetch age (C10). |
| notion.requests_per_second | 3 | Not described in W3. |
| notion.page_size | 100 | Not described in W3. |
| notion.max_text | 1900 | Limit for text values; Supporting rows spill to the page body beyond it (C13); Agent notes stay within it (C11). |

Keys present in the JSON that no W3 sentence explains: `judge.concurrency`, `judge.effort`, `judge.max_turns`, `judge.claude_bin`, `judge.max_error_share`, `notion.requests_per_second`, `notion.page_size`, `sources.user_agent`, `models.cheap`. `models.cheap` is not referenced by any change.
## 4. Scripts

### 4.1 Rules every script follows (L18-20, L409-416)

- "no script or session writes an editor-owned field (the single exception is the demo setup in rule 1), no script deletes or archives a Notion page, and `.env` never reaches a prompt, log, transcript or report (hard rules 1, 8, 9)" (L20).
- Notion is written only by applying a plan (rule 1). The plan is built by the producing script; `apply.mjs --run <id>` (written `A` in the sequences) writes it. Structure (pages, databases, views, content) is made only by the setup builder (`notion-build.mjs`, C20), "from a setup plan it writes first" (rule 1, L161); rows always go through plan and apply.
- Every subcommand starts with `status.mjs --check` (L414).
- Client options (C3, `S/lib/notion-rest.mjs`): `readOnly: true` "throws before sending anything other than GET or a query POST (C19)"; `writeGuard(method, path, body)` "runs before every write (C12 passes the allowlist's mirror check, P3 #10)"; `createUncertain` ("never send twice") extends to POST /databases (C3) and POST /views (C20); `queryDatabase` and `queryAll` take `filterProperties`, sent as repeated `filter_properties` query parameters; `createPage` takes `parentPageId` or `parentDatabaseId` ("exactly one"); `queryDataSource(dataSourceId, opts)` is added only if C19 finds a multi-source database (C6).

### 4.2 Script inventory

**`S/pull.mjs` (C6, stage 1).**
- Inputs (Notion reads): the copy filtered by `work_tag`; the three agent databases; each enabled mirror queried with `filterProperties` (key, claim, link, sources, is factual, both write columns; property ids from `retrieveDatabase`).
- Outputs: a pull directory. `norm/claims.jsonl` rows `{ mirror, geo_id, page_id, notion_url, claim, geo_url, source_links, sources_count, is_factual, agent_tags, agent_notes }`; `source_links` from `richTextLinks`; `sources_count` from `columns.sources_count` when set, else the number of links. Rulebook rows (copy columns, filtered by work_tag); queue rows (12 columns; `decided_at` is the page's `last_edited_time`, "there is no Decided at column"); lessons (`supporting_keys` parsed from Supporting rows, `created` from `created_time`); settings (paused, rulebook_edition, last_run_summary).
- Notion writes: none.
- Flags: `pull --all` (used by `status`; most sequences in 4.3 start with `pull`, and `setup` starts with `probe`). `latestPullId` takes an optional list of needed files (for example `['claims']`); `resolvePullDir` (`S/judge.mjs:158-164`) asks for "the newest pull that holds `norm/claims.jsonl`" (P3 #12).
- Retention: "keep the last 20 pulls and every pull an unfinished run references."
- Exit codes: "A duplicate Geo ID within one mirror fails (exit 2, as today at line 416); across mirrors it is allowed."

**`S/sources.mjs` (C10, new).**
- Inputs: `norm/claims.jsonl` `source_links`. Flags: `--ids`, `--limit`, `--refresh`.
- Outputs: `runs/sources/resolve/<sha16 of the entity id>.json` (C3); `runs/sources/<sha16 of the URL>/meta.json` and `text.txt`; `runs/sources/claims/<geo_id>.json` holding `{ links, bundle_hash }`.
- Notion: none. The Geo GraphQL query and page fetches are not Notion calls.
- Exit codes: not stated.

**`S/judge.mjs` (C8, C9, C10).**
- Inputs: the pull (`loadItems`, `resolvePullDir`); `rubric.json`; config (`judge.*`, `tags`); prompts `A/prompts/judge.md` (text pass) and `A/prompts/judge-sources.md` (source pass); the source cache.
- Outputs: cell store `runs/judgments/<key16>/meta.json` and `run-<n>.jsonl`; prompt cache `runs/judgments/prompts/<h16>.md`; per run `runs/<run-id>/run.json` (args, items, passes, totals, the resume command, `capped` markers) and `runs/<run-id>/calls.jsonl`.
- Notion reads/writes: none.
- Flags, as written in C9 (L504): `--pass text|source|all`; `--tags a,b` ("expands to the groups that hold them; a group is always judged whole"); `--runs-max`; `--whole-pass` ("strict only"); `--reference <n>` ("n runs for every claim, no cap"); `--refresh` ("ignore the cache for the selected groups"). Also used in W3 but missing from that list: `--limit` (L420 `tag [--tags X] [--limit N]`; L507 `judge --tags Context-dependent --limit 200 --reference 3`) and `--items eval` (L510). `--smoke` "stays for `npm run check:model` only" (L512).
- Exit codes: 75 usage window ("resume later"; H8, L192). Others not stated.

**`S/propose.mjs` (C11, stage 1).**
- Inputs: judgment cells (cell store); the queue rows (for undecided and decided rows); pulled claim values (to compare, so that "only when they differ from the pulled values").
- Outputs: a plan (W3 does not name a plan file). The sequence `tag` runs `propose` and then `A` (apply), so propose builds the plan and apply writes it (inferred from L420 and rule 1).
- Notion writes (through apply): one update per mirror page of the Geo ID for Agent tags and Agent notes; create queue rows for unsure cells and Exact duplicate matches; update undecided rows (Agent proposal, Agent confidence, Agent reason, Rulebook edition). Never decided rows (keep `guard: { undecided: true }`).
- Functions: `claimColumns()` (new export; cut out of `run`'s claim-op block; followup reuses it); `notesFor(claim)` (new; replaces `readinessOf`). Reused: `decideVerdict`, `isLowConfidence`, `leansApply`, `proposalFor`, `capLines`, `capWords`, `tagLine`, `recommendation`.
- Flags: none named. Exit codes: not stated.

**`S/apply.mjs` (C12).**
- Command: `apply.mjs --run <id>` (`A` in every sequence). Flags: `--retry` ("the `--retry` read-before-send behaviour"); `--dry-run`.
- Inputs: a plan for `<id>` via `openPlan`, `prepare`, `readPlan`, `resolveOps`. It calls `checkPlan()` itself ("the separate `plan.mjs check` step goes").
- Outputs: the ledger; read-back results; pre- and post-pulls of mirrors "filtered to the touched columns and pages".
- Notion writes: the plan's ops only, through the client with `writeGuard` ("a mirror update naming any other property is refused before it is sent").
- Exit codes: "a missing token is exit 2 (no connector batches)". Others not stated.
- Deleted (C12): `armedState`, `disarm`, `writeBatches`, `toConnectorProperties`, the `MAX_BATCH` constant, `APPLYING.json`.

**`S/plan.mjs` (C12) (library).**
- `check` becomes the exported `checkPlan()` ("validation, allowlist, `checkGateEvidence`"). The `plan.mjs check` command is removed. Mirror ops use the database key `mirror.<name>`.

**`S/verify.mjs` (C12).**
- Reads editor-field values in Notion. Editor-field differences go "to `verify.json` and the summary line as a warning".
- No `runs/PAUSED` and no exit 5 ("R7: with one editor it would mostly catch the editor's own clicks; exit 5 stays reserved").
- Test: "an editor-field change gives a warning and exit 0" (T/verify.test.mjs).

**`S/distill.mjs` (C13, stage 2).**
- Modes: `distill` (lessons from decided rows); `distill --draft-rules <tag>` (first rules for one text tag). `--draft-rules all` is an engineer option only (C13; the skill never passes it).
- Inputs: the decided rows (pull); Agent reason; Your reasoning; the copy row for the tag; `A/evals/audit.jsonl` (draft-rules); Context-dependent's When to use as the format example; prompts `A/prompts/distill.md` and `A/prompts/draft-rules.md`.
- Model: `models.distill` (`claude-opus-5-5`), with `distill.effort` "high" and `distill.timeout_ms` 600000 (L140, L578).
- Outputs: group files recording "the keys shown"; lesson plans (Rule changes creates with Supporting rows and the page body); the draft-rules plan (one Rule changes row per tag); `run.json` with the start time "recorded before the model calls" (P3 #28).
- Notion writes: through plan and apply only.
- Exit codes: 75 on a usage window (shared classification, H8). Others not stated.

**`S/cases-sync.mjs` (C13).**
- Functions: `syncCases`, `buildCase` (also used by setup `evals`), `linkedLessons` (matches lessons "by `supporting_keys`"), `citedRule`.
- Writes local case files only. The "In regression suite" writes and `planRegression` are deleted (L577), so no Notion write remains.

**`S/eval.mjs` (C14, H7).**
- Modes: simple (default) and `--strict` (D14).
- Inputs: judgments for the baseline (cache) and the candidate; canaries; supporting rows; `gate.default`, `gate.strict`, `gate.initial_rules_*`; `S/lib/gate-evidence.mjs`.
- Outputs: `card.json` and `card.md`. "The card (`card.json`, `card.md`) adds `mode` and usage (R8); strict-only fields become optional in `card.schema.json`" (L596).
- Notion: none directly. Strict uses `pairedBootstrapDelta`, `reconfirmCandidates`, `reconfirmFlips`.
- H7: "Gate cards print 'a gated tag has under 30 labelled positives' (`S/eval.mjs:799`, constant `LARGE_SAMPLE_POSITIVES` at `:59`) while the gate gates from 5: the line names both numbers now, and from C14 it reads `gate.strict.large_sample_positives` and appears on strict cards only."
- Exit codes: not stated.

**`S/promote.mjs` (C14, C15).**
- Commands: `promote --lesson <id> [--strict]` (called `promote --lesson` in the sequences); `promote --finalize`; `promote --abort`; `promote --rollback <lesson> --confirm` (ask-gated; section 10).
- Lock: `runs/PROMOTING.json` with a `phase` field (`judging`, `planned`), "created exclusively at the start and removed on HOLD, FAIL, finalize or abort". Functions `takePromoteLock` and `releasePromoteLock`. `PROMOTE.lock` goes.
- Inputs: the lesson row; `checkLesson` (accepts Kind "Initial rules" with an empty Current text when the tag has no rules, and adopts the tag's copy row first); `syncCases` runs before items are selected; the candidate side runs `judge --tags <tag>` (its whole group).
- Outputs: card; PASS, HOLD and FAIL plans; for FAIL, one proposed sentence in the report and in `card.md` only (section 9).
- Notion writes (through plan and apply): PASS writes the copy's When to use, the lesson's Live status and Safety check result, Agent settings' Rulebook edition and Last run summary. HOLD and FAIL write only the lesson's Safety check result and Last run summary. Rollback writes the restore ops (When to use only) and the Status Rolled back (C5 allows both).
- Deleted: `DEMO_TITLE`, `localDemoFlag`, `--mark-rolled-back`, `--smoke`, `perTagSummaryWithHash`, `PROMOTE.lock`.
- Exit codes: not stated here (CLAUDE.md, outside W3, lists 10 HOLD and 11 FAIL).

**`S/followup.mjs` (C15).**
- Judges the lesson's supporting claims under the live rubric, with "cache hits from the gate's candidate side, so 0 calls".
- Writes: Follow-up (Fixed or Still wrong) on the supporting rows; the claims' Agent tags and Agent notes through `claimColumns()`; Last run summary.
- Runs automatically as promote's last step after a PASS (ED-10). `/claim-tagger follow-up` repeats it "only after a run that stopped before it".
- Argument form for a lesson is not stated (the sequence reads `followup`).

**`S/status.mjs` (C15, H2, H4).**
- Prints: "queue counts (open, decided, needs a note); lessons by status; the sources-cache summary (from C10); the PROMOTING phase; usage of the last runs (calls, tokens by kind, wall time and the share of a usage window once known, D22 ...)".
- Flags: `--check` (first step of every sequence; warns while a SETUP marker exists, H4); `--run:*` (allowed in settings; its meaning is not described); `--unpause --confirm` (ask); `--restore-rulebook --confirm` (ask); `--adopt-unjudged` (ask; "records edits made in the copy to tags without rules in force as a new rubric version (a new rulebook edition) with a changelog line, and refuses (exit 4) an edit that adds numbered rules to such a tag"). `--adopt <tag>` is not built (section 8 of W3).
- Notion writes: restore writes When to use through a restore plan (inferred; W3 says "a confirmed restore").
- Exit codes: 4 for the refused adopt-unjudged edit; drift on a judged tag "stops the run (exit 4) and names the column" (L552).

**`S/setup.mjs` (C7, stage 1; ask-gated).**
- Subcommands: `api-check --parent <link>` (C20); `page --parent <link>`; `databases`; `views`; `rulebook --from setup/taxonomy-issue.json`; `mirror-columns --confirm`; `evals`; `rubric`; `settings`; `finish`; `--demo <id>` (called only by `walkthrough.mjs start`). The sequence adds `status` at the end.
- Inputs: `A/schemas/notion/setup.json`; `setup/taxonomy-issue.json` (written by the skill from a connector read); `A/evals/canaries.exclude`; the archived cases of the 13 tags (C1 archive); the Claims to review export, anonymised with `scrubNames` and `A/anonymise.local.json`.
- Outputs: `A/runs/api-check.json`; `A/evals/audit.jsonl`; canaries; `rubric.json`, `rubric.lock`, `history/`, `CHANGELOG` (C7 `rubric`); `A/schemas/notion/as-built.md` section for the Claim tagger page, "generated from the setup plan's request log" (C17); config ids (`notion.page_id`, `notion.rulebook`, `notion.databases`).
- Notion writes: builder requests (`notion-build`, from setup plans); row plans applied with ctx.setup; `mirror-columns --confirm` calls `updateDatabase` on each enabled mirror, "the only schema write ever made to a real database" (C7).
- `finish` runs the probe, then removes `runs/SETUP` (H4).
- Exit codes: 2 for a missing audit file ("refuses with exit 2 when the file is missing", H5/C7) and for a same-name column of another type ("refuses (exit 2) a column of the same name with another type", C7).

**`S/walkthrough.mjs` (C21, stage 2).**
- Commands: `start --parent <link|id>` (required, "no default", D24) `[--dry-run] [--resume <id>] [--manifest <path>]`; `run [--demo <id>] <script> [args]`; `where [--demo <id>]`; `verify [--demo <id>] [--json]`; `list`.
- Inputs: `A/walkthrough/manifest.json` and `A/walkthrough/page.md` (content in W4).
- Outputs: profile `A/demos/<id>/` (git-ignored): config with `demo: true` and `demo_id`; rubric from the manifest's tag row; canaries; `demo.json`; `setup-plan.json`; `preview.md` (from `planStructure` and `renderPreview`).
- `start`: validates the parent; writes the profile and plans; sends the structure (`runStructure`, ids recorded in `demo.json` as they are created); creates `runs/SETUP` in the demo root; pulls; applies the row plans of `setup.mjs --demo`; pulls; runs `cases-sync`; removes the marker; runs `verify`; prints the three-part report. `--dry-run` "stops after the plan and the preview and sends GET requests only".
- `run`: reuses `runScript` and `SCRIPTS` (from the deleted `sandbox.mjs`) with root `demoRoot(id)` (the newest demo by default); "refuses any root outside `A/demos/`"; for `promote` and `followup` without `--lesson`, it fills in "the demo's only Approved (or Live) lesson" (R15).
- Exit codes: "an unreachable parent exits 2"; "a protected parent exits 4" (test list, L618).

**`S/probe.mjs` (C2, C19).**
- `node S/probe.mjs`: classifies targets. Protected: expect 404 or 403. Mirror: expect 200, the key column, and from C7 on both write columns; "a mirror without write columns before setup is reported, not failed" (T/probe.test.mjs). Configured: expect 200 and the title from `A/schemas/notion/setup.json` (from C7 on). Exit 0 when all pass (L253).
- `probe --mirror <name> --dry-run` (C19): one `retrieveDatabase`; a full query with `filterProperties` (key, claim, link, sources, is factual, and both write columns if present) through a `readOnly` client; 20 sample Geo source links resolved with `resolveGeoEntity`. Writes `runs/dry-run/<run-id>/report.json` and `report.md`; prints one summary line.
- Notion: reads only.

**`S/transcript-check.mjs` (kept, C16).** Grades headless transcripts (C18 step 3; C22 evals). Kept "because P3's headless report check (C18) and the walkthrough evals (C22) use it; it is not part of any subcommand" (L233). Output format not stated.

**`S/hooks/guard.mjs` (C5, H3).** The PreToolUse hook; see section 12. It reads no config and no state, and "fails closed".

**`S/loop.mjs` (C22, conditional).** Built only if the headless check finds Insight blocks: "`S/loop.mjs <subcommand>` (P2 2.4: runs the fixed sequence and prints the three-part report for verbatim relay) is built only if that check fails" (L626). P2 is external.

**Libraries named in W3 (not scripts):** `S/lib/config.mjs` (C2: `loadConfig`, `dbNames`, `dbEntry`, `mirrorEntries`, `capabilityOf`, `groupOf`, `isDemo`); `S/lib/paths.mjs` (C2: `demosDir()`, `demoRoot(id)`); `S/lib/cells.mjs` (C8); `S/lib/geo-sources.mjs` (C3: `parseGeoSources`, `resolveGeoEntity`); `S/lib/notion-blocks.mjs` (C20: markdown subset and the lint); `S/lib/notion-build.mjs` (C20: `planStructure`, `runStructure`, `renderPreview`); `S/lib/notion-rest.mjs`, `S/lib/notion-values.mjs` (C3: `richTextLinks`), `S/lib/notion-contract.mjs` (C5); `S/allowlist.mjs` (C5: `assertWritable`, `dbNames`, `isProtectedDatabase`); `S/lib/gate-evidence.mjs` (C14); `S/lib/rubric-build.mjs` (C4; `scrubNames` at L57); `S/lib/claude.mjs` (H8: `USAGE_WINDOW_RE` at L27, `usageResetHint`); `S/lib/hash.mjs` (`h16`, `sha256Hex`); `S/lib/rng.mjs` (`seedFromString`, `shuffle`, `sample`); `S/lib/stats.mjs` (`wilson` deleted, C16).
### 4.3 Subcommand sequences (C17, L414-428, verbatim)

"`A` is `apply.mjs --run <id>`; every subcommand starts with `status.mjs --check`."

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

"Who types: the editor types every row of this table except `setup`, which the engineer runs once and repairs when it breaks (ED-2)." (L428)

### 4.4 Exit codes as W3 uses them

| Code | Where W3 uses it |
|---|---|
| 0 | `probe` exits 0 when every check passes (C2, L253); a verify editor-field difference is a warning and exit 0 (C12). |
| 2 | Duplicate Geo ID in one mirror (C6); missing connector token ("a missing token is exit 2", C12); missing audit file in `setup evals` (H5, C7); same-name column of another type in `mirror-columns` (C7); unreachable parent in `walkthrough start` (C21 tests). |
| 4 | Drift on a judged tag, which "stops the run (exit 4) and names the column" (C15); `status --adopt-unjudged` refuses an edit that adds numbered rules (C15); a protected parent in `walkthrough start` (C21 tests). |
| 5 | Reserved: "no exit 5 (R7 ...; exit 5 stays reserved)" (C12). |
| 75 | Usage window, "resume later". Three transient failures in a row end the run with exit 75 and the resume command (H8; C0 Accept, L200); C18 step 4 tests "exit 75, then the same command continues". |
| not in W3 | 1, 3, 10 (HOLD) and 11 (FAIL). The repo CLAUDE.md lists 10 HOLD, 11 FAIL and 3 paused; W3 does not map them to promote or status. |

## 5. Rubric file: edition, lock, hashes, history, changelog, drift, restore

### 5.1 Files and their names

- W3 names `rubric.json`, `rubric.lock`, `history/` and `CHANGELOG`. "`rubric`: `buildRubric` from the copy pull; writes `rubric.json`, `rubric.lock`, `history/` and `CHANGELOG`" (C7, L474). Schema: `A/schemas/rubric.schema.json` (C4).
- Where the new rubric folder lives is not stated. C1 moves the old `A/rubric/` to `A/archive/trial-2026-10/`.
- Naming formats for files in `history/`, the lock's content, and the CHANGELOG format are not stated. The changelog gets "a changelog line" (C15) through `appendChangelog` (exported from `S/promote.mjs`, C7).

### 5.2 Editions and versions

- "version 1 of `rubric.json`" is the first rulebook edition, whose rules are "in force as copied" (L173, C4 L279).
- Setup accept (C7, L482): "`status` shows rulebook edition 1 in force."
- A later rule change comes "only through `applyLesson` after a gate PASS (C14)" (C4, L279). `--adopt-unjudged` "records edits ... as a new rubric version (a new rulebook edition) with a changelog line" (C15, L552).
- The edition in Agent notes is written in another shape: "edition 2026-10-15.2" (C11, L530 and L535). See section 14.
- Functions for versions: `nextVersion`, `candidateVersion`, `buildCandidate`, `writeLock`, `appendChangelog`, `diffRubric` (C14 reuse; C4 reuse; C15 reuse).

### 5.3 Hashes

- Tag hash: `tagHash`; rule hash: `ruleHash`; rubric hash: `rubricHash`; `rehash` and `checkHashes` check them (C4 L281, C7 L478).
- "`deterministic` and `needs_source_reading` come from `capabilityOf` and stay outside `tagHash` (unchanged)" (C4, L277).
- Judge cache keys use each judged tag's `tag_hash` (C8, section 6.9). `item_hash` is `textHash(claim)` in the text pass and `h16(claim + bundle_hash)` in the source pass.
- Tag hash, Rule version and Changed by are not written to Notion any more: the PASS plan writes "no Runs row, Tag hash, Rule version, Changed by or In regression suite" (C14, L599).

### 5.4 Drift detection

- `computeDrift` (C6, L381): "ignore tags that have no rules on both sides (D23)."
- Judged tags: "Drift on a judged tag (any column) still stops the run (exit 4) and names the column: a person reverts the edit in Notion until `status --adopt <tag>` exists (section 8)" (C15, L552). `status --adopt <tag>` is not built (section 8: "`status --adopt <tag>` for judged tags", trigger: "the first time the team edits a judged tag in the copy and wants to keep the edit").
- Tags without rules: edits are adopted by `status.mjs --adopt-unjudged` (ask-gated; H2, C15). Rule 4 (L163) and C4 (L279): "`--adopt-unjudged` (C15) never adds rules."
- Restore is separate (5.5).

### 5.5 Restore (the "restore command")

- Command: `status.mjs --restore-rulebook --confirm` (ask-gated; H2, L343). Reuse list: `buildRestorePlan`, `restoreOps` ("When to use only"), `restoreEvidence`, `inspect`, `lockState` (C14, C15).
- Rule 10: the copy accepts When to use "after a gate PASS or a confirmed restore".
- Source of the restored text is not stated in W3.
- Lesson rollback (a different path): `promote.mjs --rollback <lesson> --confirm` (ask-gated; section 10).

### 5.6 The rubric build (C4, L271-285)

- "`buildRubric`: drop the Verified filter (line 176); take the rows the pull already filtered by Work tags containing `work_tag`."
- "`rowToTag` (line 135): keep the row's Status (Verified, Proposed or empty) instead of stamping Verified; Category and Polarity may be empty; read the taxonomy's column names (Name, Description, When to use, Example Claims, Counterpart, Category, Polarity, Status, Geo Status, Geo Tag ID, Verified on, Evidence)."
- "`judged = rules.length > 0 && capability is text or source` (deterministic tags are computed, corpus tags never judged); `deterministic` and `needs_source_reading` come from `capabilityOf` and stay outside `tagHash` (unchanged)."
- Example Claims: "one example per line; strip a leading '- ' and surrounding quotes; lines that the conservative parser rejects (C7; the known case is Incorrect grammar's '255 legacy linked claims; see ...') are left out of `example_claims`, so they never reach the judge prompt or the canaries."
- Schema: "`status` is Verified, Proposed or null; `polarity` and `category` are nullable; `human_only` stays (false for all 13)."
- Accept (L285): "building from the fixture gives 13 tags: Context-dependent, Improperly sourced, Source inaccessible and Factually challenged judged; Unsourced deterministic; the six text tags and the two duplicate tags not judged; hashes check; the schema validates."
- Fixture: `T/fixtures/notion/db.rulebook-copy.json`, "the 13 rows of `claim-tags-verified.9oct.rows.json` plus the 13 Oct delta (the two status-less duplicate rows, Multi-sentence's Classification polarity, the non-claim Example Claims text)" (L284).
- Stage 1 accept (L482): "`rubric.json` has 13 tags, 4 judged".
## 6. Judge (C8, C9, C10; H8)

### 6.1 Scope and groups

- Scope (C9, L503, verbatim): "`scopeOf(rubric, config)` returns the judged tags per group (`G1`, `G2`, `S`), the code-decided tags (Unsourced, Exact duplicate) and the not-checked ones (Semantically duplicated; tags without rules). A group without a judged tag is skipped."
- Groups (config L85-89, R4): G1 = Context-dependent; G2 = Multi-sentence, Trailing period, Improper capitalization, Incorrect grammar, Poor wording, Wordy; S = Improperly sourced, Source inaccessible, Factually challenged.
- "A tag with no rules in force is never judged" (L135).
- Judged = `rules.length > 0 && capability is text or source` (C4, L277).

### 6.2 Batching and calls (C9, L505, verbatim)

"Batching: run 1 for every item without a run-1 line in its group's store; batches of `batch_size` per group (one claim per call in S); the system prompt per group with `renderSystemPrompt` and `renderTag`, cached under `runs/judgments/prompts/<h16>.md` with `ensureSystemPrompt`'s checks; replies checked with `validateJudgeOutput(..., { modelTags: groupTags })`."

Settings in config (L82-97): `batch_size` 8, `concurrency` 2, `effort` "medium", `max_turns` 1, `timeout_ms` 300000, `claude_bin` "claude", `max_error_share` 0.1. The model is `models.judge` = "claude-sonnet-5-5" (L72). W3 describes the batch size and `S` (one claim per call); it does not describe `concurrency`, `max_turns` or `max_error_share`.

### 6.3 Attempts, transient errors and the usage window (H8, L192; C0 Accept, L200)

H8, verbatim: "`USAGE_WINDOW_RE` (`S/lib/claude.mjs:27`) treats any 429 or 'overloaded' as the end of the usage window, so one passing error stops a long run with exit 75. Split it: the usage window is `/usage limit|limit reached|resets?/i`; 429, 529, 'rate limit' and 'overloaded' are transient and retried after 30 s, then 120 s; only three transient failures in a row stop the run as a usage window. Judge (`S/judge.mjs:849-851`), distill (`S/distill.mjs:323`) and promote (`S/promote.mjs:295`) share the classification; `usageResetHint` is unchanged."

- Two checks decide the class: a message matching `/usage limit|limit reached|resets?/i` is the usage window, which ends the run with exit 75 and the resume command. A message with 429, 529, "rate limit" or "overloaded" is transient.
- Literal reading of the retry rule: transient failure 1, wait 30 s, retry; transient failure 2, wait 120 s, retry; transient failure 3 in a row stops the run as a usage window (exit 75). W3 does not say "two attempts per batch". The call log's `attempts` field (L509) and "usage summed across attempts" show that attempts are counted, but no per-batch attempt count is written.
- Test fixture: `T/fixtures/fake-claude.mjs` gains "a 429 or overloaded mode and a 'usage limit reached, resets 3pm' mode" (L199). Acceptance (L200): "a fake 429 followed by success finishes the batch, and three in a row exit 75 with the resume command."
- Order of the two regex tests when a message matches both is not stated.

### 6.4 Cell store, cache key and batch lines (C8, L486-496)

- Purpose: "cache judgments per tag group, keyed only by what changes that group's answers, so neither a rule change nor a CLI update re-judges the whole mirror."
- Key (R4, L489), verbatim: "`h16(pyJson({ driver, model, effort, pass, prompt_version, group, tags: [{ name, tag_hash }] sorted by name }, { sortKeys: true }))`, where `tags` are the group's judged tags. The CLI version is recorded on every line, not keyed."
- Layout: "`runs/judgments/<key16>/meta.json` (the key's inputs) and `run-<n>.jsonl`; one line per item: `{ id, item_hash, status, tags: [{ name, decision, p, rule_ref, rule_hash, trigger, reason, basis }], call: { run_id, batch, call_tags, usage, cli_version } }`; the last line for an item wins."
- `item_hash` is `textHash(claim)` in the text pass and `h16(claim + bundle_hash)` in the source pass, "so changed sources re-judge".
- One LOCK per store. `--whole-pass` (strict only) adds `context_hash`, "the hash of the sorted tag hashes of every group in the call".
- Size: "A few dozen files instead of about 30,000 at 2,351 claims."
- Accept (L496): "on the fakes, a G1 rule change leaves the G2 and S stores as cache hits; a CLI version bump hits every store."
- Tests (L495): `T/cells.test.mjs` (new) and `T/hash.test.mjs`.
- Replaces four readers: `makeDoneCheck` (judge), `loadJudgments` (propose), `loadSide` (eval), `readRuns` (followup). Deleted in C9: `computeConfig`'s whole-rubric key, `makeDoneCheck`, the per-config `ledger.jsonl`, the fixed `judge.runs` loop, and the batch cost copied into every item (line 815).

### 6.5 Adaptive runs and calibration (C9, L506-507; D19, R1)

- "After run 1, a cell is unsure when its decision is `ask_editor` or its `p` lies strictly inside `judge.rerun.band`."
- "A claim with an unsure cell in a group is a candidate for run 2 of that group; at most `max_share` of the run's claims get run 2, lowest margin first (margin = the smallest `|p - 0.5|` among its unsure cells; `ask_editor` counts as 0); run 3 only for a claim and group whose runs 1 and 2 disagree on an unsure cell."
- "Applied cells with high confidence are not re-read (D19 narrows D13)."
- "Candidates beyond the cap keep their one run and are marked `capped` in `run.json`; propose queues them if they are still unsure."
- The 30% limit: `judge.rerun.max_share` = 0.30 (L84), applied to "the run's claims".
- Run 1 is shared by every claim. The 2-run and 3-run work happens only on candidates.
- Calibration (D19), "once, on the first 200 real claims: `judge --tags Context-dependent --limit 200 --reference 3`. The run card compares the adaptive verdict (run 1 plus the capped re-reads it would have made) with the 3-run majority: the share of claims with a trigger, the share re-read, the cells whose verdict differs, and how many of those would have stayed out of the queue. Mika decides whether to widen the band or raise the cap (proposal: act when more than 2% of cells change verdict outside the queue). About 50 extra calls at 8 claims per call, because run 1 is shared."
- Accept (C9, L517): "on the fakes, 100 claims of which 20 are unsure take about 17 calls against 13 for one pass (about 1.3x); on the real mirror, the stage-1 milestone."
- `--reference <n>`: "D19 calibration: n runs for every claim, no cap" (L504).
- Tests (L516): `T/adaptive-runs.test.mjs` (new, P3): "run 1 for all, run 2 only on triggers and for at most 30% of claims, lowest margin first, run 3 only on disagreement, one call line per call with usage summed over attempts, resume after exit 75."

### 6.6 Accounting per call (R8, P3 #16; C9 L509)

"Usage (R8, P3 #16): one line per call in `runs/<run-id>/calls.jsonl` (`{ group, pass, batch, items, attempts, usage: { input, cache_write, cache_read, output }, list_usd, duration_ms, cli_version, status }`, usage summed across attempts), replacing the per-config `ledger.jsonl`; `run.json` keeps args, items, passes, totals and the resume command; dollars appear only as 'list-price equivalent' in `run.json`."

### 6.7 CLI version (C9 L510; P3 1e)

"CLI version (P3 1e): recorded per line; when it differs from a store's last line, judge prints one warning and `status` suggests judging the canaries once (`judge --items eval`); invalidating stays manual (`--refresh`)."

### 6.8 Prompt structure

- Files: `A/prompts/judge.md` (text pass) and `A/prompts/judge-sources.md` (source pass). Config key `judge.prompts` (L97).
- Change (P3 #20, L511): "`prompts/judge.md` stops naming the old scope ('Tags about sources ... and Editor verified are decided elsewhere') and the 'Predictive rule 1' example; the in-scope tags and a neutral rule reference (`<Tag> rule <n>`) are injected."
- Rule text is rendered per tag with `renderTag`; the system prompt is rendered per group with `renderSystemPrompt` and cached at `runs/judgments/prompts/<h16>.md` (L505).
- Named sections in the prompt: the fake model "keeps reading the 'Tags you must decide' section" (C9 tests, L516). This is the only prompt section W3 names.
- Source pass (C10, L646): "the excerpts quoted as data inside `<source n status url>` blocks (hard rule 3), the same JSON contract and `validateJudgeOutput`, cells keyed by the bundle (C8)."
- Claims in the judge prompt: W3 does not say how the text pass wraps the claim. `<claim>` blocks are named for the FAIL wording call (section 9) and for hard rule 3 (L161 wording in section 1.8).

### 6.9 Output JSON shape

W3 does not give the judge reply's JSON shape. The fields and values W3 does name:
- Decision words: `apply`, `do_not_apply`, `cannot_tell`, `ask_editor` (L508, L644-646; C11).
- `p`: a number; code-decided apply uses `p` 1.0 (L508). Band [0.25, 0.75] (L84).
- Per tag inside a cell: `name`, `decision`, `p`, `rule_ref`, `rule_hash`, `trigger`, `reason`, `basis` (L489).
- Basis words: `deterministic` (Unsourced), `mirror_hash` (Exact duplicate match), `no_corpus` (Semantically duplicated; Exact duplicate with no match), `fetch` (source pre-decisions) (L508, L646).
- Error state: "unsure = `ask_editor` or error" (C11, L525).
- Validation: `validateJudgeOutput(..., { modelTags: groupTags })` (L505), and the same validator for source replies (L646). Its rules are not restated.

### 6.10 Source pass (C10, L637-652)

- Input: `norm/claims.jsonl` `source_links`; resolution through `resolveGeoEntity` (R9): "one GraphQL query per entity, cached by entity id"; a plain external link is used as it is; "unresolved means not checked".
- Fetch (D12): "one fetch per Web URL, cached as `runs/sources/<sha16 of the URL>/meta.json` and `text.txt` (scripts, styles and navigation stripped, whitespace collapsed); `per_host_delay_ms` between requests to one host; `fetch_timeout_ms`; at most 5 redirects; at most `max_bytes`; one retry on a network error or a 5xx; a refetch after `refetch_after_days`."
- Statuses (L644), verbatim: "`ok` (readable, at least `min_words`), `thin` (a possible paywall or a page that needs JavaScript), `paywall` (marker strings), `blocked` (401, 403, 429, 451 or a challenge page; D12: recorded as inaccessible), `not_found` (404, 410), `server_error` (5xx after the retry), `timeout`, `network`, `pdf` (counted as inaccessible: Source inaccessible rule 1 names an 'unreadable document', and Node built-ins cannot read PDFs), `unresolved` (our tools failed: not checked)."
- Excerpts (L645): "the title, the first 1,500 characters, then the windows of 400 characters either side with the highest word overlap with the claim, up to `excerpt_chars`; at most `max_sources_per_claim` sources per claim."
- Code pre-decisions (L646, basis `fetch`, no model call): "no source: all three source tags `do_not_apply` (Unsourced applies); every source hard-failed: Source inaccessible applies and the other two are `cannot_tell` (Improperly sourced rule 3); nothing readable and something unresolved: all three not checked, no queue row. Otherwise one call per claim (group S) with `prompts/judge-sources.md`."
- The source tags are judged "one claim per call" (L137, L509); `batch_size` does not apply.
- Acceptance (L652, on the mirror): "`sources --limit 50`, then `tag --pass source --limit 50`, report the resolved, fetched and not-checked shares; no claim gets Source inaccessible from an unresolved link."
- Words "hard-failed", "readable", and the status "thin" are not defined in W3 (section 14).
## 7. Propose: queue rows, Agent tags and Agent notes (C11, C5, C20)

### 7.1 Queue rule (C11, L539, verbatim)

"Queue (D18): create a row for every unsure text or source cell that has no row yet, and for every Exact duplicate match (D17), with no cap and no priority; update undecided rows (Agent proposal, Agent confidence, Agent reason, Rulebook edition); never touch decided rows (keep `guard: { undecided: true }`). Corpus tags and tags without rules never get a row. Agent reason: at most `queue.reason_max_words` words, then the rule and k/n runs; this is where the per-tag confidence, rule and reason live now that the mirror's notes do not show them (ED-9). The queue views sort by Agent confidence (C7)."

Note the conflict between "for every Exact duplicate match" and "Corpus tags ... never get a row" in the same paragraph (section 14).

### 7.2 Queue row fields and who fills them

The twelve fields and their writers are in section 1.2. The points that matter for propose:
- Created or updated only by plans (rule 1), applied by `apply.mjs`.
- Decided rows are never touched. Only Follow-up is accepted on a decided row (C5).
- Source-tag rows: "a queue row on a source tag carries the source lines in Agent reason and the excerpts, exactly as the judge read them, in its page body (P3 1d; ED-9)" (C10, L647). "P3's extra 'Sources checked' and 'Evidence' columns are left out: the queue keeps its 12 columns (R12; section 8)."
- Agent reason string format: not given beyond "at most `queue.reason_max_words` words, then the rule and k/n runs" (C11); the form "k/n runs" is named but not shown.
- `decided_at` for the queue is the page's `last_edited_time` (C6), because there is no Decided at column.

### 7.3 Verdict and unsure logic (C11, L524, verbatim)

"`decideVerdict` is called with the number of runs the cell has (1, 2 or 3). `isLowConfidence`: unsure = `ask_editor` or error, runs not unanimous, or a mean p inside `judge.rerun.band`; `cannot_tell` on a corpus tag is never unsure. `proposalFor` returns one of Applies, Does not apply, Can't tell (the same words as Tag outcome)."

### 7.4 Agent tags (C11, L526, verbatim rule)

"Agent tags (comma-separated names of the tags that apply and are not waiting for a person: the agent is sure, or an editor decided and always wins; a tag that waits in Your queue is not written, so the team never reads a guess as a result, answer 2)."

Claim ops: "one update per mirror page of the Geo ID, writing Agent tags ... and Agent notes ... only when they differ from the pulled values" (L526).

### 7.5 Agent notes: format (C11, L525-536)

"`notesFor(claim)` (new; it replaces `readinessOf`, whose readiness word no longer starts Agent notes) builds Agent notes as at most two short lines, so that the column the whole team reads stays one glance per claim (ED-9). Line 1: the tags that apply and are not waiting for a person (the agent is sure, or an editor decided), comma-separated, or `no tags`. Line 2, parts joined with ' · ': how many tags wait for an editor (an unsure cell or an error, each with a queue row); what was not checked; the rulebook edition."

"'Not checked' counts by kind: source tags while the source pass has not run or the source link could not be resolved, duplicate tags whose verdict is `cannot_tell` with basis `no_corpus` (C9: Semantically duplicated always, and Exact duplicate when its free exact-text check found no match, which is not proof), and text tags without rules in force; the part is left out when everything was checked."

"Per-tag confidence, rule and reason are not in the notes: they live in the queue row (Agent reason) and in the run files. No readiness word begins the notes any more."

Limit: "Agent notes (the two lines above, at most `notion.max_text` characters)" (L526).

Examples, verbatim (L528-536):

```
Context-dependent, Wordy
1 waits for an editor · not checked: 3 source tags, 2 duplicate tags · edition 2026-10-15.2
```

```
no tags
nothing waits for an editor · edition 2026-10-15.2
```

Accept (L544): "on the fakes, every unsure cell gets a row and no confident one does; decided rows are untouched; mirror updates name only Agent tags and Agent notes; no Agent notes cell has more than two lines."

### 7.6 Deleted in propose and config (C11, L541-542)

- Deleted: `priorityOf`, `mergeWhy`, `isoWeek`, `fullNote`, `readinessOf` (replaced by `notesFor`), the weekly-cap block (lines 589-606) and `runs/state/queue-week.json`, the "rule changed" detection (lines 539-541; "the Rulebook edition column stays"), the writes of Readiness, Tag confidence and Last judged.
- Config: reads `queue.reason_max_words`, `judge.rerun.band`, `tags`; removes `readiness`, `queue.weekly_cap_default`, `queue.why_max_words`.
- Tests (L543): `T/propose.test.mjs` (P3: capability routing, a different number of runs per claim, no cap, the two mirror text columns, the two-line notes form with its counts, an unsure tag absent from Agent tags and counted in line 2, corpus and rule-less tags counted under 'not checked' and never queued); `T/capability.test.mjs` (C9).

## 8. Distill: grouping, limits, the Opus call, the output (C13; R5, R13, D7, ED-6)

### 8.1 Purpose (L565)

"turn the editor's 'the rule is the problem' decisions into at most three focused rule changes per run, and draft first rules for the six text tags that have none, one tag per run in the order the editor chooses."

### 8.2 Grouping and threshold (L568)

"Grouping (R5): `groupRows` groups by (tag, cited rule) and keeps `why` (Rule unclear or Rule should change) on each row; `thresholdOf` needs `distill.min_claims` (2) distinct claims for either reason (D4: the owner-ruling route goes)."

### 8.3 Cited rule (R13, L569)

"`citedRule(row, tag)` takes the rule the editor names in Your reasoning first ('rule 4', with or without the tag name), then the agent's `<Tag> rule <n>` in Agent reason (the full-note field is gone). The demo's two rows form one group even when the agent cited rule 2 on one of them."

### 8.4 Large groups and counter-evidence (R5, P3 #15, L570)

"Large groups (R5): above 30 rows, newest first, rows with reasoning first, both outcomes represented; the group file records the keys shown, and the unseen rows go first next run. Counter-evidence (12 rows): same rule, opposite outcome first, not key order (P3 #15)."

### 8.5 Patterns per group and lesson limits (L571)

"One Opus call per group may return up to 3 patterns, each with the row keys it rests on; a lesson's Supporting rows are only the rows it cites (P3 #15). At most `distill.max_lessons_per_run` (3) lessons per run, ranked by distinct supporting claims; the rest wait for the next run."

Limits in one place: at least `min_claims` (2) distinct claims; at most 3 lessons per run; at most 3 patterns per group call; the 30-row threshold for large groups; the 12-row counter-evidence set (C13 and L570).

### 8.6 Cited-rule dedupe and overfit check (L576)

Reuse: `ngramOverlap`, `lessonTexts`, `parseRuleLabel`, `targetCurrentText`, "the dedupe against open lessons and the 8-word overfit check (P1)". The overfit check is `distill.overfit_ngram` = 8 (L114). The check's effect on a lesson is not restated.

### 8.7 The plan and Supporting rows format (L572, verbatim)

"Plan: one Rule changes create per lesson: Lesson, Tag, Rule, Kind, Current text, Proposed text, Status Proposed, Supporting rows. Supporting rows format (new; P1 said 'a list of keys'): one line per row, the claim shortened to 60 characters, ' · ', then the row's Key; pull parses the trailing Keys (C6). If the text would pass `notion.max_text`, the remaining rows are listed in the lesson's page body and the column ends with '+ n more in the page'. `lessonMarkdown` writes the page body with the supporting claims in full."

### 8.8 Fixes (P3 #28, L573)

"Fixes (P3 #28): the example claims are sent once; `run.json` records the start time before the model calls."

### 8.9 Draft rules for first rules (D7, ED-6, L574, verbatim)

"Draft rules (D7, corrected: 8 tags lack rules, not 9, and the two duplicate tags are corpus tags under D17, so the step covers 6: Multi-sentence, Trailing period, Improper capitalization, Incorrect grammar, Poor wording, Wordy): `distill --draft-rules <tag>` drafts the first rules of one tag, chosen by the editor, for a text tag with an empty When to use (ED-6: the editor never gets six drafted rulebooks at once). `--draft-rules all` runs the same code once per tag; it is an engineer option for tests and calibration, the skill never passes it, and the editor's path has no 'all'. Input: the copy row (Description, Example Claims, Counterpart, Category), the tag's rows in `A/evals/audit.jsonl`, and Context-dependent's When to use as a format example. `prompts/draft-rules.md` returns `{ preamble, rules[], note, open_questions }`; one Opus call per tag. Plan: one Rule changes row, Kind 'Initial rules', Rule `<Tag> when to use`, Current text empty, Proposed text from `composeWhenToUse(...)`, Status Proposed. The report and the lesson's page body show the tag's example claims (the copy row's Example Claims) next to the drafted rules, so that the editor judges the draft against them. Before drafting, the tag's current copy row is adopted (the `--adopt-unjudged` code, C15)."

Acceptance (L580): "on the fakes, `draft-rules <tag>` creates one Proposed row with numbered rules and its report shows the tag's example claims; the engineer option `all` creates the six rows. On the real workspace (stage 3): the editor picks one tag, and `draft-rules <tag>` creates one Proposed row with numbered rules; the next tag follows in a later run, in the editor's order."

### 8.10 The Opus call

- Model: `models.distill` = "claude-opus-5-5" (L72). Effort "high" and timeout 600000 ms (L114, L140, L578). "Opus runs at the CLI default" today (P3 #21).
- Used by `distill` (lessons) and `distill --draft-rules <tag>`, and by the promote FAIL wording call (section 9), which "reuses distill's CLI call and reply check" (C14, L597).
- Replies: lessons return up to 3 patterns (8.5); draft-rules returns `{ preamble, rules[], note, open_questions }`.
- Calls and timeouts: exit 75 on a usage window, with the shared classification (section 6.3).

### 8.11 Cases and linking (C13, L575)

"`S/cases-sync.mjs`: `linkedLessons` matches by `supporting_keys`; `citedRule` as above." Functions reused: `buildCase`, `syncCases`.

### 8.12 Deleted, config, tests (L577-579)

- Deleted: `link`, `--link`, `plan-link.jsonl`, `--demo-bad-lesson` and `lessonMarkdown`'s planted-lesson branch (with the two test cases that read the archived seed files, C1), the "Distill <date>" Runs row, `planRegression` and the "In regression suite" writes in cases-sync.
- Config: reads `distill.min_claims`, `max_lessons_per_run`, `overfit_ngram`, `effort`, `timeout_ms`; removes `distill.min_claims_rule_change` and `owner_ruling_at`.
- Tests: `T/distill.test.mjs` (P3: grouping by tag and rule, the rotation of large groups, several patterns per reply, support limited to cited rows, at most 3 lessons, the Supporting rows format); `T/cases-sync.test.mjs` (the editor's "rule 4" wins over the agent's "rule 2"; `linkedLessons` by keys); `T/draft-rules.test.mjs` (new, P3: the fake model drafts rules that become a Proposed row; the tag stays unjudged until its rules pass the gate; the taxonomy is never written; one tag per run, with `all` only as the engineer option; the example claims are in the report); `T/fixtures/loop/fake-claude.mjs` gains the draft-rules reply.
## 9. Promote: gates, PASS and FAIL writes, follow-up, --strict (C14, C15; D14, D20, R2, ED-10)

### 9.1 Sequence and lock

- Sequence (L423): `pull`; `promote --lesson`; A; `promote --finalize`; commit; `followup`; A.
- The lock is `runs/PROMOTING.json` with a `phase` field (`judging`, `planned`), "created exclusively at the start and removed on HOLD, FAIL, finalize or abort". `PROMOTE.lock` goes (C14, L599).
- `checkLesson` accepts Kind "Initial rules" with an empty Current text when the tag has no rules, and adopts the tag's copy row first (C15). "The 'New or promoted tag' refusal goes" (L599).
- `syncCases` runs before the items are selected. The candidate side runs `judge --tags <tag>` (its whole group).

### 9.2 The simple gate (default), verbatim from C14 (L587-594)

"`evaluate({ mode: 'simple' | 'strict' })`. Simple mode checks the changed tag's group (R4: with per-group keys the group's other tags are re-judged too, so their cases are checked; other groups are identical by key):

- S1: every active canary of the group's judged tags passes.
- S2: no active case of the group's judged tags that passes under the live rubric fails under the candidate.
- S3: every supporting row comes out as the editor decided.
- S4: no model `apply` on a tag whose capability is corpus or deterministic.
- S5 (initial rules only): on a fixed seeded sample of `gate.initial_rules_sample` (30) mirror claims, the tag applies to at most `initial_rules_max_rate` (50%); the applied claims are listed in Safety check result for the editor (P1 finding 5: otherwise the gate cannot see over-tagging by new rules)."

- "Each side is judged like any run (D19 re-reads included)."
- "Flip re-judge (D20, R2): every item whose answer on a checked tag differs between the sides is judged `gate.default.flip_rejudge_runs` (2) more times on each side, and that side's answer is the majority of its 3 runs (about +4 calls for 3 flips, P3)."
- "Verdict: PASS or FAIL; HOLD only when there is nothing to evaluate."

PASS and FAIL conditions in plain form: W3 lists S1 to S5 and the flip re-judge, and says the verdict is PASS or FAIL. It does not state the rule that combines S1 to S5 into PASS or FAIL. The only statement about outcomes is the acceptance line (L605): "on the fakes, a lesson that fixes its rows and breaks nothing PASSes with the baseline from cache, and a single chance flip that the re-judge reverses does not FAIL" (section 14).

Flipped-claim re-read, plainly: an item whose answer differs between the two sides gets two more judgments on each side, so each side has three runs and takes the majority.

### 9.3 Strict mode (`--strict`, D14; C14 L595)

"Strict mode (`--strict`, D14): today's conditions 1-5 (`S/eval.mjs:681-755`), `pairedBootstrapDelta`, reconfirmation with `gate.strict.reconfirm_runs` (5) and `reconfirm_max` (16), `--whole-pass`; the 'small sample' line reads `gate.strict.large_sample_positives` and appears on strict cards only."

W3 does not restate strict conditions 1-5. The config keys are in section 3.5. Strict is "P1's, used only with `--strict` (D14)" and is not routine (section 8 of W3).

### 9.4 Safety check result text and card (C14, L596, verbatim)

"Safety check result text in Rule changes (the editor-facing name of this column; ED-8): 'PASS: examples 11/11, earlier 5/5, yours 2/2' or 'FAIL: '<claim, 60 characters>' now Does not apply'. Canaries are called examples (P3 #8). The card (`card.json`, `card.md`) adds `mode` and usage (R8); strict-only fields become optional in `card.schema.json`."

### 9.5 What PASS writes (C14, L599, verbatim)

"The PASS plan writes the copy's When to use with `expect` on the current text, the lesson's Live and Safety check result, and Agent settings' Rulebook edition and Last run summary (a short line such as 'Promote · 15 Oct 11:20 · PASS', with no duration or call count); no Runs row, Tag hash, Rule version, Changed by or In regression suite."

- The copy write is the When to use column only (rule 10); `expect` on the current text is an optimistic check.
- Edition bump: PASS writes the Rulebook edition in Agent settings. The new version comes from `candidateVersion`, `buildCandidate` (C14 reuse list) and `nextVersion` (C15 reuse list). The edition's format is not stated (section 14).
- After a PASS, "finalize, commit and follow-up (C15) run in the same subcommand" (L599). The sequence table (L423) lists them as separate steps (section 14).

### 9.6 What HOLD and FAIL write (C14, L599, verbatim)

"HOLD and FAIL plans write only the lesson's Safety check result and Last run summary."

Neither writes When to use, the Live status, or any copy row. The lock is removed on HOLD and FAIL.

### 9.7 The FAIL report and the proposed Editor wording sentence (C14, L597, verbatim)

"The report after a FAIL (answer 4): besides the figures and the quoted claim, it proposes one sentence for Editor wording, written from the claim the check named. `S/promote.mjs` makes one call to `models.distill` (rule wording is its job; this path only, reusing distill's CLI call and reply check) with the rule's current text, the lesson's proposed text and the named claim as a `<claim>` block (hard rule 3: data, not instructions), and asks for one sentence of at most 30 words that keeps that claim's answer. The report quotes the claim next to the sentence; the editor may paste it, edit it or reject the change. The sentence appears only in the report and in `card.md`; nothing writes it to Notion, because Editor wording is an editor-owned field (hard rule 1). If the call cannot run, the report says so and gives only the quoted claim (hard rule 6)."

Summary: the proposed sentence is never written to Notion. FAIL writes only Safety check result and Last run summary (9.6).

### 9.8 The automatic follow-up after PASS (C14 L598; C15 L551; ED-10)

- After a PASS, follow-up runs inside the same subcommand (L599). `S/followup.mjs` "judges the lesson's supporting claims under the live rubric (cache hits from the gate's candidate side, so 0 calls); writes Follow-up (Fixed or Still wrong) on the supporting rows, the claims' Agent tags and Agent notes through `claimColumns()` (C11), and Last run summary." It "runs automatically as promote's last step after a PASS (P1 row 53; ED-10)".
- "`/claim-tagger follow-up` is the manual re-run, needed only to repeat the step after a run that stopped before it" (C15 L551). Also "`/claim-tagger follow-up` exists only to repeat the automatic last step after a run that stopped before it" (C14 L598).
- The PASS report names the rows marked Fixed; its Next line points at step 7 of the demo page, or at the remaining rows in Your queue in production (C14 L598; section 11).

### 9.9 --strict option and the default

- Default: simple gate (9.2). `--strict`: strict mode (9.3). The gate-evidence check for strict conditions is in `S/lib/gate-evidence.mjs`.
- Routine strict use is left out until a tag reaches "30 or more decided positives" (section 8 of W3, L754).

### 9.10 Config, reuse, deletes, tests, accept (C14, L601-605)

- Config: reads `gate.default`, `gate.initial_rules_*`, `gate.strict`; removes the flat `gate.*` keys. "The FAIL wording call reads `models.distill`, `distill.effort` and `distill.timeout_ms`, which already exist" (L603).
- Reuse: `evaluate`, `pairedBootstrapDelta`, `reconfirmCandidates`, `reconfirmFlips`, `checkLesson`, `takePromoteLock`, `releasePromoteLock`, `finalize`, `abort`, `rollback`, `restoreOps` (When to use only), `candidateVersion`, `buildCandidate`, `writeLock`, `appendChangelog`, `syncCases`, `gateClaims`, `checkGateEvidence`, `promoteEvidence`, `restoreEvidence`, `sample` and `seedFromString` (`S/lib/rng.mjs`) for S5.
- Deleted: `DEMO_TITLE`, `localDemoFlag`, `--mark-rolled-back`, `--smoke` ("it never passed `--smoke` to the judge"), `perTagSummaryWithHash`, `PROMOTE.lock`.
- Tests (L604): `T/eval.test.mjs` (today's tests move under strict; corpus, deterministic and rule-less tags are excluded); `T/simple-gate.test.mjs` (new, P3: canaries pass, no decided claim newly fails, supporting rows fixed, a cached baseline costs 0 calls, the flip re-judge, S5 on initial rules, the excluded tags); `T/promote.test.mjs` (Initial rules; one lock file; no smoke; follow-up after PASS; a FAIL report holds one proposed sentence that quotes the named claim and writes nothing to Editor wording; a failed call is reported; the PASS report's Next line points at step 7 in a demo); `T/gate-evidence.test.mjs`; `T/fixtures/loop/fake-claude.mjs` gains the one-sentence wording reply.
- Accept (L605): quoted in 9.2 and "on the real workspace, the first Initial rules lesson ends in PASS or FAIL with an S5 list in Safety check result."

## 10. Rollback and follow-up

### 10.1 Rollback

- Sequence (L424): "`rollback <lesson>` | `promote --rollback --confirm` (asks the person); A; commit".
- Command: `promote.mjs --rollback <lesson> --confirm`, ask-gated in `.claude/settings.json` (H2; section 12).
- Writes: "`restoreOps` (When to use only)" (C14 reuse) to the copy, and the lesson's Status "Rolled back" (C5 lets the agent set Live and Rolled back). Rule 10: the copy accepts When to use "after a gate PASS or a confirmed restore".
- The rollback writes no Editor wording (rule 1). W3 does not say whether rollback also writes Last run summary or Rulebook edition.
- The "--mark-rolled-back" flag is deleted (C14). Rollback of the rulebook copy as a whole is a separate command: `status.mjs --restore-rulebook --confirm` (section 5.5).
- Not stated in W3: which text a rollback restores to (the lesson's Current text is the obvious candidate, but W3 does not say so). `buildRestorePlan` and `restoreEvidence` are named without their rules.

### 10.2 Follow-up on its own

- Sequence (L425): "`follow-up <lesson>` | `pull`; `followup`; A (only to repeat promote's automatic last step after a run that stopped before it, ED-10)".
- `followup` judges the lesson's supporting claims under the live rubric with 0 calls (cache hits), writes Follow-up on the supporting rows, writes the two mirror columns through `claimColumns()`, and writes Last run summary (C15).
- Test (C15 L556): `T/followup.test.mjs` (0 calls after a gate; Fixed and Still wrong; the mirror columns).
- Accept (L557): "on the fakes, follow-up after a PASS makes 0 calls and marks the rows; live acceptance after the first PASS in stage 2."
- The argument form of `followup` for a lesson is not stated.
## 11. Status and the three-part report rules

### 11.1 What status shows (C15, L552, verbatim where quoted)

"`S/status.mjs`: queue counts (open, decided, needs a note); lessons by status; the sources-cache summary (from C10); the PROMOTING phase; usage of the last runs (calls, tokens by kind, wall time and the share of a usage window once known, D22; the script prints these figures for the engineer, and the skill's three-part report leaves out durations and call counts, W4 section 11); `--adopt-unjudged` (D23) ...; `preflight` warns while `runs/SETUP` exists (H4)."

Status sequence (L419): `pull --all`; `status`. Every subcommand starts with `status.mjs --check` (L414). W3 does not give the layout of the status output.

Report facts set by status and the tag report (C14, L598): when more rows wait in Your queue than fit one sitting, "the status and tag reports give the count and their Next line says 'start at the top of Your queue' instead of 'decide the N rows'". The sitting size is `queue.sitting_rows`, default 20 (ED-13). See section 14: the key is not in the config.

### 11.2 Every report template or example given in W3

1. The three-part shape (C18 step 3, L660): "the final message has the three parts (one sentence, a table of at most 5 rows, one 'Next:' line), about 12 lines or fewer, no Insight block, no JSON, no write to an editor-owned field, only allowed tools."
2. Demo prefix (C22, L625): "every report starts with 'Demo · '; links go to the demo page's views." Also "no commit after a demo promote" (L625).
3. Promote's short summary line (C14, L599): "a short line such as 'Promote · 15 Oct 11:20 · PASS', with no duration or call count". The same line is written to Last run summary.
4. Safety check result examples (C14, L596): "PASS: examples 11/11, earlier 5/5, yours 2/2" and "FAIL: '<claim, 60 characters>' now Does not apply".
5. FAIL report (C14, L597): "besides the figures and the quoted claim, it proposes one sentence for Editor wording, written from the claim the check named." The sentence is at most 30 words (the wording call's limit) and keeps the claim's answer. The report quotes the claim next to the sentence.
6. Next lines (C14, L598), verbatim in full: "after a PASS, follow-up has already run inside the same subcommand, so the report names the rows it marked Fixed, and its Next line points at step 7 of the demo page (in production, at the remaining rows in Your queue); when more rows wait in Your queue than fit one sitting (`queue.sitting_rows`, default 20; ED-13), the status and tag reports give the count and their Next line says 'start at the top of Your queue' instead of 'decide the N rows'; after a FAIL, the Next line points at Lessons waiting and the proposed sentence; after a run that stopped early it is the same command again."
7. Agent notes examples (C11, L528-536), each the whole cell:

```
Context-dependent, Wordy
1 waits for an editor · not checked: 3 source tags, 2 duplicate tags · edition 2026-10-15.2
```

```
no tags
nothing waits for an editor · edition 2026-10-15.2
```

8. Checklist line on the real page when the view step fails (C7, L470): "P1's four-line checklist for the editor (R11), whose Lessons waiting line names its four columns (Lesson, Current text, Proposed text, Status) and says to switch wrapping on (answer 5)."
9. Wrap line when only the wrapping check fails (C20 Accept, L460): "one line is added to the page (turn on Wrap cells in Lessons waiting)".
10. Draft-rules report (C13, L580): "its report shows the tag's example claims". The lesson page body also shows them next to the drafted rules.
11. The skill's output-style paragraph and "Reporting style" section (C17, L411): "both verbatim from P2 2.1 (R16; the text is in W4 section 11)". The text is not in W3.
12. The walkthrough's three-part report (C21, L613): "prints the three-part report" after `start`. Its text is in W4.

No full report template is written out in W3. Items 11 and 12 point to W4 section 11.

### 11.3 What may not appear (rules in W3)

- No Insight block in the skill's final message (C18 step 3, L660; C22 L626): if Insight blocks appear with the override, `S/loop.mjs` is built.
- No JSON in the final message (C18 step 3).
- No durations and no call counts in the skill's three-part report (C15, L552; C14 L599 for the Last run summary line).
- The final message may write no editor-owned field, and may use only allowed tools (C18 step 3).
- No readiness word begins Agent notes; per-tag confidence, rule and reason are not in Agent notes (C11, L525).
- Agent notes: at most two short lines, and at most `notion.max_text` characters (C11, L526).
- "'rubric' stays only in repository files (ED-8)" (L9). Editor-facing names are "Safety check result" and "Rulebook edition".
- Canaries are called "examples" on the cards (P3 #8, L596; L473: "cards call them 'examples'").
- The proposed Editor wording sentence is never written to Notion (C14 L597; rule 1).
- Editor verified is never written (rule 5).
- No claim gets Source inaccessible from an unresolved link (C10 L652; rule 5).
- No Notion text may break the lint that `walkthrough verify` runs: headings, "at most 4 columns per table, cells of at most 100 characters, banned phrases, no shorthand codes or time estimates, the four help pieces" (C20 test, L459). The banned-phrase list is not in W3 (W4 section 9).
- The queue keeps its 12 columns: no "Sources checked" or "Evidence" column (R12, L647; section 8 of W3, L765).
- The verify step writes no `runs/PAUSED` and does not exit 5 (R7, C12).

## 12. settings.json: allow, ask, deny and the hook (C0 H1-H3, C5, C21)

### 12.1 The final settings file, verbatim (C5, L310-368)

Placeholder: "`<N>` = the Notion connector prefix that `/permissions` shows, today `mcp__16f81eb6-6eb4-423e-9e64-a5cb678b0953__`" (L310). H1 says "Use the prefix that `/permissions` shows on the machine that runs the skill. The guard hook's matcher has no prefix, so it stays the layer that holds on every machine." (L185)

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

"The hook denies any Notion write tool the deny list does not name (attachments, folders, skills and the like)." (L370)

### 12.2 The rules by list

- Allow (reads and scripts): the three `Read` rules; four Notion read tools (`notion-fetch`, `notion-search`, `notion-query-data-sources`, `notion-get-async-task`); `node --test`, `npm test`; git status, diff, log, `git add agents/claim-tagger`, `git commit`; one line per script for pull, sources, judge, propose, apply, verify, distill, cases-sync, eval, followup, probe, transcript-check and walkthrough (each with `:*`); `status.mjs` exact, `status.mjs --check`, `status.mjs --run:*`; `promote.mjs --lesson:*`, `--finalize:*`, `--abort:*`.
- Ask (a person's call, H2): `setup.mjs:*`; `status.mjs --unpause:*`; `status.mjs --restore-rulebook:*`; `status.mjs --adopt-unjudged:*`; `promote.mjs --rollback:*`.
- Deny: reads of `.env` files and of `anonymise.local.json`; any Write or Edit under `agents/claim-tagger/runs*/**` and `agents/claim-tagger/demos/**`; the Notion writes `notion-create-pages`, `notion-update-page`, `notion-move-pages`, `notion-duplicate-page`, `notion-delete-pages`, `notion-restore-pages`, `notion-create-database`, `notion-update-data-source`, `notion-delete-databases`, `notion-create-view`, `notion-update-view`, `notion-create-comment`, `notion-update-comment`, `notion-delete-comment`; and `curl`, `git push`, and `cat`, `grep`, `type` on `.env`.
- Not in the allow list and not in the deny list: `notion-create-attachment`, `notion-create-folder`, `notion-update-folder`, skill tools, `notion-create-file-upload` and similar. The hook denies them (L370).

### 12.3 The changes this file makes to today's settings (H1-H3, C0, L185-188)

- H1: the entries named `mcp__claude_ai_notion__notion-*`, "but this workspace's connector is `mcp__16f81eb6-6eb4-423e-9e64-a5cb678b0953__notion-*`, so none of those entries match." The prefix is the `<N>` placeholder above.
- H2: "Replace both wildcards with the explicit forms of C5's final settings and put `--unpause`, `--restore-rulebook` and `--rollback` under `ask` (C7 and C15 add `setup.mjs` and `--adopt-unjudged` there)." The wildcards were `status.mjs:*` and `promote.mjs:*`.
- H3: "No rule covers notion-delete-pages or notion-delete-databases. Deny them, and widen the hook matcher from the eight write tools to every Notion connector tool (`mcp__.*notion-.*`); `decide` in `S/hooks/guard.mjs` denies the delete, restore, move and duplicate tools now. C5 turns the guard into 'deny every write'."
- Accept for C0 (L200): "`/permissions` lists the Notion reads as allowed and the delete tools as denied; a headless `-p` run asked to unpause stops at the permission check."

### 12.4 The hook (C5, L302; H3)

- Matcher `mcp__.*notion-.*` (L362), command `node "$CLAUDE_PROJECT_DIR/agents/claim-tagger/scripts/hooks/guard.mjs"`.
- `decide` "allows only read tools (names `notion-fetch`, `notion-search`, `notion-query-*`, `notion-get-*`, `notion-list-*`) and denies every other tool with a message naming the script to use instead; it reads no config and no state, and fails closed. Keep `decide` and `hookOutput`; delete `armedBatches`, `decideCreate`, `decideUpdate`, `decideSetupPage`, `protectedMention` and `editorWrite` (all writes are denied, so they decide nothing)."
- Tests: `T/guard.test.mjs` ("every write tool denied under any server prefix; reads allowed; no state read").

### 12.5 Notes on the lists (not stated in W3; flagged for section 14)

- The allow entry `Bash(node agents/claim-tagger/scripts/walkthrough.mjs:*)` covers `walkthrough.mjs run <script> [args]`, which can run any script in `SCRIPTS`, with the ask-gated arguments of section 12.2 included. Section 14 gives the detail.
- `setup.mjs:*` is ask-gated but `walkthrough.mjs start` (which creates the demo page under a parent) is not.
## 13. Stages, milestones, tests, fakes and the end-to-end check

### 13.1 Stage rules (L13-20, L269, L561, L635)

- "Build in the order of section 4. It is grouped by stage (0 to 3, then Later); section 7 repeats the stages with their milestones. A stage is a place in the sequence, not a length of time (F7)." (L15)
- "A change is done when `npm test` is green and its acceptance check passed. A check that cannot run is reported, never skipped (hard rule 6). One commit per change, once the go-ahead covers commits." (L18)
- Stage 1 intro (L269): "For the editor, nothing in this stage needs a decision: the first real rows wait in Your queue until the walkthrough (stage 2) is done, and nothing is lost while they wait (ED-11; the queue keeps undecided rows for as long as they are left, answer 3)."
- Stage 2 intro (L561): "For the editor, this stage is the walkthrough and nothing else (ED-6, ED-11): no drafted rules to approve and no real rows to decide until it is done. The draft-rules code is built and tested here on the fakes; it is used on real tags from stage 3 on."
- Stage 3 intro (L635): "The editor now decides the first real rows (the walkthrough is done) and then chooses one tag to draft rules for; the remaining tags follow one per run, in the editor's order, under Later (ED-6, ED-11)."

Change order by stage (section 4 headings and section 7):

| Stage | Changes in order |
|---|---|
| 0 | C0, C3, C1 (with C16), C2, C19 (C16 "moved to stage 0, with C1") |
| 1 | C4, C5, C6, C12, C17, C20, C7, C8, C9, C11, C15 |
| 2 | C13, C14, C21, C22 |
| 3 | C10, C18 |
| Later | no new code (C13 is reused) |

### 13.2 Milestone table (section 7, L742-748, verbatim)

| Stage | Changes, in order | Milestone (acceptance) | People and preconditions |
|---|---|---|---|
| 0 | C0, C3, C1 with C16, C2, C19 | No SETUP marker; settings and guard closed; the trial archived; the probe shows the old hub, sandbox, taxonomy, Claims to review and World affairs unreachable and the mirror reachable; the read-only dry-run report on the mirror (rows, requests, column types, Geo Sources parsing, 20 resolved source links, multi-source or not, `filter_properties`, exact-text duplicates) with a request log free of writes | A person deletes the markers (H4), disconnects the integration and rotates the token (C1). Mika asks the owner of the Geo-to-Notion refresh job whether added columns and page ids survive a refresh (D21) and asks the Geo team for the canonical GraphQL endpoint (R9; not blocking for stage 1) |
| 1 | C4, C5, C6, C12, C17, C20, C7, C8, C9, C11, C15 | The API check recorded; the "Claim tagger" page with four databases and four views (or the checklist); the copy's 13 rows read back equal to the taxonomy's; the two mirror columns added with `--confirm` and read back; rulebook edition 1 (13 tags, 4 judged); `/claim-tagger tag --tags Context-dependent --limit 50`: 50 mirror pages carry Agent tags and Agent notes in the two-line form, every unsure cell has a queue row, the read-back is clean and the report follows the template; then the D19 calibration on the first 200 claims, with its numbers to Mika. The queue rows wait: the editor decides none of them in this stage | The D21 answer before `mirror-columns`; Mika reads CLAUDE.md's new rules (C17) before the first mirror write; the engineer names the parent of the new page; the editor does not decide real rows yet (they wait in Your queue and nothing is lost, ED-11) |
| 2 | C13, C14, C21, C22 | The walkthrough: dry run, a real start, three calibration runs, the manifest frozen; the skill-creator loop done; the draft-rules code passes its tests on the fakes (nothing is drafted for the editor yet); the usage-window calibration and a deliberate stop and resume (C18 step 4), then the full Context-dependent pass of the mirror in the background (its rows wait too). For the editor, this stage is the walkthrough and nothing else (ED-6) | The editor works through the practice page once; Mika names a parent page for every demo and the eval parent (D24) |
| 3 | C10, C18 | The editor has decided the first real rows (after the walkthrough). The first tag the editor chose has its rules drafted (one Initial rules row, shown with its example claims), approved or rewritten, and its promote ended in PASS or FAIL with its S5 list; G2 judged on the mirror for that tag once its first rules passed; `sources`, then the source pass over the mirror (several usage windows, resuming); C18 end to end, including the headless report check | The editor chooses the first tag to draft; the Geo team's endpoint answer before the full source pass (otherwise it runs on the testnet name, R9) |
| Later | no new code (C13 is reused) | The other tags' first rules, one tag per run in the editor's order, each shown with its example claims and each ending in its own PASS or FAIL; G2 judged for each tag once its rules passed; the items of section 8 when their triggers occur | The editor's order, and the editor's approval for each tag |

### 13.3 Test table (section 6, L703-736, verbatim)

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

### 13.4 Fixtures (section 6, L738, verbatim)

"Fixtures: `T/fixtures/config.json` (new, C2); `T/fixtures/notion/db.mirror-usp.json` (new, C19), `db.rulebook-copy.json` (new, C4), `db.mirror-wa.json` (new, C6); `db.tag_decisions.json`, `db.rule_changes.json`, `db.agent_settings.json` (rewritten, C6); `db.runs.json`, `db.claims.json`, `db.rulebook.json` (deleted, C6); `fake-notion.mjs` (request log and multi-source 400, C19; databases from config, C6; views, C20); `T/fixtures/fake-claude.mjs` (429 or overloaded and usage-limit modes, per-call usage, source-pass mode; H8, C9, C10); `T/fixtures/loop/fake-claude.mjs` (draft-rules reply, C13); `T/fixtures/judge/` (cell-store layout, C9)."

Fixtures named elsewhere in W3: `T/fixtures/notion/db.rulebook-copy.json` built from `claim-tags-verified.9oct.rows.json` plus the 13 October delta (L284); the "fake fetch" for sources (C10 tests: "a fake fetch returning 200, 403, 404, a timeout, a paywall page and a PDF"); the mock fetch for the walkthrough (C21 tests: "with the mock fetch"); the Geo probe's fake (C19 tests: "`T/probe.test.mjs` (the dry run against `T/fixtures/notion/fake-notion.mjs`; the request log holds only GET and query requests; a multi-source 400 is reported, not thrown)"); the `T/fixtures/loop/fake-claude.mjs` one-sentence wording reply (C14 L604).

Fake behaviour named in W3: a fake 429 followed by success finishes a batch; three in a row exit 75 with the resume command (C0 accept); "the fake model drafts rules that become a Proposed row" (C13 tests); "a lost create resumes without a duplicate" and "a protected parent exits 4" (C21 tests); "a lost POST /databases is not sent again" (C3 tests); "no second POST /views after a lost answer" (C20 tests); "a crash after the third create resumes without sending it again" (C20 tests).
### 13.5 Acceptance line of each change (verbatim; the change's own Tests line is in 13.3)

| Change | Stage | Accept (verbatim) |
|---|---|---|
| C0 (housekeeping) | 0 | "`/permissions` lists the Notion reads as allowed and the delete tools as denied; a headless `-p` run asked to unpause stops at the permission check; no SETUP marker on disk; `git grep -n anonymise -- "agents/*/config.json"` is empty; a fake 429 followed by success finishes the batch, and three in a row exit 75 with the resume command; the MVP report builds with `--strict`." (L200) |
| C3 (library extensions) | 0 | "`npm test`; today's callers behave as before." (L214) |
| C1 (archive the trial) | 0 | "`npm test` green after C1 with C16; the tag exists; `git status` shows no runs content; after C2, the probe reports every trial, sandbox, taxonomy, Claims to review and World affairs id as 404 or 403." (L226) |
| C16 (delete the trial-only code) | 0 | "`npm test` green; `git grep` finds no import of a deleted module." (L237) |
| C2 (config, paths, probe classes) | 0 | "`node S/probe.mjs` reports every protected id (old hub, sandbox, taxonomy, Claims to review, World affairs) as 404 or 403 and the U.S. Politics mirror as 200 with its key column, and exits 0." (L253) |
| C19 (read-only dry run) | 0 | "the report exists and the request log shows no write; Mika and the engineer read it before stage 1. If the mirror is multi-source, C6 adds `queryDataSource` before the first pull. Optional, after C9: judge 16 claims (2 calls) on Context-dependent to measure tokens per call and output per claim on the real prompt (P3)." (L265) |
| C4 (rubric from the copy) | 1 | "building from the fixture gives 13 tags: Context-dependent, Improperly sourced, Source inaccessible and Factually challenged judged; Unsourced deterministic; the six text tags and the two duplicate tags not judged; hashes check; the schema validates." (L285) |
| C5 (allowlist, contract, guard, settings) | 1 | "`npm test`; `/permissions` shows the lists below." (L308) |
| C6 (pull) | 1 | "`pull --all` against the fakes writes the norm files; the mirror is read with filtered properties only." (L388) |
| C12 (plan, apply, verify) | 1 | "a plan with one mirror update applies, reads back and verifies; a plan naming a third mirror column is refused at build, at apply and by the client." (L402) |
| C17 (documentation and hard rules) | 1 | "Mika reads rules 1, 4, 5 and 10 (D23 approved their content; the rule 5 wording note is open); CLAUDE.md, AGENT.md and SKILL.md name the same subcommands (a grep)." (L434) |
| C20 (Notion builder, API 2026-03-11, blocks) | 1 | "`api-check` passes against a scratch parent, or its failure selects the fallback and names the step that failed. The check also tries wrapping on in a view (W4 section 4.2); if only that fails, the views are still built and one line is added to the page (turn on Wrap cells in Lessons waiting)." (L460) |
| C7 (Notion setup) | 1 | "the page exists under the chosen parent with four databases and the four views (or the checklist); the copy's 13 rows match the taxonomy's Issue rows field by field (read back); Agent settings has one row; `probe` exits 0 and sees both write columns on the mirror; `rubric.json` has 13 tags, 4 judged; `status` shows rulebook edition 1 in force." (L482) |
| C8 (per-group judgment store) | 1 | "on the fakes, a G1 rule change leaves the G2 and S stores as cache hits; a CLI version bump hits every store." (L496) |
| C9 (judge) | 1 | "on the fakes, 100 claims of which 20 are unsure take about 17 calls against 13 for one pass (about 1.3x); on the real mirror, the stage-1 milestone." (L517) |
| C11 (propose) | 1 | "on the fakes, every unsure cell gets a row and no confident one does; decided rows are untouched; mirror updates name only Agent tags and Agent notes; no Agent notes cell has more than two lines." (L544) |
| C15 (follow-up and status) | 1 | "on the fakes, follow-up after a PASS makes 0 calls and marks the rows; live acceptance after the first PASS in stage 2." (L557) |
| C13 (distill and draft-rules) | 2 | "on the fakes, `draft-rules <tag>` creates one Proposed row with numbered rules and its report shows the tag's example claims; the engineer option `all` creates the six rows. On the real workspace (stage 3): the editor picks one tag, and `draft-rules <tag>` creates one Proposed row with numbered rules; the next tag follows in a later run, in the editor's order." (L580) |
| C14 (gate) | 2 | "on the fakes, a lesson that fixes its rows and breaks nothing PASSes with the baseline from cache, and a single chance flip that the re-judge reverses does not FAIL; on the real workspace, the first Initial rules lesson ends in PASS or FAIL with an S5 list in Safety check result." (L605) |
| C21 (walkthrough script, manifest, page template) | 2 | "`start --dry-run --parent <link>` gives a lint-clean `preview.md`; a real `start` under a parent Mika names gives a page that `verify` passes; the calibration of W4 section 6 then freezes the manifest." (L619) |
| C22 (walkthrough skill and demo mode) | 2 | "the evals pass with the skill; the description optimisation (20 trigger queries) is done; the walkthrough has run end to end once by hand (C18)." (L631) |
| C10 (source pre-fetch and source pass) | 3 | "`sources --limit 50`, then `tag --pass source --limit 50`, report the resolved, fetched and not-checked shares; no claim gets Source inaccessible from an unresolved link." (L652) |
| C18 (end to end) | 3 | "all five done, with the results written into WORKLOG and the report." (L664) |

### 13.6 End-to-end check (C18, L656-664, verbatim)

"Goal: prove the whole loop on the fakes, on a demo page and on the real mirror, and prove the reports."

1. "`npm test`, plus `T/loop.test.mjs` (new): a script-level loop on a temporary demo profile with the fake Notion and the fake Claude (tag, decide by fixture, distill, approve by fixture, promote with its automatic follow-up), asserting that the request log never touches a protected id or a third mirror column."
2. "Acceptance on a demo page (P3; W4): a fresh demo under a parent given at run time; the editor decides the two open rows as Rule unclear; distill proposes one Context-dependent lesson; the editor approves it; the default gate PASSes; follow-up marks both rows Fixed. Checks: every report follows the template; the request log shows no touch of the real mirror or the taxonomy; the demo page is left in place."
3. "Headless report check (P3, R16): run `status`, then the demo's `tag`, `distill` and `promote`, and a manual `follow-up`, each with `MSYS_NO_PATHCONV=1 claude -p "/claim-tagger status" --settings .claude/settings.json --permission-mode acceptEdits --output-format stream-json --verbose` (with the matching subcommand) and the Explanatory output style on. Check each transcript with `S/transcript-check.mjs` plus a new assertion: the final message has the three parts (one sentence, a table of at most 5 rows, one 'Next:' line), about 12 lines or fewer, no Insight block, no JSON, no write to an editor-owned field, only allowed tools. If Insight blocks appear, build `loop.mjs` (C22)."
4. "Before the first full pass (P3): one usage-window calibration run and a deliberate stop and resume (exit 75, then the same command continues); record the window share per call, so later estimates can read 'claims per usage window' (D22)."
5. "Live order: Context-dependent on `--limit 50` (stage 1; the rows wait for the walkthrough), the D19 calibration on 200 claims, the walkthrough (stage 2, the editor's only task there), the editor's first real rows, the full mirror; then, one tag per run in the editor's order, draft rules and their gates; G2 on the mirror once a tag's rules have passed, and the source pass (stage 3, then Later)."

Accept (L664): "all five done, with the results written into WORKLOG and the report."

Demo checks named elsewhere: the demo's two open rows and the Rule unclear decision (C18 step 2); the R13 grouping of the demo's two rows (C13); "`verify` catches a 5-column table and a banned phrase" (C21 tests); "`verify --json`" used by the walkthrough evals (C22; W4 section 10).

### 13.7 Documentation work that the milestones depend on (C17, C22, L169, L410-413, L625-627)

- CLAUDE.md: rules 1, 4, 5 and 10 as in section 1.8; the opening paragraph names the new "Claim tagger" page; the agents table entry. Agents table entry, verbatim (L169): "claim-tagger (editor feedback loop), folder `agents/claim-tagger/`, entry points `/claim-tagger` with setup, status, tag, draft-rules, distill, promote, rollback, follow-up and `demo <step>`, and `/claim-tagger-walkthrough` with start and where (C22). The sentence about `.claude/agents/` says it now holds only the editor persona used for reviews (C16 deletes the two fallback subagents)."
- `A/AGENT.md` (C17, L410): "one runbook (P3 #30: today it exists three times): the steps table; the contracts (cell store `runs/judgments/<key16>/`, sources cache `runs/sources/`, per-run `calls.jsonl`, cards); 'Models and runs' (adaptive runs, D19); 'Safety checks' (P1 2.7 as amended: allowlist with the mirror rule, read-back, drift for tags with rules, pause, protected ids and the probe, a guard that denies every connector write, the slim gate evidence, one `PROMOTING.json`, trust breaker as a warning); a section on demo profiles (P2)."
- `.claude/skills/claim-tagger/SKILL.md` (C17, L411): "the output-style paragraph under the title and the 'Reporting style' section, both verbatim from P2 2.1 (R16; the text is in W4 section 11); two examples inline and all of them in `references/report-examples.md` (new; the content of `../debate/inputs/report-examples.md`); the subcommand sequences below; 'Sandbox mode' and 'Evidence' deleted ('Demo mode' comes in C22); a new rule: a subcommand that finds its own unfinished run resumes it instead of starting another (P2)."
- `README.md` (C17, L412): install steps name the new page and the token's connections; the routine loop lists the new subcommands; the runbook lives in AGENT.md only.
- `A/schemas/notion/as-built.md` (C17, L413): a section for the "Claim tagger" page, generated from the setup plan's request log (C7).
- Walkthrough skill (C22, L625): `.claude/skills/claim-tagger-walkthrough/` with `SKILL.md`, `references/manifest.md`, `references/page-design.md`, `references/troubleshooting.md`, `evals/evals.json`, built with skill-creator (W4 section 12). The `claim-tagger` SKILL.md gets a "Demo mode" section: "every `node S/<x>.mjs ...` becomes `node S/walkthrough.mjs run <x> ...`; no commit after a demo promote; every report starts with 'Demo · '; links go to the demo page's views."
- Insight suppression (R16, L626): the output-style paragraph is in both SKILL.md files; C18 checks it headless with the Explanatory output style on. `S/loop.mjs` is built "only if that check fails".
### 13.8 P3 debt list: where each item is fixed (section 5, L668-699, verbatim)

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

### 13.9 Deliberately left out, with triggers (section 8, L750-767, verbatim)

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
## 14. Contradictions and ambiguities inside W3 (listed, not resolved)

1. **Reconciliation range.** L5 says "the reconciliation R1-R16 (`RECONCILIATION.md`)"; L7 says "**Rn** is a ruling in `RECONCILIATION.md` (R1 to R23)". W3 itself cites only R1 to R16.
2. **Edition format.** "status shows rulebook edition 1 in force" (L482) and "version 1 of `rubric.json`" (L173) use a number; the Agent notes examples use "edition 2026-10-15.2" (L530, L535). The format of an edition is not settled.
3. **Rule 5 against D23.** L173 says D23 reads "only rulebook tags whose rules went live through the gate are judged", and that the literal reading would stop Context-dependent. Rule 5 (L165) counts the setup-time rules as in force instead. W3 asks Mika to confirm the wording; still open.
4. **Corpus tags and queueing.** L135 says corpus tags are "never judged by the model and never queued", and in the same sentence that Exact duplicate "is queued only on a match". L539 says "Corpus tags and tags without rules never get a row", right after "for every Exact duplicate match ... create a row".
5. **Sitting size.** C14 (L598) uses `queue.sitting_rows` (default 20, ED-13). The config block (L113) has no such key; its `queue` holds only `reason_max_words`.
6. **Rule changes count.** "Rule changes, 11 columns" and "Lesson ID only in production" (L444, L453) give 11 in production and 10 in a demo by arithmetic. W3 does not state the demo count.
7. **"Folded Runs database".** L148 says the old `.runs` database is replaced by "the folded Runs database (R8)". No table in W3 is a Runs database, and C13 (L577) and C14 (L599) delete the Runs row. What was folded, and where, is not stated.
8. **Who commits after a promote.** L599 says "After a PASS, finalize, commit and follow-up (C15) run in the same subcommand." The sequences (L423-424) list "`promote --finalize`; commit; `followup`; A" and "A; commit" as separate steps. L625 says "no commit after a demo promote". W3 does not say whether the subcommand or the skill commits in production.
9. **Unpause and the Notion Paused box.** `status.mjs --unpause --confirm` (L186, L342, L553) is ask-gated. L175 says Paused in Agent settings still stops every command, and Paused is editor-owned: no script writes it (L161, L299). W3 does not say whether unpause clears the Notion checkbox, or only `runs/PAUSED`, or both.
10. **Walkthrough allow entry.** `Bash(node agents/claim-tagger/scripts/walkthrough.mjs:*)` (L332) is allowed without an ask. `walkthrough.mjs run <script> [args]` (L611-612) runs demo scripts, including `promote` (L599, L612), so arguments that the ask list guards on direct calls (`promote.mjs --rollback`, `status.mjs --unpause`; L342-345) could pass through it. `walkthrough.mjs start` creates pages under a named parent (L613) with no ask, while `setup.mjs:*` is ask-gated (L341). W3 does not say whether `run` refuses ask-gated scripts.
11. **Retry count.** L192 gives "retried after 30 s, then 120 s" and a stop at "three transient failures in a row". W3 never says "two attempts per batch"; the number of attempts per batch is only implied (the `attempts` field, L509).
12. **Exit codes.** Exit 4 is used for drift (L552), for a refused `--adopt-unjudged` edit (L552) and for "a protected parent exits 4" (L618). The repo CLAUDE.md gives 4 as "drift or model mismatch", and lists 3 (paused), 10 (HOLD) and 11 (FAIL). W3 maps none of 1, 3, 10 or 11 to a command, so promote's HOLD and FAIL have no exit code in W3.
13. **Source status mapping.** (a) Rule 5 (L165) makes a source "our tools could not resolve or fetch" = not checked, but D12 (L644) records `blocked` (401, 403, 429, 451 or a challenge page) as inaccessible, and the C10 pre-decision (L646) says "every source hard-failed: Source inaccessible applies". "Hard-failed" is not defined. (b) `timeout`, `network` and `thin` are not mapped to readable, inaccessible or not checked. (c) 429 is transient for the model (H8, L192) and "blocked" for a source fetch (L644).
14. **PASS rule.** The gate lists S1 to S5 (L587-592) and says "Verdict: PASS or FAIL; HOLD only when there is nothing to evaluate" (L594). The rule that combines S1 to S5 into PASS or FAIL is not written. The only outcome stated is the acceptance line (L605).
15. **Judge flags.** `--limit` (L420, L507) and `--items eval` (L510) are used but missing from C9's flag list (L504). The `tag [--tags X] [--limit N]` sequence (L420) runs `judge --pass all` and does not show how `--tags` and `--limit` reach it.
16. **Config keys with no description.** `judge.concurrency`, `judge.effort`, `judge.max_turns`, `judge.timeout_ms`, `judge.claude_bin`, `judge.max_error_share`, `notion.requests_per_second`, `notion.page_size`, `sources.user_agent`, and `models.cheap` (referenced nowhere). Of the `gate.strict` keys, only `reconfirm_runs`, `reconfirm_max` and `large_sample_positives` are explained; strict conditions 1 to 5 are not restated (they live in `S/eval.mjs:681-755`).
17. **"Editor verified".** Rule 5 (L165) says "Editor verified is never written". No table names that column. The copy has Status (Verified, Proposed) and Verified on (L451). Which field is meant is not stated.
18. **Adoption inside draft-rules.** C13 (L574) says the copy row "is adopted (the `--adopt-unjudged` code, C15)". `status --adopt-unjudged` is ask-gated (L344). W3 does not say whether the in-code adoption needs the same approval.
19. **Repo CLAUDE.md conventions.** The repo CLAUDE.md (outside W3) says "Runs are resumable (ledger keyed by item and rubric version)". C8 (L489) keys the cell store by group and tag hashes with no rubric version, and C17 (L409-411) lists the CLAUDE.md edits without the conventions line.
20. **Geo endpoint.** `api-testnet.geobrowser.io` is in the config (L109). R9 (L138) says the host name says testnet but serves the production space, and asks the Geo team to confirm. Stage 0 says the answer is "not blocking for stage 1" (L744); stage 3 needs it "before the full source pass" (L747).
21. **Sequencing.** C15 (stage 1, L553-557) relies on "cache hits from the gate's candidate side", which exist only once C14 (stage 2) is built. C4 (stage 1, L279) also depends on C14 for rule changes. These are forward references.
22. **Arithmetic not shown.** "about 17 calls against 13" (C9 Accept, L517) and "about +4 calls for 3 flips" (C14, L593) are not derived. At `batch_size` 8 (L90), 20 run-2 claims are 3 calls (13 + 3 = 16 before run 3). The 12 flip judgments (3 flips x 2 runs x 2 sides) are 2 calls at 8 per call, unless each re-judge is its own call.
23. **Propose: plan or direct write.** Rule 1 (L161) says Notion is written only by applying a plan. C11 describes Notion updates and queue rows from propose, and the sequence table (L420) runs `propose` then `A`. W3 never says that propose writes a plan file.
24. **Overfit check.** "the 8-word overfit check (P1)" (L576) is named as reused. What it does with a match is not defined in W3.
25. **Open decisions the source leaves to Mika (not resolved here).** The rule 5 wording (L173); the D21 answer before `mirror-columns` (L472, L745); the canonical Geo endpoint (L138, L747); whether to rewrite git history that holds the real names before the first push (L189: "whether to rewrite that history before the first push to a remote is Mika's call"); whether the git remote is added (H9, optional).

