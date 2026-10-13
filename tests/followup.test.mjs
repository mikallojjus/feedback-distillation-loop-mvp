import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main as applyMain } from '../agents/claim-tagger/scripts/apply.mjs';
import { liveColumns, main } from '../agents/claim-tagger/scripts/followup.mjs';
import { judgmentFileName, scopeOf, textHash } from '../agents/claim-tagger/scripts/judge.mjs';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { readJson, readJsonl } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { check as planCheck, readPlan } from '../agents/claim-tagger/scripts/plan.mjs';
import { main as promoteMain } from '../agents/claim-tagger/scripts/promote.mjs';
import { loadPull } from '../agents/claim-tagger/scripts/pull.mjs';
import { labelMap, labelOf, makeJudgeStub, normClaim, opposite } from './fixtures/loop/judge-stub.mjs';
import { LESSON_TITLE, captureIo, cleanupLoop, liveRubric, makePromoteWorld } from './fixtures/loop/world.mjs';

after(() => cleanupLoop());

const rootFile = (w, ...parts) => join(w.root, ...parts);
const casesOf = (w) => readJsonl(rootFile(w, 'evals', 'cases.jsonl')).rows;
const canariesOf = (w) => readJsonl(rootFile(w, 'evals', 'canaries.jsonl')).rows;
const LIVE = '2026-10-13.1';

const followup = async (w, argv, stub, extra = {}) => {
  const c = captureIo();
  const code = await main(['--driver', 'fake', ...argv], c.io, w.env({ ...(stub ? { runClaude: stub } : {}), ...extra }));
  return { code, out: c.out, err: c.err };
};

/** The live judge: claims are judged as the editors decided them, except the claims named in `wrong` (by the first words of their text). */
function liveJudge(w, { wrong = [], ...options } = {}) {
  const labels = labelMap(casesOf(w));
  const wrongClaims = new Set(casesOf(w).filter((c) => wrong.some((p) => c.claim.startsWith(p))).map((c) => normClaim(c.claim)));
  return makeJudgeStub({
    ...options,
    decide: ({ claim, tag }) => {
      const want = labelOf(labels, claim, tag);
      if (!want) return undefined;
      return wrongClaims.has(normClaim(claim)) ? opposite(want) : want;
    },
  });
}

async function applyPlan(w, runId, pullId) {
  const chk = planCheck({ root: w.root, runId, now: w.clock.now });
  assert.equal(chk.code, EXIT.OK, (chk.problems ?? []).join('; '));
  const cap = captureIo();
  assert.equal(await applyMain(['--run', runId], cap.io, w.env()), EXIT.OK, `${cap.out.join('\n')}\n${cap.err.join('\n')}`);
  await w.pull(pullId);
  return cap.out[0];
}

const COGNITIVE = 'The current trend of cognitive offloading';

// ---- the road: promote, apply, finalize, then follow up (a cache hit) ------------------------------------------------------------------------------

