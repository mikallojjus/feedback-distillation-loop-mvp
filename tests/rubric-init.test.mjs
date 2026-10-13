import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialRubric, main } from '../agents/claim-tagger/scripts/rubric-init.mjs';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { fileSha256 } from '../agents/claim-tagger/scripts/lib/hash.mjs';
import { readJson } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { agentRoot } from '../agents/claim-tagger/scripts/lib/paths.mjs';
import { checkHashes } from '../agents/claim-tagger/scripts/lib/rubric-build.mjs';
import { validate } from '../agents/claim-tagger/scripts/lib/validate.mjs';

const SCRIPT = fileURLToPath(new URL('../agents/claim-tagger/scripts/rubric-init.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/rubric.research-example.json', import.meta.url));
const fixture = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
const config = readJson(join(agentRoot(), 'config.json'));
const schema = readJson(join(agentRoot(), 'schemas', 'rubric.schema.json'));
const REPLACEMENTS = config.anonymise.replacements;

const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-init-'));
  roots.push(dir);
  return dir;
}
function run(args) {
  const out = [];
  const err = [];
  const code = main(args, { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out, err };
}
const tree = (dir) => readdirSync(dir, { recursive: true }).map((p) => p.replace(/\\/g, '/')).sort();
const NAMES = /(?<![\p{L}\p{N}_])(Moh|Mohammed|Yaniv|Arturas)(?![\p{L}\p{N}_])/u;

// ---- the pure part ----

test('initialRubric: names replaced by roles, version and source note set, every hash recomputed', () => {
  const f = fixture();
  const r = initialRubric(f, { replacements: REPLACEMENTS, version: '2026-10-13.1' });
  assert.equal(NAMES.test(JSON.stringify(r)), false);
  assert.equal(NAMES.test(JSON.stringify(f)), true, 'the fixture does contain names');
  assert.equal(r.rubric_version, '2026-10-13.1');
  assert.equal(r.source.note, 'copied from the 13 Oct research snapshot, names replaced by roles');
  assert.equal(r.source.notion_database, f.source.notion_database);
  assert.equal(r.changelog.length, 1);
  assert.equal(r.changelog[0].version, '2026-10-13.1');
  assert.equal(r.changelog[0].date, '2026-10-13');
  assert.equal(r.changelog[0].by, 'rubric-init');
  assert.deepEqual(checkHashes(r), { ok: true, mismatches: [] });
  assert.deepEqual(validate(schema, r), { ok: true, errors: [] });
  assert.match(JSON.stringify(r), /the editor judged factual/);
  assert.match(JSON.stringify(r), /operationalizes the team's rule that prediction claims/);
});

test('initialRubric: the scrub changes exactly the three tags that named someone; no rule text changes', () => {
  const f = fixture();
  const r = initialRubric(f, { replacements: REPLACEMENTS, version: '2026-10-13.1' });
  const changedTags = f.tags.filter((t, i) => t.tag_hash !== r.tags[i].tag_hash).map((t) => t.name);
  assert.deepEqual(changedTags, ['Factual', 'Multiple statements', 'Predictive']);
  assert.deepEqual(f.tags.flatMap((t) => t.when_to_use.rules.map((x) => x.rule_hash)), r.tags.flatMap((t) => t.when_to_use.rules.map((x) => x.rule_hash)));
  assert.notEqual(r.rubric_hash, f.rubric_hash);
  assert.equal(r.scope_hash, f.scope_hash, 'the judged scope names are unchanged');
  assert.deepEqual(r.scope, f.scope);
  assert.deepEqual(r.counterpart_pairs, f.counterpart_pairs);
  assert.deepEqual(r.tags.map((t) => t.name), f.tags.map((t) => t.name));
});

test('initialRubric does not modify its input', () => {
  const f = fixture();
  initialRubric(f, { replacements: REPLACEMENTS, version: '2026-10-13.1' });
  assert.deepEqual(f, fixture());
});

// ---- the script ----

test('rubric-init writes rubric.json, rubric.lock, CHANGELOG.md and history/<version>.json', () => {
  const dir = tmp();
  const r = run(['--rubric-dir', dir]);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.deepEqual(tree(dir), ['CHANGELOG.md', 'history', 'history/2026-10-13.1.json', 'rubric.json', 'rubric.lock']);

  const rubric = readJson(join(dir, 'rubric.json'));
  assert.equal(rubric.rubric_version, '2026-10-13.1');
  assert.deepEqual(checkHashes(rubric), { ok: true, mismatches: [] });
  assert.deepEqual(validate(schema, rubric), { ok: true, errors: [] });
  assert.equal(NAMES.test(readFileSync(join(dir, 'rubric.json'), 'utf8')), false);

  const lock = readJson(join(dir, 'rubric.lock'));
  assert.deepEqual(Object.keys(lock), ['rubric_version', 'rubric_hash', 'scope_hash', 'file_sha256', 'locked_at']);
  assert.equal(lock.rubric_version, rubric.rubric_version);
  assert.equal(lock.rubric_hash, rubric.rubric_hash);
  assert.equal(lock.scope_hash, rubric.scope_hash);
  assert.equal(lock.file_sha256, fileSha256(join(dir, 'rubric.json')));
  assert.match(lock.file_sha256, /^[0-9a-f]{64}$/);
  assert.equal(new Date(lock.locked_at).toISOString(), lock.locked_at);

  assert.equal(readFileSync(join(dir, 'history', '2026-10-13.1.json'), 'utf8'), readFileSync(join(dir, 'rubric.json'), 'utf8'));

  const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /^# Rubric changelog\n/);
  const lines = changelog.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith('- 2026-10-13.1 (2026-10-13), rubric-init:'));
  assert.ok(lines[0].includes(rubric.rubric_hash) && lines[0].includes(rubric.scope_hash));
  assert.equal(changelog.includes('\r'), false, 'LF line endings');
});

test('rubric-init prints one summary line with the version and the hashes', () => {
  const dir = tmp();
  const r = run(['--rubric-dir', dir]);
  assert.equal(r.out.length, 1);
  assert.deepEqual(r.err, []);
  const rubric = readJson(join(dir, 'rubric.json'));
  assert.match(r.out[0], /^rubric-init: wrote .*rubric\.json version 2026-10-13\.1 \(14 tags, 12 judged\)/);
  assert.ok(r.out[0].includes(`rubric_hash=${rubric.rubric_hash}`));
  assert.ok(r.out[0].includes(`scope_hash=${rubric.scope_hash}`));
  assert.equal(r.out[0].includes('\n'), false);
});

test('re-running without --force exits 2 and changes nothing', () => {
  const dir = tmp();
  assert.equal(run(['--rubric-dir', dir]).code, EXIT.OK);
  const before = { json: readFileSync(join(dir, 'rubric.json'), 'utf8'), lock: readFileSync(join(dir, 'rubric.lock'), 'utf8'), log: readFileSync(join(dir, 'CHANGELOG.md'), 'utf8') };
  const again = run(['--rubric-dir', dir]);
  assert.equal(again.code, EXIT.INVALID);
  assert.equal(again.code, 2);
  assert.match(again.err.join('\n'), /already exists.*nothing was changed.*--force/s);
  assert.deepEqual(again.out, []);
  assert.deepEqual(before, { json: readFileSync(join(dir, 'rubric.json'), 'utf8'), lock: readFileSync(join(dir, 'rubric.lock'), 'utf8'), log: readFileSync(join(dir, 'CHANGELOG.md'), 'utf8') });
});

test('--force replaces the files; the changelog keeps one line per version', () => {
  const dir = tmp();
  run(['--rubric-dir', dir]);
  const forced = run(['--rubric-dir', dir, '--force']);
  assert.equal(forced.code, EXIT.OK);
  assert.match(forced.out[0], /\(replaced version 2026-10-13\.1\)/);
  assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8').split('\n').filter((l) => l.startsWith('- ')).length, 1);
  assert.deepEqual(checkHashes(readJson(join(dir, 'rubric.json'))), { ok: true, mismatches: [] });
  assert.deepEqual(tree(dir), ['CHANGELOG.md', 'history', 'history/2026-10-13.1.json', 'rubric.json', 'rubric.lock']);
});

test('--force also replaces a rubric.json that cannot be read', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'rubric.json'), '{"half":');
  assert.equal(run(['--rubric-dir', dir]).code, EXIT.INVALID, 'still refused without --force');
  const r = run(['--rubric-dir', dir, '--force']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /\(replaced version unreadable file\)/);
  assert.deepEqual(checkHashes(readJson(join(dir, 'rubric.json'))), { ok: true, mismatches: [] });
});

