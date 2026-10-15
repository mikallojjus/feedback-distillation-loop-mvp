# P1: architecture plan (opus Plan agent, 2026-10-14)

Verbatim report. Read-only sweep; nothing was modified. The agent read the notes file, the docs, the config, the skill, `as-built.md`, every script, the libraries and tests, and the research exports of the taxonomy and the mirrors.

## 0. Findings that change the decided target

1. **The mirror has no article URLs.** On the real mirror, "Geo Sources" is a text column of `[title](https://www.geobrowser.io/space/<space>/<entity>)` links (World affairs export; trial `sources-fill.json`). These link to Geo source entities, not articles. The Unsourced rule says a Geo source has a "Web URL" property. So D5 needs one more step before any fetch: resolve each Geo entity to its Web URL, via the Geo API or the entity page. I could not verify either path. A failed resolution must count as "not checked". It must never count as Source inaccessible.
2. **Hard rule 5 also conflicts with D1, not only rule 10.** Rule 5 says "Only Verified tags are written", but D1 includes 7 Proposed tags and 2 with no status. Three places hard-code the same rule:
   - `rubric-build.mjs` keeps only Verified rows (`buildRubric`, line 176) and stamps `status: 'Verified'` on every tag (`rowToTag`, line 135).
   - `schemas/rubric.schema.json` requires `status: const "Verified"` and a non-null polarity.
   - The two duplicate tags have null Status, Category and Polarity.
3. **8 of the 13 have an empty "When to use", not 9.** They are Exact duplicate, Semantically duplicated and the six format/quality tags. Two other surprises:
   - Multi-sentence has polarity **Classification**, so the current `readiness.fix_polarities: ["Issue"]` would never mark it Fix needed. Treat "in the Issue view" as the issue signal, not polarity.
   - Several "Example Claims" are not claims, so they cannot be canaries. Incorrect grammar has "255 legacy linked claims; see ...", and Source inaccessible lists audit-row references.
4. **Following D5 literally for duplicates floods the queue.** If both duplicate tags go to the editor as "cannot tell", that is about 4,700 rows (2 x 2,351). I recommend not queuing corpus-capability tags; the notes column just says "not checked".
5. **The gate cannot catch over-tagging by new rules.** For a tag with only positive examples and no decided "Does not apply" claims, a rule that fires on everything would pass. I add a cheap base-rate check (S5 below).

## 1. Feature ranking

MVP = criticality 1 to 5. Token = spends tokens for perfection. Scale = blocks more tags or claims.

