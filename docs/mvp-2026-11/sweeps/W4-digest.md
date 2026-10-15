# W4 walkthrough skill: digest

Source: `X:\work\geo-agents\docs\analysis-2026-10\design\W4-walkthrough-skill.md`, 665 lines, read in full in five chunks (1-150, 151-300, 301-450, 451-600, 601-665). This digest replaces the source for the builder.

How to read it:

- Quoted text, tables and code blocks are copied from the source. Each copied block carries its source line range in square brackets, so it can be checked against the file.
- Source headings appear as bold lines. The digest's own headings carry the section numbers.
- Text outside the copied blocks is the digest's wording. Where it reports a gap, a conflict or a missing phrase, it says so. Conflicts are listed in section 11 and are not resolved.
- The source's codes (Dn, Rn, Cn, W3, P1 to P3, H5, G1, ED-n, answer n, F5, F7) are not expanded. The key is in the preamble.

Contents: 1 The skill; 2 The manifest; 3 The page template; 4 The help pieces; 5 The lint; 6 Evals; 7 Calibration; 8 Output-style override and reporting rules; 9 The builder and the walkthrough script; 10 Skill-creator workflow; 11 Contradictions and gaps.

## Preamble: status and key [source 3-9]

Status: design, not started. Building it waits for Mika's go-ahead for W4 (decision D16: W3 and W4 each need their own) and for W3's stages 0 and 1, which it builds on.

This is P2 section 1 (`P2-walkthrough-reporting-artifact-debate.md`) rewritten to the final schema and the decisions: no Runs database (R8, R12); no Lesson relation on Tag decisions, Rule changes carries Supporting rows as text (R12); the demo claims table is a mirror with P1's column map (R14); the earlier decisions carry Tag outcome and Your reasoning written by the setup plan, the one exception to hard rule 1 (R12); the editor's own "rule n" wins when rows are grouped (R13); no queue cap (D18); the skill always asks for the parent page and test runs take one at run time (D24); the builder runs on Notion API 2026-03-11 behind one real check (R11); the report template overrides the output style (R16, P2 2.1). The code is W3 C20, C21 and C22, with shared pieces in C5, C7, C13 and C14. The editor-facing part of this design is also in `../debate/inputs/walkthrough-plan.md`.

Key to the codes in this file: **Dn** is a decision of the product owner (`../DECISIONS.md`); **Rn** is a ruling in `RECONCILIATION.md` (this folder); **Cn** is a change in `W3-code-changes.md` (for example C20 is the Notion builder); **W3, W4** are that file and this one; **P1, P2, P3** are the three plan reports in this folder (`P2 2.1` is section 2.1 of P2); **H5** is a housekeeping item of W3 (names out of the repo); **G1** is the judge's cache group that holds Context-dependent; **ED-n** is an objection from the editor debate of 14 October and **answer n** is the editor's question n (`../debate/dispositions.md`, `../debate/answers.md`); **F5** and **F7** are Mika's feedback items on the report (`../FEEDBACK.md`). The codes belong to this design file. The walkthrough page itself has none.

Editor debate, round 1, applied in this file: the practice page uses the production page's four view names, Your queue, Needs your note, Lessons waiting and Rulebook (ED-4); the two columns are named in words, Safety check result and Rulebook edition (ED-8); the mirror's Agent notes is at most two short lines per claim (ED-9); follow-up runs by itself at the end of a passed safety check, so step 7 has nothing to type (ED-10); the page opens with who types the commands (ED-2) and regains four short help pieces (ED-7); the report after a failed safety check proposes one sentence for Editor wording, and Lessons waiting shows Current text and Proposed text side by side (answers 4 and 5); the stage that holds the walkthrough contains nothing else for the editor, and it comes before the first real rows are decided (ED-6, ED-11); three plain lines say what the full version adds later (ED-12); no time estimates anywhere (F7).

## 1. The skill

### 1.1 Choices in brief [source 11-20]

**1. Choices in brief**

- A separate skill, `claim-tagger-walkthrough`, creates a fresh demo page and says where the editor is. The loop steps themselves run as `/claim-tagger demo <subcommand>`, so the editor learns the real commands, minus the word "demo".
- The skill always asks under which Notion page the demo goes (D24). There is no default parent; test runs pass the parent in the prompt.
- Structure (page, databases, views, page content) comes from the shared builder pinned to API 2026-03-11 (views exist since March 2026), gated by one real check; rows go through plan and apply on 2022-06-28, as in production. No connector writes, and no SETUP marker made by hand.
- One tag (Context-dependent, D8), 7 real claims, 7 queue rows (2 open, 5 decided earlier), 5 tables, 7 steps.
- The editor types every command of the page; the engineer sets things up and fixes what breaks (ED-2). The page says so in its first line.
- The same four view names as the production page (ED-4): Your queue and Lessons waiting are the linked views in steps 3 and 5; Needs your note and Rulebook are the views of the Tag decisions and Rulebook tables. Lessons waiting shows Lesson, Current text, Proposed text and Status with wrapping on (answer 5).
- The page comes from a template that a lint validates: the four sub-headings of every step, at most 4 columns per table, cell length, banned phrases and time estimates, no shorthand codes, the four help pieces, every affected table shown. The same check grades the evals.
- Reports have three parts only, with the output-style override of P2 2.1 (section 11).

### 1.2 Folder layout and pieces [source 22-34]

Layout of the skill folder, as the source gives it (the reference files are named at line 64, `report-examples.md` at line 608, the workspace at lines 107 and 612):

```text
.claude/skills/claim-tagger-walkthrough/
    SKILL.md
    references/manifest.md           format; how to change claims; the calibration a manifest change must pass (line 64)
    references/page-design.md        template syntax; fixed step format; table limits; banned phrases; what verify checks (line 64)
    references/troubleshooting.md    resume; usage-window stop; run stopped before step 7; FAIL at step 6 (line 64)
    references/report-examples.md    named for both skills (line 608); not in the reference list at line 64 (see G14)
    evals/evals.json                 section 6 of this digest
.claude/skills/claim-tagger-walkthrough-workspace/   skill-creator workspace, git-ignored (lines 107, 612)
```

The pieces table and the reason for a separate skill, verbatim:

**2. Pieces and where they live**

| Piece | Where | Job |
|---|---|---|
| Skill `claim-tagger-walkthrough` | `.claude/skills/claim-tagger-walkthrough/` (`SKILL.md`, `references/`, `evals/evals.json`) | `start`: ask for the parent page, then create a fresh demo page under it. `where`: which step, and the one next action |
| Demo mode of the main skill | `.claude/skills/claim-tagger/SKILL.md`, section "Demo mode" (replaces "Sandbox mode") | `/claim-tagger demo status`, `tag`, `distill`, `promote`, `follow-up` against the newest demo |
| Script | `agents/claim-tagger/scripts/walkthrough.mjs` | `start`, `run`, `where`, `verify`, `list` |
| Builder | `scripts/lib/notion-build.mjs`, `scripts/lib/notion-blocks.mjs`, the 2026-03-11 methods in `scripts/lib/notion-rest.mjs` | Shared with production setup (W3 C7, C20) |
| Schema | `agents/claim-tagger/schemas/notion/setup.json` | One definition for production and demo (R12) |
| Data | `agents/claim-tagger/walkthrough/manifest.json`, `page.md` | The seed manifest and the page template |
| Demo profiles | `agents/claim-tagger/demos/<id>/` (git-ignored) | One `CLAIM_TAGGER_ROOT` per demo |

Why a separate skill rather than a `walkthrough` subcommand (P2): its own "pushy" description for onboarding, demo and practice phrasings; evals per skill; isolation (it creates pages only under `demos/` and never reads or writes the production profile). The loop steps stay in the main skill under the word `demo`, so the page teaches the commands the editor will use for real.

### 1.3 SKILL.md: frontmatter, description and body [source 38-64]

The description is the frontmatter `description` value at lines 45-52, inside the block below. The body is seven numbered items (lines 58-64): output style, what it does and never does, start a demo, where am I, running the steps, reporting, references.

**3.1 SKILL.md**

Frontmatter (P2, unchanged; D24 is already in "a page the editor picks"):

```yaml
---
name: claim-tagger-walkthrough
description: >-
  Set up a fresh practice copy of the claim tagger's editor feedback loop in Notion and guide an editor through it:
  one command creates a new page under a page the editor picks, with its own one-tag rulebook (Context-dependent),
  seven real claims, a small decision queue, a rule-changes table and seven numbered steps, then says where the editor
  is and what to type next. Use this skill whenever someone wants to try, learn, practise, demo or teach the claim
  tagger or the editorial feedback loop, onboard a new editor, make a training or practice page, or asks "where am I
  in the walkthrough/demo", even if they never say "walkthrough". It never touches real claims or the real rulebook;
  for real tagging, distilling or promoting use /claim-tagger.
---
```

Body (under 120 lines). `W` = `node agents/claim-tagger/scripts/walkthrough.mjs`.

1. Output style: the paragraph of section 11, word for word, as the first paragraph.
2. What it does and never does. All Notion writes come from `W`. The skill never writes Notion through the connector, never deletes or archives a page, never fills an editor field (the earlier decisions on a new demo are written by the script's setup plan, not by the skill), and never reads or writes the production profile.
3. Start a demo. If the request contains a Notion link, use it. Otherwise ask exactly once: "Under which Notion page should the demo go? Paste a link." There is no default page (D24): do not guess one, and do not reuse the last demo's parent unless the editor says so. Then run `W start --parent <link>` (a short wait). `W start --parent <link> --dry-run` gives a preview and writes nothing. Exit codes: 2, the parent cannot be reached (say: "In Notion, open that page, choose ⋯ → Connections and add the claim tagger connection, or pick another page"); 4, the parent is protected (a protected database or one of its rows, the production page's databases, or a mirror); 1, run `W start --resume <id>` once. Never start a second demo to retry.
4. Where am I. Run `W where` and relay its sentence and its "Next:" line.
5. Running the steps. They are `/claim-tagger demo <subcommand>`; run them exactly as the claim-tagger SKILL.md section "Demo mode" says. Steps 3 and 5 happen in Notion: never do them for the editor; link the view instead (Your queue for step 3, Lessons waiting for step 5). Step 7 needs no command: follow-up runs by itself at the end of a passed safety check, and the promote PASS report's Next line points at step 7 (`/claim-tagger demo follow-up` only repeats it after a run that stopped early; `where` says when).
6. Reporting: the three-part template of section 11, with the `start` example.
7. References, read only when needed: `references/manifest.md` (the format, how to change claims, the calibration a manifest change must pass); `references/page-design.md` (the template syntax, the fixed step format, table limits, banned phrases, what `W verify` checks); `references/troubleshooting.md` (resume; a usage-window stop; a run stopped before step 7, which `/claim-tagger demo follow-up` finishes; FAIL at step 6).

### 1.4 Trigger phrasings the skill must cover

- From the description (lines 46-52): try, learn, practise, demo or teach the claim tagger or the editorial feedback loop; onboard a new editor; make a training or practice page; ask "where am I in the walkthrough/demo"; "even if they never say 'walkthrough'".
- Its boundary (lines 51-52): it never touches real claims or the real rulebook; for real tagging, distilling or promoting, the request goes to `/claim-tagger`.
- The full test set is in section 10.2 (lines 626-649): ten queries that must trigger and ten that must not. Example that must trigger (row 6): "create a training copy of the claim tagging workflow in Notion under this page: <link>". Example that must not (row 11): "tag this week's claims".

### 1.5 How it asks for the parent page link [source 14, 60, 623]

- If the request already contains a Notion link, the skill uses it. Otherwise it asks exactly once, with this question: "Under which Notion page should the demo go? Paste a link." (line 60, quoted in the block at 1.3.)
- There is no default parent (D24). The skill does not guess one and does not reuse the last demo's parent unless the editor says so. Test runs pass the parent in the prompt (line 14).
- Then it runs `W start --parent <link>` (a short wait). `W start --parent <link> --dry-run` gives a preview and writes nothing (line 60). Section 9.6 shows what a dry run writes; the two statements do not agree (C2).
- Failures (line 60): exit 2, the parent cannot be reached (the message to relay is in the block at 1.3); exit 4, the parent is protected; exit 1, run `W start --resume <id>` once. Never start a second demo to retry.
- Check by hand once (line 623): "set me up a practice page for the claim tagger" without a link gets exactly one question asking for the link, and nothing runs.

