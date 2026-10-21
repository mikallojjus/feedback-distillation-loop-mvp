#!/usr/bin/env node
// The judge: asks `claude -p` which tags of each group apply to each claim, writes the answers to the cell store, and re-reads only the
// answers that are not sure. It never touches Notion (it reads files and calls the model through lib/claude.mjs).
//
//   node agents/claim-tagger-mvp/scripts/judge.mjs [--tags a,b] [--items claims|eval] [--pull <pull-id>] [--ids a,b] [--limit N]
//        [--runs-max N] [--rubric <file>] [--refresh] [--run-id <id>] [--driver cli|fake]
//   node agents/claim-tagger-mvp/scripts/judge.mjs --resume <run-id>
//
// Flags
//   --tags a,b     the tags to judge; each one stands for its whole group (judge.groups), because a group is always judged whole. Default: every
//                  group that has a judged tag. A tag with no rules in force is never judged.
//   --items        claims (default): norm/claims.jsonl of the newest pull that has one, or of --pull. eval: evals/canaries.jsonl and
//                  evals/cases.jsonl, items named canary-<n> and case-<key>; an item is judged only by the group that holds its tag.
//   --ids, --limit keep the named items / the first N of them (file order, so a repeated --limit N is a cache hit, and a larger N adds claims).
//   --runs-max N   at most N reads per claim (1 to 3, default judge.runs_max).
//   --rubric       a candidate rulebook file instead of rubric/rubric.json (not compared with the lock); its tag hashes key the store.
//   --refresh      judge the selected groups from scratch: each group's store is set aside (its folder is renamed to <key>.superseded-<run id>,
//                  never deleted) and a new one is filled. Chosen over a key suffix so that every later step finds the fresh answers under the
//                  ordinary key. Combine with --ids/--limit only if you want just those claims to have answers afterwards.
//   --run-id       name the run folder (default <UTC stamp>-judge).
//   --resume <id>  continue a stopped run: same selection, same options (they are in its run.json), skipping what already has its answers.
//   --driver fake  tests: the fake CLI of tests/mvp/fixtures/fake-claude.mjs instead of the real one.
//
// What a run does. First the refusals (the judge checks them itself until status --check is built): runs/PAUSED or Paused in the newest pull's
// settings means exit 3; a judged tag whose Notion text no longer matches the lock (drift.json of the newest pull), a rubric.json whose hashes
// do not verify, or one that differs from rubric.lock means exit 4. Then, per group, the system prompt is rendered from prompts/judge.md (cached under runs/judgments/prompts/) and
// the group's store is opened (one LOCK per store). Run 1 covers every item without an ok run-1 line, in batches of judge.batch_size with
// judge.concurrency batches in flight. Run 2 re-reads the items with an unsure cell (decision ask_editor, or p strictly inside judge.rerun.band),
// lowest margin first, at most judge.rerun.max_share of the group's items; run 3 only where runs 1 and 2 disagree. Items beyond the cap are listed
// as `capped` in run.json. Everything already in the store is reused, so a second run asks nothing.
//
// Errors (CONTRACTS section 6). A reply that is not valid JSON, is missing an id or a tag, or breaks the schema gets one more attempt for its batch
// (judge.attempts_per_batch), then its items are written as status error lines (they are tried again by the next run, and the run ends with
// exit 2). Only the reads the judge's own plan asks for count: an error line in run 2 or 3 of an item that planReruns does not ask to read again
// (an extra read of the safety check, lib/answers.mjs forceRuns, which retries it itself) is neither counted nor retried here.
// A transient failure (429, overloaded, busy) is retried after judge.transient.backoff_ms; the third in a row stops the run with exit 1.
// The CLI's usage-window wording stops the run with exit 75 and nothing is written for the batch. A reply from another model than the pinned one
// stops the run with exit 4 and is not kept. Every stop leaves run.json with the exact command to continue.
//
// Files. runs/<run-id>/run.json (first and last), calls.jsonl (one line per call: group, batch, items, attempts, usage, duration_ms, cli_version,
// status), report.json and report.md (lib/report.mjs: the sentence, the table and the Next line; no call counts, durations or dollars).
// rejected/batch-<n>-attempt-<k>.md keeps a reply the checks refused, as it came and with the problems listed, so that a batch that failed twice
// can be read by a person (the store's error lines name the problem, not the text that caused it).
// On a practice page (config.demo is true) the report is worded as the loop scripts word theirs (lib/loop.mjs): the commands are the demo ones
// ("/claim-tagger demo tag", so that nobody types the real command from the practice page) and the sentence names the practice page
// (config.demo_title), for every stop and every result alike, the usage window (exit 75) included.
// Exit codes: 0 ok, 1 error (resumable), 2 invalid input or a batch that could not be read, 3 paused, 4 drift or wrong model, 75 usage window.
//
// Exports for the steps that follow: judge, selectItems, planReruns, classifyCell, verdictOf, groupsFor, storeInputsFor, loadJudgeConfig, loadRubric,
// readPromptVersion, renderSystemPrompt, buildUserMessage, validateReply, itemHash, normalizeClaim, driftStops, main, parseArgs.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { claudeVersion, extractJson, findClaudeBin, runClaude, usageResetHint, withTransientRetry } from './lib/claude.mjs';
import { STORE_LOCKED, archiveStore, openStore } from './lib/cells.mjs';
import { capabilityOf, isDemo } from './lib/config.mjs';
import { demoCommands, namePracticePage } from './lib/editor-words.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { h16 } from './lib/hash.mjs';
import { appendJsonl, readJson, readJsonl, writeJsonAtomic, writeTextAtomic } from './lib/jsonl.mjs';
import { agentRoot, codeFile, ensureDir, isMain, runId as makeRunId, safeName } from './lib/paths.mjs';
import { compareCodePoints } from './lib/pyjson.mjs';
import { writeReport } from './lib/report.mjs';
import { resumeFor } from './lib/resume.mjs';
import { checkLock, readLock, verifyRubric } from './lib/rubric.mjs';
import { validate } from './lib/validate.mjs';

export const USAGE = 'usage: node agents/claim-tagger-mvp/scripts/judge.mjs [--tags a,b] [--items claims|eval] [--pull <pull-id>] [--ids a,b] [--limit N] [--runs-max N] [--rubric <file>] [--refresh] [--run-id <id>] [--driver cli|fake]\n'
  + '       node agents/claim-tagger-mvp/scripts/judge.mjs --resume <run-id>   (continues a stopped run with the options it was started with)';

const SCRIPT = 'judge';
const FAKE_CLI_VERSION = '0.0.0-fake';
const ID_RE = /^[A-Za-z0-9._-]+$/;
const MAX_LISTED = 8;
const STOP_RANK = { transient: 1, spawn: 1, usage_window: 2, model_mismatch: 3 };
const STOP_EXIT = { transient: EXIT.ERROR, spawn: EXIT.ERROR, usage_window: EXIT.USAGE_WINDOW, model_mismatch: EXIT.DRIFT };

export const DEFAULT_RERUN = Object.freeze({ band: Object.freeze([0.25, 0.75]), include_ask_editor: true, max_share: 0.3 });
const JUDGE_DEFAULTS = Object.freeze({
  runs_max: 3,
  rerun: DEFAULT_RERUN,
  groups: Object.freeze({ G1: Object.freeze(['Context-dependent']) }),
  batch_size: 8,
  concurrency: 2,
  effort: 'medium',
  max_turns: 1,
  timeout_ms: 300000,
  claude_bin: 'claude',
  attempts_per_batch: 2,
  transient: Object.freeze({ max_in_a_row: 3, backoff_ms: Object.freeze([30000, 120000]) }),
  prompt: 'prompts/judge.md',
});

class UsageError extends Error {}

/** A refusal or failure that ends the run with an exit code. `sentence` and `next` are the editor-facing words for report.md. */
export class ExitError extends Error {
  constructor(code, message, { sentence, next } = {}) {
    super(message);
    this.name = 'ExitError';
    this.code = code;
    this.sentence = sentence;
    this.next = next;
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const oneLine = (s, n = 300) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};

// ---- arguments -------------------------------------------------------------------------------------------------------------

const positiveInt = (flag, text, max = Infinity) => {
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > max) throw new UsageError(`${flag} needs a whole number from 1${max === Infinity ? ' up' : ` to ${max}`}, got "${text}"`);
  return Number(text);
};

