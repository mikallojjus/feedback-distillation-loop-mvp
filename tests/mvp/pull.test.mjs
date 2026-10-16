import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../../agents/claim-tagger-mvp/scripts/lib/exit-codes.mjs';
import { countRequests, createClient } from '../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';
import { applyPlan, newPlan } from '../../agents/claim-tagger-mvp/scripts/lib/plan.mjs';
import { buildRubric, writeEdition } from '../../agents/claim-tagger-mvp/scripts/lib/rubric.mjs';
import {
  LESSON_COLUMNS, QUEUE_COLUMNS, geoSourceLinks, latestPullId, loadPull, main, pickClaims, readOnlyFetch, richTextLinks, supportingKeys, tablesFor,
} from '../../agents/claim-tagger-mvp/scripts/pull.mjs';
import { createFakeNotion } from './fixtures/fake-notion.mjs';
import { placeholderConfig } from './helpers/config-fixture.mjs';
import { TABLE_SPECS, realClaimsSpec, restProps } from './helpers/tables.mjs';

// Every test runs the real client against the shared in-memory Notion, in a temporary state folder. The token is the fake's own, passed in:
// nothing here reads the repository's .env.

const AUDIT_FILE = fileURLToPath(new URL('../../docs/mvp-2026-11/evidence/03-audit-context-dependent-decisions.json', import.meta.url));
const AUDIT_IDS = JSON.parse(readFileSync(AUDIT_FILE, 'utf8')).decisions.map((d) => d.geo_id);
const FIXTURE_RULEBOOK = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/rulebook-rows.json', import.meta.url)), 'utf8'));
const NOW = () => new Date('2026-10-15T10:00:00.000Z');
const noSleep = async () => {};
const DB = {
  rulebook: 'b2000000000000000000000000000001',
  claims_copy: 'b2000000000000000000000000000002',
  tag_decisions: 'b2000000000000000000000000000003',
  rule_changes: 'b2000000000000000000000000000004',
  agent_settings: 'b2000000000000000000000000000005',
};

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-pull-'));
  dirs.push(d);
  return d;
};
const cap = () => {
  const out = [];
  const err = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
};
const lines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const rt = (content, url) => ({ type: 'text', text: { content, ...(url ? { link: { url } } : {}) } });
const richText = (...pieces) => ({ rich_text: pieces.map((p) => (typeof p === 'string' ? rt(p) : rt(p[0], p[1]))) });
const titleOf = (s) => ({ title: [rt(s)] });

/** A state folder with a config whose tables have ids (the ones named in `placeholders` keep "<setup>"), and the fake Notion behind them. The config starts as it was before setup, not as the live file holds it now. */
async function world({ placeholders = [], populate = true } = {}) {
  const root = tmp();
  const config = placeholderConfig();
  config.notion.requests_per_second = 1000;
  const entries = { rulebook: config.notion.rulebook, claims_copy: config.notion.claims[0], ...config.notion.databases };
  const notion = createFakeNotion();
  for (const [table, entry] of Object.entries(entries)) {
    if (placeholders.includes(table)) continue;
    entry.database_id = DB[table];
    entry.data_source_id = `c200000000000000000000000000000${Object.keys(DB).indexOf(table) + 1}`;
    const spec = { ...TABLE_SPECS[table] };
    if (table === 'claims_copy' && placeholders.includes('rulebook')) delete spec['Claim quality tags — verified']; // no Rulebook copy for the relation to point at
    notion.addDatabase({ id: entry.database_id, dataSourceId: entry.data_source_id, title: table, properties: restProps(spec, config.notion.rulebook.data_source_id) });
  }
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  const client = createClient({ token: notion.token, fetchImpl: notion.fetchImpl, requestsPerSecond: 1000, sleep: noSleep });
  const w = { root, config, notion, client, ids: {} };
  if (populate) await fill(w);
  return w;
}

const env = (w, extra = {}) => ({ root: w.root, config: w.config, fetchImpl: w.notion.fetchImpl, token: w.notion.token, sleep: noSleep, now: NOW, ...extra });
const run = async (w, argv, extra = {}) => {
  const c = cap();
  const code = await main(argv, c.io, env(w, extra));
  return { code, out: c.out, err: c.err };
};

async function fill(w) {
  const { notion, client, ids } = w;
  if (w.config.notion.rulebook.database_id === DB.rulebook) {
    for (const row of FIXTURE_RULEBOOK) {
      const { page_id: _ignored, ...plain } = row;
      ids[`tag:${row.Name}`] = notion.addRow(DB.rulebook, plain);
    }
    ids.otherTag = notion.addRow(DB.rulebook, { Name: 'Not an issue tag', 'Work tags': ['Pipeline benchmark check'], 'When to use': '1. Nothing.' });
  }
  if (w.config.notion.claims[0].database_id === DB.claims_copy) {
    await client.createPage({
      parentDatabaseId: DB.claims_copy,
      properties: {
        'Geo Name': titleOf('Claim one has two sources'),
        'Geo ID': richText('geo-1'),
        'Geo URL': { url: 'https://www.geobrowser.io/space/s/geo-1' },
        'Geo Sources': richText(['Source A', 'https://www.geobrowser.io/space/s/entity-a'], '\n', ['Source ', 'https://www.geobrowser.io/space/s/entity-b'], ['B', 'https://www.geobrowser.io/space/s/entity-b']),
        'Geo Is factual': { checkbox: true },
        'Agent tags': richText('Context-dependent'),
        'Agent notes': richText('Context-dependent\n1 waits for an editor'),
      },
    });
    ids.claim2 = notion.addRow(DB.claims_copy, { 'Geo Name': 'Claim two has no sources', 'Geo ID': 'geo-2', 'Geo URL': 'https://www.geobrowser.io/space/s/geo-2' });
    ids.claim3 = notion.addRow(DB.claims_copy, {
      'Geo Name': 'Claim three is written out', 'Geo ID': 'geo-3', 'Geo Sources': '[Written out](https://www.geobrowser.io/space/s/entity-c)<br>https://example.com/bare.',
      'Agent tags': 'Context-dependent', 'Agent reasons': 'Context-dependent: A pronoun with no antecedent. · Context-dependent rule 1 · 2 of 2 runs agree', 'Agent notes': 'Context-dependent\nnothing waits for an editor · edition 2026-10-16.1', 'Agent confidence': 0.81,
      ...(w.config.notion.rulebook.database_id === DB.rulebook ? { 'Claim quality tags — verified': [ids['tag:Context-dependent']] } : {}),
      'Review status': 'Reviewed', 'Why wrong': 'Rule unclear', 'Challenged tags notes': 'Context-dependent: rule 3 does not say so.',
    });
  }
  if (w.config.notion.databases.tag_decisions.database_id === DB.tag_decisions) {
    ids.open = notion.addRow(DB.tag_decisions, { Claim: 'Claim one has two sources', Key: 'geo-1::Context-dependent', Tag: 'Context-dependent', 'Agent proposal': "Can't tell", 'Agent confidence': 0.5, 'Agent reason': 'Unsure', 'Claim link': 'https://www.geobrowser.io/space/s/geo-1', 'Rulebook edition': '2026-10-16.1' });
    ids.audit = notion.addRow(DB.tag_decisions, { Claim: 'An audited claim', Key: 'aud-1::Context-dependent', Tag: 'Context-dependent', 'Rulebook edition': '2026-10-16.1', 'Tag outcome': 'Does not apply', 'Why wrong': 'Rule unclear', 'Your reasoning': 'From the audit of 9 October: it reads on its own.' });
    ids.decided = notion.addRow(DB.tag_decisions, { Claim: 'A decided claim', Key: 'geo-9::Context-dependent', Tag: 'Context-dependent', 'Agent proposal': 'Applies', 'Agent confidence': 0.61, 'Rulebook edition': '2026-10-16.1', 'Tag outcome': 'Applies', 'Your reasoning': 'The pronoun has no antecedent.' });
  }
  if (w.config.notion.databases.rule_changes.database_id === DB.rule_changes) {
    ids.lesson = notion.addRow(DB.rule_changes, {
      Lesson: 'Hedged claims are not context-dependent', Tag: 'Context-dependent', Rule: 'Context-dependent rule 2', Kind: 'Clarify wording', 'Current text': 'old', 'Proposed text': 'new',
      'Supporting rows': 'Claim one has two sources · geo-1::Context-dependent\nA claim with a · dot in it · geo-9::Context-dependent\n+ 2 more in the page', Status: 'Proposed',
    });
  }
  if (w.config.notion.databases.agent_settings.database_id === DB.agent_settings) {
    ids.settings = notion.addRow(DB.agent_settings, { Name: 'claim-tagger-mvp', Paused: false, 'Rulebook edition': '2026-10-16.1', 'Last run summary': 'Tag · 15 Oct 11:20' });
  }
}

// ---- links and keys ------------------------------------------------------------------------------------------------------------

