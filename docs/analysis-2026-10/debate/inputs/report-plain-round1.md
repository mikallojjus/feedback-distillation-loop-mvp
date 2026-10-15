# Report text, Plain layer only (generated from claim-tagger-analysis.html)

# Tab: Summary

## At a glance
# The MVP in numbers
12,236
lines of script code
22 + 14
scripts and library modules, plus one hook
832
unit tests in 33 files, none calling a model
92
Notion properties in 6 databases
40
Notion views, trial and sandbox
13
Issue tags in the target: 4 Verified with rules, 1 of them decided from the text alone
$13.88
trial model spend at list price, $10.44 of it in the gate
5 of 5
gate attempts on the first lesson, LS-1, that ended in FAIL
The loop itself is sound. The weight sits around it: Notion columns nobody needs to read, statistics the data cannot support yet, and a cache that makes every rule change expensive. The trial spent 75% of its model budget in the gate.
Where to read next
Question | Tab
Which parts earn their keep, and which cost tokens for little gain? | Features ranked
What is broken or will break on the new target? | Debt and bugs
What does the smallest working version look like, and what comes later? | Minimal and optimal
Batch size, many claims tables, per-tag judging, human-only tags, cost, scale | Your questions
How does it reach the editor, week by week? | Path to editors

## What changes for the editor
# What changes for the editor
The editor's job stays the same: decide the tags the agent is unsure about, and approve rule changes. What changes is how much there is to look at.
Item | Today (the MVP) | Minimal version
Queue columns | 30 | 12
Columns the editor fills | 5 | 3
Computed columns | 6 formulas, 5 rollups | none
Views | 40 | 4
Values to learn in the select and status columns | 32 | 8
The claim on a row | a link to open | the row's title
New rows | a weekly cap of 40, three priority tiers | at most 50 per run, least certain first (pending your confirmation)
Skill reports | 3 to 6 paragraphs, a table, an explanatory block | one sentence, one table of at most 5 rows, one "Next:" line
Learning it | a page with rows to leave undecided and pasted wording | a fresh practice page: 7 real claims, 7 steps, about 30 minutes
The four views are Your queue, Needs your note, Lessons waiting and the Rulebook. The weekly time budget is on Path to editors.


# Tab: Features ranked

## Ranking
# The verdicts
31
Keep as they are, or with a small fix
15
Simplify to a smaller form
22
Cut from the loop
3
Later behind the strict gate
2
Add as new features
All 73 features · sorted by rank (5 = the loop cannot work without it, 1 = it can go), then in pipeline order
Rank | Feature | What it adds | Verdict | Why
5 | Judge runner: batched model calls, checked replies, one retry, resume | The only source of tag decisions | Keep | Core.
5 | Usage-window stop and resume | Survives subscription limits | Keep | Fix the pattern: a passing 429 or "overloaded" error now ends the whole run.
5 | Queue rows, one per claim and tag | The editor's work surface | Simplify | Keep the rows; trim 30 columns to 12.
5 | Plans as the only write path | Reviewable, resumable writes (hard rule 1) | Keep | Core.
5 | Allowlist | What may be written where | Keep | The only thing holding a real database to two columns. Rewrite for the new tables and the mirror.
5 | Read-back and verify | Every write checked (hard rule 6) | Keep | Costs one filtered pull per write.
5 | Never-twice creates, retry by key | No duplicate rows | Keep | Needed at scale.
5 | Protected ids and probe | The token cannot reach the real databases | Keep | Three classes now: protected, mirror, configured.
5 | Pause, a file and a Notion switch | A stop switch (hard rule 7) | Keep | Core.
5 | Pull: schema, raw rows, normalised rows, id map | Local truth for every step | Keep | Add the mirror list, filtered columns and a limit on kept pulls: a full mirror pull is tens of MB.
5 | Drift check, rulebook against the rubric file | Rules cannot change behind the rubric | Keep | Needed for the swap. Enforced only for tags that have rules.
5 | Distill groups and the Opus call | Turns decisions into lessons | Keep | Group by tag and cited rule (batch size).
5 | Cases sync: the regression cases | Every decision becomes a test | Keep | As a library and a local file, with no Notion writes.
5 | Draft-rules mode (new) | First rules for the tags that have none | Add | Decision D7: 6 text tags, one Opus call each, once.
5 | Candidate build: versions and history | The only way a rule changes | Keep | Core.
5 | Canary condition | The rulebook's examples stay right | Keep | For the changed tag only.
5 | No decided claim newly fails | No regression | Keep | For the changed tag only.
5 | Supporting claims come out as decided (new) | The lesson does what it claims | Add | Replaces the statistical target test in the simple gate.
5 | Finalize: Notion first, then files | The rubric changes only after Notion shows it | Keep | Core.
5 | Status: preflight and report | What waits for whom | Keep | Drop the Stage counts.
4 | Cache keyed by the whole rubric and the CLI version | Free re-runs when nothing changed | Simplify | Any lesson or CLI update re-judges every tag on every claim. Key per tag group; record the CLI version instead.
4 | 8 claims and all tags per call | One shared prompt per batch | Keep | For the text pass; group claims by the tags they still need.
4 | Tags decided in code | Answers without tokens | Keep | Extend to fetch results.
4 | Notion contract: column types and options | Catches renamed columns and options | Simplify | Shrink to the new columns.
4 | Restore the rulebook from the file | Recovers from drift | Keep | Behind a person's confirmation (Permissions).
4 | Duplicate-lesson and copied-text checks | No duplicate or claim-specific lessons | Keep | Cheap.
4 | No apply on unjudged or human-only tags | Safety | Keep | Free.
4 | Rollback | Undo the last live lesson | Keep | One editor needs an undo.
4 | Follow-up: Fixed or Still wrong | Closes the loop | Keep | Reads the gate's cached answers; runs right after a PASS.
4 | Agent settings (9 columns) | Switches | Simplify | 4 columns: Name, Paused, Rubric in force, Last run summary.
4 | Profiles: a root folder per copy | A second copy of the loop | Keep | The walkthrough needs it. Rename the sandbox script to profile.
4 | Probe | Checks what the token can reach | Keep | Adapt to the three classes.
4 | Guard hook | The session cannot write Notion through the connector | Simplify | Deny every connector page write; schema tools only during setup.
4 | Permission settings | Prompts and denials | Keep | Fix them: the connector prefix is wrong, and wildcards let the model unpause and roll back.
3 | Three runs and a majority per answer | Removes noise | Simplify | Most answers are a confident "does not apply". Adaptive runs instead (decision D13).
3 | Agent confidence | Sort key | Keep | A number on the queue, text in the notes.
3 | Gate evidence (334 lines) | Proves a rule write came from a PASS | Simplify | The risk is real, but three of the columns it checks are gone: about 120 lines.
3 | Promote lock and in-flight record | One promote at a time | Simplify | Two files for one state: merge them.
3 | Abort | Cleans up a dead promote | Keep | Merged with the lock.
2 | Counterpart-pair check | A forced choice between paired tags | Keep | Idle, as no Issue tags are paired, and free.
2 | Smoke mode: cheap model, one run | A model check | Simplify | Keep it in the judge and the model check; remove it from promote and eval, where it has two bugs.
2 | Readiness on Claims | A status per claim | Simplify | Becomes the first word of Agent notes: the mirror takes two text columns only.
2 | Weekly cap and its counter file | Limits the editor's load | Cut | A limit per run, with no state (decision D4).
2 | Agent proposal (5 values) | Wording relative to current tags | Simplify | Applies, Does not apply, Can't tell: the same words as Tag outcome.
2 | Seeded outcomes in the queue | Audit decisions inside the queue | Cut | Audit decisions go to local test cases and the draft-rules input.
2 | "Rule changed" detection | Re-review after a rule change | Cut | The proposal updates itself. Only the Rubric version column stays.
2 | Plan arming before apply | Binds the connector write path | Cut | Apply runs the check itself; the connector write path is gone.
2 | Trust breaker: pause on a changed editor field | Catches editor fields changed during a write | Simplify | Warn only. With one editor it fires on their own clicks and stalls a long write.
2 | Distill thresholds with a rule-owner route | An evidence bar | Simplify | One threshold, 2 distinct claims: the editor is the rule owner.
2 | Second distill plan and the Lesson relation | Ties rows to lessons | Cut | A Supporting rows text column: one plan, not two.
2 | Bootstrap intervals, tolerance, ungated flips | A statistical guard | Later | Behind --strict: samples are tiny today, and it needs 3 runs per side.
2 | Reconfirmation: extra runs per flipped case | Fights borderline noise | Later | The biggest sink per lesson: gates cost $10.44 of the trial's $13.88. A light 2-run re-judge stays in the default gate (pending).
2 | Follow-up regression over other rows | Re-checks other decisions | Cut | Duplicate work: the gate already checked them.
2 | Run cards and the Runs database | Run history in Notion | Cut | Local cards, the Last run summary and the lesson's Gate result instead.
2 | Views (40) | Navigation | Simplify | 4 views.
2 | Column descriptions (54) | Guidance | Simplify | Short ones on about 25 columns.
2 | Python-compatible hashes | Reproduces the research hashes | Keep | Optional later: a fresh rubric does not need them.
1 | Priority tiers | Row order | Cut | Sort by how unsure the agent is (decision D4).
1 | Why in queue (7 values) | Says why a row exists | Cut | Vocabulary load.
1 | Agent full note | A per-run log in Notion | Cut | Stays in local files.
1 | Connector batch files | Apply without a token | Cut | The pull needs the token anyway.
1 | "In regression suite" column | Tells the editor a decision became a test | Cut | An extra write every run.
1 | Planted bad lesson | A planted FAIL for demos | Cut | A demo crutch.
1 | "Small sample" flag | Honesty about sample size | Later | Strict only. Fix the constant: the card says 30, the gate uses 5.
1 | Seed builder (897 lines) | Research export to seed files | Cut | Research-specific. Keep its one link parser in the library.
1 | Seed script, three phases | Fills the trial databases | Cut | Replaced by a setup script: the mirror is real now.
1 | Rubric init | Research fixture to rubric file | Cut | Replaced by setup, which builds the rubric from the copy.
1 | Snapshot and transcript check | Evidence for the MVP report | Cut | Report-only.
1 | Fallback subagents | A judge without the CLI | Cut | Wired to nothing, and blocked by a deny rule.
1 | Formulas: Effective outcome, Direction, Stage, Applied tag, Rejected tag | A computed lifecycle | Cut | Stage alone has 7 values to learn.
1 | Rollups | Display | Cut | Tag is a select; the claim text is the title.
1 | Owner action formula | What the rule owner must do | Cut | A view on Status does it.
1 | Evidence snapshots and the MVP report build | MVP artifacts | Cut | Archive. This report reuses the theme.


