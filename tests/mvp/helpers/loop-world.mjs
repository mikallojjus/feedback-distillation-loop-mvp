// A throw-away world for the tests of the loop scripts: a temporary state folder (config.json, the rulebook edition, the examples), the in-memory
// Notion with the five tables seeded the way production has them, and the hooks every script takes (the fake's fetch and token, the fake CLI, a fixed
// clock, no pauses, no commit). Nothing here touches the repository, the network or .env.
//
//   const w = await makeWorld({ claims: 12, queue: [...], lessons: [...], audit: false })
//   w.root, w.config, w.fake, w.DB, w.ids          the state folder, the config with the table ids, the Notion fake, the table ids, page ids of the seeded rows
//   w.hooks(extra)                                 the options a script takes: { root, config, fetchImpl, token, sleep, now, io, driver: 'fake', fakeScript, fakeState, env, noCommit }
//   await w.pull() / await w.judge(opts)           pull every table / pull, then judge the claims (items: 'claims') under the fake CLI
//   w.table(obj) / w.overrides(list) / w.setEnv(k, v)   the fake CLI's answers (see fixtures/fake-claude-loop.mjs)
//   w.rows(table) / w.row(table, key)              plain rows of a table in the fake Notion (a relation is a list of page ids)
//   w.claim(geoId)                                 a row of the Claims copy with its three relations (Agent tags, Tags waiting, Verified tags) read as lists of tag names, sorted
//   w.editClaim(geoId, plain)                      an editor works on a claim: plain values of the Claims copy; "Verified tags" (and the agent's "Agent tags" and "Tags waiting") take tag names.
//                                                  The claims table has no Why wrong column any more: a "Why wrong" value is written as the reason word that opens the Challenged tags notes
//   w.review(geoId, { tags, notes, why })          an editor Reviews a claim: the verified tags, Challenged tags notes and Review status Reviewed. "why" (older tests) is the reason word the notes open with:
//                                                  review(id, { why: 'Rule unclear', notes: 'Rule 4 ...' }) writes the notes "Rule unclear. Rule 4 ..."
//   w.readings(table)                              the fake CLI's readings (FAKE_CLAUDE_READINGS): { "<row key>": { reading, rule, note } }; a key not in it is read Rule unclear on the rule its agent reason cites
//   w.rubric()                                     rubric/rubric.json of the state folder
//   w.calls() / w.callsWith(text)                  what the fake CLI was asked: all calls / the calls whose system prompt holds the text
//   w.requests()                                   every request the fake saw; w.writes() the ones that are not reads
//   w.setPaused(true|false)                        an editor ticks Paused in Agent settings

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';
import { judge } from '../../../agents/claim-tagger-mvp/scripts/judge.mjs';
import { codeRoot } from '../../../agents/claim-tagger-mvp/scripts/lib/paths.mjs';
import { lintReport } from '../../../agents/claim-tagger-mvp/scripts/lib/report.mjs';
import { buildRubric, readRubric, writeEdition } from '../../../agents/claim-tagger-mvp/scripts/lib/rubric.mjs';
import { latestPullId, loadPull, pull } from '../../../agents/claim-tagger-mvp/scripts/pull.mjs';
import { createFakeNotion } from '../fixtures/fake-notion.mjs';
import { builtConfig } from './config-fixture.mjs';
import { TABLE_SPECS, restProps } from './tables.mjs';

export const NOW = new Date('2026-10-16T09:00:00.000Z');
export const now = () => NOW;
export const noSleep = async () => {};
export const FAKE_SCRIPT = fileURLToPath(new URL('../fixtures/fake-claude-loop.mjs', import.meta.url));
const TAXONOMY = JSON.parse(readFileSync(join(codeRoot(), 'setup', 'taxonomy-issue.json'), 'utf8'));
export const AUDIT = JSON.parse(readFileSync(fileURLToPath(new URL('../../../docs/mvp-2026-11/evidence/03-audit-context-dependent-decisions.json', import.meta.url)), 'utf8'));
export const PICK = JSON.parse(readFileSync(join(codeRoot(), 'setup', 'claims-pick.json'), 'utf8'));

export const DB = {
  rulebook: 'c3000000000000000000000000000001',
  claims_copy: 'c3000000000000000000000000000002',
  tag_decisions: 'c3000000000000000000000000000003',
  rule_changes: 'c3000000000000000000000000000004',
  agent_settings: 'c3000000000000000000000000000005',
};
export const VIEWS = {
  your_queue: 'e3000000000000000000000000000001',
  needs_your_note: 'e3000000000000000000000000000002',
  agent_disagreed: 'e3000000000000000000000000000005',
  your_queue_ledger: 'e3000000000000000000000000000006',
  needs_your_note_ledger: 'e3000000000000000000000000000007',
  lessons_waiting: 'e3000000000000000000000000000003',
  rulebook: 'e3000000000000000000000000000004',
};