test('richTextLinks keeps every link of a rich-text array, merges the pieces of one link and drops a repeat', () => {
  const pieces = [
    { plain_text: 'Source ', href: 'https://a.example/1' }, { plain_text: 'one', href: 'https://a.example/1' }, { plain_text: ' and ', href: null },
    { text: { content: 'Two', link: { url: 'https://a.example/2' } } }, { plain_text: 'Source one again', href: 'https://a.example/1' },
  ];
  assert.deepEqual(richTextLinks(pieces), [{ text: 'Source one', href: 'https://a.example/1' }, { text: 'Two', href: 'https://a.example/2' }]);
  assert.deepEqual(richTextLinks([]), []);
  assert.deepEqual(richTextLinks(undefined), []);
});

test('geoSourceLinks reads a real link, a [title](address) written out and an address typed as text, in order, each address once', () => {
  const mixed = geoSourceLinks([
    { plain_text: 'Entity A', href: 'https://www.geobrowser.io/space/s/a' }, { plain_text: '\n[Entity B](https://www.geobrowser.io/space/s/b)<br>', href: null },
    { plain_text: 'see https://example.com/c, and https://www.geobrowser.io/space/s/a.', href: null },
  ]);
  assert.deepEqual(mixed, [
    { text: 'Entity A', href: 'https://www.geobrowser.io/space/s/a', form: 'rich_text' },
    { text: 'Entity B', href: 'https://www.geobrowser.io/space/s/b', form: 'markdown' },
    { text: '', href: 'https://example.com/c', form: 'bare' },
  ]);
  assert.deepEqual(geoSourceLinks(undefined, '[T](https://x.example/1)<br>[T2](https://x.example/2)').map((l) => l.href), ['https://x.example/1', 'https://x.example/2']);
  assert.deepEqual(geoSourceLinks([], ''), []);
  assert.deepEqual(geoSourceLinks([{ plain_text: 'no link here', href: null }]), []);
  assert.deepEqual(geoSourceLinks([{ plain_text: 'A mention', href: 'https://www.notion.so/page' }]).map((l) => l.form), ['rich_text']);
});

test('supportingKeys takes the key at the end of each line, whatever the claim holds, and nothing from a spill line', () => {
  const cell = [
    'Claim one · geo-1::Context-dependent',
    'A claim with a · dot in it · 6dc1222aeb364918821167370d8fbc40::Source inaccessible',
    '',
    'geo-3::Context-dependent',
    '+ 2 more in the page',
    'Claim one · geo-1::Context-dependent',
    'A line with no key · at all',
  ].join('\n');
  assert.deepEqual(supportingKeys(cell), ['geo-1::Context-dependent', '6dc1222aeb364918821167370d8fbc40::Source inaccessible', 'geo-3::Context-dependent']);
  assert.deepEqual(supportingKeys(''), []);
  assert.deepEqual(supportingKeys(null), []);
});

test('tablesFor resolves the aliases, keeps the order of the tables, and refuses a name it does not know', () => {
  assert.deepEqual(tablesFor('all'), ['rulebook', 'claims_copy', 'tag_decisions', 'rule_changes', 'agent_settings']);
  assert.deepEqual(tablesFor(['settings', 'claims', 'queue', 'claims_copy']), ['claims_copy', 'tag_decisions', 'agent_settings']);
  assert.throws(() => tablesFor(['claims', 'runs']), /unknown table name\(s\): runs/);
  assert.throws(() => tablesFor([]), /\(none given\)/);
});

// ---- pull --all ----------------------------------------------------------------------------------------------------------------

test('pull --all reads the five tables, writes schema, raw and the norm files, the request log and LATEST, and makes no write', async () => {
  const w = await world();
  const writesBefore = w.notion.writes().length;
  const r = await run(w, ['--all', '--pull-id', 'p1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(w.notion.writes().length, writesBefore, 'a pull sends no write');
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^pull p1: rulebook 7, claims_copy 3, tag_decisions 3, rule_changes 1, agent_settings 1; drift not checked \(no lock\); duplicates 0; paused no$/);

  const dir = join(w.root, 'runs', 'pull', 'p1');
  for (const table of Object.keys(DB)) {
    assert.ok(existsSync(join(dir, 'schema', `${table}.json`)), `schema/${table}.json`);
    assert.ok(existsSync(join(dir, 'raw', `${table}.jsonl`)), `raw/${table}.jsonl`);
  }
  assert.equal(readFileSync(join(w.root, 'runs', 'pull', 'LATEST'), 'utf8').trim(), 'p1');
  assert.equal(JSON.parse(readFileSync(join(dir, 'schema', 'tag_decisions.json'), 'utf8')).properties.Key.type, 'rich_text');
  assert.equal(lines(join(dir, 'raw', 'claims_copy.jsonl')).length, 3);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'drift.json'), 'utf8')), { skipped: 'no lock' });

  // the request log: every attempt, reads only
  const requests = countRequests(join(dir, 'requests.jsonl'));
  assert.equal(requests.writes, 0);
  assert.deepEqual([requests.byMethod.GET, requests.byMethod.POST, requests.byMethod.PATCH], [5, 5, 0]);
  assert.equal(requests.total, 10);

  const manifest = JSON.parse(readFileSync(join(dir, 'pull.json'), 'utf8'));
  assert.equal(manifest.pull_id, 'p1');
  assert.equal(manifest.taken_at, '2026-10-15T10:00:00.000Z');
  assert.deepEqual(manifest.tables, ['rulebook', 'claims_copy', 'tag_decisions', 'rule_changes', 'agent_settings']);
  assert.deepEqual(manifest.skipped, []);
  assert.deepEqual(manifest.counts, { rulebook: 7, claims_copy: 3, tag_decisions: 3, rule_changes: 1, agent_settings: 1 });
  assert.equal(manifest.paused, false);
  assert.equal(manifest.request_log, 'requests.jsonl');
});

test('the norm files: claims with their links, the rulebook copy as plain rows, the queue, the lessons with their supporting keys, the settings', async () => {
  const w = await world();
  assert.equal((await run(w, ['--all', '--pull-id', 'p1'])).code, EXIT.OK);
  const p = loadPull(w.root, 'p1', { config: w.config });

  // claims
  const claims = p.claims();
  assert.deepEqual(claims.map((c) => c.geo_id), ['geo-1', 'geo-2', 'geo-3']);
  const one = claims[0];
  assert.deepEqual(Object.keys(one), ['table', 'geo_id', 'page_id', 'notion_url', 'claim', 'geo_url', 'sources_text', 'source_links', 'is_factual', 'agent_tags', 'agent_notes',
    'agent_confidence', 'agent_reasons', 'verified_tags', 'review_status', 'why_wrong', 'challenged_notes', 'last_edited']);
  assert.equal(one.table, 'claims_copy');
  assert.equal(one.claim, 'Claim one has two sources');
  assert.equal(one.geo_url, 'https://www.geobrowser.io/space/s/geo-1');
  assert.equal(one.sources_text, 'Source A\nSource B');
  assert.deepEqual(one.source_links, [{ text: 'Source A', href: 'https://www.geobrowser.io/space/s/entity-a' }, { text: 'Source B', href: 'https://www.geobrowser.io/space/s/entity-b' }], 'the two pieces of the second link are one link');
  assert.equal(one.is_factual, true);
  assert.equal(one.agent_tags, 'Context-dependent');
  assert.equal(one.agent_notes, 'Context-dependent\n1 waits for an editor');
  assert.equal(one.last_edited, w.notion.page(one.page_id).last_edited_time);
  assert.equal(one.notion_url, w.notion.page(one.page_id).url);
  assert.deepEqual(claims[1].source_links, []);
  assert.equal(claims[1].is_factual, false);
  assert.equal(claims[1].agent_tags, '');
  // the editor's four columns and the agent's confidence: empty on an open claim, and the relation read as tag names on a Reviewed one
  assert.deepEqual([one.agent_confidence, one.agent_reasons, one.verified_tags, one.review_status, one.why_wrong, one.challenged_notes], [null, '', [], null, null, '']);
  const three = claims[2];
  assert.equal(three.agent_confidence, 0.81);
  assert.equal(three.agent_reasons, 'Context-dependent: A pronoun with no antecedent. · Context-dependent rule 1 · 2 of 2 runs agree');
  assert.deepEqual(three.verified_tags, ['Context-dependent'], 'the relation is resolved to tag names through the page ids of the Rulebook copy');
  assert.equal(three.review_status, 'Reviewed');
  assert.equal(three.why_wrong, 'Rule unclear');
  assert.equal(three.challenged_notes, 'Context-dependent: rule 3 does not say so.');
  assert.equal(p.queue().every((q) => 'Decided under' in q), true, 'the ledger has Decided under');
  assert.deepEqual(claims[2].source_links, [{ text: 'Written out', href: 'https://www.geobrowser.io/space/s/entity-c' }, { text: '', href: 'https://example.com/bare' }]);

  // the rulebook copy: the rows with the work tag, as the plain shape the rubric build takes
  const rulebook = p.rulebook();
  assert.ok(Array.isArray(rulebook));
  assert.equal(rulebook.length, 6, 'the row without the work tag is left out');
  assert.ok(!rulebook.some((r) => r.Name === 'Not an issue tag'));
  assert.deepEqual(rulebook.map((r) => r.Name), [...rulebook.map((r) => r.Name)].sort(), 'sorted by name');
  const cd = rulebook.find((r) => r.Name === 'Context-dependent');
  assert.deepEqual(Object.keys(cd).sort(), [...Object.keys(FIXTURE_RULEBOOK[0])].sort());
  assert.deepEqual(cd['Work tags'], FIXTURE_RULEBOOK[0]['Work tags']);
  assert.equal(cd['When to use'], FIXTURE_RULEBOOK[0]['When to use']);
  assert.equal(cd['Verified on'], '2026-09-10');
  assert.equal(cd.page_id, w.ids['tag:Context-dependent']);

  // the queue
  const queue = p.queue();
  assert.deepEqual(queue.map((q) => q.Key), ['aud-1::Context-dependent', 'geo-1::Context-dependent', 'geo-9::Context-dependent']);
  assert.deepEqual(Object.keys(queue[1]), [...QUEUE_COLUMNS, 'page_id', 'last_edited', 'decided']);
  assert.deepEqual(queue.map((q) => q.decided), [true, false, true]);
  assert.equal(queue[1]['Agent proposal'], "Can't tell");
  assert.equal(queue[1]['Agent confidence'], 0.5);
  assert.equal(queue[1]['Tag outcome'], null);
  assert.equal(queue[0]['Why wrong'], 'Rule unclear');
  assert.equal(queue[1].page_id, w.ids.open);

  // the lessons
  const [lesson] = p.lessons();
  assert.deepEqual(Object.keys(lesson), [...LESSON_COLUMNS, 'page_id', 'created', 'supporting_keys']);
  assert.equal(lesson.Lesson, 'Hedged claims are not context-dependent');
  assert.equal(lesson.Status, 'Proposed');
  assert.deepEqual(lesson.supporting_keys, ['geo-1::Context-dependent', 'geo-9::Context-dependent']);
  assert.equal(lesson.created, w.notion.page(lesson.page_id).created_time);

  // the settings
  assert.deepEqual(p.settings(), { page_id: w.ids.settings, name: 'claim-tagger-mvp', paused: false, rulebook_edition: '2026-10-16.1', last_run_summary: 'Tag · 15 Oct 11:20' });
});