# Tab: Debt and bugs

## Ranked list
# Debt and bugs, ranked
4
Blocker stops the new target
9
High a real risk now
11
Medium fix while touching the code
6
Low tidy-up
All 30 items · effort: S small, M medium, L large · paths are under agents/claim-tagger/scripts unless they start with a folder
ID | Severity | What breaks | Effort | Where
1 | Blocker | The rulebook build keeps only Verified rows and reads the trial's column names, so a copy of the taxonomy loses its 7 Proposed Issue tags and fails the schema check. | M | lib/rubric-build.mjs, pull.mjs, allowlist.mjs
2 | Blocker | One claims table is hard-coded: a closed table list, the trial's column names, Geo ID as the only key, one claims file, the probe's six expected titles, the test fixtures. The real mirror does not fit. | L | allowlist.mjs, pull.mjs, judge.mjs, eval.mjs, probe.mjs
3 | Blocker | No capability classes. "Cannot tell" on the two duplicate tags would queue about 4,700 rows, the gate counts "cannot tell" as a failure, and only Unsourced and the source tags can be decided in code. | M | propose.mjs, eval.mjs, judge.mjs
4 | Blocker | The mirror has no article addresses: Geo Sources links to Geo source pages, and the pull keeps plain text only. Source fetching has nothing to fetch until each link resolves to its Web URL. Not yet verified end to end. | S to L | lib/notion-values.mjs, pull.mjs
5 | High | The cache key is too coarse: it holds the CLI version, and one hash covers every tag. Any update or rule change re-judges the whole mirror. | S + M | judge.mjs, lib/hash.mjs
6 | High | The usage-window pattern is too broad: a passing 429 or "overloaded" error stops a run of several hours instead of retrying. | S | lib/claude.mjs, judge.mjs, distill.mjs
7 | High | A one-run simple gate has no noise guard. With 40 cases, 1.6 to 2.8 look newly failing by chance: a false FAIL 80 to 95% of the time. Fix: judge every flipped case twice more on both sides. | S | promote.mjs
8 | High | Canaries are not held out: all 86 trial canaries are the rubric's own example claims, which the judge prompt shows as examples. Every trial gate passed 83 of 83 on both sides. Under the Issue scope only about 15 examples exist. | M | judge.mjs, evals/canaries.jsonl
9 | High | The permission settings do not match the connector, and commands meant for a person are pre-approved (Permissions). | S | .claude/settings.json, hooks/guard.mjs
10 | High | The integration token reaches 4 real databases: the U.S. Politics mirror, Claims to review, the taxonomy and World affairs. Several protected ids are of a kind the probe cannot test. | S to M | config.json, the token probe
11 | High | The setup marker runs/SETUP exists in the trial and the sandbox, so the guard allows schema changes and setup-page writes right now. | S | hooks/guard.mjs
12 | High | The trial's latest-pull pointer names a partial pull with no claims file, so a judge run without an explicit pull stops. | S | judge.mjs, pull.mjs
13 | High | No git remote, and the 61 MB runs folder (answer cache, run records) is git-ignored: it exists on one disk only. | S | .gitignore
14 | Medium | Promote's smoke mode runs the full model and does not mark the run; the judge's smoke mode hard-codes one run. Delete promote's smoke mode under the simple gate. | S | promote.mjs, judge.mjs, eval.mjs
15 | Medium | Distill picks rows in key order and cuts at 30, but links every row as support; counter-evidence is also picked in key order. | M | distill.mjs
16 | Medium | Usage accounting: the ledger keeps a cost share only, token usage is per batch and loses retries, and the Runs table shows list-price dollars. | S to M | judge.mjs, allowlist.mjs
17 | Medium | The guard hook ignores the sandbox profile, and the sandbox config lacks the setup keys. A fresh demo page per run needs both. | M | hooks/guard.mjs, sandbox/config.json
18 | Medium | Taxonomy text pitfalls for the copy: Incorrect grammar's example field holds a note, not claims; the duplicate tags have no Status or Polarity; Multi-sentence's Polarity is Classification, which never triggers "Fix needed". | S | the taxonomy rows, config.json
19 | Medium | The REST client queries databases on the 2022 API version, which fails on a database with several data sources. | S to M | lib/notion-rest.mjs
20 | Medium | The judge prompt hard-codes the old scope: source tags and Editor verified "decided elsewhere", and a Predictive example. | S | prompts/judge.md
21 | Medium | Dead config keys: the batch limit is hard-coded, and four page ids have no reader. The distill effort and timeout are unset, so Opus runs at the CLI's default effort. | S | plan.mjs, distill.mjs
22 | Medium | The fallback subagents are wired to nothing, and a deny rule would block their output. Delete them. | S | .claude/agents/
23 | Medium | Real people's names are committed in the anonymisation list of both configs. They become public on the first push. | S | config.json, sandbox/config.json
24 | Medium | Text errors in the MVP report, the plan and the gate cards (Doc and text errors). | S | docs/mvp-2026-10, eval.mjs
25 | Low | Stale canary fingerprints: 22 in the trial, 4 in the sandbox. Nothing updates them; the gate ignores them. | S | cases-sync.mjs
26 | Low | Stale rubric text: a scope note that no longer holds, and "tag Neither", not a valid decision, in 4 rules. | S | rubric/rubric.json
27 | Low | A statistics function with no caller; the sandbox script lists a module that cannot run. | S | lib/stats.mjs, sandbox.mjs
28 | Low | Distill sends the example claims twice, and records its start time after the model calls. | S | distill.mjs
29 | Low | Notion bloat: 92 properties across 6 tables, 30 on the queue alone, three copies of rule text. Rebuild lean rather than patch. | M | schemas/notion/as-built.md
30 | Low | Docs: 152 files, 74% of them session records; the runbook exists three times. | M | docs/mvp-2026-10
Resolved since the first notes: the 21 modified and 3 untracked sandbox files are committed (c1e9de6, b3c7788, d195bd4).


