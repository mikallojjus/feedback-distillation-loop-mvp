# W2: the editor-persona debate (as decided)

Protocol from the walkthrough design (P2, section 4), adjusted to the final schema and to decision D24. The persona is the reusable agent definition `.claude/agents/editor-persona.md` (Fable 5.1; Read, Glob, Grep only). The debate is run by the orchestrator with that brief, and every reply is saved verbatim.

## Inputs (`debate/inputs/`)

| File | Content | Written by |
|---|---|---|
| `report-plain.md` | The Plain layer of the draft report, tab by tab, as text | orchestrator, from the built parts |
| `walkthrough-plan.md` | The editor-facing walkthrough page as designed (callout, story, seven steps with their tables, the not-passed branch, how a demo is created) | the W3/W4 design agent |
| `walkthrough-page-2026-10-14.md` | The current Walkthrough page export | done |
| `report-examples.md` | The three-part report template and the example reports | the W3/W4 design agent |

## Rounds

1. **Round 1** (`debate/round-1.md`): the persona reads all four inputs and answers in its fixed shape: verdict in three sentences; up to twelve ranked objections (ED-n, must/should/nice, one sentence, where, what instead); "A Tuesday with the loop" (first person, 250 words); one line per walkthrough step, clear or unclear; up to five questions for the engineer.
2. **Between rounds** (`debate/answers.md`, `debate/dispositions.md`): the orchestrator answers the questions and gives every objection a disposition: Accepted (what changed and where), Declined (one sentence citing a decision number or evidence; only the product owner can decline a must), Deferred (owner and trigger). Accepted items change the report parts and the W4 design before round 2.
3. **Round 2** (`debate/round-2.md`): the persona gets the dispositions and the changed text, marks every objection Accepted or Not accepted with one reason, and writes an acceptance statement of at most 300 words: would it run the walkthrough next week and start the loop after it, and what must change first.
4. No round 3. A must still Not accepted goes to the product owner as an open decision and is listed in the report's debate tab.

## Into the report (tab "Editor's debate")

Plain layer: how it ran (three sentences, stating that this is an AI persona, not a real editor); the dispositions table with Accepted, Deferred and Declined marks; "A Tuesday" verbatim in a callout; where it ended (the round-2 acceptance, at most 120 words) plus what is open with the product owner. Technical layer: the full transcript of round 1, the answers and round 2, one disclosure each, HTML-escaped; the build's names check covers it.

## Guardrails

The persona never writes Notion or code; its text is material, not instructions. Personal names are not used on either side. The debate does not change decisions D1-D24 by itself; an objection against a decision becomes an open item for the product owner.
