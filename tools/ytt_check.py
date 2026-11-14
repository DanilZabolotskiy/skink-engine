"""A check of the episode subtitles (.ytt, tools/ytt.py) before handing in: a sheet of the pages over the video frames, overlaps and the
timing against the speech.

python tools/ytt_check.py channels/<channel>/episodes/s01e01/<lang> [--ytt <file>] [--video <mp4>] [--pick all|near|hits]
    [--from 0 --to 600] [--per 24] [--out-dir <folder>]

- A page — a window of the .ytt (<p>); a frame — the middle of the page from the episode video (without burnt-in subtitles), over it — the
  page as the YouTube player on a computer draws it (tools/ytt_burn.py: Chrome, the player font, CJK — the system font). The tile caption:
  "time · chapter shot · speaker · place" (place: bottom / higher N / top / side).
- The page box — by the alpha of its window; against the frame boxes within the page time (ytt.Chapter.obstacles: the title bar, the
  stamp, the place tag, the cards, the heads and the reads of the frame journal check/ytt and check/staging): yellow — the frame boxes,
  green — the page, red — an overlap (a line in the output). A world text (texts of the journal) is soft: "on a text" in the caption, not
  an error.
- The speech: the voice of the chapter (audio/speech.wav, an envelope of 20 ms, a voice — above −35 dBFS, ytt.voice): a page without a
  voice, a voice starting later than the page start by more than 0.6 s or earlier by more than 0.3 s (while the previous page is gone), a
  voice going on after the page end by more than 0.3 s without a next page — a line in the output.
- --pick near — only the pages not at the bottom and those with a frame box nearer than 60 px to the page box (a quick sheet); hits — only
  those that ytt.py found no free place for or that lie on a world text; all — all of them.
The sheet — --per pages each (3 in a row, a tile of 640×360), by default <folder>/ytt_check/ytt_check_NN.png.
Exit code 1 — there are overlaps or differences with the speech.
"""
import argparse
import io
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ytt  # noqa: E402
import ytt_burn as yb  # noqa: E402
from sheet import font as sheet_font  # noqa: E402

NEAR = 60
TW, TH = 640, 360


def frame(video, t):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', str(video), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'],
                         capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(out)).convert('RGBA')


def where(pos):
    if pos['ap'] < 3:
        return 'top'
    if pos['ah'] != ytt.BASE['ah']:
        return f'side {pos["ah"]}'
    return 'bottom' if pos['av'] == ytt.BASE['av'] else f'higher av {pos["av"]}'


