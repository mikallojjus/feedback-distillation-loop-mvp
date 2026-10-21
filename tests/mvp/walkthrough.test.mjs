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
import { blockText, lintPage, toBlocks } from '../../agents/claim-tagger-mvp/scripts/lib/notion-blocks.mjs';
import { viewPlan } from '../../agents/claim-tagger-mvp/scripts/lib/notion-build.mjs';
import { claimColumns, propose } from '../../agents/claim-tagger-mvp/scripts/propose.mjs';
import { distill } from '../../agents/claim-tagger-mvp/scripts/distill.mjs';
import { judge, normalizeClaim } from '../../agents/claim-tagger-mvp/scripts/judge.mjs';
import { promote } from '../../agents/claim-tagger-mvp/scripts/promote.mjs';
import { pull } from '../../agents/claim-tagger-mvp/scripts/pull.mjs';
import { status } from '../../agents/claim-tagger-mvp/scripts/status.mjs';
import { BUILDER_API_VERSION, NotionError, countRequests, createClient } from '../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';
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
const FAKE_SCRIPT = fileURLToPath(new URL('./fixtures/fake-claude-loop.mjs', import.meta.url));
const TAG = 'Context-dependent';
// the Claims table (READ-DECISIONS.md, decision P4): the agent's eight columns (the seven of the tag step, then Agent reading, which only distill writes), then the editor's three, in the
// order every view of the table shows them
const AGENT_COLUMNS = ['Agent tags', 'Agent confidence', 'Agent reasons', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks', 'Agent reading'];
const EDITOR_COLUMNS = ['Verified tags', 'Review status', 'Challenged tags notes'];
const REVIEW_ORDER = ['Geo Name', ...AGENT_COLUMNS, ...EDITOR_COLUMNS];
const RETIRED_COLUMNS = ['Agent tags (old)', 'Agent notes (old)', 'Why wrong (old)'];
const RELATIONS = ['Agent tags', 'Tags waiting', 'Verified tags'];
const READING_COLUMNS = ['Agent reading', 'Rule', 'Reading note', 'Read under'];
const SEEDED = 'Seeded from the audit of 9 October.';
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

/**
 * The agent's columns of a claim row are empty (before any command ran): two relations, four texts, a number and a select. Agent reading is the exception: it is empty on a claim the editor
 * still has to decide, and on a claim decided earlier it holds the agent's seeded reading, `reading` (decision 73).
 */
function assertAgentSideEmpty(row, label, reading = null) {
  assert.deepEqual([row['Agent tags'], row['Tags waiting']], [[], []], `${label}: Agent tags and Tags waiting`);
  for (const column of ['Agent reasons', 'Agent edition', 'Agent remarks']) assert.ok([null, undefined, ''].includes(row[column]), `${label}: ${column}`);
  for (const column of ['Agent confidence', 'Agent status']) assert.ok([null, undefined, ''].includes(row[column]), `${label}: ${column}`);
  if (reading === null) assert.ok([null, undefined, ''].includes(row['Agent reading']), `${label}: Agent reading is empty, the agent has read nothing yet`);
  else assert.equal(row['Agent reading'], reading, `${label}: the seeded reading`);
}

/** The Agent reading a claim decided earlier is created with: the seeded line (decision 73), "Context-dependent: Agent slip · Seeded from the audit of 9 October." */
const SEEDED_LINE = `${TAG}: Agent slip · ${SEEDED}`;
const seededReadingOf = (manifest, key) => (manifest.decided.some((d) => d.claim === key) ? SEEDED_LINE : null);

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
  // Your queue goes under the last line of Step 3's Doing the work (the four numbered lists and the sentence on the reason word come after its first line); Lessons waiting under the Doing the work line of Step 5
  const text = (i) => dp.plainBlockText(pre[i]);
  assert.match(dp.signature(pre[anchors.your_queue]), /^paragraph\|A note that starts with "Agent slip\.", "Rule unclear\." or "Rule should change\." is taken as it stands/, 'the view goes under the sentence on the reason word, which stands under the four lists');
  const doing = pre.findLastIndex((b, i) => i < anchors.your_queue && /^Doing the work\./.test(text(i)));
  const explaining = pre.findIndex((b, i) => i > anchors.your_queue && /^Explaining the outputs\./.test(text(i)));
  assert.ok(doing >= 0 && explaining > anchors.your_queue, 'the view sits between Doing the work and Explaining the outputs of its step');
  assert.deepEqual(pre.slice(doing, anchors.your_queue + 1).map((b) => b.type).filter((type) => type !== 'numbered_list_item'), ['paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph'], 'the Doing the work line, the label of each of the four lists and the sentence on the reason word');
  assert.equal(pre.slice(doing, anchors.your_queue + 1).filter((b) => b.type === 'numbered_list_item').length, 12, 'four lists of three');
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
  const READ = 'Waits for you'; // the agent has read the claim, and it waits
  const claim = (geo_id, over = {}) => ({ geo_id, review_status: null, agent_status: READ, ...over });
  const claims = (a = {}, b = {}) => [claim('a', a), claim('b', b), claim('c', { review_status: 'Reviewed', agent_status: null })];
  const unread = { agent_status: null };
  const done = { review_status: 'Reviewed' };
  const step = (cl, lessons = [], ledger = [], settings = { last_run_summary: 'Tag · 15 Oct 10:42 · 7 claims' }) => dp.stepOf({ claims: cl, ledger, lessons, open, settings });
  // a fresh page: nothing has written a Last run summary (the build leaves it empty, status writes nothing, the tag step writes it with the notes)
  const fresh = (cl) => dp.stepOf({ claims: cl, ledger: [], lessons: [], open, settings: { last_run_summary: null } });
  assert.deepEqual(fresh(claims(unread, unread)), { step: 1 });
  assert.deepEqual(fresh(claims(unread)), { step: 1 });
  assert.deepEqual(dp.stepOf({ claims: claims(unread, unread), ledger: [], lessons: [], open, settings: { last_run_summary: '  ' } }), { step: 1 }, 'white space is no summary');
  assert.deepEqual(dp.stepOf({ claims: claims(unread, unread), ledger: [], lessons: [], open }), { step: 1 }, 'no settings row at all: nothing has run');
  assert.deepEqual(dp.stepOf({ claims: claims(unread, unread), ledger: [], lessons: [], open, settings: null }), { step: 1 });
  // a command wrote a Last run summary and the open claims still have no Agent status: step 2
  assert.deepEqual(step(claims(unread, unread)), { step: 2 });
  assert.deepEqual(step(claims(unread)), { step: 2 }, 'one claim the agent has not read is still step 2');
  assert.deepEqual(step(claims({ review_status: 'To review', agent_status: '  ' }, {})), { step: 2 }, 'white space is no status, and To review is not Reviewed');
  // with a status on the claims (the agent has read them) the step is 3 whatever Last run summary says (a page whose summary was cleared by hand is not sent back)
  for (const status of ['Waits for you', 'Done', 'Disagrees with your decision', 'Could not read']) {
    assert.deepEqual(step(claims({ agent_status: status }, { agent_status: status })), { step: 3, remaining: 2 }, `${status}: any status means the agent has read the claim`);
  }
  assert.deepEqual(fresh(claims()), { step: 3, remaining: 2 });
  assert.deepEqual(step(claims()), { step: 3, remaining: 2 });
  assert.deepEqual(step(claims({ review_status: 'To review' }, {})), { step: 3, remaining: 2 });
  assert.deepEqual(step(claims(done, {})), { step: 3, remaining: 1 }, 'one claim decided is still step 3, with one claim left');
  assert.deepEqual(step(claims({ ...done, agent_status: null }, {})), { step: 3, remaining: 1 }, 'a claim the editor decided before the agent read it is decided, not unread');
  assert.deepEqual(step(claims({ ...done, agent_status: 'Waits for you' }, done)), { step: 4 }, 'a decided claim keeps Waits for you until the next tag run: that is no reason to call it open');
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
  // the ledger is not what step 2 and 3 are read from: the claims are, through Agent status (the notes of the first build are not read any more)
  const notesOnly = { agent_status: null, agent_notes: 'no tags\n1 waits for an editor · edition e' };
  assert.deepEqual(dp.stepOf({ claims: [claim('a', notesOnly), claim('b', unread), claim('c', { review_status: 'Reviewed' })], ledger: [], lessons: [], open, settings: { last_run_summary: 'Tag · 15 Oct 10:42 · 7 claims' } }), { step: 2 }, 'notes are no sign that the agent has read a claim');
  assert.deepEqual(dp.stepOf({ claims: claims(unread, unread), ledger: [{ Key: 'a::T', 'Agent proposal': 'Applies' }], lessons: [], open, settings: { last_run_summary: 'Tag · 15 Oct 10:42 · 7 claims' } }), { step: 2 });
  assert.ok(dp.stepOf({ claims: [], lessons: [], open }).problem, 'a claim that is not in Claims is a problem, not a step');
  assert.match(dp.stepOf({ claims: [claim('a')], lessons: [], open }).problem, /not in Claims \(b\)/);
  assert.ok(dp.stepOf({ claims: claims(), lessons: [], open: [] }).problem, 'no claims that wait is a problem too');
});

