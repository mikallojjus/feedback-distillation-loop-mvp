# The hub and the Geo claims: one Claims table, seeded from Geo; walkthrough for onboarding only

Specification approved by the product owner on 2026-10-27 (decisions P5 to P12). Branch `claims-hub-2026-10` off `main` at 9dc97e4. This is the plan as approved, word for word apart from this preamble and the baseline folder (22, since 21 was taken). Progress is in `WORKLOG.md` from entry 31; the sweeps behind it are `sweeps/p9-occurrences.md`, `sweeps/notion-move-facts.md` and `sweeps/geo-read-facts.md`.

## Context

The claim-tagger MVP is finished on `main` (2,084 tests). Its rulebook trains on a 50-row "Claims copy" taken from the protected Notion table "U.S. Politics debate claims". It was built for a *list* of claims tables (D3). It was tested mostly through practice pages: calibration runs 1–8 and verification runs 4–6 under Demos and Demo tests, with an agent acting as the editor (D31).

The product owner now wants five things:
- one `Claims` table that trains the rulebook;
- that table seeded with 200 Geo claims tagged Debate, across canonical spaces and dates;
- the walkthrough kept, for onboarding only;
- testing on `Claims`, never through the demo path;
- the Notion page reorganised, with the old contents archived and the page holding only links.

The outcome is a fresh five-table set under the same root page, a 200-claim training table that people decide on, and docs, skills and tests that describe one table and one way of testing.

## Decisions (the product owner's, 27 Oct 2026)

| # | Decision |
|---|---|
| P5 | **One claims table, `Claims`.** This reverses D3 ("multi-table claims support is mandatory"). In code, `notion.claims` becomes one object and the internal key `claims_copy` becomes `claims`. |
| P6 | **Seed 200 Geo claims tagged Debate** (entity `55c95b2626f8482cb9739ea99dfde438`), split as US Politics 50, World affairs 50, AI 40, Health 30, Crypto 20, Technology 10. If a space has fewer, the shortfall is spread over the others. Relationships (not canonical) and the dataset spaces are left out. Claims are spread evenly over Geo createdAt months within each space. The 10 claims decided in the audit of 9 October are included when Geo tags them Debate, and their decisions are seeded once; any that are left out are named. |
| P7 | **Walkthrough for onboarding only.** It is checked by the fake seven-step test and a live dry run of `start`. Agents never act as editor on live practice pages: D31, Demo tests, and `walkthrough.mjs decide/approve/reject` are retired. Practice pages go under an **Onboarding** sub-page. |
| P8 | **Testing on `Claims`, with editor decisions by people only.** Hard rule 1 is unchanged for production, so the rulebook trains only on human decisions. |
| P9 | **Same root page, renamed "Claim tagger".** Setup moves the old contents (Structure proposal, Demos with its practice pages, Demo tests, the five old tables) into a sub-page "Feedback Distillation MVP (archive, to 27 Oct 2026)". Its first line links back to the hub. Hard rule 8 is amended: nothing is ever deleted or trashed, and only setup may move the agent's own pages and tables within the hub, in a builder session. Everything archived becomes protected. |
| P10 | **A fresh set of full-page databases:** Claims, Rulebook, Rule changes, Tag decisions, Agent settings, with a new rubric edition from the taxonomy. The live copy holds no rule change, so nothing is lost. |
| P11 | **The hub body holds only links:** Your queue, Needs your note, Lessons waiting; then one line per table; then Onboarding and Archive. |
| P12 | **Claims columns.** Lean Geo set: Geo Name, Geo ID, Geo URL, Geo Space, Geo Created, Geo Sources, Geo Is factual, Geo Tags, Geo Topics. Then the 8 agent columns and the 3 editor columns. No "(old)" columns. |
| Routing | **Subagent models.** Haiku for retrieval and sweeps. Sonnet 5.5 for coding, tests and mechanical edits. Opus 5.5 for synthesis, drafting and **all verification**, including review of editor-facing text. The stale memory that said Fable is corrected, and `.claude/agents/editor-persona.md` moves to Opus. |

## What the research found (shapes the stages)

