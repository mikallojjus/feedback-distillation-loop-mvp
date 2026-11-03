import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { h16 } from '../../agents/claim-tagger-mvp/scripts/lib/hash.mjs';
import { compareCodePoints, pyJson } from '../../agents/claim-tagger-mvp/scripts/lib/pyjson.mjs';
import {
  DRIFT_COLUMNS, LEGACY_JUDGED_TAGS, buildRubric, checkLock, computeDrift, lockOf, lockedJudged, nextEdition, parseExamples, parseRules, readEdition, readLock, readRubric, tagFromRow, toggleClauses,
  verifyRubric, writeEdition,
} from '../../agents/claim-tagger-mvp/scripts/lib/rubric.mjs';
import { validate } from '../../agents/claim-tagger-mvp/scripts/lib/validate.mjs';
import { placeholderConfig } from './helpers/config-fixture.mjs';

const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-rubric-'));
  roots.push(dir);
  return dir;
}

const config = placeholderConfig();
const fixtureRows = JSON.parse(readFileSync(new URL('./fixtures/rulebook-rows.json', import.meta.url), 'utf8'));
const rows = () => structuredClone(fixtureRows);
const rowOf = (list, name) => list.find((r) => r.Name === name);
const NOW = new Date('2026-10-16T09:00:00.000Z');
const build = (list = rows(), over = {}) => buildRubric(list, { config, edition: '2026-10-16.1', now: NOW, ...over });
const tagOf = (rubric, name) => rubric.tags.find((t) => t.name === name);
const schema = JSON.parse(readFileSync(new URL('../../agents/claim-tagger-mvp/schemas/rubric.schema.json', import.meta.url), 'utf8'));

// ---- parseRules ----------------------------------------------------------------------------------------------------------------

test('parseRules: Context-dependent has five rules, no preamble and no note', () => {
  const parsed = parseRules(rowOf(rows(), 'Context-dependent')['When to use']);
  assert.equal(parsed.rules.length, 5);
  assert.deepEqual(parsed.rules.map((r) => r.n), [1, 2, 3, 4, 5]);
  assert.equal(parsed.preamble, '');
  assert.equal(parsed.note, '');
  assert.match(parsed.rules[0].text, /^A pronoun with no antecedent inside the claim/);
  assert.match(parsed.rules[2].text, /^A descriptive definite that names a kind of thing but not which one .*Applies to countable things, not to abstract or mass nouns/);
  assert.match(parsed.rules[3].text, /^Test: could a reader who sees only this sentence/);
  assert.equal(parsed.rules[4].text, 'Do not use for indefinites, time expressions, generics, or definites the claim itself resolves.');
});

