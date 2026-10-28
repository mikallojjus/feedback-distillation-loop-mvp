# Adding Geo claims to Claims: `/claim-tagger add` (P35 to P37, plan of 28 October 2026)

## Why

Claims holds the 200 Geo claims of the pick (P6), a balanced sample by space and month. Editors want to bring specific Geo claims into the feedback loop. Today:
- only setup, run by the engineer in a builder session, creates Claims rows;
- `geo-pick.mjs` draws a seeded sample and cannot take "these claims";
- a row typed by hand in Notion is read by the next tag run, but nothing checks its text, its Geo ID or its Geo columns.

The loop side is ready. The pull reads any Claims row that has a Geo ID. `status` counts the claims the agent has not read (decision 112). `tag` judges only the new ones and reuses its earlier reads.

## Decisions (the product owner's, 28 October 2026)

| # | Decision |
|---|---|
| P35 | Editors add claims from Geo by link or Geo ID with `/claim-tagger add`, with no permission prompt. The script creates new rows in Claims with the Geo columns only and reads each one back. It never changes an existing row. Hard rule 10 gains this one exception. |
| P36 | Only entities of the Claim type in the six configured spaces may be added, tagged Debate or not. One command takes at most 50. A claim whose text is the same as one already in Claims (or another in the same command) is refused, and the report names the existing claim. A Geo ID already in Claims is reported as already there. |
| P37 | Added claims are not marked. `add` does not tag: its Next line says to type `/claim-tagger tag`. Production only: there is no `demo add`. |

## Design

### New script `agents/claim-tagger-mvp/scripts/add.mjs`

`node agents/claim-tagger-mvp/scripts/add.mjs --claims "<Geo links or IDs, separated by spaces or commas>"`

1. **Read the input.** Each item is either a Geo link, `<config.geo.browser_url>/space/<space id>/<entity id>` (that host only), or a Geo ID (32 hex characters; dashes are allowed and removed). Any other item is refused as "not a Geo link or ID". More than 50 items: exit 2 before anything is read. Duplicates inside the input count once.
2. **The usual frame.** `withRun`, then `takePull` (all tables), `runPreflight` (paused: exit 3; drift: exit 4, like every loop script) and `needClaimColumns`. A demo context is refused (P37).
3. **Already there.** A Geo ID that the pull's claims hold is reported as "already in Claims". It is not an error.
4. **Read Geo** through `lib/geo-read.mjs` only: `createGeoClient` with `geoRequestLogger` writing `runs/<run-id>/geo-requests.jsonl`, then `client.details(ids)`. `countGeoRequests` must report no request that is not a query, or the run stops with exit 2. For each id:
   - a stub or a missing entity: "not found in Geo";
   - `typeIds` without `geo.ids.claim_type`: "not a claim";
   - no configured space in its `spaceIds`: "not in our spaces". The space used is the link's space when it is configured and holds the entity, else the first configured space, in `config.geo.spaces` order, that holds it;
   - an empty name: "no name in Geo".
   
   Geo that cannot be read gives exit 1 with nothing written: "type the same command again".
