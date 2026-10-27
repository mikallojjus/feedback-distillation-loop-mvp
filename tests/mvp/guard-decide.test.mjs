import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../../agents/claim-tagger-mvp/scripts/hooks/guard.mjs';
import { codeRoot } from '../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';
import { placeholderConfig } from './helpers/config-fixture.mjs';

// The one exception to the editor-column rule of the connector guard (decisions P18 to P20 and 114): an editor's Claude may decide claims. A notion-update-page call that sets only
// some of the three Claims editor columns is allowed when a live runs/DECIDING (written by decide.mjs open, younger than two hours) lists the page. The rest of the hook is tested in
// guard.test.mjs and stays as it was.

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function rootWith(config) {
  const root = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-guard-decide-'));
  dirs.push(root);
  if (config !== null) writeFileSync(join(root, 'config.json'), JSON.stringify(config));
  mkdirSync(join(root, 'runs'), { recursive: true });
  return root;
}

const NOW = Date.parse('2026-10-27T12:00:00.000Z');
const PAGE = '0a9e0000-0000-4000-8000-0000000000d1';
const hexOf = (id) => id.replace(/-/g, '');
const THREE = { 'Verified tags': [hexOf('0a9e0000-0000-4000-8000-0000000000a1')], 'Challenged tags notes': 'Context-dependent: Agent slip. The title names it.', 'Review status': 'Reviewed' };
const decision = (properties = THREE, extra = {}, page = PAGE) => ({ tool_name: 'mcp__notion__notion-update-page', tool_input: { page_id: page, command: 'update_properties', properties, ...extra } });
function open(root, { pages = [PAGE], at = NOW - 10 * 60e3, where = join(root, 'runs'), content } = {}) {
  mkdirSync(where, { recursive: true });
  writeFileSync(join(where, 'DECIDING'), content ?? `${JSON.stringify({ run_id: 'r1', opened_at: new Date(at).toISOString(), page_ids: pages.map(hexOf), root })}\n`);
}
const verdict = (input, root) => decide(input, root, { now: NOW });

test('the three Claims columns, or some of them, on a page that a live marker lists, are allowed', () => {
  const root = rootWith(placeholderConfig());
  open(root);
  assert.equal(verdict(decision(), root).permissionDecision, 'allow');
  assert.match(verdict(decision(), root).permissionDecisionReason, /open decide run/);
  assert.equal(verdict(decision({ 'Review status': 'Reviewed' }), root).permissionDecision, 'allow');
  assert.equal(verdict(decision({ 'Review status': 'To review' }), root).permissionDecision, 'allow', 'Reviewed and To review are the two values');
  assert.equal(verdict(decision({ 'Verified tags': [] }), root).permissionDecision, 'allow', 'a decision with no verified tag');
  assert.equal(verdict(decision(THREE, { allow_async: false }), root).permissionDecision, 'allow', 'allow_async is the one flag the connector call may carry');
  assert.equal(verdict(decision({ 'verified tags': [], 'REVIEW STATUS': 'Reviewed' }), root).permissionDecision, 'allow', 'letter case does not matter');
});

test('a note-only write and a tags-only write, each with Review status (P24), on a page that a live marker lists, are allowed; the note alone too', () => {
  const root = rootWith(placeholderConfig());
  open(root);
  const note = 'Context-dependent: Agent slip. The title names it.';
  const noteOnly = { 'Challenged tags notes': note, 'Review status': 'Reviewed' };
  const tagsOnly = { 'Verified tags': [hexOf('0a9e0000-0000-4000-8000-0000000000a1')], 'Review status': 'Reviewed' };
  for (const properties of [noteOnly, tagsOnly, { 'Challenged tags notes': note }, { 'Challenged tags notes': '', 'Review status': 'Reviewed' }]) {
    const d = verdict(decision(properties), root);
    assert.equal(d.permissionDecision, 'allow', JSON.stringify(properties));
    assert.match(d.permissionDecisionReason, /open decide run/);
  }
  assert.equal(verdict(decision(noteOnly, { allow_async: false }), root).permissionDecision, 'allow', 'with the one flag the printed call carries');
  // the page still has to be the one the marker lists, and the note is no way round the other rules
  assert.equal(verdict(decision(noteOnly, {}, '0a9e0000-0000-4000-8000-0000000000e1'), root).permissionDecision, 'deny');
  assert.equal(verdict(decision({ ...noteOnly, 'Agent reading': 'x' }), root).permissionDecision, 'deny');
  assert.equal(verdict(decision({ 'Challenged tags notes': note, 'Review status': 'Approved' }), root).permissionDecision, 'deny');
});

