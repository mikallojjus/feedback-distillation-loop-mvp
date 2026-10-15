# Dry run of the real claims table

Read only: nothing was written to Notion. Read on 2026-10-15 (run dry-1).

## Size

- Rows: 2351
- Columns: 21

## Columns

| Column | Type | Options |
|---|---|---|
| Geo Sources | rich_text |  |
| Geo ID | rich_text |  |
| Review status | select | To review, Reviewed |
| Geo URL | url |  |
| Claim quality tags — verified | relation |  |
| Geo Tags | multi_select | Debate, Democracy & Media, Economy, Featured, Immigration, Main claim, Politics, debate claim |
| Challenged tags notes | rich_text |  |
| Geo Name source | select | This space, Other space (fallback) |
| Geo Topics | rich_text |  |
| Geo Score | number |  |
| Geo Supporting arguments | rich_text |  |
| Geo Related people | rich_text |  |
| Proposed Tags | multi_select | Debate, Democracy & Media, Economy, Featured, Immigration, Main claim, Politics, debate claim |
| Geo Opposing arguments | rich_text |  |
| Proposed rename | rich_text |  |
| Geo Related projects | rich_text |  |
| Geo Is factual | checkbox |  |
| Proposed Topics | rich_text |  |
| Editors challenging the QA tags | relation |  |
| Review notes | rich_text |  |
| Geo Name | title |  |

## Geo ID

- Type: rich_text
- Empty on 0 row(s)
- Unique on every row that has one: yes
- Rows with an empty Geo Name: 0

## Geo Sources

- Type: rich_text
- Rows with something in it: 1408 of 2351; rows with at least one link: 1408
- Links per row: 0: 943, 1: 550, 2: 262, 3 or more: 596
- Links found: 3851 (as real links on the text: 3851; written as [title](address): 0; an address typed as text: 0)
- Where the links point: www.geobrowser.io (3851)

Three sample rows:

1. The FTC is justified in using consumer protection laws to investigate AI safety risks (fc917f73c02e45f0a3a755a4f2c486cd)
   - FTC opens probe into safety of AI, including Anthropic and … https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/3cd8e094753b4bd2b1c236f1adfc3c98 (rich_text)
   - F.T.C. Investigates OpenAI and Anthropic Over Potential Con… https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/e4d9704ad1384ea78a3052a07c691437 (rich_text)
   - US trade regulator opens investigation into AI giants inclu… https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/1a1061e9d5d24cc7aa86a0086a9719e2 (rich_text)
   - FTC intensifies OpenAI, Anthropic probe following 'rogue AI… https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/da9e2df9dcdf47a6beca7b89d3c7d7cd (rich_text)
   - OpenAI, Anthropic Face FTC Scrutiny on AI Safety After Secu… https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/823f41993a8d4dce926969e58f2a2fbb (rich_text)
2. Jessica Tarlov makes Fox News more credible (fe9ea6d6e0c8936e038d0bd54fbb7099)
   - Trump criticizes Fox News for giving too much airtime to De… https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/dde2f10960734f3da903bed223952859 (rich_text)
3. The White House's mass disenrollment of suspected fraudulent ACA accounts is justified (fd8af6b4971d4b9889724415db4d894d)
   - Opinion | JD Vance is not ripping away anyone’s health insu… https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/4c36ef70678343108d0524eddeb0b362 (rich_text)
   - Trump administration uncovers $1.2B in suspected COVID cont… https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/45650a7e68dd4277939cfd17533983ea (rich_text)

## Geo Is factual

- Type: checkbox
- Ticked: 14; not ticked: 2337; empty or other: 0

## Geo Tags

- Rows with each value: Debate: 2351, Featured: 23, debate claim: 3, Democracy & Media: 1, Economy: 1, Immigration: 1, Main claim: 1, Politics: 1
- Rows with none: 0

## Review status

- Rows with each value: (empty): 2351

## Requests

- Sent in total: 34 (GET: 10, POST: 24, PATCH: 0)
- Writes: 0