test('parseRules: a preamble comes before rule 1 and a labelled note after the last rule', () => {
  const unsourced = parseRules(rowOf(rows(), 'Unsourced')['When to use']);
  assert.match(unsourced.preamble, /^Deterministic, not a language judgment: read the Claim's Sources relation on Geo/);
  assert.equal(unsourced.rules.length, 4);
  assert.equal(unsourced.note, '');
  const inaccessible = parseRules(rowOf(rows(), 'Source inaccessible')['When to use']);
  assert.equal(inaccessible.preamble, '');
  assert.equal(inaccessible.rules.length, 5);
  assert.equal(inaccessible.note, 'Editorial rule confirmed by the editor on 11 October 2026; not an accuracy benchmark.', 'the "Note:" label is not part of the note');
  assert.equal(parseRules('Pre.\n1. A.\n2. B.\nNotes: n1\nn2').note, 'n1 n2');
  assert.equal(parseRules('1. A.\nNOTE:   shouted').note, 'shouted');
});

test('parseRules: a note without a label counts as a note after a finished rule or after a blank line', () => {
  assert.deepEqual(parseRules('1. First rule.\n2. Last rule.\nA closing remark.'), { preamble: '', rules: [{ n: 1, text: 'First rule.' }, { n: 2, text: 'Last rule.' }], note: 'A closing remark.' });
  assert.deepEqual(parseRules('1. First rule.\n2. Last rule without a stop\n\nSeparate remark'), { preamble: '', rules: [{ n: 1, text: 'First rule.' }, { n: 2, text: 'Last rule without a stop' }], note: 'Separate remark' });
  assert.equal(parseRules('1. Ends with a quote "like this"\nRemark').note, 'Remark');
  assert.equal(parseRules('1. Ends with a bracket (like this)\nRemark').note, 'Remark');
  assert.equal(parseRules('1. Ends with a question?\nRemark').note, 'Remark');
});

test('parseRules: a rule may continue on the next lines', () => {
  const between = parseRules('1. First part of rule one,\nsecond part of rule one.\n2. Rule two.');
  assert.deepEqual(between.rules, [{ n: 1, text: 'First part of rule one, second part of rule one.' }, { n: 2, text: 'Rule two.' }]);
  assert.equal(between.note, '');
  const betweenSentences = parseRules('1. One sentence.\nAnother sentence of the same rule.\n2. Rule two.');
  assert.equal(betweenSentences.rules[0].text, 'One sentence. Another sentence of the same rule.', 'between two rules every line belongs to the rule above');
  const blankBetween = parseRules('1. Rule one,\n\ncontinued after a blank line.\n2. Rule two.');
  assert.equal(blankBetween.rules[0].text, 'Rule one, continued after a blank line.');
  const last = parseRules('1. Rule one.\n2. The last rule goes on,\nover three\nlines.\nThen a note.');
  assert.equal(last.rules[1].text, 'The last rule goes on, over three lines.');
  assert.equal(last.note, 'Then a note.');
  const stopsAtLabel = parseRules('1. The last rule has not ended,\nNote: but this is a note.');
  assert.equal(stopsAtLabel.rules[0].text, 'The last rule has not ended,');
  assert.equal(stopsAtLabel.note, 'but this is a note.');
});

test('parseRules: both "1." and "1)" start a rule, numbers are kept as written, and a number needs text after it', () => {
  const parsed = parseRules('Pre\n3) Three.\n4. Four.\n10) Ten.');
  assert.deepEqual(parsed.rules, [{ n: 3, text: 'Three.' }, { n: 4, text: 'Four.' }, { n: 10, text: 'Ten.' }]);
  assert.equal(parsed.preamble, 'Pre');
  const notRules = parseRules('1.no space\n(1) bracketed\n1.\n12\nJust text.');
  assert.deepEqual(notRules.rules, []);
  assert.equal(notRules.preamble, '1.no space (1) bracketed 1. 12 Just text.');
});

test('parseRules: an empty, missing or rule-less text has no rules and never throws', () => {
  for (const text of [null, undefined, '', '   ', '\n\n', 42]) {
    const parsed = parseRules(text);
    assert.deepEqual(parsed.rules, [], String(text));
    assert.equal(typeof parsed.preamble, 'string');
    assert.equal(parsed.note, '');
  }
  assert.deepEqual(parseRules('Only a line.\nAnd another.'), { preamble: 'Only a line. And another.', rules: [], note: '' });
});

test('parseRules: Windows line ends, <br> line breaks, blank lines and markdown escapes do not matter', () => {
  const clean = parseRules('Pre.\n1. One.\n2. Two *bold*.\nNote: n.');
  const noisy = parseRules('Pre.\r\n\r\n1. One.<br>\r\n\r\n2. Two \\*bold\\*.<br/>Note: n.\r\n');
  assert.deepEqual(noisy, clean);
});

// ---- parseExamples -------------------------------------------------------------------------------------------------------------

test('parseExamples: Context-dependent has six examples, one per line', () => {
  const examples = parseExamples(rowOf(rows(), 'Context-dependent')['Example Claims']);
  assert.equal(examples.length, 6);
  assert.equal(examples[0], "Open AI's initiative went well with the target group.");
  assert.equal(examples[5], 'The Bitcoin ETF successfully integrated Bitcoin into traditional brokerage accounts.');
});

test('parseExamples: a leading "- ", surrounding quotes (straight or curly) and spaces are taken off', () => {
  const text = [
    '- First claim here.',
    '  -   Second claim, with spaces.  ',
    '"Third claim in straight quotes."',
    '“Fourth claim in curly quotes.”',
    '- “Fifth claim, bullet and curly quotes.”',
    '‘Sixth claim in single curly quotes.’',
    "'Seventh claim in single straight quotes.'",
    '',
    '   ',
    'Eighth claim, plain.',
  ].join('\n');
  assert.deepEqual(parseExamples(text), [
    'First claim here.', 'Second claim, with spaces.', 'Third claim in straight quotes.', 'Fourth claim in curly quotes.', 'Fifth claim, bullet and curly quotes.',
    'Sixth claim in single curly quotes.', 'Seventh claim in single straight quotes.', 'Eighth claim, plain.',
  ]);
});

test('parseExamples: quotes that are part of the claim stay', () => {
  assert.deepEqual(parseExamples('He said "yes" and left.\n"A" and "B"\n“Quoted” and “again”\nShe said "no"\n"Not closed\nIt\'s fine.'), [
    'He said "yes" and left.', '"A" and "B"', '“Quoted” and “again”', 'She said "no"', '"Not closed', "It's fine.",
  ]);
  assert.deepEqual(parseExamples('"He said \'yes\' to it."'), ["He said 'yes' to it."]);
  assert.deepEqual(parseExamples('""'), [], 'only quotes: no letters');
});

test('parseExamples: lines without a letter, over 400 characters, or about legacy linked claims are dropped', () => {
  const long = (n) => `${'x'.repeat(n - 1)}.`;
  const text = ['123', '---', '- ', '“”', '...', long(400), long(401), '255 legacy linked claims; see https://example.com/page', 'A LEGACY Linked Claims note.', 'Kept claim.'].join('\n');
  assert.deepEqual(parseExamples(text), [long(400), 'Kept claim.']);
  assert.equal(parseExamples(long(400))[0].length, 400);
  assert.deepEqual(parseExamples(`${'é'.repeat(399)}.`).length, 1, 'length is counted in characters');
  assert.deepEqual(parseExamples(`${'😀'.repeat(401)}a`), [], '402 characters, counted as characters and not as UTF-16 units');
  assert.deepEqual(parseExamples(`${'😀'.repeat(399)}a`).length, 1);
  assert.deepEqual(parseExamples('Ünïcödé claim.'), ['Ünïcödé claim.']);
  assert.deepEqual(parseExamples('2024 …'), [], 'digits and punctuation are not letters');
});

test('parseExamples: empty and missing input, an array, CRLF and <br>', () => {
  for (const v of [null, undefined, '', '   \n  ']) assert.deepEqual(parseExamples(v), []);
  assert.deepEqual(parseExamples(['One claim.', '- Two claim.']), ['One claim.', 'Two claim.']);
  assert.deepEqual(parseExamples('One claim.\r\nTwo claim.<br>Three claim.'), ['One claim.', 'Two claim.', 'Three claim.']);
});

// ---- tagFromRow ----------------------------------------------------------------------------------------------------------------

test('tagFromRow: Context-dependent is a judged text tag with its rules, examples and every column', () => {
  const tag = tagFromRow(rowOf(rows(), 'Context-dependent'), config);
  assert.deepEqual(Object.keys(tag), [
    'name', 'page_id', 'category', 'polarity', 'status', 'counterpart', 'description', 'when_to_use', 'rules', 'example_claims', 'geo_status', 'geo_tag_id',
    'verified_on', 'evidence', 'work_tags', 'capability', 'judged', 'tag_hash',
  ]);
  assert.equal(tag.name, 'Context-dependent');
  assert.equal(tag.page_id, '765273e214eb83458bd7819ebe81bd9e');
  assert.equal(tag.category, 'Quality');
  assert.equal(tag.polarity, 'Issue');
  assert.equal(tag.status, 'Verified');
  assert.equal(tag.counterpart, 'Self-contained');
  assert.match(tag.description, /^A claim whose meaning depends on something introduced outside it/);
  assert.equal(tag.when_to_use, rowOf(rows(), 'Context-dependent')['When to use'], 'the raw text is kept');
  assert.equal(tag.rules.length, 5);
  assert.equal(tag.example_claims.length, 6);
  assert.equal(tag.geo_status, 'To be created');
  assert.equal(tag.geo_tag_id, null);
  assert.equal(tag.verified_on, '2026-09-10');
  assert.equal(tag.evidence, 'https://app.notion.com/3cf273e214eb81f2a815e7a751512a07');
  assert.deepEqual(tag.work_tags, ['Issue', 'Pipeline benchmark check']);
  assert.equal(tag.capability, 'text');
  assert.equal(tag.judged, true);
  assert.equal(tag.tag_hash, 'sha256:af49109ca891789f', 'pinned: the recipe is h16(pyJson({ name, rules: [text, ...] }))');
  assert.equal(tag.tag_hash, h16(pyJson({ name: tag.name, rules: tag.rules.map((r) => r.text) })));
});

test('tagFromRow: a tag without rules is not judged, whatever else its row says', () => {
  const wordy = tagFromRow(rowOf(rows(), 'Wordy'), config);
  assert.equal(wordy.capability, 'text');
  assert.deepEqual(wordy.rules, []);
  assert.equal(wordy.judged, false);
  assert.equal(wordy.when_to_use, '');
  assert.deepEqual(wordy.example_claims, []);
  assert.equal(wordy.status, 'Proposed');
  const withText = tagFromRow({ ...rowOf(rows(), 'Wordy'), 'When to use': 'Judge by feel. No numbered rules here.' }, config);
  assert.equal(withText.judged, false, 'a preamble alone is not a rule');
  assert.equal(withText.when_to_use, 'Judge by feel. No numbered rules here.');
});

test('tagFromRow: a tag with rules is judged only when its capability is text, even with its Judged box ticked', () => {
  const list = rows();
  for (const [name, capability] of [['Unsourced', 'deterministic'], ['Improperly sourced', 'source'], ['Source inaccessible', 'source']]) {
    const tag = tagFromRow({ ...rowOf(list, name), Judged: true }, config);
    assert.ok(tag.rules.length >= 4, name);
    assert.equal(tag.capability, capability);
    assert.equal(tag.judged, false, name);
  }
  assert.equal(tagFromRow({ ...rowOf(list, 'Exact duplicate'), Judged: true }, config).capability, 'corpus');
});

test('tagFromRow: the Judged box derives judged (ticked, rules in force and a text tag); an unticked tag with rules is not judged', () => {
  const row = rowOf(rows(), 'Context-dependent');
  assert.equal(row.Judged, true, 'the fixture ticks Context-dependent');
  assert.equal(tagFromRow(row, config).judged, true);
  for (const unticked of [{ Judged: false }, { Judged: null }, { Judged: 'true' }, { Judged: 1 }]) {
    const tag = tagFromRow({ ...row, ...unticked }, config);
    assert.equal(tag.judged, false, JSON.stringify(unticked));
    assert.equal(tag.rules.length, 5, 'the rules are read all the same');
  }
  const absent = { ...row };
  delete absent.Judged;
  assert.equal(tagFromRow(absent, config).judged, false, 'a row with no Judged column is not ticked');
  // ticked, but nothing to judge by: no rules in force
  assert.equal(tagFromRow({ ...rowOf(rows(), 'Wordy'), Judged: true }, config).judged, false);
  // the option `ticked` stands in for the row's box
  assert.equal(tagFromRow({ ...row, Judged: false }, config, { ticked: true }).judged, true);
  assert.equal(tagFromRow(row, config, { ticked: false }).judged, false);
});

test('tagFromRow: missing keys are null, empty text is null, and a text without letters in Name is still a name', () => {
  const tag = tagFromRow({ Name: '  Plain  ' }, config);
  assert.equal(tag.name, 'Plain');
  for (const key of ['page_id', 'category', 'polarity', 'status', 'counterpart', 'geo_status', 'geo_tag_id', 'verified_on', 'evidence']) assert.equal(tag[key], null, key);
  assert.equal(tag.description, '');
  assert.equal(tag.when_to_use, '');
  assert.deepEqual(tag.rules, []);
  assert.deepEqual(tag.example_claims, []);
  assert.deepEqual(tag.work_tags, []);
  assert.equal(tagFromRow({ Name: 'X', Counterpart: '  ', Evidence: '' }, config).counterpart, null);
});

test('tagFromRow: a row needs a Name and must be an object', () => {
  assert.throws(() => tagFromRow({}, config), /the row has no Name/);
  assert.throws(() => tagFromRow({ Name: '   ' }, config), /the row has no Name/);
  assert.throws(() => tagFromRow({ Name: null }, config), /the row has no Name/);
  for (const bad of [null, undefined, 'text']) assert.throws(() => tagFromRow(bad, config), /must be an object/);
});

test('tag_hash covers the name and the rule texts only, and does not depend on the order of keys in the row', () => {
  const row = rowOf(rows(), 'Context-dependent');
  const reordered = Object.fromEntries(Object.entries(row).reverse());
  assert.notDeepEqual(Object.keys(reordered), Object.keys(row));
  const hash = tagFromRow(row, config).tag_hash;
  assert.equal(tagFromRow(reordered, config).tag_hash, hash);
  // ticking or unticking a tag changes nothing about its hash (nor the rubric's), so no store of any group is lost to a toggle
  for (const change of [{ Description: 'Another description.' }, { 'Example Claims': 'Only one claim.' }, { Counterpart: null }, { Polarity: 'Positive' }, { page_id: 'x' }, { Status: 'Proposed' }, { Judged: false }, { Judged: true }]) {
    assert.equal(tagFromRow({ ...row, ...change }, config).tag_hash, hash, JSON.stringify(Object.keys(change)));
  }
  assert.equal(tagFromRow({ ...row, 'When to use': `Note first.\n${row['When to use']}\nNote: last.` }, config).tag_hash, hash, 'a preamble and a note are not rules');
  assert.equal(tagFromRow({ ...row, 'When to use': row['When to use'].replace(/\n/g, '\r\n  ') }, config).tag_hash, hash, 'spacing around the rules does not change them');
  assert.notEqual(tagFromRow({ ...row, Name: 'Context dependent' }, config).tag_hash, hash);
  assert.notEqual(tagFromRow({ ...row, 'When to use': row['When to use'].replace('A pronoun', 'The pronoun') }, config).tag_hash, hash);
  assert.notEqual(tagFromRow({ ...row, 'When to use': row['When to use'].split('\n').slice(1).join('\n') }, config).tag_hash, hash, 'a rule less');
});

// ---- buildRubric ---------------------------------------------------------------------------------------------------------------

test('buildRubric: the shape of the rubric, tags sorted by name, hashes recomputable', () => {
  const rubric = build();
  assert.deepEqual(Object.keys(rubric), ['edition', 'built_at', 'source', 'tags', 'rubric_hash']);
  assert.equal(rubric.edition, '2026-10-16.1');
  assert.equal(rubric.built_at, '2026-10-16T09:00:00.000Z');
  assert.deepEqual(rubric.tags.map((t) => t.name), ['Context-dependent', 'Exact duplicate', 'Improperly sourced', 'Source inaccessible', 'Unsourced', 'Wordy']);
  const hashes = rubric.tags.map((t) => t.tag_hash).sort(compareCodePoints);
  assert.equal(rubric.rubric_hash, h16(pyJson(hashes)));
  assert.equal(rubric.rubric_hash, 'sha256:3a7fd95a1e6ee1c6', 'pinned: h16 of the JSON list of the sorted tag hashes');
  assert.deepEqual(validate(schema, rubric).errors, []);
  assert.deepEqual(verifyRubric(rubric), { ok: true, errors: [] });
  assert.deepEqual(rubric.tags.filter((t) => t.judged).map((t) => t.name), ['Context-dependent'], 'only Context-dependent is judged');
});

test('buildRubric: the order of the rows changes nothing', () => {
  const a = build(rows());
  const b = build(rows().reverse());
  assert.deepEqual(b, a);
  const shuffled = rows();
  shuffled.push(shuffled.shift());
  assert.equal(build(shuffled).rubric_hash, a.rubric_hash);
});

test('buildRubric: a changed rule changes the rubric hash, a changed description does not', () => {
  const before = build().rubric_hash;
  const described = rows();
  rowOf(described, 'Wordy').Description = 'A new description.';
  rowOf(described, 'Context-dependent')['Example Claims'] = 'Just one claim.';
  assert.equal(build(described).rubric_hash, before);
  const ruled = rows();
  rowOf(ruled, 'Context-dependent')['When to use'] = rowOf(ruled, 'Context-dependent')['When to use'].replace('Test: could', 'Test: would');
  assert.notEqual(build(ruled).rubric_hash, before);
  const gained = rows();
  rowOf(gained, 'Wordy')['When to use'] = '1. A claim with filler words is Wordy.';
  const rubric = build(gained);
  assert.notEqual(rubric.rubric_hash, before);
  assert.equal(tagOf(rubric, 'Wordy').judged, false, 'rules on a text tag do not make it judged: its box is not ticked');
  rowOf(gained, 'Wordy').Judged = true;
  assert.equal(tagOf(build(gained), 'Wordy').judged, true, 'rules and a tick on a text tag do');
  assert.equal(build(gained).rubric_hash, rubric.rubric_hash, 'the tick is not part of the hash of the rubric');
});

test('buildRubric: a tick changes judged and nothing else; the rubric hash is the same ticked or not', () => {
  const ticked = build();
  const list = rows();
  rowOf(list, 'Context-dependent').Judged = false;
  const unticked = build(list);
  assert.equal(unticked.rubric_hash, ticked.rubric_hash);
  assert.deepEqual(unticked.tags.map((t) => t.tag_hash), ticked.tags.map((t) => t.tag_hash));
  assert.deepEqual(unticked.tags.filter((t) => t.judged), []);
  assert.deepEqual(verifyRubric(unticked), { ok: true, errors: [] });
});

test('buildRubric: judgedFrom (a lock) stands in for the ticks only when no row has a Judged column at all', () => {
  const lock = locked(); // Context-dependent judged
  const bare = rows().map(({ Judged: _gone, ...row }) => row);
  assert.deepEqual(build(bare).tags.filter((t) => t.judged), [], 'without judgedFrom nothing is ticked');
  assert.deepEqual(build(bare, { judgedFrom: lock }).tags.filter((t) => t.judged).map((t) => t.name), ['Context-dependent'], 'the lock\'s ticks stand');
  const list = rows();
  rowOf(list, 'Context-dependent').Judged = false;
  assert.deepEqual(build(list, { judgedFrom: lock }).tags.filter((t) => t.judged), [], 'a table that has the column is believed, ticked or not');
});

test('buildRubric: defaults for the edition, the source and the clock', () => {
  const rubric = buildRubric(rows(), { config, now: () => new Date('2026-12-01T10:30:00Z') });
  assert.equal(rubric.edition, '2026-12-01.1');
  assert.equal(rubric.built_at, '2026-12-01T10:30:00.000Z');
  const copy = config.notion.rulebook;
  assert.deepEqual(rubric.source, { database_id: copy.database_id, data_source_id: copy.data_source_id, read_via: 'rest', read_at: '2026-12-01T10:30:00.000Z' });
  const given = { database_id: 'd', data_source_id: 's', read_via: 'connector', read_at: '2026-10-15T08:00:00.000Z' };
  assert.deepEqual(build(rows(), { source: given }).source, given);
  assert.equal(build(rows(), { now: '2026-10-16T09:00:00Z' }).built_at, '2026-10-16T09:00:00.000Z');
  assert.equal(build(rows(), { now: Date.UTC(2026, 9, 16, 9) }).built_at, '2026-10-16T09:00:00.000Z');
  assert.match(buildRubric(rows(), { config }).built_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'the real clock when none is given');
  assert.throws(() => build(rows(), { now: 'not a time' }), /not a time/);
});

test('buildRubric: two rows with one name, no usable row, or a source of the wrong shape are refused', () => {
  const twice = rows();
  twice.push({ ...rowOf(twice, 'Wordy') });
  assert.throws(() => build(twice), /two rows are named "Wordy"/);
  assert.throws(() => build([]), /no row has a Name/);
  assert.throws(() => build([{ Name: ' ' }, { Name: null }]), /no row has a Name/);
  assert.throws(() => build(rows(), { source: { database_id: 'd' } }), /source/);
  assert.throws(() => build(rows(), { edition: '2026-10-16' }), /edition/);
  assert.throws(() => buildRubric(rows(), {}), /a config is required/);
  assert.throws(() => buildRubric('rows', { config }), /rows must be an array/);
});

test('buildRubric: a row without a name is not a tag and is skipped', () => {
  const list = rows();
  list.push({ Name: '', 'When to use': '1. A rule on a row with no name.' }, { 'When to use': 'x' });
  assert.deepEqual(build(list), build(rows()));
});

test('buildRubric refuses a tag whose rules repeat a number', () => {
  const list = rows();
  rowOf(list, 'Wordy')['When to use'] = '1. First.\n1. Again.';
  assert.throws(() => build(list), /Wordy: two rules have the same number \(1, 1\)/);
});

// ---- verifyRubric --------------------------------------------------------------------------------------------------------------

test('verifyRubric finds a tampered hash, flag, order or number, and reports schema errors first', () => {
  const ok = build();
  assert.equal(verifyRubric(ok).ok, true);

  const tag = structuredClone(ok);
  tagOf(tag, 'Context-dependent').rules[0].text = 'Changed after the hash was made.';
  assert.deepEqual(verifyRubric(tag).errors, ['Context-dependent: tag_hash does not match the name and rules']);

  const total = structuredClone(ok);
  total.rubric_hash = 'sha256:0000000000000000';
  assert.deepEqual(verifyRubric(total).errors, ['rubric_hash does not match the tag hashes']);

  // judged says the box is ticked on top of rules and a text capability; the file keeps no tick, so only an impossible "judged" is an error
  const flag = structuredClone(ok);
  tagOf(flag, 'Wordy').judged = true;
  assert.match(verifyRubric(flag).errors[0], /Wordy: judged can be true only when the tag has rules and its capability is text/);
  const sourced = structuredClone(ok);
  tagOf(sourced, 'Improperly sourced').judged = true;
  assert.match(verifyRubric(sourced).errors[0], /Improperly sourced: judged can be true only when/, 'a source tag is never judged');
  const unticked = structuredClone(ok);
  tagOf(unticked, 'Context-dependent').judged = false;
  assert.deepEqual(verifyRubric(unticked), { ok: true, errors: [] }, 'a tag with rules and judged false is a tag whose box is not ticked');

  const order = structuredClone(ok);
  order.tags.reverse();
  assert.ok(verifyRubric(order).errors.some((e) => /is out of order/.test(e)));

  const numbers = structuredClone(ok);
  tagOf(numbers, 'Context-dependent').rules[1].n = 1;
  numbers.tags[0].tag_hash = h16(pyJson({ name: 'Context-dependent', rules: numbers.tags[0].rules.map((r) => r.text) }));
  assert.ok(verifyRubric(numbers).errors.some((e) => /two rules have the same number/.test(e)));

  const names = structuredClone(ok);
  names.tags.push(structuredClone(names.tags[names.tags.length - 1]));
  assert.ok(verifyRubric(names).errors.some((e) => /two tags are named "Wordy"/.test(e)));

  const shape = structuredClone(ok);
  delete shape.edition;
  shape.tags[0].capability = 'magic';
  const result = verifyRubric(shape);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('$.edition: missing required property')));
  assert.ok(result.errors.some((e) => e.includes('$.tags[0].capability: expected one of')));
  assert.equal(verifyRubric(null).ok, false);
});

