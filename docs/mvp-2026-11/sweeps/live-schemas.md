# Live schemas read through the connector on 2026-10-15 (read-only)

## Taxonomy "Claim Tags — verified"

Database `f05273e214eb8353b0a981544507de32`, data source `b65273e2-14eb-8362-86a6-870ea8d632f4`, under the page "Agents flow center". Protected: read only, never written.

| Column | Type | Options or target | Description on the column |
|---|---|---|---|
| Name | title | | |
| Category | select | Nature (blue), Form (purple), Quality (green), Style (yellow), Tone (orange), Format (pink), Meaning (default), Usage (gray), Check (red) | |
| Counterpart | text | | The mutually exclusive tag this one pairs against. |
| Description | text | | One to two sentences characterizing the claim that carries this tag. Descriptive, not instructional. |
| Evidence | url | | Calibration report the verification rests on. |
| Example Claims | text | | |
| Geo Status | select | Existing in Geo (green), To be created (yellow), Implemented differently (orange) | |
| Geo Tag ID | text | | |
| Polarity | select | Classification (blue), Positive (green), Issue (red) | |
| Status | select | Verified (green), Proposed (yellow) | |
| Verified on | date | | |
| When to use | text | | Decision rules and boundary cases for an AI tagger: when the tag applies and when it does not. |
| Work tags | multi_select | Pipeline benchmark check (gray), Issue (orange) | |
| U.S. Politics debate claims | relation | data source d1307596-e531-420f-8688-2485f3ef28ab (the synced side of the claims table's "Claim quality tags — verified") | |
| World affairs debate claims | relation | data source 67a1940f-db0d-477a-9737-0a9eb01a5eac | |
| Created, Created by, Last edited, Last edited by | created_time, created_by, last_edited_time, last_edited_by | | |

## Real claims table "U.S. Politics debate claims"

Database `7219756338b2416f8fa8af83d75ec47d`, data source `d1307596-e531-420f-8688-2485f3ef28ab`, inline on the page "U.S. Politics — debate claims" (`3f2273e214eb814681dff6ad6dcf21a0`, under Geo QA agent command center / Current docs for QA work). 2,351 claims tagged Debate, mirrored from Geo on 7 October 2026. Protected: one read-only pull, never written.

| Column | Type | Options or target |
|---|---|---|
| Geo Name | title | the claim text |
| Geo ID | text | the Geo entity id (the key) |
| Geo URL | url | |
| Geo Sources | text | |
| Geo Tags | multi_select | Debate, Democracy & Media, Economy, Featured, Immigration, Main claim, Politics, debate claim (all default colour) |
| Geo Topics | text | |
| Geo Score | number | |
| Geo Supporting arguments | text | |
| Geo Opposing arguments | text | |
| Geo Related people | text | |
| Geo Related projects | text | |
| Geo Is factual | checkbox | |
| Geo Name source | select | This space (green), Other space (fallback) (orange) |
| Proposed Tags | multi_select | the same eight options as Geo Tags |
| Proposed Topics | text | |
| Proposed rename | text | |
| Review notes | text | |
| Review status | select | To review (yellow), Reviewed (green) |
| Challenged tags notes | text | |
| Claim quality tags — verified | relation | the taxonomy, dual with its "U.S. Politics debate claims" |
| Editors challenging the QA tags | relation | data source 3f3273e2-14eb-801f-9da3-000b25bdb94e (an editors table) |

Views on the real table: "QA review", "Tag audit — all claims", "Tag audit — flagged for <an editor's name>", "Tag audit — Unsourced pending" (names recorded for orientation only; the copy gets the MVP's own views).

The page "U.S. Politics — debate claims" also says: "Tag audit — 9 Oct: full population pass, 2,351 claim titles reviewed, 260 proposed tag decisions on 256 claims are in the page Exhaustive tag audit — 9 Oct (`3f4273e214eb81ae9272c6f1e48bbd6c`)"; "all 942 claims without a live Geo Source carry Unsourced".
