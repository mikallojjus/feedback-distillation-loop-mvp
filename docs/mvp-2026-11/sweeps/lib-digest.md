# Digest: claim-tagger `scripts/lib` and the test fakes

Scope: the 14 modules in `agents/claim-tagger/scripts/lib/`, the fakes and fixtures in `tests/fixtures/` (`notion/`, `loop/`, `fake-claude.mjs`), and the first 120 lines of `tests/notion-rest.test.mjs`, `tests/claude.test.mjs` and `tests/judge.test.mjs`. Facts were also checked against `agents/claim-tagger/config.json`, `scripts/allowlist.mjs`, and greps over `agents/claim-tagger/scripts` and `tests` for call sites. `.env` was not opened and no token value appears here. Paths are relative to the repo root `X:\work\geo-agents`. Line numbers refer to the files as read on 2026-10-15.

## 0. Direct answers

- **Notion surface.** `notion-rest.mjs` has no `createDatabase`, no views call and no page-parent create. `createPage` always sends `parent: { database_id }` (line 244). Grep over `scripts/` and `tests/` finds no `/views` path and no database creation. The internal `request(method, path, body)` is generic but not exported, so a new endpoint has to be added inside `createClient`.
- **API version.** `DEFAULT_API_VERSION = '2022-06-28'` (`notion-rest.mjs:25`), sent as `'Notion-Version': apiVersion` (line 111). `clientFromConfig` reads `config.notion.api_version`, which is `"2022-06-28"` in `agents/claim-tagger/config.json` (line 4). `probe.mjs` reads the same key.
- **Request log.** None in production. `notion-rest.mjs` writes no file and prints nothing. It calls an optional `log({ method, path, status, attempt })` once per HTTP attempt (`status` is null on a network failure). No script passes `log`: `apply.mjs:342` and `pull.mjs:448` call `clientFromConfig` without it. The only request record is the in-memory fake's `requests` and `writes()` in tests. A production "reads only" proof would need a `log` callback that appends to a file.
- **Token.** `loadToken(repoRoot)` (line 261) reads `<repoRoot>/.env` through `process.loadEnvFile`, takes `NOTION_TOKEN`, and returns null for an empty value or the placeholder `ntn_replace_me`. Details in 1.12.

## 1. lib modules

Order follows dependency: exit-codes, paths, pyjson, hash, rng, stats, validate, jsonl, rubric-build, notion-contract, notion-values, notion-rest, claude, gate-evidence.

### 1.1 `exit-codes.mjs`

```js
export const EXIT = Object.freeze({ OK: 0, ERROR: 1, INVALID: 2, PAUSED: 3, DRIFT: 4, TRUST: 5, HOLD: 10, FAIL: 11, USAGE_WINDOW: 75 });
export function describeExit(code)   // -> one plain sentence per code; unknown codes: "Exit code N is not one of the agent's codes (0, 1, 2, 3, 4, 5, 10, 11, 75)."
```
- Constants only. No side effects, no errors.

### 1.2 `paths.mjs`

```js
export const ROOT_ENV = 'CLAIM_TAGGER_ROOT';
export function codeRoot()                        // agents/claim-tagger, from this file's location
export function agentRoot()                       // resolve(process.env.CLAIM_TAGGER_ROOT) when set, else codeRoot()
export function repoRoot()                        // codeRoot()/../.. (where .env lives); never follows the sandbox
export function codeFile(root, ...parts)          // join(root, ...parts) if it exists, else join(codeRoot(), ...parts)
export function runsDir()                         // agentRoot()/runs
export function safeName(s)                       // every char outside [A-Za-z0-9._-] becomes '-'; dots-only or empty -> '-'
export function runId(kind, date = new Date())    // 'YYYYMMDDTHHMMSSZ-<safeName(kind)>', UTC, no colons
export function ensureDir(p)                      // mkdir -p; returns p
export function isMain(metaUrl, argv1 = process.argv[1])   // compares realpathSync.native of both paths
```
- Side effects: `ensureDir` creates folders; `codeFile` checks existence. No network, no env writes.

### 1.3 `pyjson.mjs`

```js
export function pyJson(value, { sortKeys = false, ensureAscii = true } = {}) // -> string
export function compareCodePoints(a, b)                                      // -> -1 | 0 | 1 (Python str order)
```
- Byte-exact `json.dumps` with Python's default separators (`", "` and `": "`). Integers print as Python ints (`3`, never `3.0`); other numbers use Python float repr.
- Throws TypeError for undefined, functions, symbols, Map, Set, Date, class instances and cycles (`pyJson: ... is not JSON serializable at $[...]`). `JSON.stringify` would drop or reshape these silently, which would make a hash irreproducible.
- No side effects.

### 1.4 `hash.mjs`

```js
export function sha256Hex(data)              // string (UTF-8) or Buffer -> 64 hex chars
export function fileSha256(path)             // readFileSync; ENOENT propagates
export function h16(data)                    // 'sha256:' + first 16 hex digits
export function ruleHash(tag, n, text)       // h16(`${tag}|${n}|${text}`)
export function tagHash(tag)                 // h16(pyJson(subset, { sortKeys: true, ensureAscii: false }))
export function rubricHash(rubricOrTags)     // h16 of the tag hashes, tags sorted by name (code points)
export function scopeHash(scopeOrRubric)     // h16 of the sorted judged tag names
export function promptVersion(buffer)       // h16(buffer)
export function configId(obj)               // h16(pyJson(obj, { sortKeys: true })), ASCII (Python default)
```
- `tagHash` subset: `name`, `counterpart` (null if absent), `polarity`, `description`, `when_to_use: { preamble, rules: [{ n, text, rule_hash }], note }`, `example_claims`. Each `rule_hash` is recomputed from the text, never read from the stored field.
- Tag, rubric and scope hashes use raw UTF-8 (`ensure_ascii` false) to match `research/scripts/build-skeleton-data.py`. `configId` is ASCII and is not comparable with those.
- No side effects beyond reading the file in `fileSha256`.

### 1.5 `rng.mjs`

```js
export function seedFromString(s)          // first 4 bytes of SHA-256(UTF-8 s), big-endian uint32
export function mulberry32(seed)           // -> () => float in [0, 1)
export function shuffle(array, rng)        // Fisher-Yates on a copy; input unchanged
export function sample(array, n, rng)      // first n of the shuffle; RangeError 'sample: n must be a non-negative integer'
```
- Pure. No side effects.

### 1.6 `stats.mjs` (imports `seedFromString`, `mulberry32` from rng.mjs)

```js
export function wilson(k, n, z = 1.96)     // -> { p, lo, hi }; n = 0 gives { p: 0, lo: 0, hi: 1 }
export function pairedBootstrapDelta(baseCorrect, candCorrect,
  { B = 1000, seed = 'paired-bootstrap', ci = [0.025, 0.975] } = {})   // -> { n, delta, lo, hi }
export function exactMcNemar(b, c)        // -> p, two-sided exact binomial; 1 when b + c = 0
export function selfFlipRate(runsByItem)  // -> share in [0, 1]; plain object or Map of decision arrays; 0 when empty
```
- `wilson` throws RangeError unless k and n are integers with 0 <= k <= n.
- `pairedBootstrapDelta` takes arrays of 0/1 of equal length (RangeError on a length mismatch or any other value). `seed` may be a number (used directly as the mulberry32 seed) or a string (hashed). Percentile bounds are taken without interpolation. n = 0 gives all zeros.
- `exactMcNemar` throws RangeError for negative or non-integer counts. Direct sum for n <= 1000, log space above.
- No side effects.

