# W4 walkthrough skill: digest

Source: `X:\work\geo-agents\docs\analysis-2026-10\design\W4-walkthrough-skill.md`, 665 lines, read in full in five chunks (1-150, 151-300, 301-450, 451-600, 601-665). This digest replaces the source for the builder.

How to read it:

- Quoted text, tables and code blocks are copied from the source. Each copied block carries its source line range in square brackets, so it can be checked against the file.
- Source headings appear as bold lines. The digest's own headings carry the section numbers.
- Text outside the copied blocks is the digest's wording. Where it reports a gap, a conflict or a missing phrase, it says so. Conflicts are listed in section 11 and are not resolved.
- The source's codes (Dn, Rn, Cn, W3, P1 to P3, H5, G1, ED-n, answer n, F5, F7) are not expanded. The key is in the preamble.

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

