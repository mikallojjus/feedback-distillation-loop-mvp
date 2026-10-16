// What the setup tests share: a state folder with a config whose tables are still placeholders (the config as it was before setup, from
// fixtures/config.placeholder.json, never the live agents/claim-tagger-mvp/config.json that setup has since filled in), the shared in-memory Notion
// with a parent page in it, clients over it, and small input files (a taxonomy file, a claims pick, the audit file) shaped like the real ones in
// agents/claim-tagger-mvp/setup/. Nothing here reaches the network or reads .env: every client gets the fake's own token.
//
//   newWorld({ structure: true })        -> { root, config, fake, parent, env, run(argv) -> { code, out, err } }
//   realStructure(), revisedStructure()   the approved proposal of 15 October read from docs/mvp-2026-11/STRUCTURE.md (the old shape), and the structure the build uses since
//                                         16 October: agents/claim-tagger-mvp/setup/structure.json (the claims carry the editor's columns, the ledger Decided under, seven views)
//   builderClient(fake), restClient(fake) clients over the fake (builder version 2026-03-11 / default 2022-06-28), paced at 1000 a second
//   FAKE_HAS_USER_COLUMNS, forFake(structure)   the fake may not know created_by / last_edited_by columns: forFake removes them when it does not
//   smallTaxonomy(), fullTaxonomy(), makePick({ audit, extra }), writeInputs(dir, ...)
//   cleanTmp()                           remove every folder the helpers made (call it from the test file's after())

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILDER_API_VERSION, createClient } from '../../../agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs';
import { nextEdition } from '../../../agents/claim-tagger-mvp/scripts/lib/rubric.mjs';
import { main } from '../../../agents/claim-tagger-mvp/scripts/setup.mjs';
import { structureFromProposal } from '../../../agents/claim-tagger-mvp/scripts/lib/notion-build.mjs';
import { createFakeNotion } from '../fixtures/fake-notion.mjs';
import { placeholderConfig } from './config-fixture.mjs';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const STRUCTURE_MD = join(REPO_ROOT, 'docs', 'mvp-2026-11', 'STRUCTURE.md');
export const AUDIT_FILE = join(REPO_ROOT, 'docs', 'mvp-2026-11', 'evidence', '03-audit-context-dependent-decisions.json');
export const REAL_TAXONOMY = join(REPO_ROOT, 'agents', 'claim-tagger-mvp', 'setup', 'taxonomy-issue.json');
export const REAL_PICK = join(REPO_ROOT, 'agents', 'claim-tagger-mvp', 'setup', 'claims-pick.json');
const RULEBOOK_FIXTURE = join(REPO_ROOT, 'tests', 'mvp', 'fixtures', 'rulebook-rows.json');

/** A moment in the middle of the day, local time, so the UTC day is the same everywhere: 15 Oct 2026 14:22. */
export const NOW = () => new Date(2026, 9, 15, 14, 22);
export const EDITION = nextEdition(null, NOW()); // the first edition of the day: 2026-10-15.1
export const noSleep = async () => {};

