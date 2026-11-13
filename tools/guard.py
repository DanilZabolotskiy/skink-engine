"""Accepted chapters guard: control frames drawn by the current code — against the accepted video at the same frame and against a base.

Why: an edit of shared code (lib/, kits, channel.json) changes frames of chapters that were already accepted, and the pose and staging
journals do not see it (a hands_check run can show 0 violations while the eye finds regressions against the accepted video).
The accepted video of a chapter is the reference: a frame redrawn by the current code from the same timeline.json must match it.

Method: 1:1 sheets "new next to accepted at the same second"; per-pixel difference of the pairs with a threshold of 24/255. Frames are
drawn from the code copy (tools/mirror.py, tools/stills.mjs, --gl=swangle), the reference is the frames of the chapter video (chNN.mp4, or
chapter.mp4 in a run.py --work folder).

python tools/guard.py --accepted [channel] | <chapter folder> [<chapter folder> …] [--out DIR] [--at 0.5] [--events] [--shots 01.01,…]
                      [--scenes 01,02] [--base DIR] [--no-video] [--video FILE] [--reuse] [--sheets bad|all|none] [--thr 24] [--blob 40]
                      [--base-thr 8] [--base-blob 25]

  --accepted     all accepted chapters: the lists channels/<channel>/accepted/<episode>.txt (a line — a chapter folder relative to the channel
                 folder; without a name — all channels); only those an edit touches — tools/lane.py guard (docs/PARALLEL.md)
  <chapter folder>  work folder of an accepted chapter: timeline.json and its video (channels/<channel>/episodes/<series>/<lang>/chNN/chNN.mp4,
                 or chapter.mp4 in a run.py --work folder)
  --out          where to write: <out>/<chNN> (default <chapter folder>/check/guard)
  --at           shot fractions for the control frames, comma-separated (0.5 — the middle of every shot; 0.08,0.5,0.92 — also start and end)
  --events       plus staging event frames: 35 % and 75 % of every event with a duration (gesture, look, door, step)
  --base         --out of a previous run (frames <base>/<chNN>/new): new frames are compared with them — "after the edit against the base";
                 stricter than against the video (no compression noise): threshold --base-thr 8, patch ≥ --base-blob 25 px
  --no-video     do not compare with the video (only --base); --video — another reference video
  --reuse        do not draw frames that already lie in <out>/new (recompute the report with other thresholds)
  --sheets       pair sheets "accepted | new": bad — only differences (default), all — all frames, none — no sheets

Writes to <out>: new/f_<frame>.png — frames of the current code; pairs/<shot>_<frame>.jpg — a difference sheet (the whole frame and
1:1 crops of the difference places, accepted | new); base_pairs/… — the same against the base; report.md, report.json. Exit code 1 —
there are differences.

Against the video — with a tolerance for h264 compression (crf 18, 4:2:0): luma is compared with the 3×3 neighbourhood (threshold --thr),
chroma at half resolution; a difference is a connected patch of at least --blob px: compression noise gives patches of up to about 24 px,
a visible drawing change (a missing detail, an arm drawn over the torso) — from about 60 px. Against the base — stricter, but not byte for
byte: the same code in two runs rasterises edges slightly differently (anti-aliasing of rotated and thin shapes, invisible to the eye),
which with the 3×3 tolerance and threshold 8 gives patches of up to about 13 px; the patch threshold is 25 px. The report has both
numbers: frames that differ beyond the tolerance (the edit changed the drawing) and frames that differ only in bytes (rasterisation
noise).
Video frame N is taken at time (N − 0.4) / fps: ffmpeg returns the first frame not earlier than the mark.
"""
import argparse
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools import cpu_queue, mirror  # noqa: E402
from tools.pipeline.common import ROOT, accepted_dirs, channel_of, chapter_video, load_json, node_exe, save_json  # noqa: E402
from tools.sheet import font  # noqa: E402

W, H = 1920, 1080  # frame size of the chapter being checked (set from timeline.json)
CHUNK = 120  # frames per stills.mjs run (command line length)


