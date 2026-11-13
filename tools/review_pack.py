"""The pack of a chapter reviewer (docs/REVIEW.md): the chapter is split into parts by shots, every part gets ready pictures and measurements.

python tools/review_pack.py <chapter work folder> [--parts 8] [--out <folder>] [--only 3,4] [--video <mp4>] [--threads 8]
python tools/review_pack.py crop <frame.jpg> <x,y,w,h> [<x,y,w,h> …] -o <crop.png>   # a 1:1 crop; numbers ≤ 1 — frame fractions, else px

Output — <chapter>/check/review/pack/ (or --out):
  pack.md                 the contents: parts (shots, time), the machine reports of the chapter
  partN/pack.md           the shots of the part (camera, ON SCREEN, cast, events, lines, frames), sounds, the bed at the cuts, line loudness
  partN/grid_K.jpg        a 4×4 grid — a frame every second, 1280 px; on a cell — the second and the shot (production rule 14, the first layer)
  partN/shots/<shot>.jpg  key frames of a shot, 640 px, up to 4 per sheet (rule 14, the second layer: the middle of a static shot; the
                          start, after every event, emotion and card, and the end; for a push-in — the start and the end)
  partN/sounds_K.jpg      a frame at the moment of every sound and music insert of the part, 640 px, up to 4 per sheet
  partN/full/*.jpg        the same frames at full size — for 1:1 crops (the crop subcommand)
Frames — one ffmpeg process for the whole chapter (select by frame numbers → rawvideo into a pipe). Sound — audio/amb.wav, speech.wav,
mix.wav of the work folder (numpy, no ffmpeg): the RMS of the bed in 0.1 s windows around the cuts, the LUFS of every line (BS.1770: the K
filter, gating).
"""
import argparse
import json
import math
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.pipeline.common import chapter_video  # noqa: E402
from tools.sheet import font  # noqa: E402

FULL_Q = 93  # JPEG quality of the full frames (the source of crops)
VIEW_Q = 85  # JPEG quality of the sheets
MAX_KEYS = 8  # key frames per shot, at most
GRID = 4  # a GRID × GRID grid
CELL = (320, 180)  # a grid cell: 1280 px for 4 columns
VIEW = (640, 360)  # a frame of a shot sheet and of a sound sheet


def mmss(t):
    return f'{int(t // 60)}:{t % 60:05.2f}'


# ---------- parts and key moments ----------

def split_parts(shots, n):
    """Part borders — the cuts nearest to k·D/n (every part has at least one shot)."""
    n = max(1, min(n, len(shots)))
    D = shots[-1]['end']
    cuts, last = [], 0
    for k in range(1, n):
        lo, hi = last + 1, len(shots) - (n - k)
        if lo > hi:
            break
        j = min(range(lo, hi + 1), key=lambda j: abs(shots[j]['start'] - D * k / n))
        cuts.append(j)
        last = j
    idx = [0] + cuts + [len(shots)]
    return [shots[a:b] for a, b in zip(idx, idx[1:])]


def ev_name(e):
    s = e['do']
    if e.get('pose'):
        s += ':' + str(e['pose'])
    for k in ('who', 'obj'):
        if e.get(k):
            s += ' ' + str(e[k])
    if e.get('to') and e['do'] == 'look':
        s += ' →' + str(e['to'])
    return s