test('--version sets the version everywhere and adds a changelog line and a history file', () => {
  const dir = tmp();
  run(['--rubric-dir', dir]);
  const r = run(['--rubric-dir', dir, '--force', '--version', '2026-10-14.1']);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(readJson(join(dir, 'rubric.json')).rubric_version, '2026-10-14.1');
  assert.equal(readJson(join(dir, 'rubric.lock')).rubric_version, '2026-10-14.1');
  assert.deepEqual(tree(join(dir, 'history')), ['2026-10-13.1.json', '2026-10-14.1.json']);
  const lines = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8').split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(lines.map((l) => l.split(' (')[0]), ['- 2026-10-13.1', '- 2026-10-14.1']);
  assert.equal(readJson(join(dir, 'rubric.json')).rubric_hash, readJson(join(dir, 'history', '2026-10-13.1.json')).rubric_hash, 'the version is not part of the hash');
});

test('--from reads another fixture', () => {
  const dir = tmp();
  const other = fixture();
  other.tags = other.tags.filter((t) => t.name !== 'Debate' && t.name !== 'Simple');
  other.counterpart_pairs = other.counterpart_pairs.filter(([a]) => a !== 'Debate');
  const from = join(dir, 'other.json');
  writeFileSync(from, JSON.stringify(other));
  const out = join(dir, 'out');
  const r = run(['--from', from, '--rubric-dir', out]);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  const rubric = readJson(join(out, 'rubric.json'));
  assert.equal(rubric.tag_count, 12);
  assert.equal(rubric.judged_count, 10);
  assert.deepEqual(checkHashes(rubric), { ok: true, mismatches: [] });
});

test('bad arguments exit 2 with a usage line and write nothing', () => {
  const dir = tmp();
  for (const args of [['--bogus'], ['--version'], ['--from'], ['--version', '2026-10-13'], ['--version', 'v1'], ['positional']]) {
    const r = run([...args, '--rubric-dir', join(dir, 'x')]);
    assert.equal(r.code, EXIT.INVALID, args.join(' '));
    assert.match(r.err.join('\n'), /rubric-init:/);
  }
  assert.equal(existsSync(join(dir, 'x')), false);
  for (const bad of ['2026-10-13', 'v1', '2026-10-13.', '2026-10-13.1.2', '']) {
    assert.match(run(['--version', bad, '--rubric-dir', join(dir, 'x')]).err.join('\n'), /is not YYYY-MM-DD\.n|needs a value/, `version "${bad}"`);
  }
  const help = run(['--help']);
  assert.equal(help.code, EXIT.OK);
  assert.match(help.out[0], /usage: node agents\/claim-tagger\/scripts\/rubric-init\.mjs/);
});

test('a name that survives the scrub is refused and nothing is written', () => {
  const dir = tmp();
  const cfg = join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify({ anonymise: { replacements: [['Moh', 'Moh-the-editor']] } }));
  const out = join(dir, 'out');
  const r = run(['--config', cfg, '--rubric-dir', out]);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /the name "Moh" is still in the rubric/);
  assert.equal(existsSync(join(out, 'rubric.json')), false);
});

