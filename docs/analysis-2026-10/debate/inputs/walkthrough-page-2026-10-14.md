# Walkthrough page export (Notion, fetched 2026-10-14)

The current editor walkthrough page as it stands today, exported for the editor-persona review. Source: Notion page 3f9273e214eb81c2a075fd94e339d40e (Walkthrough, inside Editorial feedback loop). Inline database blocks are shown as <database> markers.


<callout icon="🧭" color="blue_bg">
  **A practice copy of the editorial feedback loop.** This page has its own 13 claims, its own small rulebook and its own six tables. Nothing you do here changes the real trial on the page above, and nothing is written to Geo.
  **How to use this page:** read part 1 (the ideas, 5 minutes), look around part 2 (the tables you will work with), then follow part 3 step by step (about 40 minutes). Headings with a ▸ arrow open and close. For wide tables, turn on **⋯ → Full width** (top right of the page).
</callout>
<table_of_contents/>
## 1. The ideas behind it {toggle="true"}
  ### What problem this solves {toggle="true"}
    Geo stores short statements called **claims**, for example *"Texas is on track to become a competitive swing state"*. Every claim gets labels, called **tags**, that say what kind of statement it is.
    An AI assistant (Claude, called **the agent** on this page) suggests the tags. It makes mistakes. When an editor corrects it, we want two things:
    - the correction is **never lost**: the agent must get that claim right from then on;
    - if the mistake came from **a badly worded rule**, the rule gets fixed, but **only after a person approves it and a safety check proves it does not break anything else**.
    This page lets you go through that whole cycle once, yourself.
  ### Claims and tags {toggle="true"}
    The team uses about 14 tags. This walkthrough uses only two, both about statements on the future:
    <table header-row="true">
<tr>
<td>Tag</td>
<td>Means</td>
<td>Example</td>
</tr>
<tr>
<td>**Predictive**</td>
<td>The claim forecasts what will actually happen</td>
<td>"The 2026 midterm elections will result in a Democratic wave"</td>
</tr>
<tr>
<td>**Hypothetical**</td>
<td>The claim says what could or would happen in an imagined situation</td>
<td>"Mass deportation could be destabilizing for industries in the short term"</td>
</tr>
    </table>
    Both tags mark a claim that is **not a settled fact**, so the claim needs care before anyone relies on it. That is why getting these tags right matters.
  ### The rulebook {toggle="true"}
    Each tag has a short list of numbered rules saying when to use it. The agent must follow them to the letter and say which rule it used. These are Predictive's rules, in plain words:
    <table header-row="true">
<tr>
<td>Rule</td>
<td>What it says</td>
<td>Example</td>
</tr>
<tr>
<td>**1**</td>
<td>Use Predictive when the claim uses a future word: will, is expected to, is forecast to, is projected to, is set to, **is likely to**</td>
<td>"Bitcoin **will** reach \$200,000 next year" → Predictive</td>
</tr>
<tr>
<td>2</td>
<td>Only for a plain forecast. If it is wrapped in an "if…" or "under the proposed…" situation, it is Hypothetical instead</td>
<td>"**Under the proposed agreement**, holders **will** keep nothing" → Hypothetical</td>
</tr>
<tr>
<td>3</td>
<td>Not when someone else is quoted making the forecast</td>
<td>"**Analysts expect** a recession" → neither tag</td>
</tr>
<tr>
<td>4</td>
<td>Not for "could" or "may"; that is Hypothetical</td>
<td>"Platforms **could** compete" → Hypothetical</td>
</tr>
<tr>
<td>5</td>
<td>Not for something already scheduled or fixed by law</td>
<td>"He **is scheduled to** be sentenced on 8 December" → neither tag</td>
</tr>
<tr>
<td>6</td>
<td>A forecast can carry other tags at the same time</td>
<td>—</td>
</tr>
    </table>
    The rulebook has an **edition number**: a date plus a count, here **2026-10-14.1**. When a rule changes, the edition goes up (2026-10-14.2). The rulebook is the only thing that changes when the agent "learns".
  ### How the agent works {toggle="true"}
    The agent reads every claim **three times** against the rulebook and goes with the majority answer.
    - If all three readings agree and it is sure, it records the tags itself.
    - If the readings disagree, it is unsure, or the claim was flagged, it **asks an editor** instead of guessing: it puts a row in the editors' queue.
    Your answer always wins. The agent never changes a decision an editor made.
    The agent does its reading on the engineer's computer, not inside Notion. Notion only changes when the agent has finished a step: it then writes all its results at once and reads Notion back to check every value landed.
  ### How a correction travels {toggle="true"}
    ```mermaid
flowchart TD
  A["The agent reads the claims"] --> B["You decide the claims it is unsure about"]
  B --> C["Your decision becomes a permanent check"]
  B --> D["If you say the rule is wrong, the agent drafts a better rule"]
  D --> E["The rule owner approves or rejects the draft"]
  E --> F["Safety check: old rule against new rule on every decided claim"]
  F -->|passes| G["The new rule is used from now on; the agent re-reads your claims"]
  F -->|does not pass| H["Nothing changes; the rule owner rewords or drops it"]
    ```
    - A **permanent check** is a decided claim the agent must keep getting right. Every future rule change is tested against all of them.
    - The **rule owner** is the one person who decides what the rules say.
    - The **safety check** reads the decided claims with both the old and the new rule and compares. If the new rule gets even one of them wrong, the change is refused.
  ### The story of this walkthrough {toggle="true"}
    Rule 1 treats **"is likely to"** exactly like **"will"**. So it also catches claims that are not really forecasts. Four of them are waiting for you:
    <table header-row="true">
<tr>
<td>Claim</td>
<td>What it really is</td>
</tr>
<tr>
<td>"The Supreme Court **is likely to** expand executive power further in the future"</td>
<td>A judgement about the Court's habits, checkable against its record</td>
</tr>
<tr>
<td>"The Supreme Court **is likely to** uphold executive actions that exceed the authority granted by Congress"</td>
<td>The same: how the Court tends to rule</td>
</tr>
<tr>
<td>"Texas **is on track to** become a competitive swing state"</td>
<td>A description of where things are heading now</td>
</tr>
<tr>
<td>"Military pressure **is more likely than** diplomatic restraint to produce an Iran settlement"</td>
<td>A comparison of two approaches; it does not say either will happen</td>
</tr>
    </table>
    Following rule 1, the agent will tag them Predictive. You will decide they are not, say **the rule should change**, approve a better rule as rule owner, and watch whether the safety check lets it through.
