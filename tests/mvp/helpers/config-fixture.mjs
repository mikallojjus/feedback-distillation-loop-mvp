// The config that the tests start from. agents/claim-tagger-mvp/config.json is the live file: setup writes the ids of the tables, the two pages and the
// views it made into it, so what it holds changes with the state of the real Notion page. The tests must not depend on that. They start from
// fixtures/config.placeholder.json instead, the config as it was committed before setup ran (git revision 5a56502): every id that setup fills is still a
// placeholder, and everything else (the protected lists, the sources, the tags, the judge settings) is what the shipped file says.
//
//   placeholderConfig()   a fresh deep copy of the fixture, checked with validateConfig: the config before setup
//   builtConfig()         the same with every placeholder under notion replaced by an id of its own: a config as it is after setup
//   fillIds(node)         replace the placeholders in `node` (a string that starts with "<") in place; returns how many were replaced
//
// A test that wants the ids of its own tables sets them on the copy it got (entry.database_id = ...); a test that checks the shape of the live
// file on purpose (config.test.mjs, transcript-check.test.mjs) reads agents/claim-tagger-mvp/config.json itself and accepts a placeholder or a real id.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../../../agents/claim-tagger-mvp/scripts/lib/config.mjs';

export const PLACEHOLDER_CONFIG_FILE = fileURLToPath(new URL('../fixtures/config.placeholder.json', import.meta.url));

let cached = null;

/** The config before setup: the fixture, parsed and checked once, and a deep copy of it every time, so that no test can change what the next one gets. */
export function placeholderConfig() {
  if (cached === null) {
    const config = JSON.parse(readFileSync(PLACEHOLDER_CONFIG_FILE, 'utf8'));
    const { ok, errors } = validateConfig(config);
    if (!ok) throw new Error(`${PLACEHOLDER_CONFIG_FILE} is not a valid config:\n- ${errors.join('\n- ')}`);
    cached = config;
  }
  return structuredClone(cached);
}

/** Replace every placeholder string in `node` by a real-looking id, each one different (5e7a0000-0000-4000-8000-000000000001, ...2, ...). Returns the count. */
export function fillIds(node, start = 0) {
  let n = start;
  const walk = (value) => {
    for (const [key, inner] of Object.entries(value)) {
      if (typeof inner === 'string' && inner.startsWith('<')) {
        n += 1;
        value[key] = `5e7a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      } else if (inner !== null && typeof inner === 'object') walk(inner);
    }
  };
  walk(node);
  return n - start;
}

/** The config after setup, built from the fixture: ids in the five tables and in the pages that setup makes, nothing read from the live file. */
export function builtConfig() {
  const config = placeholderConfig();
  fillIds(config.notion);
  return config;
}
