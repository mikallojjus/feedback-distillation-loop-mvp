import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULEBOOK_COLUMNS, CLAIMS_GEO_COLUMNS, loadConfig } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import { optionColor, planStructure } from '../../agents/claim-tagger-mvp/scripts/lib/notion-build.mjs';
import { countRequests } from '../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';
import { normId } from '../../agents/claim-tagger-mvp/scripts/lib/notion-values.mjs';
import { READING_COLUMNS } from '../../agents/claim-tagger-mvp/scripts/lib/readings.mjs';
import { AUDIT_PREFIX, checkPlan, readPlan } from '../../agents/claim-tagger-mvp/scripts/lib/plan.mjs';
import { readEdition, readLock, readRubric } from '../../agents/claim-tagger-mvp/scripts/lib/rubric.mjs';
import { openBuilder } from '../../agents/claim-tagger-mvp/scripts/setup.mjs';
import {
  AUDIT_NOTE, InputError, NO_REASONING, auditForPick, auditOps, auditProperties, buildCanaries, claimLink, claimOps, formatWhen, readAudit, readPick, readTaxonomy, richTextFromPieces,
  migrationOps, protectedInLinks, rulebookOps, settingsProperties, unknownOptions, withLinkedSources,
} from '../../agents/claim-tagger-mvp/scripts/lib/setup-steps.mjs';
import {
  AUDIT_FILE, CONTEXT_DEPENDENT_EXAMPLES, EDITION, NOW, REAL_TAXONOMY, SELF_CONTAINED_EXAMPLES, SPACE_NAMES, builderClient, cleanTmp, forFake, freshStructure, freshStructureBeforeOptions, fullTaxonomy, makePick, newWorld, readAuditFile,
  readJson, readLines, restClient, revisedStructure, smallTaxonomy, tmp, writeInputs,
} from './helpers/setup-world.mjs';

// setup.mjs against the shared in-memory Notion: the commands behind the builder session, the row steps (each a plan applied with a ledger and a
// read-back), the rubric edition, the canaries and the verification. Inputs are small files shaped like the real ones; one test runs the real files.

after(cleanTmp);

const SESSION = ['builder', 'open', '--reason', 'test'];
const posts = (fake, path) => fake.requests.filter((r) => r.method === 'POST' && r.path === path);

/**
 * A world with the fresh structure file written (full-page tables, the hub block), the options of the Geo columns set from the pick (setup.mjs structure --options-from), a builder session
 * open and the tables built (with the hub page's link lines). `old: true` takes the structure of the first build instead (inline tables, no hub, Claims copy) and sets no options.
 */
async function built({ pick, taxonomy, audit, old = false } = {}) {
  const w = newWorld({ structure: old ? true : 'fresh' });
  assert.equal(openBuilder({ root: w.root, reason: 'test' }).ok, true);
  const inputs = writeInputs(join(w.root, 'inputs'), { ...(pick ? { pick } : {}), ...(taxonomy ? { taxonomy } : {}), ...(audit ? { audit } : {}) });
  mkdirSync(join(w.root, 'setup'), { recursive: true });
  copyFileSync(inputs.claims, join(w.root, 'setup', 'geo-claims-pick.json')); // the default input of claims, seed-audit, migrate-decisions and verify
  if (!old) {
    const o = await w.run(['structure', '--options-from', inputs.claims]);
    assert.equal(o.code, 0, o.text);
  }
  const r = await w.run(['build']);
  assert.equal(r.code, 0, r.text);
  return { ...w, inputs };
}