def control_frames(tl: dict, at: list, events: bool, shots=None, scenes=None) -> list:
    """Control frames of a chapter: [(shot, frame, why)] — shot fractions --at and (with --events) 35 % and 75 % of every event."""
    fps = tl['fps']
    out = []
    for s in tl['shots']:
        if (shots and s['id'] not in shots) or (scenes and s['scene'] not in scenes):
            continue
        n = s['to'] - s['from']
        fr = {}
        for a in at:
            fr.setdefault(min(s['to'] - 1, s['from'] + int(a * n)), f'{a:g}')
        if events:
            for e in (s.get('stage') or {}).get('events', []):
                t0, t1 = e.get('t0'), e.get('t1')
                if t0 is None or t1 is None or t1 - t0 <= 0:
                    continue
                for q in (0.35, 0.75):
                    f = min(s['to'] - 1, max(s['from'], s['from'] + round((t0 + q * (t1 - t0)) * fps)))
                    fr.setdefault(f, f"{e['do']} {int(q * 100)}%")
        out += [(s['id'], f, why) for f, why in sorted(fr.items())]
    return out


def render(tl_path: Path, frames: list, new_dir: Path, reuse: bool):
    """Frames of the current code: tools/stills.mjs from the code copy (tools/mirror.py; an own copy — SKINK_MIRROR), composition <channel>-chapter.
    Every chunk goes through the CPU queue of the machine (tools/cpu_queue.py, a stills place): steps of other sessions run between chunks."""
    new_dir.mkdir(parents=True, exist_ok=True)
    need = [f for f in frames if not (reuse and (new_dir / f'f_{f}.png').exists())]
    if not need:
        return
    m = mirror.sync()
    for k in range(0, len(need), CHUNK):
        part = need[k:k + CHUNK]
        with cpu_queue.slot('stills', f'{ROOT.name} guard {tl_path.parent.name} {k // CHUNK + 1}/{-(-len(need) // CHUNK)}', lambda s: print(s, flush=True)):
            r = subprocess.run([node_exe(), str(Path(m) / 'tools' / 'stills.mjs'), f'{channel_of(load_json(tl_path), tl_path)}-chapter', str(new_dir / 'f'),
                                ','.join(map(str, part)), str(tl_path.resolve())], cwd=m, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode:
            sys.exit('stills.mjs: ' + (r.stderr or r.stdout)[-3000:])


def video_frame(mp4: Path, f: int, fps: float) -> np.ndarray:
    """Frame f of the accepted video (RGB): the first frame not earlier than (f − 0.4) / fps."""
    r = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{max(0.0, (f - 0.4) / fps):.4f}', '-i', str(mp4), '-frames:v', '1', '-f', 'rawvideo',
                        '-pix_fmt', 'rgb24', '-'], capture_output=True)
    if r.returncode or len(r.stdout) != W * H * 3:
        raise RuntimeError(f'ffmpeg: frame {f} of {mp4}: {r.stderr.decode("utf-8", "replace")[-300:]}')
    return np.frombuffer(r.stdout, np.uint8).reshape(H, W, 3)


def ycc(a: np.ndarray):
    """RGB → luma Y (full resolution) and chroma Cb, Cr at half resolution (like 4:2:0 video)."""
    x = a.astype(np.float32)
    y = 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]
    cb = (x[..., 2] - y) / 1.8556
    cr = (x[..., 0] - y) / 1.5748
    half = lambda c: c.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3))  # noqa: E731
    return y, half(cb), half(cr)


def out_of_range(a: np.ndarray, b: np.ndarray, size=3) -> np.ndarray:
    """How far a goes beyond the range of b in a size×size neighbourhood, and vice versa — the larger of the two (an edge shift by 1 px and compression ringing give zero)."""
    d1 = np.maximum(ndimage.minimum_filter(b, size=size) - a, a - ndimage.maximum_filter(b, size=size))
    d2 = np.maximum(ndimage.minimum_filter(a, size=size) - b, b - ndimage.maximum_filter(a, size=size))
    return np.maximum(np.maximum(d1, d2), 0)


