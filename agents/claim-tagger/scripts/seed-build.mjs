#!/usr/bin/env node
/**
 * seed-build.mjs — builds the MVP seed files from the research exports, deterministically.
 * No network, no Notion, no clock, no dependencies; the only randomness is a seeded PRNG (mulberry32).
 *
 * Usage:
 *   node agents/claim-tagger/scripts/seed-build.mjs [--research <path>] [--out <dir>]
 *     --research  the research folder (default X:\work\research\overnight-feedback-loop-research)
 *     --out       where to write (default agents/claim-tagger/evals/seed; the tests use a temp folder)
 *
 * Reads, never writes:
 *   <research>/sources/claims-to-review.13oct.jsonl     260 audit rows (57 decided)
 *   <research>/sources/us-politics-sample.13oct.jsonl   313 claims: old tagger's tags, Sources count
 *   <research>/sources/raw/*.json                       U.S. Politics exports: Geo Sources (URLs) and Geo URL
 *   <research>/skeletons/cases.example.jsonl            optional; only used to cross-check the outcome mapping
 *   agents/claim-tagger/config.json                     anonymise.replacements (read only)
 *
 * Writes (agents/claim-tagger/evals/seed/):
 *   claims.seed.jsonl         about 60 claims in three strata: Decided, Forecast, Random
 *   decisions.seed.jsonl      one row per claim x Rulebook tag: 33 decided audit rows + 17 Auditor-flag rows
 *   excluded-decisions.jsonl  the decided audit rows on tags outside the Rulebook
 *   seed-report.json          counts, prefixes not found, claims whose Sources count is unknown, scrub count, random draw
 *   check-by-hand.md          the special rows and what was decided about each
 *
 * Rules (the plan's "Seeding" section is the source; the choices that needed a judgment are marked "choice"):
 *   Strata    Decided = every claim with at least one decided audit row (Agree or Disagree) on a Rulebook tag.
 *             Forecast = claims whose Geo ID starts with one of FORECAST_PREFIXES (sample or audit rows), then, only if the
 *             stratum is still below 17, sample claims whose text matches FORECAST_WORDS (choice: ascending Geo ID).
 *             Random = 10 of the remaining sample claims. Choice: the pool is sorted by Geo ID ascending, shuffled with a
 *             Fisher-Yates pass from the end (j = floor(rand() * (i + 1))) driven by mulberry32(20261013), first 10 taken.
 *             A claim sits in the first stratum that wants it (Decided, then Forecast, then Random).
 *   Outcome   Missing tag + Agree -> Applies; Wrong tag + Agree -> Does not apply; Disagree flips both. Calibration and
 *             Evidence needed rows stay open (null), except the two Calibration "will" rows whose notes say Add Predictive.
 *             The Ukraine and birthright citizenship rows stay open as check-by-hand rows.
 *   Proposal  The OLD tagger's position: Keep tag when its tags include the tag, else Do not add tag; Read source first on
 *             the source tags with Flag reason Evidence needed.
 *   Priority  Likely error -> High, Judgment call -> Medium, Not checkable -> Check source. Choice: where the plan's two
 *             sentences differ, the specific one wins (Ukraine High; birthright and the Evidence-needed rows Check source).
 *   Text      Every free-text field goes through flattenMentions (Notion mentions to their text, <br> to newlines) and the
 *             anonymise replacements (whole word, longest first, apostrophe-style tolerant). Notes lose the auditor's
 *             predictions ("Inferred from your reviews ..." and any "Do not add Predictive"). The Evidence and Why this
 *             prediction columns are never emitted. No emitted record has an editor field (no tag_outcome).
 *
 * Exit codes follow lib/exit-codes.mjs: 0 done, 1 unexpected error, 2 invalid or missing input.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.resolve(HERE, '..');
export const DEFAULT_OUT_DIR = path.join(AGENT_DIR, 'evals', 'seed');
export const DEFAULT_CONFIG = path.join(AGENT_DIR, 'config.json');
export const DEFAULT_RESEARCH_DIR = 'X:\\work\\research\\overnight-feedback-loop-research';

// ---------- 0. constants -----------------------------------------------------------------------------------------------

/** The 14 Verified tags of the Rulebook. Decisions are seeded only for these. */
export const RULEBOOK_TAGS = Object.freeze([
  'Debate', 'Factual', 'Context-dependent', 'Improperly sourced', 'Unsourced', 'Source inaccessible', 'Opinion',
  'Hypothetical', 'Multiple statements', 'Self-contained', 'Editor verified', 'Predictive', 'Simple', 'Single core statement',
]);
const RULEBOOK = new Set(RULEBOOK_TAGS);
/** The audit's one misspelled tag name, normalised in `tag` (the original stays in `audit_key`). */
const TAG_ALIASES = new Map([['Exact dublicate', 'Exact duplicate']]);

export const FORECAST_PREFIXES = Object.freeze([
  '867fd9bc', 'a744944a', '88b525b6', '8b17d6ea', 'fb71e3da', 'f06b756f', 'f4d50e38', '616e1ec1', '3764186f', '6e820a8a',
  '8172f325', 'dd526c57', 'e070ab9d', '01c0d1ae', '3908289a', 'e6195b10', 'cd8ae5d9',
]);
export const FORECAST_TARGET = 17;
export const FORECAST_WORDS = /\b(will|likely|on track to|expected to|set to|projected to|forecasted to|poised to|inevitable)\b/i;
export const RANDOM_COUNT = 10;
export const RANDOM_SEED = 20261013;

