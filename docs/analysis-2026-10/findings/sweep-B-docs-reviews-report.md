# Sweep B: the MVP docs, reviews and report (haiku Explore agent, 2026-10-14)

Verbatim report of the read-only sweep over `docs/mvp-2026-10/`.

## Headline

- The MVP was built and run through setup, tag run, distill, gate, and rollback, but the central result was negative. The first lesson, LS-1 (Predictive rule 1), was gated five times and refused each time. The planted bad lesson, LS-2, was refused and rolled back. The live rulebook never left rubric 2026-10-13.1 (`docs\mvp-2026-10\evidence\notion\08-end-state-gate-held\summary.json`, rulebook block). The gate behaved as designed: it refused a lesson that caused side effects on other tags.
- Three must-fix items stay open for Mika (`docs\mvp-2026-10\review\dispositions.md:65`): rotate the token and disconnect it from four real databases (EN-3), add a git remote (EN-4; the repo has none), and name the people for "Needs evidence" and "Ask another editor" (ED-8).
- Three things the docs do not say: (a) the repo has 21 modified tracked files and 3 untracked sandbox files created after the handover, and no file in `docs\mvp-2026-10` mentions them; (b) the artifact says the model judges 12 tags, but the code has the model judge 10; (c) every gate card says "under 30 labelled positives" while the gate uses 5.

## 1. The approved plan (`docs\mvp-2026-10\plan.md`)

**Phases.** Build order, 12 steps (`plan.md:156-167`): skeleton, day-1 CLI and connector checks, schemas and hooks, pull, plan and verify, setup and seed, judge, first tag run, distill, eval, promote, then follow-up, status, skill, headless tests, demo, persona reviews, artifact. Demo storyline, steps 0 to 10 (`plan.md:133-145`). Verification, six layers (`plan.md:149-154`).

**In scope (interview decisions).** Notion writes only inside the hub page (`plan.md:9`; `decisions.md:14`, M10). About 60 real claims, with the 57 audit decisions seeded anonymised (`plan.md:27`, `plan.md:40`). Gate with research semantics, minimum labelled positives cut from 30 to 5, every verdict labelled "small sample" (`plan.md:28`; `decisions.md:9`, M5). Models: judge Sonnet 5.5 with 3 runs and majority vote; distiller Opus 5.5; Editor persona Fable 5.1; Engineer persona Opus 5.5 (`plan.md:36`; `decisions.md:10`, M6). One skill `/claim-tagger` with subcommands, and a seven-tab artifact with a Plain/Technical switch (`plan.md:33-34`).

**Out, or deferred.** No source fetching; the two source-reading tags are decided in code (`plan.md:208`; `decisions.md:7`, M3). No Start-here page; guidance goes into column descriptions (`plan.md:31`). No git remote; local git only (`plan.md:24`; `decisions.md:5`, `:12`). The research artifact is not touched (`plan.md:213`). Notion write path changed: the decisions table says "Connector-only ... no token path" (`plan.md:25`); a later section replaces it with REST writes through an integration token (`plan.md:191-199`; `decisions.md:6`, M2).

**Tags in scope.** Plan text: "All 14 Verified tags ... 12 judged (Editor verified human-only, Unsourced computed)" (`plan.md:26`). The judge contract says the model outputs "exactly the 10 model-judged tags per claim", with three tags decided in code (`plan.md:110`). The rulebook's judged flags reconcile the two: model judges 10 (Context-dependent, Debate, Factual, Hypothetical, Multiple statements, Opinion, Predictive, Self-contained, Simple, Single core statement); judged but decided in code 2 (Improperly sourced, Source inaccessible); computed 1 (Unsourced); human only 1 (Editor verified). The artifact misstates this.

**Batch size, claims, rows.** Judge batches of 8 claims, shuffled per run with a seeded RNG (`plan.md:93`, `:110`). About 60 claims: 33 decided, 17 forecast or boundary, about 10 random (`plan.md:52`, `:65`). 50 seeded queue rows; 24 audit decisions on tags outside the rulebook were set aside (`plan.md:65`). Persona decides 6 to 8 rows (`plan.md:138`); built: 10, plus 2 reviewer rows and 1 ruling.

