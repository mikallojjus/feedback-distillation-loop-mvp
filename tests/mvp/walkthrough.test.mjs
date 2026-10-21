// Tests for scripts/walkthrough.mjs (the practice-page builder and runner) and scripts/lib/demo-profile.mjs, against the in-memory Notion of
// fixtures/fake-notion-pages.mjs (the shared fake plus child pages and tables in a page's block list, and linked views). Nothing here reaches the
// network or reads .env: every client gets the fake's own token. The page and the manifest are the real ones of agents/claim-tagger-mvp/walkthrough,
// and nothing below depends on their exact wording: what is compared is read from the manifest and the template at the time of the run.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUN_SCRIPTS, main } from '../../agents/claim-tagger-mvp/scripts/walkthrough.mjs';
import { CLAIMS_COPY_COLUMNS, editorColumns, loadConfig, validateConfig } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import * as dp from '../../agents/claim-tagger-mvp/scripts/lib/demo-profile.mjs';
import { blockText, lintPage } from '../../agents/claim-tagger-mvp/scripts/lib/notion-blocks.mjs';
import { viewPlan } from '../../agents/claim-tagger-mvp/scripts/lib/notion-build.mjs';
import { claimColumns } from '../../agents/claim-tagger-mvp/scripts/propose.mjs';
import { BUILDER_API_VERSION, countRequests, createClient } from '../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';
import { codeRoot } from '../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';
import { lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { nextEdition, readRubric, writeEdition } from '../../agents/claim-tagger-mvp/scripts/lib/rubric.mjs';
import { notionUrl, quoted } from '../../agents/claim-tagger-mvp/scripts/lib/editor-words.mjs';
import { AUDIT_PREFIX, PlanError, applyPlan, checkPlan, isDemoRoot, newPlan } from '../../agents/claim-tagger-mvp/scripts/lib/plan.mjs';
import { createFakeNotion } from './fixtures/fake-notion.mjs';
import { createPagesFake } from './fixtures/fake-notion-pages.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const AGENT = join(REPO, 'agents', 'claim-tagger-mvp');
const NOW = new Date(2026, 9, 15, 14, 22); // 15 Oct 2026 14:22, local time
const EDITION = nextEdition(null, NOW);
const noSleep = async () => {};
const TAG = 'Context-dependent';
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const lines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const dirs = [];
function tmp(label) {
  const d = mkdtempSync(join(tmpdir(), `geo-agents-mvp-${label}-`));
  dirs.push(d);
  return d;
}
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// ---- the world ---------------------------------------------------------------------------------------------------------------------------------

// The shared fake may not know created_by and last_edited_by columns: the structure the world builds from has them taken out when it does not.
const FAKE_HAS_USER_COLUMNS = await (async () => {
  const probe = createFakeNotion();
  const page = probe.addPage({ title: 'probe' });
  const client = createClient({ token: probe.token, fetchImpl: probe.fetchImpl, apiVersion: BUILDER_API_VERSION, requestsPerSecond: 1000, sleep: noSleep });
  try {
    await client.createDatabase({ parentPageId: page, title: 'probe', properties: { Name: { type: 'title', title: {} }, By: { type: 'created_by', created_by: {} } } });
    return true;
  } catch {
    return false;
  }
})();

function structureForFake() {
  const s = read(join(AGENT, 'setup', 'structure.json'));
  if (!FAKE_HAS_USER_COLUMNS) for (const t of Object.values(s.tables)) t.columns = t.columns.filter((c) => c.type !== 'created_by' && c.type !== 'last_edited_by');
  return s;
}

function quietIo() {
  const io = { outs: [], errs: [], out: (s) => io.outs.push(s), err: (s) => io.errs.push(s) };
  io.rawOut = (s) => io.outs.push(String(s).replace(/\n$/, ''));
  io.rawErr = (s) => io.errs.push(String(s).replace(/\n$/, ''));
  return io;
}

// The production config of the repository holds the ids of the live tables once setup has run and placeholders before; the tests want real-looking ids either way.
function withRealIds(config) {
  let k = 0;
  const fill = (v) => (typeof v === 'string' && v.startsWith('<') ? `7a${String((k += 1)).padStart(30, '0')}` : v);
  const n = config.notion;
  for (const entry of [n.rulebook, ...n.claims, ...Object.values(n.databases)]) {
    entry.database_id = fill(entry.database_id);
    entry.data_source_id = fill(entry.data_source_id);
  }
  for (const key of Object.keys(n.pages)) n.pages[key] = fill(n.pages[key]);
  return config;
}

/**
 * A production state folder (config.json with the table ids of production, which no request may ever name; the structure file), a fake Notion with
 * a page called "Demos" to put the practice page under (config.notion.pages.demos, the sub-page the demo commands look under by default) and a page
 * called "Demo tests" (config.notion.pages.demo_tests, where the verification runs go and the commands do not look by default), and ways to run
 * walkthrough commands against them.
 */
function newWorld({ configure } = {}) {
  const root = tmp('wt');
  const config = withRealIds(structuredClone(loadConfig(codeRoot())));
  const production = config;
  const protectedIds = [...production.notion.protected_database_ids, ...production.notion.protected_page_ids];
  const fake = createPagesFake({ protected: protectedIds });
  const parent = fake.addPage({ title: 'Demos' });
  const testsParent = fake.addPage({ title: 'Demo tests' });
  config.notion.pages.demos = parent.replace(/-/g, '');
  config.notion.pages.demo_tests = testsParent.replace(/-/g, '');
  config.notion.requests_per_second = 1000;
  configure?.(config, fake);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  mkdirSync(join(root, 'setup'), { recursive: true });
  writeFileSync(join(root, 'setup', 'structure.json'), `${JSON.stringify(structureForFake(), null, 2)}\n`);
  let n = 0;
  const w = {
    root, fake, parent, testsParent, config, production, protectedIds, clock: NOW, link: `https://www.notion.so/Demos-${parent.replace(/-/g, '')}`, testsLink: `https://www.notion.so/Demo-tests-${testsParent.replace(/-/g, '')}`,
  };
  w.env = (extra = {}) => ({ root, fetchImpl: fake.fetchImpl, token: fake.token, sleep: noSleep, now: () => w.clock, random: () => `r${(n += 1)}`, repoRoot: root, ...extra });
  w.run = async (argv, extra = {}) => {
    const io = quietIo();
    const code = await main(argv, io, w.env(extra));
    return { code, out: io.outs.join('\n'), err: io.errs.join('\n'), outs: io.outs, errs: io.errs };
  };
  w.start = (more = [], extra = {}) => w.run(['start', '--parent', w.link, ...more], extra);
  w.demos = () => {
    const base = join(root, 'runs', 'demos');
    return existsSync(base) ? readdirSync(base).sort() : [];
  };
  w.dir = (id = w.demos().at(-1)) => join(root, 'runs', 'demos', id);
  w.demo = (id) => read(join(w.dir(id), 'demo.json'));
  w.rows = (table, id) => fake.plainRows(w.demo(id).databases[table].database_id);
  w.rowBy = (table, column, value, id) => w.rows(table, id).find((r) => r[column] === value);
  w.db = (table, id) => w.demo(id).databases[table].database_id;
  return w;
}

const real = () => {
  const { manifest } = dp.loadManifest(join(AGENT, 'walkthrough', 'manifest.json'));
  const template = dp.loadTemplate(join(AGENT, 'walkthrough', 'page.md'));
  return { manifest, template };
};

/** The page the template makes, as the lines of fake.outline(): what the page must read like from top to bottom. */
function expectedOutline({ fallbackKeys = [] } = {}) {
  const { template } = real();
  const model = dp.pageModel(template.text, { edition: EDITION, date: dp.dateWord(NOW) });
  const line = (b) => `${b.type}|${b.type === 'table' ? `width ${b.table.table_width}` : blockText(b)}`;
  const out = [];
  for (const item of model.pre) {
    if (item.kind === 'block') out.push(line(item.block));
    else if (fallbackKeys.includes(item.key)) out.push(`paragraph|${dp.FALLBACK_TEXT[item.key]}`);
    else out.push(`linked|${item.name}`);
  }
  for (const t of Object.values(dp.PRACTICE_TITLES)) out.push(`database|${t}`);
  for (const item of model.post) out.push(item.block.type === 'toggle' ? 'toggle|Help' : line(item.block));
  return out;
}

const POST_BODIES = (fake, path) => fake.requests.filter((r) => r.method === 'POST' && r.path === path && r.status === 200).map((r) => r.body);
const methodsOf = (fake) => new Set(fake.requests.map((r) => r.method));

// ---- pure pieces -----------------------------------------------------------------------------------------------------------------------------------

test('parseNotionLink reads a pasted link, an id with or without dashes, and a page peeked at over a table; anything else is null', () => {
  const id = '3fa273e214eb805199f3d12ef01db453';
  assert.equal(dp.parseNotionLink(`https://www.notion.so/Workspace/Demos-${id}?pvs=4`), id);
  assert.equal(dp.parseNotionLink(`https://app.notion.com/p/${id}`), id);
  assert.equal(dp.parseNotionLink(`www.notion.so/${id}#abc`), id);
  assert.equal(dp.parseNotionLink(id), id);
  assert.equal(dp.parseNotionLink('3FA273E2-14EB-8051-99F3-D12EF01DB453'), id);
  assert.equal(dp.parseNotionLink(`<https://www.notion.so/Face-Cafe-${id}>`), id, 'hex letters in the title are not taken for the id');
  assert.equal(dp.parseNotionLink('https://www.notion.so/17b99d1873384a1bb688c0075de45f78?v=aaa&p=3fa273e214eb81ef8504cb40e3bd7052&pm=s'), '3fa273e214eb81ef8504cb40e3bd7052');
  for (const bad of ['', '   ', 'hello', 'https://example.com/page', 'notion', null, undefined]) assert.equal(dp.parseNotionLink(bad), null, String(bad));
});

test('a demo id is the local date and time plus a short suffix, a title the stamp of the start, and neither holds a colon', () => {
  assert.equal(dp.newDemoId(NOW, () => 'ab12cd'), '20261015-1422-ab12cd');
  assert.match(dp.newDemoId(NOW), /^20261015-1422-[0-9a-f]{6}$/);
  assert.equal(dp.demoTitle(NOW), 'Claim tagger practice · 15 Oct 14:22');
  assert.equal(dp.dateWord(NOW), '15 Oct');
  assert.ok(!dp.newDemoId(NOW, () => 'a:b/c').includes(':'));
  assert.equal(dp.demoDir('/x', '20261015-1422-ab12cd').endsWith('20261015-1422-ab12cd'), true);
  for (const bad of ['..', '.', 'a/b', 'a\\b', '', '../x', 'C:x']) assert.throws(() => dp.demoDir('/x', bad), dp.ManifestError, bad);
});

test('the preview keeps the marker lines and adds a comment under each; it passes the page lint, also with the fallback paragraphs in place of the views', () => {
  const { manifest, template } = real();
  const model = dp.pageModel(template.text, { edition: EDITION, date: '15 Oct' });
  const plain = dp.annotatedPreview(model.rendered, {});
  assert.deepEqual(lintPage(plain, { manifest }).problems, []);
  assert.equal(plain.split('\n').filter((l) => /^\{\{view:/.test(l)).length, 2);
  assert.equal(plain.split('\n').filter((l) => l.startsWith('<!--')).length, 3, 'one under each view line and one under the tables line');
  for (const t of Object.values(dp.PRACTICE_TITLES)) assert.ok(plain.includes(t), t);
  const fallback = dp.annotatedPreview(model.rendered, { fallbackKeys: ['your_queue', 'lessons_waiting'] });
  assert.deepEqual(lintPage(fallback, { manifest }).problems, []);
  assert.ok(!fallback.includes('{{view:'));
  for (const text of Object.values(dp.FALLBACK_TEXT)) assert.ok(fallback.includes(text));
  assert.ok(dp.annotatedPreview(model.rendered, { tablesPosition: 'end' }).includes('sit at the end of the page'));
});

test('the page model: the text before the tables, the two view slots with the block each goes under, and the Help toggle with its text apart', () => {
  const { template } = real();
  const model = dp.pageModel(template.text, { edition: EDITION, date: '15 Oct' });
  assert.deepEqual(model.slots.map((s) => s.key), ['your_queue', 'lessons_waiting']);
  const anchors = dp.anchorIndexes(model);
  const pre = dp.preBlocks(model);
  assert.match(dp.signature(pre[anchors.your_queue]), /Doing the work/, 'the view goes under the Doing the work line of its step');
  assert.match(dp.signature(pre[anchors.lessons_waiting]), /Doing the work/);
  assert.equal(model.toggle.type, 'toggle');
  const { stub, children } = dp.splitToggle(model.toggle);
  assert.equal(stub.toggle.children, undefined);
  assert.ok(children.length > 0 && children.some((c) => c.type === 'table'));
  const all = dp.expectedContent(model);
  assert.equal(all.length, pre.length + 1);
  assert.equal(dp.expectedContent(model, ['your_queue']).length, all.length + 1);
  assert.throws(() => dp.pageModel('{{view:Your queue}}\n\n{{tables}}\n', {}), dp.ManifestError, 'a view with no block before it');
  assert.throws(() => dp.pageModel('Some text.\n\n{{view:Decide these rows}}\n\n{{tables}}\n', {}), dp.ManifestError, 'a view that is not one of the two');
  assert.throws(() => dp.pageModel('Some text.\n', {}), dp.ManifestError, 'no tables placeholder');
});

test('signatures compare the type and the text with white space made one space, and a table by its width', () => {
  const para = (content) => ({ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content }, plain_text: content }] } });
  assert.equal(dp.signature(para('a  b\n c ')), 'paragraph|a b c');
  assert.equal(dp.signature(para('a b c')), dp.signature(para(' a b\tc\n')));
  assert.notEqual(dp.signature(para('a b c')), dp.signature({ type: 'quote', quote: para('a b c').paragraph }));
  assert.equal(dp.signature({ type: 'table', table: { table_width: 3 } }), 'table|3');
  assert.equal(dp.signature({ type: 'divider', divider: {} }), 'divider|');
  assert.equal(dp.signature(null), '');
});

test('stepOf maps every state of the design from the claims: 1, 2, 3, 4, 5, 6, the not-passed branch, 7 stopped early, 7 to read, complete', () => {
  const open = [{ claim: 'a', geo_id: 'a', key: 'a::T' }, { claim: 'b', geo_id: 'b', key: 'b::T' }];
  const READ = 'no tags\n1 waits for an editor · edition e';
  const claim = (geo_id, over = {}) => ({ geo_id, review_status: null, agent_notes: READ, ...over });
  const claims = (a = {}, b = {}) => [claim('a', a), claim('b', b), claim('c', { review_status: 'Reviewed', agent_notes: '' })];
  const unread = { agent_notes: '' };
  const done = { review_status: 'Reviewed' };
  const step = (cl, lessons = [], ledger = [], settings = { last_run_summary: 'Tag · 15 Oct 10:42 · 7 claims' }) => dp.stepOf({ claims: cl, ledger, lessons, open, settings });
  // a fresh page: nothing has written a Last run summary (the build leaves it empty, status writes nothing, the tag step writes it with the notes)
  const fresh = (cl) => dp.stepOf({ claims: cl, ledger: [], lessons: [], open, settings: { last_run_summary: null } });
  assert.deepEqual(fresh(claims(unread, unread)), { step: 1 });
  assert.deepEqual(fresh(claims(unread)), { step: 1 });
  assert.deepEqual(dp.stepOf({ claims: claims(unread, unread), ledger: [], lessons: [], open, settings: { last_run_summary: '  ' } }), { step: 1 }, 'white space is no summary');
  assert.deepEqual(dp.stepOf({ claims: claims(unread, unread), ledger: [], lessons: [], open }), { step: 1 }, 'no settings row at all: nothing has run');
  assert.deepEqual(dp.stepOf({ claims: claims(unread, unread), ledger: [], lessons: [], open, settings: null }), { step: 1 });
  // a command wrote a Last run summary and the open claims still have no Agent notes: step 2
  assert.deepEqual(step(claims(unread, unread)), { step: 2 });
  assert.deepEqual(step(claims(unread)), { step: 2 }, 'one claim the agent has not read is still step 2');
  assert.deepEqual(step(claims({ review_status: 'To review', agent_notes: '  ' }, {})), { step: 2 }, 'white space is no notes, and To review is not Reviewed');
  // with notes on the claims the step is 3 whatever Last run summary says (a page whose summary was cleared by hand is not sent back)
  assert.deepEqual(fresh(claims()), { step: 3, remaining: 2 });
  assert.deepEqual(step(claims()), { step: 3, remaining: 2 });
  assert.deepEqual(step(claims({ review_status: 'To review' }, {})), { step: 3, remaining: 2 });
  assert.deepEqual(step(claims(done, {})), { step: 3, remaining: 1 }, 'one claim decided is still step 3, with one claim left');
  assert.deepEqual(step(claims({ ...done, agent_notes: '' }, {})), { step: 3, remaining: 1 }, 'a claim the editor decided before the agent read it is decided, not unread');
  assert.deepEqual(step(claims(done, done)), { step: 4 });
  const lesson = (over) => ({ Lesson: 'L', Status: 'Proposed', 'Safety check result': null, created: '2026-10-15T10:00:00Z', ...over });
  const both = claims(done, done);
  assert.equal(step(both, [lesson()]).step, 5);
  assert.equal(step(both, [lesson({ Status: 'Approved' })]).step, 6);
  assert.equal(step(both, [lesson({ Status: 'Approved' })]).branch, undefined);
  const failed = step(both, [lesson({ Status: 'Approved', 'Safety check result': "FAIL: 'x' now Does not apply" })]);
  assert.deepEqual([failed.step, failed.branch], [6, 'not-passed']);
  const live = [lesson({ Status: 'Live' })];
  const stopped = step(both, live, [{ Key: 'a::T', 'Follow-up': 'Fixed' }]);
  assert.deepEqual([stopped.step, stopped.branch], [7, 'stopped'], 'the ledger row of b has no Follow-up');
  assert.deepEqual([step(both, live).step, step(both, live).branch], [7, 'stopped'], 'no ledger row at all is a follow-up that has not run');
  const read = step(both, live, [{ Key: 'a::T', 'Follow-up': 'Fixed' }, { Key: 'b::T', 'Follow-up': 'Still wrong' }]);
  assert.deepEqual([read.step, read.branch], [7, 'read']);
  const fixed = step(both, live, [{ Key: 'a::T', 'Follow-up': 'Fixed' }, { Key: 'b::T', 'Follow-up': 'Fixed' }, { Key: 'c::T', 'Follow-up': null }]);
  assert.equal(fixed.step, 'complete');
  assert.equal(step(both, [lesson({ Status: 'Rejected' })]).step, 'complete', 'a rejected rule change ends the demo');
  assert.equal(step(both, [lesson({ Status: 'Rolled back' })]).step, 'complete');
  assert.equal(step(both, [lesson({ Status: 'Rejected', created: '2026-10-15T09:00:00Z' }), lesson({ Lesson: 'M', Status: 'Approved', created: '2026-10-15T11:00:00Z' })]).step, 6, 'a rule change in progress wins over a rejected one');
  // the ledger is not what step 2 and 3 are read from: the claims are
  assert.deepEqual(dp.stepOf({ claims: claims(unread, unread), ledger: [{ Key: 'a::T', 'Agent proposal': 'Applies' }], lessons: [], open, settings: { last_run_summary: 'Tag · 15 Oct 10:42 · 7 claims' } }), { step: 2 });
  assert.ok(dp.stepOf({ claims: [], lessons: [], open }).problem, 'a claim that is not in Claims is a problem, not a step');
  assert.match(dp.stepOf({ claims: [claim('a')], lessons: [], open }).problem, /not in Claims \(b\)/);
  assert.ok(dp.stepOf({ claims: claims(), lessons: [], open: [] }).problem, 'no claims that wait is a problem too');
});

test('the config of a demo profile is valid, holds placeholders where the practice page will put its ids, and protects everything of production', () => {
  const production = withRealIds(structuredClone(loadConfig(codeRoot())));
  const cfg = dp.buildDemoConfig(production, { demoId: '20261015-1422-ab12cd', title: 'Claim tagger practice · 15 Oct 14:22', parentId: '0123456789abcdef0123456789abcdef', tag: TAG });
  const { ok, errors } = validateConfig(cfg);
  assert.deepEqual(errors, []);
  assert.equal(ok, true);
  assert.equal(cfg.demo, true);
  assert.equal(cfg.demo_id, '20261015-1422-ab12cd');
  assert.equal(cfg.demo_title, 'Claim tagger practice · 15 Oct 14:22');
  assert.equal(cfg.notion.parent_page_id, '0123456789abcdef0123456789abcdef');
  assert.equal(cfg.notion.demo_parent_page_id, '0123456789abcdef0123456789abcdef');
  assert.deepEqual(cfg.notion.pages, { proposal: '<none>', demos: '<none>', demo_tests: '<none>' });
  for (const entry of [cfg.notion.rulebook, cfg.notion.claims[0], ...Object.values(cfg.notion.databases)]) {
    assert.equal(entry.database_id, '<setup>');
    assert.equal(entry.data_source_id, '<setup>');
  }
  assert.equal(cfg.notion.claims[0].name, 'demo_claims');
  assert.equal(cfg.notion.claims[0].label, 'Claims');
  assert.deepEqual(cfg.notion.claims[0].columns, production.notion.claims[0].columns);
  assert.deepEqual(cfg.notion.claims[0].write_columns, production.notion.claims[0].write_columns);
  assert.deepEqual(cfg.notion.views, {});
  assert.deepEqual(cfg.tags, { default: 'text' });
  assert.deepEqual(cfg.judge.groups, { G1: [TAG] });
  assert.deepEqual(cfg.judge.rerun, production.judge.rerun);
  assert.deepEqual(cfg.queue, production.queue);
  assert.deepEqual(cfg.distill, production.distill);
  assert.deepEqual(cfg.gate, production.gate);
  assert.deepEqual(cfg.editor_columns, production.editor_columns);
  const protectedIds = new Set([...cfg.notion.protected_database_ids, ...cfg.notion.protected_page_ids].map((id) => id.replace(/-/g, '')));
  for (const id of [...production.notion.protected_database_ids, ...production.notion.protected_page_ids]) assert.ok(protectedIds.has(id.replace(/-/g, '')), id);
  for (const t of [production.notion.rulebook, production.notion.claims[0], ...Object.values(production.notion.databases)]) {
    assert.ok(protectedIds.has(t.database_id.replace(/-/g, '')) && protectedIds.has(t.data_source_id.replace(/-/g, '')), 'a table of production is protected');
  }
  assert.ok(protectedIds.has(production.notion.parent_page_id), 'and so is the production page');
  assert.ok(cfg.notion.protected_database_ids.includes(production.notion.parent_page_id) && cfg.notion.protected_page_ids.includes(production.notion.parent_page_id), 'in both lists');
  assert.notEqual(production.demo, true, 'production is left as it was');
  assert.equal(production.notion.claims[0].name, 'claims_copy');
  // the ids of the practice page's tables go in as they are made
  dp.setTableIds(cfg, 'rulebook', { database_id: 'AAAAAAAA-0000-4000-8000-000000000001', data_source_id: 'bbbbbbbb000040008000000000000002' });
  assert.equal(cfg.notion.rulebook.database_id, 'aaaaaaaa000040008000000000000001');
  assert.equal(cfg.notion.rulebook.data_source_id, 'bbbbbbbb000040008000000000000002');
  dp.setTableIds(cfg, 'claims_copy', { database_id: 'c'.repeat(32), data_source_id: 'd'.repeat(32) });
  dp.setTableIds(cfg, 'rule_changes', { database_id: 'e'.repeat(32), data_source_id: 'f'.repeat(32) });
  assert.equal(cfg.notion.claims[0].database_id, 'c'.repeat(32));
  assert.equal(cfg.notion.databases.rule_changes.data_source_id, 'f'.repeat(32));
  assert.equal(validateConfig(cfg).ok, true);
});

