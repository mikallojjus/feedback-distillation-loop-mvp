Verdict: FAIL - small sample: a gated tag has under 30 labelled positives, read the numbers and not only the word
Canaries: 83/83 pass under the candidate; baseline 83/83
Cases newly failing: 3 (ctr-ec6e3f00cf08-contex, ctr-e05138dd8e72-hypoth, ctr-dacb1fb93fb3-hypoth) of 29 active; newly passing 0; rule changed 11
Target Predictive: +36.4 points (95% CI +9.1 to +63.6), fixed 4, broken 0, n 11, 7 positives
Hypothetical: 81.8% -> 63.6% (-18.2 points, CI -36.4 to 0.0), fixed 0, broken 2, n 11
FAIL: 3 regression cases newly failing: ctr-ec6e3f00cf08-contex, ctr-e05138dd8e72-hypoth, ctr-dacb1fb93fb3-hypoth
FAIL: Hypothetical: accuracy lower bound -36.4 points (tolerance -5.0)
Not gated (under 5 positives): Context-dependent (4 positives of 11)
Not run: 9 cases on source-reading tags (Source inaccessible, Improperly sourced)
Baseline f0b5d66f0b36f8e5 (rubric 2026-10-13.1) vs candidate 038f96ade2a80e70 (rubric 2026-10-13.2), 3 run(s)
Rollback: /claim-tagger promote --rollback Hedged 'likely to' needs a definite future outcome, not a tendency