test('after a PASS and a finalize the follow-up judges nothing new: the gate\'s judgments are the live rubric\'s', async () => {
  const { w } = await makePromoteWorld();
  const labels = labelMap([...casesOf(w), ...canariesOf(w)]);
  const lessonClaims = new Set(casesOf(w).filter((c) => c.contested_lesson === LESSON_TITLE).map((c) => normClaim(c.claim)));
  const stub = makeJudgeStub({
    decide: ({ claim, tag, version }) => {
      const want = labelOf(labels, claim, tag);
      if (!want) return undefined;
      return version === LIVE && tag === 'Predictive' && lessonClaims.has(normClaim(claim)) ? opposite(want) : want;
    },
  });
  const cap = captureIo();
  assert.equal(await promoteMain(['--lesson', LESSON_TITLE, '--driver', 'fake', '--run-id', 'pr1'], cap.io, w.env({ runClaude: stub })), EXIT.OK, cap.err.join('\n'));
  await applyPlan(w, 'pr1', 'p2');
  assert.equal(await promoteMain(['--finalize', 'pr1'], captureIo().io, w.env({ runClaude: stub })), EXIT.OK);
  await w.pull('p3');
  const spent = stub.calls.length;

  const r = await followup(w, ['--lesson', 'LS-1', '--run-id', 'f1'], stub);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(stub.calls.length, spent, 'no model call: every cell was judged by the gate under this very rubric');
  assert.match(r.out[0], /^followup: LS-1 · rubric 2026-10-13\.2: 4 Fixed, 0 Still wrong, 0 Not re-run; \d+ of \d+ other decided Predictive rows still agree; \d+ claim\(s\) refreshed; \$0\.0000; plan /);
  assert.equal(readJson(rootFile(w, 'runs', 'f1-judge', 'run.json')).cost_usd, 0);
  assert.equal(readJson(rootFile(w, 'runs', 'f1-judge', 'run.json')).config16, readJson(rootFile(w, 'runs', 'pr1-candidate', 'run.json')).config16, 'the live rubric is the candidate\'s configuration');
});

// ---- Fixed, Still wrong, Not re-run -----------------------------------------------------------------------------------------------------------------

test('Fixed when the majority now equals the editor\'s outcome; the plan writes the follow-up fields, the live columns and a Runs row', async () => {
  const { w, supporting, lessonPage } = await makePromoteWorld({ lessonStatus: 'Live', lessonOptions: { rubricVersion: '2026-10-13.2' } });
  const stub = liveJudge(w);
  const r = await followup(w, ['--lesson', LESSON_TITLE, '--run-id', 'f1'], stub);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /^followup: LS-1 · rubric 2026-10-13\.1: 4 Fixed, 0 Still wrong, 0 Not re-run; /);
  assert.match(r.out[0], /; next: node agents\/claim-tagger\/scripts\/plan\.mjs check --run f1; node agents\/claim-tagger\/scripts\/apply\.mjs --run f1/);

  const { ops, header } = readPlan(w.root, 'f1');
  assert.deepEqual(header.ctx, { seed: false, promote: false, gate: null });
  const rows = ops.filter((o) => o.database === 'tag_decisions');
  assert.deepEqual(rows.map((o) => o.key).sort(), [...supporting].sort());
  for (const op of rows) {
    assert.deepEqual(Object.keys(op.properties).sort(), ['Agent follow-up', 'Follow-up run']);
    assert.equal(op.properties['Agent follow-up'], 'Fixed');
    assert.equal(op.properties['Follow-up run'], '2026-10-13.1 · f1');
  }
  const claims = ops.filter((o) => o.database === 'claims');
  assert.ok(claims.length > 0);
  for (const op of claims) for (const name of Object.keys(op.properties)) assert.ok(['Agent tags', 'Readiness', 'Tag confidence', 'Last judged'].includes(name), name);
  const runs = ops.filter((o) => o.database === 'runs');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].key, 'Follow-up 2026-10-13.1 · LS-1');
  assert.equal(runs[0].properties.Kind, 'Follow-up');
  assert.equal(runs[0].properties.Verdict, 'n/a');
  assert.equal(runs[0].properties['Rubric version'], LIVE);
  assert.match(runs[0].properties.Summary, /^Follow-up 2026-10-13\.1: 4 row\(s\) Fixed, 0 Still wrong, 0 Not re-run\. Lesson LS-1 "Hedged trajectories are not forecasts"\. Other decided rows on Predictive: \d+ still agree, 0 now disagree\.$/);
  assert.deepEqual(runs[0].properties.Lesson, [lessonPage]);
  assert.equal(runs[0].properties['Cost USD'] > 0, true);
  assert.equal(runs[0].properties.Model, 'claude-sonnet-5-5');
  assert.match(runs[0].content_md, /## Supporting rows\n- .*::Predictive: Fixed \(the judge now says do_not_apply, the editor said do_not_apply\)/);
  const settings = ops.find((o) => o.database === 'agent_settings');
  assert.deepEqual(Object.keys(settings.properties).sort(), ['Last run at', 'Last run summary']);
  assert.match(settings.properties['Last run summary'], /^Follow-up 2026-10-13\.1: 4 row\(s\) Fixed, 0 Still wrong, 0 Not re-run \(LS-1\)$/);

  // it applies: the rows say Fixed, the claim columns are filled, Last judged says which run
  await applyPlan(w, 'f1', 'p2');
  const texas = w.fake.find('tag_decisions', supporting[0]).props;
  assert.equal(texas['Agent follow-up'], 'Fixed');
  assert.equal(texas['Follow-up run'], '2026-10-13.1 · f1');
  const claim = w.fake.find('claims', supporting[0].split('::')[0]).props;
  assert.equal(claim['Last judged'], '2026-10-13.1 · f1');
  assert.ok(['Needs editor', 'Fix needed', 'Not checkable', 'Ready'].includes(claim.Readiness));
  assert.match(claim['Tag confidence'], /Predictive · /);
  assert.match(claim['Tag confidence'], /Predictive · .* · editor: Does not apply \(kept\)/);
  assert.equal(claim['Agent tags'].includes(w.ids.rulebook.Predictive), false, 'the editor said Does not apply, so the agent does not apply Predictive');
  assert.equal(w.fake.find('agent_settings', 'claim-tagger').props['Last run summary'].startsWith('Follow-up 2026-10-13.1: 4 row(s) Fixed'), true);

  // the second time nothing is left to write for the claims, and the cells are cache hits
  const before = stub.calls.length;
  const again = await followup(w, ['--lesson', 'LS-1', '--run-id', 'f2'], stub);
  assert.equal(again.code, EXIT.OK, again.err.join('\n'));
  assert.equal(stub.calls.length, before);
  const second = readPlan(w.root, 'f2').ops;
  const firstClaims = readPlan(w.root, 'f1').ops.filter((o) => o.database === 'claims').length;
  assert.equal(second.filter((o) => o.database === 'claims').length, firstClaims, 'every judged claim again, with one change each');
  for (const op of second.filter((o) => o.database === 'claims')) assert.deepEqual(Object.keys(op.properties), ['Last judged'], 'only the label (the run id) differs now; tags, readiness and confidence are the same');
  assert.equal(readPlan(w.root, 'f2').ops.find((o) => o.database === 'runs').key, 'Follow-up 2026-10-13.1 · LS-1 (2)', 'the second follow-up of the same version has its own row');
});

