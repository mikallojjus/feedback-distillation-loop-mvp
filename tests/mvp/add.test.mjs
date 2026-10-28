import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_CLAIMS, USAGE, add, main, parseItems } from '../../agents/claim-tagger-mvp/scripts/add.mjs';
import { status } from '../../agents/claim-tagger-mvp/scripts/status.mjs';
import { ADD_SCRIPT, CLAIMS_GEO_COLUMNS, addableProperties } from '../../agents/claim-tagger-mvp/scripts/lib/config.mjs';
import { countGeoRequests } from '../../agents/claim-tagger-mvp/scripts/lib/geo-read.mjs';
import { geoRowOf, normaliseName } from '../../agents/claim-tagger-mvp/scripts/lib/geo-row.mjs';
import { readJson } from '../../agents/claim-tagger-mvp/scripts/lib/jsonl.mjs';
import { LoopExit, applyStep, withRun } from '../../agents/claim-tagger-mvp/scripts/lib/loop.mjs';
import { AUDIT_PREFIX, PlanError, applyPlan, checkPlan, newPlan } from '../../agents/claim-tagger-mvp/scripts/lib/plan.mjs';
import { lintReport } from '../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { RUN_SCRIPTS } from '../../agents/claim-tagger-mvp/scripts/walkthrough.mjs';
import { DEFAULT_ALLOWED_SCRIPTS } from '../../agents/claim-tagger-mvp/scripts/transcript-check.mjs';
import { createFakeGeo, hexId } from './fixtures/fake-geo.mjs';
import { builtConfig } from './helpers/config-fixture.mjs';
import { claimText, makeWorld, quietIo } from './helpers/loop-world.mjs';
import { TABLE_SPECS } from './helpers/tables.mjs';

// /claim-tagger add (decisions P35 to P37) on the fakes: the Notion fake with the five tables, the Geo fake with claims, in a temporary state folder. No network, no .env, nothing real.

const CONFIG = JSON.parse(readFileSync(new URL('../../agents/claim-tagger-mvp/config.json', import.meta.url), 'utf8'));
const GEO = CONFIG.geo;
const SPACE = Object.fromEntries(GEO.spaces.map((s) => [s.name, s.id]));
const [US, WORLD, AI, HEALTH, CRYPTO, TECH] = GEO.spaces.map((s) => s.name);
const OUTSIDE = hexId(900, 'b'); // a space that is not one of the six
const BROWSER = GEO.browser_url;
const CLAIMS_SPEC = { ...TABLE_SPECS.claims, 'Geo Tags': { type: 'multi_select', options: ['Debate', 'Politics', 'Economy'] } };
const clone = (v) => JSON.parse(JSON.stringify(v));

const gid = (n) => hexId(n); // the Geo ID of the test claim n
const linkOf = (n, space = US) => `${BROWSER}/space/${SPACE[space]}/${gid(n)}`;
const text = (n) => `Mayor ${n} said the plan costs less.`;

/** A world: Claims holds `inClaims` ([[n, text]]), the Geo fake is empty (the test adds its claims), and run(claimsText) runs add on both. */
async function setup({ inClaims = [], ...more } = {}) {
  const w = await makeWorld({
    claims: inClaims.map(([n, t]) => ({ id: gid(n), text: t ?? text(n) })), configure: (c) => { c.geo = clone(GEO); }, tableSpecs: { claims: CLAIMS_SPEC }, ...more,
  });
  const geo = createFakeGeo({ geo: GEO });
  const run = async (claims, extra = {}) => {
    const h = w.hooks({ claims, geoFetchImpl: geo.fetchImpl, ...extra });
    const r = await add(h);
    return { r, h, report: r.report };
  };
  const claim = (n, over = {}) => geo.addClaim({ id: gid(n), name: text(n), spaces: [SPACE[US]], created: '2026-09-14', ...over });
  return { w, geo, run, claim };
}

