# Structure of Claim tagger v2 (in preparation)

Draft of 29 October 2026, for the product owner's checkpoint 1; revised 30 October with the owner's answers (P45, P46). This page describes a second, separate Notion page, "Claim tagger v2 (in preparation)", made under the live hub "Claim tagger" and empty at first. Editors decide per claim and tag on it, one row each, instead of per claim. The live page and its tables are not touched; claims are still decided there until the product owner says otherwise.

`setup.mjs structure --from-proposal docs/mvp-2026-11/STRUCTURE-V2.md` reads the five table sections, the Views section and the Sub-pages list below. What the proposal format cannot say (the relation columns, the tables' names and one-line descriptions, each table's own first tab, the page body) is in the last section, "Completion for setup/structure.json", as a block to merge in by hand, as was done for the live page.

## Why

Today an editor decides a claim as a whole on the Claims table: Verified tags, Review status, Challenged tags notes. With one judged tag (Context-dependent) that works. When a second tag gets rules, every claim already Reviewed says "Does not apply" for the new tag without anyone having looked at it (decision P16): decisions nobody made, disagreements that are not real, and old notes with no tag name read against the wrong tag. On v2 the decision is made where the agent's answer is, one row per claim and tag, so a new tag starts with nothing decided.

## What differs from the live page

- **One row per claim and tag is where you decide.** Tag decisions is no longer a read-only copy: you set Tag outcome (Applies or Does not apply) and, if you want, Your note on each row. The agent still writes every other column of it.
- **Claims has no decision columns.** Verified tags, Review status and Challenged tags notes are gone; Claims keeps the Geo columns and the agent's eight summary columns, and is read, not filled in.
- **Your queue, Needs your note and Agent disagreed move to Tag decisions** and list rows (a claim and one tag), not claims, with a claim's rows together. A decided row leaves Your queue at once.
- **Agent is right**: a tick on a row says the agent's answer is your decision, so a row you agree with takes one click.
- **Agent status is on every row** of Tag decisions as well as on the claim: Waits for you, Done, Disagrees with your decision, Could not read.
- **You never name a reason or a rule.** Your note is plain language; the agent works out what went wrong (Agent slip, Rule unclear, Rule should change) and which rule it concerns. There is no Why wrong select, no reason word, no Your reasoning.
- **A claim and its rows link both ways**: Open claim on a row, Tag decisions on the claim. No Claim link column.
- **Not carried from the live page**: QA's To review, and the columns Proposed fix, Reviewer and Filter tags that were added to live Claims.
- **A new tag starts empty.** A claim decided on Context-dependent has no decision on the next tag until someone makes one; P16's "left out means Does not apply" no longer applies.
- **The page holds no Onboarding and no archive.** Its body is one line saying it is in preparation, then the links and the five tables.
- **Rulebook, Rule changes and Agent settings are the same as live**, column for column.

Sub-pages:

- **Claim tagger v2 (in preparation)**: this page; it holds the five tables and nothing else.
- **Onboarding**: listed only because the proposal format needs one sub-page; the completion below sets the page list to empty, so v2 has no sub-page.

## Rulebook copy (Rulebook on the page)

The rows of the taxonomy table "Claim Tags — verified" whose Work tags contain Issue, with the same column names and types: Context-dependent, Exact duplicate, Factually challenged, Improper capitalization, Improperly sourced, Incorrect grammar, Multi-sentence, Poor wording, Semantically duplicated, Source inaccessible, Trailing period, Unsourced, Wordy. Identical to the live Rulebook.

**Who fills what:** as live. Setup copies the rows; the team may edit any column by hand; the agent writes only When to use, after a safety check PASS or a confirmed restore.

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

## Claims copy (Claims on the page)

The claims read from Geo, with the agent's summary of each claim. Nobody decides here: the decisions are on Tag decisions, one row per claim and tag.

**Who fills what:** setup and `add` write the Geo columns (P12, P35); the agent writes its eight columns; nobody else writes anything. The relation columns Agent tags and Tags waiting (to the Rulebook) are as live and are in the completion below, as is Tag decisions, the claim's rows: the other side of the two-way relation Open claim, kept by Notion.

