// Gate evidence: what a plan claims about the Rulebook, proven from files on disk instead of believed from the plan's own header.
//
// A plan header carries ctx { seed, promote, gate, restore, confirm } and the allowlist trusts it. A plan file is only a file, though, and a
// header can be forged (EN-1: a copied plan with ctx { promote: true, gate: "PASS" } replaced a rule text with no gate behind it). So
// plan.mjs `check` and apply.mjs ask this module, which reads files only and never decides from the header alone:
//
//   promote   claimed by ctx.promote, or implied by a Rulebook op that writes When to use / Rule version / Tag hash / Changed by (unless the
//             header claims a restore or a seed, which are proven their own way) or by a lesson set to Live: runs/PROMOTING.json names this
//             run (and, when it records plan_sha, that is this plan file); runs/<run>/card.json is a gate card (schema), verdict PASS, not smoke,
//             for PROMOTING.lesson; runs/<run>/candidate/rubric.json has intact hashes, is the card's candidate and PROMOTING.version, and
//             the card's baseline is the live rubric/rubric.json (its own hashes intact); every Rulebook op is a tag the candidate changed and
//             carries the candidate's text, tag hash, version and the lesson; the promoted lesson is Approved in the pull whenever a rule is
//             rewritten or a lesson set to Live (and only that lesson may be set to Live); Rubric in force is the candidate's version.
//   restore   ctx.restore with ctx.confirm: every Rulebook text is the live rubric's own (rubric.json, intact, matching rubric.lock).
//   seed      ctx.seed: the marker runs/SETUP exists (an engineer creates it by hand before the seed and removes it afterwards).
//   none      a Rulebook op that writes When to use under none of these claims is a problem.
//
// checkGateEvidence({ root, plan, pull, config }) -> { ok, problems: [plain sentences], evidence: { modes: [...], ...what was found } }.
// `plan` is readPlan()'s result ({ header, ops, dir }), `pull` a loadPull() object (the lesson's status and page id come from its
// norm/lessons.jsonl and id map). `config` is accepted so callers can pass what resolveOps takes; no evidence depends on it.
// A plan that claims nothing and touches no Rulebook text costs no file read at all.
//
// A resumed apply sees its own earlier work: once the lesson op has landed (runs/<run>/applied.jsonl says ok) the lesson is Live in the
// pull, and that counts as the Approved the plan started from.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { controlPaths } from '../allowlist.mjs';
import { fileSha256 } from './hash.mjs';
import { readJson, readJsonl } from './jsonl.mjs';
import { agentRoot, codeFile } from './paths.mjs';
import { checkHashes, composeWhenToUse } from './rubric-build.mjs';
import { validate } from './validate.mjs';

/** The Rulebook columns that carry the rule: writing any of them is a promote (or a restore, or the seed). */
export const RULE_PROPS = Object.freeze(['When to use', 'Rule version', 'Tag hash', 'Changed by']);
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasProp = (props, name) => isObject(props) && Object.hasOwn(props, name);
const normId = (id) => String(id ?? '').replace(/-/g, '').toLowerCase();
const show = (v) => (typeof v === 'string' ? JSON.stringify(v.length > 48 ? `${v.slice(0, 45)}...` : v) : (JSON.stringify(v) ?? 'nothing'));
const tagNamed = (rubric, name) => rubric.tags.find((t) => t.name === name) ?? null;

/**
 * The "Rule version" a Rulebook row of a tag carries in a rubric: the version of the last changelog entry that names the tag, else the
 * version the rubric started with, else the rubric's own. The same rule as status.mjs tagRuleVersion (a test keeps the two equal).
 */
export function ruleVersionOf(rubric, tagName) {
  const log = Array.isArray(rubric.changelog) ? rubric.changelog : [];
  for (let i = log.length - 1; i >= 0; i--) if (log[i]?.tag === tagName && log[i].version) return log[i].version;
  return log[0]?.version ?? rubric.rubric_version;
}

/**
 * What a plan claims, from its header and its ops: { ctx, ops, promote, restore, seed, rulebook, live, needPromote, needed }.
 * rulebook: the ops that write a rule column; live: the rule_changes ops that set Status Live.
 */
