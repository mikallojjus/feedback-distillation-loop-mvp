// What every command of the loop checks first (CONTRACTS section 10), and the report of a command that refuses to go on.
//
//   preflight({ root, config, pullId, now, adopt }) -> { ok, code, reason, kind, tag, column, stops, warnings, adopted, edition }
//   refusedReport(config, reason, label?)           -> the three-part report a refusing command writes: { demo, sentence, rows: [], next }
//
// The checks, in this order, on the state folder `root` and the pull `pullId` the command has just made (default: the newest pull):
//   exit 3  runs/PAUSED exists, or Paused is ticked in Agent settings in the pull (hard rule 7: a person clears it, never the agent)
//   exit 4  the rulebook file on disk does not verify or does not match its lock, or the pull's drift.json has a `judged` entry (a judged tag
//           whose Notion text differs from the lock) or a judged tag is `missing` from the Rulebook copy: the reason names the tag and the column
//   adopt   drift.json entries under `adopted` are tags without rules in force that someone edited in Notion; with adopt (the default) they make a
//           new edition ("adopted from Notion: <tag> <columns>") through writeEdition, and the command goes on. status passes adopt: false.
//   warning runs/SETUP exists (a builder session is open); a check that could not run (no pull yet, no Agent settings, no drift.json, a drift check
//           that was skipped) is a warning, never silence
// `kind` is paused_file, paused_notion, rubric_file or drift for a refusal, null otherwise. `edition` is the edition in force when the check ends.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { groupOf } from './config.mjs';
import { plural, listNames, tableLink, viewLink } from './editor-words.mjs';
import { driftStops } from '../judge.mjs';
import { latestPullId, loadPull } from '../pull.mjs';
import { buildRubric, checkLock, nextEdition, readLock, readRubric, writeEdition } from './rubric.mjs';

const refuse = (code, kind, reason, extra = {}) => ({ ok: false, code, kind, reason, tag: null, column: null, stops: [], warnings: [], adopted: [], edition: null, ...extra });

/** Run the checks. Never throws for a refusal: read `ok`, `code` and `reason`. */
export function preflight({ root, config, pullId = null, now = () => new Date(), adopt = true } = {}) {
  const warnings = [];
  const done = (extra = {}) => ({ ok: true, code: 0, kind: null, reason: null, tag: null, column: null, stops: [], warnings, adopted: [], edition: null, ...extra });

  if (existsSync(join(root, 'runs', 'PAUSED'))) {
    return refuse(3, 'paused_file', 'the PAUSED file exists, so a person has to remove it', { warnings });
  }

  let pull = null;
  const id = pullId ?? latestPullId(root);
  if (!id) warnings.push('there is no pull yet, so the Paused box in Agent settings and the rulebook text in Notion could not be checked');
  else {
    try {
      pull = loadPull(root, id, { config });
    } catch (e) {
      warnings.push(`the pull could not be read (${e.message}), so the Paused box and the rulebook text in Notion could not be checked`);
    }
  }

  if (pull) {
    const settings = pull.settings();
    if (settings === null) warnings.push('the pull has no Agent settings, so the Paused box could not be read');
    else if (settings.paused === true) return refuse(3, 'paused_notion', 'Paused is ticked in Agent settings, so a person has to untick it', { warnings });
  }

  // the rulebook file on disk must be a real edition that agrees with its lock
  let rubric = null;
  try {
    rubric = readRubric(root);
    const lock = rubric ? readLock(root) : null;
    if (rubric && lock === null) warnings.push('the rulebook has no lock file, so the saved edition was not compared with one');
    else if (rubric) {
      const same = checkLock(rubric, lock);
      if (!same.ok) return refuse(4, 'rubric_file', `the rulebook file on disk no longer matches its lock (${same.errors.slice(0, 2).join('; ')})`, { warnings });
    }
  } catch (e) {
    return refuse(4, 'rubric_file', `the rulebook file on disk is not valid (${e.message.split('\n')[0]})`, { warnings });
  }
  if (rubric === null) warnings.push('there is no rulebook edition yet, so nothing could be compared with the rulebook text in Notion');

  let edition = rubric?.edition ?? null;
  const adopted = [];
  if (pull && rubric) {
    const drift = pull.drift();
    if (drift === null) warnings.push('the pull has no drift check, so the rulebook text in Notion was not compared with the saved edition');
    else if (typeof drift.skipped === 'string') warnings.push(`the drift check was skipped in the pull (${drift.skipped}), so the rulebook text in Notion was not compared with the saved edition`);
    else {
      const judgedNames = new Set(rubric.tags.filter((t) => t.judged && groupOf(config, t.name) !== null).map((t) => t.name));
      const stops = driftStops(drift, judgedNames);
      if (stops.length) {
        const first = stops[0];
        const what = stops.slice(0, 3).map((s) => [s.tag, s.column].filter(Boolean).join(': ')).join('; ');
        return refuse(4, 'drift', `the rulebook text in Notion no longer matches the saved edition (${what})`, { tag: first.tag, column: first.column, stops, warnings });
      }
      const changed = (Array.isArray(drift.adopted) ? drift.adopted : []).filter((a) => a && typeof a.tag === 'string');
      if (changed.length && adopt) {
        try {
          const next = buildRubric(pull.rulebook() ?? [], { config, edition: nextEdition(rubric.edition, now()), now });
          const reason = `adopted from Notion: ${changed.map((a) => `${a.tag} ${(a.columns ?? []).join(', ')}`.trim()).join('; ')}`;
          writeEdition(root, next, { reason });
          edition = next.edition;
          adopted.push(...changed);
        } catch (e) {
          warnings.push(`the edit${changed.length === 1 ? '' : 's'} to ${listNames(changed.map((a) => a.tag))} in Notion could not be taken over (${e.message.split('\n')[0]})`);
        }
      } else if (changed.length) {
        warnings.push(`${plural(changed.length, 'tag')} without rules ${changed.length === 1 ? 'has' : 'have'} been edited in Notion; the next command takes the edit over`);
      }
    }
  }

  if (existsSync(join(root, 'runs', 'SETUP'))) warnings.push('a builder session is open (the SETUP marker exists)');
  return done({ warnings, adopted, edition });
}