| # | Feature | What it adds | MVP | Verdict | Token | Scale | Reason |
|---|---|---|---|---|---|---|---|
| 1 | Judge runner (`judge.mjs`: batched `claude -p`, schema-checked reply, 1 retry, resume, exit 75) | The only source of tag decisions; resumable | 5 | keep | no | no | Core |
| 2 | 3 runs + majority per cell | Removes noise | 3 | simplify to adaptive (D10) | yes, 3x | yes, ~6 h to ~2.5 h per pass | Most cells are confident `do_not_apply` |
| 3 | Cache keyed by whole `rubric_hash` + `scope_hash` + CLI version (`computeConfig`) | Free re-runs when nothing changed | 4 | simplify to per-tag key; CLI version recorded, not keyed | yes | yes | Any lesson or CLI update re-judges every tag on every claim |
| 4 | 8 claims x all model tags per call | One shared system prompt per batch | 4 | keep for the text pass; group items by which tags are missing | no | no | — |
| 5 | Counterpart-pair consistency check | Forced choice between paired tags | 2 | keep (idle: no pairs among the 13) | no | no | Costs nothing |
| 6 | Code-decided tags (`codeDecidedTag`) | Tags decided without tokens | 4 | keep, extend to fetch results | saves | no | — |
| 7 | Smoke mode (Haiku, 1 run) | Model check | 2 | keep `judge --smoke` and `npm run check:model`; remove from promote/eval | no | no | Two known bugs; rehearsal only |
| 8 | Usage-window exit 75 + resume | Survives subscription limits | 5 | keep; fix the regex | no | yes | 429 and "overloaded" now end the whole run |
| 9 | Queue rows (claim x tag) | The editor's work surface | 5 | keep, trim 30 to 12 columns | no | yes if unbounded | — |
| 10 | Readiness select on Claims | Per-claim status | 2 | simplify to the first line of "Agent notes" | no | no | D3: only 2 text columns on the mirror |
| 11 | Agent confidence / Tag confidence | Sort key | 3 | keep (number on queue, text in notes) | no | no | — |
| 12 | Weekly cap + `queue-week.json` + "Weekly cap" field | Limits editor load | 2 | remove; use stateless `queue.max_new_rows_per_run` | no | stateful | D4 |
| 13 | Priority tiers (`priorityOf`) | Row order | 1 | remove; sort by confidence margin | no | no | D4 |
| 14 | Why in queue (7 values, `mergeWhy`) | Explains why a row exists | 1 | remove | no | no | Vocabulary load |
| 15 | Agent proposal (5 values) | Wording relative to current tags | 2 | simplify to Applies / Does not apply / Can't tell | no | no | Same words as Tag outcome |
| 16 | Agent full note | Per-run log in Notion | 1 | remove (stays in local files) | no | no | Duplicate of local data |
| 17 | Seeded outcome / reasoning / at + Effective outcome | Audit decisions inside the queue | 2 | remove from Notion; audit goes to local cases and draft-rules input | no | no | Clean start (D9) |
| 18 | "Rule changed" detection | Re-review after a rule change | 2 | keep only the "Rubric version" column; drop the logic | no | no | The proposal updates itself anyway |
| 19 | Plans as the only write path | Hard rule 1; resumable, reviewable writes | 5 | keep | no | no | Core |
| 20 | Allowlist tables | What may be written where | 5 | keep; rewrite for the new databases + mirror columns | no | no | The only limiter on a real DB |
| 21 | `plan check` + `APPLYING.json` arming | Binds the connector write path | 2 | remove; apply runs the check itself | no | no | Connector write path removed |
| 22 | Connector batch files (no-token fallback) + guard batch matching | Apply without a token | 1 | remove | no | no | Pull needs the token anyway |
| 23 | Read-back + verify + `plan.retry.jsonl` | Hard rule 6 | 5 | keep; post-pull with `filter_properties` | no | fixed by filtering | — |
| 24 | Trust breaker (editor-field diff to `PAUSED`, exit 5) | Catches editor fields changed during a write | 2 | simplify to warn-only | no | yes | Allowlist already blocks such writes; with one editor it fires on their own concurrent clicks and stalls a 2,351-row apply |
| 25 | Never-twice creates + `--retry` by key | Idempotent writes | 5 | keep | no | needed at scale | — |
| 26 | Gate evidence (334 lines) | Proves a rule write came from a PASS | 3 | simplify to about 120 lines | no | no | EN-1 is real, but three of the columns it checks are gone |
| 27 | Protected ids + probe | Token cannot reach real DBs | 5 | keep; three classes | no | no | D3 changes the mirror's class |
| 28 | Pause (`runs/PAUSED` + Agent settings "Paused") | Stop switch | 5 | keep | no | no | Hard rule 7 |
| 29 | Pull (schema/raw/norm/id-map/snapshot) | Local truth for every step | 5 | keep; mirror list, `filter_properties`, pull retention | no | yes (each full mirror pull is tens of MB) | — |
| 30 | Notion contract (property types + select options) | Catches renamed columns/options | 4 | keep, shrink | no | no | — |
| 31 | Drift (rulebook vs `rubric.json`) | Rules can't change behind the rubric | 5 | keep; enforce only for tags that have rules | no | no | Needed for the swap; unjudged tags adopt edits |
| 32 | `status --restore-rulebook --confirm` | Recover from drift | 4 | keep | no | no | — |
| 33 | Distill groups (tag x why x rule) + Opus call | Turns decisions into lessons | 5 | keep (`groupRows`, `buildInput`) | small | no | — |
| 34 | Thresholds incl. owner-ruling route | Evidence bar | 2 | simplify to min 2 distinct claims | no | no | Editor = rule owner |
| 35 | Dedupe vs open lessons + 8-word overfit check | No duplicate or claim-specific lessons | 4 | keep | no | no | Cheap |
| 36 | `distill --link` second plan + Lesson relation | Ties rows to lessons | 2 | remove; "Supporting rows" text column | no | no | One plan instead of two |
| 37 | cases-sync (`cases.jsonl`) | Regression suite | 5 | keep as a library, local file only | no | no | Gate input |
| 38 | "In regression suite" column | Tells the editor a decision became a test | 1 | remove | no | no | Extra apply per run |
| 39 | `--demo-bad-lesson` + planted-lesson handling | Planted FAIL for demos | 1 | remove | no | no | Demo crutch |
| 40 | NEW: draft-rules mode | Rules for the 8 empty tags | 5 | add (D6) | 8 Opus calls once | unblocks tags | — |
| 41 | Candidate build (`buildCandidate`, `applyLesson`, versions, history) | The only way rules change | 5 | keep | no | no | — |
| 42 | Canary condition | Rulebook examples stay right | 5 | keep (changed tag only) | no | no | — |
| 43 | No decided claim newly fails | No regression | 5 | keep (changed tag only) | no | no | — |
| 44 | NEW: supporting claims now come out as decided | The lesson does what it claims | 5 | add | no | no | Replaces the target interval |
| 45 | Paired bootstrap + tolerance + ungated flips + target interval | Statistical guard | 2 | move to `--strict` | yes (needs 3 runs per side) | yes | Samples are tiny today |
| 46 | Reconfirmation (5 extra runs per flipped case, max 16) | Fights 2:1 noise | 2 | move to `--strict` | yes (biggest per-lesson sink) | — | Trial gate cost $10.44 of $13.88 |
| 47 | "Small sample" flag | Honesty about sample size | 1 | `--strict` only; fix the constant | no | no | Card prints 30, gate uses 5 |
| 48 | No apply on unjudged/human tags | Safety | 4 | keep | no | no | Free |
| 49 | `PROMOTE.lock` + `PROMOTING.json` | One promote at a time; PASS awaiting finalize | 3 | merge into one file | no | no | Two files, one state |
| 50 | Finalize (Notion first, then files) | Rubric changes only after Notion shows them | 5 | keep | no | no | — |
| 51 | Rollback `--confirm` | Undo the last live lesson | 4 | keep | no | no | One editor needs an undo |
| 52 | Abort | Clean up a dead promote | 3 | keep (merged with the lock) | no | no | — |
| 53 | Follow-up (Fixed / Still wrong) | Closes the loop | 4 | keep; cache-only; runs automatically after PASS | no (cache hits) | no | — |
| 54 | Follow-up regression over other rows on the tag | Re-checks other decisions | 2 | remove | duplicate work | no | The gate already checked them |
| 55 | Status (preflight + report) | What is waiting | 5 | keep; drop Stage counts | no | no | — |
| 56 | run-card + recard + Runs DB (13 columns) | Run history in Notion | 2 | remove; local `card.md` + "Last run summary" + lesson "Gate result" | no | no | Duplicates local files |
| 57 | Agent settings (9 columns) | Switches | 4 | simplify to 4 columns | no | no | D4 |
| 58 | Sandbox profile (`CLAIM_TAGGER_ROOT`, `sandbox.mjs`) | A second copy of the loop | 4 | keep the mechanism; `sandbox.mjs` to `profile.mjs` | no | no | D8 demo needs it |
| 59 | seed-build (897 lines) | Research export to seed files | 1 | delete (move `parseGeoSources` to lib) | no | no | Research-specific |
| 60 | seed (3 phases) | Fills the trial DBs | 1 | replace with `setup.mjs` | no | no | Mirror is real now |
| 61 | rubric-init | Research fixture to `rubric.json` | 1 | replace with setup (rubric built from the copy) | no | no | — |
| 62 | snapshot / transcript-check | Evidence and session forensics | 1 | delete | no | no | Report-only |
| 63 | probe | Token-scope check | 4 | keep, adapt | no | no | — |
| 64 | Guard hook | Session cannot write Notion via the connector | 4 | keep, simplify | no | no | — |
| 65 | `.claude/settings.json` permissions | Prompts and denies | 4 | fix | no | no | Connector prefix likely wrong; `status.mjs:*` and `promote.mjs:*` allow `--unpause --confirm` / `--rollback --confirm` without asking |
| 66 | Fallback subagents (judge, distiller) | No-CLI fallback | 1 | delete | no | no | Unwired; blocked by the `runs/**` deny |
| 67 | Effective outcome / Direction / Stage / Applied tag / Rejected tag formulas | Computed lifecycle | 1 | remove all | — | — | 7-value Stage vocabulary |
| 68 | Rollups (Tag name, Lesson status, Claim text, Decided applies/does not apply) | Display | 1 | remove | — | — | Tag is a select; claim text is the title |
| 69 | Owner action formula | What the owner must do | 1 | remove | — | — | A Status view does it |
| 70 | 26 trial + 14 sandbox views | Navigation | 2 | replace with 4 views | — | — | — |
| 71 | 54 column descriptions | Guidance | 2 | keep short ones on about 25 columns | — | — | — |
| 72 | Evidence snapshots / report build | MVP artifacts | 1 | archive (P2 reuses the Geo theme bundle) | — | — | Not part of the loop |
| 73 | `pyjson.mjs` (Python-compatible hashes) | Reproduces research hashes | 2 | keep now; optional later | no | no | Not needed for a fresh rubric |