export function gateClaims(plan) {
  const ctx = isObject(plan?.header?.ctx) ? plan.header.ctx : {};
  const ops = Array.isArray(plan?.ops) ? plan.ops.filter(isObject) : [];
  const rulebook = ops.filter((o) => o.database === 'rulebook' && RULE_PROPS.some((p) => hasProp(o.properties, p)));
  const live = ops.filter((o) => o.database === 'rule_changes' && hasProp(o.properties, 'Status') && o.properties.Status === 'Live');
  const promote = ctx.promote === true;
  const restore = ctx.restore === true;
  const seed = ctx.seed === true;
  // A rule written with no restore or seed behind it is a promote, whatever the header says; a lesson set to Live always is.
  const needPromote = promote || live.length > 0 || (rulebook.length > 0 && !restore && !seed);
  return { ctx, ops, promote, restore, seed, rulebook, live, needPromote, needed: promote || restore || seed || rulebook.length > 0 || live.length > 0 };
}

/** True when the plan claims or does anything checkGateEvidence has to prove (apply.mjs loads a pull only then). */
export const evidenceNeeded = (plan) => gateClaims(plan).needed;

// ---- small readers -------------------------------------------------------------------------------------------------------------------

function readFileJson(file, label, add) {
  if (!existsSync(file)) {
    add(`${label} does not exist`);
    return null;
  }
  try {
    return readJson(file);
  } catch {
    add(`${label} is not readable JSON`);
    return null;
  }
}

/** The card schema: the root's own copy when it has one, else the agent folder's (a sandbox root holds state, not schemas). */
function readCardSchema(root) {
  const file = codeFile(root, 'schemas', 'card.schema.json');
  if (!existsSync(file)) throw new Error('schemas/card.schema.json does not exist');
  return readJson(file);
}

/** rubric.lock against rubric.json (version, hash, file bytes): the text is only "locked" while they agree. */
function lockProblems(root, live, rubricFile) {
  const lockFile = join(root, 'rubric', 'rubric.lock');
  if (!existsSync(lockFile)) return ['rubric/rubric.lock does not exist, so the live rubric is not locked'];
  let lock;
  try {
    lock = readJson(lockFile);
  } catch {
    return ['rubric/rubric.lock is not readable JSON'];
  }
  const out = [];
  if (!isObject(lock)) return ['rubric/rubric.lock is not a lock file'];
  if (lock.rubric_version !== live.rubric_version) out.push(`rubric/rubric.lock says version ${lock.rubric_version}, rubric.json is ${live.rubric_version}`);
  if (lock.rubric_hash !== live.rubric_hash) out.push(`rubric/rubric.lock says ${lock.rubric_hash}, rubric.json is ${live.rubric_hash}`);
  if (lock.file_sha256 && lock.file_sha256 !== fileSha256(rubricFile)) out.push('rubric/rubric.json was changed after it was locked (file_sha256 differs)');
  return out;
}

/** The live rubric, with its own hashes checked (and rubric.lock when `locked`); null (and a problem) when it cannot be used. */
function loadLive(root, add, { locked = false } = {}) {
  const file = join(root, 'rubric', 'rubric.json');
  const live = readFileJson(file, 'rubric/rubric.json (the live rubric)', add);
  if (live === null) return null;
  if (!isObject(live) || !Array.isArray(live.tags)) {
    add('rubric/rubric.json is not a rubric');
    return null;
  }
  const hashes = checkHashes(live);
  if (!hashes.ok) add(`rubric/rubric.json does not match its own hashes (${hashes.mismatches.length}, first: ${hashes.mismatches[0].kind} ${hashes.mismatches[0].where})`);
  if (locked) for (const p of lockProblems(root, live, file)) add(p);
  return live;
}

function lessonRows(pull) {
  if (!pull?.dir || (typeof pull.covers === 'function' && !pull.covers('rule_changes'))) return null;
  const file = join(pull.dir, 'norm', 'lessons.jsonl');
  if (!existsSync(file)) return null;
  try {
    return readJsonl(file).rows;
  } catch {
    return null;
  }
}

