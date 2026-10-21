# State

| Item | Value |
|---|---|
| Phase | Revision of 16 October live on the copy since 2026-10-21 (1,935 tests pass; build, migrate-decisions and verify done; first tag run done; fresh practice page "Claim tagger practice · product owner" built). Checkpoint 2 was reached on 2026-10-15. Waiting: the product owner's run of the seven steps; then calibration runs 6 and 7, the unpaused practice-page eval, a second verification |
| Checkpoint 1 (structure proposal) | Approved as proposed on 2026-10-15 (decision P1); page https://app.notion.com/p/3fa273e214eb81ef8504cb40e3bd7052 |
| Checkpoint 2 (final demo) | message sent on 2026-10-15; the MVP is agreed when the product owner runs the seven steps and says so |
| Branch | `mvp-2026-11` |
| Parent Notion page | "Feedback Distillation MVP", 3fa273e214eb805199f3d12ef01db453 |
| Notion ids created by this build | pages: Structure proposal 3fa273e214eb81ef8504cb40e3bd7052, Demos 3fa273e214eb81ada268f4b511182378, Demo tests 3fa273e214eb81c2b223dcc2331b7051; tables: Rulebook copy 17b99d1873384a1bb688c0075de45f78, Claims copy a0e77c4711044d87bc3e38296d2ea5d5, Tag decisions b77d1b758c414293b14837fdd1af4754, Rule changes ce293cfbd61a4cc680ab3567bac6da38, Agent settings d941cf5880bb4b4ea5de378191ab8202; views and data sources in config.json |
| Rulebook | edition 2026-10-15.2 (the restore after the drift check; text identical to edition .1); 13 tags, Context-dependent judged; lock, history and changelog under agents/claim-tagger-mvp/rubric/ |
| Claims and ledger | Ten claims Reviewed with the audit's decisions, the rest with the agent's columns from the first tag run of 2026-10-21; the ledger holds one row per judged claim and tag |
| Notion token | the product owner tested a connection token on 2026-10-15 (reads of every object ok, writes untested); `.env` unchanged by the agent |
| Artifact | https://claude.ai/artifact/EHcW9M6Y8TMCHbeDu3pVtr, "Claim tagger MVP", version 4 (the revision live); rebuild with `node gen-parts.mjs && node build.mjs --strict` in `docs/mvp-2026-11/report/`, republish the same file path |
| Builder session | closed (`runs/SETUP` absent) |
| Pause | none (B2 cleared by the product owner on 2026-10-21) |
| Evidence so far | `evidence/00` baseline tests, `01` full test run, `03` audit decisions, `04` dry run (0 writes), `05` setup (verify ok), `06` real run (53 writes read back), `07-headless` (status, demo status, demo tag, demo distill, demo promote: all pass), `08` pause and drift, `09-calibration/run-1` to `run-4` (manifest .1 and .2), `run-5` (manifest .3), `10-rollback` (read back), `11-walkthrough-evals` (benchmark, review page, description loop) |

## Remaining acceptance work (section 8 of the brief)

1. Tests: run `node --test tests/` and save the count and names (check 1) once the walkthrough runner has landed.
2. Walkthrough: three evals with and without the skill under Demo tests (check 8); calibration of manifest .3 under Demos (check 5: a PASS with the edition bumped, the text changed and the follow-up Fixed was reached on calibration pages 2 and 3 of manifest .2; a run that passes on the draft itself is the aim of manifest .3).
3. Done on 2026-10-15: the rollback read-back on calibration page 3 (check 6, `evidence/10-rollback/`); the headless report checks for status, demo status, demo tag, demo distill and demo promote (check 7, `evidence/07-headless/`); the walkthrough evals (check 8, `evidence/11-walkthrough-evals/`).
4. Done on 2026-10-15: drift (check 9) and pause (check 10) on the live tables, `evidence/08-pause-drift/`; the restore recorded edition 2026-10-15.2; the real run on the copy (check 4, `evidence/06-real-run/`); setup equal to the approved structure (check 3, `evidence/05-setup/`); the read-only dry run (check 2, `evidence/04-dry-run-real-claims/`).
5. Done on 2026-10-15: the independent verifier (check 11), `VERIFICATION.md`: five checks PASS at commit dd65af9, check 1 after the test fix.
6. Done on 2026-10-15: the artifact rebuilt and republished (version 2); the checkpoint 2 message. Open: a fresh practice page for the product owner (blocked by B2 until a person deletes the pause file; the owner can build it with the walkthrough skill once the pause is gone).

## Running subagents (model, what each was asked, what it writes)

| Agent | Model | Asked | Writes |
|---|---|---|---|
| (none running) | | | |

## Finished subagents

Haiku digests in `sweeps/`; library coder (88 tests); foundation coder (195 tests); pull and plan coder (63 tests); judge coder (112 tests); loop coder (169 tests); blocks and lint coder (68 tests); headless tooling coder (115 tests); setup coder (81 tests); walkthrough runner coder (Sonnet, 76 tests); proposal drafter and walkthrough drafter (Opus); editor persona review (Fable); artifact scaffold (Sonnet). Suite: 1,853 tests pass (`evidence/01-tests/`), plus the tests added with decisions 35 and 36.
