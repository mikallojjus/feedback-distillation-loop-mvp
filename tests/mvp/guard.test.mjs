import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../../agents/claim-tagger-mvp/scripts/hooks/guard.mjs';
import { codeRoot } from '../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';
import { placeholderConfig } from './helpers/config-fixture.mjs';

// The connector guard (hooks/guard.mjs) reads the editor's column names from config.json editor_columns, whatever lists it holds, so that the claims' three
// columns (Verified tags, Review status, Challenged tags notes) are as guarded as Editor wording and Paused. Why wrong left the editor's work with the reading of
// 22 October (READ-DECISIONS.md): it is the ledger's column now, and Agent reading is the agent's. The guard imports none of the agent's library modules.

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function rootWith(config) {
  const root = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-guard-'));
  dirs.push(root);
  if (config !== null) writeFileSync(join(root, 'config.json'), JSON.stringify(config));
  mkdirSync(join(root, 'runs'), { recursive: true });
  return root;
}
const update = (properties, extra = {}) => ({ tool_name: 'mcp__notion__notion-update-page', tool_input: { page_id: '0a9e0000-0000-4000-8000-000000000001', command: 'update_properties', properties, ...extra } });
const create = (properties) => ({ tool_name: 'mcp__notion__notion-create-pages', tool_input: { parent: { page_id: '0a9e0000-0000-4000-8000-000000000001' }, pages: [{ properties }] } });
const EDITOR = ['Verified tags', 'Review status', 'Challenged tags notes', 'Editor wording', 'Paused'];

test('every editor column of the shipped config is refused in a page write, in the plain name and in the connector\'s date form, in any letter case', () => {
  const root = rootWith(placeholderConfig());
  for (const name of EDITOR) {
    for (const input of [update({ [name]: 'x' }), create({ [name]: 'x' }), update({ [name.toUpperCase()]: 'x' })]) {
      const d = decide(input, root);
      assert.equal(d.permissionDecision, 'deny', name);
      assert.match(d.permissionDecisionReason, new RegExp(`the property "${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" belongs to the editor \\(hard rule 1\\)`, 'i'), name);
    }
  }
  assert.match(decide(update({ 'date:Review status:start': '2026-10-16' }), root).permissionDecisionReason, /belongs to the editor/);
});

test('the ledger\'s columns are not the editor\'s any more: a write naming Tag outcome is refused for another reason', () => {
  const root = rootWith(placeholderConfig());
  const d = decide(update({ 'Tag outcome': 'Applies' }), root);
  assert.equal(d.permissionDecision, 'deny');
  assert.doesNotMatch(d.permissionDecisionReason, /belongs to the editor/, 'it is refused because no builder session is open, not because of the column');
  assert.match(d.permissionDecisionReason, /no builder session is open/);
});

test('Why wrong and the agent\'s reading columns are not the editor\'s: a write naming one is refused for another reason, never as the editor\'s property', () => {
  const root = rootWith(placeholderConfig());
  for (const name of ['Why wrong', 'Why wrong (old)', 'Agent reading', 'Rule', 'Reading note', 'Read under']) {
    const d = decide(update({ [name]: 'x' }), root);
    assert.equal(d.permissionDecision, 'deny', name);
    assert.doesNotMatch(d.permissionDecisionReason, /belongs to the editor/, name);
    assert.match(d.permissionDecisionReason, /no builder session is open/, name);
  }
  // the three columns of the claims that an editor fills are still refused as the editor's, in the same call as an agent column
  assert.match(decide(update({ 'Agent reading': 'x', 'Challenged tags notes': 'y' }), root).permissionDecisionReason, /the property "Challenged tags notes" belongs to the editor \(hard rule 1\)/);
});

test('the Status values Approved and Rejected stay the editor\'s', () => {
  const root = rootWith(placeholderConfig());
  for (const value of ['Approved', 'Rejected']) assert.match(decide(update({ Status: value }), root).permissionDecisionReason, new RegExp(`Status ${value} is for the editor to set`));
  assert.doesNotMatch(decide(update({ Status: 'Proposed' }), root).permissionDecisionReason, /for the editor to set/);
});

test('the names come from whatever lists config.editor_columns holds; a config that has none falls back to the shipped names', () => {
  const custom = placeholderConfig();
  custom.editor_columns = { claims_copy: ['My review'], elsewhere: ['Other column'], rule_changes_status_editor_values: ['Signed off'] };
  const root = rootWith(custom);
  assert.match(decide(update({ 'My review': 'x' }), root).permissionDecisionReason, /belongs to the editor/);
  assert.match(decide(update({ 'Other column': 'x' }), root).permissionDecisionReason, /belongs to the editor/);
  assert.match(decide(update({ Status: 'Signed off' }), root).permissionDecisionReason, /Status Signed off is for the editor to set/);
  assert.doesNotMatch(decide(update({ 'Review status': 'x' }), root).permissionDecisionReason, /belongs to the editor/, 'only the lists the config names');

  for (const config of [null, { notion: {} }, { editor_columns: {} }, { editor_columns: 'nothing' }]) {
    const bare = rootWith(config);
    for (const name of EDITOR) assert.match(decide(update({ [name]: 'x' }), bare).permissionDecisionReason, /belongs to the editor/, `${JSON.stringify(config)}: ${name}`);
  }
});

test('the guard still denies delete, move and duplicate, and a protected id anywhere in the call', () => {
  const config = placeholderConfig();
  const root = rootWith(config);
  for (const tool of ['notion-delete-pages', 'notion-move-pages', 'notion-duplicate-page', 'notion-restore-pages']) {
    assert.match(decide({ tool_name: `mcp__notion__${tool}`, tool_input: {} }, root).permissionDecisionReason, /never allowed/);
  }
  const id = config.notion.protected_database_ids[0];
  assert.match(decide(update({ Name: 'x' }, { note: `see ${id}` }), root).permissionDecisionReason, /protected id/);
  assert.equal(decide({ tool_name: 'Read', tool_input: {} }, root), null, 'a tool it does not guard gets no opinion');
});

test('the shipped guard imports none of the agent\'s library modules and the live config.json lists the claims\' three columns', () => {
  const source = readFileSync(join(codeRoot(), 'scripts', 'hooks', 'guard.mjs'), 'utf8');
  assert.doesNotMatch(source, /from '\.\.?\/lib\//, 'it reads config.json and the markers itself');
  const live = JSON.parse(readFileSync(join(codeRoot(), 'config.json'), 'utf8'));
  assert.deepEqual(live.editor_columns.claims_copy, ['Verified tags', 'Review status', 'Challenged tags notes']);
  assert.equal(live.editor_columns.tag_decisions, undefined);
});