# Tab: Minimal and optimal

## Side by side
# Minimal, optimal and today, side by side
Item | Minimal | Optimal | Today
Scripts | 17 and a hook | The same, plus a duplicate search (O6) and scheduled runs (O10) | 22, 14 library modules and a hook
Notion databases | 4: rulebook copy, queue, rule changes, settings; plus two text columns on the mirror | The same, with the real taxonomy as the rulebook (O7) and World affairs as a second mirror (O5) | 6 in the trial, 6 more in the sandbox
Queue columns | 12 | 12, plus an Editor column when a second editor joins (O9) | 30
Formulas, rollups | None; one optional "Overruled" checkbox | None | 6 formulas, 5 rollups
Views | 4 | 4, plus one per editor | 40
Judge runs | Adaptive: one run, re-run only uncertain answers | Adaptive, with thresholds set per tag from decided rows (O8) | 3 runs for every answer
Gate | Simple, plus a 2-run re-judge of flipped cases (pending your confirmation) | Strict as routine once a tag has 30 decided positives, and before the swap (O1) | Strict: bootstrap intervals and 5-run reconfirmation
Cache | Per tag group; the CLI version recorded, not keyed | Per group, plus a whole-pass cache for strict runs (O1) | Whole rubric plus CLI version
Tags the model judges | Context-dependent first; drafted text tags as their rules pass; source tags once links resolve | All 13: duplicates by search (O6), mechanical tags in code (O3) | 10 of the trial's 14
Claims | The U.S. Politics mirror, 2,351 | Plus World affairs (O5) | A 60-claim trial copy
A full pass | 383 calls, about 2.7 h | The same | 882 calls, about 6.1 h
A Context-dependent rule change | Re-judges its group: 147 calls, about 35 min | The same | Re-judges every claim and every tag
Safety checks | Allowlist, read-back, drift, pause, protected ids, guard hook, slimmer gate evidence | The same, plus the strict gate | The same, plus a pausing trust breaker, plan arming and connector batches

## The minimal loop
# The minimal loop
[figure]
The editor runs one skill. tag judges the mirror's claims against the rulebook copy, writes two text columns on the mirror and sends uncertain tags to the queue. The editor decides them. distill drafts a rule change from decisions that blame a rule, and the editor approves it. promote gates it and writes the new rule only on a PASS; follow-up then re-checks the claims behind it. status says what waits, and the Paused switch stops every command. Outlines show who writes.
What each command reads and writes
Command | Reads | Writes | Next
status | Every table, freshly pulled | Nothing | What the report's "Next:" line says
tag | The mirror's claims, the rulebook copy | Agent tags and Agent notes on the mirror; at most 50 new queue rows | The editor decides the rows
distill | Decided rows whose Why wrong blames a rule | One Rule changes row per group, Proposed | The editor approves or rewords
promote | An Approved rule change | On a PASS: the rule in the copy, the change Live, Rubric in force | follow-up, run right after
follow-up | The cached answers for the lesson's claims | Follow-up on their queue rows: Fixed or Still wrong | Nothing
Three more subcommands run rarely: setup once, draft-rules once per tag without rules, and rollback when a live rule must be undone.


# Tab: Your questions

