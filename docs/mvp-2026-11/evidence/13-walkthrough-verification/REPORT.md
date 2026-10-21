# Walkthrough verification, 21 October 2026

An independent verifier, who did not build the practice page, built a fresh one and went through its seven steps the way an editor would. The run was on 21 October 2026, from 12:37 to 12:50 local time (09:37 to 09:50 UTC), on branch mvp-2026-11 at commit `64d7154`, with a clean working tree. Every command went through `node agents/claim-tagger-mvp/scripts/walkthrough.mjs` (W below) with `--demo 20261021-1237-c23118`. At steps 3 and 5 the verifier acted as the editor through `W decide` and `W approve`, which is allowed on practice pages (decision D31). The page is "Claim tagger practice · verification 21 Oct" under the sub-page Demo tests: https://app.notion.com/p/Claim-tagger-practice-verification-21-Oct-400273e214eb8126bf20cd1f1337681e (demo id `20261021-1237-c23118`, edition at build 2026-10-21.1). The verifier ran no production script, sent no connector write, edited no code and made no commit. Every report.md was linted with `lintReport` from `scripts/lib/report.mjs`, and every lint came back clean (`[]`). The verifier could not write this file itself (the harness refuses report files from subagents); the engineer saved its text unchanged.

## Step by step

| Step | Command | Exit | Report shape | What happened | Verdict |
|---|---|---|---|---|---|
| Start | `W start --parent 3fa273e2…7051 --title "…verification 21 Oct"`, then `W verify --json`, `W where` | 0, 0, 0 | ok: sentence, 3-row table, Next | The page and its five tables were built in about a minute. verify: `ok:true`, no problems, `fresh:true` (7 claims, 5 decided, 2 open, ledger 5, 2 linked views, 3 tabs). `where` said **step 2**, although the start report says "follow step 1". | Works; the step `where` names is confusing (issue 3) |
| 1 | `W run status` | 0 | ok | The sentence, the table (edition 2026-10-21.1, nothing waits, none, none yet) and the Next line ("…demo tag…(step 2…)") match the page's step 1 word for word. | As promised |
| 2 | `W run pull --all`, `W run judge --items claims`, `W run propose`; then `W verify --json`, `W where` | 0, 0, 0, 0, 0 | propose: ok. pull prints an engineer line; judge prints its own report, whose Next line has no full stop | The agent read all 7 claims, with 0 unsure and 0 re-read. Both editor claims: Agent tags empty, Agent notes "no tags / 1 waits for an editor · edition 2026-10-21.1", in Your queue. The 5 earlier decisions agree with the editor. Ledger 5 → 7. verify clean; `where`: step 3 with the Your queue link. **But** the AI Force claim was read as Does not apply at probability 0.25: confidence 0.75, no rule cited, "1 of 1 runs agree". The press pool claim: 0.75, rule 3, "1 of 1 runs agree". | Works; "Explaining the outputs" does not match (issue 2) |
| 3 | `W decide --claim presspool`, `W decide --claim aiforce`, then `W where` (and `W verify --json`) | 0, 0, 0, 0 | ok (4-row, 2-column table); the "acting as the editor" engineer line goes to stderr only | Exactly the four editor columns were written with the page's words: press pool Reviewed, no verified tag, Rule unclear; AI Force Reviewed, Context-dependent, Rule unclear. Agent columns untouched. `where`: step 4. verify clean (7 decided, 0 open). | As promised |
| 4 | `W run distill` | 0 | ok | One rule change, "Known standing groups identified; unknown names are not", on Context-dependent rule 3, Kind Clarify wording, Status Proposed, Current and Proposed text, two Supporting rows. The ledger copies were made on both rows (Tag outcome, Why wrong, Your reasoning, Decided under 2026-10-21.1). The Rulebook did not change. | As promised |
| 5 | `W approve`, then `W where` | 0, 0 | ok | Status Approved, Editor wording empty (the draft is tested). `where`: step 6, "type /claim-tagger demo promote". | As promised |
| 6 | `W run promote`, then `W verify --json`, `W where` | 0, 0, 0 | ok | **PASS on the first safety check**: examples 10 of 10, earlier 5 of 5, yours 2 of 2. Both claims flipped the right way (press pool Applies to Does not apply; AI Force Can't tell to Applies). Rulebook rule 3 = the proposed text; edition 2026-10-21.2 (Agent settings and the demo's rubric.lock); rule change Live, "PASS: examples 10/10, earlier 5/5, yours 2/2"; Last run summary "Promote · 21 Oct 12:49 · PASS". verify clean. No FAIL, so the Editor-wording path was not needed. | As promised |
| 7 | none (ran by itself inside promote); `W where` | 0 | ok | Follow-up Fixed on both ledger rows. AI Force Agent tags Context-dependent, press pool empty; both Agent notes say "nothing waits for an editor · edition 2026-10-21.2"; no "disagrees" anywhere. `where`: "you have been through all seven steps", Next: archive by hand. | As promised |
| End | `W run pull --all`, `W list` | 0, 0 | list: ok (5 rows, 3 columns) | The final pull confirms the tables (below). `list` shows this verification page as the newest, above the product owner's page from earlier today, which is still at step 2. | See issue 1 |

