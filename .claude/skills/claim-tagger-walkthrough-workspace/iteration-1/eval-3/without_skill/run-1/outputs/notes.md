cat "X:/work/geo-agents/agents/claim-tagger-mvp/config.json" — exit 0
sed -n '1,80p' "X:/work/geo-agents/agents/claim-tagger-mvp/scripts/pull.mjs" — exit 0
tail -n 120 "X:/work/geo-agents/docs/mvp-2026-11/WORKLOG.md" — exit 0
ls "X:/work/geo-agents/agents/claim-tagger-mvp/scripts"; grep -n -i -E "new claims|refresh|sync|add claims|more claims|pick|real_claims|real claims" "X:/work/geo-agents/agents/claim-tagger-mvp/AGENT.md" — exit 0
grep -n -i -B2 -A8 "real claims table" "X:/work/geo-agents/docs/mvp-2026-11/BACKLOG.md" — exit 0
mkdir -p "X:/work/geo-agents/.claude/skills/claim-tagger-walkthrough-workspace/iteration-1/real-tag-request-does-not-trigger/without_skill/outputs" — exit 0