**Cost and subscription.** Constraint: "subscription-only Claude Code (no API key)" (`plan.md:9`). Never use `--bare` or `--fallback-model` (`plan.md:75`). The cached judge prompt is about 9k tokens (`plan.md:110`). Expected calls: about 46 per tag run and 33 per promote (`plan.md:181`). Usage-window stops are handled by exit 75 and a resumable ledger (`plan.md:105`). Sample rows show a tag run at $2.10 and a gate at $1.70 (`plan.md:389`); built: $2.06 for the tag run and $0.00 to $2.73 per gate attempt. The report says the cost figures are notional and the real limit is the subscription's usage window (`report\parts\03-loop.html:100`); SESSION-SUMMARY agrees (`:84`). No doc records a run that hit the usage window.

**Plan versus build, main deviations.** Lesson title changed from "Hedged trajectories are not forecasts" (`plan.md:139`) to "Hedged 'likely to' needs a definite future outcome, not a tendency" (`SESSION-SUMMARY.md:41`). L-1 was expected to PASS at step 6 (`plan.md:141`); it FAILED five times. Demo steps 8 and 9 (follow-up; tag run under R2) were skipped (`STATE.md:21`). Connector DDL rejected formulas that read through relations, so rollups replaced several planned formulas (`01-log.md:9`). "One commit per rubric version" (`plan.md:174`): only rubric 2026-10-13.1 exists, and no R2 commit was made.

## 2. What happened

**Chronology.** 13 Oct 11:15 session start; five interview batches, plan approved (`01-log.md:3-5`). About 17:50: seeded 14 rulebook, 60 claims, 50 queue rows, 1 settings row, read back clean (`01-log.md:12`; `STATE.md:16`). About 18:15: Sonnet tag run, 180 of 180 judgments, $2.06; baseline canaries 83 of 83 (`01-log.md:13`). About 18:35: persona decides 10 rows. About 19:10: distill proposes LS-1 and plants LS-2. About 19:50 to 22:20: five LS-1 gate attempts, all FAIL; LS-2 FAIL and rolled back (`01-log.md:17-23`). 23:00 to 23:55: round-1 reviews; the engineer reproduced a forged plan header that replaced a rule (EN-1) (`01-log.md:24-29`). 14 Oct 00:20 to 00:40: round 2; artifact published.

