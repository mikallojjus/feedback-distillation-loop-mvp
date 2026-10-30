// The world the tests of decide.mjs share: the in-memory Notion with six claims and their rows of Tag decisions, and the editor's side of a decide run played through the fake's own
// editRow (what Claude's connector calls do between open and check). Nothing here touches the repository, the network or .env.

import { readFileSync } from 'node:fs';
import { listRows, markerPath, resolveRow } from '../../../agents/claim-tagger-mvp/scripts/decide.mjs';
import { loadPull } from '../../../agents/claim-tagger-mvp/scripts/pull.mjs';
import { claimText, makeWorld } from './loop-world.mjs';

export const TAG = 'Context-dependent';
export const EDITION = '2026-10-16.1';
export const cid = (n) => `c${String(n).padStart(2, '0')}`;
export const keyOf = (n, tag = TAG) => `${cid(n)}::${tag}`;
export const hex = (id) => String(id).replace(/-/g, '').toLowerCase();
/** A row of Tag decisions that waits in Your queue (the view's own filter: Agent status Waits for you, no Tag outcome, no tick). */
export const ledgerRow = (n, proposal, over = {}, tag = TAG) => ({
  Claim: claimText(n), Key: keyOf(n, tag), Tag: tag, 'Agent proposal': proposal, 'Agent confidence': 0.6, 'Agent reason': `${tag}: the pronoun has no antecedent · ${tag} rule 1 · 2 of 3 runs agree`,
  'Agent status': 'Waits for you', 'Rulebook edition': EDITION, ...over,
});
export const json = (list) => JSON.stringify(list);

/** The `seen` of every row in the output of list, by Key: the line `seen: <12 hex digits>` under each row's block (a full block or a compact one). */
export function seenIn(output) {
  const map = new Map();
  let key = null;
  for (const line of output.split('\n')) {
    const head = /^\[\d+\] (\S+)$/.exec(line);
    if (head) key = head[1];
    const seen = /^ {2}seen: ([0-9a-f]{12})$/.exec(line);
    if (seen && key) map.set(key, seen[1]);
  }
  return map;
}

/**
 * The JSON of --decisions the way Claude builds it: the world is read again (pull, then list --all) and each decision gets the `seen` that list printed for its row. A decision that has
 * its own `seen`, or that is not an object, is left as it is; a row that list does not know (or any row when list refuses, as under a pause) gets "000000000000" (12 hex digits that are nobody's fingerprint).
 */
export async function withSeen(w, list) {
  const p = await w.pull();
  const h = w.hooks();
  await listRows({ ...h, all: true, pull: p.pullId });
  const seen = seenIn(h.io.outs.join('\n'));
  const rows = loadPull(w.root, p.pullId, { config: w.config }).queue();
  return json(list.map((d) => {
    if (d === null || typeof d !== 'object' || Array.isArray(d) || d.seen !== undefined) return d;
    return { ...d, seen: seen.get(resolveRow(rows, d.row)?.Key) ?? '000000000000' };
  }));
}

/** The fingerprint of one row as list prints it now (the tables are pulled again first). */
export async function seenOf(w, key) {
  const p = await w.pull();
  const h = w.hooks();
  await listRows({ ...h, all: true, pull: p.pullId });
  return seenIn(h.io.outs.join('\n')).get(key);
}

/**
 * Six claims and their rows. c01 to c04 wait on Context-dependent (proposal Applies; confidence 0.9, 0.5, 0.7, 0.6); c04 has a second row, Wordy (Can't tell, 0.3); c05 is Done; c06 is decided
 * already (Tag outcome Does not apply against the proposal Applies, with a note).
 */
export async function world(over = {}) {
  return makeWorld({
    claims: 6,
    queue: [
      ledgerRow(1, 'Applies', { 'Agent confidence': 0.9 }), ledgerRow(2, 'Applies', { 'Agent confidence': 0.5 }), ledgerRow(3, 'Applies', { 'Agent confidence': 0.7 }),
      ledgerRow(4, 'Applies', { 'Agent confidence': 0.6 }), ledgerRow(4, "Can't tell", { 'Agent confidence': 0.3 }, 'Wordy'),
      ledgerRow(5, 'Does not apply', { 'Agent status': 'Done', 'Agent confidence': 0.95 }),
      ledgerRow(6, 'Applies', {
        'Agent status': 'Disagrees with your decision', 'Agent confidence': 0.4, 'Tag outcome': 'Does not apply', 'Your note': 'Fine.', 'Decided under': EDITION,
      }),
    ],
    ...over,
  });
}

/** The calls that open printed, parsed (one per line that starts with a brace). */
export const callsIn = (output) => output.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));

// the connector's form of a checkbox, as the fake Notion keeps it
const plainOf = (properties) => Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, v === '__YES__' ? true : v === '__NO__' ? false : v]));

/** What Claude does between open and check: one connector call per row, played as an edit of the row in the fake Notion (only the properties the call carries). `only` limits it to the calls at those positions. */
export function claudeWrites(w, output, only = null) {
  const calls = callsIn(output);
  calls.forEach((call, i) => {
    if (only && !only.includes(i)) return;
    w.fake.editRow(call.page_id, plainOf(call.properties));
  });
  return calls;
}

export const openedOutput = (h) => h.io.outs.join('\n');
export const markerOf = (w) => JSON.parse(readFileSync(markerPath(w.root), 'utf8'));
