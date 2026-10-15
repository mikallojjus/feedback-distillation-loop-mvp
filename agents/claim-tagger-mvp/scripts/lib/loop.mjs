// The harness the loop scripts (propose, distill, promote, followup, rollback, restore, status) run inside, so that each of them is only its own
// decisions. One run is one folder, runs/<run-id>/, with run.json written first and last (CONTRACTS section 10), the plan and its ledger, the
// request log of what was sent to Notion, and the report (report.json and report.md, the three parts of section 9). Nothing here decides what a
// script means; it does the things every script does the same way.
//
//   parseCli(script, argv, options, usage, io)   parse a command line: { values } or { exit }
//   resumeLine(script, parts)          "node agents/claim-tagger-mvp/scripts/<script>.mjs <parts>" for run.json
//   withRun({ script, label, opts, args, resume }, body)   open the run, load the config, call body(ctx), write the report and run.json, print the
//                                                          report, return { exit, runId, runDir, report, ...details }. body returns
//                                                          { exit?, sentence, header?, rows?, next, details? } or throws a LoopExit.
//                                                          On a practice page (a demo profile) the report says "/claim-tagger demo <command>" and
//                                                          its first sentence names the practice page (reportWords, editor-words.mjs).
//   class LoopExit(code, message, { sentence, header, rows, next })   end the run with an exit code and the words of its report
//   takePull(ctx, { pullId })          pull every table (or load --pull <id>), set ctx.pull (loadPull) and put its id into run.json
//   needTables(ctx, ...tables)         LoopExit(2) unless the pull holds those tables
//   runPreflight(ctx, { adopt })       lib/preflight.mjs; a refusal ends the run with its report; sets ctx.edition
//   confirmUnchanged(ctx, { lesson, copy, tag, status })   read the Rulebook copy row and the rule change again right before they are written
//   pickLesson(ctx, title, { status, command })   the Rule changes row to work on, or a LoopExit with a report that says why not
//   childRun(ctx, suffix, { script, label }) / closeChild(child, exit)   a run inside a run, with its own folder, plan and ledger
//   applyInChild(ctx, suffix, makePlan)   apply the bookkeeping that may only follow a confirmed Rulebook copy write, in a run of its own
//   liveRubric(ctx)                    the rulebook in force, verified, or a LoopExit
//   addSettingsOp(ctx, plan, summary)  the Agent settings update (edition and last run summary) that ends a plan
//   notionClient(ctx)                  the REST client for writes (request log in the run folder); LoopExit(2) without a token
//   applyStep(ctx, plan)               check, write (plan.jsonl), apply with ledger and read-back; { result, planned } (planned only: --plan-only)
//   assertApplied(ctx, result, again)  LoopExit unless the read-back confirmed every write; `again` is the command to continue with
//   judgeSettings(ctx)                 loadJudgeConfig(root): { judge, model, tags, reasonMaxWords, demo }
//   callModel(ctx, {...})              one runClaude call with the transient retries of judge.transient
//   claudeBin(ctx), cliVersionOf(ctx)  the program and its version (the fake driver has its own)
//   modelStop(ctx, res, { wrote })     the LoopExit for a call that hit the usage window, kept failing, could not start or answered with another model
//   runJudge(ctx, opts)                judge() with the hooks of this run and no output; throws a LoopExit when the judge did not finish
//   usageOf(res), addUsage(a, b)       the tokens of a call (never shown to an editor)
//   commitRubric(ctx, message)         git add + commit of the rubric folder in production, when allowed
//   readEvals(root)                    the examples (evals/canaries.jsonl) and the earlier decisions (evals/cases.jsonl) as plain lists
//   supportingKeysOf(ctx, lesson)      the keys a lesson rests on, with the ones the page body holds when the cell was cut

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cutText, demoCommands, listNames, namePracticePage, quoted, viewLink } from './editor-words.mjs';
import { claudeVersion, findClaudeBin, runClaude, withTransientRetry } from './claude.mjs';
import { isDemo, loadConfig } from './config.mjs';
import { EXIT } from './exit-codes.mjs';
import { readJson, readJsonl, writeJsonAtomic } from './jsonl.mjs';
import { clientFromConfig, requestLogger } from './notion-rest.mjs';
import { decodePage, sameValue } from './notion-values.mjs';
import { agentRoot, codeRoot, ensureDir, repoRoot, runId as makeRunId, safeName } from './paths.mjs';
import { applyPlan, checkPlan } from './plan.mjs';
import { writeReport } from './report.mjs';
import { preflight, refusedReport } from './preflight.mjs';
import { readRubric } from './rubric.mjs';
import { judge, loadJudgeConfig } from '../judge.mjs';
import { loadPull, pull, supportingKeys as parseSupportingKeys } from '../pull.mjs';

/** A promote lock (runs/PROMOTING.json) older than this is stale and is taken over; younger, it means a safety check is running. */
export const LOCK_STALE_MS = 2 * 60 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9._-]+$/;
const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };
const quietIo = (sink) => ({ out: () => {}, err: (s) => sink.push(String(s)) });
const oneLine = (s, n = 400) => cutText(s, n);

/** The end of a run: an exit code, a message for the engineer (stderr) and the words of the report. */
export class LoopExit extends Error {
  constructor(code, message, { sentence, header, rows, next } = {}) {
    super(message);
    this.name = 'LoopExit';
    this.code = code;
    this.sentence = sentence;
    this.header = header;
    this.rows = rows;
    this.next = next;
  }
}

