# P9 occurrence sweep: claims_copy, Rulebook copy, demo terms, walkthrough commands

Retrieval only (Haiku sweep), 2026-10-27, branch claims-hub-2026-10, repo X:\work\geo-agents. Nothing edited, no scripts run, no Notion or network use.

## Scope, exclusions, caveats

- Searched the whole repo except: `docs/mvp-2026-11/evidence/`, `agents/claim-tagger-mvp/runs/`, `agents/claim-tagger/` (old build), `node_modules`, and `.claude/worktrees/`. The last one is a leftover git worktree (`agent-a377142fa1b1354d2`) holding a full duplicate of the repo; including it would double every count. This is one exclusion beyond the brief.
- Case-sensitive, as specified.
- Format: each hit is an exact line number, grouped by file, with the per-file count in brackets. The trimmed line text (120 characters) is NOT reproduced: for about 1,700 hits it would roughly double the size of this file. Open the file at the line number to see it.
- Lines that match two terms in one group appear under each term. Term 9a is a subset of term 9c.
- Snapshot: other agents are active in this repo (the worktree above appeared during the sweep, and counts moved between passes). Re-run before editing; line numbers can drift.
- Self-reference: this file contains every search term. Exclude `docs/mvp-2026-11/sweeps/p9-occurrences.md` from any re-run, or delete it once the rename is done.

## Counts per term (hit lines; files)

| # | Term | Hits | Files |
|---|---|---|---|
| 1 | `claims_copy` | 535 | 48 |
| 2a | `Claims copy` | 179 | 40 |
| 2b | `Rulebook copy` | 257 | 63 |
| 3 | `demo_claims` | 5 | 4 |
| 4a | `Demo tests` | 71 | 32 |
| 4b | `demo_tests` | 20 | 10 |
| 5a | `Demos` (whole word) | 99 | 33 |
| 5b | `pages.demos` | 17 | 7 |
| 5c | `demos:` | 4 | 3 |
| 6 | `Feedback Distillation MVP` | 24 | 19 |
| 7a | `D31` | 34 | 15 |
| 7b | `decision 31` | 4 | 2 |
| 8a | `demoEditor` | 40 | 8 |
| 8b | `DEMO_EDITOR` | 3 | 2 |
| 9a | `walkthrough.mjs` + decide / approve / reject | 14 | 6 |
| 9b | `decideCommand` / `approveCommand` / `rejectCommand` | 6 | 1 |
| 9c | decide / approve / reject in `agents/claim-tagger-mvp/scripts/walkthrough.mjs` | 60 | 1 |
| 9d | decide / approve / reject in `tests/mvp/walkthrough.test.mjs` | 220 | 1 |
| 10 | `CLAIMS_COPY_COLUMNS` | 18 | 7 |
| 11a | `is_inline` | 34 | 17 |
| 11b | `isInline` | 13 | 8 |
| 12a | `real_claims` | 43 | 11 |
| 12b | `pickClaims` | 4 | 2 |
| 12c | `--pick` | 17 | 4 |

Per-file counts are in each term's section below (bracketed after the file path), not in this table.

Totals come from the final pass before this file was written. Earlier passes differed by a line or two while the repo changed: `docs/mvp-2026-11/sweeps/notion-move-facts.md` appeared mid-sweep and moved `is_inline` from 26 (16 files) to 34 (17 files).

## Occurrences

### 1. `claims_copy` (535 lines, 48 files)

