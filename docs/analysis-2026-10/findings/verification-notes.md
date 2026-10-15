# Verification notes (my own reads, 2026-10-14)

Checks I made by hand, independent of the three sweeps, because the design depends on them.

## The target rulebook (Issue view of "Claim Tags — verified")

Queried through SQL projection (the view query fails with "more than 1000 distinct mention targets" because of the relations to the claims tables). 13 rows with Work tags containing Issue:

| Tag | Status | Polarity | Category | Rules ("When to use") | How it can be decided |
|---|---|---|---|---|---|
| Context-dependent | Verified | Issue | Quality | 1086 chars | from the claim text |
| Improperly sourced | Verified | Issue | Quality | 943 chars | needs the source text |
| Source inaccessible | Verified | Issue | Quality | 722 chars | needs a fetch attempt |
| Unsourced | Verified | Issue | Quality | 498 chars | deterministic from the Sources count |
| Factually challenged | Proposed | Issue | Quality | 644 chars | needs the source text and the wider record |
| Wordy | Proposed | Issue | Quality | none | from the text, once a rule exists |
| Poor wording | Proposed | Issue | Quality | none | from the text, once a rule exists |
| Incorrect grammar | Proposed | Issue | Quality | none | from the text, once a rule exists |
| Improper capitalization | Proposed | Issue | Quality | none | from the text, once a rule exists |
| Trailing period | Proposed | Issue | Format | none | deterministic, once a rule exists |
| Multi-sentence | Proposed | Classification | Format | none | deterministic, once a rule exists |
| Exact duplicate | (none) | (none) | (none) | none | needs a corpus lookup |
| Semantically duplicated | (none) | (none) | (none) | none | needs a corpus search |

The view also carries a second, empty "Category is" filter (dangling; the research noted the same in section B9). Predictive and Hypothetical are not in the view.

Schema of the table (for the structurally identical copy): Name (title), Description (text), When to use (text), Example Claims (text), Counterpart (text), Evidence (url), Category (select: Nature, Form, Quality, Style, Tone, Format, Meaning, Usage, Check), Polarity (select: Classification, Positive, Issue), Status (select: Verified, Proposed), Geo Status (select: Existing in Geo, To be created, Implemented differently), Geo Tag ID (text), Work tags (multi_select: Pipeline benchmark check, Issue), Verified on (date), Created, Created by, Last edited, Last edited by, plus two relations to the claims mirrors (not needed on the copy).

## `agents/claim-tagger/scripts/lib/notion-rest.mjs`

Exposes only: queryDatabase, queryAll, retrieveDatabase, retrievePage, retrievePropertyItem, createPage (parent database_id only), updatePage, appendBlocks. No createDatabase, no page-parent createPage, no updateDatabase. Pinned API version 2022-06-28. Consequence for the walkthrough skill: to build its own page and databases through the token it needs two small additions (POST /v1/databases with a page parent and property definitions, including formula, rollup and relation; POST /v1/pages with a page parent and children blocks). Saved or linked views cannot be created on 2022-06-28; the trial's views were created through the connector under the guard's SETUP marker. To verify in execution: that 2022-06-28 create-database accepts `parent: {type: "page_id"}` (I believe yes) and that `table` plus `table_row` blocks go through appendBlocks (yes).

## `scripts/lib/paths.mjs`

`CLAIM_TAGGER_ROOT` overrides `agentRoot()`; `codeFile(root, ...)` lets a profile shadow schemas and prompts. A per-demo profile folder is already supported by the code; only its creation is manual (`sandbox.mjs init` is sandbox-specific: it cuts the trial rubric down to listed tags and builds seed rows from the trial seed).

## `scripts/allowlist.mjs`

Closed `DATABASES` list; per-database PROPERTY_TYPES, WRITABLE, SEED_ONLY, SEED_CREATE_ONLY, NEVER tables; a global `EDITOR_NAMES` set; `isProtectedDatabase(config, id)` over `notion.protected_database_ids`. Multi-mirror support means: a `mirror` database kind that several configured tables share (WRITABLE exactly the two text columns, NEVER everything else), and the configured mirrors removed from the protected list while the taxonomy and "Claims to review" stay on it.

## `.claude/settings.json`