/** The options of a command line; throws a UsageError (a mistake in the command) with a plain message. */
export function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      return v;
    };
    const list = () => {
      const items = value().split(',').map((s) => s.trim()).filter(Boolean);
      if (!items.length) throw new UsageError(`${arg} needs at least one name`);
      return items;
    };
    const id = () => {
      const v = value();
      if (!ID_RE.test(v)) throw new UsageError(`${arg} may only use letters, digits, '.', '_' and '-', got "${v}"`);
      return v;
    };
    switch (arg) {
      case '--tags': opts.tags = list(); break;
      case '--ids': opts.ids = list(); break;
      case '--items': {
        const v = value();
        if (!['claims', 'eval'].includes(v)) throw new UsageError(`--items must be claims or eval, got "${v}"`);
        opts.items = v;
        break;
      }
      case '--pull': opts.pull = id(); break;
      case '--limit': opts.limit = positiveInt(arg, value()); break;
      case '--runs-max': opts.runsMax = positiveInt(arg, value(), 3); break;
      case '--rubric': opts.rubric = value(); break;
      case '--refresh': opts.refresh = true; break;
      case '--run-id': opts.runId = id(); break;
      case '--resume': opts.resume = id(); break;
      case '--driver': {
        const v = value();
        if (!['cli', 'fake'].includes(v)) throw new UsageError(`--driver must be cli or fake, got "${v}"`);
        opts.driver = v;
        break;
      }
      case '--help': case '-h': opts.help = true; break;
      default: throw new UsageError(`unknown argument ${arg}`);
    }
  }
  if (opts.resume && opts.runId) throw new UsageError('--resume and --run-id cannot be combined: a resumed run keeps its id');
  return opts;
}

// A list option as the command line gives it ("a,b") or as a caller does (["a", "b"]); null when it is not given or empty.
const asList = (v) => {
  if (v === undefined || v === null) return null;
  const list = (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);
  return list.length ? list : null;
};

/** The options as run.json keeps them: everything that decides what a run does, with null for "not given". Callers may spell runsMax as runs_max. */
function normalizeArgs(opts) {
  return {
    items: opts.items ?? 'claims',
    tags: asList(opts.tags),
    pull: opts.pull ?? null,
    ids: asList(opts.ids),
    limit: opts.limit ?? null,
    runs_max: opts.runsMax ?? opts.runs_max ?? null,
    rubric: opts.rubric ? resolve(opts.rubric) : null,
    refresh: opts.refresh === true,
    driver: opts.driver ?? 'cli',
  };
}

const sameList = (a, b) => isDeepStrictEqual(a === null ? null : [...a].sort(), b === null ? null : [...b].sort());

/** The arguments of a resumed run: the recorded ones. A flag that is given again must say the same, else the run was started differently. */
function resumeArgs(opts, recorded) {
  const given = normalizeArgs(opts);
  const was = { ...normalizeArgs({}), ...recorded };
  const differs = [];
  if (opts.items !== undefined && given.items !== was.items) differs.push(`--items ${given.items}`);
  if (opts.tags !== undefined && !sameList(given.tags, was.tags)) differs.push('--tags');
  if (opts.pull !== undefined && given.pull !== was.pull) differs.push('--pull');
  if (opts.ids !== undefined && !sameList(given.ids, was.ids)) differs.push('--ids');
  if (opts.limit !== undefined && given.limit !== was.limit) differs.push('--limit');
  if (given.runs_max !== null && given.runs_max !== was.runs_max) differs.push('--runs-max');
  if (opts.rubric !== undefined && given.rubric !== was.rubric) differs.push('--rubric');
  if (opts.refresh === true && !was.refresh) differs.push('--refresh');
  if (opts.driver !== undefined && given.driver !== was.driver) differs.push(`--driver ${given.driver}`);
  if (differs.length) throw new ExitError(EXIT.INVALID, `--resume: this run was started with other options than ${differs.join(', ')}; leave them out to continue it as it started, or start a new run`);
  return was;
}

const resumeCommand = (runId) => `node agents/claim-tagger-mvp/scripts/judge.mjs --resume ${runId}`;

// ---- the configuration -------------------------------------------------------------------------------------------------------

function mergePlain(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) out[k] = isPlain(v) && isPlain(base[k]) ? mergePlain(base[k], v) : v;
  return out;
}

/**
 * The judge's settings from <root>/config.json, with the defaults of CONTRACTS section 2 for every key that is absent (a state folder
 * without a config.json uses all of them): { judge, model, tags, reasonMaxWords, demo, demo_title }. demo_title is the title of the practice page a
 * demo profile acts on (null when there is none). Throws an ExitError (exit 2) listing what is wrong.
 */
export function loadJudgeConfig(root) {
  const file = join(root, 'config.json');
  let raw = {};
  if (existsSync(file)) {
    try {
      raw = readJson(file);
    } catch (e) {
      throw new ExitError(EXIT.INVALID, e.message);
    }
    if (!isPlain(raw)) throw new ExitError(EXIT.INVALID, `${file}: expected a JSON object`);
  }
  const judge = mergePlain(JUDGE_DEFAULTS, raw.judge);
  if (isPlain(raw.judge?.groups)) judge.groups = raw.judge.groups; // the groups a config names replace the default; they are never merged into it
  const problems = [];
  const int = (name, v, min) => {
    if (!Number.isInteger(v) || v < min) problems.push(`judge.${name} must be a whole number of at least ${min}`);
  };
  int('runs_max', judge.runs_max, 1);
  int('batch_size', judge.batch_size, 1);
  int('concurrency', judge.concurrency, 1);
  int('max_turns', judge.max_turns, 1);
  int('timeout_ms', judge.timeout_ms, 1);
  int('attempts_per_batch', judge.attempts_per_batch, 1);
  if (!isPlain(judge.transient)) problems.push('judge.transient must be an object');
  else {
    int('transient.max_in_a_row', judge.transient.max_in_a_row, 1);
    if (!Array.isArray(judge.transient.backoff_ms) || judge.transient.backoff_ms.some((x) => !Number.isInteger(x) || x < 0)) problems.push('judge.transient.backoff_ms must be a list of whole numbers of milliseconds');
  }
  if (!isPlain(judge.rerun)) problems.push('judge.rerun must be an object');
  else {
    const { band, max_share: share } = judge.rerun;
    if (!Array.isArray(band) || band.length !== 2 || band.some((b) => typeof b !== 'number' || !(b >= 0 && b <= 1)) || band[0] > band[1]) problems.push('judge.rerun.band must be [low, high] with 0 <= low <= high <= 1');
    if (typeof share !== 'number' || !(share >= 0 && share <= 1)) problems.push('judge.rerun.max_share must be a number from 0 to 1');
  }
  if (!isPlain(judge.groups) || Object.values(judge.groups).some((g) => !Array.isArray(g) || g.some((n) => typeof n !== 'string'))) problems.push('judge.groups must map a group name to a list of tag names');
  for (const key of ['effort', 'claude_bin', 'prompt']) if (typeof judge[key] !== 'string' || judge[key] === '') problems.push(`judge.${key} must be a non-empty string`);
  const model = raw.models?.judge ?? 'claude-sonnet-5-5';
  if (typeof model !== 'string' || model === '') problems.push('models.judge must be a non-empty string');
  if (problems.length) throw new ExitError(EXIT.INVALID, `${file}: ${problems.join('; ')}`);
  const tags = { default: 'text', ...(isPlain(raw.tags) ? raw.tags : {}) };
  const reasonMaxWords = Number.isInteger(raw.queue?.reason_max_words) && raw.queue.reason_max_words > 0 ? raw.queue.reason_max_words : 40;
  return { judge, model, tags, reasonMaxWords, demo: isDemo(raw), demo_title: typeof raw.demo_title === 'string' ? raw.demo_title : null };
}

// ---- the rulebook, the groups ------------------------------------------------------------------------------------------------

const RULEBOOK_FILE_NEXT = 'Next: ask an engineer to restore the rulebook file, then type /claim-tagger tag again.';

/**
 * The rulebook the run judges with: <root>/rubric/rubric.json, or the candidate file given with --rubric. Returns { rubric, path, candidate }.
 * Either file must verify (lib/rubric.mjs verifyRubric: the schema and every hash recomputed), because the store key is made of the tag hashes: a
 * rule edited by hand under an old hash would be answered from the old rule's cache. The main file must also agree with rubric/rubric.lock
 * (checkLock). A file that does not verify, or a lock that disagrees, is exit 4 for the main file (a rulebook changes only through a passed
 * safety check) and exit 2 for a candidate; a missing file is exit 2; a missing lock is reported in `warnings`, never skipped silently.
 */