- **Only one claims table ever flows today.** `tableEntry` takes the first enabled entry (`scripts/lib/config.mjs:335-356`). `claims_copy` is hard-wired in `TABLES` (config.mjs:34), `schemas/plan.schema.json:10`, `pull/judge/propose/distill/promote/status`, `lib/loop.mjs`, `lib/setup-steps.mjs`, `lib/notion-build.mjs`, `lib/editor-words.mjs`, `lib/demo-profile.mjs:293-325`, and 22 test files and fixtures.
- **Title trap.** `buildDatabases` adopts any root child table with the same title (`notion-build.mjs:741-764`, `findChild` 690-703). Tag decisions, Rule changes and Agent settings keep their titles. So **the archive must run before the build**, and the build must refuse archived ids.
- **Setup needs code changes:**
  - `stepRubric` (setup-steps.mjs:656-682) keeps the edition in force when the rules hash matches, so it needs a fresh-edition path.
  - `setup/claims-pages.json` and `rulebook-pages.json` merge, so they must be set aside.
  - `runs/builder/*.json` still registers the old tables.
  - `auditOps` (196-202) and `stepVerify` (807-850) require all 10 audit claims.
  - `unknownOptions` refuses new Geo Tags values.
- **Moves are forbidden today** by hard rule 8, by `notion-rest.mjs:15-21`, and by the client-name test (`tests/mvp/notion-rest.test.mjs:84-90`). The REST API at 2026-03-11 has `POST /v1/pages/{id}/move` and `PATCH /v1/databases/{id}` with `parent`. Practice pages hard-code inline tables (`walkthrough.mjs:362, 612`); production uses `notion-build.mjs:568`.
- **Geo is read read-only, with no auth.** Queries are POST GraphQL to `https://api-testnet.geobrowser.io/graphql`. The `testnet-api` host is retired, and no mainnet host is documented.
  - IDs: Claim type `96f859ef…`; Tags relation `25709034…`; Sources `49c5d5e1…` (Web URL property `412ff593…`); Topics `806d52bc…`.
  - Query shape: `relationsConnection(filter:{typeId, toEntityId, spaceId}, first, after)`.
  - Reference code: content-management `lib/gql.mjs` and `skills/actionable/geo-mirror/scripts/mirror-claims-topics.mjs`.
  - The first 1,000 Debate links: 997 are claims. By month: 2026-10 628, 2026-09 310, 2026-08 54, older 5. `createdAt` is flattened on migrated entities.
- **Measured judge cost:** 9 calls for 50 claims, about 13 s per call (`evidence/06-real-run`).

## Stages (branch `claims-hub-2026-10` off `main`; every stage ends green on `node --test tests/` and with a WORKLOG entry from 31 on)

### Stage 0 — Open, log, sweeps, specification
- **Bookkeeping:** branch; save the baseline test count (`evidence/22-baseline/`).
- **Corrections:** fix the routing memory; set `.claude/agents/editor-persona.md` to `model: opus`.
- **Haiku sweeps** to `docs/mvp-2026-11/sweeps/`:
  - `p9-occurrences.md`: every hit of `claims_copy`, "Claims copy", "Rulebook copy", Demos, Demo tests, "Feedback Distillation MVP", D31, `decide/approve/reject`, `demoEditor`.
  - `notion-move-facts.md`: the move and re-parent endpoints, whether an inline database can be moved, where a moved page lands, and the append `after`/`position` options at 2022-06-28 and 2026-03-11.
  - `geo-read-facts.md`: query shapes, value fields, 25-alias detail batches, page halving and retries, from content-management.
- **Opus writes:**
  - the specification `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md`, carrying this plan into the repo;
  - P5–P12 in `DECISIONS.md` (P5 marks D3 reversed in `docs/analysis-2026-10/DECISIONS.md:9`);
  - STATE.md and WORKLOG entry 31.
- **Acceptance:** every decision maps to a section of the specification, and the move facts are cited with URLs.

### Stage 1 — One claims table (one mechanical commit; Sonnet codes, Opus reviews the diff)
- **Config and library:**
  - `config.mjs`: `TABLES` uses `claims`. `validateConfig` takes one object and refuses an array ("one claims table (P5)"). Update `tableEntry`, `writableProperties`, `editorColumns` and `editor_columns.claims`.
  - Also `config.json`, `plan.schema.json`, and `lib/plan.mjs` (44, 48, 313-315).