test('the practice structure carries the practice titles and the production columns, and nothing is shared with the structure it came from', () => {
  const original = read(join(AGENT, 'setup', 'structure.json'));
  const practice = dp.practiceStructure(original);
  assert.deepEqual(Object.values(practice.tables).map((t) => t.title), Object.values(dp.PRACTICE_TITLES));
  assert.deepEqual(practice.pages, []);
  assert.equal(original.tables.rulebook.title, 'Rulebook copy', 'the original is not changed');
  assert.equal(practice.views.length, original.views.length);
  assert.deepEqual(practice.tables.tag_decisions.columns, original.tables.tag_decisions.columns);
  assert.deepEqual(dp.writableColumns(practice, 'agent_settings'), ['Name', 'Paused', 'Rulebook edition', 'Last run summary']);
  // the Claims table: the thirteen Geo columns, the agent's four in that order, then the editor's four; the verified tags are a relation to the Rulebook
  const claims = practice.tables.claims_copy.columns;
  assert.deepEqual(claims.slice(0, 13).map((c) => c.name), CLAIMS_COPY_COLUMNS);
  assert.deepEqual(claims.slice(13).map((c) => c.name), ['Agent tags', 'Agent notes', 'Agent confidence', 'Agent reasons', ...Object.values(dp.CLAIM_COLUMNS)]);
  const verified = claims.find((c) => c.name === dp.CLAIM_COLUMNS.verified);
  assert.deepEqual([verified.type, verified.relation_to], ['relation', 'rulebook']);
  assert.deepEqual(claims.find((c) => c.name === 'Review status').options, ['To review', 'Reviewed']);
  assert.deepEqual(claims.find((c) => c.name === 'Why wrong').options, ['Agent slip', 'Rule unclear', 'Rule should change']);
  // the names of the editor's columns are the production config's own, and the config lists them as the editor's
  const entry = loadConfig(codeRoot()).notion.claims[0];
  assert.deepEqual(dp.CLAIM_COLUMNS, { verified: entry.columns.verified, review_status: entry.columns.review_status, why_wrong: entry.columns.why_wrong, notes: entry.columns.notes });
  assert.deepEqual(editorColumns(loadConfig(codeRoot()), 'claims_copy'), Object.values(dp.CLAIM_COLUMNS));
  // the five views of the page are in the structure, each on the table the page puts it on; the two views of the ledger are not among them
  const where = { ...Object.fromEntries(Object.entries(dp.LINKED_VIEWS)), ...Object.fromEntries(Object.entries(dp.TAB_VIEWS).map(([k, v]) => [k, v.table])) };
  assert.deepEqual(Object.keys(where).sort(), Object.keys(dp.VIEW_NAMES).sort());
  for (const [key, table] of Object.entries(where)) assert.equal(practice.views.find((v) => v.name === dp.VIEW_NAMES[key])?.table, table, key);
  assert.deepEqual(practice.views.filter((v) => v.table === 'tag_decisions').map((v) => v.name), ['Your queue (ledger)', 'Needs your note (ledger)']);
});

test('bufferedLog keeps the events of a request until its folder exists, then writes them first and the later ones after', () => {
  const dir = tmp('log');
  const file = join(dir, 'later', 'requests.jsonl');
  const log = dp.bufferedLog();
  log.log({ method: 'GET', path: '/pages/x', status: 200, attempt: 1 });
  assert.ok(!existsSync(join(dir, 'later')), 'nothing is written before the folder is chosen');
  log.attach(file);
  log.log({ method: 'POST', path: '/pages', status: 200, attempt: 1 });
  const rows = lines(file);
  assert.deepEqual(rows.map((r) => `${r.method} ${r.path}`), ['GET /pages/x', 'POST /pages']);
  assert.ok(rows.every((r) => typeof r.ts === 'string' && r.attempt === 1));
  assert.deepEqual(countRequests(file), { total: 2, byMethod: { GET: 1, POST: 1, PATCH: 0 }, writes: 1 });
});

test('the demos on disk: newest first, only folders with a demo.json, a ready one on request, and no id that leaves the folder', () => {
  const root = tmp('demos');
  const make = (id, demo) => {
    mkdirSync(join(root, 'runs', 'demos', id), { recursive: true });
    if (demo) writeFileSync(join(root, 'runs', 'demos', id, 'demo.json'), JSON.stringify(demo));
  };
  assert.deepEqual(dp.listDemos(root), []);
  const UNDER = '3fa273e214eb81ada268f4b511182378';
  assert.throws(() => dp.pickDemo(root, undefined, { under: UNDER }), /there is no practice page under Demos yet/);
  make('a-old', { created_at: '2026-10-14T10:00:00Z', state: 'ready' });
  make('b-new', { created_at: '2026-10-15T10:00:00Z', state: 'planned' });
  make('c-dry-run');
  writeFileSync(join(root, 'runs', 'demos', 'c-dry-run', 'preview.md'), 'x');
  make('d-broken', null);
  writeFileSync(join(root, 'runs', 'demos', 'd-broken', 'demo.json'), '{ not json');
  assert.deepEqual(dp.listDemos(root).map((d) => d.id), ['b-new', 'a-old']);
  assert.equal(dp.pickDemo(root, 'a-old').id, 'a-old');
  assert.equal(dp.pickDemo(root, 'b-new').id, 'b-new', 'a page that is named is reached whatever its state');
  // without a name the page is looked for under the Demos sub-page, and only a page whose profile this build reads counts (these have no profile at all)
  assert.throws(() => dp.pickDemo(root), /the Demos page is not set in config/, 'no Demos page to look under is an error, not a guess');
  assert.throws(() => dp.pickDemo(root, undefined, { under: '<none>' }), /the Demos page is not set/);
  assert.throws(() => dp.pickDemo(root, undefined, { under: UNDER }), /there is no practice page under Demos yet/);
  assert.throws(() => dp.pickDemo(root, undefined, { under: UNDER, ready: true }), /there is no finished practice page under Demos yet/);
  assert.equal(typeof dp.profileProblem(dp.pickDemo(root, 'a-old')), 'string', 'a folder without a profile has a problem, not a crash');
  assert.throws(() => dp.pickDemo(root, 'c-dry-run'), /no demo\.json/);
  assert.throws(() => dp.pickDemo(root, 'nope'), dp.ManifestError);
  assert.throws(() => dp.pickDemo(root, '..'), dp.ManifestError);
  assert.throws(() => dp.pickDemo(root, '../demos/a-old'), dp.ManifestError);
});

test('the manifest describes the claims\' columns: five Reviewed claims with the audit\'s words, two To review with what the editor types, and a shape that is checked', () => {
  const { manifest } = real();
  const V = dp.CLAIM_COLUMNS.verified;
  assert.equal(manifest.manifest_version, '2026-10-16.1');
  assert.equal(manifest.calibration.status, 'pending');
  assert.ok(manifest.calibration.runs.length >= 5, 'the earlier calibration runs are kept');
  assert.deepEqual(manifest.decided.map((d) => d.claim), ['cnn', 'dallas', 'contractor', 'kennedy', 'stopgap']);
  for (const d of manifest.decided) {
    assert.equal(d['Review status'], 'Reviewed', d.claim);
    assert.equal(d['Why wrong'], 'Agent slip', d.claim);
    assert.ok(d['Challenged tags notes'].startsWith(AUDIT_PREFIX), d.claim);
    assert.ok(['Applies', 'Does not apply'].includes(d['Agent proposal']), d.claim);
    assert.deepEqual(d[V], ['cnn', 'dallas'].includes(d.claim) ? [TAG] : [], d.claim);
    assert.ok(!('Tag outcome' in d) && !('Your reasoning' in d), 'the ledger columns are worked out from the claim, not stored');
    // every note is a sentence that ends with a full stop; where the audit recorded no reasoning the note says which way the editor went against the agent's answer,
    // and never "the editor agreed", which sits beside Why wrong "Agent slip" (the agent misread it) like a contradiction
    const note = d['Challenged tags notes'];
    assert.ok(note.endsWith('.'), `${d.claim}: the note ends with a full stop`);
    assert.ok(!/editor agreed/.test(note), d.claim);
    if (/no reasoning was recorded/.test(note)) {
      const confirmed = d[V].length > 0; // the tag is among the verified tags
      assert.equal(note, `${AUDIT_PREFIX}: the editor ${confirmed ? 'confirmed this tag, which the agent had read the other way' : 'did not confirm this tag, which the agent had applied'}; no reasoning was recorded.`, d.claim);
      assert.equal(d['Agent proposal'], confirmed ? 'Does not apply' : 'Applies', `${d.claim}: the note says what the agent had answered`);
    }
  }
  assert.deepEqual(manifest.decided.filter((d) => /no reasoning was recorded/.test(d['Challenged tags notes'])).map((d) => d.claim), ['cnn', 'dallas', 'kennedy'], 'the three decisions the audit gave no words for');
  assert.deepEqual(manifest.open.map((o) => o.claim), ['presspool', 'aiforce']);
  for (const o of manifest.open) {
    assert.equal(o['Review status'], 'To review', o.claim);
    assert.deepEqual(Object.keys(o.enter), [V, 'Review status', 'Why wrong', 'Challenged tags notes'], o.claim);
    assert.equal(o.enter['Review status'], 'Reviewed');
    assert.equal(o.enter['Why wrong'], 'Rule unclear');
  }
  assert.deepEqual(manifest.open[0].enter[V], [], 'the press pool: the tag does not apply, so nothing is verified');
  assert.deepEqual(manifest.open[1].enter[V], [TAG], 'the AI Force: the tag applies');
  assert.deepEqual(manifest.expect.claims_views, ['Your queue', 'Needs your note', 'Agent disagreed']);
  assert.deepEqual(manifest.steps.map((s) => s.affects), [[], ['Claims'], ['Claims'], ['Rule changes'], ['Rule changes'], ['Rulebook', 'Rule changes', 'Agent settings'], ['Claims']], 'no step affects Tag decisions');

  // the shape is checked when the manifest is read
  const broken = (change) => {
    const m = structuredClone(manifest);
    change(m);
    const file = join(tmp('bad-shape'), 'manifest.json');
    writeFileSync(file, JSON.stringify(m));
    return () => dp.loadManifest(file);
  };
  assert.throws(broken((m) => { m.decided[0]['Review status'] = 'To review'; }), /decided\[0\] \(cnn\): Review status must be Reviewed/);
  assert.throws(broken((m) => { m.decided[0][V] = ['Wordy']; }), /decided\[0\] \(cnn\): Claim quality tags — verified must be a list of tag names; the page has one tag, Context-dependent/);
  assert.throws(broken((m) => { m.decided[0][V] = TAG; }), /must be a list of tag names/);
  assert.throws(broken((m) => { m.decided[1]['Why wrong'] = 'Because'; }), /decided\[1\] \(dallas\): Why wrong must be one of/);
  assert.throws(broken((m) => { m.decided[2]['Challenged tags notes'] = ' '; }), /decided\[2\] \(contractor\): Challenged tags notes is missing/);
  assert.throws(broken((m) => { m.decided[3]['Agent proposal'] = 'Maybe'; }), /decided\[3\] \(kennedy\): Agent proposal must be one of/);
  assert.throws(broken((m) => { m.open[0]['Review status'] = 'Reviewed'; }), /open\[0\] \(presspool\): Review status is To review when the page is made/);
  assert.throws(broken((m) => { m.open[1].enter[V] = ['Wordy']; }), /open\[1\] \(aiforce\)\.enter: Claim quality tags — verified must be a list of tag names/);
  assert.throws(broken((m) => { m.open[1].enter['Review status'] = 'To review'; }), /enter: Review status must be Reviewed/);
  assert.throws(broken((m) => { delete m.open[0].enter['Challenged tags notes']; }), /open\[0\] \(presspool\)\.enter: Challenged tags notes is missing/);
  assert.doesNotThrow(broken(() => {}));
});

test('the rows of the page come from the manifest: a decided claim is created Reviewed, an open one To review and nothing else, and the ledger has a row for each decided claim only', () => {
  const { manifest } = real();
  const V = dp.CLAIM_COLUMNS.verified;
  const pages = { [TAG]: '0a9e0000-0000-4000-8000-0000000000aa' };
  const links = Object.fromEntries(manifest.claims.map((c) => [c['Geo ID'], `https://www.notion.so/${c['Geo ID']}`]));
  const decided = new Map(manifest.decided.map((d) => [d.claim, d]));
  // the editor's columns of a claim, as the cells of its create
  for (const c of manifest.claims) {
    const cells = dp.claimEditorCells(manifest, c, pages);
    const d = decided.get(c.key);
    if (!d) {
      assert.deepEqual(cells, { 'Review status': 'To review' }, `${c.key}: an open claim starts To review, with the other three columns empty`);
      continue;
    }
    assert.equal(cells['Review status'], 'Reviewed', c.key);
    assert.equal(cells['Why wrong'], 'Agent slip', c.key);
    assert.equal(cells['Challenged tags notes'], d['Challenged tags notes'], c.key);
    if (d[V].length) assert.deepEqual(cells[V], [pages[TAG]], `${c.key}: the relation holds the page id of the tag's row`);
    else assert.ok(!(V in cells), `${c.key}: no tag verified, so the relation is left empty`);
  }
  assert.throws(() => dp.claimEditorCells(manifest, manifest.claims.find((c) => c.key === 'cnn'), {}), /names the tag Context-dependent .* which has no row in the Rulebook/);
  // the ledger: one row for each decided claim, as the tag step copies a decision
  const ops = dp.ledgerOps(manifest, links);
  assert.equal(ops.length, manifest.decided.length);
  assert.deepEqual(ops.map((o) => o.key), manifest.claims.filter((c) => decided.has(c.key)).map((c) => `${c['Geo ID']}::${TAG}`));
  for (const op of ops) {
    const c = manifest.claims.find((x) => x['Geo ID'] === op.key.split('::')[0]);
    const d = decided.get(c.key);
    assert.deepEqual(op.properties, {
      Claim: c['Geo Name'], Key: op.key, Tag: TAG, 'Claim link': links[c['Geo ID']], 'Agent proposal': d['Agent proposal'],
      'Tag outcome': d[V].length ? 'Applies' : 'Does not apply', 'Why wrong': 'Agent slip', 'Your reasoning': d['Challenged tags notes'],
    }, c.key);
    assert.deepEqual(dp.ledgerCopy(manifest, c), { 'Agent proposal': d['Agent proposal'], 'Tag outcome': op.properties['Tag outcome'], 'Why wrong': 'Agent slip', 'Your reasoning': d['Challenged tags notes'] });
  }
  assert.equal(dp.ledgerCopy(manifest, manifest.claims.find((c) => c.key === 'presspool')), null, 'an open claim has no copy');
  assert.ok(ops.every((o) => !('Decided under' in o.properties) && !('Follow-up' in o.properties) && !('Agent confidence' in o.properties) && !('Rulebook edition' in o.properties)));
  assert.equal(dp.ledgerOps(manifest, {}).every((o) => !('Claim link' in o.properties)), true, 'a claim with no link yet gets no link');
  // the keys: the ledger key of every claim, and of the two that wait
  const keys = dp.openKeys(manifest);
  assert.equal(keys.open.length + keys.decided.length, manifest.claims.length);
  assert.equal(keys.open.length, manifest.open.length);
  assert.deepEqual(dp.openClaims(manifest).map((o) => [o.claim, o.key]), manifest.open.map((o) => [o.claim, `${manifest.claims.find((c) => c.key === o.claim)['Geo ID']}::${TAG}`]));
  assert.deepEqual(dp.openClaims(manifest).map((o) => o.key), keys.open);
  const book = dp.rulebookRow(manifest);
  assert.equal(typeof book['Example Claims'], 'string');
  assert.equal(book['Example Claims'].split('\n').length, manifest.tag['Example Claims'].length);
  assert.ok(!('copied_from' in book));
});

test('placementFetch spells the two placements the client has no argument for and leaves every other request alone', async () => {
  const seen = [];
  const inner = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response('{}', { status: 200 });
  };
  const f = dp.placementFetch(inner);
  const body = (i) => JSON.parse(i.init.body);
  await f('https://api.notion.com/v1/views', { method: 'POST', body: JSON.stringify({ database_id: 'db', data_source_id: 'ds', name: 'V', type: 'table', position: { type: 'after_block', page_id: 'p', block_id: 'b' } }) });
  assert.deepEqual(body(seen[0]), { data_source_id: 'ds', name: 'V', type: 'table', create_database: { parent: { type: 'page_id', page_id: 'p' }, position: { type: 'after_block', block_id: 'b' } } });
  const plainView = { database_id: 'db', data_source_id: 'ds', name: 'V', type: 'table', position: { type: 'start' } };
  await f('https://api.notion.com/v1/views', { method: 'POST', body: JSON.stringify(plainView) });
  assert.deepEqual(body(seen[1]), plainView, 'a tab view passes as it is');
  await f('https://api.notion.com/v1/blocks/pg/children', { method: 'PATCH', body: JSON.stringify({ children: [{ type: 'paragraph', __after: 'blk' }, { type: 'divider' }] }) });
  assert.deepEqual(body(seen[2]), { children: [{ type: 'paragraph' }, { type: 'divider' }], after: 'blk' });
  const ordinary = JSON.stringify({ children: [{ type: 'paragraph' }] });
  await f('https://api.notion.com/v1/blocks/pg/children', { method: 'PATCH', body: ordinary });
  assert.equal(seen[3].init.body, ordinary);
  await f('https://api.notion.com/v1/pages/x', { method: 'GET' });
  assert.equal(seen[4].init.body, undefined);
  await f('https://api.notion.com/v1/databases', { method: 'POST', body: '{"a":1}' });
  assert.equal(seen[5].init.body, '{"a":1}');
});

// ---- start: the dry run ---------------------------------------------------------------------------------------------------------------------------