const TABLE = 'U.S. Politics';
const GEO_SPACE = '4582fbbee28a16589154f7e36f1ee3c5';
const SEEDED_AT = '2026-10-09';
const RUBRIC_VERSION = 'audit 2026-10-09 (before rubric)';
const EXCLUDED_REASON = 'tag outside the Rulebook';
const MAX_TEXT = 1900; // Notion rich text limit used by config.notion.max_text

const SOURCE_TAGS = new Set(['Improperly sourced', 'Source inaccessible', 'Unsourced']);
const PRIORITY_BY_ASSESSMENT = new Map([['Likely error', 'High'], ['Judgment call', 'Medium'], ['Not checkable', 'Check source']]);
const NEVER_EMITTED = [/Inferred from your reviews/i]; // checked on every emitted string, any field
const NEVER_IN_NOTES = [/\bDo not add Predictive\b/i];

const auditUrl = (id) => `https://app.notion.com/p/${id}`;
/** Audit rows named in the research schema file (section 7) and the plan; matched by page URL. */
const SPECIAL = Object.freeze({
  ukraine: auditUrl('3f4273e214eb81a1b02ce05138dd8e72'),
  birthright: auditUrl('3f4273e214eb813b9e06e8a662736d93'),
  wordy: auditUrl('3f4273e214eb811f9838e5e9dec1d7fe'),
  supremeCourt: auditUrl('3f4273e214eb813fbc32c968f9819580'),
  texas: auditUrl('3f4273e214eb813b909fc78bac8861c7'),
});
const HEDGED_ROWS = new Set([SPECIAL.supremeCourt, SPECIAL.texas]);
/** The Calibration rows whose notes say Add Predictive and that the plan seeds as Applies (Geo ID prefix -> label). */
const CALIBRATION_APPLIES = new Map([['807f9fa0', 'Proposition 40 "will"'], ['c7ff945e', 'Ending DEI programs "will"']]);
const OPEN_PRIORITY = new Map([[SPECIAL.ukraine, 'High'], [SPECIAL.birthright, 'Check source']]);

/** The "Why" column of check-by-hand.md, one entry per kind of special row. Plain words; no names. */
const CHECK_WHY = Object.freeze({
  ukraine: 'Missing tag + Agree would give Applies for Hypothetical, but the auditor\'s note says the claim was settled in chat as Predictive only and that Hypothetical is not to be added. The old Agree cannot be read as an outcome for this tag. Left open for a fresh call.',
  birthright: 'Mixed sources: one readable (it covers denaturalization and does not support presidential authority over birthright citizenship) and one that could not be read. The note says to record Source inaccessible and not to add Improperly sourced on the unread source alone, so the old Agree is ambiguous. Left open; a person reads the sources.',
  evidenceNeeded: 'Every attached source was blocked or inaccessible (Flag reason Evidence needed, Assessment Not checkable). The old Agree recorded the access failure, not a verdict on Improperly sourced. Left open; a person reads the sources.',
  wordy: 'The Agree was recorded although the note and the reasoning both say the tag does not apply, so the dropdown contradicts the text. Wordy is outside the Rulebook, so the row goes to excluded-decisions.jsonl and is not seeded.',
  hedged: (phrase) => `Hedged forecast ("${phrase}"): the editor disagreed with adding Predictive, so Missing tag + Disagree flips to Does not apply. The research marked it contested for lesson L-1. Seeded as decided; why_wrong_hint tells the orchestrator to mention the rule in the Seeded reasoning text (never in the editor's Why wrong field).`,
  calibration: (label) => `Calibration rows normally stay open, but the note for ${label} says Add Predictive and the editor agreed with a definite "will" forecast, so the plan seeds it as Applies.`,
});

export class InputError extends Error {}

// ---------- 1. small helpers -------------------------------------------------------------------------------------------

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha16 = (bytes) => 'sha256:' + createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function tally(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const k = keyFn(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort((a, b) => cmp(a[0], b[0])));
}

/** Value of `name` in a row; tolerates a key whose punctuation was altered by an export (dash, spacing, case). */
function field(row, name) {
  if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  const want = normKey(name);
  for (const k of Object.keys(row)) if (normKey(k) === want) return row[k];
  return undefined;
}

/** The actual key of a row that matches a pattern (for keys that may be corrupted), or null. */
function findKey(row, pattern) {
  return Object.keys(row).find((k) => pattern.test(k)) ?? null;
}

/** A list from an array, a JSON-encoded array string, or a comma-separated string. */
function asList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  const s = String(value).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
    } catch { /* not JSON: fall through to the comma split */ }
  }
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

function toCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function readJsonl(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new InputError(`cannot read ${file}: ${err.message}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (err) {
      throw new InputError(`${file} line ${i + 1} is not valid JSON: ${err.message}`);
    }
  });
  return rows;
}

// ---------- 2. text cleaning: mentions, predictions, names ---------------------------------------------------------------

/** Notion mentions become their visible text, <br> becomes a newline, line endings become \n. */
export function flattenMentions(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/<mention-[a-z-]+\b[^>]*?>([\s\S]*?)<\/mention-[a-z-]+>/gi, '$1')
    .replace(/<mention-[a-z-]+\b[^>]*?\/>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Removes the auditor's predictions from a Review note. A note that opens with "Inferred from your reviews" is entirely an
 * inference of what the editor would answer, so it is dropped whole. Elsewhere only the clause "Do not add Predictive" goes
 * (the old answer is already in the history line and the seeded outcome); the next word is re-capitalised.
 */
export function stripPredictionText(note) {
  const text = String(note ?? '');
  if (/Inferred from your reviews/i.test(text)) return '';
  return text
    .replace(/\bDo not add Predictive\b\s*[;:,.\u2014\u2013-]*\s*/gi, '\u0000')
    .replace(/\u0000([a-z])/g, (_m, ch) => ch.toUpperCase())
    .replace(/\u0000/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

const atSentenceStart = (whole, offset) => offset === 0 || /(?:^|[.!?:]\s+|\n\s*)$/.test(whole.slice(0, offset));
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Applies the anonymise replacements to a string: whole word only, longest first (so "Yaniv's rule" wins over "Yaniv"),
 * the apostrophe in a pattern matches both ' and the typographic apostrophe. A replacement at the start of a sentence is
 * capitalised ("the auditor" -> "The auditor"). Returns { scrub, counts, total }; counts are keyed by the replacement
 * text (the role), never by the original name, so the report cannot carry a name.
 */
export function makeScrubber(replacements) {
  const rules = replacements
    .map(([from, to], index) => ({ from, to, index }))
    .sort((a, b) => b.from.length - a.from.length || a.index - b.index)
    .map(({ from, to }) => ({
      from,
      to,
      count: 0,
      re: new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(from).replace(/['\u2019]/g, '[\'\u2019]')}(?![\\p{L}\\p{N}_])`, 'gu'),
    }));
  const scrubber = {
    scrub(text) {
      if (typeof text !== 'string' || !text) return text;
      let out = text;
      for (const rule of rules) {
        out = out.replace(rule.re, (match, offset, whole) => {
          rule.count += 1;
          return atSentenceStart(whole, offset) ? capitalise(rule.to) : rule.to;
        });
      }
      return out;
    },
    /** Counts by replacement text, sorted; zero counts are kept so the report shows every role. */
    get counts() {
      const byRole = new Map();
      for (const r of rules) byRole.set(r.to, (byRole.get(r.to) ?? 0) + r.count);
      return Object.fromEntries([...byRole].sort((a, b) => cmp(a[0], b[0])));
    },
    get total() {
      return rules.reduce((n, r) => n + r.count, 0);
    },
    /** The original names, for the final "nothing left" scan. */
    names: rules.map((r) => r.from),
    leftover(text) {
      return rules.some((rule) => { rule.re.lastIndex = 0; return rule.re.test(text); });
    },
  };
  return scrubber;
}

/** A source export cell "[title](url)<br>[title](url)" to the URLs, in order, without duplicates. */
export function parseGeoSources(value) {
  if (value == null) return [];
  const cell = Array.isArray(value) ? value.join('<br>') : String(value);
  const urls = [];
  for (const chunk of cell.split(/<br\s*\/?>/i)) {
    const c = chunk.trim();
    if (!c) continue;
    const link = c.match(/\]\((https?:\/\/[^)\s]+)\)\s*$/);
    const bare = c.match(/^(https?:\/\/\S+)$/);
    const url = link ? link[1] : bare ? bare[1] : null;
    if (!url) throw new InputError(`cannot read a source URL from "${c.slice(0, 80)}"`);
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

// ---------- 3. seeded PRNG ---------------------------------------------------------------------------------------------

/** mulberry32: a small 32-bit PRNG; returns a function giving floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed | 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates from the end with mulberry32(seed); returns a new array. */
export function seededShuffle(items, seed) {
  const a = items.slice();
  const rand = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 4. loading -------------------------------------------------------------------------------------------------

/** Reads the research folder. Returns the raw rows plus a fingerprint of every input file for the report. */
export function loadInputs(researchDir) {
  const src = path.join(researchDir, 'sources');
  const files = {};
  const fingerprint = (rel, rows) => {
    const bytes = fs.readFileSync(path.join(researchDir, rel));
    files[rel.split(path.sep).join('/')] = { rows, sha256: sha16(bytes) };
  };

  const auditRel = path.join('sources', 'claims-to-review.13oct.jsonl');
  const sampleRel = path.join('sources', 'us-politics-sample.13oct.jsonl');
  const audit = readJsonl(path.join(researchDir, auditRel));
  const sample = readJsonl(path.join(researchDir, sampleRel));
  fingerprint(auditRel, audit.length);
  fingerprint(sampleRel, sample.length);

  const rawDir = path.join(src, 'raw');
  const rawRows = [];
  if (fs.existsSync(rawDir)) {
    for (const name of fs.readdirSync(rawDir).filter((n) => n.endsWith('.json')).sort(cmp)) {
      let json;
      try {
        json = JSON.parse(fs.readFileSync(path.join(rawDir, name), 'utf8').replace(/^\uFEFF/, ''));
      } catch (err) {
        throw new InputError(`cannot parse sources/raw/${name}: ${err.message}`);
      }
      const rows = Array.isArray(json) ? json : Array.isArray(json?.results) ? json.results : [];
      // only the U.S. Politics exports carry a Geo ID; the audit exports in this folder do not
      const geoRows = rows.filter((r) => r && field(r, 'Geo ID'));
      if (geoRows.length) {
        rawRows.push(...geoRows);
        fingerprint(path.join('sources', 'raw', name), geoRows.length);
      }
    }
  }

  const casesFile = path.join(researchDir, 'skeletons', 'cases.example.jsonl');
  const cases = fs.existsSync(casesFile) ? readJsonl(casesFile) : null;
  if (cases) fingerprint(path.join('skeletons', 'cases.example.jsonl'), cases.length);

  return { audit, sample, rawRows, cases, files };
}

export function loadConfig(configPath = DEFAULT_CONFIG) {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new InputError(`cannot read the agent config ${configPath}: ${err.message}`);
  }
}

// ---------- 5. normalising rows ----------------------------------------------------------------------------------------

