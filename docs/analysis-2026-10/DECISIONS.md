# Decisions (analysis session, October 2026)

Mika's answers to the question batches of 2026-10-14, in the order asked, plus the defaults Mika told me to assume. These override the MVP's decisions M1-M14 in `docs/mvp-2026-10/decisions.md` where they conflict.

| # | Decision | Consequence |
|---|---|---|
| D1 | Tag scope: all 13 Issue tags of "Claim Tags — verified" (Exact duplicate, Semantically duplicated, Multi-sentence, Trailing period, Improper capitalization, Incorrect grammar, Poor wording, Wordy, Context-dependent, Improperly sourced, Source inaccessible, Factually challenged, Unsourced) | 9 tags need rules written; 3 need source text; 2 need a corpus search; the judge carries a per-tag capability and says "cannot tell" honestly. Predictive and Hypothetical leave the scope. |
| D2 | Rulebook: a copy of the Issue rows, structurally identical to "Claim Tags — verified"; the team fills in missing data; later swap the tables or deprecate the original | No bookkeeping columns on the copy. Version, hash and change history live in the repo (`rubric/`) and in Rule changes. The only agent write to the copy is "When to use" after a gate PASS. |
| D3 | Claims: the real mirror "U.S. Politics debate claims" first; the config takes a list of mirrors (World affairs later); the agent writes Agent tags on the mirror rows too | Multi-table claims support is mandatory. The mirror leaves the protected list and gets a strict allowlist. |
| D4 | People: one editor who is also the rule owner, works with AI, must not be bottlenecked by the system | Second opinion, Ask another editor, Handed on, Approved-by-distinct-from-editor, the weekly cap and priority tiers are candidates for removal. The skill is the editor's main surface. |
| D5 | Mirror write target: plain text columns only, no relation | "Agent tags" as text (tag names) plus one notes column. Nothing else on the mirror, ever. |
| D6 | Hard tags: build source fetching now, duplicates later | Source tags (Improperly sourced, Source inaccessible, Factually challenged) get source text; duplicates (Exact, Semantically duplicated) return "cannot tell" and go to the editor; the corpus search comes later. |
| D7 | Missing rules: the agent drafts v0, the editor approves | A one-time "draft rules" step (Opus) writes numbered rules for the 9 empty tags from Description, Example Claims, Counterpart and past audit decisions, as Rule changes rows the editor approves or rewrites before those tags are judged. |
| D8 | Demo tag: Context-dependent | Verified, text-only, real two-way editor disagreement data (33 missed, 25 wrongly applied in the audit; rule 4 vs the editor's "reads well" test). |
| D9 | Mirrors first iteration: U.S. Politics only | About 2,351 claims; World affairs is one config entry later. |
| D10 | Walkthrough: a fresh demo page per run under a parent the editor picks | Own small rulebook copy, mirror-shaped claims table, queue; seeded Context-dependent story; nothing torn down; old demos archived by hand. |
| D11 | Cadence: the editor runs the skill; archive the old hub | The current hub and sandbox become read-only history (never deleted, hard rule 8). The new setup starts clean. |
| D12 | Source fetch: Node pre-fetches and caches, the judge reads excerpts | One fetch per source URL, cached under `runs/sources` by URL hash; a separate per-claim judge call with capped excerpts; blocked hosts recorded as inaccessible. |
| D13 | Judge runs: adaptive | One run per claim; re-run only cells whose first answer is uncertain (p between 0.25 and 0.75) or an applied Issue tag; target about 1.3x of a single pass instead of 3x. |
| D14 | Gate: simple by default, strict optional | Default: every canary passes, no decided claim newly fails, the lesson's supporting claims now come out right; one run per side, cached. Bootstrap, confidence intervals and reconfirmation runs move behind `--strict`. |
| D15 | Deciding: in Notion, as today | Hard rule 1 stays: no script writes Tag outcome, Why wrong, Your reasoning. |
| D16 | Work log in the repo; plan mode ended early | This folder. W1 and W2 run next; W3 and W4 each need a separate go-ahead after the report. |
| D17 | Duplicate tags are never queued until a corpus search exists (changes D6) | Semantically duplicated is reported as "not checked" in the notes column on every claim; Exact duplicate gets a free within-mirror text-hash check and is queued only on a hit. |
| D18 | No cap on new queue rows per run; the editor filters in Notion | Every uncertain row lands at once; the queue views sort by confidence. The per-run cap and the weekly cap both go. |
| D19 | Re-run rule: re-read only unsure answers, at most 30% of the claims in a run (narrows D13) | Unsure = the agent said ask editor, or its confidence was between 0.25 and 0.75. Applied tags with high confidence are not re-read. Calibrate once on the first 200 real claims against a 3-run reference. |
| D20 | The default gate re-reads flipped claims twice per side (adjusts D14) | Only claims whose answer differs between the old and the new rule get two more readings on each side; the bootstrap and 5-run reconfirmation stay behind `--strict`. |
| D21 | The setup script adds the two text columns to the real mirror once, behind a confirm flag | Logged and read back; refuses a same-name column of another type. Mika confirms with the owner of the Geo-to-Notion refresh job that added columns and page ids survive a refresh before the first real run. |
| D22 | The runner is on the Max 20x plan | Estimates can be expressed as claims per usage window once the first full run records a window stop. |
| D23 | Hard-rule changes signed off: rule 5 (only rulebook tags whose rules went live through the gate are judged), rule 10 (write only the two listed text columns on the configured mirrors), and edits to a tag with no rules yet are adopted from Notion without a gate | CLAUDE.md is rewritten accordingly in W3. |
| D24 | Walkthrough demo pages: Mika picks the parent page each time | The skill always asks for a link; no default parent. Test runs of the skill also need a parent given at run time. |

## Decisions for the MVP prompt (2026-10-15, `MVP-PROMPT.md`)

| # | Decision | Consequence |
|---|---|---|
| D25 | MVP scope: stages 0 to 2 (Context-dependent live plus the walkthrough) | The six text tags, the source pass, duplicates, World affairs, the strict gate, scheduled runs, per-editor queues and the swap go to the backlog. |
| D26 | Two checkpoints: the Notion structure proposal, then the final demo | Everything else the agent decides alone and logs; blockers go to BLOCKED.md and the next checkpoint. |
| D27 | The real claims table is not written; a mirror-shaped copy of 50 rows (the 10 with Context-dependent audit decisions plus 40 random) from one read-only pull | Switching to the real table is a backlog item that also needs the refresh-job answer. |
| D28 | A fresh minimal implementation in `agents/claim-tagger-mvp/` reusing the library modules; the skill keeps the name `/claim-tagger`; the old folder stays as history | The W3 change list is a design source, not a refactor script. |
| D29 | All Notion work under the page "Feedback Distillation MVP" (3fa273e214eb805199f3d12ef01db453) | Reachable by both the connector and the integration token (checked 2026-10-15). |
| D30 | Git: branch `mvp-2026-11`, commit after each verified step, never push | No remote exists. |
| D31 | On demo pages the agent may act as the editor; the skill-creator eval loop runs in full under a "Demo tests" sub-page | The demo-only exception to hard rule 1; every such write logged; pages never deleted. |
| D32 | Run until done; a usage-window stop waits and resumes; no spend cap | Transient errors retried, never treated as the window. |
| D33 | Acceptance: an independent Fable verifier signs off, then Mika runs the walkthrough on a fresh practice page | Anything Mika reports broken is fixed and presented once more. |
| D34 | One Geo-theme artifact: status, how to run, structure, backlog | Published at checkpoint 1, republished at checkpoint 2 and after fixes. |
| D35 | The rulebook is a copy with all 13 Issue rows; only Context-dependent is judged in the MVP | The copy is written only on a safety-check PASS; the taxonomy is read once and never written. |

## Defaults Mika told me to assume

- A private git remote is recommended but not blocking.
- One commit per rubric version stays.
- The editor-persona debate transcript goes into the artifact.
- The artifact reuses the Geo design-system bundle and the build recipe in `docs/mvp-2026-10/report/`.

## Hard-rule changes implied

- CLAUDE.md rule 10 ("never modify the real content databases") becomes: the configured mirrors accept writes to exactly the two text columns in the mirror allowlist; the taxonomy and "Claims to review" stay protected; the rulebook copy accepts "When to use" after a gate PASS only.
- The Rulebook database of the trial is replaced by the taxonomy-shaped copy.