## 2. Minimal version

### 2.1 Scripts (29 + hook to 17 + hook)

| Status | Scripts |
|---|---|
| Kept, modified | `pull`, `judge`, `propose`, `plan` (builder + `resolveOps` + validation), `apply` (validates internally), `verify` (warn-only editor diff), `distill` (no `--link`; adds `--draft-rules`), `promote` (simple gate by default, `--strict`, one lock file, initial rules), `eval`, `followup` (cache-only), `status`, `cases-sync` (library + CLI, no Notion writes), `probe`, `allowlist`, `hooks/guard` |
| New | `sources.mjs` (pre-fetch + cache), `setup.mjs` (replaces seed, rubric-init and sandbox init) |
| Renamed | `sandbox.mjs` to `profile.mjs <profile> <script> [args]` (reuses `runScript`; `init` moves to setup) |
| Deleted | `seed-build`, `seed`, `rubric-init`, `snapshot`, `transcript-check`, `recard`, `run-card`, `.claude/agents/claim-tagger-judge.md`, `.claude/agents/claim-tagger-distiller.md` |

### 2.2 Library modules

- Kept as is: `paths`, `hash`, `pyjson`, `jsonl`, `validate`, `rng`, `exit-codes`, `stats` (strict only).
- Kept, extended: `notion-rest` (add `createDatabase`, `updateDatabase`, page-parent `createPage`, and `filterProperties` on `queryDatabase`); `notion-values` (add `richTextLinks`); `claude` (fix the usage-window regex); `rubric-build` (map taxonomy rows; allow non-Verified/null status and polarity); `notion-contract` (shrink); `gate-evidence` (shrink).
- New: `lib/config.mjs` (`loadConfig`, `dbNames`, `dbEntry`, `mirrorEntries`, `capabilityOf`); `lib/cells.mjs` (one per-tag judgment store replacing four duplicate readers: `makeDoneCheck` in judge, `loadJudgments` in propose, `loadSide` in eval, `readRuns` in followup); `lib/geo-sources.mjs` (`parseGeoSources` moved from `seed-build.mjs` plus the Geo entity resolver).

### 2.3 Notion databases and columns

All of these live on a new page, for example "Claim tagger". Put it outside "Editorial feedback loop" so the integration can be disconnected from the old hub.

**Rulebook copy ("Claim Tags — Issue (copy)").** Same property names and types as the taxonomy: Name (title), Category, Status, Polarity, Work tags (multi-select), Geo Status, Geo Tag ID, Counterpart, Description, Example Claims, When to use, Evidence, Verified on. Leave out only the two relations to the claim tables. No new columns. The agent writes "When to use" only: on a gate PASS, or on a confirmed restore.

**Mirror "U.S. Politics debate claims".** Add "Agent tags" (text; comma-separated tag names; a tag the editor decided always wins) and "Agent notes" (text, at most 1,900 characters), in this form:

```
Fix needed · rubric 2026-10-21.3 · run 20261021T0912Z-judge
Applies: Context-dependent (0.91, 3/3, rule 2); Unsourced (computed: 0 sources)
Unsure: Wordy (0.55, 2/3, rule 1), in your queue
Not checked: Improperly sourced (source not readable); Exact duplicate, Semantically duplicated (needs corpus search)
No rules yet: Trailing period, Poor wording
Does not apply: Multi-sentence, Incorrect grammar, Source inaccessible
```

The first word is the readiness: Fix needed, Needs editor, Not checked or Ready.

**Tag decisions (12 columns).**

| Column | Type | Owner |
|---|---|---|
| Claim | title (claim text) | agent |
| Key | text, `geoId::Tag` (the agent key) | agent |
| Tag | select, 13 options | agent |
| Agent proposal | select: Applies / Does not apply / Can't tell | agent |
| Agent confidence | number | agent |
| Agent reason | text, at most 40 words + rule + k/n runs | agent |
| Claim link | url to the mirror page | agent |
| Rubric version | text | agent |
| Tag outcome | select: Applies / Does not apply | editor |
| Why wrong | select: Agent slip / Rule unclear / Rule should change | editor |
| Your reasoning | text | editor |
| Follow-up | select: Fixed / Still wrong | agent |

There are no relations. Distill takes "decided at" from the page's `last_edited_time`.

**Rule changes (11 columns).** Lesson (title); Lesson ID (unique id, new prefix such as RC; LS and WT are taken in the workspace); Tag (select); Rule (text, "Context-dependent rule 2" or "Context-dependent when to use"); Kind (select: Clarify wording / Change the rule / Initial rules); Current text, Proposed text (text); Editor wording (text, editor-owned); Status (Proposed / Approved / Rejected / Live / Rolled back; the editor sets Approved and Rejected); Gate result (text); Supporting rows (text, list of keys).

**Agent settings (4 columns).** Name, Paused (editor), Rubric in force (agent), Last run summary (agent).

**Runs database:** folded into "Last run summary", the lesson's "Gate result", and local `runs/<id>/card.json` and `card.md`.

### 2.4 Formulas, rollups, views

- Formulas and rollups: none. One formula is optional: an "Overruled" checkbox (`Tag outcome` filled and different from `Agent proposal`). It works now because the two selects use the same option names.
- Views (4): Your queue (Tag decisions: Tag outcome empty; group by Tag; sort by Agent confidence ascending); Needs your note (Why wrong is Rule unclear or Rule should change, and Your reasoning is empty); Lessons waiting (Status is Proposed or Approved); Rulebook (the copy, all rows).
- How views are created: API version 2022-06-28 cannot create views. `/claim-tagger setup` creates them with the connector's `notion-create-view` while `runs/SETUP` exists (the guard already allows view tools under that marker). The configure strings are recorded in `schemas/notion/as-built.md`. If the connector is unavailable, the setup page carries a 4-line checklist for the editor. No script depends on a view.
- Mirror view: recommend the editor adds a linked view of the mirror (Agent tags, Agent notes) by hand. The session must never send a connector call that names the mirror's id.

### 2.5 Config (complete new shape)