### 1.6 What it creates in Notion [source 13, 15-16, 267, 279, 281, 511, 515-519]

- One new page under the parent. The source gives no title for the page. The page holds, in order: the callout, the story, Steps 1 to 7, the tables section (a six-line list, then five inline databases) and a Help toggle at the bottom (sections 3 and 4 of this digest).
- Five inline databases, titled Rulebook, Claims, Tag decisions, Rule changes and Agent settings (line 515). At creation: Rulebook 1 row (Context-dependent, Status Verified); Claims 7 rows (Agent tags and Agent notes empty); Tag decisions 7 rows (the 5 earlier decisions carry Tag outcome, the 2 open rows do not, and no row has Why wrong or an Agent proposal); Rule changes empty; Agent settings 1 row (Paused unticked) (lines 516-519).
- Four views (lines 281 and 511): Rulebook, a view of the Rulebook table that hides Counterpart; Your queue, a linked view placed in step 3; Lessons waiting, a linked view placed in step 5 with wrapping on; Needs your note, a second view of Tag decisions at the bottom. Exactly two views are linked.
- Default views of the five tables (line 279, section 3.3 below). Column meanings live only in the Notion column descriptions (line 267).

### 1.7 What it tells the editor at the end [source 61, 83, 547]

- The `where` command prints one sentence and one "Next:" line, and the skill relays both (line 61; the mapping is in 9.3).
- The start sequence ends with "Run `verify` and print the three-part report." (line 83). The source gives no text and no Next line for the start report. The eval 1 expectation is: "the final reply is one sentence, a table of at most 5 rows and 3 columns, and a line starting Next: with the new page's link" (line 547).
- The page's callout tells the editor which four commands to type and that the follow-up runs by itself (section 3.1).

## 2. The manifest (`agents/claim-tagger/walkthrough/manifest.json`)

The manifest replaces `sandbox/walkthrough.json` and is frozen once calibrated (line 163).

### 2.1 Format [source 165-197]

**6.1 Format**

```json
{
  "manifest_version": "2026-10-15.1",
  "calibration": { "status": "pending", "runs": [] },
  "tag": { "Name": "Context-dependent", "Description": "...", "When to use": { "preamble": "", "rules": ["...", "...", "...", "Test: could a reader ...", "Do not use for ..."], "note": "" },
           "Example Claims": ["..."], "Counterpart": "Self-contained", "Category": "Quality", "Polarity": "Issue", "Status": "Verified",
           "Work tags": ["Issue"], "Geo Status": "To be created", "Geo Tag ID": "", "Evidence": "https://app.notion.com/3cf273e214eb81f2a815e7a751512a07",
           "Verified on": "2026-09-10", "copied_from": "Claim Tags — verified row 765273e214eb83458bd7819ebe81bd9e, 2026-10-14" },
  "canaries": [ { "claim": "...", "expected": "apply" } ],
  "claims": [ { "key": "covid", "short": "The focus on the COVID-19 vaccine ignored the larger public...",
                "Geo Name": "...", "Geo ID": "78dd775028795b65bb5c4945eda1c3bb", "Geo URL": "https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/78dd775028795b65bb5c4945eda1c3bb",
                "Geo Sources": "[...](https://www.geobrowser.io/space/...)", "Geo Is factual": "<copied from the mirror row>" } ],
  "decided": [ { "claim": "melania", "Tag outcome": "Applies", "Your reasoning": "...", "source": "audit 9 Oct, editor" } ],
  "open": [ { "claim": "covid", "enter": { "Tag outcome": "Does not apply", "Why wrong": "Rule unclear", "Your reasoning": "Rule 4 is too strict: ..." },
              "calibrate": { "agent": "apply", "min_share": 0.67, "min_p": 0.75, "cites_rule": 4 } } ],
  "alternates": [ { "key": "fairford-credibility", "geo_id": "692b48b7467b0220aed4d2a44002cfcf", "text": "...", "replaces": "georgia" } ],
  "views": { "Your queue": 3, "Lessons waiting": 5 },
  "expect": { "tables": ["Rulebook", "Claims", "Tag decisions", "Rule changes", "Agent settings"], "rulebook_rows": 1, "claims": 7,
              "queue_rows": 7, "open_rows": 2, "decided_rows": 5, "linked_views": 2, "lesson_rule": "Context-dependent rule 4", "gate": "PASS" },
  "steps": [
    { "n": 1, "title": "Meet the demo", "command": "/claim-tagger demo status", "affects": [] },
    { "n": 2, "title": "The agent reads the claims", "command": "/claim-tagger demo tag", "affects": ["Tag decisions", "Claims"] },
    { "n": 3, "title": "Decide your two rows", "command": null, "affects": ["Tag decisions"] },
    { "n": 4, "title": "The agent drafts a clearer rule 4", "command": "/claim-tagger demo distill", "affects": ["Rule changes"] },
    { "n": 5, "title": "Approve the draft", "command": null, "affects": ["Rule changes"] },
    { "n": 6, "title": "The safety check", "command": "/claim-tagger demo promote", "affects": ["Rulebook", "Rule changes", "Agent settings"] },
    { "n": 7, "title": "The agent re-checks your rows", "command": null, "affects": ["Tag decisions", "Claims"] }
  ],
  "quiet_columns": ["Agent settings.Last run summary"]
}
```

### 2.2 Changes against P2's format [source 199]

Changes against P2's format: `claims` uses the mirror column names (R14); `decided` and `open` use the Tag decisions column names, and the decided rows' Tag outcome and Your reasoning are written by the setup plan (R12); `expect.tables` has no Runs; no step affects Runs, and step 4 does not affect Tag decisions (no Lesson relation, R12); Agent settings appears only in step 6 (R12), and its Last run summary, which every command rewrites, is a "quiet" column the lint does not require elsewhere; step 7 has no command, because promote runs follow-up as its last step (W3 C14, C15); `calibrate.cites_rule` is new (section 6.5); `views` carries production's view names, Your queue for step 3 and Lessons waiting for step 5 (ED-4).

### 2.3 Default content: every row [source 201-215]

Every row is a real U.S. Politics claim from the trial's seed. Sources are copied from the mirror rows when the manifest is built (the trial's `sources-fill.json` holds the links the export lacked). The last column shows the trial's cached judgments (all tags in one prompt, 3 runs each).

| Key | Claim (short) | Role | Tag outcome and Your reasoning (entered at setup) | Trial judge on Context-dependent |
|---|---|---|---|---|
| covid `78dd7750...` | The focus on the COVID-19 vaccine ignored the larger public health problem... | open | none (in the audit the editor disagreed with "add": "could just be a generic...") | apply 3/3, p 0.72 to 0.85 (rule 2) |
| georgia `8f9c833b...` | Georgia's gubernatorial debate should be moderated by professional journalists... | open | none (in the audit: "the claim reads well") | do_not_apply or ask_editor, p 0.4 to 0.6 (weak) |
| melania `e3c28f62...` | Melania Trump should not host her initiative's G20 event... | decided | Applies: "...It leaves the reader thinking, 'What's the initiative?'" | apply 8/8, p 0.55 to 0.75 (fragile) |
| cnn `fc0cb0da...` | Excluding CNN from Air Force One violates the federal court order | decided | Applies (no reasoning) | apply 3/3, p 0.85 to 0.9 |
| contractor `6dc1222a...` | A contractor's enforcement of safety restrictions constitutes... | decided | Does not apply: "The claim makes sense on its own..." | do_not_apply, p 0.8 to 0.85 |
| kennedy `89fcfb7f...` | Relocating the Kennedy Center Honors to a sports arena... | decided | Does not apply (no reasoning) | do_not_apply, p 0.85 to 0.88 |
| stopgap `3e0d601d...` | December stopgap funding rewards Congress for avoiding a full budget | decided | Does not apply: "...the claim makes sense to me from reading it." | do_not_apply, p 0.6 to 0.65 (safe direction) |

The reasoning texts are the audit's, anonymised (W3 H5). Georgia's weak trial result is why it has alternates (section 6.4) and why the calibration must pass before the manifest ships.

### 2.4 The Context-dependent story rows: decision, Why wrong and reasoning

Open rows (the editor decides them at step 3): covid and georgia. Decided earlier (written at setup): melania, cnn, contractor, kennedy and stopgap. Why wrong is empty on all five decided rows (line 518). The agent proposes Applies on both open rows (step 2, lines 335-336).

| Key | Claim (as shortened in the source) | Role | Decision | Why wrong | Reasoning |
|---|---|---|---|---|---|
| covid | The focus on the COVID-19 vaccine ignored the larger public health problem... | open | Does not apply (the editor's entry at step 3) | Rule unclear | "Rule 4 is too strict: "the larger public health problem" is general; the claim reads fine." (line 366) |
| georgia | Georgia's gubernatorial debate should be moderated by professional journalists... | open | Does not apply (the editor's entry at step 3) | Rule unclear | "Rule 4 is too strict: the claim reads well without a date or names for the debate." (line 367) |
| melania | Melania Trump should not host her initiative's G20 event... | decided | Applies | none | "...It leaves the reader thinking, 'What's the initiative?'" (line 209; cut short in the source) |
| cnn | Excluding CNN from Air Force One violates the federal court order | decided | Applies | none | none (no reasoning) |
| contractor | A contractor's enforcement of safety restrictions constitutes... | decided | Does not apply | none | "The claim makes sense on its own..." (line 211; cut short) |
| kennedy | Relocating the Kennedy Center Honors to a sports arena... | decided | Does not apply | none | none (no reasoning) |
| stopgap | December stopgap funding rewards Congress for avoiding a full budget | decided | Does not apply | none | "...the claim makes sense to me from reading it." (line 213; cut short) |

The story rows and the reasoning, verbatim:

Rule 4 of Context-dependent asks: could a reader who sees only this sentence say which specific thing each "the ..." points at? If not, the claim gets the tag. Editors read more loosely: a claim that reads well on its own does not need the tag, even when it says "the larger public health problem".

| Claim | Rule 4's test | The editor |
|---|---|---|
| The focus on the COVID-19 vaccine ignored the larger... | Tag: which problem? | No tag: a general remark |
| Georgia's gubernatorial debate should be moderated... | Tag: which debate? | No tag: reads well |
| Melania Trump should not host her initiative's G20... | Tag: which initiative? | Tag: "What's the initiative?" |

The first two wait for you: you decide them, the agent drafts a clearer rule 4, you approve it, and a safety check makes sure the earlier decisions still come out right before the new rule is used.

These two were picked for the demo; for real, a row appears only when the agent is unsure.

### 2.5 Demo claims table, with Geo IDs and the other demo rows [source 219-233]

Geo IDs of the open rows: covid `78dd775028795b65bb5c4945eda1c3bb`, georgia `8f9c833b41e54eee9ca78e9c2f4ffb58`. Decided rows: melania `e3c28f62526e4880b9edb5c16817b27b`, cnn `fc0cb0da0a1a4375b0fae6b5c9a67c69`, contractor `6dc1222aeb364918821167370d8fbc40`, kennedy `89fcfb7fc6684b63af7d829ed90106cd`, stopgap `3e0d601de961dbf8ae38154e3f3a02e5`. The Geo sources of the seven claims are 1, 1, 2, 4, 4, 7 and 0 (stopgap has 0, see G11).

The demo's Claims table copies the mirror column map of W3's config, so a demo is structurally a mirror (R14). Geo URL is `https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/<Geo ID>` for all seven. Geo Sources is copied as text with its links (the source count is the number of links, since U.S. Politics has no count column). Geo Is factual is copied from the mirror row; its type is confirmed by the dry run (W3 C19).

| Geo Name (short) | Geo ID | Geo Sources (links) | Geo Is factual | Agent tags | Agent notes |
|---|---|---|---|---|---|
| The focus on the COVID-19 vaccine ignored the larger public... | 78dd775028795b65bb5c4945eda1c3bb | 1 | copied | empty | empty |
| Georgia's gubernatorial debate should be moderated by... | 8f9c833b41e54eee9ca78e9c2f4ffb58 | 1 | copied | empty | empty |
| Melania Trump should not host her initiative's G20 event... | e3c28f62526e4880b9edb5c16817b27b | 2 | copied | empty | empty |
| Excluding CNN from Air Force One violates the federal court... | fc0cb0da0a1a4375b0fae6b5c9a67c69 | 4 | copied | empty | empty |
| A contractor's enforcement of safety restrictions... | 6dc1222aeb364918821167370d8fbc40 | 4 | copied | empty | empty |
| Relocating the Kennedy Center Honors to a sports arena... | 89fcfb7fc6684b63af7d829ed90106cd | 7 | copied | empty | empty |
| December stopgap funding rewards Congress for avoiding a... | 3e0d601de961dbf8ae38154e3f3a02e5 | 0 | copied | empty | empty |

