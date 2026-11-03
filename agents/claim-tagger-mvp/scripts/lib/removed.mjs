// The claims that remove.mjs moved to Notion's trash (decision P51), kept in setup/removed-claims.json so that no script brings them back.
//
//   { "removed": [ { "geo_id": "<32 hex>", "run_id": "<the run of remove.mjs that trashed it>", "date": "<YYYY-MM-DD>" }, ... ] }
//
// sorted by Geo ID. Three readers use it: copy-live.mjs (a re-sync skips every first-page Claims row and Tag decisions row whose Geo ID is listed), `setup.mjs verify` (a listed claim is expected
// to be absent from Claims, and is a difference when it is still there) and remove.mjs itself (apply merges the claims of its run into the file, restore takes them out again).
//
//   removedFile(root)                         -> <root>/setup/removed-claims.json
//   readRemoved(root)                         -> { file, entries, ids } (ids: Set of the Geo IDs, dashes dropped and lower case); a missing file is an empty list, a file that does not
//                                                fit the shape above throws RemovedError (a list that cannot be trusted must not pass for "nothing was removed")
//   geoKey(id)                                -> the form two Geo IDs are compared in: dashes dropped, lower case
//   addRemoved(root, items)                   -> the entries now in the file: the old ones plus items [{ geo_id, run_id, date }], one entry per Geo ID (a repeated one takes the newer run), sorted
//   dropRemoved(root, runId, geoIds?)         -> the entries now in the file after the ones of that run (only those with a Geo ID in geoIds, when given) were taken out (the file stays, with an empty list when nothing is left)
//
// The file lives in the state root's setup/ folder, which is the agent folder itself in production.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJsonAtomic } from './jsonl.mjs';

export const REMOVED_FILE = 'removed-claims.json';

/** A removed-claims file that cannot be used. */
export class RemovedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RemovedError';
    this.code = 'REMOVED';
  }
}

export const removedFile = (root) => join(root, 'setup', REMOVED_FILE);
export const geoKey = (id) => String(id ?? '').trim().replace(/-/g, '').toLowerCase();

const byCodePoints = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (entries) => [...entries].sort((a, b) => byCodePoints(geoKey(a.geo_id), geoKey(b.geo_id)));
const text = (v) => (typeof v === 'string' ? v : '');

export function readRemoved(root) {
  const file = removedFile(root);
  if (!existsSync(file)) return { file, entries: [], ids: new Set() };
  let doc;
  try {
    doc = readJson(file);
  } catch (e) {
    throw new RemovedError(`${file} cannot be read: ${e.message}`);
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.removed)) {
    throw new RemovedError(`${file} is not valid: it must be { "removed": [ { "geo_id", "run_id", "date" } ] }`);
  }
  const problems = [];
  doc.removed.forEach((e, i) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) problems.push(`removed[${i}]: expected an object`);
    else {
      for (const field of ['geo_id', 'run_id', 'date']) if (text(e[field]).trim() === '') problems.push(`removed[${i}].${field}: expected a non-empty string`);
    }
  });
  if (problems.length) throw new RemovedError(`${file} is not valid:\n- ${problems.slice(0, 8).join('\n- ')}`);
  const entries = sorted(doc.removed.map((e) => ({ geo_id: e.geo_id.trim(), run_id: e.run_id, date: e.date })));
  return { file, entries, ids: new Set(entries.map((e) => geoKey(e.geo_id))) };
}

function write(root, entries) {
  writeJsonAtomic(removedFile(root), { removed: sorted(entries) });
  return readRemoved(root).entries;
}

export function addRemoved(root, items) {
  const merged = new Map(readRemoved(root).entries.map((e) => [geoKey(e.geo_id), e]));
  for (const item of items) {
    if (geoKey(item?.geo_id) === '' || text(item?.run_id).trim() === '' || text(item?.date).trim() === '') throw new RemovedError('addRemoved: each item needs a geo_id, a run_id and a date');
    merged.set(geoKey(item.geo_id), { geo_id: String(item.geo_id).trim(), run_id: item.run_id, date: item.date });
  }
  return write(root, [...merged.values()]);
}

export function dropRemoved(root, runId, geoIds = null) {
  const { entries } = readRemoved(root);
  const only = geoIds === null ? null : new Set(geoIds.map(geoKey));
  return write(root, entries.filter((e) => !(e.run_id === runId && (only === null || only.has(geoKey(e.geo_id))))));
}
