import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { assertSchema, validate } from '../../agents/claim-tagger-mvp/scripts/lib/validate.mjs';

const dir = new URL('../../agents/claim-tagger-mvp/schemas/', import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(`${name}.schema.json`, dir), 'utf8'));
/** A schema that checks one entry of definitions of the file (the way the scripts check the lines of a plan or the meta of a cell store). */
const definition = (schema, name) => ({ definitions: schema.definitions, $ref: `#/definitions/${name}` });
const ok = (schema, value, note) => assert.deepEqual(validate(schema, value).errors, [], note);
function bad(schema, value, pattern, note) {
  const { ok: valid, errors } = validate(schema, value);
  assert.equal(valid, false, note ?? 'expected the value to be refused');
  assert.ok(errors.some((e) => pattern.test(e)), `${note ?? ''} ${errors.join(' | ')}`);
}
const hash = 'sha256:0123456789abcdef';

// ---- all of them ---------------------------------------------------------------------------------------------------------------------

test('the folder holds the ten schemas the contracts name, each in the subset the validator supports', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.schema.json')).sort();
  assert.deepEqual(files, ['card', 'cell', 'claim-row', 'judge-reply', 'ledger-row', 'lesson', 'plan', 'reading-reply', 'report', 'rubric'].map((n) => `${n}.schema.json`));
  for (const file of files) {
    const schema = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    assertSchema(schema); // throws on a keyword the validator does not know: a typo would switch a check off
    assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#', file);
    assert.ok(typeof schema.title === 'string' && schema.title.length > 5, `${file} has a title`);
    assert.ok(typeof schema.description === 'string' && schema.description.length > 20, `${file} has a description`);
  }
});

// ---- plan ----------------------------------------------------------------------------------------------------------------------------

const plan = load('plan');
const header = definition(plan, 'headerLine');
const op = definition(plan, 'op');
const headerLine = () => ({ plan: { run_id: '20261016T090000Z-tag', script: 'propose', created_at: '2026-10-16T09:00:00.000Z', rubric_edition: '2026-10-16.1', counts: { creates: 2, updates: 1 } } });
const create = (over = {}) => ({ op: 'create', table: 'tag_decisions', key: 'g1::Context-dependent', properties: { Claim: 'He said it.', Key: 'g1::Context-dependent', 'Agent confidence': 0.62, Tag: 'Context-dependent' }, ...over });
const update = (over = {}) => ({ op: 'update', table: 'claims_copy', key: 'g1', page_id: '0a9e0000-0000-4000-8000-000000000001', properties: { 'Agent tags': 'Context-dependent' }, expect: { 'Agent tags': '' }, ...over });

test('plan: the header line', () => {
  ok(header, headerLine());
  ok(header, { plan: { ...headerLine().plan, rubric_edition: null } }, 'before the first edition exists');
  ok(header, { plan: { ...headerLine().plan, demo: true, note: 'extra keys are allowed inside the header' } });
  bad(header, { plan: { ...headerLine().plan, counts: { creates: 1 } } }, /counts\.updates: missing required property/);
  bad(header, { plan: { ...headerLine().plan, counts: { creates: 1, updates: -1 } } }, /counts\.updates: must be >= 0/);
  bad(header, { plan: { ...headerLine().plan, counts: { creates: 1, updates: 0, deletes: 1 } } }, /counts\.deletes: unexpected property/);
  bad(header, { plan: { ...headerLine().plan, created_at: '16 Oct 2026' } }, /created_at: must match/);
  bad(header, { plan: { run_id: 'x' } }, /missing required property/);
  bad(header, { ...headerLine(), op: 'create' }, /\$\.op: unexpected property/);
  bad(header, create(), /\$\.plan: missing required property/);
});

