# Pre-live gate re-check (stage 7), Opus verifier, 2026-10-27

Checked at 5f11c6d (the merge of the fix commit ebb9e71). The main checkout was at 45997b2 when the suite ran; that commit only changes STATE, WORKLOG and a test log. No Notion call and no Geo call was made. Nothing in the repo was changed except this file.

**Verdict: NO-GO.** M1, M3, S1, S2 and S3 are fixed, and the hard rules hold. Two new items from the P13 and P15 work stand in the way. Both are small, and both happen in `build` (runbook step 6). Steps 1 to 5 (the archive) do not depend on them.

## Must

- **MF-1. Your queue may drop every new claim (P13; not proven either way).**
  - The filter is sent as a select `does_not_equal: "Reviewed"` (notion-build.mjs:344, structure.json:598).
  - `claims` never writes Review status (setup-steps.mjs:639 skips the editor columns). So about 197 of the 200 claims start with an empty Review status.
  - Notion's documentation does not say whether `does_not_equal` on a select keeps empty rows. I found no official statement and no community report that settles it. My best estimate is that empty rows are kept, because a Notion "is not" filter usually shows blank rows, and the usual advice for hiding them is to add "is not empty". I put that at about 75%, not more.
  - The fake keeps empty rows (tests/mvp/fixtures/fake-notion.mjs:561-565), so the tests cannot catch it. Work log entry 38 also lists it as not verified live.
  - If Notion drops them, Your queue is empty on day one, while `status` says about 197 rows.
  - Fix: in `parseViewFilter`, translate "<select> is not X" into `{ or: [ { property, select: { does_not_equal: X } }, { property, select: { is_empty: true } } ] }`. Change nothing else. The words stay the same, so structure.json and the frozen walkthrough manifest do not change. Inside the `and`, this filter is two levels deep, which the views API allows (sweeps/notion-api-2026-03-11.md:11). Add a fake test: a Waits for you claim with an empty Review status is listed, and a Reviewed one is not.
  - Alternative: before step 6, run one read-only query on the old Claims copy (a protected table, so reading is allowed) with the same `does_not_equal`. It must return the claims that are not Reviewed, the empty ones included.
- **MF-2. "All claims" is the last tab, not the first (P15, ED-6). This needs the product owner's word.**
  - P15 says "each table's own first tab", and ED-6 says "first tab 'All claims'".
  - The build creates the first named view at position `{type:'start'}` and the rest after it (notion-build.mjs:1212, 1268). So the named views go in front of Notion's own view. Claims then opens on Your queue.
  - The coder logged this as a backlog row (BACKLOG.md:54). That turns a product decision into a deferral.
  - This is not a limit of the API. `POST /views` takes `position` (`after_view`), and the build already lists the table's views before it creates any (`have`, notion-build.mjs:1202).
  - After the build it cannot be fixed by script: `updateView` sends no position (notion-rest.mjs:483), and verify does not check tab order.
  - Fix (about one line): when `plan.arrange[table]` exists, set `previous` to the id of the table's own view (`ownViewName` over the views the structure does not name) instead of `null`. Each named view is then created `after_view` that view. Add a test of the tab order on the fake.
  - The other option is that the product owner accepts the backlog row. Then a person drags the tabs on four tables, and verify or the runbook should name that drag, as it does the archive drag. AGENT.md:33 ("the first tab Notion makes") should then say where the tab actually ends up.

## Should

- **SH-1. The gate passes an `archive.json` that says "done" while config.json still names the old tables.**
  - archive.mjs:799 writes state "done" before `finishLocally` rewrites config.json (archive.mjs:800).
  - If that rewrite throws (for example a `validateConfig` failure, archive.mjs:629-630), the archive exits 2, but the gate in setup.mjs:405 only checks `state !== 'done'`.
  - Then `build` treats the old ids as "already recorded" (notion-build.mjs:920). It would add the Geo columns and the views to the archived tables, and `all` would write 200 claims into the archived Claims copy. That breaks rule 10.
  - Proven on a copy: with `{"state":"done"}` and the old config, `build` passed the gate and stopped only because no token was found.
  - Fix: in setup.mjs, also refuse when the state is done and `realId(config.notion.pages.archive) !== realId(archive.data.archive_page)`. That is the same test `stepArchive` already uses at archive.mjs:690. The message: "the archive moved the tables but config.json still names them; run setup.mjs archive again (it sends nothing)".

## The eight checks