### Columns

| Column | Type | Who fills it | Meaning |
|---|---|---|---|
| Geo Name | title | setup | The claim text. |
| Agent confidence | number | the agent | How sure the agent is: the lowest confidence among the tags it judged on the claim, from 0.5 (a coin flip) to 1 (certain). |
| Agent reasons | text | the agent | Why the agent proposed what it did: one line per judged tag, "<Tag>: <reason> · <rule cited> · <k> of <n> runs agree". |
| Agent status | select | the agent | What the agent says about the claim as a whole: Waits for you (one of its tags waits in Your queue), Done, Disagrees with your decision (on one of its tags), or Could not read. You decide in Tag decisions, not here. Values: Waits for you, Done, Disagrees with your decision, Could not read |
| Agent edition | text | the agent | The rulebook edition the agent wrote this row under. |
| Agent remarks | text | the agent | What the agent could not check, such as "not checked: 6 tags without rules"; empty when it checked everything. |
| Agent's view of your decision | text | the agent | One line per tag where you differed from the agent: what it made of it (Agent slip, Rule unclear, Rule should change), the rule and why. More on the tag's row. |
| Geo ID | text | setup | The claim's identity in Geo; the Key of its rows in Tag decisions starts with it. |
| Geo URL | link | setup | The claim's page in Geo. |
| Geo Space | select | setup | The Geo space the claim was read from. Values: U.S. Politics, World affairs, AI, Health, Crypto, Technology, Pharma, Industries, Education, Software, Places, Documentation |
| Geo Created | date | setup | The day the claim was made in Geo. |
| Geo Sources | text | setup | The claim's sources, as Geo lists them. |
| Geo Is factual | checkbox | setup | Ticked when Geo marks the claim as factual. |
| Geo Tags | multi-select | setup | The claim's tags in Geo. Values: Debate, Featured, Main claim, Top Debate |
| Geo Topics | text | setup | The claim's topics in Geo. |

The order of the agent's columns is the live one once the two relations are put back in their places (Agent tags after Geo Name, Tags waiting after Agent status); the completion does that. Geo Space and Geo Tags start with the live values; `setup.mjs structure --options-from` and `add` grow them as on the live page.

## Tag decisions

One row per claim and tag the agent judged: the agent's answer, and your decision next to it. The agent makes the row and writes its columns; you write three, Agent is right, Tag outcome and Your note, and nothing else. A row with an empty Tag outcome and no tick is undecided, whatever the agent proposed.

**Who fills what:** the agent writes every column but three and never writes those three. You tick Agent is right or set Tag outcome; Your note is optional. An editor's Claude may set them when the editor asks, as on Claims today (P18 to P20, moved to these columns).

### Columns

| Column | Type | Who fills it | Meaning |
|---|---|---|---|
| Claim | title | the agent | The claim text. |
| Tag | select | the agent | The tag the row is about. Values: the 13 tag names of the Rulebook copy |
| Agent proposal | select | the agent | The agent's answer for this claim and tag. Values: Applies, Does not apply, Can't tell |
| Agent confidence | number | the agent | How sure the agent is of its answer, from 0.5 (a coin flip) to 1 (certain); Your queue is sorted by it, lowest first. |
| Agent reason | text | the agent | At most 40 words, then the rule cited and how many runs agreed. |
| Agent is right | checkbox | you | Tick when you agree with the agent's answer; that is your decision and Tag outcome stays empty. On Can't tell, don't tick: set Tag outcome. Tag outcome wins if both are set. |
| Tag outcome | select | you | Your decision on this claim and tag; it always wins over the agent's answer. Empty, with Agent is right not ticked, means the row waits in Your queue. Values: Applies, Does not apply |
| Your note | text | you | Your words, when you want to say something, such as why the agent's answer is wrong. Plain language; you don't need to name a rule or a reason, the agent works that out. |
| Agent status | select | the agent | What the agent says about this row: Waits for you (it needs your decision), Done, Disagrees with your decision (a later run answered otherwise), or Could not read. Values: Waits for you, Done, Disagrees with your decision, Could not read |
| Agent's view of your decision | select | the agent | What the agent made of your decision where you differed from it: Agent slip (the rules already settle it your way), Rule unclear (they read both ways) or Rule should change (they decide against you). The agent works this out from your decision, your note and the rulebook. Values: Agent slip, Rule unclear, Rule should change |
| Rule | text | the agent | The rule the agent's view points at, for example "Context-dependent rule 3". |
| Why the agent thinks so | text | the agent | One line of why. It opens with "without your note" when you wrote nothing. |
| After the rule change | select | the agent | Empty until a rule change goes live. Then Fixed if the new rule gives your decision on this row, Still wrong if it doesn't. Values: Fixed, Still wrong |
| Key | text | the agent | The claim's Geo ID, two colons, the tag; one row per claim and tag. |
| Rulebook edition | text | the agent | The edition the proposal was made under. |
| Decided under | text | the agent | The edition the proposal you decided on was made under; the agent records it when it first finds your Tag outcome. |
| Read under | text | the agent | The edition and a short mark of what the reading rests on: your decision, your note and the proposal the agent made. The agent reads a row again only when one of those changes. |