- `tests/mvp/config.test.mjs` (17): 42, 307, 311, 323, 325, 366, 376, 391, 392, 410, 456, 476, 477, 482, 483, 485, 497
- `tests/mvp/editor-words.test.mjs` (1): 71
- `tests/mvp/distill.test.mjs` (6): 605, 608, 610, 829, 1046, 1105
- `tests/mvp/judge.test.mjs` (1): 86
- `tests/mvp/notion-build.test.mjs` (104): 56, 57, 58, 59, 74, 75, 248, 249, 259, 261, 277, 279, 281, 282, 283, 284, 285, 286, 305, 307, 310, 319, 334, 354, 414, 449, 451, 462, 471, 478, 490, 510, 523, 530, 540, 602, 639, 640, 734, 800, 866, 929, 952, 953, 983, 988, 996, 998, 1004, 1010, 1021, 1025, 1057, 1063, 1077, 1080, 1081, 1082, 1083, 1084, 1085, 1086, 1087, 1091, 1117, 1133, 1141, 1151, 1165, 1190, 1212, 1242, 1251, 1252, 1273, 1278, 1298, 1299, 1301, 1303, 1304, 1315, 1316, 1336, 1340, 1346, 1351, 1359, 1360, 1361, 1362, 1363, 1364, 1365, 1367, 1368, 1373, 1380, 1388, 1399, 1404, 1406, 1412, 1431
- `tests/mvp/guard.test.mjs` (2): 69, 97
- `tests/mvp/followup.test.mjs` (17): 69, 90, 163, 217, 234, 238, 240, 243, 252, 254, 255, 260, 265, 272, 298, 307, 308
- `tests/mvp/loop.test.mjs` (12): 105, 107, 124, 126, 127, 128, 129, 164, 191, 263, 267, 289
- `tests/mvp/helpers/tables.mjs` (1): 23
- `tests/mvp/helpers/loop-world.mjs` (5): 47, 153, 182, 276, 283
- `tests/mvp/pull.test.mjs` (29): 28, 58, 65, 66, 93, 95, 109, 110, 177, 178, 192, 201, 213, 215, 231, 350, 352, 365, 506, 507, 508, 513, 761, 766, 957, 965, 972, 1003, 1004
- `docs/mvp-2026-11/CLAIMS-REVIEW.md` (1): 35
- `tests/mvp/walkthrough.test.mjs` (69): 388, 393, 411, 429, 430, 431, 438, 747, 750, 754, 786, 964, 979, 980, 1030, 1035, 1042, 1055, 1063, 1069, 1088, 1140, 1149, 1154, 1175, 1176, 1177, 1179, 1198, 1220, 1254, 1298, 1323, 1508, 1596, 1883, 1953, 2056, 2161, 2192, 2202, 2358, 2652, 2687, 2729, 2782, 2788, 2790, 2798, 2829, 2870, 2881, 2936, 3014, 3256, 3272, 3291, 3293, 3315, 3375, 3390, 3393, 3429, 3434, 3435, 3442, 3588, 3780, 3945
- `tests/mvp/propose.test.mjs` (17): 223, 253, 261, 268, 315, 350, 355, 406, 417, 603, 613, 614, 658, 723, 764, 772, 773
- `docs/mvp-2026-11/DECISIONS.md` (1): 36
- `tests/mvp/status.test.mjs` (2): 80, 197
- `tests/mvp/propose-failures.test.mjs` (6): 141, 162, 163, 193, 199, 202
- `tests/mvp/setup.test.mjs` (45): 41, 218, 232, 264, 265, 267, 272, 290, 299, 300, 302, 307, 364, 485, 504, 551, 654, 657, 674, 681, 699, 715, 716, 739, 742, 758, 768, 806, 953, 964, 968, 988, 1015, 1029, 1033, 1039, 1046, 1047, 1048, 1049, 1070, 1071, 1089, 1100, 1107
- `docs/mvp-2026-11/CONTRACTS.md` (8): 41, 56, 70, 131, 212, 228, 237, 264
- `tests/mvp/promote.test.mjs` (1): 123
- `tests/mvp/schemas.test.mjs` (3): 39, 59, 253
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (4): 22, 34, 56, 72
- `tests/mvp/plan.test.mjs` (50): 31, 53, 66, 67, 76, 98, 183, 188, 209, 210, 216, 217, 229, 242, 243, 244, 257, 258, 261, 282, 283, 288, 292, 296, 297, 312, 319, 333, 343, 377, 378, 381, 490, 538, 553, 555, 574, 581, 584, 586, 590, 591, 593, 605, 693, 694, 788, 789, 822, 841
- `docs/mvp-2026-11/WORKLOG.md` (1): 108
- `agents/claim-tagger-mvp/setup/structure.json` (4): 134, 597, 618, 639
- `agents/claim-tagger-mvp/scripts/walkthrough.mjs` (27): 418, 422, 423, 430, 802, 805, 936, 937, 942, 943, 946, 947, 1125, 1128, 1132, 1135, 1139, 1253, 1255, 1578, 1598, 1940, 1963, 1964, 1975, 1979, 1980
- `docs/mvp-2026-11/READ-DECISIONS.md` (1): 56
- `docs/mvp-2026-11/report/data/counts.json` (2): 6, 98
- `agents/claim-tagger-mvp/scripts/status.mjs` (1): 255
- `agents/claim-tagger-mvp/scripts/pull.mjs` (12): 9, 58, 66, 69, 456, 551, 577, 578, 582, 584, 825, 925
- `agents/claim-tagger-mvp/scripts/propose.mjs` (3): 229, 255, 363
- `agents/claim-tagger-mvp/scripts/promote.mjs` (1): 270
- `tests/mvp/fixtures/structure.21-oct.json` (4): 134, 561, 582, 603
- `tests/mvp/fixtures/structure.16-oct.json` (4): 134, 518, 536, 551
- `tests/mvp/fixtures/config.placeholder.json` (2): 23, 115
- `agents/claim-tagger-mvp/scripts/hooks/guard.mjs` (1): 96
- `agents/claim-tagger-mvp/scripts/followup.mjs` (3): 105, 144, 167
- `agents/claim-tagger-mvp/scripts/distill.mjs` (3): 439, 451, 577
- `agents/claim-tagger-mvp/config.json` (2): 23, 145
- `agents/claim-tagger-mvp/AGENT.md` (1): 91
- `agents/claim-tagger-mvp/schemas/plan.schema.json` (1): 10
- `agents/claim-tagger-mvp/scripts/lib/demo-profile.mjs` (6): 48, 55, 59, 60, 67, 322
- `agents/claim-tagger-mvp/scripts/lib/plan.mjs` (6): 14, 44, 48, 248, 313, 315
- `agents/claim-tagger-mvp/scripts/lib/notion-build.mjs` (3): 7, 71, 109
- `agents/claim-tagger-mvp/scripts/lib/config.mjs` (16): 7, 14, 34, 49, 224, 228, 229, 232, 235, 239, 332, 342, 375, 397, 398, 400
- `agents/claim-tagger-mvp/scripts/lib/setup-steps.mjs` (24): 492, 494, 502, 595, 596, 606, 621, 782, 783, 784, 785, 788, 789, 790, 791, 792, 799, 803, 831, 832, 835, 842, 847, 848
- `agents/claim-tagger-mvp/scripts/lib/loop.mjs` (3): 262, 336, 338
- `agents/claim-tagger-mvp/scripts/lib/editor-words.mjs` (2): 16, 107

### 2a. `Claims copy` (179 lines, 40 files)

