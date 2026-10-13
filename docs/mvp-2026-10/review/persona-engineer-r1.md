# Engineer persona review, round 1

13 Oct 2026, read-only. Read the repo, plan, decisions, log, evidence; in Notion the hub, Engineer notes, the six data sources and the Gate card "Gate 2026-10-13.2 · LS-1 (4)". Ran `node --test tests/` (713 pass, 0 fail), demos on a temp copy without `.env` against the tests' fake Notion, and a Stage/Direction re-implementation over the eight snapshots.

## Verdict

Clear to an engineer? The code, yes: atomic writes, a resumable content-addressed judge ledger, a paced REST client, an allowlist applied at build, check and apply, read-back verification, meaningful tests. The gate behaved honestly: five FAILs on LS-1 plus planted LS-2, and the Rulebook is identical in all eight snapshots. The operations, no. What stops me running it next Monday: "no Rulebook change without a gate PASS" is a flag inside the plan file, which the agent may write without a prompt; I replaced Predictive's rule text through `plan.mjs check` and `apply.mjs` with no gate (EN-1). I cannot resume or roll back from the Engineer notes (EN-2). The temporary token is unrotated and there is no remote (EN-3, EN-4). The PASS, finalize and rollback path has never touched real Notion (EN-14).

## Checks

| # | Result | Evidence |
|---|---|---|
| 1 | Editor fields refused; only configured sources written. Caveats EN-1, EN-12. | Tests "every editor-owned field is refused in every database…", guard "denied … in any spelling", apply "a plan that touches a protected database is refused"; my untampered plan: check exit 2. |
| 2 | Yes. | Only `pull.mjs` and `apply.mjs` build a client (grep); 3/s token bucket and Retry-After are tested; no SQL/rows/view mode in scripts. |
| 3 | Judge: I believe it (only in-flight batches are paid twice). Apply: yes after a kill, no after a transient create failure (EN-5). | Atomic file per cell keyed by config id; tests "--resume completes only what is missing", "a valid judgment file whose ledger row was lost counts as done". |
| 4 | Live values equal the plan formulas on 680/680 snapshot rows; paths below. | Re-implementation vs `evidence/notion/*/queue.jsonl`. |
| 5 | Matches, with divergences: C1 skips contested canaries; C4 HOLDs a target under 5 positives even with a positive interval; C5 adds human-only tags; `small_sample` is computed; M11 is symmetric, capped at 16 by a code default, excludes canaries, and extra runs are sticky (any claim with run-4…8 under a config uses them for all tags in later gates). Plan check "self-flip ≤ 5 %" fails silently (12.9 % on LS-1 (4)). | eval.mjs:276-351, promote.mjs:253-280 |
| 6 | Yes in code, tests and evidence; never exercised for real. Rollback rewrites rubric.json and lock before its Notion plan is applied. | promote.mjs:455-466; tests "finalize refuses until the plan is applied and verified", "rollback needs --confirm; … byte for byte". |
| 7 | None found. | grep of tree and `git log -p` for `ntn_`, `secret_`, `Bearer`: test placeholders only; `.env` untracked. `runs/` not inspected. |
| 8 | No (EN-2); commands below. | |

Stage, by precedence: To review ✓; Waiting for evidence ✓ (no hub view); Second opinion ✓ (nobody routed to it); Lesson proposed ✓ (stays after a FAIL); Closed via Fixed ✓ (not reverted by rollback); Closed via Agent right ✓ (hides that the row is a test); Regression case ✗ once the case turns contested or withdrawn (EN-6); Decided ✓ but undescribed.
Direction: Open (no outcome) ✓; Open (decided, no proposal) ✗; Agent right, Missed, Wrongly applied ✓ when the agent decided, misleading for an ask_editor lean, wrong for Read source first (EN-7).

