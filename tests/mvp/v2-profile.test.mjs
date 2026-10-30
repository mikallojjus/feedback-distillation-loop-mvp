// The v2 profile (a second Notion page with its own five tables, beside the live one): its config builder, its config shape, the protected lists, the root step of setup.mjs, and the
// refusal of every loop script on a v2 root until the loop is ported (checkpoint 3). No network: Notion is the in-memory fake.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { V2_REFUSAL, isProtected, isV2, loadConfig, validateConfig } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import { buildV2Config, completeStructure, liveIds } from '../../agents/claim-tagger-mvp/scripts/lib/v2-profile.mjs';
import { HUB_LINK_TEXT, hubPlan, optionColor, validateStructure } from '../../agents/claim-tagger-mvp/scripts/lib/notion-build.mjs';
import { main as v2Main } from '../../agents/claim-tagger-mvp/scripts/v2-profile.mjs';
import { checkPlan, newPlan } from '../../agents/claim-tagger-mvp/scripts/lib/plan.mjs';
import { normId } from '../../agents/claim-tagger-mvp/scripts/lib/notion-values.mjs';
import { buildDemoConfig } from '../../agents/claim-tagger-mvp/scripts/lib/demo-profile.mjs';
import { main as statusMain } from '../../agents/claim-tagger-mvp/scripts/status.mjs';
import { main as decideMain } from '../../agents/claim-tagger-mvp/scripts/decide.mjs';
import { main as addMain } from '../../agents/claim-tagger-mvp/scripts/add.mjs';
import { main as proposeMain } from '../../agents/claim-tagger-mvp/scripts/propose.mjs';
import { main as distillMain } from '../../agents/claim-tagger-mvp/scripts/distill.mjs';
import { main as promoteMain } from '../../agents/claim-tagger-mvp/scripts/promote.mjs';
import { main as followupMain } from '../../agents/claim-tagger-mvp/scripts/followup.mjs';
import { main as rollbackMain } from '../../agents/claim-tagger-mvp/scripts/rollback.mjs';
import { main as restoreMain } from '../../agents/claim-tagger-mvp/scripts/restore.mjs';
import { main as pullMain, pull } from '../../agents/claim-tagger-mvp/scripts/pull.mjs';
import { main as judgeMain } from '../../agents/claim-tagger-mvp/scripts/judge.mjs';
import { main as walkthroughMain } from '../../agents/claim-tagger-mvp/scripts/walkthrough.mjs';
import { builtConfig, placeholderConfig } from './helpers/config-fixture.mjs';
import { NOW, builderClient, cleanTmp, noSleep, tmp } from './helpers/setup-world.mjs';
import { main as setupMain } from '../../agents/claim-tagger-mvp/scripts/setup.mjs';
import { createFakeNotion } from './fixtures/fake-notion.mjs';
import { createPagesFake } from './fixtures/fake-notion-pages.mjs';

after(cleanTmp);

const HUB = '3fa273e2-14eb-8051-99f3-d12ef01db453';

/** The live config as the tests know it: the committed fixture with every placeholder replaced by an id, a hub, two live pages and the live views. */
function production() {
  const c = builtConfig();
  c.notion.parent_page_id = HUB;
  c.notion.pages.onboarding = '406273e214eb81a881dcd1480c5d015e';
  c.notion.pages.archive = '406273e214eb81a78c2def55287e4b67';
  c.notion.views = {
    your_queue: { id: '406273e214eb81a3993c000c78850705', url: 'https://www.notion.so/x?v=406273e214eb81a3993c000c78850705' },
    lessons_waiting: { id: '406273e214eb81fa8c8d000c20b953ba', url: 'https://www.notion.so/y?v=406273e214eb81fa8c8d000c20b953ba' },
  };
  return c;
}
const v2 = () => buildV2Config(production());
const problems = (c) => validateConfig(c).errors;

// ---- buildV2Config ---------------------------------------------------------------------------------------------------------------

