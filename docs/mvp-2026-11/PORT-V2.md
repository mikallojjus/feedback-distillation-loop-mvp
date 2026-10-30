# Port of the loop to v2 (checkpoint 3): design for the coders

Written 30 Oct 2026, night, for OVERNIGHT.md step 6. Binding decisions: P42 to P49 (`DECISIONS.md`), the v2 page in `STRUCTURE-V2.md`, hard rules 1 and 10 as rewritten in `CLAUDE.md`. The owner is asleep: the open points in section 7 carry a recommended answer, which the night session applies unless it overrules it.

Conventions for every package (from the repo and its memory):

- Work on branch `v2-page` itself. If a coder runs in a worktree, check that its base is the tip of `v2-page`, not `main`.
- No Bash heredocs: write files with Write/Edit. Edit/Write decode `\uXXXX` in their arguments: where code needs a literal escape (plan.mjs uses `'\u0000'`), write it with a small node script.
- Plain Node ESM, built-ins only. Never read `.env`, never call Notion from a test, never pass `--bare` or `--fallback-model`.
- Tests: `node --test tests/mvp/<file>` from the repo root. A package is done when its green target passes and no file outside its list was edited.
- **One rule for every file:** no code outside `lib/decisions.mjs` reads `Tag outcome`, `Agent is right` or `Your note` off a row to decide anything. Every reader asks `rowDecision(row)`. A new test enforces this (section 6).

---

## 1. The decision model (lib/decisions.mjs, rewritten)

### 1.1 Column constants (lib/config.mjs)

A new frozen object `TD` in `lib/config.mjs`. It is the only place the Tag decisions column names are spelled:

| key | Notion name | who writes |
|---|---|---|
| `claim` | Claim | agent (create only) |
| `open` | Open claim | agent (relation, one Claims page id) |
| `key` | Key | agent |
| `tag` | Tag | agent |
| `proposal` | Agent proposal | agent |
| `confidence` | Agent confidence | agent |
| `reason` | Agent reason | agent |
| `right` | Agent is right | **editor** (checkbox) |
| `outcome` | Tag outcome | **editor** (select: Applies, Does not apply) |
| `note` | Your note | **editor** (text) |
| `status` | Agent status | agent (select: the four AGENT_STATUS values) |
| `view` | Agent's view of your decision | agent (select: the three READINGS) |
| `rule` | Rule | agent |
| `why` | Why the agent thinks so | agent |
| `after` | After the rule change | agent (select: Fixed, Still wrong) |
| `edition` | Rulebook edition | agent |
| `decidedUnder` | Decided under | agent |
| `readUnder` | Read under | agent |

`TD_EDITOR = [TD.right, TD.outcome, TD.note]` (the same three as `config.editor_columns.tag_decisions`).

### 1.2 Exports of decisions.mjs (v2)

Delete these exports so that a stale import fails at load time: `REVIEWED`, `TO_REVIEW`, `isReviewed`, `isToReview`, `claimWaits`, `claimDisagrees`, `parseTagLines`, `parseTagNotes`, `leadingReason`, `decisionsFor`, `decisionProps`, `decisionChanges`, `syncDecisions`. Keep `READINGS`, `RULE_WHY`, `isFollowedUp` (now on `TD.after`).

New exports, all pure:

| function | returns | semantics |
|---|---|---|
| `OUTCOMES` | `['Applies','Does not apply']` | the two decisions |
| `CANT_TELL` | `"Can't tell"` | |
| `keyParts(key)` | `{ geo_id, tag }` or null | split at the last `::` (the old private `keyTag`, now exported) |
| `isTicked(row)` | boolean | `row[TD.right] === true` |
| `parseDecidedUnder(v)` | `{ edition, agreed }` or null | `/^(\S+)(?:\s+·\s+agreed\s+(Applies\|Does not apply))?$/` on the trimmed text; `agreed` null when there is no suffix |
| `decidedUnderText(edition, agreed = null)` | string or null | `"<edition>"`, or `"<edition> · agreed <Outcome>"` for a tick; null when edition is empty |
| `rowDecision(row)` | object below | the one reader of the three editor columns |
| `isDecided(row)` | boolean | `rowDecision(row).outcome !== null` |
| `rowDisagrees(row)` | boolean | decided and `outcome !== trim(row[TD.proposal])`. Can't tell differs from both outcomes (as `isDisagreement` today) |
| `inYourQueue(row)` | boolean | the view's filter, exactly: `row[TD.status] === AGENT_STATUS.waits` and Tag outcome empty and (not ticked, or proposal is Can't tell) |
| `countYourQueue(rows)` | number | rows where `inYourQueue` |
| `recordChanges(row)` | `{}` or `{ 'Decided under': value }` | see 1.4 |
| `recordDecisions(ledgerRows)` | `{ changes: [{ key, page_id, changes }], rows }` | the same return shape as the old `syncDecisions`, minus the claims argument. `rows` are copies with the changes applied and `decided` set on **every** row (`isDecided`) |
| `rowStatus({ outcome, proposal, unreadable })` | an AGENT_STATUS value | see 1.5 |
| `claimSummary(rows, { judgedNames, edition, notChecked })` | object | see 1.6 |

### 1.3 `rowDecision(row)`

Returns `{ key, tag, geo_id, outcome, by, note, decided_under, first_sight, tick_ignored, waits }`.

Let `o = trim(row[TD.outcome])`, `p = trim(row[TD.proposal])`, `du = parseDecidedUnder(row[TD.decidedUnder])`, `ed = trim(row[TD.edition]) || null`, `note = trim(row[TD.note]) || null` (line ends made `\n`).

| case | outcome | by | decided_under | first_sight |
|---|---|---|---|---|
| `o` is one of OUTCOMES (tick or not) | `o` | `'outcome'` | `du?.edition ?? ed` | `du === null` |
| no `o`, ticked, `du?.agreed` set | `du.agreed` | `'tick'` | `du.edition` | false |
| no `o`, ticked, no agreed, `p` is one of OUTCOMES | `p` | `'tick'` | `ed` | true |
| no `o`, ticked, `p` is Can't tell or empty | null | null | null | false; `tick_ignored: true` |
| no `o`, not ticked | null | null | null | false |

- **Tag outcome wins** when both are set, whatever the tick says (P46).
- **Agent is right** means "the proposal the row showed when the agent first found the tick" (P46). That value is held in Decided under as `"<edition> · agreed <Outcome>"`, because the agent never writes Tag outcome and the Agent proposal of a decided row moves with later tag runs (1.7).
- **Can't tell plus a tick decides nothing**; the row keeps waiting.
- A Tag outcome value that is not one of OUTCOMES counts as empty (a warning is the caller's business, not this function's).
- `waits` = `outcome === null && p === CANT_TELL`. That is the agent's own sense of "waits for you". `inYourQueue` is the view's sense, for counting what an editor sees.
- `note` is the row's Your note, never parsed: a note that opens with "Agent slip." is plain text (P45).

### 1.4 Recording a decision: `recordChanges(row)`

`d = rowDecision(row)`; `want = d.outcome === null ? null : decidedUnderText(d.decided_under, d.by === 'tick' ? d.outcome : null)`; `have = trim(row[TD.decidedUnder]) || null`. Return `{}` when `have === want`, else `{ [TD.decidedUnder]: want }`.

What follows from it:
- **First sight of a Tag outcome:** Decided under gets the row's Rulebook edition (as today).
- **First sight of a tick:** `"<Rulebook edition> · agreed <Agent proposal>"`.
- The edition part is never changed once set while the row stays decided.
- A row that is no longer decided (the tick removed, Tag outcome cleared) has Decided under cleared (null), so a later tick is recorded afresh.
- Tick, then Tag outcome: the suffix is dropped and the edition kept.