/** What every report must be: the lint, and report.md is what the script printed. */
function assertReport(h, r) {
  assert.ok(r.markdown, 'a report was written');
  assert.deepEqual(lintReport(r.markdown), [], r.markdown);
  assert.equal(h.io.outs.join('\n').trimEnd(), r.markdown.trimEnd(), 'the script prints the report and nothing else on stdout');
  assert.ok(!/\bcalls?\b|token|duration|\$|\.mjs|--[a-z]|runs\//i.test(r.markdown), r.markdown);
  return r.report;
}
const allClaims = (w) => `https://www.notion.so/${w.DB.claims}`; // the link to Claims the Next line gives
const runRecord = (r) => readJson(join(r.runDir, 'run.json'));
const claimRows = (w) => w.rows('claims');
const postsToClaims = (w) => w.writes().filter((q) => q.method === 'POST' && q.path === '/pages');

// ---- the input ----------------------------------------------------------------------------------------------------------------------

test('parseItems: links of the configured host, Geo IDs with or without dashes, spaces and commas, a repeat counts once, anything else is not ok', () => {
  const a = gid(1);
  const dashed = `${a.slice(0, 8)}-${a.slice(8, 12)}-${a.slice(12, 16)}-${a.slice(16, 20)}-${a.slice(20)}`;
  const { items } = parseItems(`${linkOf(1)}, ${gid(2)} ${dashed}\n${gid(3).toUpperCase()},"${linkOf(4, AI)}", <${linkOf(5)}>.`, GEO);
  assert.deepEqual(items.map((i) => [i.ok, i.id, i.spaceId]), [
    [true, gid(1), SPACE[US]], [true, gid(2), null], [true, gid(3), null], [true, gid(4), SPACE[AI]], [true, gid(5), SPACE[US]],
  ], 'the dashed form of claim 1 is the same claim as its link: it counts once');
  // the same site with or without www; a stop, a bracket or a mark after the link is not part of it
  const site = `https://geobrowser.io/space/${SPACE[US]}/${gid(6)}`;
  const punctuated = parseItems([`${site}.`, `${linkOf(7)};`, `(${linkOf(8)})`, `[${linkOf(9)}]`, `${linkOf(10)}!`, `"${linkOf(11)}":`, `<${linkOf(12)}>`].join(' '), GEO).items;
  assert.deepEqual(punctuated.map((i) => [i.ok, i.id]), [6, 7, 8, 9, 10, 11, 12].map((n) => [true, gid(n)]));
  assert.equal(punctuated[0].spaceId, SPACE[US], 'geobrowser.io without www is the same site');
  for (const other of [`https://www.geobrowser.io.example.com/space/${SPACE[US]}/${gid(1)}`, `https://evilgeobrowser.io/space/${SPACE[US]}/${gid(1)}`, `https://app.geobrowser.io/space/${SPACE[US]}/${gid(1)}`]) {
    assert.equal(parseItems(other, GEO).items[0].ok, false, other);
  }
  const bad = parseItems([
    'hello', `https://example.com/space/${SPACE[US]}/${gid(1)}`, `http://www.geobrowser.io/space/${SPACE[US]}/${gid(1)}`, `${BROWSER}/space/${SPACE[US]}`,
    `${BROWSER}/space/${SPACE[US]}/${gid(1)}/extra`, `${BROWSER}/space/nothex/${gid(1)}`, `${BROWSER}/${SPACE[US]}/${gid(1)}`, gid(1).slice(1), `${gid(1)}0`, 'hello',
  ].join(' '), GEO).items;
  assert.equal(bad.length, 9, 'the repeated "hello" counts once');
  assert.ok(bad.every((i) => i.ok === false), JSON.stringify(bad));
  assert.deepEqual(parseItems('', GEO).items, []);
  assert.deepEqual(parseItems(' , ,, ', GEO).items, []);
});

test('add by link, by ID and mixed: three claims are added with the nine Geo columns of the pick, and the report is the three parts', async () => {
  const { w, geo, run, claim } = await setup({ inClaims: [[1], [2]] });
  claim(11, { created: '2026-09-14', tags: ['Politics'], isFactual: true, sources: [{ id: hexId(1, 'e'), name: 'The Daily', url: 'https://example.com/daily' }], topics: ['Elections'] });
  claim(12, { spaces: [SPACE[AI]], created: '2026-10-02' });
  claim(13, { spaces: [SPACE[HEALTH]], created: '2026-08-30', tags: ['Economy'] });
  const before = claimRows(w).length;
  const { r, h, report } = await run(`${linkOf(11)} ${gid(12)}, ${linkOf(13, HEALTH)}`);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assertReport(h, r);
  assert.equal(report.sentence, `Add: 3 claims added to Claims from Geo ("${text(11)}", "${text(12)}" and "${text(13)}").`);
  assert.deepEqual(report.header, ['What', 'Result', '']);
  assert.deepEqual(report.rows, [['Added', '3', '']]);
  assert.equal(report.next, `Next: type /claim-tagger tag to read the 3 new claims; they are in All claims (${allClaims(w)}).`);
  assert.equal(claimRows(w).length, before + 3);

  const row = w.row('claims', gid(11));
  assert.equal(row['Geo Name'], text(11));
  assert.equal(row['Geo URL'], linkOf(11), 'the address of the claim in its space');
  assert.equal(row['Geo Space'], US);
  assert.equal(row['Geo Created'], '2026-09-14');
  assert.equal(row['Geo Is factual'], true);
  assert.deepEqual(row['Geo Tags'], ['Debate', 'Politics']);
  assert.equal(row['Geo Topics'], 'Elections');
  assert.equal(row['Geo Sources'], 'The Daily');
  assert.equal(w.row('claims', gid(12))['Geo Space'], AI);
  assert.equal(w.row('claims', gid(13))['Geo URL'], linkOf(13, HEALTH));
  // the agent's and the editor's columns of a new row stay empty: nothing is marked, nothing is tagged
  for (const id of [gid(11), gid(12), gid(13)]) {
    const c = w.claim(id);
    assert.deepEqual([c['Agent tags'], c['Verified tags'], c['Tags waiting']], [[], [], []]);
    assert.ok(!c['Review status'] && !c['Agent status'] && !c['Challenged tags notes'] && !c['Agent reasons'] && c['Agent confidence'] == null, JSON.stringify(c));
  }
  // the link of the source is in the cell
  const page = w.fake.page(w.row('claims', gid(11)).page_id);
  assert.equal(page.properties['Geo Sources'].rich_text[0].text.link.url, 'https://example.com/daily');

  const rec = runRecord(r);
  assert.equal(rec.exit_code, 0);
  assert.deepEqual(rec.add.added.map((a) => a.geo_id), [gid(11), gid(12), gid(13)]);
  assert.deepEqual(rec.plan, { creates: 3, updates: 0 });
  assert.equal(geo.requests.every((q) => q.op === 'ClaimDetails'), true);
  assert.equal(rec.geo_requests.nonQuery, 0);
});

test('add: one claim added says "the new claim", and a report names at most three claims', async () => {
  const { w: w1, geo, run, claim } = await setup();
  claim(11);
  const one = await run(gid(11));
  assert.equal(one.report.sentence, `Add: 1 claim added to Claims from Geo ("${text(11)}").`);
  assert.equal(one.report.next, `Next: type /claim-tagger tag to read the new claim; it is in All claims (${allClaims(w1)}).`);
  const { w, run: run2, claim: claim2 } = await setup();
  for (let n = 21; n <= 25; n++) claim2(n, { name: `Claim number ${n} is a long claim and it goes on and on about the budget of the city.` });
  const five = await run2([21, 22, 23, 24, 25].map(gid).join(' '));
  assert.equal(five.r.exit, 0, five.h.io.errs.join('\n'));
  assert.equal(five.report.sentence, 'Add: 5 claims added to Claims from Geo ("Claim number 21 is a long claim and i...", "Claim number 22 is a long claim and i...", "Claim number 23 is a long claim and i..." and more).');
  assert.equal(five.report.next, `Next: type /claim-tagger tag to read the 5 new claims; they are in All claims (${allClaims(w)}).`);
  assert.equal(claimRows(w).length, 5);
  assert.equal(geo.requests.length, 1, 'one claim, one request');
});

test('add: more than 50 items is exit 2 before anything is read; 50 are fine and are read in batches', async () => {
  const { w, geo, run, claim } = await setup({ inClaims: [[1]] });
  const requestsBefore = w.requests().length;
  const tooMany = Array.from({ length: MAX_CLAIMS + 1 }, (_, i) => gid(100 + i)).join(' ');
  const { r, h, report } = await run(tooMany);
  assert.equal(r.exit, 2);
  assertReport(h, r);
  assert.equal(report.sentence, 'Add: nothing was read or added, because 51 links or IDs are more than the 50 that one command takes.');
  assert.equal(report.rows, undefined, 'no table');
  assert.equal(report.next, 'Next: type /claim-tagger add again with at most 50 links.');
  assert.equal(w.requests().length, requestsBefore, 'Notion was not asked anything');
  assert.equal(geo.requests.length, 0, 'Geo was not asked anything');
  assert.equal(w.writes().length, 0);
  // the same 51 with one repeated is 50 and goes through; 50 real claims are added, read from Geo in batches of 25
  for (let i = 0; i < MAX_CLAIMS; i++) claim(100 + i);
  const fifty = Array.from({ length: MAX_CLAIMS }, (_, i) => gid(100 + i));
  const ok = await run([...fifty, fifty[0]].join(', '));
  assert.equal(ok.r.exit, 0, ok.h.io.errs.join('\n'));
  assert.equal(ok.report.sentence.startsWith('Add: 50 claims added to Claims from Geo ('), true);
  assert.equal(claimRows(w).length, 1 + 50);
  assert.deepEqual(geo.requests.map((q) => q.aliases), [25, 25]);
  assert.equal(postsToClaims(w).length, 50);
});

test('add: nothing given, and the options: no --claims is exit 2 with a report; the usage and a bad option exit before any run', async () => {
  const { w, geo, run } = await setup();
  const none = await run('');
  assert.equal(none.r.exit, 2);
  assert.equal(none.report.sentence, 'Add: nothing was done, because no Geo links or IDs were given.');
  assert.equal(none.report.next, 'Next: type /claim-tagger add with the Geo links or IDs of the claims.');
  assert.equal(geo.requests.length, 0);
  const io = { outs: [], errs: [], out: (s) => io.outs.push(s), err: (s) => io.errs.push(s) };
  assert.equal(await main(['--help'], io), 0);
  assert.equal(io.outs[0], USAGE);
  assert.equal(await main(['--claims', 'x', '--bogus'], io), 2);
  assert.match(io.errs.join('\n'), /add: .*bogus/);
  void w;
});

test('main: --claims runs the script and prints the report; a run id the loop keeps for its own files is exit 2', async () => {
  const { w, geo, claim } = await setup();
  claim(11);
  const { io: ignored, ...deps } = w.hooks({ geoFetchImpl: geo.fetchImpl });
  void ignored;
  const io = quietIo();
  assert.equal(await main(['--claims', `${linkOf(11)}`, '--run-id', 'add-by-main'], io, deps), 0, io.errs.join('\n'));
  assert.ok(existsSync(join(w.root, 'runs', 'add-by-main', 'report.md')));
  assert.match(io.outs.join('\n'), /^Add: 1 claim added to Claims from Geo \(/);
  assert.equal(w.row('claims', gid(11))['Geo Space'], US);
  const reserved = quietIo();
  assert.equal(await main(['--claims', gid(12), '--run-id', 'PAUSED'], reserved, deps), 2);
  assert.match(reserved.errs.join('\n'), /PAUSED/);
  assert.equal(await main(['--claims', gid(12), '--driver', 'banana'], quietIo(), deps), 2);
});

// ---- already in Claims, and the same text ---------------------------------------------------------------------------------------------

test('add: every claim is already in Claims: nothing is added, exit 2, and the Next line sends the editor to tag', async () => {
  const { w, geo, run } = await setup({ inClaims: [[1], [2]] });
  const { r, h, report } = await run(`${gid(1)} ${linkOf(2)}`);
  assert.equal(r.exit, 2);
  assertReport(h, r);
  assert.equal(report.sentence, `Add: nothing was added; both claims are already in Claims ("${text(1)}" and "${text(2)}").`);
  assert.deepEqual(report.rows, [['Already in Claims', `2: "${text(1)}" and "${text(2)}"`, '']]);
  // the agent has not read them (no Agent status, not Reviewed): tag has something to read
  assert.equal(report.next, 'Next: type /claim-tagger tag to read them.');
  assert.equal(geo.requests.length, 0, 'a claim that is in Claims is not read from Geo');
  assert.equal(w.writes().length, 0);
  const one = await run(gid(1));
  assert.equal(one.report.sentence, `Add: nothing was added; the claim is already in Claims ("${text(1)}").`);
  assert.equal(one.report.next, 'Next: type /claim-tagger tag to read it.');
  const rec = runRecord(r);
  assert.equal(rec.exit_code, 2);
  assert.equal(rec.status, 'stopped');
  assert.deepEqual(rec.add.not_added.map((n) => [n.geo_id, n.reason]), [[gid(1), 'already'], [gid(2), 'already']]);
});

test('add: the same text as a claim in Claims is refused and the existing claim is named; so is the same text twice in one command', async () => {
  const { w, geo, run, claim } = await setup({ inClaims: [[1]] });
  claim(11, { name: text(1).toUpperCase().replace('.', '').replace(/ /g, '  ') }); // the text of claim 1 in capitals, doubled spaces, no final stop
  claim(12, { name: 'A brand new claim about taxes.' });
  claim(13, { name: 'a brand new claim about taxes' }); // the same as 12
  claim(14, { typeIds: [hexId(777, 'a')], name: 'Another new claim about roads.' }); // not a claim: it does not make its text taken
  claim(15, { name: 'Another new claim about roads' });
  const { r, h, report } = await run([11, 12, 13, 14, 15].map(gid).join(' '));
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assertReport(h, r);
  assert.equal(report.sentence, 'Add: 2 claims added to Claims from Geo ("A brand new claim about taxes." and "Another new claim about roads"); 3 were not added.');
  assert.deepEqual(report.rows, [
    ['Added', '2', ''],
    ['Not a claim', '1: "Another new claim about roads."', ''],
    // 11 has the text of claim 1 (in Claims), 13 the text of claim 12 (earlier in this command): the report names both existing claims
    ['Same text as a claim in Claims', `2: "${text(1)}" and "A brand new claim about taxes." are there already or earlier in your list`, ''],
  ]);
  assert.deepEqual(claimRows(w).map((x) => x['Geo ID']).sort(), [gid(1), gid(12), gid(15)]);
  const refused = runRecord(r).add.not_added;
  assert.deepEqual(refused.find((n) => n.geo_id === gid(11)), { item: gid(11), geo_id: gid(11), reason: 'same_text', same_as: { geo_id: gid(1), claim: text(1), where: 'Claims' } });
  assert.deepEqual(refused.find((n) => n.geo_id === gid(13)).same_as, { geo_id: gid(12), claim: 'A brand new claim about taxes.', where: 'this command' });
  assert.equal(normaliseName(' The  Mayor said it. '), 'the mayor said it');
  void geo;
});

// ---- what Geo answers -----------------------------------------------------------------------------------------------------------------

test('add: not found, not a claim, not in our spaces and already in Claims are each told, and the claim that passes is added (five table rows)', async () => {
  const { w, geo, run, claim } = await setup({ inClaims: [[1]] });
  claim(11);
  geo.addEntity({ id: gid(12), name: 'A person, not a claim', typeIds: [hexId(555, 'a')], spaceIds: [SPACE[US]], createdAt: '1789000000' });
  claim(13, { spaces: [OUTSIDE] });
  const { r, h, report } = await run([1, 11, 12, 13, 14].map(gid).join(' ')); // 14 is in no space of Geo's: Geo gives a stub
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assertReport(h, r);
  assert.equal(report.sentence, `Add: 1 claim added to Claims from Geo ("${text(11)}"); 4 were not added.`);
  assert.deepEqual(report.rows, [
    ['Added', '1', ''], ['Already in Claims', `1: "${text(1)}"`, ''], ['Not found in Geo', `1: ID ending ${gid(14).slice(-8)}`, ''],
    ['Not a claim', '1: "A person, not a claim"', ''], ['Not in the six spaces of Claims', `1: "${text(13)}"`, ''],
  ]);
  assert.equal(report.next, `Next: type /claim-tagger tag to read the new claim; it is in All claims (${allClaims(w)}).`);
  assert.deepEqual(runRecord(r).add.not_added.map((n) => [n.geo_id, n.reason]), [[gid(1), 'already'], [gid(12), 'not_claim'], [gid(13), 'not_in_spaces'], [gid(14), 'not_found']]);
  assert.equal(claimRows(w).length, 2);
});

test('add: every kind of refusal at once: the table has five rows at most, the kinds past the fourth are one row, and the example of the full report', async () => {
  const { w, geo, run, claim } = await setup({ inClaims: [[1], [2]] });
  claim(11);
  geo.addEntity({ id: gid(12), name: 'A person', typeIds: [hexId(555, 'a')], spaceIds: [SPACE[US]], createdAt: '1789000000' });
  claim(13, { spaces: [OUTSIDE] });
  claim(14, { name: '', ownName: null }); // no name anywhere
  claim(15, { name: text(2) }); // the text of claim 2
  claim(16, { sources: [{ id: hexId(2, 'e'), name: 'A page of ours', url: `https://www.notion.so/${w.config.notion.protected_database_ids[0]}` }] });
  const { r, h, report } = await run([11, 1, 12, 13, 14, 15, 16, 17, 'not-a-claim'].map((x) => (typeof x === 'number' ? gid(x) : x)).join(' '));
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assertReport(h, r);
  assert.equal(report.sentence, `Add: 1 claim added to Claims from Geo ("${text(11)}"); 8 were not added.`);
  assert.deepEqual(report.rows, [
    ['Added', '1', ''], ['Already in Claims', `1: "${text(1)}"`, ''], ['Not found in Geo', `1: ID ending ${gid(17).slice(-8)}`, ''],
    ['Same text as a claim in Claims', `1: "${text(2)}" is there already`, ''],
    ['Other reasons', '5: 1 not a claim, 1 not in the six spaces of Claims, 1 not a Geo link or ID, 1 with no name in Geo, 1 with a source that links to a protected Notion page', ''],
  ]);
  const kinds = runRecord(r).add.not_added.map((n) => n.reason).sort();
  assert.deepEqual(kinds, ['already', 'bad_input', 'no_name', 'not_claim', 'not_found', 'not_in_spaces', 'same_text', 'source_link']);
  assert.equal(h.io.outs.join('\n').trimEnd(), r.markdown.trimEnd());
  assert.equal(claimRows(w).length, 3);
  void geo;
});

test('add: nothing added because of refusals: exit 2, the sentence says why, and the Next line sends the editor to the links', async () => {
  const { w, geo, run, claim } = await setup({ inClaims: [[1]] });
  claim(12, { spaces: [OUTSIDE] });
  const { r, h, report } = await run(`${gid(1)} ${gid(11)} ${gid(12)} nonsense`);
  assert.equal(r.exit, 2);
  assertReport(h, r);
  assert.equal(report.sentence, 'Add: nothing was added to Claims: 1 already in Claims, 1 not found in Geo, 1 not in the six spaces of Claims and 1 not a Geo link or ID.');
  assert.deepEqual(report.rows, [
    ['Already in Claims', `1: "${text(1)}"`, ''], ['Not found in Geo', `1: ID ending ${gid(11).slice(-8)}`, ''],
    ['Not in the six spaces of Claims', `1: "${text(12)}"`, ''], ['Not a Geo link or ID', '1: "nonsense"', ''],
  ]);
  assert.equal(report.next, 'Next: check the links and type /claim-tagger add again.');
  assert.equal(w.writes().length, 0);
  assert.equal(geo.requests.length, 1, 'the claims that could be there were read once');
});

test('add: the space is the link\'s space when it is configured and holds the claim, else the first configured space (in config order) that holds it; the name is the space\'s own', async () => {
  const { w, run, claim } = await setup();
  claim(11, { spaces: [OUTSIDE, SPACE[AI]] }); // the link names a space that is not ours: the claim is also in AI
  claim(12, { spaces: [SPACE[US], SPACE[WORLD]] }); // the link names World, which holds it
  claim(13, { spaces: [SPACE[US], SPACE[WORLD]] }); // the link names AI, which does not hold it
  claim(14, { spaces: [SPACE[CRYPTO], SPACE[WORLD]] }); // a bare ID: the first configured space in config order, which is World, not the entity's own order
  claim(15, { spaces: [SPACE[TECH]], name: 'The entity name', ownName: 'The name this space gave it' });
  const { r, h } = await run([`${BROWSER}/space/${OUTSIDE}/${gid(11)}`, linkOf(12, WORLD), linkOf(13, AI), gid(14), gid(15)].join(' '));
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.equal(w.row('claims', gid(11))['Geo Space'], AI);
  assert.equal(w.row('claims', gid(11))['Geo URL'], linkOf(11, AI));
  assert.equal(w.row('claims', gid(12))['Geo Space'], WORLD);
  assert.equal(w.row('claims', gid(13))['Geo Space'], US);
  assert.equal(w.row('claims', gid(14))['Geo Space'], WORLD);
  assert.equal(w.row('claims', gid(15))['Geo Name'], 'The name this space gave it');
});

test('add: Geo Tags writes only the options the column has; the others are left out and listed, and no option is made in Notion', async () => {
  const { w, run, claim } = await setup();
  claim(11, { tags: ['Politics', 'Hypothetical', 'Featured'] });
  const optionsBefore = w.fake.createdOptions.length;
  const { r, h } = await run(gid(11));
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.deepEqual(w.row('claims', gid(11))['Geo Tags'], ['Debate', 'Politics']);
  assert.deepEqual(runRecord(r).add.geo_tags_left_out, [{ geo_id: gid(11), tags: ['Featured', 'Hypothetical'] }]);
  assert.equal(w.fake.createdOptions.length, optionsBefore, 'Notion made no option');
  assert.deepEqual(w.fake.dataSource(w.config.notion.claims.data_source_id).properties['Geo Tags'].multi_select.options.map((o) => o.name), ['Debate', 'Politics', 'Economy'], 'the column has the options it had');
});

test('add: a source link at a protected id refuses that claim; an ordinary source is linked', async () => {
  const { w, run, claim } = await setup();
  const protectedId = w.config.notion.protected_database_ids[0];
  claim(11, { sources: [{ id: hexId(3, 'e'), name: 'Our table', url: `https://www.notion.so/${protectedId.replace(/-/g, '')}?v=abc` }] });
  claim(12, { sources: [{ id: hexId(4, 'e'), name: 'Fine source', url: 'https://example.com/fine' }] });
  const { r, h, report } = await run(`${gid(11)} ${gid(12)}`);
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assert.deepEqual(report.rows, [['Added', '1', ''], ['A source links to a protected Notion page', `1: "${text(11)}"`, '']]);
  assert.equal(w.row('claims', gid(11)), null);
  assert.ok(w.row('claims', gid(12)));
  assert.equal(JSON.stringify(w.requests()).includes(protectedId.replace(/-/g, '')), false, 'the protected id went nowhere');
});

// ---- failures -----------------------------------------------------------------------------------------------------------------------

test('add: Geo that cannot be read is exit 1 with nothing written, and the same command works when Geo is back', async () => {
  const { w, geo, run, claim } = await setup({ inClaims: [[1]] });
  claim(11);
  geo.failNext('500', Infinity);
  const { r, h, report } = await run(`${gid(11)} ${gid(12)}`);
  assert.equal(r.exit, 1);
  assertReport(h, r);
  assert.equal(report.sentence, 'Add: nothing was added, because Geo could not be read.');
  assert.equal(report.next, 'Next: type /claim-tagger add again with the same links in a while.');
  assert.equal(w.writes().length, 0);
  assert.equal(claimRows(w).length, 1);
  assert.equal(runRecord(r).status, 'stopped');
  assert.equal(runRecord(r).resume, `node agents/claim-tagger-mvp/scripts/add.mjs --claims "${gid(11)} ${gid(12)}"`);
  geo.failNext('network', Infinity);
  assert.equal((await run(gid(11))).r.exit, 1, 'a network failure is the same');
  geo.failNext('html', Infinity);
  assert.equal((await run(gid(11))).r.exit, 1, 'an answer that is not JSON is the same');
  assert.equal(w.writes().length, 0, 'three failed runs wrote nothing');
  // Geo is back: the same command adds the claim (the failures above were counted as many as they were asked)
  const back = createFakeGeo({ geo: GEO });
  back.addClaim({ id: gid(11), name: text(11), spaces: [SPACE[US]], created: '2026-09-14' });
  const ok = await add(w.hooks({ claims: gid(11), geoFetchImpl: back.fetchImpl }));
  assert.equal(ok.exit, 0);
  assert.equal(claimRows(w).length, 2);
});

test('add: a paused agent is exit 3 (Notion\'s Paused box and the pause file alike), before Geo is asked anything', async () => {
  const { w, geo, run, claim } = await setup();
  claim(11);
  w.setPaused(true);
  const a = await run(gid(11));
  assert.equal(a.r.exit, 3);
  assert.equal(a.report.sentence, 'Add: nothing was done, because the agent is paused.');
  assert.equal(geo.requests.length, 0);
  assert.equal(w.writes().length, 0);
  w.setPaused(false);
  w.write('runs/PAUSED', 'paused by hand\n');
  const b = await run(gid(11));
  assert.equal(b.r.exit, 3);
  assert.equal(geo.requests.length, 0);
  assert.equal(w.writes().length, 0);
});

test('add: a rulebook text edited by hand is exit 4, before Geo is asked anything', async () => {
  const { w, geo, run, claim } = await setup();
  claim(11);
  const old = w.row('rulebook', 'Context-dependent')['When to use'];
  w.fake.editRow(w.ids.tag['Context-dependent'], { 'When to use': `${old}\n6. A sixth rule somebody added by hand.` });
  const { r, report } = await run(gid(11));
  assert.equal(r.exit, 4);
  assert.match(report.sentence, /^Add: nothing was done, because the rulebook text in Notion no longer matches the saved edition/);
  assert.equal(geo.requests.length, 0);
  assert.equal(w.writes().length, 0);
});

test('add: a practice page refuses it (P37: production only), and the walkthrough runner does not list it', async () => {
  for (const world of [{ demo: true }, { demoId: 'practice-1' }]) {
    const { w, geo, run, claim } = await setup(world);
    claim(11);
    const before = w.requests().length;
    const { r, h, report } = await run(gid(11));
    assert.equal(r.exit, 2, h.io.errs.join('\n'));
    assert.equal(report.demo, true);
    assert.equal(report.sentence, 'Add: nothing was done, because adding claims works only on the real Claims table; the practice page has its own claims.');
    assert.equal(report.next, 'Next: type /claim-tagger demo status to see where the practice page stands.');
    assert.equal(w.requests().length, before);
    assert.equal(geo.requests.length, 0);
  }
  assert.equal(RUN_SCRIPTS.includes('add'), false);
  assert.equal(DEFAULT_ALLOWED_SCRIPTS.includes('add'), true, 'the transcript check allows the script the skill runs');
});

test('add: a read-back that differs is exit 2 and the report says Notion does not hold what was written', async () => {
  const { w, run, claim } = await setup();
  claim(11);
  claim(12);
  // Notion keeps another name than the one written: a stand-in for anything that changes a value after the write
  const changing = async (url, init) => {
    const res = await w.fake.fetchImpl(url, init);
    if (res.ok && String(init?.method).toUpperCase() === 'POST' && new URL(url).pathname.endsWith('/pages')) {
      const page = await res.clone().json();
      if (page.properties['Geo ID'].rich_text.map((x) => x.plain_text).join('') === gid(11)) w.fake.editRow(page.id, { 'Geo Name': 'Changed after the write.' });
    }
    return res;
  };
  const { r, h, report } = await run(`${gid(11)} ${gid(12)}`, { fetchImpl: changing });
  assert.equal(r.exit, 2);
  assertReport(h, r);
  assert.equal(report.sentence, 'Add stopped: Notion does not hold what was written for one row.');
  assert.match(h.io.errs.join('\n'), /read-back differs/);
  assert.equal(runRecord(r).apply.mismatches, 1);
});

test('add: a write that did not finish is exit 1, and the same command goes on: a row that landed is already in Claims, one that did not is added', async () => {
  for (const landed of [true, false]) {
    const { w, run, claim } = await setup();
    claim(11);
    claim(12);
    // the first create is answered with an error, and it landed in Notion (or not): the script cannot know, so it never sends it twice and stops there
    w.fake.failNext('POST', /^\/pages$/, 500, 1, { applied: landed });
    const first = await run(`${gid(11)} ${gid(12)}`);
    assert.equal(first.r.exit, 1, first.h.io.errs.join('\n'));
    assertReport(first.h, first.r);
    assert.equal(first.report.sentence, 'Add: none was confirmed and 1 may have been added, before it stopped.');
    assert.equal(first.report.next, 'Next: type /claim-tagger add again with the same links; the ones added are skipped.');
    assert.equal(postsToClaims(w).length, 1, 'the failed create was sent once and not again');
    assert.equal(claimRows(w).length, landed ? 1 : 0);
    const again = await run(`${gid(11)} ${gid(12)}`);
    assert.equal(again.r.exit, 0, again.h.io.errs.join('\n'));
    assert.equal(again.report.sentence, landed
      ? `Add: 1 claim added to Claims from Geo ("${text(12)}"); 1 was not added.`
      : `Add: 2 claims added to Claims from Geo ("${text(11)}" and "${text(12)}").`);
    assert.deepEqual(claimRows(w).map((x) => x['Geo ID']).sort(), [gid(11), gid(12)], 'two rows, none twice');
  }
});

test('add: a request to Geo that is not a query stops the run with exit 2, and nothing is written', async () => {
  const { w, geo, run, claim } = await setup();
  claim(11);
  const tampering = async (url, init) => {
    appendFileSync(join(w.root, 'runs', 'bad-log', 'geo-requests.jsonl'), `${JSON.stringify({ ts: '2026-10-28T09:00:00.000Z', host: 'api-testnet.geobrowser.io', op: null, status: 200, attempt: 1 })}\n`);
    return geo.fetchImpl(url, init);
  };
  const { r, report } = await run(gid(11), { runId: 'bad-log', geoFetchImpl: tampering });
  assert.equal(r.exit, 2);
  assert.equal(report.sentence, 'Add: nothing was added, because a request to Geo was not a plain read.');
  assert.equal(w.writes().length, 0);
  assert.equal(claimRows(w).length, 0);
});

test('add: the Geo request log holds queries only, one line per attempt, and no body', async () => {
  const { geo, run, claim } = await setup();
  claim(11);
  claim(12);
  const { r } = await run(`${gid(11)} ${gid(12)}`);
  assert.equal(r.exit, 0);
  const file = join(r.runDir, 'geo-requests.jsonl');
  assert.ok(existsSync(file));
  assert.deepEqual(countGeoRequests(file), { total: 1, nonQuery: 0 });
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(Object.keys(lines[0]).sort(), ['attempt', 'host', 'op', 'status', 'ts']);
  assert.equal(lines[0].op, 'ClaimDetails');
  assert.deepEqual(geo.requests.map((q) => [q.op, q.rejected]), [['ClaimDetails', false]], 'Geo saw one query');
  assert.equal(runRecord(r).geo_requests.nonQuery, 0);
});

test('add: a claim another editor added after the pull is dropped as already in Claims, so no Geo ID is in Claims twice', async () => {
  const { w, geo, run, claim } = await setup();
  claim(11);
  claim(12);
  // while Geo is being read, somebody else adds claim 11 in Notion
  const meanwhile = async (url, init) => {
    if (!w.rows('claims').some((x) => x['Geo ID'] === gid(11))) w.fake.addRow(w.DB.claims, { 'Geo Name': text(11), 'Geo ID': gid(11), 'Geo URL': linkOf(11), 'Geo Space': US });
    return geo.fetchImpl(url, init);
  };
  const { r, h, report } = await run(`${gid(11)} ${gid(12)}`, { geoFetchImpl: meanwhile });
  assert.equal(r.exit, 0, h.io.errs.join('\n'));
  assertReport(h, r);
  assert.equal(report.sentence, `Add: 1 claim added to Claims from Geo ("${text(12)}"); 1 was not added.`);
  assert.deepEqual(report.rows, [['Added', '1', ''], ['Already in Claims', `1: "${text(11)}"`, '']]);
  assert.deepEqual(claimRows(w).map((x) => x['Geo ID']).sort(), [gid(11), gid(12)], 'each Geo ID once');
  assert.equal(postsToClaims(w).length, 1, 'only claim 12 was created');
  assert.deepEqual(runRecord(r).add.not_added, [{ item: gid(11), geo_id: gid(11), reason: 'already', added_meanwhile: true, claim: text(11) }]);
});

test('add: when the last look at Claims cannot be made, nothing is written (exit 1)', async () => {
  const { w, geo, run, claim } = await setup();
  claim(11);
  const breaking = async (url, init) => {
    w.fake.failNext('POST', /\/query$/, 500, 20);
    return geo.fetchImpl(url, init);
  };
  const { r, report } = await run(gid(11), { geoFetchImpl: breaking });
  assert.equal(r.exit, 1);
  assert.equal(report.sentence, 'Add: nothing was added, because Notion could not be read.');
  assert.equal(w.writes().length, 0);
  assert.equal(claimRows(w).length, 0);
});

test('add: a write that stops part way says how many claims were added, and the same links go on from there', async () => {
  const { w, run, claim } = await setup();
  for (const n of [11, 12, 13]) claim(n);
  // the second create of the claims is answered with an error that does not reach Notion; the script cannot know it did not land, so it stops there
  let creates = 0;
  const stopping = async (url, init) => {
    if (String(init?.method).toUpperCase() === 'POST' && new URL(url).pathname.endsWith('/pages')) {
      creates += 1;
      if (creates === 2) return new Response(JSON.stringify({ object: 'error', status: 500, code: 'internal_server_error', message: 'boom' }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
    return w.fake.fetchImpl(url, init);
  };
  const first = await run(`${gid(11)} ${gid(12)} ${gid(13)}`, { fetchImpl: stopping });
  assert.equal(first.r.exit, 1, first.h.io.errs.join('\n'));
  assertReport(first.h, first.r);
  // the second create answered an error: the script cannot know whether it landed, so it is "may have been" (not "was"), and the third was never sent
  assert.equal(first.report.sentence, 'Add: 1 of 3 claims was added and 1 more may have been, before it stopped.');
  assert.equal(first.report.rows, undefined, 'no table');
  assert.equal(first.report.next, 'Next: type /claim-tagger add again with the same links; the ones added are skipped.');
  assert.deepEqual(claimRows(w).map((x) => x['Geo ID']), [gid(11)]);
  const rec = runRecord(first.r).add;
  assert.deepEqual(rec.added.map((a) => a.geo_id), [gid(11)]);
  assert.deepEqual(rec.maybe_written.map((a) => a.geo_id), [gid(12)]);
  assert.deepEqual(rec.not_written.map((a) => a.geo_id), [gid(13)], 'not_written is for the rows that truly have no page');
  assert.equal(rec.written_unchecked, undefined);
  const again = await run(`${gid(11)} ${gid(12)} ${gid(13)}`);
  assert.equal(again.r.exit, 0, again.h.io.errs.join('\n'));
  assert.equal(again.report.sentence, `Add: 2 claims added to Claims from Geo ("${text(12)}" and "${text(13)}"); 1 was not added.`);
  assert.deepEqual(again.report.rows, [['Added', '2', ''], ['Already in Claims', `1: "${text(11)}"`, '']]);
  assert.deepEqual(claimRows(w).map((x) => x['Geo ID']).sort(), [gid(11), gid(12), gid(13)], 'each Geo ID once');
});

test('add: probe A, both creates land but no read-back can run: none is "confirmed", both "may have been added", and the pages are in the run record', async () => {
  const { w, geo, run, claim } = await setup();
  claim(11);
  claim(12);
  // after the pull, every read of a page fails (the read-back of a created row is a GET of that page)
  const failing = async (url, init) => {
    w.fake.failNext('GET', /^\/pages\/[^/?]+$/, 500, 100);
    return geo.fetchImpl(url, init);
  };
  const first = await run(`${gid(11)} ${gid(12)}`, { geoFetchImpl: failing });
  assert.equal(first.r.exit, 1, first.h.io.errs.join('\n'));
  assertReport(first.h, first.r);
  assert.equal(first.report.sentence, 'Add: none was confirmed and 2 may have been added, before it stopped.');
  assert.equal(first.report.next, 'Next: type /claim-tagger add again with the same links; the ones added are skipped.');
  assert.deepEqual(claimRows(w).map((x) => x['Geo ID']).sort(), [gid(11), gid(12)], 'both landed');
  const rec = runRecord(first.r).add;
  assert.deepEqual(rec.added, [], 'nothing is "added" that was not read back');
  assert.deepEqual(rec.written_unchecked.map((a) => [a.geo_id, a.page_id]), [[gid(11), w.row('claims', gid(11)).page_id], [gid(12), w.row('claims', gid(12)).page_id]]);
  assert.equal(rec.maybe_written, undefined);
  assert.equal(rec.not_written, undefined);
  // the same links: both are in Claims, and nothing is written twice
  const again = await run(`${gid(11)} ${gid(12)}`);
  assert.equal(again.r.exit, 2);
  assert.equal(again.report.sentence, `Add: nothing was added; both claims are already in Claims ("${text(11)}" and "${text(12)}").`);
  assert.equal(claimRows(w).length, 2);
});

test('add: probe B, the second of three creates answers 500 but lands: one was added, one may have been, one was never sent; the same links finish it', async () => {
  const { w, run, claim } = await setup();
  for (const n of [11, 12, 13]) claim(n);
  let creates = 0;
  const lying = async (url, init) => {
    const isCreate = String(init?.method).toUpperCase() === 'POST' && new URL(url).pathname.endsWith('/pages');
    const res = await w.fake.fetchImpl(url, init);
    if (isCreate && (creates += 1) === 2) return new Response(JSON.stringify({ object: 'error', status: 500, code: 'internal_server_error', message: 'boom' }), { status: 500, headers: { 'content-type': 'application/json' } });
    return res;
  };
  const first = await run(`${gid(11)} ${gid(12)} ${gid(13)}`, { fetchImpl: lying });
  assert.equal(first.r.exit, 1, first.h.io.errs.join('\n'));
  assertReport(first.h, first.r);
  assert.equal(first.report.sentence, 'Add: 1 of 3 claims was added and 1 more may have been, before it stopped.');
  assert.equal(first.report.next, 'Next: type /claim-tagger add again with the same links; the ones added are skipped.');
  assert.deepEqual(claimRows(w).map((x) => x['Geo ID']).sort(), [gid(11), gid(12)], 'the second landed although it answered an error');
  const rec = runRecord(first.r).add;
  assert.deepEqual(rec.added.map((a) => a.geo_id), [gid(11)]);
  assert.deepEqual(rec.maybe_written.map((a) => a.geo_id), [gid(12)]);
  assert.deepEqual(rec.not_written.map((a) => a.geo_id), [gid(13)]);
  const again = await run(`${gid(11)} ${gid(12)} ${gid(13)}`);
  assert.equal(again.r.exit, 0, again.h.io.errs.join('\n'));
  assert.equal(again.report.sentence, `Add: 1 claim added to Claims from Geo ("${text(13)}"); 2 were not added.`);
  assert.deepEqual(again.report.rows, [['Added', '1', ''], ['Already in Claims', `2: "${text(11)}" and "${text(12)}"`, '']]);
  assert.deepEqual(claimRows(w).map((x) => x['Geo ID']).sort(), [gid(11), gid(12), gid(13)], 'each Geo ID once');
});

test('add: when every create is refused for good (not an answer that may have landed) it "stopped before any claim was added"', async () => {
  const { w, run, claim } = await setup();
  claim(11);
  claim(12);
  w.fake.failNext('POST', /^\/pages$/, 400, 5, { code: 'validation_error', message: 'no' });
  const { r, h, report } = await run(`${gid(11)} ${gid(12)}`);
  assert.equal(r.exit, 1, h.io.errs.join('\n'));
  assertReport(h, r);
  assert.equal(report.sentence, 'Add: it stopped before any claim was added.');
  assert.equal(report.next, 'Next: type /claim-tagger add again with the same links in a while.');
  assert.equal(claimRows(w).length, 0);
  const rec = runRecord(r).add;
  assert.deepEqual(rec.not_written.map((a) => a.geo_id), [gid(11), gid(12)]);
  assert.equal(rec.maybe_written, undefined);
});

test('add: the check after the write cannot read Claims: exit 1, the claims are written and listed in the run record, and the sentence says so', async () => {
  const { w, run, claim } = await setup();
  claim(11);
  claim(12);
  let armed = false;
  const afterCreates = async (url, init) => {
    const res = await w.fake.fetchImpl(url, init);
    // once both rows are written, the next question to Claims fails every time
    if (!armed && String(init?.method).toUpperCase() === 'POST' && new URL(url).pathname.endsWith('/pages') && claimRows(w).length === 2) {
      armed = true;
      w.fake.failNext('POST', /\/query$/, 500, 40);
    }
    return res;
  };
  const { r, h, report } = await run(`${gid(11)} ${gid(12)}`, { fetchImpl: afterCreates });
  assert.ok(armed);
  assert.equal(r.exit, 1, h.io.errs.join('\n'));
  assertReport(h, r);
  assert.equal(report.sentence, 'Add: the claims were written, but Claims could not be read again to check that none is there twice.');
  assert.equal(report.next, 'Next: type /claim-tagger add again with the same links in a while.');
  assert.deepEqual(claimRows(w).map((x) => x['Geo ID']).sort(), [gid(11), gid(12)]);
  assert.deepEqual(runRecord(r).add.added.map((a) => a.geo_id), [gid(11), gid(12)], 'the run record lists the rows that were written');
  assert.equal(runRecord(r).status, 'stopped');
});

test('add: an item that is not a Geo link or ID is echoed only when it passes the hard refusals of the report lint, cut to 40 characters', async () => {
  const { w, run } = await setup();
  const cell = async (item) => {
    const { r, h, report } = await run(item);
    assert.equal(r.exit, 2, h.io.errs.join('\n'));
    assertReport(h, r);
    assert.equal(w.writes().length, 0);
    assert.equal(runRecord(r).add.not_added[0].item, item, 'the run record keeps what was typed');
    return report.rows.find((row) => row[0] === 'Not a Geo link or ID')[1];
  };
  assert.equal(await cell('{}'), '1: an item that is not a link', 'a brace');
  assert.equal(await cell('[true]'), '1: "[true]"', 'brackets are no braces');
  assert.equal(await cell('runs/20261028T095657Z-promote/card.json'), '1: an item that is not a link', 'a run folder and a run id');
  assert.equal(await cell('C:/x/.env'), '1: an item that is not a link', 'a drive path');
  assert.equal(await cell('script.mjs'), '1: an item that is not a link', 'a script file');
  assert.equal(await cell('nonsense'), '1: "nonsense"');
  assert.equal(await cell('a'.repeat(60)), `1: "${'a'.repeat(37)}..."`, 'cut at 40 characters');
  // the cut text is what is judged: a refusal that lies beyond the cut is not shown
  assert.equal(await cell(`${'b'.repeat(45)}{}`), `1: "${'b'.repeat(37)}..."`);
});

test('add: a bare Geo ID that Geo does not hold is named "ID ending ...", a link "link ending ..."', async () => {
  const { run, claim } = await setup();
  claim(42, { name: '', ownName: null }); // no name, asked for by a link
  claim(43, { name: '', ownName: null }); // no name, asked for by its ID
  const { r, h, report } = await run(`${gid(40)} ${linkOf(41)} ${linkOf(42)} ${gid(43)}`);
  assert.equal(r.exit, 2, h.io.errs.join('\n'));
  assertReport(h, r);
  assert.deepEqual(report.rows, [
    ['Not found in Geo', `2: ID ending ${gid(40).slice(-8)} and link ending ${gid(41).slice(-8)}`, ''],
    ['No name in Geo', `2: link ending ${gid(42).slice(-8)} and ID ending ${gid(43).slice(-8)}`, ''],
  ]);
});

test('add: a claim that is in Claims twice after the write (added from two places at the same moment) is told by the run that made it: exit 2, the claim named, both pages in the run record', async () => {
  const { w, run, claim } = await setup();
  claim(11);
  claim(12);
  // another editor's add creates claim 11 too, right after this run created it (after the last look at Claims, so the last look could not see it)
  let other = null;
  const second = async (url, init) => {
    const res = await w.fake.fetchImpl(url, init);
    if (other === null && res.ok && String(init?.method).toUpperCase() === 'POST' && new URL(url).pathname.endsWith('/pages')) {
      const made = await res.clone().json();
      if (made.properties['Geo ID'].rich_text.map((x) => x.plain_text).join('') === gid(11)) other = w.fake.addRow(w.DB.claims, { 'Geo Name': text(11), 'Geo ID': gid(11), 'Geo URL': linkOf(11), 'Geo Space': US });
    }
    return res;
  };
  const { r, h, report } = await run(`${gid(11)} ${gid(12)}`, { fetchImpl: second });
  assert.ok(other, 'the other editor added the claim');
  assert.equal(r.exit, 2, h.io.errs.join('\n'));
  assertReport(h, r);
  assert.equal(report.sentence, `Add: "${text(11)}" is in Claims twice now, because the same claim was added from two places at the same moment.`);
  assert.equal(report.rows, undefined);
  assert.equal(report.next, 'Next: ask the engineer to remove the row named in the run record (the two rows are identical); every command stops until then.');
  assert.deepEqual(claimRows(w).map((x) => x['Geo ID']).sort(), [gid(11), gid(11), gid(12)]);
  const twice = runRecord(r).add.in_claims_twice;
  assert.equal(twice.length, 1);
  assert.equal(twice[0].geo_id, gid(11));
  assert.equal(twice[0].page_ids.length, 2);
  assert.deepEqual(twice[0].remove, [other], 'the later-created row is the one to remove');
  assert.equal(twice[0].page_ids[1], other, 'the earlier row comes first, the later one second');
  // the row to remove is the one the pull treats as the extra one (the same order as the pull: created time, then page id)
  const pulled = await w.pull();
  assert.equal(pulled.duplicates.length, 1);
  assert.deepEqual(twice[0].page_ids, pulled.duplicates[0].page_ids);
  assert.deepEqual(twice[0].remove, pulled.duplicates[0].page_ids.slice(1));
  assert.ok(!JSON.stringify(report).includes(other) && !JSON.stringify(report).includes(twice[0].page_ids[0]), 'the page ids are in the run record only');
  // and the next command says it too (the shared pull stops on a key twice)
  const again = await run(`${gid(11)}`);
  assert.equal(again.r.exit, 2);
  assert.match(again.report.sentence, /two rows with the same key/);
});

test('add: when every claim is already in Claims the Next line depends on whether the agent has anything to read (no Agent status and not Reviewed)', async () => {
  const names = (...ns) => ns.map((n) => `"${text(n)}"`);
  // all read or decided: nothing new to read
  const read = await setup({ inClaims: [[1], [2], [3], [4]], claimRows: { [gid(1)]: { 'Agent status': 'Done' }, [gid(2)]: { 'Agent status': 'Done' }, [gid(3)]: { 'Review status': 'Reviewed' }, [gid(4)]: { 'Agent status': 'Could not read' } } });
  const a = await read.run(`${gid(1)} ${gid(2)}`);
  assert.equal(a.r.exit, 2);
  assertReport(a.h, a.r);
  assert.equal(a.report.sentence, `Add: nothing was added; both claims are already in Claims (${names(1, 2).join(' and ')}).`);
  assert.equal(a.report.next, `Next: nothing new to read; they are in All claims (${allClaims(read.w)}).`);
  const one = await read.run(gid(3));
  assert.equal(one.report.sentence, `Add: nothing was added; the claim is already in Claims ("${text(3)}").`);
  assert.equal(one.report.next, `Next: nothing new to read; it is in All claims (${allClaims(read.w)}).`);
  const four = await read.run([1, 2, 3, 4].map(gid).join(' '));
  assert.equal(four.report.sentence, `Add: nothing was added; all 4 claims are already in Claims (${names(1, 2, 3).join(', ')} and more).`);
  assert.deepEqual(four.report.rows, [['Already in Claims', `4: ${names(1, 2, 3).join(', ')} and 1 more`, '']]);
  assert.equal(four.report.next, `Next: nothing new to read; they are in All claims (${allClaims(read.w)}).`);
  const three = await read.run([1, 2, 3].map(gid).join(' '));
  assert.equal(three.report.sentence, `Add: nothing was added; all 3 claims are already in Claims (${names(1, 2).join(', ')} and ${names(3)[0]}).`);
  // one of them has not been read: tag has something to read
  const mixed = await setup({ inClaims: [[1], [2]], claimRows: { [gid(1)]: { 'Agent status': 'Done' } } });
  const b = await mixed.run(`${gid(1)} ${gid(2)}`);
  assert.equal(b.report.next, 'Next: type /claim-tagger tag to read them.');
  // a claim another editor added a moment ago has not been read either
  const fresh = await setup({ inClaims: [[1]], claimRows: { [gid(1)]: { 'Agent status': 'Done' } } });
  fresh.claim(11);
  const meanwhile = async (url, init) => {
    if (!fresh.w.rows('claims').some((x) => x['Geo ID'] === gid(11))) fresh.w.fake.addRow(fresh.w.DB.claims, { 'Geo Name': text(11), 'Geo ID': gid(11), 'Geo URL': linkOf(11), 'Geo Space': US });
    return fresh.geo.fetchImpl(url, init);
  };
  const c = await fresh.run(`${gid(1)} ${gid(11)}`, { geoFetchImpl: meanwhile });
  assert.equal(c.r.exit, 2);
  assert.equal(c.report.next, 'Next: type /claim-tagger tag to read them.');
});

test('add: when Claims has no Geo Space option for the space of a claim, nothing is written, no option is made and the engineer is told (exit 2)', async () => {
  const withoutAi = { ...CLAIMS_SPEC, 'Geo Space': { type: 'select', options: [US, WORLD, HEALTH, CRYPTO, TECH] } };
  const { w, run, claim } = await setup({ tableSpecs: { claims: withoutAi } });
  claim(11);
  claim(12, { spaces: [SPACE[AI]] });
  const optionsBefore = w.fake.createdOptions.length;
  const { r, h, report } = await run(`${gid(11)} ${gid(12)}`);
  assert.equal(r.exit, 2, h.io.errs.join('\n'));
  assertReport(h, r);
  assert.equal(report.sentence, 'Add: nothing was added, because the Claims table does not have the space of a claim as an option.');
  assert.equal(report.next, 'Next: ask the engineer to look at the message the script printed.');
  assert.match(h.io.errs.join('\n'), /Geo Space column of Claims has no option for: AI/);
  assert.equal(w.writes().length, 0, 'not even the claim in a space that has its option was written');
  assert.equal(claimRows(w).length, 0);
  assert.equal(w.fake.createdOptions.length, optionsBefore, 'no option was made');
});

// ---- the plan check --------------------------------------------------------------------------------------------------------------------

const planOver = (script, config = builtConfig()) => ({ config, plan: newPlan({ runId: 'r1', script, rubricEdition: '2026-10-16.1', config }) });
const geoProps = (n) => ({ 'Geo Name': text(n), 'Geo ID': gid(n), 'Geo URL': linkOf(n), 'Geo Space': US, 'Geo Created': '2026-09-14', 'Geo Sources': '', 'Geo Is factual': true, 'Geo Tags': ['Debate'], 'Geo Topics': '' });

test('checkPlan: a plan of the add script may create claims rows with the key and the nine Geo columns, and nothing else', () => {
  const { config, plan } = planOver(ADD_SCRIPT);
  plan.create('claims', gid(1), geoProps(1));
  plan.create('claims', gid(2), { 'Geo Name': text(2) });
  const ok = checkPlan(plan, config);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.counts, { creates: 2, updates: 0 });
  assert.deepEqual([...addableProperties(config)].sort(), [...CLAIMS_GEO_COLUMNS].sort(), 'the key (Geo ID) is one of the nine');

  const refuse = (build, pattern) => {
    const p = planOver(ADD_SCRIPT);
    build(p.plan, p.config);
    const checked = checkPlan(p.plan, p.config);
    assert.equal(checked.ok, false);
    assert.match(checked.problems.join('\n'), pattern);
  };
  // an agent column, each of the eight, and each of the editor's three
  for (const column of ['Agent tags', 'Agent confidence', 'Agent reasons', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks', 'Agent reading']) {
    refuse((pl) => pl.create('claims', gid(3), { ...geoProps(3), [column]: column === 'Agent confidence' ? 0.5 : 'x' }), new RegExp(`"${column}" is not a column this plan may write to claims`));
  }
  for (const column of ['Verified tags', 'Review status', 'Challenged tags notes']) {
    refuse((pl) => pl.create('claims', gid(3), { ...geoProps(3), [column]: column === 'Verified tags' ? [] : 'Reviewed' }), /only an editor writes/);
  }
  // an update of anything, a Geo column included
  refuse((pl) => pl.update('claims', gid(4), 'p'.repeat(32), { 'Geo Name': 'changed' }), /may only create rows of the claims table/);
  refuse((pl) => pl.update('claims', gid(4), 'p'.repeat(32), { 'Agent status': 'Done' }), /may only create rows of the claims table/);
  // another table, create or update
  refuse((pl) => pl.create('tag_decisions', `${gid(5)}::Context-dependent`, { Claim: 'x', Key: `${gid(5)}::Context-dependent`, Tag: 'Context-dependent' }), /may only create rows of the claims table/);
  refuse((pl) => pl.update('rulebook', 'Context-dependent', 'p'.repeat(32), { 'When to use': 'x' }), /may only create rows of the claims table/);
  refuse((pl) => pl.update('agent_settings', 'Claim tagger', 'p'.repeat(32), { 'Last run summary': 'x' }), /may only create rows of the claims table/);
  // a column that is not a Geo column of the table
  refuse((pl) => pl.create('claims', gid(6), { ...geoProps(6), 'Something else': 'x' }), /"Something else" is not a column this plan may write to claims/);
});

test('checkPlan: no other script may create a claims row, and the add allowance does not open the practice page\'s editor columns', () => {
  for (const script of ['propose', 'followup', 'distill', 'promote', 'rollback', 'restore', 'decide', 'adder', 'ADD', 'add ']) {
    const { config, plan } = planOver(script);
    plan.create('claims', gid(1), geoProps(1));
    const checked = checkPlan(plan, config);
    assert.equal(checked.ok, false, script);
    assert.match(checked.problems.join('\n'), /created only by setup or by the add script/, script);
    // not even a plan that only updates a Geo column is allowed for them
    const upd = planOver(script);
    upd.plan.update('claims', gid(1), 'p'.repeat(32), { 'Geo Name': 'x' });
    assert.equal(checkPlan(upd.plan, upd.config).ok, false, `${script} may not update a Geo column`);
  }
  // setup still creates claims rows its own way (the one-time path is unchanged)
  const setupPlan = planOver('setup.mjs');
  setupPlan.plan.create('claims', gid(1), geoProps(1));
  assert.deepEqual(checkPlan(setupPlan.plan, setupPlan.config, { setup: true }).problems, []);
  // a demo profile with its setup open: the add script still writes no editor column
  const demoConfig = builtConfig();
  demoConfig.demo = true;
  demoConfig.demo_id = 'practice-1';
  const demoRoot = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-add-plan-'));
  try {
    mkdirSync(join(demoRoot, 'runs'), { recursive: true });
    writeFileSync(join(demoRoot, 'runs', 'SETUP'), '{}\n');
    const { plan } = planOver(ADD_SCRIPT, demoConfig);
    plan.create('claims', gid(1), { ...geoProps(1), 'Review status': 'Reviewed' });
    // the marker of a practice page's build is open: another plan may create a row with an editor column under it, the add plan may not
    const other = planOver('walkthrough', demoConfig);
    other.plan.create('claims', gid(1), { 'Review status': 'Reviewed' });
    assert.ok(checkPlan(other.plan, demoConfig, { root: demoRoot, setup: true }).problems.every((p) => !/only an editor writes/.test(p)), 'the marker lets a practice page build create editor columns');
    const checked = checkPlan(plan, demoConfig, { root: demoRoot });
    assert.equal(checked.ok, false);
    assert.match(checked.problems.join('\n'), /"Review status" is a column only an editor writes/);
  } finally {
    rmSync(demoRoot, { recursive: true, force: true });
  }
});

test('checkPlan: a plan of the add script writes no page content, and the setup flag opens nothing more to it', () => {
  const block = { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'x' } }] } };
  const withContent = planOver(ADD_SCRIPT);
  withContent.plan.create('claims', gid(1), geoProps(1), { children: [block] });
  const content = checkPlan(withContent.plan, withContent.config);
  assert.equal(content.ok, false);
  assert.match(content.problems.join('\n'), /writes no page content \(children\)/);
  // the same row without content is fine, with and without the setup flag
  for (const setup of [false, true]) {
    const ok = planOver(ADD_SCRIPT);
    ok.plan.create('claims', gid(1), geoProps(1));
    assert.deepEqual(checkPlan(ok.plan, ok.config, { setup }).problems, [], `setup ${setup}`);
  }
  // with setup: true a setup plan may fill more columns of a new row, a plan of the add script may not: the flag does not widen it
  const refuse = (build, pattern) => {
    const p = planOver(ADD_SCRIPT);
    build(p.plan);
    const checked = checkPlan(p.plan, p.config, { setup: true });
    assert.equal(checked.ok, false);
    assert.match(checked.problems.join('\n'), pattern);
  };
  for (const column of ['Agent tags', 'Agent confidence', 'Agent reasons', 'Agent status', 'Tags waiting', 'Agent edition', 'Agent remarks', 'Agent reading']) {
    refuse((pl) => pl.create('claims', gid(2), { ...geoProps(2), [column]: column === 'Agent confidence' ? 0.5 : 'x' }), new RegExp(`"${column}" is not a column this plan may write to claims`));
  }
  refuse((pl) => pl.create('claims', gid(2), { ...geoProps(2), 'Verified tags': [] }), /"Verified tags" is a column only an editor writes/);
  // the audit seed (setup's one exception for the editor's columns) is not available to it either
  refuse((pl) => pl.create('claims', gid(2), { ...geoProps(2), 'Review status': 'Reviewed', 'Challenged tags notes': `${AUDIT_PREFIX}: the claim is fine.` }), /"Review status" is a column only an editor writes/);
  refuse((pl) => pl.update('claims', gid(2), 'p'.repeat(32), { 'Geo Name': 'changed' }), /may only create rows of the claims table/);
  refuse((pl) => pl.create('rulebook', 'New tag', { Name: 'New tag', 'When to use': 'x', Category: 'Quality' }), /may only create rows of the claims table/);
  refuse((pl) => pl.create('agent_settings', 'Claim tagger', { Name: 'Claim tagger', 'Rulebook edition': 'x' }), /may only create rows of the claims table/);
});

test('applyStep: a plan of the add script is applied only by the run of the add script', async () => {
  const w = await makeWorld({ claims: [] });
  const writesBefore = w.writes().length;
  let seen = null;
  const r = await withRun({ script: 'propose', label: 'Tag', opts: w.hooks() }, async (ctx) => {
    const plan = newPlan({ runId: ctx.runId, script: ADD_SCRIPT, rubricEdition: '2026-10-16.1', config: ctx.config });
    plan.create('claims', gid(1), geoProps(1));
    // a plan that checkPlan accepts, from a run that is not add: still refused, before the plan is even written
    assert.deepEqual(checkPlan(plan, ctx.config, { root: ctx.root }).problems, []);
    try {
      await applyStep(ctx, plan);
    } catch (e) {
      seen = e;
    }
    return { exit: 0, sentence: 'Tag: nothing was done.', next: 'Next: type /claim-tagger status.' };
  });
  assert.equal(r.exit, 0);
  assert.ok(seen instanceof LoopExit, 'applyStep refused');
  assert.equal(seen.code, 2);
  assert.match(seen.message, /plan of the add script was handed to the propose script and nothing was sent/);
  assert.equal(existsSync(join(r.runDir, 'plan.jsonl')), false, 'the plan was not written');
  assert.equal(w.writes().length, writesBefore, 'nothing was sent');
});

test('applyPlan repeats the check: a plan of the add script with an update, an agent column or another table is never sent', async () => {
  const w = await makeWorld({ claims: [{ id: gid(1), text: text(1) }] });
  const bad = (build) => {
    const plan = newPlan({ runId: 'r1', script: ADD_SCRIPT, rubricEdition: '2026-10-16.1', config: w.config });
    build(plan);
    return plan;
  };
  const before = w.requests().length;
  const schemas = { claims: w.fake.database(w.DB.claims), tag_decisions: w.fake.database(w.DB.tag_decisions) };
  const sent = [];
  const client = { createPage: async () => sent.push('createPage'), updatePage: async () => sent.push('updatePage'), retrievePage: async () => sent.push('retrievePage') };
  for (const [build, why] of [
    [(pl) => pl.update('claims', gid(1), w.ids.claim[gid(1)], { 'Geo Name': 'changed' }), /may only create rows of the claims table/],
    [(pl) => pl.create('claims', gid(7), { ...geoProps(7), 'Agent status': 'Done' }), /"Agent status" is not a column this plan may write to claims/],
    [(pl) => pl.create('tag_decisions', `${gid(7)}::Context-dependent`, { Claim: 'x', Key: `${gid(7)}::Context-dependent`, Tag: 'Context-dependent' }), /may only create rows of the claims table/],
  ]) {
    assert.ok(w.ids.claim[gid(1)], 'the update names a page that exists');
    await assert.rejects(
      applyPlan({ plan: bad(build), dir: w.root, client, config: w.config, schemas, pulled: {} }),
      (e) => e instanceof PlanError && /the plan was refused and nothing was sent/.test(e.message) && e.problems.some((p) => why.test(p)),
    );
  }
  assert.deepEqual(sent, [], 'nothing reached the client');
  assert.equal(w.requests().length, before);
});

// ---- afterwards ----------------------------------------------------------------------------------------------------------------------

test('after add: status counts the new claims as not read yet, and tag judges only them', async () => {
  const { w, run, claim } = await setup({ inClaims: [[1], [2], [3]] });
  w.setEnv('FAKE_LOOP_DEFAULT', JSON.stringify({ decision: 'do_not_apply', p: 0.1 }));
  const j1 = await w.judge();
  assert.equal(j1.exit, 0);
  const { propose } = await import('../../agents/claim-tagger-mvp/scripts/propose.mjs');
  assert.equal((await propose(w.hooks())).exit, 0);
  const idle = await status(w.hooks());
  assert.equal(idle.report.rows[1][1], 'nothing waits');

  claim(11);
  claim(12);
  assert.equal((await run(`${gid(11)} ${gid(12)}`)).r.exit, 0);
  const h = w.hooks();
  const s = await status(h);
  assert.equal(s.report.sentence, 'Status: nothing is paused; the agent has 2 new claims to read.');
  assert.equal(s.report.rows[1][1], 'nothing waits; 2 new claims not read yet');
  assert.equal(s.report.next, 'Next: type /claim-tagger tag to read 2 new claims.');

  const callsBefore = w.calls().length;
  const j2 = await w.judge();
  assert.equal(j2.exit, 0);
  const asked = w.calls().slice(callsBefore).flatMap((c) => c.ids ?? []);
  assert.deepEqual(asked.sort(), [gid(11), gid(12)], 'the three claims already read came from the store; only the two new ones were asked');
  assert.equal((await propose(w.hooks())).exit, 0);
  assert.equal(w.claim(gid(11))['Agent status'], 'Done');
  assert.equal(w.claim(gid(1))['Agent status'], 'Done');
});

test('geoRowOf is the one builder: the nine Geo columns in the order of the pick file; a stub gives only what the fallbacks hold', async () => {
  const { geo, claim } = await setup();
  claim(11, { tags: ['Politics'], isFactual: false, sources: [{ id: hexId(5, 'e'), name: 'A', url: 'https://example.com/a' }, { id: hexId(6, 'e'), name: 'B', url: null }], topics: ['Elections'] });
  const { createGeoClient } = await import('../../agents/claim-tagger-mvp/scripts/lib/geo-read.mjs');
  const client = createGeoClient({ geo: GEO, fetchImpl: geo.fetchImpl, sleep: async () => {} });
  const entity = (await client.details([gid(11)])).get(gid(11));
  const space = { name: US, id: SPACE[US] };
  const { row, stub, created } = geoRowOf({ entity, id: gid(11), space, geo: GEO });
  assert.deepEqual(Object.keys(row), ['Geo Name', 'Geo ID', 'Geo URL', 'Geo Space', 'Geo Created', 'Geo Sources', 'source_pieces', 'Geo Is factual', 'Geo Tags', 'Geo Topics']);
  assert.equal(stub, false);
  assert.equal(created, 1789387200);
  assert.deepEqual(row['Geo Tags'], ['Debate', 'Politics']);
  assert.equal(row['Geo Sources'], 'A\nB');
  assert.equal(row['Geo Is factual'], false);
  assert.equal(row.source_pieces[1].url, `${BROWSER}/space/${SPACE[US]}/${hexId(6, 'e')}`, 'a source without a Web URL is linked to its Geo page');
  const stubbed = geoRowOf({ entity: null, id: gid(99), fallbackName: 'Listed name', fallbackCreated: 1789387200, space, geo: GEO });
  assert.equal(stubbed.stub, true);
  assert.deepEqual([stubbed.row['Geo Name'], stubbed.row['Geo Created'], stubbed.row['Geo Tags'], stubbed.row['Geo Is factual'], stubbed.row.source_pieces], ['Listed name', '2026-09-14', [], null, []]);
});

test('the places that name the script: the allow list of the project settings, the skill, the contract and hard rule 10', () => {
  const root = new URL('../../', import.meta.url);
  const settings = JSON.parse(readFileSync(new URL('.claude/settings.json', root), 'utf8'));
  const rule = 'Bash(node agents/claim-tagger-mvp/scripts/add.mjs:*)';
  assert.ok(settings.permissions.allow.includes(rule), 'no permission prompt (P35)');
  assert.ok(!settings.permissions.ask.includes(rule) && !settings.permissions.deny.includes(rule));
  const claudeMd = readFileSync(new URL('CLAUDE.md', root), 'utf8');
  assert.match(claudeMd, /and `add\.mjs` creates new rows of the claims table with the Geo columns only, from claims read from Geo \(P35\)\./);
  // the words the editor and the skill share
  const skill = readFileSync(new URL('.claude/skills/claim-tagger/SKILL.md', root), 'utf8');
  const handover = readFileSync(new URL('docs/mvp-2026-11/EDITOR-HANDOVER.md', root), 'utf8');
  const practice = 'Add: nothing was done, because adding claims works only on the real Claims table; the practice page has its own claims.';
  assert.equal(skill.split(practice).length - 1, 2, 'the one wording of the practice page, in the Adding claims section and in Demo mode');
  assert.match(skill, /a Geo ID is 32 characters: digits and the letters a to f/);
  assert.match(skill, /whether Geo marks it factual/);
  assert.match(skill, /relay the report and stop; the editor types the command again with the same links/);
  assert.match(skill, /markdown link/);
  assert.match(handover, /32 characters, digits and the letters a to f/);
  assert.match(handover, /whether Geo marks it factual/);
  assert.match(handover, /it need not be tagged Debate in Geo/);
  assert.match(handover, /Nothing on the row shows it was added by hand/);
  assert.doesNotMatch(handover, /P1 to P25/);
  assert.doesNotMatch(skill, /the Geo claims of the pick/);
  const contracts = readFileSync(new URL('docs/mvp-2026-11/CONTRACTS.md', root), 'utf8').slice(readFileSync(new URL('docs/mvp-2026-11/CONTRACTS.md', root), 'utf8').indexOf('## 20. The add step'));
  assert.doesNotMatch(contracts, /never make a repeated key|no Geo ID is ever in Claims twice/);
  assert.match(contracts, /Known limit of the same-text check/);
});

test('add: a stop in the shared harness (the pull cannot read Notion) also says to give the same links again', async () => {
  const { w, geo, run, claim } = await setup();
  claim(11);
  w.fake.failNext('POST', /\/query$/, 500, 40);
  const { r, h, report } = await run(gid(11));
  assert.equal(r.exit, 1, h.io.errs.join('\n'));
  assertReport(h, r);
  assert.equal(report.sentence, 'Add: nothing was done, because Notion could not be read.');
  assert.equal(report.next, 'Next: type /claim-tagger add again with the same links in a while.');
  assert.equal(geo.requests.length, 0);
  assert.equal(w.writes().length, 0);
});

test('source scan: add.mjs reaches Geo through the client only, sends no write to Geo and reads no secret', () => {
  const source = readFileSync(new URL('../../agents/claim-tagger-mvp/scripts/add.mjs', import.meta.url), 'utf8');
  assert.equal(/\bfetch\(/.test(source), false, 'no direct fetch');
  assert.match(source, /createGeoClient\(/);
  assert.equal(/mutation|subscription|authorization/i.test(source), false);
  assert.equal(/\.env\b|NOTION_|process\.env/.test(source), false);
  assert.equal(/createPage\(|updatePage\(|\.send\(/.test(source), false, 'writes only through a plan');
  assert.match(source, /ADD_SCRIPT/);
  const row = readFileSync(new URL('../../agents/claim-tagger-mvp/scripts/lib/geo-row.mjs', import.meta.url), 'utf8');
  assert.equal(/\bfetch\(|notion/i.test(row), false, 'the row builder is pure');
});

test('the nine Geo columns the allowance names are the ones the pick writes', () => {
  assert.deepEqual([...CLAIMS_GEO_COLUMNS], ['Geo Name', 'Geo ID', 'Geo URL', 'Geo Space', 'Geo Created', 'Geo Sources', 'Geo Is factual', 'Geo Tags', 'Geo Topics']);
  assert.equal(claimText(1).length > 0, true);
});