const ENGINEER = 'Next: ask the engineer to look at the message the script printed.';

// ---- the command line -----------------------------------------------------------------------------------------------------------------

/**
 * Parse a command line with node:util parseArgs (strict). `options` is parseArgs' option table; --help and --driver (cli or fake) are added here.
 * Returns { values } or, when the command should end at once, { exit } (0 after --help, 2 after a mistake in the command, printed with the usage).
 */
export function parseCli(script, argv, options, usage, io = consoleIo) {
  try {
    const { values } = parseArgs({
      args: argv, options: { ...options, driver: { type: 'string' }, help: { type: 'boolean', short: 'h' } }, strict: true, allowPositionals: false,
    });
    if (values.help) {
      io.out(usage);
      return { exit: EXIT.OK };
    }
    if (values.driver !== undefined && !['cli', 'fake'].includes(values.driver)) throw new Error(`--driver must be cli or fake, got "${values.driver}"`);
    if (values['run-id'] !== undefined && !ID_RE.test(values['run-id'])) throw new Error(`--run-id may only use letters, digits, '.', '_' and '-', got "${values['run-id']}"`);
    if (values.pull !== undefined && !ID_RE.test(values.pull)) throw new Error(`--pull may only use letters, digits, '.', '_' and '-', got "${values.pull}"`);
    return { values };
  } catch (e) {
    io.err(`${script}: ${e.message}\n${usage}`);
    return { exit: EXIT.INVALID };
  }
}

/** The command as an engineer would type it to continue: the script and the arguments that name what it works on. */
export function resumeLine(script, parts = []) {
  const quote = (s) => (/^[A-Za-z0-9._:/=-]+$/.test(s) ? s : `"${String(s).replace(/"/g, '\\"')}"`);
  return ['node', `agents/claim-tagger-mvp/scripts/${script}.mjs`, ...parts.map((p) => quote(String(p)))].join(' ');
}

// ---- opening and closing a run ----------------------------------------------------------------------------------------------------

function openRun({ script, label, again, opts, args, resume }) {
  const root = resolve(opts.root ?? agentRoot());
  const now = opts.now ?? (() => new Date());
  const runsDir = join(root, 'runs');
  let id;
  const asked = opts.runId ?? opts.run_id;
  if (asked !== undefined && asked !== null) {
    if (!ID_RE.test(String(asked))) throw new LoopExit(EXIT.INVALID, `--run-id may only use letters, digits, '.', '_' and '-', got "${asked}"`);
    id = String(asked);
    if (existsSync(join(runsDir, id))) throw new LoopExit(EXIT.INVALID, `a run folder named ${id} already exists; pick another --run-id`);
  } else {
    const stamp = makeRunId(script, now());
    id = stamp;
    for (let n = 2; existsSync(join(runsDir, id)); n++) id = `${stamp}-${n}`;
  }
  const ctx = {
    script,
    label,
    again: again ?? '/claim-tagger',
    opts,
    root,
    io: opts.io ?? consoleIo,
    now,
    env: opts.env ?? process.env,
    driver: opts.driver ?? 'cli',
    fakeState: opts.fakeState ?? {},
    runId: safeName(id),
    runDir: join(runsDir, safeName(id)),
    warnings: [],
    notes: [],
    config: null,
    demo: false,
    pull: null,
    edition: null,
    client: null,
    jcfg: null,
    bin: null,
  };
  ensureDir(ctx.runDir);
  ctx.record = {
    run_id: ctx.runId,
    script,
    args: args ?? {},
    started_at: now().toISOString(),
    finished_at: null,
    exit_code: null,
    rubric_edition: null,
    pull_id: null,
    resume: resume ?? `node agents/claim-tagger-mvp/scripts/${script}.mjs`,
    status: 'running',
  };
  saveRecord(ctx);
  return ctx;
}

const saveRecord = (ctx) => writeJsonAtomic(join(ctx.runDir, 'run.json'), ctx.record);

function describeFailure(ctx, e) {
  if (e instanceof LoopExit) return { exit: e.code, message: e.message, sentence: e.sentence, header: e.header, rows: e.rows, next: e.next };
  if (e && e.name === 'ExitError') return { exit: e.code ?? EXIT.INVALID, message: e.message, sentence: e.sentence, next: e.next };
  return { exit: EXIT.ERROR, message: `unexpected error: ${e?.stack ?? e?.message ?? e}`, sentence: `${ctx.label} stopped on an unexpected error.` };
}

/**
 * The words of a report as the editor reads them. On a practice page (a demo profile) the commands are the demo ones ("/claim-tagger demo promote",
 * so that nobody runs the real command from the practice page) and the first sentence names the practice page (editor-words.mjs). The sentence
 * without the page's name comes second: a title the report lint refuses must not cost the editor the report.
 */
function reportWords(ctx, sentence, next) {
  if (!ctx.demo) return { sentences: [sentence], next };
  const plain = demoCommands(sentence);
  return { sentences: [...new Set([namePracticePage(ctx.config, plain), plain])], next: demoCommands(next) };
}

