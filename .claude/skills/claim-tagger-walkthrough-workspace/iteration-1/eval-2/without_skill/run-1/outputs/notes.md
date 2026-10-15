ls && ls agents/claim-tagger-mvp && ls agents/claim-tagger-mvp/scripts && ls .claude/skills && ls -R .claude/skills/claim-tagger-walkthrough-workspace | head -50 -> exit 0
ls -la agents/claim-tagger-mvp/walkthrough && ls agents/claim-tagger-mvp/scripts/lib && head -120 agents/claim-tagger-mvp/scripts/walkthrough.mjs -> exit 0
grep -n -i "dry" agents/claim-tagger-mvp/scripts/walkthrough.mjs | head -60 -> exit 0
(ls agents/claim-tagger-mvp/runs/PAUSED || echo none) && (test -f .env && echo yes || echo no) && ls agents/claim-tagger-mvp/runs && ls agents/claim-tagger-mvp/runs/demos && git status --short | head -20 -> exit 0
grep -n -i "dry" docs/mvp-2026-11/WORKLOG.md | head -40; grep -n -i "walkthrough\|dry" agents/claim-tagger-mvp/AGENT.md | head -40 -> exit 0
sed -n 1250,1400p agents/claim-tagger-mvp/scripts/walkthrough.mjs -> exit 0
for d in agents/claim-tagger-mvp/runs/demos/*; do echo "== $d"; ls "$d"; done | head -80; grep -n -i "walkthrough" .claude/settings.json .claude/settings.local.json | head -> exit 0
node agents/claim-tagger-mvp/scripts/walkthrough.mjs start --parent https://www.notion.so/3fa273e214eb81c2b223dcc2331b7051 --dry-run -> exit 0
D=$(ls -d agents/claim-tagger-mvp/runs/demos/*/ | sort | tail -1) && ls -la "$D" && cat "${D}preview.md" -> exit 0
node -e '<summarize setup-plan.json: top-level keys, requests, planned rows>' agents/claim-tagger-mvp/runs/demos/20261015-1900-94990d/ -> exit 0
node -e '<print setup-plan.json plan header and the field values of every planned row>' -> exit 0
preview file: X:\work\geo-agents\agents\claim-tagger-mvp\runs\demos\20261015-1900-94990d\preview.md
plan file: X:\work\geo-agents\agents\claim-tagger-mvp\runs\demos\20261015-1900-94990d\setup-plan.json