test('plan: a create op and an update op', () => {
  ok(op, create());
  ok(op, create({ expect: { Key: '' }, children: [{ type: 'paragraph', paragraph: { rich_text: [] } }] }));
  ok(op, update());
  ok(op, update({ expect: undefined, children: [] }));
  for (const table of ['tag_decisions', 'rule_changes', 'agent_settings', 'rulebook', 'claims_copy']) ok(op, create({ table }), table);
  bad(op, create({ table: 'runs' }), /does not match any of the 2 allowed schemas/);
  bad(op, update({ page_id: undefined }), /does not match any of the 2 allowed schemas/, 'an update needs the page');
  bad(op, create({ page_id: '0a9e0000-0000-4000-8000-000000000001' }), /does not match any of the 2 allowed schemas/, 'a create has no page yet');
  bad(op, { ...create(), op: 'delete' }, /does not match any of the 2 allowed schemas/);
  bad(op, { ...create(), op: 'upsert' }, /does not match/);
  bad(op, create({ key: '' }), /does not match/);
  bad(op, { ...create(), properties: undefined }, /does not match/);
  bad(op, create({ note: 'extra' }), /does not match/, 'a typo in a field name is an error');
});

test('plan: property values are plain values', () => {
  const values = ['text', 3, 0.5, true, false, null, [], ['a', 'b']];
  for (const value of values) ok(op, create({ properties: { Column: value } }), JSON.stringify(value));
  for (const value of [{ select: { name: 'x' } }, [1, 2], [['a']], [{ id: 'x' }]]) bad(op, create({ properties: { Column: value } }), /does not match/, JSON.stringify(value));
  bad(op, create({ expect: { Column: { x: 1 } } }), /does not match/);
  bad(op, create({ children: [{ paragraph: {} }] }), /does not match/, 'a block needs its type');
  bad(op, create({ children: 'text' }), /does not match/);
});

test('plan: the root schema takes either kind of line', () => {
  ok(plan, headerLine());
  ok(plan, create());
  ok(plan, update());
  bad(plan, {}, /does not match any of the 2 allowed schemas/);
  bad(plan, [], /does not match/);
  bad(plan, { plan: 1 }, /does not match/);
});

// ---- cell ----------------------------------------------------------------------------------------------------------------------------

const cell = load('cell');
const cellLine = (over = {}) => ({
  id: '3f2273e214eb814681dff6ad6dcf21a0', item_hash: hash, status: 'ok',
  tags: [{ name: 'Context-dependent', decision: 'apply', p: 0.83, rule_ref: 'Context-dependent rule 3', reason: 'The pronoun has no antecedent.' }],
  call: { run_id: '20261016T090000Z-tag', batch: 0, attempt: 1, cli_version: '2.1.296', usage: { input: 1200, cache_write: 0, cache_read: 3400, output: 150 } },
  ...over,
});

test('cell: a judged item of one run', () => {
  ok(cell, cellLine());
  ok(cell, cellLine({ tags: [{ name: 'Context-dependent', decision: 'ask_editor', p: 0.5, rule_ref: null, reason: '' }] }));
  ok(cell, cellLine({ status: 'error', error: 'The reply was not valid JSON.', tags: [] }));
  ok(cell, cellLine({ call: { ...cellLine().call, cli_version: null } }));
  for (const decision of ['apply', 'do_not_apply', 'ask_editor']) ok(cell, cellLine({ tags: [{ name: 'T', decision, p: 0, rule_ref: null, reason: 'r' }] }), decision);
  for (const p of [0, 1, 0.25]) ok(cell, cellLine({ tags: [{ name: 'T', decision: 'apply', p, rule_ref: null, reason: 'r' }] }), String(p));
});

test('cell: what makes a line invalid', () => {
  const tagWith = (over) => cellLine({ tags: [{ name: 'T', decision: 'apply', p: 0.5, rule_ref: null, reason: 'r', ...over }] });
  bad(cell, tagWith({ decision: 'maybe' }), /decision: expected one of "apply", "do_not_apply", "ask_editor"/);
  bad(cell, tagWith({ p: 1.2 }), /\.p: must be <= 1/);
  bad(cell, tagWith({ p: -0.1 }), /\.p: must be >= 0/);
  bad(cell, tagWith({ p: '0.5' }), /\.p: expected number/);
  bad(cell, tagWith({ rule_ref: undefined }), /rule_ref: missing required property/);
  bad(cell, tagWith({ name: '' }), /name: must be at least 1 characters/);
  bad(cell, tagWith({ confidence: 1 }), /confidence: unexpected property/);
  bad(cell, cellLine({ status: 'done' }), /\$\.status: expected one of "ok", "error"/);
  bad(cell, cellLine({ item_hash: 'abc' }), /item_hash: must match/);
  bad(cell, cellLine({ id: '' }), /\$\.id: must be at least 1 characters/);
  bad(cell, cellLine({ call: undefined }), /\$\.call: missing required property/);
  bad(cell, cellLine({ call: { ...cellLine().call, usage: { input: 1 } } }), /usage\.cache_write: missing required property/);
  bad(cell, cellLine({ call: { ...cellLine().call, attempt: 0 } }), /attempt: must be >= 1/);
  bad(cell, cellLine({ call: { ...cellLine().call, batch: -1 } }), /batch: must be >= 0/);
  bad(cell, cellLine({ call: { ...cellLine().call, usage: { input: 1.5, cache_write: 0, cache_read: 0, output: 0 } } }), /usage\.input: expected integer/);
  bad(cell, cellLine({ rubric: 'x' }), /\$\.rubric: unexpected property/);
});

