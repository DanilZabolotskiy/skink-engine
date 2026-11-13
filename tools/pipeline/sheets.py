"""Chapter frame sheets from stills — without rendering the video and without sound (checks the drawing of kits and figures).

python tools/pipeline/sheets.py <chapter work folder> [--scenes 05,08] [--shots 05.01,08.02] [--at 0.55] [--out check/stills] [--clean]
                                [--name sheet --title title]
--clean — clean frames (no title bar, counter, cards or subtitles) for review sheets; --name — one sheet (up to 4 shots) with this name.

Takes timeline.json of the work folder (build it without TTS: run.py <script> --estimate --no-stt --steps parse,timeline --work <folder>),
renders a frame at fraction --at of every shot (tools/stills.mjs from the code copy, tools/mirror.py; SKINK_MIRROR — an own copy if others
are rendering) and lays out sheets of 4 frames: <folder>/<out>/sheet_sNN_K.jpg, frames — <out>/frames/. The default --out is not the
check/ folder of the check step, so the sheets of the video stay.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools import cpu_queue, mirror  # noqa: E402
from tools.pipeline.common import ROOT, channel_of, load_json, node_exe  # noqa: E402
from tools.sheet import make_sheet  # noqa: E402


def write_sheets(shots: list, png: dict, label: dict, cd: Path, name: str | None = None, title: str | None = None) -> list:
    """Sheets of up to 4 frames: one group per scene (or one group with name) → <cd>/sheet_s<scene>_<k>.jpg (<cd>/<name>[_k].jpg).
    png, label — frame file and caption by shot id."""
    by = {}
    for s in shots:
        by.setdefault('all' if name else s['scene'], []).append(s)
    out = []
    for sid, grp_all in by.items():
        for k in range(0, len(grp_all), 4):
            grp = grp_all[k:k + 4]
            path = cd / (f'{name}{"" if k == 0 else "_" + str(k // 4 + 1)}.jpg' if name else f'sheet_s{sid}_{k // 4 + 1}.jpg')
            make_sheet(path, title or f'Scene {sid} · shots {grp[0]["id"]}–{grp[-1]["id"]}', [(png[s['id']], None, label[s['id']]) for s in grp])
            out.append(path)
    return out


def shot_label(s: dict, t: float) -> str:
    return f'{s["id"]} · {s["preset"]} · {s["location"]}{"" if s["kit"] else " (stub)"} · {s["view"]}/{s["move"]} · {t:.1f} s'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('work')
    ap.add_argument('--scenes')
    ap.add_argument('--shots')
    ap.add_argument('--at', type=float, default=0.55)
    ap.add_argument('--out', default='check/stills')
    ap.add_argument('--clean', action='store_true')
    ap.add_argument('--name')
    ap.add_argument('--title')
    a = ap.parse_args()
    wd = Path(a.work).resolve()
    tl = load_json(wd / 'timeline.json')
    scenes = [s.strip().zfill(2) for s in a.scenes.split(',')] if a.scenes else None
    only = [s.strip() for s in a.shots.split(',')] if a.shots else None
    shots = [s for s in tl['shots'] if (not scenes or s['scene'] in scenes) and (not only or s['id'] in only)]
    if not shots:
        sys.exit('no shots')
    cd = wd / a.out
    fd = cd / 'frames'
    fd.mkdir(parents=True, exist_ok=True)
    frames = {s['id']: min(s['to'] - 1, s['from'] + int(a.at * (s['to'] - s['from']))) for s in shots}
    m = mirror.sync()
    pref = fd / ('c' if a.clean else 'f')
    props = wd / 'timeline.json'
    if a.clean:
        props = cd / 'clean_props.json'
        props.write_text(json.dumps({'timeline': tl, 'clean': True}, ensure_ascii=False), encoding='utf-8')
    with cpu_queue.slot('stills', f'{ROOT.name} sheets {wd.name}', lambda s: print(s, flush=True)):  # the CPU queue of the machine
        r = subprocess.run([node_exe(), str(Path(m) / 'tools' / 'stills.mjs'), f'{channel_of(tl, wd)}-chapter', str(pref),
                            ','.join(str(v) for v in frames.values()), str(props)], cwd=m, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode:
        sys.exit('stills.mjs: ' + (r.stderr or r.stdout)[-3000:])
    png = {sid: f'{pref}_{f}.png' for sid, f in frames.items()}
    label = {s['id']: f'shot {s["id"]} · {s["preset"]}' if a.clean else shot_label(s, frames[s['id']] / tl['fps']) for s in shots}
    print('\n'.join(str(p) for p in write_sheets(shots, png, label, cd, a.name, a.title)))


if __name__ == '__main__':
    main()
