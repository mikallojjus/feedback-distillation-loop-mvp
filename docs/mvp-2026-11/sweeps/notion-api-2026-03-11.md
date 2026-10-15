# Notion REST facts for the builder (checked on developers.notion.com, 2026-10-15)

Versions: `2022-06-28` (the old library's default; database queries, row creates with a database parent, page updates), `2025-09-03` (databases become containers of data sources; `POST /v1/data_sources/{id}/query`), `2026-03-11` (views; `after` becomes `position`, `archived` becomes `in_trash`). The builder pins `2026-03-11` for creates of databases and views only; every other call keeps `2022-06-28`.

## Create a database: `POST /v1/databases`

Body: `parent {type: "page_id", page_id}` (a page or a wiki database), `title` (rich text, max 100 items), `description`, `is_inline` (default false), `initial_data_source { properties: { <name>: config } }`, `icon`, `cover`. Property configs: `{type:"title", title:{}}`, `{type:"rich_text", rich_text:{}}`, `{type:"number", number:{format}}`, `{type:"select", select:{options:[{name,color,description}]}}` (max 100 options; colours default, gray, brown, orange, yellow, green, blue, purple, pink, red), `multi_select` likewise, `{type:"status", status:{options:[{name,color,description,group}]}}` (groups "To-do", "In progress", "Complete"), `checkbox`, `date`, `url`, `{type:"formula", formula:{expression}}`, `{type:"relation", relation:{data_source_id, single_property:{} | dual_property:{}}}`, `created_time`, `last_edited_time`. Every property accepts `description` (1 to 280 characters). Response: `object:"database"`, `id`, `title`, `data_sources:[{id,name}]`, `url`, `is_inline`, `in_trash`. 404 when the parent page is not shared with the connection.

## Create a view: `POST /v1/views` (Notion-Version 2026-03-11)

Body: exactly one of `database_id` (a tab on that database), `view_id` (a dashboard widget) or `create_database {parent:{type:"page_id", page_id}}` (a linked database block on a page); always `data_source_id`; `name`; `type` in table, board, list, calendar, timeline, gallery, form, chart, map, dashboard; `filter` (the data-source query filter format: `{property, select:{equals}}`, `{and:[...]}`, up to two levels; select, status and multi_select operators accept arrays, e.g. `{does_not_equal:["Done","Archive"]}`); `sorts` (max 100; `{property, direction:"ascending"|"descending"}` or `{timestamp:"created_time"|"last_edited_time", direction}`); `quick_filters` (keys are property names or ids, values are conditions without `property`); `configuration` (discriminated by `type`, must match the view type); `position` (`{type:"start"}`, `{type:"end"}`, `{type:"after_view", view_id}`).

Table configuration: `type:"table"` (required), `properties` (max 100, or null to clear) of `{property_id (required, the stable id), visible (boolean), width (pixels, min 1), wrap (boolean), status_show_as, card_property_width_mode, date_format, time_format}`, `group_by` or null, `subtasks` or null, `wrap_cells` (boolean), `frozen_column_index` (integer, min 0), `show_vertical_lines` (boolean).

Response: a partial view (`object:"view"`, `id`, `parent {type:"database_id", database_id}`, `type`) or a full view (`name`, `created_time`, `last_edited_time`, `url`, `data_source_id`, `filter`, `sorts`, `quick_filters`, `configuration`). Errors: 400 when zero or more than one placement field is given; 404 when the database or data source is not shared with the connection; 429 rate limited.

Eight view endpoints exist since 19 March 2026: create, retrieve, update, delete, list views of a database, query a view. The builder uses create, retrieve and list; never delete.

## Other

The connector's `notion-create-view` tool (view DSL: `FILTER "P" = "v"; SORT BY "P" ASC; SHOW "A","B"`) is the fallback when the REST view call fails; written instructions in the page are the last fallback, as the brief says.
