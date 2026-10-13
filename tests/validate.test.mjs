import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSchema, validate } from '../agents/claim-tagger/scripts/lib/validate.mjs';

const SMILE = String.fromCodePoint(0x1f600);
const ok = (schema, value) => assert.deepEqual(validate(schema, value), { ok: true, errors: [] }, JSON.stringify(value));
const bad = (schema, value, ...errors) => {
  const r = validate(schema, value);
  assert.equal(r.ok, false, `expected a failure for ${JSON.stringify(value)}`);
  assert.deepEqual(r.errors, errors);
};

test('result shape and the documented error format', () => {
  const schema = { type: 'object', properties: { tags: { type: 'array', items: { type: 'object', properties: { p: { type: 'number' } } } } } };
  ok(schema, { tags: [{ p: 0.5 }] });
  bad(schema, { tags: [{ p: 0.5 }, { p: 'high' }] }, '$.tags[1].p: expected number');
  bad(schema, { tags: [{ p: 'x' }] }, '$.tags[0].p: expected number');
});

test('a base path can be given', () => {
  bad({ type: 'string' }, 5, '$: expected string');
  assert.deepEqual(validate({ type: 'string' }, 5, 'judgment[3]').errors, ['judgment[3]: expected string']);
});

test('property names that are not identifiers use brackets in the path', () => {
  const schema = { type: 'object', properties: { 'Single core statement': { type: 'string' }, plain: { type: 'string' } } };
  bad(schema, { 'Single core statement': 1, plain: 2 }, '$["Single core statement"]: expected string', '$.plain: expected string');
});

// ---- type ----

test('type: every JSON type, lists with null, integer versus number', () => {
  ok({ type: 'string' }, 'a');
  ok({ type: 'number' }, 1.5);
  ok({ type: 'number' }, 3);
  ok({ type: 'integer' }, 3);
  ok({ type: 'integer' }, 3.0);
  ok({ type: 'boolean' }, false);
  ok({ type: 'object' }, {});
  ok({ type: 'array' }, []);
  ok({ type: 'null' }, null);
  ok({ type: ['string', 'null'] }, null);
  ok({ type: ['string', 'null'] }, 'x');
  bad({ type: 'integer' }, 1.5, '$: expected integer');
  bad({ type: 'number' }, '1', '$: expected number');
  bad({ type: 'number' }, NaN, '$: expected number');
  bad({ type: 'number' }, Infinity, '$: expected number');
  bad({ type: 'string' }, null, '$: expected string');
  bad({ type: 'object' }, [], '$: expected object');
  bad({ type: 'object' }, null, '$: expected object');
  bad({ type: 'array' }, {}, '$: expected array');
  bad({ type: 'boolean' }, 0, '$: expected boolean');
  bad({ type: ['string', 'null'] }, 5, '$: expected string or null');
  bad({ type: 'string' }, undefined, '$: expected string');
});

test('a type error stops the other checks on that value (no pile of follow-on errors)', () => {
  bad({ type: 'string', enum: ['a', 'b'], minLength: 3 }, 5, '$: expected string');
});

// ---- objects ----

test('required: a missing property, an undefined one, and an inherited one all count as missing', () => {
  const schema = { type: 'object', required: ['a', 'constructor'] };
  bad(schema, {}, '$.a: missing required property', '$.constructor: missing required property');
  bad(schema, { a: undefined, constructor: 1 }, '$.a: missing required property');
  ok(schema, { a: null, constructor: 1 });
});

test('properties: only present properties are checked; nested paths accumulate', () => {
  const schema = { type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'integer' } } }, c: { type: 'string' } } };
  ok(schema, {});
  bad(schema, { a: { b: 'x' }, c: 1 }, '$.a.b: expected integer', '$.c: expected string');
});

test('properties named like Object.prototype members are not read from the prototype', () => {
  ok({ type: 'object', properties: { toString: { type: 'string' } } }, {});
});

test('additionalProperties: false rejects extra keys, true allows them, a schema checks them', () => {
  const closed = { type: 'object', properties: { a: { type: 'number' } }, additionalProperties: false };
  ok(closed, { a: 1 });
  bad(closed, { a: 1, b: 2, 'c d': 3 }, '$.b: unexpected property', '$["c d"]: unexpected property');
  ok({ type: 'object', additionalProperties: true }, { anything: 1 });
  const typed = { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: { type: 'number' } };
  ok(typed, { id: 'x', n: 1 });
  bad(typed, { id: 'x', n: 'one' }, '$.n: expected number');
  ok(closed, { a: 1, extra: undefined });
});

// ---- enum, const ----

