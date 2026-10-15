cat "X:/work/geo-agents/.claude/skills/claim-tagger/SKILL.md"; echo "EXIT=$?"  -> exit 0
cat "X:/work/geo-agents/agents/claim-tagger-mvp/config.json"; echo "EXIT=$?"  -> exit 0
ls "X:/work/geo-agents/agents/claim-tagger-mvp/runs/" 2>&1 | head -50; echo "---PAUSED?"; test -e "X:/work/geo-agents/agents/claim-tagger-mvp/runs/PAUSED" && echo "PAUSED present" || echo "no PAUSED file"; echo "EXIT=$?"  -> exit 0
sed -n '1,120p' "X:/work/geo-agents/agents/claim-tagger-mvp/scripts/pull.mjs"; echo "EXIT=$?"  -> exit 0
grep -n -i -E "^#|U\.S\. Politics|copied|copy|protected|claims table|tag\b" "X:/work/geo-agents/agents/claim-tagger-mvp/AGENT.md" | head -80; echo "EXIT=$?"  -> exit 0
tail -n 120 "X:/work/geo-agents/docs/mvp-2026-11/WORKLOG.md"; echo "EXIT=$?"  -> exit 0
f="X:/work/geo-agents/agents/claim-tagger-mvp/runs/PAUSED"; if [ -d "$f" ]; then echo "PAUSED is a directory"; ls -la "$f"; else echo "PAUSED is a file:"; cat "$f"; fi; echo; echo "EXIT=$?"  -> exit 0
grep -rn -i "PAUSED" "X:/work/geo-agents/agents/claim-tagger-mvp/scripts/lib/"*.mjs "X:/work/geo-agents/agents/claim-tagger-mvp/scripts/judge.mjs" "X:/work/geo-agents/agents/claim-tagger-mvp/scripts/propose.mjs" | grep -v -i "paused:" | head -40; echo "EXIT=$?"  -> exit 0
node agents/claim-tagger-mvp/scripts/pull.mjs --all  -> exit 0
node agents/claim-tagger-mvp/scripts/judge.mjs --items claims  -> exit 3