test('buildV2Config: the profile marker, the live hub as root parent, placeholders for the new page and tables', () => {
  const c = v2();
  assert.equal(c.profile, 'v2');
  assert.equal(isV2(c), true);
  assert.equal(c.notion.root_parent_page_id, HUB);
  assert.equal(c.notion.parent_page_id, '<setup>');
  assert.deepEqual(c.notion.setup_page_parents, ['<setup>']);
  for (const t of [c.notion.rulebook, c.notion.claims, ...Object.values(c.notion.databases)]) {
    assert.equal(t.database_id, '<setup>');
    assert.equal(t.data_source_id, '<setup>');
  }
  assert.deepEqual(c.notion.views, {});
  assert.deepEqual(Object.keys(c.notion.pages).sort(), ['archive', 'demo_tests', 'demos', 'onboarding', 'proposal']);
  assert.ok(Object.values(c.notion.pages).every((p) => p.startsWith('<')));
  assert.deepEqual(problems(c), []);
});

test('buildV2Config: every live id is protected (five tables, both ids; views; Onboarding; Archive) and the live hub is not', () => {
  const p = production();
  const c = buildV2Config(p);
  const live = liveIds(p);
  assert.equal(live.tables.length, 10);
  assert.equal(live.views.length, 2);
  assert.equal(live.pages.length, 2);
  for (const id of [...live.tables, ...live.views, ...live.pages]) assert.equal(isProtected(c, id), true, id);
  assert.equal(isProtected(c, HUB), false);
  // production's own lists are still there
  for (const id of [...p.notion.protected_database_ids, ...p.notion.protected_page_ids]) assert.equal(isProtected(c, id), true, id);
  // a hub that production had in its lists is taken out again
  const withHub = production();
  withHub.notion.protected_page_ids.push(HUB.replace(/-/g, '').toUpperCase());
  assert.equal(isProtected(buildV2Config(withHub), HUB), false);
  // no id twice
  const all = [...c.notion.protected_database_ids, ...c.notion.protected_page_ids].map(normId);
  assert.equal(new Set(c.notion.protected_database_ids.map(normId)).size, c.notion.protected_database_ids.length);
  assert.ok(all.length > 0);
});

test('buildV2Config: Claims has no editor column; Tag decisions has Agent is right, Tag outcome and Your note; the other editor columns stay', () => {
  const p = production();
  const c = buildV2Config(p);
  assert.deepEqual(c.editor_columns.claims, []);
  assert.deepEqual(c.editor_columns.tag_decisions, ['Agent is right', 'Tag outcome', 'Your note']);
  assert.deepEqual(c.editor_columns.rule_changes, p.editor_columns.rule_changes);
  assert.deepEqual(c.editor_columns.rule_changes_status_editor_values, p.editor_columns.rule_changes_status_editor_values);
  assert.deepEqual(c.editor_columns.agent_settings, p.editor_columns.agent_settings);
  for (const k of ['verified', 'review_status', 'notes']) assert.equal(Object.hasOwn(c.notion.claims.columns, k), false);
  assert.deepEqual(Object.keys(c.notion.claims.columns).sort(), ['claim', 'is_factual', 'link', 'sources']);
  assert.deepEqual(c.notion.claims.write_columns, p.notion.claims.write_columns);
  assert.equal(c.notion.claims.key, p.notion.claims.key);
});

test('buildV2Config does not change production, and refuses a demo or a v2 config as its input', () => {
  const p = production();
  const before = JSON.stringify(p);
  buildV2Config(p);
  assert.equal(JSON.stringify(p), before);
  assert.throws(() => buildV2Config(v2()), /production config/);
  const demo = buildDemoConfig(p, { demoId: 'x', title: 'T', parentId: '5e7a0000-0000-4000-8000-0000000000ff', tag: 'Context-dependent' });
  assert.throws(() => buildV2Config(demo), /production config/);
});

