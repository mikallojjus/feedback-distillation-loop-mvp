Verdict: FAIL - small sample: a gated tag has under 30 labelled positives, read the numbers and not only the word
Canaries: 83/83 pass under the candidate; baseline 83/83
Cases newly failing: 1 (ctr-f2cc9025f0f5-predic) of 27 active; newly passing 0; rule changed 11
Target Predictive: 0.0 points (95% CI -27.3 to +27.3), fixed 1, broken 1, n 11, 7 positives
Hypothetical: 77.8% -> 77.8% (0.0 points, CI 0.0 to 0.0), fixed 0, broken 0, n 9
FAIL: 1 regression cases newly failing: ctr-f2cc9025f0f5-predic
FAIL: Predictive: accuracy lower bound -27.3 points (tolerance -5.0)
HOLD: Predictive: interval straddles zero (-27.3 to +27.3 points); more labels needed
Reconfirmed ctr-c59c5313859e-contex (Context-dependent, expected do_not_apply): baseline undecided over 8 runs, candidate undecided over 8 runs: broken flip was noise
Reconfirmed ctr-f2cc9025f0f5-predic (Predictive, expected apply): baseline apply over 8 runs, candidate ask_editor over 8 runs: broken flip confirmed
Reconfirmed ctr-c7c20ae98de9-predic (Predictive, expected do_not_apply): baseline apply over 8 runs, candidate undecided over 8 runs: fixed flip was noise
Reconfirmed ctr-c9b46cfbd720-predic (Predictive, expected do_not_apply): baseline apply over 8 runs, candidate do_not_apply over 8 runs: fixed flip confirmed
Not gated (under 5 positives): Context-dependent (4 positives of 11)
Not run: 9 cases on source-reading tags (Source inaccessible, Improperly sourced)
Baseline f0b5d66f0b36f8e5 (rubric 2026-10-13.1) vs candidate a0d49bb16857dce8 (rubric 2026-10-13.2), 3 run(s)
Rollback: /claim-tagger promote --rollback Hedged 'likely to' needs a definite future outcome, not a tendency