**Gate attempts** (`report\data\counts.json`, cards in `evidence\cards\`):

| Run | Wording | Predictive change (95% CI) | Fixed / broken | Newly failing | Cost |
|---|---|---|---|---|---|
| LS-1 #1 | Distiller text | +27.3 (0.0 to +54.5) | 3 / 0 | 2, Hypothetical | $2.37 |
| LS-1 #2 | 1,439-char editor wording | +36.4 (+9.1 to +63.6) | 4 / 0 | 3: two Hypothetical, one Context-dependent | $2.36 |
| LS-1 #3 | Same, all cached | +36.4 (+9.1 to +63.6) | 4 / 0 | 1, Context-dependent | $0.00 |
| LS-1 #4 | Same, 8-run reconfirmation | +36.4 (+9.1 to +63.6) | 4 / 0 (break confirmed) | 1, Context-dependent | $0.70 |
| LS-1 #5 | 562-char minimal wording | 0.0 (-27.3 to +27.3) | 1 / 1 | 1, Predictive | $2.73 |
| LS-2 planted | "Only pronouns" | 0.0 | 0 / 0 | 1, Hypothetical | $2.29 |

The target improved in attempts 1 to 4; every attempt was still blocked by the no-regression condition on other decided cases. LS-1 #4 is the best result: all four hedged rows fixed, base accuracy from 54.5% to 90.9%. The Melania Trump Context-dependent flip was confirmed over 8 runs and read as cross-tag interference (`01-log.md:21`). Three attempts were blocked by 2:1 borderline items at confidence 0.5 to 0.65, which led to decision M11.

**What was hard.** Connector DDL and formulas; formula text cannot be read back from Notion (`01-log.md:8-9`). Git Bash rewrote `/claim-tagger` into a path; Bash prefix rules match whole words; heredocs with apostrophes fail (`01-log.md:22`; `STATE.md:29`). The nested headless guard test was denied by the auto-mode classifier (`01-log.md:27`). A forged plan header passed check and apply (EN-1); fixed with gate-evidence checks (`01-log.md:25`).

**Numbers.** Seed: 60 claims (33/17/10); 27 seeded outcomes (17 Applies, 10 Does not apply), 23 open, 4 closed, 24 excluded, 11 "check by hand" rows. Tag run: 180 judgments, 0 errors, $2.06; 40 queue rows created, 23 updated, 67 held by the weekly cap of 40. All judgments: 1,240, 0 errors (`SESSION-SUMMARY.md:38`). End-state queue: 90 rows (To review 51, Regression case 25, Closed 7, Decided 2, Lesson proposed 4, Waiting 1). Effective decisions: 39 by one count, 38 by another (the Melania row was seeded, then ruled on). Cases: 70 total, 37 active, 9 contested. Canaries: 83 active of 86. Writes by scripts: 304 (177 creates, 127 updates), none outside the six trial databases; editor fields changed by the agent: 0 (`evidence\write-audit.json`). Tests: 856 at commit 9d66fab across 32 files. Cost: $13.88 for judge, distill and gates (gates alone $10.44); headless sessions add $0.81. Tokens: no aggregate total recorded; one headless session shows 14 input, 4,915 cache-creation, 339,852 cache-read, 2,301 output tokens. Time: about 13.5 hours on the log.

**Skipped or deferred.** Demo steps 8 and 9 never ran (nothing went live); the trust-breaker drill was covered only by unit tests. The PASS path (finalize, follow-up, rollback) ran only against the test fake in the trial (`SESSION-SUMMARY.md:68`; EN-14). The guard hook never fired in a headless session (HL-5). The headless tag path judged nothing (all cached) and stopped before propose. No Smoke row exists in Notion. Follow-up never ran in the trial. The per-tag judge is not built. People fields (Decided by, Approved by) are empty by design.

**Next steps as handed over.** Disconnect the integration from the four real databases, rotate the token, run `probe.mjs` until exit 0. Add a private remote. Name the two readers in the hub callout and set Owner. Decide ED-13, EN-9, Q-E4. Run the guard-hook headless test once. Build the per-tag judge, re-gate LS-1 with the attempt-4 wording, add a Context-dependent boundary lesson, label more Predictive and Hypothetical claims.

**Caveats the docs do not spell out.** Undocumented post-handover work: 21 modified tracked files and 3 untracked (the sandbox). HEAD is `052f001` (17 commits), not `bfdcca4` as SESSION-SUMMARY says. Timestamps do not reconcile (log in local time without offset; run ids in Z; the persona's written_at predates the tag run). Queue counts between status-run-5 and the 08 snapshot differ by the two round-1 reviewer decisions.

## 3. Review findings (`docs\mvp-2026-10\review\`)

**Editor round 1** (`persona-editor-r1.md:33-49`). Verdict: "Mostly" clear for the weekly yes/no job; "Everything around that job is unclear".
- ED-1 (must): callout silent on Decided at / Decided by. Fixed: both optional.
- ED-2 (must): no description for Stage and Direction. Fixed: legend.
- ED-3 (must): Status text said "Rolled back after a FAIL" while LS-1 stayed Approved. Fixed.
- ED-4 (must): the FAIL card is written for engineers. "For editors" opener added; linking case ids deferred. Round 2 marked it "Not accepted"; dispositions say accepted after a re-render; no re-check on file.
- ED-5 (should): hashed titles, claim shown as a link, 25+ properties. Partly fixed.
- ED-6 (should): a claim's sibling rows scattered. Fixed: "By claim" view.
- ED-7 (should): proposal-to-outcome mapping unstated. Fixed in text.
- ED-8 (should): "Needs evidence" and "Ask another editor" lead nowhere. Views added; naming the readers open for Mika.
- ED-9 (should): missing descriptions. Fixed.
- ED-10 (should): overrules without a reason unflagged. Fixed: "Overruled without a note" view.
- ED-11 (should): "In regression suite" unexplained. Fixed.
- ED-12 (should): Last run and Owner empty; Paused unexplained. Partly fixed.
- ED-13 (should): LS-1 Approved with Approved by empty. Deferred to Mika.
- ED-14 (nice): views differ; empty filter chips. Partly fixed.
- ED-15 (nice): "held back by the weekly cap" read as queue size. Fixed in text.
- ED-16 (nice): least-confident-first starts the editor on the hardest rows. Fixed: "Easy rows first" view.
- ED-17 (nice): "Lessons waiting" empty and unexplained. Fixed.

**Engineer round 1** (`persona-engineer-r1.md:33-49`). Verdict: "The code, yes ... The operations, no".
- EN-1 (must): forged plan header replaced a rule. Fixed; round 2 refused four forgeries.
- EN-2 (must): notes are not a runbook; wrong resume command. Fixed.
- EN-3 (must): temporary token unrotated. Open; the probe on file reports `ok: false`.
- EN-4 (must): no remote. Open; zero remotes.
- EN-5 (should): a lost create response led to a duplicate row. Fixed: creates no longer auto-retried.
- EN-6 (should): regression date never cleared. Fixed.
- EN-7 (should): Direction treated Read source first as "not". Withdrawn.
- EN-8 (should): two promotes could both PASS. Fixed: PROMOTE.lock.
- EN-9 (should): CLI version in the config id forces a re-judge on update (about $4). Deferred.
- EN-10 (should): trust breaker fires on concurrent edits; PAUSED invisible in Notion. Week-2 items.
- EN-11 (should): guard hook fails open outside the repo root; never fired. Fixed in commit 860246d; headless test still not run (HL-5).
- EN-12 (should): protected list incomplete. Fixed in code; the token's reach is EN-3.
- EN-13 (should): option names unchecked; formulas not in repo. Fixed: option-set check and `as-built.md`.
- EN-14 (should): PASS, finalize and rollback never ran on real Notion. Deferred.
- EN-15 (nice): duplicated logic and magic numbers. Deferred.
- EN-16 (nice): misleading texts. Fixed; the "under 30" verdict line remains.
- EN-17 (nice): silent or defensive code. Deferred.

**Complexity and the editor's Notion experience.** Queue load 63 open after the tag run, 53 after ten decisions, 51 at the end; the cap is 40 new rows a week and 67 proposals were held. Time: about 1 minute for a plain row, about 2 minutes just to find two rows, 2 to 3 minutes for the Context-dependent row; at 40 rows a week that is 40 to 120 minutes. Vocabulary: 7 Stage values, 4 Direction, 7 Why in queue, 5 Why wrong, 4 Tag outcome, 5 Agent proposal; Stage is a seven-branch formula. Columns: the queue has 22 DDL columns and 4 formulas; five are editor-owned. Confusions the editor named: Stage and Direction meanings; whether to set Decided at; "Keep tag" meaning Applies; the row shows only a link to the claim so the claim page had to be opened each time; the first page is the hardest cases.

## 4. Evidence and manual work

Inventory: 102 files under `evidence\` (nine step folders of Notion snapshots, 14 card files, 18 headless files, the write audit, the token probe, the persona ledger). The simulated editor made 20 logged writes: 10 queue decisions, 2 amendments, 6 rule-owner actions (two approvals, three Editor wording edits, one tie-break), 2 reviewer decisions; 52 field writes in all; 13 distinct queue rows; no people fields set. The persona also played the rule owner, so every approval in the demo is the persona's judgment. Orchestrator connector writes are not in the ledger; `write-audit.json` covers REST script writes only (304 writes, none outside the six trial databases). The token probe returns 200 for four real database ids.

## 5. The report and the Geo theme

**Report README.** One HTML page with seven tabs, a Plain/Technical switch, light and dark themes; plain Node, no packages. `collect-evidence.mjs` refreshes counts; `build.mjs --strict` is the publish gate (checks includes, placeholders, pending counts, personal names, jargon, glossary, links, tabs, tag balance, colours by role tokens only, CSS variables, TODO text). No doctype/html/head/body in the file; republish to the same URL.

**`build.mjs`.** Compiles `design-system/tokens.json` to CSS variables (light on the root, dark by system preference and by forced theme); inlines the four Calibre woff2 files as base64; appends `bundle.css` and `page.css`; concatenates `parts\NN-*.html`, expands includes, fills `{{count:key}}` from `data\counts.json`, runs the checks, appends `script.js`. Hard-coded: the personal-name check reads `agents/claim-tagger/config.json` (line 36) and lists "Mika" and "Mikalojus" (line 39).

**Design system** (`report\design-system\`). Source: the Geo app repo, master@128e8bb1, synced 2026-10-12. Fonts: Calibre 400/500/600/700 (four woff2); mono is a system stack. Colours in two layers: role tokens (surface, surface-raised, surface-sunken, surface-hover, ink, ink-muted, ink-faint, border, border-control, rule, accent, accent-hover, accent-tint, on-accent, inverse, danger, warning, success and tints) and Geo's own palette (white, text, ctaPrimary, grey-01 to grey-05). Light is Geo as shipped; dark is a proposal. 23 components in `bundle.js` (Button, Tag, Chip, PillToggle, Tabs, SideNav, Input, Checkbox, Toggle, Term, Disclosure, Divider, Card, StatCard, PageHeader, Table, Figure, Code, Callout, StatusChip, Badge, Glossary, Icon) with matching `geo-*` CSS classes that work without React. Known gaps: some contrast pairs fail WCAG AA on purpose; the 124-icon set is not in the folder; the README names `components/bundle.css` but the file is `design-system/bundle.css`.

**Reuse recipe.** Copy `design-system/`, `parts/page.css`, `parts/script.js`; copy `build.mjs` and change TITLE (line 35), CONFIG (36), EXTRA_NAMES (39), JARGON (41); do not reuse `collect-evidence.mjs`; write `parts/NN-*.html` with `geo-*` classes, `{{count:key}}` for every number, sentence case, no emoji, colours only through role tokens.

**Seven tabs.** 02 At a glance; 03 The loop (figure, roles, gate, cost table; technical: formulas, allowlist, identities, plans, judgments, card); 04 Notion walkthrough; 05 Code and commands; 06 Verification and reviews; 07 Decisions and next steps; 08 Glossary. Chrome: 01 header (switch, theme toggle, tab rail), 99 footer, three fragments.

**Pricing in the report.** `parts\03-loop.html:100`: "The trial ran on the subscription without an API key, so they are notional; the limit that binds is the subscription's usage window." Also `02-glance.html:28`, `05-code.html:34-35`, `07-decide.html:82` and `:85`, `fragments\review-findings.html:17` ("about four dollars per update at trial size").

## 6. The research lesson format (`docs\mvp-2026-10\lessons.research-example.md`)

Three worked lessons; each has heading, Status, Kind, Tag and Rule, Statement, Boundary examples, Evidence counts, Counter-evidence, Proposed change (old and new text), Promotion threshold and expected gate result, Last fired, Owner. Status values: candidate, promoted, absorbed. Kind: rule wrong, rule unclear, taxonomy gap. Thresholds: two independent rows to promote, three if the lesson contradicts an existing rule. The MVP renamed Kind to Clarify wording / Add boundary example / Change the rule / New or promoted tag and Status to Proposed / Approved / Rejected / Live / Rolled back.

## 7. Counting the 152 files

Session-process artifacts: 112 (74%). Durable documentation: 16 (11%). Build tooling, assets and generated files: 24 (16%).

## Text to fix

- `report\parts\07-decide.html:22` says "12 judged by the model"; the model judges 10.
- Every gate card's verdict line says "a gated tag has under 30 labelled positives" (constant at `scripts\eval.mjs:799`) while the gate threshold is 5.
- `report\parts\06-verify.html` says the must-fix gaps were "all addressed after round 1"; ED-8 is still open.