- `agents/claim-tagger-mvp/setup/structure.json` (2): 135, 397
- `agents/claim-tagger-mvp/scripts/status.mjs` (2): 22, 23
- `agents/claim-tagger-mvp/scripts/setup.mjs` (2): 23, 25
- `tests/mvp/notion-build.test.mjs` (11): 39, 151, 256, 258, 530, 906, 1023, 1025, 1083, 1110, 1173
- `tests/mvp/editor-words.test.mjs` (1): 84
- `agents/claim-tagger-mvp/scripts/pull.mjs` (2): 21, 898
- `docs/mvp-2026-11/WORKLOG.md` (5): 98, 170, 178, 202, 226
- `tests/mvp/status.test.mjs` (3): 19, 80, 197
- `tests/mvp/followup.test.mjs` (2): 69, 268
- `agents/claim-tagger-mvp/scripts/propose.mjs` (1): 2
- `agents/claim-tagger-mvp/config.json` (1): 24
- `tests/mvp/pull.test.mjs` (2): 951, 990
- `docs/mvp-2026-11/VERIFICATION.md` (1): 10
- `agents/claim-tagger-mvp/AGENT.md` (14): 16, 23, 24, 25, 31, 41, 42, 43, 46, 91, 96, 104, 154, 155
- `tests/mvp/fixtures/config.placeholder.json` (1): 24
- `tests/mvp/propose.test.mjs` (5): 212, 223, 230, 344, 417
- `tests/mvp/setup.test.mjs` (11): 167, 232, 577, 589, 627, 676, 683, 1048, 1049, 1070, 1071
- `agents/claim-tagger-mvp/scripts/followup.mjs` (1): 15
- `docs/mvp-2026-11/DECISIONS.md` (4): 14, 19, 26, 75
- `tests/mvp/fixtures/structure.21-oct.json` (2): 135, 389
- `docs/mvp-2026-11/CLAIMS-REVIEW.md` (3): 7, 10, 33
- `tests/mvp/fixtures/structure.16-oct.json` (2): 135, 346
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (3): 7, 56, 185
- `tests/mvp/helpers/loop-world.mjs` (3): 11, 12, 138
- `docs/mvp-2026-11/STRUCTURE.md` (14): 13, 62, 66, 67, 68, 76, 88, 151, 155, 156, 157, 175, 224, 278
- `docs/mvp-2026-11/CONTRACTS.md` (17): 41, 70, 119, 125, 152, 173, 175, 176, 177, 178, 179, 187, 203, 204, 229, 262, 264
- `docs/mvp-2026-11/STATE.md` (1): 11
- `docs/mvp-2026-11/STRUCTURE.notion.md` (3): 17, 183, 365
- `tests/mvp/helpers/tables.mjs` (1): 5
- `agents/claim-tagger-mvp/schemas/claim-row.schema.json` (2): 3, 4
- `agents/claim-tagger-mvp/scripts/lib/editor-words.mjs` (1): 17
- `agents/claim-tagger-mvp/scripts/lib/demo-profile.mjs` (1): 67
- `agents/claim-tagger-mvp/scripts/lib/config.mjs` (6): 43, 49, 52, 58, 63, 221
- `docs/mvp-2026-11/report/data/counts.json` (2): 10, 222
- `docs/mvp-2026-11/report/claim-tagger-mvp.html` (15): 831, 885, 890, 891, 892, 901, 910, 984, 989, 990, 991, 1011, 1064, 1065, 1118
- `docs/mvp-2026-11/report/parts/04-structure.html` (15): 12, 66, 71, 72, 73, 82, 91, 165, 170, 171, 172, 192, 245, 246, 299
- `agents/claim-tagger-mvp/scripts/lib/setup-steps.mjs` (9): 1, 17, 55, 199, 488, 614, 788, 789, 790
- `agents/claim-tagger-mvp/scripts/lib/loop.mjs` (3): 262, 319, 323
- `agents/claim-tagger-mvp/scripts/hooks/guard.mjs` (1): 36
- `agents/claim-tagger-mvp/scripts/lib/notion-build.mjs` (4): 32, 34, 40, 71

### 2b. `Rulebook copy` (257 lines, 63 files)

