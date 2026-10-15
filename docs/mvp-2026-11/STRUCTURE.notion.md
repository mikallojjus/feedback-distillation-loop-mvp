This page proposes how the claim tagger MVP sits in Notion: five tables, four views and three sub-pages, all under the page "Feedback Distillation MVP". Nothing else is built in Notion until it is approved.

To approve, say go as it stands, or edit this page first and then say go; the build follows the page as you leave it.

Sample rows use real claims from the audit of 9 October, with claims and ids shortened; the values in them are illustrations, not results.

## At a glance

| Table | Rows at setup | Who writes to it |
|---|---|---|
| Rulebook copy | 13, one per tag | Setup copies the rows once; the team may edit by hand; the agent writes only When to use, after a safety check PASS |
| Claims copy | 50 claims | Setup copies the rows once; the agent writes only Agent tags and Agent notes |
| Tag decisions (the queue) | 10, the audit's decisions, already decided | The agent adds a row for every unsure answer; the editor decides it |
| Rule changes | none | The agent proposes changes to rules; the editor approves or rejects them |
| Agent settings | 1 | A person ticks Paused; the agent writes Rulebook edition and Last run summary |

Sub-pages:

- **Structure proposal**: this page; it stays as history after approval.
- **Demos**: one practice page per walkthrough run, each with its own small tables and the same four view names; never deleted.
- **Demo tests**: the walkthrough skill's own test runs.

## Rulebook copy

The 13 rows of the taxonomy table "Claim Tags — verified" whose Work tags contain Issue, with the same column names and types: Context-dependent, Exact duplicate, Factually challenged, Improper capitalization, Improperly sourced, Incorrect grammar, Multi-sentence, Poor wording, Semantically duplicated, Source inaccessible, Trailing period, Unsourced, Wordy. Only Context-dependent is judged in the MVP; the other twelve rows are there so the rulebook is complete and the next tag is a switch, not a rebuild.

**Who fills what:** setup copies the 13 rows once; the team may edit any column by hand; the agent writes exactly one column, When to use, and only after a safety check PASS or a confirmed restore to an earlier edition. A hand edit to the When to use of a tag that has rules stops every command until the text is put back.

### Columns

| Column | Type | Who fills it | Meaning |
|---|---|---|---|
| Name | title | setup, then the team | The tag's name; one row per tag. |
| Category | select | setup, then the team | The tag's group. Values: Nature, Form, Quality, Style, Tone, Format, Meaning, Usage, Check |
| Counterpart | text | setup, then the team | The opposite tag it pairs with (Self-contained for Context-dependent). |
| Description | text | setup, then the team | One or two sentences describing a claim that carries the tag. |
| Evidence | link | setup, then the team | The report the tag's verification rests on. |
| Example Claims | text | setup, then the team | Claims that show the tag, one per line. |
| Geo Status | select | setup, then the team | Whether the tag exists in Geo. Values: Existing in Geo, To be created, Implemented differently |
| Geo Tag ID | text | setup, then the team | The tag's id in Geo. |
| Polarity | select | setup, then the team | Kept as in the taxonomy; the agent does not use it. Values: Classification, Positive, Issue |
| Status | select | setup, then the team | Whether the tag is verified. Values: Verified, Proposed |
| Verified on | date | setup, then the team | When the tag was verified. |
| When to use | text | setup, then the team; the agent only after a safety check PASS or a confirmed restore | The numbered rules the agent applies; a tag is judged only when this holds rules. |
| Work tags | multi-select | setup, then the team | The work the tag belongs to; every row here has Issue. Values: Pipeline benchmark check, Issue |
| Created | created time | Notion | When the row was made. |
| Created by | created by | Notion | Who made the row. |
| Last edited | last edited time | Notion | When the row last changed. |
| Last edited by | last edited by | Notion | Who last changed the row. |

**Left out on purpose:** the taxonomy's two relation columns to the claims tables; a relation must point at a table, and the real tables are protected.

### Sample rows

| Name | Category | Status | When to use |
|---|---|---|---|
| Context-dependent | Quality | Verified | 5 numbered rules; rule 1: "A pronoun with no antecedent inside the claim (…) makes the claim Context-dependent." |
| Source inaccessible | Quality | Verified | Numbered rules for sources that cannot be read |
| Trailing period | Format | Proposed | Empty: no rules yet, so the tag is not judged |

