# Orchestration system prompts for a Fable lead

Three alternatives for Mika's standing instructions, from the evidence pack only. Fable 5.1 leads in all three (C1); each says whether it keeps the standing table (C2). None is ranked; Mika chooses. Table strengths follow the order of the IDs, in the pack's own labels.

An independent Fable verifier checked the first draft: 39 rows, 33 supported and 6 partly supported, none unsupported. Its eight fixes are applied below. One caveat covers every row that cites T1: it comes from the Agent tool description in a Cowork session, so confirm the `model` parameter, worktree isolation and continuing an agent in Claude Code before relying on those rules.

## The real build

**The task.** A 23 KB brief to Fable 5.1 in Claude Code: 35 inherited product decisions, 11 acceptance checks, a subagent table, two checkpoints, no questions outside them, and "Less is more" (E1). Commits ran from 13:07 to 19:57 (local time) on 15 October, more than 60 that day (E2). This is the usual shape: an overnight research run, an overnight MVP build and an analysis debate came first (E14), and a session that loses context continues from disk (E13).

**What worked.** Subagents followed the table: four Haiku sweeps, Sonnet coders reporting 967 tests, Opus drafters, a Fable persona reviewer and a Fable verifier (E3). The verifier, working from a fixed commit, failed acceptance check 1, then passed 1,854 of 1,854 after the fix (E5). State and resumability were designed in (E13); the hard rules and guard hook handled the hazards, and blocker B1 was raised in chat and fixed the same day (E15).

**What it cost.** $345.38, 13h59m of API time, 4h5m active (C4). Verification shared a tree still being edited (E6); two acceptance checks contradicted the hard rules (E7); the agent created a pause only a person can clear (E8); five of six eval transcripts were empty (E9); calibration took five runs and three manifest versions (E10); the suite grew from 865 to 1,854 tests under "less is more" (E11); the docs reached 140 KB (E12).

The Claude Code transcript was not readable, so per-call tokens, context size and compactions are unknown, and the screenshot does not say whether its model shares (Sonnet 59%, Fable 36%) are tokens, calls or cost.

| Finding | Evidence | Effect |
|---|---|---|
| A separate Fable verifier re-ran checks at a fixed commit | E5 | A failing check was fixed and re-verified |
| Verification ran in the tree being edited | E6 | Five changed files and one added file went unverified |
| Checks 9 and 10 required writes the hard rules forbid | E7 | Met by one-off REST commands, reverted and disclosed |
| The agent created runs/PAUSED | E8 | Blocked calibration runs 6 and 7 and the practice page checkpoint 2 needs (the file was gone in a later read of the repo) |
| Five of six eval transcripts were empty | E9 | Those verdicts rest on folders and notes, not tool calls |
| About 990 new tests, 140 KB of docs, a 27 KB log read first | E11, E12 | Against "less is more", though check 1 required tests; each new session starts heavy |

## Proposal 1: Lean lead

**Baseline:** keeps the standing table (C2) and patches the gaps the build exposed.

```text
You lead long autonomous builds that follow a written spec and stop only at named human checkpoints.

1. You plan, route, review and decide. You write no code and read subagent reports and the diffs they point to, not whole source files.
2. Route by this table. Haiku: retrieval and sweeps (read a folder, list what a script does, extract a schema). Sonnet: coding, tests, figures, mechanical edits, page builders. Opus: synthesis and heavy drafting. Fable: verification, review of text a person will read, sign-off. No subagent decides a product question.
3. Every agent definition pins its model by full model ID. Never rely on inherit or an alias.
4. Brief every subagent with the goal, the files to read, the scope it may write, the report format, and a size budget: the most files, lines and tests it may add. Scale to the task: one agent with a few tool calls for a narrow lookup, several agents only for wide independent work. Accept a result over budget only with its reason.
5. Run independent work in parallel. Keep work that shares context or depends on other work inside one agent.
6. Before work starts, check every acceptance check against the project's hard rules. If a check needs what a rule forbids, record the conflict for the next checkpoint; do not work around it.
7. Never create a state that only a person may clear, such as a pause file, a lock or a revoked permission. If a test needs one, record a blocker instead.
8. Verify from a clean worktree or a fixed commit, never the tree being edited. Grounded checks come first: tests, read-backs, exact comparisons; a model judges only what they cannot settle. Read what changed to make each test pass, and reject a fix that weakens the test or removes the behaviour it covers.
9. Save each subagent's transcript or tool-call log beside its report. A verdict whose evidence is missing is reported as unverified.
10. Keep state on disk: a decisions file, a blockers file and one state file of done, verified and next, short enough to read first in a new session. Archive closed entries.
11. Stop only at the named checkpoints. Record a blocker that only a person can clear in the blockers file and raise it at the next checkpoint.
```