function finishRun(ctx, out) {
  const exit = out.exit ?? EXIT.OK;
  const words = reportWords(ctx, out.sentence ?? `${ctx.label} stopped on an unexpected error.`, out.next ?? ENGINEER);
  const next = words.next;
  const why = (err) => oneLine(err.problems ? err.problems.join('; ') : err.message);
  let written = null;
  let problem = null;
  for (const sentence of words.sentences) {
    try {
      written = writeReport(ctx.runDir, { demo: ctx.demo, sentence, header: out.header, rows: out.rows ?? [], next });
      if (problem) ctx.warnings.push(`the sentence of report.md does not name the practice page, because that did not pass the report lint: ${why(problem)}`);
      break;
    } catch (err) {
      problem ??= err;
    }
  }
  if (!written) {
    ctx.warnings.push(`report.md was not written as planned: ${why(problem)}`);
    try {
      written = writeReport(ctx.runDir, { demo: false, sentence: `${ctx.label} finished.`, rows: [], next: ENGINEER });
    } catch {
      written = null;
    }
  }
  Object.assign(ctx.record, {
    finished_at: ctx.now().toISOString(),
    exit_code: exit,
    status: [EXIT.OK, EXIT.HOLD, EXIT.FAIL].includes(exit) ? 'done' : 'stopped', // a HOLD or a FAIL of the safety check is a result, not a stop
    ...(out.message ? { message: oneLine(out.message, 600) } : {}),
    ...(ctx.warnings.length ? { warnings: [...ctx.warnings] } : {}),
    ...(out.counts ? { counts: out.counts } : {}),
  });
  saveRecord(ctx);
  for (const w of ctx.warnings) ctx.io.err(`${ctx.script}: warning: ${w}`);
  if (out.message && exit !== EXIT.OK) ctx.io.err(`${ctx.script}: ${out.message}`);
  if (out.print !== undefined) ctx.io.out(out.print);
  else if (written) ctx.io.out(written.markdown.trimEnd());
  return { exit, runId: ctx.runId, runDir: ctx.runDir, report: written?.report ?? null, markdown: written?.markdown ?? null, ...(out.details ?? {}) };
}

/** Open the run, load the configuration, run `body(ctx)` and close the run with its report. Never throws for a failed run: the exit code says what happened. */
export async function withRun({ script, label, again = '/claim-tagger', opts = {}, args = {}, resume = null }, body) {
  let ctx;
  try {
    ctx = openRun({ script, label, again, opts, args, resume });
  } catch (e) {
    (opts.io ?? consoleIo).err(`${script}: ${e.message}`);
    return { exit: e instanceof LoopExit ? e.code : EXIT.ERROR, runId: null, runDir: null, report: null, markdown: null };
  }
  let out;
  try {
    try {
      ctx.config = opts.config ?? loadConfig(ctx.root);
    } catch (e) {
      throw new LoopExit(EXIT.INVALID, e.message, { sentence: `${label}: nothing was done, because config.json is not valid.`, next: ENGINEER });
    }
    ctx.demo = isDemo(ctx.config);
    out = await body(ctx);
  } catch (e) {
    const f = describeFailure(ctx, e);
    out = {
      exit: f.exit,
      message: f.message,
      sentence: f.sentence ?? `${label} stopped on an unexpected error.`,
      header: f.header,
      rows: f.rows,
      next: f.next ?? (f.exit === EXIT.ERROR ? `${ENGINEER.slice(0, -1)}, then try again.` : ENGINEER),
    };
  }
  return finishRun(ctx, out);
}

// ---- reading Notion -----------------------------------------------------------------------------------------------------------------

const TABLE_WORDS = { rulebook: 'Rulebook copy', claims_copy: 'Claims copy', tag_decisions: 'Tag decisions', rule_changes: 'Rule changes', agent_settings: 'Agent settings' };

/** Pull every table of the agent (or load the pull named by --pull) and make it ctx.pull. A pull with duplicate keys or a missing key column ends the run. */
export async function takePull(ctx, { pullId = ctx.opts.pull ?? null } = {}) {
  if (pullId) {
    try {
      ctx.pull = loadPull(ctx.root, pullId, { config: ctx.config });
    } catch (e) {
      throw new LoopExit(EXIT.INVALID, e.message, { sentence: `${ctx.label}: nothing was done, because that pull does not exist.`, next: ENGINEER });
    }
  } else {
    let r;
    try {
      r = await pull({
        root: ctx.root, config: ctx.config, tables: 'all', fetchImpl: ctx.opts.fetchImpl, token: ctx.opts.token, repoRoot: ctx.opts.repoRoot, sleep: ctx.opts.sleep, now: ctx.now,
      });
    } catch (e) {
      const refused = e?.name === 'NotionError' && [401, 403, 404].includes(e.status);
      const noToken = /no NOTION_TOKEN/.test(e?.message ?? '');
      if (refused || noToken || e?.constructor?.name === 'UsageError') {
        throw new LoopExit(EXIT.INVALID, e.message, {
          sentence: `${ctx.label}: nothing was done, because ${noToken ? 'there is no Notion token for the scripts' : 'Notion refused the request'}.`,
          next: 'Next: ask the engineer to check the Notion token and that the integration is connected to the page.',
        });
      }
      throw new LoopExit(EXIT.ERROR, `the pull failed: ${e?.message ?? e}`, {
        sentence: `${ctx.label}: nothing was done, because Notion could not be read.`,
        next: `Next: type ${ctx.again} again in a while.`,
      });
    }
    for (const w of r.warnings ?? []) ctx.warnings.push(`pull: ${w}`);
    if (r.code !== EXIT.OK) {
      const dup = r.duplicates?.[0];
      const why = dup ? `the ${TABLE_WORDS[dup.table] ?? dup.table} table has two rows with the same key` : 'a table is missing the column that keys its rows';
      throw new LoopExit(EXIT.INVALID, `${r.line}; ${[...(r.problems ?? []), ...(r.duplicates ?? []).map((d) => `duplicate key in ${d.table}: "${d.key}"`)].join('; ')}`, {
        sentence: `${ctx.label}: nothing was done, because ${why}.`,
        next: ENGINEER,
      });
    }
    ctx.pull = loadPull(ctx.root, r.pullId, { config: ctx.config });
  }
  ctx.record.pull_id = ctx.pull.id;
  saveRecord(ctx);
  return ctx.pull;
}

