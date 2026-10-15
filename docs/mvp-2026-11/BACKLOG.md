# Backlog (source of the artifact's Backlog tab)

One row per deferred item: what, why not now, the trigger that brings it in, effort S, M or L.

| What | Why not now | Trigger | Effort |
|---|---|---|---|
| Tag the real claims table instead of the 50-claim copy | The real table is never written in the MVP (decision D27); the Geo-to-Notion refresh may drop added columns and page ids | The owner of the refresh job confirms that added columns and page ids survive a refresh; then a config change plus the one confirmed setup write | M |
| The other 12 tags, rules drafted one tag at a time | Only Context-dependent is judged in the MVP (decision D35); nine tags have no rules yet | The Context-dependent loop has passed one safety check on the copy and the editor picks the next tag | S per tag |
| The source pass (Improperly sourced, Factually challenged) and the Geo source resolver | Needs fetched source text and the verified Geo query, none of which the Context-dependent loop uses | A source tag is chosen for drafting | M |
| Source inaccessible decided in code from the fetch result | Same dependency on the source fetch | Same as the source pass | S |
| Duplicate search (Exact duplicate, Semantically duplicated) | No corpus search exists; duplicates are never queued (decision D17) | An editor asks for duplicate detection; a within-table text-hash check comes first | M |
| World affairs claims table | One config entry later (decision D9) | The U.S. Politics copy or table runs without incident through one full cycle | S |
| The strict safety check with statistics (`--strict`) | The simple check is the default (decisions D14, D20) | The simple check lets a change through that the editor later rolls back | M |
| Scheduled runs | The editor types every command (decision D11) | The editor asks for runs that happen without typing | S |
| Per-editor queues | One editor who is also the rule owner (decision D4) | A second editor joins | M |
| Swap the Rulebook copy for the real taxonomy | The copy stands in until the team fills its missing data (decision D2) | The team signs off the copy's text; then one confirmed write | S |
| Calibrate the re-read band and the safety check's noise guard on the first 200 real claims | Needs the real table (decision D19) | The first real run | S |
| Python-compatible hashes | Marked Later in the analysis | A Python consumer of the run files appears | S |
| The old hub and sandbox under "Editorial feedback loop" | Read-only history; never touched, never deleted (hard rule 8) | Never | - |
| Rotation of unseen rows in a distill group above 30 rows | The first groups are small; the newest 30 rows are taken | A tag's decided rows pass 30 and a lesson keeps missing older rows | S |
| The calibration run that compares the adaptive judge with a three-run reference (`--reference`) | Needs the real table's first 200 claims (decision D19) | The first real run on the real table | S |
| A warning when the Claude CLI version changes between judge runs | Recorded per call, not acted on | The example claims change answers after a CLI update | S |
| Clearing the Follow-up marks of a rolled-back rule change | Rollback restores the text and marks the lesson; the Fixed marks stay as history | An editor asks what Fixed means after a rollback | S |
| The domestic-chips example claim of Self-contained under the current rules | Under edition 2026-10-15.1 the judge reads it Applies at 0.3 to 0.8 across runs; a production safety check would fail on it whatever the lesson | The first production promote; then either rule 3 or 4 gains a line on general trends the sentence spells out, or the taxonomy owners replace the example | S |
| A note from distill when the editor's rule differs from the rule the agent cited | Calibration showed a lesson on rule 4 never flipping a row the agent decided under rule 3; the lesson should sit where the agent looks | An editor's lesson fails its first safety check on a row the agent decided under another rule | S |
| A per-claim retry when a reply leaves out one claim of a batch | Today the whole batch is asked again (two attempts), then written as errors; a two-claim batch lost the same claim four times in a row on 2026-10-15, then read fine | The rejected replies kept since decision 36 show the same claim missing more than once | S |
| A triggering test of the practice-page skill in real sessions | The skill-creator's description optimiser counted no trigger on any of the ten positive queries in two runs (with and without the installed skill set aside), while all ten negatives passed, so its detector, not the description, is the open question in this setup; the six graded eval runs show the skill engaging when offered | The product owner tries the ten positive phrasings of the trigger test (kept with the skill's evals) in ordinary sessions and notes which do not bring the skill up | S |
