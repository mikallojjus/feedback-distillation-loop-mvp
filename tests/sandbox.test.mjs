import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { readJsonl } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { ROOT_ENV, codeFile, codeRoot } from '../agents/claim-tagger/scripts/lib/paths.mjs';
import { checkHashes } from '../agents/claim-tagger/scripts/lib/rubric-build.mjs';
import { SCRIPTS, init, main, sandboxRubric, sandboxSeed } from '../agents/claim-tagger/scripts/sandbox.mjs';

const PATHS = fileURLToPath(new URL('../agents/claim-tagger/scripts/lib/paths.mjs', import.meta.url));
const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-sandbox-'));
  roots.push(dir);
  return dir;
}
const captureIo = () => {
  const out = [];
  const err = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s) } };
};
const trialRubric = () => JSON.parse(readFileSync(join(codeRoot(), 'rubric', 'rubric.json'), 'utf8'));

test('CLAIM_TAGGER_ROOT moves the state root, never the code root or the repository root', () => {
  const elsewhere = tmp();
  const probe = `import(${JSON.stringify(new URL(`file:///${PATHS.replace(/\\/g, '/')}`).href)}).then((m) => console.log(JSON.stringify({ a: m.agentRoot(), c: m.codeRoot(), r: m.repoRoot(), runs: m.runsDir() })))`;
  const run = (env) => JSON.parse(spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', env: { ...process.env, ...env } }).stdout);
  const plain = run({ [ROOT_ENV]: '' });
  assert.equal(plain.a, plain.c);
  const moved = run({ [ROOT_ENV]: elsewhere });
  assert.equal(moved.a, resolve(elsewhere));
  assert.equal(moved.c, plain.c);
  assert.equal(moved.r, plain.r, 'the .env is always found from the code');
  assert.equal(moved.runs, join(resolve(elsewhere), 'runs'));
});

test('codeFile prefers the root\'s own copy and falls back to the agent folder', () => {
  const root = tmp();
  assert.equal(codeFile(root, 'schemas', 'judgment.schema.json'), join(codeRoot(), 'schemas', 'judgment.schema.json'));
  mkdirSync(join(root, 'prompts'));
  writeFileSync(join(root, 'prompts', 'judge.md'), 'x');
  assert.equal(codeFile(root, 'prompts', 'judge.md'), join(root, 'prompts', 'judge.md'));
});

test('sandboxRubric keeps only the listed tags, unchanged, and rehashes the rest', () => {
  const trial = trialRubric();
  const r = sandboxRubric(trial, { tags: ['Hypothetical', 'Predictive'], version: '2026-10-14.1', date: '2026-10-14' });
  assert.deepEqual(r.tags.map((t) => t.name), ['Hypothetical', 'Predictive']);
  assert.deepEqual(r.scope, ['Hypothetical', 'Predictive']);
  assert.equal(checkHashes(r).ok, true);
  for (const t of r.tags) assert.equal(t.tag_hash, trial.tags.find((x) => x.name === t.name).tag_hash, `${t.name} is the trial's tag`);
  assert.notEqual(r.rubric_hash, trial.rubric_hash);
  assert.deepEqual(r.counterpart_pairs, []);
  assert.throws(() => sandboxRubric(trial, { tags: ['Nope'], version: '2026-10-14.1', date: '2026-10-14' }), /no tag Nope/);
});

test('sandboxSeed: decided rows carry Seeded outcome Applies, open rows carry no outcome and no proposal', () => {
  const spec = { tags: ['Predictive'], rubric_version: '2026-10-14.1', decided: ['g1::Predictive'], open: ['g2::Predictive'], open_note: 'decide it' };
  const claims = [{ geo_id: 'g1', claim: 'X will happen' }, { geo_id: 'g2', claim: 'Y is likely to do Z' }];
  const decisions = [{ key: 'g1::Predictive', geo_id: 'g1', tag: 'Predictive', agent_proposal: 'Do not add tag', why_in_queue: 'Auditor flag', priority: 'High', rubric_version: 'audit', seeded_outcome: null }];
  const cases = [{ key: 'g1::Predictive', expected: 'apply' }];
  const s = sandboxSeed({ claims, decisions, cases, spec });
  assert.equal(s.claims.length, 2);
  const [decided, open] = s.decisions;
  assert.equal(decided.seeded_outcome, 'Applies');
  assert.equal(decided.why_in_queue, 'Seeded decision');
  assert.equal(open.seeded_outcome, null);
  assert.equal(open.agent_proposal, null);
  assert.equal(open.why_in_queue, 'Auditor flag');
  assert.equal(open.why_i_recommend_this, 'decide it');
  assert.throws(() => sandboxSeed({ claims, decisions, cases: [{ key: 'g1::Predictive', expected: 'do_not_apply' }], spec }), /does not label it Applies/);
  assert.throws(() => sandboxSeed({ claims, decisions, cases, spec: { ...spec, open: ['g2::Hypothetical'] } }), /not a sandbox tag/);
});

test('init builds the sandbox files from the trial and refuses to overwrite them without --force', () => {
  const root = tmp();
  cpSync(join(codeRoot(), 'sandbox', 'walkthrough.json'), join(root, 'walkthrough.json'));
  const line = init({ root });
  assert.match(line, /rubric 2026-10-14\.1 \(Hypothetical, Predictive/);
  for (const f of ['rubric/rubric.json', 'rubric/rubric.lock', 'rubric/CHANGELOG.md', 'rubric/history/2026-10-14.1.json', 'evals/canaries.jsonl', 'evals/cases.jsonl', 'evals/seed/claims.seed.jsonl', 'evals/seed/decisions.seed.jsonl']) assert.ok(existsSync(join(root, f)), f);
  const canaries = readJsonl(join(root, 'evals', 'canaries.jsonl')).rows;
  assert.ok(canaries.length > 0 && canaries.every((c) => ['Hypothetical', 'Predictive'].includes(c.tag)));
  const seed = readJsonl(join(root, 'evals', 'seed', 'decisions.seed.jsonl')).rows;
  assert.equal(seed.filter((r) => r.seeded_outcome === 'Applies').length, 9);
  assert.equal(seed.filter((r) => !r.seeded_outcome).length, 4);
  assert.throws(() => init({ root }), /already exists/);
  assert.match(init({ root, force: true }), /13 claims/);
});

test('a script run sets CLAIM_TAGGER_ROOT for the child only; unknown scripts and a missing config are refused', () => {
  const root = tmp();
  const c = captureIo();
  assert.equal(main(['status', '--check'], c.io, { root }), EXIT.INVALID, 'no config.json yet');
  assert.match(c.err.join('\n'), /not set up/);
  writeFileSync(join(root, 'config.json'), '{}');
  let seen;
  const spawn = (bin, args, opts) => {
    seen = { bin, args, env: opts.env };
    return { status: 7 };
  };
  assert.equal(main(['status', '--check'], c.io, { root, spawn }), 7, 'the script\'s own exit code');
  assert.equal(seen.env[ROOT_ENV], root);
  assert.equal(process.env[ROOT_ENV], undefined, 'the parent environment is untouched');
  assert.ok(seen.args[0].endsWith(join('scripts', 'status.mjs')));
  assert.deepEqual(seen.args.slice(1), ['--check']);
  const u = captureIo();
  assert.equal(main(['rubric-init'], u.io, { root, spawn }), EXIT.INVALID);
  assert.match(u.err.join('\n'), /not a walkthrough script/);
  assert.ok(!SCRIPTS.has('snapshot') && SCRIPTS.has('promote'));
  assert.equal(main([], captureIo().io), EXIT.INVALID);
});