test('evals/cases.jsonl is rewritten from the decided queue rows, and left alone when the queue is not pulled', async () => {
  const w = await world();
  assert.equal((await run(w, ['--tables', 'claims,rulebook', '--pull-id', 'p0'])).code, EXIT.OK);
  assert.equal(existsSync(join(w.root, 'evals', 'cases.jsonl')), false, 'no queue pulled: no cases file');
  assert.equal((await run(w, ['--all', '--pull-id', 'p1'])).code, EXIT.OK);
  const cases = lines(join(w.root, 'evals', 'cases.jsonl'));
  assert.deepEqual(cases, [
    { key: 'aud-1::Context-dependent', tag: 'Context-dependent', claim: 'An audited claim', outcome: 'Does not apply', why_wrong: 'Rule unclear', decided_edition: '2026-10-16.1', source: 'audit of 9 October' },
    { key: 'geo-9::Context-dependent', tag: 'Context-dependent', claim: 'A decided claim', outcome: 'Applies', why_wrong: null, decided_edition: '2026-10-16.1', source: 'queue' },
  ]);

  // an editor decides the open row and undoes the audit row: the file follows
  w.notion.editRow(w.ids.open, { 'Tag outcome': 'Applies', 'Why wrong': 'Agent slip' });
  w.notion.editRow(w.ids.audit, { 'Tag outcome': null });
  assert.equal((await run(w, ['--tables', 'queue', '--pull-id', 'p2'])).code, EXIT.OK);
  assert.deepEqual(lines(join(w.root, 'evals', 'cases.jsonl')).map((c) => [c.key, c.outcome, c.why_wrong]), [
    ['geo-1::Context-dependent', 'Applies', 'Agent slip'],
    ['geo-9::Context-dependent', 'Applies', null],
  ]);
});

test('--tables takes names and aliases; LATEST is the newest pull, and latestPullId can ask for the newest pull that holds some tables', async () => {
  const w = await world();
  assert.equal(latestPullId(w.root), null);
  assert.equal((await run(w, ['--all', '--pull-id', 'full'], { now: () => new Date('2026-10-15T09:00:00.000Z') })).code, EXIT.OK);
  const partial = await run(w, ['--tables', 'queue,settings', '--pull-id', 'partial'], { now: () => new Date('2026-10-15T10:00:00.000Z') });
  assert.equal(partial.code, EXIT.OK);
  assert.match(partial.out[0], /^pull partial: tag_decisions 3, agent_settings 1; /);
  assert.equal(latestPullId(w.root), 'partial');
  assert.equal(latestPullId(w.root, ['claims']), 'full', 'the newest pull that holds the claims');
  assert.equal(latestPullId(w.root, ['queue']), 'partial');
  assert.equal(latestPullId(w.root, ['queue', 'rulebook']), 'full');
  assert.equal(latestPullId(w.root, ['rule_changes', 'nothing']), null);
  const p = loadPull(w.root, 'partial', { config: w.config });
  assert.deepEqual(p.tables, ['tag_decisions', 'agent_settings']);
  assert.equal(p.covers('queue'), true);
  assert.equal(p.covers('rulebook'), false);
  assert.equal(p.claims(), null, 'a table that was not pulled has no norm file');
  assert.equal(existsSync(join(w.root, 'runs', 'pull', 'partial', 'schema', 'rulebook.json')), false);
  assert.equal(loadPull(w.root, undefined, { config: w.config }).id, 'partial');
  assert.throws(() => loadPull(w.root, 'nope'), /does not exist/);

  const bad = await run(w, ['--tables', 'claims,runs']);
  assert.equal(bad.code, EXIT.INVALID);
  assert.match(bad.err.join('\n'), /unknown table name\(s\): runs/);
});

test('a table whose id is still a placeholder is skipped and listed; a pull that reads nothing does not become LATEST', async () => {
  const w = await world({ placeholders: ['rulebook', 'rule_changes'] });
  const r = await run(w, ['--all', '--pull-id', 'p1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /^pull p1: claims_copy 3, tag_decisions 3, agent_settings 1; skipped rulebook, rule_changes \(not created yet\); /);
  const manifest = JSON.parse(readFileSync(join(w.root, 'runs', 'pull', 'p1', 'pull.json'), 'utf8'));
  assert.deepEqual(manifest.tables, ['claims_copy', 'tag_decisions', 'agent_settings']);
  assert.deepEqual(manifest.skipped.map((s) => s.table), ['rulebook', 'rule_changes']);
  assert.match(manifest.skipped[0].reason, /not created yet/);
  assert.equal(existsSync(join(w.root, 'runs', 'pull', 'p1', 'raw', 'rulebook.jsonl')), false);
  assert.equal(existsSync(join(w.root, 'runs', 'pull', 'p1', 'norm', 'rulebook.json')), false);
  assert.equal(JSON.parse(readFileSync(join(w.root, 'runs', 'pull', 'p1', 'drift.json'), 'utf8')).skipped, 'no lock');

  // the config as it was before setup: nothing has been created yet, so nothing is read, no token is needed and nothing becomes LATEST
  const fresh = tmp();
  const shipped = placeholderConfig();
  const c = cap();
  const code = await main(['--all', '--pull-id', 'empty'], c.io, { root: fresh, config: shipped, client: null, now: NOW });
  assert.equal(code, EXIT.OK, c.err.join('\n'));
  assert.match(c.out[0], /^pull empty: no table read; skipped rulebook, claims_copy, tag_decisions, rule_changes, agent_settings \(not created yet\)/);
  assert.equal(latestPullId(fresh), null);
  assert.deepEqual(JSON.parse(readFileSync(join(fresh, 'runs', 'pull', 'empty', 'pull.json'), 'utf8')).tables, []);
});

test('a duplicate key in a table is exit 2, with every file still written', async () => {
  const w = await world();
  w.notion.addRow(DB.tag_decisions, { Claim: 'A repeated claim', Key: 'geo-1::Context-dependent', Tag: 'Context-dependent' });
  w.notion.addRow(DB.tag_decisions, { Claim: 'A row with no key' });
  const r = await run(w, ['--all', '--pull-id', 'p1']);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /duplicate key in tag_decisions: "geo-1::Context-dependent" on pages \S+, \S+/);
  assert.match(r.err.join('\n'), /warning: tag_decisions: 1 row\(s\) without a Key were left out/);
  const dir = join(w.root, 'runs', 'pull', 'p1');
  const queue = lines(join(dir, 'norm', 'queue.jsonl'));
  assert.deepEqual(queue.map((q) => q.Key), ['aud-1::Context-dependent', 'geo-1::Context-dependent', 'geo-9::Context-dependent'], 'the oldest row of a repeated key stands for it');
  assert.equal(queue[1].page_id, w.ids.open);
  assert.ok(existsSync(join(dir, 'norm', 'claims.jsonl')), 'the other tables were written too');
  const manifest = JSON.parse(readFileSync(join(dir, 'pull.json'), 'utf8'));
  assert.equal(manifest.duplicates.length, 1);
  assert.equal(manifest.duplicates[0].page_ids.length, 2);
  assert.equal(latestPullId(w.root), 'p1');
});

test('a table without its key column is exit 2 and says which; a missing optional column is only a warning', async () => {
  const w = await world({ populate: false });
  // a Tag decisions table whose Key column was renamed
  const broken = createFakeNotion();
  const spec = { ...TABLE_SPECS.tag_decisions };
  delete spec.Key;
  spec['Row key'] = 'rich_text';
  broken.addDatabase({ id: DB.tag_decisions, title: 'tag_decisions', properties: restProps(spec) });
  const r = await run(w, ['--tables', 'queue'], { fetchImpl: broken.fetchImpl, token: broken.token });
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /tag_decisions: the key column "Key" is not in the table/);

  const lacking = createFakeNotion();
  const settingsSpec = { Name: 'title', Paused: 'checkbox' };
  lacking.addDatabase({ id: DB.agent_settings, title: 'agent_settings', properties: restProps(settingsSpec) });
  lacking.addRow(DB.agent_settings, { Name: 'claim-tagger-mvp', Paused: false });
  const ok = await run(w, ['--tables', 'settings', '--pull-id', 'p2'], { fetchImpl: lacking.fetchImpl, token: lacking.token });
  assert.equal(ok.code, EXIT.OK, ok.err.join('\n'));
  assert.match(ok.err.join('\n'), /warning: agent_settings: the column "Rulebook edition" is not in the table/);
  const settings = loadPull(w.root, 'p2', { config: w.config }).settings();
  assert.deepEqual({ ...settings, page_id: null }, { page_id: null, name: 'claim-tagger-mvp', paused: false, rulebook_edition: null, last_run_summary: null });
});