test('Still wrong when the majority still disagrees; the regression check counts the other decided rows that now disagree', async () => {
  const { w, supporting } = await makePromoteWorld({ lessonStatus: 'Live' });
  const stub = liveJudge(w, { wrong: [COGNITIVE, 'The Trump administration will find another route'] });
  const r = await followup(w, ['--lesson', 'LS-1', '--run-id', 'f1'], stub);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /4 Fixed|3 Fixed, 1 Still wrong, 0 Not re-run/);
  const { ops } = readPlan(w.root, 'f1');
  const value = (prefix) => ops.find((o) => o.database === 'tag_decisions' && o.key.startsWith(prefix)).properties['Agent follow-up'];
  assert.equal(value(supporting.find((k) => k.startsWith('8172f325')).slice(0, 8)), 'Still wrong');
  assert.equal(value('f376c2cc'), 'Fixed');
  assert.equal(value('6aa014be'), 'Fixed');
  const run = ops.find((o) => o.database === 'runs');
  assert.match(run.properties.Summary, /3 row\(s\) Fixed, 1 Still wrong, 0 Not re-run\./);
  assert.match(run.properties.Summary, /Other decided rows on Predictive: \d+ still agree, 1 now disagree \(f4d50e38\)\./);
  assert.match(run.content_md, /## Decided rows on this tag that now disagree\n- f4d50e38[0-9a-f]*::Predictive/);
  assert.match(run.content_md, /::Predictive: Still wrong \(the judge now says apply, the editor said do_not_apply\)/);
});

