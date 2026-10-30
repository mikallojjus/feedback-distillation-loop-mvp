#!/usr/bin/env node
// Demo mocks: the product owner's staging tool for showing the editor loop on two mock claims. It is not an editor command and not in the skill.
//
//   node agents/claim-tagger-mvp/scripts/demo-mocks.mjs setup [--again]   the two mock claims in Claims and the agent's mock answers in Tag decisions, then a checkpoint
//   node agents/claim-tagger-mvp/scripts/demo-mocks.mjs reset             back to the checkpoint: the test's live rule changes rolled back, its open ones Rejected, the mocks fresh
//   node agents/claim-tagger-mvp/scripts/demo-mocks.mjs status            what changed since the checkpoint
//
// The mocks: one claim the agent "missed" (no tag, Does not apply) and one it "over-tagged" (Context-dependent, Applies), each with a ledger row as if the agent had read
// it, so that decide, distill, promote and follow-up treat them like any other claim. The product owner's call (28 October 2026): mock rows are written directly
// through lib/notion-rest.mjs, editor columns included on reset, outside the plan machinery; a rule change the test made live is rolled back by rollback.mjs.
// What reset does not undo: edition numbers move forward (a PASS and its rollback are two editions with the same text, both in git), and the test's rule change rows stay
// in Rule changes as Rolled back or Rejected (out of Lessons waiting; delete them by hand for a clean table). Never run tag while mocks are in Claims: it overwrites the
// mock answers with the agent's real reads. The checkpoint lives in runs/demo-mocks/checkpoint.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { clientFromConfig, requestLogger } from './lib/notion-rest.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..', '..');
const TAG = 'Context-dependent';
const MOCKS = [
  {
    geo_id: 'de000000000000000000000000000001',
    claim: "The ruling weakens public confidence in the state's election officials",
    proposal: 'Does not apply',
    confidence: 0.91,
    reason: "'The ruling' and 'the state' read as generic, so no rule fires. · 1 of 1 runs agree",
  },
  {
    geo_id: 'de000000000000000000000000000002',
    claim: 'The European Central Bank should cut interest rates before inflation reaches 2%',
    proposal: 'Applies',
    confidence: 0.88,
    reason: "'The European Central Bank' is a definite reference that needs an outside antecedent. · Context-dependent rule 2 · 1 of 1 runs agree",
  },
];

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const stateDir = join(root, 'runs', 'demo-mocks');
const checkpointFile = join(stateDir, 'checkpoint.json');
const keyOf = (m) => `${m.geo_id}::${TAG}`;
const norm = (id) => String(id ?? '').toLowerCase().replace(/-/g, '');
const text = (s) => ({ rich_text: s ? [{ type: 'text', text: { content: s } }] : [] });
const title = (s) => ({ title: [{ type: 'text', text: { content: s } }] });
const plain = (p) => (p?.title ?? p?.rich_text ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');

function load() {
  const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
  const runDir = join(stateDir, stamp());
  mkdirSync(runDir, { recursive: true });
  const client = clientFromConfig(config, { log: requestLogger(join(runDir, 'requests.jsonl')) });
  if (!client) throw new Error('there is no Notion token in .env');
  return { config, client, runDir };
}

function rubricNow() {
  const r = JSON.parse(readFileSync(join(root, 'rubric', 'rubric.json'), 'utf8'));
  const tag = r.tags.find((t) => t.name === TAG);
  return { edition: r.edition, page: norm(tag.page_id), rules: tag.when_to_use };
}

const dbOf = (config, table) => (config.notion[table] ?? config.notion.databases?.[table]).database_id;

async function rows(ctx, table) {
  return ctx.client.queryAll(dbOf(ctx.config, table));
}

function claimProps(m, edition, page) {
  return {
    'Geo Name': title(m.claim),
    'Geo ID': text(m.geo_id),
    'Agent tags': { relation: m.proposal === 'Applies' ? [{ id: page }] : [] },
    'Agent confidence': { number: m.confidence },
    'Agent reasons': text(`${TAG}: ${m.reason}`),
    'Agent status': { select: { name: 'Done' } },
    'Tags waiting': { relation: [] },
    'Agent edition': text(edition),
    'Agent remarks': text(''),
    'Agent reading': text(''),
    'Verified tags': { relation: [] },
    'Review status': { select: null },
    'Challenged tags notes': text(''),
  };
}

function ledgerProps(m, edition, claimUrl) {
  return {
    Claim: title(m.claim),
    Key: text(keyOf(m)),
    Tag: { select: { name: TAG } },
    'Agent proposal': { select: { name: m.proposal } },
    'Agent confidence': { number: m.confidence },
    'Agent reason': text(m.reason),
    'Claim link': { url: claimUrl },
    'Rulebook edition': text(edition),
    'Follow-up': { select: null },
    'Tag outcome': { select: null },
    'Why wrong': { select: null },
    'Your reasoning': text(''),
    'Decided under': text(''),
    'Agent reading': { select: null },
    Rule: text(''),
    'Reading note': text(''),
    'Read under': text(''),
  };
}

// a create sends only the values that are there; an update also clears
const forCreate = (props) => Object.fromEntries(Object.entries(props).filter(([, v]) => {
  if ('select' in v) return v.select !== null;
  if ('rich_text' in v) return v.rich_text.length > 0;
  if ('relation' in v) return v.relation.length > 0;
  return true;
}));

/** Put both mocks, claim and ledger row, in their fresh state. Returns { claims: {geo_id: page_id}, ledger: {key: page_id} }. */
async function freshMocks(ctx) {
  const { edition, page } = rubricNow();
  const claimRows = await rows(ctx, 'claims');
  const ledgerRows = await rows(ctx, 'tag_decisions');
  const out = { claims: {}, ledger: {} };
  for (const m of MOCKS) {
    const claimsHere = claimRows.filter((r) => plain(r.properties['Geo ID']).trim() === m.geo_id);
    if (claimsHere.length > 1) throw new Error(`the mock ${m.geo_id} is in Claims ${claimsHere.length} times; remove the extra row by hand first`);
    const props = claimProps(m, edition, page);
    const claim = claimsHere.length
      ? await ctx.client.updatePage(claimsHere[0].id, { properties: props })
      : await ctx.client.createPage({ parentDatabaseId: dbOf(ctx.config, "claims"), properties: forCreate(props) });
    const claimBack = await ctx.client.retrievePage(claim.id);
    out.claims[m.geo_id] = claimBack.id;

    const ledgerHere = ledgerRows.filter((r) => plain(r.properties.Key).trim() === keyOf(m));
    if (ledgerHere.length > 1) throw new Error(`the mock ledger row ${keyOf(m)} is there ${ledgerHere.length} times; remove the extra row by hand first`);
    const lprops = ledgerProps(m, edition, claimBack.url);
    const row = ledgerHere.length
      ? await ctx.client.updatePage(ledgerHere[0].id, { properties: lprops })
      : await ctx.client.createPage({ parentDatabaseId: dbOf(ctx.config, "tag_decisions"), properties: forCreate(lprops) });
    const rowBack = await ctx.client.retrievePage(row.id);
    out.ledger[keyOf(m)] = rowBack.id;

    // read back what matters
    const c = claimBack.properties;
    const l = rowBack.properties;
    const problems = [];
    if (plain(c['Geo ID']) !== m.geo_id) problems.push('Geo ID');
    if (c['Review status']?.select) problems.push('Review status not empty');
    if ((c['Verified tags']?.relation ?? []).length) problems.push('Verified tags not empty');
    if (plain(c['Challenged tags notes'])) problems.push('note not empty');
    if (plain(c['Agent reading'])) problems.push('Agent reading not empty');
    if (l['Agent proposal']?.select?.name !== m.proposal) problems.push('Agent proposal');
    if (l['Tag outcome']?.select || l['Agent reading']?.select || l['Follow-up']?.select) problems.push('ledger decision or reading not empty');
    if (problems.length) throw new Error(`the mock ${m.geo_id} did not read back fresh: ${problems.join(', ')}`);
  }
  return { ...out, edition };
}

async function setup(again) {
  if (existsSync(checkpointFile) && !again) {
    console.log('Demo mocks: a checkpoint exists already. Type "reset" to go back to it, or "setup --again" to take a new one from the state as it is now.');
    return 2;
  }
  const ctx = load();
  const mocks = await freshMocks(ctx);
  const lessons = await rows(ctx, 'rule_changes');
  const open = lessons.filter((r) => ['Proposed', 'Approved'].includes(r.properties.Status?.select?.name) && r.properties.Tag?.select?.name === TAG);
  const { rules } = rubricNow();
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(checkpointFile, `${JSON.stringify({
    taken_at: new Date().toISOString(), edition: mocks.edition, rules, rule_change_ids: lessons.map((r) => norm(r.id)), claims: mocks.claims, ledger: mocks.ledger,
  }, null, 2)}\n`);
  console.log(`Demo mocks: the two mock claims and their ledger rows are fresh, and the checkpoint is taken (edition ${mocks.edition}, ${lessons.length} rule change rows).`);
  for (const m of MOCKS) console.log(`  ${m.geo_id}  agent: ${m.proposal.padEnd(14)} ${m.claim}`);
  if (open.length) console.log(`  Note: ${open.length} rule change on ${TAG} is open (Proposed or Approved); distill drafts nothing for a rule that has one.`);
  return 0;
}

async function reset() {
  if (!existsSync(checkpointFile)) {
    console.log('Demo mocks: there is no checkpoint yet. Type "setup" first.');
    return 2;
  }
  const cp = JSON.parse(readFileSync(checkpointFile, 'utf8'));
  const ctx = load();
  const before = new Set(cp.rule_change_ids);
  const fresh = () => rows(ctx, 'rule_changes').then((all) => all.filter((r) => !before.has(norm(r.id))));
  const lessonTitle = (r) => plain(r.properties.Lesson);
  const status = (r) => r.properties.Status?.select?.name ?? null;

  // the test's live changes, newest first, through rollback.mjs (which writes the rule back, reads it back, saves the edition, commits and marks the change Rolled back)
  const live = (await fresh()).filter((r) => status(r) === 'Live').sort((a, b) => String(b.created_time).localeCompare(String(a.created_time)));
  const rolled = [];
  for (const r of live) {
    const t = lessonTitle(r);
    console.log(`Rolling back "${t}" ...`);
    const res = spawnSync(process.execPath, [join(root, 'scripts', 'rollback.mjs'), '--lesson', t, '--confirm'], { cwd: repo, stdio: 'inherit' });
    if (res.status !== 0) {
      console.log(`Demo mocks: the rollback of "${t}" stopped (exit ${res.status}); nothing else was reset. Type "reset" again.`);
      return 1;
    }
    rolled.push(t);
  }
  // the test's open changes are rejected, so that they block nothing
  const rejected = [];
  for (const r of await fresh()) {
    if (['Proposed', 'Approved'].includes(status(r))) {
      await ctx.client.updatePage(r.id, { properties: { Status: { select: { name: 'Rejected' } } } });
      const back = await ctx.client.retrievePage(r.id);
      if (back.properties.Status?.select?.name !== 'Rejected') throw new Error(`the rule change "${lessonTitle(r)}" did not read back as Rejected`);
      rejected.push(lessonTitle(r));
    }
  }
  // the rule must read as it did at the checkpoint
  const { rules, edition } = rubricNow();
  if (rules !== cp.rules) {
    console.log(`Demo mocks: ${TAG}'s rules differ from the checkpoint after the rollbacks (edition ${edition}); the mocks were not reset. Look at the Rule changes table.`);
    return 2;
  }
  await freshMocks(ctx);
  const left = (await fresh()).map((r) => `"${lessonTitle(r)}" (${status(r)})`);
  console.log(`Demo mocks: back at the checkpoint. ${TAG}'s rules read as at ${cp.edition} (edition now ${edition}); the two mocks and their ledger rows are fresh.`);
  if (rolled.length) console.log(`  Rolled back: ${rolled.map((t) => `"${t}"`).join(', ')}`);
  if (rejected.length) console.log(`  Rejected: ${rejected.map((t) => `"${t}"`).join(', ')}`);
  if (left.length) console.log(`  Still in Rule changes from the test (out of Lessons waiting): ${left.join(', ')}`);
  return 0;
}

async function show() {
  if (!existsSync(checkpointFile)) {
    console.log('Demo mocks: no checkpoint yet.');
    return 0;
  }
  const cp = JSON.parse(readFileSync(checkpointFile, 'utf8'));
  const ctx = load();
  const { rules, edition } = rubricNow();
  console.log(`Checkpoint ${cp.taken_at}, edition ${cp.edition}; now ${edition}, rules ${rules === cp.rules ? 'as at the checkpoint' : 'CHANGED'}.`);
  const claimRows = await rows(ctx, 'claims');
  const ledgerRows = await rows(ctx, 'tag_decisions');
  for (const m of MOCKS) {
    const c = claimRows.find((r) => plain(r.properties['Geo ID']).trim() === m.geo_id)?.properties;
    const l = ledgerRows.find((r) => plain(r.properties.Key).trim() === keyOf(m))?.properties;
    console.log(`  ${m.claim}`);
    console.log(`    claim: ${c ? `Review status ${c['Review status']?.select?.name ?? 'empty'}, Verified tags ${(c['Verified tags']?.relation ?? []).length}, note ${plain(c['Challenged tags notes']) ? 'yes' : 'no'}, Agent status ${c['Agent status']?.select?.name ?? 'empty'}` : 'MISSING'}`);
    console.log(`    ledger: ${l ? `proposal ${l['Agent proposal']?.select?.name ?? '-'}, outcome ${l['Tag outcome']?.select?.name ?? '-'}, reading ${l['Agent reading']?.select?.name ?? '-'}, follow-up ${l['Follow-up']?.select?.name ?? '-'}` : 'MISSING'}`);
  }
  const before = new Set(cp.rule_change_ids);
  for (const r of (await rows(ctx, 'rule_changes')).filter((x) => !before.has(norm(x.id)))) console.log(`  New rule change: "${plain(r.properties.Lesson)}" (${r.properties.Status?.select?.name ?? '-'})`);
  return 0;
}

// Parked (P48): the practice pages are not ported to the v2 layout; every subcommand refuses.
console.log('demo-mocks: the practice pages are parked: this branch works on the v2 layout only (P48). The demo runs on the git tag claim-tagger-v1 (git worktree add ../geo-agents-v1 claim-tagger-v1).');
process.exit(2);

const [cmd, flag] = process.argv.slice(2);
const run = cmd === 'setup' ? () => setup(flag === '--again') : cmd === 'reset' ? reset : cmd === 'status' ? show : null;
if (!run) {
  console.log('usage: node agents/claim-tagger-mvp/scripts/demo-mocks.mjs setup [--again] | reset | status');
  process.exitCode = 2;
} else {
  run().then((code) => { process.exitCode = code; }, (e) => { console.log(`Demo mocks: stopped: ${e.message}`); process.exitCode = 1; });
}