// ---- nextEdition ---------------------------------------------------------------------------------------------------------------

test('nextEdition counts up on the same day and restarts at .1 on a new day', () => {
  assert.equal(nextEdition('2026-10-16.1', new Date('2026-10-16T08:00:00Z')), '2026-10-16.2');
  assert.equal(nextEdition('2026-10-16.2', new Date('2026-10-16T23:59:59Z')), '2026-10-16.3');
  assert.equal(nextEdition('2026-10-16.9', new Date('2026-10-16T12:00:00Z')), '2026-10-16.10', 'numbers, not text');
  assert.equal(nextEdition('2026-10-16.10', new Date('2026-10-16T12:00:00Z')), '2026-10-16.11');
  assert.equal(nextEdition('2026-10-16.1', new Date('2026-10-17T00:00:00Z')), '2026-10-17.1');
  assert.equal(nextEdition('2026-10-16.7', new Date('2026-11-01T00:00:00Z')), '2026-11-01.1');
  assert.equal(nextEdition('2025-12-31.4', new Date('2026-01-01T00:00:00Z')), '2026-01-01.1');
});

test('nextEdition starts a first edition and accepts a day string, an ISO time or a Date', () => {
  for (const previous of [null, undefined, '', 'none', '2026-10-16', '2026-10-16.', 'v2']) assert.equal(nextEdition(previous, new Date('2026-10-16T00:00:00Z')), '2026-10-16.1', String(previous));
  assert.equal(nextEdition('2026-10-16.1', '2026-10-16'), '2026-10-16.2');
  assert.equal(nextEdition('2026-10-16.1', '2026-10-17'), '2026-10-17.1');
  assert.equal(nextEdition('2026-10-16.1', '2026-10-16T22:00:00.000Z'), '2026-10-16.2');
  assert.equal(nextEdition(null, Date.UTC(2026, 9, 16, 1)), '2026-10-16.1');
  assert.match(nextEdition(null), /^\d{4}-\d{2}-\d{2}\.1$/);
  assert.throws(() => nextEdition(null, 'yesterday'), /not a date/);
});

