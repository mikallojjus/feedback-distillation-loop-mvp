# Geo claims pick (done)

- Seed: `claims-2026-10-27`
- Endpoint: https://api-testnet.geobrowser.io/graphql
- Read at: 2026-10-27T13:54:17.194Z
- Result: 200 claims written to `X:/work/geo-agents/agents/claim-tagger-mvp/setup/geo-claims-pick.json`
- Geo requests: 23 sent, 0 that were not queries (must be 0)

## Populations

Claims tagged Debate, per space, after the checks (Claim type, a name, a creation time, one entry per claim, the first canonical space for a claim in several).

| Space | Links read | Claims | Not a Claim | No name | No creation time | Repeat links | Also in an earlier space |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U.S. Politics | 2132 | 2131 | 1 | 0 | 0 | 0 | 0 |
| World affairs | 1857 | 1835 | 2 | 0 | 0 | 0 | 20 |
| AI | 855 | 853 | 1 | 0 | 0 | 0 | 1 |
| Health | 406 | 404 | 0 | 0 | 0 | 0 | 2 |
| Crypto | 180 | 180 | 0 | 0 | 0 | 0 | 0 |
| Technology | 74 | 66 | 0 | 0 | 0 | 0 | 8 |

### Claims per month

| Month | U.S. Politics | World affairs | AI | Health | Crypto | Technology | All |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-03 | 0 | 1 | 1 | 0 | 0 | 0 | 2 |
| 2026-04 | 0 | 2 | 0 | 0 | 2 | 0 | 4 |
| 2026-05 | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| 2026-06 | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| 2026-07 | 2 | 2 | 18 | 0 | 6 | 0 | 28 |
| 2026-08 | 126 | 91 | 95 | 31 | 45 | 0 | 388 |
| 2026-09 | 760 | 436 | 305 | 137 | 83 | 0 | 1721 |
| 2026-10 | 1243 | 1303 | 432 | 236 | 44 | 66 | 3324 |

**2026-10 holds 61% of all claims (3324 of 5469): likely the migration month (createdAt is flattened on migrated entities).** The even split over months still draws from every month.

## Allocation

| Space | Quota | Claims | Moved out | Moved in | Picked | Picked per month |
| --- | --- | --- | --- | --- | --- | --- |
| U.S. Politics | 50 | 2131 | 0 | 0 | 50 | 2026-07: 2, 2026-08: 16, 2026-09: 16, 2026-10: 16 |
| World affairs | 50 | 1835 | 0 | 0 | 50 | 2026-03: 1, 2026-04: 2, 2026-07: 2, 2026-08: 15, 2026-09: 15, 2026-10: 15 |
| AI | 40 | 853 | 0 | 0 | 40 | 2026-03: 1, 2026-05: 1, 2026-06: 1, 2026-07: 10, 2026-08: 9, 2026-09: 9, 2026-10: 9 |
| Health | 30 | 404 | 0 | 0 | 30 | 2026-08: 10, 2026-09: 10, 2026-10: 10 |
| Crypto | 20 | 180 | 0 | 0 | 20 | 2026-04: 2, 2026-07: 5, 2026-08: 5, 2026-09: 4, 2026-10: 4 |
| Technology | 10 | 66 | 0 | 0 | 10 | 2026-10: 10 |

### Moves

No space was short of its quota.

## Duplicates

### In more than one space (31)

