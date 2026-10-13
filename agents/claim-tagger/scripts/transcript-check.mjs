#!/usr/bin/env node
// transcript-check.mjs: summarise a headless Claude Code transcript (--output-format stream-json --verbose) as evidence.
//
//   node transcript-check.mjs <transcript.jsonl> [--out <summary.md>]
//
// It lists the tools called (by name and count), every Bash command, every Notion connector call with the database or page it
// touched, any write that names an editor-owned property, the cost and the final assistant message. It never calls Notion.

import { readFileSync, writeFileSync } from 'node:fs';
import { EDITOR_NAMES } from './allowlist.mjs';

const EDITOR_FIELDS = new Set(Object.values(EDITOR_NAMES || {}).flat());

function parse(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  const events = [];
  for (const l of lines) { try { events.push(JSON.parse(l)); } catch { /* skip partial lines */ } }
  return events;
}

export function summarise(events) {
  const tools = new Map();
  const bash = [];
  const notion = [];
  const editorWrites = [];
  let result = null;
  let init = null;
  for (const e of events) {
    if (e.type === 'system' && e.subtype === 'init') init = e;
    if (e.type === 'result') result = e;
    const content = e.message && Array.isArray(e.message.content) ? e.message.content : [];
    for (const c of content) {
      if (c.type !== 'tool_use') continue;
      tools.set(c.name, (tools.get(c.name) || 0) + 1);
      if (c.name === 'Bash' && c.input && c.input.command) bash.push(c.input.command);
      if (/notion/i.test(c.name)) {
        const input = c.input || {};
        const target = input.page_id || input.data_source_id || input.database_id || (input.data && (input.data.view_url || input.data.data_source_url)) || input.id || '';
        const props = Object.keys(input.properties || {});
        const pages = Array.isArray(input.pages) ? input.pages.flatMap((p) => Object.keys(p.properties || {})) : [];
        const written = [...props, ...pages];
        notion.push({ tool: c.name.replace(/^mcp__[^_]+__/, ''), target: String(target).slice(0, 80), properties: written });
        for (const p of written) if (EDITOR_FIELDS.has(p)) editorWrites.push({ tool: c.name, property: p, target });
      }
    }
  }
  const skillLoaded = events.some((e) => JSON.stringify(e).includes('claim-tagger'));
  return {
    init: init ? { tools: (init.tools || []).length, mcp_servers: (init.mcp_servers || []).map((s) => `${s.name}:${s.status}`), model: init.model } : null,
    skill_mentioned: skillLoaded,
    tool_counts: Object.fromEntries([...tools.entries()].sort()),
    bash,
    notion,
    editor_field_writes: editorWrites,
    result: result ? { is_error: result.is_error, num_turns: result.num_turns, duration_ms: result.duration_ms, total_cost_usd: result.total_cost_usd, permission_denials: result.permission_denials || [], text: String(result.result || '').slice(0, 4000) } : null,
  };
}

export function toMarkdown(s, source) {
  const lines = [`# Headless transcript summary`, '', `Source: ${source}`, ''];
  if (s.init) lines.push(`Init: ${s.init.tools} tools; MCP servers: ${s.init.mcp_servers.join(', ')}; model: ${s.init.model || '-'}`);
  lines.push(`Skill mentioned in the transcript: ${s.skill_mentioned ? 'yes' : 'no'}`, '', '## Tool calls', '');
  for (const [k, v] of Object.entries(s.tool_counts)) lines.push(`- ${k}: ${v}`);
  lines.push('', '## Bash commands', '');
  for (const b of s.bash) lines.push('```', b, '```');
  lines.push('', '## Notion connector calls', '');
  if (!s.notion.length) lines.push('- none');
  for (const n of s.notion) lines.push(`- ${n.tool} → ${n.target}${n.properties.length ? ` · properties: ${n.properties.join(', ')}` : ''}`);
  lines.push('', `## Editor-owned fields written by the connector: ${s.editor_field_writes.length}`, '');
  for (const w of s.editor_field_writes) lines.push(`- ${w.tool} wrote ${w.property} on ${w.target}`);
  if (s.result) {
    lines.push('', '## Result', '', `- is_error: ${s.result.is_error}`, `- turns: ${s.result.num_turns}`, `- duration: ${Math.round((s.result.duration_ms || 0) / 1000)} s`, `- cost: $${Number(s.result.total_cost_usd || 0).toFixed(3)}`, `- permission denials: ${s.result.permission_denials.length}`, '', '### Final message', '', s.result.text);
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] && process.argv[1].endsWith('transcript-check.mjs')) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const outIdx = args.indexOf('--out');
  if (!file) { console.error('usage: transcript-check.mjs <transcript.jsonl> [--out <summary.md>]'); process.exit(2); }
  const s = summarise(parse(file));
  const md = toMarkdown(s, file);
  if (outIdx >= 0 && args[outIdx + 1]) writeFileSync(args[outIdx + 1], md);
  else process.stdout.write(md);
}
