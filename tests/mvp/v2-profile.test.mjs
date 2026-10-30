// The v2 page: its config shape, the root step of setup.mjs, the structure completed from STRUCTURE-V2.md, the v2-profile command, and the parked practice pages (P48). No network: Notion is the in-memory fake.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isProtected, isV2, validateConfig } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import { completeStructure } from '../../agents/claim-tagger-mvp/scripts/lib/v2-profile.mjs';
import { HUB_LINK_TEXT, hubPlan, optionColor, validateStructure } from '../../agents/claim-tagger-mvp/scripts/lib/notion-build.mjs';
import { normId } from '../../agents/claim-tagger-mvp/scripts/lib/notion-values.mjs';
import { main as v2Main } from '../../agents/claim-tagger-mvp/scripts/v2-profile.mjs';
import { main as walkthroughMain } from '../../agents/claim-tagger-mvp/scripts/walkthrough.mjs';
import { builtConfig, placeholderConfig } from './helpers/config-fixture.mjs';
import { NOW, builderClient, cleanTmp, noSleep, tmp } from './helpers/setup-world.mjs';
import { main as setupMain } from '../../agents/claim-tagger-mvp/scripts/setup.mjs';
import { createFakeNotion } from './fixtures/fake-notion.mjs';
import { createPagesFake } from './fixtures/fake-notion-pages.mjs';

const HUB = '3fa273e2-14eb-8051-99f3-d12ef01db453';

/** The config as it is after setup: the committed fixture (v2 since P48) with an id in every placeholder. */
function built() {
  const c = builtConfig();
  c.notion.root_parent_page_id = HUB;
  return c;
}
/** The v2 config before `setup.mjs root` has run: the live hub as root parent, placeholders for the v2 page and the tables. */
function v2() {
  const c = built();
  c.notion.parent_page_id = '<setup>';
  c.notion.setup_page_parents = ['<setup>'];
  for (const t of [c.notion.rulebook, c.notion.claims, ...Object.values(c.notion.databases)]) {
    t.database_id = '<setup>';
    t.data_source_id = '<setup>';
  }
  c.notion.views = {};
  return c;
}
const problems = (c) => validateConfig(c).errors;

// ---- validateConfig ----------------------------------------------------------------------------------------------------------------

test('validateConfig accepts the v2 config before and after the root step', () => {
  assert.deepEqual(problems(v2()), []);
  assert.deepEqual(problems(built()), []);
  assert.equal(isV2(v2()), true);
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


// ---- the CLI --------------------------------------------------------------------------------------------------------------------------

test('v2-profile init is gone: it refuses with exit 2 and names the tag, and writes nothing', () => {
  const root = tmp('v2cli');
  const err = [];
  assert.equal(v2Main(['init'], { out: () => {}, err: (s) => err.push(s) }, { root }), 2);
  assert.match(err.join('\n'), /init is gone.*claim-tagger-v1/);
  assert.equal(existsSync(join(root, 'config.json')), false);
  assert.equal(existsSync(join(root, 'profiles')), false);
  assert.equal(v2Main(['bogus'], { out: () => {}, err: () => {} }, { root }), 2);
});

// ---- setup.mjs root ----------------------------------------------------------------------------------------------------------------

/** A v2 state folder, a fake with the live hub page (and live tables that must stay untouched), and a way to run setup.mjs on them. */
function v2World({ hubTitle = 'Claim tagger', structure = true } = {}) {
  const root = tmp('v2root');
  const fake = createPagesFake({ protected: [] });
  const hub = fake.addPage({ title: hubTitle });
  const config = v2();
  config.notion.root_parent_page_id = hub;
  config.notion.requests_per_second = 1000;
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

test('root: when the structure gives the recorded v2 page a new title (P49), the page is renamed in place; config.json keeps its id', async () => {
  const w = v2World();
  await open(w);
  assert.equal((await w.run(['root'])).code, 0);
  const id = w.read().notion.parent_page_id;
  const file = join(w.root, 'setup', 'structure.json');
  const s = JSON.parse(readFileSync(file, 'utf8'));
  s.hub.title = 'Claim tagger v2 (renamed)';
  writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);
  const r = await w.run(['root']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /was renamed to this title/);
  const kids = w.fake.entries(w.hub).filter((e) => e.kind === 'child_page');
  assert.equal(kids.length, 1, 'no second page');
  assert.equal(normId(w.read().notion.parent_page_id), normId(id));
  const log = readFileSync(join(w.root, 'runs', 'builder', 'requests.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(log.some((l) => l.method === 'PATCH' && l.path === `/pages/${normId(id)}`), 'one PATCH of the page');
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

test('root: refuses a missing builder session and a protected root parent; two pages of the title stop it', async () => {
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


// ---- the parked practice pages (P48) ---------------------------------------------------------------------------------------------

test('the walkthrough and the demo mocks refuse with exit 2 and name the tag claim-tagger-v1', async () => {
  const lines = [];
  const io = { out: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)) };
  for (const argv of [['start', '--dry-run'], ['list'], ['help'], []]) {
    lines.length = 0;
    assert.equal(await walkthroughMain(argv, io, {}), 2, argv.join(' '));
    assert.match(lines.join('\n'), /parked.*claim-tagger-v1/);
  }
  const r = spawnSync(process.execPath, [join(process.cwd(), 'agents', 'claim-tagger-mvp', 'scripts', 'demo-mocks.mjs'), 'status'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /parked.*claim-tagger-v1/);
});

// ---- the v2 structure (STRUCTURE-V2.md and its completion block) -----------------------------------------------------------------------------------------------------------------

const V2_SPEC = readFileSync(new URL('../../docs/mvp-2026-11/STRUCTURE-V2.md', import.meta.url), 'utf8');

test('completeStructure: the spec gives a valid structure with relations, the per-row Agent status and no per-claim editor column', () => {
  const s = completeStructure(V2_SPEC);
  assert.equal(s.hub.title, 'Claim tagger v2');
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
    assert.equal(JSON.parse(readFileSync(join(dir, 'setup', 'structure.json'), 'utf8')).hub.title, 'Claim tagger v2');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the per-row Agent status of Tag decisions has the colours of the Claims one', () => {
  for (const v of ['Waits for you', 'Done', 'Disagrees with your decision', 'Could not read']) assert.equal(optionColor('tag_decisions', 'Agent status', v), optionColor('claims', 'Agent status', v));
});
