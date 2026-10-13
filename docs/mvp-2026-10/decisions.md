# Decisions (MVP, October 2026)

| # | Date | Decision | Why |
|---|---|---|---|
| M1 | 13 Oct | Code lives in a new `X:\work\geo-agents` shaped like the migration plan (one folder per agent); local git, no remote | future agents repo; the editor opens Claude Code there |
| M2 | 13 Oct | Scripts write Notion through the integration token (REST); the connector serves the interactive skill and the Editor persona; connector apply stays as the no-token fallback | connector updates one page per call (about 50 min for 482 rows); REST about 3 min |
| M3 | 13 Oct | All 14 Verified tags in the rubric, 12 judged; the two source-reading tags decided in code (no source fetching in the MVP) | scope of the research; cost |
| M4 | 13 Oct | Seed with real claims (about 60) and the 57 audit decisions, anonymised; seeded decisions live in agent-owned Seeded outcome columns merged by an Effective outcome formula | no script ever writes an editor field |
| M5 | 13 Oct | Gate keeps the research semantics with min positives 5; every card says "small sample"; demo = L-1 (expected PASS) plus a labelled bad lesson on Context-dependent (expected FAIL, rollback) | tiny data; show both verdicts |
| M6 | 13 Oct | Judge Sonnet 5.5, 3 runs, majority verdict; distiller Opus 5.5; Editor persona Fable 5.1; Engineer persona Opus 5.5 | Mika's model split |
| M7 | 13 Oct | One skill `/claim-tagger` with subcommands; queue views, Agent settings with pause switch, Engineer notes page; no Start-here page (guidance in column comments) | Mika's choices |
| M8 | 13 Oct | Editor's-machine test = fresh headless `claude -p` session in geo-agents, transcript kept as evidence | no GitHub remote needed |
| M9 | 13 Oct | Artifact: seven tabs, Plain/Technical switch, wider reading column than the research artifact, diagram and sample tables | Mika reads visually; the research page was too narrow |
| M10 | 13 Oct | Writes only inside the hub page; real databases listed as protected; no delete or archive calls | brief |
