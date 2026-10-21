# Walkthrough verification, fourth run ("Read the decisions"), 21 October 2026

An independent verifier, who did not build the feature, built a fresh practice page and went through its seven steps as an editor would. The sequence was the one in READ-DECISIONS.md section 4, as the brief repeats it, with one planned detour: the USPS claim was first decided with no note, then given the manifest's "Agent slip." note. The run was on 21 October 2026 from 18:49:34 to 19:08:55 UTC (21:49 to 22:08 local time). The harness refused to let the verifier write this file, so the engineer saves its text unchanged.

- **Commit.** HEAD was `131d72f1972d962985c1d92e7e601acb59dc305f` at the start (`00-commit-start.txt`) and at the end (`99-commit-end.txt`). The verifier made no commit.
- **Working tree.** It changed during the run, though not by the verifier. Three files under `docs/mvp-2026-11/report/` were rewritten at 18:50:56 UTC, while `W start` was building the page: `data/counts.json`, `parts/02-status.html` and `parts/03-how-to-run.html`. No script under `agents/claim-tagger-mvp/scripts` names those files, so another session (the artifact generator) wrote them. They are not code under test.
- **Commands.**
  - Every command was `node agents/claim-tagger-mvp/scripts/walkthrough.mjs ...` (W below), run from the repository root. Every command after `start` carried `--demo 20261021-2149-242961`.
  - The verifier acted as the editor only through `W decide` and `W approve` (decision D31).
  - It ran no production script, wrote nothing to Notion by hand or through a connector, did not read `.env`, and edited no repository file.
  - It wrote only the step files in the evidence folder, plus helper scripts in its own scratchpad.
- **The page.** Manifest 2026-10-22.1. The edition was 2026-10-21.1 at build and 2026-10-21.2 after the safety check.
- **Exits.** Every command exited 0. Nothing needed a retry, no command hit the usage window, and no wording round was needed.

## Step by step