- **Scripts:** `pull.mjs` `NORM_FILES`/`ALIASES`, then the renames through every script and lib. `notion-build.mjs` keeps `SECTION_TITLES` parsing the historical `STRUCTURE.md`. `demo-profile.mjs` writes `n.claims = {…}`. Also `walkthrough.mjs` and `setup/structure.json`.
- **Order inside the commit:** config and lib, then scripts, then fixtures and tests (`TABLES` drives `validateStructure`).
- **Tests:** an array is refused (replaces `config.test.mjs:317-329`); an old-shape demo profile lists as "unknown", and `run --demo` on it exits 2.
- **Acceptance:** `grep -rn claims_copy agents/claim-tagger-mvp .claude tests` is empty except history; suite green.

### Stage 2 — Walkthrough for onboarding only (Sonnet codes, Opus reviews)
- **Remove agent-as-editor:**
  - Remove `decide/approve/reject` from `walkthrough.mjs` (header 49-56, USAGE 88-90, 1836-2063, dispatch 2101-2103).
  - Remove `demoEditor`/`DEMO_EDITOR_TABLES` from `lib/plan.mjs` (48, 247-263, 452-461).
  - Keep the creation-time seeding of a practice page's decided rows. It is the audit-seeding exception, not acting as editor.
- **Onboarding page:** `pages.demos` becomes `pages.onboarding` (walkthrough.mjs 249-252, demo-profile.mjs 705-725, config.mjs 162, notion-build `PAGE_TEXT`). Update `page.md` wording. The manifest stays frozen at 2026-10-22.1.
- **Archive refusal:** `run/where/verify` refuse a demo whose page or parent id is protected ("this practice page is in the archive").
- **Tests:** the fake seven-step test and `where` tests play the editor through `w.fake.editRow` (rewrite walkthrough.test.mjs ~2435-2462, 2706, 2837-2902). Plan test: an editor column on a practice update is refused. Add archived-parent refusal and default-under-Onboarding tests.
- **Acceptance:** no `demoEditor` left; the seven-step fake test passes; `lintPage` passes on `page.md`.

### Stage 3 — Client moves and `setup.mjs archive` (Sonnet codes, Opus reviews rule 8 safety)
- **`lib/notion-rest.mjs`:**
  - `movePage(id,{parentPageId})` sends `POST /pages/{id}/move`.
  - `moveDatabase(id,{parentPageId})` sends `PATCH /databases/{id}` with only `{parent}`.
  - Both go through the builder client (2026-03-11) and retry on 5xx.
  - `appendBlocks(…, {after})` becomes first-class.
  - Rewrite the header comment: moves exist only for the archive step; there is still no delete, `archived` or `in_trash`.
- **New `lib/archive.mjs`:**
  - `snapshotRoot` (GET only);
  - `planArchive` and `checkArchivePlan`: every op targets a known old id, every destination is the Archive page, no protected target;
  - `applyArchive`: ledger plus a read-back of every new parent;
  - `walkArchiveTree`: GET Demos and Demo tests children and the data source ids;
  - `archiveConfigChange`.
- **`setup.mjs archive [--plan-only]`** (needs a builder session; not in `ALL_STEPS`):
  1. Rename the root to "Claim tagger" (`updatePage` title).
  2. Create or adopt the Archive page. Its first paragraph links back to the hub.
  3. Move the 3 sub-pages and the 5 old tables into it.
  4. Walk the tree and write `setup/archive.json` (all ids, old view ids, leftovers, `state: done`).
  5. Rewrite the config: `pages {onboarding, archive}`, table ids set to `<setup>`, views cleared, every archived id added to the protected lists.
  6. Set `runs/builder/{pages,databases,state,verify}.json` aside under `runs/builder/before-archive/`.
  - **Leftovers:** a root block that is not one of the 8 known objects is listed for a person and never touched.
  - **Refused move:** stop with "drag it into the Archive by hand, then run again". A rerun reads parents first.