Check 8, what I would type: `judge.mjs --items claims --run-id <id> --resume` with the original `--runs/--model/--rubric` (the notes' `--resume <run-id>` exits 2); `apply.mjs --run <id>` or `--retry`; `promote.mjs --finalize <id>` or `--abort <id>`; rollback: `pull.mjs --all`, `promote.mjs --rollback LS-n --confirm` (latest Live lesson only), `plan.mjs check --run <id>`, `apply.mjs --run <id>`, commit `rubric/` and `evals/`; trust breaker: `status.mjs --unpause --confirm`. The notes give none.

Cost per week at trial size, one lesson: about $5 notional (tag $2.06, distill $0.08, gate $2.3–2.7 with a cached baseline, reconfirmation $0.4–0.7); about $9 after a CLI update (EN-9). The binding limit is the usage window (a promote is about 50 Sonnet calls).

## Findings

| ID | Severity | Finding | Evidence | Suggested fix |
|---|---|---|---|---|
| EN-1 | must | Rulebook "When to use" is accepted whenever the plan header says `ctx {promote: true, gate: "PASS"}`; no PASS card is checked. Plan files are writable without a prompt; seed and restore flags work the same way. | allowlist.mjs:227, plan.mjs:256; `Write(agents/claim-tagger/runs/**)`. Demo: forged header, check exit 0, apply "verify clean", rule replaced. | Accept When to use only if PROMOTING.json names the run, its card is a non-smoke PASS and the text equals the candidate's; restore only locked text; seed only with `runs/SETUP`. Test it. |
| EN-2 | must | The Engineer notes are not a runbook, and `status.mjs` prints a wrong resume command for promote sub-runs (no `--rubric`, so judge refuses). | Notes "Files and resume"; `judge.mjs --resume <id>` exit 2; status-run-5 resume line; status.mjs:147-153. | Add an exit-code-to-command table; store the resume command in run.json; for promote children print the promote command. |
| EN-3 | must | The temporary token was pasted into chat; rotation is untracked. | plan.md "to be replaced afterwards". | Rotate it and record the date. |
| EN-4 | must | No remote: rubric, lock, history and cases live on one disk. | M1; `.gitignore` runs/. | Private remote before handover. |
| EN-5 | should | A create whose response is lost is retried inside the REST client and lands twice; the agent cannot delete the copy. | notion-rest.mjs:117-151. Demo: two "Run Z" rows, apply exit 2. The apply test stubs above the retry loop. | Never auto-retry `POST /pages`; re-query by key first; test through `createClient`. |
| EN-6 | should | Regression case stays after a case turns contested or withdrawn: `In regression suite` is never cleared. | Snapshot 08: 8114bb424f and c8b676c3cc Hypothetical show Regression case; their cases are `active:false, contested:true`. | cases-sync clears the date for inactive cases; describe Decided. |
| EN-7 | should | The plan's Direction counts Read source first as "not": an abstention reads Agent right (then Closed) or Missed. Today's new description says Open; no decided row shows which is live. | plan.md:60; Direction description. | Treat Read source first as no proposal; commit the formula (EN-13). |
| EN-8 | should | Two promotes can both PASS: PROMOTING.json is checked at start, written blindly at the end; version labels repeat. | promote.mjs:362-367, 501; concurrent gate runs today; four different candidates all labelled "2026-10-13.2". | Exclusive lock at start; re-check before planning; candidate hash in titles. |
| EN-9 | should | `cli_version` is in the config id: a CLI update re-judges everything and makes a paused promote unresumable. | judge.mjs:298-309, 606-608; promote.mjs:308-310. Cache held today only because the CLI stayed 2.1.296. | Pin the runner's CLI or keep the version as metadata. |
| EN-10 | should | The trust breaker fires on legitimate concurrent edits to a touched row; PAUSED and the weekly cap are machine-local and invisible in Notion; judge and propose ignore Paused. | verify.mjs:109-124; propose.mjs:590-604. | Check `last_edited_by` before pausing; write a Runs row on pause; count the cap from Notion. |
| EN-11 | should | The guard hook fails open: from another folder node exits 1, which is non-blocking. Never seen firing headless, where project allow rules are ignored. | Temp copy from `agents/`: exit 1; status-run-5.stderr "Ignoring 35 permissions.allow entries". | `"$CLAUDE_PROJECT_DIR"` path, a wrapper that denies on load failure, a hook smoke test. |
| EN-12 | should | The protected list holds two data-source ids; REST uses database ids; the taxonomy is missing. "Reaches only this page" is never checked. | `isProtectedDatabase` false for 7219756338b2…, 9e111d22c14e…, b65273e2-… | Allow only the six configured pairs; startup probe expecting 404 on real ids. |
| EN-13 | should | Notion contract unchecked: pull checks names and types, not option names, so renaming "Rule unclear" silently changes Stage and distill. Formula text is not in the repo. | pull.mjs:113-127; `Lesson status` in OPTIONAL_PROPERTIES although Stage uses it. | Check option sets in pull (exit 4); version the formulas. |
| EN-14 | should | The Rulebook-writing path has run only against the fake. | No PASS; Rulebook unchanged 00→08. | Rehearse PASS → finalize → follow-up → rollback on a scratch tag. |
| EN-15 | nice | Duplicated logic and magic numbers: a judgment-validity predicate copied 4 times; `followup.liveColumns` re-implements propose; two meanings of `oneLine`; 1900 hard-coded 7 times; status re-reads `.env` and calls the placeholder "configured". Dead: eval's second filename normaliser, `allowlist_sha`. | status.mjs:326-334 (status exit 0, pull exit 2 on the placeholder). | `lib/judgments.mjs`, `lib/text.mjs`, export `hasToken()`; delete dead code. |
| EN-16 | nice | Misleading texts: FAIL cards print a rollback command for a never-live lesson; Status says "Rolled back after a FAIL"; distill tests > 20 words, says 12; Baseline row shows PASS; README promises a connector fallback the skill forbids. | LS-1 (4) card; eval.mjs:550; distill.mjs:254; apply.mjs:165. | Rollback line only when live; align texts. |
| EN-17 | nice | Defensive or silent code: multi-shape readers hide contract drift; `loadToken` maps any error to "no token"; "overloaded" stops a run as a usage window; a title regex triggers auto-rollback. | propose.mjs:82, 276; claude.mjs:27; promote.mjs:67. | One validated row shape; retry overloads; an explicit demo flag. |

Count: 4 must, 10 should, 3 nice.

## Questions for the editor

1. When the agent was right and your decision became a test, should Stage say Closed or Regression case? What should Decided mean to you?
2. You chose "Rule should change" on 157d1128ad::Predictive although the agent agreed with your outcome. What should distill do with that?
3. After a FAIL, should the lesson stay Approved, return to Proposed, or be Rejected, and who restarts it?
4. Who picks up Needs evidence and Ask another editor rows, and from which view?
5. Do you edit Rulebook text in Notion? Any edit blocks the agent; would view-only access be acceptable?
6. Should deciding a row the agent is updating pause the agent?

## Questions for the orchestrator

1. Is the integration connected beyond the hub? Please record 404s for the protected databases and the taxonomy, and the rotation date.
2. Has the guard hook ever fired in a real session?
3. Why is `cli_version` in the config id, and is auto-update off?
4. Were today's concurrent gate runs deliberate? What stops two PASSes?
5. Where is the live Stage, Direction and Effective outcome text? Did Direction change today?
6. When will PASS → finalize → rollback run against real Notion, and is a remote planned?
