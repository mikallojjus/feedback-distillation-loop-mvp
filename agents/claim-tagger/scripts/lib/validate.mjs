// A small JSON Schema validator for the agent's own schemas (no dependencies).
//
// Supported: type (name or list, incl. "null"), properties, required, additionalProperties (false, true or a schema),
// enum, const, items (one schema), minItems, maxItems, minimum, maximum, minLength, maxLength, pattern, anyOf, oneOf
// (exactly one), allOf, and local "$ref" ("#", "#/definitions/x", "#/$defs/x"). Annotations (title, description, default,
// examples, format, $schema, $id, $comment, definitions, $defs) are accepted and ignored.
// Any other keyword THROWS: a schema keyword that is silently ignored (or a typo such as "require") would turn the
// check off without anyone noticing, so an unsupported schema is a bug in the schema, not a data error.

import { isDeepStrictEqual } from 'node:util';

const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
const ASSERTIONS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'enum', 'const', 'items', 'minItems', 'maxItems',
  'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'anyOf', 'oneOf', 'allOf', '$ref',
]);
const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'default', 'examples', 'format', 'deprecated', 'readOnly', 'writeOnly']);
const MAX_ERRORS = 100;
const IDENT = /^[A-Za-z_$][\w$]*$/;

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const present = (obj, k) => Object.hasOwn(obj, k) && obj[k] !== undefined;
const keyPath = (path, key) => (IDENT.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`);
const codePoints = (s) => [...s].length;

const regexCache = new Map();
function regexFor(pattern) {
  let re = regexCache.get(pattern);
  if (!re) {
    try {
      re = new RegExp(pattern, 'u');
    } catch {
      re = new RegExp(pattern); // an escape that is only legal without the u flag
    }
    regexCache.set(pattern, re);
  }
  return re;
}

function typeMatches(value, type) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'object': return isPlain(value);
    case 'array': return Array.isArray(value);
    case 'null': return value === null;
    default: return false;
  }
}

function resolveRef(root, ref, at) {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) throw new Error(`schema error at ${at}: only local "$ref" values are supported, got "${ref}"`);
  let node = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isPlain(node) && !Array.isArray(node)) node = undefined;
    else node = node[key];
    if (node === undefined) throw new Error(`schema error at ${at}: "$ref" ${ref} does not resolve`);
  }
  return node;
}

/** Throws a descriptive Error when the schema uses an unsupported keyword or a malformed one. */
export function assertSchema(schema, root = schema, at = '#') {
  if (typeof schema === 'boolean') return;
  if (!isPlain(schema)) throw new Error(`schema error at ${at}: a schema must be an object or a boolean`);
  const subs = (obj, where) => {
    if (!isPlain(obj)) throw new Error(`schema error at ${where}: expected an object of schemas`);
    for (const [k, s] of Object.entries(obj)) assertSchema(s, root, `${where}/${k}`);
  };
  const uint = (k) => {
    if (!Number.isInteger(schema[k]) || schema[k] < 0) throw new Error(`schema error at ${at}: "${k}" must be a non-negative integer`);
  };
  for (const [k, v] of Object.entries(schema)) {
    if (ANNOTATIONS.has(k)) continue;
    if (k === 'definitions' || k === '$defs') { subs(v, `${at}/${k}`); continue; }
    if (!ASSERTIONS.has(k)) throw new Error(`schema error at ${at}: unsupported keyword "${k}"`);
    switch (k) {
      case 'type':
        if (!(Array.isArray(v) ? v : [v]).every((t) => TYPES.has(t))) throw new Error(`schema error at ${at}: "type" must name JSON types, got ${JSON.stringify(v)}`);
        break;
      case 'properties': subs(v, `${at}/properties`); break;
      case 'required':
        if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error(`schema error at ${at}: "required" must be an array of strings`);
        break;
      case 'additionalProperties': if (typeof v !== 'boolean') assertSchema(v, root, `${at}/additionalProperties`); break;
      case 'enum':
        if (!Array.isArray(v) || v.length === 0) throw new Error(`schema error at ${at}: "enum" must be a non-empty array`);
        break;
      case 'items':
        if (Array.isArray(v)) throw new Error(`schema error at ${at}: tuple form of "items" is not supported`);
        assertSchema(v, root, `${at}/items`);
        break;
      case 'minItems': case 'maxItems': case 'minLength': case 'maxLength': uint(k); break;
      case 'minimum': case 'maximum':
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`schema error at ${at}: "${k}" must be a number`);
        break;
      case 'pattern':
        if (typeof v !== 'string') throw new Error(`schema error at ${at}: "pattern" must be a string`);
        regexFor(v); // throws on an invalid expression
        break;
      case 'anyOf': case 'oneOf': case 'allOf':
        if (!Array.isArray(v) || v.length === 0) throw new Error(`schema error at ${at}: "${k}" must be a non-empty array`);
        v.forEach((s, i) => assertSchema(s, root, `${at}/${k}/${i}`));
        break;
      case '$ref':
        if (typeof v !== 'string') throw new Error(`schema error at ${at}: "$ref" must be a string`);
        resolveRef(root, v, at);
        break;
      default: break;
    }
  }
}

function check(schema, value, path, errors, root) {
  if (schema === true) return;
  if (schema === false) { errors.push(`${path}: not allowed`); return; }
  if (schema.$ref !== undefined) check(resolveRef(root, schema.$ref, path), value, path, errors, root);

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) { errors.push(`${path}: expected ${types.join(' or ')}`); return; }
  }
  if (schema.enum !== undefined && !schema.enum.some((e) => isDeepStrictEqual(e, value))) errors.push(`${path}: expected one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if ('const' in schema && !isDeepStrictEqual(schema.const, value)) errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && codePoints(value) < schema.minLength) errors.push(`${path}: must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && codePoints(value) > schema.maxLength) errors.push(`${path}: must be at most ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !regexFor(schema.pattern).test(value)) errors.push(`${path}: must match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: must have at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: must have at most ${schema.maxItems} items`);
    if (schema.items !== undefined) value.forEach((v, i) => check(schema.items, v, `${path}[${i}]`, errors, root));
  }
  if (isPlain(value)) {
    const props = schema.properties ?? {};
    for (const k of schema.required ?? []) if (!present(value, k)) errors.push(`${keyPath(path, k)}: missing required property`);
    for (const [k, sub] of Object.entries(props)) if (present(value, k)) check(sub, value[k], keyPath(path, k), errors, root);
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
      for (const k of Object.keys(value)) {
        if (Object.hasOwn(props, k) || value[k] === undefined) continue;
        if (schema.additionalProperties === false) errors.push(`${keyPath(path, k)}: unexpected property`);
        else check(schema.additionalProperties, value[k], keyPath(path, k), errors, root);
      }
    }
  }

  if (schema.allOf) for (const s of schema.allOf) check(s, value, path, errors, root);
  if (schema.anyOf || schema.oneOf) {
    for (const kind of ['anyOf', 'oneOf']) {
      const branches = schema[kind];
      if (!branches) continue;
      const results = branches.map((s) => {
        const errs = [];
        check(s, value, path, errs, root);
        return errs;
      });
      const matched = results.filter((e) => e.length === 0).length;
      const detail = results.slice(0, 3).map((e, i) => `#${i + 1}: ${e[0] ?? 'ok'}`).join('; ');
      if (matched === 0) errors.push(`${path}: does not match any of the ${branches.length} allowed schemas (${detail})`);
      else if (kind === 'oneOf' && matched > 1) errors.push(`${path}: matches ${matched} of the ${branches.length} allowed schemas, expected exactly one`);
    }
  }
}

const checked = new WeakSet();

/** Validate a value against a schema: { ok, errors } with messages such as "$.tags[0].p: expected number". */
export function validate(schema, value, path = '$') {
  if (!checked.has(schema)) {
    assertSchema(schema);
    if (typeof schema === 'object') checked.add(schema);
  }
  const errors = [];
  check(schema, value, path, errors, schema);
  if (errors.length > MAX_ERRORS) {
    const more = errors.length - MAX_ERRORS;
    errors.length = MAX_ERRORS;
    errors.push(`${path}: ... and ${more} more errors`);
  }
  return { ok: errors.length === 0, errors };
}
