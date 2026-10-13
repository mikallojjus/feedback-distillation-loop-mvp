import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyLesson, buildRubric, checkHashes, composeWhenToUse, diffRubric, nextVersion, normaliseText, rehash, rubricToRows, scrubNames, splitRules,
} from '../agents/claim-tagger/scripts/lib/rubric-build.mjs';
import { rubricHash, ruleHash, scopeHash, tagHash } from '../agents/claim-tagger/scripts/lib/hash.mjs';
import { validate } from '../agents/claim-tagger/scripts/lib/validate.mjs';

const fixtureText = readFileSync(new URL('./fixtures/rubric.research-example.json', import.meta.url), 'utf8');
const fixture = () => JSON.parse(fixtureText);
const schema = JSON.parse(readFileSync(new URL('../agents/claim-tagger/schemas/rubric.schema.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../agents/claim-tagger/config.json', import.meta.url), 'utf8'));

const TAG_KEYS = [
  'name', 'notion_page_id', 'status', 'category', 'polarity', 'counterpart', 'geo_status', 'geo_tag_id', 'verified_on', 'evidence_url',
  'description', 'when_to_use', 'example_claims', 'human_only', 'deterministic', 'needs_source_reading', 'tag_hash', 'judged',
];
const TOP_KEYS = ['rubric_version', 'rubric_hash', 'scope', 'scope_hash', 'source', 'tag_count', 'judged_count', 'counterpart_pairs', 'changelog', 'tags'];

const row = (over = {}) => ({
  name: 'Alpha', status: 'Verified', category: 'Quality', polarity: 'Issue', counterpart: '', description: 'Alpha tag.',
  when_to_use: 'Pre.\n1. First.\n2. Second.\nNote: n.', example_claims: 'One claim.\nTwo claim.',
  human_only: false, judged: true, deterministic: false, needs_source_reading: false, ...over,
});
const tagOf = (r, name) => r.tags.find((t) => t.name === name);

// ---- splitRules ----

// Expected values come from running the verbatim split_rules() of research/scripts/build-skeleton-data.py in Python 3.13.
const SPLIT_VECTORS = [
  {"name": "plain: preamble, two rules, closing line", "text": "Judge the scope.\n1. First rule.\n2. Second rule.\nA closing remark.", "preamble": "Judge the scope.", "rules": [{"n": 1, "text": "First rule."}, {"n": 2, "text": "Second rule."}], "note": "A closing remark."},
  {"name": "no preamble, no note", "text": "1. Only rule.\n2. Another.", "preamble": "", "rules": [{"n": 1, "text": "Only rule."}, {"n": 2, "text": "Another."}], "note": ""},
  {"name": "crlf line ends", "text": "Pre.\r\n1. One.\r\n2. Two.\r\nTail.\r\n", "preamble": "Pre.", "rules": [{"n": 1, "text": "One."}, {"n": 2, "text": "Two."}], "note": "Tail."},
  {"name": "indentation and blank lines", "text": "  Pre  \n\n  1.   Rule one  \n\t2. Rule two\n\n\n  Trailing  \n\n", "preamble": "Pre", "rules": [{"n": 1, "text": "Rule one"}, {"n": 2, "text": "Rule two"}], "note": "Trailing"},
  {"name": "only a preamble", "text": "Just a line.\nAnother line.", "preamble": "Just a line. Another line.", "rules": [], "note": ""},
  {"name": "empty and missing", "text": "", "preamble": "", "rules": [], "note": ""},
  {"name": "whitespace only", "text": " \n\t\n  ", "preamble": "", "rules": [], "note": ""},
  {"name": "multi-line preamble and note are joined by a space", "text": "Line A.\nLine B.\n1. R.\nNote A.\nNote B.", "preamble": "Line A. Line B.", "rules": [{"n": 1, "text": "R."}], "note": "Note A. Note B."},
  {"name": "text between rules moves to the note, later rules still count", "text": "1. a\nstray line\n2. b\n3. c", "preamble": "", "rules": [{"n": 1, "text": "a"}, {"n": 2, "text": "b"}, {"n": 3, "text": "c"}], "note": "stray line"},
  {"name": "not rules: no space after the dot, a bracket, a bare number", "text": "1.no space\n1) bracket\n1.\n12", "preamble": "1.no space 1) bracket 1. 12", "rules": [], "note": ""},
  {"name": "multi-digit and zero-padded numbers", "text": "9. nine\n10. ten\n01. padded\n007. bond", "preamble": "", "rules": [{"n": 9, "text": "nine"}, {"n": 10, "text": "ten"}, {"n": 1, "text": "padded"}, {"n": 7, "text": "bond"}], "note": ""},
  {"name": "numbers out of order stay as written", "text": "3. three\n1. one\n2. two", "preamble": "", "rules": [{"n": 3, "text": "three"}, {"n": 1, "text": "one"}, {"n": 2, "text": "two"}], "note": ""},
  {"name": "a rule whose text contains numbers and dots", "text": "1. Use \"2. as above\" when 3.5 applies.\n2. See 10.", "preamble": "", "rules": [{"n": 1, "text": "Use \"2. as above\" when 3.5 applies."}, {"n": 2, "text": "See 10."}], "note": ""},
  {"name": "unicode whitespace is stripped like Python str.strip", "text": "\u00a01. nbsp rule\u00a0\n\u3000Pre\u3000\n\u00852. nel rule", "preamble": "", "rules": [{"n": 1, "text": "nbsp rule"}, {"n": 2, "text": "nel rule"}], "note": "Pre"},
  {"name": "a line of only unicode whitespace is blank", "text": "Pre\n\u00a0\u00a0\n1. rule", "preamble": "Pre", "rules": [{"n": 1, "text": "rule"}], "note": ""},
  {"name": "control separators are whitespace to Python", "text": "\u001c1. fs rule\u001c", "preamble": "", "rules": [{"n": 1, "text": "fs rule"}], "note": ""},
  {"name": "a BOM is not whitespace to Python, so that line is not a rule", "text": "\ufeff1. bom rule\n2. real rule", "preamble": "\ufeff1. bom rule", "rules": [{"n": 2, "text": "real rule"}], "note": ""},
  {"name": "a line separator inside a rule is kept", "text": "1. one\u2028two\n2. next", "preamble": "", "rules": [{"n": 1, "text": "one\u2028two"}, {"n": 2, "text": "next"}], "note": ""},
  {"name": "rule text keeps inner spacing", "text": "1.  two   spaces   inside  ", "preamble": "", "rules": [{"n": 1, "text": "two   spaces   inside"}], "note": ""},
  {"name": "dots and parentheses", "text": "Pre (see rule 2.)\n1. A (b). C.\nNote (x).", "preamble": "Pre (see rule 2.)", "rules": [{"n": 1, "text": "A (b). C."}], "note": "Note (x)."},
  {"name": "quotes and unicode text", "text": "Pre \"q\"\n1. caf\u00e9 \u2014 ok\nTail \ud83d\ude00", "preamble": "Pre \"q\"", "rules": [{"n": 1, "text": "caf\u00e9 \u2014 ok"}], "note": "Tail \ud83d\ude00"}
];