/** The ledger of the run says this op landed (apply.mjs wrote it after Notion accepted the call). */
function ledgerSaysOk(runDir, seq) {
  try {
    return readJsonl(join(runDir, 'applied.jsonl')).rows.some((r) => r.seq === seq && r.status === 'ok');
  } catch {
    return false;
  }
}

// ---- promote -------------------------------------------------------------------------------------------------------------------------

function promoteEvidence({ root, runId, claims, pull, plan, add, evidence }) {
  const { runs } = controlPaths(root);
  const runDir = plan?.dir ?? join(runs, runId);

  // 1. runs/PROMOTING.json names this run
  const promotingFile = join(runs, 'PROMOTING.json');
  if (!existsSync(promotingFile)) {
    add(`runs/PROMOTING.json does not exist: no promote of run ${runId} is in flight, so no gate PASS backs this plan`);
    return;
  }
  let promoting;
  try {
    promoting = readJson(promotingFile);
  } catch {
    add('runs/PROMOTING.json is not readable JSON');
    return;
  }
  if (!isObject(promoting) || promoting.run_id !== runId) {
    add(`runs/PROMOTING.json belongs to run ${isObject(promoting) && promoting.run_id ? promoting.run_id : '(none)'}, not to run ${runId}`);
    return;
  }
  const lessonKey = typeof promoting.lesson === 'string' && promoting.lesson !== '' ? promoting.lesson : null;
  if (!lessonKey) add('runs/PROMOTING.json names no lesson');
  // promote.mjs may record the sha of the plan it wrote; when it does, the plan on disk has to be that file
  if (typeof promoting.plan_sha === 'string' && promoting.plan_sha !== plan?.sha) add('the plan was changed after runs/PROMOTING.json recorded it (plan_sha differs)');

  // 2. the card: a gate card, PASS, not smoke, for that lesson
  const cardLabel = `runs/${runId}/card.json`;
  const card = readFileJson(join(runDir, 'card.json'), `${cardLabel} (the gate card)`, add);
  if (card !== null) {
    let schema = null;
    try {
      schema = readCardSchema(root);
    } catch (e) {
      add(`the card schema cannot be read (${e.message}), so the card is not accepted`);
    }
    if (schema) {
      const result = validate(schema, card);
      if (!result.ok) add(`${cardLabel} does not match card.schema.json: ${result.errors.slice(0, 3).join('; ')}`);
    }
    if (isObject(card)) {
      if (card.verdict !== 'PASS') add(`the card's verdict is ${show(card.verdict)}, not PASS`);
      if (card.smoke === true) add('the card is a smoke card (a rehearsal), never a gate verdict');
      if (card.kind !== 'gate') add(`the card's kind is ${show(card.kind)}, not "gate"`);
      if (lessonKey && card.lesson !== lessonKey) add(`the card is for lesson ${show(card.lesson)}, runs/PROMOTING.json names ${show(lessonKey)}`);
    }
  }
  const cardConfigs = isObject(card) && isObject(card.configs) ? card.configs : {};

  // 3. the candidate rubric: intact, the card's candidate, the version PROMOTING.json names
  const candidateLabel = `runs/${runId}/candidate/rubric.json`;
  let candidate = readFileJson(join(runDir, 'candidate', 'rubric.json'), `${candidateLabel} (the candidate rubric)`, add);
  if (candidate !== null && (!isObject(candidate) || !Array.isArray(candidate.tags))) {
    add(`${candidateLabel} is not a rubric`);
    candidate = null;
  }
  if (candidate) {
    const hashes = checkHashes(candidate);
    if (!hashes.ok) add(`the candidate rubric does not match its own hashes (${hashes.mismatches.length}, first: ${hashes.mismatches[0].kind} ${hashes.mismatches[0].where})`);
    if (cardConfigs.candidate?.rubric_hash !== candidate.rubric_hash) add(`the candidate rubric is ${show(candidate.rubric_hash)}, the card gated ${show(cardConfigs.candidate?.rubric_hash)}`);
    if (candidate.rubric_version !== promoting.version) add(`the candidate rubric is version ${show(candidate.rubric_version)}, runs/PROMOTING.json says ${show(promoting.version)}`);
  }

  // 4. the live rubric is what the card gated against
  const live = loadLive(root, add);
  if (live && cardConfigs.baseline?.rubric_hash !== live.rubric_hash) add(`the card gated against ${show(cardConfigs.baseline?.rubric_hash)}, the live rubric is ${show(live.rubric_hash)}: the live rubric is not the baseline of this gate`);

  // 5. the lesson in the pull: its status (norm/lessons.jsonl) and its page id (the id map; Changed by is a list of page ids)
  const mapped = lessonKey ? (pull?.idMap?.rule_changes?.[lessonKey] ?? null) : null;
  const rows = lessonKey ? lessonRows(pull) : null;
  const lessonRow = rows ? (rows.find((r) => r.lesson_key === lessonKey && (!mapped || normId(r.page_id) === normId(mapped))) ?? null) : null;
  const lessonPage = mapped || lessonRow?.page_id || null;

  // 6. the ops
  const tags = [];
  for (const op of claims.rulebook) {
    const label = `rulebook "${op.key}"`;
    const props = op.properties;
    tags.push(op.key);
    if (typeof promoting.tag === 'string' && promoting.tag !== '' && op.key !== promoting.tag) add(`${label}: runs/PROMOTING.json promotes the tag ${show(promoting.tag)}`);
    const liveTag = live ? tagNamed(live, op.key) : null;
    const candTag = candidate ? tagNamed(candidate, op.key) : null;
    if (live && candidate) {
      if (!liveTag || !candTag) add(`${label}: not a tag of both the live rubric and the candidate`);
      else if (liveTag.tag_hash === candTag.tag_hash) add(`${label}: the candidate does not change this tag (its tag hash is the live rubric's)`);
    }
    if (candTag) {
      const wanted = { 'When to use': composeWhenToUse(candTag.when_to_use), 'Tag hash': candTag.tag_hash, 'Rule version': candidate.rubric_version };
      for (const [name, value] of Object.entries(wanted)) {
        if (!hasProp(props, name)) add(`${label}: ${name} is missing (a promote writes the candidate's)`);
        else if (props[name] !== value) add(name === 'When to use' ? `${label}: When to use is not the candidate's text for this tag` : `${label}: ${name} is ${show(props[name])}, the candidate's is ${show(value)}`);
      }
    }
    const changedBy = props['Changed by'];
    if (!hasProp(props, 'Changed by')) add(`${label}: Changed by is missing (a promote names the lesson)`);
    else if (!lessonPage) add(`${label}: Changed by cannot be checked, the pull has no page for lesson ${show(lessonKey)}`);
    else if (!Array.isArray(changedBy) || changedBy.length === 0 || !changedBy.every((id) => typeof id === 'string' && normId(id) === normId(lessonPage))) add(`${label}: Changed by does not reference the promoted lesson ${show(lessonKey)}`);
  }
  for (const op of claims.live) {
    if (op.key !== lessonKey) add(`rule_changes "${op.key}": sets Status Live, but the lesson being promoted is ${show(lessonKey)}`);
  }
  // The promoted lesson is Approved in the pull whenever the plan rewrites a rule or sets a lesson Live. On a resumed apply it is Live already
  // because this very plan set it (the ledger of the run says the op landed): that counts as the Approved the plan started from.
  if (lessonKey && (claims.rulebook.length > 0 || claims.live.length > 0)) {
    const label = `rule_changes "${lessonKey}"`;
    const liveOp = claims.live.find((o) => o.key === lessonKey);
    if (!lessonRow) add(`${label}: the pull ${pull?.id ?? '(none)'} has no such lesson (it must cover Rule changes), so its status cannot be checked`);
    else if (lessonRow.status !== 'Approved' && !(lessonRow.status === 'Live' && liveOp && ledgerSaysOk(runDir, liveOp.seq))) add(`${label}: the lesson is ${show(lessonRow.status)} in pull ${pull.id}, not Approved`);
  }
  for (const op of claims.ops) {
    if (op.database !== 'agent_settings' || !hasProp(op.properties, 'Rubric in force') || !candidate) continue;
    if (op.properties['Rubric in force'] !== candidate.rubric_version) add(`agent_settings "${op.key}": Rubric in force is ${show(op.properties['Rubric in force'])}, the candidate's version is ${show(candidate.rubric_version)}`);
  }

  Object.assign(evidence, {
    run_id: runId, lesson: lessonKey, card_id: isObject(card) ? card.card_id : null, candidate_version: candidate?.rubric_version ?? null, candidate_hash: candidate?.rubric_hash ?? null, baseline_hash: live?.rubric_hash ?? null, tags,
  });
}

