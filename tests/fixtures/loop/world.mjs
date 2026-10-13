// A world for the loop tests (not a test file): a temporary agent root with everything the scripts read (config, rubric and lock, prompts, schemas,
// evals, seed), a fake Notion, a settable clock and helpers that do what an editor, the rule owner or an apply would do. Nothing here reaches a network
// or a model.
//   makeLoopWorld()      the fake filled from the real seed files (14 Rulebook rows, 60 claims, 50 queue rows, 27 of them decided through the seeded outcome)
//   makeMiniWorld(rows)  the 14 Rulebook rows and the Agent settings row, plus exactly the claims and queue rows the test describes
//   makePromoteWorld()   the seeded world after the demo's step 5: decisions, one Approved lesson with supporting rows, the real cases-sync run

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATABASES } from '../../../agents/claim-tagger/scripts/allowlist.mjs';
import { readJsonl } from '../../../agents/claim-tagger/scripts/lib/jsonl.mjs';
import { composeWhenToUse } from '../../../agents/claim-tagger/scripts/lib/rubric-build.mjs';
import { main as casesSyncMain } from '../../../agents/claim-tagger/scripts/cases-sync.mjs';
import { claimProps, decisionProps, mergeClaims, readSourcesFill, rulebookProps } from '../../../agents/claim-tagger/scripts/seed.mjs';
import { pull as pullLib } from '../../../agents/claim-tagger/scripts/pull.mjs';
import { AGENT, createFakeNotion, realConfig } from '../notion/fake-notion.mjs';

export { AGENT };
/**
 * The frozen inputs the loop tests run on, so that a real run on the live agent folder (cases-sync rewriting evals/cases.jsonl, a promote moving the
 * rubric on) cannot change a test: rubric/ is rubric 2026-10-13.1 with its lock, history and changelog, cases.jsonl the 62 research cases and
 * canaries.jsonl the 86 research canaries, all as they were before the first real run. Nothing in here is ever written.
 */
export const RESEARCH = fileURLToPath(new URL('../research/', import.meta.url));
export const USER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
export const OWNER = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';

const dirs = [];
export function cleanupLoop() {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** The rubric of the test world: the frozen rubric 2026-10-13.1 (see RESEARCH), not whatever the live agent folder holds now. */
export const liveRubric = () => JSON.parse(readFileSync(join(RESEARCH, 'rubric', 'rubric.json'), 'utf8'));
/** A stable 32-hex Geo id for a short test name. */
export const geoId = (name) => createHash('sha256').update(String(name)).digest('hex').slice(0, 32);

const writeJsonl = (path, rows) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, rows.length ? `${rows.map((r) => JSON.stringify(r)).join('\n')}\n` : '');
};

/**
 * A temporary agent root. cases / canaries: 'research' copies the frozen research file (RESEARCH), 'empty' writes an empty one, an array writes those rows.
 * Copies config.json (edited by `config(cfg)` when given), prompts/, schemas/ and evals/seed/ from the agent folder and the frozen rubric/ (rubric.json,
 * rubric.lock, CHANGELOG.md, history/) from RESEARCH.
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
  cpSync(join(RESEARCH, 'rubric'), join(root, 'rubric'), { recursive: true });
  for (const name of ['prompts', 'schemas']) cpSync(join(AGENT, name), join(root, name), { recursive: true });
  mkdirSync(join(root, 'evals'), { recursive: true });
  cpSync(join(AGENT, 'evals', 'seed'), join(root, 'evals', 'seed'), { recursive: true });
  for (const [name, mode] of [['cases', cases], ['canaries', canaries]]) {
    const target = join(root, 'evals', `${name}.jsonl`);
    if (mode === 'research') cpSync(join(RESEARCH, `${name}.jsonl`), target);
    else writeJsonl(target, Array.isArray(mode) ? mode : []);
  }
  return { dir, root, repo, config: cfg };
}

/** Rulebook rows (all 14 tags of the live rubric) and the Agent settings row. */
function seedRulebook(fake, ids, rubric) {
  for (const tag of rubric.tags) ids.rulebook[tag.name] = fake.add('rulebook', rulebookProps(tag, rubric));
  ids.settings = fake.add('agent_settings', { Name: 'claim-tagger', 'Weekly cap': 40, 'Rubric in force': rubric.rubric_version });
}

