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