export function loadRubric(root, rubricFile, warnings = []) {
  const candidate = Boolean(rubricFile);
  const path = candidate ? resolve(rubricFile) : join(root, 'rubric', 'rubric.json');
  if (!existsSync(path)) throw new ExitError(EXIT.INVALID, `the rulebook file ${path} does not exist`);
  let rubric;
  try {
    rubric = readJson(path);
  } catch (e) {
    throw new ExitError(EXIT.INVALID, e.message);
  }
  if (!isPlain(rubric) || !Array.isArray(rubric.tags)) throw new ExitError(EXIT.INVALID, `${path}: expected an object with a tags list`);
  const verified = verifyRubric(rubric);
  if (!verified.ok) {
    const why = `${path} is not a valid rulebook edition: ${verified.errors.slice(0, 3).join('; ')}`;
    if (candidate) throw new ExitError(EXIT.INVALID, why);
    throw new ExitError(EXIT.DRIFT, why, { sentence: 'Judge: nothing was read, because the rulebook file on disk does not match its own hashes.', next: RULEBOOK_FILE_NEXT });
  }
  if (!candidate) {
    let lock;
    try {
      lock = readLock(root);
    } catch (e) {
      throw new ExitError(EXIT.DRIFT, e.message, { sentence: 'Judge: nothing was read, because the lock of the rulebook file is not valid.', next: RULEBOOK_FILE_NEXT });
    }
    if (lock === null) {
      warnings.push('rubric/rubric.lock is missing, so rubric.json was not compared with a lock');
    } else {
      const same = checkLock(rubric, lock);
      if (!same.ok) {
        throw new ExitError(EXIT.DRIFT, `${path} differs from rubric.lock: ${same.errors.slice(0, 3).join('; ')}; a rulebook file changes only through a passed safety check`, {
          sentence: 'Judge: nothing was read, because the rulebook file on disk no longer matches its lock.',
          next: RULEBOOK_FILE_NEXT,
        });
      }
    }
  }
  return { rubric, path, candidate };
}

/** A tag is judged when it has rules and its capability is text (CONTRACTS section 3); the rulebook's own `judged: false` also wins. */
function isJudged(tag, cfg) {
  if (!isPlain(tag) || !Array.isArray(tag.rules) || tag.rules.length === 0 || tag.judged === false) return false;
  const capability = tag.capability ?? capabilityOf({ tags: cfg.tags }, tag.name);
  return capability === 'text';
}

/**
 * The groups to judge: [{ name, tags: [rulebook tag], skipped: [names without rules] }]. `only` (from --tags) expands to the groups that
 * hold the named tags. A group without a judged tag is skipped. Exit 2 for a tag that is in no group.
 */
export function groupsFor(cfg, rubric, only = null) {
  const groups = cfg.judge.groups;
  const byName = new Map(rubric.tags.map((t) => [t.name, t]));
  let names = Object.keys(groups);
  if (only) {
    const missing = only.filter((t) => !names.some((g) => groups[g].includes(t)));
    if (missing.length) throw new ExitError(EXIT.INVALID, `--tags names ${missing.join(', ')}, which is in no group of judge.groups`);
    names = names.filter((g) => groups[g].some((t) => only.includes(t)));
  }
  const out = [];
  for (const name of names) {
    const tags = groups[name].map((t) => byName.get(t)).filter((t) => isJudged(t, cfg));
    if (tags.length) out.push({ name, tags, skipped: groups[name].filter((t) => !tags.some((x) => x.name === t)) });
  }
  return out;
}

/** The key inputs of a group's store (lib/cells.mjs): what the next steps (propose, the safety check) need to open the same store. */
export function storeInputsFor({ driver, model, effort, promptVersion, group }) {
  return {
    driver, model, effort, pass: 'text', prompt_version: String(promptVersion), group: group.name,
    tags: group.tags.map((t) => ({ name: t.name, tag_hash: t.tag_hash })),
  };
}

// ---- the prompt --------------------------------------------------------------------------------------------------------------

/** The version line at the top of prompts/judge.md ("prompt_version: 1") and the template without it. */
export function readPromptVersion(templateText) {
  const text = String(templateText).replace(/\r\n?/g, '\n');
  const m = /^\s*prompt_version:[ \t]*([A-Za-z0-9._+-]+)[ \t]*\n+/.exec(text);
  if (!m) throw new ExitError(EXIT.INVALID, 'the judge prompt must start with a line "prompt_version: <version>"');
  return { version: m[1], body: text.slice(m[0].length) };
}

function renderTagBlock(tag) {
  const lines = [`### Tag: ${tag.name}`];
  if (typeof tag.description === 'string' && tag.description.trim()) lines.push(`Description: ${tag.description.trim().replace(/\r\n?/g, '\n')}`);
  lines.push('Rules:');
  for (const r of [...tag.rules].sort((a, b) => a.n - b.n)) lines.push(`${r.n}. ${String(r.text).replace(/\r\n?/g, '\n')}`);
  lines.push(`Counterpart: ${tag.counterpart || 'none'}`);
  return lines.join('\n');
}

/**
 * The system prompt of one group: the template body with {{group_name}}, {{tag_blocks}} (per judged tag: name, description, the rules numbered
 * as in the rulebook, the counterpart's name) and {{claim_count}} (the most claims one message holds) filled in. LF line ends, so the bytes do not
 * depend on the checkout. An unknown placeholder, or a template without {{tag_blocks}}, is an error (exit 2).
 */
export function renderSystemPrompt(body, { groupName, tags, claimCount }) {
  const values = {
    group_name: groupName,
    tag_blocks: tags.map(renderTagBlock).join('\n\n'),
    claim_count: String(claimCount),
  };
  if (!/\{\{tag_blocks\}\}/.test(body)) throw new ExitError(EXIT.INVALID, 'the judge prompt has no {{tag_blocks}}, so the model would not see any rule');
  return body.replace(/\{\{(\w+)\}\}/g, (whole, key) => {
    if (!Object.hasOwn(values, key)) throw new ExitError(EXIT.INVALID, `the judge prompt has the placeholder ${whole}, which the judge does not know`);
    return values[key];
  });
}

/** Cache the rendered prompt as runs/judgments/prompts/<h16>.md (named by its own hash, so the bytes never change under a name). */
function ensurePromptFile(root, text) {
  const hash = h16(text);
  const file = join(root, 'runs', 'judgments', 'prompts', `${hash.replace(/^sha256:/, '')}.md`);
  if (existsSync(file)) {
    if (readFileSync(file, 'utf8') !== text) {
      throw new ExitError(EXIT.DRIFT, `${file} was changed after it was written; delete it so that it is written again`, {
        sentence: 'Judge: nothing was read, because a saved copy of the prompt was changed by hand.',
        next: 'Next: ask an engineer to look at the message the script printed.',
      });
    }
  } else {
    writeTextAtomic(file, text);
  }
  return { file, hash };
}

// ---- the items ---------------------------------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A claim as the model sees it and as the item hash is taken: control characters and every run of white space become one space. */
export const normalizeClaim = (s) => String(s ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();

/** h16 of the normalised claim text: a stored line belongs to the claim only while this still matches. */
export const itemHash = (text) => h16(normalizeClaim(text));

/**
 * The user message of one batch: one line per claim, `<claim id="...">text</claim>`, with "&", "<" and ">" escaped in the text (and the quote
 * in the id), so that a claim can neither close its own element nor open another one: it is data, never markup, and never an instruction.
 */
export function buildUserMessage(items) {
  return items
    .map((it) => `<claim id="${escapeText(String(it.id).replace(CONTROL, ' ')).replace(/"/g, '&quot;')}">${escapeText(normalizeClaim(it.text))}</claim>`)
    .join('\n');
}

function newestDirWith(base, predicate) {
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'LATEST' && predicate(join(base, d.name)))
    .map((d) => ({ name: d.name, at: statSync(join(base, d.name)).mtimeMs }))
    .sort((a, b) => a.at - b.at || compareCodePoints(a.name, b.name));
  return dirs.length ? join(base, dirs[dirs.length - 1].name) : null;
}

// The folder runs/pull/LATEST points at (a file holding the id, or a folder), if it exists and passes the test.
function latestPull(base, predicate) {
  const latest = join(base, 'LATEST');
  if (!existsSync(latest)) return null;
  let dir = null;
  if (statSync(latest).isDirectory()) dir = latest;
  else {
    const id = readFileSync(latest, 'utf8').trim();
    if (id) dir = join(base, safeName(id));
  }
  return dir && existsSync(dir) && predicate(dir) ? dir : null;
}

const hasClaims = (dir) => existsSync(join(dir, 'norm', 'claims.jsonl'));

/** The pull to read claims from: the one named, else the one LATEST names when it has norm/claims.jsonl, else the newest that has one. */
export function resolvePullDir(root, pullId) {
  const base = join(root, 'runs', 'pull');
  if (pullId) {
    const dir = join(base, safeName(pullId));
    if (!hasClaims(dir)) throw new ExitError(EXIT.INVALID, `the pull ${pullId} has no norm/claims.jsonl under ${base}; run the pull first`);
    return dir;
  }
  const dir = latestPull(base, hasClaims) ?? newestDirWith(base, hasClaims);
  if (!dir) throw new ExitError(EXIT.INVALID, `no pull with norm/claims.jsonl under ${base}; run the pull first`);
  return dir;
}

function makeItem({ id, text, tag = null }) {
  const clean = normalizeClaim(text);
  return { id: String(id), text: clean, item_hash: h16(clean), tag };
}