Who writes these changes: **propose and distill only**, in the same plan as the rest (today's copy points). Status, promote and followup compute `rowDecision` on the pulled row, which gives the same answer for an unrecorded first-sight tick, because only propose changes a proposal and it records in the same op.

### 1.5 Agent status of a row: `rowStatus({ outcome, proposal, unreadable })`

Called by propose with the row's decision (from the pulled row) and this run's verdict:

1. `outcome !== null` and the proposal is Applies or Does not apply and differs from `outcome` → **Disagrees with your decision**.
2. `unreadable` (the verdict's `runs === 0`) → **Could not read**.
3. `outcome !== null` → **Done**.
4. proposal Can't tell → **Waits for you**.
5. else **Done**.

A row whose claim the judge did not read this run keeps its pulled status (propose does not call `rowStatus` for it).

### 1.6 The Claims summary: `claimSummary(rows, { judgedNames, edition, notChecked })`

`rows` are the claim's ledger rows **as they will be after this plan** (the pulled row merged with this plan's changes for it), restricted to tags in `judgedNames`. Returns:

| field | rule | Claims column |
|---|---|---|
| `tags` | decided rows with outcome Applies, plus undecided rows with proposal Applies and status not Could not read; sorted by code point | Agent tags |
| `waiting` | undecided rows with proposal Can't tell and status not Could not read (a ticked Can't tell row is undecided) | Tags waiting |
| `status` | the first that holds: some row Waits for you → **Waits for you**; some row Disagrees → **Disagrees with your decision**; some row Could not read → **Could not read**; else **Done** (no rows: **Done**) | Agent status |
| `confidence` | the lowest `Agent confidence` among the rows, rounded to 2; null when none | Agent confidence |
| `agent_reasons` | one line per row, tags A to Z: `"<Tag>: <Agent reason>"` (as `claimColumns` today) | Agent reasons |
| `agent_edition` | `edition` | Agent edition |
| `agent_remarks` | `notChecked ? 'not checked: ' + notChecked : ''` | Agent remarks |
| `waits`, `disagrees` | count and tag names, for the report | |

"Agent's view of your decision" on Claims is **not** here: only distill writes it (`claimReadingCell`, 2.3), as today.

`propose.mjs` keeps `claimProps` (the diff against the pulled claim) and `tagPagesOf`. `claimColumns` is deleted; `claimSummary` replaces it in propose and followup.

### 1.7 What a tag run writes on a row (the change from the live page)

Today a decided row's proposal columns are frozen. On v2 they are **not**: propose writes Agent proposal, Agent confidence, Agent reason and Rulebook edition on every row it judged, decided or not, wherever they differ. That is what the v2 page promises: "Agent disagreed puts your outcome before the agent's new answer, with the edition that answer was made under", and Decided under exists to keep the edition the editor decided under. The decision itself lives in the editor columns (Tag outcome), or in Decided under (tick), so nothing the editor did moves.

### 1.8 Readings (what changes in the item shape)

`classifyRows` keeps its item shape `{ row, claim, key, tag, decision, hash, edition, reasonWord, noteLine, citedRule }` so that distill and status change little:
- `decision` = `rowDecision(row)` (readers use `.outcome` only);
- `reasonWord` is always `null` (P45: no verbatim path);
- `noteLine` = `decision.note ?? ''`;
- `claim` = the pulled claim of `keyParts(row.Key).geo_id`, else `{ geo_id, claim: row.Claim }`.

The classes keep their keys. `verbatim` and `unjudged` are always empty arrays on v2 (keep the keys, with a comment), so `distill` and `status` keep compiling without branches. Hash: `readingHash({ outcome, proposal, noteLine, reasonWord: null, proposalEdition: row[TD.edition] })`. The function is unchanged. Rows whose live note opened with a reason word therefore get a new hash and are read by the model once: that is P45.

---

## 2. Files, one by one

Line numbers are those of `v2-page` at 20bae90.

### 2.1 lib/config.mjs
- Add `TD`, `TD_EDITOR` (1.1). `V2_PROFILE` stays. **Delete `V2_REFUSAL`** (and every import of it: loop.mjs 47, pull.mjs 41, judge.mjs 57).
- `CLAIMS_EDITOR_KEYS` and `CLAIMS_RETIRED_WRITE_KEYS`: delete the first. Keep the second (a config naming `notes` in write_columns is still refused).
- `TAG_DECISIONS_WRITABLE` (77-80) becomes `Claim, Open claim, Key, Tag, Agent proposal, Agent confidence, Agent reason, Agent status, Agent's view of your decision, Rule, Why the agent thinks so, After the rule change, Rulebook edition, Decided under, Read under`, all via `TD`. Not listed: the three editor columns, Claim link, Why wrong, Your reasoning.
- `validateConfig` (117-345), **v2 only**:
  - `profile` must be `"v2"`. Message for a missing or other value: `expected "v2": this code works on the v2 layout only (P48); the per-claim version is the git tag claim-tagger-v1`.
  - `demo: true` is refused: `practice pages are parked (P48); use the git tag claim-tagger-v1`.
  - Remove every `v2 ?` branch: the v2 rules become the rules.
    - `root_parent_page_id` is required.
    - `parent_page_id` may still be a placeholder; keep `setupFilled = true` for it.
    - `notion.claims.columns` needs `claim, link, sources, is_factual` only; any of `verified, review_status, notes` is refused.
    - `editor_columns.claims` must be `[]`.
    - `editor_columns.tag_decisions` must be exactly the three `TD_EDITOR` names.
    - `write_columns.reading` must be `"Agent's view of your decision"`; add the check, so a config with the old name fails loudly.
  - The block at 253-265 (claims editor columns vs write columns) goes. Keep a check that no `write_columns` name is in `editor_columns.tag_decisions`.
- `writableProperties` (406-435): `claims` drops the `editor` filter (there is none); `tag_decisions` is `TAG_DECISIONS_WRITABLE`. Update the doc comments at 1-30 and 394-405.
- `isV2` stays (setup-steps uses it); `isDemo` stays (dead branches in loop scripts are left alone).
- **Keep whatever step 4 (copy-live) added here** (a `COPY_SCRIPT` name or similar). Merge, don't overwrite.

### 2.2 lib/decisions.mjs
Rewrite to section 1. Header comment: the v2 rules in 15 lines or less. Imports `AGENT_STATUS`, `TD` from config.mjs. The `AUDIT_PREFIX` import goes.

