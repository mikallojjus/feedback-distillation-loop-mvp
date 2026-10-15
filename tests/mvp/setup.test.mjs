import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULEBOOK_COLUMNS, CLAIMS_COPY_COLUMNS, loadConfig } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import { countRequests } from '../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';
import { normId } from '../../agents/claim-tagger-mvp/scripts/lib/notion-values.mjs';
import { AUDIT_PREFIX, checkPlan, readPlan } from '../../agents/claim-tagger-mvp/scripts/lib/plan.mjs';
import { readEdition, readLock, readRubric } from '../../agents/claim-tagger-mvp/scripts/lib/rubric.mjs';
import { openBuilder } from '../../agents/claim-tagger-mvp/scripts/setup.mjs';
import {
  AUDIT_NOTE, InputError, NO_REASONING, auditOps, auditProperties, buildCanaries, claimLink, claimOps, formatWhen, readAudit, readPick, readTaxonomy, richTextFromPieces,
  protectedInLinks, rulebookOps, settingsProperties, unknownOptions, withLinkedSources,
} from '../../agents/claim-tagger-mvp/scripts/lib/setup-steps.mjs';
import {
  AUDIT_FILE, CONTEXT_DEPENDENT_EXAMPLES, EDITION, NOW, REAL_PICK, REAL_TAXONOMY, SELF_CONTAINED_EXAMPLES, builderClient, cleanTmp, fullTaxonomy, makePick, newWorld, readAuditFile,
  readJson, readLines, restClient, smallTaxonomy, tmp, writeInputs,
} from './helpers/setup-world.mjs';

// setup.mjs against the shared in-memory Notion: the commands behind the builder session, the row steps (each a plan applied with a ledger and a
// read-back), the rubric edition, the canaries and the verification. Inputs are small files shaped like the real ones; one test runs the real files.

after(cleanTmp);

const SESSION = ['builder', 'open', '--reason', 'test'];
const posts = (fake, path) => fake.requests.filter((r) => r.method === 'POST' && r.path === path);

/** A world with the structure file written, a builder session open and the tables built. */
async function built({ pick, taxonomy, audit } = {}) {
  const w = newWorld({ structure: true });
  assert.equal(openBuilder({ root: w.root, reason: 'test' }).ok, true);
  const r = await w.run(['build']);
  assert.equal(r.code, 0, r.text);
  const inputs = writeInputs(join(w.root, 'inputs'), { ...(pick ? { pick } : {}), ...(taxonomy ? { taxonomy } : {}), ...(audit ? { audit } : {}) });
  return { ...w, inputs };
}

const tableEntries = (root) => {
  const c = readJson(join(root, 'config.json'));
  return { rulebook: c.notion.rulebook, claims_copy: c.notion.claims[0], ...c.notion.databases };
};
const rowsOf = (w, table) => w.fake.plainRows(tableEntries(w.root)[table].database_id);
const runDirs = (root, step) => readdirSync(join(root, 'runs')).filter((d) => d.endsWith(`-setup-${step}`) || new RegExp(`-setup-${step}-\\d+$`).test(d)).sort().map((d) => join(root, 'runs', d));
const lastRun = (root, step) => runDirs(root, step).at(-1);
const files = (w) => ({ taxonomy: w.inputs.taxonomy, claims: w.inputs.claims, audit: w.inputs.audit });
const allArgs = (w) => ['all', '--taxonomy', w.inputs.taxonomy, '--claims', w.inputs.claims, '--audit', w.inputs.audit];
const verifyArgs = (w) => ['verify', '--taxonomy', w.inputs.taxonomy, '--claims', w.inputs.claims, '--audit', w.inputs.audit];

async function filled(opts) {
  const w = await built(opts);
  const r = await w.run(allArgs(w));
  assert.equal(r.code, 0, r.text);
  return w;
}

// ---- the builder session commands, as they were --------------------------------------------------------------------------------------------

test('builder open, close and status and register keep their behaviour', async () => {
  const w = newWorld();
  let r = await w.run(['builder', 'status']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ['no builder session is open; 0 page(s) and 0 table(s) registered']);
  r = await w.run(['builder', 'open']);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /builder open needs --reason/);
  r = await w.run(['builder', 'open', '--reason', 'stage 1 setup']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ['builder session open: stage 1 setup']);
  assert.equal(readJson(join(w.root, 'runs', 'SETUP')).reason, 'stage 1 setup');
  assert.equal(readJson(join(w.root, 'runs', 'SETUP')).opened_at, NOW().toISOString());
  r = await w.run(['builder', 'open', '--reason', 'again']);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /already open/);
  r = await w.run(['register', 'page', '--id', 'not-an-id', '--name', 'proposal']);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /not a Notion id/);
  r = await w.run(['register', 'page', '--id', '3fa273e2-14eb-81ef-8504-cb40e3bd7052', '--name', 'proposal']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ['page proposal registered: 3fa273e214eb81ef8504cb40e3bd7052']);
  assert.equal(readJson(join(w.root, 'config.json')).notion.pages.proposal, '3fa273e214eb81ef8504cb40e3bd7052');
  r = await w.run(['register', 'database', '--id', '9e111d22c14e4344bb90072606036942', '--name', 'rulebook']);
  assert.equal(r.code, 0);
  r = await w.run(['register', 'database', '--id', '9e111d22c14e4344bb90072606036942', '--name', 'Bad Name']);
  assert.equal(r.code, 2);
  r = await w.run(['builder', 'status']);
  assert.match(r.out[0], /a builder session is open; 1 page\(s\) and 1 table\(s\) registered/);
  assert.ok(r.out.includes('  page proposal: 3fa273e214eb81ef8504cb40e3bd7052'));
  assert.ok(r.out.includes('  table rulebook: 9e111d22c14e4344bb90072606036942'));
  r = await w.run(['builder', 'close']);
  assert.deepEqual([r.code, r.out], [0, ['builder session closed']]);
  assert.equal(existsSync(join(w.root, 'runs', 'SETUP')), false);
  r = await w.run(['builder', 'close']);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /no builder session is open/);
  r = await w.run(['frobnicate']);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /^usage: setup\.mjs builder open/);
  assert.match(r.err.join('\n'), /setup\.mjs all --taxonomy/);
});

// ---- the gate ----------------------------------------------------------------------------------------------------------------------------------

test('every command that writes refuses with exit 2 unless runs/SETUP exists, and touches nothing', async () => {
  const w = newWorld({ structure: true });
  for (const name of ['pages', 'databases', 'views', 'build', 'rulebook', 'claims', 'seed-audit', 'rubric', 'canaries', 'settings', 'all']) {
    const r = await w.run([name]);
    assert.equal(r.code, 2, name);
    assert.match(r.err[0], new RegExp(`setup ${name}: no builder session is open \\(runs/SETUP is missing\\)`), name);
  }
  assert.equal(w.fake.requests.length, 0);
  assert.equal(existsSync(join(w.root, 'runs')), false, 'not even a run folder');
});

test('structure, preview, api-check and verify need no session; the others stop for runs/PAUSED with exit 3', async () => {
  const w = newWorld();
  assert.equal((await w.run(['structure', '--from-proposal', join(import.meta.dirname, '..', '..', 'docs', 'mvp-2026-11', 'STRUCTURE.md')])).code, 0);
  assert.equal((await w.run(['preview'])).code, 0);
  assert.equal((await w.run(['api-check'])).code, 0);
  const v = await w.run(['verify']);
  assert.equal(v.code, 2, 'verify runs without a session; the tables are missing, so it finds differences');
  assert.match(v.text, /missing table/);

  openBuilder({ root: w.root, reason: 'test' });
  mkdirSync(join(w.root, 'runs'), { recursive: true });
  writeFileSync(join(w.root, 'runs', 'PAUSED'), 'paused\n');
  const before = w.fake.requests.length;
  for (const name of ['pages', 'build', 'rulebook', 'claims', 'seed-audit', 'rubric', 'canaries', 'settings', 'all']) {
    const r = await w.run([name]);
    assert.equal(r.code, 3, name);
    assert.match(r.err[0], /runs\/PAUSED exists/);
  }
  assert.equal(w.fake.requests.length, before, 'a paused agent sends nothing');
});

// ---- structure, preview, api-check ---------------------------------------------------------------------------------------------------------

