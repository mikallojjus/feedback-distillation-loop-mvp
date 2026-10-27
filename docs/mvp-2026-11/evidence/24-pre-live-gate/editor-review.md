# Editor review of the editor-facing text (stage 7), editor persona on Opus, 2026-10-27

Saved from the reviewer's message. The product owner's answers to ED-1 to ED-4 are decisions P13 to P16 (`DECISIONS.md`): ED-1 → P16 (keep, say it plainly), ED-2 → P14 (one line on the hub), ED-3 and ED-6 → P15 (lean views), ED-4 → P13 (leave Your queue when Reviewed).

## Verdict

I would start the loop myself after the walkthrough, but I would not hand the hub to other editors yet. Four things stop me:

- On Claims, a tag I don't re-enter from Agent tags silently becomes my "Does not apply".
- Nothing on the hub says that decisions there are real.
- Your queue is a wall of 13 wrapping columns.
- Rows I have decided stay in the queue until the next tag run.

## Objections

**ED-1 · must.** Any judged tag I leave out of Verified tags counts as my "Does not apply", including tags the agent already put in Agent tags.
- Decided by P16: the rule stays and is said plainly.
- Column description: "Every tag that applies, Agent tags included. A judged tag you leave out counts as Does not apply."
- Guide step 3 ("Decide in Your queue", real list): "Verified tags: every tag that applies, the ones in Agent tags included; one left out counts as Does not apply."
- Practice page step 3 gets: "On the real Claims table the agent judges several tags: keep the Agent tags you agree with in Verified tags."

**ED-2 · must.** That decisions on Claims are real is not on the hub at all, and the handover title says "testing".
- Hub line: "Claims is the real table: every decision you make there trains the rulebook. To practise, open Onboarding." (P14)
- Handover title: "Handover: learn the claim tagger on a practice page, then decide on Claims".
- Directly under the title: "A practice page under Onboarding is for learning; nothing you do there counts. Claims, on the hub, is the real table; every decision there trains the rulebook, so decide only when you mean it."

**ED-3 · must.** Your queue, Needs your note and Agent disagreed each show 13 wrapping columns. Agent status has the same value on every row, because it is the view's filter. P15 sets the columns:
- Your queue: Geo Name, Tags waiting, Agent reasons, Agent tags, Verified tags, Challenged tags notes, Review status.
- Needs your note: Geo Name, Verified tags, Agent reading, Challenged tags notes (plus Review status, last).
- Agent disagreed: Geo Name, Agent reasons, Agent reading, Verified tags, Challenged tags notes (plus Review status, last).
- Hidden in all three: Agent confidence (still the sort), Agent status, Agent edition, Agent remarks, and every Geo column but Geo Name.
- The editor columns come in the order the guide fills them: Verified tags, Challenged tags notes, Review status.

**ED-4 · must.** A decided claim stays in Your queue until the next tag run (P13 changes this).
- Filter: "Agent status is Waits for you and Review status is not Reviewed".
- Agent status description: "Your queue lists Waits for you until you set Review status to Reviewed."
- Guide, demo step 4, and practice page step 3: "A claim leaves Your queue as soon as you set Review status to Reviewed."

**ED-5 · should.** The Lessons waiting link says "your approval" to every editor, but approving is the rule owner's job.
- Link line: "Lessons waiting: rule changes the agent drafted, for the rule owner to approve or reject".
- Handover step 7 adds: "Editors decide claims; the rule owner approves or rejects rule changes in Lessons waiting."

**ED-6 · should.** Clicking a table on the hub opens its first tab, which shows every column (P15):
- Claims: first tab "All claims", showing Geo Name, Geo Space, Agent tags, Agent status, Verified tags, Review status, Geo URL.
- Rulebook: Name, Category, Status, When to use, Example Claims.
- Rule changes: Lesson, Tag, Status, Current text, Proposed text, Safety check result.
- Tag decisions: Claim, Tag, Agent proposal, Tag outcome, Agent reading.

**ED-7 · should.** The Needs your note link claims to cover every decision without a note, but it lists only claims where I overruled the agent.
- Link line: "Needs your note: claims where you overruled the agent and left no note".
- Guide step 4: "A note is optional when you agree. When you overrule the agent, add one line why: without it the agent drafts no rule change."

**ED-8 · should.** The hub lists five tables with no word on what each is for, and "Tag decisions" looks like the place to decide. Give each table a one-line description:
- Claims: "200 Geo claims tagged Debate. Decide them through Your queue; every decision trains the rulebook."
- Rulebook: "One row per tag; When to use holds the rules. Change rules through Lessons waiting."
- Rule changes: "Rule changes the agent drafted. The rule owner sets Approved or Rejected."
- Tag decisions: "The agent's record, copied from Claims. Read only; never edit here."
- Agent settings: "Tick Paused to stop every command; untick to resume."

The views could be renamed "Open rows (agent's record)" and "No note yet (agent's record)".

**ED-9 · should.** The archived tables keep the live names, so someone could tick Paused in the old Agent settings and think the agent stopped.
- The archive page's first lines add: "The tables here share names with the live ones and do nothing now; use the hub."
- Practice page, end of step 7: "When you are done, leave this page under Onboarding; it does no harm." This replaces "Archive this page by hand".

**ED-10 · should.** The handover forbids any hand edit to When to use, while hard rule 5 lets a person give an empty tag its first rules that way.
- Wording: "Do not change rules a tag already has: rule changes go through Lessons waiting, and a hand edit stops every command. To give a tag with no rules its first rules, the rule owner writes them in its When to use."

**ED-11 · should.** Handover step 5 still holds a placeholder that renders as "paste its link: .". It also tells people to ask Claude about a colleague's newer page, which may never be reachable, because runs/ is ignored by git.
- Wording: "In Claude Code type /claim-tagger-walkthrough. When it asks for a page, say Onboarding. About a minute later Claude gives you the link of your new page."
- Drop the colleague sentence.

**ED-12 · should.** The practice page's Help words list says "the real claims table calls this column Claim quality tags — verified", which is no longer true.
- Replacement: "Verified tags: the tags you confirm on a claim; it always wins over the agent's answer."

Fine as is: the "Your queue" link line, the Onboarding line, the archive page's link back, the four-column Lessons waiting view, the split between demo and real commands, and the three-part reports. Also: in practice step 7, "in The tables just below" reads like a typo.