- `CLAUDE.md` (3): 17, 18, 23
- `tests/mvp/fake-notion.test.mjs` (3): 722, 734, 738
- `tests/mvp/judge.test.mjs` (4): 52, 1370, 1467, 1473
- `docs/mvp-2026-11/WORKLOG.md` (2): 98, 124
- `tests/mvp/helpers/tables.mjs` (1): 5
- `agents/claim-tagger-mvp/setup/structure.json` (4): 4, 147, 177, 202
- `docs/mvp-2026-11/VERIFICATION.md` (1): 10
- `tests/mvp/helpers/loop-world.mjs` (2): 129, 188
- `tests/mvp/plan.test.mjs` (1): 570
- `tests/mvp/notion-build.test.mjs` (17): 39, 66, 135, 144, 149, 152, 153, 251, 292, 414, 452, 660, 676, 906, 907, 1069, 1094
- `tests/mvp/promote.test.mjs` (3): 84, 142, 517
- `tests/mvp/propose.test.mjs` (3): 174, 187, 230
- `tests/mvp/pull.test.mjs` (4): 66, 254, 951, 956
- `tests/mvp/rubric.test.mjs` (4): 403, 410, 444, 457
- `tests/mvp/rollback.test.mjs` (2): 73, 165
- `docs/mvp-2026-11/sweeps/W3-digest.md` (2): 11, 163
- `tests/mvp/setup.test.mjs` (10): 158, 172, 237, 323, 341, 761, 767, 799, 821, 1024
- `tests/mvp/restore.test.mjs` (1): 84
- `tests/mvp/walkthrough.test.mjs` (1): 405
- `docs/mvp-2026-11/DECISIONS.md` (2): 14, 19
- `docs/mvp-2026-11/STRUCTURE.notion.md` (8): 12, 41, 341, 482, 501, 614, 712, 721
- `docs/mvp-2026-11/CONTRACTS.md` (9): 99, 119, 152, 167, 173, 178, 191, 195, 207
- `docs/mvp-2026-11/STRUCTURE.md` (15): 17, 21, 24, 70, 93, 97, 101, 174, 186, 274, 308, 315, 345, 381, 387
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (1): 56
- `docs/mvp-2026-11/BACKLOG.md` (1): 16
- `docs/mvp-2026-11/STATE.md` (1): 11
- `docs/mvp-2026-11/CLAIMS-REVIEW.md` (4): 7, 9, 10, 25
- `docs/mvp-2026-11/report/data/counts.json` (2): 10, 18
- `docs/mvp-2026-11/report/claim-tagger-mvp.html` (17): 836, 840, 843, 894, 916, 920, 924, 1010, 1024, 1025, 1114, 1150, 1157, 1192, 1231, 1240, 1270
- `docs/mvp-2026-11/report/parts/04-structure.html` (16): 17, 21, 24, 75, 97, 101, 105, 191, 205, 206, 295, 331, 338, 373, 412, 421
- `agents/claim-tagger-mvp/scripts/setup.mjs` (1): 24
- `docs/mvp-2026-11/report/parts/05-backlog.html` (1): 18
- `agents/claim-tagger-mvp/scripts/rollback.mjs` (5): 9, 93, 97, 104, 110
- `agents/claim-tagger-mvp/scripts/restore.mjs` (7): 2, 10, 14, 119, 150, 157, 161
- `agents/claim-tagger-mvp/scripts/pull.mjs` (4): 20, 312, 380, 615
- `agents/claim-tagger-mvp/scripts/propose.mjs` (5): 19, 25, 164, 180, 186
- `agents/claim-tagger-mvp/scripts/promote.mjs` (5): 19, 475, 479, 486, 493
- `agents/claim-tagger-mvp/scripts/judge.mjs` (1): 861
- `docs/analysis-2026-10/report/review-readability.md` (3): 267, 275, 362
- `agents/claim-tagger-mvp/AGENT.md` (9): 7, 15, 29, 45, 91, 95, 154, 183, 189
- `agents/claim-tagger-mvp/schemas/claim-row.schema.json` (4): 4, 18, 20, 26
- `agents/claim-tagger-mvp/scripts/lib/config.mjs` (1): 37
- `agents/claim-tagger-mvp/schemas/rubric.schema.json` (2): 4, 12
- `agents/claim-tagger-mvp/scripts/lib/loop.mjs` (9): 19, 22, 262, 451, 452, 453, 462, 583, 584
- `tests/mvp/fixtures/structure.21-oct.json` (4): 4, 147, 177, 196
- `tests/mvp/fixtures/structure.16-oct.json` (2): 4, 255
- `agents/claim-tagger-mvp/scripts/lib/notion-build.mjs` (6): 71, 100, 209, 244, 247, 402
- `agents/claim-tagger-mvp/scripts/lib/preflight.mjs` (1): 9
- `agents/claim-tagger-mvp/scripts/lib/setup-steps.mjs` (11): 1, 147, 477, 525, 562, 656, 663, 721, 765, 769, 779
- `agents/claim-tagger-mvp/scripts/lib/rulebook-edit.mjs` (2): 7, 89
- `agents/claim-tagger-mvp/scripts/lib/rubric.mjs` (5): 1, 20, 132, 195, 349
- `docs/analysis-2026-10/design/P1-architecture.md` (1): 119
- `docs/analysis-2026-10/report/parts/fragments/stage-plan-figure.html` (1): 107
- `docs/analysis-2026-10/report/CHANGES-ROUND-1.md` (1): 32
- `docs/analysis-2026-10/debate/dispositions.md` (1): 9
- `docs/analysis-2026-10/report/claim-tagger-analysis.html` (7): 1414, 1468, 1501, 1838, 1878, 2550, 3009
- `docs/analysis-2026-10/design/W3-code-changes.md` (1): 451
- `docs/analysis-2026-10/report/parts/fragments/notion-map-figure.html` (4): 2, 3, 7, 61
- `docs/analysis-2026-10/report/parts/05-versions.html` (3): 38, 250, 290
- `docs/analysis-2026-10/report/parts/fragments/minimal-loop-figure.html` (2): 5, 60
- `docs/analysis-2026-10/report/parts/09-glossary.html` (1): 13
- `docs/mvp-2026-10/plan.md` (1): 207
- `docs/analysis-2026-10/debate/inputs/report-plain.md` (2): 122, 352

### 3. `demo_claims` (5 lines, 4 files)

- `tests/mvp/walkthrough.test.mjs` (1): 368
- `docs/mvp-2026-11/sweeps/W3-digest.md` (2): 102, 311
- `agents/claim-tagger-mvp/scripts/lib/demo-profile.mjs` (1): 307
- `docs/analysis-2026-10/design/W3-code-changes.md` (1): 155

### 4a. `Demo tests` (71 lines, 32 files)