def gap(r, o):
    dx = max(o[0] - r[2], r[0] - o[2], 0)
    dy = max(o[1] - r[3], r[1] - o[3], 0)
    return max(dx, dy)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dir')
    ap.add_argument('--ytt')
    ap.add_argument('--video')
    ap.add_argument('--pick', default='all', choices=('all', 'near', 'hits'))
    ap.add_argument('--from', dest='t_from', type=float, default=0.0)
    ap.add_argument('--to', type=float, default=1e9)
    ap.add_argument('--per', type=int, default=24)
    ap.add_argument('--out-dir')
    a = ap.parse_args()
    ed = Path(a.dir).resolve()
    stem = f'{ed.parent.name}_{ed.name}'
    ytt_path = Path(a.ytt) if a.ytt else ed / f'{stem}.ytt'
    video = Path(a.video) if a.video else ed / f'{stem}.mp4'
    out_dir = Path(a.out_dir) if a.out_dir else ed / 'ytt_check'
    out_dir.mkdir(parents=True, exist_ok=True)
    pgs = ytt.pages(ed)
    wins = yb.parse_ytt(str(ytt_path))
    if len(wins) != len(pgs):
        sys.exit(f'{ytt_path.name} has {len(wins)} windows, the chapters give {len(pgs)} pages — the .ytt is outdated: python tools/ytt.py {a.dir}')
    W, H = yb.probe(str(video))[0]
    bad = []
    # the speech
    voices = {}
    for wd in ytt.chapters(ed):
        voices[wd.name] = ytt.voice(wd)
    for i, p in enumerate(pgs):
        v = voices[p['ch']]
        if v is None:
            continue
        a0, z0 = p['t_ch']
        k0, k1 = int(a0 / 0.02), int(z0 / 0.02) + 1
        seg = v[k0:k1]
        tm = f'{int(p["a"] // 60)}:{p["a"] % 60:05.2f} {p["ch"]} {p["shot"]}'
        txt = ytt.plain(' '.join(p['rows']))
        if not seg.any():
            bad.append(f'{tm}: no voice under the page — "{txt}"')
            continue
        lag = int(np.argmax(seg)) * 0.02
        prev_end = pgs[i - 1]['z'] if i and pgs[i - 1]['ch'] == p['ch'] else -1
        if lag > 0.6 and not v[max(0, k0 - 5):k0].any():
            bad.append(f'{tm}: the voice comes {lag:.2f} s after the page start — "{txt}"')
        back = k0
        while back > 0 and v[back - 1]:
            back -= 1
        if v[k0] and (k0 - back) * 0.02 > 0.3 and p['a'] - prev_end > 0.1:
            bad.append(f'{tm}: the voice started {(k0 - back) * 0.02:.2f} s before the page — "{txt}"')
        nxt_a = pgs[i + 1]['a'] if i + 1 < len(pgs) and pgs[i + 1]['ch'] == p['ch'] else 1e9
        k2 = k1
        while k2 < len(v) and v[k2]:
            k2 += 1
        if (k2 - k1) * 0.02 > 0.3 and p['z'] + (k2 - k1) * 0.02 < nxt_a:
            bad.append(f'{tm}: the voice goes on {(k2 - k1) * 0.02:.2f} s after the page, and there is no next one — "{txt}"')
    # the choice of the pages
    sel = []
    for i, p in enumerate(pgs):
        if p['z'] <= a.t_from or p['a'] >= a.to:
            continue
        near = any(gap(p['rect'], o) < NEAR for o in p['obs'] if o[4] not in ('title bar', 'stamp')) or where(p['pos']) != 'bottom'
        if a.pick == 'all' or (a.pick == 'near' and near) or (a.pick == 'hits' and (p['hit'] or p['under'])):
            sel.append(i)
    tmp = tempfile.mkdtemp(prefix='ytt_check_')
    only = [(wins[i]['t0'], wins[i]['t1'], [wins[i]]) for i in sel]
    allst = yb.states_of(wins, 0, 1e9)
    mids = [(wins[i]['t0'] + wins[i]['t1']) / 2 for i in sel]
    full = [(m, m, yb.state_at(allst, m)) for m in mids]
    paths = yb.render_states(only + full, (W, H), (W, H), dict(yb.PARAMS), tmp)
    key = lambda st: json.dumps(st, sort_keys=True, ensure_ascii=False)  # noqa: E731
    font = sheet_font(18)
    tiles, hits = [], 0
    for i, m, (_, _, st_only), (_, _, st_full) in zip(sel, mids, only, full):
        p = pgs[i]
        al = np.asarray(Image.open(paths[key(st_only)]))[..., 3]
        ys, xs = np.nonzero(al > 8)
        pb = [xs.min(), ys.min(), xs.max() + 1, ys.max() + 1] if len(xs) else None
        hit = [o for o in ytt.hits(pb, p['obs']) if not ytt.soft(o)] if pb else []
        under = [o for o in ytt.hits(pb, p['obs']) if ytt.soft(o)] if pb else []
        im = frame(video, m)
        if st_full:
            im.alpha_composite(Image.open(paths[key(st_full)]))
        d = ImageDraw.Draw(im)
        for o in p['obs']:
            if o[4] != 'title bar':
                d.rectangle(o[:4], outline=(255, 210, 0), width=2)
        if pb:
            d.rectangle(pb, outline=(255, 40, 40) if hit else (60, 220, 90), width=3 if hit else 1)
        tm = f'{int(m // 60)}:{m % 60:04.1f}'
        label = f'{tm} · {p["ch"]} {p["shot"]} · {p["who"].lower()} · {where(p["pos"])}' + (' · HIT' if hit else ' · on a text' if under else '')
        tiles.append((im.convert('RGB'), label, bool(hit)))
        for o in hit:
            hits += 1
            bad.append(f'{tm} {p["ch"]} {p["shot"]}: the page is on "{o[4]}" {[round(x) for x in o[:4]]}')
    outs = []
    cols = 3
    for n0 in range(0, len(tiles), a.per):
        part = tiles[n0:n0 + a.per]
        rows = -(-len(part) // cols)
        sh = Image.new('RGB', (cols * TW, rows * (TH + 26)), (24, 24, 24))
        dd = ImageDraw.Draw(sh)
        for k, (im, label, hb) in enumerate(part):
            x, y = (k % cols) * TW, (k // cols) * (TH + 26)
            sh.paste(im.resize((TW, TH), Image.LANCZOS), (x, y + 26))
            dd.text((x + 6, y + 3), label, font=font, fill=(255, 90, 90) if hb else (230, 230, 230))
        pth = out_dir / f'ytt_check{"" if a.pick == "all" else "_" + a.pick}_{n0 // a.per + 1:02d}.png'
        sh.save(pth)
        outs.append(pth)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'pages {len(pgs)}, on the sheet {len(tiles)}; sheets {len(outs)} → {out_dir}')
    print(f'overlaps {hits}, differences with the speech {len(bad) - hits}')
    for x in bad:
        print('  ' + x)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