### 1.7 `validate.mjs`

```js
export function assertSchema(schema, root = schema, at = '#')   // throws Error('schema error at <path>: ...')
export function validate(schema, value, path = '$')              // -> { ok, errors: string[] }
```
- Errors read like `$.tags[0].p: expected number`. At most 100, then `... and N more errors`. Each schema is checked once (WeakSet cache).
- Supported keywords: `type` (name or list: string, number, integer, boolean, object, array, null), `properties`, `required`, `additionalProperties` (boolean or schema), `enum`, `const`, `items` (single schema), `minItems`, `maxItems`, `minimum`, `maximum`, `minLength`, `maxLength` (code points), `pattern` (with the `u` flag, falling back to none), `anyOf`, `oneOf` (exactly one), `allOf`, `$ref` (local only: `#`, `#/...`, with `~0` and `~1` escapes).
- Annotations are ignored: `$schema $id $comment title description default examples format deprecated readOnly writeOnly`. `definitions` and `$defs` are walked. Any other keyword throws, so a typo cannot switch a check off.
- No side effects.

### 1.8 `jsonl.mjs`

```js
export function sleepSync(ms)
export function readJsonl(path)                                        // -> { rows, torn }
export function appendJsonl(path, obj)                                 // -> void
export function readJson(path)                                         // -> any
export function renameWithRetry(from, to, { retries = 5, delayMs = 50, rename = renameSync } = {})
export function writeTextAtomic(path, text)                            // -> void
export function writeJsonAtomic(path, obj, { pretty = true } = {})    // -> void
```
- `readJsonl`: a missing file gives `{ rows: [], torn: false }`. A bad line that is not the last throws `Error('<path>: line N is not valid JSON (...)')`. A bad last line (no newline after it) sets `torn: true` and is skipped. BOM stripped.
- `appendJsonl`: first cuts a torn tail off the file (ftruncate) and adds a missing newline, so a resumed run never glues rows together. Creates parent folders. TypeError if the row is not serialisable.
- `readJson`: BOM stripped; `Error('<path>: invalid JSON (...)')`. A missing file throws the ENOENT error.
- `renameWithRetry`: retries EPERM, EBUSY and EACCES (Windows locks) up to 5 times, 50 ms apart.
- `writeTextAtomic`: temp file `<name>.<pid>.<8 hex>.tmp` in the same folder, fsync, rename; the temp file is deleted on error.
- `writeJsonAtomic`: `JSON.stringify(obj, null, 2)` plus a newline when pretty, otherwise compact plus a newline.
- Side effects: file reads and writes, folder creation, temp files. One writer per ledger file is assumed.

### 1.9 `rubric-build.mjs`

```js
export function splitRules(text)                   // -> { preamble, rules: [{ n, text }], note }
export function composeWhenToUse({ preamble = '', rules = [], note = '' } = {})   // -> string (inverse of splitRules)
export function normaliseText(s)                   // CRLF to LF, <br> to newline, drop \ before * _ [ ] #, trim lines, collapse 3+ newlines
export function scrubNames(text, replacements)     // replacements: [from, to][]; whole words, case-sensitive, longest first
export function nextVersion(current, today = new Date())   // 'YYYY-MM-DD.n': n+1 if current is today or later, else today.1
export function rehash(rubric)                     // mutates and returns: rule_hash, tag_hash, scope, scope_hash, tag_count, judged_count, rubric_hash
export function checkHashes(rubric)                // -> { ok, mismatches: [{ kind, where, stored, computed }] }
export function buildRubric(rows, { version = nextVersion(), source = {}, changelog, counterpartPairs, by = 'rubric-build', change = 'Built from Rulebook rows.' } = {})
export function rubricToRows(rubric)               // -> rows (When to use composed, examples one per line)
export function diffRubric(a, b)                   // -> [{ tag, part, a, b }]
export function applyLesson(rubric, lesson, { version } = {})   // -> new rubric (deep copy)
```
- `splitRules`: numbered lines are rules, lines before the first are the preamble, lines after it the note; a leading `Note:` label is removed. Uses Python's strip set so the cuts match the research script.
- `checkHashes` kinds: `rule_hash`, `tag_hash`, `rubric_hash`, `scope_hash`, `scope`, `tag_count`, `judged_count`.
- `buildRubric` keeps rows whose status is absent, null or `'Verified'`. `judged` defaults to `!human_only && !deterministic`. Errors: `buildRubric: a row has no name`; `buildRubric: "<name>" is marked judged but also human only|deterministic`; `buildRubric: two rows are named "<name>"`.
- `diffRubric` parts: `description`, `polarity`, `counterpart`, `preamble`, `rule N`, `note`, `examples`, `judged`, `human_only`, `deterministic`, `needs_source_reading`, `missing` (only in a), `added` (only in b).
- `applyLesson`: the lesson is `{ tag, kind, ruleN, newText }` (one rule) or `{ tag, newWhenToUse }` (whole When to use), plus optional `lesson_id` or `lessonId` and `note`. Sets the new text, rehashes, sets `rubric_version` (default `nextVersion`), and appends `{ version, previous_version, date, tag, kind, ruleN, lesson_id?, note }` to `changelog`. Errors: `applyLesson: the rubric has no tag "<tag>"`, `applyLesson: "<tag>" has no rule N`, `applyLesson: the new rule text is empty`, `applyLesson: a candidate needs a new version, got "<v>" again`.
- No side effects.

### 1.10 `notion-contract.mjs`

```js
export const REQUIRED_OPTIONS   // { [db]: { [select property]: string[] } }, deep-frozen
export const OPTIONAL_OPTIONS   // { runs: { Kind: ['Rollback'] } }; documentation only, checkOptions ignores it
export function optionNames(def)                   // def.select.options[].name -> string[] | null
export function checkOptions(db, properties)      // -> { missing: [{ property, option }], unreadable: [property] }
```
- `REQUIRED_OPTIONS` keys: `rulebook` (Status, Category, Polarity), `claims` (Table, Sample, Readiness), `tag_decisions` (Agent proposal, Why in queue, Priority, Tag outcome, Why wrong, Seeded outcome, Agent follow-up), `rule_changes` (Kind, Status), `runs` (Kind including `Baseline`, Verdict). The full lists are at lines 30-74. `agent_settings` has no entry.
- `checkOptions` checks REQUIRED only. A property that is absent or not a select is skipped. A select with no readable option list goes to `unreadable`.
- No side effects.

### 1.11 `notion-values.mjs`

