# Handover: testing the claim tagger's feedback loop on your own machine

The claim tagger is an agent that reads Geo claims against a written rulebook and tags them; you, the editor, decide the tags on the claims table itself, the agent reads each of your decisions and drafts a rule change from the ones that point at the rule, and a safety check tests the draft against every earlier decision before the rulebook changes. Everything lives under the Notion page "Claim tagger" (the hub). You learn the loop on a practice page: your own small copy of the tables with nine real claims, four of which wait for your decision, and seven numbered steps written on the page. Nothing you do there touches real claims or the real rulebook. You need Node 22 or later, Claude Code on a subscription, access to the hub "Claim tagger", and the Notion integration token, which the product owner gives you privately.

## Steps

1. **Get the repository.** If you have never cloned it:

   ```
   git clone https://github.com/mikallojjus/feedback-distillation-loop-mvp.git
   cd feedback-distillation-loop-mvp
   ```

   If you already have a checkout from before 27 October 2026, run `git pull` in it before you run anything else. The older code still names the tables that now sit in the hub's archive, and would write to them.

2. **Check Node:** `node --version` must print 22 or later. There is nothing to install; the scripts use Node's built-ins only.

3. **Add the Notion token.** Copy `.env.example` to `.env` in the repository root and make its one line read exactly `NOTION_TOKEN=<the token>`, with no quotes or spaces. `.env` is ignored by git; never paste the token anywhere else. The integration is already connected to the hub.

4. **Open Claude Code in the folder** (the desktop app: open the folder; the terminal: `claude` inside it) and trust the folder when asked. The two skills, `/claim-tagger-walkthrough` and `/claim-tagger`, come from the repository and are ready at once. Optional check that everything runs: `npm test` passes without touching Notion.

5. **Build your practice page.** In Claude Code type `/claim-tagger-walkthrough`. When asked for the page, say "Onboarding" and Claude uses the hub's Onboarding page, or paste its link: <!-- stage 5: link -->. About a minute later Claude gives you the link of your new page, "Claim tagger practice · <date and time>". Other people's practice pages sit under the same Onboarding page, and the demo commands act on the newest one there; if a colleague builds a page after yours, ask Claude which practice page the commands reach.

6. **Follow the seven steps written on the page.** In short: step 1 `/claim-tagger demo status`; step 2 `/claim-tagger demo tag`; step 3 decide your four claims in Your queue in Notion (Verified tags, a note, Review status Reviewed); step 4 `/claim-tagger demo distill`; step 5 approve the draft in Lessons waiting; step 6 `/claim-tagger demo promote`; step 7 read what the follow-up did. At any point ask Claude "where am I in the claim tagger demo".

7. **Three rules of the road.** The commands with `demo` act on your practice page, and the page guides you through them. The commands without `demo` act on Claims, the real training table under the hub: 200 Geo claims, and every decision you make there is training data the rulebook learns from, so decide there only when you mean the decision. Do not edit the rulebook's "When to use" by hand, on the page or on the hub: rule changes go through Lessons waiting, and a hand edit stops every command until it is put back. If a command stops, type it again as its report says; if it stops the same way twice, send the whole report to the engineer.

## Resources

For you, and for an AI agent you want to brief before running the skills (point it at the files and ask it to read them first):

| File | What it gives |
|---|---|
| `README.md` | Install, the daily loop in the editor's words, what stops a command |
| `CLAUDE.md` | The hard rules every agent in this repository follows: what is never written in Notion, how a rule changes |
| `.claude/skills/claim-tagger-walkthrough/SKILL.md` | What the practice page is and what each demo command runs |
| `.claude/skills/claim-tagger/SKILL.md` and `references/guide.md` | The real commands, the three-part reports, and the checklists Claude adds after each report |
| `agents/claim-tagger-mvp/walkthrough/page.md` | The text of the practice page, step by step, with its Help section |
| `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` | The hub "Claim tagger", the Claims table seeded from Geo, the archive, and why (decisions P5 to P12) |
| `docs/mvp-2026-11/READ-DECISIONS.md` | How the agent reads your decisions (Agent slip, Rule unclear, Rule should change), the reason word, decisions without a note |
| `docs/mvp-2026-11/CLAIMS-REVIEW.md` | How a decision on the claims table is read, one note line per tag |
| `docs/mvp-2026-11/STRUCTURE.md` | The first proposal of the tables, columns and views (15 October), with sample rows; kept as history |
| `docs/mvp-2026-11/DECISIONS.md` | Every design decision with its reason, P1 to P12 and 1 to 97 |
| `docs/mvp-2026-11/BACKLOG.md` | What is left out, why, and what would trigger it |
| `agents/claim-tagger-mvp/AGENT.md` | The engineer's runbook: commands, run folders, models, safety |
| `docs/mvp-2026-11/WORKLOG.md` | The build's log, entry by entry, with the verification runs |

A good first ask for your agent: "Read CLAUDE.md, README.md, the two SKILL.md files and docs/mvp-2026-11/READ-DECISIONS.md, then explain what happens between my decision in Notion and a rule change, and what I can and cannot do by hand."