// ---- restore -------------------------------------------------------------------------------------------------------------------------

function restoreEvidence({ root, claims, add, evidence }) {
  if (claims.ctx.confirm !== true) add('the header says restore without confirm: a restore is the engineer-only path and needs --confirm');
  if (claims.rulebook.length === 0) return; // a restore plan that writes no rule text (the lesson and Agent settings of an abort) has no text to prove
  const live = loadLive(root, add, { locked: true }); // the text is only "locked" while rubric.lock agrees with rubric.json
  if (!live) return;
  const tags = [];
  for (const op of claims.rulebook) {
    const label = `rulebook "${op.key}"`;
    const props = op.properties;
    tags.push(op.key);
    const liveTag = tagNamed(live, op.key);
    if (!liveTag) {
      add(`${label}: not a tag of the live rubric, so there is no locked text to restore`);
      continue;
    }
    if (hasProp(props, 'When to use') && props['When to use'] !== composeWhenToUse(liveTag.when_to_use)) add(`${label}: When to use is not the live rubric's text (rubric ${live.rubric_version}); a restore writes only the locked text`);
    if (hasProp(props, 'Tag hash') && props['Tag hash'] !== liveTag.tag_hash) add(`${label}: Tag hash is ${show(props['Tag hash'])}, the live rubric's is ${show(liveTag.tag_hash)}`);
    if (hasProp(props, 'Rule version') && ![ruleVersionOf(live, op.key), live.rubric_version].includes(props['Rule version'])) add(`${label}: Rule version is ${show(props['Rule version'])}, the live rubric's is ${show(ruleVersionOf(live, op.key))}`);
    if (hasProp(props, 'Changed by') && !(Array.isArray(props['Changed by']) && props['Changed by'].length === 0)) add(`${label}: a restore clears Changed by, it does not set it`);
  }
  Object.assign(evidence, { rubric_version: live.rubric_version, rubric_hash: live.rubric_hash, tags });
}

