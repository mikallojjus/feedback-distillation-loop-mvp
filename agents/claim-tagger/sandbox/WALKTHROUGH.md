# Walkthrough (pointer)

The editor walkthrough lives on the Notion page **Walkthrough** inside Editorial feedback loop:
https://app.notion.com/p/3f9273e214eb81c2a075fd94e339d40e

That page is the single source of the instructions; it is not copied here, so the two cannot drift. Its outline:

1. The ideas in two minutes: claims, tags (Predictive, Hypothetical), the rulebook, the agent, the loop (diagram).
2. The story: four hedged "likely to" / "on track to" claims that Predictive rule 1 tags, wrongly.
3. The tables on this page: what each view is for, who types where, the queue-row columns, the six underlying tables.
4. Steps 1 to 8: status, tag, decide (Why wrong explained), distill, approve (rule owner), gate (canaries, regression cases, verdicts), follow-up, status. Each step: what is happening, do, expect.
5. Toggles: words used on the page, what you just saw, if something stops.

The sandbox itself: `walkthrough.json` (tags and seed keys), `config.json` (the six sandbox databases), `rubric/`, `evals/`; run scripts with `node agents/claim-tagger/scripts/sandbox.mjs <script> ...` or `/claim-tagger sandbox <subcommand>`. Notion schema and views: `schemas/notion/as-built.md`, section "Walkthrough sandbox".