```json
{
  "agent": "claim-tagger",
  "notion": {
    "api_version": "2022-06-28",
    "page_id": "<new page>",
    "rulebook": { "database_id": "<copy db>", "data_source_id": "<copy ds>", "key": "Name", "work_tag": "Issue" },
    "mirrors": [
      { "name": "us_politics", "label": "U.S. Politics debate claims",
        "database_id": "7219756338b2416f8fa8af83d75ec47d", "data_source_id": "d1307596-e531-420f-8688-2485f3ef28ab",
        "key": "Geo ID",
        "columns": { "claim": "Geo Name", "link": "Geo URL", "sources": "Geo Sources", "is_factual": "Geo Is factual" },
        "write_columns": ["Agent tags", "Agent notes"] }
    ],
    "databases": {
      "tag_decisions": { "database_id": "", "data_source_id": "", "key": "Key" },
      "rule_changes": { "database_id": "", "data_source_id": "", "key": "Lesson" },
      "agent_settings": { "database_id": "", "data_source_id": "", "key": "Name" }
    },
    "protected_database_ids": ["<taxonomy db+ds>", "<Claims to review db+ds>", "<both World affairs mirrors db+ds>", "<QA agent work tags db+ds>", "<6 trial hub db+ds>", "<6 sandbox db+ds>"],
    "setup_page_parents": ["<parent>"],
    "requests_per_second": 3, "page_size": 100, "max_text": 1900
  },
  "models": { "judge": "claude-sonnet-5-5", "cheap": "claude-haiku-5-5", "distill": "claude-opus-5-5" },
  "tags": { "default": "text", "Unsourced": "deterministic", "Source inaccessible": "source", "Improperly sourced": "source",
            "Factually challenged": "source", "Exact duplicate": "corpus", "Semantically duplicated": "corpus" },
  "judge": { "runs_max": 3, "rerun_if": { "applied": true, "confidence_below": 0.75, "undecided": true },
             "batch_size": 8, "concurrency": 2, "effort": "medium", "max_turns": 1, "timeout_ms": 300000,
             "claude_bin": "claude", "max_error_share": 0.1,
             "prompts": { "text": "prompts/judge.md", "source": "prompts/judge-sources.md" } },
  "sources": { "max_sources_per_claim": 3, "excerpt_chars": 6000, "min_words": 150, "fetch_timeout_ms": 20000,
               "max_bytes": 3000000, "per_host_delay_ms": 1000, "refetch_after_days": 30,
               "user_agent": "geo-claim-tagger/1.0", "resolver": { "geo_api": null, "html_fallback": true } },
  "queue": { "max_new_rows_per_run": 150, "reason_max_words": 40 },
  "distill": { "min_claims": 2, "overfit_ngram": 8 },
  "gate": { "initial_rules_sample": 30, "initial_rules_max_rate": 0.5,
            "strict": { "runs": 3, "tolerance": 0.05, "min_positives": 5, "bootstrap": 1000, "ci": [0.025, 0.975],
                        "ungated_flips_hold": 1, "ungated_flips_fail": 3, "reconfirm_runs": 5, "reconfirm_max": 16,
                        "large_sample_positives": 30 } }
}
```

- `anonymise.replacements` moves to a git-ignored `anonymise.local.json` with an example file. Today it commits five real names.
- Removed keys: `hub_page_id`, `databases_page_id`, `engineer_notes_page_id`, `walkthrough_page_id`, `max_creates_per_call` (all dead); `thresholds`, `readiness`, `scope.*`, and the old `queue.weekly_cap_default`.

### 2.6 Skill subcommands

`S` is `agents/claim-tagger/scripts`. "A" is now one command: `apply.mjs --run <id>`.

| Subcommand | Script sequence |
|---|---|
| `setup` (once) | `probe`; engineer creates `runs/SETUP`; `setup page`; `setup rulebook` (rows fetched via the connector); `setup mirror-columns --confirm`; `setup evals`; `setup rubric`; views via connector; engineer deletes `runs/SETUP`; `status` |
| `status` | `pull --all`; `status` |
| `tag [--tags X] [--limit N]` | `pull`; `sources` (only if a source tag is in scope); `judge --pass all`; `propose`; A |
| `draft-rules [tag or all]` | `pull`; `distill --draft-rules`; A |
| `distill` | `pull`; `distill`; A |
| `promote <lesson> [--strict]` | `pull`; `promote --lesson`; A; `promote --finalize`; commit; `followup`; A |
| `rollback <lesson>` | `promote --rollback --confirm`; A; commit |
| `follow-up <lesson>` | Manual re-run of the automatic step |

### 2.7 Safety checks, with one editor

| Check | Kept? | Why |
|---|---|---|
| Allowlist (build and apply time) | keep | The only thing holding a real database to 2 columns. Code constant `MIRROR_COLUMNS` intersected with config `write_columns`; updates only, never creates |
| Read-back verify | keep | Hard rule 6; costs one filtered pull |
| Drift | keep | Protects live behavior and the later swap. Enforced only for tags that have rules: edits to unjudged tags are adopted, because nothing judges them yet |
| Pause | keep | Hard rule 7 |
| Protected ids + probe | keep | Taxonomy, Claims to review, World affairs and the old hub stay unreachable. Probe classes: protected = 404/403, mirror = 200 plus key and write columns present, configured = 200 plus title |
| Guard hook | keep, simplified | Denies every connector page write. Allows schema and view tools only under `runs/SETUP`, and only for calls that name no protected or mirror id |
| Gate evidence | simplify | A rule-text write needs: `PROMOTING.json` naming the run, a non-smoke PASS card, the candidate hash matching the card, the live hash matching the card's baseline, and the text equal to the candidate's composed text. Restore and setup modes stay. Plan files are only a deny rule away from Bash edits |
| `PROMOTE.lock` + `PROMOTING.json` | merge | One file, created exclusively at start; phase `judging` to `planned`; removed on HOLD, FAIL, finalize or abort |
| Trust breaker | warn-only | The allowlist already prevents editor-field writes. The decided-row rule and the `guard {undecided}` skip protect decisions. A pause would mostly catch the editor's own concurrent clicks |
| `APPLYING.json` arming, connector batches, smoke and planted demos | drop | — |

### 2.8 Cost in this shape

Estimates from the trial's measured rates: about 50 seconds and $0.086 per 8-claim call with 10 tags.