test('stepOf with four open claims and a Live rule change that rests on two of them (decision 76): step 7 is read from the Follow-up of those rows, and the other two keep waiting', () => {
  const { manifest } = real();
  const open = dp.openClaims(manifest);
  assert.deepEqual(open.map((o) => o.claim), ['presspool', 'aiforce', 'usps', 'georgia']);
  const [press, force, usps, georgia] = open;
  const claim = (o, over = {}) => ({ geo_id: o.geo_id, review_status: 'Reviewed', agent_status: 'Waits for you', ...over });
  const claims = (over = {}) => [claim(press), claim(force), claim(usps), claim(georgia), ...Object.entries(over).map(([geo_id, o]) => ({ geo_id, ...o }))];
  const settings = { last_run_summary: 'Tag · 15 Oct 10:42 · 9 claims' };
  const live = { Lesson: 'L', Status: 'Live', 'Safety check result': 'PASS', created: '2026-10-15T10:00:00Z', supporting_keys: [press.key, force.key] };
  const step = (ledger, lesson = live, cl = claims()) => dp.stepOf({ claims: cl, ledger, lessons: [lesson], open, settings });
  const follow = (...pairs) => pairs.map(([o, value]) => ({ Key: o.key, 'Follow-up': value }));
  // the two rows the change rests on are Fixed: complete, while USPS and Georgia still read Waits for you and have no Follow-up at all
  assert.equal(step(follow([press, 'Fixed'], [force, 'Fixed'])).step, 'complete');
  assert.equal(step(follow([press, 'Fixed'], [force, 'Fixed'], [usps, null], [georgia, null])).step, 'complete', 'the other two rows have nothing to say about step 7');
  // one of them has no Follow-up yet: the run stopped before it re-checked them
  const stopped = step(follow([press, 'Fixed']));
  assert.deepEqual([stopped.step, stopped.branch], [7, 'stopped']);
  // one of them is Still wrong: the editor reads it
  const read = step(follow([press, 'Fixed'], [force, 'Still wrong']));
  assert.deepEqual([read.step, read.branch], [7, 'read']);
  // a row that is not among the supporting rows is never read: a Still wrong on USPS does not move step 7
  assert.equal(step(follow([press, 'Fixed'], [force, 'Fixed'], [usps, 'Still wrong'])).step, 'complete');
  // the Supporting rows are read from the lesson as pulled (a list of keys); a lesson that names none of the open claims is read from all of them, as before
  assert.equal(step(follow([press, 'Fixed'], [force, 'Fixed']), { ...live, supporting_keys: ['no-such-claim::T'] }).branch, 'stopped');
  assert.equal(step(follow([press, 'Fixed'], [force, 'Fixed'], [usps, 'Fixed'], [georgia, 'Fixed']), { ...live, supporting_keys: [] }).step, 'complete');
  // step 3 counts all four open claims: three decided, one left
  const three = dp.stepOf({ claims: [claim(press), claim(force), claim(usps), claim(georgia, { review_status: 'To review' })], ledger: [], lessons: [], open, settings });
  assert.deepEqual(three, { step: 3, remaining: 1 });
  const none = dp.stepOf({ claims: [press, force, usps, georgia].map((o) => claim(o, { review_status: 'To review' })), ledger: [], lessons: [], open, settings });
  assert.deepEqual(none, { step: 3, remaining: 4 });
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
  // the Claims table: Geo Name, the agent's eight columns, the editor's three, then the other twelve Geo columns; Agent tags, Tags waiting and Verified tags are relations to
  // the Rulebook, and the "(old)" columns of the earlier builds (Agent tags, Agent notes, Why wrong) are in the structure as retired (a rename makes them on the live table, a new table never does)
  const claims = practice.tables.claims_copy.columns;
  const live = claims.filter((c) => !c.retired);
  assert.deepEqual(live.map((c) => c.name), [...REVIEW_ORDER, ...CLAIMS_COPY_COLUMNS.slice(1)]);
  assert.deepEqual(claims.filter((c) => c.retired).map((c) => c.name).sort(), [...RETIRED_COLUMNS].sort());
  assert.ok(!live.some((c) => c.name === 'Why wrong'), 'the editor has no Why wrong on the Claims any more');
  assert.equal(claims.find((c) => c.name === 'Agent reading').type, 'rich_text', 'the agent\'s reading of the decisions, one line per read tag');
  assert.equal(claims.findIndex((c) => c.name === 'Agent reading'), claims.findIndex((c) => c.name === 'Agent remarks') + 1, 'right after Agent remarks');
  // the ledger holds the reading of each disagreement: Agent reading (the three values), Rule, Reading note and Read under
  const ledgerColumns = practice.tables.tag_decisions.columns;
  assert.deepEqual(READING_COLUMNS.map((n) => ledgerColumns.find((c) => c.name === n)?.type), ['select', 'rich_text', 'rich_text', 'rich_text']);
  assert.deepEqual(ledgerColumns.find((c) => c.name === 'Agent reading').options, ['Agent slip', 'Rule unclear', 'Rule should change']);
  for (const name of RELATIONS) {
    const column = claims.find((c) => c.name === name);
    assert.deepEqual([column.type, column.relation_to], ['relation', 'rulebook'], name);
  }
  assert.deepEqual(claims.find((c) => c.name === 'Agent status').options, ['Waits for you', 'Done', 'Disagrees with your decision', 'Could not read']);
  assert.equal(claims.find((c) => c.name === 'Agent confidence').type, 'number');
  // a practice page makes only the live columns: the retired ones are never a column to write
  assert.deepEqual(dp.writableColumns(practice, 'claims_copy'), live.map((c) => c.name));
  assert.ok(!dp.writableColumns(practice, 'claims_copy').some((n) => RETIRED_COLUMNS.includes(n)));
  assert.ok(practice.tables.claims_copy.arrange_default_view === true, 'the table\'s own view is arranged');
  const verified = claims.find((c) => c.name === dp.CLAIM_COLUMNS.verified);
  assert.deepEqual([verified.type, verified.relation_to], ['relation', 'rulebook']);
  assert.deepEqual(claims.find((c) => c.name === 'Review status').options, ['To review', 'Reviewed']);
  // the names of the editor's columns are the production config's own, and the config lists them as the editor's: three, and Agent reading is the agent's
  const entry = loadConfig(codeRoot()).notion.claims[0];
  assert.deepEqual(dp.CLAIM_COLUMNS, { verified: entry.columns.verified, review_status: entry.columns.review_status, notes: entry.columns.notes });
  assert.deepEqual(editorColumns(loadConfig(codeRoot()), 'claims_copy'), Object.values(dp.CLAIM_COLUMNS));
  assert.equal(entry.write_columns.reading, dp.AGENT_READING_COLUMN);
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

test('the manifest describes the claims\' columns: five Reviewed claims with the audit\'s words, four To review with what the editor types and what the agent should read, and a shape that is checked', () => {
  const { manifest } = real();
  const V = dp.CLAIM_COLUMNS.verified;
  const N = dp.CLAIM_COLUMNS.notes;
  assert.equal(manifest.manifest_version, '2026-10-22.1');
  assert.equal(manifest.calibration.status, 'pending');
  assert.ok(manifest.calibration.runs.length >= 5, 'the earlier calibration runs are kept');
  assert.deepEqual(manifest.calibration.runs.map((r) => r.run), [1, 2, 3, 4, 5], 'runs 6 to 8 calibrate this version');
  assert.match(manifest.calibration.note, /Runs 6 to 8 calibrate this version/);
  assert.deepEqual(manifest.claims.map((c) => c.key), ['presspool', 'aiforce', 'usps', 'georgia', 'cnn', 'dallas', 'contractor', 'kennedy', 'stopgap']);
  assert.equal(manifest.claims.length, 9);
  for (const c of manifest.claims) assert.deepEqual(Object.keys(c), ['key', 'short', 'Geo Name', 'Geo ID', 'Geo URL', 'Geo Sources', 'source_pieces', 'Geo Tags', 'Geo Topics', 'Geo Score', 'Geo Supporting arguments', 'Geo Opposing arguments', 'Geo Related people', 'Geo Related projects', 'Geo Is factual', 'Geo Name source'], c.key);
  assert.deepEqual(manifest.decided.map((d) => d.claim), ['cnn', 'dallas', 'contractor', 'kennedy', 'stopgap']);
  for (const d of manifest.decided) {
    assert.equal(d['Review status'], 'Reviewed', d.claim);
    assert.ok(!('Why wrong' in d), `${d.claim}: the editor says no reason; the agent reads it`);
    assert.ok(d[N].startsWith(AUDIT_PREFIX), d.claim);
    assert.ok(['Applies', 'Does not apply'].includes(d['Agent proposal']), d.claim);
    assert.deepEqual(d[V], ['cnn', 'dallas'].includes(d.claim) ? [TAG] : [], d.claim);
    assert.ok(!('Tag outcome' in d) && !('Your reasoning' in d), 'the ledger columns are worked out from the claim, not stored');
    // every note is a sentence that ends with a full stop; where the audit recorded no reasoning the note says which way the editor went against the agent's answer,
    // and never "the editor agreed", which would read like a contradiction beside an agent that slipped
    const note = d[N];
    assert.ok(note.endsWith('.'), `${d.claim}: the note ends with a full stop`);
    assert.ok(!/editor agreed/.test(note), d.claim);
    if (/no reasoning was recorded/.test(note)) {
      const confirmed = d[V].length > 0; // the tag is among the verified tags
      assert.equal(note, `${AUDIT_PREFIX}: the editor ${confirmed ? 'confirmed this tag, which the agent had read the other way' : 'did not confirm this tag, which the agent had applied'}; no reasoning was recorded.`, d.claim);
      assert.equal(d['Agent proposal'], confirmed ? 'Does not apply' : 'Applies', `${d.claim}: the note says what the agent had answered`);
    }
  }
  assert.deepEqual(manifest.decided.filter((d) => /no reasoning was recorded/.test(d[N])).map((d) => d.claim), ['cnn', 'dallas', 'kennedy'], 'the three decisions the audit gave no words for');
  // the four claims of the editor: the columns in the order the editor types them, Review status last, and no Why wrong anywhere
  assert.deepEqual(manifest.open.map((o) => o.claim), ['presspool', 'aiforce', 'usps', 'georgia']);
  for (const o of manifest.open) {
    assert.equal(o['Review status'], 'To review', o.claim);
    assert.deepEqual(Object.keys(o.enter), [V, N, 'Review status'], `${o.claim}: the columns in the order the editor types them, Review status last`);
    assert.equal(o.enter['Review status'], 'Reviewed');
    assert.ok(!('Why wrong' in o.enter) && !('Why wrong' in o), o.claim);
    assert.ok(o.calibrate && o.expect_reading, `${o.claim}: what the agent should say at step 2 and what the reading should make of the decision`);
  }
  assert.ok(!JSON.stringify(manifest).includes('Why wrong'), 'no Why wrong anywhere in the manifest');
  const [press, force, usps, georgia] = manifest.open;
  assert.deepEqual(press.enter[V], [], 'the press pool: the tag does not apply, so nothing is verified');
  assert.deepEqual(force.enter[V], [TAG], 'the AI Force: the tag applies');
  assert.deepEqual([usps.enter[V], usps.enter[N]], [[], 'Agent slip. USPS names which portal, so rule 5 already settles it.'], 'USPS: Does not apply, and the note opens with the reason word');
  assert.deepEqual([georgia.enter[V], georgia.enter[N], georgia.agrees], [[], '', true], 'Georgia: the editor agrees with the agent, an empty note is the decision');
  assert.deepEqual([press.agrees, force.agrees, usps.agrees], [undefined, undefined, undefined]);
  // what the agent should say at step 2, per claim (calibration), and what the reading should make of the decision at step 4
  assert.deepEqual(press.calibrate, { agent: 'apply', min_share: 0.67, min_p: 0.75, cites_rule: 3 });
  assert.deepEqual(force.calibrate, { agent: ['ask_editor', 'apply'], min_share: 0.67, max_p: 0.7, cites_rule: 3 });
  assert.deepEqual(usps.calibrate, { agent: 'apply', min_share: 0.67, min_p: 0.75 });
  assert.deepEqual(georgia.calibrate, { agent: 'do_not_apply', min_share: 1, max_p: 0.25 });
  const rule = { source: 'model', reading: ['Rule unclear', 'Rule should change'], rule: 3 };
  assert.deepEqual(press.expect_reading, rule, 'a rule problem on rule 3; either reading is accepted, and the draft is the same');
  assert.deepEqual(force.expect_reading, rule);
  assert.deepEqual(usps.expect_reading, { source: 'verbatim', reading: ['Agent slip'], rule: 5 });
  assert.deepEqual(georgia.expect_reading, { source: 'none', reading: null, rule: null });
  // the shape the Claims table has after the build: the filters of the three views, the order of the columns, and what step 4 does
  assert.deepEqual(manifest.expect.claims_views, ['Your queue', 'Needs your note', 'Agent disagreed']);
  assert.deepEqual(manifest.expect.claims_view_filters, {
    'Your queue': 'Agent status is Waits for you', 'Needs your note': 'Agent reading contains without your note', 'Agent disagreed': 'Agent status is Disagrees with your decision',
  });
  assert.deepEqual(manifest.expect.claims_columns, REVIEW_ORDER);
  assert.deepEqual([manifest.expect.claims, manifest.expect.reviewed_claims, manifest.expect.open_claims, manifest.expect.ledger_rows], [9, 5, 4, 5]);
  assert.deepEqual(manifest.expect.readings, { read: 3, model_calls: 1, verbatim: 1, agree: 1 });
  // the counts of the readings are what the claims say: one claim read by the model per rule problem, one verbatim, one agreeing
  const by = (source) => manifest.open.filter((o) => o.expect_reading.source === source).length;
  assert.deepEqual([by('model') + by('verbatim'), by('model') > 0 ? 1 : 0, by('verbatim'), by('none')], [3, 1, 1, 1]);
  assert.equal(manifest.expect.lesson_rule, 'Context-dependent rule 3');
  assert.equal(manifest.expect.gate, 'PASS');
  assert.deepEqual(manifest.steps.map((s) => s.title).slice(2, 4), ['Decide your four claims', 'The agent reads your decisions and drafts a clearer rule 3']);
  assert.deepEqual(manifest.steps.map((s) => s.affects), [[], ['Claims'], ['Claims'], ['Claims', 'Rule changes'], ['Rule changes'], ['Rulebook', 'Rule changes', 'Agent settings'], ['Claims']], 'no step affects Tag decisions');
  // the alternates: the USPS and Georgia claims are in the story now; the Fairford claims, Melania and the COVID-19 note stay
  assert.deepEqual(manifest.alternates.map((a) => a.key), ['fairford-credibility', 'fairford-effectiveness', 'melania', 'covid']);
  assert.ok(!manifest.alternates.some((a) => ['27ad00b59c1f7d4aee71643fc8cdec94', '8f9c833b41e54eee9ca78e9c2f4ffb58'].includes(a.geo_id)));

  // the claims of the dry run of 15 October, whole: the entries of the USPS ballot portal and Georgia match the row that file holds, by the fields the other entries have
  const usp = manifest.claims.find((c) => c.key === 'usps');
  const geo = manifest.claims.find((c) => c.key === 'georgia');
  assert.deepEqual([usp['Geo ID'], usp['Geo Name']], ['27ad00b59c1f7d4aee71643fc8cdec94', 'The USPS ballot portal should not launch before the 2026 midterms']);
  assert.deepEqual([geo['Geo ID'], geo['Geo Name']], ['8f9c833b41e54eee9ca78e9c2f4ffb58', "Georgia's gubernatorial debate should be moderated by professional journalists rather than a town hall audience"]);
  assert.equal(geo.source_pieces.length, 1);
  assert.equal(geo.source_pieces[0].href, 'https://www.geobrowser.io/space/4582fbbee28a16589154f7e36f1ee3c5/409d76d8f23f4fb1927c67af42d371e5');
  for (const c of [usp, geo]) {
    assert.ok(c.short.endsWith('…') && c['Geo Name'].startsWith(c.short.slice(0, -1)), `${c.key}: the short form is the start of the claim`);
    assert.ok([...c.short].length <= 60, c.key);
  }

  // the shape is checked when the manifest is read
  const broken = (change) => {
    const m = structuredClone(manifest);
    change(m);
    const file = join(tmp('bad-shape'), 'manifest.json');
    writeFileSync(file, JSON.stringify(m));
    return () => dp.loadManifest(file);
  };
  assert.throws(broken((m) => { m.decided[0]['Review status'] = 'To review'; }), /decided\[0\] \(cnn\): Review status must be Reviewed/);
  assert.throws(broken((m) => { m.decided[0][V] = ['Wordy']; }), /decided\[0\] \(cnn\): Verified tags must be a list of tag names; the page has one tag, Context-dependent/);
  assert.throws(broken((m) => { m.decided[0][V] = TAG; }), /must be a list of tag names/);
  assert.throws(broken((m) => { m.decided[2][N] = ' '; }), /decided\[2\] \(contractor\): Challenged tags notes is missing/);
  assert.throws(broken((m) => { m.decided[3]['Agent proposal'] = 'Maybe'; }), /decided\[3\] \(kennedy\): Agent proposal must be one of/);
  assert.throws(broken((m) => { m.open[0]['Review status'] = 'Reviewed'; }), /open\[0\] \(presspool\): Review status is To review when the page is made/);
  assert.throws(broken((m) => { m.open[1].enter[V] = ['Wordy']; }), /open\[1\] \(aiforce\)\.enter: Verified tags must be a list of tag names/);
  assert.throws(broken((m) => { m.open[1].enter['Review status'] = 'To review'; }), /enter: Review status must be Reviewed/);
  assert.throws(broken((m) => { delete m.open[0].enter[N]; }), /open\[0\] \(presspool\)\.enter: Challenged tags notes is missing/);
  assert.throws(broken((m) => { m.open[0].enter[N] = ''; }), /open\[0\] \(presspool\)\.enter: Challenged tags notes is missing/, 'an empty note is for a claim where the editor agrees');
  assert.throws(broken((m) => { m.open[3].agrees = 'yes'; }), /open\[3\] \(georgia\): agrees must be true or false/);
  assert.throws(broken((m) => { delete m.open[3].agrees; }), /open\[3\] \(georgia\)\.enter: Challenged tags notes is missing/, 'Georgia has an empty note, which only agrees: true allows');
  assert.throws(broken((m) => { m.open[3].expect_reading.source = 'model'; }), /open\[3\] \(georgia\): expect_reading says there is nothing to read exactly when the editor agrees/);
  assert.throws(broken((m) => { m.open[0].expect_reading.reading = ['Because']; }), /open\[0\] \(presspool\)\.expect_reading: reading must be null or a list of Agent slip, Rule unclear, Rule should change/);
  assert.throws(broken((m) => { m.open[0].expect_reading.source = 'guess'; }), /open\[0\] \(presspool\)\.expect_reading: source must be one of model, verbatim, none/);
  assert.throws(broken((m) => { m.open[2].expect_reading.rule = 'five'; }), /open\[2\] \(usps\)\.expect_reading: rule must be a rule number or null/);
  // a manifest of the older shape (Why wrong in the editor's work) is refused, and says so
  assert.throws(broken((m) => { m.decided[1]['Why wrong'] = 'Agent slip'; }), /decided\[1\] \(dallas\): Why wrong is not a column of the editor any more; this manifest has an older shape/);
  assert.throws(broken((m) => { m.open[0].enter['Why wrong'] = 'Rule unclear'; }), /open\[0\] \(presspool\)\.enter: Why wrong is not a column of the editor any more; this manifest has an older shape/);
  assert.throws(broken((m) => { m.open[1].enter['Agent tags'] = TAG; }), /open\[1\] \(aiforce\)\.enter: "Agent tags" is not one of the editor's columns/);
  assert.doesNotThrow(broken(() => {}));
});

test('the rows of the page come from the manifest: a decided claim is created Reviewed with its Agent reading, an open one To review and nothing else, and the ledger has a row for each decided claim only, already read', () => {
  const { manifest } = real();
  const V = dp.CLAIM_COLUMNS.verified;
  const pages = { [TAG]: '0a9e0000-0000-4000-8000-0000000000aa' };
  const links = Object.fromEntries(manifest.claims.map((c) => [c['Geo ID'], `https://www.notion.so/${c['Geo ID']}`]));
  const decided = new Map(manifest.decided.map((d) => [d.claim, d]));
  const config = dp.buildDemoConfig(withRealIds(structuredClone(loadConfig(codeRoot()))), { demoId: '20261015-1422-r1', title: 'x', parentId: '0123456789abcdef0123456789abcdef', tag: TAG });
  const rubric = dp.practiceRubric(manifest, config, { edition: EDITION, now: NOW });
  // the editor's columns of a claim, as the cells of its create, and the agent's own: the seeded Agent reading of a decided claim, nothing on an open one
  for (const c of manifest.claims) {
    const cells = dp.claimEditorCells(manifest, c, pages);
    const d = decided.get(c.key);
    if (!d) {
      assert.deepEqual(cells, { 'Review status': 'To review' }, `${c.key}: an open claim starts To review, with the other two columns empty`);
      assert.deepEqual(dp.claimAgentCells(manifest, c, { rubric }), {}, `${c.key}: Agent reading is empty until distill reads the decision`);
      continue;
    }
    assert.equal(cells['Review status'], 'Reviewed', c.key);
    assert.ok(!('Why wrong' in cells), c.key);
    assert.equal(cells['Challenged tags notes'], d['Challenged tags notes'], c.key);
    if (d[V].length) assert.deepEqual(cells[V], [pages[TAG]], `${c.key}: the relation holds the page id of the tag's row`);
    else assert.ok(!(V in cells), `${c.key}: no tag verified, so the relation is left empty`);
    assert.deepEqual(dp.claimAgentCells(manifest, c, { rubric }), { 'Agent reading': SEEDED_LINE }, `${c.key}: the claim is created with the agent's seeded reading`);
    assert.deepEqual(dp.claimAgentCells(manifest, c, { rubric, column: 'Reading' }), { Reading: SEEDED_LINE });
  }
  assert.throws(() => dp.claimEditorCells(manifest, manifest.claims.find((c) => c.key === 'cnn'), {}), /names the tag Context-dependent .* which has no row in the Rulebook/);
  // the ledger: one row for each decided claim, as the tag step copies a decision, already read as Agent slip where the outcome differs from the proposal (all five do)
  const ops = dp.ledgerOps(manifest, links, { rubric });
  assert.equal(ops.length, manifest.decided.length);
  assert.deepEqual(ops.map((o) => o.key), manifest.claims.filter((c) => decided.has(c.key)).map((c) => `${c['Geo ID']}::${TAG}`));
  for (const op of ops) {
    const c = manifest.claims.find((x) => x['Geo ID'] === op.key.split('::')[0]);
    const d = decided.get(c.key);
    const outcome = d[V].length ? 'Applies' : 'Does not apply';
    assert.notEqual(outcome, d['Agent proposal'], `${c.key}: the decision differs from the agent's answer`);
    assert.match(op.properties['Read under'], new RegExp(`^${EDITION.replace('.', '\\.')} · [0-9a-f]{8}$`), c.key);
    assert.deepEqual(op.properties, {
      Claim: c['Geo Name'], Key: op.key, Tag: TAG, 'Claim link': links[c['Geo ID']], 'Agent proposal': d['Agent proposal'],
      'Tag outcome': outcome, 'Your reasoning': d['Challenged tags notes'], 'Rulebook edition': EDITION,
      'Agent reading': 'Agent slip', 'Reading note': SEEDED, 'Read under': op.properties['Read under'],
    }, c.key);
    const copy = dp.ledgerCopy(manifest, c, { rubric });
    assert.deepEqual(copy, {
      'Agent proposal': d['Agent proposal'], 'Tag outcome': outcome, 'Why wrong': null, 'Your reasoning': d['Challenged tags notes'], 'Rulebook edition': EDITION,
      'Agent reading': 'Agent slip', Rule: null, 'Reading note': SEEDED, 'Read under': op.properties['Read under'],
    });
    assert.deepEqual(dp.ledgerCopy(manifest, c), { 'Agent proposal': d['Agent proposal'], 'Tag outcome': outcome, 'Why wrong': null, 'Your reasoning': d['Challenged tags notes'] }, 'without a rulebook file the copy is the decision alone');
  }
  assert.equal(dp.ledgerCopy(manifest, manifest.claims.find((c) => c.key === 'presspool'), { rubric }), null, 'an open claim has no copy');
  assert.ok(ops.every((o) => !('Decided under' in o.properties) && !('Follow-up' in o.properties) && !('Agent confidence' in o.properties) && !('Agent reason' in o.properties) && !('Why wrong' in o.properties)));
  assert.ok(ops.every((o) => o.properties['Rulebook edition'] === EDITION), 'every seeded row says the edition its proposal is made under: the edition of the page, which the key of the reading holds');
  assert.equal(dp.ledgerOps(manifest, {}, { rubric }).every((o) => !('Claim link' in o.properties)), true, 'a claim with no link yet gets no link');
  // the hash is the one distill computes: the rows are current at the first distill (the classification of lib/readings.mjs), so no call is made for them
  const ruleOne = rubric.tags[0];
  assert.equal(ruleOne.name, TAG);
  assert.equal(ops[0].properties['Read under'].split(' · ')[0], rubric.edition);
  const hashOf = (key) => ops.find((o) => o.key.startsWith(manifest.claims.find((c) => c.key === key)['Geo ID'])).properties['Read under'].split(' · ')[1];
  assert.equal(hashOf('cnn'), hashOf('dallas'), 'the same decision against the same answer, with the same words, is the same reading');
  assert.equal(new Set(['cnn', 'contractor', 'kennedy', 'stopgap'].map(hashOf)).size, 4, 'and every other decision has a hash of its own: the notes and the outcomes differ');
  // a decided claim where the agent was right would be created without reading columns, and its claim would say that nothing is to be read
  const agreeing = structuredClone(manifest);
  agreeing.decided[0]['Agent proposal'] = 'Applies'; // cnn: Applies, as the editor decided
  const cnn = agreeing.claims.find((c) => c.key === 'cnn');
  assert.deepEqual(dp.ledgerCopy(agreeing, cnn, { rubric }), { 'Agent proposal': 'Applies', 'Tag outcome': 'Applies', 'Why wrong': null, 'Your reasoning': null, 'Rulebook edition': EDITION });
  assert.deepEqual(dp.claimAgentCells(agreeing, cnn, { rubric }), { 'Agent reading': 'Nothing to read: the agent agreed with you.' });
  assert.ok(!READING_COLUMNS.some((column) => column in dp.ledgerOps(agreeing, links, { rubric })[0].properties), 'no reading column on a row that agrees');
  // the keys: the ledger key of every claim, and of the four that wait
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
  assert.deepEqual(Object.keys(relation.body.properties), RELATIONS, 'the three relations of the Claims, one request');
  for (const name of RELATIONS) {
    assert.equal(relation.body.properties[name].type, 'relation', name);
    assert.equal(relation.body.properties[name].relation.data_source_id, '<Rulebook>', name);
  }
  assert.ok(plan.requests.indexOf(relation) > plan.requests.findLastIndex((q) => q.path === '/databases'), 'after the last table');
  const created = plan.requests.filter((q) => q.path === '/databases').map((q) => Object.keys(q.body.initial_data_source.properties));
  assert.ok(created.every((names) => RELATIONS.every((name) => !names.includes(name))), 'a relation is not part of a table create');
  assert.ok(created.every((names) => RETIRED_COLUMNS.every((name) => !names.includes(name))), 'a retired column is never made');
  assert.deepEqual([...created[1]].sort(), [...REVIEW_ORDER.filter((n) => !RELATIONS.includes(n)), ...CLAIMS_COPY_COLUMNS.slice(1)].sort(), 'the Claims is made with its other columns');
  assert.deepEqual(plan.requests.filter((q) => q.path === '/views').map((q) => q.body.name), ['Rulebook', 'Needs your note', 'Agent disagreed', 'Your queue', 'Lessons waiting']);
  assert.deepEqual(Object.keys(plan.rows), ['rulebook', 'claims_copy', 'tag_decisions', 'agent_settings']);
  assert.deepEqual(Object.values(plan.rows).map((list) => list.length), [1, 9, 5, 1], 'the ledger has a row for each decided claim and none for the four that wait');
  assert.equal(plan.plan.counts.rows, 16);
  assert.deepEqual(plan.rows.claims_copy.find((o) => o.properties['Geo ID'] === manifest.claims.find((c) => c.key === 'cnn')['Geo ID']).properties[dp.CLAIM_COLUMNS.verified], [`<the row of ${TAG} in Rulebook>`], 'the plan holds a placeholder where the page id goes');
  // the plan holds the seeded readings: the Agent reading of each claim decided earlier (none on the four open claims) and the five ledger rows already read
  const openKeys = new Set(manifest.open.map((o) => o.claim));
  for (const c of manifest.claims) {
    const op = plan.rows.claims_copy.find((o) => o.properties['Geo ID'] === c['Geo ID']);
    assert.equal(op.properties['Agent reading'], openKeys.has(c.key) ? undefined : SEEDED_LINE, c.key);
  }
  assert.ok(plan.rows.tag_decisions.every((o) => o.properties['Agent reading'] === 'Agent slip' && o.properties['Reading note'] === SEEDED && /^\S+ · [0-9a-f]{8}$/.test(o.properties['Read under'])));
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

/**
 * The numbered lists of Step 3's Doing the work, one per claim: [{ title, items: [{ n, column, text, sentence }] }], read from the Markdown of the page. A list line that ends
 * with a backslash is followed by the sentence to paste, on a line of its own under it.
 */
function step3Lists(page) {
  const step3 = page.slice(page.indexOf('## Step 3'), page.indexOf('## Step 4')).split('\n');
  const lists = [];
  let current = null;
  for (let i = 0; i < step3.length; i += 1) {
    const title = /^\*\*(The .+ claim)\*\*$/.exec(step3[i]);
    if (title) {
      current = { title: title[1], items: [] };
      lists.push(current);
      continue;
    }
    const item = /^(\d+)\. ([^:]+): (.*)$/.exec(step3[i]);
    if (!item || !current) continue;
    let text = item[3];
    let sentence = null;
    if (text.endsWith('\\')) {
      text = text.slice(0, -1);
      sentence = step3[i + 1].trim();
      i += 1;
    }
    current.items.push({ n: Number(item[1]), column: item[2], text, sentence });
  }
  return lists;
}

test('the page text and the manifest agree: the lint is clean with the manifest\'s steps, the step 3 lists are the manifest\'s `enter` values word for word and in the order they are typed, and the page never explains the ledger beyond its one line', () => {
  const { manifest, template } = real();
  const model = dp.pageModel(template.text, { edition: EDITION, date: dp.dateWord(NOW) });
  const preview = dp.annotatedPreview(model.rendered, {});
  const page = model.rendered; // the text, without the comments the preview adds under the markers
  assert.deepEqual(lintPage(preview, { manifest }).problems, []);
  assert.deepEqual(lintPage(dp.annotatedPreview(model.rendered, { fallbackKeys: ['your_queue', 'lessons_waiting'] }), { manifest }).problems, []);
  // nothing of the old story is left: not two claims for the editor, not the column that said why the agent was wrong
  assert.equal(page.match(/two claims|your 2|Why wrong/g), null, 'no "two claims", "your 2" or "Why wrong" anywhere on the page');
  // the editor's words in step 3 are the manifest's `enter` text word for word: one numbered list per claim, one column per line, the sentence to paste on a line of its own,
  // in the order the editor types the columns (Review status last, because it closes the claim)
  const step3 = page.slice(page.indexOf('## Step 3'), page.indexOf('## Step 4'));
  const V = dp.CLAIM_COLUMNS.verified;
  const N = dp.CLAIM_COLUMNS.notes;
  const lists = step3Lists(page);
  const titles = { aiforce: 'The AI Force claim', presspool: 'The press pool claim', usps: 'The USPS ballot portal claim', georgia: 'The Georgia debate claim' };
  assert.deepEqual(lists.map((l) => l.title), ['aiforce', 'presspool', 'usps', 'georgia'].map((k) => titles[k]), 'one list per claim, in the order of Your queue: the AI Force claim first, as the agent is least sure of it');
  assert.deepEqual(Object.keys(manifest.open[0].enter), [V, N, 'Review status'], 'the manifest lists the columns in the order they are typed');
  for (const o of manifest.open) {
    const list = lists.find((l) => l.title === titles[o.claim]);
    assert.ok(list, o.claim);
    assert.deepEqual(list.items.map((i) => i.n), [1, 2, 3], `${o.claim}: numbered 1 to 3`);
    assert.deepEqual(list.items.map((i) => i.column), Object.keys(o.enter), `${o.claim}: one column per line, in the order of the manifest's enter`);
    const by = Object.fromEntries(list.items.map((i) => [i.column, i]));
    if (o.enter[V].length) assert.equal(by[V].text, `${o.enter[V].join(', ')}.`, `${o.claim}: the tags to verify`);
    else assert.match(by[V].text, /^leave it empty, because the tag does not apply\.$/, `${o.claim}: the tag does not apply, so nothing is verified`);
    assert.equal(by['Review status'].text, `${o.enter['Review status']}.`, `${o.claim}: Review status`);
    if (o.enter[N] === '') {
      // an empty note is a decision too: the editor agrees with the agent, and the checklist says so in words
      assert.equal(o.agrees, true, `${o.claim}: an empty note is for the claim the editor agrees on`);
      assert.equal(by[N].sentence, null, `${o.claim}: nothing to paste`);
      assert.equal(by[N].text, 'leave it empty. An empty note is a decision too: you agree with the agent.', `${o.claim}: the empty note is said in words`);
    } else {
      assert.equal(by[N].sentence, `"${o.enter[N]}"`, `${o.claim}: the sentence to paste is the manifest's, word for word, on a line of its own`);
      assert.equal(by[N].text, 'paste the words between the quotes:', `${o.claim}: the editor pastes the words, not the quotes`);
      assert.ok(step3.includes(`\n   "${o.enter[N]}"\n`), `${o.claim}: the sentence has its own line`);
    }
    assert.equal(list.items.filter((i) => i.sentence !== null).length, o.enter[N] === '' ? 0 : 1, `${o.claim}: only the notes carry a sentence`);
  }
  assert.ok(!step3.includes('Claim quality tags'), 'the column is called Verified tags');
  assert.match(step3, /Fill in three columns on each of your four claims, in the order of its list, in Your queue under the lists\./);
  assert.match(step3, /Review status comes last only because it closes the claim: a claim you have decided stays in Your queue until the agent reads it again/);
  assert.match(step3, /stands on its own line between quotes: paste the words between the quotes, not the quotes\./);
  assert.ok(!/as it is/.test(step3), 'the page no longer says to paste the sentence as it is');
  assert.match(step3, /so the order of the three columns does not matter for the view/);
  // one sentence under the lists on the reason word, and the view right under it (the editor never says why the agent was wrong, but may)
  const reason = 'A note that starts with "Agent slip.", "Rule unclear." or "Rule should change." is taken as it stands and the agent does not read that tag; without one the agent reads your decision itself.';
  assert.ok(step3.indexOf(reason) > step3.lastIndexOf('3. Review status: Reviewed.'), 'the sentence on the reason word stands under the four lists');
  assert.match(step3, new RegExp(`${reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\n\\{\\{view:Your queue\\}\\}`));
  // the list is blocks as well: four numbered lists of three items, the notes item holding a line break before its sentence (but Georgia's)
  const blocks = toBlocks(step3).filter((b) => b.type === 'numbered_list_item');
  assert.equal(blocks.length, 12);
  const notesItems = blocks.filter((b) => blockText(b).startsWith('Challenged tags notes'));
  assert.deepEqual(notesItems.map((b) => blockText(b).split('\n').length), [2, 2, 2, 1]);
  assert.deepEqual(notesItems.slice(0, 3).map((b) => blockText(b).split('\n')[1]), ['aiforce', 'presspool', 'usps'].map((k) => `"${manifest.open.find((o) => o.claim === k).enter[N]}"`));
  // Tag decisions: one line in The tables, nothing in the steps, and no step asks for a caption for it
  const mentions = page.split('\n').map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => /Tag decisions/.test(line));
  assert.equal(mentions.length, 1, 'the ledger is named once');
  assert.equal(mentions[0].line, '- **Tag decisions**: the agent\'s own record of each decision; nothing to do here.');
  assert.ok(mentions[0].n > page.split('\n').findIndex((l) => l.startsWith('## The tables')));
  assert.ok(!manifest.steps.some((s) => s.affects.includes('Tag decisions')));
  // step 1: the status table's first lines are what status prints on a page nobody has read yet
  const step1 = page.slice(page.indexOf('## Step 1'), page.indexOf('## Step 2'));
  assert.match(step1, /\| Your queue \| nothing waits \|/);
  assert.match(step1, /Claims: 9 rows, Agent tags empty; 5 are Reviewed, decided earlier by an editor, and 4 are To review, for you\./);
  assert.ok(!/2 rows, lowest confidence first/.test(page));
  // step 2 shows the Claims table with the agent's columns, and no ledger table: Agent tags, Agent confidence and Agent status in one table, Tags waiting with Agent reasons in the other
  const step2 = page.slice(page.indexOf('## Step 2'), page.indexOf('## Step 3'));
  assert.match(step2, /\| Geo Name \| Agent tags \| Agent confidence \| Agent status \|/);
  assert.match(step2, /\| Geo Name \| Tags waiting \| Agent reading \| Agent reasons \|/);
  assert.ok(!/Agent proposal|Tag outcome|Tag decisions/.test(`${step1}${step2}${step3}`));
  assert.match(step2, /The figures differ from run to run/);
  assert.match(step2, /Agent reading is still empty because the agent reads a decision only after you have made it/);
  // step 3 shows the Claims table of the four decisions: the tag, the status and the start of the note (Georgia's is empty)
  assert.match(step3, /\| Geo Name \| Verified tags \| Review status \| Challenged tags notes \|/);
  assert.match(step3, /Challenged tags notes holds your sentence on three of the claims and nothing on the Georgia claim\./);
  // step 4 explains what a reading is, shows the four lines of Agent reading as the editor will see them, and the Rule changes table
  const step4 = page.slice(page.indexOf('## Step 4'), page.indexOf('## Step 5'));
  assert.match(step4, /Only the readings that blame the rule, Rule unclear and Rule should change, become a draft\./);
  assert.match(step4, /The agent may read the press pool or the AI Force claim as Rule should change instead of Rule unclear; the draft is the same either way\./);
  const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim());
  const readingRows = step4.split('\n').filter((l) => l.startsWith('|')).map(cells);
  const at = readingRows.findIndex((r) => r[0] === 'Geo Name' && r[1] === 'Agent reading');
  assert.ok(at >= 0, 'the Claims table of step 4 shows Geo Name and Agent reading');
  const readingLines = Object.fromEntries(readingRows.slice(at + 2, at + 6).map((r) => [manifest.claims.find((c) => c.short === r[0])?.key, r[1]]));
  assert.deepEqual(Object.keys(readingLines), ['presspool', 'aiforce', 'usps', 'georgia']);
  assert.match(readingLines.presspool, /^Context-dependent: Rule unclear, rule 3 · .+\.$/);
  assert.match(readingLines.aiforce, /^Context-dependent: Rule unclear, rule 3 · .+\.$/);
  assert.equal(readingLines.usps, 'Context-dependent: Agent slip, rule 5 · Your note says so.');
  assert.equal(readingLines.georgia, 'Nothing to read: the agent agreed with you.');
  for (const line of Object.values(readingLines)) assert.ok([...line].length <= 100, line);
  assert.ok(step4.indexOf('**Claims**') < step4.indexOf('**Rule changes**'), 'the Claims table comes first, then the Rule changes table');
  // step 7 shows Agent tags, Agent status and Agent edition, for the four claims, and says what happens to the two the rule change does not rest on
  const step7 = page.slice(page.indexOf('## Step 7'), page.indexOf('## The tables'));
  assert.match(step7, /\| Geo Name \| Agent tags \| Agent status \| Agent edition \|/);
  assert.match(step7, /The USPS and Georgia claims were not part of the change, so the follow-up leaves them as they were: they keep Waits for you and stay in Your queue until the next tag run reads them again\./);
  // step 6 says what the safety check reads and how it counts (earlier decisions: the five of the audit and the two that were not part of the change)
  const step6 = page.slice(page.indexOf('## Step 6'), page.indexOf('## Step 7'));
  assert.match(step6, /\| Known groups count as identified, unknown names do not \| Live \| PASS: examples 10\/10, earlier 6\/6, yours 2\/2 \|/);
  // Agent notes is nowhere on the page, and the real table's name for the verified tags is named once, in the words list
  assert.ok(!/Agent notes/.test(page), 'no Agent notes anywhere');
  assert.equal(page.match(/Claim quality tags — verified/g).length, 1);
  assert.match(page, /- \*\*Verified tags\*\*: .*Claim quality tags — verified/);
  // the Help toggle: the Agent reading table with its four values and one sentence on the reason word, the words list at ten lines (Agent status in it) and the Views entry
  const help = page.slice(page.indexOf('**Words used on this page.**'), page.indexOf('**If something stops.**'));
  assert.equal(help.split('\n').filter((l) => l.startsWith('- ')).length, 10);
  assert.match(help, /- \*\*Agent status\*\*: .*Waits for you, Done, Disagrees with your decision or Could not read/);
  assert.match(help, /\*\*Views\*\*: the Claims table has Your queue .* Needs your note \(the claims the agent read without a note from you\) and Agent disagreed/);
  const helpTop = page.slice(page.indexOf('## Help'), page.indexOf('**Words used on this page.**'));
  const table = helpTop.split('\n').filter((l) => l.startsWith('|')).map(cells);
  assert.deepEqual(table[0], ['Agent reading', 'What it makes happen']);
  assert.deepEqual(table.slice(2).map((r) => r[0]), ['Agent slip', 'Rule unclear', 'Rule should change', '(nothing to read)']);
  assert.match(helpTop, /If you already know the reason, start your note with "Agent slip\.", "Rule unclear\." or "Rule should change\.": the agent takes that as it stands and does not read that tag\./);
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
  assert.match(report, /^Walkthrough: your practice page is ready under Demos\.\n\n\| Table \| Now \|\n\|---\|---\|\n\| Rulebook \| 1 tag \|\n\| Claims \| 9: 5 reviewed earlier, 4 for you \|\n\| Rule changes \| empty \|\n\nNext: open Claim tagger practice · 15 Oct 14:22 \(https:\/\/www\.notion\.so\/[0-9a-f]{32}\) and follow step 1\.$/);

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
  assert.equal(pagePosts.length, 1 + 16, 'the page and sixteen rows');
  assert.deepEqual(pagePosts[0].parent, { type: 'page_id', page_id: w.parent.replace(/-/g, '') });
  assert.equal(pagePosts[0].properties.title.title[0].text.content, demo.title);
  assert.deepEqual(POST_BODIES(w.fake, '/databases').map((b) => b.title[0].text.content), Object.values(dp.PRACTICE_TITLES));
  assert.ok(POST_BODIES(w.fake, '/databases').every((b) => b.is_inline === true && b.parent.page_id === demo.page.id));

  // the Claims table carries the Geo columns, the agent's seven and the editor's four, and neither "(old)" column; the three relations point at this page's Rulebook and were added after it
  const claimsSchema = w.fake.dataSource(demo.databases.claims_copy.data_source_id).properties;
  const liveNames = structure.tables.claims_copy.columns.filter((c) => !c.retired).map((c) => c.name);
  assert.deepEqual(Object.keys(claimsSchema), liveNames.filter((n) => !RELATIONS.includes(n)).concat(RELATIONS), 'the relations come last: they are added once the Rulebook exists');
  assert.deepEqual(Object.keys(claimsSchema).filter((n) => RETIRED_COLUMNS.includes(n)), [], 'a practice page never gets the two retired columns');
  for (const name of RELATIONS) {
    assert.equal(claimsSchema[name].type, 'relation', name);
    assert.equal(claimsSchema[name].relation.data_source_id.replace(/-/g, ''), demo.databases.rulebook.data_source_id, `${name} points at the Rulebook of this page, not at any other table`);
  }
  assert.deepEqual(claimsSchema['Agent status'].select.options.map((o) => o.name), ['Waits for you', 'Done', 'Disagrees with your decision', 'Could not read']);
  for (const name of ['Agent edition', 'Agent remarks']) assert.equal(claimsSchema[name].type, 'rich_text', name);
  assert.deepEqual(claimsSchema['Review status'].select.options.map((o) => o.name), ['To review', 'Reviewed']);
  assert.equal(claimsSchema['Why wrong'], undefined, 'the editor has no Why wrong on a practice page, and the retired column is never made');
  assert.equal(claimsSchema['Agent reading'].type, 'rich_text');
  assert.equal(claimsSchema['Agent confidence'].type, 'number');
  assert.equal(claimsSchema['Agent reasons'].type, 'rich_text');
  assert.equal(w.fake.dataSource(demo.databases.tag_decisions.data_source_id).properties['Decided under'].type, 'rich_text');
  const ledgerSchema = w.fake.dataSource(demo.databases.tag_decisions.data_source_id).properties;
  assert.deepEqual(READING_COLUMNS.map((n) => ledgerSchema[n]?.type), ['select', 'rich_text', 'rich_text', 'rich_text'], 'the ledger holds the agent\'s reading of a decision');
  assert.deepEqual(ledgerSchema['Agent reading'].select.options.map((o) => o.name), ['Agent slip', 'Rule unclear', 'Rule should change']);
  assert.equal(w.fake.requests.filter((q) => q.method === 'PATCH' && /^\/data_sources\//.test(q.path)).length, 1, 'one request adds the three relations');

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
    const lastLine = { 'Your queue': /^A note that starts with "Agent slip\."/, 'Lessons waiting': /^Doing the work\./ }[l.name];
    assert.match(entries[at - 1].text, lastLine, `${l.name} follows the last line of the Doing the work of its step`);
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
  assert.deepEqual(queue.body.filter, { property: 'Agent status', select: { equals: 'Waits for you' } }, 'Your queue lists the claims whose Agent status is Waits for you, with no condition on Review status');
  assert.deepEqual(queue.body.sorts, [{ property: 'Agent confidence', direction: 'ascending' }]);
  assert.equal(queue.body.configuration.wrap_cells, true);
  assert.deepEqual(shown(queue, 'claims_copy'), REVIEW_ORDER);
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
  assert.deepEqual([1, 9, 5, 0, 1], ['rulebook', 'claims_copy', 'tag_decisions', 'rule_changes', 'agent_settings'].map((t) => w.rows(t).length));
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
    assertAgentSideEmpty(row, c.key, seededReadingOf(manifest, c.key));
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
  // the appends are the plan's: the text before the tables (a request for each hundred blocks), the Help toggle, and the text inside it
  const appends = read(join(dir, 'setup-plan.json')).requests.filter((q) => q.method === 'PATCH' && q.blocks && !/only if/.test(q.note)).length;
  assert.equal(appends, Math.ceil(dp.preBlocks(dp.pageModel(real().template.text, { edition: EDITION, date: dp.dateWord(NOW) })).length / 100) + 2, 'one request for each hundred blocks before the tables, then the toggle and its text');
  assert.equal(builderLog.writes, 1 + appends + 5 + 1 + 5, 'a page, the appends, five tables, the relation and five views went through the builder client');
  assert.equal(countRequests(join(dir, 'runs', 'builder', 'requests-rows.jsonl')).writes, 16, 'the rows went through the rows client');
  assert.ok(existsSync(join(dir, 'runs', readdirSync(join(dir, 'runs')).find((n) => n.endsWith('walkthrough-start')), 'report.md')));

  // verify reads it all back and finds nothing
  const v = await w.run(['verify', '--json']);
  assert.equal(v.code, 0, v.err);
  const result = JSON.parse(v.out);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.equal(result.counts.rulebook, 1);
  assert.equal(result.counts.claims, 9);
  assert.equal(result.counts.tag_decisions, 5);
  assert.equal(result.counts.decided, 5);
  assert.equal(result.counts.open, 4);
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

test('a fresh page\'s Claims: five claims Reviewed with the audit\'s values and their seeded Agent reading, four To review, the editor\'s columns otherwise empty, and the relation points at the Rulebook row', async () => {
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
    assert.equal(row['Why wrong'], undefined, `${c.key}: the Claims has no Why wrong`);
    if (d) {
      reviewed.push(c.key);
      assert.equal(row['Review status'], 'Reviewed', c.key);
      assert.equal(row['Challenged tags notes'], d['Challenged tags notes'], c.key);
      assert.ok(row['Challenged tags notes'].startsWith('From the audit of 9 October: '), c.key);
      assert.deepEqual(row[V].map(dashless), d[V].length ? [dashless(book.page_id)] : [], `${c.key}: the Applies decisions (cnn, dallas) hold the tag, the Does not apply ones hold nothing`);
      assert.deepEqual(raw(c).properties[V].relation.map((x) => dashless(x.id)), d[V].length ? [dashless(book.page_id)] : []);
      assert.equal(row['Agent reading'], SEEDED_LINE, `${c.key}: created with the agent's seeded reading (decision 73)`);
    } else {
      toReview.push(c.key);
      assert.equal(row['Review status'], 'To review', c.key);
      assert.equal(row['Challenged tags notes'] ?? '', '', `${c.key}: the notes are empty`);
      assert.deepEqual(row[V], [], `${c.key}: nothing is verified`);
      assert.ok([null, undefined, ''].includes(row['Agent reading']), `${c.key}: an empty Agent reading means not read yet`);
    }
  }
  assert.deepEqual(reviewed, ['cnn', 'dallas', 'contractor', 'kennedy', 'stopgap']);
  assert.deepEqual(toReview, ['presspool', 'aiforce', 'usps', 'georgia']);
  assert.deepEqual(['cnn', 'dallas'].map((k) => w.rowBy('claims_copy', 'Geo ID', manifest.claims.find((c) => c.key === k)['Geo ID'])[V].length), [1, 1]);
  assert.equal(w.rows('claims_copy').filter((r) => r[V].length).length, 2, 'only the two Applies decisions hold the tag');
  assert.equal(w.rows('claims_copy').filter((r) => r['Review status'] === 'Reviewed').length, 5);
  // the agent's side (all eight columns) is empty on the claims to decide, and none of the claims says that anything waits; the decided claims hold their seeded reading only
  for (const row of w.rows('claims_copy')) assertAgentSideEmpty(row, row['Geo Name'], row['Review status'] === 'Reviewed' ? SEEDED_LINE : null);
  // the editor's columns were written by the build under its marker, in creates and through the plan check; nothing was updated afterwards
  assert.equal(w.fake.requests.filter((q) => q.method === 'PATCH' && /^\/pages\//.test(q.path)).length, 0);
});

test('the ledger of a fresh page: a row for each of the five decided claims with the copy of the audit\'s decision, already read as Agent slip, and none for the four claims that wait', async () => {
  const w = newWorld();
  const { manifest } = real();
  { const r0 = await w.start(); assert.equal(r0.code, 0, r0.err + ' | ' + r0.out); }
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
    assert.equal(row['Tag outcome'], d['Verified tags'].length ? 'Applies' : 'Does not apply', `${c.key}: the outcome of the claim's verified tags`);
    assert.ok(!row['Why wrong'], `${c.key}: the ledger's Why wrong holds a reason word of the editor, and there is none`);
    assert.equal(row['Your reasoning'], d['Challenged tags notes'], `${c.key}: the words of the audit, copied`);
    assert.ok(!row['Decided under'], `${c.key}: the audit gave no edition`);
    for (const column of ['Follow-up', 'Agent reason']) assert.ok(!row[column], `${c.key}: ${column}`);
    assert.equal(row['Rulebook edition'], EDITION, `${c.key}: the edition the proposal is said to be made under, which the key of the seeded reading holds`);
    assert.ok([null, undefined].includes(row['Agent confidence']));
    // the decision differs from the agent's answer (all five do), so the row is created already read: Agent slip, the audit's note, and the key distill checks
    assert.notEqual(row['Tag outcome'], row['Agent proposal'], c.key);
    assert.deepEqual([row['Agent reading'], row['Reading note']], ['Agent slip', SEEDED], `${c.key}: the seeded reading`);
    assert.ok([null, undefined, ''].includes(row.Rule), `${c.key}: no rule, because the seeded row cites none`);
    assert.match(row['Read under'], new RegExp(`^${EDITION.replace('.', '\\.')} · [0-9a-f]{8}$`), c.key);
  }
  assert.equal(rows.filter((r) => r['Tag outcome'] === 'Applies').length, 2, 'cnn and dallas');
  // the copy is the one the tag step would make: syncing the decisions of the claims into this ledger changes nothing but one column
  const { syncDecisions } = await import('../../agents/claim-tagger-mvp/scripts/lib/decisions.mjs');
  const claims = manifest.claims.map((c) => {
    const row = w.rowBy('claims_copy', 'Geo ID', c['Geo ID']);
    return { geo_id: c['Geo ID'], review_status: row['Review status'], verified_tags: row['Verified tags'].length ? [TAG] : [], challenged_notes: row['Challenged tags notes'] || '' };
  });
  const ledger = rows.map((r) => ({ ...r, decided: Boolean(r['Tag outcome']) }));
  // the one copy left is Decided under, which the first tag step writes from the Rulebook edition of the row (the audit gave no edition of its own); nothing else differs
  const todo = syncDecisions(claims, ledger, { tagNames: [TAG] }).changes;
  assert.deepEqual(todo.map((c) => Object.keys(c.changes)), [['Decided under'], ['Decided under'], ['Decided under'], ['Decided under'], ['Decided under']]);
  assert.ok(todo.every((c) => c.changes['Decided under'] === EDITION));
  // and the seeded rows are current for distill: classifyRows, the function distill reads the ledger with, finds the five unchanged and nothing to read
  const { classifyRows } = await import('../../agents/claim-tagger-mvp/scripts/lib/readings.mjs');
  const rubric = readRubric(w.dir());
  const classes = classifyRows({ claims, ledgerRows: ledger, rubric });
  assert.deepEqual(Object.fromEntries(Object.entries(classes).map(([k, list]) => [k, list.length])), { verbatim: 0, toRead: 0, current: 5, agree: 0, fixed: 0, unjudged: 0, orphans: 0 }, 'five readings that are current: no model call for them at the first distill');
  // and the pull turns them into the earlier decisions, from the audit
  const cases = lines(join(w.dir(), 'evals', 'cases.jsonl'));
  assert.deepEqual(cases.map((c) => c.outcome).sort(), ['Applies', 'Applies', 'Does not apply', 'Does not apply', 'Does not apply']);
  assert.ok(cases.every((c) => c.decided_edition === EDITION && c.source === 'audit of 9 October'), 'the earlier decisions are said to be decided under the edition of the page, the Rulebook edition of their rows');
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
  assert.deepEqual([1, 9, 5, 1], ['rulebook', 'claims_copy', 'tag_decisions', 'agent_settings'].map((t) => r.rows(t).length), 'no row twice');
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
      if (rows === 17) w.fake.failNext('GET', /^\/blocks\//, 503, 4); // the page and sixteen rows are in; the first read of the page fails
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
  assert.match(outline[at - 1], /^paragraph\|A note that starts with "Agent slip\."/, 'the paragraph follows the last line of the Doing the work of Step 3');
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

test('verify finds what was changed after the build: an editor column of a decided claim, a claim that waits, the agent\'s columns, the seeded readings, the ledger, a block on the page, preview.md', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const demo = w.demo();
  const clean = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.equal(clean.ok, true);
  assert.deepEqual([clean.counts.claims, clean.counts.decided, clean.counts.open, clean.counts.tag_decisions], [9, 5, 4, 5], 'the counts the manifest expects: nine claims, five decided, four open, five ledger rows');

  const { manifest } = real();
  const V = dp.CLAIM_COLUMNS.verified;
  const claimOf = (key) => manifest.claims.find((c) => c.key === key);
  const claimRow = (key) => w.rowBy('claims_copy', 'Geo ID', claimOf(key)['Geo ID']);
  const ledgerRow = (key) => w.rowBy('tag_decisions', 'Key', `${claimOf(key)['Geo ID']}::${TAG}`);
  const book = w.rows('rulebook')[0];
  // the editor's columns of the claims decided earlier: a tag taken away, a status and the words changed
  w.fake.editRow(claimRow('cnn').page_id, { [V]: [] });
  w.fake.editRow(claimRow('contractor').page_id, { 'Review status': 'To review' });
  w.fake.editRow(claimRow('stopgap').page_id, { 'Challenged tags notes': 'Something else.' });
  // a claim that waits, before any command ran: nobody should have decided it
  w.fake.editRow(claimRow('presspool').page_id, { 'Challenged tags notes': 'An early word.' });
  w.fake.editRow(claimRow('aiforce').page_id, { 'Review status': 'Reviewed', [V]: [book.page_id] });
  // the agent's columns before any command ran: its tags and status, and a reading on a claim that nobody has decided yet
  w.fake.editRow(claimRow('dallas').page_id, { 'Agent tags': [book.page_id] });
  w.fake.editRow(claimRow('kennedy').page_id, { 'Agent status': 'Done' });
  w.fake.editRow(claimRow('presspool').page_id, { 'Agent reasons': 'x' });
  w.fake.editRow(claimRow('usps').page_id, { 'Agent reading': 'Context-dependent: Agent slip, rule 5 · Your note says so.' });
  // the seeded reading of a decided claim, changed, and the agent's reading on the ledger: the row, the rule and the note
  w.fake.editRow(claimRow('contractor').page_id, { 'Agent reading': 'Nothing to read: the agent agreed with you.' });
  w.fake.editRow(ledgerRow('kennedy').page_id, { 'Agent reading': 'Rule unclear' });
  w.fake.editRow(ledgerRow('stopgap').page_id, { 'Reading note': 'The model said so.' });
  w.fake.editRow(ledgerRow('cnn').page_id, { 'Read under': `${EDITION} · 00000000` });
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
  assert.match(text, /the earlier decision Excluding CNN .* differs from the manifest in Verified tags/);
  assert.match(text, /the earlier decision A contractor.* differs from the manifest in Review status/);
  assert.match(text, /the earlier decision December stopgap .* differs from the manifest in Challenged tags notes/);
  assert.match(text, /the claim The press pool .* that waits for the editor already has Challenged tags notes/);
  assert.match(text, /the claim The AI Force .* that waits for the editor has Review status Reviewed, it should be To review/);
  assert.match(text, /the claim The AI Force .* that waits for the editor already has Verified tags/);
  assert.match(text, /the claim The Dallas .* has Agent tags filled in before any command ran/);
  assert.match(text, /the claim Relocating .* has Agent status filled in before any command ran/);
  assert.match(text, /the claim The press pool .* has Agent reasons filled in before any command ran/);
  assert.match(text, /the claim The USPS ballot portal .* has Agent reading filled in before any command ran/, 'an open claim has no Agent reading: nobody has read its decision');
  assert.match(text, /the earlier decision A contractor.* differs from the manifest in Agent reading\n/, 'the seeded line of a decided claim is the one the page was built with');
  assert.match(text, /the earlier decision Relocating .* differs from the manifest in Agent reading of Tag decisions/);
  assert.match(text, /the earlier decision December stopgap .* differs from the manifest in Reading note of Tag decisions/);
  assert.match(text, /the earlier decision Excluding CNN .* differs from the manifest in Read under of Tag decisions/);
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

  // the editor decides the four claims in Notion, as step 3 tells them
  for (const o of manifest.open) {
    w.fake.editRow(claimRow(o.claim).page_id, { [V]: o.enter[V].map(() => book.page_id), 'Review status': 'Reviewed', 'Challenged tags notes': o.enter['Challenged tags notes'] });
  }
  const decided = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.deepEqual(decided.problems, [], 'an editor\'s decision on a claim that waited is not damage');
  assert.deepEqual([decided.counts.decided, decided.counts.open], [9, 0]);
  // the agent reads the decisions and changes its readings (a changed rule is read again): not damage either, once a command has run
  w.fake.editRow(claimRow('cnn').page_id, { 'Agent reading': 'Context-dependent: Rule unclear, rule 3 · The rule leaves this open.' });
  w.fake.editRow(w.rowBy('tag_decisions', 'Key', `${manifest.claims.find((c) => c.key === 'cnn')['Geo ID']}::${TAG}`).page_id, { 'Agent reading': 'Rule unclear', Rule: 'Context-dependent rule 3', 'Reading note': 'The rule leaves this open.', 'Read under': `${EDITION} · 12345678` });
  assert.deepEqual(JSON.parse((await w.run(['verify', '--json'])).out).problems, [], 'the readings are the agent\'s to change once a command has run');
  // in a state the page was never meant to be in, it is still no business of verify
  w.fake.editRow(claimRow('aiforce').page_id, { 'Review status': 'To review' });
  assert.deepEqual(JSON.parse((await w.run(['verify', '--json'])).out).problems, []);

  // an earlier decision is never the editor's to change on a practice page: it is what the safety check tests against
  w.fake.editRow(claimRow('kennedy').page_id, { [V]: [book.page_id] });
  w.fake.editRow(claimRow('cnn').page_id, { 'Review status': 'To review' });
  const changed = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.equal(changed.ok, false);
  assert.match(changed.problems.join('\n'), /the earlier decision Relocating .* differs from the manifest in Verified tags/);
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
  assert.equal(v.counts.tag_decisions, 9, 'the tag step added the ledger rows of the four claims that waited');
  assert.equal(v.counts.fresh, false);
  const human = await w.run(['verify']);
  assert.equal(human.code, 0, human.err);
  assert.deepEqual(lintReport(`${human.out}\n`), []);
  assert.match(human.out, /\| Claims \| 9: 5 reviewed, 4 waiting for you \|/,'no longer "reviewed earlier": the editor may have decided some');
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
  assert.equal(open.length, 4);
  const decide = (key) => {
    const enter = manifest.open.find((o) => o.claim === key).enter;
    w.fake.editRow(claimRow(key).page_id, { [V]: enter[V].map(() => book.page_id), 'Review status': 'Reviewed', 'Challenged tags notes': enter['Challenged tags notes'] });
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

  // nothing has run yet: the page has just been built, and `status` (step 1) writes nothing, so the page stays at step 1 until a command that writes has run
  let r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 1, ${title(1)}.`);
  assert.equal(r.next, `Next: type ${steps[0].command}.`);
  assert.equal(guideChecklistFor(r.sentence, r.next), null, 'a command only: no checklist');
  // a command that writes has run (Last run summary is filled) and the claims have no Agent status yet
  w.fake.editRow(w.rows('agent_settings')[0].page_id, { 'Last run summary': 'Tag at 15 Oct 14:40' });
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 2, ${title(2)}.`);
  assert.equal(r.next, `Next: type ${steps[1].command}.`);
  // the agent has read the claims
  agentHasRead(w);
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 3, ${title(3)}.`);
  assert.equal(title(3), 'Decide your four claims');
  assert.equal(r.next, `Next: open Your queue (${view('your_queue')}) and decide your four claims.`);
  assert.deepEqual(guideChecklistFor(r.sentence, r.next), { checklist: 'Decide in Your queue', form: 'Demo' }, 'the guide picks the Demo checklist for this Next line');
  // some claims decided: the ones that are left
  decide(open[0]);
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 3, ${title(3)}.`);
  assert.equal(r.next, `Next: open Your queue (${view('your_queue')}) and decide your remaining claims.`);
  assert.deepEqual(guideChecklistFor(r.sentence, r.next), { checklist: 'Decide in Your queue', form: 'Demo' }, 'and for the claims that are left');
  decide(open[1]);
  assert.equal((await where()).next, `Next: open Your queue (${view('your_queue')}) and decide your remaining claims.`);
  decide(open[2]);
  r = await where();
  assert.equal(r.next, `Next: open Your queue (${view('your_queue')}) and decide your remaining claim.`, 'one left: the singular');
  assert.deepEqual(guideChecklistFor(r.sentence, r.next), { checklist: 'Decide in Your queue', form: 'Demo' });
  // all four decided
  decide(open[3]);
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 4, ${title(4)}.`);
  assert.equal(r.next, `Next: type ${steps[3].command}.`);
  // a rule change is drafted: it rests on the press pool and the AI Force claim (its Supporting rows), not on all four
  const supporting = ['presspool', 'aiforce'].map((k) => `${manifest.claims.find((c) => c.key === k).short} · ${manifest.claims.find((c) => c.key === k)['Geo ID']}::${TAG}`).join('\n');
  const lessonRow = w.fake.addRow(demo.databases.rule_changes.database_id, { Lesson: 'Known groups count as identified', Tag: TAG, Rule: 'Context-dependent rule 3', Kind: 'Clarify wording', 'Supporting rows': supporting, Status: 'Proposed' });
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 5, ${title(5)}.`);
  assert.equal(r.next, `Next: open Lessons waiting (${view('lessons_waiting')}) and set Status to Approved.`);
  assert.deepEqual(guideChecklistFor(r.sentence, r.next), { checklist: 'Approve in Lessons waiting', form: 'Demo' });
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
  assert.deepEqual(guideChecklistFor(r.sentence, r.next), { checklist: 'After a FAIL', form: 'Demo' });
  // live, and the run stopped before it re-checked the claims
  w.fake.editRow(lessonRow, { Status: 'Live', 'Safety check result': 'PASS: examples 10/10, earlier 6/6, yours 2/2' });
  r = await where();
  assert.equal(r.sentence, `Walkthrough: you are at step 7, ${title(7)}; the run stopped before it re-checked your claims.`);
  assert.equal(r.next, 'Next: type /claim-tagger demo follow-up.');
  assert.equal(guideChecklistFor(r.sentence, r.next), null);
  // follow-up ran: one claim fixed, one not (the Follow-up is the ledger's)
  w.fake.editRow(ledgerRow(open[0]).page_id, { 'Follow-up': 'Fixed' });
  assert.match((await where()).sentence, /step 7, .*stopped before/);
  w.fake.editRow(ledgerRow(open[1]).page_id, { 'Follow-up': 'Still wrong' });
  r = await where();
  assert.match(r.sentence, /^Walkthrough: you are at step 7, /);
  assert.equal(r.next, `Next: add a note in Challenged tags notes on the claims in Agent disagreed (${view('agent_disagreed')}).`);
  assert.deepEqual(guideChecklistFor(r.sentence, r.next), { checklist: 'Agent disagreed', form: 'Demo' });
  // both rows the change rests on are fixed: complete, although the USPS and Georgia rows have no Follow-up and their claims still read Waits for you (decision 76)
  w.fake.editRow(ledgerRow(open[1]).page_id, { 'Follow-up': 'Fixed' });
  for (const key of [open[2], open[3]]) assert.ok(!ledgerRow(key)['Follow-up'], `${key}: no Follow-up`);
  for (const key of open) assert.equal(claimRow(key)['Agent status'], 'Waits for you', `${key}: nothing has read the decision again`);
  r = await where();
  assert.equal(r.sentence, 'Walkthrough: you have been through all seven steps of the practice page.');
  assert.equal(r.next, 'Next: nothing to type; archive the page by hand when you no longer need it.');
  assert.equal(guideChecklistFor(r.sentence, r.next), null);
  // a rejected rule change also ends the walkthrough
  w.fake.editRow(lessonRow, { Status: 'Rejected', 'Safety check result': null });
  for (const key of open) w.fake.editRow(ledgerRow(key).page_id, { 'Follow-up': null });
  r = await where();
  assert.equal(r.next, 'Next: nothing to type; archive the page by hand when you no longer need it.');
  assert.equal(w.fake.requests.filter((q) => q.method === 'PATCH' && /pages/.test(q.path)).length, 0, 'where only reads');
});

test('where reads the step from the Review status of the four claims: the ledger rows of the tag step do not move it, and an editor who goes back to To review moves it back', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const { manifest } = real();
  const claimRow = (key) => w.rowBy('claims_copy', 'Geo ID', manifest.claims.find((c) => c.key === key)['Geo ID']);
  const stepLine = async () => (await w.run(['where'])).out.split('\n')[0];
  const open = manifest.open.map((o) => o.claim);
  // the ledger rows of the four exist, with a proposal, but the claims have no Agent status: the agent has not read them
  for (const o of manifest.open) {
    const c = manifest.claims.find((x) => x.key === o.claim);
    w.fake.addRow(w.db('tag_decisions'), { Claim: c['Geo Name'], Key: `${c['Geo ID']}::${TAG}`, Tag: TAG, 'Agent proposal': 'Applies' });
  }
  assert.match(await stepLine(), /step 1,/, 'a fresh page: the ledger rows do not move it either');
  w.fake.editRow(w.rows('agent_settings')[0].page_id, { 'Last run summary': 'Tag at 15 Oct 14:40' });
  assert.match(await stepLine(), /step 2,/);
  for (const key of open.slice(0, 3)) {
    w.fake.editRow(claimRow(key).page_id, { 'Agent status': 'Waits for you' });
    assert.match(await stepLine(), /step 2,/, 'one of the four is still unread');
  }
  w.fake.editRow(claimRow(open[3]).page_id, { 'Agent status': 'Waits for you' });
  assert.match(await stepLine(), /step 3,/);
  for (const key of open.slice(0, 3)) w.fake.editRow(claimRow(key).page_id, { 'Review status': 'Reviewed' });
  assert.match(await stepLine(), /step 3,/, 'three decided, one left');
  w.fake.editRow(claimRow(open[3]).page_id, { 'Review status': 'Reviewed' });
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
  assert.match(r.out, new RegExp(`Next: open Claims \\(${claimsTable.replace(/\./g, '\\.')}\\) and decide your four claims\\.`));
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

test('the Claims tables of step 2 and the words of the story are what the tag step writes: the four claims are To review, so every tag waits and none is written to Agent tags', () => {
  const { manifest, template } = real();
  const page = dp.pageModel(template.text, { edition: EDITION, date: dp.dateWord(NOW) }).rendered;
  const step2 = page.slice(page.indexOf('## Step 2'), page.indexOf('## Step 3'));
  const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim());
  const rows = step2.split('\n').filter((l) => l.startsWith('|')).map(cells);
  // Agent tags, Agent confidence and Agent status for all nine claims (Geo Name makes the fourth column of four)
  const header = rows.findIndex((r) => r[0] === 'Geo Name' && r[1] === 'Agent tags');
  assert.deepEqual(rows[header], ['Geo Name', 'Agent tags', 'Agent confidence', 'Agent status']);
  const table = rows.slice(header + 2, header + 2 + manifest.claims.length);
  assert.equal(table.length, manifest.claims.length);
  assert.equal(table.length, 9);
  const open = new Set(manifest.open.map((o) => o.claim));
  const decided = new Map(manifest.decided.map((d) => [d.claim, d]));
  const proposals = { presspool: 'Applies', aiforce: "Can't tell", usps: 'Applies', georgia: 'Does not apply' };
  const writtenFor = (c) => {
    const d = decided.get(c.key);
    // what the tag step writes for this claim (propose.mjs claimColumns): a claim To review waits whatever the proposal; a Reviewed claim gets the editor's set
    return open.has(c.key)
      ? claimColumns({ judgedNames: [TAG], verdicts: new Map([[TAG, proposals[c.key]]]), toReview: true, edition: EDITION })
      : claimColumns({ judgedNames: [TAG], verdicts: new Map([[TAG, d['Verified tags'].includes(TAG) ? 'Applies' : 'Does not apply']]), reviewed: true, verifiedTags: d['Verified tags'], edition: EDITION });
  };
  manifest.claims.forEach((c, i) => {
    const written = writtenFor(c);
    const [name, tags, confidence, status] = table[i];
    assert.equal(name, c.short, c.key);
    assert.equal(tags, written.tags.join(', ') || '(empty)', `${c.key}: Agent tags`);
    assert.equal(status, written.status, `${c.key}: Agent status`);
    assert.match(confidence, /^0\.\d\d( or more)?$/, `${c.key}: a figure between 0.5 and 1, or a lower bound`);
  });
  assert.deepEqual(table.filter((r) => r[3] === 'Waits for you').map((r) => r[0]), manifest.open.map((o) => manifest.claims.find((c) => c.key === o.claim).short), 'the four claims for the editor are the four that wait');
  assert.deepEqual(table.filter((r) => r[3] === 'Done').length, 5, 'the five earlier decisions are Done');
  // the confidence the page shows for a claim is one the calibration expects the agent to reach: USPS Applies at 0.75 or more, Georgia Does not apply at 0.25 or less (confidence 0.75 or more)
  const confidenceOf = (key) => Number(table[manifest.claims.findIndex((c) => c.key === key)][2]);
  assert.ok(confidenceOf('usps') >= 0.75 && confidenceOf('georgia') >= 0.75);
  // Tags waiting and Agent reasons for the claims that wait: the tag, and the reason in the form propose writes
  const header2 = rows.findIndex((r) => r[0] === 'Geo Name' && r[1] === 'Tags waiting');
  assert.deepEqual(rows[header2], ['Geo Name', 'Tags waiting', 'Agent reading', 'Agent reasons']);
  const waiting = rows.slice(header2 + 2, header2 + 2 + manifest.open.length);
  assert.equal(waiting.length, manifest.open.length);
  manifest.open.forEach((o, i) => {
    const c = manifest.claims.find((x) => x.key === o.claim);
    assert.equal(waiting[i][0], c.short);
    assert.equal(waiting[i][1], writtenFor(c).waiting.join(', '), `${o.claim}: Tags waiting holds the tag`);
    assert.equal(waiting[i][2], '(empty)', `${o.claim}: Agent reading is empty, the agent has read no decision yet`);
    assert.ok(waiting[i][3].startsWith(`${TAG}: `) && /runs agree$/.test(waiting[i][3]), `${o.claim}: Agent reasons, the tag first`);
  });
  assert.ok(!/Agent notes|two short lines|waits for an editor/.test(step2), 'the notes of the first build are nowhere in step 2');
  assert.match(step2, /Agent edition holds \d{4}-\d\d-\d\d\.\d on all 9 claims/);
  // the story: all four wait in Your queue, and the line that rule g asks for says why they wait
  const story = page.slice(0, page.indexOf('## Step 1'));
  assert.match(story, /The four claims were picked for the demo: the agent is fairly sure of three of them, but the page marks all four To review, so their Agent status reads Waits for you and all four sit in Your queue\. The AI Force claim is the one the agent reads differently from run to run\./);
  assert.ok(!/because the agent is unsure/.test(story), 'the story does not say as a fact that the agent is unsure of the AI Force claim: its reading differs from run to run');
  for (const o of manifest.open) assert.ok(story.includes(manifest.claims.find((c) => c.key === o.claim).short), `${o.claim} is a row of the story's table`);
  const step3 = page.slice(page.indexOf('## Step 3'), page.indexOf('## Step 4'));
  assert.match(step3, /Fill in three columns on each of your four claims, in the order of its list, in Your queue under the lists\./);
  assert.ok(!/not in it|in the Claims table, in The tables/.test(step3), 'all four claims are decided in Your queue');
  assert.ok(!/which here is the AI Force claim/.test(step3));
});


test('the table of Step 1 is what status prints on a page that has just been built, and the Next line sends the editor to the tag step; after the tag step the four claims wait in Your queue', async () => {
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

  // the tag step has run: the four claims are To review, so all four wait for an editor, the press pool, USPS and Georgia claims although the agent is fairly sure of them
  agentHasRead(w);
  const read = await status(hooks());
  assert.equal(read.report.sentence, `Status of the practice page ${demo.title}: nothing is paused; 4 rows wait for you.`);
  assert.deepEqual(read.report.rows[1].slice(0, 2), ['Your queue', '4 rows, lowest confidence first']);
  assert.match(read.report.next, /^Next: decide your four claims in Your queue \(https:\/\/www\.notion\.so\/[0-9a-f]{32}(\?v=[0-9a-f]{32}|#[0-9a-f]{32})\)\.$/);
  assert.equal(manifest.open.length, 4, 'the four claims of the story are the four that status counts');
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
  manifest.decided[0]['Verified tags'] = 'Context-dependent';
  writeFileSync(file, JSON.stringify(manifest));
  assert.match(dp.profileProblem(dp.pickDemo(w.root, shaped)), /Verified tags must be a list of tag names/);
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
  mineManifest.decided[0]['Verified tags'] = 'Context-dependent';
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
// the editor's three columns of a claim (READ-DECISIONS.md): the relation (no tag), Review status, Challenged tags notes
const EDITOR_QUEUE = { 'Verified tags': [], 'Review status': 'Reviewed', 'Challenged tags notes': 'Rule 4 is too strict.' };
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
  const book = w.rows('rulebook', id)[0];
  const reads = {
    presspool: { proposal: 'Applies', confidence: 0.8 },
    aiforce: { proposal: "Can't tell", confidence: 0.5 },
    usps: { proposal: 'Applies', confidence: 0.8 },
    georgia: { proposal: 'Does not apply', confidence: 0.85 },
  };
  for (const o of manifest.open) {
    const claim = manifest.claims.find((c) => c.key === o.claim);
    const read = reads[o.claim] ?? reads.aiforce;
    const reason = `${claim.short.replace(/…$/, '')}: which one? · Context-dependent rule 3 · 1 of 1 runs agree`;
    const columns = claimColumns({ judgedNames: [TAG], verdicts: new Map([[TAG, read.proposal]]), toReview: true, edition, reasons: new Map([[TAG, reason]]) });
    w.fake.editRow(w.rowBy('claims_copy', 'Geo ID', claim['Geo ID'], id).page_id, {
      'Agent tags': columns.tags.map(() => book.page_id),
      'Agent confidence': read.confidence,
      'Agent reasons': columns.agent_reasons,
      'Agent status': columns.status,
      'Tags waiting': columns.waiting.map(() => book.page_id),
      'Agent edition': columns.agent_edition,
      'Agent remarks': columns.agent_remarks,
    });
    w.fake.addRow(w.db('tag_decisions', id), {
      Claim: claim['Geo Name'], Key: `${claim['Geo ID']}::${TAG}`, Tag: TAG, 'Agent proposal': read.proposal, 'Agent confidence': read.confidence, 'Agent reason': reason, 'Rulebook edition': edition,
    });
  }
  w.fake.editRow(w.rows('agent_settings', id)[0].page_id, { 'Last run summary': 'Tag · 15 Oct 14:40 · 9 claims' });
}

/** The four claims that wait are decided the way the page tells the editor to: the state in which a rule change is drafted. */
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
  ok(queueUpdate(w.demo, { 'Verified tags': ['0a9e0000-0000-4000-8000-0000000000bb'], 'Review status': 'Reviewed', 'Challenged tags notes': 'The claim names its subject.' }));
  // Why wrong is not an editor's column any more: the plan check refuses it on the Claims, with or without the option
  const gone = checkPlan(queueUpdate(w.demo, { 'Review status': 'Reviewed', 'Why wrong': 'Agent slip' }), w.demo, opts);
  assert.equal(gone.ok, false);
  assert.ok(gone.problems.some((p) => /"Why wrong" is not a column this plan may write to claims_copy/.test(p)), gone.problems.join('\n'));
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

test('decide enters the manifest values for one of the four claims, writes the three editor columns and nothing else in one request, logs the action before and after, and says what to do next', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const { manifest } = real();
  const [id] = w.demos();
  const V = dp.CLAIM_COLUMNS.verified;
  const N = dp.CLAIM_COLUMNS.notes;
  const EDITOR = [V, N, 'Review status'];
  const claims = manifest.open.map((o) => manifest.claims.find((c) => c.key === o.claim));
  const enter = manifest.open[0].enter; // the press pool: the tag does not apply
  const rowOf = (claim) => w.rowBy('claims_copy', 'Geo ID', claim['Geo ID']);
  const book = w.rows('rulebook')[0];
  agentHasRead(w);
  const writesBefore = w.fake.writes().length;
  const agentColumns = (claim) => [...AGENT_COLUMNS, 'Geo Name'].map((c) => rowOf(claim)[c]);
  const agentBefore = agentColumns(claims[0]);

  // only --claim: the values the page tells the editor to enter
  const first = await w.run(['decide', '--claim', manifest.open[0].claim]);
  assert.equal(first.code, 0, first.err);
  const row = rowOf(claims[0]);
  assert.deepEqual(row[V], [], 'the tag does not apply to the press pool: nothing is verified');
  for (const column of EDITOR.slice(1)) assert.equal(row[column], enter[column], column);
  for (const other of claims.slice(1)) assert.equal(rowOf(other)['Review status'], 'To review', 'the other claims are untouched');
  assert.deepEqual(agentColumns(claims[0]), agentBefore, 'the agent\'s columns are not the editor\'s to write');
  const sent = w.fake.writes().slice(writesBefore);
  assert.equal(sent.length, 1, 'one write');
  assert.equal(sent[0].method, 'PATCH');
  assert.equal(dashless(sent[0].path), `/pages/${dashless(row.page_id)}`);
  assert.deepEqual(Object.keys(sent[0].body.properties).sort(), [...EDITOR].sort(), 'the three editor columns of the claim, and nothing else');
  assert.deepEqual(sent[0].body.properties[V], { relation: [] });

  // the report: a sentence, the values, the next step; nothing of the code
  assert.deepEqual(lintReport(`${first.out}\n`), []);
  assert.equal(first.out.split('\n')[0], `Walkthrough: acting as the editor, the claim ${quoted(claims[0]['Geo Name'])} now reads Reviewed with no tag verified.`);
  assert.ok(first.out.includes(`| ${V} | none |`));
  assert.ok(first.out.includes('| Review status | Reviewed |'));
  assert.ok(!first.out.includes('Why wrong'));
  assert.ok(first.out.includes(`| Challenged tags notes | ${quoted(enter['Challenged tags notes'], 100)} |`));
  assert.match(lastLine(first.out), /^Next: open Your queue \(https:\/\/www\.notion\.so\/\S+\) and decide your remaining claims\.$/, 'one of the four is decided: the other three are what is left');
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
    assert.ok(!l.before[N], 'the cell was empty');
  }
  assert.equal(log[1].read_back, 'ok');
  const planRun = join(w.dir(), 'runs', log[0].plan_run);
  assert.equal(lines(join(planRun, 'plan.jsonl')).length, 2, 'the plan on disk: a header and one op');
  assert.equal(lines(join(planRun, 'plan.jsonl'))[0].plan.script, 'walkthrough.mjs');
  assert.equal(lines(join(planRun, 'plan.jsonl'))[1].table, 'claims_copy');
  assert.equal(lines(join(planRun, 'ledger.jsonl')).at(-1).read_back, 'ok', 'the ledger says the row was read back');

  // the second claim, with the values given: the tag applies, so the relation holds the page id of the tag's row, and the sentence is the one given
  const second = await w.run(['decide', '--demo', id, '--claim', manifest.open[1].claim, '--outcome', 'Applies', '--reasoning', 'Rule 4 should say that a named debate is enough.']);
  assert.equal(second.code, 0, second.err);
  const row2 = rowOf(claims[1]);
  assert.deepEqual(row2[V].map(dashless), [dashless(book.page_id)]);
  assert.deepEqual([row2['Review status'], row2[N]], ['Reviewed', 'Rule 4 should say that a named debate is enough.']);
  assert.equal(second.out.split('\n')[0], `Walkthrough: acting as the editor, the claim ${quoted(claims[1]['Geo Name'])} now reads Reviewed with Context-dependent verified.`);
  assert.ok(second.out.includes(`| ${V} | Context-dependent |`));
  assert.match(lastLine(second.out), /decide your remaining claims\.$/);
  assert.equal(actionsOf(w).length, 4);
  assert.deepEqual(actionsOf(w).at(-1).tags, [TAG]);

  // --outcome alone writes an empty note (an empty note is a decision too); the other two claims, by their own values, bring the page to step 4
  const third = await w.run(['decide', '--claim', manifest.open[2].claim, '--outcome', 'Does not apply']);
  assert.equal(third.code, 0, third.err);
  assert.deepEqual([rowOf(claims[2])[V], rowOf(claims[2])['Review status'], rowOf(claims[2])[N] ?? ''], [[], 'Reviewed', ''], 'a decision with only an outcome has an empty note');
  assert.ok(third.out.includes(`| ${N} | (empty) |`));
  assert.match(lastLine(third.out), /decide your remaining claim\.$/);
  const fourth = await w.run(['decide', '--claim', manifest.open[3].claim]);
  assert.equal(fourth.code, 0, fourth.err);
  assert.deepEqual([rowOf(claims[3])[V], rowOf(claims[3])['Review status'], rowOf(claims[3])[N] ?? ''], [[], 'Reviewed', ''], 'Georgia: the manifest\'s values, an empty note');
  assert.equal(fourth.out.split('\n')[0], `Walkthrough: acting as the editor, the claim ${quoted(claims[3]['Geo Name'])} now reads Reviewed with no tag verified.`);
  assert.ok(fourth.out.includes(`| ${N} | (empty) |`));
  assert.equal(lastLine(fourth.out), `Next: type ${manifest.steps[3].command}.`);
  assert.match((await w.run(['where'])).out, /you are at step 4, /);

  // the same values again change nothing and send nothing, and the log says so
  const writes = w.fake.writes().length;
  const again = await w.run(['decide', '--claim', manifest.open[0].claim]);
  assert.equal(again.code, 0, again.err);
  assert.equal(again.out.split('\n')[0], `Walkthrough: acting as the editor, the claim ${quoted(claims[0]['Geo Name'])} already reads Reviewed with no tag verified; nothing was changed.`);
  assert.equal(w.fake.writes().length, writes, 'nothing was sent');
  assert.equal(actionsOf(w).at(-1).status, 'unchanged');

  // a changed mind is a write again: the outcome alone writes the tag, an empty note and the status, and the log keeps what was there before
  const changed = await w.run(['decide', '--claim', manifest.open[0].claim, '--outcome', 'Applies']);
  assert.equal(changed.code, 0, changed.err);
  assert.deepEqual(rowOf(claims[0])[V].map(dashless), [dashless(book.page_id)]);
  assert.equal(rowOf(claims[0])[N] ?? '', '', 'the note is empty now: --outcome alone writes an empty note');
  const done = actionsOf(w).filter((l) => l.status === 'done');
  assert.deepEqual(Object.keys(done.at(-1).wrote).sort(), [V, N, 'Review status'].sort());
  assert.deepEqual(done.at(-1).wrote[V].map(dashless), [dashless(book.page_id)]);
  assert.deepEqual(done.at(-1).before, { [V]: [], [N]: enter[N], 'Review status': 'Reviewed' });
  assert.equal(Object.keys(w.fake.writes().at(-1).body.properties).length, 3);
  // and back: Does not apply empties the relation
  assert.equal((await w.run(['decide', '--claim', manifest.open[0].claim, '--outcome', 'Does not apply'])).code, 0);
  assert.deepEqual(rowOf(claims[0])[V], []);
});

test('decide changes the four claims that wait and nothing else, and says why when it refuses', async () => {
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
  await refused([], /decide needs --claim <key>; the claims to decide are: presspool, aiforce, usps, georgia/);
  await refused(['--claim', ''], /decide needs --claim <key>/);
  await refused(['--claim', 'nobody'], /"nobody" is not a claim of this practice page \(the claims to decide are: presspool, aiforce, usps, georgia\)/);
  await refused(['--claim', 'cnn'], /"cnn" is one of the earlier decisions, which are not changed/);
  await refused(['--claim', 'presspool', '--outcome', 'Maybe'], /--outcome must be Applies or Does not apply/);
  await refused(['--claim', 'presspool', '--why', 'Rule unclear', '--outcome', 'Applies'], /Unknown option '--why'/); // --why is gone: the agent reads the reason itself
  await refused(['--claim', 'presspool', '--reasoning', 'Because.'], /--reasoning goes with --outcome/);
  await refused(['--claim', 'presspool', '--outcome', 'Applies', '--reasoning', '  '], /--reasoning is empty \(leave it out to decide with an empty note\)/);
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
  hand((m) => { m.open[0].enter['Challenged tags notes'] = 'Another sentence than the one the page was planned with.'; });
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
  assert.ok(!rowOf(refusing)['Challenged tags notes']);
  const log = actionsOf(refusing);
  assert.deepEqual(log.map((l) => l.status), ['planned', 'failed']);
  assert.match(log[1].error, /Notion said no/);

  // Notion takes the write but the row reads differently afterwards
  const altering = newWorld();
  assert.equal((await altering.start()).code, 0);
  const altered = await altering.run(['decide', '--claim', claim.key], {
    wrapClients: ({ builder, rest }) => ({
      builder,
      rest: { ...rest, async updatePage(id, body) { return rest.updatePage(id, { ...body, properties: { ...body.properties, 'Challenged tags notes': { rich_text: [{ type: 'text', text: { content: 'Altered on the way.' } }] } } }); } },
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
  assert.match(afterDecide.out, /\| Claims \| 9: 6 reviewed, 3 waiting for you \|/);
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
  assert.match(changed.err, /the earlier decision .* differs from the manifest in Verified tags/);
});

// ---- the Claims table and its views after the feedback round of 21 October (CLAIMS-REVIEW.md section 6) --------------------------------------------------------------

/** The option for w.start: the Claims table gets, when it is made, the view Notion makes for every table (the shared fake makes none): all its columns shown, in the order they were made. */
function withDefaultView() {
  return {
    wrapClients: ({ builder, rest }) => ({
      builder: {
        ...builder,
        async createDatabase(args) {
          const res = await builder.createDatabase(args);
          if (args.title === dp.PRACTICE_TITLES.claims_copy) {
            const dataSourceId = res.data_sources[0].id;
            const properties = Object.values((await builder.retrieveDataSource(dataSourceId)).properties);
            await builder.createView({
              databaseId: res.id, dataSourceId, name: 'Table',
              configuration: { type: 'table', wrap_cells: false, properties: properties.map((p) => ({ property_id: p.id, visible: true, width: 150 })) }, position: { type: 'end' },
            });
          }
          return res;
        },
      },
      rest,
    }),
  };
}

/** The views of the Claims table of a built page, with the names of their columns: { own (Notion's own view), queue (the linked view), tabs (all views of the table), shown, hidden }. */
function claimsViews(w) {
  const demo = w.demo();
  const ds = w.fake.dataSource(demo.databases.claims_copy.data_source_id);
  const names = new Map(Object.values(ds.properties).map((p) => [p.id, p.name]));
  const tabs = w.fake.tabViews(demo.databases.claims_copy.database_id);
  return {
    own: tabs.find((v) => v.name === 'Table'),
    queue: w.fake.linked().find((l) => l.name === 'Your queue'),
    tabs,
    shown: (config) => config.properties.filter((p) => p.visible !== false).map((p) => names.get(p.property_id)),
    hidden: (config) => config.properties.filter((p) => p.visible === false).map((p) => names.get(p.property_id)),
  };
}

const builderClient = (w, version = BUILDER_API_VERSION) => createClient({ token: w.fake.token, fetchImpl: w.fake.fetchImpl, apiVersion: version, requestsPerSecond: 1000, sleep: noSleep });

test('the Claims table of a built page shows the agent\'s columns first, then the review columns, then the Geo columns, on its own view and on the three views; the relations, made last, do not come last', async () => {
  const w = newWorld();
  const r = await w.start([], withDefaultView());
  assert.equal(r.code, 0, `${r.err}\n${r.out}`);
  assert.match(r.err, /the column order of the Claims view "Table" was set to the review order/);
  const v = claimsViews(w);
  const geo = CLAIMS_COPY_COLUMNS.slice(1);
  // the table's own view: every column shown, in the order of the structure (the relations were added last and would otherwise come last)
  assert.deepEqual(v.shown(v.own.configuration), [...REVIEW_ORDER, ...geo]);
  assert.deepEqual(v.hidden(v.own.configuration), []);
  assert.deepEqual(dp.practiceStructure(read(join(AGENT, 'setup', 'structure.json'))).tables.claims_copy.columns.filter((c) => !c.retired).map((c) => c.name), v.shown(v.own.configuration), 'it is the structure\'s order');
  // the three views: the twelve review columns in that order, the Geo columns hidden, cells wrapping
  const three = [['Your queue', v.queue.body.configuration], ...v.tabs.filter((t) => t.name !== 'Table').map((t) => [t.name, t.configuration])];
  assert.deepEqual(three.map(([name]) => name), ['Your queue', 'Needs your note', 'Agent disagreed']);
  for (const [name, config] of three) {
    assert.deepEqual(v.shown(config), REVIEW_ORDER, name);
    assert.deepEqual(v.hidden(config).sort(), [...geo].sort(), `${name}: the Geo columns are hidden`);
    assert.equal(config.wrap_cells, true, name);
  }
  assert.deepEqual(real().manifest.expect.claims_columns, v.shown(v.queue.body.configuration), 'the manifest expects this order');
  // one write set the own view; the three views were made in the right order and never changed
  assert.equal(w.fake.requests.filter((q) => q.method === 'PATCH' && /^\/views\//.test(q.path)).length, 1);
  // verify finds nothing, and asking for the page again changes nothing
  assert.deepEqual(JSON.parse((await w.run(['verify', '--json'])).out).problems, []);
  const before = w.fake.writes().length;
  assert.equal((await w.run(['start', '--resume', w.demos()[0]])).code, 0);
  assert.equal(w.fake.writes().length, before);
});

test('verify names the Claims view whose columns were moved and the view whose filter was changed', async () => {
  const w = newWorld();
  assert.equal((await w.start([], withDefaultView())).code, 0);
  assert.deepEqual(JSON.parse((await w.run(['verify', '--json'])).out).problems, []);
  const v = claimsViews(w);
  const client = builderClient(w);
  const props = v.own.configuration.properties;
  await client.updateView(v.own.id, { configuration: { ...v.own.configuration, properties: [props.at(-1), ...props.slice(0, -1)] } }); // the last column first
  const disagreed = v.tabs.find((t) => t.name === 'Agent disagreed');
  await client.updateView(disagreed.id, { filter: { property: 'Agent status', select: { equals: 'Waits for you' } } });
  const bad = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.equal(bad.ok, false);
  const text = bad.problems.join('\n');
  assert.match(text, /Claims: view columns - "Table" \(the table's own view\): expected Geo Name, Agent tags, Agent confidence/);
  assert.match(text, /Claims: view filter - "Agent disagreed": expected /);
  assert.equal(bad.problems.length, 2, text);
});

test('a refusal of the column order of the Claims view does not stop the build: it is recorded, and verify names the view', async () => {
  const w = newWorld();
  const base = withDefaultView();
  const refusing = {
    wrapClients: (clients) => {
      const wrapped = base.wrapClients(clients);
      return { ...wrapped, builder: { ...wrapped.builder, async updateView() { throw new NotionError('Notion said no to the columns', { status: 400, code: 'validation_error' }); } } };
    },
  };
  const r = await w.start([], refusing);
  assert.equal(r.code, 2, 'the check of the finished page finds the view out of order');
  assert.match(r.err, /Notion refused the column order of the Claims view/);
  assert.match(r.err, /verify: Claims: view columns - "Table" \(the table's own view\)/);
  assert.ok(w.demo().errors.some((e) => e.view === 'claims_own_view'));
});

test('the three Claims views on a fresh page: Your queue lists the claims whose Agent status is Waits for you (a decided claim stays until the agent reads it again), Agent disagreed the claims that say Disagrees with your decision, Needs your note the claims whose Agent reading says without your note', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const { manifest } = real();
  const demo = w.demo();
  const structure = dp.practiceStructure(read(join(AGENT, 'setup', 'structure.json')));
  const planned = (name) => viewPlan(structure, structure.views.find((v) => v.name === name));
  const tabs = w.fake.tabViews(demo.databases.claims_copy.database_id);
  const queue = w.fake.linked().find((l) => l.name === 'Your queue');
  const view = { 'Your queue': queue.body, ...Object.fromEntries(tabs.map((t) => [t.name, t])) };
  assert.deepEqual(view['Your queue'].filter, { property: 'Agent status', select: { equals: 'Waits for you' } }, 'no condition on Review status');
  assert.deepEqual(view['Agent disagreed'].filter, { property: 'Agent status', select: { equals: 'Disagrees with your decision' } });
  assert.deepEqual(view['Needs your note'].filter, planned('Needs your note').body.filter, 'the view is the structure\'s');
  assert.deepEqual(view['Needs your note'].filter, { property: 'Agent reading', rich_text: { contains: 'without your note' } }, 'Needs your note filters on the flag the agent sets in Agent reading');
  for (const name of ['Your queue', 'Needs your note', 'Agent disagreed']) assert.deepEqual(view[name].sorts, [{ property: 'Agent confidence', direction: 'ascending' }], `${name}: lowest confidence first`);
  // the manifest says the same in words
  assert.match(manifest.expect.claims_view_filters['Your queue'], /Agent status is Waits for you/);
  assert.match(manifest.expect.claims_view_filters['Agent disagreed'], /Agent status is Disagrees with your decision/);
  assert.equal(manifest.expect.claims_view_filters['Needs your note'], 'Agent reading contains without your note');

  // the filters at work on the rows of the page
  const client = builderClient(w, '2025-09-03');
  const dataSourceId = demo.databases.claims_copy.data_source_id;
  const listed = async (name) => (await client.queryDataSourceAll(dataSourceId, { filter: view[name].filter, sorts: view[name].sorts })).map((p) => p.properties['Geo Name'].title.map((t) => t.plain_text).join(''));
  const nameOf = (key) => manifest.claims.find((c) => c.key === key)['Geo Name'];
  const claimRow = (key) => w.rowBy('claims_copy', 'Geo ID', manifest.claims.find((c) => c.key === key)['Geo ID']);
  assert.deepEqual([await listed('Your queue'), await listed('Agent disagreed'), await listed('Needs your note')], [[], [], []], 'a fresh page: the agent has read nothing, and the five earlier decisions carry their seeded reading (which is not "without your note")');
  agentHasRead(w);
  assert.deepEqual(await listed('Your queue'), [nameOf('aiforce'), nameOf('presspool'), nameOf('usps'), nameOf('georgia')], 'after the tag step all four wait, the least sure first');
  for (const o of manifest.open) assert.equal((await w.run(['decide', '--claim', o.claim])).code, 0);
  assert.equal((await listed('Your queue')).length, 4, 'all four are Reviewed and stay in Your queue until the agent reads them again');
  for (const key of ['aiforce', 'presspool']) w.fake.editRow(claimRow(key).page_id, { 'Agent status': 'Done' }); // what the follow-up of step 7 writes for the claims the rule change rests on
  assert.deepEqual(await listed('Your queue'), [nameOf('usps'), nameOf('georgia')], 'the two read again leave; USPS and Georgia stay until the next tag run');
  w.fake.editRow(claimRow('aiforce').page_id, { 'Agent status': 'Disagrees with your decision' });
  assert.deepEqual(await listed('Agent disagreed'), [nameOf('aiforce')]);
  assert.deepEqual(await listed('Your queue'), [nameOf('usps'), nameOf('georgia')]);
  // Needs your note: a claim whose Agent reading carries the flag; a claim read with a note, or one the agent agrees on, is not there
  w.fake.editRow(claimRow('usps').page_id, { 'Agent reading': 'Context-dependent: Agent slip, rule 5, without your note · USPS names which portal.' });
  w.fake.editRow(claimRow('presspool').page_id, { 'Agent reading': 'Context-dependent: Rule unclear, rule 3 · The rule leaves this open.' });
  w.fake.editRow(claimRow('georgia').page_id, { 'Agent reading': 'Nothing to read: the agent agreed with you.' });
  assert.deepEqual(await listed('Needs your note'), [nameOf('usps')]);
});

test('decide writes the three editor columns under their new names, in the order the page gives them, and the old names are nowhere', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const { manifest } = real();
  agentHasRead(w);
  const claim = manifest.claims.find((c) => c.key === 'aiforce');
  const book = w.rows('rulebook')[0];
  const before = w.fake.writes().length;
  const r = await w.run(['decide', '--claim', 'aiforce']);
  assert.equal(r.code, 0, r.err);
  const sent = w.fake.writes().slice(before);
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0].body.properties), ['Verified tags', 'Challenged tags notes', 'Review status'], 'the three columns, Review status last');
  assert.deepEqual(sent[0].body.properties['Verified tags'].relation.map((x) => dashless(x.id)), [dashless(book.page_id)]);
  assert.ok(!JSON.stringify(sent[0].body).includes('Claim quality tags'), 'the real table\'s name is not used on a practice page');
  assert.ok(!JSON.stringify(sent[0].body).includes('Why wrong'), 'and no reason is written: the agent reads it');
  assert.ok(r.out.includes('| Verified tags | Context-dependent |'));
  assert.ok(!r.out.includes('Claim quality tags') && !r.out.includes('Why wrong'));
  const row = w.rowBy('claims_copy', 'Geo ID', claim['Geo ID']);
  assert.deepEqual([row['Verified tags'].map(dashless), row['Review status'], row['Challenged tags notes']], [[dashless(book.page_id)], 'Reviewed', manifest.open[1].enter['Challenged tags notes']]);
  const log = actionsOf(w).filter((l) => l.status === 'done');
  assert.deepEqual(Object.keys(log[0].wrote), ['Verified tags', 'Challenged tags notes', 'Review status']);
  // the ledger copy the tag step makes from this claim is under the same words
  assert.deepEqual(loadConfig(w.dir()).editor_columns.claims_copy, ['Verified tags', 'Review status', 'Challenged tags notes']);
  assert.ok(!loadConfig(w.dir()).editor_columns.claims_copy.includes('Claim quality tags — verified'));
});

test('where reads Agent status: no status is a claim the agent has not read, whatever else is written, and each of the four values is a claim it has read', async () => {
  const w = newWorld();
  assert.equal((await w.start()).code, 0);
  const { manifest } = real();
  const claimRow = (key) => w.rowBy('claims_copy', 'Geo ID', manifest.claims.find((c) => c.key === key)['Geo ID']);
  const stepLine = async () => (await w.run(['where'])).out.split('\n')[0];
  w.fake.editRow(w.rows('agent_settings')[0].page_id, { 'Last run summary': 'Tag at 15 Oct 14:40' });
  assert.match(await stepLine(), /step 2,/);
  // reasons, an edition, a confidence and a reading are no status
  w.fake.editRow(claimRow('presspool').page_id, { 'Agent reasons': 'Context-dependent: x · 1 of 1 runs agree', 'Agent edition': EDITION, 'Agent confidence': 0.8, 'Agent reading': 'Nothing to read: the agent agreed with you.' });
  assert.match(await stepLine(), /step 2,/);
  // the other three have a status: the fourth is still unread
  w.fake.editRow(claimRow('presspool').page_id, { 'Agent status': 'Done' });
  for (const key of ['usps', 'georgia']) w.fake.editRow(claimRow(key).page_id, { 'Agent status': 'Waits for you' });
  assert.match(await stepLine(), /step 2,/, 'one of the four is still unread');
  for (const status of ['Could not read', 'Disagrees with your decision', 'Waits for you', 'Done']) {
    w.fake.editRow(claimRow('aiforce').page_id, { 'Agent status': status });
    assert.match(await stepLine(), /step 3,/, status);
  }
  // a decided claim keeps its status: that does not make it unread
  for (const key of ['presspool', 'aiforce', 'usps', 'georgia']) w.fake.editRow(claimRow(key).page_id, { 'Review status': 'Reviewed', 'Agent status': 'Waits for you' });
  assert.match(await stepLine(), /step 4,/);
});


test('the page passes the page lint with the manifest, as the template, the text and the preview with and without the fallbacks, and keeps its fixed lines and limits', () => {
  const { manifest, template } = real();
  const model = dp.pageModel(template.text, { edition: EDITION, date: dp.dateWord(NOW) });
  const page = model.rendered;
  for (const [what, text] of [['template', template.text], ['text', page], ['preview', dp.annotatedPreview(page, {})], ['preview with fallbacks', dp.annotatedPreview(page, { fallbackKeys: ['your_queue', 'lessons_waiting'] })]]) {
    assert.deepEqual(lintPage(text, { manifest }).problems, [], what);
  }
  // the limits again, read independently of the lint: tables of at most four columns, cells of at most 100 characters
  const tableRows = page.split('\n').filter((l) => l.startsWith('|') && !/^\|[-| ]+\|$/.test(l));
  assert.ok(tableRows.length > 40);
  for (const row of tableRows) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    assert.ok(cells.length <= 4, `at most four columns: ${row.slice(0, 60)}`);
    for (const cell of cells) assert.ok([...cell].length <= 100, `a cell of at most 100 characters: ${cell.slice(0, 60)}`);
  }
  // the fixed lines
  assert.ok(page.startsWith('Callout: You type four commands yourself (status, tag, distill and promote); the follow-up runs by itself after a PASS, and the engineer sets things up and fixes what breaks.\n'));
  assert.match(page, /picked for the demo/);
  assert.equal(page.match(/^## Step \d · /gm).length, 7);
  const step1 = page.slice(page.indexOf('## Step 1'), page.indexOf('## Step 2'));
  assert.match(step1, /an edition is a date plus a count/);
  const step7 = page.slice(page.indexOf('## Step 7'), page.indexOf('## The tables'));
  assert.match(step7, /\*\*What the full version adds later:\*\*\n\n- .*\n- .*\n- .*\n\nArchive this page by hand when you no longer need it\.\n*$/);
  const help = page.slice(page.indexOf('## Help'));
  assert.equal(help.slice(help.indexOf('**Words used'), help.indexOf('**If something stops')).split('\n').filter((l) => l.startsWith('- ')).length, 10);
  assert.equal(help.slice(help.indexOf('**If something stops')).split('\n').filter((l) => l.startsWith('- ')).length, 3);
  // every step still has its four labels in order, Agent settings is captioned in step 6 only, and the two views stand where the lint wants them
  for (let n = 1; n <= 7; n += 1) {
    const step = page.slice(page.indexOf(`## Step ${n} `), n < 7 ? page.indexOf(`## Step ${n + 1} `) : page.indexOf('## The tables'));
    const at = ['**Goal of the step.**', '**Existing status.**', '**Doing the work.**', '**Explaining the outputs'].map((label) => step.indexOf(label));
    assert.ok(at.every((i) => i >= 0) && at.every((i, k) => k === 0 || i > at[k - 1]), `Step ${n}: the four labels in order`);
  }
  // a line that ends with a backslash (a break inside a list item) occurs in step 3 only, three times: the claims with a sentence to paste (not the Georgia claim, whose note stays empty)
  const breaks = page.split('\n').map((line, i) => ({ line, i })).filter(({ line }) => line.endsWith('\\'));
  const step3At = page.split('\n').findIndex((l) => l.startsWith('## Step 3'));
  const step4At = page.split('\n').findIndex((l) => l.startsWith('## Step 4'));
  assert.equal(breaks.length, 3);
  assert.ok(breaks.every(({ i }) => i > step3At && i < step4At));
  // the words that must not come back: Agent notes and the first build's name of the verified tags in the steps
  assert.ok(!/Agent notes/.test(page));
  assert.ok(!page.slice(0, page.indexOf('## Help')).includes('Claim quality tags'));
});

// ---- the checklists under a report (CLAIMS-REVIEW.md section 6.4) ------------------------------------------------------------------------------------------------

const SKILLS = join(REPO, '.claude', 'skills');
const GUIDE_FILE = join(SKILLS, 'claim-tagger', 'references', 'guide.md');

/** guide.md as { "Decide in Your queue": { Real: [{ n, text }], Demo: [...] }, ... }: the numbered lines under "Real:" and "Demo:" of each "## " section. */
function checklists() {
  const out = {};
  for (const section of readFileSync(GUIDE_FILE, 'utf8').replace(/\r\n?/g, '\n').split(/^## /m).slice(1)) {
    const [name, ...rest] = section.split('\n');
    const forms = {};
    let form = null;
    for (const line of rest) {
      const mark = /^(Real|Demo):$/.exec(line);
      if (mark) {
        form = mark[1];
        forms[form] = [];
        continue;
      }
      const item = /^(\d+)\. (.*)$/.exec(line);
      if (item && form) forms[form].push({ n: Number(item[1]), text: item[2] });
    }
    out[name.trim()] = forms;
  }
  return out;
}

/**
 * The table of guide.md ("The Next line says" | "Checklist"): [{ forms: [the texts in backticks of the first cell], checklist: 'Decide in Your queue', demoOnly: true when the second cell says Demo form }].
 * A form is a Next line without "Next: ", the link written as (link); what the first cell says outside the backticks (which command prints it) is for the reader.
 */
function guideTable() {
  const text = readFileSync(GUIDE_FILE, 'utf8').replace(/\r\n?/g, '\n');
  return text.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| The Next line says')).map((l) => {
    const [when, what] = l.split('|').slice(1, -1).map((c) => c.trim());
    const [checklist, ...rest] = what.split(', ');
    return { cell: when, forms: [...when.matchAll(/`([^`]+)`/g)].map((m) => m[1]), checklist, demoOnly: rest.includes('Demo form') };
  });
}

/**
 * What the guide picks for a report: { checklist, form } when the table lists its Next line, else null (a line that only names a command, or has nothing to type, gets no checklist).
 * The form is Demo when the report starts with "Demo · " or "Walkthrough:" (or the table says Demo form), else Real. The link becomes (link), and the claims that are left read as
 * "your four claims", the words of the table.
 */
function guideChecklistFor(sentence, next) {
  const form = next.replace(/^Next: /, '').replace(/\(https?:\/\/[^)]*\)/, '(link)').replace(/your remaining claims?/, 'your four claims').replace(/\.$/, '');
  const row = guideTable().find((r) => r.forms.includes(form));
  if (!row) return null;
  return { checklist: row.checklist, form: row.demoOnly || /^(?:Demo · |Walkthrough:)/.test(sentence) ? 'Demo' : 'Real' };
}

test('guide.md has the four checklists, each in a real and a demo form of at most five numbered lines, ending with the command to type', () => {
  const guide = checklists();
  const { manifest } = real();
  assert.deepEqual(Object.keys(guide).filter((n) => n !== 'How a checklist is added'), ['Decide in Your queue', 'Needs your note', 'Approve in Lessons waiting', 'After a FAIL', 'Agent disagreed']);
  const commands = { 'Decide in Your queue': 'distill', 'Needs your note': 'distill', 'Approve in Lessons waiting': 'promote', 'After a FAIL': 'promote', 'Agent disagreed': 'distill' };
  const demoSteps = { distill: manifest.steps[3].command, promote: manifest.steps[5].command };
  for (const [name, command] of Object.entries(commands)) {
    for (const form of ['Real', 'Demo']) {
      const list = guide[name][form];
      assert.ok(list && list.length >= 3 && list.length <= 5, `${name} (${form}): three to five lines, not ${list?.length}`);
      assert.deepEqual(list.map((i) => i.n), list.map((_, k) => k + 1), `${name} (${form}): numbered from 1`);
      const last = list.at(-1).text;
      if (form === 'Real') assert.match(last, new RegExp(`^(?:When [^,]+, t|T)ype /claim-tagger ${command}(?: again)?\\.$`), `${name}: the last line names the command`);
      else {
        assert.ok(last.includes(demoSteps[command]), `${name} (Demo): the last line types ${demoSteps[command]}, a command of the page's steps`);
        assert.match(last, /\/claim-tagger demo /);
      }
      assert.match(list[0].text, /^Open (?:Your queue|Needs your note|Lessons waiting|Agent disagreed) \(the link in the Next line\)/, `${name} (${form}): the first line opens the view of the Next line`);
      for (const item of list) assert.ok([...item.text].length <= 260, `${name} (${form}) line ${item.n} is short`);
      assert.ok(!/\b(?:minutes?|hours?|days?|weeks?|seconds?)\b/i.test(list.map((i) => i.text).join(' ')), `${name} (${form}): no durations`);
    }
  }
  // only a view the page has, and columns the tables have
  const structure = read(join(AGENT, 'setup', 'structure.json'));
  const columns = (table) => structure.tables[table].columns.map((c) => c.name);
  const text = Object.values(guide).flatMap((forms) => Object.values(forms).flat()).map((i) => i.text).join('\n');
  for (const name of ['Verified tags', 'Challenged tags notes', 'Review status', 'Agent reasons', 'Agent reading', 'Tags waiting', 'Agent confidence']) assert.ok(columns('claims_copy').includes(name), name);
  assert.ok(!/Why wrong/.test(text), 'no checklist names the column that said why the agent was wrong');
  for (const name of ['Current text', 'Proposed text', 'Editor wording', 'Status']) assert.ok(columns('rule_changes').includes(name), name);
  for (const view of text.match(/Open ([A-Z][A-Za-z ]+?) \(/g).map((m) => m.slice(5, -2))) assert.ok(Object.values(dp.VIEW_NAMES).includes(view), view);
});

test('the table of guide.md picks a checklist for every Next line that sends the editor to Notion, the Next lines of where included, and a Walkthrough: report takes the Demo form', () => {
  const guide = checklists();
  const table = guideTable();
  const names = Object.keys(guide).filter((n) => n !== 'How a checklist is added');
  assert.equal(table.length, 8, 'the five Next-line forms of the commands and the three that where adds');
  for (const row of table) {
    assert.ok(names.includes(row.checklist), `the checklist "${row.checklist}" is one of the guide's`);
    assert.ok(row.forms.length >= 1, 'every row lists the Next line in backticks');
  }
  // the rows of where: Demo form only, in the words of walkthrough.mjs; once some claims are decided the line reads "your remaining claims" ("your remaining claim" for the last one)
  assert.deepEqual(table.slice(5).map((r) => [r.forms, r.checklist, r.demoOnly]), [
    [['open Your queue (link) and decide your four claims'], 'Decide in Your queue', true],
    [['open Lessons waiting (link) and set Status to Approved'], 'Approve in Lessons waiting', true],
    [['open Lessons waiting (link) and write the rule as you want it in Editor wording'], 'After a FAIL', true],
  ]);
  assert.ok(table[5].cell.includes('your remaining claims') && table[5].cell.includes('your remaining claim"'), 'the table says what the line reads once some claims are decided');
  assert.ok(table.every((r) => r.cell.includes('(link)')));
  assert.ok(table.slice(0, 5).every((r) => !r.demoOnly), 'the commands\' own rows are picked by the prefix of the report, not by the table');
  // a Next line of where is found in the table, and its form comes from the prefix "Walkthrough:" of its sentence
  const link = 'https://www.notion.so/0123456789abcdef0123456789abcdef?v=fedcba9876543210fedcba9876543210';
  assert.deepEqual(guideChecklistFor('Walkthrough: you are at step 3, Decide your four claims.', `Next: add a note in Challenged tags notes on the claims in Agent disagreed (${link}).`), { checklist: 'Agent disagreed', form: 'Demo' });
  assert.deepEqual(guideChecklistFor('Demo · Follow-up: both claims fixed.', `Next: add a note in Challenged tags notes on the claims in Agent disagreed (${link}).`), { checklist: 'Agent disagreed', form: 'Demo' });
  assert.deepEqual(guideChecklistFor('Follow-up: 2 claims checked.', `Next: add a note in Challenged tags notes on the claims in Agent disagreed (${link}).`), { checklist: 'Agent disagreed', form: 'Real' });
  assert.equal(guideChecklistFor('Walkthrough: you are at step 4, x.', 'Next: type /claim-tagger demo distill.'), null);
  assert.equal(table[4].checklist, 'Agent disagreed');
  assert.match(table[4].forms[0], /^add a note in Challenged tags notes on the claims in Agent disagreed \(link\)$/);
  // the Needs your note row is the Next line that distill prints when a decision has no note and no rule change was drafted
  assert.equal(table[1].checklist, 'Needs your note');
  assert.match(table[1].forms[0], /^add a note on \.\.\. in Needs your note \(link\), then type \/claim-tagger distill again$/);
  // the prefixes: Demo · and Walkthrough: take the Demo list, anything else the real one
  const text = readFileSync(GUIDE_FILE, 'utf8').replace(/\r\n?/g, '\n');
  assert.match(text, /A report that starts with "Demo · " or with "Walkthrough:"[^\n]*takes the Demo list, whose command is `\/claim-tagger demo \.\.\.`; any other report takes the real list\./);
  assert.ok(!text.includes('A demo report starts with "Demo · "'), 'the old rule, that only Demo · picks the Demo list, is gone');
  // every list stays at five lines, and the table is no list
  for (const name of names) for (const form of ['Real', 'Demo']) assert.ok(guide[name][form].length <= 5, `${name} (${form})`);
  // and the skills say it too
  const ct = readFileSync(join(SKILLS, 'claim-tagger', 'SKILL.md'), 'utf8');
  const wt = readFileSync(join(SKILLS, 'claim-tagger-walkthrough', 'SKILL.md'), 'utf8');
  assert.match(ct, /"Demo · " or with "Walkthrough:"[^\n]*takes the demo form/);
  assert.match(wt, /A `W where` report starts with "Walkthrough:", not "Demo · ", and takes the Demo form all the same/);
});

test('the checklists name the columns of the practice page in the page\'s order: step 3\'s lists, step 5 and the FAIL text of step 6', () => {
  const guide = checklists();
  const { manifest, template } = real();
  const page = dp.pageModel(template.text, { edition: EDITION, date: dp.dateWord(NOW) }).rendered;
  const order = Object.keys(manifest.open[0].enter);
  assert.deepEqual(order, ['Verified tags', 'Challenged tags notes', 'Review status']);
  // the line of each Decide checklist that lists the columns: the three names, in the order of the page's lists
  const fillIn = (list) => list.find((i) => order.every((name) => i.text.includes(name))).text;
  for (const form of ['Real', 'Demo']) {
    const line = fillIn(guide['Decide in Your queue'][form]);
    const at = order.map((name) => line.indexOf(name));
    assert.ok(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), `${form}: ${order.join(', ')} in this order`);
  }
  assert.deepEqual(step3Lists(page).map((l) => l.items.map((i) => i.column)), [order, order, order, order], 'and the four lists of the page name them in the same order');
  // the reason word: the page, the checklists and the Help table say the same, and no checklist asks the editor for a reason
  assert.ok(guide['Decide in Your queue'].Real.some((i) => /Agent slip, Rule unclear or Rule should change and a full stop/.test(i.text)), 'the real list says what a reason word is');
  assert.ok(guide['Decide in Your queue'].Demo.some((i) => /step 3 of the practice page gives the values/.test(i.text)), 'the demo list sends the editor to the page for the values');
  for (const form of ['Real', 'Demo']) {
    const note = guide['Needs your note'][form];
    assert.match(note[0].text, /^Open Needs your note \(the link in the Next line\): the claims where you decided against the agent and wrote no note\.$/);
    assert.ok(note.some((i) => /Challenged tags notes for the tag: start with the tag name and a colon/.test(i.text)), `${form}: a line for the tag`);
    assert.ok(note.some((i) => /Agent slip, Rule unclear or Rule should change and a full stop/.test(i.text)), `${form}: the reason word, if known`);
    assert.match(note.at(-1).text, form === 'Real' ? /^When the notes are in, type \/claim-tagger distill again\.$/ : /^When the notes are in, type \/claim-tagger demo distill again\.$/);
  }
  // the Agent disagreed lists say that the agent's reading is in the Agent reading column
  for (const form of ['Real', 'Demo']) assert.ok(guide['Agent disagreed'][form].some((i) => /^Read Agent reasons and Agent reading next to your Verified tags and Challenged tags notes/.test(i.text)), form);
  assert.match(guide['Decide in Your queue'].Demo[2].text, /Review status to Reviewed last/);
  assert.match(page, /Review status comes last only because it closes the claim/);
  assert.match(guide['Decide in Your queue'].Demo[3].text, /stays in Your queue until the agent reads it again/);
  // Lessons waiting: step 5 of the page says the same things in the same words
  const step5 = page.slice(page.indexOf('## Step 5'), page.indexOf('## Step 6'));
  for (const phrase of ['Current text', 'Proposed text', 'Editor wording', 'Status to Approved']) {
    assert.ok(step5.includes(phrase), `step 5: ${phrase}`);
    assert.ok(guide['Approve in Lessons waiting'].Demo.some((i) => i.text.includes(phrase)), `the Approve checklist: ${phrase}`);
  }
  assert.ok(guide['Approve in Lessons waiting'].Demo.some((i) => i.text.includes('your wording is tested instead of the draft')) && step5.includes('your wording is tested instead of the draft'));
  // a FAIL: step 6 of the page puts the whole text into Editor wording, or rejects
  const fail = page.slice(page.indexOf('**If it does not pass.**'), page.indexOf('## Step 7'));
  for (const phrase of ['Editor wording', 'Rejected', 'Lessons waiting']) {
    assert.ok(fail.includes(phrase), `step 6: ${phrase}`);
    assert.ok(guide['After a FAIL'].Demo.some((i) => i.text.includes(phrase)), `the FAIL checklist: ${phrase}`);
  }
  assert.ok(guide['After a FAIL'].Demo.some((i) => i.text.includes('the demo ends here')) && fail.includes('the demo ends here'));
  // Agent disagreed: the view the page names in step 7
  assert.match(page.slice(page.indexOf('## Step 7')), /would show up in Agent disagreed/);
});

test('the skills relay the report first and add the checklist under it: the rule is in both SKILL.md files, and the examples show a report followed by its checklist once', () => {
  const ct = readFileSync(join(SKILLS, 'claim-tagger', 'SKILL.md'), 'utf8');
  const wt = readFileSync(join(SKILLS, 'claim-tagger-walkthrough', 'SKILL.md'), 'utf8');
  for (const [name, text] of [['claim-tagger', ct], ['claim-tagger-walkthrough', wt]]) {
    assert.match(text, /references\/guide\.md/, `${name} names the guide`);
    assert.match(text, /verbatim/, name);
    assert.match(text, /checklist/, name);
    assert.match(text, /at most five lines/, name);
    assert.ok(!text.includes('Claim quality tags — verified'), `${name}: the column is Verified tags`);
  }
  assert.match(ct, /Your final message starts with that printed report, verbatim and complete, with no word before it/);
  assert.match(ct, /one checklist follows it/);
  assert.match(ct, /Never add a checklist the guide does not have/);
  assert.match(wt, /Demo form/);
  assert.match(wt, /`W where`/);
  // the examples: the same file in both skills, with the demo tag report and its Demo checklist once
  const examples = readFileSync(join(SKILLS, 'claim-tagger', 'references', 'report-examples.md'), 'utf8');
  assert.equal(readFileSync(join(SKILLS, 'claim-tagger-walkthrough', 'references', 'report-examples.md'), 'utf8'), examples, 'the two copies are the same');
  const demo = checklists()['Decide in Your queue'].Demo.map((i) => `${i.n}. ${i.text}`).join('\n');
  assert.equal(examples.split(demo).length - 1, 1, 'the checklist is shown once');
  const before = examples.slice(0, examples.indexOf(demo));
  assert.ok(before.endsWith('Next: decide your four claims in Your queue (link).\n\n'), 'right under the Next line of the report, after one blank line');
  assert.ok(before.includes('Demo · Tag: the agent read 9 claims for Context-dependent; 4 wait for you'));
  assert.ok(examples.slice(examples.indexOf(demo) + demo.length).startsWith('\n\n### '), 'and the next example follows it');
  assert.ok(!examples.includes('Agent notes'));
});

// ---- the seven steps on the fakes (READ-DECISIONS.md, decisions 73 to 76) ----------------------------------------------------------------------------------------
//
// A practice page is built on the fake Notion, and the loop scripts run in-process against it with the fake CLI: the tag step (pull, judge, propose), the editor deciding the four claims
// (decide), distill (the reading of the decisions, then one rule change), the editor approving it (approve), promote (the safety check, then the follow-up) and where. The fake CLI
// reads the press pool and the AI Force row as Rule unclear on rule 3 (FAKE_CLAUDE_READINGS) and answers every claim as the story expects.

const STORY_NOTES = {
  presspool: 'The rule does not say if a standing group counts.',
  aiforce: 'The rule does not say if an unknown name is a kind.',
};
const STORY_TEXT = 'A descriptive definite that names a kind of thing but not which one makes the claim Context-dependent: the reader must already know which one is meant. A group readers know by its standing role, such as a press corps, counts as identified; a capitalised phrase that names no body readers know does not.';
const STORY_MARK = 'counts as identified; a capitalised phrase that names no body readers know does not';
const STORY_LESSON = 'Known groups count as identified, unknown names do not';

/** The fake CLI's answers for the practice page's story: the story's claims, the examples and the earlier decisions, in files of a temporary folder; returns the environment of the fake. */
function storyEnv(manifest, { readings = {} } = {}) {
  const dir = tmp('story');
  const put = (name, value) => {
    const file = join(dir, name);
    writeFileSync(file, JSON.stringify(value));
    return file;
  };
  const yes = (extra = {}) => ({ decision: 'apply', p: 0.9, ...extra });
  const no = (extra = {}) => ({ decision: 'do_not_apply', p: 0.1, ...extra });
  const textOf = (key) => normalizeClaim(manifest.claims.find((c) => c.key === key)['Geo Name']);
  const table = {};
  for (const c of manifest.canaries) table[normalizeClaim(c.claim)] = c.expected === 'apply' ? yes() : no();
  // the five earlier decisions: the agent agrees with each (cnn and dallas have the tag)
  for (const d of manifest.decided) table[textOf(d.claim)] = d['Verified tags'].length ? yes() : no();
  // the claims of the editor: the press pool and USPS read Applies at 0.8 and 0.9 (the editor says no tag), the AI Force Can't tell, Georgia Does not apply (the editor agrees)
  table[textOf('presspool')] = yes({ p: 0.8, rule_ref: 'Context-dependent rule 3', reason: '"the press pool": which one?' });
  table[textOf('aiforce')] = { decision: 'ask_editor', p: 0.5, rule_ref: null, reason: 'A name, or a kind?' };
  table[textOf('usps')] = yes({ rule_ref: 'Context-dependent rule 3', reason: '"the USPS portal": which one?' });
  table[textOf('georgia')] = no({ reason: 'It names its place and its office.' });
  // under the candidate rule 3 (the text that holds STORY_MARK) the press pool and the AI Force claim come out as the editor decided; USPS stays wrong, Georgia stays right
  const overrides = [{ when: STORY_MARK, table: { [textOf('presspool')]: no(), [textOf('aiforce')]: yes() } }];
  const distillReply = { patterns: [{ lesson: STORY_LESSON, kind: 'Clarify wording', proposed_text: STORY_TEXT, keys: 'all' }] };
  const keyOf = (key) => `${manifest.claims.find((c) => c.key === key)['Geo ID']}::${TAG}`;
  const fakeReadings = {
    [keyOf('presspool')]: { reading: 'Rule unclear', rule: 'Context-dependent rule 3', note: STORY_NOTES.presspool },
    [keyOf('aiforce')]: { reading: 'Rule unclear', rule: 'Context-dependent rule 3', note: STORY_NOTES.aiforce },
    ...readings,
  };
  return {
    FAKE_CLAUDE_TABLE: put('table.json', table),
    FAKE_LOOP_OVERRIDES: put('overrides.json', overrides),
    FAKE_LOOP_DISTILL: put('distill.json', distillReply),
    FAKE_CLAUDE_READINGS: put('readings.json', fakeReadings),
    FAKE_LOOP_DEFAULT: JSON.stringify(no()),
  };
}

/** The hooks every loop script takes, on the practice page of `w`: its state folder, the fake Notion, the fake CLI, the fixed clock, no commit. */
function loopHooks(w, state, env, extra = {}) {
  return {
    root: w.dir(), fetchImpl: w.fake.fetchImpl, token: w.fake.token, sleep: noSleep, now: () => w.clock, io: quietIo(), driver: 'fake', fakeScript: FAKE_SCRIPT, fakeState: state, env: { ...process.env, ...env }, noCommit: true, ...extra,
  };
}

const callsWith = (state, text) => (state.log ?? []).filter((c) => c.systemPromptFile && readFileSync(c.systemPromptFile, 'utf8').includes(text));

test('the seven steps on the fakes: the four claims are decided, distill reads three decisions with one call and drafts one rule change that rests on the press pool and the AI Force claim, the safety check passes, the follow-up fixes those two rows and not USPS or Georgia, and where says complete', async () => {
  const w = newWorld();
  const { manifest } = real();
  assert.equal((await w.start()).code, 0);
  const state = {};
  const env = storyEnv(manifest);
  const hooks = (extra) => loopHooks(w, state, env, extra);
  const claimOf = (key) => manifest.claims.find((c) => c.key === key);
  const keyOf = (key) => `${claimOf(key)['Geo ID']}::${TAG}`;
  const claimRow = (key) => w.rowBy('claims_copy', 'Geo ID', claimOf(key)['Geo ID']);
  const ledgerRow = (key) => w.rowBy('tag_decisions', 'Key', keyOf(key));
  const open = manifest.open.map((o) => o.claim);
  const decidedKeys = manifest.decided.map((d) => d.claim);
  const whereLine = async () => (await w.run(['where'])).out.split('\n')[0];

  // step 1 and 2: a fresh page, then the tag step (pull, judge, propose)
  assert.equal(JSON.parse((await w.run(['verify', '--json'])).out).ok, true);
  assert.match(await whereLine(), /step 1,/);
  const pulled = await pull({ root: w.dir(), tables: 'all', fetchImpl: w.fake.fetchImpl, token: w.fake.token, sleep: noSleep, now: () => w.clock });
  assert.equal(pulled.code, 0);
  const judged = await judge({ root: w.dir(), driver: 'fake', items: 'claims', io: quietIo(), env: hooks().env, fakeState: state, fakeScript: FAKE_SCRIPT, sleep: noSleep, now: () => w.clock });
  assert.equal(judged.exit, 0);
  const tagged = await propose(hooks());
  assert.equal(tagged.exit, 0, tagged.markdown);
  assert.ok(tagged.markdown.startsWith('Demo · Tag: '));
  assert.match(tagged.report.sentence, /^Tag: the agent read 9 claims for Context-dependent; 4 wait for you \(practice page /);
  assert.equal(tagged.report.next, `Next: decide your four claims in Your queue (${w.demo().views.your_queue.url}).`);
  for (const key of open) {
    assert.equal(claimRow(key)['Agent status'], 'Waits for you', `${key}: To review, so it waits whatever the agent reads`);
    assert.ok(!claimRow(key)['Agent reading'], `${key}: nothing has read the decision yet`);
  }
  assert.deepEqual(open.map((k) => ledgerRow(k)['Agent proposal']), ['Applies', "Can't tell", 'Applies', 'Does not apply']);
  for (const key of decidedKeys) assert.equal(claimRow(key)['Agent reading'], SEEDED_LINE, `${key}: the tag step leaves the seeded reading alone`);
  const [sentence3, next3] = (await w.run(['where'])).out.split('\n\n');
  assert.match(sentence3, /step 3,/);
  assert.equal(next3, `Next: open Your queue (${w.demo().views.your_queue.url}) and decide your four claims.`);
  assert.equal(guideChecklistFor(sentence3, next3)?.checklist, 'Decide in Your queue');

  // step 3: the editor decides the four claims, with the values of the page (USPS with the reason word in the note, Georgia with an empty note)
  for (const key of open) assert.equal((await w.run(['decide', '--claim', key])).code, 0, key);
  assert.deepEqual(['usps', 'georgia'].map((k) => claimRow(k)['Challenged tags notes'] ?? ''), ['Agent slip. USPS names which portal, so rule 5 already settles it.', '']);
  assert.match(await whereLine(), /step 4,/);
  // status: the four decisions wait for the agent's next run, three of them are still to read (Georgia agrees with the agent: nothing to read), and distill is the next thing to type
  const midway = await status(hooks());
  assert.equal(midway.exit, 0);
  assert.deepEqual(midway.report.rows.find((r) => r[0] === 'Your queue').slice(0, 2), ['Your queue', "4 rows decided, waiting for the agent's next run"]);
  assert.deepEqual(midway.report.rows.find((r) => r[0] === 'Your decisions')?.slice(0, 2), ['Your decisions', '3 to read'], 'the decisions to read, as status counts them');
  assert.match(midway.report.next, /^Next: type \/claim-tagger demo distill/);

  // step 4: distill reads the decisions
  const first = hooks();
  const drafted = await distill(first);
  assert.equal(drafted.exit, 0, `${first.io.errs.join('\n')}\n${drafted.markdown}`);
  assert.ok(drafted.markdown.startsWith('Demo · Distill: '));
  assert.match(drafted.report.sentence, /^Distill: read 3 of your decisions and drafted one rule change from your 2 notes \(practice page /);
  assert.deepEqual(drafted.report.rows, [
    ['Read', '3 decisions', ''], ['Point at a rule', '2 decisions', ''], ['Agent slips', '1 decision', ''], ['Without a note', 'none', ''],
    ['Rule change', `"${STORY_LESSON}", Context-dependent rule 3`, ''],
  ]);
  assert.match(drafted.report.next, /^Next: read it in Lessons waiting \(/);
  assert.equal(callsWith(state, '# Reading').length, 1, 'one reading call: the press pool and the AI Force row; USPS is read from its reason word and Georgia has nothing to read');
  assert.equal(callsWith(state, '# Distill').length, 1);
  // the readings: three on the ledger, two from the model and USPS verbatim, and none on Georgia
  const press = ledgerRow('presspool');
  const force = ledgerRow('aiforce');
  const usps = ledgerRow('usps');
  const georgia = ledgerRow('georgia');
  for (const [row, key] of [[press, 'presspool'], [force, 'aiforce']]) {
    assert.deepEqual([row['Agent reading'], row.Rule, row['Reading note']], ['Rule unclear', 'Context-dependent rule 3', STORY_NOTES[key]], key);
    assert.match(row['Read under'], new RegExp(`^${EDITION.replace('.', '\\.')} · [0-9a-f]{8}$`), key);
  }
  assert.deepEqual([usps['Agent reading'], usps.Rule, usps['Reading note'], usps['Why wrong'], usps['Tag outcome']], ['Agent slip', 'Context-dependent rule 5', 'Your note says so.', 'Agent slip', 'Does not apply'], 'USPS: the reason word of the note, taken as it stands');
  assert.ok(READING_COLUMNS.every((c) => !georgia[c]), 'Georgia: the agent agreed, so there is nothing to read and no reading column');
  assert.equal(georgia['Tag outcome'], 'Does not apply');
  // the same lines the page shows in step 4, as the claims hold them
  const { template } = real();
  const page = dp.pageModel(template.text, { edition: EDITION, date: dp.dateWord(NOW) }).rendered;
  const step4 = page.slice(page.indexOf('## Step 4'), page.indexOf('## Step 5'));
  const shown = Object.fromEntries(step4.split('\n').filter((l) => l.startsWith('|')).map((l) => l.split('|').slice(1, -1).map((c) => c.trim())).filter((r) => r.length === 2 && manifest.claims.some((c) => c.short === r[0])).map((r) => [manifest.claims.find((c) => c.short === r[0]).key, r[1]]));
  for (const key of open) assert.equal(claimRow(key)['Agent reading'], shown[key], `${key}: the Agent reading line is the one the page shows`);
  assert.equal(claimRow('presspool')['Agent reading'], `${TAG}: Rule unclear, rule 3 · ${STORY_NOTES.presspool}`);
  assert.equal(claimRow('usps')['Agent reading'], `${TAG}: Agent slip, rule 5 · Your note says so.`);
  assert.equal(claimRow('georgia')['Agent reading'], 'Nothing to read: the agent agreed with you.');
  for (const key of decidedKeys) assert.equal(claimRow(key)['Agent reading'], SEEDED_LINE, `${key}: distill changes nothing on the seeded claims`);
  for (const key of decidedKeys) assert.deepEqual([ledgerRow(key)['Agent reading'], ledgerRow(key)['Reading note']], ['Agent slip', SEEDED], `${key}: and nothing on their ledger rows`);
  // the readings of the run, and the counts the manifest expects
  const runDir = join(w.dir(), 'runs', readdirSync(join(w.dir(), 'runs')).filter((n) => n.endsWith('-distill')).sort().at(-1));
  const made = lines(join(runDir, 'readings.jsonl'));
  assert.equal(made.length, manifest.expect.readings.read);
  assert.equal(made.filter((l) => l.source === 'verbatim').length, manifest.expect.readings.verbatim);
  assert.equal(made.filter((l) => l.source === 'model').length, manifest.expect.readings.read - manifest.expect.readings.verbatim);
  assert.equal(lines(join(runDir, 'calls.jsonl')).filter((c) => c.purpose === 'reading').length, manifest.expect.readings.model_calls);
  assert.equal(manifest.expect.readings.agree, 1);
  assert.deepEqual(made.map((l) => l.reading).sort(), ['Agent slip', 'Rule unclear', 'Rule unclear']);
  for (const o of manifest.open.filter((x) => x.expect_reading.source !== 'none')) {
    const line = made.find((l) => l.key === keyOf(o.claim));
    assert.ok(o.expect_reading.reading.includes(line.reading), `${o.claim}: ${line.reading} is a reading the manifest accepts`);
    assert.equal(line.rule, `${TAG} rule ${o.expect_reading.rule}`, o.claim);
    assert.equal(line.source, o.expect_reading.source, o.claim);
  }
  // one rule change, on rule 3, derived as Clarify wording, resting on the press pool and the AI Force claim only
  const lesson = w.rows('rule_changes').find((r) => r.Lesson === STORY_LESSON);
  assert.deepEqual([lesson.Status, lesson.Rule, lesson.Kind], ['Proposed', manifest.expect.lesson_rule, 'Clarify wording']);
  assert.equal(w.rows('rule_changes').length, 1);
  const supporting = (lesson['Supporting rows'] ?? '').split('\n').map((l) => l.split(' · ').at(-1));
  assert.deepEqual(supporting.sort(), [keyOf('presspool'), keyOf('aiforce')].sort(), 'the draft rests on the two rule readings; the USPS slip and the Georgia agreement are not among its rows');
  assert.match(await whereLine(), /step 5,/);
  // status after the reading: nothing is left to read, two decisions point at a rule, and the rule change waits for the editor
  const read = await status(hooks());
  assert.deepEqual(read.report.rows.find((r) => r[0] === 'Your decisions')?.slice(0, 2), ['Your decisions', '2 point at a rule']);
  assert.match(read.report.next, /Lessons waiting/);
  // a second distill asks the model nothing: every reading is current
  const again = hooks();
  const second = await distill(again);
  assert.equal(second.exit, 0, again.io.errs.join('\n'));
  assert.equal(callsWith(state, '# Reading').length, 1, 'no second reading call');
  assert.equal(w.rows('rule_changes').length, 1, 'and no second rule change');
  assert.match(second.report.sentence, /^Distill: nothing new to read; no rule change to draft; the rules the rows point at already have a rule change waiting/);

  // step 5 and 6: the editor approves the draft, promote runs the safety check
  assert.equal((await w.run(['approve'])).code, 0);
  assert.match(await whereLine(), /step 6,/);
  const passed = await promote(hooks({ lesson: STORY_LESSON }));
  assert.equal(passed.exit, 0, passed.markdown);
  assert.ok(passed.markdown.startsWith('Demo · Promote: '));
  assert.match(passed.report.sentence, /^Promote: PASS, rule 3 now uses the new wording \(edition 2026-10-15\.2\), and the follow-up marked both of your rows Fixed \(practice page /);
  assert.deepEqual(passed.report.rows, [['Example claims', '10 of 10 right', ''], ['Earlier decisions', '6 of 6 still right', ''], ['Your 2 rows', '2 of 2 now right, marked Fixed', '']]);
  assert.match(passed.report.next, /^Next: look at step 7 on the practice page \(/);
  // the result the page shows in step 6 is the one the check wrote
  const result = w.rows('rule_changes').find((r) => r.Lesson === STORY_LESSON)['Safety check result'];
  assert.equal(result, 'PASS: examples 10/10, earlier 6/6, yours 2/2');
  assert.ok(page.includes(`| ${STORY_LESSON} | Live | ${result} |`) || page.includes(`| Known groups count as identified, unknown names do not | Live | ${result} |`), 'step 6 of the page shows this result');
  assert.equal(w.rows('rule_changes').find((r) => r.Lesson === STORY_LESSON).Status, 'Live');

  // step 7: the follow-up marked the two rule rows Fixed, and neither USPS nor Georgia; those two still wait for the next tag run
  assert.deepEqual(open.map((k) => ledgerRow(k)['Follow-up'] ?? null), ['Fixed', 'Fixed', null, null]);
  for (const key of ['presspool', 'aiforce']) assert.deepEqual([claimRow(key)['Agent status'], claimRow(key)['Agent edition']], ['Done', '2026-10-15.2'], `${key}: read again under the new rule`);
  for (const key of ['usps', 'georgia']) assert.deepEqual([claimRow(key)['Agent status'], claimRow(key)['Agent edition']], ['Waits for you', EDITION], `${key}: not part of the change, so it keeps Waits for you and the edition of the tag step`);
  assert.deepEqual(claimRow('aiforce')['Agent tags'].map(dashless), [dashless(w.rows('rulebook')[0].page_id)]);
  assert.deepEqual(claimRow('presspool')['Agent tags'], []);
  // after the promote nothing is to read (the key of a reading holds the edition of the proposal), so step 7's status has no Your decisions row
  const after = await status(hooks());
  assert.equal(after.report.rows.find((r) => r[0] === 'Your decisions'), undefined, 'no Your decisions row once the rows the change rests on are Fixed and nothing else is to read');
  const last = await w.run(['where']);
  assert.equal(last.code, 0, last.err);
  assert.equal(last.out.split('\n')[0], 'Walkthrough: you have been through all seven steps of the practice page.');
  assert.equal(guideChecklistFor(last.out.split('\n')[0], last.out.split('\n').at(-1)), null);
  // the page is still as it was built where it should be, and every report the run wrote passes the report lint
  const verified = JSON.parse((await w.run(['verify', '--json'])).out);
  assert.deepEqual(verified.problems, []);
  const runs = join(w.dir(), 'runs');
  const reports = readdirSync(runs, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(runs, d.name, 'report.md')));
  assert.ok(reports.length >= 8);
  for (const d of reports) assert.deepEqual(lintReport(readFileSync(join(runs, d.name, 'report.md'), 'utf8')), [], d.name);
});

test('a decision without a note is read all the same, flagged "without your note" on the claim, and distill sends the editor to Needs your note; a note then takes the reading by its reason word without a call', async () => {
  const w = newWorld();
  const { manifest } = real();
  assert.equal((await w.start()).code, 0);
  const state = {};
  const env = storyEnv(manifest, {});
  const hooks = (extra) => loopHooks(w, state, env, extra);
  const claimOf = (key) => manifest.claims.find((c) => c.key === key);
  const keyOf = (key) => `${claimOf(key)['Geo ID']}::${TAG}`;
  const claimRow = (key) => w.rowBy('claims_copy', 'Geo ID', claimOf(key)['Geo ID']);
  const ledgerRow = (key) => w.rowBy('tag_decisions', 'Key', keyOf(key));
  assert.equal((await pull({ root: w.dir(), tables: 'all', fetchImpl: w.fake.fetchImpl, token: w.fake.token, sleep: noSleep, now: () => w.clock })).code, 0);
  assert.equal((await judge({ root: w.dir(), driver: 'fake', items: 'claims', io: quietIo(), env: hooks().env, fakeState: state, fakeScript: FAKE_SCRIPT, sleep: noSleep, now: () => w.clock })).exit, 0);
  assert.equal((await propose(hooks())).exit, 0);
  // the editor decides the USPS claim with no note on purpose (decide --outcome alone writes an empty note); the model reads it, and the flag is set in code
  const usps = keyOf('usps');
  const readingsFile = JSON.parse(readFileSync(env.FAKE_CLAUDE_READINGS, 'utf8'));
  readingsFile[usps] = { reading: 'Agent slip', rule: 'Context-dependent rule 3', note: 'The portal is named in the claim.' };
  writeFileSync(env.FAKE_CLAUDE_READINGS, JSON.stringify(readingsFile));
  assert.equal((await w.run(['decide', '--claim', 'usps', '--outcome', 'Does not apply'])).code, 0);
  const one = hooks();
  const first = await distill(one);
  assert.equal(first.exit, 0, `${one.io.errs.join('\n')}\n${first.markdown}`);
  assert.ok(first.markdown.startsWith('Demo · Distill: '));
  assert.match(first.report.sentence, /^Distill: read 1 of your decisions; no rule change to draft; .*\(practice page /);
  assert.deepEqual(first.report.rows.slice(0, 4), [['Read', '1 decision', ''], ['Point at a rule', 'none', ''], ['Agent slips', '1 decision', ''], ['Without a note', '1 decision', '']]);
  assert.match(first.report.next, /^Next: add a note on 1 claim in Needs your note \(https:\/\/[^)]+\), then type \/claim-tagger demo distill again\.$/);
  assert.deepEqual([ledgerRow('usps')['Agent reading'], ledgerRow('usps').Rule, ledgerRow('usps')['Reading note']], ['Agent slip', 'Context-dependent rule 3', 'without your note · The portal is named in the claim.']);
  assert.equal(claimRow('usps')['Agent reading'], `${TAG}: Agent slip, rule 3, without your note · The portal is named in the claim.`);
  assert.equal(callsWith(state, '# Reading').length, 1);
  // the editor adds the reason word: the row is read again from the note, with no call
  w.fake.editRow(claimRow('usps').page_id, { 'Challenged tags notes': manifest.open.find((o) => o.claim === 'usps').enter['Challenged tags notes'] });
  const two = hooks();
  const second = await distill(two);
  assert.equal(second.exit, 0, two.io.errs.join('\n'));
  assert.equal(callsWith(state, '# Reading').length, 1, 'the reason word is taken as it stands: no second call');
  assert.deepEqual([ledgerRow('usps')['Agent reading'], ledgerRow('usps').Rule, ledgerRow('usps')['Reading note']], ['Agent slip', 'Context-dependent rule 5', 'Your note says so.']);
  assert.equal(claimRow('usps')['Agent reading'], `${TAG}: Agent slip, rule 5 · Your note says so.`);
});
