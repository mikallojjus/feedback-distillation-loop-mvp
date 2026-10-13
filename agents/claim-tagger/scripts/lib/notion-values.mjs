// Notion REST page objects <-> plain values.
//
//   decodePage(page, schema)            -> { page_id, url, created_time, last_edited_time, props: { [name]: plain } }
//   encodeProperties(plainProps, schema) -> the REST `properties` object for a create or update
//   sameValue(type, a, b)               -> equality the way verify and `expect` compare (text normalised, id sets, numbers with tolerance)
//
// Plain values: title and rich_text are strings (all plain_text pieces joined, '\n' kept); select and status the option name or
// null; multi_select names[]; number a number or null; checkbox a boolean; url/email/phone a string or null; date the start
// string (or null) with `${name}:end` added when an end exists; people user ids[]; relation page ids[]; formula its value;
// rollup an array of plain values (items decoded by their own type) or a number or a date start; created_time and
// last_edited_time strings; created_by and last_edited_by user ids; unique_id "PREFIX-n"; files names[].

import { normaliseText } from './rubric-build.mjs';
import { splitRichText } from './notion-rest.mjs';

export { normaliseText, splitRichText };

const UNSUPPORTED = Symbol('unsupported');

/** Property types a script may write. Everything else (formula, rollup, created_time, unique_id, ...) is computed by Notion. */
export const WRITABLE_TYPES = Object.freeze(['title', 'rich_text', 'select', 'status', 'multi_select', 'number', 'checkbox', 'url', 'email', 'phone_number', 'date', 'relation', 'people']);

/** Lower-case a Notion id and drop the dashes, so 8-4-4-4-12 and 32-hex forms compare equal. */
export function normId(id) {
  return String(id ?? '').replace(/-/g, '').toLowerCase();
}

const ID_LIKE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
export const looksLikeId = (s) => typeof s === 'string' && ID_LIKE.test(s);

// ---- decode ------------------------------------------------------------------------------------------------------

const joinText = (parts) => (Array.isArray(parts) ? parts.map((p) => p?.plain_text ?? p?.text?.content ?? '').join('') : '');

function decodeFormula(f) {
  if (!f) return null;
  switch (f.type) {
    case 'string': return f.string ?? null;
    case 'number': return typeof f.number === 'number' ? f.number : null;
    case 'boolean': return typeof f.boolean === 'boolean' ? f.boolean : null;
    case 'date': return f.date?.start ?? null;
    default: return null;
  }
}

function decodeRollup(r) {
  if (!r) return null;
  if (r.type === 'array') return (r.array ?? []).map((item) => {
    const v = decodeTyped(item, item?.type);
    return v === UNSUPPORTED ? null : v;
  });
  if (r.type === 'number') return typeof r.number === 'number' ? r.number : null;
  if (r.type === 'date') return r.date?.start ?? null;
  return null; // incomplete or unsupported
}

function decodeTyped(v, type) {
  switch (type) {
    case 'title': return joinText(v.title);
    case 'rich_text': return joinText(v.rich_text);
    case 'select': return v.select?.name ?? null;
    case 'status': return v.status?.name ?? null;
    case 'multi_select': return (v.multi_select ?? []).map((o) => o.name);
    case 'number': return typeof v.number === 'number' ? v.number : null;
    case 'checkbox': return v.checkbox === true;
    case 'url': case 'email': case 'phone_number': return v[type] ?? null;
    case 'date': return v.date?.start ?? null;
    case 'people': return (v.people ?? []).map((p) => p.id);
    case 'relation': return (v.relation ?? []).map((r) => r.id);
    case 'formula': return decodeFormula(v.formula);
    case 'rollup': return decodeRollup(v.rollup);
    case 'created_time': case 'last_edited_time': return v[type] ?? null;
    case 'created_by': case 'last_edited_by': return v[type]?.id ?? null;
    case 'unique_id': return v.unique_id ? `${v.unique_id.prefix ? `${v.unique_id.prefix}-` : ''}${v.unique_id.number}` : null;
    case 'files': return (v.files ?? []).map((f) => f.name);
    default: return UNSUPPORTED;
  }
}

/**
 * One REST page object to plain values. `schema` is the database object (or just { properties }) and is used for the type of a
 * value that carries none and to catch a page whose property type differs from the schema's. A property of a type this
 * layer does not know (button, verification, ...) is left out. relation_has_more lists the relations Notion cut at 25 references.
 */
export function decodePage(page, schema = null) {
  if (!page || typeof page !== 'object' || page.properties === null || typeof page.properties !== 'object') throw new Error('decodePage: not a Notion page object');
  const props = {};
  const hasMore = [];
  for (const [name, value] of Object.entries(page.properties)) {
    const declared = schema?.properties?.[name]?.type;
    const type = value?.type ?? declared;
    if (!type) throw new Error(`decodePage: property "${name}" has no type`);
    if (declared && value?.type && declared !== value.type) throw new Error(`decodePage: property "${name}" is ${value.type} on the page but ${declared} in the schema`);
    if (type === 'date') {
      props[name] = value.date?.start ?? null;
      if (value.date?.end) props[`${name}:end`] = value.date.end;
      continue;
    }
    const plain = decodeTyped(value, type);
    if (plain === UNSUPPORTED) continue;
    props[name] = plain;
    if (type === 'relation' && value.has_more === true) hasMore.push(name);
  }
  const out = { page_id: page.id, url: page.url ?? null, created_time: page.created_time ?? null, last_edited_time: page.last_edited_time ?? null, props };
  if (hasMore.length) out.relation_has_more = hasMore;
  return out;
}