def key_moments(s):
    """Key moments of a shot (absolute time, a tag): production rule 14."""
    a, b = s['start'], s['end']
    dur = b - a
    t_in = a + min(dur / 3, 0.1 + (s.get('dipIn') or 0))
    t_out = b - min(dur / 3, 0.12 + (s.get('dipOut') or 0))
    clamp = lambda t: min(max(t, t_in), t_out)
    marks = [(clamp(a + float(e['t1']) + 0.15), 'after ' + ev_name(e)) for e in (s.get('stage') or {}).get('events', [])
             if e['do'] not in ('set', 'cue') and not e.get('carried')]
    for m in s.get('cast') or []:
        emo = m.get('emo') or []
        marks += [(clamp(a + dur * i / len(emo) + 0.5), f'emo {m["who"]} {emo[i]}') for i in range(1, len(emo)) if emo[i] != emo[i - 1]]
    marks += [(clamp(a + float(c['from']) + 0.5), 'card ' + str(c.get('label', ''))) for c in s.get('cards') or [] if c.get('from') is not None]
    if not marks and s.get('move', 'static') == 'static':
        return [((a + b) / 2, 'mid')]
    out = []
    for t, tag in [(t_in, 'start')] + sorted(marks) + [(t_out, 'end')]:  # moments closer than 0.25 s — one frame
        if out and t - out[-1][0] < 0.25:
            out[-1] = (out[-1][0], out[-1][1] + ' + ' + tag)
        else:
            out.append((t, tag))
    if len(out) > MAX_KEYS:
        mid = out[1:-1]
        step = len(mid) / (MAX_KEYS - 2)
        out = [out[0]] + [mid[int(i * step)] for i in range(MAX_KEYS - 2)] + [out[-1]]
    return out


# ---------- sound ----------

def read_wav(p: Path):
    """WAV → (float32 [n, ch], sr); not PCM16 — through ffmpeg."""
    try:
        with wave.open(str(p)) as w:
            sr, ch, sw, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
            if sw == 2:
                return np.frombuffer(w.readframes(n), '<i2').astype(np.float32).reshape(-1, ch) / 32768.0, sr
    except (wave.Error, EOFError):
        pass
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(p), '-ar', '48000', '-f', 'f32le', '-'], capture_output=True, check=True)
    ch = int(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', str(p)],
                            capture_output=True, text=True).stdout.strip() or 1)
    return np.frombuffer(r.stdout, np.float32).reshape(-1, ch), 48000


def k_weight(x, sr):
    """The BS.1770 K filter (a shelf + a high-pass, coefficients for the sample rate), the sum of the squares of the channels."""
    from scipy.signal import lfilter
    K = math.tan(math.pi * 1681.974450955533 / sr)
    Vh = 10 ** (3.999843853973347 / 20)
    Vb = Vh ** 0.4996667741545416
    Q = 0.7071752369554196
    a0 = 1 + K / Q + K * K
    b1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
    a1 = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    K = math.tan(math.pi * 38.13547087602444 / sr)
    Q = 0.5003270373238773
    a0 = 1 + K / Q + K * K
    a2 = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    y = lfilter([1, -2, 1], a2, lfilter(b1, a1, x, axis=0), axis=0)
    return np.sum(y.astype(np.float64) ** 2, axis=1)


class Track:
    """A track for the measurements: cumulative sums of the squares (RMS) and of the K-weighted squares (LUFS)."""

    def __init__(self, p: Path, lufs=True):
        x, self.sr = read_wav(p)
        self.c = np.concatenate([[0.0], np.cumsum(np.mean(x.astype(np.float64) ** 2, axis=1))])
        self.k = np.concatenate([[0.0], np.cumsum(k_weight(x, self.sr))]) if lufs else None
        self.n = len(x)

    def _i(self, t):
        return int(min(max(t, 0), self.n / self.sr) * self.sr)

    def rms_db(self, a, b):
        i0, i1 = self._i(a), self._i(b)
        return 20 * math.log10(math.sqrt(max((self.c[i1] - self.c[i0]) / max(1, i1 - i0), 0)) + 1e-9) if i1 > i0 else None

    def lufs(self, a, b):
        i0, i1 = self._i(a), self._i(b)
        blk, hop = int(0.4 * self.sr), int(0.1 * self.sr)
        if i1 - i0 < 2:
            return None
        if i1 - i0 < blk:
            z = np.array([(self.k[i1] - self.k[i0]) / (i1 - i0)])
        else:
            s = np.arange(i0, i1 - blk + 1, hop)
            z = (self.k[s + blk] - self.k[s]) / blk
        L = lambda v: -0.691 + 10 * np.log10(np.maximum(v, 1e-15))
        z = z[L(z) > -70]
        if not len(z):
            return None
        z = z[L(z) > L(z.mean()) - 10]
        return float(L(z.mean()))