const tableEntries = (root) => {
  const c = readJson(join(root, 'config.json'));
  return { rulebook: c.notion.rulebook, claims: c.notion.claims, ...c.notion.databases };
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
  for (const name of ['pages', 'build', 'rulebook', 'claims', 'seed-audit', 'migrate-decisions', 'rubric', 'canaries', 'settings', 'all']) {
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
  assert.match(r.out[0], /## Tag decisions \(17 columns\)/);
  assert.match(r.out[0], /## Claims copy \(27 columns\)/);
  assert.match(r.out[0], /\| Agent reading \| rich_text \|/);
  assert.match(r.out[0], /\| Why wrong \(old\) \| select \| Agent slip, Rule unclear, Rule should change \|.*retired: never made on a new table/);
  assert.match(r.out[0], /- \*\*Needs your note\*\*: rows shown: Agent reading contains without your note;/);
  assert.match(r.out[0], /- \*\*Needs your note \(ledger\)\*\* .*rows shown: Reading note contains without your note;/);
  assert.match(r.out[0], /\| Verified tags \| relation \| points at the Rulebook copy \|/);
  assert.match(r.out[0], /\| Agent tags \(old\) \| rich_text \|/);
  assert.match(r.out[0], /- \*\*Your queue\*\*: rows shown: Agent status is Waits for you; sorted by: Agent confidence, lowest first; columns: Geo Name, Agent tags, Agent confidence, Agent reasons, Agent status, Tags waiting/);
  const none = await newWorld().run(['preview']);
  assert.equal(none.code, 2);
  assert.match(none.err[0], /structure --from-proposal/);
});

test('preview of the fresh structure shows the five tables in the hub\'s order, the lean Claims set, the six views, Onboarding and the hub block', async () => {
  const w = newWorld({ structure: 'fresh' });
  const r = await w.run(['preview']);
  assert.equal(r.code, 0);
  const md = r.out[0];
  assert.match(md, /^# Structure preview\n\n5 tables, \d+ columns, 6 views and 1 sub-pages/);
  assert.match(md, /## Hub page "Claim tagger"/);
  assert.match(md, /3 link lines at the top: Your queue: the claims that wait for your decision; Needs your note: .*; Lessons waiting: /);
  assert.match(md, /the 5 tables as full-page tables, in this order: Claims, Rulebook, Rule changes, Tag decisions, Agent settings/);
  assert.match(md, /then: Onboarding, the archive page "Feedback Distillation MVP \(archive, to 27 Oct 2026\)"/);
  assert.deepEqual([...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].replace(/ \(\d+ columns\)$/, '')).slice(2), ['Claims', 'Rulebook', 'Rule changes', 'Tag decisions', 'Agent settings']);
  assert.match(md, /## Claims \(20 columns\)/, 'the lean Claims set: nine Geo columns, eight agent columns, three editor columns');
  assert.match(md, /\| Geo Space \| select \| U\.S\. Politics, World affairs, AI, Health, Crypto, Technology \|/);
  assert.match(md, /\| Geo Created \| date \|/);
  assert.match(md, /\| Geo Tags \| multi_select \| Debate(, [^|]+)? \|/, 'Debate first, then the tag names the committed pick added, if it has run');
  assert.doesNotMatch(md, /\(old\)|Geo Score|Geo Name source|renamed|retired|Claims copy|Rulebook copy/);
  assert.equal((md.match(/^- \*\*/gm) ?? []).length, 6, 'six named views; the Rulebook shows its own view once, not twice');
  // the warning line first (P14), then the links
  assert.match(md, /1\. the warning line at the very top: Claims is the real table: every decision you make there trains the rulebook\. To practise, open Onboarding\.\n2\. 3 link lines at the top: /);
  // the lean views and the table's own views (P13, P15), the description under each table (ED-8)
  assert.match(md, /- \*\*Your queue\*\*: rows shown: Agent status is Waits for you and Review status is not Reviewed; sorted by: Agent confidence, lowest first; columns: Geo Name, Tags waiting, Agent reasons, Agent tags, Verified tags, Challenged tags notes, Review status; cells wrap\n/);
  assert.match(md, /- \*\*Needs your note\*\*: rows shown: Agent reading contains without your note; sorted by: Agent confidence, lowest first; columns: Geo Name, Verified tags, Agent reading, Challenged tags notes, Review status; cells wrap\n/);
  assert.match(md, /- \*\*Agent disagreed\*\*: rows shown: Agent status is Disagrees with your decision; sorted by: Agent confidence, lowest first; columns: Geo Name, Agent reasons, Agent reading, Verified tags, Challenged tags notes, Review status; cells wrap\n/);
  assert.match(md, /- The table's own view \(Notion's default\), the first tab, called All claims: shows Geo Name, Geo Space, Agent tags, Agent status, Verified tags, Review status, Geo URL; the other 13 columns are hidden\n/);
  assert.match(md, /- The table's own view \(Notion's default\), the first tab, called Rulebook: shows Name, Category, Status, When to use, Example Claims; the other \d+ columns are hidden\n/);
  // the own view stands before the named views in the list, as it does in the tab bar
  assert.match(md, /Views, in the order of the tabs:\n\n- The table's own view \(Notion's default\), the first tab, called All claims: .*\n- \*\*Your queue\*\*: /);
  assert.equal((md.match(/^- The table's own view/gm) ?? []).length, 5, 'every table arranges its own view');
  assert.equal((md.match(/^Description under the table's name: /gm) ?? []).length, 5);
  assert.match(md, /^Description under the table's name: Tick Paused to stop every command; untick to resume\.$/m);
  assert.equal(w.fake.requests.length, 0, 'local files only');
});

test('structure --options-from sets Geo Tags (the pick\'s tag names, sorted) and Geo Space (the six spaces), writes setup/structure.json, says what changed, and run again changes nothing', async () => {
  const w = newWorld({ structure: 'fresh' });
  writeFileSync(join(w.root, 'setup', 'structure.json'), `${JSON.stringify(forFake(freshStructureBeforeOptions()), null, 2)}\n`);
  const dir = join(w.root, 'inputs');
  const pick = makePick({ audit: readAuditFile(), extra: 3 });
  pick.rows[3]['Geo Tags'] = ['Debate', 'Immigration', 'Economy'];
  pick.tag_names = ['Debate', 'Economy', 'Immigration'];
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'pick.json');
  writeFileSync(file, JSON.stringify(pick));
  const columns = () => readJson(join(w.root, 'setup', 'structure.json')).tables.claims.columns;
  assert.deepEqual(columns().find((c) => c.name === 'Geo Tags').options, ['Debate'], 'until it runs, Geo Tags has the option Debate only');

  const r = await w.run(['structure', '--options-from', file]);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(columns().find((c) => c.name === 'Geo Tags').options, ['Debate', 'Economy', 'Immigration']);
  assert.deepEqual(columns().find((c) => c.name === 'Geo Space').options, SPACE_NAMES);
  assert.ok(r.out.includes('structure: Geo Tags: added Economy, Immigration (3 in all)'), r.out.join('\n'));
  assert.ok(r.out.includes('structure: Geo Space: its 6 options are the pick\'s already'));
  assert.ok(r.out.some((l) => /^structure: setup\/structure\.json written$/.test(l)));
  assert.match(r.out.join('\n'), /Geo Tags colours: Debate \w+, Economy \w+, Immigration \w+/);
  assert.match(r.out.join('\n'), /Geo Space colours: U\.S\. Politics blue, World affairs green, AI purple, Health red, Crypto orange, Technology gray/);
  assert.equal(w.fake.requests.length, 0, 'files only: no request, no session needed');
  const after = readFileSync(join(w.root, 'setup', 'structure.json'), 'utf8');

  // run again: nothing changes, the file is not touched
  const again = await w.run(['structure', '--options-from', file]);
  assert.equal(again.code, 0, again.text);
  assert.ok(again.out.includes('structure: nothing changed'));
  assert.equal(readFileSync(join(w.root, 'setup', 'structure.json'), 'utf8'), after);

  // a tag that left the pick leaves the options: the options are the pick's
  pick.tag_names = ['Debate'];
  pick.rows = pick.rows.map((x) => ({ ...x, 'Geo Tags': ['Debate'] }));
  writeFileSync(file, JSON.stringify(pick));
  const fewer = await w.run(['structure', '--options-from', file]);
  assert.ok(fewer.out.includes('structure: Geo Tags: removed Economy, Immigration (1 in all)'), fewer.out.join('\n'));
});

test('the colours of the Geo options are the same on every run and for every order of the names: Geo Space has its own, Geo Tags a hash of the name', () => {
  assert.equal(optionColor('claims', 'Geo Space', 'AI'), 'purple');
  assert.equal(optionColor('claims', 'Geo Tags', 'Debate'), optionColor('claims', 'Geo Tags', 'Debate'));
  const names = ['Debate', 'Economy', 'Politics', 'Immigration', 'Featured', 'Main claim'];
  const forward = names.map((n) => optionColor('claims', 'Geo Tags', n));
  const backward = [...names].reverse().map((n) => optionColor('claims', 'Geo Tags', n)).reverse();
  assert.deepEqual(forward, backward);
  assert.ok(forward.every((c) => ['blue', 'brown', 'gray', 'green', 'orange', 'pink', 'purple', 'red', 'yellow'].includes(c)), 'real Notion colours, never "default"');
  assert.equal(optionColor('claims', 'Review status', 'Reviewed'), 'green');
  assert.equal(optionColor('claims', 'Agent confidence', 'x'), 'default', 'a column that takes no colours from a file keeps the default');
  const body = planStructure(forFake(freshStructure()), { notion: { parent_page_id: '3fa273e214eb805199f3d12ef01db453' } }).databases.find((d) => d.table === 'claims').body.initial_data_source.properties;
  assert.deepEqual(body['Geo Space'].select.options.map((o) => [o.name, o.color]), [['U.S. Politics', 'blue'], ['World affairs', 'green'], ['AI', 'purple'], ['Health', 'red'], ['Crypto', 'orange'], ['Technology', 'gray']]);
});

test('structure --options-from refuses what it cannot set: no geo.spaces in the config, a space or tag the pick lists inconsistently, a file that is not a Geo pick, or other options with it', async () => {
  const w = newWorld({ structure: 'fresh' });
  const dir = join(w.root, 'inputs');
  mkdirSync(dir, { recursive: true });
  const put = (name, value) => {
    const f = join(dir, name);
    writeFileSync(f, JSON.stringify(value));
    return f;
  };
  const pick = makePick({ audit: readAuditFile(), extra: 2 });
  const before = readFileSync(join(w.root, 'setup', 'structure.json'), 'utf8');
  let r = await w.run(['structure', '--options-from', put('stray-space.json', { ...pick, rows: pick.rows.map((x, i) => (i === 0 ? { ...x, 'Geo Space': 'Elsewhere' } : x)) })]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /1 claim\(s\) of the pick have a Geo Space that is not one of config\.json's geo\.spaces \(Elsewhere\)/);
  r = await w.run(['structure', '--options-from', put('unlisted-tag.json', { ...pick, tag_names: ['Debate'] })]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /the pick's tag_names does not list 1 tag\(s\) that its rows carry \(Economy\)/);
  r = await w.run(['structure', '--options-from', put('old.json', { seed: 's', rows: [{ 'Geo ID': 'g', 'Geo Name': 'n' }] })]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /50-row pick of the first build/);
  r = await w.run(['structure', '--options-from', join(dir, 'missing.json')]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /the claims pick does not exist/);
  r = await w.run(['structure', '--options-from', put('ok.json', pick), '--replace']);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /takes no other option/);
  assert.equal(readFileSync(join(w.root, 'setup', 'structure.json'), 'utf8'), before, 'the structure file is as it was after every refusal');
  const config = readJson(join(w.root, 'config.json'));
  delete config.geo;
  writeFileSync(join(w.root, 'config.json'), JSON.stringify(config, null, 2));
  r = await w.run(['structure', '--options-from', put('ok2.json', pick)]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /config\.json has no geo\.spaces/);
});

test('structure --from-proposal does not write over a structure that says where it was made from, unless --replace is given', async () => {
  const w = newWorld({ structure: 'fresh' });
  const proposal = join(import.meta.dirname, '..', '..', 'docs', 'mvp-2026-11', 'STRUCTURE.md');
  const before = readFileSync(join(w.root, 'setup', 'structure.json'), 'utf8');
  assert.match(JSON.parse(before).made_from, /HUB-AND-GEO-CLAIMS\.md \(P10-P12\)/);
  for (const argv of [['structure', '--from-proposal', proposal], ['structure']]) {
    const r = await w.run(argv);
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.err[0], /setup\/structure\.json was made from docs\/mvp-2026-11\/HUB-AND-GEO-CLAIMS\.md \(P10-P12\) and --from-proposal would replace it with the first build's structure; give --replace/);
  }
  assert.equal(readFileSync(join(w.root, 'setup', 'structure.json'), 'utf8'), before, 'untouched');
  const replaced = await w.run(['structure', '--from-proposal', proposal, '--replace']);
  assert.equal(replaced.code, 0, replaced.text);
  assert.match(replaced.out[0], /^structure: 5 tables, 58 columns, 4 views, 2 sub-pages -> /);
  assert.equal(JSON.parse(readFileSync(join(w.root, 'setup', 'structure.json'), 'utf8')).made_from, undefined);
  // a structure without made_from (the first build's) is written over as it always was
  assert.equal((await w.run(['structure', '--from-proposal', proposal])).code, 0);
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
  assert.deepEqual(r.out.slice(-2), ['tables: 5 made', 'columns: 3 added (claims: Agent tags, Tags waiting, Verified tags)']);
  assert.equal(posts(w.fake, '/databases').length, 5);
  r = await w.run(['views']);
  assert.equal(r.code, 0);
  assert.equal(r.out.at(-1), 'views: 7 made');
  const writes = w.fake.writes().length;
  assert.equal(writes, 15, 'two pages, five tables, one PATCH for the relation columns, seven views');
  r = await w.run(['build']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.filter((l) => /made|added/.test(l)), ['pages: 0 made, 2 there already', 'tables: 0 made, 5 there already', 'columns: 0 added', 'views: 0 made, 7 there already']);
  assert.equal(w.fake.writes().length, writes);
  const views = readJson(join(w.root, 'config.json')).notion.views;
  assert.deepEqual(Object.keys(views), ['your_queue', 'needs_your_note', 'agent_disagreed', 'your_queue_ledger', 'needs_your_note_ledger', 'lessons_waiting', 'rulebook'], 'config.json holds the id and the link of each view');
  const entries = tableEntries(w.root);
  assert.deepEqual(views.your_queue, { id: views.your_queue.id, url: `https://www.notion.so/${entries.claims.database_id}?v=${views.your_queue.id}` }, 'Your queue is a view of the Claims copy');
  assert.deepEqual(views.your_queue_ledger.url, `https://www.notion.so/${entries.tag_decisions.database_id}?v=${views.your_queue_ledger.id}`);
  assert.deepEqual(views.rulebook.url, `https://www.notion.so/${entries.rulebook.database_id}?v=${views.rulebook.id}`);
  const log = countRequests(join(w.root, 'runs', 'builder', 'requests.jsonl'));
  assert.equal(log.writes, 15, 'the builder log holds the structure requests');
  assert.equal(log.byMethod.PATCH ?? 0, 1, 'the one column that needs the Rulebook copy');
  for (const step of ['pages', 'databases', 'views', 'build']) {
    const run = readJson(join(lastRun(w.root, step), 'run.json'));
    assert.equal(run.script, 'setup.mjs');
    assert.equal(run.exit_code, 0);
    assert.ok(run.started_at && run.finished_at);
    assert.equal(run.resume, `node agents/claim-tagger-mvp/scripts/setup.mjs ${step}`);
    assert.ok(existsSync(join(lastRun(w.root, step), 'structure-plan.json')));
  }
});

test('setup build on a table of the build of 16 October (the live step): it says what it renamed, added and brought to the structure, verify is clean afterwards, and a second build writes nothing', async () => {
  const w = newWorld();
  const structure = join(w.root, 'setup', 'structure.json');
  mkdirSync(join(w.root, 'setup'), { recursive: true });
  const old = JSON.parse(readFileSync(new URL('./fixtures/structure.16-oct.json', import.meta.url), 'utf8'));
  writeFileSync(structure, `${JSON.stringify(forFake(old), null, 2)}\n`);
  openBuilder({ root: w.root, reason: 'test' });
  assert.equal((await w.run(['build'])).code, 0);
  writeFileSync(structure, `${JSON.stringify(forFake(revisedStructure()), null, 2)}\n`);

  const before = w.fake.writes().length;
  const r = await w.run(['build']);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.out.filter((l) => /^(pages|tables|columns|views)/.test(l)), [
    'pages: 0 made, 2 there already',
    'tables: 0 made, 5 there already',
    'columns: 10 added (claims: Agent tags, Agent status, Tags waiting, Agent edition, Agent remarks, Agent reading; tag_decisions: Agent reading, Rule, Reading note, Read under)',
    'columns renamed: 4 (claims: Claim quality tags — verified -> Verified tags, Agent tags -> Agent tags (old), Agent notes -> Agent notes (old), Why wrong -> Why wrong (old))',
    'views: 0 made, 7 there already',
    'views brought to the structure: claims: Your queue (filter, column order); claims: Needs your note (filter, column order); claims: Agent disagreed (filter, column order); tag_decisions: Your queue (ledger) (column order); tag_decisions: Needs your note (ledger) (filter, column order)',
  ]);
  assert.equal(w.fake.writes().length - before, 3 + 5, 'three column requests (renames, the claims\' additions, the ledger\'s) and five views; the fake has no default view of its own');

  const verified = await w.run(['verify']);
  assert.doesNotMatch(verified.text, /claims: (missing column|type|extra column|view)/, verified.text);
  const writes = w.fake.writes().length;
  const again = await w.run(['build']);
  assert.equal(again.code, 0);
  assert.ok(!again.out.some((l) => /renamed|brought/.test(l)), again.out.join('\n'));
  assert.equal(w.fake.writes().length, writes, 'nothing to rename, add or set: not one write');
});

test('setup build on the copy of 21 October (the live step of the reading): it says what it renamed, added and put in order, verify is clean afterwards, and a second build writes nothing', async () => {
  const w = newWorld();
  const structure = join(w.root, 'setup', 'structure.json');
  mkdirSync(join(w.root, 'setup'), { recursive: true });
  const write = (s) => writeFileSync(structure, `${JSON.stringify(forFake(s), null, 2)}\n`);
  openBuilder({ root: w.root, reason: 'test' });
  write(JSON.parse(readFileSync(new URL('./fixtures/structure.16-oct.json', import.meta.url), 'utf8')));
  assert.equal((await w.run(['build'])).code, 0);
  write(JSON.parse(readFileSync(new URL('./fixtures/structure.21-oct.json', import.meta.url), 'utf8'))); // the live copy as it stands today
  assert.equal((await w.run(['build'])).code, 0);
  assert.equal((await w.run(['verify'])).err.some((l) => /claims: (missing column|type|view)/.test(l)), false, 'the copy is as the structure of 21 October says');
  write(revisedStructure());

  const before = w.fake.writes().length;
  const r = await w.run(['build']);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.out.filter((l) => /^(pages|tables|columns|views)/.test(l)), [
    'pages: 0 made, 2 there already',
    'tables: 0 made, 5 there already',
    'columns: 5 added (claims: Agent reading; tag_decisions: Agent reading, Rule, Reading note, Read under)',
    'columns renamed: 1 (claims: Why wrong -> Why wrong (old))',
    'views: 0 made, 7 there already',
    'views brought to the structure: claims: Your queue (column order); claims: Needs your note (filter, column order); claims: Agent disagreed (column order); tag_decisions: Your queue (ledger) (column order); tag_decisions: Needs your note (ledger) (filter, column order)',
  ]);
  assert.equal(w.fake.writes().length - before, 3 + 5, 'three column requests (the rename, the claims\' addition, the ledger\'s) and five views');

  const verified = await w.run(['verify']);
  assert.doesNotMatch(verified.text, /(claims|tag_decisions): (missing column|type|extra column|options|view)/, verified.text);
  assert.match(verified.text, /verify: .* 0 write\(s\)/);
  const writes = w.fake.writes().length;
  const again = await w.run(['build']);
  assert.equal(again.code, 0);
  assert.deepEqual(again.out.filter((l) => /^(columns|views)/.test(l)), ['columns: 0 added', 'views: 0 made, 7 there already'], 'nothing renamed, nothing brought to the structure');
  assert.equal(w.fake.writes().length, writes, 'a second build plans nothing: not one write');
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
  assert.equal(r.out.at(-1), 'views: 6 made');
  assert.deepEqual(Object.keys(readJson(join(w.root, 'config.json')).notion.views), ['your_queue', 'needs_your_note', 'agent_disagreed', 'your_queue_ledger', 'needs_your_note_ledger', 'lessons_waiting'], 'no key for the view that could not be made: the scripts fall back to the table address');
  const v = await w.run(['verify', '--taxonomy', 'x', '--claims', 'x', '--audit', 'x']);
  assert.match(v.text, /missing view - "Rulebook" is not among the views/);
  const fixed = await w.run(['views']);
  assert.equal(fixed.code, 0);
  assert.equal(fixed.out.at(-1), 'views: 1 made, 6 there already');
  assert.deepEqual(Object.keys(readJson(join(w.root, 'config.json')).notion.views), ['your_queue', 'needs_your_note', 'agent_disagreed', 'your_queue_ledger', 'needs_your_note_ledger', 'lessons_waiting', 'rulebook']);
});

test('verify checks that config.json links every view that exists, and no view that does not', async () => {
  const w = await built();
  const clean = await w.run(['verify', '--taxonomy', 'x', '--claims', 'x', '--audit', 'x']);
  assert.doesNotMatch(clean.text, /view link/, 'a built structure is linked');
  const config = readJson(join(w.root, 'config.json'));
  const kept = structuredClone(config.notion.views);
  delete config.notion.views.needs_your_note;
  config.notion.views.lessons_waiting.id = 'f'.repeat(32);
  config.notion.views.stray = { id: 'a'.repeat(32), url: 'https://www.notion.so/x' };
  writeFileSync(join(w.root, 'config.json'), JSON.stringify(config, null, 2));
  const r = await w.run(['verify', '--taxonomy', 'x', '--claims', 'x', '--audit', 'x']);
  const text = r.err.join('\n');
  assert.match(text, /claims: view link - "Needs your note" is in Notion but config\.json has no notion\.views\.needs_your_note; run "setup\.mjs views" to record it/);
  assert.match(text, /rule_changes: view link - notion\.views\.lessons_waiting in config\.json says .*, but the view in Notion is /);
  const fix = await w.run(['views']);
  assert.equal(fix.code, 0, fix.text);
  assert.deepEqual(readJson(join(w.root, 'config.json')).notion.views.lessons_waiting, kept.lessons_waiting, 'the next run puts the right id back');
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
  assert.match(r.err.join('\n'), /setup\.mjs structure --options-from <pick file>/, 'it names the command that sets the options from a pick');
  pick.rows[1]['Geo Tags'] = ['Debate'];
  pick.rows[0]['Geo Space'] = 'Elsewhere';
  writeFileSync(join(w.root, 'odd-space.json'), JSON.stringify(pick));
  r = await w.run(['claims', '--from', join(w.root, 'odd-space.json')]);
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /Geo Space is "Elsewhere", which is not one of U\.S\. Politics, World affairs, AI, Health, Crypto, Technology/);
  assert.equal(w.fake.writes().length, writes, 'no request at all');
  assert.deepEqual(unknownOptions(tmp('no-structure'), 'rulebook', [{ key: 'x', properties: { Category: 'Whatever' } }]), [], 'without a structure file there is nothing to compare with');
});

// ---- the claims ----------------------------------------------------------------------------------------------------------------------------------------

// What a row of the Claims table holds, read back, for one row of the pick: the lean Geo columns by their names as the table takes them.
function assertClaimRow(got, want, label = want['Geo ID']) {
  assert.equal(got['Geo Name'], want['Geo Name'], `${label}: Geo Name`);
  assert.equal(got['Geo ID'], want['Geo ID'], `${label}: Geo ID`);
  assert.equal(got['Geo URL'], want['Geo URL'], `${label}: Geo URL`);
  assert.equal(got['Geo Space'], want['Geo Space'], `${label}: Geo Space is a select`);
  assert.equal(got['Geo Created'], want['Geo Created'], `${label}: Geo Created is a date, its start the day of the pick`);
  assert.equal(got['Geo Sources'], want['Geo Sources'], `${label}: Geo Sources`);
  assert.equal(got['Geo Is factual'], want['Geo Is factual'] === true, `${label}: Geo Is factual (null is unticked)`);
  assert.deepEqual([...got['Geo Tags']].sort(), [...want['Geo Tags']].sort(), `${label}: Geo Tags is a multi-select`);
  assert.equal(got['Geo Topics'], want['Geo Topics'], `${label}: Geo Topics`);
}

test('claims: the nine Geo columns of the pick (a select, a date, a multi-select, a box, linked sources), the agent\'s columns empty, the pages kept for the seed', async () => {
  const w = await built({ pick: makePick({ extra: 3 }) });
  const pick = readJson(w.inputs.claims);
  const r = await w.run(['claims', '--from', w.inputs.claims]);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.out, ['claims: 3 row(s) written and read back ok']);
  const dir = lastRun(w.root, 'claims');
  const plan = readPlan(dir);
  for (const op of plan.ops) {
    assert.ok(Object.keys(op.properties).every((c) => CLAIMS_GEO_COLUMNS.includes(c)), `only Geo columns: ${Object.keys(op.properties).join(', ')}`);
    assert.ok(!('month' in op.properties) && !('source_pieces' in op.properties) && !('Review status' in op.properties) && !('Agent tags' in op.properties) && !('Agent status' in op.properties));
  }
  const rows = rowsOf(w, 'claims');
  assert.equal(rows.length, 3);
  for (const want of pick.rows) {
    const got = rows.find((x) => x['Geo ID'] === want['Geo ID']);
    assert.ok(got, want['Geo ID']);
    assertClaimRow(got, want);
    assert.deepEqual([got['Agent tags'], got['Tags waiting'], got['Agent status'], got['Agent edition'], got['Agent remarks']], [[], [], null, '', ''], 'the agent fills its columns at its first tag run');
  }
  assert.equal(rows.find((x) => x['Geo ID'] === pick.rows[2]['Geo ID'])['Geo Is factual'], true);
  assert.equal(rows.find((x) => x['Geo ID'] === pick.rows[1]['Geo ID'])['Geo Is factual'], false);
  // a claim of the pick whose Geo Is factual is null stays unticked
  const planned = plan.ops.find((op) => op.key === pick.rows[0]['Geo ID']);
  assert.equal(planned.properties['Geo Is factual'] ?? false, false);
  // the plan holds plain values: a day, a space name, a list of tag names
  assert.equal(planned.properties['Geo Created'], pick.rows[0]['Geo Created']);
  assert.equal(planned.properties['Geo Space'], pick.rows[0]['Geo Space']);
  assert.deepEqual(planned.properties['Geo Tags'], pick.rows[0]['Geo Tags']);

  // the links of Geo Sources survive: each source's name is linked to its address; the plan holds the text, the write adds where each piece points
  const claimsDb = tableEntries(w.root).claims.database_id;
  const pages = w.fake.rows(claimsDb);
  for (const want of pick.rows) {
    const page = pages.find((p) => p.properties['Geo ID'].rich_text.map((t) => t.plain_text).join('') === want['Geo ID']);
    const hrefs = page.properties['Geo Sources'].rich_text.map((t) => t.href).filter(Boolean);
    assert.deepEqual(hrefs, want.source_pieces.map((p) => p.url), want['Geo ID']);
    assert.equal(page.properties['Geo Sources'].rich_text.map((t) => t.plain_text).join(''), want['Geo Sources']);
    for (const piece of want.source_pieces) {
      assert.ok(page.properties['Geo Sources'].rich_text.some((t) => t.plain_text === piece.name && t.href === piece.url), `${piece.name} is linked to its address`);
    }
  }
  const sidecar = readJson(join(dir, 'rich-text.json'));
  assert.deepEqual(Object.keys(sidecar), [pick.rows[0]['Geo ID'], pick.rows[2]['Geo ID']]);
  assert.deepEqual(sidecar[pick.rows[0]['Geo ID']].map((p) => Object.keys(p).sort()), [['href', 'text'], ['href', 'text'], ['href', 'text']], 'the pieces are text and href (the names, a line break, the names)');

  const pagesFile = readJson(join(w.root, 'setup', 'claims-pages.json'));
  assert.deepEqual(Object.fromEntries(rows.map((x) => [x['Geo ID'], x.page_id])), pagesFile);
  const writes = w.fake.writes().length;
  const again = await w.run(['claims', '--from', w.inputs.claims]);
  assert.match(again.out[0], /all 3 rows are in the table already/);
  assert.equal(w.fake.writes().length, writes);
});

test('claims from a 200-row Geo pick: every row has its date, space, tags and source links, and the step takes the pick as its default input', async () => {
  const audit = readAuditFile();
  const pick = makePick({ audit, extra: 190 });
  assert.equal(pick.rows.length, 200);
  const w = await built({ pick });
  // no --from: setup/geo-claims-pick.json is the default
  mkdirSync(join(w.root, 'setup'), { recursive: true });
  writeFileSync(join(w.root, 'setup', 'geo-claims-pick.json'), `${JSON.stringify(pick, null, 2)}\n`);
  const r = await w.run(['claims']);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.out, ['claims: 200 row(s) written and read back ok']);
  const rows = rowsOf(w, 'claims');
  assert.equal(rows.length, 200);
  const byId = new Map(rows.map((x) => [x['Geo ID'], x]));
  for (const want of pick.rows) assertClaimRow(byId.get(want['Geo ID']), want);
  assert.deepEqual([...new Set(rows.map((x) => x['Geo Space']))].sort(), [...SPACE_NAMES].sort(), 'all six spaces');
  assert.ok(rows.every((x) => /^2026-0[89]-\d\d$|^2026-10-\d\d$/.test(x['Geo Created'])), 'a day for every claim');
  const linked = pick.rows.filter((x) => x.source_pieces.length);
  assert.ok(linked.length > 90);
  const pages = w.fake.rows(tableEntries(w.root).claims.database_id);
  const withLinks = pages.filter((p) => p.properties['Geo Sources'].rich_text.some((t) => t.href));
  assert.equal(withLinks.length, linked.length);

  // the whole setup on the 200 claims, then verify: 200 = the pick; a pick of 201 rows is a difference
  const all = await w.run(allArgs(w));
  assert.equal(all.code, 0, all.text);
  const verify = readJson(join(w.root, 'runs', 'builder', 'verify.json'));
  assert.deepEqual(verify.differences, []);
  assert.equal(verify.counts.claims, 200);
  assert.equal(verify.counts.tag_decisions, 10);
  writeFileSync(join(w.root, 'bigger.json'), JSON.stringify(makePick({ audit, extra: 191 })));
  const bigger = await w.run(['verify', '--taxonomy', w.inputs.taxonomy, '--claims', join(w.root, 'bigger.json'), '--audit', w.inputs.audit]);
  assert.equal(bigger.code, 2);
  assert.match(bigger.err.join('\n'), /claims: row count - 200 rows in the Claims table, 201 in the pick/);
});

test('verify compares the links of Geo Sources as addresses: a bare origin that Notion hands back with its trailing slash is no difference, a really different link is', async () => {
  const pick = makePick({ audit: readAuditFile() });
  pick.rows[0].source_pieces[1].url = 'https://example.com'; // Notion stores a bare origin with the slash its path gets
  const w = await filled({ pick });
  const client = builderClient(w.fake);
  const row = rowsOf(w, 'claims').find((x) => x['Geo ID'] === pick.rows[0]['Geo ID']);
  const pieces = w.fake.rows(tableEntries(w.root).claims.database_id).find((p) => p.id === row.page_id).properties['Geo Sources'].rich_text;
  assert.ok(pieces.some((t) => t.href === 'https://example.com'), 'the link was written as the pick has it');
  // the same cell with only the address of one link changed
  const relink = (change) => client.updatePage(row.page_id, { properties: { 'Geo Sources': { rich_text: pieces.map((t) => ({ type: 'text', text: { content: t.plain_text, link: t.href ? { url: change(t.href) } : null } })) } } });

  await relink((href) => (href === 'https://example.com' ? 'https://example.com/' : href));
  const slashed = await w.run(verifyArgs(w));
  assert.equal(slashed.code, 0, slashed.text);
  assert.doesNotMatch(slashed.text, /claims: links/);

  await relink((href) => (href === 'https://example.com' ? 'https://example.org/' : href));
  const different = await w.run(verifyArgs(w));
  assert.equal(different.code, 2);
  assert.match(different.err.join('\n'), new RegExp(`claims: links - ${pick.rows[0]['Geo ID']}: Geo Sources has 2 link\\(s\\) in Notion and 2 in the pick`));
});

test('setup verify with a hub block reads the hub title, the order of its body, the archive record and the protected ids back; it is clean only when the page is in order', async () => {
  const w = await filled();
  const ok = await w.run(verifyArgs(w));
  assert.equal(ok.code, 0, ok.text);
  assert.equal(readJson(join(w.root, 'runs', 'builder', 'verify.json')).ok, true);

  const client = builderClient(w.fake);
  const rename = (title) => client.updatePage(w.parent, { properties: { title: { title: [{ type: 'text', text: { content: title } }] } } });
  await rename('Feedback Distillation MVP');
  let r = await w.run(verifyArgs(w));
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /hub: title - the hub page is called "Feedback Distillation MVP" and should be called "Claim tagger"/);
  await rename('Claim tagger');

  // a block that is none of the hub's: reported, so verify is not ok
  await client.appendBlocks(w.parent, [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Stray note' } }] } }], { position: { type: 'start' } });
  r = await w.run(verifyArgs(w));
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /hub: leftover - a block that is none of these is on the hub page and was left as it is: paragraph "Stray note"/);

  // the archive record: an archive step that stopped halfway, then one that is done but names a page that cannot be read
  writeFileSync(join(w.root, 'setup', 'archive.json'), JSON.stringify({ state: 'moving' }));
  r = await w.run(verifyArgs(w));
  assert.match(r.err.join('\n'), /archive: archive file - setup\/archive\.json says state "moving": the archive step has not finished/);
  writeFileSync(join(w.root, 'setup', 'archive.json'), JSON.stringify({ state: 'done', archive_page: 'e'.repeat(32), moved: [], practice_pages: [], tables: [] }));
  r = await w.run(verifyArgs(w));
  assert.match(r.err.join('\n'), /archive: archive page - the Archive page cannot be read/);
  assert.equal(readJson(join(w.root, 'runs', 'builder', 'verify.json')).requests.writes, 0, 'verify only read');
});

test('a claim with a tag that is not an option of Geo Tags is refused before anything is written, and the message names setup.mjs structure --options-from', async () => {
  const w = await built();
  const pick = makePick({ audit: readAuditFile(), extra: 5 });
  pick.rows[4]['Geo Tags'] = ['Debate', 'Immigration'];
  pick.tag_names = ['Debate', 'Economy', 'Immigration'];
  writeFileSync(join(w.root, 'more-tags.json'), JSON.stringify(pick));
  const writes = w.fake.writes().length;
  const r = await w.run(['claims', '--from', join(w.root, 'more-tags.json')]);
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /nothing was written, because Notion would add options/);
  assert.match(r.err.join('\n'), /Geo Tags is "Immigration", which is not one of Debate, Economy/);
  assert.match(r.err.join('\n'), /run "setup\.mjs structure --options-from <pick file>"/);
  assert.equal(w.fake.writes().length, writes);
  // the options from this pick make it pass
  const o = await w.run(['structure', '--options-from', join(w.root, 'more-tags.json')]);
  assert.equal(o.code, 0, o.text);
  assert.deepEqual(readJson(join(w.root, 'setup', 'structure.json')).tables.claims.columns.find((c) => c.name === 'Geo Tags').options, ['Debate', 'Economy', 'Immigration']);
});

test('a claims-pages.json or rulebook-pages.json of an earlier build is never merged: a key the input does not have stops the step with exit 2 and says to set the file aside', async () => {
  const w = await built();
  mkdirSync(join(w.root, 'setup'), { recursive: true });
  const old = { [`${'a'.repeat(31)}1`]: '3f2273e2-14eb-819a-89ae-e658e01e094b' };
  writeFileSync(join(w.root, 'setup', 'claims-pages.json'), JSON.stringify(old));
  const writes = w.fake.writes().length;
  let r = await w.run(['claims', '--from', w.inputs.claims]);
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /claims-pages\.json holds 1 claim\(s\) that the current input does not have/);
  assert.match(r.err.join('\n'), /Set it aside \(git mv it to setup\/archive-2026-10\/\)/);
  assert.equal(w.fake.writes().length, writes, 'nothing was written');
  assert.deepEqual(readJson(join(w.root, 'setup', 'claims-pages.json')), old, 'and the file is as it was');

  writeFileSync(join(w.root, 'setup', 'rulebook-pages.json'), JSON.stringify({ 'Old tag': '3f2273e2-14eb-819a-89ae-e658e01e094c' }));
  r = await w.run(['rulebook', '--from', w.inputs.taxonomy]);
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /rulebook-pages\.json holds 1 tag\(s\) that the current input does not have \(Old tag\)/);
  r = await w.run(['rubric', '--from', w.inputs.taxonomy]);
  assert.equal(r.code, 2, 'the rubric step does not read the ids of another build either');
  assert.match(r.err.join('\n'), /rulebook-pages\.json holds 1 tag\(s\)/);

  // set aside, the steps run, and the file holds only the new ids
  rmSync(join(w.root, 'setup', 'claims-pages.json'));
  rmSync(join(w.root, 'setup', 'rulebook-pages.json'));
  assert.equal((await w.run(['claims', '--from', w.inputs.claims])).code, 0);
  assert.equal(Object.keys(readJson(join(w.root, 'setup', 'claims-pages.json'))).length, 13);
});