test('cell: the meta of a store folder', () => {
  const meta = definition(cell, 'meta');
  const good = { driver: 'cli', model: 'claude-sonnet-5-5', effort: 'medium', pass: 'text', prompt_version: hash, group: 'G1', tags: [{ name: 'Context-dependent', tag_hash: hash }] };
  ok(meta, good);
  bad(meta, { ...good, pass: 'source' }, /\$\.pass: expected "text"/);
  bad(meta, { ...good, tags: [] }, /tags: must have at least 1 items/);
  bad(meta, { ...good, tags: [{ name: 'T' }] }, /tag_hash: missing required property/);
  bad(meta, { ...good, group: undefined }, /group: missing required property/);
});

// ---- judge reply ---------------------------------------------------------------------------------------------------------------------

const reply = load('judge-reply');
const replyItem = (over = {}) => ({ id: 'g1', tags: [{ name: 'Context-dependent', decision: 'do_not_apply', p: 0.1, rule_ref: null, reason: 'Every referent is named.' }], ...over });

test('judge reply: the shape of one batch answer', () => {
  ok(reply, { items: [replyItem()] });
  ok(reply, { items: [replyItem(), replyItem({ id: 'g2' })] });
  ok(reply, { items: [replyItem()], notes: 'extra keys do not make the reply invalid' });
  ok(reply, { items: [replyItem({ tags: [{ name: 'A', decision: 'apply', p: 1, rule_ref: 'A rule 1', reason: 'x', extra: true }] })] });
});

test('judge reply: what makes a reply invalid', () => {
  bad(reply, {}, /\$\.items: missing required property/);
  bad(reply, { items: [] }, /items: must have at least 1 items/);
  bad(reply, { items: 'g1' }, /items: expected array/);
  bad(reply, [replyItem()], /expected object/);
  bad(reply, { items: [replyItem({ id: '' })] }, /id: must be at least 1 characters/);
  bad(reply, { items: [replyItem({ tags: [] })] }, /tags: must have at least 1 items/);
  bad(reply, { items: [replyItem({ id: undefined })] }, /items\[0\]\.id: missing required property/);
  const tag = (over) => ({ items: [replyItem({ tags: [{ name: 'T', decision: 'apply', p: 0.5, rule_ref: null, reason: 'r', ...over }] })] });
  bad(reply, tag({ decision: 'yes' }), /decision: expected one of/);
  bad(reply, tag({ p: 2 }), /\.p: must be <= 1/);
  bad(reply, tag({ p: 'high' }), /\.p: expected number/);
  bad(reply, tag({ rule_ref: undefined }), /rule_ref: missing required property/);
  bad(reply, tag({ rule_ref: 3 }), /rule_ref: expected string or null/);
  bad(reply, tag({ reason: undefined }), /reason: missing required property/);
  bad(reply, tag({ reason: ['x'] }), /reason: expected string/);
  bad(reply, tag({ name: undefined }), /name: missing required property/);
});

// ---- lesson --------------------------------------------------------------------------------------------------------------------------

const lesson = load('lesson');
const lessonRow = (over = {}) => ({
  Lesson: 'General references pass the rule 4 test', Tag: 'Context-dependent', Rule: 'Context-dependent rule 4', Kind: 'Clarify wording',
  'Current text': 'Test: could a reader who sees only this sentence say which specific thing each definite reference points at?',
  'Proposed text': 'Test: could a reader who sees only this sentence name the one thing each definite reference points at?', Status: 'Proposed', ...over,
});