/** Stop with exit 2 unless the pull holds every one of these tables (a table that setup has not made yet is not in it). */
export function needTables(ctx, ...tables) {
  const missing = tables.filter((t) => !ctx.pull.covers(t));
  if (missing.length) {
    throw new LoopExit(EXIT.INVALID, `the pull does not hold ${missing.join(', ')}`, {
      sentence: `${ctx.label}: nothing was done, because the ${missing.map((t) => TABLE_WORDS[t] ?? t).join(' and ')} table ${missing.length === 1 ? 'is' : 'are'} not set up yet.`,
      next: 'Next: ask the engineer to finish the setup.',
    });
  }
}

/**
 * The checks every command starts with (lib/preflight.mjs). A refusal ends the run with exit 3 or 4 and its report. With allowDrift (restore, which is the
 * answer to a drift) a drift is returned instead, with ok false and kind "drift"; a pause or a bad rulebook file still ends the run.
 */
export function runPreflight(ctx, { adopt = true, allowDrift = false } = {}) {
  const pre = preflight({ root: ctx.root, config: ctx.config, pullId: ctx.pull?.id ?? null, now: ctx.now, adopt });
  ctx.warnings.push(...pre.warnings);
  if (pre.adopted.length) ctx.record.adopted = pre.adopted;
  if (!pre.ok && allowDrift && pre.kind === 'drift') {
    ctx.edition = readRubric(ctx.root)?.edition ?? null; // restore answers a drift: it goes on, and says what it saw
    return pre;
  }
  if (!pre.ok) {
    const report = refusedReport(ctx.config, pre, ctx.label);
    throw new LoopExit(pre.code, pre.reason, { sentence: report.sentence, rows: report.rows, next: report.next });
  }
  ctx.edition = pre.edition;
  ctx.record.rubric_edition = pre.edition;
  saveRecord(ctx);
  return pre;
}

const STATUS_WORD = { Proposed: 'proposed', Approved: 'approved', Rejected: 'rejected', Live: 'live', 'Rolled back': 'rolled back' };

/**
 * The lesson (Rule changes row) a command works on. With a title: the row of that title, which must have Status `status`. Without: the only row with that
 * Status. Anything else ends the run with exit 2 and a report that says why and what to do. `command` is the slash command to name ("/claim-tagger promote").
 */
export function pickLesson(ctx, title, { status, command }) {
  const lessons = ctx.pull.lessons() ?? [];
  const link = viewLink(ctx.config, 'lessons_waiting');
  const stop = (message, sentence, next) => new LoopExit(EXIT.INVALID, message, { sentence: `${ctx.label}: nothing was done, because ${sentence}.`, next });
  const wanted = STATUS_WORD[status];
  if (title !== undefined && title !== null && String(title).trim() !== '') {
    const t = String(title).trim();
    const found = lessons.find((l) => l.Lesson === t) ?? lessons.find((l) => String(l.Lesson).trim().toLowerCase() === t.toLowerCase());
    if (!found) throw stop(`no rule change is called "${t}"`, `there is no rule change called ${quoted(t)}`, `Next: pick one from Lessons waiting (${link}).`);
    if (found.Status !== status) {
      const now = STATUS_WORD[found.Status] ?? String(found.Status).toLowerCase();
      const next = status === 'Approved'
        ? (found.Status === 'Live' ? 'Next: type /claim-tagger status to see what is open.' : `Next: approve it in Lessons waiting (${link}) first.`)
        : (found.Status === 'Approved' ? 'Next: type /claim-tagger promote to check it first.' : `Next: approve it in Lessons waiting (${link}) and type /claim-tagger promote.`);
      throw stop(`"${found.Lesson}" is ${now}, not ${wanted}`, `${quoted(found.Lesson)} is ${now}, not ${wanted}`, next);
    }
    return found;
  }
  const open = lessons.filter((l) => l.Status === status);
  if (open.length === 0) {
    throw stop(`no rule change is ${wanted}`, `no rule change is ${wanted} yet`, status === 'Approved' ? `Next: approve a rule change in Lessons waiting (${link}).` : 'Next: type /claim-tagger status to see what is open.');
  }
  if (open.length > 1) {
    const names = listNames(open.slice(0, 4).map((l) => quoted(l.Lesson, 40)));
    throw stop(`${open.length} rule changes are ${wanted}: ${open.map((l) => l.Lesson).join('; ')}`, `${open.length} rule changes are ${wanted}: ${names}${open.length > 4 ? ' and more' : ''}`, `Next: type ${command} with the title of the one you mean.`);
  }
  return open[0];
}

