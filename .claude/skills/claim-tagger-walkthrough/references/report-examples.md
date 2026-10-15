# Report examples for the claim tagger skills

Copied from the design review (`docs/analysis-2026-10/debate/inputs/report-examples.md`); each example is the whole report, exactly as the editor sees it. The scripts print reports in this shape and the skills relay them verbatim.

On a practice page the first sentence names the page: a status report starts "Status of the practice page <title>:", and the other reports end their first sentence with "(practice page <title>)". The commands are the demo ones (`/claim-tagger demo promote`).

## Examples

Each example is the whole report, exactly as the editor sees it.

### status (more rows wait than fit one sitting)

Status: nothing is paused; 46 rows and 1 rule change wait for you, more than fit one sitting.

| Where | Now |
|---|---|
| Rulebook | 13 tags, edition 2026-11-04.2 |
| Your queue | 46 rows, lowest confidence first |
| Lessons waiting | 1 rule change to approve |
| Last run | Tag · 4 Nov 09:12 · 214 claims |

Next: start at the top of Your queue (link).

### status (demo, step 1)

Demo · Status of the practice page Claim tagger demo · 15 Oct 10:42: nothing is paused; 2 rows wait for you.

| Where | Now |
|---|---|
| Rulebook | 1 tag, edition 2026-10-15.1 |
| Your queue | 2 rows, lowest confidence first |
| Lessons waiting | none |
| Last run | none yet |

Next: type /claim-tagger demo tag so that the agent reads the claims first (step 2 of the practice page).

### tag (demo)

Demo · tag: the agent read the 7 claims and proposed Applies on one of your rows and Can't tell on the other (practice page Claim tagger demo · 15 Oct 10:42).

| What | Result |
|---|---|
| Claims read | 7 |
| Your rows | 2: one Applies, one Can't tell, both citing rule 3 |
| Earlier decisions | 5 of 5 agree with the agent |

Next: fill in your 2 rows in Your queue (link).

### tag (real claims, the first run: Context-dependent only)

The Usage row appears only once the share of your Claude allowance that the run took is known; until then the table has three rows.

Tag: the agent read 214 new claims for Context-dependent; 9 of them wait for you.

| What | Result |
|---|---|
| Claims read | 214 |
| Tagged Context-dependent | 31 claims |
| New rows in Your queue | 9, lowest confidence first |
| Usage | 3% of your Claude allowance |

Next: decide the 9 rows in Your queue (link).

### distill (demo)

Demo · distill: one rule change drafted from your 2 notes (practice page Claim tagger demo · 15 Oct 10:42).

| What | Result |
|---|---|
| Rule change | Known groups count as identified, unknown names do not |
| Rule | Context-dependent rule 3, Proposed |
| Rests on | your 2 rows |

Next: read it in Lessons waiting (link), where the current and the proposed text sit side by side, and approve it or write your own wording.

### promote, when it passes (demo)

Demo · promote: PASS, rule 3 now uses your approved wording (edition 2026-10-15.2), and the follow-up marked both of your rows Fixed (practice page Claim tagger demo · 15 Oct 10:42).

| Check | Result |
|---|---|
| Example claims | 10 of 10 right |
| Earlier decisions | 5 of 5 still right |
| Your 2 rows | 2 of 2 now right, marked Fixed |

Next: look at step 7 on the practice page (link); the demo is then complete.

### promote, when it does not pass (demo)

Editor wording is the whole rule, so the Next line hands the editor the whole text: the rule as it was tested, then one sentence written from the claim that came out wrong. That claim can be an example claim, an earlier decision (as here) or one of the editor's own rows.

Demo · promote: FAIL, rule 3 is unchanged: the new wording turns "The Dallas convention is the unofficial launch of JD..." to Does not apply (practice page Claim tagger demo · 15 Oct 10:42).

| Check | Result |
|---|---|
| Example claims | 10 of 10 right |
| Earlier decisions | 4 of 5 still right |
| Your 2 rows | 2 of 2 now right |

Next: in Lessons waiting (link), open the change and put this whole text into Editor wording: "A descriptive definite that names a kind of thing but not which one (\"the Bitcoin ETF\", \"the major-bank stablecoin consortium\", \"the open-access version\", \"the infrastructure\", \"the new model\") makes the claim Context-dependent: the reader must already know which ETF, consortium, version or product is meant. Applies to countable things, not to abstract or mass nouns (\"the regulatory clearance\", \"the market\"). A group readers know by its standing role, such as a press corps, counts as identified; a capitalised phrase that names no body readers know does not. A one-off event named only by its place or kind, such as a convention, still needs context."; then type `/claim-tagger demo promote` again.

### follow-up, repeated by hand (demo, only after a promote that stopped before its last step)

Demo · follow-up, repeated by hand: the agent now agrees with both of your decisions (practice page Claim tagger demo · 15 Oct 10:42).

| Your row | Follow-up |
|---|---|
| The press pool was justified in suspending coverage... | Fixed |
| The AI Force should enforce binding safety standards | Fixed |

Next: nothing; the demo is complete.

### A stopped run

Demo · tag stopped: your Claude allowance ran out after 4 of 7 claims; nothing was written to Notion.

Next: when your Claude allowance is back, type `/claim-tagger demo tag` again; it continues where it stopped.

### Walkthrough: start

If the request has no link, the skill first asks one question and does nothing else: "Under which Notion page should the demo go? Paste a link."

Walkthrough: your practice page is ready under Editor onboarding.

| Table | Now |
|---|---|
| Rulebook | 1 tag, Context-dependent |
| Claims | 7 |
| Tag decisions | 7: 5 decided earlier, 2 for you |
| Rule changes | empty |

Next: open Claim tagger demo · 15 Oct 10:42 (link) and follow step 1.

### Walkthrough: start, when the page cannot be reached

Walkthrough: no demo was created, because the claim tagger cannot reach that Notion page.

Next: in Notion, open that page, choose ⋯ → Connections and add the claim tagger connection, then ask again (or paste another page).

### Walkthrough: where

Walkthrough: you are at step 3, deciding your two rows.

Next: fill in your 2 rows in Your queue (link).