test('start --dry-run sends one GET and nothing else; it writes preview.md and setup-plan.json, which pass the lint, and says how to build for real', async () => {
  const w = newWorld();
  const r = await w.start(['--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.equal(w.fake.requests.length, 1);
  assert.equal(w.fake.requests[0].method, 'GET');
  assert.match(w.fake.requests[0].path, /^\/pages\//);
  assert.deepEqual(w.demos().length, 1);
  assert.deepEqual(readdirSync(w.dir()).sort(), ['preview.md', 'setup-plan.json'], 'a dry run writes these two files and no profile');
  const { manifest } = real();
  const preview = readFileSync(join(w.dir(), 'preview.md'), 'utf8');
  assert.deepEqual(lintPage(preview, { manifest }).problems, []);
  const plan = read(join(w.dir(), 'setup-plan.json'));
  assert.deepEqual(plan.requests.map((q) => `${q.method} ${q.path.replace(/\/[0-9a-f]{32}/, '/<parent>')}`).filter((s, i, a) => a.indexOf(s) === i), [
    'GET /pages/<parent>', 'POST /pages', 'PATCH /blocks/<page>/children', 'POST /databases', 'PATCH /data_sources/<Claims>', 'PATCH /blocks/<toggle>/children', 'POST /views',
  ]);
  assert.equal(plan.requests.filter((q) => q.path === '/databases').length, 5);
  assert.deepEqual(plan.requests.filter((q) => q.path === '/databases').map((q) => q.body.title), Object.values(dp.PRACTICE_TITLES));
  // the relation of the Claims to the Rulebook needs the Rulebook, so it is added by a request of its own after the five tables
  const relation = plan.requests.find((q) => q.path === '/data_sources/<Claims>');
  assert.deepEqual(Object.keys(relation.body.properties), [dp.CLAIM_COLUMNS.verified]);
  assert.equal(relation.body.properties[dp.CLAIM_COLUMNS.verified].type, 'relation');
  assert.equal(relation.body.properties[dp.CLAIM_COLUMNS.verified].relation.data_source_id, '<Rulebook>');
  assert.ok(plan.requests.indexOf(relation) > plan.requests.findLastIndex((q) => q.path === '/databases'), 'after the last table');
  assert.ok(plan.requests.filter((q) => q.path === '/databases').every((q) => !Object.hasOwn(q.body.initial_data_source.properties, dp.CLAIM_COLUMNS.verified)), 'the relation is not part of a table create');
  assert.deepEqual(plan.requests.filter((q) => q.path === '/views').map((q) => q.body.name), ['Rulebook', 'Needs your note', 'Agent disagreed', 'Your queue', 'Lessons waiting']);
  assert.deepEqual(Object.keys(plan.rows), ['rulebook', 'claims_copy', 'tag_decisions', 'agent_settings']);
  assert.deepEqual(Object.values(plan.rows).map((list) => list.length), [1, 7, 5, 1], 'the ledger has a row for each decided claim and none for the two that wait');
  assert.equal(plan.plan.counts.rows, 14);
  assert.deepEqual(plan.rows.claims_copy.find((o) => o.properties['Geo ID'] === manifest.claims.find((c) => c.key === 'cnn')['Geo ID']).properties[dp.CLAIM_COLUMNS.verified], [`<the row of ${TAG} in Rulebook>`], 'the plan holds a placeholder where the page id goes');
  assert.ok(!r.outs.includes('Building the page.'), 'a dry run builds nothing and says nothing of building');
  assert.deepEqual(lintReport(`${r.out}\n`), []);
  const next = r.out.split('\n').at(-1);
  assert.equal(next, 'Next: to build the page for real, ask again for a practice page under the same link.');
  assert.match(r.out, /^Walkthrough: .*nothing was built/);
  assert.match(r.out, /\| Views \| 5 \|/);
});

test('a dry run that tried to write would be refused by its own fetch: the client of a dry run can only read', async () => {
  const w = newWorld();
  const writes = [];
  const spy = async (url, init) => {
    if (String(init?.method ?? 'GET').toUpperCase() !== 'GET') writes.push(`${init.method} ${url}`);
    return w.fake.fetchImpl(url, init);
  };
  const r = await w.start(['--dry-run'], { fetchImpl: spy });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(writes, []);
});

test('the real manifest and page template, with no --manifest, give a lint-clean dry run', async () => {
  const w = newWorld();
  const r = await w.start(['--dry-run']);
  assert.equal(r.code, 0, r.err);
  const plan = read(join(w.dir(), 'setup-plan.json'));
  const { manifest } = real();
  assert.equal(plan.plan.manifest_version, manifest.manifest_version);
  assert.equal(plan.rows.tag_decisions.length, manifest.decided.length);
  assert.equal(plan.rows.claims_copy.length, manifest.claims.length);
});

test('the page text and the manifest agree: the lint is clean with the manifest\'s steps, the editor types the manifest\'s words, and the page never explains the ledger beyond its one line', () => {
  const { manifest, template } = real();
  const model = dp.pageModel(template.text, { edition: EDITION, date: dp.dateWord(NOW) });
  const preview = dp.annotatedPreview(model.rendered, {});
  const page = model.rendered; // the text, without the comments the preview adds under the markers
  assert.deepEqual(lintPage(preview, { manifest }).problems, []);
  assert.deepEqual(lintPage(dp.annotatedPreview(model.rendered, { fallbackKeys: ['your_queue', 'lessons_waiting'] }), { manifest }).problems, []);
  // the editor's words in step 3 are the manifest's `enter` text word for word, and what each claim gets is the manifest's
  const step3 = page.slice(page.indexOf('## Step 3'), page.indexOf('## Step 4'));
  for (const o of manifest.open) {
    assert.ok(step3.includes(`"${o.enter['Challenged tags notes']}"`), `${o.claim}: the sentence the page gives is the manifest's`);
    assert.ok(step3.includes(`Why wrong ${o.enter['Why wrong']}`), `${o.claim}: Why wrong`);
  }
  assert.ok(step3.includes('Claim quality tags — verified Context-dependent'), 'the AI Force claim gets the tag');
  assert.ok(step3.includes('Claim quality tags — verified stays empty'), 'the press pool claim does not');
  assert.ok(step3.includes('Review status Reviewed'));
  assert.match(step3, /\{\{view:Your queue\}\}/);
  // Tag decisions: one line in The tables, nothing in the steps, and no step asks for a caption for it
  const mentions = page.split('\n').map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => /Tag decisions/.test(line));
  assert.equal(mentions.length, 1, 'the ledger is named once');
  assert.equal(mentions[0].line, '- **Tag decisions**: the agent\'s own record of each decision; nothing to do here.');
  assert.ok(mentions[0].n > page.split('\n').findIndex((l) => l.startsWith('## The tables')));
  assert.ok(!manifest.steps.some((s) => s.affects.includes('Tag decisions')));
  // step 1: the status table's first lines are what status prints on a page nobody has read yet
  const step1 = page.slice(page.indexOf('## Step 1'), page.indexOf('## Step 2'));
  assert.match(step1, /\| Your queue \| nothing waits \|/);
  assert.ok(!/2 rows, lowest confidence first/.test(page));
  // step 2 shows the Claims table with the agent's columns, and no ledger table
  const step2 = page.slice(page.indexOf('## Step 2'), page.indexOf('## Step 3'));
  assert.match(step2, /\| Geo Name \| Agent tags \| Agent confidence \| Agent notes \|/);
  assert.match(step2, /\| Geo Name \| Agent reasons \|/);
  assert.ok(!/Agent proposal|Tag outcome|Tag decisions/.test(`${step1}${step2}${step3}`));
  // the Help list stays at ten lines and the Queue entry is the claims table's views
  const help = page.slice(page.indexOf('**Words used on this page.**'), page.indexOf('**If something stops.**'));
  assert.equal(help.split('\n').filter((l) => l.startsWith('- ')).length, 10);
  assert.match(help, /\*\*Views\*\*: the Claims table has Your queue .* Needs your note .* Agent disagreed/);
});

// ---- start: the whole build ------------------------------------------------------------------------------------------------------------------

test('start builds the page: one page, five tables, the text in order, two linked views under the right blocks, three tab views, the rows, and verify is clean', async () => {
  const w = newWorld();
  const { manifest } = real();
  const structure = dp.practiceStructure(read(join(AGENT, 'setup', 'structure.json')));
  const r = await w.start();
  assert.equal(r.code, 0, `${r.err}\n${r.out}`);
  assert.equal(r.outs[0], 'Building the page.', 'one progress line before the report');
  assert.equal(r.outs.filter((l) => l === 'Building the page.').length, 1);
  const report = r.outs.slice(1).join('\n');
  assert.deepEqual(lintReport(`${report}\n`), []);
  assert.match(report, /^Walkthrough: your practice page is ready under Demos\.\n\n\| Table \| Now \|\n\|---\|---\|\n\| Rulebook \| 1 tag \|\n\| Claims \| 7: 5 reviewed earlier, 2 for you \|\n\| Rule changes \| empty \|\n\nNext: open Claim tagger practice · 15 Oct 14:22 \(https:\/\/www\.notion\.so\/[0-9a-f]{32}\) and follow step 1\.$/);

  const [id] = w.demos();
  assert.equal(id, '20261015-1422-r1');
  const demo = w.demo();
  assert.equal(demo.state, 'ready');
  assert.equal(demo.title, 'Claim tagger practice · 15 Oct 14:22');
  assert.equal(demo.parent.title, 'Demos');
  assert.equal(demo.manifest_version, manifest.manifest_version);
  assert.match(demo.manifest_sha256, /^[0-9a-f]{64}$/);
  assert.equal(demo.api_version, '2026-03-11');
  assert.equal(demo.fallback, null);
  assert.equal(demo.tables_position, 'marker');
  assert.deepEqual(demo.errors, []);
  assert.deepEqual(Object.keys(demo.databases), ['rulebook', 'claims_copy', 'tag_decisions', 'rule_changes', 'agent_settings']);
  assert.deepEqual(Object.keys(demo.views).sort(), ['agent_disagreed', 'lessons_waiting', 'needs_your_note', 'rulebook', 'your_queue']);
  assert.ok(demo.page.id && demo.toggle.id && demo.anchors.your_queue && demo.anchors.lessons_waiting);
  assert.deepEqual(Object.keys(demo.phases), ['page', 'content', 'databases', 'relations', 'toggle', 'views', 'fallback']);
  assert.ok(!existsSync(join(w.dir(), 'runs', 'SETUP')), 'the marker is gone');

  // one page, five tables with the practice titles
  const pagePosts = POST_BODIES(w.fake, '/pages');
  assert.equal(pagePosts.length, 1 + 14, 'the page and fourteen rows');
  assert.deepEqual(pagePosts[0].parent, { type: 'page_id', page_id: w.parent.replace(/-/g, '') });
  assert.equal(pagePosts[0].properties.title.title[0].text.content, demo.title);
  assert.deepEqual(POST_BODIES(w.fake, '/databases').map((b) => b.title[0].text.content), Object.values(dp.PRACTICE_TITLES));
  assert.ok(POST_BODIES(w.fake, '/databases').every((b) => b.is_inline === true && b.parent.page_id === demo.page.id));

  // the Claims table carries the Geo columns, the agent's four and the editor's four; the relation points at this page's Rulebook and was added after it
  const claimsSchema = w.fake.dataSource(demo.databases.claims_copy.data_source_id).properties;
  assert.deepEqual(Object.keys(claimsSchema), structure.tables.claims_copy.columns.map((c) => c.name).filter((n) => n !== dp.CLAIM_COLUMNS.verified).concat(dp.CLAIM_COLUMNS.verified), 'the relation comes last: it is added once the Rulebook exists');
  assert.equal(claimsSchema[dp.CLAIM_COLUMNS.verified].type, 'relation');
  assert.equal(claimsSchema[dp.CLAIM_COLUMNS.verified].relation.data_source_id.replace(/-/g, ''), demo.databases.rulebook.data_source_id, 'the relation points at the Rulebook of this page, not at any other table');
  assert.deepEqual(claimsSchema['Review status'].select.options.map((o) => o.name), ['To review', 'Reviewed']);
  assert.deepEqual(claimsSchema['Why wrong'].select.options.map((o) => o.name), ['Agent slip', 'Rule unclear', 'Rule should change']);
  assert.equal(claimsSchema['Agent confidence'].type, 'number');
  assert.equal(claimsSchema['Agent reasons'].type, 'rich_text');
  assert.equal(w.fake.dataSource(demo.databases.tag_decisions.data_source_id).properties['Decided under'].type, 'rich_text');
  assert.equal(w.fake.requests.filter((q) => q.method === 'PATCH' && /^\/data_sources\//.test(q.path)).length, 1, 'one request adds the relation');

  // the page, top to bottom
  const outline = w.fake.outline(demo.page.id);
  assert.deepEqual(outline, expectedOutline());
  assert.equal(outline[0].split('|')[0], 'callout');
  assert.equal(outline.filter((l) => /^heading_2\|Step \d · /.test(l)).length, 7);
  assert.ok(outline.indexOf('linked|Your queue') < outline.indexOf('linked|Lessons waiting') && outline.indexOf('linked|Lessons waiting') < outline.indexOf('database|Rulebook'));
  assert.equal(outline.at(-1), 'toggle|Help');
  const toggleKids = w.fake.children(demo.toggle.id);
  assert.ok(toggleKids.length > 0 && toggleKids.some((b) => b.type === 'table'), 'the Help toggle holds its text');

  // two linked views, each right after the block it was asked to follow
  const linked = w.fake.linked();
  assert.deepEqual(linked.map((l) => l.name), ['Your queue', 'Lessons waiting']);
  const entries = w.fake.entries(demo.page.id);
  for (const l of linked) {
    const at = entries.findIndex((e) => e.kind === 'linked' && e.view_id === l.view_id);
    assert.equal(entries[at - 1].id, l.after_block, `${l.name} sits right under the block it follows`);
    assert.match(entries[at - 1].text, /^Doing the work\./, `${l.name} follows the Doing the work line of its step`);
    assert.equal(l.page_id.replace(/-/g, ''), demo.page.id);
    assert.equal(l.body.create_database.position.type, 'after_block');
    assert.equal(l.body.type, 'table');
  }
  const planned = (name) => viewPlan(structure, structure.views.find((v) => v.name === name));
  const shown = (l, table) => {
    const ds = w.fake.dataSource(demo.databases[table].data_source_id);
    const byId = Object.fromEntries(Object.values(ds.properties).map((p) => [p.id, p.name]));
    return l.body.configuration.properties.filter((p) => p.visible !== false).map((p) => byId[p.property_id]);
  };
  const queue = linked.find((l) => l.name === 'Your queue');
  assert.equal(queue.source_database_id.replace(/-/g, ''), demo.databases.claims_copy.database_id, 'Your queue is a view of the Claims table');
  assert.deepEqual(queue.body.filter, planned('Your queue').body.filter);
  assert.deepEqual(queue.body.filter.and.map((f) => [f.property, Object.keys(f.select ?? f.rich_text)[0]]), [['Review status', 'does_not_equal'], ['Agent notes', 'contains'], ['Agent notes', 'does_not_contain']]);
  assert.deepEqual(queue.body.sorts, [{ property: 'Agent confidence', direction: 'ascending' }]);
  assert.equal(queue.body.configuration.wrap_cells, true);
  assert.deepEqual(shown(queue, 'claims_copy'), ['Geo Name', 'Agent tags', 'Agent confidence', 'Agent notes', 'Agent reasons', dp.CLAIM_COLUMNS.verified, 'Review status', 'Why wrong', 'Challenged tags notes']);
  const lessons = linked.find((l) => l.name === 'Lessons waiting');
  assert.equal(lessons.source_database_id.replace(/-/g, ''), demo.databases.rule_changes.database_id);
  assert.equal(lessons.body.configuration.wrap_cells, true);
  assert.deepEqual(shown(lessons, 'rule_changes'), ['Lesson', 'Current text', 'Proposed text', 'Status']);

  // the three views that are tabs: two on the Claims, one on the Rulebook; the ledger has none
  const tabs = w.fake.tabViews(demo.databases.claims_copy.database_id);
  assert.deepEqual(tabs.map((v) => v.name), ['Needs your note', 'Agent disagreed']);
  assert.deepEqual(tabs[0].filter, planned('Needs your note').body.filter);
  assert.deepEqual(tabs[1].filter, planned('Agent disagreed').body.filter);
  assert.deepEqual(w.fake.tabViews(demo.databases.tag_decisions.database_id), [], 'the ledger has no view of its own on the page');
  assert.deepEqual(w.fake.tabViews(demo.databases.rulebook.database_id).map((v) => v.name), ['Rulebook']);
  const rulebookView = w.fake.tabViews(demo.databases.rulebook.database_id)[0];
  const rulebookSchema = w.fake.dataSource(demo.databases.rulebook.data_source_id).properties;
  const hidden = rulebookView.configuration.properties.filter((p) => p.visible === false).map((p) => Object.values(rulebookSchema).find((s) => s.id === p.property_id).name);
  assert.ok(hidden.includes('Counterpart'), 'the Rulebook view hides Counterpart');
  assert.equal(rulebookSchema.Counterpart.type, 'rich_text', 'and the column stays in the table');

  // the rows
  assert.deepEqual([1, 7, 5, 0, 1], ['rulebook', 'claims_copy', 'tag_decisions', 'rule_changes', 'agent_settings'].map((t) => w.rows(t).length));
  const book = w.rows('rulebook')[0];
  assert.equal(book.Name, TAG);
  assert.equal(book.Status, 'Verified');
  assert.equal(book['When to use'], manifest.tag['When to use']);
  assert.equal(book['Example Claims'], manifest.tag['Example Claims'].join('\n'));
  assert.ok(book['Work tags'].includes('Issue'));
  for (const c of manifest.claims) {
    const row = w.rowBy('claims_copy', 'Geo ID', c['Geo ID']);
    assert.equal(row['Geo Name'], c['Geo Name']);
    assert.equal(row['Geo URL'], c['Geo URL']);
    assert.equal(row['Geo Is factual'], c['Geo Is factual']);
    for (const column of ['Agent tags', 'Agent notes', 'Agent reasons']) assert.equal(row[column], '', `${c.key}: ${column}`);
    assert.ok([null, undefined].includes(row['Agent confidence']), `${c.key}: Agent confidence`);
  }
  const claimsDb = demo.databases.claims_copy.database_id;
  const cnn = w.fake.rows(claimsDb).find((p) => p.properties['Geo ID'].rich_text[0].plain_text === manifest.claims.find((c) => c.key === 'cnn')['Geo ID']);
  const hrefs = cnn.properties['Geo Sources'].rich_text.map((x) => x.href).filter(Boolean);
  assert.deepEqual(hrefs, manifest.claims.find((c) => c.key === 'cnn').source_pieces.map((p) => p.href).filter(Boolean), 'Geo Sources keeps its links');
  const settings = w.rows('agent_settings')[0];
  assert.equal(settings.Name, 'Claim tagger');
  assert.equal(settings['Rulebook edition'], EDITION);
  assert.ok(!settings['Last run summary'], 'no command has run, so there is no last run');
  assert.equal(settings.Paused, false);

  // the profile
  const dir = w.dir();
  const config = loadConfig(dir);
  assert.equal(config.demo, true);
  assert.equal(config.demo_id, id);
  assert.equal(config.demo_title, demo.title);
  assert.deepEqual(config.tags, { default: 'text' });
  assert.deepEqual(config.judge.groups, { G1: [TAG] });
  assert.equal(config.notion.rulebook.database_id, demo.databases.rulebook.database_id);
  assert.equal(config.notion.claims[0].database_id, demo.databases.claims_copy.database_id);
  assert.equal(config.notion.databases.rule_changes.data_source_id, demo.databases.rule_changes.data_source_id);
  assert.deepEqual(Object.keys(config.notion.views).sort(), ['agent_disagreed', 'lessons_waiting', 'needs_your_note', 'rulebook', 'your_queue']);
  for (const prodId of [w.production.notion.rulebook.database_id, w.production.notion.databases.tag_decisions.data_source_id, w.production.notion.parent_page_id]) {
    assert.ok([...config.notion.protected_database_ids, ...config.notion.protected_page_ids].some((p) => p.replace(/-/g, '') === prodId.replace(/-/g, '')), `${prodId} is protected in the profile`);
  }
  const rubric = readRubric(dir);
  assert.equal(rubric.edition, EDITION);
  assert.equal(rubric.tags.length, 1);
  assert.ok(rubric.tags[0].judged && rubric.tags[0].rules.length >= 4);
  assert.equal(rubric.tags[0].page_id.replace(/-/g, ''), book.page_id.replace(/-/g, ''), 'the rulebook file knows the row of Notion');
  assert.equal(rubric.source.database_id.replace(/-/g, ''), demo.databases.rulebook.database_id);
  assert.match(readFileSync(join(dir, 'rubric', 'CHANGELOG.md'), 'utf8'), new RegExp(`edition ${EDITION} · practice page ${id}`));
  const canaries = lines(join(dir, 'evals', 'canaries.jsonl'));
  assert.equal(canaries.length, 10);
  assert.ok(canaries.every((c) => c.tag === TAG && ['apply', 'do_not_apply'].includes(c.expected) && c.claim && c.id));
  assert.equal(canaries.filter((c) => c.expected === 'apply').length, 6);
  assert.equal(lines(join(dir, 'evals', 'cases.jsonl')).length, 5, 'the five earlier decisions are the cases');
  assert.ok(lines(join(dir, 'evals', 'cases.jsonl')).every((c) => c.source === 'audit of 9 October'));

  // the record of what was sent
  assert.equal(demo.request_counts.writes, w.fake.writes().length);
  assert.equal(demo.request_counts.total, w.fake.requests.length);
  const builderLog = countRequests(join(dir, 'runs', 'builder', 'requests.jsonl'));
  assert.equal(builderLog.writes, 1 + 3 + 5 + 1 + 5, 'a page, three appends, five tables, the relation and five views went through the builder client');
  assert.equal(countRequests(join(dir, 'runs', 'builder', 'requests-rows.jsonl')).writes, 14, 'the rows went through the rows client');
  assert.ok(existsSync(join(dir, 'runs', readdirSync(join(dir, 'runs')).find((n) => n.endsWith('walkthrough-start')), 'report.md')));

  // verify reads it all back and finds nothing
  const v = await w.run(['verify', '--json']);
  assert.equal(v.code, 0, v.err);
  const result = JSON.parse(v.out);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.equal(result.counts.rulebook, 1);
  assert.equal(result.counts.claims, 7);
  assert.equal(result.counts.tag_decisions, 5);
  assert.equal(result.counts.decided, 5);
  assert.equal(result.counts.open, 2);
  assert.equal(result.counts.rule_changes, 0);
  assert.equal(result.counts.linked_views, 2);
  assert.equal(result.counts.tab_views, 3);
  assert.equal(result.counts.linked_places_checked, 2, 'the place of each linked view on the page was checked');
  // and what the manifest expects is what verify counted
  const expect = manifest.expect;
  assert.deepEqual(
    [result.counts.rulebook, result.counts.claims, result.counts.tag_decisions, result.counts.decided, result.counts.open, result.counts.linked_views, result.counts.tab_views],
    [expect.rulebook_rows, expect.claims, expect.ledger_rows, expect.reviewed_claims, expect.open_claims, expect.linked_views, expect.tab_views],
  );
  assert.deepEqual(expect.claims_views, structure.views.filter((v) => v.table === 'claims_copy').map((v) => v.name), 'the Claims views the manifest expects are the structure\'s');
});

test('a fresh page\'s Claims: five claims Reviewed with the audit\'s values, two To review, the editor\'s columns otherwise empty, and the relation points at the Rulebook row', async () => {
  const w = newWorld();
  const { manifest } = real();
  const V = dp.CLAIM_COLUMNS.verified;
  assert.equal((await w.start()).code, 0);
  const book = w.rows('rulebook')[0];
  const raw = (c) => w.fake.rows(w.db('claims_copy')).find((p) => p.properties['Geo ID'].rich_text[0].plain_text === c['Geo ID']);
  const decided = new Map(manifest.decided.map((d) => [d.claim, d]));
  const reviewed = [];
  const toReview = [];
  for (const c of manifest.claims) {
    const row = w.rowBy('claims_copy', 'Geo ID', c['Geo ID']);
    const d = decided.get(c.key);
    if (d) {
      reviewed.push(c.key);
      assert.equal(row['Review status'], 'Reviewed', c.key);
      assert.equal(row['Why wrong'], 'Agent slip', c.key);
      assert.equal(row['Challenged tags notes'], d['Challenged tags notes'], c.key);
      assert.ok(row['Challenged tags notes'].startsWith('From the audit of 9 October: '), c.key);
      assert.deepEqual(row[V].map(dashless), d[V].length ? [dashless(book.page_id)] : [], `${c.key}: the Applies decisions (cnn, dallas) hold the tag, the Does not apply ones hold nothing`);
      assert.deepEqual(raw(c).properties[V].relation.map((x) => dashless(x.id)), d[V].length ? [dashless(book.page_id)] : []);
    } else {
      toReview.push(c.key);
      assert.equal(row['Review status'], 'To review', c.key);
      assert.ok([null, undefined, ''].includes(row['Why wrong']), `${c.key}: Why wrong is empty`);
      assert.equal(row['Challenged tags notes'] ?? '', '', `${c.key}: the notes are empty`);
      assert.deepEqual(row[V], [], `${c.key}: nothing is verified`);
    }
  }
  assert.deepEqual(reviewed, ['cnn', 'dallas', 'contractor', 'kennedy', 'stopgap']);
  assert.deepEqual(toReview, ['presspool', 'aiforce']);
  assert.deepEqual(['cnn', 'dallas'].map((k) => w.rowBy('claims_copy', 'Geo ID', manifest.claims.find((c) => c.key === k)['Geo ID'])[V].length), [1, 1]);
  assert.equal(w.rows('claims_copy').filter((r) => r[V].length).length, 2, 'only the two Applies decisions hold the tag');
  assert.equal(w.rows('claims_copy').filter((r) => r['Review status'] === 'Reviewed').length, 5);
  // the agent's side is empty on all seven, and none of the claims says that anything waits
  for (const row of w.rows('claims_copy')) {
    for (const column of ['Agent tags', 'Agent notes', 'Agent reasons']) assert.equal(row[column], '');
    assert.ok([null, undefined].includes(row['Agent confidence']));
  }
  // the editor's columns were written by the build under its marker, in creates and through the plan check; nothing was updated afterwards
  assert.equal(w.fake.requests.filter((q) => q.method === 'PATCH' && /^\/pages\//.test(q.path)).length, 0);
});

test('the ledger of a fresh page: a row for each of the five decided claims with the copy of the audit\'s decision, and none for the two claims that wait', async () => {
  const w = newWorld();
  const { manifest } = real();
  assert.equal((await w.start()).code, 0);
  const rows = w.rows('tag_decisions');
  assert.equal(rows.length, 5);
  const decided = new Map(manifest.decided.map((d) => [manifest.claims.find((c) => c.key === d.claim)['Geo ID'], d]));
  for (const c of manifest.claims) {
    const row = w.rowBy('tag_decisions', 'Key', `${c['Geo ID']}::${TAG}`);
    const d = decided.get(c['Geo ID']);
    if (!d) {
      assert.equal(row, undefined, `${c.key} waits for the editor: the tag step makes its row`);
      continue;
    }
    const claimRow = w.rowBy('claims_copy', 'Geo ID', c['Geo ID']);
    assert.equal(row.Claim, c['Geo Name']);
    assert.equal(row.Tag, TAG);
    assert.equal(row['Claim link'], notionUrl(claimRow.page_id), 'the ledger row links to the claim');
    assert.equal(row['Agent proposal'], d['Agent proposal'], `${c.key}: what the agent said before the audit`);
    assert.equal(row['Tag outcome'], d['Claim quality tags — verified'].length ? 'Applies' : 'Does not apply', `${c.key}: the outcome of the claim's verified tags`);
    assert.equal(row['Why wrong'], 'Agent slip');
    assert.equal(row['Your reasoning'], d['Challenged tags notes'], `${c.key}: the words of the audit, copied`);
    assert.ok(!row['Decided under'], `${c.key}: the audit gave no edition`);
    for (const column of ['Follow-up', 'Rulebook edition', 'Agent reason']) assert.ok(!row[column], `${c.key}: ${column}`);
    assert.ok([null, undefined].includes(row['Agent confidence']));
  }
  assert.equal(rows.filter((r) => r['Tag outcome'] === 'Applies').length, 2, 'cnn and dallas');
  // the copy is the one the tag step would make: syncing the decisions of the claims into this ledger changes nothing
  const { syncDecisions } = await import('../../agents/claim-tagger-mvp/scripts/lib/decisions.mjs');
  const claims = manifest.claims.map((c) => {
    const row = w.rowBy('claims_copy', 'Geo ID', c['Geo ID']);
    return { geo_id: c['Geo ID'], review_status: row['Review status'], verified_tags: row['Claim quality tags — verified'].length ? [TAG] : [], why_wrong: row['Why wrong'] || null, challenged_notes: row['Challenged tags notes'] || '' };
  });
  const ledger = rows.map((r) => ({ ...r, decided: Boolean(r['Tag outcome']) }));
  assert.deepEqual(syncDecisions(claims, ledger).changes, []);
  // and the pull turns them into the earlier decisions, from the audit
  const cases = lines(join(w.dir(), 'evals', 'cases.jsonl'));
  assert.deepEqual(cases.map((c) => c.outcome).sort(), ['Applies', 'Applies', 'Does not apply', 'Does not apply', 'Does not apply']);
  assert.ok(cases.every((c) => c.why_wrong === 'Agent slip' && c.decided_edition === null));
});

test('start only reads, creates and appends: no request names a protected id, no row is made outside the practice tables, nothing is removed or moved', async () => {
  const w = newWorld();
  const r = await w.start();
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([...methodsOf(w.fake)].sort(), ['GET', 'PATCH', 'POST']);
  const demo = w.demo();
  const ownTables = new Set(Object.values(demo.databases).map((d) => d.database_id));
  for (const req of w.fake.requests) {
    const flat = `${req.path} ${JSON.stringify(req.body ?? {})}`.replace(/-/g, '').toLowerCase();
    for (const id of w.protectedIds) assert.ok(!flat.includes(id.replace(/-/g, '').toLowerCase()), `${req.method} ${req.path} names a protected id`);
    assert.notEqual(req.status, 404, `${req.method} ${req.path}`);
  }
  for (const body of POST_BODIES(w.fake, '/pages').slice(1)) assert.ok(ownTables.has(String(body.parent.database_id).replace(/-/g, '')), 'a row is made in a table of the practice page');
  // the only PATCH are appends of blocks and the one request that adds the relation column, to the Claims of this page
  const claimsSource = demo.databases.claims_copy.data_source_id;
  for (const req of w.fake.requests.filter((q) => q.method === 'PATCH')) {
    assert.match(req.path, /^\/(blocks\/[^/]+\/children|data_sources\/[0-9a-f-]{32,36})$/, 'the only PATCH is an append of blocks or the relation');
    if (req.path.startsWith('/data_sources/')) assert.equal(req.path.replace(/^\/data_sources\//, '').replace(/-/g, ''), claimsSource);
  }
  assert.ok(!w.fake.requests.some((q) => q.method === 'PATCH' && /pages/.test(q.path)), 'no row is changed after it is made');
});

test('the plan is written before anything is sent and the requests that went out are the ones it lists', async () => {
  const w = newWorld();
  const seenPlanAt = [];
  const spy = async (url, init) => {
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && !/query$/.test(String(url))) {
      const dir = w.demos().length ? w.dir() : null;
      seenPlanAt.push(Boolean(dir && existsSync(join(dir, 'setup-plan.json')) && existsSync(join(dir, 'preview.md'))));
    }
    return w.fake.fetchImpl(url, init);
  };
  const r = await w.start([], { fetchImpl: spy });
  assert.equal(r.code, 0, r.err);
  assert.ok(seenPlanAt.length >= 29 && seenPlanAt.every(Boolean), 'setup-plan.json and preview.md existed before the first write');
  const plan = read(join(w.dir(), 'setup-plan.json'));
  const sent = w.fake.requests.filter((q) => q.status === 200 && q.method !== 'GET' && !/query$/.test(q.path));
  const databases = sent.filter((q) => q.path === '/databases');
  plan.requests.filter((q) => q.path === '/databases').forEach((q, i) => {
    assert.deepEqual(databases[i].body.initial_data_source, q.body.initial_data_source, `the columns of ${q.body.title}`);
    assert.equal(databases[i].body.title[0].text.content, q.body.title);
  });
  const appends = sent.filter((q) => q.method === 'PATCH' && q.path.startsWith('/blocks/'));
  const planned = plan.requests.filter((q) => q.method === 'PATCH' && q.blocks && !/only if/.test(q.note));
  assert.equal(appends.length, planned.length);
  planned.forEach((q, i) => assert.deepEqual(appends[i].body.children, JSON.parse(JSON.stringify(q.blocks)), q.note));
  // the relation: the plan names the two tables by title, the request carries their ids
  const relationPlanned = plan.requests.find((q) => q.path === '/data_sources/<Claims>');
  const relationSent = sent.filter((q) => q.method === 'PATCH' && q.path.startsWith('/data_sources/'));
  assert.equal(relationSent.length, 1);
  assert.deepEqual(Object.keys(relationSent[0].body.properties), Object.keys(relationPlanned.body.properties));
  assert.equal(relationSent[0].body.properties[dp.CLAIM_COLUMNS.verified].relation.data_source_id.replace(/-/g, ''), w.demo().databases.rulebook.data_source_id);
  const views = sent.filter((q) => q.path === '/views');
  assert.deepEqual(views.map((q) => q.body.name).sort(), plan.requests.filter((q) => q.path === '/views').map((q) => q.body.name).sort());
  const rowPlan = plan.rows;
  for (const [table, ops] of Object.entries(rowPlan)) {
    for (const op of ops) {
      const row = w.rowBy(table, { rulebook: 'Name', claims_copy: 'Geo ID', tag_decisions: 'Key', agent_settings: 'Name' }[table], op.key);
      assert.ok(row, `${table} ${op.key}`);
      for (const [column, value] of Object.entries(op.properties)) {
        if (column === 'Claim link' || column === 'Geo Tags' || column === 'Work tags' || column === dp.CLAIM_COLUMNS.verified) continue; // links, option lists and the relation (a placeholder in the plan) are looked at elsewhere
        assert.equal(row[column], value, `${table} ${op.key} ${column}`);
      }
    }
  }
});

test('a start whose request is a second ask for the same minute gets its own folder; two starts leave two pages and two tables of five', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  assert.equal((await w.start()).code, 0);
  assert.deepEqual(w.demos(), ['20261015-1422-r1', '20261015-1422-r2']);
  assert.equal(POST_BODIES(w.fake, '/databases').length, 10);
  const first = w.demo('20261015-1422-r1');
  const second = w.demo('20261015-1422-r2');
  assert.notEqual(first.page.id, second.page.id);
  assert.notEqual(first.databases.rulebook.database_id, second.databases.rulebook.database_id);
  assert.equal(w.rows('tag_decisions', '20261015-1422-r1').length, 5);
  assert.equal(w.rows('tag_decisions', '20261015-1422-r2').length, 5);
  // each page's Claims point at that page's own Rulebook, never at the other
  for (const id of w.demos()) {
    const d = w.demo(id);
    const relation = w.fake.dataSource(d.databases.claims_copy.data_source_id).properties[dp.CLAIM_COLUMNS.verified].relation.data_source_id.replace(/-/g, '');
    assert.equal(relation, d.databases.rulebook.data_source_id, id);
  }
});

test('--title names the page; the report says it', async () => {
  const w = newWorld();
  const r = await w.start(['--title', 'Practice for the new editor']);
  assert.equal(r.code, 0, r.err);
  assert.equal(w.demo().title, 'Practice for the new editor');
  assert.match(r.out, /Next: open Practice for the new editor \(https:\/\/www\.notion\.so\//);
  const page = w.fake.page(w.demo().page.id);
  assert.equal(page.properties.title.title[0].plain_text, 'Practice for the new editor');
  assert.equal((await w.start(['--title', '  '])).code, 2);
});

test('a title that the report lint would refuse is put in quotes in the report', async () => {
  const w = newWorld();
  const r = await w.start(['--title', 'Database drills of 3 days']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lintReport(`${r.outs.slice(1).join('\n')}\n`), []);
  assert.match(r.out, /Next: open "Database drills of 3 days" \(/);
});

// ---- start: refusals -----------------------------------------------------------------------------------------------------------------------------------

test('start without --parent asks for a link and sends nothing; a text that is not a link is refused the same way', async () => {
  const w = newWorld();
  const none = await w.run(['start']);
  assert.equal(none.code, 2);
  assert.equal(none.err, 'Under which Notion page should the demo go? Paste a link.');
  const blank = await w.run(['start', '--parent', '   ']);
  assert.equal(blank.code, 2);
  assert.equal(blank.err, 'Under which Notion page should the demo go? Paste a link.');
  const bad = await w.run(['start', '--parent', 'the demos page']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /not a link to a Notion page/);
  assert.equal(w.fake.requests.length, 0);
  assert.deepEqual(w.demos(), []);
});

test('a parent that is protected is refused with exit 2 before any request: the production page, a production table, any protected id', async () => {
  const w = newWorld();
  const n = w.production.notion;
  const candidates = [n.parent_page_id, n.rulebook.database_id, n.databases.tag_decisions.data_source_id, n.claims[0].database_id, n.protected_database_ids[0], n.protected_page_ids[0], n.sources.real_claims.database_id];
  for (const id of candidates) {
    const r = await w.run(['start', '--parent', `https://www.notion.so/Some-page-${id.replace(/-/g, '')}`]);
    assert.equal(r.code, 2, id);
    assert.equal(r.err, 'that page is protected; pick another', id);
    assert.match(r.out, /^Walkthrough: no demo was created, because that page is protected\.\n\nNext: paste the link of another Notion page\.$/);
  }
  assert.equal(w.fake.requests.length, 0, 'nothing was asked of Notion');
  assert.deepEqual(w.demos(), [], 'and nothing was left behind');
  // the production page's own sub-pages are fine parents: that is where practice pages are meant to go
  const sub = await w.run(['start', '--dry-run', '--parent', n.pages.demos]);
  assert.equal(sub.code, 0, sub.err);
});

test('a parent that is a row of a protected table is refused after the one GET, without anything being made', async () => {
  let row;
  const w = newWorld({
    configure: (config, fake) => {
      const db = fake.addDatabase({ title: 'A table the editors own', properties: { Name: { type: 'title', title: {} } } });
      row = fake.addRow(db.database_id, { Name: 'A claim' });
      config.notion.protected_database_ids.push(db.data_source_id);
    },
  });
  const r = await w.run(['start', '--parent', row]);
  assert.equal(r.code, 2);
  assert.equal(r.err, 'that page is protected; pick another');
  assert.match(r.out, /^Walkthrough: no demo was created, because that page is protected\./);
  assert.equal(w.fake.requests.length, 1);
  assert.equal(w.fake.requests[0].method, 'GET');
  assert.deepEqual(w.demos(), []);
});

test('a parent the connection cannot see is exit 2 with the words about the connections menu; nothing is made and no folder is left', async () => {
  const w = newWorld();
  const r = await w.run(['start', '--parent', 'https://www.notion.so/Lost-0123456789abcdef0123456789abcdef']);
  assert.equal(r.code, 2);
  assert.equal(r.err, 'In Notion, open that page, choose the connections menu and add the claim tagger connection, or pick another page.');
  assert.equal(r.out, 'Walkthrough: no demo was created, because the claim tagger cannot reach that Notion page.\n\nNext: in Notion, open that page, choose the connections menu and add the claim tagger connection, or pick another page.');
  assert.deepEqual(lintReport(`${r.out}\n`), []);
  assert.equal(w.fake.requests.length, 1);
  assert.equal(w.fake.writes().length, 0);
  assert.deepEqual(w.demos(), []);
  assert.ok(!existsSync(join(w.root, 'runs', 'demos')), 'no folder was made for a parent that was refused');
});

test('a parent that is a table, not a page, is not reachable as a page either', async () => {
  const w = newWorld();
  const db = w.fake.addDatabase({ title: 'A table', properties: { Name: { type: 'title', title: {} } } });
  const r = await w.run(['start', '--parent', db.database_id]);
  assert.equal(r.code, 2);
  assert.match(r.err, /connections menu/);
  assert.equal(w.fake.writes().length, 0);
});

test('a token Notion does not accept is exit 2 and says so; a failing Notion is exit 1 and nothing is left half made', async () => {
  const w = newWorld();
  const r = await w.start([], { token: 'ntn_wrong_token_xxxx' });
  assert.equal(r.code, 2);
  assert.match(r.err, /did not accept the token/);
  assert.ok(!r.err.includes('ntn_wrong'), 'the token is never repeated');
  const w2 = newWorld();
  w2.fake.failNext('GET', /^\/pages\//, 503, 6);
  const down = await w2.start();
  assert.equal(down.code, 1);
  assert.deepEqual(w2.demos(), []);
});

test('start with no token at all stops with exit 2 and says there is none, without reading anything else', async () => {
  const w = newWorld();
  const r = await w.start([], { token: undefined, repoRoot: tmp('no-env') });
  assert.equal(r.code, 2);
  assert.match(r.err, /no NOTION_TOKEN/);
  assert.equal(w.fake.requests.length, 0);
});

test('a paused agent builds no practice page', async () => {
  const w = newWorld();
  mkdirSync(join(w.root, 'runs'), { recursive: true });
  writeFileSync(join(w.root, 'runs', 'PAUSED'), 'paused by a person\n');
  const r = await w.start();
  assert.equal(r.code, 3);
  assert.equal(w.fake.requests.length, 0);
  const dry = await w.start(['--dry-run']);
  assert.equal(dry.code, 0, 'a dry run only reads, so a pause does not stop it');
});

test('a page that does not pass its own lint stops with exit 2 after the one GET: the files are there to read, nothing is built, no profile is written', async () => {
  const w = newWorld();
  const dir = tmp('bad-template');
  writeFileSync(join(dir, 'manifest.json'), readFileSync(join(AGENT, 'walkthrough', 'manifest.json')));
  writeFileSync(join(dir, 'page.md'), `${readFileSync(join(AGENT, 'walkthrough', 'page.md'), 'utf8')}\n\nleave these rows alone.\n`);
  const r = await w.start(['--manifest', join(dir, 'manifest.json')]);
  assert.equal(r.code, 2);
  assert.match(r.err, /does not pass its own lint, so nothing was built/);
  assert.match(r.err, /banned phrase "leave these"/);
  assert.equal(w.fake.requests.length, 1);
  assert.deepEqual(readdirSync(w.dir()).sort(), ['preview.md', 'setup-plan.json']);
});

test('a manifest that is not valid is exit 2 with the problem named; so is a missing one', async () => {
  const w = newWorld();
  const dir = tmp('bad-manifest');
  const manifest = read(join(AGENT, 'walkthrough', 'manifest.json'));
  manifest.decided[0].claim = 'no-such-claim';
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  const r = await w.start(['--manifest', join(dir, 'manifest.json')]);
  assert.equal(r.code, 2);
  assert.match(r.err, /decided\[0\]\.claim names no claim of the manifest/);
  const missing = await w.start(['--manifest', join(dir, 'nope.json')]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /cannot be read/);
  assert.equal(w.fake.requests.length, 0, 'the inputs are checked before Notion is asked anything');
});

test('--dry-run with --resume makes no sense and is refused; so is an unknown flag', async () => {
  const w = newWorld();
  assert.equal((await w.start(['--dry-run', '--resume', 'x'])).code, 2);
  const r = await w.start(['--frobnicate']);
  assert.equal(r.code, 2);
  assert.match(r.err, /usage: /);
});

// ---- start: stops and resumes ---------------------------------------------------------------------------------------------------------------------

test('a start that dies right after its third table was made resumes with --resume: the table is found by its title, nothing is made twice', async () => {
  const w = newWorld();
  let made = 0;
  const first = await w.start([], {
    wrapClients: ({ builder, rest }) => ({
      builder: { ...builder, async createDatabase(args) { const res = await builder.createDatabase(args); made += 1; if (made === 3) throw new Error('the process died after Notion answered'); return res; } },
      rest,
    }),
  });
  assert.equal(first.code, 1);
  assert.match(first.out, /\nWalkthrough: your practice page Claim tagger practice · 15 Oct 14:22 stopped before it was finished\./);
  assert.match(first.err, /to continue: node agents\/claim-tagger-mvp\/scripts\/walkthrough\.mjs start --resume 20261015-1422-r1/);
  assert.match(first.out, /Next: ask for the practice page again under the same link; it continues where it stopped\./);
  assert.deepEqual(lintReport(`${first.out.split('\n').slice(1).join('\n')}\n`), []);
  const [id] = w.demos();
  const half = w.demo(id);
  assert.equal(half.state, 'planned');
  assert.deepEqual(Object.keys(half.databases), ['rulebook', 'claims_copy'], 'the third table was made but its id was not recorded');
  assert.equal(POST_BODIES(w.fake, '/databases').length, 3);
  assert.equal(half.errors.length, 1);

  const second = await w.run(['start', '--resume', id]);
  assert.equal(second.code, 0, second.err);
  assert.match(second.err, /the table "Tag decisions" was found on the page \(made by an earlier try\)/);
  assert.equal(POST_BODIES(w.fake, '/databases').length, 5, 'two more tables, none again');
  assert.equal(new Set(POST_BODIES(w.fake, '/databases').map((b) => b.title[0].text.content)).size, 5);
  assert.equal(POST_BODIES(w.fake, '/pages').filter((b) => b.parent.page_id).length, 1, 'one page in all');
  const done = w.demo(id);
  assert.equal(done.state, 'ready');
  assert.equal(done.databases.tag_decisions.how, 'adopted');
  assert.deepEqual(w.fake.outline(done.page.id), expectedOutline());
  const v = JSON.parse((await w.run(['verify', '--json', '--demo', id])).out);
  assert.deepEqual(v.problems, []);
});

test('a create whose answer was lost stops the start; the same command finds what was made by its title and goes on (page, table, view, row)', async () => {
  // a table: Notion made it, the answer never came
  const w = newWorld();
  let lost = false;
  const losing = async (url, init) => {
    const res = await w.fake.fetchImpl(url, init);
    if (!lost && init?.method === 'POST' && /\/v1\/databases$/.test(String(url))) {
      lost = true;
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' }) });
    }
    return res;
  };
  const first = await w.start([], { fetchImpl: losing });
  assert.equal(first.code, 1);
  assert.match(first.err, /may exist in Notion already, so the create was not sent again/);
  assert.equal(POST_BODIES(w.fake, '/databases').length, 1);
  const [id] = w.demos();
  assert.deepEqual(w.demo(id).databases, {});
  const second = await w.run(['start', '--resume', id]);
  assert.equal(second.code, 0, second.err);
  assert.equal(POST_BODIES(w.fake, '/databases').length, 5, 'the lost table was found, four more were made');
  assert.equal(w.demo(id).databases.rulebook.how, 'adopted');
  assert.equal(w.demo(id).state, 'ready');

  // the page itself
  const p = newWorld();
  let lostPage = false;
  const losingPage = async (url, init) => {
    const res = await p.fake.fetchImpl(url, init);
    if (!lostPage && init?.method === 'POST' && /\/v1\/pages$/.test(String(url))) {
      lostPage = true;
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' }) });
    }
    return res;
  };
  const firstPage = await p.start([], { fetchImpl: losingPage });
  assert.equal(firstPage.code, 1);
  assert.equal(p.demo().page, null);
  const resumedPage = await p.run(['start', '--resume', p.demos()[0]]);
  assert.equal(resumedPage.code, 0, resumedPage.err);
  assert.match(resumedPage.err, /was found under the parent page/);
  assert.equal(POST_BODIES(p.fake, '/pages').filter((b) => b.parent.page_id).length, 1, 'one page, never two');

  // a create that never reached Notion is simply made on the second go
  const q = newWorld();
  q.fake.failNext('POST', /^\/databases$/, 'network', 1);
  const firstQ = await q.start();
  assert.equal(firstQ.code, 1);
  const secondQ = await q.run(['start', '--resume', q.demos()[0]]);
  assert.equal(secondQ.code, 0, secondQ.err);
  assert.equal(secondQ.err.includes('found'), false);
  assert.equal(POST_BODIES(q.fake, '/databases').length, 5);

  // a row
  const r = newWorld();
  let rows = 0;
  const losingRow = async (url, init) => {
    const res = await r.fake.fetchImpl(url, init);
    if (init?.method === 'POST' && /\/v1\/pages$/.test(String(url))) {
      rows += 1;
      if (rows === 6) throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' }) });
    }
    return res;
  };
  const firstR = await r.start([], { fetchImpl: losingRow });
  assert.equal(firstR.code, 1, firstR.err);
  assert.equal(r.demo().state, 'created');
  assert.ok(existsSync(join(r.dir(), 'runs', 'SETUP')), 'the marker stays while the rows are not all in');
  const secondR = await r.run(['start', '--resume', r.demos()[0]]);
  assert.equal(secondR.code, 0, secondR.err);
  assert.deepEqual([1, 7, 5, 1], ['rulebook', 'claims_copy', 'tag_decisions', 'agent_settings'].map((t) => r.rows(t).length), 'no row twice');
  assert.ok(!existsSync(join(r.dir(), 'runs', 'SETUP')));
  assert.equal(JSON.parse((await r.run(['verify', '--json'])).out).ok, true);
});

test('a linked view made just before a stop is found on the page and used on the next go', async () => {
  const w = newWorld();
  let views = 0;
  const first = await w.start([], {
    wrapClients: ({ builder, rest }) => ({
      builder: { ...builder, async createView(args) { const res = await builder.createView(args); views += 1; if (views === 4) throw new Error('the process died after Notion answered'); return res; } },
      rest,
    }),
  });
  assert.equal(first.code, 1);
  const [id] = w.demos();
  assert.equal(w.fake.linked().length, 1);
  assert.equal(w.demo(id).views.your_queue, undefined, 'the fourth view (the first linked one, after the three tabs) was made but not recorded');
  const second = await w.run(['start', '--resume', id]);
  assert.equal(second.code, 0, second.err);
  assert.match(second.err, /the linked view "Your queue" was found on the page/);
  assert.equal(w.fake.linked().length, 2, 'one more, none again');
  assert.deepEqual(w.fake.outline(w.demo(id).page.id), expectedOutline());
});

test('--resume on a finished page only reads: it verifies and reports, and writes nothing', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const [id] = w.demos();
  const writes = w.fake.writes().length;
  const again = await w.run(['start', '--resume', id]);
  assert.equal(again.code, 0, again.err);
  assert.equal(w.fake.writes().length, writes);
  assert.match(again.out, /Walkthrough: your practice page is ready under Demos\./);
  assert.ok(!again.outs.includes('Building the page.'));
});

test('--resume refuses an id that does not exist, an id that leaves the folder, a link to another parent, and a plan or manifest that was changed', async () => {
  const w = newWorld();
  const unknown = await w.run(['start', '--resume', '20260101-0000-zzzzzz']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /there is no practice page/);
  for (const bad of ['..', '../x', 'a/b']) assert.equal((await w.run(['start', '--resume', bad])).code, 2, bad);
  let made = 0;
  await w.start([], {
    wrapClients: ({ builder, rest }) => ({ builder: { ...builder, async createDatabase(args) { made += 1; if (made === 2) throw new Error('stop'); return builder.createDatabase(args); } }, rest }),
  });
  const [id] = w.demos();
  const other = await w.run(['start', '--resume', id, '--parent', '0123456789abcdef0123456789abcdef']);
  assert.equal(other.code, 2);
  assert.match(other.err, /started under another page/);
  const planFile = join(w.dir(id), 'setup-plan.json');
  const plan = read(planFile);
  plan.requests[1].body.title = 'Something else';
  writeFileSync(planFile, JSON.stringify(plan, null, 2));
  const tampered = await w.run(['start', '--resume', id]);
  assert.equal(tampered.code, 2);
  assert.match(tampered.err, /setup-plan\.json is not the plan of this practice page any more/);
  assert.equal(POST_BODIES(w.fake, '/databases').length, 1, 'nothing was sent after the plan was changed');
  writeFileSync(planFile, JSON.stringify(read(join(w.dir(id), 'setup-plan.json')), null, 2));
  const manifestCopy = join(w.dir(id), 'walkthrough', 'manifest.json');
  writeFileSync(manifestCopy, `${readFileSync(manifestCopy, 'utf8')}\n `);
  const edited = await w.run(['start', '--resume', id]);
  assert.equal(edited.code, 2);
  assert.match(edited.err, /manifest copy .* is not the one it was planned from/);
});

const crashAtDatabase = (n) => {
  let made = 0;
  return {
    wrapClients: ({ builder, rest }) => ({
      builder: { ...builder, async createDatabase(args) { made += 1; if (made === n) throw new Error('the process died'); return builder.createDatabase(args); } },
      rest,
    }),
  };
};

test('asking again under the same link continues the page that stopped; a finished page, another parent, chosen inputs or a day later make a new one', async () => {
  const w = newWorld();
  assert.equal((await w.start([], crashAtDatabase(2))).code, 1);
  const again = await w.start();
  assert.equal(again.code, 0, again.err);
  assert.match(again.err, /stopped earlier; it is continued, not made again/);
  assert.deepEqual(w.demos(), ['20261015-1422-r1'], 'the same page, not a second');
  assert.equal(POST_BODIES(w.fake, '/databases').length, 5);
  assert.equal(POST_BODIES(w.fake, '/pages').filter((b) => b.parent.page_id).length, 1);
  assert.equal(w.demo().state, 'ready');
  assert.equal((await w.start()).code, 0, 'the page is finished, so asking again makes a second one');
  assert.equal(w.demos().length, 2);

  const elsewhere = newWorld();
  const other = elsewhere.fake.addPage({ title: 'Elsewhere' });
  assert.equal((await elsewhere.start([], crashAtDatabase(2))).code, 1);
  assert.equal((await elsewhere.run(['start', '--parent', other])).code, 0);
  assert.equal(elsewhere.demos().length, 2, 'another parent is another page');

  const titled = newWorld();
  assert.equal((await titled.start([], crashAtDatabase(2))).code, 1);
  assert.equal((await titled.start(['--title', 'Another go'])).code, 0);
  assert.equal(titled.demos().length, 2, 'a title that was chosen is a page that was asked for');

  const late = newWorld();
  assert.equal((await late.start([], crashAtDatabase(2))).code, 1);
  late.clock = new Date(NOW.getTime() + 25 * 3600e3);
  assert.equal((await late.start()).code, 0);
  assert.equal(late.demos().length, 2, 'a day later it is a new request');
});

test('a refusal that asking again cannot change is exit 2, marks the page, and a new request makes a new page; a failing Notion is exit 1 and the same request continues', async () => {
  const w = newWorld();
  w.fake.failNext('POST', /^\/databases$/, 400, 1, { message: 'body.initial_data_source.properties.Created by: not a property type' });
  const refused = await w.start();
  assert.equal(refused.code, 2);
  assert.match(refused.err, /Notion refused a request \(.*Created by/);
  assert.match(refused.out, /\nWalkthrough: your practice page Claim tagger practice · 15 Oct 14:22 could not be finished, because Notion refused a request\.\n\nNext: ask the engineer to look at the message the script printed\.$/);
  assert.deepEqual(lintReport(`${refused.outs.slice(1).join('\n')}\n`), []);
  assert.equal(w.demo().refused_by_notion, true);
  assert.equal(w.demo().state, 'planned');
  const again = await w.start();
  assert.equal(again.code, 0, again.err);
  assert.equal(w.demos().length, 2, 'the page that Notion refused is left for the engineer, and the new request makes a new page');
  assert.equal(w.demo(w.demos()[1]).state, 'ready');

  const flaky = newWorld();
  flaky.fake.failNext('PATCH', /^\/blocks\/.*\/children$/, 503, 5); // the client asks four times, gives up, and one failure is left for the second go
  const first = await flaky.start();
  assert.equal(first.code, 1, first.err);
  assert.equal(flaky.demo().refused_by_notion, undefined);
  const next = await flaky.start();
  assert.equal(next.code, 0, next.err);
  assert.equal(flaky.demos().length, 1, 'a Notion that failed is asked again about the same page');
});

test('a stop after the rows resumes at the check: nothing is made or written again', async () => {
  const w = newWorld();
  let rows = 0;
  const flaky = async (url, init) => {
    const res = await w.fake.fetchImpl(url, init);
    if (init?.method === 'POST' && /\/v1\/pages$/.test(String(url))) {
      rows += 1;
      if (rows === 15) w.fake.failNext('GET', /^\/blocks\//, 503, 4); // the page and fourteen rows are in; the first read of the page fails
    }
    return res;
  };
  const first = await w.start([], { fetchImpl: flaky });
  assert.equal(first.code, 1, first.err);
  const [id] = w.demos();
  assert.equal(w.demo(id).state, 'seeded');
  const writes = w.fake.writes().length;
  const second = await w.run(['start', '--resume', id]);
  assert.equal(second.code, 0, second.err);
  assert.equal(w.fake.writes().length, writes, 'the second go only read');
  assert.equal(w.demo(id).state, 'ready');
  assert.equal(JSON.parse((await w.run(['verify', '--json'])).out).ok, true);
});

// ---- start: views Notion refuses ---------------------------------------------------------------------------------------------------------------------------

test('when Notion refuses every view the build goes on: demo.json records views null and the fallback, and each step gets its paragraph under the same block', async () => {
  const w = newWorld();
  w.fake.failNext('POST', /^\/views$/, 400, 30);
  const r = await w.start();
  assert.equal(r.code, 0, `${r.err}\n${r.out}`);
  const demo = w.demo();
  assert.equal(demo.views, null);
  assert.equal(demo.fallback, 'no-views');
  assert.equal(demo.state, 'ready');
  assert.deepEqual(demo.errors.map((e) => e.view).sort(), ['agent_disagreed', 'needs_your_note', 'rulebook', 'your_queue'], 'each refusal is recorded; the second linked view was not tried');
  assert.match(r.err, /the view Your queue was refused by Notion/);
  assert.deepEqual(w.fake.outline(demo.page.id), expectedOutline({ fallbackKeys: ['your_queue', 'lessons_waiting'] }));
  const outline = w.fake.outline(demo.page.id);
  const at = outline.indexOf(`paragraph|${dp.FALLBACK_TEXT.your_queue}`);
  assert.match(outline[at - 1], /^paragraph\|Doing the work\./, 'the paragraph follows the Doing the work line of Step 3');
  const at2 = outline.indexOf(`paragraph|${dp.FALLBACK_TEXT.lessons_waiting}`);
  assert.match(outline[at2 - 1], /^paragraph\|Doing the work\./);
  assert.ok(at2 > at);
  assert.equal(w.fake.linked().length, 0);
  assert.deepEqual(read(join(w.dir(), 'config.json')).notion.views, {});
  const preview = readFileSync(join(w.dir(), 'preview.md'), 'utf8');
  assert.ok(preview.includes(dp.FALLBACK_TEXT.your_queue) && !preview.includes('{{view:'));
  const { manifest } = real();
  assert.deepEqual(lintPage(preview, { manifest }).problems, []);
  assert.deepEqual(read(join(w.dir(), 'setup-plan.json')).requests.filter((q) => /only if/.test(q.note)).length, 2);
  const v = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.deepEqual(v.problems, []);
  assert.equal(v.counts.linked_views, 0);
  assert.equal(v.counts.fallback, 'no-views');
  // where gives the table instead of a view
  const where = await w.run(['where']);
  assert.equal(where.code, 0, where.err);
  assert.match(where.out, /you are at step 1, /);
});

test('when Notion refuses only the linked views the tabs are kept, and the fallback is recorded for the steps', async () => {
  const w = newWorld();
  // refuse a view only when it is the linked kind: the shared fake has no create_database, so the pages fake is asked to say 404 for it
  const refuseLinked = async (url, init) => {
    if (init?.method === 'POST' && /\/v1\/views$/.test(String(url)) && JSON.parse(init.body).create_database) return new Response(JSON.stringify({ object: 'error', status: 404, code: 'object_not_found', message: 'no linked views here' }), { status: 404 });
    return w.fake.fetchImpl(url, init);
  };
  const r = await w.start([], { fetchImpl: refuseLinked });
  assert.equal(r.code, 0, r.err);
  const demo = w.demo();
  assert.equal(demo.fallback, 'no-views');
  assert.deepEqual(Object.keys(demo.views).filter((k) => demo.views[k]).sort(), ['agent_disagreed', 'needs_your_note', 'rulebook']);
  assert.equal(demo.views.your_queue, null);
  assert.deepEqual(w.fake.outline(demo.page.id), expectedOutline({ fallbackKeys: ['your_queue', 'lessons_waiting'] }));
  assert.deepEqual(JSON.parse((await w.run(['verify', '--json'])).out).problems, []);
});

test('when Notion refuses the first linked view the second is not tried: both steps get their paragraph together', async () => {
  const w = newWorld();
  let asked = 0;
  const refuse = async (url, init) => {
    if (init?.method === 'POST' && /\/v1\/views$/.test(String(url)) && JSON.parse(init.body).create_database) {
      asked += 1;
      return new Response(JSON.stringify({ object: 'error', status: 404, code: 'object_not_found', message: 'not here' }), { status: 404 });
    }
    return w.fake.fetchImpl(url, init);
  };
  const r = await w.start([], { fetchImpl: refuse });
  assert.equal(r.code, 0, r.err);
  assert.equal(asked, 1, 'one ask, then the other linked view is left alone');
  const demo = w.demo();
  assert.equal(demo.fallback, 'no-views');
  assert.equal(demo.views.your_queue, null);
  assert.equal(demo.views.lessons_waiting, null);
  assert.ok(demo.views.needs_your_note && demo.views.agent_disagreed && demo.views.rulebook);
  assert.deepEqual(w.fake.outline(demo.page.id), expectedOutline({ fallbackKeys: ['your_queue', 'lessons_waiting'] }));
});

test('when only the second linked view is refused the page is not what the design has: the build ends with exit 2 and verify names the view', async () => {
  const w = newWorld();
  const refuse = async (url, init) => {
    if (init?.method === 'POST' && /\/v1\/views$/.test(String(url))) {
      const body = JSON.parse(init.body);
      if (body.create_database && body.name === 'Lessons waiting') return new Response(JSON.stringify({ object: 'error', status: 404, code: 'object_not_found', message: 'not here' }), { status: 404 });
    }
    return w.fake.fetchImpl(url, init);
  };
  const r = await w.start([], { fetchImpl: refuse });
  assert.equal(r.code, 2);
  assert.match(r.err, /verify: page text, line \d+: \{\{view:Lessons waiting\}\} is missing; the page has both linked views or none/);
  assert.match(r.out, /Next: ask the engineer to look at the practice page/);
  const demo = w.demo();
  assert.equal(demo.state, 'seeded', 'it is not called ready');
  assert.equal(demo.verify_failed, true);
  assert.equal(demo.fallback, 'no-views');
  assert.deepEqual(w.fake.outline(demo.page.id), expectedOutline({ fallbackKeys: ['lessons_waiting'] }), 'the step still has its paragraph');
  // asking again does not go back to it: a page whose check failed is for the engineer, so a new request makes a new page
  const again = await w.start();
  assert.equal(again.code, 0, again.err);
  assert.equal(w.demos().length, 2);
});

test('a 400 on the place of a tab view is asked again without the place', async () => {
  const w = newWorld();
  w.fake.failNext('POST', /^\/views$/, 400, 1, { message: 'body.position should not be present' });
  const asked = [];
  const spy = async (url, init) => {
    if (init?.method === 'POST' && /\/v1\/views$/.test(String(url))) asked.push(JSON.parse(init.body));
    return w.fake.fetchImpl(url, init);
  };
  const r = await w.start([], { fetchImpl: spy });
  assert.equal(r.code, 0, r.err);
  const demo = w.demo();
  assert.ok(demo.views.rulebook, 'the Rulebook view was made on the second ask');
  assert.equal(asked.length, 6, 'five views and one second ask');
  assert.deepEqual(asked[0].position, { type: 'start' });
  assert.equal(asked[1].position, undefined);
  assert.equal(asked[0].name, 'Rulebook');
  assert.equal(asked[1].name, 'Rulebook');
});

// ---- verify --------------------------------------------------------------------------------------------------------------------------------------

test('verify finds what was changed after the build: an editor column of a decided claim, a claim that waits, the agent\'s columns, the ledger, a block on the page, preview.md', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const demo = w.demo();
  const clean = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.equal(clean.ok, true);

  const { manifest } = real();
  const V = dp.CLAIM_COLUMNS.verified;
  const claimOf = (key) => manifest.claims.find((c) => c.key === key);
  const claimRow = (key) => w.rowBy('claims_copy', 'Geo ID', claimOf(key)['Geo ID']);
  const ledgerRow = (key) => w.rowBy('tag_decisions', 'Key', `${claimOf(key)['Geo ID']}::${TAG}`);
  const book = w.rows('rulebook')[0];
  // the editor's columns of the claims decided earlier: a tag taken away, a status, a reason and the words changed
  w.fake.editRow(claimRow('cnn').page_id, { [V]: [] });
  w.fake.editRow(claimRow('contractor').page_id, { 'Review status': 'To review' });
  w.fake.editRow(claimRow('kennedy').page_id, { 'Why wrong': 'Rule unclear' });
  w.fake.editRow(claimRow('stopgap').page_id, { 'Challenged tags notes': 'Something else.' });
  // a claim that waits, before any command ran: nobody should have decided it
  w.fake.editRow(claimRow('presspool').page_id, { 'Why wrong': 'Agent slip' });
  w.fake.editRow(claimRow('aiforce').page_id, { 'Review status': 'Reviewed', [V]: [book.page_id] });
  // the agent's columns before any command ran
  w.fake.editRow(claimRow('dallas').page_id, { 'Agent tags': TAG });
  w.fake.editRow(claimRow('presspool').page_id, { 'Agent reasons': 'x' });
  // the ledger: a copy that was changed, and a row for a claim that waits, which only the tag step makes
  w.fake.editRow(ledgerRow('dallas').page_id, { 'Tag outcome': null });
  w.fake.editRow(ledgerRow('cnn').page_id, { 'Decided under': EDITION });
  w.fake.addRow(demo.databases.tag_decisions.database_id, { Claim: claimOf('aiforce')['Geo Name'], Key: `${claimOf('aiforce')['Geo ID']}::${TAG}`, Tag: TAG });
  const stray = await w.fake.fetchImpl(`https://api.notion.com/v1/blocks/${demo.page.id}/children`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${w.fake.token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ children: [{ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'A stray line.' } }] } }] }),
  });
  assert.equal(stray.status, 200);
  writeFileSync(join(w.dir(), 'preview.md'), `${readFileSync(join(w.dir(), 'preview.md'), 'utf8')}\nedited\n`);

  const bad = await w.run(['verify', '--json']);
  assert.equal(bad.code, 2);
  const result = JSON.parse(bad.out);
  assert.equal(result.ok, false);
  const text = result.problems.join('\n');
  assert.match(text, /the earlier decision Excluding CNN .* differs from the manifest in Claim quality tags — verified/);
  assert.match(text, /the earlier decision A contractor.* differs from the manifest in Review status/);
  assert.match(text, /the earlier decision Relocating .* differs from the manifest in Why wrong/);
  assert.match(text, /the earlier decision December stopgap .* differs from the manifest in Challenged tags notes/);
  assert.match(text, /the claim The press pool .* that waits for the editor already has Why wrong/);
  assert.match(text, /the claim The AI Force .* that waits for the editor has Review status Reviewed, it should be To review/);
  assert.match(text, /the claim The AI Force .* that waits for the editor already has Claim quality tags — verified/);
  assert.match(text, /the claim The Dallas .* has Agent tags filled in before any command ran/);
  assert.match(text, /the claim The press pool .* has Agent reasons filled in before any command ran/);
  assert.match(text, /the earlier decision The Dallas .* differs from the manifest in Tag outcome of Tag decisions/);
  assert.match(text, /the row Excluding CNN .* has Decided under filled in before any command ran/);
  assert.match(text, /Tag decisions has 6 rows, it should have 5 \(the agent adds the others\)/);
  assert.match(text, /Tag decisions has a row for The AI Force .*, which waits for the editor, before any command ran/);
  assert.match(text, /page: \d+ blocks and tables where \d+ were planned/);
  assert.match(text, /preview\.md is not the preview of this page/);

  const human = await w.run(['verify']);
  assert.equal(human.code, 2);
  assert.deepEqual(lintReport(`${human.out}\n`), []);
  assert.match(human.out, /^Walkthrough: the check found \d+ problems on the practice page; the first reads "/);
  assert.match(human.out, /Next: ask the engineer to look at the practice page/);
  assert.match(human.err, /verify: /);
});

test('verify finds an editor column of a decided claim that was changed whatever has run since, and does not mind what the editor did to a claim that waited', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const { manifest } = real();
  const V = dp.CLAIM_COLUMNS.verified;
  const claimRow = (key) => w.rowBy('claims_copy', 'Geo ID', manifest.claims.find((c) => c.key === key)['Geo ID']);
  const book = w.rows('rulebook')[0];
  agentHasRead(w); // the tag step has run: from here the claims that waited may be in any state
  const same = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.deepEqual(same.problems, []);
  assert.equal(same.counts.fresh, false);

  // the editor decides both claims in Notion, as step 3 tells them (the press pool: nothing verified; the AI Force: the tag)
  const [press, force] = manifest.open.map((o) => o.enter);
  w.fake.editRow(claimRow('presspool').page_id, { [V]: [], 'Review status': 'Reviewed', 'Why wrong': press['Why wrong'], 'Challenged tags notes': press['Challenged tags notes'] });
  w.fake.editRow(claimRow('aiforce').page_id, { [V]: [book.page_id], 'Review status': 'Reviewed', 'Why wrong': force['Why wrong'], 'Challenged tags notes': force['Challenged tags notes'] });
  const decided = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.deepEqual(decided.problems, [], 'an editor\'s decision on a claim that waited is not damage');
  assert.deepEqual([decided.counts.decided, decided.counts.open], [7, 0]);
  // in a state the page was never meant to be in, it is still no business of verify
  w.fake.editRow(claimRow('aiforce').page_id, { 'Review status': 'To review', 'Why wrong': null });
  assert.deepEqual(JSON.parse((await w.run(['verify', '--json'])).out).problems, []);

  // an earlier decision is never the editor's to change on a practice page: it is what the safety check tests against
  w.fake.editRow(claimRow('kennedy').page_id, { [V]: [book.page_id] });
  w.fake.editRow(claimRow('cnn').page_id, { 'Review status': 'To review' });
  const changed = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.equal(changed.ok, false);
  assert.match(changed.problems.join('\n'), /the earlier decision Relocating .* differs from the manifest in Claim quality tags — verified/);
  assert.match(changed.problems.join('\n'), /the earlier decision Excluding CNN .* differs from the manifest in Review status/);
  assert.equal(changed.problems.length, 2);
});

test('verify notices a linked view that is not under the line it belongs to', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const file = join(w.dir(), 'demo.json');
  const demo = read(file);
  demo.views.your_queue.anchor = demo.anchors.lessons_waiting; // as if it had been put under the wrong block
  writeFileSync(file, JSON.stringify(demo, null, 2));
  const v = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.equal(v.ok, false);
  assert.deepEqual(v.problems, ['page: Your queue is not right under the line it belongs to']);
});

test('verify reads a page that has moved on: once a command has run, the claims that waited, the ledger and the rule changes are not compared with their first state', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const demo = w.demo();
  agentHasRead(w); // the tag step: the agent's columns on the claims, a ledger row for each of the two, a new Last run summary
  w.fake.addRow(demo.databases.rule_changes.database_id, { Lesson: 'A rule change', Tag: TAG, Status: 'Proposed' });
  const v = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.deepEqual(v.problems, []);
  assert.equal(v.counts.rule_changes, 1);
  assert.equal(v.counts.tag_decisions, 7, 'the tag step added the ledger rows of the two claims that waited');
  assert.equal(v.counts.fresh, false);
  const human = await w.run(['verify']);
  assert.equal(human.code, 0, human.err);
  assert.deepEqual(lintReport(`${human.out}\n`), []);
  assert.match(human.out, /\| Claims \| 7: 5 reviewed, 2 waiting for you \|/, 'no longer "reviewed earlier": the editor may have decided some');
  assert.match(human.out, /\| Rule changes \| 1 \|/);
  assert.ok(!/Tag decisions/.test(human.out), 'the ledger is not in the table of the report');
});

test('verify accepts a rulebook that moved to a later edition after a passed safety check, and still objects when the history does not hold the edition the page names', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const rubric = readRubric(w.dir());
  assert.equal(rubric.edition, EDITION);
  writeEdition(w.dir(), { ...rubric, edition: nextEdition(rubric.edition, NOW) }, { reason: 'test: what a passed safety check does' });
  const later = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.deepEqual(later.problems, [], 'the page keeps naming the edition it was built with, and the history holds that edition');
  rmSync(join(w.dir(), 'rubric', 'history', `${EDITION}.json`));
  const lost = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.match(lost.problems.join('\n'), /the rulebook edition is \S+ and the page was built with \S+, which is not an earlier edition of this rulebook/);
});

test('verify says plainly when the practice page was not finished', async () => {
  const w = newWorld();
  let made = 0;
  await w.start([], { wrapClients: ({ builder, rest }) => ({ builder: { ...builder, async createDatabase(args) { made += 1; if (made === 2) throw new Error('stop'); return builder.createDatabase(args); } }, rest }) });
  const v = await w.run(['verify', '--json']);
  assert.equal(v.code, 2);
  assert.match(JSON.parse(v.out).problems[0], /not finished/);
  const human = await w.run(['verify']);
  assert.equal(human.code, 2);
  assert.match(human.out, /was not finished/);
  const where = await w.run(['where']);
  assert.equal(where.code, 1);
  assert.match(where.out, /was not finished/);
  assert.match(where.out, /it continues where it stopped/);
});

// ---- where ---------------------------------------------------------------------------------------------------------------------------------------------

test('where says which step the editor is at and the one thing to do, for every state of the mapping', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const demo = w.demo();
  const { manifest } = real();
  const steps = manifest.steps;
  const V = dp.CLAIM_COLUMNS.verified;
  const book = w.rows('rulebook')[0];
  const claimRow = (key) => w.rowBy('claims_copy', 'Geo ID', manifest.claims.find((c) => c.key === key)['Geo ID']);
  const ledgerRow = (key) => w.rowBy('tag_decisions', 'Key', `${manifest.claims.find((c) => c.key === key)['Geo ID']}::${TAG}`);
  const open = manifest.open.map((o) => o.claim);
  const decide = (key) => {
    const enter = manifest.open.find((o) => o.claim === key).enter;
    w.fake.editRow(claimRow(key).page_id, { [V]: enter[V].map(() => book.page_id), 'Review status': 'Reviewed', 'Why wrong': enter['Why wrong'], 'Challenged tags notes': enter['Challenged tags notes'] });
  };
  const where = async () => {
    const r = await w.run(['where']);
    assert.equal(r.code, 0, `${r.err}\n${r.out}`);
    assert.deepEqual(lintReport(`${r.out}\n`), []);
    const parts = r.out.split('\n\n');
    assert.equal(parts.length, 2, 'one sentence and one Next line');
    return { sentence: parts[0], next: parts[1] };
  };
  const title = (n) => steps[n - 1].title;
  const view = (key) => demo.views[key].url;
  const claimsTable = `https://www.notion.so/${demo.databases.claims_copy.database_id}`;

  // nothing has run yet: the page has just been built, and `status` (step 1) writes nothing, so the page stays at step 1 until a command that writes has run
  let r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 1, ${title(1)}.`);
  assert.equal(r.next, `Next: type ${steps[0].command}.`);
  // a command that writes has run (Last run summary is filled) and the claims have no Agent notes yet
  w.fake.editRow(w.rows('agent_settings')[0].page_id, { 'Last run summary': 'Tag at 15 Oct 14:40' });
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 2, ${title(2)}.`);
  assert.equal(r.next, `Next: type ${steps[1].command}.`);
  // the agent has read the claims
  agentHasRead(w);
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 3, ${title(3)}.`);
  assert.equal(r.next, `Next: open Your queue (${view('your_queue')}) and decide your two claims.`);
  // one claim decided: one is left
  decide(open[0]);
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 3, ${title(3)}.`);
  assert.equal(r.next, `Next: open Your queue (${view('your_queue')}) and decide your remaining claim.`);
  // both decided
  decide(open[1]);
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 4, ${title(4)}.`);
  assert.equal(r.next, `Next: type ${steps[3].command}.`);
  // a rule change is drafted
  const lessonRow = w.fake.addRow(demo.databases.rule_changes.database_id, { Lesson: 'General references pass the rule 4 test', Tag: TAG, Rule: 'Context-dependent rule 4', Kind: 'Clarify wording', Status: 'Proposed' });
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 5, ${title(5)}.`);
  assert.equal(r.next, `Next: open Lessons waiting (${view('lessons_waiting')}) and set Status to Approved.`);
  // approved, not yet checked
  w.fake.editRow(lessonRow, { Status: 'Approved' });
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 6, ${title(6)}.`);
  assert.equal(r.next, `Next: type ${steps[5].command}.`);
  // approved, and the check did not pass
  w.fake.editRow(lessonRow, { 'Safety check result': "FAIL: 'Melania Trump should not host her initiative's G20 event' now Does not apply" });
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 6, ${title(6)}; it did not pass.`);
  assert.equal(r.next, `Next: open Lessons waiting (${view('lessons_waiting')}) and write the rule as you want it in Editor wording.`);
  // live, and the run stopped before it re-checked the claims
  w.fake.editRow(lessonRow, { Status: 'Live', 'Safety check result': 'PASS: examples 11/11, earlier 5/5, yours 2/2' });
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 7, ${title(7)}; the run stopped before it re-checked your claims.`);
  assert.equal(r.next, 'Next: type /claim-tagger demo follow-up.');
  // follow-up ran: one claim fixed, one not (the Follow-up is the ledger's)
  w.fake.editRow(ledgerRow(open[0]).page_id, { 'Follow-up': 'Fixed' });
  assert.match((await where()).sentence, /step 7, .*stopped before/);
  w.fake.editRow(ledgerRow(open[1]).page_id, { 'Follow-up': 'Still wrong' });
  r = await where();
  assert.match(r.sentence, /^Walkthrough: you are at step 7, /);
  assert.equal(r.next, `Next: add a note in Challenged tags notes on the claims in Agent disagreed (${view('agent_disagreed')}).`);
  // both fixed: complete
  w.fake.editRow(ledgerRow(open[1]).page_id, { 'Follow-up': 'Fixed' });
  r = await where();
  assert.equal(r.sentence, 'Walkthrough: you have been through all seven steps of the practice page.');
  assert.equal(r.next, 'Next: nothing to type; archive the page by hand when you no longer need it.');
  // a rejected rule change also ends the walkthrough
  w.fake.editRow(lessonRow, { Status: 'Rejected', 'Safety check result': null });
  for (const key of open) w.fake.editRow(ledgerRow(key).page_id, { 'Follow-up': null });
  r = await where();
  assert.equal(r.next, 'Next: nothing to type; archive the page by hand when you no longer need it.');
  assert.equal(w.fake.requests.filter((q) => q.method === 'PATCH' && /pages/.test(q.path)).length, 0, 'where only reads');
});

test('where reads the step from the Review status of the two claims: the ledger rows of the tag step do not move it, and an editor who goes back to To review moves it back', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const { manifest } = real();
  const claimRow = (key) => w.rowBy('claims_copy', 'Geo ID', manifest.claims.find((c) => c.key === key)['Geo ID']);
  const stepLine = async () => (await w.run(['where'])).out.split('\n')[0];
  // the ledger rows of the two exist, with a proposal, but the claims have no Agent notes: the agent has not read them
  for (const o of manifest.open) {
    const c = manifest.claims.find((x) => x.key === o.claim);
    w.fake.addRow(w.db('tag_decisions'), { Claim: c['Geo Name'], Key: `${c['Geo ID']}::${TAG}`, Tag: TAG, 'Agent proposal': 'Applies' });
  }
  assert.match(await stepLine(), /step 1,/, 'a fresh page: the ledger rows do not move it either');
  w.fake.editRow(w.rows('agent_settings')[0].page_id, { 'Last run summary': 'Tag at 15 Oct 14:40' });
  assert.match(await stepLine(), /step 2,/);
  w.fake.editRow(claimRow('presspool').page_id, { 'Agent notes': 'no tags\nnothing waits for an editor · edition e' });
  assert.match(await stepLine(), /step 2,/, 'one of the two is still unread');
  w.fake.editRow(claimRow('aiforce').page_id, { 'Agent notes': 'no tags\n1 waits for an editor · edition e' });
  assert.match(await stepLine(), /step 3,/);
  for (const key of ['presspool', 'aiforce']) w.fake.editRow(claimRow(key).page_id, { 'Review status': 'Reviewed' });
  assert.match(await stepLine(), /step 4,/);
  w.fake.editRow(claimRow('aiforce').page_id, { 'Review status': 'To review' });
  assert.match(await stepLine(), /step 3,/);
});

test('where on a page without views points at the Claims table instead of Your queue, and at the Rule changes table instead of Lessons waiting', async () => {
  const w = newWorld();
  w.fake.failNext('POST', /^\/views$/, 400, 30);
  assert.equal((await w.start()).code, 0);
  const demo = w.demo();
  assert.equal(demo.views, null);
  const claimsTable = `https://www.notion.so/${demo.databases.claims_copy.database_id}`;
  const first = await w.run(['where']);
  assert.match(first.out, /you are at step 1, /);
  agentHasRead(w);
  const r = await w.run(['where']);
  assert.match(r.out, new RegExp(`Next: open Claims \\(${claimsTable.replace(/\./g, '\\.')}\\) and decide your two claims\\.`));
  // the step that links Lessons waiting falls back to the Rule changes table
  const { manifest } = real();
  for (const o of manifest.open) {
    const c = manifest.claims.find((x) => x.key === o.claim);
    w.fake.editRow(w.rowBy('claims_copy', 'Geo ID', c['Geo ID']).page_id, { 'Review status': 'Reviewed' });
  }
  w.fake.addRow(demo.databases.rule_changes.database_id, { Lesson: 'A rule change', Tag: TAG, Status: 'Proposed' });
  const five = await w.run(['where']);
  assert.match(five.out, new RegExp(`Next: open Rule changes \\(https://www\\.notion\\.so/${demo.databases.rule_changes.database_id}\\) and set Status to Approved\\.`));
});

