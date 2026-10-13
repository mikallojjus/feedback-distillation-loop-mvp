import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  configId, fileSha256, h16, promptVersion, rubricHash, ruleHash, scopeHash, sha256Hex, tagHash,
} from '../agents/claim-tagger/scripts/lib/hash.mjs';
import { pyJson } from '../agents/claim-tagger/scripts/lib/pyjson.mjs';

const FIXTURE_PATH = new URL('./fixtures/rubric.research-example.json', import.meta.url);
const parsed = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
const fixture = () => structuredClone(parsed);

// Characters built from code points on purpose (no \u escapes in this file).
const E_ACUTE = String.fromCharCode(0xe9);
const EM_DASH = String.fromCharCode(0x2014);

const hasNonAscii = (value) => /[^\x00-\x7f]/.test(JSON.stringify(value));
const subsetOf = (t) => ({
  name: t.name, counterpart: t.counterpart, polarity: t.polarity, description: t.description,
  when_to_use: t.when_to_use, example_claims: t.example_claims,
});
const allRuleHashes = (r) => Object.fromEntries(r.tags.flatMap((t) => t.when_to_use.rules.map((x) => [`${t.name}#${x.n}`, ruleHash(t.name, x.n, x.text)])));
const allTagHashes = (r) => Object.fromEntries(r.tags.map((t) => [t.name, tagHash(t)]));
const changedKeys = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]);

// ---- vectors from the research script (tests/fixtures/rubric.research-example.json) ----

test('all 71 rule hashes of the research rubric reproduce', () => {
  let n = 0;
  for (const t of parsed.tags) {
    for (const r of t.when_to_use.rules) {
      n++;
      assert.equal(ruleHash(t.name, r.n, r.text), r.rule_hash, `${t.name} rule ${r.n}`);
    }
  }
  assert.equal(n, 71);
});

test('all 14 tag hashes of the research rubric reproduce', () => {
  assert.equal(parsed.tags.length, 14);
  for (const t of parsed.tags) assert.equal(tagHash(t), t.tag_hash, t.name);
});

test('the rubric hash and the scope hash reproduce', () => {
  assert.equal(rubricHash(parsed), 'sha256:b7851e23dcd3be52');
  assert.equal(rubricHash(parsed), parsed.rubric_hash);
  assert.equal(scopeHash(parsed.scope), 'sha256:5cf30ca98835c948');
  assert.equal(scopeHash(parsed.scope), parsed.scope_hash);
  assert.equal(scopeHash(parsed), parsed.scope_hash, 'a rubric object is accepted too');
});

test('negative vector: JSON.stringify instead of Python separators gives a different rubric hash', () => {
  const plain = h16(JSON.stringify(parsed.tags.map((t) => t.tag_hash)));
  assert.equal(plain, 'sha256:dd8aa149ba094151');
  assert.notEqual(plain, parsed.rubric_hash);
});

test('the first rule hash is the documented literal', () => {
  const t = parsed.tags.find((x) => x.name === 'Context-dependent');
  assert.equal(ruleHash(t.name, 1, t.when_to_use.rules[0].text), 'sha256:3327225055951715');
});

test('SURPRISE: the tag hash hashes non-ASCII text raw (ensure_ascii=False), as the research script did', () => {
  const ascii = parsed.tags.map((t) => ({ t, h: h16(pyJson(subsetOf(t), { sortKeys: true })) }));
  const different = ascii.filter((x) => x.h !== x.t.tag_hash);
  assert.ok(different.length > 0, 'the fixture has em dashes and an accented letter, so some tags must differ');
  for (const { t, h } of ascii) assert.equal(h === t.tag_hash, !hasNonAscii(subsetOf(t)), `${t.name}: only tags with non-ASCII text differ under ASCII escaping`);
});

// ---- h16, prompt versions, config ids ----