const dirs = [];
export function tmp(label = 'setup') {
  const d = mkdtempSync(join(tmpdir(), `geo-agents-mvp-${label}-`));
  dirs.push(d);
  return d;
}
export function cleanTmp() {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const readLines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ---- clients and the fake ----------------------------------------------------------------------------------------------------------------

export const builderClient = (fake) => createClient({ token: fake.token, fetchImpl: fake.fetchImpl, apiVersion: BUILDER_API_VERSION, requestsPerSecond: 1000, sleep: noSleep });
export const restClient = (fake) => createClient({ token: fake.token, fetchImpl: fake.fetchImpl, requestsPerSecond: 1000, sleep: noSleep });

/** Does the shared fake accept created_by and last_edited_by columns? (Its list of property types is the fixture owner's to extend.) */
async function fakeKnowsUserColumns() {
  const fake = createFakeNotion();
  const parent = fake.addPage({ title: 'probe' });
  try {
    await builderClient(fake).createDatabase({ parentPageId: parent, title: 'probe', properties: { Name: { type: 'title', title: {} }, By: { type: 'created_by', created_by: {} } } });
    return true;
  } catch {
    return false;
  }
}
export const FAKE_HAS_USER_COLUMNS = await fakeKnowsUserColumns();

/** The structure as the fake can build it: without created_by and last_edited_by columns when the fake does not know them. */
export function forFake(structure) {
  const copy = structuredClone(structure);
  if (!FAKE_HAS_USER_COLUMNS) for (const t of Object.values(copy.tables)) t.columns = t.columns.filter((c) => c.type !== 'created_by' && c.type !== 'last_edited_by');
  return copy;
}

export const realStructure = () => structureFromProposal(readFileSync(STRUCTURE_MD, 'utf8'));
export const revisedStructure = () => JSON.parse(readFileSync(join(REPO_ROOT, 'agents', 'claim-tagger-mvp', 'setup', 'structure.json'), 'utf8'));

/** A config for the tests: the one from before setup (fixtures/config.placeholder.json), tables still placeholders, no waiting between requests, a parent page that exists in the fake. */
export function testConfig({ parent }) {
  const config = placeholderConfig();
  config.notion.requests_per_second = 1000;
  config.notion.parent_page_id = parent;
  return config;
}

/**
 * A state folder, a fake Notion with a parent page, and a way to run setup.mjs commands against them.
 * `structure: true` also writes setup/structure.json from the revised structure (without the columns the fake cannot build).
 */
export function newWorld({ structure = false, protectedIds = null } = {}) {
  const root = tmp('setup');
  const probe = placeholderConfig();
  const fake = createFakeNotion({ protected: protectedIds ?? [...probe.notion.protected_database_ids, ...probe.notion.protected_page_ids] });
  const parent = fake.addPage({ title: 'Feedback Distillation MVP' });
  const config = testConfig({ parent });
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  if (structure) {
    mkdirSync(join(root, 'setup'), { recursive: true });
    writeFileSync(join(root, 'setup', 'structure.json'), `${JSON.stringify(forFake(revisedStructure()), null, 2)}\n`);
  }
  const env = { root, fetchImpl: fake.fetchImpl, token: fake.token, sleep: noSleep, now: NOW, repoRoot: root };
  const w = { root, config, fake, parent, env };
  w.run = async (argv, extra = {}) => {
    const out = [];
    const err = [];
    const code = await main(argv, { out: (s) => out.push(s), err: (s) => err.push(s) }, { ...env, ...extra });
    return { code, out, err, text: [...out, ...err].join('\n') };
  };
  return w;
}

// ---- input files -------------------------------------------------------------------------------------------------------------------------

export const CONTEXT_DEPENDENT_EXAMPLES = [
  "Open AI's initiative went well with the target group.",
  'He said the new model outperforms its predecessor.',
  "The company's revenue grew 40% after the launch.",
  'Core Lightning developers are keeping the technical details of the vulnerabilities under embargo for two weeks.',
  'The Commodity Futures Trading Commission did not comment specifically on the discussions.',
  'The Bitcoin ETF successfully integrated Bitcoin into traditional brokerage accounts.',
];
export const SELF_CONTAINED_EXAMPLES = [
  'OpenAI released GPT-5 in August 2025.',
  "The shift to domestic chips supports Beijing's ambitions to substitute American technology.",
  'Nvidia reported record data-center revenue, and the company raised its full-year guidance.',
  'A security researcher disclosed a race condition in the Ledger Ethereum app.',
  'Water boils at 100 degrees Celsius at sea level.',
];

const CD_WHEN = [
  '1. A pronoun with no antecedent inside the claim ("He said ...", "its predecessor", "they announced") makes the claim Context-dependent.',
  '2. A definite reference that needs an outside antecedent to identify it ("the vulnerabilities", "the discussions", "the recording") makes the claim Context-dependent, even when other entities in the claim are named.',
  '3. A descriptive definite that names a kind of thing but not which one ("the Bitcoin ETF", "the new model") makes the claim Context-dependent.',
  '4. Test: could a reader who sees only this sentence say which specific thing each definite reference points at? If any answer is no, tag Context-dependent.',
  '5. Do not use for indefinites, time expressions, generics, or definites the claim itself resolves.',
].join('\n');

const ids = (n) => `7${String(n).padStart(2, '0')}273e214eb83458bd7819ebe81bd9e`.slice(0, 32);

function row(name, fields = {}, n = 0) {
  return {
    Name: name, Category: null, Counterpart: null, Description: null, Evidence: null, 'Example Claims': null, 'Geo Status': null, 'Geo Tag ID': null, Polarity: null,
    Status: null, 'Verified on': null, 'When to use': null, 'Work tags': ['Issue'], page_id: ids(n), ...fields,
  };
}

const contextDependent = () => row('Context-dependent', {
  Category: 'Quality', Counterpart: 'Self-contained', Description: 'A claim whose meaning depends on something introduced outside it.', Evidence: 'https://example.com/calibration-report',
  'Example Claims': CONTEXT_DEPENDENT_EXAMPLES.join('\n'), 'Geo Status': 'To be created', Polarity: 'Issue', Status: 'Verified', 'Verified on': '2026-09-10',
  'When to use': CD_WHEN, 'Work tags': ['Pipeline benchmark check', 'Issue'],
}, 1);

const selfContained = () => row('Self-contained', {
  Category: 'Quality', Counterpart: 'Context-dependent', Description: 'A claim that identifies every essential referent clearly enough to be understood on its own.',
  'Example Claims': SELF_CONTAINED_EXAMPLES.join('\n'), 'Geo Status': 'To be created', Polarity: 'Classification', Status: 'Verified', 'Verified on': '2026-09-10', 'Work tags': ['Pipeline benchmark check'],
}, 90);

/** The small taxonomy file: two rows, one counterpart. Same shape as setup/taxonomy-issue.json. */
export function smallTaxonomy() {
  return {
    read_at: '2026-10-15T11:40:00Z', read_via: 'connector', database_id: 'f05273e214eb8353b0a981544507de32', data_source_id: 'b65273e2-14eb-8362-86a6-870ea8d632f4', filter: 'Work tags contains Issue',
    rows: [
      contextDependent(),
      row('Trailing period', { Category: 'Format', Description: 'A claim that ends with a full stop.', 'Example Claims': 'The ban took effect in May.', 'Geo Status': 'To be created', Polarity: 'Issue', Status: 'Proposed' }, 2),
    ],
    counterparts: [selfContained()],
  };
}

export const TAG_NAMES = [
  'Context-dependent', 'Exact duplicate', 'Factually challenged', 'Improper capitalization', 'Improperly sourced', 'Incorrect grammar', 'Multi-sentence', 'Poor wording',
  'Semantically duplicated', 'Source inaccessible', 'Trailing period', 'Unsourced', 'Wordy',
];

/** The full taxonomy file: the 13 Issue rows (text for the ones the repo's fixture has, plain rows for the rest) and the counterpart with its five examples. */
export function fullTaxonomy() {
  const fixture = new Map(readJson(RULEBOOK_FIXTURE).map((r) => [r.Name, r]));
  const rows = TAG_NAMES.map((name, i) => {
    if (name === 'Context-dependent') return contextDependent();
    const f = fixture.get(name);
    if (f) return row(name, { ...f, 'Work tags': f['Work tags'] ?? ['Issue'], page_id: ids(i + 10) }, i + 10);
    return row(name, { Category: 'Quality', Description: `A claim that carries the tag ${name}.`, 'Geo Status': 'To be created', Polarity: 'Issue', Status: 'Proposed' }, i + 10);
  });
  return { ...smallTaxonomy(), rows, counterparts: [selfContained()] };
}

/**
 * A claims pick shaped like setup/claims-pick.json: one row per audit decision (when `audit` is given), then `extra` more, each with every
 * real column, page_id, url, source_links and source_pieces. Claims with an even index have two linked sources, odd ones none.
 */
export function makePick({ audit = null, extra = 3 } = {}) {
  const base = [];
  for (const d of audit?.decisions ?? []) base.push({ id: d.geo_id, name: d.claim });
  for (let i = 0; i < extra; i += 1) base.push({ id: `ee${String(i).padStart(2, '0')}${'0'.repeat(28)}`, name: `Extra claim number ${i + 1} about a policy` });
  const rows = base.map(({ id, name }, i) => {
    const pieces = i % 2 === 0
      ? [{ text: `Source one of ${i}`, href: `https://www.geobrowser.io/space/s/${id}-1` }, { text: '\n', href: null }, { text: `Source two of ${i}`, href: `https://www.geobrowser.io/space/s/${id}-2` }]
      : [];
    return {
      'Geo Sources': pieces.map((p) => p.text).join(''), 'Geo ID': id, 'Review status': null, 'Geo URL': `https://www.geobrowser.io/space/s/${id}`,
      'Claim quality tags — verified': ['765273e2-14eb-8345-8bd7-819ebe81bd9e'], 'Geo Tags': i % 3 === 0 ? ['Debate', 'Economy'] : ['Debate'], 'Challenged tags notes': 'QA audit',
      'Geo Name source': 'This space', 'Geo Topics': i % 2 ? '' : 'Budget', 'Geo Score': i === 1 ? 0.25 : null, 'Geo Supporting arguments': '', 'Geo Related people': '', 'Proposed Tags': [],
      'Geo Opposing arguments': '', 'Proposed rename': '', 'Geo Related projects': '', 'Geo Is factual': i === 2, 'Proposed Topics': '', 'Editors challenging the QA tags': [],
      'Review notes': '', 'Geo Name': name, page_id: `3f2273e2-14eb-819a-89ae-e658e01e09${String(i).padStart(2, '0')}`, url: `https://app.notion.com/p/${i}`, last_edited_time: '2026-10-08T14:49:00.000Z',
      source_links: pieces.filter((p) => p.href).map((p) => ({ text: p.text, href: p.href, form: 'rich_text' })), source_pieces: pieces,
    };
  });
  return { seed: 'test', picked_at: '2026-10-15T11:32:48.918Z', dry_run: 'dry-1', audit_ids: (audit?.decisions ?? []).map((d) => d.geo_id), random_ids: rows.slice(audit?.decisions?.length ?? 0).map((r) => r['Geo ID']), rows };
}

export const readAuditFile = () => readJson(AUDIT_FILE);

/** Write the three input files into `dir`; returns their paths. */
export function writeInputs(dir, { taxonomy = smallTaxonomy(), pick = makePick({ audit: readAuditFile() }), audit = readAuditFile() } = {}) {
  mkdirSync(dir, { recursive: true });
  const files = { taxonomy: join(dir, 'taxonomy-issue.json'), claims: join(dir, 'claims-pick.json'), audit: join(dir, 'audit.json') };
  writeFileSync(files.taxonomy, `${JSON.stringify(taxonomy, null, 2)}\n`);
  writeFileSync(files.claims, `${JSON.stringify(pick, null, 2)}\n`);
  writeFileSync(files.audit, `${JSON.stringify(audit, null, 2)}\n`);
  return files;
}