test('structure writes setup/structure.json from the proposal and prints the counts; a bad proposal is exit 2', async () => {
  const w = newWorld();
  const proposal = join(import.meta.dirname, '..', '..', 'docs', 'mvp-2026-11', 'STRUCTURE.md');
  const r = await w.run(['structure', '--from-proposal', proposal]);
  assert.equal(r.code, 0);
  assert.match(r.out[0], /^structure: 5 tables, 58 columns, 4 views, 2 sub-pages -> /);
  const s = readJson(join(w.root, 'setup', 'structure.json'));
  assert.deepEqual(Object.keys(s), ['tables', 'views', 'pages']);
  assert.deepEqual(Object.values(s.tables).map((t) => t.columns.length), [17, 15, 12, 10, 4]);
  assert.equal(readJson(join(lastRun(w.root, 'structure'), 'run.json')).exit_code, 0);

  assert.equal((await w.run(['structure'])).code, 0, 'without the flag it reads the proposal in the repository');

  const missing = await w.run(['structure', '--from-proposal', join(w.root, 'nope.md')]);
  assert.equal(missing.code, 2);
  assert.match(missing.err[0], /the proposal does not exist/);
  const bad = join(w.root, 'bad.md');
  writeFileSync(bad, readFileSync(proposal, 'utf8').replace('| Evidence | link |', '| Evidence | hyperlink |'));
  const r2 = await w.run(['structure', '--from-proposal', bad]);
  assert.equal(r2.code, 2);
  assert.match(r2.err[0], /table "Rulebook copy", column "Evidence": unknown type word "hyperlink"/);
});

test('preview prints what would be built; without a structure file it says how to make one', async () => {
  const w = newWorld({ structure: true });
  const r = await w.run(['preview']);
  assert.equal(r.code, 0);
  assert.match(r.out[0], /^# Structure preview/);
  assert.match(r.out[0], /## Tag decisions \(12 columns\)/);
  const none = await newWorld().run(['preview']);
  assert.equal(none.code, 2);
  assert.match(none.err[0], /structure --from-proposal/);
});

test('api-check makes one GET of the parent page under 2026-03-11 and writes runs/builder/api-check.json', async () => {
  const w = newWorld();
  const r = await w.run(['api-check']);
  assert.equal(r.code, 0);
  const file = readJson(join(w.root, 'runs', 'builder', 'api-check.json'));
  assert.deepEqual(Object.keys(file), ['ok', 'version', 'status', 'at']);
  assert.deepEqual({ ok: file.ok, version: file.version, status: file.status, at: file.at }, { ok: true, version: '2026-03-11', status: 200, at: NOW().toISOString() });
  assert.deepEqual(w.fake.requests.map((x) => [x.method, x.version]), [['GET', '2026-03-11']]);
  assert.equal(w.fake.requests[0].path, `/pages/${w.parent}`);
  assert.equal(w.fake.writes().length, 0);
  assert.equal(countRequests(join(lastRun(w.root, 'api-check'), 'requests.jsonl')).writes, 0);

  const gone = newWorld();
  gone.fake.failNext('GET', /^\/pages\//, 404, 1);
  const r2 = await gone.run(['api-check']);
  assert.equal(r2.code, 1);
  assert.deepEqual(Object.assign({}, readJson(join(gone.root, 'runs', 'builder', 'api-check.json')), { at: 0, message: 0 }), { ok: false, version: '2026-03-11', status: 404, at: 0, message: 0 });
  assert.match(r2.err[0], /could not be read under Notion-Version 2026-03-11/);

  const noToken = newWorld();
  const r3 = await noToken.run(['api-check'], { token: undefined, fetchImpl: undefined });
  assert.equal(r3.code, 1);
  assert.match(r3.err[0], /no NOTION_TOKEN/);
  assert.equal(readJson(join(noToken.root, 'runs', 'builder', 'api-check.json')).ok, false);
});

// ---- pages, databases, views ----------------------------------------------------------------------------------------------------------------------

test('pages, databases and views each do their part, in that order; build does all three; a second run does nothing', async () => {
  const w = newWorld({ structure: true });
  openBuilder({ root: w.root, reason: 'test' });
  const early = await w.run(['views']);
  assert.equal(early.code, 2, 'the views need their tables');
  assert.match(early.err.join('\n'), /not created yet; run "setup.mjs databases" first/);
  let r = await w.run(['pages']);
  assert.deepEqual([r.code, r.out], [0, ['page "Demos": created (' + normId(readJson(join(w.root, 'config.json')).notion.pages.demos) + ')', 'page "Demo tests": created (' + normId(readJson(join(w.root, 'config.json')).notion.pages.demo_tests) + ')', 'pages: 2 made']]);
  r = await w.run(['databases']);
  assert.equal(r.code, 0);
  assert.equal(r.out.at(-1), 'tables: 5 made');
  assert.equal(posts(w.fake, '/databases').length, 5);
  r = await w.run(['views']);
  assert.equal(r.code, 0);
  assert.equal(r.out.at(-1), 'views: 4 made');
  const writes = w.fake.writes().length;
  assert.equal(writes, 11);
  r = await w.run(['build']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.filter((l) => /made/.test(l)), ['pages: 0 made, 2 there already', 'tables: 0 made, 5 there already', 'views: 0 made, 4 there already']);
  assert.equal(w.fake.writes().length, writes);
  const views = readJson(join(w.root, 'config.json')).notion.views;
  assert.deepEqual(Object.keys(views), ['your_queue', 'needs_your_note', 'lessons_waiting', 'rulebook'], 'config.json holds the id and the link of each view');
  const entries = tableEntries(w.root);
  assert.deepEqual(views.your_queue, { id: views.your_queue.id, url: `https://www.notion.so/${entries.tag_decisions.database_id}?v=${views.your_queue.id}` });
  assert.deepEqual(views.rulebook.url, `https://www.notion.so/${entries.rulebook.database_id}?v=${views.rulebook.id}`);
  const log = countRequests(join(w.root, 'runs', 'builder', 'requests.jsonl'));
  assert.equal(log.writes, 11, 'the builder log holds the structure requests');
  assert.equal(log.byMethod.PATCH ?? 0, 0);
  for (const step of ['pages', 'databases', 'views', 'build']) {
    const run = readJson(join(lastRun(w.root, step), 'run.json'));
    assert.equal(run.script, 'setup.mjs');
    assert.equal(run.exit_code, 0);
    assert.ok(run.started_at && run.finished_at);
    assert.equal(run.resume, `node agents/claim-tagger-mvp/scripts/setup.mjs ${step}`);
    assert.ok(existsSync(join(lastRun(w.root, step), 'structure-plan.json')));
  }
});

test('a lost table create stops databases with exit 1 and what to check; the same command finishes the job', async () => {
  const w = newWorld({ structure: true });
  openBuilder({ root: w.root, reason: 'test' });
  await w.run(['pages']);
  w.fake.failNext('POST', /^\/databases$/, 'network', 1);
  const r = await w.run(['databases']);
  assert.equal(r.code, 1);
  assert.match(r.err.join('\n'), /stopped at the table "Rulebook copy"/);
  assert.match(r.err.join('\n'), /Look under the parent page/);
  const again = await w.run(['databases']);
  assert.equal(again.code, 0, again.text);
  assert.equal(Object.keys(readJson(join(w.root, 'runs', 'builder', 'databases.json')).names).filter((n) => !n.endsWith('_data_source')).length, 5);
  assert.equal(readJson(join(lastRun(w.root, 'databases'), 'run.json')).exit_code, 0);
});

test('a view that Notion refuses is named, exit 1, and verify lists it as missing', async () => {
  const w = newWorld({ structure: true });
  openBuilder({ root: w.root, reason: 'test' });
  await w.run(['pages']);
  await w.run(['databases']);
  w.fake.failNext('POST', /^\/views$/, 400, 2); // refused with its place in the tab bar, and again without it
  const r = await w.run(['views']);
  assert.equal(r.code, 1);
  assert.match(r.err.join('\n'), /view "Rulebook" of rulebook failed/);
  assert.match(r.err.join('\n'), /notion-create-view/);
  assert.match(r.err.join('\n'), /to make it by hand: on "Rulebook copy": rows shown: all rows; sorted by: none; columns: Name, Category, Status, When to use, Example Claims; cells wrap/);
  assert.equal(r.out.at(-1), 'views: 3 made');
  assert.deepEqual(Object.keys(readJson(join(w.root, 'config.json')).notion.views), ['your_queue', 'needs_your_note', 'lessons_waiting'], 'no key for the view that could not be made: the scripts fall back to the table\'s address');
  const v = await w.run(['verify', '--taxonomy', 'x', '--claims', 'x', '--audit', 'x']);
  assert.match(v.text, /missing view - "Rulebook" is not among the views/);
  const fixed = await w.run(['views']);
  assert.equal(fixed.code, 0);
  assert.equal(fixed.out.at(-1), 'views: 1 made, 3 there already');
  assert.deepEqual(Object.keys(readJson(join(w.root, 'config.json')).notion.views), ['your_queue', 'needs_your_note', 'lessons_waiting', 'rulebook']);
});

test('verify checks that config.json links every view that exists, and no view that does not', async () => {
  const w = await built();
  const clean = await w.run(['verify', '--taxonomy', 'x', '--claims', 'x', '--audit', 'x']);
  assert.doesNotMatch(clean.text, /view link/, 'a built structure is linked');
  const config = readJson(join(w.root, 'config.json'));
  const kept = structuredClone(config.notion.views);
  delete config.notion.views.needs_your_note;
  config.notion.views.rulebook.id = 'f'.repeat(32);
  config.notion.views.stray = { id: 'a'.repeat(32), url: 'https://www.notion.so/x' };
  writeFileSync(join(w.root, 'config.json'), JSON.stringify(config, null, 2));
  const r = await w.run(['verify', '--taxonomy', 'x', '--claims', 'x', '--audit', 'x']);
  const text = r.err.join('\n');
  assert.match(text, /tag_decisions: view link - "Needs your note" is in Notion but config\.json has no notion\.views\.needs_your_note; run "setup\.mjs views" to record it/);
  assert.match(text, /rulebook: view link - notion\.views\.rulebook in config\.json says .*, but the view in Notion is /);
  const fix = await w.run(['views']);
  assert.equal(fix.code, 0, fix.text);
  assert.deepEqual(readJson(join(w.root, 'config.json')).notion.views.rulebook, kept.rulebook, 'the next run puts the right id back');
  assert.deepEqual(readJson(join(w.root, 'config.json')).notion.views.needs_your_note, kept.needs_your_note);
  const again = await w.run(['verify', '--taxonomy', 'x', '--claims', 'x', '--audit', 'x']);
  assert.doesNotMatch(again.text, /view link/);
});

// ---- the rulebook ------------------------------------------------------------------------------------------------------------------------------------

test('rulebook: a setup plan creates every row with every column from the file, read back; null values stay unset; page_id and the automatic columns are never written', async () => {
  const w = await built();
  const taxonomy = readJson(w.inputs.taxonomy);
  const r = await w.run(['rulebook', '--from', w.inputs.taxonomy]);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.out, ['rulebook: 2 row(s) written and read back ok']);
  const dir = lastRun(w.root, 'rulebook');
  const plan = readPlan(dir);
  assert.deepEqual(plan.header.plan.counts, { creates: 2, updates: 0 });
  assert.equal(plan.header.plan.rubric_edition, null, 'no edition yet at setup');
  assert.equal(plan.header.plan.script, 'setup.mjs');
  const cd = plan.ops.find((o) => o.key === 'Context-dependent');
  assert.deepEqual(Object.keys(cd.properties).sort(), [...RULEBOOK_COLUMNS].filter((c) => c !== 'Geo Tag ID').sort(), 'every column the file fills, and nothing else');
  assert.ok(!('page_id' in cd.properties) && !('Created' in cd.properties));
  const tp = plan.ops.find((o) => o.key === 'Trailing period');
  assert.ok(!('Evidence' in tp.properties) && !('When to use' in tp.properties) && !('Verified on' in tp.properties), 'null values are left unset');
  assert.deepEqual(tp.properties['Work tags'], ['Issue']);
  assert.equal(checkPlan(plan, w.config, { setup: true, root: w.root }).ok, true);

  const rows = rowsOf(w, 'rulebook');
  assert.equal(rows.length, 2);
  for (const want of taxonomy.rows) {
    const got = rows.find((x) => x.Name === want.Name);
    for (const column of RULEBOOK_COLUMNS) {
      const empty = column === 'Work tags' ? [] : null;
      const norm = (v) => (v === '' || v === undefined ? empty : v); // an unset text column reads back as ''
      assert.deepEqual(norm(got[column]), norm(want[column] ?? empty), `${want.Name}: ${column}`);
    }
  }
  const ledger = readLines(join(dir, 'ledger.jsonl'));
  assert.deepEqual(ledger.map((l) => [l.status, l.read_back]), [['done', 'ok'], ['done', 'ok']]);
  assert.deepEqual(readJson(join(w.root, 'setup', 'rulebook-pages.json')), Object.fromEntries(rows.map((x) => [x.Name, x.page_id]).sort(([a], [b]) => (a < b ? -1 : 1))));
  assert.equal(readJson(join(dir, 'run.json')).exit_code, 0);
  assert.ok(countRequests(join(dir, 'requests.jsonl')).total > 0);
});

test('rulebook run again sends nothing: it pulls, finds the rows by their keys and says so', async () => {
  const w = await built();
  await w.run(['rulebook', '--from', w.inputs.taxonomy]);
  const writes = w.fake.writes().length;
  const r = await w.run(['rulebook', '--from', w.inputs.taxonomy]);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ['rulebook: all 2 rows are in the table already; nothing was written']);
  assert.equal(w.fake.writes().length, writes);
  assert.equal(rowsOf(w, 'rulebook').length, 2);
  assert.equal(Object.keys(readJson(join(w.root, 'setup', 'rulebook-pages.json'))).length, 2, 'the pages file is still complete');
});

test('rulebook before the tables exist, with a missing file or with a bad file is exit 2 and says what is wrong', async () => {
  const w = newWorld({ structure: true });
  openBuilder({ root: w.root, reason: 'test' });
  const inputs = writeInputs(join(w.root, 'inputs'));
  let r = await w.run(['rulebook', '--from', inputs.taxonomy]);
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /not created yet \(its id in config\.json is a placeholder\)/);
  await w.run(['build']);
  r = await w.run(['rulebook', '--from', join(w.root, 'missing.json')]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /the taxonomy file does not exist/);
  const dup = smallTaxonomy();
  dup.rows.push({ ...dup.rows[0] });
  writeFileSync(join(w.root, 'dup.json'), JSON.stringify(dup));
  r = await w.run(['rulebook', '--from', join(w.root, 'dup.json')]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /two rows are named "Context-dependent"/);
  writeFileSync(join(w.root, 'empty.json'), JSON.stringify({ read_at: '2026-10-15T11:40:00Z', rows: [] }));
  r = await w.run(['rulebook', '--from', join(w.root, 'empty.json')]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /has no rows/);
  assert.equal(rowsOf(w, 'rulebook').length, 0);
});

