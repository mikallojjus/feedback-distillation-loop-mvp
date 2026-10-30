---
name: claim-tagger-walkthrough
description: >-
  PARKED (decision P48): the claim tagger's practice pages for onboarding do not run on this version; they run only on the
  earlier version, the git tag claim-tagger-v1. This skill builds nothing and runs nothing: when someone asks to try, learn,
  practise, demo or teach the claim tagger, onboard a new editor, make a training or practice page, or asks "where am I in the
  walkthrough/demo", it answers in one short report that the walkthrough is parked and names the tag. For real tagging,
  deciding, distilling or promoting on the page "Claim tagger v2" use /claim-tagger.
---

# Claim tagger walkthrough

**Parked.** The walkthrough is parked (decision P48). This version of the claim tagger works on the page "Claim tagger v2" only, where editors decide one row per claim and tag. The practice pages were built for the earlier layout, where editors decided a whole claim on Claims, and they were not ported. They still run on the earlier version, the git tag `claim-tagger-v1`. The script refuses here too: `walkthrough.mjs` on this branch stops with a message that names the tag.

**Output style.** For as long as this skill runs, its report format replaces your output style. Do not write Insight blocks, tips or other educational notes, and do not explain the scripts, the code or your choices.

## What it does and never does

- It runs nothing: no script, no connector call, no file read. It never builds, changes or reads a practice page, and never touches Notion.
- Whatever the request (start a practice page, where am I, list the pages, a demo step), the whole answer is this report, as it stands:

Walkthrough: nothing was done, because the practice pages are parked; they run on the version tagged claim-tagger-v1.

Next: ask the engineer for the practice version.

- Nothing follows the report: no checklist, no other words.

## For the engineer

The walkthrough as it was, with its page, its seven steps and its reports, is in the tag: `git show claim-tagger-v1:.claude/skills/claim-tagger-walkthrough/SKILL.md`. To run it, check the tag out in a worktree of its own (`git worktree add ../geo-agents-v1 claim-tagger-v1`) and work there; its practice pages go under the Onboarding page of the first page, "Claim tagger", and use that page's per-claim layout. The files under `references/` describe that version and are kept as history.