- **Gates:** `build` and `all` refuse without `archive.json` `done`. `buildDatabases` refuses to adopt an archived or protected id.
- **Fakes and tests:**
  - `fixtures/fake-notion-pages.mjs` gains moves, title updates and `after`.
  - A root with 3 pages, 5 tables, a paragraph and an unknown page: 8 moved and read back, 2 listed, config loadable.
  - A second run writes nothing; a failure on the 3rd move resumes; a refused move gives the drag message.
  - The client-name list grows by the two moves, and a source scan finds no `DELETE`, `archived:` or `in_trash:`.
  - `--plan-only` sends GETs only.

### Stage 4 — Geo read path and the pick (Sonnet codes, Opus reviews the sampling)
- **New `scripts/lib/geo-read.mjs`:**
  - Frozen query builders only: `debateTagged(spaceId, cursor)` (page 500, halved on internal errors) and `details(ids)` (25 aliases, ids checked against `/^[0-9a-f]{32}$/`).
  - It refuses any document that does not start with `query` or that contains `mutation` or `subscription`, and never sends an Authorization header.
  - Retries follow `gql.mjs` (5xx, 429, network, "Internal"; at most 3).
  - The request log has no bodies.
- **A `geo` block in `config.json`,** validated:
  - the endpoint on an allowlisted host;
  - the Debate, Claim, Tags, Sources and Topics ids and the Web URL property id;
  - six spaces as `{name, id, quota}` with quotas summing to `total: 200`.
- **New `scripts/geo-pick.mjs --seed <s> --audit <file> [--replace]`** writes `setup/geo-claims-pick.json` and a run folder. The pick rules:
  - Population per space = Claim-typed, non-empty name.
  - Cross-space duplicates go to the first space in canonical order.
  - Month = UTC `YYYY-MM`; the report flags the migration month.
  - Audit claims present in Geo are forced in; absent ones are recorded with the reason.
  - Even month split with remainder spread; space shortfall goes round-robin.
  - A seeded sample (`lib/rng.mjs`) over ids sorted by id.
  - Details are fetched for picked rows only; the space's own Name wins.
  - Rows carry the lean Geo set, with `source_pieces` for links and `tag_names` for the Geo Tags options.
  - The file records the populations, allocation and audit included/left-out.
  - Schema `schemas/geo-pick.schema.json`; refuses to overwrite without `--replace`.
- **Retirements and settings:** retire `pull.mjs --source real_claims --pick` with a pointer to `geo-pick.mjs`; settings get `geo-pick.mjs` under **ask**.
- **Tests** run against a fake GraphQL server `tests/mvp/fixtures/fake-geo.mjs`: quotas, shortfall, month spread, audit forcing and left-outs, dedupe, determinism, retries and halving, the non-query refusal, the overwrite refusal.

### Stage 5 — Fresh structure, full-page tables, the hub body (Sonnet codes, Opus reviews)
- **`setup/structure.json`:**
  - Titles Claims and Rulebook.
  - Claims columns in this order: Geo Name, the 8 agent columns, the 3 editor columns, then Geo ID, Geo URL, Geo Space (select of six), Geo Created (date), Geo Sources, Geo Is factual, Geo Tags (options from the pick), Geo Topics.
  - No retired columns or `renamed_from`; `pages: ['Onboarding']`.
  - A validated `hub` block: view links, table order, pages after.
- **Config:** `CLAIMS_COPY_COLUMNS` becomes `CLAIMS_GEO_COLUMNS` (config.mjs:44-47).
- **`notion-build.mjs`:**
  - Production tables get `is_inline: false` (568, 786); practice pages stay inline.
  - Order: databases in `hub.table_order`, then Onboarding, then views, then a `hub` part.
  - The `hub` part appends the three view-link paragraphs before the first table and reports leftovers and order differences.
  - If Stage 0 shows that a same-parent move lands a page at the end, the Archive page is re-moved to the bottom. Otherwise verify names the one drag a person makes.
- **`setup-steps.mjs`:**
  - `readPick` checks the new row shape and defaults to `geo-claims-pick.json`.
  - `stepSeedAudit` and `auditOps` seed only `pick.audit.included`, check the audit sha256, and name the left-outs.
  - `stepRubric` gets a fresh-edition path: same rules but new page ids → `nextEdition` with the reason "fresh tables under the hub (P9)"; different rules → refuse.
  - Canaries are unchanged.