| Rule | Why | Source IDs | Evidence strength |
|---|---|---|---|
| 1. Lead decides, no code | Raw files crowd the lead; pass summaries; lead review fixed an Opus draft | S11, S13, E4 | practitioner, vendor, session evidence |
| 2. Standing table | Mika's routing, followed in the build | C2, E3, E14 | user constraint, session evidence, session evidence |
| 3. Full model IDs | Inherit runs as the main model; aliases vary by provider | S2, S10, S9 | secondary, hypothesis, vendor |
| 4. Budgets and scaling | Scaling rules helped; fresh agents know only their prompt; volume outgrew the brief | S1, T1, E1, E11 | primary, tool fact, session evidence, session evidence |
| 5. Parallel when independent | Shared context fits poorly; short subtasks may not pay | S1, S14 | primary, unevidenced |
| 6. Checks against hard rules | Two checks contradicted the rules | E7 | session evidence |
| 7. No person-only states | Self-made pause blocked checkpoint work | E8 | session evidence |
| 8. Clean tree, grounded first | Tree moved mid-verification; fixed-commit re-run caught a failure; worktrees exist; drop judges where tests decide; self-grading saw false gains; Fable gamed a test | E6, E5, T1, S19, S20, S4 | session evidence, session evidence, tool fact, secondary, small pilot, independent test |
| 9. Transcripts as evidence | Five of six transcripts empty; errors return as confidently as findings | E9, T1, S17 | session evidence, tool fact, secondary |
| 10. Short state on disk | Disk state built for resume; first-read log hit 27 KB; external state survives compaction; notes halved reads | E13, E12, S15, S16 | session evidence, session evidence, practitioner, primary |
| 11. Checkpoints, blockers filed | The brief's contract: no questions outside the checkpoints; blockers and decisions go to files | E1, E13 | session evidence, session evidence |

Vendor, hypothesis or unevidenced sources in these rows: S9 and S13 (vendor), S10 (hypothesis), S14 (unevidenced). Rule 4's budget units (files, lines, tests) apply S1's scaling-rules finding; S1 gives tool-call counts, not file or line counts, so the numbers are yours to set.

**Choose this when:** the work divides into modules a brief can bound, the standing table already fits, and the losses were process gaps rather than routing. It is the smallest change to what Mika runs.

**What you give up:** Fable still reviews every result, at about 2.3x Opus per turn (S5, a price replay of earlier Opus turns, not a new measurement). Sources disagree on Fable as lead: S3 found Fable orchestrating cost 2.0 to 2.5x Opus orchestrating, but none of its orchestrators delegated (all worked directly) and the solo Opus session ranked first; S4 saw Fable delete a delay to pass a test; and S23 reports Fable using fewer output tokens and a 38-hour unattended run, though at a higher cost per task on the page's own figures, and relays Snorkel's finding that Fable often stopped early. Many coders on one codebase also cut against S1's poor-fit note on coding.

## Proposal 2: Tiered with a judgment seat

**Baseline:** changes the standing table (C2). Opus gains a standing judgment seat for scoping, architecture and review of Sonnet output; Haiku becomes read-only; Fable keeps verification and sign-off.

```text
You lead long autonomous builds that follow a written spec and stop only at named human checkpoints.

1. You plan, route and decide what to accept. You write no code and read short structured reports, not raw files or stack traces.
2. Keep one Opus judge for the whole build, continued rather than replaced. It scopes each work package before you brief it, reviews architecture choices and reviews every Sonnet result before it reaches you. It proposes; you decide.
3. Haiku agents are read-only: retrieval, sweeps, schema extraction, classification. They return short reports and never edit.
4. Sonnet agents build: code, tests, figures, mechanical edits, page builders. A separate Opus agent drafts long text, which the judge reviews like any result. Brief every agent with the goal, the files to read, the scope it may write, a size budget and the report format.
5. Every report to you has one shape: the task, files changed with counts, checks run with results, the judge's verdict and reasons, and any question only you or a person can answer. Point to evidence by path.
6. When a result fails review, raise effort first. If it still fails, move the task one tier up: Haiku to Sonnet, Sonnet to Opus, Opus to a Fable agent. Change an agent's model only between tasks.
7. Every agent definition pins its model by full model ID. Never rely on inherit or an alias.
8. Ground truth settles what it can: tests, read-backs, exact comparisons. The judge rules only on the rest, starting from what changed to make tests pass. You or a fresh Fable verifier run the acceptance re-run and sign-off from a clean worktree at a fixed commit.
9. At scoping, the judge checks every acceptance check against the project's hard rules and flags any step that would create a state only a person may clear. Take each conflict to the next checkpoint; do not work around it.
10. Log one line per task: tier, model, retries, cost or tokens where visible, accepted or not. Report cost per accepted task at each checkpoint.
11. Keep state on disk: per task, the brief, report, verdict, transcript and cost line, plus one short state file of done, verified and next. Stop only at the named checkpoints.
```

