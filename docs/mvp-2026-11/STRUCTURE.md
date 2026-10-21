# Structure proposal

This page proposes how the claim tagger MVP sits in Notion: five tables, four views and three sub-pages, all under the page "Feedback Distillation MVP". Nothing else is built in Notion until it is approved.

To approve, say go as it stands, or edit this page first and then say go; the build follows the page as you leave it.

Sample rows use real claims from the audit of 9 October, with claims and ids shortened; the values in them are illustrations, not results.

## Revision of 16 October: decisions on the claims table

After the second checkpoint the product owner asked that editors decide tags where they work, on the claims table, as on the real table. The sections from "At a glance" on are the approved proposal of 15 October and stay as history; this section is what was built from 16 October on, and the specification is in the notes (decisions P2, 42 and 43). The revision of 22 October, the next section, retires Why wrong and adds Agent reading; where the two differ, it wins.

**Claims copy** carries seven agent columns and four editor columns (the feedback round of 21 October, decision P3, replaced the two-line Agent notes by columns a view can filter on and made Agent tags a relation). The editor's outcome is the verified relation plus Review status: Reviewed with the tag in the relation means Applies, Reviewed without it means Does not apply, anything else is still open.

| Column | Type | Who fills it | Meaning |
|---|---|---|---|
| Agent tags | relation to the Rulebook copy | the agent | The tags the agent applies and that do not wait for the editor; where the claim is Reviewed, the editor's set. |
| Agent confidence | number | the agent | The lowest confidence among the tags the agent judged on the claim, 0.5 to 1; Your queue sorts by it. |
| Agent reasons | text | the agent | One line per judged tag: the tag, the agent's reason in at most 40 words, the rule cited and how many runs agreed. |
| Agent status | select | the agent | Waits for you, Done, Disagrees with your decision, Could not read. Your queue and Agent disagreed filter on it. |
| Tags waiting | relation to the Rulebook copy | the agent | The tags that wait for the editor: an unsure tag, or every judged tag on a claim marked To review. |
| Agent edition | text | the agent | The rulebook edition the agent's columns were written under. |
| Agent remarks | text | the agent | "not checked: …" when a tag could not be judged; else empty. |
| Verified tags | relation to the Rulebook copy | the editor | The tags the editor confirms on the claim (the real table's "Claim quality tags — verified"; the config maps the name). |
| Review status | select | the editor | To review, Reviewed. A claim is decided once it is Reviewed. |
| Why wrong | select | the editor | Agent slip, Rule unclear, Rule should change: why the agent's tag was wrong; the claim's default reason. |
| Challenged tags notes | text | the editor | The editor's words, one line per tag the editor disagrees on: the tag name, a colon, then optionally a reason word (Agent slip, Rule unclear, Rule should change) and a full stop, then the words. |

The columns appear in this order on every view, the agent's side before the review columns, so that the review needs no horizontal scrolling. The two text columns of the first build, Agent tags and Agent notes, are kept as "Agent tags (old)" and "Agent notes (old)" and hidden.

The agent's side of four sample rows, as the tag run leaves them:

| Geo Name | Agent tags | Agent confidence | Agent status | Tags waiting |
|---|---|---|---|---|
| The press pool was justified in suspending coverage… | empty | 0.75 | Waits for you | Context-dependent |
| The AI Force should enforce binding safety standards | empty | 0.55 | Waits for you | Context-dependent |
| Excluding CNN from Air Force One violates the federal court… | Context-dependent | 0.93 | Done | empty |
| Relocating the Kennedy Center Honors to a sports arena… | empty | 0.92 | Done | empty |

Each row also carries Agent reasons (one line per judged tag, for example `Context-dependent: "the press pool": which one? · rule 3 · 1 of 1 runs agree`), Agent edition (2026-10-16.1) and Agent remarks (empty here).

The editor's side of the same rows, after review:

| Geo Name | Verified tags | Review status | Why wrong | Challenged tags notes |
|---|---|---|---|---|
| The press pool was justified in suspending coverage… | empty | Reviewed | Rule unclear | Context-dependent: rule 3 does not say that a group every reader knows by its role counts as identified; it does. |
| The AI Force should enforce binding safety standards | Context-dependent | Reviewed | Rule unclear | Context-dependent: a capitalised phrase that names no body readers know is still a kind of thing, not which one. |
| Excluding CNN from Air Force One violates the federal court… | Context-dependent | Reviewed | empty | empty |
| Relocating the Kennedy Center Honors to a sports arena… | empty | To review | empty | empty |

**Tag decisions** becomes the agent's ledger: one row per claim and tag the agent judged, written and superseded by the agent only. The columns keep their names; Tag outcome, Why wrong and Your reasoning are copies the agent makes from the claims table once a claim is Reviewed, and a new column Decided under records the edition the editor's decision was made against. Editors do not write to it; the practice page shows it at the bottom with one line of explanation.

| Key | Agent proposal | Agent confidence | Tag outcome | Why wrong | Follow-up |
|---|---|---|---|---|---|
| 5c9d133e…::Context-dependent | Applies | 0.75 | Does not apply | Rule unclear | Fixed |
| 92f57020…::Context-dependent | Can't tell | 0.65 | Applies | Rule unclear | Fixed |
| fc0cb0da…::Context-dependent | Applies | 0.93 | Applies | empty | empty |
| 89fcfb7f…::Context-dependent | Does not apply | 0.92 | empty | empty | empty |

Each row also carries Tag (Context-dependent on every row above), Agent reason, Rulebook edition, Your reasoning (the copied note) and Decided under (2026-10-16.1 on the three decided rows, empty on the open one).

**Views.** The editor's views move to the Claims copy; Lessons waiting and Rulebook stay where they are; the two old views on Tag decisions are renamed with "(ledger)" and kept.

| View | Table | Filter | Sort |
|---|---|---|---|
| Your queue | Claims copy | Agent status is Waits for you (a decided claim stays listed until the agent's next tag run) | Agent confidence, lowest first |
| Needs your note | Claims copy | Why wrong is set, and Challenged tags notes is empty | Agent confidence, lowest first |
| Agent disagreed | Claims copy | Agent status is Disagrees with your decision | Agent confidence, lowest first |
| Lessons waiting | Rule changes | Status is Proposed or Approved | none |
| Rulebook | Rulebook copy | all rows | none |

**Reruns.** A rerun judges only new or changed claims and tags with a new edition. The agent never reopens a Reviewed claim: where its new proposal differs from the editor's set, Agent tags keeps the editor's set and Agent status reads Disagrees with your decision, which the Agent disagreed view lists.

## Revision of 22 October 2026: the agent reads the decisions (decision P4)

Editors no longer fill Why wrong. One value per claim could not say which of several tags was wrong for which reason, and it asked editors to diagnose the agent against a rulebook the agent keeps. From this revision the editor fills three columns on the claims table, Verified tags, Review status and Challenged tags notes, and the agent reads every disagreement itself, tag by tag. It writes what it made of each one in a new column of the claims table, Agent reading, and in four new columns of its ledger. The revision above and the approved proposal below stay as history; where they differ, this section is what is built. The live Claims copy keeps the shape of 21 October until the build of this revision. The specification is in the notes (decisions P4 and 64 to 76).

**What the agent reads.** A disagreement is a tag the agent judged on a Reviewed claim where the editor's outcome (the tag in Verified tags or not) differs from the agent's proposal, on a ledger row not marked Fixed. The agent reads each one as one of three things, names the rule it points at and says why in one line:

- **Agent slip**: the rule as written settles it the editor's way; the agent misread it.
- **Rule unclear**: the rule can honestly be read both ways on this claim.
- **Rule should change**: the rule as written decides against the editor.

A note line that opens with one of these words and a full stop (the reason word) is taken as it stands: the agent asks no model, takes the rule the note names (else the rule it cited itself) and writes "Your note says so.". A disagreement with no note at all is still read, carefully, and marked "without your note"; Needs your note lists it so that the editor can add one. A claim where the agent agreed has nothing to read. The agent reads a row again only when the editor's decision, the note or the reason word changed, or when the agent proposed again under a new edition (a tag run, or the follow-up after a rule change); a rule change alone re-reads nothing, and a row marked Fixed is never read again.

**From readings to rule changes.** The agent drafts a rule change from the rows read Rule unclear or Rule should change, at least two claims on the same rule; Agent slip rows draft nothing and stay earlier decisions. The Kind of the change follows from the readings: Change the rule when any of its rows reads Rule should change, else Clarify wording. The editor still approves or rejects it, and the safety check is unchanged.

**Claims copy** has twelve working columns, in the order of review, the agent's side first. They appear in this order on the table's own view and on the three views of the Claims copy; the Geo columns follow on the table's own view.

| Column | Type | Who fills it | Meaning |
|---|---|---|---|
| Geo Name | title | setup | The claim text. |
| Agent tags | relation to the Rulebook copy | the agent | The tags that apply and do not wait for the editor; where the claim is Reviewed, the editor's set. |
| Agent confidence | number | the agent | The lowest confidence among the tags the agent judged on the claim, 0.5 to 1; Your queue sorts by it. |
| Agent reasons | text | the agent | One line per judged tag: the tag, the agent's reason in at most 40 words, the rule cited and how many runs agreed. |
| Agent status | select | the agent | Waits for you, Done, Disagrees with your decision, Could not read. Your queue and Agent disagreed filter on it. |
| Tags waiting | relation to the Rulebook copy | the agent | The tags that wait for the editor's decision; empty when nothing waits. |
| Agent edition | text | the agent | The rulebook edition the agent's columns were written under. |
| Agent remarks | text | the agent | "not checked: …" when a tag could not be judged; else empty. |
| Agent reading | text | the agent, when distill runs | New. What the agent made of the editor's decision: one line per tag where the two differ, in the shapes below. Empty until the agent has read the claim. |
| Verified tags | relation to the Rulebook copy | the editor | The tags the editor confirms on the claim (the real table's "Claim quality tags — verified"; the config maps the name). |
| Review status | select | the editor | To review, Reviewed. A claim is decided once it is Reviewed. |
| Challenged tags notes | text | the editor | The editor's words, one line per tag the editor disagrees on: the tag name, a colon, then optionally a reason word and a full stop, then the words; "rule 4" names the rule. A tag the editor agrees with needs no line. |

On the live copy the old column Why wrong is kept as "Why wrong (old)", hidden in every view and never written, beside "Agent tags (old)" and "Agent notes (old)"; nothing is deleted. A practice page makes none of the three.

Agent reading holds one line per tag the agent read, in the order of the tag names, or one of the lines that say there is nothing to read. Only the agent writes it, and only when distill runs; it changes when the agent reads the claim again.

| Line in Agent reading | When |
|---|---|
| `Context-dependent: Rule unclear, rule 3 · <one line of why>` | The agent read the decision itself. |
| `Context-dependent: Agent slip, rule 5 · Your note says so.` | The editor's note line opened with a reason word; the agent took it as it stands. |
| `Context-dependent: Agent slip, rule 5, without your note · <one line of why>` | The editor wrote nothing for the tag; the agent read it anyway, and Needs your note lists the claim. |
| `Nothing to read: the agent agreed with you.` | A Reviewed claim where no judged tag differs. |
| `<Tag>: the agent did not judge this tag, so nothing to read.` | A note line names a rulebook tag the agent did not judge on the claim. |
| empty | Not read yet: the claim is not Reviewed, or distill has not run since it was. |

**Tag decisions** (the agent's ledger) gains four columns right after Decided under, all written by the agent when distill runs. Its Why wrong keeps its name and holds only the reason word the editor opened the tag's note line with (or the audit's Agent slip on the seeded rows); Your reasoning keeps the words after it. The columns in order: Claim, Key, Tag, Agent proposal, Agent confidence, Agent reason, Claim link, Rulebook edition, Follow-up, Tag outcome, Why wrong, Your reasoning, Decided under, Agent reading, Rule, Reading note, Read under.

| Column | Type | Who fills it | Meaning |
|---|---|---|---|
| Agent reading | select | the agent | Agent slip, Rule unclear or Rule should change; empty where the agent agreed or has not read the row yet. |
| Rule | text | the agent | The rule the reading points at, for example "Context-dependent rule 3". |
| Reading note | text | the agent | One line of why, at most 25 words. It opens with "without your note" when the editor wrote nothing for the tag, and reads "Your note says so." when the reason word was taken as it stands. |
| Read under | text | the agent | The edition in force at the reading and a short mark of what the reading rests on: the editor's outcome, the agent's proposal, the note line, the reason word and the edition the proposal was made under. The agent reads the row again only when the mark changes. |

Three claims of the practice page's story after the editor's review and a distill run, under edition 2026-10-16.2 (illustrations, not results). The agent had proposed Applies at 0.75 on the press pool claim, Applies at 0.80 on the USPS claim and Does not apply at 0.85 on Georgia's.

| Geo Name | Verified tags | Review status | Challenged tags notes | Agent reading |
|---|---|---|---|---|
| The press pool was justified in suspending coverage… | empty | Reviewed | Context-dependent: rule 3 does not say that a group every reader knows by its role counts as identified; it does. | Context-dependent: Rule unclear, rule 3 · Rule 3 does not say whether a group readers know by its standing role counts as identified. |
| The USPS ballot portal should not launch before the 2026 midterms | empty | Reviewed | Context-dependent: Agent slip. USPS names which portal, so rule 5 already settles it. | Context-dependent: Agent slip, rule 5 · Your note says so. |
| Georgia's gubernatorial debate should be moderated by… | empty | Reviewed | empty | Nothing to read: the agent agreed with you. |

Their rows in the ledger:

| Key | Agent proposal | Tag outcome | Why wrong | Agent reading | Rule |
|---|---|---|---|---|---|
| 5c9d133e…::Context-dependent | Applies | Does not apply | empty | Rule unclear | Context-dependent rule 3 |
| 27ad00b5…::Context-dependent | Applies | Does not apply | Agent slip | Agent slip | Context-dependent rule 5 |
| 8f9c833b…::Context-dependent | Does not apply | Does not apply | empty | empty | empty |

| Key | Your reasoning | Reading note | Read under |
|---|---|---|---|
| 5c9d133e…::Context-dependent | rule 3 does not say that a group every reader knows by its role counts as identified; it does. | Rule 3 does not say whether a group readers know by its standing role counts as identified. | 2026-10-16.2 · 1f3a9c0d |
| 27ad00b5…::Context-dependent | USPS names which portal, so rule 5 already settles it. | Your note says so. | 2026-10-16.2 · 7b20e4a9 |
| 8f9c833b…::Context-dependent | empty | empty | empty |

The press pool row, with another row read Rule unclear on rule 3, is what a clearer rule 3 is drafted from; the USPS row drafts nothing; the Georgia row is an agreement and has no reading.

**Views.** Needs your note now filters on what the agent wrote; the others keep their filters. The three views of the Claims copy show the twelve columns above in that order and hide the rest; the two ledger views show the four reading columns after Your reasoning. Lessons waiting and Rulebook are unchanged.

| View | Table | Filter | Sort |
|---|---|---|---|
| Your queue | Claims copy | Agent status is Waits for you (a decided claim stays listed until the agent's next tag run) | Agent confidence, lowest first |
| Needs your note | Claims copy | Agent reading contains "without your note" | Agent confidence, lowest first |
| Agent disagreed | Claims copy | Agent status is Disagrees with your decision | Agent confidence, lowest first |
| Your queue (ledger) | Tag decisions | the rows with an empty Tag outcome, unchanged | Agent confidence, lowest first |
| Needs your note (ledger) | Tag decisions | Reading note contains "without your note" | Agent confidence, lowest first |

Needs your note lists a claim once distill has written its Agent reading, while the status report counts a claim without a note at once, in its row Your decisions; that row shows what the agent still has to do with the decisions made, for example "3 to read, 1 without a note", and is left out when there is nothing to say.

**The practice page** of 22 October has nine claims: five decided earlier, whose ledger rows are created already read as Agent slip so that the agent reads only the editor's own decisions, and four open on Context-dependent. The press pool and AI Force claims are read Rule unclear on rule 3 and the rule change rests on them; the USPS ballot portal carries a note that opens with the reason word Agent slip and is taken as it stands; on Georgia's gubernatorial debate the editor agrees with the agent and there is nothing to read. Step 4 is where the agent reads the decisions and drafts a clearer rule 3. In Help, the table that explained Why wrong becomes a table of Agent reading and what each reading makes happen (Agent slip, Rule unclear, Rule should change, nothing to read), with one sentence on the reason word. The step texts are those of the practice page's manifest of 22 October (2026-10-22.1).

**Words** added by this revision:

- **Agent reading**: what the agent made of an editor's decision where the two differ, per tag: Agent slip (the rule settles it the editor's way; the agent misread), Rule unclear (the rule reads both ways on this claim) or Rule should change (the rule decides against the editor), with the rule it points at and one line of why. Written only by the agent, when distill runs, on the claim and in the ledger.
- **Reason word**: Agent slip, Rule unclear or Rule should change, with a full stop, at the start of a tag's line in Challenged tags notes. The agent takes it as its reading for that tag without asking a model; removing it hands the reading back to the agent.

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
- **Why wrong**: retired on 22 October. It was the editor's reason: Agent slip (the rule is fine, no change), Rule unclear (the agent drafts a clearer rule), Rule should change (the agent drafts a changed rule). The agent now reads each disagreement itself and writes the same three words in Agent reading; an editor who wants to give the reason opens the tag's line in Challenged tags notes with it as a reason word. On the live copy the column is kept hidden as "Why wrong (old)"; in the ledger, Why wrong holds only the reason word.
- **Follow-up**: after a PASS, the agent re-checks the rows the change rests on and marks each Fixed or Still wrong.

**Open points:** the relation columns of both copies are left out; the real claims table's six review columns are left out; only Context-dependent is judged, and the other twelve tags wait in the rulebook.