// ---- validateConfig ----------------------------------------------------------------------------------------------------------------

test('validateConfig accepts v2, production and a demo config', () => {
  assert.deepEqual(problems(v2()), []);
  assert.deepEqual(problems(production()), []);
  const demo = buildDemoConfig(production(), { demoId: 'x', title: 'T', parentId: '5e7a0000-0000-4000-8000-0000000000ff', tag: 'Context-dependent' });
  assert.deepEqual(problems(demo), []);
  // once the root step has run
  const done = v2();
  done.notion.parent_page_id = '5e7a0000-0000-4000-8000-0000000000aa';
  done.notion.setup_page_parents = [done.notion.parent_page_id];
  assert.deepEqual(problems(done), []);
});

test('validateConfig rejects a v2 config whose root parent is protected, is missing or is not an id', () => {
  const c = v2();
  c.notion.protected_page_ids.push(c.notion.root_parent_page_id);
  assert.ok(problems(c).some((m) => m.startsWith('notion.root_parent_page_id') && /protected/.test(m)), problems(c).join('\n'));
  const dashed = v2();
  dashed.notion.protected_database_ids.push(HUB.toUpperCase());
  assert.ok(problems(dashed).some((m) => /root_parent_page_id.*protected/.test(m)));
  const none = v2();
  delete none.notion.root_parent_page_id;
  assert.ok(problems(none).some((m) => m.startsWith('notion.root_parent_page_id')));
  const placeholder = v2();
  placeholder.notion.root_parent_page_id = '<setup>';
  assert.ok(problems(placeholder).some((m) => m.startsWith('notion.root_parent_page_id')));
});

test('validateConfig rejects a v2 config with an editor column on Claims, without the Tag decisions columns, or with an unknown profile', () => {
  const a = v2();
  a.editor_columns.claims = ['Review status'];
  assert.ok(problems(a).some((m) => m.startsWith('editor_columns.claims')));
  const b = v2();
  b.notion.claims.columns.verified = 'Verified tags';
  assert.ok(problems(b).some((m) => m.startsWith('notion.claims.columns.verified')));
  const c = v2();
  delete c.editor_columns.tag_decisions;
  assert.ok(problems(c).some((m) => m.startsWith('editor_columns.tag_decisions')));
  const d = v2();
  d.editor_columns.tag_decisions = ['Tag outcome'];
  assert.ok(problems(d).some((m) => /Your note/.test(m)));
  const e = v2();
  e.profile = 'v3';
  assert.ok(problems(e).some((m) => m.startsWith('profile')));
});

test('a production config still needs its three Claims editor columns and a real parent page (the v2 allowances do not leak)', () => {
  const a = production();
  delete a.notion.claims.columns.verified;
  assert.ok(problems(a).some((m) => m.startsWith('notion.claims.columns.verified')));
  const b = production();
  b.notion.parent_page_id = '<setup>';
  assert.ok(problems(b).some((m) => m.startsWith('notion.parent_page_id')));
  const c = production();
  c.notion.setup_page_parents = ['<setup>'];
  assert.ok(problems(c).some((m) => m.startsWith('notion.setup_page_parents')));
});

// ---- the plan check ----------------------------------------------------------------------------------------------------------------

