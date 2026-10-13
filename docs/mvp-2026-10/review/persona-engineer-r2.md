# Engineer persona review, round 2

13 Oct 2026, read-only. `node --test tests/`: 856 pass, 0 fail. On a temporary copy with the test fake, check and apply refused four EN-1 forgeries with exit 2: a forged header alone, the header plus a forged PROMOTING.json, a restore with new text, and a seed header without `runs/SETUP`. Nothing changed. A lost create now leaves one row.

## Dispositions

| ID | Disposition | Verdict |
|---|---|---|
| EN-1 | Fixed | Accepted: all four forgeries refused. |
| EN-2 | Fixed | Accepted: resume from the recorded arguments works. |
| EN-3 | Deferred to Mika | Accepted as a decision. Open must: the token reads four real databases. |
| EN-4 | Deferred to Mika | Accepted as a decision. Open must. |
| EN-5 | Fixed | Accepted. |
| EN-6 | Fixed | Accepted. Leftovers: source-tag rows get the date but never run; Stage lacks a Decided line. |
| EN-7 | Withdrawn | Accepted (`as-built.md`). |
| EN-8 | Fixed | Accepted. |
| EN-9 | Deferred to Mika | Accepted: the runbook states cost and restart. |
| EN-10 | Deferred | Accepted (week 2). |
| EN-11 | Deferred | Not accepted. Connector writes are allowed without a prompt, and the hook fails open outside the root. Move `notion-create-pages` and `notion-update-page` to `ask`; use `"$CLAUDE_PROJECT_DIR"` in the hook command. |
| EN-12 | Fixed | Accepted (code); the probe finding is EN-3's. |
| EN-13 | Fixed | Accepted. |
| EN-14 | Deferred | Accepted, if an engineer watches the first real PASS. |
| EN-15 | Deferred | Accepted. |
| EN-16 | Fixed | Accepted (code checked). |
| EN-17 | Deferred | Accepted. |

## Runbook dry run, Engineer notes only

- **Killed judge run:** `judge.mjs --resume --run-id <id>`.
- **Killed promote run:** `promote.mjs --lesson "<lesson>" --resume --run-id <id>`.
- **Apply exit 1:** `apply.mjs --run <id> --retry`.
- **PASS waiting:** `plan.mjs check --run <id>`, `apply.mjs --run <id>`, `promote.mjs --finalize <id>`, or `--abort <id>`.
- **Rollback:** `pull.mjs --all`, `promote.mjs --rollback <lesson> --confirm`, check and apply its plan, commit.
- **Trust breaker:** `status.mjs --unpause --confirm`.

All six match the usage lines and the README table; none would fail (the judge resume ran on the copy, exit 0).

Two gaps:
- No row covers a killed apply, which needs a plain `apply.mjs --run <id>`; `--retry` exits 2 without `plan.retry.jsonl`.
- The PASS row omits the commit.

## Artifact corrections (Technical layer)

1. **review-findings, EN-12:** "the token answers 404 on every one of them" is wrong. The probe got 200 on four real database ids; data-source ids always answer 404.
2. **05-code "Checks" and 06-verify "Real judge runs":** "a rule of the same tag" is wrong. judge.mjs accepts any rulebook rule.
3. **07-decide, Risks:** "Nothing" left to do on the usage window is wrong. A paused promote cannot resume across a Claude Code update.
4. **07-decide, model drift:** the config id does not "pin" the Claude Code version; it records it.
5. **06-verify, trust check:** say "304 script writes"; connector writes are not audited (same for the Engineer notes' "Nothing was ever written there").
6. **06-verify, In short:** the tag dry run did not "correctly find" anything: every claim was cached, so it judged nothing and stopped before propose. The tag path is still untested on an editor's machine.
7. **05-code, Pause and resume:** "picks up where it left off" is overstated. A run resumes only when someone runs the printed command.
8. **05-code, Distiller:** dedupe works per rule, not per tag.

## Acceptance

The MVP is clear and operable for an engineer. The gate rests on evidence, creates cannot duplicate, resume and rollback follow from the Engineer notes alone, and 856 tests pass. All 304 script writes stayed inside the six trial databases.

It is not ready to run until two must-fix items close:
- **EN-3:** disconnect the integration from the four reachable real databases, rotate the token, and run `probe.mjs` until it exits 0.
- **EN-4:** add a remote.

The two one-line EN-11 changes are also needed: until then a session can write the real databases through the connector unprompted.
