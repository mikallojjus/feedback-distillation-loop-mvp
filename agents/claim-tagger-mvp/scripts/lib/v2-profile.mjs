// The config.json and setup/structure.json of the v2 profile: a second Notion page with its own five tables, built beside the live one (docs/mvp-2026-11/STRUCTURE-V2.md). Pure code: nothing here reads
// .env, prints or sends anything. scripts/v2-profile.mjs is the command that writes the file.
//
//   buildV2Config(production)   -> the config of the v2 profile, made from production's config (not changed)
//   completeStructure(markdown) -> the v2 structure from STRUCTURE-V2.md: the parsed proposal with the spec's completion block applied, validated
//   V2_PLACEHOLDER              -> "<setup>", the value every id that setup learns later starts as (the same word a practice page's config uses)
//
// The state root of v2 is agents/claim-tagger-mvp/profiles/v2/ (CLAIM_TAGGER_MVP_ROOT points the scripts at it, lib/paths.mjs agentRoot). Its config differs from production's like this:
//
//   profile                    "v2" (config.mjs isV2). Every loop script refuses a v2 root until the loop is ported (checkpoint 3); only setup.mjs runs on it.
//   notion.root_parent_page_id the live hub page: the one page v2 hangs under. `setup.mjs root` lists its children and finds or makes the v2 page there. It is NOT protected (validateConfig
//                              refuses a v2 config whose root parent is), because a page cannot be made under a protected one; the scripts only ever read it and add that one sub-page.
//   notion.parent_page_id      "<setup>" until `setup.mjs root` has the v2 page; then that page. A placeholder here (and in notion.setup_page_parents) means the build steps find no parent and
//                              stop, so nothing can be built under the live hub by mistake, and the connector guard (hooks/guard.mjs) allows no page creation under it.
//   notion.pages               five placeholders ("<none>", as on a practice page): the v2 structure has its own sub-pages, which the builder registers into this list as it makes them. The live
//                              Onboarding and Archive pages are protected, never copied. validateConfig wants all five keys, as an id or a placeholder; a placeholder is the honest value.
//   tables                     five placeholders; the ids come from `setup.mjs databases`. Views: {} until `setup.mjs views`.
//   protected lists            production's two lists PLUS every live id that v2 must never write: the five live tables (database id and data source id), every live view id, and the live
//                              Onboarding and Archive pages. The live hub is taken OUT of both lists if production had it there (it is v2's parent). checkPlan refuses any plan that names one.
//   editor_columns             claims: [] (editors decide on Tag decisions, Claims has no editor column); tag_decisions: ["Agent is right", "Tag outcome", "Your note"]; rule_changes, its Status values and
//                              agent_settings as production.
//   notion.claims.columns      production's, without the three keys that name the per-claim editor columns (verified, review_status, notes); the Geo ones stay.
//   everything else            production's (sources, models, tags, judge, queue, distill, gate, geo ...), so v2 is judged by the same rules at the start.

import { CLAIMS_EDITOR_KEYS, V2_PROFILE } from './config.mjs';
import { structureFromProposal, validateStructure } from './notion-build.mjs';
import { normId } from './notion-values.mjs';

export const V2_PLACEHOLDER = '<setup>';
const NO_PAGE = '<none>';
/** The editor columns of Tag decisions in v2 (STRUCTURE-V2.md, P45 and P46): the tick that takes the agent's answer, the outcome an editor picks and the note they may add. */
export const V2_TAG_DECISIONS_EDITOR_COLUMNS = Object.freeze(['Agent is right', 'Tag outcome', 'Your note']);

const isRealId = (v) => typeof v === 'string' && /^[0-9a-f]{32}$/.test(normId(v.trim()));

/** Production's list plus `extra`, once each (dashes and case ignored; the first spelling stays), without the ids in `drop`. */
function union(list, extra, drop) {
  const out = [];
  const seen = new Set(drop);
  for (const id of [...(list ?? []), ...extra]) {
    if (typeof id !== 'string' || id.trim() === '') continue;
    const key = normId(id.trim());
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

/** The ids of everything live that v2 must never write, as production's config names them: five tables (both ids each), every view, and the Onboarding and Archive pages. */
export function liveIds(production) {
  const n = production.notion;
  const tables = [n.rulebook, n.claims, ...Object.values(n.databases ?? {})].flatMap((t) => [t?.database_id, t?.data_source_id]).filter(isRealId);
  const views = Object.values(n.views ?? {}).map((v) => v?.id).filter(isRealId);
  const pages = [n.pages?.onboarding, n.pages?.archive].filter(isRealId);
  return { tables, views, pages };
}

/** The config.json of the v2 profile, made from production's. See the header for what changes. Throws when production is not a plain production config. */
export function buildV2Config(production) {
  if (production?.profile !== undefined || production?.demo === true) throw new Error('buildV2Config: expected the production config (no profile, not a practice page)');
  const cfg = structuredClone(production);
  const n = cfg.notion;
  const hub = production.notion.parent_page_id;
  if (!isRealId(hub)) throw new Error('buildV2Config: production has no notion.parent_page_id (the live hub)');
  const live = liveIds(production);
  const drop = [normId(hub)];

  cfg.profile = V2_PROFILE;
  n.root_parent_page_id = hub;
  n.parent_page_id = V2_PLACEHOLDER;
  n.setup_page_parents = [V2_PLACEHOLDER];
  n.protected_database_ids = union(n.protected_database_ids, [...live.tables, ...live.views], drop);
  n.protected_page_ids = union(n.protected_page_ids, live.pages, drop);
  n.pages = { proposal: NO_PAGE, demos: NO_PAGE, demo_tests: NO_PAGE, onboarding: NO_PAGE, archive: NO_PAGE };
  n.rulebook = { database_id: V2_PLACEHOLDER, data_source_id: V2_PLACEHOLDER, key: production.notion.rulebook.key, work_tag: production.notion.rulebook.work_tag };
  const columns = { ...production.notion.claims.columns };
  for (const k of CLAIMS_EDITOR_KEYS) delete columns[k];
  n.claims = {
    label: production.notion.claims.label, database_id: V2_PLACEHOLDER, data_source_id: V2_PLACEHOLDER, key: production.notion.claims.key,
    columns, write_columns: { ...production.notion.claims.write_columns },
  };
  n.databases = Object.fromEntries(Object.entries(production.notion.databases).map(([k, v]) => [k, { database_id: V2_PLACEHOLDER, data_source_id: V2_PLACEHOLDER, key: v.key }]));
  n.views = {};
  cfg.editor_columns = { ...production.editor_columns, claims: [], tag_decisions: [...V2_TAG_DECISIONS_EDITOR_COLUMNS] };
  return cfg;
}

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