test('a split verdict, ask_editor and cannot_tell are not the editor\'s outcome: Still wrong; a 2 of 3 majority is enough for Fixed', async () => {
  const { w, supporting } = await makePromoteWorld({ lessonStatus: 'Live' });
  const stub = liveJudge(w);
  assert.equal((await followup(w, ['--lesson', 'LS-1', '--run-id', 'f0'], stub)).code, EXIT.OK);
  const config16 = readJson(rootFile(w, 'runs', 'f0-judge', 'run.json')).config16;
  const claims = readJsonl(rootFile(w, 'runs', 'pull', 'p1', 'norm', 'claims.jsonl')).rows;
  const setRuns = (prefix, decisions) => {
    const key = supporting.find((k) => k.startsWith(prefix));
    const claim = claims.find((c) => c.geo_id === key.split('::')[0]).claim;
    decisions.forEach((decision, i) => {
      const file = rootFile(w, 'runs', 'judgments', config16, `run-${i + 1}`, judgmentFileName(key.split('::')[0], textHash(claim)));
      const doc = readJson(file);
      doc.tags.find((t) => t.name === 'Predictive').decision = decision;
      writeFileSync(file, JSON.stringify(doc));
    });
    return key;
  };
  const split = setRuns('f376c2cc', ['apply', 'do_not_apply', 'ask_editor']); // no majority
  const asked = setRuns('6aa014be', ['ask_editor', 'ask_editor', 'ask_editor']);
  const cannot = setRuns('6e820a8a', ['cannot_tell', 'cannot_tell', 'do_not_apply']);
  const majority = setRuns('8172f325', ['do_not_apply', 'apply', 'do_not_apply']); // 2 of 3 agree with the editor
  const calls = stub.calls.length;
  const r = await followup(w, ['--lesson', 'LS-1', '--run-id', 'f1'], stub);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.equal(stub.calls.length, calls, 'the edited judgments are the cache');
  assert.match(r.out[0], /1 Fixed, 3 Still wrong, 0 Not re-run/);
  const value = (key) => readPlan(w.root, 'f1').ops.find((o) => o.database === 'tag_decisions' && o.key === key).properties['Agent follow-up'];
  assert.equal(value(split), 'Still wrong');
  assert.equal(value(asked), 'Still wrong');
  assert.equal(value(cannot), 'Still wrong');
  assert.equal(value(majority), 'Fixed');
});

test('Not re-run when the claim cannot be judged: it is not in the pull', async () => {
  const { w, supporting } = await makePromoteWorld({ lessonStatus: 'Live' });
  const geo = supporting[0].split('::')[0];
  const file = rootFile(w, 'runs', 'pull', 'p1', 'norm', 'claims.jsonl');
  writeFileSync(file, `${readJsonl(file).rows.filter((c) => c.geo_id !== geo).map((c) => JSON.stringify(c)).join('\n')}\n`);
  const stub = liveJudge(w);
  const r = await followup(w, ['--lesson', 'LS-1', '--run-id', 'f1'], stub);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /3 Fixed, 0 Still wrong, 1 Not re-run/);
  const op = readPlan(w.root, 'f1').ops.find((o) => o.database === 'tag_decisions' && o.key === supporting[0]);
  assert.equal(op.properties['Agent follow-up'], 'Not re-run');
  assert.equal(readPlan(w.root, 'f1').ops.some((o) => o.database === 'claims' && o.key === geo), false, 'no live columns for a claim that was not judged');
  await applyPlan(w, 'f1', 'p2');
  assert.equal(w.fake.find('tag_decisions', supporting[0]).props['Agent follow-up'], 'Not re-run');
});

