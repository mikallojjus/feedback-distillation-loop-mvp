// What a rulebook answers for a list of items, read from the cell store its judge run filled, and the extra reads that settle a flipped answer. The safety
// check (promote) and the follow-up use it; propose reads the store itself because it needs every read of every claim.
//
//   groupInfo(ctx, rubric, tag)                    -> { jc, group, version, body, inputs }: the judge group of the tag in that rulebook, the prompt version, the store inputs
//   readAnswers(ctx, rubric, tag, items)           -> Map(id -> { decision, runs, p, unsure, reason }): the verdict over the reads the store holds for each item
//                                                      (decision apply / do_not_apply / ask_editor, or null when the item has no usable read); reason is the text of
//                                                      the Agent reason of that verdict ("<reason> · <rule cited> · <k> of <n> runs agree"), null without a read
//   forceRuns(ctx, { rubric, tag, items, upTo })   -> { reads, usage }: makes sure every item has ok reads in runs 2 to `upTo` in the store of that rulebook, asking the
//                                                      judge model for the ones that are missing (the adaptive runs of judge() only re-read unsure items, so a flipped item
//                                                      that was sure on both sides needs this). Reads are written to the store like any other, so asking again costs nothing.
//
// The reads follow lib/judge's batch rules: the same system prompt file (rendered from prompts/judge.md and cached under runs/judgments/prompts/), batches of
// judge.batch_size, judge.attempts_per_batch attempts per batch with the reply checked by validateReply, the transient retries of judge.transient. A batch that
// cannot be read ends the run (exit 2): a safety check that could not run is reported, never skipped.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from './cells.mjs';
import { extractJson } from './claude.mjs';
import { EXIT } from './exit-codes.mjs';
import { h16 } from './hash.mjs';
import { readJson, writeTextAtomic } from './jsonl.mjs';
import { reasonLine } from './editor-words.mjs';
import { LoopExit, addUsage, callModel, cliVersionOf, judgeSettings, modelStop, usageOf } from './loop.mjs';
import { codeFile } from './paths.mjs';
import { buildUserMessage, groupsFor, readPromptVersion, renderSystemPrompt, storeInputsFor, validateReply, verdictOf } from '../judge.mjs';

const ENGINEER = 'Next: ask the engineer to look at the message the script printed.';
const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export function groupInfo(ctx, rubric, tag) {
  const jc = judgeSettings(ctx);
  const group = groupsFor(jc, rubric, [tag])[0];
  if (!group) {
    throw new LoopExit(EXIT.INVALID, `${tag} has no rules in force in any judge group`, { sentence: `${ctx.label}: nothing was checked, because ${tag} is not judged by any rule yet.`, next: ENGINEER });
  }
  const { version, body } = readPromptVersion(readFileSync(codeFile(ctx.root, jc.judge.prompt), 'utf8'));
  return { jc, group, version, body, inputs: storeInputsFor({ driver: ctx.driver, model: jc.model, effort: jc.judge.effort, promptVersion: version, group }) };
}

export function readAnswers(ctx, rubric, tag, items) {
  const { jc, inputs } = groupInfo(ctx, rubric, tag);
  const store = openStore(ctx.root, inputs, { readOnly: true });
  const lines = [1, 2, 3].map((n) => store.lines(n));
  const out = new Map();
  for (const it of items) {
    const per = lines.map((m) => {
      const l = m.get(it.id);
      return l && l.item_hash === it.item_hash ? l : null;
    });
    const entries = per.filter((l) => l?.status === 'ok').map((l) => l.tags.find((t) => t.name === tag)).filter(Boolean);
    if (!entries.length) {
      out.set(it.id, { decision: null, runs: 0, p: null, unsure: true, reason: null });
      continue;
    }
    const v = verdictOf(entries, jc.judge.rerun, { hadError: per.some((l) => l?.status === 'error') });
    out.set(it.id, { decision: v.decision, runs: v.runs, p: v.p_mean, unsure: v.unsure, reason: reasonLine(entries[entries.length - 1], v.agreed, v.runs, ctx.config.queue?.reason_max_words ?? jc.reasonMaxWords) });
  }
  return out;
}