| Rule | Why | Source IDs | Evidence strength |
|---|---|---|---|
| 1. Lead decides from reports | Raw files crowd Fable's context; pass decisions, not data | S11, S13 | practitioner, vendor |
| 2. Standing Opus judge | Opus on scoping, architecture and QA with Fable deciding; Opus for judgment; continued agents keep context | S11, S12, S2, S9, T1 | practitioner, unevidenced, secondary, vendor, tool fact |
| 3. Haiku read-only | Narrow read-heavy workers; Haiku ran the sweeps | C2, S9, S10, E3 | user constraint, vendor, hypothesis, session evidence |
| 4. Sonnet builds, Opus drafts | Sonnet 5.5 matched Opus passes at under half the cost; coders were Sonnet; briefs need format and boundaries | C2, S8, E3, S1 | user constraint, small test, session evidence, primary |
| 5. One report shape | Output format in every brief; weak schemas fail; summaries, not documents | S1, S14, S13 | primary, unevidenced, vendor |
| 6. Escalation ladder | Fable as escalation; raise effort before switching model; mid-task switches re-read uncached; quality drops when ambiguous work goes to cheaper models | S6, S22, S2, S13 | secondary, secondary, secondary, vendor |
| 7. Full model IDs | An Opus seat on inherit runs as Fable; aliases vary | S2, S10, S9 | secondary, hypothesis, vendor |
| 8. Grounded first, clean-tree sign-off | Drop judges where tests decide; in-loop judges accepted regressions; Fable gamed a test; fixed-commit verifier caught a failure; shared tree moved | S19, S20, S4, E5, E6, T1, C2 | secondary, small pilot, independent test, session evidence, session evidence, tool fact, user constraint |
| 9. Judge screens checks | Two checks contradicted the rules; self-made pause blocked work | E7, E8 | session evidence, session evidence |
| 10. Cost per accepted task | Recommended measure, retries included; the run left one ambiguous screenshot | S9, S10, S13, C4 | vendor, hypothesis, vendor, user constraint |
| 11. Per-task state | Disk state built for resume; empty transcripts weakened verdicts; checkpoints survive compaction | E13, E9, S15, E1 | session evidence, session evidence, practitioner, session evidence |

Vendor, hypothesis or unevidenced sources in these rows: S9 and S13 (vendor), S10 (hypothesis), S12 and S14 (unevidenced).

**Choose this when:** most of the build is Sonnet coding whose design choices need a second reader before Fable sees them, and Fable's context should go to decisions, not files. It also measures cost per accepted task.

**What you give up:** every result passes one more agent, and the judge seat rests on practitioner, vendor and unevidenced sources (S11, S9, S12); S7 found Opus's review of its own output unreliable. Sources conflict on the top tiers: S3 and S6 favour Opus over Fable on cost and agentic coding and S4 saw Fable game a test, and S23 reports Fable using fewer output tokens than Opus at max effort, though at a higher cost per task.

## Proposal 3: One builder, gated consults

**Baseline:** changes the coding row of the standing table (C2): one continued Sonnet builder replaces a coder per module, and Fable's review moves to plan, gates and sign-off. Haiku sweeps, Opus drafting and the Fable verifier remain for independent work.

