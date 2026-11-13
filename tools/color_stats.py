"""Colour measurement of video and frames.

1) By chapter shots — the way preset norms are measured:
   python tools/color_stats.py <video.mp4> --timeline <timeline.json> [--at 0.55] [--presets day,night] [--json out.json]
   python tools/color_stats.py --stills "<folder>/c_{frame}.png" --timeline <timeline.json> [--at 0.55]   — clean frames of sheets.py --clean
   A shot frame at fraction --at (several fractions, comma-separated — the median over the shot frames), a band of 5–82 % of the height
   (without the title bar at the top and the line at the bottom), scaled to width 320. A row per shot and medians per preset.
2) The whole video (a frame every --every seconds, the whole frame):
   python tools/color_stats.py <video.mp4> [<video.mp4> …] [--every 1] [--until 27.5] [--shots 0,6.33,11.6]
   python tools/color_stats.py "name=path/frames_*.png" …   — a group of stills instead of a video

S, V — mean saturation and value (HSV); σY — spread of luma Y (Rec. 709); Colorf. — colorfulness (Hasler–Süsstrunk);
"Accent" — share of pixels with S > 0.6 and V > 0.5; "Dark" — share of V < 0.3; "Light" — share of Y > 0.7; "S of dark" — mean S of dark
pixels; "R/G/B of midtones" — the mean colour of pixels with luma Y between the 10th and the 90th percentile, 0–255;
"Blue" — share of pixels with hue 200–275°, S > 0.25 and V > 0.06; "Red" — hue ≤ 15° or ≥ 345°, S > 0.5 and V > 0.12.
The check step against the preset references — tools/pipeline/color_check.py (takes band_pixels, stats, shot_stats from here).
"""
import glob
import json
import subprocess
import sys

import numpy as np
from PIL import Image

TOP, BOT, WIDTH = 0.05, 0.82, 320  # frame band and measurement width of the preset norms


def band_pixels(im: Image.Image, top=TOP, bot=BOT, width=WIDTH) -> np.ndarray:
    """Frame → pixels of the band top–bot of the height, scaled to width width (0..1, N×3)."""
    im = im.convert('RGB')
    w, h = im.size
    im = im.crop((0, round(h * top), w, round(h * bot)))
    small = im.resize((width, max(1, round(width * im.height / im.width))), Image.BILINEAR)
    return np.asarray(small, dtype=np.float32).reshape(-1, 3) / 255.0


def video_frame(path, t: float, size=(1920, 1080)) -> Image.Image:
    """Video frame at second t (ffmpeg), at size size."""
    w, h = size
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{max(0.0, t):.3f}', '-i', str(path), '-frames:v', '1', '-vf', f'scale={w}:{h}:flags=bilinear',
                          '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    return Image.frombuffer('RGB', (w, h), raw, 'raw', 'RGB', 0, 1)


def stats(pix: np.ndarray) -> dict:
    mx = pix.max(1); mn = pix.min(1)
    s = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0)
    v = mx
    y = 0.2126 * pix[:, 0] + 0.7152 * pix[:, 1] + 0.0722 * pix[:, 2]
    rg = pix[:, 0] - pix[:, 1]
    yb = 0.5 * (pix[:, 0] + pix[:, 1]) - pix[:, 2]
    colorful = np.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2)
    dark = v < 0.30
    mid = (y >= np.percentile(y, 10)) & (y <= np.percentile(y, 90))
    rgb = (pix[mid].mean(0) * 255).round().astype(int)
    hue = np.degrees(np.arctan2(np.sqrt(3) * (pix[:, 1] - pix[:, 2]), 2 * pix[:, 0] - pix[:, 1] - pix[:, 2])) % 360
    blue = ((hue >= 200) & (hue <= 275) & (s > 0.25) & (v > 0.06)).mean() * 100
    red = (((hue <= 15) | (hue >= 345)) & (s > 0.5) & (v > 0.12)).mean() * 100
    return dict(red=float(red), blue=float(blue), rgb='/'.join(map(str, rgb)), S=float(s.mean()), V=float(v.mean()), Y=float(y.mean()), sY=float(y.std()),
                C=float(colorful * 255), acc=float(((s > 0.6) & (v > 0.5)).mean() * 100), dark=float(dark.mean() * 100), light=float((y > 0.7).mean() * 100),
                Sd=float(s[dark].mean()) if dark.any() else 0.0)


NUM = ('S', 'V', 'Y', 'sY', 'C', 'acc', 'dark', 'light')


def shot_frames(shot: dict, at=(0.55,)) -> list:
    """Frame numbers of a shot at fractions at (as sheets.py)."""
    n = shot['to'] - shot['from']
    return [min(shot['to'] - 1, shot['from'] + int(a * n)) for a in at]


