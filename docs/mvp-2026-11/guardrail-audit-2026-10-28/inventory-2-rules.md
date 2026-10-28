# Guardrail inventory 2: changing the rulebook (Haiku sweep, 28 Oct night)

Paths relative to X:\work\geo-agents\agents\claim-tagger-mvp unless marked. The sweep read the main tree partly before the decide merge; since 518e2b7 the connector's update-page is in no permission list (no prompt; the guard decides), and Review status is accepted only as Reviewed.

## 1. Distill
- Reason word needs a full stop | scripts/lib/decisions.mjs:44, :97-101 | "Agent slip." / "Rule unclear." / "Rule should change." with the full stop | without the full stop the words are ordinary text
- Tag line needed | decisions.mjs:74-95 | a note line must start with a rulebook tag name and a colon | words before the first tag line belong to no tag; a note with no tag name counts for every tag the agent got wrong
- Verbatim reading | lib/readings.mjs:207-219 | note line opens with a reason word | no model call; rule = the one the note names, else the agent's cited rule
- Model reading | readings.mjs:208; config reading_batch 10 | no reason word | read by the model in batches of 10; a batch failing twice leaves its rows unread this run
- Reading reply check | readings.mjs:275-302 | bad reply | whole batch reply refused
- "without your note" | readings.mjs:166, :311-317 | a disagreement with neither a reason word nor words | never supports a draft or counter-evidence; listed in Needs your note
- Fixed rows never read | readings.mjs:205 | Follow-up = Fixed | not read again, not drafted from
- Unjudged tags | readings.mjs:200-212 | note names a tag the agent did not judge | not read; "the agent did not judge this tag, so nothing to read"
- Only rule-pointing rows form groups | scripts/distill.mjs:146-163 | | Agent slip, no-note, unread rows support no lesson
- Minimum claims | distill.mjs:171-173; config distill.min_claims 2 | fewer than 2 distinct claims point at a rule | no lesson; status suggests distill only at 2+
- Open lesson on the same rule | distill.mjs:176-178 | a Proposed or Approved change on that rule | no new draft
- Model pattern checks | distill.mjs:277-313; overfit_ngram 8 | 8 copied words, text equal to the rule, other tag, too few rows | pattern dropped silently (reasons only in run.json)
- Lesson cap | distill.mjs:561; max_lessons_per_run 3 | | max 3 per run, one per rule
- Row cap | distill.mjs:88 (30), --rows | | the model sees the newest 30
- Kind is derived | distill.mjs:85-86 | any row reads Rule should change | "Change the rule", else "Clarify wording"; the editor does not choose
- Drafts are Proposed only | distill.mjs:580 | | distill never writes Approved, Rejected, Live
- No-draft sentences | distill.mjs:620-668 | | "no rule change to draft; <reason>"; exit 2 when nothing could be read

## 2. Lessons waiting (Rule changes)
- Approved and Rejected are editor-only | config editor_columns; hooks/guard.mjs | a script or the editor's Claude sets them | refused; the editor clicks it in Notion
- Editor wording is editor-only | config; lib/plan.mjs:308-313; guard.mjs | Claude or a script writes it | refused; the editor types it in Notion
- Editor wording must be the whole rule | promote.mjs:133-137 | | the whole text as typed is tested
- Suggested sentence max 30 words | promote.mjs:67 | | longer suggestion dropped
- Lesson pick by status | lib/loop.mjs:400-427 | no row in the required status, or several | exit 2; type the command with the title
- Kind and rule number | promote.mjs:283-287 | Kind "Initial rules" or no rule number | exit 2 "not a change to one numbered rule"
- Rule must be judged | promote.mjs:288-292 | | exit 2
- Rule moved since the draft | promote.mjs:298-304 | | exit 2; draft again
- Rule edit guard | lib/rulebook-edit.mjs:48-122 | replacing rule n would change anything else | exit 2
- Re-read before write | loop.mjs:458-479 | Status or When to use changed meanwhile | exit 2 or 4
- Several Approved | loop.mjs:422-425 | two Approved, no title | exit 2
- Paused is editor-only | config; guard.mjs | Claude sets Paused | refused; a person ticks it in Notion