Tag decisions has one row per claim for Context-dependent, with the production columns (Claim, Key, Tag, Agent proposal, Agent confidence, Agent reason, Claim link, Rulebook edition, Tag outcome, Why wrong, Your reasoning, Follow-up). Rule changes has production's columns without Lesson ID (R15), including Safety check result. Agent settings has its one row: Name claim-tagger, Paused unticked, Rulebook edition the demo's first edition (`<date>.1`), Last run summary empty.

Because every claim already has a Tag decisions row for the one tag, propose cannot create new rows in a demo; propose fills the open rows and never touches the decided ones. For the same reason the two open rows wait although the agent is fairly sure of them: they were picked for the demo, and the page says so under the story (ED-7). There is no cap in any case (D18).

### 2.6 Canaries, left out and alternates [source 237-239]

- Canaries: the 11 trial canaries of this tag: the 6 example claims of the rulebook row (expected apply) and 5 claims from the Self-contained examples (expected do_not_apply). All came out right 3 of 3, mostly at p 0.9 or above. They are the rulebook's own examples, not held out (P3 #8); the page calls them "example claims".
- Left out on purpose: the Dallas convention claim (2 of 3 apply at p 0.6 and the closest twin of Georgia; a rule change that frees Georgia would likely flip it, so the gate would FAIL); the Boulder claim (the judge already gets it wrong).
- Alternates, if Georgia fails the calibration: the Fairford withdrawal claims (`692b48b7...`, `9e8c7142...`) and "The USPS ballot portal should not launch before the 2026 midterms" (`27ad00b5...`). In the audit these are predicted "do not add" on the strength of the Georgia ruling. In that case Georgia moves into the earlier decisions as "Does not apply, the claim reads well".

Digest notes on this part:

- Canaries: the 11 are not listed in this file (G1). The source gives the counts only: 6 example claims of the rulebook row expected to apply, and 5 claims from the Self-contained examples expected to be do_not_apply. The manifest's `canaries` array is a one-entry placeholder (line 175).
- Alternates: the manifest format shows one entry (line 182): key `fairford-credibility`, geo_id `692b48b7467b0220aed4d2a44002cfcf`, text "...", replaces `georgia`. Line 239 names three candidates; two of their IDs are truncated in the source (`9e8c7142...`, `27ad00b5...`). No alternate is named for Melania (C10).

### 2.7 The wording "from the audit"

The exact phrase "from the audit" does not occur in the file (G5). The audit wording that does occur:

- `"source": "audit 9 Oct, editor"` (line 179, the manifest's decided row).
- "in the audit the editor disagreed with "add"" (line 207, the covid row of 2.3).
- "in the audit: "the claim reads well"" (line 208, the georgia row of 2.3).
- "The reasoning texts are the audit's, anonymised (W3 H5)." (line 215).
- "In the audit these are predicted "do not add" on the strength of the Georgia ruling." (line 239).

The audit writes "add" and "do not add"; the page writes "Applies" and "Does not apply" (lines 335, 358). The `copied_from` field (line 174) names a verified row dated 2026-10-14, not the audit.

## 3. The page template (`agents/claim-tagger/walkthrough/page.md`)

Page text is for the editor: no shorthand codes and no time estimates. Design notes, the layout list and the view descriptions are for builders and may carry codes (line 258). The verbatim blocks keep the source's own words.

### 3.1 Convention, layout and the callout [source 258, 262-268]

Convention. Page text is written for the editor and has no shorthand codes and no time estimates: the quoted callout, the story, the step bullets and tables, the six-line list and the help (7.5). Lines marked "Design note", the layout list and the view descriptions are for the builders and may carry codes.

Top to bottom:

1. A callout. Its first line is: "You type four commands yourself (status, tag, distill and promote); the follow-up runs by itself after a PASS, and the engineer sets things up and fixes what breaks." (ED-2, ED-15). Then: "A practice copy of the editor feedback loop: its own rulebook (one tag), 7 real claims, its own queue. Nothing here changes the real tables or Geo. Do the steps in order; you can stop after any step and come back. Commands go into Claude Code, opened in the geo-agents folder."
2. The story (7.2): two sentences, a three-row table, one sentence, and one line saying why the two rows wait (ED-7).
3. Steps 1 to 7 (7.4).
4. The tables: a six-line list, then the five inline databases with default views of 5 columns or fewer, wrap off. Column meanings live in the Notion column descriptions only.
5. Help, in one toggle at the bottom (7.5): the Why wrong table (four lines), a words list (ten lines) and the "paused / usage limit" help (two lines) (ED-7).

Digest notes: the callout is item 1 of the layout. Its first line is the sentence the lint checks (line 508). The Help toggle is item 5, at the bottom.

### 3.2 Steps at a glance (digest summary of lines 310-431 and manifest lines 187-193)

| Step | Heading on the page | Command the editor types | Tables it affects | Linked view placed here |
|---|---|---|---|---|
| 1 | Step 1 · Meet the demo | `/claim-tagger demo status` | none | none |
| 2 | Step 2 · The agent reads the claims | `/claim-tagger demo tag` | Tag decisions, Claims | none |
| 3 | Step 3 · Decide your two rows (you, as the editor) | none; the editor edits in Notion | Tag decisions | Your queue |
| 4 | Step 4 · The agent drafts a clearer rule 4 | `/claim-tagger demo distill` | Rule changes | none |
| 5 | Step 5 · Approve the draft (you, as the rule owner) | none; the editor edits in Notion | Rule changes | Lessons waiting |
| 6 | Step 6 · The safety check | `/claim-tagger demo promote` | Rulebook, Rule changes, Agent settings | none |
| 7 | Step 7 · The agent re-checks your rows | none; follow-up runs by itself | Tag decisions, Claims | none |

### 3.3 The six-line list and default views [source 270-279]

The six-line list:

- **Rulebook**: one row per tag (here one). The agent changes When to use only after a passed safety check.
- **Claims**: one row per claim, shaped like the real claims table. The agent writes only Agent tags and Agent notes.
- **Tag decisions**: one row per claim and tag that a person decides. You type in Tag outcome, Why wrong and Your reasoning; the agent fills the rest. Needs your note lists the rows where you chose a reason but left Your reasoning empty.
- **Rule changes**: one row per proposed rule change. You set Status and may write Editor wording.
- **Agent settings**: one row. Tick Paused to stop the agent; Last run summary always describes the latest command.
- Hover over a column name to see what it means.

Default views: Rulebook (Name, Status, When to use, Example Claims; Counterpart is hidden in this view and stays in the table, ED-8); Claims (Geo Name, Agent tags, Agent notes); Tag decisions (Claim, Agent proposal, Tag outcome, Why wrong, Follow-up); Rule changes (Lesson, Rule, Status, Safety check result); Agent settings (Name, Paused, Rulebook edition, Last run summary).

### 3.4 The four view names [source 281]

The four view names are production's, defined once in `setup.json` (W3 C20; ED-4): Rulebook (the Rulebook table's view above); Your queue (linked inside step 3: Tag decisions where Tag outcome is empty, lowest Agent confidence first, showing Claim, Tag outcome, Why wrong, Your reasoning); Lessons waiting (linked inside step 5: Rule changes where Status is Proposed or Approved, showing Lesson, Current text, Proposed text and Status, with wrapping on so both texts are read in place, answer 5); Needs your note (a second view of Tag decisions at the bottom: Why wrong is Rule unclear or Rule should change, and Your reasoning is empty). Lessons waiting is the one view with wrapping on.

Digest notes: these are production's names, defined once in `setup.json` (line 281). Only these four view names may appear on the page (line 511). The retired demo view names are not in this file (G7).

### 3.5 Rules for every step [source 297-306]

- The four sub-headings, always in this order: Goal of the step, Existing status, Doing the work, Explaining the outputs.
- "Explaining the outputs" shows one small table per affected Notion table: at most 4 columns, a bold caption naming the table, example values, claims shortened to about 60 characters, cells of at most 100 characters.
- "Existing status" is 1 to 3 lines and refers to the previous step's outputs instead of repeating them.
- Tables are the five of section 7.1: no Runs table (R8); Agent settings appears only in step 6, where Rulebook edition changes (R12); Last run summary, rewritten by every command, is shown there only.
- Steps 3 and 5 hold the two linked views, Your queue and Lessons waiting, placed right under "Doing the work".
- The page text uses the editor's words: rulebook, edition, safety check, earlier decision, example claim. It never says gate, rubric, canary or regression, has no shorthand code (D7, R12, C20, ED-4 and the like) and no time estimate; a step that waits says "a short wait" (F5, F7).

What this removes from today's page: the "leave these undecided" rows (one tag, every claim already has a row, and no cap, D18); "most likely" and "values may differ"; the column guides; the pasted "tested wording"; "note WT-1 for step 6"; the Runs tables and the Lesson links; mixed-table result grids.

### 3.6 The seven steps, verbatim [source 310-462]

**Step 1 · Meet the demo** (affects: none)

- **Goal of the step.** Check that the demo is ready and see what waits for whom.
- **Existing status.** Rulebook: 1 tag, Context-dependent, edition 2026-10-15.1 (an edition is a date plus a count; it goes up when a rule changes). Claims: 7 rows, Agent tags empty. Tag decisions: 7 rows; 5 decided earlier by an editor, 2 waiting for you. Rule changes: empty. Agent settings: not paused.
- **Doing the work.** In Claude Code, type `/claim-tagger demo status`.
- **Explaining the outputs.** No table changes. Claude replies with one sentence, this table and a "Next:" line:

| What | Now |
|---|---|
| Rulebook | edition 2026-10-15.1, 1 tag |
| Waiting for you | 2 rows in Your queue |
| Rule changes | none |
| Paused | no |

**Step 2 · The agent reads the claims** (affects: Tag decisions, Claims)

- **Goal of the step.** The agent reads the 7 claims against the rulebook and fills its side of your 2 rows.
- **Existing status.** Your 2 rows have no Agent proposal yet; Agent tags is empty on all 7 claims (step 1).
- **Doing the work.** Type `/claim-tagger demo tag`. It is a short wait; Notion changes only at the end.
- **Explaining the outputs.**

**Tag decisions** (your 2 rows; the 5 earlier rows are not touched)

| Claim | Agent proposal | Agent confidence | Agent reason |
|---|---|---|---|
| The focus on the COVID-19 vaccine ignored the larger public... | Applies | 0.85 | "the larger public health problem": which one? (rule 4) |
| Georgia's gubernatorial debate should be moderated by... | Applies | 0.80 | "Georgia's gubernatorial debate": which debate? (rule 4) |

Both rows also record the rulebook edition they used (Rulebook edition 2026-10-15.1). They wait for you although the agent is fairly sure: they were picked for the demo.

**Claims** (Agent notes is two short lines per claim; the table shows the line break as a slash)

| Geo Name | Agent tags | Agent notes |
|---|---|---|
| The focus on the COVID-19 vaccine ignored the larger public... | (empty) | no tags / 1 waits for an editor · edition 2026-10-15.1 |
| Georgia's gubernatorial debate should be moderated by... | (empty) | no tags / 1 waits for an editor · edition 2026-10-15.1 |
| Melania Trump should not host her initiative's G20 event... | Context-dependent | Context-dependent / nothing waits for an editor · edition 2026-10-15.1 |
| Excluding CNN from Air Force One violates the federal court... | Context-dependent | Context-dependent / nothing waits for an editor · edition 2026-10-15.1 |
| A contractor's enforcement of safety restrictions... | (empty) | no tags / nothing waits for an editor · edition 2026-10-15.1 |
| Relocating the Kennedy Center Honors to a sports arena... | (empty) | no tags / nothing waits for an editor · edition 2026-10-15.1 |
| December stopgap funding rewards Congress for avoiding a... | (empty) | no tags / nothing waits for an editor · edition 2026-10-15.1 |

The agent agrees with all 5 earlier decisions. On your 2 rows it follows rule 4, but a tag that waits for you is not written to Agent tags yet; it is counted in Agent notes and sits in Your queue. Confidence, rule and reason are in the Tag decisions rows above, not in Agent notes.