function normaliseAudit(row) {
  const auditKey = String(field(row, 'Audit key') ?? '').trim();
  const i = auditKey.indexOf('::');
  if (i <= 0) throw new InputError(`audit row without "<geoId>::<tag>" in its Audit key: ${JSON.stringify(auditKey)}`);
  const rawTag = auditKey.slice(i + 2).trim();
  const tag = TAG_ALIASES.get(rawTag) ?? rawTag;
  const flags = asList(field(row, 'Flag reason'));
  const assessment = String(field(row, 'Assessment') ?? '').trim();
  const url = String(field(row, 'url') ?? '').trim();
  if (!url) throw new InputError(`audit row ${auditKey} has no url`);
  return {
    url,
    auditKey,
    geoId: auditKey.slice(0, i),
    tag,
    claim: String(field(row, 'Claim') ?? '').trim(),
    oldTags: asList(field(row, 'Tags assigned by agent')),
    assessment,
    flags,
    why: String(field(row, 'Why I recommend this') ?? ''),
    notes: String(field(row, 'Review notes') ?? ''),
    reasoning: String(field(row, 'Your reasoning') ?? ''),
    decision: String(field(row, 'Your decision') ?? '').trim(),
    reviewedAt: String(field(row, 'Reviewed at') ?? '').trim(),
    geoLink: String(field(row, 'Geo link') ?? '').trim(),
    claimPageUrl: asList(field(row, 'Original claim link'))[0] ?? '',
  };
}

function normaliseSample(row) {
  const qualityKey = findKey(row, /^claim quality tags.{0,6}verified$/i);
  return {
    geoId: String(field(row, 'Geo ID') ?? '').trim(),
    claim: String(field(row, 'Geo Name') ?? '').trim(),
    sourcesCount: toCount(field(row, 'Geo Sources (count)')),
    oldTags: qualityKey ? asList(row[qualityKey]) : null,
    qualityKey,
  };
}

function indexRaw(rawRows) {
  const byGeo = new Map();
  for (const row of rawRows) {
    const geoId = String(field(row, 'Geo ID') ?? '').trim();
    if (!geoId) continue;
    const entry = byGeo.get(geoId) ?? { geoUrl: null, sourceUrls: [] };
    const geoUrl = String(field(row, 'Geo URL') ?? '').trim();
    if (geoUrl && !entry.geoUrl) entry.geoUrl = geoUrl;
    for (const u of parseGeoSources(field(row, 'Geo Sources'))) if (!entry.sourceUrls.includes(u)) entry.sourceUrls.push(u);
    byGeo.set(geoId, entry);
  }
  return byGeo;
}

// ---------- 6. the build -----------------------------------------------------------------------------------------------

/**
 * Builds every seed record in memory. `inputs` is what loadInputs returns, `config` the agent config.
 * `options.requireSpecialRows` (default true) makes the build fail if one of the named check-by-hand audit rows is missing;
 * the unit tests turn it off for small synthetic inputs. Returns { claims, decisions, excluded, checkRows, report }; nothing
 * is written here.
 */