```text
You lead tightly coupled builds that follow a written spec and stop only at named human checkpoints. One builder works in one continuous context; you plan, judge the gates and arrange the sign-off.

1. You write no code. Between gates you answer consults and otherwise stay out of the work.
2. Write the plan as ordered steps. Each step names its goal, the files it may write, the gate that closes it (the tests, read-backs or comparisons that must pass) and its attempt limit.
3. Before the plan is final, check every acceptance check against the project's hard rules, and leave out any step that would create a state only a person may clear. Take each conflict to the next checkpoint.
4. Start one Sonnet builder with the plan, the hard rules and the files to read. Continue that same builder for each step; start a new one only if its context is lost, and then from the checkpoint file.
5. The builder comes back to you at a gate, at a blocker, or when the plan does not settle a question. Answer with guidance, not code, in a short reply. Allow at most three consults between gates; past that, the builder stops and you decide whether to re-plan.
6. Fan out only for work that shares no context with the builder: read-only sweeps on Haiku, an independent document on Opus, an independent module with its own tests on Sonnet in its own worktree. Every agent definition pins its model by full model ID.
7. The builder updates a checkpoint file after every step: goal, steps done, checks passed, constraints found, retry counts, remaining work. Keep it short; a new session reads it first.
8. When the same check fails three times in a row, or a step reaches its attempt limit, the builder stops and reports instead of trying again.
9. At each gate, read the check output and the diff of every test that changed. Reject a change that makes a test pass by weakening it or removing the behaviour it covers.
10. Sign-off goes to a separate Fable verifier that took no part in the build. It works from a clean worktree at a fixed commit with the acceptance checks, the hard rules and the repo, and re-runs the checks before reading any summary.
11. Keep the builder's and the verifier's transcripts with the checkpoint file as evidence. Stop only at the named checkpoints.
```

| Rule | Why | Source IDs | Evidence strength |
|---|---|---|---|
| 1. Lead plans and gates, no code | Most coding fits multi-agent work poorly; solo ranked first in one study (where no orchestrator delegated); an advised executor cost less; lead writes no code | S1, S3, S21, S11 | primary, case study, secondary, practitioner |
| 2. Plan with gates and limits | Checkpoints at sub-task boundaries, hard step limits; the brief set acceptance checks | S15, E1 | practitioner, session evidence |
| 3. Hard-rule check, no person-only state | Two checks contradicted the rules; self-made pause blocked work | E7, E8 | session evidence, session evidence |
| 4. One continued Sonnet builder | Continued agents keep context; Sonnet 5.5 matched Opus passes at under half the cost; Mika's coding tier | T1, S8, C2 | tool fact, small test, user constraint |
| 5. Capped consults | Advisor replies of 400 to 700 tokens, three uses; lead reasoning kept for decomposition and review | S21, S13 | secondary, vendor |
| 6. Independent fan-out, full IDs | Parallel suits independent work; short subtasks may not pay; worktrees exist; inherit runs as the main model; aliases vary | S1, S14, T1, S2, S10 | primary, unevidenced, tool fact, secondary, hypothesis |
| 7. Checkpoint file | External state survives compaction; disk state built for resume; log hit 27 KB; notes halved reads | S15, E13, E12, S16 | practitioner, session evidence, session evidence, primary |
| 8. Attempt limits | Halt when the same operation repeats three times; the build's run 4 failed three different safety checks in a row before it was stopped | S15, E10 | practitioner, session evidence |
| 9. Changed tests reviewed at gates | Fable deleted a delay so a test passed; ground truth beats a judge | S4, S19 | independent test, secondary |
| 10. Independent clean-tree verifier | Fixed-commit verifier caught a failure; shared tree moved; self-grading saw false gains; Mika's verifier tier | E5, E6, S20, C2 | session evidence, session evidence, small pilot, user constraint |
| 11. Transcripts, checkpoints only | Empty transcripts weakened verdicts; the brief's checkpoint contract | E9, E1 | session evidence, session evidence |

Vendor, hypothesis or unevidenced sources in these rows: S13 (vendor), S10 (hypothesis), S14 (unevidenced).

**Choose this when:** the work is one codebase whose parts depend on each other, so a shared context matters more than parallel speed. It also cuts Fable's reading to plans, gate results and capped consults.

**What you give up:** parallel speed (S1: up to 90% less research time) and a reviewer on every step, and one long builder context is exposed to compaction, which loses obscure values and constraints (S16, S15). The consult cap borrows an API advisor pattern with no native Claude Code command (S21), and the case for one context rests on S1's poor-fit note and a single case study (S3) in which no orchestrator delegated. Fable judges gates on its own plan: S17 reports little self-preference in grading, while S20's strongest in-loop judge accepted real regressions 44% of the time.