**Step 3 · Decide your two rows (you, as the editor)** (affects: Tag decisions)

- **Goal of the step.** Record your decision on both rows, and say that rule 4, not the agent, is the problem.
- **Existing status.** Both rows show Applies, citing rule 4 (step 2).
- **Doing the work.** In Your queue, just below, fill in three columns on each row. Tag outcome: Does not apply. Why wrong: Rule unclear. Your reasoning, on the COVID-19 row: "Rule 4 is too strict: 'the larger public health problem' is general; the claim reads fine." On the Georgia row: "Rule 4 is too strict: the claim reads well without a date or names for the debate." What each Why wrong value makes happen is explained in Help at the bottom of the page.
  Design note: the linked view "Your queue" is production's own view, defined once in `setup.json`: Tag decisions; filter Tag outcome is empty; sorted by Agent confidence, lowest first; shows Claim, Tag outcome, Why wrong, Your reasoning. The step therefore teaches the view the editor clicks for real (ED-4). (P2 filtered on an "Earlier decision" column, which the final schema does not have, R12.)
- **Explaining the outputs.**

**Tag decisions** (your 2 rows)

| Claim | Tag outcome | Why wrong | Your reasoning |
|---|---|---|---|
| The focus on the COVID-19 vaccine ignored the larger public... | Does not apply | Rule unclear | Rule 4 is too strict: "the larger public health problem" is general; the claim reads fine. |
| Georgia's gubernatorial debate should be moderated by... | Does not apply | Rule unclear | Rule 4 is too strict: the claim reads well without a date or names for the debate. |

The agent is not involved and no other table changes. Both rows leave Your queue when the page reloads; they stay in Tag decisions at the bottom.

**Step 4 · The agent drafts a clearer rule 4** (affects: Rule changes)

- **Goal of the step.** Turn your two notes into one proposed rewording of rule 4.
- **Existing status.** Rule changes is empty; your 2 rows carry Rule unclear and a sentence that names rule 4 (step 3).
- **Doing the work.** Type `/claim-tagger demo distill`. It is a short wait.
- **Explaining the outputs.**

**Rule changes**

| Lesson | Rule | Status | Supporting rows |
|---|---|---|---|
| General references pass the rule 4 test | Context-dependent rule 4 | Proposed | The focus on the COVID-19 vaccine...; Georgia's gubernatorial debate... |

Current text holds today's rule 4. Proposed text keeps it and adds one sentence, for example: "A general reference that any reader understands, such as 'the larger public health problem', passes the test." Supporting rows lists the two rows the draft rests on.

The Rulebook does not change: a draft changes nothing until you approve it and it passes the safety check.

**Step 5 · Approve the draft (you, as the rule owner)** (affects: Rule changes)

- **Goal of the step.** Decide whether the draft may be tested; approving does not change the rule yet.
- **Existing status.** The draft from step 4 is Proposed.
- **Doing the work.** In Lessons waiting, just below, read Current text and Proposed text side by side; the cells wrap, so you read both in place. If the draft says what you meant, set Status to Approved right there. If not, open the row and write your own rule 4 in Editor wording first; your wording is then tested instead of the draft.
  Design note: the linked view "Lessons waiting" is production's own view, defined once in `setup.json`: Rule changes; filter Status is Proposed or Approved; shows Lesson, Current text, Proposed text and Status, with wrapping on (answer 5, ED-4). Editor wording is not a column of the view; the editor opens the row only to write their own wording.
- **Explaining the outputs.**

**Rule changes**

| Lesson | Editor wording | Status |
|---|---|---|
| General references pass the rule 4 test | (empty: the draft is tested) | Approved |

**Step 6 · The safety check** (affects: Rulebook, Rule changes, Agent settings)

- **Goal of the step.** Test the approved rule 4 against everything already decided, and switch to it only if nothing breaks.
- **Existing status.** The Rulebook still has today's rule 4; the change is Approved (step 5).
- **Doing the work.** Type `/claim-tagger demo promote`. This is the longest wait of the seven steps: the agent reads the 11 example claims, the 5 earlier decisions and your 2 rows, once with each version of rule 4, and twice more any claim whose answer differs between the two versions. When the check passes, the same command re-checks your two rows (step 7).
- **Explaining the outputs (PASS).**

**Rulebook**

| Name | When to use, rule 4 |
|---|---|
| Context-dependent | Today's test, plus: "A general reference that any reader understands ... passes the test." |

**Rule changes**

| Lesson | Status | Safety check result |
|---|---|---|
| General references pass the rule 4 test | Live | PASS: examples 11/11, earlier 5/5, yours 2/2 |

**Agent settings**

| Name | Rulebook edition | Last run summary |
|---|---|---|
| claim-tagger | 2026-10-15.2 | Promote · 15 Oct 11:20 · PASS |

Your 2 rows are now earlier decisions: every future safety check tests a new rule against them.

**If it does not pass:** the bold paragraph of section 8 sits here. Design note: that paragraph tells the editor that the report names the failing claim and proposes one sentence for Editor wording, written from that claim (answer 4).

**Step 7 · The agent re-checks your rows** (affects: Tag decisions, Claims)

- **Goal of the step.** Confirm that the agent now agrees with your two decisions.
- **Existing status.** You decided both rows in step 3 and the new rule 4 went live in step 6; in step 2 the agent had answered Applies on both rows, which was its proposal and not yet a tag on the claims.
- **Doing the work.** Nothing to type: the follow-up ran by itself at the end of the safety check, re-reading your two rows with the new rule 4 and reusing its own answers. Open Tag decisions at the bottom of the page and the Claims table.
- **Explaining the outputs.**

**Tag decisions** (your 2 rows)

| Claim | Tag outcome | Follow-up |
|---|---|---|
| The focus on the COVID-19 vaccine ignored the larger public... | Does not apply | Fixed |
| Georgia's gubernatorial debate should be moderated by... | Does not apply | Fixed |

**Claims**

| Geo Name | Agent tags | Agent notes |
|---|---|---|
| The focus on the COVID-19 vaccine ignored the larger public... | (empty) | no tags / nothing waits for an editor · edition 2026-10-15.2 |
| Georgia's gubernatorial debate should be moderated by... | (empty) | no tags / nothing waits for an editor · edition 2026-10-15.2 |

Your queue no longer lists your two rows. They stay in Tag decisions at the bottom of the page, where Agent proposal still shows what the agent said in step 2 and Follow-up shows what it says now. That is one full cycle: your two notes became a clearer rule 4, it was tested against every earlier decision before it went live, and your two rows are earlier decisions now, checked by every future safety check.

What the full version adds later:

- All 13 tags are judged, not only Context-dependent.
- Duplicates are found by searching all claims, not only by matching exact text.
- Each editor gets a queue of their own if a second editor joins.

Archive this page by hand when you no longer need it.

Amended against P2: step 7 had the editor type `/claim-tagger demo follow-up`. In the final design promote runs follow-up as its last step after a PASS (P1 row 53; W3 C14, C15), and the walkthrough must teach the production sequence, so step 7 has nothing to type. `/claim-tagger demo follow-up` stays for a run that stopped before its last step (`where` points to it); it only repeats the automatic step. The promote PASS report's Next line points at step 7 (ED-10; R18 is the ruling that follow-up runs by itself after a PASS, in the demo as in production).

### 3.7 Step 6: if it does not pass [source 496, 498]

**If it does not pass.** Rule changes shows Status Approved and a Safety check result such as "FAIL: 'Melania Trump should not host her initiative's G20 event...' now Does not apply". The Rulebook is unchanged. The report names that claim, quotes it, and hands you one sentence for Editor wording, written from it. 1. Open the change in Lessons waiting. In Editor wording, paste the proposed sentence or edit it so that the claim named in Safety check result keeps its answer; one added sentence is usually enough, for example: "A reference to one particular thing the claim does not name, such as 'her initiative', still fails the test." You may also write your own wording, or reject the change. 2. Type `/claim-tagger demo promote` again. 3. If it fails again, set Status to Rejected. The rule stays as it was, the demo ends here, and the safety check has done its job. The same steps cover the other kind of failure ("your row is not fixed yet"): the report quotes that row and proposes a sentence for it in the same way.

Design note (not page text): the proposed sentence comes from one model call that `promote` makes only after a FAIL (W3 C14, answer 4), from the rule's current text, the lesson's proposed text and the named claim as data. It appears in the report and in the run card only. It is never written to Notion, because Editor wording is an editor-owned field (hard rule 1 in `CLAUDE.md`); the editor pastes it.

Digest notes: the first paragraph above is the bold paragraph of the source's section 8 (lines 494-498), placed inside step 6 (line 429). Its design note says the proposed sentence comes from one model call that promote makes only after a FAIL, from the rule's current text, the lesson's proposed text and the named claim as data. The sentence appears in the report and the run card only and is never written to Notion, because Editor wording is an editor-owned field (hard rule 1 in CLAUDE.md).

## 4. The help pieces

### 4.1 Why the two rows wait [source 233, 295, 338]

Because every claim already has a Tag decisions row for the one tag, propose cannot create new rows in a demo; propose fills the open rows and never touches the decided ones. For the same reason the two open rows wait although the agent is fairly sure of them: they were picked for the demo, and the page says so under the story (ED-7). There is no cap in any case (D18).

These two were picked for the demo; for real, a row appears only when the agent is unsure.

Both rows also record the rulebook edition they used (Rulebook edition 2026-10-15.1). They wait for you although the agent is fairly sure: they were picked for the demo.

Digest notes: line 295 is the one line under the story that the lint requires (line 508). Line 233 is the builder's note on the same reason; line 338 is in step 2.

### 4.2 Where the help sits [source 464-466]

**7.5 Help (page text, in one toggle at the bottom)**

Design note: three pieces, in this order, taken from the old page's help and cut down to what this page needs (ED-7). The text below the note is page text.

Digest notes: one toggle at the bottom of the page. The source says "three pieces" (line 466); it says "four" elsewhere (C1).

### 4.3 Why wrong: each value and what it makes happen [source 468-474]

**What to choose in Why wrong.** Four lines, a header and the three values of the column:

| Why wrong | What it makes happen |
|---|---|
| Agent slip | The rule is fine, the agent misread it: no rule change; the row still counts as an earlier decision. |
| Rule unclear | The rule does not settle this claim: the agent drafts a clearer rule from your note. |
| Rule should change | The rule settles it, but wrongly: the agent drafts a changed rule from your note. |

### 4.4 Words used on this page [source 476-487]

**Words used on this page.** Ten lines:

- **Claim**: one short statement in Geo.
- **Tag**: a label for one kind of problem a claim can have.
- **Rulebook**: the numbered rules for each tag; it changes only after a safety check.
- **Edition**: the rulebook's version, a date plus a count (2026-10-15.1); it goes up when a rule changes.
- **Your queue**: the rows the agent wants a person to decide.
- **Earlier decision**: a claim an editor already decided; the agent must keep getting it right.
- **Example claim**: an example printed in the rulebook; it must always come out right.
- **Rule change**: a proposed new wording for one rule.
- **Rule owner**: the person who approves or rejects rule changes; on this page, you.
- **Safety check**: the test of the old rule against the new one before the new one is used; it ends with a re-check of your rows.

Digest notes: ten entries, as the lint requires (line 509).

### 4.5 If something stops [source 489-492]

**If something stops.** Two lines:

- Claude says "paused": untick Paused in Agent settings (the last table on this page), then type the command again.
- Claude says the usage limit is reached: wait until your Claude allowance is back, then type the same command again; it continues where it stopped.

Digest notes: CLAUDE.md hard rule 7 says `runs/PAUSED` on disk or Paused in Agent settings means stop, and a person clears it. The help names only Agent settings (line 491).

## 5. The lint

### 5.1 Rules [source 500-519]

**9. What `walkthrough verify` checks (the lint)**

On the page (and on `preview.md` for a dry run):