What the tables hold at the end (from the final pull `20261021T094947Z-pull`, `norm/`):

- **Claims.** The two open claims are Reviewed with the editor's columns as entered. Press pool: no verified tag, Rule unclear, the page's sentence. AI Force: Context-dependent, Rule unclear, the page's sentence. The agent columns are the follow-up's: AI Force Agent tags Context-dependent, press pool empty, notes on edition 2026-10-21.2, reasons "Context-dependent rule 3 · 3 of 3 runs agree". The five earlier decisions are unchanged and agree with the agent.
- **Tag decisions (the ledger).** 7 rows. The two new rows carry the agent's proposal (press pool Applies 0.75, AI Force Does not apply 0.75), the copied decision (Does not apply and Applies, Rule unclear, the editor's sentences, Decided under 2026-10-21.1) and Follow-up **Fixed** on both. The five audit rows are unchanged, with no Follow-up.
- **Rule changes.** 1 row, Status **Live**, Safety check result "PASS: examples 10/10, earlier 5/5, yours 2/2", Editor wording empty.
- **Rulebook.** Context-dependent rule 3 now ends with: "This also covers a capitalised phrase that reads like a name but names no body or thing readers know ("the AI Force"). A group that every reader knows by its standing role ("the press pool") counts as identified." Then comes the mass-noun sentence, as before. Edition **2026-10-21.2**; the demo's CHANGELOG has both editions.
- **Agent settings.** Rulebook edition 2026-10-21.2, Paused off.
- Every write in the propose, distill, promote, record and follow-up plans went to agent columns only. Only the two `decide` calls and `approve` wrote editor columns, each logged in `editor-actions.jsonl`. Git has no new commit.

Time per command, for the engineer: start 59 s; verify 15 to 19 s each; where 3 to 5 s; status 6 s; the tag step 45 s in all (pull 4, judge 15, propose 26); decide 9 to 10 s each; distill 23 s; approve 6 s; promote, with the follow-up, 80 s; list 10 s. The whole run took about 12 minutes, most of it the verifier's checks between steps.

## Issues found

1. **Blocks the demo, for the product owner's page rather than this one. Commands without `--demo` now act on this verification page.** Commands with no page named take the newest practice page in any folder (`pickDemo` in `scripts/lib/demo-profile.mjs`). The claim-tagger skill's demo mode always runs that way: it has no way to name a page. This test page sits under Demo tests, but it still counts as the newest, so the product owner's page ("Claim tagger practice · product owner", under Demos, built at 12:25 today and at step 2) is no longer the one the commands reach. If the product owner now types `/claim-tagger demo tag`, it runs on the verification page. The report names that page, so the slip can be noticed, but only if the reader looks. The page text promises something else ("Commands act on the newest practice page under Demos"), and so does the claim-tagger skill ("under the Demos sub-page"). Where it showed: `W list` at the end. Someone has to decide how test pages and editors' pages are told apart before the product owner continues. Until then, troubleshooting's line "ask the engineer before continuing" applies.

2. **Confusing. Step 2's "Explaining the outputs" does not match what the agent wrote.** The page promises the following:
   - AI Force: confidence 0.50, "Context-dependent rule 3 · 2 of 3 runs agree".
   - Press pool: 0.80, "3 of 3 runs agree".
   - "Both claims cite rule 3".
   - The agent is "unsure about the AI Force". The story at the top says the AI Force claim "waits because the agent is unsure".

   What this page got:
   - AI Force: Does not apply at probability 0.25, so confidence 0.75, no rule cited, "1 of 1 runs agree". A probability of 0.25 sits on the edge of the unsure band, which runs strictly between 0.25 and 0.75, so the claim counted as sure and was not read again.
   - Press pool: 0.75, rule 3, "1 of 1 runs agree".

   Both claims tie at 0.75, so "lowest confidence first" orders nothing. Two points go beyond this one run:
   - "3 of 3 runs agree" cannot appear at the tag step. A sure cell is read once, a second read happens only for an unsure cell, and a third only when the first two disagree. The page's line "how many of its three readings agree" suggests that three reads are always made. The page of 15 October also wrote "1 of 1" for the press pool at 0.75. "3 of 3" appeared on this page only after the safety check, in step 7's values.
   - The AI Force answer changes from run to run: Can't tell at 0.65 with no rule on 15 October, Does not apply at 0.25 here.

   Nothing is blocked, because both claims wait anyway: they are To review. But an editor who compares the page's table with the Claims table sees different figures, a missing rule and a claim the agent was sure of. For the calibration record: Does not apply at 0.25 meets the manifest's AI Force condition ("Can't tell or Applies at 0.70 or less") only if that condition is read as the probability of Applies.

3. **Confusing (minor). `where` never names step 1.** On a fresh page it says "you are at step 2", while the start report and the page say "follow step 1". This is by design, because status writes nothing and the state cannot show that step 1 was done. Still, an editor who asks where they are right after the build is told they are past a step they have not done. Where it showed: `W where` after start.