test('a pull of a paused agent completes and says so; a missing settings row is a warning, not a stop', async () => {
  const w = await world();
  w.notion.editRow(w.ids.settings, { Paused: true });
  const r = await run(w, ['--all', '--pull-id', 'p1']);
  assert.equal(r.code, EXIT.OK, 'the caller decides what a pause means');
  assert.match(r.out[0], /paused yes$/);
  assert.equal(loadPull(w.root, 'p1', { config: w.config }).settings().paused, true);
  assert.equal(JSON.parse(readFileSync(join(w.root, 'runs', 'pull', 'p1', 'pull.json'), 'utf8')).paused, true);

  const empty = await world({ populate: false });
  const e = await run(empty, ['--tables', 'settings', '--pull-id', 'p2']);
  assert.equal(e.code, EXIT.OK);
  assert.match(e.err.join('\n'), /agent_settings: no row yet/);
  assert.equal(loadPull(empty.root, 'p2', { config: empty.config }).settings().paused, false);
});

test('without a token the pull stops with exit 2 before any file is made; a protected table is refused', async () => {
  const w = await world();
  const noToken = cap();
  const requestsBefore = w.notion.requests.length;
  const code = await main(['--all', '--pull-id', 'p1'], noToken.io, { root: w.root, config: w.config, fetchImpl: w.notion.fetchImpl, repoRoot: tmp(), now: NOW });
  assert.equal(code, EXIT.INVALID);
  assert.match(noToken.err.join('\n'), /there is no NOTION_TOKEN in \.env/);
  assert.equal(existsSync(join(w.root, 'runs', 'pull', 'p1')), false);
  assert.equal(w.notion.requests.length, requestsBefore, 'not one request');

  const protectedConfig = structuredClone(w.config);
  protectedConfig.notion.protected_database_ids.push(DB.rulebook);
  const r = await run(w, ['--tables', 'rulebook'], { config: protectedConfig });
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /rulebook is on the protected list/);
  assert.equal(w.notion.requests.length, requestsBefore, 'not one request');
});