test('lesson: a Rule changes row', () => {
  ok(lesson, lessonRow());
  ok(lesson, lessonRow({ 'Safety check result': null, 'Supporting rows': null, 'Editor wording': null }));
  ok(lesson, lessonRow({ 'Safety check result': 'PASS: examples 11/11, earlier 5/5, yours 2/2', 'Supporting rows': 'The focus on the COVID-19 vaccine... · 3f2273e2::Context-dependent', 'Editor wording': 'My wording.', Status: 'Approved' }));
  ok(lesson, lessonRow({ Kind: 'Initial rules', 'Current text': null, Rule: 'Wordy when to use', Tag: 'Wordy' }));
  ok(lesson, lessonRow({ page_id: '0a9e0000-0000-4000-8000-000000000009', created: '2026-10-16T09:00:00.000Z', supporting_keys: ['g1::Context-dependent'] }));
  for (const kind of ['Clarify wording', 'Change the rule', 'Initial rules']) ok(lesson, lessonRow({ Kind: kind }), kind);
  for (const status of ['Proposed', 'Approved', 'Rejected', 'Live', 'Rolled back']) ok(lesson, lessonRow({ Status: status }), status);
});

test('lesson: what makes a row invalid', () => {
  bad(lesson, lessonRow({ Kind: 'Add boundary example' }), /Kind: expected one of "Clarify wording", "Change the rule", "Initial rules"/);
  bad(lesson, lessonRow({ Status: 'Done' }), /Status: expected one of "Proposed", "Approved", "Rejected", "Live", "Rolled back"/);
  bad(lesson, lessonRow({ 'Proposed text': '' }), /\$\["Proposed text"\]: must be at least 1 characters/);
  bad(lesson, lessonRow({ 'Proposed text': undefined }), /\$\["Proposed text"\]: missing required property/);
  bad(lesson, lessonRow({ Lesson: '' }), /\$\.Lesson: must be at least 1 characters/);
  bad(lesson, lessonRow({ Tag: undefined }), /\$\.Tag: missing required property/);
  bad(lesson, lessonRow({ 'Lesson ID': 'RC-1' }), /\$\["Lesson ID"\]: unexpected property/, 'the MVP has no Lesson ID');
  bad(lesson, lessonRow({ supporting_keys: 'g1' }), /supporting_keys: expected array/);
});

// ---- card ----------------------------------------------------------------------------------------------------------------------------

const card = load('card');
const cardOf = (over = {}) => ({
  mode: 'simple', verdict: 'PASS', lesson: 'General references pass the rule 4 test', tag: 'Context-dependent',
  checks: { canaries: { passed: 11, total: 11, failures: [] }, cases: { passed: 5, total: 5, newly_failing: [] }, supporting: { passed: 2, total: 2, failures: [] } },
  flips: [{ id: 'g1', tag: 'Context-dependent', claim: 'He said it.', from: 'apply', to: 'do_not_apply' }],
  editions: { baseline: '2026-10-15.1', candidate: '2026-10-15.2' },
  usage: { input: 10, cache_write: 0, cache_read: 20, output: 5 },
  ...over,
});

test('card: PASS, FAIL and HOLD', () => {
  ok(card, cardOf());
  ok(card, cardOf({ lesson: null, tag: null, usage: null, flips: [] }));
  const miss = { id: 'canary-3', claim: 'The Bitcoin ETF integrated Bitcoin.', expected: 'apply', got: 'do_not_apply' };
  ok(card, cardOf({ verdict: 'FAIL', checks: { ...cardOf().checks, canaries: { passed: 10, total: 11, failures: [miss] } } }));
  ok(card, cardOf({ verdict: 'FAIL', checks: { ...cardOf().checks, cases: { passed: 4, total: 5, newly_failing: [{ id: 'g7::Context-dependent', claim: 'A claim.' }] } } }));
  ok(card, cardOf({ verdict: 'HOLD', checks: { canaries: { passed: 0, total: 0, failures: [] }, cases: { passed: 0, total: 0, newly_failing: [] }, supporting: { passed: 0, total: 0, failures: [] } } }));
  const { usage, ...withoutUsage } = cardOf();
  ok(card, withoutUsage, 'usage is optional');
});