const dirs = [];
// Before the throw-away folders go, every report any script wrote in them must pass the report lint: that is how the tests check
// "every report written in the tests passes lintReport", also in the tests that do not look at the report themselves.
after(() => {
  const problems = [];
  for (const d of dirs) {
    const runs = join(d, 'runs');
    if (!existsSync(runs)) continue;
    for (const name of readdirSync(runs)) {
      const file = join(runs, name, 'report.md');
      if (!existsSync(file)) continue;
      for (const p of lintReport(readFileSync(file, 'utf8'))) problems.push(`${name}: ${p}`);
    }
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  rmSync(join(tmpdir(), `geo-agents-fake-claude-loop-${process.pid}`), { recursive: true, force: true }); // the merged answer tables of fixtures/fake-claude-loop.mjs
  assert.deepEqual(problems, [], 'a report written during the tests breaks the report lint');
});

/**
 * The notes with the reason word an older test gave as a claim's Why wrong (the column is gone): a line that starts with a tag name and a colon takes it after the colon unless it has
 * a reason word of its own, and notes with no such line take it at the front ("Rule unclear. The words."). This is the old rule, "the claim's Why wrong goes to every tag without a word of its own".
 */
export function withReasonWord(notes, why, tagNames) {
  const known = tagNames.map((n) => n.toLowerCase());
  const own = /^\s*(Agent slip|Rule unclear|Rule should change)\./i;
  let tagLines = false;
  const lines = notes.split(/\r?\n/).map((line) => {
    const m = /^(\s*)([^:\n]+?)(\s*:\s*)(.*)$/.exec(line);
    if (!m || !known.includes(m[2].trim().toLowerCase())) return line;
    tagLines = true;
    return own.test(m[4]) ? line : `${m[1]}${m[2]}${m[3]}${why}.${m[4].trim() ? ` ${m[4]}` : ''}`;
  });
  if (tagLines) return lines.join('\n');
  return own.test(notes) ? notes : `${why}.${notes.trim() ? ` ${notes.trim()}` : ''}`;
}

export const claimId = (i) => `c${String(i).padStart(2, '0')}`;
export const claimText = (i) => `The speaker said claim number ${i} about the budget.`;

/** The io object a script prints to: outs and errs collect what it printed. */
export function quietIo() {
  const io = { outs: [], errs: [], out: (s) => io.outs.push(s), err: (s) => io.errs.push(s) };
  return io;
}

/** The examples of evals/canaries.jsonl: the six example claims of Context-dependent (apply) and the five of its counterpart (do not apply). */
export function taxonomyCanaries(tag = 'Context-dependent') {
  const lines = (text) => String(text).split('\n').map((s) => s.trim()).filter(Boolean);
  const mine = TAXONOMY.rows.find((r) => r.Name === tag);
  const other = TAXONOMY.counterparts.find((r) => r.Name === mine.Counterpart);
  const rows = [
    ...lines(mine['Example Claims']).map((claim) => ({ tag, claim, expected: 'apply', source: `example claims of ${tag}` })),
    ...lines(other['Example Claims']).map((claim) => ({ tag, claim, expected: 'do_not_apply', source: `example claims of ${other.Name}` })),
  ];
  return rows.map((r, i) => ({ id: `canary-${i + 1}`, ...r }));
}

const write = (file, value) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
};
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

/**
 * Build a world. Options:
 *   claims      a number n (claims c01.. with claimText), a list of { id, text }, or 'pick' (the 50 claims of setup/claims-pick.json)
 *   rulebook    rows of the Rulebook copy (default: the 13 Issue rows of setup/taxonomy-issue.json); false: no rows and no edition
 *   queue       rows of Tag decisions (the ledger) as plain values;  audit: true seeds the 10 audit decisions the way the setup leaves them: as decided
 *               ledger rows (Why wrong "Agent slip") and on their claims (Reviewed, the Applies tags verified, Agent slip, the audit's words in Challenged tags notes)
 *   claimRows   { geoId: plain values } added to the claims after they are made (see w.editClaim)
 *   lessons     rows of Rule changes as plain values
 *   settings    false: no Agent settings row; an object: its values (Name, Paused, ...)
 *   canaries    true (default): write evals/canaries.jsonl from the taxonomy; a list: those rows; false: none
 *   edition     the first edition (default 2026-10-16.1);  demo: true makes the config a demo profile
 *   demoId      a practice page's state folder: the root is <temporary folder>/runs/demos/<demoId> (the way the walkthrough makes it), and the config is that demo's
 *   tableSpecs  { <table>: spec } to build a table with other columns than helpers/tables.mjs gives it (a Claims copy of the first build, say)
 *   configure   (config) => void, to change the config before it is written
 */
