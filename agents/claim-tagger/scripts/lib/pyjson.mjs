// Byte-exact port of Python 3 json.dumps(value, sort_keys=..., ensure_ascii=...) with the default separators
// (", " between items, ": " between a key and its value). The rubric, tag, rule and scope hashes were produced
// by Python (research/scripts/build-skeleton-data.py), so they are only reproducible with these exact bytes.
//
// What JavaScript cannot express, and what this does about it:
//  - A JS number has no int/float split. Integer-valued numbers are written as Python ints ("3", never "3.0");
//    other numbers use Python's float repr ("0.1", "1e-05", "2.5e-05"). Keep floats out of hashed structures.
//  - Without sortKeys the key order is JS property order, which puts integer-like keys ("1", "2") first.
//    Every hash recipe here uses sortKeys, so this never matters for hashing.
//  - undefined, functions, symbols, Date, Map, Set and class instances throw, as Python would for an unknown
//    type; JSON.stringify would silently drop or reshape them, which would make a hash irreproducible.

const HEX = '0123456789abcdef';
const SHORT = { 0x22: '\\"', 0x5c: '\\\\', 0x0a: '\\n', 0x0d: '\\r', 0x09: '\\t', 0x08: '\\b', 0x0c: '\\f' };

function u4(c) {
  return '\\u' + HEX[(c >> 12) & 15] + HEX[(c >> 8) & 15] + HEX[(c >> 4) & 15] + HEX[c & 15];
}

// Python escapes: quote, backslash, \b \f \n \r \t, other control characters as \u00xx (lowercase hex).
// With ensure_ascii it also escapes everything outside space..~ (so DEL is \u007f) and writes astral
// characters as two \uXXXX surrogates, which is exactly what iterating UTF-16 code units gives.
function quote(s, ensureAscii) {
  let out = '"';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep;
    if (c === 0x22 || c === 0x5c || c < 0x20) rep = SHORT[c] ?? u4(c);
    else if (ensureAscii && c > 0x7e) rep = u4(c);
    else continue;
    out += s.slice(start, i) + rep;
    start = i + 1;
  }
  return out + s.slice(start) + '"';
}

/** Python's str ordering: by Unicode code point (JS default sort compares UTF-16 code units, which differs for astral characters). */
export function compareCodePoints(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i);
    const cb = b.codePointAt(j);
    if (ca !== cb) return ca < cb ? -1 : 1;
    const w = ca > 0xffff ? 2 : 1;
    i += w;
    j += w;
  }
  return Math.sign((a.length - i) - (b.length - j));
}

function pyNumber(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (Number.isInteger(x)) return Math.abs(x) < 1e21 ? String(x) : BigInt(x).toString(); // -0 prints as 0
  // Shortest round-trip digits (the same ones Python's repr picks), laid out the way float.__repr__ does:
  // exponent form when the decimal exponent is below -4 or above 16, with a sign and at least two exponent digits.
  // (A non-integer double is below 2^52, so in practice only the small side occurs here; large values were written as ints above.)
  const [mantissa, exp] = x.toExponential().split('e');
  const digits = mantissa.replace('-', '').replace('.', '');
  const decpt = Number(exp) + 1; // x = 0.DIGITS * 10^decpt
  let body;
  if (decpt <= -4 || decpt > 16) {
    const e = decpt - 1;
    body = digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') + 'e' + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
  } else if (decpt <= 0) {
    body = '0.' + '0'.repeat(-decpt) + digits;
  } else {
    body = digits.slice(0, decpt) + '.' + digits.slice(decpt); // a non-integer always has digits after the point
  }
  return (x < 0 ? '-' : '') + body;
}

/**
 * json.dumps(value, sort_keys=sortKeys, ensure_ascii=ensureAscii) with Python's default separators.
 * ensureAscii defaults to true like Python; the rubric/tag/scope hash recipes pass false (the research script did).
 */
export function pyJson(value, { sortKeys = false, ensureAscii = true } = {}) {
  const ancestors = new Set();
  const trail = [];
  const where = () => '$' + trail.map((k) => (typeof k === 'number' ? `[${k}]` : `[${JSON.stringify(k)}]`)).join('');

  const enc = (v) => {
    if (v === null) return 'null';
    switch (typeof v) {
      case 'string': return quote(v, ensureAscii);
      case 'boolean': return v ? 'true' : 'false';
      case 'number': return pyNumber(v);
      case 'bigint': return v.toString();
      case 'object': break;
      default: throw new TypeError(`pyJson: ${typeof v} is not JSON serializable at ${where()}`);
    }
    if (ancestors.has(v)) throw new TypeError(`pyJson: circular reference at ${where()}`);
    ancestors.add(v);
    const parts = [];
    let open;
    let close;
    if (Array.isArray(v)) {
      open = '[';
      close = ']';
      for (let i = 0; i < v.length; i++) {
        trail.push(i);
        parts.push(enc(v[i]));
        trail.pop();
      }
    } else {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`pyJson: ${proto?.constructor?.name ?? 'object'} is not JSON serializable at ${where()}`);
      }
      open = '{';
      close = '}';
      const keys = sortKeys ? Object.keys(v).sort(compareCodePoints) : Object.keys(v);
      for (const k of keys) {
        trail.push(k);
        parts.push(quote(k, ensureAscii) + ': ' + enc(v[k]));
        trail.pop();
      }
    }
    ancestors.delete(v);
    return open + parts.join(', ') + close;
  };

  return enc(value);
}
