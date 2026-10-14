#!/usr/bin/env node
// followup: did the agent learn? After a lesson went Live, judge the claims behind it again under the live rubric and write the answer on its rows.
//
//   node agents/claim-tagger/scripts/followup.mjs --lesson <lesson key or LS-n> [--pull <id>] [--run-id <id>] [--driver cli|fake] [--model <id>]
//
// Items: the claims behind the lesson's supporting rows plus the claim of every decided row on the lesson's tag (the second group is the regression
// check: do the other decisions still agree?). judge.mjs judges them under the live rubric, config.judge.runs runs; after a finalize the gate already
// judged the lesson's claims under exactly this rubric, so most of it is a cache hit.
// For every SUPPORTING row: Agent follow-up = Fixed when the majority verdict of the runs now equals the editor's outcome (apply for Applies,
// do_not_apply for Does not apply), Still wrong when it does not (a split, ask_editor and cannot_tell count as not equal), Not re-run when the claim
// could not be judged (no complete runs). Follow-up run = "<rubric version> · <run id>". The Claims' live columns (Agent tags with the decided tags
// kept, Readiness, Tag confidence, Last judged) are refreshed for every judged claim, writing only what changed. A Runs row
// "Follow-up <version> · <lesson>" records the counts, and Agent settings "Last run summary" says them in one line when the pull holds Agent settings.
// Nothing here writes an editor field: the allowlist lets a decided row take only Lesson, In regression suite, Agent follow-up and Follow-up run.
//
// Exit codes: 0 ok, 1 error, 2 invalid (the lesson is not Live, a pull without what is needed, no judgments), 3 paused, 4 drift or the wrong model,
// 75 the usage window ran out (the finished judgments are kept; run the same command again).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { controlPaths } from './allowlist.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { readJson, readJsonl, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { normId } from './lib/notion-values.mjs';
import { agentRoot, codeFile, ensureDir, isMain, runId as makeRunId } from './lib/paths.mjs';
import { compareCodePoints } from './lib/pyjson.mjs';
import { normaliseText } from './lib/rubric-build.mjs';
import { validate } from './lib/validate.mjs';
import { codeDecidedTag, judgmentFileName, main as judgeMain, scopeOf, textHash } from './judge.mjs';
import { openPlan } from './plan.mjs';
import { capLines, decideVerdict, readinessOf, tagLine } from './propose.mjs';
import { latestPullId, loadConfig, loadPull } from './pull.mjs';
import { ExitError, resolveLesson } from './promote.mjs';
import { preflight } from './status.mjs';

export const USAGE = 'usage: node agents/claim-tagger/scripts/followup.mjs --lesson <lesson key or LS-n> [--pull <id>] [--run-id <id>] [--driver cli|fake] [--model <id>]';

const MAX_TEXT = 1900;
const OUTCOME_DECISION = { Applies: 'apply', 'Does not apply': 'do_not_apply' };
const round6 = (x) => Math.round(x * 1e6) / 1e6;

class UsageError extends Error {}

