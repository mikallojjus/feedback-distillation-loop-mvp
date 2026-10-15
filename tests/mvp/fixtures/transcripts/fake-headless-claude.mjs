// A stand-in for `claude -p ... --output-format stream-json --verbose`, only for the tests of headless-check.mjs. It is NOT the real CLI: it
// records how it was started and prints a canned transcript from this folder. The tests start it through the runner's own spawn path
// (a .mjs file runs under Node), with these variables in the environment they hand to the runner:
//
//   FAKE_TRANSCRIPT   path of the transcript to print on stdout
//   FAKE_TRANSCRIPTS  JSON { "<prompt>": "<path>" }: the transcript is picked by the prompt (wins over FAKE_TRANSCRIPT)
//   FAKE_CAPTURE      path of a JSONL file; one line { args, cwd, env: { CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, MSYS_NO_PATHCONV }, pid } is appended
//   FAKE_STDERR       text for stderr
//   FAKE_EXIT         the exit code (default 0)
//   FAKE_HANG         "1": print the first lines, then never end (the runner's timeout has to stop it)

import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('9.9.9 (fake claude)');
  process.exit(0);
}

const at = args.indexOf('-p');
const prompt = at >= 0 ? (args[at + 1] ?? '') : '';
const env = process.env;

if (env.FAKE_CAPTURE) {
  const seen = { CLAUDECODE: env.CLAUDECODE ?? null, CLAUDE_CODE_ENTRYPOINT: env.CLAUDE_CODE_ENTRYPOINT ?? null, MSYS_NO_PATHCONV: env.MSYS_NO_PATHCONV ?? null };
  appendFileSync(env.FAKE_CAPTURE, `${JSON.stringify({ args, cwd: process.cwd(), env: seen, pid: process.pid })}\n`);
}

let file = env.FAKE_TRANSCRIPT;
if (env.FAKE_TRANSCRIPTS) file = JSON.parse(env.FAKE_TRANSCRIPTS)[prompt] ?? file;
if (file) process.stdout.write(readFileSync(file));
if (env.FAKE_STDERR) process.stderr.write(env.FAKE_STDERR);

if (env.FAKE_HANG === '1') setInterval(() => {}, 1000);
else process.exitCode = Number(env.FAKE_EXIT ?? 0); // not process.exit(): let the output drain