### 2.3 lib/readings.mjs
- Imports: `READINGS, RULE_WHY, isFollowedUp, keyParts, recordDecisions, rowDecision, rowDisagrees` from decisions.mjs. Drop `decisionsFor, isReviewed, parseTagLines, syncDecisions`.
- `READING_COLUMNS` = `[TD.view, TD.rule, TD.why, TD.readUnder]`; `NO_READING_CELLS` the same keys. `readingCells`, `readingOfRow` and `clearedReadingCells` use those names.
- `isDisagreement(row)` → `rowDisagrees(row)` (keep the exported name; it delegates).
- `citedRule(row)` (147-151): read `row[TD.note]` instead of `Your reasoning`.
- `classifyRows({ claims, ledgerRows, rubric, config })` (173-215): iterate **ledger rows** with `isDecided(row)`, not claims (claims only name the item's claim). Build the item as in 1.8. Order: orphans (tag not judged), agree (`outcome === proposal`), fixed, current (hash matches and a reading is held), else `toRead`. No `verbatim`, no `unjudged`.
- Delete `verbatimReading` and `YOUR_NOTE_SAYS_SO` (and their uses in `ledgerAsRead` and distill).
- `ledgerAsRead` (349-356): `const { rows } = recordDecisions(ledgerRows)`, then classify; only the `agree` clearing stays.
- `claimReadingCell` (437-452): unchanged logic. `unjudged` is always empty. "Reviewed claim" in comments becomes "a claim with a decided row". Distill calls it for every claim that has at least one decided row.
- `recantedKeys` / `recantedAmong` / `recantedPhrase`: logic unchanged; `isDisagreement` is now the v2 one. The phrase "a decision you now call the agent's slip" becomes "a decision the agent now reads as its own slip" (P45: the editor never names a reason). That changes `recantedPhrase` (both forms, the `short` form "a slip" stays). Tests and the skill examples follow.
- Header comment 1-59: rewrite the rules list. No reason words; rows, not claims; Decided under carries a tick's agreed outcome.

### 2.4 lib/plan.mjs
- `checkPlan` (250-...):
  - The editor-column rule at 320-330 becomes: a property in `editorColumns(config, op.table)` is refused for every plan, unless the plan's header script is the copy script that step 4 adds (keep its allowance exactly as step 4 wrote it).
  - Delete the `seeded` (AUDIT_PREFIX on the notes column) and `demoOpen` allowances: v2 has no claims editor column, and practice pages are parked.
  - Keep `AUDIT_PREFIX` exported (pull.mjs and setup-steps use it).
- **The invisible bug guard** (OVERNIGHT.md, P47): in `applyPlan`, before sending an **update** op on `tag_decisions` whose properties hold any of `TD_EDITOR`:
  1. read the page fresh (`client.retrievePage(page_id)`, one GET), decode it with the table schema;
  2. for each editor column in the op: if the fresh value is non-empty (checkbox: `true`; select or text: non-blank) and not `sameValue` as the planned one, record the op `skipped` with error `skipped: a person set "<column>"` and send nothing for it;
  3. count it under `skipped`, never as a failure.

  Only the copy script can reach this; it protects a person's value against a re-run of the copy. Creates are not affected.
- Update the header comment (lines 1-25, 233-249): no audit seeding, no practice-page create.

### 2.5 lib/loop.mjs
- Line 47: drop `V2_REFUSAL, isV2` from the import. **Line 261-262: delete the v2 refusal.**
- `needClaimColumns` (354-387). Keep the name (eight scripts call it); the new body:
  - Claims (by `write_columns` key): `tags` relation, `confidence` number, `reasons` rich_text, `status` select, `waiting` relation, `edition` rich_text, `remarks` rich_text, `reading` rich_text. **No editor columns.**
  - Tag decisions (by `TD`): `open` relation, `right` checkbox, `outcome` select, `note` rich_text, `status` select, `view` select, `rule` rich_text, `why` rich_text, `after` select, `decidedUnder` rich_text, `readUnder` rich_text.
  - One message lists every missing or mistyped column (`run setup.mjs build`). The sentence: "nothing was done, because the tables do not have the v2 columns yet."
  - Delete `EDITOR_COLUMN_TYPES` and `LEDGER_READING_TYPES` (343-345).
- Header lines 19-20: update the `needClaimColumns` description.
- `readEvals` (828-848): unchanged.

### 2.6 lib/editor-words.mjs
- `VIEW_TABLE` (185-188): `your_queue`, `needs_your_note`, `agent_disagreed` → `'tag_decisions'`; delete `your_queue_ledger`, `needs_your_note_ledger`. Comment lines 23-25 likewise.
- Add `yourRows(n)`: "your row" / "your two rows" / "your 14 rows" (same number words as `yourClaims`). Keep `yourClaims` (add.mjs uses claims).
- The practice helpers (`practiceLink`, `practiceTitle`, `namePracticePage`, `demoCommands`) stay: loop.mjs uses them on dead demo branches.

### 2.7 pull.mjs
- Line 41: drop `V2_REFUSAL, isV2`. **Delete the refusals at 514 and 928-931.**
- Lines 49 and 52: drop the decisions re-export. Export nothing from decisions.mjs here (tests import from decisions.mjs directly). Import `rowDecision`, `isDecided` and `TD`.
- `QUEUE_COLUMNS` (70-73) = every `TD` value (18 names, Open claim included).
- `claimsNorm` (330-381): drop `verified_tags`, `review_status`, `challenged_notes` (lines 373-375). `agent_reading` stays: its internal name is unchanged, read from `write_columns.reading`.
- `queueNorm` (383-393): `decided: isDecided(row.props)`. Open claim comes through as the decoded relation (a list of page ids).
- `casesFrom` (432-449): only decided rows (`isDecided`). Each case:
  - `outcome: rowDecision(r).outcome`;
  - `why_wrong`: the row's `TD.view` when it is one of READINGS, else null (the agent's reading; the field is kept for shape);
  - `decided_edition: rowDecision(r).decided_under`, no longer Rulebook edition, which now moves;
  - `source`: `'audit of 9 October'` when Your note starts with `AUDIT_PREFIX`, else `'queue'`.
- **Pull identity (new, cheap protection for section 3):**
  - `pull()` writes `table_ids: { <table>: <data_source_id> }` into pull.json for the tables it read.
  - `loadPull(root, id, { config })`: when a config is given and the pull has no `table_ids`, or one of them differs from `tableEntry(config, t).data_source_id`, throw `pull "<id>" was taken from other tables than config.json names; take a new pull`.
  - Without this, `--pull <an old live pull>` would make plans that update rows of the live page by page id. Row page ids are in no protected list.
- Header comment 13-29: the v2 norm files, and the paragraph about decisions made on the claim goes.
- The `--source real_claims --dry-run` path (its `review_status` counts at 732 and 793) reads the real table: **leave it**.

### 2.8 judge.mjs
- Line 57: drop `V2_REFUSAL, isV2`. Delete line 239. Nothing else: the judge reads claim texts from `norm/claims.jsonl`, keyed by Geo ID.

### 2.9 schemas
- `claim-row.schema.json`: remove `verified_tags`, `review_status`, `challenged_notes` from `required` and `properties`. The description: the agent's eight columns, no editor columns; decisions are on Tag decisions.
- `ledger-row.schema.json`: the properties are the 18 `TD` names plus `page_id`, `last_edited`, `decided`.
  - `Agent is right` is boolean or null.
  - Tag outcome, Agent status, Agent's view of your decision and After the rule change are enums with null.
  - Open claim is an array of strings.
  - Remove Claim link, Why wrong, Your reasoning, Agent reading, Reading note, Follow-up.
  - Description: "decided is true when Tag outcome is set, or Agent is right is ticked on a sure proposal (rowDecision)".

### 2.10 propose.mjs (the tag step)
- Imports: `AGENT_STATUS, TD`; from decisions.mjs `CANT_TELL, claimSummary, countYourQueue, keyParts, recordChanges, rowDecision, rowStatus`; `yourRows`.
- Delete `claimColumns` (122-162) and `openClaimCount` (216). Keep `cellVerdict`, `notCheckedParts`, `tagPagesOf`, `claimProps`, `reasonsOfCell`.
- Delete the orphans warning (259-264): there is no "decided row of an un-Reviewed claim" on v2.
- Per claim the judge read (the loop at 281-366), for each verdict, `key = <geo_id>::<tag>`, `existing` = pulled row:
  - **missing row** → `plan.create('tag_decisions', key, { Claim, Key, Tag, Agent proposal, Agent confidence, Agent reason, Rulebook edition, Agent status: rowStatus({ outcome: null, proposal, unreadable }), Open claim: [claim.page_id] })`;
  - **existing row** → one update op with the union of:
    - (a) the four proposal columns where they differ (decided or not: 1.7);
    - (b) `recordChanges(existing)`, computed on the **pulled** row before (a) is applied;
    - (c) `Agent status` = `rowStatus({ outcome: rowDecision(existing).outcome, proposal: v.proposal, unreadable: v.runs === 0 })` where it differs;
    - (d) `Open claim` = `[claim.page_id]` when the pulled relation is not exactly that id (normId compare).

    No op when the union is empty.
  - Never write `TD_EDITOR`, the four reading columns or After the rule change.
- Claims columns: `after` = each judged row of the claim merged with its planned changes (or the planned create); `claimSummary(after, { judgedNames: judgedList, edition, notChecked })`. Pass `{ tags, waiting, status, agent_reasons, agent_edition, agent_remarks }` to `claimProps`; confidence as today from `summary.confidence`.
- Rows of claims the judge did not read: write `recordChanges` only (so a tick is recorded and a cleared decision is cleared), no other column. Count them under `notRead` as today.
- Counts and words:
  - `open` = rows that will be in Your queue after the plan (`countYourQueue` over all rows as after);
  - `newlyWaiting` = rows whose status goes to Waits for you from anything else;
  - `disagreed` = rows with status Disagrees after;
  - `copied` becomes `recorded` (rows whose Decided under changes).
  - Report rows: `Claims read` (claims), `Carrying <tag>`, keeping "(earlier decisions included)", `New rows in Your queue` (rows), `Agent disagreed` (`plural(n, 'row')`), `Not read yet` (claims).
  - Next: `decide ${yourRows(open)} in Your queue (link)`.
  - `counts` keys: `decisions_copied` → `decisions_recorded`. The others stay.