test('a link in Geo Sources that points at a protected table or page is refused: the links go in beside the plan, so setup looks at them itself', async () => {
  const w = await built();
  const pick = makePick({ extra: 2 });
  const protectedId = w.config.notion.protected_database_ids[0].replace(/-/g, '');
  pick.rows[0].source_pieces[0].url = `https://www.notion.so/${protectedId}`;
  writeFileSync(join(w.root, 'trap-pick.json'), JSON.stringify(pick));
  const writes = w.fake.writes().length;
  const r = await w.run(['claims', '--from', join(w.root, 'trap-pick.json')]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /1 claim\(s\) \(ee000+\) point at a protected table or page/);
  assert.equal(w.fake.writes().length, writes);
  assert.deepEqual(protectedInLinks(w.config, new Map([['g', [{ text: 'x', href: 'https://example.com/a' }, { text: 'y', href: null }]]])), []);
});

test('a pick that is not a Geo pick is refused with exit 2: the 50-row pick of the first build, a repeated Geo ID, no Geo Name, no rows, a claim the audit block says is included but is not there', async () => {
  const w = await built();
  const bad = (pick, re) => {
    const file = join(w.root, `pick-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify(pick));
    return w.run(['claims', '--from', file]).then((r) => {
      assert.equal(r.code, 2);
      assert.match(r.err.join('\n'), re);
    });
  };
  const good = makePick({ extra: 2 });
  await bad({ ...good, rows: [good.rows[0], good.rows[0]] }, /appears twice/);
  await bad({ ...good, rows: [{ ...good.rows[0], 'Geo Name': '' }] }, /is not a Geo pick[\s\S]*Geo Name/);
  await bad({ ...good, rows: [] }, /is not a Geo pick[\s\S]*rows/);
  await bad({ ...good, audit: { ...good.audit, included: ['f'.repeat(32)] } }, /includes 1 audit claim\(s\) that are not among its rows/);
  // the old pick of 50 rows (no pick_version) is named for what it is, with the way to the new one
  const oldPick = { seed: 'x', picked_at: '2026-10-15T11:32:48.918Z', dry_run: 'dry-1', audit_ids: [], random_ids: [], rows: [{ 'Geo ID': 'g', 'Geo Name': 'n' }] };
  await bad(oldPick, /is the 50-row pick of the first build[\s\S]*geo-pick\.mjs --seed <s> --audit <file>/);
  assert.equal(rowsOf(w, 'claims').length, 0);
  assert.throws(() => readPick(join(w.root, 'nope.json')), /the claims pick does not exist/);
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

test('seed-audit needs the claims first, and every audited claim must have its row in the Claims table', async () => {
  const w = await built();
  const r = await w.run(['seed-audit', '--from', w.inputs.audit, '--claims', w.inputs.claims]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /claims-pages\.json does not exist: run "setup\.mjs claims" first/);
  await w.run(['claims', '--from', w.inputs.claims]);
  // a claim of the pick that is in the file of pages but whose row is not there would be named: the unit says so
  assert.throws(() => auditOps(readAuditFile(), { [readAuditFile().decisions[0].geo_id]: 'p' }), (e) => e instanceof InputError && /9 audited claim\(s\) have no row in the Claims table yet/.test(e.message));
  assert.equal(rowsOf(w, 'tag_decisions').length, 0);
});

test('seed-audit seeds only the audit claims the pick includes, names each one it left out with the pick\'s reason, and refuses an audit file that is not the one the pick was made with', async () => {
  const audit = readAuditFile();
  const include = audit.decisions.slice(0, 6).map((d) => d.geo_id);
  const pick = makePick({ audit, extra: 2, include });
  assert.equal(pick.audit.left_out.length, 4);
  pick.audit.left_out[0].reason = 'not tagged Debate in a canonical space (tagged Debate in space b00, which is not one of the 6 pick spaces)';
  const w = await built({ pick });
  await w.run(['claims', '--from', w.inputs.claims]);

  // another audit file (one more decision, so other bytes): refused with the digests, nothing written
  const other = structuredClone(audit);
  other.decisions.push({ ...audit.decisions[0], geo_id: 'f'.repeat(32) });
  writeFileSync(join(w.root, 'audit-other.json'), `${JSON.stringify(other, null, 2)}\n`);
  const writes = w.fake.writes().length;
  let r = await w.run(['seed-audit', '--from', join(w.root, 'audit-other.json'), '--claims', w.inputs.claims]);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /is not the one the pick was made with \(its sha256 is [0-9a-f]{12}…, the pick recorded [0-9a-f]{12}…\)/);
  assert.equal(w.fake.writes().length, writes);
  assert.equal(rowsOf(w, 'tag_decisions').length, 0);

  // the file the pick was made with: six decisions, four left out and named
  r = await w.run(['seed-audit', '--from', w.inputs.audit, '--claims', w.inputs.claims]);
  assert.equal(r.code, 0, r.text);
  assert.equal(r.out[0], 'seed-audit: 6 row(s) written and read back ok');
  assert.ok(r.out.includes(`seed-audit: ${AUDIT_NOTE}`));
  assert.ok(r.out.includes('seed-audit: 6 of the 10 audit claims are in the pick; the others:'));
  const leftLines = r.out.filter((l) => /left out of the pick, so not seeded/.test(l));
  assert.equal(leftLines.length, 4);
  for (const l of pick.audit.left_out) assert.ok(leftLines.some((x) => x.includes(l.geo_id) && x.includes(l.reason)), `${l.geo_id} is named with its reason`);
  const rows = rowsOf(w, 'tag_decisions');
  assert.deepEqual(rows.map((x) => x.Key.split('::')[0]).sort(), [...include].sort());
  assert.equal(readJson(join(w.root, 'setup', 'audit-decisions.json')).decisions.length, 10, 'the audit file is kept as it is');
  const plan = readPlan(lastRun(w.root, 'seed-audit'));
  assert.deepEqual(plan.header.plan.counts, { creates: 6, updates: 0 });

  // migrate-decisions carries over the same six and no others
  await w.run(['rulebook', '--from', w.inputs.taxonomy]);
  const m = await w.run(['migrate-decisions', '--claims', w.inputs.claims]);
  assert.equal(m.code, 0, m.text);
  assert.match(m.out[0], /^migrate-decisions: 6 claim\(s\) carried over,/);
  assert.equal(rowsOf(w, 'claims').filter((c) => c['Review status'] === 'Reviewed').length, 6);
});

test('seed-audit with a pick that includes no audit claim seeds nothing and says so, and the left-out claims are still named', async () => {
  const audit = readAuditFile();
  const pick = makePick({ audit, extra: 3, include: [] });
  assert.deepEqual(pick.audit.included, []);
  const w = await built({ pick });
  await w.run(['claims', '--from', w.inputs.claims]);
  const writes = w.fake.writes().length;
  const r = await w.run(['seed-audit', '--from', w.inputs.audit, '--claims', w.inputs.claims]);
  assert.equal(r.code, 0, r.text);
  assert.equal(r.out[0], 'seed-audit: the pick includes none of the 10 audit claims, so no decision was seeded');
  assert.equal(r.out.filter((l) => /left out of the pick/.test(l)).length, 10);
  assert.equal(w.fake.writes().length, writes);
  assert.equal(rowsOf(w, 'tag_decisions').length, 0);
  const m = await w.run(['migrate-decisions', '--claims', w.inputs.claims]);
  assert.equal(m.code, 0, m.text);
  assert.match(m.out[0], /nothing to carry over/);
});

test('auditForPick: the decisions the pick includes in the audit file\'s order, the others with the pick\'s reason (or the missing one), and the digest checked only when a file is given', () => {
  const audit = readAuditFile();
  const pick = makePick({ audit, extra: 0, include: [audit.decisions[3].geo_id, audit.decisions[1].geo_id] });
  const r = auditForPick(audit, pick);
  assert.deepEqual(r.decisions.map((d) => d.geo_id), [audit.decisions[1].geo_id, audit.decisions[3].geo_id]);
  assert.equal(r.left.length, 8);
  assert.equal(r.left[0].reason, 'not tagged Debate in a canonical space');
  assert.equal(auditForPick(audit, { ...pick, audit: { ...pick.audit, left_out: [] } }).left[0].reason, 'the pick lists it neither as included nor as left out');
  assert.throws(() => auditForPick({ decisions: audit.decisions.slice(0, 2) }, pick), /includes 1 audit claim\(s\) that the audit file does not hold/);
  assert.throws(() => auditForPick(audit, pick, AUDIT_FILE), /is not the one the pick was made with/, 'a file whose bytes are other than the ones the pick recorded (the evidence copy is formatted differently)');
});

test('seed-audit: ten decided rows of the ledger through a setup plan; the ledger has no editor column, so the plan needs no exception', async () => {
  const w = await built();
  await w.run(['claims', '--from', w.inputs.claims]);
  const r = await w.run(['seed-audit', '--from', w.inputs.audit]);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.out, ['seed-audit: 10 row(s) written and read back ok', `seed-audit: ${AUDIT_NOTE}`, 'seed-audit: 10 of the 10 audit claims are in the pick']);
  assert.equal(AUDIT_NOTE, 'seeded from the audit of 9 October');
  const dir = lastRun(w.root, 'seed-audit');
  assert.equal(readJson(join(dir, 'run.json')).note, 'seeded from the audit of 9 October');
  const plan = readPlan(dir);
  assert.deepEqual(plan.header.plan.counts, { creates: 10, updates: 0 });

  // Tag outcome, Why wrong and Your reasoning are the agent's columns of the ledger now: the plan passes as a setup plan and as a plain one
  assert.equal(checkPlan(plan, w.config, { setup: true, root: w.root }).ok, true);
  assert.equal(checkPlan(plan, w.config, { setup: false, root: w.root }).ok, true);
  for (const op of plan.ops) {
    assert.ok(op.properties['Your reasoning'].startsWith(AUDIT_PREFIX));
    assert.ok(!('Agent confidence' in op.properties) && !('Agent reason' in op.properties) && !('Rulebook edition' in op.properties) && !('Follow-up' in op.properties));
    // decision 73: on the live copy the audit's disagreements are read later, by distill; the seeding writes no reading, no rule, no note on a reading and no Read under
    for (const column of READING_COLUMNS) assert.ok(!(column in op.properties), `the seeding does not write ${column}`);
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
    assert.deepEqual([row['Agent reading'], row.Rule, row['Reading note'], row['Read under']], [null, '', '', ''], 'unread: the model reads the audit disagreements later');
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

test('no other path writes the editor columns: a plan that is not a setup plan, or a claim without the prefix, is refused', async () => {
  const w = await built();
  const { newPlan } = await import('../../agents/claim-tagger-mvp/scripts/lib/plan.mjs');
  const plan = newPlan({ runId: 'r', script: 'propose.mjs', rubricEdition: EDITION, config: w.config, now: NOW });
  plan.update('claims', 'g', 'a-page', { 'Review status': 'Reviewed', 'Challenged tags notes': 'From the audit of 9 October: sneaky' });
  assert.equal(checkPlan(plan, w.config, { root: w.root }).ok, false, 'not a setup plan');
  const second = newPlan({ runId: 'r', script: 'setup.mjs', rubricEdition: null, config: w.config, now: NOW });
  second.update('claims', 'g', 'a-page', { 'Review status': 'Reviewed', 'Challenged tags notes': 'a reason' });
  assert.equal(checkPlan(second, w.config, { setup: true, root: w.root }).ok, false, 'a setup plan without the prefix');
  const third = newPlan({ runId: 'r', script: 'setup.mjs', rubricEdition: null, config: w.config, now: NOW });
  third.create('agent_settings', 'Claim tagger', { Name: 'Claim tagger', Paused: false });
  assert.equal(checkPlan(third, w.config, { setup: true, root: w.root }).ok, false, 'Paused belongs to a person even at setup');
});

// ---- migrate-decisions ----------------------------------------------------------------------------------------------------------------------------

async function seeded() {
  const w = await built();
  for (const step of [['rulebook', '--from', w.inputs.taxonomy], ['claims', '--from', w.inputs.claims], ['seed-audit', '--from', w.inputs.audit]]) {
    const r = await w.run(step);
    assert.equal(r.code, 0, r.text);
  }
  return w;
}
const claimOf = (w, geoId) => rowsOf(w, 'claims').find((c) => c['Geo ID'] === geoId);

test('claims: the editor columns of the Claims table and the agent\'s stay empty on a new row', async () => {
  const w = await built();
  await w.run(['claims', '--from', w.inputs.claims]);
  for (const c of rowsOf(w, 'claims')) {
    assert.deepEqual([c['Verified tags'], c['Review status'], c['Challenged tags notes'], c['Agent confidence'], c['Agent reading']], [[], null, '', null, ''], c['Geo ID']);
    assert.ok(!('Why wrong' in c) && !('Why wrong (old)' in c), 'the Claims table has no Why wrong column to fill, and a new table makes no retired one');
  }
});

test('migrate-decisions: the ten audit decisions move from the ledger to their claims, once, through a setup plan that is read back', async () => {
  const w = await seeded();
  const audit = readAuditFile();
  const r = await w.run(['migrate-decisions']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.out[0], /^migrate-decisions: 10 claim\(s\) carried over, 0 ledger row\(s\) got Decided under, 0 claim\(s\) got Agent confidence; read back ok$/);
  assert.equal(r.out[1], `migrate-decisions: ${AUDIT_NOTE}`);
  const dir = lastRun(w.root, 'migrate-decisions');
  assert.equal(readJson(join(dir, 'run.json')).note, AUDIT_NOTE);
  assert.equal(readJson(join(dir, 'run.json')).exit_code, 0);
  const plan = readPlan(dir);
  assert.deepEqual(plan.header.plan.counts, { creates: 0, updates: 10 });
  assert.ok(plan.ops.every((op) => op.table === 'claims' && op.op === 'update' && op.properties['Review status'] === 'Reviewed' && op.properties['Challenged tags notes'].startsWith(AUDIT_PREFIX)));
  assert.ok(plan.ops.every((op) => JSON.stringify(op.expect) === JSON.stringify({ 'Review status': null })), 'an editor who got there first is not overwritten');
  // the editor fills three columns now: the migration writes the verified tags, Review status and the notes, no Why wrong (the column is gone) and no reading
  assert.ok(plan.ops.every((op) => JSON.stringify(Object.keys(op.properties).sort()) === JSON.stringify(['Challenged tags notes', 'Review status', 'Verified tags'])), 'three columns, nothing else');
  for (const op of plan.ops) for (const column of ['Why wrong', 'Why wrong (old)', 'Agent reading']) assert.ok(!(column in op.properties), column);
  assert.equal(checkPlan(plan, w.config, { setup: true, root: w.root }).ok, true);
  assert.equal(checkPlan(plan, w.config, { setup: false, root: w.root }).ok, false, 'only a setup plan may write the editor columns, and only with the prefix');
  assert.ok(existsSync(join(dir, 'ledger.jsonl')) && existsSync(join(dir, 'requests.jsonl')));

  const tagPage = new Map(rowsOf(w, 'rulebook').map((t) => [t.Name, t.page_id]));
  for (const d of audit.decisions) {
    const c = claimOf(w, d.geo_id);
    assert.deepEqual(c['Verified tags'], d.outcome === 'Applies' ? [tagPage.get('Context-dependent')] : [], d.geo_id);
    assert.equal(c['Review status'], 'Reviewed');
    assert.equal(c['Challenged tags notes'], `${AUDIT_PREFIX}: ${d.reasoning ?? NO_REASONING}`);
  }
  assert.equal(rowsOf(w, 'claims').filter((c) => c['Review status'] === 'Reviewed').length, 10);
  assert.equal(rowsOf(w, 'claims').filter((c) => c['Agent reading'] !== '').length, 0, 'no claim has an Agent reading: distill writes it');
  assert.equal(rowsOf(w, 'tag_decisions').length, 10, 'the ledger rows are still there');
  assert.equal(rowsOf(w, 'tag_decisions').filter((x) => x['Agent reading'] !== null || x['Read under'] !== '').length, 0, 'and unread');

  // a second run finds everything done and writes nothing
  const writes = w.fake.writes().length;
  const again = await w.run(['migrate-decisions']);
  assert.equal(again.code, 0);
  assert.deepEqual(again.out, ['migrate-decisions: nothing to carry over; 10 were carried over already']);
  assert.equal(w.fake.writes().length, writes);
});

test('migrate-decisions: an open ledger row gives its claim the Agent confidence, a recorded edition becomes Decided under, and an editor\'s own work is left alone', async () => {
  const w = await seeded();
  const audit = readAuditFile();
  const entries = tableEntries(w.root);
  const [first, second] = audit.decisions;
  const decided = (d) => rowsOf(w, 'tag_decisions').find((x) => x.Key === `${d.geo_id}::Context-dependent`);
  // the ledger rows of two decisions record the edition their proposal was made under; the second claim was already worked on by an editor
  w.fake.editRow(decided(first).page_id, { 'Rulebook edition': '2026-10-15.1' });
  w.fake.editRow(decided(second).page_id, { 'Rulebook edition': '2026-10-15.1' });
  w.fake.editRow(claimOf(w, second.geo_id).page_id, { 'Review status': 'To review', 'Challenged tags notes': 'Context-dependent: my own note' });
  // two open rows of the ledger, one on a claim with a decision of its own and one on an extra claim
  const extra = rowsOf(w, 'claims').find((c) => c['Geo ID'].startsWith('ee'));
  w.fake.addRow(entries.tag_decisions.database_id, { Claim: 'An extra claim', Key: `${extra['Geo ID']}::Context-dependent`, Tag: 'Context-dependent', 'Agent proposal': "Can't tell", 'Agent confidence': 0.65, 'Rulebook edition': '2026-10-15.1' });
  // a decided row that is not from the audit: a person decides on the claim, never a script
  const other = rowsOf(w, 'claims').filter((c) => c['Geo ID'].startsWith('ee'))[1];
  w.fake.addRow(entries.tag_decisions.database_id, { Claim: 'Another claim', Key: `${other['Geo ID']}::Context-dependent`, Tag: 'Context-dependent', 'Agent proposal': 'Applies', 'Tag outcome': 'Does not apply', 'Your reasoning': 'My words.' });

  // an open ledger row on one of the audit claims gives that claim its Agent confidence
  const audited = audit.decisions[4];
  w.fake.addRow(entries.tag_decisions.database_id, { Claim: 'An audited claim, open again', Key: `${audited.geo_id}::Exact duplicate`, Tag: 'Exact duplicate', 'Agent proposal': "Can't tell", 'Agent confidence': 0.58 });

  const r = await w.run(['migrate-decisions']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.out[0], /^migrate-decisions: 9 claim\(s\) carried over, 1 ledger row\(s\) got Decided under, 1 claim\(s\) got Agent confidence; read back ok; 1 were carried over already; 2 ledger row\(s\) are for claims the pick does not include and were left/);
  assert.equal(decided(first)['Decided under'], '2026-10-15.1');
  assert.equal(decided(second)['Decided under'], '', 'the claim was not carried over, so its ledger row is not touched');
  assert.equal(claimOf(w, second.geo_id)['Review status'], 'To review', 'the editor\'s own work stays');
  assert.equal(claimOf(w, second.geo_id)['Challenged tags notes'], 'Context-dependent: my own note');
  // only the audit claims the pick includes are migrated: the ledger rows of the other two claims are left, whatever they hold
  assert.equal(claimOf(w, extra['Geo ID'])['Agent confidence'], null);
  assert.equal(claimOf(w, extra['Geo ID'])['Review status'], null, 'an open claim is not Reviewed by a script');
  assert.equal(claimOf(w, other['Geo ID'])['Review status'], null);
  assert.deepEqual(claimOf(w, other['Geo ID'])['Verified tags'], []);
  assert.equal(claimOf(w, audited.geo_id)['Review status'], 'Reviewed');
  assert.equal(claimOf(w, audited.geo_id)['Agent confidence'], 0.58, 'an open ledger row of an audit claim still gives the claim its confidence');
  const plan = readPlan(lastRun(w.root, 'migrate-decisions'));
  assert.deepEqual(plan.header.plan.counts, { creates: 0, updates: 10 }, 'nine claims with a decision, one ledger row');
  assert.ok(plan.ops.every((op) => op.table === 'tag_decisions' || 'Review status' in op.properties), 'no claim got a confidence alone');
});

test('migrate-decisions needs the Rulebook for the tags the audit says apply: without it nothing is written and the exit is 2', async () => {
  const w = await built();
  await w.run(['claims', '--from', w.inputs.claims]);
  await w.run(['seed-audit', '--from', w.inputs.audit]);
  const noTag = await w.run(['migrate-decisions']);
  assert.equal(noTag.code, 2, 'no Rulebook row for Context-dependent yet');
  assert.match(noTag.err.join('\n'), /was decided Applies for Context-dependent, which has no row in the Rulebook/);
  assert.equal(rowsOf(w, 'claims').filter((c) => c['Review status']).length, 0, 'nothing was written');
  await w.run(['rulebook', '--from', w.inputs.taxonomy]);
  const fixed = await w.run(['migrate-decisions']);
  assert.equal(fixed.code, 0, fixed.text);
});

test('migrate-decisions waits for a builder session like the other row steps', async () => {
  const w = newWorld({ structure: true });
  const r = await w.run(['migrate-decisions']);
  assert.equal(r.code, 2);
  assert.match(r.err[0], /no builder session is open/);
});

test('migrationOps: the plan from the rows, without a request', () => {
  const claim = (geo, over = {}) => ({ geo_id: geo, page_id: `p-${geo}`, agent_confidence: null, verified_tags: [], review_status: null, why_wrong: null, challenged_notes: '', ...over });
  const row = (geo, over = {}) => ({ Key: `${geo}::Context-dependent`, Tag: 'Context-dependent', page_id: `l-${geo}`, decided: false, 'Agent confidence': null, 'Rulebook edition': null, 'Decided under': null, ...over });
  const audit = (geo, outcome, over = {}) => row(geo, { decided: true, 'Tag outcome': outcome, 'Your reasoning': `${AUDIT_PREFIX}: why`, 'Why wrong': 'Agent slip', ...over });
  const columns = { verified: 'V', review_status: 'R', notes: 'N', confidence: 'C' };
  const ops = migrationOps(
    [claim('a'), claim('b'), claim('c', { review_status: 'Reviewed' }), claim('d'), claim('e', { agent_confidence: 0.7 })],
    [audit('a', 'Applies', { 'Rulebook edition': '2026-10-15.1' }), audit('b', 'Does not apply'), audit('c', 'Applies'), row('d', { 'Agent confidence': 0.61 }), row('e', { 'Agent confidence': 0.55 }), row('zzz')],
    { 'Context-dependent': 'tag-page' },
    columns,
  );
  assert.deepEqual(ops.claimOps, [
    { key: 'a', page_id: 'p-a', properties: { V: ['tag-page'], R: 'Reviewed', N: `${AUDIT_PREFIX}: why` }, expect: { R: null } },
    { key: 'b', page_id: 'p-b', properties: { V: [], R: 'Reviewed', N: `${AUDIT_PREFIX}: why` }, expect: { R: null } },
    { key: 'd', page_id: 'p-d', properties: { C: 0.61 } },
  ]);
  assert.deepEqual(ops.ledgerOps, [{ key: 'a::Context-dependent', page_id: 'l-a', properties: { 'Decided under': '2026-10-15.1' } }]);
  assert.deepEqual(ops.summary, { carried: 2, alreadyCarried: 1, notFromAudit: 0, noClaim: 1, decidedUnder: 1, confidence: 1, notIncluded: 0 });
  // with `only` (the audit claims the pick includes) a ledger row for any other claim is left alone, confidence rows included
  const some = migrationOps(
    [claim('a'), claim('b'), claim('d')],
    [audit('a', 'Applies'), audit('b', 'Does not apply'), row('d', { 'Agent confidence': 0.61 })],
    { 'Context-dependent': 'tag-page' },
    columns,
    { only: new Set(['a']) },
  );
  assert.deepEqual(some.claimOps.map((o) => o.key), ['a']);
  assert.deepEqual(some.summary, { carried: 1, alreadyCarried: 0, notFromAudit: 0, noClaim: 0, decidedUnder: 0, confidence: 0, notIncluded: 2 });
  assert.throws(() => migrationOps([claim('a')], [audit('a', 'Applies')], {}, columns), (e) => e instanceof InputError && /no row in the Rulebook/.test(e.message));
});

test('verify finds an audit decision that was not carried over to its claim, and one whose claim says something else', async () => {
  const w = await seeded();
  const before = await w.run(verifyArgs(w));
  assert.equal(before.code, 2);
  assert.match(before.text, /claims: migrated decision - [0-9a-f]+: Review status is null, not "Reviewed"; run "setup\.mjs migrate-decisions"/);
  await w.run(['migrate-decisions']);
  const clean = await w.run(verifyArgs(w));
  assert.doesNotMatch(clean.text, /migrated decision/, 'only the steps that were not run here (the rubric and the settings) are still missing');
  const audit = readAuditFile();
  const d = audit.decisions.find((x) => x.outcome === 'Applies') ?? audit.decisions[0];
  w.fake.editRow(claimOf(w, d.geo_id).page_id, { 'Verified tags': [], 'Challenged tags notes': 'Rewritten.' });
  const after = await w.run(verifyArgs(w));
  assert.equal(after.code, 2);
  assert.match(after.text, /migrated decision - .*Verified tags holds \[\], the audit decided \["Context-dependent"\]/);
  assert.match(after.text, /migrated decision - .*Challenged tags notes does not start with "From the audit of 9 October"/);
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

test('rubric on fresh tables (P9): the same rules with other Rulebook page ids make the next edition, with the reason said; other rules are refused; run again says "in force already"', async () => {
  const w = await built();
  await w.run(['rulebook', '--from', w.inputs.taxonomy]);
  assert.equal((await w.run(['rubric', '--from', w.inputs.taxonomy])).code, 0);
  const first = readRubric(w.root);
  assert.equal(first.edition, EDITION);

  // the Rulebook is a new table now: its rows have other page ids (the pages file is rewritten by the rulebook step from the table)
  const pagesFile = join(w.root, 'setup', 'rulebook-pages.json');
  const fresh = Object.fromEntries(Object.keys(readJson(pagesFile)).map((name, i) => [name, `3f2273e2-14eb-81aa-8000-00000000000${i + 1}`]));
  writeFileSync(pagesFile, JSON.stringify(fresh));

  // the rules differ: refused, nothing is written
  const changed = smallTaxonomy();
  changed.rows[0]['When to use'] = '1. A different first rule.';
  writeFileSync(join(w.root, 'changed.json'), JSON.stringify(changed));
  const refused = await w.run(['rubric', '--from', join(w.root, 'changed.json')]);
  assert.equal(refused.code, 2);
  assert.match(refused.err[0], new RegExp(`edition ${EDITION} is in force already with other rules`));
  assert.equal(readRubric(w.root).edition, EDITION);

  // the rules are the same: the next edition, same rules, the new page ids
  const r = await w.run(['rubric', '--from', w.inputs.taxonomy]);
  assert.equal(r.code, 0, r.text);
  const next = EDITION.replace(/\.1$/, '.2');
  assert.match(r.out[0], new RegExp(`^rubric: edition ${next.replace(/\./g, '\\.')} written \\(the Rulebook is a fresh table, so its page ids are new; the rules are those of edition ${EDITION.replace(/\./g, '\\.')}\\); 2 tags, 1 with rules \\(Context-dependent\\)$`));
  const rubric = readRubric(w.root);
  assert.equal(rubric.edition, next);
  assert.equal(rubric.rubric_hash, first.rubric_hash, 'the rules are the same rules');
  assert.deepEqual(rubric.tags.map((t) => [t.name, t.page_id]), Object.entries(fresh).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, id]) => [name, id]));
  assert.deepEqual(readEdition(w.root, EDITION), first, 'the first edition stays in the history');
  assert.deepEqual(readEdition(w.root, next), rubric);
  assert.equal(readLock(w.root).edition, next);
  assert.equal(readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8'), `- ${EDITION.slice(0, 10)} · edition ${EDITION} · setup: copied from the taxonomy\n- ${next.slice(0, 10)} · edition ${next} · setup: fresh tables under the hub (P9), copied from the taxonomy\n`);

  // a run again finds it in force and writes nothing
  const before = readFileSync(join(w.root, 'rubric', 'rubric.json'), 'utf8');
  const again = await w.run(['rubric', '--from', w.inputs.taxonomy]);
  assert.equal(again.code, 0);
  assert.match(again.out[0], new RegExp(`edition ${next.replace(/\./g, '\\.')} is in force already \\(files checked\\)`));
  assert.equal(readFileSync(join(w.root, 'rubric', 'rubric.json'), 'utf8'), before);
  assert.equal(readFileSync(join(w.root, 'rubric', 'CHANGELOG.md'), 'utf8').trim().split('\n').length, 2);
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
  assert.equal(w.fake.writes().length, 14, 'no Notion request: the file is local (the 14 writes are the build of the structure)');

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
  assert.equal(rowsOf(w, 'claims').length, 0);
});

// ---- all and verify ----------------------------------------------------------------------------------------------------------------------------------

test('all: every step in order, each with its own run folder, the table counts right, verify finding nothing', async () => {
  const w = await built();
  const r = await w.run(allArgs(w));
  assert.equal(r.code, 0, r.text);
  assert.match(r.out.at(-1), /^setup all: every step finished/);
  assert.equal(rowsOf(w, 'rulebook').length, 2);
  assert.equal(rowsOf(w, 'claims').length, 13);
  assert.equal(rowsOf(w, 'tag_decisions').length, 10);
  assert.equal(rowsOf(w, 'rule_changes').length, 0);
  assert.equal(rowsOf(w, 'agent_settings').length, 1);
  assert.equal(rowsOf(w, 'claims').filter((c) => c['Review status'] === 'Reviewed').length, 10, 'the ten audit decisions were carried over to their claims');
  const overall = readJson(join(lastRun(w.root, 'all'), 'run.json'));
  assert.deepEqual(overall.steps.map((s) => s.step), ['api-check', 'databases', 'pages', 'views', 'hub', 'rulebook', 'claims', 'seed-audit', 'migrate-decisions', 'rubric', 'canaries', 'settings', 'verify'], 'with a hub block the tables come before the pages, and the hub part follows the views');
  assert.ok(overall.steps.every((s) => s.exit_code === 0));
  assert.equal(overall.exit_code, 0);
  assert.equal(overall.rubric_edition, EDITION);
  for (const step of overall.steps) {
    const run = readJson(join(w.root, 'runs', step.run_id, 'run.json'));
    assert.equal(run.exit_code, 0, step.step);
    assert.ok(run.finished_at, step.step);
    assert.match(run.resume, /^node agents\/claim-tagger-mvp\/scripts\/setup\.mjs /);
  }
  assert.match(readJson(join(w.root, 'runs', overall.steps.find((x) => x.step === 'rulebook').run_id, 'run.json')).resume, /rulebook --from .*taxonomy-issue\.json$/);
  for (const step of ['rulebook', 'claims', 'seed-audit', 'migrate-decisions', 'settings']) {
    assert.ok(existsSync(join(lastRun(w.root, step), 'plan.jsonl')) && existsSync(join(lastRun(w.root, step), 'ledger.jsonl')) && existsSync(join(lastRun(w.root, step), 'requests.jsonl')), step);
  }
  assert.equal(w.fake.writes().length, 2 + 5 + 1 + 6 + 2 + 13 + 10 + 10 + 1, 'the structure, then the rows and the ten migrated decisions: nothing else was written');
  assert.ok(w.fake.requests.every((x) => x.method !== 'DELETE'));
  const verify = readJson(join(w.root, 'runs', 'builder', 'verify.json'));
  assert.deepEqual(verify.differences, []);
  assert.deepEqual(verify.counts, { rulebook: 2, claims: 13, tag_decisions: 10, rule_changes: 0, agent_settings: 1 });
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
    for (const step of ['databases', 'pages', 'views', 'hub']) await w.run([step]);
    w.fake.failNext('POST', /^\/pages$/, 503, 1, { applied });
    const first = await w.run(allArgs(w));
    assert.equal(first.code, 1);
    assert.match(first.err.join('\n'), /stopped at "rulebook" \(exit 1\)/);
    assert.match(first.err.join('\n'), /uncertain/);
    const second = await w.run(allArgs(w));
    assert.equal(second.code, 0, second.text);
    for (const [table, n] of [['rulebook', 2], ['claims', 13], ['tag_decisions', 10], ['agent_settings', 1]]) {
      const rows = rowsOf(w, table);
      assert.equal(rows.length, n, table);
      assert.equal(new Set(rows.map((x) => x.Name ?? x['Geo ID'] ?? x.Key)).size, n, `${table}: no key twice`);
    }
    assert.deepEqual(readJson(join(w.root, 'runs', 'builder', 'verify.json')).differences, []);
  });
}

test('verify finds an edited Rulebook row, an edited claim, an edited seeded row, an edited settings row and an extra row', async () => {
  const w = await filled();
  const v0 = await w.run(verifyArgs(w));
  assert.equal(v0.code, 0, v0.text);
  assert.match(v0.out.join('\n'), /verify: no differences/);
  assert.match(v0.out[0], /verify: rows rulebook 2, claims 13, tag_decisions 10, rule_changes 0, agent_settings 1; \d+ request\(s\), 0 write\(s\)/);

  const cd = rowsOf(w, 'rulebook').find((x) => x.Name === 'Context-dependent');
  w.fake.editRow(cd.page_id, { 'When to use': '1. A rule an editor rewrote by hand.' });
  const claim = rowsOf(w, 'claims')[4];
  w.fake.editRow(claim.page_id, { 'Geo Name': 'A claim somebody retitled', 'Geo Topics': 'Topics an editor typed' });
  const seeded = rowsOf(w, 'tag_decisions')[2];
  w.fake.editRow(seeded.page_id, { 'Tag outcome': 'Does not apply', 'Why wrong': 'Rule unclear' });
  const settings = rowsOf(w, 'agent_settings')[0];
  w.fake.editRow(settings.page_id, { 'Rulebook edition': '2099-01-01.7' });
  w.fake.addRow(tableEntries(w.root).claims.database_id, { 'Geo Name': 'An extra claim', 'Geo ID': 'extra-1' });

  const r = await w.run(verifyArgs(w));
  assert.equal(r.code, 2);
  const text = r.err.join('\n');
  assert.match(text, /verify: \d+ difference\(s\)/);
  assert.match(text, /rulebook: field - "Context-dependent": When to use differs/);
  assert.match(text, /claims: field - .*Geo Name differs/);
  assert.match(text, /claims: field - .*Geo Topics differs/);
  assert.match(text, /claims: row count - 14 rows in the Claims table, 13 in the pick/);
  assert.match(text, /claims: extra row - the claim extra-1 is in the Claims table but not in the pick/);
  assert.match(text, /tag_decisions: seeded row - .*Tag outcome differs/);
  assert.match(text, /tag_decisions: seeded row - .*Why wrong differs/);
  assert.match(text, /agent_settings: settings - Rulebook edition is "2099-01-01\.7", the edition in force is /);
  const verify = readJson(join(w.root, 'runs', 'builder', 'verify.json'));
  assert.equal(verify.ok, false);
  assert.ok(verify.differences.length >= 8);
  assert.equal(verify.requests.writes, 0);
  assert.ok(r.err.length <= 22, 'a short list');
});

test('verify compares the page ids in rubric/rubric.json with the live Rulebook rows, one per tag; a rubric of other tables, a tag without a row and a row without a tag are named', async () => {
  const w = await filled();
  assert.equal((await w.run(verifyArgs(w))).code, 0, 'the edition names the live rows');

  // the edition names the rows of another table (the archived Rulebook): the next edition with the old ids
  const pagesFile = join(w.root, 'setup', 'rulebook-pages.json');
  const live = readJson(pagesFile);
  const archived = Object.fromEntries(Object.keys(live).map((name, i) => [name, `3f2273e2-14eb-81aa-8000-00000000000${i + 1}`]));
  writeFileSync(pagesFile, JSON.stringify(archived));
  assert.equal((await w.run(['rubric', '--from', w.inputs.taxonomy])).code, 0);
  const stale = await w.run(verifyArgs(w));
  assert.equal(stale.code, 2);
  const text = stale.err.join('\n');
  const first = Object.keys(live).sort()[0];
  assert.match(text, new RegExp(`rulebook: rubric page id - "${first}": rubric/rubric\\.json \\(edition [^)]+\\) holds the page id ${normId(archived[first])}, the Rulebook row is ${normId(live[first])}; run "setup\\.mjs rubric"`));
  assert.equal(stale.err.filter((l) => /rubric page id/.test(l)).length, Object.keys(live).length, 'one difference per tag');

  // a tag of the edition that has no row, and a row that is no tag of the edition
  writeFileSync(pagesFile, JSON.stringify(live));
  assert.equal((await w.run(['rubric', '--from', w.inputs.taxonomy])).code, 0);
  const rubricFile = join(w.root, 'rubric', 'rubric.json');
  const rows = rowsOf(w, 'rulebook');
  const gone = rows.find((x) => x.Name !== 'Context-dependent');
  w.fake.editRow(gone.page_id, { Name: 'A row nobody put in the edition' });
  const odd = await w.run(verifyArgs(w));
  const oddText = odd.err.join('\n');
  assert.match(oddText, new RegExp(`rulebook: rubric page id - "${gone.Name}" is in rubric/rubric\\.json \\(edition [^)]+\\) but has no row in the Rulebook`));
  assert.match(oddText, /rulebook: rubric page id - "A row nobody put in the edition" is a row of the Rulebook but not a tag of rubric\/rubric\.json/);
  assert.ok(existsSync(rubricFile));
});

test('verify says it cannot compare the Rulebook with the edition before there is one (a check that cannot run is reported, never skipped)', async () => {
  const w = await built();
  assert.equal((await w.run(['rulebook', '--from', w.inputs.taxonomy])).code, 0);
  const r = await w.run(verifyArgs(w));
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /rulebook: input - rubric\/rubric\.json: there is no rulebook edition yet \(run "setup\.mjs rubric"\), so its page ids cannot be compared with the Rulebook/);
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
  assert.match(r.err.join('\n'), /claims: row count - 13 rows in the Claims table, 14 in the pick/);
  assert.match(r.err.join('\n'), /claims: missing row - the claim ee030+ is not in the Claims table/);
  const entry = tableEntries(w.root).tag_decisions;
  await restClient(w.fake).retrieveDatabase(entry.database_id);
  const added = builderClient(w.fake);
  await added.updateDataSource(entry.data_source_id, { properties: { 'Side note': { type: 'rich_text', rich_text: {} } } });
  const r2 = await w.run(verifyArgs(w));
  assert.equal(r2.code, 2);
  assert.match(r2.err.join('\n'), /tag_decisions: extra column - "Side note" \(rich_text\)/);
});

// ---- the real input files -------------------------------------------------------------------------------------------------------------------------

// The committed Geo pick (setup/geo-claims-pick.json) is made by the live run of geo-pick.mjs (stage 7 of HUB-AND-GEO-CLAIMS.md), so this test runs once that file is in the repository.
const REAL_GEO_PICK = join(import.meta.dirname, '..', '..', 'agents', 'claim-tagger-mvp', 'setup', 'geo-claims-pick.json');
const REAL_AUDIT = join(import.meta.dirname, '..', '..', 'agents', 'claim-tagger-mvp', 'setup', 'audit-decisions.json');

test('the real inputs (13 taxonomy rows, the committed Geo pick, the audit) build, read back and verify against the fake, and every tag of the pick is an option', { skip: !existsSync(REAL_TAXONOMY) || !existsSync(REAL_GEO_PICK) }, async () => {
  const w = newWorld({ structure: 'fresh' });
  assert.equal(openBuilder({ root: w.root, reason: 'test' }).ok, true);
  const options = await w.run(['structure', '--options-from', REAL_GEO_PICK]);
  assert.equal(options.code, 0, options.text);
  assert.equal((await w.run(['build'])).code, 0);
  const pick = readJson(REAL_GEO_PICK);
  const args = ['all', '--taxonomy', REAL_TAXONOMY, '--claims', REAL_GEO_PICK, '--audit', REAL_AUDIT];
  const r = await w.run(args);
  assert.equal(r.code, 0, r.text);
  assert.equal(rowsOf(w, 'rulebook').length, 13);
  assert.equal(rowsOf(w, 'claims').length, pick.rows.length);
  assert.equal(rowsOf(w, 'tag_decisions').length, pick.audit.included.length);
  assert.equal(rowsOf(w, 'agent_settings').length, 1);
  const canaries = readLines(join(w.root, 'evals', 'canaries.jsonl'));
  assert.deepEqual([canaries.filter((x) => x.expected === 'apply').length, canaries.filter((x) => x.expected === 'do_not_apply').length], [6, 5]);
  const rubric = readRubric(w.root);
  assert.deepEqual(rubric.tags.filter((t) => t.judged).map((t) => t.name), ['Context-dependent']);
  assert.equal(rubric.tags.length, 13);
  const verify = readJson(join(w.root, 'runs', 'builder', 'verify.json'));
  assert.deepEqual(verify.differences, []);
  assert.deepEqual(verify.counts, { rulebook: 13, claims: pick.rows.length, tag_decisions: pick.audit.included.length, rule_changes: 0, agent_settings: 1 });
  assert.ok(w.fake.requests.every((x) => x.status !== 404));
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
  assert.throws(() => readPick(write('p1.json', { rows: [{ 'Geo ID': 'g', 'Geo Name': 'n' }, { 'Geo ID': 'g', 'Geo Name': 'm' }] })), /50-row pick of the first build/);
  const geo = makePick({ audit: readAuditFile(), extra: 2 });
  const read = readPick(write('p2.json', geo));
  assert.equal(read.rows.length, 12);
  assert.deepEqual(read.rows[0].source_pieces, [{ text: 'Source one of 0', href: geo.rows[0].source_pieces[0].url }, { text: '\n', href: null }, { text: 'Source two of 0', href: geo.rows[0].source_pieces[1].url }], 'the pieces of the Geo Sources cell: names, a line break, names');
  assert.deepEqual(read.rows[1].source_pieces, []);
  assert.equal(read.rows[0].source_pieces.map((p) => p.text).join(''), geo.rows[0]['Geo Sources'], 'the pieces read as the cell text');
  assert.throws(() => readPick(write('p3.json', { ...geo, pick_version: 2 })), /is not a Geo pick/);
  assert.equal(rulebookOps(readTaxonomy(write('t6.json', smallTaxonomy())), ['Name', 'Category']).length, 2);
  assert.deepEqual(claimOps({ rows: [{ 'Geo ID': 'g', 'Geo Name': 'n', 'Geo Is factual': null, 'Geo Space': 'AI', 'Geo Created': '2026-09-14', 'Geo Tags': ['Debate'], 'Geo Topics': '', month: '2026-09' }] }, ['Geo Name', 'Geo ID', 'Geo Space', 'Geo Created', 'Geo Is factual', 'Geo Tags', 'Geo Topics', 'Agent tags']),
    [{ key: 'g', properties: { 'Geo Name': 'n', 'Geo ID': 'g', 'Geo Space': 'AI', 'Geo Created': '2026-09-14', 'Geo Tags': ['Debate'] } }], 'null and empty values are left unset, a box that is false stays written');
  assert.deepEqual(claimOps({ rows: [{ 'Geo ID': 'g', 'Geo Name': 'n', 'Geo Is factual': false }] }, ['Geo Name', 'Geo ID', 'Geo Is factual'])[0].properties, { 'Geo Name': 'n', 'Geo ID': 'g', 'Geo Is factual': false });
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