test('enum and const use deep equality', () => {
  ok({ enum: ['apply', 'do_not_apply', null] }, null);
  ok({ enum: [[1, 2], { a: 1 }] }, [1, 2]);
  ok({ enum: [[1, 2], { a: 1 }] }, { a: 1 });
  bad({ enum: ['apply', 'do_not_apply'] }, 'maybe', '$: expected one of "apply", "do_not_apply"');
  bad({ enum: [1, 2] }, '1', '$: expected one of 1, 2');
  bad({ enum: [[1, 2]] }, [2, 1], '$: expected one of [1,2]');
  ok({ const: 'Verified' }, 'Verified');
  ok({ const: { a: [1] } }, { a: [1] });
  bad({ const: 'Verified' }, 'Proposed', '$: expected "Verified"');
  bad({ const: null }, 0, '$: expected null');
});

// ---- arrays ----

test('items, minItems, maxItems', () => {
  const schema = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 };
  ok(schema, ['a']);
  ok(schema, ['a', 'b']);
  bad(schema, [], '$: must have at least 1 items');
  bad(schema, ['a', 'b', 'c'], '$: must have at most 2 items');
  bad(schema, ['a', 3, 'c', null], '$: must have at most 2 items', '$[1]: expected string', '$[3]: expected string');
});

// ---- numbers and strings ----

test('minimum and maximum are inclusive and only apply to numbers', () => {
  const schema = { type: 'number', minimum: 0, maximum: 1 };
  ok(schema, 0);
  ok(schema, 1);
  ok(schema, 0.5);
  bad(schema, -0.1, '$: must be >= 0');
  bad(schema, 1.1, '$: must be <= 1');
  ok({ minimum: 5 }, 'text');
});

test('minLength and maxLength count characters (code points), not UTF-16 units', () => {
  const schema = { type: 'string', minLength: 2, maxLength: 3 };
  ok(schema, 'ab');
  ok(schema, 'abc');
  bad(schema, 'a', '$: must be at least 2 characters');
  bad(schema, 'abcd', '$: must be at most 3 characters');
  ok(schema, SMILE + SMILE, 'two emoji are two characters');
  bad(schema, SMILE, '$: must be at least 2 characters');
  ok({ minLength: 3 }, 5);
});

test('pattern is a search, not a full match; anchors work; the u flag and plain escapes both work', () => {
  const hash = { type: 'string', pattern: '^sha256:[0-9a-f]{16}$' };
  ok(hash, 'sha256:b7851e23dcd3be52');
  bad(hash, 'sha256:b7851e23dcd3be5', '$: must match ^sha256:[0-9a-f]{16}$');
  bad(hash, 'sha256:B7851E23DCD3BE52', '$: must match ^sha256:[0-9a-f]{16}$');
  ok({ pattern: 'foo' }, 'a foo b');
  bad({ pattern: 'foo' }, 'bar', '$: must match foo');
  ok({ pattern: '^\\d{4}-\\d{2}-\\d{2}\\.\\d+$' }, '2026-10-13.1');
  ok({ pattern: '^[\\p{L}]+$' }, 'caf' + String.fromCharCode(0xe9));
  ok({ pattern: '^a\\-b$' }, 'a-b');
  ok({ pattern: 'a' }, 5, 'a number is not matched against a string pattern');
});

// ---- combinators ----

test('anyOf: one match is enough, otherwise the first error of each branch is shown', () => {
  const schema = { anyOf: [{ type: 'string' }, { type: 'number' }] };
  ok(schema, 'x');
  ok(schema, 3);
  bad(schema, null, '$: does not match any of the 2 allowed schemas (#1: $: expected string; #2: $: expected number)');
});

test('oneOf: exactly one branch', () => {
  const schema = { oneOf: [{ type: 'number', minimum: 10 }, { type: 'number', maximum: 20 }, { type: 'string' }] };
  ok(schema, 5); // only the second
  ok(schema, 'x'); // only the third
  ok(schema, 25); // only the first
  bad(schema, 15, '$: matches 2 of the 3 allowed schemas, expected exactly one');
  bad(schema, null, '$: does not match any of the 3 allowed schemas (#1: $: expected number; #2: $: expected number; #3: $: expected string)');
});

test('oneOf on variants of an object (a tagged union)', () => {
  const create = { type: 'object', required: ['op', 'props'], properties: { op: { const: 'create' }, props: { type: 'object' } } };
  const update = { type: 'object', required: ['op', 'page'], properties: { op: { const: 'update' }, page: { type: 'string' } } };
  const schema = { oneOf: [create, update] };
  ok(schema, { op: 'create', props: {} });
  ok(schema, { op: 'update', page: 'p1' });
  assert.equal(validate(schema, { op: 'delete' }).ok, false);
});

test('allOf: every branch is checked and all errors are reported', () => {
  const schema = { allOf: [{ type: 'object', required: ['a'] }, { type: 'object', required: ['b'] }] };
  ok(schema, { a: 1, b: 2 });
  bad(schema, {}, '$.a: missing required property', '$.b: missing required property');
});

