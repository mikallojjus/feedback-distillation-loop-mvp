# Report text, Plain layer only (generated from claim-tagger-analysis.html)

# Tab: Summary

## The loop
# The loop in one picture
[figure]
The loop in six steps. People decide in steps 3 and 5; the agent does the rest; nothing changes a rule unless the gate passes.
The judge, a model call, reads each claim against the rulebook; unsure answers go to the queue for the editor; decisions that blame a rule become a lesson, which the gate tests against every earlier decision. One skill, /claim-tagger, runs it all.
What the trial showed. On 60 claims the gate rejected the first lesson 5 times: each wording flipped an earlier decision on another tag (interference). The machinery around the loop is far heavier than one editor needs.

## At a glance
# The 13 tags, by when they can be judged
2
Ready now: Context-dependent; Unsourced, by code
6
After drafted rules: Wordy, Poor wording, Incorrect grammar, Improper capitalization, Multi-sentence, Trailing period
3
Need the sources: Improperly sourced, Source inaccessible, Factually challenged
2
Not yet: Exact duplicate, Semantically duplicated (need a search)
# Before and after
What | Today (the MVP) | Minimal version
Scripts | 22 | 17
Notion tables the agent keeps | 6 | 4, plus two text columns on the real claims table
Queue columns | 30 | 12
Columns the editor fills | 5 | 3
Views, trial and sandbox together | 40 | 4
Choices to learn in the dropdown columns | 32 | 8
Model calls for one pass over the U.S. Politics claims | 882 | 383
Where to read next
Question | Tab
What stays, what goes? | Features ranked
What is broken? | Debt and bugs
The smallest working version, its tables, what comes later | Minimal and optimal
Your six questions | Your questions
In what order, and what is decided | Path to editors


# Tab: Features ranked

## Overview
# Rank by verdict
Features per verdict and rank · every feature with its reason: Ranking (Technical)
Rank | Keep | Simplify | Cut | Later | Add
5 | 17 | 1 | 0 | 0 | 2
4 | 10 | 4 | 0 | 0 | 0
3 | 2 | 3 | 0 | 0 | 0
2 | 1 | 7 | 7 | 3 | 0
1 | 0 | 0 | 15 | 1 | 0
All | 30 | 15 | 22 | 4 | 2
# Cut 22 features
What goes | Instead
6 formulas and 5 rollups | Plain columns; the claim text is the row's title
Queue extras and the weekly cap | No cap; rows sorted by confidence
Run history in Notion | Local run files and one summary line
Steps with no job left, such as arming a plan | Nothing: the gate already does the work
Trial and demo scaffolding | One setup script for the real tables
# Simplify 15 features
Today | Minimal version
Queue: 30 columns, 40 views | 12 columns, 4 views
Three runs and a majority vote on every answer | One run, a second only when unsure (adaptive runs)
Saved answers thrown away after any rule change | Kept per cache group
A status word per claim on the claims table | Agent notes in two short lines
Heavy safety plumbing | The same protection, smaller
# Later 4 features
Feature | Why later
Gate statistics, extra re-runs, a sample-size label | Kept in the strict gate until a tag has 30 decided examples
Fingerprints that match the research code | A fresh start does not need them
# Add 2 features
Feature | What it does
Drafting first rules | For tags that have none, one tag at a time
A lesson must fix its own claims | Or the gate refuses it


# Tab: Debt and bugs

## Blockers and high
# The blockers and the high items
4
Blocker stops the real claims
9
High a real risk now
11
Medium fix while touching the code
6
Low tidy-up
Effort: S small, M medium, L large · "Fixed in" names the stage on Path to editors · all 30 items with their files: All items (Technical)
# | Severity | What breaks | Effort | Fixed in
1 | Blocker | Building the rulebook from the taxonomy copy would drop its 7 Proposed tags. | M | Stage 1
2 | Blocker | The code assumes the trial's one claims table; the real one (the mirror) differs. | L | Stages 0 and 1
3 | Blocker | All tags are treated alike, though they need different inputs (their capability); the duplicate tags alone would add about 4,700 queue rows. | M | Stages 0 to 2
4 | Blocker design verified, code to write | Source links point at Geo pages; the lookup of article addresses works, its code is not written yet. | S to M | Stages 0 and 3
5 | High | Any update or rule change throws away all saved answers. | S + M | Stage 1
6 | High | A brief "busy" error stops a long run as if the usage window had run out. | S | Stage 0
7 | High | The gate can reject a good rule by chance; the decided fix re-reads each flipped claim. | S | Stage 2
8 | High | The gate's test claims (canaries) are examples the judge already sees. | M | Stages 1 and 2
9 | High | Permission rules miss the Notion tools and let the model lift the pause. | S | Stages 0 and 1
10 | High | The access token reaches 4 real tables, the taxonomy among them. | S to M | Stages 0 and 1
11 | High | A leftover setup marker loosens the safety hook. | S | Stage 0
12 | High | A pointer names an incomplete data copy, so some runs stop. | S | Stage 1
13 | High | No backup remote; 61 MB of run records on one disk. | S | Stage 0 (optional)
Already fixed: the sandbox files that were uncommitted when the analysis began are committed.