test('Not re-run when the judge failed on the claim\'s batches (few enough not to stop the run)', async () => {
  const { w, supporting } = await makePromoteWorld({ lessonStatus: 'Live' });
  const geo = supporting[0].split('::')[0];
  const inner = liveJudge(w);
  const stub = async (opts) => (opts.prompt.includes(`id="${geo}"`)
    ? { ok: false, errorKind: 'transient', message: 'scripted failure', text: '', costUsd: 0, durationMs: 1, modelUsage: null }
    : inner(opts));
  // one claim per batch and a higher tolerated error share, so that the run goes on with the three failed cells of that claim
  const cfg = JSON.parse(readFileSync(rootFile(w, 'config.json'), 'utf8'));
  cfg.judge.batch_size = 1;
  cfg.judge.max_error_share = 0.5;
  writeFileSync(rootFile(w, 'config.json'), JSON.stringify(cfg, null, 2));
  const r = await followup(w, ['--lesson', 'LS-1', '--run-id', 'f1'], stub);
  assert.equal(r.code, EXIT.OK, r.err.join('\n'));
  assert.match(r.out[0], /3 Fixed, 0 Still wrong, 1 Not re-run/);
  assert.match(r.err.join('\n'), /some judge cells failed; their claims show as Not re-run/);
});

// ---- the live columns -------------------------------------------------------------------------------------------------------------------------

function judgments(decisionsByTag, { sourcesCount = 2, runs = 3 } = {}) {
  const rubric = liveRubric();
  const scope = scopeOf(rubric, { scope: { code_decided_tags: ['Unsourced', 'Improperly sourced', 'Source inaccessible'], human_only_tags: ['Editor verified'], source_reading_tags: ['Improperly sourced', 'Source inaccessible'] } });
  const tagNames = [...scope.model, ...scope.coded].sort();
  const perRun = Array.from({ length: runs }, (_, i) => ({
    tags: tagNames.map((name) => {
      const spec = decisionsByTag[name];
      const d = Array.isArray(spec) ? spec[i] : spec ?? 'do_not_apply';
      return { name, decision: d, p: 0.9, rule_ref: `${name} rule 1`, reason: `Reason ${name}`, trigger: null, basis: scope.coded.includes(name) ? 'deterministic' : 'model' };
    }),
  }));
  return { perRun, tagNames, scope, polarity: new Map(rubric.tags.map((t) => [t.name, t.polarity])), sourcesCount };
}

test('liveColumns: Agent tags keep the decided tags in both directions, Readiness follows the table, Tag confidence names each tag', () => {
  const j = judgments({ Predictive: 'apply', Debate: 'apply', Simple: 'do_not_apply', Opinion: 'do_not_apply', Factual: 'apply' });
  const claim = { agent_tags: ['Opinion', 'Editor verified'], sources_count: 2 };
  const base = { claim, perRun: j.perRun, tagNames: j.tagNames, scope: j.scope, polarity: j.polarity, fixPolarities: ['Issue'], maxText: 1900 };
  const plain = liveColumns({ ...base, decidedBy: new Map() });
  assert.deepEqual(plain.agent_tags, ['Debate', 'Editor verified', 'Factual', 'Predictive'], 'tags the run does not judge stay; Opinion was dropped by the judge');
  assert.equal(plain.readiness, 'Fix needed', 'Predictive is an Issue tag and it applies');
  assert.match(plain.tag_confidence, /^Context-dependent · do not apply · 0\.90 · 3\/3 runs · Context-dependent rule 1$/m);
  assert.match(plain.tag_confidence, /^Predictive · apply · 0\.90 · 3\/3 runs · Predictive rule 1$/m);
  assert.match(plain.tag_confidence, /^Improperly sourced · not checked in this trial$/m, 'nobody reads sources yet');
  assert.match(plain.tag_confidence, /^Unsourced · do not apply · 1\.00 · 3\/3 runs · Unsourced description$/m);
  // the editor decided: Predictive does not apply (kept against the judge), Opinion applies (kept against the judge)
  const decided = liveColumns({ ...base, decidedBy: new Map([['Predictive', 'Does not apply'], ['Opinion', 'Applies']]) });
  assert.deepEqual(decided.agent_tags, ['Debate', 'Editor verified', 'Factual', 'Opinion']);
  assert.match(decided.tag_confidence, /Predictive · apply · 0\.90 · 3\/3 runs · Predictive rule 1 · editor: Does not apply \(kept\)/);
  assert.match(decided.tag_confidence, /Opinion · do not apply · .* · editor: Applies \(kept\)/);
  assert.equal(decided.readiness, 'Ready', 'the source-reading tags are not evaluated in this trial, so they do not keep a claim from being Ready');
  assert.equal(decided.states.get('Predictive'), 'do_not_apply');
  assert.equal(decided.states.get('Opinion'), 'apply');
});