const sameSet = (a, b) => {
  const x = [...new Set(a ?? [])].sort(compareCodePoints);
  const y = [...new Set(b ?? [])].sort(compareCodePoints);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** The runs of one claim from the judgment files: [judgment | null] per run (valid file, status ok, this configuration, this text). */
function readRuns({ cfgDir, runs, id, claim, configId, schema }) {
  const hash = textHash(claim);
  const out = [];
  for (let run = 1; run <= runs; run++) {
    const file = join(cfgDir, `run-${run}`, judgmentFileName(id, hash));
    let doc = null;
    if (existsSync(file)) {
      try {
        const read = readJson(file);
        if (validate(schema, read).ok && read.status === 'ok' && read.id === id && read.run === run && read.text_hash === hash && read.config.config_id === configId) doc = read;
      } catch {
        doc = null;
      }
    }
    out.push(doc);
  }
  return out;
}

const entryOf = (doc, tag) => {
  const t = doc?.tags.find((x) => x.name === tag);
  return t ? { decision: t.decision, p: t.p, rule_ref: t.rule_ref, reason: t.reason, trigger: t.trigger, basis: t.basis } : null;
};

/**
 * Live columns of one claim from its judgment runs (the same rules as propose.mjs, for one claim):
 * { agent_tags, readiness, tag_confidence, states } where states maps each tag to its final state.
 */
export function liveColumns({ claim, perRun, tagNames, scope, polarity, decidedBy, fixPolarities, maxText }) {
  const currentTags = new Set(claim.agent_tags ?? []);
  const states = new Map();
  const ignored = new Set(); // tags this trial does not evaluate (nobody reads sources yet): they do not count toward Readiness
  const lines = [];
  const next = new Set([...currentTags].filter((t) => !tagNames.includes(t))); // tags this run does not judge stay as they are
  const n = perRun.length;
  const codeTags = new Set(scope.coded);
  for (const tag of tagNames) {
    let runsOut = perRun.map((doc, i) => {
      const e = entryOf(doc, tag);
      return e ? { run: i + 1, ...e } : null;
    });
    if (codeTags.has(tag)) { // decided by code from the sources count: the claim's own count, not whatever count the first judge run had
      const known = { run: 1, ...codeDecidedTag(tag, Number.isInteger(claim.sources_count) ? claim.sources_count : null, { sourceReading: scope.sourceReading }) };
      runsOut = runsOut.map((_, i) => ({ ...known, run: i + 1 }));
    }
    const verdict = decideVerdict(runsOut, n);
    const outcome = decidedBy.get(tag) ?? null;
    const final = outcome ? OUTCOME_DECISION[outcome] : verdict.decision;
    states.set(tag, final);
    const notEvaluated = verdict.unchecked && !outcome; // an editor's decision on such a tag is still a decision
    if (notEvaluated) ignored.add(tag);
    lines.push(tagLine(tag, verdict, outcome));
    if (final === 'apply') next.add(tag);
    else if ((final === 'error' || notEvaluated) && currentTags.has(tag)) next.add(tag); // nothing is known, so nothing changes
  }
  return {
    agent_tags: [...next].sort(compareCodePoints),
    readiness: readinessOf(states, { polarityOf: (t) => polarity.get(t), fixPolarities, ignored }),
    tag_confidence: capLines(lines, maxText),
    states,
  };
}

async function followup({ args, io, root, config, deps, now }) {
  const id = args.pull ?? latestPullId(root);
  if (!id) throw new ExitError(EXIT.INVALID, 'there is no pull yet: run pull.mjs --dbs rulebook,claims,tag_decisions,rule_changes first');
  const pf = preflight({ root, config, now, pullId: id });
  if (pf.code !== EXIT.OK) throw new ExitError(pf.code, pf.message);
  const pull = loadPull(root, id, { config });
  const need = ['rulebook', 'claims', 'tag_decisions', 'rule_changes'];
  for (const db of need) if (!pull.covers(db)) throw new ExitError(EXIT.INVALID, `pull ${id} does not include ${db}: run pull.mjs --dbs ${need.join(',')} first`);
  const rubric = readJson(join(root, 'rubric', 'rubric.json'));
  const lesson = resolveLesson(pull, args.lesson);
  if (lesson.status !== 'Live') throw new ExitError(EXIT.INVALID, `lesson "${lesson.lesson_key}" is ${lesson.status}, not Live: a follow-up checks what a live lesson changed`);
  const version = rubric.rubric_version;
  const lessonRef = lesson.lesson_id ?? lesson.lesson_key;

  const queue = readJsonl(join(pull.dir, 'norm', 'queue.jsonl')).rows;
  const claims = new Map(readJsonl(join(pull.dir, 'norm', 'claims.jsonl')).rows.map((c) => [c.geo_id, c]));
  const decidedRows = queue.filter((r) => OUTCOME_DECISION[r.effective_outcome] !== undefined);
  const supporting = queue.filter((r) => (r.lesson_page_ids ?? []).some((p) => normId(p) === normId(lesson.page_id)) && OUTCOME_DECISION[r.effective_outcome] !== undefined);
  const sameTag = decidedRows.filter((r) => r.tag === lesson.tag && !supporting.some((s) => s.key === r.key));
  if (!supporting.length) throw new ExitError(EXIT.INVALID, `lesson "${lesson.lesson_key}" has no decided supporting row in pull ${id}: nothing to follow up`);

  const wanted = new Set([...supporting, ...sameTag].map((r) => r.geo_id));
  const items = [...wanted].filter((g) => claims.has(g)).sort(compareCodePoints).map((g) => ({ id: g, claim: claims.get(g).claim, sources_count: claims.get(g).sources_count ?? null }));
  const runId = args['run-id'] ?? makeRunId('followup', now());
  const runDir = join(controlPaths(root).runs, runId);
  if (existsSync(join(runDir, 'plan.jsonl'))) throw new ExitError(EXIT.INVALID, `run "${runId}" already has a plan; pick another --run-id`);
  ensureDir(runDir);
  const itemsFile = join(runDir, 'items.jsonl');
  writeTextAtomic(itemsFile, items.length ? `${items.map((i) => JSON.stringify(i)).join('\n')}\n` : '');

  const runs = config.judge?.runs ?? 3;
  let meta = null;
  let judgeLines = [];
  if (items.length) {
    const judgeId = `${runId}-judge`;
    const argv = ['--items', itemsFile, '--runs', String(runs), '--run-id', judgeId];
    if (args.driver) argv.push('--driver', args.driver);
    if (args.model) argv.push('--model', args.model);
    const lines = [];
    const code = await judgeMain(argv, { out: (s) => lines.push(s), err: (s) => lines.push(s) }, {
      agentDir: root, runsDir: controlPaths(root).runs, env: deps.processEnv ?? process.env, now, runClaude: deps.runClaude, fakeState: deps.fakeState, bin: deps.judgeBin, spawnImpl: deps.spawnImpl, cliVersion: deps.cliVersion,
    });
    judgeLines = lines;
    if (code === EXIT.USAGE_WINDOW) throw new ExitError(code, `the usage window ran out while judging; the finished judgments are kept. Run the same command again when it reopens (${lines.at(-1) ?? ''})`);
    if (code === EXIT.DRIFT) throw new ExitError(code, 'the judge stopped: the rubric or the model did not match');
    if (code !== EXIT.OK) throw new ExitError(code === EXIT.INVALID ? EXIT.INVALID : EXIT.ERROR, `the judge failed (exit ${code}): ${lines.at(-1) ?? 'see run ' + judgeId}`);
    meta = readJson(join(controlPaths(root).runs, judgeId, 'run.json'));
  }

  // verdicts
  const schema = readJson(codeFile(root, 'schemas', 'judgment.schema.json'));
  const scope = scopeOf(rubric, config);
  const tagNames = [...scope.model, ...scope.coded].sort(compareCodePoints);
  const polarity = new Map(rubric.tags.map((t) => [t.name, t.polarity]));
  const fixPolarities = config.readiness?.fix_polarities ?? ['Issue'];
  const cfgDir = meta ? join(controlPaths(root).runs, 'judgments', meta.config16) : null;
  const perClaim = new Map();
  for (const it of items) {
    const perRun = readRuns({ cfgDir, runs, id: it.id, claim: it.claim, configId: meta.config_id, schema });
    perClaim.set(it.id, perRun.every(Boolean) ? perRun : null);
  }
  const verdictOf = (row) => {
    const perRun = perClaim.get(row.geo_id);
    if (!perRun) return null;
    return decideVerdict(perRun.map((doc, i) => {
      const e = entryOf(doc, row.tag);
      return e ? { run: i + 1, ...e } : null;
    }), runs);
  };
  const counts = { fixed: 0, still_wrong: 0, not_rerun: 0 };
  const outcomes = [];
  for (const row of supporting) {
    const v = verdictOf(row);
    let value = 'Not re-run';
    if (v && v.decision !== 'error') value = v.decision === OUTCOME_DECISION[row.effective_outcome] ? 'Fixed' : 'Still wrong';
    counts[value === 'Fixed' ? 'fixed' : value === 'Still wrong' ? 'still_wrong' : 'not_rerun'] += 1;
    outcomes.push({ key: row.key, page_id: row.page_id, value, verdict: v?.decision ?? null, expected: OUTCOME_DECISION[row.effective_outcome] });
  }
  const regression = { agree: 0, disagree: 0, not_judged: 0, disagreeing: [] };
  for (const row of sameTag) {
    const v = verdictOf(row);
    if (!v || v.decision === 'error') regression.not_judged += 1;
    else if (v.decision === OUTCOME_DECISION[row.effective_outcome]) regression.agree += 1;
    else {
      regression.disagree += 1;
      regression.disagreeing.push(row.key);
    }
  }

  // the plan
  const plan = openPlan({ runId, sourcePull: pull.id, root, config, pull, now });
  const stamp = `${version} · ${runId}`;
  for (const o of outcomes) plan.update('tag_decisions', o.key, o.page_id, { 'Agent follow-up': o.value, 'Follow-up run': stamp }, { note: `follow-up of "${lesson.lesson_key}": ${o.value}` });
  let claimsRefreshed = 0;
  const maxText = config.notion?.max_text ?? MAX_TEXT;
  const decidedByClaim = new Map();
  for (const r of decidedRows) {
    if (!decidedByClaim.has(r.geo_id)) decidedByClaim.set(r.geo_id, new Map());
    decidedByClaim.get(r.geo_id).set(r.tag, r.effective_outcome);
  }
  for (const it of items) {
    const perRun = perClaim.get(it.id);
    const claim = claims.get(it.id);
    if (!perRun) continue;
    const live = liveColumns({ claim, perRun, tagNames, scope, polarity, decidedBy: decidedByClaim.get(it.id) ?? new Map(), fixPolarities, maxText });
    const changed = {};
    if (!sameSet(live.agent_tags, claim.agent_tags)) changed['Agent tags'] = live.agent_tags.map((name) => ({ rulebook: name }));
    if (live.readiness !== claim.readiness) changed.Readiness = live.readiness;
    if (normaliseText(live.tag_confidence) !== normaliseText(claim.tag_confidence ?? '')) changed['Tag confidence'] = live.tag_confidence;
    if (stamp !== (claim.last_judged ?? '')) changed['Last judged'] = stamp;
    if (Object.keys(changed).length) {
      plan.update('claims', it.id, claim.page_id, changed, { note: 'live columns after the follow-up' });
      claimsRefreshed += 1;
    }
  }
  const cost = round6(meta?.cost_usd ?? 0);
  const model = meta?.model ?? config.models.judge;
  const headline = `Follow-up ${version}: ${counts.fixed} row(s) Fixed, ${counts.still_wrong} Still wrong, ${counts.not_rerun} Not re-run`;
  const summary = `${headline}. Lesson ${lessonRef} "${lesson.lesson_key}". Other decided rows on ${lesson.tag}: ${regression.agree} still agree, ${regression.disagree} now disagree${regression.disagree ? ` (${regression.disagreeing.slice(0, 4).map((k) => k.split('::')[0].slice(0, 8)).join(', ')})` : ''}${regression.not_judged ? `, ${regression.not_judged} not judged` : ''}.`;
  const runTitle = (() => {
    const known = new Set(pull.covers('runs') && existsSync(join(pull.dir, 'norm', 'runs.jsonl')) ? readJsonl(join(pull.dir, 'norm', 'runs.jsonl')).rows.map((r) => r.title) : []);
    const base = `Follow-up ${version} · ${lessonRef}`;
    let title = base;
    let n = 2;
    while (known.has(title) || pull.idMap?.runs?.[title]) title = `${base} (${n++})`;
    return title;
  })();
  plan.create('runs', runTitle, {
    Kind: 'Follow-up', 'Rubric version': version, Started: now().toISOString(), 'Claims judged': items.length, Verdict: 'n/a', Summary: summary.slice(0, MAX_TEXT), Model: model, 'Cost USD': cost,
    Lesson: [{ rule_changes: lesson.lesson_key }],
  }, {
    content_md: ['## Follow-up', summary, '', '## Supporting rows', ...outcomes.map((o) => `- ${o.key}: ${o.value} (the judge now says ${o.verdict ?? 'nothing'}, the editor said ${o.expected})`),
      ...(regression.disagree ? ['', '## Decided rows on this tag that now disagree', ...regression.disagreeing.map((k) => `- ${k}`)] : [])].join('\n'),
  });
  const notes = [];
  if (pull.covers('agent_settings') && pull.idMap?.agent_settings?.[config.agent]) {
    plan.update('agent_settings', config.agent, null, { 'Last run at': now().toISOString(), 'Last run summary': `${headline} (${lessonRef})`.slice(0, MAX_TEXT) });
  } else notes.push('Agent settings were not updated (the pull has no Agent settings)');
  const written = plan.write();
  writeJsonAtomic(join(runDir, 'run.json'), {
    run_id: runId, kind: 'followup', status: 'done', lesson_key: lesson.lesson_key, lesson_id: lesson.lesson_id ?? null, rubric_version: version, judge_run: meta?.run_id ?? null, items: items.length,
    counts, regression, claims_refreshed: claimsRefreshed, started: now().toISOString(), judge_cost_usd: cost, plan: written.path,
  });
  io.out(`followup: ${lessonRef} · rubric ${version}: ${counts.fixed} Fixed, ${counts.still_wrong} Still wrong, ${counts.not_rerun} Not re-run; ${regression.agree} of ${regression.agree + regression.disagree} other decided ${lesson.tag} rows still agree; ${claimsRefreshed} claim(s) refreshed; $${cost.toFixed(4)}; plan ${written.path}; next: node agents/claim-tagger/scripts/plan.mjs check --run ${runId}; node agents/claim-tagger/scripts/apply.mjs --run ${runId}`);
  for (const n of notes) io.err(`followup: ${n}`);
  if (judgeLines.some((l) => /error=[1-9]/.test(l))) io.err('followup: some judge cells failed; their claims show as Not re-run');
  return EXIT.OK;
}

// ---- command line --------------------------------------------------------------------------------------------------------------------------

const defaultIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

/** Run the script; returns the exit code. deps (tests): root, now, config, runClaude, fakeState, judgeBin, spawnImpl, cliVersion, processEnv. */
export async function main(argv, io = defaultIo, deps = {}) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: { lesson: { type: 'string' }, pull: { type: 'string' }, 'run-id': { type: 'string' }, driver: { type: 'string' }, model: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
      strict: true,
      allowPositionals: false,
    }).values;
    if (!args.help && !args.lesson) throw new UsageError('--lesson is required');
    if (args.driver && !['cli', 'fake'].includes(args.driver)) throw new UsageError(`--driver must be cli or fake, got "${args.driver}"`);
    if (args['run-id'] !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args['run-id'])) throw new UsageError(`--run-id may only use letters, digits, '.', '_' and '-', got "${args['run-id']}"`);
  } catch (e) {
    io.err(`followup: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (args.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  try {
    const root = deps.root ?? agentRoot();
    const config = deps.config ?? loadConfig(root);
    return await followup({ args, io, root, config, deps, now: deps.now ?? (() => new Date()) });
  } catch (e) {
    if (e instanceof ExitError) {
      io.err(`followup: ${e.message}`);
      return e.code;
    }
    if (e.name === 'PlanError' || e.code === 'ALLOWLIST') {
      io.err(`followup: ${e.message}${e.problems?.length ? `\n  ${e.problems.join('\n  ')}` : ''}`);
      return EXIT.INVALID;
    }
    io.err(`followup: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