# Tab: Minimal and optimal

## The minimal loop
# The minimal loop, end to end
[figure]
The minimal loop in six steps: the judge reads the claims, unsure tags go to the queue, the editor decides, a lesson is drafted, the editor approves it as rule owner, and the gate tests it against every earlier decision. Only a PASS changes a rule in the rulebook; then follow-up runs by itself.
# How the editor uses it
[figure]
Four commands and two Notion actions; everything else the agent does by itself.
The commands belong to one skill, /claim-tagger. Rarely used: setup, draft-rules (one tag at a time) and rollback. Tags are judged in groups (cache groups), so a rule change re-judges only its group.

## The tables
# Which tables exist, and who writes what
[figure]
The agent writes two text columns on the real claims table and its own four tables, nothing else; the taxonomy is copied once and never written.
Mock-ups of the final tables with example values; the claims are real. Every column and type: Column lists (Technical).
# Rulebook copy: one row per tag (13 rows)
Name | Status | When to use (shortened) | Example Claims (shortened)
Context-dependent | Verified | 5 numbered rules. Rule 4: "Test: could a reader who sees only this sentence say which specific thing each definite reference points at? If any answer is no, tag Context-dependent." | "He said the new model outperforms its predecessor."
Wordy | Proposed | (empty until its first rules are approved) | (as in the taxonomy)
# Tag decisions, the queue: 12 columns
Column | Filled by | Holds
Claim | the agent | The claim text, as the title
Key | the agent | Geo ID and tag
Tag | the agent | One of the 13 tags
Agent proposal | the agent | Applies, Does not apply or Can't tell
Agent confidence | the agent | 0 to 1; the lowest come first
Agent reason | the agent | A short reason and the rule used; for Can't tell, whether the rules do not settle it or the source is needed
Claim link | the agent | The claim's page
Rulebook edition | the agent | The edition the answer used
Follow-up | the agent | Fixed or Still wrong, after a rule change
Tag outcome | the editor | Applies or Does not apply
Why wrong | the editor | Agent slip, Rule unclear or Rule should change
Your reasoning | the editor | The editor's words
The 8 values to learn, under their columns
Agent proposal | Tag outcome | Why wrong
Applies | Applies | Agent slip
Does not apply | Does not apply | Rule unclear
Can't tell | | Rule should change
Tag decisions · two real Context-dependent rows, decided
Claim | Tag | Agent proposal | Agent confidence | Tag outcome | Why wrong
The focus on the COVID-19 vaccine ignored the larger public health problem in the U.S. | Context-dependent | Applies | 0.72 | Does not apply | Rule unclear
Georgia's gubernatorial debate should be moderated by professional journalists rather than a town hall audience | Context-dependent | Can't tell | 0.55 | Does not apply | Rule unclear
Your reasoning on both rows: "Rule 4 is too strict"; the claims read well as they stand.
# Rule changes: one row per proposed change (11 columns)
Lesson | Rule | Status | Safety check result
First rules for Wordy | Wordy when to use | Proposed | (empty: not tested yet)
General references pass the rule 4 test | Context-dependent rule 4 | Approved | FAIL: "Melania Trump should not host her initiative's…" now Does not apply
In Lessons waiting the current and proposed text sit side by side; after a FAIL the report proposes one sentence for Editor wording.
# Agent settings: one row (4 columns)
Name | Paused | Rulebook edition | Last run summary
claim-tagger | unticked | 2026-10-15.2 | Tag · 15 Oct 09:12 · 50 claims
Ticking Paused stops every command.
# The real claims table: two new columns next to Geo Name
Geo Name | Agent tags | Agent notes
The focus on the COVID-19 vaccine ignored the larger public health problem in the U.S. | (empty) | no tags
1 waits for an editor · not checked: 3 source tags, 2 duplicate tags · edition 2026-10-15.2
Excluding CNN from Air Force One violates the federal court order | Context-dependent | Context-dependent
nothing waits for an editor · not checked: 3 source tags, 2 duplicate tags · edition 2026-10-15.2
Agent tags holds only sure or decided tags; Agent notes is at most two short lines. The team reads this table (the mirror of Geo), so nothing else is written there.

