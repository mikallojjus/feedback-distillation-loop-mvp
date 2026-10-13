import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DATABASES, PROPERTY_TYPES } from '../agents/claim-tagger/scripts/allowlist.mjs';
import { OPTIONAL_OPTIONS, REQUIRED_OPTIONS, checkOptions, optionNames } from '../agents/claim-tagger/scripts/lib/notion-contract.mjs';
import { fixtureSchemas } from './fixtures/notion/fake-notion.mjs';

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'geo-agents-contract-'));
  dirs.push(d);
  return d;
};
const sorted = (list) => [...list].sort();

// ---- the shape of REQUIRED_OPTIONS ---------------------------------------------------------------------------------------------

test('REQUIRED_OPTIONS: only select properties of the six databases, each with a list of distinct, trimmed, non-empty names', () => {
  assert.ok(Object.keys(REQUIRED_OPTIONS).length >= 5);
  for (const [db, props] of Object.entries(REQUIRED_OPTIONS)) {
    assert.ok(DATABASES.includes(db), `${db} is not one of the databases`);
    for (const [prop, options] of Object.entries(props)) {
      assert.equal(PROPERTY_TYPES[db][prop], 'select', `${db}.${prop} is not a select in PROPERTY_TYPES`);
      assert.ok(Array.isArray(options) && options.length >= 2, `${db}.${prop}`);
      assert.equal(new Set(options).size, options.length, `${db}.${prop} has a duplicate`);
      for (const name of options) assert.ok(typeof name === 'string' && name !== '' && name === name.trim(), `${db}.${prop}: "${name}"`);
    }
  }
});

test('REQUIRED_OPTIONS names every select property of PROPERTY_TYPES (a new select must be added to the contract)', () => {
  for (const db of DATABASES) {
    const selects = Object.entries(PROPERTY_TYPES[db]).filter(([, type]) => type === 'select').map(([name]) => name);
    assert.deepEqual(sorted(Object.keys(REQUIRED_OPTIONS[db] ?? {})), sorted(selects), db);
  }
});

test('REQUIRED_OPTIONS lists the select properties the review named', () => {
  const names = (db) => Object.keys(REQUIRED_OPTIONS[db]);
  assert.deepEqual(sorted(names('rulebook')), ['Category', 'Polarity', 'Status']);
  assert.deepEqual(sorted(names('claims')), ['Readiness', 'Sample', 'Table']);
  assert.deepEqual(sorted(names('tag_decisions')), sorted(['Agent proposal', 'Why in queue', 'Priority', 'Tag outcome', 'Why wrong', 'Seeded outcome', 'Agent follow-up']));
  assert.deepEqual(sorted(names('rule_changes')), ['Kind', 'Status']);
  assert.deepEqual(sorted(names('runs')), ['Kind', 'Verdict']);
  assert.equal(REQUIRED_OPTIONS.agent_settings, undefined, 'Agent settings has no select');
});

test('the options the formulas and the distill rules name are in the contract', () => {
  const has = (db, prop, ...names) => names.forEach((n) => assert.ok(REQUIRED_OPTIONS[db][prop].includes(n), `${db}.${prop} lacks "${n}"`));
  has('tag_decisions', 'Why wrong', 'Agent slip', 'Rule unclear', 'Rule should change', 'No tag fits', 'Other');
  has('tag_decisions', 'Tag outcome', 'Applies', 'Does not apply', 'Needs evidence', 'Ask another editor');
  has('tag_decisions', 'Agent follow-up', 'Fixed', 'Still wrong', 'Not re-run');
  has('tag_decisions', 'Agent proposal', 'Add tag', 'Keep tag');
  has('rule_changes', 'Status', 'Proposed', 'Approved', 'Rejected', 'Live', 'Rolled back');
  has('rulebook', 'Status', 'Verified');
  has('runs', 'Verdict', 'PASS', 'HOLD', 'FAIL', 'n/a');
});

test('Runs Kind: Baseline is required (run-card uses it by default), Rollback is optional (promote falls back to Gate)', () => {
  assert.ok(REQUIRED_OPTIONS.runs.Kind.includes('Baseline'));
  assert.equal(REQUIRED_OPTIONS.runs.Kind.includes('Rollback'), false);
  assert.deepEqual(OPTIONAL_OPTIONS, { runs: { Kind: ['Rollback'] } });
});