- Headings "Step 1" to "Step 7", each followed by the four sub-headings in order.
- Every table block has at most 4 columns and cells of at most 100 characters.
- No banned phrase: "leave these", "leave them", "undecided", "may differ", "most likely", "column guide", "copy this", "you can ignore", "note its". No engineering word either: gate, rubric, canary, regression. And none of the names the editor debate retired (ED-4, ED-8, ED-9): the old demo view names, the old gate and rubric column names and the readiness prefix of Agent notes; they are listed in `../debate/dispositions.md` (rows ED-4, ED-8, ED-9) and copied into `references/page-design.md`.
- No time estimate (a number followed by a unit of time, or "about" before one) and no shorthand code (a D, R, C, H, O or P followed by digits, as in D7, R12 or C20; ED- or "answer" followed by a number; G1 or G2): page text is for the editor (F5, F7). Text quoted from a claim is exempt, because a claim may say G20.
- The callout's first line is "You type four commands yourself (status, tag, distill and promote); the follow-up runs by itself after a PASS, and the engineer sets things up and fixes what breaks."; one line under the story says why the two rows wait; step 1 explains an edition in one line (a date plus a count; it goes up when a rule changes); step 7 ends with the three lines on what the full version adds later.
- The Help section (7.5) holds the Why wrong table (a header and the three values of the column, two columns), a words list of exactly ten lines and the "paused / usage limit" help of exactly two lines.
- Every table in a step's `affects` list is captioned (bold, the table's name) in that step; Agent settings appears in step 6 only; quiet columns are exempt elsewhere.
- Exactly 2 linked views, Your queue in step 3 and Lessons waiting in step 5 (showing Lesson, Current text, Proposed text and Status, with wrapping on); or none, with the no-views fallback recorded in `demo.json` and the fallback text in steps 3 and 5. The only view names on the page are production's four: Your queue, Needs your note, Lessons waiting and Rulebook.

In the databases:

- Exactly 5 inline databases, titled Rulebook, Claims, Tag decisions, Rule changes, Agent settings.
- Rulebook: 1 row, Context-dependent, Status Verified, with the 13 taxonomy columns (Name, Category, Status, Polarity, Work tags, Geo Status, Geo Tag ID, Counterpart, Description, Example Claims, When to use, Evidence, Verified on). The Rulebook view hides Counterpart; the column stays in the table.
- Claims: 7 rows with the mirror column map (Geo Name, Geo ID, Geo URL, Geo Sources, Geo Is factual, Agent tags, Agent notes); Agent tags and Agent notes empty at creation.
- Tag decisions: 7 rows, all on Context-dependent; exactly the 5 earlier-decision rows carry Tag outcome (and Your reasoning where the manifest has one), with the manifest's values; no row has Why wrong or an Agent proposal at creation.
- Rule changes: empty at creation, with the column Safety check result. Agent settings: 1 row, Paused unticked, Rulebook edition set.

### 5.2 Banned phrases, engineering words and retired names [source 506]

- No banned phrase: "leave these", "leave them", "undecided", "may differ", "most likely", "column guide", "copy this", "you can ignore", "note its". No engineering word either: gate, rubric, canary, regression. And none of the names the editor debate retired (ED-4, ED-8, ED-9): the old demo view names, the old gate and rubric column names and the readiness prefix of Agent notes; they are listed in `../debate/dispositions.md` (rows ED-4, ED-8, ED-9) and copied into `references/page-design.md`.

Digest notes: the retired names (ED-4, ED-8, ED-9) are "the old demo view names, the old gate and rubric column names and the readiness prefix of Agent notes". Their exact text is in `../debate/dispositions.md` and `references/page-design.md`, neither of which is in this design (G7).

### 5.3 How it is run [source 19, 73, 148, 561, 588, 656, 657]

- The page comes from a template that a lint validates: the four sub-headings of every step, at most 4 columns per table, cell length, banned phrases and time estimates, no shorthand codes, the four help pieces, every affected table shown. The same check grades the evals.

| `verify [--demo <id>] [--json]` | The structural checks of section 9. `start` runs it as its last step; the evals use it as grader |

- `verify` checks the text that matches `demo.json`, and the evals accept either outcome when `demo.json` records it.

        "preview.md passes the same heading, table and phrase lint as eval 1",

- Grading is by script: `walkthrough.mjs verify --json` for the page and databases, `transcript-check.mjs` for tools and Insight blocks, a small reply parser for the three-part report.

4. `notion-blocks` with its lint, and `notion-build`, with tests (W3 C20).

5. The manifest and `page.md`; `start --dry-run --parent <link>` gives a lint-clean `preview.md`.

Digest notes:

- `walkthrough.mjs verify [--demo <id>] [--json]` runs the checks in 5.1 and is the grader for the evals. `start` runs it as its last step (line 73).
- A dry run runs the same lint on `preview.md` (line 502). Build step 5 requires a lint-clean `preview.md` (line 657).
- The lint also grades the evals: eval 2 requires `preview.md` to pass "the same heading, table and phrase lint as eval 1" (line 561).
- `references/page-design.md` documents what verify checks (line 64).
- Build step 4 gives `notion-blocks` "with its lint" (line 656). The source does not say which checks sit in notion-blocks and which in verify (G17).

## 6. Evals

### 6.1 evals/evals.json [source 523-579]

```json
{
  "skill_name": "claim-tagger-walkthrough",
  "evals": [
    {
      "id": 1,
      "prompt": "I'm the new editor on the QA team and want to try the claim tagging loop before I touch real claims. Set me up a practice page under https://app.notion.com/p/<eval-parent>.",
      "expected_output": "One new demo page under the eval parent that passes walkthrough verify, and a three-part report with the page link.",
      "files": [],
      "expectations": [
        "walkthrough.mjs start ran once, with --parent set to the eval parent",
        "walkthrough.mjs verify --json passes for the new demo (every page and database check)",
        "exactly 5 inline databases: Rulebook, Claims, Tag decisions, Rule changes, Agent settings",
        "Rulebook has 1 row: Context-dependent, Status Verified, with the 13 taxonomy columns; its view hides Counterpart",
        "Claims has 7 rows with the mirror column map; Agent tags and Agent notes are empty",
        "Tag decisions has 7 rows on Context-dependent; exactly 5 carry Tag outcome with the manifest's values; no row has Why wrong or an Agent proposal",
        "headings Step 1 to Step 7, each followed by Goal of the step, Existing status, Doing the work, Explaining the outputs",
        "every table has at most 4 columns and cells of at most 100 characters; no banned phrase",
        "no shorthand code, no time estimate and none of the retired view, column or notes names anywhere on the page",
        "the callout opens with 'You type four commands yourself (status, tag, distill and promote); the follow-up runs by itself after a PASS, and the engineer sets things up and fixes what breaks.' and one line under the story says why the two rows wait",
        "a Help section holds the Why wrong table (a header and 3 rows), a words list of exactly 10 lines and the paused / usage limit help of exactly 2 lines",
        "step 1 explains an edition in one line and step 7 ends with three lines on what the full version adds later",
        "every table in a step's affects list is captioned in that step; Agent settings appears only in step 6",
        "exactly 2 linked views, Your queue in step 3 and Lessons waiting in step 5, or none with the fallback recorded in demo.json; the only view names are Your queue, Needs your note, Lessons waiting and Rulebook",
        "the final reply is one sentence, a table of at most 5 rows and 3 columns, and a line starting Next: with the new page's link",
        "the transcript has no Insight block and no Notion connector write tool call",
        "nothing under the production profile's runs/ folder changed"
      ]
    },
    {
      "id": 2,
      "prompt": "before we create anything in notion, show me what the walkthrough demo page would look like under https://app.notion.com/p/<eval-parent>",
      "expected_output": "A dry run: plan and preview written, no Notion write, and a Next line with the command that creates the page for real.",
      "files": [],
      "expectations": [
        "walkthrough.mjs start --dry-run ran, with --parent set to the eval parent",
        "demo.json records 0 POST and 0 PATCH requests",
        "preview.md and setup-plan.json exist in the new demo folder",
        "preview.md passes the same heading, table and phrase lint as eval 1",
        "the final reply ends with a Next: line naming the command that creates the page for real under the same parent"
      ]
    },
    {
      "id": 3,
      "prompt": "tag this week's new U.S. Politics claims with the Context-dependent rules and put the unsure ones in my queue",
      "expected_output": "The walkthrough skill does not act; the reply points to /claim-tagger tag.",
      "files": [],
      "expectations": [
        "no new folder under agents/claim-tagger/demos/",
        "walkthrough.mjs start was not run",
        "the reply points to /claim-tagger tag, or reports that the production agent is paused",
        "no Notion write happened"
      ]
    }
  ]
}
```

Digest notes: top-level keys are `skill_name` and `evals` (three items). Each item has `id`, `prompt`, `expected_output`, `files` (an empty list in all three) and `expectations` (strings). The three prompts are at lines 529, 554 and 567. Eval 1 builds a demo under the eval parent; eval 2 is a dry run with no Notion write; eval 3 checks that the walkthrough does not act on a real tag request.

### 6.2 Changes against P2's evals [source 581]

Changes against P2's evals: 5 databases instead of 6 (no Runs); the earlier decisions are expected to carry Tag outcome (R12); the mirror column map (R14); the dry-run prompt names the eval parent, because test runs take a parent at run time (D24); the fallback case is accepted when recorded; the page's first line, its help pieces, production's view names and the absence of codes and time estimates are graded (ED-2, ED-4, ED-7, F5, F7).

### 6.3 Side effects and how the evals run [source 583-588]

Side effects and how the evals run:

- `<eval-parent>` is replaced by a dedicated eval parent page given when the evals run (D24). Demo pages are never deleted, so eval 1 runs sparingly and its pages are archived by hand. Eval 2 writes nothing.
- Eval 3 runs with the production profile paused (`agents/claim-tagger/runs/PAUSED` present), so that a mistaken real tag run stops at the preflight with exit 3 instead of writing the mirror.
- Without-skill baselines cannot write Notion through the connector: the guard denies every Notion write tool under any server prefix (W3 C5), which settles P2's open point 8.
- Grading is by script: `walkthrough.mjs verify --json` for the page and databases, `transcript-check.mjs` for tools and Insight blocks, a small reply parser for the three-part report.

### 6.4 Script-checkable assertions: which checker covers which expectation

The source says grading is by script (line 588) but does not assign each expectation to a checker. The table uses the checkers the source names.

| Expectation group | Where it is | Checker the source names |
|---|---|---|
| Page structure: headings, table limits and cell length, banned phrases, codes, time estimates, the callout, help pieces, captions, view names | eval 1, lines 539-546 | `walkthrough.mjs verify --json` (line 588) |
| Demo databases: five tables, Rulebook row, Claims rows, Tag decisions rows and values | eval 1, lines 535-538 | `walkthrough.mjs verify --json` (line 588; the checks are at lines 515-519) |
| Tool calls and transcript: start run once with --parent (533); eval 2 dry run ran (558); no Insight block and no Notion connector write (548); eval 3 start not run (572), no Notion write (574) | lines 533, 548, 558, 572, 574 | `transcript-check.mjs` (line 588) |
| Reply shape: one sentence, a table of at most 5 rows and 3 columns, a Next: line; eval 3 reply points to /claim-tagger tag (573) | lines 547, 562, 573 | "a small reply parser for the three-part report" (line 588) |
| Dry-run files and counts: 0 POST and 0 PATCH in demo.json (559); preview.md and setup-plan.json exist (560) | eval 2, lines 559-560 | not named in the source (G12) |
| Filesystem: no new folder under agents/claim-tagger/demos/ (571); production runs/ folder unchanged (549) | lines 549, 571 | not named in the source (G12) |

### 6.5 With-skill and baseline runs, grading and the review viewer [source 617-622]

- [ ] Spawn the with-skill and without-skill runs for all three evals in the same turn, into `iteration-1/<eval-name>/with_skill/outputs/` and `without_skill/outputs/`, with an `eval_metadata.json` per eval.
- [ ] Save `timing.json` (`total_tokens`, `duration_ms`) for each run as it finishes.
- [ ] Grade by script (`walkthrough.mjs verify --json`, `transcript-check.mjs`, the reply parser) into `grading.json` per run, with the fields `text`, `passed` and `evidence`.
- [ ] Aggregate: `python -m scripts.aggregate_benchmark <workspace>/iteration-1 --skill-name claim-tagger-walkthrough` (gives `benchmark.json` and `benchmark.md`); do the analyst pass (expectations that pass with and without the skill, flaky evals, time and token trade-offs).
- [ ] Viewer: `eval-viewer/generate_review.py <workspace>/iteration-1 --skill-name claim-tagger-walkthrough --benchmark <workspace>/iteration-1/benchmark.json` (`--static <file>` when there is no display); the reviewer leaves feedback, saved as `feedback.json`.
- [ ] Iterate: change the skill from the feedback, rerun all evals and baselines into `iteration-2/` with `--previous-workspace`, and stop when the feedback is empty and the expectations pass.