```js
export const WRITABLE_TYPES        // title, rich_text, select, status, multi_select, number, checkbox, url, email, phone_number, date, relation, people
export function normId(id)          // lower-case, dashes removed
export function looksLikeId(s)      // 8-4-4-4-12 hex, dashes optional
export function decodePage(page, schema = null)          // -> { page_id, url, created_time, last_edited_time, props, relation_has_more? }
export function encodeProperties(plainProps, schema)     // -> REST `properties` object
export function sameValue(type, a, b)                    // -> boolean
export function sameDate(a, b)                           // -> boolean
// re-exports: normaliseText (rubric-build.mjs), splitRichText (notion-rest.mjs)
```
- `decodePage` plain values: title and rich_text joined text; select and status name or null; multi_select names; number; checkbox boolean; url, email, phone a string; date start string (`Name:end` added when there is an end); people and relation ids; formula value; rollup array (items decoded by their own type), number or date start; created and last-edited times; created_by and last_edited_by ids; unique_id as `PREFIX-n`; files names. Unknown types (button, verification) are dropped. Throws Error when the object is not a page, a property has no type, or its type differs from the schema.
- `encodeProperties` needs `schema.properties`. Unknown name: `Error('encodeProperties: unknown property "<name>"')`. Non-writable type (formula, rollup, created_time, unique_id, ...): TypeError `encodeProperties: "<name>" (<type>) is not a writable property type`. Select and url: `''` becomes null. Date `''` becomes `{ date: null }`. `Name:end` is consumed together with its date. Title and rich_text go through `splitRichText`.
- `sameValue`: text compared after `normaliseText`; select, status, url, email and phone treat empty as null; numbers within 1e-9; checkbox by truthiness; date by `sameDate`; relation, people, multi_select and rollup as sets of normalised ids.
- `sameDate`: two day strings compare as days; instants compare at minute precision (Notion drops seconds).
- No side effects, no network.

### 1.12 `notion-rest.mjs`

```js
export const API_BASE = 'https://api.notion.com/v1';
export const DEFAULT_API_VERSION = '2022-06-28';
export const MAX_RATE_LIMIT_RETRIES = 5;
export const MAX_SERVER_RETRIES = 3;
export const BACKOFF_MS = [500, 1000, 2000];
export const MAX_CHILDREN = 100;
export class NotionError extends Error {}   // constructor(message, { status = null, code = null, retryable = false }); name 'NotionError'
export function splitRichText(text, max = 2000)   // -> [{ type: 'text', text: { content } }]
export function createClient({ token, apiVersion = DEFAULT_API_VERSION, requestsPerSecond = 3,
  fetchImpl = globalThis.fetch, log = null, sleep = <setTimeout-based>, now = Date.now } = {})   // -> client
export function clientFromConfig(config, { fetchImpl, repoRoot, token, log, sleep, now } = {})  // -> client | null
export function loadToken(repoRoot = repoRoot())  // -> string | null
```

Client methods:

```js
queryDatabase(databaseId, { filter, sorts, pageSize = 100 } = {})   // async generator of page objects; POST /databases/{id}/query
queryAll(databaseId, opts = {})                                      // -> page[]
retrieveDatabase(databaseId)                                         // GET /databases/{id}
retrievePage(pageId)                                                 // GET /pages/{id}
retrievePropertyItem(pageId, propertyId)                             // -> items[]; GET /pages/{id}/properties/{prop}; a non-list reply comes back as [res]
createPage({ parentDatabaseId, properties, children = [] })          // -> page; POST /pages with parent.database_id
updatePage(pageId, { properties })                                   // PATCH /pages/{id}
appendBlocks(blockId, children)                                      // -> blocks[]; PATCH /blocks/{id}/children, 100 per request
```

Behaviour:
- **Headers** on every request: `Authorization: Bearer <token>`, `'Notion-Version': apiVersion`, `'Content-Type': 'application/json'`. The body is JSON when given.
- **Pacing:** a token bucket with capacity 1, refilled at `requestsPerSecond` (default 3; `config.notion.requests_per_second` is 3), so requests are at least 1/rate apart (about 333 ms). Retries wait for a token too. Waiters are served in call order.
- **429:** sleeps the `Retry-After` value in seconds (1000 ms when absent or not a number), up to 5 times. Then `NotionError` with code `rate_limited`, retryable.
- **409, 5xx and network failure:** sleeps 500, 1000, 2000 ms (`BACKOFF_MS`), up to 3 retries in total, one counter for both kinds. Then `NotionError` with code `network_error` (no answer) or Notion's own code, retryable.
- **Other 4xx:** `NotionError` at once, retryable false. Message: `Notion <METHOD> <path> -> <status> <code>: <message>`.
- **`POST /pages` is never sent twice.** A 5xx, a 409, a network failure, or a 2xx whose body is unreadable or has no `id` gives `NotionError` with code `create_uncertain` (retryable). The message says "The row may exist in Notion already, so the create was not sent again". A 429 is still retried, because Notion did not process it.
- **Token scrubbing:** error messages and the `log` never contain the token (`split(token).join('[token]')`).
- **Pagination:** `queryDatabase` and `retrievePropertyItem` follow `next_cursor` while `has_more`. `has_more` without a cursor, or a repeated cursor, throws an Error with `.code = 'BROKEN_CURSOR'`. Property items are read with `page_size=100`.
- **Chunking:** `splitRichText` gives at most `max` (default 2000) UTF-16 units per text object, never splitting a surrogate pair. RangeError for `max` below 2 or not an integer. `null` and `undefined` give `''`; `''` gives `[]`. Title and rich_text values go through it. Blocks: 100 per create or append (`MAX_CHILDREN`); `createPage` sends the first 100 children with the page and appends the rest.
- **Factory errors:** TypeError `createClient: a token is required`; TypeError `createClient: fetchImpl must be a function`; RangeError `createClient: requestsPerSecond must be positive, got <x>`.
- **Test hooks:** `fetchImpl` (mock), `sleep(ms)`, `now()` returning a number of ms (not a Date), `log(event)`.
- **Side effects:** HTTPS to `api.notion.com` through `fetchImpl`; `loadToken` reads `<repoRoot>/.env`. No file writes.

Token loading (`loadToken`):
- Returns null when `<repoRoot>/.env` is missing. Otherwise `delete process.env.NOTION_TOKEN`, then `process.loadEnvFile(file)`, so a token already set in the environment is never used.
- An empty value, or the placeholder `PLACEHOLDER_TOKEN = 'ntn_replace_me'` (the value in `.env.example`), gives null.
- A file that starts with a byte-order mark is parsed again with `util.parseEnv`, because the BOM hides the first key from the loader.
- `finally` removes every key the load added and restores `NOTION_TOKEN`, so no other `.env` key reaches child processes.
- Any exception returns null silently, so a Node without `process.loadEnvFile` looks like "no token".
- `clientFromConfig`: a `token` option overrides `.env` (tests use this). Returns null without a token. `apiVersion` comes from `config.notion.api_version` (default `DEFAULT_API_VERSION`), `requestsPerSecond` from `config.notion.requests_per_second` (default 3).

### 1.13 `claude.mjs`

```js
export const USAGE_WINDOW_RE = /usage limit|rate limit|429|quota|resets|overloaded/i;   // used on error paths
// not exported: LIMIT_NOTICE_RE = /usage limit|rate limit|limit reached|limit will reset|resets? (?:at|in|on)\b/i
export const FAKE_CLAUDE_SCRIPT                  // <repo>/tests/fixtures/fake-claude.mjs
export function findClaudeBin(configured = 'claude', { platform = process.platform, whereImpl } = {})   // -> string
export function resolveSpawnTarget(bin, { platform, readFileImpl, existsImpl } = {})                     // -> { command, prefixArgs }
export function scrubEnv(env = process.env)      // copy without CLAUDECODE and CLAUDE_CODE_ENTRYPOINT
export function buildArgs({ model, systemPromptFile, effort, maxTurns = 1, extraArgs = [] } = {})   // -> string[]
export class JsonExtractError extends Error {}   // name 'JsonExtractError'
export function extractJson(text)                // -> any; throws JsonExtractError
export function tryExtractJson(text)             // -> { ok: true, value } | { ok: false, error }
export function parseEnvelope(stdout)            // -> { element, error? }
export function sameModel(a, b)                  // -> boolean
export async function runClaude(options = {})    // -> result; never throws
export function claudeVersion(bin = 'claude', { spawnSyncImpl, env, cache } = {})   // -> string ('unknown' on failure)
export function usageResetHint(text)             // -> 'resets ...' fragment or null
```