test('OPTIONAL_OPTIONS names properties of the contract and never repeats a required option', () => {
  for (const [db, props] of Object.entries(OPTIONAL_OPTIONS)) {
    for (const [prop, options] of Object.entries(props)) {
      assert.ok(REQUIRED_OPTIONS[db]?.[prop], `${db}.${prop} is not in REQUIRED_OPTIONS`);
      for (const name of options) assert.equal(REQUIRED_OPTIONS[db][prop].includes(name), false, `${db}.${prop}: "${name}" is both`);
    }
  }
});

test('both tables are frozen all the way down', () => {
  assert.ok(Object.isFrozen(REQUIRED_OPTIONS) && Object.isFrozen(REQUIRED_OPTIONS.tag_decisions) && Object.isFrozen(REQUIRED_OPTIONS.tag_decisions['Why wrong']));
  assert.throws(() => REQUIRED_OPTIONS.runs.Kind.push('Nope'), TypeError);
  assert.throws(() => { REQUIRED_OPTIONS.claims.Extra = ['x']; }, TypeError);
  assert.ok(Object.isFrozen(OPTIONAL_OPTIONS.runs.Kind));
});

// ---- the contract against the test fixtures ----------------------------------------------------------------------------------

test('the fixture schemas satisfy the contract, and hold no option the contract does not know', () => {
  const schemas = fixtureSchemas();
  for (const db of DATABASES) {
    assert.deepEqual(checkOptions(db, schemas[db].properties), { missing: [], unreadable: [] }, db);
    for (const [prop, def] of Object.entries(schemas[db].properties)) {
      if (def.type !== 'select') continue;
      const known = new Set([...(REQUIRED_OPTIONS[db]?.[prop] ?? []), ...(OPTIONAL_OPTIONS[db]?.[prop] ?? [])]);
      for (const name of optionNames(def)) assert.ok(known.has(name), `${db}.${prop}: the fixture has "${name}", which the contract does not list`);
    }
  }
});

// ---- checkOptions -----------------------------------------------------------------------------------------------------------

test('checkOptions: missing options are listed with their property, extra options are ignored', () => {
  const props = fixtureSchemas().tag_decisions.properties;
  assert.deepEqual(checkOptions('tag_decisions', props), { missing: [], unreadable: [] });
  props['Why wrong'].select.options = props['Why wrong'].select.options.filter((o) => o.name !== 'Rule unclear' && o.name !== 'Other');
  props['Why wrong'].select.options.push({ id: 'x', name: 'Something new', color: 'gray' });
  assert.deepEqual(checkOptions('tag_decisions', props), {
    missing: [{ property: 'Why wrong', option: 'Rule unclear' }, { property: 'Why wrong', option: 'Other' }],
    unreadable: [],
  });
});

test('checkOptions: a property that is absent or not a select is left to the property check; an option list that cannot be read is reported apart', () => {
  const props = fixtureSchemas().claims.properties;
  delete props.Table;
  props.Sample.type = 'rich_text';
  delete props.Readiness.select.options;
  assert.deepEqual(checkOptions('claims', props), { missing: [], unreadable: ['Readiness'] });
  props.Readiness.select = null;
  assert.deepEqual(checkOptions('claims', props), { missing: [], unreadable: ['Readiness'] });
  props.Readiness.select = { options: 'not a list' };
  assert.deepEqual(checkOptions('claims', props), { missing: [], unreadable: ['Readiness'] });
});

test('checkOptions: odd inputs do not throw (unknown database, no properties, options without names)', () => {
  assert.deepEqual(checkOptions('agent_settings', {}), { missing: [], unreadable: [] });
  assert.deepEqual(checkOptions('nope', { Status: { type: 'select', select: { options: [] } } }), { missing: [], unreadable: [] });
  assert.deepEqual(checkOptions('rulebook', undefined), { missing: [], unreadable: [] });
  assert.deepEqual(checkOptions('rulebook', null), { missing: [], unreadable: [] });
  const props = { Status: { type: 'select', select: { options: [null, {}, { name: 7 }, { name: 'Verified' }] } } };
  assert.deepEqual(checkOptions('rulebook', props), { missing: [{ property: 'Status', option: 'Proposed' }, { property: 'Status', option: 'Retired' }], unreadable: [] });
  assert.equal(optionNames(null), null);
  assert.equal(optionNames({ type: 'rich_text' }), null);
  assert.deepEqual(optionNames({ type: 'select', select: { options: [{ name: 'A' }, null, { name: 'B' }] } }), ['A', 'B']);
});

// ---- what the scripts can write, against the contract -------------------------------------------------------------------------