5. **One row builder for the pick and for add.** Move the row builder out of `geo-pick.mjs` (its `runPick`, lines 596 to 624: Geo Name with the space's own Name value, Geo ID, Geo URL, Geo Space, Geo Created, Geo Sources with `source_pieces`, Geo Is factual, Geo Tags, Geo Topics), together with `normaliseName`, into a shared module (for example `lib/geo-row.mjs`). geo-pick then calls it, and its pick file stays byte-identical, as the existing tests check.
6. **Same text.** `normaliseName` is compared against every claim in Claims and against the earlier items of the same command. A match is refused, and the existing claim is named.
7. **Select values.**
   - Geo Space is one of the six options.
   - Geo Tags writes only the option names Claims already has. Unknown names are left out and listed in run.json; no option or column is created.
   - A Geo Sources link that points at a protected id (`protectedInLinks`) refuses that claim.
   - Sources links are written through `withLinkedSources`, which is reused from `lib/setup-steps.mjs`.
8. **The plan.**
   - The run makes `newPlan({ script: 'add', ... })` with one `plan.create('claims', <Geo ID>, <Geo columns>)` per claim.
   - **`lib/plan.mjs` and `lib/config.mjs` get one narrow allowance:** a plan whose script is `add` may create rows in the claims table carrying the key and `CLAIMS_GEO_COLUMNS` only. It may not update a Geo column, write any other table, or write an agent or editor column. No other loop script may create claims rows. `checkPlan` holds the rule, and `applyPlan` repeats the check.
   - Right before sending, the claims table is queried again for those Geo IDs. A row that appeared since the pull is dropped as "already in Claims", so that two editors adding the same claim at once do not make a duplicate key, which would stop every loop script.
9. **Writes.** `applyStep`, then `assertApplied`: every row is read back.
10. **The report** has the three parts.
    - Sentence: "Add: 3 claims added to Claims from Geo; 2 were not added." It names up to three claims.
    - Table, at most 5 rows: Added; Already in Claims; one row for each kind of refusal present (Not found in Geo, Not a claim, Not in our spaces, Same text as a claim in Claims, Not a Geo link or ID). Rows are merged when there are more than five.
    - Next: "type /claim-tagger tag to read the 3 new claims."
    
    When nothing is added, the run exits 2 and the sentence says why. The Next line is "type /claim-tagger tag" when every claim was already there, else "check the links and type /claim-tagger add again". The ids, reasons and existing claims go to run.json and report.json.

### Around it
- **`lib/setup-steps.mjs` `stepVerify`** (line 1013): a Claims row that is not in the pick is no longer a difference. Such rows are counted in an information line, "added after setup: n".
- **`.claude/settings.json`**: allow `Bash(node agents/claim-tagger-mvp/scripts/add.mjs:*)` (P35, no prompt).
- **`scripts/transcript-check.mjs`**: `add` joins `DEFAULT_ALLOWED_SCRIPTS`.
- **`.claude/skills/claim-tagger/SKILL.md`**:
  - the frontmatter lists `add`;
  - a subcommand row: "add <Geo links or IDs>", running `add.mjs` alone and relaying its report;
  - the never-does bullet "never create, move or delete a page" excepts the claim rows that `add.mjs` creates itself;
  - line 21's "200 Geo claims" becomes "the Geo claims of the pick and those editors add";
  - Demo mode says `add` is production only.
- **`references/report-examples.md`** (both copies, kept identical): examples of add with all claims added, with some refused, and with too many.
- **CLAUDE.md, hard rule 10:** "…; and `add.mjs` creates new rows of the claims table with the Geo columns only, from claims read from Geo (P35)."
- **Other docs:** AGENT.md (Claims, the commands), CONTRACTS.md (a new section for add), EDITOR-HANDOVER.md (how to add a claim), DECISIONS.md (P35 to P37 and the engineering decisions), WORKLOG and STATE.

## Tests

Use the fakes `tests/mvp/fixtures/fake-geo.mjs` (`addClaim`, `addEntity`, `hideDetailsOf`, `failNext`) and `tests/mvp/helpers/loop-world.mjs` (`makeWorld`, `w.rows('claims')`, `w.claim`, `w.writes`).

- **Input:** by link, by ID, and mixed; 51 items are refused before any read; a malformed item; a link to another host.
- **Already in Claims and same text:** a Geo ID already in Claims; the same text as a claim in Claims; the same text within one command.
- **Geo answers:**
  - not a claim; not in our spaces; not found; an empty name;
  - a link whose space is not configured while the entity is also in a configured one;
  - unknown Geo Tags are left out;
  - a protected source link refuses that claim.
- **Failures:**
  - a Geo outage gives exit 1 with nothing written;
  - paused gives exit 3;
  - a demo context is refused;
  - a read-back mismatch gives exit 2;
  - the Geo request log holds queries only;
  - a row that appears between the pull and the send is dropped.
- **`lib/plan.mjs`:** script `add` may create claims rows with Geo columns only. It is refused for an agent or editor column, for an update, and for another table. Another script creating claims rows is refused.
- **Afterwards:** `status` counts the new claims as not read; `tag` then judges only them; setup verify counts them as added after setup; the geo-pick output is unchanged.

## Execution
1. Record P35 to P37 and a work log entry for the plan, then commit.
2. One Sonnet coder in a worktree. Step 0: `git checkout -b add-claims claims-hub-2026-10`, check the head (e9e9751 or later) and that 2,336 tests pass. The usual lessons apply: no heredocs, `git commit -F`, and the escape method.
3. Reviews, then fix rounds until GO:
   - an Opus code review with mutations (the plan allowance widened, the re-read before send dropped, the cap removed, the same-text check removed, a non-query sent to Geo);
   - an editor-persona review (Opus) of the report, the skill row and the handover text.
4. Merge with `--no-ff`, run the full suite, update the docs, commit. Nothing is pushed.
5. The product owner tests it live: `/claim-tagger add <one or two Geo links>`, then `/claim-tagger tag`. Evidence goes in `evidence/31-add-claims/`.