// ---- the check -----------------------------------------------------------------------------------------------------------------------

/** See the header. Never throws: a plan that cannot be examined is a plan that is not proven. */
export function checkGateEvidence({ root = agentRoot(), plan, pull = null } = {}) {
  const problems = [];
  const add = (text) => problems.push(text);
  const evidence = { modes: [] };
  try {
    const claims = gateClaims(plan);
    if (!claims.needed) return { ok: true, problems, evidence };
    const runId = plan?.header?.run_id;
    if (typeof runId !== 'string' || !RUN_ID.test(runId)) {
      add(`the plan header has no usable run id (${show(runId)})`);
      return { ok: false, problems, evidence };
    }
    if (claims.needPromote) {
      evidence.modes.push('promote');
      promoteEvidence({ root, runId, claims, pull, plan, add, evidence });
    }
    if (claims.restore) {
      evidence.modes.push('restore');
      restoreEvidence({ root, claims, add, evidence });
    }
    if (claims.seed) {
      evidence.modes.push('seed');
      const marker = controlPaths(root).setup;
      if (existsSync(marker)) evidence.setup_marker = 'runs/SETUP';
      else add('runs/SETUP does not exist: a seed plan needs the setup marker, which an engineer creates by hand before the seed and deletes afterwards');
    }
    if (!claims.promote && !claims.restore && !claims.seed) {
      for (const op of claims.rulebook) {
        if (hasProp(op.properties, 'When to use')) add(`rulebook "${op.key}": writes When to use, but the plan header claims no gate PASS, no restore and no seed`);
      }
    }
  } catch (e) {
    add(`the evidence could not be examined (${e.message}), so the plan is not accepted`);
  }
  return { ok: problems.length === 0, problems, evidence };
}
