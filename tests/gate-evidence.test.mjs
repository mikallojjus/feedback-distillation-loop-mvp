// EN-1: a Rulebook write is believed only when files on disk prove it, whatever the plan header says. Fixtures here lay out a promote the way
// promote.mjs leaves it (candidate rubric, PASS card, PROMOTING.json, a plan under ctx promote/PASS) in a fake world, then break one piece at a time.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE_REFUSAL, FRESH_MS, apply, main as applyMain } from '../agents/claim-tagger/scripts/apply.mjs';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { RULE_PROPS, checkGateEvidence, evidenceNeeded, gateClaims, ruleVersionOf } from '../agents/claim-tagger/scripts/lib/gate-evidence.mjs';
import { fileSha256 } from '../agents/claim-tagger/scripts/lib/hash.mjs';
import { readJsonl, writeJsonAtomic } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { NotionError } from '../agents/claim-tagger/scripts/lib/notion-rest.mjs';
import { applyLesson, composeWhenToUse, rehash } from '../agents/claim-tagger/scripts/lib/rubric-build.mjs';
import { validate } from '../agents/claim-tagger/scripts/lib/validate.mjs';
import { armedState, check, main as planMain, openPlan, readPlan, resolveOps } from '../agents/claim-tagger/scripts/plan.mjs';
import { loadPull } from '../agents/claim-tagger/scripts/pull.mjs';
import { AGENT } from './fixtures/notion/fake-notion.mjs';
import { captureIo, cleanupRoots, makeWorld } from './fixtures/notion/helpers.mjs';

after(cleanupRoots);

const RUN = 'gate-1';
const LESSON = 'Hedged trajectories are not forecasts'; // the Approved lesson of the standard fake world (tag Predictive)
const NEW_RULE = 'Fires on a flat future marker only; a hedged tendency does not fire it.';
const VERSION = '2099-01-01.1';
const cardSchema = JSON.parse(readFileSync(join(AGENT, 'schemas', 'card.schema.json'), 'utf8'));

