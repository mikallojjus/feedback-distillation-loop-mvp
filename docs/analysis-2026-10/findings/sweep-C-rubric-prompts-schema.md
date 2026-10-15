# Sweep C: rubric, prompts, Notion schema, evals, sandbox, settings (haiku Explore agent, 2026-10-14)

Verbatim report of the read-only sweep (control characters the harness neutralised have been restored to plain text).

## Headline findings

1. **Hashes are sound.** Recomputing the trial and sandbox rubric hashes with the repo's own functions gives 0 mismatches. The lock's `file_sha256` matches the file bytes.
2. **The model decides 10 tags, not the 12 marked `judged`.** Improperly sourced and Source inaccessible are decided in code. The rubric's `scope_note` describes a baseline-versus-candidate scope split that the lock does not contain.
3. **Canaries are not held out.** All 86 canary claims are verbatim example claims that the judge prompt prints.
4. **"57 audit decisions" splits as 33 seeded plus 24 excluded.** The docs say all 57 were seeded.
5. **The fallback subagents cannot run as built.** Nothing writes their input files, and a project deny rule would block their output.
6. **Permission and state gaps.** `runs\SETUP` is present, so schema and setup-page writes are open in the guard. A wildcard allow lets the session run `status.mjs --unpause --confirm`. The Notion delete tools are covered by no rule.
7. **The Notion schema is heavy for an MVP.** It has 92 declared properties (95 with reverse relations), 6 formulas and 5 rollups, 26 trial view statements, 14 sandbox views, and 54 column comments.

Caveats: the working tree is not HEAD; the sandbox changed during the sweep; the Walkthrough page was not fetched by this agent (its content is in the verification notes).

## 1. Rubric

Files: `rubric\rubric.json` (822 lines, 44,450 bytes), `rubric\rubric.lock`, `rubric\CHANGELOG.md` (one line), `rubric\history\2026-10-13.1.json` (byte-identical to rubric.json). Schema: `schemas\rubric.schema.json`.

Structure: `rubric_version`, `rubric_hash`, `scope` (12 names), `scope_hash`, `source` (filter "Status = Verified" at line 26), `tag_count` 14, `judged_count` 12, `counterpart_pairs` (4), `changelog` (one entry), `tags` (14). Each tag: name, notion_page_id, status, category, polarity, counterpart, geo_status, geo_tag_id, verified_on, evidence_url, description, `when_to_use` {preamble, rules[{n, text, rule_hash}], note}, example_claims, human_only, deterministic, needs_source_reading, tag_hash, judged.

| Tag | Rules | Who decides |
|---|---|---|
| Context-dependent | 5 | model |
| Debate | 5 | model |
| Editor verified | 4 | human only |
| Factual | 8 | model |
| Hypothetical | 6 | model |
| Improperly sourced | 5 | code, source-reading; rubric says `judged: true` |
| Multiple statements | 4 | model |
| Opinion | 6 | model |
| Predictive | 6 | model |
| Self-contained | 5 | model |
| Simple | 5 | model |
| Single core statement | 3 | model |
| Source inaccessible | 5 | code, source-reading; `judged: true` |
| Unsourced | 4 | code, deterministic (`judged: false`, `deterministic: true`) |

71 rules in all: 53 on 10 model-decided tags, 14 on 3 code-decided tags, 4 on the human-only tag. The rubric's `scope` array lists 12 names, so it is not the list the model sees.