test('liveColumns: a split asks the editor, the sources count decides Unsourced, an error verdict changes nothing', () => {
  const split = judgments({ Predictive: ['apply', 'do_not_apply', 'ask_editor'] });
  const base = (j, claim) => ({ claim, perRun: j.perRun, tagNames: j.tagNames, scope: j.scope, polarity: j.polarity, decidedBy: new Map(), fixPolarities: ['Issue'], maxText: 1900 });
  const asked = liveColumns(base(split, { agent_tags: [], sources_count: 3 }));
  assert.equal(asked.readiness, 'Needs editor');
  assert.equal(asked.states.get('Predictive'), 'ask_editor');
  assert.equal(asked.agent_tags.includes('Predictive'), false);
  const none = liveColumns(base(judgments({}), { agent_tags: [], sources_count: 3 }));
  assert.equal(none.readiness, 'Ready');
  assert.equal(none.states.get('Unsourced'), 'do_not_apply');
  assert.match(none.tag_confidence, /Unsourced · do not apply · 1\.00 · 3\/3 runs · Unsourced description/);
  const zero = liveColumns(base(judgments({}), { agent_tags: [], sources_count: 0 }));
  assert.equal(zero.states.get('Unsourced'), 'apply');
  assert.equal(zero.agent_tags.includes('Unsourced'), true, 'Unsourced is computed from the claim\'s own sources count, not from a cached judgment');
  assert.equal(zero.readiness, 'Fix needed');
  assert.match(zero.tag_confidence, /^Improperly sourced · do not apply · 1\.00 · 3\/3 runs · Improperly sourced description$/m, 'with no source attached there is nothing to read');
  const unknown = liveColumns(base(judgments({}), { agent_tags: [], sources_count: null }));
  assert.equal(unknown.states.get('Unsourced'), 'cannot_tell');
  assert.equal(unknown.readiness, 'Not checkable', 'the count of sources is not known');
  // an error verdict leaves the tag as it was; so does a tag nobody evaluates
  const short = judgments({ Predictive: 'apply' });
  short.perRun[2] = null;
  const kept = liveColumns({ ...base(short, { agent_tags: ['Predictive', 'Improperly sourced'], sources_count: 3 }), perRun: short.perRun });
  assert.equal(kept.states.get('Predictive'), 'error');
  assert.equal(kept.agent_tags.includes('Predictive'), true);
  assert.equal(kept.agent_tags.includes('Improperly sourced'), true, 'a tag the trial does not evaluate stays where it is');
  assert.equal(kept.readiness, 'Needs editor');
});

// ---- preconditions and failures -----------------------------------------------------------------------------------------------------------------