Finding and starting the program:
- `findClaudeBin`: off Windows the name is returned as given (spawn searches PATH). On Windows a path, or a name with a separator, is returned as given; otherwise the `where <name>` results are ranked `.exe` (0), `.cmd` (1), `.bat` (2), other (9). When `where` finds nothing, the name is returned.
- `resolveSpawnTarget`: `.mjs`, `.js` and `.cjs` run as `{ command: process.execPath, prefixArgs: [resolve(bin)] }`. On Windows a `.cmd` or `.bat` shim is followed to the `"%~dp0\...\.exe|.js|.mjs|.cjs"` target it names. Without such a target it throws Error: `<bin> is a batch file and Node cannot start those without a shell; install the native claude.exe or set judge.claude_bin in config.json to the full path of claude.exe`. Anything else: `{ command: bin, prefixArgs: [] }`.
- `claudeVersion`: first non-empty line of `--version`, at most 80 characters, cached per bin in a module-level Map (`cache` option). Timeout 30 s. Never throws.

Command line (`buildArgs`), exact order:

```
-p
--model <model>                 (only when given)
--output-format json
--tools ''                      (empty argument: no tools)
--system-prompt-file <file>     (only when given)
--max-turns <maxTurns>          (default 1)
--effort <effort>               (only when given)
--permission-mode dontAsk
--safe-mode
--strict-mcp-config
--no-session-persistence
...extraArgs                    (appended as given, not checked)
```

The user message is not an argument. It goes to stdin as UTF-8 and stdin is closed. No shell is used (`shell: false`), `windowsHide: true`, and the child environment is `scrubEnv(env)`.

