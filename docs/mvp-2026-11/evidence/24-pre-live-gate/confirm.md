# Pre-live gate, last step: the Opus confirmation of the second fix pass, 2026-10-27

Checked at da08d57, the merge of the fix commit 51c28a4 on top of 0682844. I read the code myself and did not rely on the commit message.

- No Notion call and no Geo call was made.
- Nothing ran in the real agent folder. Its `config.json` and `runs/builder/state.json` have the same checksums before and after, and git status did not change.
- The only file written in the repo is this one.

**Verdict: GO.** MF-1, MF-2, the Rulebook nit, SH-1 and the guide wording are all fixed. No hard rule is broken. Five small concerns are listed at the end. None of them blocks the runbook.

## 1. MF-1: Your queue keeps the claims with no Review status. PASS

- "<select> is not X" is now sent as `{ or: [ does_not_equal X, is_empty ] }` (notion-build.mjs:342-348).
- Your queue's filter is therefore an `and` that holds this `or`. The plan body shows it, and only the filter of that view changed.
- `canonFilter` merges only groups of the same kind (notion-build.mjs:1600-1611). So the `or` stays inside the `and` on both sides of every comparison.
- The comparison is the same in all three places: `viewDifferences` (1108), `reconcileView` (1116-1136) and verify's `compareViews` (1675-1677).
- The practice page's manifest check compares the words only (walkthrough.mjs:1260-1264). The words did not change.
- A rerun sends nothing, and verify is clean (hub.test.mjs:627).
- I also checked the old bare filter. Verify names it, the next build sends exactly one PATCH with the filter only, and the build after that sends nothing (hub.test.mjs:627).
- The fake has the new option `emptySelectIsNot` (fake-notion.mjs:130 and 570).
- The tests list a claim that waits with an empty Review status under both readings, and not a Reviewed one (hub.test.mjs:600; fake-notion.test.mjs:636).
- The same test shows that the old bare filter loses those claims on the strict reading.
- `status` counts what the view lists: the test checks `claimWaits` against the view's rows.
- structure.json is unchanged except the Rulebook edit (check 3).
  - I compared the old and new structure files: the filter words are identical.
  - The frozen walkthrough manifest is byte-for-byte the same (`git diff` is empty for walkthrough/).
- What Notion's API reference says:
  - The create-view reference says the view filter "uses the same format as the data source query filter". It describes the response filter as supporting "up to 2 levels of nesting".
  - The reference for filtering data source entries says nesting works "up to two levels deep". Its example is an `and` that holds an `or`.
  - So `and` → `or` is accepted on paper. It has not been tried live.
  - If Notion refuses it, the view fails loudly: exit 1, with the by-hand text (setup-steps.mjs:528-535). Nothing is skipped.

## 2. MF-2: each table opens on its own view. PASS, with two concerns

- A table with a `default_view` gets `first: true` (notion-build.mjs:749). Before any view is made, `previous` is set to the id of that table's own view (1222-1228).
- Each named view is made `after_view` the view made before it (1284).
- The tests show the tab order on a fresh build. They run with both "Default view" and "Table" as the name of the own view (hub.test.mjs:766):
  - Claims: All claims, Your queue, Needs your note, Agent disagreed.
  - Rule changes: its own view, then Lessons waiting.
  - Tag decisions: its own view, then the two ledger views.
  - Rulebook: one tab, Rulebook.
  - In that test, every POST asks for `after_view`, there are no warnings, verify is clean and a rerun writes nothing.
- A table without a `default_view` still puts its first named view at the start (hub.test.mjs:808).
- The practice page builds its tabs in `ensureViews` with its own positions (walkthrough.mjs:723-744). That code did not change.
- A create that Notion refuses with a place is asked again without one. The run then warns and logs "drag the tab ... to the front of the table ... by hand in Notion" (notion-build.mjs:1290-1296; hub.test.mjs:794).
- Live evidence shows that Notion makes a view called "Default view" for a table made through the API (evidence/15-feedback-round-live/01-build-verify.txt). On a fresh table that view is the only one the structure does not name, so `ownViewName` cannot pick another one.
- Concern A: `ownViewName` looks for the wanted name, then "Table", then takes the first (notion-build.mjs:756-760). It never looks for "Default view" by name, although CONTRACTS.md:317 says "both are found".
  - If a person adds a view by hand before the views step runs, the hand-made view could be taken as the own view. It would then be renamed and arranged.
  - `build` makes the tables and the views in one run, so this cannot happen in the runbook.
  - The fix is one line, `if (names.includes('Default view')) return 'Default view';` after the "Table" line.
- Concern B: if a table with a `default_view` has no own view, the first named view goes to the start. There is no warning, and verify says nothing (hub.test.mjs:749).
  - Live, Notion makes the own view, so this should not happen.
  - Verify still does not check the order of the tabs (decision 107). One look at Claims from the hub after step 6 would confirm it.

