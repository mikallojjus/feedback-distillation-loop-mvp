# Eval workspace of the claim-tagger-walkthrough skill

Built with the skill-creator workflow on 2026-10-15.

- `iteration-1/eval-N/<with_skill|without_skill>/run-1/`: the saved final message and command notes of each subagent run (`outputs/`), its grading (`grading.json`, assertions from `eval-N/eval_metadata.json`) and timing (`timing.json`, the tokens and wall-clock the task notification reported).
- `iteration-1/benchmark.json` and `benchmark.md`: the aggregate (with the skill 12 of 12 assertions, without it 8 of 12).
- `iteration-1/runs.json`: where each run's transcript lives and when it started; `grade.py` (one folder up) grades the runs from the saved outputs, the demo folders and the transcripts' tool names.
- `pending/practice-page-for-new-editor/`: eval 1 (a live practice page under the Demo tests page while the agent runs) never ran unpaused, and on 27 October 2026 it was retired by decision P7: no eval builds a live practice page any more, and the Demo tests page is in the hub's archive. The folder, and the eval 1 check in `grade.py`, stay as history. The same request under the pause is eval 4, now asked under the Onboarding page; eval 2's dry run is under Onboarding too (`evals/evals.json`).
- Everything in `iteration-1/` is the record of 15 October; the pages those runs made are in the hub's archive now, read only.
- The static review page is in `docs/mvp-2026-11/evidence/11-walkthrough-evals/review-iteration-1.html`; the description optimiser's two runs are under `description-loop/` there (no trigger counted on any positive query in either run, all negatives passed; the description was left as written).