## Claims copy

50 claims copied once from the real table "U.S. Politics debate claims": the 10 claims with Context-dependent decisions in the audit of 9 October, plus 40 picked at random (the pick is recorded).

**Who fills what:** setup copies the rows once, Geo columns only; the agent writes Agent tags and Agent notes and nothing else; the real table is never written.

### Columns

| Column | Type | Who fills it | Meaning |
|---|---|---|---|
| Geo Name | title | setup | The claim text. |
| Geo ID | text | setup | The claim's identity in Geo; the queue's Key starts with it. |
| Geo URL | link | setup | The claim's page in Geo. |
| Geo Sources | text | setup | The claim's sources, as Geo lists them. |
| Geo Tags | multi-select | setup | The claim's tags in Geo. Values: Debate, Democracy & Media, Economy, Featured, Immigration, Main claim, Politics, debate claim |
| Geo Topics | text | setup | The claim's topics in Geo. |
| Geo Score | number | setup | The claim's score in Geo. |
| Geo Supporting arguments | text | setup | Arguments for the claim, as in Geo. |
| Geo Opposing arguments | text | setup | Arguments against the claim, as in Geo. |
| Geo Related people | text | setup | People linked to the claim in Geo. |
| Geo Related projects | text | setup | Projects linked to the claim in Geo. |
| Geo Is factual | checkbox | setup | Ticked when Geo marks the claim as factual. |
| Geo Name source | select | setup | Which space the claim's name was taken from. Values: This space, Other space (fallback) |
| Agent tags | text | the agent | The tags that apply and are not waiting for an editor, comma-separated, or empty. |
| Agent notes | text | the agent | At most two short lines: line 1 the tags that apply or "no tags"; line 2 how many tags wait for an editor, what was not checked, and the rulebook edition, joined with " · ". |

**Left out on purpose:** the real table's review columns (Proposed Tags, Proposed Topics, Proposed rename, Review notes, Review status, Challenged tags notes) and its two relations.

### Sample rows

| Geo Name | Agent tags | Agent notes, line 1 | Agent notes, line 2 |
|---|---|---|---|
| Excluding CNN from Air Force One violates the federal court order | Context-dependent | Context-dependent | nothing waits for an editor · edition 2026-10-16.1 |
| Georgia's gubernatorial debate should be moderated by… | empty | no tags | 1 waits for an editor · edition 2026-10-16.1 |
| A contractor's enforcement of safety restrictions constitutes… | empty | no tags | nothing waits for an editor · edition 2026-10-16.1 |

On the Georgia claim the tag waits in the queue, so Agent tags stays empty until the editor decides.

## Tag decisions (the queue)

One row for every answer the agent is unsure about: it answered Can't tell, its readings disagreed, or its probability that the tag applies lies between 0.25 and 0.75. Confident answers get no row.

**Who fills what:** the agent writes the first nine columns; the editor writes the last three, and the agent never does, with one exception: at setup the ten audit decisions are seeded as decided rows, their Your reasoning starting "From the audit of 9 October:".

### Columns

| Column | Type | Who fills it | Meaning |
|---|---|---|---|
| Claim | title | the agent | The claim text. |
| Key | text | the agent | The claim's Geo ID, two colons, the tag; one row per claim and tag. |
| Tag | select | the agent | The tag the row is about. Values: the 13 tag names of the Rulebook copy |
| Agent proposal | select | the agent | The agent's answer. Values: Applies, Does not apply, Can't tell |
| Agent confidence | number | the agent | How sure the agent is of its answer, from 0.5 (a coin flip) to 1 (certain); the queue is sorted by it, lowest first. |
| Agent reason | text | the agent | At most 40 words, then the rule cited and how many runs agreed. |
| Claim link | link | the agent | Link to the claim's row in the Claims copy. |
| Rulebook edition | text | the agent | The edition the proposal was made under. |
| Follow-up | select | the agent | Set after a safety check PASS, on the rows the change rests on. Values: Fixed, Still wrong |
| Tag outcome | select | the editor | The editor's decision; empty means the row waits. Values: Applies, Does not apply |
| Why wrong | select | the editor | The editor's reason the agent was wrong. Values: Agent slip, Rule unclear, Rule should change |
| Your reasoning | text | the editor | The editor's words; "rule 4" typed here names the rule. |

