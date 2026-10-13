import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pyJson, compareCodePoints } from '../agents/claim-tagger/scripts/lib/pyjson.mjs';

// Every `want` below was produced by Python 3.13: json.dumps(json.loads(input), sort_keys=sortKeys, ensure_ascii=ensureAscii)
// with the default separators. `input` is JSON text (parsed with JSON.parse) so that this file stays ASCII.
// Only non-integer floats appear in the float group: a JS number cannot tell 1.0 from 1, see the int test below.
const VECTORS = [
  {"group": "scalars and big integers", "input": "null", "sortKeys": false, "ensureAscii": true, "want": "null"},
  {"group": "scalars and big integers", "input": "null", "sortKeys": false, "ensureAscii": false, "want": "null"},
  {"group": "scalars and big integers", "input": "null", "sortKeys": true, "ensureAscii": true, "want": "null"},
  {"group": "scalars and big integers", "input": "null", "sortKeys": true, "ensureAscii": false, "want": "null"},
  {"group": "scalars and big integers", "input": "true", "sortKeys": false, "ensureAscii": true, "want": "true"},
  {"group": "scalars and big integers", "input": "true", "sortKeys": false, "ensureAscii": false, "want": "true"},
  {"group": "scalars and big integers", "input": "true", "sortKeys": true, "ensureAscii": true, "want": "true"},
  {"group": "scalars and big integers", "input": "true", "sortKeys": true, "ensureAscii": false, "want": "true"},
  {"group": "scalars and big integers", "input": "false", "sortKeys": false, "ensureAscii": true, "want": "false"},
  {"group": "scalars and big integers", "input": "false", "sortKeys": false, "ensureAscii": false, "want": "false"},
  {"group": "scalars and big integers", "input": "false", "sortKeys": true, "ensureAscii": true, "want": "false"},
  {"group": "scalars and big integers", "input": "false", "sortKeys": true, "ensureAscii": false, "want": "false"},
  {"group": "scalars and big integers", "input": "0", "sortKeys": false, "ensureAscii": true, "want": "0"},
  {"group": "scalars and big integers", "input": "0", "sortKeys": false, "ensureAscii": false, "want": "0"},
  {"group": "scalars and big integers", "input": "0", "sortKeys": true, "ensureAscii": true, "want": "0"},
  {"group": "scalars and big integers", "input": "0", "sortKeys": true, "ensureAscii": false, "want": "0"},
  {"group": "scalars and big integers", "input": "-17", "sortKeys": false, "ensureAscii": true, "want": "-17"},
  {"group": "scalars and big integers", "input": "-17", "sortKeys": false, "ensureAscii": false, "want": "-17"},
  {"group": "scalars and big integers", "input": "-17", "sortKeys": true, "ensureAscii": true, "want": "-17"},
  {"group": "scalars and big integers", "input": "-17", "sortKeys": true, "ensureAscii": false, "want": "-17"},
  {"group": "scalars and big integers", "input": "1234567890", "sortKeys": false, "ensureAscii": true, "want": "1234567890"},
  {"group": "scalars and big integers", "input": "1234567890", "sortKeys": false, "ensureAscii": false, "want": "1234567890"},
  {"group": "scalars and big integers", "input": "1234567890", "sortKeys": true, "ensureAscii": true, "want": "1234567890"},
  {"group": "scalars and big integers", "input": "1234567890", "sortKeys": true, "ensureAscii": false, "want": "1234567890"},
  {"group": "scalars and big integers", "input": "9007199254740991", "sortKeys": false, "ensureAscii": true, "want": "9007199254740991"},
  {"group": "scalars and big integers", "input": "9007199254740991", "sortKeys": false, "ensureAscii": false, "want": "9007199254740991"},
  {"group": "scalars and big integers", "input": "9007199254740991", "sortKeys": true, "ensureAscii": true, "want": "9007199254740991"},
  {"group": "scalars and big integers", "input": "9007199254740991", "sortKeys": true, "ensureAscii": false, "want": "9007199254740991"},
  {"group": "scalars and big integers", "input": "-9007199254740991", "sortKeys": false, "ensureAscii": true, "want": "-9007199254740991"},
  {"group": "scalars and big integers", "input": "-9007199254740991", "sortKeys": false, "ensureAscii": false, "want": "-9007199254740991"},
  {"group": "scalars and big integers", "input": "-9007199254740991", "sortKeys": true, "ensureAscii": true, "want": "-9007199254740991"},
  {"group": "scalars and big integers", "input": "-9007199254740991", "sortKeys": true, "ensureAscii": false, "want": "-9007199254740991"},
  {"group": "scalars and big integers", "input": "\"\"", "sortKeys": false, "ensureAscii": true, "want": "\"\""},
  {"group": "scalars and big integers", "input": "\"\"", "sortKeys": false, "ensureAscii": false, "want": "\"\""},
  {"group": "scalars and big integers", "input": "\"\"", "sortKeys": true, "ensureAscii": true, "want": "\"\""},
  {"group": "scalars and big integers", "input": "\"\"", "sortKeys": true, "ensureAscii": false, "want": "\"\""},
  {"group": "scalars and big integers", "input": "\"plain\"", "sortKeys": false, "ensureAscii": true, "want": "\"plain\""},
  {"group": "scalars and big integers", "input": "\"plain\"", "sortKeys": false, "ensureAscii": false, "want": "\"plain\""},
  {"group": "scalars and big integers", "input": "\"plain\"", "sortKeys": true, "ensureAscii": true, "want": "\"plain\""},
  {"group": "scalars and big integers", "input": "\"plain\"", "sortKeys": true, "ensureAscii": false, "want": "\"plain\""},
  {"group": "scalars and big integers", "input": "1000000000000000000000", "sortKeys": false, "ensureAscii": true, "want": "1000000000000000000000"},
  {"group": "scalars and big integers", "input": "1000000000000000000000", "sortKeys": false, "ensureAscii": false, "want": "1000000000000000000000"},
  {"group": "scalars and big integers", "input": "1000000000000000000000", "sortKeys": true, "ensureAscii": true, "want": "1000000000000000000000"},
  {"group": "scalars and big integers", "input": "1000000000000000000000", "sortKeys": true, "ensureAscii": false, "want": "1000000000000000000000"},
  {"group": "scalars and big integers", "input": "10000000000000000000000", "sortKeys": false, "ensureAscii": true, "want": "10000000000000000000000"},
  {"group": "scalars and big integers", "input": "10000000000000000000000", "sortKeys": false, "ensureAscii": false, "want": "10000000000000000000000"},
  {"group": "scalars and big integers", "input": "10000000000000000000000", "sortKeys": true, "ensureAscii": true, "want": "10000000000000000000000"},
  {"group": "scalars and big integers", "input": "10000000000000000000000", "sortKeys": true, "ensureAscii": false, "want": "10000000000000000000000"},
  {"group": "scalars and big integers", "input": "9007199254740992", "sortKeys": false, "ensureAscii": true, "want": "9007199254740992"},
  {"group": "scalars and big integers", "input": "9007199254740992", "sortKeys": false, "ensureAscii": false, "want": "9007199254740992"},
  {"group": "scalars and big integers", "input": "9007199254740992", "sortKeys": true, "ensureAscii": true, "want": "9007199254740992"},
  {"group": "scalars and big integers", "input": "9007199254740992", "sortKeys": true, "ensureAscii": false, "want": "9007199254740992"},
  {"group": "scalars and big integers", "input": "-9007199254740992", "sortKeys": false, "ensureAscii": true, "want": "-9007199254740992"},
  {"group": "scalars and big integers", "input": "-9007199254740992", "sortKeys": false, "ensureAscii": false, "want": "-9007199254740992"},
  {"group": "scalars and big integers", "input": "-9007199254740992", "sortKeys": true, "ensureAscii": true, "want": "-9007199254740992"},
  {"group": "scalars and big integers", "input": "-9007199254740992", "sortKeys": true, "ensureAscii": false, "want": "-9007199254740992"},
  {"group": "containers", "input": "[]", "sortKeys": false, "ensureAscii": true, "want": "[]"},
  {"group": "containers", "input": "[]", "sortKeys": false, "ensureAscii": false, "want": "[]"},
  {"group": "containers", "input": "[]", "sortKeys": true, "ensureAscii": true, "want": "[]"},
  {"group": "containers", "input": "[]", "sortKeys": true, "ensureAscii": false, "want": "[]"},
  {"group": "containers", "input": "{}", "sortKeys": false, "ensureAscii": true, "want": "{}"},
  {"group": "containers", "input": "{}", "sortKeys": false, "ensureAscii": false, "want": "{}"},
  {"group": "containers", "input": "{}", "sortKeys": true, "ensureAscii": true, "want": "{}"},
  {"group": "containers", "input": "{}", "sortKeys": true, "ensureAscii": false, "want": "{}"},
  {"group": "containers", "input": "[1, 2, 3]", "sortKeys": false, "ensureAscii": true, "want": "[1, 2, 3]"},
  {"group": "containers", "input": "[1, 2, 3]", "sortKeys": false, "ensureAscii": false, "want": "[1, 2, 3]"},
  {"group": "containers", "input": "[1, 2, 3]", "sortKeys": true, "ensureAscii": true, "want": "[1, 2, 3]"},
  {"group": "containers", "input": "[1, 2, 3]", "sortKeys": true, "ensureAscii": false, "want": "[1, 2, 3]"},
  {"group": "containers", "input": "{\"b\": 1, \"a\": 2}", "sortKeys": false, "ensureAscii": true, "want": "{\"b\": 1, \"a\": 2}"},
  {"group": "containers", "input": "{\"b\": 1, \"a\": 2}", "sortKeys": false, "ensureAscii": false, "want": "{\"b\": 1, \"a\": 2}"},
  {"group": "containers", "input": "{\"b\": 1, \"a\": 2}", "sortKeys": true, "ensureAscii": true, "want": "{\"a\": 2, \"b\": 1}"},
  {"group": "containers", "input": "{\"b\": 1, \"a\": 2}", "sortKeys": true, "ensureAscii": false, "want": "{\"a\": 2, \"b\": 1}"},
  {"group": "containers", "input": "[[], {}, [[]], {\"a\": []}]", "sortKeys": false, "ensureAscii": true, "want": "[[], {}, [[]], {\"a\": []}]"},
  {"group": "containers", "input": "[[], {}, [[]], {\"a\": []}]", "sortKeys": false, "ensureAscii": false, "want": "[[], {}, [[]], {\"a\": []}]"},
  {"group": "containers", "input": "[[], {}, [[]], {\"a\": []}]", "sortKeys": true, "ensureAscii": true, "want": "[[], {}, [[]], {\"a\": []}]"},
  {"group": "containers", "input": "[[], {}, [[]], {\"a\": []}]", "sortKeys": true, "ensureAscii": false, "want": "[[], {}, [[]], {\"a\": []}]"},
  {"group": "containers", "input": "{\"x\": {\"y\": {\"z\": [1, {\"w\": null}]}}}", "sortKeys": false, "ensureAscii": true, "want": "{\"x\": {\"y\": {\"z\": [1, {\"w\": null}]}}}"},
  {"group": "containers", "input": "{\"x\": {\"y\": {\"z\": [1, {\"w\": null}]}}}", "sortKeys": false, "ensureAscii": false, "want": "{\"x\": {\"y\": {\"z\": [1, {\"w\": null}]}}}"},
  {"group": "containers", "input": "{\"x\": {\"y\": {\"z\": [1, {\"w\": null}]}}}", "sortKeys": true, "ensureAscii": true, "want": "{\"x\": {\"y\": {\"z\": [1, {\"w\": null}]}}}"},
  {"group": "containers", "input": "{\"x\": {\"y\": {\"z\": [1, {\"w\": null}]}}}", "sortKeys": true, "ensureAscii": false, "want": "{\"x\": {\"y\": {\"z\": [1, {\"w\": null}]}}}"},
  {"group": "containers", "input": "[null, true, false]", "sortKeys": false, "ensureAscii": true, "want": "[null, true, false]"},
  {"group": "containers", "input": "[null, true, false]", "sortKeys": false, "ensureAscii": false, "want": "[null, true, false]"},
  {"group": "containers", "input": "[null, true, false]", "sortKeys": true, "ensureAscii": true, "want": "[null, true, false]"},
  {"group": "containers", "input": "[null, true, false]", "sortKeys": true, "ensureAscii": false, "want": "[null, true, false]"},
  {"group": "containers", "input": "{\"b\": [1, {\"d\": 4, \"c\": 3}], \"a\": {\"z\": 0, \"y\": 1}}", "sortKeys": false, "ensureAscii": true, "want": "{\"b\": [1, {\"d\": 4, \"c\": 3}], \"a\": {\"z\": 0, \"y\": 1}}"},
  {"group": "containers", "input": "{\"b\": [1, {\"d\": 4, \"c\": 3}], \"a\": {\"z\": 0, \"y\": 1}}", "sortKeys": false, "ensureAscii": false, "want": "{\"b\": [1, {\"d\": 4, \"c\": 3}], \"a\": {\"z\": 0, \"y\": 1}}"},
  {"group": "containers", "input": "{\"b\": [1, {\"d\": 4, \"c\": 3}], \"a\": {\"z\": 0, \"y\": 1}}", "sortKeys": true, "ensureAscii": true, "want": "{\"a\": {\"y\": 1, \"z\": 0}, \"b\": [1, {\"c\": 3, \"d\": 4}]}"},
  {"group": "containers", "input": "{\"b\": [1, {\"d\": 4, \"c\": 3}], \"a\": {\"z\": 0, \"y\": 1}}", "sortKeys": true, "ensureAscii": false, "want": "{\"a\": {\"y\": 1, \"z\": 0}, \"b\": [1, {\"c\": 3, \"d\": 4}]}"},
  {"group": "containers", "input": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"B\": 4, \"_\": 5, \"A\": 6}", "sortKeys": false, "ensureAscii": true, "want": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"B\": 4, \"_\": 5, \"A\": 6}"},
  {"group": "containers", "input": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"B\": 4, \"_\": 5, \"A\": 6}", "sortKeys": false, "ensureAscii": false, "want": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"B\": 4, \"_\": 5, \"A\": 6}"},
  {"group": "containers", "input": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"B\": 4, \"_\": 5, \"A\": 6}", "sortKeys": true, "ensureAscii": true, "want": "{\"\": 0, \"A\": 6, \"B\": 4, \"_\": 5, \"a\": 1, \"aa\": 2, \"ab\": 3}"},
  {"group": "containers", "input": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"B\": 4, \"_\": 5, \"A\": 6}", "sortKeys": true, "ensureAscii": false, "want": "{\"\": 0, \"A\": 6, \"B\": 4, \"_\": 5, \"a\": 1, \"aa\": 2, \"ab\": 3}"},
  {"group": "floats (non-integer)", "input": "0.5", "sortKeys": false, "ensureAscii": true, "want": "0.5"},
  {"group": "floats (non-integer)", "input": "-2.75", "sortKeys": false, "ensureAscii": true, "want": "-2.75"},
  {"group": "floats (non-integer)", "input": "0.1", "sortKeys": false, "ensureAscii": true, "want": "0.1"},
  {"group": "floats (non-integer)", "input": "0.30000000000000004", "sortKeys": false, "ensureAscii": true, "want": "0.30000000000000004"},
  {"group": "floats (non-integer)", "input": "1e-07", "sortKeys": false, "ensureAscii": true, "want": "1e-07"},
  {"group": "floats (non-integer)", "input": "1.5e-10", "sortKeys": false, "ensureAscii": true, "want": "1.5e-10"},
  {"group": "floats (non-integer)", "input": "0.0001", "sortKeys": false, "ensureAscii": true, "want": "0.0001"},
  {"group": "floats (non-integer)", "input": "1e-05", "sortKeys": false, "ensureAscii": true, "want": "1e-05"},
  {"group": "floats (non-integer)", "input": "2.5e-05", "sortKeys": false, "ensureAscii": true, "want": "2.5e-05"},
  {"group": "floats (non-integer)", "input": "123456.789", "sortKeys": false, "ensureAscii": true, "want": "123456.789"},
  {"group": "floats (non-integer)", "input": "1234567890123.456", "sortKeys": false, "ensureAscii": true, "want": "1234567890123.456"},
  {"group": "floats (non-integer)", "input": "5e-324", "sortKeys": false, "ensureAscii": true, "want": "5e-324"},
  {"group": "floats (non-integer)", "input": "1e-320", "sortKeys": false, "ensureAscii": true, "want": "1e-320"},
  {"group": "floats (non-integer)", "input": "0.000123", "sortKeys": false, "ensureAscii": true, "want": "0.000123"},
  {"group": "floats (non-integer)", "input": "4503599627370495.5", "sortKeys": false, "ensureAscii": true, "want": "4503599627370495.5"},
  {"group": "floats (non-integer)", "input": "123456789012345.67", "sortKeys": false, "ensureAscii": true, "want": "123456789012345.67"},
  {"group": "floats (non-integer)", "input": "0.3333333333333333", "sortKeys": false, "ensureAscii": true, "want": "0.3333333333333333"},
  {"group": "floats (non-integer)", "input": "0.6666666666666666", "sortKeys": false, "ensureAscii": true, "want": "0.6666666666666666"},
  {"group": "floats (non-integer)", "input": "9.999999999999999e-05", "sortKeys": false, "ensureAscii": true, "want": "9.999999999999999e-05"},
  {"group": "floats (non-integer)", "input": "-1.234e-05", "sortKeys": false, "ensureAscii": true, "want": "-1.234e-05"},
  {"group": "floats (non-integer)", "input": "100.25", "sortKeys": false, "ensureAscii": true, "want": "100.25"},
  {"group": "floats (non-integer)", "input": "2.2250738585072014e-308", "sortKeys": false, "ensureAscii": true, "want": "2.2250738585072014e-308"},
  {"group": "floats (non-integer)", "input": "0.001", "sortKeys": false, "ensureAscii": true, "want": "0.001"},
  {"group": "floats (non-integer)", "input": "0.01", "sortKeys": false, "ensureAscii": true, "want": "0.01"},
  {"group": "floats (non-integer)", "input": "1000000000000000.5", "sortKeys": false, "ensureAscii": true, "want": "1000000000000000.5"},
  {"group": "floats (non-integer)", "input": "3.14159", "sortKeys": false, "ensureAscii": true, "want": "3.14159"},
  {"group": "floats (non-integer)", "input": "2.718281828459045", "sortKeys": false, "ensureAscii": true, "want": "2.718281828459045"},
  {"group": "floats (non-integer)", "input": "1.7976931348623157e-300", "sortKeys": false, "ensureAscii": true, "want": "1.7976931348623157e-300"},
  {"group": "floats (non-integer)", "input": "-0.5", "sortKeys": false, "ensureAscii": true, "want": "-0.5"},
  {"group": "floats (non-integer)", "input": "[0.5, -2.75, 0.1, 0.30000000000000004, 1e-07, 1.5e-10, 0.0001, 1e-05, 2.5e-05, 123456.789, 1234567890123.456, 5e-324, 1e-320, 0.000123, 4503599627370495.5, 123456789012345.67, 0.3333333333333333, 0.6666666666666666, 9.999999999999999e-05, -1.234e-05, 100.25, 2.2250738585072014e-308, 0.001, 0.01, 1000000000000000.5, 3.14159, 2.718281828459045, 1.7976931348623157e-300, -0.5]", "sortKeys": false, "ensureAscii": true, "want": "[0.5, -2.75, 0.1, 0.30000000000000004, 1e-07, 1.5e-10, 0.0001, 1e-05, 2.5e-05, 123456.789, 1234567890123.456, 5e-324, 1e-320, 0.000123, 4503599627370495.5, 123456789012345.67, 0.3333333333333333, 0.6666666666666666, 9.999999999999999e-05, -1.234e-05, 100.25, 2.2250738585072014e-308, 0.001, 0.01, 1000000000000000.5, 3.14159, 2.718281828459045, 1.7976931348623157e-300, -0.5]"},
  {"group": "floats (non-integer)", "input": "{\"p\": 0.75, \"lo\": 0.49015684672072335, \"hi\": 0.9433190520193067}", "sortKeys": true, "ensureAscii": true, "want": "{\"hi\": 0.9433190520193067, \"lo\": 0.49015684672072335, \"p\": 0.75}"},
  {"group": "string escapes", "input": "\"say \\\"hi\\\"\"", "sortKeys": false, "ensureAscii": true, "want": "\"say \\\"hi\\\"\""},
  {"group": "string escapes", "input": "\"say \\\"hi\\\"\"", "sortKeys": false, "ensureAscii": false, "want": "\"say \\\"hi\\\"\""},
  {"group": "string escapes", "input": "\"say \\\"hi\\\"\"", "sortKeys": true, "ensureAscii": true, "want": "\"say \\\"hi\\\"\""},
  {"group": "string escapes", "input": "\"say \\\"hi\\\"\"", "sortKeys": true, "ensureAscii": false, "want": "\"say \\\"hi\\\"\""},
  {"group": "string escapes", "input": "\"back\\\\slash\"", "sortKeys": false, "ensureAscii": true, "want": "\"back\\\\slash\""},
  {"group": "string escapes", "input": "\"back\\\\slash\"", "sortKeys": false, "ensureAscii": false, "want": "\"back\\\\slash\""},
  {"group": "string escapes", "input": "\"back\\\\slash\"", "sortKeys": true, "ensureAscii": true, "want": "\"back\\\\slash\""},
  {"group": "string escapes", "input": "\"back\\\\slash\"", "sortKeys": true, "ensureAscii": false, "want": "\"back\\\\slash\""},
  {"group": "string escapes", "input": "\"line\\nbreak\\r\\n\\ttab\"", "sortKeys": false, "ensureAscii": true, "want": "\"line\\nbreak\\r\\n\\ttab\""},
  {"group": "string escapes", "input": "\"line\\nbreak\\r\\n\\ttab\"", "sortKeys": false, "ensureAscii": false, "want": "\"line\\nbreak\\r\\n\\ttab\""},
  {"group": "string escapes", "input": "\"line\\nbreak\\r\\n\\ttab\"", "sortKeys": true, "ensureAscii": true, "want": "\"line\\nbreak\\r\\n\\ttab\""},
  {"group": "string escapes", "input": "\"line\\nbreak\\r\\n\\ttab\"", "sortKeys": true, "ensureAscii": false, "want": "\"line\\nbreak\\r\\n\\ttab\""},
  {"group": "string escapes", "input": "\"\\b\\f\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\b\\f\""},
  {"group": "string escapes", "input": "\"\\b\\f\"", "sortKeys": false, "ensureAscii": false, "want": "\"\\b\\f\""},
  {"group": "string escapes", "input": "\"\\b\\f\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\b\\f\""},
  {"group": "string escapes", "input": "\"\\b\\f\"", "sortKeys": true, "ensureAscii": false, "want": "\"\\b\\f\""},
  {"group": "string escapes", "input": "\"\\u0000\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\u0000\""},
  {"group": "string escapes", "input": "\"\\u0000\"", "sortKeys": false, "ensureAscii": false, "want": "\"\\u0000\""},
  {"group": "string escapes", "input": "\"\\u0000\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\u0000\""},
  {"group": "string escapes", "input": "\"\\u0000\"", "sortKeys": true, "ensureAscii": false, "want": "\"\\u0000\""},
  {"group": "string escapes", "input": "\"\\u0001\\u001f\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\u0001\\u001f\""},
  {"group": "string escapes", "input": "\"\\u0001\\u001f\"", "sortKeys": false, "ensureAscii": false, "want": "\"\\u0001\\u001f\""},
  {"group": "string escapes", "input": "\"\\u0001\\u001f\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\u0001\\u001f\""},
  {"group": "string escapes", "input": "\"\\u0001\\u001f\"", "sortKeys": true, "ensureAscii": false, "want": "\"\\u0001\\u001f\""},
  {"group": "string escapes", "input": "\"del\\u007f\"", "sortKeys": false, "ensureAscii": true, "want": "\"del\\u007f\""},
  {"group": "string escapes", "input": "\"del\\u007f\"", "sortKeys": false, "ensureAscii": false, "want": "\"del\u007f\""},
  {"group": "string escapes", "input": "\"del\\u007f\"", "sortKeys": true, "ensureAscii": true, "want": "\"del\\u007f\""},
  {"group": "string escapes", "input": "\"del\\u007f\"", "sortKeys": true, "ensureAscii": false, "want": "\"del\u007f\""},
  {"group": "string escapes", "input": "\"/ and ' are not escaped\"", "sortKeys": false, "ensureAscii": true, "want": "\"/ and ' are not escaped\""},
  {"group": "string escapes", "input": "\"/ and ' are not escaped\"", "sortKeys": false, "ensureAscii": false, "want": "\"/ and ' are not escaped\""},
  {"group": "string escapes", "input": "\"/ and ' are not escaped\"", "sortKeys": true, "ensureAscii": true, "want": "\"/ and ' are not escaped\""},
  {"group": "string escapes", "input": "\"/ and ' are not escaped\"", "sortKeys": true, "ensureAscii": false, "want": "\"/ and ' are not escaped\""},
  {"group": "string escapes", "input": "\"tab\\there\"", "sortKeys": false, "ensureAscii": true, "want": "\"tab\\there\""},
  {"group": "string escapes", "input": "\"tab\\there\"", "sortKeys": false, "ensureAscii": false, "want": "\"tab\\there\""},
  {"group": "string escapes", "input": "\"tab\\there\"", "sortKeys": true, "ensureAscii": true, "want": "\"tab\\there\""},
  {"group": "string escapes", "input": "\"tab\\there\"", "sortKeys": true, "ensureAscii": false, "want": "\"tab\\there\""},
  {"group": "string escapes", "input": "\"\\\\n is not a newline\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\\\n is not a newline\""},
  {"group": "string escapes", "input": "\"\\\\n is not a newline\"", "sortKeys": false, "ensureAscii": false, "want": "\"\\\\n is not a newline\""},
  {"group": "string escapes", "input": "\"\\\\n is not a newline\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\\\n is not a newline\""},
  {"group": "string escapes", "input": "\"\\\\n is not a newline\"", "sortKeys": true, "ensureAscii": false, "want": "\"\\\\n is not a newline\""},
  {"group": "string escapes", "input": "\"\\\"\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\\"\""},
  {"group": "string escapes", "input": "\"\\\"\"", "sortKeys": false, "ensureAscii": false, "want": "\"\\\"\""},
  {"group": "string escapes", "input": "\"\\\"\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\\"\""},
  {"group": "string escapes", "input": "\"\\\"\"", "sortKeys": true, "ensureAscii": false, "want": "\"\\\"\""},
  {"group": "string escapes", "input": "\"\\\\\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\\\\""},
  {"group": "string escapes", "input": "\"\\\\\"", "sortKeys": false, "ensureAscii": false, "want": "\"\\\\\""},
  {"group": "string escapes", "input": "\"\\\\\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\\\\""},
  {"group": "string escapes", "input": "\"\\\\\"", "sortKeys": true, "ensureAscii": false, "want": "\"\\\\\""},
  {"group": "string escapes", "input": "\"\\\\\\\\\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\\\\\\\\""},
  {"group": "string escapes", "input": "\"\\\\\\\\\"", "sortKeys": false, "ensureAscii": false, "want": "\"\\\\\\\\\""},
  {"group": "string escapes", "input": "\"\\\\\\\\\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\\\\\\\\""},
  {"group": "string escapes", "input": "\"\\\\\\\\\"", "sortKeys": true, "ensureAscii": false, "want": "\"\\\\\\\\\""},
  {"group": "string escapes", "input": "\"\\\\\\\"\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\\\\\\"\""},
  {"group": "string escapes", "input": "\"\\\\\\\"\"", "sortKeys": false, "ensureAscii": false, "want": "\"\\\\\\\"\""},
  {"group": "string escapes", "input": "\"\\\\\\\"\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\\\\\\"\""},
  {"group": "string escapes", "input": "\"\\\\\\\"\"", "sortKeys": true, "ensureAscii": false, "want": "\"\\\\\\\"\""},
  {"group": "non-ASCII text", "input": "\"\\u00e9\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\u00e9\""},
  {"group": "non-ASCII text", "input": "\"\\u00e9\"", "sortKeys": false, "ensureAscii": false, "want": "\"\u00e9\""},
  {"group": "non-ASCII text", "input": "\"\\u00e9\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\u00e9\""},
  {"group": "non-ASCII text", "input": "\"\\u00e9\"", "sortKeys": true, "ensureAscii": false, "want": "\"\u00e9\""},
  {"group": "non-ASCII text", "input": "\"caf\\u00e9\"", "sortKeys": false, "ensureAscii": true, "want": "\"caf\\u00e9\""},
  {"group": "non-ASCII text", "input": "\"caf\\u00e9\"", "sortKeys": false, "ensureAscii": false, "want": "\"caf\u00e9\""},
  {"group": "non-ASCII text", "input": "\"caf\\u00e9\"", "sortKeys": true, "ensureAscii": true, "want": "\"caf\\u00e9\""},
  {"group": "non-ASCII text", "input": "\"caf\\u00e9\"", "sortKeys": true, "ensureAscii": false, "want": "\"caf\u00e9\""},
  {"group": "non-ASCII text", "input": "\"\\u2014\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\u2014\""},
  {"group": "non-ASCII text", "input": "\"\\u2014\"", "sortKeys": false, "ensureAscii": false, "want": "\"\u2014\""},
  {"group": "non-ASCII text", "input": "\"\\u2014\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\u2014\""},
  {"group": "non-ASCII text", "input": "\"\\u2014\"", "sortKeys": true, "ensureAscii": false, "want": "\"\u2014\""},
  {"group": "non-ASCII text", "input": "\"em\\u2014dash\"", "sortKeys": false, "ensureAscii": true, "want": "\"em\\u2014dash\""},
  {"group": "non-ASCII text", "input": "\"em\\u2014dash\"", "sortKeys": false, "ensureAscii": false, "want": "\"em\u2014dash\""},
  {"group": "non-ASCII text", "input": "\"em\\u2014dash\"", "sortKeys": true, "ensureAscii": true, "want": "\"em\\u2014dash\""},
  {"group": "non-ASCII text", "input": "\"em\\u2014dash\"", "sortKeys": true, "ensureAscii": false, "want": "\"em\u2014dash\""},
  {"group": "non-ASCII text", "input": "\"\\u00e1\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\u00e1\""},
  {"group": "non-ASCII text", "input": "\"\\u00e1\"", "sortKeys": false, "ensureAscii": false, "want": "\"\u00e1\""},
  {"group": "non-ASCII text", "input": "\"\\u00e1\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\u00e1\""},
  {"group": "non-ASCII text", "input": "\"\\u00e1\"", "sortKeys": true, "ensureAscii": false, "want": "\"\u00e1\""},
  {"group": "non-ASCII text", "input": "\"\\u65e5\\u672c\\u8a9e\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\u65e5\\u672c\\u8a9e\""},
  {"group": "non-ASCII text", "input": "\"\\u65e5\\u672c\\u8a9e\"", "sortKeys": false, "ensureAscii": false, "want": "\"\u65e5\u672c\u8a9e\""},
  {"group": "non-ASCII text", "input": "\"\\u65e5\\u672c\\u8a9e\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\u65e5\\u672c\\u8a9e\""},
  {"group": "non-ASCII text", "input": "\"\\u65e5\\u672c\\u8a9e\"", "sortKeys": true, "ensureAscii": false, "want": "\"\u65e5\u672c\u8a9e\""},
  {"group": "non-ASCII text", "input": "\"\\ud83d\\ude00\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\ud83d\\ude00\""},
  {"group": "non-ASCII text", "input": "\"\\ud83d\\ude00\"", "sortKeys": false, "ensureAscii": false, "want": "\"\ud83d\ude00\""},
  {"group": "non-ASCII text", "input": "\"\\ud83d\\ude00\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\ud83d\\ude00\""},
  {"group": "non-ASCII text", "input": "\"\\ud83d\\ude00\"", "sortKeys": true, "ensureAscii": false, "want": "\"\ud83d\ude00\""},
  {"group": "non-ASCII text", "input": "\"a\\ud83d\\ude00b\"", "sortKeys": false, "ensureAscii": true, "want": "\"a\\ud83d\\ude00b\""},
  {"group": "non-ASCII text", "input": "\"a\\ud83d\\ude00b\"", "sortKeys": false, "ensureAscii": false, "want": "\"a\ud83d\ude00b\""},
  {"group": "non-ASCII text", "input": "\"a\\ud83d\\ude00b\"", "sortKeys": true, "ensureAscii": true, "want": "\"a\\ud83d\\ude00b\""},
  {"group": "non-ASCII text", "input": "\"a\\ud83d\\ude00b\"", "sortKeys": true, "ensureAscii": false, "want": "\"a\ud83d\ude00b\""},
  {"group": "non-ASCII text", "input": "\"\\u2028\\u2029\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\u2028\\u2029\""},
  {"group": "non-ASCII text", "input": "\"\\u2028\\u2029\"", "sortKeys": false, "ensureAscii": false, "want": "\"\u2028\u2029\""},
  {"group": "non-ASCII text", "input": "\"\\u2028\\u2029\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\u2028\\u2029\""},
  {"group": "non-ASCII text", "input": "\"\\u2028\\u2029\"", "sortKeys": true, "ensureAscii": false, "want": "\"\u2028\u2029\""},
  {"group": "non-ASCII text", "input": "\"\\uffff\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\uffff\""},
  {"group": "non-ASCII text", "input": "\"\\uffff\"", "sortKeys": false, "ensureAscii": false, "want": "\"\uffff\""},
  {"group": "non-ASCII text", "input": "\"\\uffff\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\uffff\""},
  {"group": "non-ASCII text", "input": "\"\\uffff\"", "sortKeys": true, "ensureAscii": false, "want": "\"\uffff\""},
  {"group": "non-ASCII text", "input": "\"\\ufeff\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\ufeff\""},
  {"group": "non-ASCII text", "input": "\"\\ufeff\"", "sortKeys": false, "ensureAscii": false, "want": "\"\ufeff\""},
  {"group": "non-ASCII text", "input": "\"\\ufeff\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\ufeff\""},
  {"group": "non-ASCII text", "input": "\"\\ufeff\"", "sortKeys": true, "ensureAscii": false, "want": "\"\ufeff\""},
  {"group": "non-ASCII text", "input": "\"\\u20ac\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\u20ac\""},
  {"group": "non-ASCII text", "input": "\"\\u20ac\"", "sortKeys": false, "ensureAscii": false, "want": "\"\u20ac\""},
  {"group": "non-ASCII text", "input": "\"\\u20ac\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\u20ac\""},
  {"group": "non-ASCII text", "input": "\"\\u20ac\"", "sortKeys": true, "ensureAscii": false, "want": "\"\u20ac\""},
  {"group": "non-ASCII text", "input": "\"\\u0080\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\u0080\""},
  {"group": "non-ASCII text", "input": "\"\\u0080\"", "sortKeys": false, "ensureAscii": false, "want": "\"\u0080\""},
  {"group": "non-ASCII text", "input": "\"\\u0080\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\u0080\""},
  {"group": "non-ASCII text", "input": "\"\\u0080\"", "sortKeys": true, "ensureAscii": false, "want": "\"\u0080\""},
  {"group": "non-ASCII text", "input": "\"\\u00a0\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\u00a0\""},
  {"group": "non-ASCII text", "input": "\"\\u00a0\"", "sortKeys": false, "ensureAscii": false, "want": "\"\u00a0\""},
  {"group": "non-ASCII text", "input": "\"\\u00a0\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\u00a0\""},
  {"group": "non-ASCII text", "input": "\"\\u00a0\"", "sortKeys": true, "ensureAscii": false, "want": "\"\u00a0\""},
  {"group": "non-ASCII text", "input": "\"mixed \\u00e9 \\\"q\\\" \\\\ \\n \\u2014 \\ud83d\\udca9 end\"", "sortKeys": false, "ensureAscii": true, "want": "\"mixed \\u00e9 \\\"q\\\" \\\\ \\n \\u2014 \\ud83d\\udca9 end\""},
  {"group": "non-ASCII text", "input": "\"mixed \\u00e9 \\\"q\\\" \\\\ \\n \\u2014 \\ud83d\\udca9 end\"", "sortKeys": false, "ensureAscii": false, "want": "\"mixed \u00e9 \\\"q\\\" \\\\ \\n \u2014 \ud83d\udca9 end\""},
  {"group": "non-ASCII text", "input": "\"mixed \\u00e9 \\\"q\\\" \\\\ \\n \\u2014 \\ud83d\\udca9 end\"", "sortKeys": true, "ensureAscii": true, "want": "\"mixed \\u00e9 \\\"q\\\" \\\\ \\n \\u2014 \\ud83d\\udca9 end\""},
  {"group": "non-ASCII text", "input": "\"mixed \\u00e9 \\\"q\\\" \\\\ \\n \\u2014 \\ud83d\\udca9 end\"", "sortKeys": true, "ensureAscii": false, "want": "\"mixed \u00e9 \\\"q\\\" \\\\ \\n \u2014 \ud83d\udca9 end\""},
  {"group": "non-ASCII text", "input": "\"\\udbff\\udfff\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\udbff\\udfff\""},
  {"group": "non-ASCII text", "input": "\"\\udbff\\udfff\"", "sortKeys": false, "ensureAscii": false, "want": "\"\udbff\udfff\""},
  {"group": "non-ASCII text", "input": "\"\\udbff\\udfff\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\udbff\\udfff\""},
  {"group": "non-ASCII text", "input": "\"\\udbff\\udfff\"", "sortKeys": true, "ensureAscii": false, "want": "\"\udbff\udfff\""},
  {"group": "non-ASCII text", "input": "\"\\u07ff\\u0800\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\u07ff\\u0800\""},
  {"group": "non-ASCII text", "input": "\"\\u07ff\\u0800\"", "sortKeys": false, "ensureAscii": false, "want": "\"\u07ff\u0800\""},
  {"group": "non-ASCII text", "input": "\"\\u07ff\\u0800\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\u07ff\\u0800\""},
  {"group": "non-ASCII text", "input": "\"\\u07ff\\u0800\"", "sortKeys": true, "ensureAscii": false, "want": "\"\u07ff\u0800\""},
  {"group": "non-ASCII text", "input": "\"\\ud7ff\\ue000\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\ud7ff\\ue000\""},
  {"group": "non-ASCII text", "input": "\"\\ud7ff\\ue000\"", "sortKeys": false, "ensureAscii": false, "want": "\"\ud7ff\ue000\""},
  {"group": "non-ASCII text", "input": "\"\\ud7ff\\ue000\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\ud7ff\\ue000\""},
  {"group": "non-ASCII text", "input": "\"\\ud7ff\\ue000\"", "sortKeys": true, "ensureAscii": false, "want": "\"\ud7ff\ue000\""},
  {"group": "key order", "input": "{\"a\": 1, \"B\": 2, \"_\": 3, \"\\u00e9\": 4, \"\\uffff\": 5, \"\\ud83d\\ude00\": 6, \"\\ud7ff\": 7, \"\\ue000\": 8}", "sortKeys": false, "ensureAscii": true, "want": "{\"a\": 1, \"B\": 2, \"_\": 3, \"\\u00e9\": 4, \"\\uffff\": 5, \"\\ud83d\\ude00\": 6, \"\\ud7ff\": 7, \"\\ue000\": 8}"},
  {"group": "key order", "input": "{\"a\": 1, \"B\": 2, \"_\": 3, \"\\u00e9\": 4, \"\\uffff\": 5, \"\\ud83d\\ude00\": 6, \"\\ud7ff\": 7, \"\\ue000\": 8}", "sortKeys": false, "ensureAscii": false, "want": "{\"a\": 1, \"B\": 2, \"_\": 3, \"\u00e9\": 4, \"\uffff\": 5, \"\ud83d\ude00\": 6, \"\ud7ff\": 7, \"\ue000\": 8}"},
  {"group": "key order", "input": "{\"a\": 1, \"B\": 2, \"_\": 3, \"\\u00e9\": 4, \"\\uffff\": 5, \"\\ud83d\\ude00\": 6, \"\\ud7ff\": 7, \"\\ue000\": 8}", "sortKeys": true, "ensureAscii": true, "want": "{\"B\": 2, \"_\": 3, \"a\": 1, \"\\u00e9\": 4, \"\\ud7ff\": 7, \"\\ue000\": 8, \"\\uffff\": 5, \"\\ud83d\\ude00\": 6}"},
  {"group": "key order", "input": "{\"a\": 1, \"B\": 2, \"_\": 3, \"\\u00e9\": 4, \"\\uffff\": 5, \"\\ud83d\\ude00\": 6, \"\\ud7ff\": 7, \"\\ue000\": 8}", "sortKeys": true, "ensureAscii": false, "want": "{\"B\": 2, \"_\": 3, \"a\": 1, \"\u00e9\": 4, \"\ud7ff\": 7, \"\ue000\": 8, \"\uffff\": 5, \"\ud83d\ude00\": 6}"},
  {"group": "key order", "input": "{\"\\ud83d\\ude00\": 1, \"\\uffff\": 2}", "sortKeys": false, "ensureAscii": true, "want": "{\"\\ud83d\\ude00\": 1, \"\\uffff\": 2}"},
  {"group": "key order", "input": "{\"\\ud83d\\ude00\": 1, \"\\uffff\": 2}", "sortKeys": false, "ensureAscii": false, "want": "{\"\ud83d\ude00\": 1, \"\uffff\": 2}"},
  {"group": "key order", "input": "{\"\\ud83d\\ude00\": 1, \"\\uffff\": 2}", "sortKeys": true, "ensureAscii": true, "want": "{\"\\uffff\": 2, \"\\ud83d\\ude00\": 1}"},
  {"group": "key order", "input": "{\"\\ud83d\\ude00\": 1, \"\\uffff\": 2}", "sortKeys": true, "ensureAscii": false, "want": "{\"\uffff\": 2, \"\ud83d\ude00\": 1}"},
  {"group": "key order", "input": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"a\\ud83d\\ude00\": 4, \"a\\uffff\": 5}", "sortKeys": false, "ensureAscii": true, "want": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"a\\ud83d\\ude00\": 4, \"a\\uffff\": 5}"},
  {"group": "key order", "input": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"a\\ud83d\\ude00\": 4, \"a\\uffff\": 5}", "sortKeys": false, "ensureAscii": false, "want": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"a\ud83d\ude00\": 4, \"a\uffff\": 5}"},
  {"group": "key order", "input": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"a\\ud83d\\ude00\": 4, \"a\\uffff\": 5}", "sortKeys": true, "ensureAscii": true, "want": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"a\\uffff\": 5, \"a\\ud83d\\ude00\": 4}"},
  {"group": "key order", "input": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"a\\ud83d\\ude00\": 4, \"a\\uffff\": 5}", "sortKeys": true, "ensureAscii": false, "want": "{\"\": 0, \"a\": 1, \"aa\": 2, \"ab\": 3, \"a\uffff\": 5, \"a\ud83d\ude00\": 4}"},
  {"group": "key order", "input": "{\"b\\u00e9\": 1, \"b\": 2, \"\\u00e9\": 3, \"e\": 4, \"\\u2014\": 5, \"z\": 6}", "sortKeys": false, "ensureAscii": true, "want": "{\"b\\u00e9\": 1, \"b\": 2, \"\\u00e9\": 3, \"e\": 4, \"\\u2014\": 5, \"z\": 6}"},
  {"group": "key order", "input": "{\"b\\u00e9\": 1, \"b\": 2, \"\\u00e9\": 3, \"e\": 4, \"\\u2014\": 5, \"z\": 6}", "sortKeys": false, "ensureAscii": false, "want": "{\"b\u00e9\": 1, \"b\": 2, \"\u00e9\": 3, \"e\": 4, \"\u2014\": 5, \"z\": 6}"},
  {"group": "key order", "input": "{\"b\\u00e9\": 1, \"b\": 2, \"\\u00e9\": 3, \"e\": 4, \"\\u2014\": 5, \"z\": 6}", "sortKeys": true, "ensureAscii": true, "want": "{\"b\": 2, \"b\\u00e9\": 1, \"e\": 4, \"z\": 6, \"\\u00e9\": 3, \"\\u2014\": 5}"},
  {"group": "key order", "input": "{\"b\\u00e9\": 1, \"b\": 2, \"\\u00e9\": 3, \"e\": 4, \"\\u2014\": 5, \"z\": 6}", "sortKeys": true, "ensureAscii": false, "want": "{\"b\": 2, \"b\u00e9\": 1, \"e\": 4, \"z\": 6, \"\u00e9\": 3, \"\u2014\": 5}"},
  {"group": "key order", "input": "{\"\\u00e9\": {\"\\u2014\": [1, {\"\\ud83d\\ude00\": 2, \"a\": 3}]}}", "sortKeys": true, "ensureAscii": true, "want": "{\"\\u00e9\": {\"\\u2014\": [1, {\"a\": 3, \"\\ud83d\\ude00\": 2}]}}"},
  {"group": "key order", "input": "{\"\\u00e9\": {\"\\u2014\": [1, {\"\\ud83d\\ude00\": 2, \"a\": 3}]}}", "sortKeys": true, "ensureAscii": false, "want": "{\"\u00e9\": {\"\u2014\": [1, {\"a\": 3, \"\ud83d\ude00\": 2}]}}"},
  {"group": "lone surrogates (ensure_ascii only)", "input": "[\"\\ud800\", \"\\udc00x\", \"a\\ud83d\"]", "sortKeys": false, "ensureAscii": true, "want": "[\"\\ud800\", \"\\udc00x\", \"a\\ud83d\"]"},
  {"group": "lone surrogates (ensure_ascii only)", "input": "[\"\\ud800\", \"\\udc00x\", \"a\\ud83d\"]", "sortKeys": true, "ensureAscii": true, "want": "[\"\\ud800\", \"\\udc00x\", \"a\\ud83d\"]"},
  {"group": "lone surrogates (ensure_ascii only)", "input": "\"\\ud83d\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\ud83d\""},
  {"group": "lone surrogates (ensure_ascii only)", "input": "\"\\ud83d\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\ud83d\""},
  {"group": "lone surrogates (ensure_ascii only)", "input": "\"\\ude00\\ud83d\"", "sortKeys": false, "ensureAscii": true, "want": "\"\\ude00\\ud83d\""},
  {"group": "lone surrogates (ensure_ascii only)", "input": "\"\\ude00\\ud83d\"", "sortKeys": true, "ensureAscii": true, "want": "\"\\ude00\\ud83d\""}
];

const groups = [...new Set(VECTORS.map((v) => v.group))];
for (const group of groups) {
  test(`pyJson equals Python json.dumps byte for byte: ${group}`, () => {
    const cases = VECTORS.filter((v) => v.group === group);
    assert.ok(cases.length > 0);
    for (const v of cases) {
      const got = pyJson(JSON.parse(v.input), { sortKeys: v.sortKeys, ensureAscii: v.ensureAscii });
      assert.equal(got, v.want, `input ${v.input} sortKeys=${v.sortKeys} ensureAscii=${v.ensureAscii}`);
    }
  });
}

test('default separators are ", " and ": ", unlike JSON.stringify', () => {
  const value = { b: [1, 2], a: { c: null } };
  assert.equal(pyJson(value), '{"b": [1, 2], "a": {"c": null}}');
  assert.equal(pyJson(value, { sortKeys: true }), '{"a": {"c": null}, "b": [1, 2]}');
  assert.notEqual(pyJson(value), JSON.stringify(value));
});

// Characters are built from code points, never written as \u escapes, so no tool in between can turn them into raw text.
const E_ACUTE = String.fromCharCode(0xe9);
const EM_DASH = String.fromCharCode(0x2014);
const SMILE = String.fromCodePoint(0x1f600);
const U_FFFF = String.fromCharCode(0xffff);

test('ensure_ascii is on by default and can be switched off', () => {
  assert.equal(pyJson(E_ACUTE + EM_DASH), '"\\u00e9\\u2014"');
  assert.equal(pyJson(E_ACUTE + EM_DASH, { ensureAscii: false }), '"' + E_ACUTE + EM_DASH + '"');
  assert.equal(pyJson(SMILE), '"\\ud83d\\ude00"');
  assert.equal(pyJson('\x7f'), '"\\u007f"');
  assert.equal(pyJson('\x7f', { ensureAscii: false }), '"\x7f"');
  assert.equal(pyJson('\x01\x1f'), '"\\u0001\\u001f"', 'control characters use lowercase hex');
});

test('integer-valued numbers are written as Python ints, other numbers as Python float repr', () => {
  assert.equal(pyJson(3), '3');
  assert.equal(pyJson(3.0), '3');
  assert.equal(pyJson(-5), '-5');
  assert.equal(pyJson(0), '0');
  assert.equal(pyJson(-0), '0');
  assert.equal(pyJson(1e21), '1000000000000000000000');
  assert.equal(pyJson(2 ** 53), '9007199254740992');
  assert.equal(pyJson(12345678901234567890n), '12345678901234567890');
  assert.equal(pyJson(0.5), '0.5');
  assert.equal(pyJson(1e-5), '1e-05');
  assert.equal(pyJson(2.5e-5), '2.5e-05');
  assert.equal(pyJson(0.0001), '0.0001');
  assert.equal(pyJson(-1.5e-10), '-1.5e-10');
  assert.equal(pyJson([0.1, 1, 2.5]), '[0.1, 1, 2.5]');
});

test('NaN and the infinities are written the way Python writes them', () => {
  assert.equal(pyJson([NaN, Infinity, -Infinity]), '[NaN, Infinity, -Infinity]');
});

test('values Python could not serialize throw instead of being dropped or reshaped', () => {
  assert.throws(() => pyJson(undefined), { name: 'TypeError', message: /undefined.*\$/ });
  assert.throws(() => pyJson({ a: undefined }), { name: 'TypeError', message: /undefined.*\$\["a"\]/ });
  assert.throws(() => pyJson([1, [2, () => 3]]), { name: 'TypeError', message: /function.*\$\[1\]\[1\]/ });
  assert.throws(() => pyJson(Symbol('x')), TypeError);
  assert.throws(() => pyJson(new Date(0)), { name: 'TypeError', message: /Date/ });
  assert.throws(() => pyJson(new Map()), { name: 'TypeError', message: /Map/ });
  assert.throws(() => pyJson(new (class Tag {})()), { name: 'TypeError', message: /Tag/ });
  // JSON.stringify would turn the hole into null and drop the undefined key; a hash must not depend on that
  assert.throws(() => pyJson([1, , 3]), TypeError); // eslint-disable-line no-sparse-arrays
});

test('a circular reference throws', () => {
  const a = { name: 'a' };
  a.self = a;
  assert.throws(() => pyJson(a), { name: 'TypeError', message: /circular/ });
  const shared = { x: 1 };
  assert.equal(pyJson([shared, shared]), '[{"x": 1}, {"x": 1}]', 'the same object twice is not a cycle');
});

test('objects without a prototype are plain objects', () => {
  const o = Object.create(null);
  o.k = 'v';
  assert.equal(pyJson(o), '{"k": "v"}');
});

test('without sortKeys the order is the JS property order (integer-like keys first), with sortKeys it is Python order', () => {
  assert.equal(pyJson({ b: 1, 2: 2, a: 3 }), '{"2": 2, "b": 1, "a": 3}');
  assert.equal(pyJson({ b: 1, 2: 2, a: 3 }, { sortKeys: true }), '{"2": 2, "a": 3, "b": 1}');
});

test('compareCodePoints orders like Python str, not like UTF-16 code units', () => {
  // U+1F600 is the UTF-16 pair D83D DE00, so JS compares it as smaller than U+FFFF; Python (code points) says larger
  assert.ok(SMILE < U_FFFF, 'plain JS comparison is by code unit');
  assert.equal(compareCodePoints(SMILE, U_FFFF), 1);
  assert.equal(compareCodePoints(U_FFFF, SMILE), -1);
  assert.equal(compareCodePoints('a', 'a'), 0);
  assert.equal(compareCodePoints('a', 'ab'), -1);
  assert.equal(compareCodePoints('ab', 'a'), 1);
  assert.equal(compareCodePoints('', 'a'), -1);
  assert.deepEqual(['b', SMILE, 'B', U_FFFF, 'a', E_ACUTE].sort(compareCodePoints), ['B', 'a', 'b', E_ACUTE, U_FFFF, SMILE]);
});
