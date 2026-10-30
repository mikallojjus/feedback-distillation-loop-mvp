# Overnight run, 30 to 31 October 2026: checkpoints 2 and 3 of the v2 page

**If you are a Claude session picking this up after a context compaction or a crash, read this file first and continue from the first unticked step. Update the Progress list and commit after every step.** The owner (Mika) is asleep. He introduces v2 to the team on the afternoon of 31 Oct, and expects both versions to be available in the morning.

## What the owner decided (chat, 30 Oct, late evening)

- **Do checkpoints 2 (the data copy) and 3 (the loop on v2) overnight**, on branch `v2-page`. Commit per step; never push, never merge.
- **Old version:** the git tag `claim-tagger-v1` (= 3406cec, made at the start of the night). The live Notion page "Claim tagger" stays in Notion as it is. **No backwards compatibility in the code**: after tonight the code works on v2 only.
- **v2 is the default:** `agents/claim-tagger-mvp/config.json` becomes the v2 config (v2 tables, the v2 page as the hub). The live page's tables become read-only sources, used by the copy only.
- **Hard rule 1's guardrail is removed for the copy:** "Remove that guardrail" was his answer to whether the copy may write Tag outcome and Your note. The copy writes them; nothing is labelled. I keep one invisible bug guard (I told him so and he did not object): the loop scripts (tag, pull) never overwrite an editor value a person set.
- **The walkthrough is not ported tonight.** It stays on the old version (git tag). On the branch it is parked: it refuses with a message that names the tag.
- **The page is retitled "Claim tagger v2"** (no "(in preparation)"); its note line must stop saying "not in use yet".
- Permissions: he moved setup/rollback/restore to allow and added `copy-live.mjs` (`docs/mvp-2026-11/overnight-permissions.cjs`), and switched the session to bypass. Undo in the morning with `git checkout .claude/settings.json` (it is uncommitted on purpose: never commit `.claude/settings.json` tonight).

Earlier decisions that bind this work: P42 to P46 in `DECISIONS.md` (per-tag rows; Agent is right = the decision, never copied into Tag outcome by the loop; no reason words, the agent works the reason out; Can't tell + tick decides nothing; renames). Spec of the page: `STRUCTURE-V2.md`.

## Ids

- v2 page "Claim tagger v2 (in preparation)" `408273e214eb81d78f78ecfe4885d1ab` (child of the live hub `3fa273e214eb805199f3d12ef01db453`).
- v2 tables (database ids): Tag decisions `077f52fd4b22429faad8d050b561ab31`, Claims `ac6e6e695d0641328a395a1cec11c7c4`, Rulebook `12aa438db42c4d5b8b6752b2a26680f1`, Rule changes `3212d8d1c1144e5c8c6e4f1b69667005`, Agent settings `902ab8fa9ebb4e73a558f5fb58c0a64f`. Data source ids are in `agents/claim-tagger-mvp/profiles/v2/config.json`.
- Live tables (sources, never written): in `agents/claim-tagger-mvp/config.json` at tag `claim-tagger-v1`. Live rows on 30 Oct: Claims 600 (602 incl. two?), Tag decisions 602, Rulebook 13, Rule changes 3, Agent settings 1; edition in force 2026-10-29.1.

## Plan (in order; the cut line is after step 6: if time runs out, stop there, cleanly)

1. Tag `claim-tagger-v1`; check permissions. 
2. CLAUDE.md hard rules 1 and 10 rewritten for v2; DECISIONS P47 onward.
3. Port design: `docs/mvp-2026-11/PORT-V2.md` (Opus), file-by-file: config shape, decisions per row, statuses, readings without reason words, renames, guard, decide, skills, tests to rewrite or park, the walkthrough parked.
4. CP2, `scripts/copy-live.mjs` (Sonnet): reads the live tables (read only), writes the v2 tables through a plan (`lib/plan.mjs` allowance for the script `copy-live`), keyed and re-runnable (Claims by Geo ID, Tag decisions by Key, Rulebook by Name, Rule changes by Lesson, Agent settings by Name), the live page wins. Run it; verify counts.
5. Make v2 the default config; retitle the page and replace its note line; the rubric edition for v2 (page ids of the v2 Rulebook).
6. CP3, the loop on v2 (Sonnet, per PORT-V2.md): decisions per row, pull/propose/status/distill/readings/followup/promote/rollback/decide/guard/add, the skills' text. Full test suite green (obsolete tests rewritten, the walkthrough's parked with a reason).
7. Prove it on v2: `status`, a `tag` run on at most 10 rows, `distill` dry if it has one, `setup.mjs verify` on v2 and the read-only check that the live page was not written.
8. Opus verification (independent); then the morning summary at the top of this file and as WORKLOG entry 58; memory updated.

## Progress