## 3. Promote and the safety check
- Pre-checks | promote.mjs:270-272 | paused, drift, columns | exit 3/4/2
- Gate lock | promote.mjs:72-107 | another check younger than 2 h | exit 2
- Recanted hold | promote.mjs:325-333 | rests on a row no longer pointing at a rule | exit 10; reject it, then distill
- Examples (canaries) | evals/canaries.jsonl: 11 rows, built at setup from the taxonomy, frozen until a rule change | every check | each must keep its expected answer
- Earlier decisions | evals/cases.jsonl: 3 rows (the audit) | every check | an earlier right decision that turns wrong is a failure
- Supporting rows | promote.mjs:345 | | each must come out as the editor decided
- HOLD with nothing to check | promote.mjs:372-440 | no items for the tag | exit 10; ask the engineer to set up example claims
- FAIL | promote.mjs:443-467; exit 11 | any condition fails | rule unchanged; Next: paste this whole text into Editor wording and promote again
- PASS writes | promote.mjs:477-518 | PASS | Rulebook written and read back, edition saved and committed (git, on the engineer's machine), Status Live
- Pinned model | judge.mjs:78 | another model answered | exit 4

## 4. Editions
- Edition label YYYY-MM-DD.n, forward only, history immutable | lib/rubric.mjs:174-305 | | an older or conflicting edition refused
- Commit | loop.mjs:778-797 | PASS, rollback, restore | git commit of rubric/ in production only

## 5. Rollback
- Needs --confirm and a permission prompt | rollback.mjs:79-88; .claude/settings.json ask | | first run says what it would do; the prompt is the confirmation
- Live only | loop.mjs:400-427 | | exit 2
- Numbered rule only | rollback.mjs:53-56 | | exit 2
- Current text required | rollback.mjs:58-61 | | exit 2
- Rule changed after live | rollback.mjs:63-66 | | "roll back the later change first"
- Drift stops it | rollback.mjs:45 | | exit 4

## 6. Restore (engineer)
- --confirm and a prompt; writes only When to use; other columns by hand | restore.mjs:117-182 | | "put the other columns back by hand"

## 7. Drift: editing When to use by hand in Notion
- Judged tag changed: stop | lib/preflight.mjs:70-79; judge.mjs:844-862; rubric.mjs:374-377 | any change to When to use, Description, Example Claims or Counterpart of the judged tag (Context-dependent) | EVERY command that reads the pull stops with exit 4 "the rulebook text in Notion no longer matches the saved edition"; Next: put the text back, or ask the engineer to restore
- Judged row missing | judge.mjs:717 | | exit 4
- Non-judged tag changed: adopted silently | rubric.mjs:374-377; preflight.mjs:81-95 | | new edition "adopted from Notion", no stop, no gate
- A tag with rules becomes judged only when an engineer lists it in config judge.groups | AGENT.md:214; config :478-481 | | editors cannot start judging a new tag themselves
- Hand edit of the rulebook file | preflight.mjs:53-63 | | exit 4; ask the engineer

## 8. Rubric lock and history
- Lock covers When to use, Description, Example Claims, Counterpart | rubric.mjs:243-253 | | any difference on the judged tag stops everything (see 7)

## 9. Judged tags
- Only Context-dependent is judged (5 rules) | config judge.groups | | the other 12 tags: 8 have no rules; 4 have rules but are source or deterministic tags, never judged
- Hard rule 4 | CLAUDE.md | a rule changes only through Approved, PASS and promote (rollback, restore and adoption also change text)
- Hard rule 5 | CLAUDE.md | a tag is judged only with rules in force

## 10. Recanted lessons (decision 79)
- An open lesson resting on a decision the editor now calls an agent slip | readings.mjs:367-388 | | distill drafts nothing for that rule; status and distill say "reject it first"; promote holds (exit 10)
- Only the editor rejects | | | the agent never withdraws its own draft

## 12. Permissions and pause
- Pause file runs/PAUSED or Paused in Agent settings | preflight.mjs:31-49 | | exit 3 everywhere; a person clears it; there is no unpause command
- Asked each time: setup, geo-pick, rollback, restore, connector create/move tools | .claude/settings.json ask
- Denied: .env reads, curl, git push, Notion move/duplicate/delete | .claude/settings.json deny
- Protected ids | guard.mjs | any connector call naming one | denied