test('Notion refusing the token is exit 2 with a hint; an unexpected failure is exit 1', async () => {
  const w = await world();
  w.notion.failNext('GET', /^\/databases\//, 401, 1, { code: 'unauthorized', message: 'API token is invalid.' });
  const refused = await run(w, ['--tables', 'rulebook']);
  assert.equal(refused.code, EXIT.INVALID);
  assert.match(refused.err.join('\n'), /Notion refused the request/);
  w.notion.failNext('GET', /^\/databases\//, 400, 1, { code: 'validation_error', message: 'something else' });
  const other = await run(w, ['--tables', 'rulebook']);
  assert.equal(other.code, EXIT.ERROR);
});

// ---- the drift file -------------------------------------------------------------------------------------------------------------

test('drift.json: no difference while the copy equals the lock, the tag and column once it does not, adopted for a tag without rules', async () => {
  const w = await world();
  assert.equal((await run(w, ['--tables', 'rulebook', '--pull-id', 'p0'])).code, EXIT.OK);
  const rubric = buildRubric(loadPull(w.root, 'p0', { config: w.config }).rulebook(), { config: w.config, edition: '2026-10-16.1', now: new Date('2026-10-16T09:00:00.000Z') });
  writeEdition(w.root, rubric, { reason: 'test edition' });

  const same = await run(w, ['--tables', 'rulebook', '--pull-id', 'p1']);
  assert.equal(same.code, EXIT.OK);
  assert.deepEqual(JSON.parse(readFileSync(join(w.root, 'runs', 'pull', 'p1', 'drift.json'), 'utf8')), { judged: [], adopted: [], missing: [], added: [] });
  assert.match(same.out[0], /drift 0 difference\(s\)/);

  w.notion.editRow(w.ids['tag:Context-dependent'], { 'When to use': '1. A different first rule.' });
  w.notion.editRow(w.ids['tag:Improperly sourced'], { Description: 'A new description.' });
  const changed = await run(w, ['--tables', 'rulebook', '--pull-id', 'p2']);
  assert.equal(changed.code, EXIT.OK, 'a pull reports drift, other commands stop on it');
  const drift = JSON.parse(readFileSync(join(w.root, 'runs', 'pull', 'p2', 'drift.json'), 'utf8'));
  assert.deepEqual(drift.judged, [{ tag: 'Context-dependent', column: 'When to use' }]);
  assert.deepEqual(drift.adopted, [{ tag: 'Improperly sourced', columns: ['Description'] }]);
  assert.match(changed.out[0], /drift 2 difference\(s\)/);
  const manifest = JSON.parse(readFileSync(join(w.root, 'runs', 'pull', 'p2', 'pull.json'), 'utf8'));
  assert.deepEqual(manifest.drift, { checked: true, judged: 1, adopted: 1, missing: 0, added: 0 });

  // a lock that cannot be read is reported, never skipped silently
  writeFileSync(join(w.root, 'rubric', 'rubric.lock'), '{"edition": "x"}\n');
  const unreadable = await run(w, ['--tables', 'rulebook', '--pull-id', 'p3']);
  assert.equal(unreadable.code, EXIT.OK);
  const skipped = JSON.parse(readFileSync(join(w.root, 'runs', 'pull', 'p3', 'drift.json'), 'utf8'));
  assert.equal(skipped.skipped, 'the check could not run');
  assert.match(skipped.error, /not a valid lock/);
  assert.match(unreadable.err.join('\n'), /warning: drift: the check could not run/);

  // a lock without the rulebook in the pull
  const noRulebook = await run(w, ['--tables', 'claims', '--pull-id', 'p4']);
  assert.deepEqual(JSON.parse(readFileSync(join(w.root, 'runs', 'pull', 'p4', 'drift.json'), 'utf8')), { skipped: 'the rulebook was not pulled' });
  assert.equal(noRulebook.code, EXIT.OK);
});

// ---- what a pull hands to applyPlan ---------------------------------------------------------------------------------------------

test('loadPull gives applyPlan its `pulled`: an update with expect is sent for an open row and skipped for a decided one', async () => {
  const w = await world();
  assert.equal((await run(w, ['--all', '--pull-id', 'p1'])).code, EXIT.OK);
  const p = loadPull(w.root, 'p1', { config: w.config });
  const byKey = p.byKey('tag_decisions');
  assert.deepEqual(Object.keys(byKey), ['aud-1::Context-dependent', 'geo-1::Context-dependent', 'geo-9::Context-dependent']);
  assert.equal(byKey['geo-1::Context-dependent'].page_id, w.ids.open);
  assert.equal(byKey['geo-9::Context-dependent']['Tag outcome'], 'Applies');
  assert.equal(p.plainRows('claims_copy').length, 3);
  assert.deepEqual(Object.keys(p.pulled(['claims_copy', 'agent_settings'])), ['claims_copy', 'agent_settings']);
  assert.equal(p.byKey('claims_copy')['geo-2'].page_id, w.ids.claim2);

  const plan = newPlan({ runId: 'r1', script: 'test', rubricEdition: '2026-10-16.1', config: w.config, now: NOW });
  plan.update('tag_decisions', 'geo-1::Context-dependent', byKey['geo-1::Context-dependent'].page_id, { 'Agent proposal': 'Applies', 'Agent confidence': 0.9 }, { expect: { 'Tag outcome': null } });
  plan.update('tag_decisions', 'geo-9::Context-dependent', byKey['geo-9::Context-dependent'].page_id, { 'Agent proposal': 'Does not apply' }, { expect: { 'Tag outcome': null } });
  plan.update('claims_copy', 'geo-2', p.byKey('claims_copy')['geo-2'].page_id, { 'Agent tags': 'Context-dependent' }, { expect: { 'Agent tags': '' } });
  const schemas = Object.fromEntries(p.tables.map((t) => [t, p.schema(t)]));
  const client = createClient({ token: w.notion.token, fetchImpl: w.notion.fetchImpl, requestsPerSecond: 1000, sleep: noSleep });
  const result = await applyPlan({ plan, dir: join(w.root, 'runs', 'r1'), client, config: w.config, schemas, pulled: p.pulled(), root: w.root, now: NOW });
  assert.equal(result.code, EXIT.OK);
  assert.deepEqual([result.done, result.skipped], [2, 1]);
  assert.equal(w.notion.page(w.ids.decided).properties['Agent proposal'].select.name, 'Applies', 'the decided row was not touched');
  assert.equal(w.notion.page(w.ids.open).properties['Agent proposal'].select.name, 'Applies');
});

// ---- the dry run ---------------------------------------------------------------------------------------------------------------

const REAL_DB = '7219756338b2416f8fa8af83d75ec47d';
const REAL_DS = 'd1307596-e531-420f-8688-2485f3ef28ab';
const pad = (n) => String(n).padStart(4, '0');

/** The real claims table of the shipped config (its read-only source), filled with `count` claims: the ten audit claims first, then others with 0, 1, 2 or 3 links. */
async function realWorld({ count = 230, duplicate = false } = {}) {
  const root = tmp();
  const config = placeholderConfig();
  config.notion.requests_per_second = 1000;
  const notion = createFakeNotion();
  const taxonomy = notion.addDatabase({ title: 'Taxonomy', properties: restProps({ Name: 'title' }) });
  const editors = notion.addDatabase({ title: 'Editors', properties: restProps({ Name: 'title' }) });
  notion.addDatabase({ id: REAL_DB, dataSourceId: REAL_DS, title: 'U.S. Politics debate claims', properties: restProps(realClaimsSpec({ taxonomy: taxonomy.data_source_id, editors: editors.data_source_id })) });
  const client = createClient({ token: notion.token, fetchImpl: notion.fetchImpl, requestsPerSecond: 1000, sleep: noSleep });
  const link = (n) => `https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/${pad(n)}`;
  for (let i = 0; i < count; i++) {
    const geoId = i < AUDIT_IDS.length ? AUDIT_IDS[i] : `geo-${pad(i)}`;
    const name = i === 15 || i === 16 ? '' : `Claim number ${i}`;
    const tags = i % 3 === 0 ? ['Debate', 'Politics'] : i % 3 === 1 ? ['Debate'] : [];
    const review = i % 4 === 0 ? 'To review' : i % 4 === 1 ? 'Reviewed' : null;
    const common = { 'Geo Is factual': i % 2 === 0, 'Geo Score': i % 5 };
    if (i % 7 === 0) {
      // three real links
      await client.createPage({
        parentDatabaseId: REAL_DB,
        properties: {
          'Geo Name': titleOf(name), 'Geo ID': richText(geoId), 'Geo Tags': { multi_select: tags.map((t) => ({ name: t })) }, 'Geo Is factual': { checkbox: common['Geo Is factual'] },
          'Geo Sources': richText([`Source ${i}a`, link(i * 10 + 1)], '\n', [`Source ${i}b`, link(i * 10 + 2)], '\n', [`Source ${i}c`, link(i * 10 + 3)]),
          ...(review ? { 'Review status': { select: { name: review } } } : {}),
        },
      });
      continue;
    }
    const sources = i % 5 === 0 ? [`Source ${i}`, link(i * 10 + 1)] : null;
    if (sources) {
      await client.createPage({
        parentDatabaseId: REAL_DB,
        properties: {
          'Geo Name': titleOf(name), 'Geo ID': richText(geoId), 'Geo Tags': { multi_select: tags.map((t) => ({ name: t })) }, 'Geo Is factual': { checkbox: common['Geo Is factual'] },
          'Geo Sources': richText(sources), ...(review ? { 'Review status': { select: { name: review } } } : {}),
        },
      });
      continue;
    }
    const written = i % 11 === 0 ? `[Written ${i}](${link(i * 10 + 1)})<br>[Written ${i}b](${link(i * 10 + 2)})` : i % 13 === 0 ? `see ${link(i * 10 + 1)}` : '';
    notion.addRow(REAL_DB, { 'Geo Name': name, 'Geo ID': duplicate && i === 43 ? `geo-${pad(41)}` : geoId, 'Geo Tags': tags, 'Geo Is factual': common['Geo Is factual'], 'Geo Sources': written, 'Review status': review });
  }
  return { root, config, notion, client, count };
}

test('the dry run reads the real table once through a client that cannot write, and leaves schema, rows, report and the request log', async () => {
  const w = await realWorld();
  const before = w.notion.requests.length;
  const writesBefore = w.notion.writes().length;
  const r = await run(w, ['--source', 'real_claims', '--dry-run', '--run-id', 'dry-1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], /^dry run dry-1: 230 rows, 21 columns; Geo ID unique and filled on every row; \d+ rows with links; requests 4 \(GET: 1, POST: 3, PATCH: 0\), writes 0$/);
  assert.equal(w.notion.writes().length, writesBefore, 'the dry run sent no write');

  // the requests: the schema once, then the query in three pages, nothing else
  const made = w.notion.requests.slice(before).map((q) => `${q.method} ${q.path.replace(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/g, '<id>')} ${q.status}`);
  assert.deepEqual(made, ['GET /databases/<id> 200', 'POST /databases/<id>/query 200', 'POST /databases/<id>/query 200', 'POST /databases/<id>/query 200']);

  const dir = join(w.root, 'runs', 'dry-run', 'dry-1');
  assert.deepEqual(readdirSync(dir).sort(), ['report.json', 'report.md', 'requests.jsonl', 'rows.jsonl', 'schema.json']);
  const counted = countRequests(join(dir, 'requests.jsonl'));
  assert.deepEqual(counted, { total: 4, byMethod: { GET: 1, POST: 3, PATCH: 0 }, writes: 0 });

  assert.equal(JSON.parse(readFileSync(join(dir, 'schema.json'), 'utf8')).properties['Geo Sources'].type, 'rich_text');
  const rows = lines(join(dir, 'rows.jsonl'));
  assert.equal(rows.length, 230);
  const first = rows[0];
  assert.equal(first['Geo ID'], AUDIT_IDS[0]);
  assert.equal(first['Geo Name'], 'Claim number 0');
  for (const key of ['page_id', 'url', 'last_edited_time', 'source_links', 'source_pieces']) assert.ok(key in first, key);
  assert.equal(first.url, w.notion.page(first.page_id).url);
  assert.equal(first['Geo Is factual'], true);
  assert.deepEqual(first['Geo Tags'], ['Debate', 'Politics']);
  assert.equal(first.source_links.length, 3, 'row 0 has three real links');
  assert.deepEqual(first.source_links.map((l) => l.form), ['rich_text', 'rich_text', 'rich_text']);
  assert.deepEqual(first.source_pieces.map((p) => p.href !== null), [true, false, true, false, true]);
  for (const name of Object.keys(JSON.parse(readFileSync(join(dir, 'schema.json'), 'utf8')).properties)) assert.ok(name in rows[1], `the plain row has the column ${name}`);
  const written = rows.find((x) => x['Geo ID'] === `geo-${pad(22)}`);
  assert.deepEqual(written.source_links.map((l) => l.form), ['markdown', 'markdown']);
  const bare = rows.find((x) => x['Geo ID'] === `geo-${pad(26)}`);
  assert.deepEqual(bare.source_links.map((l) => l.form), ['bare']);
  assert.equal(rows.find((x) => x['Geo ID'] === `geo-${pad(17)}`).source_links.length, 0);

  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
  assert.equal(report.row_count, 230);
  assert.equal(report.column_count, 21);
  assert.deepEqual(report.requests, { total: 4, by_method: { GET: 1, POST: 3, PATCH: 0 }, writes: 0 });
  const tagsColumn = report.columns.find((c) => c.name === 'Geo Tags');
  assert.deepEqual([tagsColumn.type, tagsColumn.options.length], ['multi_select', 8]);
  assert.deepEqual(report.columns.find((c) => c.name === 'Review status'), { name: 'Review status', type: 'select', options: ['To review', 'Reviewed'] });
  assert.equal(report.columns.find((c) => c.name === 'Geo Is factual').type, 'checkbox');
  assert.equal(report.columns.find((c) => c.name === 'Claim quality tags — verified').type, 'relation');
  assert.equal(report.columns.find((c) => c.name === 'Geo Name').options, undefined, 'options only for a select');
  assert.deepEqual({ ...report.key, duplicates: undefined }, { column: 'Geo ID', type: 'rich_text', empty: 0, unique: true, duplicates: undefined });
  assert.equal(report.claim_name.empty, 2);
  const src = report.geo_sources;
  assert.equal(src.type, 'rich_text');
  assert.equal(Object.values(src.links_per_row).reduce((a, b) => a + b, 0), 230, 'every row is in one bucket');
  assert.deepEqual(Object.keys(src.links_per_row), ['0', '1', '2', '3 or more']);
  assert.equal(src.links_per_row['3 or more'], 33, 'rows 0, 7, 14, ... have three links');
  assert.ok(src.links_per_row['2'] > 0 && src.links_per_row['1'] > 0 && src.links_per_row['0'] > 0);
  assert.equal(src.rows_with_links, 230 - src.links_per_row['0']);
  assert.equal(src.total_links, src.links_by_form.rich_text + src.links_by_form.markdown + src.links_by_form.bare);
  assert.ok(src.links_by_form.rich_text > 0 && src.links_by_form.markdown > 0 && src.links_by_form.bare > 0);
  assert.deepEqual(src.hosts, [{ host: 'www.geobrowser.io', links: src.total_links }]);
  assert.equal(src.samples.length, 3);
  assert.deepEqual(src.samples.map((s) => s.links.length >= 3), [true, false, false]);
  assert.ok(src.samples.every((s) => s.links.every((l) => /^https:\/\/www\.geobrowser\.io\//.test(l.href))));
  assert.deepEqual(report.is_factual, { column: 'Geo Is factual', type: 'checkbox', true: 115, false: 115, empty: 0 });
  assert.equal(report.geo_tags.counts.Debate, 77 + 77);
  assert.equal(report.geo_tags.counts.Politics, 77);
  assert.equal(report.geo_tags.rows_without, 76);
  assert.deepEqual(report.review_status.counts, { 'To review': 58, Reviewed: 58, '(empty)': 114 });

  const md = readFileSync(join(dir, 'report.md'), 'utf8');
  assert.match(md, /^# Dry run of the real claims table/);
  assert.match(md, /Read only: nothing was written to Notion\. Read on 2026-10-15 \(run dry-1\)\./);
  assert.match(md, /\| Geo Tags \| multi_select \| Debate, Democracy & Media, Economy, Featured, Immigration, Main claim, Politics, debate claim \|/);
  assert.match(md, /\| Review status \| select \| To review, Reviewed \|/);
  assert.match(md, /- Rows: 230/);
  assert.match(md, /- Unique on every row that has one: yes/);
  assert.match(md, /- Type: checkbox/);
  assert.match(md, /Three sample rows:/);
  assert.match(md, /- Writes: 0/);
  assert.doesNotMatch(md, /\$|\b(seconds?|minutes?|hours?|days?|weeks?)\b/i, 'no money, no durations');
  assert.doesNotMatch(md, new RegExp(REAL_DB), 'the protected id is not in the report');
  assert.doesNotMatch(readFileSync(join(dir, 'report.json'), 'utf8'), new RegExp(REAL_DB));

  // the same run id again is refused, and the first run's files are not touched
  const again = await run(w, ['--source', 'real_claims', '--dry-run', '--run-id', 'dry-1']);
  assert.equal(again.code, EXIT.INVALID);
  assert.match(again.err.join('\n'), /dry run "dry-1" already exists/);
  assert.equal(countRequests(join(dir, 'requests.jsonl')).total, 4);
});

test('the dry run reports a repeated Geo ID and an empty one instead of hiding them', async () => {
  const w = await realWorld({ count: 60, duplicate: true });
  w.notion.addRow(REAL_DB, { 'Geo Name': 'A claim with no id' });
  const r = await run(w, ['--source', 'real_claims', '--dry-run', '--run-id', 'dry-dup']);
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out[0], /Geo ID not clean \(1 empty, 1 repeated\)/);
  const report = JSON.parse(readFileSync(join(w.root, 'runs', 'dry-run', 'dry-dup', 'report.json'), 'utf8'));
  assert.deepEqual([report.key.unique, report.key.empty], [false, 1]);
  assert.deepEqual(report.key.duplicates, [{ value: `geo-${pad(41)}`, rows: 2 }]);
  assert.match(readFileSync(join(w.root, 'runs', 'dry-run', 'dry-dup', 'report.md'), 'utf8'), /Unique on every row that has one: no \(1 value\(s\) repeat, for example geo-0041 on 2 rows\)/);
});

test('readOnlyFetch lets a GET and a query through and refuses everything else before it leaves the process', async () => {
  const seen = [];
  const guarded = readOnlyFetch(async (url, init) => {
    seen.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
    return new Response('{}');
  });
  await guarded('https://api.notion.com/v1/databases/x');
  await guarded('https://api.notion.com/v1/databases/x/query', { method: 'POST' });
  await guarded('https://api.notion.com/v1/data_sources/x/query', { method: 'POST' });
  await guarded('https://api.notion.com/v1/search', { method: 'POST' });
  for (const [method, path] of [['POST', '/pages'], ['PATCH', '/pages/x'], ['POST', '/databases'], ['POST', '/views'], ['PATCH', '/blocks/x/children'], ['DELETE', '/blocks/x'], ['PUT', '/pages/x']]) {
    await assert.rejects(() => guarded(`https://api.notion.com/v1${path}`, { method }), /the dry run only reads/, `${method} ${path}`);
  }
  assert.equal(seen.length, 4, 'nothing else reached the inner fetch');
});

test('the dry run reads a database with several data sources through the data source route, and says so', async () => {
  const w = await realWorld({ count: 12 });
  w.notion.failNext('POST', /^\/databases\/[^/]+\/query$/, 400, 1, { code: 'validation_error', message: 'Databases with multiple data sources are not supported in this API version. Use the data source query instead.' });
  const r = await run(w, ['--source', 'real_claims', '--dry-run', '--run-id', 'dry-ms']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const report = JSON.parse(readFileSync(join(w.root, 'runs', 'dry-run', 'dry-ms', 'report.json'), 'utf8'));
  assert.equal(report.multi_source, true);
  assert.equal(report.row_count, 12);
  const sent = readFileSync(join(w.root, 'runs', 'dry-run', 'dry-ms', 'requests.jsonl'), 'utf8');
  assert.match(sent, /"path":"\/data_sources\/[^"]+\/query"/);
  assert.equal(countRequests(join(w.root, 'runs', 'dry-run', 'dry-ms', 'requests.jsonl')).writes, 0);
  assert.equal(w.notion.requests.filter((q) => q.version === '2026-03-11').length > 0, true, 'the data source calls used the builder API version');
  assert.match(readFileSync(join(w.root, 'runs', 'dry-run', 'dry-ms', 'report.md'), 'utf8'), /more than one data source/);
});

test('the dry run needs the real table in the config and a token', async () => {
  const w = await realWorld({ count: 3 });
  const noSource = structuredClone(w.config);
  delete noSource.notion.sources.real_claims;
  const a = await run(w, ['--source', 'real_claims', '--dry-run'], { config: noSource });
  assert.equal(a.code, EXIT.INVALID);
  assert.match(a.err.join('\n'), /no notion\.sources\.real_claims/);
  const c = cap();
  const requestsBefore = w.notion.requests.length;
  const code = await main(['--source', 'real_claims', '--dry-run'], c.io, { root: w.root, config: w.config, fetchImpl: w.notion.fetchImpl, repoRoot: tmp(), now: NOW });
  assert.equal(code, EXIT.INVALID);
  assert.match(c.err.join('\n'), /there is no NOTION_TOKEN/);
  assert.equal(w.notion.requests.length, requestsBefore, 'nothing was sent');
  assert.equal(existsSync(join(w.root, 'runs', 'dry-run')), false, 'no folder was made');
});

// ---- a cell Notion cuts short, and ids that are taken -----------------------------------------------------------------------

// Notion cuts a title or rich-text value at 25 pieces in the page objects of a query: this answers like that.
const cutAt25 = (inner, column) => async (url, init) => {
  const res = await inner(url, init);
  if (String(init?.method ?? 'GET').toUpperCase() !== 'POST' || !new URL(url).pathname.endsWith('/query')) return res;
  const body = await res.json();
  for (const page of body.results ?? []) {
    const value = page.properties?.[column];
    if (value?.rich_text?.length > 25) value.rich_text = value.rich_text.slice(0, 25);
  }
  return new Response(JSON.stringify(body), { status: res.status, headers: { 'content-type': 'application/json' } });
};
const fifteenLinks = (n) => richText(...Array.from({ length: 15 }, (_, i) => [`Source ${i + 1}`, `https://www.geobrowser.io/space/s/long-${n}-${i + 1}`]).flatMap((piece, i) => (i === 0 ? [piece] : ['\n', piece])));

test('a Geo Sources cell that Notion cut at 25 pieces is read whole, in the dry run and in a pull of the claims', async () => {
  const w = await realWorld({ count: 12 });
  const longId = 'geo-long';
  await w.client.createPage({ parentDatabaseId: REAL_DB, properties: { 'Geo Name': titleOf('A claim with fifteen sources'), 'Geo ID': richText(longId), 'Geo Sources': fifteenLinks(1) } });
  const r = await run(w, ['--source', 'real_claims', '--dry-run', '--run-id', 'dry-long'], { fetchImpl: cutAt25(w.notion.fetchImpl, 'Geo Sources') });
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const dir = join(w.root, 'runs', 'dry-run', 'dry-long');
  const row = lines(join(dir, 'rows.jsonl')).find((x) => x['Geo ID'] === longId);
  assert.equal(row.source_links.length, 15, 'all fifteen links, not the twelve that fit in 25 pieces');
  assert.equal(row.source_links[14].href, 'https://www.geobrowser.io/space/s/long-1-15');
  assert.equal(row.source_pieces.length, 29);
  assert.equal(row['Geo Sources'].split('\n').length, 15);
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
  assert.equal(report.geo_sources.rows_read_whole, 1);
  assert.match(readFileSync(join(dir, 'report.md'), 'utf8'), /1 row\(s\) had so many pieces that Notion cut the cell short/);
  const log = readFileSync(join(dir, 'requests.jsonl'), 'utf8');
  assert.match(log, /"method":"GET","path":"\/pages\/[^"]+\/properties\/[^"]+/, 'the cell was read from the property item');
  assert.equal(countRequests(join(dir, 'requests.jsonl')).writes, 0);

  // the same for the claims of a pull
  const pulls = await world({ populate: false });
  await pulls.client.createPage({ parentDatabaseId: DB.claims_copy, properties: { 'Geo Name': titleOf('A claim with fifteen sources'), 'Geo ID': richText('geo-long'), 'Geo Sources': fifteenLinks(2) } });
  const p = await run(pulls, ['--tables', 'claims', '--pull-id', 'p1'], { fetchImpl: cutAt25(pulls.notion.fetchImpl, 'Geo Sources') });
  assert.equal(p.code, EXIT.OK, p.err.join('\n'));
  const pull = loadPull(pulls.root, 'p1', { config: pulls.config });
  assert.equal(pull.claims()[0].source_links.length, 15);
  assert.equal(pull.pages('claims_copy')[0].properties['Geo Sources'].rich_text.length, 29, 'the raw file holds the whole cell');
});

test('a cell with fewer than 25 pieces costs no extra request', async () => {
  const w = await realWorld({ count: 12 });
  await run(w, ['--source', 'real_claims', '--dry-run', '--run-id', 'dry-short'], { fetchImpl: cutAt25(w.notion.fetchImpl, 'Geo Sources') });
  const log = readFileSync(join(w.root, 'runs', 'dry-run', 'dry-short', 'requests.jsonl'), 'utf8');
  assert.doesNotMatch(log, /\/properties\//);
  assert.equal(JSON.parse(readFileSync(join(w.root, 'runs', 'dry-run', 'dry-short', 'report.json'), 'utf8')).geo_sources.rows_read_whole, 0);
});

test('a default pull or dry-run id that is taken gets a number after it; an id that was asked for and is taken is refused', async () => {
  const w = await world();
  const first = await run(w, ['--tables', 'settings']);
  const second = await run(w, ['--tables', 'settings']);
  const third = await run(w, ['--tables', 'settings']);
  assert.deepEqual([first.code, second.code, third.code], [0, 0, 0]);
  assert.deepEqual(readdirSync(join(w.root, 'runs', 'pull')).filter((n) => n !== 'LATEST').sort(), ['20261015T100000Z-pull', '20261015T100000Z-pull-2', '20261015T100000Z-pull-3']);
  assert.equal(latestPullId(w.root), '20261015T100000Z-pull-3', 'the last one made is the latest');
  assert.equal(latestPullId(w.root, ['settings']), '20261015T100000Z-pull-3');

  assert.equal((await run(w, ['--tables', 'settings', '--pull-id', 'mine'])).code, EXIT.OK);
  const again = await run(w, ['--tables', 'settings', '--pull-id', 'mine']);
  assert.equal(again.code, EXIT.INVALID);
  assert.match(again.err.join('\n'), /pull "mine" already exists; choose another --pull-id/);
  assert.equal(countRequests(join(w.root, 'runs', 'pull', 'mine', 'requests.jsonl')).total, 2, 'the first pull\'s request log was not added to');

  const real = await realWorld({ count: 3 });
  assert.equal((await run(real, ['--source', 'real_claims', '--dry-run'])).code, EXIT.OK);
  assert.equal((await run(real, ['--source', 'real_claims', '--dry-run'])).code, EXIT.OK);
  assert.deepEqual(readdirSync(join(real.root, 'runs', 'dry-run')).sort(), ['20261015T100000Z-dry-run', '20261015T100000Z-dry-run-2']);
});

// ---- the pick------------------------------------------------------------------------------------------------------------------

async function pickWorld(extra = {}) {
  const w = await realWorld(extra);
  const dry = await run(w, ['--source', 'real_claims', '--dry-run', '--run-id', 'dry-1']);
  assert.equal(dry.code, EXIT.OK, dry.err.join('\n'));
  return w;
}
const pickArgs = (seed = 'seed-1', extra = []) => ['--source', 'real_claims', '--pick', '50', '--seed', seed, '--audit', AUDIT_FILE, ...extra];
const readPick = (w) => JSON.parse(readFileSync(join(w.root, 'setup', 'claims-pick.json'), 'utf8'));

test('the pick is the ten audit claims in the audit file\'s order and forty random ones, written to setup/claims-pick.json', async () => {
  const w = await pickWorld();
  const r = await run(w, pickArgs());
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /^pick: 50 claims \(10 from the audit, 40 at random, seed "seed-1"\) from dry run dry-1 -> /);
  const pick = readPick(w);
  assert.deepEqual(Object.keys(pick), ['seed', 'picked_at', 'dry_run', 'audit_ids', 'random_ids', 'rows']);
  assert.equal(pick.seed, 'seed-1');
  assert.equal(pick.picked_at, '2026-10-15T10:00:00.000Z');
  assert.equal(pick.dry_run, 'dry-1');
  assert.deepEqual(pick.audit_ids, AUDIT_IDS, 'the audit ids, in the order of the audit file');
  assert.equal(pick.random_ids.length, 40);
  assert.equal(new Set(pick.random_ids).size, 40, 'no claim twice');
  assert.ok(pick.random_ids.every((id) => !AUDIT_IDS.includes(id)));
  assert.equal(pick.rows.length, 50);
  assert.deepEqual(pick.rows.map((x) => x['Geo ID']), [...AUDIT_IDS, ...pick.random_ids], 'audit rows first, then the random ones in picked order');
  assert.ok(pick.rows.every((x) => x['Geo Name'].trim() !== ''), 'no claim without a name');
  assert.ok(pick.rows.every((x) => 'page_id' in x && 'url' in x && 'last_edited_time' in x && Array.isArray(x.source_links)), 'full plain rows');
  assert.equal(pick.rows[0]['Geo Name'], 'Claim number 0');
  const dryRows = lines(join(w.root, 'runs', 'dry-run', 'dry-1', 'rows.jsonl'));
  assert.deepEqual(pick.rows[3], dryRows.find((x) => x['Geo ID'] === AUDIT_IDS[3]), 'a row is the dry run\'s row, unchanged');
  assert.ok(!pick.random_ids.includes(`geo-${pad(15)}`) && !pick.random_ids.includes(`geo-${pad(16)}`), 'the rows without a name are not chosen');
});

test('the pick is the same for the same seed and dry run, whatever the order of the rows, and another seed picks others', async () => {
  const w = await pickWorld();
  assert.equal((await run(w, pickArgs('seed-1'))).code, EXIT.OK);
  const first = readPick(w);
  assert.equal((await run(w, pickArgs('seed-1'), { now: () => new Date('2026-10-16T08:00:00.000Z') })).code, EXIT.OK);
  const second = readPick(w);
  assert.equal(second.picked_at, '2026-10-16T08:00:00.000Z');
  assert.deepEqual({ ...second, picked_at: null }, { ...first, picked_at: null }, 'the same pick');

  assert.equal((await run(w, pickArgs('seed-2'))).code, EXIT.OK);
  const other = readPick(w);
  assert.notDeepEqual(other.random_ids, first.random_ids);
  assert.deepEqual(other.audit_ids, first.audit_ids);

  // the same rows in the reverse order, as another dry run: the same pick
  const original = lines(join(w.root, 'runs', 'dry-run', 'dry-1', 'rows.jsonl'));
  const dir = join(w.root, 'runs', 'dry-run', 'dry-reversed');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'rows.jsonl'), `${original.reverse().map((x) => JSON.stringify(x)).join('\n')}\n`);
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify({ read_at: '2026-10-14T00:00:00.000Z' })}\n`);
  assert.equal((await run(w, pickArgs('seed-1', ['--from', 'dry-reversed']))).code, EXIT.OK);
  const reversed = readPick(w);
  assert.equal(reversed.dry_run, 'dry-reversed');
  assert.deepEqual(reversed.random_ids, first.random_ids);
  assert.deepEqual(reversed.rows.map((x) => x['Geo ID']), first.rows.map((x) => x['Geo ID']));
});

test('without --from the pick reads the newest dry run', async () => {
  const w = await pickWorld();
  const older = lines(join(w.root, 'runs', 'dry-run', 'dry-1', 'rows.jsonl')).filter((x) => x['Geo ID'] !== AUDIT_IDS[5]);
  const dir = join(w.root, 'runs', 'dry-run', 'zzz-older');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'rows.jsonl'), `${older.map((x) => JSON.stringify(x)).join('\n')}\n`);
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify({ read_at: '2026-10-01T00:00:00.000Z' })}\n`);
  const r = await run(w, pickArgs());
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(readPick(w).dry_run, 'dry-1', 'the newest by read time, not by name');
  const named = await run(w, pickArgs('seed-1', ['--from', 'zzz-older']));
  assert.equal(named.code, EXIT.INVALID, 'the named dry run lacks an audit claim');
  assert.match(named.err.join('\n'), /1 audit claim\(s\) are not in dry run zzz-older: /);
});

test('the pick fails with exit 2 when an audit claim is missing, and then writes nothing', async () => {
  const w = await pickWorld({ count: 230 });
  const rows = lines(join(w.root, 'runs', 'dry-run', 'dry-1', 'rows.jsonl')).filter((x) => x['Geo ID'] !== AUDIT_IDS[7]);
  writeFileSync(join(w.root, 'runs', 'dry-run', 'dry-1', 'rows.jsonl'), `${rows.map((x) => JSON.stringify(x)).join('\n')}\n`);
  const r = await run(w, pickArgs());
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /pick: 1 audit claim\(s\) are not in dry run dry-1: /);
  assert.equal(existsSync(join(w.root, 'setup', 'claims-pick.json')), false);
});

test('the pick matches an audit id that Notion writes with dashes or capitals', async () => {
  const w = await pickWorld({ count: 80 });
  const file = join(w.root, 'runs', 'dry-run', 'dry-1', 'rows.jsonl');
  const rows = lines(file);
  const dashed = (id) => `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`.toUpperCase();
  rows[2]['Geo ID'] = dashed(rows[2]['Geo ID']);
  writeFileSync(file, `${rows.map((x) => JSON.stringify(x)).join('\n')}\n`);
  const r = await run(w, pickArgs());
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(readPick(w).audit_ids[2], dashed(AUDIT_IDS[2]), 'the id as the table writes it');
});

test('both rows of a repeated Geo ID stay out of the random pool', async () => {
  // 52 rows: 10 audit, 2 without a name, 2 that share an id, leaving 38 of the 40 needed; with the repeated ones in, the pick would succeed
  const w = await pickWorld({ count: 52, duplicate: true });
  const r = await run(w, pickArgs());
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /only 38 rows are left to choose from, 40 are needed/);
  const roomy = await pickWorld({ count: 54, duplicate: true });
  assert.equal((await run(roomy, pickArgs())).code, EXIT.OK);
  assert.ok(!readPick(roomy).random_ids.includes('geo-0041'), 'with exactly 40 others left, neither repeated row is among them');
});

test('the pick needs a seed, an audit file, enough claims, a dry run, and a count that holds the audit claims', async () => {
  const w = await pickWorld({ count: 30 });
  const noSeed = await run(w, ['--source', 'real_claims', '--pick', '50', '--audit', AUDIT_FILE]);
  assert.equal(noSeed.code, EXIT.INVALID);
  assert.match(noSeed.err.join('\n'), /--seed <string> is required/);
  const noAudit = await run(w, ['--source', 'real_claims', '--pick', '50', '--seed', 's']);
  assert.match(noAudit.err.join('\n'), /--audit <path to the audit json> is required/);
  const missingFile = await run(w, pickArgs('s').map((a) => (a === AUDIT_FILE ? join(w.root, 'nope.json') : a)));
  assert.equal(missingFile.code, EXIT.INVALID);
  assert.match(missingFile.err.join('\n'), /the audit file cannot be read/);
  const tooMany = await run(w, pickArgs());
  assert.equal(tooMany.code, EXIT.INVALID);
  assert.match(tooMany.err.join('\n'), /only 18 rows are left to choose from, 40 are needed/);
  const tooFew = await run(w, ['--source', 'real_claims', '--pick', '5', '--seed', 's', '--audit', AUDIT_FILE]);
  assert.match(tooFew.err.join('\n'), /--pick 5 is fewer than the 10 audit claims/);
  const notANumber = await run(w, ['--source', 'real_claims', '--pick', 'many', '--seed', 's', '--audit', AUDIT_FILE]);
  assert.equal(notANumber.code, EXIT.INVALID);
  assert.match(notANumber.err.join('\n'), /--pick needs a whole number/);
  const noDry = await world({ populate: false });
  const none = await run(noDry, pickArgs());
  assert.match(none.err.join('\n'), /there is no dry run with rows yet/);
  assert.equal(existsSync(join(w.root, 'setup', 'claims-pick.json')), false, 'nothing was written by any of these');
  // direct call: the same checks, as a library
  assert.throws(() => pickClaims({ root: w.root, config: w.config, count: 50, seed: '', auditPath: AUDIT_FILE }), /--seed/);
});

test('the command line refuses a mix of modes, an unknown flag and a source it does not know, and --help prints the usage', async () => {
  const w = await world({ populate: false });
  for (const argv of [[], ['--all', '--tables', 'claims'], ['--all', '--source', 'real_claims', '--dry-run'], ['--dry-run'], ['--source', 'taxonomy', '--dry-run'], ['--source', 'real_claims'], ['--bogus']]) {
    const r = await run(w, argv);
    assert.equal(r.code, EXIT.INVALID, JSON.stringify(argv));
    assert.match(r.err.join('\n'), /usage: node agents\/claim-tagger-mvp\/scripts\/pull\.mjs/, JSON.stringify(argv));
  }
  const help = await run(w, ['--help']);
  assert.equal(help.code, EXIT.OK);
  assert.match(help.out.join('\n'), /--dry-run \[--run-id <id>\]/);
});

// ---- the editor's columns of a claim (CLAIMS-REVIEW.md) -----------------------------------------------------------------------------------

test('a reference in Claim quality tags — verified that is no tag of the rulebook is left out of verified_tags and said in a warning; a tag with no Issue work tag still counts', async () => {
  const w = await world();
  const stray = w.ids.claim2; // a row of the Claims copy, not of the Rulebook copy
  w.notion.editRow(w.ids.claim3, { 'Claim quality tags — verified': [w.ids['tag:Context-dependent'], w.ids.otherTag, stray] });
  const r = await run(w, ['--all', '--pull-id', 'p1']);
  assert.equal(r.code, EXIT.OK);
  const three = loadPull(w.root, 'p1', { config: w.config }).claims().find((c) => c.geo_id === 'geo-3');
  assert.deepEqual(three.verified_tags, ['Context-dependent', 'Not an issue tag'], 'every row of the Rulebook copy names a tag, also one the rulebook file leaves out');
  assert.ok(r.err.some((l) => /claims_copy: 1 reference\(s\) in Claim quality tags — verified name no tag of the rulebook/.test(l)), r.err.join('\n'));
  assert.match(JSON.parse(readFileSync(join(w.root, 'runs', 'pull', 'p1', 'pull.json'), 'utf8')).warnings.join(' '), /name no tag of the rulebook/);
});

test('a pull of the claims alone reads the relation through the page ids of the rulebook edition in force', async () => {
  const w = await world();
  assert.equal((await run(w, ['--tables', 'rulebook', '--pull-id', 'p0'])).code, EXIT.OK);
  writeEdition(w.root, buildRubric(loadPull(w.root, 'p0', { config: w.config }).rulebook(), { config: w.config, edition: '2026-10-16.1', now: new Date('2026-10-16T09:00:00.000Z') }), { reason: 'test edition' });
  const r = await run(w, ['--tables', 'claims_copy', '--pull-id', 'p1']);
  assert.equal(r.code, EXIT.OK);
  const claims = loadPull(w.root, 'p1', { config: w.config }).claims();
  assert.deepEqual(claims.find((c) => c.geo_id === 'geo-3').verified_tags, ['Context-dependent']);
  assert.deepEqual(r.err.filter((l) => /name no tag/.test(l)), []);
  // without an edition the ids cannot be read: said, not guessed
  const bare = await world();
  const none = await run(bare, ['--tables', 'claims_copy', '--pull-id', 'p1']);
  assert.deepEqual(loadPull(bare.root, 'p1', { config: bare.config }).claims().find((c) => c.geo_id === 'geo-3').verified_tags, []);
  assert.ok(none.err.some((l) => /name no tag of the rulebook/.test(l)));
});

test('every claim and every ledger row of a pull fits its schema; a value the schema does not know is a warning, not a stop', async () => {
  const w = await world();
  const clean = await run(w, ['--all', '--pull-id', 'p1']);
  assert.equal(clean.code, EXIT.OK);
  assert.deepEqual(clean.err.filter((l) => /does not fit schemas/.test(l)), []);
  w.notion.editRow(w.ids.claim2, { 'Review status': 'Done' });
  w.notion.editRow(w.ids.open, { 'Tag outcome': 'Maybe' });
  const odd = await run(w, ['--all', '--pull-id', 'p2']);
  assert.equal(odd.code, EXIT.OK, 'the pull still completes');
  assert.ok(odd.err.some((l) => /the claim geo-2 does not fit schemas\/claim-row\.schema\.json \(.*review_status/.test(l)), odd.err.join('\n'));
  assert.ok(odd.err.some((l) => /the row geo-1::Context-dependent does not fit schemas\/ledger-row\.schema\.json/.test(l)));
});