test('splitRules gives what the research script split_rules gave (Python reference vectors)', () => {
  assert.ok(SPLIT_VECTORS.length >= 20);
  for (const v of SPLIT_VECTORS) assert.deepEqual(splitRules(v.text), { preamble: v.preamble, rules: v.rules, note: v.note }, v.name);
});

test('splitRules: a leading "Note:" label is not part of the note; other text is', () => {
  assert.equal(splitRules('P\n1. r\nNote: careful here').note, 'careful here');
  assert.equal(splitRules('1. r\nnote:lowercase label').note, 'lowercase label');
  assert.equal(splitRules('1. r\nNote: line one\nline two').note, 'line one line two');
  assert.equal(splitRules('1. r\nNotes: plural stays').note, 'Notes: plural stays');
  assert.equal(splitRules('1. r\nNote:').note, '');
  assert.equal(splitRules('1. r\nA line.\nNote: not first').note, 'A line. Note: not first');
  assert.equal(splitRules('Note: in the preamble\n1. r').preamble, 'Note: in the preamble');
});

test('splitRules accepts null, undefined and numbers without throwing', () => {
  const empty = { preamble: '', rules: [], note: '' };
  assert.deepEqual(splitRules(null), empty);
  assert.deepEqual(splitRules(undefined), empty);
  assert.deepEqual(splitRules(''), empty);
});

// ---- composeWhenToUse ----

test('composeWhenToUse writes the preamble, the numbered rules and a Note line', () => {
  assert.equal(composeWhenToUse({ preamble: 'Pre.', rules: [{ n: 1, text: 'One.' }, { n: 2, text: 'Two.' }], note: 'Careful.' }), 'Pre.\n1. One.\n2. Two.\nNote: Careful.');
  assert.equal(composeWhenToUse({ preamble: '', rules: [{ n: 1, text: 'One.' }], note: '' }), '1. One.');
  assert.equal(composeWhenToUse({ rules: [{ n: 1, text: 'a' }, { n: 2, text: 'b' }, { n: 4, text: 'd' }] }), '1. a\n2. b\n4. d', 'rule numbers are kept as they are');
  assert.equal(composeWhenToUse({}), '');
  assert.equal(composeWhenToUse(), '');
  assert.equal(composeWhenToUse({ preamble: 'a\n b', rules: [{ n: 1, text: 'x\n  y', rule_hash: 'sha256:0000000000000000' }], note: 'p\r\nq' }), 'a b\n1. x y\nNote: p q', 'a part is always one line; hashes never leak into the text');
});

test('compose and split are inverses for every tag of the research rubric', () => {
  for (const t of fixture().tags) {
    const back = splitRules(composeWhenToUse(t.when_to_use));
    assert.deepEqual(back.rules, t.when_to_use.rules.map(({ n, text }) => ({ n, text })), `${t.name} rules`);
    assert.equal(back.preamble, t.when_to_use.preamble, `${t.name} preamble`);
    assert.equal(back.note, t.when_to_use.note, `${t.name} note`);
  }
});

test('split(compose(x)) is x also for awkward parts', () => {
  const x = { preamble: 'Starts with Note: inside', rules: [{ n: 3, text: 'Three, with "quotes" and 2. numbers.' }, { n: 7, text: 'Seven.' }], note: 'Note: doubled label survives' };
  assert.deepEqual(splitRules(composeWhenToUse(x)), x);
});

// ---- normaliseText ----