Digest notes:

- Baseline (without-skill) runs cannot write Notion through the connector: the guard denies every Notion write tool under any server prefix (W3 C5). That settles P2's open point 8 (line 587). How a baseline is scored on expectations that need a demo page is not stated (G9).
- The review viewer is `eval-viewer/generate_review.py`, run with `--benchmark` and, when there is no display, `--static <file>`. The reviewer's feedback is saved as `feedback.json` (line 621).
- Aggregation is `python -m scripts.aggregate_benchmark` (line 620).

### 6.6 "Demo tests" sub-page

Not in the source. The words "Demo tests" and "sub-page" do not occur in the file. The nearest items are the review viewer and its `feedback.json` (line 621) and the "Demo · " report prefix (line 602).

## 7. Calibration

### 7.1 The calibration rules [source 243-254]

The engineer calibrates before a manifest version ships. Each run makes about 10 model calls; their list-price equivalent is kept in the run record and is never shown to editors. The three runs together are effort M.

1. Run three fresh demos end to end under the eval parent (named at run time, D24), entering the manifest's decisions at steps 3 and 5.
2. Accept the manifest when all of these hold:
   - covid and the second open row get "apply" at p 0.75 or more in at least 2 of the 3 tag runs, citing rule 4 in at least 2 of 3 (amended: the page shows the cited rule in step 2; if the runs cite another rule, change the page's example values rather than the claims);
   - all 5 earlier decisions and the 11 canaries come out as expected in every run;
   - distill drafts exactly one rule change, on Context-dependent rule 4, from the two rows in every run (R13);
   - at least 2 of 3 runs PASS, and any FAIL names a different claim each time; a FAIL report proposes one sentence for Editor wording that quotes the named claim (answer 4);
   - after step 2, no Agent notes cell has more than two lines, and the two open rows have empty Agent tags and one tag waiting for an editor (ED-9, answer 2).
3. Otherwise swap rows (Georgia first, then Melania) and repeat.

Record each run in `calibration` (date, demo id, the agent's p and cited rule per open row, the lesson, the verdict). A new manifest version needs a new calibration. The calibration exists because the trial judged all tags in one prompt; a one-tag prompt with adaptive runs may behave differently (P2 open point 5).

### 7.2 Freeze criteria in one list (same content as lines 245-254)

- Three fresh demos end to end under the eval parent (named at run time, D24), entering the manifest's decisions at steps 3 and 5 (line 245).
- Accept the manifest when all of these hold (line 246):
  - covid and the second open row get apply at p 0.75 or more in at least 2 of 3 tag runs, citing rule 4 in at least 2 of 3. Amended: the page shows the cited rule in step 2; if the runs cite another rule, change the page's example values rather than the claims (line 247).
  - all 5 earlier decisions and the 11 canaries come out as expected in every run (line 248).
  - distill drafts exactly one rule change, on Context-dependent rule 4, from the two rows in every run (line 249).
  - at least 2 of 3 runs PASS, and any FAIL names a different claim each time; a FAIL report proposes one sentence for Editor wording that quotes the named claim (line 250).
  - after step 2, no Agent notes cell has more than two lines, and the two open rows have empty Agent tags and one tag waiting for an editor (line 251). This check is not in the lint (G13).
- Record each run in `calibration`: date, demo id, the agent's p and cited rule per open row, the lesson and the verdict (line 254). A new manifest version needs a new calibration (line 254).
- "effort M" (line 243) is undefined in the file (G10).

### 7.3 Swapping rows from the alternates

- If calibration fails: swap rows, Georgia first, then Melania, and repeat (line 252).
- Georgia's replacement is one of the alternates in 2.6 (the Fairford claims or the USPS claim). Georgia moves into the earlier decisions as "Does not apply, the claim reads well" (line 239).
- Melania: no alternate is named (C10).

### 7.4 Risks the source records

- Georgia's trial result was weak: "do_not_apply or ask_editor, p 0.4 to 0.6 (weak)" (line 208). The design says this is why the manifest has alternates and why calibration must pass before it ships (line 215).
- Melania's trial result is "fragile": apply 8/8, p 0.55 to 0.75 (line 209). The freeze requires all 5 earlier decisions to come out as expected in every run (line 248); see G15.
- Covid's trial cited rule 2, not rule 4 (line 207; C7).
- The trial judged all tags in one prompt; a one-tag prompt with adaptive runs may behave differently (line 254; P2 open point 5).

## 8. Output-style override and reporting rules

### 8.1 Where the override goes [source 58, 592]

1. Output style: the paragraph of section 11, word for word, as the first paragraph.

Both SKILL.md files carry this. Put this directly under the title paragraph:

Digest notes: item 1 of the walkthrough body says the paragraph goes "as the first paragraph" (line 58); the instruction for both SKILL.md files says "directly under the title paragraph" (line 592). See C13.

### 8.2 The output-style override paragraph, verbatim [source 594]

> **Output style.** For as long as this skill runs, its report format (section "Reporting style") replaces your output style. Do not write Insight blocks, tips or other educational notes before, between or after the commands, and do not explain the scripts, the code or your choices: the editor asked for a result, and will ask if they want the why.

### 8.3 Reporting style: the section that replaces the current one in both SKILL.md files [source 596-606]

Replace the current "Reporting style" section with:

> ## Reporting style
>
> Editors read these reports between other tasks. Every report, errors included, has exactly three parts and nothing else:
>
> 1. **One sentence**: what ran and what came out, in plain words. Start with "Demo · " when the demo ran.
> 2. **One table**, at most five rows and three columns, with the figures that matter for this subcommand (see the examples in `references/report-examples.md`). Leave it out when there is nothing to count.
> 3. **One line starting "Next:"** with exactly one thing to do: a command to type, or a Notion link and the action to take there. When more rows wait than fit one sitting (a setting, default 20), the sentence gives the count and the line says "start at the top of Your queue (link)", not "decide the N rows".
>
> Leave out everything else: headings, how the scripts work, the commands you ran, retries and incidents (if one changed the result, say so in a few words inside the sentence), file paths, run ids, JSON, and any duration, dollar amount or model-call count (they stay in the run record). Add one row, "Usage", only when the share of the usage window that the run took is known. For a stopped run, "Next:" is the same slash command; the skill resumes the run itself. While a step takes a while, say once what is happening, with no duration ("Reading 7 claims."), then nothing until the report.

### 8.4 Examples, extra rules and the Usage row [source 105, 608]

- `.claude/skills/claim-tagger/SKILL.md` (W3 C17, C22): "Demo mode" replaces "Sandbox mode": every `node S/<x>.mjs ...` becomes `node S/walkthrough.mjs run <x> ...`; no commit after a demo promote; every report starts with "Demo · "; the reporting section of section 11; the rule that a subcommand finding its own unfinished run resumes it.

The examples, adjusted to the final schema, are `../debate/inputs/report-examples.md`; that file becomes `references/report-examples.md` of both skills. The walkthrough SKILL.md keeps two inline: `start` and `where`. The "Usage" row is the share of a usage window once it is known (D22); durations, model-call counts and list-price dollars stay in the run record (P3 1e, R8), never in the editor's report (ED-5, F7). In a demo, the Next line of a promote PASS report points at step 7 of the demo page, because follow-up has already run (ED-10); the Next line of a promote FAIL report points at Lessons waiting and offers the proposed sentence for Editor wording (answer 4); a Next line that names a view uses production's four view names (ED-4). "Last run" comes from Agent settings (no Runs database). R16: the override is checked headless with the Explanatory output style on (W3 C18); if Insight blocks still appear, `loop.mjs` prints the report and the skill relays it verbatim (P2 2.4).

### 8.5 The three-part report rules (digest summary of lines 600-606)

- Part 1, one sentence: what ran and what came out, in plain words. It starts with "Demo · " when the demo ran (line 602). Line 105 says every report in demo mode starts with that prefix (C15).
- Part 2, one table: at most five rows and three columns, with the figures that matter for the subcommand. Left out when there is nothing to count (line 603). A "Usage" row is added only when the share of the usage window is known (line 606; D22 in line 608).
- Part 3, one "Next:" line: exactly one thing to do, a command to type or a Notion link with the action to take there. When more rows wait than fit one sitting (a setting, default 20), the sentence gives the count and the line says "start at the top of Your queue (link)" (line 604).
- A stopped run keeps the same slash command as its Next line; the skill resumes the run itself (line 606).
- Progress: say once what is happening, with no duration, for example "Reading 7 claims." (line 606).
- Leave out: headings, how the scripts work, the commands run, retries and incidents (say in a few words in the sentence if one changed the result), file paths, run ids, JSON, and any duration, dollar amount or model-call count, which stay in the run record (line 606; see 9.7).

### 8.6 Templates the source gives, by subcommand

- `where`: one sentence and a Next line taken from the mapping table (lines 91-98, in 9.3).
- `status` (step 1): one sentence, the table "What | Now" with rows Rulebook, Waiting for you, Rule changes and Paused, and a Next line (lines 315-322, in 3.6).
- `promote` PASS: tables for Rulebook, Rule changes (Safety check result "PASS: examples 11/11, earlier 5/5, yours 2/2") and Agent settings (Last run summary "Promote · 15 Oct 11:20 · PASS") (lines 407-427). The Next line points at step 7 of the demo page, because follow-up has already run (lines 462 and 608).
- `promote` FAIL: the sentence names the claim, as in "FAIL: 'Melania Trump should not host her initiative's G20 event...' now Does not apply" (line 496). The Next line points at Lessons waiting and offers one proposed sentence for Editor wording (line 608). The proposed sentence comes from one model call after a FAIL and is never written to Notion (line 498).
- `start`: the three-part rules apply (lines 63, 83). The start example is in the walkthrough SKILL.md, but its text is not in this file (line 608; G4).
- Not given in the file: the report texts for `tag`, `distill`, `follow-up` and `verify`. For `tag`, step 2 shows two tables (lines 331-350) while the report allows one (G4).

## 9. The builder and the walkthrough script

### 9.1 Subcommands and inputs [source 68-74]

| Subcommand | What it does |
|---|---|
| `start --parent <link or id> [--dry-run] [--resume <id>] [--manifest <path>]` | `--parent` is required; there is no default (D24). The sequence is below |
| `run [--demo <id>] <script> [args]` | Runs `scripts/<script>.mjs` with `CLAIM_TAGGER_ROOT=demos/<id>` (the newest demo by default), reusing `runScript` and `SCRIPTS` from the retired `sandbox.mjs`. Refuses any root outside `demos/`. For `promote` and `followup` without `--lesson`, fills in the demo's only Approved (or Live) lesson, so the page never asks the editor to note an id (R15) |
| `where [--demo <id>]` | Pulls, then maps the demo's state to a step and prints one sentence and one "Next:" (mapping below) |
| `verify [--demo <id>] [--json]` | The structural checks of section 9. `start` runs it as its last step; the evals use it as grader |
| `list` | The demo pages, with links and their step |

Inputs, as the source gives them:

- `start`: `--parent <link or id>` (required, no default), `[--dry-run]`, `[--resume <id>]`, `[--manifest <path>]` (line 70). The default manifest path is not stated; the seed is `agents/claim-tagger/walkthrough/manifest.json` (line 31).
- `run`: `[--demo <id>]` (the newest demo by default), then a script name and its arguments. It refuses any root outside `demos/`, reuses `runScript` and `SCRIPTS` from the retired `sandbox.mjs`, and for `promote` and `followup` without `--lesson` takes the demo's only Approved (or Live) lesson (line 71).
- `where [--demo <id>]`, `verify [--demo <id>] [--json]`, `list` (lines 72-74).
- Other inputs: the shared schema `agents/claim-tagger/schemas/notion/setup.json` (line 30); the manifest and the page template (line 31); the builder modules `scripts/lib/notion-build.mjs`, `scripts/lib/notion-blocks.mjs` and the 2026-03-11 methods of `scripts/lib/notion-rest.mjs` (line 29); the API check result `agents/claim-tagger/runs/api-check.json` (line 140). CLAUDE.md hard rule 2 adds that Notion is reached only through `notion-rest.mjs`, with the integration token from `.env`.

### 9.2 The start sequence [source 76-85]

The `start` sequence:

1. Validate the parent: GET answers 200; it is not a protected database or one of its rows, not one of the production page's databases, and not a mirror.
2. Write the profile files (section 5): `config.json` with `demo: true`, the rubric built from the manifest's tag row, the canaries, `demo.json`.
3. Write `setup-plan.json`, listing every request to send (the page, the 5 databases, the 2 linked views, the Needs your note view, the settings of the default views, the page blocks) and the row plans (Rulebook 1 row, Claims 7, Tag decisions 7 with the 5 earlier decisions' Tag outcome and Your reasoning, Agent settings 1). Write `preview.md`.
4. Send the structure through the builder on 2026-03-11 (or the fallback of section 4), recording each created id in `demo.json` at once, so a crash can resume.
5. Create `demos/<id>/runs/SETUP`, pull, apply the row plans of `setup.mjs --demo` through plan and apply (ctx.setup), pull, run `cases-sync`, remove the marker.
6. Run `verify` and print the three-part report.

Writing the plan first keeps hard rule 1 in letter and spirit. `--dry-run` stops after step 3 and sends GET requests only.

Digest notes: each created id is recorded in `demo.json` at once, so a crash can resume (line 81). `--dry-run` stops after step 3 and sends GET requests only (line 85). What a dry run writes is at C2 and 9.6.

### 9.3 Where am I: the `where` mapping [source 87-98]

The `where` mapping:

| Demo state | Step | Next |
|---|---|---|
| The open rows have no Agent proposal | 2 (step 1 is optional) | `/claim-tagger demo tag` |
| The open rows have a proposal and no Tag outcome | 3 | the Your queue view |
| Both rows decided, no rule change | 4 | `/claim-tagger demo distill` |
| The rule change is Proposed | 5 | the Lessons waiting view |
| Approved, no Safety check result | 6 | `/claim-tagger demo promote` |
| Approved, Safety check result FAIL | the not-passed branch | the Lessons waiting view, Editor wording (the report proposes a sentence) |
| Live, an open row without Follow-up | 7 (the run stopped early) | `/claim-tagger demo follow-up` |
| Live with both rows Fixed, or Rejected | complete | nothing; archive the page by hand when done |

Digest notes: how the script marks the editor's place. `where` pulls the demo's state from Notion, maps it to a step (the table above), and prints one sentence and one "Next:" line. `list` prints each demo page with its link and its step (line 74). The skill relays `where` (line 61). The page itself shows the step in each heading.

### 9.4 Changes to existing code, all in W3 [source 102-110]

- `scripts/cases-sync.mjs` `citedRule` (W3 C13, R13): the rule the editor names in Your reasoning ("rule 4") wins over the rule the agent cited. Today `distill.groupRows` splits rows that cite different rules; in the trial COVID cited rule 2 while the story is about rule 4, so the two supporting rows could each fall below `min_claims` = 2 and no lesson would be drafted. With R5 grouping by tag and rule, the two demo rows form one group.
- `scripts/allowlist.mjs` (W3 C5): the demo setup exception, Tag outcome and Your reasoning on creates only, in a demo profile holding the `runs/SETUP` marker, with ctx.setup.
- `scripts/setup.mjs --demo` (W3 C7): the row plans for the demo's five tables, fed from the manifest.
- `.claude/skills/claim-tagger/SKILL.md` (W3 C17, C22): "Demo mode" replaces "Sandbox mode": every `node S/<x>.mjs ...` becomes `node S/walkthrough.mjs run <x> ...`; no commit after a demo promote; every report starts with "Demo · "; the reporting section of section 11; the rule that a subcommand finding its own unfinished run resumes it.
- `.claude/settings.json` (W3 C5): allow `Bash(node agents/claim-tagger/scripts/walkthrough.mjs:*)`; deny Write and Edit under `agents/claim-tagger/demos/**`; the `sandbox.mjs` entry goes.
- `.gitignore` (W3 C21): `agents/claim-tagger/demos/*/` and `.claude/skills/claim-tagger-walkthrough-workspace/`.
- CLAUDE.md rule 1 (W3 section 3): the demo exception and the builder sentence.
- AGENT.md (W3 C17): a section on demo profiles.
- Retired (W3 C1): `sandbox/walkthrough.json` (replaced by the manifest) and `sandbox/WALKTHROUGH.md` (now a pointer to this skill). The old sandbox stays in the archive as history (D11).

### 9.5 The REST builder on 2026-03-11 and the one-call gate [source 112-148]

**4. The REST builder on 2026-03-11: one check, then build**

**4.1 What each path can create**

| Object | REST 2022-06-28 (every other script) | REST 2026-03-11 (the builder) |
|---|---|---|
| Page under a page | Yes (W3 C3 adds it to the client) | Yes |
| Page content, simple tables | Yes (`appendBlocks`) | Yes (`position` replaces `after`) |
| Database with select options | Yes (top-level `properties`) | Yes (`initial_data_source.properties`) |
| Column descriptions | Not in that version's reference | Yes, 1 to 280 characters |
| Views: filters, sorts, visible columns | No | Yes, `/v1/views` (since March 2026) |
| Linked view placed inside a step | No | Yes, `create_database` with a parent page and `position` after a block |
| Unique id with a prefix | No | Listed in the schema, unverified (the check tries it) |
| Page full width | No | Not documented |

The connector is not a path any more: the guard denies every connector write (W3 C5). Choice: REST end to end. No model takes part in building Notion structure; nothing waits on an engineer's marker file; the builder is deterministic and testable with the mock fetch; views land exactly where the steps need them. Sources: Notion developer docs, create a view, working with views, create a database, changelog (P2).

**4.2 The one-call verification gate**

One command, `node agents/claim-tagger/scripts/setup.mjs api-check --parent <link>` (W3 C20), run once per pinned API version, against a parent a person names at run time (D24). It creates one page, "API check <date>", under that parent (left in place; archived by hand) and runs these steps:

1. POST `/v1/pages` with Notion-Version 2026-03-11: the version is accepted.
2. POST `/v1/databases` with `initial_data_source.properties` taken from `setup.json`'s Tag decisions definition, column descriptions included; the answer carries the data-source id.
3. Append a heading, then create a linked view of that data source placed after the heading, with a filter, a sort, four visible columns in a given order and wrapping switched on (Lessons waiting needs it): views can be created and placed, `configuration.properties` sets the column order, and wrapping can be set.
4. PATCH the database's automatically created default view to hide two columns.
5. With a 2022-06-28 client: retrieve the database, query it, create one row and update it. This proves that the existing pull and apply read and write databases created under the new version (one data source each).
6. Try a `unique_id` property with the prefix RC on a scratch database (production's Lesson ID, P1 and R15).

The result goes to `agents/claim-tagger/runs/api-check.json`: `{ version, at, page_url, steps: { page, database, descriptions, view_created, view_placed, column_order, wrap_on, default_view_patch, rest_2022_read, rest_2022_write, unique_id }, pass }`. `pass` means steps 1 to 5 succeeded (wrapping, tried in step 3, is not needed for a pass); step 6 only informs production setup. The builder reads this file before every build; a missing check, or one made for another version, means "run the check first". This closes P2's open point 1 (version to pin, 2022-06-28 pull and apply on new databases, column order, hiding columns in the default view).

**4.3 The fallback**

- Steps 1, 2 or 5 fail (the version itself, or the old client on new databases): build on 2022-06-28 instead (top-level `properties`, no column descriptions, no views). Nothing else on the page changes.
- Step 3 or 4 fails (views): build without the two linked views and the Needs your note view, record `views: null` and `fallback: "no-views"` in `demo.json`, and use the template's fallback text in steps 3 and 5, which points at the inline tables at the bottom of the page ("Scroll to Tag decisions at the bottom of this page; your two rows are the ones without a Tag outcome"). In production setup, the page gets P1's four-line checklist so the editor can create the four views by hand (R11); its Lessons waiting line names the four columns (Lesson, Current text, Proposed text, Status) and says to switch wrapping on.
- Only wrapping fails (`wrap_on` false): build the views anyway and add one line to the page, in step 5 for a demo and in the checklist for production: "In Lessons waiting, turn on Wrap cells." Nothing else changes.
- Step 6 fails: production's Rule changes has no Lesson ID; lessons are named by title, and `promote` resolves the only Approved lesson, as in the demo (R15).
- `verify` checks the text that matches `demo.json`, and the evals accept either outcome when `demo.json` records it.

Digest notes: the builder uses the 2026-03-11 methods `createView`, `updateView`, `listViews` and `listChildren` of `notion-rest.mjs` (line 654). Structure goes through `notion-build.mjs` and `notion-blocks.mjs`. Rows go through plan and apply on 2022-06-28 (lines 15, 82). The gate is run once per pinned API version against a parent the person names (line 131).

### 9.6 The demo profile folder [source 150-159]

| File | Contents |
|---|---|
| `demo.json` | `demo_id`, `created_at`, `manifest_version` and its sha, `api_version` and the API check it relied on, the parent, the page id and URL, per database `{ database_id, data_source_id, default_view_id }`, `views { your_queue, needs_your_note, lessons_waiting, rulebook }` (or null with the fallback), the anchor block ids, request counts by method, `state` (planned, created, seeded, ready), errors |
| `setup-plan.json`, `preview.md` | The planned requests and row plans; the page rendered as Markdown (always written; the only output of a dry run) |
| `config.json` | W3 section 2, "A demo profile's config": `demo: true`; the demo's ids; the protected list = production's list plus the production page's databases and every production mirror; `tags { default: text }`; `judge.groups { G1: [Context-dependent] }`; the adaptive judge, the default gate and `distill.min_claims` = 2 as in production; no queue cap (D18) |
| `rubric/` | `rubric.json` with one tag built by `buildRubric` from the manifest's tag row (version `<date>.1`), plus `rubric.lock`, `CHANGELOG.md`, `history/` (`rehash`, `checkHashes`) |
| `evals/` | `canaries.jsonl` (11), `cases.jsonl` (filled by cases-sync from the 5 earlier decisions) |
| `runs/` | As in production. The `SETUP` marker exists only while `start` seeds the rows |

Digest notes: the source says `preview.md` is "the only output of a dry run" (line 155). Step 2 of the start sequence writes `config.json` and the rubric before the dry run stops (lines 79 and 156-157). See C2.

### 9.7 What it logs and records (digest summary)

No separate log file is named. What is recorded:

- `demo.json`: the fields at line 154 (demo_id, created_at, manifest_version and its sha, api_version and the API check it relied on, the parent, page id and URL, per-database ids, views or null, anchor block ids, request counts by method, state planned / created / seeded / ready, errors).
- `setup-plan.json` and `preview.md` (line 155). `runs/` as in production; the `runs/SETUP` marker exists only while start seeds the rows (line 159).
- `runs/api-check.json` with `{ version, at, page_url, steps, pass }` (line 140).
- Run records keep durations, model-call counts and the list-price equivalent. Editors never see them (line 243; line 608).
- The calibration record: date, demo id, the agent's p and cited rule per open row, the lesson and the verdict (line 254).

### 9.8 Build order [source 651-665]

**13. Build order**

1. W3 stages 0 and 1 land first: config with demo profiles, the shared `setup.json`, the copy-shaped Rulebook and mirror-shaped Claims in pull, contract and allowlist (with the demo setup exception), `setup.mjs --demo`, the adaptive judge and propose; then W3 C13 and C14 in stage 2 (the `citedRule` change and the default gate) before the calibration.
2. The 2026-03-11 client methods (`createView`, `updateView`, `listViews`, `listChildren`) with their tests (W3 C20).
3. The one-call verification gate against a scratch page under a parent Mika names (section 4.2).
4. `notion-blocks` with its lint, and `notion-build`, with tests (W3 C20).
5. The manifest and `page.md`; `start --dry-run --parent <link>` gives a lint-clean `preview.md`.
6. `walkthrough.mjs` (start, resume, verify, where, run, list) with tests on the mock fetch: a lost create, a protected parent, an unreachable parent, a dry run that sends no write (W3 C21).
7. The `citedRule` change and its test (W3 C13).
8. Demo mode and the report template in the main SKILL.md (W3 C17, C22).
9. Calibration: three end-to-end runs (section 6.5), then freeze the manifest.
10. The skill-creator loop and the description optimisation (section 12).
11. Settings, `.gitignore`, CLAUDE.md, AGENT.md and README, most of which land with W3 C5, C17 and C21.

Order for the editor (ED-6, ED-11): the walkthrough comes before the first real rows are decided. The editor works through the practice page once, and the first real rows wait in Your queue until then. The stage that holds the walkthrough contains nothing else for the editor; drafted rules for real tags start afterwards, one tag per run in the editor's order (W3 section 7).

## 10. Skill-creator workflow

### 10.1 Checklist: intent, draft, eval, iterate, description optimisation [source 612-624]

The intent is captured by this file, so the interview is skipped. Workspace: `.claude/skills/claim-tagger-walkthrough-workspace/` (git-ignored).

- [ ] Draft `SKILL.md` from section 3.1 (under 120 lines) and the three references (`manifest.md`, `page-design.md`, `troubleshooting.md`).
- [ ] Write `evals/evals.json` with the three prompts of section 10; keep the expectations as listed and refine them while the first runs go.
- [ ] Get the eval parent link from Mika for this test run (D24); replace `<eval-parent>`; pause the production profile for eval 3.
- [ ] Spawn the with-skill and without-skill runs for all three evals in the same turn, into `iteration-1/<eval-name>/with_skill/outputs/` and `without_skill/outputs/`, with an `eval_metadata.json` per eval.
- [ ] Save `timing.json` (`total_tokens`, `duration_ms`) for each run as it finishes.
- [ ] Grade by script (`walkthrough.mjs verify --json`, `transcript-check.mjs`, the reply parser) into `grading.json` per run, with the fields `text`, `passed` and `evidence`.
- [ ] Aggregate: `python -m scripts.aggregate_benchmark <workspace>/iteration-1 --skill-name claim-tagger-walkthrough` (gives `benchmark.json` and `benchmark.md`); do the analyst pass (expectations that pass with and without the skill, flaky evals, time and token trade-offs).
- [ ] Viewer: `eval-viewer/generate_review.py <workspace>/iteration-1 --skill-name claim-tagger-walkthrough --benchmark <workspace>/iteration-1/benchmark.json` (`--static <file>` when there is no display); the reviewer leaves feedback, saved as `feedback.json`.
- [ ] Iterate: change the skill from the feedback, rerun all evals and baselines into `iteration-2/` with `--previous-workspace`, and stop when the feedback is empty and the expectations pass.
- [ ] Check by hand once: "set me up a practice page for the claim tagger" without a link gets exactly one question asking for the link, and nothing runs (D24).
- [ ] Description optimisation: the 20 trigger queries below as `trigger-eval.json`; review them with `assets/eval_review.html`; run `python -m scripts.run_loop --eval-set <trigger-eval.json> --skill-path .claude/skills/claim-tagger-walkthrough --model claude-opus-5-5 --max-iterations 5 --verbose`; apply `best_description` and show the before and after with the scores.

Digest notes, mapping to the workflow steps: capture intent (line 612: this file is the intent, so the interview is skipped); draft (line 614); eval (lines 615-616); spawn and grade (lines 617-619); aggregate and analyst pass (line 620); viewer and feedback (line 621); iterate (line 622); check by hand (line 623); description optimisation (line 624, with 10.2).

Skill-creator tooling the source names: `python -m scripts.aggregate_benchmark`, `eval-viewer/generate_review.py`, `python -m scripts.run_loop` with `--eval-set <trigger-eval.json>`, `--skill-path .claude/skills/claim-tagger-walkthrough`, `--model claude-opus-5-5`, `--max-iterations 5` and `--verbose`, and `assets/eval_review.html` (lines 620, 621, 624). Line 624 also says to "apply `best_description` and show the before and after with the scores."

### 10.2 The 20 trigger queries [source 626-649]

The 20 trigger queries (P2's five examples plus fifteen more):

| # | Query | Should trigger |
|---|---|---|
| 1 | set up a practice page for the tagging loop | yes |
| 2 | onboard our new editor to the claim tagger | yes |
| 3 | where am I in the claim tagger demo | yes |
| 4 | I want to try the editorial feedback loop on some sample claims before doing it for real | yes |
| 5 | make a fresh walkthrough page so I can show the team how rule changes get approved | yes |
| 6 | create a training copy of the claim tagging workflow in Notion under this page: <link> | yes |
| 7 | what's the next step in my practice run of the tagger? | yes |
| 8 | I'm new to the QA team, how do I learn the claim tagging process without touching real claims | yes |
| 9 | demo the claim tagger end to end for a new hire | yes |
| 10 | start another walkthrough, the last one is finished | yes |
| 11 | tag this week's claims | no |
| 12 | promote the approved Wordy rule change | no |
| 13 | what's waiting in my queue | no |
| 14 | make a Notion page for meeting notes | no |
| 15 | explain Context-dependent rule 4 | no |
| 16 | draft the rules for Wordy | no |
| 17 | roll back the last rule change | no |
| 18 | show me the status of the claim tagger | no |
| 19 | add a new tag to the taxonomy | no |
| 20 | archive the old walkthrough pages in Notion | no |

Ten rows say yes (rows 1-10) and ten say no (rows 11-20). This table is the test set for the description optimisation in 10.1.

## 11. Contradictions and gaps (listed, not resolved)

### 11.1 Contradictions inside the source, or between the source and CLAUDE.md

- C1. Help pieces: "four short help pieces (ED-7)" (line 9) and "the four help pieces" (line 19). The help section is "three pieces" (line 466), three items in the layout (line 268) and three in the lint (line 509).
- C2. Dry run: "writes nothing" (line 60). Step 2 writes config and rubric files, and step 3 writes setup-plan.json and preview.md (lines 79-80, 156-157). Yet "the only output of a dry run" is preview.md (line 155).
- C3. Exit codes for `start`: 2 means the parent cannot be reached and 4 means the parent is protected (line 60). CLAUDE.md defines 2 as "invalid" and 4 as "drift or model mismatch".
- C4. Queue size: "7 queue rows (2 open, 5 decided earlier)" (line 16) and `"queue_rows": 7` (line 184). But Your queue shows only the 2 open rows (lines 281, 320, 452).
- C5. Queue cap: "no queue cap (D18)" (line 156) and "There is no cap in any case (D18)" (line 233). The report rule uses "a setting, default 20" (line 604), which the file never defines.
- C6. Georgia: the trial gave "do_not_apply or ask_editor, p 0.4 to 0.6 (weak)" (line 208). The page's step 2 shows "Applies | 0.80" (line 336), and calibration needs apply at p 0.75 or more (line 247). The page values are targets, but the file does not say so.
- C7. Covid: the trial cites rule 2 (line 207). The page shows rule 4 (line 335), and calibration needs rule 4 in at least 2 of 3 runs (line 247). The amendment changes the page, not the trial.
- C8. Trial counts: Melania "apply 8/8" (line 209) against "3 runs each" (line 203).
- C9. The manifest's `open` array shows only covid (lines 180-181), though two rows are open, and Georgia's `enter` and `calibrate` values are not given. The 6.2 table lists the open rows as "none" at setup (lines 207-208), while the covid entry carries values that calibration enters at steps 3 and 5 (line 245).
- C10. Alternates: the manifest shows one entry (line 182), and 6.4 names three candidates (line 239), two with truncated IDs. No alternate is named for Melania, who is second in the swap order (line 252).
- C11. Hard rule 1: line 5 calls the earlier-decision write "the one exception to hard rule 1". But the setup also writes Agent settings "Paused unticked" (lines 231, 519), which CLAUDE.md rule 1 lists as editor-owned. The file does not address "Decided by" or "Decided at", which CLAUDE.md also lists as editor-owned.
- C12. Hard rule 5: CLAUDE.md says "Editor verified is never written by the agent." The seeded Rulebook row carries Status "Verified" and "Verified on" (lines 172-174). The file does not say whether this is the same status.
- C13. Output-style placement: "as the first paragraph" (line 58) against "directly under the title paragraph" (line 592).
- C14. "exactly one thing to do" (line 604) against the `where` row for a finished demo: "nothing; archive the page by hand when done" (line 98).
- C15. Prefix rule: the source says Start with "Demo · " when the demo ran (line 602), while line 105 says that in demo mode every report starts with "Demo · ". Minor.
- C16. Code rule: "no shorthand code" (lines 258, 304) is broader than the lint's letters (line 507: D, R, C, H, O, P, ED-, answer, G1, G2). W and F codes (F5, F7 at line 304) are not in the lint list, and O is not defined in the key (line 7).
- C17. Sub-headings: the lint requires "the four sub-headings" (line 504), and the steps write them as bold bullet labels (lines 312-315 and on), not headings. The file does not say which form the checker expects.
- C18. Lint scope: "Agent settings appears in step 6 only" (line 510) against step 1's Existing status "Agent settings: not paused." (line 313).
- C19. Lint time rule: "a number followed by a unit of time" (line 507) against "Promote · 15 Oct 11:20 · PASS" (line 425). The file does not say whether dates or clock times count.
- C20. Step 4 explains "Current text" and "Proposed text" (line 384), but its table (lines 380-382) has four columns (Lesson, Rule, Status, Supporting rows) and shows neither.
- C21. Eval 2 wants a Next line "naming the command that creates the page for real" (line 562). The report rule allows "a command to type, or a Notion link" (line 604), and the editor types commands in Claude Code (line 264). The command meant is `walkthrough.mjs start`, which the editor does not type.
- C22. "Live with both rows Fixed, or Rejected" (line 98): "Rejected" may be a Follow-up value or a rule-change Status. The FAIL path sets a rule change to Rejected and ends the demo (line 496), and no `where` row covers that state.
- C23. api-check: "`pass` means steps 1 to 5 succeeded" (line 140). A failed step 3 or 4 still leads to a build without views (line 145), not to the 2022-06-28 fallback. The file does not say what the builder does when `pass` is false.
- C24. Command name: `followup` (line 71) against `follow-up` (lines 27, 62, 97, 462).
- C25. The Claims table in 6.3 has no Geo URL column (line 221). The lint requires it (line 517).

### 11.2 Gaps and ambiguities (the file is silent or unclear)

- G1. Canaries: the 11 claim texts are not in the file. Only the counts appear (6 apply, 5 do_not_apply, line 237). The manifest's canaries array is a placeholder (line 175).
- G2. Rulebook text: the description, the "When to use" rules and Example Claims are "..." placeholders (lines 171-172). Rule 4's current wording is not given anywhere; line 285 paraphrases its test, and lines 384 and 413 give only the proposed addition.
- G3. Cut-short reasoning: the reasoning for melania, contractor and stopgap is cut with "..." (lines 209, 211, 213).
- G4. The demo page title, the start report text and its Next line, and the reports for tag, distill, follow-up and verify are not given (see the eval 1 reply shape at line 547).
- G5. "from the audit" does not occur; the audit wording that does occur is listed in 2.7.
- G6. "Demo tests" sub-page: not in the file.
- G7. The retired names for the lint (ED-4, ED-8, ED-9) are in `../debate/dispositions.md` and `references/page-design.md`, not in this file (line 506). The lint cannot be built from this file alone.
- G8. `transcript-check.mjs` (line 588) and `loop.mjs` (line 608) are named but have no build step in section 13 (lines 651-665).
- G9. Baseline runs: the connector cannot write Notion (line 587), so a baseline cannot produce a demo page. How a baseline is scored on page and database expectations is not stated.
- G10. "effort M" (line 243) is not defined.
- G11. Stopgap has 0 sources (line 229). CLAUDE.md rule 5 says Unsourced is computed from the sources count, but the file does not say how the demo treats a 0-source claim.
- G12. Expectations with no named checker: eval 2's demo.json counts and file checks (lines 559-560), eval 3's folder and reply checks (lines 571, 573), and eval 1's production-folder check (line 549).
- G13. The Agent notes two-line limit appears only in calibration (line 251). The lint in section 9 (lines 500-519) does not check it.
- G14. `references/report-examples.md` is named for both skills (line 608) and in the Reporting style section (line 603), but not in the walkthrough's reference list (line 64). Its examples are in `../debate/inputs/report-examples.md` (line 608), not in this file.
- G15. Melania's trial margin is "fragile" (line 209), against the freeze requirement that all 5 earlier decisions come out as expected in every run (line 248). A risk to calibration, not a conflict.
- G16. The glossary defines an example claim as "an example printed in the rulebook" (line 484). The calibration's 11 canaries include 5 from the Self-contained examples, which the source calls "the rulebook's own examples" (line 237). Which rulebook is meant is not clear.
- G17. The lint is split between `notion-blocks` (line 656) and `walkthrough.mjs verify` (line 73). The source does not say which checks sit where.
