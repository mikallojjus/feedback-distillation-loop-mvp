# Design (filled in as the Plan agents report)

Three opus Plan agents were launched on 2026-10-14 during plan mode, read-only, each with the complete findings and decisions. Their verbatim reports are saved here when they arrive, then reconciled into one design per workstream.

| File | Brief | Status |
|---|---|---|
| `P1-architecture.md` | Feature ranking table; the minimal version; the optimal version; an ordered change list with file paths and functions to reuse; the new config shape (rulebook copy, mirrors list, per-tag capability); the source pre-fetch pass; adaptive runs; simple vs strict gate; the draft-rules step; per-tag cache keys; Notion setup for the new page; migration of the old hub; CLAUDE.md/AGENT.md/SKILL.md changes; tests; risks. | saved |
| `P2-walkthrough-reporting-artifact-debate.md` | The walkthrough skill (name, SKILL.md outline per skill-creator, setup script, per-demo profile, seed manifest, the seven steps in the fixed format with the tables each renders, the not-passed branch, evals.json prompts and assertions); the skill report template with examples per subcommand; the Geo-theme artifact plan; the editor-persona debate protocol; open points. | saved |
| `P3-scaling-cost-debt-verification.md` | Topic answers with numbers (distill batch size and growth, one vs many claims tables, per-tag distillation vs the all-tags judge call, human-judgement tags, pricing on the subscription with call and token estimates, scaling to thousands of claims and the full Issue rulebook); the ranked debt and bug list; the verification plan; what needs Mika. | saved |

| File | What it is | Status |
|---|---|---|
| `RECONCILIATION.md` | Where the three plans disagree (R1-R16), what wins, and which items went to Mika (now decided as D17-D24) | done |
| `W3-code-changes.md` | The single ordered change list for the code, merged from P1, P2 and P3 under D1-D24 and R1-R23, with the final config shape, the final database schemas and settings, tests and milestones | done (104 KB) |
| `W4-walkthrough-skill.md` | The walkthrough skill as decided: builder, profile, manifest, the seven steps, evals, skill-creator checklist | done (54 KB) |
| `W2-debate.md` | The editor-persona debate protocol; the persona lives in `.claude/agents/editor-persona.md` | done |
| `W1-report.md` | The report's review steps: Sonnet readability review, then the editor debate; publishing | done |
| The report (`../report/`) | W1: the Geo-theme artifact; its structure is P2 section 3 | draft built, strict build passes; readability review running |

Verification (W5) is part of W3's acceptance checks and P3 section 3; no separate file.