/** Fill a fake Notion from the seed files the way seed.mjs phases 1 to 3 do. */
export function seedFake(fake, ids, { rubric = liveRubric(), seedDir = join(AGENT, 'evals', 'seed') } = {}) {
  seedRulebook(fake, ids, rubric);
  const claims = mergeClaims(readJsonl(join(seedDir, 'claims.seed.jsonl')).rows, readSourcesFill(seedDir)).claims;
  for (const c of claims) ids.claims[c.geo_id] = fake.add('claims', claimProps(c, (c.agent_tags ?? []).map((n) => ids.rulebook[n]).filter(Boolean)));
  for (const r of readJsonl(join(seedDir, 'decisions.seed.jsonl')).rows) ids.decisions[r.key] = fake.add('tag_decisions', decisionProps(r, { claim: ids.claims[r.geo_id], tag: ids.rulebook[r.tag] }));
}

/**
 * The whole world. Options: start (ISO time of the clock), seed (fill the fake from the seed files), cases and canaries (see makeLoopRoot), config.
 * w.pull(id, dbs) pulls the fake into the root; w.env(extra) is the env object the scripts' main() take; w.decide / w.lesson act as people.
 */
export function makeLoopWorld({ start = '2026-10-13T12:00:00.000Z', seed = true, cases = 'empty', canaries = 'empty', config } = {}) {
  const time = { t: Date.parse(start) };
  const clock = { now: () => new Date(time.t), set: (iso) => { time.t = Date.parse(iso); }, advance: (ms) => { time.t += ms; } };
  const fake = createFakeNotion({ now: () => new Date(time.t) });
  const r = makeLoopRoot({ cases, canaries, config });
  const ids = { rulebook: {}, claims: {}, decisions: {}, settings: null };
  if (seed) seedFake(fake, ids);
  const pageOf = (key) => ids.decisions[key] ?? fake.find('tag_decisions', key)?.page_id;
  const w = {
    fake, ids, clock, ...r,
    pull: async (id, dbs = DATABASES) => pullLib({ root: r.root, client: fake.client, dbs, pullId: id, now: clock.now }),
    env: (extra = {}) => ({ root: r.root, repoRoot: r.repo, client: fake.client, now: clock.now, ...extra }),
    /** An editor decides a queue row (the editor-owned fields, written the way a person would: through the fake's editorSet). */
    decide(key, { outcome, why = null, reasoning = null, at = '2026-10-13', by = USER } = {}) {
      const pageId = pageOf(key);
      if (!pageId) throw new Error(`no queue row ${key}`);
      fake.editorSet(pageId, { 'Tag outcome': outcome, ...(why ? { 'Why wrong': why } : {}), ...(reasoning ? { 'Your reasoning': reasoning } : {}), 'Decided by': [by], 'Decided at': at });
      return pageId;
    },
    /** A lesson row in Rule changes with the supporting rows linked; returns its page id. */
    lesson({ title, tag, rule, kind = 'Change the rule', current, proposed, status = 'Proposed', supporting = [], editorWording, rubricVersion, gateResult, approvedBy }) {
      const id = fake.add('rule_changes', {
        'Lesson title': title, Tag: [ids.rulebook[tag]], ...(rule ? { Rule: rule } : {}), Kind: kind, 'Current text': current ?? '', 'Proposed text': proposed ?? '', Status: status,
        ...(editorWording ? { 'Editor wording': editorWording } : {}), ...(rubricVersion ? { 'Rubric version': rubricVersion } : {}), ...(gateResult ? { 'Gate result': gateResult } : {}),
        ...(approvedBy ? { 'Approved by': approvedBy } : status === 'Approved' || status === 'Live' ? { 'Approved by': [OWNER] } : {}),
      });
      for (const key of supporting) {
        const rowId = pageOf(key);
        fake.editorSet(rowId, { Lesson: [...fake.get(rowId).props.Lesson, id] });
      }
      return id;
    },
    setLessonStatus(pageId, status, extra = {}) {
      fake.editorSet(pageId, { Status: status, ...extra });
    },
    /**
     * Add claims and queue rows. A spec: { id (short name), claim, tag, outcome (Applies | Does not apply | other | null), why, reasoning, at,
     * seeded (true: the outcome goes in the Seeded columns), seededReasoning, proposal, note, agentReason, sources }. Returns the keys in order.
     */
    addRows(specs) {
      const keys = [];
      for (const s of specs) {
        const geo = s.geo ?? geoId(s.id);
        if (!ids.claims[geo]) {
          ids.claims[geo] = fake.add('claims', {
            'Claim title': s.claim, 'Geo ID': geo, 'Geo link': `https://geo.test/${geo}`, 'Sources count': s.sources ?? 2, 'Source URLs': 'https://geo.test/s1\nhttps://geo.test/s2', Table: 'U.S. Politics', Sample: 'Forecast',
          });
        }
        const key = `${geo}::${s.tag}`;
        const props = {
          Key: key, Claim: [ids.claims[geo]], Tag: [ids.rulebook[s.tag]], 'Agent proposal': s.proposal ?? 'Do not add tag', 'Why I recommend this': s.agentReason ?? 'The agent saw no rule fire.',
          ...(s.note ? { 'Agent full note': s.note } : {}), 'Why in queue': 'Low confidence', Priority: 'Medium', 'Rubric version': '2026-10-13.1',
        };
        const decided = ['Applies', 'Does not apply'].includes(s.outcome) || s.outcome === 'Needs evidence' || s.outcome === 'Ask another editor';
        if (decided && s.seeded) {
          Object.assign(props, { 'Seeded outcome': s.outcome, ...(s.seededReasoning ? { 'Seeded reasoning': s.seededReasoning } : {}), 'Seeded at': s.at ?? '2026-10-09' });
        } else if (decided) {
          Object.assign(props, { 'Tag outcome': s.outcome, ...(s.why ? { 'Why wrong': s.why } : {}), ...(s.reasoning ? { 'Your reasoning': s.reasoning } : {}), 'Decided by': [USER], 'Decided at': s.at ?? '2026-10-13' });
        }
        ids.decisions[key] = fake.add('tag_decisions', props);
        keys.push(key);
      }
      return keys;
    },
  };
  return w;
}

