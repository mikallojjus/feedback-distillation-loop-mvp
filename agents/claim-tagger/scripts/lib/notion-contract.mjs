// The Notion contract at option level: the select options the scripts, the Notion formulas and the editors' views name.
//
// allowlist.PROPERTY_TYPES pins the property names and types, and pull.mjs checks them. This file pins the option NAMES of the select
// properties, because renaming or deleting an option changes behaviour without any error: the Stage, Direction and Effective outcome
// formulas compare Tag outcome, Why wrong, Agent proposal, Agent follow-up and the lessons' Status by name; distill and cases-sync
// filter on Why wrong; propose writes Readiness, Priority, Agent proposal and Why in queue; promote writes the lesson Status and the
// Runs Kind and Verdict. A renamed 'Rule unclear' would silently stop feeding Stage and distill.
//
//   REQUIRED_OPTIONS[database][property]   the option names that must exist; extra options in Notion are fine
//   OPTIONAL_OPTIONS[database][property]   options that are live but that the scripts can do without (named so nobody adds them above)
//   checkOptions(database, properties)     { missing: [{ property, option }], unreadable: [property] } for a live properties object
//
// pull.mjs reports a missing option like a missing property (schemaProblems, exit 4) and an option list it cannot read as a warning.
//
// Where the lists come from: the live schema of the newest pull (20261013T175400Z-pull), checked against the DDL in
// docs/mvp-2026-10/plan.md (appendix). The two agree on 17 of the 18 select properties. Runs.Kind is live with two options the DDL
// does not have, Baseline and Rollback (an ALTER between the 15:06Z and 15:23Z pulls of 13 Oct 2026; schemas/notion/as-built.md lists the
// statement): Baseline is required because run-card.mjs uses it by default; Rollback is optional because promote.mjs falls back to
// Gate when the option does not exist.
// A change here goes together with allowlist.mjs (PROPERTY_TYPES), the DDL appendix and tests/fixtures/notion/db.*.json.

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

export const REQUIRED_OPTIONS = deepFreeze({
  rulebook: {
    // Verified: the only status whose rows go into the rubric (rubric-build); Proposed and Retired are the other states of a row.
    Status: ['Verified', 'Proposed', 'Retired'],
    // The rubric's own category and polarity names. Issue drives Readiness = Fix needed (config readiness.fix_polarities).
    Category: ['Meaning', 'Quality', 'Format', 'Usage', 'Check'],
    Polarity: ['Classification', 'Issue', 'Positive'],
  },
  claims: {
    // Table and Sample: the strata of the trial, written by the seed only. Readiness: propose.mjs writes all four; the Needs editor view filters on it.
    Table: ['U.S. Politics', 'World affairs'],
    Sample: ['Decided', 'Forecast', 'Random'],
    Readiness: ['Needs editor', 'Fix needed', 'Not checkable', 'Ready'],
  },
  tag_decisions: {
    // propose.mjs writes all five; the Direction formula reads Add tag and Keep tag.
    'Agent proposal': ['Add tag', 'Remove tag', 'Keep tag', 'Do not add tag', 'Read source first'],
    // propose.mjs writes Low confidence and Rule changed and never weakens an Editor challenge or a Blind check. The seed writes
    // Seeded decision and Auditor flag. Migrated decision is reserved for the move to the real Claims to review database.
    'Why in queue': ['Low confidence', 'Auditor flag', 'Editor challenge', 'Rule changed', 'Blind check', 'Seeded decision', 'Migrated decision'],
    // propose.mjs (priorityOf).
    Priority: ['High', 'Medium', 'Check source'],
    // The editors' decision. pull compares Applies and Does not apply (decided rows); the Stage formula reads Needs evidence and Ask another editor.
    'Tag outcome': ['Applies', 'Does not apply', 'Needs evidence', 'Ask another editor'],
    // distill reads Rule unclear and Rule should change; cases-sync also reads No tag fits and Other (no case); the Stage formula reads
    // Rule unclear, Rule should change and No tag fits; Agent slip is a case without a lesson.
    'Why wrong': ['Agent slip', 'Rule unclear', 'Rule should change', 'No tag fits', 'Other'],
    // The audit decision copied once by the seed; the Effective outcome formula falls back to it.
    'Seeded outcome': ['Applies', 'Does not apply'],
    // followup.mjs writes all three; the Stage formula reads Fixed.
    'Agent follow-up': ['Fixed', 'Still wrong', 'Not re-run'],
  },
  rule_changes: {
    // distill.mjs writes the first three; promote.mjs refuses a New or promoted tag lesson (it changes rules of existing tags only).
    Kind: ['Clarify wording', 'Add boundary example', 'Change the rule', 'New or promoted tag'],
    // distill creates Proposed, the rule owner sets Approved or Rejected, promote sets Live or Rolled back; the Stage formula reads Proposed and Approved.
    Status: ['Proposed', 'Approved', 'Rejected', 'Live', 'Rolled back'],
  },
  runs: {
    // run-card.mjs: Tag, and Baseline by default; distill: Distill; promote: Gate or Smoke; followup: Follow-up.
    Kind: ['Tag', 'Distill', 'Gate', 'Follow-up', 'Smoke', 'Baseline'],
    // PASS, HOLD and FAIL only on a Gate row; every other row is n/a.
    Verdict: ['PASS', 'HOLD', 'FAIL', 'n/a'],
  },
});

export const OPTIONAL_OPTIONS = deepFreeze({
  // promote.mjs runKind(): a rollback row is Rollback when the Runs database has that option, else Gate.
  runs: { Kind: ['Rollback'] },
});

/** The option names of a live select property definition, or null when the definition carries no readable list. */
export function optionNames(def) {
  const list = def?.select?.options;
  return Array.isArray(list) ? list.map((o) => o?.name).filter((n) => typeof n === 'string') : null;
}

/**
 * Compare the live properties of one database with REQUIRED_OPTIONS.
 * Returns { missing: [{ property, option }], unreadable: [property] }. A property that is absent or no longer a select is not reported
 * here (pull's property check reports it once); a select without a readable option list is `unreadable`, never silently fine.
 */
export function checkOptions(db, properties) {
  const missing = [];
  const unreadable = [];
  for (const [property, required] of Object.entries(REQUIRED_OPTIONS[db] ?? {})) {
    const def = properties?.[property];
    if (def?.type !== 'select') continue;
    const names = optionNames(def);
    if (names === null) {
      unreadable.push(property);
      continue;
    }
    const have = new Set(names);
    for (const option of required) if (!have.has(option)) missing.push({ property, option });
  }
  return { missing, unreadable };
}