# ---------- frames ----------

def sel_expr(ns):
    """A select expression by frame numbers as a balanced tree of sums: a long chain eq(n,…)+… overflows the expression parser stack of
    ffmpeg (~100 levels), a tree of 1000 numbers has 10 levels."""
    if len(ns) == 1:
        return f'eq(n,{ns[0]})'
    m = len(ns) // 2
    return f'({sel_expr(ns[:m])}+{sel_expr(ns[m:])})'


def grab(video: Path, need: dict, fps: float, threads: int, on_frame):
    """One ffmpeg process: the frames numbered need (ascending) → on_frame(n, Image)."""
    ns = sorted(need)
    W, H = 1920, 1080
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', str(video)],
                       capture_output=True, text=True)
    if r.stdout.strip():
        W, H = map(int, r.stdout.strip().split(',')[:2])
    with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='ascii') as f:
        f.write("select='" + sel_expr(ns) + "'")
        script = f.name
    cmd = ['ffmpeg', '-nostdin', '-v', 'error', '-threads', str(threads), '-i', str(video), '-t', f'{(ns[-1] + 2) / fps:.3f}', '-/vf', script,
           '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    size = W * H * 3
    got = 0
    try:
        for n in ns:
            buf = p.stdout.read(size)
            if len(buf) < size:
                break
            on_frame(n, Image.frombuffer('RGB', (W, H), buf, 'raw', 'RGB', 0, 1))
            got += 1
    finally:
        p.stdout.close()
        p.wait()
        Path(script).unlink(missing_ok=True)
    if got < len(ns):
        print(f'review_pack: ffmpeg returned {got} frames of {len(ns)} (is the video shorter than the timeline?)', file=sys.stderr)
    return got


def sheet(items, cell, cols, title, out: Path, lab_sz):
    """A sheet: pictures of size cell, cols per row, a label under each (items: [(Image, label, colour)])."""
    bar, top = lab_sz + 10, lab_sz + 16
    rows = (len(items) + cols - 1) // cols
    im = Image.new('RGB', (cols * cell[0], top + rows * (cell[1] + bar)), (14, 16, 26))
    d = ImageDraw.Draw(im)
    d.text((10, 4), title, fill=(235, 238, 245), font=font(lab_sz + 2))
    f = font(lab_sz, bold=False)
    for k, (img, lab, col) in enumerate(items):
        x, y = (k % cols) * cell[0], top + (k // cols) * (cell[1] + bar)
        im.paste(img, (x, y))
        d.rectangle([x, y, x + cell[0] - 1, y + cell[1] - 1], outline=(14, 16, 26), width=1)
        d.text((x + 6, y + cell[1] + 3), lab, fill=col, font=f)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, quality=VIEW_Q)


# ---------- the pack ----------

def build(wd: Path, nparts: int, out: Path, only, video: Path | None, threads: int):
    t_start = time.time()
    tl = json.loads((wd / 'timeline.json').read_text(encoding='utf-8'))
    fps, shots = tl['fps'], tl['shots']
    nfr = tl.get('frames') or int(round(tl['duration'] * fps))
    video = video or next((p for p in (chapter_video(wd), wd / 'render' / 'video.mp4') if p.exists()), None)
    if not video:
        sys.exit(f'review_pack: no chapter video ({chapter_video(wd).name} or render/video.mp4) — give --video')
    parts = split_parts(shots, nparts)
    sel = set(only) if only else set(range(1, len(parts) + 1))
    fno = lambda t: min(nfr - 1, max(0, int(round(t * fps))))

    ad = wd / 'audio'
    amb = Track(ad / 'amb.wav', lufs=False) if (ad / 'amb.wav').exists() else None
    speech = Track(ad / 'speech.wav') if (ad / 'speech.wav').exists() else None
    mix = Track(ad / 'mix.wav') if (ad / 'mix.wav').exists() else None
    t_audio = time.time() - t_start

    need = {}  # frame number → [(kind, path)]: 'full' — a full-size JPEG, 'grid' / 'view' — a smaller copy for a sheet
    thumbs = {}  # (kind, frame number) → Image

    def want(n, kind, path=None):
        need.setdefault(n, [])
        if (kind, path) not in need[n]:
            need[n].append((kind, path))

    plan = []
    for pi, ps in enumerate(parts, 1):
        a, b = ps[0]['start'], ps[-1]['end']
        P = {'n': pi, 'shots': ps, 'a': a, 'b': b, 'dir': out / f'part{pi}', 'keys': {}, 'sounds': [], 'grid': []}
        plan.append(P)
        if pi not in sel:
            continue
        P['grid'] = [t for t in range(math.ceil(a), math.ceil(b)) if a <= t < b]
        for t in P['grid']:
            want(fno(t), 'grid')
        for s in ps:
            keys = []
            for t, tag in key_moments(s):
                n = fno(t)
                path = P['dir'] / 'full' / f'{s["id"]}_{tag.split()[0]}_{t:.2f}.jpg'
                want(n, 'full', path)
                want(n, 'view')
                keys.append((t, tag, n, path))
            P['keys'][s['id']] = keys
        for x in tl.get('sfx') or []:
            if x.get('bed') or not (a <= x['start'] < b):
                continue
            n = fno(x['start'])
            path = P['dir'] / 'full' / f'sfx_{x["start"]:.2f}_{x["name"]}.jpg'
            want(n, 'full', path)
            want(n, 'view')
            P['sounds'].append(('sfx', x, n, path))
        for m in tl.get('music') or []:
            if a <= m['start'] < b:
                n = fno(m['start'])
                path = P['dir'] / 'full' / f'music_{m["start"]:.2f}.jpg'
                want(n, 'full', path)
                want(n, 'view')
                P['sounds'].append(('music', m, n, path))
        P['sounds'].sort(key=lambda r: r[1]['start'])

    def on_frame(n, img):
        saved = None
        for kind, path in need[n]:
            if kind == 'full':
                path.parent.mkdir(parents=True, exist_ok=True)
                if saved and saved != path:
                    path.write_bytes(saved.read_bytes())
                else:
                    img.save(path, quality=FULL_Q)
                    saved = path
            else:
                thumbs[(kind, n)] = img.resize(CELL if kind == 'grid' else VIEW, Image.BILINEAR, reducing_gap=2.0)

    t0 = time.time()
    got = grab(video, need, fps, threads, on_frame) if need else 0
    t_frames = time.time() - t0
    blank = lambda size: Image.new('RGB', size, (40, 0, 0))
    lab_col = [(255, 190, 90), (140, 200, 255)]

    for P in plan:
        if P['n'] not in sel:
            continue
        d = P['dir']
        d.mkdir(parents=True, exist_ok=True)
        # grids at 1 frame per second; the label colour changes at a cut
        shot_at = lambda t: next((s for s in P['shots'] if s['start'] <= t < s['end']), P['shots'][-1])
        prev, ci, cells, grids = None, 0, [], []
        for t in P['grid']:
            s = shot_at(t)
            if prev and s['id'] != prev:
                ci ^= 1
            prev = s['id']
            cells.append((thumbs.get(('grid', fno(t))) or blank(CELL), f'{t} s · {s["id"]}', lab_col[ci]))
        for g in range(0, len(cells), GRID * GRID):
            ch = cells[g:g + GRID * GRID]
            t0g, t1g = P['grid'][g], P['grid'][g + len(ch) - 1]
            path = d / f'grid_{g // (GRID * GRID) + 1}.jpg'
            sheet(ch, CELL, GRID, f'part {P["n"]} · {t0g}-{t1g} s · 1 fps (label = second · shot)', path, 15)
            grids.append((path, t0g, t1g))
        # shot sheets
        for s in P['shots']:
            keys = P['keys'][s['id']]
            for j in range(0, len(keys), 4):
                ch = [(thumbs.get(('view', n)) or blank(VIEW), f'{t:.2f} s · {tag}'[:70], lab_col[0]) for t, tag, n, _ in keys[j:j + 4]]
                sheet(ch, VIEW, 2, f'{s["id"]} · {s["start"]:.2f}-{s["end"]:.2f} s · {s.get("kit") or s["location"]}/{s.get("view")} · {s.get("move")}',
                      d / 'shots' / f'{s["id"]}{"" if j == 0 else f"_{j // 4 + 1}"}.jpg', 20)
        # sound sheets
        snd_sheets = []
        for j in range(0, len(P['sounds']), 4):
            ch = [(thumbs.get(('view', n)) or blank(VIEW), (f'{x["start"]:.2f} s · {x["shot"]} · '
                   + (f'{x["name"]} · {x.get("event") or ""}' if kind == 'sfx' else f'MUSIC {x["mood"]}'))[:70], lab_col[0]) for kind, x, n, _ in P['sounds'][j:j + 4]]
            path = d / f'sounds_{j // 4 + 1}.jpg'
            sheet(ch, VIEW, 2, f'part {P["n"]} · frame at each sound', path, 20)
            snd_sheets.append(path)
        write_part_md(P, tl, grids, snd_sheets, amb, speech, mix)

    write_index(plan, tl, wd, video, out)
    print(f'review_pack: {len(parts)} parts → {out} · frames {got} (ffmpeg {t_frames:.0f} s), sound {t_audio:.1f} s, total {time.time() - t_start:.0f} s')
    return 0


def rel(p: Path, base: Path):
    try:
        return p.relative_to(base).as_posix()
    except ValueError:
        return p.as_posix()


def bed_stats(tr, t, flag=True):
    """The bed around a cut at t: "before / min / after" (−1.0…−0.6 s, the minimum of 0.1 s windows within ±0.45 s, +0.6…+1.0 s) with ⚠ for
    a dropout, and a profile of 20 windows of 0.1 s from −1 to +1 s."""
    if not tr:
        return '—', ''
    db = lambda v: '—' if v is None else f'{v:.0f}'  # a window outside the track (a cut near its start or end)
    l, r = tr.rms_db(t - 1.0, t - 0.6), tr.rms_db(t + 0.6, t + 1.0)
    prof = [tr.rms_db(t - 1.0 + k * 0.1, t - 0.9 + k * 0.1) for k in range(20)]
    lo = min((v for v in (tr.rms_db(t + k * 0.1, t + k * 0.1 + 0.1) for k in range(-5, 4)) if v is not None), default=None)
    dip = None not in (l, r, lo) and min(l, r) > -70 and lo < min(l, r) - 6
    return (f'{db(l)} / {db(lo)} / {db(r)}' + (' ⚠' if dip and flag else ''),
            ' '.join(db(v) for v in prof[:10]) + ' \\| ' + ' '.join(db(v) for v in prof[10:]))


def write_part_md(P, tl, grids, snd_sheets, amb, speech, mix):
    d = P['dir']
    L = [f'# Part {P["n"]} · shots {P["shots"][0]["id"]}–{P["shots"][-1]["id"]} · {P["a"]:.1f}–{P["b"]:.1f} s ({mmss(P["a"])}–{mmss(P["b"])})', '',
         'Paths are relative to this folder. The memo — `docs/REVIEW.md`. A 1:1 crop from `full/`: '
         '`python tools/review_pack.py crop <full/frame.jpg> x,y,w,h -o crops/<name>.png` (≤ 1 — frame fractions).', '',
         '## Grids at 1 frame per second (4×4, 1280 px)', '']
    L += [f'- `{rel(p, d)}` — {t0}–{t1} s' for p, t0, t1 in grids]
    L += ['', '## Shots', '']
    prev_of = {b['id']: a for a, b in zip(tl['shots'], tl['shots'][1:])}
    lines_by_shot = {}
    for ln in tl.get('lines') or []:
        lines_by_shot.setdefault(ln['shot'], []).append(ln)
    for s in P['shots']:
        a = s['start']
        L.append(f'### {s["id"]} · {a:.2f}–{s["end"]:.2f} s · {s.get("kit") or s["location"] + " (stub)"} / {s.get("view")} · {s.get("move")} · '
                 f'{s.get("preset")}' + (f' · bed {s["bed"]}' if s.get('bed') else ''))
        L.append(f'- camera: {s.get("camera") or "—"}')
        L.append(f'- ON SCREEN: {s.get("on_screen") or "—"}')
        if s.get('cast'):
            L.append('- in the frame: ' + '; '.join(f'{m["who"]} ({" → ".join(m.get("emo") or []) or "—"}, {m.get("facing", "front")}'
                                                     + (f', hold {"/".join(m["hold"])}' if m.get('hold') else '') + ')' for m in s['cast']))
        if s.get('cards'):
            L.append('- text: ' + '; '.join(f'{c.get("label")}: "{c.get("text")}"' for c in s['cards']))
        prev = prev_of.get(s['id'], {})
        if s.get('bar') and (P['shots'][0] is s or (s['bar'], s.get('counter')) != (prev.get('bar'), prev.get('counter'))):
            c = s.get('counter') or {}
            L.append(f'- title bar: {s["bar"]}' + (f' · counter {c.get("current")} of {c.get("total")}' if c else '')
                     + (f', crossed {c["crossed"]}' if c.get('crossed') else '') + (f' · stamp {s["stamp"]}' if s.get('stamp') else ''))
        evs = (s.get('stage') or {}).get('events', [])
        acts = [e for e in evs if e['do'] != 'set']
        if acts:
            L.append('- events: ' + '; '.join(f'{a + float(e["t0"]):.2f}–{a + float(e["t1"]):.2f} {ev_name(e)}' + (' (from the previous shot)' if e.get('carried') else '')
                                               for e in acts))
        sets = [e for e in evs if e['do'] == 'set']
        if sets:
            groups = {}  # door:1, door:3 with the same fields → door:1|3
            for e in sets:
                pre, _, suf = str(e.get('obj')).partition(':')
                kv = ','.join(f'{k}={v}' for k, v in e.items() if k not in ('do', 'obj', 't0', 't1', 'cut', 'why'))
                groups.setdefault((pre, kv, bool(suf)), []).append(suf)
            L.append('- states: ' + '; '.join(f'{pre}:{"|".join(sufs)} {kv}' if has else f'{pre} {kv}' for (pre, kv, has), sufs in groups.items()))
        for ln in lines_by_shot.get(s['id'], []):
            lu = speech.lufs(ln['start'], ln['end']) if speech else None
            L.append(f'- {ln["speaker"]}{" (" + ln["effect"] + ")" if ln.get("effect") else ""} {ln["start"]:.2f}–{ln["end"]:.2f}: "{ln["text"]}"'
                     + (f' · {lu:.1f} LUFS' if lu is not None else ''))
        if s.get('vo_src'):
            L.append('- VO of the source script: ' + ' / '.join(x.strip() for x in s['vo_src']))
        keys = P['keys'].get(s['id'], [])
        sh = [f'shots/{s["id"]}.jpg'] + [f'shots/{s["id"]}_{j // 4 + 1}.jpg' for j in range(4, len(keys), 4)]
        L.append('- frames: ' + ', '.join(f'`{x}`' for x in sh) + ' — ' + '; '.join(f'{t:.2f} {tag} `{rel(p, d)}`' for t, tag, _, p in keys))
        L.append('')
    L += ['## Sounds', '', 'A frame at the moment of the sound; sheets: ' + (', '.join(f'`{rel(p, d)}`' for p in snd_sheets) or '—') + '.', '',
          '| t, s | sound | shot | event / binding | frame |', '|---|---|---|---|---|']
    for kind, x, n, path in P['sounds']:
        if kind == 'sfx':
            ev = x.get('event') or ''
            if ev == 'cue' or x.get('manual'):
                ev = f'cue (manual): {x.get("manual") or ""}'
            if x.get('offscreen'):
                ev += ' · out of frame'
            hits = x.get('hits')
            name = x['name'] + (f' ×{len(hits)} ({hits[0]:.2f}–{hits[-1]:.2f})' if hits and len(hits) > 1 else '') + (' (loop)' if x.get('loop') else '')
        else:
            ev, name = f'{x.get("mood")}, {x.get("dur", 0):.1f} s, track {x.get("track")}', 'MUSIC'
        L.append(f'| {x["start"]:.2f} | {name} | {x["shot"]} | {ev} | `{rel(path, d)}` |')
    beds = [x for x in tl.get('sfx') or [] if x.get('bed') and x['start'] < P['b'] and (x.get('end') or 1e9) > P['a']]
    if beds:
        L += ['', 'Beds: ' + '; '.join(f'{x["name"]} {x["start"]:.2f}–{x.get("end") or 0:.2f} ({Path(x.get("file") or "").name})' for x in beds)]
    L += ['', '## The bed at the cuts', '',
          'RMS, dBFS: `audio/amb.wav` (the beds track) and `mix.wav` (all the sound). "before / min / after" — −1.0…−0.6 s, the minimum of 0.1 s '
          'windows within ±0.45 s, +0.6…+1.0 s; the profile — 20 windows of 0.1 s from −1 to +1 s, `|` — the cut. ⚠ — a bed dropout: the minimum is '
          'more than 6 dB below the quieter neighbour (in the mix a minimum at a cut is usually a pause between lines).', '',
          '| cut | t, s | bed | amb before / min / after | amb profile | mix before / min / after |', '|---|---|---|---|---|---|']
    shots = tl['shots']
    for i, s in enumerate(shots[1:], 1):
        if not (P['a'] <= s['start'] < P['b']):
            continue
        t, pa = s['start'], shots[i - 1]
        at, apr = bed_stats(amb, t)
        mt, _ = bed_stats(mix, t, flag=False)  # in the mix a minimum at a cut is a speech pause, not a dropout
        L.append(f'| {pa["id"]} → {s["id"]} | {t:.2f} | {pa.get("bed") or "—"} → {s.get("bed") or "—"} | {at} | {apr or "—"} | {mt} |')
    lines = [ln for ln in tl.get('lines') or [] if ln['shot'] in {s['id'] for s in P['shots']}]
    if lines:
        L += ['', '## Lines — loudness', '',
              'LUFS (BS.1770, integrated with gating) in the window of a line: "speech" — `audio/speech.wav` after the voice processing, "mix" — '
              '`audio/mix.wav` with the beds and the sounds. Δ — speech minus the target (`target_lufs`).', '',
              '| line | who | t, s | speech | target | Δ | mix | processing |', '|---|---|---|---|---|---|---|---|']
        for ln in lines:
            lu = speech.lufs(ln['start'], ln['end']) if speech else None
            lm = mix.lufs(ln['start'], ln['end']) if mix else None
            tg = ln.get('target_lufs')
            dl = f'{lu - tg:+.1f}' if lu is not None and tg is not None else '—'
            L.append(f'| {ln["id"]} | {ln["speaker"]} | {ln["start"]:.2f} | {f"{lu:.1f}" if lu is not None else "—"} | {tg if tg is not None else "—"} | {dl} | '
                     f'{f"{lm:.1f}" if lm is not None else "—"} | {ln.get("effect") or ""} |')
    (d / 'pack.md').write_text('\n'.join(L) + '\n', encoding='utf-8')


def write_index(plan, tl, wd, video, out):
    ck = wd / 'check'
    L = [f'# Review pack — {tl.get("title") or wd.name}', '',
         f'Video: `{video.as_posix()}` · {tl["duration"]:.1f} s · {len(tl["shots"])} shots · {len(plan)} parts. The reviewer memo — `docs/REVIEW.md`.', '',
         '| part | shots | time, s | folder |', '|---|---|---|---|']
    for P in plan:
        L.append(f'| {P["n"]} | {P["shots"][0]["id"]}–{P["shots"][-1]["id"]} ({len(P["shots"])}) | {P["a"]:.1f}–{P["b"]:.1f} | '
                 + (f'`{rel(P["dir"], out)}/pack.md`' if (P['dir'] / 'pack.md').exists() else '—') + ' |')
    reports = [(ck / 'staging' / 'report.md', 'staging on the video (the check step)'), (ck / 'report.md', 'the chapter check: speech, lengths, colour'),
               (ck / 'staging' / 'sounds.md', 'sounds and events'), (ck / 'arms' / 'report.txt', 'arm poses (hands_check)'),
               (ck / 'hands', 'sheets of hands and arms (hands_sheet.py)'), (ck / 'guard', 'accepted chapters guard')]
    have = [(p, w) for p, w in reports if p.exists()]
    if have:
        L += ['', 'Machine reports of the chapter:', ''] + [f'- `{p.as_posix()}` — {w}' for p, w in have]
    (out / 'pack.md').write_text('\n'.join(L) + '\n', encoding='utf-8')


# ---------- crop ----------

def crop(args):
    im = Image.open(args.frame).convert('RGB')
    W, H = im.size
    tiles = []
    for b in args.box:
        x, y, w, h = (float(v) for v in b.split(','))
        if max(x, y, w, h) <= 1:
            x, y, w, h = x * W, y * H, w * W, h * H
        x, y = max(0, int(x)), max(0, int(y))
        w, h = int(min(w, W - x)), int(min(h, H - y))
        tiles.append((im.crop((x, y, x + w, y + h)), f'{Path(args.frame).stem} @ {x},{y},{w},{h}'))
    gap, bar = 8, 26
    sh = Image.new('RGB', (sum(t.width for t, _ in tiles) + gap * (len(tiles) - 1), max(t.height for t, _ in tiles) + bar), (14, 16, 26))
    d = ImageDraw.Draw(sh)
    f = font(16, bold=False)
    x = 0
    for t, lab in tiles:
        sh.paste(t, (x, bar))
        d.text((x + 4, 4), lab[:max(10, t.width // 8)], fill=(255, 190, 90), font=f)
        x += t.width + gap
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    sh.save(args.out)
    print(f'{args.out} {sh.width}×{sh.height}')


def main():
    if len(sys.argv) > 1 and sys.argv[1] == 'crop':
        ap = argparse.ArgumentParser(prog='review_pack.py crop', description='A 1:1 crop of a full frame; several boxes — in one row.')
        ap.add_argument('frame')
        ap.add_argument('box', nargs='+', help='x,y,w,h — px or frame fractions (all ≤ 1)')
        ap.add_argument('-o', '--out', required=True)
        return crop(ap.parse_args(sys.argv[2:]))
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('workdir', type=Path, help='the chapter work folder: episodes/<s01e01>/<lang>/<chNN>')
    ap.add_argument('--parts', type=int, default=8)
    ap.add_argument('--out', type=Path, help='the pack folder (default <chapter>/check/review/pack)')
    ap.add_argument('--only', help='only these parts: 3,4')
    ap.add_argument('--video', type=Path, help='a video instead of the chapter video')
    ap.add_argument('--threads', type=int, default=8, help='ffmpeg decoder threads')
    a = ap.parse_args()
    wd = a.workdir.resolve()
    out = (a.out or wd / 'check' / 'review' / 'pack').resolve()
    out.mkdir(parents=True, exist_ok=True)
    return build(wd, a.parts, out, [int(x) for x in a.only.split(',')] if a.only else None, a.video, a.threads)


if __name__ == '__main__':
    sys.exit(main())
