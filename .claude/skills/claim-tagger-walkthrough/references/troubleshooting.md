# Troubleshooting the walkthrough

`W` is `node agents/claim-tagger-mvp/scripts/walkthrough.mjs`.

| What happened | What to do |
|---|---|
| `W start` stopped halfway (exit 1) | Run `W start --resume <id>` once, with the id the report names. The script continues from its record and never creates a page or table twice; a lost create is checked by title before it is sent again. Do not start a second page. |
| `W start` says the page cannot be reached (exit 2) | Relay: "In Notion, open that page, choose the connections menu and add the claim tagger connection, or pick another page." Then wait for a link. |
| `W start` says the page is protected (exit 2) | The parent is a real table, one of its rows, the production page or one of its tables. Ask for another page. |
| A demo command says your Claude allowance ran out (exit 75) | Relay the report. When the allowance is back, the editor types the same command again; it continues where it stopped. |
| The promote report says PASS but the Agent notes of the two claims in step 7 still name the old edition | The run stopped before its last step. `W where` says so and points at `/claim-tagger demo follow-up`, which repeats the follow-up alone. |
| The promote report says FAIL | Relay it as printed: it names the claim and hands the editor the whole text to put into Editor wording (the rule as it was tested, with one added sentence). The editor edits or rejects in Lessons waiting and types `/claim-tagger demo promote` again. A second FAIL: the editor sets Status to Rejected; the demo ends there, and that is a correct outcome. |
| A command says the agent is paused (exit 3) | The practice page's Agent settings row has Paused ticked, or `runs/PAUSED` exists in the demo folder. A person unticks it; then the same command again. |
| A command says the rulebook text was edited by hand (exit 4) | Someone changed When to use on the practice page's Rulebook. Relay the report; a person puts the text back (or the engineer runs the restore command for that demo); then the same command again. |
| The editor asks which page a command acted on | Every demo report names the practice page in its sentence. `W list` shows every practice page with its link and step; commands act on the newest one unless `--demo <id>` is given to `W run`. |
| Two practice pages exist and the editor is on the older one | Tell the editor the commands act on the newest page and ask the engineer before continuing; do not delete or archive anything. |