/**
 * The report of a command that stopped before doing anything. `reason` is what preflight returned (or { kind, reason, tag }, or a plain sentence
 * of why); `label` is the command's name for the first words ("Tag", "Promote"), else the sentence starts "Nothing was done".
 */
export function refusedReport(config, reason, label = null) {
  const r = typeof reason === 'string' ? { kind: null, reason, tag: null, column: null } : (reason ?? {});
  const head = label ? `${label}: nothing was done` : 'Nothing was done';
  const demo = config?.demo === true;
  switch (r.kind) {
    case 'paused_file':
    case 'paused_notion':
      return {
        demo,
        sentence: `${head}, because the agent is paused.`,
        rows: [],
        next: r.kind === 'paused_notion'
          ? `Next: untick Paused in Agent settings (${tableLink(config, 'agent_settings')}).`
          : 'Next: ask the engineer to remove the pause file.',
      };
    case 'drift': {
      const stops = Array.isArray(r.stops) && r.stops.length ? r.stops : [{ tag: r.tag, column: r.column }];
      const what = stops.slice(0, 3).map((s) => [s.tag, s.column].filter(Boolean).join(': ')).filter(Boolean).join('; ');
      const tags = [...new Set(stops.map((s) => s.tag).filter(Boolean))];
      return {
        demo,
        sentence: `${head}, because the rulebook text in Notion no longer matches the saved edition${what ? ` (${what})` : ''}.`,
        rows: [],
        next: `Next: put the rulebook text back${tags.length ? ` on ${listNames(tags)}` : ''} (${viewLink(config, 'rulebook')}), or ask the engineer to restore an edition.`,
      };
    }
    case 'rubric_file':
      return {
        demo,
        sentence: `${head}, because the rulebook file on disk no longer matches its own checks.`,
        rows: [],
        next: 'Next: ask the engineer to restore the rulebook file.',
      };
    default:
      return {
        demo,
        sentence: `${head}${r.reason ? `, because ${String(r.reason).replace(/^because\s+/i, '').replace(/[.\s]+$/, '')}` : ''}.`,
        rows: [],
        next: 'Next: ask the engineer to look at the message the script printed.',
      };
  }
}
