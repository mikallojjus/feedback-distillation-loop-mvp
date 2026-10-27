# Notion API facts for moving pages and databases

Sweep date: 2026-10-27. Scope: developers.notion.com only (reference pages in `.md` form, the changelog, the 2025-09-03 and 2026-03-11 upgrade guides, the historical changelog).

Method and limits: the facts come from WebFetch summaries of those pages, not from a live API call. Statements are paraphrased with the URL beside them. The file carries one short quote to stay inside the copyright limit. Check every request body against a live call on a test page before the script relies on it.

Version note: every reference page checked lists only `2026-03-11` as the allowed Notion-Version value. Anything else is marked "not documented" where it matters.

---

## 1. Move a page: POST /v1/pages/{page_id}/move

Sources: https://developers.notion.com/reference/move-page.md ; changelog entry of 15 Jan 2026 at https://developers.notion.com/page/changelog.md

- Request: `POST /v1/pages/{page_id}/move`. The page must be a regular page. The reference says moving databases or other block types is not supported on this endpoint. UUIDs work with or without dashes.
- Body: `parent` is required. Page parent: `{"parent": {"type": "page_id", "page_id": "<parent-page-id>"}}`. The reference says the parent must be a page and not another block type. It says a database_id may go under `page_id` but is not recommended. Data source parent: `{"parent": {"type": "data_source_id", "data_source_id": "<id>"}}`. The bot needs edit access to the new parent.
- Notion-Version: required header. The enum lists `2026-03-11` only.
- Response 200: either a partial object (`object` "page" and `id`) or a full page object (parent, properties, in_trash, is_archived, is_locked, url, timestamps, created_by, last_edited_by). Which form comes back is not documented.
- Errors: the reference lists codes by status. 400: invalid_json, invalid_request_url, invalid_request, missing_version, invalid_beta, validation_error, invalid_credit_limit. 401: unauthorized. 403: restricted_resource, status_change_not_allowed, workspace_credits_exhausted, agent_credit_limit_reached. 404: object_not_found, directory_not_found. 406: row_limit_exceeded. 409: conflict_error, idempotency_key_reused, agent_deleted. 429: rate_limited. 500, 503, 504, 529: internal_server_error, service_unavailable, gateway_timeout, service_overload. What each code means for this endpoint: not documented.
- Do sub-pages and child databases move with the page: not documented.
- Where the page lands in the new parent's block list (start or end): not documented.
- Same-parent move (new parent equal to the current parent): not documented.
- Changelog: the 15 Jan 2026 entry introduces the Move page API to change the parent of an existing page. It gives no method, path or version.

## 2. Move a database: PATCH /v1/databases/{database_id}

Sources: https://developers.notion.com/reference/database-update.md ; https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03.md

- Request: `PATCH /v1/databases/{database_id}`. No required body fields.
- Body fields in the reference: `parent` (if omitted, the database is not moved), `is_inline` (boolean), `title`, `description`, `icon`, `cover`, `in_trash`, `is_locked`, `show_data_source_title`.
- `parent` shapes: `{"type": "page_id", "page_id": "<id>"}` or `{"type": "workspace", "workspace": true}`. The reference shows no data_source_id form for this endpoint.
- Upgrade guide example: `PATCH /v1/databases/:database_id` with body `{"parent": {"type": "page_id", "page_id": "NEW-PAGE-ID"}, "is_inline": true}`. The guide describes it as moving a database and switching it to inline under the parent page. The example shows no Notion-Version header. Its code block is labelled "Update Data Source" although the call goes to the database endpoint.
- The guide says public connections can also move a database to the workspace level as a private page.
- Notion-Version: the header enum lists `2026-03-11` only. Earlier versions: not documented for this endpoint.
- Can an inline database (a child_database block on a page) be moved this way: not stated by the reference. The guide's example moves a database and sets `is_inline` to true in the same call, but it does not say that an already-inline database can be moved without that change.
- `is_inline` in the same call: the guide's example does exactly this.
- Where the database lands in the new parent: not documented.
- Same-parent move: not documented.
- Response 200: the updated database object (partial with `object` and `id`, or full with parent, is_inline, data_sources, url). Which form: not documented.
- Errors: same status families as the page move. Per-code meaning for this endpoint: not documented.
- Changelog: no 2025-2026 entry documents moving a database. The 13 Sep 2025 entry adds changing a data source's parent database, which is a different operation.