export async function makeWorld({
  claims = 12, rulebook, queue = [], audit = false, lessons = [], settings = {}, canaries = true, edition = '2026-10-16.1', demo = false, demoId = null, configure, claimRows = {}, tableSpecs = {},
} = {}) {
  const base = mkdtempSync(join(tmpdir(), 'geo-agents-mvp-loop-'));
  dirs.push(base);
  const root = demoId ? join(base, 'runs', 'demos', demoId) : base;
  if (demoId) {
    mkdirSync(root, { recursive: true });
    dirs.push(root);
  }
  const config = builtConfig(); // the config of fixtures/config.placeholder.json with ids filled in, never the live config.json
  config.notion.requests_per_second = 1000;
  const entries = { rulebook: config.notion.rulebook, claims_copy: config.notion.claims[0], ...config.notion.databases };
  Object.keys(DB).forEach((table, i) => {
    entries[table].database_id = DB[table];
    entries[table].data_source_id = `c400000000000000000000000000000${i + 1}`;
  });
  config.notion.views = { ...VIEWS };
  if (demo || demoId) {
    config.demo = true;
    config.demo_id = demoId ?? 'practice-1';
  }
  configure?.(config);
  write(join(root, 'config.json'), config);

  const fake = createFakeNotion({ protected: [...config.notion.protected_database_ids, ...config.notion.protected_page_ids] });
  for (const table of Object.keys(DB)) {
    fake.addDatabase({ id: DB[table], dataSourceId: entries[table].data_source_id, title: table, properties: restProps(tableSpecs[table] ?? TABLE_SPECS[table], entries.rulebook.data_source_id) });
  }
  const ids = { tag: {}, claim: {}, queue: {}, lesson: {}, settings: null };

  const rulebookRows = rulebook === undefined ? TAXONOMY.rows : (rulebook || []);
  for (const row of rulebookRows) {
    const { page_id: _ignored, ...plain } = row;
    ids.tag[row.Name] = fake.addRow(DB.rulebook, plain);
  }

  const claimList = claims === 'pick'
    ? PICK.rows.map((r) => ({ id: r['Geo ID'], text: r['Geo Name'], url: r['Geo URL'], sources: r['Geo Sources'], factual: r['Geo Is factual'] === true }))
    : (Array.isArray(claims) ? claims : Array.from({ length: claims }, (_, i) => ({ id: claimId(i + 1), text: claimText(i + 1) })));
  for (const c of claimList) {
    ids.claim[c.id] = fake.addRow(DB.claims_copy, {
      'Geo Name': c.text, 'Geo ID': c.id, 'Geo URL': c.url ?? `https://www.geobrowser.io/space/s/${c.id}`, 'Geo Sources': c.sources ?? '', 'Geo Is factual': c.factual ?? false,
    });
  }

  const tagIds = (names) => (names ?? []).map((n) => {
    if (!ids.tag[n]) throw new Error(`makeWorld: there is no tag "${n}" in the Rulebook copy`);
    return ids.tag[n];
  });
  const editClaim = (geoId, plain) => {
    if (!ids.claim[geoId]) throw new Error(`makeWorld: there is no claim "${geoId}"`);
    const { 'Verified tags': verified, 'Agent tags': agentTags, 'Tags waiting': waiting, 'Why wrong': why, ...rest } = plain;
    if (why) rest['Challenged tags notes'] = withReasonWord(String(rest['Challenged tags notes'] ?? ''), why, Object.keys(ids.tag));
    fake.editRow(ids.claim[geoId], {
      ...rest,
      ...(verified === undefined ? {} : { 'Verified tags': tagIds(verified) }),
      ...(agentTags === undefined ? {} : { 'Agent tags': tagIds(agentTags) }),
      ...(waiting === undefined ? {} : { 'Tags waiting': tagIds(waiting) }),
    });
  };
  for (const [geoId, plain] of Object.entries(claimRows)) editClaim(geoId, plain);

  if (audit) {
    for (const d of AUDIT.decisions) {
      const key = `${d.geo_id}::Context-dependent`;
      ids.queue[key] = fake.addRow(DB.tag_decisions, {
        Claim: d.claim, Key: key, Tag: 'Context-dependent', 'Agent proposal': d.agent_tags?.includes('Context-dependent') ? 'Applies' : 'Does not apply',
        'Claim link': `https://www.notion.so/${d.claim_page}`, 'Tag outcome': d.outcome,
        'Why wrong': (d.agent_tags?.includes('Context-dependent') ? 'Applies' : 'Does not apply') === d.outcome ? null : 'Agent slip',
        'Your reasoning': `From the audit of 9 October: ${d.reasoning}`,
      });
      if (ids.claim[d.geo_id]) {
        editClaim(d.geo_id, {
          'Verified tags': d.outcome === 'Applies' ? ['Context-dependent'] : [], 'Review status': 'Reviewed',
          'Challenged tags notes': `From the audit of 9 October: ${d.reasoning}`,
        });
      }
    }
  }
  for (const q of queue) ids.queue[q.Key] = fake.addRow(DB.tag_decisions, q);
  for (const l of lessons) ids.lesson[l.Lesson] = fake.addRow(DB.rule_changes, l);
  if (settings !== false) ids.settings = fake.addRow(DB.agent_settings, { Name: 'Claim tagger', Paused: false, 'Rulebook edition': edition, 'Last run summary': '', ...settings });

  const evalRows = canaries === true ? taxonomyCanaries() : (canaries || []);
  if (evalRows.length) write(join(root, 'evals', 'canaries.jsonl'), jsonl(evalRows));

  const world = {
    root, config, fake, DB, ids, fakeState: {}, env: {}, NOW, now, FAKE_SCRIPT, claimList,
    hooks(extra = {}) {
      return {
        root, config, fetchImpl: fake.fetchImpl, token: fake.token, sleep: noSleep, now, io: quietIo(), driver: 'fake', fakeScript: FAKE_SCRIPT,
        fakeState: world.fakeState, env: { ...process.env, ...world.env }, noCommit: true, ...extra,
      };
    },
    async pull(opts = {}) {
      return pull({ root, config, tables: 'all', fetchImpl: fake.fetchImpl, token: fake.token, sleep: noSleep, now, ...opts });
    },
    async judge(opts = {}) {
      await world.pull();
      const h = world.hooks();
      return judge({
        root, driver: 'fake', io: h.io, env: h.env, fakeState: world.fakeState, fakeScript: FAKE_SCRIPT, sleep: noSleep, now, ...opts,
      });
    },
    table(obj) {
      const file = join(root, 'fake-table.json');
      write(file, obj);
      world.env.FAKE_CLAUDE_TABLE = file;
    },
    overrides(list) {
      const file = join(root, 'fake-overrides.json');
      write(file, list);
      world.env.FAKE_LOOP_OVERRIDES = file;
    },
    distillReply(obj) {
      const file = join(root, 'fake-distill.json');
      write(file, obj);
      world.env.FAKE_LOOP_DISTILL = file;
    },
    readings(table) {
      const file = join(root, 'fake-readings.json');
      write(file, table);
      world.env.FAKE_CLAUDE_READINGS = file;
    },
    setEnv(key, value) {
      if (value === undefined || value === null) delete world.env[key];
      else world.env[key] = value;
    },
    editClaim,
    review: (geoId, { tags = [], why = null, notes = '' } = {}) => editClaim(geoId, {
      'Verified tags': tags, 'Review status': 'Reviewed', 'Why wrong': why, 'Challenged tags notes': notes,
    }),
    rows: (table) => fake.plainRows(DB[table]),
    claim(geoId) {
      const row = fake.plainRows(DB.claims_copy).find((r) => r['Geo ID'] === geoId);
      if (!row) return null;
      const byPage = new Map(Object.entries(ids.tag).map(([name, id]) => [String(id).replace(/-/g, '').toLowerCase(), name]));
      const named = (list) => (list ?? []).map((id) => byPage.get(String(id).replace(/-/g, '').toLowerCase()) ?? id).sort();
      return { ...row, 'Agent tags': named(row['Agent tags']), 'Tags waiting': named(row['Tags waiting']), 'Verified tags': named(row['Verified tags']) };
    },
    row(table, key) {
      const keyColumn = { rulebook: 'Name', claims_copy: 'Geo ID', tag_decisions: 'Key', rule_changes: 'Lesson', agent_settings: 'Name' }[table];
      return fake.plainRows(DB[table]).find((r) => r[keyColumn] === key) ?? null;
    },
    rubric: () => readRubric(root),
    calls: () => world.fakeState.log ?? [],
    callsWith(text) {
      return world.calls().filter((c) => c.systemPromptFile && readFileSync(c.systemPromptFile, 'utf8').includes(text));
    },
    requests: () => fake.requests,
    writes: () => fake.writes(),
    setPaused(value) {
      fake.editRow(ids.settings, { Paused: value });
    },
    write: (rel, value) => write(join(root, rel), value),
    read: (rel) => readFileSync(join(root, rel), 'utf8'),
  };

  if (rulebookRows.length) {
    await world.pull();
    const rows = loadPull(root, latestPullId(root), { config }).rulebook();
    writeEdition(root, buildRubric(rows, { config, edition, now: NOW }), { reason: 'the first edition of the test world' });
  }
  return world;
}

/** The fake table of a judge scenario: every claim answers do_not_apply with p 0.1 unless the entries say otherwise. */
export const confident = (claims, over = {}) => {
  const table = {};
  for (const c of claims) table[c.text ?? c] = { decision: 'do_not_apply', p: 0.1 };
  return { ...table, ...over };
};