- Header comment 1-41: v2 rules (rows, status per row, proposals move, no editor column ever written).

### 2.11 followup.mjs
- Imports: drop `claimDisagrees, isReviewed, isToReview`; add `TD`, `claimSummary`, `rowDecision`.
- `followUp` (56-153):
  - On each supporting row, write `After the rule change` = Fixed / Still wrong where it differs (was Follow-up, line 98).
  - Also write `Agent status` = Done (Fixed) or Disagrees with your decision (Still wrong) where it differs.
  - Do **not** write the proposal columns: the next tag run does, under the new edition.
- Claims of those rows: `claimSummary` over the claim's rows as after this plan (statuses changed, others as pulled). Agent confidence as today (written only when every judged tag was checked again).
- The `left_alone` / `isDisagreement && pointsAtRule` logic (59-64) is unchanged.
- Words (184-192):
  - header `['Your row', 'After the rule change', '']`;
  - Next for Still wrong: `Next: say why in Your note on the rows in Agent disagreed (<link>).` (no Challenged tags notes);
  - the `ctx.demo` branch stays as dead code.

### 2.12 promote.mjs
- Line 65: `claimWaits` → `countYourQueue`. Line 636: `const open = countYourQueue(ctx.pull.queue() ?? [])`. The Next line there uses `yourRows`.
- The child follow-up label "Follow-up" (608) stays (a run label, not a column).
- Recanted words come from `recantedPhrase` (2.3). Nothing else: the gate reads `evals/cases.jsonl` by key.

### 2.13 status.mjs
- Imports: `countYourQueue, isDecided, recordDecisions` from decisions.mjs; drop `claimWaits, isReviewed, syncDecisions`.
- `readingCounts` (79-90): `const { rows } = recordDecisions(queue)`, then classify. The counts are **rows** (not claims): `to_read` = `toRead.length`, `pending_rule_decisions` = current rows that point at a rule, `needs_note` = toRead + current rows with an empty note.
- `countsOf` (102-131):
  - `open = countYourQueue(queue)`;
  - `decided` = rows with `isDecided`;
  - `decided_listed` = decided rows whose status is still Waits for you;
  - `unread` = claims with an empty `agent_status` (claim level; the `isReviewed` part goes).