test('propose.mjs can write exactly the contract options for Agent proposal, Priority and Readiness', async () => {
  const { priorityOf, proposalFor, readinessOf } = await import('../agents/claim-tagger/scripts/propose.mjs');
  const decisions = ['apply', 'do_not_apply', 'cannot_tell', 'ask_editor', 'error'];
  const proposals = new Set();
  for (const decision of decisions) {
    for (const meanP of [0.2, 0.8]) {
      for (const current of [true, false]) {
        for (const sourceReading of [true, false]) proposals.add(proposalFor({ decision, runs: [], meanP }, { current, sourceReading }));
      }
    }
  }
  assert.deepEqual(sorted(proposals), sorted(REQUIRED_OPTIONS.tag_decisions['Agent proposal']));

  const priorities = new Set();
  for (const proposal of proposals) {
    for (const why of ['Rule changed', 'Low confidence', null]) {
      for (const split of [true, false]) {
        for (const polarity of ['Issue', 'Positive']) priorities.add(priorityOf({ proposal, why, verdict: { split }, polarity, fixPolarities: ['Issue'] }));
      }
    }
  }
  assert.deepEqual(sorted(priorities), sorted(REQUIRED_OPTIONS.tag_decisions.Priority));

  const readiness = new Set();
  const polarityOf = (tag) => (tag === 'Unsourced' ? 'Issue' : 'Classification');
  for (const state of decisions) {
    for (const tag of ['Unsourced', 'Predictive']) readiness.add(readinessOf(new Map([[tag, state]]), { polarityOf, fixPolarities: ['Issue'] }));
  }
  assert.deepEqual(sorted(readiness), sorted(REQUIRED_OPTIONS.claims.Readiness));
});

// ---- run-card.mjs: the Runs row values stay inside the contract; only a Gate row carries the gate verdict ----------------------------

function evalCard(verdict, { md = null } = {}) {
  const dir = tmp();
  const card = {
    card_id: 'card-1',
    verdict,
    canaries: { baseline: { active: 83, passed: 83, failing: [] }, candidate: { active: 83, passed: 83, failing: [] } },
    cases: { gating: ['c1', 'c2', 'c3'], newly_failing: [] },
    per_tag: [{ tag: 'Predictive', acc_base: 0.5, acc_cand: 0.75, n: 4, gated: true }],
    configs: { baseline: { rubric_version: '2026-10-13.1' }, candidate: { rubric_version: '2026-10-13.2', model: 'claude-sonnet-5-5' } },
    cost: { usd: 1.25 },
  };
  writeFileSync(join(dir, 'card.json'), JSON.stringify(card));
  if (md !== null) writeFileSync(join(dir, 'card.md'), md);
  return dir;
}

test('buildEvalCard: only a Gate row carries the gate verdict; Baseline, Smoke, Follow-up and Rollback rows say n/a', async () => {
  const { buildEvalCard } = await import('../agents/claim-tagger/scripts/run-card.mjs');
  const root = tmp();
  for (const verdict of ['PASS', 'HOLD', 'FAIL']) {
    const dir = evalCard(verdict, { md: `Verdict: ${verdict} - small sample\nCanaries: 83/83 pass\n` });
    assert.equal(buildEvalCard(root, dir, 'Gate', 'Gate R2', null).props.Verdict, verdict, `Gate keeps ${verdict}`);
    for (const kind of ['Baseline', 'Smoke', 'Follow-up', 'Rollback']) {
      const { props } = buildEvalCard(root, dir, kind, `${kind} row`, null);
      assert.equal(props.Verdict, 'n/a', `${kind} row with a ${verdict} card`);
      assert.equal(props.Kind, kind);
    }
  }
});

test('buildEvalCard: the card verdict word stays in the Summary of a row that says n/a, whether or not card.md has its Verdict line', async () => {
  const { buildEvalCard } = await import('../agents/claim-tagger/scripts/run-card.mjs');
  const root = tmp();
  const md = 'For editors: a rehearsal run.\nVerdict: PASS - small sample: read the numbers\nCanaries: 83/83 pass\n';
  const withLine = buildEvalCard(root, evalCard('PASS', { md }), 'Baseline', 'Baseline R1', null).props;
  assert.equal(withLine.Verdict, 'n/a');
  assert.equal(withLine.Summary, md, 'the card text is kept as it is');
  assert.match(withLine.Summary, /Verdict: PASS/);

  const noFile = buildEvalCard(root, evalCard('HOLD'), 'Baseline', 'Baseline R1', null).props;
  assert.equal(noFile.Verdict, 'n/a');
  assert.equal(noFile.Summary, 'Verdict: HOLD\n');

  const otherText = buildEvalCard(root, evalCard('FAIL', { md: 'Canaries: 83/83 pass\n' }), 'Follow-up', 'Follow-up R2', null).props;
  assert.equal(otherText.Verdict, 'n/a');
  assert.equal(otherText.Summary, 'Verdict: FAIL\nCanaries: 83/83 pass\n');

  const wrongLine = buildEvalCard(root, evalCard('PASS', { md: 'Verdict: FAIL - from somewhere else\n' }), 'Smoke', 'Smoke R1', null).props;
  assert.match(wrongLine.Summary, /^Verdict: PASS\n/, 'a Verdict line for another word does not count');
});