test('nextEdition uses the UTC day, and never goes back when the previous edition is dated later than today', () => {
  assert.equal(nextEdition(null, new Date('2026-10-16T23:30:00-05:00')), '2026-10-17.1');
  assert.equal(nextEdition('2026-10-17.1', new Date('2026-10-16T12:00:00Z')), '2026-10-17.2');
});

// ---- writeEdition and the readers ---------------------------------------------------------------------------------------------------

test('writeEdition writes rubric.json, rubric.lock, history/<edition>.json and one changelog line', () => {
  const root = tmp();
  const rubric = build();
  const out = writeEdition(root, rubric, { reason: 'Built from the Rulebook copy at setup.' });
  assert.equal(out.edition, '2026-10-16.1');
  assert.equal(out.rubric_hash, rubric.rubric_hash);
  assert.deepEqual(readdirSync(join(root, 'rubric')).sort(), ['CHANGELOG.md', 'history', 'rubric.json', 'rubric.lock']);
  assert.deepEqual(readdirSync(join(root, 'rubric', 'history')), ['2026-10-16.1.json']);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'rubric', 'rubric.json'), 'utf8')), rubric);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'rubric', 'history', '2026-10-16.1.json'), 'utf8')), rubric);
  assert.equal(readFileSync(join(root, 'rubric', 'CHANGELOG.md'), 'utf8'), '- 2026-10-16 · edition 2026-10-16.1 · Built from the Rulebook copy at setup.\n');

  const lock = JSON.parse(readFileSync(join(root, 'rubric', 'rubric.lock'), 'utf8'));
  assert.deepEqual(out.lock, lock);
  assert.equal(lock.edition, '2026-10-16.1');
  assert.equal(lock.rubric_hash, rubric.rubric_hash);
  assert.equal(lock.locked_at, '2026-10-16T09:00:00.000Z');
  assert.deepEqual(Object.keys(lock.tags), rubric.tags.map((t) => t.name));
  assert.equal(lock.tags['Context-dependent'], tagOf(rubric, 'Context-dependent').tag_hash);
  assert.equal(lock.text['Context-dependent'], rowOf(rows(), 'Context-dependent')['When to use'], 'the locked text is the raw When to use');
  assert.equal(lock.text.Wordy, '');
  assert.equal(lock.columns['Context-dependent'].Counterpart, 'Self-contained');
  assert.equal(lock.columns['Context-dependent']['Example Claims'].split('\n').length, 6);
  assert.equal(lock.columns.Wordy.Counterpart, '');
  assert.deepEqual(validate({ definitions: schema.definitions, $ref: '#/definitions/lock' }, lock).errors, []);
});

