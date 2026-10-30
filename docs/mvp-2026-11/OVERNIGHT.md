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
- [ ] 3. PORT-V2.md
- [ ] 4. CP2 copy
- [ ] 5. v2 default, retitle
- [ ] 6. CP3 loop
- [ ] 7. Proof on v2
- [ ] 8. Opus check, morning summary

## Log (newest last; one line per event, with the commit)

- 30 Oct, night: started. Tag claim-tagger-v1 = 3406cec.
- Step 2 committed (24c0057). Steps 3 and 4 launched in parallel: an Opus agent writes PORT-V2.md (read-only), a Sonnet agent writes copy-live.mjs + lib/first-page.mjs + setup/first-page.json + tests (no Notion). If a compaction lost them: check whether PORT-V2.md and scripts/copy-live.mjs exist and are complete before relaunching.
