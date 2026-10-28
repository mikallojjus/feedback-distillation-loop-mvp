# Handover: learn the claim tagger on a practice page, then decide on Claims

A practice page under Onboarding is for learning; nothing you do there counts. Claims, on the hub, is the real table; every decision there trains the rulebook, so decide only when you mean it.

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

5. **Build your practice page.** In Claude Code type /claim-tagger-walkthrough. When it asks for a page, say Onboarding. About a minute later Claude gives you the link of your new page.

6. **Follow the seven steps written on the page.** In short: step 1 `/claim-tagger demo status`; step 2 `/claim-tagger demo tag`; step 3 decide your four claims in Your queue in Notion (Verified tags, a note, Review status Reviewed), or ask Claude with `/claim-tagger demo decide`; step 4 `/claim-tagger demo distill`; step 5 approve the draft in Lessons waiting; step 6 `/claim-tagger demo promote`; step 7 read what the follow-up did. At any point ask Claude "where am I in the claim tagger demo".

   The safety check (step 6) blocks a change for two reasons only: it turns an example claim or an earlier decision the rule in force got right into a wrong one, or it leaves one of the claims it rests on wrong. An example claim the rule in force already got wrong, and still gets wrong, is shown in its own row, "Wrong before the change", and not counted. When the check says FAIL, the report names the claim and the answer it should have, and suggests a sentence for the rule: the sentence, a Why line that says why it gives the claim that answer, and a block with the whole rule and the sentence, one sentence per line. Read the Why line, then paste the block into Editor wording in Lessons waiting in place of what is there (or write the whole rule as you want it) and type the promote command again; to give the change up, set Status to Rejected. Claude cannot write Editor wording yet: you paste it.

7. **Three rules of the road.** The commands with `demo` act on your practice page, and the page guides you through them. The commands without `demo` act on Claims, the real training table under the hub: the 200 Geo claims picked at setup and the ones editors add, and every decision you make there is training data the rulebook learns from, so decide there only when you mean the decision. Editors decide claims; the rule owner approves or rejects rule changes in Lessons waiting. You can decide a claim in Notion yourself, or work with Claude (the next step). Claude writes only Verified tags, Challenged tags notes and Review status, on the claims you agreed on in its draft, only after you say to write them, and reads every claim back; it never approves a rule change. Its decisions train the rulebook exactly like yours, so ask only when you mean the decisions. On a practice page the same is `/claim-tagger demo decide`. If Claude stops before it has read the claims back, or the read-back could not reach Notion, type `/claim-tagger decide check`. Do not change rules a tag already has: rule changes go through Lessons waiting, and a hand edit stops every command. To give a tag with no rules its first rules, the rule owner writes them in its When to use. If a command stops, type it again as its report says; if it stops the same way twice, send the whole report to the engineer.

8. **Work with your Claude on the real Claims.** This is a conversation, and nothing is written until you say so.
   1. In Notion open All claims and sort it by Agent confidence, lowest first. Read the agent's tags and reasons.
   2. In Claude Code type `/claim-tagger decide` and tell Claude what is wrong and why, in your own words: `/claim-tagger decide claim 2 is context-dependent, "it" has no antecedent`. You can describe a claim instead of naming it ("the one about the budget"); Claude asks when it cannot tell which one you mean. To let Claude judge, type `/claim-tagger decide the first 6`: it applies the rules in force to the first six claims of Your queue.
   3. Claude shows a draft before it writes anything: one table with a row for each claim, the tags now and after, the note it will write word for word, and "changes an earlier review" when the claim was Reviewed. Your words stay yours: Claude adds only the tag name and a colon in front, and line breaks, and a reason word (Agent slip, Rule unclear, Rule should change) only when you gave one or your words make it clear. Read the draft and say what to change. Claude shows the table again.
   4. When the draft is right, say "write it". Claude writes the claims, reads every one back, and tells you how many differ from the agent. There is no permission prompt for each write: your "write it" is the approval. If a permission prompt for `notion-update-page` does appear, the guard did not run: answer No, never "Yes, and don't ask again", and tell the engineer.
   5. You may change a claim another editor reviewed. The draft says so, and Notion's page history keeps the earlier version.
   6. If you fixed the tags in Notion yourself and only the notes are missing, tell Claude: `/claim-tagger decide write the notes for the claims in Needs your note`. You get the same draft and give the same OK. If you change a claim in Notion while Claude holds a draft, say so, and Claude reads the claims again.

9. **Add a claim from Geo to Claims.** To bring a claim you care about into the feedback loop, type `/claim-tagger add` and its Geo link or Geo ID, for example `/claim-tagger add https://www.geobrowser.io/space/<space>/<claim>`. You can give up to 50, separated by spaces.
   - **Where to get it.** Open the claim in Geo and copy the address from the browser's address bar (`https://www.geobrowser.io/space/.../...`). Or give its Geo ID, the last part of that address: 32 characters, digits and the letters a to f. A Notion link or the claim's text does not work.
   - **What it takes.** It must be a claim in one of the six spaces of Claims (U.S. Politics, World affairs, AI, Health, Crypto, Technology); it need not be tagged Debate in Geo. The report says what was not added and why, in these words: "Already in Claims", "Not found in Geo", "Not a claim", "Not in the six spaces of Claims", "Same text as a claim in Claims" (the report names the claim that is there), "Not a Geo link or ID", "No name in Geo", and "A source links to a protected Notion page".
   - **What it writes.** A new row in Claims with what Geo holds: name, link, space, date, sources, whether Geo marks it factual, Geo's own tags and topics. The agent's tags come only after `/claim-tagger tag`. There is no permission prompt, because nothing but new rows is written and no existing row changes; every new row is read back.
   - **After.** Then type `/claim-tagger tag`. The agent reads the new claims and puts the ones it is unsure about in Your queue. The others stay in All claims, where you can decide them yourself or name them to Claude with `/claim-tagger decide`. Nothing on the row shows it was added by hand. To find it, open All claims and search for a few of its words.
   - If the command stops, type it again with the same links: the claims that were added are skipped. A claim you add trains the rulebook like every other, so add only the claims you mean to decide. There is no practice-page version of this command.

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
| `docs/mvp-2026-11/CLAUDE-DECIDES.md` | How Claude decides claims with you (`/claim-tagger decide`): the draft and your OK, what it may write, and how every claim is read back |
| `docs/mvp-2026-11/ADD-CLAIMS.md` | How you add Geo claims to Claims (`/claim-tagger add`): what is read from Geo, what is refused, and what is written |
| `docs/mvp-2026-11/STRUCTURE.md` | The first proposal of the tables, columns and views (15 October), with sample rows; kept as history |
| `docs/mvp-2026-11/DECISIONS.md` | Every design decision with its reason: the decisions in that file |
| `docs/mvp-2026-11/BACKLOG.md` | What is left out, why, and what would trigger it |
| `agents/claim-tagger-mvp/AGENT.md` | The engineer's runbook: commands, run folders, models, safety |
| `docs/mvp-2026-11/WORKLOG.md` | The build's log, entry by entry, with the verification runs |

A good first ask for your agent: "Read CLAUDE.md, README.md, the two SKILL.md files and docs/mvp-2026-11/READ-DECISIONS.md, then explain what happens between my decision in Notion and a rule change, and what I can and cannot do by hand."