test('a value that is not an option of its column is refused before anything is written: Notion would make the option up', async () => {
  const w = await built();
  const tax = smallTaxonomy();
  tax.rows[0].Category = 'Mystery';
  tax.rows[1]['Work tags'] = ['Issue', 'Brand new work'];
  const file = join(w.root, 'odd-taxonomy.json');
  writeFileSync(file, JSON.stringify(tax));
  const writes = w.fake.writes().length;
  let r = await w.run(['rulebook', '--from', file]);
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /nothing was written, because Notion would add options/);
  assert.match(r.err.join('\n'), /"Context-dependent": Category is "Mystery", which is not one of Nature, Form, Quality/);
  assert.match(r.err.join('\n'), /"Trailing period": Work tags is "Brand new work"/);
  const pick = makePick({ extra: 2 });
  pick.rows[1]['Geo Tags'] = ['Debate', 'Weekend'];
  writeFileSync(join(w.root, 'odd-pick.json'), JSON.stringify(pick));
  r = await w.run(['claims', '--from', join(w.root, 'odd-pick.json')]);
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /Geo Tags is "Weekend"/);
  assert.equal(w.fake.writes().length, writes, 'no request at all');
  assert.deepEqual(unknownOptions(tmp('no-structure'), 'rulebook', [{ key: 'x', properties: { Category: 'Whatever' } }]), [], 'without a structure file there is nothing to compare with');
});

// ---- the claims ----------------------------------------------------------------------------------------------------------------------------------------