4. **Confusing for the engineer, with a production risk.** Each demo run's `run.json` stores its `resume` line as the bare production command (for example `node agents/claim-tagger-mvp/scripts/propose.mjs`), without the walkthrough wrapper and without `CLAIM_TAGGER_MVP_ROOT` (the default in `openRun`, `scripts/lib/loop.mjs`). AGENT.md section 2 tells the engineer to rerun a stopped script with the line `run.json` holds. Copied from a demo folder, that line would run against the production tables. Editors are not affected: their Next line says to type the same demo command again. Where it showed: `runs/demos/20261021-1237-c23118/runs/20261021T094229Z-propose/run.json`.

5. **Cosmetic. The tag report can be misread.** "Tagged Context-dependent | 2 claims" sits next to "2 wait for you". The two claims it counts are the CNN and Dallas claims, earlier decisions; the editor's two have empty Agent tags. An editor may think their claims were tagged. The words also differ: the tag report says "decide the 2 rows in Your queue", while `where` and the page say "decide your two claims".

6. **Cosmetic. The intermediate output of "demo tag".** `pull` prints an engineer line with a pull run id. `judge` prints a report of its own whose Next line, "type /claim-tagger demo tag to finish (it continues from here)", has no full stop. The skill relays only the last report (propose's), so an editor sees these only if more is relayed.

7. **Cosmetic. Mixed link forms.** The promote report's Next line links `https://www.notion.so/400273e2…681e`, the top of the page and not step 7. Every other report links `https://app.notion.com/p/<title>-<id>`. Both open the page.

8. **Cosmetic. The seeded earlier decisions read oddly on the Claims table.** All five carry Why wrong "Agent slip", and three of them have Challenged tags notes "From the audit of 9 October: the editor agreed; no reasoning was recorded". Help defines Agent slip as "the agent misread it", so "the editor agreed" reads as a contradiction. It means the editor agreed with the audit's tag, while the agent's answer before the audit was the other way. Two of these notes lack the final full stop.

9. **Cosmetic. After step 7 the Claims table shows two editions.** The editor's two claims name edition 2026-10-21.2; the five earlier decisions still name 2026-10-21.1. The press pool claim keeps Agent confidence 0.75 from step 2, while its new reason argues for no tag. Step 7 promises only the two claims, so nothing breaks, but an editor scanning the whole table may wonder why.

10. **Cosmetic. The lesson title has no verb.** "Known standing groups identified; unknown names are not" lacks "are". The model's wording varies from run to run.

11. **Cosmetic. `W list` and `W decide` say a little too much.** `list` ends with "nothing to type; archive the page by hand…", which fits only a finished page, and it shows "unknown" for the 15 October pages, which have the older shape. After the first of the two claims, `decide`'s Next line says "decide your two claims" when only one remains. Both commands are engineer and calibration tools.

## What worked as promised

- `start` built the page, its five tables, the relation, two linked views and three tabs in about a minute, with no stop. `verify` was clean all four times it ran: fresh, after the tag step, after the decisions and after the PASS.
- Every report that reaches the editor had exactly three parts, or two where no table was needed. None had a file path, run id, duration, cost or code, and every lint came back clean.
- The status report matches the page's step 1 table word for word.
- After the tag step both editor claims wait in Your queue with empty Agent tags, the five earlier decisions agree with the editor, and the ledger has a row for each judged claim.
- `where` named the true step at steps 3, 4, 6 and the end, and linked Your queue at step 3.
- The two decisions wrote exactly the four editor columns with the page's words. Distill drafted one change on rule 3 from those two rows and made the ledger copies. Approve left Editor wording empty, so the draft itself was tested.
- The safety check passed on the first try (10 of 10, 5 of 5, 2 of 2). The Rulebook, the edition, the rule change and Agent settings show what step 6 promises.
- Step 7 ran by itself: both rows Fixed; the AI Force claim carries the tag and the press pool claim does not; both notes name the new edition; no claim is in Agent disagreed.
- Only agent columns were written, apart from the logged editor actions. There was no commit, and the production tables were not touched.

## Evidence in this folder

`step0-start-report.md`, `step0-where-report.md`, `step1-status-report.md`, `step2-judge-report.md`, `step2-pull-output.txt`, `step2-tag-report.md`, `step2-where-report.md`, `step3-decide-presspool-report.md`, `step3-decide-aiforce-report.md`, `step3-where-report.md`, `step4-distill-report.md`, `step5-approve-report.md`, `step5-where-report.md`, `step6-promote-report.md`, `safety-check-card.md`, `step7-where-report.md`, `end-list-output.md`, `verify-outputs.jsonl`. The run folders themselves are under `agents/claim-tagger-mvp/runs/demos/20261021-1237-c23118/runs/`, which git ignores.

**Overall verdict: yes, the walkthrough worked end to end.** Every command exited 0, the safety check passed on the first try, and the final tables hold what step 7 promises. Before the next editor uses it, issue 1 needs a decision: the product owner's page is no longer the one the demo commands reach. Issue 2 also needs fixing: step 2's explanation does not match what the agent writes.
