// Write setup/structure.json of the v2 page from its spec. Files only: no network, no .env.
//
//   node agents/claim-tagger-mvp/scripts/v2-profile.mjs structure [--from <spec.md>] [--replace]
//
// structure writes <agent root>/setup/structure.json from docs/mvp-2026-11/STRUCTURE-V2.md (or --from): the proposal parsed and its completion block applied
// (lib/v2-profile.mjs completeStructure). The file is derived from the spec and holds no ids. It refuses to overwrite a file that is there unless --replace is given.
//
// `init` (which wrote profiles/v2/config.json from the per-claim config) is gone since the config swap (P48): config.json is the v2 config now, and there is nothing left to
// derive it from. The command still answers, with exit 2 and one sentence, so that an old instruction fails loudly instead of as a usage error.
// Exit codes: 0 ok, 2 invalid (usage, init, a structure file that is there).

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { EXIT } from './lib/exit-codes.mjs';
import { writeJsonAtomic } from './lib/jsonl.mjs';
import { agentRoot, codeRoot, isMain } from './lib/paths.mjs';
import { countStructure, structurePath } from './lib/notion-build.mjs';
import { completeStructure } from './lib/v2-profile.mjs';

export const USAGE = 'usage: v2-profile.mjs structure [--from <spec.md>] [--replace]';
export const INIT_REFUSAL = 'v2-profile: init is gone: config.json is the v2 config since the config swap (P48). The per-claim config is at the git tag claim-tagger-v1.';

export function main(argv = process.argv.slice(2), io = { out: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`) }, env = {}) {
  const [verb, ...rest] = argv;
  if (verb === 'init') {
    io.err(INIT_REFUSAL);
    return EXIT.INVALID;
  }
  let values;
  try {
    ({ values } = parseArgs({ args: rest, options: { replace: { type: 'boolean' }, from: { type: 'string' } }, strict: true, allowPositionals: false }));
  } catch (e) {
    io.err(`v2-profile: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (verb !== 'structure') {
    io.err(USAGE);
    return EXIT.INVALID;
  }
  const code = env.codeRoot ?? codeRoot();
  const spec = values.from ?? join(code, '..', '..', 'docs', 'mvp-2026-11', 'STRUCTURE-V2.md');
  const file = structurePath(env.root ?? agentRoot());
  if (existsSync(file) && values.replace !== true) {
    io.err(`v2-profile: ${file} exists; give --replace to write it again from the spec.`);
    return EXIT.INVALID;
  }
  let structure;
  try {
    structure = completeStructure(readFileSync(spec, 'utf8'));
  } catch (e) {
    io.err(`v2-profile: ${spec}: ${e.message}`);
    return EXIT.INVALID;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeJsonAtomic(file, structure);
  io.out(`v2-profile: wrote ${file} from ${spec} (${JSON.stringify(countStructure(structure))})`);
  return EXIT.OK;
}

if (isMain(import.meta.url)) process.exitCode = main();