- `00e49c82ba4e4443a471180095d4a4a0` "Christians should openly try to convert their friends": kept in U.S. Politics, also tagged in World affairs
- `1878ff3c148d4291adec0ed6a4f72eb5` "Jesus is the only path to God": kept in U.S. Politics, also tagged in World affairs
- `20630e999fac43efa99ad7160d91b676` "Developers should bear legal responsibility when their autonomous AI agents access external systems without authorisation": kept in U.S. Politics, also tagged in World affairs
- `2a5fdc205949419aa7fa667f2be8a30b` "Demons are real and can influence people's lives": kept in U.S. Politics, also tagged in World affairs
- `3705b6226d77476cada50c1ad1861b8b` "Russia and Ukraine should accept a mutual moratorium on attacks against energy infrastructure": kept in World affairs, also tagged in AI
- `389bf10852b84d16a67765dc79adb88b` "Atheism ultimately provides no objective meaning to life": kept in U.S. Politics, also tagged in World affairs
- `3aa59beae5b9419da454ea8554998e02` "The European Union should create an associate-membership status for Canada": kept in U.S. Politics, also tagged in World affairs
- `44e813295df24ed2a065c8077afc27c9` "Mocking Christianity is more socially acceptable than mocking other religions": kept in U.S. Politics, also tagged in World affairs
- `4ee725c130ce4b88a0fcff1bb4f61e5f` "Hell is compatible with a loving God": kept in U.S. Politics, also tagged in World affairs
- `53bb3b2fb8c14bcda0a83bab3de9045b` "Modern culture is becoming hostile to Christianity": kept in U.S. Politics, also tagged in World affairs
- `5594594aca153411a18ec982d5fbd649` "Future generations' inability to consent is not enough, by itself, to rule out heritable interventions": kept in Health, also tagged in Technology
- `708285108b9bc55b1800e8658f2834cb` "Public funding should prioritize access to established fertility treatment over enhancement": kept in Health, also tagged in Technology
- `74dde29c78374109a355eae294069a6b` "You cannot have objective morality without God": kept in U.S. Politics, also tagged in World affairs
- `79253ff311304f4aa78fa2b67e0cc64b` "Astrology is spiritually dangerous, not harmless entertainment": kept in U.S. Politics, also tagged in World affairs
- `7a8fd889c3140f6fad846858b567e38c` "Patients should have as much say as technical experts in how reproductive technologies are governed": kept in Health, also tagged in Technology
- `83bddc216ccaa181ea3b5ed4b1496d62` "Unequal access is a stronger objection to genetic enhancement than its being unnatural": kept in Health, also tagged in Technology
- `86cfa0a8424942b8ac6d73b38d1fbb3c` "Christians should treat astrology, psychics and witchcraft as spiritually dangerous": kept in U.S. Politics, also tagged in World affairs
- `935b4f14b51a4c10ac15e14470bf7306` "Evolution is compatible with Christianity": kept in U.S. Politics, also tagged in World affairs
- `979592579780ddd5378e1114f604f2e4` "Parents should not be allowed to select embryos for predicted intelligence": kept in Health, also tagged in Technology
- `9b0745df5a6f4276a4866ba6aa0f58b5` "Not all religions are equally true": kept in U.S. Politics, also tagged in World affairs
- `a42de20e2d063160e0019a55db4c0aaf` "Patients should always know when AI contributed to a medical decision": kept in AI, also tagged in Health
- `a6d838f8d9e9420faa5be5aa66c508e6` "Christians have a duty to try to convert non-Christians": kept in U.S. Politics, also tagged in World affairs
- `b2a8cf72b02f4baaab817fb7a5cc7b67` "The Bible should take precedence over modern social values": kept in U.S. Politics, also tagged in World affairs
- `b711b2cf6a714815abf9359ef73770a0` "Christianity is fundamentally incompatible with Islam": kept in U.S. Politics, also tagged in World affairs
- `bdeae87f20f84877ae3ea13d3662322c` "Being a good person is not enough to get into heaven": kept in U.S. Politics, also tagged in World affairs
- `c50c061608775126e5ffb8876843e492` "Preventing a serious inherited disease can justify changing an embryo's genes if safety can be established": kept in Health, also tagged in Technology
- `d1e5714279ba4988a5cc46b343a707fe` "The United States should end military aid to Israel": kept in U.S. Politics, also tagged in Health
- `d620c33306594c0ba3010e99abaf0117` "Evolution does not undermine the biblical account of creation": kept in U.S. Politics, also tagged in World affairs
- `da64e2ac4fdfc12f0050d3533e7bfc11` "A reproductive technology can be safe and still be wrong to offer": kept in Health, also tagged in Technology
- `ea69239040195ec1d3dd53349d60efca` "Parents do not have a duty to give their child every genetic advantage available": kept in Health, also tagged in Technology
- `eabe39fd147f46a2a123723515b39ecd` "Christianity is more rational than atheism": kept in U.S. Politics, also tagged in World affairs

### Same text (0)

None.

## Audit claims

File: `agents/claim-tagger-mvp/setup/audit-decisions.json` (sha256 `0eb3e49b21a7da323b2fee1d88a8b59f6329d2026e7a88cb67c71f8085ead305`)

- Included (3): `3e0d601de961dbf8ae38154e3f3a02e5`, `c8b676c3cce79edaec871afd1633ac2f`, `1bff859247ecdb618af41a397d2eb6ba`
- Left out (7):
  - `6dc1222aeb364918821167370d8fbc40`: not tagged Debate in a canonical space
  - `fc0cb0da0a1a4375b0fae6b5c9a67c69`: not tagged Debate in a canonical space
  - `e3c28f62526e4880b9edb5c16817b27b`: not tagged Debate in a canonical space
  - `89fcfb7fc6684b63af7d829ed90106cd`: not tagged Debate in a canonical space
  - `9a0e240456694696afdfbe7b7ac7021d`: not tagged Debate in a canonical space
  - `8f9c833b41e54eee9ca78e9c2f4ffb58`: not tagged Debate in a canonical space
  - `78dd775028795b65bb5c4945eda1c3bb`: not tagged Debate in a canonical space

## Details

- Name taken from the space's own Name value: 190; from entity.name instead: 10
- Sources: 136 in all, 27 without a Web URL (their Geo link is used)
- Claims whose month in the details is the month of the Debate listing: 200 of 200

## Warnings

None.

## Requests

Geo was asked 23 times (0 retries, 14 pages of Debate links, 9 detail batches, page size halved 0 times). The log is requests.jsonl next to this file.