const runsFile = (w, ...parts) => join(w.root, 'runs', ...parts);
const liveOf = (w) => JSON.parse(readFileSync(join(w.root, 'rubric', 'rubric.json'), 'utf8'));
const readOps = (w, id = RUN) => readJsonl(runsFile(w, id, 'plan.jsonl')).rows;
const putOps = (w, rows, id = RUN) => writeFileSync(runsFile(w, id, 'plan.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
const opOf = (rows, database) => rows.find((r) => r.database === database);
const tagOf = (rubric, name) => rubric.tags.find((t) => t.name === name);
/** The text of a tag in the live rubric of the world, as the Rulebook row carries it. */
const lockedText = (w, name = 'Predictive') => composeWhenToUse(tagOf(liveOf(w), name).when_to_use);
const joined = (result) => result.problems.join(' | ');

/** rubric.lock for the rubric.json in the world's root, the way promote.mjs writes it. Returns the rubric. */
function lock(w) {
  const file = join(w.root, 'rubric', 'rubric.json');
  const rubric = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(join(w.root, 'rubric', 'rubric.lock'), `${JSON.stringify({ rubric_version: rubric.rubric_version, rubric_hash: rubric.rubric_hash, scope_hash: rubric.scope_hash, file_sha256: fileSha256(file), locked_at: '2026-10-13T12:00:00.000Z' }, null, 2)}\n`);
  return rubric;
}

/** The standard fake world with a locked live rubric, pulled as p1 (the lesson is Approved there). */
async function world() {
  const w = makeWorld();
  lock(w);
  await w.pull('p1');
  return w;
}

/**
 * Lay out a promote of the Approved lesson the way promote.mjs leaves it: runs/<RUN>/candidate/rubric.json, a PASS gate card, runs/PROMOTING.json and
 * a plan under ctx promote/PASS (Rulebook row, lesson Live, Rubric in force). `o` breaks one piece: omit ['promoting' | 'card' | 'candidate'],
 * promoting(p), card(c), candidate(c) (get a copy to change), ops(rows) (the plan's lines after they were written), ctx.
 */
function lay(w, o = {}) {
  const live = liveOf(w);
  const runDir = runsFile(w, RUN);
  rmSync(runDir, { recursive: true, force: true });
  rmSync(runsFile(w, 'PROMOTING.json'), { force: true });
  mkdirSync(join(runDir, 'candidate'), { recursive: true });
  const candidate = applyLesson(live, { tag: 'Predictive', ruleN: 1, newText: NEW_RULE, kind: 'Change the rule', lesson_id: 'LS-1', note: `Predictive rule 1 replaced by lesson LS-1 "${LESSON}"` }, { version: VERSION });
  candidate.changelog.at(-1).lesson_key = LESSON;
  const card = {
    card_id: RUN, kind: 'gate', lesson: LESSON, target: 'Predictive', verdict: 'PASS', small_sample: true, smoke: false,
    configs: {
      baseline: { config16: 'aaaaaaaaaaaaaaaa', rubric_version: live.rubric_version, rubric_hash: live.rubric_hash, scope_hash: live.scope_hash },
      candidate: { config16: 'bbbbbbbbbbbbbbbb', rubric_version: candidate.rubric_version, rubric_hash: candidate.rubric_hash, scope_hash: candidate.scope_hash },
    },
    conditions: [1, 2, 3, 4, 5].map((n) => ({ n, status: 'pass', detail: 'ok' })), per_tag: [], stats: { runs: 3 },
  };
  assert.deepEqual(validate(cardSchema, card).errors, [], 'the fixture card is a valid card');
  const promoting = {
    run_id: RUN, lesson: LESSON, lesson_id: 'LS-1', tag: 'Predictive', version: candidate.rubric_version, previous_version: live.rubric_version,
    started_at: '2026-10-13T12:00:00.000Z', plan: join(runDir, 'plan.jsonl'), candidate: join(runDir, 'candidate', 'rubric.json'),
  };
  const omit = o.omit ?? [];
  if (!omit.includes('candidate')) writeJsonAtomic(join(runDir, 'candidate', 'rubric.json'), o.candidate ? o.candidate(structuredClone(candidate)) : candidate);
  if (!omit.includes('card')) writeJsonAtomic(join(runDir, 'card.json'), o.card ? o.card(structuredClone(card)) : card);
  if (!omit.includes('promoting')) writeJsonAtomic(runsFile(w, 'PROMOTING.json'), o.promoting ? o.promoting(structuredClone(promoting)) : promoting);

  const plan = openPlan({ runId: RUN, root: w.root, ctx: o.ctx ?? { promote: true, gate: 'PASS' }, sourcePull: 'p1', now: w.clock.now });
  const tag = candidate.tags.find((t) => t.name === 'Predictive');
  plan.update('rulebook', 'Predictive', null, {
    'When to use': composeWhenToUse(tag.when_to_use), 'Rule version': candidate.rubric_version, 'Tag hash': tag.tag_hash, 'Changed by': [{ rule_changes: LESSON }],
  }, { expect: { 'When to use': composeWhenToUse(live.tags.find((t) => t.name === 'Predictive').when_to_use) }, note: 'gate PASS: Predictive rule 1' });
  plan.update('rule_changes', LESSON, null, { Status: 'Live', 'Rubric version': candidate.rubric_version, 'Gate result': 'PASS (small sample)' }, { expect: { Status: 'Approved' }, note: 'gate PASS: the lesson goes live' });
  plan.update('agent_settings', 'claim-tagger', null, { 'Rubric in force': candidate.rubric_version, 'Last run at': '2026-10-13T12:00:00.000Z' });
  plan.write();
  if (o.ops) putOps(w, o.ops(readOps(w)));
  return { live, candidate, card, promoting, tag };
}

/** checkGateEvidence over the plan of RUN and a pull on disk. */
const evidenceOf = (w, { pull = 'p1', id = RUN } = {}) => checkGateEvidence({ root: w.root, plan: readPlan(w.root, id), pull: loadPull(w.root, pull), config: w.config });

/** What an attacker with a file editor can do: write runs/APPLYING.json for a plan without ever running `plan.mjs check`. */
const armByHand = (w, id = RUN) => writeJsonAtomic(runsFile(w, 'APPLYING.json'), { run_id: id, plan_sha: readPlan(w.root, id).sha, armed_at: '2026-10-13T12:00:00.000Z' });

async function applyRun(w, args = ['--run', RUN], extra = {}) {
  const cap = captureIo();
  const code = await applyMain(args, cap.io, w.env(extra));
  return { code, out: cap.out, err: cap.err };
}

// ---- the reviewer's forgery ----------------------------------------------------------------------------------------------------------------

test('EN-1: a PASS-less plan whose header is changed to ctx promote/PASS is refused by check, by the command line and by apply, even armed by hand', async () => {
  const w = await world();
  // a plan nobody forged: an ordinary claims update, built by the real builder
  const p = openPlan({ runId: 'forged-1', root: w.root, now: w.clock.now });
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.write();
  assert.equal(evidenceNeeded(readPlan(w.root, 'forged-1')), false);
  // the forgery: copy it, set the header's ctx and add a Rulebook text op
  const rows = readOps(w, 'forged-1');
  rows[0].ctx = { seed: false, promote: true, gate: 'PASS' };
  rows.push({ op: 'update', seq: 2, database: 'rulebook', key: 'Predictive', page_id: w.ids.rulebook.Predictive, properties: { 'When to use': '1. Anything an attacker likes.' }, expect: null, guard: null, content_md: null, note: 'forged' });
  putOps(w, rows, 'forged-1');
  const plan = readPlan(w.root, 'forged-1');
  // this is the hole: the allowlist, which believes the header, finds nothing to refuse
  assert.deepEqual(resolveOps(plan, loadPull(w.root, 'p1'), { config: w.config }).violations, []);

  const result = check({ root: w.root, runId: 'forged-1', now: w.clock.now });
  assert.equal(result.code, EXIT.INVALID);
  assert.match(result.problems[0], /^gate evidence: runs\/PROMOTING\.json does not exist/);
  assert.equal(armedState(w.root), null, 'nothing is armed');
  assert.equal(existsSync(runsFile(w, 'forged-1', 'check.json')), false);
  assert.equal(existsSync(runsFile(w, 'forged-1', 'batches')), false, 'no batch files for the connector either');

  const cap = captureIo();
  assert.equal(planMain(['check', '--run', 'forged-1'], cap.io, { root: w.root, now: w.clock.now }), EXIT.INVALID);
  assert.ok(cap.err.some((l) => l.startsWith('plan: gate evidence: runs/PROMOTING.json does not exist')), cap.err.join('\n'));
  assert.deepEqual(cap.out, []);

  // an attacker skips check and writes the arming file himself; the plan is still refused, before a single request
  armByHand(w, 'forged-1');
  const before = w.fake.requests.length;
  for (const args of [['--run', 'forged-1'], ['--run', 'forged-1', '--retry'], ['--run', 'forged-1', '--dry-run']]) {
    const r = await applyRun(w, args);
    assert.equal(r.code, EXIT.INVALID, args.join(' '));
    assert.equal(r.err[0], `apply: ${EVIDENCE_REFUSAL}`, args.join(' '));
    assert.match(r.err[1], /^apply: gate evidence: runs\/PROMOTING\.json does not exist/);
    assert.deepEqual(r.out, []);
  }
  const noToken = await applyRun(w, ['--run', 'forged-1'], { client: null });
  assert.equal(noToken.code, EXIT.INVALID);
  assert.equal(noToken.err[0], `apply: ${EVIDENCE_REFUSAL}`, 'the no-token path does not hand a forged plan over as batch files either');
  assert.equal(existsSync(runsFile(w, 'forged-1', 'batches')), false);
  assert.equal(w.fake.requests.length, before, 'the fake client saw no call at all');
  assert.deepEqual(w.fake.writes(), []);
  assert.equal(existsSync(runsFile(w, 'forged-1', 'applied.jsonl')), false);
  assert.equal(existsSync(runsFile(w, 'forged-1', 'apply.json')), false);
  assert.equal(w.fake.find('rulebook', 'Predictive').props['When to use'], lockedText(w), 'the rule text in Notion is untouched');
});

test('a Rulebook text op under a header that claims nothing is refused by the allowlist first; the evidence module says so on its own too', async () => {
  const w = await world();
  const p = openPlan({ runId: 'bare-1', root: w.root, now: w.clock.now });
  p.update('claims', 'g1', null, { Readiness: 'Ready' });
  p.write();
  const rows = readOps(w, 'bare-1');
  rows.push({ op: 'update', seq: 2, database: 'rulebook', key: 'Predictive', page_id: w.ids.rulebook.Predictive, properties: { 'When to use': '1. Text.' }, expect: null, guard: null, content_md: null, note: null });
  putOps(w, rows, 'bare-1');
  const result = check({ root: w.root, runId: 'bare-1', now: w.clock.now });
  assert.equal(result.code, EXIT.INVALID);
  assert.match(result.problems[0], /allowlist: rulebook\.When to use refused/, 'the allowlist is the first filter');
  const direct = evidenceOf(w, { id: 'bare-1' });
  assert.equal(direct.ok, false);
  assert.match(joined(direct), /rulebook "Predictive": writes When to use, but the plan header claims no gate PASS, no restore and no seed/);
  assert.match(joined(direct), /runs\/PROMOTING\.json does not exist/);
});

// ---- a consistent promote passes -----------------------------------------------------------------------------------------------------------

test('a consistent promote (PROMOTING.json, PASS card, candidate rubric, matching ops) passes the evidence, check arms it and apply replaces the rule', async () => {
  const w = await world();
  const { candidate, tag } = lay(w);
  const gate = evidenceOf(w);
  assert.equal(gate.ok, true, joined(gate));
  assert.deepEqual(gate.problems, []);
  assert.deepEqual(gate.evidence.modes, ['promote']);
  assert.deepEqual(
    { run_id: gate.evidence.run_id, lesson: gate.evidence.lesson, card_id: gate.evidence.card_id, candidate_version: gate.evidence.candidate_version, candidate_hash: gate.evidence.candidate_hash, tags: gate.evidence.tags },
    { run_id: RUN, lesson: LESSON, card_id: RUN, candidate_version: VERSION, candidate_hash: candidate.rubric_hash, tags: ['Predictive'] },
  );
  assert.equal(gate.evidence.baseline_hash, liveOf(w).rubric_hash);

  const checked = check({ root: w.root, runId: RUN, now: w.clock.now });
  assert.equal(checked.code, EXIT.OK, (checked.problems ?? []).join('; '));
  assert.deepEqual(JSON.parse(readFileSync(runsFile(w, RUN, 'check.json'), 'utf8')).gate_evidence.modes, ['promote'], 'check.json records what was proven');

  const result = await applyRun(w);
  assert.equal(result.code, EXIT.OK, result.err.join('\n'));
  assert.match(result.out[0], /^apply: run gate-1: created 0, updated 3, skipped 0, failed 0; verify clean/);
  assert.equal(w.fake.find('rulebook', 'Predictive').props['When to use'], composeWhenToUse(tag.when_to_use));
  assert.equal(w.fake.find('rulebook', 'Predictive').props['Rule version'], VERSION);
  assert.deepEqual(w.fake.find('rulebook', 'Predictive').props['Changed by'], [w.ids.lesson]);
  assert.equal(w.fake.find('rule_changes', LESSON).props.Status, 'Live');
  assert.equal(w.fake.find('agent_settings', 'claim-tagger').props['Rubric in force'], VERSION);
});

test('sandbox root (CLAIM_TAGGER_ROOT set to a folder with state but no schemas): the PASS evidence still finds card.schema.json in the agent folder', async () => {
  const w = await world();
  lay(w);
  assert.equal(existsSync(join(w.root, 'schemas')), false, 'the test root holds no schemas, like agents/claim-tagger/sandbox');
  const saved = process.env.CLAIM_TAGGER_ROOT;
  process.env.CLAIM_TAGGER_ROOT = w.root;
  try {
    const gate = evidenceOf(w);
    assert.equal(gate.ok, true, joined(gate));
    assert.deepEqual(gate.evidence.modes, ['promote']);
  } finally {
    if (saved === undefined) delete process.env.CLAIM_TAGGER_ROOT;
    else process.env.CLAIM_TAGGER_ROOT = saved;
  }
});

test('a plan that claims nothing and writes no rule text needs no evidence and no file is read for it', () => {
  const plan = { header: { op: 'header', run_id: 'tag-1', ctx: { seed: false, promote: false, gate: null } }, ops: [
    { op: 'update', seq: 1, database: 'claims', key: 'g1', properties: { Readiness: 'Ready' } },
    { op: 'update', seq: 2, database: 'rulebook', key: 'Predictive', properties: { Judged: true } },
    { op: 'update', seq: 3, database: 'rule_changes', key: 'L', properties: { Status: 'Rolled back' } },
    { op: 'update', seq: 4, database: 'agent_settings', key: 'claim-tagger', properties: { 'Rubric in force': 'whatever' } },
  ] };
  assert.equal(evidenceNeeded(plan), false);
  const result = checkGateEvidence({ root: join('no', 'such', 'root'), plan, pull: null });
  assert.deepEqual(result, { ok: true, problems: [], evidence: { modes: [] } });
});

test('gateClaims: the header claims, the Rulebook rule columns and a lesson set Live decide what has to be proven', () => {
  const plan = (ctx, ops = []) => ({ header: { run_id: 'r', ctx }, ops });
  const rulebook = (properties) => ({ database: 'rulebook', key: 'T', properties });
  const lesson = (Status) => ({ database: 'rule_changes', key: 'L', properties: { Status } });
  assert.deepEqual(RULE_PROPS, ['When to use', 'Rule version', 'Tag hash', 'Changed by']);
  const flags = (p) => { const c = gateClaims(p); return [c.promote, c.restore, c.seed, c.needPromote, c.needed]; };
  assert.deepEqual(flags(plan({})), [false, false, false, false, false]);
  assert.deepEqual(flags(plan({ promote: true, gate: 'PASS' })), [true, false, false, true, true]);
  assert.deepEqual(flags(plan({ promote: 'yes' })), [false, false, false, false, false], 'only a boolean true claims');
  assert.deepEqual(flags(plan({ gate: 'PASS' })), [false, false, false, false, false], 'a gate string alone claims nothing');
  assert.deepEqual(flags(plan({ restore: true, confirm: true }, [rulebook({ 'When to use': 'x' })])), [false, true, false, false, true]);
  assert.deepEqual(flags(plan({ seed: true }, [rulebook({ 'When to use': 'x' })])), [false, false, true, false, true]);
  for (const prop of RULE_PROPS) assert.deepEqual(flags(plan({}, [rulebook({ [prop]: 'x' })])), [false, false, false, true, true], `${prop} alone makes the plan a promote`);
  assert.deepEqual(flags(plan({}, [rulebook({ Judged: true })])), [false, false, false, false, false]);
  assert.deepEqual(flags(plan({}, [lesson('Live')])), [false, false, false, true, true], 'a lesson set Live is a gate claim in any plan');
  assert.deepEqual(flags(plan({}, [lesson('Rolled back')])), [false, false, false, false, false]);
  assert.deepEqual(flags(plan({ seed: true }, [lesson('Live')])), [false, false, true, true, true]);
  assert.deepEqual(flags({ header: null, ops: null }), [false, false, false, false, false], 'a broken plan object claims nothing and does not throw');
});

// ---- each broken piece is refused with the reason ------------------------------------------------------------------------------------------

const breaks = [
  ['no PROMOTING.json', { omit: ['promoting'] }, /runs\/PROMOTING\.json does not exist: no promote of run gate-1 is in flight/],
  ['PROMOTING.json of another run', { promoting: (p) => ({ ...p, run_id: 'other-run' }) }, /runs\/PROMOTING\.json belongs to run other-run, not to run gate-1/],
  ['PROMOTING.json that names no lesson', { promoting: ({ lesson, ...p }) => p }, /runs\/PROMOTING\.json names no lesson/],
  ['no card', { omit: ['card'] }, /runs\/gate-1\/card\.json \(the gate card\) does not exist/],
  ['a HOLD card', { card: (c) => ({ ...c, verdict: 'HOLD' }) }, /the card's verdict is "HOLD", not PASS/],
  ['a FAIL card', { card: (c) => ({ ...c, verdict: 'FAIL' }) }, /the card's verdict is "FAIL", not PASS/],
  ['a card with verdict n/a (incomplete judgments)', { card: (c) => ({ ...c, verdict: 'n/a' }) }, /the card's verdict is "n\/a", not PASS/],
  ['a smoke card', { card: (c) => ({ ...c, kind: 'smoke', smoke: true }) }, [/the card is a smoke card/, /the card's kind is "smoke", not "gate"/]],
  ['a gate card with the smoke flag', { card: (c) => ({ ...c, smoke: true }) }, /the card is a smoke card/],
  ['a card of another kind', { card: (c) => ({ ...c, kind: 'baseline' }) }, /the card's kind is "baseline", not "gate"/],
  ['a card for another lesson', { card: (c) => ({ ...c, lesson: 'Another lesson' }) }, /the card is for lesson "Another lesson", runs\/PROMOTING\.json names "Hedged trajectories are not forecasts"/],
  ['a card that breaks card.schema.json', { card: ({ conditions, ...c }) => c }, /runs\/gate-1\/card\.json does not match card\.schema\.json: .*conditions/],
  ['no candidate rubric', { omit: ['candidate'] }, /runs\/gate-1\/candidate\/rubric\.json \(the candidate rubric\) does not exist/],
  ['a candidate edited after it was hashed', { candidate: (c) => { tagOf(c, 'Predictive').when_to_use.rules[0].text = 'Edited by hand.'; return c; } }, /the candidate rubric does not match its own hashes/],
  ['a candidate that is not the one the card gated', { candidate: (c) => { tagOf(c, 'Predictive').when_to_use.rules[0].text = 'Another text, hashed.'; return rehash(c); } }, /the card gated "sha256:[0-9a-f]{16}"/],
  ['a candidate of another version than PROMOTING.json says', { promoting: (p) => ({ ...p, version: '2099-01-01.9' }) }, /runs\/PROMOTING\.json says "2099-01-01\.9"/],
  ['a baseline that is not the live rubric', { card: (c) => { c.configs.baseline.rubric_hash = 'sha256:0000000000000000'; return c; } }, /the card gated against "sha256:0000000000000000", the live rubric is "sha256:[0-9a-f]{16}": the live rubric is not the baseline of this gate/],
  ['rule text that differs from the candidate\'s', { ops: (rows) => { opOf(rows, 'rulebook').properties['When to use'] += '\n5. A rule nobody gated.'; return rows; } }, /rulebook "Predictive": When to use is not the candidate's text for this tag/],
  ['a tag hash that differs', { ops: (rows) => { opOf(rows, 'rulebook').properties['Tag hash'] = 'sha256:deadbeefdeadbeef'; return rows; } }, /rulebook "Predictive": Tag hash is "sha256:deadbeefdeadbeef", the candidate's is "sha256:[0-9a-f]{16}"/],
  ['a rule version that differs', { ops: (rows) => { opOf(rows, 'rulebook').properties['Rule version'] = '2099-01-01.7'; return rows; } }, /rulebook "Predictive": Rule version is "2099-01-01\.7", the candidate's is "2099-01-01\.1"/],
  ['a rule column that is missing', { ops: (rows) => { delete opOf(rows, 'rulebook').properties['Tag hash']; return rows; } }, /rulebook "Predictive": Tag hash is missing/],
  ['Changed by left out', { ops: (rows) => { delete opOf(rows, 'rulebook').properties['Changed by']; return rows; } }, /rulebook "Predictive": Changed by is missing/],
  ['Changed by empty', { ops: (rows) => { opOf(rows, 'rulebook').properties['Changed by'] = []; return rows; } }, /rulebook "Predictive": Changed by does not reference the promoted lesson/],
  ['Changed by another page', { ops: (rows) => { opOf(rows, 'rulebook').properties['Changed by'] = ['f0f0f0f0-0000-4000-8000-0000000000aa']; return rows; } }, /rulebook "Predictive": Changed by does not reference the promoted lesson/],
  ['a Rulebook op for a tag the candidate does not change', { ops: (rows) => { const op = opOf(rows, 'rulebook'); op.key = 'Debate'; return rows; } }, [/rulebook "Debate": the candidate does not change this tag/, /rulebook "Debate": runs\/PROMOTING\.json promotes the tag "Predictive"/]],
  ['a Rulebook op for a tag that is not in the rubric', { ops: (rows) => { opOf(rows, 'rulebook').key = 'No such tag'; return rows; } }, /rulebook "No such tag": not a tag of both the live rubric and the candidate/],
  ['a Live status for another lesson', { ops: (rows) => { opOf(rows, 'rule_changes').key = 'Another lesson'; return rows; } }, /rule_changes "Another lesson": sets Status Live, but the lesson being promoted is "Hedged trajectories are not forecasts"/],
  ['Rubric in force that is not the candidate\'s', { ops: (rows) => { opOf(rows, 'agent_settings').properties['Rubric in force'] = '2099-01-01.5'; return rows; } }, /agent_settings "claim-tagger": Rubric in force is "2099-01-01\.5", the candidate's version is "2099-01-01\.1"/],
];
for (const [name, change, pattern] of breaks) {
  test(`evidence refused: ${name}`, async () => {
    const w = await world();
    lay(w, change);
    const gate = evidenceOf(w);
    assert.equal(gate.ok, false, 'the evidence must not hold');
    for (const one of [pattern].flat()) assert.match(joined(gate), one);
    // and through the real doors: check arms nothing, apply (armed by hand) sends nothing
    const result = check({ root: w.root, runId: RUN, now: w.clock.now });
    assert.equal(result.code, EXIT.INVALID);
    assert.ok(result.problems.every((p) => p.startsWith('gate evidence: ') || /^allowlist: /.test(p) || /^op \d+ /.test(p)), result.problems.join(' | '));
    assert.equal(armedState(w.root), null);
    armByHand(w);
    const before = w.fake.requests.length;
    const refused = await applyRun(w);
    assert.equal(refused.code, EXIT.INVALID);
    assert.equal(w.fake.requests.length, before, 'no request');
    assert.deepEqual(w.fake.writes(), []);
  });
}

test('a header that says PASS does not make a HOLD card a PASS: the card decides, not the header', async () => {
  const w = await world();
  lay(w, { card: (c) => ({ ...c, verdict: 'HOLD' }), ctx: { promote: true, gate: 'PASS' } });
  const rows = readOps(w);
  assert.deepEqual(rows[0].ctx, { seed: false, promote: true, gate: 'PASS' }, 'the header says PASS');
  assert.equal(check({ root: w.root, runId: RUN, now: w.clock.now }).code, EXIT.INVALID);
});

test('evidence refused: the lesson is not Approved in the pull (Proposed, Rejected, Rolled back, or Live without a ledger entry)', async () => {
  const w = await world();
  lay(w);
  for (const status of ['Proposed', 'Rejected', 'Rolled back', 'Live']) {
    w.fake.editorSet(w.ids.lesson, { Status: status });
    await w.pull(`status-${status.replace(' ', '-')}`);
    const gate = evidenceOf(w, { pull: `status-${status.replace(' ', '-')}` });
    assert.equal(gate.ok, false, status);
    assert.match(joined(gate), new RegExp(`rule_changes "Hedged trajectories are not forecasts": the lesson is "${status}" in pull status-${status.replace(' ', '-')}, not Approved`), status);
  }
  w.fake.editorSet(w.ids.lesson, { Status: 'Approved' });
  await w.pull('status-back');
  assert.equal(evidenceOf(w, { pull: 'status-back' }).ok, true);
});

test('evidence refused: a plan that rewrites the rule but leaves the lesson op out still needs the lesson Approved', async () => {
  const w = await world();
  lay(w, { ops: (rows) => rows.filter((r) => r.database !== 'rule_changes').map((r, i) => (i === 0 ? r : { ...r, seq: i })) }); // the header, then the ops renumbered
  assert.equal(opOf(readOps(w), 'rule_changes'), undefined);
  assert.equal(evidenceOf(w).ok, true, 'Approved in p1');
  w.fake.editorSet(w.ids.lesson, { Status: 'Rejected' });
  await w.pull('rejected');
  const gate = evidenceOf(w, { pull: 'rejected' });
  assert.equal(gate.ok, false);
  assert.match(joined(gate), /rule_changes "Hedged trajectories are not forecasts": the lesson is "Rejected" in pull rejected, not Approved/);
});

test('PROMOTING.json may record the sha of the plan promote wrote: a plan edited afterwards is refused, a plan that is that file is accepted', async () => {
  const w = await world();
  lay(w);
  const record = (sha) => writeJsonAtomic(runsFile(w, 'PROMOTING.json'), { ...JSON.parse(readFileSync(runsFile(w, 'PROMOTING.json'), 'utf8')), plan_sha: sha });
  record(readPlan(w.root, RUN).sha);
  assert.equal(evidenceOf(w).ok, true);
  const rows = readOps(w);
  rows[1].note = 'a note added after promote wrote the plan';
  putOps(w, rows);
  const gate = evidenceOf(w);
  assert.equal(gate.ok, false);
  assert.match(joined(gate), /the plan was changed after runs\/PROMOTING\.json recorded it \(plan_sha differs\)/);
});

test('evidence refused: a pull that does not cover Rule changes cannot show the lesson', async () => {
  const w = await world();
  lay(w);
  await w.pull('no-lessons', ['rulebook', 'agent_settings']);
  const gate = evidenceOf(w, { pull: 'no-lessons' });
  assert.equal(gate.ok, false);
  assert.match(joined(gate), /the pull no-lessons has no such lesson \(it must cover Rule changes\), so its status cannot be checked/);
  const none = checkGateEvidence({ root: w.root, plan: readPlan(w.root, RUN), pull: null });
  assert.equal(none.ok, false);
  assert.match(joined(none), /the pull \(none\) has no such lesson/);
});

test('evidence refused: the live rubric moved on after the gate (it is not the baseline) or does not match its own hashes', async () => {
  const w = await world();
  lay(w);
  // somebody finalizes another change by hand: rubric.json and its lock both move, the card's baseline is now history
  const live = liveOf(w);
  tagOf(live, 'Debate').when_to_use.rules[0].text = 'A rule that changed after the gate ran.';
  rehash(live);
  writeFileSync(join(w.root, 'rubric', 'rubric.json'), `${JSON.stringify(live, null, 2)}\n`);
  lock(w);
  const moved = evidenceOf(w);
  assert.equal(moved.ok, false);
  assert.match(joined(moved), /is not the baseline of this gate/);
  // rubric.json edited in a rule, hashes left alone: the live rubric is not what its own hashes say
  const w2 = await world();
  lay(w2);
  assert.equal(evidenceOf(w2).ok, true);
  const edited = liveOf(w2);
  tagOf(edited, 'Debate').when_to_use.rules[0].text = 'Edited in the file, hashes left alone.';
  writeFileSync(join(w2.root, 'rubric', 'rubric.json'), `${JSON.stringify(edited, null, 2)}\n`);
  assert.match(joined(evidenceOf(w2)), /rubric\/rubric\.json does not match its own hashes/);
  // a promote does not ask for rubric.lock (promote.mjs's own preflight does); a restore does: see the restore tests
  const w3 = await world();
  lay(w3);
  rmSync(join(w3.root, 'rubric', 'rubric.lock'));
  assert.equal(evidenceOf(w3).ok, true);
});

test('evidence refused: a run id that could leave the runs folder is never used as a path', () => {
  for (const run_id of ['../x', '..\\x', 'a/b', '', 5, null, undefined]) {
    const plan = { header: { run_id, ctx: { promote: true, gate: 'PASS' } }, ops: [] };
    const gate = checkGateEvidence({ root: join('no', 'such', 'root'), plan, pull: null });
    assert.equal(gate.ok, false, String(run_id));
    assert.match(joined(gate), /the plan header has no usable run id/);
  }
});

test('a malformed fixture never makes the check throw: it is a problem, and the plan is not accepted', async () => {
  const w = await world();
  lay(w);
  writeFileSync(runsFile(w, 'PROMOTING.json'), '{ not json');
  assert.match(joined(evidenceOf(w)), /runs\/PROMOTING\.json is not readable JSON/);
  lay(w);
  writeFileSync(runsFile(w, RUN, 'card.json'), '[]');
  assert.equal(evidenceOf(w).ok, false);
  lay(w);
  writeFileSync(runsFile(w, RUN, 'candidate', 'rubric.json'), '{"tags": 5}');
  assert.match(joined(evidenceOf(w)), /candidate\/rubric\.json is not a rubric/);
  lay(w);
  writeFileSync(join(w.root, 'rubric', 'rubric.json'), '{}');
  assert.match(joined(evidenceOf(w)), /rubric\/rubric\.json is not a rubric/);
});

// ---- a lesson set Live is a gate claim in every plan ---------------------------------------------------------------------------------------

test('a plan with no promote claim that sets a lesson Live is refused: Live is what a PASS does', async () => {
  const w = await world();
  const p = openPlan({ runId: 'live-1', root: w.root, now: w.clock.now });
  p.update('rule_changes', LESSON, null, { Status: 'Live', 'Gate result': 'PASS (made up)' }); // the allowlist lets the agent write Live in any context
  p.write();
  assert.deepEqual(resolveOps(readPlan(w.root, 'live-1'), loadPull(w.root, 'p1'), { config: w.config }).violations, []);
  const result = check({ root: w.root, runId: 'live-1', now: w.clock.now });
  assert.equal(result.code, EXIT.INVALID);
  assert.match(result.problems[0], /^gate evidence: runs\/PROMOTING\.json does not exist/);
  const q = openPlan({ runId: 'rolled-1', root: w.root, now: w.clock.now });
  q.update('rule_changes', LESSON, null, { Status: 'Rolled back' });
  q.write();
  assert.equal(check({ root: w.root, runId: 'rolled-1', now: w.clock.now }).code, EXIT.OK, 'Rolled back is not a gate claim');
});

// ---- a resumed apply sees its own earlier work ---------------------------------------------------------------------------------------------

test('a resumed apply: once the lesson op landed the lesson is Live in the pull, and the ledger of the run lets the evidence through', async () => {
  const w = await world();
  lay(w);
  assert.equal(check({ root: w.root, runId: RUN, now: w.clock.now }).code, EXIT.OK);
  // the last op fails once: the rule and the lesson landed, Rubric in force did not
  w.fake.failNext('updatePage', new NotionError('Notion PATCH -> 503: down', { status: 503, code: 'service_unavailable', retryable: true }), { match: (i) => i.pageId === w.ids.settings });
  const first = await applyRun(w);
  assert.equal(first.code, EXIT.ERROR, first.err.join('\n'));
  assert.equal(w.fake.find('rule_changes', LESSON).props.Status, 'Live');
  assert.ok(armedState(w.root), 'a run that did not finish stays armed');
  const ledger = readJsonl(runsFile(w, RUN, 'applied.jsonl')).rows;
  assert.deepEqual(ledger.map((r) => [r.seq, r.status]), [[1, 'ok'], [2, 'ok'], [3, 'failed']]);

  // the next start pulls again: the lesson is Live there. The evidence still holds (the ledger says the lesson op is ours), so the last op is sent.
  const second = await applyRun(w);
  assert.equal(second.code, EXIT.OK, second.err.join('\n'));
  assert.match(second.out[0], /^apply: run gate-1: created 0, updated 1, skipped 0, failed 0, already done 2; verify clean/);
  assert.equal(w.fake.find('agent_settings', 'claim-tagger').props['Rubric in force'], VERSION);
});

test('a plan that loses its evidence after it was armed (the promote was aborted) is disarmed by the next check and refused by apply', async () => {
  const w = await world();
  lay(w);
  assert.equal(check({ root: w.root, runId: RUN, now: w.clock.now }).code, EXIT.OK);
  assert.equal(armedState(w.root).run_id, RUN);
  rmSync(runsFile(w, 'PROMOTING.json'));
  const again = check({ root: w.root, runId: RUN, now: w.clock.now });
  assert.equal(again.code, EXIT.INVALID);
  assert.match(again.problems[0], /^gate evidence: runs\/PROMOTING\.json does not exist/);
  assert.equal(armedState(w.root), null, 'the earlier arming did not outlive the proof');
  const before = w.fake.requests.length;
  const refused = await applyRun(w);
  assert.equal(refused.code, EXIT.INVALID);
  assert.equal(w.fake.requests.length, before);
});

test('--retry of a half-applied promote: the evidence is checked again and holds, only the ops of plan.retry.jsonl are sent', async () => {
  const w = await world();
  lay(w);
  assert.equal(check({ root: w.root, runId: RUN, now: w.clock.now }).code, EXIT.OK);
  w.fake.failNext('updatePage', new NotionError('Notion PATCH -> 503: down', { status: 503, code: 'service_unavailable', retryable: true }), { match: (i) => i.pageId === w.ids.settings });
  assert.equal((await applyRun(w)).code, EXIT.ERROR);
  assert.deepEqual(readJsonl(runsFile(w, RUN, 'plan.retry.jsonl')).rows.filter((r) => r.op !== 'header').map((r) => r.seq), [3]);
  const sent = w.fake.writes().length;
  const retried = await applyRun(w, ['--run', RUN, '--retry']);
  assert.equal(retried.code, EXIT.OK, retried.err.join('\n'));
  assert.equal(w.fake.writes().length, sent + 1, 'only the failed op was sent again');
  // and when the evidence is gone, --retry refuses before it looks at the retry file or sends anything
  const w2 = await world();
  lay(w2);
  assert.equal(check({ root: w2.root, runId: RUN, now: w2.clock.now }).code, EXIT.OK);
  w2.fake.failNext('updatePage', new NotionError('Notion PATCH -> 503: down', { status: 503, code: 'service_unavailable', retryable: true }), { match: (i) => i.pageId === w2.ids.settings });
  assert.equal((await applyRun(w2)).code, EXIT.ERROR);
  rmSync(runsFile(w2, 'PROMOTING.json')); // an abort took the promote away
  const writes = w2.fake.writes().length;
  const refused = await applyRun(w2, ['--run', RUN, '--retry']);
  assert.equal(refused.code, EXIT.INVALID);
  assert.equal(refused.err[0], `apply: ${EVIDENCE_REFUSAL}`);
  assert.equal(w2.fake.writes().length, writes);
});

test('check can arm the plan of a half-applied promote again (the pull shows the lesson Live, the ledger shows who did it); without the ledger it cannot', async () => {
  const w = await world();
  lay(w);
  assert.equal(check({ root: w.root, runId: RUN, now: w.clock.now }).code, EXIT.OK);
  assert.equal((await applyRun(w)).code, EXIT.OK);
  await w.pull('after'); // the lesson is Live in the newest pull
  assert.equal(w.fake.find('rule_changes', LESSON).props.Status, 'Live');
  const again = evidenceOf(w, { pull: 'after' });
  assert.equal(again.ok, true, joined(again));
  const lessonSeq = readPlan(w.root, RUN).ops.find((o) => o.database === 'rule_changes').seq;
  // an entry that is not "ok", or for another op, does not count
  for (const rows of [[{ seq: lessonSeq, status: 'failed' }], [{ seq: lessonSeq + 1, status: 'ok' }], []]) {
    writeFileSync(runsFile(w, RUN, 'applied.jsonl'), rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
    const gate = evidenceOf(w, { pull: 'after' });
    assert.equal(gate.ok, false, JSON.stringify(rows));
    assert.match(joined(gate), /the lesson is "Live" in pull after, not Approved/);
  }
  rmSync(runsFile(w, RUN, 'applied.jsonl'));
  assert.equal(evidenceOf(w, { pull: 'after' }).ok, false);
  writeFileSync(runsFile(w, RUN, 'applied.jsonl'), '{ torn');
  assert.equal(evidenceOf(w, { pull: 'after' }).ok, false, 'an unreadable ledger proves nothing');
});

test('the evidence is looked at again with the pull the ops are resolved with: a lesson withdrawn after the check stops the apply before the first write', async () => {
  const w = await world();
  lay(w);
  assert.equal(check({ root: w.root, runId: RUN, now: w.clock.now }).code, EXIT.OK);
  w.fake.editorSet(w.ids.lesson, { Status: 'Rejected' }); // the rule owner changes their mind
  w.clock.advance(FRESH_MS + 1000); // so apply pulls again instead of reusing the old pull
  const result = await applyRun(w);
  assert.equal(result.code, EXIT.INVALID);
  assert.equal(result.err[0], `apply: ${EVIDENCE_REFUSAL}`);
  assert.match(result.err.join('\n'), /the lesson is "Rejected" in pull gate-1-pre, not Approved/);
  assert.deepEqual(w.fake.writes(), [], 'the Rulebook was not touched');
  assert.equal(w.fake.find('rulebook', 'Predictive').props['When to use'], lockedText(w));
});

test('apply with the library entry point: the same refusal, as a result', async () => {
  const w = await world();
  lay(w, { omit: ['card'] });
  armByHand(w);
  const before = w.fake.requests.length;
  const result = await apply({ root: w.root, config: w.config, client: w.fake.client, runId: RUN, now: w.clock.now });
  assert.equal(result.code, EXIT.INVALID);
  assert.equal(result.line, null);
  assert.equal(result.errors[0], EVIDENCE_REFUSAL);
  assert.match(result.errors[1], /^gate evidence: runs\/gate-1\/card\.json \(the gate card\) does not exist/);
  assert.equal(w.fake.requests.length, before);
});

// ---- restore: only the locked text -----------------------------------------------------------------------------------------------------------

/** A restore plan of the Predictive row, built under the engineer-only ctx; `header(ctx)` may then change the header the way a forger would. */
function restorePlan(w, id, rulebookProps, { header } = {}) {
  const p = openPlan({ runId: id, root: w.root, ctx: { restore: true, confirm: true }, now: w.clock.now });
  p.update('rulebook', 'Predictive', null, rulebookProps);
  p.write();
  if (header) {
    const rows = readOps(w, id);
    rows[0].ctx = header(rows[0].ctx);
    putOps(w, rows, id);
  }
}
const lockedProps = (w) => ({ 'When to use': lockedText(w), 'Rule version': ruleVersionOf(liveOf(w), 'Predictive'), 'Tag hash': tagOf(liveOf(w), 'Predictive').tag_hash, 'Changed by': [] });

async function driftedWorld() {
  const w = await world();
  w.fake.editorSet(w.ids.rulebook.Predictive, { 'When to use': '1. Somebody rewrote this in Notion.' });
  await w.pull('p2');
  return w;
}

test('restore: the live rubric\'s own text passes (check, apply, the Rulebook is back); a text that is not the locked text is refused although the header says restore', async () => {
  const w = await driftedWorld();
  restorePlan(w, 'restore-bad', { 'When to use': '1. An attacker\'s text, sent as a restore.', 'Rule version': ruleVersionOf(liveOf(w), 'Predictive'), 'Tag hash': tagOf(liveOf(w), 'Predictive').tag_hash });
  assert.deepEqual(resolveOps(readPlan(w.root, 'restore-bad'), loadPull(w.root, 'p2'), { config: w.config }).violations, [], 'the allowlist believes the header');
  const bad = check({ root: w.root, runId: 'restore-bad', now: w.clock.now });
  assert.equal(bad.code, EXIT.INVALID);
  assert.match(bad.problems.join(' | '), /gate evidence: rulebook "Predictive": When to use is not the live rubric's text \(rubric [\d.-]+\); a restore writes only the locked text/);
  assert.equal(armedState(w.root), null);

  restorePlan(w, 'restore-ok', lockedProps(w));
  const gate = evidenceOf(w, { pull: 'p2', id: 'restore-ok' });
  assert.equal(gate.ok, true, joined(gate));
  assert.deepEqual(gate.evidence.modes, ['restore']);
  assert.deepEqual(gate.evidence.tags, ['Predictive']);
  assert.equal(check({ root: w.root, runId: 'restore-ok', now: w.clock.now }).code, EXIT.OK);
  const result = await applyRun(w, ['--run', 'restore-ok']);
  assert.equal(result.code, EXIT.OK, result.err.join('\n'));
  assert.equal(w.fake.find('rulebook', 'Predictive').props['When to use'], lockedText(w));
});

test('restore: Rule version and Tag hash must be the live rubric\'s; Changed by is cleared, never set; the header needs confirm; the tag must exist', async () => {
  const w = await driftedWorld();
  const good = lockedProps(w);
  const run = (id, props, opts) => { restorePlan(w, id, props, opts); return evidenceOf(w, { pull: 'p2', id }); };
  assert.equal(run('r-ok', good).ok, true);
  assert.equal(run('r-live-version', { ...good, 'Rule version': liveOf(w).rubric_version }).ok, true, 'the rubric\'s own version is accepted too');
  assert.match(joined(run('r-version', { ...good, 'Rule version': '1999-01-01.1' })), /rulebook "Predictive": Rule version is "1999-01-01\.1", the live rubric's is /);
  assert.match(joined(run('r-hash', { ...good, 'Tag hash': 'sha256:deadbeefdeadbeef' })), /rulebook "Predictive": Tag hash is "sha256:deadbeefdeadbeef", the live rubric's is /);
  assert.match(joined(run('r-changed-by', { ...good, 'Changed by': [w.ids.lesson] })), /a restore clears Changed by, it does not set it/);
  assert.match(joined(run('r-no-confirm', good, { header: ({ confirm, ...ctx }) => ctx })), /the header says restore without confirm/);
  assert.match(joined(run('r-confirm-false', good, { header: (ctx) => ({ ...ctx, confirm: false }) })), /the header says restore without confirm/);
  // a tag that is not in the rubric
  const p = openPlan({ runId: 'r-unknown', root: w.root, ctx: { restore: true, confirm: true }, now: w.clock.now });
  p.update('rulebook', 'Predictive', null, good);
  p.write();
  const rows = readOps(w, 'r-unknown');
  rows[1].key = 'No such tag';
  putOps(w, rows, 'r-unknown');
  assert.match(joined(evidenceOf(w, { pull: 'p2', id: 'r-unknown' })), /rulebook "No such tag": not a tag of the live rubric, so there is no locked text to restore/);
});

test('restore: a live rubric that fails its own hashes or its lock is not "locked text"', async () => {
  const w = await driftedWorld();
  restorePlan(w, 'r-1', lockedProps(w));
  assert.equal(evidenceOf(w, { pull: 'p2', id: 'r-1' }).ok, true);
  const rubric = liveOf(w);
  tagOf(rubric, 'Predictive').when_to_use.rules[0].text = 'Edited in the file, hashes left alone.';
  writeFileSync(join(w.root, 'rubric', 'rubric.json'), `${JSON.stringify(rubric, null, 2)}\n`);
  const gate = evidenceOf(w, { pull: 'p2', id: 'r-1' });
  assert.equal(gate.ok, false);
  assert.match(joined(gate), /rubric\/rubric\.json does not match its own hashes/);
  assert.match(joined(gate), /rubric\/rubric\.json was changed after it was locked/);
  rehash(rubric); // the edit is made consistent, but the lock still names the old file
  writeFileSync(join(w.root, 'rubric', 'rubric.json'), `${JSON.stringify(rubric, null, 2)}\n`);
  assert.match(joined(evidenceOf(w, { pull: 'p2', id: 'r-1' })), /rubric\/rubric\.lock says (version|sha256)/);
  // the old plan asks for the old text, and the "locked" text is now the edited one: the plan no longer matches
  assert.match(joined(evidenceOf(w, { pull: 'p2', id: 'r-1' })), /When to use is not the live rubric's text/);
  // no lock at all, and a lock nobody can read
  const w2 = await driftedWorld();
  restorePlan(w2, 'r-2', lockedProps(w2));
  assert.equal(evidenceOf(w2, { pull: 'p2', id: 'r-2' }).ok, true);
  writeFileSync(join(w2.root, 'rubric', 'rubric.lock'), '{ not json');
  assert.match(joined(evidenceOf(w2, { pull: 'p2', id: 'r-2' })), /rubric\/rubric\.lock is not readable JSON/);
  rmSync(join(w2.root, 'rubric', 'rubric.lock'));
  assert.match(joined(evidenceOf(w2, { pull: 'p2', id: 'r-2' })), /rubric\/rubric\.lock does not exist, so the live rubric is not locked/);
  assert.equal(check({ root: w2.root, runId: 'r-2', now: w2.clock.now }).code, EXIT.INVALID, 'check arms nothing without the lock');
});

test('restore: a restore plan that writes no rule text (the lesson and Agent settings of an abort) has no text to prove, but still needs confirm', async () => {
  const w = await world();
  const make = (id, header) => {
    const p = openPlan({ runId: id, root: w.root, ctx: { restore: true, confirm: true }, now: w.clock.now });
    p.update('rule_changes', LESSON, null, { Status: 'Rolled back', 'Gate result': 'Aborted' });
    p.write();
    if (header) { const rows = readOps(w, id); rows[0].ctx = header(rows[0].ctx); putOps(w, rows, id); }
  };
  rmSync(join(w.root, 'rubric', 'rubric.lock')); // nothing here depends on the lock
  make('abort-1');
  const gate = evidenceOf(w, { id: 'abort-1' });
  assert.equal(gate.ok, true, joined(gate));
  assert.deepEqual(gate.evidence, { modes: ['restore'] });
  make('abort-2', ({ confirm, ...ctx }) => ctx);
  assert.match(joined(evidenceOf(w, { id: 'abort-2' })), /the header says restore without confirm/);
});

test('ruleVersionOf is status.mjs tagRuleVersion: the last changelog entry that names the tag, else the first version, else the rubric\'s', async () => {
  const { tagRuleVersion } = await import('../agents/claim-tagger/scripts/status.mjs');
  const w = await world();
  const live = liveOf(w);
  const candidate = applyLesson(live, { tag: 'Predictive', ruleN: 1, newText: NEW_RULE, kind: 'Change the rule', note: 'x' }, { version: VERSION });
  const noLog = { rubric_version: 'v9', changelog: [] };
  for (const rubric of [live, candidate, noLog, { rubric_version: 'v9' }]) {
    for (const name of ['Predictive', 'Debate', 'No such tag']) assert.equal(ruleVersionOf(rubric, name), tagRuleVersion(rubric, name), `${rubric.rubric_version} ${name}`);
  }
  assert.equal(ruleVersionOf(candidate, 'Predictive'), VERSION);
  assert.equal(ruleVersionOf(candidate, 'Debate'), ruleVersionOf(live, 'Debate'));
});

// ---- seed: only with the marker --------------------------------------------------------------------------------------------------------------

function seedPlan(w, id) {
  const p = openPlan({ runId: id, root: w.root, ctx: { seed: true }, now: w.clock.now });
  p.create('claims', 'geo-seed-1', { 'Claim title': 'A claim the seed creates', Table: 'U.S. Politics', Sample: 'Random' });
  p.create('rulebook', 'Newtag', { Status: 'Verified', Category: 'Usage', Polarity: 'Classification', 'When to use': 'Use when ...\n1. Rule.', 'Rule version': VERSION, 'Tag hash': 'sha256:0123456789abcdef', 'Human only': false, Judged: true });
  p.write();
}

test('seed: a plan whose header says seed needs the runs/SETUP marker an engineer creates by hand; without it check and apply refuse, with it they go on', async () => {
  const w = await world();
  seedPlan(w, 'seed-1');
  const gate = evidenceOf(w, { id: 'seed-1' });
  assert.equal(gate.ok, false);
  assert.match(joined(gate), /runs\/SETUP does not exist: a seed plan needs the setup marker, which an engineer creates by hand before the seed and deletes afterwards/);
  assert.doesNotMatch(joined(gate), /PROMOTING/, 'a seed that creates Rulebook rows is not taken for a promote');
  const refused = check({ root: w.root, runId: 'seed-1', now: w.clock.now });
  assert.equal(refused.code, EXIT.INVALID);
  assert.match(refused.problems[0], /^gate evidence: runs\/SETUP does not exist/);
  assert.equal(armedState(w.root), null);

  armByHand(w, 'seed-1');
  const before = w.fake.requests.length;
  const noMarker = await applyRun(w, ['--run', 'seed-1']);
  assert.equal(noMarker.code, EXIT.INVALID);
  assert.equal(noMarker.err[0], `apply: ${EVIDENCE_REFUSAL}`);
  assert.equal(w.fake.requests.length, before);
  rmSync(runsFile(w, 'APPLYING.json'));

  writeFileSync(runsFile(w, 'SETUP'), 'engineer, 13 Oct\n'); // the marker: created by hand from a terminal
  const ok = evidenceOf(w, { id: 'seed-1' });
  assert.equal(ok.ok, true, joined(ok));
  assert.deepEqual(ok.evidence, { modes: ['seed'], setup_marker: 'runs/SETUP' });
  assert.equal(check({ root: w.root, runId: 'seed-1', now: w.clock.now }).code, EXIT.OK);
  const applied = await applyRun(w, ['--run', 'seed-1']);
  assert.equal(applied.code, EXIT.OK, applied.err.join('\n'));
  assert.equal(w.fake.find('claims', 'geo-seed-1').props['Claim title'], 'A claim the seed creates');
  assert.equal(w.fake.find('rulebook', 'Newtag').props['When to use'], 'Use when ...\n1. Rule.');
});

test('seed: removing the marker afterwards closes the door again', async () => {
  const w = await world();
  seedPlan(w, 'seed-2');
  writeFileSync(runsFile(w, 'SETUP'), 'x');
  assert.equal(evidenceOf(w, { id: 'seed-2' }).ok, true);
  rmSync(runsFile(w, 'SETUP'));
  assert.equal(evidenceOf(w, { id: 'seed-2' }).ok, false);
});

test('a header with several claims must keep every one of them: seed with the marker does not excuse a promote', async () => {
  const w = await world();
  writeFileSync(runsFile(w, 'SETUP'), 'x');
  lay(w, { ctx: { promote: true, gate: 'PASS', seed: true }, omit: ['promoting'] });
  const gate = evidenceOf(w);
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.evidence.modes, ['promote', 'seed']);
  assert.match(joined(gate), /runs\/PROMOTING\.json does not exist/);
  assert.equal(gate.evidence.setup_marker, 'runs/SETUP');
});