`runClaude(options)`:
- Options: `bin = 'claude'`, `driver = 'cli'` (or `'fake'`), `model`, `systemPromptFile`, `prompt = ''` (stdin), `effort`, `maxTurns = 1`, `timeoutMs = 300000`, `extraArgs = []`, `env = process.env` (scrubbed), `spawnImpl = child_process.spawn` (tests), `fakeState` (the fake's call log, shared across calls).
- Result: `{ ok, text, isError, errorKind, message, costUsd, modelUsage, numTurns, durationMs, exitCode, stdout (at most 20000 characters), stderr (at most 4000), raw }`. `text` is the envelope's `result`. `costUsd` is `total_cost_usd`, or the sum of `modelUsage[].costUSD`. `raw` is the parsed result element.
- `errorKind` (null when ok): `spawn`, `timeout`, `usage_window`, `transient`, `schema`, `model_mismatch`.
- Driver `fake`: imports `bin` when it ends in `fake-claude.mjs` (otherwise `FAKE_CLAUDE_SCRIPT`) and calls `runFake({ args, stdin: prompt, env: scrubbed env, state: fakeState })` in process.
- Driver `cli`: `spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false })`. On timeout: `taskkill /pid <pid> /T /F` on Windows, then `child.kill('SIGKILL')`. The promise resolves after at most 5 s (KILL_GRACE_MS) even if the child ignores the kill.

How an answer is classified (`interpret`, in order):
1. Spawn error: `spawn`, message `cannot start claude: <code> <message>`.
2. Timeout: `timeout`, message `claude did not answer within <ms> ms and was stopped`.
3. Exit code not 0, or `is_error` true, or `subtype` starting with `error`: `usage_window` if `USAGE_WINDOW_RE` matches the result text, stderr (and stdout when there is no envelope); otherwise `transient`.
4. No envelope: `usage_window` if the plain output is under 2000 characters and `LIMIT_NOTICE_RE` matches; otherwise `schema`.
5. Empty result text: `schema`.
6. On exit 0, a result under 400 characters with no `[` or `{` that matches `LIMIT_NOTICE_RE`: `usage_window` (the limit notice printed as an ordinary result).
7. `model` set and no key of `modelUsage` matches it (`sameModel`: case-insensitive, a trailing `[...]` such as `[1m]` and a trailing `-YYYYMMDD` are ignored): `model_mismatch`.
8. Otherwise `ok: true`.

`parseEnvelope` accepts a JSON array (the last element with `type: "result"`), a single object (`type: "result"`, or one with `result` or `is_error`), several JSON lines (the last result line), or a fenced or embedded JSON value. Its errors: `the CLI printed nothing`, `the CLI output is not JSON`, `the CLI output has no element of type "result"`, `the CLI output is JSON but not a result envelope`.

`extractJson(text)`: the first code fence that holds `[` or `{` is used, otherwise a stray fence is stripped. Then the longest balanced `[...]` or `{...}` that parses wins (strings and escapes respected, at most 200 candidates). JsonExtractError messages: `the reply is empty`, `the reply holds no JSON array or object`, `the reply holds brackets but no valid JSON (<parse error>)`, `the reply is cut off: the bracket at position N is never closed`.

Callers (not in lib):
- `judge.mjs:734` calls `S.deps.runClaude ?? runClaude` with `bin, driver, model, systemPromptFile, effort, maxTurns, timeoutMs, env, prompt, spawnImpl, fakeState` (judge.mjs:842-845). `bin = findClaudeBin(config.judge.claude_bin)` (judge.mjs:666), or `FAKE_CLAUDE_SCRIPT` with `--driver fake`. `cliVersion = claudeVersion(bin, { env })` (judge.mjs:667). Config judge block: `effort "medium"`, `max_turns 1`, `timeout_ms 300000`, `claude_bin "claude"`.
- judge.mjs:494-495 map errorKinds to exit codes: `spawn` to 1, `usage_window` to 75, `model_mismatch` to 4. judge.mjs:852 retries once on `timeout`, `transient` or `schema`.
- `distill.mjs:307` and `:317-325` do the same mapping (`usage_window` to 75 with `usageResetHint`, `model_mismatch` to 4, `spawn` to 1). Its call uses `effort: config.distill?.effort`, `maxTurns: 1`, `timeoutMs: config.distill?.timeout_ms ?? config.judge?.timeout_ms ?? 300000`.
- Models from `config.models`: judge `claude-sonnet-5-5`, cheap `claude-haiku-5-5`, distill `claude-opus-5-5`.
- `usageResetHint(text)` gives a fragment such as `resets 3am` for the line where the resume command is printed (judge.mjs:933, distill.mjs:323).

The production command line this produces for a judge call (from the code, Windows): `claude -p --model claude-sonnet-5-5 --output-format json --tools '' --system-prompt-file <rendered prompt> --max-turns 1 --effort medium --permission-mode dontAsk --safe-mode --strict-mcp-config --no-session-persistence`, with the message on stdin. The flags are as the code passes them; they were not checked against the installed CLI.

Side effects: spawns the CLI (or node for `.mjs` bins); reads `.cmd` shims; on Windows runs `where`, and `--version` once per bin. No file writes and no direct network.

### 1.14 `gate-evidence.mjs`

```js
export const RULE_PROPS                            // ['When to use', 'Rule version', 'Tag hash', 'Changed by'] (frozen)
export function ruleVersionOf(rubric, tagName)     // version of the last changelog entry naming the tag, else the first entry, else rubric_version
export function gateClaims(plan)                   // -> { ctx, ops, promote, restore, seed, rulebook, live, needPromote, needed }
export function evidenceNeeded(plan)               // -> boolean
export function checkGateEvidence({ root = agentRoot(), plan, pull = null } = {})   // -> { ok, problems: string[], evidence: { modes, ... } }
```
- `plan` is readPlan()'s result `{ header, ops, dir, sha }`. `pull` is a loadPull() object (uses `dir`, `id`, `covers()`, `idMap`).
- Modes: `promote` (header `ctx.promote`, or a lesson set to Live, or a rulebook op writing a rule column without restore or seed), `restore` (`ctx.restore` with `ctx.confirm`), `seed` (`ctx.seed` plus the marker `runs/SETUP`).
- Promote evidence reads: `runs/PROMOTING.json` (must name this run; `plan_sha` must match the plan file when recorded); `runs/<run>/card.json` (matches `schemas/card.schema.json`, `verdict` PASS, not `smoke`, `kind` "gate", lesson matches); `runs/<run>/candidate/rubric.json` (hashes intact, the card's candidate, version equal to PROMOTING's); live `rubric/rubric.json` (the card's baseline); the pull's `norm/lessons.jsonl` (lesson Approved, or Live when this run's `applied.jsonl` records that op as ok). Each rulebook op's When to use, Tag hash, Rule version and Changed by must match the candidate and reference the lesson's page id.
- Restore evidence also reads `rubric/rubric.lock` (rubric_version, rubric_hash and file_sha256 agree with rubric.json).
- Never throws: any failure becomes an entry in `problems` (for example `the evidence could not be examined (...)`).
- Reads only: no writes, no network. The card schema is resolved through `codeFile`. Control paths come from `controlPaths(root)` in `scripts/allowlist.mjs` (not read here); `runs/PROMOTING.json` is a literal path.
- Example problem text: `runs/PROMOTING.json does not exist: no promote of run <id> is in flight, so no gate PASS backs this plan`.

## 2. Fakes and fixtures

### 2.1 `tests/fixtures/notion/fake-notion.mjs`

Construct and exports:

```js
import { createFakeNotion, realConfig, fixtureSchemas, loadFixture, pageValue, REPO, AGENT } from './fixtures/notion/fake-notion.mjs';
const fake = createFakeNotion({ config = realConfig(), schemas = fixtureSchemas(), now = () => new Date('2026-10-13T12:00:00.000Z') } = {});
```
- `loadFixture(name)` parses a file in `tests/fixtures/notion/`. `fixtureSchemas()` returns `{ [db]: db.<db>.json }` for the six DATABASES names. `realConfig()` reads `agents/claim-tagger/config.json`. `pageValue(def, enc)` turns an encoded write into a page-shaped value (throws for types it cannot build). `REPO` and `AGENT` are paths.
- Loads: `tests/fixtures/notion/db.{rulebook,claims,tag_decisions,rule_changes,runs,agent_settings}.json` (all six present), and the database ids and key properties from `agents/claim-tagger/config.json`. The `page.*.json` files in the same folder are not read here.

Returns:

```js
{
  client,                  // same method names as createClient (see below)
  fetch,                   // fetchImpl(url, init) -> Response: the HTTP surface
  seenHeaders,             // headers object of every fetch call
  schemas, config,
  add(db, plain, { id }), // insert a row from plain values -> page id
  editorSet(pageId, plain),
  failNext(method, error, { times = 1, match = null }),
  requests,                // [{ method, ... }] for every client call, reads included
  blocks,                  // Map pageId -> children (client surface)
  writes(),                // the createPage, updatePage and appendBlocks entries of requests
  rows(db), find(db, key), get(pageId), raw(pageId), count(db),
  set onWrite(fn),         // fn({ method, db, pageId }) after each create or update
  get createdOptions,      // ['db.Prop=Option', ...] written options missing from the schema
}
```
- `add`: values are encoded with `encodeProperties`, so names and types come from the schema. Relation values are page ids. `rule_changes` rows get an auto-numbered `Lesson ID`.
- `editorSet`: an editor's change, not a script write. It sets `last_edited_by` to `a-person`.
- `find(db, key)`: `key` is the value of the database's key property in the config.
- `failNext` methods: `queryAll`, `retrieveDatabase`, `createPage`, `updatePage`, `appendBlocks`. `match(info)` selects the call; `info` is `{ db }`, `{ db, properties, children }`, `{ db, pageId, properties }` or `{ blockId }`. On the client surface the error is thrown as it is. On the HTTP surface it becomes a Response with the error's status (500 when none), so the real client's retry logic runs.

Client surface (`client`): `queryDatabase(databaseId)`, `queryAll(databaseId)`, `retrieveDatabase(databaseId)`, `retrievePage(pageId)`, `retrievePropertyItem(pageId, propertyId)`, `createPage({ parentDatabaseId, properties, children })`, `updatePage(pageId, { properties })`, `appendBlocks(blockId, children)`.

HTTP surface (`fetch`), used as `createClient({ fetchImpl })` or as `env.fetchImpl`:
- The Authorization header must start with `Bearer ` and the whole header must be at least 12 characters, otherwise 401 `unauthorized` ("API token is invalid."). A token under 5 characters fails this.
- `Notion-Version` must be present, otherwise 400 `missing_version`.
- Routes (`/v1/...` only): POST `/databases/{id}/query` (page_size and start_cursor honoured, cursors are offsets, `filter` ignored), GET `/databases/{id}`, GET `/pages/{id}/properties/{prop}` (page_size and start_cursor), GET `/pages/{id}`, POST `/pages`, PATCH `/pages/{id}`, PATCH `/blocks/{id}/children`. Anything else: 404 `invalid_request_url`.
- Errors thrown inside become `{ object: 'error', status, code, message }` bodies (`code` defaults to `internal_server_error`).

Simulates:
- Formulas and rollups are recomputed after every write. `tag_decisions`: Effective outcome, Stage, Direction, Applied tag, Rejected tag, Tag name, Lesson status. `claims`: Decided applies, Decided does not apply.
- Dual relations are kept in sync.
- Reads cut relations at 25 references with `has_more: true`. `retrievePropertyItem` returns all of them.
- 404 `object_not_found` ("Could not find database with ID ..." or "Could not find page with ID ...").
- 400 `validation_error` for an unknown property, or a write to formula, rollup, created_time or unique_id.
- Unknown select options are recorded in `createdOptions`, not rejected.
- 429 only when injected through `failNext` with status 429. No Retry-After header is sent, so the client's 1000 ms default applies.

Not simulated: filters and sorts (`queryDatabase` takes only the id), block types beyond what is stored, uploads, and rate limits.

Injection: no module swap and no env var.
- Scripts take a client from `env.client` when it is given, otherwise they build one (`pull.mjs:448`, `apply.mjs:342`: `env.client !== undefined ? env.client : clientFromConfig(config, { fetchImpl: env.fetchImpl, repoRoot })`). `helpers.makeWorld` puts `client: fake.client` into `env()`.
- HTTP level: `env.fetchImpl = fake.fetch` plus `env.repoRoot` pointing at a temp folder whose `.env` holds a test `NOTION_TOKEN` (example 3.7). The real client's pacing, retries and `create_uncertain` logic then run.

### 2.2 `tests/fixtures/notion/helpers.mjs`

Exports:
- `makeRoot({ rubric = true, config = realConfig() } = {}) -> { dir, root, repo, config }`: a temp folder (prefix `geo-agents-notion-`) with `agent/` (config.json, `runs/`, and `rubric/rubric.json` copied from `agents/claim-tagger/rubric/`) and `repo/` with no `.env`. Tracked for cleanup.
- `cleanupRoots()`: deletes every folder made by `makeRoot`.
- `captureIo() -> { io: { out, err }, out, err }`.
- `clockAt(iso) -> () => Date`.
- `loadRubric()`: the live `agents/claim-tagger/rubric/rubric.json`, not the frozen research copy.
- `USER`: a fixed editor id string.
- `rulebookProps(row, rubric)`: plain Rulebook properties for one tag (`Tag title`, `Status: 'Verified'`, `Category`, `Polarity`, `Counterpart`, `Description`, `Example claims`, `When to use`, `Human only`, `Judged`, `Rule version`, `Tag hash`). This is not seed.mjs's `rulebookProps`.
- `buildWorld(fake, { rubric = loadRubric() } = {}) -> ids`: `ids.rulebook[name]`, `ids.claims[geo]` (`g1`, `g2`, `g3`), `ids.decisions['<geo>::<tag>']` (4 keys), `ids.settings`, `ids.lesson` ("Hedged trajectories are not forecasts", Approved), `ids.run` ("Smoke R1").
- `makeWorld({ start = '2026-10-13T12:00:00.000Z', populate = true } = {}) -> w`: `{ fake, ids, clock, dir, root, repo, config, pull(id, dbs = DATABASES), env(extra) }`.
  - `clock` is `{ now(), set(iso), advance(ms) }`.
  - `pull(id, dbs)` runs `scripts/pull.mjs` `pull({ root, client, dbs, pullId, now })`.
  - `env(extra)` returns `{ root, repoRoot: repo, client: fake.client, now: clock.now, ...extra }`.
- Loads the live rubric and config from `agents/claim-tagger/`, and builds on `fake-notion.mjs`.

### 2.3 `tests/fixtures/fake-claude.mjs` (judge fake)

Exports:
- `runFake({ args = [], stdin = '', env = process.env, state = {} } = {}) -> Promise<{ stdout, stderr, exitCode }>`.
- `parseClaims(message) -> [{ id, sources, text }]`: `<claim id="..." sources="...">...</claim>` blocks, XML entities undone.
- `parseSystemPrompt(path) -> { scope, pairs, text }`: reads `# Tags you must decide for every claim` (lines `- Name`) and `# Counterpart pairs` (lines `- A vs B`). Without a file: 10 default tags and 4 default pairs.
- `fakeJudgments(claims, { scope, pairs }, { breakFirstPair = false } = {}) -> [{ id, tags: [{ name, decision, p, rule_ref, trigger, reason }] }]`: deterministic from a sha256 of the claim text and the tag name. Counterpart pairs get one `apply` and one `do_not_apply`. Tags come out sorted.

As a program: `node tests/fixtures/fake-claude.mjs -p --model <id> --system-prompt-file <path> ...` with the prompt on stdin (guarded by `isMain`). `--version` prints `0.0.0-fake (Claude Code)`.

Modes, from `FAKE_CLAUDE_MODE` (default `ok`):
- `ok`: valid reply.
- `malformed_once`: the first attempt is cut off mid-array; the retry (detected by "Your previous reply was invalid" in stdin) is valid.
- `malformed_always`: every attempt is cut off.
- `inconsistent_pair`: the first counterpart pair both apply.
- `drop_id`: the last claim is left out.
- `fenced`: valid reply in a ```json fence with prose around it.
- `usage_limit`: after `FAKE_CLAUDE_LIMIT_AFTER` successful calls (default 0) every call returns an `is_error` result "Claude usage limit reached. Your limit will reset at 3am." with exit 1.
- `wrong_model`: `modelUsage` names `claude-fallback-0-0`.
- `no_model_usage`; `object_envelope`; `bad_envelope` (non-JSON stdout, exit 0); `exit_error` (stderr "Error: connection reset by peer (fake transient failure)", exit 1); `hang` (sleeps `FAKE_CLAUDE_DELAY_MS`, default 30000, then answers).

Other variables: `FAKE_CLAUDE_STATE_FILE` (call counter across processes, program mode), `FAKE_CLAUDE_LOG` (JSONL of each call without stdin, appended to a file), `FAKE_CLAUDE_ENVELOPE=object` (single-object envelope).

Envelope: array form by default (`system`, `assistant`, `result`). `modelUsage` is keyed by the `--model` value (default `claude-fake-0-0`). `total_cost_usd` is 0.01 plus 0.002 per claim.

Injection (no module swap):
- In process: `runClaude({ driver: 'fake', bin: FAKE_CLAUDE_SCRIPT, ... })` does a dynamic `import()` of the file and calls `runFake`. When `env` is given, modes come from that object, not from `process.env`. `fakeState` is optional; without it each call gets a fresh `{}`.
- Child process: `runClaude({ bin: FAKE_CLAUDE_SCRIPT, ... })` with the default driver runs it under node through `resolveSpawnTarget`. This exercises the real pipe, exit codes and timeout.
- `judge.mjs --driver fake` uses this file (`judge.mjs:666`).
- Reads only the system prompt file passed in `--system-prompt-file`.

### 2.4 `tests/fixtures/loop/fake-claude.mjs` (distiller fake)

Exports: `RETRY_MARK` (`'The previous proposed_text repeats'`), `looksLikeDistill(stdin)` (starts with `{` and contains `"why_wrong"` and `"other_rows"`), `fakeLesson(input, { mode = 'ok', retry = false })`, and `runFake({ args, stdin, env, state })`. Anything that is not a distill message goes to the judge fake (2.3), so one binary serves both.

Mode: `state.mode ?? env.FAKE_DISTILL_MODE ?? 'ok'`:
- `ok`.
- `overlap`: `proposed_text` repeats the first supporting claim word for word, on every call.
- `overlap_once`: the same, on the first call only.
- `garbage`: the reply is not JSON.
- `bad_target`: target rule 99.
- `long`: a 2000-character `proposed_text`.
- `usage_limit`: an `is_error` usage-limit result, exit 1.

Reply: a single-object envelope (`total_cost_usd` 0.05, `modelUsage` keyed by `--model`). Lesson JSON: `{ kind, target: { rule_n, part: 'rule' }, title, statement, proposed_text, boundary_examples, counter_evidence: [], confidence: 0.7 }`. `kind` is `Change the rule` for `Rule should change`, otherwise `Clarify wording`. `proposed_text` is the target rule's text plus " (the fake distiller made this clearer)".

Input: the distill message, JSON on stdin, cut at the last `}`. Fields used: `tag` (with `when_to_use.rules`), `why_wrong`, `rows` (each with `claim`), `rule_cited` (`"<tag> rule N"`).

Records: `state.log` entries `{ call, mode, retry, input, model, args }`.

Injection: `distill.mjs` with `--driver fake` sets `bin` to `tests/fixtures/loop/fake-claude.mjs` (distill.mjs:306-312, unless `deps.bin` is given) and calls `deps.runClaude ?? runClaude`. Mode is passed as `fakeState: { calls: 0, log: [], mode }` (distill.test.mjs:385).

### 2.5 `tests/fixtures/loop/judge-stub.mjs`

Exports:
- `makeJudgeStub({ decide = () => undefined, cost = 0.01, failWith = null, failAfter = Infinity } = {})` returns `runClaudeStub(opts)`, which has `.calls` (`{ ids, version, hash, model, retry }` per call) and `.options` (`{ cost, failWith, failAfter }`, changeable between calls).
- `labelMap(rows) -> Map`: from rows with `claim`, `tag` and `expected` ('apply' or 'do_not_apply'), keyed `"<normalised claim>|<tag>"`.
- `labelOf(labels, claim, tag)`, `opposite(decision)`, `normClaim(s)` (collapses whitespace).

`runClaudeStub(opts)` is a drop-in for `runClaude`. It reads `systemPromptFile`, `prompt` and `model` from `opts`. Version and hash come from the rendered header `(version V, hash sha256:...)`. Judgments come from `fakeJudgments` (2.3). For each tag, `decide({ claim, tag, version, hash, fallback, run })` returns `'apply'` or `'do_not_apply'` to override, or undefined to keep the fake's answer. `run` counts the answers given for that item under that rubric hash (1, 2, ...). The counterpart partner is set to the opposite automatically. If a scenario decides both members the same way, it throws `scripted judge: A and B are counterparts but the scenario decided "..." for both on "..."`.

Returns the runClaude result shape: `{ ok: true, text: <judgments JSON>, isError: false, errorKind: null, costUsd, modelUsage: { [model]: {...} }, ... }`. After `failAfter` calls, with `failWith` set, it returns `{ ok: false, errorKind: failWith, message }`. The message is the usage-limit text for `usage_window`, otherwise `scripted failure`.

Injection: through `deps.runClaude`. The judge reads `S.deps.runClaude ?? runClaude` (`judge.mjs:734`); distill does the same (`distill.mjs:307`); promote and followup forward `runClaude: deps.runClaude` into the judge (`promote.mjs:290`, `followup.mjs:155`). Tests pass it in the env: `main([..., '--driver', 'fake'], io, w.env({ runClaude: stub }))`.

Fixture files: none. It reads the rendered prompt text.

### 2.6 `tests/fixtures/loop/world.mjs`

Exports:
- `RESEARCH`: the path of `tests/fixtures/research/` (frozen rubric, cases and canaries).
- `USER`, `OWNER` (fixed ids), `cleanupLoop()` (call it in `after()`).
- `liveRubric()`: the frozen rubric 2026-10-13.1 from `tests/fixtures/research/rubric/rubric.json`.
- `geoId(name) -> 32 hex` (sha256 of the name, sliced).
- `makeLoopRoot({ cases = 'empty', canaries = 'empty', config } = {}) -> { dir, root, repo, config }`. `cases` and `canaries` take `'research'` (copy the frozen file), `'empty'`, or an array of rows written as JSONL. `config(cfg)` edits the copy of config.json. Copies `prompts/`, `schemas/` and `evals/seed/` from the agent folder, and `rubric/` (rubric.json, rubric.lock, CHANGELOG.md, history/) from RESEARCH.
- `makeLoopWorld({ start = '2026-10-13T12:00:00.000Z', seed = true, cases = 'empty', canaries = 'empty', config } = {}) -> w`: `{ fake, ids, clock, dir, root, repo, config, pull(id, dbs) (async), env(extra), decide(key, { outcome, why, reasoning, at = '2026-10-13', by = USER }), lesson({ title, tag, rule, kind = 'Change the rule', current, proposed, status = 'Proposed', supporting = [], editorWording, rubricVersion, gateResult, approvedBy }) -> pageId, setLessonStatus(pageId, status, extra), addRows(specs) -> keys }`.
  - `seed = true` fills the fake from the real seed files in `agents/claim-tagger/evals/seed/` (`claims.seed.jsonl`, `decisions.seed.jsonl`, the sources fill) through seed.mjs's `mergeClaims`, `readSourcesFill`, `claimProps`, `decisionProps` and `rulebookProps`. The file's header says the result is 14 Rulebook rows, 60 claims and 50 queue rows, 27 of them decided through the seeded outcome.
- `addRows(specs)`: each spec is `{ id, claim, tag, outcome, why, reasoning, at, seeded, seededReasoning, proposal = 'Do not add tag', note, agentReason, sources = 2, geo }`. `outcome` is `Applies`, `Does not apply`, `Needs evidence`, `Ask another editor`, or absent. With `seeded: true` the outcome goes into the Seeded columns, otherwise into the editor's columns. The key is `"<geo>::<tag>"`, and `geo` defaults to `geoId(id)`.
- `makeMiniWorld({ rows = [], ...opts })`: `makeLoopWorld({ ...opts, seed: false })` plus the 14 Rulebook rows, the Agent settings row, and `addRows(rows)`, returned as `keys`.
- `makePromoteWorld({ lessonStatus = 'Approved', canaryTags = ['Predictive', 'Hypothetical', 'Context-dependent', 'Self-contained'], research = false, lessonOptions = {}, config } = {})` (async) returns `{ w, lessonPage, supporting, hedged, rubric }`. It decides two hedged Predictive rows `Does not apply` (Rule should change), two flat ones `Applies`, creates the lesson `LESSON_TITLE` (Predictive rule 1, Change the rule) with four supporting rows, pulls `p1`, and runs the real `cases-sync` `main`, so `evals/cases.jsonl` is written in the temp root.
- `LESSON_TITLE` ("Hedged trajectories are not forecasts"), `LESSON_RULE_TEXT`.
- `rowKey(w, prefix, tag = 'Predictive')`: the seeded queue key whose Geo id starts with `prefix`.
- `captureIo()`, `readJsonlFile(path)` (rows, or `[]` when the file is missing).

Loads: `tests/fixtures/research/` (the rubric folder, `cases.jsonl` with 62 rows, `canaries.jsonl` with 86 rows), the live `agents/claim-tagger/{prompts,schemas,evals/seed,config.json}`, and `fake-notion.mjs`.

## 3. Copy-paste examples from existing tests

### 3.1 Script run against the Notion fake (client surface)

From `tests/followup.test.mjs` (`applyPlan`) and `tests/apply.test.mjs` (`armed`, `run`):

```js
import assert from 'node:assert/strict';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { makeWorld, captureIo } from './fixtures/notion/helpers.mjs';
import { main as applyMain } from '../agents/claim-tagger/scripts/apply.mjs';

const w = makeWorld();                                  // fake Notion with the standard world, temp root, clock
await w.pull('p1');                                     // pull.mjs writes the pull into w.root from the fake
// build and check a plan as apply.test.mjs armed() does: openPlan(...), p.update(...), p.write(), check(...)
const cap = captureIo();
const code = await applyMain(['--run', 'run-1'], cap.io, w.env());   // env.client = fake.client
assert.equal(code, EXIT.OK, cap.err.join('\n'));
assert.equal(w.fake.find('claims', 'g1').props.Readiness, 'Ready');
```

### 3.2 Judge stub injected into promote

From `tests/followup.test.mjs` (lines 25-70):

```js
import { join } from 'node:path';
import { makePromoteWorld, LESSON_TITLE, readJsonlFile, captureIo } from './fixtures/loop/world.mjs';
import { makeJudgeStub, labelMap, labelOf } from './fixtures/loop/judge-stub.mjs';
import { main as promoteMain } from '../agents/claim-tagger/scripts/promote.mjs';

const { w } = await makePromoteWorld();                                   // lesson Approved, cases-sync run
const labels = labelMap(readJsonlFile(join(w.root, 'evals', 'cases.jsonl')));
const stub = makeJudgeStub({ decide: ({ claim, tag }) => labelOf(labels, claim, tag) });   // judge as labelled
const cap = captureIo();
const code = await promoteMain(['--lesson', LESSON_TITLE, '--driver', 'fake', '--run-id', 'pr1'], cap.io, w.env({ runClaude: stub }));
```

### 3.3 Claude fake, in process and as a child process

From `tests/claude.test.mjs` (the child-process test at lines 300-312, `fakeCall` at lines 347-349):

```js
import { runClaude, FAKE_CLAUDE_SCRIPT } from '../agents/claim-tagger/scripts/lib/claude.mjs';

const prompt = '<claims>\n<claim id="f1" sources="2">text of f1</claim>\n</claims>\nReply with the JSON array only.';

// in process: modes come from the env object
const r = await runClaude({ driver: 'fake', bin: FAKE_CLAUDE_SCRIPT, model: 'claude-sonnet-5-5', prompt, timeoutMs: 5000, env: { FAKE_CLAUDE_MODE: 'malformed_once' } });

// as a child process (the test wraps its environment in a realEnv(mode, extra) helper; sp is a system prompt file path)
const c = await runClaude({ bin: FAKE_CLAUDE_SCRIPT, model: 'claude-sonnet-5-5', systemPromptFile: sp, prompt, effort: 'medium', timeoutMs: 20000, env: { FAKE_CLAUDE_MODE: 'ok' } });
```

### 3.4 Distiller fake through distill.mjs

From `tests/distill.test.mjs` (the `distill` helper at lines 22-27; `ruleRows(prefix, tag, whyWrong, n)` builds decided rows for one tag):

```js
import { main } from '../agents/claim-tagger/scripts/distill.mjs';
import { makeMiniWorld, captureIo } from './fixtures/loop/world.mjs';

const distill = async (w, argv = [], extra = {}) => {
  const c = captureIo();
  const fakeState = extra.fakeState ?? { calls: 0, log: [] };
  const code = await main(['--driver', 'fake', ...argv], c.io, w.env({ fakeState, ...extra }));
  return { code, out: c.out, err: c.err, fakeState };
};

const w = makeMiniWorld({ rows: ruleRows('prd', 'Predictive', 'Rule should change', 3) });
const r = await distill(w, ['--run-id', 'd1'], { fakeState: { calls: 0, log: [], mode: 'overlap_once' } });
```

### 3.5 Judge through judge.mjs with the test helpers

From `tests/judge.test.mjs`. `makeAgent({ n = 19, rubric, judge, scope, promptText, rows })` builds a temp agent folder (config, prompt, schemas, the fixture rubric with its lock, and `runs/pull/p1/norm/claims.jsonl`). `judge(agent, args, { env, deps, driver = true })` appends `--driver fake` and calls `main(argv, io, { agentDir, env, ...deps, fakeState })`:

```js
const agent = makeAgent({ n: 19 });
const claimsArgs = ['--items', 'claims', '--pull', 'p1'];
const r = await judge(agent, claimsArgs);               // r = { code, out, err, fakeState }
assert.equal(r.code, EXIT.OK, r.err.join('\n'));
```

### 3.6 Notion client unit test with a mock fetch and a fake clock

From `tests/notion-rest.test.mjs` (the `json` and `rig` helpers, first 120 lines). `rig(script)` takes a list of responses or functions; the last one repeats:

```js
import { createClient } from '../agents/claim-tagger/scripts/lib/notion-rest.mjs';
// TOKEN is any test token string (the test file defines one); it never needs to be the real token

const json = (body, { status = 200, headers = {} } = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function rig(script, { rps = 1000, token = TOKEN, apiVersion } = {}) {
  let t = 0; const sleeps = []; const calls = []; const events = []; let i = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body), at: t });
    const item = script[Math.min(i++, script.length - 1)];
    const res = typeof item === 'function' ? await item(calls.at(-1)) : item;
    if (res instanceof Error) throw res;
    return res instanceof Response ? res.clone() : res;
  };
  const client = createClient({ token, apiVersion, requestsPerSecond: rps, fetchImpl, log: (e) => events.push(e),
    sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t });
  return { client, calls, sleeps, events, clock: () => t };
}