test('card: what makes a card invalid', () => {
  bad(card, cardOf({ mode: 'strict' }), /\$\.mode: expected "simple"/);
  bad(card, cardOf({ verdict: 'MAYBE' }), /verdict: expected one of "PASS", "FAIL", "HOLD"/);
  bad(card, cardOf({ checks: { canaries: cardOf().checks.canaries, cases: cardOf().checks.cases } }), /checks\.supporting: missing required property/);
  bad(card, cardOf({ checks: { ...cardOf().checks, canaries: { passed: 1, total: 2 } } }), /canaries\.failures: missing required property/);
  bad(card, cardOf({ checks: { ...cardOf().checks, extra: {} } }), /checks\.extra: unexpected property/);
  bad(card, cardOf({ checks: { ...cardOf().checks, cases: { passed: -1, total: 5, newly_failing: [] } } }), /cases\.passed: must be >= 0/);
  bad(card, cardOf({ checks: { ...cardOf().checks, supporting: { passed: 1, total: 2, failures: [{ claim: 'x' }] } } }), /failures\[0\]\.id: missing required property/);
  bad(card, cardOf({ flips: [{ id: 'g1', from: 'apply' }] }), /flips\[0\]\.to: missing required property/);
  bad(card, cardOf({ editions: { baseline: '2026-10-15.1' } }), /editions\.candidate: missing required property/);
  bad(card, cardOf({ editions: { baseline: '', candidate: 'x' } }), /editions\.baseline: must be at least 1 characters/);
  bad(card, cardOf({ usage: { input: 1.5 } }), /usage\.input: expected integer/);
  bad(card, { mode: 'simple', verdict: 'PASS' }, /missing required property/);
});

// ---- report --------------------------------------------------------------------------------------------------------------------------

const report = load('report');

test('report: the parts of report.json', () => {
  ok(report, { demo: false, sentence: 'Done.', next: 'Next: go on.' });
  ok(report, { demo: true, sentence: 'Done.', header: ['What', 'Result', ''], rows: [['A', '1', '']], next: 'Next: go on.' });
  bad(report, { demo: false, sentence: 'Done.' }, /next: missing required property/);
  bad(report, { demo: 'no', sentence: 'Done.', next: 'Next: x.' }, /demo: expected boolean/);
  bad(report, { demo: false, sentence: 'Done.', next: 'Next: x.', title: 'Report' }, /title: unexpected property/);
  bad(report, { demo: false, sentence: 'Done.', rows: [], header: ['a', 'b', ''], next: 'Next: x.' }, /rows: must have at least 1 items/);
});

// ---- claim row and ledger row (CLAIMS-REVIEW.md) --------------------------------------------------------------------------------------

const claimRow = load('claim-row');
const claimOf = (over = {}) => ({
  table: 'claims_copy', geo_id: 'g1', page_id: '0a9e0000-0000-4000-8000-000000000001', notion_url: 'https://www.notion.so/x', claim: 'The AI Force should enforce binding safety standards',
  geo_url: null, sources_text: '', source_links: [], is_factual: false, agent_tags: [], agent_status: 'Waits for you', tags_waiting: ['Context-dependent'], agent_confidence: 0.65,
  agent_reasons: "Context-dependent: Two rules pull apart. · 2 of 2 runs agree", agent_edition: '2026-10-16.1', agent_remarks: '', agent_reading: '', verified_tags: [], review_status: null,
  challenged_notes: '', last_edited: '2026-10-16T09:00:00.000Z', ...over,
});