export function buildSeed(inputs, config, options = {}) {
  const replacements = config?.anonymise?.replacements;
  if (!Array.isArray(replacements) || !replacements.length) throw new InputError('config.anonymise.replacements is missing');
  const scrubber = makeScrubber(replacements);
  const scrub = (text) => scrubber.scrub(text);
  const clean = (text) => scrub(flattenMentions(String(text ?? ''))).trim();
  const warnings = [];

  const audit = inputs.audit.map(normaliseAudit);
  const sample = inputs.sample.map(normaliseSample).filter((s) => s.geoId);
  const raw = indexRaw(inputs.rawRows ?? []);

  const auditByGeo = new Map();
  for (const row of audit) {
    if (!auditByGeo.has(row.geoId)) auditByGeo.set(row.geoId, []);
    auditByGeo.get(row.geoId).push(row);
  }
  for (const rows of auditByGeo.values()) rows.sort((a, b) => cmp(a.auditKey, b.auditKey));
  const sampleByGeo = new Map(sample.map((s) => [s.geoId, s]));
  if (sampleByGeo.size !== sample.length) warnings.push('the sample has repeated Geo IDs; the first row of each was used');
  if (sample.length && !sample.some((s) => s.qualityKey)) {
    throw new InputError('no sample row has a "Claim quality tags - verified" field (checked with a punctuation-tolerant pattern)');
  }
  const qualityKeys = [...new Set(sample.map((s) => s.qualityKey).filter(Boolean))];

  const isDecided = (r) => r.decision === 'Agree' || r.decision === 'Disagree';
  const decidedRulebook = audit.filter((r) => isDecided(r) && RULEBOOK.has(r.tag)).sort((a, b) => cmp(a.auditKey, b.auditKey));
  const decidedOther = audit.filter((r) => isDecided(r) && !RULEBOOK.has(r.tag)).sort((a, b) => cmp(a.auditKey, b.auditKey));

  // ----- strata
  const included = new Map(); // geoId -> 'Decided' | 'Forecast' | 'Random'
  for (const r of decidedRulebook) included.set(r.geoId, 'Decided');

  const universe = [...new Set([...sampleByGeo.keys(), ...auditByGeo.keys()])].sort(cmp);
  const prefixesNotFound = [];
  const prefixClaimsAlreadyDecided = [];
  const foundByPrefix = {};
  for (const prefix of FORECAST_PREFIXES) {
    const hits = universe.filter((g) => g.startsWith(prefix));
    foundByPrefix[prefix] = hits;
    if (!hits.length) prefixesNotFound.push(prefix);
    for (const g of hits) {
      if (included.has(g)) {
        prefixClaimsAlreadyDecided.push({ prefix, geo_id: g, stratum: included.get(g) });
      } else {
        included.set(g, 'Forecast');
      }
    }
  }
  const forecastCount = () => [...included.values()].filter((v) => v === 'Forecast').length;
  const toppedUp = [];
  if (forecastCount() < FORECAST_TARGET) {
    for (const s of [...sample].sort((a, b) => cmp(a.geoId, b.geoId))) {
      if (forecastCount() >= FORECAST_TARGET) break;
      if (included.has(s.geoId) || !FORECAST_WORDS.test(s.claim)) continue;
      included.set(s.geoId, 'Forecast');
      toppedUp.push(s.geoId);
    }
  }

  const randomPool = sample.map((s) => s.geoId).filter((g) => !included.has(g)).sort(cmp);
  const randomChosen = seededShuffle(randomPool, RANDOM_SEED).slice(0, RANDOM_COUNT);
  for (const g of randomChosen) included.set(g, 'Random');

  // ----- claims
  const stratumOrder = { Decided: 0, Forecast: 1, Random: 2 };
  const claimInfo = new Map(); // geoId -> { text, oldTagsAll } used by the decision rows too
  const claims = [];
  const unknownSources = [];
  const unknownSourcesPages = new Map(); // geoId -> the claim's Notion page, for the read-only fetch of its Sources count
  const entries = [...included].sort((a, b) => stratumOrder[a[1]] - stratumOrder[b[1]] || cmp(a[0], b[0]));
  for (const [geoId, label] of entries) {
    const s = sampleByGeo.get(geoId) ?? null;
    const rows = auditByGeo.get(geoId) ?? [];
    const rawEntry = raw.get(geoId) ?? null;
    const text = clean(s?.claim || rows[0]?.claim);
    if (!text) throw new InputError(`claim ${geoId} has no text in the sample or the audit rows`);

    const oldAll = s?.oldTags ? s.oldTags : [...new Set(rows.flatMap((r) => r.oldTags))];
    const agentTags = [...new Set(oldAll.filter((t) => RULEBOOK.has(t)))].sort(cmp);
    const dropped = [...new Set(oldAll.filter((t) => !RULEBOOK.has(t)))].sort(cmp);
    const geoLink = rawEntry?.geoUrl || rows.find((r) => r.geoLink)?.geoLink || `https://www.geobrowser.io/space/${GEO_SPACE}/${geoId}`;
    const sourcesCount = s ? s.sourcesCount : null;
    const sourceUrls = rawEntry ? rawEntry.sourceUrls.slice() : [];

    const notes = [];
    if (sourcesCount === null) {
      notes.push('sources_count unknown locally');
      unknownSources.push(geoId);
      const pageUrl = rows.map((r) => r.claimPageUrl).find(Boolean);
      if (pageUrl) unknownSourcesPages.set(geoId, pageUrl);
    }
    if (!s) notes.push('not in the 13 Oct sample (text, agent tags and Geo link from the audit row)');
    if (s && sourcesCount !== null && rawEntry && rawEntry.sourceUrls.length !== sourcesCount) {
      notes.push(`sources_count ${sourcesCount} differs from ${rawEntry.sourceUrls.length} source URLs in the raw export`);
      warnings.push(`${geoId}: sources_count ${sourcesCount} vs ${rawEntry.sourceUrls.length} raw source URLs`);
    }
    if (dropped.length) notes.push(`old tags outside the Rulebook dropped: ${dropped.join(', ')}`);

    claimInfo.set(geoId, { text, oldAll });
    claims.push({
      geo_id: geoId,
      claim: text,
      geo_link: geoLink,
      sources_count: sourcesCount,
      source_urls: sourceUrls,
      table: TABLE,
      sample: label,
      agent_tags: agentTags,
      audit_row_urls: rows.map((r) => r.url),
      seed_notes: notes.join('; '),
    });
  }

  // ----- decisions
  const checkRows = [];
  const textOf = (geoId, row) => claimInfo.get(geoId)?.text ?? clean(row.claim);
  const oldTagsOf = (row) => claimInfo.get(row.geoId)?.oldAll ?? row.oldTags;

  const history = (row) => `Old answer: ${row.decision} \u00b7 Flag reason: ${row.flags.join(', ') || 'none'} \u00b7 Assessment: ${row.assessment}`;
  const fullNote = (row) => {
    const body = scrub(stripPredictionText(flattenMentions(row.notes))).trim();
    const text = body ? `${history(row)}\n${body}` : history(row);
    if (text.length > MAX_TEXT) {
      warnings.push(`${row.auditKey}: agent_full_note cut from ${text.length} to ${MAX_TEXT} characters`);
      return `${text.slice(0, MAX_TEXT - 1)}\u2026`;
    }
    return text;
  };
  const proposalOf = (row) => {
    if (SOURCE_TAGS.has(row.tag) && row.flags.includes('Evidence needed')) return 'Read source first';
    return oldTagsOf(row).includes(row.tag) ? 'Keep tag' : 'Do not add tag';
  };
  const priorityOf = (row) => {
    const override = OPEN_PRIORITY.get(row.url);
    if (override) return override;
    if (row.flags.includes('Evidence needed') && SOURCE_TAGS.has(row.tag)) return 'Check source';
    const p = PRIORITY_BY_ASSESSMENT.get(row.assessment);
    if (!p) throw new InputError(`audit row ${row.auditKey} has an Assessment (${JSON.stringify(row.assessment)}) with no Priority mapping`);
    return p;
  };

  /** The seeded outcome of a decided Rulebook row, with the reason for a null. */
  const outcomeOf = (row) => {
    if (row.url === SPECIAL.ukraine || row.url === SPECIAL.birthright) return { outcome: null, kind: 'open' };
    if (row.flags.includes('Evidence needed')) return { outcome: null, kind: 'open' };
    if (row.flags.includes('Calibration')) {
      const label = CALIBRATION_APPLIES.get(row.geoId.slice(0, 8));
      if (label && row.tag === 'Predictive' && row.decision === 'Agree') {
        if (!/^Add Predictive\b/.test(row.notes)) throw new InputError(`${row.auditKey}: expected the note to say Add Predictive`);
        return { outcome: 'Applies', kind: 'calibration', label };
      }
      return { outcome: null, kind: 'open' };
    }
    const missing = row.flags.includes('Missing tag');
    const wrong = row.flags.includes('Wrong tag');
    if (missing === wrong) {
      warnings.push(`${row.auditKey}: Flag reason ${JSON.stringify(row.flags)} cannot be mapped; left open`);
      return { outcome: null, kind: 'open' };
    }
    const agree = row.decision === 'Agree';
    if (missing) return { outcome: agree ? 'Applies' : 'Does not apply', kind: 'mapped' };
    return { outcome: agree ? 'Does not apply' : 'Applies', kind: 'mapped' };
  };

  const decisions = [];
  const seenKeys = new Set();
  const pushDecision = (record) => {
    if (seenKeys.has(record.key)) throw new InputError(`duplicate decision key ${record.key}`);
    seenKeys.add(record.key);
    decisions.push(record);
  };
  const common = (row, whyInQueue) => ({
    key: `${row.geoId}::${row.tag}`,
    geo_id: row.geoId,
    tag: row.tag,
    claim: textOf(row.geoId, row),
    audit_row_url: row.url,
    agent_proposal: proposalOf(row),
    why_i_recommend_this: `Audit (9 Oct): ${clean(row.why)}`,
    agent_full_note: fullNote(row),
    why_in_queue: whyInQueue,
    priority: priorityOf(row),
    rubric_version: RUBRIC_VERSION,
  });
  const oldAnswer = (row) => `${row.decision} \u00b7 ${row.flags.join(', ') || 'none'} \u00b7 ${row.assessment}`;

  for (const row of decidedRulebook) {
    const { outcome, kind, label } = outcomeOf(row);
    const reasoning = clean(row.reasoning);
    const base = common(row, 'Seeded decision');
    const record = {
      ...base,
      seeded_outcome: outcome,
      seeded_reasoning: outcome && reasoning ? reasoning : null,
      seeded_at: outcome ? SEEDED_AT : null,
      why_wrong_hint: outcome === 'Does not apply' && row.tag === 'Predictive' && HEDGED_ROWS.has(row.url) ? 'Rule should change' : null,
    };
    pushDecision(record);

    const special = { key: record.key, claim: record.claim, tag: row.tag, old: oldAnswer(row), url: row.url };
    const openAs = `Open (no seeded outcome); priority ${record.priority}; proposal ${record.agent_proposal}`;
    if (row.url === SPECIAL.ukraine) {
      checkRows.push({ ...special, order: 1, seeded: openAs, why: CHECK_WHY.ukraine });
    } else if (row.url === SPECIAL.birthright) {
      checkRows.push({ ...special, order: 2, seeded: openAs, why: CHECK_WHY.birthright });
    } else if (kind === 'open' && row.flags.includes('Evidence needed')) {
      checkRows.push({ ...special, order: 3, seeded: openAs, why: CHECK_WHY.evidenceNeeded });
    } else if (HEDGED_ROWS.has(row.url)) {
      const phrase = row.url === SPECIAL.supremeCourt ? 'likely to expand' : 'on track to';
      checkRows.push({ ...special, order: 5, seeded: `Seeded outcome ${outcome}; why_wrong_hint ${record.why_wrong_hint}; priority ${record.priority}`,
        why: CHECK_WHY.hedged(phrase) });
    } else if (kind === 'calibration') {
      checkRows.push({ ...special, order: 6, seeded: `Seeded outcome ${outcome}; priority ${record.priority}`, why: CHECK_WHY.calibration(label) });
    }
  }

  // Auditor-flag rows: one per Forecast claim x open audit row on Predictive or Hypothetical
  const forecastGeoIds = [...included].filter(([, label]) => label === 'Forecast').map(([g]) => g).sort(cmp);
  const forecastWithoutOpenRow = [];
  for (const geoId of forecastGeoIds) {
    const open = (auditByGeo.get(geoId) ?? []).filter((r) => r.decision === 'To review' && (r.tag === 'Predictive' || r.tag === 'Hypothetical'));
    if (!open.length) forecastWithoutOpenRow.push(geoId);
    for (const row of open) {
      pushDecision({
        ...common(row, 'Auditor flag'),
        seeded_outcome: null,
        seeded_reasoning: null,
        seeded_at: null,
        why_wrong_hint: null,
      });
    }
  }
  decisions.sort((a, b) => cmp(a.key, b.key));

  // ----- excluded decisions (tags outside the Rulebook)
  const excluded = decidedOther.map((row) => {
    const record = {
      key: `${row.geoId}::${row.tag}`,
      geo_id: row.geoId,
      tag: row.tag,
      audit_key: row.auditKey,
      claim: clean(row.claim),
      audit_row_url: row.url,
      decision: row.decision,
      flag_reason: row.flags,
      assessment: row.assessment,
      why_i_recommend_this: clean(row.why),
      review_notes: clean(row.notes),
      your_reasoning: clean(row.reasoning) || null,
      old_tagger_tags: row.oldTags,
      reviewed_at: row.reviewedAt,
      reason: EXCLUDED_REASON,
    };
    if (row.url === SPECIAL.wordy) {
      checkRows.push({
        key: record.key, claim: record.claim, tag: row.tag, old: oldAnswer(row), url: row.url, order: 4,
        seeded: 'Excluded (excluded-decisions.jsonl)',
        why: CHECK_WHY.wordy,
      });
    }
    return record;
  }).sort((a, b) => cmp(a.key, b.key));

  // ----- integrity: every special row was found, no leftover names or predictions, no editor field
  if (options.requireSpecialRows !== false) {
    const expectedSpecial = [SPECIAL.ukraine, SPECIAL.birthright, SPECIAL.wordy, SPECIAL.supremeCourt, SPECIAL.texas];
    const foundSpecial = new Set(checkRows.map((c) => c.url));
    for (const url of expectedSpecial) if (!foundSpecial.has(url)) throw new InputError(`the check-by-hand audit row ${url} was not found among the decided rows`);
  }
  const everyString = [];
  const visit = (value, where) => {
    if (typeof value === 'string') everyString.push([where, value]);
    else if (Array.isArray(value)) value.forEach((v) => visit(v, where));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) visit(v, k);
  };
  [...claims, ...decisions, ...excluded].forEach((r) => visit(r, 'row'));
  for (const [where, text] of everyString) {
    if (scrubber.leftover(text)) throw new InputError(`a name from the anonymise list is left in ${where}: ${text.slice(0, 60)}`);
    for (const re of NEVER_EMITTED) if (re.test(text)) throw new InputError(`forbidden text ${re} left in ${where}`);
    if (where === 'agent_full_note') for (const re of NEVER_IN_NOTES) if (re.test(text)) throw new InputError(`forbidden text ${re} left in agent_full_note`);
  }
  for (const record of [...claims, ...decisions, ...excluded]) {
    if ('tag_outcome' in record) throw new InputError('an emitted record carries an editor field (tag_outcome)');
  }

  // ----- cross-check against the research cases (the Old-outcome mapping of build-skeleton-data.py)
  let crossCheck = { cases_file_found: false };
  if (inputs.cases) {
    const caseFor = new Map(inputs.cases.map((c) => [`${c.source_row}|${c.tag}`, c]));
    const expectedOutcome = { apply: 'Applies', do_not_apply: 'Does not apply' };
    const disagree = [];
    let compared = 0;
    let agree = 0;
    let noCase = 0;
    for (const d of decisions) {
      if (!d.seeded_outcome) continue;
      const c = caseFor.get(`${d.audit_row_url}|${d.tag}`);
      if (!c) { noCase += 1; continue; }
      compared += 1;
      if (expectedOutcome[c.expected] === d.seeded_outcome) agree += 1;
      else disagree.push({ key: d.key, seeded: d.seeded_outcome, research_expected: c.expected });
    }
    crossCheck = {
      cases_file_found: true,
      seeded_rows_compared: compared,
      agree,
      disagree,
      seeded_rows_without_a_case: noCase,
      note: 'cases.example.jsonl derives expected from the final review note; the seed derives the outcome from Flag reason x Your decision',
    };
  }

  // ----- report
  const withOutcome = decisions.filter((d) => d.seeded_outcome);
  const report = {
    report_version: 1,
    claims_total: claims.length,
    claims_by_sample: tally(claims, (c) => c.sample),
    claims_in_13_oct_sample: claims.filter((c) => sampleByGeo.has(c.geo_id)).length,
    claims_from_audit_rows_only: claims.filter((c) => !sampleByGeo.has(c.geo_id)).length,
    decisions_total: decisions.length,
    decisions_by_seeded_outcome: tally(decisions, (d) => d.seeded_outcome ?? 'open'),
    decisions_by_why_in_queue: tally(decisions, (d) => d.why_in_queue),
    decisions_by_tag: tally(decisions, (d) => d.tag),
    decisions_by_priority: tally(decisions, (d) => d.priority),
    decisions_by_agent_proposal: tally(decisions, (d) => d.agent_proposal),
    decisions_with_seeded_outcome: withOutcome.length,
    decisions_with_why_wrong_hint: decisions.filter((d) => d.why_wrong_hint).map((d) => d.key),
    excluded_total: excluded.length,
    excluded_by_tag: tally(excluded, (e) => e.tag),
    forecast_prefixes_requested: FORECAST_PREFIXES.length,
    forecast_prefixes_not_found: prefixesNotFound,
    forecast_geo_ids_by_prefix: foundByPrefix,
    forecast_prefix_claims_already_decided: prefixClaimsAlreadyDecided,
    forecast_claims_in_sample: forecastGeoIds.filter((g) => sampleByGeo.has(g)).length,
    forecast_claims_from_audit_rows_only: forecastGeoIds.filter((g) => !sampleByGeo.has(g)).length,
    forecast_topped_up_from_wording: toppedUp,
    forecast_claims_without_an_open_predictive_or_hypothetical_row: forecastWithoutOpenRow,
    claims_with_unknown_sources_count: {
      count: unknownSources.length,
      geo_ids: unknownSources.slice().sort(cmp),
      claim_page_urls: Object.fromEntries([...unknownSourcesPages].sort((x, y) => cmp(x[0], y[0]))),
    },
    scrub_replacements_applied: { total: scrubber.total, by_replacement_text: scrubber.counts },
    random: {
      seed: RANDOM_SEED,
      pool_size: randomPool.length,
      method: 'pool = sample claims not in Decided or Forecast, sorted by Geo ID ascending; Fisher-Yates from the end with j = floor(mulberry32(seed)() * (i + 1)); first 10 of the shuffled pool',
      geo_ids: randomChosen,
    },
    sample_quality_tags_field: qualityKeys,
    inputs: inputs.files ?? {},
    cross_check_cases: crossCheck,
    check_by_hand_rows: checkRows.slice().sort((a, b) => a.order - b.order || cmp(a.key, b.key)).map((c) => ({ key: c.key, tag: c.tag, seeded: c.seeded })),
    warnings,
  };

  return { claims, decisions, excluded, checkRows, report };
}