test('the Claims table of step 2 and the words of the story are what the tag step writes: both claims are To review, so every tag waits and none is written to Agent tags', () => {
  const { manifest, template } = real();
  const page = dp.pageModel(template.text, { edition: EDITION, date: dp.dateWord(NOW) }).rendered;
  const step2 = page.slice(page.indexOf('## Step 2'), page.indexOf('## Step 3'));
  const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim());
  const rows = step2.split('\n').filter((l) => l.startsWith('|')).map(cells);
  const header = rows.findIndex((r) => r[0] === 'Geo Name' && r[1] === 'Agent tags');
  assert.ok(header >= 0);
  const table = rows.slice(header + 2, header + 2 + manifest.claims.length);
  assert.equal(table.length, manifest.claims.length);
  const open = new Set(manifest.open.map((o) => o.claim));
  const decided = new Map(manifest.decided.map((d) => [d.claim, d]));
  const proposals = { presspool: 'Applies', aiforce: "Can't tell" };
  manifest.claims.forEach((c, i) => {
    const d = decided.get(c.key);
    // what the tag step writes for this claim (propose.mjs claimColumns): a claim To review waits whatever the proposal; a Reviewed claim gets the editor's set
    const written = open.has(c.key)
      ? claimColumns({ judgedNames: [TAG], verdicts: new Map([[TAG, proposals[c.key]]]), toReview: true, edition: EDITION })
      : claimColumns({ judgedNames: [TAG], verdicts: new Map([[TAG, d['Claim quality tags — verified'].includes(TAG) ? 'Applies' : 'Does not apply']]), reviewed: true, verifiedTags: d['Claim quality tags — verified'], edition: EDITION });
    const [name, tags, , notes] = table[i];
    assert.equal(name, c.short, c.key);
    assert.equal(tags, written.agent_tags || '(empty)', `${c.key}: Agent tags`);
    assert.equal(notes, written.agent_notes.replace('\n', ' / '), `${c.key}: Agent notes`);
  });
  assert.deepEqual(table.filter((r) => r[3].includes('1 waits for an editor')).map((r) => r[0]), manifest.open.map((o) => manifest.claims.find((c) => c.key === o.claim).short), 'the two claims for the editor are the two that wait');
  // the story: both wait in Your queue, and the line that rule g asks for says why the press pool claim is there
  const story = page.slice(0, page.indexOf('## Step 1'));
  assert.match(story, /The press pool claim was picked for the demo: the agent is fairly sure of it, but the page marks it To review, so it waits in Your queue like the AI Force claim, which the agent reads differently from run to run and which the page also marks To review\./);
  assert.ok(!/because the agent is unsure/.test(story), 'the story does not say as a fact that the agent is unsure of the AI Force claim: its reading differs from run to run');
  const step3 = page.slice(page.indexOf('## Step 3'), page.indexOf('## Step 4'));
  assert.match(step3, /In Your queue, just below, fill in four columns on each of your two claims\./);
  assert.ok(!/not in it|in the Claims table, in The tables/.test(step3), 'both claims are decided in Your queue');
  assert.ok(!/which here is the AI Force claim/.test(step3));
});