test('claims: the Geo columns by their names, Agent tags and Agent notes empty, Geo Sources with its links, the pages kept for the seed', async () => {
  const w = await built({ pick: makePick({ extra: 3 }) });
  const pick = readJson(w.inputs.claims);
  const r = await w.run(['claims', '--from', w.inputs.claims]);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.out, ['claims: 3 row(s) written and read back ok']);
  const dir = lastRun(w.root, 'claims');
  const plan = readPlan(dir);
  for (const op of plan.ops) {
    assert.ok(Object.keys(op.properties).every((c) => CLAIMS_COPY_COLUMNS.includes(c)), `only Geo columns: ${Object.keys(op.properties).join(', ')}`);
    assert.ok(!('page_id' in op.properties) && !('url' in op.properties) && !('Review status' in op.properties) && !('Agent tags' in op.properties) && !('Agent notes' in op.properties) && !('source_pieces' in op.properties));
  }
  const rows = rowsOf(w, 'claims_copy');
  assert.equal(rows.length, 3);
  for (const want of pick.rows) {
    const got = rows.find((x) => x['Geo ID'] === want['Geo ID']);
    assert.ok(got, want['Geo ID']);
    for (const column of CLAIMS_COPY_COLUMNS) {
      const expected = want[column];
      const found = got[column];
      if (typeof expected === 'boolean' || typeof expected === 'number') assert.equal(found, expected, `${want['Geo ID']}: ${column}`);
      else if (Array.isArray(expected)) assert.deepEqual(found, expected, `${want['Geo ID']}: ${column}`);
      else assert.equal(found ?? '', expected ?? '', `${want['Geo ID']}: ${column}`);
    }
    assert.equal(got['Agent tags'], '');
    assert.equal(got['Agent notes'], '');
  }
  assert.equal(rows.find((x) => x['Geo ID'] === pick.rows[1]['Geo ID'])['Geo Score'], 0.25);
  assert.equal(rows.find((x) => x['Geo ID'] === pick.rows[2]['Geo ID'])['Geo Is factual'], true);

  // the links of Geo Sources survive: the plan holds the text, the write adds where each piece points
  const claimsDb = tableEntries(w.root).claims_copy.database_id;
  const pages = w.fake.rows(claimsDb);
  for (const want of pick.rows) {
    const page = pages.find((p) => p.properties['Geo ID'].rich_text.map((t) => t.plain_text).join('') === want['Geo ID']);
    const hrefs = page.properties['Geo Sources'].rich_text.map((t) => t.href).filter(Boolean);
    assert.deepEqual(hrefs, want.source_pieces.map((p) => p.href).filter(Boolean), want['Geo ID']);
    assert.equal(page.properties['Geo Sources'].rich_text.map((t) => t.plain_text).join(''), want['Geo Sources']);
  }
  const sidecar = readJson(join(dir, 'rich-text.json'));
  assert.deepEqual(Object.keys(sidecar), [pick.rows[0]['Geo ID'], pick.rows[2]['Geo ID']]);

  const pagesFile = readJson(join(w.root, 'setup', 'claims-pages.json'));
  assert.deepEqual(Object.fromEntries(rows.map((x) => [x['Geo ID'], x.page_id])), pagesFile);
  const writes = w.fake.writes().length;
  const again = await w.run(['claims', '--from', w.inputs.claims]);
  assert.match(again.out[0], /all 3 rows are in the table already/);
  assert.equal(w.fake.writes().length, writes);
});

test('a link in Geo Sources that points at a protected table or page is refused: the links go in beside the plan, so setup looks at them itself', async () => {
  const w = await built();
  const pick = makePick({ extra: 2 });
  const protectedId = w.config.notion.protected_database_ids[0].replace(/-/g, '');
  pick.rows[0].source_pieces[0].href = `https://www.notion.so/${protectedId}`;
  writeFileSync(join(w.root, 'trap-pick.json'), JSON.stringify(pick));
  const writes = w.fake.writes().length;
  const r = await w.run(['claims', '--from', join(w.root, 'trap-pick.json')]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /1 claim\(s\) \(ee000+\) point at a protected table or page/);
  assert.equal(w.fake.writes().length, writes);
  assert.deepEqual(protectedInLinks(w.config, new Map([['g', [{ text: 'x', href: 'https://example.com/a' }, { text: 'y', href: null }]]])), []);
});

