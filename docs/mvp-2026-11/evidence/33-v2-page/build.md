# Checkpoint 1: the v2 page built, empty (2026-10-29)

State root: `agents/claim-tagger-mvp/profiles/v2/` (`CLAIM_TAGGER_MVP_ROOT`). Spec: `docs/mvp-2026-11/STRUCTURE-V2.md`, made into `profiles/v2/setup/structure.json` by `v2-profile.mjs structure` (5 tables, 65 columns, 4 views, 0 sub-pages).

## Commands, in order

1. `setup.mjs builder open --reason "v2 page checkpoint 1: empty structure for the product owner to confirm (plan approved 29 Oct)"`
2. `setup.mjs root`: `the page "Claim tagger v2 (in preparation)" was made under the live hub (408273e214eb81d78f78ecfe4885d1ab); config.json now names it as notion.parent_page_id`
3. `setup.mjs preview`: the plan matched the spec (read only).
4. `setup.mjs build`:
   - tables made: Tag decisions `077f52fd4b22429faad8d050b561ab31`, Claims `ac6e6e695d0641328a395a1cec11c7c4`, Rulebook `12aa438db42c4d5b8b6752b2a26680f1`, Rule changes `3212d8d1c1144e5c8c6e4f1b69667005`, Agent settings `902ab8fa9ebb4e73a558f5fb58c0a64f`
   - relation columns: Claims gets Agent tags and Tags waiting; Tag decisions gets Claim page
   - views made: Your queue, Needs your note, Agent disagreed (on Tag decisions), Lessons waiting (on Rule changes); the five tables' own views arranged
   - the page body: the warning line and 4 link lines, then the 5 tables
5. `setup.mjs verify` (v2): 36 requests, 0 writes. There were no structure differences; the 6 reports are all missing data inputs, by design at checkpoint 1: no taxonomy file, no rubric edition, no claims pick, no seeded decisions, and no Agent settings row.
6. `setup.mjs builder close`

## The build's requests

`profiles/v2/runs/builder/requests.jsonl`: 43 requests, 18 writes:
- POST /pages ×1 (the v2 page, under the hub);
- POST /databases ×5;
- PATCH /data_sources ×2 (the v2 Claims and Tag decisions, both in the v2 config);
- POST /views ×4;
- PATCH /views ×5 (the tables' own views);
- PATCH /blocks/<v2 page>/children ×1.

No write path names a live id.

## Production after the build

`setup.mjs verify` (production root): 61 requests, 0 writes, rows unchanged (rulebook 13, claims 600, tag_decisions 602, rule_changes 3, agent_settings 1). The 7 differences of `production-verify-before.md` are unchanged, and there is one new, expected difference:

```
hub: leftover - a block that is none of these is on the hub page and was left as it is: child_page "Claim tagger v2 (in preparation)" (408273e214eb81d78f78ecfe4885d1ab); remove it by hand if it should not be there
```

The leftover is by design until the switch-over (P43); it must not be removed.

## Tests

`npm test`: 2,441 pass, 0 fail (2,409 before; 32 new in `tests/mvp/v2-profile.test.mjs`).
