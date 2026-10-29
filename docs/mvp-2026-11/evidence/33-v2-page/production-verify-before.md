# Production `setup.mjs verify` before the v2 page (2026-10-29)

Command: `node agents/claim-tagger-mvp/scripts/setup.mjs verify` (production root, read-only).

```
verify: rows rulebook 13, claims 600, tag_decisions 602, rule_changes 3, agent_settings 1; 61 request(s), 0 write(s)
verify: added after setup: 400
verify: 7 difference(s)
  claims: extra column - "Proposed fix" (rich_text) is in the table but not in the structure
  claims: extra column - "Reviewer" (select) is in the table but not in the structure
  claims: extra column - "Filter tags" (multi_select) is in the table but not in the structure
  claims: view columns - "All claims" (the table's own view): expected Geo Name, Geo Space, Agent tags, Agent status, Verified tags, Review status, Geo URL; found Geo Name, Geo Space, Agent tags, Agent confidence, Verified tags, Challenged tags notes, Review status, Agent reasons, Agent remarks, Agent reading, Agent edition, Geo URL
  rule_changes: view columns - "Lessons waiting": expected Lesson, Current text, Proposed text, Status; found Lesson, Tag, Kind, Current text, Proposed text, Editor wording, Status, Safety check result, Rule, Supporting rows
  rule_changes: view columns - "Default view" (the table's own view): expected Lesson, Tag, Status, Current text, Proposed text, Safety check result; found Lesson, Rule, Kind, Status, Current text, Proposed text, Editor wording, Safety check result, Supporting rows, Tag
  rulebook: field - "Context-dependent": When to use differs (file "1. A pronoun with no antecedent inside the claim ...", Notion "1. A pronoun with no antecedent inside the claim ...")
```

Reading:
- The same 7 differences as entry 55. The three extra Claims columns (Proposed fix, Reviewer, Filter tags) and the widened views were made by people in Notion, most likely the editor's own review. The v2 spec has to account for them.
- Claims holds 600 rows (the two demo mocks of entry 54 are gone). Tag decisions holds 602 rows, more than the 203 of entry 55, so the ledger has grown since that entry. This baseline is what step 5 compares against.
- 0 writes.
