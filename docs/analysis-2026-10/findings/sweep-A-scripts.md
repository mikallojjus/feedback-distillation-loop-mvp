# Sweep A: the scripts pipeline (haiku Explore agent, 2026-10-14)

Verbatim report of the read-only sweep over `agents/claim-tagger/scripts/`. File references are as the agent wrote them.

## Summary

The judge makes one call per batch of up to 8 claims, and that call covers all 10 model-decided tags. Distill makes one call per tag/reason/rule group. The claims table is a single named object, but the code hard-codes its name in many places. The `--smoke` promote path does not use the cheap model as its comments claim. Nothing was modified.

All paths are absolute under `X:\work\geo-agents\agents\claim-tagger\`. Observed costs come from run folders in `runs\`.

## 1. Judge batching

- **Batch of 8 claims per call.** `scripts\judge.mjs:720` reads `batchSize: judgeCfg.batch_size ?? 8`. Config: `judge.batch_size = 8` in `config.json:72` (also `sandbox\config.json:65`). Batches are cut per run from pending items (`judge.mjs:794-809`). Each run shuffles with a seed of config id plus run number (`judge.mjs:796`), so batch membership changes between runs.
- **One call covers all model tags for its claims.** The system prompt lists every model-decided tag and the counterpart pairs (`judge.mjs:299-313`). Each claim's reply must contain every in-scope tag exactly once (`judge.mjs:477`, `prompts\judge.md:45`). There is no per-tag call.
- **Scope is set in code.** `scopeOf` (`judge.mjs:260-271`) takes judged tags minus `scope.code_decided_tags` (`config.json:137-141`) and `scope.human_only_tags` (`config.json:142-144`). Today 14 tags exist and 12 are judged. The model decides 10 (Context-dependent, Debate, Factual, Hypothetical, Multiple statements, Opinion, Predictive, Self-contained, Simple, Single core statement). Code decides Unsourced, Improperly sourced and Source inaccessible (`judge.mjs:368-381`, `880`). Editor verified is human-only. The only item filters are `--ids` and `--limit` (`judge.mjs:227-233`, `709-711`).
- **3 runs per configuration, majority applied later.** `runs = opts.smoke ? 1 : (opts.runs ?? judgeCfg.runs ?? 3)` (`judge.mjs:684`); config `judge.runs = 3` (`config.json:70`), `smoke_runs = 1` (`config.json:71`). Propose needs `floor(n/2)+1` agreeing runs, otherwise ask_editor, and any missing run gives error (`propose.mjs:116-145`). Eval needs strictly more than half, otherwise undecided (`eval.mjs:129-142`).
- **Retries and limits.** At most 2 attempts per batch, hard-coded (`judge.mjs:841`). The second attempt quotes the problems (`judge.mjs:423`, `844`). If both fail, every claim in the batch is written as status error (`judge.mjs:888-895`), and the next run retries it. The run fails if more than `judge.max_error_share = 0.1` (`config.json:78`) of cells error (`judge.mjs:923-924`).
- **Parallelism and timeouts.** `judge.concurrency = 2` (`config.json:73`; `judge.mjs:721`, `904-920`). `judge.timeout_ms = 300000` (`config.json:76`; `judge.mjs:722`). `judge.max_turns = 1` (`config.json:75`; `judge.mjs:723`).
- **Cache and ledger.** Cell files are `runs\judgments\<config16>\run-<n>\<item>.<text8>.json` (`judge.mjs:138`, `743`). A cell is reused only if the file is valid for that item, run, text and config (`judge.mjs:389-401`). The ledger is `...\judgments\<config16>\ledger.jsonl` (`judge.mjs:736`, `744`), with one writer enforced by a LOCK file (`judge.mjs:507-520`, `714`).
- **What the config id covers.** `config16` is the sha256 of `{driver, model, effort, prompt_version, rubric_hash, scope_hash, cli_version}` (`judge.mjs:316-328`; `hash.mjs:74-76`). The rubric version label is excluded (`judge.mjs:315`), and so are batch size, concurrency and timeouts. A change to model, effort, prompt bytes, rubric content or scope, or the CLI version starts a new folder and re-judges everything.
- **Volume.** The trial has 60 claims, so one run is 8 batches and a 3-run pass is about 24 calls. Observed: `runs\20261013T1800Z-tag-r1\run.json` has 180 cells and cost $2.06.

## 2. CLI and cost

- **Invocation** (`scripts\lib\claude.mjs:107-116`): `claude -p --model <id> --output-format json --tools "" --system-prompt-file <prompt> --max-turns 1 [--effort <e>] --permission-mode dontAsk --safe-mode --strict-mcp-config --no-session-persistence`. The claim text goes on stdin (`claude.mjs:298`). No shell is used (`claude.mjs:274`). `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` are stripped from the child environment (`claude.mjs:29`, `96-100`). On Windows the binary is found with `where`, preferring .exe (`claude.mjs:56-63`).
- **Models** (`config.json:64-68`): judge `claude-sonnet-5-5`; cheap `claude-haiku-5-5`, used only by judge `--smoke` (`judge.mjs:664`); distill `claude-opus-5-5` (`distill.mjs:437`). Effort is `medium` for judge (`config.json:74`, `claude.mjs:113`). Distill has no effort key, so it sends no `--effort` flag (`distill.mjs:318`).
- **Model check.** The pinned model must appear in the result's `modelUsage` (`claude.mjs:388-397`, `sameModel` at `246-251`), or the call is `model_mismatch` and the run exits 4 (`judge.mjs:495`).
- **Cost is not computed locally.** No price table or token arithmetic exists. Cost is `total_cost_usd` from the CLI result (`claude.mjs:353`), or the sum of `modelUsage[*].costUSD` if that is absent (`claude.mjs:354-357`). Judge adds every attempt's cost to the batch (`judge.mjs:846-847`). It writes the batch cost and `model_usage` into each judgment (`judge.mjs:815`), the per-claim share into the ledger (`judge.mjs:883`), and the total into run.json (`judge.mjs:764`) and the console line (`judge.mjs:930`). Promote writes it to the Runs row (`promote.mjs:514-516`, `564`). Status totals it (`status.mjs:236-259`).
- **Observed.** A fresh promote candidate of 72 claims x 3 runs (216 cells) cost $2.37 (`runs\20261013T1920Z-promote-ls1-candidate\run.json`). The baseline of the same live rubric cost $0 (cache hit).
- **Exit 75 detection.** `USAGE_WINDOW_RE = /usage limit|rate limit|429|quota|resets|overloaded/i` (`claude.mjs:27`). A non-zero exit, `is_error` or error subtype is `usage_window` if its text matches, otherwise `transient` (`claude.mjs:368-376`). A missing envelope or a short limit notice is also `usage_window` (`claude.mjs:377-387`). Judge stops the whole run and exits 75 (`judge.mjs:849-851`, `932-934`; `exit-codes.mjs:12`). Distill (`distill.mjs:323`) and promote (`promote.mjs:295`) do the same. `usageResetHint` pulls the "resets ..." text for the resume message (`claude.mjs:459-462`).

## 3. Distill batching

- **Input.** Decided rows of the pull whose Why wrong is Rule unclear or Rule should change, from the editor field or the seeded "Rule ...:" prefix (`distill.mjs:439`, `489`; `cases-sync.mjs:49`, `51`, `83-88`). Rows with no claim text are dropped with a note (`distill.mjs:490-491`).
- **Groups are tag x reason x cited rule** (`distill.mjs:149-167`). The rule number is parsed from the agent's notes (`cases-sync.mjs:70-77`). Rows that cite nothing join the one rule the others cite (`distill.mjs:157-159`).
- **Thresholds count distinct claims, not rows** (`distill.mjs:169`, `172-179`). Rule unclear needs `distill.min_claims = 2` (`config.json:95`). Rule should change needs `min_claims_rule_change = 3` (`config.json:96`), but at `owner_ruling_at = 2` (`config.json:97`) it still goes through and is flagged as resting on the owner's ruling (`distill.mjs:176-178`). This happens before any model call (`distill.mjs:502-506`).
- **Dedupe before the model.** If an active lesson (Proposed, Approved or Live) exists for the tag and a compatible rule, rows are only linked (`distill.mjs:507-517`). A Rejected or Rolled back lesson is revived only if at least 2 rows were decided after it (`distill.mjs:518-525`).
- **One call per group, run sequentially.** The loop is `distill.mjs:500-543`. The system prompt is `prompts\distill.md` (`distill.mjs:308`, `318`). The user message is the JSON from `buildInput` (`distill.mjs:200-215`, `332`): the tag entry, why_wrong, rule_cited, up to `MAX_GROUP_ROWS = 30` rows (`distill.mjs:56`, `211`) and up to `MAX_OTHER_ROWS = 12` other rows on the tag (`distill.mjs:55`, `526-527`). Text fields are clipped to 600 characters (`distill.mjs:195-198`).
- **At most two calls per group** (`distill.mjs:331-363`). One retry happens on an invalid reply, or when the proposed text repeats `distill.overfit_ngram = 8` consecutive words of a supporting claim (`config.json:98`; `distill.mjs:115-130`, `357-362`). A second overlap sets `overfit_risk` (`distill.mjs:426`, `609`).
- **Checks.** The rule number must exist (`distill.mjs:243`). Proposed text is at most 1900 characters (`distill.mjs:54`, `249`). The title is at most 20 words (`distill.mjs:254`). Current text always comes from the live rubric (`distill.mjs:268-277`).
- **Output.** There are no per-lesson files. `runs\<id>\lessons.jsonl` is validated against `schemas\lesson.schema.json` (`distill.mjs:572-575`, `600`). `plan.jsonl` (`distill.mjs:571`) gets one Rule changes create per lesson, with Status Proposed, Tag, Rule, Kind, Current text, Proposed text and Rubric version (`distill.mjs:576-579`), plus a Runs row "Distill <date>" (`distill.mjs:594-597`). `plan-link.jsonl` is written (`distill.mjs:601`), and `groups\NN-<tag>-<why>.group.json` records the exact prompt and replies (`distill.mjs:546-553`). `--link` builds a second plan that sets Tag decisions.Lesson (`distill.mjs:616-662`). `--demo-bad-lesson` creates a planted lesson with no model (`distill.mjs:457-486`).
- **Model and timeout.** Model is `config.models.distill` (`distill.mjs:437`). Timeout is `config.distill.timeout_ms ?? config.judge.timeout_ms ?? 300000` (`distill.mjs:315`), which falls back to the default because neither distill key is set.

## 4. Data sources and the claims table

- **Six databases, one object each, keyed by name.** `config.json:8-39` gives `database_id`, `data_source_id` and `key` for each. Claims is `config.json:14-18`: database_id `9418c3f625d24b439539f381b7ff03c2`, data_source_id `506dddee-af6e-4cbe-980f-a1ef1564d9bd`, key `Geo ID`. The sandbox copy is at `sandbox\config.json:15-19`. The name set is closed in code at `scripts\allowlist.mjs:16`.
- **Protected list.** `config.json:40-50` has nine ids in mixed dashed and undashed form. `isProtectedDatabase` (`allowlist.mjs:154-157`) is used by `pull.mjs:270`, `apply.mjs:145` and `hooks\guard.mjs:59`, `196`.
- **REST path uses database_id.** Queries go to `/databases/{id}/query` (`scripts\lib\notion-rest.mjs:188`). Retrieve is at `notion-rest.mjs:211`. Create uses `parent.database_id` (`notion-rest.mjs:243-245`, `apply.mjs:270`). Pull uses it at `pull.mjs:287-288` and `294`. The schema id check is `pull.mjs:136-137`. Probe uses it at `probe.mjs:62-63`.
- **Connector path uses data_source_id.** `plan.mjs:372` writes it into create batches. `hooks\guard.mjs:94` and `128` match calls against it.
- **Every consumer of the claims data_source_id value:** `plan.mjs:372`, `apply.mjs:145`, `pull.mjs:270`, and `hooks\guard.mjs:94` and `128` through the batch file. Nothing else reads it.
- **Every consumer of the claims key name:** `allowlist.mjs:16, 25-29, 60, 70, 90, 106, 115, 120`; `scripts\lib\notion-contract.mjs:38-43`; `pull.mjs:268, 287, 347-359` (the only claims file is `norm\claims.jsonl`, written at `358`); `judge.mjs:207-211, 539, 678`; `propose.mjs:421, 445-452, 632, 636`; `followup.mjs:121, 130, 226`; `seed.mjs:164, 197-206, 217`; `cases-sync.mjs:123`; `snapshot.mjs:23, 41, 53`.
- **Where a second Claims table would break:**
  - Names are closed. `DATABASES` (`allowlist.mjs:16`) and each per-name table in `allowlist.mjs:19-128` need an entry. `pull.mjs:264-266` rejects unknown names.
  - The norm file name is fixed. `norm\claims.jsonl` is read by `judge.mjs:209`, `propose.mjs:421`, `cases-sync.mjs:123` and `followup.mjs:130`. `pull.mjs:347-358` writes one file for one table.
  - Geo ID is the join key everywhere (`pull.mjs:348`, `353`; `propose.mjs:447`; `judge.mjs:211`). Relations such as `{claims: "<geo id>"}` resolve through `idMap.claims` (`plan.mjs:10`, `propose.mjs:636`). Duplicate Geo IDs across tables would fail the pull with exit 2 (`pull.mjs:232-235`, `416`).
  - A real content table must be listed in `protected_database_ids` before it goes into `databases`. Otherwise `apply.mjs:145` and `pull.mjs:270` treat it as a trial table.
- **Live gotcha.** `runs\pull\LATEST` names `20261013T190740Z-recard-post`, which holds no claims file. `resolvePullDir` returns LATEST without checking it (`judge.mjs:158-163`), so `judge --items claims` without `--pull` fails at `judge.mjs:209-210`.

## 5. Promote and gate

- **Flow.** A promote takes a lock (`promote.mjs:137-157`), builds a candidate rubric (`promote.mjs:215-223`, version at `171-178`), and judges items = distinct claims of active gate cases, the lesson's contested cases and active canaries (`promote.mjs:465-474`). The baseline (the live rubric, normally a cache hit, `promote.mjs:21`) and the candidate are each judged with `judge.runs` runs (`promote.mjs:479`, `488-489`, `279-301`).
- **Reconfirmation.** Flipped cases get `gate.reconfirm_runs = 5` extra runs per side (`config.json:110`; `promote.mjs:308-390`). At most `gate.reconfirm_max` = 16 are re-judged, a default in code (`promote.mjs:311`) that is not in config. It is skipped for smoke (`promote.mjs:505`).
- **eval.mjs makes no model calls** (`eval.mjs:2-3`). The five conditions are at `eval.mjs:681-755`:
  1. Every active canary passes under the candidate (`687-693`). There are 83 active canaries in `evals\canaries.jsonl`.
  2. No active case that passes under the baseline fails under the candidate (`695-700`). There are 37 active cases in `evals\cases.jsonl`.
  3. Each gated tag has at least `gate.min_positives = 5` positives (`config.json:102`; `eval.mjs:666`). Its paired-bootstrap 95% lower bound must be at least `-gate.tolerance = -0.05` (`config.json:101`; `eval.mjs:652`, `704`). Bootstrap B is 1000 (`config.json:103`), with ci [0.025, 0.975] (`config.json:104-107`). For ungated tags with changed rules, 3 negative flips (`config.json:109`; `eval.mjs:711`) give FAIL and 1 flip (`config.json:108`; `eval.mjs:714`) gives HOLD.
  4. The target is always the lesson's tag (`promote.mjs:496`). Upper bound at or below 0 gives FAIL. Too few positives, or a lower bound at or below 0, gives HOLD (`eval.mjs:730-747`).
  5. No apply on a human-only or unjudged tag (`eval.mjs:749-755`, `383-396`).
  - Verdict (`eval.mjs:757-759`, `781`; `exit-codes.mjs:10-11`): any fail gives FAIL (exit 11). Otherwise any hold gives HOLD (exit 10). Otherwise PASS (exit 0). Incomplete judgments give no verdict and exit 2 (`eval.mjs:556-574`). Cards are flagged "small sample" below 30 positives (`eval.mjs:59`, `765`).
- **Stats** (`scripts\lib\stats.mjs`): `pairedBootstrapDelta` (`29-49`), `exactMcNemar` (`51-72`), `selfFlipRate` (`77-82`). `wilson` (`5-15`) has no caller under `scripts\`.
- **gate-evidence.mjs does not compute the gate.** It checks from files that a plan's PASS, restore or seed claims are backed (`scripts\lib\gate-evidence.mjs:1-24`, `59-70`). It is called by `apply.mjs:104` and `plan.mjs:411`.
- **Model calls per gate.** The fresh candidate costs about runs x ceil(U/8) calls, where U is the number of distinct claims. Cases are not multiplied, because one call covers every tag for a claim. Reconfirmation adds at most 2 sides x 5 runs x 2 batches = 20. The baseline is usually 0. Observed for U = 72: 27 calls, $2.29-2.37 for a fresh candidate, and $0.15-0.70 of reconfirmation (`runs\20261013T2110Z-promote-ls1-d-reconfirm-*`, `runs\20261013T2150Z-promote-ls1-e-reconfirm-*`).

## 6. Propose

- **No model calls.** `propose.mjs:36` imports only helpers from judge.mjs. It refuses smoke runs (`propose.mjs:398`), unfinished runs (`399-401`) and rubric drift against rubric.lock (`402-405`).
- **Verdict per tag.** `decideVerdict` (`propose.mjs:116-145`) gives ask_editor without a majority and error for a missing run (`120`).
- **Uncertain means Low confidence** (`isLowConfidence`, `propose.mjs:179-184`). Any of these applies: ask_editor or error; cannot_tell on a non-source tag; runs not unanimous; or mean p strictly between `thresholds.t_skip = 0.25` and `t_apply = 0.75` (`config.json:82-83`; `propose.mjs:436-437`).
- **Rule changed** means the row's recorded rubric version differs from this run's and the proposed direction flips (`propose.mjs:539-541`).
- **Gate to a queue row.** A row is written only if one of those reasons holds (`propose.mjs:541-544`). Decided rows are never touched (`propose.mjs:517-527`).
- **Readiness** (`readinessOf`, `propose.mjs:211-217`). In order: Needs editor (ask_editor or error), then Fix needed (an applied tag whose polarity is in `readiness.fix_polarities = ["Issue"]`, `config.json:86-88`), then Not checkable (cannot_tell), else Ready. Tags with the no-source-text basis are ignored (`propose.mjs:498`, `520-521`).
- **Weekly cap.** `queue.weekly_cap_default = 40` (`config.json:91`) is overridden by the Agent settings "Weekly cap" (`propose.mjs:442`). Rows created in the ISO week are counted in `runs\state\queue-week.json` (`propose.mjs:591-603`, `647`). Rows over budget are held (`propose.mjs:602-606`; summary `held_by_cap` at `660`). Who gets the budget: priority rank High, Medium, Check source (`propose.mjs:44`), then non-error rows, then lowest mean p (`propose.mjs:604`).
- **Priority** (`priorityOf`, `propose.mjs:194-200`). Check source for source-reading tags. High for Rule changed. High for Low confidence leaning apply on an Issue tag. High for a full split (3 or more runs, all different). Otherwise Medium.
- **Length caps.** `queue.why_max_words = 40` (`config.json:92`; `propose.mjs:441`, `249-256`). `notion.max_text = 1900` (`config.json:54`; `propose.mjs:440`, `233-246`).

## 7. Sandbox

- **The state root is generic.** `CLAIM_TAGGER_ROOT` (`scripts\lib\paths.mjs:10`) is read by `agentRoot()` (`paths.mjs:21-24`). Config, rubric, evals and runs all hang off that root (`paths.mjs:38-40`, `allowlist.mjs:146-149`, `judge.mjs:644-645`). Code stays at `codeRoot()` (`paths.mjs:13-15`). `codeFile` prefers a root's own schema or prompt copy (`paths.mjs:31-35`), so a profile can shadow them. The Notion token always comes from the repo `.env` (`paths.mjs:27-29`; `notion-rest.mjs:261`, `284-291`).
- **A third profile is mechanically possible.** Create a folder with `config.json`, `rubric\`, `evals\` and `runs\`, and set `CLAIM_TAGGER_ROOT`. No script code changes. Nothing automates it.
- **Sandbox-specific pieces:** `sandboxRoot()` is `codeRoot()\sandbox` (`scripts\sandbox.mjs:34`). The script allowlist is `SCRIPTS` (`sandbox.mjs:32`). `init()` builds from `walkthrough.json` (`sandbox.mjs:89-122`). `runScript` sets the variable for the child process (`sandbox.mjs:126-142`, `136`). The CLI only ever runs the sandbox root (`sandbox.mjs:167`).
- **Config drift.** The sandbox config has no `setup_page_parents`, `setup_content_pages` or `walkthrough_page_id` (present in `config.json:55-62`). The guard's setup-page path therefore cannot run there (`hooks\guard.mjs:223-250`).

## 8. Other scripts

| File | What it does | Role |
|---|---|---|
| `seed-build.mjs` | Builds `evals\seed\*` from the research exports, offline. | One-time setup |
| `seed.mjs` | Phase 1-3 plans: Rulebook and Agent settings, then Claims, then Tag decisions. | One-time setup |
| `rubric-init.mjs` | Day-0 rubric from the research snapshot with names scrubbed. | One-time setup |
| `cases-sync.mjs` | Rebuilds `evals\cases.jsonl` from decided rows and sets In regression suite. Called by promote finalize and distill `--link`. | Loop |
| `snapshot.mjs` | Copies norm files into `docs\mvp-2026-10\evidence\`. | Evidence |
| `recard.mjs` | One-off re-render of Runs summaries after the 13 Oct wording change. | Demo/evidence |
| `run-card.mjs` | Writes a Runs row for a tag run or an eval card, with Baseline, Smoke or Rollback kinds. | Bookkeeping |
| `transcript-check.mjs` | Summarises a headless stream-json transcript: tools, Bash, connector calls, cost. | Evidence |
| `verify.mjs` | After apply, checks each op landed and no editor field changed (exit 5 writes `runs\PAUSED`). | Loop (`promote.mjs:657-660` needs verify.json) |
| `probe.mjs` | Read-only token check: protected ids must answer 404/403, configured ids 200 (`EXPECTED_TITLES` at `:38`). | Evidence, useful preflight |
| `followup.mjs` | After a lesson goes Live, re-judges its claims and marks supporting rows Fixed or Still wrong. | Loop |
| `status.mjs` | Local report, `--check` preflight and resume commands. | Operator loop |
| `plan.mjs` | Plan builder, arming and checks. | Loop core |
| `apply.mjs` | Sends an armed plan through REST, then reads back. | Loop core |
| `allowlist.mjs` | Library: write allowlist and database lists. No entry point. | Library |
| `hooks\guard.mjs` | PreToolUse hook: denies connector writes unless they match an armed plan. | Enforcement |

Demo or evidence only: snapshot, recard, transcript-check, probe (keep as a preflight), run-card (Baseline, Smoke, Rollback rows), `distill --demo-bad-lesson` (`distill.mjs:457-486`) and promote's planted-demo handling (`promote.mjs:76`, `537-538`, `598-612`). One-time setup: seed-build, seed, rubric-init, sandbox init.

## 9. Size (wc -l)

eval.mjs 950; judge.mjs 949; seed-build.mjs 897; promote.mjs 879; distill.mjs 716; propose.mjs 680; status.mjs 591; plan.mjs 481; pull.mjs 480; lib/claude.mjs 462; cases-sync.mjs 419; apply.mjs 355; lib/gate-evidence.mjs 334; followup.mjs 307; lib/rubric-build.mjs 300; lib/notion-rest.mjs 296; hooks/guard.mjs 282; seed.mjs 277; allowlist.mjs 256; probe.mjs 241; lib/notion-values.mjs 228; verify.mjs 216; lib/validate.mjs 191; sandbox.mjs 170; rubric-init.mjs 158; lib/jsonl.mjs 150; lib/pyjson.mjs 127; run-card.mjs 122; snapshot.mjs 116; recard.mjs 115; lib/notion-contract.mjs 107; transcript-check.mjs 86; lib/stats.mjs 82; lib/hash.mjs 76; lib/paths.mjs 74; lib/rng.mjs 36; lib/exit-codes.mjs 30. Total 11,954 for scripts plus lib, 12,236 with the hook.

## Problems found while reading

1. **`promote --smoke` does not use the cheap model.** `promote.mjs:279-287` never passes `--smoke` to judge, so the rehearsal runs `config.models.judge` with `smoke_runs` runs (`promote.mjs:479`) and the run is not flagged smoke (`judge.mjs:768`). This contradicts `promote.mjs:21` and `judge.mjs:12`. No promote smoke run is recorded under `runs\`, so this comes from reading the code. Consequence: `propose.mjs:398` refuses only runs flagged smoke, so it would accept such a run.
2. **`judge --smoke` hard-codes one run** (`judge.mjs:684`), while eval (`eval.mjs:422`) and promote (`promote.mjs:479`) read `judge.smoke_runs`. They disagree if that value is not 1.
3. **The usage-window regex is broad** (`claude.mjs:27`). An "overloaded" or 429 reply ends the whole judge run as "usage window ran out" with exit 75 (`judge.mjs:849-851`, `906`) instead of retrying. The retry path covers only other errors (`judge.mjs:852-858`).
4. **Config keys with no reader.** `notion.max_creates_per_call` (`config.json:53`; `sandbox\config.json:54`) is unused, since `plan.mjs:41` hard-codes `MAX_BATCH = 100`. `notion.hub_page_id`, `databases_page_id`, `engineer_notes_page_id` and `walkthrough_page_id` (`config.json:5-7`, `62`) have no reader. `distill.effort` and `distill.timeout_ms` are read but unset.
5. **`sandbox.mjs:32` lists `allowlist`**, which has no entry point, so `sandbox.mjs allowlist` exits 0 silently.
6. **Doc tension on protected ids.** `AGENT.md:45` says the protected list holds both database and data-source ids. `probe.mjs:15` says only database ids make the probe meaningful. The probe checks database_id only (`probe.mjs:62-63`), while the guard and pull check both.
