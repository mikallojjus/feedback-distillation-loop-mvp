import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as distillMain } from '../../agents/claim-tagger-mvp/scripts/distill.mjs';
import { main as followupMain } from '../../agents/claim-tagger-mvp/scripts/followup.mjs';
import { main as promoteMain } from '../../agents/claim-tagger-mvp/scripts/promote.mjs';
import { main as proposeMain } from '../../agents/claim-tagger-mvp/scripts/propose.mjs';
import { main as restoreMain } from '../../agents/claim-tagger-mvp/scripts/restore.mjs';
import { main as rollbackMain } from '../../agents/claim-tagger-mvp/scripts/rollback.mjs';
import { main as statusMain } from '../../agents/claim-tagger-mvp/scripts/status.mjs';
import { readJson } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { makeWorld, quietIo, claimText } from './helpers/loop-world.mjs';
import { TITLE, promoteWorld } from './helpers/promote-scenario.mjs';

const SCRIPTS_DIR = fileURLToPath(new URL('../../agents/claim-tagger-mvp/scripts/', import.meta.url));
// main(argv, io, deps) takes the hooks of the tests as its third argument; the flags of the command line win over them
const deps = (w) => {
  const { io: _io, ...rest } = w.hooks();
  return rest;
};

test('every loop script starts from the command line and prints its usage for --help, with exit 0', () => {
  for (const name of ['propose', 'distill', 'promote', 'followup', 'rollback', 'restore', 'status']) {
    const r = spawnSync(process.execPath, [join(SCRIPTS_DIR, `${name}.mjs`), '--help'], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    assert.match(r.stdout, new RegExp(`usage: node agents/claim-tagger-mvp/scripts/${name}\\.mjs`), name);
  }
  const bad = spawnSync(process.execPath, [join(SCRIPTS_DIR, 'promote.mjs'), '--nope'], { encoding: 'utf8', windowsHide: true });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown option/i);
});

test('propose from the command line: --pull, --plan-only, --driver and --run-id reach the run', async () => {
  const w = await makeWorld({ claims: 4 });
  w.table(Object.fromEntries([1, 2, 3, 4].map((i) => [claimText(i), { decision: 'do_not_apply', p: 0.1 }])));
  await w.judge();
  const pulled = await w.pull();
  const io = quietIo();
  const code = await proposeMain(['--pull', pulled.pullId, '--plan-only', '--driver', 'fake', '--run-id', 'my-propose'], io, deps(w));
  assert.equal(code, 0, io.errs.join('\n'));
  assert.ok(existsSync(join(w.root, 'runs', 'my-propose', 'plan.jsonl')));
  assert.equal(readJson(join(w.root, 'runs', 'my-propose', 'run.json')).pull_id, pulled.pullId);
  assert.equal(w.writes().length, 0);
  assert.match(io.outs.join('\n'), /^Tag: the plan is ready/);
  const again = quietIo();
  assert.equal(await proposeMain(['--run-id', 'my-propose', '--driver', 'fake'], again, deps(w)), 2, 'a run folder that exists is not reused');
  assert.match(again.errs.join('\n'), /a run folder named my-propose already exists/);
});

test('distill, promote, followup, rollback, restore and status from the command line, with their flags', async () => {
  const w = await promoteWorld({ open: 1 });
  const io = quietIo();
  assert.equal(await distillMain(['--rows', '5', '--plan-only', '--run-id', 'cli-distill', '--driver', 'fake'], io, deps(w)), 0, io.errs.join('\n'));
  assert.ok(existsSync(join(w.root, 'runs', 'cli-distill', 'plan.jsonl')));

  const p = quietIo();
  assert.equal(await promoteMain(['--lesson', TITLE, '--runs-max', '3', '--no-commit', '--driver', 'fake', '--run-id', 'cli-promote'], p, deps(w)), 0, p.errs.join('\n'));
  assert.equal(readJson(join(w.root, 'runs', 'cli-promote', 'run.json')).lesson, TITLE);
  assert.equal(w.rubric().edition, '2026-10-16.2');

  const f = quietIo();
  assert.equal(await followupMain(['--lesson', TITLE, '--driver', 'fake'], f, deps(w)), 0, f.errs.join('\n'));

  const s = quietIo();
  assert.equal(await statusMain(['--json'], s, deps(w)), 0, s.errs.join('\n'));
  assert.equal(JSON.parse(s.outs.join('\n')).edition, '2026-10-16.2');

  const rb0 = quietIo();
  assert.equal(await rollbackMain(['--lesson', TITLE], rb0, deps(w)), 2, 'without --confirm');
  assert.equal(w.rubric().edition, '2026-10-16.2');
  const rb = quietIo();
  assert.equal(await rollbackMain(['--lesson', TITLE, '--confirm', '--no-commit'], rb, deps(w)), 0, rb.errs.join('\n'));
  assert.equal(w.rubric().edition, '2026-10-16.3');

  const list = quietIo();
  assert.equal(await restoreMain(['--list'], list, deps(w)), 0);
  assert.match(list.outs.join('\n'), /2026-10-16\.3 \(in force\)  rolled back/);
  const re = quietIo();
  assert.equal(await restoreMain(['--edition', '2026-10-16.2', '--confirm', '--no-commit'], re, deps(w)), 0, re.errs.join('\n'));
  assert.equal(w.rubric().edition, '2026-10-16.4');
  assert.ok(readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8').includes('restored from 2026-10-16.2'));
});
