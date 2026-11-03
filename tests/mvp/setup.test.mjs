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
  migrationOps, parseTagNames, protectedInLinks, rulebookOps, settingsProperties, stepSeedJudged, unknownOptions, withLinkedSources,
} from '../../agents/claim-tagger-mvp/scripts/lib/setup-steps.mjs';
import {
  AUDIT_FILE, CONTEXT_DEPENDENT_EXAMPLES, EDITION, NOW, REAL_TAXONOMY, SELF_CONTAINED_EXAMPLES, SPACE_NAMES, ALLOWED_SPACE_NAMES, builderClient, cleanTmp, forFake, freshStructure, freshStructureBeforeOptions, fullTaxonomy, makePick, newWorld, readAuditFile,
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
async function built({ pick, taxonomy, audit, old = false, fakeOptions } = {}) {
  const w = newWorld({ structure: old ? true : 'fresh', ...(fakeOptions ? { fakeOptions } : {}) });
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
const allArgs = (w) => ['all', '--taxonomy', w.inputs.taxonomy, '--claims', w.inputs.claims];
const verifyArgs = (w) => ['verify', '--taxonomy', w.inputs.taxonomy, '--claims', w.inputs.claims];

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
  for (const name of ['pages', 'databases', 'views', 'build', 'rulebook', 'claims', 'rubric', 'canaries', 'settings', 'seed-judged', 'all']) {
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
  for (const name of ['pages', 'build', 'rulebook', 'claims', 'rubric', 'canaries', 'settings', 'seed-judged', 'all']) {
    const r = await w.run([name]);
    assert.equal(r.code, 3, name);
    assert.match(r.err[0], /runs\/PAUSED exists/);
  }
  assert.equal(w.fake.requests.length, before, 'a paused agent sends nothing');
});

test('seed-audit, migrate-decisions and archive are per-claim steps of the first page: they refuse on v2 with exit 2 and one sentence, session or not, and send nothing (P48)', async () => {
  const w = newWorld({ structure: 'fresh' });
  for (const open of [false, true]) {
    if (open) assert.equal(openBuilder({ root: w.root, reason: 'test' }).ok, true);
    for (const name of ['seed-audit', 'migrate-decisions', 'archive']) {
      const r = await w.run([name]);
      assert.equal(r.code, 2, name);
      assert.equal(r.err[0], `setup ${name}: ${name} is a per-claim step of the first page (P48); the v2 page is filled by copy-live.mjs`);
    }
  }
  assert.equal(w.fake.requests.length, 0);
});

test('"all" has no seed-audit and no migrate-decisions step', async () => {
  const w = newWorld({ structure: 'fresh' });
  assert.equal(openBuilder({ root: w.root, reason: 'test' }).ok, true);
  const r = await w.run(['all']);
  assert.doesNotMatch(r.text, /seed-audit|migrate-decisions/);
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

test('preview of the v2 structure shows the five tables in the hub order, the per-row Tag decisions, the four views of the page and the hub block', async () => {
  const w = newWorld({ structure: 'fresh' });
  const r = await w.run(['preview']);
  assert.equal(r.code, 0);
  const md = r.out[0];
  assert.match(md, /^# Structure preview\n\n5 tables, \d+ columns, 4 views and 0 sub-pages/);
  assert.match(md, /## Hub page "Claim tagger v2"/);
  assert.match(md, /4 link lines at the top: Your queue: .*; Needs your note: .*; Agent disagreed: .*; Lessons waiting: /);
  assert.match(md, /the 5 tables as full-page tables, in this order: Tag decisions, Claims, Rulebook, Rule changes, Agent settings/);
  assert.deepEqual([...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].replace(/ \(\d+ columns\)$/, '')).slice(2), ['Tag decisions', 'Claims', 'Rulebook', 'Rule changes', 'Agent settings']);
  assert.match(md, /## Tag decisions \(18 columns\)/);
  assert.match(md, /## Claims \(18 columns\)/, 'the Geo columns and the agent columns: no editor column on Claims');
  assert.match(md, /\| Geo Space \| select \| U\.S\. Politics, World affairs, AI, Health, Crypto, Technology, Pharma, Industries, Education, Software, Places, Documentation \|/, 'the six spaces of the pick, then the six more that add accepts (P39)');
  assert.match(md, /\| Geo Created \| date \|/);
  assert.doesNotMatch(md, /Verified tags \||Review status \||Challenged tags notes \||\(old\)|Geo Score|Claims copy|Rulebook copy/);
  assert.match(md, /- \*\*Your queue\*\*: rows shown: Agent status is Waits for you, and Tag outcome is empty, and \(Agent is right is not ticked, or Agent proposal is Can't tell\);/);
  assert.match(md, /- \*\*Agent disagreed\*\*: rows shown: Agent status is Disagrees with your decision;/);
  assert.match(md, /- \*\*Lessons waiting\*\*: rows shown: Status is Proposed or Approved;/);
  assert.equal((md.match(/^- The table's own view/gm) ?? []).length, 5, 'every table arranges its own view');
  assert.equal((md.match(/^Description under the table's name: /gm) ?? []).length, 5);
  assert.match(md, /^Description under the table's name: Tick Paused to stop every command; untick to resume\.$/m);
  assert.equal(w.fake.requests.length, 0, 'local files only');
});

test('structure --options-from sets Geo Tags (the pick\'s tag names, sorted) and Geo Space (the allowed spaces: the six of the pick, then six more), writes setup/structure.json, says what changed, and run again changes nothing', async () => {
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
  assert.deepEqual(columns().find((c) => c.name === 'Geo Space').options, ALLOWED_SPACE_NAMES);
  assert.deepEqual(ALLOWED_SPACE_NAMES.slice(0, 6), SPACE_NAMES, 'the six spaces of the pick come first');
  assert.ok(r.out.includes('structure: Geo Tags: added Economy, Immigration (3 in all)'), r.out.join('\n'));
  assert.ok(r.out.includes('structure: Geo Space: its 12 options are the pick\'s already'));
  assert.ok(r.out.some((l) => /^structure: setup\/structure\.json written$/.test(l)));
  assert.match(r.out.join('\n'), /Geo Tags colours: Debate \w+, Economy \w+, Immigration \w+/);
  assert.match(r.out.join('\n'), /Geo Space colours: U\.S\. Politics blue, World affairs green, AI purple, Health red, Crypto orange, Technology gray, Pharma default, Industries default, Education default, Software default, Places default, Documentation default/);
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

test('structure --options-from takes the options of Geo Space from geo.spaces when config.json has no allowed_spaces', async () => {
  const w = newWorld({ structure: 'fresh' });
  const configFile = join(w.root, 'config.json');
  const config = readJson(configFile);
  delete config.geo.allowed_spaces;
  writeFileSync(configFile, JSON.stringify(config, null, 2));
  const dir = join(w.root, 'inputs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'pick.json');
  writeFileSync(file, JSON.stringify(makePick({ audit: readAuditFile(), extra: 3 })));
  const r = await w.run(['structure', '--options-from', file]);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(readJson(join(w.root, 'setup', 'structure.json')).tables.claims.columns.find((c) => c.name === 'Geo Space').options, SPACE_NAMES);
  assert.ok(r.out.includes(`structure: Geo Space: removed ${ALLOWED_SPACE_NAMES.slice(6).join(', ')} (6 in all)`), r.out.join('\n'));
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
  assert.deepEqual(body['Geo Space'].select.options.map((o) => [o.name, o.color]), [
    ['U.S. Politics', 'blue'], ['World affairs', 'green'], ['AI', 'purple'], ['Health', 'red'], ['Crypto', 'orange'], ['Technology', 'gray'],
    ['Pharma', 'default'], ['Industries', 'default'], ['Education', 'default'], ['Software', 'default'], ['Places', 'default'], ['Documentation', 'default'], // the six more that add accepts (P39) have no colour of their own
  ]);
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
  assert.match(JSON.parse(before).made_from, /STRUCTURE-V2\.md/);
  for (const argv of [['structure', '--from-proposal', proposal], ['structure']]) {
    const r = await w.run(argv);
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.err[0], /setup\/structure\.json was made from docs\/mvp-2026-11\/STRUCTURE-V2\.md .* and --from-proposal would replace it with the first build's structure; give --replace/);
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
  assert.match(text, /tag_decisions: view link - "Needs your note" is in Notion but config\.json has no notion\.views\.needs_your_note; run "setup\.mjs views" to record it/);
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
  assert.equal(verify.counts.tag_decisions, 0, "nothing is seeded on v2 (P48)");
  writeFileSync(join(w.root, 'bigger.json'), JSON.stringify(makePick({ audit, extra: 191 })));
  const bigger = await w.run(['verify', '--taxonomy', w.inputs.taxonomy, '--claims', join(w.root, 'bigger.json')]);
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
  assert.match(r.err.join('\n'), /hub: title - the hub page is called "Feedback Distillation MVP" and should be called "Claim tagger v2"/);
  await rename("Claim tagger v2");

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
  assert.deepEqual(rubric.tags.map((t) => t.judged), [false, false], 'the rubric step ticks nothing: the Judged box belongs to the editors (seed-judged ticks it once), so a tag with rules is not judged until it is ticked');
  assert.deepEqual(rubric.tags.map((t) => t.rules.length > 0), [true, false]);
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
  assert.equal(w.fake.writes().length, 12, "no Notion request: the file is local (the 12 writes are the build of the structure)");

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
  assert.equal(rowsOf(w, 'tag_decisions').length, 0, 'nothing is seeded on v2 (P48)');
  assert.equal(rowsOf(w, 'rule_changes').length, 0);
  assert.equal(rowsOf(w, 'agent_settings').length, 1);
  const overall = readJson(join(lastRun(w.root, 'all'), 'run.json'));
  assert.deepEqual(overall.steps.map((s) => s.step), ['api-check', 'databases', 'pages', 'views', 'hub', 'rulebook', 'claims', 'rubric', 'canaries', 'settings', 'verify'], 'with a hub block the tables come before the pages, and the hub part follows the views');
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
  for (const step of ['rulebook', 'claims', 'settings']) {
    assert.ok(existsSync(join(lastRun(w.root, step), 'plan.jsonl')) && existsSync(join(lastRun(w.root, step), 'ledger.jsonl')) && existsSync(join(lastRun(w.root, step), 'requests.jsonl')), step);
  }
  assert.equal(w.fake.writes().length, 12 + 2 + 13 + 1, 'the structure (12 writes), then the rows: nothing else was written');
  assert.ok(w.fake.requests.every((x) => x.method !== 'DELETE'));
  const verify = readJson(join(w.root, 'runs', 'builder', 'verify.json'));
  assert.deepEqual(verify.differences, []);
  assert.deepEqual(verify.counts, { rulebook: 2, claims: 13, tag_decisions: 0, rule_changes: 0, agent_settings: 1 });
  assert.equal(verify.requests.writes, 0, 'verify only read');
});

test('verify on v2 needs no audit file, and with --audit it compares only Claim, Tag and Tag outcome of the seeded rows and skips the migrated-decision block (P48)', async () => {
  const w = await filled();
  const plain = await w.run(verifyArgs(w));
  assert.equal(plain.code, 0, plain.text);
  assert.doesNotMatch(plain.text, /audit file/);
  const named = await w.run([...verifyArgs(w), '--audit', w.inputs.audit]);
  assert.equal(named.code, 2, 'the audit rows are not in Tag decisions, which nothing seeds on v2');
  const text = named.err.join('\n');
  assert.match(text, /tag_decisions: seeded row - .* is not in Tag decisions/);
  assert.doesNotMatch(text, /migrated decision/);
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
    for (const [table, n] of [['rulebook', 2], ['claims', 13], ['agent_settings', 1]]) {
      const rows = rowsOf(w, table);
      assert.equal(rows.length, n, table);
      assert.equal(new Set(rows.map((x) => x.Name ?? x['Geo ID'] ?? x.Key)).size, n, `${table}: no key twice`);
    }
    assert.deepEqual(readJson(join(w.root, 'runs', 'builder', 'verify.json')).differences, []);
  });
}

test('verify with removed claims (P51): the Geo IDs of setup/removed-claims.json are expected to be absent, a pick claim that was removed is no missing row, and one that is still there is a difference', async () => {
  const w = await filled({ fakeOptions: { allowTrash: true } });
  const listFile = join(w.root, 'setup', 'removed-claims.json');
  const list = (ids) => writeFileSync(listFile, `${JSON.stringify({ removed: ids.map((geo_id) => ({ geo_id, run_id: 'remove-run-1', date: '2026-11-03' })) }, null, 2)}\n`);
  const rest = restClient(w.fake);
  const ids = rowsOf(w, 'claims').map((x) => x['Geo ID']);
  assert.equal(ids.length, 13);
  const [a, b, c] = [rowsOf(w, 'claims')[2], rowsOf(w, 'claims')[3], rowsOf(w, 'claims')[4]];
  const verify = async () => w.run(verifyArgs(w));

  // two pick claims go to the trash (what remove.mjs does)
  await rest.trashPage(a.page_id);
  await rest.trashPage(b.page_id);
  // no list yet: the pick claims are missing rows, and the count is off
  const unlisted = await verify();
  assert.equal(unlisted.code, 2);
  const unlistedText = unlisted.err.join('\n');
  assert.match(unlistedText, /claims: row count - 11 rows in the Claims table, 13 in the pick/);
  assert.match(unlistedText, new RegExp(`claims: missing row - the claim ${a['Geo ID']} is not in the Claims table`));
  assert.match(unlistedText, new RegExp(`claims: missing row - the claim ${b['Geo ID']} is not in the Claims table`));

  // with the list: expected absent, the row count expectation drops them, nothing else changes
  list([b['Geo ID'], a['Geo ID'].toUpperCase()]);
  const clean = await verify();
  assert.equal(clean.code, 0, clean.text);
  assert.match(clean.out.join('\n'), /verify: no differences/);
  assert.match(clean.out[0], /verify: rows rulebook 2, claims 11, /);
  assert.match(clean.out.join('\n'), /verify: removed on purpose and absent, as expected \(setup\/removed-claims\.json\): 2/);
  const report = readJson(join(w.root, 'runs', 'builder', 'verify.json'));
  assert.equal(report.ok, true);
  assert.equal(report.removed_absent, 2);
  assert.equal(report.requests.writes, 0, 'verify only read');

  // a list entry for a Geo ID that is not a pick claim and not in Claims is absent too (a claim that was added later and removed)
  list([a['Geo ID'], b['Geo ID'], 'f'.repeat(32)]);
  const later = await verify();
  assert.equal(later.code, 0, later.text);
  assert.equal(readJson(join(w.root, 'runs', 'builder', 'verify.json')).removed_absent, 3);

  // a removed claim that is still in Claims is a difference, and only that one: not an extra row, not a missing one, not an added one
  list([a['Geo ID'], b['Geo ID'], c['Geo ID']]);
  const still = await verify();
  assert.equal(still.code, 2);
  const stillText = still.err.join('\n');
  assert.match(stillText, new RegExp(`claims: removed row - the claim ${c['Geo ID']} was removed \\(setup/removed-claims\\.json\\) but is still in the Claims table`));
  assert.match(stillText, /verify: 1 difference\(s\)/);
  assert.equal(readJson(join(w.root, 'runs', 'builder', 'verify.json')).removed_absent, 2);

  // the count of a table that has other differences names the removals; a row added after setup is still counted as before
  list([a['Geo ID'], b['Geo ID']]);
  w.fake.addRow(tableEntries(w.root).claims.database_id, { 'Geo Name': 'An extra claim', 'Geo ID': 'extra-1' });
  w.fake.addRow(tableEntries(w.root).claims.database_id, { 'Geo Name': 'Added later', 'Geo ID': 'e'.repeat(32) });
  const extra = await verify();
  assert.equal(extra.code, 2);
  const extraText = extra.err.join('\n');
  assert.match(extraText, /claims: row count - 12 rows in the Claims table besides the 1 added after setup, 11 expected \(13 in the pick, 2 of them removed on purpose\)/);
  assert.match(extraText, /claims: extra row - the claim extra-1 is in the Claims table but not in the pick/);
  assert.equal(readJson(join(w.root, 'runs', 'builder', 'verify.json')).added_after_setup, 1);

  // a list that cannot be read is a difference of its own, not silence
  writeFileSync(listFile, '{ "removed": "no" }');
  const broken = await verify();
  assert.equal(broken.code, 2);
  assert.match(broken.err.join('\n'), /claims: input - setup\/removed-claims\.json: .*removed-claims\.json is not valid/);
});

test('verify finds an edited Rulebook row, an edited claim, an edited settings row and an extra row', async () => {
  const w = await filled();
  const v0 = await w.run(verifyArgs(w));
  assert.equal(v0.code, 0, v0.text);
  assert.match(v0.out.join('\n'), /verify: no differences/);
  assert.match(v0.out[0], /verify: rows rulebook 2, claims 13, tag_decisions 0, rule_changes 0, agent_settings 1; \d+ request\(s\), 0 write\(s\)/);

  const cd = rowsOf(w, 'rulebook').find((x) => x.Name === 'Context-dependent');
  w.fake.editRow(cd.page_id, { 'When to use': '1. A rule an editor rewrote by hand.' });
  const claim = rowsOf(w, 'claims')[4];
  w.fake.editRow(claim.page_id, { 'Geo Name': 'A claim somebody retitled', 'Geo Topics': 'Topics an editor typed' });
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
  assert.match(text, /claims: row count - 14 rows in the Claims table, 13 in the pick/, 'a key that is not a Geo ID was not added by /claim-tagger add: it is still a difference');
  assert.match(text, /claims: extra row - the claim extra-1 is in the Claims table but not in the pick/);
  assert.doesNotMatch(r.out.join('\n'), /added after setup/);
  assert.match(text, /agent_settings: settings - Rulebook edition is "2099-01-01\.7", the edition in force is /);
  const verify = readJson(join(w.root, 'runs', 'builder', 'verify.json'));
  assert.equal(verify.ok, false);
  assert.ok(verify.differences.length >= 6);
  assert.equal(verify.added_after_setup, undefined);
  assert.equal(verify.requests.writes, 0);
  assert.ok(r.err.length <= 22, 'a short list');
});

test('verify: the Geo Space options of Claims may be fewer than the structure lists (Notion makes an option when add writes the first claim of a space, P39) and are clean before and after; an option the structure does not list is a difference, and so is a missing option of any other select', async () => {
  const w = await filled();
  const entry = tableEntries(w.root).claims;
  const client = builderClient(w.fake);
  const options = (type, names) => ({ [type]: { options: names.map((name) => ({ name })) } });
  const setSpace = (names) => client.updateDataSource(entry.data_source_id, { properties: { 'Geo Space': options('select', names) } });
  const spaceOptions = () => w.fake.dataSource(entry.data_source_id).properties['Geo Space'].select.options.map((o) => o.name);
  assert.deepEqual(spaceOptions(), ALLOWED_SPACE_NAMES, 'the table is built with all twelve options the structure lists');

  // the live table today: the six spaces of the pick; the structure lists twelve
  await setSpace(SPACE_NAMES);
  assert.deepEqual(spaceOptions(), SPACE_NAMES);
  const before = await w.run(verifyArgs(w));
  assert.equal(before.code, 0, before.text);
  assert.match(before.out.join('\n'), /verify: no differences/);
  assert.deepEqual(readJson(join(w.root, 'runs', 'builder', 'verify.json')).differences, []);
  // after the import: Notion has made the options of the spaces the new claims are in
  await setSpace([...SPACE_NAMES, 'Pharma', 'Software']);
  assert.equal((await w.run(verifyArgs(w))).code, 0);
  await setSpace(ALLOWED_SPACE_NAMES);
  const after = await w.run(verifyArgs(w));
  assert.equal(after.code, 0, after.text);

  // an option the structure does not list (the Podcasts space is not allowed) is a difference
  await setSpace([...ALLOWED_SPACE_NAMES, 'Podcasts']);
  const extra = await w.run(verifyArgs(w));
  assert.equal(extra.code, 2);
  assert.match(extra.err.join('\n'), /claims: options - "Geo Space": extra "Podcasts"$/m);
  assert.doesNotMatch(extra.err.join('\n'), /"Geo Space": missing/);
  await setSpace(ALLOWED_SPACE_NAMES);

  // every other select still names the options it lacks
  const tags = w.fake.dataSource(entry.data_source_id).properties['Geo Tags'].multi_select.options.map((o) => o.name);
  const dropped = tags.at(-1);
  await client.updateDataSource(entry.data_source_id, { properties: { 'Geo Tags': options('multi_select', tags.slice(0, -1)) } });
  const missing = await w.run(verifyArgs(w));
  assert.equal(missing.code, 2);
  assert.match(missing.err.join('\n'), new RegExp(`claims: options - "Geo Tags": missing "${dropped}"$`, 'm'));
});

test('verify: a claim added after setup (a Geo ID that is not in the pick) is counted, not a difference; its Geo columns are not checked (P35)', async () => {
  const w = await filled();
  const ID1 = 'c0ffee00000000000000000000000001';
  assert.match(ID1, /^[0-9a-f]{32}$/);
  w.fake.addRow(tableEntries(w.root).claims.database_id, { 'Geo Name': 'A claim an editor added', 'Geo ID': ID1, 'Geo Space': 'AI' });
  const one = await w.run(verifyArgs(w));
  assert.equal(one.code, 0, one.text);
  assert.match(one.out.join('\n'), /verify: added after setup: 1/);
  w.fake.addRow(tableEntries(w.root).claims.database_id, { 'Geo Name': 'Another one', 'Geo ID': 'c0ffee00000000000000000000000002' });
  const r = await w.run(verifyArgs(w));
  assert.equal(r.code, 0, r.text);
  assert.match(r.out.join('\n'), /verify: added after setup: 2/);
  assert.match(r.out[0], /claims 15/);
  assert.match(r.out.join('\n'), /verify: no differences/);
  const verify = readJson(join(w.root, 'runs', 'builder', 'verify.json'));
  assert.deepEqual([verify.ok, verify.added_after_setup, verify.differences], [true, 2, []]);
  // a row whose key is not a Geo ID is no claim that add made: it stays an extra row, also next to rows that were added
  w.fake.addRow(tableEntries(w.root).claims.database_id, { 'Geo Name': 'Typed by hand', 'Geo ID': 'typed-by-hand' });
  const typed = await w.run(verifyArgs(w));
  assert.equal(typed.code, 2);
  assert.match(typed.err.join('\n'), /claims: extra row - the claim typed-by-hand is in the Claims table but not in the pick/);
  assert.match(typed.err.join('\n'), /claims: row count - 14 rows in the Claims table besides the 2 added after setup, 13 in the pick/);
  assert.doesNotMatch(typed.err.join('\n'), new RegExp(ID1), 'an added claim is not named as a difference');
  // a row of the pick that is no longer there is still a difference, whatever was added
  const gone = rowsOf(w, 'claims')[0];
  w.fake.editRow(gone.page_id, { 'Geo ID': 'c0ffee00000000000000000000000003' });
  const again = await w.run(verifyArgs(w));
  assert.equal(again.code, 2);
  assert.match(again.err.join('\n'), /claims: missing row - the claim .* is not in the Claims table/);
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
  await w.run(['verify', '--taxonomy', join(w.root, 'gone.json'), '--claims', w.inputs.claims]).then((r) => {
    assert.equal(r.code, 2);
    assert.match(r.err.join('\n'), /rulebook: input - the taxonomy file: the taxonomy file does not exist/);
  });
  const bigger = makePick({ audit: readAuditFile(), extra: 4 });
  writeFileSync(join(w.root, 'bigger.json'), JSON.stringify(bigger));
  const r = await w.run(['verify', '--taxonomy', w.inputs.taxonomy, '--claims', join(w.root, 'bigger.json')]);
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
  const args = ['all', '--taxonomy', REAL_TAXONOMY, '--claims', REAL_GEO_PICK];
  const r = await w.run(args);
  assert.equal(r.code, 0, r.text);
  assert.equal(rowsOf(w, 'rulebook').length, 13);
  assert.equal(rowsOf(w, 'claims').length, pick.rows.length);
  assert.equal(rowsOf(w, 'tag_decisions').length, 0);
  assert.equal(rowsOf(w, 'agent_settings').length, 1);
  const canaries = readLines(join(w.root, 'evals', 'canaries.jsonl'));
  assert.deepEqual([canaries.filter((x) => x.expected === 'apply').length, canaries.filter((x) => x.expected === 'do_not_apply').length], [6, 5]);
  const rubric = readRubric(w.root);
  assert.deepEqual(rubric.tags.filter((t) => t.judged).map((t) => t.name), [], 'no box is ticked by the setup: the rubric step ticks nothing');
  assert.deepEqual(rubric.tags.filter((t) => t.rules.length > 0 && t.capability === 'text').map((t) => t.name), ['Context-dependent']);
  assert.equal(rubric.tags.length, 13);
  const verify = readJson(join(w.root, 'runs', 'builder', 'verify.json'));
  assert.deepEqual(verify.differences, []);
  assert.deepEqual(verify.counts, { rulebook: 13, claims: pick.rows.length, tag_decisions: 0, rule_changes: 0, agent_settings: 1 });
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

// ---- the Judged box: the column in the structure, and seed-judged (decision P53) ---------------------------------------------------------------

const judgedOf = (w) => Object.fromEntries(rowsOf(w, 'rulebook').map((r) => [r.Name, r.Judged]));
const patches = (w) => w.fake.requests.filter((r) => r.method === 'PATCH' && /^\/pages\//.test(r.path));

/** A world built from the structure without the Judged column (the Rulebook as it was before the box), filled by `all`; the committed structure (with the box) is put back afterwards by `restoreStructure`. */
async function builtWithoutJudged() {
  const w = newWorld({ structure: 'fresh' });
  assert.equal(openBuilder({ root: w.root, reason: 'test' }).ok, true);
  const inputs = writeInputs(join(w.root, 'inputs'), { taxonomy: smallTaxonomy() });
  mkdirSync(join(w.root, 'setup'), { recursive: true });
  copyFileSync(inputs.claims, join(w.root, 'setup', 'geo-claims-pick.json'));
  const file = join(w.root, 'setup', 'structure.json');
  const structure = readJson(file);
  structure.tables.rulebook.columns = structure.tables.rulebook.columns.filter((c) => c.name !== 'Judged');
  structure.tables.rulebook.default_view.columns = structure.tables.rulebook.default_view.columns.filter((c) => c !== 'Judged');
  writeFileSync(file, `${JSON.stringify(structure, null, 2)}\n`);
  assert.equal((await w.run(['structure', '--options-from', inputs.claims])).code, 0);
  assert.equal((await w.run(['build'])).code, 0);
  const all = await w.run(allArgs({ ...w, inputs }));
  assert.equal(all.code, 0, all.text);
  const restoreStructure = async () => {
    const full = readJson(file);
    full.tables.rulebook.columns.splice(1, 0, freshStructure().tables.rulebook.columns.find((c) => c.name === 'Judged'));
    full.tables.rulebook.default_view.columns.splice(1, 0, 'Judged');
    writeFileSync(file, `${JSON.stringify(full, null, 2)}\n`);
  };
  return { ...w, inputs, restoreStructure };
}

test('the structure has the Judged checkbox on the Rulebook, right after Name in its own view, with the description the editors read', () => {
  const structure = freshStructure();
  const rulebook = structure.tables.rulebook;
  const column = rulebook.columns.find((c) => c.name === 'Judged');
  assert.deepEqual(column, {
    name: 'Judged', type: 'checkbox', options: [],
    description: 'Ticked: the agent judges this tag on every claim. Untick to stop judging it; its rules then change freely until it is ticked again.',
  });
  assert.equal(rulebook.columns[1].name, 'Judged', 'right after Name in the table');
  assert.deepEqual(rulebook.default_view.columns.slice(0, 3), ['Name', 'Judged', 'Category'], 'and in the Rulebook\'s own view');
  assert.equal(rulebook.columns.some((c) => c.name === 'Priority'), false, 'Priority is a column people added: it is not in the structure');
});

test('build adds the Judged column to a Rulebook that lacks it and leaves the rows unticked; verify expects the column before and finds it after', async () => {
  const w = await builtWithoutJudged();
  const table = tableEntries(w.root).rulebook;
  assert.equal((await restClient(w.fake).retrieveDatabase(table.database_id)).properties.Judged, undefined, 'the table of the older build has no such column');
  assert.equal((await w.run(['verify', '--taxonomy', w.inputs.taxonomy, '--claims', w.inputs.claims])).code, 0, 'verify is clean against the structure without the column');

  await w.restoreStructure();
  const before = await w.run(['verify', '--taxonomy', w.inputs.taxonomy, '--claims', w.inputs.claims]);
  assert.equal(before.code, 2, before.text);
  assert.match(before.text, /rulebook: missing column - "Judged" \(checkbox\) is not in the table/);

  const build = await w.run(['build']);
  assert.equal(build.code, 0, build.text);
  assert.match(build.text, /table "rulebook": 1 column\(s\) added \(Judged\)/);
  assert.equal((await restClient(w.fake).retrieveDatabase(table.database_id)).properties.Judged.type, 'checkbox');
  assert.deepEqual(judgedOf(w), { 'Context-dependent': false, 'Trailing period': false }, 'the existing rows come out unticked: building ticks nothing');
  const after = await w.run(['verify', '--taxonomy', w.inputs.taxonomy, '--claims', w.inputs.claims]);
  assert.equal(after.code, 0, after.text);
  assert.deepEqual(readJson(join(w.root, 'runs', 'builder', 'verify.json')).differences, []);
  const again = await w.run(['build']);
  assert.doesNotMatch(again.text, /column\(s\) added/, 'a second build adds nothing');
  // a column that people added (Priority) is reported as before, not as a difference of the structure
  await builderClient(w.fake).updateDataSource(table.data_source_id, { properties: { Priority: { number: {} } } });
  const extra = await w.run(['verify', '--taxonomy', w.inputs.taxonomy, '--claims', w.inputs.claims]);
  assert.match(extra.text, /rulebook: extra column - "Priority" \(number\) is in the table but not in the structure/);
  assert.doesNotMatch(extra.text, /Judged/);
});

test('seed-judged ticks the named Rulebook rows, reads them back, logs the plan and the ledger in the run folder, and leaves every other row alone', async () => {
  const w = await filled({ taxonomy: smallTaxonomy() });
  assert.deepEqual(judgedOf(w), { 'Context-dependent': false, 'Trailing period': false });
  const r = await w.run(['seed-judged', '--tags', 'Context-dependent']);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(r.out, ['seed-judged: Judged ticked and read back on Context-dependent']);
  assert.deepEqual(judgedOf(w), { 'Context-dependent': true, 'Trailing period': false });
  const dir = lastRun(w.root, 'seed-judged');
  const plan = readPlan(dir);
  assert.equal(plan.header.plan.script, 'seed-judged');
  assert.deepEqual(plan.ops.map((o) => [o.op, o.table, o.key, o.properties, o.expect]), [['update', 'rulebook', 'Context-dependent', { Judged: true }, { Judged: false }]]);
  const ledger = readLines(join(dir, 'ledger.jsonl'));
  assert.deepEqual(ledger.map((l) => [l.status, l.read_back, l.sent]), [['done', 'ok', 'update']]);
  const record = readJson(join(dir, 'run.json'));
  assert.deepEqual(record.seed_judged, { ticked: ['Context-dependent'], already: [] });
  assert.equal(record.exit_code, 0);
  assert.deepEqual(record.args, ['seed-judged', '--tags', 'Context-dependent']);
  assert.equal(checkPlan(plan, readJson(join(w.root, 'config.json'))).ok, true);
});

test('seed-judged skips a row that is ticked already and says so, runs again to nothing, and never unticks a row it is not given', async () => {
  const w = await filled({ taxonomy: smallTaxonomy() });
  assert.equal((await w.run(['seed-judged', '--tags', 'Context-dependent'])).code, 0);
  const sent = patches(w).length;
  const again = await w.run(['seed-judged', '--tags', 'Context-dependent']);
  assert.deepEqual([again.code, again.out], [0, ['seed-judged: Context-dependent is ticked already; nothing was written']]);
  assert.equal(patches(w).length, sent, 'nothing was sent');
  // an editor unticks one by hand: the seed does not touch a row it is not asked about, and never writes false
  const cd = rowsOf(w, 'rulebook').find((r) => r.Name === 'Context-dependent');
  w.fake.editRow(cd.page_id, { Judged: false });
  const both = await w.run(['seed-judged', '--tags', 'Trailing period, Context-dependent , Trailing period']);
  assert.equal(both.code, 0, both.text);
  assert.deepEqual(judgedOf(w), { 'Context-dependent': true, 'Trailing period': true }, 'named twice, ticked once');
  const third = await w.run(['seed-judged', '--tags', 'Trailing period']);
  assert.deepEqual(third.out, ['seed-judged: Trailing period is ticked already; nothing was written']);
  w.fake.editRow(cd.page_id, { Judged: false });
  assert.equal((await w.run(['seed-judged', '--tags', 'Trailing period'])).code, 0);
  assert.deepEqual(judgedOf(w), { 'Context-dependent': false, 'Trailing period': true }, 'a box an editor cleared stays cleared unless the seed is asked for that tag');
  const planned = runDirs(w.root, 'seed-judged').filter((d) => existsSync(join(d, 'plan.jsonl'))).flatMap((d) => readPlan(d).ops);
  assert.ok(planned.length >= 3);
  assert.equal(planned.every((o) => o.properties.Judged === true), true, 'no plan of the seed ever holds a false');
  // mixed: one ticked, one not: the line names both
  w.fake.editRow(rowsOf(w, 'rulebook').find((r) => r.Name === 'Trailing period').page_id, { Judged: false });
  const mixed = await w.run(['seed-judged', '--tags', 'Context-dependent,Trailing period']);
  assert.deepEqual(mixed.out, ['seed-judged: Judged ticked and read back on Context-dependent and Trailing period']);
  w.fake.editRow(cd.page_id, { Judged: true });
  w.fake.editRow(rowsOf(w, 'rulebook').find((r) => r.Name === 'Trailing period').page_id, { Judged: false });
  const half = await w.run(['seed-judged', '--tags', 'Context-dependent,Trailing period']);
  assert.deepEqual(half.out, ['seed-judged: Judged ticked and read back on Trailing period; Context-dependent was ticked already']);
});

test('seed-judged refuses an unknown name and writes nothing, also when other names are fine; it needs --tags, the session, a Judged column and an unpaused agent', async () => {
  const w = await filled({ taxonomy: smallTaxonomy() });
  const before = patches(w).length;
  const unknown = await w.run(['seed-judged', '--tags', 'Context-dependent,Context dependent']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err[0], /nothing was written: "Context dependent" is not a row of the Rulebook \(it has Context-dependent, Trailing period\)/);
  assert.deepEqual(judgedOf(w), { 'Context-dependent': false, 'Trailing period': false }, 'the known name was not ticked either');
  assert.equal(patches(w).length, before);
  const none = await w.run(['seed-judged']);
  assert.equal(none.code, 2);
  assert.match(none.err[0], /seed-judged needs --tags/);
  assert.equal((await w.run(['seed-judged', '--tags', ' , '])).code, 2);
  // Paused is ticked in Agent settings: exit 3, nothing is written
  const settings = rowsOf(w, 'agent_settings')[0];
  w.fake.editRow(settings.page_id, { Paused: true });
  const paused = await w.run(['seed-judged', '--tags', 'Context-dependent']);
  assert.equal(paused.code, 3, paused.text);
  assert.deepEqual(judgedOf(w), { 'Context-dependent': false, 'Trailing period': false });
  w.fake.editRow(settings.page_id, { Paused: false });
  // the builder session is closed: the gate stops it
  assert.equal((await w.run(['builder', 'close'])).code, 0);
  const closed = await w.run(['seed-judged', '--tags', 'Context-dependent']);
  assert.equal(closed.code, 2);
  assert.match(closed.err[0], /no builder session is open/);
  assert.equal(patches(w).length, before);
});

test('seed-judged on a Rulebook without the Judged column says to run build first and writes nothing', async () => {
  const w = await builtWithoutJudged();
  const r = await w.run(['seed-judged', '--tags', 'Context-dependent']);
  assert.equal(r.code, 2);
  assert.match(r.err.join('\n'), /the Rulebook has no Judged checkbox yet: run "setup\.mjs build" first/);
  assert.equal(patches(w).length, 0);
});

test('seed-judged refuses a config that is not the v2 profile, a protected Rulebook and a Rulebook of the first page, before any request', async () => {
  const w = await filled({ taxonomy: smallTaxonomy() });
  const config = readJson(join(w.root, 'config.json'));
  const run = { id: 'r', dir: w.root, update() {} };
  const ctx = (c) => ({ root: w.root, config: c, now: NOW, run, log() {}, warn() {}, restClient: () => { throw new Error('no request may be made'); } });
  const notV2 = structuredClone(config);
  delete notV2.profile;
  await assert.rejects(stepSeedJudged(ctx(notV2), { tags: 'Context-dependent' }), (e) => e instanceof InputError && /for the v2 profile only/.test(e.message));
  const protectedRulebook = structuredClone(config);
  protectedRulebook.notion.protected_database_ids.push(config.notion.rulebook.database_id);
  await assert.rejects(stepSeedJudged(ctx(protectedRulebook), { tags: 'Context-dependent' }), (e) => e instanceof InputError && /Rulebook is on the protected lists/.test(e.message));
  const first = readJson(join(import.meta.dirname, '..', '..', 'agents', 'claim-tagger-mvp', 'setup', 'first-page.json')).tables.rulebook;
  const ids = new Set([first.database_id, first.data_source_id].map(normId));
  const onFirstPage = structuredClone(config);
  onFirstPage.notion.protected_database_ids = onFirstPage.notion.protected_database_ids.filter((x) => !ids.has(normId(x)));
  onFirstPage.notion.rulebook.database_id = first.database_id;
  onFirstPage.notion.rulebook.data_source_id = first.data_source_id;
  await assert.rejects(stepSeedJudged(ctx(onFirstPage), { tags: 'Context-dependent' }), (e) => e instanceof InputError && /table of the first page \(setup\/first-page\.json\)/.test(e.message));
  assert.equal(patches(w).length, 0);
  // and the command line refuses the same config at the door
  assert.deepEqual(parseTagNames(' a, b ,,a '), ['a', 'b']);
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
