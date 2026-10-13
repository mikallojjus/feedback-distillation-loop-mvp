# Check-by-hand rows in the seed

Written by `agents/claim-tagger/scripts/seed-build.mjs`; change the script, not this file. These are the 9 Oct audit rows that the
mechanical mapping cannot or should not turn into a seeded outcome, the one that sits outside the Rulebook, and the rows seeded by
an explicit exception. Every other decided row follows the mapping: Missing tag + Agree = Applies, Wrong tag + Agree = Does not
apply, Disagree flips both; Calibration and Evidence needed rows stay open.

| # | Claim | Tag | Old answer (decision · flag · assessment) | Seeded as | Why |
|---|---|---|---|---|---|
| 1 | A ceasefire in Ukraine will increase the military threat to the Baltic… | Hypothetical | Agree · Missing tag · Judgment call | Open (no seeded outcome); priority High; proposal Do not add tag | Missing tag + Agree would give Applies for Hypothetical, but the auditor's note says the claim was settled in chat as Predictive only and that Hypothetical is not to be added. The old Agree cannot be read as an outcome for this tag. Left open for a fresh call. |
| 2 | The U.S. Constitution permits the president to restrict birthright citi… | Improperly sourced | Agree · Missing tag · Judgment call | Open (no seeded outcome); priority Check source; proposal Do not add tag | Mixed sources: one readable (it covers denaturalization and does not support presidential authority over birthright citizenship) and one that could not be read. The note says to record Source inaccessible and not to add Improperly sourced on the unread source alone, so the old Agree is ambiguous. Left open; a person reads the sources. |
| 3 | The House of Representatives has the constitutional authority to exclud… | Improperly sourced | Agree · Evidence needed · Not checkable | Open (no seeded outcome); priority Check source; proposal Read source first | Every attached source was blocked or inaccessible (Flag reason Evidence needed, Assessment Not checkable). The old Agree recorded the access failure, not a verdict on Improperly sourced. Left open; a person reads the sources. |
| 4 | Federal law authorizes mandatory detention for long-term undocumented r… | Improperly sourced | Agree · Evidence needed · Not checkable | Open (no seeded outcome); priority Check source; proposal Read source first | Every attached source was blocked or inaccessible (Flag reason Evidence needed, Assessment Not checkable). The old Agree recorded the access failure, not a verdict on Improperly sourced. Left open; a person reads the sources. |
| 5 | Trump agencies violated administrative law by skipping public comment p… | Improperly sourced | Agree · Evidence needed · Not checkable | Open (no seeded outcome); priority Check source; proposal Read source first | Every attached source was blocked or inaccessible (Flag reason Evidence needed, Assessment Not checkable). The old Agree recorded the access failure, not a verdict on Improperly sourced. Left open; a person reads the sources. |
| 6 | Permanent standard time is healthier for the public than permanent dayl… | Improperly sourced | Agree · Evidence needed · Not checkable | Open (no seeded outcome); priority Check source; proposal Read source first | Every attached source was blocked or inaccessible (Flag reason Evidence needed, Assessment Not checkable). The old Agree recorded the access failure, not a verdict on Improperly sourced. Left open; a person reads the sources. |
| 7 | A better strategy than requiring content removal is to inform the publi… | Wordy | Agree · Missing tag · Judgment call | Excluded (excluded-decisions.jsonl) | The Agree was recorded although the note and the reasoning both say the tag does not apply, so the dropdown contradicts the text. Wordy is outside the Rulebook, so the row goes to excluded-decisions.jsonl and is not seeded. |
| 8 | The Supreme Court is likely to expand executive power further in the fu… | Predictive | Disagree · Missing tag · Likely error | Seeded outcome Does not apply; why_wrong_hint Rule should change; priority High | Hedged forecast ("likely to expand"): the editor disagreed with adding Predictive, so Missing tag + Disagree flips to Does not apply. The research marked it contested for lesson L-1. Seeded as decided; why_wrong_hint tells the orchestrator to mention the rule in the Seeded reasoning text (never in the editor's Why wrong field). |
| 9 | Texas is on track to become a competitive swing state | Predictive | Disagree · Missing tag · Judgment call | Seeded outcome Does not apply; why_wrong_hint Rule should change; priority Medium | Hedged forecast ("on track to"): the editor disagreed with adding Predictive, so Missing tag + Disagree flips to Does not apply. The research marked it contested for lesson L-1. Seeded as decided; why_wrong_hint tells the orchestrator to mention the rule in the Seeded reasoning text (never in the editor's Why wrong field). |
| 10 | California's Proposition 40 will do more harm than good to the state's… | Predictive | Agree · Calibration · Judgment call | Seeded outcome Applies; priority Medium | Calibration rows normally stay open, but the note for Proposition 40 "will" says Add Predictive and the editor agreed with a definite "will" forecast, so the plan seeds it as Applies. |
| 11 | Ending DEI programs will reduce minority enrollment and graduation rates | Predictive | Agree · Calibration · Judgment call | Seeded outcome Applies; priority Medium | Calibration rows normally stay open, but the note for Ending DEI programs "will" says Add Predictive and the editor agreed with a definite "will" forecast, so the plan seeds it as Applies. |

Audit rows (Notion pages), in table order:

1. `8114bb42…::Hypothetical` https://app.notion.com/p/3f4273e214eb81a1b02ce05138dd8e72
2. `1a4c0008…::Improperly sourced` https://app.notion.com/p/3f4273e214eb813b9e06e8a662736d93
3. `1516d532…::Improperly sourced` https://app.notion.com/p/3f4273e214eb81b7a4cee1af71ee4f64
4. `15dcb1af…::Improperly sourced` https://app.notion.com/p/3f4273e214eb81508677c9915a9655ec
5. `975f63ff…::Improperly sourced` https://app.notion.com/p/3f4273e214eb8188b040df984286978a
6. `d2523b60…::Improperly sourced` https://app.notion.com/p/3f4273e214eb814e863cd3da1932b5b8
7. `15212f28…::Wordy` https://app.notion.com/p/3f4273e214eb811f9838e5e9dec1d7fe
8. `6aa014be…::Predictive` https://app.notion.com/p/3f4273e214eb813fbc32c968f9819580
9. `f376c2cc…::Predictive` https://app.notion.com/p/3f4273e214eb813b909fc78bac8861c7
10. `807f9fa0…::Predictive` https://app.notion.com/p/3f4273e214eb81daa289c3a726790afd
11. `c7ff945e…::Predictive` https://app.notion.com/p/3f4273e214eb811690dcd2cc4e9e1679

Notes:

- Open rows keep their audit history in Agent full note ("Old answer: ...") and carry no Seeded outcome, so they appear in My queue.
- `skeletons/cases.example.jsonl` in the research folder relabels the four Evidence-needed rows (Improperly sourced = do not apply,
  Source inaccessible = apply, the 11 Oct rule). The seed does not: nobody has read those sources, so the outcome stays open.
- The auditor's inferred predictions of what the editor would answer, and the Evidence and Why this prediction columns, are never seeded.
