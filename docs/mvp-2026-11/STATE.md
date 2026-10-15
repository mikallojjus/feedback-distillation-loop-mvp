# State

| Item | Value |
|---|---|
| Phase | Stage 1 done in Notion (2026-10-15): structure, rows, edition 2026-10-15.1, canaries, the first real run (2 queue rows). Stage 2 in progress: the walkthrough runner, the editor-review fixes, the runbook; then evals, calibration, headless checks, the verifier, the artifact, checkpoint 2 |
| Checkpoint 1 (structure proposal) | Approved as proposed on 2026-10-15 (decision P1); page https://app.notion.com/p/3fa273e214eb81ef8504cb40e3bd7052 |
| Checkpoint 2 (final demo) | not reached |
| Branch | `mvp-2026-11` |
| Parent Notion page | "Feedback Distillation MVP", 3fa273e214eb805199f3d12ef01db453 |
| Notion ids created by this build | pages: Structure proposal 3fa273e214eb81ef8504cb40e3bd7052, Demos 3fa273e214eb81ada268f4b511182378, Demo tests 3fa273e214eb81c2b223dcc2331b7051; tables: Rulebook copy 17b99d1873384a1bb688c0075de45f78, Claims copy a0e77c4711044d87bc3e38296d2ea5d5, Tag decisions b77d1b758c414293b14837fdd1af4754, Rule changes ce293cfbd61a4cc680ab3567bac6da38, Agent settings d941cf5880bb4b4ea5de378191ab8202; views and data sources in config.json |
| Rulebook | edition 2026-10-15.1 (13 tags, Context-dependent judged); lock, history and changelog under `agents/claim-tagger-mvp/rubric/` |
| Queue | 10 seeded decisions from the audit, 2 open rows from the first real run (Can't tell at 0.61 and 0.67) |
| Notion token | the product owner tested a connection token on 2026-10-15 (reads of every object ok, writes untested); `.env` unchanged by the agent |
| Artifact | https://claude.ai/artifact/EHcW9M6Y8TMCHbeDu3pVtr, "Claim tagger MVP", version 1 (checkpoint 1); rebuild with `node gen-parts.mjs && node build.mjs --strict` in `docs/mvp-2026-11/report/`, republish the same file path |
| Builder session | closed (`runs/SETUP` absent) |
| Evidence so far | `evidence/00` baseline tests, `03` audit decisions, `04` dry run (0 writes), `05` setup (verify ok), `06` real run (53 writes read back) |

## Remaining acceptance work (section 8 of the brief)

1. Tests: run `node --test tests/` and save the count and names (check 1).
2. Walkthrough: runner, three evals with and without the skill under Demo tests, three calibration demos under Demos (checks 5 and 8).
3. Rollback read back (check 6), the headless report check with the Explanatory style (check 7), drift (check 9) and pause (check 10) on the live tables.
4. The Fable verifier (check 11), `VERIFICATION.md`.
5. The artifact rebuilt and republished; a fresh practice page for the product owner; the checkpoint 2 message.

## Running subagents (model, what each was asked, what it writes)

| Agent | Model | Asked | Writes |
|---|---|---|---|
| Review fixer | Sonnet | The editor persona's findings: the FAIL report gives the whole Editor wording text; step 1 table matches status; Rule unclear reasoning sentences; a drift warning and a third stop line; the words list; the practice page named in demo reports; "your Claude allowance" everywhere; "k of n runs agree"; the examples cleaned | page.md, manifest.json, report-examples.md, SKILL.md (demo mode), the lint rule j, status, propose, promote, judge, editor-words, loop, tests |
| Walkthrough runner | Sonnet | walkthrough.mjs: start (dry run, resume), run, where, verify, list; the demo profile; tests on the fakes | scripts/walkthrough.mjs, tests |
| Runbook writer | Sonnet | agents/claim-tagger-mvp/AGENT.md and README.md; the repository README's agents list | those three files |

## Finished subagents

Haiku digests in `sweeps/`; library coder (88 tests); foundation coder (195 tests); pull and plan coder (63 tests); judge coder (112 tests); loop coder (169 tests); blocks and lint coder (68 tests); headless tooling coder (115 tests); setup coder (81 tests); proposal drafter and walkthrough drafter (Opus); editor persona review (Fable); artifact scaffold (Sonnet). Suite: 1,756 tests pass before the review fixes.