/**
 * The items of a run: { items: [{ id, text, item_hash, tag }], pull_id, skipped }. claims: norm/claims.jsonl of the pull (id = geo_id, text =
 * claim); eval: evals/canaries.jsonl (canary-<n>) and evals/cases.jsonl (case-<key>), each carrying the tag it is about. Rows without an id or a
 * text are skipped and listed. `ids` keeps the named items (exit 2 for one that does not exist), `limit` keeps the first N.
 */
export function selectItems({ root, items: source = 'claims', pull = null, ids = null, limit = null } = {}) {
  const found = new Map();
  const skipped = [];
  const add = (item, where) => {
    if (!item.id || item.id === 'undefined' || item.id === 'null' || !item.text) {
      skipped.push({ where, id: item.id || null, why: item.id && item.id !== 'undefined' && item.id !== 'null' ? 'no claim text' : 'no id' });
      return;
    }
    const known = found.get(item.id);
    if (!known) found.set(item.id, item);
    else if (known.item_hash !== item.item_hash) throw new ExitError(EXIT.INVALID, `${where}: the item ${item.id} appears twice with different texts`);
  };
  let pullId = null;
  if (source === 'claims') {
    const dir = resolvePullDir(root, pull);
    pullId = basename(dir);
    const file = join(dir, 'norm', 'claims.jsonl');
    for (const row of readJsonl(file).rows) add(makeItem({ id: row.geo_id, text: row.claim }), file);
  } else if (source === 'eval') {
    const canaries = join(root, 'evals', 'canaries.jsonl');
    const cases = join(root, 'evals', 'cases.jsonl');
    readJsonl(canaries).rows.forEach((row, i) => {
      const id = row.id === undefined ? `canary-${i + 1}` : (String(row.id).startsWith('canary-') ? String(row.id) : `canary-${row.id}`);
      add(makeItem({ id, text: row.claim, tag: row.tag ?? null }), canaries);
    });
    for (const row of readJsonl(cases).rows) add(makeItem({ id: row.key === undefined || row.key === null ? '' : `case-${row.key}`, text: row.claim, tag: row.tag ?? null }), cases);
  } else {
    throw new ExitError(EXIT.INVALID, `--items must be claims or eval, got ${source}`);
  }
  let list = [...found.values()];
  if (ids) {
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length) throw new ExitError(EXIT.INVALID, `--ids names items that are not in ${source}: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}`);
    const want = new Set(ids);
    list = list.filter((it) => want.has(it.id));
  }
  if (limit) list = list.slice(0, limit);
  return { items: list, pull_id: pullId, skipped };
}

// ---- judging a cell: unsure, margin, verdict -----------------------------------------------------------------------------------

/**
 * Is one answer for one tag unsure, and how far is it from a coin flip? unsure: the decision is ask_editor (when rerun.include_ask_editor is
 * on, as it is by default) or p lies strictly inside rerun.band. margin: |p - 0.5|, and 0 for ask_editor.
 */
export function classifyCell(cell, rerun = DEFAULT_RERUN) {
  const [low, high] = rerun.band ?? DEFAULT_RERUN.band;
  const askEditor = cell.decision === 'ask_editor';
  const inside = typeof cell.p === 'number' && cell.p > low && cell.p < high;
  return {
    unsure: (askEditor && rerun.include_ask_editor !== false) || inside,
    margin: askEditor ? 0 : Math.abs(cell.p - 0.5),
    ask_editor: askEditor,
  };
}

/**
 * The verdict over all the reads a cell has (CONTRACTS section 7): entries are the ok answers for one tag, one per run. decision is the majority
 * (ask_editor wins a tie), p_mean the mean p, agreed how many runs back the majority. unsure: no answer at all, a run that failed (hadError), any
 * ask_editor, runs that are not unanimous, or p_mean strictly inside the band.
 */
export function verdictOf(entries, rerun = DEFAULT_RERUN, { hadError = false } = {}) {
  const tally = new Map();
  for (const e of entries) tally.set(e.decision, (tally.get(e.decision) ?? 0) + 1);
  let decision = 'ask_editor';
  let agreed = 0;
  let tie = false;
  for (const [d, n] of tally) {
    if (n > agreed) {
      decision = d;
      agreed = n;
      tie = false;
    } else if (n === agreed) tie = true;
  }
  if (tie || entries.length === 0) decision = 'ask_editor';
  const pMean = entries.length ? entries.reduce((sum, e) => sum + e.p, 0) / entries.length : null;
  const [low, high] = rerun.band ?? DEFAULT_RERUN.band;
  const askEditor = entries.some((e) => e.decision === 'ask_editor');
  const unsure = entries.length === 0 || hadError || decision === 'ask_editor' || (askEditor && rerun.include_ask_editor !== false)
    || tally.size > 1 || (pMean > low && pMean < high);
  return { decision, p_mean: pMean, runs: entries.length, agreed, unanimous: tally.size <= 1, unsure };
}

const okLine = (lines, item) => {
  const line = lines.get(item.id);
  return line && line.status === 'ok' && line.item_hash === item.item_hash ? line : null;
};

const decisionsDiffer = (a, b) => a.tags.some((t) => b.tags.find((u) => u.name === t.name)?.decision !== t.decision);

/**
 * Which items need another read, from the lines the store holds (Maps id -> last line, as store.lines(n) gives them).
 *   run2    items with an unsure cell in run 1 and no ok run-2 line, lowest margin first (margin: the smallest |p - 0.5| among the unsure cells,
 *           ask_editor counting as 0), as many as the cap allows: floor(max_share * items) minus the items that already have a run-2 line,
 *           so asking again after a finished run asks nothing
 *   capped  the unsure items the cap left out, same order (propose queues them if they are still unsure)
 *   run3    items with ok lines in runs 1 and 2 that disagree on some tag's decision and no ok run-3 line (only when runsMax >= 3)
 */
export function planReruns({ items, run1, run2 = new Map(), run3 = new Map(), rerun = DEFAULT_RERUN, runsMax = 3 }) {
  const plan = { run2: [], capped: [], run3: [], cap: 0 };
  if (runsMax < 2) return plan;
  plan.cap = Math.floor(rerun.max_share * items.length + 1e-9);
  let have2 = 0;
  const candidates = [];
  items.forEach((item, index) => {
    const l1 = okLine(run1, item);
    if (!l1) return;
    const l2 = okLine(run2, item);
    if (l2) have2++;
    const unsure = l1.tags.map((t) => classifyCell(t, rerun)).filter((c) => c.unsure);
    if (unsure.length && !l2) candidates.push({ id: item.id, margin: Math.min(...unsure.map((c) => c.margin)), index });
    if (runsMax >= 3 && l2 && !okLine(run3, item) && decisionsDiffer(l1, l2)) plan.run3.push(item.id);
  });
  candidates.sort((a, b) => a.margin - b.margin || a.index - b.index);
  const budget = Math.max(0, plan.cap - have2);
  plan.run2 = candidates.slice(0, budget).map((c) => c.id);
  plan.capped = candidates.slice(budget).map((c) => c.id);
  return plan;
}

// ---- the reply -----------------------------------------------------------------------------------------------------------------

const shown = (s) => JSON.stringify(oneLine(s, 60));

/** At most `max` words of a text (single spaces); a cut text ends in "...". */
function capWords(text, max) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  return words.length <= max ? words.join(' ') : `${words.slice(0, max).join(' ')}...`;
}