- [x] 1. Tag `claim-tagger-v1` made at 3406cec; permissions checked (setup/rollback/restore allowed, uncommitted).
- [x] 2. CLAUDE.md hard rules 1 and 10 and the agents table rewritten; DECISIONS P47 to P49
- [x] 3. PORT-V2.md (30cc9cd): WP1 core, WP2 tag/status/followup/promote/add, WP3 distill/decide/guard, WP4 parking/setup/skills/docs; runs/ -> runs-v1/ fresh start (carry judgments/), rubric next edition via writeEdition with v2 page ids (NOT setup.mjs rubric), config swap per its section 4
- [x] 4. CP2 copy DONE: apply created 1219 rows (13/600/602/3/1), check read every value back (exit 0), a second plan is all same; copy writes named no first-page id (2560 requests, 1219 writes). Re-run later: copy-live.mjs plan / apply --run / check --run (default root now)
- [x] 5. v2 default DONE (7cfaa84 swap; runs/ -> runs-v1/, fresh runs/ with judgments, builder, copy-live, setup-* runs; rubric edition 2026-10-30.1 = same rules, v2 page ids, setup/rulebook-pages.json); retitle done (a1a2e80)
- [x] 6. CP3 loop DONE: WP1 c4b9f6b, WP2 c72d161, WP3 433948a, loop fix a5ecfc7, WP4 code 9d3ed22, WP4 docs 1cbe1a0; npm test 2355/2356 (only M1, the settings edit)
- [ ] 7. Proof on v2
- [ ] 8. Opus check, morning summary

## Log (newest last; one line per event, with the commit)

- 30 Oct, night: started. Tag claim-tagger-v1 = 3406cec.
- Step 2 committed (24c0057). Steps 3 and 4 launched in parallel: an Opus agent writes PORT-V2.md (read-only), a Sonnet agent writes copy-live.mjs + lib/first-page.mjs + setup/first-page.json + tests (no Notion). If a compaction lost them: check whether PORT-V2.md and scripts/copy-live.mjs exist and are complete before relaunching.
- a1a2e80: builder renames the v2 page (root) and rewrites its note line (hub.note_was); applied in Notion, verify 0 writes. Test M1 in guard-decide.test.mjs fails ONLY because of the owner's uncommitted overnight .claude/settings.json edit (he moved the ask block to allow by hand); it passes after git checkout .claude/settings.json. Never commit settings.json tonight.
- 30cc9cd: PORT-V2.md committed. Accepted its risk answers: Agent is right stored in Decided under as "<edition> · agreed <Outcome>"; fresh runs/; run one full tag after the port (cached judgments, no model calls). Order from here: copy agent done -> run copy (with CLAIM_TAGGER_MVP_ROOT=v2) -> step 5 swap -> WP1..WP4 sequential Sonnet -> step 7.
- 5ddf9ab: copy-live committed (35 tests). Plan 20261030T010012Z-copy-live (in profiles/v2/runs/copy-live/): create 13/600/602/3/1, 8 decided rows from the first page, 28 rows waiting, 2 ledger rows without a claim. Apply started in the background (~15-20 min); if interrupted, rerun: CLAIM_TAGGER_MVP_ROOT=profiles/v2 copy-live.mjs apply --run 20261030T010012Z-copy-live (resumable), then check --run. WP1 (Sonnet) launched in parallel, told NOT to do the config swap (I do it after the copy).
- 7cfaa84 config swap; rubric 2026-10-30.1 written (v2 Rulebook page ids, rubric hash unchanged). v2 Agent settings still says 2026-10-29.1 until the first loop run. WP1 running.
- WP1 committed (see git log "overnight WP1"): 313/320 of its target green; red until later packages: loop.test (6, needs WP2/WP3 scripts), editor-columns (1, distill WP3); out of scope red: WP2 add/propose/propose-failures/followup/promote/status/rollback/restore; WP3 distill/decide/decide-fixes/guard-decide(15)/guard(4)/transcript-check; WP4 setup(41)/hub/cli/two-way/v2-profile/walkthrough/archive/geo-pick (geo-pick: setup/audit-decisions.json moved to setup/v1). WP1 notes: bug guard lets a column through when the op expect names the value in Notion; recantedPhrase is now "a decision the agent now reads as a slip"; demo configs no longer validate.
- WP2 and WP3 launched in parallel (disjoint files; loop.test.mjs and loop-world.mjs belong to WP2 only). After both: commit each, then WP4 (parking, setup, skills, docs, whole suite green).
- WP2 committed: its 225 tests green; loop.test 2 red until WP3 distill. WP2 notes: status --json table is now the Tag decisions link; loop test compares decided rows on Key, editor columns and Decided under only (proposals move on decided rows, PORT-V2 1.7).
- WP4 split: WP4-code (Sonnet: parking walkthrough/demo, v2-profile, setup verify for v2, setup/hub/two-way/... tests) launched in parallel with WP3 (disjoint files). WP4-docs (Opus: .claude/skills/claim-tagger SKILL.md + references, walkthrough SKILL.md, AGENT.md, README.md) runs after WP3.
- WP3 committed (433948a): 303/304 green (M1 only). Tick value "__YES__" confirmed from the connector schema. loop.test 2 red (read 3 vs 10 audit decisions; rule 1 vs 4): a Sonnet debugger is on it (scope loop.test/loop-world + minimal code fixes). WP4-docs (Opus) launched: skills, AGENT.md, README. WP4-code still running. Three agents in flight, disjoint files.
- Step 6 done. Open small items (not blocking): verifyHub still advises "setup.mjs archive renames it" on a wrong title; stale comments in distill.mjs/promote.mjs headers; dead ctx.demo branches in promote/followup; CONTRACTS.md, walkthrough references/*.md and .claude/agents/editor-persona.md still per-claim; AGENT.md add paragraph still mentions the 50 cap.
