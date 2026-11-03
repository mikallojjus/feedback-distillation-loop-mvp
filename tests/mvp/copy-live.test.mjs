// copy-live.mjs (checkpoint 2 of the v2 page): the copy of the first page's tables into the five tables of v2, through a plan. Notion is the in-memory fake (fixtures/fake-notion.mjs) behind the real
// REST client; nothing here reads .env or reaches the network. Also: the pure decision rule of lib/first-page.mjs and the narrow allowance of lib/plan.mjs for the script "copy-live".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, readFirstPage } from '../../agents/claim-tagger-mvp/scripts/copy-live.mjs';
import { COPY_LIVE_COLUMNS, loadConfig, validateConfig } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import {
  OUTCOME, STATUS, decisionsFor, keyGeoId, parseTagLines, rowAgentStatus,
} from '../../agents/claim-tagger-mvp/scripts/lib/first-page.mjs';
import { normId } from '../../agents/claim-tagger-mvp/scripts/lib/notion-values.mjs';
import { checkPlan, newPlan } from '../../agents/claim-tagger-mvp/scripts/lib/plan.mjs';
import { builtConfig } from './helpers/config-fixture.mjs';
import { FIRST_PAGE_SPECS, TABLE_SPECS, restProps } from './helpers/tables.mjs';
import { createFakeNotion } from './fixtures/fake-notion.mjs';