- `CLAUDE.md` (1): 14
- `tests/mvp/walkthrough.test.mjs` (9): 105, 115, 2350, 2369, 2407, 2421, 2440, 2446, 2456
- `docs/mvp-2026-11/WORKLOG.md` (12): 10, 98, 134, 142, 186, 220, 230, 234, 236, 242, 244, 250
- `tests/mvp/setup.test.mjs` (1): 215
- `tests/mvp/report.test.mjs` (1): 314
- `agents/claim-tagger-mvp/setup/structure.json` (1): 726
- `docs/mvp-2026-11/sweeps/W4-digest.md` (3): 700, 702, 1032
- `tests/mvp/notion-build.test.mjs` (3): 42, 214, 429
- `docs/analysis-2026-10/DECISIONS.md` (1): 42
- `agents/claim-tagger-mvp/AGENT.md` (4): 31, 58, 91, 196
- `agents/claim-tagger-mvp/scripts/walkthrough.mjs` (2): 35, 247
- `docs/mvp-2026-11/STRUCTURE.notion.md` (1): 40
- `.claude/skills/claim-tagger/SKILL.md` (1): 36
- `docs/mvp-2026-11/STRUCTURE.md` (1): 184
- `docs/mvp-2026-11/STATE.md` (2): 11, 23
- `tests/mvp/fixtures/structure.16-oct.json` (1): 627
- `tests/mvp/fixtures/structure.21-oct.json` (1): 682
- `.claude/skills/claim-tagger-walkthrough/SKILL.md` (1): 33
- `.claude/skills/claim-tagger-walkthrough-workspace/pending/practice-page-for-new-editor/without_skill/paused-attempt/final-message.md` (1): 7
- `.claude/skills/claim-tagger-walkthrough-workspace/pending/practice-page-for-new-editor/eval_metadata.json` (1): 6
- `docs/mvp-2026-11/report/parts/04-structure.html` (1): 202
- `.claude/skills/claim-tagger-walkthrough/references/troubleshooting.md` (2): 18, 19
- `.claude/skills/claim-tagger-walkthrough/evals/evals.json` (2): 8, 11
- `.claude/skills/claim-tagger-walkthrough-workspace/grade.py` (1): 154
- `docs/mvp-2026-11/READ-DECISIONS.md` (1): 81
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (6): 7, 24, 26, 56, 95, 185
- `agents/claim-tagger-mvp/scripts/lib/notion-build.mjs` (1): 8
- `.claude/skills/claim-tagger-walkthrough-workspace/iteration-1/eval-4/without_skill/run-1/outputs/final-message.md` (1): 7
- `agents/claim-tagger-mvp/scripts/lib/demo-profile.mjs` (1): 711
- `docs/mvp-2026-11/DECISIONS.md` (4): 38, 40, 52, 78
- `docs/mvp-2026-11/report/claim-tagger-mvp.html` (1): 1021
- `.claude/skills/claim-tagger-walkthrough-workspace/iteration-1/eval-2/without_skill/run-1/outputs/final-message.md` (2): 1, 6

### 4b. `demo_tests` (20 lines, 10 files)

- `docs/mvp-2026-11/CONTRACTS.md` (1): 39
- `tests/mvp/config.test.mjs` (3): 50, 65, 75
- `tests/mvp/walkthrough.test.mjs` (3): 105, 117, 363
- `tests/mvp/setup.test.mjs` (1): 215
- `tests/mvp/notion-build.test.mjs` (6): 214, 216, 430, 487, 506, 653
- `agents/claim-tagger-mvp/scripts/lib/notion-build.mjs` (2): 43, 97
- `agents/claim-tagger-mvp/config.json` (1): 13
- `agents/claim-tagger-mvp/scripts/lib/demo-profile.mjs` (1): 304
- `agents/claim-tagger-mvp/scripts/lib/config.mjs` (1): 162
- `tests/mvp/fixtures/config.placeholder.json` (1): 13

### 5. `Demos` (whole word), `pages.demos`, `demos:`

#### 5a. `Demos` (99 lines, 33 files)

- `CLAUDE.md` (1): 14
- `agents/claim-tagger-mvp/walkthrough/page.md` (1): 2
- `agents/claim-tagger-mvp/AGENT.md` (4): 31, 58, 91, 196
- `docs/mvp-2026-11/WORKLOG.md` (10): 10, 98, 130, 134, 138, 178, 186, 222, 226, 250
- `agents/claim-tagger-mvp/setup/structure.json` (1): 725
- `tests/mvp/fixtures/structure.21-oct.json` (1): 681
- `agents/claim-tagger-mvp/scripts/walkthrough.mjs` (4): 34, 246, 1709, 1746
- `tests/mvp/fixtures/structure.16-oct.json` (1): 626
- `.claude/skills/claim-tagger-walkthrough-workspace/pending/practice-page-for-new-editor/without_skill/paused-attempt/final-message.md` (1): 7
- `docs/mvp-2026-11/STRUCTURE.notion.md` (2): 39, 724
- `docs/mvp-2026-11/STRUCTURE.md` (2): 183, 390
- `docs/mvp-2026-11/STATE.md` (2): 11, 23
- `docs/mvp-2026-11/DECISIONS.md` (3): 40, 52, 78
- `tests/mvp/notion-build.test.mjs` (7): 42, 180, 214, 429, 648, 691, 912
- `docs/mvp-2026-11/BACKLOG.md` (1): 28
- `tests/mvp/walkthrough.test.mjs` (25): 104, 114, 125, 191, 469, 479, 480, 481, 482, 483, 950, 957, 1629, 2304, 2342, 2380, 2386, 2407, 2422, 2446, 2454, 2459, 2465, 2712, 2980
- `docs/mvp-2026-11/EDITOR-HANDOVER.md` (1): 20
- `tests/mvp/setup.test.mjs` (1): 215
- `docs/mvp-2026-11/READ-DECISIONS.md` (2): 73, 77
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (5): 7, 26, 56, 95, 185
- `docs/mvp-2026-11/report/data/counts.json` (1): 162
- `agents/claim-tagger-mvp/scripts/lib/notion-build.mjs` (1): 8
- `docs/mvp-2026-11/report/claim-tagger-mvp.html` (4): 741, 1020, 1243, 1282
- `agents/claim-tagger-mvp/scripts/lib/demo-profile.mjs` (5): 27, 709, 712, 721, 723
- `docs/mvp-2026-11/report/parts/05-backlog.html` (1): 30
- `docs/mvp-2026-11/report/parts/04-structure.html` (2): 201, 424
- `docs/mvp-2026-11/report/parts/03-how-to-run.html` (1): 17
- `.claude/skills/claim-tagger-walkthrough-workspace/iteration-1/eval-4/without_skill/run-1/outputs/final-message.md` (1): 7
- `.claude/skills/claim-tagger-walkthrough/SKILL.md` (2): 33, 37
- `.claude/skills/claim-tagger-walkthrough/references/manifest.md` (1): 23
- `.claude/skills/claim-tagger-walkthrough/references/troubleshooting.md` (3): 18, 19, 20
- `.claude/skills/claim-tagger/SKILL.md` (1): 36
- `.claude/skills/claim-tagger-walkthrough-workspace/iteration-1/eval-2/with_skill/run-1/outputs/notes.md` (1): 9

