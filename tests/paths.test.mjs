import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { agentRoot, ensureDir, isMain, repoRoot, runId, runsDir, safeName } from '../agents/claim-tagger/scripts/lib/paths.mjs';
import { EXIT, describeExit } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';

const MODULE = fileURLToPath(new URL('../agents/claim-tagger/scripts/lib/paths.mjs', import.meta.url));
const SMILE = String.fromCodePoint(0x1f600);
const E_ACUTE = String.fromCharCode(0xe9);

const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-paths-'));
  roots.push(dir);
  return dir;
}

test('agentRoot is agents/claim-tagger of this repository', () => {
  assert.ok(agentRoot().endsWith(['agents', 'claim-tagger'].join(sep)), agentRoot());
  assert.ok(existsSync(join(agentRoot(), 'config.json')));
  assert.ok(existsSync(join(agentRoot(), 'scripts', 'lib', 'paths.mjs')));
});

test('repoRoot is two levels above the agent and holds package.json', () => {
  assert.equal(repoRoot(), resolve(agentRoot(), '..', '..'));
  assert.equal(JSON.parse(readFileSync(join(repoRoot(), 'package.json'), 'utf8')).name, 'geo-agents');
});

test('runsDir is <agent>/runs', () => {
  assert.equal(runsDir(), join(agentRoot(), 'runs'));
});

test('the roots come from the module location, not from the working directory', () => {
  const code = `import { agentRoot, repoRoot } from ${JSON.stringify(pathToFileURL(MODULE).href)}; console.log(JSON.stringify([agentRoot(), repoRoot()]));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [agentRoot(), repoRoot()]);
});

test('runId: YYYYMMDDTHHMMSSZ-kind in UTC, zero padded', () => {
  assert.equal(runId('tag', new Date(Date.UTC(2026, 9, 13, 14, 15, 9))), '20261013T141509Z-tag');
  assert.equal(runId('gate', new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), '20260102T030405Z-gate');
  assert.equal(runId('x', new Date('2026-10-13T23:59:59.999Z')), '20261013T235959Z-x');
  assert.equal(runId('x', new Date('2026-10-14T00:00:00+03:00')), '20261013T210000Z-x', 'a local offset is converted to UTC');
});

test('runId never contains a colon, whatever the kind, and sorts in time order', () => {
  assert.equal(runId('tag').includes(':'), false);
  assert.match(runId('tag'), /^\d{8}T\d{6}Z-tag$/);
  assert.equal(runId('a b:c/d'), runId('a-b-c-d'));
  assert.equal(runId('a:b', new Date(0)).includes(':'), false);
  const ids = [new Date(Date.UTC(2026, 9, 13, 9)), new Date(Date.UTC(2026, 9, 13, 10)), new Date(Date.UTC(2026, 9, 14, 1))].map((d) => runId('t', d));
  assert.deepEqual([...ids].sort(), ids);
});

test('safeName keeps [A-Za-z0-9._-] and replaces everything else with a dash', () => {
  assert.equal(safeName('Predictive rule 1'), 'Predictive-rule-1');
  assert.equal(safeName('abc_DEF-1.2'), 'abc_DEF-1.2');
  assert.equal(safeName('a:b'), 'a-b');
  assert.equal(safeName('C:\\temp\\x?*"<>|'), 'C--temp-x------');
  assert.equal(safeName(`caf${E_ACUTE}`), 'caf-');
  assert.equal(safeName(`a${SMILE}b`), 'a-b', 'one dash per character, not per UTF-16 unit');
  assert.equal(safeName('sha256:abc'), 'sha256-abc');
  assert.equal(safeName(42), '42');
});

test('safeName can never return an empty name or a dot name', () => {
  assert.equal(safeName(''), '-');
  assert.equal(safeName('.'), '-');
  assert.equal(safeName('..'), '--');
  assert.equal(safeName('...'), '---');
  assert.equal(safeName('.hidden'), '.hidden');
  assert.equal(safeName('a..b'), 'a..b');
});

test('ensureDir creates nested folders, is idempotent and returns the path', () => {
  const p = join(tmp(), 'a', 'b', 'c');
  assert.equal(ensureDir(p), p);
  assert.ok(statSync(p).isDirectory());
  assert.equal(ensureDir(p), p);
});

test('isMain: true for the script that node started, false otherwise', () => {
  const url = pathToFileURL(MODULE).href;
  assert.equal(isMain(url, MODULE), true);
  assert.equal(isMain(url, join(MODULE, '..', '..', 'lib', 'paths.mjs')), true, 'a path with .. segments is the same file');
  assert.equal(isMain(url, join(MODULE, '..', 'jsonl.mjs')), false);
  assert.equal(isMain(url, undefined), false);
  assert.equal(isMain(url, join(tmpdir(), 'does-not-exist.mjs')), false);
  if (process.platform === 'win32') {
    const flipped = MODULE[0] === MODULE[0].toLowerCase() ? MODULE[0].toUpperCase() + MODULE.slice(1) : MODULE[0].toLowerCase() + MODULE.slice(1);
    assert.equal(isMain(url, flipped), true, 'a different drive letter case is still the same file');
  }
});

// exit-codes.mjs is a table and one function, so its test lives here with the other small helpers

test('EXIT is the agreed table of exit codes and cannot be changed at run time', () => {
  assert.deepEqual({ ...EXIT }, { OK: 0, ERROR: 1, INVALID: 2, PAUSED: 3, DRIFT: 4, TRUST: 5, HOLD: 10, FAIL: 11, USAGE_WINDOW: 75 });
  assert.equal(Object.isFrozen(EXIT), true);
  assert.equal(new Set(Object.values(EXIT)).size, Object.values(EXIT).length, 'no two names share a code');
});

test('describeExit gives one plain sentence per code and handles unknown codes', () => {
  const sentences = Object.values(EXIT).map(describeExit);
  assert.equal(new Set(sentences).size, sentences.length, 'every code has its own sentence');
  for (const s of sentences) assert.match(s, /^[A-Z].*\.$/, s);
  for (const s of sentences) assert.equal(s.includes('\n'), false);
  assert.match(describeExit(EXIT.PAUSED), /paused/i);
  assert.match(describeExit(EXIT.HOLD), /HOLD/);
  assert.match(describeExit(EXIT.FAIL), /FAIL/);
  assert.match(describeExit(EXIT.DRIFT), /no longer matches/);
  assert.match(describeExit(EXIT.TRUST), /editors/);
  assert.match(describeExit(EXIT.USAGE_WINDOW), /usage window.*--resume/);
  assert.match(describeExit(EXIT.INVALID), /invalid or incomplete/);
  assert.equal(describeExit(EXIT.OK), 'Finished without problems.');
  assert.match(describeExit(42), /42/);
  assert.match(describeExit(undefined), /undefined/);
});

test('isMain works for a script run by node (the real thing, not an injected argv)', () => {
  const dir = tmp();
  const script = join(dir, 'probe.mjs');
  const code = `import { isMain } from ${JSON.stringify(pathToFileURL(MODULE).href)};\nconsole.log(isMain(import.meta.url) ? 'main' : 'imported');\n`;
  // write with node itself to avoid any shell quoting
  const w = spawnSync(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(script)}, ${JSON.stringify(code)})`], { encoding: 'utf8' });
  assert.equal(w.status, 0, w.stderr);
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'main', r.stderr);
  const i = spawnSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(pathToFileURL(script).href)}`], { encoding: 'utf8' });
  assert.equal(i.stdout.trim(), 'imported', i.stderr);
});