## Batch size
# How big should a distillation batch be?
Short answer. Batch size is not the cost problem. Distill makes one Opus call per group of decisions, at about $0.084 to 0.094 a call. What needs a limit is the editor's attention and the gate, which tests one lesson at a time. Default to one lesson per tag per run and at most 3 per run, ranked by how many claims support each.
# How it works today
Setting | Today
A group | tag, Why wrong and the rule the agent cited
Rule unclear needs | 2 distinct claims
Rule should change needs | 3 distinct claims, or 2 with the rule owner's ruling
Rows the model sees per group | 30 group rows and 12 other rows on the tag
Text per field | cut at 600 characters
Calls per group | one, at most 2 attempts
Which rows the model sees | the first in key order, so effectively arbitrary; rows past the cut still count as support
# At 20, 200 and 2,000 decided rows
Assumed: 15% of decided rows blame the rule (the trial: 7 of 38); 60% of decisions fall on 3 busy tags, each with 2 to 4 cited rules
Decided rows | Blame the rule | Groups | Opus calls | Rows past the cut | Main risk
20 | about 3 | 0 to 1 | 0 to 2 | none | Usually nothing to propose.
200 | about 30 | 4 to 7 | 4 to 14 | none: groups of about 10 rows or fewer | Fine. Only one open lesson per tag and rule, so the rest wait behind it.
2,000 | about 300 | 20 to 35 | 20 to 70 | busy groups of 40 to 100 rows: 10 to 70 unseen per group | One group holds several patterns, and the model writes one compound rule: how LS-1 failed. 20 to 35 lessons land on one editor while the gate takes them one at a time.
# What a distill call costs
Case | Opus calls | Input tokens | List price | Time
Measured, 10 to 11 rows (about 190 tokens a row) | one | about 2.1k | $0.084 to 0.094 | not recorded
At the cap of 30 + 12 rows | one | about 11k | $0.12 to 0.20 | not measured
5 groups | 5 to 10 | 25k to 55k | $0.45 to 1.00 | 5 to 8 min
2,000 decided rows | 20 to 70 | 0.2M to 0.4M | $3 to 7 | 20 to 60 min
# Recommendation
- One lesson per tag per run, at most 3 per run, ranked by distinct supporting claims.
- Group by tag and cited rule, and keep the reason on each row. When the editor names a rule in Your reasoning, that rule wins over the one the agent cited.
- One Opus call may return up to 3 patterns, each with the rows it rests on. Only those rows count as support.
- Over 30 rows: newest first, rows with written reasoning first, both outcomes shown. Record which rows were shown and show the rest next run.
- Counter-evidence: the same rule with the opposite outcome first, not key order.
- Keep the threshold of 2 distinct claims and the checks against duplicate lessons and copied claim text.
# What would change this answer
- Groups routinely past about 60 rows: add a cheap clustering step before the Opus call.
- The editor can review more lessons a week, or the gate can test several at once: raise the cap per run.
- Most decisions turn out to be agent slips rather than rule problems: there are few groups, and distill runs rarely.

## One table or many
# One Claims table or many?
Short answer. One rulebook over many claims tables is sound: the judge never sees which table a claim came from, so answers can be keyed by the claim's text and shared. Today's code, though, hard-codes a single trial claims table in many places. The fix is a list of mirrors in the config: U.S. Politics first, World affairs later as one more entry.
# What is hard-coded today
Where | What it assumes
allowlist.mjs | A closed list of six tables, and the trial's column names: Claim title, Sources count, Source URLs, Agent tags as a relation.
pull.mjs | One claims file. A duplicate key stops the pull.
judge, propose, cases-sync, followup | Read that one file. One Geo ID with two texts stops the judge.
Queue keys, answer files, test cases | Geo ID is the only key.
probe.mjs | Expects the six trial table titles.
lib/notion-values.mjs | Keeps plain text and drops link targets, so the Geo Sources links are lost.
# The design: a list of mirrors
The first entry · each mirror maps its own column names
Setting | U.S. Politics debate claims
Key | Geo ID
Claim text | Geo Name
Link to the claim in Geo | Geo URL
Sources | Geo Sources: links to Geo source pages
Columns the agent writes | Agent tags, Agent notes; text only
Rows | 2,351
- Every claims row carries its mirror. A duplicate Geo ID inside one mirror is an error; across mirrors it is allowed.
- Answers are shared by claim text: a claim in two mirrors is judged once and written to both.
- The architecture plan keeps one queue row per Geo ID and tag, so the editor never decides the same claim twice. The scaling analysis would key rows by mirror too. Which one is needed depends on a check not yet made: can one Geo ID appear in both mirrors?
# Why one rulebook and many mirrors is sound
- The judge's input is the claim text and the rules; the table's name is not in the prompt.
- One rulebook means one gate and one set of tests for every mirror.
- World affairs then costs one config entry, not a second copy of the loop.
# Pitfalls
Pitfall | How the design handles it
The same Geo ID in two mirrors | Writes go to each mirror page; the answer is shared by text.
Sources differ per mirror | World affairs holds its sources as links with no count. Each mirror has its own column map, and the pull keeps link targets.
Writing to a real table | Once connected, the integration could write any column. Only the two text columns are allowed, checked in the plan, at apply, in the guard hook and in the REST client.
Linking queue rows to claims | A two-way relation would add a column to the real mirror. The queue carries a Claim link instead.
Hand edits to the agent's columns | Compare with the last value the agent wrote; if a person changed it, skip and report.
One rate limit | 3 requests a second covers all mirrors together.
# What would change this answer
- The Geo-to-Notion sync drops added columns or recreates pages: the agent's two columns cannot live on the mirror; keep them in an agent table keyed by Geo ID instead.
- One Geo ID can appear in both mirrors with different text: queue rows must carry the mirror as well.
- The mirror turns out to hold several data sources: the REST client's 2022 query path fails there and must move to the newer API first.