## 3. The Rulebook view. PASS

- structure.json no longer names a view "Rulebook". The Rulebook's own view is called "Rulebook" (structure.json:136), and production has six named views.
- `practiceStructure` adds the view back (demo-profile.mjs:311-313).
- I ran the old `practiceStructure` on the old structure file and the new one on the new file. The two results are deep-equal.
- The planned bodies of the Rulebook, Needs your note, Agent disagreed and Lessons waiting views did not change. Only Your queue's filter changed, as MF-1 intends.
- Nothing reads `notion.views.rulebook` in a way that breaks. The five scripts that link it go through `viewLink(config, 'rulebook')`:
  - status.mjs:152, promote.mjs:488, restore.mjs:135 and 182, preflight.mjs:129, loop.mjs:464.
  - `viewLink` falls back to the table's link when the key is missing (editor-words.mjs:126-135).
  - The practice page keeps its own `demo.views.rulebook`.
  - The skills name no Rulebook view.
- The docs say six views: AGENT.md:101, CONTRACTS.md:197 and DECISIONS row 108. setup.test.mjs checks the "6 views" line of the preview.
- Nit: HUB-AND-GEO-CLAIMS.md:163, the Stage 5 acceptance that is already met, still says 7 views.

## 4. SH-1: the gate and a done record whose config was not rewritten. PASS, proven on a copy

- The gate refuses with exit 2 when archive.json says done and `archiveRewritten` is false (setup.mjs:412-424; archive.mjs:175-178).
- A record with no real Archive page is never taken as rewritten.
- I proved it on a copy of both agent folders. The copy had no .env, no token, and a preload that blocks every network call and logs any attempt.
  - The copy is in the scratchpad: confirm-copy/agents.
  - The output is in confirm-copy/probe/probe-out.txt.
- M1, with the real config and runs/builder and no archive.json: `build`, `all` with the runbook's arguments, `views` and `claims` each exited 2 with "the first build's tables are still on the hub page; run setup.mjs archive first (P9)".
- A done record with the old config: `build`, `all`, `claims`, `rubric` and `hub` each exited 2. The message was "the archive step moved everything in Notion but config.json was not rewritten; run setup.mjs archive again (it sends nothing to Notion)".
- A done record with no `archive_page`, or with `<setup>`: `build` exited 2 with the same message.
- `archive --plan-only` exited 0 and said that only the local part is left.
- `archive` exited 0 and did the following:
  - It rewrote config.json: the Archive page set, the five table ids set to `<setup>`, the views emptied.
  - It moved pages, databases, state and verify into runs/builder/before-archive/.
  - It sent nothing.
- `archive` again said "done already ... nothing was sent".
- After that, both commands got past the gate and stopped later, at the missing token:
  - `build` stopped with "there is no NOTION_TOKEN in .env".
  - `all` stopped at api-check, the same way.
- A done record that names another Archive page than config.json: `build` exited 2 again.
- The preload logged 0 network attempts. The request log in the copy's runs/builder has the same 152 lines as before.
- Nit: a done record with no Archive page leads to a dead end. The gate says to run archive again, and archive says "the archive record names no Archive page" (exit 2). Both refuse, so it is safe. `stepArchive` never writes such a record.

## 5. guide.md:29. PASS

- The line reads "A claim leaves Your queue as soon as you set Review status to Reviewed." That is ED-4's wording, and it matches DECISIONS row 110.

## 6. Hard rules in the diff. PASS

- No new kind of Notion call. The diff only uses calls that already existed: `createView` with a position (`after_view` was already used), `updateView`, and the reads.
- notion-rest.mjs and the guard hook did not change.
- There is no DELETE, no `archived` field and no `in_trash`. The only "archived" in the added lines is `archive.archived_at`, a timestamp in a message.
- No editor-owned field is written. Review status appears only in a view filter, which reads it.
- Nothing reads `.env`.

## Tests run here (targeted only; the full suite ran elsewhere)

- hub: 34 pass.
- fake-notion: 70 pass.
- archive: 26 pass.
- notion-build: 60 pass.
- setup: 62 pass.
- walkthrough: 97 pass.
- No test failed.

## Concerns that do not block the runbook

- Concern A from check 2: `ownViewName` should look for "Default view" by name. This is a one-line change.
- Concern B from check 2: a missing own view gets no warning. After step 6, open Claims from the hub once and check that it opens on All claims.
- The nested `and` → `or` filter has not been tried live. Step 7's verify will show a read-back difference if Notion changes its shape.
- The runbook in HUB-AND-GEO-CLAIMS.md (steps 6 and 7) does not mention the tab-drag warning. AGENT.md does. If `build` prints that warning, a person drags the named tab to the front.
- The Rulebook's only view no longer wraps cells. This is logged in BACKLOG.md:55.
