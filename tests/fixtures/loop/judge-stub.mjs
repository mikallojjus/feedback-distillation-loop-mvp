// A scripted judge for the promote and follow-up tests (not a test file): a drop-in for lib/claude.mjs runClaude that judge.mjs takes as deps.runClaude.
// It answers the real judge prompt's batches (valid JSON, every tag once, counterpart pairs consistent, via the fake's fakeJudgments) and lets a test
// say, claim by claim and tag by tag, what the judge decides under which rubric. The rubric is read from the system prompt file judge.mjs rendered
// ("(version 2026-10-13.1, hash sha256:...)"), so the same stub plays both the baseline and the candidate.

import { fakeJudgments, parseClaims, parseSystemPrompt } from '../fake-claude.mjs';

const HEADER = /\(version ([^,]+), hash (sha256:[0-9a-f]{16})\)/;
const OPPOSITE = { apply: 'do_not_apply', do_not_apply: 'apply' };

export const normClaim = (s) => String(s).replace(/\s+/g, ' ').trim();

/**
 * decide({ claim, tag, version, hash, fallback, run }) returns 'apply' | 'do_not_apply' (a decision the test wants) or undefined (keep the fake's own).
 * For a tag in a counterpart pair a decision for one member sets the other to the opposite unless the test decided that one too.
 * `run` is the number of the run this answer belongs to for this claim under this rubric: the 1st, 2nd, ... time the stub answers for it (judge.mjs asks
 * for the runs of an item in order), so a scenario can say "wrong in runs 1 and 2, right from run 3 on". Failed calls do not count.
 * The stub records every call in stub.calls: { ids, version, hash, model }. Options: cost (USD per call), failWith (an errorKind to return instead,
 * after failAfter calls); stub.options holds them and may be changed between calls (a test lets the usage window reopen before --resume).
 */
export function makeJudgeStub({ decide = () => undefined, cost = 0.01, failWith = null, failAfter = Infinity } = {}) {
  const calls = [];
  const options = { cost, failWith, failAfter };
  const answered = new Map(); // "<rubric hash>|<item id>" -> how many times the stub answered for it
  async function runClaudeStub(opts) {
    const prompt = parseSystemPrompt(opts.systemPromptFile);
    const header = HEADER.exec(prompt.text);
    const version = header?.[1] ?? 'unknown';
    const hash = header?.[2] ?? 'unknown';
    const claims = parseClaims(opts.prompt);
    calls.push({ ids: claims.map((c) => c.id), version, hash, model: opts.model, retry: opts.prompt.includes('Your previous reply was invalid') });
    if (options.failWith && calls.length > options.failAfter) {
      return { ok: false, text: '', isError: true, errorKind: options.failWith, message: options.failWith === 'usage_window' ? 'Claude usage limit reached. Your limit will reset at 3am.' : 'scripted failure', costUsd: 0, modelUsage: null, durationMs: 1, exitCode: 1, stdout: '', stderr: '', raw: null };
    }
    const partner = new Map();
    for (const [a, b] of prompt.pairs) {
      partner.set(a, b);
      partner.set(b, a);
    }
    const judgments = fakeJudgments(claims, prompt);
    for (const j of judgments) {
      const text = claims.find((c) => c.id === j.id).text;
      const run = (answered.get(`${hash}|${j.id}`) ?? 0) + 1;
      answered.set(`${hash}|${j.id}`, run);
      const wanted = new Map();
      for (const t of j.tags) {
        const d = decide({ claim: text, tag: t.name, version, hash, fallback: t.decision, run });
        if (d === 'apply' || d === 'do_not_apply') wanted.set(t.name, d);
      }
      for (const [name, d] of [...wanted]) {
        const other = partner.get(name);
        if (other && !wanted.has(other)) wanted.set(other, OPPOSITE[d]);
      }
      for (const [a, b] of prompt.pairs) { // a scenario that decides both members the same way is a mistake in the test, not something for the judge to retry
        if (wanted.has(a) && wanted.has(b) && wanted.get(a) === wanted.get(b)) throw new Error(`scripted judge: ${a} and ${b} are counterparts but the scenario decided "${wanted.get(a)}" for both on "${text}"`);
      }
      for (const t of j.tags) {
        const d = wanted.get(t.name);
        if (!d) continue;
        t.decision = d;
        t.p = 0.9;
        t.rule_ref = d === 'apply' ? `${t.name} rule 1` : `${t.name} description`;
        t.trigger = d === 'apply' ? text.split(/\s+/).slice(0, 3).join(' ') : null;
        t.reason = `Scripted judge: ${d} for ${t.name}.`;
      }
    }
    return {
      ok: true, text: JSON.stringify(judgments), isError: false, errorKind: null, message: '', costUsd: options.cost, durationMs: 5, exitCode: 0, numTurns: 1, stdout: '', stderr: '', raw: null,
      modelUsage: { [opts.model]: { inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: options.cost } },
    };
  }
  runClaudeStub.calls = calls;
  runClaudeStub.options = options;
  return runClaudeStub;
}

/**
 * Labels from cases and canaries rows: Map("<claim>|<tag>" -> 'apply' | 'do_not_apply'). A test builds its decide() from it so that
 * every labelled claim is judged as labelled unless the scenario says otherwise.
 */
export function labelMap(rows) {
  const map = new Map();
  for (const r of rows) if (r.claim && r.tag && (r.expected === 'apply' || r.expected === 'do_not_apply')) map.set(`${normClaim(r.claim)}|${r.tag}`, r.expected);
  return map;
}

export const labelOf = (labels, claim, tag) => labels.get(`${normClaim(claim)}|${tag}`);
export const opposite = (d) => OPPOSITE[d];
