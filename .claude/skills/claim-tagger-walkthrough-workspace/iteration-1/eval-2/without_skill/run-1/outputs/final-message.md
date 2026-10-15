Dry run done, nothing built. The walkthrough script has a built-in `--dry-run`, so I ran it against that link. It sent one GET to read the parent page (the Demo tests sub-page, `3fa273e214eb81c2b223dcc2331b7051`), rendered the page, ran the page check (passes) and stopped before the first write. The rendered page and the full request plan are on disk:

- `X:\work\geo-agents\agents\claim-tagger-mvp\runs\demos\20261015-1900-94990d\preview.md` (the page as it would read, 244 lines)
- `X:\work\geo-agents\agents\claim-tagger-mvp\runs\demos\20261015-1900-94990d\setup-plan.json` (the 16 requests and 16 rows a real build sends)

**What would be created under Demo tests**

One page titled "Claim tagger practice · 15 Oct 19:00" (a real build stamps its own time), from manifest 2026-10-15.3, at rulebook edition 2026-10-15.1. Planned: 7 steps, 5 tables, 4 views, 16 rows.

**The page, top to bottom**

1. A callout: "You type four commands yourself (status, tag, distill and promote); the follow-up runs by itself after a PASS, and the engineer sets things up and fixes what breaks." Then the intro (a practice copy of the editor feedback loop with its own one-tag rulebook, 7 real claims and its own queue; nothing here changes the real tables or Geo) and the orientation: rule 3 of Context-dependent (descriptive definites) and the two gaps editors read into it, shown in a three-row table: the press pool (rule read strictly: tag; the editor: no tag, everyone knows it), the AI Force (can't tell; the editor: tag, which body is that?), CNN and Air Force One (tag; the editor: tag).
2. Step 1 · Meet the demo — `/claim-tagger demo status`
3. Step 2 · The agent reads the claims — `/claim-tagger demo tag` (expected: press pool Applies 0.80, AI Force Can't tell 0.50, both citing rule 3)
4. Step 3 · Decide your two rows — done in Notion; the linked view **Your queue** sits right under the instructions
5. Step 4 · The agent drafts a clearer rule 3 — `/claim-tagger demo distill`
6. Step 5 · Approve the draft — done in Notion; the linked view **Lessons waiting** sits right under the instructions
7. Step 6 · The safety check — `/claim-tagger demo promote`, with the "If it does not pass" branch (Editor wording, promote again, Rejected after a second FAIL)
8. Step 7 · The agent re-checks your rows — nothing to type
9. "What the full version adds later" (all 13 tags, duplicate search, a queue per editor) and "archive this page by hand"
10. "The tables": one bullet per table, then the five tables in this order: Rulebook, Claims, Tag decisions, Rule changes, Agent settings
11. A collapsed **Help** toggle: the Why wrong table (Agent slip, Rule unclear, Rule should change, empty), "Words used on this page", "If something stops"

Every step has the same four headings: Goal of the step, Existing status, Doing the work, Explaining the outputs (with each table as it looks after the step).

**The five tables and their 16 rows**

| Table | Rows | Content |
|---|---|---|
| Rulebook | 1 | Context-dependent, copied from the taxonomy row (When to use, Description, Example Claims, Counterpart Self-contained, Evidence link), edition 2026-10-15.1 |
| Claims | 7 | the seven real claims below, shaped like the real claims table; Agent tags and Agent notes empty |
| Tag decisions | 7 | one row per claim on Context-dependent: 5 carry the audit decisions, 2 are open |
| Rule changes | 0 | empty until step 4 |
| Agent settings | 1 | Claim tagger · Rulebook edition 2026-10-15.1 · Last run summary "Practice page · 15 Oct 19:00 · built" |

The seven claims:

| Claim | In the queue |
|---|---|
| The press pool was justified in suspending coverage in solidarity with banned networks | waits for the editor (picked for the demo) |
| The AI Force should enforce binding safety standards | waits for the editor (the agent is unsure) |
| Excluding CNN from Air Force One violates the federal court order | decided: Applies (agent had said Does not apply; Agent slip) |
| The Dallas convention is the unofficial launch of JD Vance's 2028 presidential campaign | decided: Applies (agent: Does not apply; Agent slip) |
| A contractor's enforcement of safety restrictions constitutes a national security supply chain risk | decided: Does not apply (agent: Applies; Agent slip) |
| Relocating the Kennedy Center Honors to a sports arena diminishes the prestige of the awards | decided: Does not apply (agent: Applies; Agent slip) |
| December stopgap funding rewards Congress for avoiding a full budget | decided: Does not apply (agent: Applies; Agent slip) |

The five decided rows carry "From the audit of 9 October" in Your reasoning, the one seeding of editor columns a practice page allows.

**Views (4):** Rulebook (a tab, first) and Needs your note (a tab, last) on their own tables; Your queue (Tag decisions) and Lessons waiting (Rule changes) as linked views placed under steps 3 and 5. If Notion refuses a linked view, a paragraph saying where to scroll goes in the same place.

**The 16 requests a real build sends:** the GET of the parent (the only one sent today), POST the page, PATCH the 86 blocks of text, 5 POST databases, PATCH the Help toggle and the 17 blocks inside it, 4 POST views, and 2 PATCHes used only if a linked view is refused. The rows then go in as plans with a ledger and a read-back, and `verify` runs at the end.

**Two things to know before building**

- `agents\claim-tagger-mvp\runs\PAUSED` exists. A dry run is allowed while paused, but a real `start` stops with exit 3 until a person removes that file.
- The dry run left only the two files above in `runs\demos\20261015-1900-94990d\` (no demo.json, so `list` ignores it). The dry-run client is wrapped in a read-only guard, so no write could have reached Notion.

Next: when you want it built, say so and I'll run `node agents/claim-tagger-mvp/scripts/walkthrough.mjs start --parent https://www.notion.so/3fa273e214eb81c2b223dcc2331b7051` once the pause is cleared, then `verify`. If you'd rather read the whole page text first, I can open preview.md.