test('the page_id may be 32 hex digits, a dashed id or a notion.so address', () => {
  const root = rootWith(placeholderConfig());
  open(root);
  for (const page of [hexOf(PAGE), PAGE, PAGE.toUpperCase(), `https://www.notion.so/${hexOf(PAGE)}`, `https://www.notion.so/Some-claim-title-${hexOf(PAGE)}?pvs=4`, `https://app.notion.com/p/Some-claim-${hexOf(PAGE)}`, `https://www.notion.so/workspace/${PAGE}#x`]) {
    assert.equal(verdict(decision(THREE, {}, page), root).permissionDecision, 'allow', page);
  }
  for (const page of ['', 'x', hexOf(PAGE).slice(1), `${hexOf(PAGE)}a`, `a${hexOf(PAGE)}`, 'https://www.notion.so/', '0a9e0000-0000-4000-8000-0000000000d2', undefined]) {
    const input = decision(THREE, {}, page);
    if (page === undefined) delete input.tool_input.page_id;
    assert.equal(verdict(input, root).permissionDecision, 'deny', String(page));
  }
});

test('S4: every page id found anywhere in page_id must be the listed one, and there must be one', () => {
  const root = rootWith(placeholderConfig());
  open(root);
  const OTHER = '0a9e0000-0000-4000-8000-0000000000e7';
  // the listed id twice is still the listed id
  assert.equal(verdict(decision(THREE, {}, `https://www.notion.so/${hexOf(PAGE)}?p=${PAGE}`), root).permissionDecision, 'allow');
  // a second id that the marker does not list, in the path, in the title slug position or in the query: refused, whichever the connector would take
  for (const page of [
    `https://www.notion.so/${hexOf(OTHER)}?p=${hexOf(PAGE)}`, `https://www.notion.so/Title-${hexOf(PAGE)}?p=${hexOf(OTHER)}`, `https://www.notion.so/${OTHER}/${hexOf(PAGE)}`,
    `https://www.notion.so/Title-${hexOf(OTHER)}-${hexOf(PAGE)}`, `${hexOf(PAGE)},${hexOf(OTHER)}`,
  ]) {
    const d = verdict(decision(THREE, {}, page), root);
    assert.equal(d.permissionDecision, 'deny', page);
    assert.match(d.permissionDecisionReason, /is not listed by an open decide run/, page);
  }
  // no id at all
  for (const page of ['https://www.notion.so/Title-only', 'not an id', '12345678-1234']) assert.equal(verdict(decision(THREE, {}, page), root).permissionDecision, 'deny', page);
  assert.match(verdict(decision(THREE, {}, 'not an id'), root).permissionDecisionReason, /not a page id or a notion\.so address/);
});