## 2. The sandbox tables
Everything in this walkthrough lives in six tables. They have the same columns as the real trial's tables, just fewer rows. Each one is shown in full below, with what it is for, what is in it at the start, and a **Column guide** you can open. You can also hover over the **ⓘ** next to any column name to read what it means.
<table header-row="true">
<tr>
<td>Table</td>
<td>One row is</td>
<td>At the start</td>
<td>Who writes in it</td>
</tr>
<tr>
<td>**Claims**</td>
<td>One claim</td>
<td>13 rows</td>
<td>The agent (you only read it)</td>
</tr>
<tr>
<td>**Tag decisions**</td>
<td>One claim + one tag that needs or got a person's decision</td>
<td>13 rows: 9 already decided, 4 waiting for you</td>
<td>**You** (three columns) and the agent</td>
</tr>
<tr>
<td>**Rulebook**</td>
<td>One tag and its rules</td>
<td>2 rows: Hypothetical, Predictive</td>
<td>The agent, only after a rule change passes the safety check</td>
</tr>
<tr>
<td>**Rule changes**</td>
<td>One proposed change to a rule</td>
<td>Empty</td>
<td>The agent drafts; **the rule owner** approves or rejects</td>
</tr>
<tr>
<td>**Runs**</td>
<td>One thing the agent did (read claims, draft a rule, safety check, re-check)</td>
<td>Empty</td>
<td>The agent</td>
</tr>
<tr>
<td>**Agent settings**</td>
<td>The agent's switches</td>
<td>1 row</td>
<td>Anyone may tick **Paused**; the agent fills the rest</td>
</tr>
</table>
### 2.1 Claims
**What it is for.** The list of claims and the tags on each one right now.
**At the start.** 13 claims. **Decided applies** already shows a tag for 9 of them, because editors decided those earlier in the trial (6 are Predictive, 3 are Hypothetical). The other 4 are your claims: nobody has decided them yet, so that column is empty for them. **Agent tags**, **Readiness**, **Tag confidence** and **Last judged** are empty until the agent first reads the claims in step 2.
<details>
<summary>Column guide: Claims</summary>
  <table header-row="true">
<tr>
<td>Column</td>
<td>What it means</td>
<td>Filled by</td>
</tr>
<tr>
<td>Claim title</td>
<td>The claim, word for word</td>
<td>Copied from Geo</td>
</tr>
<tr>
<td>Decided applies</td>
<td>**The people's verdict, part 1:** tags an editor confirmed DO belong on the claim. Read it next to Agent tags (the agent's verdict) to compare the two on one row</td>
<td>Automatic, from Tag decisions</td>
</tr>
<tr>
<td>Decided does not apply</td>
<td>**The people's verdict, part 2:** tags an editor ruled OUT for the claim, even if the agent suggested them. After step 3 it shows Predictive on your 4 claims</td>
<td>Automatic, from Tag decisions</td>
</tr>
<tr>
<td>Agent tags</td>
<td>The tags the claim carries now; where an editor decided, the decision counts</td>
<td>Agent</td>
</tr>
<tr>
<td>Readiness</td>
<td>Needs editor (a tag waits for a person), Fix needed (an issue tag such as Predictive applies), Ready (nothing to do)</td>
<td>Agent</td>
</tr>
<tr>
<td>Tag confidence</td>
<td>For each tag: what the agent concluded, how sure it was, which rule it used</td>
<td>Agent</td>
</tr>
<tr>
<td>Last judged</td>
<td>Which rulebook edition the agent last read the claim with</td>
<td>Agent</td>
</tr>
<tr>
<td>Tag decisions</td>
<td>Links to this claim's decision rows</td>
<td>Automatic</td>
</tr>
<tr>
<td>Sample, Table, Sources count, Source URLs, Geo link, Geo ID</td>
<td>Where the claim comes from in Geo. You can ignore these</td>
<td>Copied from Geo</td>
</tr>
  </table>
</details>
<database url="https://app.notion.com/p/3f9273e214eb812aae1fc36aa65695df" inline="true" data-source-url="collection://755397bf-906c-4d60-9f05-fcd46f67c22d"></database>
### 2.2 Tag decisions
**What it is for.** Where people decide. One row = one claim + one tag. This is the table you work in.
**At the start.** 13 rows. **9 rows** were decided earlier in the trial: their **Seeded outcome** is *Applies* and their **Stage** is *Regression case*, meaning they are permanent checks. They show **Agent proposal** *Do not add tag* and **Direction** *Missed*: that is what an older version of the agent answered in the trial's 9 October audit, before an editor corrected it. That correction is exactly why they are permanent checks now, and the agent never rewrites a decided row. **4 rows** are yours: **Stage** *To review*, **Why in queue** *Auditor flag* (picked out for this walkthrough), **Priority** *High*, and the agent's columns are empty because the agent has not read the claims yet.
**You only ever type in three columns: Tag outcome, Why wrong, Your reasoning** (plus the optional Decided by and Decided at).
<details>
<summary>Column guide: Tag decisions</summary>
  <table header-row="true">
<tr>
<td>Column</td>
<td>What it means</td>
<td>Filled by</td>
</tr>
<tr>
<td>Claim text, Tag name</td>
<td>The claim and the tag this row is about</td>
<td>Automatic</td>
</tr>
<tr>
<td>Stage</td>
<td>Where the row is: To review (waiting for you), Decided, Lesson proposed (a rule change built on it waits for the rule owner), Regression case (a permanent check), Closed (agreed, or fixed)</td>
<td>Automatic</td>
</tr>
<tr>
<td>Agent proposal, Agent confidence, Why I recommend this</td>
<td>What the agent thinks, how sure it is (0 to 1), and its reason, usually naming a rule</td>
<td>Agent</td>
</tr>
<tr>
<td>Why in queue, Priority</td>
<td>Why a person is asked, and which rows to look at first</td>
<td>Agent</td>
</tr>
<tr>
<td>**Tag outcome**</td>
<td>Your decision: Applies, Does not apply, Needs evidence, Ask another editor</td>
<td>**You**</td>
</tr>
<tr>
<td>**Why wrong**</td>
<td>Only when you disagree: Agent slip, Rule unclear, Rule should change, No tag fits, Other</td>
<td>**You**</td>
</tr>
<tr>
<td>**Your reasoning**</td>
<td>One sentence: what the rule should have said</td>
<td>**You**</td>
</tr>
<tr>
<td>Decided by, Decided at</td>
<td>Who decided and when (optional)</td>
<td>You</td>
</tr>
<tr>
<td>Seeded outcome, Seeded reasoning, Seeded at</td>
<td>A decision an editor made earlier in the trial. Your Tag outcome would override it</td>
<td>Copied at the start</td>
</tr>
<tr>
<td>Effective outcome</td>
<td>The decision that counts: yours, or else the earlier one</td>
<td>Automatic</td>
</tr>
<tr>
<td>Direction</td>
<td>Was the agent right? Agent right, Missed, Wrongly applied, Open</td>
<td>Automatic</td>
</tr>
<tr>
<td>Lesson, Lesson status</td>
<td>The proposed rule change built on this decision, and its status</td>
<td>Agent / automatic</td>
</tr>
<tr>
<td>In regression suite</td>
<td>The date this decision became a permanent check</td>
<td>Agent</td>
</tr>
<tr>
<td>Agent follow-up, Follow-up run</td>
<td>After a rule change: Fixed (the agent now agrees with you) or Still wrong</td>
<td>Agent</td>
</tr>
<tr>
<td>Rubric version, Agent full note, Applied tag, Rejected tag, Claim, Tag, Key</td>
<td>Background details. You can ignore these</td>
<td>Agent / automatic</td>
</tr>
  </table>