#### 5b. `pages.demos` (17 lines, 7 files)

- `tests/mvp/config.test.mjs` (2): 64, 75
- `tests/mvp/notion-build.test.mjs` (6): 486, 489, 511, 584, 651, 652
- `tests/mvp/walkthrough.test.mjs` (4): 104, 116, 1377, 2460
- `tests/mvp/setup.test.mjs` (1): 215
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (1): 79
- `agents/claim-tagger-mvp/AGENT.md` (1): 58
- `agents/claim-tagger-mvp/scripts/lib/demo-profile.mjs` (2): 710, 721

#### 5c. `demos:` (4 lines, 3 files)

- `tests/mvp/walkthrough.test.mjs` (2): 363, 2758
- `agents/claim-tagger-mvp/scripts/lib/demo-profile.mjs` (1): 304
- `agents/claim-tagger-mvp/scripts/lib/notion-build.mjs` (1): 96

### 6. `Feedback Distillation MVP` (24 lines, 19 files)

- `README.md` (2): 7, 14
- `CLAUDE.md` (1): 23
- `tests/mvp/helpers/setup-world.mjs` (1): 96
- `docs/mvp-2026-11/EDITOR-HANDOVER.md` (1): 3
- `docs/mvp-2026-11/DECISIONS.md` (1): 40
- `docs/mvp-2026-11/WORKLOG.md` (1): 26
- `docs/mvp-2026-11/STATE.md` (1): 10
- `agents/claim-tagger-mvp/AGENT.md` (2): 11, 90
- `.claude/skills/claim-tagger/SKILL.md` (1): 3
- `docs/mvp-2026-11/report/parts/04-structure.html` (1): 5
- `docs/mvp-2026-11/sweeps/orientation-digest.md` (2): 7, 167
- `docs/mvp-2026-11/report/parts/02-status.html` (1): 20
- `docs/mvp-2026-11/report/claim-tagger-mvp.html` (2): 662, 824
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (2): 26, 56
- `docs/mvp-2026-11/STRUCTURE.md` (1): 3
- `docs/mvp-2026-11/STRUCTURE.notion.md` (1): 1
- `docs/analysis-2026-10/WORKLOG.md` (1): 87
- `docs/analysis-2026-10/DECISIONS.md` (1): 40
- `.claude/skills/claim-tagger-walkthrough-workspace/iteration-1/eval-3/without_skill/run-1/outputs/final-message.md` (1): 3

### 7. `D31` (34 lines, 15 files) and `decision 31` (4 lines, 2 files)

#### 7a. `D31`

- `CLAUDE.md` (1): 14
- `docs/mvp-2026-11/WORKLOG.md` (6): 42, 118, 130, 138, 226, 258
- `docs/mvp-2026-11/CLAIMS-REVIEW.md` (1): 35
- `tests/mvp/walkthrough.test.mjs` (5): 2628, 2860, 2861, 2867, 3067
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (4): 7, 24, 56, 184
- `docs/mvp-2026-11/DECISIONS.md` (3): 38, 52, 59
- `agents/claim-tagger-mvp/AGENT.md` (1): 155
- `docs/mvp-2026-11/CONTRACTS.md` (1): 131
- `docs/mvp-2026-11/READ-DECISIONS.md` (1): 81
- `agents/claim-tagger-mvp/scripts/walkthrough.mjs` (4): 49, 972, 1831, 1840
- `docs/mvp-2026-11/report/claim-tagger-mvp.html` (1): 173
- `agents/claim-tagger-mvp/scripts/lib/plan.mjs` (3): 47, 247, 263
- `docs/mvp-2026-10/report/editor-feedback-loop-mvp.html` (1): 173
- `docs/analysis-2026-10/DECISIONS.md` (1): 42
- `docs/analysis-2026-10/report/claim-tagger-analysis.html` (1): 173

#### 7b. `decision 31`

- `docs/mvp-2026-11/WORKLOG.md` (3): 118, 130, 138
- `docs/mvp-2026-11/CONTRACTS.md` (1): 131

### 8. `demoEditor` (40 lines, 8 files) and `DEMO_EDITOR` (3 lines, 2 files)

#### 8a. `demoEditor`

- `tests/mvp/walkthrough.test.mjs` (15): 2719, 2721, 2748, 2755, 2756, 2757, 2760, 2761, 2767, 2773, 2775, 2801, 2812, 2813, 2815
- `agents/claim-tagger-mvp/scripts/walkthrough.mjs` (5): 55, 1836, 1881, 1889, 1896
- `tests/mvp/plan.test.mjs` (6): 326, 336, 338, 341, 344, 347
- `docs/mvp-2026-11/DECISIONS.md` (1): 59
- `docs/mvp-2026-11/CONTRACTS.md` (1): 131
- `agents/claim-tagger-mvp/scripts/lib/plan.mjs` (8): 5, 7, 247, 253, 263, 448, 452, 461
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (3): 56, 77, 82
- `agents/claim-tagger-mvp/AGENT.md` (1): 155

#### 8b. `DEMO_EDITOR` (3 lines, 2 files)

- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (1): 77
- `agents/claim-tagger-mvp/scripts/lib/plan.mjs` (2): 48, 316

### 9. Walkthrough command terms

#### 9a. `walkthrough.mjs decide|approve|reject` (14 lines, 6 files)

- `docs/mvp-2026-11/DECISIONS.md` (3): 38, 59, 62
- `docs/mvp-2026-11/CLAIMS-REVIEW.md` (1): 40
- `.claude/skills/claim-tagger-walkthrough/references/manifest.md` (2): 12, 23
- `agents/claim-tagger-mvp/scripts/walkthrough.mjs` (6): 11, 12, 13, 88, 89, 90
- `agents/claim-tagger-mvp/AGENT.md` (1): 155
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (1): 24