/**
 * A run inside a run: its own folder runs/<run-id>-<suffix>/ with its own run.json, plan and ledger, sharing the pull, the client and the warnings of the
 * parent. promote's automatic follow-up runs in one. Close it with closeChild(child, exit).
 */
export function childRun(ctx, suffix, { script, label }) {
  const runId = safeName(`${ctx.runId}-${suffix}`);
  const child = {
    ...ctx, script, label, runId, runDir: join(ctx.root, 'runs', runId), warnings: ctx.warnings, notes: ctx.notes,
  };
  ensureDir(child.runDir);
  child.record = {
    run_id: runId, script, args: { parent: ctx.runId }, started_at: ctx.now().toISOString(), finished_at: null, exit_code: null, rubric_edition: ctx.record.rubric_edition,
    pull_id: ctx.record.pull_id, resume: ctx.record.resume, status: 'running',
  };
  saveRecord(child);
  return child;
}

export function closeChild(child, exit, extra = {}) {
  Object.assign(child.record, { finished_at: child.now().toISOString(), exit_code: exit, status: exit === EXIT.OK ? 'done' : 'stopped', ...extra });
  saveRecord(child);
}

/**
 * The last look before the Rulebook copy and a rule change are written. A check can take a while and the plan's `expect` only compares with the pull the run
 * started from, so the two rows are read from Notion again: the Rulebook copy's When to use must still be what the run started from (else exit 4: a person
 * edited it meanwhile) and the rule change must still have Status `status` (else exit 2: an editor changed their mind). `copy` is null when the Rulebook copy
 * is not going to be written.
 */
export async function confirmUnchanged(ctx, { lesson, copy, tag, status }) {
  const client = notionClient(ctx);
  const propsOf = (table, page) => decodePage(page, ctx.pull.schema(table)).props;
  if (copy?.page_id) {
    const fresh = propsOf('rulebook', await client.retrievePage(copy.page_id));
    if (!sameValue('rich_text', fresh['When to use'] ?? '', copy['When to use'] ?? '')) {
      throw new LoopExit(EXIT.DRIFT, `the Rulebook copy's When to use for ${tag} was edited in Notion while ${ctx.label} ran`, {
        sentence: `${ctx.label}: nothing was changed, because the rulebook text in Notion was edited while it ran.`,
        next: `Next: put the rulebook text back on ${tag} (${viewLink(ctx.config, 'rulebook')}), or ask the engineer to restore an edition.`,
      });
    }
  }
  if (lesson?.page_id) {
    const row = propsOf('rule_changes', await client.retrievePage(lesson.page_id));
    if (row.Status !== status) {
      throw new LoopExit(EXIT.INVALID, `the rule change "${lesson.Lesson}" is ${row.Status} in Notion now`, {
        sentence: `${ctx.label}: nothing was changed, because ${quoted(lesson.Lesson)} is not ${STATUS_WORD[status] ?? status} any more.`,
        next: `Next: look at it in Lessons waiting (${viewLink(ctx.config, 'lessons_waiting')}).`,
      });
    }
  }
}

/** The rulebook in force (rubric/rubric.json, schema and hashes verified), or a LoopExit: exit 4 when the file is not valid, exit 2 before the first edition. */
export function liveRubric(ctx) {
  let rubric;
  try {
    rubric = readRubric(ctx.root);
  } catch (e) {
    throw new LoopExit(EXIT.DRIFT, e.message, { sentence: `${ctx.label}: nothing was done, because the rulebook file on disk no longer matches its own checks.`, next: 'Next: ask the engineer to restore the rulebook file.' });
  }
  if (!rubric) {
    throw new LoopExit(EXIT.INVALID, `${join(ctx.root, 'rubric', 'rubric.json')} does not exist`, { sentence: `${ctx.label}: nothing was done, because the rulebook has no edition yet.`, next: 'Next: ask the engineer to finish the setup.' });
  }
  return rubric;
}

/**
 * The Agent settings update that ends every writing command: the edition in force and the last run summary. The row is found in the pull; without
 * one (setup has not made it) nothing is added and the run says so in its warnings.
 */
export function addSettingsOp(ctx, plan, summary, edition = ctx.edition) {
  const s = ctx.pull.settings();
  if (!s?.page_id || !s.name) {
    ctx.warnings.push('Agent settings has no row yet, so the last run summary was not written');
    return null;
  }
  return plan.update('agent_settings', s.name, s.page_id, { 'Rulebook edition': edition, 'Last run summary': summary });
}

/** The REST client for the writes of this run (and its request log, runs/<run-id>/requests.jsonl). */
export function notionClient(ctx) {
  if (ctx.client) return ctx.client;
  const client = ctx.opts.client ?? clientFromConfig(ctx.config, {
    fetchImpl: ctx.opts.fetchImpl, token: ctx.opts.token, repoRoot: ctx.opts.repoRoot, sleep: ctx.opts.sleep, log: requestLogger(join(ctx.runDir, 'requests.jsonl')),
  });
  if (!client) {
    throw new LoopExit(EXIT.INVALID, 'there is no NOTION_TOKEN in .env', {
      sentence: `${ctx.label}: nothing was written, because there is no Notion token for the scripts.`,
      next: 'Next: ask the engineer to add the Notion token.',
    });
  }
  ctx.client = client;
  return client;
}

// ---- writing Notion -------------------------------------------------------------------------------------------------------------------