The relation Open claim (to Claims, two-way: the claim's side is Tag decisions) is in the completion below, after Claim. The completion also names each renamed column's name on the page built at checkpoint 1 (Claim page, Agent reading, Reading note, Follow-up), so the builder renames those columns instead of adding new ones. Left out on purpose: Why wrong and reason words (the agent works out the reason), Your reasoning (Your note is your own words, not a copy), Claim link (the relation replaces it).

## Rule changes

One row per proposed change to one rule. Identical to the live table.

**Who fills what:** as live. The agent creates a row with Status Proposed; the rule owner sets Approved or Rejected, optionally with Editor wording; after a safety check PASS the agent sets Live; a rollback sets Rolled back.

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

## Agent settings

One row, named "Claim tagger". Identical to the live table.

**Who fills what:** setup creates the row; a person ticks and clears Paused; the agent writes Rulebook edition and Last run summary.

### Columns

| Column | Type | Who fills it | Meaning |
|---|---|---|---|
| Name | title | setup | The row's name, Claim tagger. |
| Paused | checkbox | a person | Ticked by a person, every command then refuses; cleared by a person. |
| Rulebook edition | text | the agent | The edition in force: a date plus a count, such as 2026-10-16.1; it goes up when a rule changes. |
| Last run summary | text | the agent | One short line, such as "Promote · 16 Oct 11:20 · PASS". |

## Views

Every editor view is on Tag decisions and lists rows, a claim and one tag. Cells wrap on the three of them, so the claim and the reason are read in place. Lessons waiting shows what people widened the live view to: the columns the rule owner reads and Editor wording, which they fill (editor review ED-2). Each table's own first tab (All claims on Claims, Rulebook on the Rulebook, and the unnamed first tab of the other three) is set in the completion below.

| View | Table | Rows shown | Sorted by | Columns shown |
|---|---|---|---|---|
| Your queue | Tag decisions | Agent status is Waits for you, and Tag outcome is empty, and (Agent is right is not ticked, or Agent proposal is Can't tell) | Claim, A to Z; then Agent confidence, lowest first | Claim, Tag, Agent proposal, Agent reason, Agent is right, Tag outcome, Your note; cells wrap |
| Needs your note | Tag decisions | Why the agent thinks so contains "without your note" | Claim, A to Z; then Agent confidence, lowest first | Claim, Tag, Agent proposal, Tag outcome, Agent's view of your decision, Why the agent thinks so, Your note; cells wrap |
| Agent disagreed | Tag decisions | Agent status is Disagrees with your decision | Claim, A to Z; then Agent confidence, lowest first | Claim, Tag, Agent is right, Tag outcome, Agent proposal, Agent reason, Your note, Rulebook edition; cells wrap |
| Lessons waiting | Rule changes | Status is Proposed or Approved | none | Lesson, Tag, Rule, Current text, Proposed text, Editor wording, Safety check result, Status; cells wrap |

**Your queue** shows Open claim right after Claim; the table above leaves it out because the relation is added by the completion below, which also sets this view's columns. It reads left to right as the decision is made: the claim, a link to its row in Claims (its sources and Geo link are one click away; editor review ED-1), which tag, what the agent says and why, then your three columns at the right end, so nothing to fill sits between things to read. The three editor views are sorted by claim, so a claim's rows stand together, and within a claim by Agent confidence, lowest first; Agent confidence is not shown. A row leaves Your queue as soon as Tag outcome is set or Agent is right is ticked; Agent status alone would keep it until the agent's next run. A tick on a Can't tell row decides nothing, so that row stays (editor review of 30 Oct). Agent disagreed shows Agent is right, so a row you accepted with a tick does not look undecided there.

**Needs your note** shows what the agent read next to your note, so a missing note can be written with the reading in view. **Agent disagreed** puts your outcome before the agent's new answer, with the edition that answer was made under.

## Words

- **Row**: one claim and one tag on Tag decisions. You decide rows, not claims.
- **Tag outcome**: your decision on a row, Applies or Does not apply; it always wins over the agent's answer. Empty means undecided, even when the agent proposed something.
- **Agent is right**: your tick on a row, saying the agent's answer is your decision.
- **Your note**: your words on a row, in plain language. The agent reads it, with your decision and the rulebook, to work out what went wrong and which rule it concerns.
- **Agent status**: on a row, what the agent says about that row; on Claims, the same for the claim as a whole.

## Open questions

The product owner answered these on 30 October (decisions P45 and P46); the page was changed to match:

- 1: not carried. 2: dropped. 3: a select. 4: the title stays.
- 5: no reason words at all. The editor writes plain language, and the agent works out the reason and the rule.
- 6: two-way, with Tag decisions on Claims.
- 7: by claim, then confidence, on all three editor views.
- 8: renamed as suggested.
- 9: a line under each link.
- 10: a checkbox, Agent is right. It is read as the decision, and the agent never copies it into Tag outcome (P46).

Still open: how many rows a week an editor should expect once more tags are judged.

The questions as they were put:

1. **The three columns people added to live Claims** (Proposed fix, text; Reviewer, select; Filter tags, multi-select) and the widened All claims and Lessons waiting views. They look like the editor's own review practice.
   - Options: (a) on v2 Claims, as on live; (b) on Tag decisions, per row; (c) Proposed fix and Reviewer on Tag decisions, Filter tags on Claims; (d) not carried, until the editor says what they are for.
   - Recommendation: (d) for checkpoint 1, then ask the editor what each is for. Reviewer and Proposed fix read as per-decision, which points to Tag decisions, and Filter tags reads as per-claim; the widened views say the editor wants more of the agent's reasoning in view, which Your queue already shows per row. The editor review (ED-7) reads it as (c): Proposed fix and Filter tags on Claims, Reviewer on Tag decisions, and asks that whoever added them is asked before the structure is confirmed.
2. **QA's "To review"** (a claim marked To review makes every judged tag of it wait).
   - Options: (a) a To review checkbox or select on v2 Claims that the agent reads, as today; (b) per row, by clearing Tag outcome on Tag decisions; (c) dropped.
   - Recommendation: (a), a one-column home on Claims that the agent only reads. It is a claim-level request ("look at this claim again") and is not a decision.
3. **Tag as a select or as a relation to the Rulebook.**
   - Options: (a) a select with the 13 tag names, as live; (b) a relation to the Rulebook, one tag per row.
   - Recommendation: (a) for v2. Views filter on a select by name, the Key already ties the row to the tag, and a relation would need a builder change for little gain while the Rulebook keeps its 13 rows.
4. **The page title.**
   - Options: (a) "Claim tagger v2 (in preparation)"; (b) "Claim tagger v2"; (c) a name for what it will become, given when it goes live.
   - Recommendation: (a) until it is in use. The words "in preparation" keep anyone who finds the page from deciding there; rename it when it replaces the live page.

From the editor review of this draft (editor persona, 29 Oct; ED-1, ED-2 and ED-10 are applied above):

5. **The reason word (ED-3, must).** Today only a reason word in any letter case followed by a full stop counts; "Agent slip:" is read as plain text. Options: (a) a Reason select next to Your note, optional; (b) the note keeps the reason word, with the parser accepting a colon or a dash too and the column description saying so; (c) as now. P4 removed the editor's Why wrong on purpose, so (a) partly reverses it.
6. **Reaching a claim's rows from the claim (ED-4).** Needs the two-way relation (the builder change described under "The relation form").
7. **Your queue order across tags (ED-5).** Sorted by confidence, one claim's rows scatter through the queue. Options: sort by claim and then confidence, or a view grouped by claim.
8. **Names (ED-6).** Suggested: Agent reading → "Agent's view of your decision", Reading note → "Why the agent thinks so", Claim page → "Open claim", Follow-up → "After the rule change". These names are read by code, so a rename is cheap now and costly after checkpoint 3.
9. **A line under each view (ED-8)** saying what to do there, and that a row stays in Needs your note until the next distill.
10. **Rows multiply with tags (ED-9).** With 13 tags, can `/claim-tagger decide` set the agent's answer on rows the editor OKs in bulk, and how many rows a week should an editor expect?

## Completion for setup/structure.json

The proposal format has no relation column, no name for a table other than its section title, no one-line table description, no table's own first tab and no hub block. The block below adds them. Merge rule: `made_from`, `pages`, `sync_descriptions` and `hub` replace the parsed values (`sync_descriptions: true` has the build bring the descriptions of existing tables and columns to the structure's, which the live page's build never does); for each table, `title`, `description` and `default_view` are set, and each entry of `insert_columns` is added as a column (its `options` empty) right after the column named in `after`, keeping its `renamed_from` and `two_way` (the name of the column on the other table that the same two-way relation shows there); then each entry of `renamed_from` gives a column its name on the page built at checkpoint 1; then each entry of `view_columns` replaces the columns of the view it names (the parser checks a view's columns before the relation columns exist, so a view that shows a relation gets its columns here). The result must pass `validateStructure`.

```json
{
  "made_from": "docs/mvp-2026-11/STRUCTURE-V2.md (the v2 page, draft of 29 Oct 2026)",
  "pages": [],
  "sync_descriptions": true,
  "view_columns": {
    "Your queue": ["Claim", "Open claim", "Tag", "Agent proposal", "Agent reason", "Agent is right", "Tag outcome", "Your note"]
  },
  "renamed_from": {
    "tag_decisions": { "Agent's view of your decision": "Agent reading", "Why the agent thinks so": "Reading note", "After the rule change": "Follow-up" },
    "claims": { "Agent's view of your decision": "Agent reading" }
  },
  "hub": {
    "title": "Claim tagger v2",
    "note": "Decide each claim and tag in Tag decisions: tick Agent is right or set Tag outcome. The first page, \"Claim tagger\", is kept for reference.",
    "note_was": ["In preparation and not in use yet: claims are still decided on the Claims table of \"Claim tagger\"."],
    "view_links": ["your_queue", "needs_your_note", "agent_disagreed", "lessons_waiting"],
    "table_order": ["tag_decisions", "claims", "rulebook", "rule_changes", "agent_settings"],
    "pages_after": ["archive"],
    "link_text": {
      "your_queue": "the rows, a claim and one tag, that wait for your decision",
      "needs_your_note": "rows where you overruled the agent and left no note",
      "agent_disagreed": "rows where the agent's newest answer differs from your decision"
    },
    "view_hints": {
      "your_queue": "Agree with the agent? Tick Agent is right. Disagree, or it says Can't tell? Set Tag outcome. The row then leaves this list.",
      "needs_your_note": "You overruled the agent without a note. Say why in Your note, in plain words. The row leaves this list after the agent next reads your notes.",
      "agent_disagreed": "The agent now answers otherwise. If it is right, set Tag outcome to match. If not, say why in Your note.",
      "lessons_waiting": "Rule changes the agent proposes. Set Status to Approved or Rejected. To word the rule yourself, fill Editor wording first."
    }
  },
  "tables": {
    "rulebook": {
      "title": "Rulebook",
      "description": "One row per tag; When to use holds the rules the agent applies. Rules change when you approve a change in Lessons waiting.",
      "default_view": { "name": "Rulebook", "columns": ["Name", "Category", "Status", "When to use", "Example Claims"] }
    },
    "claims": {
      "title": "Claims",
      "description": "Claims read from Geo, with the agent's summary of each. Read only: you decide each claim and tag in Tag decisions.",
      "default_view": { "name": "All claims", "columns": ["Geo Name", "Geo Space", "Agent status", "Agent tags", "Tags waiting", "Tag decisions", "Agent reasons", "Agent's view of your decision", "Geo URL"] },
      "insert_columns": [
        { "after": "Geo Name", "name": "Agent tags", "type": "relation", "relation_to": "rulebook", "description": "The tags that apply, from the Rulebook: the ones you decided Applies in Tag decisions, and the ones the agent applies where nothing waits for you. Tags that wait for you are in Tags waiting instead." },
        { "after": "Agent status", "name": "Tags waiting", "type": "relation", "relation_to": "rulebook", "description": "The tags of this claim that wait for your decision in Your queue, from the Rulebook. Empty when nothing waits." },
        { "after": "Agent's view of your decision", "name": "Tag decisions", "type": "relation", "relation_to": "tag_decisions", "two_way": "Open claim", "description": "This claim's rows in Tag decisions, one per tag the agent judged. Click one to decide it." }
      ]
    },
    "tag_decisions": {
      "title": "Tag decisions",
      "description": "One row per claim and tag the agent judged. Decide here: tick Agent is right or set Tag outcome; add Your note when you have something to say.",
      "default_view": { "columns": ["Claim", "Tag", "Agent proposal", "Agent status", "Agent is right", "Tag outcome", "Your note", "Agent's view of your decision", "After the rule change"] },
      "insert_columns": [
        { "after": "Claim", "name": "Open claim", "type": "relation", "relation_to": "claims", "renamed_from": "Claim page", "two_way": "Tag decisions", "description": "The claim's row in Claims; open it for the claim's sources and its Geo link." }
      ]
    },
    "rule_changes": {
      "title": "Rule changes",
      "description": "Rule changes the agent drafted. The rule owner sets Approved or Rejected.",
      "default_view": { "columns": ["Lesson", "Tag", "Rule", "Status", "Current text", "Proposed text", "Editor wording", "Safety check result"] }
    },
    "agent_settings": {
      "title": "Agent settings",
      "description": "Tick Paused to stop every command; untick to resume.",
      "default_view": { "columns": ["Name", "Paused", "Rulebook edition", "Last run summary"] }
    }
  }
}
```

**The relation form.** Open claim and Tag decisions are the two sides of one two-way relation (Notion's `dual_property`): the agent writes Open claim on a row, and Notion fills Tag decisions on the claim. Both columns name each other in `two_way`. The builder makes the pair from the Tag decisions side, gives the Claims side its name, and turns the one-way Claim page of checkpoint 1 into the pair in place; verify expects the two sides to point at each other. A second relation of its own on Claims would not do: it would be one more column the agent writes on Claims, kept in step by hand.

**Other things the format and the builder do not carry yet** (for the coding step, not for the product owner):

- The parser needs one sub-page, so the Sub-pages list names Onboarding and the completion sets `pages` to empty; `hub.pages_after` must not be empty, so it holds "archive", which the builder skips while no archive page is recorded.
- The parsed table names are the section titles, "Rulebook copy" and "Claims copy"; the completion sets Rulebook and Claims as on live.
- The link text of the hub lines comes from code (`HUB_LINK_TEXT`), which speaks of claims; the hub block's optional `link_text` (added for v2) gives v2's lines the words for rows.
- `OPTION_COLORS.tag_decisions` now carries the Claims colours (yellow, green, red, grey) for the new Agent status of Tag decisions.
- The builder takes its root from `config.notion.parent_page_id`; v2 needs its own config whose parent is the new page, so that nothing is built on the live hub.
- `setup.mjs structure --from-proposal` writes `setup/structure.json` of the agent it runs in. In this checkout that is the live page's structure: it refuses without `--replace` (the live file has `made_from`), and with `--replace` it would overwrite it. Build v2's structure under its own root, never with `--replace` here.