test('a pick with a repeated Geo ID, no Geo Name or no rows is refused with exit 2', async () => {
  const w = await built();
  const bad = (pick, re) => {
    const file = join(w.root, `pick-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify(pick));
    return w.run(['claims', '--from', file]).then((r) => {
      assert.equal(r.code, 2);
      assert.match(r.err[0], re);
    });
  };
  const good = makePick({ extra: 2 });
  await bad({ ...good, rows: [good.rows[0], good.rows[0]] }, /appears twice/);
  await bad({ ...good, rows: [{ ...good.rows[0], 'Geo Name': '' }] }, /has no Geo Name/);
  await bad({ ...good, rows: [] }, /has no rows/);
  assert.equal(rowsOf(w, 'claims_copy').length, 0);
});

// ---- the seeded audit decisions -------------------------------------------------------------------------------------------------------------------

test('auditProperties: the agent\'s answer from the flag, Agent slip only when it differs from the outcome, the prefix on the reasoning', () => {
  const d = (flag, outcome, reasoning = 'because') => ({ geo_id: 'g1', claim: 'A claim', flag, outcome, reasoning });
  const page = '3f2273e2-14eb-819a-89ae-e658e01e094b';
  const wrongAgree = auditProperties(d('Wrong tag', 'Does not apply'), page);
  assert.deepEqual(wrongAgree, {
    Claim: 'A claim', Key: 'g1::Context-dependent', Tag: 'Context-dependent', 'Agent proposal': 'Applies', 'Claim link': 'https://www.notion.so/3f2273e214eb819a89aee658e01e094b',
    'Tag outcome': 'Does not apply', 'Your reasoning': 'From the audit of 9 October: because', 'Why wrong': 'Agent slip',
  });
  const missingApplies = auditProperties(d('Missing tag', 'Applies'), page);
  assert.equal(missingApplies['Agent proposal'], 'Does not apply');
  assert.equal(missingApplies['Why wrong'], 'Agent slip');
  const missingDisagree = auditProperties(d('Missing tag', 'Does not apply'), page);
  assert.equal(missingDisagree['Agent proposal'], 'Does not apply');
  assert.ok(!('Why wrong' in missingDisagree), 'the agent had no tag and the editor said it does not apply: nothing was wrong');
  assert.ok(!('Why wrong' in auditProperties(d('Wrong tag', 'Applies'), page)), 'the agent had applied it and the editor agreed');
  assert.equal(auditProperties(d('Missing tag', 'Applies', null), page)['Your reasoning'], `From the audit of 9 October: ${NO_REASONING}`);
  assert.equal(NO_REASONING, 'the editor agreed with the auditor; no reasoning was recorded.');
  for (const key of ['Agent confidence', 'Agent reason', 'Rulebook edition', 'Follow-up']) assert.ok(!(key in wrongAgree), key);
  assert.equal(claimLink('3F2273E2-14EB-819A-89AE-E658E01E094B'), 'https://www.notion.so/3f2273e214eb819a89aee658e01e094b');
});

test('seed-audit needs the claims first, and every audited claim must have its row in the Claims copy', async () => {
  const w = await built();
  let r = await w.run(['seed-audit', '--from', w.inputs.audit]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /claims-pages\.json does not exist: run "setup\.mjs claims" first/);
  await w.run(['claims', '--from', w.inputs.claims]);
  const audit = readAuditFile();
  audit.decisions.push({ ...audit.decisions[0], geo_id: 'f'.repeat(32) });
  const file = join(w.root, 'audit-extra.json');
  writeFileSync(file, JSON.stringify(audit));
  r = await w.run(['seed-audit', '--from', file]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /1 audited claim\(s\) have no row in the Claims copy yet/);
  assert.equal(rowsOf(w, 'tag_decisions').length, 0);
});

test('seed-audit: ten decided rows through a setup plan; the editor columns are written only with the prefix and only with setup: true', async () => {
  const w = await built();
  await w.run(['claims', '--from', w.inputs.claims]);
  const r = await w.run(['seed-audit', '--from', w.inputs.audit]);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.out, ['seed-audit: 10 row(s) written and read back ok', `seed-audit: ${AUDIT_NOTE}`]);
  assert.equal(AUDIT_NOTE, 'seeded from the audit of 9 October');
  const dir = lastRun(w.root, 'seed-audit');
  assert.equal(readJson(join(dir, 'run.json')).note, 'seeded from the audit of 9 October');
  const plan = readPlan(dir);
  assert.deepEqual(plan.header.plan.counts, { creates: 10, updates: 0 });

  // the plan is a setup plan: refused as a plain plan, refused again when a row loses the prefix
  assert.equal(checkPlan(plan, w.config, { setup: true, root: w.root }).ok, true);
  const plain = checkPlan(plan, w.config, { setup: false, root: w.root });
  assert.equal(plain.ok, false);
  assert.ok(plain.problems.some((p) => /"Tag outcome" is a column only an editor writes/.test(p)));
  assert.ok(plain.problems.some((p) => /"Your reasoning" is a column only an editor writes/.test(p)));
  const tampered = structuredClone(plan);
  tampered.ops[3].properties['Your reasoning'] = 'No prefix on this one.';
  const refused = checkPlan(tampered, w.config, { setup: true, root: w.root });
  assert.equal(refused.ok, false);
  assert.ok(refused.problems.some((p) => /op 4/.test(p) && /only an editor writes/.test(p)));
  for (const op of plan.ops) {
    assert.ok(op.properties['Your reasoning'].startsWith(AUDIT_PREFIX));
    assert.ok(!('Agent confidence' in op.properties) && !('Agent reason' in op.properties) && !('Rulebook edition' in op.properties) && !('Follow-up' in op.properties));
  }

  // what was read back
  const audit = readAuditFile();
  const claimPages = readJson(join(w.root, 'setup', 'claims-pages.json'));
  const rows = rowsOf(w, 'tag_decisions');
  assert.equal(rows.length, 10);
  for (const d of audit.decisions) {
    const row = rows.find((x) => x.Key === `${d.geo_id}::Context-dependent`);
    assert.ok(row, d.geo_id);
    assert.equal(row.Claim, d.claim);
    assert.equal(row.Tag, 'Context-dependent');
    assert.equal(row['Agent proposal'], d.flag === 'Wrong tag' ? 'Applies' : 'Does not apply');
    assert.equal(row['Tag outcome'], d.outcome);
    assert.equal(row['Claim link'], `https://www.notion.so/${normId(claimPages[d.geo_id])}`, 'the link points at the Claims copy row');
    assert.equal(row['Your reasoning'], `From the audit of 9 October: ${d.reasoning ?? 'the editor agreed with the auditor; no reasoning was recorded.'}`);
    const agentWasRight = row['Agent proposal'] === d.outcome;
    assert.equal(row['Why wrong'], agentWasRight ? null : 'Agent slip');
    assert.equal(row['Agent confidence'], null);
    assert.equal(row['Agent reason'], '');
    assert.equal(row['Rulebook edition'], '');
    assert.equal(row['Follow-up'], null);
  }
  const disagree = ['8f9c833b41e54eee9ca78e9c2f4ffb58', '78dd775028795b65bb5c4945eda1c3bb'].map((id) => rows.find((x) => x.Key.startsWith(id)));
  assert.deepEqual(disagree.map((x) => [x['Agent proposal'], x['Tag outcome'], x['Why wrong']]), [['Does not apply', 'Does not apply', null], ['Does not apply', 'Does not apply', null]]);
  assert.equal(rows.filter((x) => x['Why wrong'] === 'Agent slip').length, 8);
  assert.equal(rows.find((x) => x.Key.startsWith('fc0cb0da'))['Why wrong'], 'Agent slip');
  assert.equal(readJson(join(w.root, 'setup', 'audit-decisions.json')).decisions.length, 10);

  const writes = w.fake.writes().length;
  const again = await w.run(['seed-audit', '--from', w.inputs.audit]);
  assert.equal(again.code, 0);
  assert.match(again.out[0], /all 10 rows are in the table already/);
  assert.equal(w.fake.writes().length, writes);
});

test('no other path writes the editor columns: a plan for another script, or a create without the prefix, is refused', async () => {
  const w = await built();
  const { newPlan } = await import('../../agents/claim-tagger-mvp/scripts/lib/plan.mjs');
  const plan = newPlan({ runId: 'r', script: 'propose.mjs', rubricEdition: EDITION, config: w.config, now: NOW });
  plan.create('tag_decisions', 'g::Context-dependent', { Claim: 'x', Tag: 'Context-dependent', 'Tag outcome': 'Applies', 'Your reasoning': 'From the audit of 9 October: sneaky' });
  assert.equal(checkPlan(plan, w.config, { root: w.root }).ok, false, 'not a setup plan');
  const second = newPlan({ runId: 'r', script: 'setup.mjs', rubricEdition: null, config: w.config, now: NOW });
  second.create('tag_decisions', 'g::Context-dependent', { Claim: 'x', Tag: 'Context-dependent', 'Tag outcome': 'Applies', 'Your reasoning': 'a reason' });
  assert.equal(checkPlan(second, w.config, { setup: true, root: w.root }).ok, false, 'a setup plan without the prefix');
  const third = newPlan({ runId: 'r', script: 'setup.mjs', rubricEdition: null, config: w.config, now: NOW });
  third.create('agent_settings', 'Claim tagger', { Name: 'Claim tagger', Paused: false });
  assert.equal(checkPlan(third, w.config, { setup: true, root: w.root }).ok, false, 'Paused belongs to a person even at setup');
});

// ---- the rubric edition ------------------------------------------------------------------------------------------------------------------------------

test('rubric needs the Rulebook copy first; then it writes edition <today>.1 with history, lock and changelog from the file and the copy\'s page ids', async () => {
  const w = await built();
  let r = await w.run(['rubric', '--from', w.inputs.taxonomy]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /rulebook-pages\.json does not exist: run "setup\.mjs rulebook" first/);
  await w.run(['rulebook', '--from', w.inputs.taxonomy]);
  r = await w.run(['rubric', '--from', w.inputs.taxonomy]);
  assert.equal(r.code, 0, r.text);
  assert.match(r.out[0], new RegExp(`^rubric: edition ${EDITION} written; 2 tags, 1 with rules \\(Context-dependent\\)$`));
  assert.match(EDITION, /^\d{4}-\d{2}-\d{2}\.1$/);
  const rubric = readRubric(w.root);
  assert.equal(rubric.edition, EDITION);
  assert.deepEqual(readEdition(w.root, EDITION), rubric, 'the history file is the edition');
  const lock = readLock(w.root);
  assert.equal(lock.edition, EDITION);
  assert.equal(lock.rubric_hash, rubric.rubric_hash);
  assert.deepEqual(Object.keys(lock.text).sort(), ['Context-dependent', 'Trailing period']);
  const changelog = readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8');
  assert.equal(changelog, `- ${EDITION.slice(0, 10)} · edition ${EDITION} · setup: copied from the taxonomy\n`);
  const pages = readJson(join(w.root, 'setup', 'rulebook-pages.json'));
  assert.deepEqual(rubric.tags.map((t) => [t.name, t.page_id]), [['Context-dependent', pages['Context-dependent']], ['Trailing period', pages['Trailing period']]]);
  assert.deepEqual(rubric.tags.map((t) => t.judged), [true, false]);
  assert.equal(rubric.tags[0].rules.length, 5);
  assert.deepEqual(rubric.tags[0].example_claims, CONTEXT_DEPENDENT_EXAMPLES);
  assert.deepEqual(rubric.source, { database_id: 'f05273e214eb8353b0a981544507de32', data_source_id: 'b65273e2-14eb-8362-86a6-870ea8d632f4', read_via: 'connector', read_at: '2026-10-15T11:40:00.000Z' });
  assert.equal(readJson(join(lastRun(w.root, 'rubric'), 'run.json')).rubric_edition, EDITION);
  assert.equal(w.fake.requests.length, w.fake.requests.length);
});

test('rubric run again changes nothing and adds no second changelog line; other rules in the file are refused', async () => {
  const w = await built();
  await w.run(['rulebook', '--from', w.inputs.taxonomy]);
  await w.run(['rubric', '--from', w.inputs.taxonomy]);
  const before = readFileSync(join(w.root, 'rubric', 'rubric.json'), 'utf8');
  const again = await w.run(['rubric', '--from', w.inputs.taxonomy]);
  assert.equal(again.code, 0);
  assert.match(again.out[0], new RegExp(`edition ${EDITION} is in force already \\(files checked\\)`));
  assert.equal(readFileSync(join(w.root, 'rubric', 'rubric.json'), 'utf8'), before);
  assert.equal(readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8').trim().split('\n').length, 1);
  const changed = smallTaxonomy();
  changed.rows[0]['When to use'] = '1. A different first rule.';
  writeFileSync(join(w.root, 'changed.json'), JSON.stringify(changed));
  const refused = await w.run(['rubric', '--from', join(w.root, 'changed.json')]);
  assert.equal(refused.code, 2);
  assert.match(refused.err[0], new RegExp(`edition ${EDITION} is in force already with other rules`));
});

// ---- canaries ----------------------------------------------------------------------------------------------------------------------------------------

test('canaries: six example claims of Context-dependent expected to apply, five of Self-contained expected not to, from a full taxonomy file', async () => {
  const w = await built({ taxonomy: fullTaxonomy() });
  assert.equal(readTaxonomy(w.inputs.taxonomy).rows.length, 13);
  const r = await w.run(['canaries', '--from', w.inputs.taxonomy]);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.out, ['canaries: 11 rows (6 expected to apply, 5 not) in evals/canaries.jsonl']);
  const rows = readLines(join(w.root, 'evals', 'canaries.jsonl'));
  assert.equal(rows.length, 11);
  assert.deepEqual(rows.map((x) => x.id), Array.from({ length: 11 }, (_, i) => `canary-${i + 1}`));
  assert.deepEqual(rows.map((x) => Object.keys(x)), Array(11).fill(['id', 'tag', 'claim', 'expected', 'source']));
  assert.ok(rows.every((x) => x.tag === 'Context-dependent'));
  assert.deepEqual(rows.slice(0, 6).map((x) => [x.claim, x.expected, x.source]), CONTEXT_DEPENDENT_EXAMPLES.map((c) => [c, 'apply', 'example claims of Context-dependent']));
  assert.deepEqual(rows.slice(6).map((x) => [x.claim, x.expected, x.source]), SELF_CONTAINED_EXAMPLES.map((c) => [c, 'do_not_apply', 'example claims of Self-contained']));
  assert.equal(w.fake.writes().length, 11, 'no Notion request: the file is local');

  const again = await w.run(['canaries', '--from', w.inputs.taxonomy]);
  assert.equal(again.code, 0, 'the same file again is fine');
  writeFileSync(join(w.root, 'evals', 'canaries.jsonl'), `${JSON.stringify({ ...rows[0], claim: 'edited by hand' })}\n`);
  const frozen = await w.run(['canaries', '--from', w.inputs.taxonomy]);
  assert.equal(frozen.code, 2);
  assert.match(frozen.err[0], /frozen until a rule change/);
});

test('canaries need the counterpart\'s examples, and a claim that is an example of both is refused', () => {
  const tax = readTaxonomyObject(fullTaxonomy());
  assert.equal(buildCanaries(tax).length, 11);
  const noCounterpart = { ...tax, counterparts: [] };
  assert.throws(() => buildCanaries(noCounterpart), /no counterparts entry named "Self-contained"/);
  const noContext = { ...tax, rows: tax.rows.filter((r) => r.Name !== 'Context-dependent') };
  assert.throws(() => buildCanaries(noContext), /no row named "Context-dependent"/);
  const both = structuredClone(tax);
  both.counterparts[0]['Example Claims'] += `\n${CONTEXT_DEPENDENT_EXAMPLES[0]}`;
  assert.throws(() => buildCanaries(both), /example of both Context-dependent and Self-contained/);
  const quoted = structuredClone(tax);
  quoted.rows.find((r) => r.Name === 'Context-dependent')['Example Claims'] = '- "A quoted claim about the budget."\n- Another claim here.\n\n255 legacy linked claims\n-';
  assert.deepEqual(buildCanaries(quoted).filter((x) => x.expected === 'apply').map((x) => x.claim), ['A quoted claim about the budget.', 'Another claim here.']);
});

function readTaxonomyObject(t) {
  const dir = tmp('tax');
  const file = join(dir, 't.json');
  writeFileSync(file, JSON.stringify(t));
  return readTaxonomy(file);
}

// ---- settings ----------------------------------------------------------------------------------------------------------------------------------------

test('settings: one Agent settings row, unticked, with the edition the rubric step wrote and "Setup · <date> · 5 tables"', async () => {
  const w = await built();
  let r = await w.run(['settings']);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /no rulebook edition yet: run "setup\.mjs rubric" first/);
  await w.run(['rulebook', '--from', w.inputs.taxonomy]);
  await w.run(['rubric', '--from', w.inputs.taxonomy]);
  r = await w.run(['settings']);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.out, ['settings: 1 row(s) written and read back ok']);
  const rows = rowsOf(w, 'agent_settings');
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], page_id: 0 }, { page_id: 0, Name: 'Claim tagger', Paused: false, 'Rulebook edition': EDITION, 'Last run summary': 'Setup · 15 Oct 14:22 · 5 tables' });
  const plan = readPlan(lastRun(w.root, 'settings'));
  assert.deepEqual(Object.keys(plan.ops[0].properties), ['Name', 'Rulebook edition', 'Last run summary'], 'Paused is not written: a new row is unticked');
  assert.equal(plan.header.plan.rubric_edition, EDITION);
  assert.equal(formatWhen(new Date(2026, 0, 5, 9, 5)), '5 Jan 09:05');
  assert.deepEqual(settingsProperties({ edition: 'e', now: NOW() }), { Name: 'Claim tagger', 'Rulebook edition': 'e', 'Last run summary': 'Setup · 15 Oct 14:22 · 5 tables' });
  const writes = w.fake.writes().length;
  const again = await w.run(['settings']);
  assert.match(again.out[0], /all 1 rows are in the table already/);
  assert.equal(w.fake.writes().length, writes);
});