test('h16 is "sha256:" plus the first 16 hex digits of the SHA-256 of the UTF-8 bytes (Python hashlib vectors)', () => {
  assert.equal(h16('abc'), 'sha256:ba7816bf8f01cfea');
  assert.equal(h16(''), 'sha256:e3b0c44298fc1c14');
  assert.equal(h16('caf' + E_ACUTE), 'sha256:850f7dc43910ff89');
  assert.equal(h16(Buffer.from('abc')), h16('abc'));
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('promptVersion hashes the bytes, not a decoded string', () => {
  assert.equal(promptVersion(Buffer.from([0xff, 0xfe])), 'sha256:b3d510ef04275ca8');
  assert.equal(promptVersion(Buffer.from('abc')), h16('abc'));
  assert.notEqual(promptVersion(Buffer.from('a\r\n')), promptVersion(Buffer.from('a\n')), 'line endings are part of the bytes');
});

test('fileSha256 is the full digest of the file bytes', () => {
  assert.equal(fileSha256(FIXTURE_PATH), sha256Hex(readFileSync(FIXTURE_PATH)));
  assert.equal(fileSha256(FIXTURE_PATH).length, 64);
});

test('ruleHash and tagHash match Python on text with an accent and an em dash', () => {
  assert.equal(ruleHash('Predictive', 2, 'A hedged tendency is not a forecast.'), 'sha256:855e23151f1dbfd3');
  assert.equal(ruleHash('Factual', 1, `caf${E_ACUTE} ${EM_DASH} ok`), 'sha256:d948f206f52785ff');
  const text = `One ${EM_DASH} rule.`;
  const tag = {
    name: 'Demo', counterpart: null, polarity: 'Issue', description: `caf${E_ACUTE} ${EM_DASH} test`,
    when_to_use: { preamble: 'Pre.', rules: [{ n: 1, text, rule_hash: ruleHash('Demo', 1, text) }], note: '' },
    example_claims: ['A claim.', `caf${E_ACUTE}`],
  };
  assert.equal(tagHash(tag), 'sha256:7dabf0600119347d', 'Python json.dumps(sort_keys=True, ensure_ascii=False)');
  assert.equal(h16(pyJson(tag, { sortKeys: true })), 'sha256:3cd0dc92d77dd338', 'with ensure_ascii the hash would be different');
});

test('configId is the hash of the sorted-key JSON with ASCII escapes (Python default)', () => {
  assert.equal(configId({ b: [1, 2], a: { z: null, y: true } }), 'sha256:b511425644179c28');
  assert.equal(configId({ a: { y: true, z: null }, b: [1, 2] }), 'sha256:b511425644179c28', 'key order does not matter');
  assert.equal(configId({ name: `caf${E_ACUTE}`, model: 'claude-sonnet-5-5', runs: 3, effort: 'medium' }), 'sha256:35c2cf2007457807');
  const cfg = {
    driver: 'claude -p', model: 'claude-sonnet-5-5', effort: 'medium', prompt_version: 'sha256:0123456789abcdef',
    rubric_hash: 'sha256:b7851e23dcd3be52', scope_hash: 'sha256:5cf30ca98835c948', cli_version: '2.1.296',
  };
  assert.equal(configId(cfg), 'sha256:849518d0f43068d6');
  assert.notEqual(configId({ ...cfg, effort: 'high' }), configId(cfg), 'any field changes the id');
  assert.notEqual(configId({ ...cfg, rubric_hash: 'sha256:0000000000000000' }), configId(cfg));
});

// ---- what is and is not part of a hash ----

test('one rule edit changes exactly its rule hash, its tag hash and the rubric hash', () => {
  const edited = fixture();
  edited.tags.find((t) => t.name === 'Predictive').when_to_use.rules[0].text += ' (edited)';
  assert.deepEqual(changedKeys(allRuleHashes(parsed), allRuleHashes(edited)), ['Predictive#1']);
  assert.deepEqual(changedKeys(allTagHashes(parsed), allTagHashes(edited)), ['Predictive']);
  assert.notEqual(rubricHash(edited), rubricHash(parsed));
  assert.equal(scopeHash(edited.scope), scopeHash(parsed.scope), 'editing a rule does not change the scope');
});

test('a version change, a changelog entry and metadata do not change any hash', () => {
  const r = fixture();
  r.rubric_version = '2099-01-01.7';
  r.changelog.push({ version: '2099-01-01.7', date: '2099-01-01', note: 'x' });
  r.source = { note: 'something else' };
  for (const t of r.tags) {
    t.notion_page_id = 'f'.repeat(32);
    t.category = 'Other';
    t.geo_status = 'Existing in Geo';
    t.geo_tag_id = null;
    t.verified_on = '2030-01-01';
    t.evidence_url = null;
    t.status = 'Verified';
    t.tag_hash = 'stale';
    for (const x of t.when_to_use.rules) x.rule_hash = 'stale';
  }
  assert.deepEqual(allTagHashes(r), allTagHashes(parsed), 'stored hash fields are ignored, hashes come from the content');
  assert.equal(rubricHash(r), parsed.rubric_hash);
});

test('every hashed field changes the tag hash', () => {
  const base = parsed.tags.find((t) => t.name === 'Debate');
  const edits = {
    name: (t) => { t.name = 'Debate2'; },
    counterpart: (t) => { t.counterpart = 'Other'; },
    polarity: (t) => { t.polarity = 'Issue'; },
    description: (t) => { t.description += ' '; },
    preamble: (t) => { t.when_to_use.preamble += '.'; },
    note: (t) => { t.when_to_use.note += '.'; },
    'rule number': (t) => { t.when_to_use.rules[0].n = 9; },
    'rule text': (t) => { t.when_to_use.rules[0].text += '.'; },
    'extra rule': (t) => { t.when_to_use.rules.push({ n: 99, text: 'x' }); },
    'example claim': (t) => { t.example_claims[0] += '.'; },
    'example order': (t) => { t.example_claims.reverse(); },
  };
  for (const [what, edit] of Object.entries(edits)) {
    const t = structuredClone(base);
    edit(t);
    assert.notEqual(tagHash(t), base.tag_hash, what);
  }
});

test('a missing counterpart is null; tag order does not matter for the rubric hash; scope order does not matter', () => {
  const t = structuredClone(parsed.tags.find((x) => x.name === 'Hypothetical'));
  assert.equal(t.counterpart, null);
  delete t.counterpart;
  assert.equal(tagHash(t), parsed.tags.find((x) => x.name === 'Hypothetical').tag_hash);
  assert.equal(rubricHash([...parsed.tags].reverse()), parsed.rubric_hash);
  assert.equal(scopeHash([...parsed.scope].reverse()), parsed.scope_hash);
});

test('an undefined field cannot silently drop out of a tag hash', () => {
  const t = structuredClone(parsed.tags[0]);
  delete t.polarity;
  assert.throws(() => tagHash(t), TypeError);
});