## What optimal adds
# What the optimal version adds
[figure]
What the optimal version adds on top of the minimal loop; the loop itself does not change.
Addition | When
A second claims table, World affairs | After one clean cycle on U.S. Politics
A search for duplicates across all claims | When duplicates matter enough
Two mechanical tags decided by code | After their rules are approved
The strict gate as routine | From 30 decided examples of a tag
The real taxonomy as the rulebook (the swap) | After the copy has proved itself
A queue per editor | If a second editor joins
Scheduled runs | When running by hand is routine
For the editor, in three lines:
- All 13 tags are judged.
- Duplicates are found by search, not only by exact text.
- Each editor gets a queue if a second one joins.
The smaller steps and the comparison with today: The optimal setup (Technical), Side by side (Technical).


# Tab: Your questions

## Batch size
# How big should a batch of decisions be?
Short answer. Batch size is not the cost problem: drafting a lesson (distill) is one call to the strongest model, Opus, about $0.084 to 0.094 at list price. The limit is the editor's attention and the gate, which tests one lesson at a time: so one lesson per tag, at most 3 per run, the best-supported first.
2,000
decided rows
about 300
blame a rule
20 to 35
groups
3
lessons at most per run
# What would change this answer
- Groups grow past about 60 rows: sort them before drafting.
- The editor can review more lessons: raise the limit.
Settings and costs: Batch and tables in detail (Technical).

## One table or many
# One claims table or many?
Short answer. One rulebook can serve several claims tables: the judge sees only the claim text and the rules, so a claim is judged once and its answer shared. The code needs a list of tables instead of one: U.S. Politics first, World affairs later.
[figure]
One rulebook, many claims tables (each a mirror of Geo): a claim in two tables is judged once and written to both. Open check: can one Geo ID be in both?
# What would change this answer
- The Geo-to-Notion refresh drops added columns (you are asking): the agent's two columns move to an agent table.
- The claims table holds several data sources: the Notion client is upgraded first.
What is hard-coded today: Batch and tables in detail (Technical).

## One tag at a time
# Drafting works one tag at a time. Should the judge?
Short answer. Today one call decides every tag for 8 claims with one prompt, so a lesson on one tag throws away every saved answer and can move other tags (interference), which stopped the trial's first lesson. The design judges the claim text (the text pass) apart from the sources (the source pass) and saves answers per cache group.
Today
A Context-dependent rule change re-judges everything: 294 to 882 calls.
With a cache group
Only Context-dependent: 147 calls.
# What would change this answer
- The strict gate sees answers move between groups: regroup the tags; re-judge everything now and then, and before the taxonomy takes over.
Groups and prompt sizes: Judging and tags in detail (Technical).

## Which tags need a person
# Which tags need a person?
Short answer. Of the 13 Issue tags, 1 is judged from the text today (Context-dependent); 6 more after you approve drafted rules; Unsourced is decided by code; 3 need the source pages (Source inaccessible is decided in code from the fetch, the other two by the source pass); the 2 duplicate tags need a search across all claims and show "not checked" until then, never queued (decided).
[figure]
Which tags go where: what each tag needs (its capability) decides its lane, and the lane decides what happens when the agent is unsure: "ask an editor" or "cannot tell", both shown as Can't tell.
# What would change this answer
- You approve drafted rules: each text tag starts being judged.
- A search across all claims is built: the duplicate tags are decided.
- The Geo source lookup stops working: the source tags stay "not checked".
All tags with status and rules: Judging and tags in detail (Technical).

