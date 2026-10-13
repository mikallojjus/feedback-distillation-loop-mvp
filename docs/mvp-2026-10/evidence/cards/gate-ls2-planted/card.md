Verdict: FAIL - small sample: a gated tag has under 30 labelled positives, read the numbers and not only the word
Canaries: 83/83 pass under the candidate; baseline 83/83
Cases newly failing: 1 (ctr-ef04483dc87e-hypoth) of 27 active; newly passing 0; rule changed 8
Target Context-dependent: 0.0 points (95% CI 0.0 to 0.0), fixed 0, broken 0, n 11, 4 positives
Hypothetical: 77.8% -> 66.7% (-11.1 points, CI -33.3 to 0.0), fixed 0, broken 1, n 9
Predictive: 85.7% -> 85.7% (0.0 points, CI 0.0 to 0.0), fixed 0, broken 0, n 7
FAIL: 1 regression cases newly failing: ctr-ef04483dc87e-hypoth
FAIL: Hypothetical: accuracy lower bound -33.3 points (tolerance -5.0)
FAIL: Context-dependent: no improvement (upper bound 0.0 points)
Not gated (under 5 positives): Context-dependent (4 positives of 11)
Not run: 9 cases on source-reading tags (Source inaccessible, Improperly sourced)
Baseline f0b5d66f0b36f8e5 (rubric 2026-10-13.1) vs candidate 6283ce5782027655 (rubric 2026-10-13.2), 3 run(s)
Rollback: /claim-tagger promote --rollback Gate test (deliberately bad): only pronouns make a claim Context-dependent