test('the table of Step 1 is what status prints on a page that has just been built, and the Next line sends the editor to the tag step; after the tag step both claims wait in Your queue', async () => {
  const { status } = await import('../../agents/claim-tagger-mvp/scripts/status.mjs');
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const { manifest, template } = real();
  const demo = w.demo();
  const hooks = () => ({ root: w.dir(), fetchImpl: w.fake.fetchImpl, token: w.fake.token, sleep: noSleep, now: () => w.clock, io: quietIo(), noCommit: true });
  const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim());
  const step1 = template.text.slice(template.text.indexOf('## Step 1'), template.text.indexOf('## Step 2')).replaceAll('{{edition}}', EDITION);
  const [header, , ...pageRows] = step1.split('\n').filter((l) => l.startsWith('|')).map(cells);

  const fresh = await status(hooks());
  assert.equal(fresh.exit, 0);
  assert.equal(fresh.report.sentence, `Status of the practice page ${demo.title}: nothing is paused and nothing waits for you.`);
  assert.deepEqual(fresh.report.header.slice(0, 2), header);
  const printed = fresh.report.rows.map((row) => row.slice(0, 2));
  // every row of the table of the page is what status prints on the page the build made
  assert.deepEqual(printed, pageRows);
  assert.deepEqual(printed.at(-1), ['Last run', 'none yet'], 'the build writes no Last run summary: no command has run');
  assert.equal(fresh.report.next, 'Next: type /claim-tagger demo tag so that the agent reads the claims first (step 2 of the practice page).');

  // the tag step has run: both claims are To review, so both wait for an editor, the press pool claim although the agent is fairly sure of it
  agentHasRead(w);
  const read = await status(hooks());
  assert.equal(read.report.sentence, `Status of the practice page ${demo.title}: nothing is paused; 2 rows wait for you.`);
  assert.deepEqual(read.report.rows[1].slice(0, 2), ['Your queue', '2 rows, lowest confidence first']);
  assert.match(read.report.next, /^Next: decide your two claims in Your queue \(https:\/\/www\.notion\.so\/[0-9a-f]{32}(\?v=[0-9a-f]{32}|#[0-9a-f]{32})\)\.$/);
  assert.equal(manifest.open.length, 2, 'the two claims of the story are the two that status counts');
});

test('where names the demo it was asked about; an unknown one is exit 2; with no practice page at all it asks for one', async () => {
  const w = newWorld();
  const none = await w.run(['where']);
  assert.equal(none.code, 2);
  assert.match(none.err, /there is no practice page under Demos yet/);
  assert.equal((await w.start()).code, 0);
  w.clock = new Date(NOW.getTime() + 3600e3);
  assert.equal((await w.start()).code, 0);
  const [older, newer] = w.demos();
  assert.equal((await w.run(['where', '--demo', older])).code, 0);
  assert.equal((await w.run(['where', '--demo', 'nope'])).code, 2);
  assert.equal((await w.run(['where', '--demo', '../x'])).code, 2);
  const byDefault = await w.run(['where']);
  assert.equal(byDefault.code, 0);
  assert.ok(readdirSync(join(w.dir(newer), 'runs')).some((n) => n.endsWith('walkthrough-where')), 'the newest page was the one asked');
});

// ---- list ----------------------------------------------------------------------------------------------------------------------------------------------

test('list shows every practice page, newest first, with its link, state and step', async () => {
  const w = newWorld();
  const empty = await w.run(['list']);
  assert.equal(empty.code, 0);
  assert.match(empty.out, /^Walkthrough: there is no practice page yet\.\n\nNext: ask for a practice page/);
  assert.equal((await w.start()).code, 0);
  w.clock = new Date(NOW.getTime() + 7200e3);
  assert.equal((await w.start(['--title', 'Training copy'])).code, 0);
  // a stopped one
  w.clock = new Date(NOW.getTime() + 8000e3);
  let made = 0;
  await w.start(['--title', 'Third practice page'], { wrapClients: ({ builder, rest }) => ({ builder: { ...builder, async createDatabase(args) { made += 1; if (made === 2) throw new Error('stop'); return builder.createDatabase(args); } }, rest }) });
  const [a, b, c] = w.demos();
  const { manifest } = real();
  agentHasRead(w, b);
  const r = await w.run(['list']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lintReport(`${r.out}\n`), []);
  const rows = r.out.split('\n').filter((l) => l.startsWith('|')).slice(2).map((l) => l.split('|').slice(1, -1).map((s) => s.trim()));
  assert.equal(rows.length, 3);
  assert.match(rows[0][0], /^Third practice page \(/);
  assert.deepEqual(rows[0].slice(1), ['planned', '-']);
  assert.match(rows[1][0], new RegExp(`^Training copy \\(${w.demo(b).page.url}\\)`));
  assert.deepEqual(rows[1].slice(1), ['ready · used by the demo commands', 'step 3'], 'the newest finished page under Demos is the one the commands reach, and it is marked');
  assert.match(rows[2][0], new RegExp(`^Claim tagger practice · 15 Oct 14:22 \\(${w.demo(a).page.url}\\)`));
  assert.deepEqual(rows[2].slice(1), ['ready', 'step 1']);
  assert.match(r.out, /^Walkthrough: 3 practice pages\./);
  assert.match(r.out, /Next: ask for the practice page again under the same link; it continues where it stopped\.$/);
  assert.ok(c);
});

test('list keeps every page and marks the one the commands reach; its Next line is for that page, not for a newer page under Demo tests', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  w.clock = new Date(NOW.getTime() + 3600e3);
  assert.equal((await w.run(['start', '--parent', w.testsLink, '--title', 'Verification run'])).code, 0);
  const [mine, tests] = w.demos();
  const { manifest } = real();
  const reviewBoth = (id) => {
    for (const o of manifest.open) w.fake.editRow(w.rowBy('claims_copy', 'Geo ID', manifest.claims.find((c) => c.key === o.claim)['Geo ID'], id).page_id, { 'Review status': 'Reviewed' });
    w.fake.addRow(w.db('rule_changes', id), { Lesson: 'A rule change', Tag: TAG, Rule: 'Context-dependent rule 3', Kind: 'Clarify wording', Status: 'Rejected' });
  };
  // the newer page is complete (its only rule change was rejected), so a Next line made from the newest page would say there is nothing to type
  reviewBoth(tests);
  const r = await w.run(['list']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(lintReport(`${r.out}\n`), []);
  const rows = r.out.split('\n').filter((l) => l.startsWith('|')).slice(2).map((l) => l.split('|').slice(1, -1).map((s) => s.trim()));
  assert.equal(rows.length, 2, 'every page is listed');
  assert.match(rows[0][0], /^Verification run \(/, 'newest first');
  assert.deepEqual(rows[0].slice(1), ['ready', 'complete'], 'the page under Demo tests is not marked');
  assert.match(rows[1][0], /^Claim tagger practice · 15 Oct 14:22 \(/);
  assert.deepEqual(rows[1].slice(1), ['ready · used by the demo commands', 'step 1']);
  assert.equal(lastLine(r.out), `Next: type ${manifest.steps[0].command}.`, 'the line is for the page the commands reach');
  assert.ok(!r.out.includes('archive'), 'the archive line belongs to a page that is complete, and only when that is the page the commands reach');
  assert.ok(mine !== tests);

  // when the page the commands reach is the one that is complete, the archive line is right
  reviewBoth(mine);
  assert.match(lastLine((await w.run(['list'])).out), /^Next: nothing to type; archive the page by hand/);

  // no page under Demos at all: nothing is marked, and the Next line says where a page has to go
  const only = newWorld();
  assert.equal((await only.run(['start', '--parent', only.testsLink])).code, 0);
  const none = await only.run(['list']);
  assert.equal(none.code, 0, none.err);
  assert.ok(!none.out.includes('used by the demo commands'));
  assert.match(lastLine(none.out), /^Next: ask for a practice page under the Demos page;/);
});

test('list shows the page the commands reach even when five newer pages sit above it', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  for (let i = 1; i <= 5; i += 1) {
    w.clock = new Date(NOW.getTime() + i * 3600e3);
    assert.equal((await w.run(['start', '--parent', w.testsLink, '--title', `Verification run ${i}`])).code, 0);
  }
  const r = await w.run(['list']);
  assert.equal(r.code, 0, r.err);
  const rows = r.out.split('\n').filter((l) => l.startsWith('|')).slice(2).map((l) => l.split('|').slice(1, -1).map((s) => s.trim()));
  assert.equal(rows.length, 5, 'at most five rows');
  assert.match(rows[0][0], /^Verification run 5 \(/);
  assert.match(rows[3][0], /^Verification run 2 \(/);
  assert.match(rows[4][0], /^Claim tagger practice · 15 Oct 14:22 \(/, 'the page the commands reach takes the last row');
  assert.equal(rows[4][1], 'ready · used by the demo commands');
  assert.match(r.out, /^Walkthrough: 6 practice pages, the newest 4 and the one the demo commands use below\./);
});

test('without --demo the commands act on the newest finished page under Demos: a newer page under Demo tests is never picked, a page of an older shape is skipped, and --demo reaches any page', async () => {
  const w = newWorld();
  const scriptsDir = standIns();
  assert.equal((await w.start()).code, 0);
  w.clock = new Date(NOW.getTime() + 3600e3);
  assert.equal((await w.start(['--title', 'Older shape'])).code, 0);
  w.clock = new Date(NOW.getTime() + 7200e3);
  assert.equal((await w.run(['start', '--parent', w.testsLink, '--title', 'Verification run'])).code, 0);
  const [mine, shaped, tests] = w.demos();
  assert.equal(w.demo(mine).parent.id, w.parent.replace(/-/g, ''));
  assert.equal(w.demo(tests).parent.id, w.testsParent.replace(/-/g, ''));
  const rootOf = async (...argv) => childReport(await w.run(['run', ...argv, 'pull'], { scriptsDir })).root;
  const asked = (id, kind) => readdirSync(join(w.dir(id), 'runs')).filter((n) => n.endsWith(kind)).length;

  // the page under Demo tests is the newest, and still the commands do not go there
  assert.equal(await rootOf(), w.dir(shaped), 'the newest page under Demos');
  // the second page has the manifest of an earlier shape (a list of tags written as a text): the loader cannot read it, so it is skipped
  const file = join(w.dir(shaped), 'walkthrough', 'manifest.json');
  const manifest = read(file);
  manifest.decided[0]['Claim quality tags — verified'] = 'Context-dependent';
  writeFileSync(file, JSON.stringify(manifest));
  assert.match(dp.profileProblem(dp.pickDemo(w.root, shaped)), /Claim quality tags — verified must be a list of tag names/);
  assert.equal(dp.profileProblem(dp.pickDemo(w.root, mine)), null);
  assert.equal(await rootOf(), w.dir(mine), 'the older page of the current shape');

  // every command without a page named acts on that page
  assert.equal((await w.run(['where'])).code, 0);
  assert.equal((await w.run(['verify', '--json'])).code, 0);
  assert.equal((await w.run(['decide', '--claim', 'presspool'])).code, 0);
  assert.deepEqual([asked(mine, 'walkthrough-where'), asked(shaped, 'walkthrough-where'), asked(tests, 'walkthrough-where')], [1, 0, 0]);
  assert.deepEqual([asked(mine, 'walkthrough-verify'), asked(shaped, 'walkthrough-verify'), asked(tests, 'walkthrough-verify')], [1, 0, 0]);
  assert.deepEqual([existsSync(join(w.dir(mine), 'editor-actions.jsonl')), existsSync(join(w.dir(shaped), 'editor-actions.jsonl')), existsSync(join(w.dir(tests), 'editor-actions.jsonl'))], [true, false, false]);

  // --demo reaches a page under Demo tests, and the page of the older shape is only refused for what is wrong with it
  assert.equal(await rootOf('--demo', tests), w.dir(tests));
  assert.equal((await w.run(['where', '--demo', tests])).code, 0);
  assert.equal(asked(tests, 'walkthrough-where'), 1);
  assert.equal((await w.run(['where', '--demo', shaped])).code, 2, 'a named page of the older shape is refused by the loader, with its reason');

  // nothing left under Demos that can be read: the commands say so, they do not fall back to the page under Demo tests
  const mineFile = join(w.dir(mine), 'walkthrough', 'manifest.json');
  const mineManifest = read(mineFile);
  mineManifest.decided[0]['Claim quality tags — verified'] = 'Context-dependent';
  writeFileSync(mineFile, JSON.stringify(mineManifest));
  for (const argv of [['where'], ['verify'], ['run', 'pull'], ['decide', '--claim', 'presspool'], ['approve']]) {
    const r = await w.run(argv, { scriptsDir });
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.err, /there is no (finished )?practice page under Demos yet/, argv.join(' '));
  }
  assert.equal(asked(tests, 'walkthrough-where'), 1, 'the page under Demo tests was not used');
});

test('the commands without --demo refuse to guess when config.json names no Demos page', async () => {
  const w = newWorld({ configure: (config) => { config.notion.pages.demos = '<none>'; } });
  assert.equal((await w.start()).code, 0);
  for (const argv of [['where'], ['verify'], ['run', 'pull'], ['decide', '--claim', 'presspool']]) {
    const r = await w.run(argv, { scriptsDir: standIns() });
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.err, /the Demos page is not set in config\.json/, argv.join(' '));
  }
  assert.equal((await w.run(['where', '--demo', w.demos()[0]])).code, 0, 'a named page is reached all the same');
});

// ---- run ---------------------------------------------------------------------------------------------------------------------------------------------------

function standIns() {
  const dir = tmp('stand-ins');
  for (const name of RUN_SCRIPTS) {
    writeFileSync(join(dir, `${name}.mjs`), `process.stdout.write(JSON.stringify({ script: ${JSON.stringify(name)}, argv: process.argv.slice(2), root: process.env.CLAIM_TAGGER_MVP_ROOT }) + '\\n');\nprocess.stderr.write('child says hello\\n');\nprocess.exit(Number(process.env.CHILD_EXIT ?? 0));\n`);
  }
  return dir;
}

const childReport = (r) => JSON.parse(r.outs.find((l) => l.startsWith('{')));

test('run starts a script of the loop with the demo as its state folder, and the exit code is the script\'s', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const scriptsDir = standIns();
  const r = await w.run(['run', 'status', '--json'], { scriptsDir });
  assert.equal(r.code, 0, r.err);
  const child = childReport(r);
  assert.equal(child.script, 'status');
  assert.deepEqual(child.argv, ['--json']);
  assert.equal(child.root, w.dir(), 'CLAIM_TAGGER_MVP_ROOT is the folder of the practice page');
  assert.match(r.err, /child says hello/);
  assert.ok(!child.argv.includes('--no-commit'), 'the loop scripts skip the commit in a demo by themselves');
  for (const code of [1, 2, 3, 4, 10, 11, 75]) {
    const x = await w.run(['run', 'pull'], { scriptsDir, childEnv: { CHILD_EXIT: String(code) } });
    assert.equal(x.code, code, `exit ${code}`);
  }
  for (const name of RUN_SCRIPTS) assert.equal((await w.run(['run', name], { scriptsDir })).code, 0, name);
});

test('run uses the newest finished practice page, or the one named with --demo, and nothing else', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  w.clock = new Date(NOW.getTime() + 3600e3);
  assert.equal((await w.start()).code, 0);
  w.clock = new Date(NOW.getTime() + 7200e3);
  let made = 0;
  await w.start([], { wrapClients: ({ builder, rest }) => ({ builder: { ...builder, async createDatabase(args) { made += 1; if (made === 2) throw new Error('stop'); return builder.createDatabase(args); } }, rest }) });
  const [first, second, unfinished] = w.demos();
  const scriptsDir = standIns();
  assert.equal(childReport(await w.run(['run', 'pull'], { scriptsDir })).root, w.dir(second), 'the newest page that is ready, not the one that stopped');
  assert.equal(childReport(await w.run(['run', '--demo', first, 'pull'], { scriptsDir })).root, w.dir(first));
  assert.equal(childReport(await w.run(['run', `--demo=${first}`, 'pull'], { scriptsDir })).root, w.dir(first));
  const stopped = await w.run(['run', '--demo', unfinished, 'pull'], { scriptsDir });
  assert.equal(stopped.code, 2);
  assert.match(stopped.err, /is not finished/);
});

test('run refuses a script that is not on the list, a folder outside runs/demos, and the arguments that must never be passed', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const scriptsDir = standIns();
  for (const script of ['setup', 'rollback', 'restore', 'walkthrough', 'decide', 'approve', 'reject', '../pull', 'pull.mjs', 'hooks/guard', '']) {
    const r = await w.run(['run', script], { scriptsDir });
    assert.equal(r.code, 2, `"${script}"`);
    assert.equal(r.outs.filter((l) => l.startsWith('{')).length, 0, 'nothing was started');
  }
  assert.equal((await w.run(['run'], { scriptsDir })).code, 2);
  assert.equal((await w.run(['run', '--demo'], { scriptsDir })).code, 2);
  for (const bad of ['..', '../..', '../../agents', 'a/b', '/etc', 'C:\\Windows', '.']) {
    const r = await w.run(['run', '--demo', bad, 'pull'], { scriptsDir });
    assert.equal(r.code, 2, `--demo ${bad}`);
    assert.equal(r.outs.filter((l) => l.startsWith('{')).length, 0);
  }
  for (const arg of ['--confirm', '--bare', '--fallback-model', '--unpause', '--confirm=yes', '--bare=1']) {
    const r = await w.run(['run', 'promote', arg], { scriptsDir });
    assert.equal(r.code, 2, arg);
    assert.match(r.err, /is never passed to a script from a practice page/);
    assert.equal(r.outs.filter((l) => l.startsWith('{')).length, 0);
  }
  assert.equal((await w.run(['run', 'status', '--fallback-model', 'x'], { scriptsDir })).code, 2);
  // a folder under runs/demos that is not a demo profile is not run either
  mkdirSync(join(w.root, 'runs', 'demos', 'plain-folder'), { recursive: true });
  writeFileSync(join(w.root, 'runs', 'demos', 'plain-folder', 'demo.json'), JSON.stringify({ state: 'ready' }));
  const notDemo = await w.run(['run', '--demo', 'plain-folder', 'pull'], { scriptsDir });
  assert.equal(notDemo.code, 2);
});

test('run fills --lesson from the only Approved rule change for promote and the only Live one for followup; two of a kind are exit 2 and named', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const demo = w.demo();
  const scriptsDir = standIns();
  const lessons = demo.databases.rule_changes.database_id;
  const argvOf = async (...args) => childReport(await w.run(['run', ...args], { scriptsDir })).argv;

  // no rule change: nothing is added, the script says what is missing
  await w.run(['where']);
  assert.deepEqual(await argvOf('promote'), []);

  const one = w.fake.addRow(lessons, { Lesson: 'General references pass the rule 4 test', Tag: TAG, Status: 'Proposed' });
  await w.run(['where']);
  assert.deepEqual(await argvOf('promote'), [], 'a Proposed rule change is not for promote');
  w.fake.editRow(one, { Status: 'Approved' });
  await w.run(['where']);
  assert.deepEqual(await argvOf('promote'), ['--lesson', 'General references pass the rule 4 test']);
  assert.deepEqual(await argvOf('promote', '--driver', 'fake'), ['--driver', 'fake', '--lesson', 'General references pass the rule 4 test'], 'the lesson goes after the arguments that were given');
  assert.deepEqual(await argvOf('promote', '--lesson', 'Another one'), ['--lesson', 'Another one'], 'a lesson that was named is not replaced');
  assert.deepEqual(await argvOf('promote', '--lesson=Another one'), ['--lesson=Another one']);
  assert.deepEqual(await argvOf('followup'), [], 'an Approved rule change is not for followup');
  assert.deepEqual(await argvOf('status'), [], 'no other script gets a lesson');

  const two = w.fake.addRow(lessons, { Lesson: 'A second change', Tag: TAG, Status: 'Approved' });
  await w.run(['where']);
  const both = await w.run(['run', 'promote'], { scriptsDir });
  assert.equal(both.code, 2);
  assert.match(both.err, /^run: 2 rule changes are Approved: /);
  assert.ok(both.err.includes('"General references pass the rule 4 test"') && both.err.includes('"A second change"'), 'both are named');
  assert.equal(both.outs.filter((l) => l.startsWith('{')).length, 0);
  assert.deepEqual(await argvOf('promote', '--lesson', 'A second change'), ['--lesson', 'A second change'], 'naming one settles it');

  w.fake.editRow(one, { Status: 'Live' });
  w.fake.editRow(two, { Status: 'Rejected' });
  await w.run(['where']);
  assert.deepEqual(await argvOf('followup'), ['--lesson', 'General references pass the rule 4 test']);
  assert.deepEqual(await argvOf('promote'), []);
});

test('run does not hand the script a different state folder through the environment of the caller', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const scriptsDir = standIns();
  const before = process.env.CLAIM_TAGGER_MVP_ROOT;
  process.env.CLAIM_TAGGER_MVP_ROOT = join(w.root, 'elsewhere');
  try {
    const r = await w.run(['run', 'pull'], { scriptsDir });
    assert.equal(childReport(r).root, w.dir());
  } finally {
    if (before === undefined) delete process.env.CLAIM_TAGGER_MVP_ROOT;
    else process.env.CLAIM_TAGGER_MVP_ROOT = before;
  }
});