## Cost
# What does it cost on the subscription?
Short answer. Nothing is billed per call; the dollars only show what the same work would cost on the pay-per-use API. The limit is the usage window, how much Claude Code you can use in a period, which the trial never reached; its size on the Max 20x plan is still unmeasured. Reports will show the share of a window, not dollars.
294 calls
one run per answer: $26
882 calls
three runs, today: $79
383 calls
adaptive runs, decided: $34
One pass over the 2,351 U.S. Politics claims, at list price. Decided: a second reading only for "ask an editor" or a confidence between 0.25 and 0.75, for at most 30% of claims.
# What would change this answer
- An API key instead of the subscription: the dollars become real bills.
Figures per call and other runs: Cost and scale in detail (Technical).

## Thousands of claims
# What happens at thousands of claims?
Short answer. After three fixes the code copes. The editor does not: the first full pass would put 330 to 820 rows in the queue. Decided: no cap; the queue is sorted by confidence, the editor filters in Notion, and tags go live one at a time.
[figure]
How many rows reach the editor in the first full pass. Bar widths are illustrative, not to scale.
# What would change this answer
- Confident answers may be confirmed in bulk: the queue holds only real doubt.
- The usage window's size, once measured: how many runs fit between sittings.
Where the limits are: Cost and scale in detail (Technical).


# Tab: Path to editors

## Stages
# The plan in stages
[figure]
Each column is a stage, each row a person or the machine; S, M and L show the engineer's effort.
Stage 0 changes nothing real: it limits the access token, makes a read-only dry run and tests the Geo source lookup. Rows from the judge's first run wait for the editor. First rules come one tag at a time, in the editor's order. Every code change: the ordered changes (Technical).

## The walkthrough
# The walkthrough
One command builds a fresh practice page under a page you name, with 7 real claims; nothing real changes. It opens with: "You type all five commands yourself; the engineer sets things up and fixes what breaks." Below, "you" is the editor.
[figure]
The seven steps: you decide in Notion, the agent works in Claude Code. Step 6, the safety check, is run by promote; step 7, the follow-up, runs by itself after a PASS.
# The story
Rule 4 of Context-dependent asks whether a reader can tell what each "the ..." points at; editors read more loosely.
Claim | Rule 4's test | The editor
The focus on the COVID-19 vaccine ignored the larger… | Tag: which problem? | No tag: a general remark
Georgia's gubernatorial debate should be moderated… | Tag: which debate? | No tag: reads well
Melania Trump should not host her initiative's… | Tag: which initiative? | Tag: "What's the initiative?"
You decide the first two, the agent drafts a clearer rule 4 (a lesson) and you approve it; the third is one of 5 earlier decisions. These two rows were picked for the demo; for real, a row appears only when the agent is unsure.
# Step 3, as the editor sees it
Goal of the step
Record your decision on both rows, and say that rule 4, not the agent, is the problem.
Existing status
Both rows show Applies, citing rule 4.
Doing the work
In Your queue, just below, fill in three columns on each row.
Explaining the outputs
Your two rows now carry your decision; nothing else changes.
Tag decisions · mock-up with example values
Claim | Tag outcome | Why wrong | Your reasoning
The focus on the COVID-19 vaccine ignored the larger… | Does not apply | Rule unclear | Rule 4 is too strict: "the larger public health problem" is general.
Georgia's gubernatorial debate should be moderated by… | Does not apply | Rule unclear | Rule 4 is too strict: the claim reads well as it stands.
If the safety check fails, the report proposes one sentence for Editor wording; Lessons waiting shows both texts side by side. Every step: The seven steps (Technical).

## Skill reports
# Skill reports, before and after
# Before: 3 to 6 paragraphs
"The dry run did not tag anything. I stopped after the judge step."
- Then 3 more paragraphs, a 4-row table with a run id, 2 options and a question.
- A commentary block that Claude Code adds by itself.
# After: three parts, nothing else
1 · What ran. Demo · tag: the agent read the 7 claims and proposed Applies on both of your rows.
2 · The result
Your rows | 2, both Applies, citing rule 4
Earlier decisions | 5 of 5 agree
3 · Next. Next: fill in your 2 rows in Your queue (link).
No durations, dollars or model-call counts; a "Usage" row only once the share of the usage window is known.

## The routine
# The routine
- The editor types status and tag, then decides as many rows as fit one sitting, lowest confidence first; the rest waits and nothing is lost; the next run adds rows only for new or changed claims. Then distill if decisions blame a rule.
- As rule owner: approve or rewrite in Lessons waiting, then promote.
- The engineer: setup and repairs only. The machine: runs unattended.
After "Paused" or "usage limit reached", untick Paused or wait, then repeat the command; it resumes.

