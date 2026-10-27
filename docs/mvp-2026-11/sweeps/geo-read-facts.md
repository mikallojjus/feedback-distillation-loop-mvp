# geo-read facts (retrieval sweep, read-only)

Source repo: `X:\work\content-management` (read only). Date of sweep: 2026-10-27.
Live reads used: 3 of 3 (Q4 claim detail; Q5 Debate filter page 1; Q6 Debate filter page 2 via `after`). Nothing written to Geo or Notion. `.env` not read.
Tags: [live] = seen in my queries; [doc] = documentation text only; [code] = read from source.

## 1. Client: lib/gql.mjs

File: `X:\work\content-management\lib\gql.mjs`

- Endpoint: `https://api-testnet.geobrowser.io/graphql` (line 7). [code]
- Request: POST, one header `Content-Type: application/json` (lines 24-28). Body is `{query, variables}`; the `variables` key is omitted when undefined. No auth header.
- Timeout: none. Plain `fetch`, no AbortSignal.
- Retries: `query(gqlString, variables, { retries = 2 })` (line 18). Up to 3 attempts. Sleeps 500 ms before attempt 2 and 1000 ms before attempt 3 (line 21). After the last failed attempt it throws the last error (line 57).
  - Retried: fetch throws (lines 29-32); HTTP 5xx or 429 (lines 33-36); GraphQL error whose text matches `/Unexpected error|Internal/i`, only while attempts remain (lines 44-49).
  - Thrown at once, no retry: other GraphQL errors (lines 50-52); non-JSON body (lines 37-43); other non-2xx (line 54).
- GraphQL errors: if `errors` is present, `data` is ignored. Throws `gql: GraphQL error(s): <messages joined " | ">` plus the first 600 chars of the query (lines 44-52).
- Success: returns `json.data` (line 55).
- `paginate(gqlString, variables = {}, path = "entitiesConnection")` (lines 114-124):
  - First call sends `after: null` (line 118). Follows `pageInfo.endCursor` (line 122). Stops when `hasNextPage` is false (line 121).
  - Caveats: the query must declare `$after: Cursor` and pass `after: $after`. `first` is not set by paginate, so put it in the query text or variables. The default path is `entitiesConnection`, so pass `"relationsConnection"` for that connection. A wrong path returns `[]` silently (line 120). No runaway guard.
- CLI `lib/gql-cli.mjs`: prints `data` only, as pretty JSON (line 24). On error prints the message to stderr and exits 1 (lines 25-27). Shebang says bun; it ran under node in this sweep. [live]

Templates, verbatim (gql.mjs lines 66-77 and 85-91):

```js
  ENTITY_BY_ID: `query EntityById($id: UUID!) {
    entity(id: $id) {
      id name description spaceIds
      types { id name }
      values(first: 100) {
        nodes { property { id name } text date datetime boolean decimal integer float }
      }
      relations(first: 100) {
        nodes { id entityId position type { id name } toEntity { id name } }
      }
    }
  }`,
```

```js
  ENTITIES_BY_TYPE_CONNECTION: `query EntitiesByTypeConn($typeId: UUID!, $spaceId: UUID, $first: Int = 500, $after: Cursor) {
    entitiesConnection(typeId: $typeId, spaceId: $spaceId, first: $first, after: $after) {
      totalCount
      nodes { id name description }
      pageInfo { hasNextPage endCursor }
    }
  }`,
```

Gaps and conflicts:
- ENTITY_BY_ID nests `values(first: 100)` and `relations(first: 100)` with no paging. Longer lists are cut silently.
- ENTITIES_BY_TYPE_CONNECTION requests `totalCount`. See section 2 for the conflict.
- `src/functions.ts` gql() (cited at queries-and-signals.md:38) retries up to 50 times. That is not lib/gql.mjs.
- The mirror's own gql() (`mirror-claims-topics.mjs` lines 56-68) retries only on fetch or JSON-parse failures, not on HTTP status. Different policy.
- geo-query SKILL.md:227 mentions a "30 s client timeout". lib/gql.mjs has none.

## 2. geo-query SKILL shapes

