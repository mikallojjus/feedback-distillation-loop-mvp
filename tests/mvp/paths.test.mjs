import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as mvp from '../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';
import * as old from '../../agents/claim-tagger/scripts/lib/paths.mjs';

const MODULE = fileURLToPath(new URL('../../agents/claim-tagger-mvp/scripts/lib/paths.mjs', import.meta.url));
const SMILE = String.fromCodePoint(0x1f600);
const E_ACUTE = String.fromCharCode(0xe9);

const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-paths-'));
  roots.push(dir);
  return dir;
}

/** Run fn with an environment variable set (value undefined: removed) and put it back afterwards. */
function withEnv(name, value, fn) {
  const had = Object.hasOwn(process.env, name);
  const before = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (had) process.env[name] = before;
    else delete process.env[name];
  }
}

test('codeRoot is agents/claim-tagger-mvp of this repository, found from the module, and is not the old agent folder', () => {
  const root = mvp.codeRoot();
  assert.ok(root.endsWith(['agents', 'claim-tagger-mvp'].join(sep)), root);
  assert.equal(root, resolve(fileURLToPath(new URL('../../agents/claim-tagger-mvp', import.meta.url))));
  assert.ok(existsSync(join(root, 'scripts', 'lib', 'paths.mjs')));
  assert.notEqual(root, old.codeRoot());
  assert.ok(old.codeRoot().endsWith(['agents', 'claim-tagger'].join(sep)));
});

test('ROOT_ENV is CLAIM_TAGGER_MVP_ROOT, not the old agent\'s variable', () => {
  assert.equal(mvp.ROOT_ENV, 'CLAIM_TAGGER_MVP_ROOT');
  assert.equal(old.ROOT_ENV, 'CLAIM_TAGGER_ROOT');
  assert.notEqual(mvp.ROOT_ENV, old.ROOT_ENV);
});

test('agentRoot is the code root unless CLAIM_TAGGER_MVP_ROOT names another folder', () => {
  withEnv(mvp.ROOT_ENV, undefined, () => {
    assert.equal(mvp.agentRoot(), mvp.codeRoot());
  });
  const other = tmp();
  withEnv(mvp.ROOT_ENV, other, () => {
    assert.equal(mvp.agentRoot(), resolve(other));
    assert.equal(mvp.codeRoot().endsWith(['agents', 'claim-tagger-mvp'].join(sep)), true, 'the code root never moves');
  });
  withEnv(mvp.ROOT_ENV, join('relative', 'state'), () => {
    assert.equal(mvp.agentRoot(), resolve('relative', 'state'), 'a relative override is made absolute');
  });
  withEnv(mvp.ROOT_ENV, '', () => {
    assert.equal(mvp.agentRoot(), mvp.codeRoot(), 'an empty value is no override');
  });
});

test('the old agent\'s CLAIM_TAGGER_ROOT does not move this agent, and this agent\'s variable does not move the old one', () => {
  const other = tmp();
  withEnv(mvp.ROOT_ENV, undefined, () => {
    withEnv(old.ROOT_ENV, other, () => {
      assert.equal(mvp.agentRoot(), mvp.codeRoot());
      assert.equal(old.agentRoot(), resolve(other));
    });
  });
  withEnv(old.ROOT_ENV, undefined, () => {
    withEnv(mvp.ROOT_ENV, other, () => {
      assert.equal(old.agentRoot(), old.codeRoot());
      assert.equal(mvp.agentRoot(), resolve(other));
    });
  });
});

test('repoRoot is two levels above the code root, holds package.json, and is the same repository as the old module finds', () => {
  assert.equal(mvp.repoRoot(), resolve(mvp.codeRoot(), '..', '..'));
  assert.equal(mvp.repoRoot(), old.repoRoot());
  assert.equal(JSON.parse(readFileSync(join(mvp.repoRoot(), 'package.json'), 'utf8')).name, 'geo-agents');
  withEnv(mvp.ROOT_ENV, tmp(), () => {
    assert.equal(mvp.repoRoot(), old.repoRoot(), 'a sandbox never moves the repository root (where .env lives)');
  });
});

test('runsDir is <state root>/runs and follows the override', () => {
  withEnv(mvp.ROOT_ENV, undefined, () => {
    assert.equal(mvp.runsDir(), join(mvp.codeRoot(), 'runs'));
  });
  const other = tmp();
  withEnv(mvp.ROOT_ENV, other, () => {
    assert.equal(mvp.runsDir(), join(resolve(other), 'runs'));
  });
});

