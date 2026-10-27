// The world the tests of decide.mjs share: the in-memory Notion with six claims, and the editor's side of a decide run played through the fake's own editRow
// (what Claude's connector calls do between open and check). Nothing here touches the repository, the network or .env.

import { readFileSync } from 'node:fs';
import { markerPath } from '../../../agents/claim-tagger-mvp/scripts/decide.mjs';
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

/** What Claude does between open and check: one connector call per claim, played as an edit of the row in the fake Notion. `only` limits it to the calls at those positions. */
export function claudeWrites(w, output, only = null) {
  const calls = callsIn(output);
  calls.forEach((call, i) => {
    if (only && !only.includes(i)) return;
    const p = call.properties;
    w.fake.editRow(call.page_id, { 'Verified tags': p['Verified tags'], 'Challenged tags notes': p['Challenged tags notes'], 'Review status': p['Review status'] });
  });
  return calls;
}

export const openedOutput = (h) => h.io.outs.join('\n');
export const markerOf = (w) => JSON.parse(readFileSync(markerPath(w.root), 'utf8'));