- Today's design at 2,351 claims: 882 calls, about 6 h, about $76 equivalent per full pass.
- Context-dependent rollout: 294 single-tag calls plus reruns for roughly 15-25% of claims. Short outputs, so on the order of 1-1.5 h.
- Simple gate per lesson: 3-10 single-tag calls, about $0.05-0.30, against $2.3+ per attempt in the trial.
- Source pass: up to about 1,409 per-claim calls (2,351 minus the 942 unsourced), roughly 7,000 tokens each. Expect several usage windows; the run resumes.

## 3. Optimal version (iterations, in order)

| # | Iteration | When / what |
|---|---|---|
| O1 | `--strict` gate as routine | Once any tag has 30 or more decided positives, and always before the swap. Runs every text tag in one whole-pass call with a context-keyed cache, to measure interference between tags. |
| O2 | `status --adopt <tag>` | Turns a direct edit of a judged tag in the copy into a gated lesson (Proposed text = the Notion text). Replaces restore-or-stop. |
| O3 | Code-decided mechanical tags | Trailing period, Multi-sentence (maybe Improper capitalization) after their rules are approved. Canaries test the code. Removes about 2 tags' output tokens per claim. |
| O4 | Throughput tuning | Batch size by tags in the call (`clamp(floor(200 / tags_in_call), 8, 25)`). Skip Improperly sourced and Factually challenged when "Geo Is factual" is false (follows Improperly sourced rule 4; flag the coupling to rule text). |
| O5 | World affairs | Second `mirrors[]` entry; move both World affairs ids out of protected after choosing which mirror is canonical. A Geo ID can appear in both mirrors: judge once per Geo ID + text, write to every mirror page, one queue row per Geo ID x tag. |
| O6 | Corpus search for duplicates | Exact duplicate = normalised-text hash over a local export of the canonical spaces (348,912 claims), decided in code. Semantically duplicated = candidate retrieval plus a pair-adjudication judge pass. Queue rows only for candidate pairs. |
| O7 | Swap to the real taxonomy | Change `notion.rulebook` ids; move the taxonomy from protected to rulebook; keep the `work_tag` filter. The team agrees that the agent writes "When to use" after a PASS. Probe expects 200. |
| O8 | Confidence calibration per tag | From decided rows; set rerun and queue thresholds per tag. |
| O9 | Per-editor queues | Only when a second editor joins: an Editor column plus views; second opinion returns only then. |
| O10 | Scheduled runs | Respect the Paused switch; daily one-line summary. |

## 4. Change list (ordered, for coding agents)

**C1. Archive the trial (no code risk).** Git: `git tag trial-2026-10-14`. Move `rubric/`, `evals/` and `sandbox/` to `agents/claim-tagger/archive/trial-2026-10/` (in git history). Rename `runs/` to `runs.trial-2026-10/` (git-ignored). Notion (engineer, by hand): disconnect the integration from "Editorial feedback loop"; add a "History, superseded by <new page>" callout by hand. Add the 12 old database and data-source ids to `protected_database_ids`; the probe then proves 404. Never delete or archive in Notion (rule 8).

**C2. Config and paths.** `config.json`: the shape in 2.5. New `lib/config.mjs`: `dbNames(config)` returns `['rulebook', 'tag_decisions', 'rule_changes', 'agent_settings', ...mirrors as 'mirror.<name>']`, plus `dbEntry`, `mirrorEntries`, `capabilityOf(config, tag)`. Every reader of `config.notion.databases[...]` goes through it: pull, plan (`openPlan`/`prepare`), apply, probe (`targetsOf`), guard, status, promote, distill, followup, cases-sync. `paths.mjs`: keep `agentRoot`, `codeRoot`, `codeFile`, `ROOT_ENV`; add `profileRoot(name)` returning `agents/claim-tagger/profiles/<name>`. `sandbox.mjs` to `profile.mjs` (reuse `runScript`; update `SCRIPTS`). Tests: `paths.test.mjs`; new `config.test.mjs`; `sandbox.test.mjs` to `profile.test.mjs`.

**C3. Library extensions.** `notion-values.mjs`: add `richTextLinks(value)` returning `[{ text, href }]` from `rich_text[].href` / `text.link.url` (`decodeTyped` drops links today). `notion-rest.mjs`, inside `createClient`: `createDatabase({ parentPageId, title, properties, isInline })` (POST /databases); `updateDatabase(id, { properties })` (PATCH /databases/{id}); `createPage({ parentPageId, ... })` for plain pages; `queryDatabase(..., { filterProperties: [propertyIds] })` as repeated `filter_properties` query parameters. `claude.mjs`: split `USAGE_WINDOW_RE`; usage window = `/usage limit|limit reached|resets?/`; 429, 529 and "overloaded" are transient with backoff (30 s, 120 s); stop as usage window only after 3 consecutive transient failures. Move `parseGeoSources` from `seed-build.mjs` to `lib/geo-sources.mjs`. Tests: `notion-values.test.mjs`, `notion-rest.test.mjs`, `claude.test.mjs`.

**C4. Rubric from the copy (`lib/rubric-build.mjs`, `schemas/rubric.schema.json`).** `buildRubric`: drop the Verified filter; keep rows already filtered by "Work tags contains Issue". `rowToTag`: keep the row's status (Verified, Proposed or null); polarity and category may be null; `judged = rules.length > 0 && !human_only`. Set `deterministic` and `needs_source_reading` from `capabilityOf`; leave them out of `tagHash` (unchanged). Example claims: strip a leading `- ` and surrounding quotes. Schema: `status` enum Verified/Proposed/null; `polarity` nullable. Keep `splitRules`, `composeWhenToUse`, `rehash`, `checkHashes`, `diffRubric`, `applyLesson`, `nextVersion`. Tests: `rubric-build.test.mjs`, with fixtures from `claim-tags-verified.9oct.rows.json` (the 13 rows plus the 13 Oct delta).