const r = rig([json({ object: 'page', id: 'p1' })]);
await r.client.updatePage('p1', { properties: { A: { checkbox: true } } });
assert.equal(r.calls[0].headers['Notion-Version'], '2022-06-28');
```

### 3.7 HTTP-level Notion fake through pull.mjs

From `tests/apply.test.mjs` (lines 545-555). The `.env` is written only into a temp folder and holds a test value, never the real token:

```js
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { createFakeNotion, realConfig } from './fixtures/notion/fake-notion.mjs';
import { buildWorld, makeRoot, captureIo } from './fixtures/notion/helpers.mjs';
import { main as pullMain } from '../agents/claim-tagger/scripts/pull.mjs';

const config = realConfig();
const fake = createFakeNotion();
buildWorld(fake);
const r = makeRoot({ config: { ...config, notion: { ...config.notion, requests_per_second: 1000 } } });
writeFileSync(join(r.repo, '.env'), 'NOTION_TOKEN=<test value, at least 5 characters>\n');
const cap = captureIo();
const code = await pullMain(['--all', '--pull-id', 'p1'], cap.io, { root: r.root, repoRoot: r.repo, fetchImpl: fake.fetch });
assert.equal(code, EXIT.OK, cap.err.join('\n'));
```

## 4. Flags and gaps for the builder

1. **probe.mjs bypasses the client.** Hard rule 2 in `CLAUDE.md` says scripts reach Notion only through `notion-rest.mjs`. `probe.mjs` sends `GET /databases/<id>` through its own `fetch` with its own headers (`probe.mjs:111`, `:119`), and its header (line 17) says this is deliberate. It is read-only, but the parent should decide whether that is acceptable.
2. **status.mjs reads .env text.** `status.mjs:347-351` reads `.env` as text and tests for `NOTION_TOKEN=` (presence only; no value is printed). It is outside lib.
3. **extraArgs are not checked.** `buildArgs` appends `extraArgs` verbatim (`claude.mjs:115`). No `--bare` or `--fallback-model` appears in `agents/claim-tagger`, `tests` or `.claude` (grep), so hard rule 9 holds by convention only.
4. **The create guard covers one endpoint.** `isCreate` is only `POST /pages` (`notion-rest.mjs:122`). A new create-like call (a database or a view) would get the generic retry on 5xx, 409 and network failures, so it could be sent twice. Extend `isCreate` before adding one.
5. **The fake ignores filters and sorts.** `queryDatabase(databaseId)` takes no filter. A test that depends on server-side filtering would pass when it should fail.
6. **Client-surface createPage does not split children.** The fake stores all children at once. The HTTP surface does split them, because it receives the real client's slices.
7. **HTTP-level backoff is real time.** 5xx, 409 and network injection run the real 0.5, 1 and 2 s backoff, because `pull.mjs` and `apply.mjs` give the client no `sleep` hook.
8. **loadToken fails silently.** It returns null on any exception, including a Node without `process.loadEnvFile`. Scripts then report "there is no NOTION_TOKEN in .env", which can hide the real cause.
9. **In-process hang is not cancelled.** `runFakeInProcess` resolves as timed out, but the fake's own sleep (default 30 s) keeps the process alive until it fires. Use the child-process driver for timeout tests; `claude.test.mjs` does.
10. **HTTP fake token check.** A token under 5 characters gets a 401 from the fake.
11. **Two rubrics.** `helpers.makeRoot` copies the live rubric (`agents/claim-tagger/rubric/rubric.json`); `loop/world.mjs` copies the frozen research rubric. Pick the one the test needs.