// ---- the command line -------------------------------------------------------------------------------------------------------------------------------

test('an unknown command or none prints the usage and is exit 2; --help is exit 0', async () => {
  const w = newWorld();
  const none = await w.run([]);
  assert.equal(none.code, 2);
  assert.match(none.err, /walkthrough\.mjs start --parent/);
  assert.equal((await w.run(['frobnicate'])).code, 2);
  const help = await w.run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /walkthrough\.mjs run \[--demo <id>\]/);
  assert.equal((await w.run(['start', '--help'])).code, 0);
});

test('no command of the walkthrough reads .env: with a token given and the repo root pointed at an empty folder, everything still runs', async () => {
  const w = newWorld();
  const empty = tmp('no-env-at-all');
  const r = await w.start([], { repoRoot: empty });
  assert.equal(r.code, 0, r.err);
  assert.equal((await w.run(['where'], { repoRoot: empty })).code, 0);
  assert.equal((await w.run(['verify', '--json'], { repoRoot: empty })).code, 0);
  assert.equal(readdirSync(empty).length, 0, 'nothing was written there either');
});

// ---- acting as the editor (decision D31) -----------------------------------------------------------------------------------------------------------------
//
// decide, approve and reject are the demo-only exception to hard rule 1: on a practice page the agent may do what the editor does. What is tested: the check
// that lets it (allowed in a practice page, refused on the production folder and without the option), the three commands against the fake Notion, the log,
// the read-back, and the stops (a pause, a page that is not finished, a folder that is not a practice page).