test('checkPlan with a v2 config refuses a write to any live table, data source, view or page id (in a value, a key or a page id), and passes an ordinary plan', () => {
  const p = production();
  const c = buildV2Config(p);
  const live = liveIds(p);
  const root = tmp('plan');
  const fresh = () => newPlan({ runId: 'r1', script: 'propose', config: c });
  const PAGE = '5e7a0000-0000-4000-8000-000000000999';
  const clean = fresh();
  clean.update('tag_decisions', 'K', PAGE, { 'Agent reason': 'fine' });
  assert.deepEqual(checkPlan(clean, c, { root }).problems, []);
  const ids = [...live.tables, ...live.views, ...live.pages];
  assert.ok(ids.length >= 14);
  for (const id of ids) {
    const inValue = fresh();
    inValue.update('tag_decisions', 'K', PAGE, { 'Agent reason': `see ${id}` });
    assert.ok(checkPlan(inValue, c, { root }).problems.some((m) => /protected id/.test(m)), `value ${id}`);
    const asPage = fresh();
    asPage.update('tag_decisions', 'K', id, { 'Agent reason': 'x' });
    assert.ok(checkPlan(asPage, c, { root }).problems.some((m) => /protected id/.test(m)), `page ${id}`);
  }
  // a live table can never be one of v2's own tables
  const own = structuredClone(c);
  own.notion.databases.tag_decisions.database_id = live.tables[0];
  assert.ok(checkPlan(clean, own, { root }).problems.some((m) => /protected lists of config.json/.test(m)));
});

// ---- the CLI that writes the config ------------------------------------------------------------------------------------------------

test('v2-profile init writes a valid config, refuses to overwrite it without --replace, and --replace writes it again', () => {
  const root = tmp('v2cli');
  const out = [];
  const err = [];
  const io = { out: (s) => out.push(s), err: (s) => err.push(s) };
  const env = { root: join(root, 'profiles', 'v2'), production: production() };
  assert.equal(v2Main(['init'], io, env), 0, err.join('\n'));
  const file = join(root, 'profiles', 'v2', 'config.json');
  assert.ok(existsSync(file));
  assert.equal(loadConfig(join(root, 'profiles', 'v2')).profile, 'v2');
  writeFileSync(file, readFileSync(file, 'utf8').replace('"profile": "v2"', '"profile": "v2", "marker": 1'));
  assert.equal(v2Main(['init'], io, env), 2);
  assert.match(err.join('\n'), /exists/);
  assert.match(readFileSync(file, 'utf8'), /"marker": 1/);
  assert.equal(v2Main(['init', '--replace'], io, env), 0);
  assert.doesNotMatch(readFileSync(file, 'utf8'), /"marker"/);
  assert.equal(v2Main(['bogus'], io, env), 2);
});

// ---- setup.mjs root ----------------------------------------------------------------------------------------------------------------