- **`stepVerify`/`verifyStructure`** check:
  - the root title;
  - the root body order;
  - `is_inline === false` on the five tables;
  - the Archive's parent and its first line, and every archived top-level object's parent;
  - every `archive.json` id is protected;
  - claims = 200 = pick;
  - the audit checks against `included`.
- **Acceptance:** `setup.mjs preview` shows 5 tables, the lean Claims set, 7 views, Onboarding and the hub block; suite green. *(Six views since decision 108: the Rulebook's own view took the place of the named view "Rulebook".)*

### Stage 6 — Docs and skills (after Stage 1, alongside 3–5; Opus drafts, Sonnet does mechanical renames)
- **`CLAUDE.md`:**
  - Rule 1: the only exception left is the one-time audit seeding, on Claims and on new practice pages. No agent ever acts as editor.
  - Rule 8: never delete or trash; only `setup.mjs` in a builder session moves the agent's own pages and tables within the hub.
  - Rule 10: the hub "Claim tagger"; the Archive and all it holds are protected; Geo is read only through `geo-read.mjs`.
  - The agents table.
- **Other docs:**
  - `AGENT.md` (sections 1, 3, 6, 8, 9).
  - `README.md`.
  - `EDITOR-HANDOVER.md`: Onboarding link; commands without `demo` act on the real training table; pull before using.
  - Both skills, `references/guide.md` and `report-examples.md` (the `/claim-tagger` description: "tag the claims in Claims").
  - The walkthrough evals reduced to the dry-run and pause evals.
  - `CONTRACTS.md`: config shape, geo pick, `archive.json`, hub.
  - A pointer line atop `STRUCTURE.md`, whose approved text is kept because tests parse it.
  - `BACKLOG.md`: pick refresh, mainnet host, Geo Tags growth, the hub drag, walkthrough calibration now needing a person.
- **Engineering decisions 81–97:**
  - 81–85: one claims object, archive by move, the client calls, protected ids, the build gate.
  - 86–88: full-page tables, the hub order, the fresh edition.
  - 89–92: the Geo client, the pick algorithm, the Geo columns, audit left-outs.
  - 93–97: D31 removed, Onboarding, `--pick` retired, cell-store reuse, the hub block.
- **Acceptance:** an Opus review of all editor-facing text; `lintPage` passes; no "Claims copy", "Demos" or "Demo tests" left outside history.

### Stage 7 — Pre-live gate and the live Geo pick
- **Opus** checks the diff against the specification, the suite, the settings and the guard tests.
- **The engineer runs** `geo-pick.mjs --seed claims-2026-10-27 --audit agents/claim-tagger-mvp/setup/audit-decisions.json` (Geo only).
- **Opus spot-checks the pick:** populations, months, duplicates, audit left-outs, and five claims opened on `www.geobrowser.io` to confirm the testnet data matches.
- **Sonnet commits** the pick and sets the Geo Tags options from `tag_names`, with a test that the committed pick passes `unknownOptions` (`evidence/23-geo-pick/`).

### Stages 8–10 — Live (runbook below), people-only loop, artifact, sign-off
- **Opus:** rebuild the artifact (`node gen-parts.mjs && node build.mjs --strict` in `docs/mvp-2026-11/report/`, refresh `data/counts.json`), republish the same file path, then STATE, WORKLOG and the final verification (`evidence/30-verification/`).
- **Merge into `main`** only on the product owner's word.

## Live runbook (in order; each step resumes by running the same command)

1. **Before anything:** the product owner tells editors with their own checkouts (EDITOR-HANDOVER) to stop and pull. Old code would still write the archived tables. *Skipped by decision P17 (27 Oct): nobody else has a checkout; a checkout made before the merge into `main` waits for it.*
2. **Geo pick:** done in Stage 7 and committed. `git mv` the old `setup/claims-pick.json`, `claims-pages.json` and `rulebook-pages.json` to `setup/archive-2026-10/`.
3. **Open a builder session:** `setup.mjs builder open --reason "P9: archive the first build, fresh set under the hub"`.
4. **Archive:** `setup.mjs archive --plan-only` → review the 8 moves and the leftovers → `setup.mjs archive` → commit `config.json` and `setup/archive.json` (`evidence/25-archive/`; folder 24 holds the pre-live gate, so every evidence folder below is one higher than first planned).
5. **A person** removes any leftover root blocks the report lists.
6. **Build and seed:**
   - `setup.mjs preview`, then `setup.mjs build`;
   - `setup.mjs all --taxonomy agents/claim-tagger-mvp/setup/taxonomy-issue.json --claims agents/claim-tagger-mvp/setup/geo-claims-pick.json --audit agents/claim-tagger-mvp/setup/audit-decisions.json`.
   - If the build warns "the tab order may need a drag" (a view Notion would not place, decision 107), a person drags the named tab to the front of that table. No script can move a tab afterwards.
7. **Verify:** if verify names the Archive's position, a person drags it to the bottom. Repeat `setup.mjs verify` until there are 0 differences and 0 writes. A person opens Claims from the hub once and checks that it opens on All claims; verify cannot read the tab order. Then `builder close` and commit (`evidence/26-fresh-setup/`).
8. **Practice page and status:** the live `walkthrough.mjs start --parent <Onboarding> --dry-run` (1 GET, lint passes) and the headless check of `/claim-tagger status` (`evidence/27-…`).
9. **Tag:** `/claim-tagger tag` on the 200 claims (`evidence/28-real-tag-200/`).
   - Judge: at most about 41 Sonnet calls (25 + 8 + 8 re-reads); about 30 expected; about 5 minutes.
   - Notion: about 400 writes plus read-backs at 3 requests per second.
10. **A person decides** at least 10 claims in Your queue: one with a reason word, one disagreement without a note, one agreement. Then `distill --plan-only`, an Opus review, `distill --readings <run>`. A person approves or rejects in Lessons waiting. Then `promote` (PASS, FAIL or HOLD are all valid when read back) and the follow-up on PASS (`evidence/29-people-loop/`). Rollback runs only if the product owner asks.

**The person's part:** approve each `setup`/`geo-pick` prompt, tell editors to pull, clear root leftovers and maybe drag the Archive, make every editor decision and approval, and say "merge".

## Verification

- **Tests:** `node --test tests/` is green after every stage, with the count logged in `evidence/01-tests/`. The fake Notion and fake Geo cover the archive, moves, pick, build, hub and walkthrough.
- **Live structure:** `setup.mjs verify` gives 0 differences and 0 writes. It checks:
  - the hub title and order;
  - full-page tables;
  - the Archive's parent and the parents of what it holds;
  - every archived id protected;
  - 200 claims equal to the pick;
  - the audit rows seeded and migrated;
  - 13 Rulebook rows at the fresh edition.
- **Request logs:** exactly 8 moves, no DELETE, no trash fields. The Geo log holds queries only.
- **Plans:** every `plan.jsonl` since the archive holds no editor column, except the audit-prefixed migrate step.
- **Opus verifier**, read-only and independent: the test count, `verify.json`, `archive.json` against the protected lists, the ledgers' read-backs, the pick counts per space and month against the pulled claims, the hub and Archive bodies, report lint, `status --json`, and the skills' text.

## Risks

- **Move calls are new.** An inline-table move or the landing position may differ from the reference. Mitigations: the Stage 0 check, `--plan-only`, stopping on refusal with a drag-by-hand path, and resume.
- **Other machines.** Checkouts there keep the old config until pulled, so runbook step 1 comes first.
- **Geo data:**
  - The testnet host may be flaky or retired.
  - Flattened `createdAt` narrows the month spread; the report says so.
  - Technology may have fewer than 10 claims; the shortfall is spread.
  - Audit claims may lack the tag, giving fewer seeded decisions. The 11 canaries still guard the gate.
- **Stage 1 rename.** Its blast radius is large; one commit, gated by grep and the full suite.
- **Old profiles and runs.** The 21 old practice profiles under `runs/demos/` read as "unknown", and old run folders will not resume. Accepted.
- **Protected list size.** It grows to about 245 ids. Harmless.
