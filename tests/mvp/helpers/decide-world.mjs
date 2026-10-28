// The world the tests of decide.mjs share: the in-memory Notion with six claims, and the editor's side of a decide run played through the fake's own editRow
// (what Claude's connector calls do between open and check). Nothing here touches the repository, the network or .env.

import { readFileSync } from 'node:fs';
import { listClaims, markerPath, resolveClaim } from '../../../agents/claim-tagger-mvp/scripts/decide.mjs';
import { loadPull } from '../../../agents/claim-tagger-mvp/scripts/pull.mjs';
import { claimText, makeWorld } from './loop-world.mjs';

export const TAG = 'Context-dependent';
export const cid = (n) => `c${String(n).padStart(2, '0')}`;
export const hex = (id) => String(id).replace(/-/g, '').toLowerCase();
export const waits = (confidence, over = {}) => ({
  'Agent status': 'Waits for you', 'Agent confidence': confidence, 'Tags waiting': [TAG], 'Review status': 'To review',
  'Agent reasons': `${TAG}: the pronoun has no antecedent · ${TAG} rule 1 · 2 of 3 runs agree`, ...over,
});
export const ledgerRow = (n, proposal, tag = TAG) => ({
  Claim: claimText(n), Key: `${cid(n)}::${tag}`, Tag: tag, 'Agent proposal': proposal, 'Agent confidence': 0.6, 'Agent reason': 'Maybe. · Context-dependent rule 3 · 2/3 runs agreed',
});
export const json = (list) => JSON.stringify(list);

/** The `seen` of every claim in the output of list, by Geo ID: the line `seen: <12 hex digits>` under each claim's block (a full block or a compact one). */
export function seenIn(output) {
  const map = new Map();
  let geo = null;
  for (const line of output.split('\n')) {
    const head = /^\[\d+\] (\S+)$/.exec(line);
    if (head) geo = head[1];
    const seen = /^ {2}seen: ([0-9a-f]{12})$/.exec(line);
    if (seen && geo) map.set(geo, seen[1]);
  }
  return map;
}

/**
 * The JSON of --decisions the way Claude builds it: the world is read again (pull, then list --all) and each decision gets the `seen` that list printed for its claim. A decision that has
 * its own `seen`, or that is not an object, is left as it is; a claim that list does not know (or any claim when list refuses, as under a pause) gets "000000000000" (12 hex digits that are nobody's fingerprint).
 */
export async function withSeen(w, list) {
  const p = await w.pull();
  const h = w.hooks();
  await listClaims({ ...h, all: true, pull: p.pullId });
  const seen = seenIn(h.io.outs.join('\n'));
  const claims = loadPull(w.root, p.pullId, { config: w.config }).claims();
  return json(list.map((d) => {
    if (d === null || typeof d !== 'object' || Array.isArray(d) || d.seen !== undefined) return d;
    return { ...d, seen: seen.get(resolveClaim(claims, d.claim)?.geo_id) ?? '000000000000' };
  }));
}

/** The fingerprint of one claim as list prints it now (the claims are pulled again first). */
export async function seenOf(w, geoId) {
  const p = await w.pull();
  const h = w.hooks();
  await listClaims({ ...h, all: true, pull: p.pullId });
  return seenIn(h.io.outs.join('\n')).get(geoId);
}

/** Six claims: c01 to c04 wait (confidence 0.9, 0.5, 0.7, 0.6), c05 is Done, c06 is Reviewed already. The agent proposed Applies on c01 to c04. */
export async function world(over = {}) {
  return makeWorld({
    claims: 6,
    claimRows: {
      [cid(1)]: waits(0.9), [cid(2)]: waits(0.5), [cid(3)]: waits(0.7), [cid(4)]: waits(0.6),
      [cid(5)]: { 'Agent status': 'Done', 'Agent confidence': 0.95 },
      [cid(6)]: { 'Agent status': 'Waits for you', 'Agent confidence': 0.4, 'Review status': 'Reviewed', 'Verified tags': [TAG], 'Challenged tags notes': 'Fine.' },
    },
    queue: [1, 2, 3, 4].map((n) => ledgerRow(n, 'Applies')),
    ...over,
  });
}

/** The calls that open printed, parsed (one per line that starts with a brace). */
export const callsIn = (output) => output.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));

/** What Claude does between open and check: one connector call per claim, played as an edit of the row in the fake Notion (only the properties the call carries). `only` limits it to the calls at those positions. */
export function claudeWrites(w, output, only = null) {
  const calls = callsIn(output);
  calls.forEach((call, i) => {
    if (only && !only.includes(i)) return;
    w.fake.editRow(call.page_id, { ...call.properties });
  });
  return calls;
}

export const openedOutput = (h) => h.io.outs.join('\n');
export const markerOf = (w) => JSON.parse(readFileSync(markerPath(w.root), 'utf8'));
