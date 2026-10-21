# Walkthrough verification, sixth run ("Read the decisions", third and last loop), 21–22 October 2026

I am an independent verifier and did not build the feature. I built a fresh practice page and went through its seven steps as an editor would, in the order the brief gives. That order includes the planned detour: the USPS claim was first decided with no note, then given the manifest's "Agent slip." note. The run went from 20:52:56 to 21:08:54 UTC (23:52 to 00:08 local, so it crossed into 22 October local time). I followed my agent instructions and did not write REPORT.md. This text is the report, and the engineer saves it unchanged.

- **Demo id:** `20261021-2355-8c6602`
- **Page:** "Claim tagger practice · verification 6", id `400273e214eb81a9beb6e7f7899530d6`, under Demo tests
- **Evidence folder:** `X:\work\geo-agents\docs\mvp-2026-11\evidence\20-walkthrough-verification-6\`
- **Run folder:** `X:\work\geo-agents\agents\claim-tagger-mvp\runs\demos\20261021-2355-8c6602\` (ignored by git)

## The run

- **Commit.**
  - HEAD was `84c0e522e4b0ad953ea681b28d244953a8ab1a23` when I recorded the start at 20:52:56Z (`00-commit-start.txt`).
  - At 20:53:13Z, before my first W command, the engineer committed `291f05d` ("work log entry 29 … state"). It touches only `STATE.md` and `WORKLOG.md`. `git diff 84c0e52 291f05d -- agents .claude tests` is empty (`00b-commit-moved.txt`).
  - Every W command ran at 291f05d, and HEAD was 291f05d at the end (`99-commit-end.txt`). So the code under test is 84c0e52's.
  - I made no commit.
- **Working tree.** The three modified files under `docs/mvp-2026-11/report/` still date from 21:50:56 local and did not change during the run.
- **What I ran and wrote.**
  - Every Notion-touching command was `node agents/claim-tagger-mvp/scripts/walkthrough.mjs ...` (W below), run from the repository root. Every command after `start` carried `--demo 20261021-2355-8c6602`.
  - I acted as the editor only through `W decide` and `W approve` (decision D31).
  - I ran no production script, wrote nothing to Notion by hand or through a connector, did not read `.env`, and edited no repository file.
  - Offline and read-only, I also ran the 8 retry tests on the fakes and one replay script (run 5's finding 1 below).
  - I wrote only the step files in the evidence folder, plus helper scripts in my scratchpad's `v6/` folder.
- **Page versions.** Manifest 2026-10-22.1. Edition 2026-10-21.1 at build, 2026-10-21.2 after the safety check.
- **Exits.** Every command exited 0 on its first try. No retry, no exit 75 (usage window), no stop, no wording round, no detour.

## Step by step

| # | Command | Exit | Report shape | What happened | Verdict |
|---|---|---|---|---|---|
| 0 | `W list` | 0 | sentence, 5-row table, Next | 18 pages; "calibration 6" is marked "used by the demo commands". | ok |
| 1a | `W start --parent 3fa273e2…7051 --title "Claim tagger practice · verification 6"` | 0 | "Building the page." line, then sentence, 3-row table, Next | Built in 68 s. stderr: the default view was set to the review order. | ok. The whole stdout fails the lint only on the known progress line; `report.md` is clean. |
| 1b | `W verify --json` | 0 | JSON | `ok:true`, no problems, `fresh:true`: claims 9, decided 5, open 4, tag_decisions 5, linked views 2, tab views 3, steps 7. | ok |
| 1c | `W where` | 0 | sentence, Next | "you are at step 1, Meet the demo"; Next: `/claim-tagger demo status`. | ok |
| 2a | `W run status` | 0 | sentence, 4-row table, Next | Rulebook "1 tag, edition 2026-10-21.1"; Your queue "nothing waits"; Lessons waiting "none"; Last run "none yet". No "Your decisions" row. | ok: matches page step 1 word for word |
| 2b | `W run pull --all`, `judge --items claims`, `propose` | 0, 0, 0 | pull: an engineer line; judge: 3 rows; propose: 3 rows | judge: Claims read 9, Unsure 2, Re-read 2. Tag report: "4 wait for you", "Carrying Context-dependent: 2 claims (earlier decisions included)", "New rows in Your queue: 4, lowest confidence first". Next: "decide your four claims in Your queue (link)". | ok |
| 2c | `W run pull --all`, `W verify`, `W where` | 0, 0, 0 | verify: 3-row table; where: 2 parts | verify: "as it was built" (9: 5 reviewed, 4 waiting for you). where: "step 3, Decide your four claims". | ok |
| 3a | `W decide --claim presspool`, `--claim aiforce`, `--claim usps --outcome "Does not apply"`, `--claim georgia` | 0 ×4 | each a 3-row table | The manifest's words were written; USPS and Georgia show "(empty)" notes. Each action is logged as planned, then done with read_back ok. Next said "remaining claims", then "remaining claim", then "type /claim-tagger demo distill." | ok |
| 3b | `W run status`, `W where` | 0, 0 | status: 5-row table | Sentence: "nothing is paused; the agent has 3 of your decisions to read." Your queue: "4 rows decided, waiting for the agent's next run". Your decisions: "3 to read, 1 without a note". Next: "type /claim-tagger demo distill to draft a rule change from your decisions." where: step 4. | ok |
| 4 | `W run distill` (first pass) | 0 | sentence, 5-row table, Next | Sentence: "read 3 of your decisions and drafted one rule change from 2 of them; 1 of your decisions has no note and waits in Needs your note". Table: Read 3, Point at a rule 2, Agent slips none, Without a note 1, Rule change "Groups known by standing role count; unknown names do not", Context-dependent rule 3. Next: Lessons waiting. | ok |
| 5a | `W decide --claim usps` (the manifest's note) | 0 | 3-row table | Note: "Agent slip. USPS names which portal, so rule 5 already settles it." Next: "open Lessons waiting (link) and set Status to Approved." | ok |
| 5b | `W run status` | 0 | 5-row table | Your decisions: "1 to read, 2 point at a rule". Lessons waiting: "1 rule change to approve". Next: "approve or reject the rule change in Lessons waiting (link)". No recanted wording. | ok |
| 5c | `W run distill` (second pass) | 0 | sentence, 5-row table, Next | "read 1 of your decisions; no rule change to draft; the 2 decisions that point at rule 3 already have a rule change waiting for you". Table: Read 1, Point at a rule none, Agent slips 1, Without a note none, Rule change none. No model call. Next: approve or reject in Lessons waiting. | ok (run 5's issue 3 fixed); the table's "Point at a rule: none" is new issue 1 |
| 6a | `W where`, `W approve`, `W where` | 0, 0, 0 | 2 parts, 1-row table, 2 parts | where: step 5, then step 6 after approve. approve: Status Approved, logged and read back. | ok |
| 6b | `W run promote` | 0 | sentence, 3-row table, Next | After 110 s, on the first attempt: "PASS, rule 3 now uses the new wording (edition 2026-10-21.2), and the follow-up marked both of your rows Fixed". Example claims 10 of 10; earlier decisions 6 of 6; **"Your 2 rows: 2 of 2 now right, marked Fixed"**. Next: step 7, with a link to the top of the page. | ok: **PASS on the draft**, no stop |
| 6c | `W run pull --all`, `W where`, `W run status`, `W verify --json` | 0 ×4 | — | Press pool and AI Force: Fixed, Done, 2026-10-21.2. **USPS and Georgia: no Follow-up, Waits for you, 2026-10-21.1.** where: "you have been through all seven steps". status: no "Your decisions" row; Your queue "2 rows decided, waiting for the agent's next run". verify: ok, decided 9, open 0, rule changes 1. | ok |
| 7 | `W list` | 0 | 5-row table | 19 pages; this page is "ready · complete"; the default is unchanged ("calibration 6"). | ok |

**The open claims at the tag step** (`09-tables-after-tag.txt`, `07-judge-records.txt`):

| Claim | Proposal | Confidence | Rule cited | Runs |
|---|---|---|---|---|
| Press pool | Applies | 0.85 | rule 3 | 1 of 1 |
| AI Force | Can't tell | 0.50 | none | 2 of 2 (ask_editor 0.50 twice) |
| USPS | Applies | 0.80 | rule 3 | 1 of 1 |
| Georgia | Does not apply | 0.80 (p 0.20) | rule 5 | 1 of 1 |

All four are within what the story tolerates, and Georgia cites rule 5 as on the page.

**The five earlier decisions** are Done with Agent tags equal to the verified tags: CNN 0.90, **Dallas 0.57** (reads 0.72, 0.20, 0.80; "2 of 3 runs agree"; new issue 2), contractor 0.93, Kennedy 0.88, stopgap 0.90.

**The safety check** (`28a-promote-stores.txt`):

| Claim | Baseline answers | Candidate answers |
|---|---|---|
| Press pool | apply 0.78, 0.88, 0.85 | do_not_apply 0.20, 0.15, 0.10 |
| AI Force | apply 0.60, then ask_editor 0.50 and 0.45 (Can't tell) | apply 0.80 three times |

- **Earlier decisions:** 6 of 6. These are CNN, Dallas, contractor, Kennedy, stopgap and Georgia. USPS is left out because the agent had it wrong.
- **Both judgment stores have no error line.**

**Times per command:**

| Command | Time |
|---|---|
| start | 68 s |
| verify | 15 to 18 s |
| where | 3 to 4 s |
| list | 20 to 22 s |
| status | 4 to 8 s |
| tag step | 58 s (pull 4, judge 30, propose 24) |
| decide | 6 to 8 s, 14 s for the USPS note |
| distill | 43 s first pass, 9 s second |
| approve | 6 s |
| promote, with the follow-up | 110 s |

## The feature checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1.1 | Fresh page: 9 claims, 5 decided, 4 open, ledger 5 | pass | `03-verify-fresh.txt` |
| 1.2 | The seeded rows read Agent slip, with "Seeded from the audit of 9 October." and a Read under ("2026-10-21.1 · 8560829f", "· 923e0a4b", "· 6cfb0909", "· fc77541c") | pass (Rule is empty on the seeded rows, as in runs 4 and 5) | `03-tables-fresh.txt` |
| 1.3 | The decided claims carry the seeded line; the open claims' Agent reading is empty | pass | `03-tables-fresh.txt` |
| 1.4 | The Claims columns and the three view filters equal the manifest's `expect` | pass (verify ok, no problems) | `03-verify-fresh.txt` |
| 1.5 | where says step 1 | pass | `04-where-step1.txt` |
| 2.1 | status equals page step 1, with no "Your decisions" row | pass | `05-status-step1.txt` |
| 2.2 | After the tag step: all four Waits for you, Agent reading empty, verify clean, where says step 3 | pass | `09-tables-after-tag.txt`, `10-verify-after-tag.txt`, `11-where-step3.txt` |
| 3.1 | status: the sentence names the 3 decisions to read; Your decisions "3 to read, 1 without a note"; Your queue "4 rows decided, waiting for the agent's next run"; Next names distill; where says step 4 | pass | `16-status-after-decide.txt`, `17-where-step4.txt` |
| 4.1 | Press pool reads Rule should change and AI Force Rule unclear, both on "Context-dependent rule 3", with a one-line note and a Read under ("2026-10-21.1 · f6ebacfb", "· 830960e5") | pass | `20-tables-after-distill1.txt` |
| 4.2 | USPS is read by the model, and its Reading note opens "without your note · " | pass. Read Rule unclear, rule 3; `source: model`, `no_note: true`. | `19-distill-first-records.txt`, `20-tables-after-distill1.txt` |
| 4.3 | The Georgia row has no reading columns | pass | `20-tables-after-distill1.txt` |
| 4.4 | Claim lines follow decision 68: USPS "…Rule unclear, rule 3, without your note · …"; Georgia "Nothing to read: the agent agreed with you." | pass | `20-tables-after-distill1.txt` |
| 4.5 | Exactly one call with purpose reading | pass: one reading call (3 items), plus one distill call (2 items) | `19-distill-first-records.txt` |
| 4.6 | **Decision 78.** One rule change, Proposed on rule 3, Kind "Change the rule"; Supporting rows name the press pool and AI Force keys only; the Proposed text says nothing about USPS or a portal | **pass**. `supporting_keys` = [5c9d133e…, 92f57020…]. The counter-evidence is stopgap, contractor and Kennedy; USPS is in neither the shown rows nor the counter-evidence (`run.json` groups). The Proposed text keeps rule 3 word for word and adds two sentences, the capitalised-name one and the standing-role one. | `19-distill-first-records.txt`, `20-tables-after-distill1.txt` |
| 4.7 | The sentence counts decisions and matches the table | pass: exactly as in CONTRACTS 17. Point at a rule 2, Without a note 1. | `19-distill-first.txt` |
| 4.8 | Next names Lessons waiting; the report has at most five rows | pass | `19-distill-first.txt` |
| 4.9 | USPS is the only claim whose Agent reading contains "without your note" | pass | `20-tables-after-distill1.txt` |
| 5.1 | After the note: status shows "1 to read, 2 point at a rule"; Lessons waiting "1 rule change to approve"; Next approve or reject; no recanted wording | pass | `22-status-after-note.txt` |
| 5.2 | The second distill makes no reading call | pass. That run has no `calls.jsonl`; the reading is `source: verbatim`. | `23-distill-second-records.txt` |
| 5.3 | USPS row: Agent slip, Rule "Context-dependent rule 5", Reading note "Your note says so.", Read under changed from 5158c072 to 805066ea | pass | `24-tables-after-distill2.txt` |
| 5.4 | USPS claim line: "Context-dependent: Agent slip, rule 5 · Your note says so." | pass | `24-tables-after-distill2.txt` |
| 5.5 | No second rule change | pass | `24-tables-after-distill2.txt` |
| 5.6 | No claim contains "without your note" | pass (0 lines) | `24-tables-after-distill2.txt` |
| 5.7 | The reason reads "the 2 decisions that point at rule 3 already have a rule change waiting for you"; Next names approve or reject in Lessons waiting | pass | `23-distill-second.txt` |
| 6.1 | where says step 5, then step 6 | pass | `25-where-step5.txt`, `27-where-step6.txt` |
| 6.2 | PASS on the draft | **pass**, at the first promote. No stop, no Editor wording, no error line in either store. | `28-promote.txt`, `28-promote-records.txt`, `28a-promote-stores.txt` |
| 6.3 | The card says "Your 2 rows: 2 of 2". The flips are the press pool (Applies to Does not apply) and AI Force (Can't tell to Applies). | pass | `28-promote.txt`, `28-promote-records.txt` |
| 6.4 | Press pool and AI Force are Fixed and Done on 2026-10-21.2 | pass | `31-tables-after-promote.txt`, `30-followup-records.txt` |
| 6.5 | USPS and Georgia carry no Follow-up mark and still read Waits for you on 2026-10-21.1 | pass | `31-tables-after-promote.txt` |
| 6.6 | where says complete; status has no "Your decisions" row; verify --json is clean | pass | `32-where-after-promote.txt`, `33-status-end.txt`, `34-verify-end.txt` |
| 7.1 | Every report passes `lintReport`, with no hash, path, run id or duration | pass: all 26 `report.md` files of the run and the stdout of every W command. Not reports: start's progress line, verify `--json`, the pull engineer lines. | `36-sweep-reports-plans.txt`, the `*.txt` step files |
| 7.2 | Every plan writes only the agent's columns, apart from the logged editor actions | pass (see the note under this table) | `36-sweep-reports-plans.txt`, `37-demo-json-and-editor-actions.txt` |
| 7.3 | No production script ran | pass. Nothing under `runs/` outside `demos/` is newer than the start; the newest production run is still 20261021T181312Z-status. PAUSED, SETUP and PROMOTING.json are absent. | `36-sweep-reports-plans.txt`, `99-commit-end.txt` |
| 7.4 | The commit is unchanged | pass for code. HEAD moved 84c0e52 to 291f05d, docs only, before my first command; 291f05d at the end. | `00-commit-start.txt`, `00b-commit-moved.txt`, `99-commit-end.txt` |

**Check 7.2 in detail.**
- Editor columns were written only by:
  - the setup creates of the Claims rows (the `runs/SETUP` exception);
  - 5 decide plans and 1 approve plan. All six are logged in `editor-actions.jsonl` (12 lines, planned then done, read_back ok).
- Every ledger line of the run is done with read_back ok.

## Run 5's findings, one by one

1. **Must: after a failed extra read, promote stopped the same way every time. Not met again live; the fix is confirmed offline.**
   - **Live.** The first promote passed on the draft. It did not stop, so the "second promote reaches the retry" path was not exercised.
   - **Close call.** The batch that failed twice in run 5 failed once here. That is the candidate's third read of the press pool and AI Force rows. Batch 4 is stored with `attempt: 2` and the usage of two calls, so its first reply was refused and the second accepted within the same run (`28d-extra-read-second-attempt.txt`).
   - **The code.** At 84c0e52, `judge.mjs summarize()` counts an error line only in a run that `planReruns` asks for (decision 80, CONTRACTS section 6).
   - **The tests on the fakes.** The 8 named tests pass (`28b-tests-retry.txt`), in `tests/mvp/promote.test.mjs` and `judge.test.mjs`. Two cover this case directly:
     - "an extra read that comes back without a claim twice stops the check with exit 2 … the next promote makes only that read again and passes". It asserts that the second promote makes exactly one call, for the two missing reads.
     - "an extra read that fails again stops at the extra read once more, not in the judge; the third promote passes".
   - **Replay of run 5's stuck state** (`28c-replay-run5-stuck-store.txt`). I fed run 5's stuck candidate store (`20261021-2303-555445/…/judgments/14f395d76261bed8`) through the exported `planReruns`. The plan asks for no run 2 and no run 3. So both run-3 error lines that stopped run 5 three times would no longer be counted, and a second promote would reach `forceRuns`, which asks again for every item without an ok line.
2. **Nice: the page's "If something stops" contradicted the promote stop report. Fixed.**
   - `page.md` and the built page (`preview.md` line 289) now have the fourth case: "Claude says some answers could not be read: type the same command again; it continues where it stopped. If it stops the same way twice, send the engineer the whole report."
   - This matches promote's stop sentence ("some answers could not be read again") and the troubleshooting row.
   - Not exercised live, since nothing stopped.
3. **Nice: the second distill's reason read as if it contradicted its own table. Fixed as worded.**
   - The sentence now reads "the 2 decisions that point at rule 3 already have a rule change waiting for you".
   - One remnant remains: the table row still says "Point at a rule: none" two lines below (new issue 1).

**Items still open from run 3:**
- `start` prints "Building the page." above the report sentence, so its whole stdout fails the lint ("the sentence runs over more than one line"). Still open.
- `where` does not name its page: "Walkthrough: you are at step 3, Decide your four claims." Still open.
- The promote Next link opens the top of the page, not step 7. Still open.
- Run 3 issue 5, a lesson title that is a full sentence: not met again. This run's title is "Groups known by standing role count; unknown names do not", the same shape as the page's example.

**Run 5's observations, revisited:**
- PASS on the draft: now met.
- Last run after a stopped promote: not met, since nothing stopped.
- The draft rewording the end of rule 3: not met again. This draft keeps rule 3 word for word and adds to it.
- Georgia citing no rule: not met again. It cites rule 5, as on the page.
- The decide Next line after the USPS note still says "open Lessons waiting … set Status to Approved" while status says "1 to read". This is the spec's order, and a backlog row already covers it.

## New issues

### 1. Nice. The second distill's table still says "Point at a rule: none" under a sentence that says 2 decisions point at rule 3.

- **What the report shows** (`23-distill-second.txt`): "…; the 2 decisions that point at rule 3 already have a rule change waiting for you". The table row below it reads "Point at a rule | none".
- **Why.** The table counts only the readings made in this run (CONTRACTS 17), and this run's only reading was the USPS Agent slip.
- **Suggested words** (`distill.mjs`, the table rows): when the reason comes from `openRuleReason`, write the row as "Point at a rule | none new; 2 are in the rule change waiting". Alternatively, say once that the counts are this run's, for example with the header "What | This time".

### 2. Nice. Page step 2 promises "0.65 or more" for the five earlier decisions; this run gave Dallas 0.57.

- **What happened.** The Dallas claim was read 0.72, then 0.20 (do_not_apply), then 0.80. That gives Applies "2 of 3 runs agree" and Agent confidence 0.57. The claim is still Done with the right tag (`09-tables-after-tag.txt`).
- **The floor sits at the edge.** Calibration runs 6 and 7 had Dallas at 0.65 and 0.66.
- **Suggested words** (`walkthrough/page.md` lines 54 to 58): "usually 0.65 or more" in the five cells. Or add after the table: "The figures differ from run to run, the earlier decisions included."

### 3. Nice, for the engineer (15 October code, not this feature). The safety check's extra reads keep no refused reply.

- **What happened.** Batch 4 of `forceRuns` needed a second attempt. Nothing in the run folder says why the first reply was refused:
  - there is no `rejected/` folder;
  - `calls.jsonl` lists both calls with `status: ok` and no batch, attempt or id;
  - `answers.mjs` lines 99 to 123 hold the problems only in memory, and write them only when both attempts fail.
- **Why it matters.** The judge keeps every refused reply (decision 36), precisely so that a refusal can be traced to the model or the message. Run 5's must started in this same 2-claim batch, and the batch needed a second attempt again here.
- **Suggested fix.** `forceRuns` keeps refused replies as `rejected/reread-batch-<n>-attempt-<k>.md` in the promote run folder, as `judge.mjs` does. Its `calls.jsonl` line also carries `batch`, `attempt`, `items` and whether the reply was accepted.

### Observations, not findings

- **The draft quotes the claim's own words.** Rule 3 now says: A group that every reader knows by its standing role ("the press pool") counts as identified.
  - "the press pool" is the editor's word in the note and also the claim's own wording.
  - `prompts/distill.md` lines 24 and 25 ask for the editors' words but put the claims' wording off limits. The 8-word overlap guard cannot catch a 3-word phrase.
  - With the claim's phrase inside the rule, the "yours" check on the press pool row partly confirms itself. This is a prompt-quality question for the engineer, not a defect of this feature.
- **status and where end differently.** At the end, status's Next is "type /claim-tagger demo tag to read new claims", while where says "nothing to type". This is the same as in run 5; the page does not ask for status at step 7.
- **One Help bullet holds two cases.** "Anything else: send the engineer the whole report." still sits inside the hand-edited-rulebook bullet of "If something stops"; it could be its own bullet. Not new.
- **`W list` touched five other demos' local folders.** The two list runs wrote local pull records there. Nothing was written to Notion.
- **The distill message is still not kept.** But `run.json` now names the shown and counter rows, which showed directly that the no-note USPS row was left out of both.

## The page against the build

- **Step 1** matched word for word.
- **Step 2** matched within what the page allows: press pool 0.85, AI Force 0.50 Can't tell "2 of 2", USPS 0.80 rule 3, Georgia 0.80 rule 5. The exception is the floor "0.65 or more" on Dallas (new issue 2).
- **Steps 3 and 5** matched. Step 3's no-note sentence describes the detour exactly as it ran.
- **Step 4** matched once USPS had its note:
  - the four claim lines;
  - the seeded lines;
  - the draft resting on the press pool and AI Force, with the press pool first in Supporting rows;
  - Proposed text "keeps it and adds".
- **Step 6** held exactly as promised. It was one long wait (110 s) ending in PASS, and the Rule changes row reads "Live | PASS: examples 10/10, earlier 6/6, yours 2/2". The Rulebook's rule 3 changed. Agent settings reads "Promote · 22 Oct 00:04 · PASS". The check read what the page says it reads: 10 examples, 7 earlier decisions and the 2 rows, and the two flipped items twice more on each side.
- **Step 7** matched exactly:
  - press pool (empty) Done and AI Force Context-dependent Done, both on 2026-10-21.2;
  - USPS and Georgia (empty), Waits for you, 2026-10-21.1;
  - the five earlier decisions keep 2026-10-21.1.
- **Help, "If something stops."** It now has four cases, and the new one matches the promote stop report (run 5's issue 2). It was not exercised, because nothing stopped.

## Evidence in this folder

- **Step files.** `NN-<step>.txt` holds the command, exit code, start and end time, HEAD, stdout, stderr and the stdout's lint. `NN-<step>.out.md` holds the stdout alone.
- **Tables** (claims, ledger, rule changes, settings and the rulebook's When to use, for each pull):
  - `03-tables-fresh.txt`
  - `09-tables-after-tag.txt`
  - `18-tables-after-decide.txt`
  - `20-tables-after-distill1.txt`
  - `24-tables-after-distill2.txt`
  - `31-tables-after-promote.txt`
- **Run records:**
  - `07-judge-records.txt` (with the store), `08-propose-records.txt`;
  - `19-distill-first-records.txt`, `23-distill-second-records.txt`;
  - `28-promote-records.txt`, `28a-promote-stores.txt`, `30-followup-records.txt` (follow-up, record, baseline and candidate);
  - `37-demo-json-and-editor-actions.txt`.
- **Run 5's finding 1:**
  - `28b-tests-retry.txt` (8 tests on the fakes, all pass);
  - `28c-replay-run5-stuck-store.txt` (run 5's stuck store put through `planReruns`);
  - `28d-extra-read-second-attempt.txt`.
- **Sweep.** `36-sweep-reports-plans.txt`.
- **Commit.** `00-commit-start.txt`, `00b-commit-moved.txt`, `99-commit-end.txt`.

**Overall verdict: 0 must, 0 should, 3 nice.**
- **End to end:** the walkthrough worked without a detour. Every command exited 0 at its first try, and the first promote passed on the draft.
- **Decision 78** held on the no-note detour.
- **The end state is right.** The follow-up marked only the press pool and AI Force. USPS and Georgia kept Waits for you. where, status and verify ended as the page says.
- **Run 5's three findings:** issue 2 fixed, issue 3 fixed as worded, issue 1 not met again live. Issue 1's fix is confirmed by the tests on the fakes and by replaying run 5's stuck store.
- **The loop can stop.** By READ-DECISIONS section 3 (stage 5), this is the first run with no must or should finding, and the three nice items go to the backlog.
