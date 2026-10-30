// The columns of the five agent tables and of the real claims table, in the short form the plan and pull tests use, and restProps() to turn
// that form into the REST property configs that fixtures/fake-notion.mjs addDatabase takes.
//
//   restProps({ Name: 'title', Tags: { type: 'multi_select', options: ['a', 'b'] }, Taxonomy: { type: 'relation', data_source_id } }, relationTarget)
//   A relation without a data_source_id of its own (the Claims table's Agent tags and Tags waiting) points at `relationTarget`: the data source id of the Rulebook. A relation with a
//   `target` (Tag decisions' Open claim: { type: 'relation', target: 'claims' }) points at targets[target], the data source id of that table (restProps(spec, rulebook, { claims })).
//   The tables are the v2 layout since P48. Claims has no Tag decisions relation here: the fake needs the target table to exist when a relation is made, and Tag decisions comes after Claims.

export function restProps(spec, relationTarget = null, targets = {}) {
  const out = {};
  for (const [name, v] of Object.entries(spec)) {
    const type = typeof v === 'string' ? v : v.type;
    if (type === 'select' || type === 'multi_select') out[name] = { type, [type]: { options: (typeof v === 'object' ? v.options ?? [] : []).map((o) => ({ name: o })) } };
    else if (type === 'relation') out[name] = { type, relation: { data_source_id: v.data_source_id ?? targets[v.target] ?? relationTarget, single_property: {} } };
    else out[name] = { type, [type]: {} };
  }
  return out;
}

export const TABLE_SPECS = Object.freeze({
  rulebook: {
    Name: 'title', Category: 'select', Counterpart: 'rich_text', Description: 'rich_text', Evidence: 'url', 'Example Claims': 'rich_text',
    'Geo Status': 'select', 'Geo Tag ID': 'rich_text', Polarity: 'select', Status: 'select', 'Verified on': 'date', 'When to use': 'rich_text', 'Work tags': 'multi_select',
  },
  claims: {
    'Geo Name': 'title', 'Geo ID': 'rich_text', 'Geo URL': 'url', 'Geo Sources': 'rich_text', 'Geo Tags': 'multi_select', 'Geo Topics': 'rich_text',
    'Geo Space': { type: 'select', options: ['U.S. Politics', 'World affairs', 'AI', 'Health', 'Crypto', 'Technology'] }, 'Geo Created': 'date',
    'Geo Is factual': 'checkbox', 'Agent tags': { type: 'relation' }, 'Agent confidence': 'number', 'Agent reasons': 'rich_text',
    'Agent status': { type: 'select', options: ['Waits for you', 'Done', 'Disagrees with your decision', 'Could not read'] }, 'Tags waiting': { type: 'relation' },
    'Agent edition': 'rich_text', 'Agent remarks': 'rich_text', "Agent's view of your decision": 'rich_text',
  },
  tag_decisions: {
    Claim: 'title', 'Open claim': { type: 'relation', target: 'claims' }, Key: 'rich_text', Tag: 'select', 'Agent proposal': 'select', 'Agent confidence': 'number',
    'Agent reason': 'rich_text', 'Agent is right': 'checkbox', 'Tag outcome': { type: 'select', options: ['Applies', 'Does not apply'] }, 'Your note': 'rich_text',
    'Agent status': { type: 'select', options: ['Waits for you', 'Done', 'Disagrees with your decision', 'Could not read'] },
    "Agent's view of your decision": { type: 'select', options: ['Agent slip', 'Rule unclear', 'Rule should change'] }, Rule: 'rich_text', 'Why the agent thinks so': 'rich_text',
    'After the rule change': { type: 'select', options: ['Fixed', 'Still wrong'] }, 'Rulebook edition': 'rich_text', 'Decided under': 'rich_text', 'Read under': 'rich_text',
  },
  rule_changes: {
    Lesson: 'title', Tag: 'select', Rule: 'rich_text', Kind: 'select', 'Current text': 'rich_text', 'Proposed text': 'rich_text', 'Safety check result': 'rich_text',
    'Supporting rows': 'rich_text', 'Editor wording': 'rich_text', Status: 'select',
  },
  agent_settings: { Name: 'title', Paused: 'checkbox', 'Rulebook edition': 'rich_text', 'Last run summary': 'rich_text' },
});

/**
 * The tables of the first page (the per-claim layout, git tag claim-tagger-v1), which only the copy reads: the same five tables with the three editor columns on Claims and the
 * seventeen columns of the old ledger. The other three tables are the same on both pages.
 */
export const FIRST_PAGE_SPECS = Object.freeze({
  ...TABLE_SPECS,
  claims: {
    ...Object.fromEntries(Object.entries(TABLE_SPECS.claims).filter(([name]) => name !== "Agent's view of your decision")),
    'Agent reading': 'rich_text',
    'Verified tags': { type: 'relation' }, 'Review status': { type: 'select', options: ['To review', 'Reviewed'] }, 'Challenged tags notes': 'rich_text',
  },
  tag_decisions: {
    Claim: 'title', Key: 'rich_text', Tag: 'select', 'Agent proposal': 'select', 'Agent confidence': 'number', 'Agent reason': 'rich_text', 'Claim link': 'url',
    'Rulebook edition': 'rich_text', 'Follow-up': 'select', 'Tag outcome': 'select', 'Why wrong': 'select', 'Your reasoning': 'rich_text', 'Decided under': 'rich_text',
    'Agent reading': { type: 'select', options: ['Agent slip', 'Rule unclear', 'Rule should change'] }, Rule: 'rich_text', 'Reading note': 'rich_text', 'Read under': 'rich_text',
  },
});

const TAG_OPTIONS =['Debate', 'Democracy & Media', 'Economy', 'Featured', 'Immigration', 'Main claim', 'Politics', 'debate claim'];

/** The real claims table (docs/mvp-2026-11/sweeps/live-schemas.md). The two relations need a data source each: pass them in. */
export function realClaimsSpec({ taxonomy, editors }) {
  return {
    'Geo Name': 'title', 'Geo ID': 'rich_text', 'Geo URL': 'url', 'Geo Sources': 'rich_text',
    'Geo Tags': { type: 'multi_select', options: TAG_OPTIONS }, 'Geo Topics': 'rich_text', 'Geo Score': 'number',
    'Geo Supporting arguments': 'rich_text', 'Geo Opposing arguments': 'rich_text', 'Geo Related people': 'rich_text', 'Geo Related projects': 'rich_text',
    'Geo Is factual': 'checkbox', 'Geo Name source': { type: 'select', options: ['This space', 'Other space (fallback)'] },
    'Proposed Tags': { type: 'multi_select', options: TAG_OPTIONS }, 'Proposed Topics': 'rich_text', 'Proposed rename': 'rich_text', 'Review notes': 'rich_text',
    'Review status': { type: 'select', options: ['To review', 'Reviewed'] }, 'Challenged tags notes': 'rich_text',
    'Claim quality tags — verified': { type: 'relation', data_source_id: taxonomy }, 'Editors challenging the QA tags': { type: 'relation', data_source_id: editors },
  };
}
