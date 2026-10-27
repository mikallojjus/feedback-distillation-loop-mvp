# Pre-live gate (stage 7), Opus verifier, 2026-10-27

Saved from the verifier's message. Read-only towards Notion; one read-only Geo query.

**Verdict: NO-GO.** Three must-fix items stand in the way, and none of them needs Notion. Once they land and the suite is green, it is GO. The new code is safe under the hard rules.

## Must

- **M1. The archive gate contradicts the specification.** Stage 3 says build and all "refuse without archive.json done". setup.mjs:396-406 lets pages, databases, views, hub, build and all run when `setup/archive.json` is missing (decision 85 says so; archive.test.mjs:473 asserts it). The row steps (rulebook, claims, seed-audit, migrate-decisions, settings) are not gated at all.
  - Today there is no archive.json and config.json still holds the old ids. So `build` or `all` run before `archive` would add Geo columns and views to the old tables (notion-build.mjs:871-875 takes them as "already recorded", with no protection check) and write 197 claims into Claims copy.
  - Fix: refuse every `setup:true` step except archive while archive.json is missing and `knownObjects(config)` (archive.mjs:88) names any real id. Update decision 85 and the test.
- **M2. The working tree is red** (fixed and committed in ad888e7 before this report was read): four tests pinned Geo Tags = [Debate] on the real structure file.
- **M3. Runbook step 2 breaks 13 test files.** tests/mvp/helpers/loop-world.mjs:43 reads setup/claims-pick.json when it is imported. In the same commit as the git mv, copy that file into tests/mvp/fixtures/ and point loop-world.mjs:43 and setup-world.mjs:34 at it.

## Should

- **S1. The archive page link check may stop the archive once.** archive.mjs:389-391 (`linksBack`) wants the href to equal the root URL exactly. The page URLs in the local run files read `app.notion.com/p/<slug>-<id>`, so Notion may return the link in another form (for example a relative `/<id>`). Then archive would stop with exit 2 right after making the Archive page. A rerun recovers: it adopts the page by its title. Fix: match by id, like `linksToPage` at archive.mjs:146-147.
- **S2. Old names remain in editor-facing text:** judge.mjs:861 ("the Rulebook copy") and loop.mjs:262 `TABLE_WORDS` ("Claims copy"). config.json `claims.label` stays "Claims copy" because no step rewrites it.
- **S3. verify does not check "13 Rulebook rows at the fresh edition"** literally. It compares the rows with the taxonomy file and Agent settings with the edition in force (setup-steps.mjs:958-978, 1055-1065), not rubric.json's page ids with the Rulebook rows.

## Nice

- AGENT.md:99 and the header of setup.mjs (line 21) leave `hub` out.
- evals/cases.jsonl (tracked) goes from 10 to 0 to 3 during `all`; commit it with evidence/25.
- Check `walk_errors: []` in setup/archive.json before committing it.

## 1. Hard-rule safety (it holds; the only gap is M1)

- **notion-rest.mjs:**
  - Only GET, POST and PATCH can be sent (62, 205).
  - `movePage` sends exactly `{parent:{type:'page_id',page_id}}` (505), and `moveDatabase` sends the same body on PATCH /databases (516). Both run on the builder client only (502, 513).
  - `updatePage` sends only `{properties}` (455).
  - No DELETE, `in_trash` or `archived` appears in any request body.
  - `is_inline` appears only in createDatabase (425); it is false for production (notion-build.mjs:690, 910) and never sent in a move.
- **archive.mjs:**
  - Only the 8 known objects from config can move (51-55, 88-95).
  - The plan check refuses an unknown id or a wrong key or kind (352-353), a protected id (350), the hub or the Archive page itself (351), any destination other than the Archive page (356-358), a parent other than the root or the Archive page (359-363), and more than 8 moves (370).
  - `applyArchive` checks the plan again (405-406). It reads each parent before moving (460-471), moves only into the Archive page (472-473), and reads the new parent back (474-479).
  - Leftovers are only listed, never touched (271-275, 747-749).
  - The Archive page is adopted only by its exact title under the root (249, 255, 260); two such pages stop the step (283-288).
  - The config rewrite protects the Archive page, the moved pages, the tables with their data sources, and the practice pages with their tables, then validates (593-602).
  - The builder session and the pause are enforced (setup.mjs:148, 388-395).
  - `findChild` skips protected and archived ids (notion-build.mjs:824), and adoption refuses a protected table (902-905).
