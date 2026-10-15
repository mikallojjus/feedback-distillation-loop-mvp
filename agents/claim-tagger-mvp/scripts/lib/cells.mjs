// The per-group cell store (CONTRACTS section 6): what the judge said about each claim for the tags of one group, kept in files
// so that the next step (propose, the safety check, follow-up) reads them and a stopped run can continue without asking again.
//
//   runs/judgments/<key16>/meta.json      the inputs the folder name is made from (checked every time the store is opened)
//   runs/judgments/<key16>/run-1.jsonl    one line per item and run: { id, item_hash, status, tags, call } (schemas/cell.schema.json)
//   runs/judgments/<key16>/run-2.jsonl    the second read, only for the unsure items (the judge decides which)
//   runs/judgments/<key16>/run-3.jsonl    the third read, only where the first two disagree
//   runs/judgments/<key16>/LOCK           one writer at a time
//
//   storeKey(inputs)                    -> "sha256:" + 16 hex digits: h16(pyJson({ driver, model, effort, pass, prompt_version, group, tags }, sortKeys))
//   storeDirName(key)                   -> the 16 hex digits alone, which is the folder name (a ':' is not allowed in a Windows name)
//   openStore(root, inputs, options)    -> { dir, key, key16, inputs, meta, lines(run), append(run, lines), runsFor(id, itemHash), close() }
//   archiveStore(root, inputs, label)   -> sets a store aside (renames the folder, never deletes it); how `judge --refresh` starts a group over
//
// Why the key is made of what it is made of: it holds exactly what can change a group's answers (the model, the effort, the prompt
// version, the group and the hash of every rule of its tags), so a rule change gives that group a fresh store and leaves every other
// group's answers in place. The CLI version is recorded on each line but is not part of the key. The old store stays on disk as history.
//
// The last line for an item wins (append only; a changed claim text or a retry just adds a line). `lines(run)` is that view. A line
// belongs to the current text of its claim only while its item_hash matches, so readers that hold the claim pass the hash.
//
// Every line is checked against the schema when it is appended and when it is read back. A line that fails is a bug or a hand edit, and
// the store throws instead of guessing. A torn last line (a crash in the middle of a write) is dropped by the JSONL reader and cut off
// by the next append, as for every ledger in this agent.
//
// One LOCK per store, taken when a writer opens it and removed when it closes. A fresh lock makes open throw with a plain message (an Error
// whose code is STORE_LOCKED). A lock is taken over when it is older than an hour, and also when the process that wrote it is gone (a judge
// that was killed would otherwise block its own resume for an hour). Readers open with { readOnly: true }: no lock, nothing created, no append.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { h16 } from './hash.mjs';
import { appendJsonl, readJson, readJsonl, renameWithRetry, writeJsonAtomic } from './jsonl.mjs';
import { codeFile } from './paths.mjs';
import { compareCodePoints, pyJson } from './pyjson.mjs';
import { validate } from './validate.mjs';

/** The run numbers a store has files for. */
export const RUNS = Object.freeze([1, 2, 3]);
/** A lock older than this is stale and is taken over. */
export const LOCK_STALE_MS = 60 * 60 * 1000;

const INPUT_FIELDS = Object.freeze(['driver', 'model', 'effort', 'pass', 'prompt_version', 'group', 'tags']);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// ---- the key ---------------------------------------------------------------------------------------------------------------

/**
 * The inputs of a store as they are hashed and written to meta.json: the seven fields, tags as [{ name, tag_hash }] sorted by name,
 * pass "text" unless given, prompt_version as a string. Throws a TypeError naming the field when something is missing or of the wrong
 * kind (effort included: a null effort would hash differently from "medium" and the cache would silently split).
 */
export function normalizeKeyInputs(inputs) {
  if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) throw new TypeError('cells: the key inputs must be an object');
  for (const f of ['driver', 'model', 'effort', 'group']) if (!nonEmpty(inputs[f])) throw new TypeError(`cells: key input "${f}" must be a non-empty string`);
  const pass = inputs.pass ?? 'text';
  if (!nonEmpty(pass)) throw new TypeError('cells: key input "pass" must be a non-empty string');
  if (!(nonEmpty(inputs.prompt_version) || typeof inputs.prompt_version === 'number')) throw new TypeError('cells: key input "prompt_version" is missing');
  if (!Array.isArray(inputs.tags) || inputs.tags.length === 0) throw new TypeError('cells: key input "tags" must be a non-empty array of { name, tag_hash }');
  const tags = inputs.tags.map((t, i) => {
    if (t === null || typeof t !== 'object' || !nonEmpty(t.name) || !nonEmpty(t.tag_hash)) throw new TypeError(`cells: key input tags[${i}] must be { name, tag_hash }`);
    return { name: t.name, tag_hash: t.tag_hash };
  }).sort((a, b) => compareCodePoints(a.name, b.name));
  for (let i = 1; i < tags.length; i++) if (tags[i].name === tags[i - 1].name) throw new TypeError(`cells: the tag "${tags[i].name}" is listed twice`);
  return {
    driver: inputs.driver, model: inputs.model, effort: inputs.effort, pass, prompt_version: String(inputs.prompt_version), group: inputs.group, tags,
  };
}

