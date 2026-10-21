// The line a run records in run.json to be continued with (CONTRACTS section 10), and the one rule about it that production and a practice page do not share.
//
//   resumeFor(root, line)   -> `line` for production; on a practice page (a state folder directly under runs/demos/) the same command through the walkthrough runner:
//                              "node agents/claim-tagger-mvp/scripts/propose.mjs --driver fake"
//                              -> "node agents/claim-tagger-mvp/scripts/walkthrough.mjs run --demo <id> propose --driver fake"
//
// Why. The scripts take their state folder from CLAIM_TAGGER_MVP_ROOT, which the runner sets for a practice page and a person typing the bare line does not. A line copied
// from the run folder of a practice page and typed as it stood would have run against the production tables. Through the runner the page is named in the line itself,
// and the runner refuses what a practice page may not run (a script that is not on its list, --confirm, --bare, --fallback-model, --unpause).

import { basename, resolve } from 'node:path';
import { isDemoRoot } from './plan.mjs';

const BARE = /^node agents\/claim-tagger-mvp\/scripts\/([A-Za-z][A-Za-z0-9-]*)\.mjs(?: (.*))?$/;

export function resumeFor(root, line) {
  if (typeof line !== 'string' || !isDemoRoot(root)) return line;
  const m = BARE.exec(line);
  if (!m || m[1] === 'walkthrough') return line;
  return ['node agents/claim-tagger-mvp/scripts/walkthrough.mjs run --demo', basename(resolve(root)), m[1], m[2]].filter((part) => part !== undefined && part !== '').join(' ');
}