test('claim row: an open claim, a Reviewed claim and one that has never been read', () => {
  ok(claimRow, claimOf());
  ok(claimRow, claimOf({
    agent_tags: ['Context-dependent'], agent_status: 'Done', tags_waiting: [], agent_remarks: 'not checked: 5 tags without rules', verified_tags: ['Context-dependent'], review_status: 'Reviewed',
    agent_reading: 'Context-dependent: Rule unclear, rule 3 · The rule leaves this kind of case open.', challenged_notes: 'Context-dependent: Rule unclear. Rule 3 is unclear.',
  }));
  ok(claimRow, claimOf({ agent_status: null, tags_waiting: [], agent_edition: '', agent_confidence: null, review_status: 'To review' }));
  for (const status of ['Waits for you', 'Done', 'Disagrees with your decision', 'Could not read', null]) ok(claimRow, claimOf({ agent_status: status }), String(status));
  ok(claimRow, claimOf({ review_status: 'Reviewed', agent_reading: 'Nothing to read: the agent agreed with you.' }), 'the agree line');
});

test('claim row: what makes a row invalid', () => {
  bad(claimRow, claimOf({ review_status: 'Done' }), /review_status: expected one of "To review", "Reviewed", null/);
  bad(claimRow, claimOf({ why_wrong: 'Rule unclear' }), /why_wrong: unexpected property/, 'the claims table has no Why wrong any more (decision P4)');
  bad(claimRow, claimOf({ agent_reading: undefined }), /agent_reading: missing required property/);
  bad(claimRow, claimOf({ agent_reading: null }), /agent_reading: expected string/);
  bad(claimRow, claimOf({ agent_confidence: 0.2 }), /agent_confidence: must be >= 0.5/);
  bad(claimRow, claimOf({ agent_confidence: 1.1 }), /agent_confidence: must be <= 1/);
  bad(claimRow, claimOf({ verified_tags: 'Context-dependent' }), /verified_tags: expected array/);
  bad(claimRow, claimOf({ agent_tags: 'Context-dependent' }), /agent_tags: expected array/);
  bad(claimRow, claimOf({ tags_waiting: [''] }), /tags_waiting\[0\]: must be at least 1 characters/);
  bad(claimRow, claimOf({ agent_status: 'Maybe' }), /agent_status: expected one of "Waits for you", "Done", "Disagrees with your decision", "Could not read", null/);
  bad(claimRow, claimOf({ agent_status: undefined }), /agent_status: missing required property/);
  bad(claimRow, claimOf({ agent_edition: undefined }), /agent_edition: missing required property/);
  bad(claimRow, claimOf({ agent_notes: 'no tags' }), /agent_notes: unexpected property/);
  bad(claimRow, claimOf({ verified_tags: [''] }), /verified_tags\[0\]: must be at least 1 characters/);
  bad(claimRow, claimOf({ geo_id: '' }), /geo_id: must be at least 1 characters/);
  bad(claimRow, claimOf({ challenged_notes: undefined }), /challenged_notes: missing required property/);
  bad(claimRow, claimOf({ agent_reasons: undefined }), /agent_reasons: missing required property/);
  bad(claimRow, claimOf({ agent_reasons: null }), /agent_reasons: expected string/);
  bad(claimRow, claimOf({ decided: true }), /decided: unexpected property/);
});

const ledgerRow = load('ledger-row');
const ledgerOf = (over = {}) => ({
  Claim: 'The AI Force should enforce binding safety standards', Key: 'g1::Context-dependent', Tag: 'Context-dependent', 'Agent proposal': "Can't tell", 'Agent confidence': 0.65,
  'Agent reason': 'A capitalised phrase · Context-dependent rule 3 · 2 of 2 runs agree', 'Claim link': 'https://www.notion.so/x', 'Rulebook edition': '2026-10-16.1', 'Follow-up': null,
  'Tag outcome': null, 'Why wrong': null, 'Your reasoning': null, 'Decided under': null, 'Agent reading': null, Rule: null, 'Reading note': null, 'Read under': null,
  page_id: '0a9e0000-0000-4000-8000-000000000002', last_edited: null, decided: false, ...over,
});

test('ledger row: a proposal, and a proposal with the copy of the decision', () => {
  ok(ledgerRow, ledgerOf());
  ok(ledgerRow, ledgerOf({ 'Tag outcome': 'Applies', 'Why wrong': 'Rule unclear', 'Your reasoning': 'Context-dependent: rule 3 is unclear.', 'Decided under': '2026-10-16.1', decided: true, 'Follow-up': 'Fixed' }));
  ok(ledgerRow, ledgerOf({ 'Agent proposal': null, 'Agent confidence': null, 'Rulebook edition': null }), 'a row seeded from the audit has no proposal columns');
});