/**
 * Check the plan, write plan.jsonl, and (unless opts.planOnly) apply it with the ledger and the read-back. Returns { planned, result, ops }:
 * result is applyPlan's answer (null for a plan-only run or a plan with no ops). A plan the check refuses, or one applyPlan cannot send, ends the
 * run with exit 2 before anything is sent.
 */
export async function applyStep(ctx, plan) {
  const checked = checkPlan(plan, ctx.config, { root: ctx.root });
  if (!checked.ok) {
    ctx.record.plan_problems = checked.problems.slice(0, 10);
    saveRecord(ctx);
    throw new LoopExit(EXIT.INVALID, `the plan was refused and nothing was sent: ${checked.problems.slice(0, 5).join('; ')}`, {
      sentence: `${ctx.label}: nothing was written, because the plan breaks a rule about what the agent may write.`,
      next: ENGINEER,
    });
  }
  try {
    plan.write(ctx.runDir);
  } catch (e) {
    throw new LoopExit(EXIT.INVALID, `${e.message}${e.problems?.length ? `: ${e.problems.slice(0, 5).join('; ')}` : ''}`, {
      sentence: `${ctx.label}: nothing was written, because the plan could not be saved.`,
      next: ENGINEER,
    });
  }
  ctx.record.plan = { creates: checked.counts.creates, updates: checked.counts.updates };
  saveRecord(ctx);
  if (ctx.opts.planOnly || plan.ops.length === 0) return { planned: true, result: null, ops: plan.ops };
  const client = notionClient(ctx);
  const tables = [...new Set(plan.ops.map((o) => o.table))];
  let result;
  try {
    result = await applyPlan({
      plan,
      dir: ctx.runDir,
      client,
      config: ctx.config,
      schemas: Object.fromEntries(tables.map((t) => [t, ctx.pull.schema(t)])),
      pulled: ctx.pull.pulled(tables),
      root: ctx.root,
      now: ctx.now,
      log: ctx.opts.verbose ? (line) => ctx.io.err(`${ctx.script}: ${line}`) : null,
    });
  } catch (e) {
    if (e?.name === 'PlanError') {
      throw new LoopExit(EXIT.INVALID, `${e.message}${e.problems?.length ? `: ${e.problems.slice(0, 5).join('; ')}` : ''}`, {
        sentence: `${ctx.label}: nothing was written, because the plan cannot be sent as it stands.`,
        next: ENGINEER,
      });
    }
    throw e;
  }
  ctx.record.apply = {
    done: result.done, failed: result.failed, skipped: result.skipped, mismatches: result.mismatches, uncertain: result.uncertain, unchecked: result.unchecked, pending: result.pending,
  };
  saveRecord(ctx);
  return { planned: true, result, ops: plan.ops };
}

/**
 * Apply writes that must only happen once an earlier step is confirmed, in a run of their own (runs/<run-id>-<suffix>/, with its plan, ledger and request log).
 * applyPlan goes on after a failed write, so the bookkeeping that follows a change of the Rulebook copy (the rule change set Live, the edition in Agent settings)
 * is never part of the plan that writes the Rulebook copy: it is planned and applied here, after the Rulebook copy has been written and read back.
 * `makePlan(child)` builds the plan for the child run; the answer is applyStep's, after assertApplied. A failure is thrown as it is (a LoopExit).
 */
export async function applyInChild(ctx, suffix, makePlan) {
  const child = childRun(ctx, suffix, { script: ctx.script, label: ctx.label });
  try {
    const applied = await applyStep(child, makePlan(child));
    assertApplied(child, applied.result);
    closeChild(child, EXIT.OK);
    return applied;
  } catch (e) {
    closeChild(child, e?.code ?? EXIT.ERROR, { message: e?.message });
    throw e;
  }
}

/** Success is claimed only when the read-back confirmed every write: anything else ends the run, with the command to continue. */
export function assertApplied(ctx, result, again = ctx.again) {
  if (!result || result.code === EXIT.OK) return;
  if (result.mismatches > 0) {
    throw new LoopExit(EXIT.INVALID, `the read-back differs from what was written for ${result.mismatches} write(s): ${result.lists.mismatches.slice(0, 3).map((m) => `${m.table} "${m.key}" ${m.detail ?? ''}`).join('; ')}`, {
      sentence: `${ctx.label} stopped: Notion does not hold what was written for ${result.mismatches === 1 ? 'one row' : `${result.mismatches} rows`}.`,
      next: ENGINEER,
    });
  }
  const left = result.failed + result.uncertain + result.unchecked + result.pending;
  throw new LoopExit(EXIT.ERROR, `${left} write(s) did not finish: ${[...result.lists.failed, ...result.lists.uncertain, ...result.lists.unchecked].slice(0, 3).map((m) => `${m.table} "${m.key}" ${m.detail ?? ''}`).join('; ') || 'not reached'}`, {
    sentence: `${ctx.label} stopped before every change was written to Notion.`,
    next: `Next: type ${again} again; it continues where it stopped.`,
  });
}

// ---- the model --------------------------------------------------------------------------------------------------------------------------

/** The judge's settings (loadJudgeConfig of the state folder), cached for the run; a config the judge refuses ends the run with exit 2. */
export function judgeSettings(ctx) {
  if (!ctx.jcfg) {
    try {
      ctx.jcfg = loadJudgeConfig(ctx.root);
    } catch (e) {
      throw new LoopExit(EXIT.INVALID, e.message, { sentence: `${ctx.label}: nothing was done, because config.json is not valid.`, next: ENGINEER });
    }
  }
  return ctx.jcfg;
}

