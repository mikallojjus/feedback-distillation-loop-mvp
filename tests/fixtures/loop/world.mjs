// A world for the loop tests (not a test file): a temporary agent root with everything the scripts read (config, rubric and lock, prompts, schemas,
// evals, seed), a fake Notion filled from the real seed files (14 Rulebook rows, 60 claims, 50 queue rows, 27 of them decided through the seeded
// outcome), a settable clock and helpers that do what an editor, the rule owner or an apply would do. Nothing here reaches a network or a model.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DATABASES } from '../../../agents/claim-tagger/scripts/allowlist.mjs';
import { readJsonl } from '../../../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { claimProps, decisionProps, mergeClaims, readSourcesFill, rulebookProps } from '../../../agents/claim-tagger/scripts/seed.mjs';
import { pull as pullLib } from '../../../agents/claim-tagger/scripts/pull.mjs';
import { AGENT, createFakeNotion, realConfig } from '../notion/fake-notion.mjs';

export { AGENT };
export const USER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
export const OWNER = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';

const dirs = [];
export function cleanupLoop() {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export const liveRubric = () => JSON.parse(readFileSync(join(AGENT, 'rubric', 'rubric.json'), 'utf8'));

const writeJsonl = (path, rows) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, rows.length ? `${rows.map((r) => JSON.stringify(r)).join('\n')}\n` : '');
};

/**
 * A temporary agent root. cases / canaries: 'research' copies the real file, 'empty' writes an empty one, an array writes those rows.
 * Copies config.json (edited by `config(cfg)` when given), rubric/ (rubric.json, rubric.lock, CHANGELOG.md, history/), prompts/, schemas/ and evals/seed/.
 */
export function makeLoopRoot({ cases = 'empty', canaries = 'empty', config } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'geo-agents-loop-'));
  dirs.push(dir);
  const root = join(dir, 'agent');
  const repo = join(dir, 'repo');
  mkdirSync(join(root, 'runs'), { recursive: true });
  mkdirSync(repo, { recursive: true });
  const cfg = structuredClone(realConfig());
  config?.(cfg);
  writeFileSync(join(root, 'config.json'), JSON.stringify(cfg, null, 2));
  for (const name of ['rubric', 'prompts', 'schemas']) cpSync(join(AGENT, name), join(root, name), { recursive: true });
  mkdirSync(join(root, 'evals'), { recursive: true });
  cpSync(join(AGENT, 'evals', 'seed'), join(root, 'evals', 'seed'), { recursive: true });
  for (const [name, mode] of [['cases', cases], ['canaries', canaries]]) {
    const target = join(root, 'evals', `${name}.jsonl`);
    if (mode === 'research') cpSync(join(AGENT, 'evals', `${name}.jsonl`), target);
    else writeJsonl(target, Array.isArray(mode) ? mode : []);
  }
  return { dir, root, repo, config: cfg };
}

/** Fill a fake Notion from the seed files the way seed.mjs phases 1 to 3 do. Returns the page ids by name / geo id / key. */
export function seedFake(fake, { rubric = liveRubric(), seedDir = join(AGENT, 'evals', 'seed') } = {}) {
  const ids = { rulebook: {}, claims: {}, decisions: {}, settings: null };
  for (const tag of rubric.tags) ids.rulebook[tag.name] = fake.add('rulebook', rulebookProps(tag, rubric));
  ids.settings = fake.add('agent_settings', { Name: 'claim-tagger', 'Weekly cap': 40, 'Rubric in force': rubric.rubric_version });
  const claims = mergeClaims(readJsonl(join(seedDir, 'claims.seed.jsonl')).rows, readSourcesFill(seedDir)).claims;
  for (const c of claims) ids.claims[c.geo_id] = fake.add('claims', claimProps(c, (c.agent_tags ?? []).map((n) => ids.rulebook[n]).filter(Boolean)));
  for (const r of readJsonl(join(seedDir, 'decisions.seed.jsonl')).rows) ids.decisions[r.key] = fake.add('tag_decisions', decisionProps(r, { claim: ids.claims[r.geo_id], tag: ids.rulebook[r.tag] }));
  return ids;
}

/**
 * The whole world. Options: start (ISO time of the clock), seed (fill the fake from the seed files), cases and canaries (see makeLoopRoot), config.
 * w.pull(id, dbs) pulls the fake into the root; w.env(extra) is the env object the scripts' main() take; w.editor* helpers act as people.
 */
export function makeLoopWorld({ start = '2026-10-13T12:00:00.000Z', seed = true, cases = 'empty', canaries = 'empty', config } = {}) {
  const time = { t: Date.parse(start) };
  const clock = { now: () => new Date(time.t), set: (iso) => { time.t = Date.parse(iso); }, advance: (ms) => { time.t += ms; } };
  const fake = createFakeNotion({ now: () => new Date(time.t) });
  const r = makeLoopRoot({ cases, canaries, config });
  const ids = seed ? seedFake(fake) : null;
  const w = {
    fake, ids, clock, ...r,
    pull: async (id, dbs = DATABASES) => {
      const result = await pullLib({ root: r.root, client: fake.client, dbs, pullId: id, now: clock.now });
      return result;
    },
    env: (extra = {}) => ({ root: r.root, repoRoot: r.repo, client: fake.client, now: clock.now, ...extra }),
    /** An editor decides a queue row (editor-owned fields, written the way a person would: through the fake's editorSet). */
    decide(key, { outcome, why = null, reasoning = null, at = '2026-10-13', by = USER } = {}) {
      const pageId = ids.decisions[key] ?? fake.find('tag_decisions', key)?.page_id;
      if (!pageId) throw new Error(`no queue row ${key}`);
      fake.editorSet(pageId, { 'Tag outcome': outcome, ...(why ? { 'Why wrong': why } : {}), ...(reasoning ? { 'Your reasoning': reasoning } : {}), 'Decided by': [by], 'Decided at': at });
      return pageId;
    },
    /** A lesson row in Rule changes with supporting rows linked; returns its page id. */
    lesson({ title, tag, rule, kind = 'Change the rule', current, proposed, status = 'Proposed', supporting = [], editorWording, rubricVersion, gateResult, approvedBy }) {
      const id = fake.add('rule_changes', {
        'Lesson title': title, Tag: [ids.rulebook[tag]], ...(rule ? { Rule: rule } : {}), Kind: kind, 'Current text': current ?? '', 'Proposed text': proposed ?? '', Status: status,
        ...(editorWording ? { 'Editor wording': editorWording } : {}), ...(rubricVersion ? { 'Rubric version': rubricVersion } : {}), ...(gateResult ? { 'Gate result': gateResult } : {}),
        ...(approvedBy ? { 'Approved by': approvedBy } : status === 'Approved' || status === 'Live' ? { 'Approved by': [OWNER] } : {}),
      });
      for (const key of supporting) {
        const rowId = ids.decisions[key] ?? fake.find('tag_decisions', key)?.page_id;
        const current = fake.get(rowId).props.Lesson;
        fake.editorSet(rowId, { Lesson: [...current, id] });
      }
      return id;
    },
    setLessonStatus(pageId, status, extra = {}) {
      fake.editorSet(pageId, { Status: status, ...extra });
    },
  };
  return w;
}

export function captureIo() {
  const out = [];
  const err = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
}

export const readJsonlFile = (path) => (existsSync(path) ? readJsonl(path).rows : []);