</details>
<database url="https://app.notion.com/p/3f9273e214eb81e081b7c38af6bfd12e" inline="true" data-source-url="collection://ab0b0930-3d8f-4ce7-9491-904b25272f27"></database>
### 2.3 Rulebook
**What it is for.** The rules the agent follows, one row per tag.
**At the start.** 2 rows, Hypothetical and Predictive, at edition **2026-10-14.1**. **Changed by** is empty: no rule has changed yet.
<details>
<summary>Column guide: Rulebook</summary>
  <table header-row="true">
<tr>
<td>Column</td>
<td>What it means</td>
<td>Filled by</td>
</tr>
<tr>
<td>Tag title, Description</td>
<td>The tag's name and what it means</td>
<td>Copied from the team's tag list</td>
</tr>
<tr>
<td>**When to use**</td>
<td>The numbered rules. Changes only after a rule change passes the safety check</td>
<td>Agent</td>
</tr>
<tr>
<td>Example claims</td>
<td>Textbook examples the agent must always get right</td>
<td>Copied</td>
</tr>
<tr>
<td>Rule version, Changed by</td>
<td>The edition in which this tag last changed, and the rule change that did it</td>
<td>Agent</td>
</tr>
<tr>
<td>Status, Category, Polarity, Counterpart, Judged, Human only, Tag hash</td>
<td>Background details about the tag. You can ignore these</td>
<td>Copied / agent</td>
</tr>
  </table>
</details>
<database url="https://app.notion.com/p/3f9273e214eb81fcabe1eee3c689b3a7" inline="true" data-source-url="collection://4ad48d6f-cc91-417e-b780-5db4bcd0d1a6"></database>
### 2.4 Rule changes
**What it is for.** Proposed changes to a rule (the trial calls them *lessons*), and where each one stands.
**At the start.** Empty. The agent adds a row in step 4.
<details>
<summary>Column guide: Rule changes</summary>
  <table header-row="true">
<tr>
<td>Column</td>
<td>What it means</td>
<td>Filled by</td>
</tr>
<tr>
<td>Lesson title, Lesson ID</td>
<td>A short name, and a number Notion gives each proposal automatically: WT-1 for the first, WT-2 for the next. WT stands for *walkthrough*; the real trial numbers its proposals LS-1, LS-2 (LS for *lesson*). You use the number when you ask Claude to test or re-check a change</td>
<td>Agent / automatic</td>
</tr>
<tr>
<td>Status</td>
<td>Proposed → **Approved** or **Rejected** (set by the rule owner) → Live (set by the agent after a passed safety check)</td>
<td>Rule owner / agent</td>
</tr>
<tr>
<td>Owner action</td>
<td>What the rule owner has to do next; empty when nothing is waiting</td>
<td>Automatic</td>
</tr>
<tr>
<td>Tag, Rule, Kind</td>
<td>Which rule would change, and what sort of change</td>
<td>Agent</td>
</tr>
<tr>
<td>Current text, Proposed text</td>
<td>The rule today, and the agent's draft</td>
<td>Agent</td>
</tr>
<tr>
<td>**Editor wording**</td>
<td>Optional: the rule owner's own wording, tested instead of the draft</td>
<td>Rule owner</td>
</tr>
<tr>
<td>**Approved by**</td>
<td>The rule owner who approved it</td>
<td>Rule owner</td>
</tr>
<tr>
<td>Gate result, Result card</td>
<td>The latest safety-check result, and the run that produced it</td>
<td>Agent</td>
</tr>
<tr>
<td>Supporting rows</td>
<td>The editor decisions the change is built on</td>
<td>Agent</td>
</tr>
<tr>
<td>Rubric version, Created</td>
<td>Background details</td>
<td>Agent / automatic</td>
</tr>
  </table>
</details>
<database url="https://app.notion.com/p/3f9273e214eb8172b5cfc965b4ec8d03" inline="true" data-source-url="collection://43614e6d-9d8c-4e0e-b1f5-26311eb03194"></database>
### 2.5 Runs
**What it is for.** A diary of what the agent did. Open a row to read its full result.
**At the start.** Empty. Each step that makes the agent work adds a row.
<details>
<summary>Column guide: Runs</summary>
  <table header-row="true">
<tr>
<td>Column</td>
<td>What it means</td>
</tr>
<tr>
<td>Run title, Kind, Started</td>
<td>What the agent did and when. Kind: Tag (read claims), Distill (drafted a rule change), Gate (safety check), Follow-up (re-check)</td>
</tr>
<tr>
<td>Verdict</td>
<td>Safety checks only: PASS (the change went live), HOLD (not enough evidence, nothing changed), FAIL (something got worse, nothing changed)</td>
</tr>
<tr>
<td>Summary</td>
<td>The result in a few lines</td>
</tr>
<tr>
<td>Claims judged, Canaries, Newly failing, Per-tag summary</td>
<td>The numbers behind the result. Newly failing above 0 means a decided claim broke</td>
</tr>
<tr>
<td>Lesson, Rubric version, Model, Cost USD</td>
<td>Which rule change, which edition, which Claude model, and what it cost</td>
</tr>
  </table>