test('buildEvalCard: a Gate row keeps the card text as its Summary; a card without a verdict leaves the column empty', async () => {
  const { buildEvalCard } = await import('../agents/claim-tagger/scripts/run-card.mjs');
  const root = tmp();
  const md = 'Verdict: FAIL - small sample\nFAIL: Predictive: accuracy lower bound -27.3 points\n';
  const gate = buildEvalCard(root, evalCard('FAIL', { md }), 'Gate', 'Gate R2', 'Hedged trajectories').props;
  assert.equal(gate.Verdict, 'FAIL');
  assert.equal(gate.Summary, md);
  assert.deepEqual(gate.Lesson, { rule_changes: 'Hedged trajectories' });
  assert.equal(gate['Rubric version'], '2026-10-13.1 → 2026-10-13.2');
  assert.equal(gate.Canaries, '83 of 83');
  assert.equal(gate['Claims judged'], 3);
  assert.equal(gate['Cost USD'], 1.25);
  const noVerdict = buildEvalCard(root, evalCard(undefined, { md: 'Canaries: 83/83 pass\n' }), 'Baseline', 'Baseline R1', null).props;
  assert.equal(noVerdict.Verdict, 'n/a');
  assert.equal(noVerdict.Summary, 'Canaries: 83/83 pass\n', 'nothing to keep, nothing added');
  const gateWithout = buildEvalCard(root, evalCard(undefined, { md: 'Canaries: 83/83 pass\n' }), 'Gate', 'Gate R3', null).props;
  assert.equal(gateWithout.Verdict, undefined, 'run-card.mjs leaves out an empty value, so the column stays empty');
  assert.equal(gateWithout.Summary, 'Canaries: 83/83 pass\n');
});

test('buildEvalCard and buildTagCard write only Kind and Verdict options of the contract', async () => {
  const { buildEvalCard, buildTagCard } = await import('../agents/claim-tagger/scripts/run-card.mjs');
  const root = tmp();
  const kinds = [...REQUIRED_OPTIONS.runs.Kind, ...OPTIONAL_OPTIONS.runs.Kind];
  for (const kind of kinds.filter((k) => !['Tag', 'Distill'].includes(k))) {
    for (const verdict of ['PASS', 'HOLD', 'FAIL', 'n/a']) {
      const { props } = buildEvalCard(root, evalCard(verdict, { md: `Verdict: ${verdict}\n` }), kind, `${kind} ${verdict}`, null);
      assert.ok(kinds.includes(props.Kind), props.Kind);
      assert.ok(REQUIRED_OPTIONS.runs.Verdict.includes(props.Verdict), `${kind} ${verdict}: ${props.Verdict}`);
    }
  }

  const agent = tmp();
  mkdirSync(join(agent, 'runs', 'judge-1'), { recursive: true });
  mkdirSync(join(agent, 'runs', 'propose-1'), { recursive: true });
  writeFileSync(join(agent, 'runs', 'judge-1', 'run.json'), JSON.stringify({ rubric_version: '2026-10-13.1', rubric_hash: 'sha256:abc', model: 'claude-sonnet-5-5', runs: 3, started: '2026-10-13T12:00:00.000Z', cost_usd: 2.06, config_id: 'cfg' }));
  writeFileSync(join(agent, 'runs', 'propose-1', 'propose.json'), JSON.stringify({
    claims_judged: 60, rows_created: 40, rows_updated: 23, held_by_cap: 67, weekly_cap: 40, kept_by_decision: 3,
    readiness_counts: { 'Needs editor': 14, 'Fix needed': 35, 'Ready': 11 }, by_why_in_queue: { 'Low confidence': 20 },
  }));
  const tag = buildTagCard(agent, 'judge-1', 'propose-1').props;
  assert.equal(tag.Kind, 'Tag');
  assert.equal(tag.Verdict, 'n/a');
  assert.ok(REQUIRED_OPTIONS.runs.Kind.includes(tag.Kind) && REQUIRED_OPTIONS.runs.Verdict.includes(tag.Verdict));
});