/** h16(pyJson(inputs, { sortKeys: true })): "sha256:" + 16 hex digits. The same for any key order and any tag order. */
export function storeKey(inputs) {
  return h16(pyJson(normalizeKeyInputs(inputs), { sortKeys: true }));
}

/** The folder name of a key: its 16 hex digits (no "sha256:", which has a colon). */
export function storeDirName(key) {
  return String(key).replace(/^sha256:/, '');
}

/** <root>/runs/judgments/<key16> for a state root and key inputs. */
export function storeDir(root, inputs) {
  return join(root, 'runs', 'judgments', storeDirName(storeKey(inputs)));
}

// ---- the schema ------------------------------------------------------------------------------------------------------------

const schemaCache = new Map();
function cellSchema(root) {
  const file = codeFile(root, 'schemas', 'cell.schema.json');
  if (!schemaCache.has(file)) schemaCache.set(file, readJson(file));
  return schemaCache.get(file);
}

// ---- the lock --------------------------------------------------------------------------------------------------------------

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // it exists but is not ours to signal
  }
}

function readLock(file) {
  let held = {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object') held = parsed;
  } catch {
    // an unreadable lock has no owner we can ask; the file's age decides
  }
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    // vanished while we looked: the caller tries to create it again
  }
  return { ...held, mtimeMs };
}

function lockIsStale(held, now) {
  if (now() - held.mtimeMs > LOCK_STALE_MS) return true;
  return Number.isInteger(held.pid) && held.pid !== process.pid && !processAlive(held.pid);
}

/** The error code of an open (or an archive) refused because a fresh lock says another judge is using the store. */
export const STORE_LOCKED = 'STORE_LOCKED';

function lockBusyError(dir, held) {
  const since = typeof held.since === 'string' ? ` since ${held.since}` : '';
  const owner = Number.isInteger(held.pid) ? ` by process ${held.pid}` : '';
  const error = new Error(`the judgment store ${dir} is in use (its LOCK file was taken${since}${owner}); wait for that run to finish, or delete the LOCK file if no judge is running (a lock older than an hour is taken over by itself)`);
  error.code = STORE_LOCKED;
  return error;
}

function takeLock(dir, now) {
  const file = join(dir, 'LOCK');
  const token = randomBytes(8).toString('hex');
  const body = JSON.stringify({ pid: process.pid, token, since: new Date(now()).toISOString() });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(file, body, { flag: 'wx' });
      return { file, token };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const held = readLock(file);
    if (!lockIsStale(held, now)) throw lockBusyError(dir, held);
    rmSync(file, { force: true }); // stale: take it over
  }
  throw new Error(`could not take the lock of ${dir}: another process keeps creating it`);
}

function releaseLock(lock) {
  if (!lock) return;
  try {
    if (readLock(lock.file).token === lock.token) rmSync(lock.file, { force: true }); // never remove a lock somebody else took over
  } catch {
    // already gone
  }
}

// ---- the store -------------------------------------------------------------------------------------------------------------

const runFile = (dir, run) => join(dir, `run-${run}.jsonl`);

function checkRun(run) {
  if (!RUNS.includes(run)) throw new RangeError(`cells: run must be 1, 2 or 3, got ${JSON.stringify(run)}`);
}

function readMeta(dir) {
  const file = join(dir, 'meta.json');
  if (!existsSync(file)) return null;
  return readJson(file); // throws a plain "invalid JSON" error that names the file
}

function sameInputs(meta, inputs) {
  return INPUT_FIELDS.every((f) => isDeepStrictEqual(meta?.[f], inputs[f]));
}

/**
 * Open the store of a group. As a writer (the default) the folder and meta.json are created on first use, meta.json is checked on every
 * later open (it must say what the folder name says), and the LOCK is taken; call close() when done, also on an error path.
 * With { readOnly: true } nothing is created or locked and append() throws; a store that does not exist reads as empty.
 * options: readOnly, now (a function returning milliseconds; tests move the clock to test a stale lock).
 */
