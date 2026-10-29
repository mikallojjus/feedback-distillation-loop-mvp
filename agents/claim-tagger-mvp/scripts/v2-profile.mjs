// Write the config of the v2 profile: agents/claim-tagger-mvp/profiles/v2/config.json, made from the live config.json (lib/v2-profile.mjs says what changes). Files only: no network, no .env.
//
//   node agents/claim-tagger-mvp/scripts/v2-profile.mjs init [--replace]
//   node agents/claim-tagger-mvp/scripts/v2-profile.mjs structure [--from <spec.md>]
//
// structure writes profiles/v2/setup/structure.json from docs/mvp-2026-11/STRUCTURE-V2.md (or --from): the proposal parsed and its completion block applied (lib/v2-profile.mjs
// completeStructure). The file is derived from the spec, so it is written again every time; it holds no ids.
//
// Refuses to overwrite a config that is there unless --replace is given (the ids that setup wrote into it would be lost). Then, with CLAIM_TAGGER_MVP_ROOT pointing at the profile folder,
// the build goes: setup.mjs builder open --reason "...", setup.mjs root, and the structure steps (only setup.mjs runs on v2 until the loop is ported, checkpoint 3).
// Exit codes: 0 ok, 2 invalid (usage, a config that is there, a production config that cannot be used).

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig, validateConfig } from './lib/config.mjs';
import { EXIT } from './lib/exit-codes.mjs';
import { writeJsonAtomic } from './lib/jsonl.mjs';
import { codeRoot, isMain } from './lib/paths.mjs';
import { countStructure, structurePath } from './lib/notion-build.mjs';
import { buildV2Config, completeStructure } from './lib/v2-profile.mjs';

export const USAGE = 'usage: v2-profile.mjs init [--replace] | structure [--from <spec.md>]';

/** The state root of the v2 profile (inside the agent folder, never moved by CLAIM_TAGGER_MVP_ROOT). */
export const v2Root = (code = codeRoot()) => join(code, 'profiles', 'v2');

export function main(argv = process.argv.slice(2), io = { out: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`) }, env = {}) {
  const [verb, ...rest] = argv;
  let values;
  try {
    ({ values } = parseArgs({ args: rest, options: { replace: { type: 'boolean' }, from: { type: 'string' } }, strict: true, allowPositionals: false }));
  } catch (e) {
    io.err(`v2-profile: ${e.message}\n${USAGE}`);
    return EXIT.INVALID;
  }
  if (verb !== 'init' && verb !== 'structure') {
    io.err(USAGE);
    return EXIT.INVALID;
  }
  const code = env.codeRoot ?? codeRoot();
  if (verb === 'structure') {
    const spec = values.from ?? join(code, '..', '..', 'docs', 'mvp-2026-11', 'STRUCTURE-V2.md');
    let structure;
    try {
      structure = completeStructure(readFileSync(spec, 'utf8'));
    } catch (e) {
      io.err(`v2-profile: ${spec}: ${e.message}`);
      return EXIT.INVALID;
    }
    const file = structurePath(env.root ?? v2Root(code));
    mkdirSync(dirname(file), { recursive: true });
    writeJsonAtomic(file, structure);
    const counts = countStructure(structure);
    io.out(`v2-profile: wrote ${file} from ${spec} (${JSON.stringify(counts)})`);
    return EXIT.OK;
  }
  const target = join(env.root ?? v2Root(code), 'config.json');
  if (existsSync(target) && values.replace !== true) {
    io.err(`v2-profile: ${target} exists; it may hold ids that setup wrote. Give --replace to write it again from the live config.`);
    return EXIT.INVALID;
  }
  let config;
  try {
    config = buildV2Config(env.production ?? loadConfig(code));
  } catch (e) {
    io.err(`v2-profile: ${e.message}`);
    return EXIT.INVALID;
  }
  const { ok, errors } = validateConfig(config);
  if (!ok) {
    io.err(`v2-profile: the v2 config built from the live one is not valid:\n- ${errors.join('\n- ')}`);
    return EXIT.INVALID;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeJsonAtomic(target, config);
  io.out(`v2-profile: wrote ${target} (profile v2; ${config.notion.protected_database_ids.length} protected database/view ids, ${config.notion.protected_page_ids.length} protected pages; tables and page are placeholders until setup.mjs runs)`);
  return EXIT.OK;
}

if (isMain(import.meta.url)) process.exitCode = main();