test('readRubric, readLock and readEdition give back what was written, and null before the first edition', () => {
  const root = tmp();
  assert.equal(readRubric(root), null);
  assert.equal(readLock(root), null);
  assert.equal(readEdition(root, '2026-10-16.1'), null);
  const rubric = build();
  const { lock } = writeEdition(root, rubric, { reason: 'First.' });
  assert.deepEqual(readRubric(root), rubric);
  assert.deepEqual(readLock(root), lock);
  assert.deepEqual(readEdition(root, '2026-10-16.1'), rubric);
  assert.equal(readEdition(root, '2026-10-16.2'), null);
  assert.throws(() => readEdition(root, 'latest'), /not an edition/);
  assert.throws(() => readEdition(root, '../x'), /not an edition/);
});

test('a second edition the same day becomes current, the first stays in history, and the changelog grows by a line', () => {
  const root = tmp();
  writeEdition(root, build(), { reason: 'Built from the Rulebook copy at setup.' });
  const list = rows();
  rowOf(list, 'Context-dependent')['When to use'] = rowOf(list, 'Context-dependent')['When to use'].replace('Test: could', 'Test: would');
  const second = build(list, { edition: nextEdition('2026-10-16.1', NOW), now: new Date('2026-10-16T11:00:00Z') });
  assert.equal(second.edition, '2026-10-16.2');
  writeEdition(root, second, { reason: 'Rule 4 of Context-dependent: wording (lesson Test wording, PASS).' });
  assert.equal(readRubric(root).edition, '2026-10-16.2');
  assert.equal(readLock(root).edition, '2026-10-16.2');
  assert.equal(readLock(root).locked_at, '2026-10-16T11:00:00.000Z');
  assert.equal(readEdition(root, '2026-10-16.1').edition, '2026-10-16.1');
  assert.equal(readEdition(root, '2026-10-16.2').rubric_hash, second.rubric_hash);
  assert.deepEqual(readdirSync(join(root, 'rubric', 'history')).sort(), ['2026-10-16.1.json', '2026-10-16.2.json']);
  assert.equal(readFileSync(join(root, 'rubric', 'CHANGELOG.md'), 'utf8'),
    '- 2026-10-16 · edition 2026-10-16.1 · Built from the Rulebook copy at setup.\n- 2026-10-16 · edition 2026-10-16.2 · Rule 4 of Context-dependent: wording (lesson Test wording, PASS).\n');
});

test('writing the same edition again finishes the job without a second changelog line', () => {
  const root = tmp();
  const rubric = build();
  writeEdition(root, rubric, { reason: 'First.' });
  rmSync(join(root, 'rubric', 'rubric.lock'));
  writeEdition(root, rubric, { reason: 'First.' });
  assert.ok(existsSync(join(root, 'rubric', 'rubric.lock')));
  assert.equal(readFileSync(join(root, 'rubric', 'CHANGELOG.md'), 'utf8').trim().split('\n').length, 1);
});

test('an edition is never rewritten with other rules, and editions only go forward', () => {
  const root = tmp();
  writeEdition(root, build(), { reason: 'First.' });
  const list = rows();
  rowOf(list, 'Wordy')['When to use'] = '1. Filler words make a claim Wordy.';
  const clash = build(list, { edition: '2026-10-16.1' });
  assert.throws(() => writeEdition(root, clash, { reason: 'Again.' }), /edition 2026-10-16\.1 exists already with other rules/);
  assert.equal(readRubric(root).tags.find((t) => t.name === 'Wordy').rules.length, 0, 'nothing was changed');
  writeEdition(root, build(list, { edition: '2026-10-16.3' }), { reason: 'Third.' });
  assert.throws(() => writeEdition(root, build(list, { edition: '2026-10-16.2' }), { reason: 'Second.' }), /older than the current edition 2026-10-16\.3/);
  assert.throws(() => writeEdition(root, build(list, { edition: '2026-10-15.9' }), { reason: 'Earlier day.' }), /older than the current edition/);
  assert.equal(readRubric(root).edition, '2026-10-16.3');
  writeEdition(root, build(list, { edition: '2026-10-16.10' }), { reason: 'Tenth.' });
  assert.equal(readRubric(root).edition, '2026-10-16.10', '.10 is after .3');
});

test('writeEdition needs a reason, collapses it to one line, and writes nothing for a rubric that does not verify', () => {
  const root = tmp();
  for (const reason of [undefined, '', '   ', 5]) assert.throws(() => writeEdition(root, build(), { reason }), /a reason is required/);
  assert.throws(() => writeEdition(root, build()), /a reason is required/);
  const broken = build();
  broken.tags[0].tag_hash = 'sha256:0000000000000000';
  assert.throws(() => writeEdition(root, broken, { reason: 'x' }), /the rubric is not valid/);
  assert.equal(existsSync(join(root, 'rubric')), false, 'not even the folder was made');
  writeEdition(root, build(), { reason: 'Line one\n  line two\tand three.  ' });
  assert.equal(readFileSync(join(root, 'rubric', 'CHANGELOG.md'), 'utf8'), '- 2026-10-16 · edition 2026-10-16.1 · Line one line two and three.\n');
});

test('writeEdition takes a list of reasons: one changelog line for each, all of the same edition, written once', () => {
  const root = tmp();
  const rubric = build();
  writeEdition(root, rubric, { reason: ['Judged on: Wordy', '  Judged   off: Context-dependent ', 'adopted from Notion: Wordy When to use'] });
  const lines = readFileSync(join(root, 'rubric', 'CHANGELOG.md'), 'utf8');
  assert.equal(lines, '- 2026-10-16 · edition 2026-10-16.1 · Judged on: Wordy\n- 2026-10-16 · edition 2026-10-16.1 · Judged off: Context-dependent\n- 2026-10-16 · edition 2026-10-16.1 · adopted from Notion: Wordy When to use\n');
  writeEdition(root, rubric, { reason: ['Judged on: Wordy', 'Judged off: Context-dependent'] });
  assert.equal(readFileSync(join(root, 'rubric', 'CHANGELOG.md'), 'utf8'), lines, 'run again for the same edition: no further line');
  for (const bad of [[], [''], ['ok', '   '], [null], 7, undefined]) assert.throws(() => writeEdition(tmp(), rubric, { reason: bad }), /a reason is required/, JSON.stringify(bad));
});

