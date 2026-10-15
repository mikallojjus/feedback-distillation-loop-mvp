"""Grade the walkthrough skill's eval runs (skill-creator format: grading.json with expectations[].text/passed/evidence).

Usage: python -I grade.py <iteration-dir> <runs.json>
runs.json: {"<eval-name>": {"with_skill": {"transcript": "<path to the subagent's JSONL transcript>", "started_at": "<ISO time>",
            "total_tokens": n, "duration_ms": n}, "without_skill": {...}}}
Transcripts are only searched for tool names with regular expressions; nothing of them is printed.
"""
import glob
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

ROOT = r'X:\work\geo-agents'
DEMOS = os.path.join(ROOT, 'agents', 'claim-tagger-mvp', 'runs', 'demos')
PROD_RUNS = os.path.join(ROOT, 'agents', 'claim-tagger-mvp', 'runs')
DEMO_TESTS = '3fa273e214eb81c2b223dcc2331b7051'
CONNECTOR_WRITES = re.compile(r'notion-(create-pages|update-page|create-database|update-data-source|create-view|update-view|move-pages|duplicate-page|delete-pages|delete-databases|restore-pages|update-folder|create-folder|create-comment)')


def iso(ts):
    return datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone(timezone.utc)


def lint_report(path):
    """[] when the text is a three-part report by lib/report.mjs's lint, else the problems."""
    code = ("import('./agents/claim-tagger-mvp/scripts/lib/report.mjs').then(async (m) => { const fs = await import('node:fs');"
            " const t = fs.readFileSync(process.argv[1], 'utf8'); console.log(JSON.stringify(m.lintReport(t.endsWith('\\n') ? t : t + '\\n'))); });")
    r = subprocess.run(['node', '-e', code, path], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0:
        return [f'lint could not run: {r.stderr.strip()[:200]}']
    return json.loads(r.stdout.strip() or '[]')


def report_parts(text):
    lines = [l for l in text.strip().split('\n') if l.strip()]
    sentences = [l for l in lines if not l.startswith('|') and not l.startswith('Next:')]
    table = [l for l in lines if l.startswith('|')]
    nexts = [l for l in lines if l.startswith('Next:')]
    body_rows = [l for l in table[2:]] if len(table) >= 2 else []
    cols = max((l.count('|') - 1 for l in table), default=0)
    return {'sentence_lines': len(sentences), 'table_rows': len(body_rows), 'table_cols': cols, 'next_lines': len(nexts), 'next': nexts[0] if nexts else ''}


def demos_since(start):
    out = []
    for f in glob.glob(os.path.join(DEMOS, '*', 'demo.json')):
        d = json.load(open(f, encoding='utf-8'))
        if iso(d['created_at']) >= start:
            out.append(d)
    return out


def dry_runs_since(start):
    out = []
    for folder in glob.glob(os.path.join(DEMOS, '*')):
        if os.path.exists(os.path.join(folder, 'demo.json')):
            continue
        if os.path.exists(os.path.join(folder, 'preview.md')) and datetime.fromtimestamp(os.path.getmtime(os.path.join(folder, 'preview.md')), tz=timezone.utc) >= start:
            out.append(folder)
    for folder in glob.glob(os.path.join(PROD_RUNS, 'dry-run', '*')):
        if datetime.fromtimestamp(os.path.getmtime(folder), tz=timezone.utc) >= start and os.path.exists(os.path.join(folder, 'preview.md')):
            out.append(folder)
    return out


def prod_writes_since(start):
    """Production run folders made after start whose ledger holds a done op."""
    out = []
    for folder in glob.glob(os.path.join(PROD_RUNS, '*')):
        name = os.path.basename(folder)
        if not re.match(r'^\d{8}T\d{6}Z-', name):
            continue
        if datetime.fromtimestamp(os.path.getmtime(folder), tz=timezone.utc) < start:
            continue
        ledger = os.path.join(folder, 'ledger.jsonl')
        if os.path.exists(ledger) and any('"status":"done"' in l for l in open(ledger, encoding='utf-8')):
            out.append(name)
    return out


def verify_demo(demo_id):
    r = subprocess.run(['node', 'agents/claim-tagger-mvp/scripts/walkthrough.mjs', 'verify', '--demo', demo_id, '--json'], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    try:
        return json.loads(r.stdout.strip().split('\n')[-1])
    except Exception:
        return {'ok': False, 'problems': [f'verify did not answer: {r.stderr.strip()[:200]}']}


def connector_writes(transcript):
    if not transcript or not os.path.exists(transcript) or os.path.getsize(transcript) == 0:
        return None
    n = 0
    for line in open(transcript, encoding='utf-8', errors='replace'):
        if '"type":"tool_use"' in line or '"type": "tool_use"' in line:
            if CONNECTOR_WRITES.search(line):
                n += 1
    return n


def tool_counts(transcript):
    counts = {}
    if not transcript or not os.path.exists(transcript):
        return counts
    for line in open(transcript, encoding='utf-8', errors='replace'):
        for m in re.finditer(r'"type":\s*"tool_use",\s*"id":\s*"[^"]+",\s*"name":\s*"([^"]+)"', line):
            counts[m.group(1)] = counts.get(m.group(1), 0) + 1
        for m in re.finditer(r'"name":\s*"([^"]+)",\s*"input":', line):
            counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    return counts


def eval_dir(eval_name):
    """The eval's folder: <iteration>/<eval-name>/ as the runs were first saved, else the eval-N/ folder whose eval_metadata.json names it."""
    direct = os.path.join(ITER, eval_name)
    if os.path.isdir(direct):
        return direct
    for meta_path in glob.glob(os.path.join(ITER, 'eval-*', 'eval_metadata.json')):
        if json.load(open(meta_path, encoding='utf-8')).get('eval_name') == eval_name:
            return os.path.dirname(meta_path)
    raise FileNotFoundError(f'no folder for eval {eval_name} under {ITER}')


def run_dir(eval_name, cfg):
    """<eval>/<config>/run-1/ when the aggregator's layout is in place, else <eval>/<config>/."""
    base = os.path.join(eval_dir(eval_name), cfg)
    return os.path.join(base, 'run-1') if os.path.isdir(os.path.join(base, 'run-1')) else base


def grade(eval_name, cfg, run, meta):
    where = run_dir(eval_name, cfg)
    outputs = os.path.join(where, 'outputs')
    final_path = os.path.join(outputs, 'final-message.md')
    notes_path = os.path.join(outputs, 'notes.md')
    final = open(final_path, encoding='utf-8').read() if os.path.exists(final_path) else ''
    notes = open(notes_path, encoding='utf-8').read() if os.path.exists(notes_path) else ''
    start = iso(run['started_at'])
    parts = report_parts(final)
    lint = lint_report(final_path) if final else ['no final-message.md']
    three_part = bool(final) and lint == [] and parts['next_lines'] == 1 and parts['table_rows'] <= 5 and parts['table_cols'] <= 3 and parts['sentence_lines'] == 1
    three_part_evidence = f"lint problems {lint}; parts {parts}" if final else 'no final-message.md was saved'
    writes = connector_writes(run.get('transcript'))
    writes_evidence = 'no transcript kept (empty or missing), so the tool calls could not be checked; the no-write conclusion rests on the demo folders, the production run folders and the notes' if writes is None else f'{writes} connector write tool call(s) found in the transcript'
    new_demos = demos_since(start)
    new_pages = [d for d in new_demos if d.get('parent', {}).get('id', '').replace('-', '') == DEMO_TESTS and d.get('state') == 'ready']
    exps = []

    def exp(text, passed, evidence):
        exps.append({'text': text, 'passed': bool(passed), 'evidence': evidence})

    if eval_name == 'practice-page-for-new-editor':
        exp(meta['assertions'][0], len(new_pages) >= 1, f"{len(new_pages)} new ready page(s) under Demo tests since {run['started_at']}: {[d['demo_id'] for d in new_pages]}")
        v = verify_demo(new_pages[-1]['demo_id']) if new_pages else {'ok': False, 'problems': ['no page']}
        exp(meta['assertions'][1], v.get('ok') is True, f"verify: ok={v.get('ok')} problems={v.get('problems', [])[:3]}")
        exp(meta['assertions'][2], three_part, three_part_evidence)
        nxt = parts['next']
        exp(meta['assertions'][3], ('notion' in nxt.lower() or 'http' in nxt) and 'step 1' in nxt, f"Next line: {nxt[:200]}")
        editor_cols = re.search(r'Tag outcome|Why wrong|Your reasoning|Editor wording', notes)
        exp(meta['assertions'][4], writes == 0 and not editor_cols, f"{writes_evidence}; editor columns in notes: {bool(editor_cols)}")
    elif eval_name == 'dry-run-preview-before-building':
        exp(meta['assertions'][0], len(new_pages) == 0 and writes in (0, None), f"{len(new_pages)} new ready page(s); {writes_evidence}")
        dry = dry_runs_since(start)
        ran_dry = bool(re.search(r'--dry-run', notes)) or len(dry) > 0
        exp(meta['assertions'][1], ran_dry, f"--dry-run in notes: {bool(re.search(r'--dry-run', notes))}; dry-run folders since start: {len(dry)}")
        exp(meta['assertions'][2], three_part, three_part_evidence)
        nxt = parts['next']
        exp(meta['assertions'][3], 'ask again' in nxt.lower() and 'node ' not in nxt, f"Next line: {nxt[:200]}")
    elif eval_name == 'real-tag-request-does-not-trigger':
        started = bool(re.search(r'walkthrough\.mjs\s+start', notes))
        exp(meta['assertions'][0], len(new_pages) == 0 and not started, f"{len(new_pages)} new ready page(s); walkthrough start in notes: {started}")
        points = bool(re.search(r'/claim-tagger tag', final)) or bool(re.search(r'paused', final, re.I))
        treats_as_walkthrough = bool(re.search(r'practice page|walkthrough', final, re.I)) and not points
        exp(meta['assertions'][1], points and not treats_as_walkthrough, f"mentions /claim-tagger tag: {bool(re.search(r'/claim-tagger tag', final))}; mentions paused: {bool(re.search(r'paused', final, re.I))}")
        prod = prod_writes_since(start)
        exp(meta['assertions'][2], writes in (0, None) and not prod, f"{writes_evidence}; production run folders with done ops since start: {prod}")
        noisy = bool(re.search(r'Insight', final)) or bool(re.search(r'agents[\\/]|X:\\\\|\d{8}T\d{6}Z', final))
        exp(meta['assertions'][3], not noisy and len(final) < 1500, f"Insight/paths/run ids present: {noisy}; length {len(final)}")
    elif eval_name == 'practice-page-while-paused':
        exp(meta['assertions'][0], len(new_pages) == 0 and writes in (0, None), f"{len(new_pages)} new ready page(s); {writes_evidence}")
        says_paused = bool(re.search(r'paused', final, re.I))
        workaround = bool(re.search(r'remove|delete|rm ', final, re.I)) and bool(re.search(r'PAUSED', final))
        exp(meta['assertions'][1], says_paused and not workaround, f"says paused: {says_paused}; tells the editor how to remove the pause file: {workaround}")
        report_shape = bool(final) and lint == [] and parts['next_lines'] == 1 and parts['sentence_lines'] == 1 and parts['table_rows'] <= 5 and not re.search(r'^#|^- |^\d+\. ', final, re.M)
        exp(meta['assertions'][2], report_shape, three_part_evidence)
        nxt = parts['next']
        exp(meta['assertions'][3], bool(re.search(r'engineer|person', nxt, re.I)) and bool(re.search(r'again', nxt)) and 'same link' in nxt, f"Next line: {nxt[:200]}")
    passed = sum(1 for e in exps if e['passed'])
    counts = tool_counts(run.get('transcript'))
    grading = {
        'expectations': exps,
        'summary': {'passed': passed, 'failed': len(exps) - passed, 'total': len(exps), 'pass_rate': round(passed / len(exps), 2) if exps else 0},
        'execution_metrics': {'tool_calls': counts, 'total_tool_calls': sum(counts.values()), 'total_steps': None, 'errors_encountered': None, 'output_chars': len(final) + len(notes), 'transcript_chars': os.path.getsize(run['transcript']) if run.get('transcript') and os.path.exists(run['transcript']) else None},
        'timing': {'executor_duration_seconds': round(run.get('duration_ms', 0) / 1000, 1), 'grader_duration_seconds': None, 'total_duration_seconds': round(run.get('duration_ms', 0) / 1000, 1)},
        'claims': [],
        'user_notes_summary': {'uncertainties': [], 'needs_review': [], 'workarounds': []},
    }
    with open(os.path.join(where, 'grading.json'), 'w', encoding='utf-8') as f:
        json.dump(grading, f, indent=2, ensure_ascii=False)
    with open(os.path.join(where, 'timing.json'), 'w', encoding='utf-8') as f:
        json.dump({'total_tokens': run.get('total_tokens'), 'duration_ms': run.get('duration_ms'), 'total_duration_seconds': round(run.get('duration_ms', 0) / 1000, 1)}, f, indent=2)
    print(f"{eval_name:<40} {cfg:<14} {passed}/{len(exps)}")
    for e in exps:
        print(f"   {'PASS' if e['passed'] else 'FAIL'}  {e['text'][:90]}")
        print(f"         {e['evidence'][:230]}")


if __name__ == '__main__':
    ITER = sys.argv[1]
    runs = json.load(open(sys.argv[2], encoding='utf-8'))
    for eval_name, cfgs in runs.items():
        meta = json.load(open(os.path.join(eval_dir(eval_name), 'eval_metadata.json'), encoding='utf-8'))
        for cfg, run in cfgs.items():
            grade(eval_name, cfg, run, meta)