## Decided and open
# Decided on 14 October
Question | Answer
The duplicate tags? | Never queued until a search exists; "not checked" in Agent notes; Exact duplicate queued only on an exact text match.
How many new rows? | No cap; sorted by confidence; the editor filters.
When is a claim read again? | Only after "ask an editor" or a confidence between 0.25 and 0.75, for at most 30% of claims.
Chance in the safety check? | Each flipped claim is read twice more on each side.
The two new columns? | Added once by the setup script, behind a confirm flag.
Which subscription? | Max 20x; estimates per usage window after a full run.
The hard rules? | Changed as recommended.
Where do practice pages go? | Under a page you name each time.
Checked on 14 October: the Geo API gives each source's article address, one query per source.
# Still open
Who | What, and why
You, with the refresh job's owner | Does the Geo-to-Notion refresh keep added columns and page ids? Needed before the first real write.
The Geo team | The official address of the Geo API; needed before the full source pass.
The engineer | One calibration of the re-read rule and the safety check's guard on the first 200 real claims.
Every decision, numbered: Summary, Decisions (Technical).


# Tab: Editor's debate

## Overview
Filled in after round 2
An editor's review of this report and of the practice page ran in two rounds. This tab is filled in after round 2, with every objection and what was done about it.


# Tab: Glossary