def diff_video(new: np.ndarray, ref: np.ndarray, thr: float) -> np.ndarray:
    """Difference mask of a code frame and a video frame with a tolerance for compression: luma — threshold thr, chroma (half resolution) — 1.5 thr."""
    y0, cb0, cr0 = ycc(new)
    y1, cb1, cr1 = ycc(ref)
    m = out_of_range(y0, y1) > thr
    mc = np.maximum(out_of_range(cb0, cb1), out_of_range(cr0, cr1)) > 1.5 * thr
    return m | np.repeat(np.repeat(mc, 2, axis=0), 2, axis=1)


def diff_base(new: np.ndarray, old: np.ndarray, thr: float) -> np.ndarray:
    """Difference mask of two code frames (base and after the edit) with a tolerance for rasterisation noise: every RGB channel with a 3×3 neighbourhood."""
    d = np.zeros(new.shape[:2], np.float32)
    for c in range(3):
        d = np.maximum(d, out_of_range(new[..., c].astype(np.float32), old[..., c].astype(np.float32)))
    return d > thr


def blobs(mask: np.ndarray, top=3) -> list:
    """Connected difference patches (adjacent pieces within 4 px are one patch): [{area, box}] by decreasing area."""
    if not mask.any():
        return []
    lab, n = ndimage.label(ndimage.binary_dilation(mask, iterations=2), structure=np.ones((3, 3)))
    area = ndimage.sum(mask, lab, range(1, n + 1))
    objs = ndimage.find_objects(lab)
    out = []
    for i in np.argsort(area)[::-1][:top]:
        sl = objs[i]
        out.append({'area': int(area[i]), 'box': [int(sl[1].start), int(sl[0].start), int(sl[1].stop), int(sl[0].stop)]})
    return out