test('a config without an anonymise.replacements list is refused; an explicit empty list is allowed', () => {
  const dir = tmp();
  const cfg = join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify({ agent: 'x' }));
  const refused = run(['--config', cfg, '--rubric-dir', join(dir, 'out')]);
  assert.equal(refused.code, EXIT.INVALID);
  assert.match(refused.err.join('\n'), /anonymise\.replacements/);
  assert.equal(existsSync(join(dir, 'out', 'rubric.json')), false);
  writeFileSync(cfg, JSON.stringify({ anonymise: { replacements: [] } }));
  const allowed = run(['--config', cfg, '--rubric-dir', join(dir, 'out')]);
  assert.equal(allowed.code, EXIT.OK, allowed.err.join('\n'));
  assert.equal(readJson(join(dir, 'out', 'rubric.json')).rubric_hash, fixture().rubric_hash, 'nothing replaced, so the research hash is kept');
});

test('a fixture whose hashes are inconsistent after the copy is refused', () => {
  const dir = tmp();
  const broken = fixture();
  broken.tags[0].polarity = 'Neutral'; // not allowed by the schema
  const from = join(dir, 'broken.json');
  writeFileSync(from, JSON.stringify(broken));
  const r = run(['--from', from, '--rubric-dir', join(dir, 'out')]);
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /polarity/);
  assert.equal(existsSync(join(dir, 'out', 'rubric.json')), false);
});