// ---------- 7. rendering and writing -----------------------------------------------------------------------------------

const mdCell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const excerpt = (s, n = 72) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}\u2026` : s);

export function renderCheckByHand(checkRows) {
  const rows = checkRows.slice().sort((a, b) => a.order - b.order || cmp(a.key, b.key));
  const lines = [
    '# Check-by-hand rows in the seed',
    '',
    'Written by `agents/claim-tagger/scripts/seed-build.mjs`; change the script, not this file. These are the 9 Oct audit rows that the',
    'mechanical mapping cannot or should not turn into a seeded outcome, the one that sits outside the Rulebook, and the rows seeded by',
    'an explicit exception. Every other decided row follows the mapping: Missing tag + Agree = Applies, Wrong tag + Agree = Does not',
    'apply, Disagree flips both; Calibration and Evidence needed rows stay open.',
    '',
    '| # | Claim | Tag | Old answer (decision \u00b7 flag \u00b7 assessment) | Seeded as | Why |',
    '|---|---|---|---|---|---|',
  ];
  rows.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${mdCell(excerpt(r.claim))} | ${mdCell(r.tag)} | ${mdCell(r.old)} | ${mdCell(r.seeded)} | ${mdCell(r.why)} |`);
  });
  lines.push('', 'Audit rows (Notion pages), in table order:', '');
  rows.forEach((r, i) => lines.push(`${i + 1}. \`${r.key.slice(0, 8)}\u2026::${r.tag}\` ${r.url}`));
  lines.push(
    '',
    'Notes:',
    '',
    '- Open rows keep their audit history in Agent full note ("Old answer: ...") and carry no Seeded outcome, so they appear in My queue.',
    '- `skeletons/cases.example.jsonl` in the research folder relabels the four Evidence-needed rows (Improperly sourced = do not apply,',
    '  Source inaccessible = apply, the 11 Oct rule). The seed does not: nobody has read those sources, so the outcome stays open.',
    '- The auditor\'s inferred predictions of what the editor would answer, and the Evidence and Why this prediction columns, are never seeded.',
    '',
  );
  return lines.join('\n');
}