test('ledger row: the four columns of the agent\'s reading are nullable strings, and the reading is one of the three', () => {
  ok(ledgerRow, ledgerOf({
    'Tag outcome': 'Does not apply', decided: true, 'Agent reading': 'Rule unclear', Rule: 'Context-dependent rule 3', 'Reading note': 'without your note · The rule leaves this kind of case open.',
    'Read under': '2026-10-16.1 · 0123abcd',
  }));
  for (const reading of ['Agent slip', 'Rule unclear', 'Rule should change', null]) ok(ledgerRow, ledgerOf({ 'Agent reading': reading }), String(reading));
  ok(ledgerRow, ledgerOf({ Rule: null, 'Reading note': null, 'Read under': null }), 'no single rule is the point');
  const { 'Agent reading': _a, Rule: _r, 'Reading note': _n, 'Read under': _u, ...old } = ledgerOf();
  ok(ledgerRow, old, 'a pull of a table that has not got the four columns yet fills them with null; a row without them still fits');
  bad(ledgerRow, ledgerOf({ 'Agent reading': 'Maybe' }), /\["Agent reading"\]: expected one of "Agent slip", "Rule unclear", "Rule should change", null/);
  bad(ledgerRow, ledgerOf({ Rule: 3 }), /Rule: expected string or null/);
  bad(ledgerRow, ledgerOf({ 'Read under': { hash: 'x' } }), /\["Read under"\]: expected string or null/);
});

test('ledger row: what makes a row invalid', () => {
  bad(ledgerRow, ledgerOf({ 'Tag outcome': 'Maybe' }), /\["Tag outcome"\]: expected one of "Applies", "Does not apply", null/);
  bad(ledgerRow, ledgerOf({ 'Agent proposal': 'Applies?' }), /\["Agent proposal"\]: expected one of/);
  bad(ledgerRow, ledgerOf({ 'Follow-up': 'Done' }), /\["Follow-up"\]: expected one of/);
  bad(ledgerRow, ledgerOf({ Key: '' }), /Key: must be at least 1 characters/);
  bad(ledgerRow, ledgerOf({ decided: 'yes' }), /decided: expected boolean/);
  bad(ledgerRow, ledgerOf({ 'Decided by': 'someone' }), /\["Decided by"\]: unexpected property/);
  bad(ledgerRow, ledgerOf({ page_id: undefined }), /page_id: missing required property/);
});

// ---- reading reply (READ-DECISIONS.md) ------------------------------------------------------------------------------------------------

const readingReply = load('reading-reply');
const readingOf = (over = {}) => ({ key: 'g1::Context-dependent', reading: 'Rule unclear', rule: 'Context-dependent rule 3', note: 'The rule leaves this kind of case open.', ...over });

test('reading reply: {"readings": [...]} with a reading of the three, a rule or null, and a note', () => {
  ok(readingReply, { readings: [readingOf()] });
  ok(readingReply, { readings: [readingOf(), readingOf({ key: 'g2::Context-dependent', reading: 'Agent slip', rule: null }), readingOf({ key: 'g3::Context-dependent', reading: 'Rule should change' })] });
  for (const reading of ['Agent slip', 'Rule unclear', 'Rule should change']) ok(readingReply, { readings: [readingOf({ reading })] }, reading);
  bad(readingReply, {}, /readings: missing required property/);
  bad(readingReply, { readings: [] }, /readings: must have at least 1 items/);
  bad(readingReply, { readings: [readingOf({ reading: 'Fine' })] }, /reading: expected one of "Agent slip", "Rule unclear", "Rule should change"/);
  bad(readingReply, { readings: [readingOf({ key: '' })] }, /key: must be at least 1 characters/);
  bad(readingReply, { readings: [readingOf({ rule: 3 })] }, /rule: expected string or null/);
  bad(readingReply, { readings: [readingOf({ rule: undefined })] }, /rule: missing required property/);
  bad(readingReply, { readings: [readingOf({ note: '' })] }, /note: must be at least 1 characters/);
  bad(readingReply, { readings: [readingOf({ note: undefined })] }, /note: missing required property/);
  bad(readingReply, [readingOf()], /expected object/);
});