- Words: the Your decisions cell parts are unchanged in form ("3 to read, 1 without a note"); the sentence says "rows" where it said claims ("N of your decisions" stays: a row's decision is a decision). Header comment 9-52: rows.

### 2.14 distill.mjs
- Imports: drop `isReviewed, syncDecisions`; add `recordDecisions, rowDecision, isDecided`, `TD`; drop `verbatimReading`.
- `outcomeOf` (94) = `(row) => rowDecision(row).outcome`.
- `rowOf` (100-113):
  - `reading` from `TD.view`;
  - `readingNote` from `TD.why`;
  - `reasoning` from `TD.note`;
  - `followedUp` from `isFollowedUp`.
- Line 453: `const { changes: copies, rows: queue } = recordDecisions(ctx.pull.queue() ?? [])`. The copies are now Decided under records; they ride in the same plan, as today.
- `readTheDecisions` (363-425): delete the verbatim branch (the class is empty; remove the code, keep `made.kinds.verbatim = 0` in run.json for shape).
- Claims cells (481-495): loop over claims that have at least one decided row (`queue.some(r => isDecided(r) && keyParts(r.Key)?.geo_id === claim.geo_id)`) instead of `isReviewed(claim)`.
- `groupQueue` (498): null the three `TD` reading columns instead of the old names.
- Words:
  - `needNoteNext` (702): `add a note on ${plural(n, 'row')} in Needs your note`;
  - every "claim" that counts rows becomes "row";
  - the sentence "read N of your decisions ..." stays.
- Header comment 1-55: no reason words, no verbatim, the copy step is "the agent records Decided under".
- `buildMessage` (222-245) shows `<reasoning>` = the editor's note: unchanged.

### 2.15 prompts/reading.md
- Line 3: keep. Add one sentence after line 20: "An editor's note may name a reason (for example 'Agent slip'); that is evidence of what the editor saw, not the answer: read the rules yourself."
- Line 10: `outcome` "is always right" stays. Add: "When the editor took the agent's earlier answer (they ticked 'Agent is right') and the agent now answers otherwise, read it the same way."
- No `prompt_version` here: the reading's hash does not include the prompt, so rows already read are not re-read for this edit. That is acceptable.

### 2.16 decide.mjs (rewritten around rows; same three subcommands, same marker, same exit codes)

**Input JSON of `open`:** an array of `{ "row": "<Key or Tag decisions page id>", "seen": "<12 hex>", "agent_is_right": true, "outcome": "Applies" | "Does not apply", "note": "<text>" }`.
- `row` and `seen` are required.
- At least one of `agent_is_right`, `outcome` and `note` is given; a missing one is left as it is (P24 carried over).
- `agent_is_right` may only be `true`.
- `agent_is_right` together with `outcome` is refused ("give one: the tick or the outcome").
- `agent_is_right` on a row whose proposal (in the fresh pull) is not Applies or Does not apply is refused: "a tick on Can't tell decides nothing; give an outcome".
- Extra keys are refused.

**Fingerprint:** `fingerprintOf(pageId, cells)` = first 12 hex of `sha256(JSON.stringify([hex(pageId), cells.right, cells.outcome, cells.note, cells.proposal]))`, where `cells = { right: boolean, outcome: trimmed text, note: trimmed text with \n line ends, proposal: trimmed text }`. The proposal is in it because a tick agrees with the proposal as shown.

**`list`:**
- (no flag) the rows `inYourQueue`, sorted like the view: Claim text A to Z (`localeCompare(b, 'en', { sensitivity: 'base' })`), then Agent confidence lowest first.
- `--claims <Geo IDs or Keys>`: every row of the named claims (a Key names one row).
- `--all`: every row, in the compact block.

**The full block of a row:**
- its number, then Key and page id;
- `<claim>`, the claim text, fenced as today;
- Tag, then Agent proposal and confidence;
- Agent reason, then `Agent's view of your decision` with Rule and `Why the agent thinks so`;
- `Agent is right now`, `Tag outcome now`, `Your note now`;
- `seen`.

Rows of one claim come together under one claim line. The rulebook block and the tag-id map stay. Tag ids are no longer needed for writing, so drop the tag-id map if nothing else uses it.

**`open`:**
- It pulls fresh, refuses as today and records `decisions.json` (fields given, what each row held before, `seen`, `had_decision`).
- It writes `runs/DECIDING` with `page_ids` = the rows' page ids.
- It prints per row a change summary and the connector input: `{ page_id, command: 'update_properties', allow_async: false, properties }` where `properties` holds only what was given:
  - `"Agent is right": "__YES__"`;
  - `"Tag outcome": "<Outcome>"`;
  - `"Your note": "<text>"`.
- The checkbox value form must be checked against the connector's update-page schema at implementation (section 7, R12). The guard accepts exactly what `open` prints.

**`check`:** pulls Tag decisions fresh and compares each recorded row: `right === true` when a tick was given, `outcome` when given, the note (trimmed) when given. A row whose given fields still hold what they held before is "not written"; any other difference, or a missing row, is a mismatch.

**The report of `check`:**
- the sentence: `Decide: N rows decided and read back; K differ from the agent.`;
- rows `Decided`, `Same as the agent` (a tick, or an outcome equal to the proposal), `Different from the agent` ("k, all with a note" / "k, j with a note"), and `Changed an earlier decision` (rows that `had_decision`; only when > 0);
- Next: `type /claim-tagger distill to read the decisions.`

**Delete:**
- `resolveClaim` → `resolveRow(rows, ref)`: the Key exact, else the page id, else the Key case-insensitive;
- `tagIds` use for writing;
- every `verified_tags` / `review_status` / `challenged_notes` reference.

The practice-page root comment (32-33) goes: decide runs on the agent root only.

### 2.17 hooks/guard.mjs
- `DEFAULT_EDITOR_NAMES` (50) = `['Agent is right', 'Tag outcome', 'Your note', 'Editor wording', 'Paused']`.
- `DEFAULT_CLAIMS_COLUMNS` → `DEFAULT_DECIDE_COLUMNS = ['Agent is right', 'Tag outcome', 'Your note']`.
- `decideWrite` (163-187):
  - `columns` = `config.editor_columns.tag_decisions` when it is a non-empty list, else `DEFAULT_DECIDE_COLUMNS`.
  - **Bug today:** with the v2 config, `editor_columns.claims` is `[]`, so the code falls back to the per-claim defaults. This change fixes it.
  - Value rules replace `DECIDE_REVIEW_VALUES`: Tag outcome must be `Applies` or `Does not apply`; Agent is right must be `"__YES__"` (also accept boolean `true` if R12 says the connector takes booleans); Your note must be a string.
- `decidingPageIds` (129-160): drop the `runs/demos/*` markers (practice pages are parked); only `<root>/runs/DECIDING` counts.
- Header comment 11-19: rows of Tag decisions, the three columns, the values.
- Everything else (protected ids first, always-denied tools, the SETUP builder rules) is unchanged.

### 2.18 transcript-check.mjs (and headless-check.mjs)
- `DEFAULT_DECIDE_COLUMNS` = the three Tag decisions columns; `decideColumns` is read from `config.editor_columns.tag_decisions`.
- Replace `reviewColumn` (22, 215-220) with the value rules of the guard (Tag outcome values, the tick value).
- `DEFAULT_EDITOR_COLUMNS` follows the guard's list.
- headless-check.mjs: only comments mention `demo decide`; leave the code, and fix the comment if you touch the file.

### 2.19 add.mjs
- Line 44: drop the `isReviewed` import. Line 355: `unread: String(held.agent_status ?? '').trim() === ''`.
- `needClaimColumns` is called as today and now checks v2 columns. The `ctx.demo` refusal (292) stays.
- The plan is unchanged (Geo columns only, `ADD_SCRIPT` allowance).

### 2.20 rollback.mjs, restore.mjs
No code change: they write When to use and Rule changes Status only. Their tests run in WP2 to prove it.

### 2.21 Parking (P48)
- `walkthrough.mjs` `main` (1871): before parsing, print to stderr and return `EXIT.INVALID`: `walkthrough: the practice pages are parked: this branch works on the v2 layout only (P48). The walkthrough runs on the git tag claim-tagger-v1 (git worktree add ../geo-agents-v1 claim-tagger-v1).` Nothing else in the file changes.
- `demo-mocks.mjs` (254): the same refusal for every subcommand.
- `.claude/skills/claim-tagger-walkthrough/SKILL.md`: a first paragraph under the title saying the skill is parked and why, and that it answers with one sentence naming the git tag, without running anything.
- `/claim-tagger demo <anything>` (the claim-tagger skill): answers `Demo: nothing was done, because the practice pages are parked; they run on the version tagged claim-tagger-v1.` with Next `ask the engineer for the practice version.`

### 2.22 v2-profile.mjs and lib/v2-profile.mjs
- `buildV2Config` and the `init` subcommand go: the v2 config is `config.json` now, and `validateConfig` refuses a production config, so `buildV2Config` could not validate its input anyway.
- `completeStructure` and the `structure` subcommand stay; its default target becomes `<agentRoot>/setup/structure.json`, and it refuses without `--replace` when the file exists.
- `v2Root` goes.

### 2.23 setup.mjs and lib/setup-steps.mjs (only what verify and refusals need)
- `seed-audit`, `migrate-decisions` and `archive` refuse on v2: `"<step> is a per-claim step of the first page (P48); the v2 page is filled by copy-live.mjs"`, exit 2.
- `ALL_STEPS_HUB` / `ALL_STEPS` drop `seed-audit` and `migrate-decisions`.
- `stepVerify` (990-...), when `isV2(config)`:
  - the seeded-row check (1112-1129) compares Claim, Tag and Tag outcome only (no Claim link, Why wrong, Your reasoning or AUDIT_PREFIX);
  - skip the migrated-decision block (1131-1155);
  - a missing audit file or pick is not a difference on v2 (the copy, not the pick, filled the tables).
- Nothing else in setup changes (build, views and hub already work on v2: checkpoint 1).

### 2.24 Skills (sentences to change, not the new text)
Line numbers are from the current files. "→" gives the direction.

**`.claude/skills/claim-tagger/SKILL.md` (165 lines)**
- 13: every sentence naming Verified tags, Review status and Challenged tags notes as the editor's columns, and "Agent reading" → the three Tag decisions columns, "Agent's view of your decision".
- 21: "the 200 Geo claims ... decided by the editors" → rows are decided.
- 26 (tag row): "copy the editor's decisions into its ledger", "write the agent's side of the claims table" → records decisions on rows, writes Agent status per row and the Claims summary.
- 29-30 (decide rows of the subcommand table): "decide claims", `--claims <Geo IDs>`, "one connector call per claim", and the demo decide check → rows, `--claims` takes Geo IDs or Keys, one call per row; demo gone.
- 31 (distill row): "the ones that blame a rule" may stay.
- 36: the `demo <subcommand>` row → parked (2.21).
- 59-61: the whole "Demo mode" section → one parking paragraph.
- 63-116, the "Deciding" section, rewritten for rows:
  - 65: the three Claims properties → the three Tag decisions columns.
  - 70-71: "the first N claims", "claims in Needs your note" → rows.
  - 75-79: the list blocks, `seen` over Verified tags/note/Review status → over the tick, outcome, note and proposal.
  - 83-89: the draft table "Tags now → after" → one line per row: Tag, agent says, decision (tick or outcome), note.
  - 87: "changes an earlier review" → "changes an earlier decision".
  - 99-102: **delete** the `<Tag>:` prefix rule and every reason-word instruction (Agent slip / Rule unclear / Rule should change, "write your own line ..."). The note is plain words for one row.
  - 106-110: the JSON shape (`verified_tags`, `note`, `seen`) → the v2 shape (2.16); the summary example "c03: tags Context-dependent → none" → a row example; "changed an earlier review" → "earlier decision".
  - 112: "what is your reason" → "why (in your words)".
  - 116: the demo decide paragraph → delete.
- 124, 134: Next-line words "decide your N claims", "the claims in Agent disagreed" → rows. 134's "a decision they now call the agent's slip" → "a decision the agent now reads as its own slip".
- 142-163, examples: the status example stays (it already says rows); delete the demo promote example (155-163) or replace it with the production one.

**`references/guide.md` (111 lines)**
- 10-12: delete the Demo-list rules; 11-12's column list (Verified tags, Challenged tags notes, Review status) and "start a note with a reason word" → the three Tag decisions columns; no reason words.
- 16-23, the table of when to add which checklist:
  - delete the demo rows (21-23);
  - 17-18: "decision you now call the agent's slip" → "the agent now reads as its own slip";
  - 20: "add a note in Challenged tags notes on the claims in Agent disagreed" → "say why in Your note on the rows in Agent disagreed".
- 25-33, Decide in Your queue (real): rewrite as rows.
  - "A claim leaves Your queue ... Review status Reviewed" → "a row leaves when you tick Agent is right or set Tag outcome".
  - "fill in three columns" → tick or outcome, note optional.
  - Delete 32's reason-word sentence.
- 35-41: delete (Demo).
- 47-51, Needs your note: "the claims where you decided against the agent" → rows; "Agent reading next to your Verified tags" → "Agent's view of your decision and Why the agent thinks so"; "Add a line in Challenged tags notes for the tag ..." → "write Your note on the row"; delete 50 (reason words).
- 53-59: delete (Demo).
- 68: "a decision you now call the agent's slip" → the agent's reading.
- 71-77, 89-95: delete (Demo).
- 101-103, Agent disagreed: claims → rows; "Agent reasons and Agent reading next to your Verified tags and Challenged tags notes" → "Agent proposal, Agent reason and Agent's view of your decision next to your Tag outcome"; "Add to Challenged tags notes ... start them with Rule unclear ..." → "say in Your note what the rule misses", no reason words.
- 106-111: delete (Demo).

**`references/report-examples.md` (467 lines)**
- 3, 5: the editor fills the three Claims columns, demo wording → the three Tag decisions columns; delete the demo sentence.
- Delete every demo example and every walkthrough example: 24-88, 104-207, 224-230, 260-296, 417-467. Before deleting, keep one production form of each kind that only had a demo form: distill (normal, without a note, nothing to read), promote held (recanted), promote FAIL, follow-up by hand. Turn the demo text into production wording ("Demo · " and "(practice page ...)" removed, `/claim-tagger demo x` → `/claim-tagger x`, "four claims" → rows).
- 92-102 (tag, Claims): "decided audit claims keep the editor's tags" → the decided rows count; "9 wait for you" and "decide your nine claims" → rows.
- 211-222 (promote PASS): `Your 2 rows | ... marked Fixed` → "marked Fixed in After the rule change".
- 298-311 (decide): the paragraph and the table, rewritten for rows.
  - "the three Claims columns" → the three Tag decisions columns.
  - "A note, as the code counts it, is a reason word ... or the editor's own words" → "a note is the editor's own words".
  - "Changed an earlier review" → "Changed an earlier decision".
  - "the Claims table" → "Tag decisions".
- 343-359 (add): "is not Reviewed (the agent has not read it)" → "has no Agent status".

**`references/import.md`:** no change (3: "no demo import" stays true; 30: "pull only the claims table" stays true).

**`.claude/agents/editor-persona.md`:** mentions the walkthrough; no change tonight (it is a reviewer persona).

### 2.25 Docs
- `agents/claim-tagger-mvp/AGENT.md`: the paragraphs on deciding on Claims, the reason words, practice pages and the v2 profile → a short "v2 (since 31 Oct, P48)" section: where decisions are, the parked walkthrough, the tag.
- `README.md`: lines 5-8, the hub is "Claim tagger v2". One paragraph each. `CONTRACTS.md`: not tonight (say so in the work log).

---

## 3. Local state: runs/, rubric/, setup/, evals/

### 3.1 What is keyed by what

| path | keyed by | portable to v2? |
|---|---|---|
| `runs/judgments/<key16>/run-*.jsonl` | store key = model, effort, prompt version, group, **tag hashes (name + rules)**; lines by Geo ID + hash of the claim text | **yes**: same claims, same rules. Carrying it saves re-judging 600 claims |
| `runs/pull/<id>/`, `runs/pull/LATEST` | Notion page ids of the live rows, live schemas | **no**: a plan made from it updates live rows by page id |
| `runs/<stamp>-<script>/plan.jsonl`, `ledger.jsonl` | op index, Key, **live page ids** | no (history) |
| `runs/<stamp>-distill/readings.jsonl` | Key + reading hash | harmless (only `--readings <run>` reuses it; keys match, hashes mostly won't) |
| `runs/DECIDING` | live Claims page ids | no |
| `runs/PROMOTING.json`, `runs/PAUSED`, `runs/SETUP` | none | must not carry; check none exists |
| `runs/builder/` (pages.json, databases.json, state.json, verify.json) | the live hub's pages and tables | **no**: the guard's SETUP rules and setup steps would treat the live hub as the build target. v2's is `profiles/v2/runs/builder/` |
| `runs/demos/`, `runs/demo-mocks/` | practice pages | parked |
| `runs/dry-run/`, `runs/geo-pick/`, `runs/geo-query/`, `runs/20261029-import-400-add/` | history | not needed |
| `evals/cases.jsonl` (tracked) | Key | yes; rewritten by the first v2 pull |
| `evals/canaries.jsonl` | none | yes |
| `rubric/rubric.json`, `rubric.lock`, `history/`, `CHANGELOG.md` | rules by tag name; `tags[].page_id` = **live Rulebook rows**; `source` = live Rulebook ids | rules yes; page ids **no** |

### 3.2 Recommendation: start `runs/` fresh, carry only the judge store
Do this in step 5, with no command running:

1. `runs/` → `runs-v1/` (rename). Add `agents/*/runs-v1/` to `.gitignore`.
2. New `runs/`. Copy `runs-v1/judgments/` → `runs/judgments/` (a copy: v1 stays whole).
3. Copy `profiles/v2/runs/builder/` → `runs/builder/`. Copy `profiles/v2/runs/<stamp>-setup-*` run folders too, for history; they are optional.
4. Leave `runs-v1/` alone. It is the per-claim history, readable, never run against.

What breaks if `runs/` is kept as it is:
- `decide list`, judge and status read the newest pull on disk (the live one) until a v2 pull is taken. `--pull <old id>` makes plans that write **live rows** by page id: hard rule 10. The `table_ids` check of 2.7 closes this for old pulls; the fresh `runs/` closes it on day one.
- `runs/builder/` points setup and the guard at the live hub.

### 3.3 rubric/
- Rules are portable; page ids are not. `tagPagesOf` and the pull's relation resolution fall back to `rubric.json` page ids, and a relation write with a live Rulebook id onto v2 Claims fails at Notion.
- **Do not use `setup.mjs rubric`** for this. It builds from the taxonomy file, whose When to use predates the promotes of 28 and 29 Oct, so it refuses ("in force already with other rules").
- Instead write the **next edition** with `lib/rubric.mjs` `writeEdition`:
  - the same tags and rules as `2026-10-29.1`;
  - `page_id` of each tag = the v2 Rulebook row of that name (from a v2 pull);
  - `source` = the v2 Rulebook ids;
  - CHANGELOG: "Claim tagger v2 (P48): the v2 Rulebook, same rules, new page ids".

  Tag hashes do not change, so the judge store stays valid.
- Then:
  - The first loop run writes the new edition to Agent settings. `setup.mjs verify` reports a mismatch until then.
  - Every row's Rulebook edition is updated by the first tag run, so every disagreement is read once more at the next distill (tens of rows, model calls; accepted, R7).
- Also write `setup/rulebook-pages.json` with the v2 ids, so later setup steps agree.

### 3.4 setup/

| file | v2 | action |
|---|---|---|
| `structure.json` | live layout | replace with `profiles/v2/setup/structure.json` (git mv); the live one goes to `setup/v1/structure.json` |
| `taxonomy-issue.json` | same taxonomy | **keep** (verify, canaries read it) |
| `geo-claims-pick.json` | the 200 picked claims, by Geo ID | **keep** (verify compares their Geo fields; the copy carries them unchanged) |
| `rulebook-pages.json` | live Rulebook ids | move to `setup/v1/`; write a v2 one (3.3) |
| `claims-pages.json` | live Claims page ids | move to `setup/v1/` |
| `audit-decisions.json` | Geo IDs, per-claim seeding | move to `setup/v1/` (verify on v2 skips it, 2.23) |
| `archive.json`, `archive-2026-10/` | the live hub's archive (P9) | move to `setup/v1/` (the builder reads `archive.json` only to skip archived children of the hub; the v2 page has none) |
| `first-page.json` (new, step 4) | the copy's source | **keep in place** (copy-live reads it) |

`setup/v1/` is a plain folder that no step reads. `git mv` keeps the history.

---

## 4. The config swap (step 5; WP1 checks it was done)

1. `config.json` ← content of `profiles/v2/config.json`, then `git rm profiles/v2/config.json`. **Keep `"profile": "v2"`** as the marker `validateConfig` requires (2.1). It also makes a per-claim config from the tag fail with a sentence that names the tag. Keep `root_parent_page_id`.
2. In it, change `notion.claims.write_columns.reading` from `"Agent reading"` to `"Agent's view of your decision"` (the v2 Claims column was renamed at checkpoint 1; the profile config was not). Nothing else changes: table ids, views, editor columns (`tag_decisions: [Agent is right, Tag outcome, Your note]`, `claims: []`) and the protected lists, which already hold every live table, view and page, are right.
3. `setup/structure.json` ← `profiles/v2/setup/structure.json` (3.4).
4. `runs/` as in 3.2; rubric as in 3.3.
5. `profiles/v2/` keeps only its gitignored `runs/` as history. Do not leave a second state root with the same table ids: two roots would mean two DECIDING markers, two PROMOTING locks and two ledgers for one set of tables.
6. `CLAIM_TAGGER_MVP_ROOT` still works: it points the scripts at another state folder, which must hold a v2 config. Practice-page folders (`runs/demos/<id>`) hold demo configs, which `validateConfig` now refuses, so the parked walkthrough cannot run even through the variable. The guard always reads the code root's `config.json`.
7. Undo of the whole night: the git tag `claim-tagger-v1` plus `runs-v1/` renamed back.

---

## 5. Work packages (sequential; no file in two packages)

Each package ends with its green target, a commit on `v2-page`, a line in OVERNIGHT.md's log, and a list of the tests outside its target that it left red (expected until a later package).

### WP1: the model, config, pull, plan, loop (foundation)
Files:
- `scripts/lib/config.mjs`, `scripts/lib/decisions.mjs`, `scripts/lib/readings.mjs`, `scripts/lib/plan.mjs`, `scripts/lib/loop.mjs`, `scripts/lib/editor-words.mjs`
- `scripts/pull.mjs`, `scripts/judge.mjs` (refusal only)
- `schemas/claim-row.schema.json`, `schemas/ledger-row.schema.json`
- tests:
  - fixtures and helpers: `tests/mvp/fixtures/config.placeholder.json` (v2 shape, 6.2), `tests/mvp/helpers/config-fixture.mjs` (comment only), `tests/mvp/helpers/tables.mjs` (v2 TABLE_SPECS), `tests/mvp/helpers/loop-world.mjs` (v2 helpers, 6.2);
  - test files: `decisions.test.mjs`, `readings.test.mjs`, `config.test.mjs`, `plan.test.mjs`, `pull.test.mjs`, `schemas.test.mjs`, `editor-words.test.mjs`, `loop.test.mjs`, `judge.test.mjs`;
  - new: `tests/mvp/editor-columns.test.mjs`.

First check that section 4 (steps 1-2 at least) is done; if not, do steps 1-2 here (they touch only `config.json` and `profiles/v2/config.json`, which no other package touches).

Green: `node --test tests/mvp/decisions.test.mjs tests/mvp/readings.test.mjs tests/mvp/config.test.mjs tests/mvp/plan.test.mjs tests/mvp/pull.test.mjs tests/mvp/schemas.test.mjs tests/mvp/editor-words.test.mjs tests/mvp/loop.test.mjs tests/mvp/judge.test.mjs tests/mvp/editor-columns.test.mjs`

### WP2: tag, status, follow-up, promote, add
Files:
- `scripts/propose.mjs`, `scripts/followup.mjs`, `scripts/promote.mjs`, `scripts/status.mjs`, `scripts/add.mjs`
- tests: `propose.test.mjs`, `propose-failures.test.mjs`, `followup.test.mjs`, `promote.test.mjs`, `status.test.mjs`, `add.test.mjs`, `rollback.test.mjs`, `restore.test.mjs`, `helpers/promote-scenario.mjs`

Green: WP1's target plus `node --test tests/mvp/propose.test.mjs tests/mvp/propose-failures.test.mjs tests/mvp/followup.test.mjs tests/mvp/promote.test.mjs tests/mvp/status.test.mjs tests/mvp/add.test.mjs tests/mvp/rollback.test.mjs tests/mvp/restore.test.mjs`

### WP3: distill, decide, guard, transcript check
Files:
- `scripts/distill.mjs`, `scripts/decide.mjs`, `scripts/hooks/guard.mjs`, `scripts/transcript-check.mjs`, `scripts/headless-check.mjs` (comments only, if at all)
- `prompts/reading.md`
- tests: `distill.test.mjs`, `decide.test.mjs`, `decide-fixes.test.mjs`, `guard.test.mjs`, `guard-decide.test.mjs`, `transcript-check.test.mjs`, `transcript-check-decide.test.mjs`, `helpers/decide-world.mjs`, and the transcript fixtures under `tests/mvp/fixtures/transcripts/` that carry Claims decide calls

Green: WP1 + WP2 targets plus `node --test tests/mvp/distill.test.mjs tests/mvp/decide.test.mjs tests/mvp/decide-fixes.test.mjs tests/mvp/guard.test.mjs tests/mvp/guard-decide.test.mjs tests/mvp/transcript-check.test.mjs tests/mvp/transcript-check-decide.test.mjs`

### WP4: parking, setup, skills, docs, the whole suite
Files:
- scripts: `scripts/walkthrough.mjs` (main only), `scripts/demo-mocks.mjs`, `scripts/v2-profile.mjs`, `scripts/lib/v2-profile.mjs`, `scripts/setup.mjs`, `scripts/lib/setup-steps.mjs`
- skills: `.claude/skills/claim-tagger/SKILL.md`, `.claude/skills/claim-tagger/references/guide.md`, `.claude/skills/claim-tagger/references/report-examples.md`, `.claude/skills/claim-tagger-walkthrough/SKILL.md`
- docs: `agents/claim-tagger-mvp/AGENT.md`, `agents/claim-tagger-mvp/README.md`
- tests:
  - delete `walkthrough.test.mjs`;
  - edit `setup.test.mjs`, `notion-build.test.mjs`, `hub.test.mjs`, `archive.test.mjs`, `two-way.test.mjs`, `v2-profile.test.mjs`, `notion-blocks.test.mjs`, `report.test.mjs`, `cli.test.mjs`, `preflight.test.mjs`, `helpers/setup-world.mjs`, and any file still red after WP3 that no earlier package owned.

Green: `node --test tests/mvp/` with 0 failures, and `npm test` from the repo root (it also runs the old agent's `tests/*.test.mjs`, which this port does not touch).

Then step 7 of OVERNIGHT.md (the proof on v2) runs, not part of these packages.

---

## 6. Tests

### 6.1 Rewrite (per-claim behaviour)
Approximate test counts in brackets.

| file | why |
|---|---|
| `decisions.test.mjs` [18 → ~30] | the whole model: rowDecision's table (1.3), recordChanges cases (1.4), rowStatus (1.5), claimSummary (1.6), inYourQueue |
| `readings.test.mjs` [27] | rows not claims, no verbatim, renamed columns, the new recanted phrase |
| `propose.test.mjs` [45], `propose-failures.test.mjs` [10] | per-row writes, moving proposals, the tick recorded, Open claim, the Claims summary |
| `status.test.mjs` [42] | counts are rows; Your queue = the view's filter |
| `distill.test.mjs` [51] | ticks count as decisions, Decided under records, no verbatim, renamed columns |
| `followup.test.mjs` [16] | After the rule change, row status, claimSummary |
| `decide.test.mjs` [35], `decide-fixes.test.mjs` [18] | the row JSON, the fingerprint, list order, check |
| `guard-decide.test.mjs` [21], `guard.test.mjs` [7] | the three Tag decisions columns and their values; no demo markers |
| `transcript-check-decide.test.mjs` [13] | decide columns and values |
| `promote.test.mjs` [58, about a third touched] | open-row count, words, recanted phrase |
| `pull.test.mjs` [31, partly] | norm files, cases.jsonl, `table_ids` refusal |
| `config.test.mjs` [35, partly], `plan.test.mjs` [35, partly] | v2-only validation; editor-column refusal; the bug guard |
| `add.test.mjs` [56, lightly], `schemas.test.mjs` [23, lightly], `editor-words.test.mjs` [19, lightly], `loop.test.mjs` [8], `judge.test.mjs` [79, the V2-refusal cases removed], `transcript-check.test.mjs` [106, the decide-column cases] | small edits |

### 6.2 Fixtures and helpers
- `fixtures/config.placeholder.json` becomes the v2 shape:
  - `profile: "v2"`, `root_parent_page_id` (a real-looking id that is in no protected list);
  - `notion.claims.columns` without the three editor keys, `write_columns.reading` renamed;
  - `editor_columns.claims: []`, `editor_columns.tag_decisions`: the three;
  - `pages` placeholders as in the v2 config.

  The comment in `config-fixture.mjs` says "v2 since P48".
- `helpers/tables.mjs`: TABLE_SPECS for Claims (no editor columns, `Agent's view of your decision`, the `Tag decisions` relation) and Tag decisions (the 18 `TD` columns; Open claim a relation to Claims).
- `helpers/loop-world.mjs`:
  - **delete** `review`, `editClaim`'s Verified tags/notes handling and `withReasonWord`;
  - **add** `w.decideRow(key, { right, outcome, note })`, an editor on one row (writes only the given editor columns), and `w.ledgerRow(key)`;
  - the audit seeding writes v2 rows (Tag outcome, Your note starting with the audit prefix, Decided under, Open claim) and no Claims editor columns.

### 6.3 Delete (P48, the cleaner option)
- `walkthrough.test.mjs` (97 tests). The walkthrough and its tests live at `claim-tagger-v1`; the port will be written anew against v2 tables.
- In `setup.test.mjs`: the cases of `seed-audit` and `migrate-decisions` (~10-15). Replace them with one case each for the refusal.
- In `v2-profile.test.mjs`: the `buildV2Config` / `init` cases (~15). The `completeStructure` cases stay.
- Demo-only cases in `report.test.mjs`, `notion-blocks.test.mjs` (the walkthrough page lint), `status.test.mjs` (practice-page Next lines) and `followup.test.mjs` (the demo Next line). Delete each case whose only subject is a practice page. A grep for `demo` / `practice` / `walkthrough` in the file finds them.

Delete rather than `test.skip`: skipped tests of parked code rot silently, and the tag keeps them whole.

### 6.4 New tests (~40)
- `editor-columns.test.mjs`: reads every `.mjs` under `agents/claim-tagger-mvp/scripts/` except `lib/decisions.mjs`, `lib/config.mjs`, `walkthrough.mjs`, `demo-mocks.mjs`, `lib/demo-profile.mjs`, `lib/setup-steps.mjs` and the copy script. It fails on any `['Tag outcome']`, `['Agent is right']`, `['Your note']`, `TD.outcome]`, `TD.right]` or `TD.note]` property read. Plan code may name the columns as data only through `TD_EDITOR`.
- In `decisions.test.mjs`:
  - tick on a sure proposal (first sight / recorded / proposal moved later);
  - tick on Can't tell;
  - tick plus outcome (equal / different);
  - untick clears Decided under;
  - tick then outcome drops the suffix;
  - an outcome value outside the two counts as empty.
- In `plan.test.mjs`:
  - every loop script's plan writing an editor column of Tag decisions is refused;
  - the copy script's update over a non-empty editor value is skipped (with a fake `retrievePage`), and over an empty one it is sent.
- In `pull.test.mjs`: `loadPull` refuses a pull without `table_ids` or with other ids.
- In `config.test.mjs`:
  - a production (per-claim) config is refused with the tag in the message;
  - `demo: true` is refused;
  - `write_columns.reading` "Agent reading" is refused;
  - the live `config.json` validates.
- End to end in `distill.test.mjs` or `promote.test.mjs` with loop-world: tag → `decideRow` (a tick on a sure row, an outcome against the agent with a note, one without a note) → distill (reads two, Needs your note shows one) → promote PASS → follow-up marks After the rule change and row status.
- `guard-decide.test.mjs`:
  - `"Tag outcome": "Reviewed"` denied;
  - `"Agent is right": "__NO__"` denied;
  - a Claims page listed in a marker but with Claims columns denied;
  - `editor_columns.claims: []` no longer falls back.
- WP4:
  - `walkthrough.mjs` and `demo-mocks.mjs` refuse with exit 2 and the tag in the message;
  - `setup.mjs seed-audit`, `migrate-decisions` and `archive` refuse on v2;
  - `stepVerify` on a v2 world with the audit file present reports no audit difference.

Roughly: ~350 tests edited across 22 files, ~130 deleted (97 + ~35), ~40 new.

---

## 7. Risks and open points (recommended answers)

| # | point | recommended answer |
|---|---|---|
| R1 | Where does a tick's agreed outcome live, since the agent never writes Tag outcome and the proposal moves? | In Decided under, as `"<edition> · agreed <Outcome>"` (1.3-1.4). It is durable, in Notion, readable by an editor, and survives a fresh `runs/`. No new column, no local file |
| R2 | Do decided rows' proposals move with later tag runs (live: frozen)? | Yes (1.7). The v2 spec's Agent disagreed view and Decided under both assume it. Cost: each edition change re-reads the disagreements once |
| R3 | **Your queue is empty after the copy** until rows carry Agent status per row (the view filters on it) | If copy-live does not derive row status, run a **full `tag`** after the port, before the team sees the page. With `runs/judgments/` carried (3.2) it makes no model call: it is ~600-1200 Notion writes (Agent status, Rulebook edition, Open claim, Decided under) at 3 a second, about 5-7 minutes. Take `--plan-only` first and check the counts. Step 7's "at most 10 rows" limit is about model cost and does not apply to this no-model run |
| R4 | The rubric for v2 | The next edition by `writeEdition`, same rules, v2 page ids (3.3); not `setup.mjs rubric` |
| R5 | Old live pulls in `runs/` | Fresh `runs/` (3.2) plus the `table_ids` check in `loadPull` (2.7). Both, because the second also protects any future table change |
| R6 | The Claims Agent status when rows differ | Waits for you > Disagrees > Could not read > Done (1.6). Waiting needs the editor's action; the rows say which |
| R7 | Re-reading cost after the copy (reason-word rows, then the edition bump) | Accept. Tens of rows at `reading_batch` 10, medium effort. Distill's usage-window stop (exit 75) handles a cut |
| R8 | A ticked row the agent later disagrees with is read "without your note" and lands in Needs your note, whose hint says "You overruled the agent" | Accept for tonight (it needs a promote and a re-tag to happen). Note it for the owner: the hint could say "you decided" instead |
| R9 | step 4 (copy-live) edits `plan.mjs` / `config.mjs` in parallel with this design | WP1 starts after step 4 is committed and merges into its version: the copy allowance stays, the bug guard (2.4) applies to the copy too. "The first page wins" then means: it fills empty v2 cells and never overwrites a value a person set on v2. Tonight the v2 editor columns are empty, so nothing differs |
| R10 | The `decide list` order vs Notion's "Claim A to Z" for "the first N" | Sort with `localeCompare('en', { sensitivity: 'base' })`, then confidence. `list` prints row numbers and Claude uses them, so a rare collation difference shows in the draft the editor OKs |
| R11 | Tag outcome set on a Can't tell row: status Done, but readings treat it as a disagreement and read it | As live. That is right: the editor decided what the agent could not, and the reading tells whether a rule is unclear |
| R12 | The connector's checkbox value form in notion-update-page | `open` prints `"__YES__"` (the Notion connector's documented checkbox form). The WP3 coder checks the connector's tool description in the session (ToolSearch for notion-update-page) before committing. If it takes booleans, `open` prints `true` and the guard accepts exactly that one form. Never accept both silently in production: the guard accepts what `open` prints |
| R13 | `evals/cases.jsonl` is tracked and has an uncommitted change from a live pull | The first v2 pull rewrites it from v2 rows (same keys, `decided_edition` from Decided under). Commit it in step 7 with the proof, saying so in the log |
| R14 | Follow-up after a promote writes After the rule change and row status, not the new proposal | As 2.11. The next tag run brings proposals under the new edition; the views read status, which is right at once |
| R15 | `setup.mjs verify` on v2 | The v2 branch of 2.23. Until the first loop run writes the new edition, verify reports the Agent settings edition mismatch: run `tag` before `verify` in step 7 |
| R16 | Dead `ctx.demo` branches in the loop scripts | Leave them (smaller diffs; `validateConfig` refuses demo configs). Remove them when the walkthrough is ported |
| R17 | A person sets Tag outcome to a value Notion lets them add (a third option) | Treated as undecided. Propose adds a run warning naming the row; no write. The editor sees the row stay in Your queue |
| R18 | A propose run racing an editor's tick (the tick lands between the pull and the write) | The tick is recorded on the next run against the proposal then shown. P46's wording ("the proposal the row showed when the agent first finds the tick") covers it. Accept |
| R19 | The guard's demo markers and `runs/demos/` | Dropped (2.17). A live practice page's DECIDING marker can no longer open a write window |
| R20 | Hard rule 1's "loop scripts never overwrite a person's value" | Holds by construction: no loop plan can name an editor column (checkPlan), and the copy is guarded at apply time (2.4). The editor-columns test (6.4) keeps the readers honest |
