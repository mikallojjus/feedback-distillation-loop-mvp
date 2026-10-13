// Shared helpers for the Notion I/O tests (not a test file): temporary agent roots, captured output, small worlds.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DATABASES } from '../../../agents/claim-tagger/scripts/allowlist.mjs';
import { composeWhenToUse, rubricToRows } from '../../../agents/claim-tagger/scripts/lib/rubric-build.mjs';
import { pull as pullLib } from '../../../agents/claim-tagger/scripts/pull.mjs';
import { AGENT, createFakeNotion, realConfig } from './fake-notion.mjs';

const dirs = [];

/** A temporary agent root (config.json and rubric/rubric.json copied in) and a temporary repo root WITHOUT a .env, so no test can find a token. */
export function makeRoot({ rubric = true, config = realConfig() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-notion-'));
  dirs.push(dir);
  const root = join(dir, 'agent');
  const repo = join(dir, 'repo');
  mkdirSync(join(root, 'runs'), { recursive: true });
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(root, 'config.json'), JSON.stringify(config, null, 2));
  if (rubric) {
    mkdirSync(join(root, 'rubric'), { recursive: true });
    cpSync(join(AGENT, 'rubric', 'rubric.json'), join(root, 'rubric', 'rubric.json'));
  }
  return { dir, root, repo, config };
}

export function cleanupRoots() {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export function captureIo() {
  const out = [];
  const err = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
}

/** A fixed clock for scripts that take `now`. */
export const clockAt = (iso) => () => new Date(iso);

// ---- a small world in the fake Notion --------------------------------------------------------------------------------

export const loadRubric = () => JSON.parse(readFileSync(join(AGENT, 'rubric', 'rubric.json'), 'utf8'));
export const USER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** The Rulebook row (plain values) for one tag of a rubric, the way seed phase 1 writes it. */
export function rulebookProps(row, rubric) {
  const tag = rubric.tags.find((t) => t.name === row.name);
  return {
    'Tag title': row.name, Status: 'Verified', Category: row.category, Polarity: row.polarity, ...(row.counterpart ? { Counterpart: row.counterpart } : {}),
    Description: row.description, 'Example claims': row.example_claims, 'When to use': row.when_to_use ?? composeWhenToUse(tag.when_to_use),
    'Human only': row.human_only, Judged: row.judged, 'Rule version': rubric.rubric_version, 'Tag hash': tag.tag_hash,
  };
}

/**
 * Fill a fake Notion: the 14 Rulebook rows of rubric.json, the Agent settings row, three claims, four Tag decisions (open, seeded,
 * editor-decided, needs-evidence), one Approved lesson with its supporting rows, one Runs row. Returns the page ids by name.
 */
export function buildWorld(fake, { rubric = loadRubric() } = {}) {
  const ids = { rulebook: {}, claims: {}, decisions: {} };
  for (const row of rubricToRows(rubric)) ids.rulebook[row.name] = fake.add('rulebook', rulebookProps(row, rubric));
  ids.settings = fake.add('agent_settings', { Name: 'claim-tagger', Paused: false, 'Weekly cap': 40, 'Rubric in force': rubric.rubric_version });
  const claim = (geo, title, sample, tags) => {
    ids.claims[geo] = fake.add('claims', {
      'Claim title': title, 'Geo ID': geo, 'Geo link': `https://geo.test/${geo}`, 'Sources count': 2, 'Source URLs': `https://geo.test/s1-${geo}\nhttps://geo.test/s2-${geo}`,
      Table: 'U.S. Politics', Sample: sample, 'Agent tags': tags.map((t) => ids.rulebook[t]), Readiness: 'Needs editor',
    });
  };
  claim('g1', 'Texas is on track to become a competitive swing state', 'Forecast', ['Debate', 'Opinion']);
  claim('g2', 'The Supreme Court is likely to expand executive power', 'Forecast', ['Unsourced']);
  claim('g3', 'The proposed OPT fees will damage the STEM talent pipeline', 'Decided', []);
  const decision = (geo, tag, extra) => {
    const key = `${geo}::${tag}`;
    ids.decisions[key] = fake.add('tag_decisions', {
      Key: key, Claim: [ids.claims[geo]], Tag: [ids.rulebook[tag]], 'Agent proposal': 'Keep tag', 'Agent confidence': 0.62, 'Why I recommend this': 'Because.',
      'Why in queue': 'Low confidence', Priority: 'High', 'Rubric version': rubric.rubric_version, ...extra,
    });
  };
  decision('g1', 'Predictive', {});
  decision('g2', 'Predictive', { 'Why in queue': 'Seeded decision', 'Seeded outcome': 'Does not apply', 'Seeded reasoning': 'Rule should change: likely is not a forecast.', 'Seeded at': '2026-10-09' });
  decision('g3', 'Hypothetical', { 'Tag outcome': 'Applies', 'Why wrong': 'Agent slip', 'Your reasoning': 'The rule covers it.', 'Decided by': [USER], 'Decided at': '2026-10-13' });
  decision('g3', 'Predictive', { 'Tag outcome': 'Needs evidence', 'Decided by': [USER], 'Decided at': '2026-10-13' });
  ids.lesson = fake.add('rule_changes', {
    'Lesson title': 'Hedged trajectories are not forecasts', Tag: [ids.rulebook.Predictive], Rule: 'Predictive rule 1', Kind: 'Change the rule', 'Current text': 'old', 'Proposed text': 'new',
    Status: 'Approved', 'Approved by': [USER],
  });
  fake.editorSet(ids.decisions['g2::Predictive'], { Lesson: [ids.lesson] });
  ids.run = fake.add('runs', { 'Run title': 'Smoke R1', Kind: 'Smoke', 'Rubric version': rubric.rubric_version, Started: '2026-10-13T12:00:00.000Z', 'Claims judged': 3, Verdict: 'n/a', 'Cost USD': 0.12 });
  return ids;
}

// ---- world + pull + clock in one object ---------------------------------------------------------------------------------

/**
 * A fake Notion with the standard world, a temporary agent root, a settable clock and a pull() that runs the real pull library
 * against the fake. w.clock.set(iso) moves time; w.pull(id, dbs) returns the pull result.
 */
export function makeWorld({ start = '2026-10-13T12:00:00.000Z', populate = true } = {}) {
  const fake = createFakeNotion({ now: () => new Date(time.t) });
  const time = { t: Date.parse(start) };
  const clock = { now: () => new Date(time.t), set: (iso) => { time.t = Date.parse(iso); }, advance: (ms) => { time.t += ms; } };
  const ids = populate ? buildWorld(fake) : null;
  const r = makeRoot();
  const w = {
    fake, ids, clock, ...r,
    pull: (id, dbs = DATABASES) => pullLib({ root: r.root, client: fake.client, dbs, pullId: id, now: clock.now }),
    env: (extra = {}) => ({ root: r.root, repoRoot: r.repo, client: fake.client, now: clock.now, ...extra }),
  };
  return w;
}