const dirs = [];
after(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// ---- the decision rule (lib/first-page.mjs) ----------------------------------------------------------------------------------------------------

const TAGS = ['Context-dependent', 'Wordy', 'Unsourced'];
const ledger = (geo, tag, proposal, extra = {}) => ({ Key: `${geo}::${tag}`, Tag: tag, 'Agent proposal': proposal, 'Rulebook edition': '2026-10-29.1', 'Decided under': null, ...extra });
const claim = (geoId, extra = {}) => ({ geo_id: geoId, review_status: 'Reviewed', verified_tags: [], challenged_notes: null, agent_status: 'Done', tags_waiting: [], ...extra });

test('keyGeoId: the part of a Key before the last "::"', () => {
  assert.equal(keyGeoId('abc123::Context-dependent'), 'abc123');
  assert.equal(keyGeoId('abc123'), null);
  assert.equal(keyGeoId(null), null);
});

test('parseTagLines keeps the editor\'s words whole: a leading reason word stays, lines after a tag line belong to it, a rulebook tag the agent did not judge ends the line above', () => {
  const notes = 'Context-dependent: Rule unclear. The pronoun has no antecedent.\nIt could be either speaker.\nwordy: too long\nUnsourced: no link';
  const lines = parseTagLines(notes, TAGS);
  assert.equal(lines.get('Context-dependent'), 'Rule unclear. The pronoun has no antecedent.\nIt could be either speaker.');
  assert.equal(lines.get('Wordy'), 'too long');
  assert.equal(lines.get('Unsourced'), 'no link');
  assert.equal(parseTagLines('The agent was too eager.', TAGS), null);
  assert.equal(parseTagLines('Words before the first line.\nWordy: kept', TAGS).get('Wordy'), 'kept');
  assert.equal(parseTagLines('Words before the first line.\nWordy: kept', TAGS).size, 1, 'words before the first tag line belong to no tag');
  assert.equal(parseTagLines('Other: not a tag', TAGS), null);
});

test('decisions: a Reviewed claim with a tag line - the outcome from Verified tags (by name), the note is that line whole, other rows have no note', () => {
  const c = claim('g1', { verified_tags: ['Context-dependent'], challenged_notes: 'Context-dependent: Rule unclear. The pronoun has no antecedent.' });
  const rows = [ledger('g1', 'Context-dependent', 'Does not apply'), ledger('g1', 'Wordy', 'Does not apply')];
  assert.deepEqual(decisionsFor(c, rows, { tagNames: TAGS }), [
    { key: 'g1::Context-dependent', tag: 'Context-dependent', outcome: OUTCOME.applies, note: 'Rule unclear. The pronoun has no antecedent.', decided_under: '2026-10-29.1' },
    { key: 'g1::Wordy', tag: 'Wordy', outcome: OUTCOME.not, note: null, decided_under: '2026-10-29.1' },
  ]);
});

test('decisions: a note with no tag line goes to the rows the editor overruled, whole', () => {
  const c = claim('g2', { verified_tags: [], challenged_notes: '  Rule unclear. The agent was too eager. ' });
  const rows = [ledger('g2', 'Context-dependent', 'Applies'), ledger('g2', 'Wordy', 'Does not apply')];
  const d = decisionsFor(c, rows, { tagNames: TAGS });
  assert.equal(d[0].outcome, OUTCOME.not);
  assert.equal(d[0].note, 'Rule unclear. The agent was too eager.', 'a reason word is the editor\'s own words and stays');
  assert.equal(d[1].note, null);
});

test('decisions: an untagged note on a claim where the editor agreed with every row goes to all its rows, so no word is lost', () => {
  const c = claim('g3', { verified_tags: ['Context-dependent'], challenged_notes: 'Fine as it is.' });
  const rows = [ledger('g3', 'Context-dependent', 'Applies'), ledger('g3', 'Wordy', 'Does not apply')];
  assert.deepEqual(decisionsFor(c, rows, { tagNames: TAGS }).map((d) => d.note), ['Fine as it is.', 'Fine as it is.']);
});

test('decisions: an agreement with a tag line keeps the note on that row', () => {
  const c = claim('g4', { verified_tags: ['Context-dependent'], challenged_notes: 'Context-dependent: yes, clearly.' });
  const d = decisionsFor(c, [ledger('g4', 'Context-dependent', 'Applies')], { tagNames: TAGS });
  assert.equal(d[0].outcome, OUTCOME.applies);
  assert.equal(d[0].note, 'yes, clearly.');
});

test('decisions: To review, an empty Review status and any other value decide nothing; Decided under keeps the row\'s own edition when it is filled', () => {
  const rows = [ledger('g5', 'Context-dependent', 'Applies', { 'Decided under': '2026-10-01.1' })];
  assert.deepEqual(decisionsFor(claim('g5', { review_status: 'To review', verified_tags: ['Context-dependent'], challenged_notes: 'x' }), rows, { tagNames: TAGS }), []);
  assert.deepEqual(decisionsFor(claim('g5', { review_status: null, verified_tags: ['Context-dependent'] }), rows, { tagNames: TAGS }), []);
  assert.deepEqual(decisionsFor(claim('g5', { review_status: 'Something else' }), rows, { tagNames: TAGS }), []);
  assert.equal(decisionsFor(claim('g5', { verified_tags: ['Context-dependent'] }), rows, { tagNames: TAGS })[0].decided_under, '2026-10-01.1');
  assert.equal(decisionsFor(claim('g5'), [ledger('other', 'Wordy', 'Applies')], { tagNames: TAGS }).length, 0, 'rows of other claims are ignored');
});

test('per-row Agent status: Could not read first; a decided row disagrees only when the claim says so and the proposal differs; an undecided row waits when its tag waits or the claim is To review', () => {
  const decided = (outcome) => ({ outcome });
  // Could not read wins everywhere
  assert.equal(rowAgentStatus(claim('g', { agent_status: 'Could not read' }), ledger('g', 'Wordy', 'Applies'), decided('Applies')), STATUS.unread);
  assert.equal(rowAgentStatus(claim('g', { agent_status: 'Could not read', review_status: null }), ledger('g', 'Wordy', 'Applies'), null), STATUS.unread);
  // decided rows
  const disagreeing = claim('g', { agent_status: 'Disagrees with your decision' });
  assert.equal(rowAgentStatus(disagreeing, ledger('g', 'Context-dependent', 'Applies'), decided('Does not apply')), STATUS.disagrees);
  assert.equal(rowAgentStatus(disagreeing, ledger('g', 'Wordy', 'Does not apply'), decided('Does not apply')), STATUS.done, 'the agent agrees on this row');
  assert.equal(rowAgentStatus(claim('g', { agent_status: 'Waits for you' }), ledger('g', 'Wordy', 'Applies'), decided('Does not apply')), STATUS.done, 'a decided row never waits');
  assert.equal(rowAgentStatus(claim('g', { agent_status: 'Done' }), ledger('g', 'Wordy', 'Applies'), decided('Does not apply')), STATUS.done);
  // undecided rows
  const waiting = claim('g', { review_status: null, agent_status: 'Waits for you', tags_waiting: ['Context-dependent'] });
  assert.equal(rowAgentStatus(waiting, ledger('g', 'Context-dependent', 'Applies'), null), STATUS.waits);
  assert.equal(rowAgentStatus(waiting, ledger('g', 'Wordy', 'Does not apply'), null), STATUS.done, 'the tag does not wait');
  assert.equal(rowAgentStatus(claim('g', { review_status: null, agent_status: 'Done', tags_waiting: ['Wordy'] }), ledger('g', 'Wordy', 'Applies'), null), STATUS.done, 'waiting tags count only when the claim says it waits');
  const toReview = claim('g', { review_status: 'To review', agent_status: 'Done' });
  assert.equal(rowAgentStatus(toReview, ledger('g', 'Wordy', 'Does not apply'), null), STATUS.waits, 'a claim To review makes its undecided rows wait');
  assert.equal(rowAgentStatus(null, ledger('g', 'Wordy', 'Applies'), null), STATUS.done, 'a row with no claim');
});

// ---- a world: the first page's five tables and v2's five tables in one fake Notion ------------------------------------------------------------------

const hex = (prefix, n) => `${prefix}${String(n).padStart(32 - prefix.length, '0')}`;
const SRC = Object.fromEntries(['rulebook', 'claims', 'tag_decisions', 'rule_changes', 'agent_settings'].map((t, i) => [t, { db: hex('a1', i + 1), ds: hex('a2', i + 1) }]));
const TGT = Object.fromEntries(['rulebook', 'claims', 'tag_decisions', 'rule_changes', 'agent_settings'].map((t, i) => [t, { db: hex('b1', i + 1), ds: hex('b2', i + 1) }]));
const VIEW = "Agent's view of your decision";
const STATUS_OPTIONS = ['Waits for you', 'Done', 'Disagrees with your decision', 'Could not read'];

const targetSpecs = () => ({
  rulebook: TABLE_SPECS.rulebook,
  claims: {
    'Geo Name': 'title', 'Geo ID': 'rich_text', 'Geo URL': 'url', 'Geo Sources': 'rich_text', 'Geo Tags': 'multi_select', 'Geo Topics': 'rich_text',
    'Geo Space': { type: 'select', options: ['U.S. Politics', 'AI'] }, 'Geo Created': 'date', 'Geo Is factual': 'checkbox', 'Agent tags': { type: 'relation' },
    'Agent confidence': 'number', 'Agent reasons': 'rich_text', 'Agent status': { type: 'select', options: STATUS_OPTIONS }, 'Tags waiting': { type: 'relation' },
    'Agent edition': 'rich_text', 'Agent remarks': 'rich_text', [VIEW]: 'rich_text',
  },
  tag_decisions: {
    Claim: 'title', Key: 'rich_text', Tag: 'select', 'Agent proposal': 'select', 'Agent confidence': 'number', 'Agent reason': 'rich_text', 'Rulebook edition': 'rich_text',
    'Decided under': 'rich_text', Rule: 'rich_text', 'Read under': 'rich_text', [VIEW]: { type: 'select', options: ['Agent slip', 'Rule unclear', 'Rule should change'] },
    'Why the agent thinks so': 'rich_text', 'After the rule change': { type: 'select', options: ['Fixed', 'Still wrong'] }, 'Open claim': { type: 'relation', data_source_id: TGT.claims.ds },
    'Agent status': { type: 'select', options: STATUS_OPTIONS }, 'Agent is right': 'checkbox', 'Tag outcome': { type: 'select', options: ['Applies', 'Does not apply'] }, 'Your note': 'rich_text',
  },
  rule_changes: TABLE_SPECS.rule_changes,
  agent_settings: TABLE_SPECS.agent_settings,
});

/** The config of the v2 profile as the tests know it: the committed fixture, made v2 (no editor column on Claims, three on Tag decisions), pointed at the v2 tables. */
function v2Config() {
  const c = builtConfig();
  c.profile = 'v2';
  c.notion.root_parent_page_id = c.notion.parent_page_id;
  for (const k of ['verified', 'review_status', 'notes']) delete c.notion.claims.columns[k];
  c.editor_columns.claims = [];
  c.editor_columns.tag_decisions = ['Agent is right', 'Tag outcome', 'Your note'];
  const entries = { rulebook: c.notion.rulebook, claims: c.notion.claims, ...c.notion.databases };
  for (const [t, ids] of Object.entries(TGT)) Object.assign(entries[t], { database_id: ids.db, data_source_id: ids.ds });
  c.notion.requests_per_second = 1000;
  return c;
}

function firstPageFile() {
  const t = (name, key, extra = {}) => ({ database_id: SRC[name].db, data_source_id: SRC[name].ds, key, ...extra });
  return {
    made_from: 'tests',
    tables: {
      rulebook: t('rulebook', 'Name'),
      claims: t('claims', 'Geo ID', {
        columns: { claim: 'Geo Name', link: 'Geo URL', sources: 'Geo Sources', is_factual: 'Geo Is factual', verified: 'Verified tags', review_status: 'Review status', notes: 'Challenged tags notes' },
        write_columns: {
          tags: 'Agent tags', confidence: 'Agent confidence', reasons: 'Agent reasons', status: 'Agent status', waiting: 'Tags waiting', edition: 'Agent edition', remarks: 'Agent remarks', reading: 'Agent reading',
        },
      }),
      tag_decisions: t('tag_decisions', 'Key'),
      rule_changes: t('rule_changes', 'Lesson'),
      agent_settings: t('agent_settings', 'Name'),
    },
  };
}

const NOW = () => new Date(Date.UTC(2026, 9, 30, 22, 0, 0));
const noSleep = async () => {};

/**
 * A root folder with the v2 config and setup/first-page.json, a fake Notion with both sets of tables, the first page seeded:
 * g1 Reviewed with a tag line; g2 Reviewed with an untagged note on a disagreement; g3 To review; g4 never reviewed (CD waits); g5 could not be read; one ledger row with no claim.
 */
function makeWorld({ seed = true, configure = null, firstPage = null, targetOverride = null, sourceSpecs = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'geo-agents-copy-live-'));
  dirs.push(root);
  const config = v2Config();
  configure?.(config);
  mkdirSync(join(root, 'setup'), { recursive: true });
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(root, 'setup', 'first-page.json'), `${JSON.stringify(firstPage ?? firstPageFile(), null, 2)}\n`);

  const fake = createFakeNotion({ protected: [...config.notion.protected_database_ids, ...config.notion.protected_page_ids] });
  for (const t of Object.keys(SRC)) fake.addDatabase({ id: SRC[t].db, dataSourceId: SRC[t].ds, title: `first ${t}`, properties: restProps(sourceSpecs[t] ?? FIRST_PAGE_SPECS[t], SRC.rulebook.ds) });
  const specs = targetOverride ?? targetSpecs();
  for (const t of Object.keys(TGT)) fake.addDatabase({ id: TGT[t].db, dataSourceId: TGT[t].ds, title: `v2 ${t}`, properties: restProps(specs[t], TGT.rulebook.ds) });

  const w = {
    root, config, fake, tag: {}, claim: {},
    async run(argv, deps = {}) {
      const io = { outs: [], errs: [], out: (s) => io.outs.push(s), err: (s) => io.errs.push(s) };
      const code = await main(argv, io, { root, fetchImpl: fake.fetchImpl, token: fake.token, sleep: noSleep, now: NOW, ...deps });
      return { code, out: io.outs.join('\n'), err: io.errs.join('\n') };
    },
    rows: (side, table) => fake.plainRows((side === 'src' ? SRC : TGT)[table].db),
    row: (side, table, keyColumn, key) => w.rows(side, table).find((r) => r[keyColumn] === key),
    planOps: (id) => readFileSync(join(root, 'runs', 'copy-live', id, 'plan.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).slice(1),
    targetWrites: () => fake.writes(),
  };
  if (seed) seedFirstPage(w);
  return w;
}

function seedFirstPage(w, { skipLedger = false } = {}) {
  const { fake } = w;
  const rule = (name, extra = {}) => { w.tag[name] = fake.addRow(SRC.rulebook.db, { Name: name, Category: 'Meaning', 'Geo Status': 'Existing in Geo', Polarity: 'Issue', Status: 'Verified', 'Work tags': ['Issue'], ...extra }); };
  rule('Context-dependent', { 'When to use': '1. First rule.\n2. Second rule.', 'Verified on': '2026-09-10', Evidence: 'https://example.com/report', Counterpart: 'Self-contained' });
  rule('Wordy', { 'When to use': '' });
  rule('Unsourced');
  const tags = (names) => names.map((n) => w.tag[n]);
  const addClaim = (id, extra = {}) => {
    const { verified = [], agentTags = [], waiting = [], ...rest } = extra;
    w.claim[id] = fake.addRow(SRC.claims.db, {
      'Geo Name': `Claim ${id} text.`, 'Geo ID': id, 'Geo URL': `https://www.geobrowser.io/space/s/${id}`, 'Geo Space': 'AI', 'Geo Created': '2026-10-02', 'Geo Sources': `Source of ${id}`,
      'Geo Is factual': true, 'Geo Tags': ['Debate'], 'Geo Topics': 'Budget', 'Agent tags': tags(agentTags), 'Tags waiting': tags(waiting), 'Verified tags': tags(verified), ...rest,
    });
  };
  addClaim('g1', {
    verified: ['Context-dependent'], agentTags: ['Context-dependent'], 'Review status': 'Reviewed', 'Challenged tags notes': 'Context-dependent: Rule unclear. The pronoun has no antecedent.',
    'Agent status': 'Done', 'Agent confidence': 0.8, 'Agent reasons': 'Context-dependent: pronoun · rule 2 · 3 of 3 runs agree', 'Agent edition': '2026-10-29.1', 'Agent remarks': 'not checked: 2 tags without rules', 'Agent reading': 'Context-dependent: Rule unclear',
  });
  addClaim('g2', { 'Review status': 'Reviewed', 'Challenged tags notes': 'The agent was too eager.', 'Agent status': 'Disagrees with your decision', 'Agent confidence': 0.6 });
  addClaim('g3', { 'Review status': 'To review', 'Agent status': 'Waits for you', waiting: ['Context-dependent'], 'Agent confidence': 0.55 });
  addClaim('g4', { 'Agent status': 'Waits for you', waiting: ['Context-dependent'], 'Agent confidence': 0.7 });
  addClaim('g5', { 'Agent status': 'Could not read' });

  const row = (geo, tag, proposal, extra = {}) => fake.addRow(SRC.tag_decisions.db, {
    Claim: `Claim ${geo} text.`, Key: `${geo}::${tag}`, Tag: tag, 'Agent proposal': proposal, 'Agent confidence': 0.75, 'Agent reason': `reason for ${geo} ${tag}`, 'Rulebook edition': '2026-10-29.1', ...extra,
  });
  if (!skipLedger) row('g1', 'Context-dependent', 'Does not apply', {
    'Agent reading': 'Rule unclear', 'Reading note': 'The rule reads both ways.', 'Follow-up': 'Fixed', Rule: 'Context-dependent rule 2', 'Read under': '2026-10-29.1 · abc', 'Why wrong': 'Agent slip', 'Your reasoning': 'old words', 'Claim link': 'https://example.com/g1',
  });
  if (!skipLedger) row('g1', 'Wordy', 'Does not apply');
  row('g2', 'Context-dependent', 'Applies');
  row('g2', 'Wordy', 'Does not apply');
  row('g3', 'Context-dependent', 'Applies');
  row('g3', 'Wordy', 'Does not apply');
  row('g4', 'Context-dependent', 'Applies');
  row('g4', 'Wordy', 'Does not apply');
  row('g5', 'Context-dependent', "Can't tell");
  row('zz', 'Wordy', 'Applies'); // a ledger row whose claim is not in Claims

  fake.addRow(SRC.rule_changes.db, {
    Lesson: 'Say what a pronoun needs', Tag: 'Context-dependent', Rule: 'Context-dependent rule 2', Kind: 'Clarify wording', 'Current text': 'old', 'Proposed text': 'new', 'Safety check result': 'PASS: examples 11/11',
    'Supporting rows': 'Claim g1 · g1::Context-dependent', 'Editor wording': 'The editor words it this way.', Status: 'Approved',
  });
  fake.addRow(SRC.rule_changes.db, { Lesson: 'Second lesson', Tag: 'Wordy', Kind: 'Change the rule', 'Proposed text': 'text', Status: 'Proposed' });
  fake.addRow(SRC.agent_settings.db, { Name: 'Claim tagger', Paused: false, 'Rulebook edition': '2026-10-29.1', 'Last run summary': 'Tag · 29 Oct 09:00' });
}

const EXPECTED = { rulebook: 3, claims: 5, tag_decisions: 10, rule_changes: 2, agent_settings: 1 };
const RUN = 'run-a';

/** plan, apply, check on the world with a named run; asserts that all three finish. */
async function copyAll(w, id = RUN, flags = []) {
  const planned = await w.run(['plan', '--run-id', id, ...flags]);
  assert.equal(planned.code, 0, planned.err);
  const applied = await w.run(['apply', '--run', id]);
  assert.equal(applied.code, 0, applied.err + applied.out);
  const checked = await w.run(['check', '--run', id]);
  assert.equal(checked.code, 0, checked.err + checked.out);
  return { planned, applied, checked };
}

// ---- the mapping --------------------------------------------------------------------------------------------------------------------------------

test('plan is read only and says what it would do; apply creates every table\'s rows; check reads them back', async () => {
  const w = makeWorld();
  const before = w.fake.writes().length;
  const planned = await w.run(['plan', '--run-id', RUN]);
  assert.equal(planned.code, 0, planned.err);
  assert.equal(w.fake.writes().length, before, 'plan sent no write');
  assert.match(planned.out, /rulebook\s+source\s+3\s+create\s+3/);
  assert.match(planned.out, /claims\s+source\s+5\s+create\s+5/);
  assert.match(planned.out, /tag_decisions\s+source\s+10\s+create\s+10/);
  assert.match(planned.out, /warning: 1 row\(s\) of the first page's Tag decisions have no claim/);
  assert.ok(existsSync(join(w.root, 'runs', 'copy-live', RUN, 'plan.jsonl')));
  assert.ok(existsSync(join(w.root, 'runs', 'copy-live', RUN, 'summary.json')));
  assert.equal(w.rows('tgt', 'claims').length, 0, 'nothing in v2 yet');

  const applied = await w.run(['apply', '--run', RUN]);
  assert.equal(applied.code, 0, applied.err + applied.out);
  for (const [table, n] of Object.entries(EXPECTED)) assert.equal(w.rows('tgt', table).length, n, table);
  const checked = await w.run(['check', '--run', RUN]);
  assert.equal(checked.code, 0, checked.err + checked.out);
  assert.match(checked.out, /Every planned value is in v2/);
});

test('mapping: Rulebook by the same names; Claims with the Geo and agent columns, relations to the v2 Rulebook pages, Agent reading renamed', async () => {
  const w = makeWorld();
  await copyAll(w);
  const rb = (name) => w.row('tgt', 'rulebook', 'Name', name);
  const src = w.row('src', 'rulebook', 'Name', 'Context-dependent');
  for (const c of ['Category', 'Geo Status', 'Polarity', 'Status', 'Work tags', 'When to use', 'Verified on', 'Evidence', 'Counterpart']) assert.deepEqual(rb('Context-dependent')[c], src[c], c);
  assert.notEqual(rb('Context-dependent').page_id, src.page_id, 'a new page, not the first page\'s');

  const g1 = w.row('tgt', 'claims', 'Geo ID', 'g1');
  const s1 = w.row('src', 'claims', 'Geo ID', 'g1');
  for (const c of ['Geo Name', 'Geo ID', 'Geo URL', 'Geo Space', 'Geo Created', 'Geo Sources', 'Geo Is factual', 'Geo Tags', 'Geo Topics', 'Agent confidence', 'Agent reasons', 'Agent status', 'Agent edition', 'Agent remarks']) {
    assert.deepEqual(g1[c], s1[c], c);
  }
  assert.equal(g1[VIEW], 'Context-dependent: Rule unclear', 'first-page "Agent reading" is "Agent\'s view of your decision" on v2');
  assert.deepEqual(g1['Agent tags'], [rb('Context-dependent').page_id], 'a relation to the v2 Rulebook page of the same Name');
  assert.deepEqual(g1['Tags waiting'], []);
  assert.deepEqual(w.row('tgt', 'claims', 'Geo ID', 'g3')['Tags waiting'], [rb('Context-dependent').page_id]);
  assert.ok(!('Verified tags' in g1) && !('Review status' in g1) && !('Challenged tags notes' in g1), 'the first page\'s editor columns are not carried');
});

test('mapping: Tag decisions - the ledger columns, the renames, Open claim, the decision from the claim, Agent status per row, nothing dropped is written', async () => {
  const w = makeWorld();
  await copyAll(w);
  const td = (key) => w.row('tgt', 'tag_decisions', 'Key', key);
  const claimPage = (id) => w.row('tgt', 'claims', 'Geo ID', id).page_id;
  const a = td('g1::Context-dependent');
  assert.equal(a.Claim, 'Claim g1 text.');
  assert.equal(a.Tag, 'Context-dependent');
  assert.equal(a['Agent proposal'], 'Does not apply');
  assert.equal(a['Agent confidence'], 0.75);
  assert.equal(a['Agent reason'], 'reason for g1 Context-dependent');
  assert.equal(a['Rulebook edition'], '2026-10-29.1');
  assert.equal(a.Rule, 'Context-dependent rule 2');
  assert.equal(a['Read under'], '2026-10-29.1 · abc');
  assert.equal(a[VIEW], 'Rule unclear');
  assert.equal(a['Why the agent thinks so'], 'The rule reads both ways.');
  assert.equal(a['After the rule change'], 'Fixed');
  assert.deepEqual(a['Open claim'], [claimPage('g1')]);
  assert.equal(a['Tag outcome'], 'Applies');
  assert.equal(a['Your note'], 'Rule unclear. The pronoun has no antecedent.');
  assert.equal(a['Decided under'], '2026-10-29.1');
  assert.equal(a['Agent status'], 'Done');
  assert.equal(a['Agent is right'], false, 'the copy never sets Agent is right');

  assert.equal(td('g1::Wordy')['Tag outcome'], 'Does not apply');
  assert.equal(td('g1::Wordy')['Your note'], '');
  assert.equal(td('g2::Context-dependent')['Tag outcome'], 'Does not apply');
  assert.equal(td('g2::Context-dependent')['Your note'], 'The agent was too eager.', 'an untagged note on a disagreement goes to the overruled row');
  assert.equal(td('g2::Context-dependent')['Agent status'], 'Disagrees with your decision');
  assert.equal(td('g2::Wordy')['Your note'], '');
  assert.equal(td('g2::Wordy')['Agent status'], 'Done');
  // To review and never reviewed: no decision
  for (const key of ['g3::Context-dependent', 'g3::Wordy', 'g4::Context-dependent', 'g4::Wordy']) {
    assert.equal(td(key)['Tag outcome'], null, key);
    assert.equal(td(key)['Your note'], '', key);
  }
  assert.equal(td('g3::Context-dependent')['Agent status'], 'Waits for you');
  assert.equal(td('g3::Wordy')['Agent status'], 'Waits for you', 'a claim To review makes its undecided rows wait');
  assert.equal(td('g4::Context-dependent')['Agent status'], 'Waits for you');
  assert.equal(td('g4::Wordy')['Agent status'], 'Done');
  assert.equal(td('g5::Context-dependent')['Agent status'], 'Could not read');
  assert.deepEqual(td('zz::Wordy')['Open claim'], [], 'a ledger row with no claim has no Open claim');

  // the plan never mentions what the copy drops
  const allowed = new Set([...COPY_LIVE_COLUMNS.tag_decisions]);
  for (const op of w.planOps(RUN).filter((o) => o.table === 'tag_decisions')) for (const c of Object.keys(op.properties)) assert.ok(allowed.has(c), `${c} is a column of the copy`);
  for (const dropped of ['Why wrong', 'Your reasoning', 'Claim link', 'Claim page', 'Agent is right']) assert.ok(!w.planOps(RUN).some((o) => dropped in o.properties), dropped);
});

test('mapping: Rule changes column for column (Status Approved and Editor wording included) and Agent settings', async () => {
  const w = makeWorld();
  await copyAll(w);
  const one = w.row('tgt', 'rule_changes', 'Lesson', 'Say what a pronoun needs');
  const src = w.row('src', 'rule_changes', 'Lesson', 'Say what a pronoun needs');
  for (const c of COPY_LIVE_COLUMNS.rule_changes) assert.deepEqual(one[c], src[c], c);
  assert.equal(one.Status, 'Approved');
  assert.equal(one['Editor wording'], 'The editor words it this way.');
  assert.equal(w.row('tgt', 'rule_changes', 'Lesson', 'Second lesson').Status, 'Proposed');
  const settings = w.row('tgt', 'agent_settings', 'Name', 'Claim tagger');
  assert.equal(settings.Paused, false);
  assert.equal(settings['Rulebook edition'], '2026-10-29.1');
  assert.equal(settings['Last run summary'], 'Tag · 29 Oct 09:00');
});

test('the tables are written in order, and only the v2 tables are written: every write names a v2 database or a v2 page', async () => {
  const w = makeWorld();
  await copyAll(w);
  const targetDbs = new Set(Object.values(TGT).map((t) => normId(t.db)));
  const targetPages = new Set(Object.keys(TGT).flatMap((t) => w.rows('tgt', t).map((r) => normId(r.page_id))));
  const posts = w.fake.writes().filter((q) => q.method === 'POST');
  assert.ok(posts.length >= 21);
  const order = [];
  for (const q of w.fake.writes()) {
    if (q.method === 'POST' && q.path === '/pages') {
      assert.ok(targetDbs.has(normId(q.body.parent.database_id)), 'a create names a v2 database');
      order.push([...targetDbs].indexOf(normId(q.body.parent.database_id)));
    } else assert.ok(q.method === 'PATCH' && targetPages.has(normId(q.path.split('/')[2])), `${q.method} ${q.path} is a v2 page`);
  }
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'Rulebook, Claims, Tag decisions, Rule changes, Agent settings');
  // nothing was ever deleted or archived: the client has no such call
  assert.ok(w.fake.writes().every((q) => q.method === 'POST' || q.method === 'PATCH'));
  assert.ok(!w.fake.writes().some((q) => q.body && 'archived' in q.body), 'no archive flag');
});

// ---- keyed and re-runnable ---------------------------------------------------------------------------------------------------------------------

test('a re-run sends no write: the second plan has nothing to create or update, and its apply writes nothing', async () => {
  const w = makeWorld();
  await copyAll(w);
  const writes = w.fake.writes().length;
  const again = await w.run(['plan', '--run-id', 'run-b']);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /rulebook\s+source\s+3\s+create\s+0\s+update\s+0\s+same\s+3/);
  assert.match(again.out, /claims\s+source\s+5\s+create\s+0\s+update\s+0\s+same\s+5/);
  assert.match(again.out, /tag_decisions\s+source\s+10\s+create\s+0\s+update\s+0\s+same\s+10/);
  assert.equal(w.planOps('run-b').length, 0);
  const applied = await w.run(['apply', '--run', 'run-b']);
  assert.equal(applied.code, 0, applied.err);
  assert.equal(w.fake.writes().length, writes, 'no write at all');
  const rows = Object.fromEntries(Object.keys(EXPECTED).map((t) => [t, w.rows('tgt', t).length]));
  assert.deepEqual(rows, EXPECTED, 'no row was created twice');
});