test('codeFile prefers the state root\'s own copy and falls back to the agent folder', () => {
  const state = tmp();
  mkdirSync(join(state, 'schemas'));
  writeFileSync(join(state, 'schemas', 'own.json'), '{}');
  assert.equal(mvp.codeFile(state, 'schemas', 'own.json'), join(state, 'schemas', 'own.json'));
  assert.equal(mvp.codeFile(state, 'schemas', 'missing.json'), join(mvp.codeRoot(), 'schemas', 'missing.json'));
  assert.equal(mvp.codeFile(mvp.codeRoot(), 'scripts', 'lib', 'paths.mjs'), MODULE);
});

test('the export list is the old module\'s, name for name', () => {
  assert.deepEqual(Object.keys(mvp).sort(), Object.keys(old).sort());
  assert.deepEqual(Object.keys(mvp).sort(), ['ROOT_ENV', 'agentRoot', 'codeFile', 'codeRoot', 'ensureDir', 'isMain', 'repoRoot', 'runId', 'runsDir', 'safeName']);
});

test('safeName and runId behave like the old module and never put a colon in a name', () => {
  const names = ['Predictive rule 1', 'abc_DEF-1.2', 'a:b', 'C:\\temp\\x?*"<>|', `caf${E_ACUTE}`, `a${SMILE}b`, 'sha256:abc', 42, '', '.', '..', '...', '.hidden', 'a..b'];
  for (const n of names) assert.equal(mvp.safeName(n), old.safeName(n), String(n));
  assert.equal(mvp.safeName(''), '-');
  assert.equal(mvp.safeName('..'), '--');
  const dates = [new Date(Date.UTC(2026, 9, 13, 14, 15, 9)), new Date(Date.UTC(2026, 0, 2, 3, 4, 5)), new Date('2026-10-14T00:00:00+03:00')];
  for (const d of dates) assert.equal(mvp.runId('tag', d), old.runId('tag', d));
  assert.equal(mvp.runId('tag', dates[0]), '20261013T141509Z-tag');
  assert.equal(mvp.runId('a b:c/d'), mvp.runId('a-b-c-d'));
  assert.equal(mvp.runId('tag').includes(':'), false);
  assert.match(mvp.runId('tag'), /^\d{8}T\d{6}Z-tag$/);
});

test('ensureDir creates nested folders, is idempotent and returns the path', () => {
  const p = join(tmp(), 'a', 'b', 'c');
  assert.equal(mvp.ensureDir(p), p);
  assert.ok(statSync(p).isDirectory());
  assert.equal(mvp.ensureDir(p), p);
});

test('isMain: true for the script that node started, false otherwise', () => {
  const url = pathToFileURL(MODULE).href;
  assert.equal(mvp.isMain(url, MODULE), true);
  assert.equal(mvp.isMain(url, join(MODULE, '..', '..', 'lib', 'paths.mjs')), true, 'a path with .. segments is the same file');
  assert.equal(mvp.isMain(url, join(MODULE, '..', 'jsonl.mjs')), false);
  assert.equal(mvp.isMain(url, undefined), false);
  assert.equal(mvp.isMain(url, join(tmpdir(), 'does-not-exist.mjs')), false);
  if (process.platform === 'win32') {
    const flipped = MODULE[0] === MODULE[0].toLowerCase() ? MODULE[0].toUpperCase() + MODULE.slice(1) : MODULE[0].toLowerCase() + MODULE.slice(1);
    assert.equal(mvp.isMain(url, flipped), true, 'a different drive letter case is still the same file');
  }
});

test('the roots come from the module location, not from the working directory', () => {
  const code = `import { codeRoot, agentRoot, repoRoot } from ${JSON.stringify(pathToFileURL(MODULE).href)}; console.log(JSON.stringify([codeRoot(), agentRoot(), repoRoot()]));`;
  const env = { ...process.env };
  delete env[mvp.ROOT_ENV];
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: tmpdir(), encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [mvp.codeRoot(), mvp.codeRoot(), mvp.repoRoot()]);
});

test('the exit-codes shim is the old table itself (same object, frozen)', async () => {
  const shim = await import('../../agents/claim-tagger-mvp/scripts/lib/exit-codes.mjs');
  const oldCodes = await import('../../agents/claim-tagger/scripts/lib/exit-codes.mjs');
  assert.equal(shim.EXIT, oldCodes.EXIT);
  assert.equal(Object.isFrozen(shim.EXIT), true);
  assert.deepEqual({ ...shim.EXIT }, { OK: 0, ERROR: 1, INVALID: 2, PAUSED: 3, DRIFT: 4, TRUST: 5, HOLD: 10, FAIL: 11, USAGE_WINDOW: 75 });
  assert.equal(shim.describeExit, oldCodes.describeExit);
});