### Sample rows

| Column | Sample 1 (waits) | Sample 2 (waits) | Sample 3 (decided at setup) |
|---|---|---|---|
| Claim | Georgia's gubernatorial debate should be moderated by… | The focus on the COVID-19 vaccine ignored the larger public… | Melania Trump should not host her initiative's… |
| Key | 8f9c833b…::Context-dependent | 78dd7750…::Context-dependent | e3c28f62…::Context-dependent |
| Tag | Context-dependent | Context-dependent | Context-dependent |
| Agent proposal | Can't tell | Can't tell | Does not apply |
| Agent confidence | 0.55 | 0.55 | empty (the audit gave none) |
| Agent reason | "Georgia's gubernatorial debate" may be one debate that no date or name identifies, or debates in general. Rule 4 · 2 of 3 runs agree | "The larger public health problem" may be one problem the claim does not name, or a general one. Rule 4 · 2 of 3 runs agree | empty |
| Claim link | link to its row | link to its row | link to its row |
| Rulebook edition | 2026-10-16.1 | 2026-10-16.1 | empty (decided before the first edition) |
| Follow-up | empty | empty | empty |
| Tag outcome | empty: the row waits | empty: the row waits | Applies |
| Why wrong | empty | empty | Agent slip |
| Your reasoning | empty | empty | From the audit of 9 October: the full context isn't in the claim; it leaves the reader thinking "What's the initiative?" |

On a seeded row, Agent proposal records what the agent had said before the audit (here no tag, so Does not apply); confidence, reason and edition stay empty because the audit recorded none. In the real queue the Georgia and COVID-19 rows also arrive decided from the audit; they are shown waiting here because they are the two open rows of every practice page.

## Rule changes

One row per proposed change to one rule.

**Who fills what:** the agent creates a row with Status Proposed; the editor approves or rejects it, optionally with Editor wording; after a safety check PASS the agent sets Live and writes the new text into the Rulebook copy; a rollback sets Rolled back and restores the earlier text.

### Columns

| Column | Type | Who fills it | Meaning |
|---|---|---|---|
| Lesson | title | the agent | A short name for the change. |
| Tag | select | the agent | The tag the change is about. Values: the 13 tag names of the Rulebook copy |
| Rule | text | the agent | Which rule, for example "Context-dependent rule 3". |
| Kind | select | the agent | What kind of change. Values: Clarify wording, Change the rule, Initial rules |
| Current text | text | the agent | The rule's text now. |
| Proposed text | text | the agent | The text the agent proposes. |
| Safety check result | text | the agent | For example "PASS: examples 11/11, earlier 10/10, yours 2/2" or "FAIL: 'Excluding CNN from Air Force One violates the federal court order' now Does not apply". |
| Supporting rows | text | the agent | One line per decided row the change rests on: the claim shortened, " · ", the row's Key. |
| Editor wording | text | the editor | The rule as the editor words it; when filled, the safety check tests it instead of the Proposed text. Never written by the agent. |
| Status | select | the editor and the agent | The editor sets Approved and Rejected; the agent sets Proposed, Live and Rolled back. Values: Proposed, Approved, Rejected, Live, Rolled back |

### Sample rows

One change at three moments. It rests on the two waiting rows above, once the editor has decided them (Does not apply, Rule unclear, a note on rule 4).

| Column | Value at every moment |
|---|---|
| Lesson | Rule 4: general references need no answer |
| Tag | Context-dependent |
| Rule | Context-dependent rule 4 |
| Kind | Clarify wording |
| Current text | Test: could a reader who sees only this sentence say which specific thing each definite reference points at? If any answer is no, tag Context-dependent. |
| Proposed text | Test: … points at? A reference that reads as general needs no answer. If any other answer is no, tag Context-dependent. |
| Supporting rows | line 1: Georgia's gubernatorial debate should be moderated by… · 8f9c833b…::Context-dependent; line 2: The focus on the COVID-19 vaccine ignored the larger public… · 78dd7750…::Context-dependent |

