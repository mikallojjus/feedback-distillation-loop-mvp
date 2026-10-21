# Walkthrough verification, fifth run ("Read the decisions", second loop), 21 October 2026

I am an independent verifier and did not build the feature. I built a fresh practice page and went through its seven steps as an editor would, in the order the brief gives. That order includes the planned detour from run 4: the USPS claim was first decided with no note, then given the manifest's "Agent slip." note. The run went from 20:03:19 to 20:16:55 UTC (23:03 to 23:16 local). Per the agent instructions I did not write REPORT.md; this text is the report, and the engineer saves it unchanged.

- **Demo id:** `20261021-2303-555445`
- **Page:** "Claim tagger practice · verification 5", id `400273e214eb81beac86ce8c86ba1346`, under Demo tests
- **Evidence folder:** `X:\work\geo-agents\docs\mvp-2026-11\evidence\19-walkthrough-verification-5\`
- **Run folder:** `X:\work\geo-agents\agents\claim-tagger-mvp\runs\demos\20261021-2303-555445\` (ignored by git)

## The run

- **Commit.** HEAD was `4a08bf01cc6e5c039226c23bd4a051a177c52b56` at the start (`00-commit-start.txt`) and the same at the end (`99-commit-end.txt`).
  - The brief names 234d51a. HEAD is one commit after it: 4a08bf0, "work log entry 28 … state, five backlog rows". That commit touches only `BACKLOG.md`, `STATE.md` and `WORKLOG.md`, no code.
  - I made no commit.
- **Working tree.** The three modified files under `docs/mvp-2026-11/report/` date from 21:50:56 local (run 4's time) and did not change during this run.
- **What I ran and wrote.**
  - Every command was `node agents/claim-tagger-mvp/scripts/walkthrough.mjs ...` (W below), run from the repository root. Every command after `start` carried `--demo 20261021-2303-555445`.
  - I acted as the editor only through `W decide` and `W approve` (decision D31).
  - I ran no production script, wrote nothing to Notion by hand or through a connector, did not read `.env`, and edited no repository file.
  - I wrote only the step files in the evidence folder, plus helper scripts in my scratchpad.
- **Page versions.** Manifest 2026-10-22.1. Edition 2026-10-21.1 at build, 2026-10-21.2 after the safety check.
- **Exits.** Every command exited 0 except promote, which exited 2 three times in a row (new issue 1).
- **Detour.** To get past the stuck promote, I used `W approve --wording` once. I wrote Editor wording equal to the draft with one neutral edit: "a press pool, a jury, a press corps" became "a press pool, a jury or a press corps". So the PASS below is on that wording, not on the draft.

## Step by step

| # | Command | Exit | Report shape | What happened | Verdict |
|---|---|---|---|---|---|
| 0 | `W list` | 0 | sentence, 5-row table, Next | 17 pages; the default is "calibration 6" ("used by the demo commands"). | ok |
| 1a | `W start --parent 3fa273e2…7051 --title "Claim tagger practice · verification 5"` | 0 | "Building the page." line, then sentence, 3-row table, Next | Built in 56 s. stderr: the table's own view was set to the review order. | ok. The whole stdout fails the lint only on the known progress line; `report.md` is clean. |
| 1b | `W verify --json` | 0 | JSON | `ok:true`, no problems, `fresh:true`: claims 9, decided 5, open 4, tag_decisions 5, linked views 2, tab views 3, steps 7. | ok |
| 1c | `W where` | 0 | sentence, Next | "you are at step 1, Meet the demo"; Next: `/claim-tagger demo status`. | ok |
| 2a | `W run status` | 0 | sentence, 4-row table, Next | Rulebook "1 tag, edition 2026-10-21.1"; Your queue "nothing waits"; Lessons waiting "none"; Last run "none yet". No "Your decisions" row. Next points at step 2. | ok: matches page step 1 word for word |
| 2b | `W run pull --all`, `judge --items claims`, `propose` | 0, 0, 0 | pull: an engineer line; judge: 3 rows; propose: 3 rows | The tag report: "4 wait for you", "Carrying Context-dependent: 2 claims (earlier decisions included)", "New rows in Your queue: 4, lowest confidence first". Next: "decide your four claims in Your queue (link)". | ok |
| 2c | `W run pull --all`, `W verify`, `W where` | 0, 0, 0 | verify: 3-row table; where: 2 parts | verify: "as it was built" (9: 5 reviewed, 4 waiting for you). where: "step 3, Decide your four claims", with Next "open Your queue (link) and decide your four claims." | ok |
| 3a | `W decide --claim presspool`, `--claim aiforce`, `--claim usps --outcome "Does not apply"`, `--claim georgia` | 0 ×4 | each a 3-row table | The manifest's words were written; USPS and Georgia have "(empty)" notes. Each action is logged as planned, then done with read_back ok. Next said "remaining claims", then "remaining claim", then "type /claim-tagger demo distill." | ok |
| 3b | `W run status`, `W where` | 0, 0 | status: 5-row table | Sentence: "nothing is paused; the agent has 3 of your decisions to read." Your queue: "4 rows decided, waiting for the agent's next run". Your decisions: "3 to read, 1 without a note". Next: "type /claim-tagger demo distill to draft a rule change from your decisions." where says step 4. | ok (run 4's finding 5 fixed) |
| 4 | `W run distill` (first pass) | 0 | sentence, 5-row table, Next | Sentence: "read 3 of your decisions and drafted one rule change from 2 of them; 1 of your decisions has no note and waits in Needs your note". Table: Read 3, Point at a rule 2, Agent slips none, Without a note 1, Rule change "Known standing-role groups identified; unknown names not", Context-dependent rule 3. Next: Lessons waiting. The rule change rests on the press pool and AI Force only. | ok (decision 78 holds; run 4's finding 3 fixed) |
| 5a | `W decide --claim usps` (the manifest's note) | 0 | 3-row table | Note: "Agent slip. USPS names which portal, so rule 5 already settles it." Next: "open Lessons waiting (link) and set Status to Approved." | ok |
| 5b | `W run status` | 0 | 5-row table | Your decisions: "1 to read, 2 point at a rule", with no "without a note" part. Lessons waiting: "1 rule change to approve". Next: "approve or reject the rule change in Lessons waiting (link)". Nothing says the draft rests on a recanted decision. | ok |
| 5c | `W run distill` (second pass) | 0 | sentence, 5-row table, Next | "read 1 of your decisions; no rule change to draft; the rules the rows point at already have a rule change waiting". Agent slips 1; no model call. Next: "approve or reject the rule change in Lessons waiting (link)." | ok (run 4's finding 4 fixed); wording of the reason: new issue 3 |
| 6a | `W where`, `W approve`, `W where` | 0, 0, 0 | 2 parts, 1-row table, 2 parts | where: step 5, then step 6 after approve. approve: Status Approved, logged and read back. | ok |
| 6b | `W run promote` | **2** | sentence, Next | After 73 s: "Promote stopped: some answers could not be read again, so the check could not be finished; nothing was written to Notion." Next: "type /claim-tagger demo promote again; it continues where it stopped." stderr: "2 extra read(s) could not be used". | **finding** (new issue 1) |
| 6c | `W run promote` (as its Next line says), twice | **2, 2** | sentence, Next | Each stops after 4 s: "Promote stopped: some claims could not be read; nothing was written to Notion." The Next line is the same. stderr: "judge: 0 claim(s) could not be read and 2 could not be read again". Nothing was written; status says "1 approved, ready to check"; where says step 6. | **must** (new issue 1): the Next line loops |
| 6d | detour: `W approve --wording "<the draft, 'a jury or a press corps'>"` | 0 | 2-row table | Editor wording filled in, logged and read back. | detour |
| 6e | `W run promote` | 0 | sentence, 3-row table, Next | After 47 s: "PASS, rule 3 now uses your approved wording (edition 2026-10-21.2), and the follow-up marked both of your rows Fixed". Example claims 10 of 10; earlier decisions 6 of 6; **"Your 2 rows: 2 of 2 now right, marked Fixed"**. Next: step 7, with a link to the top of the page. | ok (on the wording) |
| 6f | `W run pull --all`, `W where`, `W run status`, `W verify --json` | 0 ×4 | — | Press pool and AI Force: Fixed, Done, 2026-10-21.2. **USPS and Georgia: no Follow-up, Waits for you, 2026-10-21.1.** where: "you have been through all seven steps". status: no "Your decisions" row; Your queue "2 rows decided, waiting for the agent's next run". verify: ok, decided 9, open 0, rule changes 1. | ok |
| 7 | `W list` | 0 | 5-row table | This page is "ready · complete"; the default page is unchanged. | ok |

**The open claims at the tag step** (`09-tables-after-tag.txt`, `07-judge-records.txt`):

| Claim | Proposal | Confidence | Rule cited | Runs |
|---|---|---|---|---|
| Press pool | Applies | 0.80 | rule 3 | 1 of 1 |
| AI Force | Can't tell | 0.53 | none | 2 of 2 (ask_editor 0.55, then 0.50) |
| USPS | Applies | 0.78 | rule 3 | 1 of 1 |
| Georgia | Does not apply | 0.80 (p 0.20) | none ("No rule fires.") | 1 of 1 |

All four are within what the story tolerates.

**The five earlier decisions** are Done with Agent tags equal to the verified tags: CNN 0.93, Dallas 0.80, contractor 0.95, Kennedy 0.90, stopgap 0.88.

**Times per command:**

| Command | Time |
|---|---|
| start | 56 s |
| verify | 14 to 17 s |
| where | 4 s |
| list | 18 to 22 s |
| status | 4 to 7 s |
| tag step | 43 s (pull 4, judge 21, propose 18) |
| decide | 6 to 8 s |
| distill | 36 s first pass, 9 s second |
| approve | 10 s, 6 s |
| promote | 73 s (stopped), 4 s, 4 s (stopped), 47 s (PASS, with the follow-up) |

## The feature checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1.1 | Fresh page: 9 claims, 5 decided, 4 open, ledger 5 | pass | `03-verify-fresh.txt` |
| 1.2 | The seeded rows read Agent slip, with "Seeded from the audit of 9 October." and a Read under (for example "2026-10-21.1 · 8560829f") | pass. Rule is empty on the seeded rows, as in run 4. | `03-tables-fresh.txt` |
| 1.3 | The decided claims carry the seeded line; the open claims' Agent reading is empty | pass | `03-tables-fresh.txt` |
| 1.4 | The Claims columns and the three view filters equal the manifest's `expect` | pass (verify ok, no problems) | `03-verify-fresh.txt` |
| 1.5 | where says step 1 | pass | `04-where-step1.txt` |
| 2.1 | status equals page step 1, with no "Your decisions" row | pass | `05-status-step1.txt` |
| 2.2 | After the tag step: all four Waits for you, Agent reading empty, verify clean, where says step 3 | pass | `09-tables-after-tag.txt`, `10-verify-after-tag.txt`, `11-where-step3.txt` |
| 3.1 | status: "Your decisions: 3 to read, 1 without a note"; the sentence names the decisions to read; Your queue "4 rows decided, waiting for the agent's next run"; Next names distill; where says step 4 | pass | `16-status-after-decide.txt`, `17-where-step4.txt` |
| 4.1 | Press pool reads Rule should change and AI Force Rule unclear, both on "Context-dependent rule 3", with a one-line note and a Read under "<edition> · <8 hex>" (f6ebacfb, 830960e5) | pass | `20-tables-after-distill1.txt` |
| 4.2 | USPS is read by the model, and its Reading note opens "without your note · " | pass. Read Rule unclear, rule 3; `no_note: true` in `readings.jsonl`. | `20-tables-after-distill1.txt`, `19-distill-first-records.txt` |
| 4.3 | The Georgia row has no reading columns | pass | `20-tables-after-distill1.txt` |
| 4.4 | Claim lines follow decision 68: USPS "…Rule unclear, rule 3, without your note · …"; Georgia "Nothing to read: the agent agreed with you." | pass | `20-tables-after-distill1.txt` |
| 4.5 | Exactly one call with purpose reading | pass: one reading call (3 items), plus one distill call (2 items) | `19-distill-first-records.txt` |
| 4.6 | **Decision 78.** One rule change, Proposed on rule 3; Supporting rows name the press pool and AI Force keys only; the Proposed text says nothing about USPS or a portal | **pass**. supporting_keys = [5c9d133e…, 92f57020…]. The Proposed text adds the capitalised-name clause and the standing-role exclusion only. | `20-tables-after-distill1.txt` |
| 4.7 | The sentence counts decisions, and the table rows match | pass. Exactly as in CONTRACTS 17: "read 3 of your decisions and drafted one rule change from 2 of them; 1 of your decisions has no note and waits in Needs your note". Point at a rule 2, Without a note 1. | `19-distill-first.txt` |
| 4.8 | Next names Lessons waiting; the report has at most five rows | pass | `19-distill-first.txt` |
| 4.9 | USPS is the only claim whose Agent reading contains "without your note" (so the Needs your note view holds USPS only) | pass | `20-tables-after-distill1.txt` |
| 5.1 | After the note, status shows "1 to read" with no "without a note" part; Lessons waiting "1 rule change to approve"; Next approve or reject; no recanted wording | pass | `22-status-after-note.txt` |
| 5.2 | The second distill makes no reading call | pass (that run has no `calls.jsonl`; the reading is verbatim) | `23-distill-second-records.txt` |
| 5.3 | USPS row: Agent slip, Rule "Context-dependent rule 5", Reading note "Your note says so.", Read under changed from 5158c072 to 805066ea | pass | `24-tables-after-distill2.txt` |
| 5.4 | USPS claim line: "Context-dependent: Agent slip, rule 5 · Your note says so." | pass | `24-tables-after-distill2.txt` |
| 5.5 | No second rule change | pass | `24-tables-after-distill2.txt` |
| 5.6 | No claim contains "without your note" | pass | `24-tables-after-distill2.txt` |
| 5.7 | The second distill's Next names approve or reject in Lessons waiting | pass | `23-distill-second.txt` |
| 6.1 | where says step 5, then step 6 | pass | `25-where-step5.txt`, `27-where-step6.txt` |
| 6.2 | PASS on the draft | **not met**. Promote stopped three times (new issue 1). PASS came only on the near-identical Editor wording: examples 10/10, earlier 6/6, yours 2/2. | `28*.txt`, `30-promote-records.txt` |
| 6.3 | The card says "Your 2 rows: 2 of 2" | pass. The flips are the press pool (apply to do_not_apply) and AI Force (do_not_apply to apply). | `30-promote-wording.txt`, `30-promote-records.txt` |
| 6.4 | Press pool and AI Force Fixed and Done on 2026-10-21.2 | pass | `31-tables-after-promote.txt`, `30-followup-records.txt` |
| 6.5 | USPS and Georgia carry no Follow-up mark and still read Waits for you on 2026-10-21.1 | **pass** (run 4's finding 1) | `31-tables-after-promote.txt` |
| 6.6 | where says complete; status has no "Your decisions" row; verify --json is clean | pass | `32-where-after-promote.txt`, `33-status-end.txt`, `34-verify-end.txt` |
| 7.1 | Every report passes `lintReport`, with no hash, path, run id or duration | pass: all 38 `report.md` files and the stdout of every W command. Not reports: start's progress line, verify `--json`, the pull engineer lines. | `36-sweep-reports-plans.txt`, the `*.txt` step files |
| 7.2 | Every plan writes only the agent's columns, apart from the logged editor actions | pass. Editor columns were written only by the setup creates and the 5 decide and 2 approve plans, all logged (14 lines, read_back ok). | `36-sweep-reports-plans.txt`, `37-demo-json-and-editor-actions.txt` |
| 7.3 | No production script ran | pass. Nothing under `runs/` outside `demos/` is newer than the start; the newest production run is still 20261021T181312Z-status. | `99-commit-end.txt` |
| 7.4 | The commit is unchanged | pass (4a08bf0 at start and end) | `00-commit-start.txt`, `99-commit-end.txt` |

**Not exercised live.** Decision 79's recanted path needs a decision with a note that supports a draft and is later re-read as Agent slip. This sequence cannot reach it, because decision 78 keeps the no-note USPS row out of the draft. The first promote ran its recanted check and correctly did not hold. Unit tests on the recanted path exist in `tests/mvp/` (distill, status, promote, followup, readings, walkthrough).

## Run 4's findings, one by one

1. **Must: a later "Agent slip." note did not reach a rule change already drafted on that row.**
   - **Not met again on this sequence, and the end state is right.** Decision 78 keeps the no-note USPS row out of the draft: the Supporting rows name the two rule keys only and the Proposed text has no portal clause. The card counted "Your 2 rows". The follow-up marked only the press pool and AI Force. USPS and Georgia kept Waits for you on 2026-10-21.1.
   - The recanted case (decision 79) was not exercised live; see above.
2. **Should: a no-note disagreement joined a draft.** Fixed (decision 78), seen live in check 4.6.
3. **Should: the distill sentence counted rows as notes.** Fixed: "…drafted one rule change from 2 of them; 1 of your decisions has no note and waits in Needs your note".
4. **Nice: the second distill's Next line said status.** Fixed: "approve or reject the rule change in Lessons waiting (link)".
5. **Nice: status said "nothing waits for you" next to decisions to read.** Fixed: "nothing is paused; the agent has 3 of your decisions to read."
6. **Nice: the page did not explain a decision without a note, or Claude's distill report.** Fixed, in `page.md` and in the built page (`preview.md` lines 106 and 136):
   - step 3: "If you disagree with the agent and leave the note empty, … drafts nothing from it until you add a note."
   - step 4: "Claude's report counts what was read, what points at a rule, the agent's slips and the decisions without a note, and its Next line opens Lessons waiting."

**Items still open from run 3** (all three are now rows in `BACKLOG.md` as of 4a08bf0):
- `start` prints "Building the page." above the report sentence, so its whole stdout fails the lint. Still open.
- `where` does not name its page: "Walkthrough: you are at step 3, Decide your four claims." Still open.
- The promote Next link opens the top of the page, not step 7. Still open.
- Run 3 issue 5, a lesson title that is a full sentence: not met again. This run's title is "Known standing-role groups identified; unknown names not".

## New issues

### 1. Must. After an extra read fails, promote stops the same way every time, while its Next line says it "continues where it stopped".

**What happened:**

1. The first promote (`28-promote.txt`) judged both rulebooks. Two claims flipped under the candidate: the press pool and AI Force.
2. The extra reads that settle a flip run in `lib/answers.mjs` (`forceRuns`). The candidate's third read was one two-claim batch, and the model left the AI Force claim out of its reply twice: "the claim "case-92f57020…::Context-dependent" is missing from the reply".
3. Both items got error lines in run 3 of the candidate store (`judgments/14f395d76261bed8/run-3.jsonl`). Promote stopped with exit 2 and the Next line "type /claim-tagger demo promote again; it continues where it stopped."
4. The second and third promote (`28b`, `28c`) each stopped after 4 s with exit 2: "Promote stopped: some claims could not be read". The Next line was the same, and so was the stderr: "judge: 0 claim(s) could not be read and 2 could not be read again". Every further promote will stop the same way.

**Why** (`28g-promote-stuck-analysis.txt`):
- Promote runs the candidate judge before `forceRuns`.
- `judge.mjs summarize()` counts any error line in runs 1 to 3 as "could not be read again" and exits 2.
- But `planReruns()` plans a third read only for items whose runs 1 and 2 disagree (line 591). The candidate read the press pool do_not_apply 0.20 then 0.15, and AI Force apply 0.85 then 0.85, so the judge never reads them again.
- `forceRuns` is the only code that would retry them (it reads every item without an ok line), and promote never reaches it.

**Scope:**
- The code is from 15 October (judge 224faf5, answers ddd24fe), not from this branch.
- It hits production promote as much as the practice page.
- No test covers a failed extra read followed by a second promote.

**Effect on the editor:**
- The walkthrough cannot get past step 6 by following the reports. status says "1 approved, ready to check" and where says step 6, so both send the editor back to the same command.
- I got past it only through the Editor wording detour, which changes what is tested.

**How it could be fixed** (the engineer decides):
- (a) `planReruns` also plans run 2 or 3 for an item whose line in that run is an error. The judge that reports the failure then retries it, and the promise holds.
- (b) `summarize` does not count error lines in runs its own plan did not ask for, so promote reaches `forceRuns`, which retries them.
- Either way, add a test: a fake reply that drops one item of the flip-settle batch twice, then a second promote that passes.

### 2. Nice. The page's "If something stops" contradicts the promote stop report.

- **The contradiction.** Help lists the paused, allowance and hand-edited-rulebook cases, then says "Anything else: send the engineer the whole report". The promote stop report says "type … promote again; it continues where it stopped".
- **Suggested line, once issue 1 is fixed:** "Claude says some answers could not be read: type the same command again; it continues where it stopped. If it stops the same way twice, send the engineer the whole report."

### 3. Nice. The second distill's reason reads as if it contradicts its own table.

- **What the report shows.** The sentence says "no rule change to draft; the rules the rows point at already have a rule change waiting". The table, two lines below, says "Point at a rule: none", because the only reading of this run is the USPS Agent slip.
- **Why it jars.** "Rows" is engineer wording; elsewhere the reports say "decisions".
- **Suggested words** (`distill.mjs` line 644): "the 2 decisions that point at rule 3 already have a rule change waiting for you".

### Observations, not findings

- **The PASS was on Editor wording.** It differs from the draft only by "a jury or a press corps" in place of "a jury, a press corps". So "PASS on the draft" was neither met nor refuted in this run.
- **A stopped promote leaves Last run as it was.** It writes nothing to Notion, so Agent settings still read "Distill · 21 Oct 23:09 · no rule change". Help says Last run summary "always describes the latest command". The report did say nothing was written; "the latest command that finished" would be exact.
- **The draft reworded the end of rule 3.** "Applies to countable things, not to abstract or mass nouns" became "It does not include … or abstract or mass nouns". The page says Proposed text "keeps it and adds …". It keeps it in substance, not word for word.
- **The decide Next line skips distill after the USPS note.** It says "open Lessons waiting … and set Status to Approved", while status says "1 to read". This follows the spec's order: approve comes before distill while a rule change is Proposed. An editor who follows it leaves USPS in Needs your note, with its old no-note reading, until a later distill. That is the lag the backlog row "Needs your note in step with the status count" already covers.
- **Georgia cited no rule** ("No rule fires."); page step 2's example cites rule 5. This is within "as one run read them".
- **`W list` touched four other demos' local folders.** As in run 4, the two runs wrote local pull records and refreshed `evals/cases.jsonl` there. Nothing was written to Notion.
- **The distill message is not kept.** So I could not see directly that the no-note row was left out of the counter-evidence. The visible effect is right: the distill call had 2 items and the Proposed text has no portal clause.

## The page against the build

- **Step 1** matched word for word.
- **Step 2** matched; the figures differed in the way the page allows (AI Force 0.53, USPS 0.78, Georgia 0.80 with no rule cited).
- **Steps 3 and 5** matched.
- **Step 4** matched on the page's own path once USPS had its note. The press pool read Rule should change and AI Force Rule unclear, both on rule 3. The claim lines, the agree line on Georgia and the seeded lines all match. The draft rests on the press pool and AI Force only, and "The USPS claim drafts nothing" now holds even on the no-note detour. Step 3's new sentence describes the detour exactly as it ran.
- **Step 6** did not hold as promised on the first try. The page promises a single long wait that ends in PASS or FAIL; the run got a stop whose Next line loops (issue 1), and Help does not cover it (issue 2). Once past it, the Rule changes row read "Live | PASS: examples 10/10, earlier 6/6, yours 2/2", exactly as on the page, and Agent settings read "Promote · 21 Oct 23:15 · PASS".
- **Step 7** matched exactly:
  - press pool (empty) Done, AI Force Context-dependent Done, both on the next edition;
  - USPS and Georgia (empty), Waits for you, 2026-10-21.1;
  - the five earlier decisions keep 2026-10-21.1.
- **What the run showed that the page does not explain:**
  - the promote stop (issues 1 and 2);
  - the "Your decisions" row of status (the page asks for status only at step 1; observation carried from run 4).

## Evidence in this folder

- **Step files.** `NN-<step>.txt` holds the command, exit code, start and end time, HEAD, stdout, stderr and the stdout's lint. `NN-<step>.out.md` holds the stdout alone.
- **Tables** (claims, ledger, rule changes and settings of each pull):
  - `03-tables-fresh.txt`
  - `09-tables-after-tag.txt`
  - `18-tables-after-decide.txt`
  - `20-tables-after-distill1.txt`
  - `24-tables-after-distill2.txt`
  - `28d-tables-after-stuck-promote.txt`
  - `31-tables-after-promote.txt`
- **Run records:**
  - `07-judge-records.txt`, `08-propose-records.txt`;
  - `19-distill-first-records.txt`, `23-distill-second-records.txt`;
  - `28-promote-first-records.txt` (with both judgment stores), `28b-promote-again-records.txt`, `28c-promote-third-records.txt`, `28g-promote-stuck-analysis.txt`;
  - `30-promote-records.txt` (card, plans), `30-followup-records.txt`;
  - `37-demo-json-and-editor-actions.txt`.
- **Sweep.** `36-sweep-reports-plans.txt`.
- **Commit.** `00-commit-start.txt`, `99-commit-end.txt`.

**Overall verdict: 1 must, 0 should, 2 nice.**
- **End to end:** not without a detour. Every fix of run 4 held, and decision 78 worked live. But the walkthrough stalled at step 6: promote stopped three times on a failed extra read that its own Next line cannot get past. That defect dates from 15 October and is not from this branch. After one near-identical Editor wording, the safety check passed, and the follow-up marked only the two rule rows. USPS and Georgia stayed Waits for you, and where, status and verify ended as the page says.