test('writeEdition adds a missing newline to a changelog that has none, and keeps earlier lines', () => {
  const root = tmp();
  mkdirSync(join(root, 'rubric'), { recursive: true });
  writeFileSync(join(root, 'rubric', 'CHANGELOG.md'), '- 2026-10-15 · edition 2026-10-15.1 · Earlier.');
  writeEdition(root, build(), { reason: 'Later.' });
  assert.equal(readFileSync(join(root, 'rubric', 'CHANGELOG.md'), 'utf8'), '- 2026-10-15 · edition 2026-10-15.1 · Earlier.\n- 2026-10-16 · edition 2026-10-16.1 · Later.\n');
});

test('readRubric and readLock refuse files that were damaged by hand', () => {
  const root = tmp();
  writeEdition(root, build(), { reason: 'First.' });
  const file = join(root, 'rubric', 'rubric.json');
  const rubric = JSON.parse(readFileSync(file, 'utf8'));
  rubric.tags[0].rules[0].text = 'Edited in the file.';
  writeFileSync(file, JSON.stringify(rubric));
  assert.throws(() => readRubric(root), /rubric\.json is not a valid rulebook edition[\s\S]*tag_hash does not match/);
  writeFileSync(file, '{ not json');
  assert.throws(() => readRubric(root), /invalid JSON/);
  const lockFile = join(root, 'rubric', 'rubric.lock');
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  delete lock.text;
  writeFileSync(lockFile, JSON.stringify(lock));
  assert.throws(() => readLock(root), /rubric\.lock is not a valid lock[\s\S]*\$\.text: missing required property/);
});

test('lockOf is the lock that writeEdition writes, built without any file', () => {
  const rubric = build();
  const lock = lockOf(rubric);
  assert.deepEqual(Object.keys(lock), ['edition', 'rubric_hash', 'locked_at', 'tags', 'text', 'columns', 'judged']);
  assert.equal(lock.locked_at, rubric.built_at);
  assert.deepEqual(lock.judged, { 'Context-dependent': true, 'Exact duplicate': false, 'Improperly sourced': false, 'Source inaccessible': false, Unsourced: false, Wordy: false }, 'the lock records every tag\'s judged state');
  assert.deepEqual(validate({ definitions: schema.definitions, $ref: '#/definitions/lock' }, lock).errors, []);
  assert.deepEqual(writeEdition(tmp(), rubric, { reason: 'First.' }).lock, lock);
  lock.tags['Context-dependent'] = 'changed';
  assert.notEqual(lockOf(rubric).tags['Context-dependent'], 'changed', 'every call builds a new object');
});

test('checkLock: the lock written with a rubric agrees with it, and any difference is named', () => {
  const rubric = build();
  const root = tmp();
  const { lock } = writeEdition(root, rubric, { reason: 'First.' });
  assert.deepEqual(checkLock(rubric, lock), { ok: true, errors: [] });
  assert.deepEqual(checkLock(rubric, readLock(root)), { ok: true, errors: [] });

  const later = build(rows(), { edition: '2026-10-16.2' });
  const edition = checkLock(later, lock);
  assert.equal(edition.ok, false);
  assert.ok(edition.errors.some((e) => e.startsWith('edition: the lock says 2026-10-16.1, the rubric says 2026-10-16.2')));

  const list = rows();
  rowOf(list, 'Context-dependent')['When to use'] = rowOf(list, 'Context-dependent')['When to use'].replace('Test: could', 'Test: would');
  rowOf(list, 'Wordy').Description = 'A new description.';
  rowOf(list, 'Unsourced').Counterpart = 'Sourced';
  const changed = checkLock(build(list), lock);
  assert.deepEqual(changed.errors.filter((e) => e.startsWith('rubric_hash')).length, 1);
  assert.ok(changed.errors.includes("Context-dependent: the lock's tag hash differs from the rubric"));
  assert.ok(changed.errors.includes("Context-dependent: the lock's When to use text differs from the rubric"));
  assert.ok(changed.errors.includes("Wordy: the lock's other columns differ from the rubric"));
  assert.ok(changed.errors.includes("Unsourced: the lock's other columns differ from the rubric"));

  const fewer = checkLock(build(rows().filter((r) => r.Name !== 'Wordy')), lock);
  assert.ok(fewer.errors.includes("Wordy: the lock's tag hash differs from the rubric"), 'a tag the lock has and the rubric lacks');
  assert.equal(checkLock(rubric, undefined).ok, false);
  assert.equal(checkLock(rubric, {}).ok, false);
});

test('checkLock compares the judged state, but not for a lock made before the Judged box existed', () => {
  const rubric = build();
  const { lock } = writeEdition(tmp(), rubric, { reason: 'First.' });
  const tampered = structuredClone(lock);
  tampered.judged.Wordy = true;
  assert.deepEqual(checkLock(rubric, tampered).errors, ["Wordy: the lock's judged state differs from the rubric"]);
  delete tampered.judged.Wordy;
  assert.deepEqual(checkLock(rubric, tampered).errors, ["Wordy: the lock's judged state differs from the rubric"], 'a tag the map does not name');
  // the rubric file of an edition made by the older code says judged for every tag with rules in a text tag; its lock has no map, and the pair still agrees
  const legacy = structuredClone(lock);
  delete legacy.judged;
  assert.deepEqual(checkLock(rubric, legacy), { ok: true, errors: [] });
  assert.deepEqual(validate({ definitions: schema.definitions, $ref: '#/definitions/lock' }, legacy).errors, [], 'the schema lets the map be absent');
  assert.equal(validate({ definitions: schema.definitions, $ref: '#/definitions/lock' }, { ...lock, judged: { Wordy: 'yes' } }).errors.length > 0, true, 'but a map must hold booleans');
});

test('lockedJudged: the map says it; a lock without the map reads as Context-dependent only (the one tag the agent judged before the box)', () => {
  const lock = locked();
  assert.equal(lockedJudged(lock, 'Context-dependent'), true);
  assert.equal(lockedJudged(lock, 'Wordy'), false);
  assert.equal(lockedJudged(lock, 'Nobody'), false, 'a tag the map does not name is not judged');
  const legacy = structuredClone(lock);
  delete legacy.judged;
  assert.deepEqual([...LEGACY_JUDGED_TAGS], ['Context-dependent']);
  assert.equal(lockedJudged(legacy, 'Context-dependent'), true);
  assert.equal(lockedJudged(legacy, 'Wordy'), false);
  legacy.text['Context-dependent'] = 'No numbered rules here.';
  assert.equal(lockedJudged(legacy, 'Context-dependent'), false, 'it needs rules in the locked text');
  assert.equal(lockedJudged(null, 'Context-dependent'), false);
});

// ---- computeDrift --------------------------------------------------------------------------------------------------------------

/** A lock made from the fixture rows, and a function that gives fresh copies of those rows. */
function locked() {
  const root = tmp();
  const { lock } = writeEdition(root, build(), { reason: 'First.' });
  return lock;
}
const none = { judged: [], adopted: [], toggled: [], missing: [], added: [] };

