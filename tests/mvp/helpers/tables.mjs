// The columns of the five agent tables and of the real claims table, in the short form the plan and pull tests use, and restProps() to turn
// that form into the REST property configs that fixtures/fake-notion.mjs addDatabase takes.
//
//   restProps({ Name: 'title', Tags: { type: 'multi_select', options: ['a', 'b'] }, Taxonomy: { type: 'relation', data_source_id } })

export function restProps(spec) {
  const out = {};
  for (const [name, v] of Object.entries(spec)) {
    const type = typeof v === 'string' ? v : v.type;
    if (type === 'select' || type === 'multi_select') out[name] = { type, [type]: { options: (typeof v === 'object' ? v.options ?? [] : []).map((o) => ({ name: o })) } };
    else if (type === 'relation') out[name] = { type, relation: { data_source_id: v.data_source_id, single_property: {} } };
    else out[name] = { type, [type]: {} };
  }
  return out;
}

export const TABLE_SPECS = Object.freeze({
  rulebook: {
    Name: 'title', Category: 'select', Counterpart: 'rich_text', Description: 'rich_text', Evidence: 'url', 'Example Claims': 'rich_text',
    'Geo Status': 'select', 'Geo Tag ID': 'rich_text', Polarity: 'select', Status: 'select', 'Verified on': 'date', 'When to use': 'rich_text', 'Work tags': 'multi_select',
  },
  claims_copy: {
    'Geo Name': 'title', 'Geo ID': 'rich_text', 'Geo URL': 'url', 'Geo Sources': 'rich_text', 'Geo Tags': 'multi_select', 'Geo Topics': 'rich_text', 'Geo Score': 'number',
    'Geo Supporting arguments': 'rich_text', 'Geo Opposing arguments': 'rich_text', 'Geo Related people': 'rich_text', 'Geo Related projects': 'rich_text',
    'Geo Is factual': 'checkbox', 'Geo Name source': 'select', 'Agent tags': 'rich_text', 'Agent notes': 'rich_text',
  },
  tag_decisions: {
    Claim: 'title', Key: 'rich_text', Tag: 'select', 'Agent proposal': 'select', 'Agent confidence': 'number', 'Agent reason': 'rich_text', 'Claim link': 'url',
    'Rulebook edition': 'rich_text', 'Follow-up': 'select', 'Tag outcome': 'select', 'Why wrong': 'select', 'Your reasoning': 'rich_text',
  },
  rule_changes: {
    Lesson: 'title', Tag: 'select', Rule: 'rich_text', Kind: 'select', 'Current text': 'rich_text', 'Proposed text': 'rich_text', 'Safety check result': 'rich_text',
    'Supporting rows': 'rich_text', 'Editor wording': 'rich_text', Status: 'select',
  },
  agent_settings: { Name: 'title', Paused: 'checkbox', 'Rulebook edition': 'rich_text', 'Last run summary': 'rich_text' },
});

const TAG_OPTIONS = ['Debate', 'Democracy & Media', 'Economy', 'Featured', 'Immigration', 'Main claim', 'Politics', 'debate claim'];

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