test('normaliseText: line ends, <br>, markdown escapes, trimming, blank runs', () => {
  assert.equal(normaliseText('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(normaliseText('a<br>b<br/>c<br />d<BR>e'), 'a\nb\nc\nd\ne');
  assert.equal(normaliseText('1\\*2 \\_x\\_ \\[y\\] \\# z'), '1*2 _x_ [y] # z');
  assert.equal(normaliseText('  a  \n\t b\t\n'), 'a\nb');
  assert.equal(normaliseText('a\n\n\n\n\nb'), 'a\n\nb');
  assert.equal(normaliseText('a\n\nb'), 'a\n\nb');
  assert.equal(normaliseText('a<br><br><br>b'), 'a\n\nb');
  assert.equal(normaliseText('\n\n  x  \n\n'), 'x');
  assert.equal(normaliseText(null), '');
  assert.equal(normaliseText(undefined), '');
  assert.equal(normaliseText('C:\\temp \\n \\\\ \\.'), 'C:\\temp \\n \\\\ \\.', 'other backslashes are data');
});

test('normaliseText changes no string of the research rubric (so it cannot create false drift)', () => {
  const walk = (v, where) => {
    if (typeof v === 'string') assert.equal(normaliseText(v), v, where);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`);
  };
  walk(fixture().tags, 'tags');
});

// ---- scrubNames ----

const PAIRS = config.anonymise.replacements;

test('scrubNames: whole words, case-sensitive, longest first, with the configured replacements', () => {
  assert.equal(scrubNames('Moh judged 21 claims.', PAIRS), 'the editor judged 21 claims.');
  assert.equal(scrubNames('Open boundary (Moh): x', PAIRS), 'Open boundary (the editor): x');
  assert.equal(scrubNames("Mohammed's view, Mohammed.", PAIRS), "the editor's view, the editor.");
  assert.equal(scrubNames("operationalizes Yaniv's rule that", PAIRS), "operationalizes the team's rule that", "the longer \"Yaniv's rule\" wins over \"Yaniv\"");
  assert.equal(scrubNames('Yaniv said so; Arturas agreed.', PAIRS), 'the rule owner said so; the auditor agreed.');
  assert.equal(scrubNames('Moh, Moh and Moh', PAIRS), 'the editor, the editor and the editor');
});

test('scrubNames leaves other words and other cases alone', () => {
  for (const s of ['Mohawk', 'Mohammedan', 'moh', 'MOH', 'YMoh', 'xYaniv', 'ArchArturas', '_Moh', '9Moh', 'Moh_x', 'Moh2', 'Yanivs', 'Arturas1', 'Nothing here.', '']) assert.equal(scrubNames(s, PAIRS), s, s);
  assert.equal(scrubNames(null, PAIRS), null);
  assert.equal(scrubNames(5, PAIRS), 5);
  assert.equal(scrubNames('Moh', []), 'Moh');
});

test('scrubNames: replacements are literal and are not applied twice', () => {
  assert.equal(scrubNames('A and B', [['A', 'B'], ['B', 'C']]), 'B and C', 'the new B is not replaced again');
  assert.equal(scrubNames('Dr. X (Y)', [['Dr. X (Y)', '$& $1']]), '$& $1', 'special characters in both parts are plain text');
  assert.equal(scrubNames('a.b and axb', [['a.b', 'Z']]), 'Z and axb', 'the dot is not a wildcard');
  assert.equal(scrubNames('x', [['', 'Z']]), 'x', 'an empty name is ignored');
});

// ---- nextVersion ----

test('nextVersion: the next number on the same day, .1 on a new day', () => {
  const noon = new Date('2026-10-13T10:00:00Z');
  assert.equal(nextVersion('2026-10-13.1', noon), '2026-10-13.2');
  assert.equal(nextVersion('2026-10-13.9', noon), '2026-10-13.10');
  assert.equal(nextVersion('2026-10-12.7', noon), '2026-10-13.1');
  assert.equal(nextVersion(undefined, noon), '2026-10-13.1');
  assert.equal(nextVersion(null, noon), '2026-10-13.1');
  assert.equal(nextVersion('garbage', noon), '2026-10-13.1');
  assert.equal(nextVersion('2026-10-13.1', new Date('2026-10-14T00:00:00Z')), '2026-10-14.1');
});

test('nextVersion uses the UTC date and never goes backwards', () => {
  assert.equal(nextVersion('2026-10-13.1', new Date('2026-10-13T23:30:00Z')), '2026-10-13.2');
  assert.equal(nextVersion('2026-10-13.1', new Date('2026-10-14T01:30:00+03:00')), '2026-10-13.2', '22:30 UTC on the 13th');
  assert.equal(nextVersion('2026-10-20.4', new Date('2026-10-14T00:00:00Z')), '2026-10-20.5', 'a current version dated in the future is bumped, not replaced');
  assert.match(nextVersion(undefined), /^\d{4}-\d{2}-\d{2}\.1$/);
});

// ---- buildRubric ----

test('buildRubric: rows become a rubric in the fixture shape with every hash computed', () => {
  const r = buildRubric([row({ name: 'Gamma' }), row({ name: 'Beta', counterpart: 'Alpha' }), row({ counterpart: 'Beta' })], { version: '2026-10-13.1', source: { note: 'x' } });
  assert.deepEqual(Object.keys(r), TOP_KEYS);
  assert.deepEqual(Object.keys(r.tags[0]), TAG_KEYS);
  assert.equal(r.rubric_version, '2026-10-13.1');
  assert.deepEqual(r.tags.map((t) => t.name), ['Alpha', 'Beta', 'Gamma'], 'sorted by name');
  assert.equal(r.tag_count, 3);
  assert.equal(r.judged_count, 3);
  assert.deepEqual(r.scope, ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(r.counterpart_pairs, [['Alpha', 'Beta']]);
  assert.deepEqual(r.source, { note: 'x' });
  const alpha = tagOf(r, 'Alpha');
  assert.equal(alpha.counterpart, 'Beta');
  assert.equal(alpha.when_to_use.preamble, 'Pre.');
  assert.deepEqual(alpha.when_to_use.rules.map(({ n, text }) => [n, text]), [[1, 'First.'], [2, 'Second.']]);
  assert.equal(alpha.when_to_use.note, 'n.');
  assert.deepEqual(alpha.example_claims, ['One claim.', 'Two claim.']);
  assert.equal(alpha.status, 'Verified');
  assert.equal(alpha.notion_page_id, null);
  assert.equal(tagOf(r, 'Beta').counterpart, 'Alpha');
  assert.equal(tagOf(r, 'Gamma').counterpart, null, 'an empty counterpart is null');
  assert.equal(alpha.when_to_use.rules[0].rule_hash, ruleHash('Alpha', 1, 'First.'));
  assert.equal(alpha.tag_hash, tagHash(alpha));
  assert.equal(r.rubric_hash, rubricHash(r));
  assert.equal(r.scope_hash, scopeHash(['Alpha', 'Beta', 'Gamma']));
  assert.deepEqual(r.changelog, [{ version: '2026-10-13.1', date: '2026-10-13', by: 'rubric-build', change: 'Built from Rulebook rows.' }]);
  assert.equal(checkHashes(r).ok, true);
  assert.deepEqual(validate(schema, r), { ok: true, errors: [] });
});

test('buildRubric reproduces the research rubric from its own Rulebook rows (tags, hashes, scope, counts)', () => {
  const f = fixture();
  const r = buildRubric(rubricToRows(f), { version: f.rubric_version, source: f.source });
  assert.deepEqual(r.tags, f.tags);
  assert.equal(r.rubric_hash, 'sha256:b7851e23dcd3be52');
  assert.equal(r.scope_hash, 'sha256:5cf30ca98835c948');
  assert.deepEqual(r.scope, f.scope);
  assert.equal(r.tag_count, 14);
  assert.equal(r.judged_count, 12);
  assert.deepEqual(Object.keys(r), Object.keys(f));
  assert.deepEqual(diffRubric(f, r), []);
  // the four mutual pairs, each written alphabetically, in alphabetical order
  assert.deepEqual(r.counterpart_pairs, [['Context-dependent', 'Self-contained'], ['Debate', 'Simple'], ['Factual', 'Opinion'], ['Multiple statements', 'Single core statement']]);
});

test('buildRubric: Notion export encodings (<br>, CRLF, markdown escapes) give the same rubric, so no false drift', () => {
  const f = fixture();
  const encoded = rubricToRows(f).map((r, i) => ({
    ...r,
    when_to_use: i % 2 ? r.when_to_use.replace(/\n/g, '<br>') : r.when_to_use.replace(/\n/g, '\r\n'),
    example_claims: i % 2 ? r.example_claims.replace(/\n/g, '<br/>') : r.example_claims.replace(/\n/g, '\r\n'),
    description: r.description.replace(/_/g, '\\_').replace(/#/g, '\\#'),
  }));
  const r = buildRubric(encoded, { version: f.rubric_version, source: f.source });
  assert.deepEqual(diffRubric(f, r), []);
  assert.equal(r.rubric_hash, f.rubric_hash);
  const text = buildRubric([row({ description: 'a\\_b \\*c\\* \\[d\\] \\# e' })], { version: 'v' }).tags[0].description;
  assert.equal(text, 'a_b *c* [d] # e');
});

test('buildRubric: only Verified rows; rows without a status are taken as Verified', () => {
  const r = buildRubric([row({ name: 'A' }), row({ name: 'B', status: 'Proposed' }), row({ name: 'C', status: 'Retired' }), row({ name: 'D', status: undefined }), row({ name: 'E', status: null })], { version: 'v' });
  assert.deepEqual(r.tags.map((t) => t.name), ['A', 'D', 'E']);
});

test('buildRubric: judged is derived from the human-only and deterministic flags unless given', () => {
  const r = buildRubric([
    row({ name: 'A', judged: undefined }),
    row({ name: 'B', judged: undefined, human_only: true }),
    row({ name: 'C', judged: undefined, deterministic: true }),
    row({ name: 'D', judged: false }),
  ], { version: 'v' });
  assert.deepEqual(r.tags.map((t) => t.judged), [true, false, false, false]);
  assert.deepEqual(r.scope, ['A']);
  assert.equal(r.judged_count, 1);
  assert.throws(() => buildRubric([row({ judged: true, human_only: true })], { version: 'v' }), /judged but also human only/);
  assert.throws(() => buildRubric([row({ judged: true, deterministic: true })], { version: 'v' }), /judged but also deterministic/);
});

test('buildRubric: rows are sorted by name in code point order and names must be unique', () => {
  const r = buildRubric([row({ name: 'b' }), row({ name: 'B' }), row({ name: 'a' }), row({ name: 'Z' })], { version: 'v' });
  assert.deepEqual(r.tags.map((t) => t.name), ['B', 'Z', 'a', 'b']);
  assert.throws(() => buildRubric([row(), row()], { version: 'v' }), /two rows are named "Alpha"/);
  assert.throws(() => buildRubric([row({ name: '  ' })], { version: 'v' }), /no name/);
});

test('buildRubric: when_to_use may already be structured, examples may be a list, source is copied', () => {
  const source = { a: { b: 1 } };
  const r = buildRubric([row({
    when_to_use: { preamble: 'P', rules: [{ n: 1, text: 'R1' }, { n: 2, text: 'R2' }], note: 'N' },
    example_claims: ['x', ' y '],
  })], { version: 'v', source });
  assert.deepEqual(r.tags[0].when_to_use, { preamble: 'P', rules: [{ n: 1, text: 'R1', rule_hash: ruleHash('Alpha', 1, 'R1') }, { n: 2, text: 'R2', rule_hash: ruleHash('Alpha', 2, 'R2') }], note: 'N' });
  assert.deepEqual(r.tags[0].example_claims, ['x', 'y']);
  r.source.a.b = 2;
  assert.equal(source.a.b, 1, 'the source object is copied, not shared');
});

test('buildRubric: a missing polarity is kept as null so the schema can refuse it', () => {
  const r = buildRubric([row({ polarity: undefined })], { version: 'v' });
  assert.equal(r.tags[0].polarity, null);
  assert.equal(validate(schema, r).ok, false);
});

test('buildRubric accepts a changelog, the counterpart pairs and metadata', () => {
  const r = buildRubric([row({ notion_page_id: 'abc', verified_on: '2026-09-10', geo_status: 'To be created', geo_tag_id: 'g', evidence_url: 'https://x' })], {
    version: '2026-10-13.1', changelog: [{ version: '2026-10-13.1', date: '2026-10-13', by: 'me', change: 'c' }], counterpartPairs: [['A', 'B']], by: 'ignored',
  });
  assert.deepEqual(r.changelog, [{ version: '2026-10-13.1', date: '2026-10-13', by: 'me', change: 'c' }]);
  assert.deepEqual(r.counterpart_pairs, [['A', 'B']]);
  assert.deepEqual([r.tags[0].notion_page_id, r.tags[0].verified_on, r.tags[0].geo_status, r.tags[0].geo_tag_id, r.tags[0].evidence_url], ['abc', '2026-09-10', 'To be created', 'g', 'https://x']);
});

test('rubricToRows gives Rulebook rows: composed When to use, examples one per line', () => {
  const rows = rubricToRows(fixture());
  assert.equal(rows.length, 14);
  const predictive = rows.find((r) => r.name === 'Predictive');
  const tag = tagOf(fixture(), 'Predictive');
  assert.equal(predictive.when_to_use, composeWhenToUse(tag.when_to_use));
  assert.equal(predictive.example_claims, tag.example_claims.join('\n'));
  assert.equal(predictive.status, 'Verified');
  assert.equal(predictive.judged, true);
  assert.equal(rows.find((r) => r.name === 'Editor verified').judged, false);
  assert.equal(rows.find((r) => r.name === 'Editor verified').human_only, true);
});

// ---- diffRubric ----

test('diffRubric: identical rubrics, and differences in encoding only, give no diff', () => {
  const f = fixture();
  assert.deepEqual(diffRubric(f, fixture()), []);
  tagOf(f, 'Debate').description = 'Line one.\nLine two with a_b and *star*.';
  const g = fixture();
  tagOf(g, 'Debate').description = '  Line one.<br>Line two with a\\_b and \\*star\\*.  ';
  tagOf(g, 'Debate').when_to_use.rules[0].text = ` ${tagOf(g, 'Debate').when_to_use.rules[0].text}  `;
  tagOf(g, 'Simple').example_claims = tagOf(g, 'Simple').example_claims.map((e) => `${e}  `);
  assert.deepEqual(diffRubric(f, g), []);
});

test('diffRubric: reports the part that differs, with both texts', () => {
  const f = fixture();
  const g = fixture();
  tagOf(g, 'Predictive').when_to_use.rules[2].text += ' Extra.';
  tagOf(g, 'Debate').description = 'New description.';
  tagOf(g, 'Hypothetical').when_to_use.note = 'New note.';
  tagOf(g, 'Simple').when_to_use.preamble = '';
  tagOf(g, 'Opinion').example_claims.push('A new example.');
  tagOf(g, 'Factual').polarity = 'Issue';
  tagOf(g, 'Self-contained').counterpart = null;
  tagOf(g, 'Unsourced').deterministic = false;
  const d = diffRubric(f, g);
  const part = (tag, p) => d.find((x) => x.tag === tag && x.part === p);
  assert.equal(part('Predictive', 'rule 3').b, `${tagOf(f, 'Predictive').when_to_use.rules[2].text} Extra.`);
  assert.equal(part('Predictive', 'rule 3').a, tagOf(f, 'Predictive').when_to_use.rules[2].text);
  assert.deepEqual(part('Debate', 'description').b, 'New description.');
  assert.deepEqual(part('Hypothetical', 'note'), { tag: 'Hypothetical', part: 'note', a: tagOf(f, 'Hypothetical').when_to_use.note, b: 'New note.' });
  assert.deepEqual(part('Simple', 'preamble').b, '');
  assert.equal(part('Opinion', 'examples').b, `${tagOf(f, 'Opinion').example_claims.join('\n')}\nA new example.`);
  assert.deepEqual(part('Factual', 'polarity'), { tag: 'Factual', part: 'polarity', a: 'Classification', b: 'Issue' });
  assert.deepEqual(part('Self-contained', 'counterpart'), { tag: 'Self-contained', part: 'counterpart', a: 'Context-dependent', b: null });
  assert.deepEqual(part('Unsourced', 'deterministic'), { tag: 'Unsourced', part: 'deterministic', a: true, b: false });
  assert.equal(d.length, 8, JSON.stringify(d.map((x) => `${x.tag}:${x.part}`)));
});

test('diffRubric: a rule that exists on one side only has null on the other; tags only on one side are missing or added', () => {
  const f = fixture();
  const g = fixture();
  const hyp = tagOf(g, 'Hypothetical');
  const removed = hyp.when_to_use.rules.pop();
  tagOf(g, 'Debate').when_to_use.rules.push({ n: 6, text: 'A sixth rule.', rule_hash: 'x' });
  g.tags = g.tags.filter((t) => t.name !== 'Unsourced');
  g.tags.push({ ...structuredClone(tagOf(f, 'Simple')), name: 'Zeta' });
  const d = diffRubric(f, g);
  assert.deepEqual(d.find((x) => x.tag === 'Hypothetical'), { tag: 'Hypothetical', part: `rule ${removed.n}`, a: removed.text, b: null });
  assert.deepEqual(d.find((x) => x.tag === 'Debate'), { tag: 'Debate', part: 'rule 6', a: null, b: 'A sixth rule.' });
  assert.equal(d.find((x) => x.tag === 'Unsourced').part, 'missing');
  assert.equal(d.find((x) => x.tag === 'Unsourced').b, null);
  assert.equal(d.find((x) => x.tag === 'Zeta').part, 'added');
  assert.equal(d.find((x) => x.tag === 'Zeta').a, null);
  assert.deepEqual(diffRubric(f, f), []);
});

test('diffRubric: results come out ordered by tag name, then in a fixed order of parts', () => {
  const f = fixture();
  const g = fixture();
  for (const name of ['Simple', 'Debate', 'Predictive']) {
    const t = tagOf(g, name);
    t.when_to_use.note = 'changed';
    t.description = 'changed';
    t.when_to_use.rules[0].text = 'changed';
  }
  const d = diffRubric(f, g).map((x) => `${x.tag}:${x.part}`);
  assert.deepEqual(d, ['Debate:description', 'Debate:rule 1', 'Debate:note', 'Predictive:description', 'Predictive:rule 1', 'Predictive:note', 'Simple:description', 'Simple:rule 1', 'Simple:note']);
});

// ---- applyLesson ----

const L1 = { tag: 'Predictive', kind: 'Change the rule', ruleN: 1, newText: 'A hedged tendency ("on track to") is not a forecast.', lesson_id: 'L-1' };

test('applyLesson: only the named rule changes, hashes follow, the input is untouched', () => {
  const f = fixture();
  const c = applyLesson(f, L1, { version: '2026-10-13.2' });
  assert.deepEqual(f, fixture(), 'the original is not modified');
  assert.equal(tagOf(c, 'Predictive').when_to_use.rules[0].text, L1.newText);
  assert.equal(tagOf(c, 'Predictive').when_to_use.rules[1].text, tagOf(f, 'Predictive').when_to_use.rules[1].text);
  assert.equal(c.rubric_version, '2026-10-13.2');
  assert.deepEqual(checkHashes(c), { ok: true, mismatches: [] });
  const changedRules = f.tags.flatMap((t) => t.when_to_use.rules.filter((r, i) => r.rule_hash !== tagOf(c, t.name).when_to_use.rules[i].rule_hash).map((r) => `${t.name}#${r.n}`));
  assert.deepEqual(changedRules, ['Predictive#1']);
  assert.deepEqual(f.tags.filter((t) => t.tag_hash !== tagOf(c, t.name).tag_hash).map((t) => t.name), ['Predictive']);
  assert.notEqual(c.rubric_hash, f.rubric_hash);
  assert.equal(c.scope_hash, f.scope_hash);
  assert.deepEqual(c.scope, f.scope);
  assert.deepEqual(diffRubric(f, c).map((d) => `${d.tag}:${d.part}`), ['Predictive:rule 1']);
  assert.deepEqual(validate(schema, c), { ok: true, errors: [] });
});

test('applyLesson appends a changelog entry { version, previous_version, date, tag, kind, ruleN, lesson_id, note }', () => {
  const c = applyLesson(fixture(), L1, { version: '2026-10-13.2' });
  assert.equal(c.changelog.length, 2);
  assert.deepEqual(c.changelog[0], fixture().changelog[0]);
  assert.deepEqual(c.changelog[1], {
    version: '2026-10-13.2', previous_version: '2026-10-13.1', date: '2026-10-13', tag: 'Predictive', kind: 'Change the rule', ruleN: 1, lesson_id: 'L-1', note: 'Predictive rule 1 replaced (L-1)',
  });
  assert.deepEqual(Object.keys(c.changelog[1]), ['version', 'previous_version', 'date', 'tag', 'kind', 'ruleN', 'lesson_id', 'note']);
  const noId = applyLesson(fixture(), { tag: 'Predictive', kind: 'Clarify wording', ruleN: 2, newText: 'Changed.', note: 'by hand' }, { version: '2026-10-14.1' });
  assert.deepEqual(noId.changelog[1], { version: '2026-10-14.1', previous_version: '2026-10-13.1', date: '2026-10-14', tag: 'Predictive', kind: 'Clarify wording', ruleN: 2, note: 'by hand' });
});

test('applyLesson: the version defaults to the next one, and must change', () => {
  const c = applyLesson(fixture(), L1);
  assert.match(c.rubric_version, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  assert.notEqual(c.rubric_version, '2026-10-13.1');
  assert.throws(() => applyLesson(fixture(), L1, { version: '2026-10-13.1' }), /new version/);
});

test('applyLesson: an editor wording replaces the whole When to use', () => {
  const wording = 'New opening.\n1. New first rule.\n2. New second rule.\nNote: Edited by the rule owner.';
  const c = applyLesson(fixture(), { tag: 'Predictive', kind: 'Change the rule', newWhenToUse: wording, lesson_id: 'L-2' }, { version: '2026-10-13.2' });
  const t = tagOf(c, 'Predictive');
  assert.equal(t.when_to_use.preamble, 'New opening.');
  assert.deepEqual(t.when_to_use.rules.map((r) => [r.n, r.text]), [[1, 'New first rule.'], [2, 'New second rule.']]);
  assert.equal(t.when_to_use.note, 'Edited by the rule owner.');
  assert.deepEqual(checkHashes(c), { ok: true, mismatches: [] });
  assert.equal(c.changelog[1].ruleN, null);
  assert.equal(c.changelog[1].note, 'Predictive: whole When to use replaced (L-2)');
  assert.throws(() => applyLesson(fixture(), { tag: 'Predictive', newWhenToUse: 'Only prose, no numbered rules.' }, { version: 'v2' }), /no numbered rules/);
});

test('applyLesson: new rule text is one normalised line; bad targets and empty text throw', () => {
  const c = applyLesson(fixture(), { ...L1, newText: '  Line one.\n  Line two.<br>Line three. \\* ' }, { version: '2026-10-13.2' });
  assert.equal(tagOf(c, 'Predictive').when_to_use.rules[0].text, 'Line one. Line two. Line three. *');
  assert.deepEqual(splitRules(composeWhenToUse(tagOf(c, 'Predictive').when_to_use)).rules, tagOf(c, 'Predictive').when_to_use.rules.map(({ n, text }) => ({ n, text })), 'still one rule per line');
  assert.throws(() => applyLesson(fixture(), { ...L1, tag: 'Nope' }, { version: 'v2' }), /no tag "Nope"/);
  assert.throws(() => applyLesson(fixture(), { ...L1, ruleN: 99 }, { version: 'v2' }), /no rule 99/);
  assert.throws(() => applyLesson(fixture(), { ...L1, newText: '  ' }, { version: 'v2' }), /empty/);
  assert.equal(tagOf(applyLesson(fixture(), { ...L1, ruleN: '2', newText: 'From a string rule number.' }, { version: 'v2' }), 'Predictive').when_to_use.rules[1].text, 'From a string rule number.');
});

test('applyLesson: putting the old text back gives the original rubric hash again (the version is not hashed)', () => {
  const f = fixture();
  const original = tagOf(f, 'Predictive').when_to_use.rules[0].text;
  const c = applyLesson(f, L1, { version: '2026-10-13.2' });
  const back = applyLesson(c, { tag: 'Predictive', kind: 'rollback', ruleN: 1, newText: original }, { version: '2026-10-13.3' });
  assert.equal(back.rubric_hash, f.rubric_hash);
  assert.equal(tagOf(back, 'Predictive').tag_hash, tagOf(f, 'Predictive').tag_hash);
  assert.equal(back.rubric_version, '2026-10-13.3');
  assert.equal(back.changelog.length, 3);
});

// ---- checkHashes and rehash ----

test('checkHashes passes on the research rubric', () => {
  assert.deepEqual(checkHashes(fixture()), { ok: true, mismatches: [] });
});

test('checkHashes recomputes every level and says where it differs', () => {
  const f = fixture();
  tagOf(f, 'Debate').when_to_use.rules[1].text += ' (edited by hand)';
  const r = checkHashes(f);
  assert.equal(r.ok, false);
  assert.deepEqual(r.mismatches.map((m) => `${m.kind}:${m.where}`), ['rule_hash:Debate rule 2', 'tag_hash:Debate', 'rubric_hash:rubric']);
  const m = r.mismatches[0];
  assert.equal(m.stored, fixture().tags.find((t) => t.name === 'Debate').when_to_use.rules[1].rule_hash);
  assert.equal(m.computed, ruleHash('Debate', 2, tagOf(f, 'Debate').when_to_use.rules[1].text));
});

test('checkHashes: each stored value is checked on its own', () => {
  const kinds = (mutate) => {
    const f = fixture();
    mutate(f);
    return checkHashes(f).mismatches.map((m) => m.kind);
  };
  assert.deepEqual(kinds((f) => { f.rubric_hash = 'sha256:0000000000000000'; }), ['rubric_hash']);
  assert.deepEqual(kinds((f) => { f.scope_hash = 'sha256:0000000000000000'; }), ['scope_hash']);
  assert.deepEqual(kinds((f) => { tagOf(f, 'Debate').tag_hash = 'sha256:0000000000000000'; }), ['tag_hash']);
  assert.deepEqual(kinds((f) => { tagOf(f, 'Debate').when_to_use.rules[0].rule_hash = 'sha256:0000000000000000'; }), ['rule_hash']);
  assert.deepEqual(kinds((f) => { f.tag_count = 15; }), ['tag_count']);
  assert.deepEqual(kinds((f) => { f.judged_count = 11; }), ['judged_count']);
  assert.deepEqual(kinds((f) => { f.scope.pop(); }), ['scope_hash', 'scope']);
  assert.deepEqual(kinds((f) => { tagOf(f, 'Debate').judged = false; }), ['scope', 'judged_count']);
  assert.deepEqual(kinds((f) => { delete tagOf(f, 'Debate').tag_hash; }), ['tag_hash']);
  assert.deepEqual(kinds((f) => { f.tags.pop(); }), ['rubric_hash', 'tag_count']);
});

test('rehash fixes everything in place and returns the same object', () => {
  const f = fixture();
  tagOf(f, 'Debate').when_to_use.rules[0].text += ' x';
  tagOf(f, 'Hypothetical').judged = false;
  f.tag_count = 1;
  const same = rehash(f);
  assert.equal(same, f);
  assert.deepEqual(checkHashes(f), { ok: true, mismatches: [] });
  assert.equal(f.judged_count, 11);
  assert.equal(f.scope.includes('Hypothetical'), false);
  assert.equal(f.tag_count, 14);
});

// ---- the schema ----

test('rubric.schema.json accepts the research rubric', () => {
  assert.deepEqual(validate(schema, fixture()), { ok: true, errors: [] });
});

test('rubric.schema.json rejects broken rubrics with a readable path', () => {
  const errorsOf = (mutate) => {
    const f = fixture();
    mutate(f);
    return validate(schema, f).errors;
  };
  assert.deepEqual(errorsOf((f) => { delete f.rubric_hash; }), ['$.rubric_hash: missing required property']);
  assert.deepEqual(errorsOf((f) => { f.extra = 1; }), ['$.extra: unexpected property']);
  assert.deepEqual(errorsOf((f) => { f.rubric_version = '2026-10-13'; }), ['$.rubric_version: must match ^\\d{4}-\\d{2}-\\d{2}\\.\\d+$']);
  assert.deepEqual(errorsOf((f) => { f.rubric_hash = 'sha256:XYZ'; }), ['$.rubric_hash: must match ^sha256:[0-9a-f]{16}$']);
  assert.deepEqual(errorsOf((f) => { f.tags[0].tag_hash = 'abc'; }), ['$.tags[0].tag_hash: must match ^sha256:[0-9a-f]{16}$']);
  assert.deepEqual(errorsOf((f) => { f.tags[2].polarity = 'Neutral'; }), ['$.tags[2].polarity: expected one of "Classification", "Issue", "Positive"']);
  assert.deepEqual(errorsOf((f) => { f.tags[1].status = 'Proposed'; }), ['$.tags[1].status: expected "Verified"']);
  assert.deepEqual(errorsOf((f) => { f.tags[1].oops = true; }), ['$.tags[1].oops: unexpected property']);
  assert.deepEqual(errorsOf((f) => { f.tags[1].when_to_use.rules[0].n = 0; }), ['$.tags[1].when_to_use.rules[0].n: must be >= 1']);
  assert.deepEqual(errorsOf((f) => { f.tags[1].when_to_use.rules[0].text = ''; }), ['$.tags[1].when_to_use.rules[0].text: must be at least 1 characters']);
  assert.deepEqual(errorsOf((f) => { f.tags[1].human_only = 'no'; }), ['$.tags[1].human_only: expected boolean']);
  assert.deepEqual(errorsOf((f) => { f.counterpart_pairs[0].push('Third'); }), ['$.counterpart_pairs[0]: must have at most 2 items']);
  assert.deepEqual(errorsOf((f) => { f.changelog = []; }), ['$.changelog: must have at least 1 items']);
  assert.deepEqual(errorsOf((f) => { f.tags = []; }), ['$.tags: must have at least 1 items']);
  assert.deepEqual(errorsOf((f) => { f.tag_count = 1.5; }), ['$.tag_count: expected integer']);
  assert.deepEqual(errorsOf((f) => { delete f.tags[0].example_claims; }), ['$.tags[0].example_claims: missing required property']);
});

test('rubric.schema.json allows null metadata and open changelog entries', () => {
  const f = fixture();
  for (const k of ['notion_page_id', 'category', 'counterpart', 'geo_status', 'geo_tag_id', 'verified_on', 'evidence_url']) f.tags[0][k] = null;
  f.changelog.push({ version: '2026-10-13.2', date: '2026-10-13', anything: 'goes', ruleN: null, kind: null });
  assert.deepEqual(validate(schema, f), { ok: true, errors: [] });
});