// ---- $ref and annotations ----

test('$ref to definitions, $defs and the root (recursion)', () => {
  const schema = {
    definitions: { hash: { type: 'string', pattern: '^sha256:' } },
    type: 'object',
    properties: { h: { $ref: '#/definitions/hash' }, list: { type: 'array', items: { $ref: '#/definitions/hash' } }, child: { $ref: '#' } },
  };
  ok(schema, { h: 'sha256:a', list: ['sha256:b'], child: { h: 'sha256:c' } });
  bad(schema, { h: 'x', list: ['sha256:b', 'y'], child: { h: 'z' } }, '$.h: must match ^sha256:', '$.list[1]: must match ^sha256:', '$.child.h: must match ^sha256:');
  ok({ $defs: { n: { type: 'integer' } }, $ref: '#/$defs/n' }, 4);
  bad({ $defs: { n: { type: 'integer' } }, $ref: '#/$defs/n' }, 'x', '$: expected integer');
});

test('annotation keywords are accepted and ignored', () => {
  ok({
    $schema: 'http://json-schema.org/draft-07/schema#', $id: 'x', $comment: 'c', title: 't', description: 'd', default: 1, examples: [1], format: 'date-time', type: 'string',
  }, 'x');
});

test('boolean schemas', () => {
  ok(true, { anything: 1 });
  bad(false, 1, '$: not allowed');
  ok({ type: 'object', properties: { a: true } }, { a: 1 });
  bad({ type: 'object', properties: { a: false } }, { a: 1 }, '$.a: not allowed');
});

// ---- schema errors are loud ----

test('an unsupported or misspelled keyword throws instead of silently switching the check off', () => {
  for (const keyword of ['uniqueItems', 'not', 'patternProperties', 'exclusiveMinimum', 'multipleOf', 'if', 'contains', 'require', 'propertise', 'dependencies']) {
    assert.throws(() => validate({ type: 'object', [keyword]: true }, {}), new RegExp(`unsupported keyword "${keyword}"`), keyword);
  }
  assert.throws(() => validate({ properties: { a: { items: { oneOf: [{ type: 'string', minProperties: 1 }] } } } }, {}), /schema error at #\/properties\/a\/items\/oneOf\/0: unsupported keyword "minProperties"/);
  assert.throws(() => assertSchema({ definitions: { x: { bogus: 1 } } }), /unsupported keyword "bogus"/);
});

test('malformed keyword values throw', () => {
  const cases = [
    { required: 'a' }, { required: [1] }, { type: 'text' }, { type: ['string', 'nope'] }, { enum: [] }, { enum: 'a' }, { minItems: -1 }, { maxLength: 1.5 },
    { minimum: '0' }, { pattern: '(' }, { pattern: 5 }, { anyOf: [] }, { oneOf: {} }, { items: [{ type: 'string' }] }, { properties: [] }, { $ref: 5 }, { $ref: 'other.json' },
    { $ref: '#/definitions/missing' }, 'string', null, 5,
  ];
  for (const schema of cases) assert.throws(() => validate(schema, {}), Error, JSON.stringify(schema));
});

test('an error list is capped so a retry prompt stays small', () => {
  const r = validate({ type: 'array', items: { type: 'string' } }, Array.from({ length: 300 }, () => 1));
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 101);
  assert.equal(r.errors[100], '$: ... and 200 more errors');
});

test('a judgment-shaped schema end to end', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'tags'],
    properties: {
      id: { type: 'string', minLength: 1 },
      tags: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'decision', 'p'],
          properties: {
            name: { type: 'string' },
            decision: { enum: ['apply', 'do_not_apply', 'cannot_tell'] },
            p: { type: 'number', minimum: 0, maximum: 1 },
            rule_ref: { type: ['string', 'null'] },
          },
        },
      },
    },
  };
  ok(schema, { id: 'c1', tags: [{ name: 'Predictive', decision: 'apply', p: 0.9, rule_ref: 'Predictive rule 1' }, { name: 'Debate', decision: 'cannot_tell', p: 0.5, rule_ref: null }] });
  bad(
    schema,
    { id: '', tags: [{ name: 'Predictive', decision: 'yes', p: 1.5, extra: 1 }, { name: 'Debate', p: 'x' }], more: 1 },
    '$.id: must be at least 1 characters',
    '$.tags[0].decision: expected one of "apply", "do_not_apply", "cannot_tell"',
    '$.tags[0].p: must be <= 1',
    '$.tags[0].extra: unexpected property',
    '$.tags[1].decision: missing required property',
    '$.tags[1].p: expected number',
    '$.more: unexpected property',
  );
});
