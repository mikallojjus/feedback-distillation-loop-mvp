import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The eight modules the MVP agent does not change are one-line re-exports of the old agent's. This proves each one is exactly that:
// the same names, and for every name the very same function or value, so nothing can drift apart between the two agents.

const SHIMS = ['hash', 'jsonl', 'pyjson', 'rng', 'validate', 'exit-codes', 'notion-values', 'stats'];
const file = (agent, name) => fileURLToPath(new URL(`../../agents/${agent}/scripts/lib/${name}.mjs`, import.meta.url));

for (const name of SHIMS) {
  test(`${name}.mjs: one comment line, one re-export line, and every export is the old module's own`, async () => {
    const lines = readFileSync(file('claim-tagger-mvp', name), 'utf8').split('\n').filter((l) => l.trim() !== '');
    assert.equal(lines.length, 2, `a header comment and one line of code, got ${lines.length} lines`);
    assert.match(lines[0], /^\/\/ \S/, 'the first line is the header comment');
    assert.equal(lines[1], `export * from '../../../claim-tagger/scripts/lib/${name}.mjs';`);

    const mine = await import(`../../agents/claim-tagger-mvp/scripts/lib/${name}.mjs`);
    const theirs = await import(`../../agents/claim-tagger/scripts/lib/${name}.mjs`);
    const names = Object.keys(theirs).sort();
    assert.ok(names.length > 0, 'the old module has exports');
    assert.deepEqual(Object.keys(mine).sort(), names);
    for (const n of names) assert.equal(mine[n], theirs[n], `${name}.${n} is the old export itself`);
  });
}

test('the shims work from the MVP folder: notion-values encodes a title and a long text with the old splitRichText', async () => {
  const { encodeProperties } = await import('../../agents/claim-tagger-mvp/scripts/lib/notion-values.mjs');
  const { splitRichText } = await import('../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs');
  const schema = { properties: { Name: { type: 'title' }, Note: { type: 'rich_text' } } };
  const encoded = encodeProperties({ Name: 'A claim', Note: 'x'.repeat(4500) }, schema);
  assert.equal(encoded.Name.title[0].text.content, 'A claim');
  assert.deepEqual(encoded.Note.rich_text.map((c) => c.text.content.length), [2000, 2000, 500]);
  assert.deepEqual(encoded.Note.rich_text, splitRichText('x'.repeat(4500)), 'the MVP copy of splitRichText chunks the same way the old one does');
});