**C5. Allowlist, contract, guard, settings.** `allowlist.mjs`: static constants become config-aware (`assertWritable(db, prop, value, { schema, ctx, config })`); `rulebook.WRITABLE = ['When to use']` (promote or restore only); `SETUP_CREATE_ONLY.rulebook` = all copy properties (ctx.setup plus the `runs/SETUP` marker); `tag_decisions` writable: Claim, Key, Tag, Claim link, Agent proposal, Agent confidence, Agent reason, Rubric version, Follow-up; `FOLLOW_UP_FIELDS = ['Follow-up']`; `rule_changes` writable: Lesson, Tag, Rule, Kind, Current text, Proposed text, Gate result, Supporting rows, Status (Live / Rolled back; Proposed on create); `agent_settings` writable: Rubric in force, Last run summary; mirror: `update` only, `prop in MIRROR_COLUMNS intersect write_columns`, schema type `rich_text`; creates only when `mirror.demo === true && ctx.setup`; `EDITOR_NAMES = {Tag outcome, Why wrong, Your reasoning, Editor wording, Paused}` plus Status Approved/Rejected. `notion-contract.mjs` `REQUIRED_OPTIONS`: rulebook Work tags includes Issue; Tag selects include the rubric's tag names, checked at pull; Agent proposal, Tag outcome, Why wrong, Follow-up, Kind, Status as in 2.3. `hooks/guard.mjs`: keep `decide`, `hookOutput`, `protectedMention` (extend to mirror ids), `editorWrite` (new names), `decideSetupPage`; delete `armedBatches`, `decideCreate`, `decideUpdate`; page writes are always denied. `.claude/settings.json`: replace `status.mjs:*` with explicit read-only forms; put `--unpause`, `--restore-rulebook`, `--rollback` and `setup.mjs` under `ask`; fix the Notion connector prefix (check it in `/permissions`); prune deleted scripts; add `sources.mjs`; deny `Write`/`Edit` under `profiles/*/runs/**`. Tests: `allowlist.test.mjs`, `notion-contract.test.mjs`, `guard.test.mjs`.

**C6. Pull (`pull.mjs`).** Keep `loadPull`, `findSchema`, `indexRows`, `editorSnapshot`, `schemaProblems`, `computeDrift`, `latestPullId`. Mirrors: query with `filterProperties` (key, title, link, sources, is_factual, write columns; ids from `retrieveDatabase`). Write `norm/claims.jsonl` rows `{ mirror, geo_id, page_id, notion_url, claim, geo_url, source_links, sources_count = links.length, is_factual, agent_tags, agent_notes }`; the file name is unchanged so `judge.loadItems` and `cases-sync.claimTexts` keep working; a duplicate Geo ID within one mirror fails, across mirrors it is allowed. `rulebookRows`: taxonomy names (Name, Example Claims, Work tags, ...), filtered by `work_tag`. Queue normaliser trimmed; `decided_at = last_edited_time`. Lessons: `supporting_keys` parsed from text; `created` from page `created_time`. Settings: paused, rubric_in_force, last_run_summary. `computeDrift`: ignore tags with no rules on both sides. Retention: keep the last 20 pulls and those referenced by an unfinished run. Tests: `pull.test.mjs`; new Notion fixtures replace `tests/fixtures/notion/db.*.json` with copy, queue, rule changes, settings and mirror.

**C7. Notion setup (`setup.mjs`, new, REST through `lib/notion-rest.mjs`).** Subcommands; every write is a plan with ctx.setup or a schema call gated by `runs/SETUP`. `page --parent <id>`: create the plain page. `databases`: create the copy, queue, rule changes and settings; the copy's property definitions come from a taxonomy schema JSON the skill saved via `notion-fetch` (types and select options copied); Tag select options come from the 13 names; prints the database ids; data-source ids: the skill reads them with `notion-fetch` and records them in config; mark `data_source_id` optional where only the guard uses it. `rulebook --from setup/taxonomy-issue.json`: plan creating the 13 copy rows (reuse the shape of `seed.mjs` `rulebookProps`); the rows file is written by the skill from a connector fetch, so the token never needs taxonomy access. `mirror-columns --confirm`: `updateDatabase(mirror)` adding only missing write columns as `rich_text`; refuses a same-name column of another type; never touches other properties; the only schema write ever made to a real database. `evals`: canaries from the copy's Example Claims (conservative parser plus a committed `evals/canaries.exclude`); keep the archived Context-dependent negative canaries (from Self-contained examples); import archived cases for the 13 tags, re-stamped with `cases-sync` `buildCase` logic; audit decisions (Claims to review export, anonymised with `scrubNames`) go into `evals/audit.jsonl` as draft-rules input. `rubric`: `buildRubric` from the copy pull; write `rubric.json`, `rubric.lock`, `history/`, `CHANGELOG`; reuse `writeLock` and `appendChangelog`, exported from promote. `--profile <name> --demo`: same steps into `profiles/<name>/` with a mirror-shaped demo claims DB (`mirror.demo: true`); rubric cut to Context-dependent with `sandboxRubric` logic; the D8 story content belongs to P2. Probe: three target classes in `targetsOf`/`judge`. Tests: new `setup.test.mjs`; `probe.test.mjs`.

**C8. Per-tag cell store (`lib/cells.mjs`, new).** Key: `h16(pyJson({ driver, model, effort, pass, prompt_version, tag: name, tag_hash }, sortKeys))`; reuse `configId` and `promptVersion`. The CLI version is recorded in each line, not keyed. Layout: `runs/judgments/<key16>/meta.json` and `run-<n>.jsonl`; lines are `{ id, item_hash, status, decision, p, rule_ref, rule_hash, trigger, reason, basis, call: { run_id, batch, call_tags, cost_usd, cli_version } }`; last line wins. About 40 files instead of about 30,000 JSON files at 2,351 claims. `item_hash` = `textHash(claim)` for the text pass, and `h16(claim + bundle_hash)` for the source pass, so changed sources re-judge. One LOCK per store (reuse `takeLock`). `--whole-pass` (strict) adds `context_hash` = hash of the call's sorted tag hashes. Tests: new `cells.test.mjs`; `hash.test.mjs`.

**C9. Judge (`judge.mjs`).** `scopeOf(rubric, config)` returns `{ text, source, coded: ['Unsourced'], notChecked: { corpus, noRules } }` (text / source = judged (has rules) and that capability). Flags: `--pass text|source|all`, `--tags a,b` (gate and rollout), `--runs-max`, `--whole-pass`. Batching: run 1 `need(item) = scope tags with no run-1 cell`; group items by need-set; batch each group by `batch_size`; render the system prompt per tag set with the existing `renderSystemPrompt` / `renderTag` (cached under `runs/judgments/prompts/<h16>.md` with the `ensureSystemPrompt` meta checks); `validateJudgeOutput(..., { modelTags: callTags })`. Adaptive runs: after run 1, `rerun(c)` = decision `apply` or `ask_editor`, or text-pass `cannot_tell`, or `p < 0.75`; those cells get runs 2..`runs_max`; grouped and batched the same way, may be in flight concurrently. Per-run call log: `runs/<run-id>/calls.jsonl` (replaces the per-config `ledger.jsonl`); `run.json` keeps args, items, passes and the resume command (keep `withRecordedOptions` and `loadRunToResume`). Remove `computeConfig`'s whole-rubric key and `makeDoneCheck` (both to `cells.mjs`). Keep `codeDecidedTag`, extended: basis `fetch` for Source inaccessible; corpus tags get `cannot_tell` with basis `no_corpus`. Tests: `judge.test.mjs` (grouping, adaptive reruns, per-tag cache hits after a one-tag change, two passes); `tests/fixtures/fake-claude.mjs` already reads the "Tags you must decide" section; add a source-pass mode.