test('a missing fixture is an error (exit 1) and writes nothing', () => {
  const dir = tmp();
  const r = run(['--from', join(dir, 'nope.json'), '--rubric-dir', join(dir, 'out')]);
  assert.equal(r.code, EXIT.ERROR);
  assert.match(r.err.join('\n'), /nope\.json/);
  assert.equal(existsSync(join(dir, 'out')), false);
});

test('run as a real command: exit 0, then exit 2 on a second run, one line each', () => {
  const dir = tmp();
  const first = spawnSync(process.execPath, [SCRIPT, '--rubric-dir', dir], { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim().split('\n').length, 1);
  assert.equal(first.stderr, '');
  assert.ok(existsSync(join(dir, 'rubric.json')));
  const second = spawnSync(process.execPath, [SCRIPT, '--rubric-dir', dir], { encoding: 'utf8' });
  assert.equal(second.status, 2);
  assert.match(second.stderr, /already exists/);
  const forced = spawnSync(process.execPath, [SCRIPT, '--rubric-dir', dir, '--force'], { encoding: 'utf8' });
  assert.equal(forced.status, 0, forced.stderr);
});

// ---- the committed output ----

test('the generated rubric in agents/claim-tagger/rubric passes checkHashes, the schema and the lock', () => {
  const dir = join(agentRoot(), 'rubric');
  const path = join(dir, 'rubric.json');
  assert.ok(existsSync(path), 'run node agents/claim-tagger/scripts/rubric-init.mjs once');
  const rubric = readJson(path);
  assert.deepEqual(checkHashes(rubric), { ok: true, mismatches: [] });
  assert.deepEqual(validate(schema, rubric), { ok: true, errors: [] });
  assert.equal(NAMES.test(readFileSync(path, 'utf8')), false, 'no personal names');
  assert.match(rubric.source.note, /names replaced by roles/);
  assert.equal(rubric.tag_count, 14);
  assert.equal(rubric.judged_count, 12);

  const lock = readJson(join(dir, 'rubric.lock'));
  assert.equal(lock.rubric_version, rubric.rubric_version);
  assert.equal(lock.rubric_hash, rubric.rubric_hash);
  assert.equal(lock.scope_hash, rubric.scope_hash);
  assert.equal(lock.file_sha256, fileSha256(path), 'rubric.json is exactly the file that was locked');

  assert.equal(readFileSync(join(dir, 'history', `${rubric.rubric_version}.json`), 'utf8'), readFileSync(path, 'utf8'));
  assert.ok(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8').includes(`- ${rubric.rubric_version} (`));
  assert.ok(statSync(join(dir, 'history')).isDirectory());
});

test('the generated rubric keeps every rule hash of the research rubric (only tag and rubric hashes moved)', () => {
  const rubric = readJson(join(agentRoot(), 'rubric', 'rubric.json'));
  const f = fixture();
  if (rubric.rubric_version !== f.rubric_version) return; // a later version has legitimately changed rules
  assert.deepEqual(rubric.tags.flatMap((t) => t.when_to_use.rules.map((x) => x.rule_hash)), f.tags.flatMap((t) => t.when_to_use.rules.map((x) => x.rule_hash)));
  assert.equal(rubric.scope_hash, f.scope_hash);
});
