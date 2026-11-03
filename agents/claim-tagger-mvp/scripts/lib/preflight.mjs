// What every command of the loop checks first (CONTRACTS section 10), and the report of a command that refuses to go on.
//
//   preflight({ root, config, pullId, now, adopt }) -> { ok, code, reason, kind, tag, column, stops, warnings, adopted, edition }
//   refusedReport(config, reason, label?)           -> the three-part report a refusing command writes: { demo, sentence, rows: [], next }
//
// The checks, in this order, on the state folder `root` and the pull `pullId` the command has just made (default: the newest pull):
//   exit 3  runs/PAUSED exists, or Paused is ticked in Agent settings in the pull (hard rule 7: a person clears it, never the agent)
//   exit 4  the rulebook file on disk does not verify or does not match its lock, or the pull's drift.json has a `judged` entry (a judged tag
//           whose Notion text differs from the lock) or a judged tag is `missing` from the Rulebook copy: the reason names the tag and the column
//   adopt   drift.json entries under `adopted` are tags that are not judged that someone edited in Notion, and entries under `toggled` are tags whose Judged box was
//           ticked or unticked; with adopt (the default) they make one new edition through writeEdition, with the changelog line "adopted from Notion: <tag> <columns>; ..." for the
//           edits and one line "Judged on: <tag>" / "Judged off: <tag>" for each toggle, and the command goes on. A toggle never stops a command. status passes adopt: false.
//   warning runs/SETUP exists (a builder session is open); a check that could not run (no pull yet, no Agent settings, no drift.json, a drift check
//           that was skipped) is a warning, never silence
// `kind` is paused_file, paused_notion, rubric_file or drift for a refusal, null otherwise. `edition` is the edition in force when the check ends. `toggled` lists the Judged
// ticks taken over ({ tag, judged }).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { isJudgedTag } from './config.mjs';
import { plural, listNames, tableLink, viewLink } from './editor-words.mjs';
import { driftStops } from '../judge.mjs';
import { latestPullId, loadPull } from '../pull.mjs';
import { buildRubric, checkLock, lockOf, nextEdition, readLock, readRubric, toggleClauses, writeEdition } from './rubric.mjs';

const refuse = (code, kind, reason, extra = {}) => ({ ok: false, code, kind, reason, tag: null, column: null, stops: [], warnings: [], adopted: [], toggled: [], edition: null, ...extra });