## Per-tag judging
# Distillation is per tag. Should the judge be too?
Short answer. Distillation already works one tag at a time. The judge does not: one call decides every tag for 8 claims under one shared prompt. So a lesson on one tag throws away every cached answer, and it can move answers on other tags. That interference is what stopped LS-1. The design splits the judge into a text pass and a source pass, and the text pass into cache groups, so a rule change re-judges only its own group.
# Today and the design
| Distillation | Judge today | Judge, designed
Unit of work | One group: a tag and a rule | 8 claims, every model tag | Text pass: 8 to 16 claims, one group's tags. Source pass: one claim.
The prompt holds | One tag's rulebook entry | The rules of all 10 model tags | One group's rules
A lesson on one tag | Not applicable | Invalidates every cached answer; can move other tags | Re-judges its group only
Effects across tags | Not visible | Happen, and the gate catches them | Not visible between groups; the strict gate checks them
# Two passes, three groups
Group | Tags | Per call | Re-judged when
G1, text | Context-dependent | 16 claims | its rules change
G2, text | The 6 drafted text tags: Wordy, Poor wording, Incorrect grammar, Improper capitalization, Multi-sentence, Trailing period | 8 claims | one of their rules changes
S, sources | Improperly sourced, Source inaccessible, Factually challenged | one claim, up to 3 excerpts | a rule or the claim's sources change
Code | Unsourced; later Trailing period and Multi-sentence (O3) | no model call | never
# Prompt sizes
Prompt | System prompt | Input per call | Output per claim
Today, 10 tags | 24,706 bytes, about 6.2k tokens | 10.3k, of which 8.4k cached | about 990
Text pass, 7 tags | 10 to 13 KB, 2.6k to 3.3k tokens | about 5.3k | about 750
G1 alone | not estimated | not estimated | about 250
Source pass | about 1.4k tokens | about 7.0k, excerpts not cacheable across claims | about 600
Output per claim is about 170 tokens of fixed overhead plus 82 per tag. That fixed part is why one tag per call costs more than two groups.
# What a Context-dependent lesson costs
| Calls | Wall clock
Today: the whole mirror, every tag | 294 to 882 | 2 to 6 h
With G1 alone | 147 | about 35 min
# The trade-off
A cache per group cannot see interference between groups, by construction. The strict gate's whole-pass run can. A full re-judge once a month, and before the swap to the real taxonomy, bounds how stale that context gets.
# What would change this answer
- Strict runs show interference inside or across groups: regroup the tags, or give a sensitive tag its own call.
- The fixed overhead per call shrinks: one tag per call becomes affordable, and it is exact.
- Throughput tuning (O4): batch size set by the number of tags in the call.

## Human judgement
# Which tags need human judgement?
Short answer. Of the 13 Issue tags, only Context-dependent can be judged from the text today. Another 6 text tags can be judged once the editor approves drafted rules; two of them, Trailing period and Multi-sentence, can later move to code. Unsourced is decided by code. Three source tags need the source text. The two duplicate tags need a search across all claims, so they stay with the editor and are never queued: a recommended change to decision D6, pending your confirmation.
# The 13 tags
From the taxonomy snapshot of 9 October; check against the live table before setup
Tag | Status, rules | Needs | Who decides | "Cannot tell" goes to | Gate statistics
Context-dependent | Verified, 5 rules | the text | model, G1 | the editor | yes; the demo tag
Poor wording | Proposed, no rules | the text; subjective | model, once rules are approved | the editor | after approval
Wordy | Proposed, no rules | the text; subjective | model | the editor | after approval
Incorrect grammar | Proposed, no rules; the examples field holds a note | the text | model | the editor | after approval
Improper capitalization | Proposed, no rules | the text, with code hints (all caps, title case) | model and a hint | the editor | after approval
Multi-sentence | Proposed, no rules; Polarity Classification | mostly mechanical; abbreviations need judgement | model; later code, with the model as fallback (O3) | the editor | while the model decides it
Trailing period | Proposed, no rules | mechanical: one sentence ending in a full stop | model; later code (O3) | the editor | while the model decides it; then unit tests
Exact duplicate | no status | a search of all claims; within one mirror, a free text match | a code hint, then the editor | "not checked", queued only on a match | no
Semantically duplicated | no status | a search of all claims by meaning | the editor, later a search | "not checked", never queued | no
Unsourced | Verified | code: no sources | code | nobody | no
Source inaccessible | Verified | a fetch: status code, paywall | code, from the fetch | nobody | source gate only
Improperly sourced | Verified, 5 rules | the source text | model, source pass | "not checked" when nothing was readable; otherwise the editor | source gate only
Factually challenged | Proposed, 4 rules | the source text and the wider record | model, source pass, report only | as above | no, no positives yet
# Where "cannot tell" goes
Today every "cannot tell" on a tag that is not a source tag becomes a queue row. The duplicate tags always answer it, so the first full pass would create about 4,700 rows for them alone. Routing must follow the tag's capability:
Capability | "Cannot tell" means | Goes to
Text | the judge is unsure | the queue, if among the least certain of the run
Source | no source could be read | "not checked" in Agent notes; queued only when a source was read and the judge is unsure
Search across claims | always, until the search exists | "not checked" in Agent notes; never queued
Code | never | nowhere
# Left out of the gate's statistics
- Both duplicate tags: the gate would count their "cannot tell" as a failure.
- Unsourced, and later Trailing period and Multi-sentence: code decides them, and unit tests check the code.
- The source tags, from gates on text tags.
- Factually challenged, until it has positives.
- Drafted tags, until their rules are approved.
# Duplicates: recommended change to decision D6, pending your confirmation
D6 says duplicates answer "cannot tell" and go to the editor. That would queue thousands of rows the editor cannot decide either. Recommended: never queue them until a search exists (optimal step O6). Exact duplicate gets a free text match inside the mirror and is queued only on a match. Semantically duplicated shows "not checked" in Agent notes.
# What would change this answer
- The live taxonomy differs from the 9 October snapshot: statuses, Multi-sentence's polarity, the example claims or the rules.
- A search across all claims exists (O6): duplicates move to code and a pair-judging pass.
- Source links do not resolve to articles: the three source tags stay "not checked" for most claims.
- The editor approves drafted rules: each text tag moves from "no rules" to judged.