</details>
<database url="https://app.notion.com/p/3f9273e214eb815387d5c9f6d80cf286" inline="true" data-source-url="collection://737d2036-0e9f-4cbb-871f-0755d665d706"></database>
### 2.6 Agent settings
**What it is for.** The agent's switches. One row.
**At the start.** **Paused** is unticked, **Rubric in force** is 2026-10-14.1, **Weekly cap** is 40, **Last run at** and **Last run summary** are empty.
<details>
<summary>Column guide: Agent settings</summary>
  <table header-row="true">
<tr>
<td>Column</td>
<td>What it means</td>
</tr>
<tr>
<td>**Paused**</td>
<td>Tick it and the agent stops at once: every command refuses to run. Anyone may tick it</td>
</tr>
<tr>
<td>Paused by, Reason</td>
<td>Who paused it and why (fill in yourself)</td>
</tr>
<tr>
<td>Rubric in force</td>
<td>The rulebook edition the agent uses right now</td>
</tr>
<tr>
<td>Last run at, Last run summary</td>
<td>The agent's latest run, in one line</td>
</tr>
<tr>
<td>Weekly cap, Owner</td>
<td>The most new queue rows per week, and who is responsible for the agent</td>
</tr>
  </table>
</details>
<database url="https://app.notion.com/p/3f9273e214eb81c48442e70bf46ae1d7" inline="true" data-source-url="collection://7e81475a-37b7-471a-87a5-bcebd6b304b7"></database>
## 3. Step by step
**What you need.** Claude Code open in the folder `geo-agents` (the engineer has set this up), and this page open next to it. You type each command into Claude Code, as written or in plain words.
**How each step is laid out.**
- **Before**: what Notion shows right now, table by table.
- **Do**: what you type or click.
- **What happens**: what the agent does, how long it takes, and what you see in Notion meanwhile.
- **Expected result in Notion**: every table and column that changes, with the value you should see. Where it says *most likely*, the exact value depends on how the agent reads the claims.
### Step 1 · Check what is waiting
**Before (what Notion shows now).**
<table header-row="true">
<tr>
<td>Table</td>
<td>What you see</td>
</tr>
<tr>
<td>Claims</td>
<td>13 claims. **Decided applies**: Predictive on 6, Hypothetical on 3, empty on your 4. **Agent tags**, **Readiness**, **Tag confidence**, **Last judged**: empty on all 13</td>
</tr>
<tr>
<td>Tag decisions</td>
<td>13 rows. 9 rows: **Stage** *Regression case*, **Seeded outcome** *Applies*, **In regression suite** 2026-10-14, **Direction** *Missed* (see 2.2). Your 4 rows: **Stage** *To review*, **Why in queue** *Auditor flag*, **Priority** *High*, **Agent proposal** empty, **Direction** *Open*</td>
</tr>
<tr>
<td>Rulebook</td>
<td>2 rows. **Rule version** 2026-10-14.1, **Changed by** empty</td>
</tr>
<tr>
<td>Rule changes, Runs</td>
<td>Empty</td>
</tr>
<tr>
<td>Agent settings</td>
<td>**Paused** unticked, **Rubric in force** 2026-10-14.1, **Last run at** and **Last run summary** empty</td>
</tr>
</table>
**Do.** Type `/claim-tagger sandbox status`
**What happens.** A few seconds. Claude reads the six tables, checks that its own copy of the rulebook matches the Rulebook table and that **Paused** is unticked, and counts what waits for whom. It only reads; it writes nothing to Notion.
**Expected result in Notion.** **No change in any table.** In Claude Code you get a short report: rulebook 2026-10-14.1 · not paused · 4 rows to review · 9 permanent checks · no rule changes · no runs.
### Step 2 · The agent reads the claims
**Before (what Notion shows now).** The same as in step 1. In particular: **Agent tags** is empty on all 13 claims, and your 4 rows in **Your queue** (below) have an empty **Agent proposal**.
**Do.** Type `/claim-tagger sandbox tag`
**What happens.** About 3 minutes, well under \$1. The agent reads all 13 claims three times each and decides Predictive and Hypothetical for each one. **While it reads, Notion does not change.** When it has finished, it writes all its results into Notion within a few seconds, then reads Notion back to confirm every value landed. Claude then reports how many claims it read, how many rows wait for you, and the cost.
**Expected result in Notion.**
<table header-row="true">
<tr>
<td>Where</td>
<td>Column</td>
<td>You should see</td>
</tr>
<tr>
<td>Claims, all 13</td>
<td>Agent tags</td>
<td>Filled. Your 4 claims: most likely **Predictive**. The 9 decided claims: their decided tag (an editor's decision always counts), sometimes plus the other tag</td>
</tr>
<tr>
<td>Claims, all 13</td>
<td>Readiness</td>
<td>Most likely **Fix needed** (an issue tag applies)</td>
</tr>
<tr>
<td>Claims, all 13</td>
<td>Tag confidence</td>
<td>One line per tag: the agent's answer, how sure it was, and the rule it used (for example "Predictive rule 1")</td>
</tr>
<tr>
<td>Claims, all 13</td>
<td>Last judged</td>
<td>2026-10-14.1 and the name of this run</td>
</tr>
<tr>
<td>Tag decisions, your 4 rows</td>
<td>Agent proposal, Agent confidence, Why I recommend this</td>
<td>Most likely **Add tag**, a number between 0 and 1, and one sentence quoting Predictive rule 1</td>
</tr>
<tr>
<td>Tag decisions, your 4 rows</td>
<td>Stage, Direction</td>
<td>Still **To review** and **Open**: they wait for you</td>
</tr>
<tr>
<td>Tag decisions, the 9 decided rows</td>
<td>—</td>
<td>No change: the agent never rewrites a decided row</td>
</tr>
<tr>
<td>Tag decisions, new rows</td>
<td>—</td>
<td>1 or 2 new rows with **Why in queue** *Low confidence*, where the agent was not sure enough, usually for **Hypothetical**. In this sandbox it added **2** (Hypothetical on the Iran claim and on the Proposition 40 claim), so **Your queue shows 6 rows** after this step. **Leave the new ones undecided**: they are not part of this walkthrough (see step 3)</td>
</tr>
<tr>
<td>Runs</td>
<td>New row</td>
<td>**Kind** *Tag*, **Claims judged** 13, **Rubric version** 2026-10-14.1, **Verdict** *n/a*, **Cost USD** under \$1</td>
</tr>
<tr>
<td>Agent settings</td>
<td>Last run at, Last run summary</td>
<td>Now, and one line about this run</td>
</tr>
<tr>
<td>Rulebook, Rule changes</td>
<td>—</td>
<td>No change</td>
</tr>
</table>
**The 13 claims**, the agent's tags on every claim:
<database url="https://app.notion.com/p/3f9273e214eb81d1a9afc21cc463b73e" inline="true" data-source-url="collection://755397bf-906c-4d60-9f05-fcd46f67c22d"></database>
**Your queue**, the rows waiting for you:
<database url="https://app.notion.com/p/3f9273e214eb8187a9b4c68cdbc6d918" inline="true" data-source-url="collection://ab0b0930-3d8f-4ce7-9491-904b25272f27"></database>
### Step 3 · Decide your four claims (you, as the editor)
**Before (what Notion shows now).** **Your queue** (step 2) shows **6 rows**: the 4 rows you started with, plus 2 the agent added in step 2.
<table header-row="true">
<tr>
<td>Row in Your queue</td>
<td>Tag</td>
<td>Agent proposal (how sure)</td>
<td>What to do</td>
</tr>
<tr>
<td>The Supreme Court is likely to expand executive power further…</td>
<td>Predictive</td>
<td>Add tag (0.93)</td>
<td>**Decide** (yours)</td>
</tr>
<tr>
<td>The Supreme Court is likely to uphold executive actions…</td>
<td>Predictive</td>
<td>Add tag (0.90)</td>
<td>**Decide** (yours)</td>
</tr>
<tr>
<td>Texas is on track to become a competitive swing state</td>
<td>Predictive</td>
<td>Add tag (0.75)</td>
<td>**Decide** (yours)</td>
</tr>
<tr>
<td>Military pressure is more likely than diplomatic restraint…</td>
<td>Predictive</td>
<td>Add tag, unsure (0.48)</td>
<td>**Decide** (yours). The agent's three readings split here, but decide it like the others</td>
</tr>
<tr>
<td>Military pressure is more likely than diplomatic restraint…</td>
<td>Hypothetical</td>
<td>Do not add tag, unsure (0.45)</td>
<td>**Leave it.** Added by the agent in step 2</td>
</tr>
<tr>
<td>California's Proposition 40 will do more harm than good…</td>
<td>Hypothetical</td>
<td>Do not add tag (0.70)</td>
<td>**Leave it.** Added by the agent in step 2</td>
</tr>
</table>
The 2 Hypothetical rows appeared because the agent was not sure enough to settle Hypothetical on those two claims by itself, so it asked. They are not part of this walkthrough: **leave them undecided**. Deciding one with a rule reason in Why wrong could start a second rule change that muddles the story, and undecided rows do not affect steps 4 to 8. (Values in the table are from this sandbox's tag run; if step 2 is run again they can differ slightly.)
In **The 13 claims** (step 2), your 4 claims look like this:
<table header-row="true">
<tr>
<td>Claim</td>
<td>Agent tags</td>
<td>Readiness</td>
<td>Decided does not apply</td>
</tr>
<tr>
<td>The Supreme Court is likely to expand executive power further…</td>
<td>Predictive</td>
<td>Fix needed</td>
<td>empty</td>
</tr>
<tr>
<td>The Supreme Court is likely to uphold executive actions…</td>
<td>Predictive</td>
<td>Fix needed</td>
<td>empty</td>
</tr>
<tr>
<td>Texas is on track to become a competitive swing state</td>
<td>Predictive</td>
<td>Fix needed</td>
<td>empty</td>
</tr>
<tr>
<td>Military pressure is more likely than diplomatic restraint…</td>
<td>none</td>
<td>Needs editor</td>
<td>empty</td>
</tr>
</table>
- **Fix needed** means the agent put an issue tag (here Predictive) on the claim, so the claim is treated as not a settled fact. 12 of the 13 claims show it, because every one of them carries Predictive or Hypothetical.
- **Needs editor** means the agent could not make up its mind on at least one tag and is waiting for a person. Only the Iran claim shows it: the agent's readings split on both tags, so it records no tag there.
- **Decided applies** and **Decided does not apply** are the people's verdict on the claim, shown next to **Agent tags** (the agent's verdict) so you can compare them on one row. *Decided applies* lists tags an editor confirmed; *Decided does not apply* lists tags an editor ruled out. On your 4 claims both are empty, because nobody has decided them yet. After this step *Decided does not apply* shows **Predictive** on all 4, while **Agent tags** still shows Predictive on 3 of them (the Iran claim has no agent tag): the editor and the agent visibly disagree, and that disagreement is what the rest of the walkthrough resolves.
**What to choose in Why wrong.** It tells the system what kind of mistake you found:
<table header-row="true">
<tr>
<td>Why wrong</td>
<td>Means</td>
<td>What happens to your decision</td>
</tr>
<tr>
<td>Agent slip</td>
<td>The rule is fine; the agent misread it</td>
<td>Becomes a permanent check straight away</td>
</tr>
<tr>
<td>Rule unclear</td>
<td>The rule does not settle this case</td>
<td>Used to make the rule clearer</td>
</tr>
<tr>
<td>**Rule should change**</td>
<td>The rule does settle it, but wrongly</td>
<td>Used to change the rule (this walkthrough)</td>
</tr>
<tr>
<td>No tag fits</td>
<td>No tag describes the problem</td>
<td>Used to suggest a new tag</td>
</tr>
</table>
Here the agent follows rule 1 correctly; the rule itself is wrong. So choose *Rule should change*.
**Do.** Fill in your 4 rows in the table **Fill in here: your 4 rows**, directly under these values. Both tables list the same 4 claims in the same order, so each line of values belongs to the row right below it. To copy a sentence, triple-click it, copy, and paste it into **Your reasoning**.
<table header-row="true">
<tr>
<td>Row (claim, tag Predictive)</td>
<td>Tag outcome</td>
<td>Why wrong</td>
<td>Your reasoning (copy this)</td>
</tr>
<tr>
<td>1. Military pressure is more likely than diplomatic restraint to produce an Iran settlement</td>
<td>Does not apply</td>
<td>Rule should change</td>
<td>"More likely than" compares two approaches; it predicts neither that pressure will be used nor that a settlement will come, so rule 1 should not count comparisons.</td>
</tr>
<tr>
<td>2. The Supreme Court is likely to expand executive power further in the future</td>
<td>Does not apply</td>
<td>Rule should change</td>
<td>This describes the Court's habit, which can be checked against its record; it does not forecast a definite future event, so rule 1 should not count "is likely to" here.</td>
</tr>
<tr>
<td>3. The Supreme Court is likely to uphold executive actions that exceed the authority granted by Congress</td>
<td>Does not apply</td>
<td>Rule should change</td>
<td>This describes how the Court tends to rule, a judgement about the present; rule 1 should count hedged words only when they point to a definite future event.</td>
</tr>
<tr>
<td>4. Texas is on track to become a competitive swing state</td>
<td>Does not apply</td>
<td>Rule should change</td>
<td>"On track to" describes where things are heading now, not a definite future event; rule 1 should not treat a present trajectory as a forecast.</td>
</tr>
</table>
**Fill in here: your 4 rows** (the same 4 claims, same order; the rows stay here after you decide them, so you can check your entries):
<database url="https://app.notion.com/p/3f9273e214eb811784a9ddf3f7c96d38" inline="true" data-source-url="collection://ab0b0930-3d8f-4ce7-9491-904b25272f27"></database>
Leave **Decided by** and **Decided at** empty, and leave the 2 **Hypothetical** rows (still in Your queue, step 2) untouched.
**What happens.** The agent is not involved. The moment you choose a Tag outcome, Notion recalculates the automatic columns of that row and the row moves out of Your queue.
**Expected result in Notion.**
<table header-row="true">
<tr>
<td>Where</td>
<td>Column</td>
<td>You should see</td>
</tr>
<tr>
<td>Tag decisions, your 4 rows</td>
<td>Tag outcome, Why wrong, Your reasoning</td>
<td>What you entered</td>
</tr>
<tr>
<td>Tag decisions, your 4 rows</td>
<td>Effective outcome</td>
<td>**Does not apply**</td>
</tr>
<tr>
<td>Tag decisions, your 4 rows</td>
<td>Stage</td>
<td>**Decided**: the rows leave **Your queue** and appear in **Your decisions** below. Your queue then shows only the 2 Hypothetical rows you left</td>
</tr>
<tr>
<td>Tag decisions, your 4 rows</td>
<td>Direction</td>
<td>**Wrongly applied** where the agent had proposed the tag</td>
</tr>
<tr>
<td>Tag decisions, your 4 rows</td>
<td>In regression suite</td>
<td>Still empty: the current rule would fail these decisions, so they become permanent checks only once the rule has changed</td>
</tr>
<tr>
<td>Claims, your 4 claims</td>
<td>Decided does not apply</td>
<td>**Predictive**</td>
</tr>
<tr>
<td>Claims, your 4 claims</td>
<td>Agent tags</td>
<td>No change yet (still Predictive). The agent updates it when it next reads these claims, in step 7</td>
</tr>
<tr>
<td>Needs your note</td>
<td>—</td>
<td>Empty if every row has a sentence</td>
</tr>
<tr>
<td>Rulebook, Rule changes, Runs, Agent settings</td>
<td>—</td>
<td>No change</td>
</tr>
</table>
**Needs your note**, rows where a sentence is missing (normally empty):
<database url="https://app.notion.com/p/3f9273e214eb818a82abda0a4aa0760c" inline="true" data-source-url="collection://ab0b0930-3d8f-4ce7-9491-904b25272f27"></database>
**Your decisions**, every row you have decided and where it stands:
<database url="https://app.notion.com/p/3f9273e214eb810289e3d96a471b6e74" inline="true" data-source-url="collection://ab0b0930-3d8f-4ce7-9491-904b25272f27"></database>
### Step 4 · The agent drafts a better rule
**Before (what Notion shows now).** **Rule changes** is empty, and so is **Lessons waiting** (below). In **Your decisions**, your 4 rows show **Stage** *Decided*, **Why wrong** *Rule should change*, and an empty **Lesson**.
**Do.** Type `/claim-tagger sandbox distill`
**What happens.** About a minute. The agent looks for decisions that blame the same rule for the same reason; your 4 rows qualify (three or more make a pattern). It drafts new wording for Predictive rule 1 from your sentences. **Notion does not change while it drafts.** It then writes to Notion in two quick passes a few seconds apart: first the new rule change appears in Rule changes, then your 4 rows are linked to it.
**Expected result in Notion.**
<table header-row="true">
<tr>
<td>Where</td>
<td>Column</td>
<td>You should see</td>
</tr>
<tr>
<td>Rule changes</td>
<td>New row</td>
<td>**Lesson ID** **WT-1**, **Lesson title** a short name the agent chose, **Status** *Proposed*, **Owner action** *Approve or reject*</td>
</tr>
<tr>
<td>Rule changes, WT-1</td>
<td>Tag, Rule, Kind</td>
<td>*Predictive*, *Predictive rule 1*, most likely *Change the rule*</td>
</tr>
<tr>
<td>Rule changes, WT-1</td>
<td>Current text, Proposed text</td>
<td>Today's rule 1, and the agent's draft</td>
</tr>
<tr>
<td>Rule changes, WT-1</td>
<td>Supporting rows</td>
<td>Your 4 decisions</td>
</tr>
<tr>
<td>Rule changes, WT-1</td>
<td>Editor wording, Approved by, Gate result</td>
<td>Empty</td>
</tr>
<tr>
<td>Tag decisions, your 4 rows</td>
<td>Lesson, Lesson status, Stage</td>
<td>**WT-1**, *Proposed*, **Lesson proposed**</td>
</tr>
<tr>
<td>Runs</td>
<td>New row</td>
<td>**Kind** *Distill*</td>
</tr>
<tr>
<td>Rulebook</td>
<td>—</td>
<td>No change: a proposal changes no rule</td>
</tr>
</table>
**Lessons waiting**, rule changes that need the rule owner:
<database url="https://app.notion.com/p/3f9273e214eb816b96b5c35b6668eb24" inline="true" data-source-url="collection://43614e6d-9d8c-4e0e-b1f5-26311eb03194"></database>
### Step 5 · Approve the change (you, as the rule owner)
**Before (what Notion shows now).** **Lessons waiting** (step 4) shows WT-1 with **Status** *Proposed* and **Owner action** *Approve or reject*. In the Rulebook, Predictive's **When to use** still has today's rule 1.
**Do.** In **Lessons waiting** (step 4):
1. Click the title of the WT-1 row to open it. Note its **Lesson ID** (WT-1); you need it in step 6.
2. Read **Current text** (today's rule) and **Proposed text** (the agent's draft), just to see the difference.
3. Click into **Editor wording** and paste the text from the box right below these steps. It is the wording the real trial tested most successfully, so it gives the safety check the best chance to pass. Whatever is in Editor wording is tested instead of the agent's draft.
4. Set **Status** to **Approved**.
5. In **Approved by**, pick yourself.
<callout icon="📋" color="gray_bg">
  **Copy into Editor wording** (triple-click the paragraph below to select all of it):
  Fires on an unconditional future/forecast marker: will, is expected to, is forecasted to, is projected to, is set to ("the market is forecasted to grow to a multi-trillion size by 2030", "the largest wave of maturities is expected in the fall"). Hedged markers (is likely to, is likely, probably) fire only when they attach to a definite future outcome or event that only the future can settle ("the hiring freeze is likely a short-lived phase" fires). Hedged markers do NOT fire when they describe: an actor's general tendency or disposition, which can be checked against its past record ("the agency is likely to side with large incumbents"); a comparison of which strategy or approach tends to work better ("tariffs are more likely than talks to change the policy"); or a present trajectory ("is on track to", "is heading toward"). Such claims are assessments of the present, not forecasts. In particular, a hedged claim that an actor is likely to keep doing, continue or extend what it already does (to expand, tighten or favour something further), even with a future time phrase attached, describes that actor's tendency and does not fire. This rule decides Predictive only: it never decides whether a claim is Hypothetical, which Hypothetical's own rules settle unchanged, so a conditional or scenario claim keeps the Hypothetical verdict those rules give it even where this rule would also fire, and the two tags may stand together.
</callout>
<details>
<summary>Today's rule 1, for comparison</summary>
  **Today:** Fires on an unconditional future/forecast marker: will, is expected to, is forecasted to, is projected to, is set to, is likely to ("the market is forecasted to grow to a multi-trillion size by 2030", "the largest wave of maturities is expected in the fall").
</details>
**What happens.** The agent is not involved. Notion recalculates **Owner action** as soon as you change Status. Approving does **not** change the rule; it only allows the safety check to test it.
**Expected result in Notion.**
<table header-row="true">
<tr>
<td>Where</td>
<td>Column</td>
<td>You should see</td>
</tr>
<tr>
<td>Rule changes, WT-1</td>
<td>Status, Approved by, Editor wording</td>
<td>**Approved**, you, and the tested wording you pasted</td>
</tr>
<tr>
<td>Rule changes, WT-1</td>
<td>Owner action</td>
<td>Empty, so WT-1 **leaves Lessons waiting** (it is still in the full Rule changes table in part 2)</td>
</tr>
<tr>
<td>Tag decisions, your 4 rows</td>
<td>Lesson status, Stage</td>
<td>*Approved*; Stage stays **Lesson proposed**</td>
</tr>
<tr>
<td>Rulebook, Runs, Agent settings</td>
<td>—</td>
<td>No change</td>
</tr>
</table>
### Step 6 · The safety check
**Before (what Notion shows now).** WT-1 is *Approved* (in the full Rule changes table in part 2). In **Rulebook in force** (below), Predictive's **When to use** still has today's rule 1 and **Rule version** is 2026-10-14.1. **Latest runs** (below) has two rows: Tag and Distill.
**Do.** Type `/claim-tagger sandbox promote WT-1`
**What happens.** About 5 to 10 minutes, about \$1. The agent reads the 9 decided claims, your 4 claims and the 7 textbook examples, three times each with today's rulebook and three times with the new rule 1, then reads again any claim whose answer changed. **Notion does not change during all this.** At the end, Claude prints the result and writes it to Notion in one go, then reads Notion back to confirm. The new rule must pass three tests:
- The **7 textbook examples** in the rulebook still come out right (for example "Bitcoin will reach \$200,000 next year" is still Predictive).
- The **9 claims decided earlier** still come out right. One of them is a useful trap: "The current trend of cognitive offloading to AI is **likely** a temporary phase…" says "likely" but is a real forecast, so it must stay Predictive. One broken decision is enough to refuse.
- **Your 4 claims** are now answered "not Predictive", clearly enough that it is not luck.
**Expected result in Notion, if it passes (PASS).**
<table header-row="true">
<tr>
<td>Where</td>
<td>Column</td>
<td>You should see</td>
</tr>
<tr>
<td>Rulebook, Predictive</td>
<td>When to use</td>
<td>The new rule 1 (the wording you approved); rules 2 to 6 unchanged</td>
</tr>
<tr>
<td>Rulebook, Predictive</td>
<td>Rule version, Changed by</td>
<td>The new edition (for example 2026-10-14.2), and **WT-1**</td>
</tr>
<tr>
<td>Rulebook, Hypothetical</td>
<td>—</td>
<td>No change</td>
</tr>
<tr>
<td>Rule changes, WT-1</td>
<td>Status, Gate result, Result card</td>
<td>**Live** (green), a short result starting "Verdict: PASS", and a link to the new Gate run</td>
</tr>
<tr>
<td>Runs</td>
<td>New row</td>
<td>**Kind** *Gate*, **Verdict** *PASS*, **Canaries** all 7 passed, **Newly failing** 0, **Lesson** WT-1, **Cost USD** about \$1. Open the row to read the full result</td>
</tr>
<tr>
<td>Agent settings</td>
<td>Rubric in force, Last run summary</td>
<td>The new edition, and one line about the safety check</td>
</tr>
<tr>
<td>Tag decisions, your 4 rows</td>
<td>In regression suite, Stage</td>
<td>Today's date, and **Regression case**: they are permanent checks now</td>
</tr>
<tr>
<td>Claims</td>
<td>—</td>
<td>No change yet; step 7 updates them</td>
</tr>
</table>
**Expected result in Notion, if it does not pass (HOLD or FAIL).**
<table header-row="true">
<tr>
<td>Where</td>
<td>Column</td>
<td>You should see</td>
</tr>
<tr>
<td>Runs</td>
<td>New row</td>
<td>**Kind** *Gate*, **Verdict** *HOLD* or *FAIL*; **Newly failing** shows how many decided claims broke</td>
</tr>
<tr>
<td>Rule changes, WT-1</td>
<td>Gate result</td>
<td>Starts "Verdict: HOLD" or "Verdict: FAIL" and names the problem, for example which claim broke</td>
</tr>
<tr>
<td>Rule changes, WT-1</td>
<td>Owner action, Status</td>
<td>*Gate HOLD: wait for more decided examples, or reword* or *Gate FAIL: reword in Editor wording, or reject*, so WT-1 is **back in Lessons waiting**; Status stays *Approved*</td>
</tr>
<tr>
<td>Rulebook, Agent settings, Tag decisions, Claims</td>
<td>—</td>
<td>No change. Your rows stay *Lesson proposed*</td>
</tr>
</table>
A HOLD or FAIL is the safety check doing its job: it refused a change it could not prove was safe. Reword in **Editor wording** and run this step again, or reject the change.
**Latest runs**:
<database url="https://app.notion.com/p/3f9273e214eb816aabecc94d24aa333a" inline="true" data-source-url="collection://737d2036-0e9f-4cbb-871f-0755d665d706"></database>
**Rulebook in force**, watch Predictive's text change on a PASS:
<database url="https://app.notion.com/p/3f9273e214eb812c877fdd5bbe7f46d5" inline="true" data-source-url="collection://4ad48d6f-cc91-417e-b780-5db4bcd0d1a6"></database>
### Step 7 · The agent re-checks your claims (after a PASS)
**Before (what Notion shows now).** In **Your decisions** (step 3), your 4 rows show **Stage** *Regression case* and an empty **Agent follow-up**. In **The 13 claims** (step 2), your 4 claims still carry Predictive in **Agent tags**, and **Last judged** still says 2026-10-14.1.
**Do.** Type `/claim-tagger sandbox follow-up WT-1`
**What happens.** One or two minutes; most readings are reused from the safety check. The agent re-reads your 4 claims with the new rule and checks, one by one, whether it now agrees with you. It also re-reads the other decided Predictive claims to make sure they still come out right. **Notion does not change until it has finished**, then everything is written in one go and read back.
**Expected result in Notion.**
<table header-row="true">
<tr>
<td>Where</td>
<td>Column</td>
<td>You should see</td>
</tr>
<tr>
<td>Tag decisions, your 4 rows</td>
<td>Agent follow-up, Follow-up run</td>
<td>**Fixed** (the agent now agrees with you), or *Still wrong*; and the new edition with the run's name</td>
</tr>
<tr>
<td>Tag decisions, your 4 rows</td>
<td>Stage</td>
<td>**Closed** for every Fixed row</td>
</tr>
<tr>
<td>Claims, your 4 claims</td>
<td>Agent tags</td>
<td>**Predictive is gone**</td>
</tr>
<tr>
<td>Claims, your 4 claims</td>
<td>Tag confidence, Last judged, Readiness</td>
<td>The Predictive line now says it does not apply, quoting the new rule 1; the new edition; **Ready**, or *Fix needed* if another tag such as Hypothetical applies</td>
</tr>
<tr>
<td>Claims, the 6 decided Predictive claims</td>
<td>Agent tags, Last judged</td>
<td>Still **Predictive**; the new edition</td>
</tr>
<tr>
<td>Runs</td>
<td>New row</td>
<td>**Kind** *Follow-up*</td>
</tr>
<tr>
<td>Agent settings</td>
<td>Last run summary</td>
<td>One line with how many rows were fixed</td>
</tr>
</table>
See it in **Your decisions** (step 3) and **The 13 claims** (step 2).
### Step 8 · Close the loop
**Before (what Notion shows now).** Everything from steps 6 and 7.
**Do.** Type `/claim-tagger sandbox status`
**What happens.** A few seconds. Claude reads the tables and reports. It writes nothing.
**Expected result in Notion.** No change. This is the end state you should see:
<table header-row="true">
<tr>
<td>Table</td>
<td>End state</td>
</tr>
<tr>
<td>Rulebook</td>
<td>Predictive rule 1 has the new wording; **Rule version** is the new edition; **Changed by** WT-1</td>
</tr>
<tr>
<td>Rule changes</td>
<td>WT-1 **Live**</td>
</tr>
<tr>
<td>Tag decisions</td>
<td>The 9 earlier rows: *Regression case*. Your 4 rows: *Closed*, **Agent follow-up** *Fixed*. Any Hypothetical rows the agent added in step 2 are still *To review*, as you left them</td>
</tr>
<tr>
<td>Claims</td>
<td>Your 4 claims: no Predictive in **Agent tags**, Predictive in **Decided does not apply**</td>
</tr>
<tr>
<td>Runs</td>
<td>4 rows: Tag, Distill, Gate (PASS), Follow-up</td>
</tr>
<tr>
<td>Agent settings</td>
<td>**Rubric in force** is the new edition</td>
</tr>
</table>
You have seen one full cycle: your note became a better rule, the rule was proven safe before it went live, and your claims are now permanent checks.
### Optional · The stop switch
In part 2, open **Agent settings** and tick **Paused**. Ask Claude for the status: every command now refuses to run. Untick it to continue. In the real trial, this is how anyone stops the agent at once.
## 4. Help {toggle="true"}
  ### If something stops {toggle="true"}
    <table header-row="true">
<tr>
<td>Claude says</td>
<td>Do this</td>
</tr>
<tr>
<td>"paused"</td>
<td>Untick Paused in Agent settings</td>
</tr>
<tr>
<td>"usage window"</td>
<td>Wait until Claude's usage allowance resets, then ask Claude to continue; it tells you the exact command</td>
</tr>
<tr>
<td>"trust breaker"</td>
<td>Someone edited a row while the agent was writing, so the agent stopped itself. Tell the engineer</td>
</tr>
<tr>
<td>"nothing to do" after step 4</td>
<td>Fewer than 3 of your rows have Tag outcome set and Why wrong *Rule should change*. Fix those rows in Your decisions and run step 4 again. (A missing sentence does not block step 4, but the draft is better with it: check Needs your note)</td>
</tr>
<tr>
<td>Anything else</td>
<td>Ask Claude "what is waiting and how do I continue?"</td>
</tr>
    </table>
  ### Words used on this page {toggle="true"}
    - **Claim**: one short statement in Geo.
    - **Tag**: a label saying what kind of statement a claim is.
    - **Rulebook**: the tags' numbered rules, with an edition number. The only thing that changes when the agent learns.
    - **The agent**: Claude, reading claims against the rulebook.
    - **Queue**: the rows the agent wants a person to decide.
    - **Permanent check** (*regression case*): a decided claim the agent must keep getting right.
    - **Textbook example** (*canary*): an example printed in the rulebook; must always come out right.
    - **Rule change** (*lesson*): a proposed new wording for one rule.
    - **WT-1**: the number of the first rule change in this walkthrough, given automatically by Notion when the agent proposes it in step 4 (WT for *walkthrough*; the real trial uses LS-1, LS-2 …). You type it in steps 6 and 7.
    - **Rule owner**: the person who approves or rejects rule changes.
    - **Safety check** (*gate*): the old-against-new test a rule change must pass before it is used.
    - **Re-check** (*follow-up*): after a change goes live, checking that it fixed the claims behind it.
<page url="https://app.notion.com/p/3f9273e214eb817f8dd1cd336e2e6ab9">Sandbox databases</page>