/** A v2 state folder, a fake with the live hub page (and live tables that must stay untouched), and a way to run setup.mjs on them. */
function v2World({ hubTitle = 'Claim tagger', structure = true } = {}) {
  const root = tmp('v2root');
  const fake = createPagesFake({ protected: [] });
  const hub = fake.addPage({ title: hubTitle });
  const prod = production();
  prod.notion.parent_page_id = hub;
  prod.notion.requests_per_second = 1000;
  const config = buildV2Config(prod);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  if (structure) {
    mkdirSync(join(root, 'setup'), { recursive: true });
    const s = JSON.parse(readFileSync(join(process.cwd(), 'agents', 'claim-tagger-mvp', 'setup', 'structure.json'), 'utf8'));
    s.hub = { ...s.hub, title: 'Claim tagger v2' };
    writeFileSync(join(root, 'setup', 'structure.json'), `${JSON.stringify(s, null, 2)}\n`);
  }
  const env = { root, fetchImpl: fake.fetchImpl, token: fake.token, sleep: noSleep, now: NOW, repoRoot: root };
  const run = async (argv) => {
    const out = [];
    const err = [];
    const code = await setupMain(argv, { out: (s) => out.push(s), err: (s) => err.push(s) }, env);
    return { code, out, err, text: [...out, ...err].join('\n') };
  };
  return { root, fake, hub, config, env, run, read: () => JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')) };
}
const open = (w) => w.run(['builder', 'open', '--reason', 'v2 root test']);

test('root: creates the v2 page under the live hub, records it in config.json, logs the requests, and a second run adopts it and changes nothing', async () => {
  const w = v2World();
  assert.equal((await open(w)).code, 0);
  const r = await w.run(['root']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /was made/);
  const c = w.read();
  const kids = w.fake.entries(w.hub).filter((e) => e.kind === 'child_page');
  assert.equal(kids.length, 1);
  assert.equal(kids[0].text, 'Claim tagger v2');
  assert.equal(normId(c.notion.parent_page_id), normId(kids[0].id));
  assert.deepEqual(c.notion.setup_page_parents, [c.notion.parent_page_id]);
  assert.equal(c.notion.root_parent_page_id, w.hub);
  assert.deepEqual(validateConfig(c).errors, []);
  assert.equal(isProtected(c, c.notion.parent_page_id), false);
  const log = readFileSync(join(w.root, 'runs', 'builder', 'requests.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(log.some((l) => l.method === 'POST' && /\/pages$/.test(l.path)));
  assert.ok(log.some((l) => l.method === 'GET'));
  const before = readFileSync(join(w.root, 'config.json'), 'utf8');
  const again = await w.run(['root']);
  assert.equal(again.code, 0, again.text);
  assert.match(again.text, /was found/);
  assert.match(again.text, /nothing changed/);
  assert.equal(readFileSync(join(w.root, 'config.json'), 'utf8'), before);
  assert.equal(w.fake.entries(w.hub).filter((e) => e.kind === 'child_page').length, 1);
});

test('root: adopts a page of that title that is already under the live hub (an earlier try that stopped before config.json was written)', async () => {
  const w = v2World();
  await open(w);
  const made = (await builderClient(w.fake).createPageUnderPage({ parentPageId: w.hub, title: 'Claim tagger v2' })).id;
  const r = await w.run(['root']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /was found/);
  assert.equal(normId(w.read().notion.parent_page_id), normId(made));
});

test('root: --title stands in when there is no structure; with neither the step stops', async () => {
  const none = v2World({ structure: false });
  await open(none);
  const r = await none.run(['root']);
  assert.equal(r.code, 2);
  assert.match(r.text, /--title/);
  assert.equal(none.read().notion.parent_page_id, '<setup>');
  const ok = await none.run(['root', '--title', 'Claim tagger v2 (test)']);
  assert.equal(ok.code, 0, ok.text);
  assert.equal(none.fake.entries(none.hub)[0].text, 'Claim tagger v2 (test)');
});

test('root: refuses a config that already names another v2 page, without writing anything', async () => {
  const w = v2World();
  await open(w);
  assert.equal((await w.run(['root'])).code, 0);
  const c = w.read();
  const other = '5e7a0000-0000-4000-8000-0000000000bb';
  c.notion.parent_page_id = other;
  c.notion.setup_page_parents = [other];
  writeFileSync(join(w.root, 'config.json'), `${JSON.stringify(c, null, 2)}\n`);
  const r = await w.run(['root']);
  assert.equal(r.code, 2);
  assert.match(r.text, /does not overwrite/);
  assert.equal(w.read().notion.parent_page_id, other);
});

test('root: refuses a non-v2 profile, a missing builder session and a protected root parent; two pages of the title stop it', async () => {
  // not v2: the config as it was before setup (no profile)
  const root = tmp('v2prod');
  const fake = createPagesFake({ protected: [] });
  const hub = fake.addPage({ title: 'Claim tagger' });
  const prod = placeholderConfig();
  prod.notion.parent_page_id = hub;
  prod.notion.requests_per_second = 1000;
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(prod, null, 2)}\n`);
  const env = { root, fetchImpl: fake.fetchImpl, token: fake.token, sleep: noSleep, now: NOW, repoRoot: root };
  const out = [];
  const io = { out: (s) => out.push(s), err: (s) => out.push(s) };
  assert.equal((await setupMain(['builder', 'open', '--reason', 'x'], io, env)), 0);
  assert.equal(await setupMain(['root', '--title', 'T'], io, env), 2);
  assert.match(out.join('\n'), /v2 profile only/);
  assert.equal(fake.entries(hub).length, 0);

  // no builder session
  const w = v2World();
  const none = await w.run(['root']);
  assert.equal(none.code, 2);
  assert.match(none.text, /no builder session is open/);
  assert.equal(w.fake.entries(w.hub).length, 0);

  // a protected root parent (written into the file by hand: validateConfig refuses it before the step runs)
  const c = w.read();
  c.notion.protected_page_ids.push(c.notion.root_parent_page_id);
  writeFileSync(join(w.root, 'config.json'), `${JSON.stringify(c, null, 2)}\n`);
  await open(w);
  const prot = await w.run(['root']);
  assert.equal(prot.code, 2);
  assert.match(prot.text, /protected/);
  assert.equal(w.fake.entries(w.hub).length, 0);

  // two pages of that title
  const d = v2World();
  await open(d);
  await builderClient(d.fake).createPageUnderPage({ parentPageId: d.hub, title: 'Claim tagger v2' });
  await builderClient(d.fake).createPageUnderPage({ parentPageId: d.hub, title: 'Claim tagger v2' });
  const dup = await d.run(['root']);
  assert.equal(dup.code, 2);
  assert.match(dup.text, /more than one page/);
  assert.equal(d.read().notion.parent_page_id, '<setup>');
});

test('root: the build steps stop on the placeholder parent until root has run (nothing is built under the live hub)', async () => {
  const w = v2World();
  await open(w);
  const r = await w.run(['pages']);
  assert.notEqual(r.code, 0);
  assert.equal(w.fake.entries(w.hub).length, 0);
});

test('root is a command of its own: it is not one of the steps of "all"', async () => {
  const w = v2World();
  await open(w);
  const r = await w.run(['root', '--help']);
  assert.equal(r.code, 0);
  assert.match(r.out.join('\n'), /setup\.mjs root/);
});

// ---- the loop refuses a v2 root ----------------------------------------------------------------------------------------------------

function v2Folder() {
  const root = tmp('v2loop');
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(v2(), null, 2)}\n`);
  return root;
}
const collect = () => {
  const lines = [];
  return { lines, io: { out: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)) } };
};

