// Tests for agents/claim-tagger/scripts/seed-build.mjs.
//
// Part 1 (always runs): the helpers and the mapping rules, on small synthetic inputs with invented names.
// Part 2 (runs only when the research folder exists, otherwise skipped): the real build, with the counts the plan expects,
// the anonymisation, determinism, the command line, and a drift check against the committed seed files.
// The folder is X:\work\research\overnight-feedback-loop-research unless SEED_RESEARCH_DIR says otherwise.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as seed from '../agents/claim-tagger/scripts/seed-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'agents', 'claim-tagger', 'scripts', 'seed-build.mjs');
const COMMITTED = path.join(ROOT, 'agents', 'claim-tagger', 'evals', 'seed');
const RESEARCH = process.env.SEED_RESEARCH_DIR || seed.DEFAULT_RESEARCH_DIR;
const HAVE_RESEARCH = fs.existsSync(path.join(RESEARCH, 'sources', 'claims-to-review.13oct.jsonl'))
  && fs.existsSync(path.join(RESEARCH, 'sources', 'us-politics-sample.13oct.jsonl'));

const jsonl = (text) => text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seed-build-test-'));

// ---------- part 1: helpers and rules on synthetic data -------------------------------------------------------------

describe('text helpers', () => {
  test('mulberry32 reproduces the reference values (checked against an independent Python port)', () => {
    const rand = seed.mulberry32(20261013);
    assert.deepEqual([rand(), rand(), rand(), rand(), rand()],
      [0.07680194731801748, 0.40288688405416906, 0.9398759799078107, 0.7547351808752865, 0.041232772171497345]);
    assert.deepEqual(seed.seededShuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 20261013), [1, 2, 8, 6, 4, 9, 5, 7, 3, 0]);
    const input = [3, 1, 2];
    seed.seededShuffle(input, 1);
    assert.deepEqual(input, [3, 1, 2], 'the input array is not modified');
  });

  test('the scrubber replaces whole words, longest first, tolerates the typographic apostrophe, and counts by role', () => {
    const s = seed.makeScrubber([['Ann', 'the editor'], ['Ann Lee', 'the lead'], ["Bo's rule", "the team's rule"], ['Bo', 'the rule owner']]);
    assert.equal(s.scrub('Ann Lee agreed with Ann.'), 'The lead agreed with the editor.');
    assert.equal(s.scrub('Follow Bo\u2019s rule, says Bo.'), "Follow the team's rule, says the rule owner.");
    assert.equal(s.scrub('Annotation by Bobby, not Anne'), 'Annotation by Bobby, not Anne');
    assert.equal(s.scrub('Ann\u2019s note'), 'The editor\u2019s note');
    assert.deepEqual(s.counts, { 'the editor': 2, 'the lead': 1, 'the rule owner': 1, "the team's rule": 1 });
    assert.equal(s.total, 5);
    assert.equal(s.leftover('Ann said'), true);
    assert.equal(s.leftover('the editor said'), false);
    assert.equal(s.scrub(''), '');
    assert.equal(s.scrub(undefined), undefined);
  });

  test('every replacement in the real config works on its own name without naming anyone in this file', () => {
    const { replacements } = seed.loadConfig().anonymise;
    const s = seed.makeScrubber(replacements);
    for (const [from, to] of replacements) {
      assert.equal(s.scrub(`See ${from} today`), `See ${to} today`);
      if (/^\p{L}+$/u.test(from)) assert.equal(s.scrub(`${from}x and x${from}`), `${from}x and x${from}`, 'only whole words');
      assert.equal(s.scrub(`Done. ${from} agreed.`), `Done. ${to.charAt(0).toUpperCase()}${to.slice(1)} agreed.`);
    }
  });

  test('flattenMentions keeps the visible text and turns <br> into newlines', () => {
    assert.equal(seed.flattenMentions('Add <mention-page url="https://app.notion.com/p/abc">Source inaccessible</mention-page>: x'), 'Add Source inaccessible: x');
    assert.equal(seed.flattenMentions('one<br><br>two<br/>three'), 'one\n\ntwo\nthree');
    assert.equal(seed.flattenMentions('a <mention-user url="user://1"/> b'), 'a  b');
    assert.equal(seed.flattenMentions('line\r\nbreak'), 'line\nbreak');
  });

  test('stripPredictionText drops an inferred note whole and removes only the Do-not-add-Predictive clause elsewhere', () => {
    assert.equal(seed.stripPredictionText('Inferred from your reviews. Do not add Predictive. The claim uses a qualified likelihood.'), '');
    assert.equal(seed.stripPredictionText('Your review. Do not add Predictive; no replacement selected. I think so.'), 'Your review. No replacement selected. I think so.');
    assert.equal(seed.stripPredictionText('Do not add Predictive; no replacement selected \u2014 tentative: x. Predictive was withheld.'), 'No replacement selected \u2014 tentative: x. Predictive was withheld.');
    assert.equal(seed.stripPredictionText('Do not add Context-dependent. Fine.'), 'Do not add Context-dependent. Fine.');
    assert.equal(seed.stripPredictionText('Add Predictive: will happen.'), 'Add Predictive: will happen.');
  });

  test('parseGeoSources reads "[title](url)<br>..." cells, keeps order, drops duplicates, and refuses garbage', () => {
    assert.deepEqual(seed.parseGeoSources('[A \\| B](https://g.io/s/1)<br>[C (x)](https://g.io/s/2)<br>[A \\| B](https://g.io/s/1)'), ['https://g.io/s/1', 'https://g.io/s/2']);
    assert.deepEqual(seed.parseGeoSources(''), []);
    assert.deepEqual(seed.parseGeoSources(null), []);
    assert.deepEqual(seed.parseGeoSources('https://example.org/a'), ['https://example.org/a']);
    assert.throws(() => seed.parseGeoSources('not a link'), seed.InputError);
  });
});

