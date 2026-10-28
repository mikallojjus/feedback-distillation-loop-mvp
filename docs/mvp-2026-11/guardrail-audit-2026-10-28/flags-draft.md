# Draft flags from the pro-editor review (to verify)

Paths are relative to X:\work\geo-agents; scripts are under agents/claim-tagger-mvp/scripts/.

## Talking to Claude
F1 Claude can't explain anything | major | "why did it tag claim 12?" gets no answer: Claude may not read files or run records and is told not to explain | SKILL.md:8, :12, :36
F2 Thin reports, relayed verbatim | moderate | "none of the drafts passed the checks", and nobody may tell me which check | SKILL.md:17, :60-68; distill.mjs:661
F3 "Ask the engineer" dead ends | moderate | many refusals end "ask the engineer to look at the message the script printed", even when I could fix it | decide.mjs:67; promote.mjs:66; lib/loop.mjs refusals; decide open shape refusal; EDITOR-HANDOVER "send the whole report to the engineer"
F4 A stuck decide run blocks me for 2 hours | moderate | if Claude drops out mid-decide, the next decide is refused with "ask the engineer"; decide check would close it, but the report does not say so | decide.mjs:451-454
F5 One changed claim refuses the whole batch | moderate | one claim touched in Notion, and all ten in the draft are refused; start over, second OK | decide.mjs:486, :507-509
F6 One command per turn, no chaining | moderate | "tag, then distill, then show me what waits" takes three turns | SKILL.md:12, :15; status one Next line
F7 Same checklist after every report | minor | after the tenth time it is noise and cannot be turned off | SKILL.md:70-74; guide.md
F8 Claude only ever sets Reviewed; no shortcut for trivial batches | minor | cannot put a claim back To review; "decide the first 6 and write them" still needs a draft | guard.mjs:163-187; SKILL.md Deciding

## Changing the rulebook
F9 Editing my own rulebook stops everything | major | any edit to When to use, Description, Example Claims or Counterpart of the judged tag stops every command (status and decide included) until undone | lib/preflight.mjs:69-79; judge.mjs drift; lib/rubric.mjs:243-253, :369-376
F10 No direct way to start a rule change | major | a rule changes only after distill finds 2+ decided claims pointing at it; I cannot say "rewrite rule 3" | distill.mjs:171-173; config distill.min_claims; CLAUDE.md hard rule 4
F11 Only an existing numbered rule can change | major | cannot add a rule 6, remove or merge rules, or touch the preamble/note | promote.mjs:283-287; lib/rulebook-edit.mjs:49-86
F12 The safety check cannot be overruled, and its examples are hidden | major | FAIL wins even when I want an example's expected answer to change; the examples live in the engineer's files (evals/canaries.jsonl), frozen; only the engineer recalibrates | promote.mjs:11-17; evals/canaries.jsonl
F13 Editor wording means retyping the whole rule | moderate | to change one word I paste the full rule (line breaks lost); after a FAIL I copy the report's whole text into Notion by hand | promote.mjs:133-137, :464; lib/rulebook-edit.mjs:33-35
F14 Only the engineer can make a tag judged | moderate | writing rules for Wordy judges nothing until the engineer edits config judge.groups; a newly judged tag HOLDs with "ask the engineer to set up example claims" | config judge.groups; AGENT.md:214; promote.mjs:426-437
F15 Drafts dropped without a visible reason | moderate | a note that quotes 8 words of the claim silently kills the draft; the reason is only in run.json | distill.mjs:277-313; config overfit_ngram 8
F16 A withdrawn row means reject and redraft | minor | re-reading one supporting claim as Agent slip means I must reject the change and distill again; the agent never drops the row itself | distill.mjs:504-510; promote.mjs:323-333
F17 One change at a time | minor | one open change per rule, max 3 drafts a run, promote needs a title when two are Approved | distill.mjs:176-178, :561; lib/loop.mjs:422-425

## Working in Notion
F18 I must re-tick the agent's tags I agree with | moderate | a judged tag left unticked in Verified tags = Does not apply, even when the agent had it | setup/structure.json:215; guide.md:31
F19 Notes need exact syntax | moderate | each line needs "<Tag>:", the reason word needs its full stop; without the prefix a line counts for every tag the agent got wrong; the practice page's own examples break this | lib/decisions.mjs:44, :74-101; walkthrough/page.md
F20 The views hide what I decide on | moderate | the handover says sort All claims by Agent confidence, which that view hides; Your queue shows no confidence and no Geo URL; on To review claims the agent's answer is buried in Agent reasons | structure.json:294-305, :596-611; propose.mjs:142-145
F21 Lessons waiting hides the fields I act on | moderate | Editor wording, Safety check result, Tag, Rule, Supporting rows not shown; Live, Rejected, Rolled back vanish (no history) | structure.json:677-689, :545-554
F22 Claims I need to see have no way in | moderate | Agent disagreed not linked on the hub; Could not read has no view | structure.json:697-701, :626-640
F23 Hub clutter | minor | Tag decisions (17 columns, "never edit here"), two ledger views and the archive page on my hub | structure.json:309, :642-675
F24 Stale Agent status and cut reasons | minor | Agent status still "Waits for you" after I decide, until the next tag run; reasons cut at 40 words | walkthrough/page.md:121; judge.mjs:608-611

## Hard rules and security
F25 Claude cannot do rule-owner actions even when I ask | major | "approve it", "use that wording", "untick Paused" are refused | guard.mjs:92-105; CLAUDE.md hard rule 1; SKILL.md:13
F26 The pause file needs the engineer | moderate | no unpause command; Next "ask the engineer to remove the pause file" | lib/preflight.mjs:31-32; CLAUDE.md hard rule 7
F27 Claude cannot add a view or column for me | minor | "add a By Geo Space view" is denied outside builder sessions | guard.mjs:216-249
F28 Nothing is ever deleted | minor | rejected changes and old practice pages pile up | CLAUDE.md hard rule 8; guard.mjs:44-45
F29 A different model stops everything | minor | another model answering gives exit 4, "ask the engineer" | judge.mjs:1190-1197; config models
F30 Only the 200-claim copy counts | minor | Claims to review and other real tables are protected; work there never trains the rulebook | CLAUDE.md hard rule 10; config protected ids

## Missing conveniences
M1 Undo a decide write ("put these back"; the run record keeps the earlier values)
M2 Why this tag (one claim: the rule cited, each reading, the confidence)
M3 Bulk agree ("accept the agent on every claim above 0.9")
M4 Try a wording (run the safety check without approving)
M5 Check my Rulebook edit instead of stopping (put a hand edit through the safety check)
M6 Add, remove or split a rule as a rule change
M7 Example claims in Notion (see them, correct their expected answers)
M8 Rule change history view (Live, Rejected, Rolled back)
M9 Reopen a claim (send it back to Your queue or a colleague)
M10 The draft in the chat (distill shows Current vs Proposed; approve or reword there)