const ROW_PAGE = '0a9e0000-0000-4000-8000-0000000000aa';
// the editor's four columns of a claim (CLAIMS-REVIEW.md): the relation (no tag), Review status, Why wrong, Challenged tags notes
const EDITOR_QUEUE = { 'Claim quality tags — verified': [], 'Review status': 'Reviewed', 'Why wrong': 'Rule unclear', 'Challenged tags notes': 'Rule 4 is too strict.' };
const LESSON = 'General references pass the rule 4 test';

/** The config of a practice page and the folder one lives in (directly under runs/demos). Nothing is made on disk: checkPlan only looks at the path. */
function demoPlanWorld() {
  const production = withRealIds(structuredClone(loadConfig(codeRoot())));
  const demo = dp.buildDemoConfig(production, { demoId: '20261015-1422-r1', title: dp.demoTitle(NOW), parentId: '0123456789abcdef0123456789abcdef', tag: TAG });
  const base = tmp('editor-plans');
  return { production, demo, base, root: join(base, 'runs', 'demos', '20261015-1422-r1') };
}

const planOf = (config, fill) => {
  const plan = newPlan({ runId: 'editor-test', script: 'walkthrough.mjs', config, now: () => NOW });
  fill(plan);
  return plan;
};
const queueUpdate = (config, properties = EDITOR_QUEUE) => planOf(config, (p) => p.update('claims_copy', 'abc', ROW_PAGE, properties));
const lessonUpdate = (config, properties) => planOf(config, (p) => p.update('rule_changes', 'A rule change', ROW_PAGE, properties));
const lastLine = (out) => out.trimEnd().split('\n').at(-1);
const patchCount = (w) => w.fake.requests.filter((q) => q.method === 'PATCH' && q.path.startsWith('/pages/')).length;
const dashless = (id) => String(id).replace(/-/g, '');
const actionsOf = (w, id) => lines(join(w.dir(id), 'editor-actions.jsonl'));

/** A rule change as the propose step leaves it. */
function addProposed(w, over = {}) {
  return w.fake.addRow(w.db('rule_changes'), {
    Lesson: LESSON, Tag: TAG, Rule: 'Context-dependent rule 4', Kind: 'Clarify wording', Status: 'Proposed',
    'Current text': 'Test: could a reader say which thing?', 'Proposed text': 'Test: could a reader say which thing? A general reference passes.', ...over,
  });
}
const lessonByTitle = (w, title) => w.rows('rule_changes').find((r) => r.Lesson === title);

/**
 * The state after step 2, as the tag step leaves it: both claims are To review, so every tag the agent judged on them waits and none is written to Agent tags
 * (claimColumns of propose.mjs says what is written), a ledger row for each of the two with the proposal, and a new Last run summary (a pull of the page then says step 3).
 */
function agentHasRead(w, id) {
  const { manifest } = real();
  const edition = w.demo(id).edition;
  const reads = {
    presspool: { proposal: 'Applies', confidence: 0.8 },
    aiforce: { proposal: "Can't tell", confidence: 0.5 },
  };
  for (const o of manifest.open) {
    const claim = manifest.claims.find((c) => c.key === o.claim);
    const read = reads[o.claim] ?? reads.aiforce;
    const reason = `${claim.short.replace(/…$/, '')}: which one? · Context-dependent rule 3 · 3 of 3 runs agree`;
    const columns = claimColumns({ judgedNames: [TAG], verdicts: new Map([[TAG, read.proposal]]), toReview: true, edition });
    w.fake.editRow(w.rowBy('claims_copy', 'Geo ID', claim['Geo ID'], id).page_id, {
      'Agent tags': columns.agent_tags,
      'Agent notes': columns.agent_notes,
      'Agent confidence': read.confidence,
      'Agent reasons': `${TAG}: ${reason}`,
    });
    w.fake.addRow(w.db('tag_decisions', id), {
      Claim: claim['Geo Name'], Key: `${claim['Geo ID']}::${TAG}`, Tag: TAG, 'Agent proposal': read.proposal, 'Agent confidence': read.confidence, 'Agent reason': reason, 'Rulebook edition': edition,
    });
  }
  w.fake.editRow(w.rows('agent_settings', id)[0].page_id, { 'Last run summary': 'Tag · 15 Oct 14:40 · 7 claims' });
}

/** Both claims that wait are decided the way the page tells the editor to: the state in which a rule change is drafted. */
async function decideBoth(w) {
  agentHasRead(w);
  for (const o of real().manifest.open) assert.equal((await w.run(['decide', '--claim', o.claim])).code, 0);
}

test('isDemoRoot: a folder directly under runs/demos, in any letter case and with either slash; nothing else', () => {
  const backslash = String.fromCharCode(92);
  assert.equal(isDemoRoot(join(tmpdir(), 'x', 'runs', 'demos', '20261015-1422-r1')), true);
  assert.equal(isDemoRoot(['C:', 'work', 'agents', 'mvp', 'RUNS', 'Demos', '20261015-1422-r1'].join(backslash)), true);
  assert.equal(isDemoRoot('/work/agents/mvp/runs/demos/20261015-1422-r1/'), true);
  for (const no of ['/work/agents/mvp', '/work/agents/mvp/runs', '/work/agents/mvp/runs/demos', '/work/agents/mvp/runs/demos/a/b', '/work/agents/mvp/demos/a', '/work/agents/mvp/runs/other/a', '/runs/demos', '', '   ', null, undefined, 7]) {
    assert.equal(isDemoRoot(no), false, String(no));
  }
});

test('checkPlan with demoEditor allows, in a practice page, the editor columns on an update of a claim and Status Approved or Rejected and Editor wording on an update of a rule change', () => {
  const w = demoPlanWorld();
  const opts = { root: w.root, demoEditor: true };
  const ok = (plan) => assert.deepEqual(checkPlan(plan, w.demo, opts).problems, []);
  ok(queueUpdate(w.demo));
  ok(queueUpdate(w.demo, { 'Review status': 'Reviewed' }));
  ok(queueUpdate(w.demo, { 'Claim quality tags — verified': ['0a9e0000-0000-4000-8000-0000000000bb'], 'Review status': 'Reviewed', 'Why wrong': 'Agent slip', 'Challenged tags notes': 'The claim names its subject.' }));
  ok(lessonUpdate(w.demo, { Status: 'Approved' }));
  ok(lessonUpdate(w.demo, { Status: 'Rejected' }));
  ok(lessonUpdate(w.demo, { Status: 'Approved', 'Editor wording': 'Test: the whole rule, as the editor wants it.' }));
  ok(lessonUpdate(w.demo, { 'Editor wording': 'Test: the whole rule, as the editor wants it.' }));
  ok(lessonUpdate(w.demo, { Status: 'Live', 'Safety check result': 'PASS: examples 11/11' })); // what a script may always write is still fine
  assert.equal(checkPlan(queueUpdate(w.demo), w.demo, opts).ok, true);
});

test('checkPlan refuses those same plans without the option, on a production config, and on a folder that is not a practice page', () => {
  const w = demoPlanWorld();
  const refuses = (plan, config, opts, pattern) => {
    const r = checkPlan(plan, config, opts);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => pattern.test(p)), r.problems.join('\n'));
  };
  const editorColumn = /is a column only an editor writes/;
  const status = /Status "(Approved|Rejected)" is not one a script may write/;
  // the option is not given, or is not exactly true: hard rule 1 holds in a practice page too
  for (const opts of [{ root: w.root }, { root: w.root, demoEditor: false }, { root: w.root, demoEditor: 'yes' }, { root: w.root, demoEditor: 1 }]) {
    refuses(queueUpdate(w.demo), w.demo, opts, editorColumn);
    refuses(lessonUpdate(w.demo, { Status: 'Approved' }), w.demo, opts, status);
    refuses(lessonUpdate(w.demo, { Status: 'Rejected' }), w.demo, opts, status);
    refuses(lessonUpdate(w.demo, { 'Editor wording': 'x' }), w.demo, opts, editorColumn);
  }
  // the production config is never a practice page, whatever the folder says
  refuses(queueUpdate(w.production), w.production, { root: w.root, demoEditor: true }, editorColumn);
  refuses(lessonUpdate(w.production, { Status: 'Approved' }), w.production, { root: w.root, demoEditor: true }, status);
  refuses(lessonUpdate(w.production, { 'Editor wording': 'x' }), w.production, { root: w.root, demoEditor: true }, editorColumn);
  // a practice page's config on a folder that is not a practice page under runs/demos: the production folder, runs/demos itself, a folder inside a practice page
  for (const root of [w.base, join(w.base, 'runs'), join(w.base, 'runs', 'demos'), join(w.root, 'sub'), join(w.base, 'runs', 'other', 'x'), join(w.base, 'demos', 'x'), codeRoot()]) {
    refuses(queueUpdate(w.demo), w.demo, { root, demoEditor: true }, editorColumn);
    refuses(lessonUpdate(w.demo, { Status: 'Approved' }), w.demo, { root, demoEditor: true }, status);
  }
  // no root given: the state folder the scripts run in, which here is the agent folder
  const saved = process.env.CLAIM_TAGGER_MVP_ROOT;
  delete process.env.CLAIM_TAGGER_MVP_ROOT;
  try {
    refuses(queueUpdate(w.demo), w.demo, { demoEditor: true }, editorColumn);
  } finally {
    if (saved !== undefined) process.env.CLAIM_TAGGER_MVP_ROOT = saved;
  }
});

test('checkPlan with demoEditor allows nothing else: no create, no other table, no other column, no other Status, no protected id', () => {
  const w = demoPlanWorld();
  const opts = { root: w.root, demoEditor: true };
  const refuses = (plan, pattern) => {
    const r = checkPlan(plan, w.demo, opts);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => pattern.test(p)), r.problems.join('\n'));
  };
  // a create is not an update: the editor columns of a create belong to the setup of a practice page, with its marker
  refuses(planOf(w.demo, (p) => p.create('claims_copy', 'abc', { 'Geo Name': 'A claim', ...EDITOR_QUEUE })), /is a column only an editor writes/);
  refuses(planOf(w.demo, (p) => p.create('rule_changes', 'A rule change', { Status: 'Approved' })), /Status "Approved" is not one a script may write/);
  // other tables: Paused is the editor's and stays refused; the other tables have no editor column that this opens
  refuses(planOf(w.demo, (p) => p.update('agent_settings', 'Claim tagger', ROW_PAGE, { Paused: true })), /"Paused" is a column only an editor writes/);
  refuses(planOf(w.demo, (p) => p.update('agent_settings', 'Claim tagger', ROW_PAGE, { Paused: false })), /"Paused" is a column only an editor writes/);
  refuses(planOf(w.demo, (p) => p.update('rulebook', TAG, ROW_PAGE, { Status: 'Verified' })), /"Status" is not a column this plan may write to rulebook/);
  refuses(planOf(w.demo, (p) => p.update('claims_copy', 'abc', ROW_PAGE, { 'Geo Name': 'Another name' })), /"Geo Name" is not a column this plan may write to claims_copy/);
  // other columns of the two tables, and other values of Status
  refuses(queueUpdate(w.demo, { 'Review status': 'Reviewed', Nonsense: 'x' }), /"Nonsense" is not a column this plan may write to claims_copy/);
  // the ledger has no editor column: its copies of a decision are an agent's to write, with or without the option, but a person's Status on a rule change is not
  assert.deepEqual(checkPlan(planOf(w.demo, (p) => p.update('tag_decisions', `abc::${TAG}`, ROW_PAGE, { 'Tag outcome': 'Applies' })), w.demo, { root: w.root }).problems, []);
  refuses(lessonUpdate(w.demo, { Status: 'Bogus' }), /Status "Bogus" is not one a script may write/);
  refuses(lessonUpdate(w.demo, { Status: 'Approved', Nonsense: 'x' }), /"Nonsense" is not a column this plan may write to rule_changes/);
  // a protected id is refused as ever, and one op per row
  const protectedId = dashless(w.demo.notion.protected_database_ids[0]);
  refuses(queueUpdate(w.demo, { 'Review status': 'Reviewed', 'Challenged tags notes': `see https://www.notion.so/${protectedId}` }), /mentions a protected id/);
  refuses(planOf(w.demo, (p) => { p.update('claims_copy', 'k', ROW_PAGE, EDITOR_QUEUE); p.update('claims_copy', 'k', ROW_PAGE, EDITOR_QUEUE); }), /the key appears twice/);
});

test('applyPlan passes demoEditor on to the check: the plan that writes an editor column is refused before any request without it, and in a folder that is not a practice page with it', async () => {
  const w = demoPlanWorld();
  const calls = [];
  const never = (name) => async () => {
    calls.push(name);
    throw new Error(`${name} must not be called`);
  };
  const client = { createPage: never('createPage'), updatePage: never('updatePage'), retrievePage: never('retrievePage') };
  const apply = (extra) => applyPlan({ plan: queueUpdate(w.demo), dir: tmp('apply'), client, config: w.demo, schemas: {}, root: w.root, now: () => NOW, ...extra });
  const refused = (e) => e instanceof PlanError && /refused and nothing was sent/.test(e.message);
  await assert.rejects(() => apply({}), (e) => refused(e) && e.problems.some((p) => /only an editor writes/.test(p)));
  await assert.rejects(() => apply({ demoEditor: true, root: w.base }), refused);
  await assert.rejects(() => apply({ demoEditor: true, config: w.production }), refused);
  // in a practice page the check lets it by; what stops it here is that this config holds no table ids yet, which is also known before any request
  await assert.rejects(() => apply({ demoEditor: true }), (e) => e instanceof PlanError && /cannot be sent as it stands/.test(e.message) && e.problems.some((p) => /no database id/.test(p)));
  assert.deepEqual(calls, [], 'no request was made');
});