test('computeDrift: the copy as it was locked has no drift', () => {
  assert.deepEqual(computeDrift(locked(), rows()), none);
  assert.deepEqual(computeDrift(locked(), rows(), { config }), none);
  assert.deepEqual([...DRIFT_COLUMNS], ['When to use', 'Description', 'Example Claims', 'Counterpart']);
});

test('computeDrift: a changed column of a judged tag is named, one entry per column', () => {
  const lock = locked();
  const list = rows();
  const row = rowOf(list, 'Context-dependent');
  row['When to use'] = row['When to use'].replace('Test: could', 'Test: would');
  assert.deepEqual(computeDrift(lock, list), { ...none, judged: [{ tag: 'Context-dependent', column: 'When to use' }] });

  row.Description = 'A different description.';
  row['Example Claims'] += '\nA seventh example claim.';
  row.Counterpart = 'Something else';
  assert.deepEqual(computeDrift(lock, list, { config }).judged, [
    { tag: 'Context-dependent', column: 'When to use' },
    { tag: 'Context-dependent', column: 'Description' },
    { tag: 'Context-dependent', column: 'Example Claims' },
    { tag: 'Context-dependent', column: 'Counterpart' },
  ]);
  assert.deepEqual(computeDrift(lock, list, { config }).adopted, []);
});

test('computeDrift: each of the four columns alone', () => {
  const lock = locked();
  const change = {
    'When to use': (r) => { r['When to use'] += '\n6. A sixth rule.'; },
    Description: (r) => { r.Description += ' More.'; },
    'Example Claims': (r) => { r['Example Claims'] = r['Example Claims'].split('\n').slice(1).join('\n'); },
    Counterpart: (r) => { r.Counterpart = null; },
  };
  for (const [column, apply] of Object.entries(change)) {
    const list = rows();
    apply(rowOf(list, 'Context-dependent'));
    assert.deepEqual(computeDrift(lock, list).judged, [{ tag: 'Context-dependent', column }], column);
  }
});

test('computeDrift: whitespace, line ends, <br> and markdown escapes are not changes', () => {
  const lock = locked();
  const list = rows();
  const row = rowOf(list, 'Context-dependent');
  row['When to use'] = `  ${row['When to use'].replace(/\n/g, '\r\n')}  \r\n\r\n\r\n`;
  row.Description = `${row.Description}   `;
  row['Example Claims'] = `\n${row['Example Claims'].split('\n').map((l) => `- “${l}”`).join('<br>')}\n`;
  row.Counterpart = '  Self-contained ';
  assert.deepEqual(computeDrift(lock, list), none);
  // an editor's markdown escapes (a backslash before an asterisk) read back the same as the plain text they were locked as
  const plain = rows();
  rowOf(plain, 'Wordy').Description = 'A *padded* claim, see [rule] #4.';
  const plainLock = writeEdition(tmp(), build(plain), { reason: 'First.' }).lock;
  const escaped = structuredClone(plain);
  rowOf(escaped, 'Wordy').Description = 'A \\*padded\\* claim, see \\[rule\\] \\#4.';
  assert.deepEqual(computeDrift(plainLock, escaped), none);
  rowOf(escaped, 'Wordy').Description = 'A padded claim, see [rule] #4.';
  assert.deepEqual(computeDrift(plainLock, escaped).adopted, [{ tag: 'Wordy', columns: ['Description'] }], 'but a removed asterisk is a change');
});

test('computeDrift: a changed tag without rules in force is adopted, with the columns that changed', () => {
  const lock = locked();
  const list = rows();
  const wordy = rowOf(list, 'Wordy');
  wordy.Description = 'A claim padded with words it does not need.';
  assert.deepEqual(computeDrift(lock, list), { ...none, adopted: [{ tag: 'Wordy', columns: ['Description'] }] });
  wordy['Example Claims'] = 'Needless filler words abound in this claim.';
  wordy.Counterpart = 'Concise';
  assert.deepEqual(computeDrift(lock, list).adopted, [{ tag: 'Wordy', columns: ['Description', 'Example Claims', 'Counterpart'] }]);
  const duplicate = rowOf(list, 'Exact duplicate');
  duplicate.Description = 'Two claims with the same text.';
  assert.deepEqual(computeDrift(lock, list).adopted, [
    { tag: 'Exact duplicate', columns: ['Description'] },
    { tag: 'Wordy', columns: ['Description', 'Example Claims', 'Counterpart'] },
  ], 'sorted by tag name');
  assert.deepEqual(computeDrift(lock, list).judged, []);
});

test('computeDrift: new rules on a tag that had none are adopted too; the tag stays unjudged until its box is ticked, and then the next change to it is drift', () => {
  const lock = locked();
  const list = rows();
  rowOf(list, 'Wordy')['When to use'] = '1. A claim with filler words is Wordy.\n2. Hedges count as filler.';
  const drift = computeDrift(lock, list, { config });
  assert.deepEqual(drift, { ...none, adopted: [{ tag: 'Wordy', columns: ['When to use'] }] }, 'its box is not ticked: no toggle');
  assert.deepEqual(computeDrift(lock, list), drift, 'with or without the config');
  // the caller adopts them; the tag has rules now but its box is not ticked, so it is not judged and its rules still change freely
  const root = tmp();
  const adopted = writeEdition(root, build(list, { edition: '2026-10-16.2' }), { reason: 'Adopted from Notion.' }).lock;
  assert.equal(adopted.judged.Wordy, false);
  rowOf(list, 'Wordy')['When to use'] += '\n3. Repetition counts as filler.';
  assert.deepEqual(computeDrift(adopted, list, { config }), { ...none, adopted: [{ tag: 'Wordy', columns: ['When to use'] }] });
  assert.deepEqual(computeDrift(adopted, list), { ...none, adopted: [{ tag: 'Wordy', columns: ['When to use'] }] });
  // once the box is ticked and the edition adopts that, the next change to its rules is drift
  rowOf(list, 'Wordy').Judged = true;
  assert.deepEqual(computeDrift(adopted, list, { config }).toggled, [{ tag: 'Wordy', judged: true }]);
  const ticked = writeEdition(tmp(), build(list, { edition: '2026-10-16.3' }), { reason: 'Judged on: Wordy' }).lock;
  assert.equal(ticked.judged.Wordy, true);
  rowOf(list, 'Wordy')['When to use'] += '\n4. Padding counts as filler.';
  assert.deepEqual(computeDrift(ticked, list, { config }), { ...none, judged: [{ tag: 'Wordy', column: 'When to use' }] });
});

test('computeDrift: a tag with rules whose box is not ticked is adopted, ticked or not a deterministic tag is never judged', () => {
  const lock = locked();
  const list = rows();
  rowOf(list, 'Unsourced')['When to use'] += '\n5. A fifth rule nobody judges.';
  for (const options of [{}, { config }]) {
    assert.deepEqual(computeDrift(lock, list, options), { ...none, adopted: [{ tag: 'Unsourced', columns: ['When to use'] }] }, JSON.stringify(Object.keys(options)));
  }
  const source = rows();
  rowOf(source, 'Improperly sourced').Description = 'Changed.';
  assert.deepEqual(computeDrift(lock, source, { config }).adopted, [{ tag: 'Improperly sourced', columns: ['Description'] }]);
  // a deterministic tag ticked in Notion is not judged all the same: its lock says false, the config says deterministic, so no toggle and no stop
  const ticked = rows();
  rowOf(ticked, 'Unsourced').Judged = true;
  const tickedLock = writeEdition(tmp(), build(ticked), { reason: 'First.' }).lock;
  assert.equal(tickedLock.judged.Unsourced, false);
  rowOf(ticked, 'Unsourced')['When to use'] += '\n5. A fifth rule nobody judges.';
  assert.deepEqual(computeDrift(tickedLock, ticked, { config }), { ...none, adopted: [{ tag: 'Unsourced', columns: ['When to use'] }] });
  assert.deepEqual(computeDrift(lock, ticked, { config }).toggled, [], 'a ticked deterministic tag is no toggle');
});