## 3. Append block children: PATCH /v1/blocks/{block_id}/children

Sources: https://developers.notion.com/reference/patch-block-children.md ; historical changelog entry of 13 Jun to 10 Jul 2023 at https://developers.notion.com/docs/historical-changelog.md ; https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11.md ; changelog of 11 Mar 2026

- Notion-Version 2022-06-28: the historical changelog (Jun to Jul 2023) announced a new `after` parameter. Its sample sends `Notion-Version: 2022-06-28` and places `after` as a top-level key next to `children`, not inside the array. So the docs show `after` working with 2022-06-28. The docs do not state the version range. Not confirmed live.
- Notion-Version 2025-09-03: the reference marks `after` as deprecated. The 2026-03-11 upgrade guide lists the flat `after` as the "before" behaviour, which implies 2025-09-03 uses it. No page states this for 2025-09-03 directly. Whether 2025-09-03 accepts `position`: not documented.
- Notion-Version 2026-03-11: the `position` object is the placement method. Its types are:
  - `after_block`, shape `{"type": "after_block", "after_block": {"id": "<block_id>"}}`, inserts after a given block.
  - `start`, inserts at the beginning of the parent.
  - `end`, the default when `position` is omitted.
  The docs give only the type names for `start` and `end`. Their exact JSON is not documented; `{"type": "start"}` is the expected form and needs a live test.
- `after` is deprecated per the reference. The 2026-03-11 upgrade guide says the endpoint "no longer accepts a flat after parameter". The removal date: not documented. The reference says `position` offers more flexibility, including insertion at the start, which `after` cannot do. It also says `after` and `position` cannot both be sent in one request.
- Other limits in the reference: `children` is capped at 100 blocks per request. The body schema rejects unknown properties.

## 4. Create a page / create a database: is there a position parameter?

Sources: https://developers.notion.com/reference/post-page.md ; https://developers.notion.com/reference/create-a-database.md ; changelog of 15 Jan 2026

Create a page (`POST /v1/pages`):
- Yes. The schema has a `position` body property (`pagePositionSchema`) with three variants: `{"type": "after_block", "after_block": {"id": "<block_id>"}}`, `{"type": "page_start"}` and `{"type": "page_end"}`. Note the names differ from block children, which use `start` and `end`.
- The reference gives `position` no prose description. The default when omitted: not documented. Whether it applies when the parent is a page: not stated by the reference.
- The 15 Jan 2026 changelog says the change allows customising the position of a new page within the parent page, so the feature is meant for a page parent.
- If the new page is a child of another page, `title` is the only valid property in `properties` (reference prose).
- Notion-Version enum: `2026-03-11` only.

Create a database (create-a-database reference):
- No position, index or ordering parameter. Not documented.
- Inline creation is by the `is_inline` boolean, default false, which shows the database inline in the parent page.
- Parent: `page_id` or `workspace`.
- Conflict: the page text says it describes the API up to and including 2022-06-28 and is deprecated as of 2025-09-03. The header enum lists only `2026-03-11`. Treat the version on this page as unclear.

## 5. Update a page title: PATCH /v1/pages/{page_id}

Sources: https://developers.notion.com/reference/patch-page.md ; https://developers.notion.com/reference/post-page.md

- Shape, derived from the schema and prose: `{"properties": {"title": {"title": [{"text": {"content": "<new title>"}}]}}}`. The property key is `title`, and the value is a `title` array of rich-text items (max 100).
- The patch-page prose allows `properties` to update "the title of a page outside of a data source". The create-page prose says `title` is the only valid property for a child page.
- The one JSON example in the docs is for a data-source property named `Name`, not for a page under a page. The page-under-page form is consistent with the schema but not shown literally. Test it live.
- A page's parent cannot be changed through this endpoint. The reference says: "A page's parent cannot be changed." Parent changes go through the move endpoint in section 1.
- Notion-Version: enum `2026-03-11` only.

