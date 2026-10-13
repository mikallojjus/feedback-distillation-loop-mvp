import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT } from '../agents/claim-tagger/scripts/lib/exit-codes.mjs';
import { readJson, readJsonl, writeTextAtomic } from '../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { agentRoot } from '../agents/claim-tagger/scripts/lib/paths.mjs';
import { codeDecidedTag, judgmentFileName, scopeOf, textHash } from '../agents/claim-tagger/scripts/judge.mjs';
import {
  capLines, capWords, decideVerdict, directionOf, fullNote, isLowConfidence, isoWeek, main, mergeWhy, parseArgs, priorityOf, proposalFor, readinessOf,
  recommendation, tagLine,
} from '../agents/claim-tagger/scripts/propose.mjs';

const REAL = agentRoot();
const realConfig = readJson(join(REAL, 'config.json'));
const FIXTURE_RUBRIC = new URL('./fixtures/rubric.research-example.json', import.meta.url);
const fixtureRubric = () => JSON.parse(readFileSync(FIXTURE_RUBRIC, 'utf8'));
const MODEL_TAGS = scopeOf(fixtureRubric(), realConfig).model;
const SOURCE_READING = new Set(realConfig.scope.source_reading_tags);
const ALL_TAGS = [...MODEL_TAGS, 'Improperly sourced', 'Source inaccessible', 'Unsourced'].sort();

const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-propose-'));
  roots.push(dir);
  return dir;
}
const writeJson = (path, obj) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2));
};
const writeJsonl = (path, rows) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, rows.length ? `${rows.map((r) => JSON.stringify(r)).join('\n')}\n` : '');
};

// ---- a world: judge run + judgments + a pull, all synthetic ------------------------------------------------------------------------------

const VERSION = '2026-10-13.1';
const CFG16 = 'aaaaaaaaaaaaaaaa';

/**
 * spec for a model tag: ['apply', 0.9, 'Predictive rule 1', 'reason', 'trigger'] for every run, or a list of such lists, one per run.
 * Tags without a spec are do_not_apply with p 0.95. The three code-decided tags come from the sources count unless the spec names them.
 */
function judgmentDoc({ id, text, run, spec, sources, version }) {
  const entry = (name) => {
    const v = spec[name];
    const one = v === undefined ? ['do_not_apply', 0.95] : Array.isArray(v[0]) ? v[run - 1] : v;
    const [decision, p = 0.9, ref, reason, trigger] = one;
    return {
      name, decision, p, rule_ref: ref ?? `${name} ${decision === 'apply' ? 'rule 1' : 'description'}`, rule_hash: null, trigger: trigger ?? null,
      reason: reason ?? `Reason of run ${run} for ${name}: ${decision}`, basis: 'model',
    };
  };
  const tags = MODEL_TAGS.map(entry);
  for (const name of ['Unsourced', 'Improperly sourced', 'Source inaccessible']) {
    tags.push(spec[name] ? { ...codeDecidedTag(name, sources, { sourceReading: SOURCE_READING }), ...entry(name), basis: 'deterministic' } : codeDecidedTag(name, sources, { sourceReading: SOURCE_READING }));
  }
  tags.sort((a, b) => (a.name < b.name ? -1 : 1));
  return {
    id, run, text_hash: textHash(text), status: 'ok', error: null, tags,
    config: { driver: 'fake', model: 'claude-sonnet-5-5', effort: 'medium', rubric_version: version, rubric_hash: 'sha256:b7851e23dcd3be52', scope_hash: 'sha256:5cf30ca98835c948', prompt_version: 'sha256:0', cli_version: 'unknown', config_id: `sha256:${CFG16}` },
    call: { batch: `r${run}-b01`, attempt: 1, duration_ms: 10, cost_usd: 0.01 },
  };
}

function makeWorld({ runs = 3, version = VERSION, settings = { weekly_cap: 40 }, configEdit, rulebook = 'fixture', metaEdit } = {}) {
  const dir = tmp();
  const cfg = structuredClone(realConfig);
  configEdit?.(cfg);
  writeJson(join(dir, 'config.json'), cfg);
  mkdirSync(join(dir, 'schemas'), { recursive: true });
  cpSync(join(REAL, 'schemas', 'judgment.schema.json'), join(dir, 'schemas', 'judgment.schema.json'));
  const rubric = fixtureRubric();
  writeJson(join(dir, 'rubric', 'rubric.json'), rubric);
  const world = {
    dir, runsDir: join(dir, 'runs'), runs, version, claims: [], queue: [], items: [], settings, judgeRunId: 'j1',
    polarity: rubric.tags.map((t) => ({ name: t.name, polarity: t.polarity })),
  };

  world.addClaim = (id, { text = `Claim ${id} says something specific happens`, sources = 2, agentTags = [], readiness = null, tagConfidence = null, lastJudged = null, spec = {}, missingRuns = [], errorRuns = [] } = {}) => {
    world.claims.push({ geo_id: id, page_id: `claim-page-${id}`, claim: text, sources_count: sources, agent_tags: agentTags, readiness, tag_confidence: tagConfidence, last_judged: lastJudged });
    world.items.push({ id, text_hash: textHash(text) });
    for (let run = 1; run <= runs; run++) {
      if (missingRuns.includes(run)) continue;
      const doc = judgmentDoc({ id, text, run, spec, sources, version });
      if (errorRuns.includes(run)) Object.assign(doc, { status: 'error', error: 'schema: broken', tags: [] });
      writeJson(join(world.runsDir, 'judgments', CFG16, `run-${run}`, judgmentFileName(id, doc.text_hash)), doc);
    }
    return world;
  };
  world.addRow = (geoId, tag, over = {}) => {
    world.queue.push({
      key: `${geoId}::${tag}`, page_id: `row-page-${geoId}-${tag}`, geo_id: geoId, tag, effective_outcome: null, tag_outcome: null, seeded_outcome: null, why_in_queue: 'Auditor flag', rubric_version: 'audit 2026-10-09 (before rubric)',
      agent_proposal: null, agent_confidence: null, why_i_recommend_this: null, agent_full_note: null, priority: null, ...over,
    });
    return world;
  };
  world.write = (pullId = 'p1') => {
    const norm = join(world.runsDir, 'pull', pullId, 'norm');
    writeJsonl(join(norm, 'claims.jsonl'), world.claims);
    writeJsonl(join(norm, 'queue.jsonl'), world.queue);
    writeJson(join(norm, 'settings.json'), world.settings);
    if (rulebook === 'fixture') writeJson(join(norm, 'rulebook.json'), world.polarity);
    writeJson(join(world.runsDir, world.judgeRunId, 'run.json'), {
      run_id: world.judgeRunId, kind: 'judge', items_source: 'claims', config_id: `sha256:${CFG16}`, rubric_version: version, runs,
      counts: { done: 0, error: 0, stopped: 0, skipped: 0 }, cost_usd: 0, started: 'x', finished: 'y', status: 'done', rubric_path: join(dir, 'rubric', 'rubric.json'), items: world.items,
      ...(metaEdit ?? {}),
    });
    return world;
  };
  return world;
}