#### 9b. `decideCommand`, `approveCommand`, `rejectCommand` (6 lines, 1 file)

- `agents/claim-tagger-mvp/scripts/walkthrough.mjs` (6): 1931, 2062, 2063, 2101, 2102, 2103

#### 9c. decide / approve / reject in `agents/claim-tagger-mvp/scripts/walkthrough.mjs` (60 lines; substring matches, so "decided" counts)

- `agents/claim-tagger-mvp/scripts/walkthrough.mjs` (60): 3, 11, 12, 13, 20, 22, 44, 49, 50, 53, 54, 88, 89, 90, 164, 167, 409, 410, 412, 413, 926, 1136, 1138, 1156, 1165, 1166, 1167, 1190, 1193, 1194, 1197, 1198, 1199, 1201, 1205, 1212, 1579, 1582, 1834, 1931, 1937, 1944, 1946, 1948, 1953, 1954, 1955, 1959, 1960, 1961, 1970, 1979, 1980, 2016, 2029, 2062, 2063, 2101, 2102, 2103

#### 9d. decide / approve / reject in `tests/mvp/walkthrough.test.mjs` (220 lines; substring matches)

- `tests/mvp/walkthrough.test.mjs` (220): 170, 180, 182, 289, 290, 291, 308, 310, 345, 504, 505, 523, 589, 590, 591, 592, 593, 606, 612, 617, 620, 623, 638, 640, 641, 644, 671, 673, 680, 748, 751, 785, 859, 887, 1128, 1137, 1150, 1155, 1178, 1184, 1190, 1193, 1223, 1236, 1470, 1474, 1872, 1878, 1886, 1890, 1893, 1898, 1929, 1948, 1960, 1964, 1965, 1966, 2012, 2060, 2090, 2092, 2093, 2096, 2098, 2099, 2100, 2102, 2104, 2105, 2116, 2121, 2149, 2179, 2197, 2222, 2225, 2265, 2296, 2361, 2426, 2435, 2449, 2451, 2462, 2523, 2630, 2703, 2704, 2706, 2811, 2812, 2813, 2815, 2819, 2837, 2858, 2870, 2885, 2892, 2897, 2901, 2902, 2912, 2919, 2929, 2933, 2940, 2945, 2946, 2947, 2952, 2968, 2978, 2986, 2993, 3001, 3006, 3019, 3032, 3048, 3053, 3057, 3065, 3070, 3073, 3081, 3087, 3089, 3094, 3099, 3100, 3101, 3103, 3104, 3106, 3109, 3113, 3115, 3116, 3118, 3124, 3126, 3128, 3130, 3131, 3133, 3134, 3136, 3137, 3142, 3146, 3150, 3154, 3155, 3164, 3167, 3170, 3175, 3176, 3177, 3180, 3185, 3200, 3219, 3227, 3242, 3249, 3253, 3254, 3256, 3368, 3397, 3411, 3419, 3457, 3603, 3605, 3609, 3655, 3672, 3704, 3713, 3738, 3744, 3771, 3783, 3797, 3803, 3806, 3809, 3810, 3816, 3854, 3855, 3890, 3891, 3932, 3953, 3954, 3987, 3998, 4004, 4006, 4007, 4015, 4025, 4027, 4029, 4032, 4033, 4043, 4049, 4050, 4059, 4065, 4066, 4076, 4078, 4079

### 10. `CLAIMS_COPY_COLUMNS` (18 lines, 7 files)

- `tests/mvp/walkthrough.test.mjs` (4): 13, 413, 745, 3311
- `tests/mvp/setup.test.mjs` (3): 5, 482, 490
- `agents/claim-tagger-mvp/scripts/walkthrough.mjs` (3): 65, 1132, 1148
- `tests/mvp/config.test.mjs` (2): 7, 377
- `agents/claim-tagger-mvp/scripts/lib/setup-steps.mjs` (2): 26, 143
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (1): 144
- `agents/claim-tagger-mvp/scripts/lib/config.mjs` (3): 20, 44, 401

### 11. `is_inline` and `isInline`

#### 11a. `is_inline` (34 lines, 17 files)

- `tests/mvp/fake-notion.test.mjs` (2): 723, 736
- `tests/fixtures/notion/db.tag_decisions.json` (1): 26
- `docs/mvp-2026-11/sweeps/notion-move-facts.md` (8): 30, 32, 35, 36, 39, 70, 112, 114
- `tests/fixtures/notion/db.runs.json` (1): 26
- `docs/mvp-2026-11/sweeps/notion-api-2026-03-11.md` (1): 7
- `tests/fixtures/notion/db.rule_changes.json` (1): 26
- `tests/fixtures/notion/db.rulebook.json` (1): 26
- `tests/fixtures/notion/db.claims.json` (1): 26
- `tests/fixtures/notion/db.agent_settings.json` (1): 26
- `tests/mvp/walkthrough.test.mjs` (1): 976
- `agents/claim-tagger-mvp/scripts/walkthrough.mjs` (1): 362
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (2): 146, 158
- `tests/mvp/notion-rest.test.mjs` (5): 95, 96, 117, 127, 129
- `tests/mvp/notion-build.test.mjs` (3): 220, 223, 442
- `tests/mvp/fixtures/fake-notion.mjs` (3): 259, 430, 778
- `agents/claim-tagger-mvp/scripts/lib/notion-build.mjs` (1): 568
- `agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs` (1): 376

#### 11b. `isInline` (13 lines, 8 files)

