import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePage, encodeProperties, normaliseText, normId, sameDate, sameValue, splitRichText } from '../agents/claim-tagger/scripts/lib/notion-values.mjs';
import { normaliseText as rubricNormaliseText } from '../agents/claim-tagger/scripts/lib/rubric-build.mjs';
import { fixtureSchemas, loadFixture, pageValue } from './fixtures/notion/fake-notion.mjs';

const schemas = fixtureSchemas();

// ---- decode: the hand-written REST pages ----

test('decodePage: a Tag decisions row with every kind of value (formula, rollup, has_more relation, date end)', () => {
  const d = decodePage(loadFixture('page.tag-decision.json'), schemas.tag_decisions);
  assert.equal(d.page_id, '7f3c1a52-0b6e-4d9a-8f21-5c4d3b2a1e90');
  assert.match(d.url, /^https:\/\/www\.notion\.so\//);
  assert.equal(d.created_time, '2026-10-13T15:10:00.000Z');
  assert.equal(d.last_edited_time, '2026-10-13T16:02:00.000Z');
  const p = d.props;
  assert.equal(p.Key, '6aa014be141b4c6dab2c3c180f963639::Predictive');
  assert.deepEqual(p.Claim, ['c0000000-0000-4000-8000-000000000001']);
  assert.deepEqual(p.Tag, ['a0000000-0000-4000-8000-000000000008']);
  assert.equal(p['Agent proposal'], 'Do not add tag');
  assert.equal(p['Agent confidence'], 0.62);
  assert.equal(p['Why I recommend this'], 'First line\nSecond line and a tail', 'pieces are joined, the newline is kept');
  assert.equal(p['Agent full note'], '');
  assert.equal(p['Tag outcome'], null);
  assert.equal(p['Why wrong'], null);
  assert.deepEqual(p['Decided by'], []);
  assert.equal(p['Decided at'], null);
  assert.equal(p['Seeded outcome'], 'Does not apply');
  assert.equal(p['Seeded at'], '2026-10-09');
  assert.equal(p['In regression suite'], '2026-10-14');
  assert.equal(p['In regression suite:end'], '2026-10-15', 'a date end is kept under name:end');
  assert.equal('Seeded at:end' in p, false, 'no :end key without an end');
  assert.deepEqual(p['Tag name'], ['Predictive'], 'a show_original rollup of titles decodes to an array of strings');
  assert.deepEqual(p['Lesson status'], ['Proposed', 'Approved'], 'a rollup of selects decodes to option names');
  assert.equal(p['Effective outcome'], 'Does not apply', 'a string formula');
  assert.equal(p.Stage, 'Lesson proposed');
  assert.equal(p['Applied tag'], null, 'a string formula with no value is null');
  assert.equal(p['Rejected tag'], 'Predictive');
  assert.deepEqual(p.Lesson, ['d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002']);
  assert.deepEqual(d.relation_has_more, ['Lesson'], 'a relation Notion cut at 25 is flagged');
});

test('decodePage: no relation_has_more key when no relation was cut', () => {
  const d = decodePage(loadFixture('page.claim.json'), schemas.claims);
  assert.equal('relation_has_more' in d, false);
});

test('decodePage: a Claims row (url, number, multi-line text, relation, rollup of formulas)', () => {
  const p = decodePage(loadFixture('page.claim.json'), schemas.claims).props;
  assert.equal(p['Claim title'], 'The Supreme Court is likely to expand executive power further in the future');
  assert.equal(p['Geo ID'], '6aa014be141b4c6dab2c3c180f963639');
  assert.equal(p['Geo link'], 'https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/6aa014be141b4c6dab2c3c180f963639');
  assert.equal(p['Sources count'], 2);
  assert.equal(p['Source URLs'], 'https://www.geobrowser.io/space/4582/aaa\nhttps://www.geobrowser.io/space/4582/bbb');
  assert.equal(p.Table, 'U.S. Politics');
  assert.equal(p.Sample, 'Forecast');
  assert.equal(p.Readiness, 'Needs editor');
  assert.equal(p['Agent tags'].length, 3);
  assert.deepEqual(p['Decided applies'], ['Hypothetical'], 'a rollup of formula items decodes the formula value');
  assert.deepEqual(p['Decided does not apply'], []);
});

test('decodePage: a Rule changes row (unique_id, created_time, people, synced relations)', () => {
  const p = decodePage(loadFixture('page.rule-change.json'), schemas.rule_changes).props;
  assert.equal(p['Lesson title'], 'Hedged trajectories are not forecasts');
  assert.equal(p['Lesson ID'], 'LS-3');
  assert.equal(p.Created, '2026-10-13T17:00:00.000Z');
  assert.equal(p.Status, 'Approved');
  assert.deepEqual(p['Approved by'], ['bbbbbbbb-0000-4000-8000-00000000b0b0']);
  assert.equal(p['Editor wording'], '');
  assert.equal(p['Supporting rows'].length, 2);
  assert.deepEqual(p['Result card'], []);
});

test('decodePage: Agent settings (checkbox, people, number, date-time) and a Runs row (date range, number, relation)', () => {
  const s = decodePage(loadFixture('page.settings.json'), schemas.agent_settings).props;
  assert.equal(s.Name, 'claim-tagger');
  assert.equal(s.Paused, true);
  assert.deepEqual(s['Paused by'], ['bbbbbbbb-0000-4000-8000-00000000b0b0']);
  assert.equal(s['Weekly cap'], 40);
  assert.equal(s['Last run at'], '2026-10-13T18:00:00.000+00:00');
  const r = decodePage(loadFixture('page.run.json'), schemas.runs).props;
  assert.equal(r['Run title'], 'Gate R2 · L-1');
  assert.equal(r.Started, '2026-10-14T09:00:00.000+00:00');
  assert.equal(r['Started:end'], '2026-10-14T09:04:30.000+00:00');
  assert.equal(r['Claims judged'], 86);
  assert.equal(r['Newly failing'], 0);
  assert.equal(r['Cost USD'], 1.7);
  assert.equal(r.Verdict, 'PASS');
  assert.deepEqual(r.Lesson, ['d0000000-0000-4000-8000-000000000001']);
  const rb = decodePage(loadFixture('page.rulebook.json'), schemas.rulebook).props;
  assert.equal(rb['When to use'], 'Use when the claim states a future outcome.\n1. Fires on a future marker.\nNote: hedges are judged separately.');
  assert.equal(rb['Human only'], false);
  assert.equal(rb.Judged, true);
});

test('decodePage: the rarer types, formula and rollup variants', () => {
  const t = (type, payload) => ({ id: 'x', type, [type]: payload });
  const page = {
    id: 'p1', url: null, properties: {
      Tags: t('multi_select', [{ name: 'a' }, { name: 'b' }]),
      Phase: t('status', { name: 'Doing' }),
      Mail: t('email', 'a@b.c'),
      Phone: t('phone_number', null),
      Files: t('files', [{ name: 'f.png' }, { name: 'g.pdf' }]),
      Maker: t('created_by', { object: 'user', id: 'u1' }),
      Edited: t('last_edited_time', '2026-10-13T00:00:00.000Z'),
      FNum: t('formula', { type: 'number', number: 3 }),
      FBool: t('formula', { type: 'boolean', boolean: true }),
      FDate: t('formula', { type: 'date', date: { start: '2026-10-13', end: null } }),
      RNum: t('rollup', { type: 'number', number: 7, function: 'count' }),
      RDate: t('rollup', { type: 'date', date: { start: '2026-10-01', end: null }, function: 'earliest_date' }),
      RGone: t('rollup', { type: 'incomplete', incomplete: {}, function: 'show_original' }),
      RNums: t('rollup', { type: 'array', array: [{ type: 'number', number: 1 }, { type: 'number', number: 2 }], function: 'show_original' }),
      Button: t('button', {}),
    },
  };
  const p = decodePage(page).props;
  assert.deepEqual(p.Tags, ['a', 'b']);
  assert.equal(p.Phase, 'Doing');
  assert.equal(p.Mail, 'a@b.c');
  assert.equal(p.Phone, null);
  assert.deepEqual(p.Files, ['f.png', 'g.pdf']);
  assert.equal(p.Maker, 'u1');
  assert.equal(p.Edited, '2026-10-13T00:00:00.000Z');
  assert.equal(p.FNum, 3);
  assert.equal(p.FBool, true);
  assert.equal(p.FDate, '2026-10-13');
  assert.equal(p.RNum, 7);
  assert.equal(p.RDate, '2026-10-01');
  assert.equal(p.RGone, null);
  assert.deepEqual(p.RNums, [1, 2]);
  assert.equal('Button' in p, false, 'a type this layer does not know is left out, not guessed');
});

test('decodePage: a value without a type takes the schema type; a page/schema type mismatch throws; a non-page throws', () => {
  const page = { id: 'p', properties: { Title: { title: [{ plain_text: 'x' }] } } };
  assert.equal(decodePage(page, { properties: { Title: { type: 'title' } } }).props.Title, 'x');
  assert.throws(() => decodePage(page), /has no type/);
  assert.throws(
    () => decodePage({ id: 'p', properties: { N: { type: 'number', number: 1 } } }, { properties: { N: { type: 'rich_text' } } }),
    /number on the page but rich_text in the schema/,
  );
  assert.throws(() => decodePage(null), /not a Notion page object/);
  assert.throws(() => decodePage({ id: 'p' }), /not a Notion page object/);
});

test('decodePage does not modify its input', () => {
  const page = loadFixture('page.tag-decision.json');
  const before = JSON.stringify(page);
  decodePage(page, schemas.tag_decisions);
  assert.equal(JSON.stringify(page), before);
});

// ---- encode ----

test('encodeProperties: one example of every writable type', () => {
  const out = encodeProperties(
    {
      Key: 'k::Tag', 'Agent proposal': 'Keep tag', 'Agent confidence': 0.75, 'Why I recommend this': 'because', Claim: ['c1'], Tag: ['t1'],
      'Seeded at': '2026-10-09', 'Decided by': ['u1'], 'Tag outcome': null,
    },
    schemas.tag_decisions,
  );
  assert.deepEqual(out, {
    Key: { title: [{ type: 'text', text: { content: 'k::Tag' } }] },
    'Agent proposal': { select: { name: 'Keep tag' } },
    'Agent confidence': { number: 0.75 },
    'Why I recommend this': { rich_text: [{ type: 'text', text: { content: 'because' } }] },
    Claim: { relation: [{ id: 'c1' }] },
    Tag: { relation: [{ id: 't1' }] },
    'Seeded at': { date: { start: '2026-10-09' } },
    'Decided by': { people: [{ id: 'u1' }] },
    'Tag outcome': { select: null },
  });
  const claims = encodeProperties({ 'Geo link': 'https://x.test/a', 'Sources count': 3, 'Geo ID': 'abc' }, schemas.claims);
  assert.deepEqual(claims['Geo link'], { url: 'https://x.test/a' });
  assert.deepEqual(claims['Sources count'], { number: 3 });
  const rb = encodeProperties({ 'Human only': true, Judged: false }, schemas.rulebook);
  assert.deepEqual(rb, { 'Human only': { checkbox: true }, Judged: { checkbox: false } });
});

test('encodeProperties: clearing values, dates with an end, multi_select and status', () => {
  const s = encodeProperties({ 'Tag confidence': '', Readiness: null, 'Sources count': null, 'Geo link': null }, schemas.claims);
  assert.deepEqual(s, { 'Tag confidence': { rich_text: [] }, Readiness: { select: null }, 'Sources count': { number: null }, 'Geo link': { url: null } });
  const r = encodeProperties({ Started: '2026-10-14T09:00:00.000Z', 'Started:end': '2026-10-14T10:00:00.000Z' }, schemas.runs);
  assert.deepEqual(r, { Started: { date: { start: '2026-10-14T09:00:00.000Z', end: '2026-10-14T10:00:00.000Z' } } });
  assert.deepEqual(encodeProperties({ Started: null }, schemas.runs), { Started: { date: null } });
  const custom = { properties: { Tags: { type: 'multi_select' }, Phase: { type: 'status' } } };
  assert.deepEqual(encodeProperties({ Tags: ['a'], Phase: 'Doing' }, custom), { Tags: { multi_select: [{ name: 'a' }] }, Phase: { status: { name: 'Doing' } } });
  assert.deepEqual(encodeProperties({ Key: undefined }, schemas.tag_decisions), {}, 'undefined means not provided');
});

test('encodeProperties: unknown names, non-writable types and wrong value types throw', () => {
  assert.throws(() => encodeProperties({ Nope: 'x' }, schemas.claims), /unknown property "Nope"/);
  assert.throws(() => encodeProperties({ 'Started:end': 'x' }, schemas.runs), /unknown property "Started:end"/);
  for (const [name, schema] of [['Effective outcome', schemas.tag_decisions], ['Tag name', schemas.tag_decisions], ['Lesson ID', schemas.rule_changes], ['Created', schemas.rule_changes]]) {
    assert.throws(() => encodeProperties({ [name]: 'x' }, schema), /not a writable property type/, name);
  }
  assert.throws(() => encodeProperties({ 'Sources count': '3' }, schemas.claims), /finite number or null/);
  assert.throws(() => encodeProperties({ 'Sources count': NaN }, schemas.claims), /finite number or null/);
  assert.throws(() => encodeProperties({ 'Agent tags': 'abc' }, schemas.claims), /array of page ids/);
  assert.throws(() => encodeProperties({ 'Agent tags': [{ rulebook: 'x' }] }, schemas.claims), /array of page ids/);
  assert.throws(() => encodeProperties({ 'Human only': 'yes' }, { properties: { 'Human only': { type: 'checkbox' } } }), /true or false/);
  assert.throws(() => encodeProperties({ Readiness: 3 }, schemas.claims), /option name or null/);
  assert.throws(() => encodeProperties({ 'Claim title': 5 }, schemas.claims), /string or null/);
  assert.throws(() => encodeProperties({ Started: 5 }, schemas.runs), /ISO date string or null/);
  assert.throws(() => encodeProperties({ 'Decided by': 'u1' }, schemas.tag_decisions), /array of user ids/);
  assert.throws(() => encodeProperties({ A: 'x' }, {}), /no properties/);
  assert.throws(() => encodeProperties({ A: 'x' }, { properties: { A: { type: 'files' } } }), /not a writable property type/);
});

test('encode then decode gives the same plain values (round trip through a REST-shaped echo)', () => {
  const plain = {
    Key: 'abc::Debate', Claim: ['11111111-1111-4111-8111-111111111111'], Tag: ['22222222-2222-4222-8222-222222222222'], 'Agent proposal': 'Add tag', 'Agent confidence': 0.31,
    'Why I recommend this': 'multi\nline', 'Seeded at': '2026-10-09', 'Seeded reasoning': 'x'.repeat(2500), 'In regression suite': '2026-10-14T09:00:00.000Z',
    'In regression suite:end': '2026-10-15T09:00:00.000Z', 'Decided by': ['u1', 'u2'], 'Agent follow-up': null, 'Follow-up run': '',
  };
  const enc = encodeProperties(plain, schemas.tag_decisions);
  const page = { id: 'x', properties: Object.fromEntries(Object.entries(enc).map(([n, e]) => [n, pageValue({ ...schemas.tag_decisions.properties[n] }, e)])) };
  const back = decodePage(page, schemas.tag_decisions).props;
  for (const [k, v] of Object.entries(plain)) assert.deepEqual(back[k], v, k);
});

test('long text is split at 2000 characters and joins back unchanged', () => {
  const text = `${'a'.repeat(1999)}\n${'b'.repeat(2000)}${'c'.repeat(500)}`;
  const enc = encodeProperties({ 'Agent full note': text }, schemas.tag_decisions);
  const pieces = enc['Agent full note'].rich_text;
  assert.deepEqual(pieces.map((c) => c.text.content.length), [2000, 2000, 500]);
  assert.equal(pieces.map((c) => c.text.content).join(''), text);
  assert.deepEqual(splitRichText('').length, 0);
  assert.deepEqual(splitRichText('short'), [{ type: 'text', text: { content: 'short' } }]);
  assert.equal(splitRichText('x'.repeat(2000)).length, 1, 'exactly 2000 is one chunk');
  assert.equal(splitRichText('x'.repeat(2001)).length, 2);
});

test('splitRichText never cuts a surrogate pair', () => {
  const text = `${'a'.repeat(1999)}😀${'b'.repeat(10)}`; // the emoji straddles the 2000 boundary
  const parts = splitRichText(text, 2000);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].text.content, 'a'.repeat(1999));
  assert.ok(parts[1].text.content.startsWith('😀'));
  assert.equal(parts.map((p) => p.text.content).join(''), text);
  for (const p of parts) assert.ok(!/[\ud800-\udbff]$/.test(p.text.content), 'no chunk ends in half a pair');
  assert.throws(() => splitRichText('x', 1), RangeError);
});