| # | Command | Exit | Report shape | What happened | Verdict |
|---|---|---|---|---|---|
| 0 | `W list` | 0 | sentence, 5-row table, Next | 16 pages; "calibration 6" marked "used by the demo commands"; Next says to archive by hand. | ok |
| 1a | `W start --parent 3fa273e2…7051 --title "Claim tagger practice · verification 4"` | 0 | "Building the page." line, then sentence, 3-row table, Next | Built in 67 s: five tables, two linked views, three tabs. stderr: the table's own view was set to the review order. | ok. The full stdout fails the lint only because of the known progress line; `report.md` is clean. |
| 1b | `W verify --json` | 0 | JSON | `ok:true`, no problems, `fresh:true`: claims 9, decided 5, open 4, ledger 5, linked views 2, tabs 3. | ok |
| 1c | `W where` | 0 | sentence, Next | "you are at step 1, Meet the demo"; Next says to type `/claim-tagger demo status`. | ok |
| 2a | `W run status` | 0 | sentence, 4-row table, Next | Rulebook "1 tag, edition 2026-10-21.1"; Your queue "nothing waits"; Lessons waiting "none"; Last run "none yet". No "Your decisions" row. Next points at step 2. | ok: matches page step 1 word for word |
| 2b | `W run pull --all`, `judge --items claims`, `propose` | 0, 0, 0 | pull: an engineer line. judge: 3 rows (Claims read 9, Unsure 1, Re-read 1). propose: 3 rows. | The tag report says 4 wait for you, "Carrying Context-dependent: 2 claims (earlier decisions included)" and "New rows in Your queue: 4". Next: "decide your four claims in Your queue (link)". | ok |
| 2c | `W run pull --all`, `W verify`, `W where` | 0, 0, 0 | verify: 3-row table. where: 2 parts. | verify: "as it was built" (9: 5 reviewed, 4 waiting for you). where: "step 3, Decide your four claims"; Next: "open Your queue (link) and decide your four claims." | ok |
| 3a | `W decide --claim presspool`, `--claim aiforce`, `--claim usps --outcome "Does not apply"`, `--claim georgia` | 0 ×4 | each a 3-row table (Verified tags, Challenged tags notes, Review status) | The manifest's words were written and read back; USPS and Georgia show "(empty)" notes. Each decision is logged in `editor-actions.jsonl` as planned, then done with read_back ok. Next says "remaining claims", then "remaining claim", then "type /claim-tagger demo distill." | ok |
| 3b | `W run status`, `W where` | 0, 0 | status: 5-row table | "Your queue: 4 rows decided, waiting for the agent's next run"; "Your decisions: 3 to read, 1 without a note"; Next: "type /claim-tagger demo distill to draft a rule change from your decisions." where says step 4. | ok |
| 4 | `W run distill` (first pass) | 0 | sentence, 5-row table, Next | "read 3 of your decisions and drafted one rule change from your 3 notes". Table: Read 3, Point at a rule 3, Agent slips none, Without a note 1, Rule change "A kind is identified only if readers know which one". Next: Lessons waiting. **The model read the USPS row (no note) as Rule unclear on rule 3, so the draft rests on three rows, USPS included.** | partly: issues 1 and 2 |
| 5a | `W decide --claim usps` (the manifest's note) | 0 | 3-row table | The note is now "Agent slip. USPS names which portal, so rule 5 already settles it."; Next: "open Lessons waiting (link) and set Status to Approved." | ok |
| 5b | `W run status` | 0 | 5-row table | "Your decisions: 1 to read, 2 point at a rule"; "Lessons waiting: 1 rule change to approve"; Next: "approve or reject the rule change in Lessons waiting (link)". | ok. The "2 point at a rule" part is decision 74's pending count. |
| 5c | `W run distill` (second pass) | 0 | sentence, 5-row table, Next | "read 1 of your decisions; no rule change to draft; the rules the rows point at already have a rule change waiting"; Agent slips 1; no model call. Next: "type /claim-tagger demo status to see what is open." **The rule change still rests on the USPS row and keeps its USPS clause.** | partly: issue 1 |
| 6a | `W where`, `W approve`, `W where` | 0, 0, 0 | 2 parts, 1-row table, 2 parts | where says step 5 (Next: "open Lessons waiting (link) and set Status to Approved"). approve: Status Approved, logged and read back. where then says step 6. | ok |
| 6b | `W run promote` | 0 | sentence, 3-row table, Next | **PASS on the draft** with no wording round; edition 2026-10-21.2. Example claims 10 of 10; earlier decisions 6 of 6; **"Your 3 rows: 3 of 3 now right, marked Fixed"**. Next points at step 7 with a link to the top of the page. Took 179 s. | fails the feature check: USPS marked Fixed (issue 1) |
| 6c | `W run pull --all`, `W where`, `W run status`, `W verify --json` | 0 ×4 | — | Press pool, AI Force **and USPS** are Fixed, Done, 2026-10-21.2. Georgia has no Follow-up, still Waits for you, 2026-10-21.1. where: "you have been through all seven steps". status: no "Your decisions" row; Your queue "1 row decided, waiting for the agent's next run". verify: ok, decided 9, open 0, rule changes 1. | Georgia ok; USPS not as specified |
| 7 | `W list` | 0 | 5-row table | This page is "ready · complete"; the default page is unchanged ("calibration 6"). | ok |

**The open claims at the tag step** (`09-tables-after-tag.txt`; judge records in `07-judge-records.txt`):

| Claim | Proposal | Confidence | Rule cited | Runs |
|---|---|---|---|---|
| Press pool | Applies | 0.80 | rule 3 | 1 of 1 |
| AI Force | Can't tell | 0.52 | none (the reason mentions rule 3) | 2 of 3 (apply 0.60 on rule 3, ask_editor 0.55, ask_editor 0.40) |
| USPS | Applies | 0.75 | rule 3 | 1 of 1 (on the band edge, so it was not read again) |
| Georgia | Does not apply | 0.78 (p 0.22) | rule 5 | 1 of 1 |

All four are within what the story tolerates. The five earlier decisions are all Done, with Agent tags equal to the verified tags. Their confidence: CNN 0.90, Dallas 0.78, contractor 0.92, Kennedy 0.88, stopgap 0.80.

**Times per command, for the engineer:**

| Command | Time |
|---|---|
| start | 67 s |
| verify | 15 to 19 s |
| where | 3 to 6 s |
| list | 12 to 18 s |
| status | 4 to 6 s |
| tag step | 51 s (pull 3, judge 26, propose 22) |
| decide | 7 to 11 s |
| distill | 48 s first pass, 9 s second |
| approve | 7 s |
| promote, with the follow-up | 179 s |

## The feature checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1.1 | Fresh page: 9 claims, 5 Reviewed, 4 open, ledger 5 | pass | `03-verify-fresh.txt`, `03-tables-fresh.txt` |
| 1.2 | The seeded ledger rows (all five are disagreements) carry Agent reading "Agent slip", Reading note "Seeded from the audit of 9 October." and a Read under (for example "2026-10-21.1 · 8560829f") | pass. Rule is empty on the seeded rows, which the spec allows. | `03-tables-fresh.txt` |
| 1.3 | The decided claims' Agent reading holds the seeded line ("Context-dependent: Agent slip · Seeded from the audit of 9 October."); the four open claims' Agent reading is empty | pass | `03-tables-fresh.txt` |
| 1.4 | The Claims columns and the three view filters equal the manifest's `expect`, checked by verify against the structure and live | pass (verify ok, no problems) | `03-verify-fresh.txt` |
| 1.5 | where says step 1 | pass | `04-where-step1.txt` |
| 2.1 | status equals the page's step 1 table and has no "Your decisions" row | pass | `05-status-step1.txt` |
| 2.2 | After the tag step: all four open claims read Waits for you and their Agent reading is still empty; verify is clean; where says step 3, "decide your four claims" | pass | `09-tables-after-tag.txt`, `10-verify-after-tag.txt`, `11-where-step3.txt` |
| 3.1 | After the four decisions, status shows "Your decisions: 3 to read, 1 without a note", Your queue "4 rows decided, waiting for the agent's next run", and a Next line naming distill; where says step 4 | pass | `16-status-after-decide.txt`, `17-where-step4.txt` |
| 4.1 | The press pool and AI Force rows read as a rule problem, with Rule "Context-dependent rule 3", a one-line note and a Read under of the form "<edition> · <8 hex>" | pass. Press pool reads Rule should change ("2026-10-21.1 · f6ebacfb") and AI Force Rule unclear ("· 830960e5"), as in calibration runs 6 to 8. | `20-tables-after-distill1.txt` |
| 4.2 | The USPS row is read by the model and its Reading note opens "without your note · " | pass (read Rule unclear, rule 3) | `20-tables-after-distill1.txt`, `19-distill-first-records.txt` |
| 4.3 | The Georgia row has no reading columns | pass | `20-tables-after-distill1.txt` |
| 4.4 | The claims' Agent reading lines follow decision 68 (USPS with ", without your note"; Georgia "Nothing to read: the agent agreed with you.") | pass | `20-tables-after-distill1.txt` |
| 4.5 | `calls.jsonl` shows exactly one call with purpose reading (3 items) | pass (plus one distill call) | `19-distill-first-records.txt` |
| 4.6 | One rule change, Proposed on Context-dependent rule 3, whose Supporting rows name the press pool and AI Force keys only | **fail**: the Supporting rows also name the USPS key, and the Proposed text adds a USPS clause | `20-tables-after-distill1.txt` |
| 4.7 | Kind is "Change the rule" when any row reads Rule should change | pass | `20-tables-after-distill1.txt` |
| 4.8 | The report has at most five rows and its Next line names Lessons waiting | pass (5 rows) | `19-distill-first.txt` |
| 4.9 | The USPS claim is the only one whose Agent reading contains "without your note" | pass | `20-tables-after-distill1.txt` |
| 5.1 | After the note, status shows "Your decisions: 1 to read" with no "without a note" part, and Next names approve or reject | pass ("1 to read, 2 point at a rule") | `22-status-after-note.txt` |
| 5.2 | The second distill makes no reading call | pass (that run has no `calls.jsonl`) | `23-distill-second-records.txt` |
| 5.3 | The USPS row reads Agent slip, Rule "Context-dependent rule 5", Reading note "Your note says so.", and its Read under changed (5158c072 to 805066ea) | pass | `24-tables-after-distill2.txt` |
| 5.4 | The USPS claim line reads "Context-dependent: Agent slip, rule 5 · Your note says so." | pass | `24-tables-after-distill2.txt` |
| 5.5 | No second rule change | pass | `24-tables-after-distill2.txt` |
| 5.6 | No claim contains "without your note" any more | pass | `24-tables-after-distill2.txt` |
| 6.1 | where says step 5, then step 6 after approve | pass | `25-where-step5.txt`, `27-where-step6.txt` |
| 6.2 | PASS on the draft | pass (examples 10/10, earlier 6/6, "yours 3/3") | `28-promote.txt`, `28-promote-records.txt` |
| 6.3 | The press pool and AI Force rows are Fixed and Done on the new edition | pass | `29-tables-after-promote.txt` |
| 6.4 | USPS and Georgia carry no Follow-up mark and still read Waits for you | **fail** for USPS (Fixed, Done, 2026-10-21.2); pass for Georgia | `29-tables-after-promote.txt`, `28-followup-records.txt` |
| 6.5 | where says complete; status has no "Your decisions" row; verify --json is clean (nine decided, one rule change) | pass | `30-where-after-promote.txt`, `31-status-end.txt`, `32-verify-end.txt` |
| 7.1 | Every report passes `lintReport`, with no hash, path, run id or duration | pass: all 26 `report.md` files of the run and the stdout of every W command. Not reports: start's progress line, verify `--json`, the pull engineer lines. | `34-sweep-reports-plans.txt`, the `*.txt` step files |
| 7.2 | Every plan writes only the agent's columns, apart from the logged editor actions | pass. Editor columns were written only by the setup creates and by the five editor-decide plans and the one editor-approve plan, all logged (12 entries, read_back ok). Distill wrote agent columns only. Promote wrote When to use after the PASS; the record wrote Status Live and Safety check result. | `34-sweep-reports-plans.txt`, `35-demo-json-and-editor-actions.txt` |
| 7.3 | No production script ran | pass. Nothing new in `agents/claim-tagger-mvp/runs/` outside `demos/`; the newest production run, 20261021T181312Z-status, predates the start. Other demos got only local pull records from the two `W list` runs. | `99-commit-end.txt` |
| 7.4 | The commit is unchanged | pass (131d72f at start and end; three files under `docs/mvp-2026-11/report/` were modified by another session) | `00-commit-start.txt`, `99-commit-end.txt` |

## New issues

### 1. Must. The editor's "Agent slip." correction does not reach a rule change already drafted on that row, so the safety check counts the row and the follow-up marks it Fixed.

What happened, in order:

1. The first distill grouped the USPS row (no note, read by the model as Rule unclear, rule 3) with the press pool and AI Force rows.
2. The rule change rests on all three keys. Its Proposed text gained a clause the editor never wrote: "or the only one of its kind that a named owner has (such as an agency's single portal)".
3. The editor then wrote "Agent slip. USPS names which portal, so rule 5 already settles it." The second distill correctly re-read the USPS row as Agent slip, rule 5. But it left the Proposed rule change as it was: "no rule change to draft; the rules the rows point at already have a rule change waiting". The rule change kept the USPS row in its Supporting rows and the USPS clause in its Proposed text (`24-tables-after-distill2.txt`).
4. Promote and the follow-up take the Supporting rows as they were stored when the draft was made (`promote.mjs` around line 316, `supportingKeysOf`; the follow-up does the same). So the safety check reported "Your 3 rows: 3 of 3 now right". The follow-up marked the USPS row Fixed and turned the USPS claim Done on 2026-10-21.2.

This contradicts the specification in four places:

- READ-DECISIONS section 1: "Agent slip rows draft nothing and stay earlier decisions".
- Section 5: the reason word "wins at the next distill".
- Section 4, steps 4, 6 and 7: the Supporting rows name the two keys only, and the follow-up marks neither USPS nor Georgia.
- Decision 76, and the page's step 6 ("yours 2/2", "the USPS claim … is not in the count") and step 7 (USPS "Waits for you | {{edition}}").

The effects on the page:

- **The USPS claim now gives two answers.** Its Agent reading says "Agent slip, rule 5 · Your note says so.", while its Agent reasons say the new rule 3 "counts as identified" a named agency's single portal.
- **The rulebook carries a clause the editor never wanted.** It was drawn from a decision the editor later called the agent's slip.
- **The editor was never warned.** The second distill's Next line pointed at status, and status pointed at approve.

This is not tied to the no-note path. It happens whenever a row that a Proposed or Approved rule change rests on is re-read as Agent slip, for example when an editor adds a reason word to a note the model had read.

How it could be fixed (the product owner decides):

- **(a) Distill.** It compares each Proposed or Approved rule change's Supporting rows with their current readings. When a row no longer reads Rule unclear or Rule should change, distill does one of two things:
  - drafts the rule change again, setting the old one aside without deleting it; or
  - says in its sentence and Next line that the rule change rests on a decision the editor now calls an Agent slip, and should be rejected.
- **(b) Promote and the follow-up.** They use only the Supporting rows whose reading still points at a rule: the `yours`/`earlier` split in `promote.mjs`, and the keys in `followup.mjs`.

Option (a) keeps the Proposed text honest.

### 2. Should. A disagreement without a note joins a draft before the editor is asked for a note.

- **What happened.** The model read the USPS decision, which had no note, as Rule unclear, so it went into the group. Decision 69 allows this, and the unit test "a disagreement without a note is read all the same …" (`tests/mvp/distill.test.mjs` around line 794) pins it.
- **What the editor sees.** The report sends the editor straight to approve a draft partly built on the agent's guess at an unexplained decision:
  - The Next line names Lessons waiting, so Needs your note is never offered (section 5 sends the editor there only "when no lesson was drafted").
  - The only signs are the "Without a note: 1 decision" row of the report and the claim's line.
- **Against the specification.** Its own section 4 check (Supporting rows name the two keys only) assumed this would not happen.
- **The product question.** May a "without your note" reading draft a rule change, or should such rows wait in Needs your note until the editor writes a note? If they may draft, the report should say so, for example "drafted one rule change from 2 notes and 1 decision without a note", and Supporting rows could mark such a row.

### 3. Should. The distill sentence counts rows as notes.

- **What it said.** "drafted one rule change from your 3 notes", when only two of the three rows had a note (`19-distill-first.txt`).
- **Why.** `scripts/distill.mjs` line 614 sets `noteRows = new Set(kept.flatMap((k) => k.keys)).size`, which counts rows. The unit test pins "…from your 2 notes." for two rows that have no note at all.
- **The fix.** Count only the rows that have a note and name the rest ("from your 2 notes and 1 decision without a note"), or say "from 3 of your decisions".

### 4. Nice. The second distill's Next line is "type /claim-tagger demo status to see what is open." while a Proposed rule change waits.

This follows section 1's order: Lessons waiting appears only when that run drafted a lesson. But the editor needs an extra command to reach the approve line. When a rule change is Proposed, the Next line could be status's own: "approve or reject the rule change in Lessons waiting (link)".

### 5. Nice. Between steps 3 and 4, status says "nothing waits for you" next to "Your decisions: 3 to read, 1 without a note".

The decision without a note is something the editor can act on. A sentence such as "nothing is paused; the agent has 3 of your decisions to read" would not contradict the row.

### 6. Nice. The page does not explain a decision without a note, and step 4 does not describe Claude's report.

- **A decision without a note.** `walkthrough/page.md` mentions "without your note" only in Help's Views bullet. Step 3 says of Georgia "An empty note is a decision too: you agree with the agent", which an editor can over-read for a disagreement.
  - One sentence after step 3's reason-word sentence would close the gap, for example: "If you disagree and leave the note empty, the agent still reads your decision, marks its reading 'without your note' and lists the claim in Needs your note; add a note there when its reading is not what you meant."
  - Help's table could get a matching row.
- **The distill report.** Steps 1 and 6 say what Claude's report holds; step 4 does not. It could add one sentence: the report counts what was read, what points at a rule, the agent's slips and the decisions without a note, and its Next line opens Lessons waiting.

### Observations, not findings

- USPS came out Applies at exactly 0.75 and was read once, on the edge of the calibration's "0.75 or more". The story tolerates it.
- `W list` pulls each ready page it shows. Both list runs wrote pull records and refreshed `evals/cases.jsonl` in the three calibration demos' local folders. These are local files only; nothing was written to Notion.
- This run's first Supporting rows line is the AI Force, while page step 4's table shows the press pool. The order follows the order of the decisions: the brief decided the press pool first, while the page's step 3 lists the AI Force first. So the page is right for its own order.
- After the note, status shows "2 point at a rule" (decision 74's pending count) while the rule change is Proposed. This is as the spec says.

## Issues still open from the runs of 21 October (folder 16)

Still open:
- `start` prints "Building the page." directly above the report sentence. Its whole stdout fails the lint ("the sentence runs over more than one line"); its `report.md` is clean.
- `where` does not name its page (run 2, issue 4; in the backlog).
- The promote Next link opens the top of the page, not step 7 (run 1, issue 7).

Fixed since run 3:
- Issue 1: status between steps 3 and 4 now shows "4 rows decided, waiting for the agent's next run" and names distill.
- Issue 2: `guide.md` now covers `where`'s Next lines and the "Walkthrough:" prefix.
- Issue 3: the AI Force criterion was settled by decision 77; this run read Can't tell 0.52.
- Issue 4: troubleshooting now explains "unknown" in `list`.
- Issue 6: step 3 says to paste the words between the quotes, not the quotes.

Not met again:
- Issue 5: this run's lesson title, "A kind is identified only if readers know which one", is a full sentence.

## The page against the build

- **Steps 1, 2, 3 and 5 matched**: the columns, the status words, the order of work, the views and the counts. The figures differed in the way the page says they may (AI Force 0.52, USPS 0.75, Georgia 0.78).
- **Step 4.** On the page's own path, once the USPS note is in (second pass), the claim lines match exactly:
  - press pool and AI Force read Rule should change and Rule unclear on rule 3;
  - USPS reads "Agent slip, rule 5 · Your note says so.";
  - Georgia reads "Nothing to read: the agent agreed with you.";
  - the five earlier decisions carry the seeded "Agent slip … Seeded from the audit of 9 October."

  With the planned no-note detour, three promises did not hold: "Supporting rows lists … the press pool and the AI Force", "The USPS claim drafts nothing", and "Proposed text … adds what the notes on the press pool and the AI Force claim say".
- **Step 6.** "PASS: examples 10/10, earlier 6/6, yours 2/2" became "yours 3/3", with USPS counted among "yours" (issue 1).
- **Step 7.** The USPS row of the table ("Waits for you | {{edition}}") and the sentence "The USPS and Georgia claims were not part of the change, so the follow-up leaves them as they were" did not hold (issue 1). Georgia did.
- **What the run showed that the page does not explain:**
  - what a decision without a note becomes (issue 6), and that such a reading can feed the draft (issue 2);
  - the distill report (issue 6);
  - the "Your decisions" row of status, which the page never asks for after step 1.

## Evidence in this folder

- **Step files.** `NN-<step>.txt` holds the command, exit code, start and end time, HEAD, stdout and stderr; `NN-<step>.out.md` holds the stdout alone, for the lint.
  - Before and step 1: `01` list, `02` start, `03` verify (fresh), `04` where.
  - Step 2: `05` status, `06` to `08` the tag step, `09` pull, `10` verify, `11` where.
  - Step 3: `12` to `15` the four decide calls, `16` status, `17` where, `18` pull.
  - Steps 4 and 5: `19` distill, `20` pull, `21` decide usps, `22` status, `23` distill, `24` pull.
  - Step 6: `25` where, `26` approve, `27` where, `28` promote, `29` pull, `30` where, `31` status, `32` verify.
  - Step 7: `33` list.
- **Tables** (claims, ledger, rule changes and settings of each pull):
  - `03-tables-fresh.txt`
  - `09-tables-after-tag.txt`
  - `18-tables-after-decide.txt`
  - `20-tables-after-distill1.txt`
  - `24-tables-after-distill2.txt`
  - `29-tables-after-promote.txt`
- **Run records:**
  - `07-judge-records.txt`, `08-propose-records.txt`;
  - `19-distill-first-records.txt` and `23-distill-second-records.txt` (calls, readings, report, run.json, plan);
  - `28-promote-records.txt` (card, report, plan), `28-followup-records.txt`, `28-promote-record-plan.txt`;
  - `35-demo-json-and-editor-actions.txt` (demo.json and `editor-actions.jsonl`).
- **Sweep.** `34-sweep-reports-plans.txt`: the lint of every `report.md`, and what each plan wrote.
- **Commit.** `00-commit-start.txt`, `99-commit-end.txt`.
- **Run folder.** `agents/claim-tagger-mvp/runs/demos/20261021-2149-242961/` (ignored by git).

**Overall verdict: 1 must, 2 should, 3 nice.**
- **End to end:** the walkthrough ran through every command of the page, with every exit 0 and a PASS on the draft.
- **What worked as specified:**
  - three readings in one model call;
  - the editor's reason word taken without a call;
  - the agree line on Georgia;
  - the "without your note" flag;
  - rerunning distill costs nothing when nothing changed.
- **What did not:** on the no-note detour, the editor's later "Agent slip." did not reach the rule change, so the USPS claim was counted in the safety check and marked Fixed. Checks 4.6 and 6.4 fail.