// ---- encode ------------------------------------------------------------------------------------------------------

function fail(name, type, what) {
  throw new TypeError(`encodeProperties: "${name}" (${type}) ${what}`);
}

const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

function encodeValue(type, value, name, plain) {
  switch (type) {
    case 'title':
    case 'rich_text': {
      if (value !== null && typeof value !== 'string') fail(name, type, `needs a string or null, got ${typeof value}`);
      return { [type]: splitRichText(value ?? '') };
    }
    case 'select':
    case 'status': {
      if (value !== null && typeof value !== 'string') fail(name, type, 'needs an option name or null');
      return { [type]: value === null || value === '' ? null : { name: value } };
    }
    case 'multi_select': {
      if (!isStringArray(value)) fail(name, type, 'needs an array of option names');
      return { multi_select: value.map((n) => ({ name: n })) };
    }
    case 'number': {
      if (value !== null && !(typeof value === 'number' && Number.isFinite(value))) fail(name, type, 'needs a finite number or null');
      return { number: value };
    }
    case 'checkbox': {
      if (typeof value !== 'boolean') fail(name, type, 'needs true or false');
      return { checkbox: value };
    }
    case 'url':
    case 'email':
    case 'phone_number': {
      if (value !== null && typeof value !== 'string') fail(name, type, 'needs a string or null');
      return { [type]: value === '' ? null : value };
    }
    case 'date': {
      if (value !== null && typeof value !== 'string') fail(name, type, 'needs an ISO date string or null');
      if (value === null || value === '') return { date: null };
      const end = plain[`${name}:end`];
      return { date: end ? { start: value, end } : { start: value } };
    }
    case 'relation': {
      if (!isStringArray(value)) fail(name, type, 'needs an array of page ids');
      return { relation: value.map((id) => ({ id })) };
    }
    case 'people': {
      if (!isStringArray(value)) fail(name, type, 'needs an array of user ids');
      return { people: value.map((id) => ({ id })) };
    }
    default:
      return fail(name, type, 'is not a writable property type');
  }
}

/** Plain values to the REST `properties` object. Unknown property names and non-writable types throw. `${name}:end` goes with its date. */
export function encodeProperties(plainProps, schema) {
  const defs = schema?.properties;
  if (!defs || typeof defs !== 'object') throw new Error('encodeProperties: the schema has no properties');
  const out = {};
  for (const [name, value] of Object.entries(plainProps ?? {})) {
    if (value === undefined) continue;
    const def = defs[name];
    if (!def) {
      const base = name.endsWith(':end') ? name.slice(0, -4) : null;
      if (base && defs[base]?.type === 'date' && Object.hasOwn(plainProps, base)) continue; // consumed with its date
      throw new Error(`encodeProperties: unknown property "${name}"`);
    }
    out[name] = encodeValue(def.type, value, name, plainProps);
  }
  return out;
}

// ---- comparing ---------------------------------------------------------------------------------------------------

const EMPTY = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Two ISO dates are the same when both are days and equal, or both are instants within the same second. */
export function sameDate(a, b) {
  if (EMPTY(a) || EMPTY(b)) return EMPTY(a) && EMPTY(b);
  if (DAY.test(a) && DAY.test(b)) return a === b;
  const x = Date.parse(DAY.test(a) ? `${a}T00:00:00Z` : a);
  const y = Date.parse(DAY.test(b) ? `${b}T00:00:00Z` : b);
  if (Number.isNaN(x) || Number.isNaN(y)) return a === b;
  return Math.floor(x / 1000) === Math.floor(y / 1000);
}

const idSet = (v) => [...new Set((Array.isArray(v) ? v : [v]).filter((x) => !EMPTY(x)).map((x) => (looksLikeId(x) ? normId(x) : String(x))))].sort();

/**
 * Equality of a planned value and a pulled one for a property of `type` (null type: guess from the values).
 * Text: normalised (CRLF, <br>, markdown escapes); empty equals null. Relations, people, multi_select and rollup arrays: as sets.
 * Numbers: within 1e-9. Dates: by start. Select and checkbox: exact.
 */
export function sameValue(type, a, b) {
  switch (type) {
    case 'title': case 'rich_text': return normaliseText(a ?? '') === normaliseText(b ?? '');
    case 'url': case 'email': case 'phone_number': return (a || null) === (b || null);
    case 'select': case 'status': return (a || null) === (b || null);
    case 'number': {
      const x = a ?? null;
      const y = b ?? null;
      return x === null || y === null ? x === y : Math.abs(x - y) <= 1e-9;
    }
    case 'checkbox': return Boolean(a) === Boolean(b);
    case 'date': return sameDate(a, b);
    case 'relation': case 'people': case 'multi_select': case 'rollup': return JSON.stringify(idSet(a)) === JSON.stringify(idSet(b));
    case 'formula': case 'unique_id': case 'created_time': case 'last_edited_time': return a === b;
    default: break;
  }
  if (EMPTY(a) || EMPTY(b)) return EMPTY(a) && EMPTY(b);
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9;
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(idSet(a)) === JSON.stringify(idSet(b));
  if (typeof a === 'string' && typeof b === 'string') return looksLikeId(a) && looksLikeId(b) ? normId(a) === normId(b) : normaliseText(a) === normaliseText(b);
  return a === b;
}