**C10. Source pre-fetch (`scripts/sources.mjs`, new) and source pass.** Input: `norm/claims.jsonl` `source_links`; `--ids`, `--limit`, `--refresh`. Resolve: geobrowser entity to Web URL via `lib/geo-sources.mjs`; order: `config.sources.resolver.geo_api` if set, else HTML fallback; a plain external link is used as is; cache in `runs/sources/resolve/<sha16(entity)>.json`; failure = `unresolved` (not checked). Fetch: per-host delay; 20 s timeout; at most 5 redirects; at most 3 MB; one retry on network error or 5xx. Status values: `ok` (readable, 150+ words), `thin` (possible paywall or JavaScript-only page), `paywall` (marker strings), `blocked` (401, 403, 429, 451, or a challenge page), `not_found` (404, 410), `server_error` (5xx after retry), `timeout`, `network`, `pdf` (counted as inaccessible, D5), `unresolved` (Geo link not resolved; our tooling failure). Cache: `runs/sources/<sha16(web_url)>/meta.json` and `text.txt` (scripts, styles and navigation stripped; whitespace collapsed); per claim `runs/sources/claims/<geo_id>.json` `{ links, bundle_hash }`. Excerpt: title, then the first 1,500 characters, then the +/-400-character windows with the highest word overlap with the claim, up to `excerpt_chars`; at most 3 sources per claim. Code pre-decisions (no model call): 0 sources: all three source tags `do_not_apply`; all sources hard-failed: Source inaccessible applies, the other two `cannot_tell` (Improperly sourced rule 3); nothing readable and something unresolved: all three "not checked", no queue row. Otherwise one call per claim with `prompts/judge-sources.md` (new; excerpts quoted as data inside `<source n status url>`); same JSON contract, `validateJudgeOutput`, cells keyed by bundle. Tests: new `sources.test.mjs` (classification, cache, excerpt cap, resolver fallback with a fake fetch).

**C11. Propose (`propose.mjs`).** Keep `decideVerdict` (called with `required = rerun(run-1 cell) ? runs_max : 1`), `isLowConfidence`, `leansApply`, `capLines`, `capWords`, `tagLine`. `readinessOf` drives the first line of the notes; issue = any in-scope tag, not polarity. Claim ops: one update per mirror page of the Geo ID, writing "Agent tags" and "Agent notes" only when they differ. Queue: create rows only for low-confidence text/source cells; at most `max_new_rows_per_run`, sorted by `|p - 0.5|`; update undecided rows; never touch decided rows (keep `guard: { undecided: true }`). Delete `priorityOf`, `mergeWhy`, `isoWeek`, `fullNote`, the weekly-cap block (lines 589-606) and `runs/state/queue-week.json`. Export `claimColumns()` so followup reuses it and its duplicate `liveColumns` goes. Tests: `propose.test.mjs`.

**C12. Plan, apply, verify.** `plan.mjs`: keep `openPlan`, `readPlan`, `resolveOps`, `PlanError`; export `checkPlan()` (validation + allowlist + `checkGateEvidence`); delete `armedState`, `disarm`, `writeBatches`, `toConnectorProperties`, `APPLYING.json`; mirror ops use db key `mirror.<name>`. `apply.mjs`: calls `checkPlan` itself; keep the pre-pull reuse, `markdownToBlocks`, ledger, `--retry`, `--dry-run`; no-token = exit 2; pre and post pulls of mirrors are filtered. `verify.mjs`: editor-field differences go into `verify.json` and the summary, with no `PAUSED` and no exit 5; exit 5 stays reserved. Tests: `plan.test.mjs`, `apply.test.mjs`, `verify.test.mjs`.

**C13. Distill and draft-rules (`distill.mjs`, `cases-sync.mjs`).** Keep `groupRows`, `buildInput`, `checkReply`, `distillGroup`, `ngramOverlap`, `lessonTexts`, `parseRuleLabel`, `targetCurrentText`. `thresholdOf`: one `min_claims`. Plan A creates Rule changes rows with "Supporting rows" text. Delete `link`, `plan-link.jsonl`, `--demo-bad-lesson`, `lessonMarkdown`'s planted-lesson branch. `cases-sync.linkedLessons` matches by `supporting_keys`; delete `planRegression`. `--draft-rules <tag|all>` (D6), for tags with an empty When to use: input = copy row (Description, Example Claims, Counterpart, Category), `evals/audit.jsonl` rows for that tag, and Context-dependent's When to use as a format example; `prompts/draft-rules.md` (new) returns `{ preamble, rules[], note, open_questions }`; one Opus call per tag; plan: one Rule changes row with Kind "Initial rules", Rule "<Tag> when to use", Current text "", Proposed text = `composeWhenToUse`. Tests: `distill.test.mjs`, `cases-sync.test.mjs`; draft-rules fixture in `tests/fixtures/loop/fake-claude.mjs`.

**C14. Gate (`eval.mjs`, `promote.mjs`, `lib/gate-evidence.mjs`).** `evaluate({ mode: 'simple' | 'strict' })`. Simple mode looks only at the changed tag; other tags' cells are identical by key. S1: every active canary of the tag passes. S2: no active case of the tag that passes under the live rubric fails under the candidate. S3: every supporting row comes out as the editor decided. S4: no model `apply` on a tag whose capability is corpus, deterministic or human. S5: for initial rules only, a base-rate check: on a fixed seeded sample of 30 mirror claims the tag applies to at most 50%, and the applied ones are listed for the editor. Verdicts per side use the adaptive majority (1 run; uncertain or applied cells get runs 2-3). PASS or FAIL; HOLD only when there is nothing to evaluate. Strict mode is today's conditions 1-5, `pairedBootstrapDelta`, `reconfirmCandidates`/`reconfirmFlips`, `--whole-pass`; fix the "small sample" constant. `card.schema.json`: add `mode`; make strict-only fields optional. `promote.mjs`: `checkLesson` accepts Kind "Initial rules" with empty Current text when the tag has no rules; drop the "New or promoted tag" refusal; call `syncCases` before selecting items; the candidate side runs `judge --tags <tag>`; PASS plan: rulebook `{ When to use }` with `expect` on the current text, lesson Live + Gate result, settings "Rubric in force" + "Last run summary"; no Runs row, Tag hash, Rule version, Changed by or In regression suite; lock: `takePromoteLock`/`releasePromoteLock` now operate on `PROMOTING.json` with a `phase` field; delete `DEMO_TITLE`, `localDemoFlag`, `--mark-rolled-back`, `--smoke`, `perTagSummaryWithHash`; keep `finalize`, `abort`, `rollback`, `restoreOps` (When to use only), `candidateVersion`, `buildCandidate`. `gate-evidence.mjs`: keep `gateClaims`, `checkGateEvidence`, the shape of `promoteEvidence` minus the Changed by / Tag hash / Rule version / Agent settings checks, `restoreEvidence`; rename the seed mode to setup. Tests: `eval.test.mjs` (existing tests move under strict), `promote.test.mjs`, `gate-evidence.test.mjs`.