- `docs/analysis-2026-10/design/W3-code-changes.md` (1): 208
- `docs/analysis-2026-10/design/P2-walkthrough-reporting-artifact-debate.md` (1): 71
- `docs/analysis-2026-10/design/P1-architecture.md` (1): 273
- `agents/claim-tagger-mvp/scripts/walkthrough.mjs` (1): 612
- `tests/mvp/notion-rest.test.mjs` (1): 103
- `tests/mvp/fixtures/fake-notion.mjs` (4): 252, 259, 778, 1116
- `agents/claim-tagger-mvp/scripts/lib/notion-build.mjs` (1): 786
- `agents/claim-tagger-mvp/scripts/lib/notion-rest.mjs` (3): 366, 370, 376

### 12. `real_claims`, `pickClaims`, `--pick`

#### 12a. `real_claims` (43 lines, 11 files)

- `agents/claim-tagger-mvp/config.json` (1): 74
- `tests/mvp/config.test.mjs` (3): 168, 169, 193
- `agents/claim-tagger-mvp/AGENT.md` (1): 74
- `tests/mvp/fixtures/config.placeholder.json` (1): 74
- `tests/mvp/walkthrough.test.mjs` (1): 1367
- `tests/mvp/pull.test.mjs` (19): 579, 660, 669, 697, 712, 713, 715, 718, 744, 771, 794, 795, 803, 807, 911, 914, 922, 924, 937
- `agents/claim-tagger-mvp/scripts/pull.mjs` (12): 6, 7, 59, 60, 701, 808, 814, 815, 924, 991, 994, 995
- `docs/mvp-2026-11/CONTRACTS.md` (2): 51, 99
- `.claude/skills/claim-tagger-walkthrough-workspace/iteration-1/eval-3/without_skill/run-1/outputs/notes.md` (1): 4
- `agents/claim-tagger-mvp/scripts/lib/config.mjs` (1): 188
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (1): 135

#### 12b. `pickClaims` (4 lines, 2 files)

- `tests/mvp/pull.test.mjs` (2): 12, 932
- `agents/claim-tagger-mvp/scripts/pull.mjs` (2): 901, 1015

#### 12c. `--pick` (17 lines, 4 files)

- `agents/claim-tagger-mvp/AGENT.md` (1): 74
- `tests/mvp/pull.test.mjs` (7): 807, 911, 914, 922, 923, 924, 926
- `agents/claim-tagger-mvp/scripts/pull.mjs` (7): 7, 35, 60, 905, 941, 991, 995
- `docs/mvp-2026-11/HUB-AND-GEO-CLAIMS.md` (2): 135, 184

## Files by area

- **scripts/lib:** `agents/claim-tagger-mvp/scripts/lib/` demo-profile.mjs, plan.mjs, notion-build.mjs, config.mjs, setup-steps.mjs, loop.mjs, editor-words.mjs, rulebook-edit.mjs, rubric.mjs, preflight.mjs, notion-rest.mjs
- **scripts:** `agents/claim-tagger-mvp/scripts/` walkthrough.mjs, status.mjs, setup.mjs, pull.mjs, propose.mjs, promote.mjs, followup.mjs, distill.mjs, rollback.mjs, restore.mjs, judge.mjs; `scripts/hooks/guard.mjs`
- **schemas+setup+config:** `agents/claim-tagger-mvp/config.json`, `setup/structure.json`, `schemas/` plan.schema.json, claim-row.schema.json, rubric.schema.json
- **tests:** `tests/mvp/` walkthrough, setup, notion-build, config, editor-words, distill, judge, guard, followup, loop, pull, propose, propose-failures, status, promote, schemas, plan, fake-notion, rubric, rollback, restore, report, notion-rest (.test.mjs); `helpers/` tables.mjs, loop-world.mjs, setup-world.mjs; `fixtures/` config.placeholder.json, structure.21-oct.json, structure.16-oct.json, fake-notion.mjs; `tests/fixtures/notion/` db.tag_decisions, db.runs, db.rule_changes, db.rulebook, db.claims, db.agent_settings (.json)
- **skills (.claude):** `.claude/skills/claim-tagger/SKILL.md`; `claim-tagger-walkthrough/` SKILL.md, references/manifest.md, references/troubleshooting.md, evals/evals.json; `claim-tagger-walkthrough-workspace/` grade.py, pending/practice-page-for-new-editor/ (without_skill/paused-attempt/final-message.md, eval_metadata.json), iteration-1/eval-2 (without_skill final-message.md, with_skill notes.md), iteration-1/eval-3 (without_skill final-message.md, notes.md), iteration-1/eval-4 (without_skill final-message.md)
- **docs:** `docs/mvp-2026-11/` WORKLOG.md, VERIFICATION.md, DECISIONS.md, READ-DECISIONS.md, HUB-AND-GEO-CLAIMS.md, CONTRACTS.md, CLAIMS-REVIEW.md, STRUCTURE.md, STRUCTURE.notion.md, STATE.md, BACKLOG.md, EDITOR-HANDOVER.md; `report/` claim-tagger-mvp.html, data/counts.json, parts/02-status.html, 03-how-to-run.html, 04-structure.html, 05-backlog.html; `sweeps/` W3-digest.md, W4-digest.md, orientation-digest.md, notion-api-2026-03-11.md, notion-move-facts.md. `docs/analysis-2026-10/` DECISIONS.md, WORKLOG.md, design/W3-code-changes.md, design/P1-architecture.md, design/P2-walkthrough-reporting-artifact-debate.md, report/review-readability.md, report/CHANGES-ROUND-1.md, report/claim-tagger-analysis.html, report/parts/05-versions.html, report/parts/09-glossary.html, report/parts/fragments/ (stage-plan-figure.html, notion-map-figure.html, minimal-loop-figure.html), debate/dispositions.md, debate/inputs/report-plain.md. `docs/mvp-2026-10/` plan.md, report/editor-feedback-loop-mvp.html
- **other:** `CLAUDE.md`, `README.md`, `agents/claim-tagger-mvp/AGENT.md`, `agents/claim-tagger-mvp/walkthrough/page.md`