## 6. Trash vs archive

Sources: https://developers.notion.com/reference/trash-page.md ; https://developers.notion.com/reference/patch-page.md ; upgrade guide 2026-03-11 and the changelog of 11 Mar 2026

- The trash flag is `in_trash`. The trash page says to trash a page, send an Update page request with `in_trash` set to true, and set it to false to restore. Quote: "Starting with 2026-03-11, only in_trash is accepted." Trashing returns 200 with the trashed page object, which carries `"in_trash": true`.
- Before 2026-03-11, `archived` was a deprecated alias for `in_trash` (trash page). The upgrade guide says `archived` was deprecated in April 2024 and removed in favour of `in_trash` in 2026-03-11, across requests and responses.
- Conflict: the patch-page schema lists both `in_trash` and `is_archived` as boolean request fields. `is_archived` has no description in the reference and no prose explains it as a request field. Do not send `is_archived`. The brief's name `archived` is the pre-2026-03-11 name; `is_archived` is a response field name.
- Omitted behaviour: the docs do not say that omitting `in_trash` leaves the page alone. The only "not provided" rule in the patch-page reference covers `is_locked`. Trashing is documented as an explicit `in_trash: true` action, so "a client that never sends them never trashes anything" is an inference, not a documented guarantee.

## 7. Changelog entries, 2025 to 2026 (move, position, trash)

Sources: https://developers.notion.com/page/changelog.md ; https://developers.notion.com/page/changelog

- 13 Sep 2025: a data source's parent database can be changed. Not a database move.
- 15 Jan 2026: Move page API introduced to change an existing page's parent. The same entry adds customising the position of a new page within its parent page. No method, path or version given.
- 11 Mar 2026 (Notion-Version 2026-03-11): breaking changes. The flat `after` on Append block children is replaced by a `position` object. `archived` is replaced by `in_trash` across endpoints. The transcription block type is renamed `meeting_notes`.
- 15 Jul 2026: search accepts `filter.in_trash` and a top-level `is_archived` body parameter. Search only.
- 17 Apr 2026: the MCP fetch tool includes `is_archived`. MCP only.
- 15 May 2026: `insert_content.position` prepends markdown to the start of a page. Content insertion, not a block move. Notion-Version not stated.
- 13 Oct 2026: moving content to Trash after the user confirms. No API detail given.
- No 2025-2026 entry documents a database move endpoint or a block move.

---

## Implications for a script that moves 3 pages and 5 inline databases into a sub-page of the same root

- Send `Notion-Version: 2026-03-11` on every call. It is the only value the move, database-update, block-children and create-page references list. Behaviour on other versions is not documented.
- Pages: `POST /v1/pages/{id}/move` with `{"parent": {"type": "page_id", "page_id": "<sub-page-id>"}}`. Use `page_id`, not `database_id`. Not documented: whether sub-pages and child databases move with the page, and where it lands in the sub-page's block list. Read both back after the first real move.
- Inline databases: `PATCH /v1/databases/{id}` with `{"parent": {"type": "page_id", "page_id": "<sub-page-id>"}, "is_inline": true}`, following the upgrade-guide example. The reference does not say an inline database can be moved this way or where it lands. Test on one database, then read back `parent` and `is_inline`. Do not send `cover` in the same call; the guide says cover is not supported when `is_inline` is true.
- Resumability: a re-run may find an item already under the sub-page. Same-parent behaviour is not documented, so GET the current parent before each move and skip if it already matches.
- Never send `in_trash`, `is_archived` or `archived` in these calls. A move needs only `parent`, plus `is_inline` for databases. The docs do not confirm that omitting `in_trash` is safe, so the rule is "never send it".
- Do not use `after` to order blocks in the sub-page. It is deprecated, and the 2026-03-11 upgrade guide says it is no longer accepted. Use the `position` object (`after_block`, `start` or `end`), and never send `after` and `position` in one request.
- Parent changes go through the move endpoints only. `PATCH /v1/pages` cannot change a page's parent.
- Permissions: the integration needs edit access to the new sub-page (move-page reference). Permission rules for database moves are not documented.