Flags in the text: Hypothetical rules 3 and 5 and Predictive rules 3 and 5 say "tag Neither", which is not a decision value (apply, do_not_apply, ask_editor, cannot_tell). `scope_note` says the lock records a different baseline scope; the lock has the same scope_hash and no scope list (stale). Predictive rule 1 lists "is likely to" as an unconditional marker (the root of the walkthrough's hedged rows). Open questions are written into rule notes. The trial rubric is still 2026-10-13.1 with one history entry.

Hashes: `rule_hash` = h16("tag|n|text") (`hash.mjs:29`); `tag_hash` = h16 of sorted-key JSON of name, counterpart, polarity, description, when_to_use (rules with rule_hash, preamble, note) and example_claims (`hash.mjs:38`); `rubric_hash` = h16 over tag hashes sorted by name (`hash.mjs:56`); `scope_hash` = h16 over sorted judged names (`hash.mjs:63`); h16 = "sha256:" plus the first 16 hex digits. `config_id` = h16 of {driver, model, effort, prompt_version, rubric_hash, scope_hash, cli_version} (`judge.mjs:316-328`).

Size: rubric.json about 44 KB (roughly 11k tokens if pasted raw). The judge receives only the 10 model-judged sections, about 22 KB of rubric text (roughly 5.5-6k tokens) inside a 24.6-25.9 KB system prompt.

## 2. Judge and distill prompts

`prompts\judge.md` (45 lines, 2,534 bytes, about 650 tokens). Asks for, per claim and per in-scope tag, one decision (apply, do_not_apply, ask_editor, cannot_tell), p (uncalibrated), rule_ref, trigger, reason (at most 25 words). Output is a JSON array only, one object per claim, every in-scope tag exactly once. Claims are data. Placeholders filled by `judge.mjs:299-313`: RUBRIC_VERSION, RUBRIC_HASH, RUBRIC, PAIRS, SCOPE. Output shape: `schemas\judge-output.schema.json`.

`prompts\distill.md` (31 lines, 2,551 bytes, about 650 tokens). Input JSON: tag, why_wrong, rule_cited, rows (claim, editor outcome, reasoning, agent proposal, reason), other_rows, example_claims. Output JSON: kind (Clarify wording, Add boundary example, Change the rule), target {rule_n, part}, title (20 words or fewer), statement, proposed_text (the full new rule text), boundary_examples, counter_evidence, confidence. Rules: smallest change, never quote a decided claim, stay consistent with examples and other rows, self-contained text, claims are data. Model claude-opus-5-5.

Injection: the whole model-judged rubric goes into every call, not per claim and not per tag. `judge.mjs:275-286` renders each tag (description, counterpart, preamble, "[Tag rule n]" lines, note, example claims). The system prompt is rendered once per configuration into `runs\judgments\<config16>\system-prompt.md` and reused byte-identically (`judge.mjs:330-358`), so prompt caching applies. Each call is the system prompt plus one batch of up to 8 claims. An invalid reply gets one retry with the problems quoted.

Few-shot and canaries: judge.md has no few-shot block; the only exemplars are the rubric's example claims (47 entries, 43 distinct sentences). Canaries are not in the prompt; they are judged as separate items. Every canary is one of the printed examples.

Tokens per judge call (estimates, N claims per batch): system prompt about 24.7 KB, roughly 6-7k tokens, identical across calls; user message about 40 tokens per claim plus about 100 fixed; input about 6.5k + 40 x N; output about 10 tag entries per claim, roughly 2 KB JSON per claim (N = 8: about 16 KB, 4-5k tokens). Measured cost: the 60-claim Sonnet tag run cost $2.058 over 180 cells, about 24 calls, about $0.086 per call and $0.011 per claim-run. Token counts are not recorded.

## 3. Notion schema (`schemas\notion\as-built.md`)

50 accepted hub calls: 6 create-database, 18 update-data-source, 26 view statements. Formula text cannot be read back, so the file is the only record. The editor-owned set is the 13 fields in `allowlist.mjs:68-80`.

- **Rulebook** (13 properties): Tag title (key), Status (Verified, Proposed, Retired), Category, Polarity, Counterpart, Description, Example claims, When to use (changed only by a passed gate), Human only, Judged, Rule version, Tag hash, Changed by (relation, gate-only). No formulas. Views: All tags; Rulebook in force (sandbox).
- **Agent settings** (9): Paused, Paused by, Owner, Reason, Weekly cap (editor-owned); Rubric in force, Last run at, Last run summary (agent); Name (seed).
- **Claims** (13 + 1 reverse): Claim title, Geo ID (key), Geo link, Sources count, Source URLs, Table, Sample (seed); Agent tags (relation), Readiness, Tag confidence, Last judged (agent); Decided applies, Decided does not apply (rollups); Tag decisions (reverse). Views: All claims, Needs editor.
- **Rule changes** (14 + 2 reverse): Status (editor sets Approved/Rejected; agent Live/Rolled back), Editor wording, Approved by (editor); Lesson title, Tag, Rule, Kind, Current text, Proposed text, Rubric version, Gate result (agent); Lesson ID (unique, prefix LS), Created, Owner action (formula); Supporting rows, Result card (reverse). Views: Lessons waiting, Live rules.
- **Tag decisions** (30): editor-owned 5 (Tag outcome, Why wrong, Your reasoning, Decided by, Decided at); agent-owned 14 (Key, Claim, Tag, Agent proposal, Agent confidence, Why I recommend this, Agent full note, Why in queue, Priority, Rubric version, Lesson, In regression suite, Agent follow-up, Follow-up run); seed-only 3 (Seeded outcome, Seeded reasoning, Seeded at); computed 8 (Effective outcome, Direction, Stage, Applied tag, Rejected tag formulas; Tag name, Lesson status, Claim text rollups). Views: 14 on the database tab and 5 on the hub page.
- **Runs** (13, all agent-owned): Run title, Kind (7 values), Rubric version, Started, Claims judged, Canaries, Newly failing, Per-tag summary, Verdict, Summary, Lesson, Cost USD, Model. View: Latest runs.

Counts: 92 declared, 95 visible. The code contract (`allowlist.mjs:19-51`) covers 93; it omits Claim text and Owner action.

Walkthrough sandbox: a separate copy of the six databases under the Walkthrough page's sub-page "Sandbox databases"; relations point at the sandbox data sources; Lesson ID prefix WT; 14 views; the page's Full width cannot be set through the connector.

Over-engineering for an MVP: eleven computed columns with chains (Stage depends on Direction and Lesson status; Direction and Stage were each altered after creation; Applied tag and Rejected tag exist only to feed two Claims rollups); three copies of rule text on Rule changes plus When to use on the Rulebook; overlapping fields (Claim text rollup vs Claim title; Agent full note vs Why I recommend this; Tag confidence vs Agent confidence; Rubric version on four tables); 54 column comments, up to 280 characters each in the sandbox; option values no code writes (Rulebook Status "Retired", Why in queue "Migrated decision"; "Editor challenge" and "Blind check" listed as "later"); the sandbox duplicates all six databases. The code is also large: 37 `.mjs` files, about 683 KB, plus 33 test files; promote.mjs is 66 KB.

## 4. Evals and seed

`evals\cases.jsonl`: 70 rows. Expected: apply 49, do_not_apply 21. Suite: gate 68, mirror-freshness 1 (Unsourced, inactive), not_run 1. Source: queue 36 (27 seeded, 9 editor-decided), research 34. Tags: seven Verified (Context-dependent 11, Hypothetical 11, Predictive 11, Improperly sourced 6, Source inaccessible 5, Unsourced 1, Debate 1); six non-Verified account for 24 rows (Semantically duplicated 12, Wordy 3, Poor wording 3, Exact duplicate 2, Factually challenged 2, Incorrect grammar 2), all inactive. Active 37, inactive 33 (24 non-Verified, 9 contested). Derivation (`cases-sync.mjs` header): every decided queue row becomes a case; expected from the effective outcome; active unless Why wrong is Rule unclear or Rule should change (contested until a lesson is Live); No tag fits or Other gives no case; source-reading tags get suite not_run; hashes re-stamped against the live rubric on every sync.

`evals\canaries.jsonl`: 86 rows, 83 active, 3 inactive and contested. `confirmed_by_editor` false on all. Expected: apply 47, do_not_apply 39. Only the 10 model-judged tags have canaries. 47 are the rubric's own example claims; 39 are counterpart canaries expecting do_not_apply on the paired tag. All 86 texts are verbatim rubric example claims, so none is held out. Hypothetical and Predictive have 4 canaries each, all apply, so over-tagging on those two tags cannot fail a canary. No script writes this file.

`evals\seed\`: claims.seed.jsonl 60 claims, all U.S. Politics (Decided 33, Forecast 17, Random 10; Sources count null for 30); decisions.seed.jsonl 50 rows (Predictive 18, Hypothetical 15, Context-dependent 10, Improperly sourced 6, Unsourced 1; seeded_outcome Applies 17, Does not apply 10, null 23); excluded-decisions.jsonl 24 rows ("tag outside the Rulebook"); sources-fill.json 30 entries; check-by-hand.md header says 9 rows but the table has 11. Reconciling 57: 33 decided on Verified tags seeded as decisions plus 24 decided excluded rows; the other 17 are undecided audit rows seeded as open Auditor flag rows.

## 5. Sandbox

Two tags (Hypothetical, Predictive); 13 claims and 13 seed decisions (9 decided Applies, 4 open); 8 canaries (7 active, all apply); 13 cases, all gate and active (9 apply seeded, 4 do_not_apply editor-decided; Predictive 10, Hypothetical 3). Two rubric versions: Predictive rule 1 replaced by WT-1 in 2026-10-14.2; counterpart_pairs empty. Config identical to the trial's except ids; no setup keys. `walkthrough.json`: tags, decided (6 Predictive, 3 Hypothetical), open (4 Predictive), open_note. `sandbox.mjs init` cuts the trial rubric to the listed tags, copies their canaries, and builds seed rows (decided keys must be trial decisions labelled apply; open keys become Auditor flag rows with no proposal).

"Planted": in code a planted lesson is `distill --demo-bad-lesson` (reads `evals\seed\demo-bad-lesson.json`, skips the model, marks `demo: true`, expects FAIL). The sandbox has no planted lesson file; its planted element is the story (four hedged claims that trial Predictive rule 1 tags wrongly). WT-1 is model-drafted (`demo: false`, Opus, 4 supporting keys). `wt-promote-1\card.json`: PASS, small_sample true, Predictive n 10, 6 positives, lower bound +10 points; Hypothetical n 3, not gated. `wt-followup-1\plan.jsonl`: four rows set Agent follow-up = Fixed. Stale stamp: the sandbox canaries still carry the old Predictive tag_hash and rubric_version 2026-10-14.1 (nothing rewrites canaries), so cases and canaries disagree.

## 6. Schemas

judgment.schema.json requires id, run, text_hash, status, tags (name, decision, p, rule_ref, basis: model | deterministic | no_source_text) and config (driver cli | subagent | fake, model, rubric_version, rubric_hash, scope_hash, prompt_version, config_id); "subagent" has no code path. judge-output.schema.json: array of {id, tags[{name, decision, p, rule_ref, reason ≤400, trigger optional}]}. lesson.schema.json: lesson_key, tag, kind (4), title, current_text, proposed_text, supporting_keys, status (5). plan-op.schema.json: header (plan_id, run_id, created_at); ops (op create | update, seq, database of 6, key, properties). card.schema.json: card_id, kind (gate, smoke, baseline, tag, follow-up, distill; no rollback although Runs Kind has it), verdict, small_sample, conditions (1-5), per_tag, configs, stats. rubric.schema.json: 10 top-level keys, 18 fields per tag, hashes "sha256:" + 16 hex, additionalProperties false.

## 7. Claude settings, subagents and guard

`.claude\settings.json`: allow (34 entries: reads of agents, docs, tests; notion-fetch, query, async-status; node test, npm test; git status, diff, log; `git add agents/claim-tagger`, `git commit`; 21 script wildcards; recard has no entry but is reachable through sandbox.mjs); ask (six Notion write tools); deny (`.env` reads; Write and Edit under `runs/**` and `sandbox/runs/**`; move-pages, duplicate-page, restore-pages; curl; git push); hooks PreToolUse matcher `mcp__.*notion-(create-pages|update-page|create-database|update-data-source|create-view|update-view|move-pages|duplicate-page)` runs `scripts/hooks/guard.mjs`. Naming risk: the entries use `mcp__claude_ai_notion__`; this session's tools carry different prefixes, so those entries may not match (the hook regex still does). Wildcard risk: `status.mjs:*` allows `--unpause --confirm` and `--restore-rulebook --confirm`; `promote.mjs:*` allows `--rollback <lesson> --confirm`. Uncovered: notion-delete-pages and notion-delete-databases. Subagent conflict: the deny under `runs/**` would block the judge and distiller subagents' output. `.claude\launch.json` starts an unrelated static server on port 8791.

`hooks\guard.mjs` (282 lines): PreToolUse hook; never throws. Guards eight tools. Always denied: any call containing a protected database id; page writes naming an editor-owned property or setting Status to Approved or Rejected; move-pages and duplicate-page; extra keys not in the plan; input with no tool_name or an unreadable config. Page writes allowed only when the armed plan matches (`runs\APPLYING.json`, plan sha, check.json, batch files). Schema tools allowed only while `runs\SETUP` exists; setup pages (title-only pages under the hub or Walkthrough parent, content writes on the Walkthrough page only, no child deletes) likewise. Current state: `runs\SETUP` exists (14 Oct, "walkthrough setup 2026-10-14"), so schema and setup allowances are on now; no document says to remove it. `runs\APPLYING.json`, `runs\PAUSED` and `runs\PROMOTE.lock` are absent.

Fallback subagents: `.claude\agents\claim-tagger-judge.md` (sonnet, Read and Write; reads `*.in.json`, writes a judgment array) and `claim-tagger-distiller.md` (opus; reads `*.group.json`, writes a lesson). Not wired: judge.mjs and distill.mjs accept only `--driver cli|fake`; no script writes `*.in.json`; the only group writer writes `output_path: null`.

Other checks: CLAUDE.md's ten hard rules match AGENT.md; the only Notion API host calls are in `lib\notion-rest.mjs` (rule 2); no `--bare` or `--fallback-model` in the scripts (rule 9); `.gitignore` excludes `.env` and `agents/*/runs/`.

## 8. Config (`config.json`, 150 lines)

| Key | Value | Meaning and where read |
|---|---|---|
| agent | claim-tagger | Name of the Agent settings row |
| notion.api_version | 2022-06-28 | Notion-Version header |
| notion.hub_page_id, databases_page_id, engineer_notes_page_id | ids | Not read by any script |
| notion.databases | six entries | database_id, data_source_id, key property per database; write targets |
| notion.protected_database_ids | 9 ids | Real Geo databases and taxonomy, never written |
| notion.requests_per_second | 3 | REST rate limit |
| notion.page_size | 100 | Read page size |
| notion.max_creates_per_call | 100 | Not read (plan.mjs hard-codes MAX_BATCH = 100) |
| notion.max_text | 1900 | Text limit per field |
| notion.setup_page_parents / setup_content_pages | hub and Walkthrough ids | Guard setup allowances |
| notion.walkthrough_page_id | id | Not read |
| models.judge / cheap / distill | sonnet-5-5 / haiku-5-5 / opus-5-5 | |
| judge.runs 3, smoke_runs 1, batch_size 8, concurrency 2, effort medium, max_turns 1, timeout_ms 300000, claude_bin claude, max_error_share 0.1, prompt prompts/judge.md | | |
| thresholds.t_apply 0.75, t_skip 0.25 | | Low confidence band |
| readiness.fix_polarities ["Issue"] | | Applied Issue tags give Fix needed |
| queue.weekly_cap_default 40, why_max_words 40 | | |
| distill.min_claims 2, min_claims_rule_change 3, owner_ruling_at 2, overfit_ngram 8 | | |
| gate.tolerance 0.05, min_positives 5, bootstrap 1000, ci [0.025, 0.975], ungated_flips_hold 1, ungated_flips_fail 3, reconfirm_runs 5 | | reconfirm_max (default 16) not in config |
| anonymise.replacements | 5 pairs | Real names mapped to roles; the names are committed here and in the sandbox config |
| scope.code_decided_tags | Unsourced, Improperly sourced, Source inaccessible | Decided in code |
| scope.human_only_tags | Editor verified | Never model-decided |
| scope.source_reading_tags | Improperly sourced, Source inaccessible | cannot_tell unless 0 sources |

No `propose` section and no `paths` section. The sandbox config differs only in the `_about` line, the page ids, the six database ids, and the missing setup keys.
