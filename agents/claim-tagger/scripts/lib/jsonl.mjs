// JSON and JSONL file helpers. Everything here is synchronous so scripts, hooks and tests can use it plainly.
//
// Ledgers are append-only JSONL with ONE writer per file. A crash can leave a torn last line (a row cut short,
// no newline after it): readJsonl ignores it and says so, and the next appendJsonl cuts it off before writing,
// so a resumed run never glues a good row onto a broken one.

import { randomBytes } from 'node:crypto';
import {
  appendFileSync, closeSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync,
  readFileSync, readSync, renameSync, unlinkSync, writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']); // Windows reports a locked destination as one of these

const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Read a JSONL file: { rows, torn }. A missing file is an empty ledger. A bad line anywhere but the end throws. */
export function readJsonl(path) {
  let text;
  try {
    text = stripBom(readFileSync(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { rows: [], torn: false };
    throw e;
  }
  const lines = text.split('\n');
  const last = lines.length - 1; // the text after the final newline; '' when the file ends with one
  const rows = [];
  let torn = false;
  for (let i = 0; i <= last; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    try {
      rows.push(JSON.parse(line));
    } catch (e) {
      if (i === last) torn = true; // no newline after it: a write that never finished
      else throw new Error(`${path}: line ${i + 1} is not valid JSON (${e.message})`, { cause: e });
    }
  }
  return { rows, torn };
}

// '' when the file ends cleanly, '\n' when its last row lacks a newline, and cuts a torn last line off the file.
function prepareTail(path) {
  let fd;
  try {
    fd = openSync(path, 'r+');
  } catch (e) {
    if (e.code === 'ENOENT') return '';
    throw e;
  }
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return '';
    const one = Buffer.alloc(1);
    readSync(fd, one, 0, 1, size - 1);
    if (one[0] === 0x0a) return '';
    let end = size;
    let tail = Buffer.alloc(0);
    let boundary = 0; // offset just after the last newline
    while (end > 0) {
      const len = Math.min(65536, end);
      end -= len;
      const chunk = Buffer.alloc(len);
      readSync(fd, chunk, 0, len, end);
      const nl = chunk.lastIndexOf(0x0a);
      if (nl >= 0) {
        tail = Buffer.concat([chunk.subarray(nl + 1), tail]);
        boundary = end + nl + 1;
        break;
      }
      tail = Buffer.concat([chunk, tail]);
    }
    try {
      JSON.parse(tail.toString('utf8'));
      return '\n'; // a complete row that only lacks its newline
    } catch {
      ftruncateSync(fd, boundary); // torn: drop the partial row
      return '';
    }
  } finally {
    closeSync(fd);
  }
}

/** Append one row as one line (parent folders are created). */
export function appendJsonl(path, obj) {
  const line = JSON.stringify(obj);
  if (typeof line !== 'string') throw new TypeError('appendJsonl: the row is not JSON serializable');
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, prepareTail(path) + line + '\n');
}

export function readJson(path) {
  const text = stripBom(readFileSync(path, 'utf8'));
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path}: invalid JSON (${e.message})`, { cause: e });
  }
}

/** rename with retries for a destination another process holds open (antivirus, an indexer, a reader on Windows). */
export function renameWithRetry(from, to, { retries = 5, delayMs = 50, rename = renameSync } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (e) {
      if (!RETRYABLE.has(e.code) || attempt >= retries) throw e;
      sleepSync(delayMs);
    }
  }
}

/** Write a file so readers see the old content or the new content, never half of it: temp file in the same folder, fsync, rename. */
export function writeTextAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `${basename(path)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    const fd = openSync(tmp, 'w');
    try {
      const buf = Buffer.from(text, 'utf8');
      let off = 0;
      while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameWithRetry(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // the temp file may not exist; the original error is the one to report
    }
    throw e;
  }
}

export function writeJsonAtomic(path, obj, { pretty = true } = {}) {
  const body = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
  if (typeof body !== 'string') throw new TypeError('writeJsonAtomic: the value is not JSON serializable');
  writeTextAtomic(path, body + '\n');
}
