// Exit codes shared by every script of the agent. The same table is in AGENT.md and the README.

export const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,
  INVALID: 2,
  PAUSED: 3,
  DRIFT: 4,
  TRUST: 5,
  HOLD: 10,
  FAIL: 11,
  USAGE_WINDOW: 75,
});

const WORDS = new Map([
  [EXIT.OK, 'Finished without problems.'],
  [EXIT.ERROR, 'The script hit an unexpected error and stopped; read the message above this line, fix the cause and run it again.'],
  [EXIT.INVALID, 'The input or a result was invalid or incomplete, so the script stopped; fix what the message names and run it again.'],
  [EXIT.PAUSED, 'The agent is paused (the Paused switch in Notion or the PAUSED file), so nothing was done; a person has to unpause it first.'],
  [EXIT.DRIFT, 'Something no longer matches what was recorded (the rulebook in Notion, a locked file or the model), so the script refused to go on.'],
  [EXIT.TRUST, 'A field that only editors may change was altered while the agent was writing; the agent paused itself and a person must look before it continues.'],
  [EXIT.HOLD, 'The test gate says HOLD: the evidence is not strong enough to decide yet, so the change was not made live.'],
  [EXIT.FAIL, 'The test gate says FAIL: the change would make the agent worse, so it was not made live.'],
  [EXIT.USAGE_WINDOW, 'The Claude usage window ran out; the work done so far is saved, so run the same command again with --resume after the window resets.'],
]);

/** One plain-words sentence for an exit code, for status output and the README. */
export function describeExit(code) {
  return WORDS.get(code) ?? `Exit code ${code} is not one of the agent's codes (0, 1, 2, 3, 4, 5, 10, 11, 75).`;
}
