# Walkthrough verification, third run, 21 October 2026

An independent verifier, who did not build the practice page, built a fresh one and went through its seven steps as an editor would. The aim was to check the seven changes of the product owner's feedback round (CLAIMS-REVIEW.md section 6) and to look for regressions against the two earlier runs (folders 13 and 14). The run was on 21 October 2026, from 16:25:40 to 16:36:55 local time (13:25:40 to 13:36:55 UTC), on branch mvp-2026-11. The verifier could not write this file itself (the harness refuses report files from subagents); the engineer saved its text unchanged.

- **Commit.** `git rev-parse --short HEAD` gave `0505092` at the start, with eight files modified and two test fixtures not yet committed. At 16:27:34, while the page was being built, HEAD moved to `f9c56eb`. That commit holds exactly those changes (the same ten files and line counts), so the code under test is the code of `f9c56eb` throughout.
- **How the commands ran.** Every command went through `node agents/claim-tagger-mvp/scripts/walkthrough.mjs` (W below), each with `--demo 20261021-1625-b5e09b` except `start` and `list`. At steps 3 and 5 the verifier acted as the editor through `W decide` and `W approve`, which decision D31 allows on practice pages. The verifier ran no production script, sent no connector write, edited no code, test, skill or document, and made no commit.
- **The page.** "Claim tagger practice · verification 21 Oct, run 3", under the sub-page Demo tests: https://app.notion.com/p/Claim-tagger-practice-verification-21-Oct-run-3-400273e214eb8139bcc3dadbbe38a305. Demo id `20261021-1625-b5e09b`, edition at build 2026-10-21.1.
- **What `list` said about the default page.** Before the build, after it and at the end, `W list` marked "Claim tagger practice · product owner, 21 Oct evening" as "ready · used by the demo commands" (step 1). Its `demo.json` names Demos as its parent. The Next line was "type /claim-tagger demo status.", which fits a page at step 1. This verification page was listed at the top (step 1, then complete) and was never marked. The product owner page's run folder has no entry after 16:24, so nothing in this run touched it.
- **Linting.** Every report was linted with `lintReport`, and every one came back clean (`[]`). The one exception is `start`'s full stdout: the script prints the progress line "Building the page." directly above the sentence, so the whole output fails as "the sentence runs over more than one line". The report from its sentence on is clean. This is unchanged from the earlier runs.

## Step by step