1. **M1: PASS.** The full results are below.
2. **M3: PASS.** With the three files moved by `git mv` in a throwaway worktree: 2,202 tests, 2,202 pass, 0 fail.
   - The helpers read `tests/mvp/fixtures/claims-pick.50.json` (loop-world.mjs:43, setup-world.mjs:34).
   - No script reads the old pick. `claims-pages.json` and `rulebook-pages.json` are the output files of the fresh `rulebook` and `claims` steps (setup-steps.mjs:623, 635), and they are written new.
   - `claims` and `seed-audit` default to `setup/geo-claims-pick.json` (setup-steps.mjs:115, 634, 659).
3. **S1, S2 and S3: PASS.**
   - S1: `linksBack` matches the hub by its id (archive.mjs:171, 417, 479).
   - S2: the old names are gone from every message and from config.json (`"label": "Claims"`). They remain only in comments, schema descriptions, the parser of the old STRUCTURE.md (notion-build.mjs:86) and AGENT.md's history, which is correct.
   - S3: verify compares the page ids in rubric.json with the live Rulebook rows, one per tag, in both directions (setup-steps.mjs:984-1000).
4. **P13: CONCERN** (MF-1). The filter text, the descriptions and the count in `status` agree with each other. Whether Notion keeps the empty rows is not proven.
5. **The wording: PASS.** These match editor-review.md word for word:
   - the hub line (P14);
   - the five table descriptions (ED-8);
   - the column descriptions of Verified tags and Agent status;
   - the two changed link lines (ED-5, ED-7);
   - the handover's title, its first paragraph, and steps 5 and 7 (ED-2, ED-5, ED-10, ED-11; the colleague sentence is gone);
   - guide.md:31-32 and 40;
   - page.md:77, 241 and 278 (ED-12), and the typo at line 220;
   - the archive warning (archive.mjs:405);
   - the lean view columns.

   The differences, none of which matters:
   - guide.md:29 says "A claim leaves it as soon as …", where ED-4 asked for "leaves Your queue".
   - The archive warning is the page's third paragraph, where ED-9 said "first lines".
   - The ledger views are not renamed. ED-8 said they "could be"; this is logged in BACKLOG.md:53.
6. **Tab order: FAIL against P15** (MF-2). It is a product decision that a coder deferred.
7. **The stage 5 markers: PASS.** None remains outside WORKLOG.md. All twelve corrections in gate.md section 5 are applied as written:
   - AGENT.md 33, 94, 101, 107, 110 and 199;
   - CONTRACTS 83, 315 and 316;
   - DECISIONS 87, 88 and 92;
   - EDITOR-HANDOVER.

   AGENT.md 101 and 110 add the new P14 and P15 items on top of the corrections.
8. **The hard rules: PASS.**
   - Every Notion call the diff adds uses a call that already existed. `createDatabase` gains a `description`, `updateView` a `name`, and `appendBlocks` an `after_block` position.
   - There is no DELETE, no `archived` and no `in_trash`.
   - No editor field is written.
   - Nothing reads `.env`.
   - The suite in the main checkout: 2,202 tests, 2,202 pass, 0 fail. The live `runs/builder/state.json` and `config.json` were not touched by the run, and git status stayed clean.

## M1 on a copy of the live install

The copy held the real config.json, the real runs/builder (whose state.json has the keys pages, tables, updated_at and parent_page_id, and no `archive_checked`) and no archive.json. Network access was blocked and no token was set.

- After `builder open` in the copy, each of these exited 2 with "the first build's tables are still on the hub page; run setup.mjs archive first (P9)":
  - `pages`, `databases`, `views`, `hub` and `build`;
  - `rulebook`, `claims`, `seed-audit` and `migrate-decisions`;
  - `rubric`, `canaries` and `settings`;
  - `all` with the runbook's arguments.
- `preview`, `structure --options-from`, `api-check`, `verify` and `builder status` did not set the mark. `build` still exited 2 after them.
- Only `writeState` sets the mark (notion-build.mjs:1491). Its only caller is `runStructure`, which only `stepStructure` calls (setup-steps.mjs:494). That step runs only from the gated commands (setup.mjs:267-276).
  - The walkthrough never calls it.
  - Every test that calls it passes a temporary root.
- An `archive.json` that says "moving" or "planned", or that is not JSON, or that has no state: exit 2.
- A `config.json` that fails to load: exit 2. The gate's catch sets `held = false`, but the config load at the next step refuses.
- A `state.json` that is missing or unreadable: exit 2.
- An `archive.json` that says "done" while the config is not rewritten: the gate passes (SH-1).

## Nits

- Rulebook will have two tabs with the same five columns: the named view "Rulebook" and its own view.
- walkthrough/manifest.json:438 `status_after` still has the wording that decision 101 retired. It is a frozen calibration record, and no script reads it.
- Whether a table description is accepted when the table is created under 2026-03-11 is not verified live. verify names a missing description, so the runbook would show it.