## Pricing
# What does it cost on the subscription?
Short answer. The dollar figures are the CLI's list-price equivalent: what the same tokens would cost on the API. Nothing is billed per call on the subscription. The limit that binds is the usage window, which the trial never hit. Report calls, tokens, time and the share of a window instead of dollars.
# Measured per call
Sonnet 5.5, medium effort, 8 claims a call, 10 tags
Measure | Value
Calls measured | 138 eight-claim calls, 199 judge calls in all
Input per call | 10.3k tokens: 8.4k cache reads, 1.9k cache writes
Output per call | 7.5k tokens, about 1.6k of it thinking
Output per claim | about 990 at 10 tags; about 335 at 2 tags
Time per call | 44 s median, 60 s longest
List-price equivalent | $0.084 a call, $0.0112 per claim and run
Busiest 5 hours of the trial | 171 calls, 1.76M input, 1.25M output; no usage-window stop
# A full pass over the U.S. Politics mirror
2,351 claims, 294 calls per run. Input, output and wall clock assume a cached 6.5k-token prompt, 500 output tokens per claim, 50 s a call, 2 calls at a time; the last two columns use the measured rates
Policy | Calls | Input | Output | Wall clock | Output, 7 text tags | List price, 10 tags
One run | 294 | 2.0M | 1.18M | 2.0 h | 1.76M | $26
Three runs, today | 882 | 6.0M | 3.5M | 6.1 h | 5.3M | $79
Adaptive | 383 | 2.6M | 1.53M | 2.7 h | 2.29M | $34
Adaptive here means a second run for 25% of claims (74 calls) and a third for 5% (15 calls): 1.3 times a single pass.
Warning: the adaptive target needs a narrower trigger. In the trial's tag run, 20.2% of the model's answers had a confidence between 0.25 and 0.75, and 88% of claims had at least one reason to re-run. Re-running a whole claim on any reason gives 1.9 to 2.8 times a single pass, not 1.3.
Recommended change to decision D13, pending your confirmation: re-run an answer only when the judge asks for an editor or its confidence lies strictly between 0.25 and 0.75; re-run at most 30% of a run's claims, least certain first; calibrate on the first 200 claims against a 3-run reference pass over 100 of them, about 38 calls.
# Other runs
Run | Calls | Input | Output | Wall clock
Weekly 100 new claims, one run | 13 | 89k | 50k | 5.5 min
The same, three runs | 39 | 266k | 150k | 16 min
The same, adaptive | 18 | 123k | 65k | 7.5 min
The week a lesson goes live, today | 294 to 882 | 2.0M to 6.0M | 1.18M to 3.5M | 2 to 6 h
The same, with a cache per group (G1) | 147 | about 0.4M | about 0.6M | about 35 min
Source pass, full mirror | about 950 | about 6.7M, 5.2M uncached | about 0.57M | about 3.3 h + 25 min fetching
Source pass, weekly | about 40 | about 0.28M | about 24k | about 8 min
Distill, 5 groups (Opus) | 5 to 10 | 25k to 55k | 5k to 10k and thinking | 5 to 8 min
Simple gate: 40 cases and 50 canaries | 12, baseline cached | 82k | 45k | 5 min
Plus a re-judge of 3 flipped cases | +4 | +27k | +6k | +2 min
Strict gate | 46 to 92 | 0.31M to 0.63M | 0.16M to 0.35M | 19 to 38 min
# A Claude Code update
Today the CLI version is part of the cache key, so every update throws away every cached answer. At mirror scale that is 2 to 6 hours and about $26 at list price per run, against about $4 at trial size. A run stopped by the usage window also cannot resume across an update.
The fix: record the version in every answer, but do not key on it. When it changes, judge the canaries once (about 7 calls) and invalidate only if more than about 5% of answers change. The model id is still checked on every call. Pinning the CLI instead would fight the desktop app's automatic updates.
# What would change this answer
- The window's size and the plan tier: never measured. The window is shared with the editor's own use of Claude. A calibration run, and every stop, measure it.
- Moving to an API key: the dollar figures become real bills.
- Excerpts cut to the relevant paragraphs, about 1.5k tokens: the source pass needs roughly half the input.
- Random mirror claims re-run less than the trial's hand-picked boundary claims: adaptive comes closer to 1.3 times.

## Scaling
# What happens at thousands of claims and the full Issue rulebook?
Short answer. The code scales with three fixes: a cache per tag group, a usage-window check that retries passing errors, and a cap on the cases a gate re-judges. The editor does not scale: the first full pass would queue 330 to 820 rows, 6 to 40 hours for one person. So new rows are capped at 50 per run, least certain first, a recommended change to decision D4 pending your confirmation; and tags go live one at a time.
# Where the limits are
Area | Today | At 2,351 claims, 13 tags | Fix
Throughput | 2 calls at a time; a 300 s timeout, longest call 60 s; 2 attempts a batch; a run fails above 10% errors | Output tokens per usage window bind, not the number of calls at once | Keep 2: more at once only uses the window up faster
New claims | Unchanged claims are skipped by their text fingerprint | Works while nothing changes | Keep
A rule change or CLI update | Re-judges every claim | 294 to 882 calls, 2 to 6 h | A cache per group; the CLI version recorded, not keyed
Gate size | Every decided row is a test case | 2,000 decisions: about 1,700 cases, 213 calls (1.5 h) per candidate run; 640+ strict | Every case on the target tag plus at most 20 per other tag in its group: about 150 items, 19 calls
Notion writes | 3 requests a second | 2,351 pages in about 784 s (13 min), plus two reads of 24 pages | Weekly, write only changed claims (100 to 300): 1 to 2 min
Editor inflow | A weekly cap of 40 with priority tiers. The trial's 60 boundary claims gave 117 uncertain answers; 67 new rows were held back. | 2 to 5% of 16,457 tag decisions: 330 to 820 rows, 6 to 40 h at 1 to 3 min a row | At most 50 new rows per run, least certain first; the rest reported as held; a view of confident applies to skim
# What adaptive runs change
Today a split between three runs marks an answer as uncertain. With one run, a noisy answer that lands confidently is never reviewed. Measure it once: judge 100 random claims 3 times (about 38 calls) and compare with the adaptive result. Propose must also handle a different number of runs per claim.
# The full Issue rulebook
Part | Effect per claim
Each text tag in a call | about 82 more output tokens, on top of about 170 fixed
The text pass, 7 tags | about 750 output tokens
Mechanical tags in code (O3) | about two tags' output saved
Source tags | a separate pass, one claim per call, only for the claims with sources that can be read
Duplicate tags | no model call until a search exists
# What would change this answer
- The weekly number of rows the editor accepts (pending your confirmation; 50 per run is the default).
- Whether confident applies may be confirmed in bulk: then the queue holds only real doubt.
- The usage window's size: it decides how many runs fit in a week.
- World affairs joining: one more mirror, with claims judged once per Geo ID and text.


# Tab: Path to editors

## Start small
# Start small, week by week
When | What | Who | Done when
Week 0 | Housekeeping. Disconnect the integration from the 4 real databases it can read and rotate the token; add a private remote; fix the permission settings; delete the two setup markers; mark the old hub as read-only history. | The product owner decides; the engineer does it | The probe passes with the new token; the repository is pushed
Week 0 | A read-only dry run on the mirror. One schema request, then a full pull with a client that refuses anything but reads: about 24 requests. | The engineer | A report: the row count, whether the column map resolves, duplicate Geo IDs, how Geo Sources parse, whether the two columns exist. No write was ever armed.
Week 0 | A resolver spike of 1 to 2 hours: turn Geo source links into article addresses. | The engineer | Sample links resolve, or the source tags are parked as "not checked"
Then | The code changes on Moving from the MVP. | The engineer, after your go-ahead | The tests pass and the fake loop runs end to end
Week 1 | The rulebook copy of the 13 Issue rows, and Context-dependent alone on 50 mirror claims. | The engineer runs it; the editor decides the rows | The read-back is clean; Agent tags and Agent notes show on the mirror; the queue holds only Context-dependent rows
Week 2 | The walkthrough with the editor; first rules drafted for the 6 text tags that have none. | The editor, with the engineer | The walkthrough is done; 6 drafted rule changes wait in Lessons waiting
Weeks 3 and 4 | The drafted tags go live one at a time (wording, grammar and format), each after approval and a gate with a base-rate check. A source-pass spike on a sample. | The editor approves; the engineer runs | Each tag passed its gate; the spike reports fetch results on its sample
Later | The strict gate as routine; World affairs; the search for duplicates; the swap to the real taxonomy. | When the data justifies each | See The optimal setup
The walkthrough skill and the code changes each need a separate go-ahead, as decided in D16.