File: `X:\work\content-management\skills\non-actionable\geo-query\SKILL.md`. There is no `references/` folder under geo-query (only SKILL.md and evals/evals.json).

- `entity(id:)` [doc, SKILL 77-117]. Never returns null. A nonexistent id, or a relation-edge id, returns a stub with `spaceIds: []` and `typeIds: []` (SKILL 122). Existence test: `spaceIds` or `types` non-empty.
- Values [live, SKILL 120]: typed fields `text date datetime time boolean decimal integer float point language unit`. No generic `value`. Each node also has `spaceId`. `language` is a UUID string. Unset fields are null.
- Relations [live, SKILL 102-115]: node fields `id` (edge, the delete handle), `entityId` (relation-as-entity, the property handle), `spaceId`, `typeId`, `position`, `type { id name }`, `toEntity { id name }`. Q4 returned all of these except `position`.
- Scope a claim's nested reads to one space [doc, SKILL 167-171]: `values(filter: { spaceId: { is: "SPACE_ID" } })` and `relations(filter: { spaceId: { is: "SPACE_ID" } })`. If no space is named, default to Root `a19c345ab9866679b001d7d2138d88a1` (SKILL 173).
- Flat list [doc, SKILL 58-62, 180-185]: `entities(typeId:, spaceId:, first:, offset:) { id name description }` returns a plain array, no `nodes`. `first` and `offset` are capped at 1000 (SKILL 56).
- Connection [doc, SKILL 187-202]: `entitiesConnection(...) { totalCount nodes {...} pageInfo { hasNextPage endCursor } }`.
  - Conflict on totalCount: SKILL 56 says `first: 0` plus totalCount works. queries-and-signals.md:31 says totalCount errors with "Unexpected error" for first 0 and first 1. Count by paging instead.
- `relationsConnection` [live partial, SKILL 260-263; queries-and-signals.md:60, 70]: filter keys `spaceId`, `typeId`, `toEntityId`, `id: { in: [...] }`. Nodes can carry `fromEntityId toEntityId spaceId fromEntity {...} toEntity {...}`. `typeId`, `toEntityId` and `spaceId` inside `filter` were all accepted live (Q5, Q6). `fromEntityId` as a filter key is not documented anywhere I read, and I did not test it.
- Filter syntax [doc, SKILL 331-332, 345-349, 568]: UUID filters use `is`, `isNot`, `in`. No `equalTo` anywhere. Prefer `none` over `every` for exclusion. Scope relation filters by `spaceId`.
- Nested relations [doc, SKILL 131, 406-408]: `relations(filter: { typeId: { is: "REL_TYPE" } }, orderBy: POSITION_ASC, first: N)`.
- Page size [doc, SKILL 56, 217-230, 576]: `first` is at most 1000. Past 1000, only cursor `after` works. When nesting relations per node, keep the root page at 100 or less and filter the nested relations by typeId. An unfiltered root page of 1000 with nested relations has OOM-killed the API (SKILL 227).
- Error advice [doc, SKILL 352; mirror lines 167-183; queries-and-signals.md:34]:
  - SKILL: "If complex filters return 500s, reduce first from 500 to 100 to 50."
  - mirror spaceSweep: starts at 100, halves to 25 on any error, retrying the same cursor.
  - queries-and-signals.md:34: shape ladder arg@1000, arg@500, filter@500, filter@250. Filter form at first 1000 fails deterministically on Crypto.
  - lib/gql.mjs does not halve. It retries the same request.
- Aliased batch [code]: the SKILL gives no batch size. `mirror-claims-topics.mjs` lines 120-126 batch 25 aliases per request (`e0: entity(id: "...") {...} e1: ...`), with IDs string-interpolated, not variables. queries-and-signals.md:35 uses `entities(filter: { id: { in: $ids } }, first: 100)` in chunks of 40. Line 39 uses relationsConnection id-in lists in chunks of 200. Use 25 for aliased `entity()`.

Backlinks pattern [doc, SKILL 245-246]:

```graphql
{ relations(filter: { toEntityId: { is: "TOPIC_ID" }, spaceId: { is: "SPACE_ID" } }, first: 500) {
    id typeId fromEntity { id name types { id name } } } }
```

## 3. How the claim fields are read

Sources: `X:\work\content-management\skills\actionable\geo-claim-grouping\references\queries-and-signals.md` and `X:\work\content-management\skills\actionable\geo-mirror\scripts\mirror-claims-topics.mjs`.

- Name in a given space [code, mirror 157-160]:

```js
function nameOf(e) {
  const own = e.values.nodes.find((v) => v.spaceId === spaceId && v.property?.name === 'Name')?.text;
  return own && own.trim() ? { name: own, nameSource: NAME_SOURCE.own } : { name: e.name, nameSource: NAME_SOURCE.fallback };
}
```

  - Values are fetched as `values(first: 50) { nodes { spaceId property { name dataTypeName } text datetime float integer boolean } }` (mirror 125).
  - Name property id `a126ca530c8e48d5b88882c734c38935` (constants.ts:184). Live Q4 shows the same id as "Name". The mirror matches by name, not id.
  - Conflict: queries-and-signals.md S1 (line 51) reads plain `entity name`, the denormalised value. Mirror comment lines 152-155 says that name can come from another space. Prefer the space-scoped Name, fall back to entity.name, and record which one was used.
  - Live: the only Name value for claim 5e190462 is in its own space c5804fde, not Technology.

- Is factual [code, mirror 135-144, 210]: `isFactual: v['Is factual']?.value ?? null`. Read through `scalars()`, keyed by property NAME. First value wins, with the in-space value sorted first (line 137). Value is `text ?? datetime ?? float ?? integer ?? boolean` (line 140), so a checkbox sits in `boolean`. No property id found in the docs. Absent gives null (Q4: claim 5e190462 has no Is factual value).

- Sources [code + doc]:
  - Relation type id `49c5d5e1679a4dbdbfd33f618f227c94` (queries-and-signals.md:24). Relation type name is "Sources" (mirror line 118).
  - Target is usually an Article, `a2a5ed0cacef46b1835de457956ce915`, in about 99% of edges (audit/Summary.md:91). Name is the target's `toEntity.name` (mirror line 148).
  - Web URL is property `412ff593e9154012a43d4c27ec5c68b6`, on the TARGET entity, scoped by spaceId. It is not on the relation (audit/audit/notion-tooling-reuse.md:66). The same audit's live check found relation entities are empty stubs (line 69). So the statement that a Source relation entity carries Web URL (ontology-advisor ONTOLOGY.md:319) does not match the data.
  - Pattern from the audit (notion-tooling-reuse.md:82). Not re-run by me. Its example space is World affairs; for this task use Technology `870e3b3068661e6280fad2ab456829bc`.

```graphql
{ e0: entity(id:"<claim>") { id relations(first:50, filter:{typeId:{is:"49c5d5e1679a4dbdbfd33f618f227c94"}, spaceId:{is:"<SPACE>"}}) { nodes { toEntity { id name types{name} valuesList(filter:{propertyId:{is:"412ff593e9154012a43d4c27ec5c68b6"}, spaceId:{is:"<SPACE>"}}){ text } } } } } }
```

  - Edge cases from the same audit: no Web URL on 6 of 1,500 edges (line 73); some targets have several Web URL values, cross-space (line 73). Handle zero sources, no URL, and multi-URL.
  - Conflict: queries-and-signals.md:92 says citation entities are per-claim and named after headlines, not shared. Read the Web URL per target and do not assume a shared target.
  - The mirror writes Sources only as linked names (lines 118, 241, 417). It does not read Web URL.

- Topics [code]: relation type name "Topics" (mirror line 209). Two Topics property ids coexist: `806d52bc27e94c9193c057978b093351` and `3b7759e55a714a8084d489258fd4bdd5` (queries-and-signals.md:26). Name matching covers both. Topic names are read the same way as claim names (mirror lines 219-227, 157-160). Sparse: about 4% of World Affairs claims (queries-and-signals.md:89).