| Column | 1. Proposed | 2. Approved, then FAIL | 3. Editor wording added, then PASS |
|---|---|---|---|
| Safety check result | empty | FAIL: 'Excluding CNN from Air Force One violates the federal court order' now Does not apply | PASS: examples 11/11, earlier 10/10, yours 2/2 |
| Editor wording | empty | empty | Test: … points at? A general reference ("the larger public health problem") needs no answer; an unnamed order or event ("the federal court order") does. … |
| Status | Proposed | Approved | Live |

After the FAIL nothing in the rulebook changed, and the report proposed one sentence for Editor wording. After the PASS the editor's wording is rule 4 in the Rulebook copy, the edition goes to 2026-10-16.2, and the follow-up marks both supporting rows Fixed.

## Agent settings

One row, named "Claim tagger".

**Who fills what:** setup creates the row; a person ticks and clears Paused; the agent writes Rulebook edition and Last run summary.

### Columns

| Column | Type | Who fills it | Meaning |
|---|---|---|---|
| Name | title | setup | The row's name, Claim tagger. |
| Paused | checkbox | a person | Ticked by a person, every command then refuses; cleared by a person. |
| Rulebook edition | text | the agent | The edition in force: a date plus a count, such as 2026-10-16.1; it goes up when a rule changes. |
| Last run summary | text | the agent | One short line, such as "Promote · 16 Oct 11:20 · PASS". |

### Sample rows

The one row at three moments: after a FAIL (the edition stays), after a PASS (it goes up), and after a person ticks Paused.

| Name | Paused | Rulebook edition | Last run summary |
|---|---|---|---|
| Claim tagger | not ticked | 2026-10-16.1 | Promote · 16 Oct 11:05 · FAIL |
| Claim tagger | not ticked | 2026-10-16.2 | Promote · 16 Oct 11:20 · PASS |
| Claim tagger | ticked | 2026-10-16.2 | Promote · 16 Oct 11:20 · PASS |

## Views

Every practice page uses the same four view names.

| View | Table | Rows shown | Sorted by | Columns shown |
|---|---|---|---|---|
| Your queue | Tag decisions | Tag outcome is empty | Agent confidence, lowest first | Claim, Agent proposal, Agent reason, Tag outcome, Why wrong, Your reasoning |
| Needs your note | Tag decisions | Why wrong is Rule unclear or Rule should change, and Your reasoning is empty | Agent confidence, lowest first | Claim, Tag outcome, Why wrong, Your reasoning |
| Lessons waiting | Rule changes | Status is Proposed or Approved | none | Lesson, Current text, Proposed text, Status; cells wrap, so both texts are read in place |
| Rulebook | Rulebook copy | all rows | none | Name, Category, Status, When to use, Example Claims; cells wrap |

## Words

- **Table**: a Notion table of rows and columns; this page holds five.
- **Queue**: the Tag decisions table: the answers the agent is unsure about, for the editor to decide; Your queue shows the ones that wait.
- **Rulebook**: the numbered rules for each tag, kept in When to use in the Rulebook copy; it changes only after a safety check PASS or a restore.
- **Edition**: the rulebook's version, a date plus a count (2026-10-16.1); it goes up when a rule changes.
- **Safety check**: the test a rule change must pass before it is used: the example claims, the earlier decisions and the change's own rows (yours) must all come out right.
- **Practice page**: a page under Demos where an editor runs the whole cycle once on sample claims, without touching anything real.
- **Agent proposal**: the agent's answer for one claim and one tag: Applies, Does not apply or Can't tell.
- **Tag outcome**: the editor's decision on a row; it always wins over the agent's answer.
- **Why wrong**: the editor's reason: Agent slip (the rule is fine, no change), Rule unclear (the agent drafts a clearer rule), Rule should change (the agent drafts a changed rule).
- **Follow-up**: after a PASS, the agent re-checks the rows the change rests on and marks each Fixed or Still wrong.

**Open points:** the relation columns of both copies are left out; the real claims table's six review columns are left out; only Context-dependent is judged, and the other twelve tags wait in the rulebook.