// The shape of scripts/plan.mjs openPlan(): create(db, key, properties, opts), update(db, key, pageId, properties, opts), write().
function fakePlanner({ refuse } = {}) {
  const planner = { ops: [], args: null, written: null };
  planner.factory = async (args) => {
    planner.args = args;
    const check = (database, key, properties) => {
      const why = refuse?.(database, key, properties);
      if (why) throw new Error(why);
    };
    return {
      create(database, key, properties, opts = {}) {
        check(database, key, properties);
        planner.ops.push({ op: 'create', database, key, pageId: null, properties, opts });
      },
      update(database, key, pageId, properties, opts = {}) {
        check(database, key, properties);
        planner.ops.push({ op: 'update', database, key, pageId, properties, opts });
      },
      write() {
        const path = join(args.root, 'runs', args.runId, 'plan.jsonl');
        const lines = [{ op: 'header', plan_id: `plan-${args.runId}`, run_id: args.runId, created_at: 'now' }, ...planner.ops.map((o, i) => ({ ...o, seq: i + 1 }))];
        writeTextAtomic(path, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
        planner.written = path;
        return { path };
      },
    };
  };
  return planner;
}

const NOW = new Date('2026-10-14T10:00:00Z');
async function propose(world, { pull = 'p1', outRun = 'o1', now = NOW, planner = fakePlanner(), run = world.judgeRunId, extraArgs = [] } = {}) {
  const out = [];
  const err = [];
  const code = await main(['--run', run, '--pull', pull, '--out-run', outRun, ...extraArgs], { out: (s) => out.push(s), err: (s) => err.push(s) }, { agentDir: world.dir, now: () => now, planFactory: planner.factory });
  const summaryFile = join(world.runsDir, outRun, 'propose.json');
  return { code, out, err, ops: planner.ops, planner, summary: existsSync(summaryFile) ? readJson(summaryFile) : null };
}

const snake = (name) => name.toLowerCase().replace(/ /g, '_');
// Apply the ops of a plan to the world, as a pull taken after the apply would show them.
function applyOps(world, ops) {
  for (const op of ops) {
    const props = {};
    for (const [k, v] of Object.entries(op.properties)) {
      if (['Claim', 'Tag'].includes(k)) continue;
      props[snake(k)] = k === 'Agent tags' ? v.map((x) => x.rulebook) : v;
    }
    if (op.database === 'claims') Object.assign(world.claims.find((c) => c.geo_id === op.key), props);
    else if (op.op === 'update') Object.assign(world.queue.find((r) => r.key === op.key), props);
    else {
      const [geoId, tag] = op.key.split('::');
      assert.deepEqual(op.properties.Claim, [{ claims: geoId }]);
      assert.deepEqual(op.properties.Tag, [{ rulebook: tag }]);
      world.queue.push({ key: op.key, geo_id: geoId, tag, effective_outcome: null, tag_outcome: null, seeded_outcome: null, agent_confidence: null, ...props });
    }
  }
}

const opFor = (ops, database, key, kind) => ops.find((o) => o.database === database && o.key === key && (!kind || o.op === kind));
const r = (decision, p, ref = 'X rule 1', reason = 'because') => ({ decision, p, rule_ref: ref, reason, trigger: null });

// ---- verdicts ----------------------------------------------------------------------------------------------------------------------------------

test('verdict: more than half of the runs decide, otherwise ask_editor, any missing run is an error', () => {
  const v = (list, n = list.length) => decideVerdict(list, n);
  const A = (p = 0.9) => r('apply', p);
  const D = (p = 0.9) => r('do_not_apply', p);
  const E = (p = 0.5) => r('ask_editor', p);
  const C = () => r('cannot_tell', null);

  assert.deepEqual([v([A(), A(), A()]).decision, v([A(), A(), A()]).k, v([A(), A(), A()]).unanimous], ['apply', 3, true]);
  assert.deepEqual([v([A(), A(), D()]).decision, v([A(), A(), D()]).k, v([A(), A(), D()]).unanimous], ['apply', 2, false]);
  assert.equal(v([A(), D(), D()]).decision, 'do_not_apply');
  assert.equal(v([D(), D(), E()]).decision, 'do_not_apply');
  assert.equal(v([C(), C(), A()]).decision, 'cannot_tell');
  assert.equal(v([E(), E(), A()]).decision, 'ask_editor');
  assert.equal(v([E(), E(), A()]).k, 2);

  const split = v([A(), D(), E()]);
  assert.deepEqual([split.decision, split.split, split.unanimous, split.k], ['ask_editor', true, false, 1], '1/1/1 is a split');
  assert.equal(v([A(), A(), D()]).split, false);

  assert.equal(v([A()]).decision, 'apply', 'one run');
  assert.equal(v([A(), D()]).decision, 'ask_editor', 'two runs that disagree have no majority');
  assert.equal(v([A(), A()]).decision, 'apply');
  assert.equal(v([A(), A(), A(), D(), D()]).decision, 'apply', 'three of five');
  assert.equal(v([A(), A(), D(), D()]).decision, 'ask_editor', 'two of four is not more than half');
  assert.equal(v([A(), A(), D(), D(), E()]).decision, 'ask_editor', 'two of five');

  const missing = v([A(), null, A()], 3);
  assert.deepEqual([missing.decision, missing.k, missing.n], ['error', 2, 3]);
  assert.equal(v([null, null, null], 3).decision, 'error');
  assert.equal(v([], 0).decision, 'error');
  assert.equal(v([A(), A()], 3).decision, 'error', 'fewer runs than expected');
});

test('verdict: mean p over the runs that gave the verdict (all valid runs when there is no majority), two decimals', () => {
  const v = (list) => decideVerdict(list, list.length);
  assert.equal(v([r('apply', 0.9), r('apply', 0.7), r('do_not_apply', 0.2)]).meanP, 0.8);
  assert.equal(v([r('apply', 0.9), r('do_not_apply', 0.9), r('ask_editor', 0.5)]).meanP, 0.77);
  assert.equal(v([r('apply', 0.61), r('apply', 0.62), r('apply', 0.62)]).meanP, 0.62);
  assert.equal(v([r('cannot_tell', null), r('cannot_tell', null), r('cannot_tell', null)]).meanP, null);
  assert.equal(v([r('apply', null), r('apply', 0.8), r('apply', null)]).meanP, 0.8, 'null p is left out of the mean');
  assert.equal(decideVerdict([r('apply', 0.9), null, r('apply', 0.5)], 3).meanP, 0.7, 'an error verdict still reports the mean of what ran');
});

test('verdict: rule reference = the most common among the agreeing runs, reason = the first one', () => {
  const v = decideVerdict([r('apply', 0.9, 'P rule 2', 'first reason'), r('apply', 0.9, 'P rule 1', 'second'), r('apply', 0.9, 'P rule 1', 'third')], 3);
  assert.equal(v.ruleRef, 'P rule 1');
  assert.equal(v.reason, 'first reason');
  const tie = decideVerdict([r('apply', 0.9, 'P rule 2', 'a'), r('apply', 0.9, 'P rule 1', 'b')], 2);
  assert.equal(tie.ruleRef, 'P rule 2', 'a tie keeps the earlier run');
  const outvoted = decideVerdict([r('do_not_apply', 0.9, 'P description', 'no'), r('apply', 0.9, 'P rule 1', 'yes'), r('apply', 0.9, 'P rule 1', 'yes again')], 3);
  assert.equal(outvoted.reason, 'yes', 'the reason comes from a run that gave the verdict');
  assert.equal(outvoted.applyCount, 2);
});

test('proposal wording, direction, low confidence, reasons and priorities as small functions', () => {
  const v = (decision, meanP, extra = {}) => ({ decision, meanP, unanimous: true, split: false, ...extra });
  assert.equal(proposalFor(v('apply', 0.9), { current: false }), 'Add tag');
  assert.equal(proposalFor(v('apply', 0.9), { current: true }), 'Keep tag');
  assert.equal(proposalFor(v('do_not_apply', 0.9), { current: false }), 'Do not add tag');
  assert.equal(proposalFor(v('do_not_apply', 0.9), { current: true }), 'Remove tag');
  assert.equal(proposalFor(v('ask_editor', 0.5), { current: false }), 'Add tag');
  assert.equal(proposalFor(v('ask_editor', 0.49), { current: false }), 'Do not add tag');
  assert.equal(proposalFor(v('ask_editor', null), { current: true }), 'Do not add tag');
  assert.equal(proposalFor(v('error', 0.8), { current: false }), 'Add tag');
  assert.equal(proposalFor(v('error', null), { current: false }), 'Do not add tag');
  // the runs that took a side decide the lean; p is the confidence in the run's own decision
  const sided = (...runs) => v('ask_editor', 0.55, { runs });
  assert.equal(proposalFor(sided(r('ask_editor', 0.5), r('ask_editor', 0.6), r('do_not_apply', 0.9)), { current: false }), 'Do not add tag');
  assert.equal(proposalFor(sided(r('ask_editor', 0.5), r('ask_editor', 0.4), r('apply', 0.8)), { current: false }), 'Add tag');
  assert.equal(proposalFor(v('error', 0.95, { runs: [r('do_not_apply', 0.95), null, r('do_not_apply', 0.95)] }), { current: false }), 'Do not add tag', 'two runs said no: not "Add tag" just because p is high');
  assert.equal(proposalFor(v('error', 0.9, { runs: [r('apply', 0.9), null, r('apply', 0.9)] }), { current: false }), 'Add tag');
  assert.equal(proposalFor(sided(r('ask_editor', 0.6), r('ask_editor', 0.6), r('ask_editor', 0.6)), { current: false }), 'Add tag', "nobody took a side: the plan's mean p rule");
  assert.equal(proposalFor(sided(r('apply', 0.9), r('do_not_apply', 0.9), r('ask_editor', 0.5)), { current: false }), 'Add tag', 'a tie at 0.5 leans to adding');
  assert.equal(proposalFor(v('cannot_tell', null), { current: false, sourceReading: true }), 'Read source first');
  assert.equal(proposalFor(v('cannot_tell', 0.7), { current: false, sourceReading: false }), 'Add tag');
  assert.deepEqual(['Add tag', 'Keep tag', 'Do not add tag', 'Remove tag', 'Read source first', undefined].map(directionOf), ['apply', 'apply', 'not', 'not', null, null]);

  const low = (verdict, sourceReading = false) => isLowConfidence(verdict, { sourceReading, tSkip: 0.25, tApply: 0.75 });
  assert.equal(low(v('apply', 0.9)), false);
  assert.equal(low(v('apply', 0.75)), false, 'the thresholds themselves are confident');
  assert.equal(low(v('apply', 0.7499)), true);
  assert.equal(low(v('do_not_apply', 0.25)), false);
  assert.equal(low(v('do_not_apply', 0.26)), true);
  assert.equal(low(v('apply', 0.9, { unanimous: false })), true, 'runs disagree');
  assert.equal(low(v('ask_editor', 0.9)), true);
  assert.equal(low(v('error', null)), true);
  assert.equal(low(v('cannot_tell', null), true), false, 'a source-reading tag that cannot be told is not "low confidence"');
  assert.equal(low(v('cannot_tell', null), false), true);
  assert.equal(low(v('apply', null)), false);

  assert.equal(mergeWhy('Auditor flag', 'Low confidence'), 'Low confidence');
  assert.equal(mergeWhy('Low confidence', 'Rule changed'), 'Rule changed');
  assert.equal(mergeWhy('Rule changed', 'Low confidence'), 'Rule changed', 'a reason is never weakened');
  assert.equal(mergeWhy('Editor challenge', 'Low confidence'), 'Editor challenge');
  assert.equal(mergeWhy('Auditor flag', null), 'Auditor flag');
  assert.equal(mergeWhy(null, 'Low confidence'), 'Low confidence');
  assert.equal(mergeWhy(null, null), null);

  const prio = (over) => priorityOf({ proposal: 'Add tag', why: 'Low confidence', verdict: v('ask_editor', 0.6), polarity: 'Issue', fixPolarities: ['Issue'], ...over });
  assert.equal(prio({}), 'High', 'low confidence leaning apply on an Issue tag');
  assert.equal(prio({ polarity: 'Classification' }), 'Medium');
  assert.equal(prio({ proposal: 'Do not add tag' }), 'Medium');
  assert.equal(prio({ proposal: 'Remove tag' }), 'Medium');
  assert.equal(prio({ why: 'Rule changed', proposal: 'Remove tag', polarity: 'Classification' }), 'High');
  assert.equal(prio({ polarity: 'Classification', verdict: v('ask_editor', 0.4, { split: true }), proposal: 'Do not add tag' }), 'High', '1/1/1 split');
  assert.equal(prio({ proposal: 'Read source first', why: 'Rule changed' }), 'Check source');
  assert.equal(prio({ why: 'Auditor flag' }), 'Medium');
});

test('readiness: needs editor, then fix needed, then not checkable, then ready; tags the trial does not evaluate never count', () => {
  const polarityOf = (t) => ({ Predictive: 'Issue', Hypothetical: 'Issue', Opinion: 'Classification', 'Improperly sourced': 'Issue', 'Source inaccessible': 'Issue', Unsourced: 'Issue' }[t]);
  const ready = (states, ignored = []) => readinessOf(new Map(Object.entries(states)), { polarityOf, fixPolarities: ['Issue'], ignored: new Set(ignored) });
  assert.equal(ready({ Opinion: 'apply', Predictive: 'do_not_apply' }), 'Ready');
  assert.equal(ready({ Opinion: 'ask_editor' }), 'Needs editor');
  assert.equal(ready({ Opinion: 'error' }), 'Needs editor');
  assert.equal(ready({ Predictive: 'apply', Opinion: 'ask_editor' }), 'Needs editor', 'needs editor beats fix needed');
  assert.equal(ready({ Opinion: 'ask_editor', Unsourced: 'cannot_tell' }), 'Needs editor', 'and not checkable');
  assert.equal(ready({ Predictive: 'apply' }), 'Fix needed');
  assert.equal(ready({ Unsourced: 'apply' }), 'Fix needed', 'the code-decided Unsourced counts');
  assert.equal(ready({ Opinion: 'apply' }), 'Ready', 'a Classification tag applying is not a problem');
  assert.equal(ready({ Predictive: 'apply', Opinion: 'cannot_tell' }), 'Fix needed', 'fix needed beats not checkable');
  assert.equal(ready({ Opinion: 'cannot_tell' }), 'Not checkable', 'a model-judged tag nobody could tell');
  assert.equal(ready({ Unsourced: 'cannot_tell' }), 'Not checkable', 'Unsourced when the sources count is unknown');
  assert.equal(ready({ Unsourced: 'do_not_apply', Opinion: 'apply' }), 'Ready');
  assert.equal(ready({}), 'Ready');

  // tags this trial does not evaluate (code-decided, basis no_source_text) never count, whatever their state
  const unchecked = ['Improperly sourced', 'Source inaccessible'];
  assert.equal(ready({ 'Improperly sourced': 'cannot_tell', 'Source inaccessible': 'cannot_tell' }, unchecked), 'Ready');
  assert.equal(ready({ 'Improperly sourced': 'cannot_tell', Opinion: 'apply' }, unchecked), 'Ready');
  assert.equal(ready({ 'Improperly sourced': 'apply' }, unchecked), 'Ready');
  assert.equal(ready({ 'Improperly sourced': 'apply' }), 'Fix needed', 'the same state does count when the tag is evaluated');
  assert.equal(ready({ 'Improperly sourced': 'cannot_tell', Opinion: 'cannot_tell' }, unchecked), 'Not checkable', 'a model-judged tag still counts next to them');
  assert.equal(ready({ 'Improperly sourced': 'cannot_tell', Unsourced: 'cannot_tell' }, unchecked), 'Not checkable');
  assert.equal(ready({ 'Improperly sourced': 'cannot_tell', Predictive: 'apply' }, unchecked), 'Fix needed');
});

// ---- text helpers --------------------------------------------------------------------------------------------------------------------------------

test('text: tag line, full note, recommendation (at most 40 words, k of n runs applied it), caps', () => {
  const verdict = decideVerdict([r('apply', 0.9, 'Predictive rule 1', 'It is flatly stated.'), r('apply', 0.8, 'Predictive rule 1', 'x'), r('do_not_apply', 0.6, 'Predictive description', 'y')], 3);
  assert.equal(tagLine('Predictive', verdict, null), 'Predictive · apply · 0.85 · 2/3 runs · Predictive rule 1');
  assert.equal(tagLine('Predictive', verdict, 'Does not apply'), 'Predictive · apply · 0.85 · 2/3 runs · Predictive rule 1 · editor: Does not apply (kept)');
  const none = decideVerdict([r('cannot_tell', null, 'Improperly sourced description', 'No source read.'), r('cannot_tell', null, 'Improperly sourced description'), r('cannot_tell', null, 'Improperly sourced description')], 3);
  assert.equal(tagLine('Improperly sourced', none, null), 'Improperly sourced · cannot tell · - · 3/3 runs · Improperly sourced description');
  assert.equal(none.unchecked, false, 'a verdict whose entries carry no basis is a model verdict');
  // a tag nobody evaluates in this trial: every entry has the basis no_source_text
  const withBasis = (basis, ...entries) => decideVerdict(entries.map((e) => ({ ...e, basis })), entries.length);
  const unchecked = withBasis('no_source_text', r('cannot_tell', null, 'Improperly sourced description'), r('cannot_tell', null, 'Improperly sourced description'), r('cannot_tell', null, 'Improperly sourced description'));
  assert.equal(unchecked.unchecked, true);
  assert.equal(tagLine('Improperly sourced', unchecked, null), 'Improperly sourced · not checked in this trial');
  assert.equal(tagLine('Improperly sourced', unchecked, 'Applies'), 'Improperly sourced · not checked in this trial · editor: Applies (kept)');
  const nothingToSource = withBasis('deterministic', r('do_not_apply', 1, 'Improperly sourced description'), r('do_not_apply', 1, 'Improperly sourced description'), r('do_not_apply', 1, 'Improperly sourced description'));
  assert.equal(nothingToSource.unchecked, false, 'no sources at all is decided by code, and said so');
  assert.equal(tagLine('Improperly sourced', nothingToSource, null), 'Improperly sourced · do not apply · 1.00 · 3/3 runs · Improperly sourced description');
  assert.equal(withBasis('no_source_text', r('cannot_tell', null)).unchecked, true);
  assert.equal(decideVerdict([{ ...r('cannot_tell', null), basis: 'no_source_text' }, { ...r('apply', 0.9), basis: 'model' }], 2).unchecked, false, 'only when every entry says so');
  assert.equal(tagLine('Opinion', decideVerdict([r('apply', 0.9), null, r('apply', 0.9)], 3), null), 'Opinion · error · 0.90 · 2/3 runs · -');

  assert.equal(recommendation(verdict), 'It is flatly stated; 2 of 3 runs applied it');
  const dont = decideVerdict([r('do_not_apply', 0.9, 'P d', 'No marker is present.'), r('do_not_apply', 0.9), r('do_not_apply', 0.9)], 3);
  assert.equal(recommendation(dont), 'No marker is present; 0 of 3 runs applied it');
  const long = decideVerdict([r('apply', 0.9, 'P rule 1', Array.from({ length: 80 }, (_, i) => `word${i}`).join(' '))], 1);
  const text = recommendation(long, 40);
  assert.ok(text.split(/\s+/).length <= 40, text);
  assert.match(text, /\.\.\.; 1 of 1 runs applied it$/);
  assert.match(recommendation(decideVerdict([r('apply', 0.9, 'a', '')], 1)), /^The runs gave no reason; 1 of 1 runs applied it$/);
  assert.match(recommendation(decideVerdict([r('apply', 0.9), null, null], 3)), /^No valid answer from 2 of 3 judge runs/);

  const note = fullNote(decideVerdict([{ ...r('apply', 0.9, 'Predictive rule 1', 'Flat will.'), trigger: 'will grow' }, null, r('do_not_apply', 0.4, 'Predictive description', 'Hedged.')], 3), { judgeRun: 'j1', version: VERSION, maxText: 1900 });
  assert.match(note, /^Judge run j1 · rubric 2026-10-13\.1 · verdict error \(2\/3 runs\)\n/);
  assert.match(note, /\nRun 1: apply · p 0\.90 · Predictive rule 1 · trigger "will grow" · Flat will\.\n/);
  assert.match(note, /\nRun 2: no valid answer\n/);
  assert.match(note, /\nRun 3: do not apply · p 0\.40 · Predictive description · Hedged\.$/);

  assert.equal(capWords('one two three four', 3), 'one two three...');
  assert.equal(capWords('one two', 3), 'one two');
  assert.equal(capWords('x', 0), '');
  const lines = Array.from({ length: 10 }, (_, i) => `line number ${i} of the text`);
  const capped = capLines(lines, 60);
  assert.ok(capped.length <= 60, `${capped.length}`);
  assert.match(capped, /\n\.\.\.$/);
  assert.equal(capLines(lines, 10000), lines.join('\n'));
  assert.equal(capLines(['short'], 10), 'short');
});

test('isoWeek', () => {
  assert.equal(isoWeek(new Date('2026-10-14T10:00:00Z')), '2026-W42');
  assert.equal(isoWeek(new Date('2026-10-12T00:00:00Z')), '2026-W42', 'Monday');
  assert.equal(isoWeek(new Date('2026-10-18T23:59:59Z')), '2026-W42', 'Sunday');
  assert.equal(isoWeek(new Date('2026-10-19T00:00:00Z')), '2026-W43');
  assert.equal(isoWeek(new Date('2027-01-01T12:00:00Z')), '2026-W53');
  assert.equal(isoWeek(new Date('2024-12-30T12:00:00Z')), '2025-W01');
});

test('arguments', async () => {
  assert.throws(() => parseArgs([]), /--run is required/);
  assert.throws(() => parseArgs(['--run', 'a']), /--pull is required/);
  assert.throws(() => parseArgs(['--run', 'a', '--pull', 'b', '--out-run', 'x:y']), /--out-run/);
  assert.throws(() => parseArgs(['--run', 'a', '--pull', 'b', '--x']), /unknown argument/);
  assert.deepEqual(parseArgs(['--run', 'a', '--pull', 'b', '--out-run', 'c']), { help: false, run: 'a', pull: 'b', outRun: 'c' });
  const err = [];
  assert.equal(await main([], { out() {}, err: (s) => err.push(s) }), EXIT.INVALID);
  assert.match(err.join('\n'), /usage: node agents\/claim-tagger\/scripts\/propose\.mjs --run/);
});

// ---- the whole thing -----------------------------------------------------------------------------------------------------------------------------

test('a claim with mixed verdicts: the claim update and one queue row per uncertain tag, with Why in queue, Priority and proposal wording', async () => {
  const world = makeWorld();
  world.addClaim('A1', {
    sources: 2,
    spec: {
      Predictive: [['apply', 0.9, 'Predictive rule 1', 'It is flatly stated', 'will grow'], ['apply', 0.8, 'Predictive rule 1', 'run two'], ['do_not_apply', 0.6]],
      Hypothetical: [['ask_editor', 0.5], ['ask_editor', 0.6], ['ask_editor', 0.55]],
      Factual: [['ask_editor', 0.3], ['ask_editor', 0.4], ['ask_editor', 0.35]],
      Opinion: [['apply', 0.9], ['do_not_apply', 0.9], ['ask_editor', 0.5]],
      Simple: ['apply', 0.74],
      Debate: ['apply', 0.75],
      'Multiple statements': ['do_not_apply', 0.25],
      'Single core statement': ['do_not_apply', 0.26],
    },
  });
  world.write();
  const res = await propose(world);
  assert.equal(res.code, EXIT.OK, res.err.join('\n'));

  // the claim
  const claimOp = opFor(res.ops, 'claims', 'A1');
  assert.equal(claimOp.op, 'update');
  assert.deepEqual(Object.keys(claimOp.properties).sort(), ['Agent tags', 'Last judged', 'Readiness', 'Tag confidence']);
  assert.deepEqual(claimOp.properties['Agent tags'], [{ rulebook: 'Debate' }, { rulebook: 'Predictive' }, { rulebook: 'Simple' }]);
  assert.equal(claimOp.properties.Readiness, 'Needs editor');
  assert.equal(claimOp.properties['Last judged'], '2026-10-13.1 · j1');
  const lines = claimOp.properties['Tag confidence'].split('\n');
  assert.equal(lines.length, 13, 'one line per tag');
  assert.deepEqual(lines.map((l) => l.split(' · ')[0]), ALL_TAGS);
  assert.ok(lines.includes('Predictive · apply · 0.85 · 2/3 runs · Predictive rule 1'));
  assert.ok(lines.includes('Hypothetical · ask editor · 0.55 · 3/3 runs · Hypothetical description'));
  assert.ok(lines.includes('Opinion · ask editor · 0.77 · 1/3 runs · Opinion description') || lines.some((l) => l.startsWith('Opinion · ask editor · 0.77 · 1/3 runs')));
  assert.ok(lines.includes('Unsourced · do not apply · 1.00 · 3/3 runs · Unsourced description'));
  assert.ok(lines.includes('Improperly sourced · not checked in this trial'));
  assert.ok(lines.includes('Source inaccessible · not checked in this trial'));
  assert.ok(claimOp.properties['Tag confidence'].length <= 1900);

  // the rows
  const rowOps = res.ops.filter((o) => o.database === 'tag_decisions');
  assert.deepEqual(rowOps.map((o) => o.key).sort(), ['A1::Factual', 'A1::Hypothetical', 'A1::Opinion', 'A1::Predictive', 'A1::Simple', 'A1::Single core statement']);
  assert.ok(rowOps.every((o) => o.op === 'create'));
  const row = (tag) => opFor(res.ops, 'tag_decisions', `A1::${tag}`).properties;

  const predictive = row('Predictive');
  assert.deepEqual(Object.keys(predictive).sort(), ['Agent confidence', 'Agent full note', 'Agent proposal', 'Claim', 'Priority', 'Rubric version', 'Tag', 'Why I recommend this', 'Why in queue'].sort(), 'the builder adds the Key itself');
  assert.deepEqual(predictive.Claim, [{ claims: 'A1' }]);
  assert.deepEqual(predictive.Tag, [{ rulebook: 'Predictive' }]);
  assert.equal(predictive['Agent proposal'], 'Add tag');
  assert.equal(predictive['Agent confidence'], 0.85);
  assert.equal(predictive['Why in queue'], 'Low confidence');
  assert.equal(predictive.Priority, 'High', 'low confidence leaning apply on an Issue tag');
  assert.equal(predictive['Rubric version'], VERSION);
  assert.equal(predictive['Why I recommend this'], 'It is flatly stated; 2 of 3 runs applied it');
  assert.match(predictive['Agent full note'], /^Judge run j1 · rubric 2026-10-13\.1 · verdict apply \(2\/3 runs\)\nRun 1: apply · p 0\.90 · Predictive rule 1 · trigger "will grow" · It is flatly stated\nRun 2: apply · p 0\.80/);
  assert.match(predictive['Agent full note'], /\nRun 3: do not apply · p 0\.60 · Predictive description/);

  assert.deepEqual([row('Hypothetical')['Agent proposal'], row('Hypothetical').Priority, row('Hypothetical')['Agent confidence']], ['Add tag', 'High', 0.55]);
  assert.deepEqual([row('Factual')['Agent proposal'], row('Factual').Priority, row('Factual')['Agent confidence']], ['Do not add tag', 'Medium', 0.35]);
  assert.deepEqual([row('Opinion')['Agent proposal'], row('Opinion').Priority], ['Add tag', 'High'], 'a 1/1/1 split is High even on a Classification tag');
  assert.deepEqual([row('Simple')['Agent proposal'], row('Simple').Priority, row('Simple')['Why in queue']], ['Add tag', 'Medium', 'Low confidence'], 'p in the middle band, Classification tag');
  assert.deepEqual([row('Single core statement')['Agent proposal'], row('Single core statement').Priority], ['Do not add tag', 'Medium']);
  assert.equal(opFor(res.ops, 'tag_decisions', 'A1::Debate'), undefined, 'p exactly at t_apply is confident');
  assert.equal(opFor(res.ops, 'tag_decisions', 'A1::Multiple statements'), undefined, 'p exactly at t_skip is confident');

  assert.deepEqual(res.summary.readiness_counts, { 'Needs editor': 1, 'Fix needed': 0, 'Not checkable': 0, Ready: 0 });
  assert.equal(res.summary.rows_created, 6);
  assert.equal(res.summary.claims_updated, 1);
  assert.deepEqual(res.summary.by_why_in_queue, { 'Low confidence': 6 });
  assert.match(res.out.join('\n'), /^propose: claims=1 claims_updated=1 rows_created=6 rows_updated=0 held_by_cap=0/);
  assert.equal(res.planner.args.runId, 'o1');
  assert.equal(res.planner.args.sourcePull, 'p1');
  assert.equal(res.planner.args.root, world.dir);
  assert.equal(res.planner.written, join(world.runsDir, 'o1', 'plan.jsonl'));
  assert.equal(claimOp.pageId, 'claim-page-A1', 'the page id of the pulled row is passed on');
  assert.equal(claimOp.opts.guard, undefined);
  assert.deepEqual(opFor(res.ops, 'tag_decisions', 'A1::Predictive').opts, { guard: { undecided: true } }, 'creates skip a row an editor got to first');
  assert.equal(readJsonl(join(world.runsDir, 'o1', 'plan.jsonl')).rows.length, 1 + res.ops.length, 'the plan file: a header and the ops');
});

test('readiness table end to end: the sources nobody reads in this trial do not make a claim Not checkable', async () => {
  const world = makeWorld();
  world.addClaim('needs-ask', { spec: { Opinion: ['ask_editor', 0.5] } });
  world.addClaim('needs-error', { missingRuns: [3] });
  world.addClaim('needs-beats-fix', { spec: { Predictive: ['apply', 0.9], Opinion: ['ask_editor', 0.5] } });
  world.addClaim('needs-beats-not-checkable', { sources: null, spec: { Opinion: ['ask_editor', 0.5] } });
  world.addClaim('fix', { spec: { Predictive: ['apply', 0.9] } });
  world.addClaim('fix-unsourced', { sources: 0 });
  world.addClaim('fix-beats-not-checkable', { sources: null, spec: { Predictive: ['apply', 0.9] } });
  world.addClaim('not-checkable-model', { spec: { Factual: ['cannot_tell', null] } });
  world.addClaim('not-checkable-count', { sources: null });
  world.addClaim('ready-sourced', { sources: 3 });
  world.addClaim('ready', { spec: { Factual: ['apply', 0.9] } });
  world.write();
  const res = await propose(world);
  assert.equal(res.code, EXIT.OK, res.err.join('\n'));
  const readiness = Object.fromEntries(world.claims.map((c) => [c.geo_id, opFor(res.ops, 'claims', c.geo_id).properties.Readiness]));
  assert.deepEqual(readiness, {
    'needs-ask': 'Needs editor', 'needs-error': 'Needs editor', 'needs-beats-fix': 'Needs editor', 'needs-beats-not-checkable': 'Needs editor',
    fix: 'Fix needed', 'fix-unsourced': 'Fix needed', 'fix-beats-not-checkable': 'Fix needed',
    'not-checkable-model': 'Not checkable', 'not-checkable-count': 'Not checkable',
    'ready-sourced': 'Ready', ready: 'Ready',
  });
  assert.deepEqual(res.summary.readiness_counts, { 'Needs editor': 4, 'Fix needed': 3, 'Not checkable': 2, Ready: 2 });
  // the Unsourced tag of a claim with no sources is applied, so it is in Agent tags
  assert.deepEqual(opFor(res.ops, 'claims', 'fix-unsourced').properties['Agent tags'], [{ rulebook: 'Unsourced' }]);

  // what the editor reads in Tag confidence for the two source-reading tags
  const lines = (id) => opFor(res.ops, 'claims', id).properties['Tag confidence'].split('\n');
  for (const id of ['ready-sourced', 'not-checkable-count', 'needs-error']) {
    assert.ok(lines(id).includes('Improperly sourced · not checked in this trial'), id);
    assert.ok(lines(id).includes('Source inaccessible · not checked in this trial'), id);
  }
  assert.ok(lines('ready-sourced').includes('Unsourced · do not apply · 1.00 · 3/3 runs · Unsourced description'), 'Unsourced is checked, from the count');
  assert.ok(lines('not-checkable-count').includes('Unsourced · cannot tell · - · 3/3 runs · Unsourced description'));
  // with no sources at all the code does decide them: nothing to source
  assert.ok(lines('fix-unsourced').includes('Improperly sourced · do not apply · 1.00 · 3/3 runs · Improperly sourced description'));
  assert.ok(lines('fix-unsourced').includes('Source inaccessible · do not apply · 1.00 · 3/3 runs · Source inaccessible description'));
});

test('a tag the trial does not evaluate stays on the claim and never decides Readiness, but an editor decision on it counts', async () => {
  const world = makeWorld();
  world.addClaim('N1', { sources: 2, agentTags: ['Improperly sourced'] });
  world.addClaim('N2', { sources: 2 });
  world.addRow('N2', 'Improperly sourced', { effective_outcome: 'Applies', tag_outcome: 'Applies', why_in_queue: 'Auditor flag' });
  world.addClaim('N3', { sources: 2 });
  world.addRow('N3', 'Source inaccessible', { effective_outcome: 'Does not apply', seeded_outcome: 'Does not apply', why_in_queue: 'Seeded decision' });
  world.write();
  const res = await propose(world);
  assert.equal(res.code, EXIT.OK, res.err.join('\n'));

  const n1 = opFor(res.ops, 'claims', 'N1').properties;
  assert.equal(n1['Agent tags'], undefined, 'nothing was checked, so the old tagger\'s tag is not taken away');
  assert.equal(n1.Readiness, 'Ready');
  assert.ok(n1['Tag confidence'].split('\n').includes('Improperly sourced · not checked in this trial'));

  const n2 = opFor(res.ops, 'claims', 'N2').properties;
  assert.deepEqual(n2['Agent tags'], [{ rulebook: 'Improperly sourced' }], 'the editor said it applies');
  assert.equal(n2.Readiness, 'Fix needed', 'a decided tag is not "not evaluated"');
  assert.ok(n2['Tag confidence'].split('\n').includes('Improperly sourced · not checked in this trial · editor: Applies (kept)'));

  const n3 = opFor(res.ops, 'claims', 'N3').properties;
  assert.equal(n3.Readiness, 'Ready');
  assert.ok(n3['Tag confidence'].split('\n').includes('Source inaccessible · not checked in this trial · editor: Does not apply (kept)'));
  assert.equal(res.ops.some((o) => o.database === 'tag_decisions' && (o.key === 'N2::Improperly sourced' || o.key === 'N3::Source inaccessible')), false, 'decided rows stay untouched');
});

test('an unknown sources count is a gap in the data: Unsourced cannot be told, the claim is Not checkable, no queue row is made for it', async () => {
  const world = makeWorld();
  world.addClaim('U1', { sources: null });
  world.addClaim('U2', { sources: null });
  world.addRow('U2', 'Unsourced', { agent_proposal: 'Do not add tag', why_in_queue: 'Seeded decision', priority: 'Medium' });
  world.write();
  const res = await propose(world);
  assert.equal(res.code, EXIT.OK, res.err.join('\n'));
  assert.equal(opFor(res.ops, 'claims', 'U1').properties.Readiness, 'Not checkable');
  assert.match(opFor(res.ops, 'claims', 'U1').properties['Tag confidence'], /Unsourced · cannot tell · - · 3\/3 runs · Unsourced description/);
  assert.equal(res.ops.filter((o) => o.op === 'create').length, 0, 'nothing for an editor to decide');
  const u2 = opFor(res.ops, 'tag_decisions', 'U2::Unsourced');
  assert.equal(u2.properties['Agent proposal'], 'Read source first');
  assert.equal(u2.properties.Priority, 'Check source');
});

test('decided tags win in both directions, seeded outcomes included, and their rows are never touched', async () => {
  const world = makeWorld();
  world.addClaim('D1', { agentTags: ['Predictive'], spec: { Predictive: ['apply', 0.95], Hypothetical: ['do_not_apply', 0.95] } });
  world.addRow('D1', 'Predictive', { effective_outcome: 'Does not apply', tag_outcome: 'Does not apply', why_in_queue: 'Low confidence', rubric_version: VERSION, agent_proposal: 'Keep tag' });
  world.addRow('D1', 'Hypothetical', { effective_outcome: 'Applies', tag_outcome: 'Applies', agent_proposal: 'Do not add tag' });
  world.addClaim('D2', { agentTags: [], spec: { Predictive: ['apply', 0.95] } });
  world.addRow('D2', 'Predictive', { effective_outcome: 'Does not apply', seeded_outcome: 'Does not apply', why_in_queue: 'Seeded decision' });
  world.addClaim('D3', { agentTags: [], spec: { Predictive: ['do_not_apply', 0.95] } });
  world.addRow('D3', 'Predictive', { effective_outcome: 'Applies', seeded_outcome: 'Applies', why_in_queue: 'Seeded decision' });
  world.addClaim('D4', { agentTags: [], spec: { Predictive: ['ask_editor', 0.4] } });
  world.addRow('D4', 'Predictive', { effective_outcome: 'Needs evidence', tag_outcome: 'Needs evidence', why_in_queue: 'Auditor flag' });
  world.write();
  const res = await propose(world);
  assert.equal(res.code, EXIT.OK, res.err.join('\n'));

  const tags = (id) => opFor(res.ops, 'claims', id)?.properties['Agent tags']?.map((x) => x.rulebook);
  assert.deepEqual(tags('D1'), ['Hypothetical'], 'the editor said Predictive does not apply and Hypothetical applies');
  assert.deepEqual(tags('D3'), ['Predictive'], 'a seeded Applies is kept against a do_not_apply verdict');
  assert.equal(tags('D2'), undefined, 'a seeded Does not apply is kept against an apply verdict: the tag list stays empty');
  const lineOf = (id, tag) => opFor(res.ops, 'claims', id).properties['Tag confidence'].split('\n').find((l) => l.startsWith(`${tag} · `));
  assert.equal(lineOf('D1', 'Predictive'), 'Predictive · apply · 0.95 · 3/3 runs · Predictive rule 1 · editor: Does not apply (kept)');
  assert.equal(lineOf('D1', 'Hypothetical'), 'Hypothetical · do not apply · 0.95 · 3/3 runs · Hypothetical description · editor: Applies (kept)');
  assert.equal(lineOf('D3', 'Predictive'), 'Predictive · do not apply · 0.95 · 3/3 runs · Predictive description · editor: Applies (kept)');
  assert.equal(opFor(res.ops, 'claims', 'D2').properties.Readiness, 'Ready', 'the decided Predictive does not make it Fix needed, and the sources nobody reads do not make it Not checkable');

  for (const key of ['D1::Predictive', 'D1::Hypothetical', 'D2::Predictive', 'D3::Predictive']) {
    assert.equal(res.ops.some((o) => o.database === 'tag_decisions' && o.key === key), false, `${key} is decided: no op at all`);
  }
  assert.equal(res.summary.kept_by_decision, 4);

  // "Needs evidence" is not a decision: the row is still open and gets the agent's view
  const d4 = opFor(res.ops, 'tag_decisions', 'D4::Predictive');
  assert.equal(d4.op, 'update');
  assert.equal(d4.properties['Agent proposal'], 'Do not add tag');
  assert.equal(d4.properties['Why in queue'], 'Low confidence', 'Auditor flag gives way to Low confidence');
  assert.ok(!('Tag outcome' in d4.properties));
  assert.equal(res.ops.filter((o) => Object.keys(o.properties).some((k) => ['Tag outcome', 'Why wrong', 'Your reasoning', 'Decided by', 'Decided at', 'Seeded outcome'].includes(k))).length, 0, 'no editor-owned field in any op');
});

test('Rule changed: an open row recorded under another rubric version whose direction flips; not for seeded, same-version, same-direction or decided rows', async () => {
  const world = makeWorld();
  const flip = { Predictive: ['do_not_apply', 0.95] };
  world.addClaim('B1', { agentTags: ['Predictive'], spec: flip });
  world.addRow('B1', 'Predictive', { rubric_version: '2026-10-12.1', agent_proposal: 'Add tag', why_in_queue: 'Low confidence', priority: 'Medium', agent_confidence: 0.6 });
  world.addClaim('B2', { agentTags: [], spec: flip });
  world.addRow('B2', 'Predictive', { rubric_version: 'audit 2026-10-09 (before rubric)', agent_proposal: 'Keep tag', why_in_queue: 'Auditor flag', priority: 'High' });
  world.addClaim('B3', { agentTags: ['Predictive'], spec: flip });
  world.addRow('B3', 'Predictive', { rubric_version: VERSION, agent_proposal: 'Keep tag', why_in_queue: 'Low confidence', priority: 'Medium' });
  world.addClaim('B4', { agentTags: [], spec: { Predictive: ['apply', 0.95] } });
  world.addRow('B4', 'Predictive', { rubric_version: '2026-10-12.1', agent_proposal: 'Keep tag', why_in_queue: 'Low confidence', priority: 'Medium' });
  world.addClaim('B5', { agentTags: ['Predictive'], spec: flip });
  world.addRow('B5', 'Predictive', { rubric_version: '2026-10-12.1', agent_proposal: 'Add tag', effective_outcome: 'Applies', tag_outcome: 'Applies' });
  world.addClaim('B6', { agentTags: [], spec: flip });
  world.addRow('B6', 'Predictive', { rubric_version: '2026-10-12.1', agent_proposal: 'Add tag', why_in_queue: 'Low confidence', priority: 'High' });
  world.addClaim('B7', { agentTags: [], spec: flip });
  world.addRow('B7', 'Predictive', { rubric_version: '2026-10-12.1', agent_proposal: 'Read source first', why_in_queue: 'Low confidence', priority: 'Check source' });
  world.write();
  const res = await propose(world);
  assert.equal(res.code, EXIT.OK, res.err.join('\n'));
  const row = (id) => opFor(res.ops, 'tag_decisions', `${id}::Predictive`);

  const b1 = row('B1');
  assert.equal(b1.op, 'update');
  assert.deepEqual(b1.properties, {
    'Agent proposal': 'Remove tag',
    'Agent confidence': 0.95,
    'Why I recommend this': 'Reason of run 1 for Predictive: do_not_apply; 0 of 3 runs applied it',
    'Agent full note': b1.properties['Agent full note'],
    'Why in queue': 'Rule changed',
    Priority: 'High',
    'Rubric version': VERSION,
  });
  assert.deepEqual(opFor(res.ops, 'claims', 'B1').properties['Agent tags'], [], 'the tag leaves the claim');

  const b2 = row('B2');
  assert.equal(b2.properties['Why in queue'], undefined, 'a seeded row (no rubric version yet) is not "Rule changed": its reason stays Auditor flag');
  assert.equal(b2.properties.Priority, 'Medium');
  assert.equal(b2.properties['Agent proposal'], 'Do not add tag');
  assert.equal(b2.properties['Rubric version'], VERSION);

  const b3 = row('B3');
  assert.equal(b3.properties['Why in queue'], undefined, 'the same rubric version: no rule changed');
  assert.equal(b3.properties['Agent proposal'], 'Remove tag', 'the direction changed, so the wording does too');

  const b4 = row('B4');
  assert.equal(b4.properties['Agent proposal'], undefined, 'same direction: the recorded wording is kept ("Keep tag" stays)');
  assert.equal(b4.properties['Why in queue'], undefined);

  assert.equal(row('B5'), undefined, 'decided rows are never touched');
  assert.equal(row('B6').properties['Why in queue'], 'Rule changed');
  assert.equal(row('B6').properties.Priority, undefined, 'it was High already: only changed values are written');
  assert.equal(row('B7').properties['Agent proposal'], 'Do not add tag', 'a recorded "Read source first" has no direction to flip');
  assert.equal(row('B7').properties['Why in queue'], undefined);
  assert.equal(res.summary.by_why_in_queue['Rule changed'], 2);
});

test('source-reading proposals: Read source first with priority Check source on an open row; no row of their own', async () => {
  const world = makeWorld();
  world.addClaim('S1', { sources: 3 });
  world.addRow('S1', 'Improperly sourced', { agent_proposal: 'Read source first', why_in_queue: 'Seeded decision', priority: 'Check source', rubric_version: 'audit 2026-10-09 (before rubric)' });
  world.addClaim('S2', { sources: 0 });
  world.addRow('S2', 'Improperly sourced', { agent_proposal: 'Read source first', why_in_queue: 'Seeded decision', priority: 'Check source' });
  world.write();
  const res = await propose(world);
  assert.equal(res.code, EXIT.OK, res.err.join('\n'));
  const s1 = opFor(res.ops, 'tag_decisions', 'S1::Improperly sourced');
  assert.equal(s1.properties['Agent proposal'], undefined, 'it already says Read source first');
  assert.equal(s1.properties['Agent confidence'], undefined, 'null stays null');
  assert.equal(s1.properties['Rubric version'], VERSION);
  assert.match(s1.properties['Why I recommend this'], /^The attached sources are not read in this version, so this cannot be decided; 0 of 3 runs applied it$/);
  const s2 = opFor(res.ops, 'tag_decisions', 'S2::Improperly sourced');
  assert.equal(s2.properties['Agent proposal'], 'Do not add tag', 'no sources: nothing to check');
  assert.equal(s2.properties.Priority, 'Medium');
  assert.equal(s2.properties['Agent confidence'], 1);
  assert.equal(res.ops.filter((o) => o.op === 'create').length, 0, 'a cannot_tell source-reading tag never makes a row by itself');
});

test('proposal wording stays put when the plan itself changes the claim (Add tag does not become Keep tag on the next run)', async () => {
  const world = makeWorld();
  world.addClaim('W1', { agentTags: [], spec: { Predictive: [['apply', 0.9], ['apply', 0.9], ['do_not_apply', 0.5]] } });
  world.write();
  const first = await propose(world);
  assert.equal(opFor(first.ops, 'tag_decisions', 'W1::Predictive').properties['Agent proposal'], 'Add tag');
  applyOps(world, first.ops);
  assert.deepEqual(world.claims[0].agent_tags, ['Predictive']);
  world.write('p2');
  const second = await propose(world, { pull: 'p2', outRun: 'o2' });
  assert.equal(second.ops.length, 0, JSON.stringify(second.ops));
});

// ---- the cap ----------------------------------------------------------------------------------------------------------------------------------------

function capWorld(settings, n = 5) {
  const world = makeWorld({ settings });
  for (let i = 0; i < n; i++) {
    const high = i < 2;
    world.addClaim(`K${i}`, { spec: high ? { Predictive: ['ask_editor', 0.6 - i * 0.01] } : { Factual: ['ask_editor', 0.3 + i * 0.01] } });
  }
  return world.write();
}

test('weekly cap: new rows beyond it are held back, high priority first, and counted; the week is remembered in runs/state', async () => {
  const world = capWorld({ weekly_cap: 2 });
  const res = await propose(world);
  assert.equal(res.code, EXIT.OK, res.err.join('\n'));
  const created = res.ops.filter((o) => o.database === 'tag_decisions').map((o) => o.key).sort();
  assert.deepEqual(created, ['K0::Predictive', 'K1::Predictive'], 'the two High rows');
  assert.equal(res.summary.rows_created, 2);
  assert.equal(res.summary.held_by_cap, 3);
  assert.equal(res.summary.weekly_cap, 2);
  assert.match(res.out.join('\n'), /rows_created=2 rows_updated=0 held_by_cap=3/);
  assert.equal(res.ops.filter((o) => o.database === 'claims').length, 5, 'the claims are updated whatever the cap says');
  const state = readJson(join(world.runsDir, 'state', 'queue-week.json'));
  assert.equal(state.week, '2026-W42');
  assert.deepEqual(state.keys, ['K0::Predictive', 'K1::Predictive']);

  // the same plan applied twice (not applied in between) does not use up the cap twice
  const again = await propose(world, { outRun: 'o2' });
  assert.equal(again.summary.rows_created, 2);
  assert.equal(again.summary.held_by_cap, 3);
  assert.deepEqual(readJson(join(world.runsDir, 'state', 'queue-week.json')).keys, ['K0::Predictive', 'K1::Predictive']);

  // a new week starts again
  const later = await propose(world, { outRun: 'o3', now: new Date('2026-10-20T10:00:00Z') });
  assert.equal(later.summary.rows_created, 2);
  assert.equal(readJson(join(world.runsDir, 'state', 'queue-week.json')).week, '2026-W43');
});

test('weekly cap: rows already created this week count against it; a cap of 0 holds everything; the default cap comes from config', async () => {
  const world = capWorld({ weekly_cap: 3 });
  mkdirSync(join(world.runsDir, 'state'), { recursive: true });
  writeJson(join(world.runsDir, 'state', 'queue-week.json'), { week: '2026-W42', keys: ['old::A', 'old::B'] });
  const res = await propose(world);
  assert.equal(res.summary.rows_created, 1, '3 minus the 2 created earlier');
  assert.equal(res.summary.held_by_cap, 4);
  assert.deepEqual(readJson(join(world.runsDir, 'state', 'queue-week.json')).keys, ['K1::Predictive', 'old::A', 'old::B'], 'the least confident High row first');

  writeJson(join(world.runsDir, 'state', 'queue-week.json'), { week: '2026-W41', keys: ['old::A', 'old::B', 'old::C', 'old::D'] });
  const lastWeek = await propose(world, { outRun: 'o2' });
  assert.equal(lastWeek.summary.rows_created, 3, 'last week does not count');

  const zero = capWorld({ weekly_cap: 0 });
  const none = await propose(zero);
  assert.equal(none.summary.rows_created, 0);
  assert.equal(none.summary.held_by_cap, 5);
  assert.equal(existsSync(join(zero.runsDir, 'state', 'queue-week.json')), false, 'nothing created, nothing remembered');

  const defaulted = capWorld({}, 3);
  defaulted.write();
  const def = await propose(defaulted);
  assert.equal(def.summary.weekly_cap, 40, 'config.queue.weekly_cap_default');
  assert.equal(def.summary.held_by_cap, 0);
});

test('weekly cap: rows for a failed claim come last, so they cannot crowd out real uncertainty', async () => {
  const world = makeWorld({ settings: { weekly_cap: 2 } });
  world.addClaim('E0', { missingRuns: [2] }); // every model tag is an error verdict
  world.addClaim('G0', { spec: { Factual: ['ask_editor', 0.3] } });
  world.write();
  const res = await propose(world);
  const created = res.ops.filter((o) => o.database === 'tag_decisions' && o.op === 'create').map((o) => o.key);
  assert.ok(created.includes('G0::Factual'), created.join(','));
  assert.equal(created.length, 2);
  assert.equal(res.summary.held_by_cap, 9);
});

// ---- errors and edge cases -------------------------------------------------------------------------------------------------------------------------------

test('a failed judge run: error verdicts need an editor, create low-confidence rows, and leave the claim tags alone', async () => {
  const world = makeWorld();
  world.addClaim('X1', { agentTags: ['Predictive', 'Editor verified', 'Wordy'], errorRuns: [2], spec: { Predictive: ['apply', 0.9] } });
  world.write();
  const res = await propose(world);
  assert.equal(res.code, EXIT.OK, res.err.join('\n'));
  const claim = opFor(res.ops, 'claims', 'X1').properties;
  assert.equal(claim.Readiness, 'Needs editor');
  assert.equal(claim['Agent tags'], undefined, 'Predictive stays (nothing is known), Editor verified and Wordy are not this agent\'s to touch');
  assert.match(claim['Tag confidence'], /Predictive · error · 0\.90 · 2\/3 runs · -/);
  const row = opFor(res.ops, 'tag_decisions', 'X1::Predictive');
  assert.equal(row.properties['Why in queue'], 'Low confidence');
  assert.equal(row.properties['Agent proposal'], 'Add tag');
  assert.match(row.properties['Why I recommend this'], /^No valid answer from 1 of 3 judge runs/);
  assert.match(row.properties['Agent full note'], /\nRun 2: no valid answer\n/);
});

test('tags the judge does not decide stay on the claim: Editor verified is never added or removed', async () => {
  const world = makeWorld();
  world.addClaim('T1', { agentTags: ['Editor verified', 'Debate'], spec: { Debate: ['do_not_apply', 0.9], Simple: ['apply', 0.9] } });
  world.write();
  const res = await propose(world);
  assert.deepEqual(opFor(res.ops, 'claims', 'T1').properties['Agent tags'].map((x) => x.rulebook), ['Editor verified', 'Simple']);
});

test('Tag confidence is cut to the configured size', async () => {
  const world = makeWorld({ configEdit: (cfg) => { cfg.notion.max_text = 300; } });
  world.addClaim('L1');
  world.write();
  const res = await propose(world);
  const text = opFor(res.ops, 'claims', 'L1').properties['Tag confidence'];
  assert.ok(text.length <= 300, `${text.length}`);
  assert.match(text, /\n\.\.\.$/);
  assert.ok(text.startsWith('Context-dependent · '));
});

test('a claim whose text changed after it was judged is left out; judged items that are not claims of the pull are ignored', async () => {
  const world = makeWorld();
  world.addClaim('N1', { text: 'Old wording of the claim' });
  world.addClaim('N2', { text: 'Stable wording' });
  world.items.push({ id: 'canary-12345678', text_hash: textHash('A canary') });
  world.claims.find((c) => c.geo_id === 'N1').claim = 'New wording of the claim';
  world.write();
  const res = await propose(world);
  assert.equal(res.code, EXIT.OK, res.err.join('\n'));
  assert.equal(res.summary.stale_claims, 1);
  assert.equal(res.summary.claims_judged, 1);
  assert.equal(opFor(res.ops, 'claims', 'N1'), undefined);
  assert.ok(opFor(res.ops, 'claims', 'N2'));
  assert.match(res.err.join('\n'), /1 claim\(s\) changed text/);
});

test('without an item list in run.json only claims that have judgments are used; polarity falls back to the rubric', async () => {
  const world = makeWorld({ rulebook: 'none', metaEdit: { items: undefined } });
  world.addClaim('F1', { spec: { Predictive: ['apply', 0.9] } });
  world.claims.push({ geo_id: 'never-judged', claim: 'Nobody judged me', sources_count: 1, agent_tags: [], readiness: null, tag_confidence: null, last_judged: null });
  world.write();
  const res = await propose(world);
  assert.equal(res.code, EXIT.OK, res.err.join('\n'));
  assert.equal(opFor(res.ops, 'claims', 'never-judged'), undefined);
  assert.equal(opFor(res.ops, 'claims', 'F1').properties.Readiness, 'Fix needed', 'Predictive is an Issue tag according to the rubric file');
});

test('refuses runs that are not finished judge runs, smoke runs, and missing inputs (exit 2)', async () => {
  const world = makeWorld();
  world.addClaim('R1');
  const runFile = join(world.runsDir, 'j1', 'run.json');
  const expectInvalid = async (edit, pattern) => {
    world.write();
    const meta = readJson(runFile);
    edit(meta);
    writeJson(runFile, meta);
    const res = await propose(world);
    assert.equal(res.code, EXIT.INVALID, `${pattern}: ${res.err.join('\n')}`);
    assert.match(res.err.join('\n'), pattern);
    assert.equal(res.ops.length, 0);
    assert.equal(res.planner.args, null, 'no plan was opened');
  };
  await expectInvalid((m) => { m.status = 'stopped'; m.resume = 'node judge.mjs --resume'; }, /is stopped, not finished; resume it first: node judge\.mjs --resume/);
  await expectInvalid((m) => { m.status = 'running'; }, /is running, not finished/);
  await expectInvalid((m) => { m.smoke = true; }, /smoke run/);
  await expectInvalid((m) => { m.kind = 'distill'; }, /not a judge run/);

  world.write();
  const nonexistent = await propose(world, { run: 'nope' });
  assert.equal(nonexistent.code, EXIT.INVALID);
  assert.match(nonexistent.err.join('\n'), /does not exist/);
  const nopull = await propose(world, { pull: 'missing' });
  assert.equal(nopull.code, EXIT.INVALID);
  assert.match(nopull.err.join('\n'), /no pull folder/);
  rmSync(join(world.runsDir, 'pull', 'p1', 'norm', 'queue.jsonl'));
  const noqueue = await propose(world);
  assert.equal(noqueue.code, EXIT.INVALID);
  assert.match(noqueue.err.join('\n'), /queue\.jsonl does not exist; run the pull first/);

  const bare = makeWorld();
  bare.addClaim('R1');
  bare.write();
  rmSync(join(bare.runsDir, 'judgments'), { recursive: true });
  const nojudgments = await propose(bare);
  assert.equal(nojudgments.code, EXIT.INVALID);
  assert.match(nojudgments.err.join('\n'), /no usable judgment/);
});

test('a judge run made with another rubric than the one in force is drift (exit 4); a failed run proposes with a warning', async () => {
  const world = makeWorld();
  world.addClaim('G1', { spec: { Predictive: ['apply', 0.9] } });
  world.write();
  const meta = readJson(join(world.runsDir, 'j1', 'run.json'));
  writeJson(join(world.runsDir, 'j1', 'run.json'), { ...meta, rubric_hash: 'sha256:aaaaaaaaaaaaaaaa' });
  writeJson(join(world.dir, 'rubric', 'rubric.lock'), { rubric_version: VERSION, rubric_hash: 'sha256:aaaaaaaaaaaaaaaa' });
  const same = await propose(world);
  assert.equal(same.code, EXIT.OK, same.err.join('\n'));
  writeJson(join(world.dir, 'rubric', 'rubric.lock'), { rubric_version: '2026-10-20.2', rubric_hash: 'sha256:bbbbbbbbbbbbbbbb' });
  const other = await propose(world, { outRun: 'o2' });
  assert.equal(other.code, EXIT.DRIFT);
  assert.match(other.err.join('\n'), /not the rubric in force/);
  assert.equal(other.planner.args, null);

  rmSync(join(world.dir, 'rubric', 'rubric.lock'));
  writeJson(join(world.runsDir, 'j1', 'run.json'), { ...meta, status: 'failed' });
  const failed = await propose(world, { outRun: 'o3' });
  assert.equal(failed.code, EXIT.OK);
  assert.match(failed.err.join('\n'), /warning: run j1 finished with too many failed item runs/);
});

test('an op the plan builder refuses is reported and makes the exit code 2, but the other ops are still planned', async () => {
  const world = makeWorld();
  world.addClaim('P1', { spec: { Predictive: ['apply', 0.9] } });
  world.addClaim('P2', { spec: { Predictive: ['apply', 0.9] } });
  world.write();
  const planner = fakePlanner({ refuse: (db, key) => (db === 'claims' && key === 'P1' ? 'P1 is not in the id-map' : null) });
  const res = await propose(world, { planner });
  assert.equal(res.code, EXIT.INVALID);
  assert.deepEqual(res.summary.refused, [{ database: 'claims', key: 'P1', reason: 'P1 is not in the id-map' }]);
  assert.match(res.err.join('\n'), /refused 1 op\(s\), for example claims P1: P1 is not in the id-map/);
  assert.equal(res.summary.claims_updated, 1);
  assert.ok(opFor(res.ops, 'claims', 'P2'));
});

test('a plan builder that cannot be opened is reported (exit 2) and one that does not exist is reported (exit 1)', async () => {
  const world = makeWorld();
  world.addClaim('Z1');
  world.write();
  const broken = await propose(world, { planner: { ops: [], args: null, factory: async () => { throw new Error('pull p1 has no pull.json'); } } });
  assert.equal(broken.code, EXIT.INVALID);
  assert.match(broken.err.join('\n'), /plan builder could not be opened on pull p1: pull p1 has no pull\.json/);
  const missing = await propose(world, { planner: { ops: [], args: null, factory: async () => { throw new (await import('../agents/claim-tagger/scripts/judge.mjs')).ExitError(EXIT.ERROR, 'scripts/plan.mjs cannot be loaded (x)'); } } });
  assert.equal(missing.code, EXIT.ERROR);
  assert.match(missing.err.join('\n'), /plan\.mjs cannot be loaded/);
});

// ---- with the real pull, plan builder, check and apply (against the fake Notion of the I/O tests) ----------------------------------------------------

test('end to end: real pull -> propose with the real plan builder -> plan check -> apply -> real pull -> propose again gives an empty plan', async (t) => {
  const helpers = await import('./fixtures/notion/helpers.mjs').catch(() => null);
  const planMod = await import('../agents/claim-tagger/scripts/plan.mjs').catch(() => null);
  const applyMod = await import('../agents/claim-tagger/scripts/apply.mjs').catch(() => null);
  if (!helpers || !planMod || !applyMod) {
    t.skip('the Notion I/O scripts or their fixtures are not there');
    return;
  }
  const w = helpers.makeWorld();
  await w.pull('p1');
  const rubric = readJson(join(w.root, 'rubric', 'rubric.json'));
  const claims = readJsonl(join(w.root, 'runs', 'pull', 'p1', 'norm', 'claims.jsonl')).rows;
  assert.deepEqual(claims.map((c) => c.geo_id), ['g1', 'g2', 'g3']);

  // judgments for the three claims of the fake Notion
  const specs = {
    g1: { Predictive: [['apply', 0.9], ['apply', 0.8], ['do_not_apply', 0.6]], Debate: ['apply', 0.9], Opinion: ['do_not_apply', 0.9] },
    g2: { Predictive: ['apply', 0.95] },
    g3: { Hypothetical: ['do_not_apply', 0.95], Predictive: ['ask_editor', 0.4] },
  };
  const items = [];
  for (const c of claims) {
    items.push({ id: c.geo_id, text_hash: c.text_hash });
    for (let run = 1; run <= 3; run++) {
      const doc = judgmentDoc({ id: c.geo_id, text: c.claim, run, spec: specs[c.geo_id], sources: c.sources_count, version: rubric.rubric_version });
      assert.equal(doc.text_hash, c.text_hash, 'the pull and the judge hash the claim text the same way');
      writeJson(join(w.root, 'runs', 'judgments', CFG16, `run-${run}`, judgmentFileName(c.geo_id, c.text_hash)), doc);
    }
  }
  writeJson(join(w.root, 'runs', 'j1', 'run.json'), {
    run_id: 'j1', kind: 'judge', items_source: 'claims', config_id: `sha256:${CFG16}`, rubric_version: rubric.rubric_version, runs: 3, status: 'done', items,
    counts: { done: 9, error: 0, stopped: 0, skipped: 0 }, cost_usd: 0, started: 'x', finished: 'y', rubric_path: join(w.root, 'rubric', 'rubric.json'),
  });
  // the fake world has no judgment schema in its root: the schema is read from the agent folder given as agentDir
  mkdirSync(join(w.root, 'schemas'), { recursive: true });
  cpSync(join(REAL, 'schemas', 'judgment.schema.json'), join(w.root, 'schemas', 'judgment.schema.json'));

  const runPropose = async (pullId, outRun) => {
    const out = [];
    const err = [];
    const code = await main(['--run', 'j1', '--pull', pullId, '--out-run', outRun], { out: (s) => out.push(s), err: (s) => err.push(s) }, { agentDir: w.root, now: w.clock.now });
    return { code, out, err, plan: readJsonl(join(w.root, 'runs', outRun, 'plan.jsonl')).rows, summary: readJson(join(w.root, 'runs', outRun, 'propose.json')) };
  };

  const first = await runPropose('p1', 'prop1');
  assert.equal(first.code, EXIT.OK, first.err.join('\n'));
  const [header, ...ops] = first.plan;
  assert.equal(header.source_pull, 'p1');
  assert.ok(ops.length >= 5, `${ops.length} ops`);
  const op = (db, key) => ops.find((o) => o.database === db && o.key === key);

  // what the real builder made of it: page ids from the id-map, relations resolved, only allowlisted properties
  assert.equal(op('claims', 'g1').page_id, w.ids.claims.g1);
  assert.deepEqual(op('claims', 'g1').properties['Agent tags'], [w.ids.rulebook.Debate, w.ids.rulebook.Predictive].sort(), 'Debate stays, Predictive is added, Opinion goes');
  assert.equal(op('claims', 'g1').properties.Readiness, 'Fix needed');
  assert.deepEqual(op('claims', 'g2').properties['Agent tags'], [], 'the seeded "does not apply" keeps Predictive off; Unsourced is dropped (2 sources)');
  assert.match(op('claims', 'g2').properties['Tag confidence'], /Predictive · apply · 0\.95 · 3\/3 runs · Predictive rule 1 · editor: Does not apply \(kept\)/);
  assert.deepEqual(op('claims', 'g3').properties['Agent tags'], [w.ids.rulebook.Hypothetical], 'the editor decided Hypothetical applies');
  const g1Row = op('tag_decisions', 'g1::Predictive');
  assert.equal(g1Row.op, 'update', 'the existing open row is updated in place');
  assert.equal(g1Row.page_id, w.ids.decisions['g1::Predictive']);
  assert.deepEqual(g1Row.guard, { undecided: true });
  assert.equal(g1Row.properties['Agent proposal'], undefined, 'it already said "Keep tag", same direction');
  assert.equal(g1Row.properties['Agent confidence'], 0.85);
  assert.ok(!ops.some((o) => o.key === 'g2::Predictive' && o.database === 'tag_decisions'), 'the seeded row is not touched');
  assert.ok(!ops.some((o) => o.key === 'g3::Hypothetical' && o.database === 'tag_decisions'), 'the decided row is not touched');
  const g3Row = op('tag_decisions', 'g3::Predictive');
  assert.equal(g3Row.op, 'update', 'Needs evidence is not a decision');
  assert.equal(g3Row.properties['Agent proposal'], 'Do not add tag');
  for (const o of ops) {
    const names = Object.keys(o.properties);
    assert.ok(!names.some((n) => ['Tag outcome', 'Why wrong', 'Your reasoning', 'Decided by', 'Decided at', 'Seeded outcome'].includes(n)), `${o.database} ${o.key}`);
  }

  // check (re-validates against the allowlist and the pull), then apply, then a fresh pull
  const checked = planMod.check({ root: w.root, runId: 'prop1', now: w.clock.now });
  assert.equal(checked.code, EXIT.OK, (checked.problems ?? []).join('; '));
  const cap = helpers.captureIo();
  const applied = await applyMod.main(['--run', 'prop1'], cap.io, w.env());
  assert.equal(applied, EXIT.OK, cap.err.join('\n'));
  w.clock.advance(60 * 60 * 1000);
  await w.pull('p2');
  const claim = w.fake.find('claims', 'g1').props;
  assert.equal(claim.Readiness, 'Fix needed');
  assert.equal(claim['Last judged'], `${rubric.rubric_version} · j1`);

  const second = await runPropose('p2', 'prop2');
  assert.equal(second.code, EXIT.OK, second.err.join('\n'));
  assert.equal(second.plan.length, 1, JSON.stringify(second.plan.slice(1).map((o) => [o.database, o.key, Object.keys(o.properties)])));
  assert.deepEqual([second.summary.claims_updated, second.summary.rows_created, second.summary.rows_updated], [0, 0, 0]);
});

// ---- idempotence --------------------------------------------------------------------------------------------------------------------------------------------

test('a second run on the same inputs (after the first plan is applied) produces an empty plan', async () => {
  const world = makeWorld({ settings: { weekly_cap: 5 } });
  world.addClaim('I1', { agentTags: ['Predictive'], spec: { Predictive: ['do_not_apply', 0.95], Hypothetical: [['ask_editor', 0.5], ['ask_editor', 0.6], ['apply', 0.7]] } });
  world.addRow('I1', 'Predictive', { rubric_version: '2026-10-12.1', agent_proposal: 'Keep tag', why_in_queue: 'Low confidence', priority: 'Medium' }); // becomes Rule changed
  world.addClaim('I2', { spec: { Predictive: [['apply', 0.9], ['apply', 0.8], ['do_not_apply', 0.6]], Factual: ['ask_editor', 0.3] } });
  world.addClaim('I3', { agentTags: ['Predictive'], spec: { Predictive: ['apply', 0.95] } });
  world.addRow('I3', 'Predictive', { effective_outcome: 'Does not apply', seeded_outcome: 'Does not apply', why_in_queue: 'Seeded decision' });
  world.addClaim('I4', { missingRuns: [3], agentTags: ['Debate'] });
  world.addClaim('I5', { sources: 3 });
  world.addRow('I5', 'Improperly sourced', { agent_proposal: 'Read source first', why_in_queue: 'Seeded decision', priority: 'Check source' });
  world.addClaim('I6', { sources: 0 });
  for (let i = 0; i < 6; i++) world.addClaim(`H${i}`, { spec: { Hypothetical: ['ask_editor', 0.5 - i * 0.01] } }); // more candidates than the cap
  world.write();

  const first = await propose(world);
  assert.equal(first.code, EXIT.OK, first.err.join('\n'));
  assert.ok(first.ops.length > 10, `${first.ops.length} ops`);
  assert.ok(first.summary.held_by_cap > 0, 'the cap bites in this scenario');
  assert.equal(first.summary.by_why_in_queue['Rule changed'], 1);
  applyOps(world, first.ops);
  world.write('p2');

  const second = await propose(world, { pull: 'p2', outRun: 'o2' });
  assert.equal(second.code, EXIT.OK, second.err.join('\n'));
  assert.deepEqual(second.ops, [], JSON.stringify(second.ops.map((o) => [o.database, o.key, Object.keys(o.properties)])));
  assert.deepEqual([second.summary.claims_updated, second.summary.rows_created, second.summary.rows_updated], [0, 0, 0]);
  assert.equal(second.summary.held_by_cap, first.summary.held_by_cap, 'the held rows are still held, and still no plan');
  assert.equal(readJsonl(join(world.runsDir, 'o2', 'plan.jsonl')).rows.length, 1, 'a plan file with a header only');
  assert.deepEqual(second.summary.by_why_in_queue, first.summary.by_why_in_queue, 'the reasons persist');

  // and a third time, to be sure
  const third = await propose(world, { pull: 'p2', outRun: 'o3' });
  assert.deepEqual(third.ops, []);
});

test('idempotence also holds when the editor decides a row between the runs', async () => {
  const world = makeWorld();
  world.addClaim('J1', { spec: { Predictive: [['apply', 0.9], ['apply', 0.8], ['do_not_apply', 0.6]] } });
  world.write();
  const first = await propose(world);
  applyOps(world, first.ops);
  const row = world.queue.find((x) => x.key === 'J1::Predictive');
  Object.assign(row, { tag_outcome: 'Does not apply', effective_outcome: 'Does not apply' });
  world.write('p2');
  const second = await propose(world, { pull: 'p2', outRun: 'o2' });
  assert.equal(second.ops.filter((o) => o.database === 'tag_decisions').length, 0, 'the decided row is left alone');
  const claimOp = opFor(second.ops, 'claims', 'J1');
  assert.deepEqual(claimOp.properties['Agent tags'], [], 'but the claim follows the decision');
  assert.match(claimOp.properties['Tag confidence'], /Predictive · apply · 0\.85 · 2\/3 runs · Predictive rule 1 · editor: Does not apply \(kept\)/);
  applyOps(world, second.ops);
  world.write('p3');
  assert.deepEqual((await propose(world, { pull: 'p3', outRun: 'o3' })).ops, []);
});

test('real-shaped input: Notion property names work as well as the snake_case ones', async () => {
  const world = makeWorld();
  world.addClaim('Q1', { spec: { Predictive: ['apply', 0.9] } });
  world.write();
  // the same rows, but with the Notion names under props
  const norm = join(world.runsDir, 'pull', 'p1', 'norm');
  writeJsonl(join(norm, 'claims.jsonl'), world.claims.map((c) => ({ props: { 'Geo ID': c.geo_id, 'Claim title': c.claim, 'Sources count': c.sources_count, 'Agent tags': [], Readiness: null } })));
  writeJson(join(norm, 'rulebook.json'), Object.fromEntries(world.polarity.map((p) => [p.name, p.polarity])));
  const res = await propose(world);
  assert.equal(res.code, EXIT.OK, res.err.join('\n'));
  assert.equal(opFor(res.ops, 'claims', 'Q1').properties.Readiness, 'Fix needed');
});

test('every op uses only properties on the allowlist for its database', async () => {
  const { WRITABLE } = await import('../agents/claim-tagger/scripts/allowlist.mjs').catch(() => ({ WRITABLE: null }));
  const world = makeWorld();
  world.addClaim('V1', { spec: { Predictive: [['apply', 0.9], ['apply', 0.8], ['do_not_apply', 0.6]], Factual: ['ask_editor', 0.3] } });
  world.write();
  const res = await propose(world);
  assert.ok(res.ops.length > 2);
  const allowed = WRITABLE ?? {
    claims: ['Agent tags', 'Readiness', 'Tag confidence', 'Last judged'],
    tag_decisions: ['Claim', 'Tag', 'Agent proposal', 'Agent confidence', 'Why I recommend this', 'Agent full note', 'Why in queue', 'Priority', 'Rubric version'],
  };
  for (const op of res.ops) for (const prop of Object.keys(op.properties)) assert.ok(allowed[op.database].includes(prop), `${op.database}.${prop}`);
  const selects = { 'Agent proposal': ['Add tag', 'Remove tag', 'Keep tag', 'Do not add tag', 'Read source first'], 'Why in queue': ['Low confidence', 'Auditor flag', 'Editor challenge', 'Rule changed', 'Blind check', 'Seeded decision', 'Migrated decision'], Priority: ['High', 'Medium', 'Check source'], Readiness: ['Needs editor', 'Fix needed', 'Not checkable', 'Ready'] };
  for (const op of res.ops) for (const [prop, options] of Object.entries(selects)) if (prop in op.properties) assert.ok(options.includes(op.properties[prop]), `${prop}=${op.properties[prop]}`);
});

// ---- the static fixture: a small fake pull and judgments in tests/fixtures/judge ------------------------------------------------------------------------

const FIXTURE_DIR = new URL('./fixtures/judge/', import.meta.url);

function copyFixture() {
  const dir = tmp();
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  mkdirSync(join(dir, 'schemas'), { recursive: true });
  cpSync(join(REAL, 'schemas', 'judgment.schema.json'), join(dir, 'schemas', 'judgment.schema.json'));
  return dir;
}

test('fixture: the judgments validate against judgment.schema.json and the pull rows carry every field propose reads', async () => {
  const { validate } = await import('../agents/claim-tagger/scripts/lib/validate.mjs');
  const dir = copyFixture();
  const schema = readJson(join(REAL, 'schemas', 'judgment.schema.json'));
  const meta = readJson(join(dir, 'runs', 'j1', 'run.json'));
  assert.equal(meta.runs, 3);
  let files = 0;
  for (const item of meta.items) {
    for (let run = 1; run <= meta.runs; run++) {
      const doc = readJson(join(dir, 'runs', 'judgments', meta.config_id.replace('sha256:', ''), `run-${run}`, judgmentFileName(item.id, item.text_hash)));
      assert.deepEqual(validate(schema, doc), { ok: true, errors: [] }, `${item.id} run ${run}`);
      assert.equal(doc.config.config_id, meta.config_id);
      assert.equal(doc.tags.length, 13);
      files++;
    }
  }
  assert.equal(files, 9);
  const norm = join(dir, 'runs', 'pull', 'p1', 'norm');
  for (const row of readJsonl(join(norm, 'claims.jsonl')).rows) {
    for (const field of ['geo_id', 'page_id', 'claim', 'text_hash', 'sources_count', 'agent_tags', 'readiness', 'tag_confidence', 'last_judged']) assert.ok(field in row, `claims.jsonl: ${field}`);
    assert.equal(row.text_hash, textHash(row.claim), 'the text hash is h16(normaliseText(claim)), as pull.mjs writes it');
  }
  for (const row of readJsonl(join(norm, 'queue.jsonl')).rows) {
    for (const field of ['key', 'page_id', 'geo_id', 'tag', 'agent_proposal', 'agent_confidence', 'why_i_recommend_this', 'agent_full_note', 'why_in_queue', 'priority', 'rubric_version', 'tag_outcome', 'seeded_outcome', 'effective_outcome']) {
      assert.ok(field in row, `queue.jsonl: ${field}`);
    }
  }
  assert.ok('weekly_cap' in readJson(join(norm, 'settings.json')));
  assert.ok(readJson(join(norm, 'rulebook.json')).rows.every((r) => r.name && r.polarity));
});

test('golden plan: the fixture pull and judgments produce exactly the recorded ops', async () => {
  const dir = copyFixture();
  const planner = fakePlanner();
  const out = [];
  const err = [];
  const code = await main(['--run', 'j1', '--pull', 'p1', '--out-run', 'o1'], { out: (s) => out.push(s), err: (s) => err.push(s) }, { agentDir: dir, now: () => NOW, planFactory: planner.factory });
  assert.equal(code, EXIT.OK, err.join('\n'));
  const goldenFile = new URL('./fixtures/judge/expected-ops.json', import.meta.url);
  // After changing propose.mjs on purpose: UPDATE_GOLDEN=1 node --test tests/propose.test.mjs, then read the diff of expected-ops.json.
  if (process.env.UPDATE_GOLDEN === '1') writeFileSync(goldenFile, `${JSON.stringify(planner.ops, null, 2)}\n`);
  const expected = readJson(goldenFile);
  assert.deepEqual(planner.ops, expected);
  const summary = readJson(join(dir, 'runs', 'o1', 'propose.json'));
  assert.deepEqual([summary.claims_updated, summary.rows_created, summary.rows_updated, summary.held_by_cap, summary.kept_by_decision], [3, 1, 2, 0, 1]);
  assert.deepEqual(summary.readiness_counts, { 'Needs editor': 0, 'Fix needed': 2, 'Not checkable': 0, Ready: 1 });
  assert.deepEqual(summary.by_why_in_queue, { 'Seeded decision': 1, 'Rule changed': 1, 'Low confidence': 1 });
});