def shot_stats(tl: dict, get_frame, at=(0.55,), presets=None) -> list:
    """Measurement over timeline shots. get_frame(frame number) → PIL.Image or None. Several fractions at — the median of the metrics over the shot frames."""
    rows = []
    for s in tl['shots']:
        if presets and s['preset'] not in presets:
            continue
        per = []
        for f in shot_frames(s, at):
            im = get_frame(f)
            if im is not None:
                per.append(stats(band_pixels(im)))
        if not per:
            continue
        row = {'shot': s['id'], 'scene': s['scene'], 'preset': s['preset'], 'kit': s.get('kit'), 'view': s.get('view'), 'frames': len(per)}
        for k in NUM:
            row[k] = float(np.median([p[k] for p in per]))
        row['rgb'] = per[len(per) // 2]['rgb']
        rows.append(row)
    return rows


def medians(rows: list, key='preset') -> dict:
    out = {}
    for g in sorted({r[key] for r in rows}):
        grp = [r for r in rows if r[key] == g]
        out[g] = {'n': len(grp), **{k: float(np.median([r[k] for r in grp])) for k in NUM},
                  **{k + '_q': [float(np.percentile([r[k] for r in grp], q)) for q in (0, 25, 75, 100)] for k in NUM}}
    return out


def fmt(x, nd=2):
    return f'{x:.{nd}f}'.replace('.', ',')


def table(rows: list) -> str:
    md = ['| Shot | Preset | Kit / view | S | σY | Colorf. | Accent, % | Dark, % | Light, % | Y |', '|---|---|---|---|---|---|---|---|---|---|']
    for r in rows:
        md.append(f"| {r['shot']} | {r['preset']} | {r.get('kit') or '—'} / {r.get('view') or '—'} | {fmt(r['S'])} | {fmt(r['sY'])} | {r['C']:.0f} | {fmt(r['acc'], 1)} | {r['dark']:.0f} | {r['light']:.0f} | {fmt(r['Y'])} |")
    md += ['', '| Preset | Shots | S: median (25–75 %) | σY | Colorf. | Accent, % | Dark, % |', '|---|---|---|---|---|---|---|']
    for g, m in medians(rows).items():
        q = lambda k, nd=2: f"{fmt(m[k], nd)} ({fmt(m[k + '_q'][1], nd)}–{fmt(m[k + '_q'][2], nd)})"
        md.append(f"| {g} | {m['n']} | {q('S')} | {q('sY')} | {q('C', 0)} | {q('acc', 1)} | {q('dark', 0)} |")
    return '\n'.join(md)


def main_timeline(args):
    def opt(name, default=None):
        if name in args:
            i = args.index(name); v = args[i + 1]; del args[i:i + 2]
            return v
        return default
    tl = json.load(open(opt('--timeline'), encoding='utf-8'))
    at = tuple(float(x) for x in opt('--at', '0.55').split(','))
    presets = opt('--presets')
    presets = set(presets.split(',')) if presets else None
    stills = opt('--stills')
    out = opt('--json')
    if stills:
        def get(f):
            p = stills.replace('{frame}', str(f))
            return Image.open(p) if glob.glob(p) else None
    else:
        video = args[0]

        def get(f):
            return video_frame(video, (f + 0.5) / tl['fps'], (tl.get('width', 1920), tl.get('height', 1080)))
    rows = shot_stats(tl, get, at, presets)
    print(table(rows))
    if out:
        json.dump({'rows': rows, 'medians': medians(rows), 'at': at, 'band': [TOP, BOT], 'width': WIDTH}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


def main_video(args):
    every, until = 1.0, 27.5
    shots = None  # --shots 0,6.33,11.6,19,27.5 — also a row per shot
    if '--shots' in args:
        i = args.index('--shots'); shots = [float(x) for x in args[i + 1].split(',')]; del args[i:i + 2]
    if '--every' in args:
        i = args.index('--every'); every = float(args[i + 1]); del args[i:i + 2]
    if '--until' in args:
        i = args.index('--until'); until = float(args[i + 1]); del args[i:i + 2]

    def frames(path, a=0.0, b=None):
        ts = np.arange(a + 0.5, (until if b is None else b) + 1e-6, every)
        return [np.asarray(video_frame(path, t, (320, 180)), dtype=np.float32).reshape(-1, 3) / 255.0 for t in ts]

    def images(pattern):
        return [np.asarray(Image.open(p).convert('RGB').resize((320, 180), Image.BILINEAR), dtype=np.float32).reshape(-1, 3) / 255.0 for p in sorted(glob.glob(pattern))]

    def line(name, st):
        print(f"| {name} | {st['S']:.2f} | {st['V']:.2f} | {st['sY']:.2f} | {st['C']:.0f} | {st['acc']:.1f} | {st['dark']:.0f} | {st['Sd']:.2f} | {st['rgb']} | {st['blue']:.0f} | {st['red']:.0f} |")

    print('| Video | S | V | σY | Colorf. | Accent, % | Dark, % | S of dark | R/G/B of midtones | Blue, % | Red, % |')
    print('|---|---|---|---|---|---|---|---|---|---|---|')
    for arg in args:
        is_group = '=' in arg
        if is_group:
            path, pattern = arg.split('=', 1)
            fr = images(pattern)
        else:
            path = arg
            fr = frames(path)
        name = path.replace('\\', '/').split('/')[-1]
        line(name, stats(np.concatenate(fr)))
        if shots and not is_group:
            for j in range(len(shots) - 1):
                line(f'{name} · shot {j + 1}', stats(np.concatenate(frames(path, shots[j], shots[j + 1] - 0.5))))


if __name__ == '__main__':
    argv = sys.argv[1:]
    (main_timeline if '--timeline' in argv else main_video)(argv)