test('removed claims (P51): the Geo IDs in setup/removed-claims.json are skipped with their Tag decisions rows, the plan says how many, and a re-sync does not bring them back', async () => {
  const w = makeWorld();
  const list = (ids) => writeFileSync(join(w.root, 'setup', 'removed-claims.json'), `${JSON.stringify({ removed: ids.map((geo_id) => ({ geo_id, run_id: 'remove-run-1', date: '2026-11-03' })) }, null, 2)}\n`);
  // g2 and g3 were removed from v2 (g2 in capitals: the Geo IDs are compared in one form), and so was a claim the first page does not have
  list(['G2', 'g3', 'g-not-on-the-first-page']);
  const planned = await w.run(['plan', '--run-id', RUN]);
  assert.equal(planned.code, 0, planned.err);
  assert.match(planned.out, /claims\s+source\s+3\s+create\s+3/, 'g1, g4 and g5');
  assert.match(planned.out, /tag_decisions\s+source\s+6\s+create\s+6/, 'the four rows of g2 and g3 are left out; the orphan row zz stays');
  assert.match(planned.out, /skipped \(removed claims, P51\): 2 Claims row\(s\) and 4 Tag decisions row\(s\) of the first page, because their Geo IDs are in setup\/removed-claims\.json \(3 listed;/);
  const ops = w.planOps(RUN);
  const keys = ops.filter((o) => o.table === 'claims').map((o) => o.key).sort();
  assert.deepEqual(keys, ['g1', 'g4', 'g5']);
  assert.deepEqual(ops.filter((o) => o.table === 'tag_decisions').map((o) => o.key).sort(), ['g1::Context-dependent', 'g1::Wordy', 'g4::Context-dependent', 'g4::Wordy', 'g5::Context-dependent', 'zz::Wordy']);
  const summary = JSON.parse(readFileSync(join(w.root, 'runs', 'copy-live', RUN, 'summary.json'), 'utf8'));
  assert.deepEqual(summary.removed, { listed: 3, claims: 2, tag_decisions: 4 });
  // the decisions read from the first page are those of the claims that stay
  assert.equal(summary.decided.claims, 1, 'g1 only: g2 was Reviewed but is gone');

  const applied = await w.run(['apply', '--run', RUN]);
  assert.equal(applied.code, 0, applied.err + applied.out);
  assert.deepEqual(w.rows('tgt', 'claims').map((r) => r['Geo ID']).sort(), ['g1', 'g4', 'g5']);
  assert.equal(w.rows('tgt', 'tag_decisions').length, 6);
  assert.equal((await w.run(['check', '--run', RUN])).code, 0);

  // a re-sync later: still nothing for them
  const writes = w.fake.writes().length;
  const again = await w.run(['plan', '--run-id', 'run-b']);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /claims\s+source\s+3\s+create\s+0\s+update\s+0\s+same\s+3/);
  assert.equal(w.planOps('run-b').length, 0, 'nothing to create: the removed claims are not brought back');
  assert.equal((await w.run(['apply', '--run', 'run-b'])).code, 0);
  assert.equal(w.fake.writes().length, writes);

  // restore takes the Geo IDs out of the list: the next plan creates them again
  list([]);
  const back = await w.run(['plan', '--run-id', 'run-c']);
  assert.equal(back.code, 0, back.err);
  assert.match(back.out, /claims\s+source\s+5\s+create\s+2/);
  assert.doesNotMatch(back.out, /skipped \(removed claims/, 'an empty list says nothing');
});

test('removed claims (P51): a list that cannot be read stops the plan (exit 2) before it writes; without the file nothing is skipped and the plan says nothing about it', async () => {
  const w = makeWorld();
  writeFileSync(join(w.root, 'setup', 'removed-claims.json'), '{ "removed": "g1" }');
  const writes = w.fake.writes().length;
  const bad = await w.run(['plan', '--run-id', RUN]);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /removed-claims\.json is not valid/);
  assert.equal(w.fake.writes().length, writes);
  assert.equal(existsSync(join(w.root, 'runs', 'copy-live', RUN, 'plan.jsonl')), false);
  rmSync(join(w.root, 'setup', 'removed-claims.json'));
  const fine = await w.run(['plan', '--run-id', 'run-b']);
  assert.equal(fine.code, 0, fine.err);
  assert.match(fine.out, /claims\s+source\s+5\s+create\s+5/);
  assert.doesNotMatch(fine.out, /skipped \(removed claims/);
  assert.deepEqual(JSON.parse(readFileSync(join(w.root, 'runs', 'copy-live', 'run-b', 'summary.json'), 'utf8')).removed, { listed: 0, claims: 0, tag_decisions: 0 });
});

test('a re-run after the loop changed agent columns plans nothing for them; a new first-page row is still created', async () => {
  const w = makeWorld();
  await copyAll(w);
  // the loop works on v2: agent columns, editions and Decided under move on v2 rows
  const td = (key) => w.row('tgt', 'tag_decisions', 'Key', key);
  w.fake.editRow(td('g1::Wordy').page_id, { 'Agent proposal': 'Applies', 'Rulebook edition': '2026-10-30.1', 'Agent status': 'Done', 'Decided under': '2026-10-30.1 · agreed Applies' });
  w.fake.editRow(w.row('tgt', 'rulebook', 'Name', 'Wordy').page_id, { 'When to use': 'a promoted rule' });
  w.fake.editRow(w.row('tgt', 'agent_settings', 'Name', 'Claim tagger').page_id, { 'Rulebook edition': '2026-10-30.1' });
  w.fake.editRow(w.row('tgt', 'claims', 'Geo ID', 'g1').page_id, { 'Agent edition': '2026-10-30.1', 'Agent status': 'Waits for you' });
  // the first page moved too, in the agent columns: none of it is carried
  w.fake.editRow(w.claim.g1, { 'Agent reasons': 'a newer reason', 'Agent confidence': 0.91 });
  w.fake.addRow(SRC.rule_changes.db, { Lesson: 'Third lesson', Tag: 'Wordy', Status: 'Proposed' });
  const planned = await w.run(['plan', '--run-id', 'run-b']);
  assert.equal(planned.code, 0, planned.err);
  assert.deepEqual(w.planOps('run-b').map((o) => `${o.op} ${o.table} ${o.key}`), ['create rule_changes Third lesson']);
  assert.match(planned.out, /claims\s+source\s+5\s+create\s+0\s+update\s+0\s+same\s+5/);
  const applied = await w.run(['apply', '--run', 'run-b']);
  assert.equal(applied.code, 0, applied.err);
  assert.equal(w.rows('tgt', 'rule_changes').length, 3);
  assert.equal(w.row('tgt', 'claims', 'Geo ID', 'g1')['Agent reasons'], 'Context-dependent: pronoun · rule 2 · 3 of 3 runs agree');
  assert.equal(td('g1::Wordy')['Rulebook edition'], '2026-10-30.1');
  assert.equal(td('g1::Wordy')['Decided under'], '2026-10-30.1 · agreed Applies');
  assert.equal(w.row('tgt', 'rulebook', 'Name', 'Wordy')['When to use'], 'a promoted rule');
});

test('a new first-page decision is carried to the v2 row that has none; only editor columns are written; a decided row is not moved again', async () => {
  const w = makeWorld();
  await copyAll(w);
  const td = (key) => w.row('tgt', 'tag_decisions', 'Key', key);
  assert.equal(td('g4::Context-dependent')['Tag outcome'], null);
  w.fake.editRow(w.claim.g4, { 'Review status': 'Reviewed', 'Verified tags': [w.tag['Context-dependent']], 'Challenged tags notes': 'Context-dependent: needs the antecedent.', 'Agent status': 'Done' });
  const planned = await w.run(['plan', '--run-id', 'run-b']);
  assert.equal(planned.code, 0, planned.err);
  const ops = w.planOps('run-b');
  const op = ops.find((o) => o.key === 'g4::Context-dependent');
  assert.ok(op, JSON.stringify(ops.map((o) => o.key)));
  assert.equal(op.op, 'update');
  assert.equal(op.properties['Tag outcome'], 'Applies');
  for (const o of ops.filter((x) => x.op === 'update')) {
    assert.ok(Object.keys(o.properties).every((c) => ['Tag outcome', 'Your note', 'Decided under'].includes(c)), `${o.key}: ${Object.keys(o.properties)}`);
  }
  const applied = await w.run(['apply', '--run', 'run-b']);
  assert.equal(applied.code, 0, applied.err);
  assert.equal(td('g4::Context-dependent')['Tag outcome'], 'Applies');
  const checked = await w.run(['check', '--run', 'run-b']);
  assert.equal(checked.code, 0, checked.err);
  // the loop restamps Decided under; a later re-run leaves it
  w.fake.editRow(td('g4::Context-dependent').page_id, { 'Decided under': '2026-10-30.1 · agreed Applies' });
  const again = await w.run(['plan', '--run-id', 'run-c']);
  assert.equal(again.code, 0, again.err);
  assert.deepEqual(w.planOps('run-c').filter((o) => o.key === 'g4::Context-dependent'), []);
});

// ---- editor values ----------------------------------------------------------------------------------------------------------------------------

test('a non-empty editor value of v2 that differs from the source is a conflict: kept, reported, never written; the other columns still update; Agent is right is never touched', async () => {
  const w = makeWorld();
  await copyAll(w);
  const td = (key) => w.row('tgt', 'tag_decisions', 'Key', key);
  w.fake.editRow(td('g1::Context-dependent').page_id, { 'Tag outcome': 'Does not apply', 'Your note': 'my own words', 'Agent is right': true });
  w.fake.editRow(td('g3::Context-dependent').page_id, { 'Tag outcome': 'Applies' }); // decided on v2, undecided on the first page
  w.fake.editRow(td('g1::Wordy').page_id, { 'Agent is right': true });

  const planned = await w.run(['plan', '--run-id', 'run-b']);
  assert.equal(planned.code, 0, planned.err);
  assert.match(planned.out, /3 editor value\(s\) on v2 differ from the first page and are kept/);
  assert.match(planned.out, /tag_decisions "g1::Context-dependent" Tag outcome: v2 "Does not apply" \/ first page "Applies" \(different\)/);
  assert.match(planned.out, /"g3::Context-dependent" Tag outcome: v2 "Applies" \/ first page null \(source is empty\)/);
  const summary = JSON.parse(readFileSync(join(w.root, 'runs', 'copy-live', 'run-b', 'summary.json'), 'utf8'));
  assert.deepEqual(summary.conflicts.map((c) => `${c.key} ${c.column}`).sort(), ['g1::Context-dependent Tag outcome', 'g1::Context-dependent Your note', 'g3::Context-dependent Tag outcome']);

  const ops = w.planOps('run-b');
  assert.deepEqual(ops, [], 'the editor values are kept and nothing else is carried');

  const applied = await w.run(['apply', '--run', 'run-b']);
  assert.equal(applied.code, 0, applied.err);
  assert.equal(td('g1::Context-dependent')['Tag outcome'], 'Does not apply');
  assert.equal(td('g1::Context-dependent')['Your note'], 'my own words');
  assert.equal(td('g1::Context-dependent')['Agent is right'], true);
  assert.equal(td('g3::Context-dependent')['Tag outcome'], 'Applies');
  assert.equal(td('g1::Wordy')['Agent is right'], true);
});

test('--overwrite-editor-values forces a differing value, with expect on it, and still never blanks an editor\'s value', async () => {
  const w = makeWorld();
  await copyAll(w);
  const td = (key) => w.row('tgt', 'tag_decisions', 'Key', key);
  w.fake.editRow(td('g1::Context-dependent').page_id, { 'Tag outcome': 'Does not apply', 'Your note': 'my own words' });
  w.fake.editRow(td('g3::Context-dependent').page_id, { 'Tag outcome': 'Applies' });
  const planned = await w.run(['plan', '--run-id', 'run-b', '--overwrite-editor-values']);
  assert.equal(planned.code, 0, planned.err);
  const update = w.planOps('run-b').find((o) => o.table === 'tag_decisions');
  assert.equal(update.key, 'g1::Context-dependent');
  assert.deepEqual(update.properties, { 'Tag outcome': 'Applies', 'Your note': 'Rule unclear. The pronoun has no antecedent.' });
  assert.deepEqual(update.expect, { 'Tag outcome': 'Does not apply', 'Your note': 'my own words' }, 'the op is skipped if an editor writes again before the apply');
  assert.match(planned.out, /1 editor value\(s\) on v2 differ/, 'the value the source does not have is still kept');
  assert.match(planned.out, /"g3::Context-dependent" Tag outcome.*source is empty/);
  const applied = await w.run(['apply', '--run', 'run-b']);
  assert.equal(applied.code, 0, applied.err);
  assert.equal(td('g1::Context-dependent')['Tag outcome'], 'Applies');
  assert.equal(td('g3::Context-dependent')['Tag outcome'], 'Applies');
  const checked = await w.run(['check', '--run', 'run-b']);
  assert.equal(checked.code, 0, checked.err);
});

test('an editor who writes between the plan and the apply is not overwritten: the op is skipped, apply says to plan again (exit 1)', async () => {
  const w = makeWorld();
  await copyAll(w);
  const td = (key) => w.row('tgt', 'tag_decisions', 'Key', key);
  w.fake.editRow(td('g1::Context-dependent').page_id, { 'Tag outcome': 'Does not apply' });
  const planned = await w.run(['plan', '--run-id', 'run-b', '--overwrite-editor-values']);
  assert.equal(planned.code, 0, planned.err);
  w.fake.editRow(td('g1::Context-dependent').page_id, { 'Your note': 'written meanwhile', 'Tag outcome': 'Applies' });
  const applied = await w.run(['apply', '--run', 'run-b']);
  assert.equal(applied.code, 1, applied.out);
  assert.match(applied.out, /1 skipped because the row changed since the plan/);
  assert.match(applied.out, /make a new plan/);
  assert.equal(td('g1::Context-dependent')['Your note'], 'written meanwhile');
});

test('Editor wording, an Approved or Rejected Status and Paused on v2 are editor values too', async () => {
  const w = makeWorld();
  await copyAll(w);
  const lesson = () => w.row('tgt', 'rule_changes', 'Lesson', 'Say what a pronoun needs');
  const second = () => w.row('tgt', 'rule_changes', 'Lesson', 'Second lesson');
  w.fake.editRow(lesson().page_id, { 'Editor wording': 'the rule owner rewrote it' });
  w.fake.editRow(second().page_id, { Status: 'Rejected' });
  w.fake.editRow(w.row('tgt', 'agent_settings', 'Name', 'Claim tagger').page_id, { Paused: true });
  w.fake.editRow(w.row('src', 'rule_changes', 'Lesson', 'Second lesson').page_id, { Status: 'Live' }); // the first page moved on
  w.fake.editRow(w.row('src', 'rule_changes', 'Lesson', 'Say what a pronoun needs').page_id, { Status: 'Live' }); // v2 holds Approved (an editor value only when Approved or Rejected)
  const paused = await w.run(['plan', '--run-id', 'run-b']);
  assert.equal(paused.code, 3, 'Paused on v2 stops the copy');
  w.fake.editRow(w.row('tgt', 'agent_settings', 'Name', 'Claim tagger').page_id, { Paused: false });
  const planned = await w.run(['plan', '--run-id', 'run-c']);
  assert.equal(planned.code, 0, planned.err);
  const summary = JSON.parse(readFileSync(join(w.root, 'runs', 'copy-live', 'run-c', 'summary.json'), 'utf8'));
  assert.deepEqual(summary.conflicts.map((c) => `${c.key} ${c.column}`).sort(), ['Say what a pronoun needs Editor wording']);
  assert.equal(w.planOps('run-c').length, 0, 'a first-page Status other than Approved or Rejected is not an editor word, so it carries nothing');
});

// ---- refusals ---------------------------------------------------------------------------------------------------------------------------------

test('refuses a target that is not the v2 profile, before any request', async () => {
  const w = makeWorld({ configure: (c) => { delete c.profile; delete c.notion.root_parent_page_id; c.editor_columns.claims = ['Verified tags', 'Review status', 'Challenged tags notes']; Object.assign(c.notion.claims.columns, { verified: 'Verified tags', review_status: 'Review status', notes: 'Challenged tags notes' }); } });
  assert.notDeepEqual(validateConfig(JSON.parse(readFileSync(join(w.root, 'config.json'), 'utf8'))).errors, [], 'a per-claim config is not a valid config any more (P48), so the script stops on it');
  for (const command of ['plan', 'apply', 'check']) {
    const r = await w.run([command]);
    assert.equal(r.code, 2, command);
    assert.match(r.err, /not the v2 profile|expected "v2"/);
  }
  assert.equal(w.fake.requests.length, 0);
});

test('refuses ids that are in both setup/first-page.json and the target config, before any request', async () => {
  const bad = firstPageFile();
  bad.tables.claims.database_id = TGT.claims.db; // the first page's Claims is v2's Claims
  const w = makeWorld({ firstPage: bad });
  const r = await w.run(['plan']);
  assert.equal(r.code, 2);
  assert.match(r.err, /also in setup\/first-page\.json/);
  assert.equal(w.fake.requests.length, 0);
  const sameDataSource = firstPageFile();
  sameDataSource.tables.rulebook.data_source_id = TGT.rulebook.ds;
  const w2 = makeWorld({ firstPage: sameDataSource });
  assert.equal((await w2.run(['plan'])).code, 2);
  assert.equal(w2.fake.requests.length, 0);
});

test('runs/PAUSED stops plan and apply (exit 3) without a request; Paused in the v2 Agent settings stops them too', async () => {
  const w = makeWorld();
  mkdirSync(join(w.root, 'runs'), { recursive: true });
  writeFileSync(join(w.root, 'runs', 'PAUSED'), '');
  const stopped = await w.run(['plan']);
  assert.equal(stopped.code, 3);
  assert.equal(w.fake.requests.length, 0);
  rmSync(join(w.root, 'runs', 'PAUSED'));

  const planned = await w.run(['plan', '--run-id', RUN]);
  assert.equal(planned.code, 0, planned.err);
  const id = w.fake.addRow(TGT.agent_settings.db, { Name: 'Claim tagger', Paused: true });
  const writes = w.fake.writes().length;
  assert.equal((await w.run(['apply', '--run', RUN])).code, 3);
  assert.equal((await w.run(['plan', '--run-id', 'run-b'])).code, 3);
  assert.equal(w.fake.writes().length, writes);
  w.fake.editRow(id, { Paused: false });
  assert.equal((await w.run(['apply', '--run', RUN])).code, 0);
});

test('a column that is missing on either side stops the plan with its name, and so do repeated keys; nothing is written', async () => {
  // v2 lacks "Open claim"
  const specs = targetSpecs();
  delete specs.tag_decisions['Open claim'];
  const w = makeWorld({ seed: false, targetOverride: specs });
  seedFirstPage(w);
  const noColumn = await w.run(['plan']);
  assert.equal(noColumn.code, 2);
  assert.match(noColumn.err, /v2 tag decisions table has no column "Open claim"/);

  // the first page lacks "Reading note"
  const first = { ...FIRST_PAGE_SPECS.tag_decisions };
  delete first['Reading note'];
  const w2 = makeWorld({ seed: false, sourceSpecs: { tag_decisions: first } });
  seedFirstPage(w2, { skipLedger: true });
  const noSource = await w2.run(['plan']);
  assert.equal(noSource.code, 2);
  assert.match(noSource.err, /first page's Tag decisions has no column "Reading note"/);

  // a Geo ID on two rows of the first page
  const w3 = makeWorld();
  w3.fake.addRow(SRC.claims.db, { 'Geo Name': 'again', 'Geo ID': 'g1' });
  const twice = await w3.run(['plan', '--run-id', 'run-b']);
  assert.equal(twice.code, 2);
  assert.match(twice.err, /Geo ID value\(s\) on more than one row/);
  for (const world of [w, w2, w3]) assert.equal(world.fake.writes().length, 0);
});

test('apply and check refuse a plan that is not a copy-live plan, an invalid plan, and a missing plan', async () => {
  const w = makeWorld();
  assert.equal((await w.run(['apply'])).code, 2, 'no plan yet');
  assert.equal((await w.run(['apply', '--run', 'nope'])).code, 2);
  await w.run(['plan', '--run-id', RUN]);
  const file = join(w.root, 'runs', 'copy-live', RUN, 'plan.jsonl');
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const header = JSON.parse(lines[0]);
  header.plan.script = 'tag';
  writeFileSync(file, `${[JSON.stringify(header), ...lines.slice(1)].join('\n')}\n`);
  const r = await w.run(['apply', '--run', RUN]);
  assert.equal(r.code, 2);
  assert.match(r.err, /not made by copy-live/);
  writeFileSync(file, `${lines.slice(0, 5).join('\n')}\n{"op":"delete","table":"claims","key":"x","properties":{}}\n`);
  assert.equal((await w.run(['apply', '--run', RUN])).code, 2, 'a plan with a line that is not an op is refused');
  assert.equal(w.rows('tgt', 'rulebook').length, 0);
});

test('--overwrite-editor-values belongs to plan; flags are checked per command', async () => {
  const w = makeWorld();
  await w.run(['plan', '--run-id', RUN]);
  assert.equal((await w.run(['apply', '--run', RUN, '--overwrite-editor-values'])).code, 2);
  assert.equal((await w.run(['check', '--run', RUN, '--overwrite-editor-values'])).code, 2);
  assert.equal((await w.run(['plan', '--run', RUN])).code, 2);
  assert.equal((await w.run(['apply', '--run-id', RUN])).code, 2);
  assert.equal((await w.run(['bogus'])).code, 2);
  assert.equal((await w.run([])).code, 2);
  const help = await w.run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /usage: node agents\/claim-tagger-mvp\/scripts\/copy-live\.mjs/);
  assert.equal(w.rows('tgt', 'rulebook').length, 0);
});

// ---- resumable ----------------------------------------------------------------------------------------------------------------------------------

test('apply is resumable: a create whose answer was lost is found by its key on the next start, nothing is created twice, every created page id is in the stage ledger', async () => {
  const w = makeWorld();
  assert.equal((await w.run(['plan', '--run-id', RUN])).code, 0);
  // the 5th create (a Claims row) reaches Notion, but the answer is lost
  w.fake.failNext('POST', /^\/pages$/, 500, 1, { applied: true });
  const first = await w.run(['apply', '--run', RUN]);
  assert.equal(first.code, 1, first.out + first.err);
  assert.match(first.out, /run the same command again/);
  assert.equal(w.rows('tgt', 'claims').length, 0, 'the stopped stage was the Rulebook');
  assert.equal(w.rows('tgt', 'rulebook').length, 1, 'the lost create did land');
  const second = await w.run(['apply', '--run', RUN]);
  assert.equal(second.code, 0, second.out + second.err);
  for (const [table, n] of Object.entries(EXPECTED)) assert.equal(w.rows('tgt', table).length, n, `${table}: nothing created twice`);
  assert.equal((await w.run(['check', '--run', RUN])).code, 0);

  const stages = join(w.root, 'runs', 'copy-live', RUN, 'stages');
  const creates = readdirSync(stages).flatMap((s) => readFileSync(join(stages, s, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
    .filter((l) => l.op === 'create' && l.status === 'done');
  assert.equal(creates.length, Object.values(EXPECTED).reduce((a, b) => a + b, 0));
  assert.ok(creates.every((l) => typeof l.page_id === 'string' && l.page_id !== ''), 'each page id was recorded when it was created');
  const third = await w.run(['apply', '--run', RUN]);
  assert.equal(third.code, 0);
  const created = w.fake.writes().filter((q) => q.method === 'POST' && q.path === '/pages' && q.status === 200).length;
  assert.equal(created, 20, '20 creates were answered; the lost one was found and finished as an update; a third start sent nothing new');
});

test('apply stops at the first stage that does not finish and a later start goes on from there', async () => {
  const w = makeWorld();
  assert.equal((await w.run(['plan', '--run-id', RUN])).code, 0);
  w.fake.failNext('POST', /^\/pages$/, 400, 3, { message: 'refused' });
  const first = await w.run(['apply', '--run', RUN]);
  assert.equal(first.code, 1);
  assert.match(first.out, /NOT FINISHED: 3 failed/);
  assert.equal(w.rows('tgt', 'claims').length, 0, 'the later tables were not started');
  assert.equal((await w.run(['apply', '--run', RUN])).code, 0);
  for (const [table, n] of Object.entries(EXPECTED)) assert.equal(w.rows('tgt', table).length, n, table);
});

test('check finds a value that differs from the plan (exit 2) and a row that is missing', async () => {
  const w = makeWorld();
  await copyAll(w);
  w.fake.editRow(w.row('tgt', 'claims', 'Geo ID', 'g2').page_id, { 'Agent confidence': 0.99 });
  w.fake.editRow(w.row('tgt', 'tag_decisions', 'Key', 'g2::Context-dependent').page_id, { 'Tag outcome': 'Applies' });
  const r = await w.run(['check', '--run', RUN]);
  assert.equal(r.code, 2);
  assert.match(r.out, /claims "g2" Agent confidence: planned 0\.6, found 0\.99/);
  assert.match(r.out, /tag_decisions "g2::Context-dependent" Tag outcome/);
});

// ---- readFirstPage ---------------------------------------------------------------------------------------------------------------------------

test('readFirstPage: the committed setup/first-page.json describes five tables and the claims columns, and names none of them as v2\'s', () => {
  const root = mkdtempSync(join(tmpdir(), 'geo-agents-copy-live-'));
  dirs.push(root);
  const doc = readFirstPage(root); // the root has no copy, so the agent folder's file is read
  assert.deepEqual(Object.keys(doc.tables), ['rulebook', 'claims', 'tag_decisions', 'rule_changes', 'agent_settings']);
  assert.equal(doc.tables.claims.key, 'Geo ID');
  assert.equal(doc.tables.claims.write_columns.reading, 'Agent reading');
  assert.equal(doc.tables.tag_decisions.key, 'Key');
  const v2 = JSON.parse(readFileSync(new URL('../../agents/claim-tagger-mvp/config.json', import.meta.url), 'utf8'));
  const ids = new Set(Object.values(doc.tables).flatMap((t) => [t.database_id, t.data_source_id]).map(normId));
  const mine = [v2.notion.rulebook, v2.notion.claims, ...Object.values(v2.notion.databases)].flatMap((t) => [t.database_id, t.data_source_id]).map(normId);
  assert.deepEqual(mine.filter((i) => ids.has(i)), [], 'the two are disjoint');
});

// ---- the allowance in lib/plan.mjs ----------------------------------------------------------------------------------------------------------

const copyPlan = (config, script = 'copy-live') => newPlan({ runId: 'r', script, rubricEdition: null, config });

test('plan.mjs: a plan of the script "copy-live" may create and update rows of the five v2 tables, the editor columns included', () => {
  const config = v2Config();
  const p = copyPlan(config);
  p.create('rulebook', 'Wordy', { Name: 'Wordy', 'When to use': '1. x' });
  p.create('claims', 'g1', { 'Geo ID': 'g1', 'Geo Name': 'c', 'Agent tags': ['Wordy'], [VIEW]: 'x', 'Agent status': 'Done' });
  p.create('tag_decisions', 'g1::Wordy', { Key: 'g1::Wordy', Claim: 'c', 'Tag outcome': 'Applies', 'Your note': 'n', 'Open claim': ['g1'], [VIEW]: 'Agent slip', 'After the rule change': 'Fixed' });
  p.update('tag_decisions', 'g2::Wordy', '0a9e0000-0000-4000-8000-000000000001', { 'Tag outcome': 'Does not apply', 'Your note': null }, { expect: { 'Tag outcome': 'Applies' } });
  p.create('rule_changes', 'L', { Lesson: 'L', Status: 'Approved', 'Editor wording': 'w' });
  p.update('rule_changes', 'M', '0a9e0000-0000-4000-8000-000000000002', { Status: 'Rejected' });
  p.update('agent_settings', 'Claim tagger', '0a9e0000-0000-4000-8000-000000000003', { Paused: true });
  const r = checkPlan(p, config, { root: 'x' });
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
});

test('plan.mjs: the same plan under another script name is still refused (the editor columns, Status Approved, a claims create)', () => {
  const config = v2Config();
  const p = copyPlan(config, 'tag');
  p.create('tag_decisions', 'g1::Wordy', { Key: 'g1::Wordy', 'Tag outcome': 'Applies' });
  p.create('rule_changes', 'L', { Lesson: 'L', Status: 'Approved' });
  p.create('claims', 'g1', { 'Geo ID': 'g1', 'Geo Name': 'c' });
  const r = checkPlan(p, config, { root: 'x' });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((m) => /"Tag outcome" is a column only an editor writes/.test(m)));
  assert.ok(r.problems.some((m) => /Status "Approved" is not one a script may write/.test(m)));
  assert.ok(r.problems.some((m) => /claims table is created only by setup or by the add script/.test(m)));
});

test('plan.mjs: a copy-live plan never writes Agent is right, a column outside its list, the first page\'s editor columns or page content', () => {
  const config = v2Config();
  const p = copyPlan(config);
  p.create('tag_decisions', 'g1::Wordy', { Key: 'g1::Wordy', 'Agent is right': true });
  p.create('claims', 'g1', { 'Geo ID': 'g1', 'Verified tags': ['x'], 'Review status': 'Reviewed' });
  p.create('rulebook', 'Wordy', { Name: 'Wordy', Created: 'x' }, { children: [{ type: 'paragraph' }] });
  const r = checkPlan(p, config, { root: 'x' });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((m) => /"Agent is right" is not a column this plan may write to tag_decisions/.test(m)));
  assert.ok(r.problems.some((m) => /"Verified tags" is not a column this plan may write to claims/.test(m)));
  assert.ok(r.problems.some((m) => /"Review status" is not a column this plan may write to claims/.test(m)));
  assert.ok(r.problems.some((m) => /"Created" is not a column this plan may write to rulebook/.test(m)));
  assert.ok(r.problems.some((m) => /writes no page content/.test(m)));
});

test('plan.mjs: a copy-live plan is refused on a config that is not the v2 profile', () => {
  const production = builtConfig();
  delete production.profile; // the fixture is the v2 shape now (P48); a config without the profile is the one the copy must refuse
  const p = copyPlan(production);
  p.create('rule_changes', 'L', { Lesson: 'L' });
  const r = checkPlan(p, production, { root: 'x' });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((m) => /may only be checked against the v2 profile/.test(m)));
});

test('plan.mjs: a copy-live plan is refused when it names a protected id or a protected table, and a delete is no op at all', () => {
  const config = v2Config();
  const protectedId = config.notion.protected_database_ids.find((id) => normId(id).length >= 32);
  const p = copyPlan(config);
  p.create('rule_changes', 'L', { Lesson: 'L', Rule: `see ${protectedId}` });
  p.create('claims', 'g1', { 'Geo ID': 'g1', 'Open claim': undefined, 'Agent remarks': protectedId.replace(/-/g, '') });
  const hit = checkPlan(p, config, { root: 'x' });
  assert.equal(hit.ok, false);
  assert.ok(hit.problems.some((m) => /mentions a protected id/.test(m)));

  const guarded = v2Config();
  guarded.notion.protected_database_ids.push(TGT.rule_changes.db); // not a config the loader accepts, but the check must hold anyway
  const q = copyPlan(guarded);
  q.create('rule_changes', 'L', { Lesson: 'L' });
  const refused = checkPlan(q, guarded, { root: 'x' });
  assert.equal(refused.ok, false);
  assert.ok(refused.problems.some((m) => /protected lists of config\.json, so it is never written/.test(m)));

  const del = { header: () => ({ plan: { run_id: 'r', script: 'copy-live', created_at: '2026-10-30T22:00:00.000Z', rubric_edition: null, counts: { creates: 0, updates: 0 } } }), ops: [{ op: 'delete', table: 'claims', key: 'g1', properties: {} }] };
  const gone = checkPlan(del, config, { root: 'x' });
  assert.equal(gone.ok, false);
  assert.ok(gone.problems.some((m) => /op must be "create" or "update"/.test(m)));
});

test('plan.mjs: the add script keeps its own allowance and a copy-live plan\'s columns are named under the v2 names', () => {
  const config = v2Config();
  const add = newPlan({ runId: 'r', script: 'add', rubricEdition: null, config });
  add.create('claims', 'g1', { 'Geo ID': 'g1', 'Geo Name': 'c' });
  assert.equal(checkPlan(add, config, { root: 'x' }).ok, true);
  const bad = newPlan({ runId: 'r', script: 'add', rubricEdition: null, config });
  bad.create('tag_decisions', 'k', { Key: 'k' });
  assert.equal(checkPlan(bad, config, { root: 'x' }).ok, false);
  assert.ok(COPY_LIVE_COLUMNS.claims.includes(VIEW) && !COPY_LIVE_COLUMNS.claims.includes('Agent reading'));
  assert.ok(!COPY_LIVE_COLUMNS.tag_decisions.includes('Agent is right'));
});