// "Context-dependent rule 2", "rule 2" (the tag's own) or the same with stray punctuation -> the canonical text; null when it names no rule of the rulebook.
function canonicalRuleRef(ref, ownName, rubricTags) {
  if (ref === null) return null;
  const m = /^(?:(.+?)\s+)?rule\s*#?\s*(\d+)\s*\.?$/i.exec(String(ref).trim());
  if (!m) return null;
  const name = m[1] ? m[1].replace(/^["'\s]+|[\s"',;:–—-]+$/g, '') : ownName;
  const tag = rubricTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
  return tag && tag.rules.some((r) => r.n === Number(m[2])) ? `${tag.name} rule ${Number(m[2])}` : null;
}

/**
 * Check a parsed reply against the batch. The shape comes from schemas/judge-reply.schema.json; here: every id of the batch exactly once and no
 * other, every tag of the group exactly once per item and no other, and a decision that agrees with p (apply needs p >= 0.5, do_not_apply
 * p <= 0.5, ask_editor any). rule_ref that does not name a real rule of the rulebook becomes null; a reason is cut to reasonMaxWords words.
 * A bare list of items is accepted as {items}. Returns { ok, errors, byId } where byId maps id -> the cell tags, in the group's tag order.
 */
export function validateReply(value, { ids, tagNames, rubricTags, schema, reasonMaxWords = 40 }) {
  const reply = Array.isArray(value) ? { items: value } : value;
  const shape = validate(schema, reply);
  if (!shape.ok) return { ok: false, errors: shape.errors.slice(0, MAX_LISTED), byId: null };
  const errors = [];
  const wanted = new Set(ids);
  const byId = new Map();
  for (const item of reply.items) {
    if (!wanted.has(item.id)) {
      errors.push(`the id ${shown(item.id)} is not a claim of this batch`);
      continue;
    }
    if (byId.has(item.id)) {
      errors.push(`the id ${shown(item.id)} appears more than once`);
      continue;
    }
    const seen = new Map();
    for (const t of item.tags) {
      if (!tagNames.includes(t.name)) errors.push(`claim ${shown(item.id)}: ${shown(t.name)} is not one of the tags to decide`);
      else if (seen.has(t.name)) errors.push(`claim ${shown(item.id)}: the tag ${shown(t.name)} is listed more than once`);
      else if ((t.decision === 'apply' && t.p < 0.5) || (t.decision === 'do_not_apply' && t.p > 0.5)) errors.push(`claim ${shown(item.id)}: ${shown(t.name)} is ${t.decision} with p ${t.p}`);
      else seen.set(t.name, { name: t.name, decision: t.decision, p: t.p, rule_ref: canonicalRuleRef(t.rule_ref, t.name, rubricTags), reason: capWords(t.reason, reasonMaxWords) });
    }
    for (const n of tagNames) if (!seen.has(n) && !errors.some((e) => e.includes(shown(n)) && e.includes(shown(item.id)))) errors.push(`claim ${shown(item.id)}: the tag ${shown(n)} is missing`);
    byId.set(item.id, tagNames.map((n) => seen.get(n)).filter(Boolean));
  }
  for (const id of ids) if (!byId.has(id)) errors.push(`the claim ${shown(id)} is missing from the reply`);
  const listed = errors.length > MAX_LISTED ? [...errors.slice(0, MAX_LISTED), `and ${errors.length - MAX_LISTED} more problems`] : errors;
  return { ok: errors.length === 0, errors: listed, byId };
}

const num = (x) => (Number.isFinite(x) && x > 0 ? Math.round(x) : 0);

// The tokens of one call, summed over the models in the envelope (the CLI names one; the sum is the call's own).
function usageOf(res) {
  const out = { input: 0, cache_write: 0, cache_read: 0, output: 0 };
  if (isPlain(res?.modelUsage) && Object.keys(res.modelUsage).length) {
    for (const u of Object.values(res.modelUsage)) {
      out.input += num(u?.inputTokens);
      out.cache_write += num(u?.cacheCreationInputTokens);
      out.cache_read += num(u?.cacheReadInputTokens);
      out.output += num(u?.outputTokens);
    }
    return out;
  }
  const u = res?.raw?.usage;
  if (isPlain(u)) {
    out.input = num(u.input_tokens);
    out.cache_write = num(u.cache_creation_input_tokens);
    out.cache_read = num(u.cache_read_input_tokens);
    out.output = num(u.output_tokens);
  }
  return out;
}

const addUsage = (total, u) => {
  for (const k of Object.keys(total)) total[k] += u[k];
};

// ---- refusals: paused, drift -----------------------------------------------------------------------------------------------

/** The newest pull folder of any kind: the one LATEST names, else the most recently written one. */
function newestPullDir(root) {
  const base = join(root, 'runs', 'pull');
  return latestPull(base, () => true) ?? newestDirWith(base, () => true);
}

const readOptionalJson = (file) => {
  if (!existsSync(file)) return null;
  try {
    return readJson(file);
  } catch (e) {
    throw new ExitError(EXIT.INVALID, e.message);
  }
};

/**
 * The entries of a pull's drift.json that stop a run: [{ tag, column }]. The file is what computeDrift (lib/rubric.mjs) returns,
 * { judged: [{ tag, column }], adopted: [{ tag, columns }], missing: [name], added: [name] }:
 *   judged   a judged tag whose Notion text differs from the lock: every entry stops the run
 *   missing  a locked tag whose row is gone from the copy: stops the run when the tag is judged (judgedNames), else it is for the pull to adopt
 *   adopted, added: tags without rules in force, or tags the lock does not know: not a stop
 * A file that holds `skipped` (the check could not run) has no stops; the caller reports that, it does not pass it over.
 */
export function driftStops(drift, judgedNames = null) {
  if (!isPlain(drift)) return [];
  const stops = (Array.isArray(drift.judged) ? drift.judged : []).filter(isPlain).map((e) => ({ tag: e.tag ?? null, column: e.column ?? null }));
  for (const name of Array.isArray(drift.missing) ? drift.missing : []) {
    if (typeof name === 'string' && (!judgedNames || judgedNames.has(name))) stops.push({ tag: name, column: 'the row is gone from the copy' });
  }
  return stops;
}

// ---- one run ---------------------------------------------------------------------------------------------------------------

const consoleIo = { out: (s) => console.log(s), err: (s) => console.error(s) };

function listTags(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Run the judge. opts: the flags (tags, items, pull, ids, limit, runsMax, rubric, refresh, runId, resume, driver) and, for tests and callers,
 * root (the state folder, default agentRoot()), env (the child's environment, default process.env), io ({ out, err }), now, sleep (the pause
 * between transient retries), fakeState and fakeScript (the fake driver), runClaude (replaces the model call), bin and cliVersion (the real driver).
 * Returns { exit, runId, runDir, status, summary, report } and never throws for a failed run: the exit code says what happened.
 */
export async function judge(opts = {}) {
  const ctx = {
    opts,
    root: resolve(opts.root ?? agentRoot()),
    io: opts.io ?? consoleIo,
    now: opts.now ?? (() => new Date()),
    env: opts.env ?? process.env,
    warnings: [],
    states: [],
    stop: null,
    batchSeq: 0,
    calls: 0,
    usage: { input: 0, cache_write: 0, cache_read: 0, output: 0 },
    failedBatches: 0,
    error: null,
    summary: null,
  };
  try {
    prepareRun(ctx);
  } catch (e) { // before there is a run folder: nothing to record, only a message
    ctx.io.err(`judge: ${e instanceof ExitError ? e.message : `unexpected error: ${e.stack ?? e.message}`}`);
    return { exit: e instanceof ExitError ? e.code : EXIT.ERROR, runId: null, runDir: null, status: 'failed', summary: null, report: null };
  }
  try {
    await execute(ctx);
  } catch (e) {
    ctx.error = e;
  } finally {
    for (const st of ctx.states) st.store.close();
  }
  return finish(ctx);
}

function prepareRun(ctx) {
  const { opts, root, now } = ctx;
  const runsDir = join(root, 'runs');
  if (opts.resume) {
    const dir = join(runsDir, safeName(opts.resume));
    const file = join(dir, 'run.json');
    if (!existsSync(file)) throw new ExitError(EXIT.INVALID, `--resume: there is no run ${opts.resume} (no ${file})`);
    let prev;
    try {
      prev = readJson(file);
    } catch (e) {
      throw new ExitError(EXIT.INVALID, `--resume: ${e.message}`);
    }
    if (!isPlain(prev) || prev.script !== SCRIPT || !isPlain(prev.args)) throw new ExitError(EXIT.INVALID, `--resume: ${file} is not the record of a judge run`);
    ctx.prev = prev;
    ctx.runId = basename(dir);
    ctx.runDir = dir;
    ctx.args = resumeArgs(opts, prev.args);
  } else {
    ctx.args = normalizeArgs(opts);
    let runId = (opts.runId ?? opts.run_id) ? safeName(opts.runId ?? opts.run_id) : null;
    if (runId) {
      if (existsSync(join(runsDir, runId))) throw new ExitError(EXIT.INVALID, `a run folder named ${runId} already exists; use --resume ${runId} to continue it, or pick another --run-id`);
    } else {
      const stamp = makeRunId(SCRIPT, now());
      runId = stamp;
      for (let n = 2; existsSync(join(runsDir, runId)); n++) runId = `${stamp}-${n}`;
    }
    ctx.runId = runId;
    ctx.runDir = join(runsDir, runId);
  }
  ensureDir(ctx.runDir);
  const prev = ctx.prev ?? {};
  ctx.record = {
    run_id: ctx.runId,
    script: SCRIPT,
    args: ctx.args,
    started_at: prev.started_at ?? now().toISOString(),
    finished_at: null,
    exit_code: null,
    rubric_edition: prev.rubric_edition ?? null,
    pull_id: prev.pull_id ?? null,
    resume: resumeFor(ctx.root, resumeCommand(ctx.runId)), // on a practice page: through the walkthrough runner
    status: 'running',
    invocations: (prev.invocations ?? 0) + 1,
    ...(prev.item_ids ? { item_ids: prev.item_ids } : {}),
    ...(prev.refreshed ? { refreshed: prev.refreshed } : {}),
  };
  saveRecord(ctx);
}

const saveRecord = (ctx) => writeJsonAtomic(join(ctx.runDir, 'run.json'), ctx.record);

const PAUSED_SENTENCE = 'Judge: nothing was read, because the agent is paused.';
const PAUSED_NEXT = 'Next: a person has to clear Paused (in Agent settings in Notion, or by deleting the PAUSED file), then type /claim-tagger tag again.';

// Exit 3 while runs/PAUSED exists or the newest pull says Paused is ticked in Agent settings. Needs no config and no rulebook, so it comes first.
function checkPaused(ctx) {
  const pausedFile = join(ctx.root, 'runs', 'PAUSED');
  if (existsSync(pausedFile)) throw new ExitError(EXIT.PAUSED, `the agent is paused: ${pausedFile} exists; a person has to delete it`, { sentence: PAUSED_SENTENCE, next: PAUSED_NEXT });
  const pullDir = newestPullDir(ctx.root);
  if (!pullDir) {
    ctx.warnings.push('there is no pull yet, so the Paused setting could not be read');
    return;
  }
  const settings = readOptionalJson(join(pullDir, 'norm', 'settings.json'));
  if (settings === null) ctx.warnings.push(`the newest pull (${basename(pullDir)}) has no norm/settings.json, so the Paused setting could not be read`);
  else if (settings.paused === true) {
    throw new ExitError(EXIT.PAUSED, `Paused is ticked in Agent settings (pull ${basename(pullDir)}); a person has to clear it`, { sentence: PAUSED_SENTENCE, next: PAUSED_NEXT });
  }
}

// Exit 4 when the newest pull's drift.json lists a judged tag whose text in Notion no longer matches the lock.
function checkDrift(ctx, rubric) {
  const pullDir = newestPullDir(ctx.root);
  if (!pullDir) return;
  const drift = readOptionalJson(join(pullDir, 'drift.json'));
  if (drift === null) {
    ctx.warnings.push(`the newest pull (${basename(pullDir)}) has no drift.json, so the rulebook in Notion was not compared with the lock`);
    return;
  }
  if (typeof drift.skipped === 'string') { // the pull could not run the check (no lock yet, the rulebook was not pulled): say so, do not pass it off as "no drift"
    ctx.warnings.push(`the drift check was skipped in the newest pull (${drift.skipped}), so the rulebook in Notion was not compared with the lock`);
    return;
  }
  const judgedNames = new Set(rubric.tags.filter((t) => isJudged(t, ctx.cfg)).map((t) => t.name));
  const stops = driftStops(drift, judgedNames);
  if (!stops.length) return;
  const what = stops.slice(0, 3).map((e) => [e.tag, e.column].filter(Boolean).join(': ')).filter(Boolean).join('; ');
  throw new ExitError(EXIT.DRIFT, `the rulebook in Notion no longer matches the locked edition${what ? ` (${what})` : ''}; undo the edit in Notion, or restore the rulebook`, {
    sentence: `Judge: nothing was read, because the rulebook in Notion no longer matches the locked edition${what ? ` (${what})` : ''}.`,
    next: 'Next: undo that edit in the Rulebook copy in Notion, then type /claim-tagger tag again.',
  });
}

async function execute(ctx) {
  const { root, args, record, io } = ctx;

  // the refusals first: nothing is read or asked while the agent is paused or the rulebook has drifted
  checkPaused(ctx);
  ctx.cfg = loadJudgeConfig(root);
  const cfg = ctx.cfg.judge;
  const { rubric, path: rubricPath, candidate } = loadRubric(root, args.rubric, ctx.warnings);
  record.rubric_edition = rubric.edition ?? null;
  ctx.rubricTags = rubric.tags.filter((t) => isPlain(t) && typeof t.name === 'string' && Array.isArray(t.rules));
  checkDrift(ctx, rubric);

  const groups = groupsFor(ctx.cfg, rubric, args.tags);
  if (!groups.length) {
    throw new ExitError(EXIT.INVALID, args.tags ? `none of the tags ${args.tags.join(', ')} has rules in force, so there is nothing to judge` : 'the rulebook has no tag with rules in force in any group of judge.groups, so there is nothing to judge', {
      sentence: 'Judge: nothing was read, because no tag has rules to judge by.',
      next: 'Next: ask an engineer to look at the message the script printed.',
    });
  }
  for (const g of groups) {
    if (g.skipped.length) ctx.warnings.push(`${g.skipped.join(', ')} ${g.skipped.length === 1 ? 'has' : 'have'} no rules in force and ${g.skipped.length === 1 ? 'is' : 'are'} not judged`);
  }

  // the prompt, one rendering per group
  const promptPath = codeFile(root, cfg.prompt);
  if (!existsSync(promptPath)) throw new ExitError(EXIT.INVALID, `the judge prompt ${promptPath} does not exist`);
  const { version: promptVersion, body } = readPromptVersion(readFileSync(promptPath, 'utf8'));

  // how to call the model
  const driver = args.driver;
  ctx.driver = driver;
  ctx.model = ctx.cfg.model;
  ctx.bin = driver === 'fake' ? cfg.claude_bin : (ctx.opts.bin ?? findClaudeBin(cfg.claude_bin));
  ctx.cliVersion = driver === 'fake' ? FAKE_CLI_VERSION : (ctx.opts.cliVersion ?? claudeVersion(ctx.bin, { env: ctx.env }));
  ctx.callClaude = ctx.opts.runClaude ?? runClaude;
  ctx.fakeState = ctx.opts.fakeState ?? {};
  ctx.runsMax = Math.min(args.runs_max ?? cfg.runs_max, 3);
  if (!args.runs_max && cfg.runs_max > 3) ctx.warnings.push(`judge.runs_max is ${cfg.runs_max} but a store keeps three reads at most; using 3`);
  ctx.schemas = {
    reply: readJson(codeFile(root, 'schemas', 'judge-reply.schema.json')),
  };

  // the items; a resumed run takes the ones its first invocation chose (and the pull it read), so that the selection cannot move
  const stored = ctx.prev?.item_ids ?? null;
  const selection = selectItems({
    root, items: args.items, pull: ctx.prev?.pull_id ?? args.pull, ids: stored ?? args.ids, limit: stored ? null : args.limit,
  });
  if (selection.skipped.length) ctx.warnings.push(`${selection.skipped.length} row${selection.skipped.length === 1 ? '' : 's'} without an id or a claim text ${selection.skipped.length === 1 ? 'was' : 'were'} skipped`);
  if (!selection.items.length) {
    throw new ExitError(EXIT.INVALID, `there are no items to judge in ${args.items}`, { sentence: 'Judge: nothing was read, because there are no claims to read.', next: 'Next: ask an engineer to look at the message the script printed.' });
  }
  record.pull_id = selection.pull_id;
  record.item_ids = selection.items.map((it) => it.id);
  if (selection.skipped.length) record.skipped = selection.skipped.slice(0, 20);

  // a group none of whose items is about its tags (an example about another tag) is left out: no prompt, no store, nothing to set aside
  const plans = groups
    .map((group) => {
      const tagNames = group.tags.map((t) => t.name);
      return { group, tagNames, items: selection.items.filter((it) => it.tag === null || tagNames.includes(it.tag)) };
    })
    .filter((p) => p.items.length > 0);
  if (!plans.length) {
    throw new ExitError(EXIT.INVALID, `none of the ${selection.items.length} items belongs to a tag that is judged here`, { sentence: 'Judge: nothing was read, because none of the claims is about a tag that is judged.', next: 'Next: ask an engineer to look at the message the script printed.' });
  }

  // one state per group: prompt, store, items
  record.groups = [];
  record.refreshed = { ...(record.refreshed ?? {}) };
  for (const { group, tagNames, items } of plans) {
    const prompt = ensurePromptFile(root, renderSystemPrompt(body, { groupName: group.name, tags: group.tags, claimCount: cfg.batch_size }));
    const inputs = storeInputsFor({ driver, model: ctx.model, effort: cfg.effort, promptVersion, group });
    try {
      if (args.refresh && !Object.hasOwn(record.refreshed, group.name)) { // once per run: a resume keeps what the first invocation judged since
        const moved = archiveStore(root, inputs, ctx.runId);
        record.refreshed[group.name] = moved ? basename(moved) : null;
        saveRecord(ctx);
      }
      const store = openStore(root, inputs);
      ctx.states.push({ name: group.name, tags: group.tags, tagNames, store, items, promptFile: prompt.file, capped: [] });
      record.groups.push({ name: group.name, tags: tagNames, store: store.key16, prompt: prompt.hash, items: items.length });
    } catch (e) {
      if (e?.code !== STORE_LOCKED) throw e;
      throw new ExitError(EXIT.ERROR, e.message, {
        sentence: 'Judge: nothing was read, because another run is using the same saved answers.',
        next: 'Next: wait for that run to finish, then type /claim-tagger tag again.',
      });
    }
  }
  Object.assign(record, {
    driver, model: ctx.model, effort: cfg.effort, prompt_version: promptVersion, cli_version: ctx.cliVersion, runs_max: ctx.runsMax, rubric_file: candidate ? rubricPath : null,
  });
  if (ctx.warnings.length) record.warnings = [...ctx.warnings];
  saveRecord(ctx);
  for (const w of ctx.warnings) io.err(`judge: warning: ${w}`);

  // the batch numbers continue where an earlier invocation of this run stopped
  ctx.batchSeq = readJsonl(join(ctx.runDir, 'calls.jsonl')).rows.length;
  try {
    await runPhases(ctx);
  } finally {
    ctx.summary = summarize(ctx);
  }
}

// ---- the phases and the batches ----------------------------------------------------------------------------------------------

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

async function runPhases(ctx) {
  const cfg = ctx.cfg.judge;
  const byId = (state, ids) => { // the plan's order (lowest margin first) is kept, so a stop leaves the most unsure items read first
    const known = new Map(state.items.map((it) => [it.id, it]));
    return ids.map((id) => known.get(id));
  };
  const phase = async (run, pick) => {
    const batches = [];
    for (const state of ctx.states) {
      const pending = pick(state);
      for (const items of chunk(pending, cfg.batch_size)) batches.push({ state, run, items, n: ++ctx.batchSeq });
    }
    await runPool(ctx, batches);
  };

  await phase(1, (st) => {
    const lines = st.store.lines(1);
    return st.items.filter((it) => !okLine(lines, it));
  });
  if (ctx.stop || ctx.runsMax < 2) return;

  for (const st of ctx.states) {
    st.plan = planReruns({ items: st.items, run1: st.store.lines(1), run2: st.store.lines(2), run3: st.store.lines(3), rerun: cfg.rerun, runsMax: ctx.runsMax });
    st.capped = st.plan.capped;
  }
  await phase(2, (st) => byId(st, st.plan.run2));
  if (ctx.stop || ctx.runsMax < 3) return;

  for (const st of ctx.states) {
    st.plan = planReruns({ items: st.items, run1: st.store.lines(1), run2: st.store.lines(2), run3: st.store.lines(3), rerun: cfg.rerun, runsMax: ctx.runsMax });
  }
  await phase(3, (st) => byId(st, st.plan.run3));
}

// `concurrency` batches in flight; once something stops the run no new batch starts (the ones in flight finish and are kept). A lane that
// throws (a bug, not a failed call) stops the others from starting more, and the throw is passed on only when every lane is done, so that the
// stores are never closed under a batch that is still being written.
async function runPool(ctx, batches) {
  let cursor = 0;
  const lane = async () => {
    try {
      while (!ctx.stop && !ctx.aborted && cursor < batches.length) await processBatch(ctx, batches[cursor++]);
    } catch (e) {
      ctx.aborted = true;
      throw e;
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: Math.min(ctx.cfg.judge.concurrency, batches.length) }, lane));
  const broken = settled.find((r) => r.status === 'rejected');
  if (broken) throw broken.reason;
}

const STOPS = new Set(['usage_window', 'model_mismatch', 'spawn', 'transient']);
const REJECTED_MAX_CHARS = 40000;

async function processBatch(ctx, batch) {
  const { state, run, items, n } = batch;
  const cfg = ctx.cfg.judge;
  const message = buildUserMessage(items);
  const schema = ctx.schemas.reply;
  const usage = { input: 0, cache_write: 0, cache_read: 0, output: 0 };
  let attempts = 0;
  let durationMs = 0;
  let problems = [];
  let accepted = null;
  let stopped = null;

  // A reply the checks refuse is kept as it came (runs/<run-id>/rejected/), so that a batch that fails both attempts can be read by a person.
  const keepRejected = (attempt, text, why) => {
    const body = String(text ?? '');
    const shown = body.length > REJECTED_MAX_CHARS ? `${body.slice(0, REJECTED_MAX_CHARS)}\n[cut after ${REJECTED_MAX_CHARS} characters]` : body;
    const head = `batch ${n}, attempt ${attempt}, ${items.length} claim(s): ${items.map((it) => it.id).join(', ')}`;
    const why_ = why.map((w) => `- ${w}`).join('\n');
    writeTextAtomic(join(ensureDir(join(ctx.runDir, 'rejected')), `batch-${n}-attempt-${attempt}.md`), `# Rejected reply\n\n${head}\n\n## Why\n\n${why_}\n\n## Reply as received\n\n${shown}\n`);
  };

  const call = async () => {
    attempts++;
    const res = await ctx.callClaude({
      bin: ctx.bin, driver: ctx.driver, model: ctx.model, systemPromptFile: state.promptFile, prompt: message, effort: cfg.effort,
      maxTurns: cfg.max_turns, timeoutMs: cfg.timeout_ms, env: ctx.env, fakeState: ctx.fakeState, fakeScript: ctx.opts.fakeScript,
    });
    durationMs += res.durationMs ?? 0;
    addUsage(usage, usageOf(res));
    return res;
  };

  for (let attempt = 1; attempt <= cfg.attempts_per_batch && !accepted && !stopped; attempt++) {
    // a transient failure is asked again after the pauses of judge.transient.backoff_ms; the max_in_a_row-th one in a row ends the run
    const res = await withTransientRetry(call, { attempts: cfg.transient.max_in_a_row - 1, backoffMs: cfg.transient.backoff_ms, sleep: ctx.opts.sleep });
    if (STOPS.has(res.errorKind)) {
      stopped = { kind: res.errorKind, message: res.message };
      break;
    }
    if (res.errorKind) { // timeout or an unusable envelope: the same message once more
      problems = [res.message];
      continue;
    }
    let value;
    try {
      value = extractJson(res.text);
    } catch (e) {
      problems = [`the reply is not valid JSON (${e.message})`];
      keepRejected(attempt, res.text, problems);
      continue;
    }
    const checked = validateReply(value, { ids: items.map((it) => it.id), tagNames: state.tagNames, rubricTags: ctx.rubricTags, schema, reasonMaxWords: ctx.cfg.reasonMaxWords });
    if (!checked.ok) {
      problems = checked.errors;
      keepRejected(attempt, res.text, problems);
      continue;
    }
    accepted = { byId: checked.byId, attempt };
  }

  ctx.calls++;
  addUsage(ctx.usage, usage);
  const callLine = (status) => appendJsonl(join(ctx.runDir, 'calls.jsonl'), {
    group: state.name, run, batch: n, items: items.length, ids: items.map((it) => it.id), attempts, usage, duration_ms: durationMs, cli_version: ctx.cliVersion, status,
  });
  const lineBase = (it, attempt) => ({ id: it.id, item_hash: it.item_hash, call: { run_id: ctx.runId, batch: n, attempt, cli_version: ctx.cliVersion, usage: { ...usage } } });

  if (stopped) {
    if (!ctx.stop || STOP_RANK[stopped.kind] > STOP_RANK[ctx.stop.kind]) ctx.stop = { kind: stopped.kind, message: stopped.message, reset_hint: usageResetHint(stopped.message) };
    callLine(stopped.kind); // nothing is written to the store: the next run asks for these items again
    return;
  }
  if (accepted) {
    state.store.append(run, items.map((it) => ({ ...lineBase(it, accepted.attempt), status: 'ok', tags: accepted.byId.get(it.id) })));
    callLine('ok');
    return;
  }
  const why = oneLine(problems.join('; '), 400) || 'the reply could not be used';
  state.store.append(run, items.map((it) => ({ ...lineBase(it, cfg.attempts_per_batch), status: 'error', error: why, tags: [] })));
  ctx.failedBatches++;
  callLine('error');
}

// ---- the numbers for the report ------------------------------------------------------------------------------------------------

// An error line counts as "could not be read again" only in a run that this judge's own plan asks for (planReruns over the store as it is now): an item
// with a second read that failed and is still unsure after its first, or a third read that failed where the first two disagree. The judge retries exactly
// those on its next run, so for them "the next run tries them again" is true. An error line in any other run was written by someone else's extra read
// (the safety check reads a flipped item up to three times whatever the judge thinks of it, lib/answers.mjs forceRuns) and is that reader's to retry; the
// judge neither reads the item again nor lets the line stop it, or the same stop would repeat for good.
function summarize(ctx) {
  const rerun = ctx.cfg.judge.rerun;
  const all = new Set();
  const read = new Set();
  const unsure = new Set();
  const reread = new Set();
  const failed = new Set(); // no usable first read
  const failedReread = new Set(); // read once, but a later read that the plan asks for failed
  for (const st of ctx.states) {
    const runs = [1, 2, 3].map((n) => st.store.lines(n));
    const asks = planReruns({ items: st.items, run1: runs[0], run2: runs[1], run3: runs[2], rerun, runsMax: ctx.runsMax });
    const asked = [null, new Set(asks.run2), new Set(asks.run3)]; // by index of the run: run 1 is always asked, and its failures are `failed`
    for (const it of st.items) {
      all.add(it.id);
      const lines = runs.map((m) => {
        const l = m.get(it.id);
        return l && l.item_hash === it.item_hash ? l : null;
      });
      const first = lines[0];
      if (!first) continue;
      if (first.status === 'error') {
        failed.add(it.id);
        continue;
      }
      read.add(it.id);
      if (lines[1]?.status === 'ok') reread.add(it.id);
      const hadError = lines.some((l, i) => i > 0 && l?.status === 'error' && asked[i].has(it.id));
      if (hadError) failedReread.add(it.id);
      for (const name of st.tagNames) {
        const entries = lines.filter((l) => l?.status === 'ok').map((l) => l.tags.find((t) => t.name === name)).filter(Boolean);
        if (verdictOf(entries, rerun, { hadError }).unsure) {
          unsure.add(it.id);
          break;
        }
      }
    }
  }
  const tags = [...new Set(ctx.states.flatMap((s) => s.tagNames))];
  return {
    tags, total: all.size, read: read.size, unsure: unsure.size, reread: reread.size, failed: failed.size, failedReread: failedReread.size,
    waiting: all.size - read.size - failed.size,
  };
}

function reportFor(ctx) {
  const s = ctx.summary;
  const e = ctx.error;
  const known = e instanceof ExitError;
  if (known && e.sentence) return { sentence: e.sentence, rows: [], next: e.next ?? 'Next: ask an engineer to look at the message the script printed.' };
  if (e && !known) {
    return { sentence: 'Judge stopped on an unexpected error; nothing was written to Notion.', rows: [], next: 'Next: ask an engineer to look at the message the script printed, then type /claim-tagger tag again' };
  }
  if (known || !s) {
    return { sentence: 'Judge: nothing was read, because something it needs is missing or not valid.', rows: [], next: 'Next: ask an engineer to look at the message the script printed.' };
  }
  const tags = listTags(s.tags);
  const rows = [['Claims read', String(s.read), ''], ['Unsure', String(s.unsure), ''], ['Re-read', String(s.reread), '']];
  if (s.failed > 0) rows.push(['Could not be read', String(s.failed), '']);
  if (s.failedReread > 0) rows.push(['Could not be read again', String(s.failedReread), '']);
  if (ctx.stop) {
    const after = `after ${s.read} of ${plural(s.total, 'claim')}`;
    const rowsStopped = [['Claims read', String(s.read), ''], ['Still waiting', String(s.total - s.read), '']];
    const why = {
      usage_window: `your Claude allowance ran out ${after}`,
      transient: `Claude kept answering with an error ${after}`,
      spawn: 'the claude program could not be started',
      model_mismatch: `a different model than the pinned one answered ${after}, so that answer was not kept`,
    }[ctx.stop.kind];
    const next = {
      usage_window: 'Next: when your Claude allowance is back, type /claim-tagger tag again; it continues where it stopped.',
      transient: 'Next: type /claim-tagger tag again in a while; it continues where it stopped.',
      spawn: 'Next: ask an engineer to check that claude is installed, then type /claim-tagger tag again.',
      model_mismatch: 'Next: ask an engineer to check the pinned model, then type /claim-tagger tag again.',
    }[ctx.stop.kind];
    return { sentence: `Judge stopped: ${why}; nothing was written to Notion.`, rows: rowsStopped, next };
  }
  if (s.failed > 0) {
    return {
      sentence: `Judge: read ${plural(s.read, 'claim')} for ${tags}; ${s.unsure} unsure; ${s.failed} could not be read.`,
      rows,
      next: 'Next: type /claim-tagger tag again to read the ones that failed (it continues from here).',
    };
  }
  if (s.failedReread > 0) {
    return {
      sentence: `Judge: read ${plural(s.read, 'claim')} for ${tags}; ${s.unsure} unsure; ${s.failedReread} could not be read again.`,
      rows,
      next: 'Next: type /claim-tagger tag again to read them again (it continues from here).',
    };
  }
  return { sentence: `Judge: read ${plural(s.read, 'claim')} for ${tags}; ${s.unsure} unsure.`, rows, next: 'Next: type /claim-tagger tag to finish (it continues from here).' };
}

// A read that failed twice (invalid replies) ends the run with exit 2 after everything else was done; its items are tried again by the next run.
function exitCodeOf(ctx) {
  const e = ctx.error;
  if (e instanceof ExitError) return e.code;
  if (e) return EXIT.ERROR;
  if (ctx.stop) return STOP_EXIT[ctx.stop.kind];
  if (ctx.summary && (ctx.summary.failed > 0 || ctx.summary.failedReread > 0)) return EXIT.INVALID;
  return EXIT.OK;
}

/**
 * The words of the report as the editor reads them. On a practice page (a demo profile) the commands are the demo ones and the sentence names the practice
 * page, as in lib/loop.mjs; the sentence without the page's name comes second, because a title the report lint refuses must not cost the editor the report.
 * A run that was refused before the configuration was read (paused) reads the demo settings now; a configuration that cannot be read is no demo.
 */
function reportWords(ctx, parts) {
  let settings = ctx.cfg ?? null;
  if (!settings) {
    try {
      settings = loadJudgeConfig(ctx.root);
    } catch {
      settings = null;
    }
  }
  if (settings?.demo !== true) return { demo: false, sentences: [parts.sentence], next: parts.next };
  const plain = demoCommands(parts.sentence);
  return { demo: true, sentences: [...new Set([namePracticePage(settings, plain), plain])], next: demoCommands(parts.next) };
}

function finish(ctx) {
  const { io, record } = ctx;
  const exit = exitCodeOf(ctx);
  const status = exit === EXIT.OK ? 'done' : (ctx.stop ? 'stopped' : 'failed');
  const e = ctx.error;
  const message = e ? (e instanceof ExitError ? e.message : `unexpected error: ${e.stack ?? e.message}`) : null;

  const parts = reportFor(ctx);
  const words = reportWords(ctx, parts);
  const why = (err) => oneLine(err.problems ? err.problems.join('; ') : err.message);
  let report = null;
  let refused = null;
  for (const sentence of words.sentences) {
    try {
      report = writeReport(ctx.runDir, { demo: words.demo, sentence, rows: parts.rows, next: words.next }).report;
      if (refused) ctx.warnings.push(`the sentence of report.md does not name the practice page, because that did not pass the report lint: ${why(refused)}`);
      break;
    } catch (err) {
      refused ??= err;
    }
  }
  if (!report) {
    ctx.warnings.push(`report.md was not written as planned: ${why(refused)}`);
    try {
      report = writeReport(ctx.runDir, { demo: false, sentence: 'Judge finished.', rows: [], next: 'Next: ask an engineer to look at the message the script printed.' }).report;
    } catch {
      report = null;
    }
  }

  Object.assign(record, {
    finished_at: ctx.now().toISOString(),
    exit_code: exit,
    status,
    ...(ctx.summary
      ? { counts: { items: ctx.summary.total, read: ctx.summary.read, unsure: ctx.summary.unsure, reread: ctx.summary.reread, failed: ctx.summary.failed, failed_reread: ctx.summary.failedReread } }
      : {}),
    capped: Object.fromEntries(ctx.states.map((st) => [st.name, st.capped])),
    calls: (ctx.prev?.calls ?? 0) + ctx.calls,
    failed_batches: (ctx.prev?.failed_batches ?? 0) + ctx.failedBatches,
    usage: ctx.prev?.usage ? Object.fromEntries(Object.keys(ctx.usage).map((k) => [k, (ctx.prev.usage[k] ?? 0) + ctx.usage[k]])) : ctx.usage,
    ...(ctx.stop ? { stop: ctx.stop } : {}),
    ...(message ? { error: oneLine(message, 600) } : {}),
    ...(ctx.warnings.length ? { warnings: [...ctx.warnings] } : {}),
  });
  if (!ctx.stop) delete record.stop;
  saveRecord(ctx);

  if (message) io.err(`judge: ${message}`);
  if (ctx.stop) {
    const fixFirst = ctx.stop.kind === 'model_mismatch' || ctx.stop.kind === 'spawn';
    io.err(`judge: stopped (${ctx.stop.kind}): ${oneLine(ctx.stop.message, 200)}${ctx.stop.reset_hint ? ` [${ctx.stop.reset_hint}]` : ''}\njudge: ${fixFirst ? 'once that is fixed, continue with' : 'to continue'}: ${record.resume}`);
  } else if (exit === EXIT.INVALID && ctx.summary) {
    io.err(`judge: ${ctx.summary.failed} claim(s) could not be read and ${ctx.summary.failedReread} could not be read again (error lines in the store); the next run tries them again: ${record.resume}`);
  }
  if (report) io.out(readFileSync(join(ctx.runDir, 'report.md'), 'utf8').trimEnd());
  return { exit, runId: ctx.runId, runDir: ctx.runDir, status, summary: ctx.summary, report };
}

// ---- the command line --------------------------------------------------------------------------------------------------------

/** Parse the command line and run; returns the exit code. deps (tests): everything judge() takes besides the flags. */
export async function main(argv, io = consoleIo, deps = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.err(`judge: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (opts.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  try {
    return (await judge({ ...opts, ...deps, io })).exit;
  } catch (e) {
    io.err(`judge: unexpected error: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