## Main terms
Every term marked with * in the report, in plain words. Each tab also lists the terms it uses at its foot; hover a marked word for its line here.
# Words used across the report
adaptive runs
Judging each claim once and again only for the answers the judge was unsure about, at most 30% of a run's claims, instead of three runs for every answer. Decided on 14 October.
agent's four tables
The agent's own tables on a new Notion page: Tag decisions (the queue), Rule changes (the lessons), the Rulebook copy (the rules) and Agent settings (Paused, the edition, a last-run line).
Agent tags, Agent notes
The two text columns the agent writes on each claim of the real claims table: the tags that apply, and at most two short lines on what waits for an editor and what was not checked.
allowlist
The list in code of exactly which columns the agent may write in which table; anything else is refused before it is sent.
ask an editor, cannot tell
Two of the judge's answers. Ask an editor: the rules do not settle the claim. Cannot tell: it lacks something, such as a source's text. Both show as Can't tell in the queue; Agent reason says which.
cache
Saved judge answers, so a claim whose text and rules have not changed is not judged again. Not the same as prompt caching.
cache group
A set of tags judged together, whose saved answers are kept together: Context-dependent alone, the six drafted text tags, or the source tags. A rule change re-judges only its own group.
canary
An example claim with a known answer that every gate checks again. Today's are the rulebook's own examples, which the judge already sees. Editors see them as example claims.
capability
What a tag needs to be decided: the claim text, the source text, a search across all claims, or only code.
claim
One short statement from a Geo debate, such as "Excluding CNN from Air Force One violates the federal court order". The claims the agent tags live in claims tables in Notion.
confidence
A number from 0 to 1 that the judge gives with each answer: how sure it is. Queue rows are sorted by it, lowest first, and a value strictly between 0.25 and 0.75 makes the judge read the claim again.
distill
The step where the agent reads the editor's decisions that blame a rule and drafts a lesson, a proposed new wording of that rule. Command: /claim-tagger distill.
drift
A difference between the rules in Notion and the rubric file, such as a rule edited by hand. For a tag with rules the agent stops until a person resolves it; for a tag without rules the edit is adopted.
dry run, spike
Dry run: a run that changes nothing, here a read-only copy of the real claims table. Spike: a small trial that finds out whether an idea works before it is built in full.
effort (S, M, L)
How much work a change is for the engineer: S small, M medium, L large. This report gives effort and order, never durations.
follow-up
The step after a rule change goes live: the claims behind it are judged again, and their queue rows show Fixed or Still wrong. It runs by itself right after a PASS; the command only repeats it by hand.
gate
The safety check before a rule change goes live: the same claims are judged under the current and the proposed rules, and the change goes live only if nothing right turns wrong and its own claims now come out right. Editors call it the safety check.
hard rules
The ten rules every agent session in this repository follows, such as: no script writes a field the editor owns; a check that cannot run is reported, never skipped.
interference
A change to one tag's rules moving the judge's answer on another tag. In the trial a Predictive change flipped a Context-dependent answer, and the gate refused it.
Issue tag
A tag in the team's taxonomy that marks something wrong with a claim, such as Wordy or Unsourced. The target has 13.
judge
The model call that reads claims against the rules and answers, per claim and tag: applies, does not apply, ask an editor or cannot tell, each with a confidence from 0 to 1.
lesson
A proposed change to one rule, drafted by the agent from the editor's decisions, as a row in Rule changes. It changes the rulebook only after the editor approves it and it passes the gate.
mirror
A Notion copy of a collection of claims in Geo, such as "U.S. Politics debate claims". It is real data shared with the team, so the agent may write only its two text columns.
MVP, trial, sandbox, hub
MVP: the first version of the claim tagger, built in October 2026. Trial: its run on 60 claims. Sandbox: the copy built afterwards for the editor walkthrough. Hub: the Notion page that holds the trial's tables, kept as read-only history.
Notion words
Property: a column. Select: one value from a list. Relation: a link to a row elsewhere. Rollup: values pulled from linked rows. Formula: a calculated value. View: a saved filter and sort. Data source: one of several tables a newer Notion database can hold.
PASS, HOLD, FAIL
The gate's results. PASS: nothing right turned wrong and the lesson's claims now come out right; the rule goes live. FAIL: it broke an earlier decision or did not help. HOLD: too little evidence. After FAIL or HOLD nothing changes.
pause
The stop switch: the Paused checkbox in Agent settings, or a PAUSED file, stops every command until a person clears it.
practice page (demo page)
A fresh Notion page the walkthrough builds under a page you name each time, with its own one-tag rulebook, 7 real claims and a small queue. Nothing on it touches the real tables. Its commands carry the word demo.
profile
A folder with its own config, rulebook, tests and run records, so a demo or a test runs without touching the real setup.
promote
Take an approved lesson through the gate and, only if it passes, write the new rule into the rulebook; follow-up then runs by itself. Command: /claim-tagger promote.
queue
The Tag decisions table in Notion: one row per claim and tag the agent is unsure about. The editor records the outcome there. "Your queue" is the Notion view of the rows still waiting for the editor.
read-back
The check after every write: the agent reads Notion again and confirms that each value landed and that no editor field changed.
regression case (earlier decision)
A claim the editor decided, kept as a permanent test: no rule change may make the agent get it wrong. This report calls it an earlier decision.
roles
Editor: decides the rows in the queue and types the commands. Rule owner: approves rule changes; for now the same person as the editor. Engineer: sets things up and fixes what breaks. Product owner: you, who took the decisions listed on the Summary.
rubric
The rulebook as a versioned file in the repository; Notion is compared with it before every step. Editors never see the word: in Notion it is the rulebook edition.
rule
One numbered statement in a tag's "When to use" text, for example Context-dependent rule 4. A lesson proposes a change to one rule.
rulebook
The written rules for each tag ("When to use"), kept in Notion as a copy of the taxonomy's Issue rows. The judge works from these rules and nothing else.
rulebook edition
The rulebook's version as editors see it: a date plus a count, such as 2026-10-15.1. It goes up when a rule changes.
simple gate, strict gate
The gate's two modes. The simple gate, the default, checks only the changed tag and reads each flipped claim twice more on each side. The strict gate, an option, adds statistics and needs about 30 decided examples of a tag.
skill
The /claim-tagger command in Claude Code, with subcommands such as tag and status. It runs the scripts and reports back in three parts. A second small skill builds the practice page.
source pass
A separate judge pass for the source tags. The agent first fetches each claim's sources and keeps a copy; then the model reads short excerpts, one claim per call.
stage
A place in the order of work: Stage 0 to Stage 3, then Later. A stage starts when the one before it is done; it is not a length of time.
table
Notion calls a table a database; this report says table.
tag
A label from the team's taxonomy that says something about a claim. Here, one of the 13 Issue tags, such as Context-dependent or Wordy. (tag is also the command that runs the judge.)
text tag, source tag, duplicate tag
Three kinds of tag by what they need. A text tag can be judged from the claim's wording alone. A source tag needs the text of the claim's sources. A duplicate tag (Exact duplicate, Semantically duplicated) needs a search across all claims.
taxonomy
The team's master table of claim tags ("Claim Tags, verified" in Notion). The agent never writes to it; the rulebook is a copy of its Issue rows.
text pass
The judge pass that decides tags from the claim's wording alone. The source pass decides the source tags.
the access token
The secret key that lets the agent's scripts read and write Notion. Today it also reaches 4 real tables it should not. Not the same as model tokens.
the four views
The saved Notion views, named the same on the practice page and the real page: Your queue (rows waiting, least sure first), Needs your note (a Why wrong without reasoning), Lessons waiting (rule changes, both texts side by side) and Rulebook.
tokens
The units of text a model reads and writes, a few characters each. Usage limits and the dollar figures in this report are counted in them.
usage window
The subscription's limit on how much Claude Code can do in a period. When it runs out, a run stops cleanly and resumes later where it left off. The runner is on the Max 20x plan; the window's size has not been measured yet.
Verified, Proposed
The status of a tag in the taxonomy. Verified: the team has approved it. Proposed: suggested, not yet approved.
walkthrough
A guided practice run of the whole loop on a practice page: 7 steps, with real claims and nothing real changed.
# Words used on one page
apply
Two meanings. A tag applies to a claim when the judge says it fits. The apply step carries out a plan's changes in Notion.
bootstrap
A statistical method that re-samples the decided examples many times to show how much an accuracy change could be luck. Strict gate only.
call
One request to the model. A judge call covers 8 to 16 claims.
CLI
Claude Code's command-line program, which the scripts use to call the model. Today its version is part of the label on saved answers.
connector
The Notion tools built into Claude Code, as opposed to the agent's own scripts. The agent never writes Notion through them.
decided positives
Decided claims where a tag applies. Statistics need enough of them: the strict gate waits for 30, and a tag counts in the gate from 5.
editor-owned fields
Tag outcome, Why wrong, Your reasoning, Editor wording, the Status values Approved and Rejected, Paused: no script writes them.
fetch, excerpt
Fetch: download the page behind a source link. Excerpt: the relevant paragraphs the judge is shown.
flipped claim, noise
A decided claim whose answer changes between the current and the proposed rules. Some flips are noise, so the gate reads each twice more on each side.
Geo ID, Geo Sources
Geo ID: a claim's identifier in Geo, the key for its rows. Geo Sources: the column that links to the claim's source pages in Geo.
guard hook
A small program Claude Code runs before every Notion tool call, so that only the agent's scripts can write to Notion.
headless run, output style, SKILL.md
Headless run: Claude Code run without a person, as a test. Output style: a setting that changes how replies are written; one adds commentary. SKILL.md: the skill's instruction file.
list price
What the same tokens would cost on the pay-per-use API. On the subscription nothing is billed per call.
majority vote
The MVP's way of settling an answer: the judge runs three times and the answer given by at least two runs wins. Adaptive runs replace it.
models: Opus, Sonnet
Claude models. Opus, the strongest, drafts lessons and first rules. Sonnet, faster, does the judging.
plan
A file listing every Notion change before it is made. Only a plan produced by a script may change Notion.
probe
A test that tries to open each Notion table with the agent's token and shows which ones it can reach. Protected tables must answer "not found".
prompt
The written instructions, rules and claims sent to the model in one call.
prompt caching
The model service stores the unchanging start of a prompt so later calls reuse it at lower cost: a cache read is the reused part, a cache write the part stored. Not the saved judge answers.
protected table
A Notion table the agent must never write to: the taxonomy, Claims to review, World affairs and the old hub. The probe checks that the token cannot reach them.
pull
Copy Notion tables into local files at the start of a step, so each step works from the same snapshot.
queue fields
The editor's answers on a queue row: Tag outcome (Applies or Does not apply), Why wrong (Agent slip, Rule unclear or Rule should change) and Your reasoning in words. Editor wording is the editor's own rewrite of a lesson.
rollback
Undo the most recent live lesson by restoring the previous wording of the rule; only a person confirms it.
swap
Later replacing the rulebook copy with the real taxonomy, once the copy has proved itself.
trust breaker
A check that stops the agent when a field the editor owns changes while it writes. In the minimal version it only warns.
wall clock
Real elapsed time, as opposed to the work the model does. This report gives no wall-clock estimates.
World affairs
The second claims table, to be added after U.S. Politics runs well.