const LOOP = [
  ['status', statusMain, []],
  ['propose', proposeMain, []],
  ['distill', distillMain, []],
  ['promote', promoteMain, ['--lesson', 'x']],
  ['followup', followupMain, []],
  ['rollback', rollbackMain, ['--lesson', 'x']],
  ['restore', restoreMain, ['--edition', '2026-10-29.1']],
  ['decide', decideMain, ['list', '--all']],
  ['add', addMain, ['--claims', '11111111-1111-4111-8111-111111111111']],
];
for (const [name, main, args] of LOOP) {
  test(`${name} refuses a v2 root with exit 2 and the v2 sentence, and writes nothing to Notion`, async () => {
    const root = v2Folder();
    const { lines, io } = collect();
    const fake = createFakeNotion({ protected: [] });
    const code = await main(args, io, { root, fetchImpl: fake.fetchImpl, token: fake.token, sleep: noSleep, now: NOW, repoRoot: root });
    assert.equal(code, 2, lines.join('\n'));
    assert.match(lines.join('\n'), new RegExp(V2_REFUSAL.replace(/[()]/g, '\\$&')));
    assert.equal(fake.writes().length, 0);
  });
}

test('pull, judge and the walkthrough refuse a v2 root too', async () => {
  const root = v2Folder();
  const { lines, io } = collect();
  assert.equal(await pullMain(['--all'], io, { root }), 2);
  assert.match(lines.join('\n'), /v2 profile/);
  await assert.rejects(() => pull({ root, tables: 'all', client: null }), /v2 profile/);
  const j = collect();
  const saved = process.env.CLAIM_TAGGER_MVP_ROOT;
  process.env.CLAIM_TAGGER_MVP_ROOT = root;
  try {
    const code = await judgeMain(['--pull', 'nope'], j.io, {});
    assert.equal(code, 2, j.lines.join('\n'));
    assert.match(j.lines.join('\n'), /v2 profile/);
    const w = collect();
    const wc = await walkthroughMain(['start', '--dry-run'], w.io, { root });
    assert.equal(wc, 2, w.lines.join('\n'));
    assert.match(w.lines.join('\n'), /v2 profile/);
  } finally {
    if (saved === undefined) delete process.env.CLAIM_TAGGER_MVP_ROOT;
    else process.env.CLAIM_TAGGER_MVP_ROOT = saved;
  }
});