/** Run the checks. Never throws for a refusal: read `ok`, `code` and `reason`. */
export function preflight({ root, config, pullId = null, now = () => new Date(), adopt = true } = {}) {
  const warnings = [];
  const done = (extra = {}) => ({ ok: true, code: 0, kind: null, reason: null, tag: null, column: null, stops: [], warnings, adopted: [], toggled: [], edition: null, ...extra });

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
  let lock = null;
  try {
    rubric = readRubric(root);
    lock = rubric ? readLock(root) : null;
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
  const toggledIn = [];
  if (pull && rubric) {
    const drift = pull.drift();
    if (drift === null) warnings.push('the pull has no drift check, so the rulebook text in Notion was not compared with the saved edition');
    else if (typeof drift.skipped === 'string') warnings.push(`the drift check was skipped in the pull (${drift.skipped}), so the rulebook text in Notion was not compared with the saved edition`);
    else {
      if (drift.nothing_ticked === true) warnings.push('no box is ticked in Judged in the Rulebook yet and the saved edition is from before the box, so the ticks were not read and the saved ones stand');
      if (drift.no_judged_column === true) warnings.push('the Rulebook in Notion has no Judged column, so the ticks could not be read and the saved ones stand; ask the engineer to run the setup build');
      const judgedNames = new Set(rubric.tags.filter((t) => isJudgedTag(config, t)).map((t) => t.name));
      const stops = driftStops(drift, judgedNames);
      if (stops.length) {
        const first = stops[0];
        const what = stops.slice(0, 3).map((s) => [s.tag, s.column].filter(Boolean).join(': ')).join('; ');
        return refuse(4, 'drift', `the rulebook text in Notion no longer matches the saved edition (${what})`, { tag: first.tag, column: first.column, stops, warnings });
      }
      const changed = (Array.isArray(drift.adopted) ? drift.adopted : []).filter((a) => a && typeof a.tag === 'string');
      const toggled = (Array.isArray(drift.toggled) ? drift.toggled : []).filter((t) => t && typeof t.tag === 'string' && typeof t.judged === 'boolean');
      // the drift was computed against one lock (pull.mjs stamps it): it is taken over only while that lock is the one in force. A pull older than the edition in force (a second command on
      // the same pull, or a pull from before another command wrote an edition) would write the text of Notion over what that edition says, a rule just promoted included.
      const against = drift.against;
      const stale = lock !== null && (!against || against.edition !== lock.edition || against.rubric_hash !== lock.rubric_hash);
      // while a builder session is open (build and seed-judged are running) a tick is not taken over: the seed is half done, and an edition made now would carry whatever the boxes say at this moment
      const holdsTicks = toggled.length > 0 && existsSync(join(root, 'runs', 'SETUP'));
      if ((changed.length || toggled.length) && stale) {
        warnings.push(`the pull is older than the rulebook edition in force (it was compared with ${against?.edition ? `edition ${against.edition}` : 'an unknown edition'}, edition ${rubric.edition} is in force), so the changes it shows in Notion were not taken over; pull again`);
      } else if ((changed.length || toggled.length) && adopt && !holdsTicks) {
        try {
          const next = buildRubric(pull.rulebook() ?? [], { config, edition: nextEdition(rubric.edition, now()), now, judgedFrom: lock });
          // the pull's drift can be older than the edition in force (a second command on the same pull): an edition whose lock would say what the lock in force says is not written again.
          // (A lock made before the Judged box has no judged map, so the first edition after it is always written, even when every flag comes out the same.)
          const { edition: _e, locked_at: _l, ...wanted } = lockOf(next);
          const { edition: _e2, locked_at: _l2, ...held } = lock ?? {};
          if (lock === null || !isDeepStrictEqual(wanted, held)) {
            // one line for the edits (as always), then one line per tag whose Judged box changed: "Judged on: <tag>", "Judged off: <tag>"
            const edits = changed.map((a) => `${a.tag} ${(a.columns ?? []).join(', ')}`.trim());
            writeEdition(root, next, { reason: [...(edits.length ? [`adopted from Notion: ${edits.join('; ')}`] : []), ...toggleClauses(toggled)] });
            edition = next.edition;
            adopted.push(...changed);
            toggledIn.push(...toggled);
          }
        } catch (e) {
          warnings.push(`the ${[changed.length ? `edit${changed.length === 1 ? '' : 's'} to ${listNames(changed.map((a) => a.tag))}` : null, toggled.length ? `Judged box of ${listNames(toggled.map((t) => t.tag))}` : null].filter(Boolean).join(' and the ')} in Notion could not be taken over (${e.message.split('\n')[0]})`);
        }
      } else {
        if (holdsTicks && adopt) warnings.push(`${toggleClauses(toggled).join('; ')} in Notion; a builder session is open, so they are taken over by the first command after it is closed`);
        else if (toggled.length) warnings.push(`${toggleClauses(toggled).join('; ')} in Notion; the next command takes ${toggled.length === 1 ? 'it' : 'them'} over`);
        if (changed.length) warnings.push(`${plural(changed.length, 'tag')} that ${changed.length === 1 ? 'is' : 'are'} not judged ${changed.length === 1 ? 'has' : 'have'} been edited in Notion; the next command takes the edit over`);
      }
    }
  }

  if (existsSync(join(root, 'runs', 'SETUP'))) warnings.push('a builder session is open (the SETUP marker exists)');
  return done({ warnings, adopted, toggled: toggledIn, edition });
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