- Tags [code + live]: relation type name "Tags" (mirror line 206, `r.Tags`, then `toEntity.name`). Tags relation type id `257090341ba5406f94e4d4af90042fba` (constants.ts:117; Q4 typeId and type.name "Tags"). Debate tag entity id `55c95b2626f8482cb9739ea99dfde438` (Q4: name "Debate"). The mirror filters by tag NAME, `toEntity: { name: { in: ['Debate', 'Featured'] } }` (mirror lines 30, 191). The `in` on name was not verified live. Using the Debate id directly was verified (section 5).

- createdAt [live + code]: a Unix-seconds numeric string, not ISO (queries-and-signals.md:36). Q4 entity: `"1792661724"`. Q5 fromEntity: `"1792050522"`. Mirror converts with `Number()` (line 105). ISO strings only appear as filter input (SKILL 308). Migration caveat: pre-2026-08 entities carry the migration date (SKILL 314).

## 4. Claim detail: 5e190462477020ef995f45c10c998d16 [live, Q4, one run, no errors]

Query:

```graphql
query($id: UUID!) { entity(id: $id) { id name createdAt typeIds spaceIds values(first: 100) { nodes { spaceId property { id name dataTypeName } text date datetime time boolean decimal integer float point language unit } } relations(first: 100) { nodes { id entityId spaceId typeId type { id name } toEntity { id name } } } } }
```

Variables: `{"id":"5e190462477020ef995f45c10c998d16"}`

Trimmed result (null fields grouped on one line, nothing dropped):

```json
{
  "entity": {
    "id": "5e190462477020ef995f45c10c998d16",
    "name": "Following your passion is bad career advice",
    "createdAt": "1792661724",
    "typeIds": ["96f859efa1ca4b229372c86ad58b694b"],
    "spaceIds": ["c5804fdeb4102fec4f459e97e2b8af0e"],
    "values": { "nodes": [
      {
        "spaceId": "c5804fdeb4102fec4f459e97e2b8af0e",
        "property": { "id": "a126ca530c8e48d5b88882c734c38935", "name": "Name", "dataTypeName": "Text" },
        "text": "Following your passion is bad career advice",
        "date": null, "datetime": null, "time": null, "boolean": null, "decimal": null,
        "integer": null, "float": null, "point": null,
        "language": "090adac0-fca4-822e-8e71-9263e67620ec", "unit": null
      }
    ] },
    "relations": { "nodes": [
      {
        "id": "00060568b6df9308f532937beb09a790",
        "entityId": "2a417646e18a48459ce825d6a1b537a5",
        "spaceId": "c5804fdeb4102fec4f459e97e2b8af0e",
        "typeId": "257090341ba5406f94e4d4af90042fba",
        "type": { "id": "257090341ba5406f94e4d4af90042fba", "name": "Tags" },
        "toEntity": { "id": "55c95b2626f8482cb9739ea99dfde438", "name": "Debate" }
      },
      {
        "id": "be63e4728f3f4d9c8784b9b10b5d3000",
        "entityId": "e6ee47263e024cc8bad67dcf74c61d91",
        "spaceId": "c5804fdeb4102fec4f459e97e2b8af0e",
        "typeId": "8f151ba4de204e3c9cb499ddf96f48f1",
        "type": { "id": "8f151ba4de204e3c9cb499ddf96f48f1", "name": "Types" },
        "toEntity": { "id": "96f859efa1ca4b229372c86ad58b694b", "name": "Claim" }
      }
    ] }
  }
}
```

Reading: this claim lives only in space `c5804fde...`, which is not a canonical space. Only Name is set. It has no Is factual, Sources, Topics or Score. Its Debate Tags edge is in `c5804fde...`, so it falls outside the Technology-scoped filter in section 5.

## 5. Debate filter in Technology space [live, Q5 page 1 and Q6 page 2]

Q5 (the filter as given, wrapped in braces):

```graphql
{ relationsConnection(filter: {typeId: {is: "257090341ba5406f94e4d4af90042fba"}, toEntityId: {is: "55c95b2626f8482cb9739ea99dfde438"}, spaceId: {is: "870e3b3068661e6280fad2ab456829bc"}}, first: 50) { nodes { spaceId fromEntityId toEntityId fromEntity { id name typeIds createdAt } } pageInfo { hasNextPage endCursor } } }
```

