# Walkthrough verification, second run, 21 October 2026

An independent verifier, who did not build the practice page, built a fresh one and went through its seven steps as an editor would. The aim was to check the eleven issues the first verification found that morning (folder 13). The run took place on 21 October 2026, from 13:49 to 14:08 local time (10:49 to 11:08 UTC), on branch mvp-2026-11. The verifier could not write this file itself (the harness refuses report files from subagents); the engineer saved its text unchanged.

- **Commit.** `git rev-parse --short HEAD` gave `8293f96` when the run started. At 13:50:24 HEAD moved to `9939885`, 18 seconds before the first `start`. That commit changed only two evidence files, so the code under test is the code of `8293f96`.
- **How the commands ran.** Every command went through `node agents/claim-tagger-mvp/scripts/walkthrough.mjs` (W below). At steps 3 and 5 the verifier acted as the editor through `W decide` and `W approve`, which decision D31 allows on practice pages. The verifier ran no production script, sent no connector write, edited no code and made no commit.
- **The page.** "Claim tagger practice · verification 21 Oct, run 2", under the sub-page Demo tests: https://app.notion.com/p/Claim-tagger-practice-verification-21-Oct-run-2-400273e214eb8128928fcae51937a518. Demo id `20261021-1354-50b728`, edition at build 2026-10-21.1.
- **A first page that could not be used.** The brief's title, "Claim tagger practice · verification 21 Oct, second run", made `start` fail (new issue 1). That page was built in Notion: demo `20261021-1350-fda02f`, https://app.notion.com/p/Claim-tagger-practice-verification-21-Oct-second-run-400273e214eb816b85a4e515e5770030. It is left untouched under Demo tests and was used for nothing else. Nothing was deleted or archived.
- **What `list` said about the default page.** Before the build, `W list` marked "Claim tagger practice · product owner, 21 Oct afternoon" (under Demos, step 1) as "used by the demo commands". Its Next line was "type /claim-tagger demo status.", the right one for that page. After the build `W list` failed outright (new issue 1), so the default was checked two other ways:
  - `W where` without `--demo` recorded its run in that product owner page's folder. It made a read-only pull there and left a run record (`runs/20261021T105755Z-walkthrough-where`).
  - `pickDemo` from `lib/demo-profile.mjs`, called read-only, returned the same page. The two newer pages under Demo tests are skipped.
- **Linting.** Every editor report was linted with `lintReport`, and each one that printed came back clean.

## Step by step