## The walkthrough
# The walkthrough
One command builds a fresh practice page under a page the editor picks: its own one-tag rulebook (Context-dependent), 7 real claims and a small queue, with its own profile on disk. The editor then works through 7 steps with the same commands used for real, plus the word demo.
# The story
Rule 4 of Context-dependent is a test: could a reader who sees only the sentence say which specific thing each reference points at? The editor asks something simpler: does the claim read well as it stands? Three real claims show the gap.
Claim | Rule 4's test | The editor
The focus on the COVID-19 vaccine ignored the larger public health problem… | Tag: which problem? | No tag: a general remark
Georgia's gubernatorial debate should be moderated by professional journalists… | Tag: which debate? | No tag: reads well
Melania Trump should not host her initiative's G20 event… | Tag: which initiative? | Tag: "What's the initiative?"
The first two wait for the editor. The editor decides them, the agent drafts a clearer rule 4, the editor approves it, and a safety check makes sure the earlier decisions still come out right before the new rule is used. The third is one of 5 earlier decisions that must stay right.
# The seven steps
- Meet the demo. Goal: check the demo is ready and see what waits for whom. /claim-tagger demo status
- The agent reads the claims. Goal: the agent reads the 7 claims and fills its side of the editor's 2 rows. /claim-tagger demo tag
- Decide your two rows, as the editor. Goal: record the decision and say that rule 4, not the agent, is the problem. In Notion.
- The agent drafts a clearer rule 4. Goal: turn the two notes into one proposed rewording. /claim-tagger demo distill
- Approve the draft, as the rule owner. Goal: decide whether the draft may be tested; approving does not change the rule. In Notion.
- The safety check. Goal: test the approved rule against everything already decided, and switch to it only if nothing breaks. /claim-tagger demo promote
- The agent re-checks your rows. Goal: confirm the agent now agrees with both decisions. /claim-tagger demo follow-up
# A sample step: step 3 in the fixed format
Every step on the page has the same four parts, and every table it shows has at most 4 columns.
Goal
Record your decision on your two rows, and say that rule 4, not the agent, is the problem.
Existing status
Both rows show Agent proposal Applies, citing rule 4 (from step 2).
Doing the work
In the view "Decide these rows", fill in three columns on each row.
Tag decisions · Decide these rows, as you fill them in
Claim | Tag outcome | Why wrong | Your reasoning
The focus on the COVID-19 vaccine ignored the larger… | Does not apply | Rule unclear | Rule 4 is too strict: "the larger public health problem" is general; the claim reads fine.
Georgia's gubernatorial debate should be moderated by… | Does not apply | Rule unclear | Rule 4 is too strict: the claim reads well without a date or names for the debate.
Explaining the outputs
Your two rows now carry your decision next to the agent's proposal. The agent is not involved, and no other table changes.
Tag decisions · your two rows after step 3
Claim | Agent proposal | Tag outcome | Why wrong
The focus on the COVID-19 vaccine ignored the larger… | Applies | Does not apply | Rule unclear
Georgia's gubernatorial debate should be moderated by… | Applies | Does not apply | Rule unclear
# If the safety check does not pass
Rule changes then names the earlier claim whose answer would change, and the Rulebook stays as it was. The editor rewrites rule 4 in Editor wording so that claim keeps its answer, usually one added sentence, and runs /claim-tagger demo promote again. If it fails again, the editor sets Rejected: the rule stays, and the check has done its job.
# Before the page ships
The claims must behave as the story needs, so the engineer runs 3 fresh demos end to end, at about $1 and 10 minutes each. If the agent does not propose the tag on both open rows, or the gate does not pass, the Georgia claim is swapped for an alternate and the runs repeat.

## Skill reports
# Skill reports, before and after
Reports today are long: several paragraphs, a table, an explanatory block added by the output style, and an account of everything that went wrong on the way. The sandbox walkthrough's reports ran to 3 to 6 paragraphs each. The fix is a fixed format in SKILL.md, and a line that switches off the output style's explanatory blocks while the skill runs.
# Before: a tag report from the MVP, condensed
"The dry run did not tag anything. I stopped after the judge step."
- Then 3 more paragraphs: why the judge found nothing to do, a configuration id, a ledger count, a file search that failed, the scripts it chose not to run.
- A 4-row table with a run id.
- 2 options and a question back to the reader.
- A 2-bullet explanatory block from the output style, on how a script option works.
Headless /claim-tagger dry run of 13 October; the full text is in docs/mvp-2026-10/evidence/headless.
# After: the three-part template
Demo · tag: the agent read the 7 claims and proposed Applies on both of your rows.
Claims read | 7
Your rows | 2, both Applies, citing rule 4
Earlier decisions | 5 of 5 agree with the agent
Time and cost | 1 min 40 s, $0.05
Next: fill in your 2 rows in Decide these rows (link).
The example from the walkthrough design; its figures are illustrative.
What the template keeps and drops
Before | After
Several paragraphs | One sentence: what ran and what came out
A table with run ids and costs to four decimals | One table, at most 5 rows and 3 columns, with the figures that matter
An explanatory block from the output style | Gone
An account of retries and incidents | A few words in the sentence, only if they changed the result
Several links, options and questions | One "Next:" line: one command to type, or one link and what to do there
File paths, script names, JSON | Never
If the wording alone does not stop the explanatory blocks (a headless run with that output style on will tell), a small script prints each report and the skill relays it word for word.