// ---- comparing ----

test('normaliseText is the rubric-build function', () => {
  assert.equal(normaliseText, rubricNormaliseText);
  assert.equal(normaliseText('a\r\nb<br>c \\* d  '), 'a\nb\nc * d');
});

test('normId and sameDate', () => {
  assert.equal(normId('ABCDEF01-2345-6789-abcd-ef0123456789'), 'abcdef0123456789abcdef0123456789');
  assert.equal(sameDate('2026-10-09', '2026-10-09'), true);
  assert.equal(sameDate('2026-10-09', '2026-10-10'), false);
  assert.equal(sameDate('2026-10-13T14:25:01.123Z', '2026-10-13T14:25:01.000+00:00'), true, 'same second, different notation');
  assert.equal(sameDate('2026-10-13T14:25:01Z', '2026-10-13T16:25:01+02:00'), true, 'same instant');
  assert.equal(sameDate('2026-10-13T14:25:01Z', '2026-10-13T14:25:02Z'), false);
  assert.equal(sameDate(null, ''), true);
  assert.equal(sameDate('2026-10-09', null), false);
});

test('sameValue: text is normalised, sets ignore order and id format, numbers use a tolerance, empty equals null', () => {
  assert.equal(sameValue('rich_text', 'a\r\nb', 'a\nb'), true);
  assert.equal(sameValue('rich_text', 'a<br>b', 'a\nb'), true);
  assert.equal(sameValue('rich_text', '', null), true);
  assert.equal(sameValue('rich_text', 'a', 'b'), false);
  assert.equal(sameValue('relation', ['AAAAAAAA-1111-4111-8111-111111111111', 'b'], ['b', 'aaaaaaaa111141118111111111111111']), true);
  assert.equal(sameValue('relation', ['a'], ['a', 'b']), false);
  assert.equal(sameValue('relation', [], null), true);
  assert.equal(sameValue('number', 0.1 + 0.2, 0.3), true);
  assert.equal(sameValue('number', 1, 1.0001), false);
  assert.equal(sameValue('number', null, null), true);
  assert.equal(sameValue('number', 0, null), false);
  assert.equal(sameValue('checkbox', true, true), true);
  assert.equal(sameValue('checkbox', false, undefined), true);
  assert.equal(sameValue('select', 'Applies', 'Applies'), true);
  assert.equal(sameValue('select', null, ''), true);
  assert.equal(sameValue('select', 'Applies', 'Does not apply'), false);
  assert.equal(sameValue('date', '2026-10-09', '2026-10-09'), true);
  assert.equal(sameValue('url', 'https://a.test', 'https://a.test'), true);
  assert.equal(sameValue('multi_select', ['a', 'b'], ['b', 'a']), true);
  assert.equal(sameValue(null, 'a  ', 'a'), true, 'untyped strings compare normalised');
  assert.equal(sameValue(null, [], null), true);
  assert.equal(sameValue(null, 3, 3 + 1e-12), true);
});
