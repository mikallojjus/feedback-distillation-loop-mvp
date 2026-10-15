# P3: topic answers, debt list and verification plan (opus Plan agent, 2026-10-14)

Verbatim report. Everything was read-only. Path legend: `S/` = `agents/claim-tagger/scripts/`, `A/` = `agents/claim-tagger/`, `R/` = repo root, `T/` = `tests/`, `RS/` = `X:\work\research\overnight-feedback-loop-research\`.

## 0. Corrections to the notes and the brief

1. **The "21 modified + 3 untracked files uncommitted" item is out of date.** They were committed on 14 Oct at 20:51 as c1e9de6, b3c7788 and d195bd4, and `git status` is clean. There is still no git remote.
2. **8 tags lack rules, not 9.** In the 9 Oct snapshot (`RS/sources/claim-tags-verified.9oct.rows.json`), 8 Issue rows have an empty "When to use": the 2 duplicate tags, Multi-sentence, Trailing period, Improper capitalization, Incorrect grammar, Poor wording and Wordy. 9 are not Verified, because Factually challenged has 4 rules but is still Proposed. The drafting step only needs to cover the 6 text tags; the duplicate tags need no judge rules.
3. **Today's rulebook build would drop 7 of the 13 tags, not 9.** `S/lib/rubric-build.mjs:176` keeps rows that are Verified or have no status. So the 7 Proposed rows vanish and the 2 status-less duplicate rows stay.
4. **Output is about 990 tokens per claim, not 500.** That is the measured figure at 10 model tags. The estimates below show both the brief's number and the measured one.
5. **The sandbox distill group was 4 rows plus 6 other rows** (trial: 4 plus 7), not 4 plus 12.
6. **The stale canary hashes are not only in the sandbox.** 22 of the 86 trial canaries (Factual x10, Multiple statements x8, Predictive x4) carry a tag hash that differs from the live rubric.

### Measured baseline (every estimate below is calibrated on this)

| Measure (Sonnet 5.5, effort medium, 8 claims per call) | Value | Source |
|---|---|---|
| Calls measured | 138 eight-claim calls (199 judge calls in total) | judgment files under `A/runs/judgments`, `A/sandbox/runs/judgments` |
| Input per call | 10.3k tokens: 8.4k cache read + 1.9k cache write + 2 fresh | `call.model_usage` |
| Output per call | 7.5k tokens (p50 7.8k, p90 8.7k, max 9.6k), of which about 1.6k is thinking | same |
| Output per claim | about 990 at 10 model tags; about 335 at 2 tags (sandbox) | works out to about 170 + 82 per tag |
| Duration per call | p50 44 s, p90 51 s, max 60 s (timeout 300 s) | same |
| System prompt (10 tags) | 24,706 bytes, about 6.2k tokens | `A/runs/judgments/f0b5d66f0b36f8e5/system-prompt.md` |
| Notional cost | $0.084 per call, $0.0112 per claim-run (`"costBasis": "list"`, i.e. list price) | same |
| Trial tag run | 60 claims x 3 runs = 24 calls, 556 s, $2.06 | `A/runs/20261013T1800Z-tag-r1/run.json` |
| Trial strict gate | 72 items x 3 runs = 27 candidate calls, about 10 min, $2.29-2.37; baseline $0 (cached); reconfirmation $0.15-0.70 | promote `run.json` files |
| Opus distill call | 4 rows + 6-7 other rows, about 2.1k tokens of row data, $0.084-0.094 | `A/runs/20261013T1845Z-distill-1`, `A/sandbox/runs/wt-distill-1` |
| How often 3 runs disagree on gate cases | 9-23% of cells | trial cards LS-1 and LS-1-e, sandbox WT-1 |
| Busiest 5-hour stretch | 171 calls, 1.76M input (80% cache reads), 1.25M output; no usage-window stop | file times; no `usage_window` row in any ledger or log |

## 1. Topic answers

### 1a. Distillation batch size

**Today**
- Input rows: decided rows whose "Why wrong" is Rule unclear or Rule should change, plus seeded rows whose reasoning starts with "Rule should change:" (`S/distill.mjs:8-12`, `S/cases-sync.mjs:49-51`).
- Grouping: tag x Why wrong x the rule the agent cited (`S/distill.mjs:149-167`).
- Thresholds count distinct claims (`S/distill.mjs:172-179`, `A/config.json:94-99`): Rule unclear needs at least 2; Rule should change needs at least 3, or 2 when the rule owner's approval counts as the ruling.
- Deduplication happens before any model call. A group whose tag and rule already have an open lesson only links its rows to that lesson (`S/distill.mjs:507-525`).
- Calls: one Opus call per group, run one after another (`:500-531`), at most 2 attempts (`:331-363`).
- What the model sees: at most 30 group rows (`MAX_GROUP_ROWS`, `:56, :211`) and at most 12 other rows on the same tag (`MAX_OTHER_ROWS`, `:55, :526-527`). Every text is cut to 600 characters (`:195-198`).
- How the 30 are chosen: rows are sorted by key (`:165`), so the 30 are effectively arbitrary.
- The catch: every unlinked row becomes a "supporting row" of the lesson (`:540`), including rows past the 30 that the model never saw.

**Under the target: 20 vs 200 vs 2,000 decided rows across 13 tags**

Assumptions: 15% of decided rows blame the rule (the trial measured 7 of 38, 18%); 60% of decisions fall on 3 busy tags; each busy tag has 2-4 cited rules.

| Decided rows | Rows blaming the rule | Groups over threshold | Opus calls | Rows cut at 30 | Main risk |
|---|---|---|---|---|---|
| 20 | ~3 | 0-1 | 0-2 | none | usually "nothing to propose" |
| 200 | ~30 | 4-7 | 4-14 | none (groups of about 10 rows or fewer) | fine; only one open lesson per tag and rule, so the rest queue up behind it |
| 2,000 | ~300 | 20-35 | 20-70 | busy groups of 40-100 rows: 10-70 rows unseen per group | one group holds several patterns, so the model writes one compound rule (this is how LS-1 failed: +27-36 points on its own tag, 1-3 cases broken elsewhere); 20-35 lessons land on one editor while the gate takes one at a time |

**Opus cost.** Measured $0.084 and $0.094 per call at 10-11 rows (about 190 tokens per row). At the 30 + 12 row cap, an estimated $0.12-0.20 per call (about 11k input tokens). 5 groups: about $0.45-1.00 notional, 25-55k input tokens. 2,000-row case: about $3-7 notional, 0.2-0.4M input tokens, 20-60 minutes run one after another. Distill is never the token problem. Editor review time and the one-at-a-time gate are.

**Recommendation**
1. Default to one lesson per tag per run, at most 3 per run, ranked by the number of distinct supporting claims.
2. Group by (tag, cited rule) and keep the reason as a field on each row.
3. Let the single Opus call return up to 3 patterns, each with the row keys it rests on. Supporting rows are then only the rows each lesson actually cites.
4. When a group has more than 30 rows: newest first, rows with written reasoning first, both outcomes represented. Record which rows were shown and show the unseen ones next run.
5. Pick the 12 counter-evidence rows by "same rule, opposite outcome" first, not by key order.
6. Add a cheap clustering step only if groups routinely pass about 60 rows.

### 1b. One Claims table or many

**What is hard-coded today**
- Closed table list: `S/allowlist.mjs:16` lists exactly six tables.
- Trial column names: `Claim title`, `Sources count`, `Source URLs`, and `Agent tags` as a relation (`S/allowlist.mjs:25-29`; writable set at `:90`).
- One claims file: `S/pull.mjs:347-358` writes a single `norm/claims.jsonl`. Judge reads it (`S/judge.mjs:207-211`), and so do propose, cases-sync and follow-up.
- Geo ID is the join key everywhere: queue key `<geo_id>::<tag>` (`S/pull.mjs:365`); judgment file `<geo_id>.<text8>.json` (`S/judge.mjs:137-138`); case item = Geo ID (`S/eval.mjs:218`).
- Duplicates fail: a duplicate key makes the pull exit 2 (`S/pull.mjs:416`). One ID with two texts makes judge exit 2 (`S/judge.mjs:194-198`).
- The real mirror looks different: U.S. Politics debate claims (database 7219756338b2416f8fa8af83d75ec47d, 2,351 rows) has `Geo Name` (title), `Geo ID`, and `Geo Sources`, which is text whose names link to Geo entity pages (`RS/sources/notion-qa-workspace.13oct.md` section 3). It has no Agent tags or Agent notes column yet. The pull drops link targets: it keeps plain text only (`S/lib/notion-values.mjs:33, 60`).

**Design: a list of mirrors in config**
```json
"mirrors": [{ "key": "usp", "label": "U.S. Politics debate claims", "enabled": true,
  "database_id": "7219756338b2416f8fa8af83d75ec47d", "data_source_id": "d1307596-e531-420f-8688-2485f3ef28ab",
  "props": { "text": "Geo Name", "geo_id": "Geo ID", "sources": "Geo Sources", "sources_count": null },
  "write_columns": { "tags": "Agent tags", "notes": "Agent notes" } }]
