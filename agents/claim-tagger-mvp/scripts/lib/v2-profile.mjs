// The setup/structure.json of the v2 page, completed from docs/mvp-2026-11/STRUCTURE-V2.md. Pure code: nothing here reads .env, prints or sends anything. scripts/v2-profile.mjs is the command that writes the file.
//
//   completeStructure(markdown) -> the v2 structure from STRUCTURE-V2.md: the parsed proposal with the spec's completion block applied, validated
//
// Since P48 config.json IS the v2 config (the page, its five tables and their ids); the function that built it from the per-claim config (buildV2Config), the placeholder it used and the
// list of live ids it protected went with the config swap. The per-claim version of all of it is the git tag claim-tagger-v1.

import { structureFromProposal, validateStructure } from './notion-build.mjs';

/**
 * The structure of the v2 page from STRUCTURE-V2.md: the proposal parsed as `setup.mjs structure --from-proposal` parses it, then the spec's "Completion for setup/structure.json"
 * block applied (the format has no relation column, no table name of its own, no table description, no table's own first tab and no hub block). Merge rule, as the spec states it:
 * made_from, pages, hub and sync_descriptions (the description sync of the build) replace the parsed values; per table, title, description and default_view are set and each insert_columns entry goes in right after the column named in
 * `after` (keeping its renamed_from and two_way); then renamed_from ({ <table>: { <new name>: <old name> } }) sets renamed_from on those columns; then view_columns replaces the
 * columns of each view it names. Throws when the spec has no completion block or the result is not a valid structure. Pure.
 */
export function completeStructure(markdown) {
  const structure = structureFromProposal(markdown);
  const m = /## Completion for setup\/structure\.json[\s\S]*?```json\r?\n([\s\S]*?)```/.exec(markdown);
  if (!m) throw new Error('the spec has no "Completion for setup/structure.json" block with a json fence');
  const add = JSON.parse(m[1]);
  for (const k of ['made_from', 'pages', 'hub', 'sync_descriptions']) if (add[k] !== undefined) structure[k] = add[k];
  for (const [table, t] of Object.entries(add.tables ?? {})) {
    const target = structure.tables[table];
    if (!target) throw new Error(`the completion names the table "${table}", which the spec does not have`);
    for (const f of ['title', 'description', 'default_view']) if (t[f] !== undefined) target[f] = t[f];
    for (const { after, name, type, description, relation_to, renamed_from, two_way } of t.insert_columns ?? []) {
      const at = target.columns.findIndex((c) => c.name === after);
      if (at < 0) throw new Error(`the completion inserts "${name}" after "${after}", which ${table} does not have`);
      target.columns.splice(at + 1, 0, {
        name, type, options: [], description, relation_to, ...(renamed_from !== undefined ? { renamed_from } : {}), ...(two_way !== undefined ? { two_way } : {}),
      });
    }
  }
  // each column's name on the page built at checkpoint 1, so that the builder renames it instead of adding a new one
  for (const [table, names] of Object.entries(add.renamed_from ?? {})) {
    const target = structure.tables[table];
    if (!target) throw new Error(`the completion renames columns of the table "${table}", which the spec does not have`);
    for (const [name, old] of Object.entries(names)) {
      const column = target.columns.find((c) => c.name === name);
      if (!column) throw new Error(`the completion says "${name}" was "${old}", but ${table} has no column "${name}"`);
      if (column.renamed_from !== undefined && column.renamed_from !== old) throw new Error(`the completion gives "${name}" of ${table} two earlier names ("${column.renamed_from}" and "${old}")`);
      column.renamed_from = old;
    }
  }
  for (const [name, columns] of Object.entries(add.view_columns ?? {})) {
    const view = structure.views.find((v) => v.name === name);
    if (!view) throw new Error(`the completion sets the columns of "${name}", which is not a view of the spec`);
    view.columns = [...columns];
  }
  validateStructure(structure);
  return structure;
}
