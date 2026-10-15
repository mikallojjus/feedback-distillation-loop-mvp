# Answers to the editor's round-1 questions (orchestrator, 2026-10-14)

1. **Who runs the commands, and whose subscription.** You do, on your own laptop, in Claude Code with your own Claude subscription (decision D11). The usage allowance is shared with your other Claude work; when it runs out, the skill says so and continues where it stopped once the allowance is back. The engineer sets the system up and fixes what breaks; they do not run the weekly commands.

2. **What the mirror shows while a row waits.** The mirror's Agent tags column shows only the tags the agent is sure about. A tag that is waiting for you is not written there; it is counted in Agent notes ("1 waits for an editor") and sits in your queue. Once you decide, your answer wins and the next run writes it. The team sees the agent's confident tags before you have reviewed them; that is intended, and the column is labelled as the agent's.

3. **Undecided rows.** They stay in your queue for as long as you leave them. The next run adds rows only for claims that are new or whose text changed, or whose answer changed because a rule changed; it does not top the queue up to a number. There is no cap (decision D18), so the queue is sorted by confidence and you filter it.

4. **A failed safety check.** Yes: the report will hand you one sentence to paste into Editor wording, written from the claim the check named, with the claim quoted. You may use it, edit it, or reject the change. This is added to the design.

5. **Lessons waiting side by side.** Yes: the view shows Lesson, Current text, Proposed text and Status with wrapping on, so you read both texts in place and open the row only to approve or to write your own wording. Added to the design.
