# Lessons (example ledger)

Three worked lessons built on 13 Oct 2026 from real rows of the Notion database "Claims to review" (one editor, decisions of 9 to 11 Oct 2026). Editor quotes are verbatim. Statuses show what the promotion rules in `lesson-record-format.md` would have produced.

### L-1 Hedged trajectories are not forecasts
- Status: candidate (rule wrong; needs the rule owner's ruling, which the plan puts on day 4; the owner-ruling route then makes it Proposed)
- Kind: rule wrong
- Tag: Predictive · Rule: Predictive rule 1
- Statement: A claim that says something is "on track to" or "likely to" happen states a tendency, not an unconditional forecast; the editor does not treat it as Predictive, although rule 1 lists "is likely to" among the Predictive markers.
- Boundary examples:
  - Does not apply: "Texas is on track to become a competitive swing state" ([row](https://app.notion.com/p/3f4273e214eb813b909fc78bac8861c7)). Editor: "I don't think this is a predictive claim because it is saying that it is on track to become a competitive swing state. It is not saying in absolute terms that it will become a competitive swing state".
  - Does not apply: "The Supreme Court is likely to expand executive power further in the future" ([row](https://app.notion.com/p/3f4273e214eb813fbc32c968f9819580)). Editor: "I am not sure this is fully a predictive claim. Maybe more like hypothetical, and I'm not sure it's even a hypothetical. It is not like absolutely predicting".
  - Applies: "AI anxiety will cost Republicans more votes than it wins them" ([row](https://app.notion.com/p/3f4273e214eb8183aa37d42aa33076b4)). Editor: "This is definitely a predictive claim, and it is distinct from hypothetical."
  - Applies: "A ceasefire in Ukraine will increase the military threat to the Baltic states" ([row](https://app.notion.com/p/3f4273e214eb81a1b02ce05138dd8e72)). Editor: "it is making an absolute prediction that it will increase it. It's not saying it may increase it or it could increase it". (A contested row: the note was settled in chat; its case is inactive until re-confirmed.)
- Evidence: 2 independent claims decided Disagree against the auditor's "Add Predictive"; 4 claims decided Agree where the marker was a flat "will" or "inevitable". One editor, 9 Oct 2026.
- Counter-evidence: Predictive rule 1 itself ("is likely to"); the 4 Sep calibration note (98 of 100 on crypto claims) was made under that rule.
- Proposed change: rule 1, old text "Fires on an unconditional future/forecast marker: will, is expected to, is forecasted to, is projected to, is set to, is likely to" → new text "Fires on an unconditional forecast marker: will, is expected to, is forecasted to, is projected to, is set to. Hedged tendencies ('is likely to', 'is on track to', 'may', 'could') are not Predictive; 'may' and 'could' fall to Hypothetical rule 2, 'likely to' and 'on track to' take no modality tag." Add both Texas and Supreme Court as negative examples.
- Promotion: not yet (2 rows; a lesson that contradicts an existing rule needs 3). This lesson cannot be promoted by more rows alone, because it conflicts with the rule's text: the rule owner must decide whether the editor or the rule is right. Until then, verdicts on "likely to" claims go to the needs-editor band. Expected gate result on day 9: HOLD, because gold v1 holds too few hedged forecasts to show a gain; the target check runs on the boundary set sampled on day 7 (15 to 20 hedged forecasts and forecasts with a proposed policy as their subject labelled blind by both editors) and on the two contested rows scored under the candidate rule.
- Last fired: 9 Oct 2026 (2 challenges).
- Owner: the lead editor.

### L-2 Generic and indefinite references do not make a claim Context-dependent
- Status: promoted (7 decisions on different claims by one editor; the generic clause below is held because the boundary with definite descriptions is not settled); proposed change is a contrastive example pair, no rule edit
- Kind: rule unclear (the clause about generics) on top of agent slips (the five removals)
- Tag: Context-dependent · Rule: Context-dependent rule 5 (and Self-contained rules 1 and 5)
- Statement: A reader who asks "why?" or "in which cases?" is asking for supporting detail, not for an unresolved reference; only a reader who asks "which one?" about a definite phrase marks a claim Context-dependent. Bare generics ("a contractor", "state mandates", "stopgap funding") never trigger the tag.
- Boundary examples:
  - Does not apply: "A contractor's enforcement of safety restrictions constitutes a national security supply chain risk" ([row](https://app.notion.com/p/3f4273e214eb81a38dc4c90a07a26900)). Editor: "The claim makes sense on its own, although it leaves the reader asking questions like 'why?' 'in what instances'".
  - Does not apply: "December stopgap funding rewards Congress for avoiding a full budget" ([row](https://app.notion.com/p/3f4273e214eb8179b2ddf77c821bc698)). Editor: "this is text: independent, and the claim makes sense to me from reading it."
  - Does not apply: "Georgia's gubernatorial debate should be moderated by professional journalists rather than a town hall" ([row](https://app.notion.com/p/3f4273e214eb81f6b7bcc59c5313859e)). Editor: "We do not need to add context-dependent. the claim reads well".
  - Applies: "Melania Trump should not host her initiative's G20 event at President Trump's golf resort" ([row](https://app.notion.com/p/3f4273e214eb81a39fd3ec6e3f00cf08)). Editor: "It leaves the reader thinking, 'What's the initiative?'".
  - Applies: "Excluding CNN from Air Force One violates the federal court order" ([row](https://app.notion.com/p/3f4273e214eb8100b03cd56ecb14613e)). Auditor: "'The federal court order' has no identifying case, date, title or antecedent inside the claim." Editor agreed.
- Evidence: 5 removals agreed (Agree on "Remove Context-dependent") and 2 additions refused (Disagree on "Add Context-dependent"), 7 different claims, one editor, 9 Oct 2026. In the 2,351-row table, Context-dependent is the agent's most frequent non-Unsourced tag (33 of 313 sampled rows), so the over-application is systematic.
- Counter-evidence: on the neighbouring boundary (a definite description that reads as generic) the editor added Context-dependent to "The Dallas convention is the unofficial launch…" but declined it for "Georgia's gubernatorial debate should be moderated…" and for "the larger public health problem", so the clause "a phrase that reads as generic is not missing context" is held back for the owner. The removals themselves have no counter-evidence: rule 5 already says it ("Do not use for indefinites, time expressions, generics, or definites the claim itself resolves"); the agent did not follow it.
- Proposed change: no rule edit. Add the three negative examples above to Context-dependent's Example Claims as "Not Context-dependent:" lines, and add the editor's test ("which one?" versus "why?") to the preamble. Keep the seven rows as regression cases (they are in `cases.example.jsonl`).
- Promotion: reached 2 independent claims on 9 Oct (7 in all, no counter-evidence); proposed for the owner's approval. If the agent still over-applies after the example pair, the next step is a per-tag judge for this counterpart pair with only its two rules in view.
- Last fired: 9 Oct 2026 (7 challenges).
- Owner: the lead editor.

### L-3 An unreadable source is its own tag
- Status: absorbed (into the taxonomy on 11 Oct 2026: new Verified tag "Source inaccessible"; Improperly sourced rule 3 rewritten)
- Kind: taxonomy gap
- Tag: Improperly sourced → Source inaccessible · Rule: Improperly sourced rule 3 (old text)
- Statement: When an attached source cannot be read, the claim is neither supported nor improperly sourced; it needs a tag that records the access problem without judging the claim.
- Boundary examples:
  - Applies (Source inaccessible): "Federal law authorizes mandatory detention for long-term undocumented residents" ([row](https://app.notion.com/p/3f4273e214eb81508677c9915a9655ec)). Editor: "This may also show us that there is a need for a new type of tag, maybe for the inaccessible source, maybe 'inaccessible source' or 'questionable source,' or a better name to convey that."
  - Applies (Source inaccessible) plus a separately readable source: "The U.S. Constitution permits the president to restrict birthright citizenship" ([row](https://app.notion.com/p/3f4273e214eb813b9e06e8a662736d93)); the audit notes that one source remained unread while another was accessible.
  - Does not apply (Improperly sourced instead): "Iran poses an active nuclear threat to major U.S. cities" ([row](https://app.notion.com/p/3f4273e214eb8146be02cf780ef797a1)): the source was read and describes a conditional, not the claim's flat assertion.
- Evidence: 5 rows whose suggested tag became Source inaccessible, editor Agree on each: 4 flagged Evidence needed and Not checkable, and the birthright citizenship row, flagged Missing tag as a judgment call, with one readable source that does not support the claim and one unreadable source (Source inaccessible rule 4: a separate readable source may justify another tag), so that row stays contested. The editor named the gap in writing. 9 to 11 Oct 2026.
- Counter-evidence: none.
- Proposed change: taken. The taxonomy row "Source inaccessible" was created on 11 Oct with five When-to-use rules and the audit page linked as Evidence; Improperly sourced rule 3 now says "An attached source that cannot be read is Source inaccessible. Access failure alone never justifies Improperly sourced…". The rubric example in `rubric.example.json` carries both.
- Promotion: absorbed into rubric version 2026-10-13.1 (the example snapshot). Four of the five rows become regression cases for Source inaccessible = apply and Improperly sourced = do_not_apply; the birthright row keeps its Source inaccessible = apply case and its Improperly sourced case is contested (mixed sources).
- Last fired: 11 Oct 2026.
- Owner: the lead editor.

### Candidate noted, not yet a record
- "A claim may have more than one tag" (editor, on "An otherwise identical case involving a poor Black mother would receive less public sympathy", [row](https://app.notion.com/p/3f4273e214eb8154a883fc4df1264d12)): Context-dependent and Hypothetical co-exist. This is a design lesson for the judge (per-tag decisions, never one label per claim) rather than a rubric lesson; it is already decision DD4.