test('computeDrift: ticking a box is a toggle (judged on), unticking one is a toggle (judged off); neither is a stop', () => {
  const lock = locked();
  const list = rows();
  rowOf(list, 'Context-dependent').Judged = false;
  assert.deepEqual(computeDrift(lock, list, { config }), { ...none, toggled: [{ tag: 'Context-dependent', judged: false }] });
  // a tag with no rules in force cannot become judged by a tick
  const wordy = rows();
  rowOf(wordy, 'Wordy').Judged = true;
  assert.deepEqual(computeDrift(lock, wordy, { config }), none);
  // a tag with rules ticked: judged on, listed by tag name
  const withRules = rows();
  rowOf(withRules, 'Wordy')['When to use'] = '1. A claim with filler words is Wordy.';
  rowOf(withRules, 'Wordy').Judged = true;
  rowOf(withRules, 'Context-dependent').Judged = false;
  assert.deepEqual(computeDrift(lock, withRules, { config }), {
    ...none, adopted: [{ tag: 'Wordy', columns: ['When to use'] }], toggled: [{ tag: 'Context-dependent', judged: false }, { tag: 'Wordy', judged: true }],
  });
  assert.deepEqual(toggleClauses(computeDrift(lock, withRules, { config }).toggled), ['Judged off: Context-dependent', 'Judged on: Wordy']);
  assert.deepEqual(toggleClauses([]), []);
  // a tick that nobody changed is no toggle, in either direction
  assert.deepEqual(computeDrift(lock, rows(), { config }).toggled, []);
});

test('computeDrift: a tag unticked and edited in the same pull is adopted (one toggle, no stop); a tag edited while its box stays ticked still stops', () => {
  const lock = locked();
  const list = rows();
  const row = rowOf(list, 'Context-dependent');
  row['When to use'] = row['When to use'].replace('Test: could', 'Test: would');
  row.Judged = false;
  assert.deepEqual(computeDrift(lock, list, { config }), {
    ...none, adopted: [{ tag: 'Context-dependent', columns: ['When to use'] }], toggled: [{ tag: 'Context-dependent', judged: false }],
  });
  // ticked in the same pull as its rules changed: the owner chose free toggles, so that is adopted too
  const wordyLock = writeEdition(tmp(), build(rows()), { reason: 'First.' }).lock;
  const gained = rows();
  rowOf(gained, 'Wordy')['When to use'] = '1. First.\n2. Second.';
  rowOf(gained, 'Wordy').Judged = true;
  assert.deepEqual(computeDrift(wordyLock, gained, { config }), { ...none, adopted: [{ tag: 'Wordy', columns: ['When to use'] }], toggled: [{ tag: 'Wordy', judged: true }] });
  // the rules of a ticked tag deleted, the box left ticked: that is no toggle, it is the stop of today
  const emptied = rows();
  rowOf(emptied, 'Context-dependent')['When to use'] = '';
  assert.deepEqual(computeDrift(lock, emptied, { config }), { ...none, judged: [{ tag: 'Context-dependent', column: 'When to use' }] });
});

test('computeDrift: a table without the Judged column cannot be read for ticks: nothing is toggled and the drift says so', () => {
  const lock = locked();
  const bare = rows().map(({ Judged: _gone, ...row }) => row);
  assert.deepEqual(computeDrift(lock, bare, { config }), { ...none, no_judged_column: true });
  const edited = structuredClone(bare);
  rowOf(edited, 'Wordy').Description = 'Edited.';
  assert.deepEqual(computeDrift(lock, edited, { config }), { ...none, adopted: [{ tag: 'Wordy', columns: ['Description'] }], no_judged_column: true });
  assert.equal(Object.hasOwn(computeDrift(lock, rows(), { config }), 'no_judged_column'), false);
  assert.equal(Object.hasOwn(computeDrift(lock, [], { config }), 'no_judged_column'), false, 'no rows at all is no sign of a missing column');
});

test('computeDrift: a lock from before the Judged box reads as judging Context-dependent only, so the first pull adopts the other ticks as toggles', () => {
  // the rows of the Rulebook as the seed leaves them: seven tags ticked (here Context-dependent and Wordy with rules)
  const seeded = rows();
  rowOf(seeded, 'Wordy')['When to use'] = '1. First.\n2. Second.';
  rowOf(seeded, 'Wordy').Judged = true;
  const legacy = structuredClone(writeEdition(tmp(), build(rows()), { reason: 'Before the box.' }).lock);
  delete legacy.judged;
  assert.deepEqual(computeDrift(legacy, seeded, { config }), {
    ...none, adopted: [{ tag: 'Wordy', columns: ['When to use'] }], toggled: [{ tag: 'Wordy', judged: true }],
  }, 'Context-dependent was judged and still is: no toggle for it');
  // the protection of the one judged tag holds across the migration: an edit to its rules is a stop, not an adoption
  const edited = structuredClone(seeded);
  rowOf(edited, 'Context-dependent')['When to use'] = rowOf(edited, 'Context-dependent')['When to use'].replace('Test: could', 'Test: would');
  assert.deepEqual(computeDrift(legacy, edited, { config }).judged, [{ tag: 'Context-dependent', column: 'When to use' }]);
  // and if its box is not ticked in Notion, that is a toggle off
  rowOf(seeded, 'Context-dependent').Judged = false;
  assert.deepEqual(computeDrift(legacy, seeded, { config }).toggled, [{ tag: 'Context-dependent', judged: false }, { tag: 'Wordy', judged: true }]);
});

test('computeDrift: a tag that left the copy is missing and a tag that is new is added', () => {
  const lock = locked();
  const list = rows().filter((r) => r.Name !== 'Wordy' && r.Name !== 'Context-dependent');
  list.push({ Name: 'Trailing period', 'When to use': null }, { Name: 'Poor wording' });
  assert.deepEqual(computeDrift(lock, list), { ...none, missing: ['Context-dependent', 'Wordy'], added: ['Poor wording', 'Trailing period'] });
  const renamed = rows();
  rowOf(renamed, 'Wordy').Name = 'Verbose';
  assert.deepEqual(computeDrift(lock, renamed), { ...none, missing: ['Wordy'], added: ['Verbose'] });
});

test('computeDrift: a lock without the other columns compares When to use only', () => {
  const lock = structuredClone(locked());
  delete lock.columns;
  const list = rows();
  rowOf(list, 'Context-dependent').Description = 'Changed.';
  assert.deepEqual(computeDrift(lock, list), none);
  rowOf(list, 'Context-dependent')['When to use'] = '1. Only rule.';
  assert.deepEqual(computeDrift(lock, list).judged, [{ tag: 'Context-dependent', column: 'When to use' }]);
});

test('computeDrift: nameless rows are ignored, repeated names and bad arguments are refused', () => {
  const lock = locked();
  assert.deepEqual(computeDrift(lock, [...rows(), { Name: '' }, { 'When to use': 'x' }, null]), none);
  assert.throws(() => computeDrift(lock, [...rows(), { Name: 'Wordy' }]), /two rows are named "Wordy"/);
  assert.throws(() => computeDrift(null, rows()), /the lock is missing/);
  assert.throws(() => computeDrift(undefined, rows()), /the lock is missing/);
  assert.throws(() => computeDrift(lock, 'rows'), /rows must be an array/);
  assert.deepEqual(computeDrift(lock, []), { ...none, missing: Object.keys(lock.tags).sort(compareCodePoints) });
});