/** The five files as a Map of file name -> text (all with \n line endings). */
export function renderFiles(result) {
  const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  return new Map([
    ['claims.seed.jsonl', jsonl(result.claims)],
    ['decisions.seed.jsonl', jsonl(result.decisions)],
    ['excluded-decisions.jsonl', jsonl(result.excluded)],
    ['seed-report.json', `${JSON.stringify(result.report, null, 2)}\n`],
    ['check-by-hand.md', renderCheckByHand(result.checkRows)],
  ]);
}

export function writeFiles(files, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, text] of files) fs.writeFileSync(path.join(outDir, name), text, 'utf8');
}

// ---------- 8. command line --------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { research: DEFAULT_RESEARCH_DIR, out: DEFAULT_OUT_DIR, config: DEFAULT_CONFIG, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const take = (name) => {
      if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
      if (i + 1 >= argv.length) throw new InputError(`${name} needs a value`);
      i += 1;
      return argv[i];
    };
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '--research' || a.startsWith('--research=')) args.research = take('--research');
    else if (a === '--out' || a.startsWith('--out=')) args.out = take('--out');
    else if (a === '--config' || a.startsWith('--config=')) args.config = take('--config');
    else throw new InputError(`unknown argument ${a}; usage: node seed-build.mjs [--research <path>] [--out <dir>]`);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write('usage: node agents/claim-tagger/scripts/seed-build.mjs [--research <path>] [--out <dir>]\n');
    return 0;
  }
  if (!fs.existsSync(args.research)) throw new InputError(`research folder not found: ${args.research} (use --research <path>)`);
  const inputs = loadInputs(args.research);
  const result = buildSeed(inputs, loadConfig(args.config));
  const files = renderFiles(result);
  writeFiles(files, args.out);
  const r = result.report;
  const show = (obj) => Object.entries(obj).map(([k, v]) => `${k} ${v}`).join(', ');
  process.stdout.write([
    `seed-build: research folder ${args.research}`,
    `  claims.seed.jsonl         ${r.claims_total} rows (${show(r.claims_by_sample)})`,
    `  decisions.seed.jsonl      ${r.decisions_total} rows (${show(r.decisions_by_seeded_outcome)}; ${show(r.decisions_by_why_in_queue)})`,
    `  excluded-decisions.jsonl  ${r.excluded_total} rows`,
    `  forecast prefixes not found: ${r.forecast_prefixes_not_found.length ? r.forecast_prefixes_not_found.join(', ') : 'none'}`,
    `  claims with unknown sources_count: ${r.claims_with_unknown_sources_count.count}; name replacements applied: ${r.scrub_replacements_applied.total}`,
    `  seed-report.json and check-by-hand.md written; output folder ${args.out}`,
    ...r.warnings.map((w) => `  warning: ${w}`),
    '',
  ].join('\n'));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof InputError) {
      process.stderr.write(`seed-build: ${err.message}\n`);
      process.exitCode = 2;
    } else {
      process.stderr.write(`seed-build: unexpected error: ${err.stack ?? err}\n`);
      process.exitCode = 1;
    }
  }
}