test('G22: the marker may list its ids with dashes or in capitals; they are read as the same page', () => {
  const root = rootWith(placeholderConfig());
  mkdirSync(join(root, 'runs'), { recursive: true });
  writeFileSync(join(root, 'runs', 'DECIDING'), `${JSON.stringify({ run_id: 'r1', opened_at: new Date(NOW - 60e3).toISOString(), page_ids: [PAGE.toUpperCase(), `https://www.notion.so/Some-title-${hexOf('0a9e0000-0000-4000-8000-0000000000d3')}`], root })}\n`);
  assert.equal(verdict(decision(), root).permissionDecision, 'allow');
  assert.equal(verdict(decision(THREE, {}, hexOf(PAGE)), root).permissionDecision, 'allow');
  assert.equal(verdict(decision(THREE, {}, '0a9e0000-0000-4000-8000-0000000000d3'), root).permissionDecision, 'allow');
});

test('S5: a folder named like a marker is not a marker: the decide allowance and the builder session both need a regular file', () => {
  const root = rootWith(placeholderConfig());
  mkdirSync(join(root, 'runs', 'DECIDING'), { recursive: true });
  writeFileSync(join(root, 'runs', 'DECIDING', 'x'), 'x');
  assert.equal(verdict(decision(), root).permissionDecision, 'deny', 'DECIDING as a folder');
  const demo = rootWith(placeholderConfig());
  mkdirSync(join(demo, 'runs', 'demos', 'p1', 'runs', 'DECIDING'), { recursive: true });
  assert.equal(verdict(decision(), demo).permissionDecision, 'deny', 'DECIDING as a folder in a practice page');

  const setup = rootWith(placeholderConfig());
  const content = { tool_name: 'mcp__notion__notion-update-page', tool_input: { page_id: '0a9e0000-0000-4000-8000-000000000001', command: 'replace_content', new_str: 'x' } };
  mkdirSync(join(setup, 'runs', 'builder'), { recursive: true });
  writeFileSync(join(setup, 'runs', 'builder', 'pages.json'), JSON.stringify({ pages: ['0a9e0000-0000-4000-8000-000000000001'] }));
  mkdirSync(join(setup, 'runs', 'SETUP'), { recursive: true });
  const folder = verdict(content, setup);
  assert.equal(folder.permissionDecision, 'deny', 'SETUP as a folder is no builder session');
  assert.match(folder.permissionDecisionReason, /no builder session is open/);
  // the same session with SETUP as a file is a session
  const real = rootWith(placeholderConfig());
  mkdirSync(join(real, 'runs', 'builder'), { recursive: true });
  writeFileSync(join(real, 'runs', 'builder', 'pages.json'), JSON.stringify({ pages: ['0a9e0000-0000-4000-8000-000000000001'] }));
  writeFileSync(join(real, 'runs', 'SETUP'), '{}\n');
  assert.equal(verdict(content, real).permissionDecision, 'allow');
});

test('S6: no decision is written while runs/PAUSED exists, in the agent folder or in the practice page\'s folder for its own marker', () => {
  const root = rootWith(placeholderConfig());
  open(root);
  assert.equal(verdict(decision(), root).permissionDecision, 'allow');
  writeFileSync(join(root, 'runs', 'PAUSED'), 'paused by a person\n');
  const d = verdict(decision(), root);
  assert.equal(d.permissionDecision, 'deny');
  assert.match(d.permissionDecisionReason, /the agent is paused \(runs\/PAUSED exists\)/);

  // the pause of the agent folder covers the practice pages, the pause of one practice page covers its own marker only
  const demos = rootWith(placeholderConfig());
  const one = join(demos, 'runs', 'demos', 'p1', 'runs');
  const two = join(demos, 'runs', 'demos', 'p2', 'runs');
  open(demos, { where: one, pages: ['0a9e0000-0000-4000-8000-0000000000d4'] });
  open(demos, { where: two, pages: ['0a9e0000-0000-4000-8000-0000000000d5'] });
  const at = (page) => verdict(decision(THREE, {}, page), demos).permissionDecision;
  assert.equal(at('0a9e0000-0000-4000-8000-0000000000d4'), 'allow');
  writeFileSync(join(one, 'PAUSED'), 'paused\n');
  assert.equal(at('0a9e0000-0000-4000-8000-0000000000d4'), 'deny', 'the practice page that is paused');
  assert.equal(at('0a9e0000-0000-4000-8000-0000000000d5'), 'allow', 'another practice page is not');
  writeFileSync(join(demos, 'runs', 'PAUSED'), 'paused\n');
  assert.equal(at('0a9e0000-0000-4000-8000-0000000000d5'), 'deny', 'the agent folder\'s pause covers every practice page');
  // a stale marker under a pause is just stale, and says so as before
  const stale = rootWith(placeholderConfig());
  open(stale, { at: NOW - 3 * 3600e3 });
  writeFileSync(join(stale, 'runs', 'PAUSED'), 'paused\n');
  assert.match(verdict(decision(), stale).permissionDecisionReason, /no decide run is open/);
});

test('G13: a create-pages call is never a decision, even when it carries the top-level fields of one', () => {
  const root = rootWith(placeholderConfig());
  open(root);
  const disguised = {
    tool_name: 'mcp__notion__notion-create-pages',
    tool_input: { parent: { page_id: PAGE }, pages: [{ properties: THREE }], page_id: PAGE, command: 'update_properties', properties: THREE },
  };
  const d = verdict(disguised, root);
  assert.equal(d.permissionDecision, 'deny');
  assert.match(d.permissionDecisionReason, /belongs to the editor \(hard rule 1\)/);
  assert.doesNotMatch(d.permissionDecisionReason, /open decide run/);
});

test('G7: a decision whose properties name no editor column never reaches the decide rules; the refusal is the setup rule\'s', () => {
  const root = rootWith(placeholderConfig());
  open(root);
  for (const properties of [{}, null, 'Verified tags']) {
    const d = verdict(decision(properties), root);
    assert.equal(d.permissionDecision, 'deny', JSON.stringify(properties));
    assert.match(d.permissionDecisionReason, /no builder session is open/);
  }
});

test('a practice page\'s marker under runs/demos/<id>/runs/DECIDING counts, for the pages it lists', () => {
  const root = rootWith(placeholderConfig());
  open(root, { where: join(root, 'runs', 'demos', 'practice-1', 'runs'), pages: ['0a9e0000-0000-4000-8000-0000000000d9'] });
  open(root, { where: join(root, 'runs', 'demos', 'practice-2', 'runs') });
  assert.equal(verdict(decision(), root).permissionDecision, 'allow');
  assert.equal(verdict(decision(THREE, {}, '0a9e0000-0000-4000-8000-0000000000d9'), root).permissionDecision, 'allow');
  assert.equal(verdict(decision(THREE, {}, '0a9e0000-0000-4000-8000-0000000000d8'), root).permissionDecision, 'deny');
  // a stale marker of a practice page shelters nothing
  const other = rootWith(placeholderConfig());
  open(other, { where: join(other, 'runs', 'demos', 'practice-1', 'runs'), at: NOW - 3 * 3600e3 });
  assert.equal(verdict(decision(), other).permissionDecision, 'deny');
});

test('without a live marker nothing is allowed, and the refusal still says the column belongs to the editor (hard rule 1)', () => {
  const none = rootWith(placeholderConfig());
  const d = verdict(decision(), none);
  assert.equal(d.permissionDecision, 'deny');
  assert.match(d.permissionDecisionReason, /the property "Verified tags" belongs to the editor \(hard rule 1\)/);
  assert.match(d.permissionDecisionReason, /no decide run is open/);
  for (const [name, at, content] of [
    ['a marker from three hours ago', NOW - 3 * 3600e3, undefined],
    ['a marker from just over two hours ago', NOW - 2 * 3600e3 - 1000, undefined],
    ['a marker dated an hour ahead', NOW + 3600e3, undefined],
    ['a marker that is not JSON', NOW, 'not json'],
    ['an empty marker', NOW, ''],
    ['a marker with no page list', NOW, '{"run_id":"r1","opened_at":"2026-10-27T11:59:00.000Z"}'],
  ]) {
    const root = rootWith(placeholderConfig());
    open(root, { at, content });
    assert.equal(verdict(decision(), root).permissionDecision, 'deny', name);
  }
  // an hour and fifty minutes is still open
  const young = rootWith(placeholderConfig());
  open(young, { at: NOW - 110 * 60e3 });
  assert.equal(verdict(decision(), young).permissionDecision, 'allow');
});

test('a page that the marker does not list is refused', () => {
  const root = rootWith(placeholderConfig());
  open(root);
  const d = verdict(decision(THREE, {}, '0a9e0000-0000-4000-8000-0000000000e1'), root);
  assert.equal(d.permissionDecision, 'deny');
  assert.match(d.permissionDecisionReason, /is not listed by an open decide run/);
});

test('one property more, an agent column, or another value of Review status is refused', () => {
  const root = rootWith(placeholderConfig());
  open(root);
  for (const properties of [
    { ...THREE, Name: 'x' }, { ...THREE, 'Agent tags': [] }, { 'Agent status': 'Done' }, { ...THREE, 'Agent reading': 'x' }, { ...THREE, 'Editor wording': 'x' }, { ...THREE, Paused: '__YES__' }, { ...THREE, Status: 'Approved' },
    { ...THREE, 'date:Review status:start': '2026-10-27' }, { 'Tag outcome': 'Applies' }, {}, null, 'Verified tags',
  ]) {
    assert.equal(verdict(decision(properties), root).permissionDecision, 'deny', JSON.stringify(properties));
  }
  for (const value of ['Approved', 'Rejected', 'Done', '', null, 1, ['Reviewed']]) {
    const d = verdict(decision({ ...THREE, 'Review status': value }), root);
    assert.equal(d.permissionDecision, 'deny', String(value));
    assert.match(d.permissionDecisionReason, /may be set to Reviewed or To review only/);
  }
});

test('any other command, and an icon, a cover, content or a skill field, are refused', () => {
  const root = rootWith(placeholderConfig());
  open(root);
  for (const command of ['insert_content', 'update_content', 'replace_content', 'apply_template', 'update_verification', undefined, '']) {
    const input = decision();
    if (command === undefined) delete input.tool_input.command;
    else input.tool_input.command = command;
    assert.equal(verdict(input, root).permissionDecision, 'deny', String(command));
  }
  for (const extra of [{ icon: '🚀' }, { cover: 'none' }, { content: 'x' }, { new_str: 'x' }, { content_updates: [] }, { is_skill: true }, { template_id: 'x' }, { allow_deleting_content: true }, { position: { type: 'end' } }, { instructions_version: '0.0.2' }, { allow_async: 'no' }]) {
    const d = verdict(decision(THREE, extra), root);
    assert.equal(d.permissionDecision, 'deny', JSON.stringify(extra));
    assert.match(d.permissionDecisionReason, /a decision write carries only page_id, command, properties and allow_async|allow_async must be true or false/);
  }
  // an icon change with no properties is not a decision either
  assert.equal(verdict({ tool_name: 'mcp__notion__notion-update-page', tool_input: { page_id: PAGE, command: 'update_properties', icon: '🚀' } }, root).permissionDecision, 'deny');
});

test('a protected id anywhere in the call is refused first, even on a page the marker lists', () => {
  const config = placeholderConfig();
  const root = rootWith(config);
  const [protectedDb] = config.notion.protected_database_ids;
  const [protectedPage] = config.notion.protected_page_ids;
  open(root, { pages: [PAGE, protectedPage, protectedDb] });
  assert.equal(verdict(decision(), root).permissionDecision, 'allow');
  for (const input of [decision(THREE, {}, protectedPage), decision(THREE, {}, protectedDb), decision({ ...THREE, 'Challenged tags notes': `see ${protectedDb}` }), decision({ ...THREE, 'Verified tags': [protectedPage] }), decision(THREE, { note: protectedDb })]) {
    const d = verdict(input, root);
    assert.equal(d.permissionDecision, 'deny');
    assert.match(d.permissionDecisionReason, /protected id/);
  }
});

test('a rule change\'s Status Approved or Rejected, Editor wording and Paused stay with people, marker or not', () => {
  const root = rootWith(placeholderConfig());
  open(root);
  for (const properties of [{ Status: 'Approved' }, { Status: 'Rejected' }, { 'Editor wording': 'x' }, { Paused: '__YES__' }, { Paused: '__NO__' }]) {
    const d = verdict(decision(properties), root);
    assert.equal(d.permissionDecision, 'deny', JSON.stringify(properties));
    assert.match(d.permissionDecisionReason, /for the editor to set|belongs to the editor/);
  }
  // and the other tools never take a decision: a page is not created with these columns, and nothing is deleted or moved
  assert.equal(verdict({ tool_name: 'mcp__notion__notion-create-pages', tool_input: { parent: { page_id: PAGE }, pages: [{ properties: THREE }] } }, root).permissionDecision, 'deny');
  assert.equal(verdict({ tool_name: 'mcp__notion__notion-delete-pages', tool_input: { page_ids: [PAGE] } }, root).permissionDecision, 'deny');
  assert.equal(verdict({ tool_name: 'mcp__notion__notion-move-pages', tool_input: { page_ids: [PAGE] } }, root).permissionDecision, 'deny');
});

test('the marker does not open the setup rules: a content change on that page is still a setup write', () => {
  const root = rootWith(placeholderConfig());
  open(root);
  const content = verdict({ tool_name: 'mcp__notion__notion-update-page', tool_input: { page_id: PAGE, command: 'replace_content', new_str: 'x' } }, root);
  assert.equal(content.permissionDecision, 'deny');
  assert.match(content.permissionDecisionReason, /no builder session is open/);
});

test('the claims columns come from config.editor_columns.claims when it names them, else the shipped three', () => {
  const custom = placeholderConfig();
  custom.editor_columns.claims = ['My verdict', 'My review', 'My note'];
  const root = rootWith(custom);
  open(root);
  assert.equal(verdict(decision({ 'My verdict': [], 'My note': 'x' }), root).permissionDecision, 'allow');
  assert.equal(verdict(decision({ 'Verified tags': [] }), root).permissionDecision, 'deny', 'a name the config does not list');
  const bare = rootWith({ notion: {} });
  open(bare);
  assert.equal(verdict(decision(), bare).permissionDecision, 'allow');
});

test('the shipped hook reads the marker itself: no import of the agent\'s library, no network, and input it cannot read is denied', () => {
  const source = readFileSync(join(codeRoot(), 'scripts', 'hooks', 'guard.mjs'), 'utf8');
  assert.doesNotMatch(source, /from '\.\.?\/lib\//);
  assert.doesNotMatch(source, /\bfetch\b|node:https?|node:net/);
  const root = rootWith(placeholderConfig());
  open(root);
  assert.equal(decide(null, root, { now: NOW }), null, 'no tool name, no opinion');
  assert.equal(verdict({ tool_name: 'mcp__notion__notion-update-page', tool_input: 'x' }, root).permissionDecision, 'deny');
});