def pair_sheet(ref: np.ndarray, new: np.ndarray, bl: list, title: str, names: tuple, out: Path):
    """Pair sheet: whole frames on top (at half size, difference patches boxed), 1:1 crops of up to three largest patches below — reference | new."""
    f1, f2 = font(26), font(20)
    CW, CH, BAR = 300, 250, 40
    S = Image.new('RGB', (W, BAR + H // 2 + (BAR + CH if bl else 0)), (14, 16, 26))
    d = ImageDraw.Draw(S)
    d.text((12, 6), f'{title} · left {names[0]}, right {names[1]}', fill=(235, 238, 245), font=f1)
    for k, a in enumerate((ref, new)):
        im = Image.fromarray(a).resize((W // 2, H // 2), Image.LANCZOS)
        S.paste(im, (k * W // 2, BAR))
        for b in bl:
            d.rectangle([k * W // 2 + b['box'][0] // 2 - 4, BAR + b['box'][1] // 2 - 4, k * W // 2 + b['box'][2] // 2 + 4, BAR + b['box'][3] // 2 + 4],
                        outline=(255, 60, 60), width=2)
    for i, b in enumerate(bl[:3]):
        x0, y0, x1, y1 = b['box']
        k = max(1.0, (x1 - x0 + 40) / CW, (y1 - y0 + 40) / CH)  # a patch larger than a cell — the crop is wider, the cell shrinks it k times
        cw, ch = int(CW * k), int(CH * k)
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        bx = min(max(0, cx - cw // 2), W - cw) if cw <= W else 0
        by = min(max(0, cy - ch // 2), H - ch) if ch <= H else 0
        X = 12 + i * (2 * CW + 36)
        Y = BAR + H // 2 + BAR
        d.text((X, Y - 30), f'patch {i + 1}: {b["area"]} px at ({cx}, {cy})' + ('' if k == 1 else f', crop ×{1 / k:.2f}') + ' — 1:1' * (k == 1), fill=(255, 190, 90), font=f2)
        for j, a in enumerate((ref, new)):
            c = Image.fromarray(a).crop((bx, by, min(W, bx + cw), min(H, by + ch)))
            if k > 1:
                c = c.resize((max(1, round(c.width / k)), max(1, round(c.height / k))), Image.LANCZOS)
            S.paste(c, (X + j * (CW + 6), Y))
    out.parent.mkdir(parents=True, exist_ok=True)
    S.save(out, quality=90)


def chapter(wd: Path, out: Path, a, name: str) -> dict:
    tl_path = wd / 'timeline.json'
    tl = load_json(tl_path)
    fps = tl['fps']
    global W, H
    W, H = tl.get('width', 1920), tl.get('height', 1080)
    mp4 = Path(a.video) if a.video else chapter_video(wd)
    jobs = control_frames(tl, a.at, a.events, a.shots, a.scenes)
    if not jobs:
        sys.exit(f'{wd.name}: no shots')
    t0 = time.time()
    render(tl_path, [f for _, f, _ in jobs], out / 'new', a.reuse)
    t_render = time.time() - t0
    base = None
    if a.base:
        base = Path(a.base)
        base = next((p for p in (base / name / 'new', base / 'new', base) if p.is_dir() and any(p.glob('f_*.png'))), None)
        if base is None:
            sys.exit(f'--base {a.base}: no f_*.png frames (neither in <base>/{name}/new nor in <base>/new)')
    rows = []
    for sid, f, why in jobs:
        new = np.array(Image.open(out / 'new' / f'f_{f}.png').convert('RGB'))
        row = {'shot': sid, 'frame': f, 't': round(f / fps, 2), 'why': why}
        tag = f'{wd.name} · shot {sid} · frame {f} · {f / fps:.2f} s ({why})'
        if not a.no_video:
            ref = video_frame(mp4, f, fps)
            m = diff_video(new, ref, a.thr)
            bl = blobs(m)
            row.update(share=round(float(m.mean()) * 100, 4), blob=bl[0]['area'] if bl else 0, blobs=bl)
            row['diff'] = bool(bl and bl[0]['area'] >= a.blob)
            if a.sheets == 'all' or (a.sheets == 'bad' and row['diff']):
                row['pair'] = f'pairs/{sid}_{f}.jpg'
                pair_sheet(ref, new, [b for b in bl if b['area'] >= a.blob], tag, (f'accepted ({mp4.name})', 'new (current code)'), out / row['pair'])
        if base is not None:
            bp = base / f'f_{f}.png'
            if not bp.exists():
                row['base'] = None  # the frame is not in the base
            else:
                old = np.array(Image.open(bp).convert('RGB'))
                row['base_px'] = int((old != new).any(axis=2).sum())  # any difference, including rasterisation noise
                bb = [b for b in blobs(diff_base(new, old, a.base_thr))] if row['base_px'] else []
                row['base'] = bb[0]['area'] if bb and bb[0]['area'] >= a.base_blob else 0
                if row['base'] and a.sheets != 'none':
                    row['base_pair'] = f'base_pairs/{sid}_{f}.jpg'
                    pair_sheet(old, new, [b for b in bb if b['area'] >= a.base_blob], tag, ('base (before the edit)', 'after the edit'), out / row['base_pair'])
        rows.append(row)
    bad = [r for r in rows if r.get('diff')]
    bad_base = [r for r in rows if r.get('base')]
    no_base = [r for r in rows if 'base' in r and r['base'] is None]
    rep = {'chapter': wd.name, 'timeline': str(tl_path), 'video': None if a.no_video else str(mp4), 'base': str(base) if base else None, 'at': a.at, 'events': a.events,
           'thr': a.thr, 'blob_min': a.blob, 'frames': len(rows), 'shots': len({r['shot'] for r in rows}), 'diff': len(bad), 'diff_shots': sorted({r['shot'] for r in bad}),
           'base_diff': len(bad_base), 'base_diff_shots': sorted({r['shot'] for r in bad_base}), 'base_missing': len(no_base),
           'base_noise': sum(1 for r in rows if r.get('base_px') and not r.get('base')), 'base_thr': a.base_thr, 'base_blob_min': a.base_blob,
           'render_sec': round(t_render, 1), 'rows': rows}
    save_json(out / 'report.json', rep)
    md = [f'# Accepted chapter guard {wd.name}', '',
          f'- Control frames: {len(rows)} (shots {rep["shots"]}; shot fractions {", ".join(f"{x:g}" for x in a.at)}{"; event frames" if a.events else ""}); render {t_render:.0f} s']
    if not a.no_video:
        md += [f'- Against the accepted video `{mp4.name}` (threshold {a.thr:g}, patch ≥ {a.blob} px): differences in **{len(bad)}** frames in {len(rep["diff_shots"])} shots'
               + (f' — {", ".join(rep["diff_shots"])}' if bad else '')]
    if base is not None:
        md += [f'- Against the base `{base}` (threshold {a.base_thr:g}, patch ≥ {a.base_blob} px): **{len(bad_base)}** frames differ in {len(rep["base_diff_shots"])} shots'
               + (f' — {", ".join(rep["base_diff_shots"])}' if bad_base else '') + f'; another {rep["base_noise"]} frames differ only in bytes — rasterisation noise within the tolerance'
               + (f'; not in the base: {len(no_base)}' if no_base else '')]
    if bad:
        md += ['', '## Differences from the accepted video', '', '| Shot | Frame | s | Why this frame | Difference share, % | Patch, px | Place (x0, y0, x1, y1) | Sheet |', '|---|---|---|---|---|---|---|---|']
        md += [f'| {r["shot"]} | {r["frame"]} | {r["t"]} | {r["why"]} | {r["share"]} | {r["blob"]} | {r["blobs"][0]["box"]} | {r.get("pair", "")} |' for r in bad]
    if bad_base:
        md += ['', '## Differences from the base', '', '| Shot | Frame | s | Patch, px | Total differing px | Sheet |', '|---|---|---|---|---|---|']
        md += [f'| {r["shot"]} | {r["frame"]} | {r["t"]} | {r["base"]} | {r["base_px"]} | {r.get("base_pair", "")} |' for r in bad_base]
    (out / 'report.md').write_text('\n'.join(md) + '\n', encoding='utf-8')
    print(f'{wd.name}: frames {len(rows)}' + ('' if a.no_video else f', differences with the video {len(bad)} ({", ".join(rep["diff_shots"]) or "—"})')
          + ('' if base is None else f', differences from the base {len(bad_base)} ({", ".join(rep["base_diff_shots"]) or "—"})') + f' → {out / "report.md"}', flush=True)
    return rep


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('work', nargs='*')
    ap.add_argument('--accepted', nargs='?', const='*')
    ap.add_argument('--out')
    ap.add_argument('--at', default='0.5')
    ap.add_argument('--events', action='store_true')
    ap.add_argument('--shots')
    ap.add_argument('--scenes')
    ap.add_argument('--base')
    ap.add_argument('--video')
    ap.add_argument('--no-video', action='store_true')
    ap.add_argument('--reuse', action='store_true')
    ap.add_argument('--sheets', default='bad', choices=['bad', 'all', 'none'])
    ap.add_argument('--thr', type=float, default=24)
    ap.add_argument('--blob', type=int, default=40)
    ap.add_argument('--base-thr', type=float, default=8)
    ap.add_argument('--base-blob', type=int, default=25)
    a = ap.parse_args()
    a.at = [float(x) for x in a.at.split(',')]
    a.shots = [x.strip() for x in a.shots.split(',')] if a.shots else None
    a.scenes = [x.strip().zfill(2) for x in a.scenes.split(',')] if a.scenes else None
    if a.accepted:
        for cd in sorted(p for p in (ROOT / 'channels').glob(a.accepted) if p.is_dir()):
            a.work += [str(w) for w in accepted_dirs(cd)]
    if not a.work:
        sys.exit('no chapters: a chapter folder or --accepted (channels/<channel>/accepted/*.txt)')
    if a.video and len(a.work) > 1:
        sys.exit('--video — only for one chapter')
    bad = 0
    works = [Path(w).resolve() for w in a.work]
    for wd in works:
        # chapter name in --out and --base: chNN; for chapters of different series with the same number — <series>_<lang>_<chNN>
        name = wd.name if sum(x.name == wd.name for x in works) == 1 else '_'.join(wd.parts[-3:])
        out = Path(a.out).resolve() / name if a.out else wd / 'check' / 'guard'
        rep = chapter(wd, out, a, name)
        bad += rep['diff'] + rep['base_diff']
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