| Step | Command | Exit | Report shape | What happened | Verdict |
|---|---|---|---|---|---|
| Before | `W list` | 0 | ok: sentence, 5-row 3-column table, Next | Default page: the newest page under Demos, not one under Demo tests. The Next line fits its step. | As promised |
| Start, brief's title | `W start --parent 3fa273e2…7051 --title "…, second run"`; the skill's recovery `W start --resume 20261021-1350-fda02f`; `W run --demo …fda02f status` | 1, 1, 0 | start: "Building the page." then a stop report (lint clean). Resume: nothing on stdout. Status: ok, but the page is not named. | The build finished: all seven phases done, state `ready`. Only the final report failed the lint: "line 9 holds a duration word: 'second'". The report still said "stopped before it was finished" and to ask again. The resume failed the same way and printed nothing. | Blocks this title (new issue 1) |
| Start | `W start --parent … --title "…, run 2"`, then `W verify --json`, `W where`, `W list`, `W where` (no `--demo`) | 0, 0, 0, **1**, 0 | start: progress line, then ok (3-row table). where: ok, two parts. **list: nothing printed.** | Built in 56 s. verify: `ok:true`, no problems, `fresh:true` (7 claims, 5 decided, 2 open, ledger 5, 2 linked views, 3 tabs). `where` on the new page: **step 1**, "type /claim-tagger demo status." `where` without `--demo` reached the product owner page. | Works; `list` is broken (new issue 1) |
| 1 | `W run status` | 0 | ok | Sentence, table (edition 2026-10-21.1, nothing waits, none, none yet) and Next line ("…demo tag…(step 2 of the practice page)") match the page's step 1. | As promised |
| 2 | `W run pull --all`, `W run judge --items claims`, `W run propose`, then `W verify --json`, `W where` | 0, 0, 0, 0, 0 | pull: an engineer line. judge: ok, Next ends with a full stop. propose: ok. | Tag report: "Carrying Context-dependent \| 2 claims (earlier decisions included)"; Next "decide your two claims in Your queue (link)". Both editor claims: Agent tags empty, "no tags / 1 waits for an editor · edition 2026-10-21.1", in Your queue (AI Force 0.55 first, press pool 0.81). The 5 earlier decisions agree with the editor. Ledger 5 → 7. verify clean. `where`: step 3, linking Your queue. propose's `run.json` resume line: `node agents/claim-tagger-mvp/scripts/walkthrough.mjs run --demo 20261021-1354-50b728 propose`. | Works; figures as the page's text says, with two small exceptions (new issues 2 and 3) |
| 3 | `W decide --claim presspool`, `W decide --claim aiforce`, `W where` | 0, 0, 0 | ok, ok (4-row, 2-column tables), ok | Exactly the four editor columns were written with the page's words, each logged in `editor-actions.jsonl` as planned and then done with read-back ok. Next lines: first "decide your remaining claim", then "type /claim-tagger demo distill." `where`: step 4. | As promised |
| 4 | `W run distill` | 0 | ok | One rule change: "Standing-role groups are identified; unknown names are not". Context-dependent rule 3, Clarify wording, Proposed, Current and Proposed text, two Supporting rows. Ledger copies on both rows (Tag outcome, Why wrong, Your reasoning, Decided under 2026-10-21.1). Rulebook unchanged. Next links Lessons waiting. | As promised |
| 5 | `W approve`, `W where` | 0, 0 | ok, ok | Status Approved, Editor wording empty, so the draft itself is tested. `where`: step 6, "type /claim-tagger demo promote." | As promised |
| 6 | `W run promote`, `W verify --json`, `W where` | 0, 0, 0 | ok | **PASS on the first safety check**: examples 10 of 10, earlier 5 of 5, yours 2 of 2. The card shows press pool Applies → Does not apply and AI Force Does not apply → Applies. Next: "look at step 7 on the practice page (https://app.notion.com/p/Claim-tagger-practice-verification-21-Oct-run-2-400273e2…a518); the demo is then complete." verify clean (7 decided, 0 open, 1 rule change). `where`: "you have been through all seven steps", Next: archive by hand. No FAIL, so the Editor wording path was not needed. | As promised |
| 7 | none (the follow-up ran inside promote) | n/a | n/a | Follow-up Fixed on both ledger rows. AI Force: Agent tags Context-dependent, confidence 0.90, "3 of 3 runs agree". Press pool: empty, confidence 0.61, "2 of 3 runs agree". Both notes: "nothing waits for an editor · edition 2026-10-21.2". No "disagrees" anywhere. | As promised |
| End | `W run pull --all`, `W list` | 0, **1** | pull: an engineer line. **list: nothing printed.** | The final pull confirms the tables below. `list` still fails on the title of the first page. | `list` is broken (new issue 1) |

**How step 2 compares with the page.** The page now says the figures differ from run to run, shows "1 of 1 runs agree" for a sure reading and never "3 of 3". This run is consistent with that text:

- **Press pool.** The first reading was unsure (Applies 0.68), so it was read again (0.93). Result: Applies, 0.81, rule 3, "2 of 2 runs agree". The page shows 0.80 and "1 of 1", and its text explains the second reading.
- **AI Force.** The three readings all differed: Can't tell 0.45 with no rule, then Applies 0.60 with rule 3, then Does not apply 0.30 with rule 5. Result: Can't tell, 0.55, "1 of 3 runs agree". This fits "may read it as Can't tell". Two things do not fit: the line cites a rule, and the reason argues the opposite (new issue 3).
- **The other five claims.** Agent tags and notes match the page's first table exactly. Agent confidence for four of them is 0.88 to 0.93. Dallas is 0.70, where the page says "0.75 or more" (new issue 2).
- **Calibration.** The run met every condition in the manifest: press pool Applies at 0.75 or more citing rule 3; AI Force Can't tell; all earlier decisions and example claims as expected; one change on rule 3; PASS on the draft; Agent notes at most two lines.

**What the tables hold at the end** (final pull `20261021T110530Z-pull`, `norm/`):

- **Claims.** Both open claims are Reviewed with the editor's columns as entered:
  - Press pool: no verified tag, Rule unclear, the page's sentence.
  - AI Force: Context-dependent, Rule unclear, the page's sentence.

  On those two claims the agent columns come from the follow-up, on edition 2026-10-21.2. Agent confidence was rewritten: press pool 0.81 → 0.61, AI Force 0.55 → 0.90. The five earlier decisions are unchanged and still name 2026-10-21.1, as the page's step 7 now says. Their audit notes carry the new wording:
  - CNN and Dallas: "…the editor confirmed this tag, which the agent had read the other way; no reasoning was recorded."
  - Kennedy: "…the editor did not confirm this tag, which the agent had applied; no reasoning was recorded."
  - All five notes end with a full stop.