## Weekly routine
# The weekly routine and its time budget
Who | What | How often | Time
The editor | Decide the new rows in Your queue: at most 50, least certain first | Weekly | 1 to 3 min a row; 50 to 150 min for a full batch
The editor, as rule owner | Approve or reword one rule change in Lessons waiting | When one waits | A few minutes
The editor and the engineer | An optional review: what went live, what is stuck | Weekly or less | 30 min
The engineer | One tag run on the week's new claims, and one promote | Weekly | About 15 min of attention
A plain row took about a minute in the MVP review, a Context-dependent row two to three. If a full batch is more than the editor's week allows, lower the cap: the rest waits as held and nothing is lost.
What the machine does in that week · wall clock, unattended
Run | Calls | Wall clock
Tag run on 100 new claims, adaptive | 18 | 7.5 min
Simple gate and a re-judge of flipped cases | 12 + 4 | about 7 min
Follow-up after a PASS | none new | under a minute
Source pass on the new claims, once live | about 40 | about 8 min

## What needs your confirmation
# What needs your confirmation
Where the three plans disagreed with each other or with a decision, the analysis recommends a change. These items wait for the product owner before the code changes start.
# | Item | Recommendation or question | Why
1 | Source addresses | Is there a Geo API or a Sources table with the article address behind each Geo source link? One check reported that Geo's public API returns a source's Web URL and publisher in one query; it is not recorded in the verification notes, and the endpoint name needs the Geo team's confirmation. The week 0 spike settles it. | Without addresses the source tags show "not checked".
2 | Adaptive trigger | Recommended change to decision D13, pending your confirmation: re-run an answer only when the judge asks for an editor or its confidence lies strictly between 0.25 and 0.75; re-run at most 30% of a run's claims; calibrate on the first 200 claims against a reference pass over 100 of them. | As written, D13 would re-run 88% of the trial's claims: 1.9 to 2.8 times a pass instead of 1.3.
3 | Gate noise guard | Recommended change to decision D14, pending your confirmation: every case that flips between the two rule versions is judged twice more on both sides, about 4 calls. The statistics stay behind --strict. | At the measured noise, a one-run gate fails by chance 80 to 95% of the time.
4 | Duplicates | Recommended change to decision D6, pending your confirmation: duplicates are never queued until a search exists. Exact duplicate is queued only on a text match within the mirror; Semantically duplicated shows "not checked". | Otherwise about 4,700 rows the editor cannot decide either.
5 | Editor inflow | Recommended change to decision D4, pending your confirmation: at most 50 new queue rows per run, least certain first, the rest reported as held, and a view of confident applies to skim. And: what weekly number is acceptable? | The first full pass would queue 330 to 820 rows.
6 | The real mirror | Who adds the two columns, and does the Geo-to-Notion sync keep added columns and page ids? | The agent's writes live in those two columns.
7 | The usage window | Which plan tier, and how big is the window? | Never hit in the trial; its busiest 5 hours used 171 calls and 1.25M output tokens.
8 | Hard rules | Recommended change to hard rules 5 and 10, following decisions D1 and D3, and to drift under decision D2, pending your confirmation: rule 5 judges every rulebook tag whose rules went live through the gate, not only Verified tags; rule 10 lets the configured mirrors take writes to exactly two text columns, while the taxonomy and Claims to review stay protected; edits to tags that have no rules yet are adopted without a gate. | Rules 5 and 10 as written forbid the decided target.


# Tab: Editor's debate

## Overview
Content pending
This tab has not been written yet.


# Tab: Glossary

## All terms
Every term marked with * in the report, in plain words. Each tab also lists the terms it uses at its foot.
adaptive runs
Judging each claim once and running the judge again only on the answers it was unsure about, instead of three runs for every answer. Decision D13; a narrower trigger and a cap are pending your confirmation.
allowlist
The list in code of exactly which columns the agent may write in which table. Anything else is refused before it is sent. On the real claims mirror it allows two text columns and nothing more.
cache group
A set of tags judged together, whose answers are stored under one key. A rule change re-judges only its own group: Context-dependent alone, the drafted text tags, or the source tags.
canary
An example claim with a known answer that every gate checks again. Today's canaries are copies of the rulebook's examples, which the judge already sees, so they catch less than they should.
capability
What a tag needs to be decided: the claim text, the source text, a search across all claims, or only code. It decides who answers, and where a "cannot tell" goes.
claim
One short statement from a Geo debate, such as "Excluding CNN from Air Force One violates the federal court order". The claims the agent tags live in the mirror tables in Notion.
demo page
A fresh Notion page the walkthrough builds under a page the editor picks, with its own one-tag rulebook, seven real claims and a small queue. Nothing on it touches the real tables.
drift
A difference between the rules in Notion and the rubric file, for example a rule edited by hand. The agent stops until it is resolved, so rules never change behind its back.
follow-up
The step after a rule change goes live: the claims behind it are judged again, and their queue rows show Fixed or Still wrong.
gate
The safety check before a rule change goes live. The same claims are judged under the current and the proposed rules; the change goes live only if nothing that was right turns wrong and the claims it was drawn from now come out right.
interference
A change to one tag's rules moving the judge's answer on another tag. In the trial a Predictive change flipped a Context-dependent answer, and the gate refused it.
judge
The model call that reads claims against the rules and answers, for each claim and tag: applies, does not apply, ask an editor, or cannot tell, with a confidence.
lesson
A proposed change to one rule, drafted by the agent from the editor's decisions, as a row in Rule changes. It changes the rulebook only after the editor approves it and it passes the gate.
mirror
A Notion copy of a Geo claims space, such as "U.S. Politics debate claims". It is real data shared with the team, so the agent may write only its two text columns.
pause
The stop switch: the Paused checkbox in Agent settings, or a PAUSED file, stops every command until a person clears it.
profile
A folder with its own config, rulebook, tests and run records, so a demo or a test runs without touching the real setup.
queue
The Tag decisions table in Notion: one row per claim and tag the agent is unsure about. The editor records the outcome there.
read-back
The check after every write: the agent reads Notion again and confirms that each value landed and that no editor field changed.
regression case
A claim the editor decided, kept as a permanent test: no rule change may make the agent get it wrong.
rubric
The rulebook as a versioned file in the repository, with a fingerprint for each tag. Notion is compared with it before every step.
rulebook
The written rules for each tag ("When to use"), kept in Notion as a copy of the taxonomy's Issue rows. The judge works from these rules and nothing else.
skill
The /claim-tagger command in Claude Code, with subcommands such as tag and status. It runs the scripts and reports back in three parts.
source pass
A separate judge pass for the source tags. The agent first fetches each claim's sources and keeps a copy; then the model reads short excerpts, one claim per call.
tag
A label from the team's taxonomy that says something about a claim. Here, one of the 13 Issue tags, such as Context-dependent or Wordy.
usage window
The subscription's limit on how much Claude Code can do in a period. When it runs out, a run stops cleanly and resumes later where it left off.
walkthrough
A guided practice run of the whole loop on a demo page: seven steps, about half an hour, with real claims and nothing real changed.