/** The 14 Rulebook rows and the Agent settings row, plus the claims and queue rows the test describes (see addRows). */
export function makeMiniWorld({ rows = [], ...opts } = {}) {
  const w = makeLoopWorld({ ...opts, seed: false });
  seedRulebook(w.fake, w.ids, liveRubric());
  w.keys = w.addRows(rows);
  return w;
}

export function captureIo() {
  const out = [];
  const err = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
}

export const readJsonlFile = (path) => (existsSync(path) ? readJsonl(path).rows : []);

// ---- a world with one Approved lesson, ready to promote ----------------------------------------------------------------------------------

export const LESSON_TITLE = 'Hedged trajectories are not forecasts';
export const LESSON_RULE_TEXT = 'Fires on an unconditional future marker: will, is expected to, is forecasted to, is projected to, is set to. A hedged tendency ("is likely to", "is on track to") does not fire this rule.';

/** Full key of a seeded queue row from its first characters, e.g. rowKey(w, 'f376c2cc') (Texas, Predictive). */
export const rowKey = (w, prefix, tag = 'Predictive') => Object.keys(w.ids.decisions).find((k) => k.startsWith(prefix) && k.endsWith(`::${tag}`));

/**
 * The seeded world plus what the demo's storyline has by step 5: two hedged forecasts the editor decided Does not apply / Rule should change, two flat
 * forecasts decided Applies, and the lesson LESSON_TITLE (Predictive rule 1, Change the rule) in the given Status, supported by those two rows and by
 * the two seeded hedged rows (Texas, Supreme Court). The pull p1 is taken and the REAL cases-sync has written evals/cases.jsonl, so the four supporting
 * rows are contested cases of the lesson and six Predictive positives are active. Options: canaryTags (which of the real canaries to copy), research.
 */
export async function makePromoteWorld({ lessonStatus = 'Approved', canaryTags = ['Predictive', 'Hypothetical', 'Context-dependent', 'Self-contained'], research = false, lessonOptions = {} } = {}) {
  const real = readJsonl(join(RESEARCH, 'canaries.jsonl')).rows.filter((x) => x.active === true && x.contested !== true && canaryTags.includes(x.tag));
  const w = makeLoopWorld({ cases: research ? 'research' : 'empty', canaries: research ? 'research' : real });
  const hedged = [rowKey(w, '6e820a8a'), rowKey(w, '8172f325')];
  for (const key of hedged) w.decide(key, { outcome: 'Does not apply', why: 'Rule should change', reasoning: 'A hedged tendency is not a forecast.' });
  for (const key of [rowKey(w, 'f4d50e38'), rowKey(w, '8b17d6ea')]) w.decide(key, { outcome: 'Applies', why: 'Agent slip', reasoning: 'A flat will is a forecast.' });
  const rubric = liveRubric();
  const rule1 = rubric.tags.find((t) => t.name === 'Predictive').when_to_use.rules.find((x) => x.n === 1);
  const supporting = [rowKey(w, 'f376c2cc'), rowKey(w, '6aa014be'), ...hedged];
  const lessonPage = w.lesson({
    title: LESSON_TITLE, tag: 'Predictive', rule: 'Predictive rule 1', kind: 'Change the rule', current: composeWhenToUse({ rules: [rule1] }), proposed: LESSON_RULE_TEXT, status: lessonStatus, supporting, ...lessonOptions,
  });
  await w.pull('p1');
  const sync = captureIo();
  const code = await casesSyncMain([], sync.io, w.env());
  if (code !== 0) throw new Error(`cases-sync failed in the fixture: ${sync.err.join(' ')}`);
  return { w, lessonPage, supporting, hedged, rubric };
}