**C15. Follow-up and status.** `followup.mjs`: judge supporting claims under the live rubric; these are per-tag cache hits from the gate's candidate side, so 0 tokens; write "Follow-up" and "Last run summary"; delete `liveColumns` and the same-tag regression block. `status.mjs`: delete `STAGES`; queue counts: open, decided, needs note; add a sources-cache summary and the PROMOTING phase; add `--adopt-unjudged` (records copy edits of tags with no rules as a new version plus a changelog line); keep `preflight`, `checkVerdict`, `lockState`, `buildRestorePlan`, `--unpause --confirm`, `--restore-rulebook --confirm`. Tests: `followup.test.mjs`, `status.test.mjs`.

**C16. Delete.** Scripts: `seed-build`, `seed`, `rubric-init`, `snapshot`, `transcript-check`, `recard`, `run-card`. Tests: `seed-build.test.mjs`, `seed.test.mjs`, `rubric-init.test.mjs`, `snapshot.test.mjs`, `sandbox.test.mjs` (replaced). `.claude/agents/claim-tagger-judge.md`, `.claude/agents/claim-tagger-distiller.md`. `package.json` `check:model` stays.

**C17. Documentation.** CLAUDE.md rule 1, editor-owned fields: Tag outcome, Why wrong, Your reasoning, Editor wording, Status Approved/Rejected, Paused. CLAUDE.md rule 5: "Only rulebook tags with gated rules are judged. The rulebook is the configured copy of the taxonomy rows whose Work tags contains Issue; a tag is judged once its When to use has numbered rules that went live through the gate. Unsourced is computed from the sources; source tags are decided only from fetched source text; corpus tags are reported as not checked; Editor verified is never written." CLAUDE.md rule 10: "On each real claim mirror in `config.notion.mirrors`, scripts write only its `write_columns` (Agent tags, Agent notes; the code refuses any other name), never create or delete a row, and change its schema once, at setup, to add those two columns. The taxonomy, Claims to review and every other real database stay protected. The agent's databases live under <new page>; 'Editorial feedback loop' and its Walkthrough are read-only history." CLAUDE.md agents table: `setup | status | tag | draft-rules | distill | promote | rollback | follow-up`. AGENT.md: rewrite the steps table, contracts (cell store, sources cache), "Models and runs" (adaptive) and "Safety checks" (2.7). SKILL.md: sequences from 2.6; fixed report format (what ran, a result table of at most 5 rows, "Next:" one command; P2 owns the wording); delete Sandbox mode and Evidence sections. `schemas/notion/as-built.md`: new section for the new page.

**C18. End to end.** Fake driver on a demo profile: `npm test`, plus a script-level loop (tag, decide by fixture, distill, approve by fixture, promote, follow-up). Live: Context-dependent on `--limit 50` mirror claims, then the full mirror.

## 5. Risks and trade-offs for Mika

- Source tags depend on an unverified step. Each Geo source entity must be resolved to its Web URL (Geo API or page scrape). Until a 1-2 hour spike shows how, the three source tags will show "not checked" for most claims.
- The mirror is real and shared. Check with whoever refreshes "U.S. Politics debate claims" that a refresh does not wipe added columns. The old agent's "Claim quality tags — verified" relation will sit next to the new "Agent tags" text column, which can confuse editors.
- A full tag run writes up to 2,351 mirror pages (about 13 minutes at 3 requests/s). Pulls of the real mirror are large without `filter_properties`. I believe that parameter works with Notion-Version 2022-06-28 but have not verified it.
- Per-tag caching trades away cross-tag interference detection. The trial confirmed Context-dependent flipped when Predictive's rules changed. The simple gate cannot see this by construction; `--strict` (whole-pass judging) can. A periodic full re-judge (for example monthly, and before the swap) bounds stale context.
- The simple gate is only as good as its evidence. New rules for tags with 0-3 examples and few decisions are mostly gated by the editor's own approval. Expect several FAIL and reword cycles. Trailing period and Poor wording have neither examples nor audit decisions.
- The adaptive ~1.3x target depends on how often tags apply. Every applied cell is re-run. If 30% or more of claims carry some issue, expect about 1.6x. Measure on the first 100 claims.
- The usage window will pace the work. The first source pass is about 1,400 calls with excerpts, likely spanning several days of usage windows. Roll out tag by tag: Context-dependent first, then the source tags, then the format tags after their rules are approved.
- Hard rule 5 must change, not only rule 10. Also, drift is enforced only for tags that have rules, so edits to unjudged tags are adopted without a gate. That is a deliberate exception to rule 4's spirit; sign it off explicitly.
- Defense in depth goes down. Without the trust-breaker pause, plan arming and connector batches, enforcement rests on the allowlist, the Claude Code deny on `runs/**`, the guard hook, and the slimmer gate evidence. That fits one editor; revisit with more editors or unattended runs.
- Duplicates. Following D5 literally would queue about 4,700 "cannot tell" rows. I recommend corpus tags are never queued until corpus search exists (O6). This is your call.

Could not verify: the Geo API or HTML resolution of source entities; whether the real mirror has a sources-count column (the research sample shows "Geo Sources (count)"; the schema digest lists only "Geo Sources"); whether the token can already read the mirror (the probe reported 4 reachable real databases); `filter_properties` with API version 2022-06-28; creating `unique_id` properties through the API; the Claude Code permission-rule name for this Notion connector; wall time for single-tag and per-claim source calls.

Critical files for implementation: `scripts/judge.mjs`, `scripts/allowlist.mjs`, `scripts/pull.mjs`, `scripts/promote.mjs` (with `scripts/eval.mjs`), `scripts/lib/rubric-build.mjs`.