```
- Item ID `usp.<geo_id>` (passes the ID pattern at `S/judge.mjs:54`).
- Queue key `usp.<geo_id>::<tag>`; cases carry both mirror and Geo ID.
- One `norm/claims.<key>.jsonl` per mirror, plus a merged index.

**Is one rulebook with many claims tables sound? Yes.** The judge never sees which table a claim came from (`S/judge.mjs:410-421`), so judgments can be keyed by text hash and shared across tables.

**Pitfalls**
1. The same Geo ID in two mirrors. Key writes, queue rows and cases by (mirror, Geo ID); share judgments by text.
2. Sources differ per mirror. World affairs' `Geo Sources` holds markdown links to geobrowser.io entities and has no count column. U.S. Politics' "Geo Sources (count)" in the 13 Oct sample looks derived. Each mirror needs its own mapping, and the pull must keep link targets.
3. Per-table write allowlist. Only the two text columns may be written on any mirror. Enforce this in plan, apply, the guard hook and the REST client. Once the integration is connected to a mirror it can technically write any column.
4. Linking queue rows to claims. A Notion relation targets one database, and a two-way relation adds a column to the real mirror. Use Mirror + Geo ID + Claim URL on the queue instead, or one-way relations.
5. Hand edits to the agent's columns. Compare with the last value the agent wrote; if a person changed it, skip and report rather than overwrite.
6. One rate limit. 3 requests per second covers all mirrors together.

### 1c. Does distillation separate tag types?

- Distillation: yes. One call per group, and the call sees only that tag's rulebook entry (`S/distill.mjs:200-215`). It cannot see cross-tag effects.
- The judge: no. One system prompt renders every model tag (`S/judge.mjs:299-313`, 24.7 KB). Each call takes 8 claims and must decide every tag for every claim (`S/judge.mjs:477`). A lesson on one tag changes the shared prompt and invalidates every cached judgment (the rubric hash covers all tags: `S/lib/hash.mjs:55-60`). It can also move other tags' answers. The trial confirmed a Context-dependent flip over 8 runs caused by a Predictive change (LS-1 attempt 4).
- The decided two-pass design (estimates): text pass (6 drafted tags + Context-dependent; Trailing period better done in code): system prompt about 10-13 KB (2.6-3.3k tokens), roughly half of today's, still cached; about 5.3k input per call (vs 10.3k today), about 750 output tokens per claim. Source pass: system prompt about 1.4k tokens, cached; up to 3 excerpts x 3k tokens per claim, which cannot be cached across claims; sorting claims by their first source and putting the excerpt first gives some cache hits (the cache lasts 5 minutes).
- Recommendation: two cache groups in the text pass. G1 = Context-dependent alone; G2 = the drafted quality tags; each with its own configuration ID. A Context-dependent lesson then re-judges only G1: about 147 calls at 16 claims per call, about 35 minutes.

### 1d. Tags that need human judgement

**Capability matrix** (9 Oct snapshot; verify against the live table)

| Tag | Status / rules | Capability | Who decides | "Cannot tell" goes to | In gate statistics? |
|---|---|---|---|---|---|
| Context-dependent | Verified, 5 rules, 6 examples | text only | model (text pass, G1) | editor (ask_editor) | yes; the demo tag |
| Poor wording | Proposed, no rules | text only, subjective | model once drafted rules are approved | editor | after approval |
| Wordy | Proposed, no rules, 3 examples | text only, subjective | model | editor | after approval |
| Incorrect grammar | Proposed, no rules; Example Claims holds "255 legacy linked claims..." | text only | model | editor | after approval |
| Improper capitalization | Proposed, no rules, 3 examples | text only, with code hints (all caps, title case) | model + hint | editor | after approval |
| Multi-sentence | Proposed; Polarity is Classification | mostly deterministic; abbreviations need judgement | code, model as fallback | model | only if the model decides it |
| Trailing period | Proposed, no rules | deterministic (ends with "." and is one sentence; "U.S." edge case) | code | — | no (unit tests instead) |
| Exact duplicate | no status | needs a corpus index; within one mirror an exact text-hash match is free | code hint, then editor | silent "not checkable"; queued only on a text-hash match | no |
| Semantically duplicated | no status | needs a corpus plus semantic search; cannot be automated now | editor (search later) | silent, never queued | no |
| Unsourced | Verified | deterministic (no sources) | code | — | no |
| Source inaccessible | Verified | needs a fetch (status code, paywall) | code from the fetch result | — | source gate only |
| Improperly sourced | Verified, 5 rules | needs source text | source pass, model, one call per claim | "not checkable" when no source could be read; queued when the model is unsure | source gate only |
| Factually challenged | Proposed, 4 rules (rule 4: never exercised) | needs source text plus the wider record | source pass, report only | same as above | no (no positives yet) |

**Routing "cannot tell"**: today any "cannot tell" on a non-source tag becomes a Low confidence queue row (`S/propose.mjs:178-183`). Duplicate tags always answer "cannot tell", so the first full pass would create about 2 x 2,351 = 4,702 queue rows. Routing must follow the capability classes in the table.

**Source tags in the queue**: a "Sources checked" text (at most 1,900 characters), one line per source: host, the Geo entity link and the resolved article URL, fetch status (OK, 403, 404, paywall, timeout, PDF), and fetch date. An "Evidence" text: the sentence the judge relied on (at most 300 characters) and the rule it cited. The excerpts exactly as the judge read them go in the page body. A blocked source must never read as a pass (Improperly sourced rule 3).

**Exclude from gate statistics**: both duplicate tags (the gate counts "cannot tell" as a failed case: `S/eval.mjs:36-37`); Unsourced and Trailing period (code-decided); source tags, from text-tag gates; Factually challenged, until it has positives; drafted tags, until their rules are approved.

### 1e. Pricing on the subscription

**How "USD" is produced today**: the CLI result's `total_cost_usd`, or the sum of `modelUsage[*].costUSD` (`S/lib/claude.mjs:353-357`). No local price table. Every `modelUsage` says `"costBasis": "list"`: the figure is what the same tokens would cost on the API. Nothing is billed per call on the subscription (no API key). Tokens are stored only inside each item's judgment file, as a per-batch value copied to every item (`S/judge.mjs:815`). On a retry only the last attempt's usage is kept, while cost is summed (`:846-848`).

**What actually limits the subscription: the usage window.** `claude.mjs` treats any failure whose text matches `/usage limit|rate limit|429|quota|resets|overloaded/i` as the window running out (`S/lib/claude.mjs:27, 369-375`). The run then stops with exit 75 and a resume command. Problem: a passing 429 or "overloaded" error also matches, so a multi-hour run stops instead of retrying. The window size has never been measured: there is no exit 75 anywhere in the trial or sandbox records. The window is shared with the editor's own interactive Claude use.

**Proposal: report usage, not dollars.** Per run, report: calls, input (fresh / cache write / cache read), output (of which thinking), wall time, estimated share of a usage window. The window share comes from a calibration run and from each exit 75. Keep USD only in `run.json`, labelled "list-price equivalent". Implementation: one ledger row per call, with usage summed across attempts; totals in `run.json`; a "Usage" column replaces "Cost USD".

**Estimates.** Assumptions A (the brief): system prompt 6.5k tokens cached + 40 input tokens per claim; 500 output tokens per claim; 8 claims per call; 50 s per call; 2 calls at a time. Assumptions B (measured / estimated): today's 10-tag prompt 10.3k input per call, 990 output per claim, 44 s per call; the target 7-tag prompt about 5.3k input per call and 750 output per claim. A full run over 2,351 claims is 2,351 / 8 = 294 calls.

**Full pass over the U.S. Politics mirror**

| Policy | Calls | Input (A) | Output (A) | Wall clock (A) | Output (B, 7 tags) | Notional (B, 10 tags) |
|---|---|---|---|---|---|---|
| 1 run | 294 | 2.0M (1.9M cache) | 1.18M | 2.0 h | 1.76M | $26 |
| 3 runs (today) | 882 | 6.0M (5.7M cache) | 3.5M | 6.1 h | 5.3M | $79 |
| Adaptive 1.3x | 383 = 294 + 74 + 15 | 2.6M | 1.53M | 2.7 h | 2.29M | $34 |

Adaptive arithmetic: run 2 for 25% of claims (588 claims, 74 calls); run 3 for 5% (118 claims, 15 calls); 3,057 claim-runs in total, which is 1.30x.

**Warning on the 1.3x target.** On the trial tag run, 20.2% of model cells had a confidence between 0.25 and 0.75, and 88% of claims had at least one re-run trigger. With "re-run the whole claim on any trigger", that is about 1.9-2.8x, not 1.3x. Random mirror claims with Issue-only tags will trigger less, but there is no data yet. Calibrate the confidence band, or cap re-runs at about 30% of claims, on the first 200 claims.

**Other scenarios (assumptions A unless noted)**

| Scenario | Calls | Input | Output | Wall clock | Arithmetic |
|---|---|---|---|---|---|
| Weekly 100 new claims, 1 run / 3 runs / adaptive | 13 / 39 / 18 | 89k / 266k / 123k | 50k / 150k / 65k | 5.5 / 16 / 7.5 min | 100 / 8 = 13 calls |
| ...the week a lesson went live (today) | 294-882 | 2.0-6.0M | 1.2-3.5M | 2-6 h | one rubric hash covers every tag |
| ...with per-group cache (G1 only) | 147 | ~0.4M | ~0.6M | ~35 min | 16 claims per call, ~250 output per claim, ~30 s per call |
| Source pass, full mirror | ~950 | ~6.7M (5.2M fresh) | ~0.57M | ~3.3 h + ~25 min fetching | see below |
| Source pass, weekly | ~40 | ~0.28M | ~24k | ~8 min | 100 x 0.57 x 0.71 |
| Distill, 5 groups (Opus) | 5-10 | 25-55k | 5-10k + thinking | 5-8 min | measured about 4.8k input per call |
| Simple gate: 40 cases + 50 canaries | 12 (+0 baseline, cached) | 82k | 45k | 5 min | 90 items / 8; 12 x 6,820 |
| + recommended re-judge of 3 flipped cases | +4 | +27k | +6k | +2 min | 3 cases x 2 runs x 2 sides |
| Strict gate | 46-92 | 0.31-0.63M | 0.16-0.35M | 19-38 min | candidate 36 + baseline 0-36 + reconfirmation 10-20 |

Source pass arithmetic: 57% of claims have sources (from a 100-row sample; on average 3.18 sources each) = 1,340 claims; capped at 3 sources: 2.18 per claim on average = about 2,920 fetches; 71% of sourced claims are checkable (Improperly sourced rule 5) = about 950 model calls; input per call: 1.5k + 40 + 2.18 x 2.5k = about 7.0k tokens; about 600 output; about 25 s per call. At the full 3k-token cap: about 10M input. This is the biggest user of fresh (uncached) input. Selecting only the relevant paragraphs (about 1.5k tokens) roughly halves it.

Strict gate arithmetic: reconfirmation is 5 runs x 2 sides x ceil(flipped cases / 8): 10 calls for 5 flips, 20 for the 16-case cap. Trial reference (LS-1 attempt e): 27 calls, 598 s, $2.32, plus $0.41 for reconfirmation.

**A Claude Code update today.** The CLI version is part of the cache key (`S/judge.mjs:316-327`). Every update throws away every cached judgment: 2-6 hours to re-judge, about $26 notional per run (vs about $4 at trial size). A run stopped by the usage window also cannot resume across an update (`:673-675`).

**Recommendation: drop the CLI version from the cache key.** Keep it recorded in each judgment and in `run.json`. When the version changes, judge the canaries once (about 7 calls) and invalidate only if more than about 5% of answers change. The model ID is still verified on every call. Pinning the CLI instead would fight the desktop app's auto-update on the editor's machine and delay fixes.

**Reconciling the research numbers.** The research's "14 million input tokens per full pass" and "about 1,600 calls and 9 million per gated comparison" assumed one claim per call. Batching 8 claims per call with caching brings that to about 2-3M input per run (80-95% cache reads) and about 12 calls for a simple gate.

### 1f. Scaling to thousands of claims and the full Issue rulebook

1. Throughput. 2 calls at a time, 300 s timeout (the longest measured call was 60 s), 2 attempts per batch, and a run fails if more than 10% of cells error. The real limit is output tokens per usage window, not concurrency: running more calls at once only uses the window up faster.
2. Incremental tagging already works while nothing changes. The cache file name includes the text hash (`judgments/<config16>/run-n/<item>.<text8>.json`, `S/judge.mjs:743`), so unchanged claims are skipped.
3. ...but any single rule change or CLI update re-judges the whole mirror. Fix: a cache key per tag group (model, effort, group prompt, the group's tag hashes), without the CLI version. One tag per call would be exact but costs about 170 output tokens of fixed overhead per claim per call; two text groups is the balance.
4. Gate scaling. Every decided row becomes an active test case (`S/cases-sync.mjs:13-17`). At 2,000 decisions that is about 1,700 cases: about 213 calls (1.5 h) for one run of the candidate side, 640+ calls for the strict gate. Cap it: all cases on the target tag plus at most 20 per other tag in the same group (about 150 items, 19 calls). Canaries must be held out (see debt item 8).
5. Notion. 3 requests per second. Writing all 2,351 claims takes about 784 s, roughly 13 minutes, plus two 24-page reads around it. Weekly writes cover only changed claims (100-300), 1-2 minutes. Reading the mirror is 24 pages of 100 rows.
6. The editor is the real bottleneck. On the trial, 60 hand-picked boundary claims produced 117 Low confidence candidates; the weekly cap held 67 of them back. On the full mirror, assuming 2-5% of the 16,457 tag decisions need a look, the first pass would queue 330-820 rows. At 1-3 minutes per row that is 6-40 hours for one editor. Queue only proposed changes and genuine uncertainty. Offer bulk-confirm views for high-confidence applies. Use a simple "top N per run" instead of the weekly counter.
7. Adaptive runs change what "uncertain" means. Today a 3-run split marks a row Low confidence (`S/propose.mjs:182`). With one run that signal disappears: noisy cells that land confidently on run 1 are never reviewed. Measure it once: judge 100 random claims with 3 runs (about 38 calls) and compare with the adaptive result. Propose must also handle a different number of runs per claim (`S/propose.mjs:119-121, 407`).

## 2. Debt and bugs, ranked

Effort: S = small, M = medium, L = large.

| # | Severity | Effort | Item | Evidence |
|---|---|---|---|---|
| 1 | Blocker | M | The rulebook build drops the 7 Proposed Issue tags and reads trial column names. The copied taxonomy would fail the schema check (exit 4). | `S/lib/rubric-build.mjs:176`; `S/pull.mjs:167-179`; `S/allowlist.mjs:20-24` |
| 2 | Blocker | L | One claims table is hard-coded: closed table list, trial column names, Geo ID as the key, one claims file, the access probe expecting six trial titles, test fixtures. | `S/allowlist.mjs:16, 25-29, 90`; `S/pull.mjs:347-358, 365, 416`; `S/judge.mjs:207-211`; `S/eval.mjs:218`; `S/probe.mjs` EXPECTED_TITLES |
| 3 | Blocker | M | No capability classes. "Cannot tell" on duplicates would queue about 4,700 rows, the gate counts "cannot tell" as a failure, and code-decided tags are limited to Unsourced and the source tags. | `S/propose.mjs:178-183`; `S/eval.mjs:36-37, 227`; `S/judge.mjs:259-271, 377` |
| 4 | Blocker (unverified) | S-L | The mirror has no article URLs. `Geo Sources` links to Geo entity pages, and the pull keeps plain text only. The source pre-fetch has no input until URLs can be resolved. | research schema section 3; `S/lib/notion-values.mjs:33, 60`; `S/pull.mjs:354` |
| 5 | High | S + M | The cache key is too coarse: the CLI version is in it, and the rubric hash covers every tag. Any update or any rule change re-judges the whole mirror. | `S/judge.mjs:316-327, 673-675`; `S/lib/hash.mjs:55-60` |
| 6 | High | S | The usage-window pattern is too broad: a passing 429 or "overloaded" error stops a multi-hour run with exit 75 instead of retrying. | `S/lib/claude.mjs:27, 369-375`; `S/judge.mjs:849-851`; `S/distill.mjs:323` |
| 7 | High | S | The simple gate (1 run per side) has no noise guard. At the measured disagreement rate (4-8% per run on gate cases), comparing 40 cases expects 1.6-2.8 cases that look newly failing by chance, roughly an 80-95% chance of a false FAIL. Re-judge flipped cases twice more on both sides by default (reuse the existing reconfirmation code with 2 runs). | trial and sandbox cards; `S/promote.mjs:308-390` |
| 8 | High | M | Canaries are not held out: 86 of 86 (trial) and 8 of 8 (sandbox) are copied word for word from the rubric's example claims, which the judge prompt shows as positives. Every trial gate passed 83 of 83 on both sides. Under the Issue scope only about 15 examples exist. | `S/judge.mjs:281-284`; `A/evals/canaries.jsonl` |
| 9 | High | S | The permission settings do not match this connector, and some dangerous commands are pre-approved (details below the table). | `R/.claude/settings.json:7, 25, 33, 40, 67`; `S/hooks/guard.mjs:29` |
| 10 | High | S-M | The integration token reaches four real databases: the U.S. Politics mirror, Claims to review, the taxonomy and World affairs. Several protected IDs are data-source IDs, so the probe cannot prove anything about them. Re-sort the list under the target and add a column guard in the REST client. | `R/docs/mvp-2026-10/evidence/token-access-probe.json` |
| 11 | High | S | The `runs/SETUP` marker exists in both the trial and the sandbox (since 14 Oct 14:46), so the guard currently allows schema changes and setup-page writes. | `S/hooks/guard.mjs:201-205` |
| 12 | High | S | The trial's `runs/pull/LATEST` points at a partial pull with no claims file, so `judge --items claims` without `--pull` exits 2. | `S/judge.mjs:158-164`; `S/pull.mjs:414` |
| 13 | High | S | No git remote, and the 61 MB `runs/` folder (judgment cache, run records) is git-ignored: it exists on one disk only. | `git remote -v`; `R/.gitignore` |
| 14 | Medium | S | `promote --smoke` never passes `--smoke` to the judge: it runs full Sonnet and the runs are not marked as smoke. `judge --smoke` hard-codes 1 run while eval and promote read `smoke_runs`. Under the simple gate, delete `promote --smoke` rather than fix it. | `S/promote.mjs:283, 479`; `S/judge.mjs:684`; `S/eval.mjs:422` |
| 15 | Medium | M | Distill picks rows by key order, cuts at 30, but links every row as support. Counter-evidence is also picked by key order. | `S/distill.mjs:165, 211, 526-527, 540` |
| 16 | Medium | S-M | Usage accounting: the ledger records only a cost share, token usage is per batch and loses retries, and the Runs table shows list-price USD. | `S/judge.mjs:744, 815, 846-848`; `S/allowlist.mjs:46` |
| 17 | Medium | M | The guard hook ignores the sandbox profile (it always checks the trial's state), and the sandbox config lacks the setup keys. Needed for a fresh demo page per run. | `S/hooks/guard.mjs:181, 272`; `A/sandbox/config.json` |
| 18 | Medium | S | Taxonomy text pitfalls for the copy (details below the table). | 9 Oct rows; `A/config.json:85-89` |
| 19 | Medium | S-M | The REST client queries `/databases/{id}/query` on the 2022 API version, which fails on a multi-source database. | `S/lib/notion-rest.mjs:188` |
| 20 | Medium | S | The judge prompt hard-codes the old scope ("Tags about sources (...) and Editor verified are decided elsewhere", the example "Predictive rule 1"). | `A/prompts/judge.md` |
| 21 | Medium | S | Dead config keys: `max_creates_per_call` (the batch limit of 100 is hard-coded), and the hub, databases, engineer-notes and walkthrough page IDs. `distill.effort` and `distill.timeout_ms` are read but unset, so Opus runs at the CLI's default effort. | `S/plan.mjs:41`; `S/distill.mjs:315, 318` |
| 22 | Medium | S | The fallback subagents are wired to nothing (the judge only has `cli` and `fake` drivers) and would be blocked by the settings rule that denies writes to `runs/**`. Delete them. | `S/judge.mjs:98-101`; `R/.claude/settings.json:50` |
| 23 | Medium | S | Real people's names are committed in `anonymise.replacements`, in both configs. They become public on the first push. | `A/config.json:112-135` |
| 24 | Medium | S | Text errors in the report and plan (details below the table). | report HTML lines 685, 1814; `parts/02-glance.html:35`; `parts/07-decide.html:22`; `plan.md:27`; `S/eval.mjs:59, 765, 799` |
| 25 | Low | S | Stale canary tag hashes: 22 in the trial, 4 in the sandbox. Nothing updates canary hashes (cases-sync only updates cases); the gate ignores them, so this is informational. | `S/cases-sync.mjs:309` |
| 26 | Low | S | Stale rubric text: `scope_note`, and "tag Neither" (not a valid decision) in four rules. | `A/rubric/rubric.json:27, 315, 325, 536, 546` |
| 27 | Low | S | `stats.wilson` has no caller. `sandbox.mjs` lists `allowlist`, which has no entry point. | `S/lib/stats.mjs:6`; `S/sandbox.mjs:32` |
| 28 | Low | S | Distill sends the example claims twice. Its `run.json` start time is taken after the model calls, so Opus latency is never recorded. | `S/distill.mjs:207, 213, 586` |
| 29 | Low | M | Notion bloat: 92 properties across 6 tables (the queue alone has 30), three copies of rule text, duplicated columns. Rebuild lean rather than patch. | as-built schema |
| 30 | Low | M | Docs: 152 files, about 74% session artifacts. The runbook exists three times (Engineer notes, README, AGENT.md). | `R/docs/mvp-2026-10` |
| — | Resolved | — | The "21 modified + 3 untracked files" item: committed in c1e9de6, b3c7788, d195bd4. | `git status` |

**#9, permission settings.** The allow, ask and deny rules use the prefix `mcp__claude_ai_notion__`, but this connector's tools are named `mcp__16f81eb6-...`. The hook's pattern still matches them; the rules themselves do not. Deleting or restoring pages and deleting databases is covered by no rule. Wildcard rules let the model itself run `status.mjs --unpause --confirm`, `status.mjs --restore-rulebook --confirm` and `promote.mjs --rollback --confirm`. These are meant to be a person's call.

**#18, taxonomy text pitfalls.** Incorrect grammar's Example Claims field holds "255 legacy linked claims...", which would become a fake example and a canary. The two duplicate tags have empty Status and Polarity. Multi-sentence's Polarity is Classification, while "Fix needed" is only triggered by Issue polarity.

**#24, text errors.** The report says 12 tags are judged by the model; it is 10. The plan says "57 decisions seeded"; it was 33 seeded plus 24 excluded. Gate cards say "under 30 labelled positives" while the gate starts gating at 5.

## 3. Verification plan

**Keep as they are:** `T/hash`, `jsonl`, `pyjson`, `rng`, `validate`, `notion-values`, `paths`, `verify`, `stats` (drop the wilson case). Retire `seed`, `seed-build`, `rubric-init` and `snapshot` together with their scripts, or freeze them as history.

**Update:** `claude.test` (split the usage-window patterns); `judge.test` (capability scope, group cache keys without the CLI version, the two passes, adaptive runs); `propose.test` (capability routing, a different number of runs per claim, no weekly cap, the mirror text columns); `eval.test` (today's tests keep running under `--strict`; add the exclusions); `promote.test` (the simple gate, the flipped-case re-judge, `--smoke` removed); `distill.test` (grouping by (tag, rule), rotation, several patterns per reply, support limited to cited rows); `pull.test`, `rubric-build.test` (taxonomy-shaped copy, Issue filter, Example Claims parsing); `allowlist.test`, `plan.test`, `apply.test`, `guard.test` (per-mirror write columns, delete tools, profile-aware guard); `probe.test` (the expected set of reachable databases); `cases-sync.test`, `followup.test` (keys that include the mirror); `status.test` (usage report); `sandbox.test` (becomes a demo-profile test).

**New tests:** `T/multi-mirror-pull.test.mjs` (two mirrors with different column names, one shared Geo ID and one shared text); `T/mirror-write-allowlist.test.mjs` (any column other than Agent tags or Agent notes is refused at plan, apply, guard and REST-client level); `T/sources-cache.test.mjs` (a fake fetch returning 200, 403, 404, timeout, paywall and PDF, plus Geo entity to article URL resolution; cache by URL hash; excerpt cap; no network); `T/adaptive-runs.test.mjs` (run 1 for all claims, run 2 only on triggers, run 3 only on disagreement; one ledger row per call with summed usage; resume after exit 75); `T/simple-gate.test.mjs` (canaries pass, no decided claim newly fails, supporting claims fixed; a cached baseline costs 0 calls; the re-judge of flips; excluded tags); `T/draft-rules.test.mjs` (the fake model drafts rules, which become Rule changes rows with status Proposed; a tag is report-only until its rules are approved; the original taxonomy is never written); `T/capability.test.mjs` (duplicate "cannot tell" is never queued).

**Test fixture changes:** `fake-notion.mjs` (the set of databases comes from config); mirror fixtures `db.mirror-usp.json` built from research schema section 3, `db.mirror-wa.json` with sources as links and no count; `db.rulebook-copy.json` (the 13 taxonomy rows, including the empty-status rows, the non-example text and the Classification polarity); helpers: a request-log assertion ("no write outside the allowed columns or to a protected ID"), a simulated multi-source 400, one-way relations; `fake-claude.mjs`: per-call usage, a 429/overloaded mode, and a "usage limit... resets 3pm" mode.

**First real check: a read-only dry run on the real mirror.** 1. Fetch the mirror's schema only (one request). 2. Do a full pull with a read-only client that throws on anything other than a read or query. 3. Report: number of rows (about 2,351) and requests used (about 24); whether the column mapping resolves; duplicate Geo IDs; how `Geo Sources` parses (link count, 20 sample links); whether the database is multi-source; whether Agent tags and Agent notes columns exist. 4. Confirm that no write was ever armed. 5. Optional next step: judge 16 claims (2 calls) on the new Issue rubric to measure tokens per call and output per claim on the real prompt.

**Acceptance test: the Context-dependent walkthrough, end to end.** Setup: a fresh demo page under a parent the editor picks. The story: the queue shows only the story's rows; the editor decides 3-4 rows as "Rule unclear"; distill proposes one Context-dependent lesson, and the editor approves it; the simple gate passes; follow-up shows the supporting rows as Fixed. Checks: every skill report follows the template and gives usage per step; the request log shows no touch on the real mirror or the taxonomy; the demo page is left in place.

**Headless check of the skill reports.** Run each subcommand (status, then the walkthrough's tag, distill, promote and follow-up) with `MSYS_NO_PATHCONV=1 claude -p "/claim-tagger status" --settings .claude/settings.json --permission-mode acceptEdits --output-format stream-json --verbose`. Then use `S/transcript-check.mjs` plus a new assertion. The final message must: follow the template (what ran / result / one "Next:" command); be about 12 lines or fewer; contain no Insight block and no JSON; show no writes to editor-owned fields and only allowed tools.

**Before the first full pass:** a usage-window calibration run; a deliberate stop and resume (exit 75).

## 4. Could not verify / needs Mika

- Where the source URLs come from. `Geo Sources` links to Geo entity pages, not publisher pages. Is there a Geo API or a Sources table with the original URLs? Without one, the source pre-fetch has nothing to fetch.
- The usage-window size and plan tier. The window was never hit. The busiest observed stretch (171 calls, 1.25M output tokens) is only a lower bound, and the window is shared with the editor's own interactive use.
- The live taxonomy rows. Status, Polarity (is Multi-sentence really Classification?), Example Claims, and whether 8 or 9 tags still lack rules. The matrix uses the 9 Oct snapshot plus Source inaccessible.
- Writing to the real mirror. Who adds the two columns to it? Does the Geo-to-Notion sync keep extra columns and page IDs? Should Claims to review be disconnected from the integration, and should World affairs stay read-only until it is enabled?
- Can one Geo entity appear in two mirrors? This decides whether every key must carry the mirror name.
- Is the U.S. Politics database single-source? The REST client uses the 2022 API.
- Adaptive trigger meaning. With 13 Issue tags, "applied Issue tag" means any apply. The trial data suggests 1.3x needs a narrower band or a re-run cap. Mika should also confirm the default gate keeps a 2-run re-judge of flipped cases, contrary to "reconfirmation only behind `--strict`".
- Acceptable editor inflow. The estimate is 330-820 rows on the first pass. How many rows a week is acceptable, and is bulk-confirming high-confidence applies acceptable?

Critical files for implementation: `scripts/judge.mjs`, `scripts/pull.mjs`, `scripts/allowlist.mjs`, `scripts/propose.mjs`, `scripts/lib/rubric-build.mjs`.