test('when Paused is ticked in Agent settings the row steps write nothing and exit 3', async () => {
  const w = await built();
  await w.run(['rulebook', '--from', w.inputs.taxonomy]);
  await w.run(['rubric', '--from', w.inputs.taxonomy]);
  await w.run(['settings']);
  w.fake.editRow(rowsOf(w, 'agent_settings')[0].page_id, { Paused: true });
  const writes = w.fake.writes().length;
  await w.run(['claims', '--from', w.inputs.claims]).then((r) => {
    assert.equal(r.code, 3);
    assert.match(r.err.join('\n'), /Paused is ticked in Agent settings/);
  });
  assert.equal(w.fake.writes().length, writes);
  assert.equal(rowsOf(w, 'claims_copy').length, 0);
});

// ---- all and verify ----------------------------------------------------------------------------------------------------------------------------------

test('all: every step in order, each with its own run folder, the table counts right, verify finding nothing', async () => {
  const w = await built();
  const r = await w.run(allArgs(w));
  assert.equal(r.code, 0, r.text);
  assert.match(r.out.at(-1), /^setup all: every step finished/);
  assert.equal(rowsOf(w, 'rulebook').length, 2);
  assert.equal(rowsOf(w, 'claims_copy').length, 13);
  assert.equal(rowsOf(w, 'tag_decisions').length, 10);
  assert.equal(rowsOf(w, 'rule_changes').length, 0);
  assert.equal(rowsOf(w, 'agent_settings').length, 1);
  const overall = readJson(join(lastRun(w.root, 'all'), 'run.json'));
  assert.deepEqual(overall.steps.map((s) => s.step), ['api-check', 'pages', 'databases', 'views', 'rulebook', 'claims', 'seed-audit', 'rubric', 'canaries', 'settings', 'verify']);
  assert.ok(overall.steps.every((s) => s.exit_code === 0));
  assert.equal(overall.exit_code, 0);
  assert.equal(overall.rubric_edition, EDITION);
  for (const step of overall.steps) {
    const run = readJson(join(w.root, 'runs', step.run_id, 'run.json'));
    assert.equal(run.exit_code, 0, step.step);
    assert.ok(run.finished_at, step.step);
    assert.match(run.resume, /^node agents\/claim-tagger-mvp\/scripts\/setup\.mjs /);
  }
  assert.match(readJson(join(w.root, 'runs', overall.steps[4].run_id, 'run.json')).resume, /rulebook --from .*taxonomy-issue\.json$/);
  for (const step of ['rulebook', 'claims', 'seed-audit', 'settings']) {
    assert.ok(existsSync(join(lastRun(w.root, step), 'plan.jsonl')) && existsSync(join(lastRun(w.root, step), 'ledger.jsonl')) && existsSync(join(lastRun(w.root, step), 'requests.jsonl')), step);
  }
  assert.equal(w.fake.writes().length, 2 + 5 + 4 + 2 + 13 + 10 + 1, 'the structure, then the rows: nothing else was written');
  assert.ok(w.fake.requests.every((x) => x.method !== 'DELETE'));
  const verify = readJson(join(w.root, 'runs', 'builder', 'verify.json'));
  assert.deepEqual(verify.differences, []);
  assert.deepEqual(verify.counts, { rulebook: 2, claims_copy: 13, tag_decisions: 10, rule_changes: 0, agent_settings: 1 });
  assert.equal(verify.requests.writes, 0, 'verify only read');
});

