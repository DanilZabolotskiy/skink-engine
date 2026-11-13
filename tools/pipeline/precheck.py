"""precheck step: staging checks before render → check/precheck/report.md (+ report.json).

Staging checks need no video: the frame journal (tools/stage_layout.mjs) and the arm pose stills (tools/hands_check.mjs) are rendered
from the code copy by timeline.json, so a gesture fix does not cost a full render → audio → assemble → check cycle.
1. Staging — the same code as the check step (stage_check.run) without the checks on the video (jumps, jitter, sound on a still frame)
   and on the mixed sound (ambience dropout, quiet line): by timeline data, by the frame journal (layout, event without a visible
   change, view, props), voice band, timing in kit code → check/precheck/staging/report.md. The errors are the same lines as in
   check/staging/report.md after render.
2. Arm, neck and head-from-behind poses (tools/hands_check.mjs --no-png), in parallel with the journal → check/precheck/arms/report.txt.
A browser failure (it did not start even after a retry, tools/remotion.mjs) is an environment error: printed separately, not counted as
staging. precheck does not touch the report of the check step (check/staging/): that one is made from the video.
"""
import json
import subprocess
import time
from pathlib import Path

from tools.pipeline import stage_check
from tools.pipeline.common import Channel, log, node_exe, rel, save_json

ENV_EXIT = stage_check.ENV_EXIT


def hands_rows(rep: dict) -> list:
    """hands_check violations as lines, as in its report.txt."""
    out = []
    for r in rep.get('rows', []):
        if not r['out']:
            continue
        hand = '' if r['hand'] == '-' else f' ({"right" if r["hand"] == "R" else "left"} hand)'
        out.append(f'{r["shot"]} · arms · frame {r["frame"]} · {r["who"]} · {r["side"]}{hand} · {r["hold"]}{" · from behind" if r["back"] else ""}: '
                   + '; '.join(f'[{o["rule"]}] {o["msg"]}' for o in r['out']))
    return out


def run(tl: dict, wd: Path, ch: Channel, shots: list | None = None, hands: bool = True, workers: int = 2) -> dict:
    """shots — only these shots (None — all shots of the timeline). → {'errors': [...], 'env': [...], 'report': path}."""
    from tools import mirror
    t0 = time.time()
    out = wd / 'check' / 'precheck'
    out.mkdir(parents=True, exist_ok=True)
    errs, env = [], []
    hp = None
    hdir = out / 'arms'
    if hands:
        m = mirror.sync()
        hdir.mkdir(parents=True, exist_ok=True)
        (hdir / 'report.json').unlink(missing_ok=True)
        hlog = open(out / 'hands.log', 'w', encoding='utf-8')
        cmd = [node_exe(), str(Path(m) / 'tools' / 'hands_check.mjs'), str(wd.resolve()), '--out', hdir.relative_to(wd).as_posix(), '--no-png']
        hp = subprocess.Popen(cmd + (['--shots', ','.join(shots)] if shots else []), cwd=m, stdout=hlog, stderr=subprocess.STDOUT)
    try:
        st = stage_check.run(tl, wd, ch.cfg, None, out=out / 'staging', shots=shots, ch=ch, mix=False, workers=workers)
    finally:
        if hp:
            hp.wait()
            hlog.close()
    errs += [f'staging — {e}' for e in st['list']]
    env += [f'staging: {e}' for e in st['env']]
    if hp:
        hl = (out / 'hands.log').read_text(encoding='utf-8', errors='replace')
        if hp.returncode == ENV_EXIT:
            env.append('arm poses: ' + next((ln for ln in hl.splitlines() if ln.startswith('ENVIRONMENT:')), 'the browser did not start') + f' — log {out / "hands.log"}')
        elif hp.returncode in (0, 1) and (hdir / 'report.json').exists():
            errs += hands_rows(json.loads((hdir / 'report.json').read_text(encoding='utf-8')))
        else:
            errs.append(f'arm poses: tools/hands_check.mjs failed (code {hp.returncode}) — log {out / "hands.log"}: {hl.strip().splitlines()[-1][:200] if hl.strip() else ""}')
    dt = time.time() - t0
    n = len(shots) if shots else len(tl['shots'])
    md = ['# Staging check before render (precheck)', '',
          f'- Shots: {n}{" (" + ", ".join(shots) + ")" if shots and len(shots) <= 12 else ""}; {dt:.0f} s',
          f'- Errors: {len(errs)}', *[f'  - {e}' for e in errs]]
    if env:
        md += [f'- **Environment (not staging) — the check did not run, repeat it:** {len(env)}', *[f'  - {e}' for e in env]]
    md += ['', f'Staging in detail: {rel(out / "staging" / "report.md")} (manual sound bindings, VO — there too); arm poses: {rel(hdir / "report.txt")}.',
           'Not checked before render (only by the check step on video): jumps and small jumps by frames, jitter and drift of a static shot, camera jerk, '
           'sound on a still frame, ambience dropout at a cut, quiet line, speech recognition, colour.']
    (out / 'report.md').write_text('\n'.join(md) + '\n', encoding='utf-8')
    save_json(out / 'report.json', {'shots': shots, 'sec': round(dt, 1), 'errors': errs, 'env': env})
    log(f'precheck: errors {len(errs)}' + (f', ENVIRONMENT {len(env)}' if env else '') + f', shots {n}, {dt:.0f} s → {rel(out / "report.md")}')
    return {'errors': errs, 'env': env, 'report': out / 'report.md'}