- **plan.mjs:**
  - An editor column passes only with setup, on claims, when Challenged tags notes start with the audit prefix, or on a practice page create under runs/SETUP (305-314).
  - In production, row creates skip editor columns (setup-steps.mjs:637).
  - The only update that writes editor columns is migrate-decisions, limited to `pick.audit.included` (709-712, 762).
  - seed-audit seeds included claims only (675), after the sha256 check (255-260).
  - The walkthrough makes creates only (walkthrough.mjs:899).
- **geo-read.mjs:**
  - A document that is not a query, or that names a mutation or subscription, is refused before it is sent (191-192).
  - Hosts are allowlisted (193), and the only header sent is Content-Type (195-196).
  - Redirects are refused (208).
  - The query documents are fixed in the code, with every id checked (137-161).
- **The hub part** (notion-build.mjs:1366-1403): one GET, then one append at position start (1388), then GETs (1341-1362). It moves, edits and deletes nothing.

## 2. Specification coverage

- **Decisions:** P5 done; P6 done; P7 done (the live dry run of `start` is runbook step 8); P8 done; P9 done except M1. P10 done: the rules hash (704a01cc…) does not depend on page ids, so `rubric` writes the next edition. P11 done; P12 done.
- **Stages:** 1, 2 and 4 done. Stage 3 done except its gate (partly, M1). Stage 5 done, with its verify part partly done (S3). The preview acceptance is met: 5 tables, 68 columns, 7 views, Onboarding and the hub.

## 3. Runbook against the code

All commands exist.