test('all run again is idempotent: it reads, finds everything, writes nothing and verifies', async () => {
  const w = await filled();
  const writes = w.fake.writes().length;
  const r = await w.run(allArgs(w));
  assert.equal(r.code, 0, r.text);
  assert.equal(w.fake.writes().length, writes);
  assert.ok(r.out.some((l) => /all 13 rows are in the table already/.test(l)));
  assert.ok(r.out.some((l) => /is in force already/.test(l)));
  assert.equal(readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8').trim().split('\n').length, 1);
  assert.equal(readLines(join(w.root, 'evals', 'canaries.jsonl')).length, 11);
});

for (const applied of [false, true]) {
  test(`all stops at a lost row create (${applied ? 'it landed' : 'it did not land'}) and the same command finishes the job without a duplicate`, async () => {
    const w = await built();
    for (const step of ['pages', 'databases', 'views']) await w.run([step]);
    w.fake.failNext('POST', /^\/pages$/, 503, 1, { applied });
    const first = await w.run(allArgs(w));
    assert.equal(first.code, 1);
    assert.match(first.err.join('\n'), /stopped at "rulebook" \(exit 1\)/);
    assert.match(first.err.join('\n'), /uncertain/);
    const second = await w.run(allArgs(w));
    assert.equal(second.code, 0, second.text);
    for (const [table, n] of [['rulebook', 2], ['claims_copy', 13], ['tag_decisions', 10], ['agent_settings', 1]]) {
      const rows = rowsOf(w, table);
      assert.equal(rows.length, n, table);
      assert.equal(new Set(rows.map((x) => x.Name ?? x['Geo ID'] ?? x.Key)).size, n, `${table}: no key twice`);
    }
    assert.deepEqual(readJson(join(w.root, 'runs', 'builder', 'verify.json')).differences, []);
  });
}

test('verify finds an edited Rulebook copy row, an edited claim, an edited seeded row, an edited settings row and an extra row', async () => {
  const w = await filled();
  const v0 = await w.run(verifyArgs(w));
  assert.equal(v0.code, 0, v0.text);
  assert.match(v0.out.join('\n'), /verify: no differences/);
  assert.match(v0.out[0], /verify: rows rulebook 2, claims_copy 13, tag_decisions 10, rule_changes 0, agent_settings 1; \d+ request\(s\), 0 write\(s\)/);

  const cd = rowsOf(w, 'rulebook').find((x) => x.Name === 'Context-dependent');
  w.fake.editRow(cd.page_id, { 'When to use': '1. A rule an editor rewrote by hand.' });
  const claim = rowsOf(w, 'claims_copy')[4];
  w.fake.editRow(claim.page_id, { 'Geo Name': 'A claim somebody retitled', 'Geo Score': 0.9 });
  const seeded = rowsOf(w, 'tag_decisions')[2];
  w.fake.editRow(seeded.page_id, { 'Tag outcome': 'Does not apply', 'Why wrong': 'Rule unclear' });
  const settings = rowsOf(w, 'agent_settings')[0];
  w.fake.editRow(settings.page_id, { 'Rulebook edition': '2099-01-01.7' });
  w.fake.addRow(tableEntries(w.root).claims_copy.database_id, { 'Geo Name': 'An extra claim', 'Geo ID': 'extra-1' });

  const r = await w.run(verifyArgs(w));
  assert.equal(r.code, 2);
  const text = r.err.join('\n');
  assert.match(text, /verify: \d+ difference\(s\)/);
  assert.match(text, /rulebook: field - "Context-dependent": When to use differs/);
  assert.match(text, /claims_copy: field - .*Geo Name differs/);
  assert.match(text, /claims_copy: field - .*Geo Score differs/);
  assert.match(text, /claims_copy: row count - 14 rows in the Claims copy, 13 in the pick/);
  assert.match(text, /claims_copy: extra row - the claim extra-1 is in the Claims copy but not in the pick/);
  assert.match(text, /tag_decisions: seeded row - .*Tag outcome differs/);
  assert.match(text, /tag_decisions: seeded row - .*Why wrong differs/);
  assert.match(text, /agent_settings: settings - Rulebook edition is "2099-01-01\.7", the edition in force is /);
  const verify = readJson(join(w.root, 'runs', 'builder', 'verify.json'));
  assert.equal(verify.ok, false);
  assert.ok(verify.differences.length >= 8);
  assert.equal(verify.requests.writes, 0);
  assert.ok(r.err.length <= 22, 'a short list');
});

test('verify names a column added to a table, a missing row and a file it cannot read', async () => {
  const w = await filled();
  await w.run(['verify', '--taxonomy', join(w.root, 'gone.json'), '--claims', w.inputs.claims, '--audit', w.inputs.audit]).then((r) => {
    assert.equal(r.code, 2);
    assert.match(r.err.join('\n'), /rulebook: input - the taxonomy file: the taxonomy file does not exist/);
  });
  const bigger = makePick({ audit: readAuditFile(), extra: 4 });
  writeFileSync(join(w.root, 'bigger.json'), JSON.stringify(bigger));
  const r = await w.run(['verify', '--taxonomy', w.inputs.taxonomy, '--claims', join(w.root, 'bigger.json'), '--audit', w.inputs.audit]);
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /claims_copy: row count - 13 rows in the Claims copy, 14 in the pick/);
  assert.match(r.err.join('\n'), /claims_copy: missing row - the claim ee030+ is not in the Claims copy/);
  const entry = tableEntries(w.root).tag_decisions;
  await restClient(w.fake).retrieveDatabase(entry.database_id);
  const added = builderClient(w.fake);
  await added.updateDataSource(entry.data_source_id, { properties: { 'Side note': { type: 'rich_text', rich_text: {} } } });
  const r2 = await w.run(verifyArgs(w));
  assert.equal(r2.code, 2);
  assert.match(r2.err.join('\n'), /tag_decisions: extra column - "Side note" \(rich_text\)/);
});

// ---- the real input files -------------------------------------------------------------------------------------------------------------------------

test('the real inputs (13 taxonomy rows, 50 picked claims, the audit) build, read back and verify against the fake', { skip: !existsSync(REAL_TAXONOMY) || !existsSync(REAL_PICK) }, async () => {
  const w = await built();
  const args = ['all', '--taxonomy', REAL_TAXONOMY, '--claims', REAL_PICK, '--audit', AUDIT_FILE];
  const r = await w.run(args);
  assert.equal(r.code, 0, r.text);
  assert.equal(rowsOf(w, 'rulebook').length, 13);
  assert.equal(rowsOf(w, 'claims_copy').length, 50);
  assert.equal(rowsOf(w, 'tag_decisions').length, 10);
  assert.equal(rowsOf(w, 'agent_settings').length, 1);
  const canaries = readLines(join(w.root, 'evals', 'canaries.jsonl'));
  assert.deepEqual([canaries.filter((x) => x.expected === 'apply').length, canaries.filter((x) => x.expected === 'do_not_apply').length], [6, 5]);
  const rubric = readRubric(w.root);
  assert.deepEqual(rubric.tags.filter((t) => t.judged).map((t) => t.name), ['Context-dependent']);
  assert.equal(rubric.tags.length, 13);
  const pick = readJson(REAL_PICK);
  const linked = pick.rows.filter((x) => x.source_pieces.some((p) => p.href));
  assert.ok(linked.length > 0);
  const pages = w.fake.rows(tableEntries(w.root).claims_copy.database_id);
  for (const want of linked) {
    const page = pages.find((p) => p.properties['Geo ID'].rich_text.map((t) => t.plain_text).join('') === want['Geo ID']);
    assert.deepEqual([...new Set(page.properties['Geo Sources'].rich_text.map((t) => t.href).filter(Boolean))].sort(), [...new Set(want.source_pieces.map((p) => p.href).filter(Boolean))].sort(), want['Geo ID']);
  }
  const verify = readJson(join(w.root, 'runs', 'builder', 'verify.json'));
  assert.deepEqual(verify.differences, []);
  assert.deepEqual(verify.counts, { rulebook: 13, claims_copy: 50, tag_decisions: 10, rule_changes: 0, agent_settings: 1 });
  // the protected tables were never touched: the fake hides them, and a request for one would have been a 404
  assert.ok(w.fake.requests.every((x) => x.status !== 404));
  const loaded = loadConfig(w.root);
  assert.match(loaded.notion.rulebook.database_id, /^[0-9a-f]{32}$/);
});