Page 1 result:
- 50 nodes. Every `toEntityId` is the Debate id `55c95b26...`. Every `spaceId` is Technology `870e3b30...`.
- 50 distinct `fromEntityId`s. All 50 `fromEntity.typeIds` include Claim `96f859efa1ca4b229372c86ad58b694b`.
- `hasNextPage: true`. The expected false did not hold.
- `endCursor`: `WyJwcmltYXJ5X2tleV9hc2MiLFsiYjFlZDU5MWEtYTQzYy0zZGE4LTFkOWMtZDRhZWJmZmI0ZTkwIl1d` (opaque; pass it back, do not parse).
- Sample first node: `fromEntityId` `65b537a5f8e20a5d037eae718f4e02be`, `fromEntity.name` "Social media platforms should disclose how their recommendation algorithms work", `createdAt` "1792050522".

Q6 (page 2, `first: 1000`, cursor passed as a variable):

```graphql
query($after: Cursor) { relationsConnection(filter: {typeId: {is: "257090341ba5406f94e4d4af90042fba"}, toEntityId: {is: "55c95b2626f8482cb9739ea99dfde438"}, spaceId: {is: "870e3b3068661e6280fad2ab456829bc"}}, first: 1000, after: $after) { nodes { spaceId fromEntityId toEntityId } pageInfo { hasNextPage endCursor } } }
```

Variables: `{"after":"<Q5 endCursor>"}`. Page 2 result: 24 nodes, all Debate and all Technology, `hasNextPage: false`.

Total: 74 Debate Tags edges in Technology (50 + 24). Cursor paging with `after` works with this filter. Not checked: whether page 2's `fromEntityId`s are distinct from page 1's. Page 1 had one edge per claim.

Coder note: `paginate(QUERY, {}, "relationsConnection")`, with `$after: Cursor` declared in QUERY, should reproduce this.

## 6. Canonical spaces (13)

Source: `X:\work\content-management\src\constants.ts`, `CANONICAL_SPACE_IDS` (lines 23-37; the 13 entries are on lines 24-36). Names are from the trailing comments. The same 13 appear in geo-query SKILL.md lines 512-531.

| # | Name | Space id |
|---|---|---|
| 1 | Crypto | c9f267dcb0d270718c2a3c45a64afd32 |
| 2 | AI | 41e851610e13a19441c4d980f2f2ce6b |
| 3 | Health | 52c7ae149838b6d47ce0f3b2a5974546 |
| 4 | Pharma | 19f11bc6f1a62ac434936af814d1f8b5 |
| 5 | Technology | 870e3b3068661e6280fad2ab456829bc |
| 6 | World affairs | 89bd89bf28ff8a0963faf92a8c905e20 |
| 7 | U.S. Politics | 4582fbbee28a16589154f7e36f1ee3c5 |
| 8 | Industries | d69608290513c2a91102c939b3265bd7 |
| 9 | Education | ec349623f33236aee13c12dcd629ee81 |
| 10 | Software | 9b611b848b12491b9b6b43f3cf019b8b |
| 11 | Places | 84a679ce188f061ac9a92380bac2bab5 |
| 12 | Documentation | 784bfddae3f3976118c561bf28195b44 |
| 13 | Podcasts | b5a31f8182b042437ede0f84ee02f104 |

- Conflict: the `SPACES` list (constants.ts lines 140-155) labels `784bfddae3f3976118c561bf28195b44` as "Geo Education" (line 144). `CANONICAL_SPACE_IDS` (line 35) and SKILL (line 525) label it Documentation. Treat it as Documentation. Education is `ec349623...`.
- Naming: constants.ts says "U.S. Politics"; SKILL line 520 says "US Politics". Same id.
- Dataset spaces (constants.ts lines 43-49) are separate and not canonical.
- constants.ts is TypeScript (`new Set<string>`). Copy the ids into the plain Node module; do not import the file.