// The system prompt of the group as judge() renders it, written once under its own hash.
function ensurePromptFile(root, text) {
  const file = join(root, 'runs', 'judgments', 'prompts', `${h16(text).replace(/^sha256:/, '')}.md`);
  if (!existsSync(file)) writeTextAtomic(file, text);
  return file;
}

export async function forceRuns(ctx, { rubric, tag, items, upTo }) {
  const usage = { input: 0, cache_write: 0, cache_read: 0, output: 0 };
  let reads = 0;
  if (items.length === 0 || upTo < 2) return { reads, usage };
  const { jc, group, body, inputs } = groupInfo(ctx, rubric, tag);
  const systemPromptFile = ensurePromptFile(ctx.root, renderSystemPrompt(body, { groupName: group.name, tags: group.tags, claimCount: jc.judge.batch_size }));
  const schema = readJson(codeFile(ctx.root, 'schemas', 'judge-reply.schema.json'));
  const tagNames = group.tags.map((t) => t.name);
  const store = openStore(ctx.root, inputs);
  let unreadable = 0;
  try {
    for (let run = 2; run <= Math.min(upTo, 3); run++) {
      const have = store.lines(run);
      const todo = items.filter((it) => {
        const l = have.get(it.id);
        return !(l && l.status === 'ok' && l.item_hash === it.item_hash);
      });
      for (const batch of chunk(todo, jc.judge.batch_size)) {
        ctx.rereadBatch = (ctx.rereadBatch ?? 0) + 1;
        const message = buildUserMessage(batch);
        const spent = { input: 0, cache_write: 0, cache_read: 0, output: 0 };
        let accepted = null;
        let problems = [];
        for (let attempt = 1; attempt <= jc.judge.attempts_per_batch && !accepted; attempt++) {
          const res = await callModel(ctx, {
            model: jc.model, systemPromptFile, prompt: message, effort: jc.judge.effort, timeoutMs: jc.judge.timeout_ms, maxTurns: jc.judge.max_turns,
          });
          addUsage(spent, usageOf(res));
          const stop = modelStop(ctx, res);
          if (stop) throw stop;
          if (res.errorKind) {
            problems = [res.message];
            continue;
          }
          let value;
          try {
            value = extractJson(res.text);
          } catch (e) {
            problems = [`the reply is not valid JSON (${e.message})`];
            continue;
          }
          const checked = validateReply(value, { ids: batch.map((b) => b.id), tagNames, rubricTags: rubric.tags, schema, reasonMaxWords: jc.reasonMaxWords });
          if (!checked.ok) {
            problems = checked.errors;
            continue;
          }
          accepted = { byId: checked.byId, attempt };
        }
        addUsage(usage, spent);
        const call = (attempt) => ({ run_id: ctx.runId, batch: ctx.rereadBatch, attempt, cli_version: cliVersionOf(ctx), usage: { ...spent } });
        if (accepted) {
          store.append(run, batch.map((it) => ({ id: it.id, item_hash: it.item_hash, status: 'ok', tags: accepted.byId.get(it.id), call: call(accepted.attempt) })));
          reads += batch.length;
        } else {
          store.append(run, batch.map((it) => ({ id: it.id, item_hash: it.item_hash, status: 'error', error: String(problems.join('; ')).slice(0, 400) || 'the reply could not be used', tags: [], call: call(jc.judge.attempts_per_batch) })));
          unreadable += batch.length;
        }
      }
    }
  } finally {
    store.close();
  }
  if (unreadable > 0) {
    throw new LoopExit(EXIT.INVALID, `${unreadable} extra read(s) could not be used`, {
      sentence: `${ctx.label} stopped: some answers could not be read again, so the check could not be finished; nothing was written to Notion.`,
      next: `Next: type ${ctx.again} again; it continues where it stopped.`,
    });
  }
  return { reads, usage };
}