- **Tag decisions (the ledger).** 7 rows. The two new rows keep the proposal from step 2 (press pool Applies 0.81, AI Force Can't tell 0.55). They hold the copied decision (Does not apply and Applies, Rule unclear, the editor's sentences, Decided under 2026-10-21.1) and Follow-up **Fixed**. The five audit rows are unchanged, with no Follow-up.
- **Rule changes.** 1 row, Status **Live**, Safety check result "PASS: examples 10/10, earlier 5/5, yours 2/2", Editor wording empty.
- **Rulebook.** Rule 3 is the proposed text. It now adds: "A group or body that every reader knows by its standing role ("the press pool", "Congress") counts as identified. Capital letters alone do not identify: a capitalised phrase that names no body readers know ("the AI Force") is still a kind and not which one." The mass-noun sentence follows, as before. Edition **2026-10-21.2** in the demo's `rubric.lock`; its CHANGELOG lists both editions.
- **Agent settings.** Rulebook edition 2026-10-21.2, Paused off, Last run summary "Promote · 21 Oct 14:04 · PASS".
- **Who wrote what.**
  - The propose, distill, promote, record and follow-up plans wrote only to the agent's columns of Claims, the ledger, rule-change rows (created Proposed, then set Live), the Rulebook's When to use (after the PASS) and Agent settings.
  - Only the two `decide` calls and `approve` wrote editor columns, each logged.
  - Every `run.json` resume line in the demo folder goes through `walkthrough.mjs run --demo 20261021-1354-50b728 …`. That includes `judge --resume …` and the promote sub-runs.

**Time per command, for the engineer:**

| Command | Time |
|---|---|
| start | 56 s |
| verify | 14 s each |
| where | 4 to 6 s |
| list | 12 s when it worked; 19 to 36 s when it failed |
| status | 3 s |
| Tag step in all | 43 s (pull 3, judge 27, propose 13) |
| decide | 7 to 8 s each |
| distill | 18 s |
| approve | 7 s |
| promote, with the follow-up | 82 s |

## The eleven issues of the first run, re-checked

1. **Commands without `--demo` acted on a test page: fixed.** `list` marked the newest page under Demos. `where` without `--demo` ran on that page, and `pickDemo` confirmed it. The two newer Demo tests pages, including this one, were never picked.
2. **Step 2's explanation did not match the agent's output: fixed.**
   - The page no longer promises "3 of 3" or a rule on both claims.
   - It says the figures differ from run to run and that the AI Force answer can go either way.
   - This run's press pool and AI Force readings fit that text.
   - Two small mismatches remain, in places the old issue did not cover (new issues 2 and 3).
3. **`where` never named step 1: fixed.** A fresh page reads "you are at step 1, Meet the demo", with Next "type /claim-tagger demo status."
4. **Demo `run.json` resume lines were bare production commands: fixed.** Every resume line in the demo folder goes through the wrapper with this demo id.
5. **The tag report could be misread: fixed.** It now says "2 claims (earlier decisions included)" and "Next: decide your two claims in Your queue (link)", word for word as in report-examples.
6. **Intermediate output of "demo tag": partly fixed.** The judge's Next line now ends with a full stop. The rest is unchanged, by design, since the skill relays only propose's report: pull still prints an engineer line with a run id, and judge still prints a report of its own.
7. **Mixed link forms: fixed for the form.** The promote Next line now uses `https://app.notion.com/p/<title>-<id>` like the other reports. It still opens the top of the page, not step 7 (the Your queue and Lessons waiting links carry an anchor).
8. **The seeded audit notes read oddly: fixed.** The notes say which way the editor went against the agent, never "the editor agreed", and all five end with a full stop.
9. **Two editions on the Claims table after step 7: fixed.** Step 7 now says the five earlier decisions keep their edition until the next tag run, and that Agent confidence follows the new reading. The follow-up writes Agent confidence (seen on both claims).
10. **The lesson title had no verb: not applicable.** It is the model's wording; this run's title, "Standing-role groups are identified; unknown names are not", has its verb.
11. **`list` and `decide` said too much: fixed.**
    - `list`'s Next line now fits the default page's step: "type /claim-tagger demo status." for a page at step 1, not the archive line.
    - `decide`'s Next line says "decide your remaining claim" after the first claim.
    - The 15 October pages still show "unknown", which troubleshooting now explains.

## New issues

