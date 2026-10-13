// A stand-in for `claude -p` that also answers the DISTILLER prompt (not a test file). lib/claude.mjs runs it in-process for driver "fake" when the
// bin path ends in fake-claude.mjs, which is how `distill.mjs --driver fake` reaches it. Anything that is not a distill message goes to the judge fake
// in tests/fixtures/fake-claude.mjs, so one binary serves both.
//
// The distill reply is a function of the input only (the tag, the group's why-wrong, the cited rule), so a test can predict it:
//   kind    Change the rule for Rule should change, Clarify wording for Rule unclear
//   target  the cited rule, else rule 1, part "rule"
//   title   "Fake lesson: <Tag> <why wrong>"
//   text    the current text of the target rule plus " (the fake distiller made this clearer)"
// state.mode (or FAKE_DISTILL_MODE) picks a variant:
//   ok            the reply above
//   overlap       proposed_text repeats the first supporting claim word for word (an overfit risk), on every call
//   overlap_once  the same, but only on the first call of a group (the retry that quotes the checker's note gets the clean text)
//   garbage       a reply that is not JSON
//   bad_target    a target rule that does not exist (rule 99)
//   long          proposed_text of 2,000 characters
//   usage_limit   a usage-limit error
// state.calls and state.log (input, mode, retry) record what was asked.

import { runFake as judgeFake } from '../fake-claude.mjs';

export const RETRY_MARK = 'The previous proposed_text repeats';

const flagValue = (args, name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

export const looksLikeDistill = (stdin) => stdin.trimStart().startsWith('{') && stdin.includes('"why_wrong"') && stdin.includes('"other_rows"');

function envelope({ result, model, isError = false }) {
  const element = {
    type: 'result', subtype: isError ? 'error_during_execution' : 'success', is_error: isError, duration_ms: 900, num_turns: 1, result, session_id: 'fake-distill',
    total_cost_usd: 0.05, usage: { input_tokens: 3000, output_tokens: 400 },
    modelUsage: { [model]: { inputTokens: 3000, outputTokens: 400, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.05 } },
  };
  return JSON.stringify(element);
}

export function fakeLesson(input, { mode = 'ok', retry = false } = {}) {
  const rules = input.tag.when_to_use.rules;
  const cited = Number(/ rule (\d+)$/.exec(input.rule_cited ?? '')?.[1]);
  const target = mode === 'bad_target' ? 99 : rules.some((r) => r.n === cited) ? cited : rules[0].n;
  const current = rules.find((r) => r.n === target)?.text ?? 'the rule';
  let proposed = `${current.replace(/\.$/, '')} (the fake distiller made this clearer).`;
  if (mode === 'overlap' || (mode === 'overlap_once' && !retry)) proposed = `Rewrite: ${input.rows[0].claim} is the case.`;
  if (mode === 'long') proposed = 'x'.repeat(2000);
  return {
    kind: input.why_wrong === 'Rule should change' ? 'Change the rule' : 'Clarify wording',
    target: { rule_n: target, part: 'rule' },
    title: `Fake lesson: ${input.tag.name} ${input.why_wrong}`,
    statement: `Editors decided ${input.rows.length} claim(s) against ${input.tag.name} rule ${target} (fake).`,
    proposed_text: proposed,
    boundary_examples: [{ claim: 'An invented example claim for the boundary.', applies: true }],
    counter_evidence: [],
    confidence: 0.7,
  };
}

export async function runFake({ args = [], stdin = '', env = process.env, state = {} } = {}) {
  if (args.includes('--version') || !looksLikeDistill(stdin)) return judgeFake({ args, stdin, env, state });
  const model = flagValue(args, '--model') || 'claude-fake-0-0';
  const mode = state.mode ?? env.FAKE_DISTILL_MODE ?? 'ok';
  const retry = stdin.includes(RETRY_MARK);
  const json = stdin.slice(0, stdin.lastIndexOf('}') + 1);
  const input = JSON.parse(json);
  state.calls = (state.calls ?? 0) + 1;
  state.log ??= [];
  state.log.push({ call: state.calls, mode, retry, input, model, args });
  if (mode === 'usage_limit') {
    return { stdout: envelope({ result: 'Claude usage limit reached. Your limit will reset at 3am.', model, isError: true }), stderr: '', exitCode: 1 };
  }
  if (mode === 'garbage') return { stdout: envelope({ result: 'I cannot help with that, sorry.', model }), stderr: '', exitCode: 0 };
  return { stdout: envelope({ result: JSON.stringify(fakeLesson(input, { mode, retry })), model }), stderr: '', exitCode: 0 };
}