export function openStore(root, keyInputs, { readOnly = false, now = Date.now } = {}) {
  const inputs = normalizeKeyInputs(keyInputs);
  const key = storeKey(inputs);
  const key16 = storeDirName(key);
  const dir = join(root, 'runs', 'judgments', key16);
  const schema = cellSchema(root);

  let meta = null;
  let lock = null;
  if (readOnly) {
    meta = readMeta(dir);
  } else {
    mkdirSync(dir, { recursive: true });
    lock = takeLock(dir, now);
    try {
      meta = readMeta(dir);
      if (meta === null) {
        const hasRuns = RUNS.some((n) => existsSync(runFile(dir, n)));
        if (hasRuns) throw new Error(`${dir} holds judgments but no meta.json, so it cannot be checked against its key; move the folder aside`);
        meta = { key, ...inputs, created_at: new Date(now()).toISOString() };
        writeJsonAtomic(join(dir, 'meta.json'), meta);
      }
    } catch (e) {
      releaseLock(lock);
      throw e;
    }
  }
  if (meta !== null && (meta.key !== key || !sameInputs(meta, inputs))) {
    releaseLock(lock);
    throw new Error(`${join(dir, 'meta.json')} was made for other inputs than the ones asked for (its key ${meta.key}, asked for ${key}); the folder was changed or moved by hand`);
  }

  const cache = new Map(); // run -> Map(id -> last line)
  const load = (run) => {
    checkRun(run);
    if (cache.has(run)) return cache.get(run);
    const file = runFile(dir, run);
    const byId = new Map();
    if (readOnly && !existsSync(dir)) {
      cache.set(run, byId);
      return byId;
    }
    const { rows } = readJsonl(file);
    rows.forEach((row, i) => {
      const checked = validate(schema, row);
      if (!checked.ok) throw new Error(`${file}: line ${i + 1} is not a valid cell (${checked.errors.slice(0, 3).join('; ')})`);
      byId.set(row.id, row);
    });
    cache.set(run, byId);
    return byId;
  };

  let closed = false;
  return {
    dir,
    key,
    key16,
    inputs,
    meta,
    readOnly,

    /** Map id -> the last line of that item in run <run> (a copy: change it freely). */
    lines(run) {
      return new Map(load(run));
    },

    /** Append lines to run <run>. All are checked first; if one is bad nothing is written. */
    append(run, newLines) {
      if (readOnly) throw new Error('cells: this store was opened read-only');
      if (closed) throw new Error('cells: this store is closed');
      checkRun(run);
      const names = inputs.tags.map((t) => t.name);
      for (const [i, line] of newLines.entries()) {
        const checked = validate(schema, line);
        if (!checked.ok) throw new Error(`cells: line ${i + 1} to append is not a valid cell (${checked.errors.slice(0, 3).join('; ')})`);
        if (line.status === 'ok') {
          const got = line.tags.map((t) => t.name);
          const complete = got.length === names.length && names.every((n) => got.filter((g) => g === n).length === 1);
          if (!complete) throw new Error(`cells: the ok line for ${line.id} must hold each tag of the group once (${names.join(', ')}), got ${got.join(', ') || 'none'}`);
        } else if (line.tags.length > 0) {
          throw new Error(`cells: the error line for ${line.id} must not hold tags`);
        }
      }
      const byId = load(run);
      for (const line of newLines) {
        appendJsonl(runFile(dir, run), line);
        byId.set(line.id, line);
      }
    },

    /** [{ run, line }] for one item over runs 1 to 3 (any status), in run order; with itemHash only the lines made for that text. */
    runsFor(id, itemHash) {
      const out = [];
      for (const run of RUNS) {
        const line = load(run).get(id);
        if (line && (itemHash === undefined || line.item_hash === itemHash)) out.push({ run, line });
      }
      return out;
    },

    /** Release the lock (a reader has none). Safe to call twice. */
    close() {
      if (closed) return;
      closed = true;
      releaseLock(lock);
      lock = null;
    },
  };
}

/**
 * Set a store aside so that the group starts over: the folder is renamed to <key16>.superseded-<label> (never deleted, it stays as
 * history) and the next openStore with the same inputs makes a fresh one. Returns the new path, or null when there was nothing to set
 * aside (no folder, or one without any run file). Refuses (throws) while a fresh lock says a judge is using the store.
 */
export function archiveStore(root, keyInputs, label, { now = Date.now } = {}) {
  const dir = storeDir(root, keyInputs);
  if (!existsSync(dir)) return null;
  const lockFile = join(dir, 'LOCK');
  if (existsSync(lockFile)) {
    const held = readLock(lockFile);
    if (!lockIsStale(held, now)) throw lockBusyError(dir, held);
  }
  if (!RUNS.some((n) => existsSync(runFile(dir, n)))) return null;
  const stem = `${dir}.superseded-${String(label).replace(/[^A-Za-z0-9._-]/g, '-')}`;
  let target = stem;
  for (let n = 2; existsSync(target); n++) target = `${stem}-${n}`;
  rmSync(lockFile, { force: true });
  renameWithRetry(dir, target);
  return target;
}