- **`archive --plan-only`:** about 10 GETs, no writes.
- **`archive`:** 10 writes: the rename (PATCH /pages/root), the Archive page (POST /pages), 3 POST /pages/{id}/move and 5 PATCH /databases (parent only). It writes archive.json and config.json itself and sets runs/builder aside itself.
- **`build`:** 5 POST /databases (full-page), PATCH /data_sources for the relations, 1 POST /pages (Onboarding), 7 POST /views plus PATCH /views for the Claims table's own view, and 1 PATCH /blocks/root/children (the links, at the top).
- **`hub`:** at most one PATCH /blocks/root/children.
- **`all --taxonomy --claims --audit`:**
  - Rows: 13 + 200 POST /pages, 3 seeded ledger rows, then 3 PATCH /pages (the audit's Reviewed, Verified tags and prefixed notes).
  - rubric and canaries are local files; settings is 1 POST.
  - It ends in verify.
- **`verify`:** GETs only, and it fails itself if a write shows (setup-steps.mjs:1074).
- **The live state:**
  - Keep config.json's old ids: archive needs them.
  - Do not move runs/builder by hand.
  - claims-pages.json would stop `claims` with exit 2, so set it aside before `all`.
  - rulebook-pages.json would only be overwritten; set it aside anyway.
  - No script reads claims-pick.json, but the tests do (M3).
  - Keep audit-decisions.json: its sha256 (0eb3e49b…) matches the pick.

## 4. The pick

- **Counts:** 200 rows (50, 50, 40, 30, 20, 10), equal to the quotas, with no moves.
- **Months:** split evenly within each space. Technology is all 2026-10, and 2026-10 holds 61% of all claims (flagged as the likely migration month). Geo Created's month matches each row's month for 200 of 200.
- **Duplicates:** 0 repeated ids, 0 repeated texts; 31 claims in more than one space are recorded.
- **Checks:**
  - `readPick` passes.
  - The Geo Space options are the six spaces.
  - The Geo Tags options equal `tag_names` (Debate, Featured, Main claim, Top Debate).
  - `unknownOptions` returns 0 on the 200 creates.
  - Every Geo URL has the form `https://www.geobrowser.io/space/{space}/{id}`.
- **The audit claims** (one ClaimDetails query):
  - All 10 exist, are Claims, and are only in U.S. Politics.
  - The 3 included claims carry Tags → Debate.
  - Each of the 7 left out has exactly one Tags relation, and none points at Debate:
    - "New Story Potential Debates" (5703396e…) for 6dc1222a, fc0cb0da, e3c28f62, 9a0e2404 and 8f9c833b (the Georgia claim);
    - "Potential debate" (b63a27fd…) for 89fcfb7f and 78dd7750.

    The stated reason is accurate.
  - **Effect on the safety check:** the earlier decisions drop from 10 (3 Applies, 7 Does not apply) to 3. Of these, 1bff8592 is Applies; 3e0d601d and c8b676c3 are Does not apply. All three are disagreements read as Agent slip.

## 5. The 23 stage 5 markers: corrected sentences

- **Correct as written:**
  - AGENT.md 13, 80, 104, 105 (3 of the 10 today), 114
  - CONTRACTS 114
  - DECISIONS 86, 91, 95, 97
- **AGENT.md 33:** "The three views of Claims show … (decision P12)". Superseded by decision P15: describe the lean views.
- **AGENT.md 94:** "The pick is committed, and the options of Geo Tags (its tag_names) and Geo Space (config.json geo.spaces) are set from it before the first build: `node agents/claim-tagger-mvp/scripts/setup.mjs structure --options-from agents/claim-tagger-mvp/setup/geo-claims-pick.json` (files only)."
- **AGENT.md 101:** "The build makes the five tables as full-page tables in the hub's order (Claims, Rulebook, Rule changes, Tag decisions, Agent settings; decision 86) with their columns and relations, then Onboarding below them, then the views, then the three link lines at the top of the hub (decision 87); it reads Notion first and does only what is missing, so a second run writes nothing." The next bullet becomes "`api-check`, `databases`, `pages`, `views`, `hub`: the build again".
- **AGENT.md 107:** "`rubric`: the next edition from the taxonomy file, with the reason "setup: fresh tables under the hub (P9), copied from the taxonomy": the rules are the same, the Rulebook's page ids are new (decision 88); different rules are refused."
- **AGENT.md 110:** after "from 27 October also:" add "the hub's title, the order of its body and any leftover on it, that the five tables are full-page, the archive page's parent and first line and the parent of each of the eight objects moved into it, that every id in setup/archive.json is protected, that Claims holds the 200 claims of the pick, the audit rows against included, the 13 Rulebook rows against the taxonomy file, and that Agent settings names the edition in force."
- **AGENT.md 199:** "The fresh set under the hub starts the next edition with the same rules; its changelog line reads "setup: fresh tables under the hub (P9), copied from the taxonomy" (decision 88)."
- **CONTRACTS 83:** the `claims` label (see S2; fix it in code and config so it reads "Claims").
- **CONTRACTS 315:** end with "...and a `hub` part that appends the three link paragraphs at the start of the hub page (position start; a line already there, found by its text, is not added again) and reports leftovers and order differences; the hub block also holds `title` ("Claim tagger"), which verify compares with the hub page." The options command becomes `setup.mjs structure --options-from agents/claim-tagger-mvp/setup/geo-claims-pick.json` (Geo Tags and Geo Space).
- **CONTRACTS 316:** the reason becomes "setup: fresh tables under the hub (P9), copied from the taxonomy"; "the parent of every archived top-level object" becomes "the parent of each of the eight moved objects".
- **DECISIONS 87:** "appended with a position before the first table" becomes "appended with position start, at the top of the hub page".
- **DECISIONS 88:** the reason becomes "setup: fresh tables under the hub (P9), copied from the taxonomy".
- **DECISIONS 92:** "...only audit.included is seeded, carried over and checked (seed-audit, migrate-decisions, verify); seed-audit and verify first check the audit file's sha256 against the pick."
- **EDITOR-HANDOVER 22:** see the editor review, ED-11.

## 6. Tests

- 2186 tests (red at the time; fixed in ad888e7).
- Covered:
  - archive refusals: archive.test.mjs:312, 340, 414;
  - the build gate: archive.test.mjs:473 (asserts that a missing file passes; M1 changes this);
  - the hub never moves: hub.test.mjs:208, 270;
  - Geo mutation refusal: geo-read.test.mjs:85, and the source scan at geo-pick.test.mjs:714;
  - the audit filter: setup.test.mjs:867, 910, 928, 1150-1160;
  - the real pick: setup.test.mjs:1493.