test('decide enters the manifest values for one of the two claims, writes the four editor columns and nothing else in one request, logs the action before and after, and says what to do next', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const { manifest } = real();
  const [id] = w.demos();
  const V = dp.CLAIM_COLUMNS.verified;
  const EDITOR = [V, 'Review status', 'Why wrong', 'Challenged tags notes'];
  const claims = manifest.open.map((o) => manifest.claims.find((c) => c.key === o.claim));
  const enter = manifest.open[0].enter; // the press pool: the tag does not apply
  const rowOf = (claim) => w.rowBy('claims_copy', 'Geo ID', claim['Geo ID']);
  const book = w.rows('rulebook')[0];
  agentHasRead(w);
  const writesBefore = w.fake.writes().length;
  const agentColumns = (claim) => ['Agent tags', 'Agent notes', 'Agent confidence', 'Agent reasons', 'Geo Name'].map((c) => rowOf(claim)[c]);
  const agentBefore = agentColumns(claims[0]);

  // only --claim: the values the page tells the editor to enter
  const first = await w.run(['decide', '--claim', manifest.open[0].claim]);
  assert.equal(first.code, 0, first.err);
  const row = rowOf(claims[0]);
  assert.deepEqual(row[V], [], 'the tag does not apply to the press pool: nothing is verified');
  for (const column of EDITOR.slice(1)) assert.equal(row[column], enter[column], column);
  assert.equal(rowOf(claims[1])['Review status'], 'To review', 'the other claim is untouched');
  assert.deepEqual(agentColumns(claims[0]), agentBefore, 'the agent\'s columns are not the editor\'s to write');
  const sent = w.fake.writes().slice(writesBefore);
  assert.equal(sent.length, 1, 'one write');
  assert.equal(sent[0].method, 'PATCH');
  assert.equal(dashless(sent[0].path), `/pages/${dashless(row.page_id)}`);
  assert.deepEqual(Object.keys(sent[0].body.properties).sort(), [...EDITOR].sort(), 'the four editor columns of the claim, and nothing else');
  assert.deepEqual(sent[0].body.properties[V], { relation: [] });

  // the report: a sentence, the values, the next step; nothing of the code
  assert.deepEqual(lintReport(`${first.out}\n`), []);
  assert.equal(first.out.split('\n')[0], `Walkthrough: acting as the editor, the claim ${quoted(claims[0]['Geo Name'])} now reads Reviewed with no tag verified (${enter['Why wrong']}).`);
  assert.ok(first.out.includes(`| ${V} | none |`));
  assert.ok(first.out.includes('| Review status | Reviewed |'));
  assert.ok(first.out.includes(`| Why wrong | ${enter['Why wrong']} |`));
  assert.ok(first.out.includes(`| Challenged tags notes | ${quoted(enter['Challenged tags notes'], 100)} |`));
  assert.match(lastLine(first.out), /^Next: open Your queue \(https:\/\/www\.notion\.so\/\S+\) and decide your remaining claim\.$/, 'one of the two is decided: the other one is what is left');
  assert.equal(lastLine(first.out), lastLine((await w.run(['where'])).out), 'the Next line is the one where gives');
  assert.ok(!first.out.includes('D31'), 'the report holds no code');
  assert.ok(first.err.includes(`acting as the editor on practice page ${id} (decision D31): Claims `), 'the engineer is told whose hand it is');

  // the log: the sentence, what was planned and what was done, the values written and the values that were there
  const log = actionsOf(w);
  assert.deepEqual(log.map((l) => l.status), ['planned', 'done']);
  for (const l of log) {
    assert.equal(l.sentence, `acting as the editor on practice page ${id} (decision D31)`);
    assert.equal(l.demo_id, id);
    assert.match(l.at, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual([l.action, l.table, l.key, dashless(l.page_id), l.claim], ['decide', 'claims_copy', claims[0]['Geo ID'], dashless(row.page_id), 'presspool']);
    assert.deepEqual(l.wrote, { ...enter, [V]: [] });
    assert.deepEqual(Object.keys(l.before).sort(), [...EDITOR].sort());
    assert.deepEqual(l.before[V], [], 'no tag was verified');
    assert.equal(l.before['Review status'], 'To review');
    assert.ok(!l.before['Why wrong'] && !l.before['Challenged tags notes'], 'the cells were empty');
  }
  assert.equal(log[1].read_back, 'ok');
  const planRun = join(w.dir(), 'runs', log[0].plan_run);
  assert.equal(lines(join(planRun, 'plan.jsonl')).length, 2, 'the plan on disk: a header and one op');
  assert.equal(lines(join(planRun, 'plan.jsonl'))[0].plan.script, 'walkthrough.mjs');
  assert.equal(lines(join(planRun, 'plan.jsonl'))[1].table, 'claims_copy');
  assert.equal(lines(join(planRun, 'ledger.jsonl')).at(-1).read_back, 'ok', 'the ledger says the row was read back');

  // the second claim, with the values given: the tag applies, so the relation holds the page id of the tag's row; the next step is the next one of the page
  const second = await w.run(['decide', '--demo', id, '--claim', manifest.open[1].claim, '--outcome', 'Applies', '--why', 'Rule should change', '--reasoning', 'Rule 4 should say that a named debate is enough.']);
  assert.equal(second.code, 0, second.err);
  const row2 = rowOf(claims[1]);
  assert.deepEqual(row2[V].map(dashless), [dashless(book.page_id)]);
  assert.deepEqual([row2['Review status'], row2['Why wrong'], row2['Challenged tags notes']], ['Reviewed', 'Rule should change', 'Rule 4 should say that a named debate is enough.']);
  assert.equal(second.out.split('\n')[0], `Walkthrough: acting as the editor, the claim ${quoted(claims[1]['Geo Name'])} now reads Reviewed with Context-dependent verified (Rule should change).`);
  assert.ok(second.out.includes(`| ${V} | Context-dependent |`));
  assert.equal(lastLine(second.out), `Next: type ${manifest.steps[3].command}.`);
  assert.equal(actionsOf(w).length, 4);
  assert.deepEqual(actionsOf(w).at(-1).tags, [TAG]);
  assert.match((await w.run(['where'])).out, /you are at step 4, /);

  // the same values again change nothing and send nothing, and the log says so
  const writes = w.fake.writes().length;
  const again = await w.run(['decide', '--claim', manifest.open[0].claim]);
  assert.equal(again.code, 0, again.err);
  assert.equal(again.out.split('\n')[0], `Walkthrough: acting as the editor, the claim ${quoted(claims[0]['Geo Name'])} already reads Reviewed with no tag verified (${enter['Why wrong']}); nothing was changed.`);
  assert.equal(w.fake.writes().length, writes, 'nothing was sent');
  assert.equal(actionsOf(w).at(-1).status, 'unchanged');
  assert.equal(actionsOf(w).length, 5);

  // a changed mind is a write again; only the columns that were given are written (the tag and the status), and the log keeps what was there before
  const changed = await w.run(['decide', '--claim', manifest.open[0].claim, '--outcome', 'Applies']);
  assert.equal(changed.code, 0, changed.err);
  assert.deepEqual(rowOf(claims[0])[V].map(dashless), [dashless(book.page_id)]);
  assert.equal(rowOf(claims[0])['Why wrong'], enter['Why wrong']);
  assert.equal(rowOf(claims[0])['Challenged tags notes'], enter['Challenged tags notes']);
  const done = actionsOf(w).filter((l) => l.status === 'done');
  assert.deepEqual(Object.keys(done.at(-1).wrote).sort(), [V, 'Review status'].sort());
  assert.deepEqual(done.at(-1).wrote[V].map(dashless), [dashless(book.page_id)]);
  assert.deepEqual(done.at(-1).before, { [V]: [], 'Review status': 'Reviewed' });
  assert.equal(Object.keys(w.fake.writes().at(-1).body.properties).length, 2);
  // and back: Does not apply empties the relation
  assert.equal((await w.run(['decide', '--claim', manifest.open[0].claim, '--outcome', 'Does not apply'])).code, 0);
  assert.deepEqual(rowOf(claims[0])[V], []);
});

test('decide changes the two claims that wait and nothing else, and says why when it refuses', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const rows = () => JSON.stringify([w.rows('claims_copy'), w.rows('tag_decisions')]);
  const before = rows();
  const writes = w.fake.writes().length;
  const refused = async (argv, pattern) => {
    const r = await w.run(['decide', ...argv]);
    assert.equal(r.code, 2, `${argv.join(' ')}: ${r.err}`);
    assert.match(r.err, pattern);
    assert.equal(r.out, '', 'no report of a change');
  };
  await refused([], /decide needs --claim <key>; the claims to decide are: presspool, aiforce/);
  await refused(['--claim', ''], /decide needs --claim <key>/);
  await refused(['--claim', 'nobody'], /"nobody" is not a claim of this practice page \(the claims to decide are: presspool, aiforce\)/);
  await refused(['--claim', 'cnn'], /"cnn" is one of the earlier decisions, which are not changed/);
  await refused(['--claim', 'presspool', '--outcome', 'Maybe'], /--outcome must be Applies or Does not apply/);
  await refused(['--claim', 'presspool', '--outcome', 'Applies', '--why', 'Because'], /--why must be Agent slip, Rule unclear, Rule should change/);
  await refused(['--claim', 'presspool', '--why', 'Rule unclear'], /--why and --reasoning go with --outcome/);
  await refused(['--claim', 'presspool', '--reasoning', 'Because.'], /--why and --reasoning go with --outcome/);
  await refused(['--claim', 'presspool', '--outcome', 'Applies', '--reasoning', '  '], /--reasoning is empty/);
  await refused(['--claim', 'presspool', '--frobnicate'], /frobnicate/);
  await refused(['--demo', 'nope', '--claim', 'presspool'], /there is no practice page "nope"/);
  await refused(['--demo', '../x', '--claim', 'presspool'], /is not a practice page id/);
  assert.equal(rows(), before, 'no row was changed');
  assert.equal(w.fake.writes().length, writes, 'no request was sent');
  assert.ok(!existsSync(join(w.dir(), 'editor-actions.jsonl')), 'a refusal is not an action');
  // the copy of the manifest cannot be changed behind the page's back, so the columns and the tags a decision names are the ones the page was planned with
  const file = join(w.dir(), 'walkthrough', 'manifest.json');
  const text = readFileSync(file, 'utf8');
  const hand = (change) => {
    const m = JSON.parse(text);
    change(m);
    writeFileSync(file, JSON.stringify(m));
  };
  hand((m) => { m.open[0].enter['Agent tags'] = TAG; });
  const planted = await w.run(['decide', '--claim', 'presspool']);
  assert.equal(planted.code, 2);
  assert.match(planted.err, /manifest copy .* is not the one it was planned from/, 'the copy of the manifest cannot be changed behind the page\'s back');
  writeFileSync(file, text);
  assert.equal(w.fake.writes().length, writes);
});

test('the editor actions stop where everything stops: a pause file, Paused in Agent settings, a page that is not finished, no page at all', async () => {
  const none = newWorld();
  const noPage = await none.run(['decide', '--claim', 'presspool']);
  assert.equal(noPage.code, 2);
  assert.match(noPage.err, /there is no finished practice page under Demos yet/);

  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const base = patchCount(w);
  writeFileSync(join(w.dir(), 'runs', 'PAUSED'), 'a person paused it\n');
  for (const argv of [['decide', '--claim', 'presspool'], ['approve'], ['reject']]) {
    const r = await w.run(argv);
    assert.equal(r.code, 3, argv.join(' '));
    assert.match(r.err, /paused \(its pause file exists\)/);
  }
  rmSync(join(w.dir(), 'runs', 'PAUSED'));
  w.fake.editRow(w.rows('agent_settings')[0].page_id, { Paused: true });
  for (const argv of [['decide', '--claim', 'presspool'], ['approve'], ['reject']]) {
    const r = await w.run(argv);
    assert.equal(r.code, 3, argv.join(' '));
    assert.match(r.err, /Paused is ticked in Agent settings/);
  }
  assert.equal(patchCount(w), base, 'nothing was written');
  assert.ok(!existsSync(join(w.dir(), 'editor-actions.jsonl')), 'a stop is not an action');
  w.fake.editRow(w.rows('agent_settings')[0].page_id, { Paused: false });
  assert.equal((await w.run(['decide', '--claim', 'presspool'])).code, 0, 'a person clears it, then it works');

  // a page that stopped halfway is not a practice page to act on
  const unfinished = newWorld();
  assert.equal((await unfinished.start([], crashAtDatabase(2))).code, 1);
  const r = await unfinished.run(['decide', '--demo', unfinished.demos()[0], '--claim', 'presspool']);
  assert.equal(r.code, 2);
  assert.match(r.err, /is not finished/);
});

test('a write that fails, or that the read-back does not confirm, is not reported as done: the log says failed, the exit code is 1 or 2, and no success is claimed', async () => {
  const { manifest } = real();
  const claim = manifest.claims.find((c) => c.key === manifest.open[0].claim);
  const rowOf = (w) => w.rowBy('claims_copy', 'Geo ID', claim['Geo ID']);

  // Notion refuses the write
  const refusing = newWorld();
  assert.equal((await refusing.start()).code, 0);
  const refused = await refusing.run(['decide', '--claim', claim.key], { wrapClients: ({ builder, rest }) => ({ builder, rest: { ...rest, async updatePage() { throw new Error('Notion said no'); } } }) });
  assert.equal(refused.code, 1, refused.err);
  assert.match(refused.err, /the change to Claims was not made: .*Notion said no/);
  assert.equal(refused.out, '', 'no report that says it was done');
  assert.equal(rowOf(refusing)['Review status'], 'To review', 'the row is as it was');
  assert.ok(!rowOf(refusing)['Why wrong']);
  const log = actionsOf(refusing);
  assert.deepEqual(log.map((l) => l.status), ['planned', 'failed']);
  assert.match(log[1].error, /Notion said no/);

  // Notion takes the write but the row reads differently afterwards
  const altering = newWorld();
  assert.equal((await altering.start()).code, 0);
  const altered = await altering.run(['decide', '--claim', claim.key], {
    wrapClients: ({ builder, rest }) => ({
      builder,
      rest: { ...rest, async updatePage(id, body) { return rest.updatePage(id, { ...body, properties: { ...body.properties, 'Why wrong': { select: { name: 'Agent slip' } } } }); } },
    }),
  });
  assert.equal(altered.code, 2, altered.err);
  assert.match(altered.err, /the change to Claims was not confirmed by the read-back: /);
  assert.equal(altered.out, '', 'no report that says it was done');
  const failed = actionsOf(altering);
  assert.deepEqual(failed.map((l) => l.status), ['planned', 'failed']);
  assert.ok(!failed.some((l) => l.read_back === 'ok'));


});

test('approve sets the only Proposed rule change to Approved, with the editor\'s own wording when it is given; reject sets Rejected; every action is logged', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const { manifest } = real();
  const [id] = w.demos();
  await decideBoth(w);
  addProposed(w);
  assert.match((await w.run(['where'])).out, /you are at step 5, /);

  const first = await w.run(['approve']);
  assert.equal(first.code, 0, first.err);
  assert.equal(lessonByTitle(w, LESSON).Status, 'Approved');
  assert.deepEqual(lintReport(`${first.out}\n`), []);
  assert.equal(first.out.split('\n')[0], `Walkthrough: acting as the editor, the rule change ${quoted(LESSON)} is now Approved.`);
  assert.ok(first.out.includes('| Status | Approved |'));
  assert.equal(lastLine(first.out), `Next: type ${manifest.steps[5].command}.`);
  assert.match((await w.run(['where'])).out, /you are at step 6, /);
  let log = actionsOf(w).filter((l) => l.action === 'approve');
  assert.deepEqual(log.map((l) => l.status), ['planned', 'done']);
  assert.equal(log[1].sentence, `acting as the editor on practice page ${id} (decision D31)`);
  assert.deepEqual([log[1].table, log[1].key, log[1].wrote, log[1].before, log[1].read_back], ['rule_changes', LESSON, { Status: 'Approved' }, { Status: 'Proposed' }, 'ok']);

  // a second rule change, found by its title in any letter case, approved with the editor's own text
  addProposed(w, { Lesson: 'A second change' });
  const wording = 'Test: could a reader who sees only this sentence say which specific thing each definite reference points at? A general reference passes.';
  const second = await w.run(['approve', '--lesson', 'a second change', '--wording', wording]);
  assert.equal(second.code, 0, second.err);
  const row = lessonByTitle(w, 'A second change');
  assert.equal(row.Status, 'Approved');
  assert.equal(row['Editor wording'], wording);
  assert.ok(second.out.includes(`| Editor wording | ${quoted(wording, 100)} |`));
  assert.equal(second.out.split('\n')[0], `Walkthrough: acting as the editor, the rule change ${quoted('A second change')} is now Approved, with its Editor wording filled in.`);
  assert.deepEqual(lintReport(`${second.out}\n`), []);
  log = actionsOf(w).filter((l) => l.action === 'approve' && l.status === 'done');
  assert.deepEqual(log.at(-1).wrote, { Status: 'Approved', 'Editor wording': wording });
  assert.equal(log.at(-1).key, 'A second change');
  assert.equal(log.at(-1).before.Status, 'Proposed');
  assert.ok(!log.at(-1).before['Editor wording'], 'there was no wording before');

  // approved already, and no wording to add: nothing to write
  const writes = w.fake.writes().length;
  const nothing = await w.run(['approve', '--lesson', 'A second change']);
  assert.equal(nothing.code, 0, nothing.err);
  assert.equal(nothing.out.split('\n')[0], `Walkthrough: acting as the editor, the rule change ${quoted('A second change')} is already Approved; nothing was changed.`);
  assert.equal(w.fake.writes().length, writes);
  assert.equal(actionsOf(w).at(-1).status, 'unchanged');
  const sameWording = await w.run(['approve', '--lesson', 'A second change', '--wording', wording]);
  assert.equal(sameWording.code, 0, sameWording.err);
  assert.equal(sameWording.out.split('\n')[0], `Walkthrough: acting as the editor, the rule change ${quoted('A second change')} is already Approved with that wording; nothing was changed.`);
  assert.equal(w.fake.writes().length, writes, 'the same wording is not written twice');

  // reject: the Approved one by its title; the wording stays as it was
  const rejected = await w.run(['reject', '--lesson', 'A second change']);
  assert.equal(rejected.code, 0, rejected.err);
  assert.equal(lessonByTitle(w, 'A second change').Status, 'Rejected');
  assert.equal(lessonByTitle(w, 'A second change')['Editor wording'], wording, 'rejecting leaves the wording as it was');
  assert.equal(rejected.out.split('\n')[0], `Walkthrough: acting as the editor, the rule change ${quoted('A second change')} is now Rejected.`);
  const last = actionsOf(w).filter((l) => l.status === 'done').at(-1);
  assert.deepEqual([last.action, last.wrote, last.before], ['reject', { Status: 'Rejected' }, { Status: 'Approved' }]);
});

test('approve and reject name the rule change they act on or refuse: none waiting, two waiting, one that is not waiting, an empty wording', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const snapshot = () => JSON.stringify(w.rows('rule_changes'));
  const none = await w.run(['approve']);
  assert.equal(none.code, 2);
  assert.match(none.err, /approve: no rule change is Proposed$/);
  const noneToReject = await w.run(['reject']);
  assert.equal(noneToReject.code, 2);
  assert.match(noneToReject.err, /reject: no rule change is Proposed or Approved$/);

  addProposed(w, { Lesson: 'First' });
  addProposed(w, { Lesson: 'Second' });
  addProposed(w, { Lesson: 'Third', Status: 'Live' });
  const before = snapshot();
  const two = await w.run(['approve']);
  assert.equal(two.code, 2);
  assert.match(two.err, /approve: 2 rule changes are Proposed: "(First|Second)"; "(First|Second)"\. Add --lesson "<title>" to say which one\./);
  assert.ok(two.err.includes('"First"') && two.err.includes('"Second"') && !two.err.includes('"Third"'), 'the two that wait are named, the Live one is not');
  const twoToReject = await w.run(['reject']);
  assert.equal(twoToReject.code, 2);
  assert.match(twoToReject.err, /reject: 2 rule changes are Proposed or Approved: /);
  const unknown = await w.run(['approve', '--lesson', 'Nonesuch']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /approve: no rule change is called "Nonesuch"/);
  const emptyWording = await w.run(['approve', '--lesson', 'First', '--wording', '   ']);
  assert.equal(emptyWording.code, 2);
  assert.match(emptyWording.err, /approve: --wording is empty/);
  for (const command of ['approve', 'reject']) {
    const live = await w.run([command, '--lesson', 'Third']);
    assert.equal(live.code, 2, command);
    assert.match(live.err, /"Third" is Live; only a rule change that is Proposed or Approved can be changed here/);
  }
  assert.equal((await w.run(['reject', '--wording', 'x'])).code, 2, 'reject has no --wording');
  assert.equal(snapshot(), before, 'nothing was written');
  assert.ok(!existsSync(join(w.dir(), 'editor-actions.jsonl')), 'a refusal is not an action');
  // naming one settles it
  assert.equal((await w.run(['approve', '--lesson', 'Second'])).code, 0);
  assert.equal(lessonByTitle(w, 'Second').Status, 'Approved');
  assert.equal(lessonByTitle(w, 'First').Status, 'Proposed');

  // a rule change that is Approved but did not pass its safety check gets the editor's wording; approve with --wording finds it when none is Proposed
  const failed = newWorld();
  assert.equal((await failed.start()).code, 0);
  addProposed(failed, { Status: 'Approved', 'Safety check result': "FAIL: 'Melania Trump' now Does not apply" });
  assert.match((await failed.run(['approve'])).err, /approve: no rule change is Proposed$/);
  const fix = await failed.run(['approve', '--wording', 'The whole rule, with one added sentence.']);
  assert.equal(fix.code, 0, fix.err);
  assert.equal(fix.out.split('\n')[0], `Walkthrough: acting as the editor, the Editor wording of the rule change ${quoted(LESSON)} is now filled in.`);
  const row = lessonByTitle(failed, LESSON);
  assert.equal(row.Status, 'Approved');
  assert.equal(row['Editor wording'], 'The whole rule, with one added sentence.');
  assert.deepEqual(actionsOf(failed).filter((l) => l.status === 'done').at(-1).wrote, { 'Editor wording': 'The whole rule, with one added sentence.' }, 'the Status was Approved already, so only the wording is written');
});

test('reject ends the walkthrough: the Next line says there is nothing left to type, and where agrees', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  await decideBoth(w);
  addProposed(w, { Status: 'Approved', 'Safety check result': "FAIL: 'Melania Trump' now Does not apply" });
  assert.match((await w.run(['where'])).out, /it did not pass/);
  const r = await w.run(['reject']);
  assert.equal(r.code, 0, r.err);
  assert.equal(lessonByTitle(w, LESSON).Status, 'Rejected');
  assert.equal(lastLine(r.out), 'Next: nothing to type; archive the page by hand when you no longer need it.');
  assert.match((await w.run(['where'])).out, /all seven steps/);
  const again = await w.run(['reject']);
  assert.equal(again.code, 2, 'a rejected rule change is not rejected twice');
  assert.match(again.err, /reject: no rule change is Proposed or Approved$/);
});

test('decide, approve and reject are the walkthrough\'s own commands: run does not start them as scripts, even when a file of that name exists', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const scriptsDir = standIns();
  const marker = join(tmp('markers'), 'started');
  for (const name of ['decide', 'approve', 'reject']) {
    assert.ok(!RUN_SCRIPTS.includes(name), name);
    writeFileSync(join(scriptsDir, `${name}.mjs`), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'started');\n`);
    const r = await w.run(['run', name], { scriptsDir });
    assert.equal(r.code, 2, name);
    assert.match(r.err, /is not a script that a practice page may run/);
  }
  assert.ok(!existsSync(marker), 'nothing was started');
});

test('the editor actions work on a practice page only: an id that leaves the folder, a folder with no profile, a profile that is not a demo', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const base = patchCount(w);
  const writes = w.fake.writes().length;
  const commands = [['decide', '--claim', 'presspool'], ['approve'], ['reject']];
  for (const bad of ['..', '.', '../demos', '/etc', 'a/b']) {
    for (const [command, ...rest] of commands) {
      const r = await w.run([command, '--demo', bad, ...rest]);
      assert.equal(r.code, 2, `${command} --demo ${bad}`);
    }
  }
  // a folder under runs/demos that holds no profile, and one whose config is the production one
  mkdirSync(join(w.root, 'runs', 'demos', 'plain'), { recursive: true });
  writeFileSync(join(w.root, 'runs', 'demos', 'plain', 'demo.json'), JSON.stringify({ state: 'ready', created_at: '2026-10-16T00:00:00Z' }));
  mkdirSync(join(w.root, 'runs', 'demos', 'imposter'), { recursive: true });
  writeFileSync(join(w.root, 'runs', 'demos', 'imposter', 'demo.json'), JSON.stringify({ state: 'ready', created_at: '2026-10-16T01:00:00Z' }));
  writeFileSync(join(w.root, 'runs', 'demos', 'imposter', 'config.json'), readFileSync(join(w.root, 'config.json'), 'utf8'));
  for (const folder of ['plain', 'imposter']) {
    for (const [command, ...rest] of commands) {
      const r = await w.run([command, '--demo', folder, ...rest]);
      assert.equal(r.code, 2, `${command} --demo ${folder}: ${r.err}`);
    }
  }
  assert.match((await w.run(['decide', '--demo', 'imposter', '--claim', 'presspool'])).err, /does not hold a demo profile of that name/);
  assert.equal(patchCount(w), base, 'no row was changed');
  assert.equal(w.fake.writes().length, writes, 'no write was sent');
});

test('the usage lists the three editor commands, and each answers --help without touching Notion', async () => {
  const w = newWorld();
  const help = await w.run(['--help']);
  for (const name of ['decide', 'approve', 'reject']) {
    assert.ok(help.out.includes(`walkthrough.mjs ${name} `), name);
    const r = await w.run([name, '--help']);
    assert.equal(r.code, 0, name);
    assert.ok(r.out.includes(`walkthrough.mjs ${name} `));
  }
  assert.equal(w.fake.requests.length, 0, 'no request');
});

test('verify does not call a page damaged because the editor acted on it, and still finds a change nobody was meant to make', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const { manifest } = real();
  const V = dp.CLAIM_COLUMNS.verified;
  assert.equal((await w.run(['verify'])).code, 0, 'a page nobody touched is as it was built');
  assert.equal((await w.run(['decide', '--claim', manifest.open[0].claim])).code, 0);
  const afterDecide = await w.run(['verify']);
  assert.equal(afterDecide.code, 0, afterDecide.err);
  assert.match(afterDecide.out, /is as it was built/);
  assert.match(afterDecide.out, /\| Claims \| 7: 6 reviewed, 1 waiting for you \|/);
  assert.match((await w.run(['verify', '--json'])).out, /"ok":true/);
  addProposed(w);
  assert.equal((await w.run(['approve'])).code, 0);
  const afterApprove = await w.run(['verify']);
  assert.equal(afterApprove.code, 0, afterApprove.err);
  // an earlier decision that was changed by hand is still a difference
  const decided = manifest.decided[0];
  const earlier = manifest.claims.find((c) => c.key === decided.claim);
  const book = w.rows('rulebook')[0];
  w.fake.editRow(w.rowBy('claims_copy', 'Geo ID', earlier['Geo ID']).page_id, { [V]: decided[V].length ? [] : [book.page_id] });
  const changed = await w.run(['verify']);
  assert.equal(changed.code, 2);
  assert.match(changed.err, /the earlier decision .* differs from the manifest in Claim quality tags — verified/);
});