/** Where the claude program is: the configured name for the fake driver, else the program `where` finds (or opts.bin). */
export function claudeBin(ctx) {
  const j = judgeSettings(ctx).judge;
  ctx.bin ??= ctx.driver === 'fake' ? j.claude_bin : (ctx.opts.bin ?? findClaudeBin(j.claude_bin));
  return ctx.bin;
}

/** The CLI version that is noted on every stored answer (the fake driver has its own). */
export function cliVersionOf(ctx) {
  ctx.cliVersion ??= ctx.driver === 'fake' ? '0.0.0-fake' : (ctx.opts.cliVersion ?? claudeVersion(claudeBin(ctx), { env: ctx.env }));
  return ctx.cliVersion;
}

/** One headless call (lib/claude.mjs) with the transient retries of judge.transient. Returns runClaude's answer; the caller reads errorKind. */
export async function callModel(ctx, { model, systemPromptFile, prompt, effort, timeoutMs, maxTurns = 1 }) {
  const j = judgeSettings(ctx).judge;
  const bin = claudeBin(ctx);
  const run = ctx.opts.runClaude ?? runClaude;
  const call = () => run({
    bin, driver: ctx.driver, model, systemPromptFile, prompt, effort, maxTurns, timeoutMs, env: ctx.env, fakeState: ctx.fakeState, fakeScript: ctx.opts.fakeScript,
  });
  return withTransientRetry(call, { attempts: j.transient.max_in_a_row - 1, backoffMs: j.transient.backoff_ms, sleep: ctx.opts.sleep });
}

const STOP_CODES = { usage_window: EXIT.USAGE_WINDOW, transient: EXIT.ERROR, spawn: EXIT.ERROR, model_mismatch: EXIT.DRIFT };

/** The LoopExit for a call that must stop the run (usage window, repeated errors, no program, another model); null for any other result. */
export function modelStop(ctx, res, { wrote = false, again = ctx.again } = {}) {
  const code = STOP_CODES[res?.errorKind];
  if (code === undefined) return null;
  const why = {
    usage_window: 'your Claude allowance ran out',
    transient: 'Claude kept answering with an error',
    spawn: 'the claude program could not be started',
    model_mismatch: 'a different model than the pinned one answered',
  }[res.errorKind];
  const next = {
    usage_window: `Next: when your Claude allowance is back, type ${again} again; it continues where it stopped.`,
    transient: `Next: type ${again} again in a while; it continues where it stopped.`,
    spawn: `Next: ask the engineer to check that claude is installed, then type ${again} again.`,
    model_mismatch: `Next: ask the engineer to check the pinned model, then type ${again} again.`,
  }[res.errorKind];
  return new LoopExit(code, `${res.errorKind}: ${oneLine(res.message, 300)}`, {
    sentence: `${ctx.label} stopped: ${why}${wrote ? '' : '; nothing was written to Notion'}.`,
    next,
  });
}

/** The tokens of one call, summed over the models in its answer. For the run files only: no editor-facing text shows them. */
export function usageOf(res) {
  const num = (x) => (Number.isFinite(x) && x > 0 ? Math.round(x) : 0);
  const out = { input: 0, cache_write: 0, cache_read: 0, output: 0 };
  const models = res?.modelUsage && typeof res.modelUsage === 'object' ? Object.values(res.modelUsage) : [];
  if (models.length) {
    for (const u of models) {
      out.input += num(u?.inputTokens);
      out.cache_write += num(u?.cacheCreationInputTokens);
      out.cache_read += num(u?.cacheReadInputTokens);
      out.output += num(u?.outputTokens);
    }
    return out;
  }
  const u = res?.raw?.usage;
  if (u && typeof u === 'object') {
    out.input = num(u.input_tokens);
    out.cache_write = num(u.cache_creation_input_tokens);
    out.cache_read = num(u.cache_read_input_tokens);
    out.output = num(u.output_tokens);
  }
  return out;
}

export const addUsage = (total, u) => {
  for (const k of Object.keys(total)) total[k] += u?.[k] ?? 0;
  return total;
};

/**
 * judge() with the hooks of this run (driver, environment, fake CLI, pauses) and no output of its own. The judge's run folder is runs/<runId>. Throws a
 * LoopExit when it did not finish: the usage window (75), repeated errors (1), another model or a changed rulebook file (4), claims that could not be read (2).
 */
