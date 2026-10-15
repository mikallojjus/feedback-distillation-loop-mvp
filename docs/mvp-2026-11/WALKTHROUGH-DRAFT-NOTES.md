# Walkthrough draft: what was decided (2026-10-15)

Drafts of `agents/claim-tagger-mvp/walkthrough/manifest.json` and `page.md`, from W4 digest sections 2 to 5, STRUCTURE.md, CONTRACTS.md, the taxonomy file, the 50-claim pick and the audit evidence. Nothing in Notion, the scripts or the tests was touched.

## Manifest

- A scratchpad script built it from the three source files, so no value was copied by hand. `tag` and `counterpart` carry the taxonomy columns. `Example Claims` is split one claim per line, and it joins back to the exact cell text. `copied_from` is a string, as in the design: "Claim Tags — verified row <page id>, 2026-10-15".
- Canaries: canary-1 to canary-6 are the six examples of Context-dependent (apply). canary-7 to canary-11 are the five examples of Self-contained (do_not_apply). They were split with `parseExamples`, and `source` is written as in CONTRACTS section 4. They have no `tag` field, because the brief's shape has none. The builder must add `"tag": "Context-dependent"` when it writes `evals/canaries.jsonl`, because judge.mjs selects canaries by tag.
- Claims: they are in story order. Each one has the pick's 13 Geo columns plus `source_pieces`, under the pick's own key names. The Geo Sources link counts are 1, 1, 2, 4, 4, 7 and 0, as the design says.
- `short`: each claim is cut at a word boundary near 60 characters and ends with "…", the character that plan.mjs and STRUCTURE use. The contractor claim keeps "constitutes" (61 characters), as STRUCTURE shows it. The page uses these same shorts in every table, the story table included.
- Decided rows:
  - Agent proposal comes from the audit flag: Wrong tag gives Applies and Missing tag gives Does not apply. STRUCTURE's sample of a seeded row does the same.
  - All five rows came out as Agent slip, because all five were agent errors that the editor agreed with.
  - Agent confidence, Agent reason and Rulebook edition stay empty on these rows (the audit recorded none), so they are not in the manifest.
- Open rows: the covid sentence has straight double quotes inside it, as in the design's table. The page's step 3 instruction keeps the design's single quotes, because there the whole sentence is itself in quotes.
- Alternates: the two entries in the brief.
  - fairford-credibility has text null.
  - usps-ballot-portal has the design's text. Its `geo_id` is null and `geo_id_prefix` is "27ad00b5", because the design gives only a cut-off ID.
  - The design's second Fairford claim (9e8c7142…) is not listed.
  - The dry run dry-1 holds all three alternates: 692b48b7467b0220aed4d2a44002cfcf, 9e8c71422b0fb7f264a9ff88ef4f0e74 and 27ad00b59c1f7d4aee71643fc8cdec94.
  - If Georgia is swapped out, its earlier-decision row from the audit is: Agent proposal Does not apply, Tag outcome Does not apply, Why wrong empty, and Your reasoning "From the audit of 9 October: We do not need to add context-dependent. the claim reads well".

## Page template

- Format:
  - The four sub-headings are bold labels at the start of a paragraph ("**Goal of the step.**" and so on), not bullets. This keeps the captions, the tables and the two views at the top level.
  - The callout is the first paragraph: two lines, starting with "Callout: ".
  - The file has no page title; the builder names the page.
  - Commands are in backticks.
  - `{{date}}` appears only in step 6's sample Last run summary, where it should take the "16 Oct" form.
  - A "## The tables" heading above the six-line list marks where step 7 ends.
- Wording changed from the design, each for a lint rule or for accuracy:
  - Step 1's goal says "is set up", not "is ready", because Ready is the retired Agent notes label.
  - Step 1's status says "Nothing is paused.", not "Agent settings: not paused.", because the lint allows Agent settings in step 6 only.
  - The story quotes rule 4 word for word from the taxonomy instead of paraphrasing it.
  - Step 2 adds one clause: the five earlier rows keep the answer the agent gave before the audit. Without it, "the agent agrees with all 5" contradicts the Agent proposal shown on those rows.
  - Steps 1 and 6 describe the three parts of the report, as in the report examples. Step 1 says the sentence starts with "Demo · " and the Next line gives the command for step 2. Step 6 says the PASS report counts what came out right and points to step 7, and that the FAIL report's Next line carries the proposed sentence.
  - Step 7's Agent notes cells end with "the next edition", followed by one sentence that explains it.
  - The lines on the full version say "when more editors join", because the lint counts "second" as a time word. They also say "Duplicates are found by searching all claims", because the MVP has no exact-text check (decision 10).
  - Help: the Why wrong table has the empty value as its fourth line. The words list is the brief's ten words. "Example claim" names the 6 plus 5 examples, so the 11 in step 6 add up.
- Example values kept from the design, although the real ones will differ:
  - The Agent reason cells end with "(rule 4)"; the real cell ends with " · Context-dependent rule 4 · k/n runs agreed".
  - The confidences are 0.85 and 0.80.
  - The lesson title is the design's example.
  - Calibration may change any of these.
- A scratchpad lint (not in the repo) passes the page:
  - 7 step headings, each with the four sub-headings in order.
  - 13 tables, each with at most 4 columns and cells of at most 100 characters.
  - Every affected table is captioned in its step, and Agent settings appears in step 6 only.
  - Outside claim text there are no banned phrases, engineering words, time words, codes, paths or personal names.
  - The six-line list is there, and so are the help pieces: a header and 4 lines in the Why wrong table, 10 words and 2 lines on what to do if something stops.
  - The placeholders sit on their own lines.

## For the lint and the builder

- The W4 lint says no Tag decisions row has Why wrong or an Agent proposal at creation. Under the approved structure, that holds only for the two open rows.
- The Why wrong check must accept four value lines: a header plus Agent slip, Rule unclear, Rule should change and the empty value.
- The code rule must exempt claim text by matching the manifest's `short` values, because "G20" appears unquoted in the Melania claim.
- Bug: `escapeInline` in `scripts/lib/notion-markdown.mjs` returns the literal text "${c}" for every special character. In `` `\${c}` `` the backslash escapes the dollar sign instead of adding a backslash, so `escapeInline('[x]')` gives "${c}x${c}". Nothing in the scripts or tests calls it yet. The fix is `` `\\${c}` ``. The walkthrough builder should also turn backticks into inline code instead of escaping them, and it must fill in the placeholders before converting, because braces get escaped.
- "goes up by one" in step 6 follows the brief. It is exact when step 6 runs on the day the page was set up. On a later day, `nextEdition` starts at .1 with the new date.
