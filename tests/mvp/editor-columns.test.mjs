import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { codeRoot } from '../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';

// The one rule of PORT-V2.md: no code outside lib/decisions.mjs reads Tag outcome, Agent is right or Your note off a row to decide anything. Every reader asks rowDecision(row).
// A loop plan may name the columns only as data, through TD_EDITOR (lib/plan.mjs checkPlan refuses them). This test reads the scripts' source and fails on a property read of one of the three.

const SCRIPTS = join(codeRoot(), 'scripts');
// the files that may spell the columns: the reader itself, the one place their names are defined, the setup, the parked practice pages and the copy of the first page
const EXEMPT = new Set(['lib/decisions.mjs', 'lib/config.mjs', 'walkthrough.mjs', 'demo-mocks.mjs', 'lib/demo-profile.mjs', 'lib/setup-steps.mjs', 'copy-live.mjs']);

const READS = [
  /\[\s*'Tag outcome'\s*\]/, /\[\s*"Tag outcome"\s*\]/, /\[\s*`Tag outcome`\s*\]/,
  /\[\s*'Agent is right'\s*\]/, /\[\s*"Agent is right"\s*\]/, /\[\s*`Agent is right`\s*\]/,
  /\[\s*'Your note'\s*\]/, /\[\s*"Your note"\s*\]/, /\[\s*`Your note`\s*\]/,
  /\bTD\.outcome\s*\]/, /\bTD\.right\s*\]/, /\bTD\.note\s*\]/,
];

/** The source without its comments (block comments, and a line comment that starts a line or follows a space), so that history in a comment is not a read. */
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

/** The reads of the three columns in a source text: [{ line, text }]. */
export function editorReads(source) {
  return withoutComments(source).split('\n').flatMap((text, i) => (READS.some((re) => re.test(text)) ? [{ line: i + 1, text: text.trim().slice(0, 100) }] : []));
}

function mjsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return mjsFiles(full);
    return entry.name.endsWith('.mjs') ? [full] : [];
  });
}

test('the check sees a read of each of the three columns, in every spelling, and ignores comments and the names as data', () => {
  for (const code of [
    "const o = row['Tag outcome'];", 'const o = row["Tag outcome"];', 'const o = row[`Tag outcome`];', "if (row[ 'Agent is right' ] === true) {}", "const n = r['Your note'];",
    'const o = row[TD.outcome];', 'const r = row[TD.right] === true;', 'const n = row[TD.note].trim();',
  ]) assert.equal(editorReads(code).length, 1, code);
  for (const code of [
    "// row['Tag outcome'] is read by rowDecision", "/* row[TD.note] */ const x = 1;", "const columns = ['Agent is right', 'Tag outcome', 'Your note'];", 'const { outcome } = rowDecision(row);',
    "plan.update('tag_decisions', key, id, { [TD.view]: 'Agent slip' });", 'for (const c of TD_EDITOR) names.add(c);', "const o = { 'Tag outcome': 'green' };",
  ]) assert.deepEqual(editorReads(code), [], code);
});

test('no script outside lib/decisions.mjs reads Tag outcome, Agent is right or Your note off a row: every reader asks rowDecision(row)', () => {
  const found = [];
  let looked = 0;
  for (const file of mjsFiles(SCRIPTS)) {
    const name = relative(SCRIPTS, file).replace(/\\/g, '/');
    if (EXEMPT.has(name)) continue;
    looked += 1;
    for (const read of editorReads(readFileSync(file, 'utf8'))) found.push(`${name}:${read.line}: ${read.text}`);
  }
  assert.ok(looked > 20, `the scan found ${looked} files: the folder moved?`);
  assert.deepEqual(found, [], 'ask rowDecision(row) (lib/decisions.mjs) instead of reading the column');
});

test('the exempt files exist, so a rename does not silently widen the exemption', () => {
  const have = new Set(mjsFiles(SCRIPTS).map((f) => relative(SCRIPTS, f).replace(/\\/g, '/')));
  for (const name of EXEMPT) assert.ok(have.has(name), `${name} is exempt but is not a script`);
});