1. **Blocking, for `W list` now, for every user. A page title that contains a duration word breaks `start`, and then `list`.**
   - **What triggers it.** The report lint treats "second", "minute", "hour", "day", "week" and "ms" as durations, so ordinary titles like "…, second run", "Onboarding day" or "Week 3" are affected. `start` accepts such a title and builds the whole page.
   - **Why it fails.** `sayable()` quotes a title that would fail the lint, but the page link's URL slug (`…/p/Claim-tagger-practice-verification-21-Oct-second-run-…`) repeats the word outside the quotes. Its final report then fails the lint.
   - **What the editor sees.** `start` exits 1 with a report saying the page "stopped before it was finished" and to ask again, although `demo.json` says `ready` with every phase done. The skill's recovery, `W start --resume <id>` once, fails the same way and prints nothing.
   - **What it does to `list`.** Because the same URL appears in `W list`'s table, `list` exits 1 with no output for everyone while that page is among the five newest. That is the case now: the page `20261021-1350-fda02f` sits under Demo tests and cannot be deleted. Until someone acts, the product owner cannot use `list` to see which page the commands reach. `where` does not name its page either (new issue 4).
   - **What still works.** The loop scripts fall back to a sentence without the page name: `status` on that page printed a clean report, with a warning on stderr. Promote's Next line on such a page would carry the slug too; that was not run.
   - **Not decided here.** Someone has to choose both the fix (refuse such titles at `start`, or keep link text out of the duration check) and what to do with the page already built.
2. **Cosmetic. Dallas at 0.70 where step 2 says "0.75 or more".**
   - The Dallas claim, an earlier decision, was read once at Applies 0.70, inside the unsure band. It was not read again because re-reads are capped at 30% of the claims (2 of 7), and the AI Force and press pool claims were closer to a coin flip.
   - The page does not mention the cap.
   - The judge report's "Unsure 2" (AI Force, Dallas) and "Re-read 2" (AI Force, press pool) count two different pairs, which an engineer may misread.
3. **Confusing (minor). The AI Force reason line argues against the agent's own answer.**
   - The answer recorded is Can't tell at 0.55. But Agent reasons shows the last of the three disagreeing readings, as propose is designed to do: "'The AI Force' is capitalized and reads as the name of a specific body, so the claim itself resolves it … no rule fires · Context-dependent rule 5 · 1 of 3 runs agree".
   - Can't tell appears nowhere on the Claims table, so an editor in Your queue reads a confident case for no tag.
   - The page's own example of a Can't tell line cites no rule.
4. **Cosmetic. `where` does not name the page it read.**
   - Without `--demo`, its sentence ("you are at step 1, Meet the demo") does not say which page it means. The page could only be found from its run folder.
   - With `list` down (issue 1), an editor has no report that says which page the commands reach.

## What worked as promised

- `start` (with a lint-safe title) built the page, five tables, the relation, two linked views and three tabs in under a minute. `verify` was clean all three times it ran: fresh, after the tag step and after the PASS.
- Every editor report that printed had three parts, or two where no table was needed, and linted clean. No report had a file path, run id, duration, cost or code. The saved reports match their `report.md` copies in the run folders.
- `where` named the true step every time: 1, 3, 4, 6 and complete. It linked Your queue at step 3.
- Every point the first run's eleven issues raised was checked; each now behaves as the fixes promise, except where marked partly fixed or not applicable above.
- The tag step, the decisions, distill, approve, the safety check (PASS on the first try) and the follow-up produced what steps 2 to 7 describe. Only agent columns were written, apart from the logged editor actions. The production tables were not touched, and nothing was committed.

## Evidence in this folder

- **Pages and lists:** `step0-list-before.md`, `step0-start-report.md` (+ `.stderr.txt`), `step0a-start-resume-report.md` (empty, + `.stderr.txt`), `step0b-titled-page-status-report.md` (+ `.stderr.txt`), `step0-start-report-run2.md`, `step0-where-report.md`, `step0-list-after-start.md` (empty, + `.stderr.txt`), `step0-where-default-report.md`.
- **Steps 1 to 7:** `step1-status-report.md`, `step2-pull-output.txt`, `step2-judge-report.md`, `step2-tag-report.md`, `step2-where-report.md`, `step3-decide-presspool-report.md`, `step3-decide-aiforce-report.md`, `step3-where-report.md`, `step4-distill-report.md`, `step5-approve-report.md`, `step5-where-report.md`, `step6-promote-report.md`, `step6-safety-check-card.md`, `step7-where-report.md`.
- **End and verify:** `end-pull-output.txt`, `end-list-output.md` (empty, + `.stderr.txt`), `verify-outputs.jsonl` (3 runs).
- **Run folders:** `agents/claim-tagger-mvp/runs/demos/20261021-1354-50b728/runs/` and `…/20261021-1350-fda02f/`, which git ignores.

**Overall verdict: yes, the walkthrough worked end to end on the second page, and the earlier fixes hold (nine fixed, one partly fixed, one not applicable). But a page title with a duration word breaks `start` and has now broken `W list` for every user, and that needs a decision before the next editor relies on `list`.**