describe('mapping rules on synthetic inputs', () => {
  const geo = (n) => n.toString(16).padStart(32, '0');
  const PROP40 = `807f9fa0${'0'.repeat(24)}`; // a Geo ID the Calibration exception recognises
  const FIRST_PREFIX = seed.FORECAST_PREFIXES[0];
  const audit = ({ id, tag, decision, flags, assessment = 'Likely error', claim = `Claim ${id}`, notes = '', why = 'Because.', reasoning = '', tags = '' }) => ({
    url: `https://app.notion.com/p/audit-${id}`,
    Claim: claim,
    'Audit key': `${id}::${tag}`,
    'Tags assigned by agent': tags,
    'Tag being assessed': [tag],
    Assessment: assessment,
    'Flag reason': flags,
    'Why I recommend this': why,
    'Review notes': notes,
    'Your decision': decision,
    'Your reasoning': reasoning,
    'Reviewed at': '2026-10-09',
    'Geo link': `https://www.geobrowser.io/space/s/${id}`,
  });
  const sampleRow = (id, claim, { tags = [], count = 0 } = {}) => ({
    url: `https://app.notion.com/p/claim-${id}`,
    'Geo Name': claim,
    'Geo ID': id,
    'Geo Sources (count)': count,
    'Claim quality tags \uFFFD verified': tags, // a corrupted dash in the field name
  });

  const wording = Array.from({ length: 25 }, (_, i) => sampleRow(geo(100 + i), `Thing ${i} will happen next year`));
  const plain = Array.from({ length: 40 }, (_, i) => sampleRow(geo(200 + i), `Plain statement ${i}`));
  const inputs = {
    audit: [
      audit({ id: geo(1), tag: 'Hypothetical', decision: 'Agree', flags: ['Missing tag'], notes: 'Add Hypothetical: if so, then.', reasoning: 'Ann Lee said so.', tags: 'Unsourced' }),
      audit({ id: geo(2), tag: 'Context-dependent', decision: 'Agree', flags: '["Wrong tag"]', assessment: 'Judgment call', notes: 'Remove Context-dependent: fine.', tags: 'Context-dependent, Unsourced' }),
      audit({ id: geo(3), tag: 'Context-dependent', decision: 'Disagree', flags: ['Missing tag'], notes: 'Your review. Do not add Context-dependent. Bo\u2019s rule.' }),
      audit({ id: geo(4), tag: 'Hypothetical', decision: 'Disagree', flags: ['Wrong tag'] }),
      audit({ id: PROP40, tag: 'Predictive', decision: 'Agree', flags: ['Calibration'], assessment: 'Judgment call', notes: 'Add Predictive: will do harm.' }),
      audit({ id: geo(6), tag: 'Predictive', decision: 'Agree', flags: ['Calibration'], assessment: 'Judgment call', notes: 'Add Predictive: will.' }),
      audit({ id: geo(7), tag: 'Improperly sourced', decision: 'Agree', flags: ['Evidence needed'], assessment: 'Not checkable', notes: 'Add <mention-page url="https://x">Source inaccessible</mention-page>: unread.' }),
      { ...audit({ id: geo(8), tag: 'Exact duplicate', decision: 'Agree', flags: ['Missing tag'], reasoning: 'Ann Lee confirmed.' }), 'Audit key': `${geo(8)}::Exact dublicate` },
      audit({ id: `${FIRST_PREFIX}${'0'.repeat(24)}`, tag: 'Predictive', decision: 'To review', flags: ['Missing tag'], notes: 'Inferred from your reviews. Do not add Predictive. The claim uses a qualified likelihood.' }),
      audit({ id: geo(300), tag: 'Hypothetical', decision: 'To review', flags: ['Missing tag'], claim: 'An open row on a claim that is not Forecast' }),
    ],
    sample: [sampleRow(geo(2), 'Claim 2', { tags: ['Context-dependent', 'Semantically duplicated'], count: 2 }), ...wording, ...plain],
    rawRows: [{ 'Geo ID': geo(2), 'Geo URL': `https://www.geobrowser.io/space/s/${geo(2)}`, 'Geo Sources': '[a](https://g.io/s/1)<br>[b](https://g.io/s/2)' }],
    files: {},
  };
  const config = { anonymise: { replacements: [['Ann Lee', 'the lead'], ["Bo's rule", "the team's rule"]] } };
  const result = seed.buildSeed(inputs, config, { requireSpecialRows: false });
  const decision = (key) => result.decisions.find((d) => d.key === key);

  test('Missing tag / Wrong tag x Agree / Disagree, Calibration and Evidence needed', () => {
    assert.equal(decision(`${geo(1)}::Hypothetical`).seeded_outcome, 'Applies');
    assert.equal(decision(`${geo(2)}::Context-dependent`).seeded_outcome, 'Does not apply', 'a JSON-encoded Flag reason is read as a list');
    assert.equal(decision(`${geo(3)}::Context-dependent`).seeded_outcome, 'Does not apply');
    assert.equal(decision(`${geo(4)}::Hypothetical`).seeded_outcome, 'Applies');
    assert.equal(decision(`${PROP40}::Predictive`).seeded_outcome, 'Applies', 'the named Calibration "will" exception');
    assert.equal(decision(`${geo(6)}::Predictive`).seeded_outcome, null, 'any other Calibration row stays open');
    const evidence = decision(`${geo(7)}::Improperly sourced`);
    assert.equal(evidence.seeded_outcome, null);
    assert.equal(evidence.agent_proposal, 'Read source first');
    assert.equal(evidence.priority, 'Check source');
    assert.ok(evidence.agent_full_note.includes('Add Source inaccessible: unread.'), 'the mention is flattened');
    assert.ok(!evidence.agent_full_note.includes('<mention'));
  });

  test('seeded fields only appear together, and the old tagger decides Keep tag / Do not add tag', () => {
    for (const d of result.decisions) {
      assert.equal(d.seeded_at !== null, d.seeded_outcome !== null, d.key);
      if (d.seeded_outcome === null) assert.equal(d.seeded_reasoning, null, d.key);
      assert.equal(d.rubric_version, 'audit 2026-10-09 (before rubric)');
      assert.equal('tag_outcome' in d, false);
    }
    assert.equal(decision(`${geo(2)}::Context-dependent`).agent_proposal, 'Keep tag');
    assert.equal(decision(`${geo(1)}::Hypothetical`).agent_proposal, 'Do not add tag');
    assert.equal(decision(`${geo(1)}::Hypothetical`).seeded_reasoning, 'The lead said so.', 'names are scrubbed and a sentence start is capitalised');
    assert.equal(decision(`${geo(1)}::Hypothetical`).seeded_at, '2026-10-09');
  });

  test('priority follows the Assessment', () => {
    assert.equal(decision(`${geo(1)}::Hypothetical`).priority, 'High');
    assert.equal(decision(`${geo(2)}::Context-dependent`).priority, 'Medium');
  });

  test('a non-Rulebook tag is excluded, with the misspelled tag normalised and the original key kept', () => {
    assert.equal(result.excluded.length, 1);
    const [row] = result.excluded;
    assert.equal(row.tag, 'Exact duplicate');
    assert.equal(row.key, `${geo(8)}::Exact duplicate`);
    assert.equal(row.audit_key, `${geo(8)}::Exact dublicate`);
    assert.equal(row.reason, 'tag outside the Rulebook');
    assert.equal(row.your_reasoning, 'The lead confirmed.');
    assert.ok(!result.decisions.some((d) => d.tag === 'Exact duplicate'));
  });

  test('the Forecast stratum: prefixes found and not found, then ascending top-up from the wording to 17', () => {
    const r = result.report;
    assert.equal(r.forecast_prefixes_not_found.length, seed.FORECAST_PREFIXES.length - 1);
    assert.ok(!r.forecast_prefixes_not_found.includes(FIRST_PREFIX));
    assert.deepEqual(r.forecast_topped_up_from_wording, wording.slice(0, 16).map((s) => s['Geo ID']), 'ascending Geo ID, only until 17');
    assert.equal(r.claims_by_sample.Forecast, 17);
    assert.equal(r.claims_by_sample.Decided, 7, 'the seven decided Rulebook rows (the Exact duplicate row is excluded)');
  });

  test('an open Predictive/Hypothetical row on a Forecast claim becomes one Auditor-flag row without the prediction text', () => {
    const flags = result.decisions.filter((d) => d.why_in_queue === 'Auditor flag');
    assert.deepEqual(flags.map((d) => d.key), [`${FIRST_PREFIX}${'0'.repeat(24)}::Predictive`], 'an open row on a claim outside Forecast is not seeded');
    assert.equal(flags[0].seeded_outcome, null);
    assert.equal(flags[0].agent_full_note, 'Old answer: To review \u00b7 Flag reason: Missing tag \u00b7 Assessment: Likely error');
    assert.deepEqual(result.report.forecast_claims_without_an_open_predictive_or_hypothetical_row.length, 16, 'topped-up claims have no audit row and none is invented');
  });

  test('the Random stratum is the first 10 of the seeded shuffle of the sorted remaining sample claims', () => {
    const taken = new Set(result.claims.filter((c) => c.sample !== 'Random').map((c) => c.geo_id));
    const pool = inputs.sample.map((s) => s['Geo ID']).filter((g) => !taken.has(g)).sort();
    const expected = seed.seededShuffle(pool, seed.RANDOM_SEED).slice(0, seed.RANDOM_COUNT);
    assert.deepEqual(result.report.random.geo_ids, expected);
    assert.deepEqual(result.claims.filter((c) => c.sample === 'Random').map((c) => c.geo_id), expected.slice().sort());
  });

  test('claim fields: the corrupted tags field is found, tags are intersected with the Rulebook, sources come from the raw export', () => {
    const c = result.claims.find((x) => x.geo_id === geo(2));
    assert.deepEqual(c.agent_tags, ['Context-dependent']);
    assert.ok(c.seed_notes.includes('Semantically duplicated'));
    assert.equal(c.sources_count, 2);
    assert.deepEqual(c.source_urls, ['https://g.io/s/1', 'https://g.io/s/2']);
    assert.equal(c.geo_link, `https://www.geobrowser.io/space/s/${geo(2)}`);
    assert.equal(c.table, 'U.S. Politics');
    assert.deepEqual(c.audit_row_urls, ['https://app.notion.com/p/audit-' + geo(2)]);
    const audited = result.claims.find((x) => x.geo_id === geo(1));
    assert.equal(audited.sources_count, null);
    assert.ok(audited.seed_notes.startsWith('sources_count unknown locally'));
    assert.deepEqual(audited.agent_tags, ['Unsourced'], 'a claim outside the sample takes the tags of its audit row');
    assert.deepEqual(result.report.sample_quality_tags_field, ['Claim quality tags \uFFFD verified']);
  });

  test('records are sorted: claims by stratum then Geo ID, decisions and excluded by key', () => {
    const order = { Decided: 0, Forecast: 1, Random: 2 };
    const sorted = result.claims.slice().sort((a, b) => order[a.sample] - order[b.sample] || (a.geo_id < b.geo_id ? -1 : 1));
    assert.deepEqual(result.claims.map((c) => c.geo_id), sorted.map((c) => c.geo_id));
    const keys = result.decisions.map((d) => d.key);
    assert.deepEqual(keys, keys.slice().sort());
  });

  test('a missing replacement list, or a missing named check-by-hand row, stops the build', () => {
    assert.throws(() => seed.buildSeed(inputs, { anonymise: {} }, { requireSpecialRows: false }), seed.InputError);
    assert.throws(() => seed.buildSeed(inputs, config), /check-by-hand audit row/, 'the named check-by-hand rows are required by default');
  });
});