test('follow-up needs a Live lesson with decided supporting rows, and a pull with the Claims', async () => {
  const { w, lessonPage } = await makePromoteWorld({ lessonStatus: 'Approved' });
  let r = await followup(w, ['--lesson', 'LS-1', '--run-id', 'f1'], liveJudge(w));
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /has Status Approved|is Approved, not Live: a follow-up checks what a live lesson changed/);
  r = await followup(w, ['--lesson', 'LS-9', '--run-id', 'f1'], liveJudge(w));
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /no lesson "LS-9"/);
  w.setLessonStatus(lessonPage, 'Live');
  await w.pull('p2', ['rulebook', 'tag_decisions', 'rule_changes']);
  r = await followup(w, ['--lesson', 'LS-1', '--run-id', 'f1'], liveJudge(w));
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /pull p2 does not include claims: run pull\.mjs --dbs rulebook,claims,tag_decisions,rule_changes first/);
  // a Live lesson nobody supports
  const { w: bare } = await makePromoteWorld({ lessonStatus: 'Live' });
  bare.lesson({ title: 'Nobody supports me', tag: 'Debate', status: 'Live' });
  await bare.pull('p2');
  r = await followup(bare, ['--lesson', 'Nobody supports me', '--run-id', 'f1'], liveJudge(bare));
  assert.equal(r.code, EXIT.INVALID);
  assert.match(r.err.join('\n'), /has no decided supporting row in pull p2: nothing to follow up/);
});

test('follow-up stops when the agent is paused or the rubric drifted; the usage window and the wrong model have their exit codes', async () => {
  const { w } = await makePromoteWorld({ lessonStatus: 'Live' });
  const stub = liveJudge(w);
  writeFileSync(rootFile(w, 'runs', 'PAUSED'), '{}');
  let r = await followup(w, ['--lesson', 'LS-1', '--run-id', 'f1'], stub);
  assert.equal(r.code, EXIT.PAUSED);
  assert.equal(stub.calls.length, 0);
  const { unlinkSync } = await import('node:fs');
  unlinkSync(rootFile(w, 'runs', 'PAUSED'));
  r = await followup(w, ['--lesson', 'LS-1', '--run-id', 'f1'], liveJudge(w, { failWith: 'usage_window', failAfter: 0 }));
  assert.equal(r.code, EXIT.USAGE_WINDOW);
  assert.match(r.err.join('\n'), /the usage window ran out while judging; the finished judgments are kept\. Run the same command again/);
  assert.equal(existsSync(rootFile(w, 'runs', 'f1', 'plan.jsonl')), false);
  r = await followup(w, ['--lesson', 'LS-1', '--run-id', 'f2'], async () => ({ ok: false, errorKind: 'model_mismatch', message: 'wrong model', text: '', costUsd: 0, modelUsage: null, durationMs: 1 }));
  assert.equal(r.code, EXIT.DRIFT);
  writeFileSync(rootFile(w, 'rubric', 'rubric.lock'), '{}');
  r = await followup(w, ['--lesson', 'LS-1', '--run-id', 'f3'], liveJudge(w));
  assert.equal(r.code, EXIT.DRIFT);
});

test('a run id that was planned and applied already is refused; arguments are checked', async () => {
  const { w } = await makePromoteWorld({ lessonStatus: 'Live' });
  const stub = liveJudge(w);
  assert.equal((await followup(w, ['--lesson', 'LS-1', '--run-id', 'f1'], stub)).code, EXIT.OK);
  const again = await followup(w, ['--lesson', 'LS-1', '--run-id', 'f1'], stub);
  assert.equal(again.code, EXIT.INVALID);
  assert.match(again.err.join('\n'), /run "f1" already has a plan; pick another --run-id/);
  for (const argv of [[], ['--bogus'], ['stray'], ['--lesson'], ['--lesson', 'LS-1', '--driver', 'subagent'], ['--lesson', 'LS-1', '--run-id', 'a:b']]) {
    const c = captureIo();
    const code = await main(argv, c.io, { root: w.root });
    assert.equal(code, EXIT.INVALID, JSON.stringify(argv));
    assert.match(c.err.join('\n'), /usage: node agents\/claim-tagger\/scripts\/followup\.mjs/);
  }
  const help = captureIo();
  assert.equal(await main(['--help'], help.io, { root: w.root }), EXIT.OK);
  assert.match(help.out[0], /--lesson <lesson key or LS-n>/);
  assert.equal(loadPull(w.root, 'p1').covers('claims'), true);
});