export async function runJudge(ctx, judgeOpts) {
  const notes = [];
  const res = await judge({
    root: ctx.root,
    driver: ctx.driver,
    io: quietIo(notes),
    env: ctx.env,
    fakeState: ctx.fakeState,
    fakeScript: ctx.opts.fakeScript,
    sleep: ctx.opts.sleep,
    now: ctx.now,
    runClaude: ctx.opts.runClaude,
    bin: ctx.opts.bin,
    cliVersion: ctx.opts.cliVersion,
    ...judgeOpts,
  });
  if (res.exit === EXIT.OK) return res;
  let rec = null;
  try {
    rec = res.runDir ? readJson(join(res.runDir, 'run.json')) : null;
  } catch {
    rec = null;
  }
  const detail = [rec?.message, rec?.error, rec?.stop?.message, ...notes].filter(Boolean).slice(0, 3).join('; ');
  const kind = rec?.stop?.kind ?? (res.exit === EXIT.USAGE_WINDOW ? 'usage_window' : null);
  const stop = kind ? modelStop(ctx, { errorKind: kind, message: rec?.stop?.message ?? detail }, { wrote: false }) : null;
  if (stop) throw stop;
  if (res.exit === EXIT.PAUSED) {
    throw new LoopExit(EXIT.PAUSED, `the judge stopped: ${detail}`, { sentence: `${ctx.label}: nothing was done, because the agent is paused.`, next: 'Next: a person has to clear Paused first.' });
  }
  if (res.exit === EXIT.DRIFT) {
    throw new LoopExit(EXIT.DRIFT, `the judge stopped: ${detail}`, {
      sentence: `${ctx.label} stopped: the rulebook file or the pinned model no longer matches what was saved; nothing was written to Notion.`,
      next: 'Next: ask the engineer to look at the message the script printed.',
    });
  }
  throw new LoopExit(res.exit === EXIT.INVALID ? EXIT.INVALID : EXIT.ERROR, `the judge did not finish (exit ${res.exit}): ${detail}`, {
    sentence: `${ctx.label} stopped: some claims could not be read; nothing was written to Notion.`,
    next: `Next: type ${ctx.again} again; it continues where it stopped.`,
  });
}

// ---- the repository -------------------------------------------------------------------------------------------------------------------

/**
 * Commit the rubric folder ("git add agents/claim-tagger-mvp/rubric", "git commit -m <message>") after a new edition. Only in production: not in a demo,
 * not with opts.noCommit, and only when the state folder is the agent folder itself (a test folder is never committed). opts.git(args, { cwd }) replaces
 * git (tests). Returns { committed, note }; a failed commit is a warning in run.json, never a failed run.
 */
export function commitRubric(ctx, message) {
  if (ctx.demo) return { committed: false, note: 'a demo is never committed' };
  if (ctx.opts.noCommit) return { committed: false, note: 'commit left out (--no-commit)' };
  const git = ctx.opts.git ?? ((args, o) => spawnSync('git', args, { ...o, encoding: 'utf8', windowsHide: true }));
  if (!ctx.opts.git && resolve(ctx.root) !== codeRoot()) return { committed: false, note: 'the state folder is not the agent folder, so nothing was committed' };
  const cwd = ctx.opts.git ? (ctx.opts.gitCwd ?? repoRoot()) : repoRoot();
  const add = git(['add', 'agents/claim-tagger-mvp/rubric'], { cwd });
  if (add?.status !== 0) {
    ctx.warnings.push(`the rubric folder could not be added to git (${oneLine(add?.stderr || add?.error?.message || `exit ${add?.status}`, 200)})`);
    return { committed: false, note: 'git add failed' };
  }
  const commit = git(['commit', '-m', message], { cwd });
  if (commit?.status !== 0) {
    ctx.warnings.push(`the rubric folder was not committed (${oneLine(commit?.stdout || commit?.stderr || commit?.error?.message || `exit ${commit?.status}`, 200)})`);
    return { committed: false, note: 'git commit failed' };
  }
  return { committed: true, note: message };
}

// ---- the examples and the earlier decisions ----------------------------------------------------------------------------------------------

const EXPECTED = { Applies: 'apply', 'Does not apply': 'do_not_apply' };

/**
 * The files the safety check reads (CONTRACTS section 4), as plain lists with the id the judge gives each item and the answer it should get:
 * canaries { id: "canary-<n>", tag, claim, expected, source } and cases { id: "case-<key>", key, tag, claim, expected, outcome, why_wrong }.
 */
export function readEvals(root) {
  const canaries = readJsonl(join(root, 'evals', 'canaries.jsonl')).rows.map((row, i) => ({
    id: row.id === undefined ? `canary-${i + 1}` : (String(row.id).startsWith('canary-') ? String(row.id) : `canary-${row.id}`),
    tag: row.tag ?? null,
    claim: String(row.claim ?? ''),
    expected: row.expected,
    source: row.source ?? null,
  })).filter((c) => c.claim !== '' && (c.expected === 'apply' || c.expected === 'do_not_apply'));
  const cases = readJsonl(join(root, 'evals', 'cases.jsonl')).rows.map((row) => ({
    id: `case-${row.key}`,
    key: String(row.key ?? ''),
    tag: row.tag ?? null,
    claim: String(row.claim ?? ''),
    expected: EXPECTED[row.outcome] ?? null,
    outcome: row.outcome ?? null,
    why_wrong: row.why_wrong ?? null,
    source: row.source ?? null,
  })).filter((c) => c.key !== '' && c.claim !== '' && c.expected !== null);
  return { canaries, cases };
}

/**
 * The keys a lesson rests on: the keys in its Supporting rows cell (the pull parses them) and, when the cell ends in "+ n more in the page", the keys at
 * the end of the paragraphs of its page body (distill writes "<claim in full> · <key>" there). Needs the client for that one read.
 */
export async function supportingKeysOf(ctx, lesson) {
  const keys = [...(lesson.supporting_keys ?? [])];
  if (/^\+ \d+ more in the page\s*$/m.test(String(lesson['Supporting rows'] ?? '')) && lesson.page_id) {
    const blocks = await notionClient(ctx).retrieveBlockChildren(lesson.page_id);
    for (const block of blocks) {
      const text = (block?.paragraph?.rich_text ?? []).map((p) => p.plain_text ?? p.text?.content ?? '').join('');
      for (const key of parseSupportingKeys(text)) if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}