// ---- the v2 structure (STRUCTURE-V2.md and its completion block) -----------------------------------------------------------------------------------------------------------------

const V2_SPEC = readFileSync(new URL('../../docs/mvp-2026-11/STRUCTURE-V2.md', import.meta.url), 'utf8');

test('completeStructure: the spec gives a valid structure with relations, the per-row Agent status and no per-claim editor column', () => {
  const s = completeStructure(V2_SPEC);
  assert.equal(s.hub.title, 'Claim tagger v2 (in preparation)');
  assert.deepEqual(s.pages, []);
  assert.equal(s.tables.claims.title, 'Claims');
  const claimCols = s.tables.claims.columns.map((c) => c.name);
  for (const gone of ['Verified tags', 'Review status', 'Challenged tags notes']) assert.ok(!claimCols.includes(gone), gone);
  const td = s.tables.tag_decisions.columns;
  assert.equal(td.find((c) => c.name === 'Open claim')?.relation_to, 'claims');
  assert.equal(td[td.findIndex((c) => c.name === 'Claim') + 1].name, 'Open claim');
  assert.ok(!td.some((c) => c.name === 'Claim page'), 'the earlier name is renamed_from, not a column');
  for (const name of ['Agent status', 'Agent is right', 'Tag outcome', 'Your note']) assert.ok(td.some((c) => c.name === name), name);
  for (const gone of ['Why wrong', 'Your reasoning', 'Claim link']) assert.ok(!td.some((c) => c.name === gone), gone);
  assert.deepEqual(s.views.find((v) => v.name === 'Your queue').columns.slice(0, 2), ['Claim', 'Open claim']);
});

test('completeStructure refuses a spec without a completion block, or one that inserts after a missing column', () => {
  const [head] = V2_SPEC.split('## Completion for setup/structure.json');
  assert.throws(() => completeStructure(head), /no "Completion/);
  assert.throws(() => completeStructure(V2_SPEC.replace('"after": "Claim", "name": "Open claim"','"after": "Nope", "name": "Open claim"')), /after "Nope"/);
});

test('hub link_text replaces the words of a link line, and must name a linked view', () => {
  const s = completeStructure(V2_SPEC);
  const line = hubPlan(s).view_links.find((l) => l.key === 'your_queue');
  assert.equal(line.text, `Your queue: ${s.hub.link_text.your_queue}`);
  assert.notEqual(s.hub.link_text.your_queue, HUB_LINK_TEXT.your_queue);
  const bad = structuredClone(s);
  bad.hub.link_text = { lessons_nowhere: 'x' };
  assert.throws(() => validateStructure(bad), /link_text names "lessons_nowhere"/);
});

test('v2-profile structure writes setup/structure.json under the given root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v2-structure-'));
  try {
    const out = [];
    const code = v2Main(['structure'], { out: (s) => out.push(s), err: (s) => out.push(s) }, { root: dir });
    assert.equal(code, 0, out.join('\n'));
    assert.equal(JSON.parse(readFileSync(join(dir, 'setup', 'structure.json'), 'utf8')).hub.title, 'Claim tagger v2 (in preparation)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the per-row Agent status of Tag decisions has the colours of the Claims one', () => {
  for (const v of ['Waits for you', 'Done', 'Disagrees with your decision', 'Could not read']) assert.equal(optionColor('tag_decisions', 'Agent status', v), optionColor('claims', 'Agent status', v));
});