The allow, ask and deny entries name Notion tools as `mcp__claude_ai_notion__notion-*`. This session's Notion tools are `mcp__16f81eb6-...__notion-*`, so those entries do not match here; the PreToolUse hook regex `mcp__.*notion-(...)` does match. Wildcards `status.mjs:*` and `promote.mjs:*` let the model run `--unpause --confirm` and `--rollback --confirm`. notion-delete-pages and notion-delete-databases are covered by no rule.

## `prompts/judge.md`

Generic: rulebook, pairs and scope injected through placeholders; the prompt itself already says source tags are decided elsewhere. The source pass needs a second prompt file with `<source>` excerpt blocks.

## Context-dependent seed decisions (`evals/seed/decisions.seed.jsonl`)

10 decided rows. Applies 3: "The Dallas convention is the unofficial launch of JD Vance's 2028 presidential campaign"; "Melania Trump should not host her initiative's G20 event at President Trump's golf resort" (editor: "What's the initiative?"); "Excluding CNN from Air Force One violates the federal court order". Does not apply 7: "December stopgap funding rewards Congress for avoiding a full budget"; "A contractor's enforcement of safety restrictions constitutes a national security supply chain risk" ("makes sense on its own"); "The focus on the COVID-19 vaccine ignored the larger public health problem in the U.S." ("could just be a generic"); "Relocating the Kennedy Center Honors to a sports arena diminishes the prestige of the awards"; "Georgia's gubernatorial debate should be moderated by professional journalists rather than a town hall audience" ("the claim reads well"); "Replacing mainstream pool networks with partisan outlets damages presidential coverage"; "Federal Medicaid whistleblower rules would weaken state control over program enforcement".

Demo story: a rule-following judge applies the tag to the Georgia debate (rule 2) and the larger public health problem (rule 3); the editor overrules both with Rule should change; the lesson narrows rules 2 and 3 (well-known named events and generic or abstract definites do not fire); the gate must keep the three Applies rows and the confirmed removals passing. Precondition: a judge dry run on the candidate open rows must apply the tag under the current rule with p at or above 0.75; otherwise swap rows. The manifest must be data-verified, not hoped.

## The sandbox session's skill reports

Every report ended with a next step and a link to the Walkthrough page, which is right. But each was three to six paragraphs plus a table plus a three-bullet Insight block (the Insight block comes from the Explanatory output style, not from the skill) plus incident narration. The fix is a fixed template in SKILL.md: what ran, a result table of at most five rows, the next step as one command or link, and a line that suppresses output-style insight blocks inside skill runs.

## The Walkthrough page against Mika's format

Current step layout: Before / Do / What happens / Expected result. Wanted: Goal / Existing status / Doing the work / Explaining the outputs, every affected table rendered with example values, no wrap-heavy tables, no "leave these undecided" noise, no column guides duplicating the Notion descriptions. Structural flaw: the demo depends on the agent adding extra low-confidence Hypothetical rows the editor must ignore, and step 5 pastes a pre-cooked Editor wording because the agent's draft failed the gate five times in the trial. A clean demo needs a judge scope of exactly one tag and a story the agent's own draft is likely to pass.

## Source-URL resolver (verified 2026-10-14)

The mirror column Geo Sources holds markdown links to Geo entity pages (https://www.geobrowser.io/space/<space>/<entity>). The entity pages are client-rendered, so a plain fetch shows no properties. The Geo GraphQL API does: POST https://api-testnet.geobrowser.io/graphql (no authentication for reads; the host name says testnet but it served the production space 89bd89bf28ff8a0963faf92a8c905e20) with

```graphql
{ entity(id: "20b040c95621470182625a71479d4729") { id name types { name } values(first: 40) { nodes { property { id name } text } } relations(first: 40) { nodes { type { name } toEntity { id name } } } } }
```

returned type Article, a value with property name Web URL = https://www.straitstimes.com/world/europe/us-targets-turkish-entities-with-iran-related-sanctions (property id 412ff593e9154012a43d4c27ec5c68b6), a Publish datetime value (null here) and a Publisher relation to The Straits Times. So the resolver in the source pre-fetch is one GraphQL query per source entity, cached by entity id; a missing Web URL or an unreachable API counts as not checked, never as Source inaccessible. The mainnet host name could not be confirmed from public docs (candidates api.geobrowser.io and api-mainnet.geobrowser.io do not resolve); the Geo team should confirm which endpoint is canonical. Probe script: the session scratchpad, probe/geo-entity2.mjs (to be moved into scripts/lib/geo-sources.mjs in W3).