// ---------- part 2: the real research data ---------------------------------------------------------------------------

const real = HAVE_RESEARCH
  ? (() => {
      const inputs = seed.loadInputs(RESEARCH);
      const config = seed.loadConfig();
      const result = seed.buildSeed(inputs, config);
      return { inputs, config, result, files: seed.renderFiles(result) };
    })()
  : null;

describe('real research data', { skip: HAVE_RESEARCH ? false : `research folder not found: ${RESEARCH}` }, () => {
  const { result, files, config } = real ?? { result: null, files: null, config: null };
  const byKey = (key) => result.decisions.find((d) => d.key.startsWith(key));

  test('counts: 60 claims in three strata, 50 decisions, 24 excluded', () => {
    const r = result.report;
    assert.deepEqual(r.claims_by_sample, { Decided: 33, Forecast: 17, Random: 10 });
    assert.equal(r.claims_total, 60);
    assert.equal(new Set(result.claims.map((c) => c.geo_id)).size, 60, 'deduplicated by Geo ID');
    assert.equal(r.decisions_total, 50);
    assert.deepEqual(r.decisions_by_why_in_queue, { 'Auditor flag': 17, 'Seeded decision': 33 });
    assert.deepEqual(r.decisions_by_seeded_outcome, { Applies: 17, 'Does not apply': 10, open: 23 });
    assert.equal(r.decisions_with_seeded_outcome, 27);
    assert.deepEqual(r.decisions_by_tag, { 'Context-dependent': 10, Hypothetical: 15, 'Improperly sourced': 6, Predictive: 18, Unsourced: 1 });
    assert.deepEqual(r.decisions_by_priority, { 'Check source': 5, High: 27, Medium: 18 });
    assert.deepEqual(r.decisions_by_agent_proposal, { 'Do not add tag': 40, 'Keep tag': 6, 'Read source first': 4 });
    assert.equal(r.excluded_total, 24);
    assert.deepEqual(r.excluded_by_tag, { 'Exact duplicate': 2, 'Factually challenged': 2, 'Incorrect grammar': 2, 'Poor wording': 3, 'Semantically duplicated': 12, Wordy: 3 });
    assert.equal(new Set(result.decisions.map((d) => d.key)).size, 50, 'one row per claim x tag');
  });

  test('Forecast: all 17 prefixes found, each claim has its Auditor-flag row, nothing is invented', () => {
    const r = result.report;
    assert.deepEqual(r.forecast_prefixes_not_found, []);
    assert.deepEqual(Object.keys(r.forecast_geo_ids_by_prefix), [...seed.FORECAST_PREFIXES]);
    for (const [prefix, ids] of Object.entries(r.forecast_geo_ids_by_prefix)) assert.deepEqual(ids.map((g) => g.slice(0, 8)), [prefix]);
    assert.deepEqual(r.forecast_topped_up_from_wording, []);
    assert.deepEqual(r.forecast_prefix_claims_already_decided, []);
    assert.deepEqual(r.forecast_claims_without_an_open_predictive_or_hypothetical_row, []);
    for (const prefix of seed.FORECAST_PREFIXES) {
      const claims = result.claims.filter((c) => c.geo_id.startsWith(prefix));
      assert.equal(claims.length, 1, prefix);
      assert.equal(claims[0].sample, 'Forecast', prefix);
      const rows = result.decisions.filter((d) => d.geo_id === claims[0].geo_id);
      assert.equal(rows.length, 1, prefix);
      assert.equal(rows[0].why_in_queue, 'Auditor flag');
      assert.ok(['Predictive', 'Hypothetical'].includes(rows[0].tag));
    }
    assert.equal(result.decisions.filter((d) => d.why_in_queue === 'Auditor flag').length, 17);
  });

  test('Decided: every claim with a decided Rulebook row, nothing else', () => {
    const decided = result.claims.filter((c) => c.sample === 'Decided').map((c) => c.geo_id).sort();
    const fromDecisions = [...new Set(result.decisions.filter((d) => d.why_in_queue === 'Seeded decision').map((d) => d.geo_id))].sort();
    assert.deepEqual(decided, fromDecisions);
    assert.equal(decided.length, 33);
  });

  test('Random: the seeded draw, 10 distinct sample claims outside the other strata', () => {
    const { geo_ids: drawn, seed: s } = result.report.random;
    assert.equal(s, 20261013);
    assert.equal(drawn.length, 10);
    const sample = real.inputs.sample.map((x) => x['Geo ID']);
    for (const g of drawn) assert.ok(sample.includes(g), `${g} is in the 13 Oct sample`);
    assert.deepEqual(result.claims.filter((c) => c.sample === 'Random').map((c) => c.geo_id), drawn.slice().sort());
    const others = new Set(result.claims.filter((c) => c.sample !== 'Random').map((c) => c.geo_id));
    for (const g of drawn) assert.ok(!others.has(g));
    const pool = sample.filter((g) => !others.has(g)).sort();
    assert.equal(result.report.random.pool_size, pool.length);
    assert.deepEqual(drawn, seed.seededShuffle(pool, 20261013).slice(0, 10));
  });

  test('the special rows: Ukraine, birthright, the four Evidence-needed rows, the hedged forecasts, the Calibration "will" rows, Wordy', () => {
    const ukraine = byKey('8114bb42');
    assert.equal(ukraine.tag, 'Hypothetical');
    assert.equal(ukraine.seeded_outcome, null);
    assert.equal(ukraine.priority, 'High');
    const birthright = byKey('1a4c0008');
    assert.equal(birthright.seeded_outcome, null);
    assert.equal(birthright.priority, 'Check source');
    for (const prefix of ['15dcb1af', 'd2523b60', '1516d532', '975f63ff']) {
      const row = byKey(prefix);
      assert.equal(row.tag, 'Improperly sourced');
      assert.equal(row.seeded_outcome, null);
      assert.equal(row.agent_proposal, 'Read source first');
      assert.equal(row.priority, 'Check source');
    }
    for (const prefix of ['f376c2cc', '6aa014be']) {
      const row = byKey(prefix);
      assert.equal(row.tag, 'Predictive');
      assert.equal(row.seeded_outcome, 'Does not apply');
      assert.equal(row.why_wrong_hint, 'Rule should change');
      assert.ok(row.seeded_reasoning);
    }
    assert.deepEqual(result.report.decisions_with_why_wrong_hint, ['6aa014be141b4c6dab2c3c180f963639::Predictive', 'f376c2cc2f6f4338893cce864ec82c02::Predictive']);
    for (const prefix of ['807f9fa0', 'c7ff945e']) assert.equal(byKey(prefix).seeded_outcome, 'Applies');
    assert.equal(result.decisions.filter((d) => d.tag === 'Wordy').length, 0);
    assert.equal(result.excluded.filter((d) => d.tag === 'Wordy').length, 3);
    assert.equal(result.checkRows.length, 11);
    assert.deepEqual(result.report.check_by_hand_rows.map((c) => c.key.slice(0, 8)),
      ['8114bb42', '1a4c0008', '1516d532', '15dcb1af', '975f63ff', 'd2523b60', '15212f28', '6aa014be', 'f376c2cc', '807f9fa0', 'c7ff945e']);
  });

  test('the mapping agrees with the research cases for all 27 seeded outcomes', () => {
    const cross = result.report.cross_check_cases;
    assert.equal(cross.cases_file_found, true);
    assert.equal(cross.seeded_rows_compared, 27);
    assert.equal(cross.agree, 27);
    assert.deepEqual(cross.disagree, []);
  });

  test('the three inferred notes are dropped whole and no prediction text is seeded', () => {
    for (const prefix of ['f06b756f', '6e820a8a', '8172f325']) {
      assert.equal(byKey(prefix).agent_full_note, 'Old answer: To review \u00b7 Flag reason: Missing tag \u00b7 Assessment: ' + (prefix === '6e820a8a' ? 'Likely error' : 'Judgment call'));
    }
    for (const d of result.decisions) {
      assert.ok(!/Do not add Predictive/i.test(d.agent_full_note), d.key);
      assert.ok(d.agent_full_note.startsWith('Old answer: '), d.key);
      assert.ok(d.why_i_recommend_this.startsWith('Audit (9 Oct): '), d.key);
      assert.ok(d.agent_full_note.length <= 1900, d.key);
    }
  });

  test('anonymisation: no name from the config, no inferred prediction, no editor field, in any emitted file', () => {
    const names = [...new Set(config.anonymise.replacements.flatMap(([from]) => from.split(/[^\p{L}]+/u)).filter((w) => /^\p{Lu}/u.test(w) && w.length >= 3))];
    assert.ok(names.length >= 3, 'the config names are read from config.json, not typed here');
    for (const [name, text] of files) {
      for (const n of names) assert.ok(!text.includes(n), `${name} contains a name from the anonymise list`);
      assert.ok(!/Inferred from your reviews/i.test(text), `${name} contains an inferred prediction`);
      assert.ok(!/tag_outcome/i.test(text), `${name} mentions tag_outcome`);
      assert.ok(!/<mention-/.test(text), `${name} still has a Notion mention`);
      assert.ok(!/<br\s*\/?>/i.test(text), `${name} still has <br>`);
    }
    assert.equal(result.report.scrub_replacements_applied.total, 4, 'the only names in the emitted fields sit in the excluded Poor wording rows');
    assert.deepEqual(Object.keys(result.report.scrub_replacements_applied.by_replacement_text).sort(),
      [...new Set(config.anonymise.replacements.map(([, to]) => to))].sort(), 'the report is keyed by role, not by name');
    const excluded = jsonl(files.get('excluded-decisions.jsonl'));
    assert.ok(excluded.some((e) => /\bthe auditor\b/i.test(e.why_i_recommend_this)), 'the replaced text reads naturally');
  });

  test('record shapes', () => {
    const claim = result.claims[0];
    assert.deepEqual(Object.keys(claim), ['geo_id', 'claim', 'geo_link', 'sources_count', 'source_urls', 'table', 'sample', 'agent_tags', 'audit_row_urls', 'seed_notes']);
    const decision = result.decisions[0];
    assert.deepEqual(Object.keys(decision), ['key', 'geo_id', 'tag', 'claim', 'audit_row_url', 'agent_proposal', 'why_i_recommend_this', 'agent_full_note',
      'why_in_queue', 'priority', 'rubric_version', 'seeded_outcome', 'seeded_reasoning', 'seeded_at', 'why_wrong_hint']);
    const rulebook = new Set(seed.RULEBOOK_TAGS);
    for (const c of result.claims) {
      assert.match(c.geo_id, /^[0-9a-f]{32}$/);
      assert.equal(c.table, 'U.S. Politics');
      assert.ok(c.geo_link.endsWith(c.geo_id), c.geo_id);
      assert.ok(c.sources_count === null || Number.isInteger(c.sources_count), c.geo_id);
      assert.ok(Array.isArray(c.source_urls));
      for (const t of c.agent_tags) assert.ok(rulebook.has(t), `${c.geo_id}: ${t}`);
      if (c.sources_count !== null) assert.equal(c.source_urls.length, c.sources_count, c.geo_id);
      assert.equal(c.sources_count === null, c.seed_notes.includes('sources_count unknown locally'), c.geo_id);
    }
    for (const d of result.decisions) {
      assert.ok(rulebook.has(d.tag), d.key);
      assert.equal(d.key, `${d.geo_id}::${d.tag}`);
      assert.ok(['Keep tag', 'Do not add tag', 'Read source first'].includes(d.agent_proposal), d.key);
      assert.ok(['High', 'Medium', 'Check source'].includes(d.priority), d.key);
      assert.ok([null, 'Applies', 'Does not apply'].includes(d.seeded_outcome), d.key);
      assert.ok(result.claims.some((c) => c.geo_id === d.geo_id), `${d.key} has its claim`);
    }
    for (const e of result.excluded) {
      assert.ok(!rulebook.has(e.tag), e.key);
      assert.equal(e.reason, 'tag outside the Rulebook');
    }
    assert.deepEqual(result.claims.filter((c) => c.sources_count === null).map((c) => c.geo_id).sort(), result.report.claims_with_unknown_sources_count.geo_ids);
    assert.equal(result.report.claims_with_unknown_sources_count.count, 30);
    const pages = result.report.claims_with_unknown_sources_count.claim_page_urls;
    assert.deepEqual(Object.keys(pages), result.report.claims_with_unknown_sources_count.geo_ids, 'each unknown claim has its Notion page for the read-only fetch');
    for (const url of Object.values(pages)) assert.match(url, /^https:\/\/app\.notion\.com\/p\/[0-9a-f]{32}$/);
  });

  test('ordering: claims by stratum then Geo ID, decisions and excluded by key', () => {
    const order = { Decided: 0, Forecast: 1, Random: 2 };
    const claims = result.claims;
    for (let i = 1; i < claims.length; i += 1) {
      const a = claims[i - 1];
      const b = claims[i];
      assert.ok(order[a.sample] < order[b.sample] || (order[a.sample] === order[b.sample] && a.geo_id < b.geo_id), `${a.geo_id} before ${b.geo_id}`);
    }
    const keys = result.decisions.map((d) => d.key);
    assert.deepEqual(keys, keys.slice().sort());
    const ex = result.excluded.map((d) => d.key);
    assert.deepEqual(ex, ex.slice().sort());
  });

  test('the output is deterministic and uses \\n line endings', () => {
    const again = seed.renderFiles(seed.buildSeed(seed.loadInputs(RESEARCH), seed.loadConfig()));
    assert.deepEqual([...again.keys()], ['claims.seed.jsonl', 'decisions.seed.jsonl', 'excluded-decisions.jsonl', 'seed-report.json', 'check-by-hand.md']);
    for (const [name, text] of files) {
      assert.equal(again.get(name), text, `${name} changed between two builds`);
      assert.ok(!text.includes('\r'), `${name} has a carriage return`);
      assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), `${name} ends with exactly one newline`);
      assert.ok(!text.startsWith('\uFEFF'));
    }
    assert.deepEqual(jsonl(files.get('claims.seed.jsonl')), result.claims);
    assert.deepEqual(jsonl(files.get('decisions.seed.jsonl')), result.decisions);
    assert.deepEqual(jsonl(files.get('excluded-decisions.jsonl')), result.excluded);
    assert.deepEqual(JSON.parse(files.get('seed-report.json')), result.report);
  });

  test('check-by-hand.md lists the 11 special rows', () => {
    const md = files.get('check-by-hand.md');
    const rows = md.split('\n').filter((l) => /^\| \d+ \|/.test(l));
    assert.equal(rows.length, 11);
    assert.ok(md.includes('| # | Claim | Tag | Old answer'));
    assert.ok(md.includes('Wordy'));
    assert.ok(md.includes('Ukraine'));
  });

  test('the command line writes the five files and matches the in-memory build', () => {
    const out = tmpDir();
    try {
      const run = spawnSync(process.execPath, [SCRIPT, '--research', RESEARCH, '--out', out], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /claims\.seed\.jsonl\s+60 rows/);
      assert.match(run.stdout, /decisions\.seed\.jsonl\s+50 rows/);
      assert.deepEqual(fs.readdirSync(out).sort(), ['check-by-hand.md', 'claims.seed.jsonl', 'decisions.seed.jsonl', 'excluded-decisions.jsonl', 'seed-report.json']);
      for (const [name, text] of files) assert.equal(fs.readFileSync(path.join(out, name), 'utf8'), text, name);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('the command line refuses a missing research folder and unknown arguments with exit code 2', () => {
    const out = tmpDir();
    try {
      const missing = spawnSync(process.execPath, [SCRIPT, '--research', path.join(out, 'nope'), '--out', out], { encoding: 'utf8' });
      assert.equal(missing.status, 2);
      assert.match(missing.stderr, /research folder not found/);
      const bad = spawnSync(process.execPath, [SCRIPT, '--nonsense'], { encoding: 'utf8' });
      assert.equal(bad.status, 2);
      assert.deepEqual(fs.readdirSync(out), [], 'nothing is written on a refusal');
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  test('the committed seed files are up to date with the builder', (t) => {
    const present = [...files.keys()].filter((name) => fs.existsSync(path.join(COMMITTED, name)));
    if (!present.length) return t.skip('no committed seed files yet; run seed-build.mjs');
    for (const name of files.keys()) {
      assert.ok(fs.existsSync(path.join(COMMITTED, name)), `${name} is missing from agents/claim-tagger/evals/seed; run seed-build.mjs`);
      // a checkout with core.autocrlf would turn \n into \r\n on disk; the builder itself always writes \n
      const onDisk = fs.readFileSync(path.join(COMMITTED, name), 'utf8').replace(/\r\n/g, '\n');
      assert.equal(onDisk, files.get(name), `${name} is stale; run node agents/claim-tagger/scripts/seed-build.mjs`);
    }
  });
});