| Step | Command | Exit | Report shape | What happened | Verdict |
|---|---|---|---|---|---|
| Before | `W list` | 0 | ok: sentence, 5-row 3-column table, Next | The default page is the newest page under Demos, not one under Demo tests. `list` works again, although the page "…, second run" is among the five shown (its title is shown in quotes). | As promised; issue 1 of run 2 is fixed for `list` |
| Start | `W start --parent 3fa273e2…7051 --title "…, run 3"`, then `W verify --json`, `W where`, `W list` | 0, 0, 0, 0 | start: progress line, then ok (3-row table). where: ok, two parts. list: ok | Built in 63 s. stderr: "the column order of the Claims view "Default view" was set to the review order". verify: `ok:true`, no problems, `fresh:true` (7 claims, 5 decided, 2 open, ledger 5, 2 linked views, 3 tabs). `where`: step 1, "type /claim-tagger demo status." | As promised |
| 1 | `W run status` | 0 | ok | The sentence names the page and says nothing waits. The table (edition 2026-10-21.1, nothing waits, none, none yet) matches page step 1 word for word. Next: "…demo tag…(step 2 of the practice page)." | As promised |
| 2 | `W run pull --all`, `W run judge --items claims`, `W run propose`, then `W verify --json`, `W where` | 0, 0, 0, 0, 0 | pull: an engineer line. judge: ok (Unsure 0, Re-read 0; its Next line ends with a full stop). propose: ok | Tag report: "Carrying Context-dependent \| 2 claims (earlier decisions included)"; Next "decide your two claims in Your queue (link)". Press pool: Applies 0.85, rule 3, "1 of 1 runs agree". AI Force: Does not apply at probability 0.25 (confidence 0.75), no rule cited, "1 of 1 runs agree"; its reason argues for no tag, which fits that answer. Both: Agent tags empty, Agent status Waits for you, Tags waiting Context-dependent. The five earlier decisions: Agent status Done, Agent tags equal to the verified tags, confidence 0.75 to 0.93. Agent edition 2026-10-21.1 on all 7; Agent remarks empty. Ledger 5 → 7. verify clean. `where`: step 3, linking Your queue. | As promised. The figures differ from the page's table, as its text says they may |
| 3 | `W decide --claim presspool`, `W decide --claim aiforce`, `W where` | 0, 0, 0 | ok, ok (4-row, 2-column tables, rows in the page's order: Verified tags, Why wrong, Challenged tags notes, Review status), ok | Exactly the four editor columns were written with the manifest's words. Each was logged in `editor-actions.jsonl` as planned, then done with read-back ok. Next lines: "…decide your remaining claim.", then "type /claim-tagger demo distill." `where`: step 4. The pull after step 3 shows both claims Reviewed and still Waits for you. | As promised |
| 3, extra | `W run status` (read-only; not in the brief) | 0 | ok | "nothing waits for you", "Your queue \| nothing waits", Next "type /claim-tagger demo tag to read new claims." Your queue still lists the two decided claims, and the page's next step is distill. | Off the page's path (new issue 1) |
| 4 | `W run distill` | 0 | ok | One rule change: "Known standing bodies are identified; unknown titles not". Context-dependent rule 3, Clarify wording, Proposed, Current and Proposed text, two Supporting rows. Ledger copies on both rows: Does not apply / Applies, Rule unclear, the editor's sentences, Decided under 2026-10-21.1. Rulebook unchanged. Next links Lessons waiting. | As promised |
| 5 | `W approve`, `W where` | 0, 0 | ok, ok | Status Approved and Editor wording empty, so the draft itself is tested. `where`: step 6, "type /claim-tagger demo promote." | As promised |
| 6 | `W run promote`, `W verify --json`, `W where` | 0, 0, 0 | ok | **PASS on the first safety check**: examples 10 of 10, earlier 5 of 5, yours 2 of 2. Card: press pool Applies → Does not apply; AI Force Can't tell → Applies (that is the baseline reading inside promote). Edition 2026-10-21.2. Next: "look at step 7 on the practice page (link); the demo is then complete." verify clean (7 decided, 0 open, 1 rule change). `where`: "you have been through all seven steps", Next: archive by hand. No FAIL, so the Editor wording path was not needed. | As promised |
| 7 | none (the follow-up ran inside promote) | n/a | n/a | Follow-up Fixed on both ledger rows. AI Force: Agent tags Context-dependent, Done, confidence 0.80, "3 of 3 runs agree". Press pool: Agent tags empty, Done, confidence 0.66, "2 of 3 runs agree". Both on 2026-10-21.2, Tags waiting empty, neither claim reads Disagrees. The five earlier decisions keep 2026-10-21.1, as step 7 says. | As promised |
| End | `W run pull --all`, `W list` | 0, 0 | pull: an engineer line. list: ok | The final pull (`20261021T133558Z-pull`) confirms the tables below. `list`: this page "complete"; the default page is unchanged. | As promised |

**What the tables hold at the end** (final pull, `norm/`):

- **Claims.** Seven rows. The two editor claims are Reviewed with the editor's columns as entered. Agent columns:
  - press pool: no tag, Done, 2026-10-21.2;
  - AI Force: Context-dependent, Done, 2026-10-21.2;
  - the five earlier decisions: unchanged from step 2.
- **Seeded notes.** All five audit notes end with a full stop. They say which way the editor went against the agent.
- **Tag decisions.** Seven rows. The two new rows keep the step 2 proposal (press pool Applies 0.85, AI Force Does not apply 0.75), the copied decision and Follow-up Fixed. The five audit rows are unchanged, with no Follow-up.
- **Rule changes.** One row, Live, "PASS: examples 10/10, earlier 5/5, yours 2/2", Editor wording empty.
- **Rulebook.** Rule 3 is the proposed text: capital letters do not make an unknown title a name, and a standing body every reader knows, such as the press pool, is already identified. The demo's `rubric.lock` holds edition 2026-10-21.2, and its CHANGELOG lists both editions. The pull found no drift.
- **Agent settings.** Edition 2026-10-21.2, Paused off, "Promote · 21 Oct 16:35 · PASS".
- **Who wrote what.** Only agent columns were written by the scripts:
  - the tag step wrote Agent tags, confidence, reasons, status, Tags waiting and edition, plus ledger rows and settings;
  - distill wrote the ledger copies, one rule change and settings;
  - promote wrote When to use, the record wrote the result and settings, and the follow-up wrote Follow-up and the agent columns.
- **Editor columns** were written only by the two `decide` calls and `approve`, each logged.
- **Resume lines.** Every `run.json` resume line goes through `walkthrough.mjs run --demo 20261021-1625-b5e09b …`, including the judge and promote sub-runs.

**Time per command, for the engineer:**

| Command | Time |
|---|---|
| start | 63 s |
| verify | 14 to 19 s |
| where | 3 to 4 s |
| list | 5 s |
| status | 4 s |
| Tag step | 31 s (pull 4, judge 13, propose 15) |
| decide | 7 to 13 s |
| distill | 19 s |
| approve | 6 s |
| promote, with the follow-up | 78 s |

## The seven changes

1. **Agent tags and Verified tags are relations holding tag names: in place.**
   - On the live table, Agent tags, Tags waiting and Verified tags are of type relation. They point at this page's own Rulebook row.
   - In `norm/claims.jsonl` they are lists of names, for example `["Context-dependent"]`.
   - The ledger copies are right. Tag outcome is Applies exactly where Verified tags holds the tag: CNN, Dallas, AI Force. It is Does not apply on the other four.
   - The two new rows carry Why wrong, Your reasoning and Decided under 2026-10-21.1.
2. **Step 3 is a numbered list per claim, with the sentence on its own line: in place.**
   - `page.md` has two lists of four lines: Verified tags, Why wrong, Challenged tags notes, Review status last.
   - The build plan sent the same: eight numbered items, with the sentence after a line break inside item 3. The wording is the manifest's `enter`, word for word.
   - The page read back has 11 numbered items (8 here plus 3 in step 6), per verify.
   - The rendered page was not looked at on screen.
3. **The editor column is named Verified tags: in place.**
   - The live Claims table has Verified tags. It has no "Claim quality tags — verified", no Agent notes and no "(old)" columns.
   - The old name appears only in Help, as the real table's name.
4. **Column order in the Claims views and the table's own view: in place, per verify.**
   - `demo.json` records the five views (Your queue and Lessons waiting linked; Needs your note, Agent disagreed and Rulebook as tabs), with no errors and no fallback. The build reported that it set the own view to the review order.
   - What verify compares, read back from the live views through the Notion client:
     - each of the three Claims views: the visible columns in order against the twelve of the structure (Geo Name, the agent's seven, the editor's four), plus filter, sort and wrap;
     - the table's own view: the visible columns against the structure's live columns in order.
   - It passed all three times. The order was not seen on screen.
5. **A decided claim stays in Your queue until the agent's next run: in place.**
   - After both `decide` calls the pull shows both claims Reviewed with Agent status still Waits for you, so both still match Your queue's filter. That filter is "Agent status is Waits for you", with no Review status condition, and verify checks it.
   - Both left at the follow-up (Agent status Done).
   - Side effect: `status` at that point (new issue 1).
6. **The skills' checklist: in place; the words match.**
   - `guide.md`'s Demo "Decide in Your queue" names Verified tags, Why wrong, Challenged tags notes, Review status: the same columns, in the same order, as step 3. The walkthrough SKILL.md says the same.
   - The claim-tagger SKILL.md points at `guide.md` for every checklist.
   - The two `report-examples.md` files are identical. Their tag report and checklist match `guide.md` word for word.
   - "Approve in Lessons waiting" (Demo) matches step 5: Status, then Editor wording, which holds all of rule 3.
   - Gap: `where`'s reports (new issue 2).
   - Not run through a skill transcript: the headless check is a script the brief rules out.
7. **Agent status, Tags waiting, Agent edition and Agent remarks are written by the tag step and the follow-up: in place for three columns. Agent remarks was not exercised.**
   - The tag step's plan wrote Agent status and Agent edition on all seven claims, and Tags waiting on the two.
   - The follow-up's plan wrote Agent status, Tags waiting (cleared), Agent edition, Agent confidence and Agent reasons on both claims, and Agent tags on the AI Force claim.
   - Agent remarks was written by neither, because its value stays empty. Propose writes a column only when it changes, and a one-tag rulebook never produces a "not checked" remark. It reads empty, as the page says. This check could not run on a practice page; it is reported, not skipped.

## New issues

1. **Minor, confusing. `status` between step 3 and step 4 contradicts Your queue and points away from the page's next step.**
   - After both decisions, `status` says "nothing waits for you", with the row "Your queue | nothing waits". At the same time, Your queue lists the two decided claims, as change 5 intends.
   - Its Next line is "type /claim-tagger demo tag to read new claims." The page's step 4 is distill.
   - The count follows section 6.2: it counts what is still to decide. But the row is labelled Your queue, and the Next order in `status.mjs` (unread, queue, rows, proposed, approved, then tag) never names distill. Production has the same gap.
   - The page asks for `status` only in step 1, so the planned path is not affected. But an editor who asks what waits midway is sent off it.
   - By the rules of section 6.2, a tag run at that point would mark both claims Disagrees with your decision until the follow-up. That was not run.
2. **Minor, wording gap; not tested live. `guide.md` does not cover `W where`'s reports.**
   - The walkthrough SKILL.md says to add the Demo checklist after `W where` when its Next line sends the editor to Notion.
   - `guide.md`'s table lists only the Next-line forms of tag, status, distill, promote and follow-up. `where` words them differently:
     - "open Your queue (link) and decide your two claims";
     - "open Lessons waiting (link) and set Status to Approved";
     - "open Lessons waiting (link) and write the rule as you want it in Editor wording".
   - `guide.md` also picks the Demo list by the "Demo · " prefix, which `where`'s "Walkthrough:" reports do not have.
   - A model has to bridge the two files, and the claim-tagger skill's rule "if no checklist matches the Next line, send the report alone" points the other way.
3. **Low, still open from run 1. The AI Force calibration condition can be read two ways.**
   - This run read the AI Force claim as Does not apply at probability 0.25, with no rule.
   - The manifest's `calibrate` field expects a Can't tell or Applies answer at 0.70 or less, citing rule 3: by that field the condition is not met.
   - Read as "probability of Applies at 0.70 or less", it is met. The page's text covers this reading.
   - The page is under Demo tests, so it does not count toward the calibration, which is still `pending`.
4. **Cosmetic. `list` shows "unknown" for the 21 October pages built before the feedback round.** Three of the five rows it shows are such pages. Troubleshooting explains "unknown" only for the pages of 15 and 16 October.
5. **Cosmetic. The lesson title lacks a verb in its second half:** "…; unknown titles not". This is model wording, of the same kind as run 1's issue 10.
6. **Cosmetic. The sentence to paste in step 3 is shown in double quotes.**
   - The page puts the sentence on its own line inside double quotes and says to paste it "as it is".
   - `decide` writes it without the quotes, so an editor may paste the quotes too.
   - This is harmless to distill, but the page and the script differ.

**Still open from earlier runs, not new:**

- `where` does not name its page (run 2, issue 4; in the backlog).
- The promote Next link opens the top of the page, not step 7 (run 1, issue 7).
- `start`'s progress line sits directly above the report sentence.

## What worked as promised

- Every command exited 0. `start` built the page, five tables, three relations, two linked views and three tabs in about a minute, and set the own view to the review order. `verify` was clean all three times (fresh, after the tag step, after the PASS).
- Every report that reaches the editor had three parts, or two where no table was needed, and linted clean. None had a file path, run id, duration, cost or code. Each Next line matched the page's step, apart from the extra `status` in new issue 1.
- `where` named the true step every time: 1, 3, 4, 6 and complete. It linked Your queue at step 3.
- Issues from the earlier runs that were checked again behave as fixed:
  - `list` works with the "second run" page among the five newest;
  - the default page is under Demos;
  - `where` names step 1 on a fresh page;
  - resume lines go through the wrapper;
  - the tag report's wording is right;
  - the judge's Next line ends with a full stop;
  - links use the app.notion.com form;
  - the seeded notes read right;
  - step 7 explains the two editions;
  - `decide` says "remaining claim".
- Run 2's Dallas and AI Force mismatches did not occur in this run: Dallas was 0.75, and the AI Force reason fits its answer.
- The tag step, the decisions, distill, approve, the safety check (PASS on the first try) and the follow-up produced what steps 2 to 7 describe. Only agent columns were written by scripts, apart from the logged editor actions. Production tables were not touched, and nothing was committed by the verifier.

## Evidence in this folder

- **Pages and lists:** `step0-list-before.md`, `step0-start-report.md` (+ `.stderr.txt`), `step0-verify.json`, `step0-where-report.md`, `step0-list-after-start.md`.
- **Steps 1 to 7:** `step1-status-report.md`, `step2-pull-output.txt`, `step2-judge-report.md`, `step2-tag-report.md`, `step2-verify.json`, `step2-where-report.md`, `step2-tables-after-tag.txt`, `step3-decide-presspool-report.md` (+ `.stderr.txt`), `step3-decide-aiforce-report.md` (+ `.stderr.txt`), `step3-where-report.md`, `step3-tables-after-decide.txt`, `step3-extra-status-report.md`, `step4-distill-report.md`, `step5-approve-report.md` (+ `.stderr.txt`), `step5-where-report.md`, `step6-promote-report.md`, `step6-safety-check-card.md`, `step6-verify.json`, `step7-where-report.md`.
- **End:** `end-pull-output.txt`, `end-tables-final-pull.txt`, `end-list-output.md`, `verify-outputs.jsonl` (three runs, labelled).
- **Run folder:** `agents/claim-tagger-mvp/runs/demos/20261021-1625-b5e09b/`, which git ignores.

**Overall verdict: yes. The walkthrough works end to end on the new shape, the seven changes are in place (Agent remarks could not be exercised on a practice page), and nothing regressed. Two minor issues need an owner's decision: what `status` says midway, and `guide.md`'s coverage of `where`.**