// ---- the pieces ------------------------------------------------------------------------------------------------------------------------------------

test('richTextFromPieces: neighbours with the same address are one piece, long text is cut at 2,000, more than 100 objects fall back to plain text', () => {
  const merged = richTextFromPieces([
    { text: 'Fed ', href: 'https://a.example/1' }, { text: 'report', href: 'https://a.example/1' }, { text: ' and ', href: null }, { text: 'more', href: null }, { text: 'Two', href: 'https://a.example/2' }, { text: '', href: null },
  ]);
  assert.equal(merged.degraded, false);
  assert.deepEqual(merged.items, [
    { type: 'text', text: { content: 'Fed report', link: { url: 'https://a.example/1' } } },
    { type: 'text', text: { content: ' and more' } },
    { type: 'text', text: { content: 'Two', link: { url: 'https://a.example/2' } } },
  ]);
  const long = richTextFromPieces([{ text: 'x'.repeat(4500), href: 'https://a.example/long' }]);
  assert.deepEqual(long.items.map((i) => i.text.content.length), [2000, 2000, 500]);
  assert.ok(long.items.every((i) => i.text.link.url === 'https://a.example/long'));
  const many = richTextFromPieces(Array.from({ length: 120 }, (_, i) => ({ text: `s${i}`, href: i % 2 ? null : `https://a.example/${i}` })));
  assert.equal(many.degraded, true);
  assert.equal(many.items.map((i) => i.text.content).join(''), Array.from({ length: 120 }, (_, i) => `s${i}`).join(''));
  assert.ok(many.items.every((i) => !i.text.link));
  assert.deepEqual(richTextFromPieces([]), { items: [], degraded: false });
});

test('withLinkedSources puts the links in when the pieces read as the planned text, and says so when they do not', async () => {
  const sent = [];
  const base = { async createPage(args) { sent.push(args); return { id: 'p' }; }, async retrievePage() { return {}; } };
  const rt = (s) => ({ rich_text: [{ type: 'text', text: { content: s } }] });
  const warnings = [];
  const wrapped = withLinkedSources(base, new Map([['g1', [{ text: 'One', href: 'https://a.example/1' }, { text: ' two', href: null }]], ['g2', [{ text: 'Different', href: 'https://a.example/2' }]]]), { onWarning: (w) => warnings.push(w) });
  assert.equal(typeof wrapped.retrievePage, 'function', 'everything else is the client\'s own');
  await wrapped.createPage({ parentDatabaseId: 'd', properties: { 'Geo ID': rt('g1'), 'Geo Sources': rt('One two'), 'Geo Name': { title: [] } } });
  assert.deepEqual(sent[0].properties['Geo Sources'].rich_text, [{ type: 'text', text: { content: 'One', link: { url: 'https://a.example/1' } } }, { type: 'text', text: { content: ' two' } }]);
  assert.deepEqual(sent[0].properties['Geo Name'], { title: [] }, 'other properties are untouched');
  await wrapped.createPage({ parentDatabaseId: 'd', properties: { 'Geo ID': rt('g2'), 'Geo Sources': rt('Not the same text') } });
  assert.deepEqual(sent[1].properties['Geo Sources'], rt('Not the same text'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /g2: the pieces of Geo Sources do not read as the planned text/);
  await wrapped.createPage({ parentDatabaseId: 'd', properties: { 'Geo ID': rt('g3'), 'Geo Sources': rt('Unknown claim') } });
  assert.deepEqual(sent[2].properties['Geo Sources'], rt('Unknown claim'));
  await wrapped.createPage({ parentDatabaseId: 'd', properties: { 'Geo ID': rt('g1') } });
  assert.ok(!('Geo Sources' in sent[3].properties), 'no sources planned, none added');
});

test('the input readers say what is wrong with a file', () => {
  const dir = tmp('inputs');
  const write = (name, value) => {
    const file = join(dir, name);
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
  };
  assert.throws(() => readTaxonomy(write('t1.json', 'not json')), (e) => e instanceof InputError && /cannot be read/.test(e.message));
  assert.throws(() => readTaxonomy(write('t2.json', { ...smallTaxonomy(), read_at: 'yesterday-ish' })), /read_at is not a date/);
  assert.throws(() => readTaxonomy(write('t3.json', { ...smallTaxonomy(), rows: [{ Name: '' }] })), /row 1 has no Name/);
  assert.throws(() => readTaxonomy(write('t4.json', { ...smallTaxonomy(), counterparts: 'x' })), /counterparts must be a list/);
  const tax = readTaxonomy(write('t5.json', { ...smallTaxonomy(), counterparts: undefined }));
  assert.deepEqual(tax.counterparts, []);
  assert.equal(tax.read_at, '2026-10-15T11:40:00.000Z');
  assert.throws(() => readAudit(write('a1.json', { decisions: [{ geo_id: 'g', claim: 'c', flag: 'Odd tag', outcome: 'Applies' }] })), /flag must be one of Wrong tag, Missing tag/);
  assert.throws(() => readAudit(write('a2.json', { decisions: [{ geo_id: 'g', claim: 'c', flag: 'Wrong tag', outcome: 'Maybe' }] })), /outcome must be one of/);
  assert.throws(() => readAudit(write('a3.json', { decisions: [] })), /has no decisions/);
  assert.equal(readAudit(AUDIT_FILE).decisions.length, 10);
  assert.throws(() => readPick(write('p1.json', { rows: [{ 'Geo ID': 'g', 'Geo Name': 'n' }, { 'Geo ID': 'g', 'Geo Name': 'm' }] })), /appears twice/);
  assert.equal(rulebookOps(readTaxonomy(write('t6.json', smallTaxonomy())), ['Name', 'Category']).length, 2);
  assert.deepEqual(claimOps({ rows: [{ 'Geo ID': 'g', 'Geo Name': 'n', 'Geo Is factual': false, 'Geo Score': null, 'Geo Tags': [], 'Geo Topics': '' }] }, ['Geo Name', 'Geo ID', 'Geo Is factual', 'Geo Score', 'Geo Tags', 'Geo Topics', 'Agent tags']),
    [{ key: 'g', properties: { 'Geo Name': 'n', 'Geo ID': 'g', 'Geo Is factual': false } }].map((x) => ({ key: x.key, properties: x.properties })));
  assert.throws(() => auditOps(readAudit(AUDIT_FILE), {}), (e) => e instanceof InputError && /10 audited claim\(s\) have no row/.test(e.message));
});

test('the builder and the steps reach Notion only through the client: no direct fetch, no .env read, no delete, none of the flags the rules forbid', () => {
  const scripts = join(import.meta.dirname, '..', '..', 'agents', 'claim-tagger-mvp', 'scripts');
  for (const file of ['setup.mjs', 'lib/notion-build.mjs', 'lib/setup-steps.mjs', 'lib/builder-registry.mjs']) {
    const src = readFileSync(join(scripts, file), 'utf8');
    assert.doesNotMatch(src, /\bfetch\s*\(|loadEnvFile|process\.env\.NOTION|readFileSync\([^)]*\.env\b/, `${file} reaches Notion or the token on its own`);
    assert.doesNotMatch(src, /'DELETE'|"DELETE"|in_trash\s*:\s*true|archived\s*:\s*true/, `${file} deletes or archives`);
    assert.doesNotMatch(src, /--bare|--fallback-model/, `${file} passes a flag the rules forbid`);
  }
});
